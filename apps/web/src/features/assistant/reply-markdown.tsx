import { useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { Components } from 'react-markdown';
import { ExternalLink } from '../../components/external-link.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { KNOWLEDGE_COPY } from '../../copy/knowledge.ts';
import styles from './assistant.module.css';
import { followAssistant } from './handoff.ts';

/** A knowledge answer cites as `[[n]](link)` (18 §4a): the mark reads as a small numbered chip. */
const CITATION = /^\[(\d+)\]$/;

/** A link to a page of the app (a knowledge answer's citations and conversation, 18 §4a): opens beside the panel. */
function InAppLink({ href, children }: { href: string; children: ReactNode }) {
  const navigate = useNavigate();
  const citation = typeof children === 'string' ? CITATION.exec(children)?.[1] : undefined;
  return (
    <a
      href={href}
      className={citation === undefined ? undefined : styles.cite}
      aria-label={citation === undefined ? undefined : KNOWLEDGE_COPY.citationMark(Number(citation))}
      onClick={(e) => {
        e.preventDefault();
        followAssistant(() => navigate({ href }));
      }}
    >
      {citation ?? children}
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
