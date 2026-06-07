// src/lib/ai/chart-engine.ts
// Phase 4b: Deterministic chart data recomputation from declarative query configs.
// Phase 4c: Cross-source queries — merge results from multiple tables on a common key.
//
// Charts should be specified, not computed at AI-time. The AI describes what
// data to source and how to transform it — this engine executes that spec
// deterministically via the authenticated Supabase client (RLS applies).

import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Types ───────────────────────────────────────────────────────────

export interface ChartQueryConfig {
  source: "operations" | "compartments" | "compartment_species" | "plan_metadata";
  join?: {
    table: "compartments";
    on: "compartment_id";
    fields: string[];
  };
  aggregate: Array<{ group_by: string }>;
  values: Array<{
    field: string;
    as: string;
    fn: "sum" | "count" | "avg" | "min" | "max";
    /** Multiply result by this factor after aggregation (e.g. -1 for costs). */
    multiply?: number;
    /** When true, convert this value from period sums to cumulative running
     *  totals after aggregation. Only works on sorted data — the cumulative
     *  direction follows the sort order (typically year ascending). */
    cumulative?: boolean;
    /** Apply a per-row operation BEFORE aggregation (e.g. "divide" volume by area). */
    op?: "multiply" | "divide";
    /** Second column for the per-row op. Supports dot-prefix notation (e.g. "comp.area_ha"). */
    operand?: string;
  }>;
  filters?: Record<string, unknown>;
  sort?: { by: string; dir?: "asc" | "desc" };
  limit?: number;
}

/** Cross-source query: runs N sub-queries independently, merges on a common key. */
export interface CrossQueryConfig {
  source: "cross";
  merge_on: string;
  merge_strategy?: "outer" | "inner";  // default: "outer"
  queries: SubQueryConfig[];
  sort?: { by: string; dir?: "asc" | "desc" };
}

/** A sub-query within a cross query. Same fields as ChartQueryConfig but
 *  without top-level sort (sorting happens after merge). */
export interface SubQueryConfig {
  source: "operations" | "compartments" | "compartment_species";
  join?: {
    table: "compartments";
    on: "compartment_id";
    fields: string[];
  };
  aggregate: Array<{ group_by: string }>;
  values: Array<{
    field: string;
    as: string;
    fn: "sum" | "count" | "avg" | "min" | "max";
    multiply?: number;
    cumulative?: boolean;
    op?: "multiply" | "divide";
    operand?: string;
  }>;
  filters?: Record<string, unknown>;
  limit?: number;
  /** If true, the sub-query produces a single row that broadcasts to ALL
   *  merge keys. Use for constants like total annual growth. */
  broadcast?: boolean;
}

export type AnyQueryConfig = ChartQueryConfig | CrossQueryConfig;

export interface ChartEngineResult {
  data: Record<string, unknown>[];
  computedAt: string;
}

// ─── Computed Fields ─────────────────────────────────────────────────

interface ComputedFieldDef {
  /** Which raw DB columns must be fetched to compute this field */
  sources: string[];
  /** Which table each source belongs to ("source" | joined table alias) */
  sourceTables: Record<string, "source" | "compartments">;
  /** Compute the synthetic value from a raw row */
  compute: (row: Record<string, unknown>) => number;
}

// Luke VMI13 + Tapio growth rates (m³/ha/y) for Väli-Suomi (Ähtäri zone).
// Source: build_plan_v3_fixed.py — Luke VMI13 (2019–2023) published ranges.
//
// These are forest-level AVERAGES. Per-stand multipliers (species, age,
// density) redistribute growth between compartments while preserving the
// aggregate total. Each multiplier self-normalizes so the area-weighted
// mean across the forest is ~1.0 — no net change to total growth.
const GROWTH_MINERAL: Record<string, number> = {
  "herb-rich heath": 7.0,  // OMT — VMI range 6.0–8.0
  mesic: 5.5,              // MT  — VMI range 4.5–6.5
  "sub-xeric": 3.25,       // VT  — VMI range 2.5–4.0
  xeric: 1.3,              // CT  — VMI range 0.5–1.5
};
const GROWTH_PEATLAND: Record<string, number> = {
  "herb-rich heath": 6.25, // OMT peatland — VMI range 5.0–7.5
  mesic: 5.5,              // MT peatland — similar to mineral
  "sub-xeric": 3.25,       // VT peatland — VMI range 2.5–4.0
  xeric: 1.5,              // CT peatland — VMI range 0.5–2.0
};
const GROWTH_DEFAULT = 3.0; // fallback for unknown site/soil combos

// Expected basal area (m²/ha) by site type — used for density factor.
// Calibrated to actual DB means for this forest (161 compartments).
const EXPECTED_BA: Record<string, number> = {
  "herb-rich heath": 23,
  mesic: 20,
  "sub-xeric": 17,
  xeric: 14,
};

// ─── Multiplier functions ───────────────────────────────────────────

/**
 * Species factor: adjusts base growth for tree species.
 *
 * General principle: spruce thrives on fertile sites, pine on poor sites,
 * birch grows slower than conifers on average.
 *
 *   Spruce on herb-rich:      1.18  (+18% — optimal conditions)
 *   Spruce on mesic:          1.08  (+8% — good conditions)
 *   Spruce on sub-xeric/xeric:0.95  (−5% — struggles on dry/poor soil)
 *   Pine on mesic/herb-rich:  0.95  (−5% — outcompeted by spruce)
 *   Pine on sub-xeric/xeric:  1.05  (+5% — drought-tolerant, dominates)
 *   Birch (any site):          0.88–0.92 (−8-12% — naturally slower)
 *   Others (larch, alder):     1.0   (neutral)
 */
function speciesFactor(species: string, siteType: string): number {
  const isHerbRich = siteType === "herb-rich heath";
  const isGood = isHerbRich || siteType === "mesic";
  const sp = (species ?? "").toLowerCase();
  const raw: Record<string, number> = {
    pine: isGood ? 0.95 : 1.05,
    spruce: isHerbRich ? 1.24 : isGood ? 1.08 : 0.95,
    silver_birch: isHerbRich ? 0.95 : 0.92,
    downy_birch: isHerbRich ? 0.93 : 0.90,
    larch: 1.02,
    grey_alder: 0.88,
  };
  return (raw[sp] ?? 1.0);
}

/**
 * Age factor: growth curve over a stand's lifetime.
 *
 * Young stands haven't reached full canopy closure yet; very old stands
 * slow down as trees senesce. Peak growth occurs at 40–60 years.
 *
 * Scaled so peak ≈ 0.52 — combined with species×density, the full
 * multiplier stack targets Tapio yield tables (not VMI13 average, which
 * already bakes in these effects).
 *
 *   Age   5:  0.25  — seedling, canopy forming
 *   Age  20:  0.40  — sapling, rapid growth
 *   Age  40:  0.50  — approaching peak
 *   Age  60:  0.48  — peak, full canopy
 *   Age  80:  0.40  — mature, slowing
 *   Age 100:  0.30  — over-mature
 *   Age 120:  0.20  — senescent
 */
