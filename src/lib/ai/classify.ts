// src/lib/ai/classify.ts

import type { Compartment } from "@/types/database";
import type { KuviotData, PlannedOperation } from "./types";
import {
  classifySite,
  detectPeatland,
  getPrices,
  getOptimalAge,
  GROWTH_PEATLAND,
  GROWTH_MINERAL,
  THINNING_BA,
  MIN_AGE_ENSIHARVENNUS,
  MIN_AGE_HARVENNUS,
  COSTS,
  PRICES,
} from "./config";

/**
 * Convert a Compartment from the database into the enriched KuviotData format
 * used by the forestry engine.
 */
function compartmentToKuviotData(c: Compartment): KuviotData {
  const kasvupaikka = c.site_type ?? "";
  const maalaji = c.soil_type ?? "";
  const ojitustilanne = c.drainage_status ?? "";
  const siteClass = classifySite(kasvupaikka);
  const isPeatland = detectPeatland(maalaji, kasvupaikka, "", ojitustilanne);

  return {
    numero: c.stand_id,
    ala: c.area_ha ?? 0,
    kehitysluokka: c.development_class ?? "",
    kasvupaikka,
    maalaji,
    ojitustilanne,
    paapuulaji: c.main_species ?? "",
    site_class: siteClass,
    is_peatland: isPeatland,
    annual_growth: 0, // computed below
    arvo: 0, // computed below
    tukki_m3: 0, // computed below
    kuitu_m3: 0, // computed below
    ikä: c.age_years ?? 0,
    ba: c.basal_area ?? 0,
    m3: c.volume_m3 ?? 0,
  };
}

/**
 * Get species breakdown from compartment attributes.
 * The raw data has an array under attributes.species with objects
 * { species: string, m3: number, log_pct: number }.
 */
interface RawSpecies {
  species: string;
  m3: number;
  log_pct: number;
}

function getSpeciesData(c: Compartment): RawSpecies[] {
  const attrs = c.attributes;
  if (attrs && Array.isArray(attrs["species"])) {
    return attrs["species"] as RawSpecies[];
  }
  return [];
}

/**
 * Calculate stumpage value (arvo) for a stand.
 *
 * For each species:
 *   tukki_m3 = m3 * log_pct / 100
 *   kuitu_m3 = m3 - tukki_m3
 *   value = tukki_m3 * tukki_hinta + kuitu_m3 * kuitu_hinta
 *
 * If no species breakdown, use the aggregate volume and the main species prices.
 */
function calculateValue(k: KuviotData, species: RawSpecies[]): {
  arvo: number;
  tukki_m3: number;
  kuitu_m3: number;
} {
  let totalArvo = 0;
  let totalTukki = 0;
  let totalKuitu = 0;

  if (species.length > 0) {
    for (const sp of species) {
      const spKey = sp.species === "birch" ? "silver_birch" : sp.species;
      const spPrices = PRICES["uudistushakkuu"]?.[spKey] ?? PRICES["uudistushakkuu"]?.["Mänty"] ?? { tukki: 70, kuitu: 20 };
      const tukkiM3 = sp.m3 * sp.log_pct / 100;
      const kuituM3 = sp.m3 - tukkiM3;
      totalTukki += tukkiM3;
      totalKuitu += kuituM3;
      totalArvo += tukkiM3 * spPrices.tukki + kuituM3 * spPrices.kuitu;
    }
  } else {
    // Fallback: use aggregate volume and main species prices
    const pp = k.paapuulaji;
    const priceKey = pp === "Koivu" ? "Rauduskoivu" : pp;
    const prices = PRICES["uudistushakkuu"]?.[priceKey] ?? PRICES["uudistushakkuu"]?.["Mänty"] ?? { tukki: 70, kuitu: 20 };
    const tukkiM3 = k.m3 * 0.6; // assume ~60% tukki if no species breakdown
    const kuituM3 = k.m3 - tukkiM3;
    totalTukki = tukkiM3;
    totalKuitu = kuituM3;
    totalArvo = tukkiM3 * prices.tukki + kuituM3 * prices.kuitu;
  }

  return {
    arvo: Math.round(totalArvo),
    tukki_m3: Math.round(totalTukki * 10) / 10,
    kuitu_m3: Math.round(totalKuitu * 10) / 10,
  };
}

export interface ClassifyResult {
  forestKuviot: KuviotData[];
  operations: PlannedOperation[];
  totalArea: number;
  totalVolume: number;
  totalValue: number;
  totalGrowth: number;
}

/**
 * Classify and value all stands in the forest.
 *
 * Ported from build_plan_v3_fixed.py lines 191-389.
 */
