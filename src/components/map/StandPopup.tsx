"use client";

import type { CompartmentFeature } from "@/types/database";

export interface StandPopupProps {
  properties: CompartmentFeature["properties"];
  lngLat: [number, number];
  onClose?: () => void;
}

/**
 * Popup content for a clicked forest stand.
 * Displays key attributes in a compact card.
 * Note: The map popup in StandLayer.tsx is the actual renderer; this
 * React component is kept for potential future Maplibre popup usage.
 */
export default function StandPopup({ properties, onClose }: StandPopupProps) {
  const {
    stand_id,
    development_class,
    site_type,
    area_ha,
    age_years,
    volume_m3,
    basal_area,
    avg_diameter,
    avg_height,
  } = properties;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow-lg p-3 min-w-[200px] text-sm text-gray-900 dark:text-gray-100 relative">
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-1 right-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none w-5 h-5 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          ×
        </button>
      )}
      <h3 className="font-semibold text-base mb-2 border-b pb-1">
        Stand {stand_id}
      </h3>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        <dt className="text-gray-500 dark:text-gray-400">Dev. class</dt>
        <dd>{development_class ?? "—"}</dd>

        <dt className="text-gray-500 dark:text-gray-400">Site type</dt>
        <dd>{site_type ?? "—"}</dd>

        <dt className="text-gray-500 dark:text-gray-400">Area (ha)</dt>
        <dd>{area_ha != null ? area_ha.toFixed(1) : "—"}</dd>

        <dt className="text-gray-500 dark:text-gray-400">Age</dt>
        <dd>{age_years != null ? `${age_years} yr` : "—"}</dd>

        <dt className="text-gray-500 dark:text-gray-400">Volume (m³)</dt>
        <dd>{volume_m3 != null ? volume_m3.toFixed(0) : "—"}</dd>

        <dt className="text-gray-500 dark:text-gray-400">Basal area</dt>
        <dd>{basal_area != null ? basal_area.toFixed(1) : "—"}</dd>

        <dt className="text-gray-500 dark:text-gray-400">Avg diam.</dt>
        <dd>{avg_diameter != null ? `${avg_diameter.toFixed(1)} cm` : "—"}</dd>

        <dt className="text-gray-500 dark:text-gray-400">Avg height</dt>
        <dd>{avg_height != null ? `${avg_height.toFixed(1)} m` : "—"}</dd>
      </dl>
    </div>
  );
}
