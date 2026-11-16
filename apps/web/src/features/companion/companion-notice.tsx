import { COMPANION_PATH } from '@aw/shared';
import { Link, useRouterState } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMPANION_COPY as C } from '../../copy/companion.ts';
import { Character } from './character.tsx';
import styles from './companion.module.css';
import { dismissCompanionNotice, useCompanionUi } from './companion-events.ts';

export function CompanionNoticeHost() {
  const { notices, error } = useCompanionUi();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onTask = useRouterState({ select: (s) => s.matches.at(-1)?.fullPath === ROUTES.task });
  if (pathname === COMPANION_PATH || window.aw?.companion.surface === null) return null;
  // 当前任务页已经显示待合并状态，浮层会盖住结果卡的交付操作。
  const shown = notices.filter((notice) => notice.path !== pathname || notice.title !== C.review);
  const notice = shown[0];
  return (
    <aside className={styles.noticeHost} data-task={onTask || undefined} aria-live="polite">
      {error !== null && <ErrorState error={error} />}
      {notice !== undefined && (
        <section className={styles.bubble} aria-label={notice.title}>
          <div className="row">
            <Character mood={notice.mood} />
            <strong>{notice.title}</strong>
          </div>
          <p>{notice.body}</p>
          <div className="row">
            <Link to={notice.path} onClick={() => dismissCompanionNotice(notice.id)}>
              {C.details}
            </Link>
            <Button size="sm" onClick={() => dismissCompanionNotice(notice.id)}>
              {shown.length > 1 ? `${C.next} (${shown.length - 1})` : C.dismiss}
            </Button>
          </div>
        </section>
      )}
    </aside>
  );
}
