import type { AssistantForm, AssistantPageRef, DeckExportFormat } from '@aw/shared';
import { create } from 'zustand';

/** What the assistant asked the renderer to do (15 §3): the shell carries it out once. */
export type AssistantUiRequest =
  | { kind: 'navigate'; target: AssistantPageRef }
  | { kind: 'form'; form: AssistantForm; values: Record<string, unknown> }
  | { kind: 'reveal'; absolutePath: string }
  | { kind: 'export'; deckId: string; format: DeckExportFormat };

/** Pure UI state only (06 §4); server data stays in TanStack Query. */
type UiState = {
  activePreview: { taskId: string; tabId: string } | null;
  setActivePreview(preview: { taskId: string; tabId: string } | null): void;
  paletteOpen: boolean;
  setPaletteOpen(open: boolean): void;
  assistantOpen: boolean;
  setAssistantOpen(open: boolean): void;
  /**
   * Bumped to focus the home page's input: there ⌘J and the top bar's assistant button go to the page's own input
   * instead of the panel (D112).
   */
  homeInputFocus: number;
  focusHomeInput(): void;
  /** The conversation shown in the panel; null shows the most recent one. */
  activeConversationId: string | null;
  setActiveConversation(id: string | null): void;
  /** The latest request of the assistant; `seq` tells a repeated request from the one already handled. */
  assistantRequest: { seq: number; request: AssistantUiRequest } | null;
  requestFromAssistant(request: AssistantUiRequest): void;
  /**
   * Values an `open_form` request prefills, until the form it names is submitted or closed; `seq` remounts a form
   * that is already open so it takes the new values.
   */
  pendingForm: PendingForm | null;
  setPendingForm(form: PendingForm | null): void;
  /** An `export_deck` request, until the PPT's page runs it as its export buttons do (28 §4). */
  pendingExport: PendingExport | null;
  setPendingExport(pendingExport: PendingExport | null): void;
  /** Conversation streams the user opened or closed (25 §4.5), by attempt id, kept until the app reloads. */
  streamOpen: Record<string, boolean>;
  setStreamOpen(attemptId: string, open: boolean): void;
  /** The user's open preview tab of each task (29 §8.1): a change request may attach its page (29 §2.3). */
  previewTabs: Record<string, string>;
  setPreviewTab(taskId: string, tabId: string | null): void;
  /** The AI review the Git workbench shows (27 §4.5), whichever view and history entry: where the user is (15 §2). */
  shownGitReview: string | null;
  setShownGitReview(reviewId: string | null): void;
  /** The project the team page showed last (33 §5.1), until the app reloads. */
  teamProjectId: string | null;
  setTeamProject(projectId: string): void;
};

export type PendingForm = { seq: number; form: AssistantForm; values: Record<string, unknown> };
export type PendingExport = { seq: number; deckId: string; format: DeckExportFormat };

export const useUiStore = create<UiState>((set) => ({
  activePreview: null,
  setActivePreview: (activePreview) => set({ activePreview }),
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  assistantOpen: false,
  setAssistantOpen: (assistantOpen) => set({ assistantOpen }),
  homeInputFocus: 0,
  focusHomeInput: () => set((s) => ({ homeInputFocus: s.homeInputFocus + 1 })),
  activeConversationId: null,
  setActiveConversation: (activeConversationId) => set({ activeConversationId }),
  assistantRequest: null,
  requestFromAssistant: (request) =>
    set((s) => ({ assistantRequest: { seq: (s.assistantRequest?.seq ?? 0) + 1, request } })),
  pendingForm: null,
  setPendingForm: (pendingForm) => set({ pendingForm }),
  pendingExport: null,
  setPendingExport: (pendingExport) => set({ pendingExport }),
  streamOpen: {},
  setStreamOpen: (attemptId, open) => set((s) => ({ streamOpen: { ...s.streamOpen, [attemptId]: open } })),
  shownGitReview: null,
  setShownGitReview: (shownGitReview) => set({ shownGitReview }),
  teamProjectId: null,
  setTeamProject: (teamProjectId) => set({ teamProjectId }),
  previewTabs: {},
  setPreviewTab: (taskId, tabId) =>
    set((s) => {
      const { [taskId]: _closed, ...rest } = s.previewTabs;
      return { previewTabs: tabId === null ? rest : { ...rest, [taskId]: tabId } };
    }),
}));

/** The prefill the assistant left for `form`, if any (15 §5: never a credential). */
export function usePendingForm(form: AssistantForm): PendingForm | undefined {
  const pending = useUiStore((s) => s.pendingForm);
  return pending?.form === form ? pending : undefined;
}

export const clearPendingForm = () => useUiStore.setState({ pendingForm: null });
