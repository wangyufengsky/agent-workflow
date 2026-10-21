import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PromptName, type Prompts, renderTemplate } from '@aw/builtin';
import {
  AppError,
  type AttemptDTO,
  AttemptKind,
  type AttemptSummaryDTO,
  type CreateDeckRequest,
  DECK_MATERIALS_MAX_CHARS,
  DECK_MAX_SLIDES,
  DECK_TITLE_MAX_CHARS,
  type DeckDTO,
  type DeckRunDTO,
  type DeckSlideDTO,
  type DeckSummaryDTO,
  deckRunKindOf,
  deckStatusOf,
  ErrorCode,
  isAttemptActive,
  type ListDecksQuery,
  type OutlineSlide,
  ServerEventType,
  SessionAgent,
  type SlideContent,
  type SubmitOutlineInput,
  type SubmitSlideInput,
  SYSTEM_THEME_MAP,
  type ThemeId,
  ThemePreference,
  type UpdateOutlineRequest,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { AttemptsService } from '../attempts/index.ts';
import type { InboxService } from '../inbox/index.ts';
import type { KnowledgeService } from '../knowledge/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { SettingsService } from '../settings/index.ts';
import type { TasksService } from '../tasks/index.ts';
import { describeMaterials, snapshotMaterials } from './decks.materials.ts';
import {
  describeLayouts,
  describeOutline,
  describePagesToMake,
  describePagesToRevise,
  describeSlideCount,
} from './decks.prompts.ts';
import { createDecksRepo, type Deck, type Run, type Slide } from './decks.repo.ts';

export type DecksServiceDeps = {
  db: Db;
  unit: UnitOfWork;
  clock: Clock;
  attempts: AttemptsService;
  projects: ProjectsService;
  tasks: TasksService;
  knowledge: KnowledgeService;
  inbox: InboxService;
  settings: SettingsService;
  prompts: Prompts;
  dataDir: string;
};

/** Prefix of the opencode session titles of PPTs (the titles show only in opencode). */
const SESSION_TITLE_PREFIX = 'PPT';
/** Where the writer works when the PPT has no project (23 §7.1): an empty directory. */
const BLANK_DIR = ['ppt', 'blank'];
const DECK_KINDS: readonly AttemptKind[] = [AttemptKind.DeckOutline, AttemptKind.DeckSlides];

const firstLine = (text: string) => (text.trim().split('\n')[0] ?? '').slice(0, DECK_TITLE_MAX_CHARS);
const invalid = (path: string[], message: string) =>
  new AppError(ErrorCode.ValidationFailed, message, { issues: [{ path, message }] });
const notNow = (message: string, details: Record<string, unknown>) =>
  new AppError(ErrorCode.StateTransitionInvalid, message, details);

/** A new page of the outline. */
const newSlide = (deckId: string, seq: number, page: OutlineSlide, now: number): Slide => ({
  id: randomUUID(),
  deckId,
  seq,
  layout: page.layout,
  title: page.title,
  points: page.points,
  content: null,
  notes: '',
  previous: null,
  updatedAt: now,
});

/** PPT (23): an outline the user confirms, pages the AI makes and revises, all on one read-only writer session. */
export function createDecksService(deps: DecksServiceDeps) {
  const { unit, clock, attempts, projects, tasks, knowledge, inbox, settings, prompts } = deps;
  const repo = createDecksRepo(deps.db);
  const blankDir = join(deps.dataDir, ...BLANK_DIR);
  mkdirSync(blankDir, { recursive: true });

  function mustFind(id: string): Deck {
    const deck = repo.findDeck(id);
    if (deck === undefined) throw new AppError(ErrorCode.DeckNotFound, `No PPT ${id}`, { id });
    return deck;
  }

  function mustFindSlide(slides: readonly Slide[], slideId: string): Slide {
    const slide = slides.find((s) => s.id === slideId);
    if (slide === undefined) throw new AppError(ErrorCode.DeckSlideNotFound, `No page ${slideId}`, { slideId });
    return slide;
  }

  const publish = (deckId: string) => unit.publish({ type: ServerEventType.DeckUpdated, data: { deckId } });
  const touch = (deckId: string) => repo.updateDeck(deckId, { updatedAt: clock.now() });

  function runOf(attempt: Pick<AttemptDTO, 'id'>): { run: Run; deck: Deck } {
    const run = repo.findRunByAttempt(attempt.id);
    // The registry only lets PPT attempts through, and every PPT attempt has its run (23 §4.1).
    if (run === undefined) throw new Error(`PPT attempt ${attempt.id} has no run`);
    return { run, deck: mustFind(run.deckId) };
  }

  function summaryOf(summaries: ReadonlyMap<string, AttemptSummaryDTO>, run: Run): AttemptSummaryDTO {
    const summary = summaries.get(run.attemptId);
    // attempt_id is a foreign key, so the attempt exists.
    if (summary === undefined) throw new Error(`PPT run ${run.id} has no attempt ${run.attemptId}`);
    return summary;
  }

  /** One AI work at a time per PPT; changing its pages meanwhile would race the writer's submissions. */
  function assertIdle(deck: Deck): void {
    const latest = repo.listRuns(deck.id).at(-1);
    if (latest !== undefined && isAttemptActive(attempts.get(latest.attemptId).status)) {
      throw new AppError(ErrorCode.DeckBusy, 'The PPT is being worked on by the AI', { id: deck.id });
    }
  }

  function assertOutlineStage(deck: Deck, confirmed: boolean): void {
    if ((deck.outlineConfirmedAt !== null) !== confirmed) {
      throw notNow(confirmed ? 'The outline is not confirmed yet' : 'The outline is already confirmed', {
        id: deck.id,
      });
    }
  }

  const statusOf = (deck: Deck, slides: readonly Slide[], latest: AttemptSummaryDTO | undefined) =>
    deckStatusOf({
      outlineConfirmed: deck.outlineConfirmedAt !== null,
      slideCount: slides.length,
      madeCount: slides.filter((s) => s.content !== null).length,
      latestRun: latest === undefined ? null : { kind: deckRunKindOf(latest.kind), status: latest.status },
    });

  const toSlideDto = ({ deckId: _deckId, previous, ...slide }: Slide): DeckSlideDTO => ({
    ...slide,
    hasPrevious: previous !== null,
  });

  const toRunDto = (run: Run, attempt: AttemptSummaryDTO): DeckRunDTO => ({
    id: run.id,
    kind: deckRunKindOf(attempt.kind),
    targets: run.targets,
    done: run.done,
    instruction: run.instruction,
    model: attempt.model,
    attempt,
    awaitingInput: isAttemptActive(attempt.status) && inbox.listOpen({ attemptId: attempt.id }).length > 0,
    createdAt: run.createdAt,
  });

  const projectRef = (projectId: string | null) => {
    if (projectId === null) return null;
    const project = projects.getRecord(projectId);
    return { id: project.id, name: project.name };
  };

  function detail(id: string): DeckDTO {
    const deck = mustFind(id);
    const slides = repo.listSlides(id);
    const runs = repo.listRuns(id);
    const summaries = attempts.summaries(runs.map((r) => r.attemptId));
    const runDtos = runs.map((r) => toRunDto(r, summaryOf(summaries, r)));
    return {
      id: deck.id,
      title: deck.title,
      brief: deck.brief,
      theme: deck.theme,
      status: statusOf(deck, slides, runDtos.at(-1)?.attempt),
      slideCountTarget: deck.slideCountTarget,
      project: projectRef(deck.projectId),
      materials: repo.listMaterials(id).map((m) => ({
        id: m.id,
        kind: m.kind,
        title: m.title,
        refId: m.refId,
        chars: m.content.length,
      })),
      understanding: deck.understanding,
      outlineConfirmed: deck.outlineConfirmedAt !== null,
      slides: slides.map(toSlideDto),
      runs: runDtos,
      createdAt: deck.createdAt,
      updatedAt: deck.updatedAt,
    };
  }

  /** The first message of the writer's session: the project, the brief and the material snapshots (23 §7.2). */
  function context(deck: Deck): string {
    const project = deck.projectId === null ? undefined : projects.getRecord(deck.projectId);
    return renderTemplate(prompts[PromptName.DeckContext], {
      project:
        project === undefined
          ? 'No project: work only from the brief and the material.'
          : `Project: ${project.name}. Your current directory is its repository; read its code when the deck needs it.`,
      brief: deck.brief,
      materials: describeMaterials(repo.listMaterials(deck.id)),
    });
  }

  /**
   * Starts one AI work: on the PPT's session when it has one (the writer remembers the material and what it read),
   * otherwise a new session whose first message carries the context. The attempt row is written before the session
   * can call back; the run row, and `also` (pages the work needs), right after it in the same synchronous segment.
   */
  async function startRun(
    deck: Deck,
    work: {
      kind: AttemptKind;
      targets: readonly string[];
      instruction: string | null;
      step: string;
      model: string | null | undefined;
      also?: () => void;
    },
  ): Promise<void> {
    const model = work.model === undefined ? settings.get('ai.defaultModel') : work.model;
    const runs = repo.listRuns(deck.id);
    const previous = runs.at(-1);
    const previousSession = previous === undefined ? null : attempts.get(previous.attemptId).opencodeSessionId;
    const attemptId = randomUUID();
    const started =
      previous !== undefined && previousSession !== null
        ? attempts.continueSession(previous.attemptId, {
            id: attemptId,
            kind: work.kind,
            prompt: work.step,
            model,
            agent: SessionAgent.SlidesWriter,
            system: undefined,
          })
        : attempts.start({
            id: attemptId,
            kind: work.kind,
            agent: SessionAgent.SlidesWriter,
            taskId: null,
            nodeId: null,
            roleId: null,
            directory: deck.projectId === null ? blankDir : projects.getRecord(deck.projectId).repoPath,
            title: `${SESSION_TITLE_PREFIX} · ${deck.title}`,
            model,
            prompt: `${context(deck)}\n\n${work.step}`,
          });
    const now = clock.now();
    unit.transact(() => {
      work.also?.();
      repo.insertRun({
        id: randomUUID(),
        deckId: deck.id,
        seq: runs.length + 1,
        attemptId,
        targets: [...work.targets],
        done: [],
        instruction: work.instruction,
        createdAt: now,
      });
      repo.updateDeck(deck.id, { updatedAt: now });
      publish(deck.id);
    });
    await started;
  }

  /** Writes the outline from the brief (`decks.create`, a retry after a failed outline). */
  const outlineStep = (deck: Deck) =>
    renderTemplate(prompts[PromptName.DeckOutline], {
      slideCount: describeSlideCount(deck.slideCountTarget),
      layouts: describeLayouts(),
    });

  /** Makes these pages (`decks.generate`, `decks.insertSlide`): the step lists them as they will be numbered. */
  const makeStep = (pages: readonly Slide[]) =>
    renderTemplate(prompts[PromptName.DeckSlides], { pages: describePagesToMake(pages), layouts: describeLayouts() });

  /** A PPT's theme when none is chosen: the app's; the light one for「跟随系统」, as PPTs are mostly projected. */
  function defaultTheme(): ThemeId {
    const preference = settings.get('ui.theme');
    return preference === ThemePreference.System ? SYSTEM_THEME_MAP.light : preference;
  }

  /** Renumbers pages from 1 in the given order. */
  function renumber(slides: readonly Slide[], now: number): void {
    slides.forEach((slide, i) => {
      if (slide.seq !== i + 1) repo.updateSlide(slide.id, { seq: i + 1, updatedAt: now });
    });
  }

  /** Writes a change of the PPT's pages and announces it. */
  function change(deck: Deck, fn: (now: number) => void): DeckDTO {
    const now = clock.now();
    unit.transact(() => {
      fn(now);
      repo.updateDeck(deck.id, { updatedAt: now });
      publish(deck.id);
    });
    return detail(deck.id);
  }

  // Each end of a work, and a permission request waiting or answered, changes what the PPT shows.
  attempts.onSignal(({ type, attempt }) => {
    if (!DECK_KINDS.includes(attempt.kind)) return;
    const { deck } = runOf(attempt);
    if (type === 'ended') touch(deck.id);
    publish(deck.id);
  });

  return {
    get: detail,

    /** A page of PPTs, most recently updated first (23 §8). */
    list({ projectId, query, limit, cursor }: ListDecksQuery): { items: DeckSummaryDTO[]; nextCursor: string | null } {
      const at = cursor === undefined ? -1 : cursor.indexOf('.');
      const after =
        cursor === undefined ? undefined : { updatedAt: Number(cursor.slice(0, at)), id: cursor.slice(at + 1) };
      const rows = repo.page({ projectId, query }, after, limit + 1);
      const page = rows.slice(0, limit);
      const ids = page.map((d) => d.id);
      const slides = repo.listSlidesOf(ids);
      const latestRuns = new Map(repo.listRunsOf(ids).map((r) => [r.deckId, r]));
      const summaries = attempts.summaries([...latestRuns.values()].map((r) => r.attemptId));
      const projectList = projects.list();
      const items = page.map((deck): DeckSummaryDTO => {
        const own = slides.filter((s) => s.deckId === deck.id);
        const latest = latestRuns.get(deck.id);
        const project = projectList.find((p) => p.id === deck.projectId);
        return {
          id: deck.id,
          title: deck.title,
          theme: deck.theme,
          status: statusOf(deck, own, latest === undefined ? undefined : summaryOf(summaries, latest)),
          project: project === undefined ? null : { id: project.id, name: project.name },
          slideCount: own.length,
          madeCount: own.filter((s) => s.content !== null).length,
          cover: own[0]?.content ?? null,
          updatedAt: deck.updatedAt,
        };
      });
      const last = page.at(-1);
      return { items, nextCursor: rows.length > limit && last !== undefined ? `${last.updatedAt}.${last.id}` : null };
    },

    /** A new PPT from its brief and material; the writer starts on the outline (`decks.create`). */
    async create(request: CreateDeckRequest): Promise<DeckDTO> {
      const snapshots = snapshotMaterials(request.materials, { task: tasks.detail, knowledge: knowledge.get });
      const projectIds = new Set(
        [request.projectId, ...snapshots.map((s) => s.projectId)].filter((p) => p !== undefined && p !== null),
      );
      if (projectIds.size > 1) throw invalid(['materials'], 'The material comes from more than one project');
      const [projectId] = projectIds;
      if (projectId !== undefined) projects.getRecord(projectId);
      const chars = snapshots.reduce((sum, s) => sum + s.content.length, 0);
      if (chars > DECK_MATERIALS_MAX_CHARS) {
        throw invalid(['materials'], `The material has ${chars} characters, more than ${DECK_MATERIALS_MAX_CHARS}`);
      }
      attempts.requireReady();
      const now = clock.now();
      const deck: Deck = {
        id: randomUUID(),
        projectId: projectId ?? null,
        title: firstLine(request.brief),
        titleEdited: false,
        brief: request.brief,
        slideCountTarget: request.slideCount ?? null,
        theme: request.theme ?? defaultTheme(),
        understanding: null,
        outlineConfirmedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      unit.transact(() => {
        repo.insertDeck(deck);
        repo.insertMaterials(
          snapshots.map((s, i) => ({
            id: randomUUID(),
            deckId: deck.id,
            seq: i + 1,
            kind: s.kind,
            refId: s.refId,
            title: s.title,
            content: s.content,
          })),
        );
      });
      await startRun(deck, {
        kind: AttemptKind.DeckOutline,
        targets: [],
        instruction: null,
        step: outlineStep(deck),
        model: request.model,
      });
      return detail(deck.id);
    },

    /** Rename, or show in another theme; no AI work. */
    update(id: string, patch: { title?: string | undefined; theme?: ThemeId | undefined }): DeckDTO {
      const deck = mustFind(id);
      return change(deck, () =>
        repo.updateDeck(id, {
          ...(patch.title === undefined ? {} : { title: patch.title, titleEdited: true }),
          ...(patch.theme === undefined ? {} : { theme: patch.theme }),
        }),
      );
    },

    /** The writer rewrites the outline following the user's instruction, or writes it again without one. */
    async reviseOutline(
      id: string,
      instruction: string | undefined,
      model: string | null | undefined,
    ): Promise<DeckDTO> {
      const deck = mustFind(id);
      assertIdle(deck);
      assertOutlineStage(deck, false);
      attempts.requireReady();
      await startRun(deck, {
        kind: AttemptKind.DeckOutline,
        targets: [],
        instruction: instruction ?? null,
        step:
          instruction === undefined
            ? outlineStep(deck)
            : renderTemplate(prompts[PromptName.DeckOutlineRevise], {
                instruction,
                outline: describeOutline(repo.listSlides(id)),
                slideCount: describeSlideCount(deck.slideCountTarget),
              }),
        model,
      });
      return detail(id);
    },

    /** The outline as the user edited it: pages with an id are kept, the others are new, the rest go. */
    updateOutline(id: string, { slides: pages }: Pick<UpdateOutlineRequest, 'slides'>): DeckDTO {
      const deck = mustFind(id);
      assertIdle(deck);
      assertOutlineStage(deck, false);
      const existing = repo.listSlides(id);
      for (const page of pages) if (page.id !== undefined) mustFindSlide(existing, page.id);
      return change(deck, (now) => {
        const kept = new Set(pages.map((p) => p.id));
        repo.deleteSlides(existing.filter((s) => !kept.has(s.id)).map((s) => s.id));
        pages.forEach(({ id: slideId, ...page }, i) => {
          if (slideId === undefined) repo.insertSlides([newSlide(id, i + 1, page, now)]);
          else repo.updateSlide(slideId, { ...page, seq: i + 1, updatedAt: now });
        });
      });
    },

    /** Confirms the outline the first time, then lets the writer make every page not made yet. */
    async generate(id: string, model: string | null | undefined): Promise<DeckDTO> {
      const deck = mustFind(id);
      assertIdle(deck);
      const pending = repo.listSlides(id).filter((s) => s.content === null);
      if (pending.length === 0) throw notNow('Every page is made', { id });
      attempts.requireReady();
      await startRun(deck, {
        kind: AttemptKind.DeckSlides,
        targets: pending.map((s) => s.id),
        instruction: null,
        step: makeStep(pending),
        model,
        also: () => {
          if (deck.outlineConfirmedAt === null) repo.updateDeck(id, { outlineConfirmedAt: clock.now() });
        },
      });
      return detail(id);
    },

    /** The writer revises made pages following the user's instruction; what it replaces is kept for restoring. */
    async reviseSlides(
      id: string,
      slideIds: readonly string[],
      instruction: string,
      model: string | null | undefined,
    ): Promise<DeckDTO> {
      const deck = mustFind(id);
      assertIdle(deck);
      assertOutlineStage(deck, true);
      const slides = repo.listSlides(id);
      const targets = slides.filter((s) => slideIds.includes(s.id));
      for (const slideId of slideIds) {
        if (mustFindSlide(slides, slideId).content === null) throw notNow('The page is not made yet', { slideId });
      }
      attempts.requireReady();
      await startRun(deck, {
        kind: AttemptKind.DeckSlides,
        targets: targets.map((s) => s.id),
        instruction,
        step: renderTemplate(prompts[PromptName.DeckSlidesRevise], {
          instruction,
          pages: describePagesToRevise(targets),
          layouts: describeLayouts(),
        }),
        model,
      });
      return detail(id);
    },

    /** The user's own edit of a page; it does not replace what「恢复上一版」brings back. */
    updateSlide(id: string, slideId: string, content: SlideContent, notes: string): DeckDTO {
      const deck = mustFind(id);
      assertIdle(deck);
      assertOutlineStage(deck, true);
      mustFindSlide(repo.listSlides(id), slideId);
      return change(deck, (now) =>
        repo.updateSlide(slideId, { layout: content.layout, content, notes, updatedAt: now }),
      );
    },

    /** Undoes the latest AI change of a page (one step, D95 ③). */
    restoreSlide(id: string, slideId: string): DeckDTO {
      const deck = mustFind(id);
      assertIdle(deck);
      const { previous } = mustFindSlide(repo.listSlides(id), slideId);
      if (previous === null) throw notNow('The page has no previous version', { slideId });
      return change(deck, (now) =>
        repo.updateSlide(slideId, {
          layout: previous.content.layout,
          content: previous.content,
          notes: previous.notes,
          previous: null,
          updatedAt: now,
        }),
      );
    },

    /** A new page after `afterSlideId` (first when left out); the writer makes only it. */
    async insertSlide(
      id: string,
      page: OutlineSlide & { afterSlideId?: string | undefined },
      model: string | null | undefined,
    ): Promise<DeckDTO> {
      const deck = mustFind(id);
      assertIdle(deck);
      assertOutlineStage(deck, true);
      const slides = repo.listSlides(id);
      if (slides.length >= DECK_MAX_SLIDES) throw invalid(['id'], `A PPT has at most ${DECK_MAX_SLIDES} pages`);
      const at = page.afterSlideId === undefined ? 0 : slides.indexOf(mustFindSlide(slides, page.afterSlideId)) + 1;
      attempts.requireReady();
      const now = clock.now();
      const slide = newSlide(id, at + 1, page, now);
      await startRun(deck, {
        kind: AttemptKind.DeckSlides,
        targets: [slide.id],
        instruction: null,
        step: makeStep([slide]),
        model,
        also: () => {
          repo.insertSlides([slide]);
          renumber([...slides.slice(0, at), slide, ...slides.slice(at)], now);
        },
      });
      return detail(id);
    },

    moveSlide(id: string, slideId: string, toSeq: number): DeckDTO {
      const deck = mustFind(id);
      assertIdle(deck);
      const slides = repo.listSlides(id);
      const slide = mustFindSlide(slides, slideId);
      if (toSeq > slides.length) throw invalid(['toSeq'], `The PPT has ${slides.length} pages`);
      const rest = slides.filter((s) => s.id !== slideId);
      return change(deck, (now) => renumber([...rest.slice(0, toSeq - 1), slide, ...rest.slice(toSeq - 1)], now));
    },

    deleteSlide(id: string, slideId: string): DeckDTO {
      const deck = mustFind(id);
      assertIdle(deck);
      const slides = repo.listSlides(id);
      mustFindSlide(slides, slideId);
      if (slides.length === 1) throw notNow('A PPT keeps at least one page', { slideId });
      return change(deck, (now) => {
        repo.deleteSlides([slideId]);
        renumber(
          slides.filter((s) => s.id !== slideId),
          now,
        );
      });
    },

    /** Stops the work in progress; the attempt's state machine rejects one that already ended. */
    async stop(id: string): Promise<DeckDTO> {
      const latest = repo.listRuns(mustFind(id).id).at(-1);
      // A PPT is created with its first run.
      if (latest === undefined) throw new Error(`PPT ${id} has no run`);
      await attempts.abort(latest.attemptId);
      return detail(id);
    },

    /** Deletes a PPT with its pages, runs, attempts and transcripts (23 §3). */
    delete(id: string): void {
      const deck = mustFind(id);
      assertIdle(deck);
      const attemptIds = repo.listRuns(id).map((r) => r.attemptId);
      unit.transact(() => {
        repo.deleteDeck(id);
        attempts.delete(attemptIds);
        publish(id);
      });
    },

    /** `submit_outline` (23 §7.3): the pages replace the outline, and the work is done. */
    submitOutline(attempt: AttemptDTO, input: SubmitOutlineInput): void {
      const { deck } = runOf(attempt);
      if (deck.slideCountTarget !== null && input.slides.length !== deck.slideCountTarget) {
        throw invalid(
          ['slides'],
          `The user asked for exactly ${deck.slideCountTarget} pages, not ${input.slides.length}`,
        );
      }
      const now = clock.now();
      unit.transact(() => {
        repo.deleteSlides(repo.listSlides(deck.id).map((s) => s.id));
        repo.insertSlides(input.slides.map((page, i) => newSlide(deck.id, i + 1, page, now)));
        repo.updateDeck(deck.id, {
          understanding: input.understanding,
          ...(deck.titleEdited ? {} : { title: input.title }),
          updatedAt: now,
        });
        attempts.markSubmitted(attempt.id);
        publish(deck.id);
      });
    },

    /**
     * `submit_slide` (23 §7.3): one of the work's pages, by its number. The first submission of a made page keeps what
     * it replaces; the work is done with the last of its pages.
     */
    submitSlide(attempt: AttemptDTO, input: SubmitSlideInput): { remaining: number[] } {
      const { run, deck } = runOf(attempt);
      const slides = repo.listSlides(deck.id);
      const slide = slides.find((s) => s.seq === input.page);
      if (slide === undefined || !run.targets.includes(slide.id)) {
        const pages = slides.filter((s) => run.targets.includes(s.id)).map((s) => s.seq);
        throw invalid(['page'], `Page ${input.page} is not one of the pages of this work: ${pages.join(', ')}`);
      }
      const done = run.done.includes(slide.id) ? run.done : [...run.done, slide.id];
      const remaining = slides.filter((s) => run.targets.includes(s.id) && !done.includes(s.id)).map((s) => s.seq);
      const now = clock.now();
      unit.transact(() => {
        repo.updateSlide(slide.id, {
          layout: input.content.layout,
          content: input.content,
          notes: input.notes,
          ...(slide.content !== null && !run.done.includes(slide.id)
            ? { previous: { content: slide.content, notes: slide.notes } }
            : {}),
          updatedAt: now,
        });
        repo.setRunDone(run.id, done);
        repo.updateDeck(deck.id, { updatedAt: now });
        if (remaining.length === 0) attempts.markSubmitted(attempt.id);
        publish(deck.id);
      });
      return { remaining };
    },
  };
}
export type DecksService = ReturnType<typeof createDecksService>;
