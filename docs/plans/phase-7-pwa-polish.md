# Phase 7: PWA & Polish

**Status:** Planned
**Date:** 2026-06-03
**Author:** Systems Architect (via Hermes Agent)
**Depends on:** Phases 0–4, 4b, 4c, 5, 6 (all complete)

---

## 0. Gap Analysis: Architecture Plan vs Reality

The original architecture plan (v3.0) listed Phase 5 as:

| Task | Original Plan | Current State |
|------|--------------|---------------|
| T12 PWA + offline (4h) | PWA manifest, service worker, Dexie sync | ⚠️ Partial: SW exists (`sw.js`), manifest route exists, Dexie schema defined — but no icons, no offline sync, no install prompt |
| T13 Final testing (4h) | Playwright E2E, polish | Not started |

**What the subplans changed:**
- Phase 4 became far broader: 3-panel layout, 11 chart types, chart engine, cross-source queries
- Phase 5 became CSV import (different task, same number)
- Phase 6 became stand/operation lists with cross-component highlighting
- The original architecture's standalone routes were folded into the 3-panel + tabbed layout
- Dexie offline cache was never wired to Supabase sync hooks
- `standDimension` (old chart→map linking) was replaced by `_stand_ids` injection in Phase 6 — fully removed from codebase

---

## 1. PWA & Offline (Track A)

### A1. PWA Icons & Manifest

**Files:** Create `public/icons/icon-192x192.png`, `public/icons/icon-512x512.png`

- Generate a simple forest-themed SVG icon and rasterize at both sizes
- The manifest already references these paths — just create the files
- Add `apple-touch-icon` and `favicon.ico` if missing
- Verify manifest loads at `/manifest.webmanifest`
- Manifest `short_name`: "ForestChat" (English — system language). Manifest is static at build time; the `<title>` tag and landing page hero adapt to the selected UI language at runtime (see E5)

### A2. Offline-First Data (Dexie + Sync)

**The architecture already defines Dexie for offline.** Wire it up:

**Files to modify:** `src/lib/hooks/use-compartments.ts`, `use-operations.ts`, `use-forest.ts`

Pattern: hook fetches from Supabase, writes to Dexie, then read component reads from state. On next load, if Supabase is unreachable, fall back to Dexie.

```typescript
// Simplified sync pattern in each hook:
const { data, loading, error } = useSupabaseQuery(...)
useEffect(() => {
  if (data) db.compartments.bulkPut(data.map(toDexie))
}, [data])
```

**Out of scope for v1:** Full service-worker caching strategy, GPS geolocation, offline map tiles. The Dexie layer is a cache-first safety net — enough to re-render the last-known state when offline.

### A3. Install Prompt

**Create:** `src/components/pwa/InstallPrompt.tsx`

Use the `beforeinstallprompt` event to show a subtle banner at the bottom of the screen when the PWA is installable. Hide after dismissed. Show only on supported browsers (Chrome, Edge).

---

## 2. Landing Page & Auth Flow (Track B)

### B1. Landing Page Redesign

**File:** `src/app/page.tsx`

Current issues:
- Only one CTA ("Get Started" → register), no login link
- No visual personality — just text on gradient

**Changes:**
1. Add a **"Log in"** button next to "Get Started" (links to `/auth/login`)
2. Add a feature summary section: 🗺️ Map, 🤖 AI Chat, 📊 Charts, 🌲 Stands
3. Add a subtle hero visual (SVG forest silhouette or tree icon)
4. Show "Already have an account?" text under the buttons

### B2. Auth Page Cross-Linking

**Files:** `src/app/auth/register/page.tsx`, `src/app/auth/login/LoginForm.tsx`

- Register page: add "Already have an account? **Log in**" link at the bottom
- Login page: add "Don't have an account? **Sign up**" link at the bottom
- Both pages: add a "← Back" link to the landing page

### B3. Dark Mode Toggle

**Create:** `src/components/auth/ThemeToggle.tsx`

- Add a sun/moon icon button in the app header (next to UserMenu)
- Toggles `dark` class on `<html>` via localStorage persistence
- Respects `prefers-color-scheme` on first visit
- Also add to the landing page header

---

