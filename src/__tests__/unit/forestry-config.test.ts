import { describe, it, expect } from "vitest";
import {
  getPrices,
  PRICES,
  OPTIMAL_AGES,
  getOptimalAge,
  THINNING_BA,
  MIN_AGE_FIRST_THINNING,
  MIN_AGE_THINNING,
  COSTS,
  GROWTH_MINERAL,
  GROWTH_PEATLAND,
  GROWTH_REGION_MULTIPLIERS,
  PRICE_REGION_MULTIPLIERS,
  classifySite,
  detectPeatland,
} from "@/lib/ai/config";

describe("Forestry Config", () => {
  it("has correct timber prices for clear_cut pine", () => {
    expect(PRICES.clear_cut.pine.tukki).toBeCloseTo(78.99, 1);
    expect(PRICES.clear_cut.pine.kuitu).toBeCloseTo(25.28, 1);
  });

  it("has correct timber prices for clear_cut spruce", () => {
    expect(PRICES.clear_cut.spruce.tukki).toBeCloseTo(82.52, 1);
    expect(PRICES.clear_cut.spruce.kuitu).toBeCloseTo(26.36, 1);
  });

  it("getPrices falls back to pine for unknown species", () => {
    const prices = getPrices("clear_cut", "Unknown");
    expect(prices.tukki).toBeCloseTo(78.99, 1);
  });

  it("getPrices maps birch to silver_birch", () => {
    const prices = getPrices("clear_cut", "birch");
    expect(prices.tukki).toBeCloseTo(61.76, 1);
  });

  it("OPTIMAL_AGES has valid ranges for all species", () => {
    expect(OPTIMAL_AGES.pine["herb-rich heath"][0]).toBeLessThanOrEqual(OPTIMAL_AGES.pine["herb-rich heath"][1]);
    expect(OPTIMAL_AGES.spruce.mesic[0]).toBeLessThanOrEqual(OPTIMAL_AGES.spruce.mesic[1]);
    expect(OPTIMAL_AGES.silver_birch["herb-rich heath"][1]).toBeLessThanOrEqual(70);
  });

  it("getOptimalAge returns default for unknown species", () => {
    const [min, max] = getOptimalAge("Unknown", "mesic");
    expect(min).toBe(65);
    expect(max).toBe(90);
  });

  it("getOptimalAge scales by growthMultiplier (Lappi = longer rotations)", () => {
    const [min1, max1] = getOptimalAge("pine", "sub-xeric", 1.0);
    const [minLappi, maxLappi] = getOptimalAge("pine", "sub-xeric", 0.55);
    expect(minLappi).toBeGreaterThan(min1);
    expect(minLappi).toBeCloseTo(Math.round(75 / 0.55));
    expect(maxLappi).toBeCloseTo(Math.round(100 / 0.55));
  });

  it("getOptimalAge scales by growthMultiplier (Etelä-Suomi = shorter rotations)", () => {
    const [min1] = getOptimalAge("spruce", "mesic", 1.0);
    const [minSouth] = getOptimalAge("spruce", "mesic", 1.10);
    expect(minSouth).toBeLessThan(min1);
  });

  it("THINNING_BA has correct first thinning thresholds", () => {
    expect(THINNING_BA.first_thinning.pine).toBe(16);
    expect(THINNING_BA.first_thinning.spruce).toBe(24);
  });

  it("MIN_AGE_FIRST_THINNING has correct values", () => {
    expect(MIN_AGE_FIRST_THINNING.pine).toBe(30);
    expect(MIN_AGE_FIRST_THINNING.spruce).toBe(25);
    expect(MIN_AGE_FIRST_THINNING.downy_birch).toBe(20);
  });

  it("MIN_AGE_THINNING has correct values", () => {
    expect(MIN_AGE_THINNING.pine).toBe(45);
    expect(MIN_AGE_THINNING.spruce).toBe(40);
  });

  it("COSTS has all silvicultural operations (Phase 7b updated rates)", () => {
    expect(COSTS.site_prep).toBe(540);
    expect(COSTS.spruce_planting).toBe(1080);
    expect(COSTS.tending).toBe(900);
    expect(COSTS.early_tending).toBe(630);
    expect(COSTS.scalping).toBe(450);
    expect(COSTS.ditch_mounding).toBe(720);
  });

  it("GROWTH_MINERAL has correct rates", () => {
    expect(GROWTH_MINERAL["herb-rich heath"]).toBe(7.0);
    expect(GROWTH_MINERAL.mesic).toBe(5.5);
    expect(GROWTH_MINERAL["sub-xeric"]).toBe(3.25);
    expect(GROWTH_MINERAL.xeric).toBe(1.3);
  });

  it("GROWTH_PEATLAND has correct rates", () => {
    expect(GROWTH_PEATLAND["herb-rich heath"]).toBe(6.25);
    expect(GROWTH_PEATLAND.mesic).toBe(5.5);
  });

  it("GROWTH_REGION_MULTIPLIERS has all 9 regions", () => {
    expect(Object.keys(GROWTH_REGION_MULTIPLIERS)).toHaveLength(9);
    expect(GROWTH_REGION_MULTIPLIERS["3"]).toBe(1.0);
    expect(GROWTH_REGION_MULTIPLIERS["8"]).toBeLessThan(0.6);
  });

  it("PRICE_REGION_MULTIPLIERS has all 9 regions", () => {
    expect(Object.keys(PRICE_REGION_MULTIPLIERS)).toHaveLength(9);
    expect(PRICE_REGION_MULTIPLIERS["1"]).toBeGreaterThan(1.0);
    expect(PRICE_REGION_MULTIPLIERS["8"]).toBeLessThan(1.0);
  });
});

