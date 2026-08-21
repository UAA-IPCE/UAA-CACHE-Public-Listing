import { CacheEvent, ProfessionFilter, TopicFilter, TrainingTag, EventTag } from "@/types/event";
import rawCourses from "./ahecCourses.json";
import { cacheMasterTitles } from "./cacheMasterList";
import regionsData from "./regions.json";
import { uaaPortalEvents } from "./uaaPortalEvents";
import { matchHostOrganizationLocation, matchVenueRecord } from "./venues";

const DEFAULT_UAA_CACHE_CATALOG_URL = "https://continuingstudies.alaska.edu/Registration.aspx?AffiliateID=6Q68Q3";

function normalizeTitle(value: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toSlug(value: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function tokenizeTitle(value: string): string[] {
  return normalizeTitle(value)
    .split(" ")
    .filter(token => token.length > 2 && !new Set(["and", "for", "the", "with", "from", "into", "via", "part", "series", "course", "training", "workshop", "best", "practices"]).has(token));
}

function titlesLikelyMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeTitle(left);
  const normalizedRight = normalizeTitle(right);

  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return true;

  const leftTokens = new Set(tokenizeTitle(left));
  const rightTokens = new Set(tokenizeTitle(right));
  if (!leftTokens.size || !rightTokens.size) return false;

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }

  return overlap / Math.min(leftTokens.size, rightTokens.size) >= 0.6;
}

const sectionTitleById = new Map(
  (rawCourses as Array<{ SectionIndex?: number | string; CourseName?: string }>).map(course => [
    String(course.SectionIndex ?? ""),
    course.CourseName ?? "",
  ])
);

function extractUaaSectionIndex(registrationUrl: string): string | null {
  if (!registrationUrl) return null;

  try {
    const parsed = new URL(registrationUrl);
    if (parsed.hostname.toLowerCase() !== "continuingstudies.alaska.edu") return null;
    return parsed.searchParams.get("FilterSectionIndex") ?? parsed.searchParams.get("SectionIndex") ?? parsed.searchParams.get("id");
  } catch {
    return null;
  }
}

function sanitizeRegistrationUrl(event: CacheEvent): CacheEvent {
  if (!event.registration_url) {
    return { ...event, registration_url: DEFAULT_UAA_CACHE_CATALOG_URL };
  }

  let parsed: URL;
  try {
    parsed = new URL(event.registration_url);
  } catch {
    return event;
  }

  if (parsed.hostname.toLowerCase() !== "continuingstudies.alaska.edu") {
    return event;
  }

  const sectionIndex = extractUaaSectionIndex(event.registration_url);
  if (!sectionIndex) {
    return { ...event, registration_url: DEFAULT_UAA_CACHE_CATALOG_URL };
  }

  const linkedCourseTitle = sectionTitleById.get(sectionIndex);
  if (!linkedCourseTitle) {
    return { ...event, registration_url: `https://continuingstudies.alaska.edu/Registration.aspx?AffiliateID=6Q68Q3&FilterSectionIndex=${sectionIndex}` };
  }

  return event;
}

type RegionRecord = {
  id: string;
  name: string;
  major_cities: string[];
  latitude: number;
  longitude: number;
};

const regions = regionsData as RegionRecord[];

const cityCoordinateOverrides: Record<string, { latitude: number; longitude: number; region?: string }> = {
  anchorage: { latitude: 61.2181, longitude: -149.9003, region: "Southcentral" },
  wasilla: { latitude: 61.5814, longitude: -149.4394, region: "Southcentral" },
  palmer: { latitude: 61.5994, longitude: -149.1146, region: "Southcentral" },
  soldotna: { latitude: 60.4864, longitude: -151.0583, region: "Southcentral" },
  kenai: { latitude: 60.5544, longitude: -151.2583, region: "Southcentral" },
  homer: { latitude: 59.6425, longitude: -151.5483, region: "Southcentral" },
  fairbanks: { latitude: 64.8378, longitude: -147.7164, region: "Interior" },
  "north pole": { latitude: 64.7511, longitude: -147.3494, region: "Interior" },
  "delta junction": { latitude: 64.0377, longitude: -145.7322, region: "Interior" },
  tok: { latitude: 63.3367, longitude: -142.9856, region: "Interior" },
  juneau: { latitude: 58.3005, longitude: -134.4197, region: "Southeast" },
  sitka: { latitude: 57.0531, longitude: -135.33, region: "Southeast" },
  ketchikan: { latitude: 55.3422, longitude: -131.6461, region: "Southeast" },
  petersburg: { latitude: 56.8126, longitude: -132.9556, region: "Southeast" },
  wrangell: { latitude: 56.4708, longitude: -132.3761, region: "Southeast" },
  nome: { latitude: 64.5011, longitude: -165.4064, region: "Northwest" },
  kotzebue: { latitude: 66.8972, longitude: -162.5967, region: "Northwest" },
  utqiagvik: { latitude: 71.2906, longitude: -156.7886, region: "Northwest" },
  barrow: { latitude: 71.2906, longitude: -156.7886, region: "Northwest" },
  bethel: { latitude: 60.7922, longitude: -161.7558, region: "Yukon-Kuskokwim" },
  aniak: { latitude: 61.5819, longitude: -159.543, region: "Yukon-Kuskokwim" },
  "hooper bay": { latitude: 61.5314, longitude: -166.0967, region: "Yukon-Kuskokwim" },
  kodiak: { latitude: 57.79, longitude: -152.4072, region: "Southcentral" },
  girdwood: { latitude: 60.9422, longitude: -149.1678, region: "Southcentral" },
};

