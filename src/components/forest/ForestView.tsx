"use client";

import { useCompartments } from "@/lib/hooks/use-compartments";
import { useForest } from "@/lib/hooks/use-forest";
import { useForestStore } from "@/lib/store";
import { compartmentsToGeoJSON } from "@/lib/map/geojson";
import { useEffect, useState, Suspense } from "react";
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

/**
 * Orchestrates data loading and map rendering for a forest.
 *
 * Geometry detection: when using the `get_compartments_geojson` RPC,
 * geometry comes as a JSON object. When using the fallback direct query,
 * geometry is a WKB hex string — not renderable. We detect by checking
 * if geometry has a `type` property (GeoJSON) rather than being a string (WKB).
 */
export default function ForestView({ forestId }: ForestViewProps) {
  const { data: forest } = useForest(forestId);
  const { data: compartments, error: compartmentsError } =
    useCompartments(forestId);
  const { setForest, setCompartments } = useForestStore();

  // Sync Supabase data to Zustand store
  useEffect(() => {
    if (forest) setForest(forest);
  }, [forest, setForest]);

  useEffect(() => {
    if (compartments.length > 0) setCompartments(compartments);
  }, [compartments, setCompartments]);

  const [map, setMap] = useState<maplibregl.Map | null>(null);

  // Detect if geometry is proper GeoJSON (has "type" property) or WKB string
  const hasGeoJSON = compartments.some(
    (c) =>
      c.geometry !== null &&
      typeof c.geometry === "object" &&
      "type" in (c.geometry as unknown as Record<string, unknown>)
  );

  const geojson = hasGeoJSON
    ? compartmentsToGeoJSON(compartments)
    : testCompartments;

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
      <StandLayer map={map} compartments={geojson} />
      <StandLegend />

      {/* Warning when using test data */}
      {!hasGeoJSON && compartments.length > 0 && (
        <div className="absolute top-4 left-4 z-10 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-800 max-w-xs">
          Showing sample data. Run migration{" "}
          <code className="bg-amber-100 px-1 rounded">003_geojson_rpc.sql</code>{" "}
          in Supabase SQL Editor to see real stands.
        </div>
      )}

      {compartmentsError && (
        <div className="absolute top-4 left-4 z-10 bg-red-50 border border-red-200 rounded-md px-3 py-2 text-xs text-red-700 max-w-xs">
          {compartmentsError}
        </div>
      )}
    </div>
  );
}