"use client";

import { useCallback, useEffect, useState } from "react";
import { streamChat as sseStreamChat } from "@/lib/chat/sse-client";
import type { ShowInUiPayload } from "@/lib/chat/sse-client";
import { useForestStore } from "@/lib/store";
import type { MainTab } from "@/lib/store/tab-slice";
import ChatHeader from "./ChatHeader";
import ChatMessages from "./ChatMessages";
import ChatInput from "./ChatInput";
import ToolCallBar from "./ToolCallBar";

interface ChatPanelProps {
  forestId: string;
}

export default function ChatPanel({ forestId }: ChatPanelProps) {
  const {
    messages,
    isStreaming,
    streamingContent,
    toolCalls,
    sessionId,
    activeModel,
    error,
    language,
    addMessage,
    setMessages,
    appendStreamContent,
    clearStream,
    setStreaming,
    addToolCall,
    updateToolCall,
    clearToolCalls,
    setSessionId,
    setActiveModel,
    setError,
    clearChat,
    triggerRefetch,
    selectStand,
    setHighlightedStands,
    addChartTab,
    removeChartTab,
    clearAllCharts,
    setChartTabs,
    setActiveMainTab,
    setAiStandFilters,
    setAiOperationFilters,
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

      // Clear AI-pushed filters from previous prompts — each message starts fresh
      useForestStore.getState().setAiStandFilters(null);
      useForestStore.getState().setAiOperationFilters(null);

      // Clear previous tool call indicators — each message starts fresh
      useForestStore.getState().clearToolCalls();

      setStreaming(true);
      clearStream();
      setError(null);

      await sseStreamChat(message, forestId, sessionId, language ?? "en", {
        onChunk: (text) => {
          appendStreamContent(text);
        },
        onToolStart: (id, name) => {
          addToolCall({ id, name, status: "running" });
        },
        onToolEnd: (id, name, result, error) => {
          updateToolCall(id, { status: error ? "error" : "done", result: error || result });
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
            clearToolCalls();
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
          clearToolCalls;
          if (newSessionId) setSessionId(newSessionId);
          if (model) setActiveModel(model);
          // Trigger data refetch after plan operations
          triggerRefetch();
        },
        onError: (err) => {
          setError(err);
          setStreaming(false);
          clearToolCalls;
        },
        onSelectStand: (standIds) => {
          setHighlightedStands(standIds);
        },
        onCreateChart: (chartConfig) => {
          addChartTab(chartConfig as unknown as Parameters<typeof addChartTab>[0]);
        },
        onRemoveChart: (chartId) => {
          removeChartTab(chartId);
        },
        onClearCharts: () => {
          clearAllCharts();
        },
        onChartsRefreshed: async (chartIds) => {
          // Re-fetch all chart tabs to get recomputed data from DB
          try {
            const res = await fetch(`/api/forest/${encodeURIComponent(forestId)}/charts`);
            const freshTabs = await res.json();
            if (Array.isArray(freshTabs)) {
              setChartTabs(freshTabs);
            }
          } catch {
            // Silently fail — charts will update on next page load
          }
        },
        onShowInUi: (payload: ShowInUiPayload) => {
          // Switch to the target tab
          setActiveMainTab(payload.target as MainTab);

          if (payload.target === "stands") {
            if (payload.standIds?.length) {
              setHighlightedStands(payload.standIds);
            }
            if (payload.filters) {
              setAiStandFilters(payload.filters);
            }
          }

          if (payload.target === "operations" && payload.filters) {
            setAiOperationFilters(payload.filters);
          }
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
      addToolCall,
      updateToolCall,
      clearToolCalls,
      setSessionId,
      setActiveModel,
      setError,
      clearChat,
      triggerRefetch,
      selectStand,
      addChartTab,
      removeChartTab,
      clearAllCharts,
      setChartTabs,
    ]
  );

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-950">
      <ChatHeader />
      <ChatMessages
        messages={messages}
        streamingContent={streamingContent}
        isStreaming={isStreaming}
        toolCalls={toolCalls}
        error={error}
      />
      <ToolCallBar toolCalls={toolCalls} language={language ?? "en"} />
      <ChatInput onSend={handleSend} disabled={isStreaming} />
    </div>
  );
}