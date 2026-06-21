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
import FileUploadBar from "./FileUploadBar";

export default function GlobalChatPanel() {
  const {
    activeForestIds,
    forests,
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
    setActiveForests,
  } = useForestStore();

  const firstActiveId = activeForestIds[0] ?? null;

  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    if (!firstActiveId) {
      setLoadingHistory(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoadingHistory(true);
        const res = await fetch(`/api/chat?forest_id=${encodeURIComponent(firstActiveId)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (data.session_id) setSessionId(data.session_id);
        if (data.model) setActiveModel(data.model);
        if (data.messages?.length > 0) setMessages(data.messages);
      } catch {
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => { cancelled = true; };
  }, [firstActiveId, setSessionId, setActiveModel, setMessages]);

  const handleSend = useCallback(
    async (message: string) => {
      if (!message.trim() || isStreaming) return;
      if (!firstActiveId) return;

      addMessage({
        id: `temp-${Date.now()}`,
        session_id: sessionId ?? "",
        role: "user",
        content: message,
        tool_calls: null,
        created_at: new Date().toISOString(),
      });

      useForestStore.getState().setAiStandFilters(null);
      useForestStore.getState().setAiOperationFilters(null);
      useForestStore.getState().clearToolCalls();

      setStreaming(true);
      clearStream();
      setError(null);

      await sseStreamChat(message, firstActiveId, sessionId, language ?? "en", {
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
          if (newSessionId && newSessionId !== sessionId) {
            const greeting = useForestStore.getState().streamingContent;
            clearChat();
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
          if (!firstActiveId) return;
          try {
            const res = await fetch(`/api/forest/${encodeURIComponent(firstActiveId)}/charts`);
            const freshTabs = await res.json();
            if (Array.isArray(freshTabs)) {
              setChartTabs(freshTabs);
            }
          } catch {
          }
        },
        onShowInUi: (payload: ShowInUiPayload) => {
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
        onOpenForest: (forestId) => {
          const state = useForestStore.getState();
          const ids = new Set(state.activeForestIds);
          ids.add(forestId);
          state.setActiveForests(Array.from(ids));
        },
        onCloseForest: (forestId) => {
          const state = useForestStore.getState();
          state.setActiveForests(state.activeForestIds.filter(id => id !== forestId));
        },
      });
    },
    [
      firstActiveId,
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

  const activeForestNames = activeForestIds
    .map((id) => forests.find((f) => f.id === id)?.name ?? id)
    .join(", ");

  if (activeForestIds.length === 0) {
    return (
      <div className="flex flex-col h-full bg-gradient-to-b from-gray-100 to-white dark:from-gray-800 dark:to-gray-950">
        <ChatHeader />
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground text-sm">
          <div className="text-center space-y-2 mb-4">
            <div className="text-3xl">🌲</div>
            <p>Activate a forest to start chatting</p>
          </div>
          <div className="w-full max-w-md px-3">
            <FileUploadBar language={language ?? "en"} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-gray-100 to-white dark:from-gray-800 dark:to-gray-950">
      <ChatHeader />
      <div className="px-3 py-1 text-xs text-muted-foreground bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 shrink-0 truncate">
        🌲 {activeForestNames}
      </div>
      <ChatMessages
        messages={messages}
        streamingContent={streamingContent}
        isStreaming={isStreaming}
        toolCalls={toolCalls}
        error={error}
      />
      <ToolCallBar toolCalls={toolCalls} language={language ?? "en"} />
      <ChatInput onSend={handleSend} disabled={isStreaming || !firstActiveId} />
      <FileUploadBar language={language ?? "en"} />
    </div>
  );
}
