// src/lib/ai/tapio-growth.ts
// Tapio-anchored growth parameters for Finnish commercial species.
// Sources: Tapio Metsänhoidon suositukset, taskukirja.

/** Dominant height at 100 years (m) — midpoints of Tapio ranges. */
export const H100: Record<string, Record<string, number>> = {
  pine: {
    "herb-rich heath": 28,
    mesic: 26,
    "sub-xeric": 22,
    xeric: 18,
  },
  spruce: {
    "herb-rich heath": 32,
    mesic: 29,
    "sub-xeric": 25,
  },
  silver_birch: {
    "herb-rich heath": 29,
    mesic: 26,
    "sub-xeric": 22,
  },
  downy_birch: {
    "herb-rich heath": 26,
    mesic: 23,
    "sub-xeric": 20,
  },
  larch: {
    "herb-rich heath": 30,
    mesic: 27,
    "sub-xeric": 24,
  },
  grey_alder: {
    "herb-rich heath": 24,
    mesic: 21,
    "sub-xeric": 18,
  },
};

/**
 * Height development as percentage of H100 at given age.
 * Tapio standard curve for Väli-Suomi. Linear interpolation between points.
 */
const HEIGHT_PCT: [number, number][] = [
  [5, 3],
  [10, 10],
  [15, 20],
  [20, 32],
  [25, 42],
  [30, 52],
  [40, 66],
  [50, 76],
  [60, 84],
  [70, 89],
  [80, 93],
  [90, 96],
  [100, 99],
];

/**
 * Mean height (m) at given age for a species × site type combination.
 * Returns arithmetic mean height (≈ 0.88 × dominant height for ages 5-30,
 * ≈ 0.92 × dominant height for ages 30+).
 */
export function meanHeight(
  species: string,
  siteType: string,
  ageYears: number,
  growthMultiplier = 1.0,
): number {
  const h100 = H100[species]?.[siteType];
  if (!h100) {
    console.warn(`tapio-growth: unknown species/site "${species}/${siteType}", falling back to pine/mesic`);
    return meanHeight("pine", "mesic", ageYears, growthMultiplier);
  }

  // Interpolate height percentage from the standard curve
  let pct = 0;
  for (let i = 0; i < HEIGHT_PCT.length; i++) {
    const [age, value] = HEIGHT_PCT[i];
    if (ageYears <= age) {
      if (i === 0) {
        pct = value * (ageYears / age); // linear from 0
      } else {
        const [prevAge, prevValue] = HEIGHT_PCT[i - 1];
        const t = (ageYears - prevAge) / (age - prevAge);
        pct = prevValue + t * (value - prevValue);
      }
      break;
    }
    if (i === HEIGHT_PCT.length - 1) {
      pct = value;
    }
  }

  const hdom = (h100 * pct) / 100;

  // Convert dominant height to mean height
  const ratio = ageYears < 30 ? 0.88 : 0.92;
  const raw = hdom * ratio;
  // Regional scaling: H ∝ growthMultiplier^(1/3) so volume ∝ growthMultiplier
  const scale = Math.cbrt(growthMultiplier);
  return Math.round(raw * scale * 10) / 10;
}

/**
 * Mean diameter at reference age (cm) by species × site type.
 * Derived from Tapio BA reference tables and thinning stem targets.
 * Reference age is 80 years for most species, 70 for herb-rich spruce,
 * 100 for xeric pine.
 *
 * Source: D = 200 × √(BA / (N × π)) using TAPIO_BA_REF midpoints
 * and Tapio post-thinning stem targets per species × site.
 */
export const D_REF: Record<string, Record<string, number>> = {
  pine: {
    "herb-rich heath": 29,
    mesic: 27,
    "sub-xeric": 21,
    xeric: 17,
  },
  spruce: {
    "herb-rich heath": 31,
    mesic: 29,
    "sub-xeric": 25,
  },
  silver_birch: {
    "herb-rich heath": 31,
    mesic: 27,
    "sub-xeric": 21,
  },
  downy_birch: {
    "herb-rich heath": 27,
    mesic: 24,
    "sub-xeric": 19,
  },
  larch: {
    "herb-rich heath": 32,
    mesic: 28,
    "sub-xeric": 23,
  },
  grey_alder: {
    "herb-rich heath": 24,
    mesic: 22,
    "sub-xeric": 17,
  },
};

/**
 * Diameter development as percentage of reference diameter at given age.
 * Derived from Tapio BA reference midpoints ÷ expected stem counts.
 * Diameter develops faster than height in relative terms — trees thicken
 * more rapidly in youth compared to their final diameter.
 */
