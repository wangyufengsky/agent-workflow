import { posix } from 'node:path';
import {
  AppError,
  ErrorCode,
  type PermissionRule,
  Platform,
  RECALL_PAGE_MAX_CHARS,
  type RecallInput,
  type RecallOutput,
} from '@aw/shared';
import { host } from '../../core/platform.ts';
import type { OpencodeClient } from './opencode.client.ts';
import { type ContextOwner, recallToolName } from './opencode.context-owner.ts';

type RecallSession = { sessionId: string; directory: string; kind: ContextOwner['kind']; agent: string | undefined };

/** OpenCode V1 Permission.disabled 与 Wildcard.match 对工具名称的规则。最后一条匹配的全参数 deny 隐藏工具。 */
function lastToolRule(rules: PermissionRule[], name: string) {
  return rules.findLast(({ permission }) => {
    // 两个召回工具名只有 ASCII 单词字符和连字符。OpenCode 的通配符只有 * 和 ?。
    const key = host.os === Platform.Win32 ? permission.toLowerCase() : permission;
    const pattern = key.replace(/ \*$/, '');
    if (pattern === name || pattern === '*') return true;
    return /^[\w?*-]+$/.test(pattern) && /[?*]/.test(pattern) && posix.matchesGlob(name, pattern);
  });
}

export async function visibleRecallTool(opencode: OpencodeClient, session: RecallSession, signal?: AbortSignal) {
  const { agent, directory, kind } = session;
  if (agent === undefined) return undefined;
  const name = recallToolName(kind);
  let rule = lastToolRule(await opencode.sessionRules({ ...session, ...(signal && { signal }) }), name);
  if (!rule) {
    const rules = await opencode.agentRules(directory, agent, signal);
    if (!rules) return undefined;
    rule = lastToolRule(rules, name);
  }
  return rule?.pattern === '*' && rule.action === 'deny' ? undefined : name;
}

export async function recallPage(
  opencode: OpencodeClient,
  session: RecallSession,
  { messageId, partId, offset, limit }: RecallInput,
  signal?: AbortSignal,
): Promise<RecallOutput> {
  if (!(await visibleRecallTool(opencode, session, signal)))
    throw new AppError(ErrorCode.McpToolNotAllowed, 'Recall is disabled in this physical session');
  const text = await opencode.readToolOutput({
    sessionId: session.sessionId,
    directory: session.directory,
    messageId,
    partId,
    ...(signal && { signal }),
  });
  if (text === undefined)
    throw new AppError(ErrorCode.NotFound, 'Completed text tool result not found in the current session');
  const chars = Array.from(text);
  const start = Math.min(offset, chars.length);
  const end = Math.min(start + Math.min(limit, RECALL_PAGE_MAX_CHARS), chars.length);
  return {
    content: chars.slice(start, end).join(''),
    offset: start,
    totalLength: chars.length,
    nextOffset: end < chars.length ? end : null,
  };
}
