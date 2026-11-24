import { builtinSkillId, SKILL_SELECTION_MAX } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { type KeyboardEvent, type RefObject, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ErrorState } from '../../components/error-state.tsx';
import { BUILTIN_SKILL_COPY, SKILLS_COPY as C } from '../../copy/skills.ts';
import { skillCatalogQuery, skillsQuery } from './skills.queries.ts';
import styles from './slash-skills.module.css';

export function useSlashSkills(
  input: RefObject<HTMLTextAreaElement | null>,
  text: string,
  setText: (s: string) => void,
  selected: string[],
  select: (ids: string[]) => void,
  enabled = true,
) {
  const [cursor, setCursor] = useState<number | null>(null),
    [active, setActive] = useState(0);
  const listId = useId(),
    restore = useRef<number | null>(null);
  const fragment =
    enabled && cursor !== null && !/\S/u.test(text[cursor] ?? '')
      ? text.slice(0, cursor).match(/(?:^|\s)(\/[^/\s]*)$/u)?.[1]
      : undefined;
  const open = fragment !== undefined;
  const library = useQuery({ ...skillsQuery, enabled: open || selected.length > 0 });
  const catalog = useQuery({ ...skillCatalogQuery, enabled: open || selected.length > 0 });
  const user = (library.data ?? [])
    .filter((s) => s.assistantEnabled)
    .map((s) => ({ id: s.id, name: s.name, title: s.name, description: s.description }));
  const builtin = (catalog.data?.builtin ?? [])
    .filter((s) => s.assistantEnabled)
    .map((s) => ({
      id: builtinSkillId(s.name),
      name: s.name,
      title: BUILTIN_SKILL_COPY[s.name]?.title ?? s.name,
      description: BUILTIN_SKILL_COPY[s.name]?.description ?? s.description,
    }));
  const all = [...user, ...builtin];
  const search = fragment?.slice(1).toLowerCase() ?? '';
  const results = all.filter(
    (s) => !selected.includes(s.id) && [s.name, s.title, s.description].some((x) => x.toLowerCase().includes(search)),
  );
  const index = Math.min(active, Math.max(0, results.length - 1));
  const [position, setPosition] = useState<React.CSSProperties>();
  useLayoutEffect(() => {
    if (!open || !input.current) return;
    const place = () => {
      if (!input.current) return;
      const rect = input.current.getBoundingClientRect();
      const above = rect.top - 8;
      const below = innerHeight - rect.bottom - 8;
      const up = above >= 260 || above >= below;
      setPosition({
        left: Math.max(4, rect.left),
        width: Math.min(rect.width, innerWidth - 8),
        maxHeight: Math.min(320, Math.max(60, up ? above : below)),
        ...(up ? { bottom: innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, input]);
  const atLimit = selected.length >= SKILL_SELECTION_MAX;
  useLayoutEffect(() => {
    if (input.current?.value === text && restore.current !== null) {
      input.current?.focus();
      input.current?.setSelectionRange(restore.current, restore.current);
      restore.current = null;
    }
  }, [input, text]);
  useLayoutEffect(() => {
    if (open) document.getElementById(listId + '-' + index)?.scrollIntoView({ block: 'nearest' });
  }, [open, listId, index]);
  function choose(i: number) {
    const item = results[i];
    if (!item || cursor === null || fragment === undefined || atLimit) return;
    const start = cursor - fragment.length;
    select([...selected, item.id]);
    restore.current = start;
    setText(text.slice(0, start) + text.slice(cursor));
    setCursor(null);
    setActive(0);
  }
  function keyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return true;
    if (!open) return false;
    if (e.key === 'Escape') {
      setCursor(null);
      e.preventDefault();
      return true;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (results.length) setActive((index + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
      e.preventDefault();
      return true;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      choose(index);
      e.preventDefault();
      return true;
    }
    return false;
  }
  function sync(element: HTMLTextAreaElement) {
    setActive(0);
    setCursor(element.selectionStart === element.selectionEnd ? element.selectionStart : null);
  }
  const panel = enabled && (
    <div className={styles.anchor}>
      {open &&
        createPortal(
          <div className={styles.menu} style={position}>
            <div className={styles.heading}>
              {C.pickForMessage}
              <small>{C.slashKeys}</small>
            </div>
            {library.isError || catalog.isError ? <ErrorState error={library.error ?? catalog.error} /> : null}
            <div id={listId} role="listbox" aria-label={C.pick}>
              {!atLimit &&
                results.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    role="option"
                    id={listId + '-' + i}
                    aria-selected={i === index}
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onPointerMove={() => setActive(i)}
                    onClick={() => choose(i)}
                  >
                    <strong>{s.title}</strong>
                    <span>{s.description}</span>
                  </button>
                ))}
            </div>
            {atLimit ? (
              <p>{C.limit(SKILL_SELECTION_MAX)}</p>
            ) : (
              !results.length && <p>{library.isPending || catalog.isPending ? C.loading : C.noMatches}</p>
            )}
          </div>,
          document.body,
        )}
      {selected.length > 0 && (
        <div className="row wrap">
          {selected.map((id) => (
            <button
              key={id}
              type="button"
              className="chip"
              onClick={() => select(selected.filter((s) => s !== id))}
              aria-label={C.remove(all.find((s) => s.id === id)?.title ?? id)}
            >
              {all.find((s) => s.id === id)?.title ?? id} ×
            </button>
          ))}
        </div>
      )}
    </div>
  );
  return {
    panel,
    keyDown,
    sync,
    props: {
      'aria-autocomplete': 'list' as const,
      'aria-controls': open ? listId : undefined,
      'aria-activedescendant': open && results.length && !atLimit ? listId + '-' + index : undefined,
      onClick: (e: React.MouseEvent<HTMLTextAreaElement>) => sync(e.currentTarget),
      onKeyUp: (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) sync(e.currentTarget);
      },
      onBlur: () => setCursor(null),
    },
  };
}
