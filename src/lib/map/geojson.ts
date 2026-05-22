import type {
  Compartment,
  CompartmentFeature,
  CompartmentFeatureCollection,
} from "@/types/database";

export function compartmentsToGeoJSON(
  compartments: Compartment[],
): CompartmentFeatureCollection {
  const features: CompartmentFeature[] = compartments
    .filter((c) => c.geometry !== null)
    .map((c) => ({
      type: "Feature" as const,
      geometry: c.geometry!,
      properties: {
        id: c.id,
        stand_id: c.stand_id,
        main_species: c.main_species,
        development_class: c.development_class,
        site_type: c.site_type,
        area_ha: c.area_ha,
        age_years: c.age_years,
        volume_m3: c.volume_m3,
      },
    }));

  return {
    type: "FeatureCollection",
    features,
  };
}
