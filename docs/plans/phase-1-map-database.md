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
- Import `maplibre-gl/dist/maplibre-gl.css` **only** in `globals.css` (via `@import`). Do NOT import it in the component file — Next.js handles CSS imports differently for client components and globals.css is the canonical location.
- Set `cooperativeGestures: false` — the map is full-screen in ForestLayout, so single-finger pan is the expected UX (unlike embedded maps on scrollable pages).

```tsx
// src/components/map/MapView.tsx — skeleton
"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

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
      cooperativeGestures: false, // Full-screen map: allow single-finger pan
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

**Color scheme (development classes → hex):**

```typescript
// src/lib/map/styles.ts

// English keys — the data in Supabase uses Finnish names (from Metsäkeskus WFS).
// This mapping handles both. The MapLibre match expression uses the English keys,
// and the legend component shows both Finnish original + English translation.
export const DEVELOPMENT_CLASS_COLORS: Record<string, string> = {
  "seedling":            "#90EE90", // light green — Taimikko
  "young_thinning":      "#228B22", // forest green — Nuori kasvatusmetsikkö
  "mature_thinning":     "#006400", // dark green — Varttunut kasvatusmetsikkö
  "regeneration_ready":  "#FFD700", // gold — Uudistuskypsä
  "uneven_aged":         "#9370DB", // medium purple — Eri-ikäisrakenteinen
  "shelterwood":         "#8B4513", // saddle brown — Suojuspuusto
  default:               "#CCCCCC", // grey — unknown
};

// Map Finnish development class names (from data) to English keys
export const DEV_CLASS_FI_TO_EN: Record<string, string> = {
  "Taimikko":                  "seedling",
  "Nuori kasvatusmetsikkö":    "young_thinning",
  "Varttunut kasvatusmetsikkö": "mature_thinning",
  "Uudistuskypsä":             "regeneration_ready",
  "Eri-ikäisrakenteinen":      "uneven_aged",
  "Suojuspuusto":              "shelterwood",
};

// Human-readable labels for legend (English name → display name with Finnish)
export const DEV_CLASS_LABELS: Record<string, string> = {
  "seedling":            "Seedling (Taimikko)",
  "young_thinning":      "Young thinning (Nuori kasvatusmetsikkö)",
  "mature_thinning":     "Mature thinning (Varttunut kasvatusmetsikkö)",
  "regeneration_ready":  "Regeneration-ready (Uudistuskypsä)",
  "uneven_aged":         "Uneven-aged (Eri-ikäisrakenteinen)",
  "shelterwood":         "Shelterwood (Suojuspuusto)",
};

export function getStandColor(developmentClassFi: string | null): string {
  if (!developmentClassFi) return DEVELOPMENT_CLASS_COLORS.default;
  const key = DEV_CLASS_FI_TO_EN[developmentClassFi];
  return key ? (DEVELOPMENT_CLASS_COLORS[key] ?? DEVELOPMENT_CLASS_COLORS.default) : DEVELOPMENT_CLASS_COLORS.default;
}
```

**StandLayer component:**
- Accepts `map: maplibregl.Map | null` and `compartments: CompartmentFeatureCollection` as props
- The `map` prop is passed down from `MapView` which holds the map instance in a ref
- **Map ref flow:** MapView creates the map → stores it in `useRef<maplibregl.Map>` → passes it to `StandLayer` via prop. Do NOT use a separate context or global. The ref-forwarding pattern is simplest for this two-component tree.
- On mount (when `map` becomes non-null): call `map.addSource('stands', ...)` then `map.addLayer(...)`
- When `compartments` changes: update the source with `map.getSource('stands').setData(compartments)`
- On unmount: remove the layer and source from the map
- Uses `fill-color` with match expression on `development_class`
- Sets `fill-opacity: 0.6`, `fill-outline-color: #333`

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

> **Note:** This creates a store with only MapSlice. P1.12 will recreate the store with both MapSlice + ForestSlice — this is intentional incremental construction. Don't add ForestSlice here.

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
- Varied development classes (seedling, young thinning, mature thinning, regeneration-ready)
- Uses English development class keys (matched to `DEV_CLASS_FI_TO_EN` mapping)
- Uses `stand_id` field (matches migration column name)
- Realistic coordinates for a forest in Finland (~24°E, 62.5°N area)
- Hand-crafted GeoJSON — small, self-contained, no external dependencies