for (const region of regions) {
  for (const city of region.major_cities ?? []) {
    const canonical = city.toLowerCase().replace(/\s*\([^)]*\)/g, "").trim();
    if (!cityCoordinateOverrides[canonical]) {
      cityCoordinateOverrides[canonical] = {
        latitude: region.latitude,
        longitude: region.longitude,
        region: region.name,
      };
    }
    const parenAlias = city.match(/\(([^)]+)\)/)?.[1]?.toLowerCase().trim();
    if (parenAlias && !cityCoordinateOverrides[parenAlias]) {
      cityCoordinateOverrides[parenAlias] = {
        latitude: region.latitude,
        longitude: region.longitude,
        region: region.name,
      };
    }
  }
}

const liveSnapshotMetadataOverrides: Record<string, { seats?: number; priceUsd?: number }> = {
  [normalizeTitle("Implementing MOUD: Pain Management, Opioid Use, and Addiction in Alaska")]: { seats: 9972 },
  [normalizeTitle("ACFTA Live Sessions 2026 - August (dates TBD) (Remote via Zoom)")]: { seats: 24, priceUsd: 75 },
  [normalizeTitle("Addiction Technology Transfer Center Network")]: { seats: 8921 },
  [normalizeTitle("Addressing Substance Use in Rural Alaska")]: { seats: 9961 },
  [normalizeTitle("Alaska Mandatory Child Abuse Reporter Training")]: { seats: 9998 },
  [normalizeTitle("Alaska Medication for Addiction Treatment Guide 3rd Edition Training Modules")]: { seats: 9989 },
  [normalizeTitle("Alaska Pharmacy Association - Home Study CE")]: { seats: 30 },
  [normalizeTitle("Alaska Primary Care Association Community Health Worker ECHO")]: { seats: 9998 },
  [normalizeTitle("Alaska Tribal Perspective on COVID-19 Vaccination Efforts")]: { seats: 9996 },
  [normalizeTitle("Alaskan Mobile Crisis Responder: Essential Skills and Strategies for Challenging Conditions")]: { seats: 9925 },
  [normalizeTitle("An Introduction to Academic Detailing")]: { seats: 9991 },
  [normalizeTitle("Building Vaccine Confidence in Alaska")]: { seats: 9834 },
  [normalizeTitle("CALS 2026 - MD/DO/PA/NP - October 2026")]: { seats: 16, priceUsd: 1650 },
  [normalizeTitle("CALS 2026 - RN/Paramedic - October 2026")]: { seats: 4, priceUsd: 1200 },
  [normalizeTitle("Chronic Pain Core Curriculum - PCSS")]: { seats: 29 },
  [normalizeTitle("Cultural Foundations for Healthcare Providers in Alaska")]: { seats: 9749 },
  [normalizeTitle("Cultural Humility in Behavioral Health Care")]: { seats: 9999, priceUsd: 0 },
  [normalizeTitle("Empowering Recovery: Ethics & Collaborative Decision-Making in Behavioral Health")]: { seats: 9999, priceUsd: 0 },
  [normalizeTitle("Ethics and Confidentiality For Peer Supervisors")]: { seats: 9990 },
  [normalizeTitle("Foundation of Peer Support Professionals")]: { seats: 9992 },
  [normalizeTitle("Grief Literacy for School Social Workers: Supporting Students Experiencing Grief and Loss")]: { seats: 9996 },
  [normalizeTitle("Healthcare Provider Burnout: Prevalence, Consequences, and Solutions with Dr. Kari Bernard")]: { seats: 9959 },
  [normalizeTitle("Human Services Practicum Connection")]: { seats: 37 },
  [normalizeTitle("Interprofessional Approaches to Fetal Alcohol Spectrum Disorders (FASD): Best Practices in Alaska")]: { seats: 9741 },
  [normalizeTitle("NAADAC On-Demand Webinar Series")]: { seats: 9998 },
  [normalizeTitle("NWCPHP Seven Directions Indigenous Evaluation Toolkit Training")]: { seats: 9996 },
  [normalizeTitle("Program Evaluation in Public Health")]: { seats: 9999, priceUsd: 0 },
  [normalizeTitle("Regulations and Standards of Billable Peer Support Services in Alaska")]: { seats: 9994 },
  [normalizeTitle("SUITE Alaska - Module 1: Introduction to Alcohol and Substance Use Disorders")]: { seats: 47 },
  [normalizeTitle("SUITE Alaska - Module 2: Overview of Opioids")]: { seats: 103 },
  [normalizeTitle("SUITE Alaska - Module 3: Intoxication, Detoxification, and Withdrawal")]: { seats: 96 },
  [normalizeTitle("SUITE Alaska - Module 4: Screening and Assessment")]: { seats: 152 },
  [normalizeTitle("SUITE Alaska - Module 5: Motivational Interviewing and the Stages of Change")]: { seats: 143 },
  [normalizeTitle("SUITE Alaska - Module 6: Relapse Prevention")]: { seats: 169 },
  [normalizeTitle("SUITE Alaska - Module 7: Recovery Ethics in Substance Use Treatment")]: { seats: 183 },
  [normalizeTitle("SUITE Alaska - Module 8: Culture and Culturally Informed Substance Use Treatment Practice")]: { seats: 185 },
  [normalizeTitle("SUITE Alaska - Strengthening Families Framework sec. 2")]: { seats: 300, priceUsd: 0 },
  [normalizeTitle("Weight Inclusive Care")]: { seats: 9892 },
  [normalizeTitle("Workforce Empowerment & Engagement: Addressing Burnout and Compassion Fatigue")]: { seats: 9969 },
  [normalizeTitle("Workforce Empowerment & Engagement: An Intergenerational Workforce")]: { seats: 9983 },
  [normalizeTitle("Workforce Empowerment & Engagement: Boundaries for Workplace Wellness")]: { seats: 9976 },
  [normalizeTitle("Workforce Empowerment & Engagement: Defining Needs and Requests")]: { seats: 9980 },
  [normalizeTitle("Workforce Empowerment & Engagement: Exploring Communication in the Workplace")]: { seats: 9974 },
  [normalizeTitle("Workforce Empowerment & Engagement: Exploring Healthy Conflict")]: { seats: 9970 },
  [normalizeTitle("Workforce Empowerment & Engagement: Personalities and Work Styles")]: { seats: 9974 },
  [normalizeTitle("Adult Mental Health First Aid - August 26 2026 - Anchorage")]: { seats: 28, priceUsd: 0 },
  [normalizeTitle("2026 AHHA Annual Conference - Girdwood")]: { seats: 150, priceUsd: 295 },
  [normalizeTitle("Transforming Touch - Part 1 - October 7-12, 2026")]: { seats: 30, priceUsd: 0 },
  [normalizeTitle("CALS 2026 - MD/DO/PA/NP - October 9 - 10 2026")]: { seats: 16, priceUsd: 1650 },
  [normalizeTitle("CALS 2026 - RN/Paramedic - October 9 - 10 2026")]: { seats: 16, priceUsd: 1200 },
  [normalizeTitle("2026 All-Alaska Medical Conference")]: { seats: 200, priceUsd: 350 },
  [normalizeTitle("ACFTA Live Sessions 2026 - October 27-29 (Remote via Zoom)")]: { seats: 24, priceUsd: 75 },
};

