import { db } from "@/lib/db";
import type { Operation } from "@/types/database";

function toDexieOperation(o: Operation) {
  return {
    id: o.id,
    compartmentId: o.compartment_id,
    forestId: o.forest_id,
    type: o.type,
    year: o.year,
    removalPct: o.removal_pct,
    incomeEur: o.income_eur,
    costEur: o.cost_eur,
  };
}

export async function cacheOperations(
  operations: Operation[],
): Promise<void> {
  const rows = operations.map(toDexieOperation);
  await db.operations.bulkPut(rows);
}

export async function getCachedOperations(forestId: string) {
  return db.operations.where("forestId").equals(forestId).toArray();
}
