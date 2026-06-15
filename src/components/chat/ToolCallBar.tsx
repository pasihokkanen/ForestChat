"use client";

import { useEffect, useRef, useState } from "react";
import type { ToolCallStatus } from "@/lib/store/chat-slice";
import { toolLabel, toolStatusLabel, type Language } from "@/lib/i18n";

interface ToolCallBarProps {
  toolCalls: ToolCallStatus[];
  language: Language;
}

function ToolChip({ tc, language }: { tc: ToolCallStatus; language: Language }) {
  const label = toolLabel(tc.name, language);
  const statusLabel = toolStatusLabel(tc.status, language);

  return (
    <div
      className={`shrink-0 rounded-md border text-xs max-w-[320px] ${
        tc.status === "error"
          ? "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400"
          : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
      }`}
    >
      {/* Header row: icon + name + status */}
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        {tc.status === "running" ? (
          <svg
            className="animate-spin h-3.5 w-3.5 text-blue-500 shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : tc.status === "done" ? (
          <svg className="h-3.5 w-3.5 text-green-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg className="h-3.5 w-3.5 text-red-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        )}
        <span className="font-medium truncate">{label}</span>
        <span className="text-[10px] opacity-70 shrink-0">{statusLabel}</span>
      </div>

      {/* Result body — shown when done or error */}
      {tc.result && (tc.status === "done" || tc.status === "error") && (
        <div
          className={`px-2 pb-2 text-[11px] whitespace-pre-wrap font-sans leading-relaxed border-t max-h-28 overflow-y-auto ${
            tc.status === "error"
              ? "border-red-200 dark:border-red-800 text-red-600 dark:text-red-400"
              : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400"
          }`}
        >
          {tc.result}
        </div>
      )}
    </div>
  );
}

export default function ToolCallBar({ toolCalls, language }: ToolCallBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Auto-scroll to front (start) when a new tool call is added
  useEffect(() => {
    if (scrollRef.current && toolCalls.length > 0) {
      scrollRef.current.scrollTo({ left: 0, behavior: "smooth" });
    }
  }, [toolCalls.length]);

  return (
    <div className="shrink-0 border-t border-gray-200/50 dark:border-gray-700/50 bg-white/70 dark:bg-gray-900/70 backdrop-blur-md">
      {toolCalls.length === 0 ? (
        <div className="px-3 py-1.5 text-[11px] text-gray-400 dark:text-gray-500">
          {mounted ? (language === "fi" ? "Valmiina…" : "Ready…") : "…"}
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="flex items-start gap-2 px-3 py-2 overflow-x-auto scrollbar-thin"
        >
          {toolCalls.map((tc) => (
            <ToolChip key={tc.id} tc={tc} language={language} />
          ))}
        </div>
      )}
    </div>
  );
}
