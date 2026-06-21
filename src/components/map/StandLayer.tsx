"use client";

import { useEffect, useRef, useCallback, useMemo } from "react";
import maplibregl from "maplibre-gl";
import type { CompartmentFeatureCollection } from "@/types/database";
import { fitBoundsToFeatures } from "@/lib/map/geojson";
import { useForestStore } from "@/lib/store";
import { displayDevClass, displaySiteType, displaySpecies, displayOp, popupLabels } from "@/lib/i18n";

// Age-based color palette (warm=young → cool=old)
export const AGE_COLORS = [
  "#ffffb2", // 0-10: pale yellow
  "#fecc5c", // 11-20
  "#fd8d3c", // 21-40
  "#f03b20", // 41-60
  "#bd0026", // 61-80
  "#4a1486", // 81-100
  "#1a0a3e", // 101+: deep purple
];

/** Compute age bracket boundaries from the compartment features. */
export function computeAgeBrackets(
  features: CompartmentFeatureCollection["features"]
): { min: number; max: number; bracketSize: number } {
  const ages: number[] = [];
  for (const f of features) {
    const age = f.properties?.age_years as number | undefined;
    if (age != null && age > 0) ages.push(age);
  }
  const min = ages.length > 0 ? Math.min(...ages) : 0;
  const max = ages.length > 0 ? Math.max(...ages) : 100;
  const bracketSize = Math.max(10, Math.floor((max - min) / (AGE_COLORS.length - 1)));
  return { min, max, bracketSize };
}

export interface StandLayerProps {
  map: maplibregl.Map | null;
  compartments: CompartmentFeatureCollection;
  /** Incremented on every map style switch so the layer re-registers. */
  styleVersion?: number;
  /** Whether the map is in dark mode (for popup theming). */
  isDark?: boolean;
}

function forestHueColor(forestId: string): string {
  const hue = parseInt(forestId.slice(0, 8), 16) % 360;
  return `hsl(${hue}, 70%, 45%)`;
}

function syncForestOutlineLayers(map: maplibregl.Map, activeForestIds: string[]) {
  const STANDS_SOURCE = "stands";

  const existingLayers = map.getStyle()?.layers ?? [];
  const oldOutlineIds = existingLayers
    .filter((l) => l.id.startsWith("stands-outline-"))
    .map((l) => l.id);

  for (const id of oldOutlineIds) {
    try { if (map.getLayer(id)) map.removeLayer(id); } catch { /* skip */ }
  }

  if (activeForestIds.length <= 1) return;

  for (const forestId of activeForestIds) {
    const layerId = `stands-outline-${forestId}`;
    const color = forestHueColor(forestId);
    try {
      if (map.getLayer(layerId)) continue;
      if (!map.getSource(STANDS_SOURCE)) continue;
      map.addLayer({
        id: layerId,
        type: "line",
        source: STANDS_SOURCE,
        filter: ["==", ["get", "forest_id"], forestId],
        paint: {
          "line-color": color,
          "line-width": 2,
          "line-opacity": 0.8,
        },
      });
    } catch { /* skip */ }
  }
}

// ── Persisted popup position — remembered across open/close, default top-left ──
const popupPos = { left: 12, top: 12 };

/** Show a custom popup overlay for a forest stand. Uses store data for species and operations.
 *  Position persists across open/close; draggable by the header. */
