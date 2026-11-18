import { type TaskCodeReviewReport, type TranscriptEntry, TranscriptEntryKind } from '@aw/shared';
import { projectReadPath, readRequest } from './project-file-read.ts';

export type ReviewPosition = {
  path: string;
  commit: string;
  line?: number | undefined;
  end?: number | undefined;
  patch?: string;
};
export const findingPosition = (finding: TaskCodeReviewReport['findings'][number]): ReviewPosition => ({
  ...finding.location,
  line: finding.line,
  end: finding.end_line,
});

/** 只定位成功的阅读。统计、搜索、失败的调用以及模型的说明都不代表它读过该行。 */
export function reviewReads(entries: readonly TranscriptEntry[], cwd: string, roots: string[], commit: string) {
  const calls = new Map(
    entries.flatMap((e) => (e.kind === TranscriptEntryKind.ToolCall ? [[e.data.callId, e.data] as const] : [])),
  );
  const reads = new Map<string, ReviewPosition>();
  const remember = (position: ReviewPosition) => {
    const key = JSON.stringify([position.commit, position.path]);
    reads.delete(key);
    reads.set(key, position);
  };
  for (const e of entries) {
    if (e.kind !== TranscriptEntryKind.ToolResult || e.data.status !== 'completed') continue;
    const call = calls.get(e.data.callId);
    if (!call) continue;
    const request = readRequest(call.tool, call.input);
    if (request) {
      if (e.data.output?.includes('<type>directory</type>')) continue;
      const path = projectReadPath(request.path, request.directory ?? cwd, roots);
      if (path) {
        const numbered = call.tool === 'read' && e.data.output?.split('<content>')[1]?.split('</content>')[0];
        const last = numbered ? Array.from(numbered.matchAll(/^\s*(\d+):/gm)).at(-1)?.[1] : undefined;
        remember({ path, commit, line: request.line, end: last ? Number(last) : request.end });
      }
    } else if (call.tool === 'bash' && typeof call.input.command === 'string') {
      const show = /^git show (HEAD|[a-f0-9]{7,64}):([^\s;&|]+)$/.exec(call.input.command.trim());
      if (show?.[1] && show[2]) remember({ path: show[2], commit: show[1] === 'HEAD' ? commit : show[1], line: 1 });
      if (!/^git (diff|show)\s/.test(call.input.command)) continue;
      for (const patch of (e.data.output ?? '').split(/(?=^diff --git )/m)) {
        if (!patch.startsWith('diff --git ') || !patch.includes('\n@@ ')) continue;
        const path = /^\+\+\+ b\/(.+)$/m.exec(patch)?.[1] ?? /^--- a\/(.+)$/m.exec(patch)?.[1];
        if (path) remember({ path: path.trimEnd(), commit, patch });
      }
    }
  }
  return [...reads.values()];
}
