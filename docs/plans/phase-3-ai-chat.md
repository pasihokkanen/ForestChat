# ForestChat — Phase 3: AI Chat System

> **For Hermes:** Load subagent-driven-development skill before implementing. Use OpenCode CLI for coding subagents. Update this plan file to mark tasks as ✅ upon completion.

**Goal:** Build the AI-powered forest management chat — the core interaction model where users generate forest plans, ask questions about stands, and request plan modifications through natural language conversation.

**Architecture:** Phase 3 delivers four subsystems: (1) a streaming chat API endpoint that proxies OpenRouter with function calling and tool execution; (2) a `generate_plan` tool (port of the Python algorithm `build_plan_v3_fixed.py`) that generates a complete 20-year management plan in a single function call; (3) editing & query tools (`get_stand`, `search_stands`, `add_operation`, `remove_operation`, `plan_summary`, `year_operations`, `check_harvest_sustainability`, `validate_plan`); and (4) a ChatGPT-style chat panel with streaming message display and tool call progress.

**Two-mode AI architecture** (from architecture plan section 5.1):
- **Generation mode**: "Generate a 20-year plan" → one function call → algorithm runs → all operations stored at once (~2K tokens)
- **Editing mode**: "Move stand 7 clearcut to 2030" → iterative function calling (~2-5K tokens)

**Tech Stack:** Next.js 16.2 (App Router), TypeScript strict, OpenRouter API (streaming, function calling), Supabase (chat_sessions, chat_messages), Zustand 5 (chat slice), SSE streaming, Tailwind CSS 4

**Prerequisites (Phase 0+1+2 — DONE):**
- ✅ Next.js 16.2 with App Router, TypeScript strict
- ✅ Supabase Auth + middleware + RLS
- ✅ ForestLayout shell with header + UserMenu
- ✅ ForestView with MapLibre + StandLayer
- ✅ Supabase repos: compartments, forests, operations, plan-metadata
- ✅ Supabase tables: `chat_sessions`, `chat_messages` exist in schema (`001_initial_schema.sql`)
- ✅ Test infrastructure: Vitest, React Testing Library, MSW
- ✅ Python reference script: `~/Metsa/build_plan_v3_fixed.py` (1091 lines)
- ✅ Environment variables: `OPENROUTER_API_KEY` set

**⚠️ New prerequisite (Phase 3):**
- ✅ New migration: `003_add_chat_model.sql` — adds `model TEXT` column to `chat_sessions` for per-session model selection (2026-05-23)
- ✅ New env var: `OPENROUTER_MODEL` (optional, default: `deepseek/deepseek-v4-flash` if unset)

**⚠️ Next.js 16 notes:**
- `params` in route handlers is `Promise<{ id: string }>` — must `await params`
- Route handlers use default exports (no named exports for `GET`/`POST` unless legacy pattern)
- SSE streaming: Use `ReadableStream` with `TextEncoder` — standard Web API pattern
- `SUPABASE_SECRET_KEY` (new-style `sb_secret_*` key) for admin operations

---

## Task Structure

```
Track A: Chat Backend Infrastructure
  T6.1 → Chat session & message repos (0.75h) [+ createSession, updateSessionModel]
  T6.2 → SSE streaming utility (0.5h)
                                    ↓ (wait for T8.4)
  T6.3 → Streaming chat API route (3h) [+ /new, /model commands, dynamic model]

Track B: Forestry Engine (port from Python)
  T7.1 → Forestry config & types (1h)
  T7.2 → Stand classification & value (2h)
  T7.3 → Scheduling engine (3h)
  T7.4 → generate_plan handler (2h)
                                    ↓
Track C: Editing & Query Tools
  T8.1 → Query tools (1.5h)
  T8.2 → Editing tools (1.5h)
  T8.3 → Validation tools (1.5h)
  T8.4 → Tool registration & system prompt (1.5h) ──────► T6.3

Track D: Chat UI
  T9.1 → Zustand chat slice + SSE client (1h) [+ activeModel, commandsOpen]
  T9.2 → ChatPanel component (1.5h) [+ CommandsMenu, model display]
  T9.3 → ChatMessages + ChatInput (2h)
  T9.4 → Integrate into ForestView (1h)

Track E: Tests
  T10.1 → Forestry engine unit tests (1h)
  T10.2 → Chat API integration tests (1h) [+ chat-commands.test.ts]
  T10.3 → Chat UI component tests (1h)

Total: ~23h (+0.5h for DB migration + command plumbing)
```

### Dependency Graph

```
T6.1 ──► T6.2 ────────────► T6.3 (needs T8.4)
                              │
T7.1 ──► T7.2 ──► T7.3 ──► T7.4 ──► T8.4 (tool registration)
                                      │
T8.1 ──┐                             │
T8.2 ──┤► T8.4 (depends on T7.4)     │
T8.3 ──┘                             │
                                      │
T9.1 ──► T9.2 ──► T9.3 ──► T9.4 (needs T6.3)
                                     │
                          T10.1, T10.2, T10.3 (after everything)
```

---

## Track A: Chat Backend Infrastructure

### T6.1 — Chat Session & Message Repos (0.75h) 

**Objective:** Create typed repository functions for `chat_sessions` and `chat_messages` Supabase tables. These repos handle create, read, and list operations — no updates or deletes for MVP.

**Files:**
- Create: `src/lib/repos/chat-sessions.ts`
- Create: `src/lib/repos/chat-messages.ts`

**Chat sessions repo (`src/lib/repos/chat-sessions.ts`):**

```typescript
import type { ChatSession } from "@/types/database";
import { createServerSupabase } from "@/lib/supabase/server";

export async function getOrCreateSession(
  forestId: string,
  userId: string,
  title?: string
): Promise<ChatSession> {
  const supabase = await createServerSupabase();

  // Check for existing active session
  const { data: existing } = await supabase
    .from("chat_sessions")
    .select("*")
    .eq("forest_id", forestId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (existing) {
    return existing as ChatSession;
  }

  // Create new session
  const { data, error } = await supabase
    .from("chat_sessions")
    .insert({
      forest_id: forestId,
      user_id: userId,
      title: title ?? "Forest Plan Chat",
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create session: ${error.message}`);
  return data as ChatSession;
}

export async function getSessionById(
  sessionId: string
): Promise<ChatSession | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("chat_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(`Failed to fetch session: ${error.message}`);
  }
  return data as ChatSession;
}

/** Create a fresh session (used by /new command) */
export async function createSession(
  forestId: string,
  userId: string,
  title?: string,
  model?: string
): Promise<ChatSession> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("chat_sessions")
    .insert({
      forest_id: forestId,
      user_id: userId,
      title: title ?? "Forest Plan Chat",
      model: model ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to create session: ${error.message}`);
  return data as ChatSession;
}

/** Update the model for a session (used by /model command) */
export async function updateSessionModel(
  sessionId: string,
  model: string
): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("chat_sessions")
    .update({ model })
    .eq("id", sessionId);
  if (error) throw new Error(`Failed to update model: ${error.message}`);
}
```

**Chat messages repo (`src/lib/repos/chat-messages.ts`):**

```typescript
import type { ChatMessage } from "@/types/database";
import { createServerSupabase } from "@/lib/supabase/server";

export async function getMessagesBySession(
  sessionId: string
): Promise<ChatMessage[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to fetch messages: ${error.message}`);
  return (data as ChatMessage[]) ?? [];
}

export async function addMessage(
  sessionId: string,
  role: "user" | "assistant" | "tool",
  content: string,
  toolCalls?: unknown
): Promise<ChatMessage> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      session_id: sessionId,
      role,
      content,
      tool_calls: toolCalls ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to add message: ${error.message}`);
  return data as ChatMessage;
}
```

**⚠️ Prerequisite: Run migration `003_add_chat_model.sql`** before testing:

```sql
-- supabase/migrations/003_add_chat_model.sql
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS model TEXT;
```

Run in Supabase SQL Editor. Then update `ChatSession` type in `src/types/database.ts`:
```typescript
export interface ChatSession {
  id: string;
  forest_id: string;
  user_id: string;
  title: string | null;
  model: string | null;  // ← ADD THIS
  created_at: string;
}
```

**Verification:** `npm run build` passes (no TS errors). Write a quick integration test that creates a session, adds messages, and updates the model.

---

### T6.2 — SSE Streaming Utility (0.5h)

**Objective:** Create a reusable SSE helper for writing streaming responses from Next.js route handlers. SSE (Server-Sent Events) is the simplest streaming protocol — works with standard `fetch` on the client and `ReadableStream` on the server.

**Files:**
- Create: `src/lib/chat/sse.ts`

**SSE utility:**

