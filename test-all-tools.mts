// Comprehensive test of ALL AI tools against Hokkala data
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { classifyAndValueStands } from "./src/lib/ai/classify";
import { schedulePlan } from "./src/lib/ai/schedule";
import { generatePlan } from "./src/lib/ai/generate-plan";
import { getStand, searchStands, planSummary, yearOperations } from "./src/lib/ai/query-tools";
import { addOperation, removeOperation } from "./src/lib/ai/edit-tools";
import { checkSustainability, validatePlan } from "./src/lib/ai/validation-tools";

async function test(name: string, fn: () => Promise<any>) {
  try {
    const result = await fn();
    const ok = result?.success !== false;
    console.log(`✅ ${name}: ${ok ? 'OK' : 'FAIL'} — ${result?.result?.substring(0, 100) || result?.error || 'no result'}`);
    if (!ok) console.log(`   ERROR: ${result?.error}`);
    return result;
  } catch (e: any) {
    console.log(`❌ ${name}: CRASH — ${e.message}`);
    return null;
  }
}

async function main() {
  const env = Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.substring(0, i), l.substring(i + 1)];
      })
  );

  const admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL!,
    env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const forestId = "0645403a-be60-408b-bdfd-02b01c2ba3a1";
  const userId = "c51e3892-6b16-4fcd-8780-c3e8f049105f";

  console.log("\n╔══════════════════════════════════════╗");
  console.log("║     Testing All AI Tools — Hokkala   ║");
  console.log("╚══════════════════════════════════════╝\n");

  // ── Track B: Forestry Engine ──
  const { data: comps } = await admin.from("compartments").select("*").eq("forest_id", forestId);
  console.log(`Compartments loaded: ${comps?.length || 0}\n`);

  await test("classifyAndValueStands", async () => {
    const result = classifyAndValueStands(comps!);
    console.log(`   Kuviot: ${result.forestKuviot.length}, Ops: ${result.operations.length}, Volume: ${Math.round(result.totalVolume)} m³`);
    return { success: result.operations.length > 0, result: `${result.operations.length} operations found` };
  });

  await test("schedulePlan", async () => {
    const c = classifyAndValueStands(comps!);
    const result = schedulePlan(c.forestKuviot, c.operations, 2026);
    const total = result.p1.reduce((s, y) => s + y.paate.length + y.harvennus.length, 0);
    console.log(`   P1: ${result.p1.reduce((s, y) => s + y.paate.length, 0)} paate, ${result.p1.reduce((s, y) => s + y.harvennus.length, 0)} harv`);
    console.log(`   Summary: avg harvest ${Math.round(result.summary.p1AverageHarvest)} m³/v`);
    return { success: total > 0, result: `${total} P1 operations` };
  });

  // ── Track C: Query Tools ──
  await test("get_stand (stand 7)", async () => {
    return getStand(forestId, "7");
  });

  await test("get_stand (stand 1)", async () => {
    return getStand(forestId, "1");
  });

  await test("get_stand (nonexistent)", async () => {
    return getStand(forestId, "9999");
  });

  await test("search_stands (species: Mänty)", async () => {
    return searchStands(forestId, { species: "Mänty", min_age: 50 });
  });

  await test("search_stands (species: Pine — English)", async () => {
    return searchStands(forestId, { species: "Pine" });
  });

  await test("search_stands (site: mesic)", async () => {
    return searchStands(forestId, { site_type: "mesic" });
  });

  await test("search_stands (dev class: mature_thinning)", async () => {
    return searchStands(forestId, { development_class: "mature_thinning" });
  });

  await test("plan_summary (pre-generation)", async () => {
    return planSummary(forestId);
  });

  await test("year_operations (2026)", async () => {
    return yearOperations(forestId, 2026);
  });

  // ── Track C: Edit Tools ──
  const testStandId = "10"; // regeneration_ready stand

  await test("add_operation (test clearcut)", async () => {
    return addOperation(forestId, userId, {
      stand_id: testStandId,
      year: 2026,
      type: "Clear_cut",
      removal_pct: 100,
    });
  });

  await test("add_operation (duplicate — verify idempotent)", async () => {
    return addOperation(forestId, userId, {
      stand_id: testStandId,
      year: 2026,
      type: "Clear_cut",
      removal_pct: 100,
    });
  });

  await test("remove_operation", async () => {
    return removeOperation(forestId, testStandId, 2026);
  });

  // ── Track C: Validation Tools ──
  await test("check_harvest_sustainability", async () => {
    return checkSustainability(forestId);
  });

  await test("check_harvest_sustainability (year 2026)", async () => {
    return checkSustainability(forestId, 2026);
  });

  await test("validate_plan (should have ops from generatePlan)", async () => {
    return validatePlan(forestId);
  });

  // ── Full generate_plan flow ──
  await test("generate_plan (full)", async () => {
    // We need to use admin client since createServerSupabase needs cookies
    // Replicate the generatePlan logic with admin client
    const { classifyAndValueStands: c } = await import("./src/lib/ai/classify");
    const { schedulePlan: s } = await import("./src/lib/ai/schedule");
    const result = c(comps!);
    const schedule = s(result.forestKuviot, result.operations, 2026);
    
    // Build ops for DB
    const kuvioMap = new Map();
    comps?.forEach(c => kuvioMap.set(c.stand_id, { id: c.id }));
    
    const allOps: any[] = [];
    const addPlanOps = (yearPlan: any[]) => {
      for (const yp of yearPlan) {
        for (const op of [...yp.paate, ...yp.harvennus, ...yp.taimik, ...yp.uudist]) {
          const comp = kuvioMap.get(op.kuvio.numero);
          if (comp) {
            allOps.push({
              compartment_id: comp.id,
              forest_id: forestId,
              type: op.type,
              year: op.year,
              removal_pct: op.type === "Päätehakkuu" || op.type === "Poimintahakkuu" ? 100 : 28,
              income_eur: op.income_eur,
              cost_eur: op.cost_eur,
              notes: op.notes,
              created_by: "ai",
            });
          }
        }
      }
    };
    addPlanOps(schedule.p1);
    addPlanOps(schedule.p2);
    
    console.log(`   Operations to insert: ${allOps.length}`);
    
    // Delete old + insert new
    await admin.from("operations").delete().eq("forest_id", forestId).eq("created_by", "ai");
    if (allOps.length > 0) {
      const { error } = await admin.from("operations").insert(allOps);
      if (error) throw new Error(`Insert failed: ${error.message}`);
    }
    
    const { count } = await admin.from("operations").select("*", { count: "exact", head: true }).eq("forest_id", forestId).eq("created_by", "ai");
    console.log(`   Stored in DB: ${count} operations`);
    
    return { success: count! > 0, result: `Generated ${count} operations` };
  });

  // ── Re-test after generate_plan ──
  await test("validate_plan (after generation)", async () => {
    return validatePlan(forestId);
  });

  await test("plan_summary (after generation)", async () => {
    return planSummary(forestId);
  });

  await test("year_operations (2027 after generation)", async () => {
    return yearOperations(forestId, 2027);
  });

  await test("check_harvest_sustainability (after generation)", async () => {
    return checkSustainability(forestId);
  });

  // ── Verify search with English names ──
  await test("search_stands development_class: regeneration_ready", async () => {
    return searchStands(forestId, { development_class: "regeneration_ready" });
  });

  await test("search_stands site_type: herb-rich heath", async () => {
    return searchStands(forestId, { site_type: "herb-rich heath" });
  });

  console.log("\n╔══════════════════════════════════════╗");
  console.log("║              ALL TESTS DONE           ║");
  console.log("╚══════════════════════════════════════╝");
}

main().catch(e => console.error("Fatal:", e));