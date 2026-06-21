"use client";

import { useForestStore } from "@/lib/store";
import { dashboardLabels } from "@/lib/i18n";
import Link from "next/link";

interface ForestSelectorProps {
  className?: string;
}

export default function ForestSelector({ className }: ForestSelectorProps) {
  const forests = useForestStore((s) => s.forests);
  const activeForestIds = useForestStore((s) => s.activeForestIds);
  const toggleActiveForest = useForestStore((s) => s.toggleActiveForest);
  const compartments = useForestStore((s) => s.compartments);
  const language = useForestStore((s) => s.language) ?? "en";
  const L = dashboardLabels(language);

  return (
    <div className={`flex flex-col h-full bg-gradient-to-b from-white dark:from-gray-950 to-gray-50 dark:to-gray-900 ${className ?? ""}`}>
      <div className="px-4 py-3.5 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest">
            {L.myForests}
          </h2>
          <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 rounded-full px-2 py-0.5 min-w-[22px] text-center">
            {forests.length}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {forests.length === 0 && (
          <div className="text-center py-8 px-4">
            <p className="text-xs text-gray-400 dark:text-gray-500">{L.noForests}</p>
          </div>
        )}
        {forests.map((forest) => {
          const isActive = activeForestIds.includes(forest.id);
          const standCount = compartments.filter((c) => c.forest_id === forest.id).length;

          return (
            <button
              key={forest.id}
              onClick={() => toggleActiveForest(forest.id)}
              className={`w-full text-left rounded-lg px-3 py-2.5 transition-all duration-150 ${
                isActive
                  ? "bg-green-50 dark:bg-green-900/20 ring-1 ring-green-200 dark:ring-green-800/50 shadow-sm"
                  : "hover:bg-white dark:hover:bg-gray-900/50 hover:shadow-sm"
              }`}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors ${
                    isActive
                      ? "bg-green-600 dark:bg-green-500 text-white"
                      : "bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600"
                  }`}
                >
                  {isActive && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm font-medium truncate ${
                      isActive ? "text-green-900 dark:text-green-100" : "text-gray-700 dark:text-gray-300"
                    }`}
                  >
                    {forest.name}
                  </p>
                  <div className="flex gap-2 mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">
                    {forest.total_area_ha != null && (
                      <span>{Math.round(forest.total_area_ha).toLocaleString()} ha</span>
                    )}
                    {forest.municipality && <span>{forest.municipality}</span>}
                    {standCount > 0 && <span>{standCount} stands</span>}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="p-3 border-t border-gray-200 dark:border-gray-800">
        <Link
          href="/forest/new"
          className="w-full rounded-lg bg-green-700 dark:bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-800 dark:hover:bg-green-700 transition-colors flex items-center justify-center gap-1.5"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 2.5V11.5M2.5 7H11.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          {L.importForest}
        </Link>
      </div>
    </div>
  );
}
