import { createSkillOp, USER_SKILL_MAX_CHARS, updateSkillOp } from '@aw/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { SKILLS_COPY as C } from '../../copy/skills.ts';
import styles from './skills.module.css';

export type SkillDraft = { id?: string; source: string; title: string; assistant?: boolean };
export const skillTemplate = '---\nname: my-skill\ndescription: \n---\n\n';

export function SkillEditor({
  draft,
  onClose,
  onSaved,
}: {
  draft: SkillDraft;
  onClose(): void;
  onSaved(id: string): void;
}) {
  const [source, setSource] = useState(draft.source);
  const sourceId = useId();
  const cache = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      draft.id === undefined
        ? callOperation(createSkillOp, { source })
        : callOperation(updateSkillOp, { id: draft.id, source }),
    onSuccess: async ({ id }) => {
      await cache.invalidateQueries({ queryKey: queryKeys.skills });
      onSaved(id);
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
      title={draft.title}
      description={draft.assistant === true ? C.draftHint : C.sourceHint}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            {C.cancel}
          </Button>
          <Button
            variant="primary"
            onClick={() => save.mutate()}
            pending={save.isPending}
            disabled={source.trim() === '' || source.length > USER_SKILL_MAX_CHARS}
          >
            {C.save}
          </Button>
        </>
      }
    >
      <div className="field">
        <label className="label" htmlFor={sourceId}>
          {C.source}
        </label>
        <textarea
          id={sourceId}
          className={`input ${styles.source}`}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          spellCheck={false}
        />
      </div>
      {source.length > USER_SKILL_MAX_CHARS && (
        <p role="alert" className="hint">
          {C.tooLong(USER_SKILL_MAX_CHARS)}
        </p>
      )}
      {save.isError && <ErrorState error={save.error} />}
    </Dialog>
  );
}
