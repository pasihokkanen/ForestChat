# ForestChat — Phase 1: Map Foundation & Database Layer

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build the map visualization (MapLibre GL) and database access layer (Supabase repositories + Zustand store + IndexedDB sync) for ForestChat.

**Architecture:** Phase 1 delivers two interconnected subsystems: (1) a client-side MapLibre GL map component that renders stand polygons colored by development class with click-to-inspect popups, and (2) a typed data access layer that fetches from Supabase, caches to IndexedDB, and exposes forest state through a Zustand store — ready for the chat and visualization panels in later phases.

**Tech Stack:** Next.js 16.2 (App Router), TypeScript strict, MapLibre GL 5.24, Zustand 5, Dexie.js 4, Supabase JS 2.106, Tailwind CSS 4, React 19

**Prerequisites (Phase 0 — DONE):**

- ✅ Next.js 16.2 project with App Router, TypeScript, Tailwind CSS 4
- ✅ Supabase clients (`src/lib/supabase/{client,server,admin}.ts`)
- ✅ Dexie.js IndexedDB schema (`src/lib/db.ts` — Compartment, Operation, PlanMetadata, ChatMessage types)
- ✅ Serwist PWA + service worker
- ✅ Environment variables (Supabase, MML, OpenRouter)
- ✅ Database migration (`supabase/migrations/001_initial_schema.sql`)
- ✅ MapLibre GL 5.24, Zustand 5, @tanstack/react-table, recharts, dexie installed
- ✅ `@types/geojson` installed as dev dependency

---

## Task Ordering & Dependencies

```
P1.0 Shared Types  ──┬──► P1.1 MapLibre Setup ──► P1.2 MapView ──► P1.3 GeoJSON Layer
                     │                                          │
                     │                                          ▼
                     │                                    P1.4 Stand Popup
                     │                                          │
                     │                                    P1.5 Map Controls
                     │                                          │
                     │                                    P1.6 Map State (Zustand)
                     │                                          │
                     │                                          ▼
                     │                              P1.7 ForestLayout + Routes
                     │                                         │
                     │                                   P1.8 Stand Legend
                     │                                         │
                     │                                   P1.9 Test Data
                     │
                     └──► P1.10 Supabase Repos ──► P1.11 Data Hooks ──► P1.12 Forest Store
                                                                              │
                                                                              ▼
                                                                     P1.13 Wire Map → Supabase
                                                                              │
                                                                              ▼
                                                                     P1.14 IndexedDB Sync
                                                                              │
                                                                              ▼
                                                                     P1.15 Integration Test
```

P1.0 must run first (shared types needed by both tracks). After P1.0, the Map track (P1.1–P1.9) and Database track (P1.10–P1.12) can run in parallel. P1.13–P1.15 merge both tracks.

---

## Map Track (T1: ~5h)

### P1.0 — Shared TypeScript Types (0.5h)  **[BLOCKS BOTH TRACKS]**

**Objective:** Create canonical TypeScript types that match the Supabase database schema, replacing the temporary types in `src/lib/db.ts`.

**Files:**
- Create: `src/types/database.ts` — Supabase-generated types + domain types
- Modify: `src/lib/db.ts:5-48` — import types from `@/types/database` instead of defining inline

**What to build:**

```typescript
// src/types/database.ts

// ── Supabase schema types (mirrors migration) ──

export interface Forest {
  id: string;
  owner_id: string;
  name: string;
  municipality: string | null;
  property_id: string | null;
  total_area_ha: number | null;
  data_source: string;
  created_at: string;
  updated_at: string;
}

export interface Compartment {
  id: string;
  forest_id: string;
  stand_id: string;
  area_ha: number | null;
  main_species: string | null;
  development_class: string | null;
  site_type: string | null;
  soil_type: string | null;
  drainage_status: string | null;
  age_years: number | null;
  volume_m3: number | null;
  basal_area: number | null;
  avg_diameter: number | null;
  avg_height: number | null;
  growth_m3_per_ha: number | null;
  geometry: GeoJSON.MultiPolygon | null;
  attributes: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface Operation {
  id: string;
  compartment_id: string;
  forest_id: string;
  type: string;
  year: number;
  removal_pct: number;
  income_eur: number | null;
  cost_eur: number | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PlanMetadata {
  id: string;
  forest_id: string;
  name: string | null;
  period_start: number | null;
  period_end: number | null;
  total_volume_m3: number | null;
  stumpage_value_eur: number | null;
  annual_growth_m3: number | null;
  owner_stated_value_eur: number | null;
  prices_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatSession {
  id: string;
  forest_id: string;
  user_id: string;
  title: string | null;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls: unknown | null;
  created_at: string;
}

// ── GeoJSON feature wrapper (for MapLibre layers) ──

export interface CompartmentFeature extends GeoJSON.Feature<GeoJSON.MultiPolygon> {
  properties: {
    id: string;
    stand_id: string;
    main_species: string | null;
    development_class: string | null;
    site_type: string | null;
    area_ha: number | null;
    age_years: number | null;
    volume_m3: number | null;
  };
}

export interface CompartmentFeatureCollection extends GeoJSON.FeatureCollection<GeoJSON.MultiPolygon> {
  features: CompartmentFeature[];
}
```