function applyLiveSnapshotMetadata(event: CacheEvent): CacheEvent {
  const normalized = normalizeTitle(event.title);
  const override = liveSnapshotMetadataOverrides[normalized];

  const seats_remaining = override?.seats ?? event.seats_remaining ?? 9999;
  const price_usd = override?.priceUsd ?? event.price_usd;

  return {
    ...event,
    seats_remaining,
    price_usd,
  };
}

function inferProfessions(title: string, description: string, rawCredits?: unknown, keyword?: string): ProfessionFilter[] {
  const haystack = `${title} ${description} ${keyword || ""}`.toLowerCase();
  const professions = new Set<ProfessionFilter>();

  const credStr = Array.isArray(rawCredits) ? rawCredits.join(" ") : String(rawCredits || "");
  const credUpper = credStr.toUpperCase();

  // 1. Credits mapping
  if (credUpper.includes("CME") || credUpper.includes("AMA")) {
    professions.add("physician");
  }
  if (credUpper.includes("CNE") || credUpper.includes("ANCC") || credUpper.includes("NURSE")) {
    professions.add("nurse");
  }
  if (credUpper.includes("PHARMACY") || credUpper.includes("ACPE")) {
    professions.add("pharmacy");
  }
  if (credUpper.includes("SOCIAL WORK") || credUpper.includes("ASWB") || credUpper.includes("NASW")) {
    professions.add("social-work");
  }
  if (credUpper.includes("DENTAL") || credUpper.includes("ADA")) {
    professions.add("dental");
  }

  // 2. Text keyword matching
  if (/(physician|doctor|medical doctor| md | do |prescriber|clinical provider|medical director|hospitalist)/i.test(haystack)) {
    professions.add("physician");
  }
  if (/(nurse|nursing| rn | lpn | aprn | np |cne|ancc)/i.test(haystack)) {
    professions.add("nurse");
  }
  if (/(behavioral health|mental health|psychiatr|psycholog|counsel|substance use|sud|addiction|therapy|therapist|peer support|ethics in dsm|recovery|moud|mat|opioid|harm reduction|alcohol|crisis)/i.test(haystack)) {
    professions.add("behavioral-health");
  }
  if (/(pharmacy|pharmacist| rx |medication|prescrib|pharmacotherapy)/i.test(haystack)) {
    professions.add("pharmacy");
  }
  if (/(public health|epidemiolog|vaccine|immuniz|prevention|health equity|community health|infection control|outbreak|one health|tobacco|school safety)/i.test(haystack)) {
    professions.add("public-health");
  }
  if (/(community health aide| cha | chp |cha\/p|community health worker| chw |allied health|practitioner|aide)/i.test(haystack)) {
    professions.add("community-health-aide");
  }
  if (/(social work|social worker|nasw|aswb|case manage|family support|grief literacy|child abuse)/i.test(haystack)) {
    professions.add("social-work");
  }
  if (/(dental|dentist|hygienist|oral health|tooth|teeth|coronal polishing)/i.test(haystack)) {
    professions.add("dental");
  }
  if (/(law enforcement|police|officer|sheriff|correctional|first responder|mobile crisis|paramedic|emergency department|critical access|cals)/i.test(haystack)) {
    professions.add("law-enforcement");
  }

  // Default fallback if still empty
  if (professions.size === 0) {
    professions.add("behavioral-health");
    professions.add("nurse");
    professions.add("public-health");
  }

  return [...professions];
}

