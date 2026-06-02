"use client";

import { useState, useMemo, useEffect } from "react";
import { useForestStore } from "@/lib/store";
import { displayOperationType } from "@/lib/ai/config";
import type maplibregl from "maplibre-gl";

interface OperationListProps {
  map: maplibregl.Map | null;
}

const OP_TYPE_OPTIONS = [
  "clear_cut", "thinning", "first_thinning", "selection_cutting",
  "site_prep", "spruce_planting", "pine_planting", "tending", "early_tending",
] as const;

const SPECIES_OPTIONS = [
  "pine", "spruce", "silver_birch", "downy_birch", "larch", "grey_alder",
] as const;

const OP_COLUMNS = [
  { key: "stand_id", label: "Stand" },
  { key: "type", label: "Type" },
  { key: "year", label: "Year" },
  { key: "species", label: "Species" },
  { key: "area_ha", label: "Area (ha)" },
  { key: "volume_m3", label: "Vol. (m³)" },
  { key: "removal_pct", label: "Removal %" },
  { key: "income_eur", label: "Income (€)" },
  { key: "cost_eur", label: "Cost (€)" },
  { key: "development_class", label: "Dev. Class" },
] as const;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDisplayDevClass(dc: string): string {
  return dc
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function OperationList({ map }: OperationListProps) {
  const operations = useForestStore((s) => s.operations);
  const compartments = useForestStore((s) => s.compartments);
  const highlightedStandIds = useForestStore((s) => s.highlightedStandIds);
  const highlightedOperationIds = useForestStore((s) => s.highlightedOperationIds);
  const setHighlightedStands = useForestStore((s) => s.setHighlightedStands);
  const setHighlightedOperations = useForestStore((s) => s.setHighlightedOperations);
  const selectStand = useForestStore((s) => s.selectStand);
  const setActiveMainTab = useForestStore((s) => s.setActiveMainTab);
  const setPendingStandSelection = useForestStore((s) => s.setPendingStandSelection);
  const aiOperationFilters = useForestStore((s) => s.aiOperationFilters);

  // Build compartment lookup map
  const compMap = useMemo(() => {
    const m = new Map<string, typeof compartments[0]>();
    for (const c of compartments) m.set(c.id, c);
    return m;
  }, [compartments]);

  // Filters
  const [yearFrom, setYearFrom] = useState<number | null>(null);
  const [yearTo, setYearTo] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [standFilter, setStandFilter] = useState("");
  const [speciesFilter, setSpeciesFilter] = useState<Set<string>>(new Set());
  const [globalFilter, setGlobalFilter] = useState("");

  // Sort state
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Apply AI-pushed filters
  useEffect(() => {
    if (aiOperationFilters) {
      const f = aiOperationFilters as Record<string, unknown>;
      if (Array.isArray(f.years) && f.years.length > 0) {
        const yrs = f.years as number[];
        setYearFrom(Math.min(...yrs));
        setYearTo(Math.max(...yrs));
      }
      if (Array.isArray(f.types)) setTypeFilter(new Set(f.types as string[]));
      if (Array.isArray(f.stand_ids) && f.stand_ids.length > 0) {
        setStandFilter((f.stand_ids as string[]).join(", "));
      }
      if (Array.isArray(f.species)) setSpeciesFilter(new Set(f.species as string[]));
    }
  }, [aiOperationFilters]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const handleOperationRowClick = (standId: string, operationId: string) => {
    setHighlightedStands([standId]);
    selectStand(standId);
    setHighlightedOperations([operationId]);
  };

  const handleShowOnMap = (standId: string) => {
    if (map) {
      selectStand(standId);
      setHighlightedStands([standId]);
    } else {
      setPendingStandSelection(standId);
    }
    setActiveMainTab("map");
  };

  const toggleFilter = (setter: (fn: (s: Set<string>) => Set<string>) => void, value: string) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const hasActiveFilters = yearFrom != null || yearTo != null || typeFilter.size > 0 ||
    standFilter !== "" || speciesFilter.size > 0 || globalFilter !== "";

  const clearAllFilters = () => {
    setYearFrom(null);
    setYearTo(null);
    setTypeFilter(new Set());
    setStandFilter("");
    setSpeciesFilter(new Set());
    setGlobalFilter("");
  };

  // Build filtered + sorted display rows
  const displayRows = useMemo(() => {
    let filtered = operations.map((op) => {
      const comp = compMap.get(op.compartment_id);
      return { op, comp };
    });

    // Apply filters
    if (yearFrom != null) filtered = filtered.filter((r) => r.op.year >= yearFrom);
    if (yearTo != null) filtered = filtered.filter((r) => r.op.year <= yearTo);
    if (typeFilter.size > 0) filtered = filtered.filter((r) => typeFilter.has(r.op.type));
    if (speciesFilter.size > 0 && compMap.size > 0) {
      filtered = filtered.filter((r) => r.comp && speciesFilter.has(r.comp.main_species ?? ""));
    }
    if (standFilter) {
      const standIds = standFilter.split(",").map((s) => s.trim()).filter(Boolean);
      if (standIds.length > 0) {
        filtered = filtered.filter((r) => r.comp && standIds.includes(r.comp.stand_id));
      }
    }
    if (globalFilter) {
      const lower = globalFilter.toLowerCase();
      filtered = filtered.filter((r) => {
        const comp = r.comp;
        return (
          r.op.type.toLowerCase().includes(lower) ||
          String(r.op.year).includes(lower) ||
          (comp?.stand_id ?? "").toLowerCase().includes(lower) ||
          (comp?.main_species ?? "").toLowerCase().includes(lower) ||
          (comp?.development_class ?? "").toLowerCase().includes(lower)
        );
      });
    }

    // Sort
    if (sortKey) {
      filtered.sort((a, b) => {
        let aVal: unknown, bVal: unknown;
        switch (sortKey) {
          case "stand_id":
            aVal = a.comp?.stand_id ?? "";
            bVal = b.comp?.stand_id ?? "";
            break;
          case "type":
            aVal = a.op.type;
            bVal = b.op.type;
            break;
          case "year":
            aVal = a.op.year;
            bVal = b.op.year;
            break;
          case "species":
            aVal = a.comp?.main_species ?? "";
            bVal = b.comp?.main_species ?? "";
            break;
          case "area_ha":
            aVal = a.comp?.area_ha ?? 0;
            bVal = b.comp?.area_ha ?? 0;
            break;
          case "volume_m3":
            aVal = a.comp?.volume_m3 ?? 0;
            bVal = b.comp?.volume_m3 ?? 0;
            break;
          case "removal_pct":
            aVal = a.op.removal_pct ?? 0;
            bVal = b.op.removal_pct ?? 0;
            break;
          case "income_eur":
            aVal = a.op.income_eur ?? 0;
            bVal = b.op.income_eur ?? 0;
            break;
          case "cost_eur":
            aVal = a.op.cost_eur ?? 0;
            bVal = b.op.cost_eur ?? 0;
            break;
          case "development_class":
            aVal = a.comp?.development_class ?? "";
            bVal = b.comp?.development_class ?? "";
            break;
          default:
            return 0;
        }
        const cmp = typeof aVal === "number" && typeof bVal === "number"
          ? aVal - bVal
          : String(aVal).localeCompare(String(bVal));
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    return filtered;
  }, [operations, compMap, yearFrom, yearTo, typeFilter, speciesFilter, standFilter, globalFilter, sortKey, sortDir]);

  if (operations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm gap-2">
        <p>No operations found.</p>
        <p>Ask the AI to generate a forest management plan to see operations here.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      {/* Filter bar */}
      <div className="shrink-0 border-b border-gray-200 dark:border-gray-700 p-2 space-y-2 bg-gray-50 dark:bg-gray-800/50">
        <div className="flex flex-wrap gap-2 items-center">
          {/* Year range */}
          <input
            type="number"
            placeholder="Year from"
            value={yearFrom ?? ""}
            onChange={(e) => setYearFrom(e.target.value ? Number(e.target.value) : null)}
            className="w-20 px-1.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
          />
          <span className="text-xs text-gray-400">–</span>
          <input
            type="number"
            placeholder="Year to"
            value={yearTo ?? ""}
            onChange={(e) => setYearTo(e.target.value ? Number(e.target.value) : null)}
            className="w-20 px-1.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
          />

          {/* Type multi-select */}
          <div className="relative group">
            <button className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700">
              Type {typeFilter.size > 0 ? `(${typeFilter.size})` : "▼"}
            </button>
            <div className="absolute top-full left-0 mt-1 z-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg p-1 hidden group-hover:block min-w-[200px]">
              {OP_TYPE_OPTIONS.map((t) => (
                <label key={t} className="flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={typeFilter.has(t)}
                    onChange={() => toggleFilter(setTypeFilter, t)}
                    className="h-3 w-3"
                  />
                  {displayOperationType(t)}
                </label>
              ))}
            </div>
          </div>

          {/* Species multi-select */}
          <div className="relative group">
            <button className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700">
              Species {speciesFilter.size > 0 ? `(${speciesFilter.size})` : "▼"}
            </button>
            <div className="absolute top-full left-0 mt-1 z-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg p-1 hidden group-hover:block min-w-[160px]">
              {SPECIES_OPTIONS.map((s) => (
                <label key={s} className="flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={speciesFilter.has(s)}
                    onChange={() => toggleFilter(setSpeciesFilter, s)}
                    className="h-3 w-3"
                  />
                  {capitalize(s)}
                </label>
              ))}
            </div>
          </div>

          {/* Stand filter */}
          <input
            type="text"
            placeholder="Stand ID"
            value={standFilter}
            onChange={(e) => setStandFilter(e.target.value)}
            className="w-24 px-1.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
          />

          {/* Global search */}
          <input
            type="text"
            placeholder="🔍 Search..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 w-32"
          />

          {hasActiveFilters && (
            <button
              onClick={clearAllFilters}
              className="px-2 py-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Active filter chips */}
        {hasActiveFilters && (
          <div className="flex flex-wrap gap-1">
            {(yearFrom != null || yearTo != null) && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded">
                Year: {yearFrom ?? "?"}–{yearTo ?? "?"}
                <button onClick={() => { setYearFrom(null); setYearTo(null); }} className="ml-0.5 hover:text-red-500">✕</button>
              </span>
            )}
            {Array.from(typeFilter).map((t) => (
              <span key={`t-${t}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 rounded">
                {displayOperationType(t)}
                <button onClick={() => toggleFilter(setTypeFilter, t)} className="ml-0.5 hover:text-red-500">✕</button>
              </span>
            ))}
            {Array.from(speciesFilter).map((s) => (
              <span key={`sp-${s}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 rounded">
                Species: {capitalize(s)}
                <button onClick={() => toggleFilter(setSpeciesFilter, s)} className="ml-0.5 hover:text-red-500">✕</button>
              </span>
            ))}
            {standFilter && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 rounded">
                Stand: {standFilter}
                <button onClick={() => setStandFilter("")} className="ml-0.5 hover:text-red-500">✕</button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-100 dark:bg-gray-800 z-10">
            <tr>
              {OP_COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className="px-2 py-1.5 text-left text-xs font-medium text-gray-600 dark:text-gray-400 cursor-pointer hover:text-gray-900 dark:hover:text-gray-200 select-none"
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}
                  {sortKey === col.key && (sortDir === "asc" ? " ▲" : " ▼")}
                </th>
              ))}
              <th className="w-16 px-1 py-1.5 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map(({ op, comp }) => {
              const standId = comp?.stand_id ?? "";
              const isStandHighlighted = highlightedStandIds.includes(standId);
              const isOpHighlighted = highlightedOperationIds.includes(op.id);
              const isHighlighted = isStandHighlighted || isOpHighlighted;

              return (
                <tr
                  key={op.id}
                  className={`cursor-pointer border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
                    isHighlighted ? "bg-blue-50 dark:bg-blue-900/20" : ""
                  }`}
                  onClick={() => handleOperationRowClick(standId, op.id)}
                >
                  <td className="px-2 py-1 font-mono text-xs">{standId}</td>
                  <td className="px-2 py-1 text-xs">{displayOperationType(op.type)}</td>
                  <td className="px-2 py-1 text-right">{op.year}</td>
                  <td className="px-2 py-1">{capitalize(comp?.main_species ?? "")}</td>
                  <td className="px-2 py-1 text-right">{(comp?.area_ha ?? 0).toFixed(1)}</td>
                  <td className="px-2 py-1 text-right">{Math.round(comp?.volume_m3 ?? 0).toLocaleString()}</td>
                  <td className="px-2 py-1 text-right">
                    {op.removal_pct != null ? `${op.removal_pct}%` : "—"}
                  </td>
                  <td className="px-2 py-1 text-right text-green-600 dark:text-green-400">
                    {op.income_eur != null && op.income_eur !== 0
                      ? `+${Math.round(op.income_eur).toLocaleString()}`
                      : ""}
                  </td>
                  <td className="px-2 py-1 text-right text-orange-600 dark:text-orange-400">
                    {op.cost_eur != null && op.cost_eur !== 0
                      ? `−${Math.round(op.cost_eur).toLocaleString()}`
                      : ""}
                  </td>
                  <td className="px-2 py-1 text-xs">
                    {comp?.development_class ? formatDisplayDevClass(comp.development_class) : ""}
                  </td>
                  <td className="px-1 py-1 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleShowOnMap(standId);
                      }}
                      className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                      title="Show on map"
                    >
                      📍
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {displayRows.length === 0 && hasActiveFilters && (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
            No operations match the current filters.
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs text-gray-500 bg-gray-50 dark:bg-gray-800/50">
        {displayRows.length} operations
        {hasActiveFilters ? ` (filtered from ${operations.length})` : ` / ${operations.length} total`}
      </div>
    </div>
  );
}
