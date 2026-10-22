import { Icon } from '../components/icon.tsx';
import { PLAN_EDITOR_COPY as C } from '../copy/plan-editor.ts';
import styles from './plan-editor.module.css';

/** How many problems keep the plan from being saved; the list is in the side panel. */
export function ProblemCount({ count }: { count: number }) {
  return count === 0 ? (
    <span className={`badge st-ok ${styles.count}`}>
      <Icon name="check" size="sm" />
      {C.noProblemsShort}
    </span>
  ) : (
    <span className={`badge st-danger ${styles.count}`}>{C.problemCount(count)}</span>
  );
}
