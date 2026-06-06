# Phase 7b — Generic Forest Management Plan Generation

**Status:** Planned
**Date:** 2026-06-06
**Author:** Systems Architect (via Hermes Agent)
**Depends on:** Phases 0–7 (all complete)

---

## Problem Statement

The current plan generation is heavily hardcoded for a single property (989-405-0001-0405). `classify.ts` has stand-specific special cases (K180 selection cutting, K128 too-young exception, K71/K72 skip, K5 manual delay), and `schedule.ts` has hand-crafted split patterns for K7 (3 parts) and K184 (2 parts). Prices are static from UPM week 19/2026, Central Finland only. There's no notion of owner goals — the algorithm always does the same thing.

This phase makes plan generation generic, goal-driven, and price-aware.

---

## Goals (User-Selectable)

The `generate_plan` tool gains a required `goal` parameter. If omitted, the AI MUST ask the user which goal they want before creating the plan.

### Goal 1: `maximum_growth_aggressive`
Maximize total volume growth across the property over the plan period.
- **Rule:** All regeneration-ready stands get clearcut + replanted as soon as possible — front-loaded into the earliest years with a 3× annual growth volume cap (effectively no practical limit). Old slow-growing stock is replaced by fast-growing young trees.
- **Rule:** Thinnings happen on schedule (no delays) to maintain optimal density for growth.
- **Rule:** Tending operations scheduled as early as biologically feasible.
- **Success metric:** Highest total cumulative volume grown (net new m³ produced across all stands during the plan period). This rewards replacing slow-growing old stock with fast-growing young trees.

### Goal 2: `maximum_growth_balanced`
Produce steady, predictable income year-over-year. Achieved by capping annual harvest volume — pursue regeneration aggressively (like maximum_growth_aggressive), but never remove more than 125% of the forest's annual growth in a single year.
- **Rule:** Annual harvest removal ≤ 125% of annual growth (m³). This is the binding constraint — if a year's scheduled clearcuts would exceed this cap, remaining harvests spill into the next available year.
- **Rule:** Front-load regeneration-ready stands into the earliest available years (same urgency as maximum_growth_aggressive), but the volume cap naturally spaces them out.
- **Rule:** If harvest volume already exceeds annual growth (unsustainable baseline), prioritize **thinnings** over clearcuts — thinnings produce income per m³ with less volume shock, keeping within the cap.
- **Rule:** Delay regeneration costs by 1 year (replant next year) to avoid stacking income and cost in the same year.
- **Success metric:** Lowest standard deviation of annual harvest volume (m³).

### Goal 3: `carbon_storage`
Maximize carbon sequestration for climate benefits.
- **Rule:** Avoid clearcuts entirely unless the stand is past optimal max age + 15 years (significantly over-mature).
- **Rule:** Favor continuous-cover methods: selection cutting over clearcut where appropriate.
- **Rule:** Extend rotation ages by +15 years above standard recommendations.
- **Rule:** Favor spruce over pine on suitable sites (higher carbon density).
- **Rule:** Minimal soil disturbance — avoid ditch mounding on peatland.
- **Success metric:** Highest total standing volume at period end (proxy for carbon stock).

### Goal 4: `biodiversity`
Maintain and enhance ecological values.
- **Rule:** Never clearcut stands adjacent to water bodies or on steep slopes (>15% grade, flagged in stand metadata). **Note:** This requires water adjacency or slope data in the compartment attributes. If the data is unavailable, this rule is skipped — stands are treated normally.
- **Rule:** Mixed-species regeneration instead of monoculture planting.
- **Rule:** Retention trees: leave 5-10 standing trees per hectare on all clearcuts.
- **Rule:** Longer rotations (+10 years).
- **Rule:** Favor natural regeneration over planting where seed-tree stands exist.
- **Success metric:** Shannon diversity index of stand ages + species across the property.

### Goal 5: `balanced`
Equal weighting of growth, income, and ecological sustainability. This is the standard goal matching Finnish silvicultural best practices — not a fallback. The AI must still present it as one option among five and let the user choose.
- **Rule:** Apply Finnish silvicultural best practices (current behavior, minus hardcoded exceptions).
- **Rule:** Harvest volume ≤ annual growth (sustainability constraint).
- **Rule:** Standard rotation ages from `config.ts`.
- **Success metric:** Composite score across all dimensions.

---

## Architecture Changes

### 1. Remove All Property-Specific Hardcoding

| File | Location | What to remove |
|------|----------|---------------|
| `classify.ts` | Lines 196–261 | K180, K128, K71/K72, K5 special cases |
| `schedule.ts` | Lines 74–196 | K7 3-part split, K184 2-part split, K180 hand-placement, K5 manual year |

Replace with **generic algorithm** — classification driven purely by `development_class`, species, age, and basal area, with no stand-ID-specific branching.

**Stand splitting is NOT automatic.** Splitting is a scheduling tactic available to the strategy engine, applied only when a goal constraint demands it. The most common case is the `maximum_growth_balanced` goal: if scheduling a full clearcut on a large stand would push that year's income far above the target (e.g., >150% of the yearly average), the scheduler may choose to split the harvest across 2–3 years to smooth the income curve.

Split constraints when used:
- Minimum sub-part area: **1.5 ha**
- Valid fractions: **1/2, 1/3, 1/4** of total stand area
- Choose the smallest number of parts that brings each year's income under the threshold
- Parts are spread interleaved across available years
- Do NOT split if there's no clear constraint being violated — a large stand harvested in one year is fine unless a goal rule says otherwise

### 1b. Goal-Aware Classification

**File:** `src/lib/ai/classify.ts` — accept `goal` parameter

