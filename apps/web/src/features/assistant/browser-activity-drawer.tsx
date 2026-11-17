import type { AssistantBrowserActivity } from '@aw/shared';
import { Drawer } from '../../components/drawer.tsx';
import { ASSISTANT_BROWSER_COPY as C } from '../../copy/assistant.ts';
import { formatDateTime } from '../../copy/common.ts';
import styles from './browser-activity-drawer.module.css';

export function BrowserActivityDrawer({
  open,
  onOpenChange,
  activity,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activity: readonly AssistantBrowserActivity[];
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title={C.history}>
      {activity.length === 0 ? (
        <p className="hint">{C.empty}</p>
      ) : (
        <ol className={styles.list}>
          {activity.map((entry) => (
            <li className={styles.entry} key={entry.id}>
              <div className="row">
                <strong>
                  {C.kinds[entry.kind]}
                  {entry.target === null ? '' : ` · ${entry.target}`}
                </strong>
                <span className="hint">{C.outcomes[entry.outcome]}</span>
              </div>
              <p className="hint">
                {formatDateTime(entry.at)} · <span className="mono">{entry.page}</span>
              </p>
              {entry.blockedRequests.length > 0 && (
                <ul className={styles.requests}>
                  {entry.blockedRequests.map((request) => (
                    <li className="mono" key={request}>
                      {request}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </Drawer>
  );
}
