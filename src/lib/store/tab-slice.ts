import type { StateCreator } from "zustand";

export type MainTab = "map" | "stands" | "operations";

export interface TabSlice {
  activeMainTab: MainTab;
  setActiveMainTab: (tab: MainTab) => void;

  /** AI-pushed filter criteria for StandList filter bar */
  aiStandFilters: Record<string, unknown> | null;
  setAiStandFilters: (filters: Record<string, unknown> | null) => void;

  /** AI-pushed filter criteria for OperationList filter bar */
  aiOperationFilters: Record<string, unknown> | null;
  setAiOperationFilters: (filters: Record<string, unknown> | null) => void;
}

export const createTabSlice: StateCreator<TabSlice> = (set) => ({
  activeMainTab: "map",
  setActiveMainTab: (tab) => set({ activeMainTab: tab }),

  aiStandFilters: null,
  setAiStandFilters: (filters) => set({ aiStandFilters: filters }),

  aiOperationFilters: null,
  setAiOperationFilters: (filters) => set({ aiOperationFilters: filters }),
});
