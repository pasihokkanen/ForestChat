// src/app/api/forest/[id]/charts/route.ts
// Chart tabs API — GET list, POST upsert, DELETE single or all charts.
// Phase C3b: chart_tabs are user-scoped (user_id, chart_id unique constraint).

import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getChartTabs,
  deleteChartTab,
  deleteAllChartTabs,
} from "@/lib/repos/chart-tabs";
import type { ChartTab } from "@/lib/store/visualization-slice";

function mapTabToRow(userId: string, tab: ChartTab) {
  return {
    user_id: userId,
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
    ...(tab.waterfall_base != null ? { waterfall_base: tab.waterfall_base } : {}),
  };
}

/** GET /api/forest/[id]/charts — List all chart tabs for the user. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tabs = await getChartTabs(user.id);
    return NextResponse.json(tabs);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/** POST /api/forest/[id]/charts — Upsert a chart tab. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    // Validate required fields — data is optional when query_config is present
    const hasQueryConfig = !!body.query_config;
    if (!body.id || !body.title_en || !body.type || !body.y_key) {
      return NextResponse.json(
        { error: "Missing required fields: id, title_en, type, yKey" },
        { status: 400 }
      );
    }
    if (!hasQueryConfig && (!body.data || !Array.isArray(body.data))) {
      return NextResponse.json(
        { error: "data must be a non-empty array (or provide query_config)" },
        { status: 400 }
      );
    }

    const validTypes = [
      "bar",
      "pie",
      "line",
      "area",
      "stacked_bar",
      "scatter",
      "radar",
      "donut",
      "horizontal_bar",
      "composed",
      "waterfall",
    ];
    if (!validTypes.includes(body.type)) {
      return NextResponse.json(
        { error: `Invalid chart type: ${body.type}` },
        { status: 400 }
      );
    }

    const row = mapTabToRow(user.id, body as ChartTab);
    await supabase.from("chart_tabs").upsert(row, {
      onConflict: "user_id, chart_id",
    });

    return NextResponse.json({ success: true, chart_id: body.id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/** DELETE /api/forest/[id]/charts?chart_id=X — Delete a single or all chart tabs. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const chartId = request.nextUrl.searchParams.get("chart_id");

    if (chartId) {
      await deleteChartTab(user.id, chartId);
    } else {
      await deleteAllChartTabs(user.id);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