## 3. AI Tools Efficiency (Track C)

### C1. Multi-Stand Selection

**File:** `src/lib/chat/tools.ts` (tool definition), `src/lib/chat/tool-executor.ts` (handler), `src/lib/chat/sse.ts` (event type), `src/lib/chat/sse-client.ts` (callback type), `src/components/chat/ChatPanel.tsx` (handler)

**Current:** `select_stand` takes a single `stand_id: string`
**Change:** Accept `stand_ids: string[]` — handler also normalizes a single string (some models may send a scalar). Always emit as array.

```typescript
{
  name: "select_stand",
  parameters: {
    properties: {
      stand_ids: {
        type: "array",
        items: { type: "string" },
        description: "Array of stand IDs, e.g. ['5','12','89.1']. A single stand like ['7'] also works."
      },
    },
    required: ["stand_ids"],
  },
}
```

Handler normalizes: if the model sends a plain string (some OpenRouter models don't respect `type: "array"` strictly), wrap it: `const ids = Array.isArray(args.stand_ids) ? args.stand_ids : [String(args.stand_ids)]`. Emit SSE with `{ stand_ids: ids }`.

**SSE event change:** `sse.ts` — `stand_id?: string` → `stand_ids?: string[]` (keep `stand_id` as deprecated alias for backward compat).

**Client callback change:** `sse-client.ts` `SseCallbacks.onSelectStand` signature changes from `(standId: string) => void` to `(standIds: string[]) => void`. `ChatPanel.tsx` handler normalizes single string to array and calls `setHighlightedStands(standIds)`.

**Zoom behavior:** When multiple stands are selected, StandLayer's existing `useEffect` already handles `highlightedStandIds.length > 1` → `fitBounds` to all highlighted stands. No additional map changes needed.

### C2. Batch Add Operations

**File:** `src/lib/chat/tools.ts`, `src/lib/ai/edit-tools.ts`

**Current:** `add_operation` takes one `{stand_id, year, type, removal_pct}`
**Change:** Accept `operations: Array<{stand_id, year, type, removal_pct}>` alongside the single-operation signature. Backward compatible.

### C3. Smarter Remove Operation

**File:** `src/lib/chat/tools.ts`, `src/lib/ai/edit-tools.ts`

**Current:** `remove_operation` takes `{stand_id, year}`
**Change:** `year` optional (remove all for stand), accept `stand_ids: string[]`, optional `type` filter.

### C4. `query_operations` Response Efficiency

**File:** `src/lib/ai/query-tools.ts`

When >20 rows, return summary only ("Found 45 operations across 2028-2035"). Full results go to UI via `show_in_ui` SSE. Add `format: "summary" | "full"` parameter.

### C5. `search_stands` Response Efficiency

**File:** `src/lib/ai/query-tools.ts`

Same summary pattern as C4. Above 20 results → summary only.

### C6. System Prompt Compression

**File:** `src/lib/chat/system-prompt.ts`

**⚠️ The chart templates (lines 84–156, ~70 lines) must NOT be removed.** They are copy-paste patterns the AI relies on to compose `query_config` reliably. Without them, hallucination rate on nested JSON structures spikes. The `detectChartIntent` fallback in `route.ts` only activates when the AI produces zero output — it doesn't fix malformed configs.

**Safe to trim (prose only, not templates):**

| Section | Current lines | After | Saving |
|---------|--------------|-------|--------|
| `COMPUTED FIELDS` description | 12 | 4 (field:formula only, drop multiplier explanation) | 8 |
| `SOURCE SCHEMAS` | 25 | 8 (compact one-liners per table) | 17 |
| `CONVENTIONS` | 5 | Merge into CHART RULES | 5 |
| `ROW-LEVEL OPERATORS` | 7 | 2 | 5 |
| `OPERATION TYPE GROUPINGS` | 3 | 1 | 2 |
| `tools.ts` create_chart description | 60+ | 30 (remove duplicate template examples, keep schema) | 30 |
| **Total** | **~110 lines over both files** | **~43 lines** | **~67 lines (~25%)** |

All 16 copy-paste templates stay intact. The AI still gets exact patterns for every chart type.

**Also:** Inject language parameter so the AI responds in the selected language (see E4).

### C7. Chart Editing Tools

**Problem:** When the AI creates a chart with wrong settings, the user must repeat the full request. There's no way to fix a chart in-place.

**Files:** `src/lib/chat/tools.ts`, `src/lib/chat/tool-executor.ts`

**New tool: `update_chart`** — change rendering properties only (no data recompute)
```typescript
{
  name: "update_chart",
  description: "Modify an existing chart's appearance. Use when the user asks to change chart type (bar→pie), axis keys, title, or colors. Does NOT recompute data — fast. To change the underlying data query, use recreate_chart instead.",
  parameters: {
    chart_id: { type: "string", required: true },
    title: { type: "string" },
    type: { type: "string", enum: ["bar","pie","line","area","stacked_bar","scatter","radar","donut","horizontal_bar","composed","waterfall"] },
    x_key: { type: "string" },
    y_key: { type: "string" },
    y_key2: { type: "string" },
    name_key: { type: "string" },
    color_key: { type: "string" },
    waterfall_base: { type: "number" },
  }
}
```
Handler: fetch chart_tab from DB, merge the provided fields, upsert, emit `create_chart` SSE (same event — the client upserts tabs by id).

**Note:** `standDimension` is NOT included — it was replaced by `_stand_ids` injection in Phase 6 and is no longer in the codebase or `ChartTab` interface. All charts automatically support cross-highlighting via `_stand_ids`.

**New tool: `recreate_chart`** — recompute an existing chart with a new/modified query_config
```typescript
{
  name: "recreate_chart",
  description: "Recompute an existing chart with a new or modified query_config. Use when the user asks to change the underlying data (e.g., 'add costs to the income chart', 'show only thinnings'). The new query_config replaces the old one and data is recomputed.",
  parameters: {
    chart_id: { type: "string", required: true },
    query_config: { type: "object", required: true },
    title: { type: "string" },
    type: { type: "string", enum: ["bar","pie","line","area","stacked_bar","scatter","radar","donut","horizontal_bar","composed","waterfall"] },
    x_key: { type: "string" },
    y_key: { type: "string" },
    y_key2: { type: "string" },
    name_key: { type: "string" },
    color_key: { type: "string" },
    waterfall_base: { type: "number" },
  }
}
```
Handler: validate new query_config, recompute via chart engine, update chart_tabs row, emit `create_chart` SSE.

### C8. List Charts Tool

**Problem:** The AI has no way to inspect existing charts. It can't know chart_ids, current types, or query_configs from earlier conversation turns. This blocks tools like `update_chart`, `recreate_chart`, and `remove_chart` when the user references a chart by name rather than explicit id.

**File:** `src/lib/chat/tools.ts`, `src/lib/chat/tool-executor.ts`

**New tool: `list_charts`**
```typescript
{
  name: "list_charts",
  description: `List all chart tabs currently in the visualization panel. Returns chart_id, title, type, and key rendering properties for each chart. Also returns the query_config (if any) — the declarative data source definition. Use this BEFORE calling update_chart, recreate_chart, or remove_chart when the user refers to a chart by its title or description rather than an explicit chart_id.

The data field (computed cache of chart values) is NOT returned — it's too large. If you need to inspect chart data values, look at the query_config instead.`,
  parameters: {
    type: "object",
    properties: {},
  },
}
```

**Handler:**
```typescript
list_charts: async (_args, ctx) => {
  const { data } = await ctx.supabase
    .from("chart_tabs")
    .select("chart_id, title, type, x_key, y_key, y_key2, name_key, color_key, query_config")
    .eq("forest_id", ctx.forestId)
    .order("created_at", { ascending: true });

  if (!data || data.length === 0) {
    return { success: true, result: "No charts found." };
  }

  const lines = data.map(c =>
    `- ${c.chart_id}: "${c.title}" (${c.type})` +
    (c.x_key ? ` x=${c.x_key}` : "") +
    (c.y_key ? ` y=${c.y_key}` : "") +
    (c.y_key2 ? ` y2=${c.y_key2}` : "") +
    (c.name_key ? ` name=${c.name_key}` : "") +
    (c.color_key ? ` color=${c.color_key}` : "") +
    (c.query_config ? `\n    query_config: ${JSON.stringify(c.query_config)}` : "")
  );

  return {
    success: true,
    result: `${data.length} chart(s):\n${lines.join("\n")}`,
  };
},
```

**Enables these flows:**
- User: "Change the species chart to a donut" → AI: `list_charts` → finds `chart-species-area` → `update_chart(chart_id: "chart-species-area", type: "donut")`
- User: "Add costs to the yearly income chart" → AI: `list_charts` → sees query_config with `income_eur` → `recreate_chart(chart_id: "chart-yearly-income", query_config: {..., values: [..., {field:"cost_eur", as:"cost", fn:"sum", multiply:-1}]})`
- User: "Remove all charts except income" → AI: `list_charts` → `remove_chart` for each non-income chart

---

## 4. UX Polish (Track D)

### D1. Chat Input Enhancements

**File:** `src/components/chat/ChatInput.tsx`

- Add Ctrl+Enter / Cmd+Enter keyboard shortcut to send
- Add rotating placeholder suggestions: "Show me stands ready for harvest", "Create a yearly income chart", etc.
- The existing `/new` slash command (accessible from the `📋` commands menu) is the only way to start a new conversation — no dedicated "New chat" button to keep the interface clean

### D2. Loading & Empty States

**Files:** various

- ForestView: skeleton while compartments load (instead of blank map)
- ChartCard: "No data" state when `cleanData` returns empty (instead of blank area)
- The ChatPanel already has a welcome message on first load — no additional placeholder needed

### D3. Dashboard Polish

**File:** `src/app/(app)/dashboard/page.tsx`

- Add "Getting Started" card when user has no forests
- Show forest count, total area, total volume in header stats

### D4. Error Boundaries

**Create:** `src/components/shared/ErrorBoundary.tsx`

Wrap the main app. Currently unhandled render errors white-screen.

---

## 5. Multi-Language Support (Track E) 🆕

**Support two UI languages:** English (en) and Finnish (fi).

**Principle:** System values (DB columns, API parameters, tool args) are always in English. English is the system language and coding language. All translation happens in the UI layer via lookup maps. The AI responds in the selected UI language.

### E1. Language Infrastructure

**Create:** `src/lib/i18n.ts` — Central translation module

```typescript
export type Language = "en" | "fi";

