# ML-GROW-01: Stand-Specific Growth Multiplier

**Status:** Draft  
**Created:** 2026-06-20  
**Category:** Machine Learning / Simulation Engine  
**Tier:** 1 — Ship This Month  
**Depends on:** ML-REMF-01 (shared data model expansion, shared data pipeline)

## Problem

ForestChat's growth model uses a single `growthMultiplier` scalar applied uniformly to
every stand. The only granularity is municipality-level (from `resolveMunicipalityFromPropertyId()`,
stored on `forests.growth_multiplier`).

**In reality, volume growth varies 20–40% between stands on the same site class** due to:

| Factor | Effect | Current model? |
|---|---|---|
| Microclimate (frost pockets, aspect) | ±10–20% | ❌ |
| Soil depth & stoniness | ±10–15% | ❌ |
| Drainage history & ditch condition | ±10–30% | ❌ (only peatland boolean) |
| Genetic stock / provenance | ±5–15% | ❌ |
| Past management (fertilization, drainage) | ±20–50% | ❌ |
| Disease/pest history | variable | ❌ |
| Temperature sum (latitudinal gradient) | ±15% across Finland | ❌ (only via municipality-wide gm) |

**The ad-hoc symptom:** You've been tuning minimum increment floors, old-age asymptotes,
and convergence parameters for months (see `references/simulation-engine.md` and memory).
These are compensations for a growth model that's too rigid — a per-stand multiplier
calibrated from real data would reduce the need for these manual corrections.

**The opportunity:** Tapio gives the *biological potential* (H100 = site index curves).
Real growth is a fraction of that potential. The ML model learns that fraction per stand.

## Data

### Primary source: Luke MVMI multi-temporal rasters

**URL:** `https://kartta.luke.fi/geoserver/MVMI/wms` (WMS), also via Paituli FTP  
**Format:** GeoTIFF, 16m or 20m resolution, EPSG:3067  
**License:** CC BY 4.0  
**Available years:** 2006, 2009, 2011, 2013, 2015, 2017, **2023**  
**Key bands:** species-specific volume (pine/spruce/birch/other), biomass, age, height, diameter, basal area, canopy cover

### Training label construction

For each grid cell present in two MVMI rasters (e.g., 2017 and 2023):

```
# Step 1: Compute observed growth
delta_vol_observed = volume_2023 − volume_2017                 # m³/ha over 6 years
annual_growth_observed = delta_vol_observed / 6                  # m³/ha/yr

# Step 2: Compute Tapio-predicted growth
annual_growth_tapio = tapioGrowth(species, site_class, age_2017, stems_2017)

# Step 3: The label = ratio of observed to Tapio-predicted
growth_multiplier = annual_growth_observed / annual_growth_tapio

# Step 4: Filter noise
#  - Exclude cells with operations (thinning/clearcut detected by volume drop)
#  - Exclude cells where species changed (regeneration)
#  - Exclude cells with < 1 m³/ha (below measurement noise)
#  - Exclude outliers (> 3σ)
```

This gives millions of (stand_state, growth_multiplier) pairs across Finland.

### Alternative: Hila grid time series

If Metsäkeskus releases the promised 2026 time-series Hila, use that instead — it has
richer per-cell attributes (laser metrics, soil depth, etc.). The data pipeline should
support both sources.

### Enrichment features

Join each cell with:

| Layer | Source | Features |
|---|---|---|
| Temperature sum raster | Luke / FMI | `temp_sum_dd` (annual degree-days) |
| Soil depth | GTK (Geological Survey) | `soil_depth_cm`, `stoniness_class` |
| Ditch network | Metsäkeskus / Luke | `distance_to_ditch_m`, `ditch_age_years` |
| DEM / aspect | Maanmittauslaitos (NLS) | `slope_deg`, `aspect_deg`, `elevation_m` |

### Scope

Start with **MVMI 2017 → 2023** (most recent 6-year window, highest quality).  
Focus on **Etelä-Pohjanmaa** then expand.

## Model

### Type

**XGBoost regressor** (same framework as ML-REMF-01 — shared tooling).

### Input features (~25 features, includes expanded stand data)

```
Stand state (at start of growth period):
  species                        (categorical)
  site_class                     (categorical: herb-rich|mesic|sub-xeric|xeric)
  soil_type                      (categorical: mineral|peatland)
  age_years                      (numeric)
  mean_diameter_cm               (numeric)
  mean_height_m                  (numeric)
  basal_area_m2_per_ha           (numeric) 
  volume_m3_per_ha               (numeric)
  stem_count_per_ha              (numeric)
  tapio_annual_growth_predicted  (numeric — what Tapio says it should grow)

Site & climate:
  temperature_sum_dd             (numeric, annual, from Luke/FMI raster)
  latitude                       (numeric, EPSG:3067 northing)
  soil_depth_cm                  (numeric, from GTK)
  stoniness_class                (categorical: none|low|moderate|high)
  slope_degrees                  (numeric, from DEM)
  aspect_category                (categorical: N|S|E|W|flat)
  elevation_m                    (numeric)
  is_peatland                    (binary)

Management history (from MVMI/MKI time series):
  years_since_last_thinning      (numeric, 999 if none)
  years_since_ditching           (numeric, 999 if none)
  development_class_before       (categorical)
```

