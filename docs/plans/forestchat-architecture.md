# ForestChat — Architecture & Implementation Plan

**Status:** Draft v3.0  
**Date:** 2026-05-21  
**Author:** Systems Architect (via Hermes Agent)  
**Owner:** Pasi Hokkanen  
**Repo:** github.com/pasihokkanen/ForestChat

---

## 1. Product Vision

A web application (PWA) for forest owners to visualize and manage their forest management plans. The only editing interface is an AI chatbot — all plan modifications happen through conversation. The rest of the UI is read-only visualization: map, charts, tables, and timeline.

### Core principles

- **Chat is the only editor.** No forms, no drag-and-drop scheduling, no manual data entry for plan changes.
- **Map-first.** The primary visualization is a map with kuvio (stand) polygons. Everything else (charts, tables) derives from what's visible on the map.
- **English-first.** All UI text, tool descriptions, and AI prompts are in English (for broader developer audience and multi-user product clarity).
- **Multi-user from day one.** Each forest owner has their own account, their own plans, and can share access.
- **Zero-config import.** User enters their property ID (Finnish kiinteistötunnus) — the app fetches everything automatically from Finnish open data sources. No file downloads required.

### User stories (MVP)

| # | Story |
|---|---|
| U1 | I register and log in |
| U2 | I enter my property ID and the app automatically loads my forest data onto the map |
| U3 | I see my stands on the map — clicking a stand shows its details |
| U4 | I ask the AI to generate a 20-year forest management plan |
| U5 | I chat with the AI to request plan modifications |
| U6 | I see changes immediately on the map and charts |

### Target audience

Finnish forest owners. Underlying data is Finnish (stand attributes in Finnish, site classifications in Finnish), but the UI and AI interactions are in English for clarity and product consistency.

---

## 2. Data Source Strategy

**Two-API pipeline: MML (National Land Survey) + Metsäkeskus (Finnish Forest Centre).** Both are Finnish government agencies providing open data.

### Data acquisition flow

```
User enters: 989-405-0001-0405 (Finnish property ID)

  1. MML OGC API Features
     → Get property boundary polygon
     Endpoint: avoin-paikkatieto.maanmittauslaitos.fi/kiinteisto-avoin/
     Collection: KiinteistotunnuksenSijaintitiedot
     CQL2: ?filter=kiinteistotunnus='989-405-0001-0405'

  2. PostGIS spatial intersection (backend)
     → Intersect property polygon with Metsäkeskus stand polygons

  3. Metsäkeskus WFS (v1:stand)
     → Get stand attributes + precise geometry for intersecting stands
     Endpoint: avoin.metsakeskus.fi/geoserver/v1/ows
     Layer: v1:stand
     Output: GeoJSON (EPSG:4326)
```

### Backup path: metsään.fi file upload

| Path | Description | Priority |
|---|---|---|
| **A. Automatic (MML + WFS)** | Property ID → property polygon → spatial intersect → stand data | MVP primary |
| **B. File upload** | User logs into metsään.fi, downloads their forest data file, uploads to the app | Fallback |

### API credentials

