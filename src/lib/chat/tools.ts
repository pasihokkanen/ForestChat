// src/lib/chat/tools.ts — T8.4b Tool Definitions
//
// OpenRouter/OpenAI function-calling tool definitions.
// Each tool has name, description, and JSON Schema parameters.
// Returns all tool definitions: generate_plan, get_stand, search_stands,
// show_stands, plan_summary, query_operations, show_operations,
// batch_update_operations, add_operation, remove_operation,
// check_harvest_sustainability, validate_plan, create_chart,
// select_stand, remove_chart, clear_charts, list_charts,
// update_chart, recreate_chart.

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export function getTools(): ToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "generate_plan",
        description: `Generate a complete forest management plan for the entire property.
The algorithm follows Finnish silvicultural recommendations (Central Finland):
- Optimal rotation ages: Pine 81-100, Spruce 71-90, Birch 61-70
- Thinning thresholds: basal area limits by site type
- Minimum thinning interval: 10 years
- Sustainability: annual harvest < annual growth
- Regeneration chain: clearcut → site preparation → planting (automatic)
- Growth rates: Luke VMI13 coefficients by site type
Returns: operations per stand, key metrics.`,
        parameters: {
          type: "object",
          properties: {
            period_years: { type: "number", description: "Duration in years (default 20)" },
            start_year: { type: "number", description: "Start year (default current year)" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_stand",
        description: "Get all data for a single stand (species, site type, age, area, volume, location).",
        parameters: {
          type: "object",
          properties: {
            stand_id: { type: "string", description: "e.g. '7', '89.1'" },
          },
          required: ["stand_id"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_stands",
        description: "Search compartments by any combination of criteria. All parameters optional. Returns up to 500 stands by default — set limit: 0 to fetch ALL stands. When >20 results match, you get a compact summary (total count, area, volume). This is a pure data-fetching tool — results are returned in text only, no UI changes happen. Use show_stands when the user wants to SEE the results in the Stands tab.",
        parameters: {
          type: "object",
          properties: {
            stand_ids: { type: "array", items: { type: "string" }, description: "List of specific stand IDs, e.g. ['5', '12', '89.1']" },
            species: { type: "array", items: { type: "string" }, description: "Main tree species, e.g. ['pine', 'spruce', 'birch']" },
            development_classes: { type: "array", items: { type: "string" }, description: "e.g. ['regeneration_ready', 'mature_thinning', 'young_thinning', 'open_area', 'seed_tree', 'seedling_large', 'seedling_small']" },
            site_types: { type: "array", items: { type: "string" }, description: "e.g. ['herb-rich heath', 'mesic', 'sub-xeric', 'xeric']" },
            age_min: { type: "number" }, age_max: { type: "number" },
            area_min: { type: "number" }, area_max: { type: "number" },
            volume_min: { type: "number" }, volume_max: { type: "number" },
            basal_area_min: { type: "number" }, basal_area_max: { type: "number" },
            height_min: { type: "number" }, height_max: { type: "number" },
            diameter_min: { type: "number" }, diameter_max: { type: "number" },
            growth_min: { type: "number" }, growth_max: { type: "number" },
            fields: {
              type: "array", items: { type: "string", enum: ["stand_id", "species", "development_class", "site_type", "area_ha", "age_years", "volume_m3", "basal_area", "avg_height", "avg_diameter", "growth_m3_per_ha", "soil_type", "drainage_status"] },
              description: "Which fields to return. Also limits the database query to only these columns. Omit for all fields. Example: ['stand_id', 'species', 'age_years']"
            },
            limit: { type: "number", description: "Max stands to return. Default 500 if omitted. Set to 0 for unlimited (all stands). Example: 10 returns only 10 stands." },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "show_stands",
        description: `Show stands in the Stands tab by applying filters. Switches to the Stands tab and filters the stand list. Use this when the user asks to "show" or "list" stands matching criteria (e.g. "show me stands larger than 1 ha", "list all pine stands"). Do NOT use this for selecting specific stands on the map — use select_stand for that. Do NOT call search_stands before this — show_stands handles everything directly.` ,
        parameters: {
          type: "object",
          properties: {
            species: { type: "array", items: { type: "string" }, description: "Main tree species, e.g. ['pine', 'spruce', 'birch']" },
            development_classes: { type: "array", items: { type: "string" }, description: "e.g. ['regeneration_ready', 'mature_thinning', 'young_thinning', 'open_area', 'seed_tree', 'seedling_large', 'seedling_small']" },
            site_types: { type: "array", items: { type: "string" }, description: "e.g. ['herb-rich heath', 'mesic', 'sub-xeric', 'xeric']" },
            age_min: { type: "number" }, age_max: { type: "number" },
            area_min: { type: "number" }, area_max: { type: "number" },
            volume_min: { type: "number" }, volume_max: { type: "number" },
            basal_area_min: { type: "number" }, basal_area_max: { type: "number" },
            height_min: { type: "number" }, height_max: { type: "number" },
            diameter_min: { type: "number" }, diameter_max: { type: "number" },
            growth_min: { type: "number" }, growth_max: { type: "number" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "plan_summary",
        description: "Get plan summary data (volume, growth, income, costs). Returns structured data — don't repeat the numbers in text as they're already shown in the plan summary UI panel. Just acknowledge briefly.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "query_operations",
        description: "Search planned operations by any combination of criteria. All parameters optional — omit years to search all years. Returns up to 500 operations by default — set limit: 0 to fetch ALL. When >20 results match, you get a compact summary (count, year range, total income). This is a pure data-fetching tool — results are returned in text only, no UI changes happen. Use show_operations when the user wants to SEE results in the Operations tab.",
        parameters: {
          type: "object",
          properties: {
            years: { type: "array", items: { type: "number" }, description: "List of specific years, e.g. [2026, 2028]. Returns operations in ANY of these years." },
            types: { type: "array", items: { type: "string" }, description: "Operation types, e.g. ['clear_cut', 'thinning', 'first_thinning', 'tending', 'site_prep']" },
            stand_ids: { type: "array", items: { type: "string" }, description: "Filter by stand IDs, e.g. ['5', '12']" },
            species: { type: "array", items: { type: "string" }, description: "Filter by main tree species" },
            development_classes: { type: "array", items: { type: "string" }, description: "Filter by development class" },
            site_types: { type: "array", items: { type: "string" }, description: "Filter by site type" },
            income_min: { type: "number" }, income_max: { type: "number" },
            removal_m3_min: { type: "number", description: "Minimum harvested volume in m³" }, removal_m3_max: { type: "number" },
            removal_pct_min: { type: "number" }, removal_pct_max: { type: "number" },
            cost_min: { type: "number" }, cost_max: { type: "number" },
            stand_age_min: { type: "number" }, stand_age_max: { type: "number" },
            stand_area_min: { type: "number" }, stand_area_max: { type: "number" },
            fields: {
              type: "array", items: { type: "string", enum: ["stand_id", "species", "development_class", "site_type", "stand_area_ha", "stand_age_years", "year", "type", "removal_pct", "removal_m3", "income_eur", "cost_eur"] },
              description: "Which fields to include in output. Also limits the database query to only these columns. Omit for all fields. Example: ['stand_id', 'year', 'type', 'income_eur']"
            },
            limit: { type: "number", description: "Max operations to return. Default 500 if omitted. Set to 0 for unlimited (all operations). Example: 10 returns only 10 operations." },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "show_operations",
        description: `Show operations in the Operations tab by applying filters. Switches to the Operations tab and filters the operation list. Use this when the user asks to "show" or "list" operations matching criteria (e.g. "show me all clear-cuts from 2026-2030", "list thinnings for stand 12"). Do NOT call query_operations before this — show_operations handles everything directly.` ,
        parameters: {
          type: "object",
          properties: {
            years: { type: "array", items: { type: "number" }, description: "List of specific years, e.g. [2026, 2028]" },
            types: { type: "array", items: { type: "string" }, description: "Operation types, e.g. ['clear_cut', 'thinning', 'first_thinning', 'tending', 'site_prep']" },
            stand_ids: { type: "array", items: { type: "string" }, description: "Filter by stand IDs, e.g. ['5', '12']" },
            species: { type: "array", items: { type: "string" }, description: "Filter by main tree species" },
            development_classes: { type: "array", items: { type: "string" }, description: "Filter by development class" },
            site_types: { type: "array", items: { type: "string" }, description: "Filter by site type" },
            income_min: { type: "number" }, income_max: { type: "number" },
            cost_min: { type: "number" }, cost_max: { type: "number" },
            stand_age_min: { type: "number" }, stand_age_max: { type: "number" },
            stand_area_min: { type: "number" }, stand_area_max: { type: "number" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "batch_update_operations",
        description: "Update multiple operations at once. Filter selects which operations to modify, update specifies what to change. Use this for bulk modifications like 'move all 2026 thinnings to 2028'. When the user says 'move harvests', filter by harvest types (clear_cut, thinning, first_thinning, selection_cutting). When they say 'move silvicultural work', filter by cost operation types. Each `.update()` call is atomic at the DB level. Max 500 operations per call.",
        parameters: {
          type: "object",
          properties: {
            filter: {
              type: "object",
              description: "Filter criteria matching the same structure as query_operations (years, types, stand_ids, etc.)",
              properties: {
                years: { type: "array", items: { type: "number" } },
                types: { type: "array", items: { type: "string" } },
                stand_ids: { type: "array", items: { type: "string" } },
                species: { type: "array", items: { type: "string" } },
                development_classes: { type: "array", items: { type: "string" } },
                site_types: { type: "array", items: { type: "string" } },
                income_min: { type: "number" }, income_max: { type: "number" },
                removal_m3_min: { type: "number" }, removal_m3_max: { type: "number" },
                removal_pct_min: { type: "number" }, removal_pct_max: { type: "number" },
                cost_min: { type: "number" }, cost_max: { type: "number" },
                stand_age_min: { type: "number" }, stand_age_max: { type: "number" },
                stand_area_min: { type: "number" }, stand_area_max: { type: "number" },
              },
            },
            update: {
              type: "object",
              description: "What to change. Only whitelisted fields: year, removal_pct, notes.",
              properties: {
                year: { type: "number", description: "New year for the operations (e.g., 2028)" },
                removal_pct: { type: "number", description: "New removal percentage (e.g., 28 for thinning)" },
                notes: { type: "string", description: "Update notes field" },
              },
            },
          },
          required: ["filter", "update"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "add_operation",
        description: `Add or update operations for stands. Can add a single operation or batch multiple at once.

SINGLE OPERATION mode — provide stand_id, year, type (and optional removal_pct):
- Clear_cut: only for regeneration-ready stands, removal 100%
- Thinning: mature thinning stand, age >= 45 (pine) / 40 (spruce), removal ~28%
- First_thinning: young thinning stand, removal ~25%
- Selection_cutting: special case, removal 50%
- Tending/Early_tending: seedling stands
- Site_prep/Planting: after clearcut

BATCH MODE — provide operations: [{stand_id, year, type, removal_pct?}, ...]. Use this when adding the same operation type to multiple stands. Validation is performed server-side before each operation is added.

IMPORTANT: After adding operations, just confirm the result in one sentence. Do NOT call select_stand, search_stands, or any visualization tool afterwards. Refresh the page if you need to see the updated operations list.`,
        parameters: {
          type: "object",
          properties: {
            stand_id: { type: "string", description: "Stand ID (e.g., '7', '89.1') — SINGLE mode" },
            year: { type: "number", description: "Year of operation — SINGLE mode" },
            type: { type: "string", description: "Operation type: clear_cut, thinning, first_thinning, selection_cutting, tending, early_tending, pre_clearance, site_prep, ditch_mounding, scalping, planting, spruce_planting, pine_planting" },
            removal_pct: { type: "number", description: "Removal percentage (default: 100 for clearcut, 28 for thinning, 25 for first thinning, 50 for selection cutting)" },
            operations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  stand_id: { type: "string" },
                  year: { type: "number" },
                  type: { type: "string" },
                  removal_pct: { type: "number" },
                },
                required: ["stand_id", "year", "type"],
              },
              description: "BATCH MODE: Array of operations to add. Each object must have stand_id, year, and type.",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "remove_operation",
        description: "Remove planned operations. Supports multiple modes:\n- Single stand, single year: stand_id + year\n- Single stand, all years: stand_id only\n- Multiple stands, single year: stand_ids + year\n- Multiple stands, all years: stand_ids only\n- Filter by type: add type parameter (e.g., type: 'thinning')\nAll matching operations are deleted.\n\nIMPORTANT: After removing operations, just confirm the result. Do NOT call select_stand, search_stands, or any visualization tool. Refresh the page to see the updated operations list.",
        parameters: {
          type: "object",
          properties: {
            stand_id: { type: "string", description: "Stand ID (e.g., '7', '89.1') — single stand mode" },
            stand_ids: { type: "array", items: { type: "string" }, description: "Array of stand IDs — multi-stand mode" },
            year: { type: "number", description: "Year of operation to remove. Optional — omit to remove all years for the stand(s)." },
            type: { type: "string", description: "Optional type filter — only remove operations of this type (e.g., 'thinning')" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "clear_plan",
        description: `Delete ALL AI-generated operations from the plan at once. This is destructive and cannot be undone. Deletes every operation where created_by='ai' for this forest.

⚠️ CRITICAL: You MUST ask the user for explicit confirmation before calling this tool. Never call clear_plan without the user's clear, unambiguous consent. The user must say something like "yes, clear everything" or "delete all operations" — do not infer consent from vague statements.

After clearing, the plan is empty and the user will need to generate a new one or add operations manually.`,
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "check_harvest_sustainability",
        description: "Compare total harvest volume against annual growth for a specific year or the entire plan period. Returns sustainability assessment.",
        parameters: {
          type: "object",
          properties: {
            year: { type: "number", description: "Optional year to check. If omitted, checks all planned years." },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "validate_plan",
        description: `Full plan validation checking 6 rules:
1. No clearcuts on non-regeneration-ready stands
2. No thinnings within 10 years of previous thinning
3. Regeneration chain follows each clearcut (mounding + planting)
4. Annual harvest doesn't exceed annual growth
5. No duplicate operations on same stand+year
6. Operations have valid years (within plan period)

Returns issues list or "Plan looks good."`,
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_chart",
        description: `Create a new chart tab in the visualization panel. Call this after computing chart data using query_operations, search_stands, or plan_summary. Just create the chart — don't also describe its contents in text, the chart is already visible in the UI.

PREFERRED: Use query_config for auto-updating charts. The chart engine will fetch and aggregate data deterministically from the database, so the chart auto-refreshes when the plan changes. Static data (no query_config) is also supported for one-off charts.

Supported chart types: bar, pie, line, area, stacked_bar, scatter, radar, donut, horizontal_bar, composed, waterfall.

For bar/line/area: provide x_key (category axis) and y_key (value axis). Add color_key for stacked_bar.
For pie/donut: provide name_key (slice label) and y_key (value).
For scatter: x_key and y_key define the two numeric axes.
For radar: x_key is the attribute dimension, y_key is the value.
For composed: line+bar combo. y_key for bars, y_key2 for line.
For waterfall: x_key=step labels, y_key=values (positive=gain, negative=loss).

QUERY_CONFIG format:
- source: "operations" | "compartments" | "compartment_species" | "plan_metadata"
- aggregate: array of { group_by: "column_name" }
- values: array of { field: "column", as: "output_name", fn: "sum"|"count"|"avg"|"min"|"max" }
  - Optional multiply: number — e.g. multiply: -1 for costs to display below zero
  - Optional op: "multiply"|"divide" + operand: "column" — per-row arithmetic BEFORE aggregation.
    Example: values:[{field:"volume_m3", as:"vol_ha", fn:"avg", op:"divide", operand:"comp.area_ha"}]
    This computes volume_m3/area_ha on each raw row, then averages the results (per-stand volume/ha).
    Use comp. prefix for join columns on operations source; use bare names on compartments source.
  - Optional cumulative: true — convert period sums to running totals (for area charts).
- filters (optional): object with column:value pairs (arrays for IN filters)
- sort (optional): { by: "column", dir: "asc"|"desc" }
- limit (optional): max rows (default 500)
- join (optional): { table: "compartments", on: "compartment_id", fields: ["main_species", ...] }

For joined fields in aggregate, prefix with "comp." (e.g. "comp.main_species"). The computed field "removal_m3" (volume_m3 × removal_pct / 100) is available for operations with a join.`,
        parameters: {
          type: "object",
          properties: {
            chart_id: { type: "string", description: "Auto-generated unique ID (derived from title). Omit — the system generates it for you." },
            title_en: { type: "string", description: "English chart title (REQUIRED)" },
            title_fi: { type: "string", description: "Finnish chart title. Always provide both title_en and title_fi." },
            type: { type: "string", enum: ["bar", "pie", "line", "area", "stacked_bar", "scatter", "radar", "donut", "horizontal_bar", "composed", "waterfall"] },
            query_config: { type: "object", description: "Declarative query config for auto-updating charts (preferred). Must specify source, aggregate, and values." },
            data: { type: "array", items: { type: "object" }, description: "Array of data objects (required if no query_config)" },
            x_key: { type: "string", description: "X-axis/category key" },
            y_key: { type: "string", description: "Y-axis/value key" },
            y_key2: { type: "string", description: "Secondary Y-axis key (composed charts)" },
            name_key: { type: "string", description: "Slice label key (pie/donut)" },
            color_key: { type: "string", description: "Color grouping key" },
            waterfall_base: { type: "number", description: "Starting base value for waterfall charts" },
          },
          required: ["title_en", "type", "y_key"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "select_stand",
        description: `Select and zoom to stands on the map (gold outline + auto-zoom). Two modes:

1. By stand_ids: pass ['7'] or ['5','12','89.1'] — use this when the user names specific stands.

2. By criteria: pass age_min, age_max, species, development_classes, site_types, area_min, area_max, volume_min, or volume_max. The tool searches internally and selects all matching stands. Use this when the user says "select all stands over 100 years" or "select pine stands". Do NOT call search_stands first — just pass the criteria directly to select_stand.

ONLY call this tool when the user EXPLICITLY asks to see, select, show, or zoom to stands. Do NOT call after add_operation, remove_operation, generate_plan, or create_chart.`,
        parameters: {
          type: "object",
          properties: {
            stand_ids: { type: "array", items: { type: "string" }, description: "Array of stand IDs, e.g. ['7'] or ['5','12','89.1']. Use when the user names specific stands." },
            age_min: { type: "number", description: "Minimum stand age — use when user says 'over X years old'" },
            age_max: { type: "number" },
            species: { type: "array", items: { type: "string" }, description: "Main tree species, e.g. ['pine', 'spruce']" },
            development_classes: { type: "array", items: { type: "string" } },
            site_types: { type: "array", items: { type: "string" } },
            area_min: { type: "number" }, area_max: { type: "number" },
            volume_min: { type: "number" }, volume_max: { type: "number" },
            basal_area_min: { type: "number" }, basal_area_max: { type: "number" },
            height_min: { type: "number" }, height_max: { type: "number" },
            diameter_min: { type: "number" }, diameter_max: { type: "number" },
            growth_min: { type: "number" }, growth_max: { type: "number" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "remove_chart",
        description: `Remove a single chart tab by its chart_id. Use when the user asks to remove a specific chart.`,
        parameters: {
          type: "object",
          properties: {
            chart_id: { type: "string", description: "Chart ID to remove, e.g. 'chart-species-distribution'" },
          },
          required: ["chart_id"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "clear_charts",
        description: `Remove all chart tabs from the visualization panel. Use when the user wants to start over with charts.`,
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    // ── Chart management tools (C7, C8) ──
    {
      type: "function",
      function: {
        name: "list_charts",
        description: `List all chart tabs currently in the visualization panel. Returns chart_id, title, type, and key rendering properties for each chart. Also returns the query_config (if any) — the declarative data source definition. Use this BEFORE calling update_chart, recreate_chart, or remove_chart when the user refers to a chart by its title or description rather than an explicit chart_id.

The data field (computed cache of chart values) is NOT returned — it's too large. If you need to inspect chart data values, look at the query_config instead.`,
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_chart",
        description: `Modify an existing chart's appearance. Use when the user asks to change chart type (bar→pie), axis keys, title, or colors. Does NOT recompute data — fast. To change the underlying data query, use recreate_chart instead.`,
        parameters: {
          type: "object",
          properties: {
            chart_id: { type: "string", description: "Chart ID to update" },
            title_en: { type: "string", description: "New English chart title" },
            title_fi: { type: "string", description: "New Finnish chart title" },
            type: { type: "string", enum: ["bar","pie","line","area","stacked_bar","scatter","radar","donut","horizontal_bar","composed","waterfall"], description: "New chart type" },
            x_key: { type: "string" },
            y_key: { type: "string" },
            y_key2: { type: "string" },
            name_key: { type: "string" },
            color_key: { type: "string" },
            waterfall_base: { type: "number" },
          },
          required: ["chart_id"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "recreate_chart",
        description: `Recompute an existing chart with a new or modified query_config. Use when the user asks to change the underlying data (e.g., 'add costs to the income chart', 'show only thinnings'). The new query_config replaces the old one and data is recomputed.`,
        parameters: {
          type: "object",
          properties: {
            chart_id: { type: "string", description: "Chart ID to recreate" },
            query_config: { type: "object", description: "New declarative query config (must specify source, aggregate, and values)" },
            title_en: { type: "string" },
            title_fi: { type: "string" },
            type: { type: "string", enum: ["bar","pie","line","area","stacked_bar","scatter","radar","donut","horizontal_bar","composed","waterfall"] },
            x_key: { type: "string" },
            y_key: { type: "string" },
            y_key2: { type: "string" },
            name_key: { type: "string" },
            color_key: { type: "string" },
            waterfall_base: { type: "number" },
          },
          required: ["chart_id", "query_config"],
        },
      },
    },
  ];
}