"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import dynamic from "next/dynamic";
import { useForestStore } from "@/lib/store";
import { useCompartments } from "@/lib/hooks/use-compartments";
import { useOperations } from "@/lib/hooks/use-operations";
import { useCompartmentSpecies } from "@/lib/hooks/use-compartment-species";
import { usePlanMetadata } from "@/lib/hooks/use-plan-metadata";
import { useCharts } from "@/lib/hooks/use-charts";
import { compartmentsToGeoJSON, fitBoundsToFeatures } from "@/lib/map/geojson";
import { dashboardLabels } from "@/lib/i18n";
import { testCompartments } from "@/lib/test-data";
import type { CompartmentFeatureCollection } from "@/types/database";
import type maplibregl from "maplibre-gl";
import ForestSelector from "@/components/forest/ForestSelector";
import PanelLayout from "@/components/layout/PanelLayout";
import ChartsPanel from "@/components/charts/ChartsPanel";
import StandLayer from "@/components/map/StandLayer";
import StandLegend from "@/components/map/StandLegend";
import StandList from "@/components/forest/StandList";
import OperationList from "@/components/forest/OperationList";
import Link from "next/link";

const MapView = dynamic(() => import("@/components/map/MapView"), {
  ssr: false,
});

/** Mirror the zoom-to-property crosshair icon from ForestView. */
const CROSSHAIR_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" width="20" height="20">
  <circle cx="12" cy="12" r="8.5"/>
  <line x1="12" y1="2.5" x2="12" y2="7"/>
  <line x1="12" y1="17" x2="12" y2="21.5"/>
  <line x1="2.5" y1="12" x2="7" y2="12"/>
  <line x1="17" y1="12" x2="21.5" y2="12"/>
  <circle cx="12" cy="12" r="3" fill="currentColor"/>
</svg>`;

export default function DashboardPage() {
  const forests = useForestStore((s) => s.forests);
  const activeForestIds = useForestStore((s) => s.activeForestIds);
  const language = useForestStore((s) => s.language) ?? "en";
  const L = dashboardLabels(language);

  const effectiveIds = activeForestIds.length > 0 ? activeForestIds : null;

  const {
    data: compartments,
    loading: compartmentsLoading,
    error: compartmentsError,
  } = useCompartments(effectiveIds);
  useOperations(effectiveIds);
  useCompartmentSpecies(effectiveIds);
  usePlanMetadata(effectiveIds);

  const setCompartments = useForestStore((s) => s.setCompartments);

  useCharts(activeForestIds);

  useEffect(() => {
    if (compartments.length > 0) setCompartments(compartments);
  }, [compartments, setCompartments]);

  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [mapStyleVersion, setMapStyleVersion] = useState(0);
  const [isDark, setIsDark] = useState(false);

  const handleMapReady = (mapInstance: maplibregl.Map) => {
    setMap(mapInstance);
  };

  const EMPTY_GEOJSON: CompartmentFeatureCollection = { type: "FeatureCollection", features: [] };
  const hasGeometry = compartments.some((c) => c.geometry !== null);
  const geojson = hasGeometry
    ? compartmentsToGeoJSON(compartments)
    : compartmentsLoading
      ? EMPTY_GEOJSON
      : testCompartments;

  const zoomControlRef = useRef<maplibregl.IControl | null>(null);
  useEffect(() => {
    if (!map) return;

    if (zoomControlRef.current) {
      map.removeControl(zoomControlRef.current);
    }

    class ZoomToControl implements maplibregl.IControl {
      _container!: HTMLDivElement;
      _map!: maplibregl.Map;

      onAdd(mapInstance: maplibregl.Map): HTMLElement {
        this._map = mapInstance;
        this._container = document.createElement("div");
        this._container.className = "maplibregl-ctrl maplibregl-ctrl-group";
        this._container.innerHTML =
          '<button type="button" class="maplibregl-ctrl-zoom-to-property" title="Zoom to property" aria-label="Zoom to property">' +
          `<span class="maplibregl-ctrl-icon" aria-hidden="true">${CROSSHAIR_ICON}</span></button>`;
        this._container.addEventListener("click", (e) => {
          e.stopPropagation();
          fitBoundsToFeatures(this._map, geojson);
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

    const control = new ZoomToControl();
    map.addControl(control, "top-right");
    zoomControlRef.current = control;

    return () => {
      if (zoomControlRef.current) {
        map.removeControl(zoomControlRef.current);
        zoomControlRef.current = null;
      }
    };
  }, [map, geojson]);

  if (forests.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-8 text-center max-w-md">
          <div className="text-4xl mb-3">🌲</div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {L.gettingStarted}
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 max-w-sm mx-auto">
            {L.gettingStartedDesc}
          </p>
          <Link
            href="/forest/new"
            className="mt-4 inline-block rounded-md bg-green-700 dark:bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-800 dark:hover:bg-green-700 transition-colors"
          >
            {L.importFirstForest}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <ForestSelector className="w-[240px] shrink-0 border-r border-gray-200 dark:border-gray-700" />

      <div className="flex-1 min-w-0">
        {activeForestIds.length > 0 ? (
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
                      onStyleChange={({ isDark: dark, styleVersion }) => {
                        setMapStyleVersion(styleVersion);
                        setIsDark(dark);
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
          />
        ) : (
          <div className="flex items-center justify-center h-full p-8">
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-900/50 p-8 text-center max-w-md">
              <div className="text-3xl mb-3">🌲</div>
              <h2 className="text-base font-semibold text-gray-700 dark:text-gray-300">
                {L.gettingStarted}
              </h2>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                {L.gettingStartedDesc}
              </p>
              <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
                Select forests from the sidebar to begin.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
