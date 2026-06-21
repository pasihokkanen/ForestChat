# Multi-Forest Support & Global Chat Panel

**Status:** Draft — Architecture Plan  
**Date:** 2026-06-21  
**Author:** Systems Architect (via Hermes Agent)  
**Owner:** Pasi Hokkanen  
**Repo:** github.com/pasihokkanen/ForestChat  
**Depends on:** All completed phases (1–9)

---

## 1. Overview

Two intertwined features that reshape ForestChat's navigation model:

1. **Global chat panel** — a persistent right sidebar in `(app)/layout.tsx` visible on every authenticated page. One conversation per user, not per forest. Context-aware: dashboard mode (import assistant) vs forest mode (plan editor).

2. **Multi-forest support** — users can activate multiple forests via checkboxes. The dashboard becomes the primary working view, showing combined data (map, stands, operations, charts) from all active forests. AI tools operate on the active set. Stand IDs are namespaced by forest to remain globally unique.

### Why Together

These features are architecturally coupled:
- The global chat needs to know which forests are active to build the system prompt
- Multi-forest data loading depends on the active set, managed from the dashboard
- The dashboard must host both the forest selector AND the chat panel
- Navigation model changes: dashboard becomes the workspace; `/forest/[id]` may become a filtered view or be removed

---

## 2. Database Migration

### 2.1 User-Scoped Chat Sessions

**Migration:** `supabase/migrations/002_global_chat.sql`

```sql
-- Allow chat sessions without a forest (dashboard chat)
ALTER TABLE chat_sessions ALTER COLUMN forest_id DROP NOT NULL;

-- New RLS: user owns their sessions directly
DROP POLICY IF EXISTS "Owner access via forest" ON chat_sessions;
CREATE POLICY "Owner access" ON chat_sessions
  FOR ALL USING (user_id = auth.uid());

-- Cascade: chat messages accessible via user-owned sessions
DROP POLICY IF EXISTS "Owner access via session" ON chat_messages;
CREATE POLICY "Owner access" ON chat_messages
  FOR ALL USING (
    session_id IN (SELECT id FROM chat_sessions WHERE user_id = auth.uid())
  );

-- Add index for user-scoped session lookup
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);
```

**No other schema changes needed.** `compartments` and `operations` already have `forest_id` columns. Multi-forest queries use `.in("forest_id", [...])` instead of `.eq("forest_id", id)`.

---

## 3. Stand ID Uniqueness

### 3.1 Problem

When forests A and B both have stand "7", `stand_id` alone is ambiguous across the active set.

### 3.2 Solution: Composite IDs

| Layer | Format | Example |
|---|---|---|
| **Database** | Separate `forest_id` + `stand_id` columns | Always unique per forest |
| **AI tools / API** | `{forest_id}/{stand_id}` | `c7b3a891-d4e5-.../7` |
| **User chat** | Natural language, AI-resolved | "stand 7 in Hokkala" |
| **UI display** | Stand number + forest badge | `7` [🏷️ Hokkala] |

### 3.3 Disambiguation Flow

```
User: "show stand 7"
  → AI checks active forests
  → Only Hokkala has stand 7 → resolves to c7b3a.../7 automatically
  → Both Hokkala and Metsä2 have stand 7 → AI: "Stand 7 exists in Hokkala and Metsä 2. Which?"
  → User says "Hokkala" → resolved
```

### 3.4 Server-Side Resolver

```typescript
// New: src/lib/ai/stand-resolver.ts
function resolveStandId(
  userInput: string,           // "7", "89.1", "Hokkala/7"
  activeForests: Forest[]
): { forest_id: string; stand_id: string } | { error: string; ambiguous: Forest[] }
```

All AI tools call this before operating on a stand reference.

---

## 4. Store Architecture

### 4.1 Current (Single Forest)

```typescript
// forest-slice.ts
forest: Forest | null;           // one
compartments: Compartment[];     // one forest's
operations: Operation[];         // one forest's
compartmentSpecies: CompartmentSpecies[];  // one forest's
```

### 4.2 Proposed (Multi-Forest)

