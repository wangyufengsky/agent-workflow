import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  APPROVER_ROLE_KEY,
  AppError,
  type BashGrant,
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
import type { Db } from '../../core/db/database.ts';
import type { Logger } from '../../core/logger.ts';
import { bashGrants } from '../bash-grants/index.ts';
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
export type ReadonlyPermissionPolicy = {
  mode: PermissionMode;
  intent: string;
  canReadFile: ((relativePath: string) => boolean) | null;
};

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
  if (ref?.stat && ref.stat.size <= 8192)
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await readFile(ref.target));
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

const simpleQuery = /^(?:pwd|ls(?: -[alh]{1,3})?|node --version|git (?:status(?: --short)?|rev-parse HEAD))$/u;

async function localBashCall(event: Asked, call: Call | undefined, root: string) {
  if (
    event.permission !== 'bash' ||
    !event.patterns.length ||
    !call ||
    call.tool !== 'bash' ||
    !event.callId ||
    !event.messageId ||
    call.callId !== event.callId ||
    call.messageId !== event.messageId ||
    call.sessionId !== event.sessionId
  )
    return null;
  const { command, workdir } = call.input;
  if (typeof command !== 'string' || (workdir !== undefined && typeof workdir !== 'string')) return null;
  if (Object.keys(call.input).some((k) => !['command', 'workdir', 'description', 'timeout'].includes(k))) return null;
  const base = await realpath(root);
  const directory = await realpath(resolve(root, workdir ?? '.'));
  const sub = relative(base, directory);
  if (isAbsolute(sub) || sub.split(sep).includes('..')) return null;
  return { directory, relativeDirectory: sub || '.', command, timeout: call.input.timeout };
}

const researchFileReaders = new Set(['cat', 'head', 'tail', 'wc', 'stat', 'file', 'cksum', 'shasum', 'sha256sum']);
const relativeFileWord = /^[\p{L}\p{N}_.][\p{L}\p{N}\p{M}_./-]*$/u;
const researchPathErrors = new Set(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP']);

// An exact grammar keeps shell expansion and program-specific options outside automated approval.
function researchFiles(command: string): string[] | undefined {
  const [program, ...args] = command.split(' ');
  const reader = program?.replace(/^(?:\/usr\/bin\/|\/bin\/)/u, '');
  if (!reader || !researchFileReaders.has(reader)) return undefined;
  if ((reader === 'head' || reader === 'tail') && args[0] === '-n' && /^[1-9][0-9]{0,3}$/u.test(args[1] ?? '')) {
    args.splice(0, 2);
  }
  if (reader === 'wc' && /^-[lwc]$/u.test(args[0] ?? '')) args.shift();
  if (reader === 'shasum' && args[0] === '-a' && args[1] === '256') args.splice(0, 2);
  if (args.length > 0 && args.every((word) => relativeFileWord.test(word))) return args;
}

async function readonlyQuery(
  event: Asked,
  call: Call | undefined,
  root: string,
  canReadFile: ReadonlyPermissionPolicy['canReadFile'],
) {
  if (canReadFile === null) return null;
  try {
    const local = await localBashCall(event, call, root);
    if (!local) return null;
    const repository = await realpath(root);
    if ((await realpath(event.directory)) !== repository) return null;
    const { command, directory } = local;
    if (/^git --no-optional-locks rev-parse (?:HEAD|--show-toplevel|--is-inside-work-tree)$/u.test(command))
      return local;
    const files = researchFiles(command);
    if (!files) return null;
    for (const file of files) {
      const requested = resolve(directory, file);
      const target = await realpath(requested);
      for (const path of [requested, target]) {
        const sub = relative(repository, path);
        const segments = sub.split(sep);
        if (
          isAbsolute(sub) ||
          segments.some((part) => part === '..' || part.toLowerCase() === '.git') ||
          !canReadFile(segments.join('/'))
        )
          return null;
      }
      if (!(await stat(target)).isFile()) return null;
    }
    return local;
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      typeof error.code === 'string' &&
      researchPathErrors.has(error.code)
    )
      return null;
    throw error;
  }
}