// ── Zustand slice ──
export interface I18nSlice {
  language: Language;
  setLanguage: (lang: Language) => void;
}
// Persist to localStorage. On change, trigger full page reload (F5).
```

**Create:** `src/lib/store/i18n-slice.ts`
**Modify:** `src/lib/store/index.ts` — add `I18nSlice`

**Create:** `src/components/shared/LanguageRoot.tsx` — `"use client"` wrapper component that reads the language from Zustand (initialized from localStorage) and sets `document.documentElement.lang`. Included in `RootLayout`:

```tsx
// src/components/shared/LanguageRoot.tsx
"use client";
import { useEffect } from "react";
import { useForestStore } from "@/lib/store";

export default function LanguageRoot({ children }: { children: React.ReactNode }) {
  const language = useForestStore(s => s.language);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return <>{children}</>;
}
```

```tsx
// src/app/layout.tsx
import LanguageRoot from "@/components/shared/LanguageRoot";
// ...
<body><LanguageRoot>{children}</LanguageRoot></body>
```

**Create:** `src/components/shared/LanguageToggle.tsx` — 🇬🇧/🇫🇮 toggle button in the app header. Click → setLanguage → page reload.

### E2. System Value → Display Value Mappings

**File:** `src/lib/i18n.ts` — All display mappings for both languages

These replace the current ad-hoc `capitalize()`, `formatDisplayDevClass()`, and `displayOperationType()` scattered across components. One shared module, one API.

#### Operation Types

| System value (English) | English display | Finnish display |
|-------------|---------|---------|
| `clear_cut` | Clearcut | Avohakkuu |
| `thinning` | Thinning | Harvennus |
| `first_thinning` | First Thinning | Ensiharvennus |
| `selection_cutting` | Selection Cutting | Poimintahakkuu |
| `tending` | Tending | Taimikonhoito |
| `early_tending` | Early Tending | Taimikon varhaishoito |
| `pre_clearance` | Pre-clearance | Ennakkoraivaus |
| `site_prep` | Mounding | Laikkumätästys |
| `ditch_mounding` | Ditch Mounding | Ojitusmätästys |
| `scalping` | Scalping | Laikutus |
| `spruce_planting` | Spruce Planting | Kuusen istutus |
| `pine_planting` | Pine Planting | Männyn istutus |
| `planting` | Planting | Istutus |

#### Development Classes

| System value | English display | Finnish display |
|-------------|---------|---------|
| `regeneration_ready` | Regeneration Ready | Uudistuskypsä |
| `mature_thinning` | Mature Thinning | Varttunut kasvatusmetsikkö |
| `young_thinning` | Young Thinning | Nuori kasvatusmetsikkö |
| `open_area` | Open Area | Aukea |
| `seed_tree` | Seed Tree | Siemenpuusto |
| `seedling_large` | Large Seedling | Taimikko yli 1,3 m |
| `seedling_small` | Small Seedling | Taimikko alle 1,3 m |
| `seedling` | Seedling | Taimikko |
| `shelterwood` | Shelterwood | Suojuspuusto |
| `uneven_aged` | Uneven-Aged | Eri-ikäisrakenteinen |

#### Site Types

| System value | English display | Finnish display |
|-------------|---------|---------|
| `herb-rich` | Herb-Rich | Lehto |
| `herb-rich heath` | Herb-Rich Heath | Lehtomainen kangas |
| `mesic` | Mesic | Tuore kangas |
| `sub-xeric` | Sub-Xeric | Kuivahko kangas |
| `xeric` | Xeric | Kuiva kangas |
| `barren` | Barren | Karukkokangas |

#### Species

| System value | English display | Finnish display |
|-------------|---------|---------|
| `pine` | Pine | Mänty |
| `spruce` | Spruce | Kuusi |
| `silver_birch` | Silver Birch | Rauduskoivu |
| `downy_birch` | Downy Birch | Hieskoivu |
| `birch` | Birch | Koivu |
| `larch` | Larch | Lehtikuusi |
| `grey_alder` | Grey Alder | Harmaaleppä |
| `aspen` | Aspen | Haapa |
| `rowan` | Rowan | Pihlaja |
| `broadleaf` | Broadleaf | Lehtipuu |

#### Drainage Status

| System value | English display | Finnish display |
|-------------|---------|---------|
| `drained` | Drained | Ojitettu |
| `undrained` | Undrained | Ojittamaton |
| `peatland_forest` | Peatland Forest | Turvekangas |
| `natural_state` | Natural State | Luonnontilainen |

**API:**

```typescript
// src/lib/i18n.ts
export function displayOp(sysValue: string, lang: Language): string
export function displayDevClass(sysValue: string, lang: Language): string
export function displaySiteType(sysValue: string, lang: Language): string
export function displaySpecies(sysValue: string, lang: Language): string
export function displayDrainage(sysValue: string, lang: Language): string

