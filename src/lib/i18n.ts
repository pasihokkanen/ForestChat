export type Language = "en" | "fi";

// ── Operation Types ──
const OP_MAP: Record<string, Record<Language, string>> = {
  clear_cut: { en: "Clearcut", fi: "Avohakkuu" },
  thinning: { en: "Thinning", fi: "Harvennus" },
  first_thinning: { en: "First Thinning", fi: "Ensiharvennus" },
  selection_cutting: { en: "Selection Cutting", fi: "Poimintahakkuu" },
  tending: { en: "Tending", fi: "Taimikonhoito" },
  early_tending: { en: "Early Tending", fi: "Taimikon varhaishoito" },
  pre_clearance: { en: "Pre-clearance", fi: "Ennakkoraivaus" },
  site_prep: { en: "Mounding", fi: "Laikkumätästys" },
  ditch_mounding: { en: "Ditch Mounding", fi: "Ojitusmätästys" },
  scalping: { en: "Scalping", fi: "Laikutus" },
  spruce_planting: { en: "Spruce Planting", fi: "Kuusen istutus" },
  pine_planting: { en: "Pine Planting", fi: "Männyn istutus" },
  planting: { en: "Planting", fi: "Istutus" },
};

// ── Development Classes ──
const DEV_CLASS_MAP: Record<string, Record<Language, string>> = {
  regeneration_ready: { en: "Regeneration Ready", fi: "Uudistuskypsä" },
  mature_thinning: { en: "Mature Thinning", fi: "Varttunut kasvatusmetsikkö" },
  young_thinning: { en: "Young Thinning", fi: "Nuori kasvatusmetsikkö" },
  open_area: { en: "Open Area", fi: "Aukea" },
  seed_tree: { en: "Seed Tree", fi: "Siemenpuusto" },
  seedling_large: { en: "Large Seedling", fi: "Taimikko yli 1,3 m" },
  seedling_small: { en: "Small Seedling", fi: "Taimikko alle 1,3 m" },
  seedling: { en: "Seedling", fi: "Taimikko" },
  shelterwood: { en: "Shelterwood", fi: "Suojuspuusto" },
  uneven_aged: { en: "Uneven-Aged", fi: "Eri-ikäisrakenteinen" },
};

// ── Site Types ──
const SITE_TYPE_MAP: Record<string, Record<Language, string>> = {
  "herb-rich": { en: "Herb-Rich", fi: "Lehto" },
  "herb-rich heath": { en: "Herb-Rich Heath", fi: "Lehtomainen kangas" },
  mesic: { en: "Mesic", fi: "Tuore kangas" },
  "sub-xeric": { en: "Sub-Xeric", fi: "Kuivahko kangas" },
  xeric: { en: "Xeric", fi: "Kuiva kangas" },
  barren: { en: "Barren", fi: "Karukkokangas" },
};

// ── Species ──
const SPECIES_MAP: Record<string, Record<Language, string>> = {
  pine: { en: "Pine", fi: "Mänty" },
  spruce: { en: "Spruce", fi: "Kuusi" },
  silver_birch: { en: "Silver Birch", fi: "Rauduskoivu" },
  downy_birch: { en: "Downy Birch", fi: "Hieskoivu" },
  birch: { en: "Birch", fi: "Koivu" },
  larch: { en: "Larch", fi: "Lehtikuusi" },
  grey_alder: { en: "Grey Alder", fi: "Harmaaleppä" },
  aspen: { en: "Aspen", fi: "Haapa" },
  rowan: { en: "Rowan", fi: "Pihlaja" },
  broadleaf: { en: "Broadleaf", fi: "Lehtipuu" },
};

// ── Drainage Status ──
const DRAINAGE_MAP: Record<string, Record<Language, string>> = {
  drained: { en: "Drained", fi: "Ojitettu" },
  undrained: { en: "Undrained", fi: "Ojittamaton" },
  peatland_forest: { en: "Peatland Forest", fi: "Turvekangas" },
  natural_state: { en: "Natural State", fi: "Luonnontilainen" },
};

function lookup(map: Record<string, Record<Language, string>>, sysValue: string, lang: Language): string {
  const entry = map[sysValue];
  if (entry?.[lang]) return entry[lang];
  // Fallback: capitalize system value
  if (!sysValue) return sysValue;
  return sysValue.charAt(0).toUpperCase() + sysValue.slice(1).replace(/_/g, " ");
}

export function displayOp(sysValue: string, lang: Language): string {
  return lookup(OP_MAP, sysValue, lang);
}

