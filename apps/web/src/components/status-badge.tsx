import { StatusTone } from '@aw/shared';

/** Coloured status pill; text always accompanies the colour. Tones map to `.st-<tone>` in base.css. */
export function StatusBadge({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span className={`badge st-${tone}`}>
      <span className={tone === StatusTone.Run ? 'dot pulse' : 'dot'} aria-hidden="true" />
      {label}
    </span>
  );
}
