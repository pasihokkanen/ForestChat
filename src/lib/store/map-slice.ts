import type { StateCreator } from "zustand";

export interface MapSlice {
  // Viewport
  zoom: number;
  center: [number, number]; // [lng, lat]
  setViewport: (zoom: number, center: [number, number]) => void;

  // Selection
  selectedStandId: string | null;
  selectStand: (standId: string | null) => void;

  // Cursor
  hoveredStandId: string | null;
  setHoveredStand: (standId: string | null) => void;

  // Pending stand selection (for "Show on map" before map is mounted)
  pendingStandSelection: string | null;
  setPendingStandSelection: (standId: string | null) => void;
  consumePendingSelection: () => string | null;
}

export const createMapSlice: StateCreator<MapSlice> = (set, get) => ({
  zoom: 6,
  center: [24.0, 62.5],
  setViewport: (zoom, center) => set({ zoom, center }),
  selectedStandId: null,
  selectStand: (standId) => set({ selectedStandId: standId }),
  hoveredStandId: null,
  setHoveredStand: (standId) => set({ hoveredStandId: standId }),

  pendingStandSelection: null,
  setPendingStandSelection: (standId) => set({ pendingStandSelection: standId }),
  consumePendingSelection: () => {
    const id = get().pendingStandSelection;
    if (id) set({ pendingStandSelection: null });
    return id;
  },
});
