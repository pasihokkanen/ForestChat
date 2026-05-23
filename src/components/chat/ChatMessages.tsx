"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage as ChatMessageType } from "@/types/database";
import ChatMessage from "./ChatMessage";
import ToolCallCard from "./ToolCallCard";

interface ChatMessagesProps {
  messages: ChatMessageType[];
  streamingContent: string;
  toolCallStatus: {
    name: string;
    status: "running" | "done" | "error";
    result?: string;
  } | null;
  error: string | null;
}

export default function ChatMessages({
  messages,
  streamingContent,
  toolCallStatus,
  error,
}: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new content or streaming content arrives
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const isStreaming = streamingContent.length > 0;

  return (
    <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
      {messages.length === 0 && !isStreaming && !error && (
        <div className="flex flex-col items-center justify-center h-full text-center text-gray-400">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="mb-3 text-gray-300"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <p className="text-sm">Ask about your forest plan</p>
          <p className="text-xs mt-1">
            Try: &quot;Generate a plan&quot; or &quot;Show me stand 7&quot;
          </p>
        </div>
      )}

      {messages
        .filter((m) => m.role !== "tool")
        .map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

      {/* Tool call card */}
      {toolCallStatus && (
        <ToolCallCard
          name={toolCallStatus.name}
          status={toolCallStatus.status}
          result={toolCallStatus.result}
        />
      )}

      {/* Streaming content */}
      {isStreaming && (
        <div className="flex justify-start">
          <div className="max-w-[85%] rounded-2xl px-4 py-2.5 bg-white border border-gray-200 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
            {streamingContent}
            <span className="inline-block w-2 h-4 bg-blue-500 ml-0.5 animate-pulse rounded-sm" />
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="flex justify-center">
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-xs text-red-700 max-w-full">
            ⚠️ {error}
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}