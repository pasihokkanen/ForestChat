# ForestChat — Phase 4: Interactive Visualization Dashboard

> **For Hermes:** Load subagent-driven-development skill before implementing. Use OpenCode CLI for coding subagents. Update this plan file to mark tasks as ✅ upon completion.

**Version:** 2.1
**Date:** 2026-05-25

**Changelog v2.1:**
- Changed chart persistence from localStorage to Supabase backend (cross-device sync)
- Added `chart_tabs` database table with RLS + migration SQL
- Added API route: `/api/forest/[id]/charts` (GET list, POST create, DELETE remove/clear)
- Server-side `create_chart`/`clear_charts` tools now persist to Supabase directly
- Added `useCharts` hook for loading chart tabs on mount
- Charts survive page reload AND are visible on any device

**Changelog v2.0:**
- Added full chart type palette: bar, pie, line, area, stacked_bar, scatter, radar, donut, horizontal_bar, composed, waterfall
- Added localStorage persistence for chart tabs (superseded by v2.1 backend persistence)
- Changed panel layout order: Charts | Map | Chat (fullscreen reads left-to-right as visual-first)
- Added clear_charts AI tool for resetting all chart tabs

**Goal:** Build the interactive visualization dashboard — a 3-panel layout (charts + map + chat) where the AI creates charts through conversation, and all panels respond to the same selection state (clicking a chart bar highlights stands on the map, selecting a stand updates chart highlights).

**Core principle:** The chat is the *only* way to create charts. No buttons, no toolbar, no chart-builder UI. The AI generates chart data using its existing query tools (`query_operations`, `search_stands`, `plan_summary`), then calls a dedicated `create_chart` tool to dispatch it to the client as a new tab.

**Tech Stack:** Next.js 16.2 (App Router), MapLibre GL 5, Zustand 5, Recharts 3, Tailwind CSS 4, SSE streaming

**Prerequisites (Phase 0+1+2+3+3b — ALL DONE):**
- ✅ Map with StandLayer rendering polygons colored by development class
- ✅ Click-to-inspect popups on stands
- ✅ Chat panel with SSE streaming (chunk/tool_start/tool_end/done/error events)
- ✅ Chat API with function calling + tool loop
- ✅ All 10 AI tools: getStand, searchStands, planSummary, queryOperations, addOperation, removeOperation, batchUpdateOperations, generatePlan, validatePlan, checkHarvestSustainability
- ✅ Zustand store: map-slice (selectedStandId, hoveredStandId, viewport), forest-slice, chat-slice
- ✅ Recharts installed as dependency
- ✅ Supabase repos for operations, compartments, chat
- ✅ useOperations hook with refetch support

---

## Database: Chart Tabs Table

**New migration:** `004_add_chart_tabs.sql`

```sql
-- supabase/migrations/004_add_chart_tabs.sql
CREATE TABLE chart_tabs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forest_id       UUID NOT NULL REFERENCES forests(id) ON DELETE CASCADE,
  chart_id        TEXT NOT NULL,               -- AI-generated chart ID, e.g. "chart-yearly-income"
  title           TEXT NOT NULL,
  type            TEXT NOT NULL,               -- bar, pie, line, area, stacked_bar, scatter, radar, donut, horizontal_bar, composed, waterfall
  data            JSONB NOT NULL,              -- array of data objects
  x_key           TEXT,
  y_key           TEXT NOT NULL,
  y_key2          TEXT,                        -- secondary Y axis (composed charts)
  name_key        TEXT,                        -- pie/donut slice labels
  color_key       TEXT,                        -- color grouping key
  stand_dimension TEXT,                        -- stand_id mapping key for cross-panel interaction
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(forest_id, chart_id)
);

CREATE INDEX idx_chart_tabs_forest ON chart_tabs(forest_id);

ALTER TABLE chart_tabs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner full access on chart_tabs" ON chart_tabs
  FOR ALL USING (forest_id IN (SELECT id FROM forests WHERE owner_id = auth.uid()));

CREATE POLICY "Shared read on chart_tabs" ON chart_tabs
  FOR SELECT USING (forest_id IN (SELECT forest_id FROM plan_shares WHERE shared_with = auth.uid()));
```

**Run in Supabase SQL Editor before implementing** — the plan assumes migration is applied.

**CRUD surface:**
- **AI tool `create_chart`** runs server-side, calls `ctx.supabase.from("chart_tabs").upsert()` directly (no API route needed — it's inside the chat's tool loop)
- **AI tool `clear_charts`** runs server-side, calls `ctx.supabase.from("chart_tabs").delete().eq("forest_id", ctx.forestId)`
- **Client page load** fetches via `GET /api/forest/[id]/charts` (API route)
- **Manual tab close** calls `DELETE /api/forest/[id]/charts?chart_id=...` (API route)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                  3-Panel Layout (Resizable)                       │
│                                                                   │
│  ┌──────────────────┬──────────────┬──────────────────────────┐   │
│  │  Charts Panel     │  Map Panel   │   Chat Panel             │   │
│  │                   │              │   (fixed 380px)          │   │
│  │  • Tab bar + close│  • Stands    │   • Messages             │   │
│  │  • Chart cards    │  • Highlight │   • Input                │   │
│  │  • Fullscreen btn │  • Popup     │   • Tool status          │   │
│  │  (collapsible)    │  • Fullscreen│                          │   │
│  └──────────────────┴──────────────┴──────────────────────────┘   │
│                                                                   │
│  ↕ Drag handles between panels (or collapse)                      │
│  ↕ Charts panel can be collapsed to give map more space           │
│  ↕ Small screens: map+chat primary, charts as toggle overlay     │
└──────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Chat → AI generates chart data via query_operations/search_stands
     → AI calls create_chart(chartConfig) tool
     → Server persists to Supabase `chart_tabs` table (upsert)
     → Server emits SSE event: "create_chart" { chartConfig }
     → Client SSE parser receives event
     → Zustand visualization-slice: addChartTab(chartConfig)
     → ChartPanel re-renders with new tab
     → Recharts renders the chart

On page load:
     → useCharts(forestId) hook fires
     → GET /api/forest/[id]/charts → fetches chart_tabs from Supabase
     → Zustand: setChartTabs(tabs)
     → ChartsPanel renders persisted tabs

User clicks chart bar (year=2028):
     → Zustand: setSelectedYear(2028)
     → Custom hook: compute highlightedStands (stands with ops in 2028)
     → Zustand: setHighlightedStands(["5", "12", "45"])
     → StandLayer reads highlightedStandIds, adds highlight overlay
     → Map zooms to fit all highlighted stands

User selects stand on map → StandLayer click handler:
     → Zustand: setSelectedStandId("7")
     → Chart components re-render to highlight stand "7"'s data