Classification (determining *what* operations to create) must also be goal-aware, not just scheduling (*when* to place them). Currently `classifyAndValueStands()` produces the same set of `PlannedOperation[]` regardless of goal — but different goals need different classification thresholds:

| Classification rule | `maximum_growth_aggressive` | `maximum_growth_balanced` | `carbon_storage` | `biodiversity` | `balanced` |
|---|---|---|---|---|---|
| Clearcut eligibility age | `age ≥ optMin` (standard) | `age ≥ optMin` | `age ≥ optMax + 15` | `age ≥ optMax + 10` | `age ≥ optMin` |
| Thinning BA threshold | Standard | Standard | Standard | Standard | Standard |
| Selection cutting | No preference | No preference | **Yes** — prefer over clearcut | **Yes** — prefer over clearcut | No preference |
| Waterside/slope exclusions | None | None | None | **Skip** these stands entirely | None |
| Peatland ditch mounding | Allowed | Allowed | **Use scalping** instead of ditch_mounding | **Use scalping** instead of ditch_mounding | Allowed |

**Effect on `classify.ts` flow:**
1. Accept `goal: PlanGoal` parameter
2. `getOptimalAge()` for clearcut eligibility uses goal-adjusted thresholds
3. For `carbon_storage`/`biodiversity`: when a stand is over-age, prefer `selection_cutting` (50% removal) over `clear_cut` (100%)
4. For `biodiversity`: check stand metadata for waterside flag or slope grade; skip stands that match
5. For `carbon_storage`: on peatland, skip `ditch_mounding` and use `scalping` instead

### 2. New Tool Parameter: `goal`

**File:** `src/lib/chat/tools.ts` — `generate_plan` definition

```typescript
{
  name: "generate_plan",
  description: `Generate a forest management plan for the property.
Choose a goal that matches the owner's objectives:

- maximum_growth_aggressive: Maximize total volume. All regenerations done immediately. Fast rotation.
- maximum_growth_balanced: Capped growth. Front-load regeneration like aggressive but with 125% annual growth volume limit. Prioritizes thinnings.
- carbon_storage: Maximize standing carbon stock. Avoid clearcuts. Extended rotations.
- biodiversity: Ecological values. Mixed species. Retention trees. No waterside clearcuts.
- balanced: Equal weight on all objectives. Standard Finnish best practices.`,
  parameters: {
    type: "object",
    properties: {
      period_years: { type: "number", description: "Duration in years (default 20)" },
      start_year: { type: "number", description: "Start year (default current year)" },
      goal: {
        type: "string",
        enum: ["maximum_growth_aggressive", "maximum_growth_balanced", "carbon_storage", "biodiversity", "balanced"],
        description: "Owner's objective. REQUIRED. AI MUST ask the user before generating if not specified."
      },
    },
    required: ["goal"],
  },
}
```

### 3. System Prompt: Goal Prompting Rule

**File:** `src/lib/chat/system-prompt.ts`

Add to KEY RULES:

```
2a. When the user asks for a new plan but hasn't specified a goal, ASK them to choose before calling generate_plan. 
Present the goals clearly: maximum_growth_aggressive, maximum_growth_balanced, carbon_storage, biodiversity, balanced.
Do NOT pick a default — the user must choose.
```

### 4. Year-by-Year Scheduling Engine

**Files:** `src/lib/ai/schedule.ts` — complete rewrite; uses `src/lib/ai/forest-state.ts`

The scheduler becomes an iterative, growth-aware engine. Instead of placing all operations at once based on static urgency, it walks year-by-year through the plan period, simulating stand growth between each step.

#### Core Loop

```
state ← initial compartments (year 0, today's data from DB)
pool ← all classified operations (from classify.ts, goal-aware per T11)
carryover ← []  // ops from previous year that didn't fit volume cap

for year = startYear to endYear:
    1. DEDUCE which pool operations are due this year based on current simulated state:
       - Clearcut due? → simulated age ≥ goal-adjusted optMin
       - Thinning due? → simulated BA ≥ THINNING_BA threshold
       - Tending due? → simulated age within tending window
    2. MERGE due ops + carryover → this year's candidate pool.
       Each operation tracks `dueYear` — the first year it became due.
    3. SELECT: strategy picks operations from candidate pool, respecting this year's volume cap
       (volumeCap × annualGrowthM3). Candidates are priority-ordered before selection (see below).
    4. APPLY selected ops to mutable stand state:
       - Harvest: reduce volume, reduce BA (proportionally for thinning), reset age on clearcut
       - Regeneration: mark stand cleared = false (growth resumes next year)
    5. SIMULATE one year of growth on ALL stands:
       - growthM3 = getGrowthRate(site, soil, species, age, BA, devClass) × areaHa
       - volume += growthM3; age += 1
    6. CARRYOVER: candidate pool minus selected ops → pushed to next year's carryover
    7. CHAIN regeneration: for each harvest that fired this year, schedule regeneration ops
       (site_prep, planting, tending) delayed by regenDelayYears() per goal
```

#### Simulation Engine

The existing `estimateForestState()` in `forest-state.ts` already handles year-by-year growth + operation application. It:
- Computes `getGrowthRate()` per stand per year (VMI13 base rate × species × age × density multipliers)
- Applies harvest removal (100% for clearcut, proportional for thinning/selection_cutting, reduces BA)
- Handles regeneration (resets age/volume/BA to 0, un-clears the stand so growth resumes next year)
- Returns `ForestStateTimeline` — per-stand, per-year snapshots (volumeM3, ageYears, growthM3, harvestM3, operationType)

The scheduler wraps this in its own year loop to make strategic decisions between simulation steps. It uses the same `getGrowthRate()` and mutates state in-place rather than calling `estimateForestState()` with a pre-baked operation list — this avoids the circular dependency (need ops to simulate, need sim to decide ops).

