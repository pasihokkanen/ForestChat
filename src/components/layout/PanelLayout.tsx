"use client";

import { useState, useCallback, useRef } from "react";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { useForestStore } from "@/lib/store";
import PanelResizer from "./PanelResizer";

interface PanelLayoutProps {
  chartsPanel: React.ReactNode;
  mapPanel: React.ReactNode;
  chatPanel: React.ReactNode;
}

const STORAGE_KEY = "forestchat-panel-widths";

function loadWidths(): { charts: number; chat: number } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {
    // ignore
  }
  return { charts: 400, chat: 380 };
}

function saveWidths(charts: number, chat: number) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ charts, chat }));
  } catch {
    // ignore
  }
}

export default function PanelLayout({
  chartsPanel,
  mapPanel,
  chatPanel,
}: PanelLayoutProps) {
  const isLarge = useMediaQuery("(min-width: 1280px)");
  const isMedium = useMediaQuery("(min-width: 1024px)");
  const chartsFullscreen = useForestStore((s) => s.chartsFullscreen);
  const chartTabs = useForestStore((s) => s.chartTabs);

  const saved = useRef(loadWidths());
  const [chartsWidth, setChartsWidth] = useState(saved.current.charts);
  const [chatWidth, setChatWidth] = useState(saved.current.chat);
  const [chartsOpen, setChartsOpen] = useState(false);

  const handleChartsResize = useCallback((delta: number) => {
    setChartsWidth((w) => {
      const next = Math.max(280, Math.min(600, w + delta));
      saveWidths(next, useRef(loadWidths()).current.chat);
      return next;
    });
  }, []);

  const handleChatResize = useCallback((delta: number) => {
    setChatWidth((w) => {
      const next = Math.max(300, Math.min(500, w - delta));
      saveWidths(useRef(loadWidths()).current.charts, next);
      return next;
    });
  }, []);

  // Fullscreen charts — overlay entire viewport
  if (chartsFullscreen) {
    return (
      <div className="flex h-full">
        {mapPanel}
        {chatPanel}
        <div className="fixed inset-0 z-50 bg-white dark:bg-gray-900">
          {chartsPanel}
        </div>
      </div>
    );
  }

  // Large screen: 3-panel with resizers
  if (isLarge) {
    return (
      <div className="flex h-full">
        <div style={{ width: chartsWidth, flexShrink: 0 }}>
          {chartsPanel}
        </div>
        <PanelResizer onResize={handleChartsResize} />
        <div className="flex-1 relative min-w-0">
          {mapPanel}
        </div>
        <PanelResizer onResize={handleChatResize} />
        <div style={{ width: chatWidth, flexShrink: 0 }}>
          {chatPanel}
        </div>
      </div>
    );
  }

  // Medium screen: charts as collapsible bottom panel
  if (isMedium) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 relative min-w-0">{mapPanel}</div>
          <div className="w-[380px] border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shrink-0">
            {chatPanel}
          </div>
        </div>
        {chartsOpen && (
          <div className="h-[300px] border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
            {chartsPanel}
          </div>
        )}
        <button
          onClick={() => setChartsOpen(!chartsOpen)}
          className="absolute bottom-2 left-2 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full w-10 h-10 flex items-center justify-center shadow-md text-lg hover:bg-gray-50 dark:hover:bg-gray-700"
          title={chartsOpen ? "Hide charts" : "Show charts"}
        >
          📊
          {chartTabs.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
              {chartTabs.length}
            </span>
          )}
        </button>
      </div>
    );
  }

  // Small screen: map + chat, charts as toggle overlay
  return (
    <div className="flex h-full relative">
      <div className="flex-1 relative min-w-0">{mapPanel}</div>
      <div className="w-[380px] border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shrink-0">
        {chatPanel}
      </div>

      {chartsOpen && (
        <div className="fixed inset-0 z-40 bg-white dark:bg-gray-900">
          {chartsPanel}
        </div>
      )}

      <button
        onClick={() => setChartsOpen(!chartsOpen)}
        className="fixed bottom-4 left-4 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full w-12 h-12 flex items-center justify-center shadow-lg text-xl hover:bg-gray-50 dark:hover:bg-gray-700"
        title={chartsOpen ? "Close charts" : "Open charts"}
      >
        📊
        {chartTabs.length > 0 && (
          <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center">
            {chartTabs.length}
          </span>
        )}
      </button>
    </div>
  );
}