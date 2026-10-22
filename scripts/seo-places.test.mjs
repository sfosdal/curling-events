import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeOf, fixLd } from './seo-places.mjs';

test('an Event takes its address from the club, else the place after the title dash', () => {
  assert.deepEqual(placeOf({ name: 'April Spiel', location: { name: 'Granite Curling Club' } }), { addressLocality: 'Seattle', addressRegion: 'WA', addressCountry: 'US' });
  assert.deepEqual(placeOf({ name: 'Maine-iac — Belfast, ME', location: { name: 'Northeast' } }), { addressLocality: 'Belfast', addressRegion: 'ME', addressCountry: 'US' });
  assert.deepEqual(placeOf({ name: 'GSOC Open — Thunder Bay, Ontario', location: { name: 'Grand Slam of Curling' } }), { addressLocality: 'Thunder Bay', addressRegion: 'Ontario' });
  assert.deepEqual(placeOf({ name: 'World Junior Curling Championships 2027 — Aberdeen', location: { name: 'World Curling' } }), { addressLocality: 'Aberdeen' });
  assert.equal(placeOf({ name: 'World Senior Curling Championships 2027', location: { name: 'World Curling' } }), null);
});

test('the ld+json block is rewritten in place', () => {
  const ld = { '@graph': [{ '@type': 'WebSite' }, { '@type': 'Event', name: 'Holly Hog — Appleton, WI', location: { '@type': 'Place', name: 'Midwest', address: { addressLocality: 'Curling' } } }, { '@type': 'Event', name: 'TBA Worlds', location: { '@type': 'Place', name: 'World Curling', address: { addressLocality: 'Curling' } } }] };
  const html = `<body><script type="application/ld+json" id="events-ld">${JSON.stringify(ld)}</script>\n</body>`;
  const out = JSON.parse(/id="events-ld">([\s\S]*?)<\/script>/.exec(fixLd(html))[1]);
  assert.equal(out['@graph'][1].location.address.addressLocality, 'Appleton');
  assert.equal(out['@graph'][2].location.address, undefined);
});
