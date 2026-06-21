# Multi-Forest Support & Global Chat Panel

**Status:** Reviewed — Decisions Made, Ready for Implementation  
**Date:** 2026-06-21  
**Author:** Systems Architect (via Hermes Agent)  
**Owner:** Pasi Hokkanen  
**Repo:** github.com/pasihokkanen/ForestChat  
**Depends on:** All completed phases (1–9)

**Revisions:**
- 2026-06-21 (v1.2): Second review — charts/user-scoped, confirmation token, generate_plan spec, URL↔store sync, pagination
- 2026-06-21 (v1.1): Post-review update — resolved all open decisions, addressed critical gaps, re-estimated effort

---

## 1. Overview

Two intertwined features that reshape ForestChat's navigation model:

1. **Global chat panel** — a persistent right sidebar in `(app)/layout.tsx` visible on every authenticated page. One conversation per user, not per forest. Context-aware: dashboard mode (import assistant) vs forest mode (plan editor). Forest context comes from the Zustand store's `activeForestIds`, not from the chat session.

2. **Multi-forest support** — users can activate multiple forests via checkboxes. The dashboard becomes the primary working view, showing combined data (map, stands, operations, charts) from all active forests. AI tools operate on the active set. Stand IDs are namespaced by forest to remain globally unique. Charts are user-scoped (global across all forests), recomputed on active set change.

### Why Together

These features are architecturally coupled:
- The global chat needs to know which forests are active to build the system prompt
- Multi-forest data loading depends on the active set, managed from the dashboard
- The dashboard must host both the forest selector AND the chat panel
- Navigation model changes: dashboard becomes the workspace; `/forest/[id]` becomes a focused single-forest view

---

## 2. Key Architectural Decisions

*Resolved 2026-06-21. See §15 for original open items.*

| # | Decision | Choice | Rationale |
|---|---|---|---|
| **D1** | Forest context source | **UI-state-driven** — `activeForestIds` in Zustand store. Session `forest_id` stays NULL. | Multi-forest requires context from the active set, not a single DB row. Every AI tool reads `activeForestIds` from store context. |
| **D2** | Keep `/forest/[id]`? | **Keep** — focused single-forest view. Dashboard = multi-forest workspace; `/forest/[id]` = zoomed-in lens. | Preserves URL-based navigation, bookmarks, and the `open_forest` tool target. Implementation cost is low — it's just a dashboard with `activeForestIds = [id]`. |
| **D3** | Stand visual distinction | **Dev class colors + subtle forest border** (no toggle). 2px colored border per forest, forest legend below dev class legend. | Preserves the existing dev class color language. Sufficient for the common case (2–3 forests). Sufficient for launch; opacity toggle can be added later if needed. |

---

## 3. Database Migration

### 3.1 User-Scoped Everything

**Migration:** `supabase/migrations/017_global_chat.sql`

Three tables move from forest-scoped to user-scoped:

