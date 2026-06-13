"use client";

import { useState, useEffect, useRef } from "react";
import type { YearSnapshot } from "@/lib/ai/types";
import type { Language } from "@/lib/i18n";
import type { StandListLabels } from "@/lib/i18n";
import SimulationView from "./SimulationView";
import type { PlannedOpForView } from "./SimulationView";

interface SimulationApiLoaderProps {
  forestId: string;
  standId: string;
  operations: PlannedOpForView[];
  language: Language;
  labels: StandListLabels;
}

export default function SimulationApiLoader({
  forestId,
  standId,
  operations,
  language,
  labels,
}: SimulationApiLoaderProps) {
  const [snapshots, setSnapshots] = useState<YearSnapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetchingRef = useRef(false);

  useEffect(() => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    fetch(`/api/forest/${forestId}/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stand_id: standId }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setSnapshots(data.snapshots ?? null))
      .catch((e) => setError(e.message))
      .finally(() => {
        fetchingRef.current = false;
      });
  }, [forestId, standId]);

  if (error) {
    return (
      <div className="px-4 py-2 text-xs text-gray-400 italic">
        {labels.simNoData}
      </div>
    );
  }

  if (!snapshots) {
    return (
      <div className="px-4 py-2 text-xs text-gray-400 italic animate-pulse">
        Loading simulation…
      </div>
    );
  }

  return (
    <SimulationView
      standId={standId}
      simulationSnapshots={snapshots}
      operations={operations}
      language={language}
      labels={labels}
    />
  );
}
