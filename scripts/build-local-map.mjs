// Writes site/local-map.json — the ground the Map view (site/local-map.js) is
// drawn on, from the `map` block in site/city.js — for every room there that
// carries geo: [lat, lon]. Two kinds of ground:
//
//   kind: 'island' — the island's outline (and faint neighbours) from Natural
//     Earth 1:10m admin-0 countries (public domain), picked by a seed point
//     inside each ring; the frame is the island with a margin. Kona.
//   kind: 'urban'  — a city or a neighbourhood: the shoreline, the named
//     lakes and rivers and the main roads inside `bbox` (widened to `aspect`,
//     1.6:1, when it is taller than that) from OpenStreetMap
//     (© OpenStreetMap contributors, ODbL — the page credits them), read once
//     from the Overpass API; the frame is the bbox. lqa, Seattle.
//   kind: 'world'  — the countries from Natural Earth 1:50m, the great lakes
//     and, for the countries `states` names, their states and provinces as
//     faint lines, on a Miller cylindrical projection inside `bbox`
//     [south, west, north, east]; `home` is the box the view opens on. A site
//     whose events are spread over continents (curling.events, 2026-10-24),
//     whose pins are the places the events name (`pins: 'places'`) rather
//     than rooms — so a room with geo is not required here.
//
// The line of the place itself (Steve, 2026-11-02: "every city site should by
// default show the city boundaries"): `boundary` in the block draws it on an
// urban ground, shown as the map opens —
//   { osm: <relation id> | [ids] } — a municipal boundary relation from
//     OpenStreetMap (Overpass `rel(id);out geom;`), every ring of it (an
//     enclave's line too); the city limits;
//   { geojson: '<url>', credit: '…' } — a Polygon/MultiPolygon GeoJSON read
//     once, for a neighbourhood OpenStreetMap has no line for (the City of
//     Seattle's Neighborhood Map Atlas for Lower Queen Anne and Pioneer Square).
// The frame grows to take in the whole line (the view opens on the rooms all the same), so the map can zoom out to all of it.
//
// Both read-throughs are cached in .cache/ (gitignored) and the output is
// committed: the Actions build never downloads anything. The labels (towns,
// waters, peaks) are the city's own, in the same block.
//
// Run: node scripts/build-local-map.mjs
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { stitch, simplify, clipPolyline, seaRings, signedArea, memberRings, pathOf, fmt } from './local-map-geom.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const cache = path.join(root, '.cache');
const UA = 'here.events local-map build (one read at build time; the output is committed)';

globalThis.window = globalThis; createRequire(import.meta.url)(path.join(root, 'site', 'city.js'));
const CITY = globalThis.LQACity, M = CITY.map;
if (!M) { console.error('city.js has no map block — nothing to draw'); process.exit(1); }
const rooms = Object.keys(CITY.venues).filter(v => CITY.venues[v].geo);
if (!rooms.length && M.pins !== 'places') { console.error('no room in city.js carries geo: [lat, lon]'); process.exit(1); }

async function cached(name, fetcher) {
  await mkdir(cache, { recursive: true });
  const f = path.join(cache, name);
  try { await access(f); return JSON.parse(await readFile(f, 'utf8')); } catch { /* not cached */ }
  const data = await fetcher(); await writeFile(f, JSON.stringify(data)); return data;
}

// one Overpass read, cached by its query
const overpass = (q) => cached('osm-' + createHash('sha1').update(q).digest('hex').slice(0, 10) + '.json', async () => {
  console.log('reading OpenStreetMap through Overpass…');
  // the public servers turn requests away when every worker is busy (502/504 "at capacity", 429): try each mirror in turn, then wait and go round again
  const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.openstreetmap.fr/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']; // the French community's planet mirror answered when the main one and the two others sat at capacity for an hour (2026-10-26)
  let last = '';
  for (let round = 0; round < 4; round++) {
    for (const url of MIRRORS) {
      const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) }).catch(e => ({ ok: false, status: e.message, text: async () => '' }));
      if (r.ok) { try { return await r.json(); } catch (e) { last = `${url}: ${e.message}`; continue; } }
      last = `${url}: HTTP ${r.status} ${(await r.text()).slice(0, 120).replace(/\s+/g, ' ')}`;
      console.log(`  ${last}`);
    }
    const wait = 20 * 2 ** round; console.log(`  every Overpass mirror busy — retrying in ${wait} s`); await new Promise(res => setTimeout(res, wait * 1000));
  }
  throw new Error(`Overpass failed after every mirror and retry: ${last}`);
});

