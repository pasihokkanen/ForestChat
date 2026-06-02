import { create } from "zustand";
import { createMapSlice, type MapSlice } from "./map-slice";
import { createForestSlice, type ForestSlice } from "./forest-slice";
import { createChatSlice, type ChatSlice } from "./chat-slice";
import { createVisualizationSlice, type VisualizationSlice } from "./visualization-slice";
import { createTabSlice, type TabSlice } from "./tab-slice";

export type ForestStore = MapSlice & ForestSlice & ChatSlice & VisualizationSlice & TabSlice;

export const useForestStore = create<ForestStore>()((...a) => ({
  ...createMapSlice(...a),
  ...createForestSlice(...a),
  ...createChatSlice(...a),
  ...createVisualizationSlice(...a),
  ...createTabSlice(...a),
}));
