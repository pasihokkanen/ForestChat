import type { ChatSession } from "@/types/database";
import { createServerSupabase } from "@/lib/supabase/server";

/** Get the user's most recent session or create one with forest_id = NULL.
 *  Forest context now comes from the Zustand store's activeForestIds (Decision D1),
 *  NOT from the session row. */
export async function getOrCreateSession(
  userId: string,
  title?: string
): Promise<ChatSession> {
  const supabase = await createServerSupabase();

  // Check for existing session — user-scoped, no forest_id filter
  const { data: existing } = await supabase
    .from("chat_sessions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (existing) {
    return existing as ChatSession;
  }

  // Create new session — user-scoped, forest_id = null
  const { data, error } = await supabase
    .from("chat_sessions")
    .insert({
      forest_id: null,
      user_id: userId,
      title: title ?? "Forest Plan Chat",
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create session: ${error.message}`);
  return data as ChatSession;
}

export async function getSessionById(
  sessionId: string
): Promise<ChatSession | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("chat_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(`Failed to fetch session: ${error.message}`);
  }
  return data as ChatSession;
}

/** Create a fresh session (used by /new command). User-scoped, forest_id = null. */
export async function createSession(
  userId: string,
  title?: string,
  model?: string
): Promise<ChatSession> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("chat_sessions")
    .insert({
      forest_id: null,
      user_id: userId,
      title: title ?? "Forest Plan Chat",
      model: model ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to create session: ${error.message}`);
  return data as ChatSession;
}

/** Update the model for a session (used by /model command) */
export async function updateSessionModel(
  sessionId: string,
  model: string
): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("chat_sessions")
    .update({ model })
    .eq("id", sessionId);
  if (error) throw new Error(`Failed to update model: ${error.message}`);
}
