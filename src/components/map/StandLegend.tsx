"use client";

import { useState, useEffect } from "react";
import { AGE_COLORS, computeAgeBrackets } from "@/components/map/StandLayer";
import type { CompartmentFeatureCollection } from "@/types/database";
import { useForestStore } from "@/lib/store";

interface StandLegendProps {
  compartments: CompartmentFeatureCollection;
}

function forestHueColor(forestId: string): string {
  const hue = parseInt(forestId.slice(0, 8), 16) % 360;
  return `hsl(${hue}, 70%, 45%)`;
}

/**
 * Stand age legend showing warm→cool color gradient.
 * Bracket boundaries adapt to the forest's actual age range.
 */
export default function StandLegend({ compartments }: StandLegendProps) {
  const { min, max, bracketSize } = computeAgeBrackets(compartments.features);
  const language = useForestStore((s) => s.language) ?? "en";
  const activeForestIds = useForestStore((s) => s.activeForestIds);
  const forests = useForestStore((s) => s.forests);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const brackets: { label: string; color: string }[] = [];
  for (let i = 0; i < AGE_COLORS.length; i++) {
    const lo = min + bracketSize * i;
    const hi = i < AGE_COLORS.length - 1
      ? min + bracketSize * (i + 1) - 1
      : max;
    brackets.push({
      label: mounted ? (language === "fi" ? `${lo}–${hi} v` : `${lo}–${hi} y`) : `${lo}–${hi} y`,
      color: AGE_COLORS[i],
    });
  }

  const showForests = activeForestIds.length > 1;

  return (
    <div className="absolute bottom-14 left-3 z-10 bg-white/90 dark:bg-gray-900/90 backdrop-blur rounded-lg shadow-lg p-3 text-xs text-gray-900 dark:text-gray-100 max-w-[200px]">
      <h4 className="font-semibold text-sm mb-2">{mounted ? (language === "fi" ? "Puuston ikä" : "Stand age") : "Stand age"}</h4>
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

      {showForests && (
        <>
          <h4 className="font-semibold text-sm mt-3 mb-2 pt-2 border-t border-gray-300 dark:border-gray-700">
            {mounted ? (language === "fi" ? "Metsät" : "Forests") : "Forests"}
          </h4>
          <ul className="space-y-1">
            {activeForestIds.map((fid) => {
              const forest = forests.find((f) => f.id === fid);
              const color = forestHueColor(fid);
              return (
                <li key={fid} className="flex items-center gap-2">
                  <span
                    className="inline-block w-3 h-3 rounded-sm border border-gray-400 dark:border-gray-600 flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="leading-tight truncate">{forest?.name ?? fid.slice(0, 8)}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
