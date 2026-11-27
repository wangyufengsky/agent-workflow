import { PermissionMode } from '@aw/shared';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/icon.tsx';
import { PERMISSIONS_COPY as C } from '../../copy/permissions.ts';
import styles from './permission-picker.module.css';

export function PermissionPicker({
  value,
  onChange,
  scope = 'conversation',
  disabled = false,
}: {
  value: PermissionMode;
  onChange(mode: PermissionMode): void;
  scope?: 'conversation' | 'task' | 'knowledge' | 'design';
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState({ left: 0, top: 0 });
  const anchor = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLFieldSetElement>(null),
    id = useId();
  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return;
    const place = () => {
      if (!anchor.current || !panel.current) return;
      const a = anchor.current.getBoundingClientRect(),
        p = panel.current.getBoundingClientRect();
      setPosition({
        left: Math.max(6, Math.min(innerWidth - p.width - 6, a.left)),
        top: a.top >= p.height + 8 ? a.top - p.height - 6 : Math.min(innerHeight - p.height - 6, a.bottom + 6),
      });
    };
    place();
    panel.current.querySelector<HTMLButtonElement>('[aria-pressed=true]')?.focus({ preventScroll: true });
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && !panel.current?.contains(e.target) && !anchor.current?.contains(e.target))
        setOpen(false);
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        anchor.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  const readonlyCopy = scope === 'knowledge' || scope === 'design' ? C[scope] : undefined;
  const label = scope === 'task' || scope === 'conversation' ? C[scope] : C[scope].label;
  const name = (mode: PermissionMode) =>
    scope === 'design' && mode === PermissionMode.Full ? C.design.fullName : C[mode].name;
  return (
    <>
      <button
        type="button"
        ref={anchor}
        className={styles.trigger}
        data-full={value === PermissionMode.Full}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`${label} · ${name(value)}`}
        onClick={() => setOpen(!open)}
      >
        {scope === 'task' || scope === 'design' ? `${label} · ` : ''}
        {name(value)}
      </button>
      {open &&
        createPortal(
          <fieldset id={id} ref={panel} className={styles.panel} style={position} aria-label={label}>
            <span className="hint">{scope === 'design' ? C.design.hint : C.question}</span>
            {Object.values(PermissionMode).map((m) => (
              <button
                key={m}
                type="button"
                disabled={disabled}
                aria-pressed={m === value}
                data-full={m === PermissionMode.Full}
                onClick={() => {
                  setOpen(false);
                  anchor.current?.focus();
                  if (value !== m) onChange(m);
                }}
              >
                <Icon name={m === PermissionMode.Full ? 'alert' : 'shield'} size="sm" />
                <span>
                  <strong>{name(m)}</strong>
                  <small>{readonlyCopy ? readonlyCopy[m] : C[m].description}</small>
                </span>
                {m === value && <Icon name="check" size="sm" />}
              </button>
            ))}
          </fieldset>,
          document.body,
        )}
    </>
  );
}