**Existing `db.ts` types have different field names** (camelCase vs snake_case). The db.ts Dexie schema uses its own types (flat for IndexedDB) — keep those but import the domain types for the `@/types` re-export pattern. The Dexie types in db.ts store a denormalized subset (`geometry: GeoJSON.Geometry | null`, `attributes`, etc.) — these are intentional IndexedDB mirrors, not Supabase types. Update the Dexie types to reference the Supabase types via `Pick<>` or similar to stay DRY where possible.

**Verification:** `tsc --noEmit` passes with no type errors. All Supabase schema fields present.

---

### P1.1 — MapLibre GL CSS & Dynamic Import Setup (0.5h)

**Objective:** Configure MapLibre GL CSS and create a dynamic `MapView` wrapper that handles Next.js SSR.

**Files:**
- Create: `src/components/map/MapView.tsx`
- Modify: `src/app/globals.css` — import MapLibre CSS

**Key considerations:**
- MapLibre GL requires `window` / WebGL — must be dynamically imported with `ssr: false`
- In Next.js 16, use `next/dynamic` with `{ ssr: false }`
- Import `maplibre-gl/dist/maplibre-gl.css` in layout or globals

```tsx
// src/components/map/MapView.tsx — skeleton
"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export default function MapView() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: "https://tiles.openfreemap.org/styles/liberty", // OpenStreetMap, no API key
      center: [24.0, 62.5], // Central Finland
      zoom: 6,
    });
    return () => { map.current?.remove(); };
  }, []);

  return <div ref={mapContainer} className="w-full h-full" />;
}
```

**Map style:** Use `https://tiles.openfreemap.org/styles/liberty` (free, no API key, OSM-based). Good Finland coverage. Alternative: `https://basemaps.cartocdn.com/gl/positron-gl-style/style.json` if needed.

**Verification:** Run `npm run dev`, see a map rendered on the page centered on central Finland.

---

### P1.2 — MapView with OpenStreetMap Tiles (0.5h)

**Objective:** Complete the MapView component with proper TypeScript typing, resize handling, and cleanup.

**Files:**
- Modify: `src/components/map/MapView.tsx`

**Details:**
- Add proper TypeScript types for the map ref
- Handle container resize (MapLibre needs explicit `map.resize()`)
- Add `ResizeObserver` to the container
- Clean up map instance on unmount
- Expose `map` instance via a ref-forwarding pattern or callback for parent access

**Verification:** Map renders, resizes with window, no errors on unmount/remount.

---

### P1.3 — Stand Polygon GeoJSON Layer with Development-Class Coloring (1h)

**Objective:** Add a GeoJSON source and fill layer that colors stand polygons by development class.

**Files:**
- Create: `src/components/map/StandLayer.tsx` — GeoJSON layer component
- Modify: `src/components/map/MapView.tsx` — integrate StandLayer
- Create: `src/lib/map/styles.ts` — color scheme for development classes

**Color scheme (Finnish development classes → hex):**

```typescript
// src/lib/map/styles.ts
export const DEVELOPMENT_CLASS_COLORS: Record<string, string> = {
  "Taimikko":                    "#90EE90", // light green — seedling
  "Nuori kasvatusmetsikkö":      "#228B22", // forest green — young thinning
  "Varttunut kasvatusmetsikkö":  "#006400", // dark green — mature thinning
  "Uudistuskypsä":               "#FFD700", // gold — regeneration-ready
  "Eri-ikäisrakenteinen":        "#9370DB", // medium purple — uneven-aged
  "Suojuspuusto":                "#8B4513", // saddle brown — shelterwood
  default:                       "#CCCCCC", // grey — unknown
};

export function getStandColor(developmentClass: string | null): string {
  if (!developmentClass) return DEVELOPMENT_CLASS_COLORS.default;
  return DEVELOPMENT_CLASS_COLORS[developmentClass] ?? DEVELOPMENT_CLASS_COLORS.default;
}
```

