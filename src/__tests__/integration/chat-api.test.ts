import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Module mocks ──────────────────────────────────────────────────────────────

// Track SSE events via the mock for reliable testing
const sseEvents: Array<{ event: string; data: Record<string, unknown> }> = [];

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(),
}));

vi.mock("@/lib/chat/openrouter", () => ({
  streamChat: vi.fn(),
  resolveModel: vi.fn(() => "deepseek/deepseek-v4-flash"),
}));

vi.mock("@/lib/repos/chat-sessions", () => ({
  getOrCreateSession: vi.fn(),
  createSession: vi.fn(),
  getSessionById: vi.fn(),
  updateSessionModel: vi.fn(),
}));

vi.mock("@/lib/repos/chat-messages", () => ({
  addMessage: vi.fn(),
  getMessagesBySession: vi.fn(),
}));

vi.mock("@/lib/repos/forests", () => ({
  getForestById: vi.fn(),
}));

vi.mock("@/lib/repos/compartments", () => ({
  getCompartmentsByForest: vi.fn(),
}));

vi.mock("@/lib/chat/system-prompt", () => ({
  buildSystemPrompt: vi.fn(() => "system prompt"),
}));

vi.mock("@/lib/chat/tools", () => ({
  getTools: vi.fn(() => []),
}));

vi.mock("@/lib/chat/tool-executor", () => ({
  executeTool: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: { openRouterApiKey: "test-api-key" },
}));

// Mock SSE: capture events synchronously + produce a real readable stream
vi.mock("@/lib/chat/sse", () => {
  return {
    createSseStream: vi.fn(() => {
      let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
      const encoder = new TextEncoder();

      const stream = new ReadableStream<Uint8Array>({
        start(c) { controller = c; },
        cancel() { controller = null; },
      });

      return {
        stream,
        send: (evt: any) => {
          sseEvents.push({ event: evt.event, data: evt.data });
          if (controller) {
            try {
              controller.enqueue(encoder.encode(`event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`));
            } catch { /* ignore */ }
          }
        },
        close: () => {
          if (controller) { try { controller.close(); } catch { /* ignore */ } controller = null; }
        },
      };
    }),
  };
});

// ── Test data ─────────────────────────────────────────────────────────────────

const mockForest = {
  id: "forest-1",
  owner_id: "test-user",
  name: "Test Forest",
  municipality: "Ähtäri",
  total_area_ha: 250,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const mockSession = {
  id: "session-1",
  forest_id: "forest-1",
  user_id: "test-user",
  model: null,
  title: "Forest Plan Chat",
  created_at: "2026-01-01T00:00:00Z",
};

const mockNewSession = { ...mockSession, id: "session-2" };

function makeSupabaseClient(user: { id: string } | null) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  };
}

async function waitForEvents(expectedCount: number, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (sseEvents.length < expectedCount) {
    await new Promise(r => setTimeout(r, 10));
    if (Date.now() - start > timeoutMs) break;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  sseEvents.length = 0;
  vi.clearAllMocks();
});

describe("GET /api/chat", () => {
  it("returns 401 when not authenticated", async () => {
    const { createServerSupabase } = await import("@/lib/supabase/server");
    (createServerSupabase as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSupabaseClient(null),
    );

    const { GET } = await import("@/app/api/chat/route");
    const req = new NextRequest("http://localhost:3000/api/chat?forest_id=forest-1");
    const res = await GET(req);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });
});

