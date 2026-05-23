import { create } from "zustand";
import { createMapSlice, type MapSlice } from "./map-slice";
import { createForestSlice, type ForestSlice } from "./forest-slice";
import { createChatSlice, type ChatSlice } from "./chat-slice";

export type ForestStore = MapSlice & ForestSlice & ChatSlice;

export const useForestStore = create<ForestStore>()((...a) => ({
  ...createMapSlice(...a),
  ...createForestSlice(...a),
  ...createChatSlice(...a),
}));
