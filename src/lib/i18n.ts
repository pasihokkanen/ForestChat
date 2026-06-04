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

// ── Tab labels ──
export function tabLabel(tab: "map" | "stands" | "operations", lang: Language): string {
  if (lang === "fi") {
    return { map: "Kartta", stands: "Kuviot", operations: "Toimenpiteet" }[tab];
  }
  return { map: "Map", stands: "Stands", operations: "Operations" }[tab];
}

// ── Chat empty state ──
export function chatEmptyTitle(lang: Language): string {
  return lang === "fi" ? "Kysy metsäsuunnitelmastasi" : "Ask about your forest plan";
}

export function chatEmptyTip(lang: Language): string {
  return lang === "fi"
    ? 'Kokeile: "Laadi suunnitelma" tai "Näytä kuvio 7"'
    : 'Try: "Generate a plan" or "Show me stand 7"';
}

// ── Chart empty state ──
export function chartEmptyTitle(lang: Language): string {
  return lang === "fi" ? "Ei kaavioita" : "No charts yet";
}

export function chartEmptyTip(lang: Language): string {
  return lang === "fi"
    ? 'Pyydä tekoälyä luomaan kaavio, esim. "Näytä vuosittaiset tulot pylväskaaviona"'
    : 'Ask the AI to create a chart,\ne.g. "Show me yearly income as a bar chart"';
}

// ── Placeholder prompts ──
export function getPlaceholders(lang: Language): string[] {
  if (lang === "fi") {
    return [
      "Kysy metsäsuunnitelmastasi...",
      "Näytä hakkuukypsät kuviot",
      "Luo vuosittaiset tulot pylväskaaviona",
      "Laadi 20 vuoden metsäsuunnitelma",
      "Näytä puulajijakauma piirakkakaaviona",
      "Vertaa kasvua ja hakkuumäärää",
      "Listaa kaikki avohakkuut suunnitelmasta",
      "Yhteenveto suunnitelmasta",
    ];
  }
  return [
    "Ask about your forest plan...",
    "Show me stands ready for harvest",
    "Create a yearly income bar chart",
    "Generate a 20-year forest management plan",
    "Show species distribution as a pie chart",
    "Compare growth vs harvest volume",
    "List all clearcuts in the plan",
    "Summarize the current plan",
  ];
}

// ── Keyboard shortcut tip ──
export function keyboardTip(lang: Language): string {
  return lang === "fi"
    ? "Enter lähettää · Shift+Enter rivinvaihto · Ctrl+Enter lähettää"
    : "Enter to send · Shift+Enter for new line · Ctrl+Enter to send";
}

// ── Map popup labels ──
interface PopupLabels {
  standPrefix: string;
  standDetails: string;
  devClass: string;
  siteType: string;
  areaHa: string;
  age: string;
  volumeM3: string;
  basalArea: string;
  avgDiam: string;
  avgHeight: string;
  species: string;
  operations: string;
}

export function popupLabels(lang: Language): PopupLabels {
  if (lang === "fi") {
    return {
      standPrefix: "Kuvio",
      standDetails: "KUVIOTIEDOT",
      devClass: "Kehitysluokka",
      siteType: "Kasvupaikka",
      areaHa: "Pinta-ala (ha)",
      age: "Ikä",
      volumeM3: "Tilavuus (m³)",
      basalArea: "Pohjapinta-ala",
      avgDiam: "Keskilpm.",
      avgHeight: "Keskipituus",
      species: "PUULAJIT",
      operations: "TOIMENPITEET",
    };
  }
  return {
    standPrefix: "Stand",
    standDetails: "STAND DETAILS",
    devClass: "Dev. class",
    siteType: "Site type",
    areaHa: "Area (ha)",
    age: "Age",
    volumeM3: "Volume (m³)",
    basalArea: "Basal area",
    avgDiam: "Avg diam.",
    avgHeight: "Avg height",
    species: "SPECIES",
    operations: "OPERATIONS",
  };
}