```sql
-- ── chat_sessions: forest_id → nullable ──
ALTER TABLE chat_sessions ALTER COLUMN forest_id DROP NOT NULL;

DROP POLICY IF EXISTS "Owner access via forest" ON chat_sessions;
CREATE POLICY "Owner access" ON chat_sessions
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Owner access via session" ON chat_messages;
CREATE POLICY "Owner access" ON chat_messages
  FOR ALL
  USING (session_id IN (SELECT id FROM chat_sessions WHERE user_id = auth.uid()))
  WITH CHECK (session_id IN (SELECT id FROM chat_sessions WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);

-- ── chart_tabs: forest_id → nullable, add user_id ──
ALTER TABLE chart_tabs ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
ALTER TABLE chart_tabs ALTER COLUMN forest_id DROP NOT NULL;

-- Populate user_id for existing rows via their forest ownership
UPDATE chart_tabs SET user_id = forests.owner_id
  FROM forests WHERE chart_tabs.forest_id = forests.id;

ALTER TABLE chart_tabs ALTER COLUMN user_id SET NOT NULL;

-- Drop old forest-scoped unique constraint, add user-scoped one
ALTER TABLE chart_tabs DROP CONSTRAINT IF EXISTS chart_tabs_forest_id_chart_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chart_tabs_user_chart
  ON chart_tabs(user_id, chart_id);

-- RLS: user owns their chart tabs
DROP POLICY IF EXISTS "Owner access via forest" ON chart_tabs;
CREATE POLICY "Owner access" ON chart_tabs
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── plan_metadata: forest_id → nullable, add user_id ──
ALTER TABLE plan_metadata ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
ALTER TABLE plan_metadata ALTER COLUMN forest_id DROP NOT NULL;

UPDATE plan_metadata SET user_id = forests.owner_id
  FROM forests WHERE plan_metadata.forest_id = forests.id;

ALTER TABLE plan_metadata ALTER COLUMN user_id SET NOT NULL;

DROP POLICY IF EXISTS "Owner access via forest" ON plan_metadata;
CREATE POLICY "Owner access" ON plan_metadata
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

**⚠️ DEPLOYMENT CONSTRAINT:** This migration MUST be deployed atomically with the code changes (same PR/deploy). The migration makes `forest_id` nullable in three tables, but the old code assumes NOT NULL. Deploying the migration ahead of code will cause runtime errors. See §13.1.

**No other schema changes needed.** `compartments` and `operations` already have `forest_id` columns and remain forest-scoped. Multi-forest queries use `.in("forest_id", [...])` instead of `.eq("forest_id", id)`.

**Development note:** No data preservation needed — existing chart_tabs and plan_metadata rows can be deleted and recreated after deployment. We're in active development.

### 3.2 Session Model Change

**Before:** One session per forest. `getOrCreateSession(forestId, userId)` → finds/creates session where `forest_id = forestId`.

**After (Decision D1):** One session per user. `getOrCreateSession(userId)` → finds the user's most recent session (regardless of forest_id) or creates one with `forest_id = NULL`. Forest context comes from the Zustand store's `activeForestIds`, NOT from the session row.

```typescript
// src/lib/chat/chat-sessions.ts — redesigned
async function getOrCreateSession(userId: string): Promise<ChatSession> {
  let session = await supabase
    .from('chat_sessions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  
  if (!session) {
    session = await supabase
      .from('chat_sessions')
      .insert({ user_id: userId, forest_id: null })
      .select()
      .single();
  }
  
  return session;
}
```

**`createSession` (used by `/new` command):** Also becomes user-scoped. Creates a fresh session row — the old session stays but is superseded by the newer `created_at` timestamp (since `getOrCreateSession` picks the most recent).

```typescript
async function createSession(
  userId: string,
  title?: string,
  model?: string
): Promise<ChatSession> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("chat_sessions")
    .insert({
      user_id: userId,
      forest_id: null,
      title: title ?? "Forest Plan Chat",
      model: model ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to create session: ${error.message}`);
  return data as ChatSession;
}
```

**Deleted functions:** `getSessionById` and `updateSessionModel` remain unchanged (they operate on session ID, not forest).

---

## 4. Stand ID Uniqueness

### 4.1 Problem

When forests A and B both have stand "7", `stand_id` alone is ambiguous across the active set.

### 4.2 Solution: Composite IDs

| Layer | Format | Example |
|---|---|---|
| **Database** | Separate `forest_id` + `stand_id` columns | Always unique per forest |
| **AI tools / API** | `{forest_id}/{stand_id}` | `c7b3a891-d4e5-.../7` |
| **User chat** | Natural language, AI-resolved | "stand 7 in Hokkala" |
| **UI display** | Stand number + forest badge | `7` [🏷️ Hokkala] |

### 4.3 Disambiguation Flow

```
User: "show stand 7"
  → AI checks active forests
  → Only Hokkala has stand 7 → resolves to c7b3a.../7 automatically
  → Both Hokkala and Metsä2 have stand 7 → AI: "Stand 7 exists in Hokkala and Metsä 2. Which?"
  → User says "Hokkala" → resolved
```

### 4.4 Server-Side Resolver

```typescript
// New: src/lib/ai/stand-resolver.ts
async function resolveStandId(
  userInput: string,           // "7", "89.1", "Hokkala/7"
  activeForests: Forest[],
  supabase: SupabaseClient     // needed to query which stands exist in each forest
): Promise<{ forest_id: string; stand_id: string } | { error: string; ambiguous: Forest[] }>
```

The resolver queries `compartments` for each active forest to determine whether a stand_id exists. For the explicit composite format `"ForestName/stand_id"`, it skips the DB query and matches by forest name directly. All AI tools call this before operating on a stand reference.

---

## 5. Store Architecture

### 5.1 Current (Single Forest)

```typescript
// forest-slice.ts
forest: Forest | null;           // one
compartments: Compartment[];     // one forest's
operations: Operation[];         // one forest's
compartmentSpecies: CompartmentSpecies[];  // one forest's
```

### 5.2 Proposed (Multi-Forest)

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

### 5.3 Chat Store

`chat-slice.ts` gains `activeForestIds` awareness (reads from forest-slice). The chat panel and system prompt builder read `activeForestIds` to determine context mode:

- **Empty `activeForestIds`** → Dashboard / import assistant mode
- **Non-empty `activeForestIds`** → Forest mode with multi-forest context

The `sessionId` remains per-user. Chat state persists across navigation (layout-level component doesn't unmount).

### 5.4 View Mode (Derived, Not Stored)

No separate `app-slice.ts` needed. The "dashboard vs forest" view is derived:
- When `window.location.pathname` starts with `/forest/` → focused single-forest view (activeForestIds = [routeParam])
- Otherwise → dashboard with full multi-forest workspace

Active forest IDs **persist in the store** when navigating between dashboard and forest pages. Navigating `/forest/[id]` temporarily sets `activeForestIds = [id]`; navigating back to `/dashboard` restores whatever was previously active (the store isn't cleared).

### 5.5 Chart Store (User-Scoped)

Chart tabs are user-scoped, not forest-scoped. The `create_chart`, `remove_chart`, `clear_charts`, `list_charts`, `update_chart`, and `recreate_chart` tools use `user_id` instead of `forest_id`. When active forests change, chart data recomputes from the combined dataset — no chart tabs are deleted.

---

## 6. Page Structure

### 6.1 New Layout

```
(app)/layout.tsx
└─ Header
└─ Main (flex row, h-screen minus header)
   ├─ {children} (flex-1, overflow-hidden)
   │   ├─ DashboardPage (full PanelLayout when active)
   │   └─ ForestPage (single-forest PanelLayout, kept per Decision D2)
   └─ GlobalChatPanel (w-[400px], shrink-0)
```

### 6.2 Dashboard — Primary Workspace

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

### 6.3 Forest Detail Page — Kept (Decision D2)

Shows single-forest `PanelLayout` with `activeForestIds = [forestId]`. Global chat still visible. Acts as a focused, bookmarkable view. The `open_forest` AI tool navigates here.

---

## 7. Hook Changes

### 7.1 From Single to Multi-Forest

| Hook | Current | Proposed |
|---|---|---|
| `useCompartments(forestId)` | `.eq("forest_id", id)` | `useCompartments(forestIds[])` → `.in("forest_id", ids)` |
| `useOperations(forestId)` | `.eq("forest_id", id)` | `useOperations(forestIds[])` → `.in("forest_id", ids)` |
| `useCompartmentSpecies(forestId)` | `.eq("forest_id", id)` | `useCompartmentSpecies(forestIds[])` → `.in("forest_id", ids)` |
| `useCharts(forestId)` | `/api/forest/{id}/charts` | `useCharts(forestIds[])` → new `GET /api/charts?forests=a,b,c` |

Empty array → no data loaded.

### 7.2 New Hook: `useUserForests`

```typescript
// Fetches all forests for the authenticated user on mount
function useUserForests(): { forests: Forest[]; loading: boolean; error: string | null }
```

Called once in the `(app)/layout.tsx` to populate the forest selector.

### 7.3 Supabase `.in()` Considerations

With 5 forests × 150 compartments = 750 rows. JOINs across `compartment_species` for chart queries can get heavy. **Mitigation:** add pagination to hooks from the start:

- **List hooks** (`useCompartments`, `useOperations`): start with `limit: 1000` (PostgREST default). If forests exceed this, add `pageSize` parameter + cursor-based pagination using `stand_id` as cursor.
- **Chart queries**: use `.in("forest_id", ids)` with explicit `limit`. Chart engine queries already use `MAX_ROWS` (500) — keep that cap.
- **Geometry loading**: compartments loaded for the map include PostGIS geometry. For list-only views (stands tab), consider a separate endpoint that omits geometry to reduce payload size. Deferred optimization — 750 geometries is manageable for launch.

Realistic max: ~10 forests, ~1500 compartments. Supabase `.in()` handles this comfortably; the constraint is PostgREST's default `max-rows` (1000). Set explicit limits or paginate.

All hooks retain their current return shapes:
- `useCompartments(forestIds[])` → `{ compartments: Compartment[], loading: boolean, error: string | null }`
- `useOperations(forestIds[])` → `{ operations: Operation[], loading: boolean, error: string | null }`
- `useCompartmentSpecies(forestIds[])` → `{ species: CompartmentSpecies[], loading: boolean, error: string | null }`
- `useCharts(forestIds[])` → unchanged (reads from user-scoped chart_tabs, recomputes on active set change)

---

## 8. AI Tools — Multi-Forest Scoping

### 8.1 Context Change

```typescript
// Current (tool-executor.ts)
interface ToolContext {
  forestId: string;  // single
  // ...
}

// Proposed (Decision D1: UI-state-driven)
interface ToolContext {
  forestIds: string[];  // active set from store
  userId: string;
  // ...
}
```

Forest context is NOT read from the session row. It comes from the Zustand store's `activeForestIds`, injected into `ToolContext` at tool execution time. `userId` is also always available (from auth) — chart tools use it for user-scoped operations.

### 8.2 Query Tools

| Tool | Change |
|---|---|
| `search_stands` | `.in("forest_id", forestIds)` instead of `.eq()` |
| `get_stand` | Accept composite ID `{forest_id}/{stand_id}`; parse via `stand-resolver.ts` and query |
| `plan_summary` | Aggregate across all active forests; show per-forest breakdown |
| `query_operations` | `.in("forest_id", forestIds)` |

### 8.3 Edit Tools

| Tool | Change |
|---|---|
| `add_operation` | Accept composite `stand_id`; extract `forest_id` via resolver; validate both |
| `remove_operation` | Accept composite; scope delete to correct forest |
| `batch_update_operations` | Same composite ID handling via resolver |
| `clear_plan` | Per-forest or all-active with confirmation token. Parameter: `forest_id` (optional, defaults to all active). **Confirmation flow:** When no `forest_id` is provided AND 2+ forests are active, the first call (without `confirm: true`) returns `{ result: "Confirmation required in multi-forest mode", data: { confirmation_required: true, affected_forests: [...] } }`. The AI relays this to the user, and only on a SECOND call with `confirm: true` does the actual deletion proceed. When only 1 forest is active, no confirmation is needed — clear proceeds immediately. |
| `generate_plan` | **Multi-forest spec:** Runs N independent GROW→APPLY→SNAPSHOT simulation loops — one per active forest. Each forest uses its own `growth_multiplier` from `forests.growth_multiplier`. Operations tagged with correct `forest_id`. `plan_metadata` saved as ONE combined row with `forest_id = NULL` and `user_id = userId` — summarizing totals across all active forests. If only 1 forest active, behavior is identical to current single-forest mode. **Parameters:** `forest_ids` (string[], optional, defaults to all active), plus existing `goal`, `period_years`, `start_year`. See §8.5a for the detailed simulation loop design. **Effort: L** |

### 8.3a Generate Plan — Multi-Forest Simulation Design

```
For each forest in activeForestIds:
  1. Fetch compartments WHERE forest_id = forest.id
  2. Fetch forest row (growth_multiplier, price_region)
  3. Fetch compartment_species for those compartments
  4. Run GROW→APPLY→SNAPSHOT pipeline per stand:
     - GROW: age++, height/diameter per Tapio curves × cbrt(gm), volume via Näslund
     - APPLY: per-goal scheduling logic (thinning thresholds, clearcut triggers)
     - SNAPSHOT: record operations with (forest_id, compartment_id, year, type, ...)
  5. Insert all operations in one batch INSERT (per forest, to stay under limits)
  6. Delete old AI-created operations for this forest first (WHERE forest_id + created_by='ai')

After all forests processed:
  7. Save ONE combined plan_metadata row (user_id = userId, forest_id = NULL)
     containing combined totals: volume, area, stems, income by year
  8. Return per-forest breakdown in result
```

This design keeps each forest's simulation independent — stands in Hokkala (gm=1.08) and Lappi (gm=0.85) grow at their own rates. No cross-forest interference.

### 8.4 New Tools

| Tool | Purpose |
|---|---|
| `list_forests` | List all user's forests with summary stats (dashboard mode) |
| `import_forest_csv` | Import a previewed & formatted CSV dataset into a new forest (wraps `csv-importer.ts`) |
| `preview_csv_file` | Inspect uploaded CSV: detect format, count stands, estimate volume |
| `convert_csv_format` | Map non-standard CSV columns to importable format |
| `open_forest` | Client-side action: navigate to /forest/[id] or set it as active on dashboard |
| `close_forest` | Remove from active set |

### 8.5 System Prompt — Dual Mode

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

## 9. Map & Visualization

### 9.1 Stand Rendering (Decision D3)

**Colors:** Development class colors preserved (green = young, yellow = mature thinning, red = regen ready).

**Forest distinction:** 2px colored border per forest. Each active forest gets a distinct hue assigned deterministically from its UUID: `hue = parseInt(forest.id.slice(0, 8), 16) % 360`. This ensures the same forest always gets the same color, regardless of checkbox order or which other forests are active.

**UI elements:**
- Forest legend below the dev class legend showing active forests with their border colors
- Hover popup: `Hokkala — Stand 7 (spruce, 45y, mesic)`
- Per-forest opacity toggle **deferred** (can be added post-launch if users need it)

### 9.2 Stand List & Operation List

When multiple forests are active:
- Add `Forest` column to both lists
- Sort: by forest name, then by stand_id
- Filter: option to show all or specific forest
- Stand detail cards show forest name badge

### 9.3 Charts (User-Scoped)

Chart tabs are stored per-user, not per-forest. When active forests change, all chart data recomputes from the combined dataset — no tabs are deleted or recreated.

**Chart storage:** `chart_tabs` table uses `(user_id, chart_id)` as unique key. All 6 chart tools (`create_chart`, `remove_chart`, `clear_charts`, `list_charts`, `update_chart`, `recreate_chart`) reference `ctx.userId` instead of `ctx.forestId`.

**New chart type:** "By forest" grouping — bar chart with per-forest totals (volume, area, income). Automatically available when 2+ forests are active.

**Chart API:** New endpoint `GET /api/charts?forests=uuid1,uuid2` that queries compartments across multiple forests. `recomputeChartData()` and `recomputeAllCharts()` signatures change from `(supabase, forestId, config)` to `(supabase, forestIds[], config)`.

**Chart query compatibility:** Before Phase C, audit all `chart-engine.ts` query config patterns for `.eq("forest_id")` assumptions. The chart engine has complex configs — some may implicitly assume single-forest. Known patterns to verify: volume-by-species, development-class distribution, age-class breakdown, income projection.

---

## 10. Implementation Phases

### ⚠️ Deployment Constraint

**Phase A migration + code must be deployed atomically.** The migration makes `forest_id` nullable but old code assumes NOT NULL. Deploy migration and code in the same PR. See §14 for validation checklist.

### Phase A: Foundation (Low Risk, No Visual Change)

| # | Step | Files | Effort |
|---|---|---|---|
| A1 | DB migration — `017_global_chat.sql` (chat_sessions, chart_tabs, plan_metadata → user-scoped), new RLS policies, indexes | `migrations/017_global_chat.sql` | S |
| A2 | `getOrCreateSession` + `createSession` redesigned (user-scoped, no `forestId` param) | `chat-sessions.ts` | S |
| A3 | `useUserForests` hook | New: `hooks/use-user-forests.ts` | S |
| A4 | Multi-forest store slice (`forests[]`, `activeForestIds[]`) | `forest-slice.ts` → extended | M |
| A5 | `stand-resolver.ts` utility (composite ID parse/resolve/format) | New: `ai/stand-resolver.ts` | S |
| A6 | Chart engine signatures → `forestIds[]` (breaking change: `recomputeChartData`, `recomputeAllCharts`) | `chart-engine.ts` | S |

### Phase B: Global Chat Panel

| # | Step | Files | Effort |
|---|---|---|---|
| B1 | Move chat to `(app)/layout.tsx` as sidebar. **Scope:** (a) Remove `chatPanel` prop from `PanelLayout` in all 3 responsive breakpoints, (b) Remove `<ChatPanel>` from `ForestView.tsx`, (c) Add `<GlobalChatPanel>` to `(app)/layout.tsx` alongside `{children}`, (d) Dashboard renders `PanelLayout` directly (currently has none). | `layout.tsx`, `ForestView.tsx`, `PanelLayout.tsx` | M |
| B2 | `GlobalChatPanel` component | New: `GlobalChatPanel.tsx` (80% reuse `ChatPanel`) | M |
| B3 | Dual-mode system prompt (reads `activeForestIds` from store; dashboard vs forest mode) | `system-prompt.ts` — add dashboard variant | S |
| B4 | Dashboard tools (`list_forests`, `open_forest`, `close_forest`) | `tools.ts`, `tool-executor.ts` | M |
| B5 | File upload endpoint + UI | New: `api/chat/upload/route.ts`, `FileUploadBar.tsx` | M |
| B6 | Import tools (`import_forest_csv`, `preview_csv_file`, `convert_csv_format`) | `tools.ts`, `tool-executor.ts`, refactor `csv-importer.ts` for two-phase flow | L |

### Phase C: Multi-Forest Data

| # | Step | Files | Effort |
|---|---|---|---|
| C1 | Multi-forest hooks (`.in()` queries + pagination) | `use-compartments.ts`, `use-operations.ts`, `use-compartment-species.ts` | M |
| C2 | Multi-forest charts API + hook (`recomputeChartData(forestIds[])`, new `GET /api/charts?forests=...`) | New: `api/charts/route.ts`, `use-charts.ts` | M |
| C3 | AI tools → multi-forest: (a) composite IDs via `stand-resolver.ts`, (b) chart tools → `ctx.userId` instead of `ctx.forestId`, (c) `clear_plan` confirmation token | All `query-tools.ts`, `edit-tools.ts`, `validation-tools.ts`, `chart-engine.ts` | L |
| C4 | `generate_plan` multi-forest: N independent simulation loops per §8.3a, per-forest `gm`, combined `plan_metadata` | `generate-plan.ts` — significant refactor | **L** |
| C5 | System prompt multi-forest context (per-forest summary, combined totals) | `system-prompt.ts` | S |

### Phase D: Dashboard → Main Workspace

| # | Step | Files | Effort |
|---|---|---|---|
| D1 | Dashboard layout: forest selector + PanelLayout | `dashboard/page.tsx` (rewrite) | L |
| D2 | Map multi-forest rendering (borders, badges, legend) | `StandLayer.tsx`, `MapView.tsx` | M |
| D3 | Stand list / operation list with forest column | `StandList.tsx`, `OperationList.tsx` | M |
| D4 | Chart recompute on active set change | `ChartsPanel.tsx`, chart API | M |
| D5 | Forest selector with checkboxes + import button | New: `ForestSelector.tsx` | M |

### Phase E: Polish

| # | Step | Files | Effort |
|---|---|---|---|
| E1 | Responsive: collapsible forest drawer, chat overlay | Layout components | M |
| E2 | Verify `/forest/[id]` works as focused view (Decision D2) | `forest/[id]/page.tsx` | S |
| E3 | Mobile: bottom sheet forest selector | `ForestSelector.tsx` | M |
| E4 | File upload cleanup: delete `/tmp/chat-uploads/` files after import or after 24h TTL | `api/chat/upload/route.ts` | S |

---

## 11. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|---|
| Composite ID parsing breaks existing tools | High | `stand-resolver.ts` with tests; all tools route through it |
| Multi-forest queries hit Supabase row limits | Medium | Paginate hooks from start; `.in()` filter with max 10 forests expected; explicit `limit` on all queries |
| Chart query config compatibility | Medium | Audit all `chart-engine.ts` patterns before Phase C; test with 2-forest `.in()`; A6 migrates signatures early |
| Chart migration conflicts with existing data | Low | Development phase — existing chart_tabs can be deleted; no data preservation needed |
| User confusion with multiple forests on map | Low | Clear forest legend; good onboarding; opacity toggle deferred |
| `clear_plan` accidentally deletes all forests' ops | High | Confirmation token mechanism (§8.3): first call without `confirm: true` returns `confirmation_required`; only second call with `confirm: true` proceeds. System prompt rule 11 enforces AI must relay confirmation prompt to user. |
| Global chat context switching mid-conversation | Low | System prompt clearly indicates mode switch; AI handles naturally |
| Migration deployed before code (NOT NULL violation) | **Critical** | Atomic deploy only — migration + code in same PR. See §14.1. Affects 3 tables (chat_sessions, chart_tabs, plan_metadata). |
| `generate_plan` complexity with multiple forests | High | Phase C4 is L effort. Each forest runs its own simulation loop; operations tagged with correct `forest_id`. Plan_metadata combined per §8.3a. Test with 2 forests of different growth regions. |

---

## 12. Testing Strategy

### 12.1 Unit Tests

| Test | Covers | Priority |
|---|---|---|
| `stand-resolver` — unique match | One forest has stand "7", resolve to `{forest_id}/7` | P0 |
| `stand-resolver` — ambiguous match | Two forests have stand "7", return `{error, ambiguous: [Forest, Forest]}` | P0 |
| `stand-resolver` — no match | Stand "99" doesn't exist in any active forest, return error | P0 |
| `stand-resolver` — explicit composite | User says "Hokkala/7" → resolved without ambiguity check | P1 |
| `stand-resolver` — fuzzy match | User says "stand seven" → resolves same as "7" | P2 |
| `getOrCreateSession` — first session | No existing session → creates one with `forest_id = NULL` | P0 |
| `getOrCreateSession` — existing session | User already has a session → returns it, does NOT create duplicate | P0 |
| Composite ID parse/format | `{forest_id}/{stand_id}` ↔ `{forest_id, stand_id}` round-trip | P1 |
| `clear_plan` — single forest | `forest_id` provided → only that forest's operations deleted | P0 |
| `clear_plan` — multi-forest no confirm | No `forest_id`, no `confirm`, 2+ active → returns `confirmation_required: true`, `affected_forests: [...]`, doesn't delete | P0 |
| `clear_plan` — multi-forest confirmed | `forest_id` omitted + `confirm: true` → deletes from all active forests | P0 |
| `clear_plan` — single forest auto-approve | No `forest_id`, 1 active forest → clears immediately (no confirmation needed) | P1 |

### 12.2 Integration Tests

| Test | Covers | Priority |
|---|---|---|
| `useCompartments([a, b])` | Returns compartments from both forests, sorted | P0 |
| `useOperations([a, b])` | Returns operations from both forests, each with correct `forest_id` | P0 |
| Chart API `?forests=a,b` | Returns combined chart data, "by forest" breakdown matches per-forest totals | P0 |
| `generate_plan` — single forest | Backward compat: generates plan for one forest, operations have correct `forest_id` | P0 |
| `generate_plan` — two forests, same region | Both forests use same `gm`, combined plan is sum of individual plans | P1 |
| `generate_plan` — two forests, different regions | Each forest uses its own `growth_multiplier` (e.g., gm=1.08 vs gm=0.95), stands grow at different rates | P0 |
| System prompt mode switch | Add/remove forest from active set → system prompt updates (dashboard ↔ forest mode) | P0 |
| File upload → preview → import | Upload CSV → `preview_csv_file` returns stats → `import_forest_csv` creates forest | P1 |

### 12.3 Manual E2E Scenarios

| Scenario | Steps | Expected |
|---|---|---|
| **0 forests — dashboard** | Fresh login, no forests active | Chat shows import assistant mode. `list_forests` shows available forests. |
| **1 forest — backward compat** | Activate Hokkala only | All existing functionality works. Map, stands, charts, plan generation identical to current single-forest behavior. |
| **2 forests — combined view** | Activate Hokkala + Metsä 2 | Map shows stands from both forests with colored borders. Stand list shows Forest column. "show stand 7" disambiguates if needed. |
| **Stand collision** | Both forests have stand "7" | User says "show stand 7" → AI asks "Hokkala or Metsä 2?" → user picks → stand displayed |
| **Cross-forest plan** | Activate 2 forests, say "generate plan" | Plan generated for both. Operations table shows forest badges. Combined volume/income in summary. |
| **Clear one forest** | 2 forests active, "clear the plan for Hokkala" | Only Hokkala's operations deleted. Metsä 2 untouched. |
| **Clear all (guarded)** | 2 forests active, "clear all plans" | AI asks for confirmation. On confirm: both cleared. |
| **Navigate mid-chat** | Start chatting about Hokkala on dashboard → click to `/forest/[id]` | Chat history intact, stream uninterrupted, context updates to single-forest mode. |
| **Import via chat** | Dashboard mode, upload CSV in chat | AI shows preview, asks for property_id + name, imports forest → appears in selector. |
| **Growth region difference** | Import one forest from Etelä-Pohjanmaa (gm=1.08) and one from Lappi (gm=0.85), generate plans | Stands in each forest grow at their own rates. Plan summary shows per-forest growth assumptions. |

### 12.4 Test Data Requirements

- **Test forest A** (Hokkala): ~142 compartments, gm=1.08, Etelä-Pohjanmaa region. Already exists in Supabase.
- **Test forest B** (Metsä 2): ~67 compartments, gm=0.95 (test value — set in Supabase `forests.growth_multiplier`). Small forest for quick test runs.
- **Test forest C** (collision forest): Copy of Hokkala with different forest_id but same stand_ids. Used for stand disambiguation tests.
- **CSV test fixtures:** Finnish kuviotiedot format, simple-column format, and malformed CSV for error handling.

---

## 13. Success Criteria

1. ✅ User checks 2 forests on dashboard → map shows combined stands with forest badges
2. ✅ User says "generate a plan" in chat → plan generated across both forests
3. ✅ Charts show combined data; "by forest" breakdown available
4. ✅ User says "show stand 7" with 2 forests having stand 7 → AI asks which one
5. ✅ User uploads CSV in chat → AI shows preview → asks for property ID → imports
6. ✅ Chat conversation persists when navigating between dashboard and forest pages
7. ✅ Dashboard loads with no forests active → chat shows import assistant mode
8. ✅ `/forest/[id]` still works as focused single-forest view

---

## 14. Validation Checklist (Pre-Deploy)

### 14.1 Atomic Deploy Gate

- [ ] Migration `017_global_chat.sql` and all code changes in the **same PR**
- [ ] `getOrCreateSession(userId)` + `createSession(userId)` — no longer accept `forestId` param
- [ ] No code reads `session.forest_id` for context (Decision D1)
- [ ] All tool execution reads `activeForestIds` from store, not session row
- [ ] `ChatPanel` removed from `ForestView.tsx` / `PanelLayout.tsx`
- [ ] Chart tools (`create_chart`, etc.) use `ctx.userId`, not `ctx.forestId`
- [ ] `chart_tabs` queries use `(user_id, chart_id)` unique constraint, not `(forest_id, chart_id)`
- [ ] `plan_metadata` saved with `user_id`, `forest_id = NULL` for combined plans

### 14.2 Multi-Forest Correctness

- [ ] `generate_plan` produces operations with correct `forest_id` per stand
- [ ] Stands from different forests grow with their own `growth_multiplier`
- [ ] `generate_plan` saves ONE combined `plan_metadata` row for multi-forest runs
- [ ] `clear_plan` with `forest_id` param clears only that forest
- [ ] `clear_plan` without `forest_id` and no `confirm` with 2+ active returns `confirmation_required`
- [ ] `clear_plan` without `forest_id` with 1 active clears immediately
- [ ] `clear_plan` with `confirm: true` clears all active forests
- [ ] Stand resolver handles: unique match, ambiguous match, no match

### 14.3 Chart Compatibility

- [ ] All chart types work with `.in("forest_id", [a, b])` in underlying query
- [ ] "By forest" chart type renders correctly
- [ ] Chart recompute triggers on `activeForestIds` change
- [ ] Chart tabs persist across navigation (user-scoped, not forest-scoped)

### 14.4 Session & Navigation

- [ ] Chat persists across `/dashboard` ↔ `/forest/[id]` navigation
- [ ] SSE stream not interrupted by route change (layout-level component)
- [ ] System prompt updates when `activeForestIds` changes (mode switch)
- [ ] `/new` command creates fresh session with `forest_id = NULL`, chat restarts
- [ ] `activeForestIds` persist when navigating from `/forest/[id]` back to `/dashboard`

### 14.5 File Upload

- [ ] Uploaded CSVs cleaned up after successful import
- [ ] Orphaned uploads cleaned up after 24h TTL

---

## 15. Resolved Open Items

*All decisions made 2026-06-21 (v1.1 + v1.2):*

| # | Original Question | Resolution |
|---|---|---|
| 1 | Keep `/forest/[id]`? | **Keep** as focused view (Decision D2) |
| 2 | Stand visual distinction | **Dev class colors + forest border** (Decision D3) |
| 3 | Chart persistence | **User-scoped** — chart_tabs.forest_id nullable, chart_tabs.user_id added. Charts are global across all forests, recomputed on active set change. |
| 4 | Forest context source | **UI-state-driven** — `activeForestIds` in store (Decision D1) |
| 5 | `/new` command behavior | **User-scoped** — `createSession(userId)` creates fresh session row with `forest_id = NULL`. Old sessions stay but are superseded by newer `created_at`. |
| 6 | Chart tool scoping | **User-scoped** — all 6 chart tools (`create_chart`, `remove_chart`, `clear_charts`, `list_charts`, `update_chart`, `recreate_chart`) use `ctx.userId`. |
| 7 | `clear_plan` multi-forest safety | **Confirmation token** — when no `forest_id` + 2+ active, first call returns `confirmation_required`. Only second call with `confirm: true` proceeds. |
| 8 | `generate_plan` multi-forest design | **N independent loops** — one simulation per forest, per-forest `gm`, combined `plan_metadata` row with `forest_id = NULL`. |
| 9 | ActiveForestIds persistence | **Persist** — navigating `/forest/[id]` → `/dashboard` restores previous active set (store not cleared). |
| 10 | Hook return shapes | **Same as current** — `{ data, loading, error }` shape preserved for all hooks. |
| 11 | Migration filename | `017_global_chat.sql` (not `002_`). |