function ageFactor(ageYears: number | null): number {
  if (ageYears == null) return 0.48;
  const a = ageYears;
  let raw: number;
  if (a < 20)       raw = 0.28 + 0.010 * a;           // 0.28 → 0.48 (dampened young ramp)
  else if (a < 55)  raw = 0.50 + 0.001 * (a - 20);    // 0.50 → 0.535, gentle rise
  else if (a < 85)  raw = 0.535 - 0.005 * (a - 55);   // 0.535 → 0.385
  else              raw = 0.385 - 0.004 * (a - 85);    // 0.385 → 0.245
  return raw;
}

/**
 * Density factor: stocking level relative to site-type expectation.
 *
 * Compares actual basal_area to the expected BA for the site type.
 * Understocked stands don't use full site potential; overstocked stands
 * experience competition that reduces individual tree growth.
 *
 * Scaled so fully-stocked stands (75-130%) yield ~0.85 — combined with
 * species×age, targets Tapio rather than raw VMI13.
 *
 *   BA = 0  (seedling):  0.45  — growing, just not measured yet
 *   BA = 0  (open_area): 0.20  — genuinely unstocked
 *   <50% of expected:    0.55  — understocked
 *   50-75%:              0.70  — below normal
 *   75-130%:             0.85  — NORMAL, fully stocked
 *   130-150%:            0.78  — dense, slight competition
 *   >150%:               0.65  — overstocked, significant competition
 */
function densityFactor(
  basalArea: number | null,
  siteType: string,
  developmentClass: string | null
): number {
  if (basalArea == null || basalArea === 0) {
    if (developmentClass && developmentClass.includes("seedling")) return 0.45;
    if (developmentClass === "open_area") return 0.20;
    return 0.40;
  }
  const expected = EXPECTED_BA[siteType] ?? 20;
  const density = basalArea / expected;
  let raw: number;
  if (density < 0.5)       raw = 0.55;
  else if (density < 0.75) raw = 0.70;
  else if (density < 1.3)  raw = 0.85;
  else if (density < 1.5)  raw = 0.78;
  else                     raw = 0.65;
  return raw;
}

/**
 * Compute per-hectare annual growth (m³/ha/y) for a single compartment.
 *
 * Starts from the site-type + soil-type VMI13 base rate, then applies
 * species, age, and density multipliers. Each multiplier is a raw factor
 * (no forest-specific normalization). An optional growthMultiplier applies
 * location-specific scaling (0.55 Lappi → 1.10 Etelä-Suomi).
 *
 * Used by the growth_m3_per_ha computed field — no DB column needed.
 */

/** Map Finnish/classified site types to the English keys used by
 *  GROWTH_MINERAL, GROWTH_PEATLAND, EXPECTED_BA, and MAX_YIELD.
 *  classifySite() may return Finnish terms (tuore, kuivahko, etc.)
 *  from user-supplied or 3rd-party data. */
function normalizeSiteType(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes("lehto") || s.includes("lehtomainen") || s.includes("ruoho")) return "herb-rich heath";
  if (s.includes("tuore") || s.includes("mustikka")) return "mesic";
  if (s.includes("kuivahko") || s.includes("puolukka")) return "sub-xeric";
  if (s.includes("kuiva") || s.includes("karu") || s.includes("varpu")) return "xeric";
  // Already English — pass through
  if (s === "mesic" || s === "sub-xeric" || s === "xeric" || s === "herb-rich heath" || s.includes("herb-rich")) return s;
  return s; // unknown, pass through to GROWTH_DEFAULT fallback
}

export function getGrowthRate(
  siteType: string,
  soilType: string,
  species: string,
  ageYears: number | null,
  basalArea: number | null,
  developmentClass: string | null,
  growthMultiplier = 1.0,
  /** Current standing volume (m³/ha). When provided, growth tapers as
   *  the stand approaches the site's carrying capacity. */
  currentVolumeM3PerHa?: number,
): number {
  const engSite = normalizeSiteType(siteType || "");
  const table = soilType === "peatland" ? GROWTH_PEATLAND : GROWTH_MINERAL;
  const base = table[engSite] ?? GROWTH_DEFAULT;
  const sf = speciesFactor(species, engSite);
  const af = ageFactor(ageYears);
  const df = densityFactor(basalArea, engSite, developmentClass);
  let growth = base * sf * af * df * growthMultiplier;

  // ── Carrying-capacity cap (Option C) ──
  // Growth tapers linearly when standing volume exceeds 70% of the
  // site's maximum yield. At maxYield, growth → 0.
  // maxYield is scaled by growthMultiplier so Lappi (0.55) gets
  // proportionally lower carrying capacity.
  if (currentVolumeM3PerHa != null && currentVolumeM3PerHa > 0) {
    const MAX_YIELD: Record<string, number> = {
      "herb-rich heath": 380,
      mesic: 220,
      "sub-xeric": 140,
      xeric: 80,
    };
    const maxYield = (MAX_YIELD[engSite] ?? 180) * growthMultiplier;
    const threshold = 0.75 * maxYield;
    if (currentVolumeM3PerHa > threshold) {
      const excess = (currentVolumeM3PerHa - threshold) / (maxYield - threshold);
      const capFactor = Math.max(0, 1 - excess);
      growth *= capFactor;
    }
  }

  return growth;
}