**StandLayer component:**
- Accepts `compartments: CompartmentFeatureCollection` as prop
- When data changes, updates the GeoJSON source with `setData()`
- Uses `fill-color` with match expression on `development_class`
- Sets `fill-opacity: 0.6`, `fill-outline-color: #333`
- Adds to map on mount, removes on unmount

**StandLayer should handle:**
- Empty data (no error, just no layer)
- Data update (replace source data)
- Layer ordering (stands below labels, above basemap)

**Verification:** Provide test GeoJSON in a wrapper component → colored polygons appear on map.

---

### P1.4 — Stand Click Interaction with Popup (0.75h)

**Objective:** Clicking a stand polygon shows a popup with key attributes.

**Files:**
- Create: `src/components/map/StandPopup.tsx` — popup content
- Modify: `src/components/map/StandLayer.tsx` — add click handler

**StandPopup shows:**
- Stand ID (kuvio number)
- Main species
- Development class
- Site type
- Area (ha)
- Age (years)
- Volume (m³)

**Behavior:**
- Click stand → popup appears at click location
- Click different stand → popup moves
- Click map background → popup closes
- Cursor changes to pointer on hover over stands
- Popup follows the map as it pans/zooms

**Verification:** Click on colored polygons → popup shows correct data. Click empty area → popup closes.

---

### P1.5 — Map Controls (0.5h)

**Objective:** Add navigation controls, scale bar, and geolocation.

**Files:**
- Modify: `src/components/map/MapView.tsx`

**Controls:**
- `NavigationControl` — zoom + compass (top-right)
- `ScaleControl` — metric scale bar (bottom-left, kilometers)
- `GeolocateControl` — "find me" button (top-right, below navigation)
- `FullscreenControl` — fullscreen toggle (top-right)

**Verification:** All controls appear and function correctly. Geolocate asks for permission.

---

### P1.6 — Zustand Map State Slice (0.5h)

**Objective:** Create the Zustand store slice for map viewport and selection state.

**Files:**
- Create: `src/lib/store/map-slice.ts`
- Create: `src/lib/store/index.ts` — combined store

```typescript
// src/lib/store/map-slice.ts
import type { StateCreator } from "zustand";

export interface MapSlice {
  // Viewport
  zoom: number;
  center: [number, number]; // [lng, lat]
  setViewport: (zoom: number, center: [number, number]) => void;

  // Selection
  selectedStandId: string | null;
  selectStand: (standId: string | null) => void;

  // Cursor
  hoveredStandId: string | null;
  setHoveredStand: (standId: string | null) => void;
}

export const createMapSlice: StateCreator<MapSlice> = (set) => ({
  zoom: 6,
  center: [24.0, 62.5],
  setViewport: (zoom, center) => set({ zoom, center }),
  selectedStandId: null,
  selectStand: (standId) => set({ selectedStandId: standId }),
  hoveredStandId: null,
  setHoveredStand: (standId) => set({ hoveredStandId: standId }),
});
```

```typescript
// src/lib/store/index.ts
import { create } from "zustand";
import { createMapSlice, type MapSlice } from "./map-slice";
// Future slices will be added here

export type ForestStore = MapSlice; // extends later

export const useForestStore = create<ForestStore>()((...a) => ({
  ...createMapSlice(...a),
}));
```

**Verification:** Import `useForestStore` in a test component, call `selectStand("123")`, verify state via `getState()`.

---

### P1.7 — ForestLayout Shell + Route Scaffolding (0.5h)

**Objective:** Create the app layout structure with placeholder routes.

**Files:**
- Create: `src/app/(app)/layout.tsx` — ForestLayout shell
- Create: `src/app/(app)/forest/[id]/page.tsx` — main forest view (map + chat placeholder)
- Modify: `src/app/page.tsx` — landing page (ForestChat branding, CTA)
- Delete: `public/next.svg`, `public/vercel.svg`, `public/globe.svg`, `public/window.svg`, `public/file.svg` — Next.js boilerplate assets

**Route structure (from architecture):**
```
/                           → Landing page
/app/forest/[id]            → Main view (map + chat)
/app/forest/[id]/summary    → Summary dashboard
/app/forest/[id]/stands     → Stand table
/app/forest/[id]/timeline   → Harvest timeline
/app/forest/new             → Import (enter property ID)
/app/settings               → User settings
```

