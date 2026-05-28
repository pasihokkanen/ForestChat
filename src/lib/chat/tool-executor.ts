// src/lib/chat/tool-executor.ts
//
// Maps tool names to handler functions. Executes a named tool with args + context.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolDefinition } from "./tools";
import { generatePlan } from "../ai/generate-plan";
import { getStand, searchStands, planSummary, queryOperations } from "../ai/query-tools";
import { addOperation, removeOperation, batchUpdateOperations } from "../ai/edit-tools";
import { checkSustainability, validatePlan } from "../ai/validation-tools";
import { recomputeChartData } from "../ai/chart-engine";
import type { ChartQueryConfig } from "../ai/chart-engine";

export interface ToolResult {
  success: boolean;
  result: string;
  error?: string;
}

export interface ToolContext {
  forestId: string;
  userId: string;
  supabase: SupabaseClient;
  sendSse?: (event: string, data: unknown) => void;
}

type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext
) => Promise<ToolResult>;

const VALID_CHART_TYPES = [
  "bar", "pie", "line", "area", "stacked_bar", "scatter",
  "radar", "donut", "horizontal_bar", "composed", "waterfall",
];

const toolHandlers: Record<string, ToolHandler> = {
  generate_plan: async (args, ctx) => {
    return generatePlan(ctx.supabase, ctx.forestId, ctx.userId, {
      periodYears: (args.period_years as number) ?? 20,
      startYear: (args.start_year as number) ?? new Date().getFullYear(),
    });
  },
  get_stand: async (args, ctx) => getStand(ctx.supabase, ctx.forestId, args.stand_id as string),
  search_stands: async (args, ctx) => searchStands(ctx.supabase, ctx.forestId, args as any),
  plan_summary: async (_args, ctx) => planSummary(ctx.supabase, ctx.forestId),
  query_operations: async (args, ctx) => queryOperations(ctx.supabase, ctx.forestId, args as any),
  batch_update_operations: async (args, ctx) => batchUpdateOperations(ctx.supabase, ctx.forestId, (args.filter || {}) as any, (args.update || {}) as any),
  add_operation: async (args, ctx) => addOperation(ctx.supabase, ctx.forestId, ctx.userId, args),
  remove_operation: async (args, ctx) => removeOperation(ctx.supabase, ctx.forestId, args.stand_id as string, args.year as number),
  check_harvest_sustainability: async (args, ctx) => checkSustainability(ctx.supabase, ctx.forestId, args.year as number | undefined),
  validate_plan: async (_args, ctx) => validatePlan(ctx.supabase, ctx.forestId),

  // Phase 4b: Visualization tools
  create_chart: async (args, ctx) => {
    const { chart_id, title, type, query_config, data, x_key, y_key, name_key, color_key, stand_dimension, y_key2 } = args;

    if (!chart_id || typeof chart_id !== "string") {
      return { success: false, result: "", error: "chart_id is required" };
    }
    if (!VALID_CHART_TYPES.includes(type as string)) {
      return { success: false, result: "", error: `Invalid chart type: ${type}` };
    }

    // BRANCH: query_config mode (auto-updating — recommended)
    if (query_config) {
      try {
        const engineResult = await recomputeChartData(
          ctx.supabase,
          ctx.forestId,
          query_config as ChartQueryConfig
        );

        const chartTab = {
          id: chart_id as string,
          title: title as string,
          type: type as string,
          data: engineResult.data,
          query_config,
          computed_at: engineResult.computedAt,
          xKey: (x_key as string) ?? null,
          yKey: y_key as string,
          yKey2: (y_key2 as string) ?? null,
          nameKey: (name_key as string) ?? null,
          colorKey: (color_key as string) ?? null,
          standDimension: (stand_dimension as string) ?? null,
        };

        await ctx.supabase.from("chart_tabs").upsert({
          forest_id: ctx.forestId,
          chart_id: chartTab.id,
          title: chartTab.title,
          type: chartTab.type,
          data: chartTab.data,
          query_config: chartTab.query_config,
          computed_at: chartTab.computed_at,
          x_key: chartTab.xKey,
          y_key: chartTab.yKey,
          y_key2: chartTab.yKey2,
          name_key: chartTab.nameKey,
          color_key: chartTab.colorKey,
          stand_dimension: chartTab.standDimension,
        }, { onConflict: "forest_id, chart_id" });

        ctx.sendSse?.("create_chart", chartTab);

        return {
          success: true,
          result: `✅ Chart "${title}" created (${type}, ${engineResult.data.length} data points). Auto-updates when plan changes.`,
        };
      } catch (err) {
        return {
          success: false,
          result: "",
          error: `Chart engine error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // BRANCH: legacy static data mode
    if (!Array.isArray(data) || data.length === 0) {
      return { success: false, result: "", error: "data must be a non-empty array" };
    }

    const chartTab = {
      id: chart_id as string,
      title: title as string,
      type: type as string,
      data: data as Record<string, unknown>[],
      xKey: (x_key as string) ?? null,
      yKey: y_key as string,
      yKey2: (y_key2 as string) ?? null,
      nameKey: (name_key as string) ?? null,
      colorKey: (color_key as string) ?? null,
      standDimension: (stand_dimension as string) ?? null,
    };

    // Persist to Supabase
    try {
      await ctx.supabase.from("chart_tabs").upsert({
        forest_id: ctx.forestId,
        chart_id: chartTab.id,
        title: chartTab.title,
        type: chartTab.type,
        data: chartTab.data,
        x_key: chartTab.xKey,
        y_key: chartTab.yKey,
        y_key2: chartTab.yKey2,
        name_key: chartTab.nameKey,
        color_key: chartTab.colorKey,
        stand_dimension: chartTab.standDimension,
      }, { onConflict: "forest_id, chart_id" });
    } catch (err) {
      console.error("Failed to persist chart tab:", err);
    }

    ctx.sendSse?.("create_chart", chartTab);

    return {
      success: true,
      result: `✅ Chart "${title}" created (${type}, ${data.length} data points). The chart is now visible in the visualization panel.`,
    };
  },

  select_stand: async (args, ctx) => {
    const { stand_id } = args;
    if (!stand_id || typeof stand_id !== "string") {
      return { success: false, result: "", error: "stand_id is required" };
    }
    ctx.sendSse?.("select_stand", { stand_id });
    return {
      success: true,
      result: `✅ Stand ${stand_id} selected on map.`,
    };
  },

  remove_chart: async (args, ctx) => {
    const { chart_id } = args;
    if (!chart_id || typeof chart_id !== "string") {
      return { success: false, result: "", error: "chart_id is required" };
    }
    try {
      await ctx.supabase.from("chart_tabs")
        .delete()
        .eq("forest_id", ctx.forestId)
        .eq("chart_id", chart_id);
    } catch (err) {
      console.error("Failed to remove chart tab:", err);
    }
    ctx.sendSse?.("remove_chart", { chart_id });
    return {
      success: true,
      result: `✅ Chart "${chart_id}" removed.`,
    };
  },

  // Phase 4b: clear_charts — deletes directly from DB (no longer calls invalidateChartTabs)
  clear_charts: async (_args, ctx) => {
    try {
      await ctx.supabase.from("chart_tabs")
        .delete()
        .eq("forest_id", ctx.forestId);
    } catch (err) {
      console.error("Failed to clear chart tabs:", err);
    }
    ctx.sendSse?.("clear_charts", {});
    return {
      success: true,
      result: "✅ All charts cleared from the visualization panel.",
    };
  },
};

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const handler = toolHandlers[name];
  if (!handler) {
    return { success: false, result: "", error: `Unknown tool: ${name}` };
  }
  return handler(args, context);
}

export { getTools } from "./tools";
