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
    for (const m of ["select", "eq", "limit", "in", "filter", "order", "not"]) {
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
      { year: 2026, removal: 500 },
      { year: 2027, removal: 300 },
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
      for (const m of ["select", "eq", "limit", "in", "filter", "order", "not"]) {
        node[m] = () => errorChain();
      }
      return node;
    }

    function successChain(data: Record<string, unknown>[]): Record<string, unknown> {
      const node: Record<string, unknown> = {};
      node.then = (resolve: (v: unknown) => void) => resolve({ data, error: null });
      for (const m of ["select", "eq", "limit", "in", "filter", "order", "not"]) {
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
