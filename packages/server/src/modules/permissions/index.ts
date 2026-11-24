import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  APPROVER_ROLE_KEY,
  AppError,
  ErrorCode,
  modelEfforts,
  OPENCODE_APPROVER_AGENT,
  type PermissionAction,
  PermissionDecision,
  PermissionMode,
  type PermissionRule,
} from '@aw/shared';
import { z } from 'zod';
import type { Clock } from '../../core/clock.ts';
import type { Logger } from '../../core/logger.ts';
import {
  type OpencodeClient,
  type OpencodeEvent,
  type OpencodeEventType,
  parseModelRef,
  type SessionDispatcher,
  SessionPurpose,
} from '../opencode/index.ts';
import type { RolesService } from '../roles/index.ts';
import type { SettingsService } from '../settings/index.ts';

export type TaskPermissionPolicy = { mode: PermissionMode; intent: string; checkCommand: string | null };

type Asked = Extract<OpencodeEvent, { type: typeof OpencodeEventType.PermissionAsked }>;
type Call = Extract<OpencodeEvent, { type: typeof OpencodeEventType.Tool }>;
const reviewSchema = z
  .object({ decision: z.enum(['once', 'ask']), reason: z.string().trim().min(1).max(400) })
  .strict();
const REVIEW_TIMEOUT_MS = 20_000;
const mutableTools = ['bash', 'external_directory', 'webfetch', 'edit'] as const;

export function grantKey(event: { permission: string; patterns: string[] }) {
  return JSON.stringify([event.permission, ...event.patterns]);
}

/** OpenCode 每次原生请求都来到同一会话入口，因此执行途中切档不依赖替换正在运行的 prompt。 */
export function scopedRules(rules: PermissionRule[]): PermissionRule[] {
  return [
    ...rules.filter((r) => !mutableTools.some((tool) => tool === r.permission) || r.pattern !== '*'),
    ...mutableTools.map((permission) => ({ permission, pattern: '*', action: 'ask' as const })),
  ];
}

function matches(pattern: string, resource: string) {
  const expr = pattern
    .split('')
    .map((c) => (c === '*' ? '[\\s\\S]*' : c === '?' ? '[\\s\\S]' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp('^' + expr + '$', 'u').test(resource);
}

function baseline(event: Asked, rules: PermissionRule[]): PermissionAction {
  if (event.permission === 'external_directory') return 'deny';
  if (event.permission === 'edit') return 'allow';
  if (event.permission !== 'bash' || !event.patterns.length) return 'ask';
  const actions = event.patterns.map(
    (p) => rules.findLast((r) => r.permission === 'bash' && matches(r.pattern, p))?.action ?? 'ask',
  );
  return actions.includes('deny') ? 'deny' : actions.includes('ask') ? 'ask' : 'allow';
}

/** 允许已有的普通文件与已有目录下的新文件，拒绝符号链接和越界路径。 */
async function localFile(root: string, file: string) {
  const base = await realpath(root);
  const target = resolve(base, file);
  const path = relative(base, target);
  if (!path || isAbsolute(path) || path.split(sep).some((p) => p === '..' || p.startsWith('.'))) return;
  if ((await realpath(dirname(target))) !== dirname(target)) return;
  const stat = await lstat(target).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err;
    return undefined;
  });
  if (!stat || (stat.isFile() && stat.nlink === 1)) return { target, stat };
}

async function source(root: string, file: string) {
  const ref = await localFile(root, file);
  if (ref?.stat && ref.stat.size <= 8192) return readFile(ref.target, 'utf8');
}

/** 向审批员提供已配置的检查命令及其可定位的测试入口。未知脚本交给用户。 */
async function testEvidence(root: string, command: string, configured: string | null | undefined) {
  if (command !== configured) return;
  let entry = command;
  if (/^(?:npm|pnpm) (?:run )?test$/u.test(command)) {
    const manifest = await source(root, 'package.json');
    if (!manifest) return;
    const scripts = JSON.parse(manifest)?.scripts;
    if (typeof scripts?.test !== 'string' || scripts.pretest || scripts.posttest) return;
    entry = scripts.test;
  }
  const path = /^node --test ([a-zA-Z0-9_/.-]+\.test\.(?:[cm]?js))$/u.exec(entry)?.[1];
  if (!path) return;
  const contents = await source(root, path);
  if (contents) return { testCommand: entry, file: path, contents };
}

