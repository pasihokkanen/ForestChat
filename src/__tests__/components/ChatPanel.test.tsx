import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ChatPanel from "@/components/chat/ChatPanel";

// Mock the zustand store
const mockStore: Record<string, unknown> = {
  messages: [] as Array<{ id: string; session_id: string; role: string; content: string; tool_calls: unknown; created_at: string }>,
  isStreaming: false,
  streamingContent: "",
  toolCalls: [] as Array<{ id: string; name: string; status: string; result?: string }>,
  sessionId: null,
  activeModel: "deepseek/deepseek-v4-flash",
  error: null,
  addMessage: vi.fn(),
  setMessages: vi.fn(),
  appendStreamContent: vi.fn(),
  clearStream: vi.fn(),
  setStreaming: vi.fn(),
  addToolCall: vi.fn(),
  updateToolCall: vi.fn(),
  clearToolCalls: vi.fn(),
  setSessionId: vi.fn(),
  setActiveModel: vi.fn(),
  setError: vi.fn(),
  clearChat: vi.fn(),
  triggerRefetch: vi.fn(),
  selectStand: vi.fn(),
  addChartTab: vi.fn(),
  removeChartTab: vi.fn(),
  clearAllCharts: vi.fn(),
  chartsFullscreen: false,
  chartTabs: [],
  activeChartTab: null,
  highlightedStandIds: [],
};

vi.mock("@/lib/store", () => ({
  useForestStore: vi.fn((selector?: (state: any) => any) => {
    const store = mockStore;
    return selector ? selector(store) : store;
  }),
}));

// Mock child components to isolate ChatPanel logic
vi.mock("@/components/chat/ChatHeader", () => ({
  default: () => <div data-testid="chat-header">Header</div>,
}));

vi.mock("@/components/chat/ChatMessages", () => ({
  default: ({ messages, streamingContent, toolCalls, error }: any) => (
    <div data-testid="chat-messages">
      <span data-testid="msg-count">{messages.length}</span>
      {toolCalls?.length > 0 && <span data-testid="tool-running">{toolCalls[0].name}</span>}
      {error && <span data-testid="error-display">{error}</span>}
    </div>
  ),
}));

vi.mock("@/components/chat/ChatInput", () => ({
  default: ({ onSend, disabled }: any) => (
    <div data-testid="chat-input">
      <button data-testid="send-btn" disabled={disabled} onClick={() => onSend("test")}>
        Send
      </button>
    </div>
  ),
}));

vi.mock("@/components/chat/ToolCallBar", () => ({
  default: ({ toolCalls }: any) =>
    toolCalls?.length > 0 ? <div data-testid="tool-call-bar">ToolCallBar</div> : null,
}));

// Mock fetch for the GET /api/chat history call
beforeEach(() => {
  vi.clearAllMocks();
  mockStore.messages = [];
  mockStore.isStreaming = false;
  mockStore.streamingContent = "";
  mockStore.toolCalls = [];
  mockStore.sessionId = null;
  mockStore.error = null;

  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ session_id: null, messages: [], model: null }),
  } as Response);
});

describe("ChatPanel", () => {
  it("renders header and empty state when no messages", async () => {
    render(<ChatPanel forestId="forest-1" />);

    expect(screen.getByTestId("chat-header")).toBeTruthy();
    expect(screen.getByTestId("chat-messages")).toBeTruthy();
    expect(screen.getByTestId("chat-input")).toBeTruthy();
  });

  it("passes messages and streaming state to ChatMessages", async () => {
    mockStore.messages = [
      {
        id: "1", session_id: "s1", role: "user" as const,
        content: "hello", tool_calls: null, created_at: new Date().toISOString(),
      },
    ];
    mockStore.streamingContent = "Generating...";
    mockStore.isStreaming = true;

    render(<ChatPanel forestId="forest-1" />);
    expect(screen.getByTestId("chat-messages")).toBeTruthy();
  });

  it("disables ChatInput when streaming", async () => {
    mockStore.isStreaming = true;
    render(<ChatPanel forestId="forest-1" />);

    const sendBtn = screen.getByTestId("send-btn");
    expect(sendBtn).toBeDisabled();
  });

  it("loads conversation history on mount", async () => {
    render(<ChatPanel forestId="forest-1" />);

    // Should fetch existing conversation
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/chat?forest_id=forest-1"),
    );
  });
});
