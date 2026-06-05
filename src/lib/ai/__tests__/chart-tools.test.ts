// src/lib/ai/__tests__/chart-tools.test.ts
// Phase 4.15 — Integration tests for create_chart, select_stand, clear_charts tools
// Phase 4b T8 — Added query_config mode tests (auto-updating chart creation)

import { describe, it, expect, vi } from "vitest";
import { executeTool, type ToolContext } from "@/lib/chat/tool-executor";

function makeCtx(overrides: Partial<Pick<ToolContext, "sendSse" | "supabase">> = {}): ToolContext {
  return {
    forestId: "test-forest-id",
    userId: "test-user-id",
    supabase: overrides.supabase ?? makeBasicSupabaseMock(),
    sendSse: overrides.sendSse ?? (vi.fn() as unknown as (event: string, data: unknown) => void),
  };
}

/** Basic supabase mock for legacy (data-mode) chart tools — supports upsert, delete, select. */
function makeBasicSupabaseMock() {
  function chain(data: Record<string, unknown>[] = []) {
    const node: Record<string, unknown> = {};
    node.then = (resolve: (v: unknown) => void) => resolve({ data, error: null });
    return node;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: vi.fn().mockReturnValue({
    upsert: vi.fn().mockResolvedValue({ error: null }),
    delete: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    }),
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockImplementation((_field: string, ids: string[]) => chain(ids.map(id => ({ stand_id: id })))),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    }),
  }) } as any;
}

/** Create a mock supabase that supports query_config chart creation.
 *  Returns mock data rows from the given table that the chart engine can aggregate. */
function makeQueryConfigSupabaseMock(
  tableData: Record<string, Record<string, unknown>[]>
): ToolContext["supabase"] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function chain(targetData: Record<string, unknown>[]): Record<string, unknown> {
    const node: Record<string, unknown> = {};
    node.then = (resolve: (v: unknown) => void) =>
      resolve({ data: targetData, error: null });
    for (const m of ["select", "eq", "limit", "in", "filter", "order", "not", "gt", "gte", "lt", "lte", "neq"]) {
      node[m] = () => chain(targetData);
    }
    return node;
  }

  const from = (table: string) => {
    const data = tableData[table] ?? [];
    // Wrap in an object that has both chain methods AND upsert/delete
    const ch = chain(data);
    // The tool executor also calls `.upsert()` and `.delete()` on the result
    // of `.from()`, so we need those on the same object.
    ch.upsert = vi.fn().mockResolvedValue({ error: null });
    ch.delete = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });
    return ch;
  };

  return { from } as any;
}

const VALID_BAR_CHART = {
  chart_id: "chart-1",
  title: "Yearly Income",
  type: "bar",
  data: [
    { year: 2026, income: 100000 },
    { year: 2027, income: 120000 },
  ],
  x_key: "year",
  y_key: "income",
};

const VALID_PIE_CHART = {
  chart_id: "chart-2",
  title: "Species Distribution",
  type: "pie",
  data: [
    { species: "Pine", count: 45 },
    { species: "Spruce", count: 30 },
  ],
  y_key: "count",
  name_key: "species",
};

