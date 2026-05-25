"use client";

import { useEffect } from "react";
import { useForestStore } from "@/lib/store";

/**
 * Fetches chart tabs for a forest from Supabase on mount and populates Zustand.
 * Charts persist across page reloads and devices.
 */
export function useCharts(forestId: string) {
  const setChartTabs = useForestStore((s) => s.setChartTabs);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/forest/${encodeURIComponent(forestId)}/charts`)
      .then((res) => res.json())
      .then((tabs) => {
        if (!cancelled && Array.isArray(tabs)) {
          setChartTabs(tabs);
        }
      })
      .catch(() => {
        // Silently fail — charts stay empty, user can ask AI to recreate
      });

    return () => {
      cancelled = true;
    };
  }, [forestId, setChartTabs]);
}