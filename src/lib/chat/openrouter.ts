// src/lib/chat/openrouter.ts
// Key design decisions:
// - Uses standard OpenAI-compatible fetch API
// - Streams response via SSE parsing
// - OpenRouter streams tool_call arguments as incremental JSON fragments.
//   This parser accumulates argument deltas until finish_reason="tool_calls".
// - Handles both text deltas and tool_call deltas
// - Error handling for API failures and timeouts

import type { ToolDefinition } from "./tools";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Model selection priority: session.model > OPENROUTER_MODEL env > default
const DEFAULT_MODEL = "deepseek/deepseek-chat";

export function resolveModel(sessionModel?: string | null): string {
  return sessionModel ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
}

export interface OpenRouterRequest {
  messages: Array<{ role: string; content: string; tool_call_id?: string }>;
  tools?: ToolDefinition[];
  model?: string | null;
  stream: boolean;
}

interface AccumulatedToolCall {
  index: number;
  id: string;
  name: string;
  arguments: string;
}

export type StreamChunk =
  | { type: "text"; content: string }
  | { type: "tool_call"; id: string; name: string; arguments: Record<string, unknown> };

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
    body: JSON.stringify({
      ...request,
      model: request.model ?? DEFAULT_MODEL,
      // Prefer providers known to reliably support tool calling with DeepSeek models.
      // DeepSeek (official API) and DeepInfra are the most reliable; fall back to others if both fail.
      provider: {
        order: ["DeepSeek", "DeepInfra"],
        allow_fallbacks: true,
      },
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    console.error("[STREAM] OpenRouter error:", response.status, errBody.slice(0, 500));
    throw new Error(`OpenRouter error: ${response.status} ${errBody}`);
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
        for (const [_, tc] of pendingToolCalls) {
          try {
            yield {
              type: "tool_call" as const,
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments ? JSON.parse(tc.arguments) : {},
            };
          } catch {
            yield { type: "tool_call" as const, id: tc.id, name: tc.name, arguments: {} };
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

            // Name and ID arrive in the first delta for this tool_call index
            if (tc.function?.name) {
              pendingToolCalls.set(idx, {
                index: idx,
                id: tc.id ?? "",
                name: tc.function.name,
                arguments: tc.function?.arguments ?? "",
              });
            } else {
              // Subsequent deltas: append argument fragment
              const existing = pendingToolCalls.get(idx);
              if (existing) {
                existing.arguments += tc.function?.arguments ?? "";
                // Capture id if it arrives in a later delta (some providers)
                if (tc.id && !existing.id) existing.id = tc.id;
              } else {
                // First delta without name — rare but handle it
                pendingToolCalls.set(idx, {
                  index: idx,
                  id: tc.id ?? "",
                  name: "",
                  arguments: tc.function?.arguments ?? "",
                });
              }
            }
          }
        }

        // When the response signals tool_calls done, flush accumulated tool calls
        if (choice?.finish_reason === "tool_calls") {
          for (const [_, tc] of pendingToolCalls) {
            try {
              const args = tc.arguments ? JSON.parse(tc.arguments) : {};
              yield {
                type: "tool_call" as const,
                id: tc.id,
                name: tc.name,
                arguments: args,
              };
            } catch {
              yield {
                type: "tool_call" as const,
                id: tc.id,
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