```typescript
// src/lib/test-data.ts — example snippet
import type { CompartmentFeatureCollection } from "@/types/database";

export const testCompartments: CompartmentFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: [[[[24.00, 62.50], [24.01, 62.50], [24.01, 62.51], [24.00, 62.51], [24.00, 62.50]]]],
      },
      properties: {
        id: "test-1", stand_id: "1", main_species: "Pine",
        development_class: "mature_thinning", site_type: "mesic",
        area_ha: 2.5, age_years: 55, volume_m3: 450,
      },
    },
    // ... ~9 more stands with varied development_class values
  ],
};

**Verification:** Load page → 10 colored polygons on map. Click each → correct popup. Legend matches. Map controls work.

---

## Database Track (T2: ~4h)

> **Note for subagents:** When implementing, read `node_modules/next/dist/docs/01-app/` for Next.js 16 API reference, especially `05-server-and-client-components.md` and `15-route-handlers.md`. MapLibre GL docs: https://maplibre.org/maplibre-gl-js/docs/

### P1.10 — Supabase Repository Functions (1h)

**Objective:** Create typed data access functions for server-side use (API routes, server components). Uses `createServerSupabase()` — NOT the browser client. These are safe to call from `async` server components and route handlers.

**Files:**
- Create: `src/lib/repos/compartments.ts`
- Create: `src/lib/repos/operations.ts`
- Create: `src/lib/repos/forests.ts`
- Create: `src/lib/repos/plan-metadata.ts`

**Pattern for each repo:**

```typescript
// src/lib/repos/compartments.ts
import { createServerSupabase } from "@/lib/supabase/server";
import type { Compartment } from "@/types/database";

