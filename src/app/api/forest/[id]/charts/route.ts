// src/app/api/forest/[id]/charts/route.ts
// Chart tabs API — GET list, POST upsert, DELETE single or all charts.

import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getChartTabs,
  deleteChartTab,
  deleteAllChartTabs,
} from "@/lib/repos/chart-tabs";
import type { ChartTab } from "@/lib/store/visualization-slice";

function mapTabToRow(forestId: string, tab: ChartTab) {
  return {
    forest_id: forestId,
    chart_id: tab.id,
    title: tab.title,
    type: tab.type,
    data: tab.data,
    x_key: tab.xKey,
    y_key: tab.yKey,
    y_key2: tab.yKey2,
    name_key: tab.nameKey,
    color_key: tab.colorKey,
    stand_dimension: tab.standDimension,
  };
}

/** GET /api/forest/[id]/charts — List all chart tabs for a forest. */
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

    const { id: forestId } = await params;
    const tabs = await getChartTabs(forestId);
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

    const { id: forestId } = await params;
    const body = await request.json();

    // Validate required fields
    if (!body.id || !body.title || !body.type || !body.data || !body.yKey) {
      return NextResponse.json(
        { error: "Missing required fields: id, title, type, data, yKey" },
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

    const row = mapTabToRow(forestId, body as ChartTab);
    await supabase.from("chart_tabs").upsert(row, {
      onConflict: "forest_id, chart_id",
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

    const { id: forestId } = await params;
    const chartId = request.nextUrl.searchParams.get("chart_id");

    if (chartId) {
      await deleteChartTab(forestId, chartId);
    } else {
      await deleteAllChartTabs(forestId);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
