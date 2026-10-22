import { createContext, useContext } from 'react';

/**
 * Edits an editable canvas offers (26 §5). Ids are canvas ids: step keys, or `START` / `END` for the pills. A `can*`
 * check that fails hides its button, so only edits with a valid result are shown (§5.4).
 */
export type CanvasEdit = {
  canInsert: (source: string, target: string) => boolean;
  canAddAfter: (id: string) => boolean;
  canAddParallel: (id: string) => boolean;
  canRemove: (id: string) => boolean;
  insert: (source: string, target: string) => void;
  addAfter: (id: string) => void;
  addParallel: (id: string) => void;
  remove: (id: string) => void;
};

/** What the canvas's nodes and edges need from the container: the edits and which step's + menu is open. */
export type CanvasEditState = {
  edit: CanvasEdit;
  /** Titles for the + / − buttons' accessible names. */
  titleOf: (id: string) => string;
  menuFor: string | undefined;
  setMenuFor: (id: string | undefined) => void;
};

export const CanvasEditContext = createContext<CanvasEditState | undefined>(undefined);

/** The edit state on an editable canvas; undefined on a read-only one. */
export function useCanvasEdit(): CanvasEditState | undefined {
  return useContext(CanvasEditContext);
}
