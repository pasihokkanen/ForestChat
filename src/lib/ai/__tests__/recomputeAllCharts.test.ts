// src/lib/ai/__tests__/recomputeAllCharts.test.ts
// Phase 4b T8 — Tests for recomputeAllCharts (deferred auto-update logic)
//
// Verifies that after data mutations, all query_config-backed charts are
// recomputed with fresh data, with SSE emission, error isolation, and
// legacy chart skipping.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { recomputeAllCharts } from "../chart-engine";

// ─── Mock Supabase Builder ────────────────────────────────────────────

/**
 * Create a mock Supabase client where `.from(table).select(cols).eq()...`
 * resolves to the given data array for that table.
 *
 * The chain supports `.not("query_config", "is", null)` which filters out
 * rows where query_config is null (for chart_tabs). All other chain methods
 * are pass-through.
 */
function makeMockSupabase(
  dataByTable: Record<string, Record<string, unknown>[]>
) {
  const updates: Array<{ chart_id: string; data: Record<string, unknown>[] }> = [];

  function chain(
    targetData: Record<string, unknown>[],
    filters?: Array<(row: Record<string, unknown>) => boolean>,
  ): Record<string, unknown> {
    // Apply accumulated filters
    let filtered = targetData;
    if (filters && filters.length > 0) {
      filtered = targetData.filter(row => filters.every(f => f(row)));
    }

    const node: Record<string, unknown> = {};

    node.then = (resolve: (v: unknown) => void) =>
      resolve({ data: filtered, error: null });

    // Passthrough methods
    for (const m of ["select"]) {
      node[m] = () => chain(targetData, filters);
    }

    // .eq() — pass through (we don't filter by field, just carry data)
    node.eq = () => chain(targetData, filters);

    // .order() — pass through
    node.order = () => chain(targetData, filters);

    // .limit() — pass through
    node.limit = () => chain(targetData, filters);

    // .in() — pass through
    node.in = () => chain(targetData, filters);

    // .gt(), .gte(), .lt(), .lte(), .neq() — pass through
    node.gt = () => chain(targetData, filters);
    node.gte = () => chain(targetData, filters);
    node.lt = () => chain(targetData, filters);
    node.lte = () => chain(targetData, filters);
    node.neq = () => chain(targetData, filters);

    // .filter() — pass through
    node.filter = () => chain(targetData, filters);

    // .not("query_config", "is", null) — filter out rows with null query_config
    node.not = (_field: string, _op: string, _value: unknown) => {
      const newFilters = [...(filters ?? [])];
      if (_field === "query_config" && _value === null) {
        newFilters.push((row) => row.query_config != null);
      }
      return chain(targetData, newFilters);
    };

    // .update(data) — captures the update for assertions
    node.update = (payload: Record<string, unknown>) => {
      // We don't know chart_id yet, so capture the payload
      // The real chain calls .update(data).eq("forest_id",...).eq("chart_id",id)
      // We simulate by pushing a placeholder that we'll patch
      return chain(targetData, filters);
    };

    // .upsert() — pass through
    node.upsert = () => ({
      then: (resolve: (v: unknown) => void) =>
        resolve({ error: null }),
    });

    // .delete() → .eq() → .eq() — pass through
    node.delete = () => ({
      eq: () => ({
        eq: () => ({
          then: (resolve: (v: unknown) => void) =>
            resolve({ error: null }),
        }),
      }),
    });

    return node;
  }

  // Special handling for chart_tabs updates: intercept .update().eq().eq()
  // to capture chart_id + new data
  const from = (table: string) => {
    const rawData = dataByTable[table] ?? [];

    // For chart_tabs, we need update capture
    if (table === "chart_tabs") {
      const baseChain = chain(rawData);
      // Override update to capture
      const origUpdate = baseChain.update;
      baseChain.update = (payload: Record<string, unknown>) => {
        // Return a chain that captures the update on second .eq()
        const updateChain = chain(rawData);
        // Override eq to capture second eq call
        let firstEqField = "";
        updateChain.eq = (field: string, value: string) => {
          if (firstEqField === "" || field === "chart_id") {
            firstEqField = field;
            if (field === "chart_id") {
              updates.push({
                chart_id: value,
                data: payload.data as Record<string, unknown>[],
              });
            }
          }
          return chain(rawData);
        };
        return updateChain;
      };
      return baseChain;
    }

    return chain(rawData);
  };

  return {
    from,
    getUpdates: () => updates,
    resetUpdates: () => { updates.length = 0; },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function simpleQueryConfig(
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    source: "operations",
    aggregate: [{ group_by: "year" }],
    values: [{ field: "income_eur", as: "income", fn: "sum" }],
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("recomputeAllCharts", () => {
  let mockSupabase: ReturnType<typeof makeMockSupabase>;

  beforeEach(() => {
    mockSupabase = makeMockSupabase({});
  });

  it("recomputes all query_config-backed charts and emits charts_refreshed SSE", async () => {
    const sendSse = vi.fn();

    mockSupabase = makeMockSupabase({
      chart_tabs: [
        {
          chart_id: "chart-yearly-income",
          query_config: simpleQueryConfig(),
          title: "Yearly Income",
        },
        {
          chart_id: "chart-legacy",
          query_config: null,
          title: "Legacy Chart",
        },
      ],
      operations: [
        { year: 2026, income_eur: 50000 },
        { year: 2026, income_eur: 30000 },
        { year: 2027, income_eur: 40000 },
      ],
    });

    await recomputeAllCharts(
      { from: mockSupabase.from } as any,
      ["forest-1"],
      sendSse
    );

    // SSE should be called once with the recomputed chart IDs
    expect(sendSse).toHaveBeenCalledTimes(1);
    expect(sendSse).toHaveBeenCalledWith("charts_refreshed", {
      chart_ids: ["chart-yearly-income"],
    });
  });

  it("skips legacy charts that have no query_config", async () => {
    const sendSse = vi.fn();

    mockSupabase = makeMockSupabase({
      chart_tabs: [
        { chart_id: "chart-legacy-a", query_config: null, title_en: "Legacy A", title_fi: null },
        { chart_id: "chart-legacy-b", query_config: null, title_en: "Legacy B", title_fi: null },
      ],
      operations: [
        { year: 2026, income_eur: 10000 },
      ],
    });

    await recomputeAllCharts(
      { from: mockSupabase.from } as any,
      ["forest-1"],
      sendSse
    );

    // No charts with query_config → no SSE emission
    expect(sendSse).not.toHaveBeenCalled();
  });

  it("does not emit SSE when there are no chart tabs", async () => {
    const sendSse = vi.fn();

    mockSupabase = makeMockSupabase({
      chart_tabs: [],
    });

    await recomputeAllCharts(
      { from: mockSupabase.from } as any,
      ["forest-1"],
      sendSse
    );

    expect(sendSse).not.toHaveBeenCalled();
  });

  it("handles chart_tabs fetch error gracefully without throwing", async () => {
    const sendSse = vi.fn();

    const errorSupabase = {
      from: (table: string) => {
        if (table === "chart_tabs") {
          const errorNode: Record<string, unknown> = {};
          errorNode.then = (resolve: (v: unknown) => void) =>
            resolve({ data: null, error: { message: "Connection refused" } });
          for (const m of ["select", "eq", "limit", "in", "filter", "order", "not", "gt", "gte", "lt", "lte", "neq"]) {
            errorNode[m] = () => errorNode;
          }
          return errorNode;
        }
        const dataNode: Record<string, unknown> = {};
        dataNode.then = (resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null });
        return dataNode;
      },
    };

    await expect(
      recomputeAllCharts(errorSupabase as any, ["forest-1"], sendSse)
    ).resolves.toBeUndefined();

    expect(sendSse).not.toHaveBeenCalled();
  });

  it("isolates errors: one broken chart does not block others", async () => {
    const sendSse = vi.fn();

    const mixedSupabase = makeMockSupabase({
      chart_tabs: [
        {
          chart_id: "chart-good",
          query_config: simpleQueryConfig(),
          title: "Good Chart",
        },
        {
          chart_id: "chart-broken",
          query_config: { source: "operations", aggregate: "not-an-array" },
          title: "Broken Chart",
        },
      ],
      operations: [
        { year: 2026, income_eur: 25000 },
      ],
    });

    await recomputeAllCharts(
      { from: mixedSupabase.from } as any,
      ["forest-1"],
      sendSse
    );

    // SSE should still be emitted for the good chart
    expect(sendSse).toHaveBeenCalledWith("charts_refreshed", {
      chart_ids: ["chart-good"],
    });
  });
});
