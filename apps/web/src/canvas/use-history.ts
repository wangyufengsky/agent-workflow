import { useEffect, useState } from 'react';

/** Undo steps an editor keeps (26 §5.5). */
const HISTORY_LIMIT = 50;

type State<T> = { past: T[]; present: T; future: T[]; mergeKey: string | undefined };

function undone<T>(s: State<T>): State<T> {
  const previous = s.past.at(-1);
  if (previous === undefined) return s;
  return { past: s.past.slice(0, -1), present: previous, future: [s.present, ...s.future], mergeKey: undefined };
}

function redone<T>(s: State<T>): State<T> {
  const [next, ...rest] = s.future;
  if (next === undefined) return s;
  return { past: [...s.past, s.present], present: next, future: rest, mergeKey: undefined };
}

export type History<T> = {
  value: T;
  /**
   * A new value; consecutive changes with the same `mergeKey` (typing into one field) are one undo step.
   */
  change: (next: T, mergeKey?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Undo steps since the editor opened: its unsaved changes. */
  changes: number;
};

/**
 * An editor's value with undo and redo (26 §5.5), also on ⌘Z / ⇧⌘Z (Ctrl on Windows and Linux) outside text fields,
 * where the field's own undo applies. The history lives as long as the editor.
 */
export function useHistory<T>(initial: T): History<T> {
  const [state, setState] = useState<State<T>>({ past: [], present: initial, future: [], mergeKey: undefined });
  const change = (next: T, mergeKey?: string) =>
    setState((s) =>
      mergeKey !== undefined && mergeKey === s.mergeKey
        ? { ...s, present: next }
        : { past: [...s.past, s.present].slice(-HISTORY_LIMIT), present: next, future: [], mergeKey },
    );
  const undo = () => setState(undone);
  const redo = () => setState(redone);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select') !== null) return;
      e.preventDefault();
      setState(e.shiftKey ? redone : undone);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return {
    value: state.present,
    change,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    changes: state.past.length,
  };
}
