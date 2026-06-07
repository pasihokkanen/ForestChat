// src/lib/ai/species-map.ts
// Phase 7b (T9): Fuzzy mapping of user-supplied species names to system values.

const SPECIES_ALIASES: Record<string, string> = {
  // Pine
  "mänty": "pine",
  "mäntyä": "pine",
  "petäjä": "pine",
  "honka": "pine",
  "mäntyvaltainen": "pine",
  "männikkö": "pine",

  // Spruce
  "kuusi": "spruce",
  "kuusta": "spruce",
  "kuusikko": "spruce",
  "kuusivaltainen": "spruce",

  // Birch
  "koivu": "silver_birch",
  "koivua": "silver_birch",
  "rauduskoivu": "silver_birch",
  "raudus": "silver_birch",
  "hieskoivu": "downy_birch",
  "hies": "downy_birch",
  "koivikko": "silver_birch",

  // Other deciduous
  "leppä": "grey_alder",
  "tervaleppä": "grey_alder",
  "haapa": "grey_alder", // fallback — no dedicated aspen prices
  "paju": "grey_alder",
  "lehtikuusi": "larch",
  "tammi": "silver_birch", // fallback — no oak prices in Finnish timber trade

  // Mixed / generic
  "sekametsä": "pine",      // fallback for mixed forest
  "havupuu": "pine",        // conifer → pine
  "lehtipuu": "silver_birch", // deciduous → birch
};

/**
 * Normalize a user-supplied or import-provided species string to a system value.
 *
 * Handles:
 * - Finnish common names (mänty → pine)
 * - Case-insensitive matching
 * - Whitespace trimming
 * - Already-valid system values pass through unchanged
 * - Unknown/empty values fall back to "pine"
 */
export function normalizeSpecies(raw: string | null | undefined): string {
  if (!raw) return "pine";

  const cleaned = raw.trim().toLowerCase();

  // Direct system value? Pass through.
  const validSystem = new Set([
    "pine", "spruce", "silver_birch", "downy_birch",
    "larch", "grey_alder", "birch",
  ]);
  if (validSystem.has(cleaned)) {
    // "birch" → "silver_birch" (normalize generic to specific)
    return cleaned === "birch" ? "silver_birch" : cleaned;
  }

  // Look up alias
  return SPECIES_ALIASES[cleaned] ?? "pine";
}
