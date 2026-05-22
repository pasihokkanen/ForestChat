"use client";

import { useCompartments } from "@/lib/hooks/use-compartments";
import { useForest } from "@/lib/hooks/use-forest";
import { useForestStore } from "@/lib/store";
import { compartmentsToGeoJSON, fitBoundsToFeatures } from "@/lib/map/geojson";
import { useEffect, useState, useRef, Suspense } from "react";
import dynamic from "next/dynamic";
import StandLayer from "@/components/map/StandLayer";
import StandLegend from "@/components/map/StandLegend";
import { testCompartments } from "@/lib/test-data";
import type maplibregl from "maplibre-gl";

const MapView = dynamic(() => import("@/components/map/MapView"), {
  ssr: false,
});

interface ForestViewProps {
  forestId: string;
}

/** Zoom-to-property crosshair SVG icon — distinct from fullscreen (outward arrows). */
const CROSSHAIR_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18">
  <circle cx="12" cy="12" r="10"/>
  <line x1="12" y1="2" x2="12" y2="6"/>
  <line x1="12" y1="18" x2="12" y2="22"/>
  <line x1="2" y1="12" x2="6" y2="12"/>
  <line x1="18" y1="12" x2="22" y2="12"/>
  <circle cx="12" cy="12" r="2.5" fill="currentColor"/>
</svg>`;

/**
 * Orchestrates data loading and map rendering for a forest.
 *
 * Supabase returns PostGIS geometry as GeoJSON objects directly.
 * `compartmentsToGeoJSON` handles EPSG:3067→4326 CRS reprojection
 * so MapLibre renders stands at correct lat/lng coordinates.
 * Falls back to test data when no compartments have real geometry.
 */
export default function ForestView({ forestId }: ForestViewProps) {
  const { data: forest } = useForest(forestId);
  const {
    data: compartments,
    loading: compartmentsLoading,
    error: compartmentsError,
  } = useCompartments(forestId);
  const { setForest, setCompartments } = useForestStore();

  // Sync Supabase data to Zustand store
  useEffect(() => {
    if (forest) setForest(forest);
  }, [forest, setForest]);

  useEffect(() => {
    if (compartments.length > 0) setCompartments(compartments);
  }, [compartments, setCompartments]);

  const [map, setMap] = useState<maplibregl.Map | null>(null);

  // Use real compartments if they have geometry, otherwise test data
  // Only fall back to test data after loading completes (avoid flash)
  const hasGeometry = compartments.some((c) => c.geometry !== null);
  const geojson = hasGeometry
    ? compartmentsToGeoJSON(compartments)
    : compartmentsLoading
      ? null
      : testCompartments;

  // Add zoom-to-property control (crosshair icon, top-right)
  const zoomControlRef = useRef<maplibregl.IControl | null>(null);
  useEffect(() => {
    if (!map) return;

    // Remove previous control if map changes (shouldn't happen, but safe)
    if (zoomControlRef.current) {
      map.removeControl(zoomControlRef.current);
    }

    class ZoomToPropertyControl implements maplibregl.IControl {
      _container!: HTMLDivElement;
      _map!: maplibregl.Map;

      onAdd(map: maplibregl.Map): HTMLElement {
        this._map = map;
        this._container = document.createElement("div");
        this._container.className = "maplibregl-ctrl maplibregl-ctrl-group";
        this._container.innerHTML =
          `<button type="button" class="maplibregl-ctrl-zoom-to-property" title="Zoom to property" aria-label="Zoom to property">` +
          `<span class="maplibregl-ctrl-icon" aria-hidden="true">${CROSSHAIR_ICON}</span></button>`;
        this._container.addEventListener("click", (e) => {
          e.stopPropagation();
          this._map.fire("zoomtoproperty");
        });
        return this._container;
      }

      onRemove(): void {
        this._container.remove();
      }

      getDefaultPosition(): maplibregl.ControlPosition {
        return "top-right";
      }
    }

    const control = new ZoomToPropertyControl();
    map.addControl(control, "top-right");
    zoomControlRef.current = control;

    // Listen for the custom zoom event
    const handleZoomToProperty = () => {
      if (geojson) fitBoundsToFeatures(map, geojson);
    };
    map.on("zoomtoproperty", handleZoomToProperty);

    return () => {
      if (zoomControlRef.current) {
        map.removeControl(zoomControlRef.current);
        zoomControlRef.current = null;
      }
      map.off("zoomtoproperty", handleZoomToProperty);
    };
  }, [map, geojson]);

  return (
    <div className="relative w-full h-full">
      <Suspense
        fallback={
          <div className="w-full h-full flex items-center justify-center text-gray-500">
            Loading map...
          </div>
        }
      >
        <MapView onMapReady={setMap} />
      </Suspense>
      {geojson && <StandLayer map={map} compartments={geojson} />}
      <StandLegend />

      {compartmentsError && (
        <div className="absolute top-4 left-4 z-10 bg-red-50 border border-red-200 rounded-md px-3 py-2 text-xs text-red-700 max-w-xs">
          {compartmentsError}
        </div>
      )}
    </div>
  );
}