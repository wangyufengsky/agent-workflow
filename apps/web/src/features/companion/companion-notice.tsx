import { COMPANION_PATH } from '@aw/shared';
import { Link } from '@tanstack/react-router';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMPANION_COPY as C } from '../../copy/companion.ts';
import { Character } from './character.tsx';
import styles from './companion.module.css';
import { dismissCompanionNotice, useCompanionUi } from './companion-events.ts';

export function CompanionNoticeHost() {
  const { notices, error } = useCompanionUi();
  if (window.location.pathname === COMPANION_PATH || window.aw?.companion.surface === null) return null;
  const notice = notices[0];
  return (
    <aside className={styles.noticeHost} aria-live="polite">
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
              {notices.length > 1 ? `${C.next} (${notices.length - 1})` : C.dismiss}
            </Button>
          </div>
        </section>
      )}
    </aside>
  );
}
