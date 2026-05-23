"use client";

import { useEffect, useRef } from "react";
import { useForestStore } from "@/lib/store";
import CommandsMenu from "./CommandsMenu";

export default function ChatHeader() {
  const { activeModel, commandsOpen, toggleCommands } = useForestStore();
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on click outside
  useEffect(() => {
    if (!commandsOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        if (useForestStore.getState().commandsOpen) {
          useForestStore.getState().toggleCommands();
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [commandsOpen]);

  return (
    <div className="relative flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <h2 className="text-sm font-semibold text-gray-900 whitespace-nowrap">
          ForestChat
        </h2>
        <span className="text-xs text-gray-500 truncate">
          · {activeModel}
        </span>
      </div>
      <button
        onClick={toggleCommands}
        className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-gray-200 text-gray-600 transition-colors"
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

      {commandsOpen && (
        <div ref={menuRef}>
          <CommandsMenu />
        </div>
      )}
    </div>
  );
}