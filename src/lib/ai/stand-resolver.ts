// src/lib/ai/stand-resolver.ts
// Phase A: Multi-forest stand ID disambiguation.
//
// Composite IDs: "forest_id/stand_id" or "ForestName/stand_id"
// Used by all AI tools that reference a stand.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ForestRef {
  id: string;
  name: string;
}

export interface ResolvedStand {
  forest_id: string;
  stand_id: string;
}

export interface AmbiguousStand {
  error: string;
  ambiguous: ForestRef[];
}

/** Parse a composite ID string into its forest and stand components.
 *  Supports: "uuid/7", "uuid/89.1", "ForestName/7".
 *  Returns null if the input doesn't contain a separator. */
export function parseCompositeId(
  input: string
): { forestPart: string; standPart: string } | null {
  // Find the last "/" — forest IDs can't contain slashes,
  // and Finnish stand IDs don't either.
  const slashIdx = input.lastIndexOf("/");
  if (slashIdx === -1) return null;

  const forestPart = input.slice(0, slashIdx);
  const standPart = input.slice(slashIdx + 1);

  if (!forestPart || !standPart) return null;
  return { forestPart, standPart };
}

/** Format a composite stand ID for display / API use. */
export function formatCompositeId(
  forest_id: string,
  stand_id: string
): string {
  return `${forest_id}/${stand_id}`;
}

/** Resolve a stand reference to a (forest_id, stand_id) pair.
 *
 *  Flow:
 *  1. If input contains "/" → parse as composite ID.
 *     - If forestPart looks like a UUID, match by forest.id.
 *     - Otherwise, match by forest.name (case-insensitive).
 *  2. If no "/" → search across all active forests for the stand_id.
 *     - Found in exactly one → resolved.
 *     - Found in multiple → return { error, ambiguous }.
 *     - Not found → return { error }.
 */
export async function resolveStandId(
  userInput: string,
  activeForests: ForestRef[],
  supabase: SupabaseClient
): Promise<ResolvedStand | AmbiguousStand> {
  const trimmed = userInput.trim();

  // ── Explicit composite format ──
  const composite = parseCompositeId(trimmed);
  if (composite) {
    const { forestPart, standPart } = composite;

    // Try matching by UUID first
    const uuidMatch = activeForests.find((f) => f.id === forestPart);
    if (uuidMatch) {
      return { forest_id: uuidMatch.id, stand_id: standPart };
    }

    // Try matching by forest name (case-insensitive)
    const nameMatch = activeForests.find(
      (f) => f.name.toLowerCase() === forestPart.toLowerCase()
    );
    if (nameMatch) {
      return { forest_id: nameMatch.id, stand_id: standPart };
    }

    return {
      error: `Forest "${forestPart}" is not in the active set.`,
      ambiguous: [],
    };
  }

  // ── Bare stand_id → search across all active forests ──
  if (activeForests.length === 0) {
    return { error: "No forests active. Activate a forest first.", ambiguous: [] };
  }

  const matches: ForestRef[] = [];

  for (const forest of activeForests) {
    const { data, error } = await supabase
      .from("compartments")
      .select("stand_id")
      .eq("forest_id", forest.id)
      .eq("stand_id", trimmed)
      .limit(1);

    if (error) {
      console.error(
        `stand-resolver: query failed for forest ${forest.id}:`,
        error
      );
      continue;
    }

    if (data && data.length > 0) {
      matches.push(forest);
    }
  }

  if (matches.length === 1) {
    return { forest_id: matches[0].id, stand_id: trimmed };
  }

  if (matches.length > 1) {
    return {
      error: `Stand "${trimmed}" exists in multiple active forests.`,
      ambiguous: matches,
    };
  }

  return {
    error: `Stand "${trimmed}" not found in any active forest.`,
    ambiguous: [],
  };
}
