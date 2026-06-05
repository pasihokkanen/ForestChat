// src/lib/ai/__tests__/chart-engine.test.ts
// Phase 4c.3 — Cross-source chart engine tests
//
// Tests cross-source queries, broadcast semantics, cumulative post-merge,
// join-prefixed filter resolution, and growth_m3_total computed field.

import { describe, it, expect, vi } from "vitest";
import { recomputeChartData } from "../chart-engine";
import type { ChartQueryConfig, CrossQueryConfig } from "../chart-engine";

// ─── Mock Supabase ───────────────────────────────────────────────────

/** Create a mock Supabase client where `.from(table).select().eq().limit().order()`
 *  resolves to the given data. Supports chaining `.in()`, `.filter()`, and
 *  additional `.eq()` calls. */
function makeMockSupabase(dataByTable: Record<string, Record<string, unknown>[]>) {
  /** Build a lazy chain — every method returns a new chain with the same data.
   *  Uses plain objects (not vi.fn) to avoid thenable interference. */
  function chain(targetData: Record<string, unknown>[]): Record<string, unknown> {
    const node: Record<string, unknown> = {};
    // Make it thenable so `await chain` resolves to { data, error }
    node.then = (resolve: (v: unknown) => void) =>
      resolve({ data: targetData, error: null });
    // All chain methods return a new chain node with the same data
    for (const m of ["select", "eq", "limit", "in", "filter", "order", "not", "gt", "gte", "lt", "lte", "neq"]) {
      node[m] = () => chain(targetData);
    }
    return node;
  }

  const from = (table: string) => {
    const data = dataByTable[table] ?? [];
    return chain(data);
  };

  return { from } as any;
}

// ─── growth_m3_total computed field ──────────────────────────────────

describe("single-source pipeline with mock", () => {
  it("aggregates rows correctly", async () => {
    const supabase = makeMockSupabase({
      operations: [
        { year: 2026, removal_m3: 500 },
        { year: 2027, removal_m3: 300 },
      ],
    });

    const config: ChartQueryConfig = {
      source: "operations",
      aggregate: [{ group_by: "year" }],
      values: [{ field: "removal_m3", as: "removal", fn: "sum" }],
    };

    const result = await recomputeChartData(supabase, "forest-1", config);
    expect(result.data).toEqual([
      { year: 2026, removal: 500, _stand_ids: [] },
      { year: 2027, removal: 300, _stand_ids: [] },
    ]);
  });
});

describe("growth_m3_total computed field", () => {
  it("computes growth_m3_total = growth_m3_per_ha × area_ha", async () => {
    const supabase = makeMockSupabase({
      compartments: [
        { growth_m3_per_ha: 5.5, area_ha: 2.0 },
        { growth_m3_per_ha: 3.0, area_ha: 1.5 },
      ],
    });

    const config: ChartQueryConfig = {
      source: "compartments",
      aggregate: [],
      values: [{ field: "growth_m3_total", as: "growth", fn: "sum" }],
    };

    const result = await recomputeChartData(supabase, "forest-1", config);

    // 5.5 × 2.0 = 11.0 + 3.0 × 1.5 = 4.5 → total 15.5
    expect(result.data).toHaveLength(1);
    expect(result.data[0].growth).toBeCloseTo(15.5);
  });
});

describe("removal_m3 computed field (Phase 4b)", () => {
  it("computes removal_m3 = volume_m3 × removal_pct / 100 per row, then aggregates", async () => {
    const supabase = makeMockSupabase({
      operations: [
        { year: 2026, volume_m3: 200, removal_pct: 50 },  // → 100 m³
        { year: 2027, volume_m3: 150, removal_pct: 100 }, // → 150 m³
        { year: 2027, volume_m3: 200, removal_pct: 25 },  // → 50 m³
      ],
    });

    const config: ChartQueryConfig = {
      source: "operations",
      aggregate: [{ group_by: "year" }],
      values: [{ field: "removal_m3", as: "volume", fn: "sum" }],
    };

    const result = await recomputeChartData(supabase, "forest-1", config);

    // 2026: 100 m³, 2027: 150 + 50 = 200 m³
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({ year: 2026, volume: 100 });
    expect(result.data[1]).toMatchObject({ year: 2027, volume: 200 });
  });

  it("handles null values in source columns gracefully", async () => {
    const supabase = makeMockSupabase({
      operations: [
        { volume_m3: null, removal_pct: 50 },
        { volume_m3: 200, removal_pct: null },
        { volume_m3: 200, removal_pct: 50 },
      ],
    });

    const config: ChartQueryConfig = {
      source: "operations",
      aggregate: [],
      values: [{ field: "removal_m3", as: "volume", fn: "sum" }],
    };

    const result = await recomputeChartData(supabase, "forest-1", config);

    // null × 50 → 0, 200 × null → 0, 200 × 50 → 100
    expect(result.data).toHaveLength(1);
    expect(result.data[0].volume).toBeCloseTo(100);
  });
});

