import { type TaskDetailDTO, TaskStatus } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/button.tsx';
import styles from '../../components/diff/diff.module.css';
import { DiffPane } from '../../components/diff/diff-browser.tsx';
import type { DiffFocus } from '../../components/diff/diff-view.tsx';
import { FileTree } from '../../components/diff/file-tree.tsx';
import { parseUnifiedDiff } from '../../components/diff/parse-diff.ts';
import { ErrorState } from '../../components/error-state.tsx';
import { DIFF_COPY } from '../../copy/diff.ts';
import { FRONTEND_COPY } from '../../copy/frontend.ts';
import { TASK_RESULT_COPY as R } from '../../copy/task-results.ts';
import { FrontendActivity } from '../preview/frontend-activity.tsx';
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
  const [activity, setActivity] = useState(false);
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
    <section className="col" aria-label={R.changes} data-testid="task-code-changes">
      <div className="row">
        <strong className="grow">{R.changes}</strong>
        <Button
          size="sm"
          aria-pressed={pinned === undefined}
          disabled={!selected}
          onClick={() => setPinned(pinned === undefined ? selected : undefined)}
        >
          {pinned === undefined ? R.followEdit : R.resumeEdit}
        </Button>
      </div>
      {files === undefined ? (
        <p className="hint">{R.loading}</p>
      ) : (
        <div className={styles.frame}>
          <div className={styles.taskWorkspace} data-activity={activity}>
            {files.length === 0 ? (
              <p className="hint">{R.empty}</p>
            ) : (
              <DiffPane
                selected={selected}
                fileQuery={fileQuery}
                annotate
                focus={active && pinned === undefined ? last.focus : undefined}
              />
            )}
            <aside className={styles.taskSidebar} aria-label={R.codeSidebar}>
              <div className="seg">
                <button type="button" aria-pressed={!activity} onClick={() => setActivity(false)}>
                  {DIFF_COPY.files}
                </button>
                <button type="button" aria-pressed={activity} onClick={() => setActivity(true)}>
                  {FRONTEND_COPY.activity}
                </button>
              </div>
              {activity ? (
                <FrontendActivity task={task} inMain={false} starting={false} showInbox={false} />
              ) : (
                files.length > 0 && <FileTree files={files} selected={selected} onSelect={setPinned} />
              )}
            </aside>
          </div>
        </div>
      )}
    </section>
  );
}
