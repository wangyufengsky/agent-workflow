import type { ReactNode } from 'react';

/** A web link. In the app it opens in the system browser (03 §9: the window never navigates away). */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        if (window.aw === undefined) return;
        e.preventDefault();
        void window.aw.openExternal(href);
      }}
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  );
}