```typescript
// src/lib/chat/sse.ts

/**
 * SSE event names used by the chat API:
 * - chunk: text delta from the AI response — { content: string }
 * - tool_start: AI requested a tool — { name: string, args: object }
 * - tool_end: tool execution complete — { name: string, result: string }
 * - done: entire response complete — { message_id: string, session_id: string, model?: string }
 *       (/new returns new session_id; /model returns updated model)
 * - error: an error occurred — { error: string }
 */

export interface SseEvent {
  event: "chunk" | "tool_start" | "tool_end" | "done" | "error";
  data: {
    content?: string;
    name?: string;
    args?: unknown;
    result?: string;
    message_id?: string;
    session_id?: string;
    model?: string | null;
    error?: string;
  };
}

export function createSseStream(): {
  stream: ReadableStream<Uint8Array>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  send: (event: SseEvent) => void;
  close: () => void;
} {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      closed = true;
    },
  });

  const encoder = new TextEncoder();

  const send = (sseEvent: SseEvent) => {
    if (closed || !controller) return;
    try {
      const lines = [
        `event: ${sseEvent.event}`,
        `data: ${JSON.stringify(sseEvent.data)}`,
        "",
      ];
      controller.enqueue(encoder.encode(lines.join("\n")));
    } catch {
      closed = true;
    }
  };

  const close = () => {
    if (closed || !controller) return;
    try {
      controller.close();
    } catch {
      // ignore if already closed
    }
    closed = true;
  };

  return {
    stream,
    writer: stream.getWriter() as WritableStreamDefaultWriter<Uint8Array>,
    send,
    close,
  };
}
```

**Verification:** Write a quick script or test that creates a stream, sends events, and verifies the output format matches SSE spec.

---

### T6.3 — Streaming Chat API Route (3h) ⚡ HIGH PRIORITY

**Objective:** Create `POST /api/chat` endpoint that accepts a user message, calls OpenRouter with function calling, executes tool calls in a loop, and streams everything back via SSE.

**Files:**
- Create: `src/app/api/chat/route.ts`
- Create: `src/lib/chat/openrouter.ts` — OpenRouter client utility
- Create: `src/lib/chat/tool-executor.ts` — dispatches tool calls to handlers

**⚠️ OpenRouter streaming requirement:** The route must use the `POST` HTTP method (Next.js 16: export `async function POST(request: NextRequest)`).

**Data flow:**

```
Client → POST /api/chat { message, session_id?, forest_id }
  │
  1. Authenticate user (supabase.auth.getUser)
  2. Get or create chat session
  3. Load previous messages
  4. Load forest context (compartments, operations summary)
  5. Compose system prompt + tools for OpenRouter
  6. Call OpenRouter with streaming enabled
  7. SSE loop:
     - Stream text chunks → event: chunk
     - If tool_call → stream tool_start → execute tool → stream tool_end
     - Append tool result → call OpenRouter again
     - Repeat until text response
  8. Store final assistant message
  9. event: done { message_id }
```

**Tool call loop (critical):**
The agent loop runs on the server. When OpenRouter returns a `tool_calls` delta, the server:
1. Sends `event: tool_start { name: "generate_plan" }` to client
2. Executes the tool (potentially long-running)
3. Sends `event: tool_end { name: "generate_plan", result: "..." }` to client
4. Appends the tool result as a "tool"-role message
5. Calls OpenRouter again with the updated conversation
6. The AI returns a text response explaining what happened

**OpenRouter client (`src/lib/chat/openrouter.ts`):**

```typescript
// Key design decisions:
// - Uses standard OpenAI-compatible fetch API
// - Streams response via SSE parsing
// ⚠️ OpenRouter streams tool_call arguments as incremental JSON fragments.
// This parser accumulates argument deltas until finish_reason="tool_calls".
// - Handles both text deltas and tool_call deltas
// - Error handling for API failures and timeouts

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// Model selection priority: session.model > OPENROUTER_MODEL env > default
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash"; // verified tool calling support
function resolveModel(sessionModel?: string | null): string {
  return sessionModel ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
}

interface OpenRouterRequest {
  messages: Array<{ role: string; content: string }>;
  tools?: ToolDefinition[];
  model?: string | null;  // per-request model override
  stream: boolean;
}

interface AccumulatedToolCall {
  index: number;
  name: string;
  arguments: string;
}

export type StreamChunk =
  | { type: "text"; content: string }
  | { type: "tool_call"; name: string; arguments: Record<string, unknown> };

export async function* streamChat(
  request: OpenRouterRequest,
  apiKey: string
): AsyncGenerator<StreamChunk> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://forestchat.app",
      "X-Title": "ForestChat",
    },
    body: JSON.stringify({ ...request, model: request.model ?? DEFAULT_MODEL }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter error: ${response.status} ${await response.text()}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  // Accumulate tool_calls across deltas — arguments arrive as JSON fragments
  const pendingToolCalls: Map<number, AccumulatedToolCall> = new Map();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") {
        // Flush any pending tool calls before closing
        // (some models don't set finish_reason on the last delta chunk)
        for (const [_, tc] of pendingToolCalls) {
          try {
            yield {
              type: "tool_call" as const,
              name: tc.name,
              arguments: tc.arguments ? JSON.parse(tc.arguments) : {},
            };
          } catch {
            yield { type: "tool_call" as const, name: tc.name, arguments: {} };
          }
        }
        pendingToolCalls.clear();
        return;
      }

      try {
        const parsed = JSON.parse(data);
        const choice = parsed.choices?.[0];
        const delta = choice?.delta;
        if (!delta) continue;

        // Accumulate text
        if (delta.content) {
          yield { type: "text" as const, content: delta.content };
        }

        // Accumulate tool_call arguments across deltas
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;

            // Name arrives in the first delta for this tool_call index
            if (tc.function?.name) {
              pendingToolCalls.set(idx, {
                index: idx,
                name: tc.function.name,
                arguments: tc.function?.arguments ?? "",
              });
            } else {
              // Subsequent deltas: append argument fragment
              const existing = pendingToolCalls.get(idx);
              if (existing) {
                existing.arguments += tc.function?.arguments ?? "";
              } else {
                // First delta without name — rare but handle it
                pendingToolCalls.set(idx, {
                  index: idx,
                  name: "",
                  arguments: tc.function?.arguments ?? "",
                });
              }
            }
          }
        }

        // When the response signals done, flush accumulated tool calls
        if (choice?.finish_reason === "tool_calls") {
          for (const [_, tc] of pendingToolCalls) {
            try {
              const args = tc.arguments ? JSON.parse(tc.arguments) : {};
              yield {
                type: "tool_call" as const,
                name: tc.name,
                arguments: args,
              };
            } catch {
              // If arguments JSON is malformed, yield with empty args
              yield {
                type: "tool_call" as const,
                name: tc.name,
                arguments: {},
              };
            }
          }
          pendingToolCalls.clear();
        }
      } catch {
        // skip unparseable lines
      }
    }
  }
}
```

**Tool executor (`src/lib/chat/tool-executor.ts`):**

```typescript
// src/lib/chat/tool-executor.ts

import type { ToolDefinition } from "./tools"; // from T8.4
import { generatePlan } from "../ai/generate-plan"; // from T7.4
import { getStand, searchStands, planSummary, yearOperations } from "../ai/query-tools";
import { addOperation, removeOperation } from "../ai/edit-tools";
import { checkSustainability, validatePlan } from "../ai/validation-tools";

export interface ToolResult {
  success: boolean;
  result: string;
  error?: string;
}

type ToolHandler = (
  args: Record<string, unknown>,
  context: { forestId: string; userId: string }
) => Promise<ToolResult>;

const toolHandlers: Record<string, ToolHandler> = {
  generate_plan: async (args, ctx) => {
    return generatePlan(ctx.forestId, ctx.userId, {
      periodYears: (args.period_years as number) ?? 20,
      startYear: (args.start_year as number) ?? new Date().getFullYear(),
    });
  },
  get_stand: async (args, ctx) => getStand(ctx.forestId, args.stand_id as string),
  search_stands: async (args, ctx) => searchStands(ctx.forestId, args),
  plan_summary: async (_args, ctx) => planSummary(ctx.forestId),
  year_operations: async (args, ctx) => yearOperations(ctx.forestId, args.year as number),
  add_operation: async (args, ctx) => addOperation(ctx.forestId, ctx.userId, args),
  remove_operation: async (args, ctx) => removeOperation(ctx.forestId, args.stand_id as string, args.year as number),
  check_harvest_sustainability: async (args, ctx) => checkSustainability(ctx.forestId, args.year as number | undefined),
  validate_plan: async (_args, ctx) => validatePlan(ctx.forestId),
};

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: { forestId: string; userId: string }
): Promise<ToolResult> {
  const handler = toolHandlers[name];
  if (!handler) {
    return { success: false, result: "", error: `Unknown tool: ${name}` };
  }
  return handler(args, context);
}
```

**Chat API route (`src/app/api/chat/route.ts`):**

