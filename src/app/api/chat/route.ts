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
import { serverMsg } from "@/lib/i18n";
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
  else if (msg.includes("waterfall")) chartType = "waterfall";

  // Detect data pattern
  const hasSpecies = msg.includes("species");
  const hasArea = msg.includes("area");
  const hasVolume = msg.includes("volume");
  const hasIncome = msg.includes("income") || msg.includes("revenue") || msg.includes("profit");
  const hasCost = msg.includes("cost") || msg.includes("expense");
  const hasYear = msg.includes("year") || msg.includes("annual") || msg.includes("yearly");
  const hasType = msg.includes("type") || msg.includes("operation");
  const hasNet = msg.includes("net") || msg.includes("cashflow");

  // Pattern: "area by tree species" → pie chart of compartment_species
  if (hasArea && hasSpecies) {
    return {
      chart_id: "chart-species-area",
      title_en: "Total Area by Tree Species",
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
      title_en: "Total Volume by Tree Species",
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
  // Skip if user asked for waterfall (handled separately below)
  if (hasYear && hasIncome && chartType !== "waterfall" && !hasNet) {
    const isCumulative = msg.includes("cumulative");
    return {
      chart_id: "chart-yearly-income",
      title_en: isCumulative ? "Cumulative Income Over Plan Years" : "Yearly Income",
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
      title_en: "Total Income by Operation Type",
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
      title_en: "Yearly Income and Costs",
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

  // Pattern: "waterfall net cashflow" or "waterfall income minus costs"
  // Only fires for explicit cashflow/net prompts, not all waterfall requests
  if (chartType === "waterfall" && hasNet && (hasIncome || hasCost)) {
    return {
      chart_id: "chart-waterfall-net",
      title_en: "Yearly Net Cashflow (Income − Costs)",
      type: "waterfall",
      query_config: {
        source: "operations",
        aggregate: [{ group_by: "year" }],
        values: [{ field: "net_cashflow", as: "net", fn: "sum" }],
        sort: { by: "year" },
      },
      x_key: "year",
      y_key: "net",
    };
  }

  // Pattern: "scatter plot age vs volume" or "scatter age and volume"
  if (chartType === "scatter") {
    const hasAge = msg.includes("age");
    const hasGrowth = msg.includes("growth");
    const hasDiameter = msg.includes("diameter");
    const hasHeight = msg.includes("height");
    const hasBasal = msg.includes("basal");

    if (hasDiameter && hasHeight) {
      return {
        chart_id: "chart-scatter-diameter-height",
        title_en: "Diameter vs Height (All Stands)",
        type: "scatter",
        query_config: {
          source: "compartments",
          aggregate: [{ group_by: "stand_id" }],
          values: [
            { field: "avg_diameter", as: "diameter", fn: "avg" },
            { field: "avg_height", as: "height", fn: "avg" },
          ],
        },
        x_key: "diameter",
        y_key: "height",
      };
    }

    if (hasAge && hasGrowth) {
      return {
        chart_id: "chart-scatter-age-growth",
        title_en: "Age vs Growth (All Stands)",
        type: "scatter",
        query_config: {
          source: "compartments",
          aggregate: [{ group_by: "stand_id" }],
          values: [
            { field: "age_years", as: "age", fn: "avg" },
            { field: "growth_m3_per_ha", as: "growth", fn: "avg" },
          ],
        },
        x_key: "age",
        y_key: "growth",
      };
    }

    if (hasAge && hasVolume) {
      return {
        chart_id: "chart-scatter-age-volume",
        title_en: "Age vs Volume (All Stands)",
        type: "scatter",
        query_config: {
          source: "compartments",
          aggregate: [{ group_by: "stand_id" }],
          values: [
            { field: "age_years", as: "age", fn: "avg" },
            { field: "volume_m3", as: "volume", fn: "avg" },
          ],
        },
        x_key: "age",
        y_key: "volume",
      };
    }

    if (hasAge && hasBasal) {
      return {
        chart_id: "chart-scatter-age-basal",
        title_en: "Age vs Basal Area (All Stands)",
        type: "scatter",
        query_config: {
          source: "compartments",
          aggregate: [{ group_by: "stand_id" }],
          values: [
            { field: "age_years", as: "age", fn: "avg" },
            { field: "basal_area", as: "basal_area", fn: "avg" },
          ],
        },
        x_key: "age",
        y_key: "basal_area",
      };
    }

    // Generic scatter: age vs volume as default
    return {
      chart_id: "chart-scatter-age-volume",
      title_en: "Age vs Volume (All Stands)",
      type: "scatter",
      query_config: {
        source: "compartments",
        aggregate: [{ group_by: "stand_id" }],
        values: [
          { field: "age_years", as: "age", fn: "avg" },
          { field: "volume_m3", as: "volume", fn: "avg" },
        ],
      },
      x_key: "age",
      y_key: "volume",
    };
  }
  if (hasArea || hasVolume) {
    return {
      chart_id: hasArea ? "chart-species-area" : "chart-species-volume",
      title_en: hasArea ? "Total Area by Tree Species" : "Total Volume by Tree Species",
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
      const { message, session_id, forest_id, language } = body;
      const lang = (language as "en" | "fi") ?? "en";
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
        send({ event: "chunk", data: { content: serverMsg("newConversation", lang) } });
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
        send({ event: "chunk", data: { content: serverMsg("modelSwitched", lang, modelName) } });
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
      const systemPrompt = buildSystemPrompt(forest, compartments, language ?? "en");
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
        language: (language as string) ?? "en",
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
        "clear_plan",
        "create_chart",
        "select_stand",
        "show_stands",
        "show_operations",
        "remove_chart",
        "clear_charts",
        "update_chart",
        "recreate_chart",
      ]);

      let needsRecompute = false;
      let hasToolCalls = false;
      let createdChart = false;  // track for better fallback messages
      let lastToolResult: string | undefined;  // last successful tool result text
      const chartIdsCreatedThisTurn = new Set<string>();  // guard against duplicate create_chart calls
      const planFingerprints = new Set<string>();  // guard against identical generate_plan calls

      // Guard against leading-whitespace text chunks that some models (DeepSeek)
      // emit before tool calls. These produce empty rows at the top of the answer.
      let seenNonWhitespaceText = false;

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
            // Skip leading whitespace-only chunks — models like DeepSeek
            // sometimes emit \n\n before actual text or tool calls.
            // When the first real chunk has embedded leading whitespace
            // (e.g. "\n\nHello"), strip it so the SSE stream is clean too.
            if (!seenNonWhitespaceText) {
              const trimmed = chunk.content.replace(/^\s+/, "");
              if (!trimmed) continue; // pure whitespace, skip
              seenNonWhitespaceText = true;
              iterationText += trimmed;
              finalContent += trimmed;
              send({ event: "chunk", data: { content: trimmed } });
              continue;
            }
            seenNonWhitespaceText = true;
            iterationText += chunk.content;
            finalContent += chunk.content;
            send({ event: "chunk", data: { content: chunk.content } });
          } else if (chunk.type === "tool_call") {
            // Guard: skip duplicate create_chart calls within the same turn.
            // The model sometimes emits multiple create_chart tool calls in a
            // single response. Only the first one is honored; subsequent ones
            // are silently skipped to prevent duplicate chart tabs.
            if (chunk.name === "create_chart") {
              const chartId = (chunk.arguments as Record<string, unknown>)?.chart_id as string | undefined;
              if (chartIdsCreatedThisTurn.size > 0) {
                console.warn(`[route] Skipping duplicate create_chart("${chartId ?? "?"}") — chart already created this turn`);
                continue;
              }
              if (chartId) chartIdsCreatedThisTurn.add(chartId);
            }

            // Skip duplicate generate_plan calls with identical parameters.
            // Different goal/start_year/period_years = different plan → allowed.
            if (chunk.name === "generate_plan") {
              const args = (chunk.arguments ?? {}) as Record<string, unknown>;
              const fp = `${args.goal ?? ""}|${args.start_year ?? ""}|${args.period_years ?? ""}`;
              if (planFingerprints.has(fp)) {
                console.warn(`[route] Skipping duplicate generate_plan(${fp}) — identical plan already generated`);
                send({ event: "tool_end", data: { id: chunk.id, name: chunk.name, result: "Plan with these parameters already generated." } });
                continue;
              }
              planFingerprints.add(fp);
            }

            send({ event: "tool_start", data: { id: chunk.id, name: chunk.name, args: chunk.arguments as Record<string, unknown> } });

            const result = await executeTool(chunk.name, chunk.arguments, ctx);

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

            send({ event: "tool_end", data: { id: chunk.id, name: chunk.name, result: result.result, error: result.error } });

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

        // Inject a newline between iterations so the frontend doesn't
        // concatenate adjacent-sentence texts like "laatimisella.Nyt".
        // Skip the last iteration — no separator needed after final text.
        if (iterationText.trim() && iteration < maxIterations - 1) {
          finalContent += "\n";
          send({ event: "chunk", data: { content: "\n" } });
        }
      }

      // Strip any remaining leading whitespace from model output (belt-and-suspenders
      // to the streaming guard above — catches edge cases like whitespace that slips
      // through due to multi-iteration accumulation).
      finalContent = finalContent.replace(/^\n+/, "").replace(/\n+$/, "");
      // Collapse excessive blank lines (3+ consecutive newlines → one blank line).
      // Models sometimes emit repetitive filler text between failed tool call retries,
      // leaving multiple empty paragraphs that look unprofessional.
      finalContent = finalContent.replace(/\n{3,}/g, "\n\n");

      // When model returns no text after tool execution (DeepSeek quirk),
      // generate a fallback summary so the user isn't left with empty output.
      // Also: when a terminal tool (create_chart) was called, append the tool's
      // result text so the user gets a clear confirmation message.
      if (!finalContent.trim()) {
        if (hasToolCalls) {
          // Model called tools but returned no text — use the tool's own result
          finalContent = lastToolResult ?? (createdChart
            ? serverMsg("chartCreatedFallback", lang)
            : serverMsg("doneFallback", lang));
          send({ event: "chunk", data: { content: finalContent } });
        } else {
          // Model produced nothing and didn't call any tools — provider issue.
          // Try auto-detect: if user looks like they want a plan, generate one.
          const userMsg = openRouterMessages.filter(m => m.role === "user").pop()?.content?.toLowerCase() ?? "";
          if (userMsg.includes("plan") || userMsg.includes("summary") || userMsg.includes("management")) {
            send({ event: "chunk", data: { content: serverMsg("generatingPlan", lang) } });
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
              send({ event: "chunk", data: { content: serverMsg("creatingChart", lang) } });
              const result = await executeTool("create_chart", chartArgs, ctx);
              if (result.success) {
                finalContent = result.result;
                send({ event: "chunk", data: { content: finalContent } });
              } else {
                finalContent = `❌ Could not create chart: ${result.error}`;
                send({ event: "chunk", data: { content: finalContent } });
              }
            } else {
              finalContent = serverMsg("emptyResponseChart", lang);
              send({ event: "chunk", data: { content: finalContent } });
            }
          } else {
            finalContent = serverMsg("emptyResponseGeneric", lang);
            send({ event: "chunk", data: { content: finalContent } });
          }
        }
      }

      // When a chart was created and the model produced its own text (not
      // the fallback above), append the chart's result text so the user
      // sees a clear confirmation alongside the model's natural response.
      if (createdChart && lastToolResult && finalContent.trim() !== lastToolResult) {
        finalContent += "\n" + lastToolResult;
        send({ event: "chunk", data: { content: "\n" + lastToolResult } });
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