```

### SSE Event Extensions

Two new SSE event types added to the existing set (chunk, tool_start, tool_end, done, error):

| Event | Data | Effect |
|-------|------|--------|
| `select_stand` | `{ stand_id: string }` | Client selects & zooms to stand, shows popup |
| `create_chart` | `{ chart_id, title, type, data, x_key, y_key, ... }` | Client adds a chart tab |
| `remove_chart` | `{ chart_id: string }` | Client removes a chart tab |
| `clear_charts` | `{}` | Client removes all chart tabs |

These are emitted by AI tools AFTER the server-side handler persists the change to the `chart_tabs` table. The client only reacts to the SSE event; the database write already happened. This way:
- Charts are always backed by Supabase (cross-device)
- The SSE event provides real-time feedback to the chat UI
- On page load, charts are fetched from the `GET /api/forest/[id]/charts` endpoint

### New AI Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `select_stand` | "Highlight a specific stand on the map and zoom to it" | `stand_id: string` |
| `create_chart` | "Create a new chart tab in the visualization panel" | See below |
| `clear_charts` | "Remove all chart tabs from the visualization panel" | `{}` |

**`create_chart` tool definition:**

```typescript
{
  name: "create_chart",
  description: `Create a new chart tab in the visualization panel.
  
  The AI must first compute the chart data using query tools (query_operations, search_stands, plan_summary).
  Then call create_chart with the pre-computed data array.
  
  Supported types: bar, pie, line, area, stacked_bar, scatter, radar, donut, horizontal_bar, composed, waterfall.
  For bar/line/area: provide x_key (category axis) and y_key (value axis). Add color_key for stacked_bar (groups by color).
  For pie/donut: provide name_key (slice label) and y_key (value). Use donut for same data with center hole.
  For scatter: x_key and y_key define the two numeric axes.
  For radar: x_key is the attribute dimension, y_key is the value. Each data row is a series point.
  For horizontal_bar: same as bar but rendered horizontally (x_key = labels, y_key = values).
  For composed: line + bar combo. The line is on y_key, bars on a secondary y_key2 param.
  For waterfall: x_key = step labels, y_key = values (positive = gain, negative = loss).
  
  If the chart's categories map to stands (e.g., a bar chart where each bar is a stand),
  set stand_dimension to the key that contains stand_id values — this enables
  click-to-highlight-on-map interaction.`,
  parameters: {
    type: "object",
    properties: {
      chart_id: { type: "string", description: "Unique chart ID, e.g. 'chart-yearly-income'" },
      title: { type: "string", description: "Chart title shown in tab header" },
      type: { type: "string", enum: ["bar", "pie", "line", "area", "stacked_bar", "scatter", "radar", "donut", "horizontal_bar", "composed", "waterfall"], description: "Chart type" },
      data: {
        type: "array",
        items: { type: "object" },
        description: "Array of data objects. Each object is a row with keys matching x_key, y_key, etc."
      },
      x_key: { type: "string", description: "Key for the X-axis / category dimension (bar/line/area)" },
      y_key: { type: "string", description: "Key for the Y-axis / value dimension" },
      name_key: { type: "string", description: "Key for slice labels (pie charts)" },
      color_key: { type: "string", description: "Optional key for color grouping (stacked bars, multi-line)" },
      stand_dimension: {
        type: "string",
        description: "Optional: key in data that maps to stand_id. When set, clicking a data point highlights the matching stand on the map. Example: 'stand_id'"
      },
      y_key2: {
        type: "string",
        description: "Optional: secondary Y-axis key. Used by composed chart type (line + bar combo). The line uses y_key, bars use y_key2."
      },
    },
    required: ["chart_id", "title", "type", "data", "y_key"],
  }
}
```

**`select_stand` tool definition:**

```typescript
{
  name: "select_stand",
  description: `Highlight a stand on the map, zoom to it, and show its data popup.
  The AI should call get_stand first to verify the stand exists and include its data
  in the response text.`,
  parameters: {
    type: "object",
    properties: {
      stand_id: { type: "string", description: "Stand ID to select and zoom to, e.g. '7'" },
    },
    required: ["stand_id"],
  }
}
```

**`clear_charts` tool definition:**

```typescript
{
  name: "clear_charts",
  description: `Remove all chart tabs from the visualization panel.
  Use this when the user asks to start over with charts, or when you want
  to replace an old set of charts with fresh ones.`,
  parameters: {
    type: "object",
    properties: {},
  },
}
```

### Zustand Visualization Slice (New)

```typescript
interface ChartTab {
  id: string;
  title: string;
  type: "bar" | "pie" | "line" | "area" | "stacked_bar" | "scatter" | "radar" | "donut" | "horizontal_bar" | "composed" | "waterfall";
  data: Record<string, unknown>[];
  xKey: string | null;
  yKey: string;
  yKey2: string | null;  // secondary Y axis, used by composed charts
  nameKey: string | null;
  colorKey: string | null;
  standDimension: string | null;
}

interface VisualizationSlice {
  // Chart tabs
  chartTabs: ChartTab[];
  activeChartTab: string | null;
  addChartTab: (tab: ChartTab) => void;
  removeChartTab: (id: string) => void;
  clearAllCharts: () => void;  // clear_charts tool
  setActiveChartTab: (id: string | null) => void;
  
  // Charts panel state
  chartsFullscreen: boolean;
  setChartsFullscreen: (v: boolean) => void;
  
  // Cross-panel interaction state
  selectedYear: number | null;
  setSelectedYear: (year: number | null) => void;
  
  // Highlighted stand IDs (from chart clicks or AI commands)
  highlightedStandIds: string[];
  setHighlightedStands: (ids: string[]) => void;
  
  // --- localStorage persistence ---
  // ChartTabs are persisted under `forestchat-charts-${forestId}` in localStorage.
  // On state initialization, load from localStorage.
  // On add/remove/clear, immediately sync to localStorage.
  // The forestSlice.forest.id drives the storage key, so each forest
  // has its own independent set of charts.
  loadChartsFromStorage: (forestId: string) => void;
  saveChartsToStorage: () => void;
}
```

---

## Task Structure

```
Track A: Layout & Panel System
  P4.1 → Responsive 3-panel resizable layout
  P4.2 → Charts panel container with tab bar

Track B: Visualization Slice & SSE Handling
  P4.3 → Zustand visualization slice + types
  P4.3b → Chart API route + useCharts hook (Supabase persistence)
  P4.4 → SSE event handlers for chart/select events (client)

Track C: Stand Highlight System (Map)
  P4.5 → Map highlight layer for selected/highlighted stands
  P4.6 → Wire selectedStandId + highlightedStandIds → map visual

Track D: AI Tools (Backend)
  P4.7 → Add create_chart tool to tool definitions + executor
  P4.8 → Add select_stand tool to tool definitions + executor

Track E: Chart Rendering
  P4.9 → ChartCard component (renders bar/pie/line/area from config)
  P4.10 → Chart tab system (add, close, switch, fullscreen toggle)

Track F: Cross-Panel Interaction
  P4.11 → Chart click → highlighted stands + map zoom
  P4.12 → Map selection → chart highlight
  P4.13 → Small-screen responsive layout

Track G: Tests
  P4.14 → Unit tests for visualization slice + chart components
  P4.15 → Integration tests for AI create_chart/select_stand tools
```

### Dependency Graph

```
P4.1 ──► P4.2 ──┐
                 ├──► P4.6 (needs highlight layer P4.5)
          P4.3 ──┼──► P4.4 ──┐
          P4.3b ─┘            │
                              │
P4.5 ──► P4.6 ◄──── P4.11 ──┤
                      │       ├──► P4.13 (integration)
          P4.7 ───────┤       │
          P4.8 ───────┤       │
                      │       │
          P4.9 ──► P4.10 ────┤
                              │
                    P4.11 ────┤
                    P4.12 ────┤
                              │
                    P4.14 ──► P4.15 (tests, after everything)
```

---

## Track A: Layout & Panel System

### P4.1 — Responsive 3-Panel Resizable Layout (2h)

**Objective:** Redesign `ForestView.tsx` from a 2-panel (map + chat) to a 3-panel responsive layout with drag resizing.

**Files:**
- Create: `src/components/layout/PanelLayout.tsx` — 3-panel resizable container
- Create: `src/components/layout/PanelResizer.tsx` — drag handle between panels
- Modify: `src/components/forest/ForestView.tsx` — use new layout

**Layout behavior:**

```text
Full screen (>1280px):         Small screen (<1024px):
┌──────┬──────────┬──────────┐  ┌──────────┬──────────┐
│      │          │          │  │          │          │
│Chart │   Map    │   Chat   │  │   Map    │  Chat    │
│400px │  (flex)  │  380px   │  │  (main)  │  (380px) │
│      │          │          │  │          │          │
└──────┴──────────┴──────────┘  └──────────┴──────────┘
 drag ←→   drag ←→               [📊] toggle chart overlay
```

**Implementation:**

3-panel container:

```tsx
// src/components/layout/PanelLayout.tsx
// Uses CSS grid with grid-template-columns for the 3 panels
// Two drag handles (PanelResizer) between them
// On small screens, charts panel is a sliding overlay toggleable by a button

export default function PanelLayout({
  chartsPanel,
  mapPanel,
  chatPanel,
}: {
  chartsPanel: React.ReactNode;
  mapPanel: React.ReactNode;
  chatPanel: React.ReactNode;
}) {
  // uses useMediaQuery('(min-width: 1024px)') for responsive layout
  // large: grid with 400px auto 380px (charts | map | chat)
  // small: flex with chart as absolute overlay
}
```

**PanelResizer:**

```tsx
// A thin vertical bar between panels
// On drag (pointerdown/pointermove/pointerup):
//   - Updates a CSS variable for grid-template-columns
//   - Stores panel widths in localStorage
//   - Calls map.resize() after drag ends
```

**Modifications to ForestView:**

```tsx
// Current:
<div className="flex h-full">
  <div className="flex-1 relative min-w-0"> ... map ... </div>
  <div className="w-[400px] border-l ..."> <ChatPanel /> </div>
