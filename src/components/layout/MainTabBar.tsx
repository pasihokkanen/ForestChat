"use client";

import { useForestStore } from "@/lib/store";
import type { MainTab } from "@/lib/store/tab-slice";

const TAB_DEFS: { id: MainTab; label: string; icon: string }[] = [
  { id: "map", label: "Map", icon: "🗺️" },
  { id: "stands", label: "Stands", icon: "🌲" },
  { id: "operations", label: "Operations", icon: "🪓" },
];

export default function MainTabBar() {
  const activeMainTab = useForestStore((s) => s.activeMainTab);
  const setActiveMainTab = useForestStore((s) => s.setActiveMainTab);

  return (
    <div className="flex items-center border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 shrink-0">
      {TAB_DEFS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveMainTab(tab.id)}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm border-r border-gray-200 dark:border-gray-700 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${
            activeMainTab === tab.id
              ? "bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 font-medium border-b-2 border-b-blue-600 dark:border-b-blue-400"
              : "text-gray-600 dark:text-gray-400"
          }`}
          aria-current={activeMainTab === tab.id ? "page" : undefined}
        >
          <span className="text-base">{tab.icon}</span>
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