// ─── Cross-source merge ──────────────────────────────────────────────

describe("cross-source merge", () => {
  it("merges two sub-queries on year key (outer)", async () => {
    const supabase = makeMockSupabase({
      operations: [
        { year: 2026, removal_m3: 500 },
        { year: 2027, removal_m3: 300 },
      ],
      compartments: [
        { growth_m3_per_ha: 4.0, area_ha: 2.5 },
      ],
    });

    const config: CrossQueryConfig = {
      source: "cross",
      merge_on: "year",
      merge_strategy: "outer",
      queries: [
        {
          source: "operations",
          aggregate: [{ group_by: "year" }],
          values: [{ field: "removal_m3", as: "removal", fn: "sum" }],
        },
        {
          source: "compartments",
          aggregate: [],
          values: [{ field: "growth_m3_total", as: "growth", fn: "sum" }],
          broadcast: true,
        },
      ],
      sort: { by: "year" },
    };

    const result = await recomputeChartData(supabase, "forest-1", config);

    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({ year: 2026, removal: 500, growth: 10 });
    expect(result.data[1]).toMatchObject({ year: 2027, removal: 300, growth: 10 });
  });

  it("broadcast fans out a single-row result to all merge keys", async () => {
    const supabase = makeMockSupabase({
      operations: [
        { year: 2026, removal_m3: 100 },
        { year: 2028, removal_m3: 200 },
      ],
      compartments: [
        { growth_m3_per_ha: 2.0, area_ha: 3.0 },
      ],
    });

    const config: CrossQueryConfig = {
      source: "cross",
      merge_on: "year",
      queries: [
        {
          source: "operations",
          aggregate: [{ group_by: "year" }],
          values: [{ field: "removal_m3", as: "removal", fn: "sum" }],
        },
        {
          source: "compartments",
          aggregate: [],
          values: [{ field: "growth_m3_total", as: "growth", fn: "sum" }],
          broadcast: true,
        },
      ],
    };

    const result = await recomputeChartData(supabase, "forest-1", config);

    // Growth (6.0) should appear in ALL years (2026, 2027, 2028 — gap year filled).
    expect(result.data).toHaveLength(3);
    expect(result.data[0].growth).toBe(6);
    expect(result.data[1].growth).toBe(6);
    expect(result.data[2].growth).toBe(6);
    expect(result.data[0].removal).toBe(100);
    expect(result.data[1].removal).toBe(0);  // gap year
    expect(result.data[2].removal).toBe(200);
  });

  it("inner merge excludes keys not present in all sub-queries", async () => {
    const supabase = makeMockSupabase({
      operations: [
        { year: 2026, removal_m3: 100 },
      ],
      compartments: [],  // no data → no merge keys from this side
    });

    const config: CrossQueryConfig = {
      source: "cross",
      merge_on: "year",
      merge_strategy: "inner",
      queries: [
        {
          source: "operations",
          aggregate: [{ group_by: "year" }],
          values: [{ field: "removal_m3", as: "removal", fn: "sum" }],
        },
        {
          source: "compartments",
          aggregate: [],
          values: [{ field: "growth_m3_total", as: "growth", fn: "sum" }],
        },
      ],
    };

    const result = await recomputeChartData(supabase, "forest-1", config);

    // Inner merge: only years present in ALL queries → none (compartments has no rows)
    expect(result.data).toHaveLength(0);
  });
});

// ─── Cumulative post-merge ───────────────────────────────────────────

