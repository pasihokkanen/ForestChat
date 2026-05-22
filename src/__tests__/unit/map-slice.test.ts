/**
 * Unit test: Zustand MapSlice (P1.6 — src/lib/store/map-slice.ts)
 *
 * Tests store slice in isolation — no React rendering needed.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { create } from "zustand";
import { createMapSlice, type MapSlice } from "@/lib/store/map-slice";

function createTestStore() {
  return create<MapSlice>()((...a) => ({
    ...createMapSlice(...a),
  }));
}

describe("MapSlice", () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
  });

  describe("initial state", () => {
    it("has default zoom and center for Finland", () => {
      const state = store.getState();
      expect(state.zoom).toBe(6);
      expect(state.center).toEqual([24.0, 62.5]);
    });

    it("has no selected or hovered stand", () => {
      const state = store.getState();
      expect(state.selectedStandId).toBeNull();
      expect(state.hoveredStandId).toBeNull();
    });
  });

  describe("setViewport", () => {
    it("updates zoom and center", () => {
      store.getState().setViewport(12, [25.0, 61.0]);
      const state = store.getState();
      expect(state.zoom).toBe(12);
      expect(state.center).toEqual([25.0, 61.0]);
    });
  });

  describe("selectStand", () => {
    it("sets selected stand ID", () => {
      store.getState().selectStand("stand-1");
      expect(store.getState().selectedStandId).toBe("stand-1");
    });

    it("clears selection with null", () => {
      store.getState().selectStand("stand-1");
      store.getState().selectStand(null);
      expect(store.getState().selectedStandId).toBeNull();
    });
  });

  describe("setHoveredStand", () => {
    it("sets hovered stand ID", () => {
      store.getState().setHoveredStand("stand-5");
      expect(store.getState().hoveredStandId).toBe("stand-5");
    });

    it("clears hover with null", () => {
      store.getState().setHoveredStand("stand-5");
      store.getState().setHoveredStand(null);
      expect(store.getState().hoveredStandId).toBeNull();
    });
  });
});