function showCustomPopup(
   map: maplibregl.Map,
   popupRef: React.MutableRefObject<HTMLElement | null>,
   props: Record<string, unknown>,
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

  const POPUP_WIDTH = 280;

  // Create overlay container — append to map container, position from top-left
  const el = document.createElement("div");
  el.className = "forestchat-custom-popup";
  el.style.cssText = `
    position: absolute;
    z-index: 1000;
    left: ${popupPos.left}px;
    top: ${popupPos.top}px;
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
    cursor: default;
  `;

  map.getContainer().appendChild(el);
  popupRef.current = el;

  // Look up species breakdown from store
  const state = useForestStore.getState();
  const lang = state.language ?? "en";

  const popupForestId = props.forest_id as string | undefined;
  const forestName = popupForestId
    ? (state.forests.find((f) => f.id === popupForestId)?.name ?? "")
    : "";

  // Build popup HTML — read fresh data from store each time
  const devClass = (displayDevClass(props.development_class as string, lang)) ?? "—";
  const siteType = (displaySiteType(props.site_type as string, lang)) ?? "—";
  const area = (props.area_ha as number) != null ? (props.area_ha as number).toFixed(1) : "—";
  const age = (props.age_years as number) != null ? `${props.age_years as number} yr` : "—";
  const volume = (props.volume_m3 as number) != null ? (props.volume_m3 as number).toFixed(0) : "—";
  const basalArea = (props.basal_area as number) != null ? (props.basal_area as number).toFixed(1) : "—";
  const avgDiam = (props.avg_diameter as number) != null ? (props.avg_diameter as number).toFixed(1) : "—";
  const avgHt = (props.avg_height as number) != null ? (props.avg_height as number).toFixed(1) : "—";

  // Look up species breakdown from store
  const thisSpecies = state.compartmentSpecies.filter((s) => s.stand_id === standId);
  const speciesRows = thisSpecies
    .map((s) => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:1.5">
      <span>${displaySpecies(s.species, lang)}</span>
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
        <span>${displayOp(op.type, lang)} ${op.year}</span>
        <span style="color:${mutedColor};text-align:right">${valueStr}</span>
      </div>`;
    })
    .join("");

  const pl = popupLabels(lang);

  el.innerHTML = `
    <div style="position:relative">
      <button class="popup-close" style="position:absolute;top:1px;right:1px;border:none;background:transparent;font-size:18px;cursor:pointer;color:${closeBtnColor};line-height:1;width:20px;height:20px;display:flex;align-items:center;justify-content:center;border-radius:4px;z-index:1">×</button>
      <h3 class="popup-drag-handle" style="font-weight:600;font-size:15px;margin:0 0 4px 0;padding:4px 20px 4px 0;color:${textColor};cursor:grab;user-select:none">${pl.standPrefix} ${standId}</h3>
      ${forestName ? `<div style="font-size:12px;color:${mutedColor};margin:0 0 8px 0;padding-bottom:6px;border-bottom:1px solid ${borderColor}">${forestName}</div>` : `<div style="border-bottom:1px solid ${borderColor};margin:0 0 8px 0"></div>`}

      <h4 style="font-weight:500;font-size:12px;margin:0 0 3px 0;color:${sectionTitleColor};text-transform:uppercase;letter-spacing:0.5px">${pl.standDetails}</h4>
      <div style="margin:0 0 8px 0">
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:1.5"><span style="color:${labelColor}">${pl.devClass}</span><span style="color:${mutedColor};text-align:right">${devClass}</span></div>
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:1.5"><span style="color:${labelColor}">${pl.siteType}</span><span style="color:${mutedColor};text-align:right">${siteType}</span></div>
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:1.5"><span style="color:${labelColor}">${pl.areaHa}</span><span style="color:${mutedColor};text-align:right">${area}</span></div>
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:1.5"><span style="color:${labelColor}">${pl.age}</span><span style="color:${mutedColor};text-align:right">${age}</span></div>
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:1.5"><span style="color:${labelColor}">${pl.volumeM3}</span><span style="color:${mutedColor};text-align:right">${volume}</span></div>
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:1.5"><span style="color:${labelColor}">${pl.basalArea}</span><span style="color:${mutedColor};text-align:right">${basalArea}</span></div>
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:1.5"><span style="color:${labelColor}">${pl.avgDiam}</span><span style="color:${mutedColor};text-align:right">${avgDiam} cm</span></div>
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:1.5"><span style="color:${labelColor}">${pl.avgHeight}</span><span style="color:${mutedColor};text-align:right">${avgHt} m</span></div>
      </div>

      ${speciesRows ? `
      <h4 style="font-weight:500;font-size:12px;margin:0 0 3px 0;color:${sectionTitleColor};text-transform:uppercase;letter-spacing:0.5px">${pl.species}</h4>
      <div style="margin:0 0 8px 0">${speciesRows}</div>` : ""}

      ${opsRows ? `
      <h4 style="font-weight:500;font-size:12px;margin:0 0 3px 0;color:${sectionTitleColor};text-transform:uppercase;letter-spacing:0.5px">${pl.operations}</h4>
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

  // ── Drag-to-reposition ──
  const dragHandle = el.querySelector(".popup-drag-handle") as HTMLElement | null;
  if (dragHandle) {
    let dragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    const onDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.closest(".popup-close")) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = el.offsetLeft;
      startTop = el.offsetTop;
      dragHandle.style.cursor = "grabbing";
      e.preventDefault();
    };

    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      el.style.left = (startLeft + dx) + "px";
      el.style.top = (startTop + dy) + "px";
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      dragHandle.style.cursor = "grab";
      // Persist position
      popupPos.left = el.offsetLeft;
      popupPos.top = el.offsetTop;
    };

    dragHandle.addEventListener("mousedown", onDown);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
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
export default function StandLayer({ map, compartments, styleVersion = 0, isDark = false }: StandLayerProps) {
  const popupRef = useRef<HTMLElement | null>(null);
  const hasZoomed = useRef(false);
  const suppressZoomRef = useRef(false);

  // Compute age brackets once per compartment change
  const ageBrackets = useMemo(
    () => computeAgeBrackets(compartments.features),
    [compartments.features]
  );

  // Zustand state for cross-panel interaction
  const selectedStandId = useForestStore((s) => s.selectedStandId);
  const highlightedStandIds = useForestStore((s) => s.highlightedStandIds);
  const selectStand = useForestStore((s) => s.selectStand);
  const setHighlightedStands = useForestStore((s) => s.setHighlightedStands);
  const activeMainTab = useForestStore((s) => s.activeMainTab);
  const activeForestIds = useForestStore((s) => s.activeForestIds);
  const forestHueColorRef = useRef(forestHueColor);
  forestHueColorRef.current = forestHueColor;

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

  // Sync popup with multi-selection from non-map-click sources (lists, charts, AI).
  // Map-clicks handle their own popup directly in the click handler;
  // this effect is idempotent — calling selectStand/showCustomPopup when
  // already set is harmless (showCustomPopup replaces any existing popup).
  useEffect(() => {
    if (!map || activeMainTab !== "map") return;

    if (highlightedStandIds.length === 1) {
      // Single stand selected — sync selectedStandId (zoom effect handles popup)
      const standId = highlightedStandIds[0];
      // Only update if different, to avoid triggering zoom when map click
      // already handled everything
      const currentSelected = useForestStore.getState().selectedStandId;
      if (currentSelected !== standId) {
        selectStand(standId);
      }
    } else if (highlightedStandIds.length !== 1) {
      // No selection or multiple selected — hide popup
      hideCustomPopup(popupRef);
      if (useForestStore.getState().selectedStandId !== null) {
        selectStand(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedStandIds, map, activeMainTab]);

  // Build MapLibre step expression for age-based fill-color.
  const buildMatchExpression = useCallback((): maplibregl.Expression => {
    const { min, bracketSize } = ageBrackets;

    // Build step expression: [step, ["to-number", ["get", "age_years"]], youngest_color, step1, color1, ...]
    const steps: unknown[] = ["step", ["to-number", ["get", "age_years"]]];
    steps.push(AGE_COLORS[0]); // default / youngest

    for (let i = 1; i < AGE_COLORS.length; i++) {
      steps.push(min + bracketSize * i);
      steps.push(AGE_COLORS[i]);
    }
    return steps as unknown as maplibregl.Expression;
  }, [ageBrackets]);

  // Refs to provide current data to the style.load handler without
  // triggering full layer rebuilds when compartments or expression change.
  // Those are handled by separate in-place update effects below.
  const compartmentsRef = useRef(compartments);
  compartmentsRef.current = compartments;
  const buildMatchExpressionRef = useRef(buildMatchExpression);
  buildMatchExpressionRef.current = buildMatchExpression;

  // Register source + layers ONLY on style.load (initial mount + theme toggle).
  // compartment changes → setData effect (no rebuild)
  // expression changes → setPaintProperty effect (no rebuild)
  useEffect(() => {
    if (!map) return;

    const SOURCE_ID = "stands";
    const LAYER_ID = "stands-fill";

    // Rebuild layers on every style load (initial + setStyle).
    // Reads current highlight state from the store so rebuilt layers
    // preserve any active selection.
    const onStyleLoad = () => {
      try {
        for (const id of ["stands-highlight", "stands-highlight-fill", LAYER_ID]) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        const existingLayers = map.getStyle()?.layers ?? [];
        for (const l of existingLayers) {
          if ((l.id as string).startsWith("stands-outline-")) {
            try { if (map.getLayer(l.id as string)) map.removeLayer(l.id as string); } catch { /* skip */ }
          }
        }
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);

        map.addSource(SOURCE_ID, { type: "geojson", data: compartmentsRef.current });

        map.addLayer({
          id: LAYER_ID,
          type: "fill",
          source: SOURCE_ID,
          paint: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            "fill-color": buildMatchExpressionRef.current() as any,
            "fill-opacity": 0.6,
            "fill-outline-color": "#333",
          },
        });

        // Compute the correct initial filter from current store state
        const hlIds = useForestStore.getState().highlightedStandIds;
        const selId = useForestStore.getState().selectedStandId;
        const ids = hlIds.length > 0
          ? hlIds
          : selId
            ? [selId]
            : [];
        const highlightFilter = ids.length > 0
          ? (["in", ["get", "stand_id"], ["literal", ids]] as any)
          : (["==", ["get", "stand_id"], ""] as any);

        map.addLayer({
          id: "stands-highlight-fill",
          type: "fill",
          source: SOURCE_ID,
          filter: highlightFilter,
          paint: { "fill-color": "#FFD700", "fill-opacity": 0.3 },
        });

        map.addLayer({
          id: "stands-highlight",
          type: "line",
          source: SOURCE_ID,
          filter: highlightFilter,
          paint: { "line-color": "#FFD700", "line-width": 4, "line-opacity": 0.9 },
        });

        const afIds = useForestStore.getState().activeForestIds;
        if (afIds.length > 1) {
          for (const forestId of afIds) {
            const color = forestHueColorRef.current(forestId);
            map.addLayer({
              id: `stands-outline-${forestId}`,
              type: "line",
              source: SOURCE_ID,
              filter: ["==", ["get", "forest_id"], forestId],
              paint: { "line-color": color, "line-width": 2, "line-opacity": 0.8 },
            });
          }
        }
      } catch { /* transitional — next style.load will retry */ }
    };

    // If style is already loaded, register immediately. Otherwise wait.
    if (map.isStyleLoaded()) {
      onStyleLoad();
    }
    map.on("style.load", onStyleLoad);

    return () => {
      map.off("style.load", onStyleLoad);
    };
  }, [map]);

  // Update source data in-place when compartments change — no layer rebuild.
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

  // Update fill-color paint property in-place when expression changes.
  useEffect(() => {
    if (!map) return;
    try {
      if (map.getLayer("stands-fill")) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.setPaintProperty("stands-fill", "fill-color", buildMatchExpression() as any);
      }
    } catch {
      // skip
    }
  }, [map, buildMatchExpression]);

  // Mouse & click handlers — registered on the layer, re-wired when the
  // effect above rebuilds the layer (triggered by compartments / buildMatchExpression change).
  // Needs styleVersion dep to re-wire after style switches.
  useEffect(() => {
    if (!map) return;

    const LAYER_ID = "stands-fill";

    const setPointer = () => { map.getCanvas().style.cursor = "pointer"; };
    const resetCursor = () => { map.getCanvas().style.cursor = ""; };

    const handleMapClick = (e: maplibregl.MapMouseEvent) => {
      if (!map.getLayer(LAYER_ID)) return;
      const features = map.queryRenderedFeatures(e.point, { layers: [LAYER_ID] });

      if (features.length > 0) {
        const feature = features[0];
        const props = feature.properties as Record<string, unknown>;
        const standId = props.stand_id as string;
        const ctrlKey = e.originalEvent.ctrlKey || e.originalEvent.metaKey;
        const current = useForestStore.getState().highlightedStandIds;

        if (ctrlKey) {
          suppressZoomRef.current = true;
          if (current.includes(standId)) {
            const newIds = current.filter((id) => id !== standId);
            setHighlightedStands(newIds);
            if (newIds.length === 1) {
              selectStand(newIds[0]);
            } else {
              selectStand(null);
              hideCustomPopup(popupRef);
            }
          } else {
            setHighlightedStands([...current, standId]);
            selectStand(null);
            hideCustomPopup(popupRef);
          }
        } else {
          if (current.length === 1 && current[0] === standId) {
            setHighlightedStands([]);
            selectStand(null);
            hideCustomPopup(popupRef);
            return;
          }
          suppressZoomRef.current = true;
          selectStand(standId);
          setHighlightedStands([standId]);
          showCustomPopup(map, popupRef, props, isDark);
        }
      } else {
        hideCustomPopup(popupRef);
        selectStand(null);
        setHighlightedStands([]);
      }

      // Reset zoom suppression after all effects from this click have settled
      setTimeout(() => { suppressZoomRef.current = false; }, 0);
    };

    map.on("mouseenter", LAYER_ID, setPointer);
    map.on("mouseleave", LAYER_ID, resetCursor);
    map.on("click", handleMapClick);

    return () => {
      map.off("mouseenter", LAYER_ID, setPointer);
      map.off("mouseleave", LAYER_ID, resetCursor);
      map.off("click", handleMapClick);
      hideCustomPopup(popupRef);
    };
  }, [map, isDark, styleVersion]);

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

  // Update forest outline layers when activeForestIds changes
  useEffect(() => {
    if (!map) return;
    syncForestOutlineLayers(map, activeForestIds);
  }, [map, activeForestIds, styleVersion]);

  // Zoom to selected/highlighted stands when selection changes via AI or chart click.
  // Handles both single-stand (zoom + popup) and multi-stand (zoom to bounds, no popup).
  // Map clicks are suppressed — only highlight, don't zoom.
  // Skip if map tab is not active — popup uses getBoundingClientRect which fails on hidden elements.
  useEffect(() => {
    if (!map || activeMainTab !== "map") return;

    // Determine the set of stands to zoom to
    const idsToZoom = highlightedStandIds.length > 0
      ? highlightedStandIds
      : selectedStandId
        ? [selectedStandId]
        : [];

    if (idsToZoom.length === 0) return;

    // Suppress zoom for all direct map clicks — only highlight, don't move map.
    // Ref is reset via setTimeout in the click handler so it stays true through
    // the full effect cascade (zoom + sync effects may both fire from one click).
    if (suppressZoomRef.current) {
      return;
    }

    // Collect geometry for all target stands
    const features = compartments.features.filter(
      (f) => idsToZoom.includes(f.properties?.stand_id as string)
    );
    if (features.length === 0) return;

    try {
      // Compute combined bounds from all target features
      const bounds = new maplibregl.LngLatBounds();
      for (const feature of features) {
        if (!feature.geometry) continue;
        const geom = feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
        const coords =
          geom.type === "Polygon"
            ? geom.coordinates[0]
            : geom.coordinates.flatMap((ring) => ring[0]);
        for (const [lng, lat] of coords as [number, number][]) {
          bounds.extend([lng, lat]);
        }
      }

      // Cancel any in-progress animation before fitting
      map.stop();
      // Resize so the map knows its current container dimensions —
      // essential when the container was just un-hidden by a tab switch
      map.resize();
      map.fitBounds(bounds, { padding: 80, maxZoom: 16, duration: 800 });

      // Show popup ONLY for single stand — multi-stand just zooms to the area
      if (idsToZoom.length === 1) {
        const singleFeature = features[0];
        const props = singleFeature.properties as Record<string, unknown>;
        const standId = idsToZoom[0];

        const onMoveEnd = () => {
          if (useForestStore.getState().selectedStandId !== standId) return;
          showCustomPopup(map, popupRef, props, isDark);
        };
        map.once("moveend", onMoveEnd);

        return () => {
          map.stop();
          map.off("moveend", onMoveEnd);
        };
      }
    } catch {
      // Silently handle geometry format issues
    }
  }, [map, selectedStandId, highlightedStandIds, compartments, activeMainTab]);

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