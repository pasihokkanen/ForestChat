// src/lib/chat/sse-client.ts — Browser-side SSE parser

export type SseEventType =
  | "chunk"
  | "tool_start"
  | "tool_end"
  | "done"
  | "error"
  | "select_stand"
  | "create_chart"
  | "remove_chart"
  | "clear_charts"
  | "charts_refreshed"
  | "show_in_ui";

export interface ShowInUiPayload {
  target: "stands" | "operations";
  standIds?: string[];
  filters?: Record<string, unknown>;
}

interface SseCallbacks {
  onChunk?: (text: string) => void;
  onToolStart?: (name: string, args: Record<string, unknown>) => void;
  onToolEnd?: (name: string, result: string, error?: string) => void;
  onDone?: (messageId: string, sessionId: string, model?: string | null) => void;
  onError?: (error: string) => void;
  onSelectStand?: (standIds: string[]) => void;
  onCreateChart?: (chartConfig: Record<string, unknown>) => void;
  onRemoveChart?: (chartId: string) => void;
  onClearCharts?: () => void;
  onChartsRefreshed?: (chartIds: string[]) => void;
  onShowInUi?: (payload: ShowInUiPayload) => void;
}

export async function streamChat(
  message: string,
  forestId: string,
  sessionId: string | null,
  language: string,
  callbacks: SseCallbacks
): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, forest_id: forestId, session_id: sessionId, language }),
  });

  if (!response.ok) {
    const text = await response.text();
    callbacks.onError?.(text);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    callbacks.onError?.("No response body");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    let currentEvent = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          switch (currentEvent) {
            case "chunk":
              callbacks.onChunk?.(data.content);
              break;
            case "tool_start":
              callbacks.onToolStart?.(data.name, data.args);
              break;
            case "tool_end":
              callbacks.onToolEnd?.(data.name, data.result, data.error);
              break;
            case "done":
              callbacks.onDone?.(data.message_id, data.session_id, data.model);
              break;
            case "error":
              callbacks.onError?.(data.error);
              break;
            case "select_stand": {
              const ids = data.stand_ids as string[] ?? (data.stand_id ? [data.stand_id as string] : []);
              callbacks.onSelectStand?.(ids);
              break;
            }
            case "create_chart":
              callbacks.onCreateChart?.(data);
              break;
            case "remove_chart":
              callbacks.onRemoveChart?.(data.chart_id as string);
              break;
            case "clear_charts":
              callbacks.onClearCharts?.();
              break;
            case "charts_refreshed":
              callbacks.onChartsRefreshed?.(data.chart_ids as string[] ?? []);
              break;
            case "show_in_ui":
              callbacks.onShowInUi?.(data as ShowInUiPayload);
              break;
          }
        } catch {
          // skip unparseable JSON
        }
      }
    }
  }
}
