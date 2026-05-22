/**
 * Unit test: Map styles helper functions (P1.3 — src/lib/map/styles.ts)
 *
 * Tests the DEVELOPMENT_CLASS_COLORS mapping and getStandColor().
 * Pure functions, no React — fastest test category.
 */
import { describe, it, expect } from "vitest";
import {
  DEVELOPMENT_CLASS_COLORS,
  DEV_CLASS_FI_TO_EN,
  DEV_CLASS_LABELS,
  getStandColor,
} from "@/lib/map/styles";

describe("DEVELOPMENT_CLASS_COLORS", () => {
  it("has all expected development class keys", () => {
    const keys = Object.keys(DEVELOPMENT_CLASS_COLORS);
    expect(keys).toContain("seedling");
    expect(keys).toContain("young_thinning");
    expect(keys).toContain("mature_thinning");
    expect(keys).toContain("regeneration_ready");
    expect(keys).toContain("uneven_aged");
    expect(keys).toContain("shelterwood");
    expect(keys).toContain("default");
  });

  it("all color values are valid hex colors", () => {
    const hexRegex = /^#[0-9A-Fa-f]{6}$/;
    Object.entries(DEVELOPMENT_CLASS_COLORS).forEach(([key, color]) => {
      if (key === "default") return; // grey is OK
      expect(color).toMatch(hexRegex);
    });
  });
});

describe("DEV_CLASS_FI_TO_EN", () => {
  it("maps all Finnish names to English keys that exist in color map", () => {
    Object.entries(DEV_CLASS_FI_TO_EN).forEach(([, enKey]) => {
      expect(DEVELOPMENT_CLASS_COLORS).toHaveProperty(enKey);
    });
  });

  it("includes the 6 standard Finnish development classes", () => {
    expect(DEV_CLASS_FI_TO_EN).toHaveProperty("Taimikko");
    expect(DEV_CLASS_FI_TO_EN).toHaveProperty("Nuori kasvatusmetsikkö");
    expect(DEV_CLASS_FI_TO_EN).toHaveProperty("Varttunut kasvatusmetsikkö");
    expect(DEV_CLASS_FI_TO_EN).toHaveProperty("Uudistuskypsä");
    expect(DEV_CLASS_FI_TO_EN).toHaveProperty("Eri-ikäisrakenteinen");
    expect(DEV_CLASS_FI_TO_EN).toHaveProperty("Suojuspuusto");
  });
});

describe("DEV_CLASS_LABELS", () => {
  it("has bilingual labels for all English keys", () => {
    Object.keys(DEVELOPMENT_CLASS_COLORS).forEach((key) => {
      if (key === "default") return;
      expect(DEV_CLASS_LABELS).toHaveProperty(key);
      expect(typeof DEV_CLASS_LABELS[key]).toBe("string");
      expect(DEV_CLASS_LABELS[key].length).toBeGreaterThan(0);
    });
  });
});

describe("getStandColor", () => {
  it("returns correct color for Finnish development class", () => {
    expect(getStandColor("Taimikko")).toBe(DEVELOPMENT_CLASS_COLORS.seedling);
    expect(getStandColor("Uudistuskypsä")).toBe(
      DEVELOPMENT_CLASS_COLORS.regeneration_ready,
    );
    expect(getStandColor("Varttunut kasvatusmetsikkö")).toBe(
      DEVELOPMENT_CLASS_COLORS.mature_thinning,
    );
  });

  it("returns default color for null input", () => {
    expect(getStandColor(null)).toBe(DEVELOPMENT_CLASS_COLORS.default);
  });

  it("returns default color for unknown Finnish name", () => {
    expect(getStandColor("Metsittynyt pelto")).toBe(
      DEVELOPMENT_CLASS_COLORS.default,
    );
  });
});
