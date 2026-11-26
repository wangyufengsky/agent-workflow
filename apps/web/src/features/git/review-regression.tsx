import {
  FUNCTIONAL_TEST_WORKFLOW_KEY,
  GitComparisonStatus,
  GitImpactTargetKind,
  type GitReviewDTO,
  REQUIREMENT_MAX_CHARS,
} from '@aw/shared';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { GIT_COPY } from '../../copy/git.ts';
import { GIT_REVIEW_COPY as C } from '../../copy/git-review.ts';
import styles from './review-result.module.css';

export function ReviewRegression({ review, checks }: { review: GitReviewDTO; checks: string[] }) {
  const navigate = useNavigate();
  const [omitted, setOmitted] = useState<ReadonlySet<string>>(new Set());
  const selected = checks.filter((check) => !omitted.has(check));

  const transactions = new Set([
    ...review.impacts
      .filter((impact) => impact.targetKind === GitImpactTargetKind.Transaction)
      .map((impact) => impact.title),
    ...(review.comparison?.transactions ?? [])
      .filter((item) => item.status !== GitComparisonStatus.Unchanged)
      .map((item) => item.title),
  ]);
  const requirement = [
    C.testRequirement(review.label),
    GIT_COPY.scope(review.from, review.to),
    ...selected.map((check) => `- ${check}`),
    ...(transactions.size ? [C.affectedTransactions, ...Array.from(transactions, (title) => `- ${title}`)] : []),
  ].join('\n');
  const tooLong = requirement.length > REQUIREMENT_MAX_CHARS;
  const openTask = () =>
    void navigate({
      to: ROUTES.home,
      search: { projectId: review.projectId, workflow: FUNCTIONAL_TEST_WORKFLOW_KEY, requirement },
    });

  return (
    <div className={`card col ${styles.checks}`}>
      {checks.length === 0 ? (
        <p className="hint">{C.noChecks}</p>
      ) : (
        <>
          {checks.map((check) => (
            <label key={check} className="row">
              <input
                type="checkbox"
                checked={!omitted.has(check)}
                onChange={(event) => {
                  const next = new Set(omitted);
                  if (event.currentTarget.checked) next.delete(check);
                  else next.add(check);
                  setOmitted(next);
                }}
              />
              <Markdown inline source={check} />
            </label>
          ))}
          {tooLong && (
            <p className="hint" role="status">
              {C.testRequirementLimit(requirement.length, REQUIREMENT_MAX_CHARS)}
            </p>
          )}
          <div className="row">
            <Button size="sm" disabled={selected.length === 0 || tooLong} onClick={openTask}>
              {C.startTest}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
