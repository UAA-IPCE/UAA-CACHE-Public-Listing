#!/usr/bin/env node
/**
 * formatSocialPost.js — CACHE Social Media Post Formatter
 * ────────────────────────────────────────────────────────
 * Transforms a CACHE event JSON record into formatted posts
 * for LinkedIn and Facebook with proper character limits,
 * hashtags, and structured content.
 *
 * Used by publishToLinkedIn.js and publishToFacebook.js.
 */

/**
 * Truncate text to a maximum length, adding ellipsis if needed.
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function truncate(text, max) {
  if (!text || text.length <= max) return text || "";
  return text.slice(0, max - 1).trimEnd() + "…";
}

/**
 * Strip HTML tags from a string.
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
  return (html || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?(p|div|b|i|a|span|li|ul|ol|h\d)[^>]*>/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Format a date string (YYYY-MM-DD) into a human-readable format.
 * @param {string} dateStr
 * @returns {string}
 */
function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Build a date range display string.
 * @param {object} event
 * @returns {string}
 */
function buildDateDisplay(event) {
  if (!event.start_date) {
    return event.is_enduring ? "On-Demand (Self-Paced)" : "Date TBD";
  }
  const start = formatDate(event.start_date);
  if (!event.end_date || event.end_date === event.start_date) return start;
  return `${start} – ${formatDate(event.end_date)}`;
}

/**
 * Generate relevant hashtags from tags and category.
 * @param {object} event
 * @returns {string[]}
 */
function buildHashtags(event) {
  const tags = new Set();

  // Always include core tags
  tags.add("#AlaskaCACHE");
  tags.add("#ContinuingEducation");
  tags.add("#AlaskaHealthcare");

  const allTags = [...(event.tags || []), event.category || ""].join(" ").toLowerCase();

  if (/nurs/.test(allTags)) tags.add("#Nursing");
  if (/physician|md |medical/.test(allTags)) tags.add("#Physicians");
  if (/behavioral|mental health/.test(allTags)) tags.add("#BehavioralHealth");
  if (/social work/.test(allTags)) tags.add("#SocialWork");
  if (/pharmac/.test(allTags)) tags.add("#Pharmacy");
  if (/substance|opioid|sud/.test(allTags)) tags.add("#SubstanceUse");
  if (/trauma/.test(allTags)) tags.add("#TraumaInformedCare");
  if (/telehealth/.test(allTags)) tags.add("#Telehealth");
  if (/rural/.test(allTags)) tags.add("#RuralHealth");
  if (/equity|cultural/.test(allTags)) tags.add("#HealthEquity");
  if (/first aid|emergency|ems/.test(allTags)) tags.add("#FirstResponders");
  if (/dental/.test(allTags)) tags.add("#DentalHealth");
  if (/peer/.test(allTags)) tags.add("#PeerSupport");

  return [...tags].slice(0, 8); // Cap at 8 hashtags
}

/**
 * Build a formatted cost display.
 * @param {object} event
 * @returns {string}
 */
function buildCostDisplay(event) {
  if (event.cost === null || event.cost === undefined) return "Check listing for details";
  if (event.cost === 0) return "FREE";
  return `$${event.cost}`;
}

/**
 * Generate a LinkedIn post for a CACHE event.
 * LinkedIn supports up to ~3,000 characters per post.
 * @param {object} event
 * @returns {{ text: string, linkUrl: string }}
 */
