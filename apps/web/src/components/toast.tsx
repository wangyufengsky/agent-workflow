import { StatusTone } from '@aw/shared';
import { create } from 'zustand';
import { Icon } from './icon.tsx';

const TOAST_DURATION_MS = 4000;

type ToastItem = { id: number; message: string; tone: typeof StatusTone.Ok | typeof StatusTone.Danger };

const useToasts = create<{ items: ToastItem[] }>(() => ({ items: [] }));
let nextId = 1;

/** Shows a short confirmation or failure message at the bottom of the window. */
export function toast(message: string, tone: ToastItem['tone'] = StatusTone.Ok): void {
  const id = nextId++;
  useToasts.setState((s) => ({ items: [...s.items, { id, message, tone }] }));
  setTimeout(() => useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) })), TOAST_DURATION_MS);
}

export function ToastHost() {
  const items = useToasts((s) => s.items);
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast">
          <span className={t.tone === StatusTone.Ok ? 'st-ok badge' : 'st-danger badge'}>
            <Icon name={t.tone === StatusTone.Ok ? 'check' : 'alert'} size="sm" />
          </span>
          {t.message}
        </div>
      ))}
    </div>
  );
}