```typescript
import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getOrCreateSession, getMessagesBySession } from "@/lib/repos/chat-sessions";
import { addMessage } from "@/lib/repos/chat-messages";
import { createSseStream } from "@/lib/chat/sse";
import { streamChat } from "@/lib/chat/openrouter";
import { executeTool } from "@/lib/chat/tool-executor";
import { getForestById } from "@/lib/repos/forests";
import { env } from "@/lib/env";
import { buildSystemPrompt } from "@/lib/chat/system-prompt"; // T8.4
import { getTools } from "@/lib/chat/tools"; // T8.4
import { getCompartmentsByForest } from "@/lib/repos/compartments";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const { send, close, stream } = createSseStream();

  // Stream response in background
  (async () => {
    try {
      // 1. Authenticate
      const supabase = await createServerSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        send({ event: "error", data: { error: "Unauthorized" } });
        close();
        return;
      }

      // 2. Parse request
      const body = await request.json();
      const { message, session_id, forest_id } = body;
      if (!message || !forest_id) {
        send({ event: "error", data: { error: "message and forest_id required" } });
        close();
        return;
      }

      // 3. Get/create session
      const session = await getOrCreateSession(forest_id, user.id);

      // ── Command handling (before AI agent loop) ──
      // /new — Start a fresh conversation (creates new session)
      if (message === "/new") {
        const newSession = await createSession(forest_id, user.id, undefined, session.model);
        send({ event: "chunk", data: { content: "🆕 Started a new conversation. How can I help with your forest?" } });
        send({ event: "done", data: { message_id: "", session_id: newSession.id, model: newSession.model } });
        close();
        return;
      }

      // /model <name> — Switch AI model for this session
      if (message.startsWith("/model ")) {
        const modelName = message.slice(7).trim();
        if (!modelName) {
          send({ event: "error", data: { error: "Usage: /model <name> (e.g., /model claude-sonnet-4)" } });
          close();
          return;
        }
        await updateSessionModel(session.id, modelName);
        send({ event: "chunk", data: { content: `✅ Model switched to \\`${modelName}\\` for this conversation.` } });
        send({ event: "done", data: { message_id: "", session_id: session.id, model: modelName } });
        close();
        return;
      }
      // ── End command handling ──

      // 4. Load context
      const forest = await getForestById(forest_id);
      const compartments = await getCompartmentsByForest(forest_id);
      const prevMessages = await getMessagesBySession(session.id);

      // 5. Store user message
      const userMsg = await addMessage(session.id, "user", message);

      // 6. Resolve model: session-specific > env var > default
      const activeModel = resolveModel(session.model);

      // 7. Build messages array for OpenRouter
      const systemPrompt = buildSystemPrompt(forest, compartments);
      const tools = getTools();

      const openRouterMessages = [
        { role: "system", content: systemPrompt },
        ...prevMessages.map((m) => ({
          role: m.role as "user" | "assistant" | "tool",
          content: m.content,
        })),
        { role: "user", content: message },
      ];

      // 8. Agent loop
      let finalContent = "";
      const maxIterations = 10; // prevent infinite loops (editing flow: modify→check→validate→explain = 4-6)

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        const toolResults: Array<{ role: string; content: string }> = [];

        // Call OpenRouter with streaming
        for await (const chunk of streamChat(
          {
            messages: openRouterMessages,
            tools: tools.length > 0 ? tools : undefined,
            model: activeModel,
            stream: true,
          },
          env.openRouterApiKey
        )) {
          if (chunk.type === "text") {
            finalContent += chunk.content;
            send({ event: "chunk", data: { content: chunk.content } });
          } else if (chunk.type === "tool_call") {
            send({ event: "tool_start", data: { name: chunk.name, args: chunk.arguments } });
            
            const result = await executeTool(chunk.name, chunk.arguments, {
              forestId: forest_id,
              userId: user.id,
            });

            send({ event: "tool_end", data: { name: chunk.name, result: result.result } });

            toolResults.push({
              role: "tool",
              content: result.success ? result.result : `Error: ${result.error}`,
            });
          }
        }

        if (toolResults.length === 0) {
          break; // No tool calls → done
        }

        // Append tool results and continue the loop
        openRouterMessages.push({ role: "assistant", content: finalContent });
        for (const tr of toolResults) {
          openRouterMessages.push(tr);
        }
      }

      // 8. Store final assistant message
      const assistantMsg = await addMessage(session.id, "assistant", finalContent);

      // 9. Signal complete
      send({ event: "done", data: { message_id: assistantMsg.id, session_id: session.id, model: session.model } });
    } catch (err) {
      send({ event: "error", data: { error: err instanceof Error ? err.message : "Unknown error" } });
    } finally {
      close();
    }
  })();

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

**Verification:** 
1. Run migration `003_add_chat_model.sql` in Supabase SQL Editor
2. Test `/api/chat` with `{ message: "/new", forest_id: "test-id" }` — returns new session_id
3. Test with `{ message: "/model claude-sonnet-4", forest_id: "test-id" }` — confirms model change
4. Test normal message — uses resolved model (session.model > env var > default)
5. Send test POST with `{ message: "Hello", forest_id: "test-id" }` — streams SSE response

---

## Track B: Forestry Engine (port from Python)

### T7.1 — Forestry Config & Types (1h)

**Objective:** Create the TypeScript constants and types that mirror the Python script's configuration: timber prices, optimal rotation ages, thinning thresholds, growth rates, silvicultural costs.

**Files:**
- Create: `src/lib/ai/config.ts` — all constants
- Create: `src/lib/ai/types.ts` — internal types for the forestry engine

**Config (`src/lib/ai/config.ts`):**

```typescript
// src/lib/ai/config.ts

// ─── Timber prices (UPM vko 19/2026, Central Finland) ───
// Three tiers: uudistushakkuu, harvennus, ensiharvennus
export const PRICES: Record<string, Record<string, Record<string, number>>> = {
  uudistushakkuu: {
    Mänty:      { tukki: 78.99, kuitu: 25.28 },
    Kuusi:      { tukki: 82.52, kuitu: 26.36 },
    Rauduskoivu:{ tukki: 61.76, kuitu: 25.79 },
    Hieskoivu:  { tukki: 53.73, kuitu: 21.58 },
    Lehtikuusi: { tukki: 58.00, kuitu: 20.00 },
    Harmaaleppä:{ tukki: 15.00, kuitu: 12.00 },
  },
  harvennus: {
    Mänty:      { tukki: 68.66, kuitu: 20.44 },
    Kuusi:      { tukki: 70.32, kuitu: 20.78 },
    Rauduskoivu:{ tukki: 53.73, kuitu: 21.58 },
    Hieskoivu:  { tukki: 50.00, kuitu: 18.00 },
    Lehtikuusi: { tukki: 52.00, kuitu: 18.00 },
    Harmaaleppä:{ tukki: 12.00, kuitu: 10.00 },
  },
  ensiharvennus: {
    Mänty:      { tukki: 50.93, kuitu: 15.96 },
    Kuusi:      { tukki: 48.20, kuitu: 17.01 },
    Rauduskoivu:{ tukki: 37.83, kuitu: 16.20 },
    Hieskoivu:  { tukki: 35.00, kuitu: 14.00 },
    Lehtikuusi: { tukki: 40.00, kuitu: 14.00 },
    Harmaaleppä:{ tukki: 10.00, kuitu: 8.00 },
  },
};

export function getPrices(tier: string, species: string): { tukki: number; kuitu: number } {
  const key = species === "Koivu" ? "Rauduskoivu" : species;
  return PRICES[tier]?.[key] ?? PRICES[tier]?.Mänty ?? { tukki: 70, kuitu: 20 };
}

// ─── Optimal rotation ages (Väli-Suomi, ~62-63°N) ───
// [min, max]
export const OPTIMAL_AGES: Record<string, Record<string, [number, number]>> = {
  Mänty:      { lehtomainen: [55, 70], tuore: [65, 90], kuivahko: [75, 100], kuiva: [90, 120] },
  Kuusi:      { lehtomainen: [50, 65], tuore: [60, 80], kuivahko: [65, 85] },
  Hieskoivu:  { tuore: [45, 65], kuivahko: [50, 70] },
  Rauduskoivu:{ lehtomainen: [45, 60], tuore: [50, 65] },
};

export function getOptimalAge(species: string, site: string): [number, number] {
  const sp = species === "Koivu" ? "Rauduskoivu" : species;
  return OPTIMAL_AGES[sp]?.[site] ?? [65, 90];
}

// ─── Thinning thresholds ───
export const THINNING_BA: Record<string, Record<string, number>> = {
  ensiharvennus: { Mänty: 16, Kuusi: 24, Hieskoivu: 16, Rauduskoivu: 16, Lehtikuusi: 18, Harmaaleppä: 16 },
  harvennus:     { Mänty: 20, Kuusi: 26, Hieskoivu: 18, Rauduskoivu: 18, Lehtikuusi: 20, Harmaaleppä: 18 },
};

export const MIN_AGE_ENSIHARVENNUS: Record<string, number> = { Mänty: 30, Kuusi: 25, Hieskoivu: 20, Rauduskoivu: 20, Lehtikuusi: 25, Harmaaleppä: 20 };
export const MIN_AGE_HARVENNUS: Record<string, number> =  { Mänty: 45, Kuusi: 40, Hieskoivu: 35, Rauduskoivu: 35, Lehtikuusi: 40, Harmaaleppä: 35 };