const COMPUTED_FIELDS: Record<string, ComputedFieldDef> = {
  removal_m3: {
    sources: ["volume_m3", "removal_pct"],
    sourceTables: {
      volume_m3: "compartments",
      removal_pct: "source",
    },
    compute: (row) =>
      ((row.volume_m3 as number) ?? 0) * ((row.removal_pct as number) ?? 0) / 100,
  },
  net_cashflow: {
    sources: ["income_eur", "cost_eur"],
    sourceTables: {
      income_eur: "source",
      cost_eur: "source",
    },
    compute: (row) =>
      ((row.income_eur as number) ?? 0) - ((row.cost_eur as number) ?? 0),
  },
  // Per-hectare annual growth (m³/ha/y) computed from compartment attributes
  // via Luke VMI13 base rates × species × age × density multipliers.
  // No DB column needed — computed at query time from: site_type, soil_type,
  // main_species, age_years, basal_area, development_class.
  growth_m3_per_ha: {
    sources: [
      "site_type", "soil_type", "main_species",
      "age_years", "basal_area", "development_class",
    ],
    sourceTables: {
      site_type: "source",
      soil_type: "source",
      main_species: "source",
      age_years: "source",
      basal_area: "source",
      development_class: "source",
    },
    compute: (row) =>
      getGrowthRate(
        (row.site_type as string) ?? "",
        (row.soil_type as string) ?? "",
        (row.main_species as string) ?? "",
        row.age_years as number | null,
        row.basal_area as number | null,
        row.development_class as string | null
      ),
  },
  // Total annual growth per compartment = growth_m3_per_ha × area_ha.
  // Depends on growth_m3_per_ha (computed first via chaining).
  growth_m3_total: {
    sources: ["growth_m3_per_ha", "area_ha"],
    sourceTables: {
      growth_m3_per_ha: "source",
      area_ha: "source",
    },
    compute: (row) =>
      ((row.growth_m3_per_ha as number) ?? 0) * ((row.area_ha as number) ?? 0),
  },
  // Volume per hectare (m³/ha): total standing volume divided by area.
  // Available on compartments source natively; for operations source, the
  // AI must include volume_m3 and area_ha in the join fields.
  volume_per_ha: {
    sources: ["volume_m3", "area_ha"],
    sourceTables: {
      volume_m3: "source",
      area_ha: "source",
    },
    compute: (row) => {
      const vol = (row.volume_m3 as number) ?? 0;
      const area = (row.area_ha as number) ?? 0;
      return area > 0 ? vol / area : 0;
    },
  },
  // Net volume change per operation: growth − removal. Positive = net growth,
  // negative = net removal. Designed for waterfall charts (growth up, removal down).
  // Depends on growth_m3_per_ha (computed first via chaining).
  net_volume_change: {
    sources: ["growth_m3_per_ha", "area_ha", "volume_m3", "removal_pct"],
    sourceTables: {
      growth_m3_per_ha: "compartments",
      area_ha: "compartments",
      volume_m3: "compartments",
      removal_pct: "source",
    },
    compute: (row) => {
      const growth = ((row.growth_m3_per_ha as number) ?? 0) * ((row.area_ha as number) ?? 0);
      const removal = ((row.volume_m3 as number) ?? 0) * ((row.removal_pct as number) ?? 0) / 100;
      return growth - removal;
    },
  },
};

const WHITELISTED_SOURCES = new Set([
  "operations",
  "compartments",
  "compartment_species",
  "plan_metadata",
  "cross",
]);

const JOIN_PREFIX_MAP: Record<string, string> = {
  comp: "compartments",
};

const MAX_ROWS = 500; // safety limit — charts get cluttered beyond this

// ─── Field Aliases ───────────────────────────────────────────────────

const FIELD_ALIASES: Record<string, string> = {
  // operations table
  income: "income_eur",
  cost: "cost_eur",
  removal: "removal_pct",
  // compartments table (also work when joined via comp.prefix)
  area: "area_ha",
  volume: "volume_m3",
  age: "age_years",
  height: "avg_height",
  diameter: "avg_diameter",
  growth: "growth_m3_per_ha",
  // compartment_species table
  species: "species",
  "tree_species": "species",
  "total_ha": "area_ha",
  "total_m3": "volume_m3",
  // common plural / shorthand mistakes
  "development_classes": "development_class",
  "dev_class": "development_class",
  "stand_type": "development_class",
};

function resolveFieldAlias(field: string): string {
  return FIELD_ALIASES[field] ?? field;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function resolveJoinField(field: string): { table: string | null; field: string } {
  const dotIdx = field.indexOf(".");
  if (dotIdx === -1) return { table: null, field: resolveFieldAlias(field) };
  const prefix = field.slice(0, dotIdx);
  const resolved = JOIN_PREFIX_MAP[prefix] ?? prefix;
  const fieldPart = field.slice(dotIdx + 1);
  return { table: resolved, field: resolveFieldAlias(fieldPart) };
}

/** Recursively collect raw DB column sources for a (possibly chained) computed field.
 *  For non-computed fields, returns the field name itself.
 *  e.g. collectRawSources("growth_m3_total") → ["site_type", "soil_type", "area_ha"] */
function collectRawSources(fieldName: string): string[] {
  const def = COMPUTED_FIELDS[fieldName];
  if (!def) return [fieldName];
  const leafSources: string[] = [];
  for (const src of def.sources) {
    if (COMPUTED_FIELDS[src]) {
      leafSources.push(...collectRawSources(src));
    } else {
      leafSources.push(src);
    }
  }
  return leafSources;
}

/** Walk the computed field chain to find which table a leaf column belongs to. */
function sourceTableFor(topField: string, leafColumn: string): string {
  function find(field: string): string | null {
    const def = COMPUTED_FIELDS[field];
    if (!def) return null;
    for (const src of def.sources) {
      if (src === leafColumn) return def.sourceTables[src] ?? "source";
      const nested = find(src);
      if (nested) return nested;
    }
    return null;
  }
  return find(topField) ?? "source";
}

function buildSelect(config: ChartQueryConfig): string {
  const rawFields = new Set<string>();       // bare columns (no join prefix)
  const joinFields = new Map<string, Set<string>>();  // table → columns

  // Always include stand_id for cross-highlighting (_stand_ids injection).
  // On compartments/compartment_species it's a direct column;
  // on operations it comes through the compartments join (implicit if none given).
  if (config.source === "compartments" || config.source === "compartment_species") {
    rawFields.add("stand_id");
  } else if (config.join?.table === "compartments") {
    if (!joinFields.has("compartments")) joinFields.set("compartments", new Set());
    joinFields.get("compartments")!.add("stand_id");
  } else if (config.source === "operations") {
    // No explicit join — add a default one to get stand_id
    if (!joinFields.has("compartments")) joinFields.set("compartments", new Set());
    joinFields.get("compartments")!.add("stand_id");
  }

  const addField = (col: string) => {
    const res = resolveJoinField(col);
    if (res.table) {
      if (!joinFields.has(res.table)) joinFields.set(res.table, new Set());
      joinFields.get(res.table)!.add(res.field);
    } else {
      rawFields.add(res.field);
    }
  };
  for (const g of config.aggregate) {
    addField(g.group_by);
  }

  // Value source columns
  for (const v of config.values) {
    const fn = v.fn || "count";
    if (fn === "count") continue;

    // Recursively collect raw column sources from computed fields.
    // When a computed field's source is itself a computed field
    // (e.g. growth_m3_total ← growth_m3_per_ha ← site_type, soil_type),
    // we select the leaf columns, not the intermediate null DB column.
    const sourceColumns = collectRawSources(v.field);
    for (const src of sourceColumns) {
      // computed.sourceTables tells us which table each source column
      // belongs to. "compartments" means the joined table; anything else
      // means the primary source table.
      const srcTable = sourceTableFor(v.field, src);

      // When a join is configured, check if this source column is in the
      // join fields — even if sourceTables says "source" (written for the
      // case where the source IS compartments). Columns provided via join
      // must be fetched through the embedded resource, not as bare columns.
      const isJoinColumn = srcTable === "compartments"
        || (!!config.join && config.join.fields.includes(src));

      if (isJoinColumn) {
        if (!joinFields.has("compartments")) joinFields.set("compartments", new Set());
        joinFields.get("compartments")!.add(resolveFieldAlias(src));
      } else {
        rawFields.add(resolveFieldAlias(src));
      }
    }
  }

  // Operand columns for per-row multiply/divide ops
  for (const v of config.values) {
    if (!v.operand) continue;
    // Support dot-prefix notation (e.g. "comp.area_ha") for join columns
    const res = resolveJoinField(v.operand);
    if (res.table) {
      if (!joinFields.has(res.table)) joinFields.set(res.table, new Set());
      joinFields.get(res.table)!.add(res.field);
    } else {
      // Bare column — if it's in the join fields list, route there
      const isJoinCol = !!config.join && config.join.fields.includes(res.field);
      if (isJoinCol) {
        if (!joinFields.has("compartments")) joinFields.set("compartments", new Set());
        joinFields.get("compartments")!.add(res.field);
      } else {
        rawFields.add(res.field);
      }
    }
  }

  // Extra join fields
  if (config.join) {
    if (!joinFields.has("compartments")) joinFields.set("compartments", new Set());
    for (const f of config.join.fields) {
      joinFields.get("compartments")!.add(f);
    }
  }

  // Sort field
  if (config.sort) {
    const res = resolveJoinField(config.sort.by);
    if (res.table) {
      if (!joinFields.has(res.table)) joinFields.set(res.table, new Set());
      joinFields.get(res.table)!.add(res.field);
    } else {
      rawFields.add(res.field);
    }
  }

  // Build select string — merge all columns per join table into a single
  // embedded resource (e.g. "compartments!inner(col1, col2, col3)") to avoid
  // duplicate alias errors in PostgREST. Always use !inner so that
  // embedded-resource filters (e.g. ?compartments.development_class=eq.X)
  // actually filter parent rows instead of just nulling the nested object.
  const parts: string[] = Array.from(rawFields);
  for (const [table, cols] of joinFields) {
    parts.push(`${table}!inner(${Array.from(cols).join(", ")})`);
  }
  return parts.join(", ");
}
/** Parse a filter value that may embed a comparison operator.
 *  Supports: ">60", ">=0", "<100", "<=50", and object form {gt: 60}, {gte: 0, lte: 100}.
 *  Returns {op, val} where op is the PostgREST filter operator and val is the parsed number. */
function parseFilterOp(raw: unknown): { op: string; val: unknown } | null {
  // Object form: {gt: 60} or {gte: 0, lte: 100} — only first key used
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const entries = Object.entries(raw as Record<string, unknown>);
    for (const [op, v] of entries) {
      if (["gt", "gte", "lt", "lte", "eq", "neq"].includes(op) && v !== undefined) {
        return { op, val: typeof v === "string" ? parseNumeric(v) : v };
      }
    }
  }
  // String form: ">60", ">=0", "<100", "<=50"
  if (typeof raw === "string") {
    const m = raw.match(/^(>=?|<=?)\s*(.+)$/);
    if (m) {
      const opMap: Record<string, string> = { ">": "gt", ">=": "gte", "<": "lt", "<=": "lte" };
      return { op: opMap[m[1]], val: parseNumeric(m[2]) };
    }
  }
  return null;
}

