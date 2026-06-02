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
  /** Whether the map is in dark mode (for popup theming). */
  isDark?: boolean;
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

/** Show a custom popup overlay for a forest stand. Uses store data for species and operations.
 *  @param polyBounds — the stand polygon's bounding box in screen coordinates {left, top, right, bottom}
 *  @param containerBounds — the map container's bounding rect for clipping */
function showCustomPopup(
   map: maplibregl.Map,
   popupRef: React.MutableRefObject<HTMLElement | null>,
   props: Record<string, unknown>,
   polyBounds: { left: number; top: number; right: number; bottom: number },
   containerBounds: DOMRect,
   isDark: boolean,
 ) {
  // Remove any existing custom popup
  if (popupRef.current) {
    popupRef.current.remove();
    popupRef.current = null;
  }

  const standId = props.stand_id as string;

  // Theme-aware colors
  const bgColor = isDark ? "#1f2937" : "white";
  const textColor = isDark ? "#f3f4f6" : "#111";
  const mutedColor = isDark ? "#9ca3af" : "#6b7280";
  const borderColor = isDark ? "#374151" : "#e5e7eb";
  const closeBtnColor = isDark ? "#6b7280" : "#999";
  const closeBtnHoverBg = isDark ? "#374151" : "#f3f4f6";
  const sectionTitleColor = isDark ? "#9ca3af" : "#6b7280";
  const labelColor = isDark ? "#d1d5db" : "#111";

  // ── Smart placement: pick the side with the most available space ──
  const POPUP_WIDTH = 280;
  const POPUP_HEIGHT = 300; // approximate, will be sized by content
  const GAP = 12; // px gap between polygon edge and popup

  // Available space in each direction (within container bounds)
  const spaceTop = polyBounds.top - containerBounds.top;
  const spaceBottom = containerBounds.bottom - polyBounds.bottom;
  const spaceLeft = polyBounds.left - containerBounds.left;
  const spaceRight = containerBounds.right - polyBounds.right;

  // Prefer bottom or right if there's enough room, otherwise top or left
  let posX: number;
  let posY: number;
  let transformX: string;
  let transformY: string;

  // Horizontal: prefer center-aligned over polygon, clamped to container
  const polyCenterX = (polyBounds.left + polyBounds.right) / 2 - containerBounds.left;
  // Clamp center so popup doesn't go outside container
  const minX = POPUP_WIDTH / 2 + 8;
  const maxX = containerBounds.width - POPUP_WIDTH / 2 - 8;
  posX = Math.max(minX, Math.min(maxX, polyCenterX));
  transformX = "-50%";

  // Vertical: pick best side
  if (spaceBottom >= POPUP_HEIGHT + GAP) {
    // Place below polygon
    posY = polyBounds.bottom - containerBounds.top + GAP;
    transformY = "0";
  } else if (spaceTop >= POPUP_HEIGHT + GAP) {
    // Place above polygon
    posY = polyBounds.top - containerBounds.top - GAP;
    transformY = "-100%";
  } else if (spaceBottom >= spaceTop) {
    // Both tight — below if it has more room
    posY = Math.min(polyBounds.bottom - containerBounds.top + GAP, containerBounds.height - POPUP_HEIGHT - 4);
    transformY = "0";
  } else {
    posY = Math.max(polyBounds.top - containerBounds.top - GAP, 4);
    transformY = "-100%";
  }

  // Create overlay container — append to map container so it stays inside
  const el = document.createElement("div");
  el.className = "forestchat-custom-popup";
  el.style.cssText = `
    position: absolute;
    z-index: 1000;
    left: ${posX}px;
    top: ${posY}px;
    transform: translate(${transformX}, ${transformY});
    background: ${bgColor};
    border: 1px solid ${borderColor};
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.2);
    padding: 12px;
    min-width: ${POPUP_WIDTH}px;
    max-width: 340px;
    font-size: 13px;
    color: ${textColor};
    pointer-events: auto;
  `;

  map.getContainer().appendChild(el);
  popupRef.current = el;

  // Build popup HTML — read fresh data from store each time
  const devClass = (props.development_class as string) ?? "—";
  const siteType = (props.site_type as string) ?? "—";
  const area = (props.area_ha as number) != null ? (props.area_ha as number).toFixed(1) : "—";
  const age = (props.age_years as number) != null ? `${props.age_years as number} yr` : "—";
  const volume = (props.volume_m3 as number) != null ? (props.volume_m3 as number).toFixed(0) : "—";
  const basalArea = (props.basal_area as number) != null ? (props.basal_area as number).toFixed(1) : "—";
  const avgDiam = (props.avg_diameter as number) != null ? (props.avg_diameter as number).toFixed(1) : "—";
  const avgHt = (props.avg_height as number) != null ? (props.avg_height as number).toFixed(1) : "—";

  // Look up species breakdown from store
  const state = useForestStore.getState();
  const thisSpecies = state.compartmentSpecies.filter((s) => s.stand_id === standId);
  const speciesRows = thisSpecies
    .map((s) => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:1.5">
      <span>${s.species}</span>
      <span style="color:${mutedColor};text-align:right">${s.volume_m3.toFixed(0)} m³ / ${s.area_ha.toFixed(1)} ha</span>
    </div>`)
    .join("");

  // Look up operations for this stand from store
  const compartmentId = props.id as string;
  const thisOps = state.operations.filter((op) => op.compartment_id === compartmentId);
  const opsRows = thisOps
    .map((op) => {
      const valueStr = op.income_eur != null && op.income_eur > 0
        ? `+${op.income_eur.toFixed(0)}€`
        : op.cost_eur != null && op.cost_eur > 0
          ? `−${op.cost_eur.toFixed(0)}€`
          : "";
      return `<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:1.5">
        <span>${op.type} ${op.year}</span>
        <span style="color:${mutedColor};text-align:right">${valueStr}</span>
      </div>`;
    })
    .join("");

  el.innerHTML = `
    <div style="position:relative">
      <button class="popup-close" style="position:absolute;top:1px;right:1px;border:none;background:transparent;font-size:18px;cursor:pointer;color:${closeBtnColor};line-height:1;width:20px;height:20px;display:flex;align-items:center;justify-content:center;border-radius:4px">×</button>
      <h3 style="font-weight:600;font-size:15px;margin:0 0 8px 0;padding-bottom:4px;border-bottom:1px solid ${borderColor};color:${textColor}">Stand ${standId}</h3>

      <h4 style="font-weight:500;font-size:12px;margin:0 0 3px 0;color:${sectionTitleColor};text-transform:uppercase;letter-spacing:0.5px">Stand details</h4>
      <div style="margin:0 0 8px 0">
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:1.5"><span style="color:${labelColor}">Dev. class</span><span style="color:${mutedColor};text-align:right">${devClass}</span></div>
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:1.5"><span style="color:${labelColor}">Site type</span><span style="color:${mutedColor};text-align:right">${siteType}</span></div>
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:1.5"><span style="color:${labelColor}">Area (ha)</span><span style="color:${mutedColor};text-align:right">${area}</span></div>
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:1.5"><span style="color:${labelColor}">Age</span><span style="color:${mutedColor};text-align:right">${age}</span></div>
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:1.5"><span style="color:${labelColor}">Volume (m³)</span><span style="color:${mutedColor};text-align:right">${volume}</span></div>
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:1.5"><span style="color:${labelColor}">Basal area</span><span style="color:${mutedColor};text-align:right">${basalArea}</span></div>
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:1.5"><span style="color:${labelColor}">Avg diam.</span><span style="color:${mutedColor};text-align:right">${avgDiam} cm</span></div>
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:1.5"><span style="color:${labelColor}">Avg height</span><span style="color:${mutedColor};text-align:right">${avgHt} m</span></div>
      </div>

      ${speciesRows ? `
      <h4 style="font-weight:500;font-size:12px;margin:0 0 3px 0;color:${sectionTitleColor};text-transform:uppercase;letter-spacing:0.5px">Species</h4>
      <div style="margin:0 0 8px 0">${speciesRows}</div>` : ""}

      ${opsRows ? `
      <h4 style="font-weight:500;font-size:12px;margin:0 0 3px 0;color:${sectionTitleColor};text-transform:uppercase;letter-spacing:0.5px">Operations</h4>
      <div>${opsRows}</div>` : ""}
    </div>
  `;

  // Wire up close button
  const closeBtn = el.querySelector(".popup-close") as HTMLElement | null;
  if (closeBtn) {
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      hideCustomPopup(popupRef);
    };
    closeBtn.onmouseenter = () => {
      closeBtn.style.backgroundColor = closeBtnHoverBg;
    };
    closeBtn.onmouseleave = () => {
      closeBtn.style.backgroundColor = "transparent";
    };
  }
 }

/** Compute the screen-space bounding box of a GeoJSON polygon geometry. */
function getPolygonScreenBounds(
  map: maplibregl.Map,
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon
): { left: number; top: number; right: number; bottom: number } {
  const coords =
    geom.type === "Polygon"
      ? geom.coordinates[0]
      : geom.coordinates.flatMap((ring) => ring[0]);
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const [lng, lat] of coords as [number, number][]) {
    const pt = map.project([lng, lat]);
    if (pt.x < left) left = pt.x;
    if (pt.y < top) top = pt.y;
    if (pt.x > right) right = pt.x;
    if (pt.y > bottom) bottom = pt.y;
  }
  return { left, top, right, bottom };
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
export default function StandLayer({ map, compartments, styleVersion = 0, isDark = false }: StandLayerProps) {
  const popupRef = useRef<HTMLElement | null>(null);
  const hasZoomed = useRef(false);
  const clickedStandRef = useRef<string | null>(null); // non-null = selection came from map click
  const useAgeColor = shouldUseAgeColoring(compartments.features);

  // Zustand state for cross-panel interaction
  const selectedStandId = useForestStore((s) => s.selectedStandId);
  const highlightedStandIds = useForestStore((s) => s.highlightedStandIds);
  const selectStand = useForestStore((s) => s.selectStand);
  const setHighlightedStands = useForestStore((s) => s.setHighlightedStands);
  const activeMainTab = useForestStore((s) => s.activeMainTab);

  // When highlighting changes (e.g. from list row click), close popup if
  // the selected stand no longer matches the highlight
  useEffect(() => {
    if (!selectedStandId) return;
    if (highlightedStandIds.length === 0 || !highlightedStandIds.includes(selectedStandId)) {
      hideCustomPopup(popupRef);
      selectStand(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedStandIds]);

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
        const containerRect = map.getContainer().getBoundingClientRect();
        const clickedFeatures = map.queryRenderedFeatures(e.point, { layers: ["stand-fills"] });
        const clickedGeom = clickedFeatures[0]?.geometry;
        const polyBounds = clickedGeom
          ? getPolygonScreenBounds(map, clickedGeom as unknown as GeoJSON.Polygon | GeoJSON.MultiPolygon)
          : { left: map.project(lngLat).x, top: map.project(lngLat).y, right: map.project(lngLat).x, bottom: map.project(lngLat).y };
        showCustomPopup(map, popupRef, props, polyBounds, containerRect, isDark);
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
  // Skip if map tab is not active — popup uses getBoundingClientRect which fails on hidden elements
  useEffect(() => {
    if (!map || !selectedStandId || activeMainTab !== "map") return;

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const featGeom = feature.geometry as any;
      const props = feature.properties as Record<string, unknown>;

      const onMoveEnd = () => {
        if (useForestStore.getState().selectedStandId !== selectedStandId) return;
        const containerRect = map.getContainer().getBoundingClientRect();
        const polyBounds = getPolygonScreenBounds(map, featGeom);
        showCustomPopup(map, popupRef, props, polyBounds, containerRect, isDark);
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
  }, [map, selectedStandId, compartments, activeMainTab]);

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