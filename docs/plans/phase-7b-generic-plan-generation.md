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

**Universal rule — thinnings before clearcuts (all goals):** Thinnings are always prioritized over clearcuts across every goal. The reason is silvicultural: delayed thinnings cause over-density, which directly limits stand growth — trees compete for light, water, and nutrients, reducing the entire stand's volume increment. A clearcut can wait a year without ecological penalty (the trees are already mature and growth has slowed), but a missed thinning window permanently reduces the stand's growth trajectory. This is enforced by the candidate priority ordering in Section 4 (primary sort by operation type).

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

### Goal 4: `balanced`
Equal weighting of growth, income, and ecological sustainability. This is the standard goal matching Finnish silvicultural best practices — not a fallback. The AI must still present it as one option among four and let the user choose.
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

**Stand splitting is NOT automatic.** Splitting is a scheduling tactic available to the strategy engine, applied only when a goal constraint demands it. The most common case is the `maximum_growth_balanced` goal: if scheduling a full clearcut on a large stand would exceed that year's volume cap, the scheduler may choose to split the harvest across 2–3 years to stay within the cap.

Split constraints when used:
- Minimum sub-part area: **1.5 ha**
- Valid fractions: **1/2, 1/3, 1/4** of total stand area
- Choose the smallest number of parts that brings each year's harvest volume under the cap
- Parts are spread interleaved across available years
- Do NOT split if there's no clear constraint being violated — a large stand harvested in one year is fine unless a goal rule says otherwise

### 1b. Goal-Aware Classification

**File:** `src/lib/ai/classify.ts` — accept `goal` parameter

Classification (determining *what* operations to create) must also be goal-aware, not just scheduling (*when* to place them). Currently `classifyAndValueStands()` produces the same set of `PlannedOperation[]` regardless of goal — but different goals need different classification thresholds:

| Classification rule | `maximum_growth_aggressive` | `maximum_growth_balanced` | `carbon_storage` | `balanced` |
|---|---|---|---|---|---|
| Clearcut eligibility age | `age ≥ optMin` (standard) | `age ≥ optMin` | `age ≥ optMax + 15` | `age ≥ optMin` |
| Thinning BA threshold | Standard | Standard | Standard | Standard |
| Selection cutting | No preference | No preference | **Yes** — prefer over clearcut | No preference |
| Peatland ditch mounding | Allowed | Allowed | **Use scalping** instead of ditch_mounding | Allowed |

**Effect on `classify.ts` flow:**
1. Accept `goal: PlanGoal` parameter
2. `getOptimalAge()` for clearcut eligibility uses goal-adjusted thresholds
3. For `carbon_storage`: when a stand is over-age, prefer `selection_cutting` (50% removal) over `clear_cut` (100%)
4. For `carbon_storage`: on peatland, skip `ditch_mounding` and use `scalping` instead

### 2. New Tool Parameter: `goal`

**File:** `src/lib/chat/tools.ts` — `generate_plan` definition

```typescript
{
  name: "generate_plan",
  description: `Generate a forest management plan for the property.
Choose a goal that matches the owner's objectives:

- maximum_growth_aggressive: Maximize total volume. All regenerations done immediately. Fast rotation.
- maximum_growth_balanced: Capped growth. Front-load regeneration like aggressive but with 125% annual growth volume limit.
- carbon_storage: Maximize standing carbon stock. Avoid clearcuts. Extended rotations.
- balanced: Equal weight on all objectives. Standard Finnish best practices.`,
  parameters: {
    type: "object",
    properties: {
      period_years: { type: "number", description: "Duration in years (default 20)" },
      start_year: { type: "number", description: "Start year (default current year)" },
      goal: {
        type: "string",
        enum: ["maximum_growth_aggressive", "maximum_growth_balanced", "carbon_storage", "balanced"],
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
Present the goals clearly: maximum_growth_aggressive, maximum_growth_balanced, carbon_storage, balanced.
Do NOT pick a default — the user must choose.
```

### 4. Year-by-Year Scheduling Engine

**Files:** `src/lib/ai/schedule.ts` — complete rewrite; uses `src/lib/ai/forest-state.ts`

The scheduler becomes an iterative, growth-aware engine. Instead of placing all operations at once based on static urgency, it walks year-by-year through the plan period, simulating stand growth between each step.

#### Core Loop