export function classifyAndValueStands(
  compartments: Compartment[],
  currentYear?: number
): ClassifyResult {
  const cy = currentYear ?? new Date().getFullYear();
  const skipKl = ["Muu maa", "Maatalousmaa", "Tontti"];

  const forestKuviot: KuviotData[] = [];
  const operations: PlannedOperation[] = [];
  let totalArea = 0;
  let totalVolume = 0;
  let totalValue = 0;
  let totalGrowth = 0;

  for (const c of compartments) {
    const kl = c.development_class ?? "";
    // Skip non-forest, null/empty, zero area, no volume
    if (skipKl.includes(kl) || kl === "" || kl === "null" || !c.area_ha || c.area_ha <= 0 || !c.volume_m3) {
      continue;
    }

    const k = compartmentToKuviotData(c);
    const species = getSpeciesData(c);

    // Select growth rate: peatland or mineral soil
    const growthDict = k.is_peatland ? GROWTH_PEATLAND : GROWTH_MINERAL;
    const gr = growthDict[k.site_class] ?? 3.0;
    k.annual_growth = gr * k.ala;

    // Calculate stumpage value
    const { arvo, tukki_m3, kuitu_m3 } = calculateValue(k, species);
    k.arvo = arvo;
    k.tukki_m3 = tukki_m3;
    k.kuitu_m3 = kuitu_m3;

    // Aggregate totals
    totalArea += k.ala;
    totalVolume += k.m3;
    totalValue += k.arvo;
    totalGrowth += k.annual_growth;

    forestKuviot.push(k);
  }

  // ── Classify each kuvio (determine operations) ──
  for (const k of forestKuviot) {
    const y = { m3: k.m3, ika: k.ikä, ba: k.ba };
    const pp = k.paapuulaji;
    const kl = k.kehitysluokka;
    const site = k.site_class;
    const age = y.ika;
    const ba = y.ba;
    const ala = k.ala;
    const m3 = k.m3;
    const arvo = k.arvo;
    const knum = parseFloat(k.numero.replace(",", "."));

    // === SPECIAL CASES ===

    // K180: selection cutting
    if (Math.abs(knum - 180.0) < 0.01) {
      operations.push({
        kuvio: k,
        type: "Poimintahakkuu",
        year: cy,
        income_eur: Math.round(arvo * 0.5),
        cost_eur: 0,
        removal_m3: Math.round(m3 * 0.5),
        notes: "Maisemallinen poimintahakkuu 50%",
      });
      continue;
    }

    // K128: labeled uudistuskypsä but only 57v → harvennus, NOT final harvest
    if (Math.abs(knum - 128.0) < 0.01) {
      const priceKey = pp === "Koivu" ? "Rauduskoivu" : pp;
      const hp = getPrices("harvennus", priceKey);
      const up = getPrices("uudistushakkuu", priceKey);
      const ratio = (hp.tukki + hp.kuitu) / (up.tukki + up.kuitu);
      const removal = m3 * 0.30;
      const income = Math.round(arvo * 0.30 * ratio);
      operations.push({
        kuvio: k,
        type: "Harvennus",
        year: cy,
        income_eur: income,
        cost_eur: 0,
        removal_m3: Math.round(removal),
        notes: "EI päätehakkuu – 57 v liian nuori. Voimakas harvennus 30%",
      });
      continue;
    }

    // K71, K72: recently thinned, do nothing in period 1
    if (Math.abs(knum - 71.0) < 0.01 || Math.abs(knum - 72.0) < 0.01) {
      continue;
    }

    // Kuvio 5: siirretään harvennus myöhemmäksi (2033)
    if (Math.abs(knum - 5.0) < 0.01) {
      const priceKey = pp === "Koivu" ? "Rauduskoivu" : pp;
      const hp = getPrices("harvennus", priceKey);
      const up = getPrices("uudistushakkuu", priceKey);
      const ratio = (hp.tukki + hp.kuitu) / (up.tukki + up.kuitu);
      // Project growth to 2033 (7 years from 2026)
      const growthYears = 7; // 2033 - 2026
      const futureM3 = m3 + k.annual_growth * growthYears;
      const futureArvo = m3 > 0 ? Math.round(arvo * (futureM3 / m3)) : arvo;
      const removal = Math.round(futureM3 * 0.28);
      const income = Math.round(futureArvo * 0.28 * ratio);
      operations.push({
        kuvio: k,
        type: "Harvennus",
        year: cy,
        income_eur: income,
        cost_eur: 0,
        removal_m3: removal,
        notes: `BA=${ba.toFixed(0)}, ikä ${age.toFixed(0)}v → SIIRRETTY 2026→2033 (ed. harvennus 2020, väli 13v)`,
      });
      // Mark for manual placement in schedule
      k._manual_year = 2033;
      k._manual_income = income;
      k._manual_removal = removal;
      k._manual_arvo = futureArvo;
      continue;
    }

    // === REGENERATION_READY → PÄÄTEHAKKUU ===
    if (kl.includes("regeneration_ready")) {
      const [optMin, optMax] = getOptimalAge(pp, site);
      operations.push({
        kuvio: k,
        type: "Päätehakkuu",
        year: cy,
        income_eur: arvo,
        cost_eur: 0,
        removal_m3: Math.round(m3),
        notes: `Ikä ${age.toFixed(0)}v [${optMin}-${optMax}v]`,
      });
      continue;
    }

    // === SIEMENPUUMETSIKKÖ → UUDISTAMINEN ===
    if (kl.includes("shelterwood")) {
      operations.push({
        kuvio: k,
        type: "Laikkumätästys",
        year: cy,
        income_eur: 0,
        cost_eur: Math.round(COSTS["Laikkumätästys"] * ala),
        removal_m3: 0,
        notes: "Uudistaminen",
      });
      operations.push({
        kuvio: k,
        type: "Männyn istutus",
        year: cy,
        income_eur: 0,
        cost_eur: Math.round(COSTS["Männyn istutus"] * ala),
        removal_m3: 0,
        notes: "",
      });
      continue;
    }

    // === AUKEA → UUDISTAMINEN (jos ei puita) ===
    if (kl.includes("open_area") && m3 < 5) {
      operations.push({
        kuvio: k,
        type: "Laikkumätästys",
        year: cy,
        income_eur: 0,
        cost_eur: Math.round(COSTS["Laikkumätästys"] * ala),
        removal_m3: 0,
        notes: "Uudistaminen",
      });
      const opsSpecies = site.includes("tuore") || site.includes("lehto") ? "Kuusen" : "Männyn";
      const plantCost = Math.round(COSTS[`${opsSpecies} istutus`] * ala);
      operations.push({
        kuvio: k,
        type: `${opsSpecies} istutus`,
        year: cy,
        income_eur: 0,
        cost_eur: plantCost,
        removal_m3: 0,
        notes: "",
      });
      continue;
    }

    // === TAIMIKKO / SEEDLING (alle 1,3 m) ===
    if (kl.includes("seedling") && age >= 3 && age <= 12) {
        operations.push({
          kuvio: k,
          type: "Taimikon varhaishoito",
          year: cy,
          income_eur: 0,
          cost_eur: Math.round(COSTS["Taimikon varhaishoito"] * ala),
          removal_m3: 0,
          notes: `Ikä ${age.toFixed(0)}v`,
        });
      continue;
    }

    // === TAIMIKKO / SEEDLING (yli 1,3 m) ===
    if (kl.includes("seedling") && age >= 10 && age <= 25) {
        operations.push({
          kuvio: k,
          type: "Taimikonhoito",
          year: cy,
          income_eur: 0,
          cost_eur: Math.round(COSTS["Taimikonhoito"] * ala),
          removal_m3: 0,
          notes: `Ikä ${age.toFixed(0)}v`,
        });
      continue;
    }

    // === YOUNG_THINNING → ENSIHARVENNUS ===
    if (kl.includes("young_thinning")) {
      const thresh = THINNING_BA["ensiharvennus"]?.[pp] ?? 18;
      const minAge = MIN_AGE_ENSIHARVENNUS?.[pp] ?? 30;
      if (ba >= thresh && age >= minAge) {
        const priceKey = pp === "Koivu" ? "Rauduskoivu" : pp;
        const ep = getPrices("ensiharvennus", priceKey);
        const up = getPrices("uudistushakkuu", priceKey);
        const ratio = (ep.tukki + ep.kuitu) / (up.tukki + up.kuitu);
        const removal = m3 * 0.25;
        const income = Math.round(arvo * 0.25 * ratio);
        operations.push({
          kuvio: k,
          type: "Ensiharvennus",
          year: cy,
          income_eur: income,
          cost_eur: 0,
          removal_m3: Math.round(removal),
          notes: `BA=${ba.toFixed(0)}, ikä ${age.toFixed(0)}v`,
        });
      }
      continue;
    }

    // === MATURE_THINNING → HARVENNUS ===
    if (kl.includes("mature_thinning")) {
      const thresh = THINNING_BA["harvennus"]?.[pp] ?? 22;
      const minAge = MIN_AGE_HARVENNUS?.[pp] ?? 40;
      if (ba >= thresh && age >= minAge) {
        const priceKey = pp === "Koivu" ? "Rauduskoivu" : pp;
        const hp = getPrices("harvennus", priceKey);
        const up = getPrices("uudistushakkuu", priceKey);
        const ratio = (hp.tukki + hp.kuitu) / (up.tukki + up.kuitu);
        const removal = m3 * 0.28;
        const income = Math.round(arvo * 0.28 * ratio);
        operations.push({
          kuvio: k,
          type: "Harvennus",
          year: cy,
          income_eur: income,
          cost_eur: 0,
          removal_m3: Math.round(removal),
          notes: `BA=${ba.toFixed(0)}, ikä ${age.toFixed(0)}v`,
        });
      }
      continue;
    }
  }

  return {
    forestKuviot,
    operations,
    totalArea,
    totalVolume,
    totalValue,
    totalGrowth,
  };
}