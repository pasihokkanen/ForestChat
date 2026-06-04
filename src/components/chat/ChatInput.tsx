"use client";

import { useState, useRef, useCallback, useEffect, KeyboardEvent } from "react";
import { useForestStore } from "@/lib/store";
import CommandsMenu from "./CommandsMenu";

const PLACEHOLDERS = [
  "Ask about your forest plan...",
  "Show me stands ready for harvest",
  "Create a yearly income bar chart",
  "Generate a 20-year forest management plan",
  "Show species distribution as a pie chart",
  "Compare growth vs harvest volume",
  "List all clearcuts in the plan",
  "Summarize the current plan",
];

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled: boolean;
}

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const { commandsOpen, toggleCommands } = useForestStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cmdBtnRef = useRef<HTMLDivElement>(null);

  // Randomize start index and rotate placeholder every 4 seconds (client-only)
  useEffect(() => {
    setPlaceholderIdx(Math.floor(Math.random() * PLACEHOLDERS.length));
    const interval = setInterval(() => {
      setPlaceholderIdx((prev) => (prev + 1) % PLACEHOLDERS.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Re-focus textarea when streaming finishes (disabled → enabled)
  const prevDisabled = useRef(disabled);
  useEffect(() => {
    if (prevDisabled.current && !disabled) {
      // disabled just turned false — focus the textarea
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
    prevDisabled.current = disabled;
  }, [disabled]);

  // Auto-grow textarea up to 4 lines
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = 20; // approx line height in px
    const maxHeight = lineHeight * 4;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    if (el.scrollHeight > maxHeight) {
      el.style.overflowY = "auto";
    } else {
      el.style.overflowY = "hidden";
    }
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    // Reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleSend();
      }
      // Ctrl+Enter / Cmd+Enter always sends
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleInsertCommand = useCallback((text: string) => {
    setValue(text);
    // Focus the textarea and put cursor at end
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        const len = text.length;
        el.setSelectionRange(len, len);
        // Trigger height adjust for the new content
        adjustHeight();
      }
    });
  }, [adjustHeight]);

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-3 bg-white dark:bg-gray-900 shrink-0">
      <div className="flex items-end gap-2">
        {/* Commands button — left side */}
        <div ref={cmdBtnRef} className="relative shrink-0">
          <button
            onClick={toggleCommands}
            className="flex items-center justify-center w-9 h-9 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
            title="Commands"
            aria-label="Toggle commands menu"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          {/* Commands dropdown — above the button */}
          {commandsOpen && (
            <div className="absolute bottom-full left-0 mb-2">
              <CommandsMenu onInsertCommand={handleInsertCommand} />
            </div>
          )}
        </div>

        <textarea
          ref={textareaRef}
          data-chat-input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            adjustHeight();
          }}
          onKeyDown={handleKeyDown}
          placeholder={PLACEHOLDERS[placeholderIdx]}
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none rounded-xl border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-800 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ minHeight: "36px", maxHeight: "80px" }}
        />
        <button
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
          title="Send"
          aria-label="Send message"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 px-1">
        Enter to send · Shift+Enter for new line · Ctrl+Enter to send
      </p>
    </div>
  );
}