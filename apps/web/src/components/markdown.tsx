import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './markdown.module.css';

/** Model-written Markdown (summaries, reports). Raw HTML is not rendered, so the text cannot inject markup. */
export function Markdown({ source }: { source: string }) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
    </div>
  );
}
