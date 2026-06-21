# ML-REMF-01: Removal Fraction Prediction Model

**Status:** Draft  
**Created:** 2026-06-20  
**Category:** Machine Learning / Simulation Engine  
**Tier:** 1 — Ship This Month

## Problem

The current removal fraction calculation in `schedule.ts` uses universal clamps that are
species-aware but not calibrated to real forest owner behavior:

| Operation | Calculation | Clamp |
|---|---|---|
| First thinning | `(stems − target) / stems` | 35–50% |
| Regular thinning | `(BA − effectiveTarget) / BA` | 25–50% |
| Clearcut | Fixed 100% | — |

**Documented gaps** (from `references/simulation-engine.md`):

1. **Post-thinning stem depletion on poor sites** — BA-headroom model removes too many stems on
   sub-xeric/xeric sites where D growth is slow, crippling volume accumulation toward clearcut.
   Proposed fix was a `THINNING_MIN_POST_STEMS_HA` guard — but the real issue is that the
   removal fraction is wrong for those site classes.

2. **First-thinning BA overshoot** — stem-count targets don't account for BA, so post-first-thin
   BA can land 5–10 m²/ha above the BA-headroom target, shortening intervals to next thinning.

3. **`generate-plan.ts` override pitfall** — `getRemovalPct()` returns hardcoded 33%/40% from
   `OPERATION_DEFAULTS`, ignoring SPAWN's dynamically computed fraction. The DB stores wrong
   values, and UI derives wrong post-thin state.

An ML model trained on **actual removal fractions used by real forest owners** replaces the
clamping logic with data-calibrated predictions that are species × site × stand-state specific.

## Data

### Primary source: Metsäkeskus Metsänkäyttöilmoitukset (MKI)

**URL:** `https://avoin.metsakeskus.fi/aineistot/Metsankayttoilmoitukset/Maakunta/`  
**Format:** OGC GeoPackage 1.2 (vector polygons, EPSG:3067)  
**Update:** 2× per day  
**License:** CC BY 4.0  
**Timespan:** 1997–present (~30 years)  
**Scale:** ~4 TB nationwide (region-level GPKG files), millions of records

Each MKI polygon contains in the **same row**:

| Column | Notes |
|---|---|
| `cuttingpurpose` | INT code: harvest type label |
| `cuttingrealizationpractice` | Method (thinning, clearcut, etc.) |
| `maingroup`, `subgroup` | Land class |
| `fertilityclass` | Site fertility |
| `soiltype` | Soil type |
| `meanage` | Stand age at declaration |
| `meandiameter` | Mean DBH |
| `declarationdevelopmentclass` | Development class |
| `declarationmaintreespecies` | Main species |
| `area` | Hectares |
| `completionyear` | Year operation completed |

### Enrichment: Hila grid (Metsäkeskus)

**URL:** `https://avoin.metsakeskus.fi/aineistot/Hila/Maakunta/`  
**Format:** OGC GeoPackage, 16m × 16m grid cells  
**License:** CC BY 4.0

Rich per-cell attributes: species-specific volume, basal area, stem count, mean diameter,
mean height, age, development class, fertility, soil type, laser height/density metrics.

Spatial join MKI polygons → Hila cells to get **pre-operation stand state** that the MKI
table doesn't fully capture (e.g., per-species BA and stem counts).

### Training label extraction

For each MKI polygon where `cuttingpurpose` indicates harvest (thinning or clearcut):

```
# Step 1: Spatial join — which Hila cells fall inside the MKI polygon?
# Step 2: Aggregate Hila attributes for those cells → pre-op stand state
# Step 3: Estimate pre-op total volume from Hila per-species volume × area
# Step 4: Estimate post-op volume from removal fraction back-calculation
# Step 5: The label = actual removal fraction = (pre_vol − post_vol) / pre_vol
```

If post-operation Hila grid is available (time series planned for 2026), skip step 4 and use
direct measurement.

### Scope

Start with **Etelä-Pohjanmaa region** (MKI region-level GPKG, ~1–10 GB). This is the user's
own forest region and the model can be specific to local owner behavior patterns.

Later: expand to all regions for a national model.

## Model

### Type