```typescript
// forest-slice.ts — extended
forests: Forest[];               // all user's forests (loaded once)
activeForestIds: string[];       // checked forests

// Combined data from ALL active forests
compartments: Compartment[];     // from all active
operations: Operation[];         // from all active
compartmentSpecies: CompartmentSpecies[];  // from all active

// Active set management
toggleActiveForest(id: string): void;
setActiveForests(ids: string[]): void;
isActive(id: string): boolean;

// Fetch all active forests' data
refreshActiveData(): void;
```

### 4.3 Chat Store — Unchanged

The existing `chat-slice.ts` remains as-is. `sessionId` is now per-user. The `ChatPanel` component reads `activeForestIds` from the forest slice to determine context (dashboard vs forest mode).

### 4.4 New: App Context Slice

```typescript
// store/app-slice.ts — NEW
activeView: "dashboard" | "forest";
// "dashboard" = no specific forest, or all active
// "forest" = single forest focused (from /forest/[id] or dashboard selection)
```

---

## 5. Page Structure

### 5.1 New Layout

```
(app)/layout.tsx
└─ Header
└─ Main (flex row, h-screen minus header)
   ├─ {children} (flex-1, overflow-hidden)
   │   ├─ DashboardPage (full PanelLayout when active)
   │   └─ ForestPage (single-forest PanelLayout, optional)
   └─ GlobalChatPanel (w-[400px], shrink-0)
```

### 5.2 Dashboard — Becomes Primary Workspace

```
┌──────────────────────────────────────────────────────────────────┐
│ Header (ForestChat, theme, language, user menu)                  │
├────────────┬──────────────────────────────────────┬──────────────┤
│ Forest     │                                      │              │
│ Selector   │  PanelLayout                         │  Global      │
│ (240px)    │  ┌─ Charts ────┬─ Map/Stands/Ops ─┐  │  Chat        │
│            │  │             │                   │  │  (400px)     │
│ ✅ Hokkala │  │  Charts     │  TabContainer     │  │              │
│ ✅ Metsä 2 │  │  Panel      │  (Map/Stands/     │  │  Messages    │
│ ☐ Metsä 3  │  │             │   Operations)    │  │  + Input     │
│            │  └─────────────┴───────────────────┘  │              │
│ + Import   │                                      │              │
└────────────┴──────────────────────────────────────┴──────────────┘
```

**Large screens (≥1280px):** 3-column — forest selector + PanelLayout + chat.  
**Medium (1024–1279px):** 2-column — collapsible forest selector drawer + PanelLayout + chat.  
**Small (<1024px):** 1-column — map + chat overlay, forest selector as bottom sheet.

### 5.3 Forest Detail Page

**Decision needed (see §9):** Keep or remove `/forest/[id]`.

**If kept:** Shows single-forest `PanelLayout` with `activeForestIds = [forestId]`. Global chat still visible. Acts as a focused view.

**If removed:** Selecting a single forest in the dashboard simply sets `activeForestIds = [forestId]`. All interaction happens on the dashboard.

---

## 6. Hook Changes

### 6.1 From Single to Multi-Forest

| Hook | Current | Proposed |
|---|---|---|
| `useCompartments(forestId)` | `.eq("forest_id", id)` | `useCompartments(forestIds[])` → `.in("forest_id", ids)` |
| `useOperations(forestId)` | `.eq("forest_id", id)` | `useOperations(forestIds[])` → `.in("forest_id", ids)` |
| `useCompartmentSpecies(forestId)` | `.eq("forest_id", id)` | `useCompartmentSpecies(forestIds[])` → `.in("forest_id", ids)` |
| `useCharts(forestId)` | `/api/forest/{id}/charts` | `useCharts(forestIds[])` → new `GET /api/charts?forests=a,b,c` |

Empty array → no data loaded.

### 6.2 New Hook: `useUserForests`

```typescript
// Fetches all forests for the authenticated user on mount
function useUserForests(): { forests: Forest[]; loading: boolean; error: string | null }
```

Called once in the `(app)/layout.tsx` to populate the forest selector.

---

## 7. AI Tools — Multi-Forest Scoping

### 7.1 Context Change

```typescript
// Current (tool-executor.ts)
interface ToolContext {
  forestId: string;  // single
  // ...
}

// Proposed
interface ToolContext {
  forestIds: string[];  // active set
  // ...
}
```

### 7.2 Query Tools

