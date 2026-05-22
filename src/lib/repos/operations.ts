import type { Operation } from "@/types/database";
import { createServerSupabase } from "@/lib/supabase/server";

export async function getOperationsByForest(
  forestId: string
): Promise<Operation[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("operations")
    .select("*")
    .eq("forest_id", forestId)
    .order("year", { ascending: true })
    .order("compartment_id", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch operations: ${error.message}`);
  }

  return (data as Operation[]) ?? [];
}

export async function getOperationsByYear(
  forestId: string,
  year: number
): Promise<Operation[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("operations")
    .select("*")
    .eq("forest_id", forestId)
    .eq("year", year);

  if (error) {
    throw new Error(`Failed to fetch operations: ${error.message}`);
  }

  return (data as Operation[]) ?? [];
}