</div>

// New:
<PanelLayout
  chartsPanel={<ChartsPanel />}
  mapPanel={<MapPanel />}
  chatPanel={<ChatPanel forestId={forestId} />}
/>
```

**Verification:**
- [ ] 3 panels visible on screen > 1280px wide
- [ ] Drag handles resize panels
- [ ] Map resizes correctly after panel resize
- [ ] Charts panel has toggle/fullscreen button
- [ ] Small screen: charts panel shows as overlay toggle

---

### P4.2 — Charts Panel Container with Tab Bar (1h)

**Objective:** Create the charts panel shell with a tab bar, empty state, and close button per tab.

**Files:**
- Create: `src/components/charts/ChartsPanel.tsx` — main container
- Create: `src/components/charts/ChartTabBar.tsx` — tab row + close buttons

**Empty state:** When no chart tabs exist, show a placeholder message:
```
📊 No charts yet
Ask the AI to create a chart, e.g.
"Show me yearly income as a bar chart"
```

**Tab bar:**
- Horizontal row of tabs, one per chart
- Active tab highlighted
- Close button (×) on each tab removes it
- Tabs overflow: horizontal scroll if too many

**Fullscreen toggle:**
- Icon button at top right of charts panel
- When active: charts panel expands to full viewport (overlays map+chat)
- Escape or button click to exit fullscreen

**Verification:**
- [ ] Empty state renders with placeholder message
- [ ] Tabs render when charts are added (test with mock data)
- [ ] Close button removes tab
- [ ] Fullscreen toggle works (overlays entire viewport)
- [ ] Tab bar scrolls horizontally if tabs overflow

---

## Track B: Visualization Slice & SSE Handling

### P4.3 — Zustand Visualization Slice + Types (0.75h)

**Objective:** Add a new `visualization-slice.ts` to the Zustand store with chart tabs, selection state, and highlighted stands.

**Files:**
- Create: `src/lib/store/visualization-slice.ts`
- Modify: `src/lib/store/index.ts` — add slice to store

**Interface:**

```typescript
export interface ChartTab {
  id: string;
  title: string;
  type: "bar" | "pie" | "line" | "area";
  data: Record<string, unknown>[];
  xKey: string | null;    // null for pie charts
  yKey: string;
  nameKey: string | null;  // only for pie
  colorKey: string | null;
  standDimension: string | null;
}

export interface VisualizationSlice {
  chartTabs: ChartTab[];
  activeChartTab: string | null;
  addChartTab: (tab: ChartTab) => void;
  removeChartTab: (id: string) => void;
  clearAllCharts: () => void;         // clear_charts AI tool
  setChartTabs: (tabs: ChartTab[]) => void;  // initial load from API
  setActiveChartTab: (id: string | null) => void;
  
  chartsFullscreen: boolean;
  setChartsFullscreen: (v: boolean) => void;
  
  selectedYear: number | null;
  setSelectedYear: (year: number | null) => void;
  
  highlightedStandIds: string[];
  setHighlightedStands: (ids: string[]) => void;
  
  // localStorage fallback for offline resilience
  loadChartsFromStorage: (forestId: string) => void;
  saveChartsToStorage: () => void;
}
```

**Store merger update:**

```typescript
// src/lib/store/index.ts
import { createVisualizationSlice, type VisualizationSlice } from "./visualization-slice";

export type ForestStore = MapSlice & ForestSlice & ChatSlice & VisualizationSlice;

export const useForestStore = create<ForestStore>()((...a) => ({
  ...createMapSlice(...a),
  ...createForestSlice(...a),
  ...createChatSlice(...a),
  ...createVisualizationSlice(...a),
}));
```

**Verification:**
- [ ] Store compiles with no TS errors
- [ ] `addChartTab` adds a tab and auto-selects it
- [ ] `removeChartTab` removes tab and switches to previous or null
- [ ] `clearAllCharts` removes all tabs and sets activeChartTab to null
- [ ] `setHighlightedStands` works
- [ ] `setSelectedYear` works

**Backend persistence (Supabase):**

Persistence is handled at two levels:
1. **Server-side (within AI tools):** `create_chart` and `clear_charts` handlers write directly to the `chart_tabs` table via `ctx.supabase`
2. **Client-side (manual user actions):** Removing a single chart tab or loading on page mount uses the API route

**Visualization slice:**

```typescript
const STORAGE_PREFIX = "forestchat-charts-";

export const createVisualizationSlice: StateCreator<VisualizationSlice> = (set, get) => ({
  chartTabs: [],
  activeChartTab: null,
  chartsFullscreen: false,
  selectedYear: null,
  highlightedStandIds: [],

  addChartTab: (tab) =>
    set((state) => {
      const chartTabs = [...state.chartTabs, tab];
      return { chartTabs, activeChartTab: tab.id };
    }, false, "addChartTab"),

  removeChartTab: (id) =>
    set((state) => {
      const chartTabs = state.chartTabs.filter((t) => t.id !== id);
      const activeChartTab =
        state.activeChartTab === id
          ? chartTabs.length > 0
            ? chartTabs[chartTabs.length - 1].id
            : null
          : state.activeChartTab;
      return { chartTabs, activeChartTab };
    }, false, "removeChartTab"),

  clearAllCharts: () =>
    set({ chartTabs: [], activeChartTab: null }, false, "clearAllCharts"),

  setActiveChartTab: (id) => set({ activeChartTab: id }),

  // ... other setters ...

  // On page load: fetch charts from Supabase
  // Hook into ForestView's data loading — the useCharts hook calls this
  loadChartsFromStorage: (forestId: string) => {
    // Note: this is called after fetching from the API route.
    // The API route is the source of truth, not localStorage.
    // If we also cache locally for offline resilience, write here.
    try {
      const raw = localStorage.getItem(`${STORAGE_PREFIX}${forestId}`);
      if (raw) {
        const chartTabs: ChartTab[] = JSON.parse(raw);
        set({
          chartTabs,
          activeChartTab: chartTabs.length > 0 ? chartTabs[chartTabs.length - 1].id : null,
        });
      }
    } catch {
      localStorage.removeItem(`${STORAGE_PREFIX}${forestId}`);
    }
  },

  saveChartsToStorage: () => {
    // Local cache for offline resilience (secondary to Supabase)
    // The primary persistence happens server-side in the AI tool handlers.
    const { chartTabs } = get();
    try {
      const state = get() as unknown as ForestStore;
      const forestId = state.forest?.id;
      if (forestId) {
        localStorage.setItem(`${STORAGE_PREFIX}${forestId}`, JSON.stringify(chartTabs));
      }
    } catch {
      // silently fail
    }
  },
});
```

**Persistence flow summary:**

| Action | Primary store | SSE event |
|--------|---------------|-----------|
| AI creates chart via `create_chart` tool | Supabase `chart_tabs` (upsert) | ✅ `create_chart` to client |
| AI clears all via `clear_charts` tool | Supabase `chart_tabs` (delete all) | ✅ `clear_charts` to client |
| User closes a chart tab | API route `DELETE` | ❌ No SSE — client-side only |
| User loads the page | `GET /api/forest/[id]/charts` → Zustand | ❌ — initial load |
| Offline reload | localStorage fallback (cached copy) | ❌ — local only |

---

### P4.3b — Chart API Route + useCharts Hook (1.5h)

**Objective:** Create the API route for chart CRUD and a React hook that fetches chart tabs from Supabase on page mount.

**Files:**
- Create: `src/app/api/forest/[id]/charts/route.ts` — GET, POST, DELETE
- Create: `src/lib/hooks/use-charts.ts` — React hook
- Create: `src/lib/repos/chart-tabs.ts` — Supabase repo functions

**API Route — `POST /api/forest/[id]/charts`:**

```typescript
// For client-side chart creation (manual tab close sends DELETE instead)
// CREATE is primarily done server-side via the AI tool, but the API route
// exists for future extensibility. The primary CREATE path is the AI tool.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: forestId } = await params;
  const body = await request.json();
  // Validate, upsert to chart_tabs, return chart tab
}
```

**API Route — `GET /api/forest/[id]/charts`:**

```typescript
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: forestId } = await params;
  // Fetch all chart_tabs for this forest, ordered by created_at ASC
  // Return as JSON array of ChartTab objects
}
```

**API Route — `DELETE /api/forest/[id]/charts`:**

```typescript
// Query param: ?chart_id=... — delete a single chart
// No query param — delete all (used by clear_charts as fallback)
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: forestId } = await params;
  const chartId = request.nextUrl.searchParams.get("chart_id");
  // If chartId: delete single row
  // If no chartId: delete all chart_tabs for this forest
}
```

**Repo (`src/lib/repos/chart-tabs.ts`):**

```typescript
import { createServerSupabase } from "@/lib/supabase/server";
import type { ChartTab } from "@/lib/store/visualization-slice";

