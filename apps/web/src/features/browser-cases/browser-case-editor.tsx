import {
  type BrowserCase,
  type BrowserCaseInput,
  type BrowserCaseStep,
  browserCaseActionSchema,
  browserCaseAssertionSchema,
  browserCaseInputSchema,
  createBrowserCaseOp,
  updateBrowserCaseOp,
} from '@aw/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { BROWSER_CASE_COPY as C } from '../../copy/browser-cases.ts';
import { BROWSER_TEST_COPY as T } from '../../copy/tasks.ts';
import { browserWriteLines, parseBrowserWriteLines } from './browser-case-scope.tsx';

export const browserCasesKey = (projectId: string) => ['browser-cases', projectId] as const;

type StepDraft = {
  key: string;
  title: string;
  action: BrowserCaseStep['action']['kind'];
  actionSelector: string;
  actionValue: string;
  expect: BrowserCaseStep['expect']['kind'];
  expectSelector: string;
  expectedValue: string;
};

const draftOf = (step?: BrowserCaseStep): StepDraft => ({
  key: crypto.randomUUID(),
  title: step?.title ?? '',
  action: step?.action.kind ?? 'click',
  actionSelector: step !== undefined && 'selector' in step.action ? step.action.selector : '',
  actionValue: step !== undefined && 'value' in step.action ? step.action.value : '',
  expect: step?.expect.kind ?? 'text',
  expectSelector: step !== undefined && 'selector' in step.expect ? step.expect.selector : '',
  expectedValue: step !== undefined && 'value' in step.expect ? step.expect.value : '',
});

function StepFields({ step, onChange }: { step: StepDraft; onChange: (value: StepDraft) => void }) {
  return (
    <div className="col">
      <label className="col">
        {C.stepName}
        <input
          className="input"
          value={step.title}
          onChange={(event) => onChange({ ...step, title: event.target.value })}
        />
      </label>
      <label className="col">
        {C.action}
        <select
          className="input"
          value={step.action}
          onChange={(event) =>
            onChange({
              ...step,
              action:
                browserCaseActionSchema.options.find((item) => item.shape.kind.value === event.target.value)?.shape.kind
                  .value ?? step.action,
            })
          }
        >
          {Object.entries(C.actions).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
      </label>
      {step.action !== 'check' && (
        <label className="col">
          {C.actionSelector}
          <input
            className="input mono"
            value={step.actionSelector}
            placeholder={C.selectorExample}
            onChange={(event) => onChange({ ...step, actionSelector: event.target.value })}
          />
        </label>
      )}
      {(step.action === 'fill' || step.action === 'select') && (
        <label className="col">
          {C.actionValue}
          <input
            className="input"
            value={step.actionValue}
            onChange={(event) => onChange({ ...step, actionValue: event.target.value })}
          />
        </label>
      )}
      <label className="col">
        {C.assertion}
        <select
          className="input"
          value={step.expect}
          onChange={(event) =>
            onChange({
              ...step,
              expect:
                browserCaseAssertionSchema.options.find((item) => item.shape.kind.value === event.target.value)?.shape
                  .kind.value ?? step.expect,
            })
          }
        >
          {Object.entries(C.assertions).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
      </label>
      {step.expect !== 'path' && (
        <label className="col">
          {C.assertSelector}
          <input
            className="input mono"
            value={step.expectSelector}
            placeholder={C.selectorExample}
            onChange={(event) => onChange({ ...step, expectSelector: event.target.value })}
          />
        </label>
      )}
      {step.expect !== 'visible' && (
        <label className="col">
          {C.expectedValue}
          <input
            className="input"
            value={step.expectedValue}
            onChange={(event) => onChange({ ...step, expectedValue: event.target.value })}
          />
        </label>
      )}
    </div>
  );
}

export function BrowserCaseEditor({
  projectId,
  initial,
  test,
  onClose,
}: {
  projectId: string;
  initial?: Pick<BrowserCaseInput, 'name' | 'scope'>;
  test?: BrowserCase;
  onClose: () => void;
}) {
  const form = useId();
  const qc = useQueryClient();
  const source = test ?? initial;
  const [name, setName] = useState(source?.name ?? '');
  const [target, setTarget] = useState(source?.scope.target ?? '');
  const [writes, setWrites] = useState(source === undefined ? '' : browserWriteLines(source.scope));
  const [steps, setSteps] = useState(() => test?.steps.map(draftOf) ?? [draftOf()]);
  const input = browserCaseInputSchema.safeParse({
    name,
    scope: { target, writes: parseBrowserWriteLines(writes) },
    steps: steps.map((step) => ({
      title: step.title,
      action: { kind: step.action, selector: step.actionSelector, value: step.actionValue },
      expect: { kind: step.expect, selector: step.expectSelector, value: step.expectedValue },
    })),
  });
  const save = useMutation({
    mutationFn: (definition: BrowserCaseInput) =>
      test === undefined
        ? callOperation(createBrowserCaseOp, { projectId, definition })
        : callOperation(updateBrowserCaseOp, { projectId, caseId: test.caseId, revision: test.revision, definition }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: browserCasesKey(projectId) });
      onClose();
    },
  });

  function moveStep(index: number, delta: number) {
    setSteps((items) => {
      const next = [...items];
      const [step] = next.splice(index, 1);
      if (step !== undefined) next.splice(index + delta, 0, step);
      return next;
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={test === undefined ? C.newCase : C.edit}
      footer={
        <Button type="submit" form={form} variant="primary" pending={save.isPending} disabled={!input.success}>
          {C.save}
        </Button>
      }
    >
      <form
        id={form}
        className="col"
        onSubmit={(event) => {
          event.preventDefault();
          if (input.success) save.mutate(input.data);
        }}
      >
        <label className="col">
          {C.name}
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="col">
          {T.target}
          <input
            className="input"
            value={target}
            placeholder={T.targetPlaceholder}
            onChange={(event) => setTarget(event.target.value)}
          />
        </label>
        <label className="col">
          {T.writes}
          <textarea
            className="input mono"
            rows={2}
            value={writes}
            placeholder={T.writesPlaceholder}
            onChange={(event) => setWrites(event.target.value)}
          />
          <span className="hint">{T.writesHint}</span>
        </label>
        {steps.map((step, index) => (
          <fieldset key={step.key} className="col">
            <legend>{C.step(index + 1)}</legend>
            <StepFields
              step={step}
              onChange={(value) => setSteps((items) => items.map((item) => (item.key === step.key ? value : item)))}
            />
            <div className="row">
              <Button type="button" size="sm" disabled={index === 0} onClick={() => moveStep(index, -1)}>
                {C.moveUp}
              </Button>
              <Button type="button" size="sm" disabled={index === steps.length - 1} onClick={() => moveStep(index, 1)}>
                {C.moveDown}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={steps.length === 1}
                onClick={() => setSteps((items) => items.filter((item) => item.key !== step.key))}
              >
                {C.removeStep}
              </Button>
            </div>
          </fieldset>
        ))}
        <Button
          type="button"
          size="sm"
          disabled={steps.length === 30}
          onClick={() => setSteps((items) => [...items, draftOf()])}
        >
          {C.addStep}
        </Button>
        {save.isError && <ErrorState error={save.error} />}
      </form>
    </Dialog>
  );
}
