import { create } from "zustand";
import { createMapSlice, type MapSlice } from "./map-slice";
import { createForestSlice, type ForestSlice } from "./forest-slice";
import { createChatSlice, type ChatSlice } from "./chat-slice";
import { createVisualizationSlice, type VisualizationSlice } from "./visualization-slice";
import { createTabSlice, type TabSlice } from "./tab-slice";
import { createI18nSlice, type I18nSlice } from "./i18n-slice";

export type ForestStore = MapSlice & ForestSlice & ChatSlice & VisualizationSlice & TabSlice & I18nSlice;

export const useForestStore = create<ForestStore>()((...a) => ({
  ...createMapSlice(...a),
  ...createForestSlice(...a),
  ...createChatSlice(...a),
  ...createVisualizationSlice(...a),
  ...createTabSlice(...a),
  ...createI18nSlice(...a),
}));
