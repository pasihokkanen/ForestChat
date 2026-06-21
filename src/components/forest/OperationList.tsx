"use client";

import { useState, useMemo, useEffect, useRef, useTransition } from "react";
import { useForestStore } from "@/lib/store";
import { displayDevClass, displaySpecies, displayOp, operationListLabels } from "@/lib/i18n";
import { List } from "react-window";
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
  "colForest", "colStand", "colType", "colYear", "colAge", "colSpecies", "colArea",
  "colVolume", "colStems", "colHeight", "colDiameter",
  "colRemoval", "colIncome", "colCost", "colDevClass",
] as const;

const COL_KEY_TO_DATA: Record<string, string> = {
  colStand: "stand_id",
  colForest: "forest_id",
  colType: "type",
  colYear: "year",
  colAge: "age_years",
  colSpecies: "species",
  colArea: "area_ha",
  colVolume: "volume_m3",
  colStems: "stem_count_per_ha",
  colHeight: "mean_height",
  colDiameter: "mean_diameter",
  colRemoval: "removal_pct",
  colIncome: "income_eur",
  colCost: "cost_eur",
  colDevClass: "development_class",
};

const COL_WIDTHS: Record<string, number> = {
  colForest: 100,
  colStand: 60, colType: 120, colYear: 55, colAge: 45,
  colSpecies: 90, colArea: 55, colVolume: 70, colStems: 55,
  colHeight: 45, colDiameter: 45, colRemoval: 55, colIncome: 70,
  colCost: 70, colDevClass: 120,
};