| Tool | Change |
|---|---|
| `search_stands` | `.in("forest_id", forestIds)` instead of `.eq()` |
| `get_stand` | Accept composite ID `{forest_id}/{stand_id}`; parse and query |
| `plan_summary` | Aggregate across all active forests; show per-forest breakdown |
| `query_operations` | `.in("forest_id", forestIds)` |

### 7.3 Edit Tools

| Tool | Change |
|---|---|
| `add_operation` | Accept composite `stand_id`; extract `forest_id`; validate both |
| `remove_operation` | Accept composite; scope delete to correct forest |
| `batch_update_operations` | Same composite ID handling |
| `clear_plan` | Delete from ALL active forests; stronger confirmation required |
| `generate_plan` | Fetch compartments from all active forests; enrich each stand with its forest's `growth_multiplier`; save operations with correct `forest_id` |

### 7.4 New Tools

| Tool | Purpose |
|---|---|
| `list_forests` | List all user's forests with summary stats (dashboard mode) |
| `import_forest_csv` | Parse CSV, show preview, ask for missing info, import (from global chat plan) |
| `preview_csv_file` | Inspect uploaded CSV: detect format, count stands, estimate volume |
| `convert_csv_format` | Map non-standard CSV columns to importable format |
| `open_forest` | (Client-side SSE) Navigate to /forest/[id] or set it as active on dashboard |
| `close_forest` | Remove from active set |

### 7.5 System Prompt — Dual Mode

**Dashboard mode** (`activeForestIds` is empty):
```
You are a Finnish forestry AI assistant. The user is on their dashboard.
Available forests: [list from list_forests]. No forests active.
You can help import new forest data, answer forestry questions, or direct the user to activate a forest.
```

**Forest mode** (`activeForestIds` has items):
```
ACTIVE FORESTS (2 of 5 selected):
- Hokkala: 142 compartments, 250.2 ha, 32,536 m³ (gm: 1.08)
- Metsä 2: 67 compartments, 45.1 ha, 5,200 m³ (gm: 0.95)
Combined: 209 compartments, 295.3 ha, 37,736 m³

[rest of current forest-mode system prompt with multi-forest context]
```

---

## 8. Map & Visualization

### 8.1 Stand Rendering

**Challenge:** Distinguish stands from different forests on the same map.

**Proposed:** Keep development class coloring (green = young, yellow = mature thinning, red = regen ready, etc.). Add:

- **2px colored border** per forest (different hue per active forest)
- **Forest legend** below the dev class legend showing active forests with their border colors
- **Hover popup:** `Hokkala — Stand 7 (spruce, 45y, mesic)`
- **Per-forest opacity toggle** in the forest selector: unchecking dims that forest's stands

### 8.2 Stand List & Operation List

When multiple forests are active:
- Add `Forest` column to both lists
- Sort: by forest name, then by stand_id
- Filter: option to show all or specific forest
- Stand detail cards show forest name badge

### 8.3 Charts

**Chart tabs:** Global — shared across active set. When active forests change, all chart data recomputes.

**New chart type:** "By forest" grouping — bar chart with per-forest totals (volume, area, income).

**Chart API:** New endpoint `GET /api/charts?forests=uuid1,uuid2` that queries across multiple forests.

---

## 9. Open Design Decisions

| # | Decision | Options | Impact |
|---|---|---|---|
| 1 | **Keep `/forest/[id]`?** | (A) Keep as focus view — (B) Remove, dashboard handles everything | Page structure, navigation, Deep-linking |
| 2 | **Stand visual distinction** | (A) Dev class colors + subtle forest border — (B) Color by forest instead — (C) Configurable toggle | Map readability with 2+ forests |
| 3 | **Chart persistence** | (A) Global tabs, shared across active set — (B) Per-forest tabs, shown when forest is solo focus | UX consistency, data freshness |

---

## 10. Implementation Phases

### Phase A: Foundation (Low Risk, No Visual Change)

| # | Step | Files | Effort |
|---|---|---|---|
| A1 | DB migration (`forest_id` nullable, new RLS) | `migrations/002_global_chat.sql` | S |
| A2 | `getOrCreateSession` supports nullable forest_id | `chat-sessions.ts` | S |
| A3 | `useUserForests` hook | New: `hooks/use-user-forests.ts` | S |
| A4 | Multi-forest store slice | `forest-slice.ts` → extended | M |
| A5 | `stand-resolver.ts` utility | New: `ai/stand-resolver.ts` | S |

