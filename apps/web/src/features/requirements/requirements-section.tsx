import {
  isUnmet,
  RequirementConclusion,
  RequirementDisplayStatus,
  type TaskDetailDTO,
  type TaskRequirementsDTO,
  TaskStatus,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { REQUIREMENTS_COPY as C } from '../../copy/requirements.ts';
import { ReviseDialog } from '../task-detail/delivery-actions.tsx';
import { ChecklistEditor, draftsOf, isComplete, toInputs } from './checklist-editor.tsx';
import styles from './requirements.module.css';
import {
  requirementsQuery,
  useDecideRequirement,
  useReplaceRequirements,
  useReverifyRequirements,
} from './requirements.queries.ts';

type Item = TaskRequirementsDTO['items'][number];
type Decision =
  | typeof RequirementConclusion.Pass
  | typeof RequirementConclusion.Fail
  | typeof RequirementConclusion.Waive;

/**
 * The checklist on the result card (31 §2.3): required items not met first and open, the rest folded; each with its
 * state, who concluded it and why. In review the user decides items, sends one back, verifies again or edits.
 */
export function RequirementsSection({ task }: { task: TaskDetailDTO }) {
  const query = useQuery(requirementsQuery(task.id));
  const reverify = useReverifyRequirements();
  const [editing, setEditing] = useState(false);
  const [deciding, setDeciding] = useState<{ item: Item; conclusion: Decision }>();
  const [revising, setRevising] = useState<Item>();
  const review = task.status === TaskStatus.Review;
  if (query.isPending) return null;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const { revision, items } = query.data;
  if (revision === null) {
    return (
      <section className={styles.section} data-testid="requirements">
        <h3 className="sec-t">{C.section}</h3>
        <p className="hint">{C.none}</p>
      </section>
    );
  }
  const required = items.filter((i) => i.required);
  const unmet = required.filter((i) => isUnmet(i.status));
  // Unmet required items first: they are what the user has to look at.
  const ordered = [...unmet, ...items.filter((i) => !unmet.includes(i))];
  return (
    <section className={styles.section} data-testid="requirements">
      <div className={styles.summary}>
        <h3 className="sec-t grow">
          {C.section} · {C.summary(required.length, required.length - unmet.length, unmet.length)}
        </h3>
        {review && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              {C.edit}
            </Button>
            <Button size="sm" icon="refresh" pending={reverify.isPending} onClick={() => reverify.mutate(task.id)}>
              {C.reverify}
            </Button>
          </>
        )}
      </div>
      {reverify.isError && <ErrorState error={reverify.error} />}
      <ul className={styles.items}>
        {ordered.map((item) => (
          <li key={item.id}>
            <details className={styles.item} open={unmet.includes(item)} data-unmet={unmet.includes(item) || undefined}>
              <summary>
                <span className={styles.status} data-status={item.status}>
                  {C.statusLabel[item.status]}
                </span>
                <span className={styles.itemTitle}>{item.title}</span>
                {!item.required && <span className="hint">{C.optional}</span>}
                <span className="hint">{C.verificationLabel[item.verification.kind]}</span>
              </summary>
              <div className={styles.itemBody}>
                <span className="hint">{C.expectedIs(item.expected)}</span>
                {item.latest !== null && (
                  <>
                    <span className="hint">
                      {C.sourceLabel[item.latest.source]} · {new Date(item.latest.createdAt).toLocaleString()}
                    </span>
                    {item.status === RequirementDisplayStatus.Stale && <span className="hint">{C.staleHint}</span>}
                    {item.latest.note !== '' && <Markdown source={item.latest.note} />}
                    {item.latest.output !== null && item.latest.output !== '' && (
                      <>
                        <span className="hint">{C.output}</span>
                        <pre className={`mono ${styles.output}`}>{item.latest.output}</pre>
                      </>
                    )}
                  </>
                )}
                {review && (
                  <div className={styles.actions}>
                    <Button size="sm" onClick={() => setDeciding({ item, conclusion: RequirementConclusion.Pass })}>
                      {C.pass}
                    </Button>
                    <Button size="sm" onClick={() => setDeciding({ item, conclusion: RequirementConclusion.Fail })}>
                      {C.fail}
                    </Button>
                    <Button size="sm" onClick={() => setDeciding({ item, conclusion: RequirementConclusion.Waive })}>
                      {C.waive}
                    </Button>
                    {isUnmet(item.status) && (
                      <Button size="sm" variant="ghost" onClick={() => setRevising(item)}>
                        {C.reviseItem}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
      {deciding !== undefined && <DecideDialog taskId={task.id} {...deciding} onClose={() => setDeciding(undefined)} />}
      {editing && <EditDialog taskId={task.id} items={items} onClose={() => setEditing(false)} />}
      {revising !== undefined && (
        <ReviseDialog
          task={task}
          open
          initialFeedback={C.reviseItemText(revising.title, revising.expected, revising.latest?.note ?? '')}
          onClose={() => setRevising(undefined)}
        />
      )}
    </section>
  );
}

/** The user's own conclusion on one item; accepting it as not done needs a reason (31 §2.3). */
function DecideDialog({
  taskId,
  item,
  conclusion,
  onClose,
}: {
  taskId: string;
  item: Item;
  conclusion: Decision;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const decide = useDecideRequirement(taskId);
  const waive = conclusion === RequirementConclusion.Waive;
  const label = { pass: C.pass, fail: C.fail, waive: C.waive }[conclusion];
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={C.decideTitle(item.title)}
      description={C.expectedIs(item.expected)}
      footer={
        <Button
          variant="primary"
          pending={decide.isPending}
          disabled={waive && note.trim() === ''}
          onClick={() => decide.mutate({ itemId: item.id, conclusion, note: note.trim() }, { onSuccess: onClose })}
        >
          {label}
        </Button>
      }
    >
      <textarea
        className="textarea"
        rows={3}
        aria-label={waive ? C.waiveReason : C.note}
        placeholder={waive ? C.waiveReason : C.notePlaceholder}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {decide.isError && <ErrorState error={decide.error} />}
    </Dialog>
  );
}

/** Editing the checklist in review saves a new version; its earlier conclusions become stale (31 §2.1). */
function EditDialog({ taskId, items, onClose }: { taskId: string; items: readonly Item[]; onClose: () => void }) {
  const [drafts, setDrafts] = useState(() => draftsOf(items));
  const replace = useReplaceRequirements(taskId);
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={C.editTitle}
      description={C.editHint}
      footer={
        <Button
          variant="primary"
          pending={replace.isPending}
          disabled={drafts.length === 0 || !isComplete(drafts)}
          onClick={() => replace.mutate(toInputs(drafts), { onSuccess: onClose })}
        >
          {C.save}
        </Button>
      }
    >
      <ChecklistEditor drafts={drafts} onChange={setDrafts} />
      {replace.isError && <ErrorState error={replace.error} />}
    </Dialog>
  );
}
