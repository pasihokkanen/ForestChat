"use client";

import { useEffect } from "react";
import { useForestStore } from "@/lib/store";

export function useCharts(forestIds: string[]) {
  const setChartTabs = useForestStore((s) => s.setChartTabs);
  const setActiveChartTab = useForestStore((s) => s.setActiveChartTab);
  const forestIdsKey = forestIds.join(",");

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/charts?forests=${encodeURIComponent(forestIdsKey)}`)
      .then((res) => res.json())
      .then((tabs) => {
        if (!cancelled && Array.isArray(tabs)) {
          setChartTabs(tabs);
          try {
            const saved = localStorage.getItem("forestchat_activeChart_" + forestIdsKey);
            if (saved && tabs.some((t: { id: string }) => t.id === saved)) {
              setActiveChartTab(saved);
            } else if (tabs.length > 0) {
              setActiveChartTab(tabs[tabs.length - 1].id);
            }
          } catch {
            if (tabs.length > 0) setActiveChartTab(tabs[tabs.length - 1].id);
          }
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [forestIdsKey, setChartTabs, setActiveChartTab]);
}
