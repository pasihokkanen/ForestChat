import { describe, it, expect } from "vitest";
import { parseForestDataCsv } from "@/lib/import/csv-parser";

// Helper to build a CSV string from headers and rows
function csv(headers: string[], rows: string[][]): string {
  return [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\n");
}

describe("parseForestDataCsv", () => {
  // ─── Finnish headers ───────────────────────────────────────────

  it("1. maps Finnish headers to English snake_case field names", () => {
    const csvStr = csv(
      [
        "stand_id", "pinta_ala_ha", "maaluokka", "kehitysluokka",
        "kasvupaikka", "maalaji", "ojitustilanne", "paapuulaji",
        "center_lat", "center_lon", "polygon_wkt",
        "total_ika", "total_ppa", "total_runkoluku", "total_kpituus",
        "total_klapimitta", "total_tukki_pct", "total_m3_ha", "total_m3", "total_pct",
        "mänty_ika", "mänty_ppa", "mänty_runkoluku", "mänty_kpituus",
        "mänty_klapimitta", "mänty_tukki_pct", "mänty_m3_ha", "mänty_m3", "mänty_pct",
      ],
      [
        [
          "1", "3.2", "Kangasmaa", "Nuori kasvatusmetsikkö",
          "tuore kangas", "Hieno hieta", "Ojitettu", "mänty",
          "62.5", "24.1", "MULTIPOLYGON(((24.1 62.5,24.2 62.6)))",
          "25", "15", "1200", "14", "13", "55", "80", "256", "100",
          "24", "10", "800", "13", "11", "50", "6", "20", "60",
        ],
      ]
    );

    const result = parseForestDataCsv(csvStr);
    expect(result.totalStands).toBe(1);

    const s = result.stands[0];
    expect(s.stand_id).toBe("1");
    expect(s.area_ha).toBe(3.2);
    expect(s.land_class).toBe("Kangasmaa");
    expect(s.development_class).toBe("young_thinning"); // translated
    expect(s.site_type).toBe("mesic"); // translated
    expect(s.soil_type).toBe("Hieno hieta"); // passes through
    expect(s.drainage_status).toBe("drained"); // translated
    expect(s.main_species).toBe("pine");
    expect(s.total_age).toBe(25);
    expect(s.total_basal_area).toBe(15);
    expect(s.total_stem_count).toBe(1200);
    expect(s.total_mean_height).toBe(14);
    expect(s.total_mean_diameter).toBe(13);
    expect(s.total_log_pct).toBe(55);
    expect(s.total_m3).toBe(256);
    expect(s.polygon_wkt).toContain("MULTIPOLYGON");
  });

  // ─── English headers ───────────────────────────────────────────

  it("2. parses CSV with English headers — passes through unchanged", () => {
    const csvStr = csv(
      [
        "stand_id", "area_ha", "land_class", "development_class",
        "site_type", "soil_type", "drainage_status", "main_species",
        "center_lat", "center_lon", "polygon_wkt",
        "total_age", "total_basal_area", "total_stem_count", "total_mean_height",
        "total_mean_diameter", "total_log_pct", "total_m3_ha", "total_m3", "total_pct",
        "pine_age", "pine_basal_area", "pine_m3",
      ],
      [
        [
          "1", "3.2", "Kangasmaa", "young_thinning",
          "mesic", "Hieno hieta", "drained", "pine",
          "62.5", "24.1", "MULTIPOLYGON(((24.1 62.5,24.2 62.6)))",
          "25", "15", "1200", "14", "13", "55", "80", "256", "100",
          "24", "10", "20",
        ],
      ]
    );

    const result = parseForestDataCsv(csvStr);
    expect(result.totalStands).toBe(1);

    const s = result.stands[0];
    expect(s.development_class).toBe("young_thinning");
    expect(s.site_type).toBe("mesic");
    expect(s.drainage_status).toBe("drained");
    expect(s.main_species).toBe("pine");
    expect(s.total_age).toBe(25);
    expect(s.total_basal_area).toBe(15);
  });

  // ─── Species name mapping ─────────────────────────────────────

  it("3. maps Finnish species prefix mänty_m3 to species='pine'", () => {
    const csvStr = csv(
      ["stand_id", "area_ha", "total_m3", "mänty_m3"],
      [["1", "3", "50", "30"]]
    );

    const result = parseForestDataCsv(csvStr);
    expect(result.speciesList).toContain("pine");

    const sp = result.stands[0].species[0];
    expect(sp.species).toBe("pine");
    expect(sp.m3).toBe(30);
  });

  it("4. maps all 8 Finnish species prefixes correctly", () => {
    const csvStr = csv(
      ["stand_id", "mänty_m3", "kuusi_m3", "haapa_m3", "harmaaleppä_m3",
       "hieskoivu_m3", "lehtikuusi_m3", "rauduskoivu_m3", "pihlaja_m3"],
      [["1", "10", "20", "5", "3", "7", "2", "8", "1"]]
    );

    const result = parseForestDataCsv(csvStr);
    expect(result.speciesList.sort()).toEqual(
      ["aspen", "downy_birch", "grey_alder", "larch", "pine", "rowan", "silver_birch", "spruce"].sort()
    );
  });

  // ─── Finnish total fields ─────────────────────────────────────

  it("5. maps total_ika → total_age, total_ppa → total_basal_area", () => {
    const csvStr = csv(
      ["stand_id", "total_ika", "total_ppa", "total_runkoluku", "total_kpituus",
       "total_klapimitta", "total_tukki_pct"],
      [["1", "30", "18", "900", "15", "14", "60"]]
    );

    const s = parseForestDataCsv(csvStr).stands[0];
    expect(s.total_age).toBe(30);
    expect(s.total_basal_area).toBe(18);
    expect(s.total_stem_count).toBe(900);
    expect(s.total_mean_height).toBe(15);
    expect(s.total_mean_diameter).toBe(14);
    expect(s.total_log_pct).toBe(60);
  });

  // ─── English total fields pass through ────────────────────────

  it("6. English total fields pass through", () => {
    const csvStr = csv(
      ["stand_id", "total_age", "total_basal_area"],
      [["1", "30", "18"]]
    );

    const s = parseForestDataCsv(csvStr).stands[0];
    expect(s.total_age).toBe(30);
    expect(s.total_basal_area).toBe(18);
  });

  // ─── Finnish species fields ───────────────────────────────────

  it("7. Finnish species fields mapped correctly", () => {
    const csvStr = csv(
      ["stand_id", "mänty_ika", "mänty_ppa", "mänty_tukki_pct"],
      [["1", "24", "10", "50"]]
    );

    const sp = parseForestDataCsv(csvStr).stands[0].species[0];
    expect(sp.species).toBe("pine");
    expect(sp.age).toBe(24);
    expect(sp.basal_area).toBe(10);
    expect(sp.log_pct).toBe(50);
  });

  // ─── English species fields pass through ──────────────────────

  it("8. English species fields pass through", () => {
    const csvStr = csv(
      ["stand_id", "pine_age", "pine_basal_area", "pine_log_pct"],
      [["1", "24", "10", "50"]]
    );

    const sp = parseForestDataCsv(csvStr).stands[0].species[0];
    expect(sp.species).toBe("pine");
    expect(sp.age).toBe(24);
    expect(sp.basal_area).toBe(10);
    expect(sp.log_pct).toBe(50);
  });

  // ─── Mixed headers ────────────────────────────────────────────

  it("9. mixed headers: Finnish prefix + English suffix (mänty_age)", () => {
    const csvStr = csv(
      ["stand_id", "mänty_age"],
      [["1", "24"]]
    );

    const sp = parseForestDataCsv(csvStr).stands[0].species[0];
    expect(sp.species).toBe("pine");
    expect(sp.age).toBe(24);
  });

  it("10. mixed headers: English prefix + Finnish suffix (pine_ika)", () => {
    const csvStr = csv(
      ["stand_id", "pine_ika"],
      [["1", "24"]]
    );

    const sp = parseForestDataCsv(csvStr).stands[0].species[0];
    expect(sp.species).toBe("pine");
    expect(sp.age).toBe(24);
  });

  // ─── Empty cells → null ──────────────────────────────────────

  it("12. empty species columns → null values, not zero", () => {
    const csvStr = csv(
      ["stand_id", "mänty_m3", "mänty_age", "mänty_log_pct"],
      [["1", "50", "", ""]]
    );

    const sp = parseForestDataCsv(csvStr).stands[0].species[0];
    expect(sp.m3).toBe(50);
    expect(sp.age).toBeNull();
    expect(sp.log_pct).toBeNull();
  });

  // ─── Missing polygon_wkt ─────────────────────────────────────

  it("13. stand with missing polygon_wkt → empty string", () => {
    const csvStr = csv(
      ["stand_id", "total_m3"],
      [["1", "100"]]
    );

    const s = parseForestDataCsv(csvStr).stands[0];
    expect(s.polygon_wkt).toBe("");
  });

  // ─── Zero total_m3 ────────────────────────────────────────────

  it("14. stand with total_m3=0 → still imported", () => {
    const csvStr = csv(
      ["stand_id", "total_m3"],
      [["1", "0"]]
    );

    const result = parseForestDataCsv(csvStr);
    expect(result.totalStands).toBe(1);
    expect(result.totalVolumeM3).toBe(0);
  });

  // ─── Valid WKT ────────────────────────────────────────────────

  it("15. valid WKT string contains MULTIPOLYGON", () => {
    const csvStr = csv(
      ["stand_id", "polygon_wkt"],
      [["1", "MULTIPOLYGON(((24.1 62.5,24.2 62.6,24.1 62.6,24.1 62.5)))"]]
    );

    const s = parseForestDataCsv(csvStr).stands[0];
    expect(s.polygon_wkt).toContain("MULTIPOLYGON");
  });

  // ─── Auto-detected species columns ────────────────────────────

  it("16. CSV with different species columns → auto-detected", () => {
    const csvStr = csv(
      ["stand_id", "total_m3", "mänty_m3", "kuusi_m3", "pihlaja_m3"],
      [["1", "100", "60", "30", "10"]]
    );

    const result = parseForestDataCsv(csvStr);
    expect(result.speciesList.sort()).toEqual(["pine", "rowan", "spruce"].sort());
  });

  // ─── Total volume aggregation ─────────────────────────────────

  it("17. total volume matches sum of total_m3", () => {
    const csvStr = csv(
      ["stand_id", "total_m3"],
      [
        ["1", "100"],
        ["2", "200"],
        ["3", "50"],
      ]
    );

    const result = parseForestDataCsv(csvStr);
    expect(result.totalVolumeM3).toBe(350);
  });

  // ─── Unknown headers ignored ──────────────────────────────────

  it("18. unknown headers silently ignored", () => {
    const csvStr = csv(
      ["stand_id", "total_m3", "random_column", "another_unknown"],
      [["1", "100", "foo", "bar"]]
    );

    const result = parseForestDataCsv(csvStr);
    expect(result.totalStands).toBe(1);
    // No error thrown
  });

  // ─── Value translations ───────────────────────────────────────

  it("19. development_class translated", () => {
    const csvStr = csv(
      ["stand_id", "kehitysluokka"],
      [["1", "Nuori kasvatusmetsikkö"]]
    );

    const s = parseForestDataCsv(csvStr).stands[0];
    expect(s.development_class).toBe("young_thinning");
  });

  it("20. site_type translated: 'tuore kangas' → 'mesic'", () => {
    const csvStr = csv(
      ["stand_id", "kasvupaikka"],
      [["1", "tuore kangas"]]
    );

    const s = parseForestDataCsv(csvStr).stands[0];
    expect(s.site_type).toBe("mesic");
  });

  it("21. drainage_status translated: 'Ojitettu' → 'drained'", () => {
    const csvStr = csv(
      ["stand_id", "ojitustilanne"],
      [["1", "Ojitettu"]]
    );

    const s = parseForestDataCsv(csvStr).stands[0];
    expect(s.drainage_status).toBe("drained");
  });

  it("22. unknown Finnish value passes through unchanged", () => {
    const csvStr = csv(
      ["stand_id", "maalaji"],
      [["1", "Tuntematon maalaji"]]
    );

    const s = parseForestDataCsv(csvStr).stands[0];
    expect(s.soil_type).toBe("Tuntematon maalaji");
  });

  // ─── Edge cases ──────────────────────────────────────────────

  it("23. empty CSV returns zero stands", () => {
    const csvStr = "stand_id;total_m3\n";
    const result = parseForestDataCsv(csvStr);
    expect(result.totalStands).toBe(0);
    expect(result.totalVolumeM3).toBe(0);
  });

  it("24. stands without stand_id are skipped", () => {
    const csvStr = csv(
      ["stand_id", "total_m3"],
      [
        ["1", "100"],
        ["", "200"],
        ["3", "50"],
      ]
    );

    const result = parseForestDataCsv(csvStr);
    expect(result.totalStands).toBe(2);
  });

  it("25. multiple species per stand", () => {
    const csvStr = csv(
      ["stand_id", "mänty_m3", "kuusi_m3", "hieskoivu_m3"],
      [["1", "60", "30", "10"]]
    );

    const stand = parseForestDataCsv(csvStr).stands[0];
    expect(stand.species).toHaveLength(3);
    expect(stand.species.map((s) => s.species).sort()).toEqual(
      ["downy_birch", "pine", "spruce"].sort()
    );
  });

  it("26. species with all null fields are excluded", () => {
    const csvStr = csv(
      ["stand_id", "mänty_m3", "kuusi_m3"],
      [["1", "", ""]]
    );

    const stand = parseForestDataCsv(csvStr).stands[0];
    expect(stand.species).toHaveLength(0);
  });
});