export async function getChartTabs(forestId: string): Promise<ChartTab[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("chart_tabs")
    .select("*")
    .eq("forest_id", forestId)
    .order("created_at", { ascending: true });
  return (data ?? []).map(mapRowToChartTab);
}

export async function upsertChartTab(forestId: string, tab: ChartTab): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase.from("chart_tabs").upsert({
    forest_id: forestId,
    chart_id: tab.id,
    title: tab.title,
    type: tab.type,
    data: tab.data,
    x_key: tab.xKey,
    y_key: tab.yKey,
    y_key2: tab.yKey2,
    name_key: tab.nameKey,
    color_key: tab.colorKey,
    stand_dimension: tab.standDimension,
  }, { onConflict: "forest_id, chart_id" });
}

export async function deleteChartTab(forestId: string, chartId: string): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase.from("chart_tabs").delete().eq("forest_id", forestId).eq("chart_id", chartId);
}

export async function deleteAllChartTabs(forestId: string): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase.from("chart_tabs").delete().eq("forest_id", forestId);
}

function mapRowToChartTab(row: Record<string, unknown>): ChartTab {
  return {
    id: row.chart_id as string,
    title: row.title as string,
    type: row.type as ChartTab["type"],
    data: row.data as Record<string, unknown>[],
    xKey: (row.x_key as string) ?? null,
    yKey: row.y_key as string,
    yKey2: (row.y_key2 as string) ?? null,
    nameKey: (row.name_key as string) ?? null,
    colorKey: (row.color_key as string) ?? null,
    standDimension: (row.stand_dimension as string) ?? null,
  };
}
```

**Hook (`src/lib/hooks/use-charts.ts`):**

```typescript
"use client";

import { useEffect } from "react";
import { useForestStore } from "@/lib/store";

export function useCharts(forestId: string) {
  const { setChartTabs } = useForestStore();

  useEffect(() => {
    let cancelled = false;
    
    fetch(`/api/forest/${encodeURIComponent(forestId)}/charts`)
      .then(res => res.json())
      .then(tabs => {
        if (!cancelled && Array.isArray(tabs)) {
          setChartTabs(tabs);
        }
      })
      .catch(() => {
        // Silently fail — charts will be empty, user can ask AI to recreate
      });

    return () => { cancelled = true; };
  }, [forestId, setChartTabs]);
}
```

Note: `setChartTabs` must be added to VisualizationSlice — replaces `loadChartsFromStorage` for the initial-load case:

```typescript
// In VisualizationSlice interface:
setChartTabs: (tabs: ChartTab[]) => void;

// Implementation:
setChartTabs: (tabs) => set({
  chartTabs: tabs,
  activeChartTab: tabs.length > 0 ? tabs[tabs.length - 1].id : null,
}, false, "setChartTabs"),
```

**Integration into ForestView:**

```tsx
// In ForestView, alongside useForest and useCompartments:
import { useCharts } from "@/lib/hooks/use-charts";

// Inside the component body:
useCharts(forestId);
```

**Verification:**
- [ ] `GET /api/forest/[id]/charts` returns chart tabs from Supabase
- [ ] `DELETE /api/forest/[id]/charts?chart_id=...` removes single tab
- [ ] `DELETE /api/forest/[id]/charts` removes all tabs for forest
- [ ] `useCharts` hook fetches on mount and populates Zustand
- [ ] RLS policies prevent cross-forest data leaks

---

### P4.4 — SSE Event Handlers for Chart/Select Events (1h)

**Objective:** Extend the SSE client and ChatPanel to handle two new events: `create_chart`, `select_stand`, and `remove_chart`.

**Files:**
- Modify: `src/lib/chat/sse-client.ts` — add new event types
- Modify: `src/components/chat/ChatPanel.tsx` — add event handlers

**SSE client update:**

```typescript
// New event types added to SseEventType and SseCallbacks
export type SseEventType = "chunk" | "tool_start" | "tool_end" | "done" | "error" 
  | "select_stand" | "create_chart" | "remove_chart";

interface SseCallbacks {
  // ... existing callbacks ...
  onSelectStand?: (standId: string) => void;
  onCreateChart?: (chartConfig: ChartTab) => void;
  onRemoveChart?: (chartId: string) => void;
}
```

**Switch statement addition:**

```typescript
case "select_stand":
  callbacks.onSelectStand?.(data.stand_id);
  break;
case "create_chart":
  callbacks.onCreateChart?.(data);
  break;
case "remove_chart":
  callbacks.onRemoveChart?.(data.chart_id);
  break;
```

**ChatPanel update:** Add handlers that dispatch to Zustand:

```typescript
onSelectStand: (standId) => {
  selectStand(standId);           // from map-slice
  // Map zoom + popup handled by StandLayer reacting to selectedStandId
},
onCreateChart: (chartConfig) => {
  addChartTab(chartConfig);
},
onRemoveChart: (chartId) => {
  removeChartTab(chartId);
},
```

**Verification:**
- [ ] SSE client recognizes the 3 new event types
- [ ] ChatPanel dispatches to Zustand on receipt
- [ ] No console errors on receiving unknown event types (backward compatible)

---

## Track C: Stand Highlight System (Map)

### P4.5 — Map Highlight Layer for Selected/Highlighted Stands (1.5h)

**Objective:** Add a MapLibre highlight layer that renders a bright outline/overlay on stands matching `selectedStandId` or `highlightedStandIds`.

**Files:**
- Modify: `src/components/map/StandLayer.tsx` — add highlight source + layer(s)
- Modify: `src/components/map/StandPopup.tsx` — optionally show on selection (not just click)
- Create (optional): `src/lib/map/constants.ts` — shared layer IDs and style configs

**Highlight layer approach:**

Add a second GeoJSON source + layer above the base fill layer. The highlight source is a GeoJSON source that only contains the selected/highlighted features (a subset of the main data). When selectedStandId or highlightedStandIds changes, we `setData()` on this source with only those features.

Alternatively, use a single source with `filter` expressions on a dedicated layer. The filter approach is simpler:

```typescript
// Add a highlight layer above the fill
map.addLayer({
  id: "stands-highlight",
  type: "line",
  source: SOURCE_ID,  // same source as fill
  filter: ["in", "stand_id", ...highlightedIds], // dynamic
  paint: {
    "line-color": "#FFD700",
    "line-width": 4,
    "line-opacity": 0.9,
  },
});

// Also a brighter fill overlay on top
map.addLayer({
  id: "stands-highlight-fill",
  type: "fill",
  source: SOURCE_ID,
  filter: ["in", "stand_id", ...highlightedIds],
  paint: {
    "fill-color": "#FFD700",
    "fill-opacity": 0.3,
  },
});
```

**Key challenge:** MapLibre expressions accept `["in", key, value1, value2, ...]` but the values must be literals or expressions, not dynamic arrays. For dynamic arrays, use `["match", ["get", "stand_id"], ["literal", ids], true, false]`.

```typescript
const highlightFilter = [
  "match",
  ["get", "stand_id"],
  ["literal", highlightedStandIds],
  true,
  false,
] as maplibregl.Expression;

