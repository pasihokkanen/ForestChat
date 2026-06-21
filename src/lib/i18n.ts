export type Language = "en" | "fi";

// ── Operation Types ──
const OP_MAP: Record<string, Record<Language, string>> = {
  clear_cut: { en: "Clearcut", fi: "Avohakkuu" },
  thinning: { en: "Thinning", fi: "Harvennus" },
  first_thinning: { en: "First Thinning", fi: "Ensiharvennus" },
  selection_cutting: { en: "Selection Cutting", fi: "Poimintahakkuu" },
  overstory_removal: { en: "Overstory Removal", fi: "Siemenpuiden poisto" },
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

/** Try all category translators — used by charts where we don't know the column schema. */
export function translateChartCategory(sysValue: string, lang: Language): string {
  if (!sysValue) return sysValue;
  // Check each map in order; first hit wins. No namespace overlaps.
  const op = OP_MAP[sysValue]?.[lang];
  if (op) return op;
  const sp = SPECIES_MAP[sysValue]?.[lang];
  if (sp) return sp;
  const dc = DEV_CLASS_MAP[sysValue]?.[lang];
  if (dc) return dc;
  const st = SITE_TYPE_MAP[sysValue]?.[lang];
  if (st) return st;
  const dr = DRAINAGE_MAP[sysValue]?.[lang];
  if (dr) return dr;
  // Fallback: capitalize system value
  return sysValue.charAt(0).toUpperCase() + sysValue.slice(1).replace(/_/g, " ");
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
    chartUpdated: {
      en: '✅ Chart "{0}" updated ({1}).',
      fi: '✅ Kaavio "{0}" päivitetty ({1}).',
    },
    doneFallback: {
      en: "✅ Done. You can ask me to make changes, create charts, or check sustainability.",
      fi: "✅ Valmis. Voit pyytää muutoksia, luoda kaavioita tai tarkistaa kestävyyttä.",
    },
    standSelected: {
      en: "✅ Stand {0} selected on map.",
      fi: "✅ Kuvio {0} valittu kartalla.",
    },
    standsSelected: {
      en: "✅ {0} stands selected on map ({1}).",
      fi: "✅ {0} kuviota valittu kartalla ({1}).",
    },
    standsNotFound: {
      en: "❌ Stand(s) not found: {0}",
      fi: "❌ Kuviota ei löydy: {0}",
    },
    standsShown: {
      en: "✅ Stand filters applied. Results shown in the Stands tab.",
      fi: "✅ Kuviosuodattimet asetettu. Tulokset näkyvät Kuviot-välilehdellä.",
    },
    operationsShown: {
      en: "✅ Operation filters applied. Results shown in the Operations tab.",
      fi: "✅ Toimenpidesuodattimet asetettu. Tulokset näkyvät Toimenpiteet-välilehdellä.",
    },
    operationAdded: {
      en: "✅ Added {0} to stand {1} in {2} (removal: {3}%, income: {4} €{5}).",
      fi: "✅ Lisätty {0} kuviolle {1} vuonna {2} (poisto: {3}%, tulo: {4} €{5}).",
    },
    operationsAdded: {
      en: "Added {0}/{1} operation(s):\n{2}",
      fi: "Lisätty {0}/{1} toimenpidettä:\n{2}",
    },
    operationAddError: {
      en: "❌ {0}: {1}",
      fi: "❌ {0}: {1}",
    },
    operationsRemoved: {
      en: "✅ Removed {0} operation(s) from {1}{2}{3}.",
      fi: "✅ Poistettu {0} toimenpidettä kohteesta {1}{2}{3}.",
    },
    noOperationsForStand: {
      en: "No operations found for {0}{1}{2}.",
      fi: "Ei toimenpiteitä löytynyt: {0}{1}{2}.",
    },
    operationsUpdated: {
      en: "✅ Updated {0} operation(s) from {1} year(s), {2} type(s){3}.",
      fi: "✅ Päivitetty {0} toimenpidettä, {1} vuotta, {2} tyyppiä{3}.",
    },
    planCleared: {
      en: "✅ Cleared the entire plan — {0} AI-generated operation(s) deleted.",
      fi: "✅ Koko suunnitelma tyhjennetty — {0} tekoälyn luomaa toimenpidettä poistettu.",
    },
    planClearNone: {
      en: "ℹ️ No AI-generated operations to clear — the plan is already empty.",
      fi: "ℹ️ Ei tyhjennettävää — suunnitelmassa ei ole tekoälyn luomia toimenpiteitä.",
    },
    planClearConfirmMulti: {
      en: "⚠️ Confirmation required: This will clear ALL AI-generated operations from {0} active forests. To proceed, call clear_plan again with confirm:true.",
      fi: "⚠️ Vahvistus vaaditaan: Tämä tyhjentää KAIKKI tekoälyn luomat toimenpiteet {0} aktiivisesta metsästä. Jatkaaksesi, kutsu clear_plan uudelleen parametrillä confirm:true.",
    },
    noMatchingOperations: {
      en: "No matching operations found.",
      fi: "Ei vastaavia toimenpiteitä löytynyt.",
    },
    noMatchingOperationsFiltered: {
      en: "No matching operations found after filtering.",
      fi: "Ei vastaavia toimenpiteitä löytynyt suodatuksen jälkeen.",
    },
    noChartsFound: {
      en: "No charts found.",
      fi: "Ei kaavioita löytynyt.",
    },
    chartsListed: {
      en: "{0} chart(s):\n{1}",
      fi: "{0} kaaviota:\n{1}",
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
    // ── Plan generation ──
    planGenerated: {
      en: "✅ Plan generated for {0} ha forest!",
      fi: "✅ Suunnitelma luotu {0} han metsälle!",
    },
    planTotalVolume:   { en: "🌲 Total volume: {0} m³",              fi: "🌲 Kokonaistilavuus: {0} m³" },
    planAnnualGrowth:  { en: "📈 Annual growth: {0} m³/v",            fi: "📈 Vuotuinen kasvu: {0} m³/v" },
    planStumpageValue: { en: "💰 Stumpage value: {0} €",              fi: "💰 Kantoraha-arvo: {0} €" },
    planPeriod1:       { en: "Period 1 ({0}-{1}):",                   fi: "Kausi 1 ({0}-{1}):" },
    planClearcuts:     { en: "  {0} clearcuts",                       fi: "  {0} avohakkuuta" },
    planThinnings:     { en: "  {0} thinnings",                       fi: "  {0} harvennusta" },
    planAvgHarvest:    { en: "  Avg harvest: {0} m³/v ({1}% of growth)", fi: "  Keskim. hakkuu: {0} m³/v ({1}% kasvusta)" },
    planPeriod2Footer: { en: "Period 2 extension also generated. Would you like any changes?", fi: "Kausi 2 on myös luotu. Haluatko tehdä muutoksia?" },
    planEmpty:         { en: "No compartments found for this forest.", fi: "Tälle metsälle ei löytynyt kuvioita." },
    // ── Sustainability check ──
    sustNoOpsYear:     { en: "No operations planned for {0}. Harvest volume: 0 m³. Annual growth: {1} m³/v. No sustainability concerns.", fi: "Ei toimenpiteitä vuodelle {0}. Hakkuumäärä: 0 m³. Vuotuinen kasvu: {1} m³/v. Ei kestävyyshuolia." },
    sustNoOps:         { en: "No operations in plan. Nothing to check.", fi: "Suunnitelmassa ei ole toimenpiteitä. Ei tarkistettavaa." },
    sustTitle:         { en: "📊 Harvest Sustainability Check",        fi: "📊 Hakkuun kestävyystarkistus" },
    sustYear:          { en: "Year: {0}",                              fi: "Vuosi: {0}" },
    sustPeriod:        { en: "Period: all planned years",             fi: "Kausi: kaikki suunnitellut vuodet" },
    sustGrowth:        { en: "Annual growth: {0} m³/v",               fi: "Vuotuinen kasvu: {0} m³/v" },
    sustGrowthAvg:     { en: "Average annual growth: {0} m³/v",       fi: "Keskimääräinen vuosikasvu: {0} m³/v" },
    sustHarvest:       { en: "Total harvest: {0} m³{1}",              fi: "Kokonaishakkuu: {0} m³{1}" },
    sustHarvestTotal:  { en: " (total)",                              fi: " (yhteensä)" },
    sustHarvestAvg:    { en: "Average annual harvest: {0} m³/v",      fi: "Keskimääräinen vuosihakkuu: {0} m³/v" },
    sustVsGrowth:      { en: "Harvest vs growth: {0}%",               fi: "Hakkuu vs kasvu: {0}%" },
    sustOpCount:       { en: "Harvest operations: {0}",               fi: "Hakkuutoimenpiteitä: {0}" },
    sustIncome:        { en: "Total income from harvest: {0} €",      fi: "Hakkuutulot yhteensä: {0} €" },
    sustBadYears:      { en: "⚠️ Harvest exceeds growth in years: {0}", fi: "⚠️ Hakkuu ylittää kasvun vuosina: {0}" },
    sustSustainable:   { en: "✅ Harvest is within sustainable limits (harvest ≤ annual growth).", fi: "✅ Hakkuu on kestävällä tasolla (hakkuu ≤ vuotuinen kasvu)." },
    sustExceeds:       { en: "⚠️ Harvest exceeds annual growth! Consider reducing harvest volume.", fi: "⚠️ Hakkuu ylittää vuotuisen kasvun! Harkitse hakkuumäärän pienentämistä." },
    // ── Plan validation ──
    valNoOps:          { en: "No operations in plan. Generate a plan first.", fi: "Suunnitelmassa ei ole toimenpiteitä. Luo suunnitelma ensin." },
    valPassed:         { en: "✅ Plan validation passed! All checks OK.", fi: "✅ Suunnitelman validointi meni läpi! Kaikki tarkistukset OK." },
    valTitle:          { en: "📋 Plan Validation Report",             fi: "📋 Suunnitelman validointiraportti" },
    valMissingComp:    { en: "Operation {0} references unknown compartment in year {1}", fi: "Toimenpide {0} viittaa tuntemattomaan kuvioon vuonna {1}" },
    valStats:          { en: "Operations: {0} | Compartments: {1}",   fi: "Toimenpiteitä: {0} | Kuvioita: {1}" },
    valIssues:         { en: "Issues: {0} error(s), {1} warning(s)",  fi: "Ongelmia: {0} virhe(ttä), {1} varoitusta" },
    valErrors:         { en: "❌ Errors:",                            fi: "❌ Virheet:" },
    valWarnings:       { en: "⚠️ Warnings:",                          fi: "⚠️ Varoitukset:" },
    valValid:          { en: "✅ Plan is valid (no critical errors).",fi: "✅ Suunnitelma on validi (ei kriittisiä virheitä)." },
    valInvalid:        { en: "❌ Plan has critical errors. Fix before using.", fi: "❌ Suunnitelmassa on kriittisiä virheitä. Korjaa ennen käyttöä." },
    valClearcutBadStand: { en: "Clearcut on stand {0} ({1}) which is not regeneration-ready.", fi: "Avohakkuu kuviolla {0} ({1}), joka ei ole uudistuskypsä." },
    valThinInterval:   { en: "Stand {0} thinned in {1} and again in {2} (< 10 year interval).", fi: "Kuvio {0} harvennettu {1} ja uudelleen {2} (< 10 v väli)." },
    valNoRegen:        { en: "Stand {0} clearcut in {1} but no regeneration chain follows.", fi: "Kuvio {0} avohakattu {1}, mutta uudistamisketjua ei seuraa." },
    valHarvestExceeds: { en: "Year {0}: harvest {1} m³ exceeds growth {2} m³.", fi: "Vuosi {0}: hakkuu {1} m³ ylittää kasvun {2} m³." },
    valDuplicate:      { en: "Duplicate: {0} on stand {1} in {2}.",  fi: "Duplikaatti: {0} kuviolla {1} vuonna {2}." },
    valPastYear:       { en: "{0} on stand {1} in {2} is in the past.", fi: "{0} kuviolla {1} vuonna {2} on menneisyydessä." },
    // ── Stand detail (get_stand) ──
    standDetail:       { en: "📋 Stand {0}",             fi: "📋 Kuvio {0}" },
    standArea:         { en: "  Area: {0} ha",           fi: "  Pinta-ala: {0} ha" },
    standDevClass:     { en: "  Development class: {0}", fi: "  Kehitysluokka: {0}" },
    standMainSpecies:  { en: "  Main species: {0}",      fi: "  Pääpuulaji: {0}" },
    standSiteType:     { en: "  Site type: {0}",         fi: "  Kasvupaikka: {0}" },
    standAge:          { en: "  Age: {0} years",         fi: "  Ikä: {0} vuotta" },
    standVolume:       { en: "  Volume: {0} m³",         fi: "  Tilavuus: {0} m³" },
    standBasalArea:    { en: "  Basal area: {0} m²/ha",  fi: "  Pohjapinta-ala: {0} m²/ha" },
    standAvgHeight:    { en: "  Avg height: {0} m",      fi: "  Keskipituus: {0} m" },
    standAvgDiameter:  { en: "  Avg diameter: {0} cm",   fi: "  Keskiläpimitta: {0} cm" },
    standGrowth:       { en: "  Growth: {0} m³/ha/y",    fi: "  Kasvu: {0} m³/ha/v" },
    // ── Plan summary ──
    summaryTitle:      { en: "📊 Plan Summary for {0} ha forest", fi: "📊 Suunnitelman yhteenveto {0} han metsälle" },
    summaryClearcuts:  { en: "  Clearcuts: {0}",         fi: "  Avohakkuut: {0}" },
    summaryThinnings:  { en: "  Thinnings: {0}",         fi: "  Harvennukset: {0}" },
    summaryRegen:      { en: "  Regeneration: {0}",      fi: "  Uudistaminen: {0}" },
    summaryIncome:     { en: "  Income: {0} €",          fi: "  Tulot: {0} €" },
    summaryCosts:      { en: "  Costs: {0} €",           fi: "  Kulut: {0} €" },
    summaryNet:        { en: "  Net: {0} €",             fi: "  Netto: {0} €" },
    summaryTotalOps:   { en: "Total operations: {0}",    fi: "Toimenpiteitä yhteensä: {0}" },
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
  colForest: string;
  colSpecies: string;
  colArea: string;
  colVolume: string;
  colAge: string;
  colDevClass: string;
  colSiteType: string;
  colGrowth: string;
  filterForest: string;
  filterSpecies: string;
  filterDevClass: string;
  filterSite: string;
  chipForest: string;
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
  colStems: string;
  colHeight: string;
  colDiameter: string;
  colBA: string;
  simHeader: string;
  simYearLabel: string;
  simNoData: string;
  simCurrentState: string;
}

export function standListLabels(lang: Language): StandListLabels {
  if (lang === "fi") {
    return {
      colStand: "Kuvio",
      colForest: "Metsä",
      colSpecies: "Puulaji",
      colArea: "Pinta-ala (ha)",
      colVolume: "Tilavuus (m³)",
      colAge: "Ikä",
      colDevClass: "Kehitysluokka",
      colSiteType: "Kasvupaikka",
      colGrowth: "Kasvu (m³/ha/v)",
      filterForest: "Metsä",
      filterSpecies: "Puulaji",
      filterDevClass: "Kehityslk.",
      filterSite: "Kasvupaikka",
      chipForest: "Metsä",
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
      colStems: "Runkoluku/ha",
      colHeight: "Pituus (m)",
      colDiameter: "Lpm. (cm)",
      colBA: "PPA (m²/ha)",
      simHeader: "Simulaatio",
      simYearLabel: "Vuosi",
      simNoData: "Ei simulaatiodataa. Luo metsäsuunnitelma ensin.",
      simCurrentState: "Nykyinen tila",
    };
  }
  return {
    colStand: "Stand",
    colForest: "Forest",
    colSpecies: "Species",
    colArea: "Area (ha)",
    colVolume: "Volume (m³)",
    colAge: "Age",
    colDevClass: "Dev. Class",
    colSiteType: "Site Type",
    colGrowth: "Growth (m³/ha/y)",
    filterForest: "Forest",
    filterSpecies: "Species",
    filterDevClass: "Dev. Class",
    filterSite: "Site",
    chipForest: "Forest",
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
    colStems: "Stems/ha",
    colHeight: "Height (m)",
    colDiameter: "Diam. (cm)",
    colBA: "BA (m²/ha)",
    simHeader: "Simulation",
    simYearLabel: "Year",
    simNoData: "No simulation data. Generate a plan first.",
    simCurrentState: "Current State",
  };
}

// ── Operation list labels ──
export interface OperationListLabels {
  colStand: string;
  colForest: string;
  colType: string;
  colYear: string;
  colAge: string;
  colSpecies: string;
  colArea: string;
  colVolume: string;
  colStems: string;
  colHeight: string;
  colDiameter: string;
  colRemoval: string;
  colIncome: string;
  colCost: string;
  colDevClass: string;
  filterForest: string;
  filterType: string;
  filterSpecies: string;
  chipForest: string;
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
      colForest: "Metsä",
      colType: "Tyyppi",
      colYear: "Vuosi",
      colAge: "Ikä",
      colSpecies: "Puulaji",
      colArea: "Pinta-ala (ha)",
      colVolume: "Til. (m³)",
      colStems: "Runkoluku",
      colHeight: "Pituus",
      colDiameter: "Lpm.",
      colRemoval: "Poistuma %",
      colIncome: "Tuotto (€)",
      colCost: "Kulu (€)",
      colDevClass: "Kehityslk.",
      filterForest: "Metsä",
      filterType: "Tyyppi",
      filterSpecies: "Puulaji",
      chipForest: "Metsä",
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
    colForest: "Forest",
    colType: "Type",
    colYear: "Year",
    colAge: "Age",
    colSpecies: "Species",
    colArea: "Area (ha)",
    colVolume: "Vol. (m³)",
    colStems: "Stems/ha",
    colHeight: "Height",
    colDiameter: "Diam.",
    colRemoval: "Removal %",
    colIncome: "Income (€)",
    colCost: "Cost (€)",
    colDevClass: "Dev. Class",
    filterForest: "Forest",
    filterType: "Type",
    filterSpecies: "Species",
    chipForest: "Forest",
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
