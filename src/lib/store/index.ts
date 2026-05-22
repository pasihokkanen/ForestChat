import { create } from "zustand";
import { createMapSlice, type MapSlice } from "./map-slice";
import { createForestSlice, type ForestSlice } from "./forest-slice";

export type ForestStore = MapSlice & ForestSlice;

export const useForestStore = create<ForestStore>()((...a) => ({
  ...createMapSlice(...a),
  ...createForestSlice(...a),
}));