function inferCredits(rawCredits?: unknown, description?: string): string[] {
  const creds = new Set<string>();
  const raw = String(rawCredits || "").trim();
  const desc = String(description || "");

  if (/cme|ama pra/i.test(raw) || /cme|ama pra/i.test(desc)) creds.add("CME");
  if (/cne|ancc|contact hour/i.test(raw) || /cne|ancc|nursing contact/i.test(desc)) creds.add("CNE");
  if (/social work|nasw|aswb/i.test(raw) || /social work/i.test(desc)) creds.add("Social Work CE");
  if (/pharmacy|acpe/i.test(raw) || /pharmacy/i.test(desc)) creds.add("Pharmacy CE");
  if (/dental|ada cerp/i.test(raw) || /dental/i.test(desc)) creds.add("Dental CE");

  if (raw && !isNaN(Number(raw)) && Number(raw) > 0) {
    creds.add("CEU");
  } else if (/ceu/i.test(raw) || /ceu/i.test(desc)) {
    creds.add("CEU");
  }

  if (creds.size === 0) {
    creds.add("CEU");
  }

  return [...creds];
}

function inferTopics(event: CacheEvent): TopicFilter[] {
  const haystack = `${event.title} ${event.description}`.toLowerCase();
  const topics = new Set<TopicFilter>();

  if (/(substance|sud|opioid|moud|mat|addiction|harm reduction|alcohol)/.test(haystack)) {
    topics.add("substance-use-disorders");
  }
  if (/(trauma|forensic|compassion fatigue|violence|de-escalation)/.test(haystack)) {
    topics.add("trauma-informed-care");
  }
  if (/(equity|inclusive|disparit|underserved|rural|indigenous|cultural humility|culturally)/.test(haystack)) {
    topics.add("health-equity");
  }
  if (/(chronic|diabetes|hypertension|arthritis|pain)/.test(haystack)) {
    topics.add("chronic-disease");
  }
  if (/(gero|geront|older adult|senior|elder|alzheimer|dementia)/.test(haystack)) {
    topics.add("elder-care-senior-services");
  }
  if (/autism/.test(haystack)) {
    topics.add("autism-spectrum-disorders");
  }
  if (/fasd|fetal alcohol|prenatal alcohol/.test(haystack)) {
    topics.add("fasd");
  }

  return [...topics];
}