**ForestLayout** for Phase 1:
```tsx
// src/app/(app)/layout.tsx — skeleton
export default function ForestLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-screen">
      <header className="h-12 border-b bg-white flex items-center px-4">
        <h1 className="font-semibold">ForestChat</h1>
        {/* Auth placeholder */}
      </header>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
```

**Forest page** for Phase 1:
```tsx
// src/app/(app)/forest/[id]/page.tsx
import dynamic from "next/dynamic";

const MapView = dynamic(() => import("@/components/map/MapView"), { ssr: false });

export default async function ForestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="relative w-full h-full">
      <MapView />
      {/* Chat panel placeholder — Phase 3 */}
    </div>
  );
}
```

**Landing page:**
- Replace the Next.js default content with ForestChat branding
- "ForestChat — AI-powered forest management"
- Brief value proposition, "Get Started" button (links to `/auth` or `/app/forest/new`)

**Verification:** Navigate to `/app/forest/test-id` → map renders full screen with ForestChat header.

---

### P1.8 — Stand Color Legend (0.25h)

**Objective:** Display a legend showing development class → color mapping.

**Files:**
- Create: `src/components/map/StandLegend.tsx`
- Modify: `src/app/(app)/forest/[id]/page.tsx` — include legend

**Legend component:**
- Fixed position (bottom-left over map, or sidebar)
- Lists each development class with color swatch and Finnish name + English translation
- Responsive: collapses on small screens

**Verification:** Legend appears, colors match polygon colors, all development classes shown.

---

### P1.9 — Test Data & End-to-End Verification (0.5h)

**Objective:** Create test GeoJSON data and verify the full map pipeline works.

**Files:**
- Create: `src/lib/test-data.ts` — sample stand data (GeoJSON FeatureCollection, ~10 stands)
- Modify: `src/app/(app)/forest/[id]/page.tsx` — load test data (until Supabase is wired in P1.13)

**Test data:**
- ~10 stands with realistic Finnish attributes
- Varied development classes (seedling, young, mature, regeneration-ready)
- Realistic coordinates for a forest in Finland
- Hand-crafted GeoJSON — small, self-contained

**Verification:** Load page → 10 colored polygons on map. Click each → correct popup. Legend matches. Map controls work.

---

## Database Track (T2: ~4h)

> **Note for subagents:** When implementing, read `node_modules/next/dist/docs/01-app/` for Next.js 16 API reference, especially `05-server-and-client-components.md` and `15-route-handlers.md`. MapLibre GL docs: https://maplibre.org/maplibre-gl-js/docs/

### P1.10 — Supabase Repository Functions (1h)

**Objective:** Create typed data access functions that query Supabase.

**Files:**
- Create: `src/lib/repos/compartments.ts`
- Create: `src/lib/repos/operations.ts`
- Create: `src/lib/repos/forests.ts`
- Create: `src/lib/repos/plan-metadata.ts`

**Pattern for each repo:**

```typescript
// src/lib/repos/compartments.ts
import { createClient } from "@/lib/supabase/client";
import type { Compartment } from "@/types/database";

export async function getCompartmentsByForest(forestId: string): Promise<Compartment[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("compartments")
    .select("*")
    .eq("forest_id", forestId)
    .order("stand_id");

  if (error) throw new Error(`Failed to fetch compartments: ${error.message}`);
  return data;
}

export async function getCompartmentById(id: string): Promise<Compartment | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("compartments")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // no rows
    throw new Error(`Failed to fetch compartment: ${error.message}`);
  }
  return data;
}
```

**Each repo needs:**
- List by foreign key (e.g., compartments by forest_id)
- Get single by ID
- Error handling for empty results vs. real errors (PGRST116 = no rows)

**Verification:** Write a test that calls `getCompartmentsByForest` with a known forest ID in Supabase → returns correct data structure.

---

### P1.11 — React Data Hooks (0.75h)

**Objective:** Create React hooks that fetch data on mount and expose loading/error state.

**Files:**
- Create: `src/lib/hooks/use-compartments.ts`
- Create: `src/lib/hooks/use-operations.ts`
- Create: `src/lib/hooks/use-forest.ts`

**Pattern:**

```typescript
// src/lib/hooks/use-compartments.ts
"use client";

import { useState, useEffect } from "react";
import { getCompartmentsByForest } from "@/lib/repos/compartments";
import type { Compartment } from "@/types/database";

export function useCompartments(forestId: string | null) {
  const [data, setData] = useState<Compartment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!forestId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    getCompartmentsByForest(forestId)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [forestId]);

  return { data, loading, error };
}
```

