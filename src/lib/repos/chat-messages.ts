import type { ChatMessage } from "@/types/database";
import { createServerSupabase } from "@/lib/supabase/server";

export async function getMessagesBySession(
  sessionId: string
): Promise<ChatMessage[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to fetch messages: ${error.message}`);
  return (data as ChatMessage[]) ?? [];
}

export async function addMessage(
  sessionId: string,
  role: "user" | "assistant" | "tool",
  content: string,
  toolCalls?: unknown
): Promise<ChatMessage> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      session_id: sessionId,
      role,
      content,
      tool_calls: toolCalls ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to add message: ${error.message}`);
  return data as ChatMessage;
}
