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
 * Falls back to test data when Supabase has no geometry data yet.
 */
export default function ForestView({ forestId }: ForestViewProps) {
  const { data: forest } = useForest(forestId);
  const { data: compartments } = useCompartments(forestId);
  const { setForest, setCompartments } = useForestStore();

  // Sync Supabase data to Zustand store
  useEffect(() => {
    if (forest) setForest(forest);
  }, [forest, setForest]);

  useEffect(() => {
    if (compartments.length > 0) setCompartments(compartments);
  }, [compartments, setCompartments]);

  const [map, setMap] = useState<maplibregl.Map | null>(null);

  // Use real data if compartments have geometry, otherwise test data
  const hasGeometry = compartments.some((c) => c.geometry !== null);
  const geojson = hasGeometry
    ? compartmentsToGeoJSON(compartments)
    : testCompartments;

  return (
    <div className="relative w-full h-full">
      <Suspense fallback={<div className="w-full h-full flex items-center justify-center text-gray-500">Loading map...</div>}>
        <MapView onMapReady={setMap} />
      </Suspense>
      <StandLayer map={map} compartments={geojson} />
      <StandLegend />
      {/* Chat panel placeholder — Phase 3 */}
    </div>
  );
}