// When ids change:
if (map.getLayer("stands-highlight")) {
  map.setFilter("stands-highlight", highlightFilter);
  map.setFilter("stands-highlight-fill", highlightFilter);
}
```

**Selection on map click → highlight:**

Currently, clicking a stand shows a popup but doesn't persist the selection. The highlight layer should work together with click handling:

```typescript
const handleStandClick = (e: maplibregl.MapLayerMouseEvent) => {
  const feature = e.features?.[0];
  if (!feature) return;
  const standId = feature.properties?.stand_id as string;
  
  // Set selection in Zustand (this triggers highlight via StandLayer's effect)
  selectStand(standId);
  
  // Show popup (existing behavior)
  // ...
};
```

**Popup on selection:** When `selectedStandId` changes (from AI select_stand tool, not just click), show the popup for that stand. This requires looking up the feature coordinates. Either:
- Keep a memoized map of stand_id → feature geometry in StandLayer
- Or use `map.querySourceFeatures()` to find the feature

**Zooming to a selected stand:** When `selectedStandId` changes to a non-null value, compute the stand's bounding box and call `map.fitBounds()`.

```typescript
// Effect in StandLayer:
useEffect(() => {
  if (!map || !selectedStandId) return;
  // Find the feature
  const features = map.querySourceFeatures("stands", {
    sourceLayer: undefined,
    filter: ["==", ["get", "stand_id"], selectedStandId],
  });
  if (features.length > 0) {
    // Use turf/extent or compute bounds manually
    // fitBoundsToFeature(map, features[0]);
  }
}, [map, selectedStandId]);
```

**Verification:**
- [ ] Clicking a stand highlights it with gold outline + overlay
- [ ] Changing `highlightedStandIds` shows multiple highlights
- [ ] Setting `selectedStandId = null` removes highlight
- [ ] Zoom-to-stand works on selection
- [ ] Popup shows on selection (both click and AI-driven)

---

### P4.6 — Wire selectedStandId + highlightedStandIds → Map Visual (0.5h)

**Objective:** Subscribe StandLayer to the Zustand selection state and reactively update highlight layers.

**Files:**
- Modify: `src/components/map/StandLayer.tsx` — subscribe to Zustand + update filters

**Approach:**

```typescript
import { useForestStore } from "@/lib/store";

function StandLayer({ map, compartments, styleVersion }: StandLayerProps) {
  const selectedStandId = useForestStore((s) => s.selectedStandId);
  const highlightedStandIds = useForestStore((s) => s.highlightedStandIds);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  
  // ... existing setup effect ...
  
  // Highlight effect: update layer filters when selection changes
  useEffect(() => {
    if (!map || !map.getLayer("stands-highlight")) return;
    
    const ids = highlightedStandIds.length > 0
      ? highlightedStandIds
      : selectedStandId
        ? [selectedStandId]
        : [];
    
    const filter = ids.length > 0
      ? (["match", ["get", "stand_id"], ["literal", ids], true, false] as maplibregl.Expression)
      : (["==", ["get", "stand_id"], ""] as maplibregl.Expression); // match nothing
    
    map.setFilter("stands-highlight", filter);
    map.setFilter("stands-highlight-fill", filter);
  }, [map, selectedStandId, highlightedStandIds, styleVersion]);
  
  // ... rest of component ...
}
```

**Verification:**
- [ ] Highlight layers update reactively when store changes
- [ ] Setting both selectedStandId and highlightedStandIds — highlightedStandIds takes precedence
- [ ] Empty array/ null clears highlights

---

## Track D: AI Tools (Backend)

### P4.7 — Add `create_chart` Tool to Tool Definitions + Executor (1h)

**Objective:** Add the `create_chart` AI tool that accepts chart data from the AI and emits an SSE event to the client.

**Files:**
- Modify: `src/lib/chat/tools.ts` — add create_chart definition
- Modify: `src/lib/chat/tool-executor.ts` — add handler
- Modify: `src/app/api/chat/route.ts` — support sending SSE events from tool execution

**Critical design:** The `create_chart` tool writes to the `chart_tabs` table directly via `ctx.supabase` (server-side), *then* emits the SSE event to notify the client. This ensures the chart is persisted in Supabase for cross-device access. The client only reacts to the SSE event — it doesn't need to call an API route.

**Tool definition:**

```typescript
{
  name: "create_chart",
  description: `Create a new chart tab in the visualization panel. Call this after computing the chart data using query_operations/search_stands etc. Creates a tab with a bar, line, pie, or area chart. If stand_dimension is set (e.g., "stand_id"), clicking a data point on the chart will highlight the corresponding stand on the map.`,
  parameters: {
    type: "object",
    properties: {
      chart_id: { type: "string" },
      title: { type: "string" },
      type: { type: "string", enum: ["bar", "pie", "line", "area"] },
      data: { type: "array", items: { type: "object" } },
      x_key: { type: "string" },
      y_key: { type: "string" },
      name_key: { type: "string" },
      color_key: { type: "string" },
      stand_dimension: { type: "string" },
    },
    required: ["chart_id", "title", "type", "data", "y_key"],
  },
}
```

**SSE emission from tool executor:**

The tool executor needs access to the SSE `send` function. Refactor the executor context:

```typescript
interface ToolContext {
  supabase: SupabaseClient;
  forestId: string;
  sendSse?: (event: string, data: unknown) => void; // optional — for client-side tools
}

const toolHandlers = {
  // ... existing handlers ...
  
  create_chart: async (args: Record<string, unknown>, ctx: ToolContext) => {
    const { chart_id, title, type, data, x_key, y_key, name_key, color_key, stand_dimension } = args;
    
    // Validation
    if (!chart_id || typeof chart_id !== 'string') {
      return { success: false, result: "", error: "chart_id is required" };
    }
    if (!["bar", "pie", "line", "area", "stacked_bar", "scatter", "radar", "donut", "horizontal_bar", "composed", "waterfall"].includes(type as string)) {
      return { success: false, result: "", error: `Invalid chart type: ${type}` };
    }
    if (!Array.isArray(data) || data.length === 0) {
      return { success: false, result: "", error: "data must be a non-empty array" };
    }
    
    // Build chart tab object
    const chartTab = {
      id: chart_id as string,
      title: title as string,
      type: type as string,
      data: data as Record<string, unknown>[],
      xKey: (x_key as string) ?? null,
      yKey: y_key as string,
      yKey2: (data as Record<string, unknown>)?.y_key2 as string ?? null,
      nameKey: (name_key as string) ?? null,
      colorKey: (color_key as string) ?? null,
      standDimension: (stand_dimension as string) ?? null,
    } satisfies ChartTab;
    
    // Persist to Supabase (server-side, before SSE event)
    try {
      await ctx.supabase.from("chart_tabs").upsert({
        forest_id: ctx.forestId,
        chart_id: chartTab.id,
        title: chartTab.title,
        type: chartTab.type,
        data: chartTab.data,
        x_key: chartTab.xKey,
        y_key: chartTab.yKey,
        y_key2: chartTab.yKey2,
        name_key: chartTab.nameKey,
        color_key: chartTab.colorKey,
        stand_dimension: chartTab.standDimension,
      }, { onConflict: "forest_id, chart_id" });
    } catch (err) {
      // Log but don't fail — SSE event still propagates
      console.error("Failed to persist chart tab:", err);
    }
    
    // Emit SSE event to client
    ctx.sendSse?.("create_chart", chartTab);
    
    return {
      success: true,
      result: `✅ Chart "${title}" created (${type}, ${data.length} data points). The chart is now visible in the visualization panel.`,
    };
  },

  clear_charts: async (_args: Record<string, unknown>, ctx: ToolContext) => {
    // Delete from Supabase first
    try {
      await ctx.supabase.from("chart_tabs").delete().eq("forest_id", ctx.forestId);
    } catch (err) {
      console.error("Failed to clear chart tabs:", err);
    }
    // Then emit SSE event to remove all chart tabs from client state
    ctx.sendSse?.("clear_charts", {});
    return {
      success: true,
      result: "✅ All charts cleared from the visualization panel.",
    };
  },
};
```

**Route changes for SSE send:**

The route's tool loop currently calls `send` directly. Pass it as context:

```typescript
// In the tool loop (route.ts):
const sendSse = (event: string, data: unknown) => {
  send({ event, data } as SseEvent);
};