/** 授权卡记录请求出现时的证据。再次调用时重新读取入口，用户点击期间改过文件也不会放宽下一次授权。 */
async function bashGrantFor(event: Asked, call: Call | undefined, root: string): Promise<BashGrant | null> {
  const local = await localBashCall(event, call, root);
  if (!local) return null;
  const { directory, relativeDirectory, command, timeout } = local;
  let entry = command;
  let manifest: string | undefined;
  const [program, ...args] = command.split(' ');
  if (program === 'npm' || program === 'pnpm') {
    const explicit = args[0] === 'run';
    if (explicit) args.shift();
    const name = args.shift();
    const shorthand = program === 'npm' ? ['test'] : ['test', 'dev', 'build', 'lint'];
    if (!name || !/^[a-zA-Z0-9:_-]+$/u.test(name) || (!explicit && !shorthand.includes(name))) return null;
    manifest = await source(directory, 'package.json');
    if (!manifest) return null;
    const scripts = JSON.parse(manifest)?.scripts;
    if (typeof scripts?.[name] !== 'string' || scripts[`pre${name}`] || scripts[`post${name}`]) return null;
    entry = [scripts[name], ...args].join(' ');
  }
  let contents: string | undefined;
  if (!simpleQuery.test(entry) && !/^(?:echo|ls|wc|stat)(?: [a-zA-Z0-9_./:-]+)*$/u.test(entry)) {
    const file =
      /^(?:(?:node(?: --test)?|bash|sh|python3) )?((?:[./a-zA-Z0-9_-]+\/)?[a-zA-Z0-9_-]+\.(?:[cm]?js|sh|py))(?: [a-zA-Z0-9_./:-]+)*$/u.exec(
        entry,
      )?.[1];
    if (!file || file.startsWith('-') || (entry.startsWith(file) && !entry.startsWith('./'))) return null;
    contents = await source(directory, file);
    if (contents === undefined) return null;
  }
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([manifest, entry, contents, event.patterns, timeout ?? null]))
    .digest('hex');
  return { directory, relativeDirectory, command, fingerprint };
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
    return simpleQuery.test(args.command) || (await testEvidence(directory, args.command, checkCommand));
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
  db: Db;
  sessions: SessionDispatcher;
  roles: RolesService;
  settings: SettingsService;
  opencode: OpencodeClient;
  clock: Clock;
  log: Logger;
}) {
  const grants = bashGrants(deps.db);
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
    remember: grants.remember,
    async readonlyNative(
      input: ReadonlyPermissionPolicy & {
        event: Asked;
        call: Call | undefined;
        directory: string;
        signal: AbortSignal;
        parentSignal: AbortSignal;
      },
    ): Promise<{ reply?: PermissionDecision; reason?: string; bashGrant?: BashGrant | null }> {
      const { event, call, directory, mode, intent, signal, parentSignal } = input;
      signal.throwIfAborted();
      const local = await readonlyQuery(event, call, directory, input.canReadFile);
      if (!local) return {};
      if (mode === PermissionMode.Full) return { reply: PermissionDecision.Once };
      if (mode !== PermissionMode.Assisted) return {};
      const result = await review(
        intent,
        {
          directory: local.directory,
          permission: event.permission,
          patterns: event.patterns,
          tool: call?.tool,
          arguments: call?.input,
        },
        parentSignal,
        signal,
      );
      return result.decision === 'once'
        ? { reply: PermissionDecision.Once, reason: result.reason }
        : { reason: result.reason };
    },
    async native(input: {
      event: Asked;
      call: Call | undefined;
      directory: string;
      intent: string;
      mode: PermissionMode;
      mutable: boolean;
      checkCommand?: string | null;
      owner: { taskId: string; projectId: string | null } | { conversationId: string };
      sessionAllowed: boolean;
      baselineRules: PermissionRule[];
      signal: AbortSignal;
      parentSignal: AbortSignal;
    }) {
      input.signal.throwIfAborted();
      const { event, mode, mutable } = input;
      const regular = mutable && mutableTools.some((tool) => tool === event.permission);
      const legacy = regular ? baseline(event, input.baselineRules) : 'ask';
      if (mode === PermissionMode.Full && regular) return { reply: PermissionDecision.Once };
      if (legacy === 'deny') return { reply: PermissionDecision.Reject };
      const bashGrant =
        event.permission === 'bash' &&
        (mutable || (typeof input.call?.input.command === 'string' && simpleQuery.test(input.call.input.command)))
          ? await bashGrantFor(event, input.call, input.directory).catch(() => null)
          : null;
      if (bashGrant) {
        const owner = input.owner;
        const permitted =
          'conversationId' in owner
            ? grants.permits('conversationId', owner.conversationId, bashGrant)
            : grants.permits('taskId', owner.taskId, bashGrant) ||
              (owner.projectId !== null && grants.permits('projectId', owner.projectId, bashGrant));
        if (permitted) return { reply: PermissionDecision.Once, reason: '命中你已记住的 Bash 授权。' };
      }
      if (mode === PermissionMode.Ask) {
        if (input.sessionAllowed && event.permission !== 'bash') return { reply: PermissionDecision.Once };
        if (legacy === 'allow' && event.callId !== undefined) return { reply: PermissionDecision.Once };
        return { bashGrant };
      }
      if (mode !== PermissionMode.Assisted) return { bashGrant };
      const evidence =
        mutable &&
        (await reviewable(event, input.call, input.directory, input.intent, input.checkCommand).catch(() => false));
      if (!evidence) return { bashGrant, reason: '操作影响需要用户确认。' };
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
        : { bashGrant, reason: result.reason };
    },
  };
}
export type PermissionReviewer = ReturnType<typeof createPermissionReviewer>;