async function reviewable(
  event: Asked,
  call: Call | undefined,
  directory: string,
  intent: string,
  checkCommand?: string | null,
) {
  if (!call || !event.callId || !event.messageId || call.messageId !== event.messageId || call.callId !== event.callId)
    return false;
  const args = call.input;
  if (event.permission === 'bash' && call.tool === 'bash') {
    if (typeof args.workdir === 'string' && resolve(directory, args.workdir) !== resolve(directory)) return false;
    // 只交给模型已明确副作用边界的完整命令；项目脚本和解释器可执行任意代码。
    if (typeof args.command !== 'string') return false;
    return (
      /^(?:pwd|ls(?: -[alh]{1,3})?|node --version|git (?:status(?: --short)?|rev-parse HEAD))$/u.test(args.command) ||
      (await testEvidence(directory, args.command, checkCommand))
    );
  }
  if (event.permission === 'webfetch' && call.tool === 'webfetch' && typeof args.url === 'string') {
    const url = URL.canParse(args.url) ? new URL(args.url) : undefined;
    return (
      !!url &&
      url.protocol === 'https:' &&
      !url.search &&
      !url.username &&
      !url.password &&
      !url.hash &&
      /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/iu.test(url.hostname) &&
      !/\.(?:local|internal|localhost|test)$/iu.test(url.hostname) &&
      (intent.match(/https:\/\/[^\s<>《》「」“”。，、；）)]+/gu) ?? []).some(
        (token) => URL.canParse(token) && new URL(token).href === url.href,
      )
    );
  }
  if (event.permission === 'edit' && ['write', 'edit'].includes(call.tool) && typeof args.filePath === 'string') {
    return (
      /\.(?:md|txt|css|tsx?|jsx?|java|py|html)$/iu.test(args.filePath) && !!(await localFile(directory, args.filePath))
    );
  }
  return false;
}

export function createPermissionReviewer(deps: {
  sessions: SessionDispatcher;
  roles: RolesService;
  settings: SettingsService;
  opencode: OpencodeClient;
  clock: Clock;
  log: Logger;
}) {
  async function review(
    intent: string,
    operation: unknown,
    parentSignal: AbortSignal,
    requestSignal: AbortSignal = parentSignal,
  ) {
    if (!intent.trim()) return { decision: 'ask' as const, reason: '缺少直接用户授权。' };
    const role = deps.roles.getByKey(APPROVER_ROLE_KEY);
    const model = role.model ?? deps.settings.get('ai.defaultModel');
    const text = JSON.stringify({ userRequest: intent, operation });
    if (text.length > 32000) return { decision: 'ask' as const, reason: '完整请求超出审批上下文。' };
    const timer = new AbortController();
    const cancel = deps.clock.schedule(REVIEW_TIMEOUT_MS, () => timer.abort());
    try {
      const raw = await deps.sessions.call(
        {
          purpose: SessionPurpose.Approval,
          title: 'Permission review',
          parentSignal,
          signal: AbortSignal.any([requestSignal, timer.signal]),
        },
        (session) =>
          deps.opencode.promptDocument({
            ...session,
            efforts: modelEfforts(deps.settings.getAll(), role),
            agent: OPENCODE_APPROVER_AGENT,
            system: role.prompt,
            text,
            ...(model === null ? {} : { model: parseModelRef(model) }),
          }),
      );
      return reviewSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (parentSignal.aborted) throw new AppError(ErrorCode.PermissionRequestExpired, 'The requesting turn ended');
      deps.log.warn({ errorType: error instanceof Error ? error.name : 'unknown' }, 'permission review unavailable');
      return { decision: 'ask' as const, reason: '审批员未返回有效结论。' };
    } finally {
      cancel();
    }
  }
  return {
    review,
    async native(input: {
      event: Asked;
      call: Call | undefined;
      directory: string;
      intent: string;
      mode: PermissionMode;
      mutable: boolean;
      checkCommand?: string | null;
      baselineRules: PermissionRule[];
      signal: AbortSignal;
      parentSignal: AbortSignal;
    }) {
      input.signal.throwIfAborted();
      const { event, mode, mutable } = input;
      const regular = mutable && mutableTools.some((tool) => tool === event.permission);
      const legacy = regular ? baseline(event, input.baselineRules) : 'ask';
      if (mode === PermissionMode.Full && regular) return { reply: PermissionDecision.Once };
      if (mode === PermissionMode.Ask || legacy === 'deny') {
        if (legacy === 'deny') return { reply: PermissionDecision.Reject };
        if (legacy === 'allow' && event.callId !== undefined) return { reply: PermissionDecision.Once };
        return {};
      }
      if (mode !== PermissionMode.Assisted) return {};
      const evidence =
        mutable &&
        (await reviewable(event, input.call, input.directory, input.intent, input.checkCommand).catch(() => false));
      if (!evidence) return { reason: '操作影响需要用户确认。' };
      const result = await review(
        input.intent,
        {
          directory: input.directory,
          permission: event.permission,
          patterns: event.patterns,
          tool: input.call?.tool,
          arguments: input.call?.input,
          ...(typeof evidence === 'object' ? { verifiedTest: evidence } : {}),
        },
        input.parentSignal,
        input.signal,
      );
      return result.decision === 'once'
        ? { reply: PermissionDecision.Once, reason: result.reason }
        : { reason: result.reason };
    },
  };
}
export type PermissionReviewer = ReturnType<typeof createPermissionReviewer>;
