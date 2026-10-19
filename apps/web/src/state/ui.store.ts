import { create } from 'zustand';

/** Pure UI state only (06 §4); server data stays in TanStack Query. */
type UiState = { paletteOpen: boolean; setPaletteOpen(open: boolean): void };

export const useUiStore = create<UiState>((set) => ({
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
}));
