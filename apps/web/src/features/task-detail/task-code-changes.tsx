import { type TaskDetailDTO, TaskStatus } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/button.tsx';
import { DiffBrowser } from '../../components/diff/diff-browser.tsx';
import type { DiffFocus } from '../../components/diff/diff-view.tsx';
import { parseUnifiedDiff } from '../../components/diff/parse-diff.ts';
import { ErrorState } from '../../components/error-state.tsx';
import { taskDiffFileQuery, taskDiffQuery } from '../tasks/tasks.queries.ts';

/** 和上一次读取的工作区相比，定位本次新出现的改动；原文件行号用于纯删除。 */
export function editFocus(before: string, after: string): DiffFocus | undefined {
  const changes = (diff: string) =>
    parseUnifiedDiff(diff).hunks.flatMap((h) => h.lines.filter((l) => l.kind !== 'context'));
  const old = new Set(changes(before).map((l) => JSON.stringify([l.kind, l.oldNo, l.newNo, l.text])));
  const lines = changes(after);
  const fresh = lines.filter((l) => !old.has(JSON.stringify([l.kind, l.oldNo, l.newNo, l.text])));
  const line = fresh.find((l) => l.kind === 'add') ?? fresh[0] ?? lines[0];
  if (!line) return undefined;
  return line.newNo === null ? { line: line.oldNo ?? 1, side: 'old' } : { line: line.newNo, side: 'new' };
}

export function TaskCodeChanges({ task, active }: { task: TaskDetailDTO; active: boolean }) {
  const [pinned, setPinned] = useState<string>();
  const interval = active && task.status === TaskStatus.Running ? 2500 : false;
  const summary = useQuery({ ...taskDiffQuery(task.id), enabled: active, refetchInterval: interval });
  const files = summary.data?.files;
  const selected =
    (pinned && files?.some((f) => f.path === pinned) ? pinned : summary.data?.latestPath) ?? files?.[0]?.path;
  const fileQuery = taskDiffFileQuery(task.id);
  const file = useQuery({
    ...fileQuery(selected ?? ''),
    enabled: active && selected !== undefined,
    refetchInterval: interval,
  });
  const diff = file.data && 'diff' in file.data ? file.data.diff : '';
  const [last, setLast] = useState<{ path?: string | undefined; diff: string; focus?: DiffFocus | undefined }>({
    diff: '',
  });
  if (last.path !== selected || last.diff !== diff)
    setLast({ path: selected, diff, focus: editFocus(last.path === selected ? last.diff : '', diff) });
  if (summary.isError) return <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />;
  return (
    <section className="col" aria-label="工作区改动" data-testid="task-code-changes">
      <div className="row">
        <strong className="grow">工作区改动</strong>
        <Button
          size="sm"
          aria-pressed={pinned === undefined}
          disabled={!selected}
          onClick={() => setPinned(pinned === undefined ? selected : undefined)}
        >
          {pinned === undefined ? '跟随编辑' : '继续跟随编辑'}
        </Button>
      </div>
      {files === undefined ? (
        <p className="hint">正在读取工作区…</p>
      ) : files.length === 0 ? (
        <p className="hint">当前没有文件改动。</p>
      ) : (
        <DiffBrowser
          files={files}
          fileQuery={fileQuery}
          selected={selected}
          onSelect={setPinned}
          focus={active && pinned === undefined ? last.focus : undefined}
          annotate
        />
      )}
    </section>
  );
}