describe("create_chart tool", () => {
  it("validates chart config and emits SSE event", async () => {
    const sendSse = vi.fn();
    const ctx = makeCtx({ sendSse });

    const result = await executeTool("create_chart", VALID_BAR_CHART, ctx);

    expect(result.success).toBe(true);
    expect(result.result).toContain("Yearly Income");
    expect(result.result).toContain("bar");
    expect(sendSse).toHaveBeenCalledWith("create_chart", expect.objectContaining({
      id: "chart-1",
      title: "Yearly Income",
      type: "bar",
    }));
  });

  it("rejects invalid chart type", async () => {
    const ctx = makeCtx();
    const result = await executeTool("create_chart", {
      ...VALID_BAR_CHART,
      type: "invalid_type",
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid chart type");
  });

  it("rejects empty data array", async () => {
    const ctx = makeCtx();
    const result = await executeTool("create_chart", {
      ...VALID_BAR_CHART,
      data: [],
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain("non-empty array");
  });

  it("rejects missing chart_id", async () => {
    const ctx = makeCtx();
    const result = await executeTool("create_chart", {
      ...VALID_BAR_CHART,
      chart_id: undefined,
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain("chart_id");
  });

  it("accepts minimal config (required fields only)", async () => {
    const sendSse = vi.fn();
    const ctx = makeCtx({ sendSse });

    const result = await executeTool("create_chart", {
      chart_id: "minimal",
      title: "Minimal",
      type: "line",
      data: [{ x: 1, y: 2 }],
      y_key: "y",
    }, ctx);

    expect(result.success).toBe(true);
    expect(sendSse).toHaveBeenCalled();
  });

  it("handles pie chart with name_key", async () => {
    const sendSse = vi.fn();
    const ctx = makeCtx({ sendSse });

    const result = await executeTool("create_chart", VALID_PIE_CHART, ctx);

    expect(result.success).toBe(true);
    expect(sendSse).toHaveBeenCalledWith("create_chart", expect.objectContaining({
      name_key: "species",
      type: "pie",
    }));
  });
});

// ─── Phase 4b T8: Query Config mode ──────────────────────────────────

describe("create_chart tool — query_config mode (Phase 4b)", () => {
  it("creates chart from query_config by computing data via chart engine", async () => {
    const sendSse = vi.fn();
    const supabase = makeQueryConfigSupabaseMock({
      operations: [
        { year: 2026, income_eur: 50000 },
        { year: 2026, income_eur: 30000 },
        { year: 2027, income_eur: 60000 },
      ],
    });
    const ctx = makeCtx({ sendSse, supabase });

    const result = await executeTool("create_chart", {
      chart_id: "chart-qc-yearly-income",
      title: "Yearly Income (QC)",
      type: "bar",
      x_key: "year",
      y_key: "income",
      query_config: {
        source: "operations",
        aggregate: [{ group_by: "year" }],
        values: [{ field: "income_eur", as: "income", fn: "sum" }],
      },
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.result).toContain("Auto-updates");

    // Verify SSE was emitted with computed data
    expect(sendSse).toHaveBeenCalledWith("create_chart", expect.objectContaining({
      id: "chart-qc-yearly-income",
      title: "Yearly Income (QC)",
      type: "bar",
      data: expect.arrayContaining([
        expect.objectContaining({ year: 2026, income: 80000 }),
        expect.objectContaining({ year: 2027, income: 60000 }),
      ]),
    }));

    // Verify the SSE payload includes query_config and computed_at
    const call = sendSse.mock.calls.find((c: unknown[]) => c[0] === "create_chart")!;
    expect(call[1]).toHaveProperty("query_config");
    expect(call[1]).toHaveProperty("computed_at");
  });

  it("auto-resolves y_key to the 'as' name from query_config values", async () => {
    const sendSse = vi.fn();
    const supabase = makeQueryConfigSupabaseMock({
      operations: [
        { year: 2026, cost_eur: 5000 },
        { year: 2026, cost_eur: 3000 },
      ],
    });
    const ctx = makeCtx({ sendSse, supabase });

    // Model passes raw field name "cost_eur" but query_config uses "as: cost"
    const result = await executeTool("create_chart", {
      chart_id: "chart-cost",
      title: "Costs",
      type: "bar",
      x_key: "year",
      y_key: "cost_eur",  // raw field name
      query_config: {
        source: "operations",
        aggregate: [{ group_by: "year" }],
        values: [{ field: "cost_eur", as: "cost", fn: "sum" }],
      },
    }, ctx);

    expect(result.success).toBe(true);
    const call = sendSse.mock.calls.find((c: unknown[]) => c[0] === "create_chart")!;
    // yKey should be resolved to "cost" (the 'as' name), not "cost_eur"
    expect(call[1].y_key).toBe("cost");
    expect(call[1].data[0].cost).toBe(8000);
  });

  it("auto-detects x_key and name_key from aggregate.group_by when not provided", async () => {
    const sendSse = vi.fn();
    const supabase = makeQueryConfigSupabaseMock({
      compartment_species: [
        { species: "pine", area_ha: 10 },
        { species: "spruce", area_ha: 15 },
      ],
    });
    const ctx = makeCtx({ sendSse, supabase });

    // No x_key or name_key provided — should auto-detect from aggregate
    const result = await executeTool("create_chart", {
      chart_id: "chart-donut-species",
      title: "Species",
      type: "donut",
      y_key: "total_ha",
      query_config: {
        source: "compartment_species",
        aggregate: [{ group_by: "species" }],
        values: [{ field: "area_ha", as: "total_ha", fn: "sum" }],
      },
    }, ctx);

    expect(result.success).toBe(true);
    const call = sendSse.mock.calls.find((c: unknown[]) => c[0] === "create_chart")!;
    expect(call[1].name_key).toBe("species");  // auto-detected from aggregate[0].group_by
  });

  it("rejects query_config string that cannot be parsed", async () => {
    const ctx = makeCtx();

    const result = await executeTool("create_chart", {
      chart_id: "chart-bad",
      title: "Bad",
      type: "bar",
      x_key: "year",
      y_key: "income",
      query_config: "not valid json or python dict at all {{{",
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain("query_config");
  });

  it("handles Python-style dict string as query_config", async () => {
    const sendSse = vi.fn();
    const supabase = makeQueryConfigSupabaseMock({
      operations: [
        { year: 2026, income_eur: 10000 },
      ],
    });
    const ctx = makeCtx({ sendSse, supabase });

    // Some models (Nemotron) send Python dict strings
    const result = await executeTool("create_chart", {
      chart_id: "chart-py",
      title: "Py Config",
      type: "bar",
      x_key: "year",
      y_key: "income",
      query_config: "{'source': 'operations', 'aggregate': [{'group_by': 'year'}], 'values': [{'field': 'income_eur', 'as': 'income', 'fn': 'sum'}]}",
    }, ctx);

    expect(result.success).toBe(true);
    expect(sendSse).toHaveBeenCalled();
    expect(result.result).toContain("Auto-updates");
  });
});

describe("select_stand tool", () => {
  it("emits select_stand SSE event", async () => {
    const sendSse = vi.fn();
    const ctx = makeCtx({ sendSse });

    const result = await executeTool("select_stand", { stand_ids: ["42"] }, ctx);

    expect(result.success).toBe(true);
    expect(result.result).toContain("Stand 42");
    expect(sendSse).toHaveBeenCalledWith("select_stand", { stand_ids: ["42"] });
  });

  it("handles missing stand_ids gracefully", async () => {
    const ctx = makeCtx();
    const result = await executeTool("select_stand", {}, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain("stand_ids");
  });

  it("normalizes single string to array (backward compat)", async () => {
    const sendSse = vi.fn();
    const ctx = makeCtx({ sendSse });
    const result = await executeTool("select_stand", { stand_ids: "42" }, ctx);

    expect(result.success).toBe(true);
    expect(result.result).toContain("Stand 42");
    expect(sendSse).toHaveBeenCalledWith("select_stand", { stand_ids: ["42"] });
  });
});

describe("clear_charts tool", () => {
  it("deletes all charts and emits SSE event", async () => {
    const sendSse = vi.fn();
    const ctx = makeCtx({ sendSse });

    const result = await executeTool("clear_charts", {}, ctx);

    expect(result.success).toBe(true);
    expect(result.result).toContain("cleared");
    expect(sendSse).toHaveBeenCalledWith("clear_charts", {});
  });
});

describe("remove_chart tool", () => {
  it("emits remove_chart SSE event", async () => {
    const sendSse = vi.fn();
    const ctx = makeCtx({ sendSse });

    const result = await executeTool("remove_chart", { chart_id: "chart-99" }, ctx);

    expect(result.success).toBe(true);
    expect(sendSse).toHaveBeenCalledWith("remove_chart", { chart_id: "chart-99" });
  });

  it("rejects missing chart_id", async () => {
    const ctx = makeCtx();
    const result = await executeTool("remove_chart", {}, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain("chart_id");
  });
});

describe("list_charts tool", () => {
  it("returns no charts when DB is empty", async () => {
    const ctx = makeCtx();
    const result = await executeTool("list_charts", {}, ctx);
    expect(result.success).toBe(true);
    expect(result.result).toContain("No charts");
  });
});

describe("update_chart tool", () => {
  it("rejects missing chart_id", async () => {
    const ctx = makeCtx();
    const result = await executeTool("update_chart", {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("chart_id");
  });
});

describe("recreate_chart tool", () => {
  it("rejects missing chart_id", async () => {
    const ctx = makeCtx();
    const result = await executeTool("recreate_chart", {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("chart_id");
  });

  it("rejects missing query_config", async () => {
    const ctx = makeCtx();
    const result = await executeTool("recreate_chart", { chart_id: "chart-1" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("query_config");
  });
});