const DIAMETER_PCT: [number, number][] = [
  [5, 5],
  [10, 15],
  [15, 25],
  [20, 40],
  [25, 52],
  [30, 62],
  [40, 73],
  [50, 84],
  [60, 94],
  [70, 97],
  [80, 100],
  [90, 100],
  [100, 100],
];

/**
 * Mean diameter (cm) at given age for a species × site type combination.
 * Uses D_REF × DIAMETER_PCT with linear interpolation.
 */
export function meanDiameter(
  species: string,
  siteType: string,
  ageYears: number,
  growthMultiplier = 1.0,
): number {
  const dRef = D_REF[species]?.[siteType];
  if (!dRef) {
    console.warn(`tapio-growth: unknown species/site "${species}/${siteType}" for diameter, falling back to pine/mesic`);
    return meanDiameter("pine", "mesic", ageYears, growthMultiplier);
  }

  // Interpolate diameter percentage from the development curve
  let pct = 0;
  for (let i = 0; i < DIAMETER_PCT.length; i++) {
    const [age, value] = DIAMETER_PCT[i];
    if (ageYears <= age) {
      if (i === 0) {
        pct = value * (ageYears / age);
      } else {
        const [prevAge, prevValue] = DIAMETER_PCT[i - 1];
        const t = (ageYears - prevAge) / (age - prevAge);
        pct = prevValue + t * (value - prevValue);
      }
      break;
    }
    if (i === DIAMETER_PCT.length - 1) {
      pct = value;
    }
  }

  const raw = (dRef * pct) / 100;
  // Regional scaling: D ∝ growthMultiplier^(1/3) so volume ∝ growthMultiplier
  const scale = Math.cbrt(growthMultiplier);
  return Math.round(raw * scale * 10) / 10;
}

/**
 * Form factor (f in V = BA × H × f) by species.
 * Pine 0.50, spruce 0.45, birch 0.42. Others default to pine.
 */
const FORM_FACTOR: Record<string, number> = {
  pine: 0.50,
  spruce: 0.45,
  silver_birch: 0.42,
  downy_birch: 0.42,
  larch: 0.48,
  grey_alder: 0.44,
};

export function formFactor(species: string): number {
  const ff = FORM_FACTOR[species];
  if (ff === undefined) {
    console.warn(`tapio-growth: unknown species "${species}" for form factor, falling back to pine`);
    return 0.50;
  }
  return ff;
}

/** Default planting diameter (cm) for seedling BA fallback (H < 1.3m or volume ≤ 0). */
export const SEEDLING_DIAMETER_CM = 2.0;

/**
 * Compute basal area (m²/ha) for a single species from its volume, height, and form factor.
 * For seedling stands (H < 1.3m or volume ≤ 0), falls back to stems×diameter formula
 * using SEEDLING_DIAMETER_CM as default when diameterCm is 0.
 */
export function computeSpeciesBA(
  volumeM3: number,
  heightM: number,
  species: string,
  stemCount: number,
  diameterCm: number,
): number {
  if (volumeM3 <= 0 || heightM < 1.3) {
    const d = diameterCm > 0 ? diameterCm : SEEDLING_DIAMETER_CM;
    return Math.round(stemCount * Math.PI * Math.pow(d / 200, 2) * 10) / 10;
  }
  const f = formFactor(species);
  return Math.round(volumeM3 / (heightM * f) * 10) / 10;
}

/**
 * Compute mean diameter (cm) from basal area and stem count.
 * D = 200 × √(BA / (N × π))
 */
export function computeDiameter(ba: number, stemCount: number): number {
  if (stemCount <= 0 || ba <= 0) return 0;
  return Math.round(200 * Math.sqrt(ba / (stemCount * Math.PI)) * 10) / 10;
}

/**
 * Aggregated stand basal area: sum of per-species BAs.
 * When `areaHa` is provided, volumes are assumed to be per-stand totals
 * and are divided by areaHa to produce per-hectare BA.
 * When omitted (legacy callers like the Tapio validation test),
 * volumes are assumed to already be per-hectare.
 * Falls back to treating the first species at 100% volume/stems
 * when speciesData is empty (stands loaded without per-species breakdown).
 */