**Verification:** Mount a test component that calls `useCompartments("some-id")` → loading → data appears.

---

### P1.12 — Zustand Forest Store Slice (0.75h)

**Objective:** Create the forest data store slice that holds compartments, operations, and forest metadata.

**Files:**
- Create: `src/lib/store/forest-slice.ts`
- Modify: `src/lib/store/index.ts` — add forest slice + actions

```typescript
// src/lib/store/forest-slice.ts
import type { StateCreator } from "zustand";
import type { Compartment, Operation, PlanMetadata, Forest } from "@/types/database";

export interface ForestSlice {
  // Data
  forest: Forest | null;
  compartments: Compartment[];
  operations: Operation[];
  planMetadata: PlanMetadata | null;

  // Loading states
  isLoadingForest: boolean;
  isLoadingCompartments: boolean;
  forestError: string | null;

  // Actions
  setForest: (forest: Forest) => void;
  setCompartments: (compartments: Compartment[]) => void;
  setOperations: (operations: Operation[]) => void;
  setPlanMetadata: (metadata: PlanMetadata) => void;
  setLoading: (key: "forest" | "compartments", value: boolean) => void;
  setError: (error: string | null) => void;
  clearForestData: () => void;
}
```

**Update combined store:**

```typescript
// src/lib/store/index.ts
import { create } from "zustand";
import { createMapSlice, type MapSlice } from "./map-slice";
import { createForestSlice, type ForestSlice } from "./forest-slice";

export type ForestStore = MapSlice & ForestSlice;

export const useForestStore = create<ForestStore>()((...a) => ({
  ...createMapSlice(...a),
  ...createForestSlice(...a),
}));
```

**Verification:** Call `useForestStore.getState().setCompartments(data)` → `getState().compartments` reflects data.

---

### P1.13 — Wire Map to Supabase Data (0.5h)

**Objective:** Replace test data with real Supabase-sourced data. The forest page loads compartments from Supabase and renders them on the map.

**Files:**
- Modify: `src/app/(app)/forest/[id]/page.tsx` — use hooks + store instead of test data
- Create: `src/components/forest/ForestView.tsx` — container that orchestrates data loading + map
- Modify: `src/components/map/MapView.tsx` — accept/compose StandLayer

**ForestView flow:**
1. Gets `forestId` from route params
2. Calls `useCompartments(forestId)` + `useForest(forestId)`
3. On data load, populates Zustand store
4. Converts compartment data to GeoJSON FeatureCollection
5. Passes to MapView → StandLayer

**GeoJSON conversion utility:**

```typescript
// src/lib/map/geojson.ts
import type { Compartment, CompartmentFeature, CompartmentFeatureCollection } from "@/types/database";

export function compartmentsToGeoJSON(compartments: Compartment[]): CompartmentFeatureCollection {
  const features: CompartmentFeature[] = compartments
    .filter((c) => c.geometry !== null)
    .map((c) => ({
      type: "Feature",
      geometry: c.geometry!,
      properties: {
        id: c.id,
        stand_id: c.stand_id,
        main_species: c.main_species,
        development_class: c.development_class,
        site_type: c.site_type,
        area_ha: c.area_ha,
        age_years: c.age_years,
        volume_m3: c.volume_m3,
      },
    }));

  return {
    type: "FeatureCollection",
    features,
  };
}
```

**Verification:** Navigate to `/app/forest/<real-forest-id>` → compartments load from Supabase and display on map.

---

### P1.14 — IndexedDB Sync Layer (0.5h)

**Objective:** Cache Supabase data in IndexedDB for offline access. On load, check IndexedDB first (instant), then fetch from Supabase (background sync).

**Files:**
- Create: `src/lib/sync/compartments-sync.ts`
- Create: `src/lib/sync/operations-sync.ts`
- Modify: `src/lib/hooks/use-compartments.ts` — integrate sync
- Modify: `src/lib/hooks/use-operations.ts` — integrate sync

**Sync strategy (stale-while-revalidate):**
1. On mount: read from IndexedDB instantly (render cached data)
2. Fetch from Supabase in background
3. On Supabase success: update IndexedDB + update store
4. On Supabase failure (offline): keep showing cached data, set error flag

