// src/lib/ai/config.ts

interface PriceSet {
  tukki: number;
  kuitu: number;
}

// ─── Timber prices (UPM vko 19/2026, Central Finland) ───
// Three tiers: uudistushakkuu, harvennus, ensiharvennus
export const PRICES: Record<string, Record<string, PriceSet>> = {
  uudistushakkuu: {
    pine:        { tukki: 78.99, kuitu: 25.28 },
    spruce:      { tukki: 82.52, kuitu: 26.36 },
    silver_birch:{ tukki: 61.76, kuitu: 25.79 },
    downy_birch: { tukki: 53.73, kuitu: 21.58 },
    larch:       { tukki: 58.00, kuitu: 20.00 },
    grey_alder:  { tukki: 15.00, kuitu: 12.00 },
  },
  harvennus: {
    pine:        { tukki: 68.66, kuitu: 20.44 },
    spruce:      { tukki: 70.32, kuitu: 20.78 },
    silver_birch:{ tukki: 53.73, kuitu: 21.58 },
    downy_birch: { tukki: 50.00, kuitu: 18.00 },
    larch:       { tukki: 52.00, kuitu: 18.00 },
    grey_alder:  { tukki: 12.00, kuitu: 10.00 },
  },
  ensiharvennus: {
    pine:        { tukki: 50.93, kuitu: 15.96 },
    spruce:      { tukki: 48.20, kuitu: 17.01 },
    silver_birch:{ tukki: 37.83, kuitu: 16.20 },
    downy_birch: { tukki: 35.00, kuitu: 14.00 },
    larch:       { tukki: 40.00, kuitu: 14.00 },
    grey_alder:  { tukki: 10.00, kuitu: 8.00 },
  },
};

export function getPrices(tier: string, species: string): { tukki: number; kuitu: number } {
  const key = species === "birch" ? "silver_birch" : species;
  return (PRICES[tier]?.[key] ?? PRICES[tier]?.pine ?? { tukki: 70, kuitu: 20 }) as { tukki: number; kuitu: number };
}

// ─── Optimal rotation ages (Väli-Suomi, ~62-63°N) ───
// [min, max]
export const OPTIMAL_AGES: Record<string, Record<string, [number, number]>> = {
  pine:        { lehtomainen: [55, 70], tuore: [65, 90], kuivahko: [75, 100], kuiva: [90, 120] },
  spruce:      { lehtomainen: [50, 65], tuore: [60, 80], kuivahko: [65, 85] },
  downy_birch: { tuore: [45, 65], kuivahko: [50, 70] },
  silver_birch:{ lehtomainen: [45, 60], tuore: [50, 65] },
};

export function getOptimalAge(species: string, site: string): [number, number] {
  const sp = species === "birch" ? "silver_birch" : species;
  return OPTIMAL_AGES[sp]?.[site] ?? [65, 90];
}

// ─── Thinning thresholds ───
export const THINNING_BA: Record<string, Record<string, number>> = {
  ensiharvennus: { pine: 16, spruce: 24, downy_birch: 16, silver_birch: 16, larch: 18, grey_alder: 16 },
  harvennus:     { pine: 20, spruce: 26, downy_birch: 18, silver_birch: 18, larch: 20, grey_alder: 18 },
};

export const MIN_AGE_FIRST_THINNING: Record<string, number> = { pine: 30, spruce: 25, downy_birch: 20, silver_birch: 20, larch: 25, grey_alder: 20 };
export const MIN_AGE_THINNING: Record<string, number> =  { pine: 45, spruce: 40, downy_birch: 35, silver_birch: 35, larch: 40, grey_alder: 35 };

// ─── Operation type display names (system value → English display) ───
// Used for chart legends, tooltips, and any user-facing display of operation types.
// The keys are snake_case system values stored in the DB.
export const OPERATION_TYPE_DISPLAY: Record<string, string> = {
  clear_cut: "Clearcut",
  thinning: "Thinning",
  first_thinning: "First Thinning",
  selection_cutting: "Selection Cutting",
  tending: "Tending",
  early_tending: "Early Tending",
  pre_clearance: "Pre-clearance",
  site_prep: "Mounding",
  ditch_mounding: "Ditch Mounding",
  scalping: "Scalping",
  spruce_planting: "Spruce Planting",
  pine_planting: "Pine Planting",
  planting: "Planting",
};

/** Translate a system operation type value to its English display form. */
export function displayOperationType(sysValue: string): string {
  return OPERATION_TYPE_DISPLAY[sysValue] ?? sysValue;
}

// ─── Finnish → system value mapping (for AI tool input normalization) ───
// Accepts both Finnish names and English capitalized variants, maps to snake_case.
export const FINNISH_TO_SYSTEM: Record<string, string> = {
  päätehakkuu: "clear_cut",
  clear_cut: "clear_cut",
  avohakkuu: "clear_cut",
  harvennus: "thinning",
  thinning: "thinning",
  ensiharvennus: "first_thinning",
  first_thinning: "first_thinning",
  poimintahakkuu: "selection_cutting",
  selection_cutting: "selection_cutting",
  taimikonhoito: "tending",
  tending: "tending",
  "taimikon varhaishoito": "early_tending",
  early_tending: "early_tending",
  ennakkoraivaus: "pre_clearance",
  pre_clearance: "pre_clearance",
  laikkumätästys: "site_prep",
  site_prep: "site_prep",
  ojitusmätästys: "ditch_mounding",
  ditch_mounding: "ditch_mounding",
  laikutus: "scalping",
  scalping: "scalping",
  istutus: "planting",
  planting: "planting",
  "kuusen istutus": "spruce_planting",
  spruce_planting: "spruce_planting",
  "männyn istutus": "pine_planting",
  pine_planting: "pine_planting",
};

/** Normalize a user-supplied operation type to its system snake_case value */
export function normalizeOperationType(input: string): string {
  return FINNISH_TO_SYSTEM[input.toLowerCase()] ?? input;
}

// ─── Silvicultural costs (€/ha) ───
export const COSTS: Record<string, number> = {
  site_prep: 540,
  ditch_mounding: 720,
  scalping: 450,
  spruce_planting: 1080,
  pine_planting: 990,
  early_tending: 630,
  tending: 900,
  pre_clearance: 720,
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
export function classifySite(siteType: string): string {
  const kp = siteType.toLowerCase();
  if (kp.includes("herb-rich") || kp.includes("lehto") || kp.includes("lehtomainen") || kp.includes("ruoho")) return "lehtomainen";
  if (kp.includes("mesic") || kp.includes("tuore") || kp.includes("mustikka")) return "tuore";
  if (kp.includes("sub-xeric") || kp.includes("kuivahko") || kp.includes("puolukka")) return "kuivahko";
  if (kp.includes("xeric") || kp.includes("kuiva") || kp.includes("varpu") || kp.includes("karu")) return "kuiva";
  return "kuivahko";
}

export function detectPeatland(
  soilType: string,
  siteType: string,
  landClass: string,
  drainageStatus: string
): boolean {
  const isPeat = ["turve", "räme", "suo", "korpi", "peat", "mire", "bog"].some(
    (t) => soilType.toLowerCase().includes(t) ||
          siteType.toLowerCase().includes(t) ||
          landClass.toLowerCase().includes(t)
  );
  const isDrained = drainageStatus.toLowerCase().includes("ojitettu") ||
                    siteType.toLowerCase().includes("ojit");
  return isPeat && isDrained;
}