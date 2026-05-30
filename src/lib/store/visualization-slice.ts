import type { StateCreator } from "zustand";

export interface ChartTab {
  id: string;
  title: string;
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
  xKey: string | null;
  yKey: string;
  yKey2: string | null;
  nameKey: string | null;
  colorKey: string | null;
  standDimension: string | null;
  query_config?: Record<string, unknown> | null;
  computed_at?: string | null;
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
}

function persistActiveTab(forestId: string, tabId: string | null) {
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

function restoreActiveTab(forestId: string): string | null {
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

  setActiveChartTab: (id) => {
    // Persist to localStorage for page reload resilience
    if (typeof window !== "undefined") {
      const match = document.cookie.match(/forest_id=([^;]+)/);
      if (match) {
        persistActiveTab(match[1], id);
      }
    }
    set({ activeChartTab: id });
  },

  setChartTabs: (tabs) =>
    set((state) => {
      let activeId = state.activeChartTab;
      // If the persisted active tab is still in the list, use it
      if (activeId === null || !tabs.some((t) => t.id === activeId)) {
        // Try to restore from localStorage
        if (typeof window !== "undefined") {
          const match = document.cookie.match(/forest_id=([^;]+)/);
          if (match) {
            const saved = restoreActiveTab(match[1]);
            if (saved && tabs.some((t) => t.id === saved)) {
              activeId = saved;
            } else {
              activeId = tabs.length > 0 ? tabs[tabs.length - 1].id : null;
            }
          } else {
            activeId = tabs.length > 0 ? tabs[tabs.length - 1].id : null;
          }
        } else {
          activeId = tabs.length > 0 ? tabs[tabs.length - 1].id : null;
        }
      }
      return { chartTabs: tabs, activeChartTab: activeId };
    }),

  setChartsFullscreen: (v) => set({ chartsFullscreen: v }),

  chartsFullscreen: false,

  selectedYear: null,
  setSelectedYear: (year) => set({ selectedYear: year }),

  highlightedStandIds: [],
  setHighlightedStands: (ids) => set({ highlightedStandIds: ids }),
});
