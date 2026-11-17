import { type AssistantMemoryDTO, listAssistantMemoriesOp } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { MEMORY_COPY as C } from '../../copy/assistant.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { projectsQuery } from '../projects/projects.queries.ts';
import { MemoryDetail, MemoryScope } from './memory-detail.tsx';
import { DeleteMemoryDialog, MemoryEditor } from './memory-dialogs.tsx';
import styles from './memory-page.module.css';

const categories = ['all', 'personal', 'project'] as const;
type Category = (typeof categories)[number];
const TITLE_MAX_CHARS = 36;
const shortDate = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' });

function titleOfMemory(memory: AssistantMemoryDTO): string {
  const [first] = memory.content.split(/[\r\n。！？]/u, 1);
  const chars = Array.from(first?.trim() || memory.content);
  return chars.length <= TITLE_MAX_CHARS ? chars.join('') : `${chars.slice(0, TITLE_MAX_CHARS).join('')}…`;
}

function matchesCategory(memory: AssistantMemoryDTO, category: Category): boolean {
  return category === 'all' || (category === 'personal' ? memory.projectId === null : memory.projectId !== null);
}

export function MemoryPage() {
  const [category, setCategory] = useState<Category>('all');
  const [projectId, setProjectId] = useState('');
  const [search, setSearch] = useState('');
  const [newestFirst, setNewestFirst] = useState(true);
  const [selectedId, setSelectedId] = useState<string>();
  const [editing, setEditing] = useState<AssistantMemoryDTO | null>();
  const [deleting, setDeleting] = useState<AssistantMemoryDTO>();
  const projects = useQuery(projectsQuery);
  const memories = useQuery({
    queryKey: queryKeys.assistantMemories,
    queryFn: async () => (await callOperation(listAssistantMemoriesOp, {})).items,
  });
  const items = memories.data ?? [];
  const projectNames = new Map(projects.data?.map(({ id, name }) => [id, name]));
  const projectNameOf = (item: AssistantMemoryDTO) =>
    item.projectId === null ? undefined : (projectNames.get(item.projectId) ?? C.project);
  const keyword = search.trim().toLocaleLowerCase();
  const shown = items
    .filter(
      (item) =>
        matchesCategory(item, category) &&
        (projectId === '' || item.projectId === projectId) &&
        [item.content, projectNameOf(item) ?? C.personal].some((part) => part.toLocaleLowerCase().includes(keyword)),
    )
    .sort((a, b) => (newestFirst ? b.updatedAt - a.updatedAt : a.updatedAt - b.updatedAt));
  const selected = shown.find((item) => item.id === selectedId) ?? shown[0];

  return (
    <div className={`page wide ${styles.page}`}>
      <header className={styles.header}>
        <div>
          <h1 className="title">{C.title}</h1>
          <p className="lede">{C.subtitle}</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setEditing(null)}>
          {C.add}
        </Button>
      </header>
      <div className={styles.toolbar}>
        <fieldset className={styles.filters} aria-label={C.classification}>
          {categories.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={category === key}
              onClick={() => {
                setCategory(key);
                if (key !== 'project') setProjectId('');
              }}
            >
              {C.categories[key]}
              <span className="hint">{items.filter((item) => matchesCategory(item, key)).length}</span>
            </button>
          ))}
        </fieldset>
        <div className={styles.searchTools}>
          <div className="input-wrap">
            <Icon name="search" size="sm" />
            <input
              className="input"
              type="search"
              aria-label={C.search}
              placeholder={C.search}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <select
            className="input"
            aria-label={C.filterProject}
            value={projectId}
            onChange={(event) => {
              const id = event.target.value;
              setProjectId(id);
              if (id !== '') setCategory('project');
            }}
          >
            <option value="">{C.allProjects}</option>
            {projects.data?.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {projects.isError && <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />}
      {memories.isError && <ErrorState error={memories.error} onRetry={() => void memories.refetch()} />}
      {memories.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {memories.isSuccess && (
        <div className={styles.workspace}>
          <section className={styles.list} aria-label={C.list}>
            <div className={styles.columns}>
              <span>{C.name}</span>
              <span>{C.scope}</span>
              <button
                type="button"
                className={styles.sort}
                aria-label={newestFirst ? C.oldestFirst : C.newestFirst}
                onClick={() => setNewestFirst(!newestFirst)}
              >
                {C.updatedAt}
                <Icon name={newestFirst ? 'arrowDown' : 'arrowUp'} size="sm" />
              </button>
            </div>
            {shown.length === 0 ? (
              <p className={styles.empty}>{items.length === 0 ? C.empty : C.noMatches}</p>
            ) : (
              <ul className={styles.rows}>
                {shown.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={styles.entry}
                      aria-pressed={selected?.id === item.id}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <span className={styles.entryMain}>
                        <span className={styles.entryIcon}>
                          <Icon name={item.projectId === null ? 'user' : 'folder'} />
                        </span>
                        <span className={styles.entryText}>
                          <strong className="ellipsis">{titleOfMemory(item)}</strong>
                          <small className="ellipsis">{item.content}</small>
                        </span>
                      </span>
                      <MemoryScope projectName={projectNameOf(item)} />
                      <time dateTime={new Date(item.updatedAt).toISOString()}>{shortDate.format(item.updatedAt)}</time>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p role="status" className={styles.resultCount}>
              {C.resultCount(shown.length)}
            </p>
          </section>
          {selected !== undefined && (
            <aside className={styles.inspector} aria-label={C.details}>
              <MemoryDetail
                memory={selected}
                title={titleOfMemory(selected)}
                projectName={projectNameOf(selected)}
                onEdit={() => setEditing(selected)}
                onDelete={() => setDeleting(selected)}
              />
            </aside>
          )}
        </div>
      )}
      <p className={styles.local}>
        <Icon name="lock" size="sm" />
        {C.local}
      </p>
      {editing !== undefined && (
        <MemoryEditor
          memory={editing}
          projects={projects.data ?? []}
          onClose={() => setEditing(undefined)}
          onSaved={(id) => {
            if (editing === null) {
              setCategory('all');
              setProjectId('');
              setSearch('');
            }
            setSelectedId(id);
            setEditing(undefined);
          }}
        />
      )}
      {deleting !== undefined && <DeleteMemoryDialog memory={deleting} onClose={() => setDeleting(undefined)} />}
    </div>
  );
}