```
state ← initial compartments (year 0, today's data from DB)
pool ← all classified harvest + thinning operations (from classify.ts, goal-aware per T11).
       Regeneration and tending operations are NOT in the initial pool —
       they are chained dynamically from harvest events (step 7).
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
       - Harvest: reduce volume, reduce BA (proportionally — BA is reduced by the same percentage as volume removal, matching `estimateForestState()` behavior: `newBA = oldBA × (1 − removalPct/100)`)
       - Clearcut: volume = 0, BA = 0, age = 0, cleared = true
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

1. **Primary sort — operation type:** Thinnings and selection cuttings are always prioritized over clearcuts. The reason is silvicultural: delayed thinnings cause over-density, which directly limits stand growth — trees compete for light, water, and nutrients, reducing the entire stand's volume increment. A clearcut can wait a year without ecological penalty (the trees are already mature and growth has slowed), but a missed thinning window permanently reduces the stand's growth trajectory. Operation type order:
   - `first_thinning` → `thinning` → `selection_cutting` (group A)
   - `clear_cut` (group B)
   Within group A, all three types are equal — the tiebreaker is step 2.

2. **Secondary sort — waiting time (dueYear):** Within each operation type group, operations that became due earlier get higher priority. An operation that was due in year 1 but couldn't fit due to volume cap has waited 3 years by year 4 and must be prioritized over an operation that just became due in year 4. This prevents starvation of operations on larger stands that keep getting pushed out. **Waiting time does NOT cross operation type boundaries** — a year-1 clearcut does not override a year-4 thinning.

3. **Tertiary sort — goal-specific metric (tiebreaker for same type + same dueYear):** When multiple operations share the same operation type group and became due in the same year (including all initially classified operations at year 0), the goal-specific metric decides order:

| Goal | Tiebreaker metric | Rationale |
|------|-------------------|-----------|
| `maximum_growth_aggressive` | Volume descending | Biggest harvests first — maximize throughput |
| `maximum_growth_balanced` | Volume descending | Within thinning group, biggest first; within clearcut group, biggest first |
| `carbon_storage` | Age descending (oldest first) | Preserve stock; harvest oldest stands if harvest is necessary |
| `balanced` | Age descending (most overdue first) | Standard silvicultural practice |

4. **Quaternary sort — stand wishes (`_priority_boost`):** Stands with `accelerate_harvest` wish are promoted ahead of same-type, same-dueYear peers. The mechanism: after step 3 sorting, boosted operations are re-inserted at position `floor(originalIndex / 2)` — effectively moved halfway toward the front of their type+dueYear group. Multiple boosted operations maintain their relative goal-metric order after re-insertion. Stands with `delay_harvest` (year cap) are excluded from candidates until the cap year passes — they never appear in the pool before then.

**Selection within priority order:** After sorting, the strategy's `selectOperations()` walks the sorted list and accepts operations until the volume cap is exhausted. Since thinnings are always sorted before clearcuts, strategies that want interleaved ordering (e.g., `balanced`'s round-robin) must explicitly alternate within `selectOperations()` — the pre-sort provides thinning-first ordering, and the strategy can override this by picking from both groups.

#### SchedulingStrategy Interface

```typescript
interface SchedulingStrategy {
  name: string;
  /** Per-year harvest volume cap, as a multiplier of the property's total annual growth (m³).
   *  The scheduler multiplies this by the total annual growth to get maxRemovalM3PerYear. */
  volumeCapMultiplier(): number;
  /** Select operations to execute this year from the candidate pool.
   *  Candidates arrive PRE-SORTED by priority (op type → dueYear → goal metric → wishes).
   *  Thinnings/selection cuttings are always before clearcuts.
   *  The strategy walks the sorted list and accepts ops until volume cap is exhausted,
   *  applying any additional filtering or quota rules (e.g., interleaving for balanced goal).
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
- `selectOperations()`: Walk the pre-sorted candidates greedily and accept operations until the volume cap is exhausted. Since the cap is 3.0× annual growth, all due operations typically fit in the first year. Thinnings and clearcuts are accepted in pre-sort order (thinnings first, clearcuts second) — the goal is maximum throughput, and the pre-sort ensures thinnings aren't starved by large clearcuts.
- `shouldSplit()`: `() => 0` — never split; the goal is to regenerate ASAP
- `regenDelayYears()`: `0` — replant same year (growth resumes next season)
- `regenerationSpecies()`: site-appropriate (spruce on mesic+, pine on sub-xeric)

**`maximum_growth_balanced`:**
- `volumeCapMultiplier()`: `1.25` — capped at 125% of annual growth. Harvests spill into later years.
- `selectOperations()`: Walk the pre-sorted candidates and accept operations until the volume cap is exhausted. Since thinnings are pre-sorted before clearcuts (silvicultural priority — delayed thinnings limit growth), they always get first claim on the cap. If a clearcut's volume exceeds remaining cap, try `shouldSplit()`; if split fails, push the whole clearcut to next year's carryover. **Priority inversion:** when total harvest volume already exceeds annual growth (unsustainable baseline), clearcuts are skipped entirely until all thinnings are placed — the strategy skips clearcuts in the candidate list until thinnings are exhausted.
- `shouldSplit()`: if stand harvest volume > `volumeCapM3`, try smallest N (2, 3, or 4) that brings each part under the cap. Each part must be ≥ 1.5 ha.
- `regenDelayYears()`: `1` — replant next year to spread costs across years
- `regenerationSpecies()`: site-appropriate

**`carbon_storage`:**
- `volumeCapMultiplier()`: `0.5` — harvest only 50% of growth, building standing stock
- `selectOperations()`: Walk the pre-sorted candidates. Selection cuttings and thinnings arrive before clearcuts from the pre-sort, so they claim the cap first. Only accept clearcuts when a stand is ≥ optMax + 15 years (significantly over-mature) — skip younger clearcuts even if they appear in the candidate list. Thinnings are accepted after selection cuttings. The goal is to keep volume in the forest; remaining cap room after all selection cuts and thinnings may be left unused rather than filled with aggressive harvests.
- `shouldSplit()`: `() => 0` — avoid clearcuts entirely where possible
- `regenDelayYears()`: `2` — allow natural seeding before planting
- `regenerationSpecies()`: `"spruce"` — higher carbon density

**`balanced`:**
- `volumeCapMultiplier()`: `1.0` — harvest = growth, fully sustainable
- `selectOperations()`: **Round-robin interleaving** — explicitly alternates between thinnings and clearcuts to override the thinning-first pre-sort. Algorithm: alternate picking one thinning, one clearcut, one thinning, etc. from the candidate list until the volume cap is exhausted. If one type's candidates run out, fill remaining cap with the other type. Most overdue operations (by age) get priority within each type.
- `shouldSplit()`: `() => 0` — no splitting in balanced mode
- `regenDelayYears()`: `1` — replant next year (matches current behavior)
- `regenerationSpecies()`: site-appropriate (spruce on mesic+, pine on sub-xeric)

#### Operation Deduction (Step 1 Detail)

Each year, the scheduler checks every pool operation against the current simulated state to determine if it's due:

| Operation type | Due condition | Source |
|---|---|---|
| `clear_cut` | `simulatedAge ≥ goalAdjustedOptMin` | `getOptimalAge()` in `config.ts`, adjusted per goal (T11) |
| `thinning` / `first_thinning` | `simulatedBA ≥ THINNING_BA[species]` AND `simulatedAge ≥ minThinningAge` | `THINNING_BA` from `config.ts` |
| `selection_cutting` | `simulatedAge ≥ goalAdjustedOptMin` (same as clearcut) | Preferred over clearcut for `carbon_storage` |
| `early_tending` / `tending` | `simulatedAge` within tending window (e.g., 5–25 years) | Standard tending ages from `config.ts` |
| Regeneration ops | Chained automatically after harvest — not pooled | `regenDelayYears()` after harvest year |

Operations that are NOT yet due (e.g., stand still too young for thinning) stay in the pool and are re-checked each year. An operation that was borderline in year 0 may become clearly due in year 3 when the stand has grown.

**Important — basal area in simulation:** `getGrowthRate()` uses basal area as a density modifier, but `estimateForestState()` does NOT increase BA during growth (BA is only reduced by harvests). Therefore, the operation deduction check `simulatedBA ≥ THINNING_BA` can only prevent duplicate thinnings on a stand that was already thinned — it cannot detect when a stand crosses the BA threshold through growth. To handle this correctly, **classification (T11) must create thinning operations for ALL stands whose BA is projected to reach the threshold during the plan period**, not only stands currently above it. The projection can use a simple linear BA model based on the stand's current BA and growth rate, or conservatively assume all young stands will need thinning.

**Important — single-pass classification:** Classification runs once at year 0 and produces the initial operation pool. For a 20-year plan, stands can change development classes (e.g., seedling → young thinning). The plan handles this as follows:
- Harvest and thinning operations are created by the initial classification for ALL stands that will need them during the period (not just those due at year 0)
- Regeneration operations are chained dynamically from harvest events (step 7 of the core loop — they are not in the initial pool)
- Tending operations are created by classification if the stand is within tending age now or will enter it during the plan period
- The `dueYear` field on each operation records when the operation first becomes applicable; the scheduler only selects it when its due condition is met

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
- Fallback chain: fresh cache (≤24h) → stale cache (≤7d) → live fetch (5s timeout) → hardcoded `PRICES` in `config.ts` × region multiplier

**Region multiplier for fallback prices:** The hardcoded `PRICES` are Central Finland reference values. When the Luke API is unreachable, prices are scaled by a region multiplier reflecting timber price differentials across Finland:

| Region code | Region | Multiplier | Rationale |
|-------------|--------|-----------|-----------|
| `"1"` | Etelä-Suomi | 1.15 | Highest prices — proximity to mills and export ports |
| `"3"` | Keski-Suomi | 1.00 | Reference region (base prices) |
| `"4"` | Savo-Karjala | 0.90 | Longer transport distances |
| `"5"` | Kymi-Savo | 0.95 | Intermediate |
| `"6"` | Etelä-Pohjanmaa | 0.92 | Intermediate |
| `"71"` | Pohjois-Pohjanmaa | 0.85 | Northern, longer hauls |
| `"72"` | Kainuu-Koillismaa | 0.80 | Remote, high harvest costs |
| `"8"` | Lappi | 0.75 | Lowest prices — remote, small log dimensions |
| `"9"` | KOKO MAA (fallback) | 1.00 | Use reference prices directly |

These multipliers are stored in a static `REGION_MULTIPLIERS` table in `config.ts`, applied as `price × multiplier` to both tukki and kuitu prices.

#### Flow

```
1. User requests plan → generate_plan tool called
2. Read forest.price_region (set at import time from kuntanumero lookup) — already the Luke region code
3. Check timber_prices cache for this region, fresh within 24h
4a. If fresh: parse cached JSON, extract tukki/kuitu prices per species/tier
4b. If stale: fetch from Luke API. Luke publishes with a one-week delay — data for the current week may not be available yet. Try the previous week first, then fall back up to 8 weeks:

   ```
   for offset = 1 to 8:
       weekCode = computeWeekCode(offset weeks ago)
       POST to Luke API with W = weekCode
       if response has data → cache + use
       if response is empty / no data → continue
   if no data after 8 attempts → fallback to hardcoded PRICES
   ```
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
- `delay_harvest`: set the operation's `dueYear` to the wish year — the scheduler's deduction step (Section 4, step 1) won't mark it as due until that year arrives. Wishes beyond the plan `period_end` are stored but ignored during generation.
- `accelerate_harvest`: set `stand._priority_boost = 2.0` — the candidate priority ordering (tertiary sort in Section 4) places these stands ahead of same-dueYear peers
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
- The old `_manual_year` pattern is replaced by `delay_harvest` stand wishes with `dueYear` tracking — remove it entirely

### T2: Conditional Stand Splitting (Scheduling Tactic)
**Files:** `schedule.ts` (new `trySplitStand()` function), `config.ts` (new constants)
**Effort:** ~2h

- Add config constants: `MIN_SPLIT_AREA_HA = 1.5`, valid fractions `[1/2, 1/3, 1/4]`
- Implement `trySplitStand(stand, op, volumeCapM3, maxParts): PlannedOperation[] | null`
  - Called by the scheduler when a harvest's volume exceeds `volumeCapM3` and `shouldSplit()` returns N > 0
  - Checks: is the stand ≥ needed area for that fraction? (e.g., 3.0 ha for 1/2 split)
  - If yes: split into N sub-operations with proportional area/volume/income, each ≥ 1.5 ha
  - Returns the sub-operations (caller replaces the single op with these across N years)
  - If no (stand too small for the needed fraction): returns null, harvest stays whole, pushed to next year
- Regeneration chain follows each sub-part in its respective year
- Write tests: stand too small for split (returns null), exact 3.0 ha 1/2 split, 6.0 ha split into 1/4, volume cap triggers split vs not

### T3: Goal Parameter + Tool Definition
**Files:** `tools.ts`, `tool-executor.ts`, `generate-plan.ts`, `types.ts`
**Effort:** ~1.5h

- Add `goal` to `GeneratePlanArgs` interface
- Update `generate_plan` tool definition with `goal` parameter (required, enum of 4 values)
- Pass `goal` through `tool-executor.ts` → `generatePlan()`
- Add goal type to `types.ts`: `type PlanGoal = "maximum_growth_aggressive" | "maximum_growth_balanced" | "carbon_storage" | "balanced"`
- Update `generate_plan` handler to accept and forward the goal parameter

### T4: Year-by-Year Scheduling Engine
**Files:** `schedule.ts` (major rewrite), new file `src/lib/ai/strategies.ts`, uses `src/lib/ai/forest-state.ts`
**Effort:** ~7h

- Define `SchedulingStrategy` interface with `volumeCapMultiplier()`, `selectOperations()`, `shouldSplit()`, `regenDelayYears()`, `regenerationSpecies()`
- Implement the core year-by-year loop: deduce → merge → select → apply → simulate → carryover → chain
- Use `getGrowthRate()` from `chart-engine.ts` for per-stand, per-year growth simulation (mutating state in-place between year steps). Pass `forest.growth_multiplier` from DB through `CompartmentInput.growth_multiplier` → `getGrowthRate(growthMultiplier)` for location-aware growth.
- Use `estimateForestState()` for post-scheduling verification — the scheduler builds ops incrementally, then `estimateForestState()` validates the full timeline
- Implement 4 strategy objects as specified in Section 4
- Each strategy's `selectOperations()` implements goal-specific priority ordering (greedy, two-phase, selection-first, round-robin)
- Integrate stand splitting from T2: `shouldSplit()` decides, `trySplitStand()` splits, both volumes and regeneration chain correctly
- Stand wishes from T7/T8 influence selection via `_priority_boost` and `no_clearcut` conversion
- Write unit tests for each strategy:
  - `maximum_growth_aggressive`: all ready stands harvested in year 1 (under 3× cap); thinnings accepted first in pre-sort order
  - `maximum_growth_balanced`: harvests capped at 125% annual growth per year; thinnings first; large stands split when exceeding cap
  - `carbon_storage`: selection cuttings first; clearcuts only when 15+ years past optMax; minimal volume removed
  - `balanced`: round-robin interleaving; harvest ≤ growth

### T5: System Prompt Update
**Files:** `system-prompt.ts`
**Effort:** ~1h

- Add goal prompting rule: AI MUST ask user for goal before calling `generate_plan` if not specified
- Add goal descriptions to the system prompt so AI can explain them to the user
- Update point 2 in KEY RULES to reference goals
- Update the `GUIDELINES` section (line 66): replace the `balanced`-specific text with goal-aware guidance
- Old: `"Thinnings aim for sustainable growth. Clearcuts auto-followed by regeneration chain. Never thin same stand within 10 years. Keep harvest below annual growth."`
- New: `"Plan behavior depends on the selected goal. Rules like rotation age, harvest limits, and regeneration methods vary. After generating a plan, the goal is visible in plan_summary."`

### T5b: Municipality Lookup Table + Import Integration
**Files:** New file `src/lib/import/municipality-lookup.ts`, `src/lib/import/csv-importer.ts`, `src/app/api/import/property/route.ts`
**Effort:** ~2h (extended: added growthMultiplier field)

- Build `KUNTANUMERO_MAP`: hardcoded Record mapping all 309 Finnish kuntanumero → `{ name: string, priceRegion: string, growthMultiplier: number }`
  - Source data: official kuntaluettelo (Tilastokeskus). Municipality names in Finnish.
  - Luke region assignment per maakunta boundaries (see region table in Section 5).
  - Growth multiplier per region (see Section 8).
  - Unknown/unlisted kuntanumero → `{ name: "Tuntematon", priceRegion: "9", growthMultiplier: 1.0 }` (KOKO MAA fallback)
- In both import paths (CSV and WFS/API), after creating the forest record:
  ```typescript
  const kuntanumero = propertyId.replace(/-/g, "").slice(0, 3);
  const lookup = KUNTANUMERO_MAP[kuntanumero] ?? { name: "Tuntematon", priceRegion: "9", growthMultiplier: 1.0 };
  // UPDATE forests SET municipality = lookup.name, price_region = lookup.priceRegion, growth_multiplier = lookup.growthMultiplier
  ```
- Existing `forests.municipality` column (already present, currently NULL) gets populated.
- New `forests.price_region` column stores the Luke region code for downstream use by T6.
- New `forests.growth_multiplier` column stores the location multiplier for downstream use by T16.
- Write tests: known kuntanumero (989 → "Ähtäri"/"6"/1.00), unknown kuntanumero (fallback), property_id with dashes preserved.

### T6: Real-Time Price Fetcher (Luke PxWeb API)
**Files:** New file `src/lib/ai/price-fetcher.ts`
**Effort:** ~2.5h

- Implement `fetchLukePrices(priceRegion: string)`: fetches timber prices from Luke PxWeb API with a week-by-week fallback
  - Endpoint: `https://statdb.luke.fi:443/PXWeb/api/v1/fi/LUKE/met/metryv/0100_metryv.px`
  - Query variables: W (week), MPKH (region = `priceRegion`), HAKT (operation type), PTL (wood type)
  - Compute ISO week codes dynamically with `new Date()` — do NOT hardcode.
  - **Week fallback:** Luke publishes with a one-week delay. Try week-1 first (previous week). If the response contains no data (empty dataset), try week-2, week-3, … up to week-8. Cache the first successful response. If all 8 weeks return empty, fall back to hardcoded `PRICES`.
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
- Apply `accelerate_harvest`: set `_priority_boost` on the stand so the candidate priority ordering (Section 4, tertiary sort) pushes it ahead of same-dueYear peers
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
  - Selection cutting preference for `carbon_storage`
  - Peatland ditch mounding avoidance for `carbon_storage`
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
  - `maximum_growth_aggressive`: harvest ≤ 300% of annual growth (matches 3.0× scheduling cap — aggressive regeneration is intentional)
  - `maximum_growth_balanced`: harvest ≤ 125% of annual growth (matches plan cap)
  - `carbon_storage`: harvest ≤ 50% of annual growth (strict conservation)
  - `balanced`: harvest ≤ annual growth (sustainable baseline)
- `validate_plan`: rules 4 (harvest vs growth) and 1 (clearcut eligibility) adjust per goal
- Validation output includes which goal the rules were checked against

### T14: Database Migration
**Files:** New migration SQL file in `supabase/migrations/`
**Effort:** ~0.5h

Create a single migration covering all schema changes:
```sql
-- stand_wishes table (see Section 6 for full DDL)
-- plan_metadata.goal column: ALTER TABLE plan_metadata ADD COLUMN IF NOT EXISTS goal TEXT;
-- forests.price_region: ALTER TABLE forests ADD COLUMN IF NOT EXISTS price_region TEXT;
-- forests.growth_multiplier: ALTER TABLE forests ADD COLUMN IF NOT EXISTS growth_multiplier FLOAT DEFAULT 1.0;
-- timber_prices: ALTER TABLE timber_prices ADD COLUMN IF NOT EXISTS region TEXT;
-- timber_prices: ALTER TABLE timber_prices ADD COLUMN IF NOT EXISTS valid_from DATE;
-- timber_prices: ALTER TABLE timber_prices ADD COLUMN IF NOT EXISTS valid_to DATE;
```

Note: `forests.municipality` already exists in the schema (from initial migration) — no ALTER needed.

### T15: Tests & Integration
**Files:** Various test files
**Effort:** ~4h

- Update existing plan generation tests to include goal parameter
- Test each strategy with a small synthetic forest (5 stands of varying ages/classes)
- Test goal-aware classification: clearcut eligibility thresholds per goal, selection cutting preference
- Test stand splitting edge cases: too-small, exact threshold, volume cap trigger
- Test wish application: no_clearcut → selection_cutting, delay_harvest with year cap, retention volume reduction
- Test price fetching with mock HTTP responses, fallback chain
- Test goal-aware validation: different harvest vs growth thresholds per goal
- Test growth location effect: different regions produce different growth rates

### T16: Location Effect on Growth Rate
**Files:** `src/lib/ai/chart-engine.ts`, `src/lib/ai/forest-state.ts`, `src/lib/ai/config.ts`
**Effort:** ~2h

- Add `growthMultiplier` parameter to `getGrowthRate()` (default 1.0, backward compatible)
- Add `growth_multiplier?: number` to `CompartmentInput` interface in `forest-state.ts`
- Thread `growthMultiplier` through `estimateForestState()` simulation loop
- Add `GROWTH_REGION_MULTIPLIERS` static table to `config.ts` as fallback
- In the scheduling engine (T4), read `forest.growth_multiplier` from DB and pass as compartment property
- Write test: same stand with multiplier 1.10 (south) produces ~10% more volume at year N than baseline
- Write test: same stand with multiplier 0.55 (Lappi) produces ~45% less volume
- Write test: multiplier 1.00 (baseline/Väli-Suomi) identical to omitting the parameter

---

## 8. Location Effect on Growth Rate

### Problem

The growth simulator (VMI13 base rates: `GROWTH_MINERAL`, `GROWTH_PEATLAND` in `config.ts`) is calibrated for **Väli-Suomi** (central Finland, ~1000–1150 dd temperature sum, ~155–170 day growing season). A sub-xeric pine stand in Etelä-Suomi (south coast, 1200–1350 dd) grows ~10% faster; the same stand in Lappi (650–850 dd) grows ~45% slower. Currently all forests — regardless of geographic location — use the same base rates, making plans inaccurate for properties outside Väli-Suomi.

### Solution

Apply a **growth region multiplier** on top of the existing site-type base rate. Each forest gets a `growth_multiplier` computed once at import time from its municipality's location. The multiplier is stored as a `FLOAT` column on the `forests` table and passed through to `getGrowthRate()` during plan generation.

### Growth Regions

The same 9 Luke price regions (Section 5) are reused as growth regions. Each region gets a growth multiplier derived from **Luke VMI13 forestry centre growth data** (Metsätilastollinen vuosikirja), normalized to the Väli-Suomi baseline (Keski-Suomi + Etelä-Pohjanmaa = 1.00):

| Region code | Region | Growth multiplier | Rationale |
|-------------|--------|-------------------|-----------|
| `"1"` | Etelä-Suomi | **1.10** | Highest temp sums (1200–1350 dd), longest growing season. Forestry centres (Rannikko 1.19, Lounais-Suomi 1.09, Häme-Uusimaa 1.11) avg 1.13, conservatively rounded to 1.10. |
| `"5"` | Kymi-Savo | **1.05** | Transition zone (1150–1250 dd). Kaakkois-Suomi 1.09 + Etelä-Savo 1.01 → avg 1.05. |
| `"3"` | Keski-Suomi | **1.00** | **Baseline.** Väli-Suomi reference. Keski-Suomi 0.99, Pohjois-Savo 0.99. Temp sums 1050–1150 dd. |
| `"6"` | Etelä-Pohjanmaa | **1.00** | **Baseline.** Väli-Suomi reference. Etelä-Pohjanmaa 1.03. Temp sums 1000–1100 dd. |
| `"4"` | Savo-Karjala | **0.90** | Colder continental climate. Pohjois-Karjala 0.86, rounded to 0.90. |
| `"71"` | Pohjois-Pohjanmaa | **0.80** | Northern, shorter growing season (900–1000 dd). Forestry centre 0.80. |
| `"72"` | Kainuu-Koillismaa | **0.75** | Remote, cold. Kainuu forestry centre 0.70, raised slightly for Koillismaa area. |
| `"8"` | Lappi | **0.55** | Arctic (650–850 dd, 110–130 day season). Lappi forestry centre 0.51, conservatively rounded to 0.55. |
| `"9"` | KOKO MAA (fallback) | **1.00** | Unknown location → conservative baseline. |

**Data source:** Luke Metsätilastollinen vuosikirja (Forest Statistics Yearbook), average annual increment (m³/ha/y) by forestry centre (metsäkeskus) on productive forest land, all species. Multipliers = forestry_centre_growth / baseline_growth where baseline is avg(Keski-Suomi, Etelä-Pohjanmaa, Pohjois-Savo) = 4.87 m³/ha/y. Values rounded to nearest 0.05 for clean application.

**Design note — why same regions as price:** The Luke price regions already partition Finland along climatic and logistically meaningful boundaries that correlate with forestry centre areas. While the multiplier VALUES differ (price vs growth), the underlying geography is the same. Reusing the same region codes means one lookup table (`KUNTANUMERO_MAP`) can supply both `priceRegion` and `growthMultiplier` without maintaining separate region assignments.

### Implementation

**1. Extend `KUNTANUMERO_MAP`** (`src/lib/import/municipality-lookup.ts`):

```typescript
export const KUNTANUMERO_MAP: Record<string, {
  name: string;
  priceRegion: string;
  growthMultiplier: number;
}> = {
  "005": { name: "Alajärvi", priceRegion: "6", growthMultiplier: 1.00 },
  "009": { name: "Alavieska", priceRegion: "71", growthMultiplier: 0.80 },
  // …
  "091": { name: "Helsinki", priceRegion: "1", growthMultiplier: 1.10 },
  // …
  "989": { name: "Ähtäri", priceRegion: "6", growthMultiplier: 1.00 },
};
```

**2. New DB column** (`forests.growth_multiplier`):

```sql
ALTER TABLE forests ADD COLUMN IF NOT EXISTS growth_multiplier FLOAT DEFAULT 1.0;
```

Populated at import time from `KUNTANUMERO_MAP[propertyIdFirst3].growthMultiplier`.

**3. Apply in `getGrowthRate()`** (`src/lib/ai/chart-engine.ts`):

```typescript
export function getGrowthRate(
  siteType: string,
  soilType: string,
  species: string,
  ageYears: number | null,
  basalArea: number | null,
  developmentClass: string | null,
  growthMultiplier: number = 1.0  // NEW parameter
): number {
  const table = soilType === "peatland" ? GROWTH_PEATLAND : GROWTH_MINERAL;
  const base = table[siteType] ?? GROWTH_DEFAULT;
  const sf = speciesFactor(species, siteType);
  const af = ageFactor(ageYears);
  const df = densityFactor(basalArea, siteType, developmentClass);
  return base * sf * af * df * growthMultiplier;  // ← location effect applied HERE
}
```

**4. Thread through `estimateForestState()`** (`src/lib/ai/forest-state.ts`):

The `CompartmentInput` interface gains an optional `growthMultiplier` field. The scheduler reads `forest.growth_multiplier` from the DB and passes it as a compartment property:

```typescript
export interface CompartmentInput {
  // … existing fields
  growth_multiplier?: number;  // NEW — defaults to 1.0 if absent
}
```

In the simulation loop, `getGrowthRate()` receives `s.growthMultiplier ?? 1.0`.

**5. Static fallback** (`src/lib/ai/config.ts`):

```typescript
export const GROWTH_REGION_MULTIPLIERS: Record<string, number> = {
  "1": 1.10,
  "3": 1.00,
  "4": 0.90,
  "5": 1.05,
  "6": 1.00,
  "71": 0.80,
  "72": 0.75,
  "8": 0.55,
  "9": 1.00,
};
```

Used as a fallback if `forest.growth_multiplier` is NULL for legacy forests imported before this change.

### Effect on Existing Behavior

- **Ähtäri (region 6, multiplier 1.00):** No change — backward compatible. Current lifecycle test unaffected.
- **Helsinki (region 1, multiplier 1.10):** Sub-xeric pine peak growth rises from 3.1 → 3.4 m³/ha/y. Clearcut volume at age 80 rises from 181 → 199 m³/ha.
- **Rovaniemi (region 8, multiplier 0.55):** Sub-xeric pine peak growth drops from 3.1 → 1.7 m³/ha/y. Clearcut volume at age 80 drops from 181 → 100 m³/ha — rotation age would need to extend to ~110 years.

### Interaction with Goals

The growth multiplier affects ALL goals since it changes the underlying growth rate:
- `maximum_growth_aggressive`: Higher growth in south → faster accumulation → more volume to harvest → larger clearcut revenues. Lower growth in north → slower rotation → fewer harvests per period.
- `maximum_growth_balanced`: Volume caps (125% of annual growth) scale with location — Lappi forests have much lower caps, naturally spacing harvests further apart.
- `carbon_storage`: Standing volume at period end varies by region — southern forests store more carbon per hectare.
- `balanced`: Standard Finnish silviculture adapts. Rotation ages in `OPTIMAL_AGES` are already conservative for south and optimistic for north, but the growth multiplier partially compensates.

---

## Task Summary

| Task | Description | Effort | Dependencies |
|------|-------------|--------|-------------|
| T1 | Remove hardcoded stand references | 2h | — |
| T2 | Conditional stand splitting (tactic, not default) | 2h | T1 |
| T3 | Goal parameter + tool definition | 1.5h | — |
| T4 | Year-by-year scheduling engine (4 goals) | 7h | T1, T2, T3 |
| T5 | System prompt update (goal prompting + guidelines) | 1h | T3 |
| T5b | Municipality lookup table + import integration | 2h | T14 |
| T6 | Real-time price fetcher (Luke PxWeb API) | 2.5h | T5b, T14 |
| T7 | Stand wishes DB + API | 3h | — |
| T8 | Integrate wishes into plan generation | 2h | T4, T7 |
| T9 | Species name normalization | 1h | — |
| T10 | Store goal in plan_metadata | 0.5h | T3 |
| T11 | Goal-aware classification | 2h | T1, T3 |
| T12 | Integrate prices into plan generation | 2h | T6, T11 |
| T13 | Goal-aware validation | 1.5h | T3, T4 |
| T14 | Database migration (stand_wishes + plan_metadata + forests.price_region + forests.growth_multiplier + timber_prices) | 0.5h | — |
| T15 | Tests & integration | 4h | All |
| T16 | Location effect on growth rate | 2h | T5b, T14 |
| T17 | Age factor recalibration (young↑ old↓) | 2h | T4 |

**Total:** ~38h

---

## Verification

After implementation, a generic property (any forest, not just 989-405-0001-0405) should produce sensible plans for all 4 goals:

1. **maximum_growth_aggressive**: All regeneration-ready stands harvested ASAP (3× growth cap). Thinnings distributed. Growth simulated year-by-year — operations chosen from current simulated state, not initial state. Regenerations planted immediately.
2. **maximum_growth_balanced**: Front-loaded regeneration, capped at 125% of annual growth per year — harvests spill into later years when cap is hit. Thinnings prioritized silviculturally (delayed thinnings limit growth). Large stands split where a single harvest would exceed the cap. Growth-aware: future volumes used for cap calculations.
3. **carbon_storage**: Minimal clearcuts (only when 15+ years past optimal max), selection cutting preferred, standing volume higher at period end. Growth builds stock year-over-year; 0.5× cap spreads harvests thinly.
4. **balanced**: Matches current output quality, no property-specific artifacts, harvest ≤ growth. Round-robin interleaving of thinnings and harvests; growth simulated.

Cross-cutting:
- All goals store correctly in `plan_metadata.goal` and show in `plan_summary`
- Both import paths populate `forest.municipality` (from kuntanumero lookup), `forest.price_region` (Luke region code), and `forest.growth_multiplier`
- Prices are fetched from Luke PxWeb API using `forest.price_region` directly — no runtime lookup needed
- Prices are cached per region, with hardcoded fallback + region multiplier
- Stand wishes are applied correctly: `no_clearcut` → `selection_cutting`, `delay_harvest` prevents early harvest, `retention_pct` reduces volume
- `validate_plan` and `check_harvest_sustainability` apply goal-appropriate thresholds
- **Location effect:** Same stand on Helsinki (multiplier 1.10) produces ~10% more growth than Ähtäri (1.00); same stand in Rovaniemi (0.55) produces ~45% less. Plans for northern properties have longer rotation ages and lower harvest volumes.

---

## 9. Growth Rate Tuning — Age Factor Recalibration

### Problem

Validation against Luke VMI13 data (Section "Simulator vs Luke") revealed that the growth simulator's **age factor curve** distributes growth incorrectly across a stand's lifetime:

| Metric | Simulator | Tapio/Luke target | Gap |
|--------|-----------|-------------------|-----|
| Age 20 unthinned volume | 47 m³/ha | 50–65 m³/ha (Tapio) | −3 to −18 |
| Age 25 pre-1st-thinning | 57 m³/ha | 70–85 m³/ha (Tapio) | −13 to −28 |
| Age 80 pre-clearcut | 232 m³/ha | 170–210 m³/ha (Tapio, sub-xeric pine) | +22 to +62 |
| Avg growth age 5–80 | 3.05 m³/ha/y | ~3.0–3.25 (VMI13 for sub-xeric) | Slightly low |

**The pattern:** young stands grow too slowly, old stands accumulate too much volume. The total growth over a full rotation is roughly correct (~229 vs ~230 m³/ha expected), but the distribution is wrong — too much growth is happening in ages 50–80 and too little in ages 5–25.

### Root Causes

1. **Conservative seedling age factor:** `ageFactor` starts at 0.65 raw (age 0). For a 5-year-old pine stand, this gives 0.75 raw → 0.806 normalized. Real pine seedlings on sub-xeric sites establish faster.

2. **Too-gentle old-age decline:** The decline after age 70 is only −0.005/year raw. Real old stands lose growth faster due to mortality, wind damage, and senescence not modeled in the simulator.

3. **No BA growth modeling:** This is a separate issue (BA stays at 3 m²/ha forever, densityFactor at 0.867). If BA grew to normal levels, young stands would fill in faster (densityFactor rising from 0.65 to 1.0), which would partially address the young-stand gap. However, it would also make the old-stand overshoot WORSE unless counterbalanced by steeper decline.

### Tuning Strategy

**Redistribute growth from old to young** while keeping total rotation growth approximately constant. The age factor curve is the primary tuning knob — it controls how growth varies with stand age independently of site type, species, or density.

**Target curve shape:**

```
Current:  _/‾‾‾‾‾‾‾‾‾\__     (long plateau, gentle decline)
Target:   _/‾‾‾\_______      (steeper ramp, earlier peak, steeper decline)
```

**Proposed parameter changes to `ageFactor()` in `chart-engine.ts`:**

| Parameter | Current | Proposed | Effect |
|-----------|---------|----------|--------|
| Seedling base (`a < 15` slope) | `0.65 + 0.020·a` | `0.68 + 0.028·a` | +15–25% growth for ages 5–15 |
| Young stand (`15 ≤ a < 40` slope) | `0.95 + 0.002·(a−15)` | `0.90 + 0.005·(a−15) → peak at 1.025` | Faster ramp to peak, peak at age ~35 |
| Plateau window | 40–70 (30 years) | 30–50 (20 years) | Shorter peak, decline starts earlier |
| Decline start age | 70 | 50 | 20 years earlier |
| Decline slope (`a ≥ 70`) | `−0.005·(a−70)` | `−0.008·(a−50)` | 60% steeper decline |
| Senescence (`a ≥ 85`) | `−0.003·(a−100)` | `−0.005·(a−85)` | Faster terminal decline |

**Expected trajectory (unthinned, current BA limitation):**

| Age | Current vol (m³/ha) | Tuned vol (m³/ha) | Tapio target | Match? |
|-----|---------------------|--------------------|-------------|--------|
| 20 | 47 | **55** | 50–65 | ✅ matches lower-mid |
| 25 | 57 | **68** | 70–85 | ⚠️ slightly low (−2) |
| 40 | 103 | **117** | 90–115 | ⚠️ slightly high (+2) |
| 60 | 166 | **167** | 130–165 | ⚠️ slightly high (+2) |
| 80 | 232 | **200** | 170–210 | ✅ matches upper-mid |

### Volume Ceiling

Additionally, introduce a **site-type maximum volume** (`SITE_MAX_VOLUME` in `config.ts`) to prevent unbounded accumulation in old stands. Even with steeper decline, the growth rate never goes negative — old stands can theoretically accumulate infinite volume. A ceiling caps the standing volume at a biologically realistic maximum:

```typescript
export const SITE_MAX_VOLUME: Record<string, number> = {
  lehtomainen: 350,  // m³/ha
  tuore: 280,
  kuivahko: 200,      // sub-xeric
  kuiva: 120,
};
```

In `estimateForestState()`, after applying growth: `s.volumeM3 = Math.min(s.volumeM3, s.areaHa * SITE_MAX_VOLUME[siteClass])`.

When a stand hits the ceiling, the growth rate effectively becomes the ceiling minus previous volume (or zero if already at ceiling). This models the biological reality that old stands reach equilibrium where growth ≈ mortality.

### Interaction with Location Effect (Section 8)

The age factor tuning is **orthogonal** to the location multiplier — both multiply the base rate:

```
growthRate = base × speciesFactor × ageFactor(tuned) × densityFactor × growthMultiplier(location)
```

The location effect scales the entire curve uniformly. A Lappi stand (0.55) gets proportionally lower growth at ALL ages, but the shape (young ramp, peak, decline) is the same everywhere. Tuning the age curve improves accuracy for all regions simultaneously.

### Interaction with BA Growth

If BA growth is later modeled (allowing densityFactor to reach 1.0), the age curve would need re-tuning — the higher densityFactor at peak ages would further increase old-stand volumes. The steeper decline proposed here partially compensates, but a full BA growth model would require a coordinated recalibration.

### Implementation Notes

- **No new DB migration needed** — purely a code change in `chart-engine.ts` + `config.ts`
- **Existing lifecycle test will fail** (hardcoded volume assertions at specific ages change)
- **New calibration test recommended**: verify volumes at ages 20, 40, 60, 80 match Tapio/Yield table ranges
- **Effort:** ~2h (parameter tuning + test updates)
- **Risk:** Low — only changes the age factor curve shape; all other subsystems (classification, scheduling, validation) work with whatever growth rates the engine produces

---

## Out of Scope (Future Phases)

- Dynamic growth modeling with climate scenarios
- Pest/disease risk integration
- EU subsidy optimization (METKA, etc.)
- Carbon credit marketplace integration
- Multi-property portfolio optimization
- Real-time timber market price ticker in UI
- Mobile app with offline plan viewing
