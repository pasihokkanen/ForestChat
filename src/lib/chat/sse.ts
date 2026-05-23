// src/lib/chat/sse.ts

/**
 * SSE event names used by the chat API:
 * - chunk: text delta from the AI response — { content: string }
 * - tool_start: AI requested a tool — { name: string, args: object }
 * - tool_end: tool execution complete — { name: string, result: string }
 * - done: entire response complete — { message_id: string, session_id: string, model?: string }
 *       (/new returns new session_id; /model returns updated model)
 * - error: an error occurred — { error: string }
 */

export interface SseEvent {
  event: "chunk" | "tool_start" | "tool_end" | "done" | "error";
  data: {
    content?: string;
    name?: string;
    args?: unknown;
    result?: string;
    message_id?: string;
    session_id?: string;
    model?: string | null;
    error?: string;
  };
}

export function createSseStream(): {
  stream: ReadableStream<Uint8Array>;
  send: (event: SseEvent) => void;
  close: () => void;
} {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      closed = true;
    },
  });

  const encoder = new TextEncoder();

  const send = (sseEvent: SseEvent) => {
    if (closed || !controller) return;
    try {
      const lines = [
        `event: ${sseEvent.event}`,
        `data: ${JSON.stringify(sseEvent.data)}`,
        "",
      ];
      controller.enqueue(encoder.encode(lines.join("\n")));
    } catch {
      closed = true;
    }
  };

  const close = () => {
    if (closed || !controller) return;
    try {
      controller.close();
    } catch {
      // ignore if already closed
    }
    closed = true;
  };

  return {
    stream,
    send,
    close,
  };
}
