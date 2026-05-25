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

export const createVisualizationSlice: StateCreator<VisualizationSlice> = (
  set,
  _get
) => ({
  chartTabs: [],
  activeChartTab: null,

  addChartTab: (tab) =>
    set((state) => {
      const existing = state.chartTabs.findIndex((t) => t.id === tab.id);
      const chartTabs =
        existing >= 0
          ? [
              ...state.chartTabs.slice(0, existing),
              tab,
              ...state.chartTabs.slice(existing + 1),
            ]
          : [...state.chartTabs, tab];
      return { chartTabs, activeChartTab: tab.id };
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
      activeChartTab: tabs.length > 0 ? tabs[tabs.length - 1].id : null,
    }),

  setChartsFullscreen: (v) => set({ chartsFullscreen: v }),

  chartsFullscreen: false,

  selectedYear: null,
  setSelectedYear: (year) => set({ selectedYear: year }),

  highlightedStandIds: [],
  setHighlightedStands: (ids) => set({ highlightedStandIds: ids }),
});
