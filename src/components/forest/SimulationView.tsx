"use client";

import { useState, useMemo } from "react";
import type { YearSnapshot, StandSnapshot, SpeciesSnapshot } from "@/lib/ai/types";
import { displaySpecies, displayOp } from "@/lib/i18n";
import type { Language } from "@/lib/i18n";
import type { StandListLabels } from "@/lib/i18n";

/** Lightweight operation view model */
export interface PlannedOpForView {
  year: number;
  type: string;
  removalPct: number;
  incomeEur: number;
  costEur: number;
  notes: string;
}

interface SimulationViewProps {
  standId: string;
  simulationSnapshots: YearSnapshot[];
  operations: PlannedOpForView[];
  language: Language;
  labels: StandListLabels;
}

/** Color coding for operation categories */
function opColor(type: string): string {
  if (["clear_cut", "thinning", "first_thinning", "selection_cutting", "overstory_removal"].includes(type)) {
    return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
  }
  if (["early_tending", "tending"].includes(type)) {
    return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400";
  }
  return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
}

export default function SimulationView({
  standId,
  simulationSnapshots,
  operations,
  language,
  labels,
}: SimulationViewProps) {
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());

  // Group operations by year
  const opsByYear = useMemo(() => {
    const map = new Map<number, PlannedOpForView[]>();
    for (const op of operations) {
      if (!map.has(op.year)) map.set(op.year, []);
      map.get(op.year)!.push(op);
    }
    return map;
  }, [operations]);

  // Find the stand snapshot for each year
  const standByYear = useMemo(() => {
    const map = new Map<number, StandSnapshot>();
    for (const ys of simulationSnapshots) {
      const stand = ys.stands.find((s) => s.standId === standId);
      if (stand) map.set(ys.year, stand);
    }
    return map;
  }, [simulationSnapshots, standId]);

  // Determine which years to expand by default
  const defaultExpanded = useMemo(() => {
    const expanded = new Set<number>();
    for (const ys of simulationSnapshots) {
      // Year 0 (pre-simulation) — always expanded
      if (ys.year < simulationSnapshots[1]?.year) expanded.add(ys.year);
      // Year 1 — always expanded
      if (ys.year === simulationSnapshots[1]?.year) expanded.add(ys.year);
      // Years with operations
      if (opsByYear.has(ys.year)) expanded.add(ys.year);
    }
    return expanded;
  }, [simulationSnapshots, opsByYear]);

  // Merge default expanded with user toggles
  const effectiveExpanded = useMemo(() => {
    const merged = new Set(defaultExpanded);
    for (const y of expandedYears) merged.add(y);
    return merged;
  }, [defaultExpanded, expandedYears]);

  const toggleYear = (year: number) => {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  const startYear = simulationSnapshots[1]?.year ?? 0;
  const endYear = simulationSnapshots[simulationSnapshots.length - 1]?.year ?? 0;

  return (
    <div className="px-4 py-2">
      <div className="text-xs font-semibold text-gray-500 mb-2">
        {labels.simHeader} ({startYear}–{endYear})
      </div>

      {simulationSnapshots.map((ys) => {
        const stand = standByYear.get(ys.year);
        if (!stand) return null;

        const yearOps = opsByYear.get(ys.year) ?? [];
        const isExpanded = effectiveExpanded.has(ys.year);
        const isYear0 = ys.year < startYear;

        // Filter active species: only show species with stemCountPerHa > 0
        const activeSpecies = stand.speciesData.filter((sp) => sp.stemCountPerHa > 0);

        return (
          <div key={ys.year} className="mb-1 border border-gray-200 dark:border-gray-700 rounded">
            {/* Year header */}
            <button
              onClick={() => toggleYear(ys.year)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-t transition-colors"
            >
              <span className="text-gray-400 w-3 text-center">
                {isExpanded ? "▼" : "▶"}
              </span>
              <span className="font-medium text-gray-700 dark:text-gray-300">
                {isYear0
                  ? `${labels.simYearLabel} ${ys.year} (${labels.simCurrentState.toLowerCase()})`
                  : `${labels.simYearLabel} ${ys.year}`}
              </span>
              {yearOps.length > 0 && (
                <span className="text-gray-400">— {yearOps.length} op{yearOps.length > 1 ? "s" : ""}</span>
              )}
            </button>

            {isExpanded && (
              <div className="border-t border-gray-100 dark:border-gray-800 px-3 py-1.5 space-y-1.5">
                {/* Operation badges */}
                {yearOps.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1">
                    {yearOps.map((op, i) => (
                      <span
                        key={i}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${opColor(op.type)}`}
                      >
                        {displayOp(op.type, language)}
                        {op.removalPct > 0 && ` −${op.removalPct}%`}
                        {op.incomeEur > 0 && ` +${Math.round(op.incomeEur).toLocaleString()} €`}
                        {op.costEur > 0 && ` −${Math.round(op.costEur).toLocaleString()} €`}
                      </span>
                    ))}
                  </div>
                )}

                {/* Aggregate stand state */}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-500 dark:text-gray-400 pl-3">
                  <span>Vol: <span className="text-gray-700 dark:text-gray-300 font-medium">{Math.round(stand.volumeM3).toLocaleString()} m³</span></span>
                  <span>{labels.colBA}: <span className="text-gray-700 dark:text-gray-300 font-medium">{(stand.basalArea ?? 0).toFixed(1)}</span></span>
                  <span>{labels.colStems}: <span className="text-gray-700 dark:text-gray-300 font-medium">{(stand.stemCount ?? 0).toLocaleString()}</span></span>
                  <span>{labels.colHeight}: <span className="text-gray-700 dark:text-gray-300 font-medium">{(stand.meanHeight ?? 0).toFixed(1)}</span></span>
                  <span>{labels.colDiameter}: <span className="text-gray-700 dark:text-gray-300 font-medium">{(stand.meanDiameter ?? 0).toFixed(1)}</span></span>
                  <span>{labels.colAge}: <span className="text-gray-700 dark:text-gray-300 font-medium">{stand.ageYears}</span></span>
                </div>

                {/* Per-species breakdown */}
                {activeSpecies.length > 0 && (
                  <div className="space-y-0.5 pl-3">
                    {activeSpecies.map((sp, i) => (
                      <div key={i} className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-gray-400 dark:text-gray-500">
                        <span className="font-medium text-gray-500 dark:text-gray-400 w-16">{displaySpecies(sp.species, language)}</span>
                        <span>Vol: {Math.round(sp.volumeM3).toLocaleString()} m³</span>
                        <span>BA: {sp.basalArea.toFixed(1)}</span>
                        <span>Stems: {sp.stemCountPerHa.toLocaleString()}</span>
                        <span>H: {sp.meanHeight.toFixed(1)}</span>
                        <span>D: {sp.meanDiameter.toFixed(1)}</span>
                        <span>Age: {sp.age}</span>
                        <span>Log: {sp.logPct != null ? `${sp.logPct}%` : "—"}</span>
                        <span>{labels.colArea}: {sp.areaHa.toFixed(1)} ha</span>
                      </div>
                    ))}
                  </div>
                )}

                {activeSpecies.length === 0 && (
                  <div className="text-[10px] text-gray-400 italic pl-3">
                    No species data
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