**XGBoost regressor** (CPU only, fast training, excellent for tabular data).

Alternatives: LightGBM (slightly faster), CatBoost (better with categorical features like
`fertilityclass`). Start with XGBoost, compare if needed.

### Input features (~20 features)

```
Stand attributes:
  species                        (categorical: pine|spruce|birch|...)
  site_class                     (categorical: herb-rich|mesic|sub-xeric|xeric)
  soil_type                      (categorical: mineral|peatland)
  development_class              (categorical)
  age_years                      (numeric)
  mean_diameter_cm               (numeric)
  mean_height_m                  (numeric)
  basal_area_m2_per_ha           (numeric)
  volume_m3_per_ha               (numeric)
  stem_count_per_ha              (numeric)
  previous_operation_type        (categorical: none|first_thinning|thinning|...)
  years_since_previous_op        (numeric, 999 if none)

Site context:
  temperature_sum_dd             (numeric, from coordinates + Luke raster)
  latitude                       (numeric, proxy for growing season)
  is_peatland                    (binary)

Operation:
  operation_type                 (categorical: first_thinning|thinning|clear_cut)
```

### Output

```
removal_fraction: float ∈ [0, 1]
```

Single continuous value. The model predicts the fraction of volume the owner removes.

### Training

```
Framework:  scikit-learn or xgboost (Python)
Size:       ~50K–500K training examples (Etelä-Pohjanmaa)
Hardware:   CPU (laptop) — 30 seconds to 2 minutes
Validation: Hold-out by year (train on pre-2020, test on 2020+)
Metrics:    RMSE, R², and per-species×site bias analysis
```

### Stochasticity

Real removal fractions have spread (two owners might remove 30% vs 45% from similar stands).
The model can output the distribution parameters:

**Option A — Point prediction:** predict mean removal fraction. Add optional ±σ noise for
scenario analysis.

**Option B — Quantile regression:** predict multiple quantiles (e.g., p10, p50, p90) for
pessimistic/expected/optimistic scenarios. XGBoost supports this natively.

Start with Option A, add Option B if scenario planning is desired.

## Data Model Changes

### StandData expansion

Add to `SimStand` and `StandData`:

```typescript
/** Coordinates for spatial feature lookup (ETRS-TM35FIN) */
coordX?: number;           // Easting (m) in EPSG:3067
coordY?: number;           // Northing (m) in EPSG:3067

/** Temperature sum (degree-days, growing season threshold +5°C) */
temperatureSum?: number;   // e.g., 1000–1400 dd for Finland

/** Micro-site attributes from Hila grid */
soilDepthClass?: string;   // shallow|medium|deep (from Hila laser/soil data)
stoniness?: number;        // 0–1 fraction (from Hila)
```

### DB schema additions

```sql
ALTER TABLE compartments ADD COLUMN coord_x NUMERIC;
ALTER TABLE compartments ADD COLUMN coord_y NUMERIC;
ALTER TABLE compartments ADD COLUMN temperature_sum INTEGER;
```

### Data population

On CSV import, if stand polygon coordinates are available:
1. Compute centroid → coord_x, coord_y
2. Look up temperature sum from Luke raster (WMS/WCS) or static lookup table
3. Spatial join with Hila grid for micro-site attributes

## Integration

### schedule.ts changes

In `spawnOperations()`, replace the clamping logic:

```typescript
// BEFORE (current):
const [optMin, optMax] = getOptimalAge(s.species, s.siteClass);
// ... BA headroom math ...
removalFraction = Math.min(THINNING_MAX_REMOVAL, Math.max(THINNING_MIN_REMOVAL, removalFraction));

// AFTER (ML):
const removalFraction = await predictRemovalFraction({
  species: s.species,
  site_class: s.siteClass,
  soil_type: s.soilType,
  development_class: s.developmentClass,
  age_years: s.ageYears,
  mean_diameter_cm: s.meanDiameter,
  mean_height_m: s.meanHeight,
  basal_area_m2_per_ha: s.basalArea,
  volume_m3_per_ha: s.volumeM3 / s.areaHa,
  stem_count_per_ha: s.stemCount,
  operation_type: "thinning",
  temperature_sum_dd: s.temperatureSum,
  latitude: s.coordY,
  is_peatland: s.soilType === "peatland",
});
```

