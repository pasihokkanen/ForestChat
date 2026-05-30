"use client";

import { useEffect } from "react";
import { useForestStore } from "@/lib/store";

/**
 * Fetches chart tabs for a forest from Supabase on mount and populates Zustand.
 * Charts persist across page reloads and devices.
 */
export function useCharts(forestId: string) {
  const setChartTabs = useForestStore((s) => s.setChartTabs);
  const setActiveChartTab = useForestStore((s) => s.setActiveChartTab);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/forest/${encodeURIComponent(forestId)}/charts`)
      .then((res) => res.json())
      .then((tabs) => {
        if (!cancelled && Array.isArray(tabs)) {
          setChartTabs(tabs);
          // Restore previously active chart tab from localStorage
          try {
            const saved = localStorage.getItem("forestchat_activeChart_" + forestId);
            if (saved && tabs.some((t: { id: string }) => t.id === saved)) {
              setActiveChartTab(saved);
            } else if (tabs.length > 0) {
              setActiveChartTab(tabs[tabs.length - 1].id);
            }
          } catch {
            // ignore localStorage errors
            if (tabs.length > 0) setActiveChartTab(tabs[tabs.length - 1].id);
          }
        }
      })
      .catch(() => {
        // Silently fail — charts stay empty, user can ask AI to recreate
      });

    return () => {
      cancelled = true;
    };
  }, [forestId, setChartTabs, setActiveChartTab]);
}