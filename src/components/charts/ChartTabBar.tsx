"use client";

import { useForestStore } from "@/lib/store";

interface ChartTabBarProps {
  tabs: { id: string; title: string }[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onFullscreenToggle: () => void;
  isFullscreen: boolean;
}

export default function ChartTabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onFullscreenToggle,
  isFullscreen,
}: ChartTabBarProps) {
  return (
    <div className="flex items-center border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 shrink-0">
      <div className="flex-1 flex overflow-x-auto scrollbar-hide">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            className={`flex items-center gap-1 px-3 py-2 text-xs border-r border-gray-200 dark:border-gray-700 whitespace-nowrap shrink-0 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
              activeId === tab.id
                ? "bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 font-medium border-b-2 border-b-blue-600 dark:border-b-blue-400"
                : "text-gray-600 dark:text-gray-400"
            }`}
          >
            <span className="truncate max-w-[120px]">{tab.title}</span>
            <span
              className="ml-0.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 cursor-pointer flex-shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              title="Close chart"
            >
              ×
            </span>
          </button>
        ))}
      </div>

      <button
        onClick={onFullscreenToggle}
        className="px-2 py-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0 border-l border-gray-200 dark:border-gray-700"
        title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
      >
        {isFullscreen ? "⛶" : "⛶"}
      </button>
    </div>
  );
}