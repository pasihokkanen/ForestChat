import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import type { ChartTab } from "@/lib/store/visualization-slice";

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

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const forestsParam = request.nextUrl.searchParams.get("forests");
    if (!forestsParam) {
      return NextResponse.json([]);
    }

    const forestIds = forestsParam.split(",").map((id) => id.trim()).filter(Boolean);
    if (forestIds.length === 0) {
      return NextResponse.json([]);
    }

    const { data } = await supabase
      .from("chart_tabs")
      .select("*")
      .in("forest_id", forestIds)
      .order("created_at", { ascending: true });

    const tabs = (data ?? []).map(mapRowToChartTab);
    return NextResponse.json(tabs);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
