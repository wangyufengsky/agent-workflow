/** A view transition's duration, or 0 when the user asked for reduced motion (26 §7). */
export function motionMs(ms: number): number {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms;
}

/** Class names joined, the absent ones left out (CSS module lookups are typed as possibly undefined). */
export function classNames(...names: Array<string | false | undefined>): string {
  return names.filter(Boolean).join(' ');
}
