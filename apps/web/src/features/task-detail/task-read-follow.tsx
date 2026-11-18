import {
  GitTreeEntryType,
  MCP_TOOL_PREFIX,
  McpToolName,
  type TaskDetailDTO,
  type TranscriptEntry,
  TranscriptEntryKind,
} from '@aw/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { attemptQuery, attemptTranscript, useTranscript } from '../attempts/attempt.queries.ts';
import { gitTreeQuery } from '../git/git.queries.ts';
import { officeRead, projectReadPath, readRequest } from './project-file-read.ts';
import styles from './task-page.module.css';

type Reading = { path: string; location: string; excerpt: string };
type Activity = { id: string; time: number; seq: number; reading?: Reading };
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
    (e) => e.kind === TranscriptEntryKind.ToolCall && e.data.tool !== MCP_TOOL_PREFIX + McpToolName.ReportProgress,
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
  const ref = task.git.baseCommit ?? task.git.baseBranch;
  const project = task.project.id;
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
  const activity = useMemo((): Activity | undefined => {
    if (!call || !data) return undefined;
    const value: Activity = { id, time: call.ts, seq: call.seq };
    if (path && exists.data && result?.data.status === 'completed' && result.data.output) {
      const text = excerpt(data.tool, result.data.output);
      if (text && read) value.reading = { path, excerpt: text, location: read.location };
    }
    return value;
  }, [call, data, exists.data, id, path, read, result]);
  useEffect(() => {
    if (activity) report(activity);
  }, [activity, report]);
  return null;
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
  children: (reading: boolean) => ReactNode;
}) {
  const [held, setHeld] = useState<Reading>();
  const [latest, setLatest] = useState<Record<string, Activity>>({});
  const report = useCallback((a: Activity) => setLatest((old) => (old[a.id] === a ? old : { ...old, [a.id]: a })), []);
  const live = task.activeAttempts
    .map((a) => latest[a.id])
    .filter((a): a is Activity => a !== undefined)
    .sort((a, b) => b.time - a.time || b.seq - a.seq)[0]?.reading;
  const reading = following ? live : held;
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
            {following ? '暂停跟随阅读' : held ? '继续跟随阅读' : '跟随 AI 阅读'}
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
              返回成果
            </Button>
          )}
        </div>
      )}
      {reading && (
        <section className="col" aria-label="项目文件阅读">
          <div className="row">
            <strong>{reading.path}</strong>
            <span className="hint">{reading.location}</span>
            <span className="hint">{following ? 'AI 阅读' : '已暂停'}</span>
          </div>
          <pre key={reading.path + reading.location} className={styles.readExcerpt}>
            {reading.excerpt}
          </pre>
        </section>
      )}
      <div hidden={!!reading}>{children(!!reading)}</div>
    </>
  );
}
