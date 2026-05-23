// src/lib/ai/query-tools.ts — T8.1 Query Tools
//
// Read-only tools: get_stand, search_stands, plan_summary, year_operations
// All tools return { success, result, error? } for the tool executor.
// All accept an authenticated supabase client to avoid creating their own.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Compartment, Operation } from "@/types/database";

const SITE_MAP: Record<string, string> = {
  tuore: "tuore", mesic: "tuore",
  lehtomainen: "lehtomainen", "herb-rich": "lehtomainen", "herb-rich heath": "lehtomainen",
  kuivahko: "kuivahko", "sub-xeric": "kuivahko",
  kuiva: "kuiva", xeric: "kuiva",
};

// ── get_stand ──

export async function getStand(
  supabase: SupabaseClient,
  forestId: string,
  standId: string
): Promise<{ success: boolean; result: string; error?: string }> {
  const { data, error } = await supabase
    .from("compartments")
    .select("*")
    .eq("forest_id", forestId)
    .eq("stand_id", standId)
    .single();

  if (error || !data) {
    return { success: false, result: "", error: `Stand ${standId} not found` };
  }

  const c = data as Compartment;
  const lines = [
    `📋 Stand ${c.stand_id}`,
    `  Area: ${c.area_ha?.toFixed(1)} ha`,
    `  Development class: ${c.development_class ?? "N/A"}`,
    `  Main species: ${c.main_species ?? "N/A"}`,
    `  Site type: ${c.site_type ?? "N/A"}`,
    `  Age: ${c.age_years ?? "N/A"} years`,
    `  Volume: ${c.volume_m3?.toFixed(0)} m³`,
    `  Basal area: ${c.basal_area?.toFixed(1)} m²/ha`,
    `  Avg height: ${c.avg_height?.toFixed(1)} m`,
    `  Avg diameter: ${c.avg_diameter?.toFixed(1)} cm`,
    `  Growth: ${c.growth_m3_per_ha?.toFixed(1)} m³/ha/y`,
  ];

  return { success: true, result: lines.join("\n") };
}

// ── search_stands ──

export async function searchStands(
  supabase: SupabaseClient,
  forestId: string,
  filters: Record<string, unknown>
): Promise<{ success: boolean; result: string; error?: string }> {
  let query = supabase.from("compartments").select("*").eq("forest_id", forestId);

  if (filters.species) {
    const input = String(filters.species).toLowerCase();
    const speciesMap: Record<string, string> = {
      mänty: "Mänty", pine: "Mänty",
      kuusi: "Kuusi", spruce: "Kuusi",
      rauduskoivu: "Rauduskoivu", birch: "Rauduskoivu", koivu: "Rauduskoivu",
      hieskoivu: "Hieskoivu",
      lehtikuusi: "Lehtikuusi", larch: "Lehtikuusi",
      harmaaleppä: "Harmaaleppä", alder: "Harmaaleppä",
    };
    const finnish = speciesMap[input];
    if (finnish) query = query.eq("main_species", finnish);
  }

  if (filters.site_type) {
    const mapped = SITE_MAP[String(filters.site_type).toLowerCase()];
    if (mapped) query = query.eq("site_type", mapped);
  }

  if (filters.development_class) {
    query = query.ilike("development_class", `%${filters.development_class}%`);
  }
  if (filters.min_age) query = query.gte("age_years", Number(filters.min_age));
  if (filters.max_age) query = query.lte("age_years", Number(filters.max_age));
  if (filters.min_area) query = query.gte("area_ha", Number(filters.min_area));

  const { data, error } = await query.order("stand_id").limit(50);
  if (error) return { success: false, result: "", error: error.message };

  const stands = (data as Compartment[]) ?? [];
  if (stands.length === 0) {
    return { success: true, result: "No matching stands found." };
  }

  const lines = stands.map((s) =>
    `  Stand ${s.stand_id}: ${s.main_species ?? "?"}, ${s.development_class ?? "?"}, ${s.area_ha?.toFixed(1)} ha, ${s.age_years ?? "?"} y, ${s.volume_m3?.toFixed(0)} m³`
  );
  return { success: true, result: `Found ${stands.length} stand(s):\n${lines.join("\n")}` };
}

// ── plan_summary ──

