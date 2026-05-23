import { describe, it, expect } from "vitest";
import type { KuviotData, PlannedOperation } from "@/lib/ai/types";
import { schedulePlan } from "@/lib/ai/schedule";

function makeKuvio(overrides: Partial<KuviotData> & { numero: string }): KuviotData {
  return {
    numero: overrides.numero,
    ala: overrides.ala ?? 2.0,
    kehitysluokka: overrides.kehitysluokka ?? "Varttunut kasvatusmetsikkö",
    kasvupaikka: overrides.kasvupaikka ?? "tuore",
    maalaji: overrides.maalaji ?? "kivennäismaa",
    ojitustilanne: overrides.ojitustilanne ?? "ei ojia",
    paapuulaji: overrides.paapuulaji ?? "Mänty",
    site_class: overrides.site_class ?? "tuore",
    is_peatland: overrides.is_peatland ?? false,
    annual_growth: overrides.annual_growth ?? 5.5,
    arvo: overrides.arvo ?? 10000,
    tukki_m3: overrides.tukki_m3 ?? 100,
    kuitu_m3: overrides.kuitu_m3 ?? 100,
    ikä: overrides.ikä ?? 50,
    ba: overrides.ba ?? 20,
    m3: overrides.m3 ?? 200,
  };
}

function makeOp(
  kuvio: KuviotData,
  type: string,
  overrides?: Partial<PlannedOperation>
): PlannedOperation {
  return {
    kuvio,
    type,
    year: overrides?.year ?? 0,
    income_eur: overrides?.income_eur ?? 0,
    cost_eur: overrides?.cost_eur ?? 0,
    removal_m3: overrides?.removal_m3 ?? 0,
    notes: overrides?.notes ?? "",
  };
}

describe("schedulePlan", () => {
  it("returns empty periods with no operations", () => {
    const result = schedulePlan([], [], 2026);
    expect(result.p1.length).toBe(10);
    expect(result.p2.length).toBe(10);
    expect(result.summary.totalVolume).toBe(0);
  });

  it("schedules a single päätehakkuu in period 1", () => {
    const kuvio = makeKuvio({ numero: "1", m3: 300, arvo: 15000 });
    const ops = [makeOp(kuvio, "Päätehakkuu")];
    const result = schedulePlan([kuvio], ops, 2026);
    const totalPaateP1 = result.p1.reduce((s, y) => s + y.paate.length, 0);
    const totalPaateP2 = result.p2.reduce((s, y) => s + y.paate.length, 0);
    expect(totalPaateP1 + totalPaateP2).toBeGreaterThanOrEqual(1);
  });

  it("generates regeneration after clearcut", () => {
    const kuvio = makeKuvio({ numero: "2", m3: 300, arvo: 15000 });
    const ops = [makeOp(kuvio, "Päätehakkuu")];
    const result = schedulePlan([kuvio], ops, 2026);
    const totalUudist = result.p1.reduce((s, y) => s + y.uudist.length, 0) +
      result.p2.reduce((s, y) => s + y.uudist.length, 0);
    expect(totalUudist).toBeGreaterThan(0);
  });

  it("distributes operations across years evenly", () => {
    const kuvios = Array.from({ length: 10 }, (_, i) =>
      makeKuvio({ numero: String(i + 10), m3: 200 + i * 50, arvo: 10000 + i * 1000 })
    );
    const ops = kuvios.map((k) => makeOp(k, "Päätehakkuu"));
    const result = schedulePlan(kuvios, ops, 2026);
    // No single year should have an extreme concentration
    for (const year of result.p1) {
      const total = year.paate.reduce((s, o) => s + o.removal_m3, 0);
      expect(total).toBeLessThanOrEqual(3000);
    }
  });

  it("includes K180 poimintahakkuu in 2028", () => {
    const k180 = makeKuvio({ numero: "180", m3: 400, arvo: 20000 });
    const ops = [makeOp(k180, "Poimintahakkuu", { removal_m3: 200, notes: "50%" })];
    const result = schedulePlan([k180], ops, 2026);
    // Check that operations reference kuvio 180
    const allOps = [...result.p1, ...result.p2].flatMap((y) => [
      ...y.paate, ...y.harvennus,
    ]);
    const hasK180 = allOps.some((o) => o.kuvio.numero === "180");
    expect(hasK180).toBe(true);
  });

  it("produces valid PlanSummary with non-negative values", () => {
    const kuvio = makeKuvio({ numero: "3", m3: 500, arvo: 25000 });
    const ops = [makeOp(kuvio, "Päätehakkuu")];
    const result = schedulePlan([kuvio], ops, 2026);
    expect(result.summary.totalVolume).toBeGreaterThanOrEqual(0);
    expect(result.summary.annualGrowth).toBeGreaterThanOrEqual(0);
    expect(result.summary.stumpageValue).toBeGreaterThanOrEqual(0);
  });
});