/** Try to parse a string as a number; return the original if not numeric. */
function parseNumeric(s: string): number | string {
  const n = Number(s);
  return isNaN(n) ? s : n;
}

function buildQuery(
  supabase: SupabaseClient,
  forestId: string,
  config: ChartQueryConfig
) {
  const selectStr = buildSelect(config);
  let query = supabase
    .from(config.source)
    .select(selectStr)
    .eq("forest_id", forestId)
    .limit(MAX_ROWS);

  // Apply filters — Phase 4c.1: resolve join-prefixed filter keys
  // (e.g. "comp.development_class") for embedded resource filtering
  if (config.filters) {
    for (const [key, val] of Object.entries(config.filters)) {
      // Check for comparison operators embedded in the value
      const parsed = parseFilterOp(val);
      const isArray = Array.isArray(val);
      const resolvedKey = resolveFieldAlias(key);

      // Check for join-prefixed filter key
      const joinResolved = resolveJoinField(key);
      if (joinResolved.table) {
        // Embedded resource filter via PostgREST path syntax
        const embeddedKey = `${joinResolved.table}.${joinResolved.field}`;
        if (isArray) {
          query = query.filter(embeddedKey, "in", `(${val.join(",")})`);
        } else if (parsed) {
          query = query.filter(embeddedKey, parsed.op, parsed.val);
        } else if (val !== undefined && val !== null) {
          query = query.filter(embeddedKey, "eq", val);
        }
      } else {
        if (isArray) {
          query = query.in(resolvedKey, val);
        } else if (parsed) {
          if (parsed.op === "gt") query = query.gt(resolvedKey, parsed.val);
          else if (parsed.op === "gte") query = query.gte(resolvedKey, parsed.val);
          else if (parsed.op === "lt") query = query.lt(resolvedKey, parsed.val);
          else if (parsed.op === "lte") query = query.lte(resolvedKey, parsed.val);
          else if (parsed.op === "neq") query = query.neq(resolvedKey, parsed.val);
          else query = query.eq(resolvedKey, parsed.val);
        } else if (val !== undefined && val !== null) {
          query = query.eq(resolvedKey, val);
        }
      }
    }
  }

  // Apply sort
  if (config.sort) {
    const resolvedSortBy = resolveFieldAlias(config.sort.by);
    query = query.order(resolvedSortBy, {
      ascending: config.sort.dir !== "desc",
    });
  }

  return query;
}

function flattenRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const flat: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(row)) {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const nested = val as Record<string, unknown>;
        for (const [nk, nv] of Object.entries(nested)) {
          flat[nk] = nv;
        }
      } else {
        flat[key] = val;
      }
    }
    return flat;
  });
}

function applyComputedFields(
  rows: Record<string, unknown>[],
  config: ChartQueryConfig
): Record<string, unknown>[] {
  if (rows.length === 0) return rows;

  // Collect which computed fields are requested in config.values.
  // A field needs computation if it's not in the raw row AND either all its
  // source columns are raw DB columns, or at least one source is a chained
  // computed field that will be resolved by topological sort.
  const needed = new Set<string>();
  for (const v of config.values) {
    const def = COMPUTED_FIELDS[v.field];
    if (!def) continue;
    if (v.field in rows[0]) continue; // already present, use raw value
    const allRaw = def.sources.every((s) => s in rows[0]);
    const hasChainableDep = def.sources.some(
      (s) => COMPUTED_FIELDS[s] && !(s in rows[0])
    );
    if (allRaw || hasChainableDep) {
      needed.add(v.field);
    }
  }

  if (needed.size === 0) return rows;

  // Topological sort: resolve dependency order so chained computed fields
  // (e.g. growth_m3_total depends on growth_m3_per_ha) are computed first.
  // Skips dependencies that are already in the raw row.
  // Pass rows[0] so we can check which fields exist as raw columns.
  const order = topologicalSort(needed, rows[0]);

  return rows.map((row) => {
    const enriched = { ...row };
    for (const fieldName of order) {
      const def = COMPUTED_FIELDS[fieldName];
      if (!def) continue;
      enriched[fieldName] = def.compute(enriched);
    }
    return enriched;
  });
}

