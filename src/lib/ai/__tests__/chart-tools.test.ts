// src/lib/ai/__tests__/chart-tools.test.ts
// Phase 4.15 — Integration tests for create_chart, select_stand, clear_charts tools

import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeTool } from "@/lib/chat/tool-executor";

function mockSupabase() {
  const from = vi.fn().mockReturnValue({
    upsert: vi.fn().mockResolvedValue({ error: null }),
    delete: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    }),
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    }),
  });
  return { from } as unknown as ReturnType<typeof vi.fn>;
}

function makeCtx(overrides: Partial<{ sendSse: typeof vi.fn }> = {}) {
  return {
    forestId: "test-forest-id",
    userId: "test-user-id",
    supabase: mockSupabase(),
    sendSse: overrides.sendSse ?? vi.fn(),
  };
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
      nameKey: "species",
      type: "pie",
    }));
  });
});

describe("select_stand tool", () => {
  it("emits select_stand SSE event", async () => {
    const sendSse = vi.fn();
    const ctx = makeCtx({ sendSse });

    const result = await executeTool("select_stand", { stand_id: "42" }, ctx);

    expect(result.success).toBe(true);
    expect(result.result).toContain("Stand 42");
    expect(sendSse).toHaveBeenCalledWith("select_stand", { stand_id: "42" });
  });

  it("handles missing stand_id gracefully", async () => {
    const ctx = makeCtx();
    const result = await executeTool("select_stand", {}, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain("stand_id");
  });

  it("handles non-string stand_id", async () => {
    const ctx = makeCtx();
    const result = await executeTool("select_stand", { stand_id: 123 }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain("stand_id");
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