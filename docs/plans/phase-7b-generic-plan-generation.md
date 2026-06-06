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

### Goal 1: `maximum_growth`
Maximize total volume growth across the property over the plan period.
- **Rule:** All regeneration-ready stands get clearcut + replanted as soon as possible — front-loaded into the earliest years (capped at 5 clearcuts/year to keep operations realistic). Old slow-growing stock is replaced by fast-growing young trees.
- **Rule:** Thinnings happen on schedule (no delays) to maintain optimal density for growth.
- **Rule:** Tending operations scheduled as early as biologically feasible.
- **Success metric:** Highest total cumulative volume grown (net new m³ produced across all stands during the plan period). This rewards replacing slow-growing old stock with fast-growing young trees.

### Goal 2: `stable_income`
Produce steady, predictable income year-over-year without boom-bust cycles.
- **Rule:** If the generated plan's annual harvest volume exceeds annual growth (unsustainable over the long term), prioritize **thinnings** over clearcuts, since thinnings produce income with less volume shock.
- **Rule:** Spread clearcuts evenly across the period — no year should exceed 150% of the average annual harvest.
- **Rule:** Delay clearcuts on stands that are within optimal age range (don't rush harvests).
- **Rule:** Pair high-income years with reinvestment (site prep + planting in the same or following year).
- **Success metric:** Lowest standard deviation of annual net income (income − costs).

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

**Stand splitting is NOT automatic.** Splitting is a scheduling tactic available to the strategy engine, applied only when a goal constraint demands it. The most common case is the `stable_income` goal: if scheduling a full clearcut on a large stand would push that year's income far above the target (e.g., >150% of the yearly average), the scheduler may choose to split the harvest across 2–3 years to smooth the income curve.

Split constraints when used:
- Minimum sub-part area: **1.5 ha**
- Valid fractions: **1/2, 1/3, 1/4** of total stand area
- Choose the smallest number of parts that brings each year's income under the threshold
- Parts are spread interleaved across available years
- Do NOT split if there's no clear constraint being violated — a large stand harvested in one year is fine unless a goal rule says otherwise

### 1b. Goal-Aware Classification

**File:** `src/lib/ai/classify.ts` — accept `goal` parameter

Classification (determining *what* operations to create) must also be goal-aware, not just scheduling (*when* to place them). Currently `classifyAndValueStands()` produces the same set of `PlannedOperation[]` regardless of goal — but different goals need different classification thresholds:

| Classification rule | `maximum_growth` | `stable_income` | `carbon_storage` | `biodiversity` | `balanced` |
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

- maximum_growth: Maximize total volume. All regenerations done immediately. Fast rotation.
- stable_income: Steady annual income. Spread harvests evenly. Prioritize thinnings.
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
        enum: ["maximum_growth", "stable_income", "carbon_storage", "biodiversity", "balanced"],
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
Present the goals clearly: maximum_growth, stable_income, carbon_storage, biodiversity, balanced.
Do NOT pick a default — the user must choose.
```

### 4. Goal-Driven Scheduling Engine

**File:** `src/lib/ai/schedule.ts` — complete rewrite required

The scheduler becomes a strategy-pattern engine. Core structure:

```typescript
interface SchedulingStrategy {
  name: string;
  /** Priority score for a final harvest on this stand (higher = sooner). */
  finalHarvestUrgency(stand: StandData, op: PlannedOperation): number;
  /** Spread pattern: how many slots per year, interleave pattern. */
  spreadConfig(): { maxPerYear: number; interleave: "even-first" | "round-robin" | "front-loaded" };
  /** Whether to consider splitting a stand when its single-year income would exceed the 
   *  target (stable_income: >150% avg; others: never). Returns max parts (2, 3, or 4) or 0=don't split. */
  shouldSplit(standIncome: number, targetYearlyIncome: number): number;
  /** Thinning priority relative to final harvests. Controls which operations get first claim
   *  on year slots during scheduling:
   *  - "before_harvests": Place all thinnings into year slots FIRST, then fill remaining
   *    capacity with final harvests. Used by stable_income because thinnings produce income
   *    with less volume shock — smoother annual harvest curve.
   *  - "after_harvests": Place final harvests first, then fill gaps with thinnings.
   *    Used by carbon_storage where harvests are rare and thinnings are supplementary.
   *  - "interleaved": Round-robin placement — one thinning, one harvest, one thinning, etc.
   *    Used by maximum_growth and biodiversity. */
  thinningPriority(): "before_harvests" | "after_harvests" | "interleaved";
  /** Post-harvest regeneration delay (years). */
  regenerationDelay(): number;
  /** Species preference for replanting. */
  regenerationSpecies(stand: StandData): "spruce" | "pine" | "mixed";
}
```

#### Strategy implementations:

**`maximum_growth`:**
- `finalHarvestUrgency`: `-(ageYears - optMax)` — standard urgency, higher = sooner
- `spreadConfig`: `{ maxPerYear: 5, interleave: "front-loaded" }` — up to 5 clearcuts/year, front-loaded so all regeneration-ready stands are done by year ~6 (30 stands ÷ 5/year)
- `shouldSplit`: `() => 0` — never split; the goal is to regenerate ASAP
- `thinningPriority`: `"interleaved"` — thinnings fill gaps between final harvests
- `regenerationDelay`: `0` — replant same year
- `regenerationSpecies`: site-appropriate (spruce on mesic+, pine on sub-xeric)

**`stable_income`:**
- `finalHarvestUrgency`: inverse age urgency — spread evenly, not rush the most overdue
- `spreadConfig`: `{ maxPerYear: ceil(totalHarvests / periodYears), interleave: "round-robin" }`
- `shouldSplit`: if `standIncome > targetYearlyIncome * 1.5`, return smallest N (2, 3, or 4) that brings per-part income ≤ target; returns 0 if under threshold
- `thinningPriority`: `"before_harvests"` — if harvest already exceeds growth, thinning generates income with less volume impact
- `regenerationDelay`: `1` — replant next year to spread costs
- `regenerationSpecies`: site-appropriate

**`carbon_storage`:**
- `finalHarvestUrgency`: `-(ageYears - (optMax + 15))` — only harvest when 15 years past optimal max
- `spreadConfig`: `{ maxPerYear: max(1, ceil(totalHarvests / periodYears / 2)), interleave: "round-robin" }` — half the rate of balanced, minimizing clearcuts
- `shouldSplit`: `() => 0` — avoid clearcuts entirely where possible
- `thinningPriority`: `"after_harvests"`
- `regenerationDelay`: `2` — allow natural seeding
- `regenerationSpecies`: spruce-preference (higher carbon density)

**`biodiversity`:**
- `finalHarvestUrgency`: `-(ageYears - (optMax + 10))` — extended rotation
- `spreadConfig`: `{ maxPerYear: max(1, ceil(totalHarvests / periodYears / 2)), interleave: "round-robin" }` — same reduced rate as carbon_storage
- `shouldSplit`: `() => 0` — keep stands intact for habitat continuity
- `thinningPriority`: `"interleaved"`
- `regenerationDelay`: `2` — favor natural regeneration cues
- `regenerationSpecies`: `"mixed"` — mix of spruce, pine, birch based on site

**`balanced`:**
- `finalHarvestUrgency`: `-(ageYears - optMax)` — standard urgency, most overdue first
- `spreadConfig`: `{ maxPerYear: ceil(totalHarvests / periodYears), interleave: "round-robin" }` — even distribution across the full period
- `shouldSplit`: `() => 0` — no splitting in balanced mode
- `thinningPriority`: `"interleaved"` — thinnings and harvests alternate
- `regenerationDelay`: `1` — replant next year (matches current behavior)
- `regenerationSpecies`: site-appropriate (spruce on mesic+, pine on sub-xeric)

### 5. Real-Time Price Fetching

**New file:** `src/lib/ai/price-fetcher.ts`

#### Sources
Prices are fetched from multiple timber buyers and averaged:

| Source | URL / API | Format |
|--------|-----------|--------|
| UPM | `https://www.upm.com/fi/sijoittajat/metsan-hinta/` | HTML scrape — table of prices by species/tier |
| Metsä Group | `https://www.metsagroup.com/fi/puunhinta` | HTML scrape or API |
| Stora Enso | `https://www.storaenso.com/fi-fi/puunhinta` | HTML scrape or API |
| Luke (Natural Resources Institute Finland) | `https://statdb.luke.fi/` | JSON API — official statistics |

#### Area Selection
Prices vary significantly across Finland. The forest's `municipality` and `property_id` (first 3 digits = municipality code) determine the pricing area:

- **Southern Finland** (1xx): Highest prices
- **Central Finland** (4xx): Medium (Väli-Suomi)
- **Northern Finland** (8xx-9xx): Lower prices

Match area to pricing region used by each source. If area-specific data unavailable, fall back to national average.

#### Caching
- Fetch at most once per 24 hours per source
- Store in `timber_prices` table (`price_data` JSONB, `fetched_at`, `source`)
- On plan generation, use the freshest available data
- If all sources are stale (>7 days), fetch synchronously during plan generation (adds ~2-3s latency)

#### Schema Update (if needed)
The `timber_prices` table already exists with:
```sql
CREATE TABLE timber_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  price_data JSONB NOT NULL
);
```

Add columns: `region TEXT`, `valid_from DATE`, `valid_to DATE` to allow cached lookup by area.

#### Flow
```
1. User requests plan → generate_plan tool called
2. System checks timber_prices for this area, fresh within 24h
3a. If fresh: use cached prices
3b. If stale: fetch from sources (parallel), average, cache, use
4. Plan uses fetched prices for income calculations
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
- Add goal type to `types.ts`: `type PlanGoal = "maximum_growth" | "stable_income" | "carbon_storage" | "biodiversity" | "balanced"`
- Update `generate_plan` handler to accept and forward the goal parameter

### T4: Scheduling Strategy Engine
**Files:** `schedule.ts` (major rewrite), new file `src/lib/ai/strategies.ts`
**Effort:** ~6h

- Define `SchedulingStrategy` interface as outlined above
- Implement 5 strategy objects
- Refactor `schedulePlan()` to accept a `goal: PlanGoal` parameter
- Select the strategy based on goal
- Apply strategy methods for urgency sorting, spreading, thinning priority, regeneration
- Write unit tests for each strategy:
  - `maximum_growth`: all regeneration-ready stands scheduled within first ~6 years (capped at 5/year)
  - `stable_income`: harvest volume std dev below threshold
  - `carbon_storage`: no clearcuts unless significantly over-mature
  - `biodiversity`: mixed species regeneration
  - `balanced`: matches current behavior (modulo hardcoded exceptions)

### T5: System Prompt Update
**Files:** `system-prompt.ts`
**Effort:** ~0.5h

- Add goal prompting rule: AI MUST ask user for goal before calling `generate_plan` if not specified
- Add goal descriptions to the system prompt so AI can explain them to the user
- Update point 2 in KEY RULES to reference goals

### T6: Real-Time Price Fetcher
**Files:** New file `src/lib/ai/price-fetcher.ts`
**Effort:** ~4h

- Implement `fetchLukePrices()`: Luke statdb PxWeb API (most reliable, JSON, area-specific)
- Implement `fetchUPMPrices()`: scrape UPM website or find their JSON endpoint
- Implement `fetchMetsaGroupPrices()`: scrape or API
- Implement `fetchStoraEnsoPrices()`: scrape or API
- Implement `aggregatePrices(sources[]): PriceSet` — weighted average, Luke as baseline (2x weight), others equal
- Area detection from `forest.municipality` and `forest.property_id`:
  - **Southern Finland** (1xx): Highest prices
  - **Central Finland** (4xx): Medium (Väli-Suomi)
  - **Northern Finland** (8xx-9xx): Lower prices
- Caching: `timber_prices` table via `region`, `valid_from`, `valid_to` columns
- Fallback chain: fresh cache (≤24h) → stale cache (≤7d) → live fetch (with 5s timeout) → hardcoded defaults from `config.ts`

**Pragmatic note:** Web scraping is brittle. Implement Luke statdb PxWeb API as primary source (reliable, structured, JSON). The commercial scrapers are secondary — skip them for v1 if no clean API is found. The user can add more sources later.

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

- Modify `getPrices()` in `config.ts` to accept an optional `PriceSet` override from live data
- In `generatePlan()`: before classification, load prices via `price-fetcher.ts` (cache → live fetch → hardcoded fallback)
- Pass loaded prices into `classifyAndValueStands()` → `calculateValue()`
- Update `income-calculator.ts` `calculateOperationIncome()` to use the same price loading path
- The hardcoded `PRICES` in `config.ts` remain as the last-resort fallback

### T13: Goal-Aware Validation
**Files:** `validation-tools.ts`, `tool-executor.ts`
**Effort:** ~1.5h

- `check_harvest_sustainability`: sustainability threshold changes per goal:
  - `maximum_growth`/`balanced`: harvest ≤ annual growth (current behavior)
  - `stable_income`: harvest ≤ 110% of annual growth (slightly relaxed, income focus)
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
-- plan_metadata.goal column: ALTER TABLE plan_metadata ADD COLUMN goal TEXT;
-- timber_prices: ALTER TABLE timber_prices ADD COLUMN region TEXT;
-- timber_prices: ALTER TABLE timber_prices ADD COLUMN valid_from DATE;
-- timber_prices: ALTER TABLE timber_prices ADD COLUMN valid_to DATE;
```

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
| T4 | Scheduling strategy engine (5 goals) | 6h | T1, T2, T3 |
| T5 | System prompt update (goal prompting + guidelines) | 0.5h | T3 |
| T6 | Real-time price fetcher | 4h | — |
| T7 | Stand wishes DB + API | 3h | — |
| T8 | Integrate wishes into plan generation | 2h | T4, T7 |
| T9 | Species name normalization | 1h | — |
| T10 | Store goal in plan_metadata | 0.5h | T3 |
| T11 | Goal-aware classification | 2h | T1, T3 |
| T12 | Integrate prices into plan generation | 2h | T6, T11 |
| T13 | Goal-aware validation | 1.5h | T3, T4 |
| T14 | Update system prompt guidelines | 0.5h | T3 |
| T15 | Database migration (all schema changes) | 0.5h | — |
| T16 | Tests & integration | 4h | All |

**Total:** ~33h

---

## Verification

After implementation, a generic property (any forest, not just 989-405-0001-0405) should produce sensible plans for all 5 goals:

1. **maximum_growth**: All regeneration-ready stands harvested within first 6 years (capped at 5/year), thinnings distributed. Regenerations planted immediately.
2. **stable_income**: Harvest volume ±15% across years, no single year spike. Large harvests split where needed.
3. **carbon_storage**: Minimal clearcuts (only when 15+ years past optimal max), selection cutting preferred, standing volume higher at period end, no ditch mounding on peatland.
4. **biodiversity**: Mixed species in regeneration, retention noted, waterside/slope stands skipped, longer rotations.
5. **balanced**: Matches current output quality, no property-specific artifacts, harvest ≤ growth.

Cross-cutting:
- All goals store correctly in `plan_metadata.goal` and show in `plan_summary`
- Prices are fetched from Luke statdb (with fallback to hardcoded), cached per region
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
