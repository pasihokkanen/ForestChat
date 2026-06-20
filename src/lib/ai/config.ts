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

// ─── Price region multipliers (Luke based) ───

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
// first_thinning BA triggers by species × site (Tapio midpoints, site-calibrated)
// Higher on fertile sites (faster growth reaches trigger sooner), lower on poor sites.
export const THINNING_BA: {
  first_thinning: Record<string, Record<string, number>>;
  thinning: Record<string, number>;
} = {
  first_thinning: {
    pine:        { "herb-rich heath": 26, mesic: 24, "sub-xeric": 22, xeric: 18 },
    spruce:      { "herb-rich heath": 30, mesic: 28, "sub-xeric": 24 },
    downy_birch: { "herb-rich heath": 24, mesic: 22, "sub-xeric": 20 },
    silver_birch:{ "herb-rich heath": 24, mesic: 22 },
    larch:       { "herb-rich heath": 24, mesic: 22, "sub-xeric": 20 },
    grey_alder:  { "herb-rich heath": 20, mesic: 18, "sub-xeric": 16 },
  },
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
  downy_birch: { "herb-rich heath": 24, mesic: 22, "sub-xeric": 20 },
  larch:       { "herb-rich heath": 26, mesic: 24, "sub-xeric": 22 },
  grey_alder:  { "herb-rich heath": 22, mesic: 20, "sub-xeric": 18 },
};

/** Get the site-calibrated thinning BA trigger for a species+site combination. */
export function getThinningTriggerBA(species: string, siteClass: string): number {
  const bySite = THINNING_BA_BY_SITE[species];
  if (bySite?.[siteClass]) return bySite[siteClass];
  return THINNING_BA["thinning"]?.[species] ?? 22;
}

/** Get the site-calibrated first-thinning BA trigger for a species+site combination. */
export function getFirstThinningTriggerBA(species: string, siteClass: string): number {
  const bySite = THINNING_BA["first_thinning"]?.[species];
  if (bySite?.[siteClass]) return bySite[siteClass];
  return bySite?.mesic ?? 18;
}

/** Minimum BA headroom (m²/ha) below the thinning trigger that the post-thinning
 *  BA must leave, ensuring ≥15 year recovery intervals. Higher values for
 *  fast-growing species/sites. Derived from Tapio D growth rates at minimum
 *  thinning age with a convergence bonus for stands below the Tapio curve. */
export const THINNING_HEADROOM: Record<string, Record<string, number>> = {
  pine:        { "herb-rich heath": 9, mesic: 10, "sub-xeric": 10, xeric: 9 },
  spruce:      { "herb-rich heath": 10, mesic: 10, "sub-xeric": 11 },
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
  pine:        { "herb-rich heath": 1100, mesic: 1100, "sub-xeric": 1100, xeric: 1000 },
  spruce:      { "herb-rich heath": 1100, mesic: 1100, "sub-xeric": 1000 },
  silver_birch:{ "herb-rich heath": 750, mesic: 750 },
  downy_birch: { "herb-rich heath": 1150, mesic: 1150, "sub-xeric": 1150 },
  larch:       { "herb-rich heath": 1000, mesic: 900, "sub-xeric": 900 },
  grey_alder:  { "herb-rich heath": 800, mesic: 700, "sub-xeric": 700 },
};

/** Default first thinning target when species/site not in table. */
export const FIRST_THINNING_DEFAULT_TARGET = 1100;

/** Minimum removal fraction for first thinning (Tapio lower bound: 35%). */
export const FIRST_THINNING_MIN_REMOVAL = 0.35;

/** Maximum removal fraction for first thinning (Tapio upper bound: 50%). */
export const FIRST_THINNING_MAX_REMOVAL = 0.50;

/** Maximum mean diameter (cm) for first thinning eligibility.
 *  Stands with larger diameters are biologically past the first thinning stage.
 *  Higher on fertile sites (trees thicken faster), lower on poor sites. */
export const MAX_DIAMETER_FIRST_THINNING: Record<string, Record<string, number>> = {
  pine:        { "herb-rich heath": 22, mesic: 20, "sub-xeric": 18, xeric: 16 },
  spruce:      { "herb-rich heath": 22, mesic: 20, "sub-xeric": 18 },
  silver_birch:{ "herb-rich heath": 20, mesic: 18 },
  downy_birch: { mesic: 18, "sub-xeric": 16 },
  larch:       { "herb-rich heath": 22, mesic: 20, "sub-xeric": 18 },
  grey_alder:  { "herb-rich heath": 18, mesic: 16, "sub-xeric": 14 },
};