export function formatLinkedInPost(event) {
  const title = event.title || "Untitled Training";
  const desc = truncate(stripHtml(event.description), 400);
  const dateDisplay = buildDateDisplay(event);
  const location = event.location || "Online";
  const delivery = event.delivery || (event.is_enduring ? "On-Demand" : "");
  const cost = buildCostDisplay(event);
  const credits = event.credits ? `${event.credits} CE Credits` : "";
  const hashtags = buildHashtags(event);
  const regUrl = event.registration_url || "";

  const lines = [
    `📚 New Training Available from Alaska CACHE`,
    ``,
    `${title}`,
    ``,
  ];

  if (desc) lines.push(desc, ``);

  lines.push(`📅 ${dateDisplay}`);
  lines.push(`📍 ${location}${delivery ? ` (${delivery})` : ""}`);
  if (credits) lines.push(`🎓 ${credits}`);
  lines.push(`💰 ${cost}`);
  lines.push(``);

  if (event.seats_available !== undefined && event.seats_available !== null && event.seats_available < 50) {
    lines.push(`⚡ Only ${event.seats_available} seats remaining!`);
    lines.push(``);
  }

  if (regUrl) {
    lines.push(`Register now 👇`);
    lines.push(regUrl);
    lines.push(``);
  }

  lines.push(`Alaska CACHE: A Clearinghouse for Continuing Health Education`);
  lines.push(`University of Alaska Anchorage | Alaska AHEC`);
  lines.push(``);
  lines.push(hashtags.join(" "));

  const text = lines.join("\n");
  return { text: truncate(text, 3000), linkUrl: regUrl };
}

/**
 * Generate a Facebook post for a CACHE event.
 * Facebook supports up to ~63,206 characters per post,
 * but best practice is under 500 characters for engagement.
 * We include more detail since Facebook allows it.
 * @param {object} event
 * @returns {{ message: string, linkUrl: string }}
 */
export function formatFacebookPost(event) {
  const title = event.title || "Untitled Training";
  const desc = truncate(stripHtml(event.description), 600);
  const dateDisplay = buildDateDisplay(event);
  const location = event.location || "Online";
  const delivery = event.delivery || (event.is_enduring ? "On-Demand" : "");
  const cost = buildCostDisplay(event);
  const credits = event.credits ? `${event.credits} CE Credits` : "";
  const hashtags = buildHashtags(event);
  const regUrl = event.registration_url || "";

  const lines = [
    `📚 New Continuing Education Training Available!`,
    ``,
    `${title}`,
    ``,
  ];

  if (desc) lines.push(desc, ``);

  lines.push(`📅 When: ${dateDisplay}`);
  lines.push(`📍 Where: ${location}${delivery ? ` (${delivery})` : ""}`);
  if (credits) lines.push(`🎓 Credits: ${credits}`);
  lines.push(`💰 Cost: ${cost}`);
  lines.push(``);

  if (event.seats_available !== undefined && event.seats_available !== null && event.seats_available < 50) {
    lines.push(`⚡ Limited seats — only ${event.seats_available} remaining!`);
    lines.push(``);
  }

  if (regUrl) {
    lines.push(`🔗 Register here: ${regUrl}`);
    lines.push(``);
  }

  lines.push(`Brought to you by Alaska CACHE: A Clearinghouse for Continuing Health Education`);
  lines.push(`University of Alaska Anchorage | Alaska Area Health Education Center`);
  lines.push(``);
  lines.push(hashtags.join(" "));

  return { message: lines.join("\n"), linkUrl: regUrl };
}

/**
 * Generate a Facebook Event object for the Facebook Events API.
 * @param {object} event
 * @returns {object|null} - null if event lacks required date info
 */
export function formatFacebookEvent(event) {
  if (!event.start_date) return null; // Facebook Events require a start time

  const desc = truncate(stripHtml(event.description), 2000);
  const hashtags = buildHashtags(event);

  return {
    name: truncate(event.title || "CACHE Training", 100),
    description: [
      desc,
      "",
      event.credits ? `CE Credits: ${event.credits}` : "",
      event.registration_url ? `Register: ${event.registration_url}` : "",
      "",
      "Alaska CACHE: A Clearinghouse for Continuing Health Education",
      "University of Alaska Anchorage | Alaska AHEC",
      "",
      hashtags.join(" "),
    ].filter(Boolean).join("\n"),
    start_time: `${event.start_date}T09:00:00`,
    end_time: event.end_date ? `${event.end_date}T17:00:00` : `${event.start_date}T17:00:00`,
    place: {
      name: event.location || "Online",
    },
    ticket_uri: event.registration_url || undefined,
  };
}
