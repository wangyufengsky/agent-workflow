import {
  DESIGN_INSTRUCTION_MAX_CHARS,
  DESIGN_MAX_SECTIONS,
  DESIGN_TITLE_MAX_CHARS,
  type DesignDTO,
  type DesignOutlineSection,
  type DesignSectionDTO,
  DesignSectionKind,
  designSectionKindSchema,
} from '@aw/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { DESIGN_WORKBENCH_COPY } from '../../copy/design-workbench.ts';
import { DESIGNS_COPY as C, DESIGN_SECTION_LABEL, DESIGN_STATUS_LABEL } from '../../copy/designs.ts';
import { AttemptView } from '../attempts/attempt-view.tsx';
import { DeleteDesignDialog } from './design-workbench-dialogs.tsx';
import styles from './designs.module.css';
import { useGenerateDesign, useReviseDesignOutline, useStopDesign, useUpdateDesignOutline } from './designs.queries.ts';

function outlineEntry(section: DesignSectionDTO): DesignOutlineSection {
  return {
    id: section.id,
    kind: section.kind,
    title: section.title,
    scopePaths: section.scopePaths,
    selected: section.selected,
  };
}

function ChapterFields({
  section,
  patch,
  disabled,
}: {
  section: DesignSectionDTO;
  patch(value: Partial<DesignOutlineSection>): void;
  disabled: boolean;
}) {
  const [title, setTitle] = useState(section.title);
  const originalScope = section.scopePaths.join(', ');
  const [scope, setScope] = useState(originalScope);
  return (
    <div className={styles.chapterFields}>
      <input
        className="input"
        aria-label={C.chapter}
        value={title}
        maxLength={DESIGN_TITLE_MAX_CHARS}
        disabled={disabled}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => {
          const next = title.trim();
          if (next === '') setTitle(section.title);
          else if (section.title !== next) patch({ title: next });
        }}
      />
      <select
        className="select"
        aria-label={C.chapterType}
        value={section.kind}
        disabled={disabled}
        onChange={(event) => patch({ kind: designSectionKindSchema.parse(event.target.value) })}
      >
        {Object.values(DesignSectionKind).map((kind) => (
          <option key={kind} value={kind}>
            {DESIGN_SECTION_LABEL[kind]}
          </option>
        ))}
      </select>
      <input
        className="input mono"
        value={scope}
        aria-label={C.chapterScope}
        placeholder={C.scopePlaceholder}
        disabled={disabled}
        onChange={(event) => setScope(event.target.value)}
        onBlur={() => {
          const paths = scope
            .split(',')
            .map((path) => path.trim())
            .filter(Boolean);
          if (paths.join(', ') !== originalScope) patch({ scopePaths: paths });
        }}
      />
    </div>
  );
}