/** Minimum removal fraction for regular thinning (Tapio lower bound). */
export const THINNING_MIN_REMOVAL = 0.25;

/** Maximum removal fraction for regular thinning.
 *  Raised to 0.50 (from 0.45) to allow sufficient BA headroom for
 *  ≥15 year recovery intervals on fast-growing sites. */
export const THINNING_MAX_REMOVAL = 0.50;

/** Minimum annual diameter increment (cm/year) at old age, by species × site.
 *  Ensures trees never stop growing even at the Tapio D_REF asymptote.
 *  Values are ~60-70% of the Tapio tail delta so the floor only activates
 *  as a safety net when Tapio+convergence growth drops below this floor.
 *  Applied with an age-dependent multiplier: floor × max(0.3, 1−(age−80)/300). */
export const MIN_DIAMETER_INCREMENT: Record<string, Record<string, number>> = {
  pine:        { "herb-rich heath": 0.04, mesic: 0.035, "sub-xeric": 0.030, xeric: 0.020 },
  spruce:      { "herb-rich heath": 0.05, mesic: 0.040, "sub-xeric": 0.030 },
  silver_birch:{ "herb-rich heath": 0.03, mesic: 0.025 },
  downy_birch: { mesic: 0.025, "sub-xeric": 0.020 },
  larch:       { "herb-rich heath": 0.04, mesic: 0.035, "sub-xeric": 0.025 },
  grey_alder:  { "herb-rich heath": 0.03, mesic: 0.025, "sub-xeric": 0.020 },
};

/** Fallback minimum diameter increment when species/site not in table. */
export const MIN_DIAMETER_INCREMENT_DEFAULT = 0.025;

/** Minimum annual height increment (m/year) at old age, by species.
 *  Applied with same age-dependent multiplier as diameter floor. */
export const MIN_HEIGHT_INCREMENT: Record<string, number> = {
  pine: 0.010, spruce: 0.015, silver_birch: 0.008, downy_birch: 0.008,
  larch: 0.012, grey_alder: 0.008,
};

/** Fallback minimum height increment when species not in table. */
export const MIN_HEIGHT_INCREMENT_DEFAULT = 0.010;

export const MIN_AGE_FIRST_THINNING: Record<string, Record<string, number>> = {
  pine:        { "herb-rich heath": 25, mesic: 30, "sub-xeric": 35, xeric: 40 },
  spruce:      { "herb-rich heath": 20, mesic: 25, "sub-xeric": 30 },
  silver_birch:{ "herb-rich heath": 18, mesic: 20 },
  downy_birch: { mesic: 20, "sub-xeric": 25 },
  larch:       { "herb-rich heath": 22, mesic: 25, "sub-xeric": 30 },
  grey_alder:  { "herb-rich heath": 15, mesic: 20, "sub-xeric": 25 },
};

export const MIN_AGE_THINNING: Record<string, Record<string, number>> = {
  pine:        { "herb-rich heath": 35, mesic: 40, "sub-xeric": 45, xeric: 55 },
  spruce:      { "herb-rich heath": 30, mesic: 35, "sub-xeric": 40 },
  silver_birch:{ "herb-rich heath": 25, mesic: 30 },
  downy_birch: { mesic: 30, "sub-xeric": 35 },
  larch:       { "herb-rich heath": 30, mesic: 35, "sub-xeric": 40 },
  grey_alder:  { "herb-rich heath": 25, mesic: 30, "sub-xeric": 35 },
};

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

/** Minimum standing volume per hectare (m³/ha) for clearcut economic viability,
 *  by site class. Higher on fertile sites (more valuable timber), lower on poor sites.
 *  Tapio: ≥150 m³/ha fertile, ≥120 m³/ha medium, ≥100 m³/ha poor. */
export const CLEARCUT_MIN_VOLUME_PER_HA: Record<string, number> = {
  "herb-rich heath": 160,
  mesic: 140,
  "sub-xeric": 120,
  xeric: 100,
};