function inferTrainingTags(event: CacheEvent): TrainingTag[] {
  const haystack = `${event.title} ${event.description}`.toLowerCase();
  const tags = new Set<TrainingTag>();

  tags.add("Professional Development and Training");
  tags.add("Continuing Education");

  if (event.profession.includes("nurse")) tags.add("Nursing");
  if (event.profession.includes("physician")) tags.add("Physicians");
  if (event.profession.includes("pharmacy")) tags.add("Pharmacy");
  if (event.profession.includes("social-work")) tags.add("Social Work");
  if (event.profession.includes("behavioral-health")) tags.add("Behavioral Health");
  if (event.profession.includes("community-health-aide")) tags.add("Allied Health");
  if (event.profession.includes("dental")) tags.add("Dental");
  if (event.profession.includes("law-enforcement")) tags.add("Law Enforcement");
  if (event.profession.includes("first-responder")) tags.add("First Responders");

  if (/(substance|sud|opioid|moud|mat|addiction|qap)/.test(haystack)) tags.add("Substance Use Disorders");
  if (/(trauma|forensic|compassion fatigue|violence|de-escalation)/.test(haystack)) tags.add("Trauma Informed Care");
  if (/(equity|inclusive|disparit|underserved|indigenous|cultural humility|culturally)/.test(haystack)) tags.add("Health Equity");
  if (/(elder|older adult|senior|gero|alzheimer|dementia)/.test(haystack)) tags.add("Aging/Senior Services");
  if (/fasd|fetal alcohol/.test(haystack)) tags.add("FASD - Fetal Alcohol Syndrome");
  if (/autism/.test(haystack)) tags.add("Autism Spectrum Disorders");
  if (/(mental health|behavioral health|counsel|mhfa|peer)/.test(haystack)) tags.add("Behavioral and Mental Health");
  if (/resilien|burnout|wellness/.test(haystack)) tags.add("Resilience");
  if (/emergency|cals|first aid|critical|trauma update/.test(haystack)) tags.add("Emergency and Medical");
  if (/student|practicum|academy|onboarding/.test(haystack)) tags.add("Students");

  return [...tags];
}

function withDefaults(event: CacheEvent): CacheEvent {
  return {
    ...event,
    tags: event.tags ?? [],
    topics: (event.topics && event.topics.length > 0) ? event.topics : inferTopics(event),
    training_tags: (event.training_tags && event.training_tags.length > 0) ? event.training_tags : inferTrainingTags(event),
  };
}

