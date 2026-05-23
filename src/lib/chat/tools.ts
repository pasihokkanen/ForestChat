// src/lib/chat/tools.ts — T8.4 Tool Definitions
//
// OpenRouter/OpenAI function-calling tool definitions.
// Each tool has name, description, and JSON Schema parameters.
// Returns all 9 tool definitions: generate_plan, get_stand, search_stands,
// plan_summary, year_operations, add_operation, remove_operation,
// check_harvest_sustainability, validate_plan.

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
        description: "Search stands by criteria. All parameters optional.",
        parameters: {
          type: "object",
          properties: {
            species: { type: "string", description: "Finnish name (Mänty, Kuusi, Rauduskoivu, Hieskoivu, Lehtikuusi, Harmaaleppä) or English (Pine, Spruce, Birch, etc.) — handler translates automatically" },
            site_type: { type: "string", description: "Finnish (tuore, lehtomainen, kuivahko, kuiva) or English (mesic, herb-rich, sub-xeric, xeric)" },
            development_class: { type: "string", description: "Finnish kehitysluokka: Uudistuskypsä metsikkö, Varttunut kasvatusmetsikkö, Nuori kasvatusmetsikkö, Taimikko, Aukea, Siemenpuumetsikkö" },
            min_age: { type: "number" },
            max_age: { type: "number" },
            min_area: { type: "number" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "plan_summary",
        description: "Get a comprehensive summary of the current forest plan: total volume, annual growth, stumpage value, operations by period (P1: 2026-2035, P2: 2036-2045), income, costs, and net return.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "year_operations",
        description: "List all planned operations for a given year, organized by type (clearcuts, thinnings, regeneration, tending).",
        parameters: {
          type: "object",
          properties: {
            year: { type: "number", description: "Year to query (e.g., 2026)" },
          },
          required: ["year"],
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
  ];
}