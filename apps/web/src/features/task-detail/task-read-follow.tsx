import {
  type BrowserFrame,
  GitTreeEntryType,
  getTaskDocumentDraftOp,
  isWritingRepositoryDocument,
  MCP_TOOL_PREFIX,
  McpToolName,
  type TaskDetailDTO,
  type TranscriptEntry,
  TranscriptEntryKind,
} from '@aw/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { Button } from '../../components/button.tsx';
import { revealInPane, sizeReadingPane } from '../../components/reveal-in-pane.ts';
import { TASK_RESULT_COPY as R } from '../../copy/task-results.ts';
import { attemptQuery, attemptTranscript, useTranscript } from '../attempts/attempt.queries.ts';
import { gitCommitBeforeQuery, gitTreeQuery } from '../git/git.queries.ts';
import { FollowedBrowserFrame } from '../preview/followed-browser-frame.tsx';
import { framesQuery } from '../preview/preview.queries.ts';
import { officeRead, projectReadPath, readRequest } from './project-file-read.ts';
import styles from './task-page.module.css';

type Reading = { path: string; location: string; excerpt: string; line?: number | undefined };
type Activity = { id: string; time: number; seq: number; reading?: Reading; frame?: BrowserFrame };
function excerpt(tool: string, output: string): string {
  if (tool === officeRead) {
    try {
      const result: unknown = JSON.parse(output);
      if (result && typeof result === 'object' && 'text' in result && typeof result.text === 'string')
        return result.text;
    } catch {
      // 工具可以直接返回文本。
    }
  }
  const start = output.indexOf('<content>');
  if (start === -1) return output;
  const end = output.lastIndexOf('</content>');
  return output.slice(start + '<content>'.length, end < start ? undefined : end).trim();
}

/** 只观察用户开启跟随后活跃的会话，沿用执行详情的 SSE 与分页缓存。 */
function ReadObserver({
  task,
  repo,
  id,
  report,
}: {
  task: TaskDetailDTO;
  repo: string;
  id: string;
  report: (activity: Activity) => void;
}) {
  const { entries } = useTranscript(attemptTranscript(id));
  const attempt = useQuery(attemptQuery(id));
  const client = useQueryClient();
  const call = entries.findLast(
    (e) =>
      e.kind === TranscriptEntryKind.ToolCall &&
      (e.data.tool !== MCP_TOOL_PREFIX + McpToolName.ReportProgress || typeof e.data.input.proposal === 'string'),
  );
  const data = call?.kind === TranscriptEntryKind.ToolCall ? call.data : undefined;
  const read = useMemo(() => data && readRequest(data.tool, data.input), [data]);
  const path =
    read &&
    projectReadPath(
      read.path,
      read.directory ?? attempt.data?.directory ?? '',
      [task.git.worktreePath, repo].filter((s): s is string => Boolean(s)),
    );
  const project = task.project.id;
  const branch = task.git.branch;
  const atStart = useQuery({
    ...gitCommitBeforeQuery(project, branch ?? '', attempt.data?.startedAt ?? 0),
    enabled: !!path && !!branch && !!attempt.data,
    staleTime: Infinity,
  });
  const ref = atStart.data?.sha ?? task.git.baseCommit ?? task.git.baseBranch;
  const browsing = data?.tool.startsWith(`${MCP_TOOL_PREFIX}browser_`) === true;
  const frames = useQuery({ ...framesQuery(id), enabled: browsing });
  const frame = browsing ? frames.data?.at(-1) : undefined;
  const exists = useQuery({
    queryKey: ['task-read-source', project, ref, path],
    enabled: !!path,
    staleTime: task.git.baseCommit ? Infinity : 0,
    queryFn: async () => {
      const parts = (path ?? '').split('/');
      let dir = '';
      for (const part of parts) {
        const entries = await client.ensureQueryData(gitTreeQuery(project, ref, dir));
        const entry = entries.find((e) => e.name === part);
        if (!entry) return false;
        if (entry.path === path) return entry.type === GitTreeEntryType.Blob && !entry.symlink;
        if (entry.type !== GitTreeEntryType.Tree) return false;
        dir = entry.path;
      }
      return false;
    },
  });
  const result = data
    ? entries.findLast(
        (e): e is Extract<TranscriptEntry, { kind: 'tool_result' }> =>
          e.kind === TranscriptEntryKind.ToolResult && e.data.callId === data.callId,
      )
    : undefined;
  const writing = task.artifact && task.nodes.find(isWritingRepositoryDocument);
  const published = !!path && !!task.artifact?.versions.some((v) => v.repository?.path === path);
  const created = useQuery({
    queryKey: ['task-read-document', task.id, writing?.id, path, data?.callId],
    enabled:
      !!writing &&
      !!path &&
      /\.(md|txt)$/i.test(path) &&
      exists.data === false &&
      !published &&
      result?.data.status === 'completed',
    queryFn: async () =>
      Boolean((await callOperation(getTaskDocumentDraftOp, { id: task.id, nodeId: writing?.id ?? '', path })).draft),
  });
  const readable = exists.data || published || created.data;
  const activity = useMemo((): Activity | undefined => {
    if (!call || !data) return undefined;
    const value: Activity = { id, time: call.ts, seq: call.seq };
    if (frame) value.frame = frame;
    if (path && readable && result?.data.status === 'completed' && result.data.output) {
      const text = excerpt(data.tool, result.data.output);
      if (text && read) value.reading = { path, excerpt: text, location: read.location, line: read.line };
    }
    return value;
  }, [call, data, frame, readable, id, path, read, result]);
  useEffect(() => {
    if (activity) report(activity);
  }, [activity, report]);
  return null;
}