// Fallback: if no mapping exists, return sysValue as-is (for unknown values)
```

### E3. Places That Need Translation (System Value Leaks)

All of these currently show raw English system values and must use the E2 lookup functions:

| Location | File | Raw values shown |
|----------|------|-----------------|
| **Map popup** | `StandLayer.tsx` lines 115,116,122,129,145 | `development_class`, `site_type`, species names, `op.type` |
| **StandPopup** | `StandPopup.tsx` lines 45,48 | `development_class`, `site_type` |
| **StandList table** | `StandList.tsx` lines 375,395,415,590,594,618,637 | species, dev_class, site_type, operation type |
| **StandList filters** | `StandList.tsx` DEV_CLASS_OPTIONS, SITE_TYPE_OPTIONS, SPECIES_OPTIONS | Dropdown options show system values |
| **OperationList table** | `OperationList.tsx` lines 402,422,467,473,525,527,544 | operation type, species, dev_class |
| **OperationList filters** | `OperationList.tsx` OP_TYPE_OPTIONS, SPECIES_OPTIONS | Dropdown options show system values |
| **StandLegend** | `StandLegend.tsx` | Dev class labels in legend |
| **ChartCard** | `ChartCard.tsx` line 279 | Already uses `displayOperationType` — needs language-aware version |
| **Chart tooltips** | Via Recharts | Operation type labels in legends/tooltips |

**Pattern:** Each component imports `useForestStore` to get the language, then calls `displayOp(value, lang)`, `displayDevClass(value, lang)`, etc.

**Filter dropdowns** (StandList, OperationList) need special handling: options show display values but the filter logic uses system values. Use `data-system-value` attributes:

```tsx
<option value={sysValue} data-system-value={sysValue}>
  {displayDevClass(sysValue, language)}