describe("cumulative post-merge", () => {
  it("applies cumulative AFTER merge, not within sub-queries", async () => {
    const supabase = makeMockSupabase({
      operations: [
        { year: 2026, removal_m3: 500 },
        { year: 2027, removal_m3: 300 },
        { year: 2028, removal_m3: 400 },
      ],
      compartments: [
        { growth_m3_per_ha: 3.0, area_ha: 2.0 },
      ],
    });

    const config: CrossQueryConfig = {
      source: "cross",
      merge_on: "year",
      queries: [
        {
          source: "operations",
          aggregate: [{ group_by: "year" }],
          values: [{ field: "removal_m3", as: "removal", fn: "sum", cumulative: true }],
        },
        {
          source: "compartments",
          aggregate: [],
          values: [{ field: "growth_m3_total", as: "growth", fn: "sum", cumulative: true }],
          broadcast: true,
        },
      ],
    };

    const result = await recomputeChartData(supabase, "forest-1", config);

    expect(result.data).toHaveLength(3);

    // Year 1: removal=500, growth=6
    expect(result.data[0].removal).toBe(500);
    expect(result.data[0].growth).toBe(6);

    // Year 2: removal=500+300=800, growth=6+6=12
    expect(result.data[1].removal).toBe(800);
    expect(result.data[1].growth).toBe(12);

    // Year 3: removal=800+400=1200, growth=12+6=18
    expect(result.data[2].removal).toBe(1200);
    expect(result.data[2].growth).toBe(18);
  });
});

// ─── fillMergeGaps (year gap filling) ────────────────────────────────

describe("fillMergeGaps in cross queries", () => {
  it("fills integer year gaps between min and max", async () => {
    const supabase = makeMockSupabase({
      operations: [
        { year: 2026, removal_m3: 100 },
        { year: 2030, removal_m3: 400 },
      ],
      compartments: [
        { growth_m3_per_ha: 1.0, area_ha: 5.0 },
      ],
    });

    const config: CrossQueryConfig = {
      source: "cross",
      merge_on: "year",
      queries: [
        {
          source: "operations",
          aggregate: [{ group_by: "year" }],
          values: [{ field: "removal_m3", as: "removal", fn: "sum" }],
        },
        {
          source: "compartments",
          aggregate: [],
          values: [{ field: "growth_m3_total", as: "growth", fn: "sum" }],
          broadcast: true,
        },
      ],
      sort: { by: "year" },
    };

    const result = await recomputeChartData(supabase, "forest-1", config);

    // Should have 5 rows: 2026, 2027, 2028, 2029, 2030
    expect(result.data).toHaveLength(5);

    expect(result.data[0]).toMatchObject({ year: 2026, removal: 100, growth: 5 });
    expect(result.data[1]).toMatchObject({ year: 2027, removal: 0, growth: 5 });
    expect(result.data[2]).toMatchObject({ year: 2028, removal: 0, growth: 5 });
    expect(result.data[3]).toMatchObject({ year: 2029, removal: 0, growth: 5 });
    expect(result.data[4]).toMatchObject({ year: 2030, removal: 400, growth: 5 });
  });
});

// ─── Error handling ──────────────────────────────────────────────────

describe("error handling", () => {
  it("fails entire cross query if any sub-query fails", async () => {
    // Mock where operations returns an error
    function errorChain(): Record<string, unknown> {
      const node: Record<string, unknown> = {};
      node.then = (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: "Database connection error" } });
      for (const m of ["select", "eq", "limit", "in", "filter", "order", "not", "gt", "gte", "lt", "lte", "neq"]) {
        node[m] = () => errorChain();
      }
      return node;
    }

    function successChain(data: Record<string, unknown>[]): Record<string, unknown> {
      const node: Record<string, unknown> = {};
      node.then = (resolve: (v: unknown) => void) => resolve({ data, error: null });
      for (const m of ["select", "eq", "limit", "in", "filter", "order", "not", "gt", "gte", "lt", "lte", "neq"]) {
        node[m] = () => successChain(data);
      }
      return node;
    }

    const from = (table: string) => {
      if (table === "operations") return errorChain();
      return successChain([{ growth_m3_per_ha: 1.0, area_ha: 1.0 }]);
    };

    const supabase = { from } as any;

    const config: CrossQueryConfig = {
      source: "cross",
      merge_on: "year",
      queries: [
        {
          source: "operations",
          aggregate: [{ group_by: "year" }],
          values: [{ field: "removal_m3", as: "removal", fn: "sum" }],
        },
        {
          source: "compartments",
          aggregate: [],
          values: [{ field: "growth_m3_total", as: "growth", fn: "sum" }],
          broadcast: true,
        },
      ],
    };

    await expect(
      recomputeChartData(supabase, "forest-1", config)
    ).rejects.toThrow("Sub-query (operations) failed");
  });
});

