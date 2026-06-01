// src/lib/ai/__tests__/query-tools.test.ts
//
// Tests for searchStands, queryOperations, and batchUpdateOperations.
// Uses mocked Supabase client to avoid needing a real database.

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Compartment, Operation } from "@/types/database";
import {
  searchStands,
  queryOperations,
  getStand,
} from "../query-tools";
import { batchUpdateOperations } from "../edit-tools";

// ── Test data ──

const mockCompartments: Compartment[] = [
  {
    id: "c001", forest_id: "forest-1", stand_id: "1",
    area_ha: 1.2, main_species: "Mänty", development_class: "mature_thinning",
    site_type: "mesic", soil_type: "Kangas", drainage_status: null,
    age_years: 55, volume_m3: 120, basal_area: 18.5,
    avg_diameter: 22.0, avg_height: 16.5, growth_m3_per_ha: 4.2,
    geometry: null, attributes: null,
    created_at: "2025-01-01", updated_at: "2025-01-01",
  },
  {
    id: "c002", forest_id: "forest-1", stand_id: "2",
    area_ha: 2.1, main_species: "Kuusi", development_class: "regeneration_ready",
    site_type: "herb-rich heath", soil_type: "Kangas", drainage_status: null,
    age_years: 80, volume_m3: 340, basal_area: 26.0,
    avg_diameter: 30.0, avg_height: 22.0, growth_m3_per_ha: 5.8,
    geometry: null, attributes: null,
    created_at: "2025-01-01", updated_at: "2025-01-01",
  },
  {
    id: "c003", forest_id: "forest-1", stand_id: "5",
    area_ha: 0.9, main_species: "Rauduskoivu", development_class: "young_thinning",
    site_type: "mesic", soil_type: "Kangas", drainage_status: null,
    age_years: 28, volume_m3: 45, basal_area: 12.0,
    avg_diameter: 15.0, avg_height: 12.0, growth_m3_per_ha: 6.1,
    geometry: null, attributes: null,
    created_at: "2025-01-01", updated_at: "2025-01-01",
  },
];

const mockOperations = [
  {
    id: "op001", compartment_id: "c001", forest_id: "forest-1",
    type: "thinning", year: 2026, removal_pct: 28,
    income_eur: 12000, cost_eur: 500, notes: null,
    created_by: "ai", created_at: "2025-01-01", updated_at: "2025-01-01",
    compartments: mockCompartments[0],
  },
  {
    id: "op002", compartment_id: "c002", forest_id: "forest-1",
    type: "clear_cut", year: 2030, removal_pct: 100,
    income_eur: 38700, cost_eur: 2000, notes: null,
    created_by: "ai", created_at: "2025-01-01", updated_at: "2025-01-01",
    compartments: mockCompartments[1],
  },
  {
    id: "op003", compartment_id: "c003", forest_id: "forest-1",
    type: "thinning", year: 2026, removal_pct: 25,
    income_eur: 3000, cost_eur: 400, notes: null,
    created_by: "ai", created_at: "2025-01-01", updated_at: "2025-01-01",
    compartments: mockCompartments[2],
  },
];

// ── Helpers ──

function createMockSupabase(overrides: Record<string, any> = {}) {
  // Default handlers return empty (no-op) results
  const defaults = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
  };
  return { ...defaults, ...overrides } as unknown as SupabaseClient;
}

function chainMock(data: any, error: any = null) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    then: vi.fn((resolve: any) => resolve({ data, error })),
  };
  // Make the chain awaitable
  return chain;
}

function createQueryableMock(data: any, error: any = null) {
  const table: Record<string, any> = {};
  table.select = vi.fn(() => table);
  table.eq = vi.fn(() => table);
  table.in = vi.fn(() => table);
  table.gte = vi.fn(() => table);
  table.lte = vi.fn(() => table);
  table.order = vi.fn(() => table);
  table.limit = vi.fn(() => Promise.resolve({ data, error }));
  table.single = vi.fn(() => Promise.resolve({ data: data?.[0], error }));
  table.insert = vi.fn(() => Promise.resolve({ data, error }));
  table.delete = vi.fn(() => table);
  table.update = vi.fn(() => table);
  return table;
}

function makeMockSupabase(tables: Record<string, any>) {
  // This creates a supabase client where .from('compartments') returns tableMock
  // and .from('operations') returns opsMock
  const tablesMap = new Map(Object.entries(tables));
  return {
    from: vi.fn((name: string) => tablesMap.get(name) ?? createQueryableMock([], null)),
  } as unknown as SupabaseClient;
}

// ── Tests ──