</option>
```

On change, read `event.target.selectedOptions[0].dataset.systemValue` to get the system value for filtering. The `<select>` `value` also uses system values — the display text is purely visual.

### E4. AI Language Injection

**File:** `src/lib/chat/system-prompt.ts` → `buildSystemPrompt()` accepts `language: Language` parameter

Add a line to the system prompt based on language:
- `en`: `Respond in English.`
- `fi`: `Vastaa suomeksi. Kaikki työkalukutsut ja parametrit pysyvät englanniksi (järjestelmän sisäinen kieli), mutta käyttäjälle näytettävä teksti on suomeksi.`

**Concrete language pass mechanism:** The chat API request body adds a `language` field:
```typescript
// sse-client.ts streamChat signature:
async function streamChat(
  message: string,
  forestId: string,
  sessionId: string | null,
  language: Language,      // NEW parameter
  callbacks: SseCallbacks
): Promise<void>

// ChatPanel.tsx reads language from Zustand and passes it:
const language = useForestStore(s => s.language);
await streamChat(message, forestId, sessionId, language, callbacks);

// route.ts reads it from the request body:
const { message, forest_id, session_id, language } = await request.json();
const systemPrompt = buildSystemPrompt(forest, compartments, language ?? "en");
```

The AI tools and parameters stay in English (system language). Only the AI response text adapts.

### E5. App Name

- **System name / manifest / code:** "ForestChat" (English — system and coding language)
- **UI display when language=fi:** "MetsäChat" in `<title>`, landing page hero, and header
- **UI display when language=en:** "ForestChat" in `<title>`, landing page hero, and header
- URL/routes stay `/` and `/dashboard` (no i18n routing)
- The manifest `short_name` is "ForestChat" (static, English)
- The `<meta>` description shows in the selected UI language

### E6. Chat Commands — Example Prompts

**File:** `src/components/chat/CommandsMenu.tsx`

The commands menu grows from 2 hardcoded commands to a grouped list of example prompts + the existing `/new` and `/model` commands. The tip texts for `/new` and `/model` adapt to the selected UI language.

**English prompts:**

```
📋 Chat Commands

  /new    Start a new conversation
  /model  Change AI model  (Current: deepseek-v4-pro)

