import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getOrCreateSession, createSession, getSessionById } from "@/lib/repos/chat-sessions";
import { updateSessionModel } from "@/lib/repos/chat-sessions";
import { addMessage, getMessagesBySession as getChatMessages } from "@/lib/repos/chat-messages";
import { createSseStream } from "@/lib/chat/sse";
import { streamChat, resolveModel } from "@/lib/chat/openrouter";
import { executeTool, invalidateChartTabs, type ToolContext } from "@/lib/chat/tool-executor";
import { getForestById } from "@/lib/repos/forests";
import { env } from "@/lib/env";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";
import { getTools } from "@/lib/chat/tools";
import { getCompartmentsByForest } from "@/lib/repos/compartments";

export const runtime = "nodejs";

/**
 * GET /api/chat?forest_id=X
 * Returns the existing session + messages for a forest (if any).
 * Used on page load to restore the conversation history.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const forestId = searchParams.get("forest_id");
    if (!forestId) {
      return NextResponse.json({ error: "forest_id required" }, { status: 400 });
    }

    const session = await getOrCreateSession(forestId, user.id);
    const messages = await getChatMessages(session.id);

    return NextResponse.json({
      session_id: session.id,
      model: session.model,
      messages,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

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

      // -- Command handling (before AI agent loop) --
      // /new — Start a fresh conversation (creates new session)
      if (message === "/new") {
        const newSession = await createSession(forest_id, user.id, undefined, session.model ?? undefined);
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
        send({ event: "chunk", data: { content: "✅ Model switched to `" + modelName + "` for this conversation." } });
        send({ event: "done", data: { message_id: "", session_id: session.id, model: modelName } });
        close();
        return;
      }
      // -- End command handling --

      // 4. Load context
      const forest = await getForestById(forest_id);
      const compartments = await getCompartmentsByForest(forest_id);
      const prevMessages = await getChatMessages(session.id);

      // 5. Store user message
      await addMessage(session.id, "user", message);

      // 6. Resolve model: session-specific > env var > default
      const activeModel = resolveModel(session.model);

      // 7. Build messages array for OpenRouter
      const systemPrompt = buildSystemPrompt(forest, compartments);
      const tools = getTools();

      const openRouterMessages: Array<{ role: string; content: string }> = [
        { role: "system", content: systemPrompt },
        ...prevMessages.map((m) => ({
          role: m.role as "user" | "assistant" | "tool",
          content: m.content,
        })),
        { role: "user", content: message },
      ];

      // 8. Agent loop
      let finalContent = "";
      const maxIterations = 10;

      const sendSse = (event: string, data: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        send({ event, data } as any);
      };

      const ctx: ToolContext = {
        forestId: forest_id,
        userId: user.id,
        supabase,
        sendSse,
      };

      const DATA_MUTATION_TOOLS = new Set([
        "add_operation",
        "remove_operation",
        "batch_update_operations",
        "generate_plan",
      ]);

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        const toolResults: Array<{ role: string; content: string }> = [];

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
            send({ event: "tool_start", data: { name: chunk.name, args: chunk.arguments as Record<string, unknown> } });

            const result = await executeTool(chunk.name, chunk.arguments, {
              forestId: forest_id,
              userId: user.id,
              supabase,
              sendSse,
            });

            // Auto-invalidate charts when operations are modified
            if (result.success && DATA_MUTATION_TOOLS.has(chunk.name)) {
              await invalidateChartTabs(ctx);
            }

            send({ event: "tool_end", data: { name: chunk.name, result: result.result, error: result.error } });

            const toolContent = result.success ? result.result : `Error: ${result.error}`;
            toolResults.push({
              role: "tool",
              content: toolContent,
            });

            // Persist tool result message so it survives page reloads
            await addMessage(session.id, "tool", toolContent);
          }
        }

        if (toolResults.length === 0) {
          break;
        }

        openRouterMessages.push({ role: "assistant", content: finalContent });
        for (const tr of toolResults) {
          openRouterMessages.push(tr);
        }
      }

      // Store final assistant message
      const assistantMsg = await addMessage(session.id, "assistant", finalContent);

      // Signal complete
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
