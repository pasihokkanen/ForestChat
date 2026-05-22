import type { PlanMetadata } from "@/types/database";
import { createServerSupabase } from "@/lib/supabase/server";

export async function getPlanMetadataByForest(
  forestId: string
): Promise<PlanMetadata | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("plan_metadata")
    .select("*")
    .eq("forest_id", forestId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // No rows returned
    throw new Error(`Failed to fetch plan metadata: ${error.message}`);
  }

  return data as PlanMetadata;
}
