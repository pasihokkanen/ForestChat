"use client";

import { useEffect, useRef, useCallback } from "react";
import maplibregl from "maplibre-gl";
import type { CompartmentFeatureCollection } from "@/types/database";
import { fitBoundsToFeatures } from "@/lib/map/geojson";
import { DEVELOPMENT_CLASS_COLORS } from "@/lib/map/styles";
import { useForestStore } from "@/lib/store";

// Age-based color palette (warm=young → cool=old)
const AGE_COLORS = [
  "#ffffb2", // 0-10: pale yellow
  "#fecc5c", // 11-20
  "#fd8d3c", // 21-40
  "#f03b20", // 41-60
  "#bd0026", // 61-80
  "#4a1486", // 81-100
  "#1a0a3e", // 101+: deep purple
];

export interface StandLayerProps {
  map: maplibregl.Map | null;
  compartments: CompartmentFeatureCollection;
  /** Incremented on every map style switch so the layer re-registers. */
  styleVersion?: number;
}

/**
 * Determine if age-based coloring should be used.
 * Rules: max age gap > 10 years, no dominant bracket > 70%.
 */
function shouldUseAgeColoring(
  features: CompartmentFeatureCollection["features"],
): boolean {
  const ages: number[] = [];
  for (const f of features) {
    const age = f.properties?.age_years as number | undefined;
    if (age != null && age > 0) ages.push(age);
  }
  if (ages.length < 3) return false;

  const min = Math.min(...ages);
  const max = Math.max(...ages);
  if (max - min <= 10) return false;

  // Check no single bracket > 70%
  const bracketSize = Math.max(10, Math.floor((max - min) / 6));
  const brackets = new Map<number, number>();
  for (const a of ages) {
    const key = Math.floor(a / bracketSize);
    brackets.set(key, (brackets.get(key) ?? 0) + 1);
  }
  const maxPct = Math.max(...brackets.values()) / ages.length;
  return maxPct <= 0.7;
}

/**
 * Show a custom popup overlay for a forest stand.
 * Uses a fixed-position overlay on the map container.
 */
function showCustomPopup(
  map: maplibregl.Map,
  popupRef: React.MutableRefObject<HTMLElement | null>,
  props: Record<string, unknown>,
  lngLat: [number, number],
) {
  // Remove any existing custom popup
  if (popupRef.current) {
    popupRef.current.remove();
    popupRef.current = null;
  }

  const standId = props.stand_id as string;

  // Create overlay container
  const el = document.createElement("div");
  el.className = "forestchat-custom-popup";
  el.style.cssText = `
    position: absolute;
    z-index: 1000;
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.2);
    padding: 12px;
    min-width: 200px;
    font-size: 13px;
    color: #111;
    pointer-events: auto;
    transform: translate(-50%, -100%);
    margin-top: -10px;
  `;

  // Position and append to DOM
  const point = map.project(lngLat);
  // Append to document.body with fixed positioning to avoid MapLibre container stacking issues
  const containerRect = map.getContainer().getBoundingClientRect();
  el.style.position = "fixed";
  el.style.left = (containerRect.left + point.x) + "px";
  el.style.top = (containerRect.top + point.y) + "px";
  document.body.appendChild(el);
  popupRef.current = el;

  // Build popup HTML directly (synchronous)
  const species = (props.main_species as string) ?? "—";
  const devClass = (props.development_class as string) ?? "—";
  const siteType = (props.site_type as string) ?? "—";
  const area = (props.area_ha as number) != null ? (props.area_ha as number).toFixed(1) : "—";
  const age = (props.age_years as number) != null ? `${props.age_years as number} yr` : "—";
  const volume = (props.volume_m3 as number) != null ? (props.volume_m3 as number).toFixed(0) : "—";

  el.innerHTML = `
    <div style="position:relative">
      <button class="popup-close" style="position:absolute;top:1px;right:1px;border:none;background:transparent;font-size:18px;cursor:pointer;color:#999;line-height:1;width:20px;height:20px;display:flex;align-items:center;justify-content:center;border-radius:4px">×</button>
      <h3 style="font-weight:600;font-size:15px;margin:0 0 8px 0;padding-bottom:4px;border-bottom:1px solid #e5e7eb">Stand ${standId}</h3>
      <dl style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;margin:0;font-size:13px">
        <dt style="color:#6b7280">Main species</dt><dd style="margin:0;color:#111">${species}</dd>
        <dt style="color:#6b7280">Development class</dt><dd style="margin:0;color:#111">${devClass}</dd>
        <dt style="color:#6b7280">Site type</dt><dd style="margin:0;color:#111">${siteType}</dd>
        <dt style="color:#6b7280">Area (ha)</dt><dd style="margin:0;color:#111">${area}</dd>
        <dt style="color:#6b7280">Age</dt><dd style="margin:0;color:#111">${age}</dd>
        <dt style="color:#6b7280">Volume (m³)</dt><dd style="margin:0;color:#111">${volume}</dd>
      </dl>
    </div>
  `;

  // Wire up close button
  const closeBtn = el.querySelector(".popup-close") as HTMLElement | null;
  if (closeBtn) {
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      hideCustomPopup(popupRef);
    };
  }
}