```typescript
// src/lib/sync/compartments-sync.ts
import { db } from "@/lib/db";
import type { Compartment } from "@/types/database";

// Maps Supabase Compartment → Dexie Compartment shape
function toDexieCompartment(c: Compartment) {
  return {
    id: c.id,
    forestId: c.forest_id,
    standId: c.stand_id,
    areaHa: c.area_ha,
    mainSpecies: c.main_species,
    developmentClass: c.development_class,
    siteType: c.site_type,
    age: c.age_years,
    volumeM3: c.volume_m3,
    geometry: c.geometry,
    attributes: c.attributes,
  };
}

export async function cacheCompartments(compartments: Compartment[]): Promise<void> {
  const rows = compartments.map(toDexieCompartment);
  await db.compartments.bulkPut(rows);
}

export async function getCachedCompartments(forestId: string) {
  return db.compartments.where("forestId").equals(forestId).toArray();
}
```

**Verification:** Load page with network enabled → data caches to IndexedDB. Disconnect network, reload → data loads from cache.

---

### P1.15 — Integration Test (0.25h)

**Objective:** Verify the full pipeline end-to-end.

**Test script:** Manual checklist, or optionally a Playwright test.

**Checklist:**
1. `npm run dev` → app compiles with no errors
2. Landing page (`/`) shows ForestChat branding
3. Navigate to `/app/forest/<real-id>` → map renders
4. Stand polygons appear in correct colors
5. Click on a stand → popup shows correct data
6. Legend matches polygon colors
7. Map controls work (zoom, geolocate, fullscreen)
8. Refresh → data loads from IndexedDB cache (if previously fetched)
9. No console errors
10. `npm run build` → builds successfully (no Webpack errors)

**Verification:** All 10 checklist items pass.

---

## Files Created (Summary)

```
src/types/database.ts                          ← P1.0 Shared types
src/components/map/MapView.tsx                  ← P1.1, P1.2
src/components/map/StandLayer.tsx               ← P1.3
src/components/map/StandPopup.tsx               ← P1.4
src/components/map/StandLegend.tsx              ← P1.8
src/components/forest/ForestView.tsx            ← P1.13
src/lib/map/styles.ts                           ← P1.3
src/lib/map/geojson.ts                          ← P1.13
src/lib/store/map-slice.ts                      ← P1.6
src/lib/store/forest-slice.ts                   ← P1.12
src/lib/store/index.ts                          ← P1.6, P1.12
src/lib/repos/compartments.ts                   ← P1.10
src/lib/repos/operations.ts                     ← P1.10
src/lib/repos/forests.ts                        ← P1.10
src/lib/repos/plan-metadata.ts                  ← P1.10
src/lib/hooks/use-compartments.ts               ← P1.11
src/lib/hooks/use-operations.ts                 ← P1.11
src/lib/hooks/use-forest.ts                     ← P1.11
src/lib/sync/compartments-sync.ts               ← P1.14
src/lib/sync/operations-sync.ts                 ← P1.14
src/lib/test-data.ts                            ← P1.9
src/app/(app)/layout.tsx                        ← P1.7
src/app/(app)/forest/[id]/page.tsx              ← P1.7, P1.13
```

## Files Modified (Summary)

```
src/lib/db.ts                                   ← P1.0 (import types from @/types)
src/app/globals.css                             ← P1.1 (MapLibre CSS import)
src/app/page.tsx                                ← P1.7 (landing page)
```

---

## Risks & Mitigations

| Risk | Probability | Mitigation |
|---|---|---|
| MapLibre GL SSR issues (window/WebGL) | Medium | Dynamic import `{ssr: false}` — already planned |
| MapLibre GL 5.x API changes from docs | Low | Check [maplibre.org/maplibre-gl-js/docs/](https://maplibre.org/maplibre-gl-js/docs/) for v5 |
| Supabase RLS prevents reads (no auth yet) | High | Phase 1 uses `createClient()` (browser, with public key) — RLS policies allow `authenticated` reads. For testing without auth, temporarily use `createAdminClient()` bypass or seed a test user session. This is a known limitation — Phase 2 (Auth) will resolve it properly. |
| PostGIS geometry column naming in Supabase | Low | Migration uses `geometry GEOMETRY(MultiPolygon, 3067)` — Supabase returns GeoJSON automatically via `ST_AsGeoJSON`. Verify with test query. |
| OpenFreeMap tile server performance | Low | Falls back to CartoDB Positron tiles if needed |

---

*Plan version: 1.0 — Phase 1 detailed breakdown for ForestChat Map Foundation & Database Layer.*
*Derived from: `~/.hermes/plans/forestchat-architecture.md` v3.0, sections 6 and 9.*
