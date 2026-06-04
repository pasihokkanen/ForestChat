"use client";

import { AGE_COLORS, computeAgeBrackets } from "@/components/map/StandLayer";
import type { CompartmentFeatureCollection } from "@/types/database";

interface StandLegendProps {
  compartments: CompartmentFeatureCollection;
}

/**
 * Stand age legend showing warm→cool color gradient.
 * Bracket boundaries adapt to the forest's actual age range.
 */
export default function StandLegend({ compartments }: StandLegendProps) {
  const { min, max, bracketSize } = computeAgeBrackets(compartments.features);

  const brackets: { label: string; color: string }[] = [];
  for (let i = 0; i < AGE_COLORS.length; i++) {
    const lo = min + bracketSize * i;
    const hi = i < AGE_COLORS.length - 1
      ? min + bracketSize * (i + 1) - 1
      : max;
    brackets.push({
      label: `${lo}–${hi} y`,
      color: AGE_COLORS[i],
    });
  }

  return (
    <div className="absolute bottom-14 left-3 z-10 bg-white/90 dark:bg-gray-900/90 backdrop-blur rounded-lg shadow-lg p-3 text-xs text-gray-900 dark:text-gray-100 max-w-[160px]">
      <h4 className="font-semibold text-sm mb-2">Stand age</h4>
      <ul className="space-y-1">
        {brackets.map((b, i) => (
          <li key={i} className="flex items-center gap-2">
            <span
              className="inline-block w-3 h-3 rounded-sm border border-gray-400 dark:border-gray-600 flex-shrink-0"
              style={{ backgroundColor: b.color }}
            />
            <span className="leading-tight">{b.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
