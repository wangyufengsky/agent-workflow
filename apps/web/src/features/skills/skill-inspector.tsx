import { Link } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Icon } from '../../components/icon.tsx';
import { Tabs } from '../../components/tabs.tsx';
import { SKILLS_COPY as C } from '../../copy/skills.ts';
import type { Audience, CatalogEntry } from './skill-catalog.ts';
import type { ScopeOptions } from './skill-scope-editor.tsx';
import styles from './skills.module.css';

function AudienceChips({ items }: { items: Audience[] }) {
  return (
    <div className={styles.chips}>
      {items.map(({ id, name }) => (
        <span key={id}>{name}</span>
      ))}
    </div>
  );
}

function SkillUsage({ entry, options, onEdit }: { entry: CatalogEntry; options: ScopeOptions; onEdit(): void }) {
  if (entry.kind === 'builtin') {
    return (
      <div className={styles.detailBody}>
        <section className={styles.scopeSection}>
          <h4>
            <Icon name="users" size="sm" />
            {C.availableRoles}
          </h4>
          {entry.audiences.length ? (
            <AudienceChips items={entry.audiences} />
          ) : (
            <p className="hint">{C.unconfigured}</p>
          )}
        </section>
        <section className={styles.scopeSection}>
          <h4>{C.trigger}</h4>
          <p className="hint">{entry.trigger}</p>
        </section>
        <p className="hint">{C.systemAssigned}</p>
      </div>
    );
  }

  return (
    <div className={styles.detailBody}>
      <section className={styles.scopeSection}>
        <h4>
          <Icon name="sparkle" size="sm" />
          {C.assistant}
        </h4>
        <p className="hint">{entry.scope.assistantEnabled ? C.assistantOn : C.assistantOff}</p>
      </section>
      <section className={styles.scopeSection}>
        <h4>
          <Icon name="flow" size="sm" />
          {C.projectBinding}
        </h4>
        {entry.scope.bindings.length === 0 && <p className="hint">{C.unbound}</p>}
        {entry.scope.bindings.map(({ projectId, workflowKey, roleIds }) => {
          const project = options.projects.find(({ id }) => id === projectId);
          const workflow = options.workflows.find(({ key }) => key === workflowKey);
          return (
            <div className={styles.scopeBinding} key={JSON.stringify([projectId, workflowKey])}>
              {project === undefined ? (
                projectId
              ) : (
                <Link to={ROUTES.project} params={{ projectId }} className="link">
                  {project.name}
                </Link>
              )}
              <p className="hint">{workflow?.name ?? workflowKey}</p>
              <AudienceChips
                items={
                  roleIds === null
                    ? [{ id: 'all', name: C.allRoles }]
                    : options.roles.filter(({ id }) => roleIds.includes(id))
                }
              />
            </div>
          );
        })}
      </section>
      <div>
        <Button size="sm" onClick={onEdit}>
          {C.editScope}
        </Button>
      </div>
    </div>
  );
}

export function SkillInspector({
  entry,
  options,
  onEditScope,
  onEditSource,
  onDelete,
}: {
  entry: CatalogEntry;
  options: ScopeOptions;
  onEditScope(): void;
  onEditSource(): void;
  onDelete(): void;
}) {
  return (
    <aside className={styles.inspector} aria-label={C.detail}>
      <header className={styles.detailHeader}>
        <div className="row wrap">
          <h2 className="grow">{entry.title}</h2>
          <span className="hint">{entry.kind === 'builtin' ? C.builtinReadOnly : C.mine}</span>
        </div>
        {(entry.name !== entry.title || entry.kind === 'mine') && (
          <p className="hint mono">{entry.kind === 'mine' ? C.version(entry.skill.version) : entry.name}</p>
        )}
        <p className="hint">{entry.description}</p>
      </header>
      <Tabs
        items={[
          {
            value: 'scope',
            label: C.scope,
            content: <SkillUsage entry={entry} options={options} onEdit={onEditScope} />,
          },
          {
            value: 'source',
            label: C.source,
            content: (
              <div className={styles.detailBody}>
                {entry.kind === 'mine' && (
                  <div className="row wrap">
                    <Button size="sm" icon="edit" onClick={onEditSource}>
                      {C.editSource}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={onDelete}>
                      {C.delete}
                    </Button>
                  </div>
                )}
                <pre className={styles.markdown}>{entry.source}</pre>
              </div>
            ),
          },
        ]}
      />
    </aside>
  );
}
