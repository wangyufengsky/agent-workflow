import { useState } from 'react';

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="seg">
      <legend className="sr">{label}</legend>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}

/** A positive integer, saved on blur or Enter; anything else falls back to the saved value. */
export function NumberSetting({ id, value, onCommit }: { id: string; value: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  const commit = () => {
    const n = Number(text);
    if (Number.isInteger(n) && n >= 1) {
      if (n !== value) onCommit(n);
    } else setText(String(value));
  };
  return (
    <input
      id={id}
      className="input narrow"
      type="number"
      min={1}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

/** Optional text (a path), saved on blur or Enter; empty means the default (null). */
export function TextSetting({
  id,
  value,
  onCommit,
}: {
  id: string;
  value: string | null;
  onCommit: (text: string | null) => void;
}) {
  const [text, setText] = useState(value ?? '');
  const commit = () => {
    const next = text.trim() === '' ? null : text.trim();
    if (next !== value) onCommit(next);
  };
  return (
    <input
      id={id}
      className="input mono"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}
