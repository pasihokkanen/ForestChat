// src/lib/repos/stand-wishes.ts
// Phase 7b (T7): CRUD operations for stand wishes (owner-defined constraints).

import type { SupabaseClient } from "@supabase/supabase-js";

export interface StandWish {
  id: string;
  forest_id: string;
  stand_id: string;
  wish_type: "delay_harvest" | "accelerate_harvest" | "no_clearcut" | "species_preference" | "retention_pct" | "custom";
  wish_value: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export async function getStandWishes(
  supabase: SupabaseClient,
  forestId: string,
  standId?: string,
): Promise<StandWish[]> {
  let query = supabase
    .from("stand_wishes")
    .select("*")
    .eq("forest_id", forestId);

  if (standId) {
    query = query.eq("stand_id", standId);
  }

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to fetch stand wishes: ${error.message}`);
  return (data as StandWish[]) ?? [];
}

export async function addStandWish(
  supabase: SupabaseClient,
  forestId: string,
  standId: string,
  wishType: StandWish["wish_type"],
  wishValue?: string,
  notes?: string,
): Promise<StandWish> {
  const { data, error } = await supabase
    .from("stand_wishes")
    .insert({
      forest_id: forestId,
      stand_id: standId,
      wish_type: wishType,
      wish_value: wishValue ?? null,
      notes: notes ?? null,
      created_by: "ai",
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to add stand wish: ${error.message}`);
  return data as StandWish;
}

export async function removeStandWish(
  supabase: SupabaseClient,
  wishId: string,
): Promise<void> {
  const { error } = await supabase
    .from("stand_wishes")
    .delete()
    .eq("id", wishId);

  if (error) throw new Error(`Failed to remove stand wish: ${error.message}`);
}
