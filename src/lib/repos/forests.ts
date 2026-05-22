import type { Forest } from "@/types/database";
import { createServerSupabase } from "@/lib/supabase/server";

export async function getForestById(id: string): Promise<Forest | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("forests")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // No rows returned
    throw new Error(`Failed to fetch forest: ${error.message}`);
  }

  return data as Forest;
}

export async function getForestsByOwner(): Promise<Forest[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("forests")
    .select("*")
    .order("name");

  if (error) {
    throw new Error(`Failed to fetch forests: ${error.message}`);
  }

  return (data as Forest[]) ?? [];
}
