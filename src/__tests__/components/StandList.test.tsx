import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import StandList from "@/components/forest/StandList";
import { useForestStore } from "@/lib/store";

function seedStore() {
  useForestStore.getState().setCompartments([
    {
      id: "c1", forest_id: "f1", stand_id: "1", main_species: "pine",
      area_ha: 2.5, volume_m3: 300, age_years: 45,
      development_class: "mature_thinning", site_type: "mesic",
      soil_type: null, drainage_status: null, basal_area: null,
      avg_diameter: null, avg_height: null, growth_m3_per_ha: null,
      geometry: null, attributes: null,
      created_at: "", updated_at: "",
    },
    {
      id: "c2", forest_id: "f1", stand_id: "2", main_species: "spruce",
      area_ha: 4.0, volume_m3: 500, age_years: 60,
      development_class: "regeneration_ready", site_type: "herb-rich heath",
      soil_type: null, drainage_status: null, basal_area: null,
      avg_diameter: null, avg_height: null, growth_m3_per_ha: null,
      geometry: null, attributes: null,
      created_at: "", updated_at: "",
    },
  ]);
  useForestStore.getState().setCompartmentSpecies([
    { id: "s1", forest_id: "f1", compartment_id: "c1", stand_id: "1", species: "pine", volume_m3: 200, log_pct: 60, area_ha: 2.0, created_at: "" },
    { id: "s2", forest_id: "f1", compartment_id: "c1", stand_id: "1", species: "spruce", volume_m3: 100, log_pct: 40, area_ha: 0.5, created_at: "" },
  ]);
  useForestStore.getState().setOperations([
    { id: "op1", compartment_id: "c1", forest_id: "f1", type: "clear_cut", year: 2030, removal_pct: 100, income_eur: 15000, cost_eur: null, notes: null, created_by: "ai", created_at: "", updated_at: "" },
  ]);
}

function cleanStore() {
  useForestStore.getState().setCompartments([]);
  useForestStore.getState().setCompartmentSpecies([]);
  useForestStore.getState().setOperations([]);
  useForestStore.getState().setHighlightedStands([]);
}

describe("StandList", () => {
  beforeEach(() => {
    cleanStore();
    seedStore();
  });

  it("renders without crash when store has compartments", () => {
    render(<StandList map={null} />);
    // Stand IDs should be visible — use getAllByText since stand_id "1" may appear in filter labels too
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
  });

  it("shows empty state when no compartments", () => {
    useForestStore.getState().setCompartments([]);
    render(<StandList map={null} />);
    expect(screen.getByText(/no stands/i)).toBeDefined();
  });

  it("expands on chevron click", () => {
    render(<StandList map={null} />);
    // Click the first ▶ chevron
    const chevrons = screen.getAllByText("▶");
    expect(chevrons.length).toBeGreaterThan(0);
    fireEvent.click(chevrons[0]);
    // After clicking, it should become ▼
    expect(screen.getAllByText("▼").length).toBeGreaterThan(0);
  });

  it("highlights stand row on click", () => {
    render(<StandList map={null} />);
    // Click on the stand_id "1" in the table (use getAllByText since it appears in multiple places)
    const cells = screen.getAllByText("1");
    fireEvent.click(cells[0]);
    expect(useForestStore.getState().highlightedStandIds).toContain("1");
  });

  it("shows footer with stand count", () => {
    render(<StandList map={null} />);
    expect(screen.getByText(/2 stands/)).toBeDefined();
  });
});