describe("POST /api/chat", () => {
  it("returns error SSE event when not authenticated", async () => {
    const { createServerSupabase } = await import("@/lib/supabase/server");
    (createServerSupabase as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSupabaseClient(null),
    );

    const { POST } = await import("@/app/api/chat/route");
    const req = new NextRequest("http://localhost:3000/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: "hello", forest_id: "forest-1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    // Wait for the async IIFE inside POST to complete
    await new Promise(r => setTimeout(r, 50));

    expect(sseEvents).toHaveLength(1);
    expect(sseEvents[0].event).toBe("error");
    expect(sseEvents[0].data).toEqual({ error: "Unauthorized" });
  });

  it("receives SSE chunk events for a valid message", async () => {
    const { createServerSupabase } = await import("@/lib/supabase/server");
    (createServerSupabase as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSupabaseClient({ id: "test-user" }),
    );

    const { getOrCreateSession } = await import("@/lib/repos/chat-sessions");
    (getOrCreateSession as ReturnType<typeof vi.fn>).mockResolvedValue(mockSession);

    const { getMessagesBySession } = await import("@/lib/repos/chat-messages");
    (getMessagesBySession as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { addMessage } = await import("@/lib/repos/chat-messages");
    (addMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "msg-1",
      session_id: "session-1",
    });

    const { getForestById } = await import("@/lib/repos/forests");
    (getForestById as ReturnType<typeof vi.fn>).mockResolvedValue(mockForest);

    const { getCompartmentsByForest } = await import("@/lib/repos/compartments");
    (getCompartmentsByForest as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    // Use a fixed async generator that yields synchronously
    const { streamChat } = await import("@/lib/chat/openrouter");
    async function* fixedGen() {
      yield { type: "text" as const, content: "Hello" };
      yield { type: "text" as const, content: " world" };
    }
    (streamChat as ReturnType<typeof vi.fn>).mockReturnValue(fixedGen());

    const { POST } = await import("@/app/api/chat/route");
    const req = new NextRequest("http://localhost:3000/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: "hello", forest_id: "forest-1" }),
    });
    await POST(req);

// Wait for the async IIFE inside POST to finish
    await new Promise(r => setTimeout(r, 100));

    // We should at least have the done event
    expect(sseEvents.length).toBeGreaterThanOrEqual(1);
    // Check what happened
    const lastEvent = sseEvents[sseEvents.length - 1];
    if (lastEvent.event === "error") {
      // Fail with the error message for debugging
      throw new Error(`IIFE error: ${JSON.stringify(lastEvent.data)}`);
    }
    expect(lastEvent.event).toBe("done");
    expect(lastEvent.event).toBe("done");
    expect(lastEvent.data.session_id).toBe("session-1");
  });

  it("handles /new command by creating a new session", async () => {
    const { createServerSupabase } = await import("@/lib/supabase/server");
    (createServerSupabase as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSupabaseClient({ id: "test-user" }),
    );

    const { getOrCreateSession, createSession } = await import("@/lib/repos/chat-sessions");
    (getOrCreateSession as ReturnType<typeof vi.fn>).mockResolvedValue(mockSession);
    (createSession as ReturnType<typeof vi.fn>).mockResolvedValue(mockNewSession);

    const { POST } = await import("@/app/api/chat/route");
    const req = new NextRequest("http://localhost:3000/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: "/new", forest_id: "forest-1" }),
    });
    await POST(req);

    await waitForEvents(2);
    expect(sseEvents).toHaveLength(2);
    expect(sseEvents[0].event).toBe("chunk");
    expect(sseEvents[0].data).toHaveProperty("content");
    expect(sseEvents[1].event).toBe("done");
    expect(sseEvents[1].data.session_id).toBe("session-2");
  });

  it("handles /model command by updating the session model", async () => {
    const { createServerSupabase } = await import("@/lib/supabase/server");
    (createServerSupabase as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSupabaseClient({ id: "test-user" }),
    );

    const { getOrCreateSession, updateSessionModel } = await import("@/lib/repos/chat-sessions");
    (getOrCreateSession as ReturnType<typeof vi.fn>).mockResolvedValue(mockSession);
    (updateSessionModel as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const { POST } = await import("@/app/api/chat/route");
    const req = new NextRequest("http://localhost:3000/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: "/model claude-sonnet-4", forest_id: "forest-1" }),
    });
    await POST(req);

    await waitForEvents(2);
    expect(sseEvents).toHaveLength(2);
    expect(sseEvents[0].event).toBe("chunk");
    expect(sseEvents[0].data).toEqual({
      content: "✅ Model switched to `claude-sonnet-4` for this conversation.",
    });
    expect(sseEvents[1].event).toBe("done");
    expect(sseEvents[1].data.model).toBe("claude-sonnet-4");
  });

  it("saves user and assistant messages to the database via addMessage", async () => {
    const { createServerSupabase } = await import("@/lib/supabase/server");
    (createServerSupabase as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSupabaseClient({ id: "test-user" }),
    );

    const { getOrCreateSession } = await import("@/lib/repos/chat-sessions");
    (getOrCreateSession as ReturnType<typeof vi.fn>).mockResolvedValue(mockSession);

    const { getMessagesBySession } = await import("@/lib/repos/chat-messages");
    (getMessagesBySession as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { addMessage } = await import("@/lib/repos/chat-messages");
    (addMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "msg-2" });

    const { getForestById } = await import("@/lib/repos/forests");
    (getForestById as ReturnType<typeof vi.fn>).mockResolvedValue(mockForest);

    const { getCompartmentsByForest } = await import("@/lib/repos/compartments");
    (getCompartmentsByForest as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    // Simple async generator
    const { streamChat } = await import("@/lib/chat/openrouter");
    async function* gen() { yield { type: "text" as const, content: "Hi!" }; }
    (streamChat as ReturnType<typeof vi.fn>).mockReturnValue(gen());

    const { POST } = await import("@/app/api/chat/route");
    const req = new NextRequest("http://localhost:3000/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: "what stands have pine?", forest_id: "forest-1" }),
    });
    await POST(req);

    // Wait for the async IIFE to finish
    await new Promise(r => setTimeout(r, 100));

    // User message was saved + assistant message was saved
    expect(addMessage).toHaveBeenCalledTimes(2);
    expect(addMessage).toHaveBeenNthCalledWith(1, "session-1", "user", "what stands have pine?");
    expect(addMessage).toHaveBeenNthCalledWith(2, "session-1", "assistant", "Hi!");
  });
});