export function displayDevClass(sysValue: string, lang: Language): string {
  return lookup(DEV_CLASS_MAP, sysValue, lang);
}

export function displaySiteType(sysValue: string, lang: Language): string {
  return lookup(SITE_TYPE_MAP, sysValue, lang);
}

export function displaySpecies(sysValue: string, lang: Language): string {
  return lookup(SPECIES_MAP, sysValue, lang);
}

export function displayDrainage(sysValue: string, lang: Language): string {
  return lookup(DRAINAGE_MAP, sysValue, lang);
}

// ── App name ──
export function appName(lang: Language): string {
  return lang === "fi" ? "MetsäChat" : "ForestChat";
}

// ── Chat command prompts (E6 prep) ──
export interface CommandPrompt {
  label: string;
  text: string;
}

export interface CommandGroup {
  heading: string;
  prompts: CommandPrompt[];
}

export function getCommandGroups(lang: Language, activeModel: string): CommandGroup[] {
  if (lang === "fi") {
    return [
      {
        heading: "📋 Komennot",
        prompts: [],
      },
      {
        heading: "── Suunnitelman muokkaus ──",
        prompts: [
          { label: "Laadi 20 vuoden metsäsuunnitelma", text: "Laadi 20 vuoden metsäsuunnitelma" },
          { label: "Siirrä kuvion 7 avohakkuu vuoteen 2030", text: "Siirrä kuvion 7 avohakkuu vuoteen 2030" },
          { label: "Poista kaikki toimenpiteet kuviosta 12", text: "Poista kaikki toimenpiteet kuviosta 12" },
          { label: "Näytä kaikki avohakkuut vuosilta 2030-2035", text: "Näytä kaikki avohakkuut vuosilta 2030-2035" },
          { label: "Lisää harvennus kaikkiin varttuneisiin mäntykohteisiin", text: "Lisää harvennus kaikkiin varttuneisiin mäntykohteisiin" },
        ],
      },
      {
        heading: "── Kaavioiden luonti ──",
        prompts: [
          { label: "Luo vuosittaiset tulot pylväskaaviona", text: "Luo vuosittaiset tulot pylväskaaviona" },
          { label: "Näytä puulajijakauma piirakkakaaviona", text: "Näytä puulajijakauma piirakkakaaviona" },
          { label: "Vuosittaiset hakkuumäärät pinottuna pylväskaaviona", text: "Vuosittaiset hakkuumäärät pinottuna pylväskaaviona" },
          { label: "Näytä kumulatiivinen kasvu ja poistuma", text: "Näytä kumulatiivinen kasvu ja poistuma" },
        ],
      },
      {
        heading: "── Muut ──",
        prompts: [
          { label: "Tarkista hakkuiden kestävyys", text: "Tarkista hakkuiden kestävyys" },
          { label: "Tarkista suunnitelma", text: "Tarkista suunnitelma" },
          { label: "Näytä kuvio 7 kartalla", text: "Näytä kuvio 7 kartalla" },
          { label: "Yhteenveto suunnitelmasta", text: "Yhteenveto suunnitelmasta" },
        ],
      },
    ];
  }

  return [
    {
      heading: "📋 Chat Commands",
      prompts: [],
    },
    {
      heading: "── Plan Editing ──",
      prompts: [
        { label: "Generate a 20-year forest management plan", text: "Generate a 20-year forest management plan" },
        { label: "Move stand 7 clearcut to 2030", text: "Move stand 7 clearcut to 2030" },
        { label: "Remove all operations from stand 12", text: "Remove all operations from stand 12" },
        { label: "Show me all clearcuts from 2030-2035", text: "Show me all clearcuts from 2030-2035" },
        { label: "Add thinning to all mature pine stands", text: "Add thinning to all mature pine stands" },
      ],
    },
    {
      heading: "── Chart Creation ──",
      prompts: [
        { label: "Create a yearly income bar chart", text: "Create a yearly income bar chart" },
        { label: "Show species distribution as a pie chart", text: "Show species distribution as a pie chart" },
        { label: "Chart yearly harvest volume as stacked bars", text: "Chart yearly harvest volume as stacked bars" },
        { label: "Show cumulative growth and removal", text: "Show cumulative growth and removal" },
      ],
    },
    {
      heading: "── Miscellaneous ──",
      prompts: [
        { label: "Check harvest sustainability", text: "Check harvest sustainability" },
        { label: "Validate the current plan", text: "Validate the current plan" },
        { label: "Show stand 7 on the map", text: "Show stand 7 on the map" },
        { label: "Summarize the plan", text: "Summarize the plan" },
      ],
    },
  ];
}
