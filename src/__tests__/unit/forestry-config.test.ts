import { describe, it, expect } from "vitest";
import {
  PRICES,
  getPrices,
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
  it("has correct timber prices for uudistushakkuu pine", () => {
    expect(PRICES.uudistushakkuu.pine.tukki).toBeCloseTo(78.99, 1);
    expect(PRICES.uudistushakkuu.pine.kuitu).toBeCloseTo(25.28, 1);
  });

  it("has correct timber prices for uudistushakkuu spruce", () => {
    expect(PRICES.uudistushakkuu.spruce.tukki).toBeCloseTo(82.52, 1);
    expect(PRICES.uudistushakkuu.spruce.kuitu).toBeCloseTo(26.36, 1);
  });

  it("getPrices falls back to pine for unknown species", () => {
    const prices = getPrices("uudistushakkuu", "Unknown");
    expect(prices.tukki).toBeCloseTo(78.99, 1);
  });

  it("getPrices maps birch to silver_birch", () => {
    const prices = getPrices("uudistushakkuu", "birch");
    expect(prices.tukki).toBeCloseTo(61.76, 1);
  });

  it("OPTIMAL_AGES has valid ranges for all species", () => {
    expect(OPTIMAL_AGES.pine.lehtomainen[0]).toBeLessThanOrEqual(OPTIMAL_AGES.pine.lehtomainen[1]);
    expect(OPTIMAL_AGES.spruce.tuore[0]).toBeLessThanOrEqual(OPTIMAL_AGES.spruce.tuore[1]);
    expect(OPTIMAL_AGES.silver_birch.lehtomainen[1]).toBeLessThanOrEqual(70);
  });

  it("getOptimalAge returns default for unknown species", () => {
    const [min, max] = getOptimalAge("Unknown", "tuore");
    expect(min).toBe(65);
    expect(max).toBe(90);
  });

  it("getOptimalAge scales by growthMultiplier (Lappi = longer rotations)", () => {
    const [min1, max1] = getOptimalAge("pine", "kuivahko", 1.0);
    const [minLappi, maxLappi] = getOptimalAge("pine", "kuivahko", 0.55);
    expect(minLappi).toBeGreaterThan(min1); // Lappi needs longer rotation
    expect(minLappi).toBeCloseTo(Math.round(75 / 0.55));
    expect(maxLappi).toBeCloseTo(Math.round(100 / 0.55));
  });

  it("getOptimalAge scales by growthMultiplier (Etelä-Suomi = shorter rotations)", () => {
    const [min1] = getOptimalAge("spruce", "tuore", 1.0);
    const [minSouth] = getOptimalAge("spruce", "tuore", 1.10);
    expect(minSouth).toBeLessThan(min1);
  });

  it("THINNING_BA has correct first thinning thresholds", () => {
    expect(THINNING_BA.ensiharvennus.pine).toBe(16);
    expect(THINNING_BA.ensiharvennus.spruce).toBe(24);
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
    expect(GROWTH_MINERAL.lehtomainen).toBe(7.0);
    expect(GROWTH_MINERAL.tuore).toBe(5.5);
    expect(GROWTH_MINERAL.kuivahko).toBe(3.25);
    expect(GROWTH_MINERAL.kuiva).toBe(1.3);
  });

  it("GROWTH_PEATLAND has correct rates", () => {
    expect(GROWTH_PEATLAND.lehtomainen).toBe(6.25);
    expect(GROWTH_PEATLAND.tuore).toBe(5.5);
  });

  it("GROWTH_REGION_MULTIPLIERS has all 9 regions", () => {
    expect(Object.keys(GROWTH_REGION_MULTIPLIERS)).toHaveLength(9);
    expect(GROWTH_REGION_MULTIPLIERS["3"]).toBe(1.0); // baseline
    expect(GROWTH_REGION_MULTIPLIERS["8"]).toBeLessThan(0.6); // Lappi
  });

  it("PRICE_REGION_MULTIPLIERS has all 9 regions", () => {
    expect(Object.keys(PRICE_REGION_MULTIPLIERS)).toHaveLength(9);
    expect(PRICE_REGION_MULTIPLIERS["1"]).toBeGreaterThan(1.0); // Etelä-Suomi premium
    expect(PRICE_REGION_MULTIPLIERS["8"]).toBeLessThan(1.0); // Lappi discount
  });
});

describe("classifySite", () => {
  it('classifies "Lehtomainen" correctly', () => {
    expect(classifySite("Lehtomainen")).toBe("lehtomainen");
    expect(classifySite("Lehto")).toBe("lehtomainen");
    expect(classifySite("Ruoho")).toBe("lehtomainen");
  });

  it('classifies "Tuore" correctly', () => {
    expect(classifySite("Tuore")).toBe("tuore");
    expect(classifySite("Mustikkatyyppi")).toBe("tuore");
  });

  it('classifies "Kuivahko" correctly', () => {
    expect(classifySite("Kuivahko")).toBe("kuivahko");
    expect(classifySite("Puolukkatyyppi")).toBe("kuivahko");
  });

  it('classifies "Kuiva" correctly', () => {
    expect(classifySite("Kuiva")).toBe("kuiva");
    expect(classifySite("Varpu")).toBe("kuiva");
    expect(classifySite("Karu")).toBe("kuiva");
  });

  it("falls back to kuivahko for unknown", () => {
    expect(classifySite("Unknown")).toBe("kuivahko");
  });
});

describe("detectPeatland", () => {
  it("detects drained peatland from maalaji", () => {
    expect(detectPeatland("turve", "tuore", "", "ojitettu")).toBe(true);
  });

  it("detects drained peatland from kasvupaikka", () => {
    expect(detectPeatland("mineral soil", "turve", "", "ojitettu")).toBe(true);
  });

  it("returns false for mineral soil", () => {
    expect(detectPeatland("mineral soil", "tuore", "", "ei ojia")).toBe(false);
  });

  it("returns false for undrained peatland", () => {
    expect(detectPeatland("turve", "suo", "", "ei ojia")).toBe(false);
  });
});
