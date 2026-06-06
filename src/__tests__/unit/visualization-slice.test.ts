// src/__tests__/unit/visualization-slice.test.ts
// Phase 4.14 — Unit tests for the VisualizationSlice Zustand slice

import { describe, it, expect, beforeEach } from "vitest";
import { create } from "zustand";
import type { StateCreator } from "zustand";
import {
  createVisualizationSlice,
  type VisualizationSlice,
  type ChartTab,
} from "@/lib/store/visualization-slice";

function createTestStore() {
  return create<VisualizationSlice>()((...a) => ({
    ...createVisualizationSlice(...a),
  }));
}

const makeTab = (overrides: Partial<ChartTab> = {}): ChartTab => ({
  id: "chart-1",
  title_en: "Test Chart",
  type: "bar",
  data: [{ year: 2026, income: 50000 }],
  x_key: "year",
  y_key: "income",
  y_key2: null,
  name_key: null,
  color_key: null,
  ...overrides,
} as ChartTab);

describe("VisualizationSlice", () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
  });

  describe("addChartTab", () => {
    it("adds a chart tab and auto-selects it", () => {
      const tab = makeTab();
      store.getState().addChartTab(tab);
      const state = store.getState();
      expect(state.chartTabs).toHaveLength(1);
      expect(state.chartTabs[0].id).toBe("chart-1");
      expect(state.activeChartTab).toBe("chart-1");
    });

    it("upserts existing tab with same id", () => {
      store.getState().addChartTab(makeTab({ id: "chart-1", title_en: "First" }));
      store.getState().addChartTab(makeTab({ id: "chart-1", title_en: "Updated" }));
      const state = store.getState();
      expect(state.chartTabs).toHaveLength(1);
      expect(state.chartTabs[0].title_en).toBe("Updated");
      expect(state.activeChartTab).toBe("chart-1");
    });

    it("adds multiple tabs and selects the latest", () => {
      store.getState().addChartTab(makeTab({ id: "a", title_en: "A" }));
      store.getState().addChartTab(makeTab({ id: "b", title_en: "B" }));
      const state = store.getState();
      expect(state.chartTabs).toHaveLength(2);
      expect(state.activeChartTab).toBe("b");
    });
  });

  describe("removeChartTab", () => {
    it("removes a tab by id", () => {
      store.getState().addChartTab(makeTab({ id: "a" }));
      store.getState().addChartTab(makeTab({ id: "b" }));
      store.getState().removeChartTab("a");
      const state = store.getState();
      expect(state.chartTabs).toHaveLength(1);
      expect(state.chartTabs[0].id).toBe("b");
    });

    it("switches to the previous (last) tab when removing active", () => {
      store.getState().addChartTab(makeTab({ id: "a", title_en: "A" }));
      store.getState().addChartTab(makeTab({ id: "b", title_en: "B" }));
      // "b" is active; removing it should switch to "a"
      store.getState().removeChartTab("b");
      const state = store.getState();
      expect(state.activeChartTab).toBe("a");
    });

    it("sets activeChartTab to null when removing last tab", () => {
      store.getState().addChartTab(makeTab({ id: "last" }));
      store.getState().removeChartTab("last");
      const state = store.getState();
      expect(state.chartTabs).toHaveLength(0);
      expect(state.activeChartTab).toBeNull();
    });

    it("does not change active tab when removing inactive", () => {
      store.getState().addChartTab(makeTab({ id: "a" }));
      store.getState().addChartTab(makeTab({ id: "b" }));
      store.getState().addChartTab(makeTab({ id: "c" }));
      // "c" is active; removing "a" should keep "c" active
      store.getState().removeChartTab("a");
      expect(store.getState().activeChartTab).toBe("c");
    });
  });

  describe("clearAllCharts", () => {
    it("removes all tabs and sets activeChartTab to null", () => {
      store.getState().addChartTab(makeTab({ id: "a" }));
      store.getState().addChartTab(makeTab({ id: "b" }));
      store.getState().clearAllCharts();
      const state = store.getState();
      expect(state.chartTabs).toHaveLength(0);
      expect(state.activeChartTab).toBeNull();
    });
  });

  describe("setChartTabs", () => {
    it("replaces tabs without changing activeChartTab", () => {
      const tabs = [
        makeTab({ id: "a", title_en: "A" }),
        makeTab({ id: "b", title_en: "B" }),
      ];
      // setChartTabs replaces data but callers (use-charts, ChatPanel SSE)
      // manage activeChartTab themselves — do NOT auto-select
      store.getState().setChartTabs(tabs);
      const state = store.getState();
      expect(state.chartTabs).toHaveLength(2);
      expect(state.activeChartTab).toBeNull(); // untouched
    });

    it("sets activeChartTab to null for empty array", () => {
      store.getState().setChartTabs([]);
      expect(store.getState().activeChartTab).toBeNull();
    });
  });

  describe("setSelectedYear", () => {
    it("updates selectedYear", () => {
      store.getState().setSelectedYear(2028);
      expect(store.getState().selectedYear).toBe(2028);
    });

    it("clears selectedYear", () => {
      store.getState().setSelectedYear(2028);
      store.getState().setSelectedYear(null);
      expect(store.getState().selectedYear).toBeNull();
    });
  });

  describe("setHighlightedStands", () => {
    it("updates highlightedStandIds", () => {
      store.getState().setHighlightedStands(["5", "12"]);
      expect(store.getState().highlightedStandIds).toEqual(["5", "12"]);
    });

    it("clears highlighted stand ids", () => {
      store.getState().setHighlightedStands(["5"]);
      store.getState().setHighlightedStands([]);
      expect(store.getState().highlightedStandIds).toEqual([]);
    });
  });

  describe("chartsFullscreen", () => {
    it("toggles fullscreen", () => {
      expect(store.getState().chartsFullscreen).toBe(false);
      store.getState().setChartsFullscreen(true);
      expect(store.getState().chartsFullscreen).toBe(true);
      store.getState().setChartsFullscreen(false);
      expect(store.getState().chartsFullscreen).toBe(false);
    });
  });
});