#### Candidate Priority Ordering

Before `selectOperations()` chooses which candidates to execute this year, the candidate pool is sorted by a universal priority rule that applies across all goals:

1. **Primary sort — waiting time (dueYear):** Operations that became due earlier get higher priority. An operation that was due in year 1 but couldn't fit due to volume cap has waited 3 years by year 4 and must be prioritized over an operation that just became due in year 4. This prevents starvation of operations on larger stands that keep getting pushed out.

2. **Secondary sort — goal-specific metric (tiebreaker for same dueYear):** When multiple operations became due in the same year (including all initially classified operations at year 0), the goal-specific metric decides order:

| Goal | Tiebreaker metric | Rationale |
|------|-------------------|-----------|
| `maximum_growth_aggressive` | Volume descending | Biggest harvests first — maximize throughput |
| `maximum_growth_balanced` | Thinnings first, then volume descending | Thinnings use less cap room, then big clearcuts |
| `carbon_storage` | Selection cuttings first, then age descending (oldest first) | Preserve stock; harvest oldest if needed |
| `biodiversity` | Mixed species priority, then age descending | Non-monoculture stands first; oldest next |
| `balanced` | Age descending (most overdue first) | Standard silvicultural practice |

3. **Tertiary sort — stand wishes (`_priority_boost`):** Stands with `accelerate_harvest` wish get a ×2.0 multiplier applied to their sort position (after step 2), pushing them ahead of same-dueYear peers. Stands with `delay_harvest` (year cap) are excluded from candidates until the cap year passes — they never appear in the pool before then.

