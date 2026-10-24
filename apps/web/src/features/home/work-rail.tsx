import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { IconButton } from '../../components/icon-button.tsx';
import { BATCHES_COPY } from '../../copy/batches.ts';
import { HOME_COPY as C } from '../../copy/home.ts';
import { INITIATIVES_COPY } from '../../copy/initiatives.ts';
import { INBOX_COPY } from '../../copy/tasks.ts';
import { TaskBadge } from '../tasks/task-badge.tsx';
import styles from './home.module.css';
import { useWork } from './work-overview.tsx';

/** Below this window width the rail starts collapsed (28 §2.1): the conversation keeps a readable width. */
const RAIL_MIN_WINDOW = 1180;

/**
 * Beside a conversation on the home page (28 §2.1): what needs the user, the tasks under way and unfinished batches,
 * one line each. Tasks the assistant starts show up here as their cards appear in the conversation.
 */
export function WorkRail() {
  const [open, setOpen] = useState(() => window.innerWidth >= RAIL_MIN_WINDOW);
  const { attention, batches, initiatives, sections } = useWork();
  if (!open) {
    return (
      <div className={styles.railCollapsed}>
        <IconButton icon="chevLeft" label={C.railShow} onClick={() => setOpen(true)} />
      </div>
    );
  }
  const working = sections.filter((s) => s.tasks.length > 0);
  return (
    <aside className={styles.rail} aria-label={C.rail}>
      <div className={styles.railHead}>
        <span className="grow">{C.rail}</span>
        <IconButton icon="chevRight" label={C.railHide} onClick={() => setOpen(false)} />
      </div>
      {attention.length > 0 && (
        <section className={styles.railGroup}>
          <h3 className={styles.railTitle}>
            {INBOX_COPY.title} <span className={styles.railCount}>{attention.length}</span>
          </h3>
          {attention.map((item) => (
            <Link
              key={item.id}
              className={styles.railItem}
              {...(item.taskId === null ? { to: ROUTES.inbox } : { to: ROUTES.task, params: { taskId: item.taskId } })}
            >
              <span className="ellipsis">{item.title}</span>
              <small>{INBOX_COPY.kind[item.kind]}</small>
            </Link>
          ))}
        </section>
      )}
      {working.map((section) => (
        <section key={section.title} className={styles.railGroup}>
          <h3 className={styles.railTitle}>
            {section.title} <span className={styles.railCount}>{section.tasks.length}</span>
          </h3>
          {section.tasks.map((t) => (
            <Link key={t.id} className={styles.railItem} to={ROUTES.task} params={{ taskId: t.id }}>
              <span className={styles.railRow}>
                <span className="ellipsis grow">{t.title}</span>
                <TaskBadge group={t.displayGroup} />
              </span>
              <small>
                {t.key} · {t.project.name}
              </small>
            </Link>
          ))}
        </section>
      ))}
      {initiatives.length > 0 && (
        <section className={styles.railGroup}>
          <h3 className={styles.railTitle}>{INITIATIVES_COPY.inProgress}</h3>
          {initiatives.map((i) => (
            <Link key={i.id} className={styles.railItem} to={ROUTES.initiative} params={{ initiativeId: i.id }}>
              <span className="ellipsis">{i.title}</span>
              <small>{INITIATIVES_COPY.progress(i.doneCount, i.itemCount)}</small>
              <span className={styles.railBar}>
                <span style={{ inlineSize: `${(100 * i.doneCount) / i.itemCount}%` }} />
              </span>
            </Link>
          ))}
        </section>
      )}
      {batches.length > 0 && (
        <section className={styles.railGroup}>
          <h3 className={styles.railTitle}>{BATCHES_COPY.inProgress}</h3>
          {batches.map((b) => (
            <Link key={b.id} className={styles.railItem} to={ROUTES.batch} params={{ batchId: b.id }}>
              <span className="ellipsis">{b.title}</span>
              <small>{C.batchProgress(b.ended, b.total)}</small>
              <span className={styles.railBar}>
                <span style={{ inlineSize: `${(100 * b.ended) / b.total}%` }} />
              </span>
            </Link>
          ))}
        </section>
      )}
      {attention.length === 0 && working.length === 0 && batches.length === 0 && initiatives.length === 0 && (
        <p className="hint">{C.railEmpty}</p>
      )}
    </aside>
  );
}