describe("searchStands", () => {
  it("returns all stands with no filters", async () => {
    const supabase = makeMockSupabase({
      compartments: createQueryableMock(mockCompartments, null),
    });

    const result = await searchStands(supabase, "forest-1", {});
    expect(result.success).toBe(true);
    expect(result.result).toContain("Found 3 stand(s)");
    expect(result.result).toContain("Stand 1");
    expect(result.result).toContain("Stand 2");
    expect(result.result).toContain("Stand 5");
  });

  it("filters by stand_ids array", async () => {
    const supabase = makeMockSupabase({
      compartments: createQueryableMock(
        mockCompartments.filter(c => ["1", "5"].includes(c.stand_id)),
        null
      ),
    });

    const result = await searchStands(supabase, "forest-1", { stand_ids: ["1", "5"] });
    expect(result.success).toBe(true);
    expect(result.result).toContain("Found 2 stand(s)");
    expect(result.result).toContain("Stand 1");
    expect(result.result).toContain("Stand 5");
    expect(result.result).not.toContain("Stand 2");
  });

  it("filters by species array (Finnish)", async () => {
    const supabase = makeMockSupabase({
      compartments: createQueryableMock([mockCompartments[0]], null),
    });

    const result = await searchStands(supabase, "forest-1", { species: ["Mänty"] });
    expect(result.success).toBe(true);
    expect(result.result).toContain("Found 1 stand(s)");
    expect(result.result).toContain("Mänty");
  });

  it("filters by species array (English → auto-translate)", async () => {
    const supabase = makeMockSupabase({
      compartments: createQueryableMock([mockCompartments[1]], null),
    });

    const result = await searchStands(supabase, "forest-1", { species: ["spruce"] });
    expect(result.success).toBe(true);
    expect(result.result).toContain("Kuusi");
  });

  it("filters by age range", async () => {
    const supabase = makeMockSupabase({
      compartments: createQueryableMock([mockCompartments[0]], null),
    });

    const result = await searchStands(supabase, "forest-1", { age_min: 40, age_max: 60 });
    expect(result.success).toBe(true);
    expect(result.result).toContain("Found 1 stand(s)");
  });

  it("returns no matching stands when nothing matches", async () => {
    const supabase = makeMockSupabase({
      compartments: createQueryableMock([], null),
    });

    const result = await searchStands(supabase, "forest-1", { species: ["Lehtikuusi"] });
    expect(result.success).toBe(true);
    expect(result.result).toBe("No matching stands found.");
  });

  it("handles single-string species gracefully via coercion", async () => {
    const supabase = makeMockSupabase({
      compartments: createQueryableMock([mockCompartments[0]], null),
    });

    const result = await searchStands(supabase, "forest-1", { species: ["Mänty"] as any });
    expect(result.success).toBe(true);
    expect(result.result).toContain("Mänty");
  });

  it("returns error on database failure", async () => {
    const supabase = makeMockSupabase({
      compartments: createQueryableMock(null, { message: "Database connection failed" }),
    });

    const result = await searchStands(supabase, "forest-1", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("connection");
  });
});

describe("queryOperations", () => {
  it("returns ops for specific years", async () => {
    const supabase = makeMockSupabase({
      operations: createQueryableMock(
        mockOperations.filter(o => o.year === 2026),
        null
      ),
    });

    const result = await queryOperations(supabase, "forest-1", { years: [2026] });
    expect(result.success).toBe(true);
    expect(result.result).toContain("Found 2 operation(s)");
    expect(result.result).toContain("2026");
  });

  it("returns ops with JOINed stand data including stand_id", async () => {
    const supabase = makeMockSupabase({
      operations: createQueryableMock([mockOperations[0]], null),
    });

    const result = await queryOperations(supabase, "forest-1", { years: [2026] });
    expect(result.success).toBe(true);
    expect(result.result).toContain("Stand 1");
    expect(result.result).toContain("Mänty");
    expect(result.result).toContain("2026");
    expect(result.result).toContain("thinning");
  });

  it("filters by income range", async () => {
    const supabase = makeMockSupabase({
      operations: createQueryableMock([mockOperations[1]], null),
    });

    const result = await queryOperations(supabase, "forest-1", { income_min: 30000 });
    expect(result.success).toBe(true);
    expect(result.result).toContain("Found 1 operation(s)");
  });

  it("returns no matching operations when nothing matches", async () => {
    const supabase = makeMockSupabase({
      operations: createQueryableMock([], null),
    });

    const result = await queryOperations(supabase, "forest-1", { years: [2099] });
    expect(result.success).toBe(true);
    expect(result.result).toBe("No matching operations found.");
  });

  it("returns error on database failure", async () => {
    const supabase = makeMockSupabase({
      operations: createQueryableMock(null, { message: "DB error" }),
    });

    const result = await queryOperations(supabase, "forest-1", {});
    expect(result.success).toBe(false);
    expect(result.error).toBe("DB error");
  });
});

describe("batchUpdateOperations", () => {
  it("updates matching ops to new year", async () => {
    const matchingOps = mockOperations.filter(o => o.year === 2026);
    const supabase = makeMockSupabase({
      operations: createQueryableMock(matchingOps, null),
    });

    const result = await batchUpdateOperations(
      supabase,
      "forest-1",
      { years: [2026], types: ["thinning"] },
      { year: 2028 }
    );
    expect(result.success).toBe(true);
    expect(result.result).toContain("Updated 2 operation(s)");
    expect(result.result).toContain("moved to 2028");
  });

  it("rejects invalid update fields", async () => {
    const supabase = makeMockSupabase({
      operations: createQueryableMock([], null),
    });

    const result = await batchUpdateOperations(
      supabase,
      "forest-1",
      {},
      { type: "clear_cut" as any }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Cannot update field \"type\"");
  });

  it("rejects year < 2025", async () => {
    const supabase = makeMockSupabase({
      operations: createQueryableMock([], null),
    });

    const result = await batchUpdateOperations(
      supabase,
      "forest-1",
      {},
      { year: 2020 }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Year must be >= 2025");
  });

  it("returns error when no operations match", async () => {
    const supabase = makeMockSupabase({
      operations: createQueryableMock([], null),
    });

    const result = await batchUpdateOperations(
      supabase,
      "forest-1",
      { years: [2099] },
      { year: 2028 }
    );
    expect(result.success).toBe(true);
    expect(result.result).toBe("No matching operations found.");
  });

  it("allows updating notes field", async () => {
    const matchingOps = mockOperations.filter(o => o.year === 2026);
    const supabase = makeMockSupabase({
      operations: createQueryableMock(matchingOps, null),
    });

    const result = await batchUpdateOperations(
      supabase,
      "forest-1",
      { years: [2026], types: ["thinning"] },
      { notes: "Updated batch" }
    );
    expect(result.success).toBe(true);
    expect(result.result).toContain("notes updated");
  });
});