// ─── Silvicultural costs (€/ha) ───
export const COSTS: Record<string, number> = {
  Laikkumätästys: 300,
  Ojitusmätästys: 400,
  Laikutus: 250,
  "Kuusen istutus": 600,
  "Männyn istutus": 550,
  "Taimikon varhaishoito": 350,
  Taimikonhoito: 500,
  Ennakkoraivaus: 400,
};

// ─── Growth rates (m³/ha/y) — Luke VMI13, Väli-Suomi ───
export const GROWTH_MINERAL: Record<string, number> = {
  lehtomainen: 7.0,
  lehto: 7.0,
  tuore: 5.5,
  kuivahko: 3.25,
  kuiva: 1.0,
};

export const GROWTH_PEATLAND: Record<string, number> = {
  lehtomainen: 6.25,
  lehto: 6.25,
  tuore: 5.5,
  kuivahko: 3.25,
  kuiva: 1.5,
};

// ─── Site classification mapping ───
export function classifySite(kasvupaikka: string): string {
  const kp = kasvupaikka.toLowerCase();
  if (kp.includes("lehto") || kp.includes("lehtomainen") || kp.includes("ruoho")) return "lehtomainen";
  if (kp.includes("tuore") || kp.includes("mustikka")) return "tuore";
  if (kp.includes("kuivahko") || kp.includes("puolukka")) return "kuivahko";
  if (kp.includes("kuiva") || kp.includes("varpu") || kp.includes("karu")) return "kuiva";
  return "kuivahko";
}

export function detectPeatland(
  maalaji: string,
  kasvupaikka: string,
  maaluokka: string,
  ojitustilanne: string
): boolean {
  const isPeat = ["turve", "räme", "suo", "korpi"].some(
    (t) => maalaji.toLowerCase().includes(t) ||
          kasvupaikka.toLowerCase().includes(t) ||
          maaluokka.toLowerCase().includes(t)
  );
  const isDrained = ojitustilanne.toLowerCase().includes("ojitettu") ||
                    kasvupaikka.toLowerCase().includes("ojit");
  return isPeat && isDrained;
}
```

**Types (`src/lib/ai/types.ts`):**

```typescript
// src/lib/ai/types.ts
import type { Compartment } from "@/types/database";

/** Enriched compartment data used by the forestry engine */
export interface KuviotData {
  numero: string;
  ala: number;
  kehitysluokka: string;
  kasvupaikka: string;
  maalaji: string;
  ojitustilanne: string;
  paapuulaji: string;
  site_class: string;
  is_peatland: boolean;
  annual_growth: number;
  arvo: number;
  tukki_m3: number;
  kuitu_m3: number;
  ikä: number;
  ba: number;
  m3: number;
  _manual_year?: number;
  _manual_income?: number;
  _manual_removal?: number;
  _manual_arvo?: number;
}

export interface PlannedOperation {
  kuvio: KuviotData;
  type: string;
  year: number;
  income_eur: number;
  cost_eur: number;
  removal_m3: number;
  notes: string;
}
```

**Verification:** `tsc --noEmit` passes. Import constants in a test file, verify values match Python script.

---

### T7.2 — Stand Classification & Value Calculation (2h)

**Objective:** Port the Python script's value calculation and classification logic to TypeScript. Each stand (kuvio) is enriched with: stumpage value per species, site class, growth rate, and manual operation assignments for special cases.

**Files:**
- Create: `src/lib/ai/classify.ts`

**Logic to port (Python lines 191-389):**

```
For each kuvio:
  1. Skip non-forest (Muu maa, Maatalousmaa, Tontti)
  2. Select growth rate: mineral or peatland
  3. Calculate per-species value (tukki * tukki_hinta + kuitu * kuitu_hinta)
  4. Calculate total value, volume, growth
  5. Classify by kehitysluokka:
     a. SPECIAL CASES:
        - Kuvio 180 → Poimintahakkuu 50%
        - Kuvio 128 (uudistuskypsä but 57v) → Harvennus 30%
        - Kuvio 71, 72 (recently thinned) → skip
        - Kuvio 5 (thinned 2020) → harvennus 2033
     b. Uudistuskypsä → Päätehakkuu
     c. Siemenpuu → regeneration (mounding + planting)
     d. Aukea (no trees) → regeneration
     e. Taimikko alle/ yli → early tending / cleaning
     f. Nuori kasvatusmetsikkö → Ensiharvennus (if BA + age thresholds met)
     g. Varttunut kasvatusmetsikkö → Harvennus (if BA + age thresholds met)
```

**Key function signature:**

```typescript
export function classifyAndValueStands(
  compartments: Compartment[],
  prices?: typeof PRICES,
  currentYear?: number
): {
  forestKuviot: KuviotData[];
  operations: PlannedOperation[];
  totalArea: number;
  totalVolume: number;
  totalValue: number;
  totalGrowth: number;
}
```

**Verification:** Run with Hokkala compartment test data. Compare output counts and values against Python script output (32,536 m³, 1,473,650 €, 1,061 m³/v growth). Write Vitest test.

---

### T7.3 — Scheduling Engine (3h) 

**Objective:** Port the Python script's scheduling algorithm to TypeScript. This is the most complex part — distributing harvests, thinnings, and regeneration operations across years using the two-period (2026-2035, 2036-2045) approach.

**Files:**
- Create: `src/lib/ai/schedule.ts`

**Algorithm (port Python lines 391-560):**

```
Input: operations (categorized by type), forestKuviot

1. Sort päätehakkuut by urgency (age - optimalMax)
2. Split multi-part stands:
   - Kuvio 7: 3 parts (2026/2028/2031)
   - Kuvio 184: 2 parts (2029/2034)
3. Place K180 poimintahakkuu → 2028
4. Place K5 harvennus → 2033 (manually set year)
5. Calculate slots_for_p1 based on target harvest (85-90% of growth)
6. Distribute remaining päätehakkuut between P1 and P2:
   - P1: round-robin across available years
   - P2: interleaved years (even first, then odd)
7. Add regeneration after each harvest (mounding same year, planting year+1)
8. Distribute harvennukset across P1 years (evenly, repeat years)
9. Schedule taimikonhoidot based on current age
10. Calculate per-year metrics for P1 and P2
```

**Key function signature:**

```typescript
export function schedulePlan(
  forestKuviot: KuviotData[],
  operations: PlannedOperation[],
  currentYear: number
): {
  p1: YearPlan[];    // 10 years
  p2: YearPlan[];    // 10 years
  summary: PlanSummary;
}
```

The `PlanSummary` type:
```typescript
export interface PlanSummary {
  totalVolume: number;
  annualGrowth: number;
  stumpageValue: number;
  p1AverageHarvest: number;
  p2AverageHarvest: number;
  harvestVsGrowth: number; // percentage
  p1TotalIncome: number;
  p1TotalCosts: number;
  p2TotalIncome: number;
  p2TotalCosts: number;
}
```

**⚠️ Critical rules to preserve from Python:**
- Kuvio 5: thinned 2020 → next harvennus 2033 (13y interval)
- Kuvio 71, 72: thinned 2025 → skip period 1
- Kuvio 128: labeled uudistuskypsä at 57y → harvennus, NOT final harvest
- Kuvio 180: poimintahakkuu 2028, 50% removal (landscape)
- Kuvio 7 split 3 ways (2026/2028/2031)
- Kuvio 184 split 2 ways (2029/2034)
- Round-robin P2 with interleaved years (even first, then odd)
- P1 available years: exclude years already used by K7/K184/K180
- slots_for_p1 = 12 (target: ~900-950 m³/v, 85-90% of 1061 m³/v growth)

**Verification:** Run with Hokkala test data. Compare per-year operation counts against Python output. Total harvest P1 should be ~900-950 m³/v average.

---

### T7.4 — generate_plan Handler (2h)

**Objective:** Create the `generate_plan` tool handler that orchestrates the full pipeline: fetch compartments → classify → schedule → store in Supabase → return summary. This is what OpenRouter calls as a tool.

**Files:**
- Create: `src/lib/ai/generate-plan.ts`

**Handler:**

```typescript
// src/lib/ai/generate-plan.ts

import { getCompartmentsByForest } from "@/lib/repos/compartments";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyAndValueStands } from "./classify";
import { schedulePlan } from "./schedule";

interface GeneratePlanArgs {
  periodYears?: number;
  startYear?: number;
}

