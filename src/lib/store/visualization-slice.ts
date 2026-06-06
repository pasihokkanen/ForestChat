import type { StateCreator } from "zustand";

export interface ChartTab {
  id: string;
  title_en: string;
  title_fi?: string | null;
  type:
    | "bar"
    | "pie"
    | "line"
    | "area"
    | "stacked_bar"
    | "scatter"
    | "radar"
    | "donut"
    | "horizontal_bar"
    | "composed"
    | "waterfall";
  data: Record<string, unknown>[];
  x_key: string | null;
  y_key: string;
  y_key2: string | null;
  name_key: string | null;
  color_key: string | null;
  query_config?: Record<string, unknown> | null;
  computed_at?: string | null;
  /** Starting value for waterfall charts (e.g., current total volume). */
  waterfall_base?: number | null;
}

export interface VisualizationSlice {
  chartTabs: ChartTab[];
  activeChartTab: string | null;
  addChartTab: (tab: ChartTab) => void;
  removeChartTab: (id: string) => void;
  clearAllCharts: () => void;
  setChartTabs: (tabs: ChartTab[]) => void;
  setActiveChartTab: (id: string | null) => void;

  chartsFullscreen: boolean;
  setChartsFullscreen: (v: boolean) => void;

  selectedYear: number | null;
  setSelectedYear: (year: number | null) => void;

  highlightedStandIds: string[];
  setHighlightedStands: (ids: string[]) => void;

  /** Operation-level highlighting for list-row visual feedback only (charts use aggregated data) */
  highlightedOperationIds: string[];
  setHighlightedOperations: (ids: string[]) => void;
}

export function persistActiveTab(forestId: string, tabId: string | null) {
  try {
    if (tabId) {
      localStorage.setItem("forestchat_activeChart_" + forestId, tabId);
    } else {
      localStorage.removeItem("forestchat_activeChart_" + forestId);
    }
  } catch {
    // ignore quota errors
  }
}

export function restoreActiveTab(forestId: string): string | null {
  try {
    return localStorage.getItem("forestchat_activeChart_" + forestId);
  } catch {
    return null;
  }
}

export const createVisualizationSlice: StateCreator<VisualizationSlice> = (
  set,
  _get
) => ({
  chartTabs: [],
  activeChartTab: null,

  addChartTab: (tab) =>
    set((state) => {
      const existing = state.chartTabs.findIndex((t) => t.id === tab.id);
      const isNew = existing < 0;
      const chartTabs =
        existing >= 0
          ? [
              ...state.chartTabs.slice(0, existing),
              tab,
              ...state.chartTabs.slice(existing + 1),
            ]
          : [...state.chartTabs, tab];
      // Only switch to the new tab if it's genuinely new (not a refresh of an existing chart)
      return { chartTabs, activeChartTab: isNew ? tab.id : state.activeChartTab };
    }),

  removeChartTab: (id) =>
    set((state) => {
      const chartTabs = state.chartTabs.filter((t) => t.id !== id);
      const activeChartTab =
        state.activeChartTab === id
          ? chartTabs.length > 0
            ? chartTabs[chartTabs.length - 1].id
            : null
          : state.activeChartTab;
      return { chartTabs, activeChartTab };
    }),

  clearAllCharts: () =>
    set({ chartTabs: [], activeChartTab: null }),

  setActiveChartTab: (id) => set({ activeChartTab: id }),

  setChartTabs: (tabs) =>
    set({
      chartTabs: tabs,
    }),

  setChartsFullscreen: (v) => set({ chartsFullscreen: v }),

  chartsFullscreen: false,

  selectedYear: null,
  setSelectedYear: (year) => set({ selectedYear: year }),

  highlightedStandIds: [],
  setHighlightedStands: (ids) => set({ highlightedStandIds: ids }),

  highlightedOperationIds: [],
  setHighlightedOperations: (ids) => set({ highlightedOperationIds: ids }),
});
