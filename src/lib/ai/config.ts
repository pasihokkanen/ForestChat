// src/lib/ai/config.ts

interface PriceSet {
  tukki: number;
  kuitu: number;
}

// ─── Timber prices (UPM vko 19/2026, Central Finland) ───
// Three tiers: uudistushakkuu, harvennus, ensiharvennus
export const PRICES: Record<string, Record<string, PriceSet>> = {
  uudistushakkuu: {
    Mänty:      { tukki: 78.99, kuitu: 25.28 },
    Kuusi:      { tukki: 82.52, kuitu: 26.36 },
    Rauduskoivu:{ tukki: 61.76, kuitu: 25.79 },
    Hieskoivu:  { tukki: 53.73, kuitu: 21.58 },
    Lehtikuusi: { tukki: 58.00, kuitu: 20.00 },
    Harmaaleppä:{ tukki: 15.00, kuitu: 12.00 },
  },
  harvennus: {
    Mänty:      { tukki: 68.66, kuitu: 20.44 },
    Kuusi:      { tukki: 70.32, kuitu: 20.78 },
    Rauduskoivu:{ tukki: 53.73, kuitu: 21.58 },
    Hieskoivu:  { tukki: 50.00, kuitu: 18.00 },
    Lehtikuusi: { tukki: 52.00, kuitu: 18.00 },
    Harmaaleppä:{ tukki: 12.00, kuitu: 10.00 },
  },
  ensiharvennus: {
    Mänty:      { tukki: 50.93, kuitu: 15.96 },
    Kuusi:      { tukki: 48.20, kuitu: 17.01 },
    Rauduskoivu:{ tukki: 37.83, kuitu: 16.20 },
    Hieskoivu:  { tukki: 35.00, kuitu: 14.00 },
    Lehtikuusi: { tukki: 40.00, kuitu: 14.00 },
    Harmaaleppä:{ tukki: 10.00, kuitu: 8.00 },
  },
};

export function getPrices(tier: string, species: string): { tukki: number; kuitu: number } {
  const key = species === "Koivu" ? "Rauduskoivu" : species;
  return (PRICES[tier]?.[key] ?? PRICES[tier]?.Mänty ?? { tukki: 70, kuitu: 20 }) as { tukki: number; kuitu: number };
}

// ─── Optimal rotation ages (Väli-Suomi, ~62-63°N) ───
// [min, max]
export const OPTIMAL_AGES: Record<string, Record<string, [number, number]>> = {
  Mänty:      { lehtomainen: [55, 70], tuore: [65, 90], kuivahko: [75, 100], kuiva: [90, 120] },
  Kuusi:      { lehtomainen: [50, 65], tuore: [60, 80], kuivahko: [65, 85] },
  Hieskoivu:  { tuore: [45, 65], kuivahko: [50, 70] },
  Rauduskoivu:{ lehtomainen: [45, 60], tuore: [50, 65] },
};

export function getOptimalAge(species: string, site: string): [number, number] {
  const sp = species === "Koivu" ? "Rauduskoivu" : species;
  return OPTIMAL_AGES[sp]?.[site] ?? [65, 90];
}

// ─── Thinning thresholds ───
export const THINNING_BA: Record<string, Record<string, number>> = {
  ensiharvennus: { Mänty: 16, Kuusi: 24, Hieskoivu: 16, Rauduskoivu: 16, Lehtikuusi: 18, Harmaaleppä: 16 },
  harvennus:     { Mänty: 20, Kuusi: 26, Hieskoivu: 18, Rauduskoivu: 18, Lehtikuusi: 20, Harmaaleppä: 18 },
};

export const MIN_AGE_ENSIHARVENNUS: Record<string, number> = { Mänty: 30, Kuusi: 25, Hieskoivu: 20, Rauduskoivu: 20, Lehtikuusi: 25, Harmaaleppä: 20 };
export const MIN_AGE_HARVENNUS: Record<string, number> =  { Mänty: 45, Kuusi: 40, Hieskoivu: 35, Rauduskoivu: 35, Lehtikuusi: 40, Harmaaleppä: 35 };

// ─── Silvicultural costs (€/ha) ───
export const COSTS: Record<string, number> = {
  Laikkumätästys: 300,
  Ojitusmätästys: 400,
  Laikutus: 250,
  "Kuusen istutus": 600,
  "Männyn istutus": 550,
  "Taimikon varhaishoito": 350,
  Taimikonhoito: 500,
  Ennakkoraivaus: 400,
};

// ─── Growth rates (m³/ha/y) — Luke VMI13, Väli-Suomi ───
export const GROWTH_MINERAL: Record<string, number> = {
  lehtomainen: 7.0,
  lehto: 7.0,
  tuore: 5.5,
  kuivahko: 3.25,
  kuiva: 1.0,
};

export const GROWTH_PEATLAND: Record<string, number> = {
  lehtomainen: 6.25,
  lehto: 6.25,
  tuore: 5.5,
  kuivahko: 3.25,
  kuiva: 1.5,
};

// ─── Site classification mapping ───
export function classifySite(kasvupaikka: string): string {
  const kp = kasvupaikka.toLowerCase();
  if (kp.includes("lehto") || kp.includes("lehtomainen") || kp.includes("ruoho")) return "lehtomainen";
  if (kp.includes("tuore") || kp.includes("mustikka")) return "tuore";
  if (kp.includes("kuivahko") || kp.includes("puolukka")) return "kuivahko";
  if (kp.includes("kuiva") || kp.includes("varpu") || kp.includes("karu")) return "kuiva";
  return "kuivahko";
}

export function detectPeatland(
  maalaji: string,
  kasvupaikka: string,
  maaluokka: string,
  ojitustilanne: string
): boolean {
  const isPeat = ["turve", "räme", "suo", "korpi"].some(
    (t) => maalaji.toLowerCase().includes(t) ||
          kasvupaikka.toLowerCase().includes(t) ||
          maaluokka.toLowerCase().includes(t)
  );
  const isDrained = ojitustilanne.toLowerCase().includes("ojitettu") ||
                    kasvupaikka.toLowerCase().includes("ojit");
  return isPeat && isDrained;
}