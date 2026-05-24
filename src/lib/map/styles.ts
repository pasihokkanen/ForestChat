/**
 * Map style constants and color mappings for stand (compartment) polygons.
 *
 * Color scheme is designed for accessibility (colorblind-safe palette)
 * and matches Finnish forest development class conventions.
 */

/** Hex colors for each development class (English key only). */
export const DEVELOPMENT_CLASS_COLORS: Record<string, string> = {
  seedling: "#90EE90",
  young_thinning: "#228B22",
  mature_thinning: "#006400",
  regeneration_ready: "#FFD700",
  uneven_aged: "#9370DB",
  shelterwood: "#8B4513",
  default: "#CCCCCC",
};

/** Maps Finnish development class names to English color keys. */
export const DEV_CLASS_FI_TO_EN: Record<string, string> = {
  Taimikko: "seedling",
  "Nuori kasvatusmetsikkö": "young_thinning",
  "Varttunut kasvatusmetsikkö": "mature_thinning",
  Uudistuskypsä: "regeneration_ready",
  "Eri-ikäisrakenteinen": "uneven_aged",
  Suojuspuusto: "shelterwood",
};

/** English-only display labels for each development class. */
export const DEV_CLASS_LABELS: Record<string, string> = {
  seedling: "Seedling stand",
  young_thinning: "Young thinning",
  mature_thinning: "Mature thinning",
  regeneration_ready: "Regeneration ready",
  uneven_aged: "Uneven-aged",
  shelterwood: "Shelterwood",
};

/**
 * Returns the hex color for a given Finnish development class name.
 * Falls back to grey if the input is null or not recognised.
 */
export function getStandColor(developmentClassFi: string | null): string {
  if (!developmentClassFi) {
    return DEVELOPMENT_CLASS_COLORS.default;
  }
  const enKey = DEV_CLASS_FI_TO_EN[developmentClassFi];
  if (!enKey) {
    return DEVELOPMENT_CLASS_COLORS.default;
  }
  return DEVELOPMENT_CLASS_COLORS[enKey] ?? DEVELOPMENT_CLASS_COLORS.default;
}
