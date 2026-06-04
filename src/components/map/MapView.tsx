"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";

const LIGHT_STYLE = "/styles/liberty.json";
const DARK_STYLE = "/styles/dark.json";

export interface MapViewProps {
  onMapReady?: (map: maplibregl.Map) => void;
  onStyleChange?: (params: { isDark: boolean; styleVersion: number }) => void;
}

export default function MapView({ onMapReady, onStyleChange }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [isDark, setIsDark] = useState<boolean | null>(null);
  const styleVersion = useRef(0);
  const mapCreated = useRef(false);
  const roRef = useRef<ResizeObserver | null>(null);

  const onMapReadyRef = useRef(onMapReady);
  onMapReadyRef.current = onMapReady;
  const onStyleChangeRef = useRef(onStyleChange);
  onStyleChangeRef.current = onStyleChange;

  // Detect dark mode from localStorage / OS / .dark class.
  useEffect(() => {
    const KEY = "forestchat-theme";
    const mq = window.matchMedia("(prefers-color-scheme: dark)");

    const resolve = () => {
      const s = localStorage.getItem(KEY);
      if (s === "dark") return true;
      if (s === "light") return false;
      return mq.matches;
    };

    setIsDark(resolve());

    const onOs = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem(KEY)) setIsDark(e.matches);
    };
    mq.addEventListener("change", onOs);

    const obs = new MutationObserver(() => setIsDark(resolve()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      mq.removeEventListener("change", onOs);
      obs.disconnect();
    };
  }, []);

  // Create the map once isDark is known. No cleanup — handled by unmount effect below.
  useEffect(() => {
    if (!mapContainer.current || mapCreated.current || isDark === null) return;
    mapCreated.current = true;

    const m = new maplibregl.Map({
      container: mapContainer.current,
      style: isDark ? DARK_STYLE : LIGHT_STYLE,
      center: [24.0, 62.5],
      zoom: 6,
      cooperativeGestures: false,
    });

    map.current = m;

    m.addControl(new maplibregl.NavigationControl(), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    m.addControl(new maplibregl.GeolocateControl({}), "top-right");
    m.addControl(new maplibregl.FullscreenControl(), "top-right");

    onMapReadyRef.current?.(m);

    m.once("style.load", () => {
      styleVersion.current = 1;
      onStyleChangeRef.current?.({ isDark: isDark as boolean, styleVersion: 1 });
    });

    roRef.current = new ResizeObserver(() => m.resize());
    roRef.current.observe(mapContainer.current);
  }, [isDark]);

  // Cleanup on unmount only (not on re-renders).
  useEffect(() => {
    return () => {
      roRef.current?.disconnect();
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // On subsequent isDark changes (theme toggle), swap style via setStyle().
  useEffect(() => {
    const m = map.current;
    if (!m || isDark === null || !mapCreated.current) return;
    if (styleVersion.current === 0) return; // initial creation handles first style

    const target = isDark ? DARK_STYLE : LIGHT_STYLE;
    let done = false;

    const notify = () => {
      if (done) return;
      done = true;
      styleVersion.current += 1;
      onStyleChangeRef.current?.({ isDark, styleVersion: styleVersion.current });
    };

    m.setStyle(target);
    m.once("style.load", notify);

    const tid = setTimeout(() => {
      if (m.isStyleLoaded()) notify();
    }, 800);

    return () => {
      clearTimeout(tid);
      done = true;
    };
  }, [isDark]);

  return (
    <div ref={mapContainer} role="region" aria-label="Map" className="w-full h-full" />
  );
}