export async function generatePlan(
  forestId: string,
  userId: string,
  args: GeneratePlanArgs
): Promise<{ success: boolean; result: string; error?: string }> {
  try {
    // 1. Fetch compartments
    const compartments = await getCompartmentsByForest(forestId);
    if (compartments.length === 0) {
      return { success: true, result: "No compartments found for this forest." };
    }

    // 2. Classify and value
    const { forestKuviot, operations, totalArea, totalVolume, totalValue, totalGrowth } =
      classifyAndValueStands(compartments);

    // 3. Schedule
    const { p1, p2, summary } = schedulePlan(forestKuviot, operations, args.startYear ?? new Date().getFullYear());

    // 4. Store operations in Supabase (admin client bypasses RLS)
    const admin = createAdminClient();
    const allPlanOps: Array<{
      compartment_id: string;
      forest_id: string;
      type: string;
      year: number;
      removal_pct: number;
      income_eur: number;
      cost_eur: number;
      notes: string;
      created_by: "ai";
    }> = [];

    // Map kuvio numbers to compartment IDs
    const kuvioToCompartment = new Map<string, { id: string; stand_id: string }>();
    for (const c of compartments) {
      kuvioToCompartment.set(c.stand_id, { id: c.id, stand_id: c.stand_id });
    }

    const addPlanOps = (yearPlan: YearPlan, period: number) => {
      for (const year of yearPlan) {
        for (const op of [...year.paate, ...year.harvennus, ...year.taimik, ...year.uudist]) {
          const comp = kuvioToCompartment.get(String(parseFloat(op.kuvio.numero.replace(",", "."))));
          if (comp) {
            allPlanOps.push({
              compartment_id: comp.id,
              forest_id: forestId,
              type: op.type,
              year: op.year ?? year.year,
              removal_pct: op.type === "Päätehakkuu" || op.type === "Poimintahakkuu" ? 100 : 28,
              income_eur: op.income_eur,
              cost_eur: op.cost_eur,
              notes: op.notes,
              created_by: "ai",
            });
          }
        }
      }
    };

    // Store BOTH periods in the ops array
    addPlanOps(p1, 1);
    addPlanOps(p2, 2);

    // 5. Upsert plan_metadata
    await admin.from("plan_metadata").upsert({
      forest_id: forestId,
      name: `Forest Plan ${args.startYear ?? new Date().getFullYear()}-${(args.startYear ?? new Date().getFullYear()) + (args.periodYears ?? 20) - 1}`,
      period_start: args.startYear ?? new Date().getFullYear(),
      period_end: (args.startYear ?? new Date().getFullYear()) + (args.periodYears ?? 20) - 1,
      total_volume_m3: totalVolume,
      stumpage_value_eur: totalValue,
      annual_growth_m3: totalGrowth,
      owner_stated_value_eur: null, // user sets manually
    }, { onConflict: "forest_id" });

    // 6. Insert new operations FIRST, then delete old ones only on success
    //    This prevents data loss if the insert fails partway through.
    if (allPlanOps.length > 0) {
      const { error: insertError } = await admin.from("operations").insert(allPlanOps);
      if (insertError) throw new Error(`Failed to insert operations: ${insertError.message}`);
    }
    // Only delete old AI operations AFTER successful insert
    await admin.from("operations").delete().eq("forest_id", forestId).eq("created_by", "ai");

    // 7. Return summary
    const result = [
      `✅ Plan generated for ${totalArea.toFixed(1)} ha forest!`,
      ``,
      `🌲 Total volume: ${Math.round(totalVolume).toLocaleString()} m³`,
      `📈 Annual growth: ${Math.round(totalGrowth).toLocaleString()} m³/v`,
      `💰 Stumpage value: ${Math.round(totalValue).toLocaleString()} €`,
      ``,
      `Period 1 (${args.startYear ?? 2026}-${(args.startYear ?? 2026) + 9}):`,
      `  ${p1.reduce((s, y) => s + y.paate.length, 0)} clearcuts`,
      `  ${p1.reduce((s, y) => s + y.harvennus.length, 0)} thinnings`,
      `  Avg harvest: ${Math.round(summary.p1AverageHarvest)} m³/v (${Math.round(summary.harvestVsGrowth)}% of growth)`,
      ``,
      `Period 2 extension also generated. Would you like any changes?`,
    ].join("\n");

    return { success: true, result };

  } catch (err) {
    return { success: false, result: "", error: err instanceof Error ? err.message : "Plan generation failed" };
  }
}
```

**⚠️ Important:** 
- Use `created_by = "ai"` filter when deleting/clearing old operations so user-manually-added operations or history entries are preserved.
- **Insert new operations FIRST, then delete old ones** — this prevents total data loss if the insert fails mid-way.
- Both P1 (2026-2035) and P2 (2036-2045) operations MUST be stored to match the Python script's two-period output.

**Verification:** Call `generatePlan` with a test forest ID in a route handler test. Verify operations appear in Supabase and summary is returned. Compare metrics against Python output.

---

## Track C: Editing & Query Tools

### T8.1 — Query Tools (1.5h)

**Objective:** Create four read-only AI tools that fetch data from Supabase: `get_stand`, `search_stands`, `plan_summary`, `year_operations`.

**Files:**
- Create: `src/lib/ai/query-tools.ts`

**`get_stand(stand_id)`**: Fetch a single compartment by stand_id (kuvio number). Returns: stand ID, species, site type, development class, area, age, volume, basal area, height, diameter, location area.

```typescript
export async function getStand(
  forestId: string,
  standId: string
): Promise<{ success: boolean; result: string; error?: string }> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("compartments")
    .select("*")
    .eq("forest_id", forestId)
    .eq("stand_id", standId)
    .single();

  if (error || !data) {
    return { success: false, result: "", error: `Stand ${standId} not found` };
  }

  const c = data as Compartment;
  const lines = [
    `📋 Stand ${c.stand_id}`,
    `  Area: ${c.area_ha?.toFixed(1)} ha`,
    `  Development class: ${c.development_class ?? "N/A"}`,
    `  Main species: ${c.main_species ?? "N/A"}`,
    `  Site type: ${c.site_type ?? "N/A"}`,
    `  Age: ${c.age_years ?? "N/A"} years`,
    `  Volume: ${c.volume_m3?.toFixed(0)} m³`,
    `  Basal area: ${c.basal_area?.toFixed(1)} m²/ha`,
    `  Avg height: ${c.avg_height?.toFixed(1)} m`,
    `  Avg diameter: ${c.avg_diameter?.toFixed(1)} cm`,
    `  Growth: ${c.growth_m3_per_ha?.toFixed(1)} m³/ha/y`,
  ];

  return { success: true, result: lines.join("\n") };
}
```

**`search_stands(filters)`**: Search compartments by species, site_type, development_class, age range, area range. Returns matching stand IDs and key attributes. Accepts Finnish OR English parameter values and translates automatically.

```typescript
// Name-to-Finnish mapping for automatic translation
const SPECIES_ALIASES: Record<string, string[]> = {
  Mänty: ["Mänty", "Pine", "mänty", "pine"],
  Kuusi: ["Kuusi", "Spruce", "kuusi", "spruce"],
  Rauduskoivu: ["Rauduskoivu", "Birch", "rauduskoivu", "birch", "Koivu", "koivu"],
  Hieskoivu: ["Hieskoivu", "hieskoivu"],
  Lehtikuusi: ["Lehtikuusi", "Larch", "lehtikuusi", "larch"],
  Harmaaleppä: ["Harmaaleppä", "Alder", "harmaaleppä", "alder"],
};