function normalizeLocation(loc: string): string {
  if (!loc) return "";
  const cleaned = loc.replace(/^\*+/, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";

  const lowered = cleaned.toLowerCase();
  if (/(online|virtual|zoom|webinar|remote)/.test(lowered)) return "Online";

  const bareCity = cleaned.replace(/,?\s*alaska$/i, "").trim();
  const cityKey = bareCity.toLowerCase();
  if (cityCoordinateOverrides[cityKey]) {
    return `${bareCity}, Alaska`;
  }

  return cleaned;
}

function inferRegionFromLocation(loc?: string): string | undefined {
  if (!loc) return undefined;
  const normalized = normalizeLocation(loc);
  if (!normalized) return undefined;
  if (normalized === "Online") return "Virtual";

  const bareCity = normalized.replace(/,?\s*alaska$/i, "").trim().toLowerCase();
  if (cityCoordinateOverrides[bareCity]?.region) {
    return cityCoordinateOverrides[bareCity].region;
  }

  return undefined;
}

function inferCoordinatesFromLocation(loc?: string): { latitude: number; longitude: number } | undefined {
  if (!loc) return undefined;
  const normalized = normalizeLocation(loc);
  if (!normalized || normalized === "Online") return undefined;

  const bareCity = normalized.replace(/,?\s*alaska$/i, "").trim().toLowerCase();
  const direct = cityCoordinateOverrides[bareCity];
  if (direct) {
    return { latitude: direct.latitude, longitude: direct.longitude };
  }

  return undefined;
}

function enrichEventLocation(event: CacheEvent, extraText?: string): CacheEvent {
  const location = normalizeLocation(event.location);
  const hostOrganizationLocation = matchHostOrganizationLocation(event.organization);
  const matchedVenue = event.format === "Virtual"
    ? undefined
    : matchVenueRecord({
        title: event.title,
        location,
        description: event.description,
        extraText,
      });
  const inferredRegion = event.region ?? inferRegionFromLocation(location);
  const inferredCoordinates =
    event.latitude !== undefined && event.longitude !== undefined
      ? { latitude: event.latitude, longitude: event.longitude }
      : matchedVenue
        ? { latitude: matchedVenue.latitude, longitude: matchedVenue.longitude }
      : location === "Online" && hostOrganizationLocation
        ? { latitude: hostOrganizationLocation.latitude, longitude: hostOrganizationLocation.longitude }
      : inferCoordinatesFromLocation(location) ??
        (inferredRegion
          ? (() => {
              const region = regions.find((entry) => entry.name === inferredRegion);
              return region
                ? { latitude: region.latitude, longitude: region.longitude }
                : undefined;
            })()
          : undefined);

  return {
    ...event,
    location: matchedVenue?.locationLabel ?? location ?? event.location,
    venue_id: matchedVenue?.id ?? event.venue_id,
    venue_name: matchedVenue?.name ?? event.venue_name,
    address: matchedVenue?.address ?? event.address ?? (location === "Online" ? hostOrganizationLocation?.address : undefined),
    region: matchedVenue?.region ?? inferredRegion ?? (location === "Online" ? hostOrganizationLocation?.region : undefined),
    latitude: inferredCoordinates?.latitude ?? event.latitude,
    longitude: inferredCoordinates?.longitude ?? event.longitude,
  };
}

function normalizeFormat(delivery: string, loc?: string): "Virtual" | "In-Person" | "Hybrid" {
  const d = (delivery || "").toLowerCase();
  const l = (loc || "").toLowerCase();
  if (d.includes("on-demand") || l.includes("online") || l.includes("zoom") || l.includes("virtual")) return "Virtual";
  if (d.includes("live") && (l.includes("online") || l.includes("zoom") || l.includes("remote"))) return "Virtual";
  if (d.includes("hybrid")) return "Hybrid";
  if (d.includes("live") && !l.includes("online")) return "In-Person";
  return "Virtual";
}

function inferEventTypeFromScraped(c: Record<string, unknown>): "live" | "on-demand" | "enduring" {
  const delivery = String(c.Delivery || "").toLowerCase();
  const startDate = String(c.FormatedStartDate || c.StartDate || "");
  const endDate = String(c.FormatedEndDate || c.EndDate || "");
  const hasNoDate = !startDate || startDate.toLowerCase() === "ongoing";
  const isOnDemand = delivery.includes("on-demand");

  if (hasNoDate || (isOnDemand && (!endDate || endDate.toLowerCase() === "ongoing"))) {
    return "enduring";
  }
  if (isOnDemand) return "on-demand";
  return "live";
}

function geniusDateToIso(rawIso?: unknown, formatted?: unknown): string {
  const isoStr = String(rawIso || "");
  if (isoStr && /^\d{4}-\d{2}-\d{2}/.test(isoStr)) {
    return isoStr.slice(0, 10);
  }
  const formStr = String(formatted || "");
  if (formStr && !/ongoing/i.test(formStr)) {
    const d = new Date(formStr);
    if (!isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }
  return formStr || "";
}

function autoClassifyEventType(event: CacheEvent): CacheEvent {
  if (event.event_type === "on-demand" || event.event_type === "enduring") {
    return event;
  }
  if (!event.event_type) {
    return { ...event, event_type: "live" };
  }
  return event;
}

// Map portal events for rich curated metadata enrichment
const portalByTitle = new Map<string, CacheEvent>();
const portalBySection = new Map<string, CacheEvent>();

for (const pe of uaaPortalEvents) {
  portalByTitle.set(normalizeTitle(pe.title), pe);
  const m = pe.registration_url?.match(/FilterSectionIndex=(\d+)/) || pe.id?.match(/uaa-(?:az-)?(\d+)/);
  if (m) {
    portalBySection.set(m[1], pe);
  }
}

function mapScraped(c: Record<string, any>): CacheEvent {
  const sectionStr = String(c.SectionIndex ?? "");
  const normalizedTitle = normalizeTitle(c.CourseName ?? "");
  const portal = portalBySection.get(sectionStr) || portalByTitle.get(normalizedTitle);

  const eventType = inferEventTypeFromScraped(c);
  const directUrl = c.DirectUrl || `https://continuingstudies.alaska.edu/Registration.aspx?AffiliateID=6Q68Q3&FilterSectionIndex=${c.SectionIndex}`;
  
  const rawStartDate = c.StartDate ? geniusDateToIso(c.StartDate, c.FormatedStartDate) : (portal?.start_date ?? (eventType === "live" ? "2026-01-01" : "2026-01-01"));
  const rawEndDate = c.EndDate ? geniusDateToIso(c.EndDate, c.FormatedEndDate) : (portal?.end_date ?? (eventType === "live" ? "2026-12-31" : "2099-12-31"));

  const inferredProf = inferProfessions(c.CourseName, c.Description || c.LongDescription, c.Credits, c.Keyword);
  const professions = (portal?.profession && portal.profession.length > 0) ? portal.profession : inferredProf;

  const inferredCreds = inferCredits(c.Credits, c.Description || c.LongDescription);
  const credits = (portal?.credits && portal.credits.length > 0) ? portal.credits : inferredCreds;

  const desc = c.Description || portal?.description || "";
  const location = c.Location ? normalizeLocation(c.Location) : (portal?.location || "Online");
  const format = normalizeFormat(c.Delivery, c.Location);
  const image = c.CourseImage || portal?.image || undefined;
  const duration_hours = portal?.duration_hours ?? (eventType === "on-demand" || eventType === "enduring" ? (c.Credits ? parseFloat(String(c.Credits)) || 1 : 1) : undefined);

  return enrichEventLocation({
    id: `uaa-cache-${c.SectionIndex}`,
    title: c.CourseName.trim(),
    organization: portal?.organization || "UAA Continuing Studies",
    location,
    format,
    start_date: rawStartDate,
    end_date: rawEndDate,
    profession: professions,
    credits,
    description: desc,
    registration_url: directUrl,
    region: inferRegionFromLocation(c.Location) || portal?.region,
    image,
    tags: (portal?.tags && portal.tags.length > 0) ? portal.tags : [],
    topics: portal?.topics,
    training_tags: portal?.training_tags,
    learning_objectives: portal?.learning_objectives,
    is_student_friendly: portal?.is_student_friendly,
    event_type: eventType,
    duration_hours,
    instructor_name: c.Teachers || portal?.instructor_name || undefined,
    seats_total: Number(c.Cap) > 0 ? Number(c.Cap) : portal?.seats_total,
    seats_remaining: Number(c.CapAvailable) >= 0 ? Number(c.CapAvailable) : portal?.seats_remaining,
    price_usd: c.Cost != null && c.Cost !== "" ? Number(c.Cost) : portal?.price_usd,
  }, [c.PublicNotes, c.LongDescription, c.Description, c.Location].filter(Boolean).join(" "));
}

// Canonical events array: strictly the 95 courses from CACHE affiliate feed
export const events: CacheEvent[] = (rawCourses as Record<string, any>[])
  .map(mapScraped)
  .map(withDefaults)
  .map(sanitizeRegistrationUrl)
  .map(applyLiveSnapshotMetadata)
  .map(autoClassifyEventType);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function getEventSlug(event: CacheEvent): string {
  return `${slugify(event.title)}--${event.id}`;
}

export function getEventById(id: string): CacheEvent | undefined {
  return events.find(e => e.id === id);
}

export function getEventBySlug(slugOrId: string): CacheEvent | undefined {
  const direct = getEventById(slugOrId);
  if (direct) return direct;

  const idx = slugOrId.lastIndexOf("--");
  if (idx === -1) return undefined;
  const id = slugOrId.slice(idx + 2);
  return getEventById(id);
}

export function getUpcomingEvents(): CacheEvent[] {
  const now = new Date().toISOString().split("T")[0];
  return events
    .filter(e => {
      const t = e.event_type ?? "live";
      if (t === "on-demand" || t === "enduring") return true;
      return e.start_date >= now;
    })
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
}

export function filterEvents(opts: {
  profession?: string;
  credit?: string;
  region?: string;
  topic?: string;
  trainingTag?: string;
  search?: string;
  format?: string;
  startDate?: string;
  endDate?: string;
  tag?: string;
  eventType?: "live" | "on-demand" | "enduring";
  freeOnly?: boolean;
}): CacheEvent[] {
  let result = [...events];
  if (opts.eventType) {
    result = result.filter(e => {
      const t = e.event_type ?? "live";
      if (opts.eventType === "on-demand") return t === "on-demand" || t === "enduring";
      return t === opts.eventType;
    });
  }
  if (opts.profession) {
    result = result.filter(e => e.profession.includes(opts.profession!));
  }
  if (opts.credit) {
    result = result.filter(e => e.credits.includes(opts.credit!));
  }
  if (opts.region) {
    result = result.filter(e => e.region === opts.region);
  }
  if (opts.topic) {
    result = result.filter(e => (e.topics ?? []).includes(opts.topic as never));
  }
  if (opts.trainingTag) {
    result = result.filter(e => (e.training_tags ?? []).includes(opts.trainingTag as never));
  }
  if (opts.format) {
    result = result.filter(e => e.format === opts.format);
  }
  if (opts.startDate) {
    result = result.filter(e => {
      const t = e.event_type ?? "live";
      if (t === "on-demand" || t === "enduring") return true;
      return e.start_date >= opts.startDate!;
    });
  }
  if (opts.endDate) {
    result = result.filter(e => {
      const t = e.event_type ?? "live";
      if (t === "on-demand" || t === "enduring") return true;
      return e.start_date <= opts.endDate!;
    });
  }
  if (opts.tag) {
    result = result.filter(e => e.tags?.includes(opts.tag as EventTag));
  }
  if (opts.freeOnly) {
    result = result.filter(e => e.price_usd === 0 || e.price_usd === undefined);
  }
  if (opts.search) {
    const q = opts.search.toLowerCase();
    result = result.filter(e =>
      e.title.toLowerCase().includes(q) ||
      e.organization.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q) ||
      (e.training_tags ?? []).some((t) => t.toLowerCase().includes(q))
    );
  }
  return result.sort((a, b) => a.start_date.localeCompare(b.start_date));
}

export function getEventsWithCoordinates(): CacheEvent[] {
  return events.filter(e => e.latitude !== undefined && e.longitude !== undefined);
}

export function getStudentFriendlyEvents(): CacheEvent[] {
  const now = new Date().toISOString().split("T")[0];
  return events
    .filter(e => {
      if (!e.is_student_friendly) return false;
      const t = e.event_type ?? "live";
      if (t === "on-demand" || t === "enduring") return true;
      return e.start_date >= now;
    })
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
}

export function getFilterCounts(baseEvents: CacheEvent[]) {
  const profession: Record<string, number> = {};
  const credit: Record<string, number> = {};
  const region: Record<string, number> = {};
  const topic: Record<string, number> = {};
  const trainingTag: Record<string, number> = {};
  const format: Record<string, number> = {};

  for (const e of baseEvents) {
    for (const p of e.profession) profession[p] = (profession[p] ?? 0) + 1;
    for (const c of e.credits) credit[c] = (credit[c] ?? 0) + 1;
    if (e.region) region[e.region] = (region[e.region] ?? 0) + 1;
    for (const t of e.topics ?? []) topic[t] = (topic[t] ?? 0) + 1;
    for (const t of e.training_tags ?? []) trainingTag[t] = (trainingTag[t] ?? 0) + 1;
    format[e.format] = (format[e.format] ?? 0) + 1;
  }

  return { profession, credit, region, topic, trainingTag, format };
}

export function getSuggestedFilters(
  baseEvents: CacheEvent[],
  activeProfession: string,
  activeRegion: string
): { professions: string[]; regions: string[] } {
  const professionCounts: Record<string, number> = {};
  const regionCounts: Record<string, number> = {};
  for (const e of baseEvents) {
    for (const p of e.profession) {
      if (p !== activeProfession) professionCounts[p] = (professionCounts[p] ?? 0) + 1;
    }
    if (e.region && e.region !== activeRegion) {
      regionCounts[e.region] = (regionCounts[e.region] ?? 0) + 1;
    }
  }

  const professions = Object.entries(professionCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([k]) => k);

  const regions = Object.entries(regionCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([k]) => k);

  return { professions, regions };
}
