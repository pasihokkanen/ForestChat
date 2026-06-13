"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useForestStore } from "@/lib/store";
import type { Compartment, CompartmentSpecies, Operation } from "@/types/database";
import type { YearSnapshot } from "@/lib/ai/types";
import { displayDevClass, displaySiteType, displaySpecies, displayOp, standListLabels } from "@/lib/i18n";
import type maplibregl from "maplibre-gl";
import SimulationView from "./SimulationView";
import SimulationApiLoader from "./SimulationApiLoader";
import type { PlannedOpForView } from "./SimulationView";

type StandRowType = "stand" | "species" | "operation" | "empty" | "expandedContent";

type StandDisplayRow =
  | { rowType: "stand"; data: Compartment; species: CompartmentSpecies[]; operations: Operation[] }
  | { rowType: "species"; parentStandId: string; data: CompartmentSpecies }
  | { rowType: "operation"; parentStandId: string; data: Operation }
  | { rowType: "empty"; parentStandId: string }
  | { rowType: "expandedContent"; parentStandId: string; data: Compartment; species: CompartmentSpecies[]; operations: Operation[] };

interface StandListProps {
  map: maplibregl.Map | null;
}

const DEV_CLASS_OPTIONS = [
  "regeneration_ready", "mature_thinning", "young_thinning",
  "open_area", "seed_tree", "seedling_large", "seedling_small",
] as const;

const SITE_TYPE_OPTIONS = ["herb-rich heath", "mesic", "sub-xeric", "xeric"] as const;

const SPECIES_OPTIONS = [
  "pine", "spruce", "silver_birch", "downy_birch", "larch", "grey_alder",
] as const;

// Column keys — labels come from i18n
const STAND_COLUMN_KEYS = [
  "colStand", "colSpecies", "colArea", "colVolume",
  "colAge", "colDevClass", "colSiteType", "colGrowth",
] as const;

const COL_KEY_TO_DATA: Record<string, keyof Compartment> = {
  colStand: "stand_id",
  colSpecies: "main_species",
  colArea: "area_ha",
  colVolume: "volume_m3",
  colAge: "age_years",
  colDevClass: "development_class",
  colSiteType: "site_type",
  colGrowth: "growth_m3_per_ha",
};

const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
function naturalCompare(a: unknown, b: unknown): number {
  return naturalCollator.compare(String(a ?? ""), String(b ?? ""));
}

// ── Module-level state so filter/sort/expand survive tab switches ──
const standPersist = {
  sortKey: "colStand" as string | null,
  sortDir: "asc" as "asc" | "desc",
  expandedStands: [] as string[],
  speciesFilter: [] as string[],
  devClassFilter: [] as string[],
  siteTypeFilter: [] as string[],
  ageMin: null as number | null,
  ageMax: null as number | null,
  areaMin: null as number | null,
  areaMax: null as number | null,
  volumeMin: null as number | null,
  volumeMax: null as number | null,
  globalFilter: "",
  lastClickedStandId: null as string | null,
  scrollTop: 0,
};