// ── Server-side system messages ──
export function serverMsg(key: string, lang: Language, ...args: string[]): string {
  const msgs: Record<string, { en: string; fi: string }> = {
    newConversation: {
      en: "🆕 Started a new conversation. How can I help with your forest?",
      fi: "🆕 Aloitettu uusi keskustelu. Miten voin auttaa metsäsi kanssa?",
    },
    modelSwitched: {
      en: "✅ Model switched to `{0}` for this conversation.",
      fi: "✅ Malli vaihdettu `{0}`:ksi tähän keskusteluun.",
    },
    generatingPlan: {
      en: "🔧 Generating your plan…\n",
      fi: "🔧 Luodaan suunnitelmaa…\n",
    },
    creatingChart: {
      en: "🔧 Creating your chart…\n",
      fi: "🔧 Luodaan kaaviota…\n",
    },
    chartCreatedEngine: {
      en: '✅ Chart "{0}" created ({1}, {2} data points). Auto-updates when plan changes.',
      fi: '✅ Kaavio "{0}" luotu ({1}, {2} datapistettä). Päivittyy automaattisesti suunnitelman muuttuessa.',
    },
    chartCreatedLegacy: {
      en: '✅ Chart "{0}" created ({1}, {2} data points). The chart is now visible in the visualization panel.',
      fi: '✅ Kaavio "{0}" luotu ({1}, {2} datapistettä). Kaavio näkyy nyt visualisointipaneelissa.',
    },
    chartCreatedFallback: {
      en: "✅ Chart created. You can ask me to create more charts, edit the plan, or check sustainability.",
      fi: "✅ Kaavio luotu. Voit pyytää lisää kaavioita, muokata suunnitelmaa tai tarkistaa kestävyyttä.",
    },
    doneFallback: {
      en: "✅ Done. You can ask me to make changes, create charts, or check sustainability.",
      fi: "✅ Valmis. Voit pyytää muutoksia, luoda kaavioita tai tarkistaa kestävyyttä.",
    },
    standSelected: {
      en: "✅ Stand {0} selected on map.",
      fi: "✅ Kuvio {0} valittu kartalla.",
    },
    chartRemoved: {
      en: '✅ Chart "{0}" removed.',
      fi: '✅ Kaavio "{0}" poistettu.',
    },
    chartsCleared: {
      en: "✅ All charts cleared from the visualization panel.",
      fi: "✅ Kaikki kaaviot poistettu visualisointipaneelista.",
    },
    emptyResponseChart: {
      en: 'I can create charts for you. Try asking something like: "Show yearly income as a bar chart" or "Create a pie chart of species distribution."',
      fi: 'Voin luoda kaavioita. Kokeile kysyä esimerkiksi: "Näytä vuosittaiset tulot pylväskaaviona" tai "Luo puulajijakauma piirakkakaaviona."',
    },
    emptyResponseGeneric: {
      en: "⚠️ The AI model returned an empty response. This can happen with some model/provider combinations. Try a simpler query or ask me to generate your forest plan with 'Generate a plan'.",
      fi: "⚠️ Tekoälymalli palautti tyhjän vastauksen. Tätä voi tapahtua joidenkin malli/palveluntarjoaja -yhdistelmien kanssa. Kokeile yksinkertaisempaa kysymystä tai pyydä 'Laadi suunnitelma'.",
    },
  };

  const entry = msgs[key];
  if (!entry) return key;
  let msg = entry[lang] ?? entry.en;
  for (let i = 0; i < args.length; i++) {
    msg = msg.replace(`{${i}}`, args[i] ?? "");
  }
  return msg;
}

// ── Tool call labels (client-side) ──
const TOOL_LABEL_MAP: Record<string, { en: string; fi: string }> = {
  generate_plan: { en: "Generating plan…", fi: "Luodaan suunnitelmaa…" },
  get_stand: { en: "Fetching stand data…", fi: "Haetaan kuviotietoja…" },
  search_stands: { en: "Searching stands…", fi: "Etsitään kuvioita…" },
  plan_summary: { en: "Calculating summary…", fi: "Lasketaan yhteenvetoa…" },
  year_operations: { en: "Fetching operations…", fi: "Haetaan toimenpiteitä…" },
  query_operations: { en: "Fetching operations…", fi: "Haetaan toimenpiteitä…" },
  add_operation: { en: "Adding operation…", fi: "Lisätään toimenpidettä…" },
  remove_operation: { en: "Removing operation…", fi: "Poistetaan toimenpidettä…" },
  batch_update_operations: { en: "Updating operations…", fi: "Päivitetään toimenpiteitä…" },
  check_harvest_sustainability: { en: "Checking sustainability…", fi: "Tarkistetaan kestävyyttä…" },
  validate_plan: { en: "Validating plan…", fi: "Vahvistetaan suunnitelmaa…" },
  create_chart: { en: "Creating chart…", fi: "Luodaan kaaviota…" },
  select_stand: { en: "Selecting stand…", fi: "Valitaan kuviota…" },
  remove_chart: { en: "Removing chart…", fi: "Poistetaan kaaviota…" },
  clear_charts: { en: "Clearing charts…", fi: "Tyhjennetään kaavioita…" },
};

