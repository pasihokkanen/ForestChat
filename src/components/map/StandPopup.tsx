"use client";

import {
  type CompartmentFeature,
  type CompartmentFeatureCollection,
} from "@/types/database";

export interface StandPopupProps {
  properties: CompartmentFeature["properties"];
  lngLat: [number, number];
}

/**
 * Popup content for a clicked forest stand.
 * Displays key attributes in a compact card.
 */
export default function StandPopup({ properties }: StandPopupProps) {
  const {
    stand_id,
    main_species,
    development_class,
    site_type,
    area_ha,
    age_years,
    volume_m3,
  } = properties;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow-lg p-3 min-w-[200px] text-sm text-gray-900 dark:text-gray-100">
      <h3 className="font-semibold text-base mb-2 border-b pb-1">
        Stand {stand_id}
      </h3>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        <dt className="text-gray-500 dark:text-gray-400">Main species</dt>
        <dd>{main_species ?? "—"}</dd>

        <dt className="text-gray-500 dark:text-gray-400">Development class</dt>
        <dd>{development_class ?? "—"}</dd>

        <dt className="text-gray-500 dark:text-gray-400">Site type</dt>
        <dd>{site_type ?? "—"}</dd>

        <dt className="text-gray-500 dark:text-gray-400">Area (ha)</dt>
        <dd>{area_ha != null ? area_ha.toFixed(1) : "—"}</dd>

        <dt className="text-gray-500 dark:text-gray-400">Age</dt>
        <dd>{age_years != null ? `${age_years} yr` : "—"}</dd>

        <dt className="text-gray-500 dark:text-gray-400">Volume (m³)</dt>
        <dd>{volume_m3 != null ? volume_m3.toFixed(0) : "—"}</dd>
      </dl>
    </div>
  );
}