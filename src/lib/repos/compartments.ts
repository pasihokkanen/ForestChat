import type { Compartment } from "@/types/database";
import { createServerSupabase } from "@/lib/supabase/server";

export async function getCompartmentsByForest(
  forestId: string
): Promise<Compartment[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("compartments")
    .select("*")
    .eq("forest_id", forestId)
    .order("stand_id");

  if (error) {
    throw new Error(`Failed to fetch compartments: ${error.message}`);
  }

  return (data as Compartment[]) ?? [];
}

export async function getCompartmentById(
  id: string
): Promise<Compartment | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("compartments")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // No rows returned
    throw new Error(`Failed to fetch compartment: ${error.message}`);
  }

  return data as Compartment;
}
