"use client";

import { useEffect, useRef, useCallback } from "react";
import maplibregl from "maplibre-gl";
import { createRoot } from "react-dom/client";
import type { CompartmentFeatureCollection } from "@/types/database";
import StandPopup from "./StandPopup";

// Finnish → English development class mapping
const FI_TO_EN: Record<string, string> = {
  Taimikko: "seedling",
  "Nuori kasvatusmetsikkö": "young_thinning",
  "Varttunut kasvatusmetsikkö": "mature_thinning",
  Uudistuskypsä: "regeneration_ready",
  "Eri-ikäisrakenteinen": "uneven_aged",
  Suojuspuusto: "shelterwood",
};

// English → hex color mapping
const EN_TO_COLOR: Record<string, string> = {
  seedling: "#90EE90",
  young_thinning: "#228B22",
  mature_thinning: "#006400",
  regeneration_ready: "#FFD700",
  uneven_aged: "#9370DB",
  shelterwood: "#8B4513",
};

export interface StandLayerProps {
  map: maplibregl.Map | null;
  compartments: CompartmentFeatureCollection;
}

/**
 * Renders forest stand polygons on a MapLibre map and handles
 * click-to-inspect via popups.
 */
export default function StandLayer({ map, compartments }: StandLayerProps) {
  const popupRef = useRef<maplibregl.Popup | null>(null);

  const buildMatchExpression = useCallback((): maplibregl.Expression => {
    // Build a MapLibre match expression: ["match", ["get", "development_class"],
    //   "Taimikko", "#90EE90", ..., "#CCCCCC"]
    const pairs: unknown[] = ["match", ["get", "development_class"]];
    for (const [fi, en] of Object.entries(FI_TO_EN)) {
      pairs.push(fi);
      pairs.push(EN_TO_COLOR[en] ?? "#CCCCCC");
    }
    pairs.push("#CCCCCC"); // default fallback
    return pairs as unknown as maplibregl.Expression;
  }, []);

  useEffect(() => {
    if (!map) return;

    const SOURCE_ID = "stands";
    const LAYER_ID = "stands-fill";

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
    };

    // Wait for style to load before adding source/layer
    if (map.isStyleLoaded()) {
      addStandLayer();
    } else {
      map.once("style.load", addStandLayer);
    }

    // Hover cursor
    const setPointer = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const resetCursor = () => {
      map.getCanvas().style.cursor = "";
    };

    map.on("mouseenter", LAYER_ID, setPointer);
    map.on("mouseleave", LAYER_ID, resetCursor);

    // Click handler on stands layer
    const handleStandClick = (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;

      const props = feature.properties as Record<string, unknown>;
      const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];

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

    map.on("click", LAYER_ID, handleStandClick);

    // Close popup on map background click
    const handleBackgroundClick = (e: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [LAYER_ID],
      });
      if (features.length === 0) {
        popupRef.current?.remove();
      }
    };

    map.on("click", handleBackgroundClick);

    return () => {
      map.off("mouseenter", LAYER_ID, setPointer);
      map.off("mouseleave", LAYER_ID, resetCursor);
      map.off("click", LAYER_ID, handleStandClick);
      map.off("click", handleBackgroundClick);
      popupRef.current?.remove();
    };
  }, [map, compartments, buildMatchExpression]);

  // Update source data when compartments change
  useEffect(() => {
    if (!map) return;
    const source = map.getSource("stands") as maplibregl.GeoJSONSource | undefined;
    if (source?.setData) {
      source.setData(compartments);
    }
  }, [map, compartments]);

  return null; // No DOM — pure map-side effect
}