const ctx: ToolContext = { supabase, forestId, sendSse };
const result = await toolHandlers[toolName]?.(args, ctx);
```

**Verification:**
- [ ] `create_chart` tool appears in tool definitions
- [ ] Handler validates chart config (invalid type → error)
- [ ] Handler emits SSE event with correct chart data
- [ ] Client receives event and adds chart tab
- [ ] Tool returns success result text for AI to include in response

---

### P4.8 — Add `select_stand` Tool to Tool Definitions + Executor (0.75h)

**Objective:** Add the `select_stand` AI tool that selects a stand on the map and zooms to it.

**Files:**
- Modify: `src/lib/chat/tools.ts` — add select_stand definition
- Modify: `src/lib/chat/tool-executor.ts` — add handler

**Tool definition:**

```typescript
{
  name: "select_stand",
  description: `Select and zoom to a stand on the map. The stand's polygon is highlighted with a gold outline and overlay. A popup with stand data appears. Use this when the user asks to show/zoom to a specific stand. The AI should first call get_stand to verify the stand exists and include its data in the response.`,
  parameters: {
    type: "object",
    properties: {
      stand_id: { type: "string", description: "The stand ID to select, e.g. '7'" },
    },
    required: ["stand_id"],
  },
}
```

**Handler:**

```typescript
select_stand: async (args: Record<string, unknown>, ctx: ToolContext) => {
  const { stand_id } = args;
  
  if (!stand_id || typeof stand_id !== 'string') {
    return { success: false, result: "", error: "stand_id is required" };
  }
  
  // Emit SSE event
  ctx.sendSse?.("select_stand", { stand_id });
  
  return {
    success: true,
    result: `✅ Stand ${stand_id} selected on map.`,
  };
},
```

**Verification:**
- [ ] `select_stand` tool appears in tool definitions
- [ ] Emits `select_stand` SSE event with correct stand_id
- [ ] Client receives event → highlights stand + zooms + shows popup
- [ ] Validation handles missing stand_id

---

## Track E: Chart Rendering

### P4.9 — ChartCard Component (Renders bar/pie/line/area from config) (1.5h)

**Objective:** Create a unified ChartCard component that renders any chart type from a `ChartTab` config using Recharts.

**Files:**
- Create: `src/components/charts/ChartCard.tsx`

**Component:**

```tsx
"use client";

import {
  BarChart, Bar, PieChart, Pie, LineChart, Line, AreaChart, Area,
  ScatterChart, Scatter,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Cell,
} from "recharts";
// WaterfallBar: custom shape for waterfall chart.
// Renders bars colored green (positive) or red (negative) based on value sign.
// Implement as a Recharts <Rectangle> wrapper:
//   <Bar dataKey={...} shape={<WaterfallBar />} />
// For simplicity, the initial implementation renders all bars green
// and relies on the AI to send positive=gain / negative=loss data.
import type { ChartTab } from "@/lib/store/visualization-slice";
import { useForestStore } from "@/lib/store";

const CHART_COLORS = [
  "#4CAF50", "#2196F3", "#FF9800", "#E91E63",
  "#9C27B0", "#00BCD4", "#FF5722", "#607D8B",
  "#8BC34A", "#03A9F4", "#FFC107", "#795548",
];

interface ChartCardProps {
  tab: ChartTab;
}