export function toolLabel(name: string, lang: Language): string {
  const entry = TOOL_LABEL_MAP[name];
  if (entry) return entry[lang];
  const running = lang === "fi" ? "Suoritetaan" : "Running";
  return `${running} ${name}…`;
}

const STATUS_LABEL_MAP: Record<string, { en: string; fi: string }> = {
  running: { en: "Running", fi: "Suoritetaan" },
  done: { en: "Done", fi: "Valmis" },
  error: { en: "Error", fi: "Virhe" },
};

export function toolStatusLabel(status: string, lang: Language): string {
  return STATUS_LABEL_MAP[status]?.[lang] ?? status;
}

// ── Stand list labels ──
export interface StandListLabels {
  colStand: string;
  colSpecies: string;
  colArea: string;
  colVolume: string;
  colAge: string;
  colDevClass: string;
  colSiteType: string;
  colGrowth: string;
  filterSpecies: string;
  filterDevClass: string;
  filterSite: string;
  placeholderAgeMin: string;
  placeholderAgeMax: string;
  placeholderAreaMin: string;
  placeholderAreaMax: string;
  placeholderVolMin: string;
  placeholderVolMax: string;
  placeholderSearch: string;
  clearAll: string;
  chipSpecies: string;
  chipSite: string;
  chipAge: string;
  chipArea: string;
  emptyNoStands: string;
  emptyNoMatch: string;
  expandedEmpty: string;
  footerStands: string;
  footerTotal: string;
  footerFilteredFrom: string;
  showOnMap: string;
  logPct: string;
}

export function standListLabels(lang: Language): StandListLabels {
  if (lang === "fi") {
    return {
      colStand: "Kuvio",
      colSpecies: "Puulaji",
      colArea: "Pinta-ala (ha)",
      colVolume: "Tilavuus (m³)",
      colAge: "Ikä",
      colDevClass: "Kehitysluokka",
      colSiteType: "Kasvupaikka",
      colGrowth: "Kasvu (m³/ha/v)",
      filterSpecies: "Puulaji",
      filterDevClass: "Kehityslk.",
      filterSite: "Kasvupaikka",
      placeholderAgeMin: "Ikä ≥",
      placeholderAgeMax: "Ikä ≤",
      placeholderAreaMin: "Ala ≥",
      placeholderAreaMax: "Ala ≤",
      placeholderVolMin: "Til. ≥",
      placeholderVolMax: "Til. ≤",
      placeholderSearch: "🔍 Hae...",
      clearAll: "Tyhjennä",
      chipSpecies: "Puulaji",
      chipSite: "Kasvupaikka",
      chipAge: "Ikä",
      chipArea: "Pinta-ala",
      emptyNoStands: "Ei kuvioita ladattu.",
      emptyNoMatch: "Ei kuvioita nykyisillä suodattimilla.",
      expandedEmpty: "Ei puulajeja tai toimenpiteitä",
      footerStands: "kuviota",
      footerTotal: "yhteensä",
      footerFilteredFrom: "(suodatettu",
      showOnMap: "Näytä kartalla",
      logPct: "Tukki",
    };
  }
  return {
    colStand: "Stand",
    colSpecies: "Species",
    colArea: "Area (ha)",
    colVolume: "Volume (m³)",
    colAge: "Age",
    colDevClass: "Dev. Class",
    colSiteType: "Site Type",
    colGrowth: "Growth (m³/ha/y)",
    filterSpecies: "Species",
    filterDevClass: "Dev. Class",
    filterSite: "Site",
    placeholderAgeMin: "Age ≥",
    placeholderAgeMax: "Age ≤",
    placeholderAreaMin: "Area ≥",
    placeholderAreaMax: "Area ≤",
    placeholderVolMin: "Vol ≥",
    placeholderVolMax: "Vol ≤",
    placeholderSearch: "🔍 Search...",
    clearAll: "Clear all",
    chipSpecies: "Species",
    chipSite: "Site",
    chipAge: "Age",
    chipArea: "Area",
    emptyNoStands: "No stands loaded.",
    emptyNoMatch: "No stands match the current filters.",
    expandedEmpty: "No species or operations",
    footerStands: "stands",
    footerTotal: "total",
    footerFilteredFrom: "(filtered from",
    showOnMap: "Show on map",
    logPct: "Log",
  };
}

