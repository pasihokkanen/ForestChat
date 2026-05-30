/**
 * Map style constants and color mappings for stand (compartment) polygons.
 *
 * Color scheme is designed for accessibility (colorblind-safe palette)
 * and matches Finnish forest development class conventions.
 */

/** Hex colors for each development class (English key only). */
export const DEVELOPMENT_CLASS_COLORS: Record<string, string> = {
  seedling: "#90EE90",
  seedling_small: "#90EE90",
  seedling_large: "#90EE90",
  open_area: "#D3D3D3",
  young_thinning: "#228B22",
  mature_thinning: "#006400",
  regeneration_ready: "#FFD700",
  seed_tree: "#CD853F",
  uneven_aged: "#9370DB",
  shelterwood: "#8B4513",
  default: "#CCCCCC",
};

/** Maps Finnish development class names to English color keys. */
export const DEV_CLASS_FI_TO_EN: Record<string, string> = {
  Taimikko: "seedling",
  "Taimikko alle 1,3 m": "seedling_small",
  "Taimikko yli 1,3 m": "seedling_large",
  "Nuori kasvatusmetsikkö": "young_thinning",
  "Varttunut kasvatusmetsikkö": "mature_thinning",
  Uudistuskypsä: "regeneration_ready",
  "Eri-ikäisrakenteinen": "uneven_aged",
  Suojuspuusto: "shelterwood",
  Siemenpuumetsikkö: "seed_tree",
};

/** English-only display labels for each development class. */
export const DEV_CLASS_LABELS: Record<string, string> = {
  seedling: "Seedling stand",
  seedling_small: "Seedling stand (<1.3 m)",
  seedling_large: "Seedling stand (>1.3 m)",
  open_area: "Open area",
  young_thinning: "Young thinning",
  mature_thinning: "Mature thinning",
  regeneration_ready: "Regeneration ready",
  seed_tree: "Seed tree stand",
  uneven_aged: "Uneven-aged",
  shelterwood: "Shelterwood",
};

/**
 * Returns the hex color for a given development class value.
 * Handles both Finnish (WFS path) and English (CSV path) values.
 * Falls back to grey if the input is null or not recognised.
 */
export function getStandColor(developmentClassFi: string | null): string {
  if (!developmentClassFi) {
    return DEVELOPMENT_CLASS_COLORS.default;
  }
  // First try direct English lookup (CSV import path)
  if (DEVELOPMENT_CLASS_COLORS[developmentClassFi]) {
    return DEVELOPMENT_CLASS_COLORS[developmentClassFi];
  }
  // Fall back to Finnish→English lookup (WFS import path)
  const enKey = DEV_CLASS_FI_TO_EN[developmentClassFi];
  return DEVELOPMENT_CLASS_COLORS[enKey] ?? DEVELOPMENT_CLASS_COLORS.default;
}