### Fallback

Keep the current rule-based clamping as a fallback when:
- Model not loaded (first run)
- Stand missing coordinates/temperature_sum (imported before expansion)
- Model confidence below threshold

```typescript
if (modelLoaded && s.temperatureSum && s.coordX) {
  removalFraction = predictModel(features);
} else {
  // Current rule-based logic as fallback
  removalFraction = clamp(headroomFraction, THINNING_MIN_REMOVAL, THINNING_MAX_REMOVAL);
}
```

### Model deployment

**Option A — Edge Function (recommended):**
Export XGBoost model to JSON. Load in a Deno/TypeScript edge function. Evaluate tree-by-tree.
~50 function calls per plan generation. Supabase free: 500K invocations/month = ~10K plans.

**Option B — Client-side:**
Ship JSON to browser. Evaluate in Web Worker. Zero server cost. Small model (< 100 KB JSON).

**Option C — Postgres function:**
Compile trees to nested `CASE WHEN` in a Postgres function. Run in-DB, zero network latency.

Start with Option B (simplest), migrate to A if privacy/edge concerns arise.

## Phases

### Phase 1: Data Pipeline (Week 1)
- [ ] Download Etelä-Pohjanmaa MKI region GPKG
- [ ] Download Etelä-Pohjanmaa Hila region GPKG
- [ ] Build spatial join script (Python, geopandas)
- [ ] Extract training pairs: pre-op stand state → removal fraction
- [ ] Validate label quality: check for outliers, inconsistent labels, known-good stands
- [ ] Expand ForestChat data model: add coord_x, coord_y, temperature_sum to compartments table and types

### Phase 2: Model Training (Week 2)
- [ ] Split data: train (pre-2020), validation (2021–2023), test (2024+)
- [ ] Train XGBoost regressor with hyperparameter tuning (grid search on CPU)
- [ ] Evaluate: RMSE, R², per-species×site bias, residual plots
- [ ] Generate feature importance report — verify domain plausibility
- [ ] Export model to JSON for TypeScript consumption
- [ ] Write model evaluation doc: what it learned, where it disagrees with Tapio

### Phase 3: Integration (Week 2–3)
- [ ] Add model inference to ForestChat (TypeScript tree-evaluator)
- [ ] Integrate into `spawnOperations()` with fallback path
- [ ] Add model metadata to plan output (version, confidence, features used)
- [ ] Write tests: compare simulation output before/after ML
- [ ] Benchmark: plans generated with ML vs rule-based on Etelä-Pohjanmaa forest

### Phase 4: Validation (Week 3)
- [ ] Run on user's Hokkala forest — compare removal fractions against rules
- [ ] Manual review of 20 random stand predictions — do the numbers make sense?
- [ ] Test on empty/unusual stands (age=0, missing data) — does fallback work?
- [ ] Performance: verify plan generation still under 5 seconds

## Success Criteria

| Metric | Target |
|---|---|
| Model RMSE | < 8 percentage points (removal fraction 0–1) |
| Species×site bias | < 5 pp for any category with > 50 samples |
| Plan generation time | No regression vs rule-based (< 5s for 200 stands) |
| Fallback coverage | 100% — every stand gets a removal fraction, ML or rule |

## Risks

1. **MKI labels don't match ForestChat operation types.** The `cuttingpurpose` codes may not
   cleanly map to ForestChat's `first_thinning` vs `thinning` distinction. Mitigation: inspect
   the codebook, map manually, flag unmapable codes.

2. **Pre-op state signal is noisy.** The MKI polygon attributes are self-reported and the
   Hila grid is an estimate, not measurement. Mitigation: filter by declaration state
   ("50" = approved only), check for physically impossible values.

3. **Owner behavior ≠ optimal forestry.** Some real owners delay thinning or remove too
   little — the model will learn this. Mitigation: optional "adherence to Tapio" parameter
   that blends ML prediction with rule-based output.

4. **Model stale over time.** Forest economics and practices change. Mitigation: version
   model, retrain annually with new MKI data, log model version in plan metadata.
