#!/usr/bin/env node
/**
 * Aggregates upcoming curling into site/events.json and site/events.ics.
 * Runs in CI (see .github/workflows/events.yml) and locally for preview. The
 * pipeline is lqa-events' (scripts/*.mjs are its files, byte for byte); only
 * the sources below and site/city.js are curling's.
 *
 * Each source returns [{ venue, title, date, time, url, type }]. Seven
 * kinds of source, all public and keyless, read at build time:
 *   - USA Curling's Sport:80 event locator (national championships,
 *     playdowns, qualifiers and the bonspiels clubs list nationwide)
 *   - Granite Curling Club's bonspiel page and public ice calendar (Seattle)
 *   - the Grand Slam of Curling's season list (embedded in its events page)
 *   - World Curling's results database (the season's championships)
 *   - CurlingZone's tour schedule (Canada's bonspiels and provincials, the
 *     Brier and the Scotties, the World Curling Tour abroad)
 *   - the Grand National Curling Club's complete calendar (the Northeast's
 *     regional association: every GNCC-sanctioned bonspiel and playdown)
 *   - the clubs' own calendars — the 90-odd US clubs whose sites publish one
 *     the shared feeds.mjs can read (site/clubs.json `feeds`: Curling Club
 *     Manager, Curling I/O, Google Calendar, The Events Calendar, Eventbrite,
 *     Squarespace), plus the two regional calendars in city.js `feeds`
 * A multi-day event is written as one all-day row per day, so the days read
 * as one series ("2 of 4"). No Ticketmaster: curling isn't sold there.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { buildIcs } from './ics.mjs';
import { mergeWithArchive, unionArchives, eventKey } from './merge.mjs';
import { calmTitle, isNotice } from './titles.mjs';
import { applySchedules } from './schedules.mjs';
import { slugify, BADGE_FEEDS, TEAMS, CITY } from './badges.mjs';
import { emptyListGate, feedSources } from './feeds.mjs';
import { placeEvents } from './places.mjs';

const JSON_OUT = new URL('../site/events.json', import.meta.url);
const ICS_OUT = new URL('../site/events.ics', import.meta.url);
// A full year each way: championships are announced a season ahead, and past
// events are kept for a year (carried forward from the previously published
// feed — see mergeWithArchive).
const WINDOW_DAYS = 365;
// The live feed is read from the site's own domain (a build that reads
// neither copy of the archive refuses to publish — see mergeWithArchive;
// ALLOW_NO_ARCHIVE=1 lets the very first build through).
const FEED_URL = process.env.FEED_URL || 'https://curling.events/events.json';
// the second copy of the archive: every past event ever published, kept on
// the orphan `archive` branch by the workflow after each successful build
const ARCHIVE_URL = process.env.ARCHIVE_URL || 'https://raw.githubusercontent.com/sfosdal/curling-events/archive/events-archive.json';
const ARCHIVE_OUT = new URL('../events-archive.json', import.meta.url); // repo root, ignored; the workflow commits it to the branch
const MAX_EVENTS = 4000; // sanity cap, not a display cap

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MAX_DAYS = 14; // a "multi-day" event longer than this is a season or a series of classes, not an event

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const monthNo = (name) => MONTHS.indexOf(String(name).toLowerCase()) + 1;
// every day from start to end, inclusive (ISO dates)
function daysOf(start, end) {
  const out = [];
  const d = new Date(`${start}T12:00:00Z`), last = new Date(`${(end && end >= start) ? end : start}T12:00:00Z`);
  while (d <= last && out.length <= MAX_DAYS) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out.length > MAX_DAYS ? [] : out;
}
const perDay = (start, end, row) => daysOf(start, end).map((date) => ({ ...row, date, time: '' }));
const decode = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;|&#8217;/g, '’').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/\s+/g, ' ').trim();
async function get(url, label, init = {}) {
  const r = await fetch(url, { ...init, headers: { 'User-Agent': BROWSER_UA, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${label} HTTP ${r.status}`);
  return r;
}

const STATE_ABBR = { Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY' };
// a bonspiel's region row, by the state its club is in (city.js `states`)
const REGION_OF = {};
for (const [label, v] of Object.entries(CITY.venues)) for (const st of v.states || []) REGION_OF[st] = label;

// --- USA Curling: the Sport:80 event locator ---
// POST {} to the locator's data endpoint, 100 a page; its own filters are
// ignored, so every page is read and the upcoming ones kept by Status. Per
// event: `subtitle` "November 13th 2026 4:00 PM (CDT) - November 15th 2026
// 3:00 PM (CDT) - Superior, Wisconsin" (one date for a one-day event),
// `address` "…, City, State, United States of America, ZIP", `info` Type
// (Competition, Bonspiel, Event, Course) and Status, `actions` the entry
// list and the sign-up wizard (public; the event home page needs a login).
// Competitions are USA Curling's own (nationals, playdowns, qualifiers);
// bonspiels go to their club's row or their region's; courses (instructor,
// officials, coaching and ice-technician certification) are the Officials
// type, on their region's row (2026-10-22).
const S80 = 'https://usacurling.sport80.com/api/public/events/locator/data';
const GRANITE_ZIP = '98133', EVERGREEN_ZIP = '97005';
let graniteFromS80 = []; // Granite's bonspiels as USA Curling lists them — used only for dates its own page lacks
async function usaCurling() {
  const rows = [];
  for (let p = 0; p < 10; p++) {
    const r = await get(`${S80}?p=${p}&i=100`, 'USA Curling locator', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: '{}' });
    const d = await r.json();
    rows.push(...(d.data || []));
    if (!d.next_page_url || !(d.data || []).length) break;
  }
  const val = (x) => (x && typeof x === 'object' ? x.text : x);
  const out = [];
  let kept = 0;
  for (const e of rows) {
    const info = Object.fromEntries((e.info || []).map((i) => [i.title, val(i.value)]));
    if (info.Status !== 'Active') continue;
    const kind = info.Type;
    if (!/^(Competition|Bonspiel|Event|Course)$/.test(kind || '')) continue;
    if (/\bdemo\b/i.test(e.name || '')) continue; // the platform's sample listing
    const dates = [...String(e.subtitle || '').matchAll(/([A-Z][a-z]+) (\d{1,2})(?:st|nd|rd|th)? (\d{4})/g)].map((m) => iso(m[3], monthNo(m[1]), m[2]));
    if (!dates.length) continue;
    const start = dates[0], end = dates[1] || dates[0];
    if ((kind === 'Event' || kind === 'Course') && daysOf(start, end).length > 7) continue; // a season-long series (the junior education series, a months-long course)
    const parts = String(e.address || '').split(',').map((s) => s.trim());
    const zip = parts[parts.length - 1] || '', state = parts[parts.length - 3] || '', town = parts[parts.length - 4] || '';
    const where = town && STATE_ABBR[state] ? `${town}, ${STATE_ABBR[state]}` : (String(e.subtitle).split(' - ').pop() || '').trim();
    const link = (e.actions || []).map((a) => a.url).find(Boolean);
    const title = decode(e.name);
    let venue, url;
    if (kind === 'Competition') { venue = 'USA Curling Nationals'; url = link || CITY.venues[venue].url; }
    else if (zip === GRANITE_ZIP && kind !== 'Course') { graniteFromS80.push({ title, start, end, url: link }); continue; }
    else if (zip === GRANITE_ZIP) { venue = 'Granite Curling Club'; url = link || CITY.venues[venue].url; }
    else if (zip === EVERGREEN_ZIP) { venue = 'Evergreen Curling Club'; url = link || CITY.venues[venue].url; }
    else { venue = REGION_OF[state]; if (!venue) continue; url = link || CITY.venues[venue].url; }
    const local = venue === 'Evergreen Curling Club' || venue === 'Granite Curling Club';
    out.push(...perDay(start, end, { venue, title: local ? title : `${title} — ${where}`, url, type: kind === 'Course' ? 'officials' : kind === 'Event' ? 'community' : 'sports' }));
    kept++;
  }
  console.log(`USA Curling locator: ${rows.length} listings, ${kept} upcoming events kept (${out.length} rows), ${graniteFromS80.length} at Granite`);
  return out;
}

// --- Granite Curling Club (Seattle) ---
// Its bonspiel page is a table: "December 4-6, 2026" | | "The Nightmare
// Before Holiday Spiel" (a link to the event's page), the upcoming ones above
// the "Completed" heading. Ranges are "December 4-6, 2026", "February 27-28,
// 2027", one day "March 20, 2027" (and, across a month end, "January 30 -
// February 1, 2027").
const GRANITE = 'https://curlingseattle.org';
async function graniteBonspiels() {
  const h = await (await get(`${GRANITE}/bonspiels`, 'Granite bonspiels')).text();
  const upcoming = h.split(/<h3>\s*Completed\s*<\/h3>/i)[0];
  const out = [];
  let n = 0;
  for (const m of upcoming.matchAll(/<tr>\s*<td align="right">([^<]+)<\/td>\s*<td>[^<]*<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g)) {
    const when = decode(m[1]);
    const d = /^([A-Za-z]+)\s+(\d{1,2})(?:\s*-\s*(?:([A-Za-z]+)\s+)?(\d{1,2}))?,\s*(\d{4})$/.exec(when);
    if (!d) { console.error(`Granite bonspiels: unread date "${when}"`); continue; }
    const start = iso(d[5], monthNo(d[1]), d[2]);
    const end = d[4] ? iso(d[5], monthNo(d[3] || d[1]), d[4]) : start;
    const href = /href="([^"]+)"/.exec(m[2]);
    const canceled = /cancel+ed/i.test(m[2]);
    const title = decode(m[2].replace(/<a [^>]*>([\s\S]*?)<\/a>[\s\S]*$/, '$1')).replace(/\s*-\s*cancel+ed\s*$/i, '').replace(/^\d{4}\s+/, '');
    const url = href ? new URL(href[1].replace(/&amp;/g, '&'), GRANITE).href : `${GRANITE}/bonspiels`;
    const type = /camp|fun day|clinic/i.test(title) ? 'community' : 'sports';
    out.push(...perDay(start, end, { venue: 'Granite Curling Club', title, url, type, ...(canceled ? { status: 'cancelled' } : {}) }));
    n++;
  }
  console.log(`Granite bonspiels: ${n} upcoming (${out.length} rows)`);
  return out;
}
// Its public ice calendar (UTC clocks, one CATEGORIES each): the learn-to-
// curls, clinics, club nights and the PNWCA playdowns it lists; leagues,
// practice ice, maintenance, rentals, closures and meetings are not events
// for a visitor, and its bonspiels come from the page above.
const KEEP_CATS = new Set(['Learn To Curl', 'Other', 'Activities', 'Competitions']);
const DROP_TITLES = /vaccine|info session|orientation|volunteer|needs review/i; // "⚠ Web booking needs review" is the booking system's own flag (instructor trainings stay: the Officials type)
const localClock = (utc) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: CITY.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(utc).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};
async function graniteCalendar() {
  const t = (await (await get('https://calendar.curlingseattle.org/public/calendar.ics', 'Granite calendar')).text()).replace(/\r?\n[ \t]/g, '');
  const out = [];
  for (const block of t.split('BEGIN:VEVENT').slice(1)) {
    const f = (k) => { const m = new RegExp(`^${k}(?:;[^:\\n]*)?:(.*)$`, 'm').exec(block); return m ? m[1].trim() : ''; };
    const cat = f('CATEGORIES');
    if (!KEEP_CATS.has(cat) || /CANCELLED/i.test(f('STATUS'))) continue;
    let title = f('SUMMARY').replace(/\\([,;\\])/g, '$1').replace(/\s*·\s*\d+ sheets?\s*$/i, '').trim();
    if (!title || DROP_TITLES.test(title)) continue;
    let venue = 'Granite Curling Club';
    const at = /\s*@\s*(.+)$/.exec(title);
    if (at) { if (/evergreen/i.test(at[1])) venue = 'Evergreen Curling Club'; else if (!/granite|gcc/i.test(at[1])) continue; title = title.slice(0, at.index).trim(); }
    const type = cat === 'Competitions' ? 'sports' : cat === 'Learn To Curl' ? 'expo' : 'community';
    const url = venue === 'Granite Curling Club' ? 'https://calendar.curlingseattle.org/' : CITY.venues[venue].url;
    const s = f('DTSTART'), e = f('DTEND');
    if (/^\d{8}$/.test(s)) { // all day; DTEND is the day after
      const start = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
      const endX = /^\d{8}$/.test(e) ? new Date(Date.UTC(+e.slice(0, 4), +e.slice(4, 6) - 1, +e.slice(6, 8) - 1)).toISOString().slice(0, 10) : start;
      out.push(...perDay(start, endX, { venue, title, url, type }));
    } else {
      const m = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/.exec(s);
      if (!m) continue;
      const { date, time } = localClock(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])));
      out.push({ venue, title, date, time, url, type });
    }
  }
  console.log(`Granite calendar: ${out.length} rows`);
  return out;
}

// --- Grand Slam of Curling ---
// Its events page carries the season list as URL-encoded JSON: per Slam
// series_name, season ("2026/27"), the start and end dates (MM/DD/YYYY) and
// the host city. Each Slam's own page is /events/<slug>-<series id>.
const GSOC = 'https://www.thegrandslamofcurling.com';
// the host's province written out ("Thunder Bay, ON" would read as two
// shouted words to calmTitle and come down to "Gsoc Open — Thunder Bay, On")
const PROVINCES = { AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland', NS: 'Nova Scotia', ON: 'Ontario', PE: 'PEI', QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon', NT: 'Northwest Territories' };
const placeOut = (city) => city.replace(/,\s*([A-Z]{2})$/, (m, p) => (PROVINCES[p] ? `, ${PROVINCES[p]}` : m));
async function grandSlam() {
  const h = decodeURIComponent((await (await get(`${GSOC}/events`, 'Grand Slam')).text()).replace(/%(?![0-9A-Fa-f]{2})/g, '%25'));
  const out = [], seen = new Set();
  const re = /\{"series_id":(\d+),"series_name":"([^"]+)","season":"([^"]+)","league_type_id":\d+,"league_type_name":"([^"]+)","tour_id":"([^"]+)","start_date":"([^"]+)","end_date":"([^"]+)".*?"city":"([^"]*)"/g;
  const mdY = (s) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); return m ? iso(m[3], m[1], m[2]) : ''; };
  for (const m of h.matchAll(re)) {
    const [, id, name, , , , s, e, city] = m;
    const start = mdY(s), end = mdY(e);
    if (!start || seen.has(name + start)) continue;
    seen.add(name + start);
    const slug = name.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    out.push(...perDay(start, end, { venue: 'Grand Slam of Curling', title: city ? `${name} — ${placeOut(city)}` : name, url: `${GSOC}/events/${slug}-${id}`, type: 'sports' }));
  }
  console.log(`Grand Slam: ${seen.size} Slams (${out.length} rows)`);
  return out;
}

// --- World Curling: the results database's season list ---
// /Championship/Year/<year> is a paged table (?grid-page=2): season, name,
// location (upper case, or "TBA (No country selected yet)"), start and end
// (M/D/YYYY), disciplines. This season's year and the next are read.
const WCF = 'https://results.worldcurling.org';
const smallWords = new Set(['of', 'the', 'and', 'de', 'la']);
const titleCase = (s) => s.toLowerCase().split(/(\s+|-)/).map((w, i) => (i && smallWords.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join('');
async function worldCurling() {
  const y = new Date().getUTCFullYear();
  const out = [], seen = new Set();
  for (const year of [y, y + 1]) {
    for (let page = 1; page <= 4; page++) {
      let h;
      try { h = await (await get(`${WCF}/Championship/Year/${year}${page > 1 ? `?id=${year}&grid-page=${page}` : ''}`, `World Curling ${year} p${page}`)).text(); }
      catch (err) { console.error(err.message); break; }
      let rowsOnPage = 0;
      for (const tr of h.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
        const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => decode(c[1]));
        if (cells.length < 6) continue;
        rowsOnPage++;
        const [, name, loc, , s, e] = cells;
        const md = (x) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(x); return m ? iso(m[3], m[1], m[2]) : ''; };
        const start = md(s), end = md(e);
        if (!start || seen.has(name)) continue;
        seen.add(name);
        const place = /^TBA/i.test(loc) || !loc ? '' : titleCase(loc);
        const href = /href="(\/Championship\/Details\/\d+)"/.exec(tr[1]);
        out.push(...perDay(start, end, { venue: 'World Curling', title: place ? `${name} — ${place}` : name, url: href ? WCF + href[1] : `${WCF}/Championship/Year/${year}`, type: 'sports' }));
      }
      if (!rowsOnPage || !new RegExp(`grid-page=${page + 1}`).test(h)) break;
    }
  }
  console.log(`World Curling: ${seen.size} championships (${out.length} rows)`);
  return out;
}

// --- CurlingZone: the tour's season schedule ---
// schedule.php?eventyear=<season's end year>&et=<category> is one table per
// category (81 men, 82 women, 83/84 junior men/women, 85 mixed doubles, 86/87
// wheelchair): the event (a link to event.php?eventid=N), its town ("Winnipeg,
// MB", "Aberdeen, SCO", "Fargo, ND") and, on the next row, its dates with no
// year ("Oct 9 - 12", "Oct 30 - Nov 1", "Dec 11"). A season runs May to
// April, so May–December are the first year. The same event sits under each
// category it is open to (one id per category), so events fold by name and
// start. Canadian events go to the Canada row, American ones to their
// region's, the rest to the World Tour; the Slams and the world and European
// championships are left to their own rows' sources.
const CZ = 'https://www.curlingzone.com';
const CZ_CATEGORIES = [81, 82, 83, 84, 85, 86, 87];
const CZ_COUNTRIES = { NZL: 'New Zealand', JPN: 'Japan', SUI: 'Switzerland', SCO: 'Scotland', SWE: 'Sweden', POL: 'Poland', EST: 'Estonia', FIN: 'Finland', NOR: 'Norway', KOR: 'Korea', CZE: 'Czechia', ITA: 'Italy', DEN: 'Denmark', GER: 'Germany', AUS: 'Australia', ENG: 'England', WAL: 'Wales', IRL: 'Ireland', NED: 'Netherlands', AUT: 'Austria', LAT: 'Latvia', CHN: 'China' };
const CZ_PROVINCES = { ...PROVINCES, PEI: 'PEI', NO: 'Northern Ontario', NU: 'Nunavut' };
const STATE_NAME = Object.fromEntries(Object.entries(STATE_ABBR).map(([name, ab]) => [ab, name]));
const CZ_SKIP = /^GSOC\b|grand slam|USA Curling National|\b(world|european)\b.*\b(championship|qualif)/i;
const czMonth = (m) => ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m.toLowerCase().slice(0, 3)) + 1;
async function curlingZone() {
  const now = new Date();
  const season = now.getUTCMonth() >= 4 ? now.getUTCFullYear() + 1 : now.getUTCFullYear(); // eventyear: the season's end year
  const label = `${season - 1}-${String(season).slice(2)}`; // "2026-27", as the page heads its table
  const yearOf = (m) => (m >= 5 ? season - 1 : season);
  const out = [], seen = new Set();
  for (const et of CZ_CATEGORIES) {
    let h;
    try { h = new TextDecoder('latin1').decode(await (await get(`${CZ}/schedule.php?eventyear=${season}&et=${et}`, `CurlingZone ${et}`)).arrayBuffer()); }
    catch (err) { console.error(err.message); continue; }
    if (!h.includes(`${label} `)) { console.error(`CurlingZone ${et}: no ${label} schedule`); continue; } // a season not yet published, shown as another's
    for (const m of h.matchAll(/HREF='event\.php\?view=Main&eventid=(\d+)'>([^<]+)<\/a><\/td>\s*<td class=schedulecity[^>]*>([^<]*)<\/td>[\s\S]*?<td class=scheduledate[^>]*>([^<]+)<\/td>/gi)) {
      const [, id, rawName, rawTown, when] = m;
      const name = decode(rawName).replace(/\s*[-–]?\s*(?:proudly\s+)?(?:presented|sponsored) by\b.*$/i, '').trim();
      if (!name || CZ_SKIP.test(name)) continue;
      const d = /^([A-Za-z]{3})[a-z]*\s+(\d{1,2})(?:\s*-\s*(?:([A-Za-z]{3})[a-z]*\s+)?(\d{1,2}))?$/.exec(decode(when));
      if (!d) { console.error(`CurlingZone: unread date "${decode(when)}"`); continue; }
      const m1 = czMonth(d[1]), m2 = d[3] ? czMonth(d[3]) : m1;
      const start = iso(yearOf(m1), m1, d[2]);
      const end = d[4] ? iso(yearOf(m2), m2, d[4]) : start;
      if (seen.has(name.toLowerCase() + start)) continue;
      seen.add(name.toLowerCase() + start);
      const [town, code] = decode(rawTown).split(/,\s*/).map((s) => (s || '').trim());
      let venue, where;
      if (CZ_PROVINCES[code]) { venue = 'Canada'; where = town ? `${town}, ${CZ_PROVINCES[code]}` : CZ_PROVINCES[code]; }
      else if (STATE_NAME[code]) { venue = REGION_OF[STATE_NAME[code]]; where = `${town}, ${code}`; if (!venue) continue; }
      else { venue = 'World Tour'; where = [town, CZ_COUNTRIES[code] || code].filter(Boolean).join(', '); }
      out.push(...perDay(start, end, { venue, title: where ? `${name} — ${where}` : name, url: `${CZ}/event.php?view=Main&eventid=${id}`, type: 'sports' }));
    }
  }
  console.log(`CurlingZone: ${seen.size} events (${out.length} rows)`);
  return out;
}

