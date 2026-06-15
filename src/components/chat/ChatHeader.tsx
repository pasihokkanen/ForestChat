"use client";

import { useState, useEffect } from "react";
import { useForestStore } from "@/lib/store";
import { appName } from "@/lib/i18n";

export default function ChatHeader() {
  const { activeModel, language } = useForestStore();
  const lang = language ?? "en";
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  return (
<div className="relative flex items-center justify-between px-4 h-11 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-b from-gray-200 to-gray-100 dark:from-gray-700 dark:to-gray-900 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap">
          {mounted ? appName(lang) : "ForestChat"}
        </h2>
        <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
          · {activeModel}
        </span>
      </div>
    </div>
  );
}