export async function planSummary(
  supabase: SupabaseClient,
  forestId: string
): Promise<{ success: boolean; result: string; error?: string }> {
  try {
    const { data: opsData } = await supabase
      .from("operations")
      .select("*")
      .eq("forest_id", forestId);
    const operations = (opsData as Operation[]) ?? [];

    const { data: compData } = await supabase
      .from("compartments")
      .select("area_ha, volume_m3, growth_m3_per_ha")
      .eq("forest_id", forestId);
    const compartments = (compData as Array<{ area_ha: number | null; volume_m3: number | null; growth_m3_per_ha: number | null }>) ?? [];

    const totalArea = compartments.reduce((s, c) => s + (c.area_ha ?? 0), 0);
    const totalVolume = compartments.reduce((s, c) => s + (c.volume_m3 ?? 0), 0);
    const annualGrowth = compartments.reduce((s, c) => s + ((c.growth_m3_per_ha ?? 0) * (c.area_ha ?? 0)), 0);

    const p1Ops = operations.filter((o) => o.year >= 2026 && o.year <= 2035);
    const p2Ops = operations.filter((o) => o.year >= 2036 && o.year <= 2045);
    const p1Income = p1Ops.reduce((s, o) => s + (o.income_eur ?? 0), 0);
    const p1Cost = p1Ops.reduce((s, o) => s + (o.cost_eur ?? 0), 0);
    const p2Income = p2Ops.reduce((s, o) => s + (o.income_eur ?? 0), 0);
    const p2Cost = p2Ops.reduce((s, o) => s + (o.cost_eur ?? 0), 0);

    const lines = [
      `📊 Plan Summary for ${totalArea.toFixed(1)} ha forest`,
      ``,
      `🌲 Total volume: ${Math.round(totalVolume).toLocaleString()} m³`,
      `📈 Annual growth: ${Math.round(annualGrowth).toLocaleString()} m³/v`,
      ``,
      `Period 1 (2026-2035):`,
      `  Clearcuts: ${p1Ops.filter((o) => o.type === "Päätehakkuu").length}`,
      `  Thinnings: ${p1Ops.filter((o) => o.type === "Harvennus" || o.type === "Ensiharvennus").length}`,
      `  Regeneration: ${p1Ops.filter((o) => o.type === "Laikkumätästys" || o.type === "Istutus").length}`,
      `  Income: ${Math.round(p1Income).toLocaleString()} €`,
      `  Costs: ${Math.round(p1Cost).toLocaleString()} €`,
      `  Net: ${Math.round(p1Income - p1Cost).toLocaleString()} €`,
      ``,
      `Period 2 (2036-2045):`,
      `  Clearcuts: ${p2Ops.filter((o) => o.type === "Päätehakkuu").length}`,
      `  Thinnings: ${p2Ops.filter((o) => o.type === "Harvennus" || o.type === "Ensiharvennus").length}`,
      `  Income: ${Math.round(p2Income).toLocaleString()} €`,
      `  Costs: ${Math.round(p2Cost).toLocaleString()} €`,
      `  Net: ${Math.round(p2Income - p2Cost).toLocaleString()} €`,
      ``,
      `Total operations: ${operations.length}`,
    ];

    return { success: true, result: lines.join("\n") };
  } catch (err) {
    return {
      success: false,
      result: "",
      error: err instanceof Error ? err.message : "Failed to get plan summary",
    };
  }
}

// ── year_operations ──

export async function yearOperations(
  supabase: SupabaseClient,
  forestId: string,
  year: number
): Promise<{ success: boolean; result: string; error?: string }> {
  try {
    const { data: opsData } = await supabase
      .from("operations")
      .select("*")
      .eq("forest_id", forestId)
      .eq("year", year);
    const ops = (opsData as Operation[]) ?? [];

    if (ops.length === 0) {
      return { success: true, result: `No operations planned for ${year}.` };
    }

    const clearcuts = ops.filter((o) => o.type === "Päätehakkuu");
    const thinnings = ops.filter((o) => o.type === "Harvennus" || o.type === "Ensiharvennus");
    const regeneration = ops.filter((o) =>
      ["Laikkumätästys", "Ojitusmätästys", "Laikutus", "Istutus", "Kuusen istutus", "Männyn istutus"].includes(o.type)
    );
    const tending = ops.filter((o) =>
      ["Taimikonhoito", "Taimikon varhaishoito", "Ennakkoraivaus"].includes(o.type)
    );

    const lines = [`📅 Operations for ${year}:`];

    if (clearcuts.length > 0) {
      lines.push(`\n🪓 Clearcuts (${clearcuts.length}):`);
      for (const o of clearcuts) lines.push(`  Stand — removal ${o.removal_pct}%, income ${o.income_eur ?? 0}€`);
    }
    if (thinnings.length > 0) {
      lines.push(`\n🌲 Thinnings (${thinnings.length}):`);
      for (const o of thinnings) lines.push(`  Stand — removal ${o.removal_pct}%, income ${o.income_eur ?? 0}€`);
    }
    if (regeneration.length > 0) {
      lines.push(`\n🌱 Regeneration (${regeneration.length}):`);
      for (const o of regeneration) lines.push(`  ${o.type} — cost ${o.cost_eur ?? 0}€`);
    }
    if (tending.length > 0) {
      lines.push(`\n🌿 Tending (${tending.length}):`);
      for (const o of tending) lines.push(`  ${o.type} — cost ${o.cost_eur ?? 0}€`);
    }

    const totalIncome = ops.reduce((s, o) => s + (o.income_eur ?? 0), 0);
    const totalCost = ops.reduce((s, o) => s + (o.cost_eur ?? 0), 0);
    lines.push(`\n💰 Total income: ${Math.round(totalIncome).toLocaleString()} €`);
    lines.push(`💰 Total costs: ${Math.round(totalCost).toLocaleString()} €`);
    lines.push(`💰 Net: ${Math.round(totalIncome - totalCost).toLocaleString()} €`);

    return { success: true, result: lines.join("\n") };
  } catch (err) {
    return {
      success: false,
      result: "",
      error: err instanceof Error ? err.message : "Failed to fetch year operations",
    };
  }
}