// src/app/api/forest/[id]/simulate/route.ts
// POST /api/forest/[id]/simulate
// Simulates a single stand forward from its initial DB state,
// applying current operations in year order. Returns YearSnapshot[].
//
// Body: { stand_id: string }
// Response: { snapshots: YearSnapshot[] }

import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { enrichCompartment } from "@/lib/ai/generate-plan";
import { simulateStand } from "@/lib/ai/stand-simulator";
import type { DBOperation } from "@/lib/ai/stand-simulator";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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
    const standId = body.stand_id as string;

    if (!standId) {
      return NextResponse.json({ error: "stand_id is required" }, { status: 400 });
    }

    // Fetch compartment
    const { data: compartment, error: compErr } = await supabase
      .from("compartments")
      .select("*")
      .eq("forest_id", forestId)
      .eq("stand_id", standId)
      .single();

    if (compErr || !compartment) {
      return NextResponse.json({ error: `Stand ${standId} not found` }, { status: 404 });
    }

    // Fetch compartment species
    const { data: speciesRows } = await supabase
      .from("compartment_species")
      .select("*")
      .eq("forest_id", forestId)
      .eq("stand_id", standId);

    // Fetch operations for this stand
    const { data: operations } = await supabase
      .from("operations")
      .select("type, year, removal_pct")
      .eq("forest_id", forestId)
      .eq("compartment_id", compartment.id)
      .order("year", { ascending: true });

    // Fetch plan metadata for period parameters
    const { data: meta } = await supabase
      .from("plan_metadata")
      .select("period_start, period_end")
      .eq("forest_id", forestId)
      .limit(1)
      .single();

    const startYear = meta?.period_start ?? new Date().getFullYear();
    const endYear = meta?.period_end ?? startYear + 19;
    const periodYears = endYear - startYear + 1;

    // Enrich compartment to StandData
    const initialStand = enrichCompartment(
      compartment,
      (speciesRows ?? []) as Parameters<typeof enrichCompartment>[1],
      undefined,
      1.0,
    );

    // Run single-stand simulation
    const dbOps: DBOperation[] = (operations ?? []).map((op) => ({
      type: op.type,
      year: op.year,
      removal_pct: op.removal_pct,
    }));

    const snapshots = simulateStand(initialStand, dbOps, startYear, periodYears);

    return NextResponse.json({ snapshots });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Simulation failed" },
      { status: 500 },
    );
  }
}
