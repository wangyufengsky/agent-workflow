import type { ProjectDTO } from '@aw/shared';
import { type KeyboardEvent, useEffect, useId, useRef } from 'react';
import { Icon, type IconName } from '../../components/icon.tsx';
import { ASSISTANT_COPY as A } from '../../copy/assistant.ts';
import { PROJECTS_COPY as C } from '../../copy/projects.ts';
import { HOME_TASK_COPY } from '../../copy/tasks.ts';
import styles from './project-picker.module.css';

function handleMenuKeys(event: KeyboardEvent<HTMLDivElement>) {
  const { key, currentTarget } = event;
  if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End') return;
  event.preventDefault();
  const options = Array.from(currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
  const active = document.activeElement;
  const focused = active instanceof HTMLButtonElement ? options.indexOf(active) : -1;
  const next = {
    Home: options[0],
    End: options.at(-1),
    ArrowDown: options[focused + 1] ?? options[0],
    ArrowUp: focused > 0 ? options[focused - 1] : options.at(-1),
  }[key];
  next?.focus();
}

function ProjectOption({
  icon,
  selected,
  name,
  hint,
  onSelect,
}: {
  icon: IconName;
  selected: boolean;
  name: string;
  hint?: string;
  onSelect: () => void;
}) {
  return (
    <button type="button" className={styles.option} role="menuitemradio" aria-checked={selected} onClick={onSelect}>
      <Icon name={icon} size="sm" />
      <span className={styles.optionText}>
        {name}
        {hint !== undefined && <small className={styles.optionHint}>{hint}</small>}
      </span>
      {selected && <Icon name="check" size="sm" />}
    </button>
  );
}

export function ProjectPicker({
  projects,
  value,
  onChange,
  conversation = false,
  disabled = false,
}: {
  projects: readonly ProjectDTO[];
  value: string;
  onChange: (id: string) => void;
  conversation?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const current = projects.find((project) => project.id === value);
  const isMissing = value !== '' && current === undefined;
  const label = conversation ? A.sessionProject : HOME_TASK_COPY.project;
  const displayed =
    current?.name ?? (isMissing ? A.deletedProject : conversation ? A.generalConversation : C.chooseProject);
  const canOpen = !disabled && (conversation || projects.length > 0);

  useEffect(() => {
    const element = menu.current;
    if (element === null) return;
    const focusSelection = () => {
      if (!element.matches(':popover-open')) return;
      const option =
        element.querySelector<HTMLButtonElement>('[aria-checked="true"]') ??
        element.querySelector<HTMLButtonElement>('[role="menuitemradio"]');
      option?.focus();
    };
    element.addEventListener('toggle', focusSelection);
    return () => element.removeEventListener('toggle', focusSelection);
  }, []);

  function select(projectId: string) {
    menu.current?.hidePopover();
    if (projectId !== value) onChange(projectId);
  }

  return (
    <div className={styles.picker}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-describedby={`${id}-value`}
        aria-haspopup="menu"
        popoverTarget={id}
        disabled={!canOpen}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          if (!menu.current?.matches(':popover-open')) event.currentTarget.click();
        }}
      >
        <Icon name="folder" size="sm" />
        <span className={styles.label}>{label}</span>
        <span className="ellipsis" id={`${id}-value`} title={displayed}>
          {displayed}
        </span>
        <span className={styles.chevron}>
          <Icon name="chevDown" size="sm" />
        </span>
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        className={styles.menu}
        role="menu"
        aria-label={label}
        onKeyDown={handleMenuKeys}
      >
        {conversation && (
          <ProjectOption
            icon="message"
            name={A.generalConversation}
            hint={A.unboundConversation}
            selected={value === ''}
            onSelect={() => select('')}
          />
        )}
        {(projects.length > 0 || isMissing) && (
          <div className={styles.projectGroup}>
            <div className={styles.menuHeading} aria-hidden="true">
              {conversation ? C.myProjects : C.chooseProject}
            </div>
            {isMissing && (
              <ProjectOption icon="folder" name={A.deletedProject} selected onSelect={() => select(value)} />
            )}
            {projects.map((project) => (
              <ProjectOption
                key={project.id}
                icon="folder"
                name={project.name}
                selected={value === project.id}
                onSelect={() => select(project.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