| API | Key type | Location | Notes |
|---|---|---|---|
| **MML OGC API** | Single app API key (free) | Backend env var (`MML_API_KEY`) | Developer registers at [OmaTili](https://omatili.maanmittauslaitos.fi). NEVER sent to client. CC 4.0 license. |
| **Metsäkeskus WFS** | No key required | — | Open data, anonymous access |
| **OpenRouter** | API key | Backend env var (`OPENROUTER_API_KEY`) | Existing key |
| **Supabase** | Publishable + Secret key | Env vars | New-style keys (`sb_publishable_*`, `sb_secret_*`) |

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT (Next.js PWA)                         │
│                                                                      │
│  ┌─────────────────────────┐  ┌──────────────────────────────────┐   │
│  │     Chat Panel           │  │      Visualization Panels        │   │
│  │                          │  │                                   │   │
│  │  • Chat history          │  │  🗺️ Map (MapLibre GL)            │   │
│  │  • Message input         │  │  📊 Summary (Recharts)           │   │
│  │  • Tool call status      │  │  📋 Stand table (TanStack)       │   │
│  │  • "Plan updated" feedback│  │  📈 Harvest timeline (Gantt)     │   │
│  └──────────┬──────────────┘  └──────────────────────────────────┘   │
│             │                         │                              │
│             │    Zustand state        │                              │
│             └─────────┬───────────────┘                              │
│                       │                                              │
│         IndexedDB (Dexie.js — offline-first cache)                  │
│         Service Worker (PWA)                                         │
└───────────────────────┼──────────────────────────────────────────────┘
                        │ HTTPS
                        ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      Next.js API Routes                               │
│                                                                       │
│  /api/auth/*            → Supabase Auth (proxy)                      │
│  /api/chat              → AI chat endpoint (streaming)               │
│  /api/plans/[id]/*      → CRUD for forest plans                      │
│  /api/import/property   → Import by property ID (MML+WFS)            │
│  /api/import/csv        → CSV file upload (backup)                   │
│                                                                       │
│  Backend-only env vars: MML_API_KEY, OPENROUTER_API_KEY,             │
│  SUPABASE_SECRET_KEY. NEVER exposed to client.                       │
└───────────────────────────┬──────────────────────────────────────────┘
                            │
                    ┌───────┴───────┐
                    ▼               ▼
        ┌──────────────┐  ┌──────────────────┐
        │   Supabase    │  │   LLM Provider   │
        │               │  │   (OpenRouter)   │
        │ • Auth + RLS  │  │                  │
        │ • PostgreSQL   │  │ Function calling │
        │   + PostGIS   │  │ + system prompt  │
        │ • Storage     │  └──────────────────┘
        └───────┬───────┘
                │
    ┌───────────┴───────────┐
    ▼                       ▼
┌──────────┐        ┌──────────────┐
│   MML    │        │ Metsäkeskus  │
│ OGC API  │        │  WFS (v1)    │
│Features  │        │              │
│(property │        │ v1:stand     │
│boundaries)│       │ (stands)     │
└──────────┘        └──────────────┘
```

---

## 4. Database Schema (Supabase / PostgreSQL + PostGIS)

```sql
-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Profiles (extends Supabase Auth users)
CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own profile" ON profiles
  FOR SELECT USING (id = auth.uid());
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (id = auth.uid());

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Forests (metsätila)
CREATE TABLE forests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES profiles(id),
  name          TEXT NOT NULL,
  municipality  TEXT,
  property_id   TEXT,                        -- Finnish kiinteistötunnus
  total_area_ha NUMERIC,
  data_source   TEXT DEFAULT 'mml_wfs',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE forests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner full access" ON forests FOR ALL USING (owner_id = auth.uid());
CREATE POLICY "Shared read access" ON forests FOR SELECT USING (
  id IN (SELECT forest_id FROM plan_shares WHERE shared_with = auth.uid())
);

-- Property boundaries (from MML)
CREATE TABLE property_boundaries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forest_id     UUID NOT NULL UNIQUE REFERENCES forests(id) ON DELETE CASCADE,
  property_id   TEXT NOT NULL,
  geometry      GEOMETRY(MultiPolygon, 3067),
  fetched_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_property_boundaries_geom ON property_boundaries USING GIST(geometry);
ALTER TABLE property_boundaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner access via forest" ON property_boundaries
  FOR ALL USING (forest_id IN (SELECT id FROM forests WHERE owner_id = auth.uid()));

-- Compartments (kuviot / stands) — PostGIS geometry
CREATE TABLE compartments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forest_id     UUID NOT NULL REFERENCES forests(id) ON DELETE CASCADE,
  stand_id      TEXT NOT NULL,               -- Metsäkeskus stand number
  area_ha       NUMERIC,
  main_species  TEXT,                        -- Mänty, Kuusi, Rauduskoivu...
  development_class TEXT,                    -- Taimikko, Nuori kasvatusmetsikkö...
  site_type     TEXT,                        -- lehtomainen, tuore, kuivahko, kuiva
  soil_type     TEXT,
  drainage_status TEXT,
  age_years     INTEGER,
  volume_m3     NUMERIC,
  basal_area    NUMERIC,
  avg_diameter  NUMERIC,
  avg_height    NUMERIC,
  growth_m3_per_ha NUMERIC,
  geometry      GEOMETRY(MultiPolygon, 3067),
  attributes    JSONB,                       -- species breakdown, sawlog/pulpwood
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(forest_id, stand_id)
);

CREATE INDEX idx_compartments_geom ON compartments USING GIST(geometry);
CREATE INDEX idx_compartments_forest ON compartments(forest_id);

ALTER TABLE compartments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner access via forest" ON compartments
  FOR ALL USING (forest_id IN (SELECT id FROM forests WHERE owner_id = auth.uid()));
CREATE POLICY "Shared read access" ON compartments FOR SELECT USING (
  forest_id IN (SELECT forest_id FROM plan_shares WHERE shared_with = auth.uid())
);

-- Operations (planned harvests / silviculture)
CREATE TABLE operations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  compartment_id UUID NOT NULL REFERENCES compartments(id) ON DELETE CASCADE,
  forest_id     UUID NOT NULL REFERENCES forests(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,               -- Clear_cut, Thinning, First_thinning...
  year          INTEGER NOT NULL,
  removal_pct   NUMERIC DEFAULT 100,
  income_eur    NUMERIC,
  cost_eur      NUMERIC,
  notes         TEXT,
  created_by    TEXT DEFAULT 'ai',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_operations_forest ON operations(forest_id);
CREATE INDEX idx_operations_year ON operations(forest_id, year);

ALTER TABLE operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner access via forest" ON operations
  FOR ALL USING (forest_id IN (SELECT id FROM forests WHERE owner_id = auth.uid()));
CREATE POLICY "Shared read access" ON operations FOR SELECT USING (
  forest_id IN (SELECT forest_id FROM plan_shares WHERE shared_with = auth.uid())
);

-- Timber prices
CREATE TABLE timber_prices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source        TEXT,
  fetched_at    TIMESTAMPTZ DEFAULT now(),
  price_data    JSONB NOT NULL
);

ALTER TABLE timber_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read" ON timber_prices
  FOR SELECT USING (auth.role() = 'authenticated');

-- Plan metadata
CREATE TABLE plan_metadata (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forest_id     UUID NOT NULL REFERENCES forests(id) ON DELETE CASCADE,
  name          TEXT,
  period_start  INTEGER,
  period_end    INTEGER,
  total_volume_m3 NUMERIC,
  stumpage_value_eur NUMERIC,
  annual_growth_m3 NUMERIC,
  owner_stated_value_eur NUMERIC,
  prices_id     UUID REFERENCES timber_prices(id),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE plan_metadata ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner access via forest" ON plan_metadata
  FOR ALL USING (forest_id IN (SELECT id FROM forests WHERE owner_id = auth.uid()));

-- Chat
CREATE TABLE chat_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forest_id     UUID NOT NULL REFERENCES forests(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES profiles(id),
  title         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_chat_sessions_forest ON chat_sessions(forest_id);
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner access via forest" ON chat_sessions
  FOR ALL USING (forest_id IN (SELECT id FROM forests WHERE owner_id = auth.uid()));

CREATE TABLE chat_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,
  content       TEXT NOT NULL,
  tool_calls    JSONB,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_chat_messages_session ON chat_messages(session_id);
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner access via session" ON chat_messages FOR ALL USING (
  session_id IN (SELECT id FROM chat_sessions WHERE forest_id IN (
    SELECT id FROM forests WHERE owner_id = auth.uid()
  ))
);

-- Plan sharing
CREATE TABLE plan_shares (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forest_id     UUID NOT NULL REFERENCES forests(id) ON DELETE CASCADE,
  shared_with   UUID NOT NULL REFERENCES profiles(id),
  role          TEXT DEFAULT 'viewer',
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(forest_id, shared_with)
);

ALTER TABLE plan_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner manages shares" ON plan_shares
  FOR ALL USING (forest_id IN (SELECT id FROM forests WHERE owner_id = auth.uid()));
```

---

## 5. AI Architecture — Two Modes

### 5.1 Design: Generation mode + Editing mode

The AI cannot iterate over 162 stands one by one via function calling — token cost would explode. Instead, the system has **two modes**:

| Mode | User input | Implementation | Token cost |
|---|---|---|---|
| **Generation** | "Generate a 20-year forest plan" | One function call → algorithm runs → all operations at once | ~2K |
| **Editing** | "Move stand 7 clearcut to 2030" | Iterative function calling (multiple small calls) | ~2-5K |

The generation algorithm is ported from the existing Python script (`build_plan_v3_fixed.py`, ~1091 lines). It encapsulates Tapio silvicultural recommendations, Luke VMI13 growth coefficients, and harvesting sustainability rules.

### 5.2 Tools (Functions)

```typescript
const tools = [
  // =========== GENERATION (single call) ===========
  {
    name: "generate_plan",
    description: `Generate a complete forest management plan for the entire property.
    
    The algorithm follows Finnish silvicultural recommendations (Central Finland):
    - Optimal rotation ages: Pine 81-100, Spruce 71-90, Birch 61-70
    - Thinning thresholds: basal area limits by site type
    - Minimum thinning interval: 10 years
    - Sustainability: annual harvest < annual growth
    - Regeneration chain: clearcut → site preparation → planting (automatic)
    - Growth rates: Luke VMI13 coefficients by site type
    
    Returns: operations per stand, key metrics, Excel export.`,
    parameters: {
      period_years: "number (default 20)",
      start_year: "number (default current year)",
    }
  },

  // =========== QUERY ===========
  {
    name: "get_stand",
    description: "Get all data for a single stand (species, site type, age, area, volume, location).",
    parameters: { stand_id: "string (e.g. '7', '89.1')" }
  },
  {
    name: "search_stands",
    description: "Search stands by criteria. All parameters optional — combine as needed.",
    parameters: {
      species: "Pine | Spruce | Birch | ...",
      site_type: "herb-rich | mesic | sub-xeric | xeric",
      development_class: "Seedling | Young | Mature | Regeneration-ready | ...",
      min_age: "number",
      max_age: "number",
      min_area: "number (hectares)"
    }
  },
  {
    name: "plan_summary",
    description: "Return key plan metrics: total volume (m³), annual growth (m³/y), stumpage value (€), average harvest (m³/y), net annual return (€/y, %).",
    parameters: {}
  },
  {
    name: "year_operations",
    description: "List all planned harvests and silviculture for a given year.",
    parameters: { year: "number (e.g. 2028)" }
  },

  // =========== EDITING ===========
  {
    name: "add_operation",
    description: `Add an operation to a stand.
    
    Types and rules:
    - Clear_cut: only for regeneration-ready stands. Removal 100%.
    - Thinning: Mature thinning stand, age ≥ 45 (pine) / 40 (spruce). Removal ~28%.
    - First_thinning: Young thinning stand. Removal ~25%.
    - Selection_cutting: special case, removal 50%.
    - Tending / Early_tending: Seedling stands.
    - Site_prep / Planting: after clearcut.
    
    Do NOT thin a stand that was thinned less than 10 years ago.
    Do NOT clearcut a stand not classified as regeneration-ready.`,
    parameters: {
      stand_id: "string",
      year: "number",
      type: "Clear_cut | Thinning | First_thinning | Selection_cutting | Tending | Site_prep | Planting",
      removal_pct: "number (only Clear_cut and Selection_cutting, default 100)"
    }
  },
  {
    name: "remove_operation",
    description: "Remove a planned operation from a stand. Use when rescheduling.",
    parameters: { stand_id: "string", year: "number" }
  },
  {
    name: "check_harvest_sustainability",
    description: "Check harvest volume against annual growth for a given year.",
    parameters: { year: "number (optional, default: entire plan period)" }
  },
  {
    name: "validate_plan",
    description: "Validate entire plan: rotation ages, thinning intervals, regeneration chains. Returns issues list or confirmation.",
    parameters: {}
  }
]
```

### 5.3 System Prompt

```
You are a Finnish forestry expert helping a forest owner manage their forest plan.

KEY RULES:
1. Never invent stand data — always fetch it via get_stand or search_stands.
2. When the user asks for a new plan, use the generate_plan tool.
3. When the user asks for modifications, use the editing tools.
4. Always check harvest sustainability after changes.
5. Explain your recommendations in forestry terms.
6. Respond in English.

GENERAL GUIDELINES:
- Thinnings aim for sustainable forest growth.
- Clearcuts are automatically followed by a regeneration chain.
- Never thin the same stand twice within 10 years.
- Aim to keep annual harvest below annual growth.
- Detailed rotation ages, thresholds, and growth coefficients are built into the generate_plan tool.
```

### 5.4 Example flows

**Generation:**
```
User: "Generate a 20-year forest plan for Hokkala."

AI → generate_plan({ period_years: 20 })
AI → plan_summary()

Response: "Plan ready! Key metrics:
🌲 Total volume: 32,536 m³
📈 Annual growth: 1,061 m³/y
💰 Stumpage value: €1,473,650
🪓 Avg. harvest: 945 m³/y (89% of growth)

Period 1 (2026-2035): 18 clearcuts, 24 thinnings
Period 2 (2036-2045): 21 clearcuts, 23 thinnings

You can see the stands on the map. Would you like any changes?"
```

**Editing:**
```
User: "Move stand 7 clearcut from 2028 to 2030."

AI → get_stand("7") → remove_operation({stand_id: "7", year: 2028}) 
    → check_harvest_sustainability({year: 2030})
    → add_operation({stand_id: "7", year: 2030, type: "Clear_cut"})
    → validate_plan()

Response: "Moved stand 7 clearcut to 2030. ⚠️ Year 2030 harvest now exceeds growth by 6%. Want me to rebalance?"
```

---

## 6. Frontend Architecture

### 6.1 Routes

```
/                           → Landing page
/auth                       → Login / register (Supabase Auth)
/app/dashboard              → Forest list
/app/forest/[id]            → Main view (map + chat)
/app/forest/[id]/summary    → Summary dashboard
/app/forest/[id]/stands     → Stand table
/app/forest/[id]/timeline   → Harvest timeline (Gantt)
/app/forest/new             → Import (enter property ID)
/app/settings               → User settings
```

### 6.2 Component Tree

```
ForestLayout
├── ForestHeader
├── ResizablePanelGroup
│   ├── VisualizationPanel
│   │   ├── MapView (MapLibre GL)
│   │   │   ├── StandPolygon (one per stand, colored by development class)
│   │   │   └── StandPopup
│   │   ├── SummaryDashboard (Recharts)
│   │   ├── StandTable (TanStack Table)
│   │   └── TimelineGantt
│   └── ChatPanel
│       ├── ChatMessages
│       │   ├── UserMessage
│       │   ├── AssistantMessage
│       │   └── ToolCallCard
│       └── ChatInput
```

### 6.3 State (Zustand)

```typescript
interface ForestStore {
  forest: Forest | null;
  compartments: Compartment[];
  operations: Operation[];
  chatSession: ChatSession | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  selectedStandId: string | null;
  selectedYear: number | null;
  mapViewState: { zoom: number; center: [number, number] };
}
```

### 6.4 Offline (IndexedDB + Service Worker)

- **Dexie.js** stores: compartments, operations, plan metadata, chat messages locally
- **Service Worker** caches: app shell, map tiles, static assets
- Online → sync from Supabase → IndexedDB
- Offline → read from IndexedDB, map still works, chat shows "offline" state
- GPS → "Which stand am I in?" via browser geolocation + `ST_Contains` against cached geometries

### 6.5 Testing

| Layer | Framework | Location | Purpose |
|---|---|---|---|
| **Unit** | Vitest | `src/__tests__/unit/` | Pure functions, store slices, type converters |
| **Component** | Vitest + React Testing Library | `src/__tests__/components/` | Render logic, prop contracts, MapLibre mock |
| **Integration** | Vitest + MSW | `src/__tests__/integration/` | Hooks, Supabase REST, IndexedDB sync |
| **E2E** | Playwright | `e2e/` (Phase 5) | Full browser flows |

**NPM scripts:** `npm test` (single run), `npm run test:watch` (TDD loop), `npm run test:ui` (visual explorer), `npm run test:coverage` (v8 coverage).

Tests follow TDD: write failing test first, then implement. Each Phase 1 task has a corresponding test file (see `docs/plans/phase-1-map-database.md` — Testing Strategy).

**MSW (Mock Service Worker):** Intercepts `fetch` calls to `*.supabase.co` at the network level. Each handler returns typed JSON matching the Supabase schema. Tests use `server.use()` for per-test route overrides.

**MapLibre GL mocking:** `maplibre-gl` is mocked globally in component tests (jsdom has no WebGL). Mock returns a stub Map with no-op methods. Visual map interaction testing is deferred to Playwright E2E.

---

## 7. Data Import Architecture

### 7.1 Primary: Property ID import

```
POST /api/import/property
Body: { property_id: "989-405-0001-0405", forest_name: "Hokkala" }

Backend flow:
  1. Fetch property boundary from MML OGC API
  2. Store in property_boundaries (PostGIS)
  3. Fetch stands from Metsäkeskus WFS (bounding box)
  4. Spatial filter in PostGIS: ST_Within(stand_geometry, property_geometry)
  5. Store in compartments table
  6. Return { forest_id, compartment_count, total_area_ha }
```

Implemented as **Supabase Edge Function** (Vercel Hobby tier has 10s timeout, WFS fetch may take longer). Frontend polls status.

### 7.2 Backup: File upload

Used only if MML/WFS path fails (e.g., property ID not found, WFS down).

---

## 8. Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Framework** | Next.js 16 (App Router) | SSR/SSG, API routes, React 19 |
| **Language** | TypeScript (strict) | Type safety across stack |
| **Database** | Supabase (PostgreSQL + PostGIS) | Auth + DB + Storage in one, spatial via PostGIS |
| **Map** | MapLibre GL JS 5.x | Free, fast, GeoJSON support, no API token limits |
| **Map tiles** | OpenFreeMap / OpenStreetMap | Free, well-mapped Finland |
| **Charts** | Recharts | React-native, clean API |
| **Tables** | TanStack Table v8 | Sort, filter, paginate — headless |
| **CSS** | Tailwind CSS 4 | Fast prototyping, responsive |
| **State** | Zustand 5 | Simple, typed, no boilerplate |
| **Offline DB** | Dexie.js (IndexedDB) | Offline-first: local copy of stand/chat data |
| **Auth** | Supabase Auth + RLS | Built-in, email + OAuth |
| **LLM** | OpenRouter API | Function calling support, multiple models |
| **PWA** | Serwist (next-pwa) | Service worker + manifest |
| **Unit/Integration tests** | Vitest + React Testing Library + MSW | Fast, Jest-compatible, ESM-native, API mocking |
| **E2E tests** | Playwright (Phase 5) | Cross-browser, auto-wait, visual diffs |
| **Hosting** | Vercel (frontend), Supabase (backend) | Free tiers sufficient initially |
| **GIS data** | MML OGC API + Metsäkeskus WFS | Both free, open |

---

## 9. MVP Task Breakdown

### Phase 0: Project Setup (1 task)

**T0 — Repo, toolchain, deploy ✅ (completed 2026-05-21)**
- ✅ Create Next.js project with dependencies
- ✅ Supabase project with PostGIS
- ✅ Migration SQL file
- ✅ Run migration (manual — SQL Editor)
- ✅ Vercel deploy (GitHub auto-deploy on push)
- ✅ next-pwa (Serwist) + Dexie.js config
- ✅ Environment variables set (Supabase, MML, OpenRouter)

### Phase 1: Map Foundation (2 tasks, ~9h)

> 📋 **Detailed subplan:** `docs/plans/phase-1-map-database.md` (15 bite-sized tasks)

- **T1** — Map component with MapLibre GL (5h)
- **T2** — Database layer (Supabase client + types, 4h)

### Phase 2: Auth & Import (3 tasks, ~11h) ✅ (completed 2026-05-22)
- **T3** — Supabase Auth integration (2h) ✅
- **T4** — MML integration + spatial import (6h) ✅
- **T5** — Import UI (3h) ✅

### Phase 3: AI Chat (4 tasks, ~23h)
- **T6** — Chat API endpoint (4h)
- **T7** — generate_plan tool (8h — heaviest task)
- **T8** — Editing tools (6h)
- **T9** — Chat UI (5h)

### Phase 4: Visualization (2 tasks, ~6h)
- **T10** — Summary dashboard (3h)
- **T11** — Stand table + timeline (3h)

### Phase 5: PWA & Polish (2 tasks, ~8h)
- **T12** — PWA + offline (4h)
- **T13** — Final testing (4h)

**Total: 13 tasks, ~60h**

---

## 10. Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| MML OGC API changes or becomes paid | Low | High | Plan B (file upload) ready as fallback |
| Metsäkeskus WFS changes (data model reform ongoing) | Medium | High | Proxy layer isolates changes |
| Generation algorithm porting (Python→TS) takes longer | Medium | Medium | Can run Python as child_process if needed |
| LLM hallucinates function parameters | Medium | Medium | Backend validates all calls before execution |
| WFS import exceeds Vercel 10s timeout | High | Medium | Supabase Edge Function for import, frontend polls |
| MML API key leaks to client | Low | High | Backend-only env var, code review gate |

---

*Plan version: 3.0 — Renamed to ForestChat, switched to English. Key changes from v2.0: Project renamed, all UI/tools/prompts in English, attribute names updated, proper repo setup completed.*