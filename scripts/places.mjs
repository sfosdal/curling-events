// Where each event is — for the Map view (Steve, 2026-10-24: "curling.events
// should have the map"). Curling's rows are circuits and regions, not rooms, so
// the pins are the PLACES the events name: the "— Town, State" tail every
// championship and bonspiel title carries (fetch-events.mjs writes it), and
// the two clubs' own spots for their rows. A place is looked up in the
// gazetteer scripts/data/places.json (committed), so the daily build reads
// nothing off-site; the gazetteer is filled once, by hand, from OpenStreetMap's
// Nominatim (ODbL — the page credits OSM):
//
//   node scripts/places.mjs            lists the places the gazetteer lacks
//   node scripts/places.mjs --geocode  looks the missing ones up (one a second,
//                                      per Nominatim's policy) and writes them
//
// An event whose place is unknown keeps its row and its list entry; it simply
// has no pin until the gazetteer learns the town.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const GAZ = new URL('./data/places.json', import.meta.url);
export const readGazetteer = () => { try { return JSON.parse(readFileSync(GAZ, 'utf8')); } catch { return {}; } };

// the title's tail: "Rice Lake Superspiel — Rice Lake, WI" → "Rice Lake, WI"
export function placeOf(title) {
  const m = / — ([^—]+?)\s*$/.exec(title || '');
  if (!m) return null;
  const p = m[1].trim();
  if (!p || /^(TBA|TBD|Online|Virtual)$/i.test(p) || /^Region \d/i.test(p)) return null;
  if (/^(Northern )?(Ontario|Quebec|Alberta|British Columbia|Manitoba|Saskatchewan|Nova Scotia|New Brunswick|Newfoundland|PEI|Canada|USA)$/i.test(p)) return null; // a province alone is a region, not a spot
  return p;
}
// the short name a pin is labelled with: the town before the comma
export const shortPlace = (p) => p.split(',')[0].trim();

// what Nominatim is asked: the title's own spelling, with the abbreviations it does not know written out
const PROVINCE = { PEI: 'Prince Edward Island', 'Northern Ontario': 'Ontario', NL: 'Newfoundland and Labrador' };
export function queryOf(place) {
  return place.split(',').map((s, i) => (i ? PROVINCE[s.trim()] || s.trim() : s.trim())).join(', ');
}

// adds place + geo to each event (in place) and returns what could not be placed
export function placeEvents(events, venues, gazetteer = readGazetteer()) {
  const missing = new Map();
  for (const e of events) {
    const room = venues[e.venue];
    let place = placeOf(e.title);
    if (!place && room && room.geo) { e.place = room.town || e.venue; e.geo = room.geo; continue; } // a club's own row: its spot
    if (!place) continue;
    const g = gazetteer[place];
    if (g) { e.place = place; e.geo = g; } else missing.set(place, (missing.get(place) || 0) + 1);
  }
  return missing;
}

// ---- the command line ----
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  globalThis.window = globalThis; createRequire(import.meta.url)('../site/city.js');
  const CITY = globalThis.LQACity;
  const events = JSON.parse(readFileSync(new URL('../site/events.json', import.meta.url), 'utf8')).events;
  const gaz = readGazetteer();
  const missing = placeEvents(events, CITY.venues, gaz);
  const placed = events.filter((e) => e.geo).length;
  console.log(`${placed} of ${events.length} events placed; ${missing.size} place(s) not in the gazetteer`);
  if (!process.argv.includes('--geocode')) { for (const [p, n] of [...missing].sort((a, b) => b[1] - a[1])) console.log(`  ${p} (${n})`); process.exit(0); }
  const UA = 'curling.events gazetteer build (one-time, by hand; steve@fosdal.net)';
  let found = 0;
  for (const [place] of missing) {
    const q = queryOf(place);
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(q), { headers: { 'User-Agent': UA } });
    const hits = r.ok ? await r.json() : [];
    if (hits.length) { gaz[place] = [+(+hits[0].lat).toFixed(4), +(+hits[0].lon).toFixed(4)]; found++; console.log(`  ${place} → ${gaz[place]}  (${hits[0].display_name.slice(0, 70)})`); }
    else console.log(`  ${place}: nothing found (asked "${q}")`);
    await new Promise((res) => setTimeout(res, 1100));
  }
  const sorted = Object.fromEntries(Object.keys(gaz).sort().map((k) => [k, gaz[k]]));
  writeFileSync(GAZ, JSON.stringify(sorted, null, 0).replace(/\],"/g, '],\n"').replace('{', '{\n').replace(/\}$/, '\n}') + '\n');
  console.log(`gazetteer: ${Object.keys(sorted).length} places (${found} new)`);
}
