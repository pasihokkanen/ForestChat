"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { useForestStore } from "@/lib/store";
import PanelResizer from "./PanelResizer";
import MainTabBar from "./MainTabBar";

interface PanelLayoutTabs {
  map: React.ReactNode;
  stands: React.ReactNode;
  operations: React.ReactNode;
}

interface PanelLayoutProps {
  chartsPanel: React.ReactNode;
  tabs: PanelLayoutTabs;
}

const STORAGE_KEY = "forestchat-panel-widths";

function loadWidths(): { charts: number } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {
    // ignore
  }
  return { charts: 400 };
}

function saveWidths(charts: number) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ charts }));
  } catch {
    // ignore
  }
}

/** Tiny component that subscribes to chartTabs.length for the badge — keeps PanelLayout stable. */
function ChartBadgeButton({
  onClick,
  title,
  className,
}: {
  onClick: () => void;
  title: string;
  className: string;
}) {
  const count = useForestStore((s) => s.chartTabs.length);
  return (
    <button onClick={onClick} className={className} title={title}>
      📊
      {count > 0 && (
        <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
          {count}
        </span>
      )}
    </button>
  );
}

function TabContainer({ tabs }: { tabs: PanelLayoutTabs }) {
  const activeMainTab = useForestStore((s) => s.activeMainTab);

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      <MainTabBar />
      <div className="flex-1 relative min-h-0">
        {/* Map tab — always mounted, fade between tabs */}
        <div className={`absolute inset-0 transition-opacity duration-200 ${activeMainTab === "map" ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
          {tabs.map}
        </div>
        {/* Stands tab */}
        {activeMainTab === "stands" && (
          <div className="h-full animate-fadeIn">{tabs.stands}</div>
        )}
        {/* Operations tab */}
        {activeMainTab === "operations" && (
          <div className="h-full animate-fadeIn">{tabs.operations}</div>
        )}
      </div>
    </div>
  );
}

export default function PanelLayout({
  chartsPanel,
  tabs,
}: PanelLayoutProps) {
  const isLarge = useMediaQuery("(min-width: 1280px)");
  const isMedium = useMediaQuery("(min-width: 1024px)");
  const chartsFullscreen = useForestStore((s) => s.chartsFullscreen);

  const savedWidths = useRef(loadWidths());
  const [chartsWidth, setChartsWidth] = useState(savedWidths.current.charts);
  const [chartsOpen, setChartsOpen] = useState(false);

  // Persist widths when they change
  useEffect(() => {
    saveWidths(chartsWidth);
  }, [chartsWidth]);

  const handleChartsResize = useCallback((delta: number) => {
    setChartsWidth((w) => Math.max(280, Math.min(600, w + delta)));
  }, []);

  // Large screen: 2-panel with resizer
  if (isLarge) {
    return (
      <div className="h-full relative">
        <div className="flex h-full">
          {/* Charts panel — hidden via CSS when fullscreen, stays in tree */}
          <div
            className={`shrink-0 ${chartsFullscreen ? "hidden" : ""}`}
            style={{ width: chartsWidth }}
          >
            {chartsPanel}
          </div>
          {/* Chart-map resizer — always rendered, hidden via CSS when fullscreen */}
          <div className={chartsFullscreen ? "hidden" : "contents"}>
            <PanelResizer onResize={handleChartsResize} />
          </div>
          {/* Tab container with map, stands, operations */}
          <TabContainer tabs={tabs} />

          {/* Fullscreen charts overlay */}
          {chartsFullscreen && (
            <div className="fixed inset-0 z-50 bg-white dark:bg-gray-900">
              {chartsPanel}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Medium screen: charts as collapsible bottom panel, toggle button
  if (isMedium) {
    return (
      <div className="h-full relative">
        <div className="flex flex-col h-full">
          <div className="flex-1 min-h-0">
            <TabContainer tabs={tabs} />
          </div>
          {chartsOpen && !chartsFullscreen && (
            <div className="h-[300px] border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              {chartsPanel}
            </div>
          )}

          {/* Fullscreen charts overlay */}
          {chartsFullscreen && (
            <div className="fixed inset-0 z-50 bg-white dark:bg-gray-900">
              {chartsPanel}
            </div>
          )}

          {!chartsFullscreen && (
            <ChartBadgeButton
              onClick={() => setChartsOpen(!chartsOpen)}
              title={chartsOpen ? "Hide charts" : "Show charts"}
              className="absolute bottom-2 left-2 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full w-10 h-10 flex items-center justify-center shadow-md text-lg hover:bg-gray-50 dark:hover:bg-gray-700"
            />
          )}
        </div>
      </div>
    );
  }

  // Small screen: map with charts as toggle overlay
  return (
    <div className="h-full relative">
      <div className={`h-full ${chartsFullscreen ? "hidden" : ""}`}>
        <TabContainer tabs={tabs} />
      </div>

      {/* Fullscreen charts overlay */}
      {chartsFullscreen && (
        <div className="fixed inset-0 z-50 bg-white dark:bg-gray-900">
          {chartsPanel}
        </div>
      )}

      {!chartsFullscreen && (
        <>
          {chartsOpen && (
            <div className="fixed inset-0 z-40 bg-white dark:bg-gray-900">
              {chartsPanel}
            </div>
          )}

          <ChartBadgeButton
            onClick={() => setChartsOpen(!chartsOpen)}
            title={chartsOpen ? "Close charts" : "Open charts"}
            className="fixed bottom-4 left-4 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full w-12 h-12 flex items-center justify-center shadow-lg text-xl hover:bg-gray-50 dark:hover:bg-gray-700"
          />
        </>
      )}
    </div>
  );
}
