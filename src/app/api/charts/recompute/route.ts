import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { recomputeAllCharts } from "@/lib/ai/chart-engine";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const forestIds: string[] = Array.isArray(body?.forestIds) ? body.forestIds : [];

    if (forestIds.length === 0) {
      return NextResponse.json({ recomputed_ids: [], count: 0 });
    }

    await recomputeAllCharts(supabase, forestIds, user.id);

    const { data } = await supabase
      .from("chart_tabs")
      .select("chart_id")
      .eq("user_id", user.id)
      .not("query_config", "is", null);

    const recomputedIds = (data ?? []).map((row: { chart_id: string }) => row.chart_id);

    return NextResponse.json({ recomputed_ids: recomputedIds, count: recomputedIds.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
