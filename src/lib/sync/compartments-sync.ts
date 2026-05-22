import { db } from "@/lib/db";
import type { Compartment } from "@/types/database";

/** Maps Supabase Compartment → Dexie Compartment shape */
function toDexieCompartment(c: Compartment) {
  return {
    id: c.id,
    forestId: c.forest_id,
    standId: c.stand_id,
    areaHa: c.area_ha,
    mainSpecies: c.main_species,
    developmentClass: c.development_class,
    siteType: c.site_type,
    age: c.age_years,
    volumeM3: c.volume_m3,
    geometry: c.geometry,
    attributes: c.attributes,
  };
}

export async function cacheCompartments(
  compartments: Compartment[],
): Promise<void> {
  const rows = compartments.map(toDexieCompartment);
  await db.compartments.bulkPut(rows);
}

export async function getCachedCompartments(forestId: string) {
  return db.compartments.where("forestId").equals(forestId).toArray();
}