export async function searchStands(
  forestId: string,
  filters: Record<string, unknown>
): Promise<{ success: boolean; result: string; error?: string }> {
  const supabase = await createServerSupabase();
  let query = supabase.from("compartments").select("*").eq("forest_id", forestId);

  // Translate species: accept both Finnish and English
  if (filters.species) {
    const input = String(filters.species);
    let finnishName: string | null = null;
    for (const [fi, aliases] of Object.entries(SPECIES_ALIASES)) {
      if (aliases.some((a) => a.toLowerCase() === input.toLowerCase())) {
        finnishName = fi;
        break;
      }
    }
    if (finnishName) {
      query = query.eq("main_species", finnishName);
    }
  }

  if (filters.site_type) {
    // Translate site type: tuore/lehtomainen/kuivahko/kuiva + English equivalents
    const siteMap: Record<string, string> = {
      tuore: "tuore", mesic: "tuore",
      lehtomainen: "lehtomainen", "herb-rich": "lehtomainen",
      kuivahko: "kuivahko", "sub-xeric": "kuivahko",
      kuiva: "kuiva", xeric: "kuiva",
    };
    const mapped = siteMap[String(filters.site_type).toLowerCase()];
    if (mapped) query = query.eq("site_type", mapped);
  }

  if (filters.development_class) {
    query = query.ilike("development_class", `%${filters.development_class}%`);
  }
  if (filters.min_age) query = query.gte("age_years", Number(filters.min_age));
  if (filters.max_age) query = query.lte("age_years", Number(filters.max_age));
  if (filters.min_area) query = query.gte("area_ha", Number(filters.min_area));

  const { data, error } = await query.order("stand_id").limit(50);
  if (error) return { success: false, result: "", error: error.message };

  const stands = (data as Compartment[]) ?? [];
  if (stands.length === 0) {
    return { success: true, result: "No matching stands found." };
  }

  const lines = stands.map((s) =>
    `  Stand ${s.stand_id}: ${s.main_species ?? "?"}, ${s.development_class ?? "?"}, ${s.area_ha?.toFixed(1)} ha, ${s.age_years ?? "?"} y, ${s.volume_m3?.toFixed(0)} m³`
  );
  return { success: true, result: `Found ${stands.length} stand(s):
${lines.join("\n")}` };
}
```

**`plan_summary()`**: Calculate and return key metrics: total volume, annual growth, stumpage value, average harvest m³/v, net return.

**`year_operations(year)`**: List all planned operations for a given year from the operations table. Organized by type.

**Verification:** Test each tool with known forest data. Verify `search_stands` returns correct filters with both Finnish and English parameter values.

---

### T8.2 — Mutation Tools (1.5h)

**Objective:** Create two editing tools that modify plan operations: `add_operation` and `remove_operation`.

**Files:**
- Create: `src/lib/ai/edit-tools.ts`

**`add_operation(stand_id, year, type, removal_pct?)`**: Add or update an operation for a stand. Validates type against rules (see architecture plan 5.2 — types and constraints).

**`remove_operation(stand_id, year)`**: Remove a planned operation from a stand. Used when rescheduling.

```typescript
export async function addOperation(
  forestId: string,
  userId: string,
  args: Record<string, unknown>
): Promise<{ success: boolean; result: string; error?: string }> {
  const standId = args.stand_id as string;
  const year = args.year as number;
  const type = args.type as string;
  const removalPct = (args.removal_pct as number) ?? 100;

  // Validate: get compartment
  const supabase = await createServerSupabase();
  const { data: compartment } = await supabase
    .from("compartments")
    .select("*")
    .eq("forest_id", forestId)
    .eq("stand_id", standId)
    .single();

  if (!compartment) {
    return { success: false, result: "", error: `Stand ${standId} not found` };
  }

  // Type-specific validation (rules from architecture 5.2):
  // - Clear_cut: only for regeneration-ready stands
  // - Thinning: mature thinning stand, age ≥ 45 (pine) / 40 (spruce)
  // - First_thinning: young thinning stand, age ≥ 30 (pine) / 25 (spruce)
  // - etc.

  // Add operation
  const admin = createAdminClient();
  const { error } = await admin.from("operations").insert({
    compartment_id: compartment.id,
    forest_id: forestId,
    type,
    year,
    removal_pct: removalPct,
    created_by: "ai",
  });

  if (error) {
    return { success: false, result: "", error: error.message };
  }

  return { success: true, result: `Added ${type} to stand ${standId} in ${year}.` };
}
```

**⚠️ Validation rules to implement (from architecture plan 5.2):**
- `Clear_cut`: only for regeneration-ready stands. Removal 100%.
- `Thinning`: Mature thinning stand, age ≥ 45 (pine) / 40 (spruce). Removal ~28%.
- `First_thinning`: Young thinning stand. Removal ~25%.
- `Selection_cutting`: special case, removal 50%.
- `Tending` / `Early_tending`: Seedling stands.
- `Site_prep` / `Planting`: after clearcut.
- Do NOT thin a stand that was thinned less than 10 years ago.
- Do NOT clearcut a stand not classified as regeneration-ready.

**Verification:** Add a test operation, verify it appears in Supabase. Remove it, verify it's gone.

---

### T8.3 — Validation Tools (1.5h)

**Objective:** Create two validation tools: `check_harvest_sustainability` and `validate_plan`.

**Files:**
- Create: `src/lib/ai/validation-tools.ts`

**`check_harvest_sustainability(year?)`**: Compare total harvest volume against annual growth for a specific year or the entire plan period.

```typescript
export async function checkSustainability(
  forestId: string,
  year?: number
): Promise<{ success: boolean; result: string; error?: string }> {
  const supabase = await createServerSupabase();
  
  // Get plan metadata for annual growth
  const { data: metadata } = await supabase
    .from("plan_metadata")
    .select("*")
    .eq("forest_id", forestId)
    .single();

  const annualGrowth = (metadata as { annual_growth_m3: number })?.annual_growth_m3 ?? 0;

  // Get operations for the year (or all years)
  let query = supabase.from("operations").select("*").eq("forest_id", forestId);
  if (year) query = query.eq("year", year);
  
  const { data: ops } = await query;
  if (!ops || ops.length === 0) {
    return { success: true, result: year ? `No operations planned for ${year}.` : "No operations in plan." };
  }

  const totalHarvest = ops.reduce((sum: number, op) => sum + ((op as { removal_pct?: number }).removal_pct ?? 0) * 0.01 * 100, 0);
  // More accurate: sum actual removal volumes if stored, otherwise estimate

  // Format result
  // ...
}
```

**`validate_plan()`**: Full validation: rotation ages, thinning intervals, regeneration chains. Returns issues list or "Plan looks good."

Checks to implement:
1. ✅ No clearcuts on non-regeneration-ready stands
2. ✅ No thinnings within 10 years of previous thinning
3. ✅ Regeneration chain follows each clearcut (mounding + planting)
4. ✅ Annual harvest doesn't exceed annual growth
5. ✅ No duplicate operations on same stand+year
6. ✅ Operations have valid years (within plan period)

**Verification:** Create a plan, validate it. Intentionally create an invalid operation, verify validation catches it.

---

### T8.4 — Tool Registration & System Prompt (1.5h)

**Objective:** Define the OpenRouter function-calling tool definitions and compose the system prompt. This is the glue between the chat API route and all the tools.

**Files:**
- Create: `src/lib/chat/tools.ts` — tool definitions in OpenRouter format
- Create: `src/lib/chat/system-prompt.ts` — system prompt builder

**Tool definitions (`src/lib/chat/tools.ts`):**

OpenRouter uses the OpenAI function-calling format. Each tool has `name`, `description`, and `parameters` (JSON Schema).

```typescript
// src/lib/chat/tools.ts
// Format matches OpenRouter/OpenAI function calling spec

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export function getTools(): ToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "generate_plan",
        description: `Generate a complete forest management plan for the entire property.
The algorithm follows Finnish silvicultural recommendations (Central Finland):
- Optimal rotation ages: Pine 81-100, Spruce 71-90, Birch 61-70
- Thinning thresholds: basal area limits by site type
- Minimum thinning interval: 10 years
- Sustainability: annual harvest < annual growth
- Regeneration chain: clearcut → site preparation → planting (automatic)
- Growth rates: Luke VMI13 coefficients by site type
Returns: operations per stand, key metrics.`,
        parameters: {
          type: "object",
          properties: {
            period_years: { type: "number", description: "Duration in years (default 20)" },
            start_year: { type: "number", description: "Start year (default current year)" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_stand",
        description: "Get all data for a single stand (species, site type, age, area, volume, location).",
        parameters: {
          type: "object",
          properties: {
            stand_id: { type: "string", description: "e.g. '7', '89.1'" },
          },
          required: ["stand_id"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_stands",
        description: "Search stands by criteria. All parameters optional.",
        parameters: {
          type: "object",
          properties: {
            species: { type: "string", description: "Finnish name (Mänty, Kuusi, Rauduskoivu, Hieskoivu, Lehtikuusi, Harmaaleppä) or English (Pine, Spruce, Birch, etc.) — handler translates automatically" },
            site_type: { type: "string", description: "Finnish (tuore, lehtomainen, kuivahko, kuiva) or English (mesic, herb-rich, sub-xeric, xeric)" },
            development_class: { type: "string", description: "Finnish kehitysluokka: Uudistuskypsä metsikkö, Varttunut kasvatusmetsikkö, Nuori kasvatusmetsikkö, Taimikko, Aukea, Siemenpuumetsikkö" },
            min_age: { type: "number" },
            max_age: { type: "number" },
            min_area: { type: "number" },
          },
        },
      },
    },
    // ... plan_summary, year_operations, add_operation, remove_operation,
    //     check_harvest_sustainability, validate_plan
  ];
}
```

**System prompt (`src/lib/chat/system-prompt.ts`):**

```typescript
// src/lib/chat/system-prompt.ts

import type { Forest, Compartment } from "@/types/database";

export function buildSystemPrompt(
  forest: Forest | null,
  compartments: Compartment[]
): string {
  const totalVolume = compartments.reduce((s, c) => s + (c.volume_m3 ?? 0), 0);
  const totalArea = compartments.reduce((s, c) => s + (c.area_ha ?? 0), 0);
  const regenReady = compartments.filter((c) => c.development_class === "Uudistuskypsä metsikkö").length;
  const matureThinning = compartments.filter((c) => c.development_class === "Varttunut kasvatusmetsikkö").length;
  const youngThinning = compartments.filter((c) => c.development_class === "Nuori kasvatusmetsikkö").length;

  return [
    `You are a Finnish forestry expert helping a forest owner manage their forest plan.`,
    ``,
    `FOREST CONTEXT:`,
    forest ? `- Forest name: ${forest.name}` : "",
    forest?.municipality ? `- Municipality: ${forest.municipality}` : "",
    forest?.property_id ? `- Property ID: ${forest.property_id}` : "",
    `- Total compartments: ${compartments.length}`,
    `- Total area: ${totalArea.toFixed(1)} ha`,
    `- Total volume: ${Math.round(totalVolume).toLocaleString()} m³`,
    `- Regeneration-ready: ${regenReady} stands`,
    `- Mature thinning: ${matureThinning} stands`,
    `- Young thinning: ${youngThinning} stands`,
    ``,
    `KEY RULES:`,
    `1. Never invent stand data — always fetch it via get_stand or search_stands.`,
    `2. When the user asks for a new plan, use the generate_plan tool.`,
    `3. When the user asks for modifications, use the editing tools.`,
    `4. Always check harvest sustainability after making changes.`,
    `5. Explain your recommendations in forestry terms.`,
    `6. Respond in English (UI language is English; underlying data is Finnish).`,
    ``,
    `GENERAL GUIDELINES:`,
    `- Thinnings aim for sustainable forest growth.`,
    `- Clearcuts are automatically followed by a regeneration chain.`,
    `- Never thin the same stand twice within 10 years.`,
    `- Aim to keep annual harvest below annual growth.`,
    `- Detailed rotation ages, thresholds, and growth coefficients are built into the generate_plan tool.`,
    `- Stand data has Finnish attributes (development classes like "Uudistuskypsä metsikkö",`,
    `  site types like "tuore", species like "Mänty"). Present them with English context.`,
  ]
    .filter(Boolean)
    .join("\n");
}
```

**Verification:** Call `buildSystemPrompt` with test forest data — verify output looks correct. Call `getTools()` — verify all 9 tools are defined.

---

## Track D: Chat UI

### T9.1 — Zustand Chat Slice & SSE Client (1h)

**Objective:** Create the Zustand store slice for chat state plus a client-side SSE reader utility.

**Files:**
- Create: `src/lib/store/chat-slice.ts`
- Modify: `src/lib/store/index.ts` — add ChatSlice
- Create: `src/lib/chat/sse-client.ts` — browser-side SSE parser

**Chat slice (`src/lib/store/chat-slice.ts`):**

```typescript
import type { StateCreator } from "zustand";
import type { ChatMessage } from "@/types/database";

export interface ChatSlice {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  toolCallStatus: { name: string; status: "running" | "done" | "error"; result?: string } | null;
  sessionId: string | null;
  activeModel: string;        // Currently active LLM model shown in header
  commandsOpen: boolean;       // Toggle for commands menu dropdown
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
```

**SSE client (`src/lib/chat/sse-client.ts`):**

```typescript
// src/lib/chat/sse-client.ts

export type SseEventType = "chunk" | "tool_start" | "tool_end" | "done" | "error";

interface SseCallbacks {
  onChunk?: (text: string) => void;
  onToolStart?: (name: string, args: Record<string, unknown>) => void;
  onToolEnd?: (name: string, result: string) => void;
  onDone?: (messageId: string, sessionId: string, model?: string | null) => void;
  onError?: (error: string) => void;
}

export async function streamChat(
  message: string,
  forestId: string,
  sessionId: string | null,
  callbacks: SseCallbacks
): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, forest_id: forestId, session_id: sessionId }),
  });

  if (!response.ok) {
    const text = await response.text();
    callbacks.onError?.(text);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) { callbacks.onError?.("No response body"); return; }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    let currentEvent = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));
        switch (currentEvent) {
          case "chunk": callbacks.onChunk?.(data.content); break;
          case "tool_start": callbacks.onToolStart?.(data.name, data.args); break;
          case "tool_end": callbacks.onToolEnd?.(data.name, data.result); break;
          case "done": callbacks.onDone?.(data.message_id, data.session_id, data.model); break;
          case "error": callbacks.onError?.(data.error); break;
        }
      }
    }
  }
}
```

**Verification:** Write a simple test that creates the store and dispatches events. Verify state transitions.

---

### T9.2 — ChatPanel Component (1.5h)

**Objective:** Create the ChatPanel container — a resizable sidebar that sits alongside the map. Shows a header, message area, and input field.

**Files:**
- Create: `src/components/chat/ChatPanel.tsx`
- Create: `src/components/chat/ChatHeader.tsx`

**ChatPanel layout:**

```
┌─────────────────────────────────┐
│ ForestChat · deepseek-v4-flash  │  ← ChatHeader (title + model + ☰ menu)
│ [📋 Commands]                   │  ← dropdown: /new, /model <name>
├─────────────────────────────────┤
│                                 │
│  ChatMessages                   │  ← scrollable area
│  (streaming)                    │
│                                 │
│  [Tool call card]               │  ← visible during tool execution
│                                 │
├─────────────────────────────────┤
│ [/model claude...] [Input] [Send]│  ← ChatInput (command auto-detect)
└─────────────────────────────────┘
```

**ChatPanel** wraps the chat area. It uses a `ResizablePanelGroup` (or a simple CSS grid) alongside the map. The panel can be toggled visible/hidden with a button.

For MVP, the simplest approach: the forest view gets a sidebar that's always visible on desktop (w-[400px] on lg+ screens, collapsible on mobile). The map fills the remaining space.

```tsx
// Simplified layout concept:
<div className="flex h-full">
  <div className="flex-1 relative">{/* MapView */}</div>
  <div className="w-[400px] border-l bg-white flex flex-col">
    <ChatPanel forestId={forestId} />
  </div>
