"use client";

import { useCallback, useEffect, useState } from "react";
import { streamChat as sseStreamChat } from "@/lib/chat/sse-client";
import { useForestStore } from "@/lib/store";
import ChatHeader from "./ChatHeader";
import ChatMessages from "./ChatMessages";
import ChatInput from "./ChatInput";

interface ChatPanelProps {
  forestId: string;
}

export default function ChatPanel({ forestId }: ChatPanelProps) {
  const {
    messages,
    isStreaming,
    streamingContent,
    toolCallStatus,
    sessionId,
    activeModel,
    error,
    addMessage,
    setMessages,
    appendStreamContent,
    clearStream,
    setStreaming,
    setToolCall,
    setSessionId,
    setActiveModel,
    setError,
    clearChat,
    triggerRefetch,
  } = useForestStore();

  // Load existing conversation on mount
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingHistory(true);
        const res = await fetch(`/api/chat?forest_id=${encodeURIComponent(forestId)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (data.session_id) setSessionId(data.session_id);
        if (data.model) setActiveModel(data.model);
        if (data.messages?.length > 0) setMessages(data.messages);
      } catch {
        // Silently fail — chat will start fresh if fetch fails
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => { cancelled = true; };
  }, [forestId, setSessionId, setActiveModel, setMessages]);

  const handleSend = useCallback(
    async (message: string) => {
      if (!message.trim() || isStreaming) return;

      // Add user message
      addMessage({
        id: `temp-${Date.now()}`,
        session_id: sessionId ?? "",
        role: "user",
        content: message,
        tool_calls: null,
        created_at: new Date().toISOString(),
      });

      setStreaming(true);
      clearStream();
      setError(null);

      await sseStreamChat(message, forestId, sessionId, {
        onChunk: (text) => {
          appendStreamContent(text);
        },
        onToolStart: (name, args) => {
          setToolCall({ name, status: "running" });
        },
        onToolEnd: (name, result, error) => {
          setToolCall({ name, status: error ? "error" : "done", result: error || result });
        },
        onDone: (messageId, newSessionId, model) => {
          // /new command creates a fresh session — clear old messages
          if (newSessionId && newSessionId !== sessionId) {
            const greeting = useForestStore.getState().streamingContent;
            clearChat();
            // Re-add the greeting from /new if present
            if (greeting) {
              addMessage({
                id: `greeting-${Date.now()}`,
                session_id: newSessionId,
                role: "assistant",
                content: greeting,
                tool_calls: null,
                created_at: new Date().toISOString(),
              });
            }
            clearStream();
            setStreaming(false);
            setToolCall(null);
            setSessionId(newSessionId);
            if (model) setActiveModel(model);
            return;
          }

          // Finalize streaming content as a proper message
          const content = useForestStore.getState().streamingContent;
          if (content) {
            addMessage({
              id: messageId || `stream-${Date.now()}`,
              session_id: newSessionId,
              role: "assistant",
              content,
              tool_calls: null,
              created_at: new Date().toISOString(),
            });
          }
          clearStream();
          setStreaming(false);
          setToolCall(null);
          if (newSessionId) setSessionId(newSessionId);
          if (model) setActiveModel(model);
          // Trigger data refetch after plan operations
          triggerRefetch();
        },
        onError: (err) => {
          setError(err);
          setStreaming(false);
          setToolCall(null);
        },
      });
    },
    [
      forestId,
      sessionId,
      isStreaming,
      addMessage,
      appendStreamContent,
      clearStream,
      setStreaming,
      setToolCall,
      setSessionId,
      setActiveModel,
      setError,
      clearChat,
      triggerRefetch,
    ]
  );

  return (
    <div className="flex flex-col h-full bg-white">
      <ChatHeader />
      <ChatMessages
        messages={messages}
        streamingContent={streamingContent}
        toolCallStatus={toolCallStatus}
        error={error}
      />
      <ChatInput onSend={handleSend} disabled={isStreaming} />
    </div>
  );
}