import { FlowCanvas } from './flow-canvas.tsx';
import type { CanvasStep } from './task-node.tsx';

type Props = {
  steps: readonly CanvasStep[];
  /** The canvas region's accessible name. */
  label: string;
  selectedId?: string | undefined;
  onSelect?: (id: string) => void;
  onOpen?: (id: string) => void;
  finished?: boolean;
};

/** Read-only canvas of a task's progress or a plan (26 §1): select, double-click for details. */
export function ProgressCanvas({ steps, label, selectedId, onSelect, onOpen, finished }: Props) {
  return (
    <FlowCanvas
      steps={steps}
      label={label}
      selectedId={selectedId}
      onSelect={(id) => {
        if (id !== undefined) onSelect?.(id);
      }}
      onOpen={onOpen}
      finished={finished}
      testId="progress-canvas"
    />
  );
}