// ── Operation list labels ──
export interface OperationListLabels {
  colStand: string;
  colType: string;
  colYear: string;
  colSpecies: string;
  colArea: string;
  colVolume: string;
  colRemoval: string;
  colIncome: string;
  colCost: string;
  colDevClass: string;
  filterType: string;
  filterSpecies: string;
  placeholderYearFrom: string;
  placeholderYearTo: string;
  placeholderStandId: string;
  placeholderSearch: string;
  clearAll: string;
  chipYear: string;
  chipSpecies: string;
  chipStand: string;
  emptyNoOps: string;
  emptyNoOpsHint: string;
  emptyNoMatch: string;
  footerOps: string;
  footerTotal: string;
  footerFilteredFrom: string;
  showOnMap: string;
}

export function operationListLabels(lang: Language): OperationListLabels {
  if (lang === "fi") {
    return {
      colStand: "Kuvio",
      colType: "Tyyppi",
      colYear: "Vuosi",
      colSpecies: "Puulaji",
      colArea: "Pinta-ala (ha)",
      colVolume: "Til. (m³)",
      colRemoval: "Poistuma %",
      colIncome: "Tuotto (€)",
      colCost: "Kulu (€)",
      colDevClass: "Kehityslk.",
      filterType: "Tyyppi",
      filterSpecies: "Puulaji",
      placeholderYearFrom: "Vuosi alkaen",
      placeholderYearTo: "Vuosi asti",
      placeholderStandId: "Kuvion ID",
      placeholderSearch: "🔍 Hae...",
      clearAll: "Tyhjennä",
      chipYear: "Vuosi",
      chipSpecies: "Puulaji",
      chipStand: "Kuvio",
      emptyNoOps: "Ei toimenpiteitä.",
      emptyNoOpsHint: "Pyydä tekoälyä luomaan metsäsuunnitelma nähdäksesi toimenpiteet täällä.",
      emptyNoMatch: "Ei toimenpiteitä nykyisillä suodattimilla.",
      footerOps: "toimenpidettä",
      footerTotal: "yhteensä",
      footerFilteredFrom: "(suodatettu",
      showOnMap: "Näytä kartalla",
    };
  }
  return {
    colStand: "Stand",
    colType: "Type",
    colYear: "Year",
    colSpecies: "Species",
    colArea: "Area (ha)",
    colVolume: "Vol. (m³)",
    colRemoval: "Removal %",
    colIncome: "Income (€)",
    colCost: "Cost (€)",
    colDevClass: "Dev. Class",
    filterType: "Type",
    filterSpecies: "Species",
    placeholderYearFrom: "Year from",
    placeholderYearTo: "Year to",
    placeholderStandId: "Stand ID",
    placeholderSearch: "🔍 Search...",
    clearAll: "Clear all",
    chipYear: "Year",
    chipSpecies: "Species",
    chipStand: "Stand",
    emptyNoOps: "No operations found.",
    emptyNoOpsHint: "Ask the AI to generate a forest management plan to see operations here.",
    emptyNoMatch: "No operations match the current filters.",
    footerOps: "operations",
    footerTotal: "total",
    footerFilteredFrom: "(filtered from",
    showOnMap: "Show on map",
  };
}

// ── Chat command prompts (E6) ──
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

