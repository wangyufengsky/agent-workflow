import {
  DECK_MATERIALS_MAX_CHARS,
  DECK_MAX_SLIDES,
  type DeckMaterialInput,
  DeckMaterialKind,
  SlideLayout,
  THEME_IDS,
  type ThemeId,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { type FormEvent, type KeyboardEvent, useState } from 'react';
import { MOD_KEY } from '../../app/platform.ts';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { PPT_COPY as C } from '../../copy/ppt.ts';
import { THEME_LABEL } from '../../copy/themes.ts';
import { resolveTheme } from '../../theme/apply-theme.ts';
import { knowledgeConversationQuery } from '../knowledge/knowledge.queries.ts';
import { ModelPicker } from '../knowledge/model-picker.tsx';
import { projectsQuery } from '../projects/projects.queries.ts';
import { useSettings } from '../settings/settings.queries.ts';
import { taskQuery } from '../tasks/tasks.queries.ts';
import { MaterialsPicker } from './materials-picker.tsx';
import styles from './ppt.module.css';
import { useCreateDeck } from './ppt.queries.ts';
import { SlideView } from './slide/slide-view.tsx';

const route = getRouteApi(ROUTE_IDS.pptNew);
const THEME_THUMB_WIDTH = 168;

/** Material given in the address (「做成 PPT」on a result card or a knowledge conversation, 23 §2.5). */
function prefilled(search: {
  taskId?: string | undefined;
  knowledgeConversationId?: string | undefined;
}): DeckMaterialInput[] {
  return [
    ...(search.taskId === undefined ? [] : [{ kind: DeckMaterialKind.Task, taskId: search.taskId } as const]),
    ...(search.knowledgeConversationId === undefined
      ? []
      : [{ kind: DeckMaterialKind.Knowledge, conversationId: search.knowledgeConversationId } as const]),
  ];
}

/** Characters of the text the user typed in or chose; tasks and conversations are counted by the backend. */
const typedChars = (materials: readonly DeckMaterialInput[]) =>
  materials.reduce(
    (sum, m) => sum + (m.kind === DeckMaterialKind.Text || m.kind === DeckMaterialKind.File ? m.content.length : 0),
    0,
  );

/** 「做一份 PPT」(23 §2.3): brief, material, number of pages, theme and model; the AI writes the outline first. */
export function PptNewPage() {
  const search = route.useSearch();
  const navigate = useNavigate();
  const settings = useSettings();
  const projects = useQuery(projectsQuery).data ?? [];
  const [brief, setBrief] = useState('');
  const [materials, setMaterials] = useState<DeckMaterialInput[]>(() => prefilled(search));
  // Undefined until the user picks one: then the project of a prefilled task or conversation.
  const [chosenProject, setChosenProject] = useState<string | null | undefined>(
    projects.some((p) => p.id === search.projectId) ? search.projectId : undefined,
  );
  const [autoCount, setAutoCount] = useState(true);
  const [count, setCount] = useState(8);
  const [theme, setTheme] = useState<ThemeId>(() =>
    resolveTheme(settings['ui.theme'], window.matchMedia('(prefers-color-scheme: dark)').matches),
  );
  const [model, setModel] = useState(settings['ai.defaultModel']);
  const create = useCreateDeck();

  const taskId = search.taskId;
  const conversationId = search.knowledgeConversationId;
  const prefillTask = useQuery({ ...taskQuery(taskId ?? ''), enabled: taskId !== undefined });
  const prefillConversation = useQuery({
    ...knowledgeConversationQuery(conversationId ?? ''),
    enabled: conversationId !== undefined,
  });
  const fromMaterial = prefillTask.data?.project.id ?? prefillConversation.data?.project.id;
  const projectId = chosenProject === undefined ? (fromMaterial ?? null) : chosenProject;
  const projectLocked = materials.some(
    (m) => m.kind === DeckMaterialKind.Task || m.kind === DeckMaterialKind.Knowledge,
  );

  const chars = typedChars(materials);
  const problem =
    brief.trim() === ''
      ? C.needBrief
      : chars > DECK_MATERIALS_MAX_CHARS
        ? C.tooMuch(chars, DECK_MATERIALS_MAX_CHARS)
        : undefined;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (problem !== undefined) return;
    create.mutate(
      {
        brief: brief.trim(),
        ...(projectId === null ? {} : { projectId }),
        materials,
        ...(autoCount ? {} : { slideCount: count }),
        theme,
        model,
      },
      { onSuccess: (deck) => void navigate({ to: ROUTES.pptDeck, params: { deckId: deck.id } }) },
    );
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{C.newTitle}</h1>
          <p className="lede">{C.newLede}</p>
        </div>
      </div>
      <form className="card pad col" onSubmit={submit} onKeyDown={onKeyDown} aria-label={C.newTitle}>
        <div className="field">
          <label className="label" htmlFor="deck-brief">
            {C.brief}
          </label>
          <textarea
            id="deck-brief"
            className="textarea"
            rows={4}
            placeholder={C.briefPlaceholder}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
          />
          <div className={styles.examples}>
            {C.briefExamples.map((text) => (
              <button key={text} type="button" className="chip" onClick={() => setBrief(text)}>
                {text}
              </button>
            ))}
          </div>
        </div>
        <MaterialsPicker
          projects={projects}
          projectId={projectId}
          projectLocked={projectLocked}
          materials={materials}
          onProject={setChosenProject}
          onChange={setMaterials}
        />
        <div className="field">
          <span className="label">{C.slideCount}</span>
          <div className="row" role="radiogroup" aria-label={C.slideCount}>
            <label className="check">
              <input type="radio" checked={autoCount} onChange={() => setAutoCount(true)} />
              {C.slideCountAuto}
            </label>
            <label className="check">
              <input type="radio" checked={!autoCount} onChange={() => setAutoCount(false)} />
              {C.slideCountFixed}
            </label>
            <input
              className={`input ${styles.countInput}`}
              type="number"
              min={1}
              max={DECK_MAX_SLIDES}
              aria-label={C.slideCount}
              value={count}
              disabled={autoCount}
              onChange={(e) => setCount(Math.min(DECK_MAX_SLIDES, Math.max(1, Number(e.target.value))))}
            />
            <span className="hint">{C.slideCountUnit}</span>
          </div>
        </div>
        <div className="field">
          <span className="label">{C.theme}</span>
          <div className={styles.themes} role="radiogroup" aria-label={C.theme}>
            {THEME_IDS.map((id) => (
              <label key={id} className={theme === id ? `${styles.themeOption} ${styles.themeOn}` : styles.themeOption}>
                <input
                  className="sr"
                  type="radio"
                  name="deck-theme"
                  checked={theme === id}
                  onChange={() => setTheme(id)}
                />
                <SlideView
                  content={{ layout: SlideLayout.Cover, title: THEME_LABEL[id], subtitle: C.title }}
                  theme={id}
                  width={THEME_THUMB_WIDTH}
                />
                <span className="hint">{THEME_LABEL[id]}</span>
              </label>
            ))}
          </div>
        </div>
        {create.isError && <ErrorState error={create.error} />}
        <div className="row">
          <span className="hint">{C.model}</span>
          <ModelPicker value={model} onChange={setModel} />
          <span className="grow" />
          {problem !== undefined && <span className="hint">{problem}</span>}
          <Button
            type="submit"
            variant="primary"
            icon="sparkle"
            pending={create.isPending}
            disabled={problem !== undefined}
          >
            {C.generateOutline}
            <span className="kbd">
              {MOD_KEY}
              {C.submitShortcut}
            </span>
          </Button>
        </div>
      </form>
    </div>
  );
}
