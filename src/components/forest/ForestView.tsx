"use client";

import { useCompartments } from "@/lib/hooks/use-compartments";
import { useForest } from "@/lib/hooks/use-forest";
import { useCharts } from "@/lib/hooks/use-charts";
import { useOperations } from "@/lib/hooks/use-operations";
import { useCompartmentSpecies } from "@/lib/hooks/use-compartment-species";
import { usePlanMetadata } from "@/lib/hooks/use-plan-metadata";
import { useForestStore } from "@/lib/store";
import { compartmentsToGeoJSON, fitBoundsToFeatures } from "@/lib/map/geojson";
import type { CompartmentFeatureCollection } from "@/types/database";
import { useEffect, useState, useRef, Suspense } from "react";
import dynamic from "next/dynamic";
import StandLayer from "@/components/map/StandLayer";
import StandLegend from "@/components/map/StandLegend";
import ChatPanel from "@/components/chat/ChatPanel";
import PanelLayout from "@/components/layout/PanelLayout";
import ChartsPanel from "@/components/charts/ChartsPanel";
import StandList from "@/components/forest/StandList";
import OperationList from "@/components/forest/OperationList";
import { testCompartments } from "@/lib/test-data";
import type maplibregl from "maplibre-gl";

const MapView = dynamic(() => import("@/components/map/MapView"), {
  ssr: false,
});

interface ForestViewProps {
  forestId: string;
}

/** Zoom-to-property crosshair SVG icon — distinct from fullscreen (outward arrows). */
const CROSSHAIR_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" width="20" height="20">
  <circle cx="12" cy="12" r="8.5"/>
  <line x1="12" y1="2.5" x2="12" y2="7"/>
  <line x1="12" y1="17" x2="12" y2="21.5"/>
  <line x1="2.5" y1="12" x2="7" y2="12"/>
  <line x1="17" y1="12" x2="21.5" y2="12"/>
  <circle cx="12" cy="12" r="3" fill="currentColor"/>
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
  useOperations(forestId);
  useCompartmentSpecies(forestId);
  usePlanMetadata(forestId);
  const setForest = useForestStore((s) => s.setForest);
  const setCompartments = useForestStore((s) => s.setCompartments);

  // Load chart tabs from Supabase
  useCharts(forestId);

  // Sync Supabase data to Zustand store
  useEffect(() => {
    if (forest) setForest(forest);
  }, [forest, setForest]);

  useEffect(() => {
    if (compartments.length > 0) setCompartments(compartments);
  }, [compartments, setCompartments]);

  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [mapStyleVersion, setMapStyleVersion] = useState(0);
  const [isDark, setIsDark] = useState(false);

  // Handle onMapReady with pending stand selection
  const handleMapReady = (mapInstance: maplibregl.Map) => {
    setMap(mapInstance);
    // Apply any pending selection from "Show on map" clicks before map was ready
    const pending = useForestStore.getState().consumePendingSelection();
    if (pending) {
      // Small delay to let StandLayer render before selecting
      setTimeout(() => {
        useForestStore.getState().selectStand(pending);
        useForestStore.getState().setHighlightedStands([pending]);
      }, 300);
    }
  };

  // Use real compartments if they have geometry, otherwise test data
  // Only fall back to test data after loading completes (avoid flash)
  const EMPTY_GEOJSON: CompartmentFeatureCollection = { type: "FeatureCollection", features: [] };
  const hasGeometry = compartments.some((c) => c.geometry !== null);
  const geojson = hasGeometry
    ? compartmentsToGeoJSON(compartments)
    : compartmentsLoading
      ? EMPTY_GEOJSON
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
      fitBoundsToFeatures(map, geojson);
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
    <PanelLayout
      chartsPanel={<ChartsPanel />}
      tabs={{
        map: (
          <div className="flex-1 relative min-w-0 h-full">
            <Suspense
              fallback={
                <div className="w-full h-full flex items-center justify-center text-gray-500">
                  Loading map...
                </div>
              }
            >
              <MapView
                onMapReady={handleMapReady}
                onStyleChange={({ isDark, styleVersion }) => {
                  setMapStyleVersion(styleVersion);
                  setIsDark(isDark);
                }}
              />
            </Suspense>
            <StandLayer map={map} compartments={geojson} styleVersion={mapStyleVersion} isDark={isDark} />
            <StandLegend compartments={geojson} />

            {compartmentsError && (
              <div className="absolute top-4 left-4 z-10 bg-red-50 border border-red-200 rounded-md px-3 py-2 text-xs text-red-700 max-w-xs">
                {compartmentsError}
              </div>
            )}
          </div>
        ),
        stands: <StandList map={map} />,
        operations: <OperationList map={map} />,
      }}
      chatPanel={<ChatPanel forestId={forestId} />}
    />
  );
}
