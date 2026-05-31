import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getOrCreateSession, createSession, getSessionById } from "@/lib/repos/chat-sessions";
import { updateSessionModel } from "@/lib/repos/chat-sessions";
import { addMessage, getMessagesBySession as getChatMessages } from "@/lib/repos/chat-messages";
import { createSseStream } from "@/lib/chat/sse";
import { streamChat, resolveModel } from "@/lib/chat/openrouter";
import { executeTool, type ToolContext } from "@/lib/chat/tool-executor";
import { recomputeAllCharts } from "@/lib/ai/chart-engine";
import { getForestById } from "@/lib/repos/forests";
import { env } from "@/lib/env";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";
import { getTools } from "@/lib/chat/tools";
import { getCompartmentsByForest } from "@/lib/repos/compartments";

export const runtime = "nodejs";

/**
 * Auto-detect chart intent from a user message when the AI model produced no output.
 * Returns create_chart arguments or null if intent can't be determined.
 */
function detectChartIntent(userMsg: string): Record<string, unknown> | null {
  const msg = userMsg.toLowerCase();

  // Determine chart type
  let chartType = "bar"; // default
  if (msg.includes("pie")) chartType = "pie";
  else if (msg.includes("donut")) chartType = "donut";
  else if (msg.includes("line")) chartType = "line";
  else if (msg.includes("area")) chartType = "area";
  else if (msg.includes("scatter")) chartType = "scatter";
  else if (msg.includes("horizontal")) chartType = "horizontal_bar";
  else if (msg.includes("stacked")) chartType = "stacked_bar";

  // Detect data pattern
  const hasSpecies = msg.includes("species");
  const hasArea = msg.includes("area");
  const hasVolume = msg.includes("volume");
  const hasIncome = msg.includes("income") || msg.includes("revenue") || msg.includes("profit");
  const hasCost = msg.includes("cost") || msg.includes("expense");
  const hasYear = msg.includes("year") || msg.includes("annual") || msg.includes("yearly");
  const hasType = msg.includes("type") || msg.includes("operation");

  // Pattern: "area by tree species" → pie chart of compartment_species
  if (hasArea && hasSpecies) {
    return {
      chart_id: "chart-species-area",
      title: "Total Area by Tree Species",
      type: chartType,
      query_config: {
        source: "compartment_species",
        aggregate: [{ group_by: "species" }],
        values: [{ field: "area_ha", as: "total_ha", fn: "sum" }],
      },
      name_key: "species",
      y_key: "total_ha",
    };
  }

  // Pattern: "volume by species" → pie/bar of compartment_species
  if (hasVolume && hasSpecies) {
    return {
      chart_id: "chart-species-volume",
      title: "Total Volume by Tree Species",
      type: chartType,
      query_config: {
        source: "compartment_species",
        aggregate: [{ group_by: "species" }],
        values: [{ field: "volume_m3", as: "total_m3", fn: "sum" }],
      },
      name_key: chartType === "pie" || chartType === "donut" ? "species" : undefined,
      x_key: chartType !== "pie" && chartType !== "donut" ? "species" : undefined,
      y_key: "total_m3",
    };
  }

  // Pattern: "yearly income" → bar/line of operations by year
  if (hasYear && hasIncome) {
    const isCumulative = msg.includes("cumulative");
    return {
      chart_id: "chart-yearly-income",
      title: isCumulative ? "Cumulative Income Over Plan Years" : "Yearly Income",
      type: chartType,
      query_config: {
        source: "operations",
        aggregate: [{ group_by: "year" }],
        values: [{ field: "income_eur", as: "income", fn: "sum", ...(isCumulative ? { cumulative: true } : {}) }],
        sort: { by: "year" },
      },
      x_key: "year",
      y_key: "income",
    };
  }

  // Pattern: "income by operation type" → bar/horizontal_bar
  if (hasIncome && hasType) {
    return {
      chart_id: "chart-income-by-type",
      title: "Total Income by Operation Type",
      type: chartType,
      query_config: {
        source: "operations",
        aggregate: [{ group_by: "type" }],
        values: [{ field: "income_eur", as: "income", fn: "sum" }],
        sort: { by: "income", dir: "desc" },
      },
      x_key: "type",
      y_key: "income",
    };
  }

  // Pattern: "income and costs by year" → stacked_bar
  if (hasYear && (hasIncome || hasCost)) {
    return {
      chart_id: "chart-yearly-income-cost",
      title: "Yearly Income and Costs",
      type: "stacked_bar",
      query_config: {
        source: "operations",
        aggregate: [{ group_by: "year" }, { group_by: "type" }],
        values: [
          { field: "income_eur", as: "income", fn: "sum" },
          { field: "cost_eur", as: "cost", fn: "sum", multiply: -1 },
        ],
        sort: { by: "year" },
      },
      x_key: "year",
      y_key: "income",
      y_key2: "cost",
      color_key: "type",
    };
  }

  // Generic: "chart of area" or "chart of volume" → compartment_species
  if (hasArea || hasVolume) {
    return {
      chart_id: hasArea ? "chart-species-area" : "chart-species-volume",
      title: hasArea ? "Total Area by Tree Species" : "Total Volume by Tree Species",
      type: chartType,
      query_config: {
        source: "compartment_species",
        aggregate: [{ group_by: "species" }],
        values: [{ field: hasArea ? "area_ha" : "volume_m3", as: hasArea ? "total_ha" : "total_m3", fn: "sum" }],
      },
      name_key: "species",
      y_key: hasArea ? "total_ha" : "total_m3",
    };
  }

  return null;
}

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

      const openRouterMessages: Array<{ role: string; content: string; tool_call_id?: string }> = [
        { role: "system", content: systemPrompt },
        ...prevMessages
          .filter((m) => {
            // Skip old tool messages without tool_call_id — they cause 422 errors
            if (m.role === "tool") {
              const tc = m.tool_calls as Record<string, unknown> | null;
              return !!(tc?.tool_call_id);
            }
            return true;
          })
          .map((m) => {
            const msg: { role: string; content: string; tool_call_id?: string } = {
              role: m.role as "user" | "assistant" | "tool",
              content: m.content,
            };
            // Extract tool_call_id from JSONB tool_calls field
            if (m.role === "tool") {
              const tc = m.tool_calls as Record<string, unknown> | null;
              if (tc?.tool_call_id) msg.tool_call_id = tc.tool_call_id as string;
            }
            return msg;
          }),
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

      // Client-side/visual tools that produce immediate UI effects (charts, map selection).
      // After executing one of these, the AI should not continue the loop — the UI is
      // already updated and another iteration risks creating duplicate chart instances.
      const TERMINAL_TOOLS = new Set([
        "create_chart",
        "select_stand",
        "remove_chart",
        "clear_charts",
      ]);

      let needsRecompute = false;
      let hasToolCalls = false;
      let createdChart = false;  // track for better fallback messages
      let lastToolResult: string | undefined;  // last successful tool result text

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        let iterationText = "";
        const toolResults: Array<{ role: string; tool_call_id: string; content: string }> = [];
        let hadTerminalTool = false;

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
            iterationText += chunk.content;
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

            // Phase 4b: Set recompute flag instead of nuking charts
            if (result.success && DATA_MUTATION_TOOLS.has(chunk.name)) {
              needsRecompute = true;
            }

            if (result.success && TERMINAL_TOOLS.has(chunk.name)) {
              hadTerminalTool = true;
            }

            if (result.success && chunk.name === "create_chart") {
              createdChart = true;
            }

            send({ event: "tool_end", data: { name: chunk.name, result: result.result, error: result.error } });

            const toolContent = result.success ? result.result : `Error: ${result.error}`;
            hasToolCalls = true;
            if (result.success) lastToolResult = result.result;
            toolResults.push({
              role: "tool",
              tool_call_id: chunk.id,
              content: toolContent,
            });

            // Persist tool result message so it survives page reloads
            await addMessage(session.id, "tool", toolContent, undefined, chunk.id);
          }
        }

        if (toolResults.length === 0) {
          break;
        }

        // If the model called a terminal (client-side) tool, stop the loop
        // immediately — the UI is already updated and feeding tool results back
        // for another iteration risks duplicate chart/selection calls.
        if (hadTerminalTool) {
          break;
        }

        // Don't push empty assistant content — confuses models (DeepSeek quirk)
        if (finalContent.trim()) {
          openRouterMessages.push({ role: "assistant", content: finalContent });
        }
        for (const tr of toolResults) {
          openRouterMessages.push(tr);
        }
      }

      // When model returns no text after tool execution (DeepSeek quirk),
      // generate a fallback summary so the user isn't left with empty output.
      // Also: when a terminal tool (create_chart) was called, append the tool's
      // result text so the user gets a clear confirmation message.
      if (!finalContent.trim()) {
        if (hasToolCalls) {
          // Model called tools but returned no text — use the tool's own result
          finalContent = lastToolResult ?? (createdChart
            ? "✅ Chart created. You can ask me to create more charts, edit the plan, or check sustainability."
            : "✅ Done. You can ask me to make changes, create charts, or check sustainability.");
          send({ event: "chunk", data: { content: finalContent } });
        } else {
          // Model produced nothing and didn't call any tools — provider issue.
          // Try auto-detect: if user looks like they want a plan, generate one.
          const userMsg = openRouterMessages.filter(m => m.role === "user").pop()?.content?.toLowerCase() ?? "";
          if (userMsg.includes("plan") || userMsg.includes("summary") || userMsg.includes("management")) {
            send({ event: "chunk", data: { content: "🔧 Generating your plan…\n" } });
            const result = await executeTool("generate_plan", {}, ctx);
            if (result.success) {
              finalContent = result.result;
              send({ event: "chunk", data: { content: finalContent } });
              needsRecompute = true;
            } else {
              finalContent = `❌ Error: ${result.error}`;
              send({ event: "chunk", data: { content: finalContent } });
            }
          } else if (userMsg.includes("chart") || userMsg.includes("graph") || userMsg.includes("plot")) {
            // Model produced nothing for a chart request — auto-detect intent and create one.
            const chartArgs = detectChartIntent(userMsg);
            if (chartArgs) {
              send({ event: "chunk", data: { content: "🔧 Creating your chart…\n" } });
              const result = await executeTool("create_chart", chartArgs, ctx);
              if (result.success) {
                finalContent = result.result;
                send({ event: "chunk", data: { content: finalContent } });
              } else {
                finalContent = `❌ Could not create chart: ${result.error}`;
                send({ event: "chunk", data: { content: finalContent } });
              }
            } else {
              finalContent = "I can create charts for you. Try asking something like: \"Show yearly income as a bar chart\" or \"Create a pie chart of species distribution.\"";
              send({ event: "chunk", data: { content: finalContent } });
            }
          } else {
            finalContent = "⚠️ The AI model returned an empty response. This can happen with some model/provider combinations. Try a simpler query or ask me to generate your forest plan with 'Generate a plan'.";
            send({ event: "chunk", data: { content: finalContent } });
          }
        }
      }

      // When a chart was created and the model produced its own text (not
      // the fallback above), append the chart's result text so the user
      // sees a clear confirmation alongside the model's natural response.
      if (createdChart && lastToolResult && finalContent.trim() !== lastToolResult) {
        finalContent += "\n\n" + lastToolResult;
        send({ event: "chunk", data: { content: "\n\n" + lastToolResult } });
      }

      // Phase 4b: After ALL iterations + fallback — recompute charts once if any mutation happened
      if (needsRecompute) {
        await recomputeAllCharts(ctx.supabase, ctx.forestId, sendSse);
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
