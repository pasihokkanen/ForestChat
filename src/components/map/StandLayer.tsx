"use client";

import { useEffect, useRef, useCallback } from "react";
import maplibregl from "maplibre-gl";
import { createRoot } from "react-dom/client";
import type { CompartmentFeatureCollection } from "@/types/database";
import StandPopup from "./StandPopup";
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
 * Build MapLibre step stops for age-based coloring.
 */
// (inline in buildMatchExpression)

/**
 * Renders forest stand polygons on a MapLibre map and handles
 * click-to-inspect via popups.
 */
export default function StandLayer({ map, compartments, styleVersion = 0 }: StandLayerProps) {
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const hasZoomed = useRef(false);
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

    const handleStandClick = (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;

      const props = feature.properties as Record<string, unknown>;
      const standId = props.stand_id as string;
      const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];

      // Toggle selection — clicking same stand deselects
      if (selectedStandId === standId) {
        selectStand(null);
        setHighlightedStands([]);
      } else {
        selectStand(standId);
        setHighlightedStands([standId]);
      }

      if (!popupRef.current) {
        popupRef.current = new maplibregl.Popup({
          closeButton: true,
          closeOnClick: false,
          maxWidth: "300px",
        });
      }

      const container = document.createElement("div");
      const root = createRoot(container);
      root.render(
        <StandPopup
          properties={{
            id: props.id as string,
            stand_id: props.stand_id as string,
            main_species: (props.main_species as string) ?? null,
            development_class:
              (props.development_class as string) ?? null,
            site_type: (props.site_type as string) ?? null,
            area_ha: (props.area_ha as number) ?? null,
            age_years: (props.age_years as number) ?? null,
            volume_m3: (props.volume_m3 as number) ?? null,
          }}
          lngLat={lngLat}
        />,
      );

      popupRef.current.setLngLat(lngLat).setDOMContent(container).addTo(map);
    };

    const handleBackgroundClick = (e: maplibregl.MapMouseEvent) => {
      // Only query if layer exists (avoids race condition on first load)
      if (!map.getLayer(LAYER_ID)) return;
      const features = map.queryRenderedFeatures(e.point, {
        layers: [LAYER_ID],
      });
      if (features.length === 0) {
        popupRef.current?.remove();
        selectStand(null);
        setHighlightedStands([]);
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

    // Event handlers — background click is safe (guards with getLayer)
    map.on("mouseenter", LAYER_ID, setPointer);
    map.on("mouseleave", LAYER_ID, resetCursor);
    map.on("click", LAYER_ID, handleStandClick);
    map.on("click", handleBackgroundClick);

    return () => {
      map.off("mouseenter", LAYER_ID, setPointer);
      map.off("mouseleave", LAYER_ID, resetCursor);
      map.off("click", LAYER_ID, handleStandClick);
      map.off("click", handleBackgroundClick);
      popupRef.current?.remove();
    };
  }, [map, compartments, buildMatchExpression, styleVersion]);

  // Update source data when compartments change
  useEffect(() => {
    if (!map) return;
    const source = map.getSource("stands") as maplibregl.GeoJSONSource | undefined;
    if (source?.setData) {
      source.setData(compartments);
    }
  }, [map, compartments]);

  // Update highlight layer filters when selection changes (P4.6)
  useEffect(() => {
    if (!map) return;
    if (!map.getLayer("stands-highlight")) return;

    const ids = highlightedStandIds.length > 0
      ? highlightedStandIds
      : selectedStandId
        ? [selectedStandId]
        : [];

    const filter = ids.length > 0
      ? (
          ["match", ["get", "stand_id"], ["literal", ids], true, false] as maplibregl.Expression
        )
      : (["==", ["get", "stand_id"], ""] as maplibregl.Expression);

    map.setFilter("stands-highlight", filter);
    map.setFilter("stands-highlight-fill", filter);
  }, [map, selectedStandId, highlightedStandIds, styleVersion]);

  // Zoom to selected stand when selection changes via AI or chart click
  useEffect(() => {
    if (!map || !selectedStandId) return;

    // Find the feature for this stand
    const source = map.getSource("stands") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    try {
      const features = map.querySourceFeatures("stands", {
        filter: ["==", ["get", "stand_id"], selectedStandId],
      });
      if (features.length > 0 && features[0].geometry) {
        // Compute bounds from feature geometry
        const bounds = new maplibregl.LngLatBounds();
        const geom = features[0].geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
        const coords =
          geom.type === "Polygon"
            ? geom.coordinates[0]
            : geom.coordinates.flatMap((ring) => ring[0]);
        for (const [lng, lat] of coords as [number, number][]) {
          bounds.extend([lng, lat]);
        }
        map.fitBounds(bounds, { padding: 80, maxZoom: 16, duration: 800 });
      }
    } catch {
      // Silently handle geometry format issues
    }
  }, [map, selectedStandId]);

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