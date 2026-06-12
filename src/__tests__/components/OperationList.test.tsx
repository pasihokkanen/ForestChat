import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import OperationList from "@/components/forest/OperationList";
import { useForestStore } from "@/lib/store";

function seedStore() {
  useForestStore.getState().setCompartments([
    {
      id: "c1", forest_id: "f1", stand_id: "5", main_species: "pine",
      area_ha: 2.5, volume_m3: 300, age_years: 45,
      development_class: "mature_thinning", site_type: "mesic",
      soil_type: null, drainage_status: null, basal_area: null,
      avg_diameter: null, avg_height: null, stem_count_per_ha: null,
      growth_m3_per_ha: null,
      geometry: null, attributes: null,
      created_at: "", updated_at: "",
    },
  ]);
  useForestStore.getState().setOperations([
    {
      id: "op1", compartment_id: "c1", forest_id: "f1",
      type: "clear_cut", year: 2030, removal_pct: 100,
      income_eur: 15000, cost_eur: null,
      notes: null, created_by: "ai", created_at: "", updated_at: "",
    },
  ]);
}

function cleanStore() {
  useForestStore.getState().setCompartments([]);
  useForestStore.getState().setOperations([]);
  useForestStore.getState().setHighlightedStands([]);
  useForestStore.getState().setHighlightedOperations([]);
}

describe("OperationList", () => {
  beforeEach(() => {
    cleanStore();
    seedStore();
  });

  it("renders with operations", () => {
    render(<OperationList map={null} />);
    // Stand ID should be visible
    expect(screen.getByText("5")).toBeDefined();
    // Year should be visible
    expect(screen.getByText("2030")).toBeDefined();
    // Income should be visible (as standalone text node, no "+" prefix check due to formatting)
    expect(screen.getByText("+15,000")).toBeDefined();
  });

  it("shows empty state when no operations", () => {
    useForestStore.getState().setOperations([]);
    render(<OperationList map={null} />);
    expect(screen.getByText(/no operations/i)).toBeDefined();
  });

  it("shows footer with operation count", () => {
    render(<OperationList map={null} />);
    expect(screen.getByText(/1 operations/)).toBeDefined();
  });
});
