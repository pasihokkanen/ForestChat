"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

export interface MapViewProps {
  onMapReady?: (map: maplibregl.Map) => void;
}

export default function MapView({ onMapReady }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!mapContainer.current || map.current) {
      return;
    }

    const m = new maplibregl.Map({
      container: mapContainer.current,
      style: "/styles/liberty.json",
      center: [24.0, 62.5],
      zoom: 6,
      cooperativeGestures: false,
    });

    map.current = m;

    m.addControl(new maplibregl.NavigationControl(), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    m.addControl(new maplibregl.GeolocateControl({}), "top-right");
    m.addControl(new maplibregl.FullscreenControl(), "top-right");

    if (onMapReady) {
      onMapReady(m);
    }

    const resizeObserver = new ResizeObserver(() => {
      m.resize();
    });

    resizeObserver.observe(mapContainer.current);

    return () => {
      resizeObserver.disconnect();
      m.remove();
      map.current = null;
    };
  }, [onMapReady]);

  return (
    <div
      ref={mapContainer}
      role="region"
      aria-label="Map"
      className="w-full h-full"
    />
  );
}
