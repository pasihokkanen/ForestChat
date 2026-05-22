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

export async function deleteForestById(
  id: string
): Promise<{ deleted: boolean; forest?: Forest }> {
  const supabase = await createServerSupabase();

  // 1. Verify ownership
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: forest } = await supabase
    .from("forests")
    .select("*")
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();

  if (!forest) {
    return { deleted: false };
  }

  // 2. Delete (cascades to compartments, boundaries, operations, plans, chats)
  const { error } = await supabase.from("forests").delete().eq("id", id);

  if (error) {
    throw new Error(`Failed to delete forest: ${error.message}`);
  }

  return { deleted: true, forest: forest as Forest };
}
