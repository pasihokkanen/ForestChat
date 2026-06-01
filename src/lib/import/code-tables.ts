// Finnish Forest Centre code→text mappings (Metsätietostandardi)

export const MAINGROUP_MAP: Record<number, string> = {
  1: "pine",
  2: "spruce",
  3: "broadleaf",
};

export const FERTILITYCLASS_MAP: Record<number, string> = {
  1: "herb-rich", // lehto
  2: "herb-rich heath", // lehtomainen kangas
  3: "mesic", // tuore kangas
  4: "sub-xeric", // kuivahko kangas
  5: "xeric", // kuiva kangas
  6: "barren", // karukkokangas
};

export const DEVELOPMENTCLASS_MAP: Record<string, string> = {
  A0: "open_area", // Aukea
  S0: "seedling", // Taimikko
  S1: "seedling_small", // Taimikko alle 1,3 m
  S2: "seedling_large", // Taimikko yli 1,3 m
  T1: "young_thinning", // Nuori kasvatusmetsikkö (early)
  T2: "young_thinning", // Nuori kasvatusmetsikkö (late)
  "02": "mature_thinning", // Varttunut kasvatusmetsikkö
  "03": "mature_thinning", // Varttunut kasvatusmetsikkö
  Y1: "regeneration_ready", // Uudistuskypsä
  "04": "regeneration_ready", // Uudistuskypsä
  ER: "uneven_aged", // Eri-ikäisrakenteinen
  "05": "shelterwood", // Suojuspuusto
  "06": "seed_tree", // Siemenpuumetsikkö
};

export function mapWfsCode(
  table: Record<string, string>,
  code: unknown
): string | null {
  if (code === null || code === undefined) return null;
  return table[String(code)] ?? `unknown:${code}`;
}

export function mapWfsNumericCode(
  table: Record<number, string>,
  code: unknown
): string | null {
  if (code === null || code === undefined) return null;
  const num = typeof code === "string" ? parseInt(code, 10) : (code as number);
  return table[num] ?? null;
}

// Finnish soil type text → English (for WFS string values)
export const SOILTYPE_TEXT_MAP: Record<string, string> = {
  "Hienoainesmoreeni": "fine-grained till",
  "Keskikarkea tai karkea kangasmaa": "medium or coarse mineral soil",
  "Turvemaa": "peatland",
  "Hienojakoinen lajittunut maalaji": "fine sorted soil",
  "Karkea lajittunut maalaji": "coarse sorted soil",
  "Kangas": "mineral soil",
  // lowercase variants
  "hienoainesmoreeni": "fine-grained till",
  "keskikarkea tai karkea kangasmaa": "medium or coarse mineral soil",
  "turvemaa": "peatland",
  "hienojakoinen lajittunut maalaji": "fine sorted soil",
  "karkea lajittunut maalaji": "coarse sorted soil",
  "kangas": "mineral soil",
};

export function mapSoilType(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value);
  return SOILTYPE_TEXT_MAP[str] ?? str;
}
