import { MARK } from '../brand/mark.ts';
import { HOME_COPY as C } from '../copy/home.ts';

/** The nodes of the mark (brand/mark.ts); `scale` multiplies its 124×24 size. */
export function MarkNodes({ scale = 1, className }: { scale?: number; className?: string | undefined }) {
  return (
    <svg
      className={className}
      width={MARK.width * scale}
      height={MARK.height * scale}
      viewBox={`0 0 ${MARK.width} ${MARK.height}`}
      aria-hidden="true"
    >
      {MARK.lines.map((d) => (
        <path key={d} d={d} data-part="line" />
      ))}
      {MARK.nodes.map((cx, i) => (
        <circle
          key={cx}
          cx={cx}
          cy={MARK.height / 2}
          r={MARK.radius}
          data-part="node"
          data-filled={i === 1 || undefined}
        />
      ))}
    </svg>
  );
}

/** 「Everything is a *Workflow.*」 */
export function Wordmark({ className }: { className?: string | undefined }) {
  return (
    <h1 className={className}>
      {C.mark.lead} <em>{C.mark.emphasis}</em>
    </h1>
  );
}
