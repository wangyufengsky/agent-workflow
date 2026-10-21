import { useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { Components } from 'react-markdown';
import { ExternalLink } from '../../components/external-link.tsx';
import { Markdown } from '../../components/markdown.tsx';

/** A link to a page of the app (a knowledge answer's citations and conversation, 18 §4a): opens beside the panel. */
function InAppLink({ href, children }: { href: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        void navigate({ href });
      }}
    >
      {children}
    </a>
  );
}

const components: Components = {
  a: ({ href, children }) => {
    if (href === undefined) return children;
    return href.startsWith('/') ? (
      <InAppLink href={href}>{children}</InAppLink>
    ) : (
      <ExternalLink href={href}>{children}</ExternalLink>
    );
  },
};

/** The assistant's Markdown: app paths navigate in the app (the panel stays open), other links open the browser. */
export function ReplyMarkdown({ source }: { source: string }) {
  return <Markdown source={source} components={components} />;
}
