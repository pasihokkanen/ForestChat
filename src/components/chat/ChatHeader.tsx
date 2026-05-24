"use client";

import { useForestStore } from "@/lib/store";

export default function ChatHeader() {
  const { activeModel } = useForestStore();

  return (
<div className="relative flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap">
          ForestChat
        </h2>
        <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
          · {activeModel}
        </span>
      </div>
    </div>
  );
}