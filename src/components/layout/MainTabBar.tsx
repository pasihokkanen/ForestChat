"use client";

import { useState, useEffect } from "react";
import { useForestStore } from "@/lib/store";
import type { MainTab } from "@/lib/store/tab-slice";
import { tabLabel } from "@/lib/i18n";

const TAB_DEFS: { id: MainTab; icon: string }[] = [
  { id: "map", icon: "🗺️" },
  { id: "stands", icon: "🌲" },
  { id: "operations", icon: "🪓" },
];

export default function MainTabBar() {
  const activeMainTab = useForestStore((s) => s.activeMainTab);
  const setActiveMainTab = useForestStore((s) => s.setActiveMainTab);
  const language = useForestStore((s) => s.language) ?? "en";
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  return (
    <div className="flex items-center h-11 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-b from-gray-100 to-gray-50 dark:from-gray-800 dark:to-gray-800/50 shrink-0">
      {TAB_DEFS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveMainTab(tab.id)}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-t-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${
            activeMainTab === tab.id
              ? "bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 font-medium border-b-2 border-b-blue-600 dark:border-b-blue-400"
              : "text-gray-600 dark:text-gray-400"
          }`}
          aria-current={activeMainTab === tab.id ? "page" : undefined}
        >
          <span className="text-base">{tab.icon}</span>
          <span>{mounted ? tabLabel(tab.id, language) : tab.id.charAt(0).toUpperCase() + tab.id.slice(1)}</span>
        </button>
      ))}
    </div>
  );
}