**Selection within priority order:** After sorting, the strategy's `selectOperations()` walks the sorted list and accepts operations until the volume cap is exhausted. This means the priority ordering is the *input* to `selectOperations()`, and the strategy's role is to apply any additional filtering or quota rules (e.g., `maximum_growth_balanced` may still refuse a clearcut that fits the cap if thinnings haven't been exhausted).

#### SchedulingStrategy Interface

```typescript
interface SchedulingStrategy {
  name: string;
  /** Per-year harvest volume cap, as a multiplier of the property's total annual growth (m³).
   *  The scheduler multiplies this by the total annual growth to get maxRemovalM3PerYear. */
  volumeCapMultiplier(): number;
  /** Select operations to execute this year from the candidate pool.
   *  Candidates arrive PRE-SORTED by priority (dueYear → goal metric → wishes).
   *  The strategy walks the sorted list and accepts ops until volume cap is exhausted,
   *  applying any additional filtering or quota rules (e.g., thinnings-first quota).
   *  @param year           Current plan year
   *  @param standStates    Current simulated state per stand (age, volume, BA, development class)
   *  @param candidates     Operations due this year + carryover from prior years (pre-sorted)
   *  @param volumeCapM3    Maximum m³ of harvest removal allowed this year
   *  @param annualGrowthM3 Property's total annual growth (reference for relative sizing)
   *  @returns              { scheduled: ops to execute this year, remaining: ops pushed to next year } */
  selectOperations(
    year: number,
    standStates: Map<string, StandYearState>,
    candidates: PlannedOperation[],
    volumeCapM3: number,
    annualGrowthM3: number
  ): { scheduled: PlannedOperation[]; remaining: PlannedOperation[] };
  /** Whether to split a stand's harvest when its single-year volume would exceed the cap.
   *  Returns max parts (2, 3, or 4), or 0 = never split. */
  shouldSplit(standHarvestVolumeM3: number, volumeCapM3: number): number;
  /** Years to wait after clearcut before regeneration (site_prep + planting). */
  regenDelayYears(): number;
  /** Species preference for replanting after clearcut. */
  regenerationSpecies(stand: StandData): "spruce" | "pine" | "mixed";
}
```

#### Strategy Implementations

**`maximum_growth_aggressive`:**
- `volumeCapMultiplier()`: `3.0` — effectively no practical limit; all ready stands regenerate immediately
- `selectOperations()`: Sort candidates by volume descending (biggest harvests first). Fill the year slot greedily until volume cap hit. All harvest types are equal priority — the goal is maximum throughput. Thinnings and clearcuts compete on equal footing.
- `shouldSplit()`: `() => 0` — never split; the goal is to regenerate ASAP
- `regenDelayYears()`: `0` — replant same year (growth resumes next season)
- `regenerationSpecies()`: site-appropriate (spruce on mesic+, pine on sub-xeric)

**`maximum_growth_balanced`:**
- `volumeCapMultiplier()`: `1.25` — capped at 125% of annual growth. Harvests spill into later years.
- `selectOperations()`: **Two-phase selection.** Phase 1: select thinnings first (lower volume per €, smoother curve). They consume volume cap from the bottom. Phase 2: fill remaining cap with clearcuts, largest volume first. If a single clearcut's volume exceeds remaining cap, try `shouldSplit()`; if split fails, push the whole clearcut to next year. **Priority inversion:** when total harvest volume already exceeds annual growth (unsustainable baseline), thinnings get absolute priority — clearcuts only if cap room remains after all thinnings are placed.
- `shouldSplit()`: if stand harvest volume > `volumeCapM3`, try smallest N (2, 3, or 4) that brings each part under the cap. Each part must be ≥ 1.5 ha.
- `regenDelayYears()`: `1` — replant next year to spread costs across years
- `regenerationSpecies()`: site-appropriate

**`carbon_storage`:**
- `volumeCapMultiplier()`: `0.5` — harvest only 50% of growth, building standing stock
- `selectOperations()`: Selection cuttings first (50% removal, preserves carbon stock). Only schedule clearcuts when a stand is ≥ optMax + 15 years (significantly over-mature). Thinnings have lowest priority — the goal is to keep volume in the forest. Remaining cap room after all selection cuts goes to thinnings.
- `shouldSplit()`: `() => 0` — avoid clearcuts entirely where possible
- `regenDelayYears()`: `2` — allow natural seeding before planting
- `regenerationSpecies()`: `"spruce"` — higher carbon density

**`biodiversity`:**
- `volumeCapMultiplier()`: `0.75` — harvest 75% of growth, slowly building stock
- `selectOperations()`: Mixed-species regeneration drives selection. Avoid clearcuts on stands flagged as waterside or steep slope (these stands are skipped by classification per T11 — they never appear as candidates). Selection cutting preferred over clearcut for stands near water. Retention: reduce harvest volume by 5–10% on all clearcuts (leave standing trees). Thinnings are standard priority.
- `shouldSplit()`: `() => 0` — keep stands intact for habitat continuity
- `regenDelayYears()`: `2` — favor natural regeneration cues
- `regenerationSpecies()`: `"mixed"` — mix of spruce, pine, birch based on site

**`balanced`:**
- `volumeCapMultiplier()`: `1.0` — harvest = growth, fully sustainable
- `selectOperations()`: **Round-robin interleaving.** Alternate: one thinning, one clearcut, one thinning, etc. Both types compete for the cap on equal footing. If one type's candidates run out, fill remaining cap with the other type. Most overdue operations (by age) get priority within each type.
- `shouldSplit()`: `() => 0` — no splitting in balanced mode
- `regenDelayYears()`: `1` — replant next year (matches current behavior)
- `regenerationSpecies()`: site-appropriate (spruce on mesic+, pine on sub-xeric)

#### Operation Deduction (Step 1 Detail)

Each year, the scheduler checks every pool operation against the current simulated state to determine if it's due:

| Operation type | Due condition | Source |
|---|---|---|
| `clear_cut` | `simulatedAge ≥ goalAdjustedOptMin` | `getOptimalAge()` in `config.ts`, adjusted per goal (T11) |
| `thinning` / `first_thinning` | `simulatedBA ≥ THINNING_BA[species]` AND `simulatedAge ≥ minThinningAge` | `THINNING_BA` from `config.ts` |
| `selection_cutting` | `simulatedAge ≥ goalAdjustedOptMin` (same as clearcut) | Preferred over clearcut for `carbon_storage`/`biodiversity` |
| `early_tending` / `tending` | `simulatedAge` within tending window (e.g., 5–25 years) | Standard tending ages from `config.ts` |
| Regeneration ops | Chained automatically after harvest — not pooled | `regenDelayYears()` after harvest year |

Operations that are NOT yet due (e.g., stand still too young for thinning) stay in the pool and are re-checked each year. An operation that was borderline in year 0 may become clearly due in year 3 when the stand has grown.

#### Volume Cap Granularity

The volume cap is enforced PER YEAR, not averaged across periods:

1. Compute `annualGrowthM3` from property's compartment data (sum of `area_ha × growth_m3_per_ha`)
2. `maxRemovalM3PerYear = volumeCapMultiplier() × annualGrowthM3`
3. Each year, cumulative harvest volume from selected operations ≤ `maxRemovalM3PerYear`
4. Operations that don't fit carry over to the next year's candidate pool

This means `maximum_growth_aggressive` (3.0×) will typically place all ready harvests in the first 1–2 years, while `carbon_storage` (0.5×) will spread harvests thinly across the entire plan period.

### 5. Real-Time Price Fetching (Luke PxWeb API)

**New file:** `src/lib/ai/price-fetcher.ts`

Timber prices are fetched from Luke's official PxWeb API — the most authoritative source for Finnish timber price statistics. Updated weekly, covers all regions, requires no authentication.

#### API Details

```
Endpoint: https://statdb.luke.fi:443/PXWeb/api/v1/fi/LUKE/met/metryv/0100_metryv.px
Method:   POST
Body:     JSON query (see below)
Format:   JSON ("format": "json")
```

**Variables:**

| Code | Meaning | Values |
|---|---|---|
| `W` | Week | `"2026W22"`, `"2026W21"`, etc. |
| `MPKH` | Region | `"9"`=Whole country, `"1"`=South, `"3"`=Central, `"4"`=Savo-Karjala, `"5"`=Kymi-Savo, `"6"`=Etelä-Pohjanmaa, `"71"`=Pohjois-Pohjanmaa, `"72"`=Kainuu-Koillismaa, `"8"`=Lapland |
| `HAKT` | Operation type | `"0"`=Standing sale, `"8021"`=Regeneration felling, `"8023"`=Thinning, `"8022"`=First thinning |
| `PTL` | Wood type | `"N1"`=Pine log, `"N2"`=Spruce log, `"N3"`=Birch log, `"N4"`=Pine pulp, `"N5"`=Spruce pulp, `"N6"`=Birch pulp, `"N7"`=Pine small log, `"N8"`=Spruce small log |

**Region mapping from municipality (determined at import time):**

Luke divides Finland into 9 pricing regions. The `forests` table stores a `price_region` column (Luke region code) that is computed once at import time — no runtime lookup needed during plan generation.

The mapping chain at import time:

```
property_id → first 3 digits → kuntanumero → municipality name + price_region
    ↓                ↓                ↓                    ↓
989-405-…          989             989             "Ähtäri" / "6"
```

**New file:** `src/lib/import/municipality-lookup.ts`

A hardcoded 309-entry lookup table maps every Finnish kuntanumero to `{ name, priceRegion }`. The MML API's GeoJSON `properties.kunta` returns the same 3-digit code already embedded in `property_id` — it adds no new information, so the static table is the authoritative source.

```typescript
// src/lib/import/municipality-lookup.ts
export const KUNTANUMERO_MAP: Record<string, { name: string; priceRegion: string }> = {
  "005": { name: "Alajärvi", priceRegion: "6" },
  "009": { name: "Alavieska", priceRegion: "71" },
  "010": { name: "Alavus", priceRegion: "6" },
  // … 309 total entries
  "989": { name: "Ähtäri", priceRegion: "6" },
  "992": { name: "Äänekoski", priceRegion: "3" },
};
```

**New column:** `forests.price_region TEXT` — stores the Luke region code (`"1"`–`"9"`, `"71"`, `"72"`). Set at import time alongside `municipality`.

**Luke region codes:**

| Code | Region | Example municipalities |
|------|--------|----------------------|
| `"1"` | Etelä-Suomi | Helsinki, Espoo, Turku, Tampere, Lahti, Lappeenranta, Kotka, Hämeenlinna, Porvoo |
| `"3"` | Keski-Suomi | Jyväskylä, Kuopio, Mikkeli, Savonlinna, Pieksämäki |
| `"4"` | Savo-Karjala | Joensuu, Lieksa, Nurmes, Ilomantsi |
| `"5"` | Kymi-Savo | Kouvola, Iitti, Heinola, Mäntyharju |
| `"6"` | Etelä-Pohjanmaa | Seinäjoki, Vaasa, **Ähtäri**, Kokkola, Pietarsaari |
| `"71"` | Pohjois-Pohjanmaa | Oulu, Raahe, Ylivieska, Nivala |
| `"72"` | Kainuu-Koillismaa | Kajaani, Kuusamo, Suomussalmi, Kuhmo |
| `"8"` | Lappi | Rovaniemi, Inari, Sodankylä, Kittilä |
| `"9"` | KOKO MAA (fallback) | — used when kuntanumero is unknown |

**Price tiers mapping:**

| Plan operation | Luke HAKT code |
|---|---|
| `clear_cut` | `"8021"` (uudistushakkuu) |
| `thinning` | `"8023"` (harvennushakkuu) |
| `first_thinning` | `"8022"` (ensiharvennus) |
| `selection_cutting` | `"8023"` (closest match) |

**Species mapping:**

| Plan species | Luke PTL code |
|---|---|
| `pine` | `"N1"` (tukki) + `"N4"` (kuitupuu) |
| `spruce` | `"N2"` (tukki) + `"N5"` (kuitupuu) |
| `silver_birch` / `birch` | `"N3"` (tukki) + `"N6"` (kuitupuu) |
| `downy_birch` | `"N3"` + `"N6"` (same as birch) |

#### Caching

- Fetch the latest week of prices at most once per 24 hours
- Store in `timber_prices` table (`price_data` JSONB with full response, `fetched_at`, `region`)
- On plan generation: check cache → if stale, fetch from Luke → cache → use
- Fallback chain: fresh cache (≤24h) → stale cache (≤7d) → live fetch (5s timeout) → hardcoded `PRICES` in `config.ts`

#### Flow

```
1. User requests plan → generate_plan tool called
2. Read forest.price_region (set at import time from kuntanumero lookup) — already the Luke region code
3. Check timber_prices cache for this region, fresh within 24h
4a. If fresh: parse cached JSON, extract tukki/kuitu prices per species/tier
4b. If stale: POST to Luke API with JSON query for latest week, cache response, parse
5. Pass prices into classifyAndValueStands() → calculateValue()
6. Fallback: if Luke is unreachable, use hardcoded PRICES from config.ts with region multiplier
```

### 6. Stand Wishes (User-Defined Constraints)

**New table:** `stand_wishes`

```sql
CREATE TABLE stand_wishes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forest_id UUID NOT NULL REFERENCES forests(id) ON DELETE CASCADE,
  compartment_id UUID NOT NULL REFERENCES compartments(id) ON DELETE CASCADE,
  wish_type TEXT NOT NULL,  -- 'delay_harvest', 'accelerate_harvest', 'no_clearcut', 
                            -- 'species_preference', 'retention_pct', 'custom'
  wish_value TEXT,          -- JSON or string value (e.g., '{"species": "pine"}', '5', '2035')
  notes TEXT,
  created_by TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_stand_wishes_forest ON stand_wishes(forest_id);
```

**Wish types:**
| Type | Value | Effect |
|------|-------|--------|
| `delay_harvest` | Year (e.g. "2035") | Don't harvest this stand before this year |
| `accelerate_harvest` | — | Prioritize this stand for harvest |
| `no_clearcut` | — | Only thinning or selection cutting allowed |
| `species_preference` | JSON: `{"species": "pine"}` | Replant with this species |
| `retention_pct` | Percentage (e.g. "10") | Leave this % of trees on clearcut |
| `custom` | Free text | Passed through to plan notes |

**Integration into plan generation:**
- Before scheduling, load all wishes for the forest
- `delay_harvest`: set `stand._manual_year` and skip if before the delay year
- `accelerate_harvest`: set `stand._priority_boost = 2.0` — the strategy engine's `finalHarvestUrgency()` multiplies its score by this boost, pushing the stand to the front of the harvest queue
- `no_clearcut`: convert any `clear_cut` operation to `selection_cutting` with 50% removal
- `species_preference`: override `regenerationSpecies()` output
- `retention_pct`: reduce harvest volume and income by the retention %

**AI tool access:**
- `get_stand_wishes`: list all wishes for a stand or forest
- `add_stand_wish`: add a new wish
- `remove_stand_wish`: remove a wish

### 7. Genus-Based Species Mapping

**New file:** `src/lib/ai/species-map.ts`

Fuzzy mapping of user-supplied species names to system values:

```typescript
const SPECIES_ALIASES: Record<string, string> = {
  // Pine
  "mänty": "pine", "mäntyä": "pine", "petäjä": "pine", "honka": "pine",
  "mäntyvaltainen": "pine", "männikkö": "pine",
  // Spruce  
  "kuusi": "spruce", "kuusta": "spruce", "kuusikko": "spruce",
  "kuusivaltainen": "spruce",
  // Birch
  "koivu": "birch", "koivua": "birch", "rauduskoivu": "silver_birch",
  "hieskoivu": "downy_birch", "koivikko": "birch",
  // ... etc
};
```

Use this in `classify.ts` `getSpeciesData()` to normalize any non-standard species strings from import data.

---

## Implementation Tasks

### T1: Remove Hardcoded Stand References
**Files:** `classify.ts`, `schedule.ts`
**Effort:** ~2h

- Delete K180, K128, K71/K72, K5 special cases from `classify.ts` (lines 196–261)
- Delete K7 3-part, K184 2-part, K180 hand-placement, K5 manual year from `schedule.ts` (lines 74–196)
- Verify that all remaining classification logic is generic (development_class driven)
- Run existing tests — expect test breakage, update test fixtures to remove hardcoded expectations
- Keep the scaffolding around these removals working (the `_manual_year` mechanism may still be useful for stand wishes)

### T2: Conditional Stand Splitting (Scheduling Tactic)
**Files:** `schedule.ts` (new `trySplitStand()` function), `config.ts` (new constants)
**Effort:** ~2h

- Add config constants: `MIN_SPLIT_AREA_HA = 1.5`, valid fractions `[1/2, 1/3, 1/4]`
- Implement `trySplitStand(stand, op, targetYearlyIncome, maxParts): PlannedOperation[] | null`
  - Called by the scheduler AFTER placing a harvest in a year, IF `shouldSplit()` returns N > 0
  - Checks: is the stand ≥ needed area for that fraction? (e.g., 3.0 ha for 1/2 split)
  - If yes: split into N sub-operations with proportional area/volume/income, each ≥ 1.5 ha
  - Returns the sub-operations (caller replaces the single op with these across N years)
  - If no (stand too small for the needed fraction): returns null, harvest stays whole
- Regeneration chain follows each sub-part in its respective year
- Write tests: stand too small for split (returns null), exact 3.0 ha 1/2 split, 6.0 ha split into 1/4, income threshold triggers split vs not

### T3: Goal Parameter + Tool Definition
**Files:** `tools.ts`, `tool-executor.ts`, `generate-plan.ts`, `types.ts`
**Effort:** ~1.5h

- Add `goal` to `GeneratePlanArgs` interface
- Update `generate_plan` tool definition with `goal` parameter (required, enum of 5 values)
- Pass `goal` through `tool-executor.ts` → `generatePlan()`
- Add goal type to `types.ts`: `type PlanGoal = "maximum_growth_aggressive" | "maximum_growth_balanced" | "carbon_storage" | "biodiversity" | "balanced"`
- Update `generate_plan` handler to accept and forward the goal parameter

### T4: Year-by-Year Scheduling Engine
**Files:** `schedule.ts` (major rewrite), new file `src/lib/ai/strategies.ts`, uses `src/lib/ai/forest-state.ts`
**Effort:** ~7h

- Define `SchedulingStrategy` interface with `volumeCapMultiplier()`, `selectOperations()`, `shouldSplit()`, `regenDelayYears()`, `regenerationSpecies()`
- Implement the core year-by-year loop: deduce → merge → select → apply → simulate → carryover → chain
- Use `getGrowthRate()` from `chart-engine.ts` for per-stand, per-year growth simulation (mutating state in-place between year steps)
- Use `estimateForestState()` for post-scheduling verification — the scheduler builds ops incrementally, then `estimateForestState()` validates the full timeline
- Implement 5 strategy objects as specified in Section 4
- Each strategy's `selectOperations()` implements goal-specific priority ordering (greedy, two-phase, selection-first, round-robin)
- Integrate stand splitting from T2: `shouldSplit()` decides, `trySplitStand()` splits, both volumes and regeneration chain correctly
- Stand wishes from T7/T8 influence selection via `_priority_boost` and `no_clearcut` conversion
- Write unit tests for each strategy:
  - `maximum_growth_aggressive`: all ready stands harvested in year 1 (under 3× cap); thinnings interleaved
  - `maximum_growth_balanced`: harvests capped at 125% annual growth per year; thinnings first; large stands split when exceeding cap
  - `carbon_storage`: selection cuttings first; clearcuts only when 15+ years past optMax; minimal volume removed
  - `biodiversity`: mixed species; retention volume deducted; selection cutting preferred
  - `balanced`: round-robin interleaving; harvest ≤ growth

### T5: System Prompt Update
**Files:** `system-prompt.ts`
**Effort:** ~0.5h

- Add goal prompting rule: AI MUST ask user for goal before calling `generate_plan` if not specified
- Add goal descriptions to the system prompt so AI can explain them to the user
- Update point 2 in KEY RULES to reference goals

### T5b: Municipality Lookup Table + Import Integration
**Files:** New file `src/lib/import/municipality-lookup.ts`, `src/lib/import/csv-importer.ts`, `src/app/api/import/property/route.ts`
**Effort:** ~1.5h

- Build `KUNTANUMERO_MAP`: hardcoded Record mapping all 309 Finnish kuntanumero → `{ name: string, priceRegion: string }`
  - Source data: official kuntaluettelo (Tilastokeskus). Municipality names in Finnish.
  - Luke region assignment per maakunta boundaries (see region table in Section 5).
  - Unknown/unlisted kuntanumero → `{ name: "Tuntematon", priceRegion: "9" }` (KOKO MAA fallback)
- In both import paths (CSV and WFS/API), after creating the forest record:
  ```typescript
  const kuntanumero = propertyId.replace(/-/g, "").slice(0, 3);
  const lookup = KUNTANUMERO_MAP[kuntanumero] ?? { name: "Tuntematon", priceRegion: "9" };
  // UPDATE forests SET municipality = lookup.name, price_region = lookup.priceRegion
  ```
- Existing `forests.municipality` column (already present, currently NULL) gets populated.
- New `forests.price_region` column stores the Luke region code for downstream use by T6.
- Write tests: known kuntanumero (989 → "Ähtäri"/"6"), unknown kuntanumero (fallback), property_id with dashes preserved.

### T6: Real-Time Price Fetcher (Luke PxWeb API)
**Files:** New file `src/lib/ai/price-fetcher.ts`
**Effort:** ~2.5h

- Implement `fetchLukePrices(priceRegion: string)`: POST to Luke PxWeb API with JSON query for the latest week
  - Endpoint: `https://statdb.luke.fi:443/PXWeb/api/v1/fi/LUKE/met/metryv/0100_metryv.px`
  - Query variables: W (week), MPKH (region = `priceRegion`), HAKT (operation type), PTL (wood type)
  - Compute current week dynamically (e.g., `2026W22`) — do NOT hardcode. Use `new Date()` to calculate ISO week number and year.
  - Request `"format": "json"` — returns structured price data
- Region is read directly from `forest.price_region` — no runtime lookup needed. The field is populated at import time via the `KUNTANUMERO_MAP` table.
- Parse response: extract tukki (log) and kuitu (pulp) prices per species per operation tier
- Caching: store full JSON response in `timber_prices` table with `region`, `fetched_at`
- Fallback chain: fresh cache (≤24h) → stale cache (≤7d) → live fetch (5s timeout) → hardcoded `PRICES` from `config.ts` with region multiplier
- Write tests with mock HTTP responses for known price values

### T7: Stand Wishes Database + API
**Files:** Migration SQL, `src/lib/repos/stand-wishes.ts`, new AI tools
**Effort:** ~3h

- Create migration: `stand_wishes` table
- Create `standWishesRepo` with CRUD operations (loaded by `forest_id`, filtered by `compartment_id`)
- Create AI tools:
  - `get_stand_wishes`: list wishes for a stand or all stands in forest
  - `add_stand_wish`: add a wish (wish_type + wish_value + optional notes)
  - `remove_stand_wish`: remove by ID
- Register tools in `tools.ts` and `tool-executor.ts`
- Validate wish types server-side
- `delay_harvest` year is capped at `plan period_end` — wishes beyond the plan period are stored but ignored during generation

### T8: Integrate Wishes into Plan Generation
**Files:** `classify.ts`, `schedule.ts`
**Effort:** ~2h

- Load stand wishes from DB before classification (join `stand_wishes.compartment_id` → `compartments.id` to resolve `stand_id`)
- Apply `delay_harvest`: skip scheduling if target year < wish year; cap wish year at plan `period_end`
- Apply `accelerate_harvest`: set `_priority_boost` on the stand so `finalHarvestUrgency()` pushes it to the front of the queue
- Apply `no_clearcut`: convert any `clear_cut` operation to `selection_cutting` with 50% removal
- Apply `retention_pct`: reduce harvest volume and income by the retention %
- Apply `species_preference`: override `regenerationSpecies()` output
- Pipe wishes through to operation notes for transparency (e.g., `"Per owner wish: no clearcut"`)

### T9: Species Name Normalization
**Files:** New file `src/lib/ai/species-map.ts`, `classify.ts`
**Effort:** ~1h

- Build species alias map (Finnish common names → system values)
- Integrate into `getSpeciesData()` and `calculateValue()` — reuse existing `birch → silver_birch` logic
- Handle edge cases: multi-word names, mixed stands, unknown species → `pine` fallback

### T10: Plan Metadata — Store Goal
**Files:** Migration, `plan_metadata` repo, `generate-plan.ts`
**Effort:** ~0.5h

- Add `goal` column to `plan_metadata` table (TEXT)
- Save the goal when generating a plan
- Expose goal in `plan_summary` output so the UI can display which goal was used

### T11: Goal-Aware Classification
**Files:** `classify.ts`
**Effort:** ~2h

- Accept `goal: PlanGoal` parameter in `classifyAndValueStands()`
- Implement the goal-adjusted thresholds table from Section 1b:
  - Clearcut eligibility age per goal
  - Selection cutting preference for `carbon_storage`/`biodiversity`
  - Waterside/slope exclusions for `biodiversity`
  - Peatland ditch mounding avoidance for `carbon_storage`/`biodiversity`
- Pass `goal` from `generatePlan()` → `classifyAndValueStands()`

### T12: Integrate Prices into Plan Generation
**Files:** `classify.ts`, `config.ts`, `generate-plan.ts`
**Effort:** ~2h

- In `generatePlan()`: before classification, load prices via `price-fetcher.ts` (cache → live fetch → hardcoded fallback)
- Pass loaded prices into `classifyAndValueStands()` → `calculateValue()`
- Update `income-calculator.ts` `calculateOperationIncome()` to use the same price loading path
- The hardcoded `PRICES` in `config.ts` remain as the last-resort fallback

### T13: Goal-Aware Validation
**Files:** `validation-tools.ts`, `tool-executor.ts`
**Effort:** ~1.5h

- `check_harvest_sustainability`: sustainability threshold changes per goal:
  - `maximum_growth_aggressive`/`balanced`: harvest ≤ annual growth (current behavior)
  - `maximum_growth_balanced`: harvest ≤ 125% of annual growth (matches plan cap)
  - `carbon_storage`: harvest ≤ 50% of annual growth (strict conservation)
  - `biodiversity`: harvest ≤ 75% of annual growth
- `validate_plan`: rules 4 (harvest vs growth) and 1 (clearcut eligibility) adjust per goal
- Validation output includes which goal the rules were checked against

### T14: Update System Prompt Guidelines
**Files:** `system-prompt.ts`
**Effort:** ~0.5h
**Bundled with T5**

- Update the `GUIDELINES` section (line 66): replace the `balanced`-specific text with goal-aware guidance
- Old: `"Thinnings aim for sustainable growth. Clearcuts auto-followed by regeneration chain. Never thin same stand within 10 years. Keep harvest below annual growth."`
- New: `"Plan behavior depends on the selected goal. Rules like rotation age, harvest limits, and regeneration methods vary. After generating a plan, the goal is visible in plan_summary."`

### T15: Database Migration
**Files:** New migration SQL file in `supabase/migrations/`
**Effort:** ~0.5h

Create a single migration covering all schema changes:
```sql
-- stand_wishes table (see Section 6 for full DDL)
-- plan_metadata.goal column: ALTER TABLE plan_metadata ADD COLUMN IF NOT EXISTS goal TEXT;
-- forests.price_region: ALTER TABLE forests ADD COLUMN IF NOT EXISTS price_region TEXT;
-- timber_prices: ALTER TABLE timber_prices ADD COLUMN IF NOT EXISTS region TEXT;
-- timber_prices: ALTER TABLE timber_prices ADD COLUMN IF NOT EXISTS valid_from DATE;
-- timber_prices: ALTER TABLE timber_prices ADD COLUMN IF NOT EXISTS valid_to DATE;
```

Note: `forests.municipality` already exists in the schema (from initial migration) — no ALTER needed.

### T16: Tests & Integration
**Files:** Various test files
**Effort:** ~4h

- Update existing plan generation tests to include goal parameter
- Test each strategy with a small synthetic forest (5 stands of varying ages/classes)
- Test goal-aware classification: clearcut eligibility thresholds per goal, selection cutting preference
- Test stand splitting edge cases: too-small, exact threshold, income trigger
- Test wish application: no_clearcut → selection_cutting, delay_harvest with year cap, retention volume reduction
- Test price fetching with mock HTTP responses, fallback chain
- Test goal-aware validation: different harvest vs growth thresholds per goal

---

## Task Summary

| Task | Description | Effort | Dependencies |
|------|-------------|--------|-------------|
| T1 | Remove hardcoded stand references | 2h | — |
| T2 | Conditional stand splitting (tactic, not default) | 2h | T1 |
| T3 | Goal parameter + tool definition | 1.5h | — |
| T4 | Year-by-year scheduling engine (5 goals) | 7h | T1, T2, T3 |
| T5 | System prompt update (goal prompting + guidelines) | 0.5h | T3 |
| T5b | Municipality lookup table + import integration | 1.5h | T15 |
| T6 | Real-time price fetcher (Luke PxWeb API) | 2.5h | T5b, T15 |
| T7 | Stand wishes DB + API | 3h | — |
| T8 | Integrate wishes into plan generation | 2h | T4, T7 |
| T9 | Species name normalization | 1h | — |
| T10 | Store goal in plan_metadata | 0.5h | T3 |
| T11 | Goal-aware classification | 2h | T1, T3 |
| T12 | Integrate prices into plan generation | 2h | T6, T11 |
| T13 | Goal-aware validation | 1.5h | T3, T4 |
| T14 | Update system prompt guidelines | 0.5h | T3 |
| T15 | Database migration (stand_wishes + plan_metadata + forests.price_region + timber_prices) | 0.5h | — |
| T16 | Tests & integration | 4h | All |

**Total:** ~34.5h

---

## Verification

After implementation, a generic property (any forest, not just 989-405-0001-0405) should produce sensible plans for all 5 goals:

1. **maximum_growth_aggressive**: All regeneration-ready stands harvested ASAP (3× growth cap). Thinnings distributed. Growth simulated year-by-year — operations chosen from current simulated state, not initial state. Regenerations planted immediately.
2. **maximum_growth_balanced**: Front-loaded regeneration, capped at 125% of annual growth per year — harvests spill into later years when cap is hit. Thinnings placed first (lower volume/€). Large stands split where a single harvest would exceed the cap. Growth-aware: future volumes used for cap calculations.
3. **carbon_storage**: Minimal clearcuts (only when 15+ years past optimal max), selection cutting preferred, standing volume higher at period end. Growth builds stock year-over-year; 0.5× cap spreads harvests thinly.
4. **biodiversity**: Mixed species in regeneration, retention noted, waterside/slope stands skipped, longer rotations.
5. **balanced**: Matches current output quality, no property-specific artifacts, harvest ≤ growth. Round-robin interleaving of thinnings and harvests; growth simulated.

Cross-cutting:
- All goals store correctly in `plan_metadata.goal` and show in `plan_summary`
- Both import paths populate `forest.municipality` (from kuntanumero lookup) and `forest.price_region` (Luke region code)
- Prices are fetched from Luke PxWeb API using `forest.price_region` directly — no runtime lookup needed
- Prices are cached per region, with hardcoded fallback + region multiplier
- Stand wishes are applied correctly: `no_clearcut` → `selection_cutting`, `delay_harvest` prevents early harvest, `retention_pct` reduces volume
- `validate_plan` and `check_harvest_sustainability` apply goal-appropriate thresholds

---

## Out of Scope (Future Phases)

- Dynamic growth modeling with climate scenarios
- Pest/disease risk integration
- EU subsidy optimization (METKA, etc.)
- Carbon credit marketplace integration
- Multi-property portfolio optimization
- Real-time timber market price ticker in UI
- Mobile app with offline plan viewing