/** Sort computed field names so dependencies are resolved before dependents.
 *  Skips dependencies that already exist as raw columns in sampleRow. */
function topologicalSort(fields: Set<string>, sampleRow: Record<string, unknown>): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(name: string) {
    if (visited.has(name)) return;
    if (visiting.has(name)) return; // cycle — skip (shouldn't happen)
    visiting.add(name);
    const def = COMPUTED_FIELDS[name];
    if (def) {
      for (const src of def.sources) {
        // If the source is itself a computed field AND not a raw column, visit it first
        if (COMPUTED_FIELDS[src] && !(src in sampleRow)) {
          visit(src);
        }
      }
    }
    visiting.delete(name);
    visited.add(name);
    result.push(name);
  }

  for (const name of fields) {
    visit(name);
  }
  return result;
}

function aggregateRows(
  rows: Record<string, unknown>[],
  config: ChartQueryConfig
): Record<string, unknown>[] {
  if (rows.length === 0) return [];

  const groupKeys = config.aggregate.map((g) => g.group_by);

  if (groupKeys.length === 0) {
    const result: Record<string, unknown> = {};
    for (const v of config.values) {
      if (v.op && v.operand) {
        // Per-row arithmetic before aggregation (e.g. volume_m3 / area_ha)
        const computed = computePerRowValues(rows, v.field, v.operand, v.op);
        result[v.as] = aggregateOnNumbers(v.fn, computed) * (v.multiply ?? 1);
      } else {
        result[v.as] = (aggregateFn(v.fn, rows, v.field)) * (v.multiply ?? 1);
      }
    }
    const standIds = new Set<string>();
    for (const row of rows) {
      const sid = row["stand_id"];
      if (sid != null && sid !== "") standIds.add(String(sid));
    }
    result["_stand_ids"] = Array.from(standIds);
    return [result];
  }

  const groups = new Map<string, { key: Record<string, unknown>; rows: Record<string, unknown>[] }>();

  for (const row of rows) {
    if (groupKeys.some((k) => row[k] == null)) {
      console.log("[chart-engine] skipping row with null group_by key:", JSON.stringify(groupKeys), "row:", JSON.stringify(row));
      continue;
    }
    const compositeKey = groupKeys.map((k) => String(row[k] ?? "")).join("|");
    if (!groups.has(compositeKey)) {
      const keyObj: Record<string, unknown> = {};
      for (const k of groupKeys) {
        keyObj[k] = row[k];
      }
      groups.set(compositeKey, { key: keyObj, rows: [] });
    }
    groups.get(compositeKey)!.rows.push(row);
  }

  const result: Record<string, unknown>[] = [];
  groups.forEach((group) => {
    const aggregated: Record<string, unknown> = { ...group.key };
    for (const v of config.values) {
      if (v.op && v.operand) {
        const computed = computePerRowValues(group.rows, v.field, v.operand, v.op);
        aggregated[v.as] = aggregateOnNumbers(v.fn, computed) * (v.multiply ?? 1);
      } else {
        aggregated[v.as] = (aggregateFn(v.fn, group.rows, v.field)) * (v.multiply ?? 1);
      }
    }
    // Collect unique stand_ids for cross-highlighting (ChartCard ↔ map/list)
    const standIds = new Set<string>();
    for (const row of group.rows) {
      const sid = row["stand_id"];
      if (sid != null && sid !== "") standIds.add(String(sid));
    }
    aggregated["_stand_ids"] = Array.from(standIds);
    result.push(aggregated);
  });

  return result;
}

function aggregateFn(
  fn: "sum" | "count" | "avg" | "min" | "max" | undefined,
  rows: Record<string, unknown>[],
  field: string
): number {
  const effectiveFn = fn || "count";

  if (effectiveFn === "count") return rows.length;

  const values = rows
    .map((r) => r[field])
    .filter((v): v is number => typeof v === "number" && !isNaN(v));

  if (values.length === 0) return 0;

  switch (effectiveFn) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    default:
      return 0;
  }
}

/** Compute per-row values by applying an arithmetic op between two columns.
 *  Used for row-level multiply/divide before aggregation (e.g. volume_m3 / area_ha). */
function computePerRowValues(
  rows: Record<string, unknown>[],
  field: string,
  operand: string,
  op: "multiply" | "divide"
): number[] {
  const result: number[] = [];
  for (const row of rows) {
    const a = (row[field] as number) ?? 0;
    const b = (row[operand] as number) ?? 0;
    if (op === "divide") {
      result.push(b !== 0 ? a / b : 0);
    } else {
      result.push(a * b);
    }
  }
  return result;
}

/** Aggregate pre-computed per-row values (for per-row op results). */
function aggregateOnNumbers(
  fn: "sum" | "count" | "avg" | "min" | "max" | undefined,
  values: number[]
): number {
  const effectiveFn = fn || "count";
  if (effectiveFn === "count") return values.length;

  const clean = values.filter((v) => typeof v === "number" && !isNaN(v));
  if (clean.length === 0) return 0;

  switch (effectiveFn) {
    case "sum":
      return clean.reduce((a, b) => a + b, 0);
    case "avg":
      return clean.reduce((a, b) => a + b, 0) / clean.length;
    case "min":
      return Math.min(...clean);
    case "max":
      return Math.max(...clean);
    default:
      return 0;
  }
}