export function computeStandBA(
  speciesData: Array<{ volumeM3: number; species: string; stemCount: number; diameterCm: number }>,
  standAge: number,
  siteType: string,
  fallbackSpecies?: string,
  areaHa?: number,
  growthMultiplier = 1.0,
): number {
  if (speciesData.length === 0) {
    return 0;
  }
  const area = (areaHa && areaHa > 0) ? areaHa : 1;
  return Math.round(
    speciesData.reduce((sum, sp) => {
      const h = meanHeight(sp.species, siteType, standAge, growthMultiplier);
      const volPerHa = sp.volumeM3 / area;
      return sum + computeSpeciesBA(volPerHa, h, sp.species, sp.stemCount, sp.diameterCm);
    }, 0) * 10,
  ) / 10;
}

/**
 * Stand mean height: basal-area-weighted average of per-species heights.
 * When `areaHa` is provided, volumes are assumed to be per-stand totals
 * and are divided by areaHa before computing per-species BA for weighting.
 * For pure stands, this equals the species' meanHeight.
 */
export function computeStandHeight(
  speciesData: Array<{ volumeM3: number; species: string; stemCount: number; diameterCm: number }>,
  standAge: number,
  siteType: string,
  areaHa?: number,
  growthMultiplier = 1.0,
): number {
  let totalBA = 0;
  let weightedSum = 0;
  const area = (areaHa && areaHa > 0) ? areaHa : 1;
  for (const sp of speciesData) {
    const h = meanHeight(sp.species, siteType, standAge, growthMultiplier);
    const volPerHa = sp.volumeM3 / area;
    const ba = computeSpeciesBA(volPerHa, h, sp.species, sp.stemCount, sp.diameterCm);
    totalBA += ba;
    weightedSum += ba * h;
  }
  if (totalBA <= 0) return meanHeight(speciesData[0]?.species ?? "pine", siteType, standAge, growthMultiplier);
  return Math.round((weightedSum / totalBA) * 10) / 10;
}

/**
 * Stand mean diameter from aggregated BA and total stem count.
 * Thin wrapper around computeDiameter() — kept as a separate export for API clarity.
 * D = 200 × √(G_stand / (N_stand × π))
 */
export function computeStandDiameter(standBA: number, totalStems: number): number {
  return computeDiameter(standBA, totalStems);
}

/** Tapio reference BA ranges for validation at key ages. */
export interface TapioBARef {
  age: number;
  min: number;
  max: number;
}

/** Tapio reference BA (m²/ha) for managed (thinned) stands. */
export const TAPIO_BA_REF: Record<string, TapioBARef[]> = {
  pine_mesic: [
    { age: 20, min: 8, max: 12 },
    { age: 40, min: 16, max: 22 },
    { age: 60, min: 20, max: 26 },
    { age: 80, min: 22, max: 30 },
  ],
  pine_sub_xeric: [
    { age: 20, min: 4, max: 8 },
    { age: 40, min: 10, max: 16 },
    { age: 60, min: 14, max: 20 },
    { age: 80, min: 16, max: 22 },
  ],
  pine_xeric: [
    { age: 40, min: 5, max: 10 },
    { age: 60, min: 8, max: 14 },
    { age: 80, min: 10, max: 16 },
    { age: 100, min: 10, max: 18 },
  ],
  spruce_mesic: [
    { age: 20, min: 10, max: 15 },
    { age: 40, min: 18, max: 26 },
    { age: 60, min: 22, max: 30 },
    { age: 80, min: 26, max: 34 },
  ],
  spruce_herb_rich: [
    { age: 20, min: 12, max: 18 },
    { age: 40, min: 22, max: 30 },
    { age: 60, min: 28, max: 36 },
    { age: 70, min: 30, max: 38 },
  ],
};

/** Tapio reference mean height (m) for validation at key ages. */
export interface TapioHeightRef {
  age: number;
  min: number;
  max: number;
}

export const TAPIO_HEIGHT_REF: Record<string, TapioHeightRef[]> = {
  pine_mesic: [
    { age: 20, min: 6, max: 9 },
    { age: 40, min: 12, max: 16 },
    { age: 60, min: 16, max: 20 },
    { age: 80, min: 19, max: 23 },
  ],
  pine_sub_xeric: [
    { age: 20, min: 4, max: 7 },
    { age: 40, min: 8, max: 12 },
    { age: 60, min: 11, max: 15 },
    { age: 80, min: 13, max: 17 },
  ],
  spruce_mesic: [
    { age: 20, min: 6, max: 10 },
    { age: 40, min: 14, max: 18 },
    { age: 60, min: 18, max: 23 },
    { age: 80, min: 22, max: 26 },
  ],
  spruce_herb_rich: [
    { age: 20, min: 8, max: 12 },
    { age: 40, min: 16, max: 21 },
    { age: 60, min: 21, max: 26 },
    { age: 70, min: 24, max: 29 },
  ],
};
