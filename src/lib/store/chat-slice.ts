import type { StateCreator } from "zustand";
import type { ChatMessage } from "@/types/database";

export interface ChatSlice {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  toolCallStatus: {
    name: string;
    status: "running" | "done" | "error";
    result?: string;
  } | null;
  sessionId: string | null;
  activeModel: string;
  commandsOpen: boolean;
  error: string | null;

  addMessage: (msg: ChatMessage) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  setStreaming: (v: boolean) => void;
  appendStreamContent: (chunk: string) => void;
  clearStream: () => void;
  setToolCall: (status: ChatSlice["toolCallStatus"]) => void;
  setSessionId: (id: string) => void;
  setActiveModel: (model: string) => void;
  toggleCommands: () => void;
  setError: (err: string | null) => void;
  clearChat: () => void;
}

const initialState = {
  messages: [] as ChatMessage[],
  isStreaming: false,
  streamingContent: "",
  toolCallStatus: null as ChatSlice["toolCallStatus"],
  sessionId: null as string | null,
  activeModel: "deepseek/deepseek-v4-flash",
  commandsOpen: false,
  error: null as string | null,
};

export const createChatSlice: StateCreator<ChatSlice> = (set) => ({
  ...initialState,

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  setMessages: (msgs) => set({ messages: msgs }),

  setStreaming: (v) => set({ isStreaming: v }),

  appendStreamContent: (chunk) =>
    set((state) => ({ streamingContent: state.streamingContent + chunk })),

  clearStream: () => set({ streamingContent: "" }),

  setToolCall: (status) => set({ toolCallStatus: status }),

  setSessionId: (id) => set({ sessionId: id }),

  setActiveModel: (model) => set({ activeModel: model }),

  toggleCommands: () =>
    set((state) => ({ commandsOpen: !state.commandsOpen })),

  setError: (err) => set({ error: err }),

  clearChat: () => set(initialState),
});