── Plan Editing ──
  Generate a 20-year forest management plan
  Move stand 7 clearcut to 2030
  Remove all operations from stand 12
  Show me all clearcuts from 2030-2035
  Add thinning to all mature pine stands

── Chart Creation ──
  Create a yearly income bar chart
  Show species distribution as a pie chart
  Chart yearly harvest volume as stacked bars
  Show cumulative growth and removal

── Miscellaneous ──
  Check harvest sustainability
  Validate the current plan
  Show stand 7 on the map
  Summarize the plan
```

**Finnish prompts:**

```
📋 Komennot

  /new    Aloita uusi keskustelu
  /model  Vaihda tekoälymalli  (Nykyinen: deepseek-v4-pro)

── Suunnitelman muokkaus ──
  Laadi 20 vuoden metsäsuunnitelma
  Siirrä kuvion 7 avohakkuu vuoteen 2030
  Poista kaikki toimenpiteet kuviosta 12
  Näytä kaikki avohakkuut vuosilta 2030-2035
  Lisää harvennus kaikkiin varttuneisiin mäntykohteisiin

── Kaavioiden luonti ──
  Luo vuosittaiset tulot pylväskaaviona
  Näytä puulajijakauma piirakkakaaviona
  Vuosittaiset hakkuumäärät pinottuna pylväskaaviona
  Näytä kumulatiivinen kasvu ja poistuma

