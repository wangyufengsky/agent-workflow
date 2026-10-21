/**
 * A file system path on one line that keeps its end: when it does not fit, the leading directories give way to an
 * ellipsis and the last segment stays readable (`/Users/…/order-service`). The full path is in the hover hint.
 */
export function PathText({ path, className }: { path: string; className?: string }) {
  const cut = Math.max(path.lastIndexOf('/', path.length - 2), path.lastIndexOf('\\', path.length - 2)) + 1;
  return (
    <span className={className === undefined ? 'path' : `path ${className}`} title={path}>
      <span className="path-head">{path.slice(0, cut)}</span>
      <span className="path-tail">{path.slice(cut)}</span>
    </span>
  );
}
