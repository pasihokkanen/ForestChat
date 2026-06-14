// src/lib/ai/config.ts

interface PriceSet {
  tukki: number;
  kuitu: number;
}

// ─── Timber prices (UPM vko 19/2026, Central Finland) ───
// Keys match operation type names.
export const PRICES: Record<string, Record<string, PriceSet>> = {
  clear_cut: {
    pine:        { tukki: 78.99, kuitu: 25.28 },
    spruce:      { tukki: 82.52, kuitu: 26.36 },
    silver_birch:{ tukki: 61.76, kuitu: 25.79 },
    downy_birch: { tukki: 53.73, kuitu: 21.58 },
    larch:       { tukki: 58.00, kuitu: 20.00 },
    grey_alder:  { tukki: 15.00, kuitu: 12.00 },
  },
  thinning: {
    pine:        { tukki: 68.66, kuitu: 20.44 },
    spruce:      { tukki: 70.32, kuitu: 20.78 },
    silver_birch:{ tukki: 53.73, kuitu: 21.58 },
    downy_birch: { tukki: 50.00, kuitu: 18.00 },
    larch:       { tukki: 52.00, kuitu: 18.00 },
    grey_alder:  { tukki: 12.00, kuitu: 10.00 },
  },
  first_thinning: {
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
  pine:        { "herb-rich heath": [55, 70], mesic: [65, 90], "sub-xeric": [75, 100], xeric: [90, 120] },
  spruce:      { "herb-rich heath": [60, 75], mesic: [70, 90], "sub-xeric": [75, 95] },
  downy_birch: { mesic: [45, 65], "sub-xeric": [50, 70] },
  silver_birch:{ "herb-rich heath": [45, 60], mesic: [50, 65] },
};

export function getOptimalAge(species: string, site: string, growthMultiplier = 1.0): [number, number] {
  const sp = species === "birch" ? "silver_birch" : species;
  const table = OPTIMAL_AGES[sp];
  if (!table) return [80, 110]; // unknown species, conservative
  const [optMin, optMax] = table[site] ?? table["mesic"] ?? [80, 110];
  const ageMultiplier = 1 / growthMultiplier;
  return [Math.round(optMin * ageMultiplier), Math.round(optMax * ageMultiplier)];
}

// ─── Region multipliers (Luke VMI13 based) ───

/** Growth rate multiplier per Luke price region. 1.00 = Väli-Suomi baseline. */
export const GROWTH_REGION_MULTIPLIERS: Record<string, number> = {
  "1": 1.10,   // Etelä-Suomi
  "3": 1.00,   // Keski-Suomi (baseline)
  "4": 0.90,   // Savo-Karjala
  "5": 1.05,   // Kymi-Savo
  "6": 1.00,   // Etelä-Pohjanmaa (baseline)
  "71": 0.80,  // Pohjois-Pohjanmaa
  "72": 0.75,  // Kainuu-Koillismaa
  "8": 0.55,   // Lappi
  "9": 1.00,   // KOKO MAA (fallback)
};

/** Timber price multiplier per Luke price region (fallback when API is unavailable). */
export const PRICE_REGION_MULTIPLIERS: Record<string, number> = {
  "1": 1.15,   // Etelä-Suomi — highest prices
  "3": 1.00,   // Keski-Suomi (reference)
  "4": 0.90,   // Savo-Karjala
  "5": 0.95,   // Kymi-Savo
  "6": 0.92,   // Etelä-Pohjanmaa
  "71": 0.85,  // Pohjois-Pohjanmaa
  "72": 0.80,  // Kainuu-Koillismaa
  "8": 0.75,   // Lappi — lowest prices
  "9": 1.00,   // KOKO MAA (fallback)
};

// ─── Operation defaults (single source of truth) ───
// removalPct: percentage stored in DB operations.removal_pct
// removalFraction: fraction used in simulation (volumeM3 × this)
// priceTier: maps to PRICES lookup (empty string = non-harvest, no income)

export interface OperationDefaults {
  removalPct: number;
  removalFraction: number;
  priceTier: string;
}

export const OPERATION_DEFAULTS: Record<string, OperationDefaults> = {
  clear_cut:          { removalPct: 100, removalFraction: 1.0,  priceTier: "clear_cut" },
  thinning:           { removalPct: 33,  removalFraction: 0.33, priceTier: "thinning" },
  first_thinning:     { removalPct: 40,  removalFraction: 0.40, priceTier: "first_thinning" },
  selection_cutting:  { removalPct: 50,  removalFraction: 0.50, priceTier: "thinning" },
  overstory_removal:  { removalPct: 100, removalFraction: 1.0,  priceTier: "clear_cut" },
  early_tending:      { removalPct: 40,  removalFraction: 0.40, priceTier: "" },
  tending:            { removalPct: 30,  removalFraction: 0.30, priceTier: "" },
};

/** Get the removal percentage for an operation type (for DB storage). */
export function getRemovalPct(type: string): number {
  return OPERATION_DEFAULTS[type]?.removalPct ?? 0;
}

// ─── Thinning thresholds ───
export const THINNING_BA: Record<string, Record<string, number>> = {
  // Tapio ensiharvennus BA triggers (midpoint of span: pine 22-26→24, spruce 26-30→28, birch 20-24→22)
  first_thinning: { pine: 24, spruce: 28, downy_birch: 22, silver_birch: 22, larch: 22, grey_alder: 18 },
  // Tapio harvennus BA triggers (midpoint of span: pine 24-28→26, spruce 26-32→29, birch 20-24→22)
  thinning:       { pine: 26, spruce: 29, downy_birch: 22, silver_birch: 22, larch: 24, grey_alder: 20 },
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
  overstory_removal: "Overstory Removal",
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
  ylispuidenpoisto: "overstory_removal",
  ylispuunpoisto: "overstory_removal",
  overstory_removal: "overstory_removal",
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

// ─── Site classification mapping ───
export function classifySite(siteType: string): string {
  const kp = siteType.toLowerCase();
  if (kp.includes("herb-rich") || kp.includes("lehto") || kp.includes("lehtomainen") || kp.includes("ruoho")) return "herb-rich heath";
  if (kp.includes("mesic") || kp.includes("tuore") || kp.includes("mustikka")) return "mesic";
  if (kp.includes("sub-xeric") || kp.includes("kuivahko") || kp.includes("puolukka")) return "sub-xeric";
  if (kp.includes("xeric") || kp.includes("kuiva") || kp.includes("varpu") || kp.includes("karu")) return "xeric";
  return "sub-xeric";
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