function fillYearGaps(
  rows: Record<string, unknown>[],
  config: ChartQueryConfig
): Record<string, unknown>[] {
  if (config.aggregate.length === 0) return rows;
  if (config.aggregate[0].group_by !== "year") return rows;
  if (rows.length < 1) return rows;

  const existingYears = new Set<number>();
  for (const row of rows) {
    const y = Number(row["year"]);
    if (!isNaN(y)) existingYears.add(y);
  }
  if (existingYears.size < 1) return rows;

  const yearsArr = Array.from(existingYears);
  const minYear = Math.min(...yearsArr);
  const maxYear = Math.max(...yearsArr);

  if (config.aggregate.length === 1) {
    const result = [...rows];
    for (let y = minYear; y <= maxYear; y++) {
      if (existingYears.has(y)) continue;
      const zeroRow: Record<string, unknown> = { year: y, _stand_ids: [] };
      for (const v of config.values) {
        zeroRow[v.as] = 0;
      }
      result.push(zeroRow);
    }
    return result;
  }

  const groupValues: Map<string, Set<string>> = new Map();
  for (let i = 1; i < config.aggregate.length; i++) {
    groupValues.set(config.aggregate[i].group_by, new Set());
  }
  for (const row of rows) {
    for (let i = 1; i < config.aggregate.length; i++) {
      const key = config.aggregate[i].group_by;
      const val = String(row[key] ?? "");
      groupValues.get(key)!.add(val);
    }
  }

  const existingKeys = new Set<string>();
  for (const row of rows) {
    const parts = [String(row["year"] ?? "")];
    for (let i = 1; i < config.aggregate.length; i++) {
      parts.push(String(row[config.aggregate[i].group_by] ?? ""));
    }
    existingKeys.add(parts.join("|"));
  }

  const result = [...rows];

  const dimValues: string[][] = [];
  for (let i = 1; i < config.aggregate.length; i++) {
    dimValues.push(Array.from(groupValues.get(config.aggregate[i].group_by)!));
  }

  function cartesianProduct(arrays: string[][]): string[][] {
    if (arrays.length === 0) return [[]];
    const [first, ...rest] = arrays;
    const restProduct = cartesianProduct(rest);
    const result: string[][] = [];
    for (const val of first) {
      for (const r of restProduct) {
        result.push([val, ...r]);
      }
    }
    return result;
  }

  for (let y = minYear; y <= maxYear; y++) {
    if (existingYears.has(y)) continue;

    for (const combo of cartesianProduct(dimValues)) {
      const key = [String(y), ...combo].join("|");
      if (existingKeys.has(key)) continue;

      const zeroRow: Record<string, unknown> = { year: y, _stand_ids: [] };
      for (let i = 1; i < config.aggregate.length; i++) {
        zeroRow[config.aggregate[i].group_by] = combo[i - 1];
      }
      for (const v of config.values) {
        zeroRow[v.as] = 0;
      }
      result.push(zeroRow);
    }
  }

  return result;
}

function shouldApplyCumulative(config: ChartQueryConfig): boolean {
  return config.values.some((v) => v.cumulative === true)
    && (config.sort !== undefined || (config.aggregate.length > 0 && config.aggregate[0].group_by === "year"));
}

function applyCumulative(
  rows: Record<string, unknown>[],
  config: ChartQueryConfig
): Record<string, unknown>[] {
  if (!shouldApplyCumulative(config)) return rows;

  const cumulativeFields = new Set<string>();
  for (const v of config.values) {
    if (v.cumulative) cumulativeFields.add(v.as);
  }
  if (cumulativeFields.size === 0) return rows;

  const sortKey = config.sort?.by ?? (config.aggregate.length > 0 ? config.aggregate[0].group_by : null);
  if (!sortKey) return rows;

  const secondaryKey = config.aggregate.length > 1 ? config.aggregate[1].group_by : null;

  if (secondaryKey) {
    const partitions = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const key = String(row[secondaryKey] ?? "__null__");
      if (!partitions.has(key)) partitions.set(key, []);
      partitions.get(key)!.push(row);
    }

    const result: Record<string, unknown>[] = [];
    partitions.forEach((partition) => {
      partition.sort((a, b) => String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? "")));
      const running: Record<string, number> = {};
      cumulativeFields.forEach((f) => { running[f] = 0; });
      for (const row of partition) {
        cumulativeFields.forEach((f) => {
          const val = Number(row[f]) || 0;
          running[f] += val;
          row[f] = running[f];
        });
        result.push(row);
      }
    });
    return result;
  }

  const sorted = [...rows].sort((a, b) => {
    const va = a[sortKey];
    const vb = b[sortKey];
    if (typeof va === "number" && typeof vb === "number") return va - vb;
    return String(va ?? "").localeCompare(String(vb ?? ""));
  });

  const running: Record<string, number> = {};
  cumulativeFields.forEach((f) => { running[f] = 0; });

  for (const row of sorted) {
    cumulativeFields.forEach((f) => {
      const val = Number(row[f]) || 0;
      running[f] += val;
      row[f] = running[f];
    });
  }

  return sorted;
}

// ─── Phase 4c.3: Cross-Source Pipeline ───────────────────────────────

/** Extract unique merge key values from all sub-query results. */
function extractMergeKeys(
  mergeOn: string,
  subResults: Record<string, unknown>[][]
): Set<string> {
  const keys = new Set<string>();
  for (const rows of subResults) {
    for (const row of rows) {
      const val = row[mergeOn];
      if (val !== undefined && val !== null) {
        keys.add(String(val));
      }
    }
  }
  return keys;
}

/** Merge sub-query results on a common key.
 *  Handles broadcast rows (a single-row result fanned out to all merge keys). */
function mergeResults(
  mergeOn: string,
  strategy: "outer" | "inner",
  subResults: Record<string, unknown>[][],
  subConfigs: SubQueryConfig[]
): Record<string, unknown>[] {
  const allKeys = extractMergeKeys(mergeOn, subResults);

  // Collect all value column names for zero-fill
  const allValueColumns = new Set<string>();
  for (const sq of subConfigs) {
    for (const v of sq.values) {
      allValueColumns.add(v.as);
    }
  }

  const mergedMap = new Map<string, Record<string, unknown>>();

  for (const key of Array.from(allKeys)) {
  let merged: Record<string, unknown> = { [mergeOn]: isNaN(Number(key)) ? key : Number(key) };
  let allPresent = true;
  // Collect _stand_ids from all sub-results
  const mergedStandIds = new Set<string>();

  for (let i = 0; i < subResults.length; i++) {
    const subCfg = subConfigs[i];
    const rows = subResults[i];

    if (subCfg.broadcast && rows.length === 1) {
      // Broadcast: copy all fields from the single row to every merge key
      Object.assign(merged, rows[0]);
      // Collect _stand_ids from broadcast row
      const sids = rows[0]["_stand_ids"] as string[] | undefined;
      if (sids) for (const sid of sids) mergedStandIds.add(sid);
      // Remove merge_on from broadcast row so it doesn't overwrite
      delete merged[mergeOn];
      merged[mergeOn] = isNaN(Number(key)) ? key : Number(key);
    } else {
      const match = rows.find((r) => String(r[mergeOn]) === key);
      if (match) {
        // Copy value columns only (not the merge key, already set)
        for (const v of subCfg.values) {
          merged[v.as] = match[v.as] ?? 0;
        }
        // Collect _stand_ids from matched row
        const sids = match["_stand_ids"] as string[] | undefined;
        if (sids) for (const sid of sids) mergedStandIds.add(sid);
      } else {
        allPresent = false;
        // Zero-fill missing values
        for (const v of subCfg.values) {
          merged[v.as] = 0;
        }
      }
    }
  }

  if (strategy === "inner" && !allPresent) continue;

  merged["_stand_ids"] = Array.from(mergedStandIds);
  mergedMap.set(key, merged);
  }

  return Array.from(mergedMap.values());
}

/** Fill gaps in merged results. When merge_on is "year", fills all integer
 *  years between min and max. Otherwise no-op. */
