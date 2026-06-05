import type { StateCreator } from "zustand";
import type { ChatMessage } from "@/types/database";

export interface ToolCallStatus {
  id: string;
  name: string;
  status: "running" | "done" | "error";
  result?: string;
}

export interface ChatSlice {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  toolCalls: ToolCallStatus[];
  sessionId: string | null;
  activeModel: string;
  commandsOpen: boolean;
  error: string | null;

  addMessage: (msg: ChatMessage) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  setStreaming: (v: boolean) => void;
  appendStreamContent: (chunk: string) => void;
  clearStream: () => void;
  addToolCall: (tc: ToolCallStatus) => void;
  updateToolCall: (id: string, updates: Partial<Pick<ToolCallStatus, "status" | "result">>) => void;
  clearToolCalls: () => void;
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
  toolCalls: [] as ToolCallStatus[],
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

  addToolCall: (tc) =>
    set((state) => ({ toolCalls: [tc, ...state.toolCalls] })),

  updateToolCall: (id, updates) =>
    set((state) => ({
      toolCalls: state.toolCalls.map((tc) =>
        tc.id === id ? { ...tc, ...updates } : tc
      ),
    })),

  clearToolCalls: () => set({ toolCalls: [] }),

  setSessionId: (id) => set({ sessionId: id }),

  setActiveModel: (model) => set({ activeModel: model }),

  toggleCommands: () =>
    set((state) => ({ commandsOpen: !state.commandsOpen })),

  setError: (err) => set({ error: err }),

  clearChat: () => set(initialState),
});