describe("classifySite", () => {
  it('classifies Finnish "Lehtomainen" to English', () => {
    expect(classifySite("Lehtomainen")).toBe("herb-rich heath");
    expect(classifySite("Lehto")).toBe("herb-rich heath");
    expect(classifySite("Ruoho")).toBe("herb-rich heath");
  });

  it('classifies Finnish "Tuore" to English', () => {
    expect(classifySite("Tuore")).toBe("mesic");
    expect(classifySite("Mustikkatyyppi")).toBe("mesic");
  });

  it('classifies Finnish "Kuivahko" to English', () => {
    expect(classifySite("Kuivahko")).toBe("sub-xeric");
    expect(classifySite("Puolukkatyyppi")).toBe("sub-xeric");
  });

  it('classifies Finnish "Kuiva" to English', () => {
    expect(classifySite("Kuiva")).toBe("xeric");
    expect(classifySite("Varpu")).toBe("xeric");
    expect(classifySite("Karu")).toBe("xeric");
  });

  it("falls back to sub-xeric for unknown", () => {
    expect(classifySite("Unknown")).toBe("sub-xeric");
  });

  it("passes English values through unchanged", () => {
    expect(classifySite("mesic")).toBe("mesic");
    expect(classifySite("sub-xeric")).toBe("sub-xeric");
    expect(classifySite("xeric")).toBe("xeric");
    expect(classifySite("herb-rich heath")).toBe("herb-rich heath");
  });
});

describe("detectPeatland", () => {
  it("detects drained peatland from maalaji", () => {
    expect(detectPeatland("turve", "mesic", "", "ojitettu")).toBe(true);
  });

  it("detects drained peatland from kasvupaikka", () => {
    expect(detectPeatland("mineral soil", "turve", "", "ojitettu")).toBe(true);
  });

  it("returns false for mineral soil", () => {
    expect(detectPeatland("mineral soil", "mesic", "", "ei ojia")).toBe(false);
  });

  it("returns false for undrained peatland", () => {
    expect(detectPeatland("turve", "suo", "", "ei ojia")).toBe(false);
  });
});