function ReadExcerpt({ reading, follow }: { reading: Reading; follow: boolean }) {
  const pane = useRef<HTMLPreElement>(null);
  const target = useRef<HTMLElement>(null);
  const attach = useCallback((element: HTMLPreElement | null) => {
    pane.current = element;
    return sizeReadingPane(element);
  }, []);
  const lines = useMemo(() => reading.excerpt.split('\n'), [reading.excerpt]);
  const at = Math.max(
    0,
    lines.findIndex((line) => Number(/^\s*(\d+):/.exec(line)?.[1]) === reading.line),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: 同一文件的下一次读取也要重新定位。
  useLayoutEffect(() => {
    if (follow && pane.current && target.current) revealInPane(pane.current, target.current);
  }, [reading, follow]);
  return (
    <pre ref={attach} className={styles.readExcerpt}>
      {at > 0 && lines.slice(0, at).join('\n') + '\n'}
      <mark ref={target}>{lines[at]}</mark>
      {at + 1 < lines.length && '\n' + lines.slice(at + 1).join('\n')}
    </pre>
  );
}

export function TaskReadFollow({
  task,
  repo,
  active,
  following,
  onFollow,
  children,
}: {
  task: TaskDetailDTO;
  repo: string;
  active: boolean;
  following: boolean;
  onFollow: (on: boolean) => void;
  children: (reading: boolean, frame?: BrowserFrame) => ReactNode;
}) {
  const [held, setHeld] = useState<Reading>();
  const [latest, setLatest] = useState<Record<string, Activity>>({});
  const report = useCallback((a: Activity) => setLatest((old) => (old[a.id] === a ? old : { ...old, [a.id]: a })), []);
  const live = task.activeAttempts
    .map((a) => latest[a.id])
    .filter((a): a is Activity => a !== undefined)
    .sort((a, b) => b.time - a.time || b.seq - a.seq)[0];
  const reading = following ? live?.reading : held;
  const frame = following ? live?.frame : undefined;
  const standaloneFrame = !task.frontend && frame;
  return (
    <>
      {active &&
        following &&
        task.activeAttempts.map((a) => <ReadObserver key={a.id} task={task} repo={repo} id={a.id} report={report} />)}
      {(task.activeAttempts.length > 0 || reading) && (
        <div className="row">
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={following}
            onClick={() => {
              setHeld(following ? reading : undefined);
              onFollow(!following);
            }}
          >
            {following ? R.pauseRead : held ? R.resumeRead : R.followRead}
          </Button>
          {reading && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onFollow(false);
                setHeld(undefined);
              }}
            >
              {R.back}
            </Button>
          )}
        </div>
      )}
      {reading && (
        <section className="col" aria-label={R.readRegion}>
          <div className="row">
            <strong>{reading.path}</strong>
            <span className="hint">{reading.location}</span>
            <span className="hint">{following ? R.reading : R.paused}</span>
          </div>
          <ReadExcerpt reading={reading} follow={following && active} />
        </section>
      )}
      {standaloneFrame && <FollowedBrowserFrame frame={standaloneFrame} />}
      <div hidden={!!reading || !!standaloneFrame}>{children(!!reading || !!standaloneFrame, frame)}</div>
    </>
  );
}
