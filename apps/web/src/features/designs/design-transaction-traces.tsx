import type { DesignDTO, DesignTransaction } from '@aw/shared';
import { useId } from 'react';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import siteCopy from '../../copy/design-site.json';
import { type ContentContext, Syntax } from './design-content.tsx';
import { fileTarget, type ReadingTarget } from './design-reading.ts';

type Trace = NonNullable<DesignTransaction['fields']>[number];
type Source = ContentContext['source'];
export type TransactionLocation = { path: string; range?: { start: number; end: number } };

export function TransactionTraces({
  traces,
  initial,
  empty,
  titles,
  choose,
  source,
}: {
  traces: readonly Trace[];
  initial: number;
  empty: string;
  titles: ReadonlyMap<string, string>;
  choose: (id: string) => void;
  source: Source;
}) {
  const group = useId();
  if (traces.length === 0) return <p className="tx-empty">{empty}</p>;
  return (
    <div className="tx-traces">
      {traces.map((trace, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: traces retain submission order and may have identical names
        <details key={index} name={group} open={initial === index} className="tx-trace">
          <summary>{trace.name}</summary>
          <div>
            <div className="tx-chain">
              {trace.steps.map((id, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a field may revisit the same step
                <span key={i}>
                  {i > 0 && <span aria-hidden="true"> → </span>}
                  <button type="button" onClick={() => choose(id)}>
                    {titles.get(id)}
                  </button>
                </span>
              ))}
            </div>
            <p>{trace.description}</p>
            <div className="tx-links">
              {trace.evidence.map((entry, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: evidence references retain their source order
                <div key={i}>
                  {entry.evidenceClass === 'static'
                    ? source(entry.relPath, entry.lineStart, entry.lineEnd)
                    : `${siteCopy.inference} · ${entry.rationale}`}
                </div>
              ))}
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

export function TransactionSourceDialog({
  design,
  location,
  sectionId,
  onNavigate,
  close,
}: {
  design: DesignDTO;
  location: TransactionLocation;
  sectionId: string;
  onNavigate: (target: ReadingTarget) => void;
  close: () => void;
}) {
  const { path, range } = location;
  const file = design.files.find((file) => file.relPath === path);
  const excerpts = design.sections.flatMap((section) =>
    section.selected
      ? (section.blocks ?? []).flatMap((block) =>
          block.type === 'code' &&
          block.relPath === path &&
          (range === undefined || (block.lineStart <= range.end && block.lineEnd >= range.start))
            ? [block]
            : [],
        )
      : [],
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={path}
      description={siteCopy.sourceExcerpts}
      footer={
        <>
          {file && (
            <Button
              onClick={() => {
                close();
                onNavigate(fileTarget(file, sectionId, undefined, range));
              }}
            >
              {siteCopy.transactions.source}
            </Button>
          )}
          <Button onClick={close}>{siteCopy.transactions.closeSource}</Button>
        </>
      }
    >
      <div className="tx-source-dialog">
        {excerpts.length === 0 ? (
          <p className="hint">{siteCopy.transactions.noExcerpt}</p>
        ) : (
          excerpts.map((block, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: different chapters may cite the same range
            <Syntax key={i} path={path} source={block.code} start={block.lineStart} selection={range} />
          ))
        )}
      </div>
    </Dialog>
  );
}