// a boundary's ways joined end to end whichever way each runs (stitch() follows a coastline's direction,
// which a boundary's ways don't keep — Seattle's 54 never closed): the lines, closed or not, as [lon, lat]
function joinWays(ways) {
  const key = (p) => p[0] + ',' + p[1];
  const left = ways.filter(w => w.length > 1).map(w => w.slice()), out = [];
  while (left.length) {
    let line = left.pop();
    for (let grew = true; grew && key(line[0]) !== key(line[line.length - 1]);) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const w = left[i], a = key(line[0]), z = key(line[line.length - 1]);
        if (key(w[0]) === z) line = line.concat(w.slice(1));
        else if (key(w[w.length - 1]) === z) line = line.concat(w.slice(0, -1).reverse());
        else if (key(w[w.length - 1]) === a) line = w.concat(line.slice(1));
        else if (key(w[0]) === a) line = w.slice().reverse().concat(line.slice(1));
        else continue;
        left.splice(i, 1); grew = true; break;
      }
    }
    out.push(line);
  }
  return out;
}

// the place's own line, as rings of [lon, lat] (see `boundary` above)
async function boundaryRings(B) {
  if (B.osm != null) {
    const ids = [].concat(B.osm);
    const d = await overpass(`[out:json][timeout:180];(${ids.map(id => `rel(${id});`).join('')});out geom;`);
    const rels = d.elements.filter(e => e.type === 'relation');
    if (rels.length !== ids.length) throw new Error(`boundary: ${rels.length} of ${ids.length} relation(s) came back`);
    rels.forEach(r => console.log(`boundary: ${r.tags?.name} (relation ${r.id}, admin_level ${r.tags?.admin_level || '-'})`));
    return rels.flatMap(r => joinWays(r.members.filter(m => m.type === 'way' && m.geometry && (m.role === 'outer' || m.role === 'inner' || m.role === '')).map(m => m.geometry.filter(Boolean).map(g => [g.lon, g.lat]))));
  }
  if (B.geojson) {
    const g = await cached('boundary-' + createHash('sha1').update(B.geojson).digest('hex').slice(0, 10) + '.json', async () => {
      const r = await fetch(B.geojson, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(`boundary GeoJSON: HTTP ${r.status}`);
      return r.json();
    });
    const feats = g.type === 'FeatureCollection' ? g.features : [g];
    if (!feats.length) throw new Error('boundary GeoJSON: no feature');
    console.log(`boundary: ${feats.length} feature(s) from ${new URL(B.geojson).host}`);
    return feats.flatMap(f => (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]).flat());
  }
  throw new Error('map.boundary: { osm: id } or { geojson: url }');
}

const W = 1000;
let proj, ground;
const toLabel = px => (l) => ({ name: l.name, kind: l.kind || 'town', anchor: l.anchor || 'start', dy: l.dy, xy: px([l.lon, l.lat]).map(v => +fmt(v)) });
// a Natural Earth layer: the here.events map's copy when this Mac has it, else one download, cached
const SISTER_DIR = path.join(process.env.HOME || '', 'Desktop/projects/here-events/repo/.cache');
const naturalEarth = (NAME) => cached(NAME + '.geojson', async () => {
  try { return JSON.parse(await readFile(path.join(SISTER_DIR, NAME + '.geojson'), 'utf8')); } catch { /* no sister copy */ }
  const r = await fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/' + NAME + '.geojson', { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`Natural Earth download failed: HTTP ${r.status}`);
  return r.json();
});

