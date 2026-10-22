#!/usr/bin/env node
/**
 * Curling's own step after seo.mjs (which is lqa-events' file, byte for byte):
 * seo.mjs gives every Event the site's one city as its address — right for a
 * town, wrong for a sport whose rows are in Duluth, Lohja and Medicine Hat.
 * This rewrites each Event's address from where the row says it is: the
 * clubs' own towns, else the place after the title's " — " ("Belfast, ME",
 * "Thunder Bay, Ontario", "Aberdeen"); a row with no place keeps a Place
 * with no address.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CLUBS = {
  'Granite Curling Club': { addressLocality: 'Seattle', addressRegion: 'WA', addressCountry: 'US' },
  'Evergreen Curling Club': { addressLocality: 'Beaverton', addressRegion: 'OR', addressCountry: 'US' },
};
const US = /^[A-Z]{2}$/;

export function placeOf(ev) {
  const club = CLUBS[ev.location?.name];
  if (club) return club;
  const m = / — ([^—]+)$/.exec(ev.name || '');
  if (!m) return null;
  const [town, region] = m[1].split(/,\s*/);
  if (region && US.test(region)) return { addressLocality: town, addressRegion: region, addressCountry: 'US' };
  return region ? { addressLocality: town, addressRegion: region } : { addressLocality: town };
}

export function fixLd(html) {
  return html.replace(/(<script type="application\/ld\+json" id="events-ld">)([\s\S]*?)(<\/script>)/, (all, open, body, close) => {
    const ld = JSON.parse(body.replace(/<\\\//g, '</'));
    for (const ev of ld['@graph'] || []) {
      if (ev['@type'] !== 'Event' || !ev.location) continue;
      const p = placeOf(ev);
      if (p) ev.location.address = { '@type': 'PostalAddress', ...p };
      else delete ev.location.address;
    }
    return open + JSON.stringify(ld).replace(/<\//g, '<\\/') + close;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = new URL('../site/index.html', import.meta.url);
  writeFileSync(file, fixLd(readFileSync(file, 'utf8')));
  console.log('seo-places: event addresses set from each row');
}
