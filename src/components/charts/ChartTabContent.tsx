"use client";

import type { ChartTab } from "@/lib/store/visualization-slice";
import { useForestStore } from "@/lib/store";
import ChartCard from "./ChartCard";

interface ChartTabContentProps {
  tab: ChartTab;
}

export default function ChartTabContent({ tab }: ChartTabContentProps) {
  const language = useForestStore((s) => s.language) ?? "en";
  const displayTitle = language === "fi" && tab.title_fi ? tab.title_fi : tab.title_en;
  return (
    <div className="w-full h-full">
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 px-1">
        {displayTitle}
      </h3>
      <div className="flex-1 min-h-0" style={{ height: "calc(100% - 2rem)" }}>
        <ChartCard tab={tab} />
      </div>
    </div>
  );
}