### Output

```
growth_multiplier: float ∈ [0.3, 2.0]
```

Multiplier applied to Tapio-predicted growth. Value 1.0 = exactly Tapio. < 1.0 = below
potential (constrained site). > 1.0 = above Tapio (fertilized, exceptional genetics,
or Tapio reference curves are conservative).

The multiplier is applied as `growth = tapioGrowth × gm` in `growStand()`, which is already
how the municipality-level `growthMultiplier` works — the model just makes it per-stand
instead of per-forest.

### Training

```
Framework:  scikit-learn or xgboost
Size:       ~1M–5M grid cells (Finland-wide filtered)
Hardware:   CPU (laptop or cloud VM with 16 GB RAM)
Time:       ~2–5 minutes with 5M rows
Validation: Spatial hold-out (train on 90% of cells, test on 10% geographically separated)
Metrics:    RMSE (m³/ha/yr), MAPE, R²
            Per-species×site bias analysis
```

### Constraints

**Monotonicity constraint:** The model output should be at most 2.0× Tapio for any stand.
A multiplier above 2.0 suggests data noise or an edge case, not real biology. Apply a
post-prediction clamp `[0.3, 2.0]`.

**Variance reporting:** The model should also report its confidence (prediction variance
or quantile range) so the simulation can flag uncertain stands.

## Data Model Changes

### Shared with ML-REMF-01

Both plans need the same expansions — they share one set of changes:

```typescript
// Add to StandData and SimStand:
coordX?: number;           // Easting (EPSG:3067)
coordY?: number;           // Northing (EPSG:3067)
temperatureSum?: number;   // Annual degree-days

// Additional micro-site attributes:
soilDepthCm?: number;      // From GTK soil depth raster
stoniness?: string;        // none|low|moderate|high
slopeDegrees?: number;     // From DEM
elevationM?: number;       // From DEM
```

### DB schema additions (combined)

```sql
ALTER TABLE compartments ADD COLUMN coord_x NUMERIC;          -- EPSG:3067 Easting
ALTER TABLE compartments ADD COLUMN coord_y NUMERIC;          -- EPSG:3067 Northing
ALTER TABLE compartments ADD COLUMN temperature_sum INTEGER;  -- Degree-days
ALTER TABLE compartments ADD COLUMN soil_depth_cm NUMERIC;    -- cm
ALTER TABLE compartments ADD COLUMN stoniness TEXT;           -- none|low|moderate|high
ALTER TABLE compartments ADD COLUMN slope_degrees NUMERIC;
ALTER TABLE compartments ADD COLUMN elevation_m NUMERIC;
```

### Data population strategy

On CSV import:
1. Compute polygon centroid → `coord_x`, `coord_y`
2. Look up `temperature_sum` from static lookup table (lat→dd mapping for Finland) or raster
3. For micro-site attributes (soil_depth, stoniness, slope, elevation): these are optional.
   Populate from spatial joins with GTK/DEM rasters if available. If not, the ML model uses
   the features that ARE available and defaults others.

### Fallback for stands without expanded data

```typescript
// If no spatial enrichment available, model degrades gracefully:
// - temperature_sum: estimated from latitude
// - soil_depth_cm: null → model uses mean
// - stoniness: null → model uses mean
// The model still produces a prediction, just with wider confidence interval.
```

## Integration

### growStand() changes

Currently in `stand-simulator.ts`:

```typescript
export function growStand(st: GrowableStand, growthMultiplier = 1.0): number {
  // ... Tapio growth computation ...
  const gm = growthMultiplier;
  const absGrowthH = (currTableH - prevTableH) * gm;
  const absGrowthD = (currTableD - prevTableD) * gm;
  // ...
}
```

After ML integration:

```typescript
export function growStand(st: GrowableStand, baseGrowthMultiplier = 1.0): number {
  // Resolve per-stand multiplier
  const standGm = st.mlGrowthMultiplier 
    ?? predictGrowthMultiplier(st)  // ML model call
    ?? baseGrowthMultiplier;        // Fallback to forest-level gm
  
  const gm = standGm;
  // ... rest unchanged ...
}
```

The per-stand multiplier is computed once at initialization (in `runScheduleEngine()`)
and stored on the `SimStand`. It doesn't change during simulation — it's the stand's
intrinsic growth capacity.

### Interaction with municipality-level gm

The municipality-level `growthMultiplier` remains as an **override**. If the forest has a
user-specified `growth_multiplier`, it takes precedence over ML prediction. This lets users
adjust growth for climate scenarios or experimental purposes.

