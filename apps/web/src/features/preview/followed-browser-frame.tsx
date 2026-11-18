import { type BrowserFrame, previewPathFromUrl } from '@aw/shared';
import { PREVIEW_PANE_COPY as C } from '../../copy/browser.ts';
import { FRONTEND_COPY } from '../../copy/frontend.ts';
import { attemptFileUrl, useImage } from './preview.queries.ts';
import styles from './preview-pane.module.css';

export function FollowedBrowserFrame({ frame }: { frame: BrowserFrame }) {
  const src = useImage(attemptFileUrl(frame.attemptId, frame.file));
  const path = frame.url && previewPathFromUrl(new URL(frame.url));
  const label = `${C.tool[frame.tool] ?? frame.tool} ${path}`;
  return (
    <section className={styles.followedFrame} aria-label={FRONTEND_COPY.aiScreen}>
      <div className={styles.frameHead}>
        <strong>{FRONTEND_COPY.aiScreen}</strong>
        <span>{label}</span>
      </div>
      <div className={styles.frame}>{src && <img src={src} alt={label} />}</div>
    </section>
  );
}
