import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import ChatMessages from "@/components/chat/ChatMessages";
import type { ChatMessage } from "@/types/database";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function makeMsg(overrides: Partial<{
  id: string;
  session_id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  created_at: string;
}> = {}): ChatMessage {
  return {
    id: "msg-1",
    session_id: "session-1",
    role: "user",
    content: "Hello",
    created_at: "2026-01-01T00:00:00Z",
    tool_calls: null,
    ...overrides,
  };
}

describe("ChatMessages", () => {
  it("shows empty state when no messages, streaming, or error", () => {
    render(
      <ChatMessages
        messages={[]}
        streamingContent=""
        toolCallStatus={null}
        error={null}
      />
    );
    expect(screen.getByText("Ask about your forest plan")).toBeInTheDocument();
    expect(
      screen.getByText(/Generate a plan/)
    ).toBeInTheDocument();
  });

  it("does not show empty state when messages exist", () => {
    render(
      <ChatMessages
        messages={[makeMsg({ role: "user", content: "Hi" })]}
        streamingContent=""
        toolCallStatus={null}
        error={null}
      />
    );
    expect(screen.queryByText("Ask about your forest plan")).not.toBeInTheDocument();
    expect(screen.getByText("Hi")).toBeInTheDocument();
  });

  it("does not show empty state when streaming", () => {
    render(
      <ChatMessages
        messages={[]}
        streamingContent="Streaming..."
        toolCallStatus={null}
        error={null}
      />
    );
    expect(screen.queryByText("Ask about your forest plan")).not.toBeInTheDocument();
    expect(screen.getByText("Streaming...")).toBeInTheDocument();
  });

  it("does not show empty state when error is present", () => {
    render(
      <ChatMessages
        messages={[]}
        streamingContent=""
        toolCallStatus={null}
        error="Something went wrong"
      />
    );
    expect(screen.queryByText("Ask about your forest plan")).not.toBeInTheDocument();
  });

  it("renders user messages right-aligned", () => {
    render(
      <ChatMessages
        messages={[makeMsg({ role: "user", content: "User message" })]}
        streamingContent=""
        toolCallStatus={null}
        error={null}
      />
    );
    const container = screen.getByText("User message").closest(".flex");
    expect(container).toHaveClass("justify-end");
  });

  it("renders assistant messages left-aligned", () => {
    render(
      <ChatMessages
        messages={[makeMsg({ role: "assistant", content: "Assistant reply" })]}
        streamingContent=""
        toolCallStatus={null}
        error={null}
      />
    );
    const container = screen.getByText("Assistant reply").closest(".flex");
    expect(container).toHaveClass("justify-start");
  });

  it("filters out tool role messages", () => {
    render(
      <ChatMessages
        messages={[
          makeMsg({ id: "m1", role: "user", content: "Hello" }),
          makeMsg({ id: "m2", role: "tool", content: "tool result" }),
        ]}
        streamingContent=""
        toolCallStatus={null}
        error={null}
      />
    );
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.queryByText("tool result")).not.toBeInTheDocument();
  });

  it("shows ToolCallCard when toolCallStatus is set", () => {
    render(
      <ChatMessages
        messages={[]}
        streamingContent=""
        toolCallStatus={{ name: "generate_plan", status: "running" }}
        error={null}
      />
    );
    expect(screen.getByText("Generating plan…")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("shows streaming content with blinking cursor", () => {
    const { container } = render(
      <ChatMessages
        messages={[]}
        streamingContent="Partial response"
        toolCallStatus={null}
        error={null}
      />
    );
    expect(screen.getByText("Partial response")).toBeInTheDocument();
    const cursor = container.querySelector(".animate-pulse");
    expect(cursor).toBeInTheDocument();
  });

  it("shows error banner", () => {
    render(
      <ChatMessages
        messages={[]}
        streamingContent=""
        toolCallStatus={null}
        error="Network failure"
      />
    );
    expect(screen.getByText("⚠️ Network failure")).toBeInTheDocument();
  });

  it("renders multiple messages in order", () => {
    render(
      <ChatMessages
        messages={[
          makeMsg({ id: "m1", role: "user", content: "First" }),
          makeMsg({ id: "m2", role: "assistant", content: "Second" }),
          makeMsg({ id: "m3", role: "user", content: "Third" }),
        ]}
        streamingContent=""
        toolCallStatus={null}
        error={null}
      />
    );
    const texts = screen.getAllByText(/First|Second|Third/);
    expect(texts).toHaveLength(3);
    expect(texts[0]).toHaveTextContent("First");
    expect(texts[1]).toHaveTextContent("Second");
    expect(texts[2]).toHaveTextContent("Third");
  });
});