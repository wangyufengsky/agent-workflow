import type { AssistantForm, AssistantPageRef } from '@aw/shared';
import { create } from 'zustand';

/** What the assistant asked the renderer to do (15 §3): the shell carries it out once. */
export type AssistantUiRequest =
  | { kind: 'navigate'; target: AssistantPageRef }
  | { kind: 'form'; form: AssistantForm; values: Record<string, unknown> }
  | { kind: 'reveal'; absolutePath: string };

/** Pure UI state only (06 §4); server data stays in TanStack Query. */
type UiState = {
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
};

export type PendingForm = { seq: number; form: AssistantForm; values: Record<string, unknown> };

export const useUiStore = create<UiState>((set) => ({
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
}));

/** The prefill the assistant left for `form`, if any (15 §5: never a credential). */
export function usePendingForm(form: AssistantForm): PendingForm | undefined {
  const pending = useUiStore((s) => s.pendingForm);
  return pending?.form === form ? pending : undefined;
}

export const clearPendingForm = () => useUiStore.setState({ pendingForm: null });
