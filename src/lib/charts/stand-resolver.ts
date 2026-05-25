// src/lib/charts/stand-resolver.ts
// Resolves chart clicks to stand IDs for cross-panel interaction.

import type { ChartTab } from "@/lib/store/visualization-slice";

interface Operation {
  year: number;
  compartment_id: string;
}

interface Compartment {
  id: string;
  stand_id: string;
}

/**
 * Given a clicked chart data point and the chart config,
 * resolve which stands should be highlighted on the map.
 */
export function resolveHighlightedStands(
  clickedData: Record<string, unknown>,
  tab: ChartTab,
  operations: Operation[],
  compartments: Compartment[]
): string[] {
  // Case 1: Chart has direct stand dimension (stand_id per data point)
  if (tab.standDimension) {
    const standId = clickedData[tab.standDimension] as string;
    return standId ? [standId] : [];
  }

  // Case 2: Chart has year dimension (e.g., "year" as x_key)
  if (
    (tab.xKey === "year" || tab.xKey === "Year") &&
    tab.yKey !== "stand_id"
  ) {
    const year = Number(clickedData[tab.xKey]);
    if (!isNaN(year)) {
      const compMap = new Map<string, string>();
      for (const c of compartments) {
        compMap.set(c.id, c.stand_id);
      }
      const standIds = operations
        .filter((op) => op.year === year)
        .map((op) => compMap.get(op.compartment_id))
        .filter(Boolean) as string[];
      return [...new Set(standIds)];
    }
  }

  return [];
}