// Granite's bonspiels that USA Curling lists but its own page doesn't (by start date)
async function graniteExtra(have) {
  const starts = new Set(have.filter((e) => e.venue === 'Granite Curling Club').map((e) => e.date));
  const out = [];
  for (const b of graniteFromS80) if (!starts.has(b.start)) out.push(...perDay(b.start, b.end, { venue: 'Granite Curling Club', title: b.title, url: b.url || CITY.venues['Granite Curling Club'].url, type: 'sports' }));
  if (out.length) console.log(`Granite via USA Curling: ${out.length} rows its own page lacks`);
  return out;
}

// --- The Grand National Curling Club: the Northeast's regional calendar ---
// Its complete calendar is one table: Begin Date ("Friday, 23-Oct-2026"), End
// Date, Type (the discipline — Open, Mens, Womens, Mixed, Mixed Doubles,
// Juniors, College, Wheelchair), Name, Location (the host club) and a Status
// image. Its ICS export answers 500. The host club's town comes from the
// club list; the row is the club's region (GNCC reaches into the South).
const GNCC = 'https://gncc.org/index.php/calendars/calendar/complete-calendar';
const CLUBS = JSON.parse(readFileSync(new URL('../site/clubs.json', import.meta.url), 'utf8')).clubs;
const clubKey = (s) => String(s || '').toLowerCase().replace(/\b(the|curling|club|association|assoc|inc)\b|[^a-z0-9]/g, '');
const CLUB_BY_KEY = new Map(CLUBS.map((c) => [clubKey(c.name), c]));
const clubRow = (c) => (CITY.venues[c.name] ? c.name : REGION_OF[STATE_NAME[c.state]]);
async function gncc() {
  const h = await (await get(GNCC, 'GNCC calendar')).text();
  const out = [];
  let n = 0;
  for (const tr of h.matchAll(/<tr class="tabrow\s*">([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (cells.length < 5) continue;
    const [b, e, disc, rawName, rawWhere] = cells.map(decode);
    if (/cancel/i.test(cells[5] || '')) continue;
    const dmy = (x) => { const m = /(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(x); return m ? iso(m[3], czMonth(m[2]), m[1]) : ''; };
    const start = dmy(b), end = dmy(e) || start;
    if (!start || !rawName) continue;
    const club = CLUB_BY_KEY.get(clubKey(rawWhere));
    const venue = (club && clubRow(club)) || 'Northeast';
    const where = club ? `${club.town}, ${club.state}` : rawWhere;
    const name = disc && !new RegExp(disc.replace(/s$/, ''), 'i').test(rawName) && !/open/i.test(disc) ? `${rawName} (${disc})` : rawName; // the discipline, when the name leaves it out
    out.push(...perDay(start, end, { venue, title: `${name} — ${where}`, url: GNCC, type: 'sports' }));
    n++;
  }
  console.log(`GNCC calendar: ${n} events (${out.length} rows)`);
  return out;
}

// --- The clubs' own calendars ---
// site/clubs.json carries, per club, the feeds its website publishes
// (clubs/feeds.py, from the 2026-10-22 sweep of every US club site): Curling
// Club Manager's upcoming-events view, a Curling I/O portal, a public Google
// Calendar, The Events Calendar's REST API, Eventbrite links, a Squarespace
// collection. Each is read by the shared feeds.mjs on the club's own clock and
// pinned to the club's row (Granite, Evergreen) or its region's, where the
// title ends in the club's town. A club calendar lists everything — leagues,
// practice ice, board meetings, rentals, closures — so only titles that name a
// public event are kept: bonspiels and playdowns, learn-to-curls and open
// houses, clinics and camps, courses. The regional calendars in city.js
// `feeds` (Dakota Territory's Google Calendar, Midwest's Events Calendar) are
// read the same way without the town suffix.
const STATE_TZ = { AK: 'America/Anchorage', HI: 'Pacific/Honolulu', AZ: 'America/Phoenix', CA: 'America/Los_Angeles', NV: 'America/Los_Angeles', OR: 'America/Los_Angeles', WA: 'America/Los_Angeles',
  CO: 'America/Denver', ID: 'America/Denver', MT: 'America/Denver', NM: 'America/Denver', UT: 'America/Denver', WY: 'America/Denver',
  AL: 'America/Chicago', AR: 'America/Chicago', IL: 'America/Chicago', IA: 'America/Chicago', KS: 'America/Chicago', LA: 'America/Chicago', MN: 'America/Chicago', MS: 'America/Chicago', MO: 'America/Chicago', NE: 'America/Chicago', ND: 'America/Chicago', OK: 'America/Chicago', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago', WI: 'America/Chicago' };
const CLUB_KEEP = /spiel|learn[- ]to[- ]curl|\bltc\b|curling (?:101|school|class|lesson)|open house|try curling|try it|intro(?:duction)? to curling|discover curling|clinic|\bcamp\b|playdown|championship|qualif|friendly|invitational|classic\b|tournament|\bcup\b|officials? (?:course|training|clinic|certif)|instructor|umpire|ice tech|coach(?:ing|es)? (?:course|clinic|certif|level)|certification|rookie|novice|new curler|beginner|first[- ]timer|wheelchair|stick curling|doubles|open curling|drop[- ]in|pick[- ]?up|mixer|skills/i;
const CLUB_DROP = /private|rental|meeting|volunteer|no curling|no league|closed|closure|maintenance|ice (?:out|in|melting|removal|install)|tentative|\bhold\b|practice ice|set ?up|clean|membership|dues|locker|grand slam|\bgsoc\b|league (?:night|week|game|final|playoff|standings)|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday) (?:night|morning|afternoon)? ?league\b|finals? (?:tuesday|wednesday|thursday|brunch|league)|^(?:mens?|men's|women'?s|open|mixed|juniors?|social|competitive)$|\bbusy\b/i;
// a course, not an event that merely mentions a role ("Ice Tech Bonspiel", "League Official Start")
const OFFICIALS = /(?:officials?|instructor|umpire|ice tech(?:nician)?|coach(?:ing|es)?)\b[^—]*\b(?:course|training|clinic|certif\w*|assessment|level \d)|level \d (?:officials?|instructor|coach|ice tech)|certification|\bumpir(?:e|ing) (?:course|training|clinic)/i;
const clubType = (title) => (OFFICIALS.test(title) ? 'officials' : LEARN_TO_CURL.test(title) ? 'expo' : /spiel|playdown|championship|qualif|tournament|invitational|classic\b|\bcup\b|friendly|doubles/i.test(title) ? 'sports' : 'community');
// the date a club writes into the title is the row's own: "Learn to Curl - 01/02/27, 2pm", "… - Sunday,
// November 29, 2026", "… — Sat Oct 24", "Sat 10-31-26 Learn to Curl", "… (Copy)"
const DAY = String.raw`(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?(?:\d{1,2}[-\/]\d{1,2}(?:[-\/]\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{4}-\d{2}-\d{2})(?:\s*[-–,@]?\s*\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)?`;
const TRAILING_DAY = new RegExp(String.raw`\s*(?:[-–—:]|\bon|@)?\s*[(\[]?${DAY}[)\]]?\s*(?:\([^)]*\))?\s*$`, 'i'), LEADING_DAY = new RegExp(String.raw`^${DAY}\s*[-–—:]?\s+`, 'i');
const clubTitle = (title) => title.replace(/\bLTC\b/g, 'Learn to Curl').replace(/\s*\(copy\)\s*/gi, ' ').replace(TRAILING_DAY, '').replace(LEADING_DAY, '').replace(/\s*[-–—:]\s*$/, '').trim() || title.trim();
const readFeed = (thunk, { label = 'feed', suffix = '', keep = true, fallbackUrl = '' }) => async () => {
  let rows;
  try { rows = await thunk(); } catch (err) { console.error(`${label}: ${err.message}`); return []; }
  return rows.filter((e) => !CLUB_DROP.test(e.title) && (!keep || CLUB_KEEP.test(e.title)))
    .map((e) => { const title = clubTitle(e.title); return { ...e, title: suffix ? `${title} — ${suffix}` : title, type: clubType(title), url: e.url || fallbackUrl }; });
};
// a pool: the club calendars are a hundred small fetches — six at a time, as one source
const pooled = (name, thunks, width = 6) => ({ [name]: async () => {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(width, thunks.length) }, async () => { while (i < thunks.length) { const t = thunks[i++]; try { out.push(...await t()); } catch (err) { console.error(`${name}: ${err.message}`); } } }));
  console.log(`${name}: ${out.length} rows from ${thunks.length} calendars`);
  return out;
} }[name]);
const clubThunks = [];
for (const c of CLUBS) {
  const venue = clubRow(c);
  if (!c.feeds || !venue) continue;
  for (const f of c.feeds) {
    const [thunk] = feedSources({ venues: CITY.venues, feeds: [{ ...f, label: c.name, venue }], types: CITY.types, tz: STATE_TZ[c.state] || 'America/New_York' }, BROWSER_UA);
    clubThunks.push(readFeed(thunk, { label: c.name, suffix: CITY.venues[c.name] ? '' : `${c.town}, ${c.state}`, fallbackUrl: c.url }));
  }
}
const clubCalendars = pooled('Club calendars', clubThunks);
const regionalCalendars = pooled('Regional calendars', feedSources(CITY, BROWSER_UA).map((t, i) => readFeed(t, { label: CITY.feeds[i].label, keep: false })), 2);

const LEARN_TO_CURL = /learn[- ]?(?:to|2)[- ]?curl|try curling|curling 101|intro(?:duction)? to curling|open house|beginner|discover curling|curling (?:school|class(?:es)?|lessons?)\b|new curler|first[- ]timer/i; // not "Curling Classic"
const sources = [usaCurling, graniteBonspiels, graniteCalendar, grandSlam, worldCurling, curlingZone, gncc, regionalCalendars, clubCalendars];

// Venue names as city.js spells them: a venue listed under other spellings
// (`alias` — "Bakkt Theater", "Dollar Loan Center", "The Joint")
// folds to its one name; `groundsVenue`, when a city sets one, takes the
// rooms city.js doesn't list.
const CANONICAL_VENUES = new Set(Object.keys(CITY.venues));
const ALIASES = Object.entries(CITY.venues).filter(([, v]) => v.alias).map(([label, v]) => [label, v.alias]);
const aliasHit = (s) => { const hit = ALIASES.find(([, re]) => re.test(s || '')); return hit ? hit[0] : null; };
const aliasVenue = (name) => aliasHit(name) || name;
// A listing whose venue field is just the city names its room at the end of
// the title ("X live at The Vic").
const roomInTitle = (title) => { const m = /\b(?:at|@)\s+(.+)$/i.exec(title || ''); return m ? aliasHit(m[1]) : null; };
const normalizeVenue = (e) => {
  const byName = aliasVenue(e.venue);
  const venue = CANONICAL_VENUES.has(byName) ? byName : (roomInTitle(e.title) || byName);
  if (CITY.groundsVenue && !CANONICAL_VENUES.has(venue)) return { ...e, venue: CITY.groundsVenue };
  return venue === e.venue ? e : { ...e, venue };
};

let all = [];
for (const src of sources) {
  try { all = all.concat((await src()).map(normalizeVenue)); }
  catch (err) { console.error(`Source failed (${src.name}):`, err.message); }
}
all = all.concat(await graniteExtra(all));

// window, de-dupe, sort
// calmTitle on the title alone: the " — Town, ST" place after it keeps its state code (MI is a
// Spanish small word to calmTitle), and the sport's acronyms stay shouted.
const ACRONYMS = { gncc: 'GNCC', gmcc: 'GMCC', fmcc: 'FMCC', dtca: 'DTCA', usac: 'USAC', uswca: 'USWCA', wct: 'WCT', mopac: 'MoPac', pnwca: 'PNWCA', glca: 'GLCA', wsca: 'WSCA', gsoc: 'GSOC', itc: 'ITC', bccc: 'BCCC', dcc: 'DCC', gcc: 'GCC', wc3: 'WC3', mdcc: 'MDCC', ncc: 'NCC', scc: 'SCC', lccc: 'LCCC' };
const ACRONYM_RE = new RegExp(`\\b(${Object.keys(ACRONYMS).join('|')})\\b`, 'gi');
const calmPlace = (title) => {
  const i = title.lastIndexOf(' — ');
  const head = i > 0 ? title.slice(0, i) : title, place = i > 0 ? title.slice(i) : '';
  return calmTitle(head).replace(ACRONYM_RE, (m) => ACRONYMS[m.toLowerCase()]) + place;
};
const today = new Date().toISOString().slice(0, 10);
const horizon = new Date(Date.now() + WINDOW_DAYS * 86400e3).toISOString().slice(0, 10);
const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400e3).toISOString().slice(0, 10);
const seen = new Set();
const fresh = all
  .filter((e) => e.date && e.date >= cutoff && e.date <= horizon)
  .filter((e) => !isNotice(e.title)) // a closure or construction notice is information, not an event
  .map((e) => ({ ...e, title: calmPlace(e.title) })) // shouted titles come down to Title Case — the place after the dash and curling's acronyms kept
  .map((e) => (LEARN_TO_CURL.test(e.title) ? { ...e, type: 'expo' } : e)) // city.js's "Learn to Curl" type (the shared key 'expo'), whatever the source called it
  .map((e) => (OFFICIALS.test(e.title) ? { ...e, type: 'officials' } : e)) // the Officials type: officiating, instructor, coaching and ice-technician courses
  .filter((e) => { const k = eventKey(e); if (seen.has(k)) return false; seen.add(k); return true; }); // venue|title|date|clock (merge.mjs): a second showing on one day is kept