export async function getCompartmentsByForest(forestId: string): Promise<Compartment[]> {
  const supabase = await createServerSupabase();  // server-side client — awaits cookies()
  const { data, error } = await supabase
    .from("compartments")
    .select("*")
    .eq("forest_id", forestId)
    .order("stand_id");

  if (error) throw new Error(`Failed to fetch compartments: ${error.message}`);
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

**Objective:** Create React hooks that fetch data from Supabase using the browser client directly (NOT the server-side repos from P1.10). Each hook calls `createClient()` from `@/lib/supabase/client` inline — this is the correct pattern for client components. The repos (P1.10) are for server-side use only.

**Files:**
- Create: `src/lib/hooks/use-compartments.ts`
- Create: `src/lib/hooks/use-operations.ts`
- Create: `src/lib/hooks/use-forest.ts`

**Pattern:**

```typescript
// src/lib/hooks/use-compartments.ts
"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
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

    const supabase = createClient();
    supabase
      .from("compartments")
      .select("*")
      .eq("forest_id", forestId)
      .order("stand_id")
      .then(({ data: compartments, error: err }) => {
        if (cancelled) return;
        if (err) throw new Error(err.message);
        setData(compartments ?? []);
      })
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

> **Note:** This recreates the store from P1.6, now with both slices. Subagent: update the existing `src/lib/store/index.ts` — do NOT create a new file.

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

**⚠️ Geometry format verification (before P1.13):** PostgREST (Supabase's API layer) auto-converts PostGIS geometry to GeoJSON in API responses. However, this must be verified with real data before wiring the map. Verify by:
```bash
# Insert a test compartment manually (via Supabase SQL Editor or admin client), then query:
curl -s "https://xxx.supabase.co/rest/v1/compartments?select=stand_id,geometry&limit=1" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
  -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
# Response should include geometry as a GeoJSON object: {"type":"MultiPolygon","coordinates":[...]}
```
If geometry returns as anything other than GeoJSON (e.g., hex WKB, WKT string), the `compartmentsToGeoJSON` function in P1.13 must be adjusted. PostgREST defaults to GeoJSON for geometry columns — this is almost certainly correct, but verify once data exists.

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

### P1.15 — Integration Test & Verification (0.25h)

**Objective:** Run the full test suite and verify the pipeline end-to-end.

**Files:**
- Run: `npm test` — runs all Vitest tests (unit + integration + component)
- Run: `npm run test:coverage` — check coverage report

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
11. `npm test` → all tests pass (unit + integration + component)

**Verification:** All 11 checklist items pass.

---

## Testing Strategy

ForestChat uses **Vitest** with a layered test approach. Tests follow TDD: write the test before the implementation (RED → GREEN → REFACTOR).

### Test infrastructure (Phase 1 setup — DONE)

```
vitest.config.ts                                ← Vitest configuration
src/__tests__/setup.ts                          ← Global setup (RTL matchers, cleanup)
src/__tests__/mocks/server.ts                   ← MSW server (Supabase API mock)
src/__tests__/mocks/handlers.ts                 ← MSW route handlers
```

### NPM scripts

| Script | Command | Use |
|---|---|---|
| `npm test` | `vitest run` | CI / pre-commit (single run) |
| `npm run test:watch` | `vitest` | Development (auto-rerun on change) |
| `npm run test:ui` | `vitest --ui` | Visual test explorer (browser UI) |
| `npm run test:coverage` | `vitest run --coverage` | Coverage report (text + lcov) |

### Test layers

| Layer | Framework | Location | Tests per task |
|---|---|---|---|
| **Unit** | Vitest | `src/__tests__/unit/` | Pure functions: map styles, GeoJSON converter, color helpers, store slices |
| **Component** | Vitest + RTL | `src/__tests__/components/` | React rendering: MapView, StandLayer, StandPopup, StandLegend, ForestView |
| **Integration** | Vitest + MSW | `src/__tests__/integration/` | Hooks + Supabase REST: useCompartments, useForest, useOperations, IndexedDB sync |
| **E2E** | Playwright (Phase 5) | `e2e/` | Full browser flows: login → import → map interaction → chat |

### Test-to-task mapping

| Task | Test file(s) | Type | What it validates |
|---|---|---|---|
| P1.0 | — | TypeScript | `tsc --noEmit` checks type correctness |
| P1.3 | `unit/map-styles.test.ts` | Unit | Color map completeness, `getStandColor()` correctness |
| P1.6 | `unit/map-slice.test.ts` | Unit | Store slice initialization, setters, state transitions |
| P1.9 | — | Manual | Test data renders correctly (visual verification) |
| P1.10 | `integration/*.test.ts` | Integration | Repo functions return typed data, error handling |
| P1.11 | `integration/use-compartments.test.ts` | Integration | Hooks fetch via MSW-mocked Supabase, handle loading/error |
| P1.12 | `unit/forest-slice.test.ts` | Unit | ForestSlice initialization, setters, clearForestData |
| P1.13 | `unit/geojson.test.ts` | Unit | `compartmentsToGeoJSON()` edge cases: null geometry, empty, all-null |
| P1.14 | `integration/*-sync.test.ts` | Integration | IndexedDB cache write, stale-while-revalidate flow |
| P1.15 | All of the above | Suite | Full `npm test` passes |

### Writing new tests (conventions)

1. **Unit tests** (`src/__tests__/unit/`): Import the function/class directly. No MSW, no React. Fastest.
2. **Component tests** (`src/__tests__/components/`): Render with RTL. Mock MapLibre GL constructor (jsdom has no WebGL). Test rendering logic and prop contracts — visual map interactions go to Playwright E2E.
3. **Integration tests** (`src/__tests__/integration/`): Use MSW `server.use()` to add per-test route overrides. Test the full client → mock API → state flow.

All tests use Vitest's `describe`/`it`/`expect` (Jest-compatible API). Global setup in `src/__tests__/setup.ts` auto-imports `@testing-library/jest-dom` matchers and runs `cleanup()` after each test.

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
src/__tests__/unit/map-styles.test.ts           ← P1.3 test
src/__tests__/unit/map-slice.test.ts            ← P1.6 test
src/__tests__/unit/geojson.test.ts              ← P1.13 test
src/__tests__/integration/use-compartments.test.ts ← P1.11 test
src/__tests__/components/MapView.test.tsx        ← P1.2 test
src/__tests__/mocks/handlers.ts                 ← Test infrastructure
src/__tests__/mocks/server.ts                   ← Test infrastructure
src/__tests__/setup.ts                          ← Test infrastructure (global)
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
| MapLibre GL 5.x cooperative gestures break single-finger pan | ✅ Fixed | Set `cooperativeGestures: false` in Map constructor (v5 defaults to true) |
| Supabase RLS prevents reads (no auth yet) | ✅ Fixed | RLS recursion fixed via `get_shared_forest_ids_for_user()` SECURITY DEFINER function. For testing without auth, temporarily use `createAdminClient()` or seed a test session — Phase 2 (Auth) will resolve fully. |
| PostGIS geometry return format differs from GeoJSON | Low | PostgREST returns GeoJSON by default for geometry columns. Verification step added to P1.13. |
| OpenFreeMap tile server performance | Low | Falls back to CartoDB Positron tiles if needed |
| Column name mismatch (stand_id vs kuvio_id) | ✅ Fixed | Migration column renamed to `stand_id`. Plan types match. |
| Repo functions called from client components | ✅ Fixed | Hooks (P1.11) use browser client directly. Repos (P1.10) use server client — separate concerns. |

---

*Plan version: 1.1 — Reviewed 2026-05-21. Fixes: migration column `kuvio_id` → `stand_id`, RLS recursion via SECURITY DEFINER function, cooperative gestures, repo/hooks client pattern, English development class keys, geometry verification step, explicit map ref flow, CSS deduplication.*
*Derived from: `~/.hermes/plans/forestchat-architecture.md` v3.0, sections 6 and 9.*