if (M.kind === 'island') {
  const g = await naturalEarth('ne_10m_admin_0_countries');
  const inside = (ring, x, y) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const polys = g.features.filter(f => !M.country || f.properties.ADM0_A3 === M.country).flatMap(f => f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]);
  const ringAt = ([lat, lon]) => { const p = polys.find(p => inside(p[0], lon, lat)); if (!p) throw new Error(`no land at ${lat}, ${lon}`); return p[0]; };
  const land = M.land.map(ringAt), far = (M.far || []).map(s => { try { return ringAt(s); } catch { return null; } }).filter(Boolean);
  const PAD = M.pad ?? 0.06, all = land.flat();
  const lons = all.map(p => p[0]), lats = all.map(p => p[1]);
  const cx = (Math.min(...lons) + Math.max(...lons)) / 2, cy = (Math.min(...lats) + Math.max(...lats)) / 2, k = Math.cos(cy * Math.PI / 180);
  const spanX = (Math.max(...lons) - Math.min(...lons)) * k, spanY = Math.max(...lats) - Math.min(...lats);
  const s = W * (1 - 2 * PAD) / Math.max(spanX, spanY), H = Math.round(spanY * s + 2 * PAD * W);
  proj = { cx, cy, k, s, w: W, h: H };
  const px = ([lon, lat]) => [(lon - cx) * k * s + W / 2, (cy - lat) * s + H / 2];
  ground = { land: land.map(r => pathOf(r.map(px))), far: far.map(r => pathOf(r.map(px))), labels: (M.labels || []).map(toLabel(px)),
    credit: 'Map outline from Natural Earth, 1:10m, public domain.' };
  console.log(`island: ${land.length} land ring(s), ${far.length} neighbour(s)`);
} else if (M.kind === 'urban') {
  let [S, Wl, N, E] = M.bbox;
  // the frame takes in the whole line of the place, so the view can zoom out to all of it (Steve, 2026-11-05: "allow zooming out to
  // show the complete city line inside the view for all cities/neighborhoods"); the view still opens on the rooms' box (`home`)
  const lineRings = M.boundary ? await boundaryRings(M.boundary) : null, roomsBox = [S, Wl, N, E];
  let grewToLine = false;
  if (lineRings) {
    let ls = Infinity, lw = Infinity, ln = -Infinity, le = -Infinity; // a loop, not Math.min(...): a city line can run to six figures of points
    for (const r of lineRings) for (const [lon, lat] of r) { if (lat < ls) ls = lat; if (lat > ln) ln = lat; if (lon < lw) lw = lon; if (lon > le) le = lon; }
    const pad = Math.max(ln - ls, le - lw) * .04;
    const grown = [Math.min(S, ls - pad), Math.min(Wl, lw - pad), Math.max(N, ln + pad), Math.max(E, le + pad)].map(v => +v.toFixed(4));
    if (grown.some((v, i) => v !== [S, Wl, N, E][i])) { [S, Wl, N, E] = grown; grewToLine = true; console.log(`bbox grown to the whole line → ${grown.join(', ')}`); }
  }
  const cy = (S + N) / 2, k = Math.cos(cy * Math.PI / 180);
  // the ground is at least `aspect` wide for its height (1.6 unless the block says otherwise): a desktop frame zoomed right out then shows
  // most of its width, and the view never has to leave the data to fill the frame (local-map.js keeps a city ground covered — Steve, 2026-10-25)
  const aspect = M.aspect ?? 1.6, need = (N - S) * aspect / k;
  if (E - Wl < need) { const mid = (Wl + E) / 2; Wl = +(mid - need / 2).toFixed(4); E = +(mid + need / 2).toFixed(4); console.log(`bbox widened to ${aspect}:1 → west ${Wl}, east ${E}`); }
  const cx = (Wl + E) / 2;
  const s = W / ((E - Wl) * k), H = Math.round((N - S) * s);
  proj = { cx, cy, k, s, w: W, h: H };
  const px = ([lon, lat]) => [(lon - cx) * k * s + W / 2, (cy - lat) * s + H / 2];
  const rect = { x0: 0, y0: 0, x1: W, y1: H }, wide = { x0: -W * .2, y0: -H * .2, x1: W * 1.2, y1: H * 1.2 }; // roads and waters run a little past the frame, for the pan
  const roadsRe = '^(' + (M.roads || ['motorway', 'trunk', 'primary']).join('|') + ')$';
  const bbox = [S, Wl, N, E].join(',');
  const q = `[out:json][timeout:180];(way[natural=coastline](${bbox});way[natural=water][name](${bbox});relation[natural=water][name](${bbox});way[highway~"${roadsRe}"](${bbox}););out geom;`;
  const osm = await overpass(q);
  const tol = M.tolerance ?? 0.6, minArea = M.minArea ?? 6;
  const wayOf = w => ({ nodes: w.nodes || w.geometry.filter(Boolean).map((g, i) => `${w.ref || w.id}:${i}`), pts: w.geometry.filter(Boolean).map(g => px([g.lon, g.lat])) });
  const els = osm.elements;
  const coast = stitch(els.filter(e => e.type === 'way' && e.tags?.natural === 'coastline').map(wayOf)).map(c => ({ ...c, pts: simplify(c.pts, tol) }));
  const sea = seaRings(coast, rect);
  sea.notes.forEach(n => console.log('coastline:', n));
  const waters = [];
  for (const e of els.filter(e => e.tags?.natural === 'water')) {
    if (e.type === 'way') { if (e.nodes[0] === e.nodes[e.nodes.length - 1]) waters.push(wayOf(e).pts); }
    else if (e.type === 'relation') memberRings(e.members.filter(m => m.type === 'way' && m.geometry).map(m => ({ role: m.role, nodes: m.geometry.filter(Boolean).map(g => g.lat + ',' + g.lon), pts: m.geometry.filter(Boolean).map(g => px([g.lon, g.lat])) }))).forEach(r => waters.push(r));
  }
  const waterRings = waters.map(r => simplify(r, tol)).filter(r => r.length > 3 && Math.abs(signedArea(r)) >= minArea && r.some(p => p[0] > wide.x0 && p[0] < wide.x1 && p[1] > wide.y0 && p[1] < wide.y1));
  const roads = {};
  for (const e of els.filter(e => e.type === 'way' && e.tags?.highway)) {
    const cls = e.tags.highway, pcs = clipPolyline(wayOf(e).pts, wide);
    for (const pc of pcs) { const pts = simplify(pc.pts, tol); if (pts.length > 1) (roads[cls] = roads[cls] || []).push(pathOf(pts, false)); }
  }
  let boundary = '';
  if (M.boundary) { // the place's own line, clipped a little past the frame (roads' rule)
    boundary = lineRings.flatMap(r => clipPolyline(r.map(px), wide)).map(pc => simplify(pc.pts, M.boundary.tolerance ?? tol / 4)).filter(p => p.length > 1).map(p => pathOf(p, false)).join('');
    if (!boundary) console.log('boundary: nothing of it inside the frame');
  }
  let home = null;
  const homeBox = M.home || (grewToLine ? roomsBox : null); // a frame grown to the line still opens on the rooms
  if (homeBox) { const [hs, hw, hn, he] = homeBox, a = px([hw, hn]), b = px([he, hs]); home = [a[0], a[1], b[0] - a[0], b[1] - a[1]].map(v => +fmt(v)); }
  ground = { sea: sea.rings.map(r => pathOf(r)), water: waterRings.map(r => pathOf(r)), roads: Object.fromEntries(Object.entries(roads).map(([c, d]) => [c, d.join('')])), boundary, labels: (M.labels || []).map(toLabel(px)), home,
    credit: 'Shoreline, waters' + (M.boundary?.osm != null ? ', roads and the city line' : ' and roads') + ' © OpenStreetMap contributors, ODbL.' + (M.boundary?.credit ? ' ' + M.boundary.credit : '') };
  console.log(`urban: ${coast.length} coast chain(s) → ${sea.rings.length} sea ring(s), ${waterRings.length} waters, roads ${Object.entries(roads).map(([c, d]) => c + ' ' + d.length).join(', ')}`);
} else if (M.kind === 'world') {
  const [S, Wl, N, E] = M.bbox;
  const mil = lat => 1.25 * Math.asinh(Math.tan(.8 * lat * Math.PI / 180)) * 180 / Math.PI; // Miller cylindrical, in degree-sized units
  const cx = (Wl + E) / 2, s = W / (E - Wl), my0 = mil(N), H = Math.round((my0 - mil(S)) * s);
  proj = { kind: 'miller', cx, cy: (S + N) / 2, k: 1, s, w: W, h: H, my0 };
  const px = ([lon, lat]) => [(lon - cx) * s + W / 2, (my0 - mil(lat)) * s];
  const wide = { x0: -W * .2, y0: -H * .2, x1: W * 1.2, y1: H * 1.2 };
  const tol = M.tolerance ?? 0.5, minArea = M.minArea ?? 3;
  const inFrame = r => r.some(p => p[0] > wide.x0 && p[0] < wide.x1 && p[1] > wide.y0 && p[1] < wide.y1);
  const rings = f => (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]);
  // every polygon of a layer as one path (its holes too, drawn evenodd), simplified, the slivers and the far-off dropped
  const paths = (features) => features.flatMap(f => rings(f).map(poly => poly.map(r => simplify(r.map(px), tol)).filter((r, i) => r.length > 3 && (i === 0 ? inFrame(r) && Math.abs(signedArea(r)) >= minArea : Math.abs(signedArea(r)) >= minArea))).filter(poly => poly.length)).map(poly => poly.map(r => pathOf(r)).join(''));
  const countries = await naturalEarth('ne_50m_admin_0_countries');
  const land = paths(countries.features.filter(f => f.properties.ADM0_A3 !== 'ATA'));
  const lakes = await naturalEarth('ne_50m_lakes');
  const water = paths(lakes.features.filter(f => (f.properties.scalerank ?? 9) <= (M.lakes ?? 1)));
  let borders = '';
  if (M.states && M.states.length) {
    const adm1 = await naturalEarth('ne_50m_admin_1_states_provinces');
    borders = paths(adm1.features.filter(f => M.states.includes(f.properties.adm0_a3))).join('');
  }
  let home = null;
  if (M.home) { const [hs, hw, hn, he] = M.home, a = px([hw, hn]), b = px([he, hs]); home = [a[0], a[1], b[0] - a[0], b[1] - a[1]].map(v => +fmt(v)); }
  ground = { land, water, borders, labels: (M.labels || []).map(toLabel(px)), home, credit: 'Countries, lakes and state lines from Natural Earth, 1:50m, public domain.' };
  console.log(`world: ${land.length} land path(s), ${water.length} lake(s), state lines for ${(M.states || []).join(', ') || 'no one'}`);
} else throw new Error(`map.kind ${M.kind}: island, urban or world`);

const out = { kind: M.kind, proj, ...ground };
const outside = rooms.filter(v => { const [lat, lon] = CITY.venues[v].geo, x = (lon - proj.cx) * proj.k * proj.s + W / 2, y = proj.kind === 'miller' ? (proj.my0 - 1.25 * Math.asinh(Math.tan(.8 * lat * Math.PI / 180)) * 180 / Math.PI) * proj.s : (proj.cy - lat) * proj.s + proj.h / 2; return x < 0 || x > W || y < 0 || y > proj.h; });
if (outside.length) console.log(`off the frame: ${outside.join(', ')}`);
await writeFile(path.join(root, 'site', 'local-map.json'), JSON.stringify(out));
const size = Buffer.byteLength(JSON.stringify(out));
console.log(`local-map.json: frame ${W}×${proj.h}, ${M.pins === 'places' ? 'pins at the places the events name' : rooms.length + ' rooms placed'}, ${(size / 1024).toFixed(0)} KB`);
