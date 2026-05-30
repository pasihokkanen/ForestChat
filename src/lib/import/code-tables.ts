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
  T1: "young_thinning", // Nuori kasvatusmetsikkö (early)
  T2: "young_thinning", // Nuori kasvatusmetsikkö (late)
  "02": "mature_thinning", // Varttunut kasvatusmetsikkö
  "03": "mature_thinning", // Varttunut kasvatusmetsikkö
  Y1: "regeneration_ready", // Uudistuskypsä
  "04": "regeneration_ready", // Uudistuskypsä
  ER: "uneven_aged", // Eri-ikäisrakenteinen
  "05": "shelterwood", // Suojuspuusto
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
