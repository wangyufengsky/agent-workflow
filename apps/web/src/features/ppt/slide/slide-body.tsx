import { type SlideContent, SlideLayout } from '@aw/shared';
import { Emphasis } from './emphasis.tsx';
import styles from './slide.module.css';

/*
 * The ten layouts (23 §5.1), pure display on the 1280×720 canvas. Lists, cards, steps and cells are positional (the
 * content has no ids and is never reordered in place), so their keys are indexes. Text regions marked `data-fit`
 * shrink together when they overflow (slide-view.tsx).
 */

function Title({ text }: { text: string }) {
  return (
    <h2 className={styles.title} data-fit>
      <Emphasis text={text} />
    </h2>
  );
}

function Bullets({ items, className }: { items: readonly string[]; className?: string | undefined }) {
  return (
    <ul className={className ?? styles.bullets}>
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional, see the top of the file
        <li key={i}>
          <Emphasis text={item} />
        </li>
      ))}
    </ul>
  );
}

export function SlideBody({ content }: { content: SlideContent }) {
  switch (content.layout) {
    case SlideLayout.Cover:
      return (
        <div className={styles.cover}>
          <span className={styles.coverBar} />
          <h1 className={styles.coverTitle} data-fit>
            <Emphasis text={content.title} />
          </h1>
          {content.subtitle !== undefined && (
            <p className={styles.coverSubtitle}>
              <Emphasis text={content.subtitle} />
            </p>
          )}
        </div>
      );
    case SlideLayout.Section:
      return (
        <div className={styles.section}>
          <h1 className={styles.sectionTitle} data-fit>
            <Emphasis text={content.title} />
          </h1>
          {content.subtitle !== undefined && (
            <p className={styles.sectionSubtitle}>
              <Emphasis text={content.subtitle} />
            </p>
          )}
        </div>
      );
    case SlideLayout.Bullets:
      return (
        <div className={styles.frame}>
          <Title text={content.title} />
          <div className={styles.body} data-fit>
            <Bullets items={content.bullets} />
          </div>
        </div>
      );
    case SlideLayout.TwoColumn:
      return (
        <div className={styles.frame}>
          <Title text={content.title} />
          <div className={`${styles.body} ${styles.columns}`} data-fit>
            {[content.left, content.right].map((column, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: left and right
              <section key={i} className={styles.column}>
                <h3 className={styles.columnHeading}>
                  <Emphasis text={column.heading} />
                </h3>
                <Bullets items={column.bullets} className={styles.columnBullets} />
              </section>
            ))}
          </div>
        </div>
      );
    case SlideLayout.Cards:
      return (
        <div className={styles.frame}>
          <Title text={content.title} />
          <div className={`${styles.body} ${styles.cards}`} data-fit>
            {content.cards.map((card, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional, see the top of the file
              <section key={i} className={styles.card}>
                <h3 className={styles.cardHeading}>
                  <Emphasis text={card.heading} />
                </h3>
                <p className={styles.cardBody}>
                  <Emphasis text={card.body} />
                </p>
              </section>
            ))}
          </div>
        </div>
      );
    case SlideLayout.Steps:
      return (
        <div className={styles.frame}>
          <Title text={content.title} />
          <ol className={`${styles.body} ${styles.steps}`} data-fit>
            {content.steps.map((step, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional, see the top of the file
              <li key={i} className={styles.step}>
                <span className={styles.stepNo}>{i + 1}</span>
                <span className={styles.stepLabel}>
                  <Emphasis text={step.label} />
                </span>
                {step.detail !== undefined && (
                  <span className={styles.stepDetail}>
                    <Emphasis text={step.detail} />
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      );
    case SlideLayout.Stats:
      return (
        <div className={styles.frame}>
          <Title text={content.title} />
          <div className={`${styles.body} ${styles.stats}`} data-fit>
            {content.stats.map((stat, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional, see the top of the file
              <div key={i} className={styles.stat}>
                <span className={styles.statValue}>{stat.value}</span>
                <span className={styles.statLabel}>
                  <Emphasis text={stat.label} />
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    case SlideLayout.Table:
      return (
        <div className={styles.frame}>
          <Title text={content.title} />
          <div className={styles.body} data-fit>
            <table className={styles.table}>
              <thead>
                <tr>
                  {content.columns.map((column, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: positional, see the top of the file
                    <th key={i}>
                      <Emphasis text={column} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {content.rows.map((row, r) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional, see the top of the file
                  <tr key={r}>
                    {row.map((cell, c) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: positional, see the top of the file
                      <td key={c}>
                        <Emphasis text={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    case SlideLayout.Code:
      return (
        <div className={styles.frame}>
          <Title text={content.title} />
          <div className={`${styles.body} ${styles.codeBox}`} data-fit>
            <span className={styles.codeLanguage}>{content.language}</span>
            <pre className={styles.code}>{content.code}</pre>
          </div>
          {content.caption !== undefined && (
            <p className={styles.caption}>
              <Emphasis text={content.caption} />
            </p>
          )}
        </div>
      );
    case SlideLayout.Quote:
      return (
        <div className={styles.quoteFrame}>
          <span className={styles.quoteMark} aria-hidden="true">
            “
          </span>
          <blockquote className={styles.quote} data-fit>
            <Emphasis text={content.quote} />
          </blockquote>
          {content.attribution !== undefined && (
            <p className={styles.attribution}>
              <Emphasis text={content.attribution} />
            </p>
          )}
        </div>
      );
  }
}
