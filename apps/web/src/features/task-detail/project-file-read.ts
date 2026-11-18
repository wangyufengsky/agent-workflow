import { MCP_TOOL_PREFIX, McpToolName } from '@aw/shared';
export const officeRead = MCP_TOOL_PREFIX + McpToolName.ReadOfficeFile;

/** 先按会话目录解析相对路径，再限制到本次任务的项目和工作区。 */
export function projectReadPath(raw: string, cwd: string, roots: string[]): string | undefined {
  const slash = (value: string) => value.replaceAll('\\', '/');
  const absolute = (value: string) => /^(?:\/|[A-Za-z]:\/)/.test(value);
  if (!raw || (!absolute(slash(raw)) && !cwd)) return undefined;
  const file = slash(raw);
  const joined = absolute(file) ? file : slash(cwd) + '/' + file;
  const parts: string[] = [];
  for (const segment of joined.split('/')) {
    if (segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  const normalized = parts.join('/');
  for (const root of roots) {
    const prefix = slash(root).replace(/\/$/, '') + '/';
    const win = /^(?:[A-Z]:\/|\/\/)/i.test(prefix);
    if ((win ? normalized.toLowerCase() : normalized).startsWith(win ? prefix.toLowerCase() : prefix))
      return normalized.slice(prefix.length) || undefined;
  }
  return undefined;
}

type ReadRequest = { path: string; location: string; directory?: string };

export function readRequest(tool: string, input: Record<string, unknown>): ReadRequest | undefined {
  const path = input.filePath ?? input.path;
  if (tool === 'read' && typeof path === 'string') {
    const start = typeof input.offset === 'number' && input.offset > 0 ? input.offset : 1;
    return { path, location: `第 ${start} 行` };
  }
  if (tool === officeRead && typeof path === 'string') {
    return { path, location: [input.sheet, input.range].filter((v) => typeof v === 'string').join(' · ') };
  }
  if (tool !== 'bash' || typeof input.command !== 'string') return undefined;
  // 只接受单一字面路径。管道、重定向、变量、复合命令或执行脚本没有可靠的阅读位置。
  const command = input.command.trim();
  if (/[;&|<>`$*?[\]{}\r\n]/.test(command)) return undefined;
  const cat = /^cat\s+(?:-n\s+)?(?:--\s+)?(.+)$/.exec(command);
  const sed = /^sed\s+-n\s+['"]?(\d+)(?:,(\d+))?p['"]?\s+(?:--\s+)?(.+)$/.exec(command);
  const argument = cat?.[1] ?? sed?.[3];
  if (!argument) return undefined;
  const file = /^(?:'([^']+)'|"([^"]+)"|([^\s'"\\]+))$/.exec(argument);
  const literal = file?.[1] ?? file?.[2] ?? file?.[3];
  if (!literal || literal.startsWith('-') || literal.startsWith('~')) return undefined;
  return {
    path: literal,
    location: sed?.[2] ? `第 ${sed[1]}–${sed[2]} 行` : `第 ${sed?.[1] ?? 1} 行`,
    ...(typeof input.workdir === 'string' ? { directory: input.workdir } : {}),
  };
}
