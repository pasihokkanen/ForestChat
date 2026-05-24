"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";

const LIGHT_STYLE = "/styles/liberty.json";
const DARK_STYLE = "/styles/dark.json";

export interface MapViewProps {
  onMapReady?: (map: maplibregl.Map) => void;
  /** Fired after each style change (initial load + runtime dark/light toggle). */
  onStyleChange?: (params: { isDark: boolean; styleVersion: number }) => void;
}

export default function MapView({ onMapReady, onStyleChange }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  // null = unknown (OS preference not read yet); bool = known
  const [isDark, setIsDark] = useState<boolean | null>(null);
  const styleVersion = useRef(0);
  const initialStyleSent = useRef(false);

  // Store callbacks in refs to avoid infinite re-render loops
  // when parent passes inline arrow functions as props.
  const onMapReadyRef = useRef(onMapReady);
  onMapReadyRef.current = onMapReady;
  const onStyleChangeRef = useRef(onStyleChange);
  onStyleChangeRef.current = onStyleChange;

  // 1) Detect OS dark mode on mount & listen for runtime changes
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setIsDark(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // 2) Create the map ONLY after we know the theme (prevents flash of wrong style)
  useEffect(() => {
    if (!mapContainer.current || map.current) return;
    if (isDark === null) return; // still waiting for OS preference

    const m = new maplibregl.Map({
      container: mapContainer.current,
      style: isDark ? DARK_STYLE : LIGHT_STYLE,
      center: [24.0, 62.5],
      zoom: 6,
      cooperativeGestures: false,
    });

    map.current = m;

    // Fire initial onStyleChange after the style loads
    m.once("style.load", () => {
      styleVersion.current += 1;
      onStyleChangeRef.current?.({
        isDark: isDark as boolean,
        styleVersion: styleVersion.current,
      });
    });

    // Controls
    m.addControl(new maplibregl.NavigationControl(), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    m.addControl(new maplibregl.GeolocateControl({}), "top-right");
    m.addControl(new maplibregl.FullscreenControl(), "top-right");

    onMapReadyRef.current?.(m);

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      m.resize();
    });
    resizeObserver.observe(mapContainer.current);

    return () => {
      resizeObserver.disconnect();
      m.remove();
      map.current = null;
    };
    // Only depend on isDark — callbacks use refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark]);

  // 3) Handle runtime theme switches only (NOT the initial render)
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!initialStyleSent.current) {
      // Initial style was handled by Effect 2 — skip first run
      initialStyleSent.current = true;
      return;
    }

    m.setStyle(isDark ? DARK_STYLE : LIGHT_STYLE);
    m.once("style.load", () => {
      styleVersion.current += 1;
      onStyleChangeRef.current?.({
        isDark: isDark as boolean,
        styleVersion: styleVersion.current,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark]);

  return (
    <div
      ref={mapContainer}
      role="region"
      aria-label="Map"
      className="w-full h-full"
    />
  );
}