### Phase B: Global Chat Panel

| # | Step | Files | Effort |
|---|---|---|---|
| B1 | Move chat to `(app)/layout.tsx` as sidebar | `layout.tsx`, remove from `ForestView.tsx` | M |
| B2 | `GlobalChatPanel` component | New: `GlobalChatPanel.tsx` (80% reuse `ChatPanel`) | M |
| B3 | Dual-mode system prompt | `system-prompt.ts` — add dashboard variant | S |
| B4 | Dashboard tools (`list_forests`, `open_forest`, `close_forest`) | `tools.ts`, `tool-executor.ts` | M |
| B5 | File upload endpoint + UI | New: `api/chat/upload/route.ts`, `FileUploadBar.tsx` | M |
| B6 | Import tools (`import_forest_csv`, `preview_csv_file`, `convert_csv_format`) | `tools.ts`, `tool-executor.ts`, reuse `csv-importer.ts` | L |

### Phase C: Multi-Forest Data

| # | Step | Files | Effort |
|---|---|---|---|
| C1 | Multi-forest hooks (`.in()` queries) | `use-compartments.ts`, `use-operations.ts`, `use-compartment-species.ts` | M |
| C2 | Multi-forest charts API + hook | New: `api/charts/route.ts`, `use-charts.ts` | M |
| C3 | AI tools → multi-forest (composite IDs) | All `query-tools.ts`, `edit-tools.ts`, `validation-tools.ts` | L |
| C4 | `generate_plan` multi-forest | `generate-plan.ts` — per-forest growth multipliers | M |
| C5 | System prompt multi-forest context | `system-prompt.ts` | S |

### Phase D: Dashboard → Main Workspace

| # | Step | Files | Effort |
|---|---|---|---|
| D1 | Dashboard layout: forest selector + PanelLayout | `dashboard/page.tsx` (rewrite) | L |
| D2 | Map multi-forest rendering (borders, badges) | `StandLayer.tsx`, `MapView.tsx` | M |
| D3 | Stand list / operation list with forest column | `StandList.tsx`, `OperationList.tsx` | M |
| D4 | Chart recompute on active set change | `ChartsPanel.tsx`, chart API | M |
| D5 | Forest selector with checkboxes + import button | New: `ForestSelector.tsx` | M |

### Phase E: Polish

| # | Step | Files | Effort |
|---|---|---|---|
| E1 | Responsive: collapsible forest drawer, chat overlay | Layout components | M |
| E2 | Forest detail page decision (keep/remove) | `forest/[id]/page.tsx` | S–M |
| E3 | Mobile: bottom sheet forest selector | `ForestSelector.tsx` | M |
| E4 | Per-forest opacity toggle on map | `StandLayer.tsx`, `MapView.tsx` | S |

---

## 11. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Composite ID parsing breaks existing tools | High | Resolver function with tests; all tools route through it |
| Multi-forest queries hit Supabase row limits | Medium | Paginate; `.in()` filter with max 10 forests expected |
| Chart query config compatibility | Medium | Test all query_config patterns with multi-forest `.in()` |
| User confusion with multiple forests on map | Low | Clear forest legend; opacity toggle; good onboarding |
| `clear_plan` accidentally deletes all forests' ops | High | Strong confirmation dialog; per-forest clear option |
| Global chat context switching mid-conversation | Low | System prompt clearly indicates mode switch; AI handles naturally |

---

## 12. Success Criteria

1. ✅ User checks 2 forests on dashboard → map shows combined stands with forest badges
2. ✅ User says "generate a plan" in chat → plan generated across both forests
3. ✅ Charts show combined data; "by forest" breakdown available
4. ✅ User says "show stand 7" with 2 forests having stand 7 → AI asks which one
5. ✅ User uploads CSV in chat → AI shows preview → asks for property ID → imports
6. ✅ Chat conversation persists when navigating between dashboard and forest pages
7. ✅ Dashboard loads with no forests active → chat shows import assistant mode
8. ✅ `/forest/[id]` still works (or dashboard handles it, per §9 decision)
