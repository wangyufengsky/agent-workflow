import { GitTreeEntryType } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { Tabs } from '../../components/tabs.tsx';
import { BATCHES_COPY as C } from '../../copy/batches.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { gitTreeQuery } from '../git/git.queries.ts';
import styles from './batches.module.css';
import { parseTargets, toggleTarget } from './targets.ts';

/** Directories and files of the project at its base branch, each one a target to tick; directories end with `/`. */
function TreePicker({
  projectId,
  refName,
  targets,
  onToggle,
}: {
  projectId: string;
  refName: string;
  targets: readonly string[];
  onToggle: (target: string) => void;
}) {
  const [dir, setDir] = useState('');
  const tree = useQuery(gitTreeQuery(projectId, refName, dir));
  const parts = dir === '' ? [] : dir.split('/');
  return (
    <div className="col">
      <nav className={styles.crumbs} aria-label={C.targets}>
        <button type="button" className={styles.crumb} onClick={() => setDir('')}>
          {C.root}
        </button>
        {parts.map((part, i) => {
          const path = parts.slice(0, i + 1).join('/');
          return (
            <span key={path}>
              /{' '}
              <button type="button" className={styles.crumb} onClick={() => setDir(path)}>
                {part}
              </button>
            </span>
          );
        })}
      </nav>
      <div className={styles.tree}>
        {tree.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
        {tree.isError && <ErrorState error={tree.error} onRetry={() => void tree.refetch()} />}
        {tree.data?.length === 0 && <p className="hint">{C.emptyDir}</p>}
        {tree.data
          ?.filter((entry) => entry.type !== GitTreeEntryType.Commit)
          .map((entry) => {
            const isDir = entry.type === GitTreeEntryType.Tree;
            const target = isDir ? `${entry.path}/` : entry.path;
            return (
              <div key={entry.path} className={styles.entry}>
                <input
                  type="checkbox"
                  aria-label={C.select(target)}
                  checked={targets.includes(target)}
                  onChange={() => onToggle(target)}
                />
                <Icon name={isDir ? 'folder' : 'list'} size="sm" />
                {isDir ? (
                  <button
                    type="button"
                    className={`mono ${styles.entryName}`}
                    aria-label={C.open(entry.name)}
                    onClick={() => setDir(entry.path)}
                  >
                    {entry.name}/
                  </button>
                ) : (
                  <span className={`mono ${styles.entryName}`}>{entry.name}</span>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

/**
 * The targets of a batch (20 §2): ticked in the project's tree or typed one per line. Both edit the same text, so
 * switching between them keeps what was chosen.
 */
export function TargetPicker({
  projectId,
  refName,
  text,
  onChange,
}: {
  projectId: string;
  refName: string;
  text: string;
  onChange: (text: string) => void;
}) {
  const targets = parseTargets(text);
  return (
    <Tabs
      items={[
        {
          value: 'pick',
          label: C.pickTab,
          content: (
            <TreePicker
              projectId={projectId}
              refName={refName}
              targets={targets}
              onToggle={(target) => onChange(toggleTarget(targets, target).join('\n'))}
            />
          ),
        },
        {
          value: 'lines',
          label: C.linesTab,
          content: (
            <textarea
              className="textarea mono"
              rows={6}
              aria-label={C.linesLabel}
              placeholder={C.linesPlaceholder}
              value={text}
              onChange={(e) => onChange(e.target.value)}
            />
          ),
        },
      ]}
    />
  );
}