// the empty-list gate (feeds.mjs): nothing upcoming in this build's own pull means a room was
// missed in scouting or every source is down — not a fact about the town. ALLOW_EMPTY_LIST=1 overrides.
if (!emptyListGate(fresh, today, sources.length)) process.exit(1);

// carry past events forward. Two copies of the archive: the live feed and
// the `archive` branch's file (every past event ever published; the workflow
// rewrites it after each build). Each is fetched with three tries; the build
// goes on with the union of whatever it got and stops only when it got
// neither. Since the union can only grow, a publish that lost history can no
// longer shrink the record.
const cleanArchive = (d) => (Array.isArray(d) ? d : (d.events || []))
  .map(normalizeVenue) // past events published under other spellings fold onto the one name
  .filter((e) => !isNotice(e.title)).map((e) => ({ ...e, title: calmTitle(e.title) })); // the same title hygiene as fresh events, so the merge keys agree
async function fetchArchive(url, what) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return cleanArchive(await r.json());
    } catch (err) {
      console.error(`${what} fetch (try ${attempt} of 3) failed: ${err.message}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 20000));
    }
  }
  return null;
}
const [liveArchive, branchArchive] = await Promise.all([
  fetchArchive(FEED_URL, 'Live feed'),
  fetchArchive(ARCHIVE_URL, 'Archive branch'),
]);
if (liveArchive === null && branchArchive === null && !process.env.ALLOW_NO_ARCHIVE) {
  console.error('No archive from either copy — not publishing (ALLOW_NO_ARCHIVE=1 to override for a first build)');
  process.exit(1);
}
if (liveArchive === null) console.error('Live feed unreadable — building on the archive branch copy');
if (branchArchive === null) console.error('Archive branch unreadable — building on the live feed alone');
const archived = unionArchives(liveArchive || [], branchArchive || []);
console.log(`Archive: ${(liveArchive || []).length} events in the live feed, ${(branchArchive || []).length} on the archive branch, ${archived.length} in the union`);

const merged = mergeWithArchive(fresh, archived, today, cutoff).slice(-MAX_EVENTS);

// No clubs (city.js teams is empty): the schedules step writes nothing
let seasons = {}, form = {};
if (CITY.teams.length) { try { ({ teams: seasons, form } = await applySchedules(merged)); } catch (err) { console.error('Schedules step failed:', err.message); } }
merged.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
if (Object.keys(seasons).length) {
  const postseason = JSON.parse(readFileSync(new URL('./data/postseason.json', import.meta.url), 'utf8')); // each league's playoff rounds (hand-kept), shown until the real games land
  delete postseason._;
  writeFileSync(new URL('../site/teams.json', import.meta.url), JSON.stringify({ generated: new Date().toISOString(), teams: seasons, form, postseason }, null, 1) + '\n');
}

// the Map view: each event's place and spot (scripts/places.mjs, from the committed gazetteer)
const unplaced = placeEvents(merged, CITY.venues);
console.log(`places: ${merged.filter((e) => e.geo).length} of ${merged.length} events pinned` + (unplaced.size ? `; not in the gazetteer: ${[...unplaced].map(([p, n]) => `${p} (${n})`).join(', ')}` : ''));
writeFileSync(JSON_OUT, JSON.stringify({ generated: new Date().toISOString(), events: merged }, null, 2) + '\n');
// the archive record: this build's past events on top of everything already
// recorded, never pruned (the feed keeps a year; the branch keeps it all)
const record = unionArchives(merged.filter((e) => e.date < today), archived.filter((e) => e.date < today));
writeFileSync(ARCHIVE_OUT, JSON.stringify({ events: record }, null, 1) + '\n'); // no timestamp: the branch commits only when the events change
console.log(`Archive record: ${record.length} past events`);
writeFileSync(ICS_OUT, buildIcs(merged));

// Filtered subscribe feeds, one per venue and one per badge, so the site's
// filter chips can offer a matching calendar subscription.
const siteDir = new URL('../site/', import.meta.url);
let nFeeds = 0;
for (const venue of new Set(merged.map((e) => e.venue))) {
  const evs = merged.filter((e) => e.venue === venue);
  writeFileSync(new URL(`events-venue-${slugify(venue)}.ics`, siteDir),
    buildIcs(evs, new Date(), { calname: `${CITY.ics.short} — ${venue}` }));
  nFeeds++;
}
for (const [slug, [label, pred]] of Object.entries(BADGE_FEEDS)) {
  writeFileSync(new URL(`events-${slug}.ics`, siteDir),
    buildIcs(merged.filter(pred), new Date(), { calname: `${CITY.ics.short} — ${label}` }));
  nFeeds++;
}
// Exclusion feeds, one per local team: everything except that team's games.
for (const t of TEAMS) {
  writeFileSync(new URL(`events-no-${t.slug}.ics`, siteDir),
    buildIcs(merged.filter((e) => !t.re.test(e.title || '')), new Date(), { calname: `${CITY.ics.short} — no ${t.label}` }));
  nFeeds++;
}
// Season feeds for the Teams view: each club's whole season, home and away
// (team-<slug>.ics), and every club's in one (teams.ics). Each game links to
// the club's page on the site.
const seasonEvents = (slug, label, games) => games.map((g) => ({
  title: `${label} ${g.home ? 'vs' : 'at'} ${g.opp.name}${g.pre ? ' (preseason)' : g.playoff ? ' (playoff)' : ''}`,
  venue: g.venue || (g.home ? '' : g.opp.name), date: g.date, time: g.tbd ? null : g.time, ...(g.tbd ? { dateTbd: true } : {}),
  url: `${CITY.site}?team=${slug}`,
}));
const allSeasons = [];
for (const t of TEAMS) {
  if (!seasons[t.slug]) continue;
  const evs = seasonEvents(t.slug, t.label, seasons[t.slug]);
  allSeasons.push(...evs);
  writeFileSync(new URL(`team-${t.slug}.ics`, siteDir), buildIcs(evs, new Date(), { calname: `${t.label} season` }));
  nFeeds++;
}
writeFileSync(new URL('teams.ics', siteDir), buildIcs(allSeasons, new Date(), { calname: CITY.ics.teams }));
nFeeds++;

const nPast = merged.filter((e) => e.date < today).length;
console.log(`Wrote ${merged.length} events (${nPast} past, ${merged.length - nPast} upcoming) + ${nFeeds} filtered feeds`);