function OperationRow({
  index,
  style,
  rows,
  highlightedStandIds,
  highlightedOperationIds,
  onRowClick,
  onShowOnMap,
  language,
  showOnMapLabel,
  forestNameMap,
  showForestColumn,
}: {
  index: number;
  style: React.CSSProperties;
  rows: Record<string, unknown>[];
  highlightedStandIds: string[];
  highlightedOperationIds: string[];
  onRowClick: (standId: string, opId: string, e: React.MouseEvent) => void;
  onShowOnMap: (standId: string) => void;
  language: string;
  showOnMapLabel: string;
  forestNameMap: Map<string, string>;
  showForestColumn: boolean;
}) {
  const row = rows[index];
  const standId = String(row._standId ?? "");
  const isHighlighted = highlightedStandIds.includes(standId) || highlightedOperationIds.includes(String(row._opId ?? ""));

  return (
    <div
      style={style}
      className={`flex items-center cursor-pointer border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
        isHighlighted ? "bg-blue-50 dark:bg-blue-900/20" : ""
      }`}
      onClick={(e) => onRowClick(standId, String(row._opId ?? ""), e as unknown as React.MouseEvent)}
    >
      {showForestColumn && (
        <div className="px-2 py-1 text-xs w-[100px] shrink-0 truncate">{String(row._forestName ?? "")}</div>
      )}
      <div className="px-2 py-1 font-mono text-xs w-[60px] shrink-0">{standId}</div>
      <div className="px-2 py-1 text-xs w-[120px] shrink-0">{String(row._typeLabel ?? "")}</div>
      <div className="px-2 py-1 text-right text-xs w-[55px] shrink-0">{String(row._year ?? "")}</div>
      <div className="px-2 py-1 text-right text-xs w-[45px] shrink-0">{String(row._ageStr ?? "")}</div>
      <div className="px-2 py-1 text-xs w-[90px] shrink-0">{String(row._speciesLabel ?? "")}</div>
      <div className="px-2 py-1 text-right text-xs w-[55px] shrink-0">{String(row._areaStr ?? "")}</div>
      <div className="px-2 py-1 text-right text-xs w-[70px] shrink-0">{String(row._volumeStr ?? "")}</div>
      <div className="px-2 py-1 text-right text-xs w-[55px] shrink-0">{String(row._stemsStr ?? "")}</div>
      <div className="px-2 py-1 text-right text-xs w-[45px] shrink-0">{String(row._heightStr ?? "")}</div>
      <div className="px-2 py-1 text-right text-xs w-[45px] shrink-0">{String(row._diameterStr ?? "")}</div>
      <div className="px-2 py-1 text-right text-xs w-[55px] shrink-0">
        {String(row._removalStr ?? "")}
      </div>
      <div className="px-2 py-1 text-right text-xs text-green-600 dark:text-green-400 w-[70px] shrink-0">
        {String(row._incomeStr ?? "")}
      </div>
      <div className="px-2 py-1 text-right text-xs text-orange-600 dark:text-orange-400 w-[70px] shrink-0">
        {String(row._costStr ?? "")}
      </div>
      <div className="px-2 py-1 text-xs w-[120px] truncate shrink-0">
        {String(row._devClassLabel ?? "")}
      </div>
      <div className="px-1 py-1 text-right w-[32px] shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onShowOnMap(standId); }}
          className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          title={showOnMapLabel}
        >
          📍
        </button>
      </div>
    </div>
  );
}

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
  forestFilter: [] as string[],
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
  const forests = useForestStore((s) => s.forests);
  const activeForestIds = useForestStore((s) => s.activeForestIds);
  const forestNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of forests) m.set(f.id, f.name);
    return m;
  }, [forests]);
  const forestNames = useMemo(() => forests.map((f) => f.name).filter((n, i, a) => a.indexOf(n) === i), [forests]);
  const showForestColumn = activeForestIds.length > 1;
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

  const [forestFilter, setForestFilterRaw] = useState<Set<string>>(
    () => new Set(opPersist.forestFilter)
  );
  const setForestFilter: React.Dispatch<React.SetStateAction<Set<string>>> = (v) => {
    setForestFilterRaw((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      opPersist.forestFilter = Array.from(next);
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
      setForestFilter(new Set());

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

  const [listHeight, setListHeight] = useState(400);
  const [isPending, startTransition] = useTransition();

  const [typeOpen, setTypeOpen] = useState(false);
  const [speciesOpen, setSpeciesOpen] = useState(false);
  const [forestOpen, setForestOpen] = useState(false);

  // Close dropdowns when clicking outside
  const typeRef = useRef<HTMLDivElement>(null);
  const speciesRef = useRef<HTMLDivElement>(null);
  const forestRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (typeRef.current && !typeRef.current.contains(e.target as Node)) setTypeOpen(false);
      if (speciesRef.current && !speciesRef.current.contains(e.target as Node)) setSpeciesOpen(false);
      if (forestRef.current && !forestRef.current.contains(e.target as Node)) setForestOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSort = (key: string) => {
    startTransition(() => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    });
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
    standFilter !== "" || speciesFilter.size > 0 || forestFilter.size > 0 || globalFilter !== "";

  const clearAllFilters = () => {
    setYearFrom(null);
    setYearTo(null);
    setTypeFilter(new Set());
    setStandFilter("");
    setSpeciesFilter(new Set());
    setForestFilter(new Set());
    setGlobalFilter("");
  };

  // Parse pre-operation simulated state from notes (stored as "...|||{json}" suffix)
  interface PreOpState {
    age_years: number; volume_m3: number; area_ha: number; ba: number;
    stem_count_per_ha: number; mean_height: number; mean_diameter: number;
    value_eur: number; main_species: string; development_class: string; site_type: string;
  }
  function parsePreState(notes: string | null): PreOpState | null {
    if (!notes) return null;
    const idx = notes.lastIndexOf("|||");
    if (idx === -1) return null;
    try { return JSON.parse(notes.slice(idx + 3)) as PreOpState; } catch { return null; }
  }

  const displayRows = useMemo(() => {
    let filtered = operations.map((op) => {
      const comp = compMap.get(op.compartment_id);
      const pre = parsePreState(op.notes);
      return { op, comp, pre };
    });

    if (yearFrom != null) filtered = filtered.filter((r) => r.op.year >= yearFrom);
    if (yearTo != null) filtered = filtered.filter((r) => r.op.year <= yearTo);
    if (typeFilter.size > 0) filtered = filtered.filter((r) => typeFilter.has(r.op.type));
    if (speciesFilter.size > 0 && compMap.size > 0) {
      filtered = filtered.filter((r) => {
        const sp = r.pre?.main_species ?? r.comp?.main_species ?? "";
        return speciesFilter.has(sp);
      });
    }
    if (forestFilter.size > 0) {
      filtered = filtered.filter((r) => forestFilter.has(forestNameMap.get(r.op.forest_id) ?? ""));
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
        const pre = r.pre;
        return (
          r.op.type.toLowerCase().includes(lower) ||
          String(r.op.year).includes(lower) ||
          (comp?.stand_id ?? "").toLowerCase().includes(lower) ||
          (pre?.main_species ?? comp?.main_species ?? "").toLowerCase().includes(lower) ||
          (pre?.development_class ?? comp?.development_class ?? "").toLowerCase().includes(lower) ||
          (forestNameMap.get(r.op.forest_id) ?? "").toLowerCase().includes(lower) ||
          String(pre?.age_years ?? comp?.age_years ?? "").includes(lower) ||
          String(pre?.volume_m3 ?? comp?.volume_m3 ?? "").includes(lower) ||
          String(pre?.stem_count_per_ha ?? "").includes(lower) ||
          String(pre?.mean_height ?? "").includes(lower) ||
          String(pre?.mean_diameter ?? "").includes(lower)
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
        case "age_years": return row.pre?.age_years ?? row.comp?.age_years ?? 0;
        case "species": return row.pre?.main_species ?? row.comp?.main_species ?? "";
        case "area_ha": return row.pre?.area_ha ?? row.comp?.area_ha ?? 0;
        case "volume_m3": return row.pre?.volume_m3 ?? row.comp?.volume_m3 ?? 0;
        case "stem_count_per_ha": return row.pre?.stem_count_per_ha ?? 0;
        case "mean_height": return row.pre?.mean_height ?? 0;
        case "mean_diameter": return row.pre?.mean_diameter ?? 0;
        case "removal_pct": return row.op.removal_pct ?? 0;
        case "income_eur": return row.op.income_eur ?? 0;
        case "cost_eur": return row.op.cost_eur ?? 0;
        case "development_class": return row.pre?.development_class ?? row.comp?.development_class ?? "";
        case "forest_id": return forestNameMap.get(row.op.forest_id) ?? "";
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

    return filtered.map((row) => {
      const pre = row.pre;
      const comp = row.comp;
      const standId = comp?.stand_id ?? "";
      return {
        ...row,
        _standId: standId,
        _forestName: forestNameMap.get(row.op.forest_id) ?? "",
        _opId: row.op.id,
        _typeLabel: displayOp(row.op.type, language),
        _year: row.op.year,
        _ageStr: pre?.age_years != null ? String(pre.age_years) : comp?.age_years != null ? String(comp.age_years) : "",
        _speciesLabel: displaySpecies(pre?.main_species ?? comp?.main_species ?? "", language) || "—",
        _areaStr: (pre?.area_ha ?? comp?.area_ha ?? 0).toFixed(1),
        _volumeStr: Math.round(pre?.volume_m3 ?? comp?.volume_m3 ?? 0).toLocaleString(),
        _stemsStr: pre?.stem_count_per_ha != null ? Math.round(pre.stem_count_per_ha).toLocaleString() : "—",
        _heightStr: pre?.mean_height != null ? pre.mean_height.toFixed(1) : "—",
        _diameterStr: pre?.mean_diameter != null ? pre.mean_diameter.toFixed(1) : "—",
        _removalStr: row.op.removal_pct != null ? `${row.op.removal_pct}%` : "—",
        _incomeStr: row.op.income_eur != null && row.op.income_eur !== 0 ? `+${Math.round(row.op.income_eur).toLocaleString()}` : "",
        _costStr: row.op.cost_eur != null && row.op.cost_eur !== 0 ? `−${Math.round(row.op.cost_eur).toLocaleString()}` : "",
        _devClassLabel: pre?.development_class ? displayDevClass(pre.development_class, language) : comp?.development_class ? displayDevClass(comp.development_class, language) : "",
      };
    });
  }, [operations, compMap, yearFrom, yearTo, typeFilter, speciesFilter, forestFilter, standFilter, globalFilter, sortKey, sortDir, language, forestNameMap]);

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
      <div className="shrink-0 border-b border-gray-200 dark:border-gray-700 p-2 space-y-2 bg-gradient-to-b from-gray-200 to-gray-100 dark:from-gray-700 dark:to-gray-800 rounded-t-lg">
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
          <div className="relative" ref={typeRef}>
            <button
              onClick={() => setTypeOpen((v) => !v)}
              className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              {L.filterType}{typeFilter.size > 0 ? ` (${typeFilter.size})` : " ▼"}
            </button>
            {typeOpen && (
              <div className="absolute top-full left-0 mt-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg p-1 min-w-[200px]">
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
            )}
          </div>

          {/* Species multi-select */}
          <div className="relative" ref={speciesRef}>
            <button
              onClick={() => setSpeciesOpen((v) => !v)}
              className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              {L.filterSpecies}{speciesFilter.size > 0 ? ` (${speciesFilter.size})` : " ▼"}
            </button>
            {speciesOpen && (
              <div className="absolute top-full left-0 mt-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg p-1 min-w-[160px]">
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
            )}
          </div>

          {/* Forest multi-select */}
          {showForestColumn && (
            <div className="relative" ref={forestRef}>
              <button
                onClick={() => setForestOpen((v) => !v)}
                className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                {L.filterForest}{forestFilter.size > 0 ? ` (${forestFilter.size})` : " ▼"}
              </button>
              {forestOpen && (
                <div className="absolute top-full left-0 mt-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg p-1 min-w-[160px]">
                  {forestNames.map((name) => (
                    <label key={name} className="flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={forestFilter.has(name)}
                        onChange={() => toggleFilter(setForestFilter, name)}
                        className="h-3 w-3"
                      />
                      {name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

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
            {Array.from(forestFilter).map((fn) => (
              <span key={`fo-${fn}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-teal-100 dark:bg-teal-900/30 text-teal-800 dark:text-teal-300 rounded">
                {L.chipForest}: {fn}
                <button onClick={() => toggleFilter(setForestFilter, fn)} className="ml-0.5 hover:text-red-500">✕</button>
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
      {/* Column headers */}
      <div className="flex items-center shrink-0 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-400 select-none">
        {showForestColumn && (
          <div
            className="px-2 py-1.5 cursor-pointer hover:text-gray-900 dark:hover:text-gray-200"
            style={{ width: COL_WIDTHS.colForest ?? 100 }}
            onClick={() => handleSort("colForest")}
          >
            {L.colForest}
            {sortKey === "colForest" && (sortDir === "asc" ? " ▲" : " ▼")}
          </div>
        )}
        {OP_COLUMN_KEYS.filter(k => k !== "colForest").map((colKey) => (
          <div
            key={colKey}
            className="px-2 py-1.5 cursor-pointer hover:text-gray-900 dark:hover:text-gray-200"
            style={{ width: COL_WIDTHS[colKey] ?? 80 }}
            onClick={() => handleSort(colKey)}
          >
            {(L as unknown as Record<string, string>)[colKey]}
            {sortKey === colKey && (sortDir === "asc" ? " ▲" : " ▼")}
          </div>
        ))}
        <div className="w-[32px] shrink-0"></div>
      </div>
      <div className={`flex-1 min-h-0 transition-opacity duration-150 ${isPending ? "opacity-60" : ""}`}>
        <List
          key={displayRows.length}
          defaultHeight={Math.max(listHeight, 100)}
          onResize={(size) => setListHeight(size.height)}
          rowComponent={OperationRow}
          rowCount={displayRows.length}
          rowHeight={32}
          rowProps={{
            index: undefined as never,
            style: undefined as never,
            rows: displayRows,
            highlightedStandIds,
            highlightedOperationIds,
            onRowClick: handleOperationRowClick,
            onShowOnMap: handleShowOnMap,
            language,
            showOnMapLabel: L.showOnMap,
            forestNameMap,
            showForestColumn,
          }}
        />
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
