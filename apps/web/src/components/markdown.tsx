import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink } from './external-link.tsx';
import styles from './markdown.module.css';

const links: Components = {
  a: ({ href, children }) => (href === undefined ? children : <ExternalLink href={href}>{children}</ExternalLink>),
};

/** One line of text (an assumption, a file's description): emphasis, code and links; anything else keeps its text. */
const INLINE_ELEMENTS = ['p', 'strong', 'em', 'del', 'code', 'a'];
const inlineComponents: Components = { ...links, p: ({ children }) => children };

/**
 * Model-written Markdown (summaries, reports, answers, questions; 14 §2.2). Raw HTML is not rendered, so the text
 * cannot inject markup; links open in the system browser. `components` replaces how elements render (the knowledge
 * answer's citation marks, 18 §2.1); `inline` renders inside a line of other text.
 */
export function Markdown({
  source,
  components,
  inline = false,
}: {
  source: string;
  components?: Components;
  inline?: boolean;
}) {
  if (inline) {
    return (
      <span className={styles.inline}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          allowedElements={INLINE_ELEMENTS}
          unwrapDisallowed
          components={{ ...inlineComponents, ...components }}
        >
          {source}
        </ReactMarkdown>
      </span>
    );
  }
  return (
    <div className={styles.markdown}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ ...links, ...components }}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
