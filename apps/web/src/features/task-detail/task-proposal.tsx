import { type TaskDetailDTO, TaskStatus } from '@aw/shared';
import { useRef, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { revealInPane } from '../../components/reveal-in-pane.ts';
import { FRONTEND_COPY } from '../../copy/frontend.ts';
import { TASK_CODE_REVIEW_COPY as C } from '../../copy/task-code-review.ts';
import { TASK_RESULT_COPY as R } from '../../copy/task-results.ts';
import { DocumentDraftPreview } from '../artifacts/artifact-preview.tsx';
import { FrontendActivity } from '../preview/frontend-activity.tsx';
import layout from '../preview/frontend-workbench.module.css';
import { RequirementsSection } from '../requirements/requirements-section.tsx';
import { DeliveryActions } from './delivery-actions.tsx';
import styles from './task-code-review.module.css';

export function TaskProposal({ task, text, active }: { task: TaskDetailDTO; text: string | null; active: boolean }) {
  const [follow, setFollow] = useState(true);
  const document = useRef<HTMLDivElement>(null);
  const [outline, setOutline] = useState<string[]>([]);
  const captureOutline = (element: HTMLDivElement | null) => {
    document.current = element;
    if (!element) return;
    const headings = Array.from(
      element.querySelectorAll('article :is(h2,h3)'),
      (heading) => heading.firstChild?.textContent ?? '',
    );
    if (JSON.stringify(headings) !== JSON.stringify(outline)) setOutline(headings);
  };
  return (
    <section className={layout.workbench} aria-label={C.proposal}>
      <header className={layout.toolbar}>
        <strong className="grow">{C.proposal}</strong>
        <Button size="sm" aria-pressed={follow} onClick={() => setFollow(!follow)}>
          {follow ? R.followEdit : R.resumeEdit}
        </Button>
      </header>
      <div className={layout.body}>
        <div className={styles.sheet} ref={captureOutline}>
          {text ? (
            <DocumentDraftPreview draft={{ path: 'proposal.md', text, truncated: false }} follow={active && follow} />
          ) : (
            <p className="hint">{C.waitProposal}</p>
          )}
        </div>
        <aside className={layout.inspector} aria-label={FRONTEND_COPY.activity}>
          {outline.length > 0 && (
            <nav aria-label={C.outline} className={styles.outline}>
              <strong>{C.outline}</strong>
              {outline.map((title, i) => (
                <button
                  type="button"
                  // biome-ignore lint/suspicious/noArrayIndexKey: 目录位置与实际渲染的标题一一对应。
                  key={i}
                  onClick={() => {
                    const heading = document.current?.querySelectorAll('article :is(h2,h3)')[i];
                    const pane = heading?.closest<HTMLElement>('section');
                    if (pane && heading) {
                      setFollow(false);
                      revealInPane(pane, heading);
                    }
                  }}
                >
                  {title}
                </button>
              ))}
            </nav>
          )}
          <h2 className="sec-t">{FRONTEND_COPY.activity}</h2>
          <FrontendActivity task={task} inMain={false} starting={false} />
        </aside>
      </div>
      {task.status === TaskStatus.Review && <DeliveryActions task={task} />}
      {task.result && <RequirementsSection task={task} />}
    </section>
  );
}
