"use client";

import { useState, useMemo, useEffect } from "react";
import { useForestStore } from "@/lib/store";
import type { Compartment, CompartmentSpecies, Operation } from "@/types/database";
import { displayOperationType } from "@/lib/ai/config";
import type maplibregl from "maplibre-gl";

type StandRowType = "stand" | "species" | "operation" | "empty";

type StandDisplayRow =
  | { rowType: "stand"; data: Compartment; species: CompartmentSpecies[]; operations: Operation[] }
  | { rowType: "species"; parentStandId: string; data: CompartmentSpecies }
  | { rowType: "operation"; parentStandId: string; data: Operation }
  | { rowType: "empty"; parentStandId: string };

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

const STAND_COLUMNS = [
  { key: "stand_id", label: "Stand" },
  { key: "main_species", label: "Species" },
  { key: "area_ha", label: "Area (ha)" },
  { key: "volume_m3", label: "Volume (m³)" },
  { key: "age_years", label: "Age" },
  { key: "development_class", label: "Dev. Class" },
  { key: "site_type", label: "Site Type" },
  { key: "growth_m3_per_ha", label: "Growth (m³/ha/y)" },
] as const;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDisplayDevClass(dc: string): string {
  return dc
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Natural sort: "2" < "10", "a2" < "a10". Falls back to localeCompare for non-numeric strings. */
const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
function naturalCompare(a: unknown, b: unknown): number {
  return naturalCollator.compare(String(a ?? ""), String(b ?? ""));
}

// ── Module-level state so filter/sort/expand survive tab switches ──
const standPersist = {
  sortKey: "stand_id" as string | null,
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

  // Filter state — backed by standPersist
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

  // Apply AI-pushed filters
  useEffect(() => {
    if (aiStandFilters) {
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
      // Collapse all — filter is a new context
      setExpandedStands(new Set());
    }
  }, [aiStandFilters]);

  const toggleExpand = (standId: string) => {
    setExpandedStands((prev) => {
      const next = new Set(prev);
      if (next.has(standId)) {
        next.delete(standId);
      } else {
        next.add(standId);
      }
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
      // Shift+click: range select between last clicked stand and current
      // Use the displayed order (filtered + sorted stands)
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
      // Ctrl+click: toggle
      if (current.includes(standId)) {
        newIds = current.filter((id) => id !== standId);
      } else {
        newIds = [...current, standId];
      }
    } else {
      // No modifier: replace selection
      newIds = [standId];
    }

    standPersist.lastClickedStandId = standId;
    setHighlightedStands(newIds);
    // Popup visibility is handled by StandLayer's popup-sync useEffect
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

    // Apply filters
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

    // Sort
    if (sortKey) {
      filtered.sort((a, b) => {
        const aVal = (a as unknown as Record<string, unknown>)[sortKey] ?? 0;
        const bVal = (b as unknown as Record<string, unknown>)[sortKey] ?? 0;
        const cmp = typeof aVal === "number" && typeof bVal === "number"
          ? aVal - bVal
          : naturalCompare(aVal, bVal);
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    // Build display rows
    const rows: StandDisplayRow[] = [];
    for (const comp of filtered) {
      const species = compartmentSpecies.filter((s) => s.stand_id === comp.stand_id);
      const ops = operations.filter((o) => o.compartment_id === comp.id);

      rows.push({ rowType: "stand", data: comp, species, operations: ops });

      if (expandedStands.has(comp.stand_id)) {
        for (const sp of species) {
          rows.push({ rowType: "species", parentStandId: comp.stand_id, data: sp });
        }
        for (const op of ops) {
          rows.push({ rowType: "operation", parentStandId: comp.stand_id, data: op });
        }
        if (species.length === 0 && ops.length === 0) {
          rows.push({ rowType: "empty", parentStandId: comp.stand_id });
        }
      }
    }
    return rows;
  }, [compartments, compartmentSpecies, operations, expandedStands, speciesFilter, devClassFilter,
      siteTypeFilter, ageMin, ageMax, areaMin, areaMax, volumeMin, volumeMax, globalFilter, sortKey, sortDir]);

  if (compartments.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        No stands loaded.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      {/* Filter bar */}
      <div className="shrink-0 border-b border-gray-200 dark:border-gray-700 p-2 space-y-2 bg-gray-50 dark:bg-gray-800/50">
        <div className="flex flex-wrap gap-2 items-center">
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
                  {capitalize(s.replace(/_/g, " "))}
                </label>
              ))}
            </div>
          </div>

          {/* Dev class multi-select */}
          <div className="relative group">
            <button className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700">
              Dev. Class {devClassFilter.size > 0 ? `(${devClassFilter.size})` : "▼"}
            </button>
            <div className="absolute top-full left-0 mt-1 z-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg p-1 hidden group-hover:block min-w-[200px]">
              {DEV_CLASS_OPTIONS.map((dc) => (
                <label key={dc} className="flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={devClassFilter.has(dc)}
                    onChange={() => toggleFilter(setDevClassFilter, dc)}
                    className="h-3 w-3"
                  />
                  {formatDisplayDevClass(dc)}
                </label>
              ))}
            </div>
          </div>

          {/* Site type multi-select */}
          <div className="relative group">
            <button className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700">
              Site {siteTypeFilter.size > 0 ? `(${siteTypeFilter.size})` : "▼"}
            </button>
            <div className="absolute top-full left-0 mt-1 z-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg p-1 hidden group-hover:block min-w-[180px]">
              {SITE_TYPE_OPTIONS.map((st) => (
                <label key={st} className="flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={siteTypeFilter.has(st)}
                    onChange={() => toggleFilter(setSiteTypeFilter, st)}
                    className="h-3 w-3"
                  />
                  {st.split(" ").map(capitalize).join(" ")}
                </label>
              ))}
            </div>
          </div>

          {/* Age range */}
          <input
            type="number"
            placeholder="Age ≥"
            value={ageMin ?? ""}
            onChange={(e) => setAgeMin(e.target.value ? Number(e.target.value) : null)}
            className="w-16 px-1.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
          />
          <span className="text-xs text-gray-400">–</span>
          <input
            type="number"
            placeholder="Age ≤"
            value={ageMax ?? ""}
            onChange={(e) => setAgeMax(e.target.value ? Number(e.target.value) : null)}
            className="w-16 px-1.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
          />

          {/* Area range */}
          <input
            type="number"
            placeholder="Area ≥"
            value={areaMin ?? ""}
            onChange={(e) => setAreaMin(e.target.value ? Number(e.target.value) : null)}
            className="w-16 px-1.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
            step="0.1"
          />
          <span className="text-xs text-gray-400">–</span>
          <input
            type="number"
            placeholder="Area ≤"
            value={areaMax ?? ""}
            onChange={(e) => setAreaMax(e.target.value ? Number(e.target.value) : null)}
            className="w-16 px-1.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
            step="0.1"
          />

          {/* Volume range */}
          <input
            type="number"
            placeholder="Vol ≥"
            value={volumeMin ?? ""}
            onChange={(e) => setVolumeMin(e.target.value ? Number(e.target.value) : null)}
            className="w-16 px-1.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
          />
          <span className="text-xs text-gray-400">–</span>
          <input
            type="number"
            placeholder="Vol ≤"
            value={volumeMax ?? ""}
            onChange={(e) => setVolumeMax(e.target.value ? Number(e.target.value) : null)}
            className="w-16 px-1.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
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
            {Array.from(speciesFilter).map((s) => (
              <span key={`sp-${s}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 rounded">
                Species: {capitalize(s)}
                <button onClick={() => toggleFilter(setSpeciesFilter, s)} className="ml-0.5 hover:text-red-500">✕</button>
              </span>
            ))}
            {Array.from(devClassFilter).map((dc) => (
              <span key={`dc-${dc}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded">
                {formatDisplayDevClass(dc)}
                <button onClick={() => toggleFilter(setDevClassFilter, dc)} className="ml-0.5 hover:text-red-500">✕</button>
              </span>
            ))}
            {Array.from(siteTypeFilter).map((st) => (
              <span key={`st-${st}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 rounded">
                Site: {st}
                <button onClick={() => toggleFilter(setSiteTypeFilter, st)} className="ml-0.5 hover:text-red-500">✕</button>
              </span>
            ))}
            {ageMin != null && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 rounded">
                Age: ≥{ageMin}
                <button onClick={() => setAgeMin(null)} className="ml-0.5 hover:text-red-500">✕</button>
              </span>
            )}
            {ageMax != null && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 rounded">
                Age: ≤{ageMax}
                <button onClick={() => setAgeMax(null)} className="ml-0.5 hover:text-red-500">✕</button>
              </span>
            )}
            {areaMin != null && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 rounded">
                Area: ≥{areaMin} ha
                <button onClick={() => setAreaMin(null)} className="ml-0.5 hover:text-red-500">✕</button>
              </span>
            )}
            {areaMax != null && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 rounded">
                Area: ≤{areaMax} ha
                <button onClick={() => setAreaMax(null)} className="ml-0.5 hover:text-red-500">✕</button>
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
              <th className="w-8 px-1 py-1.5 text-left"></th>
              {STAND_COLUMNS.map((col) => (
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
            {displayRows.map((row, idx) => {
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
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(row.data.stand_id);
                        }}
                        className="hover:text-gray-700 dark:hover:text-gray-200"
                      >
                        {isExpanded ? "▼" : "▶"}
                      </button>
                    </td>
                    <td className="px-2 py-1 font-mono text-xs">{row.data.stand_id}</td>
                    <td className="px-2 py-1">{capitalize(row.data.main_species ?? "")}</td>
                    <td className="px-2 py-1 text-right">{(row.data.area_ha ?? 0).toFixed(1)}</td>
                    <td className="px-2 py-1 text-right">{Math.round(row.data.volume_m3 ?? 0).toLocaleString()}</td>
                    <td className="px-2 py-1 text-right">{row.data.age_years ?? ""}</td>
                    <td className="px-2 py-1 text-xs">{formatDisplayDevClass(row.data.development_class ?? "")}</td>
                    <td className="px-2 py-1 text-xs">{row.data.site_type ?? ""}</td>
                    <td className="px-2 py-1 text-right">{(row.data.growth_m3_per_ha ?? 0).toFixed(1)}</td>
                    <td className="px-1 py-1 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleShowOnMap(row.data.stand_id);
                        }}
                        className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                        title="Show on map"
                      >
                        📍
                      </button>
                    </td>
                  </tr>
                );
              }

              if (row.rowType === "species") {
                return (
                  <tr key={`sp-${row.data.id}`} className="border-b border-gray-50 dark:border-gray-800/50 bg-gray-50/50 dark:bg-gray-800/20 text-xs">
                    <td className="px-1 py-1"></td>
                    <td className="px-2 py-1 pl-8 text-gray-500" colSpan={2}>
                      ↳ {capitalize(row.data.species)}
                    </td>
                    <td className="px-2 py-1 text-right text-gray-500">{(row.data.area_ha ?? 0).toFixed(1)}</td>
                    <td className="px-2 py-1 text-right text-gray-500">{Math.round(row.data.volume_m3 ?? 0).toLocaleString()}</td>
                    <td className="px-2 py-1 text-gray-500" colSpan={2}>
                      Log: {row.data.log_pct != null ? `${row.data.log_pct}%` : "—"}
                    </td>
                    <td className="px-2 py-1"></td>
                    <td className="px-2 py-1"></td>
                    <td className="px-1 py-1"></td>
                  </tr>
                );
              }

              if (row.rowType === "operation") {
                return (
                  <tr key={`op-${row.data.id}`} className="border-b border-gray-50 dark:border-gray-800/50 bg-gray-50/50 dark:bg-gray-800/20 text-xs">
                    <td className="px-1 py-1"></td>
                    <td className="px-2 py-1 pl-8 text-gray-500" colSpan={2}>
                      ↳ {displayOperationType(row.data.type)} ({row.data.year})
                    </td>
                    <td className="px-2 py-1"></td>
                    <td className="px-2 py-1 text-right text-gray-500">
                      {row.data.removal_pct != null ? `${row.data.removal_pct}%` : "—"}
                    </td>
                    <td className="px-2 py-1 text-right text-green-600 dark:text-green-400">
                      {row.data.income_eur != null && row.data.income_eur !== 0
                        ? `+${Math.round(row.data.income_eur).toLocaleString()} €`
                        : ""}
                    </td>
                    <td className="px-2 py-1 text-right text-orange-600 dark:text-orange-400">
                      {row.data.cost_eur != null && row.data.cost_eur !== 0
                        ? `−${Math.round(row.data.cost_eur).toLocaleString()} €`
                        : ""}
                    </td>
                    <td className="px-2 py-1"></td>
                    <td className="px-2 py-1"></td>
                    <td className="px-1 py-1"></td>
                  </tr>
                );
              }

              if (row.rowType === "empty") {
                return (
                  <tr key={`empty-${row.parentStandId}`} className="border-b border-gray-50 dark:border-gray-800/50 bg-gray-50/50 dark:bg-gray-800/20 text-xs">
                    <td className="px-1 py-1"></td>
                    <td className="px-2 py-1 pl-8 text-gray-400 italic" colSpan={9}>
                      No species or operations
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
            No stands match the current filters.
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs text-gray-500 bg-gray-50 dark:bg-gray-800/50">
        {displayRows.filter((r) => r.rowType === "stand").length} stands
        {hasActiveFilters ? ` (filtered from ${compartments.length})` : ` / ${compartments.length} total`}
      </div>
    </div>
  );
}
