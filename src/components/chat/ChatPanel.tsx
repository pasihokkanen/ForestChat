"use client";

import { useCallback, useState } from "react";
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

  const handleSend = useCallback(
    async (message: string) => {
      if (!message.trim() || isStreaming) return;

      // Handle /new command
      if (message.trim() === "/new") {
        clearChat();
        return;
      }

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
        onToolEnd: (name, result) => {
          setToolCall({ name, status: "done", result });
        },
        onDone: (messageId, newSessionId, model) => {
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