export default function StandList({ map }: StandListProps) {
  const compartments = useForestStore((s) => s.compartments);
  const compartmentSpecies = useForestStore((s) => s.compartmentSpecies);
  const operations = useForestStore((s) => s.operations);
  const highlightedStandIds = useForestStore((s) => s.highlightedStandIds);
  const setHighlightedStands = useForestStore((s) => s.setHighlightedStands);
  const selectStand = useForestStore((s) => s.selectStand);
  const setActiveMainTab = useForestStore((s) => s.setActiveMainTab);
  const setPendingStandSelection = useForestStore((s) => s.setPendingStandSelection);
  const aiStandFilters = useForestStore((s) => s.aiStandFilters);
  const language = useForestStore((s) => s.language) ?? "en";
  const planMetadata = useForestStore((s) => s.planMetadata);
  const forestId = useForestStore((s) => s.forest?.id ?? null);
  const L = standListLabels(language);

  // Parse simulation snapshots from plan metadata
  const simulationSnapshots = useMemo(() => {
    if (!planMetadata?.simulation_data) return null;
    try {
      return JSON.parse(planMetadata.simulation_data) as YearSnapshot[];
    } catch (e) {
      console.error("Failed to parse simulation_data:", e);
      return null;
    }
  }, [planMetadata?.simulation_data]);

  // ── State backed by module-level standPersist to survive tab switches ──
  const [expandedStands, setExpandedStandsRaw] = useState<Set<string>>(
    () => new Set(standPersist.expandedStands)
  );
  const setExpandedStands = (v: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    setExpandedStandsRaw((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      standPersist.expandedStands = Array.from(next);
      return next;
    });
  };

  const [sortKey, setSortKeyRaw] = useState<string | null>(standPersist.sortKey);
  const setSortKey = (k: string | null) => { standPersist.sortKey = k; setSortKeyRaw(k); };
  const [sortDir, setSortDirRaw] = useState<"asc" | "desc">(standPersist.sortDir);
  const setSortDir: React.Dispatch<React.SetStateAction<"asc" | "desc">> = (v) => {
    setSortDirRaw((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      standPersist.sortDir = next;
      return next;
    });
  };

  const [speciesFilter, setSpeciesFilterRaw] = useState<Set<string>>(
    () => new Set(standPersist.speciesFilter)
  );
  const setSpeciesFilter: React.Dispatch<React.SetStateAction<Set<string>>> = (v) => {
    setSpeciesFilterRaw((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      standPersist.speciesFilter = Array.from(next);
      return next;
    });
  };
  const [devClassFilter, setDevClassFilterRaw] = useState<Set<string>>(
    () => new Set(standPersist.devClassFilter)
  );
  const setDevClassFilter: React.Dispatch<React.SetStateAction<Set<string>>> = (v) => {
    setDevClassFilterRaw((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      standPersist.devClassFilter = Array.from(next);
      return next;
    });
  };
  const [siteTypeFilter, setSiteTypeFilterRaw] = useState<Set<string>>(
    () => new Set(standPersist.siteTypeFilter)
  );
  const setSiteTypeFilter: React.Dispatch<React.SetStateAction<Set<string>>> = (v) => {
    setSiteTypeFilterRaw((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      standPersist.siteTypeFilter = Array.from(next);
      return next;
    });
  };

  const [ageMin, setAgeMinRaw] = useState<number | null>(standPersist.ageMin);
  const setAgeMin = (v: number | null) => { standPersist.ageMin = v; setAgeMinRaw(v); };
  const [ageMax, setAgeMaxRaw] = useState<number | null>(standPersist.ageMax);
  const setAgeMax = (v: number | null) => { standPersist.ageMax = v; setAgeMaxRaw(v); };
  const [areaMin, setAreaMinRaw] = useState<number | null>(standPersist.areaMin);
  const setAreaMin = (v: number | null) => { standPersist.areaMin = v; setAreaMinRaw(v); };
  const [areaMax, setAreaMaxRaw] = useState<number | null>(standPersist.areaMax);
  const setAreaMax = (v: number | null) => { standPersist.areaMax = v; setAreaMaxRaw(v); };
  const [volumeMin, setVolumeMinRaw] = useState<number | null>(standPersist.volumeMin);
  const setVolumeMin = (v: number | null) => { standPersist.volumeMin = v; setVolumeMinRaw(v); };
  const [volumeMax, setVolumeMaxRaw] = useState<number | null>(standPersist.volumeMax);
  const setVolumeMax = (v: number | null) => { standPersist.volumeMax = v; setVolumeMaxRaw(v); };
  const [globalFilter, setGlobalFilterRaw] = useState(standPersist.globalFilter);
  const setGlobalFilter = (v: string) => { standPersist.globalFilter = v; setGlobalFilterRaw(v); };

  // Dropdown open state (click-toggle, not hover)
  const [speciesOpen, setSpeciesOpen] = useState(false);
  const [devClassOpen, setDevClassOpen] = useState(false);
  const [siteTypeOpen, setSiteTypeOpen] = useState(false);
  const speciesRef = useRef<HTMLDivElement>(null);
  const devClassRef = useRef<HTMLDivElement>(null);
  const siteTypeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (speciesRef.current && !speciesRef.current.contains(e.target as Node)) setSpeciesOpen(false);
      if (devClassRef.current && !devClassRef.current.contains(e.target as Node)) setDevClassOpen(false);
      if (siteTypeRef.current && !siteTypeRef.current.contains(e.target as Node)) setSiteTypeOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Apply AI-pushed filters
  useEffect(() => {
    if (aiStandFilters) {
      // Reset ALL filters first — each show_stands payload is a fresh set
      setSpeciesFilter(new Set());
      setDevClassFilter(new Set());
      setSiteTypeFilter(new Set());
      setAgeMin(null);
      setAgeMax(null);
      setAreaMin(null);
      setAreaMax(null);
      setVolumeMin(null);
      setVolumeMax(null);

      const f = aiStandFilters as Record<string, unknown>;
      if (Array.isArray(f.species)) setSpeciesFilter(new Set(f.species as string[]));
      if (Array.isArray(f.development_classes)) setDevClassFilter(new Set(f.development_classes as string[]));
      if (Array.isArray(f.site_types)) setSiteTypeFilter(new Set(f.site_types as string[]));
      if (typeof f.age_min === "number") setAgeMin(f.age_min);
      if (typeof f.age_max === "number") setAgeMax(f.age_max);
      if (typeof f.area_min === "number") setAreaMin(f.area_min);
      if (typeof f.area_max === "number") setAreaMax(f.area_max);
      if (typeof f.volume_min === "number") setVolumeMin(f.volume_min);
      if (typeof f.volume_max === "number") setVolumeMax(f.volume_max);
      setExpandedStands(new Set());
    }
  }, [aiStandFilters]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && standPersist.scrollTop > 0) {
      el.scrollTop = standPersist.scrollTop;
    }
  }, []);

  const toggleExpand = (standId: string) => {
    setExpandedStands((prev) => {
      const next = new Set(prev);
      if (next.has(standId)) next.delete(standId);
      else next.add(standId);
      return next;
    });
  };

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const handleStandRowClick = (standId: string, event: React.MouseEvent) => {
    const ctrlKey = event.ctrlKey || event.metaKey;
    const shiftKey = event.shiftKey;
    const current = useForestStore.getState().highlightedStandIds;
    let newIds: string[];

    if (shiftKey && standPersist.lastClickedStandId) {
      const orderedIds = displayRows
        .filter((r): r is StandDisplayRow & { rowType: "stand" } => r.rowType === "stand")
        .map((r) => r.data.stand_id);
      const lastIdx = orderedIds.indexOf(standPersist.lastClickedStandId);
      const currIdx = orderedIds.indexOf(standId);
      if (lastIdx !== -1 && currIdx !== -1) {
        const from = Math.min(lastIdx, currIdx);
        const to = Math.max(lastIdx, currIdx);
        newIds = orderedIds.slice(from, to + 1);
      } else {
        newIds = [standId];
      }
    } else if (ctrlKey) {
      if (current.includes(standId)) {
        newIds = current.filter((id) => id !== standId);
      } else {
        newIds = [...current, standId];
      }
    } else {
      newIds = [standId];
    }

    standPersist.lastClickedStandId = standId;
    setHighlightedStands(newIds);
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

  const hasActiveFilters = speciesFilter.size > 0 || devClassFilter.size > 0 || siteTypeFilter.size > 0 ||
    ageMin != null || ageMax != null || areaMin != null || areaMax != null ||
    volumeMin != null || volumeMax != null || globalFilter !== "";

  const clearAllFilters = () => {
    setSpeciesFilter(new Set());
    setDevClassFilter(new Set());
    setSiteTypeFilter(new Set());
    setAgeMin(null);
    setAgeMax(null);
    setAreaMin(null);
    setAreaMax(null);
    setVolumeMin(null);
    setVolumeMax(null);
    setGlobalFilter("");
  };

  // Build flat display rows
  const displayRows = useMemo(() => {
    let filtered = [...compartments];

    if (speciesFilter.size > 0) {
      filtered = filtered.filter((c) => speciesFilter.has(c.main_species ?? ""));
    }
    if (devClassFilter.size > 0) {
      filtered = filtered.filter((c) => devClassFilter.has(c.development_class ?? ""));
    }
    if (siteTypeFilter.size > 0) {
      filtered = filtered.filter((c) => siteTypeFilter.has(c.site_type ?? ""));
    }
    if (ageMin != null) filtered = filtered.filter((c) => (c.age_years ?? 0) >= ageMin);
    if (ageMax != null) filtered = filtered.filter((c) => (c.age_years ?? 0) <= ageMax);
    if (areaMin != null) filtered = filtered.filter((c) => (c.area_ha ?? 0) >= areaMin);
    if (areaMax != null) filtered = filtered.filter((c) => (c.area_ha ?? 0) <= areaMax);
    if (volumeMin != null) filtered = filtered.filter((c) => (c.volume_m3 ?? 0) >= volumeMin);
    if (volumeMax != null) filtered = filtered.filter((c) => (c.volume_m3 ?? 0) <= volumeMax);
    if (globalFilter) {
      const lower = globalFilter.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.stand_id.toLowerCase().includes(lower) ||
          (c.main_species ?? "").toLowerCase().includes(lower) ||
          (c.development_class ?? "").toLowerCase().includes(lower) ||
          (c.site_type ?? "").toLowerCase().includes(lower)
      );
    }

    if (sortKey) {
      const dataKey = COL_KEY_TO_DATA[sortKey] ?? sortKey;
      filtered.sort((a, b) => {
        const aVal = (a as unknown as Record<string, unknown>)[dataKey] ?? 0;
        const bVal = (b as unknown as Record<string, unknown>)[dataKey] ?? 0;
        const cmp = typeof aVal === "number" && typeof bVal === "number"
          ? aVal - bVal
          : naturalCompare(aVal, bVal);
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    const rows: StandDisplayRow[] = [];
    for (const comp of filtered) {
      const species = compartmentSpecies.filter((s) => s.stand_id === comp.stand_id);
      const ops = operations.filter((o) => o.compartment_id === comp.id);

      rows.push({ rowType: "stand", data: comp, species, operations: ops });

      if (expandedStands.has(comp.stand_id)) {
        rows.push({ rowType: "expandedContent", parentStandId: comp.stand_id, data: comp, species, operations: ops });
      }
    }
    return rows;
  }, [compartments, compartmentSpecies, operations, expandedStands, speciesFilter, devClassFilter,
      siteTypeFilter, ageMin, ageMax, areaMin, areaMax, volumeMin, volumeMax, globalFilter, sortKey, sortDir]);

  if (compartments.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        {L.emptyNoStands}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      {/* Filter bar */}
      <div className="shrink-0 border-b border-gray-200 dark:border-gray-700 p-2 space-y-2 bg-gray-50 dark:bg-gray-800/50">
        <div className="flex flex-wrap gap-2 items-center">
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

          {/* Dev class multi-select */}
          <div className="relative" ref={devClassRef}>
            <button
              onClick={() => setDevClassOpen((v) => !v)}
              className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              {L.filterDevClass}{devClassFilter.size > 0 ? ` (${devClassFilter.size})` : " ▼"}
            </button>
            {devClassOpen && (
              <div className="absolute top-full left-0 mt-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg p-1 min-w-[200px]">
                {DEV_CLASS_OPTIONS.map((dc) => (
                  <label key={dc} className="flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={devClassFilter.has(dc)}
                      onChange={() => toggleFilter(setDevClassFilter, dc)}
                      className="h-3 w-3"
                    />
                    {displayDevClass(dc, language)}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Site type multi-select */}
          <div className="relative" ref={siteTypeRef}>
            <button
              onClick={() => setSiteTypeOpen((v) => !v)}
              className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              {L.filterSite}{siteTypeFilter.size > 0 ? ` (${siteTypeFilter.size})` : " ▼"}
            </button>
            {siteTypeOpen && (
              <div className="absolute top-full left-0 mt-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg p-1 min-w-[180px]">
                {SITE_TYPE_OPTIONS.map((st) => (
                  <label key={st} className="flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={siteTypeFilter.has(st)}
                      onChange={() => toggleFilter(setSiteTypeFilter, st)}
                      className="h-3 w-3"
                    />
                    {displaySiteType(st, language)}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Age range */}
          <input
            type="number"
            placeholder={L.placeholderAgeMin}
            value={ageMin ?? ""}
            onChange={(e) => setAgeMin(e.target.value ? Number(e.target.value) : null)}
            className="w-16 px-1.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
          />
          <span className="text-xs text-gray-400">–</span>
          <input
            type="number"
            placeholder={L.placeholderAgeMax}
            value={ageMax ?? ""}
            onChange={(e) => setAgeMax(e.target.value ? Number(e.target.value) : null)}
            className="w-16 px-1.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
          />

          {/* Area range */}
          <input
            type="number"
            placeholder={L.placeholderAreaMin}
            value={areaMin ?? ""}
            onChange={(e) => setAreaMin(e.target.value ? Number(e.target.value) : null)}
            className="w-16 px-1.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
            step="0.1"
          />
          <span className="text-xs text-gray-400">–</span>
          <input
            type="number"
            placeholder={L.placeholderAreaMax}
            value={areaMax ?? ""}
            onChange={(e) => setAreaMax(e.target.value ? Number(e.target.value) : null)}
            className="w-16 px-1.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
            step="0.1"
          />

          {/* Volume range */}
          <input
            type="number"
            placeholder={L.placeholderVolMin}
            value={volumeMin ?? ""}
            onChange={(e) => setVolumeMin(e.target.value ? Number(e.target.value) : null)}
            className="w-16 px-1.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
          />
          <span className="text-xs text-gray-400">–</span>
          <input
            type="number"
            placeholder={L.placeholderVolMax}
            value={volumeMax ?? ""}
            onChange={(e) => setVolumeMax(e.target.value ? Number(e.target.value) : null)}
            className="w-16 px-1.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
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
            {Array.from(speciesFilter).map((s) => (
              <span key={`sp-${s}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 rounded">
                {L.chipSpecies}: {displaySpecies(s, language)}
                <button onClick={() => toggleFilter(setSpeciesFilter, s)} className="ml-0.5 hover:text-red-500">✕</button>
              </span>
            ))}
            {Array.from(devClassFilter).map((dc) => (
              <span key={`dc-${dc}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded">
                {displayDevClass(dc, language)}
                <button onClick={() => toggleFilter(setDevClassFilter, dc)} className="ml-0.5 hover:text-red-500">✕</button>
              </span>
            ))}
            {Array.from(siteTypeFilter).map((st) => (
              <span key={`st-${st}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 rounded">
                {L.chipSite}: {displaySiteType(st, language)}
                <button onClick={() => toggleFilter(setSiteTypeFilter, st)} className="ml-0.5 hover:text-red-500">✕</button>
              </span>
            ))}
            {ageMin != null && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 rounded">
                {L.chipAge}: ≥{ageMin}
                <button onClick={() => setAgeMin(null)} className="ml-0.5 hover:text-red-500">✕</button>
              </span>
            )}
            {ageMax != null && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 rounded">
                {L.chipAge}: ≤{ageMax}
                <button onClick={() => setAgeMax(null)} className="ml-0.5 hover:text-red-500">✕</button>
              </span>
            )}
            {areaMin != null && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 rounded">
                {L.chipArea}: ≥{areaMin} ha
                <button onClick={() => setAreaMin(null)} className="ml-0.5 hover:text-red-500">✕</button>
              </span>
            )}
            {areaMax != null && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 rounded">
                {L.chipArea}: ≤{areaMax} ha
                <button onClick={() => setAreaMax(null)} className="ml-0.5 hover:text-red-500">✕</button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      <div
        className="flex-1 overflow-auto min-h-0"
        ref={scrollRef}
        onScroll={(e) => { standPersist.scrollTop = (e.target as HTMLDivElement).scrollTop; }}
      >
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-100 dark:bg-gray-800 z-10">
            <tr>
              <th className="w-8 px-1 py-1.5 text-left"></th>
              {STAND_COLUMN_KEYS.map((colKey) => (
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
            {displayRows.map((row) => {
              if (row.rowType === "stand") {
                const isExpanded = expandedStands.has(row.data.stand_id);
                const isHighlighted = highlightedStandIds.includes(row.data.stand_id);
                return (
                  <tr
                    key={row.data.id}
                    className={`cursor-pointer border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
                      isHighlighted ? "bg-blue-50 dark:bg-blue-900/20" : ""
                    }`}
                    onClick={(e) => handleStandRowClick(row.data.stand_id, e)}
                  >
                    <td className="px-1 py-1 text-center text-gray-400">
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleExpand(row.data.stand_id); }}
                        className="hover:text-gray-700 dark:hover:text-gray-200"
                      >
                        {isExpanded ? "▼" : "▶"}
                      </button>
                    </td>
                    <td className="px-2 py-1 font-mono text-xs">{row.data.stand_id}</td>
                    <td className="px-2 py-1">{displaySpecies(row.data.main_species ?? "", language) || "—"}</td>
                    <td className="px-2 py-1 text-right">{(row.data.area_ha ?? 0).toFixed(1)}</td>
                    <td className="px-2 py-1 text-right">{Math.round(row.data.volume_m3 ?? 0).toLocaleString()}</td>
                    <td className="px-2 py-1 text-right">{row.data.age_years ?? ""}</td>
                    <td className="px-2 py-1 text-xs">{displayDevClass(row.data.development_class ?? "", language) || "—"}</td>
                    <td className="px-2 py-1 text-xs">{displaySiteType(row.data.site_type ?? "", language) || "—"}</td>
                    <td className="px-2 py-1 text-right">{(row.data.growth_m3_per_ha ?? 0).toFixed(1)}</td>
                    <td className="px-1 py-1 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleShowOnMap(row.data.stand_id); }}
                        className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                        title={L.showOnMap}
                      >
                        📍
                      </button>
                    </td>
                  </tr>
                );
              }

              if (row.rowType === "species") {
                // Legacy species rows — kept for backward compatibility but unused
                return null;
              }

              if (row.rowType === "operation") {
                // Legacy operation rows — kept for backward compatibility but unused
                return null;
              }

              if (row.rowType === "empty") {
                // Legacy empty rows — kept for backward compatibility but unused
                return null;
              }

              if (row.rowType === "expandedContent") {
                // Filter to operations for THIS stand only
                const opsForStand = row.operations.filter(op => op.compartment_id === row.data.id);

                // Filter species: only show those with stem_count_per_ha > 0
                const activeSpecies = row.species.filter(sp => (sp.stem_count_per_ha ?? 0) > 0);

                return (
                  <tr key={`expand-${row.parentStandId}`}>
                    <td colSpan={9} className="p-0">
                      <div className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20">
                        {/* Current State — species rows with ALL fields */}
                        <div className="px-4 py-2">
                          <div className="text-xs font-semibold text-gray-500 mb-1">
                            {L.simCurrentState}
                          </div>
                          {activeSpecies.map(sp => (
                            <div key={sp.id} className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-600 pl-4 mb-1">
                              <span className="font-medium w-20">{displaySpecies(sp.species, language)}</span>
                              <span>Vol: {Math.round(sp.volume_m3 ?? 0).toLocaleString()} m³</span>
                              <span>{L.colBA}: {(sp.basal_area ?? 0).toFixed(1)}</span>
                              <span>{L.colStems}: {(sp.stem_count_per_ha ?? 0).toLocaleString()}</span>
                              <span>{L.colHeight}: {(sp.mean_height ?? 0).toFixed(1)}</span>
                              <span>{L.colDiameter}: {(sp.mean_diameter ?? 0).toFixed(1)}</span>
                              <span>{L.colAge}: {sp.age ?? ""}</span>
                              <span>{L.logPct}: {sp.log_pct != null ? `${sp.log_pct}%` : "—"}</span>
                              <span>{L.colArea}: {(sp.area_ha ?? 0).toFixed(1)} ha</span>
                            </div>
                          ))}
                          {activeSpecies.length === 0 && (
                            <div className="text-xs text-gray-400 italic pl-4">
                              No species with stems &gt; 0
                            </div>
                          )}
                        </div>

                        {/* Simulation — year blocks with inline operations */}
                        {simulationSnapshots && simulationSnapshots.length > 0 ? (
                          <SimulationView
                            standId={row.data.stand_id}
                            simulationSnapshots={simulationSnapshots}
                            operations={opsForStand.map(op => ({
                              year: op.year,
                              type: op.type,
                              removalPct: op.removal_pct ?? 0,
                              incomeEur: op.income_eur ?? 0,
                              costEur: op.cost_eur ?? 0,
                              notes: op.notes ?? "",
                            }))}
                            language={language}
                            labels={L}
                          />
                        ) : simulationSnapshots === null && forestId ? (
                          <SimulationApiLoader
                            forestId={forestId}
                            standId={row.data.stand_id}
                            operations={opsForStand.map(op => ({
                              year: op.year,
                              type: op.type,
                              removalPct: op.removal_pct ?? 0,
                              incomeEur: op.income_eur ?? 0,
                              costEur: op.cost_eur ?? 0,
                              notes: op.notes ?? "",
                            }))}
                            language={language}
                            labels={L}
                          />
                        ) : (
                          <div className="px-4 py-2 text-xs text-gray-400 italic">
                            {L.simNoData}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              }

              return null;
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
        {displayRows.filter((r) => r.rowType === "stand").length} {L.footerStands}
        {hasActiveFilters ? ` ${L.footerFilteredFrom} ${compartments.length})` : ` / ${compartments.length} ${L.footerTotal}`}
      </div>
    </div>
  );
}