/** Get the site-calibrated minimum clearcut volume per hectare. */
export function getClearcutMinVolumePerHa(siteClass: string): number {
  return CLEARCUT_MIN_VOLUME_PER_HA[siteClass] ?? 140;
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

// ─── Tending thresholds (species × site) ───
// Tapio varhaisperkaus / taimikonharvennus by species and site class.
// Fertile sites: higher stem thresholds (more stems before tending triggers)
// and higher target stems (leave more after tending).

/** Early tending stem trigger (stems/ha): varhaisperkaus when stems exceed this. */
export const EARLY_TENDING_STEM_THRESHOLD: Record<string, Record<string, number>> = {
  pine:        { "herb-rich heath": 5000, mesic: 4500, "sub-xeric": 4000, xeric: 3500 },
  spruce:      { "herb-rich heath": 5000, mesic: 4500, "sub-xeric": 4000 },
  silver_birch:{ "herb-rich heath": 4000, mesic: 3500 },
  downy_birch: { mesic: 3500, "sub-xeric": 3000 },
  larch:       { "herb-rich heath": 5000, mesic: 4500, "sub-xeric": 4000 },
  grey_alder:  { "herb-rich heath": 4000, mesic: 3500, "sub-xeric": 3000 },
};

/** Tending stem trigger (stems/ha): taimikonharvennus when stems exceed this. */
export const TENDING_STEM_THRESHOLD: Record<string, Record<string, number>> = {
  pine:        { "herb-rich heath": 2500, mesic: 2250, "sub-xeric": 2000, xeric: 1800 },
  spruce:      { "herb-rich heath": 2500, mesic: 2250, "sub-xeric": 2000 },
  silver_birch:{ "herb-rich heath": 2000, mesic: 1800 },
  downy_birch: { mesic: 1800, "sub-xeric": 1600 },
  larch:       { "herb-rich heath": 2200, mesic: 2000, "sub-xeric": 1800 },
  grey_alder:  { "herb-rich heath": 1800, mesic: 1600, "sub-xeric": 1400 },
};

/** Early tending max height (m): above this, varhaisperkaus is no longer appropriate. */
export const EARLY_TENDING_MAX_HEIGHT: Record<string, number> = {
  pine: 1.0, spruce: 1.5, silver_birch: 1.5, downy_birch: 1.5, birch: 1.5, larch: 1.2,
};

/** Tending min height (m): below this, taimikonharvennus should not fire. */
export const TENDING_MIN_HEIGHT: Record<string, number> = {
  pine: 3.0, spruce: 3.5, silver_birch: 4.0, downy_birch: 4.0, birch: 4.0, larch: 3.5,
};

/** Tending max height (m): above this, stand enters thinning phase. */
export const TENDING_MAX_HEIGHT: Record<string, number> = {
  pine: 4.0, spruce: 5.0, silver_birch: 6.0, downy_birch: 6.0, birch: 6.0, larch: 5.0,
};

/** Target stems/ha after early tending, by species × site. */
export const EARLY_TENDING_TARGET_STEMS_HA: Record<string, Record<string, number>> = {
  pine:        { "herb-rich heath": 3500, mesic: 3250, "sub-xeric": 3000, xeric: 2800 },
  spruce:      { "herb-rich heath": 3500, mesic: 3250, "sub-xeric": 3000 },
  silver_birch:{ "herb-rich heath": 3000, mesic: 2750 },
  downy_birch: { mesic: 2750, "sub-xeric": 2500 },
  larch:       { "herb-rich heath": 3500, mesic: 3250, "sub-xeric": 3000 },
  grey_alder:  { "herb-rich heath": 3000, mesic: 2750, "sub-xeric": 2500 },
};

/** Target stems/ha after tending (taimikonharvennus), by species × site. */
export const TENDING_TARGET_STEMS_HA: Record<string, Record<string, number>> = {
  pine:        { "herb-rich heath": 2200, mesic: 2000, "sub-xeric": 1800, xeric: 1600 },
  spruce:      { "herb-rich heath": 2100, mesic: 1900, "sub-xeric": 1700 },
  silver_birch:{ "herb-rich heath": 1800, mesic: 1600 },
  downy_birch: { mesic: 1600, "sub-xeric": 1400 },
  larch:       { "herb-rich heath": 2000, mesic: 1800, "sub-xeric": 1600 },
  grey_alder:  { "herb-rich heath": 1800, mesic: 1600, "sub-xeric": 1400 },
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