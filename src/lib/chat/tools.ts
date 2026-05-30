// src/lib/chat/tools.ts — T8.4b Tool Definitions
//
// OpenRouter/OpenAI function-calling tool definitions.
// Each tool has name, description, and JSON Schema parameters.
// Returns all 10 tool definitions: generate_plan, get_stand, search_stands,
// plan_summary, query_operations, batch_update_operations, add_operation,
// remove_operation, check_harvest_sustainability, validate_plan.

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
        description: "Search compartments (kuviot) by any combination of criteria. All parameters optional — omit to get all stands (useful for overview). Filter values can be in Finnish OR English (e.g. 'Mänty' or 'Pine', 'tuore' or 'mesic') — handler auto-translates. The fields parameter only returns the requested columns from the database, reducing response size.",
        parameters: {
          type: "object",
          properties: {
            stand_ids: { type: "array", items: { type: "string" }, description: "List of specific stand IDs, e.g. ['5', '12', '89.1']" },
            species: { type: "array", items: { type: "string" }, description: "Main tree species in Finnish or English, e.g. ['Mänty', 'Kuusi']" },
            development_classes: { type: "array", items: { type: "string" }, description: "e.g. ['Uudistuskypsä metsikkö', 'Varttunut kasvatusmetsikkö', 'Nuori kasvatusmetsikkö', 'Taimikko']" },
            site_types: { type: "array", items: { type: "string" }, description: "e.g. ['tuore', 'lehtomainen', 'kuivahko', 'kuiva']" },
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
        description: "Search planned operations by any combination of criteria. Returns each operation with full stand data (species, age, development class, etc.) via a single JOINed query. All parameters optional — omit years to search all years. Filter values in Finnish OR English — auto-translated. The fields parameter limits database columns AND response text for efficiency.",
        parameters: {
          type: "object",
          properties: {
            years: { type: "array", items: { type: "number" }, description: "List of specific years, e.g. [2026, 2028]. Returns operations in ANY of these years." },
            types: { type: "array", items: { type: "string" }, description: "Operation types, e.g. ['Päätehakkuu', 'Harvennus', 'Ensiharvennus', 'Taimikonhoito', 'Laikkumätästys']" },
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
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "batch_update_operations",
        description: "Update multiple operations at once. Filter selects which operations to modify, update specifies what to change. Use this for bulk modifications like 'move all 2026 thinnings to 2028'. When the user says 'move harvests', filter by harvest types (Päätehakkuu, Harvennus, Ensiharvennus, Poimintahakkuu). When they say 'move silvicultural work', filter by cost operation types. Each `.update()` call is atomic at the DB level. Max 500 operations per call.",
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
        description: `Add or update an operation for a stand. Validates type against silvicultural rules:
- Clear_cut: only for regeneration-ready stands, removal 100%
- Thinning: mature thinning stand, age >= 45 (pine) / 40 (spruce), removal ~28%
- First_thinning: young thinning stand, removal ~25%
- Selection_cutting: special case, removal 50%
- Tending/Early_tending: seedling stands
- Site_prep/Planting: after clearcut

Validation is performed server-side before the operation is added.`,
        parameters: {
          type: "object",
          properties: {
            stand_id: { type: "string", description: "Stand ID (e.g., '7', '89.1')" },
            year: { type: "number", description: "Year of operation" },
            type: { type: "string", description: "Operation type: Päätehakkuu, Harvennus, Ensiharvennus, Poimintahakkuu, Taimikonhoito, Taimikon varhaishoito, Ennakkoraivaus, Laikkumätästys, Ojitusmätästys, Laikutus, Istutus, Kuusen istutus, Männyn istutus" },
            removal_pct: { type: "number", description: "Removal percentage (default: 100 for clearcut, 28 for thinning, 25 for first thinning, 50 for selection cutting)" },
          },
          required: ["stand_id", "year", "type"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "remove_operation",
        description: "Remove a planned operation from a stand for a given year. Used to reschedule or cancel operations. All operations for that stand+year will be removed.",
        parameters: {
          type: "object",
          properties: {
            stand_id: { type: "string", description: "Stand ID (e.g., '7', '89.1')" },
            year: { type: "number", description: "Year of operation to remove" },
          },
          required: ["stand_id", "year"],
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

If chart categories map to stands, set stand_dimension to the key containing stand_id values — enables click-to-highlight-on-map.

QUERY_CONFIG format:
- source: "operations" | "compartments" | "compartment_species" | "plan_metadata"
- aggregate: array of { group_by: "column_name" }
- values: array of { field: "column", as: "output_name", fn: "sum"|"count"|"avg"|"min"|"max" }
  - Optional multiply: number — e.g. multiply: -1 for costs to display below zero
- filters (optional): object with column:value pairs (arrays for IN filters)
- sort (optional): { by: "column", dir: "asc"|"desc" }
- limit (optional): max rows (default 500)
- join (optional): { table: "compartments", on: "compartment_id", fields: ["main_species", ...] }

For joined fields in aggregate, prefix with "comp." (e.g. "comp.main_species"). The computed field "removal_m3" (volume_m3 × removal_pct / 100) is available for operations with a join.`,
        parameters: {
          type: "object",
          properties: {
            chart_id: { type: "string", description: "Unique ID, e.g. 'chart-yearly-income'" },
            title: { type: "string", description: "Chart title" },
            type: { type: "string", enum: ["bar", "pie", "line", "area", "stacked_bar", "scatter", "radar", "donut", "horizontal_bar", "composed", "waterfall"] },
            query_config: { type: "object", description: "Declarative query config for auto-updating charts (preferred). Must specify source, aggregate, and values." },
            data: { type: "array", items: { type: "object" }, description: "Array of data objects (required if no query_config)" },
            x_key: { type: "string", description: "X-axis/category key" },
            y_key: { type: "string", description: "Y-axis/value key" },
            y_key2: { type: "string", description: "Secondary Y-axis key (composed charts)" },
            name_key: { type: "string", description: "Slice label key (pie/donut)" },
            color_key: { type: "string", description: "Color grouping key" },
            stand_dimension: { type: "string", description: "Key mapping to stand_id for cross-panel interaction" },
          },
          required: ["chart_id", "title", "type", "y_key"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "select_stand",
        description: `Select and zoom to a stand on the map. The stand is highlighted with a gold outline and a popup with all stand data appears. IMPORTANT: ALWAYS call this tool when the user asks to see/select/show a stand — even if it was shown before. The user may have clicked another stand on the map since and broken the previous selection. Never skip this tool or assume the stand is already selected. Just select — don't also call get_stand or describe the data in text, the map popup already shows everything.`,
        parameters: {
          type: "object",
          properties: {
            stand_id: { type: "string", description: "Stand ID to select, e.g. '7'" },
          },
          required: ["stand_id"],
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
  ];
}