export default function ChartCard({ tab }: ChartCardProps) {
  const { selectedStandId, highlightedStandIds, selectedYear, setSelectedYear, setHighlightedStands } = useForestStore();
  
  // Handle click on chart element
  const handleChartClick = (data: Record<string, unknown>) => {
    if (!data) return;
    
    // If chart has stand_dimension, clicking highlights that stand
    if (tab.standDimension) {
      const standId = data[tab.standDimension] as string;
      if (standId) {
        setHighlightedStands([standId]);
        return;
      }
    }
    
    // If x_key is "year" or similar, clicking filters by that value
    if (tab.xKey && data[tab.xKey] !== undefined) {
      const year = Number(data[tab.xKey]);
      if (!isNaN(year) && year >= 2000) {
        setSelectedYear(selectedYear === year ? null : year);
      }
    }
  };
  
  // Determine which data points are "active" (highlighted)
  const isActive = (entry: Record<string, unknown>) => {
    if (tab.standDimension && highlightedStandIds.length > 0) {
      return highlightedStandIds.includes(entry[tab.standDimension] as string);
    }
    if (selectedYear && tab.xKey) {
      return Number(entry[tab.xKey]) === selectedYear;
    }
    return false;
  };
  
  // Render based on type
  switch (tab.type) {
    case "bar":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={tab.data} onClick={(e) => handleChartClick(e?.activePayload?.[0]?.payload ?? {})}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={tab.xKey ?? undefined} />
            <YAxis />
            <Tooltip />
            <Bar dataKey={tab.yKey} fill="#4CAF50"
              onClick={(data) => handleChartClick(data)}
            />
          </BarChart>
        </ResponsiveContainer>
      );

    case "stacked_bar":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={tab.data} onClick={(e) => handleChartClick(e?.activePayload?.[0]?.payload ?? {})}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={tab.xKey ?? undefined} />
            <YAxis />
            <Tooltip />
            <Legend />
            {/* Data keys are grouped by color_key — each unique value in color_key becomes a stack */}
            <Bar dataKey={tab.yKey} stackId="a" fill="#4CAF50" />
            {tab.colorKey && <Bar dataKey={tab.colorKey} stackId="a" fill="#2196F3" />}
          </BarChart>
        </ResponsiveContainer>
      );

    case "horizontal_bar":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={tab.data} layout="vertical" onClick={(e) => handleChartClick(e?.activePayload?.[0]?.payload ?? {})}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" />
            <YAxis dataKey={tab.xKey ?? undefined} type="category" width={100} />
            <Tooltip />
            <Bar dataKey={tab.yKey} fill="#FF9800"
              onClick={(data) => handleChartClick(data)}
            />
          </BarChart>
        </ResponsiveContainer>
      );

    case "pie":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={tab.data}
              dataKey={tab.yKey}
              nameKey={tab.nameKey ?? undefined}
              cx="50%" cy="50%"
              outerRadius={120}
              label
              onClick={(data) => handleChartClick(data)}
            >
              {tab.data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      );

    case "donut":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={tab.data}
              dataKey={tab.yKey}
              nameKey={tab.nameKey ?? undefined}
              cx="50%" cy="50%"
              innerRadius={50}
              outerRadius={120}
              label
              onClick={(data) => handleChartClick(data)}
            >
              {tab.data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      );

    case "line":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={tab.data} onClick={(e) => handleChartClick(e?.activePayload?.[0]?.payload ?? {})}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={tab.xKey ?? undefined} />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey={tab.yKey} stroke="#2196F3" strokeWidth={2}
              activeDot={{ r: 8, onClick: (_, e) => handleChartClick(e.payload) }}
            />
          </LineChart>
        </ResponsiveContainer>
      );

    case "area":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={tab.data} onClick={(e) => handleChartClick(e?.activePayload?.[0]?.payload ?? {})}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={tab.xKey ?? undefined} />
            <YAxis />
            <Tooltip />
            <Area type="monotone" dataKey={tab.yKey} stroke="#4CAF50" fill="#4CAF50" fillOpacity={0.3} />
          </AreaChart>
        </ResponsiveContainer>
      );

    case "scatter":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart onClick={(e) => handleChartClick(e?.activePayload?.[0]?.payload ?? {})}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={tab.xKey ?? undefined} type="number" name={tab.xKey ?? "x"} />
            <YAxis dataKey={tab.yKey} type="number" name={tab.yKey} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} />
            <Scatter data={tab.data} fill="#E91E63"
              onClick={(data) => handleChartClick(data)}
            />
          </ScatterChart>
        </ResponsiveContainer>
      );

    case "radar":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={tab.data}>
            <PolarGrid />
            <PolarAngleAxis dataKey={tab.xKey ?? undefined} />
            <PolarRadiusAxis />
            <Tooltip />
            <Radar name={tab.title} dataKey={tab.yKey} stroke="#9C27B0" fill="#9C27B0" fillOpacity={0.3} />
          </RadarChart>
        </ResponsiveContainer>
      );

    case "composed":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={tab.data} onClick={(e) => handleChartClick(e?.activePayload?.[0]?.payload ?? {})}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={tab.xKey ?? undefined} />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey={tab.yKey} fill="#4CAF50" />
            <Line type="monotone" dataKey={tab.yKey2 ?? tab.yKey} stroke="#2196F3" strokeWidth={2} />
          </ComposedChart>
        </ResponsiveContainer>
      );

    case "waterfall":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={tab.data} onClick={(e) => handleChartClick(e?.activePayload?.[0]?.payload ?? {})}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={tab.xKey ?? undefined} />
            <YAxis />
            <Tooltip />
            {/* Waterfall: positive values = gain (green), negative = loss (red) */}
            <Bar dataKey={tab.yKey} fill="#4CAF50"
              shape={<WaterfallBar />}
              onClick={(data) => handleChartClick(data)}
            />
          </BarChart>
        </ResponsiveContainer>
      );
  }
}
```

**Verification:**
- [ ] Bar chart renders with correct data
- [ ] Stacked_bar chart renders with color grouping
- [ ] Pie chart renders with names and values
- [ ] Donut chart renders with inner hole
- [ ] Horizontal_bar chart renders with vertical layout
- [ ] Line chart renders with X/Y axes
- [ ] Area chart renders with gradient fill
- [ ] Scatter chart renders with x/y numeric axes
- [ ] Radar chart renders with polar grid
- [ ] Composed chart renders bars + line together
- [ ] Waterfall chart renders with waterfall bars
- [ ] Chart handles empty data gracefully
- [ ] Clicking any chart element calls handleChartClick

---

### P4.10 — Chart Tab System (Add, Close, Switch, Fullscreen) (1.5h)

**Objective:** Build the full tab management UI inside ChartsPanel.

**Files:**
- Create: `src/components/charts/ChartTabContent.tsx` — renders active tab's chart
- Modify: `src/components/charts/ChartsPanel.tsx` — tabs + content + fullscreen
- Modify: `src/components/charts/ChartTabBar.tsx` — interactive tabs

|**ChartsPanel:**

```tsx
export default function ChartsPanel() {
  const { chartTabs, activeChartTab, removeChartTab, setActiveChartTab, chartsFullscreen, setChartsFullscreen, forest } = useForestStore();
  
  const activeTab = chartTabs.find(t => t.id === activeChartTab);
  
  // When user closes a chart tab, remove from Supabase via API route
  const handleClose = async (chartId: string) => {
    if (!forest?.id) return;
    try {
      await fetch(`/api/forest/${encodeURIComponent(forest.id)}/charts?chart_id=${encodeURIComponent(chartId)}`, {
        method: "DELETE",
      });
    } catch {
      // Silently fail — chart will reappear on next page load if DB delete failed
    }
    removeChartTab(chartId);
  };
  
  return (
    <div className={`flex flex-col ${chartsFullscreen ? 'fixed inset-0 z-50 bg-white dark:bg-gray-900' : 'h-full'}`}>
      <ChartTabBar
        tabs={chartTabs}
        activeId={activeChartTab}
        onSelect={setActiveChartTab}
        onClose={handleClose}
        onFullscreenToggle={() => setChartsFullscreen(!chartsFullscreen)}
        isFullscreen={chartsFullscreen}
      />
      <div className="flex-1 p-2 overflow-hidden">
        {activeTab ? (
          <ChartCard key={activeTab.id} tab={activeTab} />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            <div className="text-center">
              <div className="text-3xl mb-2">📊</div>
              <p>No charts yet</p>
              <p className="text-xs mt-1">Ask the AI to create a chart</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Fullscreen:** When `chartsFullscreen` is true, the charts panel uses `fixed inset-0 z-50` to fill the entire viewport (including overlaying the header). Escape key exits fullscreen.

**Close behavior:** When the last tab is closed, `removeChartTab` sets `activeChartTab` to null, showing the empty state.

**Verification:**
- [ ] Tabs appear and switch correctly
- [ ] Close button removes tab, switches to previous tab
- [ ] Fullscreen toggles charts panel to fill viewport
- [ ] Escape exits fullscreen
- [ ] Empty state renders when no tabs

---

## Track F: Cross-Panel Interaction

### P4.11 — Chart Click → Highlighted Stands + Map Zoom (1h)

**Objective:** When user clicks a chart element (bar, slice, point), compute which stands are associated and highlight them on the map.

**Files:**
- Create: `src/lib/charts/stand-resolver.ts` — resolves chart clicks to stand IDs
- Modify: `src/components/charts/ChartCard.tsx` — wire click to highlight + zoom

**Click resolution logic:**

```typescript
// src/lib/charts/stand-resolver.ts
/**
 * Given a clicked chart data point and the chart config,
 * resolve which stands should be highlighted on the map.
 */
export function resolveHighlightedStands(
  clickedData: Record<string, unknown>,
  tab: ChartTab,
  operations: Operation[],
  compartments: Compartment[],
): string[] {
  // Case 1: Chart has direct stand dimension (stand_id per data point)
  if (tab.standDimension) {
    const standId = clickedData[tab.standDimension] as string;
    return standId ? [standId] : [];
  }
  
  // Case 2: Chart has year dimension (e.g., "year" as x_key)
  // Find all stands with operations in that year
  if (tab.xKey === "year" || tab.xKey === "Year") {
    const year = Number(clickedData[tab.xKey]);
    if (!isNaN(year)) {
      const standIds = operations
        .filter(op => op.year === year)
        .map(op => {
          // Need to resolve compartment_id → stand_id
          const comp = compartments.find(c => c.id === op.compartment_id);
          return comp?.stand_id;
        })
        .filter(Boolean) as string[];
      return [...new Set(standIds)];
    }
  }
  
  return [];
}
```

**After highlighting stands → zoom map:** The zoom is already handled by StandLayer's `fitBoundsToFeatures` effect when `highlightedStandIds` changes (see P4.5). Add a helper function that queries features from the map and calls `fitBounds`.

**Verification:**
- [ ] Clicking a bar in yearly income chart → highlights stands with ops that year
- [ ] Clicking a pie slice with stand_dimension → highlights that stand
- [ ] Clicking same element again → removes highlight (toggle behavior)
- [ ] Map zooms to fit highlighted stands

---

### P4.12 — Map Selection → Chart Highlight (0.75h)

**Objective:** When user selects a stand on the map (click), highlight that stand's data in all visible charts.

**Files:**
- Modify: `src/components/charts/ChartCard.tsx` — react to selectedStandId changes
- Modify: `src/components/map/StandLayer.tsx` — ensure click handler sets highlightedStandIds

**Behavior:**

When `selectedStandId` is set (from map click or AI select_stand):
1. For charts that have `standDimension`: highlight the matching bar/slice
2. For charts grouped by species/site_type: no change (stand-level highlighting doesn't map)

**Implementation in ChartCard:**

The `isActive` function from P4.9 already checks highlightedStandIds. Add selectedStandId consideration:

```typescript
// In ChartCard render, determine which data points to highlight
const activeStandId = useForestStore(s => s.selectedStandId);
const highlightedIds = useForestStore(s => s.highlightedStandIds);

// If a single stand is selected, use that for highlighting
const effectiveHighlightedIds = highlightedIds.length > 0
  ? highlightedIds
  : activeStandId
    ? [activeStandId]
    : [];
```

**Map click → highlightedStandIds:**

Update the map click handler to also set highlightedStandIds:

```typescript
const handleStandClick = (e: maplibregl.MapLayerMouseEvent) => {
  const feature = e.features?.[0];
  if (!feature) return;
  const standId = feature.properties?.stand_id as string;
  
  // Toggle selection: clicking same stand deselects
  if (selectedStandId === standId) {
    selectStand(null);
    setHighlightedStands([]);
  } else {
    selectStand(standId);
    setHighlightedStands([standId]);
  }
  
  // Show popup...
};
```

**Verification:**
- [ ] Clicking a stand on map → highlightedStands is set
- [ ] Charts with standDimension show the stand highlighted
- [ ] Clicking the map background clears highlights
- [ ] Toggle works (click same stand again deselects)

---

### P4.13 — Small-Screen Responsive Layout (1h)

**Objective:** Ensure the 3-panel layout works on screens < 1024px.

**Files:**
- Modify: `src/components/layout/PanelLayout.tsx` — responsive behavior

**Behavior:**

| Screen width | Layout |
|---|---|
| ≥ 1280px | 3-panel grid: charts (400px) | map (flex) | chat (380px) |
| 1024-1279px | 2-panel: charts collapsible left panel, map+chat side by side |
| < 1024px | 2-panel: map+chat, charts accessible via toggle button in header |

**Implementation:**

```typescript
function PanelLayout({ mapPanel, chatPanel, chartsPanel }: Props) {
  const isLarge = useMediaQuery('(min-width: 1280px)');
  const isMedium = useMediaQuery('(min-width: 1024px)');
  const [chartsOpen, setChartsOpen] = useState(false);
  
  if (isLarge) {
    // 3-column grid with resizers
  }
  
  if (isMedium) {
    // 2-column grid + bottom collapsible chart panel
    return (
      <div className="flex flex-col h-full">
        <div className="flex flex-1 min-h-0">
          {/* map + chat */}
        </div>
        {chartsOpen && (
          <div className="h-[300px] border-t" />
        )}
      </div>
    );
  }
  
  // Small: chart as overlay/fullscreen
```

**CSS media query hook:**

```typescript
import { useState, useEffect } from "react";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [query]);
  return matches;
}
```

**Toggle button:** Add a `📊` icon button in the header next to UserMenu when charts aren't visible.

**Verification:**
- [ ] ≥1024px: all panels visible
- [ ] <1024px: chart toggle button appears
- [ ] Toggle opens charts as overlay/panel
- [ ] Map resizes correctly on window resize
- [ ] Panels don't overflow or overlap

---

## Track G: Tests

### P4.14 — Unit Tests for Visualization Slice + Chart Components (1h)

**Objective:** Write unit tests for the new Zustand slice and chart components.

**Files:**
- Create: `src/__tests__/unit/visualization-slice.test.ts`
- Create: `src/__tests__/components/ChartCard.test.tsx`

**visualization-slice test:**

```typescript
describe("VisualizationSlice", () => {
  it("adds a chart tab and auto-selects it");
  it("removes a chart tab and switches to previous");
  it("removing last tab sets activeChartTab to null");
  it("setHighlightedStands updates array");
  it("setSelectedYear updates year");
  it("fullscreen toggle works");
});
```

**ChartCard test:**

```typescript
describe("ChartCard", () => {
  it("renders a bar chart from config");
  it("renders a pie chart from config");
  it("renders line chart from config");
  it("shows empty state for empty data");
  it("handles NaN/undefined values gracefully");
  it("clicking a bar calls handleChartClick");
});
```

**Verification:**
- [ ] All tests pass
- [ ] Coverage includes edge cases (empty data, null values, missing keys)

---

### P4.15 — Integration Tests for AI create_chart/select_stand Tools (1h)

**Objective:** Write integration tests that verify the tool handlers, SSE emission, and client-side reception.

**Files:**
- Create or extend: `src/lib/ai/__tests__/chart-tools.test.ts`
- Create: `src/__tests__/integration/sse-chart-events.test.ts`

**Tool tests:**

```typescript
describe("create_chart tool", () => {
  it("validates chart config and emits SSE event");
  it("rejects invalid chart type");
  it("rejects empty data array");
  it("accepts minimal config (required fields only)");
});

describe("select_stand tool", () => {
  it("emits select_stand SSE event");
  it("handles missing stand_id gracefully");
});
```

**SSE integration test:**

```typescript
describe("SSE chart events (client-side)", () => {
  it("parses create_chart event and adds tab");
  it("parses select_stand event and selects stand");
  it("parses remove_chart event and removes tab");
  it("handles unknown events gracefully");
});
```

**Verification:**
- [ ] All integration tests pass
- [ ] SSE event format matches server emission
- [ ] Client-side handlers work correctly

---

## Migration: Summary of Changes

| File | Action | Reason |
|------|--------|--------|
| `src/lib/store/visualization-slice.ts` | 🆕 Create | New UI state for charts + cross-panel |
| `src/lib/store/index.ts` | 🔧 Modify | Add slice to store |
| `src/lib/repos/chart-tabs.ts` | 🆕 Create | Supabase repo for chart_tabs CRUD |
| `src/lib/hooks/use-charts.ts` | 🆕 Create | Fetch charts from Supabase on mount |
| `src/app/api/forest/[id]/charts/route.ts` | 🆕 Create | GET list, POST upsert, DELETE chart_tabs |
| `supabase/migrations/004_add_chart_tabs.sql` | 🆕 Create | chart_tabs table + RLS |
| `src/components/layout/PanelLayout.tsx` | 🆕 Create | 3-panel resizable layout |
| `src/components/layout/PanelResizer.tsx` | 🆕 Create | Drag handle component |
| `src/components/forest/ForestView.tsx` | 🔧 Modify | Use PanelLayout, add ChartsPanel |
| `src/components/charts/ChartsPanel.tsx` | 🆕 Create | Chart tab container |
| `src/components/charts/ChartTabBar.tsx` | 🆕 Create | Tab row with close buttons |
| `src/components/charts/ChartCard.tsx` | 🆕 Create | Recharts renderer from config |
| `src/components/charts/ChartTabContent.tsx` | 🆕 Create | Active tab chart wrapper |
| `src/lib/charts/stand-resolver.ts` | 🆕 Create | Chart click → stand IDs |
| `src/components/map/StandLayer.tsx` | 🔧 Modify | Add highlight layers |
| `src/lib/chat/sse-client.ts` | 🔧 Modify | New event types |
| `src/components/chat/ChatPanel.tsx` | 🔧 Modify | Event handlers for chart/select |
| `src/lib/chat/tools.ts` | 🔧 Modify | +create_chart, +select_stand |
| `src/lib/chat/tool-executor.ts` | 🔧 Modify | Handlers for new tools |
| `src/app/api/chat/route.ts` | 🔧 Modify | Pass sendSse to tool context |
| `src/lib/hooks/use-media-query.ts` | 🆕 Create | Responsive hook |
| tests | 🆕 Create | 3 test files |

## Phase 4 — Task Dependency Summary

```
P4.1  →  P4.2  →  P4.6  →  P4.13 (layout chain)
P4.3  →  P4.4  →  (connects to all tracks)
P4.5  →  P4.6  →  P4.11 →  P4.12 (highlight chain)
P4.7  →  (AI create_chart backend)
P4.8  →  (AI select_stand backend)
P4.9  →  P4.10 →  P4.11 (chart rendering chain)

Tests at the end: P4.14, P4.15
```

Estimated total effort: **~16-18 hours**

## Verification Checklist

- [ ] `npm run build` — 0 TypeScript errors
- [ ] `npx vitest run` — All tests pass
- [ ] 3-panel layout renders in Charts | Map | Chat order on full screen (≥1280px)
- [ ] Responsive layout works on <1024px screens
- [ ] Clicking a stand highlights it with gold outline + overlay
- [ ] Zoom-to-stand on selection works
- [ ] AI `select_stand` tool highlights stand and shows popup
- [ ] AI `create_chart` tool creates a chart tab (all 11 types)
- [ ] AI `clear_charts` tool removes all chart tabs
- [ ] Chart tab: add, close, switch between tabs
- [ ] Chart fullscreen toggle works
- [ ] Chart click → stands highlighted on map + map zooms
- [ ] Map click → chart data points highlighted
- [ ] Empty state shows when no chart tabs exist
- [ ] Drag resizing between panels works
- [ ] Panel widths are persisted across page reload (localStorage)
- [ ] ✅ **Chart tabs persist across page reload AND across devices** — create a chart on device A, open on device B, same charts visible
- [ ] ✅ **All chart types render** — bar, stacked_bar, pie, donut, line, area, scatter, radar, composed, horizontal_bar, waterfall
- [ ] ✅ **Charts panel is leftmost in the layout** (Charts | Map | Chat)
- [ ] ✅ **Migration `004_add_chart_tabs.sql` run in Supabase SQL Editor** before implementing
- [ ] ✅ `create_chart` AI tool writes to `chart_tabs` table (verify in Supabase dashboard)
- [ ] ✅ `clear_charts` AI tool deletes from `chart_tabs` table
- [ ] ✅ Manual tab close calls `DELETE /api/forest/[id]/charts` API route
- [ ] ✅ `useCharts` hook fetches chart tabs on page load
- [ ] ✅ RLS policies allow owner write and shared read