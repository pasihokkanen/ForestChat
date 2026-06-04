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
import type { ChartQueryConfig, AnyQueryConfig } from "../ai/chart-engine";
import { serverMsg } from "../i18n";

export interface ToolResult {
  success: boolean;
  result: string;
  error?: string;
  /** Raw query results for UI integration (e.g., show_in_ui SSE events) */
  data?: Record<string, unknown>[];
}

export interface ToolContext {
  forestId: string;
  userId: string;
  supabase: SupabaseClient;
  sendSse?: (event: string, data: unknown) => void;
  language?: string;
}

type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext
) => Promise<ToolResult>;

const VALID_CHART_TYPES = [
  "bar", "pie", "line", "area", "stacked_bar", "scatter",
  "radar", "donut", "horizontal_bar", "composed", "waterfall",
];

/** Parse a Python-style dict string (single quotes) into a JavaScript object.
 *  Some models (Nemotron) serialize nested configs as Python dicts: "{'source': 'operations'}".
 *  This converts them to valid JSON-like objects. */
function parsePythonDict(s: string): Record<string, unknown> | null {
  try {
    // Try standard JSON first
    return JSON.parse(s);
  } catch {
    // Try Python-style: replace single quotes with double quotes
    try {
      const jsonLike = s.replace(/'/g, '"');
      return JSON.parse(jsonLike);
    } catch {
      // Try to handle more complex nested Python dicts
      try {
        // Replace Python keywords
        const cleaned = s
          .replace(/True/g, "true")
          .replace(/False/g, "false")
          .replace(/None/g, "null")
          .replace(/'/g, '"');
        return JSON.parse(cleaned);
      } catch {
        return null;
      }
    }
  }
}

/** Resolve a y_key to the query_config's as name if it matches a raw field name.
 *  The chart engine uses 'as' as the output column name, but AI models
 *  sometimes pass the raw field name (e.g. "income_eur" instead of "income").
 *  This guarantees the chart's dataKey matches the aggregated output column. */
function resolveAsName(config: ChartQueryConfig, key: string): string {
  for (const v of config.values) {
    if (v.field === key || v.as === key) return v.as;
  }
  return key;
}

const toolHandlers: Record<string, ToolHandler> = {
  generate_plan: async (args, ctx) => {
    return generatePlan(ctx.supabase, ctx.forestId, ctx.userId, {
      periodYears: (args.period_years as number) ?? 20,
      startYear: (args.start_year as number) ?? new Date().getFullYear(),
    });
  },
  get_stand: async (args, ctx) => getStand(ctx.supabase, ctx.forestId, args.stand_id as string),
  search_stands: async (args, ctx) => {
    const result = await searchStands(ctx.supabase, ctx.forestId, args as any);
    if (result.success) {
      // Extract stand IDs from query for show_in_ui
      // We need to re-run the DB query to get structured data for SSE
      // searchStands doesn't return data directly, so we extract stand_ids from args if present
      const standIds = Array.isArray(args.stand_ids) ? args.stand_ids as string[] : [];
      ctx.sendSse?.("show_in_ui", {
        target: "stands",
        standIds: standIds.length > 0 ? standIds : undefined,
        filters: {
          species: args.species,
          development_classes: args.development_classes,
          site_types: args.site_types,
          age_min: args.age_min,
          age_max: args.age_max,
          area_min: args.area_min,
          area_max: args.area_max,
          volume_min: args.volume_min,
          volume_max: args.volume_max,
        },
      });
    }
    return result;
  },
  plan_summary: async (_args, ctx) => planSummary(ctx.supabase, ctx.forestId),
  query_operations: async (args, ctx) => {
    const result = await queryOperations(ctx.supabase, ctx.forestId, args as any);
    if (result.success) {
      ctx.sendSse?.("show_in_ui", {
        target: "operations",
        filters: {
          years: args.years,
          types: args.types,
          stand_ids: args.stand_ids,
          species: args.species,
          income_min: args.income_min,
          income_max: args.income_max,
        },
      });
    }
    return result;
  },
  batch_update_operations: async (args, ctx) => batchUpdateOperations(ctx.supabase, ctx.forestId, (args.filter || {}) as any, (args.update || {}) as any),
  add_operation: async (args, ctx) => addOperation(ctx.supabase, ctx.forestId, ctx.userId, args),
  remove_operation: async (args, ctx) => removeOperation(ctx.supabase, ctx.forestId, args.stand_id as string, args.year as number),
  check_harvest_sustainability: async (args, ctx) => checkSustainability(ctx.supabase, ctx.forestId, args.year as number | undefined),
  validate_plan: async (_args, ctx) => validatePlan(ctx.supabase, ctx.forestId),

  // Phase 4b: Visualization tools
  create_chart: async (args, ctx) => {
    const { chart_id, title, type, query_config, data, x_key, y_key, name_key, color_key, y_key2, waterfall_base } = args;

    if (!chart_id || typeof chart_id !== "string") {
      return { success: false, result: "", error: "chart_id is required" };
    }
    if (!VALID_CHART_TYPES.includes(type as string)) {
      return { success: false, result: "", error: `Invalid chart type: ${type}` };
    }

    // BRANCH: query_config mode (auto-updating — recommended)
    if (query_config) {
      try {
        // Handle Python-style dict strings from some models (e.g. "{'source': 'operations'}")
        let qc: AnyQueryConfig;
        if (typeof query_config === "string") {
          const parsed = parsePythonDict(query_config as string);
          if (!parsed || !parsed.source) {
            return { success: false, result: "", error: "query_config must be a valid object — received a string that could not be parsed" };
          }
          qc = parsed as unknown as AnyQueryConfig;
        } else {
          qc = query_config as AnyQueryConfig;
        }

        const engineResult = await recomputeChartData(
          ctx.supabase,
          ctx.forestId,
          qc
        );

        // Auto-resolve y_key / y_key2 to match the 'as' names in query_config values.
        // Only for single-source configs — cross configs have no top-level values array
        // and rely on explicit x_key/y_key/name_key from the model.
        const isSingleSource = qc.source !== "cross" && Array.isArray((qc as ChartQueryConfig).values);
        const scValues = isSingleSource ? (qc as ChartQueryConfig).values : undefined;

        const resolvedYKey = (y_key as string)
          ? (scValues ? resolveAsName(qc as ChartQueryConfig, y_key as string) : (y_key as string))
          : (scValues && scValues.length > 0 ? scValues[0].as : null);
        const resolvedYKey2 = y_key2
          ? (scValues ? resolveAsName(qc as ChartQueryConfig, y_key2 as string) : (y_key2 as string))
          : null;

        if (!resolvedYKey) {
          return { success: false, result: "", error: "y_key is required — could not determine value column from query_config" };
        }

        // Auto-detect name_key for pie/donut charts: use first group_by field if name_key not provided
        // (single-source configs only — cross configs must provide name_key explicitly)
        const effectiveNameKey = (name_key as string)
          ?? ((type === "pie" || type === "donut") && isSingleSource && (qc as ChartQueryConfig).aggregate?.length > 0
            ? (qc as ChartQueryConfig).aggregate[0].group_by
            : null);

        // Auto-detect x_key for bar/line/area charts: use first group_by field if x_key not provided
        // (single-source configs only — cross configs must provide x_key explicitly)
        const effectiveXKey = (x_key as string)
          ?? ((type === "bar" || type === "line" || type === "area" || type === "horizontal_bar" || type === "scatter" || type === "radar" || type === "composed" || type === "waterfall")
            && isSingleSource && (qc as ChartQueryConfig).aggregate?.length > 0
            ? (qc as ChartQueryConfig).aggregate[0].group_by
            : null);

        const chartTab = {
          id: chart_id as string,
          title: title as string,
          type: type as string,
          data: engineResult.data,
          query_config,
          computed_at: engineResult.computedAt,
          xKey: effectiveXKey,
          yKey: resolvedYKey,
          yKey2: resolvedYKey2,
          nameKey: effectiveNameKey,
          colorKey: (color_key as string) ?? null,
          waterfall_base: (waterfall_base as number) ?? null,
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
          waterfall_base: chartTab.waterfall_base,
        }, { onConflict: "forest_id, chart_id" });

        ctx.sendSse?.("create_chart", chartTab);

        return {
          success: true,
          result: serverMsg("chartCreatedEngine", (ctx.language ?? "en") as "en" | "fi", String(title), String(type), String(engineResult.data.length)),
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
      waterfall_base: (waterfall_base as number) ?? null,
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
        waterfall_base: chartTab.waterfall_base,
      }, { onConflict: "forest_id, chart_id" });
    } catch (err) {
      console.error("Failed to persist chart tab:", err);
    }

    ctx.sendSse?.("create_chart", chartTab);

    return {
      success: true,
      result: serverMsg("chartCreatedLegacy", (ctx.language ?? "en") as "en" | "fi", String(title), String(type), String(data.length)),
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
      result: serverMsg("standSelected", (ctx.language ?? "en") as "en" | "fi", String(stand_id)),
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
      result: serverMsg("chartRemoved", (ctx.language ?? "en") as "en" | "fi", chart_id as string),
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
      result: serverMsg("chartsCleared", (ctx.language ?? "en") as "en" | "fi"),
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