</div>
```

**ChatHeader component details:**
- Shows title "ForestChat" plus active model name (e.g., "· deepseek/deepseek-v4-flash") in the header bar
- Has a ☰ (menu) button that toggles a commands dropdown
- **Commands dropdown** lists available slash commands:
  ```
  📋 Chat Commands
  ─────────────────
  /new              Start a new conversation
  /model <name>     Change AI model
                    Current: deepseek/deepseek-v4-flash
  ```
- Selecting `/model` from the menu auto-fills the ChatInput with "/model " so the user types the model name
- Selecting `/new` immediately executes it (clears chat, creates new session)
- The dropdown closes on click outside

**Verification:** ChatPanel renders with header showing model name. Menu button opens dropdown with both commands. Clicking `/new` clears the chat. Clicking `/model` auto-fills the input.

---

### T9.3 — ChatMessages & ChatInput (2h)

**Objective:** Build the message list and input components with streaming support.

**Files:**
- Create: `src/components/chat/ChatMessages.tsx` — scrollable message list
- Create: `src/components/chat/ChatMessage.tsx` — individual message bubble
- Create: `src/components/chat/ChatInput.tsx` — text area + send button
- Create: `src/components/chat/ToolCallCard.tsx` — tool execution progress card

**ChatMessages:**
- Maps over messages array
- Auto-scrolls to bottom when new content arrives
- Shows streaming content as partial message while streaming
- User messages: right-aligned, green-themed
- Assistant messages: left-aligned, white/gray
- Tool messages: hidden from main feed (shown via ToolCallCard)

**ChatInput:**
- Text area (auto-grows up to 4 lines)
- Send button (arrow icon, disabled while streaming)
- Enter to send, Shift+Enter for newline
- Disabled while streaming

**ToolCallCard:**
- Appears when `toolCallStatus` is non-null
- Shows: "🔄 Generating plan..." → "✅ Plan generated!"
- Three statuses: `running` (spinner), `done` (checkmark), `error` (X)

**Verification:** Mock SSE events, verify streaming content appears and auto-scrolls.

---

### T9.4 — Integrate into ForestView (1h)

**Objective:** Wire everything together in the ForestView layout.

**Files:**
- Modify: `src/components/forest/ForestView.tsx` — add ChatPanel
- Modify: `src/lib/store/index.ts` — add ChatSlice to combined store

**Changes to ForestView:**
1. Add ChatPanel on the right side (400px, border-left)
2. Map fills the remaining left space
3. When a plan is generated, refresh operations data (compartments don't change during planning)
4. Handle auth state — chat requires user to be logged in

**⚠️ Existing hooks limitation:** `useCompartments()` and `useOperations()` currently don't expose a `refetch` function — they auto-fetch on mount via `useEffect([forestId])`. To support post-chat refresh:

**Option A (recommended for MVP):** Add a `refetchCounter: number` to the Zustand store's `ForestSlice`. The SSE client increments it on `event: done`. `useOperations` adds `refetchCounter` to its dependency array. This triggers a re-fetch without modifying the hook API.

```typescript
// In forest-slice.ts, add:
//   refetchCounter: number;
//   triggerRefetch: () => void;
// In useOperations(), add to deps:
//   const refetchCounter = useForestStore((s) => s.refetchCounter);
//   }, [forestId, refetchCounter]);
```

**Option B:** Modify `useOperations()` to return a `refetch` function by extracting the fetch logic into a standalone async function and exposing it.

```typescript
// Modified useOperations.ts pattern:
export function useOperations(forestId: string | null) {
  const [data, setData] = useState<Operation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refetchCounter = useForestStore((s) => s.refetchCounter);

  const fetchOps = useCallback(async () => {
    if (!forestId) return;
    setLoading(true);
    // ... fetch logic
  }, [forestId]);

  useEffect(() => { fetchOps(); }, [fetchOps, refetchCounter]);

  return { data, loading, error, refetch: fetchOps };
}
```

**In ForestView**, when the chat SSE client fires `onDone`, call `useForestStore.getState().triggerRefetch()` to increment the counter, causing the hooks to re-run.

**Verification:** Full flow: open forest → chat panel visible → type "Generate a plan" → see streaming response → plan appears in DB → map+operations update.

---

## Track E: Tests

### T10.1 — Forestry Engine Unit Tests (1h)

**Files:**
- Create: `src/__tests__/unit/forestry-config.test.ts` — verify constants match known values
- Create: `src/__tests__/unit/forestry-classify.test.ts` — classify test data
- Create: `src/__tests__/unit/forestry-schedule.test.ts` — schedule test data, check year distribution

**Test cases:**
1. Constants match expected values (prices, growth rates, optimal ages)
2. `classifyAndValueStands` with Hokkala-like test data produces expected totals (~32,536 m³, ~1,061 m³/v growth)
3. Special cases: K5 → harvennus 2033, K128 → harvennus not päätehakkuu, K71 → skip
4. `schedulePlan` produces even year distribution (no single year >2,500 m³)
5. `detectPeatland` correctly identifies peatland vs mineral
6. `classifySite` maps Finnish kasvupaikka to correct internal key

### T10.2 — Chat API Integration Tests (1h)

**Files:**
- Create: `src/__tests__/integration/chat-api.test.ts`

**Test cases:**
1. POST /api/chat without auth → 401
2. POST /api/chat without required fields → error event
3. POST /api/chat with valid message → SSE response with events
4. Session creation: first message creates session, subsequent messages reuse
5. Message storage: user + assistant messages saved to DB

Uses MSW to mock:
- Supabase auth (return mock user)
- OpenRouter streaming response (return mock tool calls and text)
- Supabase DB queries (return test compartments)

### T10.3 — Chat UI Component Tests (1h)

**Files:**
- Create: `src/__tests__/components/ChatPanel.test.tsx` — renders with messages
- Create: `src/__tests__/components/ChatMessages.test.tsx` — streaming display
- Create: `src/__tests__/components/ChatInput.test.tsx` — send button, disabled states

**Test cases:**
1. ChatPanel renders header and empty state when no messages
2. ChatInput disabled while streaming
3. Enter sends, Shift+Enter adds newline
4. ToolCallCard shows running → done transitions
5. Streaming content appears incrementally

---

## Files Created (Summary)

```
supabase/migrations/003_add_chat_model.sql      ← New: adds model TEXT to chat_sessions
src/lib/ai/config.ts                          ← T7.1 Constants (prices, growth rates, ages, costs)
src/lib/ai/types.ts                           ← T7.1 Internal types (KuviotData, PlannedOperation)
src/lib/ai/classify.ts                        ← T7.2 Stand classification & value calculation
src/lib/ai/schedule.ts                        ← T7.3 Scheduling engine (port from Python)
src/lib/ai/generate-plan.ts                   ← T7.4 generate_plan tool handler (orchestrator)
src/lib/ai/query-tools.ts                     ← T8.1 Query tools (get_stand, search_stands, plan_summary, year_operations)
src/lib/ai/edit-tools.ts                      ← T8.2 Mutation tools (add_operation, remove_operation)
src/lib/ai/validation-tools.ts                ← T8.3 Validation tools (check_harvest_sustainability, validate_plan)
src/lib/chat/tools.ts                         ← T8.4 OpenRouter tool definitions
src/lib/chat/system-prompt.ts                 ← T8.4 System prompt builder
src/lib/chat/sse.ts                           ← T6.2 Server-side SSE streaming utility
src/lib/chat/openrouter.ts                    ← T6.3 OpenRouter client (streaming, function calling)
src/lib/chat/tool-executor.ts                 ← T6.3 Tool call dispatcher
src/lib/repos/chat-sessions.ts                ← T6.1 Chat session repo (add: createSession, updateSessionModel)
src/lib/repos/chat-messages.ts                ← T6.1 Chat message repo
src/app/api/chat/route.ts                     ← T6.3 Streaming chat API endpoint (+ /new, /model commands)
src/lib/store/chat-slice.ts                   ← T9.1 Zustand chat slice (+ activeModel, commandsOpen)
src/lib/chat/sse-client.ts                    ← T9.1 Browser SSE client (+ model in onDone)
src/components/chat/ChatPanel.tsx             ← T9.2 Chat panel container
src/components/chat/ChatHeader.tsx            ← T9.2 Chat header (+ model display, commands Menu button)
src/components/chat/ChatMessages.tsx          ← T9.3 Message list (scrollable)
src/components/chat/ChatMessage.tsx           ← T9.3 Individual message bubble
src/components/chat/ChatInput.tsx             ← T9.3 Input + send
src/components/chat/CommandsMenu.tsx          ← T9.2 Commands dropdown component
src/components/chat/ToolCallCard.tsx          ← T9.3 Tool execution progress card
src/__tests__/unit/forestry-config.test.ts    ← T10.1 Config tests
src/__tests__/unit/forestry-classify.test.ts  ← T10.1 Classify tests
src/__tests__/unit/forestry-schedule.test.ts  ← T10.1 Schedule tests
src/__tests__/integration/chat-api.test.ts    ← T10.2 Chat API integration tests
src/__tests__/unit/chat-commands.test.ts      ← T10.2 Command parsing tests
src/__tests__/components/ChatPanel.test.tsx   ← T10.3 Chat UI component tests
```

## Files Modified

```
src/types/database.ts                         ← Add model?: string to ChatSession interface
src/lib/store/index.ts                        ← T9.1 Add ChatSlice to combined store
src/components/forest/ForestView.tsx          ← T9.4 Add ChatPanel, wire up SSE client
```

---

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| OpenRouter streaming format changes | Low | High | Abstract streaming parser; test against real API before deploy |
| Python→TS port has subtle algorithm differences | Medium | Medium | Write comparison tests against known Python output values |
|| generate_plan exceeds Vercel 10s timeout | Medium | High | Consider running generation outside the SSE stream (kick off, close SSE with "generating..." status, poll for completion) or use Supabase Edge Function |
|| Tool call loop exceeds max iterations | Low | Medium | Hard limit of 10 iterations; return partial result with warning |
|| AI hallucinates stand data | Medium | Medium | `get_stand` and `search_stands` tools always fetch real data; AI cannot fabricate values |
| AI calls search_stands with English species names | Medium | Low | Tool handler auto-translates English→Finnish species, site types, and development classes |
|| SSE connection drops mid-stream | Low | Medium | Client auto-retries on error; final message is stored in DB so user sees it on reload |
| Insert-then-delete race condition | Low | High | Two concurrent plan generations could temporarily duplicate operations. Mitigation: debounce or disable button during generation |
| Chat messages not loaded on page refresh | Low | Low | Load previous messages from DB on session resume |
| Chat panes breaks on mobile | Low | Low | Collapse chat to bottom sheet on mobile; full-screen chat when open |

---

## Out of Scope (Phase 4+)

- [ ] Markdown rendering in chat messages (code blocks, tables)
- [ ] Chat history sidebar (list of past conversations)
- [ ] Voice input for chat
- [ ] PIN-protected/landscape-mode K180 special case (handled in algorithm)
- [ ] Plan sharing via chat (multi-user cooperation)
- [ ] Chat message editing / deleting
- [ ] Offline chat (requires PWA background sync)
- [ ] Chat to generate Excel export (Phase 4 visualization handles this)

---

*Plan version: 2.0 — Created 2026-05-23, Reviewed 2026-05-23*
*Derived from: `docs/plans/forestchat-architecture.md` v3.0, sections 5, 6.2, 6.3, and Phase 3 tasks (T6-T9).*
*Reference: `~/Metsa/build_plan_v3_fixed.py` — the Python algorithm being ported.

---

## Changelog

### v2.0 (2026-05-23) — Architecture review fixes

#### 🔴 Critical fixes
- **`getForestsById` → `getForestById`**: Fixed function name mismatch (actual repo exports singular name)
- **`env.openrouterApiKey` → `env.openRouterApiKey`**: Fixed env property casing (active `env.ts` uses capital R)
- **Period 2 operations now stored**: `addPlanOps(p2, 2)` added alongside `p1` — both periods persisted to DB
- **SSE tool_call delta accumulation**: Rewrote streaming parser to accumulate argument fragments across multiple SSE deltas, flushing only on `finish_reason: "tool_calls"`
- **Safe insert-then-delete**: Reversed operation replacement order — insert new ops first, delete old ones only on success (prevents total data loss on failure)

#### 🟡 Significant fixes
- **search_stands accepts both English/Finnish**: Tool definition uses free-text descriptions instead of English enums; handler includes auto-translation from English species/site/class names to Finnish database values
- **Agent loop limit**: Raised from 5 to 10 iterations (editing flow needs 4-6)
- **Vercel timeout risk noted**: Added stronger mitigation note about running generation outside SSE stream
- **Refetch mechanism spec**: Added concrete implementation guidance (Zustand refetchCounter pattern) since existing hooks don't expose refetch functions

#### 🟢 Minor fixes
- **search_stands implementation**: Added full TypeScript code example with species alias translation
- **Risk table**: Updated iteration limit, added English/Finnish mismatch risk, added insert-then-delete race condition risk
- **Added changelog section** for plan traceability*