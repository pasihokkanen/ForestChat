"use client";

import {
  DEVELOPMENT_CLASS_COLORS,
  DEV_CLASS_LABELS,
} from "@/lib/map/styles";

/**
 * Legend component showing development class → color mapping.
 * Fixed position overlay on the map.
 */
export default function StandLegend() {
  const entries = Object.entries(DEVELOPMENT_CLASS_COLORS).filter(
    ([key]) => key !== "default",
  );

  return (
    <div className="absolute bottom-6 left-3 z-10 bg-white/90 backdrop-blur rounded-lg shadow-lg p-3 text-xs text-gray-900 max-w-[220px]">
      <h4 className="font-semibold text-sm mb-2">Development class</h4>
      <ul className="space-y-1">
        {entries.map(([key, color]) => (
          <li key={key} className="flex items-center gap-2">
            <span
              className="inline-block w-3 h-3 rounded-sm border border-gray-400 flex-shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className="leading-tight">
              {DEV_CLASS_LABELS[key] ?? key}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