```
perStandGm = stand.mlGrowthMultiplier ?? forest.growth_multiplier ?? 1.0
```

### Model deployment

Same as ML-REMF-01 (shared inference infrastructure):

**Option B — Client-side (recommended, shared):** Both models ship as JSON to the browser.
One inference call during stand initialization. Zero server cost.

### Cache

Per-stand multiplier is computed once and cached on `SimStand`. Multiple years of simulation
reuse the same value.

## Phases

### Phase 1: Data Pipeline (Week 1, shared with ML-REMF-01)
- [ ] Download MVMI 2017 and 2023 rasters for Etelä-Pohjanmaa (via Paituli or Luke WCS)
- [ ] Download GTK soil depth raster, NLS DEM (Maanmittauslaitos 10m DEM)
- [ ] Download temperature sum raster (Luke or FMI)
- [ ] Build extraction pipeline: for each MVMI cell, extract all features
- [ ] Compute Tapio-predicted growth for each cell
- [ ] Compute observed growth (2023 − 2017)
- [ ] Filter: exclude cells with operations, species change, noise
- [ ] Build training set: (features, growth_multiplier label)
- [ ] Expand ForestChat DB schema + types (shared with ML-REMF-01)

### Phase 2: Model Training (Week 2)
- [ ] Split data: spatial hold-out (geographic separation, not random)
- [ ] Train XGBoost regressor
- [ ] Evaluate: RMSE of predicted annual growth (m³/ha/yr), R², per-species×site bias
- [ ] Feature importance: do soil depth, temperature sum, and aspect matter as expected?
- [ ] Compare to baseline: constant growthMultiplier = 1.0 (current behavior)
- [ ] Export model to JSON
- [ ] Write evaluation report

### Phase 3: Integration (Week 2–3)
- [ ] Add model inference to ForestChat (shared tree-evaluator with ML-REMF-01)
- [ ] Extend SimStand with `mlGrowthMultiplier` field
- [ ] Integrate into `runScheduleEngine()` initialization
- [ ] Integrate into `growStand()` with fallback chain
- [ ] Write tests: Tapio baseline vs ML-predicted growth on sample stands
- [ ] Benchmark: simulation runtime unchanged (< 1ms per inference)

### Phase 4: Validation (Week 3)
- [ ] Run on user's Hokkala forest — per-stand multipliers
- [ ] Manual review: do the multipliers make sense? (frost pockets lower, ditched peatland higher)
- [ ] Compare 50-year simulation: rule-based growth vs ML growth — how much does total volume differ?
- [ ] Cross-validate: pick 10 known stands, predict growth, compare to actual MVMI growth if available

## Success Criteria

| Metric | Target |
|---|---|
| Growth RMSE | < 1.5 m³/ha/yr (current Tapio-only baseline ~2–3 m³/ha/yr) |
| R² | > 0.3 (growth is inherently noisy; R² > 0.5 is exceptional for forestry) |
| Per-species bias | < 0.5 m³/ha/yr for any species with > 1000 samples |
| Inference time | < 1ms per stand |
| Fallback coverage | 100% — every stand gets a gm (ML, forest-level, or 1.0) |

## Risks

1. **MVMI resolution (16m) is coarser than individual stands.** A single MVMI cell may
   cover parts of two stands. Mitigation: use the MVMI value for the dominant species,
   or aggregate to stand polygon using zonal statistics.

2. **Operation detection is imperfect.** We filter out cells with operations by detecting
   volume drops, but light thinnings may be missed. Mitigation: cross-reference with
   MKI polygons (spatial intersection) to flag cells with known operations.

3. **Growth in old stands is poorly measured.** MVMI saturates for mature forests — the
   signal is weak for stands > 80 years. Mitigation: weight training samples by age
   class, report separate metrics for young/mature/old.

4. **Model doesn't capture climate change trends.** Growing conditions are shifting in
   Finland (lengthening growing season). A model trained on 2017–2023 data won't know
   about 2050 conditions. Mitigation: parameterize temperature sum as input feature
   so users can adjust it for scenario planning; retrain as new MVMI years release.

5. **Tapio baseline itself may be wrong for some species×site.** If Tapio systematically
   overestimates pine growth on sub-xeric sites, the ML multiplier will compensate but
   the underlying shape of the growth curve is still Tapio's. Mitigation: this is
   acceptable — Tapio defines the curve shape, ML calibrates the level.

## Synergies with ML-REMF-01

| Aspect | Shared |
|---|---|
| Data model expansion | Same new columns |
| Inference infrastructure | Same JSON tree-evaluator |
| Deployment | Same edge function or client-side pattern |
| Data pipeline (partial) | Overlapping spatial features (coordinates, temp sum) |
| Fallback pattern | Same `modelLoaded && hasEnrichment → ML else → rule` |

Train and deploy together as a single model bundle.
