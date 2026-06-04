/**
 * Map style constants and color mappings for stand (compartment) polygons.
 *
 * Color scheme is designed for accessibility (colorblind-safe palette)
 * and matches Finnish forest development class conventions.
 * Separate light/dark palettes ensure good contrast on both map styles.
 */

/** Hex colors for each development class — light theme. */
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

/** Hex colors for each development class — dark theme (brighter for visibility on dark maps). */
export const DEVELOPMENT_CLASS_COLORS_DARK: Record<string, string> = {
  seedling: "#5CBF5C",
  seedling_small: "#5CBF5C",
  seedling_large: "#5CBF5C",
  open_area: "#888888",
  young_thinning: "#3CB043",
  mature_thinning: "#228B22",
  regeneration_ready: "#E6C200",
  seed_tree: "#D4A050",
  uneven_aged: "#A98EDB",
  shelterwood: "#A0522D",
  default: "#777777",
};

/** Return the color for a dev class key, respecting dark/light theme. */
export function getDevClassColor(key: string, isDark: boolean): string {
  const palette = isDark ? DEVELOPMENT_CLASS_COLORS_DARK : DEVELOPMENT_CLASS_COLORS;
  return palette[key] ?? palette.default;
}

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
export function getStandColor(developmentClassFi: string | null, isDark = false): string {
  if (!developmentClassFi) {
    return getDevClassColor("default", isDark);
  }
  // First try direct English lookup (CSV import path)
  const palette = isDark ? DEVELOPMENT_CLASS_COLORS_DARK : DEVELOPMENT_CLASS_COLORS;
  if (palette[developmentClassFi]) {
    return palette[developmentClassFi];
  }
  // Fall back to Finnish→English lookup (WFS import path)
  const enKey = DEV_CLASS_FI_TO_EN[developmentClassFi];
  return getDevClassColor(enKey, isDark);
}
