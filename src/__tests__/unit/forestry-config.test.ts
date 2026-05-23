import { describe, it, expect } from "vitest";
import {
  PRICES,
  getPrices,
  OPTIMAL_AGES,
  getOptimalAge,
  THINNING_BA,
  MIN_AGE_ENSIHARVENNUS,
  MIN_AGE_HARVENNUS,
  COSTS,
  GROWTH_MINERAL,
  GROWTH_PEATLAND,
  classifySite,
  detectPeatland,
} from "@/lib/ai/config";

describe("Forestry Config", () => {
  it("has correct timber prices for uudistushakkuu Mänty", () => {
    expect(PRICES.uudistushakkuu.Mänty.tukki).toBeCloseTo(78.99, 1);
    expect(PRICES.uudistushakkuu.Mänty.kuitu).toBeCloseTo(25.28, 1);
  });

  it("has correct timber prices for uudistushakkuu Kuusi", () => {
    expect(PRICES.uudistushakkuu.Kuusi.tukki).toBeCloseTo(82.52, 1);
    expect(PRICES.uudistushakkuu.Kuusi.kuitu).toBeCloseTo(26.36, 1);
  });

  it("getPrices falls back to Mänty for unknown species", () => {
    const prices = getPrices("uudistushakkuu", "Unknown");
    expect(prices.tukki).toBeCloseTo(78.99, 1);
  });

  it("getPrices maps Koivu to Rauduskoivu", () => {
    const prices = getPrices("uudistushakkuu", "Koivu");
    expect(prices.tukki).toBeCloseTo(61.76, 1);
  });

  it("OPTIMAL_AGES has valid ranges for all species", () => {
    expect(OPTIMAL_AGES.Mänty.lehtomainen[0]).toBeLessThanOrEqual(OPTIMAL_AGES.Mänty.lehtomainen[1]);
    expect(OPTIMAL_AGES.Kuusi.tuore[0]).toBeLessThanOrEqual(OPTIMAL_AGES.Kuusi.tuore[1]);
    expect(OPTIMAL_AGES.Rauduskoivu.lehtomainen[1]).toBeLessThanOrEqual(70);
  });

  it("getOptimalAge returns default for unknown species", () => {
    const [min, max] = getOptimalAge("Unknown", "tuore");
    expect(min).toBe(65);
    expect(max).toBe(90);
  });

  it("THINNING_BA has correct first thinning thresholds", () => {
    expect(THINNING_BA.ensiharvennus.Mänty).toBe(16);
    expect(THINNING_BA.ensiharvennus.Kuusi).toBe(24);
  });

  it("MIN_AGE_ENSIHARVENNUS has correct values", () => {
    expect(MIN_AGE_ENSIHARVENNUS.Mänty).toBe(30);
    expect(MIN_AGE_ENSIHARVENNUS.Kuusi).toBe(25);
    expect(MIN_AGE_ENSIHARVENNUS.Hieskoivu).toBe(20);
  });

  it("MIN_AGE_HARVENNUS has correct values", () => {
    expect(MIN_AGE_HARVENNUS.Mänty).toBe(45);
    expect(MIN_AGE_HARVENNUS.Kuusi).toBe(40);
  });

  it("COSTS has all silvicultural operations", () => {
    expect(COSTS["Laikkumätästys"]).toBe(300);
    expect(COSTS["Kuusen istutus"]).toBe(600);
    expect(COSTS["Taimikonhoito"]).toBe(500);
  });

  it("GROWTH_MINERAL has correct rates", () => {
    expect(GROWTH_MINERAL.lehtomainen).toBe(7.0);
    expect(GROWTH_MINERAL.tuore).toBe(5.5);
    expect(GROWTH_MINERAL.kuivahko).toBe(3.25);
    expect(GROWTH_MINERAL.kuiva).toBe(1.0);
  });

  it("GROWTH_PEATLAND has correct rates", () => {
    expect(GROWTH_PEATLAND.lehtomainen).toBe(6.25);
    expect(GROWTH_PEATLAND.tuore).toBe(5.5);
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
    expect(detectPeatland("kivennäismaa", "turve", "", "ojitettu")).toBe(true);
  });

  it("returns false for mineral soil", () => {
    expect(detectPeatland("kivennäismaa", "tuore", "", "ei ojia")).toBe(false);
  });

  it("returns false for undrained peatland", () => {
    expect(detectPeatland("turve", "suo", "", "ei ojia")).toBe(false);
  });
});
