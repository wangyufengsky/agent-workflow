import { DESIGN_INSTRUCTION_MAX_CHARS, type DesignDTO, type DesignStalenessDTO } from '@aw/shared';
import { useState } from 'react';
import { Button } from '../../components/button.tsx';
import { Drawer } from '../../components/drawer.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { DESIGN_WORKBENCH_COPY as C } from '../../copy/design-workbench.ts';
import styles from './design-incremental-drawer.module.css';
import { useIncrementalUpdateDesign } from './designs.queries.ts';

type Props = {
  design: DesignDTO;
  preview: DesignStalenessDTO;
  initialInstruction: string;
  close: () => void;
};

export function DesignIncrementalDrawer({ design, preview, initialInstruction, close }: Props) {
  const mutation = useIncrementalUpdateDesign();
  const [selected, setSelected] = useState(() => new Set(preview.affectedSectionIds));
  const [instruction, setInstruction] = useState(initialInstruction);
  const affected = design.sections.filter(({ id }) => preview.affectedSectionIds.includes(id));
  const allSelected = selected.size === affected.length;
  const moreFiles = preview.changedFilesCount - preview.changedPathsSample.length;
  const toggle = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const submit = () => {
    const text = instruction.trim();
    mutation.mutate(
      {
        id: design.id,
        sectionIds: affected.filter(({ id }) => selected.has(id)).map(({ id }) => id),
        ...(text === '' ? {} : { instruction: text }),
      },
      { onSuccess: close },
    );
  };
  return (
    <Drawer
      open
      title={C.incrementalUpdate}
      size="lg"
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close();
      }}
      footer={
        <>
          <Button disabled={mutation.isPending} onClick={close}>
            {COMMON_COPY.cancel}
          </Button>
          <Button variant="primary" disabled={selected.size === 0} pending={mutation.isPending} onClick={submit}>
            {C.incrementalSubmit(selected.size)}
          </Button>
        </>
      }
    >
      <div className={styles.content}>
        <div className={styles.target}>
          <strong>
            {preview.headSha === undefined ? C.incrementalLocalTarget : C.incrementalTarget(preview.headSha)}
          </strong>
          <span className="hint">{C.incrementalFreeze}</span>
        </div>
        <fieldset className={styles.checklist} disabled={mutation.isPending}>
          <legend>{C.incrementalSelection(selected.size, affected.length)}</legend>
          {affected.map(({ id, title }) => (
            <label key={id} className={styles.chapter} data-selected={selected.has(id)}>
              <input
                type="checkbox"
                checked={selected.has(id)}
                onChange={(event) => toggle(id, event.currentTarget.checked)}
              />
              {title}
            </label>
          ))}
        </fieldset>
        <section aria-label={C.incrementalFiles(preview.changedFilesCount)}>
          <h3>{C.incrementalFiles(preview.changedFilesCount)}</h3>
          <ul className={styles.files}>
            {preview.changedFilesSample?.map(({ relPath, kind }) => (
              <li key={relPath}>
                <code>{relPath}</code>
                <span className="hint">{C.incrementalFileKind[kind]}</span>
              </li>
            ))}
          </ul>
          {moreFiles > 0 && <p className="hint">{C.incrementalMoreFiles(moreFiles)}</p>}
        </section>
        <div className={`banner ${allSelected ? 'ok' : 'warn'} ${styles.strategy}`} role="status">
          <strong>{allSelected ? C.incrementalFull : C.incrementalPartial}</strong>
          <span>
            {allSelected
              ? C.incrementalFullDetail
              : selected.size === 0
                ? C.incrementalNone
                : C.incrementalPartialDetail}
          </span>
        </div>
        <label className="col">
          {C.incrementalInstruction}
          <textarea
            className="input"
            rows={3}
            maxLength={DESIGN_INSTRUCTION_MAX_CHARS}
            value={instruction}
            disabled={mutation.isPending}
            onChange={(event) => setInstruction(event.currentTarget.value)}
          />
        </label>
        <p className="hint">{C.incrementalPrevious}</p>
        {mutation.isError && <ErrorState error={mutation.error} />}
      </div>
    </Drawer>
  );
}