function fillMergeGaps(
  rows: Record<string, unknown>[],
  mergeOn: string,
  valueColumns: string[]
): Record<string, unknown>[] {
  if (mergeOn !== "year" || rows.length === 0) return rows;

  const existingYears = new Set<number>();
  for (const row of rows) {
    const y = Number(row[mergeOn]);
    if (!isNaN(y)) existingYears.add(y);
  }
  if (existingYears.size < 2) return rows;

  const yearsArr = Array.from(existingYears);
  const minYear = Math.min(...yearsArr);
  const maxYear = Math.max(...yearsArr);

  const result = [...rows];
  for (let y = minYear; y <= maxYear; y++) {
    if (existingYears.has(y)) continue;
    const zeroRow: Record<string, unknown> = { [mergeOn]: y, _stand_ids: [] };
    for (const col of valueColumns) {
      zeroRow[col] = 0;
    }
    result.push(zeroRow);
  }

  return result;
}

/** Apply cumulative transformation post-merge, using the original sub-query
 *  cumulative flags. Cumulative is deferred to post-merge because rows from
 *  different sub-queries must be aligned by merge key first. */
function applyCrossCumulative(
  rows: Record<string, unknown>[],
  mergeOn: string,
  subConfigs: SubQueryConfig[]
): Record<string, unknown>[] {
  // Collect which output columns should be cumulative
  const cumulativeColumns = new Set<string>();
  for (const sq of subConfigs) {
    for (const v of sq.values) {
      if (v.cumulative) cumulativeColumns.add(v.as);
    }
  }

  if (cumulativeColumns.size === 0) return rows;

  // Sort by merge key ascending for correct cumulative direction
  const sorted = [...rows].sort((a, b) => {
    const va = a[mergeOn];
    const vb = b[mergeOn];
    if (typeof va === "number" && typeof vb === "number") return va - vb;
    return String(va ?? "").localeCompare(String(vb ?? ""));
  });

  const running: Record<string, number> = {};
  cumulativeColumns.forEach((col) => { running[col] = 0; });

  for (const row of sorted) {
    cumulativeColumns.forEach((col) => {
      const val = Number(row[col]) || 0;
      running[col] += val;
      row[col] = running[col];
    });
  }

  return sorted;
}

/** Run a single sub-query through the existing pipeline.
 *  When skipCumulative is true, strips cumulative flags before running
 *  (cumulative is deferred to post-merge in the cross pipeline). */
async function recomputeSubQuery(
  supabase: SupabaseClient,
  forestId: string,
  subConfig: SubQueryConfig,
  skipCumulative: boolean
): Promise<Record<string, unknown>[]> {
  // Build a ChartQueryConfig from the sub-query config
  const values = skipCumulative
    ? subConfig.values.map((v) => ({ ...v, cumulative: undefined }))
    : subConfig.values;

  const config: ChartQueryConfig = {
    source: subConfig.source,
    join: subConfig.join,
    aggregate: subConfig.aggregate,
    values: values as ChartQueryConfig["values"],
    filters: subConfig.filters,
    limit: subConfig.limit,
    // Sub-queries don't have their own sort — sorting happens post-merge.
    // But fillYearGaps needs the implied sort from group_by for year detection.
  };

  // 1. Validate
  if (!WHITELISTED_SOURCES.has(config.source)) {
    throw new Error(`Invalid chart source: ${config.source}`);
  }
  if (!config.aggregate || !Array.isArray(config.aggregate)) {
    throw new Error("config.aggregate is required and must be an array");
  }
  if (!config.values || !Array.isArray(config.values)) {
    throw new Error("config.values is required and must be an array");
  }
  for (const v of config.values) {
    if (!v.field || !v.as) {
      throw new Error(`Each value entry needs field and as — got: ${JSON.stringify(v)}`);
    }
  }

  // 2. Build and execute query
  const query = buildQuery(supabase, forestId, config);
  const { data: rawRows, error } = await query;

  if (error) {
    throw new Error(`Sub-query (${config.source}) failed: ${error.message}`);
  }

  const rows = (rawRows as unknown as Record<string, unknown>[]) ?? [];

  // 3-6. Pipeline
  const flatRows = flattenRows(rows);
  const computedRows = applyComputedFields(flatRows, config);
  let aggregated = aggregateRows(computedRows, config);
  aggregated = fillYearGaps(aggregated, config);

  // Sort by first group_by
  const effectiveSort = config.aggregate.length > 0
    ? { by: config.aggregate[0].group_by, dir: "asc" as string }
    : null;
  if (effectiveSort) {
    const sortBy = effectiveSort.by;
    const dir = effectiveSort.dir === "desc" ? -1 : 1;
    aggregated.sort((a, b) => {
      const va = a[sortBy];
      const vb = b[sortBy];
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va ?? "").localeCompare(String(vb ?? "")) * dir;
    });
  }

  // Cumulative is skipped when skipCumulative=true (stripped from values above),
  // but we still call applyCumulative in case skipCumulative=false for standalone use.
  if (!skipCumulative) {
    aggregated = applyCumulative(aggregated, config);
  }

  if (config.limit && config.limit > 0) {
    aggregated = aggregated.slice(0, config.limit);
  }

  return aggregated;
}

/** Run a cross-source query: execute all sub-queries, merge on common key,
 *  fill gaps, and apply deferred cumulative. */
async function recomputeCrossData(
  supabase: SupabaseClient,
  forestId: string,
  config: CrossQueryConfig
): Promise<ChartEngineResult> {
  const strategy = config.merge_strategy ?? "outer";

  // 1. Run all sub-queries (cumulative stripped, applied post-merge)
  const subResults: Record<string, unknown>[][] = [];
  for (const subCfg of config.queries) {
    const rows = await recomputeSubQuery(supabase, forestId, subCfg, true);
    subResults.push(rows);
  }

  // 2. Merge on common key
  let merged = mergeResults(config.merge_on, strategy, subResults, config.queries);

  // 3. Fill gaps
  const allValueColumns = new Set<string>();
  for (const sq of config.queries) {
    for (const v of sq.values) {
      allValueColumns.add(v.as);
    }
  }
  merged = fillMergeGaps(merged, config.merge_on, Array.from(allValueColumns));

  // 4. Apply deferred cumulative
  merged = applyCrossCumulative(merged, config.merge_on, config.queries);

  // 5. Sort
  if (config.sort) {
    const sortBy = config.sort.by;
    const dir = config.sort.dir === "desc" ? -1 : 1;
    merged.sort((a, b) => {
      const va = a[sortBy];
      const vb = b[sortBy];
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va ?? "").localeCompare(String(vb ?? "")) * dir;
    });
  } else {
    // Default sort by merge key ascending
    const sortBy = config.merge_on;
    merged.sort((a, b) => {
      const va = a[sortBy];
      const vb = b[sortBy];
      if (typeof va === "number" && typeof vb === "number") return (va as number) - (vb as number);
      return String(va ?? "").localeCompare(String(vb ?? ""));
    });
  }

  return {
    data: merged,
    computedAt: new Date().toISOString(),
  };
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Recompute chart data from a declarative query config.
 * Translates the config into safe PostgREST queries via the authenticated
 * Supabase client, handles computed fields (e.g. removal_m3), and returns
 * structured chart-ready data.
 *
 * Phase 4c: dispatches to cross-source pipeline when source === "cross".
 */
