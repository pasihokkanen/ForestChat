import type { ChatSession } from "@/types/database";
import { createServerSupabase } from "@/lib/supabase/server";

export async function getOrCreateSession(
  forestId: string,
  userId: string,
  title?: string
): Promise<ChatSession> {
  const supabase = await createServerSupabase();

  // Check for existing active session
  const { data: existing } = await supabase
    .from("chat_sessions")
    .select("*")
    .eq("forest_id", forestId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (existing) {
    return existing as ChatSession;
  }

  // Create new session
  const { data, error } = await supabase
    .from("chat_sessions")
    .insert({
      forest_id: forestId,
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

/** Create a fresh session (used by /new command) */
export async function createSession(
  forestId: string,
  userId: string,
  title?: string,
  model?: string
): Promise<ChatSession> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("chat_sessions")
    .insert({
      forest_id: forestId,
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
