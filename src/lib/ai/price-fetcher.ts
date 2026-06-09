// src/lib/ai/price-fetcher.ts
// Phase 7b (T6): Fetches real-time timber prices from Luke PxWeb API.
// Caches results in the timber_prices table per region.
// Fallback chain: fresh cache (≤24h) → stale cache (≤7d) → live fetch → hardcoded PRICES × region multiplier.

import type { SupabaseClient } from "@supabase/supabase-js";
import { PRICES, PRICE_REGION_MULTIPLIERS } from "./config";

// ── Types ──

export interface TimberPrice {
  /** €/m³ for sawlog (tukki) */
  tukki: number;
  /** €/m³ for pulpwood (kuitu) */
  kuitu: number;
}

export interface PriceData {
  /** Region code ("1"–"9", "71", "72") */
  region: string;
  /** Week code (e.g. "2026W22") */
  week: string;
  /** Prices by operation tier and species */
  prices: Record<string, Record<string, TimberPrice>>;
  /** When these prices were fetched */
  fetchedAt: Date;
}

// ── Luke API ──

const LUKE_API = "https://statdb.luke.fi/PxWeb/api/v1/fi/LUKE/met/metryv/0100_metryv.px";

/** Compute ISO week code for a given date offset (0 = today, -1 = last week, etc.) */
function computeWeekCode(weekOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + weekOffset * 7);
  const year = d.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const dayNum = (d.getTime() - jan1.getTime()) / 86400000;
  const weekNum = Math.ceil((dayNum + jan1.getDay() + 1) / 7);
  return `${year}W${String(weekNum).padStart(2, "0")}`;
}

// Luke operation type → HAKT code
const HAKT_MAP: Record<string, string> = {
  clear_cut: "8021",
  thinning: "8023",
  first_thinning: "8022",
  selection_cutting: "8023",
};

// Species → PTL codes
function getPTLCodes(species: string): string[] {
  switch (species) {
    case "pine": return ["N1", "N4"];
    case "spruce": return ["N2", "N5"];
    case "silver_birch":
    case "birch": return ["N3", "N6"];
    case "downy_birch": return ["N3", "N6"]; // mostly pulp
    default: return ["N1", "N4"]; // fallback to pine
  }
}

/**
 * Fetch timber prices from Luke PxWeb API for a given region.
 * Tries the previous week first (Luke publishes with one-week delay),
 * then falls back up to 8 weeks.
 */
async function fetchLukePrices(region: string): Promise<PriceData | null> {
  for (let offset = -1; offset >= -8; offset--) {
    const week = computeWeekCode(offset);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(LUKE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: [
            { code: "W", selection: { filter: "item", values: [week] } },
            { code: "MPKH", selection: { filter: "item", values: [region] } },
          ],
          response: { format: "json" },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) continue;

      const data = await response.json();
      if (!data?.data || data.data.length === 0) continue;

      // Parse the response into PriceData
      const prices: Record<string, Record<string, TimberPrice>> = {
        clear_cut: {},
        thinning: {},
        first_thinning: {},
      };

      for (const row of data.data) {
        const [_, hakT, ptl] = row.key;
        const value = parseFloat(row.values[0]);
        if (isNaN(value)) continue;

        const tier = hakT === "8021" ? "clear_cut"
          : hakT === "8022" ? "first_thinning"
          : hakT === "8023" ? "thinning"
          : null;
        if (!tier) continue;

        // Map PTL code to species + type
        const speciesMap: Record<string, string> = {
          N1: "pine", N2: "spruce", N3: "birch",
          N4: "pine", N5: "spruce", N6: "birch",
        };
        const species = speciesMap[ptl];
        if (!species) continue;

        const isTukki = ["N1", "N2", "N3"].includes(ptl);
        if (!prices[tier][species]) {
          prices[tier][species] = { tukki: 0, kuitu: 0 };
        }
        if (isTukki) {
          prices[tier][species].tukki = value;
        } else {
          prices[tier][species].kuitu = value;
        }
      }

      return { region, week, prices, fetchedAt: new Date() };
    } catch {
      continue; // timeout or network error — try next week
    }
  }

  return null;
}

// ── Cache ──

async function getCachedPrices(
  supabase: SupabaseClient,
  region: string,
): Promise<PriceData | null> {
  const { data } = await supabase
    .from("timber_prices")
    .select("*")
    .eq("region", region)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .single();

  if (!data?.price_data || !data?.fetched_at) return null;

  const age = Date.now() - new Date(data.fetched_at).getTime();
  const maxAge = 7 * 24 * 3600 * 1000; // 7 days
  if (age > maxAge) return null;

  return {
    region,
    week: data.price_data.week ?? "unknown",
    prices: data.price_data.prices ?? {},
    fetchedAt: new Date(data.fetched_at),
  };
}

async function saveToCache(
  supabase: SupabaseClient,
  priceData: PriceData,
): Promise<void> {
  await supabase.from("timber_prices").insert({
    region: priceData.region,
    price_data: {
      week: priceData.week,
      prices: priceData.prices,
    },
    fetched_at: priceData.fetchedAt.toISOString(),
    source: "luke_pxweb",
  });
}

// ── Public API ──

/**
 * Get timber prices for a region, with caching and fallback.
 * Returns live prices if available, otherwise fallback to hardcoded PRICES × region multiplier.
 */
export async function getPricesForRegion(
  supabase: SupabaseClient,
  region: string,
): Promise<{ prices: Record<string, Record<string, TimberPrice>>; source: string }> {
  // 1. Try cache (≤24h fresh, ≤7d stale)
  const cached = await getCachedPrices(supabase, region);
  if (cached) {
    const age = Date.now() - cached.fetchedAt.getTime();
    if (age <= 24 * 3600 * 1000) {
      return { prices: cached.prices, source: `cache (${cached.week})` };
    }
  }

  // 2. Try live fetch
  const live = await fetchLukePrices(region);
  if (live) {
    await saveToCache(supabase, live);
    return { prices: live.prices, source: `live (${live.week})` };
  }

  // 3. Fallback to hardcoded PRICES × region multiplier
  const multiplier = PRICE_REGION_MULTIPLIERS[region] ?? 1.0;
  const fallback: Record<string, Record<string, TimberPrice>> = {};
  for (const [tier, speciesPrices] of Object.entries(PRICES)) {
    fallback[tier] = {};
    for (const [species, price] of Object.entries(speciesPrices)) {
      fallback[tier][species] = {
        tukki: Math.round(price.tukki * multiplier * 100) / 100,
        kuitu: Math.round(price.kuitu * multiplier * 100) / 100,
      };
    }
  }

  return { prices: fallback, source: `fallback (×${multiplier})` };
}

/**
 * Get price for a specific operation type and species.
 * Convenience wrapper around getPricesForRegion.
 */
export async function getOperationPrice(
  supabase: SupabaseClient,
  region: string,
  operationType: string,
  species: string,
): Promise<TimberPrice> {
  const { prices } = await getPricesForRegion(supabase, region);

  const tier = operationType === "clear_cut" ? "clear_cut"
    : operationType === "first_thinning" ? "first_thinning"
    : operationType === "thinning" || operationType === "selection_cutting" ? "thinning"
    : "thinning";

  const sp = species === "birch" ? "silver_birch" : species;
  return prices[tier]?.[sp] ?? prices.thinning?.pine ?? { tukki: 70, kuitu: 20 };
}