// ── Dashboard labels ──
export interface DashboardLabels {
  myForests: string;
  importForest: string;
  statForests: string;
  statTotalArea: string;
  gettingStarted: string;
  gettingStartedDesc: string;
  importFirstForest: string;
  noForests: string;
  noForestsHint: string;
  importForestBtn: string;
  loadError: string;
  deleteConfirm: string;
  deleteYes: string;
  deleteNo: string;
  deleteBtn: string;
  deleteFailed: string;
}

export function dashboardLabels(lang: Language): DashboardLabels {
  if (lang === "fi") {
    return {
      myForests: "Omat metsät",
      importForest: "+ Tuo metsä",
      statForests: "Metsää",
      statTotalArea: "Kokonaispinta-ala",
      gettingStarted: "Aloitus",
      gettingStartedDesc:
        "Tuo metsätietosi aloittaaksesi metsäsuunnitelmasi hallinnan tekoälyn avulla. Voit käyttää suomalaista kiinteistötunnusta tai ladata CSV-tiedoston.",
      importFirstForest: "Tuo ensimmäinen metsäsi",
      noForests: "Ei metsiä vielä.",
      noForestsHint: "Tuo ensimmäinen metsäsi aloittaaksesi.",
      importForestBtn: "Tuo metsä",
      loadError: "Metsien lataus epäonnistui",
      deleteConfirm: "Poista?",
      deleteYes: "Kyllä",
      deleteNo: "Ei",
      deleteBtn: "Poista",
      deleteFailed: "Metsän poisto epäonnistui",
    };
  }
  return {
    myForests: "My Forests",
    importForest: "+ Import Forest",
    statForests: "Forests",
    statTotalArea: "Total Area",
    gettingStarted: "Getting Started",
    gettingStartedDesc:
      "Import your forest data to start managing your forest plan with AI. You can use a Finnish property ID or upload a CSV file.",
    importFirstForest: "Import Your First Forest",
    noForests: "No forests yet.",
    noForestsHint: "Import your first forest to get started.",
    importForestBtn: "Import Forest",
    loadError: "Failed to load forests",
    deleteConfirm: "Delete?",
    deleteYes: "Yes",
    deleteNo: "No",
    deleteBtn: "Delete",
    deleteFailed: "Failed to delete forest",
  };
}

// ── Import page labels ──
export interface ImportLabels {
  heading: string;
  tabApi: string;
  tabCsv: string;
  apiDesc: string;
  csvDesc: string;
  propertyId: string;
  propertyIdHint: string;
  csvFileLabel: string;
  csvPreview: string;
  forestName: string;
  importing: string;
  importBtn: string;
  csvReadError: string;
  importFailed: string;
  somethingWrong: string;
  stageBoundary: string;
  stageStands: string;
  stageStoring: string;
  stageParseCsv: string;
  stageStoreStands: string;
  stageStoreSpecies: string;
  importFailedFallback: string;
}

