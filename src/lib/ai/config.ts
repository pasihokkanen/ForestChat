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

/**
 * Compute operation revenue (€) from stand volume and known wood prices.
 * Uses 60/40 log/pulp split for pure stands (matching computeStandValue default).
 * @param volumeM3 Standing volume before operation (m³)
 * @param species Tree species
 * @param tier Price tier ("clear_cut" | "thinning" | "first_thinning")
 * @param removalFraction Fraction of volume removed (0–1)
 */
export function computeOperationValue(
  volumeM3: number,
  species: string,
  tier: string,
  removalFraction: number,
): number {
  const p = getPrices(tier, species);
  const removedM3 = volumeM3 * removalFraction;
  const logM3 = removedM3 * 0.6;
  const pulpM3 = removedM3 - logM3;
  return Math.round(logM3 * p.tukki + pulpM3 * p.kuitu);
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
// first_thinning BA triggers (species-level, Tapio midpoints)
// pine 22-26→24, spruce 26-30→28, birch 20-24→22, larch 20-24→22, grey alder 16-20→18
export const THINNING_BA: Record<string, Record<string, number>> = {
  first_thinning: { pine: 24, spruce: 28, downy_birch: 22, silver_birch: 22, larch: 22, grey_alder: 18 },
  // Species-level fallback for thinning — prefer THINNING_BA_BY_SITE below
  thinning:       { pine: 26, spruce: 29, downy_birch: 22, silver_birch: 22, larch: 24, grey_alder: 20 },
};

/** Thinning BA triggers by species × site class (site-calibrated).
 *  Upper end of Tapio range for fast-growing sites, midpoints for moderate sites.
 *  Falls back to THINNING_BA["thinning"][species] when site not in table. */
export const THINNING_BA_BY_SITE: Record<string, Record<string, number>> = {
  pine:        { "herb-rich heath": 28, mesic: 28, "sub-xeric": 26, xeric: 20 },
  spruce:      { "herb-rich heath": 30, mesic: 29, "sub-xeric": 26 },
  silver_birch:{ "herb-rich heath": 24, mesic: 22 },
  downy_birch: { mesic: 22, "sub-xeric": 20 },
  larch:       { "herb-rich heath": 26, mesic: 24, "sub-xeric": 22 },
  grey_alder:  { "herb-rich heath": 22, mesic: 20, "sub-xeric": 18 },
};

/** Get the site-calibrated thinning BA trigger for a species+site combination. */
export function getThinningTriggerBA(species: string, siteClass: string): number {
  const bySite = THINNING_BA_BY_SITE[species];
  if (bySite?.[siteClass]) return bySite[siteClass];
  // Fall back to species-level trigger, then default
  return THINNING_BA["thinning"]?.[species] ?? 22;
}

/** Minimum BA headroom (m²/ha) below the thinning trigger that the post-thinning
 *  BA must leave, ensuring ≥15 year recovery intervals. Higher values for
 *  fast-growing species/sites. Derived from Tapio D growth rates at minimum
 *  thinning age with a convergence bonus for stands below the Tapio curve. */
export const THINNING_HEADROOM: Record<string, Record<string, number>> = {
  pine:        { "herb-rich heath": 11, mesic: 12, "sub-xeric": 10, xeric: 9 },
  spruce:      { "herb-rich heath": 12, mesic: 12, "sub-xeric": 11 },
  silver_birch:{ "herb-rich heath": 10, mesic: 10 },
  downy_birch: { mesic: 10, "sub-xeric": 9 },
  larch:       { "herb-rich heath": 11, mesic: 10, "sub-xeric": 9 },
  grey_alder:  { "herb-rich heath": 10, mesic: 9, "sub-xeric": 9 },
};

/** Fallback headroom when species/site not in THINNING_HEADROOM table. */
export const THINNING_DEFAULT_HEADROOM = 8;

/** Tapio post-thinning basal area target (m²/ha) by species × site class.
 *  Reference only — new code uses headroom-based effective targets. */
export const THINNING_TARGET_BA: Record<string, Record<string, number>> = {
  pine:        { mesic: 18, "sub-xeric": 16, xeric: 14 },
  spruce:      { "herb-rich heath": 20, mesic: 19 },
  silver_birch:{ "herb-rich heath": 15, mesic: 15 },
  downy_birch: { mesic: 15 },
  larch:       { mesic: 16, "sub-xeric": 16 },
  grey_alder:  { mesic: 14, "sub-xeric": 14 },
};

/** Default thinning target BA when species/site not in table. */
export const THINNING_DEFAULT_TARGET_BA = 16;

/** Tapio post-first-thinning stem count target (stems/ha) by species and site class. */
export const FIRST_THINNING_TARGET_STEMS_HA: Record<string, Record<string, number>> = {
  pine:        { mesic: 1100, "sub-xeric": 1100, xeric: 1000 },
  spruce:      { "herb-rich heath": 1100, mesic: 1100 },
  silver_birch:{ "herb-rich heath": 750, mesic: 750 },
  downy_birch: { mesic: 1150, "sub-xeric": 1150 },
  larch:       { mesic: 900, "sub-xeric": 900 },
  grey_alder:  { mesic: 700, "sub-xeric": 700 },
};

/** Default first thinning target when species/site not in table. */
export const FIRST_THINNING_DEFAULT_TARGET = 1100;

/** Minimum removal fraction for first thinning (Tapio lower bound: 35%). */
export const FIRST_THINNING_MIN_REMOVAL = 0.35;

/** Maximum removal fraction for first thinning (Tapio upper bound: 50%). */
export const FIRST_THINNING_MAX_REMOVAL = 0.50;

/** Maximum mean diameter (cm) for first thinning eligibility.
 *  Stands with larger diameters are biologically past the first thinning stage. */
export const MAX_DIAMETER_FIRST_THINNING: Record<string, number> = {
  pine: 20, spruce: 20, silver_birch: 18, downy_birch: 18, larch: 20, grey_alder: 16,
};

/** Minimum removal fraction for regular thinning (Tapio lower bound). */
export const THINNING_MIN_REMOVAL = 0.25;

/** Maximum removal fraction for regular thinning.
 *  Raised to 0.50 (from 0.45) to allow sufficient BA headroom for
 *  ≥15 year recovery intervals on fast-growing sites. */
export const THINNING_MAX_REMOVAL = 0.50;

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

// ─── Clearcut readiness thresholds (Tapio uudistuskypsyys) ───
// Mean diameter (DBH cm) minimum for clearcut eligibility.
// Thresholds are 100% of the Tapio model's diameter at optMin + 5 years.
// A stand that grows slower will hit the threshold later → clearcut defers
// naturally, and the plan stays viable. No epsilon needed.
// See D_REF * DIAMETER_PCT at optMin+5 for each species/site combination.
export const CLEARCUT_MIN_DIAMETER: Record<string, Record<string, number>> = {
  pine:        { "herb-rich heath": 26.3, mesic: 25.2, "sub-xeric": 24.0, xeric: 17.0 },
  spruce:      { "herb-rich heath": 26.7, mesic: 25.6, "sub-xeric": 23.0 },
  downy_birch: { mesic: 20.2, "sub-xeric": 16.9 },
  silver_birch:{ "herb-rich heath": 26.0, mesic: 24.0 },
};

/** Minimum standing volume per hectare for clearcut economic viability.
 *  Tapio generally recommends ≥150 m³/ha for a commercially viable clearcut. */
export const CLEARCUT_MIN_VOLUME_PER_HA = 140;

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