// ─── Comparison operator filter parsing ───────────────────────────────

describe("comparison filter operators", () => {
  it("parses string \">60\" as gt filter", async () => {
    const supabase = makeMockSupabase({
      compartments: [
        { stand_id: "1", age_years: 65, volume_m3: 500 },
        { stand_id: "2", age_years: 45, volume_m3: 300 },
        { stand_id: "3", age_years: 80, volume_m3: 700 },
      ],
    });

    const config: ChartQueryConfig = {
      source: "compartments",
      aggregate: [{ group_by: "stand_id" }],
      values: [{ field: "volume_m3", as: "vol", fn: "sum" }],
      filters: { age_years: ">60" },
    };

    const result = await recomputeChartData(supabase, "forest-1", config);
    // Mock doesn't actually filter data, but the query should build without error
    expect(result.data).toBeDefined();
    expect(result.data.length).toBeGreaterThan(0);
  });

  it("parses string \">=40\" as gte filter", async () => {
    const supabase = makeMockSupabase({
      compartments: [{ stand_id: "1", age_years: 55, volume_m3: 500 }],
    });

    const config: ChartQueryConfig = {
      source: "compartments",
      aggregate: [{ group_by: "stand_id" }],
      values: [{ field: "volume_m3", as: "vol", fn: "sum" }],
      filters: { age_years: ">=40" },
    };

    const result = await recomputeChartData(supabase, "forest-1", config);
    expect(result.data).toBeDefined();
  });

  it("parses string \"<5\" as lt filter", async () => {
    const supabase = makeMockSupabase({
      compartments: [{ stand_id: "1", area_ha: 3.5, volume_m3: 500 }],
    });

    const config: ChartQueryConfig = {
      source: "compartments",
      aggregate: [{ group_by: "stand_id" }],
      values: [{ field: "volume_m3", as: "vol", fn: "sum" }],
      filters: { area_ha: "<5" },
    };

    const result = await recomputeChartData(supabase, "forest-1", config);
    expect(result.data).toBeDefined();
  });

  it("parses string \"<=100\" as lte filter", async () => {
    const supabase = makeMockSupabase({
      compartments: [{ stand_id: "1", volume_m3: 80, area_ha: 2 }],
    });

    const config: ChartQueryConfig = {
      source: "compartments",
      aggregate: [{ group_by: "stand_id" }],
      values: [{ field: "area_ha", as: "area", fn: "sum" }],
      filters: { volume_m3: "<=100" },
    };

    const result = await recomputeChartData(supabase, "forest-1", config);
    expect(result.data).toBeDefined();
  });

  it("parses object form {gt: 60}", async () => {
    const supabase = makeMockSupabase({
      compartments: [{ stand_id: "1", age_years: 75, volume_m3: 500 }],
    });

    const config: ChartQueryConfig = {
      source: "compartments",
      aggregate: [{ group_by: "stand_id" }],
      values: [{ field: "volume_m3", as: "vol", fn: "sum" }],
      filters: { age_years: { gt: 60 } },
    };

    const result = await recomputeChartData(supabase, "forest-1", config);
    expect(result.data).toBeDefined();
  });

  it("plain number still uses eq (backward compatible)", async () => {
    const supabase = makeMockSupabase({
      compartments: [{ stand_id: "1", age_years: 60, volume_m3: 500 }],
    });

    const config: ChartQueryConfig = {
      source: "compartments",
      aggregate: [{ group_by: "stand_id" }],
      values: [{ field: "volume_m3", as: "vol", fn: "sum" }],
      filters: { age_years: 60 },
    };

    const result = await recomputeChartData(supabase, "forest-1", config);
    expect(result.data).toBeDefined();
  });

  it("join-prefixed comparison filter uses filter() with parsed op", async () => {
    const supabase = makeMockSupabase({
      compartment_species: [
        { species: "pine", compartments: { development_class: "mature_thinning", age_years: 70 } },
      ],
    });

    const config: ChartQueryConfig = {
      source: "compartment_species",
      join: { table: "compartments", on: "compartment_id", fields: ["development_class", "age_years"] },
      aggregate: [{ group_by: "species" }],
      values: [{ field: "area_ha", as: "total_ha", fn: "sum" }],
      filters: { "comp.age_years": ">60" },
    };

    const result = await recomputeChartData(supabase, "forest-1", config);
    expect(result.data).toBeDefined();
  });
});
