import { Button } from '../components/button.tsx';
import { PLAN_EDITOR_COPY as C } from '../copy/plan-editor.ts';
import type { History } from './use-history.ts';

/** Undo, redo and 添加步骤: the start of every plan editor's toolbar. */
export function EditTools({
  history,
  addStep,
}: {
  history: Pick<History<unknown>, 'undo' | 'redo' | 'canUndo' | 'canRedo'>;
  /** Undefined when no step can be added with a valid result (26 §5.4): the button is disabled. */
  addStep: (() => void) | undefined;
}) {
  return (
    <>
      <Button variant="ghost" size="sm" icon="undo" disabled={!history.canUndo} onClick={history.undo}>
        {C.undo}
      </Button>
      <Button variant="ghost" size="sm" icon="redo" disabled={!history.canRedo} onClick={history.redo}>
        {C.redo}
      </Button>
      <Button size="sm" icon="plus" disabled={addStep === undefined} onClick={addStep}>
        {C.addStep}
      </Button>
    </>
  );
}
