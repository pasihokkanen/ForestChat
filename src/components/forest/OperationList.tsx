"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useForestStore } from "@/lib/store";
import { displayDevClass, displaySpecies, displayOp, operationListLabels } from "@/lib/i18n";
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

// Column keys — labels come from i18n
const OP_COLUMN_KEYS = [
  "colStand", "colType", "colYear", "colSpecies", "colArea",
  "colVolume", "colRemoval", "colIncome", "colCost", "colDevClass",
] as const;

const COL_KEY_TO_DATA: Record<string, string> = {
  colStand: "stand_id",
  colType: "type",
  colYear: "year",
  colSpecies: "species",
  colArea: "area_ha",
  colVolume: "volume_m3",
  colRemoval: "removal_pct",
  colIncome: "income_eur",
  colCost: "cost_eur",
  colDevClass: "development_class",
};

const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
function naturalCompare(a: unknown, b: unknown): number {
  return naturalCollator.compare(String(a ?? ""), String(b ?? ""));
}

// ── Module-level state so filter/sort survive tab switches ──
const opPersist = {
  sortKey: null as string | null,
  sortDir: "asc" as "asc" | "desc",
  yearFrom: null as number | null,
  yearTo: null as number | null,
  typeFilter: [] as string[],
  standFilter: "",
  speciesFilter: [] as string[],
  globalFilter: "",
  lastClickedStandId: null as string | null,
  scrollTop: 0,
};

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
  const language = useForestStore((s) => s.language) ?? "en";
  const L = operationListLabels(language);

  const compMap = useMemo(() => {
    const m = new Map<string, typeof compartments[0]>();
    for (const c of compartments) m.set(c.id, c);
    return m;
  }, [compartments]);

  const [yearFrom, setYearFromRaw] = useState<number | null>(opPersist.yearFrom);
  const setYearFrom = (v: number | null) => { opPersist.yearFrom = v; setYearFromRaw(v); };
  const [yearTo, setYearToRaw] = useState<number | null>(opPersist.yearTo);
  const setYearTo = (v: number | null) => { opPersist.yearTo = v; setYearToRaw(v); };

  const [typeFilter, setTypeFilterRaw] = useState<Set<string>>(
    () => new Set(opPersist.typeFilter)
  );
  const setTypeFilter: React.Dispatch<React.SetStateAction<Set<string>>> = (v) => {
    setTypeFilterRaw((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      opPersist.typeFilter = Array.from(next);
      return next;
    });
  };

  const [standFilter, setStandFilterRaw] = useState(opPersist.standFilter);
  const setStandFilter = (v: string) => { opPersist.standFilter = v; setStandFilterRaw(v); };

  const [speciesFilter, setSpeciesFilterRaw] = useState<Set<string>>(
    () => new Set(opPersist.speciesFilter)
  );
  const setSpeciesFilter: React.Dispatch<React.SetStateAction<Set<string>>> = (v) => {
    setSpeciesFilterRaw((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      opPersist.speciesFilter = Array.from(next);
      return next;
    });
  };

  const [globalFilter, setGlobalFilterRaw] = useState(opPersist.globalFilter);
  const setGlobalFilter = (v: string) => { opPersist.globalFilter = v; setGlobalFilterRaw(v); };

  const [sortKey, setSortKeyRaw] = useState<string | null>(opPersist.sortKey);
  const setSortKey = (k: string | null) => { opPersist.sortKey = k; setSortKeyRaw(k); };
  const [sortDir, setSortDirRaw] = useState<"asc" | "desc">(opPersist.sortDir);
  const setSortDir: React.Dispatch<React.SetStateAction<"asc" | "desc">> = (v) => {
    setSortDirRaw((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      opPersist.sortDir = next;
      return next;
    });
  };

  useEffect(() => {
    if (aiOperationFilters) {
      // Reset ALL filters first — each show_operations payload is a fresh set
      setYearFrom(null);
      setYearTo(null);
      setTypeFilter(new Set());
      setStandFilter("");
      setSpeciesFilter(new Set());

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

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && opPersist.scrollTop > 0) {
      el.scrollTop = opPersist.scrollTop;
    }
  }, []);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const standToOpIds = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const op of operations) {
      const comp = compMap.get(op.compartment_id);
      if (!comp) continue;
      const standId = comp.stand_id;
      const ids = map.get(standId);
      if (ids) ids.push(op.id);
      else map.set(standId, [op.id]);
    }
    return map;
  }, [operations, compMap]);

  const handleOperationRowClick = (standId: string, _operationId: string, event: React.MouseEvent) => {
    const ctrlKey = event.ctrlKey || event.metaKey;
    const shiftKey = event.shiftKey;
    const currentStands = useForestStore.getState().highlightedStandIds;
    const currentOps = useForestStore.getState().highlightedOperationIds;
    let newStandIds: string[];

    if (shiftKey && opPersist.lastClickedStandId) {
      const seen = new Set<string>();
      const orderedIds: string[] = [];
      for (const row of displayRows) {
        if (row.comp && !seen.has(row.comp.stand_id)) {
          seen.add(row.comp.stand_id);
          orderedIds.push(row.comp.stand_id);
        }
      }
      const lastIdx = orderedIds.indexOf(opPersist.lastClickedStandId);
      const currIdx = orderedIds.indexOf(standId);
      if (lastIdx !== -1 && currIdx !== -1) {
        const from = Math.min(lastIdx, currIdx);
        const to = Math.max(lastIdx, currIdx);
        newStandIds = orderedIds.slice(from, to + 1);
      } else {
        newStandIds = [standId];
      }
    } else if (ctrlKey) {
      if (currentStands.includes(standId)) {
        newStandIds = currentStands.filter((id) => id !== standId);
      } else {
        newStandIds = [...currentStands, standId];
      }
    } else {
      newStandIds = [standId];
    }

    opPersist.lastClickedStandId = standId;
    setHighlightedStands(newStandIds);

    let newOpIds: string[];
    if (ctrlKey) {
      const wasSelected = currentStands.includes(standId);
      if (wasSelected) {
        const removedOps = standToOpIds.get(standId) ?? [];
        const removedSet = new Set(removedOps);
        newOpIds = currentOps.filter((id) => !removedSet.has(id));
      } else {
        const addedOps = standToOpIds.get(standId) ?? [];
        newOpIds = [...currentOps, ...addedOps];
      }
    } else {
      const opSet = new Set<string>();
      for (const sid of newStandIds) {
        const ops = standToOpIds.get(sid);
        if (ops) for (const oid of ops) opSet.add(oid);
      }
      newOpIds = Array.from(opSet);
    }
    setHighlightedOperations(newOpIds);
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

  const displayRows = useMemo(() => {
    let filtered = operations.map((op) => {
      const comp = compMap.get(op.compartment_id);
      return { op, comp };
    });

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

    const SORT_KEYS = [sortKey, "colYear", "colType", "colStand"].filter(
      (k, i, arr) => k != null && arr.indexOf(k) === i
    ) as string[];

    const getSortVal = (row: typeof filtered[0], key: string): unknown => {
      const dataKey = COL_KEY_TO_DATA[key] ?? key;
      switch (dataKey) {
        case "stand_id": return row.comp?.stand_id ?? "";
        case "type": return row.op.type;
        case "year": return row.op.year;
        case "species": return row.comp?.main_species ?? "";
        case "area_ha": return row.comp?.area_ha ?? 0;
        case "volume_m3": return row.comp?.volume_m3 ?? 0;
        case "removal_pct": return row.op.removal_pct ?? 0;
        case "income_eur": return row.op.income_eur ?? 0;
        case "cost_eur": return row.op.cost_eur ?? 0;
        case "development_class": return row.comp?.development_class ?? "";
        default: return "";
      }
    };

    filtered.sort((a, b) => {
      for (const key of SORT_KEYS) {
        const aVal = getSortVal(a, key);
        const bVal = getSortVal(b, key);
        const cmp = typeof aVal === "number" && typeof bVal === "number"
          ? aVal - bVal
          : naturalCompare(aVal, bVal);
        if (cmp !== 0) {
          const dir = key === sortKey ? (sortDir === "asc" ? 1 : -1) : 1;
          return cmp * dir;
        }
      }
      return 0;
    });

    return filtered;
  }, [operations, compMap, yearFrom, yearTo, typeFilter, speciesFilter, standFilter, globalFilter, sortKey, sortDir]);

  if (operations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm gap-2">
        <p>{L.emptyNoOps}</p>
        <p>{L.emptyNoOpsHint}</p>
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
            placeholder={L.placeholderYearFrom}
            value={yearFrom ?? ""}
            onChange={(e) => setYearFrom(e.target.value ? Number(e.target.value) : null)}
            className="w-20 px-1.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
          />
          <span className="text-xs text-gray-400">–</span>
          <input
            type="number"
            placeholder={L.placeholderYearTo}
            value={yearTo ?? ""}
            onChange={(e) => setYearTo(e.target.value ? Number(e.target.value) : null)}
            className="w-20 px-1.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
          />

          {/* Type multi-select */}
          <div className="relative group">
            <button className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700">
              {L.filterType}{typeFilter.size > 0 ? ` (${typeFilter.size})` : " ▼"}
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
                  {displayOp(t, language)}
                </label>
              ))}
            </div>
          </div>

          {/* Species multi-select */}
          <div className="relative group">
            <button className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700">
              {L.filterSpecies}{speciesFilter.size > 0 ? ` (${speciesFilter.size})` : " ▼"}
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
                  {displaySpecies(s, language)}
                </label>
              ))}
            </div>
          </div>

          {/* Stand filter */}
          <input
            type="text"
            placeholder={L.placeholderStandId}
            value={standFilter}
            onChange={(e) => setStandFilter(e.target.value)}
            className="w-24 px-1.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
          />

          {/* Global search */}
          <input
            type="text"
            placeholder={L.placeholderSearch}
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 w-32"
          />

          {hasActiveFilters && (
            <button
              onClick={clearAllFilters}
              className="px-2 py-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
            >
              {L.clearAll}
            </button>
          )}
        </div>

        {/* Active filter chips */}
        {hasActiveFilters && (
          <div className="flex flex-wrap gap-1">
            {(yearFrom != null || yearTo != null) && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded">
                {L.chipYear}: {yearFrom ?? "?"}–{yearTo ?? "?"}
                <button onClick={() => { setYearFrom(null); setYearTo(null); }} className="ml-0.5 hover:text-red-500">✕</button>
              </span>
            )}
            {Array.from(typeFilter).map((t) => (
              <span key={`t-${t}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 rounded">
                {displayOp(t, language)}
                <button onClick={() => toggleFilter(setTypeFilter, t)} className="ml-0.5 hover:text-red-500">✕</button>
              </span>
            ))}
            {Array.from(speciesFilter).map((s) => (
              <span key={`sp-${s}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 rounded">
                {L.chipSpecies}: {displaySpecies(s, language)}
                <button onClick={() => toggleFilter(setSpeciesFilter, s)} className="ml-0.5 hover:text-red-500">✕</button>
              </span>
            ))}
            {standFilter && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 rounded">
                {L.chipStand}: {standFilter}
                <button onClick={() => setStandFilter("")} className="ml-0.5 hover:text-red-500">✕</button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      <div
        className="flex-1 overflow-auto min-h-0"
        ref={scrollRef}
        onScroll={(e) => { opPersist.scrollTop = (e.target as HTMLDivElement).scrollTop; }}
      >
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-100 dark:bg-gray-800 z-10">
            <tr>
              {OP_COLUMN_KEYS.map((colKey) => (
                <th
                  key={colKey}
                  className="px-2 py-1.5 text-left text-xs font-medium text-gray-600 dark:text-gray-400 cursor-pointer hover:text-gray-900 dark:hover:text-gray-200 select-none"
                  onClick={() => handleSort(colKey)}
                >
                  {(L as unknown as Record<string, string>)[colKey]}
                  {sortKey === colKey && (sortDir === "asc" ? " ▲" : " ▼")}
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
                  onClick={(e) => handleOperationRowClick(standId, op.id, e)}
                >
                  <td className="px-2 py-1 font-mono text-xs">{standId}</td>
                  <td className="px-2 py-1 text-xs">{displayOp(op.type, language)}</td>
                  <td className="px-2 py-1 text-right">{op.year}</td>
                  <td className="px-2 py-1">{displaySpecies(comp?.main_species ?? "", language) || "—"}</td>
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
                    {comp?.development_class ? displayDevClass(comp.development_class, language) : ""}
                  </td>
                  <td className="px-1 py-1 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleShowOnMap(standId); }}
                      className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                      title={L.showOnMap}
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
            {L.emptyNoMatch}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs text-gray-500 bg-gray-50 dark:bg-gray-800/50">
        {displayRows.length} {L.footerOps}
        {hasActiveFilters ? ` ${L.footerFilteredFrom} ${operations.length})` : ` / ${operations.length} ${L.footerTotal}`}
      </div>
    </div>
  );
}
