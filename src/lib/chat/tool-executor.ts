// src/lib/chat/tool-executor.ts
//
// Maps tool names to handler functions. Executes a named tool with args + context.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolDefinition } from "./tools";
import { generatePlan } from "../ai/generate-plan";
import { getStand, searchStands, planSummary, queryOperations } from "../ai/query-tools";
import { addOperation, removeOperations, batchUpdateOperations } from "../ai/edit-tools";
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

/** Parse a Python-style dict string (single quotes) into a JavaScript object. */
function parsePythonDict(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s); } catch {
    try { return JSON.parse(s.replace(/'/g, '"')); } catch {
      try {
        const cleaned = s.replace(/True/g, "true").replace(/False/g, "false").replace(/None/g, "null").replace(/'/g, '"');
        return JSON.parse(cleaned);
      } catch { return null; }
    }
  }
}

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

  // Pure data-fetching — no UI side effects
  search_stands: async (args, ctx) => {
    return searchStands(ctx.supabase, ctx.forestId, args as any);
  },

  plan_summary: async (_args, ctx) => planSummary(ctx.supabase, ctx.forestId),

  // Pure data-fetching — no UI side effects
  query_operations: async (args, ctx) => {
    return queryOperations(ctx.supabase, ctx.forestId, args as any);
  },

  show_stands: async (args, ctx) => {
    ctx.sendSse?.("show_in_ui", {
      target: "stands",
      filters: {
        species: args.species, development_classes: args.development_classes,
        site_types: args.site_types, age_min: args.age_min, age_max: args.age_max,
        area_min: args.area_min, area_max: args.area_max,
        volume_min: args.volume_min, volume_max: args.volume_max,
        basal_area_min: args.basal_area_min, basal_area_max: args.basal_area_max,
        height_min: args.height_min, height_max: args.height_max,
        diameter_min: args.diameter_min, diameter_max: args.diameter_max,
        growth_min: args.growth_min, growth_max: args.growth_max,
      },
    });
    const lang = (ctx.language ?? "en") as "en" | "fi";
    return { success: true, result: serverMsg("standsShown", lang) };
  },

  show_operations: async (args, ctx) => {
    ctx.sendSse?.("show_in_ui", {
      target: "operations",
      filters: {
        years: args.years, types: args.types, stand_ids: args.stand_ids,
        species: args.species, development_classes: args.development_classes,
        site_types: args.site_types, income_min: args.income_min, income_max: args.income_max,
        cost_min: args.cost_min, cost_max: args.cost_max,
        stand_age_min: args.stand_age_min, stand_age_max: args.stand_age_max,
        stand_area_min: args.stand_area_min, stand_area_max: args.stand_area_max,
      },
    });
    const lang = (ctx.language ?? "en") as "en" | "fi";
    return { success: true, result: serverMsg("operationsShown", lang) };
  },

  batch_update_operations: async (args, ctx) =>
    batchUpdateOperations(ctx.supabase, ctx.forestId, (args.filter || {}) as any, (args.update || {}) as any, (ctx.language ?? "en") as "en" | "fi"),

  add_operation: async (args, ctx) => {
    const lang = (ctx.language ?? "en") as "en" | "fi";
    // BATCH MODE
    if (Array.isArray(args.operations) && args.operations.length > 0) {
      const ops = args.operations as Array<Record<string, unknown>>;
      const results: string[] = [];
      let successCount = 0;
      for (const op of ops) {
        const r = await addOperation(ctx.supabase, ctx.forestId, ctx.userId, op, lang);
        if (r.success) { successCount++; results.push(r.result); }
        else { results.push(serverMsg("operationAddError", lang, String(op.stand_id ?? "?"), r.error ?? "unknown error")); }
      }
      return {
        success: successCount > 0,
        result: serverMsg("operationsAdded", lang, String(successCount), String(ops.length), results.join("\n")),
      };
    }
    return addOperation(ctx.supabase, ctx.forestId, ctx.userId, args, lang);
  },

  remove_operation: async (args, ctx) => {
    const rawIds = Array.isArray(args.stand_ids)
      ? args.stand_ids.map(String)
      : args.stand_id != null ? [String(args.stand_id)] : [];
    if (rawIds.length === 0) return { success: false, result: "", error: "stand_id or stand_ids is required" };
    const year = args.year != null ? Number(args.year) : undefined;
    const typeFilter = args.type as string | undefined;
    return removeOperations(ctx.supabase, ctx.forestId, rawIds, year, typeFilter, (ctx.language ?? "en") as "en" | "fi");
  },

  check_harvest_sustainability: async (args, ctx) => checkSustainability(ctx.supabase, ctx.forestId, args.year as number | undefined),
  validate_plan: async (_args, ctx) => validatePlan(ctx.supabase, ctx.forestId),

  // ── Visualization tools ──

  create_chart: async (args, ctx) => {
    const { chart_id, title, type, query_config, data, x_key, y_key, name_key, color_key, y_key2, waterfall_base } = args;
    if (!chart_id || typeof chart_id !== "string") return { success: false, result: "", error: "chart_id is required" };
    if (!VALID_CHART_TYPES.includes(type as string)) return { success: false, result: "", error: `Invalid chart type: ${type}` };

    if (query_config) {
      try {
        let qc: AnyQueryConfig;
        if (typeof query_config === "string") {
          const parsed = parsePythonDict(query_config as string);
          if (!parsed || !parsed.source) return { success: false, result: "", error: "query_config must be a valid object" };
          qc = parsed as unknown as AnyQueryConfig;
        } else { qc = query_config as AnyQueryConfig; }

        const engineResult = await recomputeChartData(ctx.supabase, ctx.forestId, qc);
        const isSingleSource = qc.source !== "cross" && Array.isArray((qc as ChartQueryConfig).values);
        const scValues = isSingleSource ? (qc as ChartQueryConfig).values : undefined;

        const resolvedYKey = (y_key as string)
          ? (scValues ? resolveAsName(qc as ChartQueryConfig, y_key as string) : (y_key as string))
          : (scValues && scValues.length > 0 ? scValues[0].as : null);
        const resolvedYKey2 = y_key2
          ? (scValues ? resolveAsName(qc as ChartQueryConfig, y_key2 as string) : (y_key2 as string))
          : null;
        if (!resolvedYKey) return { success: false, result: "", error: "y_key is required" };

        const effectiveNameKey = (name_key as string)
          ?? ((type === "pie" || type === "donut") && isSingleSource && (qc as ChartQueryConfig).aggregate?.length > 0
            ? (qc as ChartQueryConfig).aggregate[0].group_by : null);
        const effectiveXKey = (x_key as string)
          ?? ((type === "bar" || type === "line" || type === "area" || type === "horizontal_bar" || type === "scatter" || type === "radar" || type === "composed" || type === "waterfall")
            && isSingleSource && (qc as ChartQueryConfig).aggregate?.length > 0
            ? (qc as ChartQueryConfig).aggregate[0].group_by : null);

        const chartTab = {
          id: chart_id as string, title: title as string, type: type as string,
          data: engineResult.data, query_config, computed_at: engineResult.computedAt,
          x_key: effectiveXKey, y_key: resolvedYKey, y_key2: resolvedYKey2,
          name_key: effectiveNameKey, color_key: (color_key as string) ?? null,
          waterfall_base: (waterfall_base as number) ?? null,
        };

        await ctx.supabase.from("chart_tabs").upsert({
          forest_id: ctx.forestId, chart_id: chartTab.id, title: chartTab.title,
          type: chartTab.type, data: chartTab.data, query_config: chartTab.query_config,
          computed_at: chartTab.computed_at, x_key: chartTab.x_key, y_key: chartTab.y_key,
          y_key2: chartTab.y_key2, name_key: chartTab.name_key, color_key: chartTab.color_key,
          waterfall_base: chartTab.waterfall_base,
        }, { onConflict: "forest_id, chart_id" });

        ctx.sendSse?.("create_chart", chartTab);
        return { success: true, result: serverMsg("chartCreatedEngine", (ctx.language ?? "en") as "en" | "fi", String(title), String(type), String(engineResult.data.length)) };
      } catch (err) {
        return { success: false, result: "", error: `Chart engine error: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    // Legacy static data mode
    if (!Array.isArray(data) || data.length === 0) return { success: false, result: "", error: "data must be a non-empty array" };
    const chartTab = {
      id: chart_id as string, title: title as string, type: type as string,
      data: data as Record<string, unknown>[], x_key: (x_key as string) ?? null,
      y_key: y_key as string, y_key2: (y_key2 as string) ?? null,
      name_key: (name_key as string) ?? null, color_key: (color_key as string) ?? null,
      waterfall_base: (waterfall_base as number) ?? null,
    };
    try {
      await ctx.supabase.from("chart_tabs").upsert({
        forest_id: ctx.forestId, chart_id: chartTab.id, title: chartTab.title,
        type: chartTab.type, data: chartTab.data, x_key: chartTab.x_key,
        y_key: chartTab.y_key, y_key2: chartTab.y_key2, name_key: chartTab.name_key,
        color_key: chartTab.color_key, waterfall_base: chartTab.waterfall_base,
      }, { onConflict: "forest_id, chart_id" });
    } catch (err) { console.error("Failed to persist chart tab:", err); }
    ctx.sendSse?.("create_chart", chartTab);
    return { success: true, result: serverMsg("chartCreatedLegacy", (ctx.language ?? "en") as "en" | "fi", String(title), String(type), String(data.length)) };
  },

  select_stand: async (args, ctx) => {
    const { stand_ids, age_min, age_max, species, development_classes, site_types, area_min, area_max, volume_min, volume_max, basal_area_min, basal_area_max, height_min, height_max, diameter_min, diameter_max, growth_min, growth_max } = args;

    // If filter criteria given instead of explicit IDs, search first
    let ids: string[];
    if (stand_ids) {
      ids = Array.isArray(stand_ids) ? stand_ids.map(String) : [String(stand_ids)];
      // Validate — check which IDs actually exist in the DB
      const { data: existing } = await ctx.supabase
        .from("compartments")
        .select("stand_id")
        .eq("forest_id", ctx.forestId)
        .in("stand_id", ids);
      const existingIds = new Set(((existing as Array<{ stand_id: string }>) ?? []).map(r => r.stand_id));
      const missing = ids.filter(id => !existingIds.has(id));
      if (missing.length > 0) {
        const lang = (ctx.language ?? "en") as "en" | "fi";
        if (missing.length === ids.length) {
          return { success: false, result: "", error: serverMsg("standsNotFound", lang, missing.join(", ")) };
        }
        // Partial match — warn about missing but select the rest
        ids = ids.filter(id => existingIds.has(id));
        if (ids.length === 0) return { success: false, result: "", error: serverMsg("standsNotFound", lang, missing.join(", ")) };
      }
    } else if (age_min !== undefined || age_max !== undefined || species || development_classes || site_types || area_min !== undefined || area_max !== undefined || volume_min !== undefined || volume_max !== undefined || basal_area_min !== undefined || basal_area_max !== undefined || height_min !== undefined || height_max !== undefined || diameter_min !== undefined || diameter_max !== undefined || growth_min !== undefined || growth_max !== undefined) {
      const result = await searchStands(ctx.supabase, ctx.forestId, {
        age_min: age_min as number | undefined,
        age_max: age_max as number | undefined,
        species: species as string[] | undefined,
        development_classes: development_classes as string[] | undefined,
        site_types: site_types as string[] | undefined,
        area_min: area_min as number | undefined,
        area_max: area_max as number | undefined,
        volume_min: volume_min as number | undefined,
        volume_max: volume_max as number | undefined,
        basal_area_min: basal_area_min as number | undefined,
        basal_area_max: basal_area_max as number | undefined,
        height_min: height_min as number | undefined,
        height_max: height_max as number | undefined,
        diameter_min: diameter_min as number | undefined,
        diameter_max: diameter_max as number | undefined,
        growth_min: growth_min as number | undefined,
        growth_max: growth_max as number | undefined,
        fields: ["stand_id"],
        limit: 0,
      });
      if (!result.success) return result;
      ids = (result.data ?? []).map((r: Record<string, unknown>) => String(r.stand_id));
    } else {
      ids = [];
    }

    if (ids.length === 0) return { success: false, result: "", error: "stand_ids is required" };
    ctx.sendSse?.("show_in_ui", { target: "map", standIds: ids });
    ctx.sendSse?.("select_stand", { stand_ids: ids });
    const label = ids.length === 1
      ? serverMsg("standSelected", (ctx.language ?? "en") as "en" | "fi", ids[0])
      : serverMsg("standsSelected", (ctx.language ?? "en") as "en" | "fi", String(ids.length), ids.join(", "));
    return { success: true, result: label };
  },

  remove_chart: async (args, ctx) => {
    const { chart_id } = args;
    if (!chart_id || typeof chart_id !== "string") return { success: false, result: "", error: "chart_id is required" };
    try { await ctx.supabase.from("chart_tabs").delete().eq("forest_id", ctx.forestId).eq("chart_id", chart_id); }
    catch (err) { console.error("Failed to remove chart tab:", err); }
    ctx.sendSse?.("remove_chart", { chart_id });
    return { success: true, result: serverMsg("chartRemoved", (ctx.language ?? "en") as "en" | "fi", chart_id as string) };
  },

  clear_charts: async (_args, ctx) => {
    try { await ctx.supabase.from("chart_tabs").delete().eq("forest_id", ctx.forestId); }
    catch (err) { console.error("Failed to clear chart tabs:", err); }
    ctx.sendSse?.("clear_charts", {});
    return { success: true, result: serverMsg("chartsCleared", (ctx.language ?? "en") as "en" | "fi") };
  },

  list_charts: async (_args, ctx) => {
    const { data } = await ctx.supabase
      .from("chart_tabs")
      .select("chart_id, title, type, x_key, y_key, y_key2, name_key, color_key, query_config")
      .eq("forest_id", ctx.forestId).order("created_at", { ascending: true });
    const lang = (ctx.language ?? "en") as "en" | "fi";
    if (!data || data.length === 0) return { success: true, result: serverMsg("noChartsFound", lang) };
    const lines = (data as Array<Record<string, unknown>>).map((c) =>
      `- ${c.chart_id}: "${c.title}" (${c.type})` +
      (c.x_key ? ` x=${c.x_key}` : "") + (c.y_key ? ` y=${c.y_key}` : "") +
      (c.y_key2 ? ` y2=${c.y_key2}` : "") + (c.name_key ? ` name=${c.name_key}` : "") +
      (c.color_key ? ` color=${c.color_key}` : "") +
      (c.query_config ? `\n    query_config: ${JSON.stringify(c.query_config)}` : "")
    );
    return { success: true, result: serverMsg("chartsListed", lang, String(data.length), lines.join("\n")) };
  },

  update_chart: async (args, ctx) => {
    const { chart_id, title, type, x_key, y_key, y_key2, name_key, color_key, waterfall_base } = args;
    if (!chart_id || typeof chart_id !== "string") return { success: false, result: "", error: "chart_id is required" };
    const { data: existing } = await ctx.supabase.from("chart_tabs").select("*").eq("forest_id", ctx.forestId).eq("chart_id", chart_id as string).single();
    if (!existing) return { success: false, result: "", error: `Chart "${chart_id}" not found` };
    const update: Record<string, unknown> = {};
    if (title !== undefined) update.title = title;
    if (type !== undefined) update.type = type;
    if (x_key !== undefined) update.x_key = x_key;
    if (y_key !== undefined) update.y_key = y_key;
    if (y_key2 !== undefined) update.y_key2 = y_key2;
    if (name_key !== undefined) update.name_key = name_key;
    if (color_key !== undefined) update.color_key = color_key;
    if (waterfall_base !== undefined) update.waterfall_base = waterfall_base;
    await ctx.supabase.from("chart_tabs").update(update).eq("forest_id", ctx.forestId).eq("chart_id", chart_id as string);
    const merged = { ...existing, ...update };
    const updated = {
      id: merged.chart_id as string, title: merged.title as string, type: merged.type as string,
      data: (merged.data as Record<string, unknown>[]) ?? [],
      x_key: (merged.x_key as string) ?? null, y_key: merged.y_key as string,
      y_key2: (merged.y_key2 as string) ?? null, name_key: (merged.name_key as string) ?? null,
      color_key: (merged.color_key as string) ?? null,
      query_config: (merged.query_config as Record<string, unknown>) ?? null,
      computed_at: (merged.computed_at as string) ?? null,
      waterfall_base: (merged.waterfall_base as number) ?? null,
    };
    ctx.sendSse?.("create_chart", updated);
    const lang = (ctx.language ?? "en") as "en" | "fi";
    return { success: true, result: serverMsg("chartUpdated", lang, String(chart_id), Object.keys(update).filter(k => k !== "chart_id").join(", ")) };
  },

  recreate_chart: async (args, ctx) => {
    const { chart_id, query_config, title, type, x_key, y_key, y_key2, name_key, color_key, waterfall_base } = args;
    if (!chart_id || typeof chart_id !== "string") return { success: false, result: "", error: "chart_id is required" };
    if (!query_config) return { success: false, result: "", error: "query_config is required" };
    const engineResult = await recomputeChartData(ctx.supabase, ctx.forestId, query_config as AnyQueryConfig);
    const { data: existing } = await ctx.supabase.from("chart_tabs").select("*").eq("forest_id", ctx.forestId).eq("chart_id", chart_id as string).single();
    const newTitle = (title as string) ?? (existing as Record<string, unknown>)?.title;
    const newType = (type as string) ?? (existing as Record<string, unknown>)?.type ?? "bar";
    const chartTab = {
      id: chart_id as string, title: newTitle, type: newType,
      data: engineResult.data, query_config, computed_at: engineResult.computedAt,
      x_key: (x_key as string) ?? ((existing as Record<string, unknown>)?.x_key as string) ?? null,
      y_key: (y_key as string) ?? (existing as Record<string, unknown>)?.y_key as string,
      y_key2: (y_key2 as string) ?? ((existing as Record<string, unknown>)?.y_key2 as string) ?? null,
      name_key: (name_key as string) ?? ((existing as Record<string, unknown>)?.name_key as string) ?? null,
      color_key: (color_key as string) ?? ((existing as Record<string, unknown>)?.color_key as string) ?? null,
      waterfall_base: (waterfall_base as number) ?? ((existing as Record<string, unknown>)?.waterfall_base as number) ?? null,
    };
    await ctx.supabase.from("chart_tabs").upsert({
      forest_id: ctx.forestId, chart_id: chartTab.id, title: chartTab.title,
      type: chartTab.type, data: chartTab.data, query_config: chartTab.query_config,
      computed_at: chartTab.computed_at, x_key: chartTab.x_key, y_key: chartTab.y_key,
      y_key2: chartTab.y_key2, name_key: chartTab.name_key, color_key: chartTab.color_key,
      waterfall_base: chartTab.waterfall_base,
    }, { onConflict: "forest_id, chart_id" });
    ctx.sendSse?.("create_chart", chartTab);
    return { success: true, result: serverMsg("chartCreatedEngine", (ctx.language ?? "en") as "en" | "fi", String(newTitle), String(newType), String(engineResult.data.length)) };
  },
};

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const handler = toolHandlers[name];
  if (!handler) return { success: false, result: "", error: `Unknown tool: ${name}` };
  return handler(args, context);
}

export { getTools } from "./tools";
