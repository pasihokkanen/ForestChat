"use client";

import { useEffect } from "react";
import { useForestStore } from "@/lib/store";
import ChartTabBar from "./ChartTabBar";
import ChartCard from "./ChartCard";

export default function ChartsPanel() {
  const chartTabs = useForestStore((s) => s.chartTabs);
  const activeChartTab = useForestStore((s) => s.activeChartTab);
  const removeChartTab = useForestStore((s) => s.removeChartTab);
  const setActiveChartTab = useForestStore((s) => s.setActiveChartTab);
  const chartsFullscreen = useForestStore((s) => s.chartsFullscreen);
  const setChartsFullscreen = useForestStore((s) => s.setChartsFullscreen);
  const forest = useForestStore((s) => s.forest);

  const activeTab = chartTabs.find((t) => t.id === activeChartTab);

  // Escape key exits fullscreen
  useEffect(() => {
    if (!chartsFullscreen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setChartsFullscreen(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [chartsFullscreen, setChartsFullscreen]);

  const handleClose = async (chartId: string) => {
    if (forest?.id) {
      try {
        await fetch(
          `/api/forest/${encodeURIComponent(forest.id)}/charts?chart_id=${encodeURIComponent(chartId)}`,
          { method: "DELETE" }
        );
      } catch {
        // Silently fail — chart will reappear on next page load if DB delete failed
      }
    }
    removeChartTab(chartId);
  };

  return (
    <div
      className={`flex flex-col h-full bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 ${
        chartsFullscreen ? "" : ""
      }`}
    >
      <ChartTabBar
        tabs={chartTabs.map((t) => ({ id: t.id, title: t.title }))}
        activeId={activeChartTab}
        onSelect={setActiveChartTab}
        onClose={handleClose}
        onFullscreenToggle={() => setChartsFullscreen(!chartsFullscreen)}
        isFullscreen={chartsFullscreen}
      />
      <div className="flex-1 p-2 overflow-hidden">
        {activeTab ? (
          <ChartCard key={activeTab.id} tab={activeTab} />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500 text-sm">
            <div className="text-center">
              <div className="text-3xl mb-2">📊</div>
              <p>No charts yet</p>
              <p className="text-xs mt-1">
                Ask the AI to create a chart,
                <br />
                e.g. &ldquo;Show me yearly income as a bar chart&rdquo;
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}