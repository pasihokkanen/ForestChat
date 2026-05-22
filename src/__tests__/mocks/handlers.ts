/**
 * MSW handlers — mock Supabase REST API for integration tests.
 *
 * Use http.get / http.post to intercept fetch calls to supabase.co.
 * Each test can add route-specific overrides via server.use().
 */
import { http, HttpResponse } from "msw";

const SUPABASE_URL = "https://rqflvuldwgognmoanvcg.supabase.co";

export const handlers = [
  // ── compartments ──
  http.get(`${SUPABASE_URL}/rest/v1/compartments`, ({ request }) => {
    const url = new URL(request.url);
    const forestId = url.searchParams.get("forest_id");

    // Return test data keyed by forest_id
    const compartments = {
      "eq.test-forest": [
        {
          id: "comp-1",
          forest_id: "test-forest",
          stand_id: "1",
          main_species: "Pine",
          development_class: "Varttunut kasvatusmetsikkö",
          site_type: "tuore",
          area_ha: 2.5,
          age_years: 55,
          volume_m3: 450,
          geometry: {
            type: "MultiPolygon",
            coordinates: [[[[24.0, 62.5], [24.01, 62.5], [24.01, 62.51], [24.0, 62.51], [24.0, 62.5]]]],
          },
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "comp-2",
          forest_id: "test-forest",
          stand_id: "2",
          main_species: "Spruce",
          development_class: "Uudistuskypsä",
          site_type: "tuore",
          area_ha: 3.1,
          age_years: 85,
          volume_m3: 680,
          geometry: {
            type: "MultiPolygon",
            coordinates: [[[[24.02, 62.50], [24.03, 62.50], [24.03, 62.51], [24.02, 62.51], [24.02, 62.50]]]],
          },
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    };

    const key = forestId;
    if (compartments[key as keyof typeof compartments]) {
      return HttpResponse.json(compartments[key as keyof typeof compartments]);
    }
    return HttpResponse.json([]);
  }),

  // ── forests ──
  http.get(`${SUPABASE_URL}/rest/v1/forests`, ({ request }) => {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (id === "eq.test-forest") {
      return HttpResponse.json([
        {
          id: "test-forest",
          owner_id: "user-1",
          name: "Test Forest",
          municipality: "Ähtäri",
          property_id: "989-405-0001-0405",
          total_area_ha: 250,
          data_source: "mml_wfs",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ]);
    }
    return HttpResponse.json([]);
  }),

  // ── operations ──
  http.get(`${SUPABASE_URL}/rest/v1/operations`, () => {
    return HttpResponse.json([]);
  }),
];

// Prefer header returned by real Supabase
export const supabaseHeaders = {
  "content-type": "application/json",
  "content-range": "0-1/2",
};