function Snapshot({ design }: { design: DesignDTO }) {
  const snapshot = design.sourceSnapshot;
  const stack = snapshot.techStack.join(' · ');
  return (
    <section className="card pad col">
      <div className="row wrap">
        <h2 className={styles.sectionTitle}>{C.scanTitle}</h2>
        <span className="hint">{stack === '' ? C.genericStack : C.detected(stack)}</span>
      </div>
      <div>{C.scanTotals(snapshot.analyzableCount, snapshot.skippedCount)}</div>
      {snapshot.skippedCount > 0 && (
        <details>
          <summary>{C.scanDetails}</summary>
          <ul className={styles.reasons}>
            {Object.entries(snapshot.skippedReasons).map(([reason, count]) => (
              <li key={reason}>
                {C.scanReasons[reason] ?? reason} · {count}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export function DesignOutline({ design, model }: { design: DesignDTO; model: string | null }) {
  const update = useUpdateDesignOutline();
  const optimize = useReviseDesignOutline();
  const generate = useGenerateDesign();
  const stop = useStopDesign();
  const [deleting, setDeleting] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [instruction, setInstruction] = useState('');
  const latest = design.runs.at(-1);
  const active = design.activeRunId !== null;
  const readOnly = design.projectId === null;
  const locked = readOnly || active || update.isPending || optimize.isPending || generate.isPending;
  const canGenerate = design.sections.some((section) => section.selected);
  const current = design.sections.map(outlineEntry);
  const save = (sections: DesignOutlineSection[]) => update.mutate({ id: design.id, sections });
  const patch = (id: string, change: Partial<DesignOutlineSection>) =>
    save(current.map((section) => (section.id !== id ? section : { ...section, ...change })));
  const move = (index: number, offset: number) => {
    const moving = current[index];
    if (moving === undefined) return;
    const without = current.filter((_, i) => i !== index);
    without.splice(index + offset, 0, moving);
    save(without);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div className="grow">
          <h1 className="title">{design.title}</h1>
          <p className="lede">{C.outlineHint}</p>
        </div>
        <span className="badge">{DESIGN_STATUS_LABEL[design.status]}</span>
        <Button
          icon="trash"
          variant="danger"
          disabled={active || update.isPending || optimize.isPending || generate.isPending}
          onClick={() => setDeleting(true)}
        >
          {DESIGN_WORKBENCH_COPY.remove}
        </Button>
        <Link to={ROUTES.designs} search={{ projectId: design.projectId ?? undefined }} className="btn">
          {C.back}
        </Link>
      </header>
      <Snapshot design={design} />
      {readOnly && <p className="hint">{C.absentProject}</p>}
      <section className={`card pad col ${styles.outline}`}>
        <div className="row wrap">
          <h2 className={`grow ${styles.sectionTitle}`}>{C.outline}</h2>
          <Button
            size="sm"
            icon="plus"
            disabled={locked || current.length >= DESIGN_MAX_SECTIONS}
            onClick={() =>
              save([
                ...current,
                { kind: DesignSectionKind.Custom, title: C.untitledChapter, scopePaths: [], selected: true },
              ])
            }
          >
            {C.newChapter}
          </Button>
        </div>
        <ol className={styles.chapters}>
          {design.sections.map((section, index) => (
            <li key={section.id} className={styles.chapterRow}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={section.selected}
                  disabled={locked}
                  aria-label={section.title}
                  onChange={(event) => patch(section.id, { selected: event.target.checked })}
                />
                <span aria-hidden="true" className="mono">
                  {index + 1}
                </span>
              </label>
              <ChapterFields
                key={JSON.stringify([section.title, section.scopePaths])}
                section={section}
                disabled={locked}
                patch={(changes) => patch(section.id, changes)}
              />
              <div className="row wrap">
                <Button size="sm" disabled={locked || index === 0} onClick={() => move(index, -1)}>
                  {C.up}
                </Button>
                <Button size="sm" disabled={locked || index + 1 === current.length} onClick={() => move(index, 1)}>
                  {C.down}
                </Button>
                <Button
                  size="sm"
                  disabled={locked || current.length === 1}
                  onClick={() => save(current.filter((item) => item.id !== section.id))}
                >
                  {C.removeChapter}
                </Button>
              </div>
            </li>
          ))}
        </ol>
        {update.isPending && (
          <p className="hint" role="status">
            {C.saving}
          </p>
        )}
        {update.isError && (
          <ErrorState
            error={update.error}
            onRetry={() => {
              if (update.variables !== undefined) update.mutate(update.variables);
            }}
          />
        )}
        {generate.isError && <ErrorState error={generate.error} />}
        {stop.isError && <ErrorState error={stop.error} />}
        <div className={`row wrap ${styles.formFooter}`}>
          <Button
            disabled={locked}
            onClick={() => {
              optimize.reset();
              setInstruction('');
              setOptimizing(true);
            }}
          >
            {C.optimize}
          </Button>
          <span className="grow" />
          {!canGenerate && <span className="hint">{C.atLeastOne}</span>}
          <Button
            variant="primary"
            disabled={locked || !canGenerate || update.isError}
            pending={generate.isPending}
            onClick={() => generate.mutate({ id: design.id, model })}
          >
            {C.generate}
          </Button>
        </div>
      </section>
      {latest !== undefined && (
        <div className="col">
          {latest.attempt.error !== null && <ErrorState error={latest.attempt.error} />}
          {active && (
            <div className="banner" role="status">
              <span className="grow">{DESIGN_STATUS_LABEL[design.status]}</span>
              {latest.awaitingInput && (
                <Link className="link" to={ROUTES.inbox}>
                  {C.permissions}
                </Link>
              )}
              <Button size="sm" icon="stop" pending={stop.isPending} onClick={() => stop.mutate(design.id)}>
                {C.stop}
              </Button>
            </div>
          )}
          <AttemptView attemptId={latest.attempt.id} canAbort={false} foldOnEnd />
        </div>
      )}
      {deleting && <DeleteDesignDialog design={design} close={() => setDeleting(false)} />}
      {optimizing && (
        <Dialog
          open
          title={C.optimize}
          description={C.optimizeHint}
          onOpenChange={(open) => {
            if (!open && !optimize.isPending) setOptimizing(false);
          }}
          footer={
            <>
              <Button disabled={optimize.isPending} onClick={() => setOptimizing(false)}>
                {C.cancel}
              </Button>
              <Button
                variant="primary"
                pending={optimize.isPending}
                onClick={() =>
                  optimize.mutate(
                    { id: design.id, model, instruction: instruction.trim() || undefined },
                    {
                      onSuccess: () => setOptimizing(false),
                    },
                  )
                }
              >
                {C.optimize}
              </Button>
            </>
          }
        >
          <textarea
            className="textarea"
            aria-label={C.optimizeInstruction}
            placeholder={C.optimizeInstruction}
            rows={4}
            maxLength={DESIGN_INSTRUCTION_MAX_CHARS}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
          {optimize.isError && <ErrorState error={optimize.error} />}
        </Dialog>
      )}
    </div>
  );
}
