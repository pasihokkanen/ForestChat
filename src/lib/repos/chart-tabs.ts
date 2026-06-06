// src/lib/repos/chart-tabs.ts
// Supabase repo for chart_tabs CRUD operations.

import { createServerSupabase } from "@/lib/supabase/server";
import type { ChartTab } from "@/lib/store/visualization-slice";

export async function getChartTabs(forestId: string): Promise<ChartTab[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("chart_tabs")
    .select("*")
    .eq("forest_id", forestId)
    .order("created_at", { ascending: true });
  return (data ?? []).map(mapRowToChartTab);
}

export async function upsertChartTab(
  forestId: string,
  tab: ChartTab
): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase.from("chart_tabs").upsert(
    {
      forest_id: forestId,
      chart_id: tab.id,
      title_en: tab.title_en,
      title_fi: tab.title_fi ?? null,
      type: tab.type,
      data: tab.data,
      x_key: tab.x_key,
      y_key: tab.y_key,
      y_key2: tab.y_key2,
      name_key: tab.name_key,
      color_key: tab.color_key,
      ...(tab.query_config ? { query_config: tab.query_config } : {}),
      ...(tab.computed_at ? { computed_at: tab.computed_at } : {}),
    },
    { onConflict: "forest_id, chart_id" }
  );
}

export async function deleteChartTab(
  forestId: string,
  chartId: string
): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase
    .from("chart_tabs")
    .delete()
    .eq("forest_id", forestId)
    .eq("chart_id", chartId);
}

export async function deleteAllChartTabs(forestId: string): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase.from("chart_tabs").delete().eq("forest_id", forestId);
}

function mapRowToChartTab(row: Record<string, unknown>): ChartTab {
  return {
    id: row.chart_id as string,
    title_en: row.title_en as string,
    title_fi: (row.title_fi as string) ?? null,
    type: row.type as ChartTab["type"],
    data: (row.data as Record<string, unknown>[]) ?? [],
    x_key: (row.x_key as string) ?? null,
    y_key: row.y_key as string,
    y_key2: (row.y_key2 as string) ?? null,
    name_key: (row.name_key as string) ?? null,
    color_key: (row.color_key as string) ?? null,
    query_config: (row.query_config as Record<string, unknown>) ?? null,
    computed_at: (row.computed_at as string) ?? null,
    waterfall_base: (row.waterfall_base as number) ?? null,
  };
}