export async function recomputeChartData(
  supabase: SupabaseClient,
  forestId: string,
  config: AnyQueryConfig
): Promise<ChartEngineResult> {
  // Phase 4c.3: cross-source dispatch
  if (config.source === "cross") {
    return recomputeCrossData(supabase, forestId, config as CrossQueryConfig);
  }

  // Existing single-source pipeline
  const sc = config as ChartQueryConfig;

  // 1. Validate source
  if (!WHITELISTED_SOURCES.has(sc.source)) {
    throw new Error(`Invalid chart source: ${sc.source}`);
  }

  // 1b. Validate required fields
  if (!sc.aggregate || !Array.isArray(sc.aggregate)) {
    throw new Error("config.aggregate is required and must be an array");
  }
  if (!sc.values || !Array.isArray(sc.values)) {
    throw new Error("config.values is required and must be an array — e.g. values: [{ field: \"volume_m3\", as: \"volume\", fn: \"sum\" }]");
  }
  for (const v of sc.values) {
    if (!v.field || !v.as) {
      throw new Error(`Each value entry needs field and as — got: ${JSON.stringify(v)}`);
    }
  }

  // 2. Build and execute query
  const query = buildQuery(supabase, forestId, sc);
  const { data: rawRows, error } = await query;

  if (error) {
    throw new Error(`Chart data query failed: ${error.message}`);
  }

  const rows = (rawRows as unknown as Record<string, unknown>[]) ?? [];

  // 3. Flatten nested join data
  const flatRows = flattenRows(rows);

  // 4. Compute synthetic columns (e.g. removal_m3)
  const computedRows = applyComputedFields(flatRows, sc);

  // 5. Aggregate
  let aggregated = aggregateRows(computedRows, sc);

  // 5b. Fill year gaps
  aggregated = fillYearGaps(aggregated, sc);

  // 6. Sort result
  const effectiveSort = sc.sort ?? (sc.aggregate.length > 0
    ? { by: sc.aggregate[0].group_by, dir: "asc" as string }
    : null);
  if (effectiveSort) {
    const sortBy = effectiveSort.by;
    const dir = effectiveSort.dir === "desc" ? -1 : 1;
    aggregated.sort((a, b) => {
      const va = a[sortBy];
      const vb = b[sortBy];
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va ?? "").localeCompare(String(vb ?? "")) * dir;
    });
  }

  // 6b. Apply cumulative
  aggregated = applyCumulative(aggregated, sc);

  // 7. Apply limit
  if (sc.limit && sc.limit > 0) {
    aggregated = aggregated.slice(0, sc.limit);
  }

  return {
    data: aggregated,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Recompute all query_config-backed chart tabs for a forest.
 * Called once per user message after the AI agent loop completes.
 * Phase 4c: supports both single-source and cross-source configs.
 */
export async function recomputeAllCharts(
  supabase: SupabaseClient,
  forestId: string,
  sendSse?: (event: string, data: unknown) => void
): Promise<void> {
  const { data: tabs, error } = await supabase
    .from("chart_tabs")
    .select("chart_id, query_config, title_en, title_fi")
    .eq("forest_id", forestId)
    .not("query_config", "is", null);

  if (error) {
    console.error("recomputeAllCharts: failed to fetch chart tabs:", error);
    return;
  }

  if (!tabs || tabs.length === 0) return;

  const recomputedIds: string[] = [];

  for (const tab of tabs) {
    try {
      // Phase 4c: widened type — query_config may be ChartQueryConfig or CrossQueryConfig
      const config = tab.query_config as AnyQueryConfig;
      const result = await recomputeChartData(supabase, forestId, config);

      await supabase
        .from("chart_tabs")
        .update({
          data: result.data,
          computed_at: result.computedAt,
        })
        .eq("forest_id", forestId)
        .eq("chart_id", tab.chart_id);

      recomputedIds.push(tab.chart_id);
    } catch (err) {
      console.error(
        `recomputeAllCharts: failed for chart "${tab.chart_id}" (${tab.title_en}):`,
        err
      );
    }
  }

  if (recomputedIds.length > 0) {
    sendSse?.("charts_refreshed", { chart_ids: recomputedIds });
  }
}

// ── Chart Title Fallback Detection ───────────────────────────────────
// When the AI forgets to provide title_fi, detect it from query_config patterns.

interface TitlePattern {
  match: (qc: Record<string, unknown>) => boolean;
  fi: string;
}

const TITLE_PATTERNS: TitlePattern[] = [
  { match: (qc) => qc.source === "operations" && hasField(qc, "net_cashflow"), fi: "Nettokassavirta" },
  { match: (qc) => qc.source === "operations" && hasField(qc, "income_eur") && hasField(qc, "cost_eur"), fi: "Vuotuiset tulot ja kulut" },
  { match: (qc) => qc.source === "operations" && hasField(qc, "income_eur"), fi: "Vuotuiset hakkuutulot" },
  { match: (qc) => qc.source === "operations" && hasField(qc, "removal_m3"), fi: "Vuotuinen hakkuumäärä" },
  { match: (qc) => qc.source === "operations" && hasAggregate(qc, "type") && hasField(qc, "income_eur"), fi: "Tulot toimenpidetyypeittäin" },
  { match: (qc) => qc.source === "compartment_species" && hasField(qc, "volume_m3"), fi: "Puulajit tilavuuden mukaan" },
  { match: (qc) => qc.source === "compartment_species" && hasField(qc, "area_ha"), fi: "Puulajit pinta-alan mukaan" },
  { match: (qc) => qc.source === "compartments" && hasAggregate(qc, "development_class"), fi: "Kehitysluokittain" },
  { match: (qc) => qc.source === "compartments" && hasAggregate(qc, "main_species"), fi: "Pääpuulajit" },
  { match: (qc) => qc.source === "compartments" && hasField(qc, "age_years") && hasField(qc, "volume_m3"), fi: "Ikä vs tilavuus" },
  { match: (qc) => qc.source === "compartments" && hasField(qc, "growth_m3_per_ha"), fi: "Vuotuinen kasvu" },
];

function hasField(qc: Record<string, unknown>, field: string): boolean {
  const values = qc.values;
  if (!Array.isArray(values)) return false;
  return values.some((v: Record<string, unknown>) => v.field === field);
}

function hasAggregate(qc: Record<string, unknown>, groupBy: string): boolean {
  const agg = qc.aggregate;
  if (!Array.isArray(agg)) return false;
  return agg.some((g: Record<string, unknown>) => g.group_by === groupBy);
}

export function detectChartTitleFi(queryConfig: Record<string, unknown>): string | undefined {
  for (const p of TITLE_PATTERNS) {
    if (p.match(queryConfig)) return p.fi;
  }
  return undefined;
}