/**
 * Remove the custom popup overlay.
 */
function hideCustomPopup(popupRef: React.MutableRefObject<HTMLElement | null>) {
  if (popupRef.current) {
    popupRef.current.remove();
    popupRef.current = null;
  }
}

/**
 * Renders forest stand polygons on a MapLibre map and handles
 * click-to-inspect via popups.
 */
export default function StandLayer({ map, compartments, styleVersion = 0 }: StandLayerProps) {
  const popupRef = useRef<HTMLElement | null>(null);
  const hasZoomed = useRef(false);
  const clickedStandRef = useRef<string | null>(null); // non-null = selection came from map click
  const useAgeColor = shouldUseAgeColoring(compartments.features);

  // Zustand state for cross-panel interaction
  const selectedStandId = useForestStore((s) => s.selectedStandId);
  const highlightedStandIds = useForestStore((s) => s.highlightedStandIds);
  const selectStand = useForestStore((s) => s.selectStand);
  const setHighlightedStands = useForestStore((s) => s.setHighlightedStands);

  // Build MapLibre match expression for fill-color
  const buildMatchExpression = useCallback((): maplibregl.Expression => {
    if (useAgeColor) {
      // Age-based coloring with MapLibre "step" expression (ranges)
      const ages: number[] = [];
      for (const f of compartments.features) {
        const age = f.properties?.age_years as number | undefined;
        if (age != null && age > 0) ages.push(age);
      }
      const min = Math.min(...ages);
      const max = Math.max(...ages);
      const bracketSize = Math.max(10, Math.floor((max - min) / (AGE_COLORS.length - 1)));

      // Build step expression: [step, [get, "age_years"], color0, step1, color1, ...]
      const steps: unknown[] = ["step", ["to-number", ["get", "age_years"]]];
      steps.push(AGE_COLORS[0]); // default / youngest

      for (let i = 1; i < AGE_COLORS.length; i++) {
        steps.push(min + bracketSize * i);
        steps.push(AGE_COLORS[i]);
      }
      return steps as unknown as maplibregl.Expression;
    }

    // Development class coloring — handle both FI and EN names
    const pairs: unknown[] = ["match", ["get", "development_class"]];

    // English values (new imports)
    for (const [en, color] of Object.entries(DEVELOPMENT_CLASS_COLORS)) {
      if (en === "default") continue;
      pairs.push(en);
      pairs.push(color);
    }

    // Finnish values (legacy data or unmapped)
    pairs.push("Taimikko");
    pairs.push(DEVELOPMENT_CLASS_COLORS.seedling);
    pairs.push("Taimikko alle 1,3 m");
    pairs.push(DEVELOPMENT_CLASS_COLORS.seedling_small);
    pairs.push("Taimikko yli 1,3 m");
    pairs.push(DEVELOPMENT_CLASS_COLORS.seedling_large);
    pairs.push("Nuori kasvatusmetsikkö");
    pairs.push(DEVELOPMENT_CLASS_COLORS.young_thinning);
    pairs.push("Varttunut kasvatusmetsikkö");
    pairs.push(DEVELOPMENT_CLASS_COLORS.mature_thinning);
    pairs.push("Uudistuskypsä");
    pairs.push(DEVELOPMENT_CLASS_COLORS.regeneration_ready);
    pairs.push("Eri-ikäisrakenteinen");
    pairs.push(DEVELOPMENT_CLASS_COLORS.uneven_aged);
    pairs.push("Suojuspuusto");
    pairs.push(DEVELOPMENT_CLASS_COLORS.shelterwood);
    pairs.push("Siemenpuumetsikkö");
    pairs.push(DEVELOPMENT_CLASS_COLORS.seed_tree);

    pairs.push("#CCCCCC"); // default fallback
    return pairs as unknown as maplibregl.Expression;
  }, [compartments.features, useAgeColor]);

  useEffect(() => {
    if (!map) return;

    const SOURCE_ID = "stands";
    const LAYER_ID = "stands-fill";

    // Handler functions defined once per mount
    const setPointer = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const resetCursor = () => {
      map.getCanvas().style.cursor = "";
    };

    const handleMapClick = (e: maplibregl.MapMouseEvent) => {
      // Query features at click point — works reliably for both stands and background
      if (!map.getLayer(LAYER_ID)) return;
      const features = map.queryRenderedFeatures(e.point, {
        layers: [LAYER_ID],
      });

      if (features.length > 0) {
        // Clicked on a stand
        const feature = features[0];
        const props = feature.properties as Record<string, unknown>;
        const standId = props.stand_id as string;
        const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];

        // Track that this selection came from a map click (prevents zoom)
        clickedStandRef.current = standId;

        // Toggle selection — clicking same stand deselects
        // Read fresh from store (handler closure has stale value)
        if (useForestStore.getState().selectedStandId === standId) {
          selectStand(null);
          setHighlightedStands([]);
          return; // popup already removed below
        }

        selectStand(standId);
        setHighlightedStands([standId]);

        // Show popup at click coordinates immediately (no zoom)
        showCustomPopup(map, popupRef, props, lngLat);
      } else {
        // Clicked on background — close popup and deselect
        hideCustomPopup(popupRef);
        selectStand(null);
        setHighlightedStands([]);
        clickedStandRef.current = null;
      }
    };

    const addStandLayer = () => {
      // Only add source/layer once
      if (map.getSource(SOURCE_ID)) return;

      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: compartments,
      });

      map.addLayer({
        id: LAYER_ID,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "fill-color": buildMatchExpression() as any,
          "fill-opacity": 0.6,
          "fill-outline-color": "#333",
        },
      });

      // Highlight layers — gold outline and overlay on selected/highlighted stands
      map.addLayer({
        id: "stands-highlight-fill",
        type: "fill",
        source: SOURCE_ID,
        filter: ["==", ["get", "stand_id"], ""], // empty initially
        paint: {
          "fill-color": "#FFD700",
          "fill-opacity": 0.3,
        },
      });

      map.addLayer({
        id: "stands-highlight",
        type: "line",
        source: SOURCE_ID,
        filter: ["==", ["get", "stand_id"], ""], // empty initially
        paint: {
          "line-color": "#FFD700",
          "line-width": 4,
          "line-opacity": 0.9,
        },
      });
    };

    // Wait for style to load before adding source/layer
    if (map.isStyleLoaded()) {
      addStandLayer();
    } else {
      map.once("style.load", addStandLayer);
    }

    // Event handlers
    map.on("mouseenter", LAYER_ID, setPointer);
    map.on("mouseleave", LAYER_ID, resetCursor);
    map.on("click", handleMapClick);

    return () => {
      map.off("mouseenter", LAYER_ID, setPointer);
      map.off("mouseleave", LAYER_ID, resetCursor);
      map.off("click", handleMapClick);
      hideCustomPopup(popupRef);
    };
  }, [map, compartments, buildMatchExpression, styleVersion]);

  // Update source data when compartments change
  useEffect(() => {
    if (!map) return;
    try {
      const source = map.getSource("stands") as maplibregl.GeoJSONSource | undefined;
      if (source?.setData) {
        source.setData(compartments);
      }
    } catch {
      // Source may not be available during layout transitions — skip
    }
  }, [map, compartments]);

  // Update highlight layer filters when selection changes (P4.6)
  useEffect(() => {
    if (!map) return;
    try {
      if (!map.getLayer("stands-highlight")) return;

      const ids = highlightedStandIds.length > 0
        ? highlightedStandIds
        : selectedStandId
          ? [selectedStandId]
          : [];

      const filter = ids.length > 0
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (["in", ["get", "stand_id"], ["literal", ids]] as any)
        : // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (["==", ["get", "stand_id"], ""] as any);

      map.setFilter("stands-highlight", filter);
      map.setFilter("stands-highlight-fill", filter);
    } catch {
      // Layer/source may not be available during layout transitions — skip
    }
  }, [map, selectedStandId, highlightedStandIds, styleVersion]);

  // Zoom to selected stand when selection changes via AI or chart click
  // (NOT on direct map click — those are handled separately with clickedStandRef)
  useEffect(() => {
    if (!map || !selectedStandId) return;

    // If selection came from map click, skip zoom
    if (clickedStandRef.current === selectedStandId) {
      clickedStandRef.current = null;
      return;
    }

    // Find the feature in the compartments data directly instead of querying the map source
    const feature = compartments.features.find(
      (f) => f.properties?.stand_id === selectedStandId
    );
    if (!feature || !feature.geometry) return;

    try {
      // Compute bounds from feature geometry
      const bounds = new maplibregl.LngLatBounds();
      const geom = feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
      const coords =
        geom.type === "Polygon"
          ? geom.coordinates[0]
          : geom.coordinates.flatMap((ring) => ring[0]);
      for (const [lng, lat] of coords as [number, number][]) {
        bounds.extend([lng, lat]);
      }

      // Cancel any in-progress animation before fitting
      map.stop();
      map.fitBounds(bounds, { padding: 80, maxZoom: 16, duration: 800 });

      // Show popup AFTER the zoom animation completes (moveend)
      const center = bounds.getCenter();
      const lngLat: [number, number] = [center.lng, center.lat];
      const props = feature.properties as Record<string, unknown>;

      const onMoveEnd = () => {
        if (useForestStore.getState().selectedStandId !== selectedStandId) return;
        showCustomPopup(map, popupRef, props, lngLat);
      };
      // Use once() so it auto-removes after firing
      map.once("moveend", onMoveEnd);

      return () => {
        map.stop();
        map.off("moveend", onMoveEnd);
      };
    } catch {
      // Silently handle geometry format issues
    }
  }, [map, selectedStandId, compartments]);

  // Auto-zoom to fit stands on first load
  useEffect(() => {
    if (!map || hasZoomed.current) return;
    if (!compartments.features || compartments.features.length === 0) return;

    const tryFit = (): boolean => {
      if (!map.isStyleLoaded()) return false;
      const source = map.getSource("stands");
      if (!source) return false;
      hasZoomed.current = true;
      fitBoundsToFeatures(map, compartments);
      return true;
    };

    // Try immediately — works when both style and source are ready
    if (tryFit()) return;

    // Poll until ready (every 200ms, up to ~5 seconds).
    // Handles the edge case where style loaded but source wasn't added yet:
    // the old approach used map.once("style.load", ...) which never fires
    // if the style already loaded.
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (tryFit() || attempts > 25) {
        clearInterval(interval);
      }
    }, 200);

    return () => clearInterval(interval);
  }, [map, compartments, styleVersion]);

  return null; // No DOM — pure map-side effect
}