"use client";

import { useEffect, useState } from "react";
import { useForestStore } from "@/lib/store";
import { persistActiveTab } from "@/lib/store/visualization-slice";
import { chartEmptyTitle, chartEmptyTip } from "@/lib/i18n";
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
  const language = useForestStore((s) => s.language) ?? "en";
  const activeForestIds = useForestStore((s) => s.activeForestIds);
  const setChartTabs = useForestStore((s) => s.setChartTabs);
  const [mounted, setMounted] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  useEffect(() => { queueMicrotask(() => setMounted(true)); }, []);

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

  useEffect(() => {
    const ids = activeForestIds;
    if (!ids || ids.length === 0) return;

    let cancelled = false;

    (async () => {
      setRecomputing(true);
      try {
        await fetch("/api/charts/recompute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ forestIds: ids }),
        });

        if (cancelled) return;

        const res = await fetch(`/api/charts?forests=${encodeURIComponent(ids.join(","))}`);
        const tabs = await res.json();

        if (!cancelled && Array.isArray(tabs)) {
          setChartTabs(tabs);
        }
      } catch {
        // silently fail — chart tabs remain as they were
      } finally {
        if (!cancelled) setRecomputing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeForestIds, setChartTabs]);

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
      className={`flex flex-col h-full bg-gradient-to-b from-gray-100 to-white dark:from-gray-800 dark:to-gray-950 ${
        chartsFullscreen ? "" : ""
      }`}
    >
      <ChartTabBar
        tabs={chartTabs.map((t) => ({ id: t.id, title_en: t.title_en, title_fi: t.title_fi }))}
        activeId={activeChartTab}
        onSelect={(id) => {
          setActiveChartTab(id);
          if (forest?.id) persistActiveTab(forest.id, id);
        }}
        onClose={handleClose}
        onFullscreenToggle={() => setChartsFullscreen(!chartsFullscreen)}
        isFullscreen={chartsFullscreen}
      />
      {activeTab && (
        <div className="px-3 py-3 text-sm font-bold text-center text-gray-800 dark:text-gray-200 border-b border-gray-200 dark:border-gray-700 shrink-0 bg-gray-50 dark:bg-gray-800/50">
          {activeTab.title_fi && language === "fi" ? activeTab.title_fi : activeTab.title_en}
        </div>
      )}
      <div className="flex-1 p-2 overflow-hidden relative" style={{ minHeight: 200 }}>
        {recomputing && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 dark:bg-gray-900/70 z-10">
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {mounted ? (language === "fi" ? "Lasketaan..." : "Recomputing...") : "Recomputing..."}
            </div>
          </div>
        )}
        {activeTab ? (
          <div key={activeTab.id} className="h-full animate-fadeIn"><ChartCard tab={activeTab} /></div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500 text-sm animate-fadeIn">
            <div className="text-center">
              <div className="text-3xl mb-2">📊</div>
              <p>{mounted ? chartEmptyTitle(language) : "No charts yet"}</p>
              <p className="text-xs mt-1">
                {mounted ? chartEmptyTip(language) : 'Ask the AI to create a chart,\ne.g. "Show me yearly income as a bar chart"'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}