── Muut ──
  Tarkista hakkuiden kestävyys
  Tarkista suunnitelma
  Näytä kuvio 7 kartalla
  Yhteenveto suunnitelmasta
```

**Implementation:**
- The prompts are defined in `src/lib/i18n.ts` alongside other translations
- Each prompt is a clickable button that runs `onInsertCommand(text)`
- Clicking a prompt inserts it into the chat input (does NOT auto-send)
- `/new` calls `onInsertCommand("/new ")` — user still needs to type a message after
- `/model` calls `onInsertCommand("/model ")` — user types model name after

---

## 6. Task Breakdown

```
Track A: PWA & Offline
  A1 (1h)    PWA icons + manifest verification
  A2 (2h)    Wire Dexie sync into data hooks
  A3 (0.5h)  Install prompt component

Track B: Landing & Auth
  B1 (1h)    Landing page redesign (login button, features, hero)
  B2 (0.5h)  Auth page cross-linking
  B3 (0.5h)  Dark mode toggle

Track C: AI Tools
  C1 (1h)    Multi-stand selection (select_stand → stand_ids[])
  C2 (1.5h)  Batch add_operation (operations[])
  C3 (1h)    Smarter remove_operation (year-optional, multi-stand, type filter)
  C4 (0.5h)  query_operations response efficiency (summary mode)
  C5 (0.5h)  search_stands response efficiency (summary mode)
  C6 (1h)    System prompt compression (~25%, templates preserved)
  C7 (1.5h)  Chart editing tools (update_chart + recreate_chart)
  C8 (0.5h)  List charts tool (list_charts)
  C9 (0.5h)  Tests for C7 + C8 (chart-tools.test.ts)

Track D: UX Polish
  D1 (0.5h)  Chat input enhancements (shortcuts, rotating placeholder)
  D2 (0.5h)  Loading & empty states (skeleton, ChartCard no-data)
  D3 (0.5h)  Dashboard polish
  D4 (0.5h)  Error boundary

Track E: Multi-Language
  E1 (1h)    Language infrastructure (i18n slice, store, toggle)
  E2 (1.5h)  Display value mappings + i18n.ts module
  E3 (2h)    Fix ALL system value leaks across 8+ components
  E4 (1h)    AI language injection (system prompt + request body + ChatPanel pass)
  E5 (0.5h)  App name + metadata i18n
  E6 (1h)    Chat commands — example prompts (EN + FI)
```

**Total: ~22.5h**

---

## 7. Dependency Graph

```
A1, A2 ── independent
A3 ── depends on A1

B1, B2, B3 ── independent

C1-C5 ── independent (different tools/params)
C6 ── after E4 (needs language parameter in buildSystemPrompt)
C7 ── independent (new tools, no shared state)
C8 ── independent (pure query tool)
C9 ── after C7, C8 (tests for new tools)

D1-D4 ── independent

E1 ── independent (store + toggle)
E2 ── independent (pure data)
E3 ── depends on E1 + E2 (needs store + mappings)
E4 ── depends on E1 (needs language from store; modifies ChatPanel + sse-client)
E5 ── depends on E1 (needs language)
E6 ── depends on E2 (needs translated prompt texts)
```

---

## 8. Implementation Order

```
Wave 1 (parallel, ~6h):   A1, A2, B1, B2, B3, D1, D4, E1, E2, C7, C8
Wave 2 (parallel, ~5h):   A3, C1, C2, C3, C4, C5, D2, D3, E4, E5, C9
Wave 3 (sequential, ~3h): E3 (fix all system value leaks — must come after E1+E2)
Wave 4 (cleanup, ~2h):    C6, E6 (system prompt + commands — after everything)
```

---

## 9. Out of Scope

- GPS geolocation ("Which stand am I in?")
- Offline map tiles
- Playwright E2E tests
- Plan sharing UI
- User settings page
- i18n URL routing (`/fi/dashboard` etc.) — language is a client-side toggle only
- Translating the AI's tool parameter values (they stay in English — system language)
- Excel/CSV export
- `standDimension` field (already removed from codebase in Phase 6; `_stand_ids` replaced it)