export function importLabels(lang: Language): ImportLabels {
  if (lang === "fi") {
    return {
      heading: "Tuo kuviotiedot",
      tabApi: "Metsäkeskus API",
      tabCsv: "CSV-tiedosto",
      apiDesc:
        "Tuo kuviotiedot Suomen Metsäkeskuksen avoimesta WFS-rajapinnasta. Syötä kiinteistötunnus hakeaksesi kuviot automaattisesti.",
      csvDesc:
        "Tuo kuviotiedot CSV-tiedostosta. Tiedoston tulee sisältää kuviotiedot, puulajijakauman ja aluerajauksen WKT-muodossa.",
      propertyId: "Kiinteistötunnus",
      propertyIdHint:
        "Muoto: XXX-XXX-XXXX-XXXX. Väliviivat valinnaisia — rajapinta normalisoi automaattisesti.",
      csvFileLabel: "Kuviotietojen CSV-tiedosto",
      csvPreview: "{0} kuviota · {1} m³ kokonaistilavuus",
      forestName: "Metsän nimi (valinnainen)",
      importing: "Tuodaan…",
      importBtn: "Tuo kuviotiedot",
      csvReadError: "CSV-tiedoston lukeminen epäonnistui",
      importFailed: "Tuonti epäonnistui",
      somethingWrong: "Jokin meni pieleen",
      stageBoundary: "Haetaan kiinteistön rajausta Maanmittauslaitokselta…",
      stageStands: "Haetaan kuviotietoja Suomen Metsäkeskuksesta…",
      stageStoring: "Käsitellään ja tallennetaan tietoja…",
      stageParseCsv: "Jäsennetään CSV-tiedostoa…",
      stageStoreStands: "Tallennetaan kuviotietoja…",
      stageStoreSpecies: "Tuodaan puulajijakaumaa…",
      importFailedFallback: "Tuonti epäonnistui",
    };
  }
  return {
    heading: "Import Stand Data",
    tabApi: "Metsäkeskus API",
    tabCsv: "CSV File",
    apiDesc:
      "Import stand data from the Finnish Forest Centre (Metsäkeskus) open WFS API. Enter your property ID to fetch stands automatically.",
    csvDesc:
      "Import stand data from a CSV file. The file must contain stand attributes, species breakdown, and polygon geometry in WKT format.",
    propertyId: "Property ID",
    propertyIdHint:
      "Format: XXX-XXX-XXXX-XXXX. Dashes are optional — the API auto-normalizes.",
    csvFileLabel: "Stand data CSV file",
    csvPreview: "{0} stands · {1} m³ total volume",
    forestName: "Forest name (optional)",
    importing: "Importing…",
    importBtn: "Import Stand Data",
    csvReadError: "Failed to read CSV file",
    importFailed: "Import failed",
    somethingWrong: "Something went wrong",
    stageBoundary: "Fetching property boundary from National Land Survey…",
    stageStands: "Fetching stand data from Finnish Forest Centre…",
    stageStoring: "Processing and storing data…",
    stageParseCsv: "Parsing CSV file…",
    stageStoreStands: "Storing stand data…",
    stageStoreSpecies: "Importing species breakdown…",
    importFailedFallback: "Import failed",
  };
}

// ── Landing page labels ──
export interface LandingLabels {
  tagline: string;
  subtagline: string;
  getStarted: string;
  logIn: string;
  alreadyHaveAccount: string;
  features: {
    map: { title: string; desc: string };
    aiChat: { title: string; desc: string };
    charts: { title: string; desc: string };
    stands: { title: string; desc: string };
  };
}

export function landingLabels(lang: Language): LandingLabels {
  if (lang === "fi") {
    return {
      tagline:
        "Tekoälypohjainen metsänhallinta — visualisoi ja hallitse metsäsuunnitelmaasi keskustelun kautta.",
      subtagline:
        "Syötä suomalainen kiinteistötunnus ja sovellus lataa metsätietosi automaattisesti. Pyydä tekoälyä luomaan 20 vuoden suunnitelma ja muokkaa sitä keskustellen.",
      getStarted: "Aloita",
      logIn: "Kirjaudu",
      alreadyHaveAccount: "Onko sinulla jo tili?",
      features: {
        map: { title: "Kartta", desc: "Selaa metsäkuvioitasi interaktiivisella kartalla" },
        aiChat: { title: "Tekoäly-chat", desc: "Luo ja muokkaa metsäsuunnitelmaa keskustelun kautta" },
        charts: { title: "Kaaviot", desc: "Visualisoi hakkuumäärät, tulot, puulajijakauman ja paljon muuta" },
        stands: { title: "Kuviot", desc: "Tutki kuviotietoja, puulajikoostumusta ja aikataulutettuja toimenpiteitä" },
      },
    };
  }
  return {
    tagline:
      "AI-powered forest management — visualize and manage your forest plan through conversation.",
    subtagline:
      "Enter your Finnish property ID and the app automatically loads your forest data. Ask the AI to generate a 20-year plan, then refine it through chat.",
    getStarted: "Get Started",
    logIn: "Log in",
    alreadyHaveAccount: "Already have an account?",
    features: {
      map: { title: "Map", desc: "Browse your forest compartments on an interactive map" },
      aiChat: { title: "AI Chat", desc: "Generate and refine a forest management plan through conversation" },
      charts: { title: "Charts", desc: "Visualize harvest volumes, income, species distribution, and more" },
      stands: { title: "Stands", desc: "Explore stand details, species composition, and scheduled operations" },
    },
  };
}
