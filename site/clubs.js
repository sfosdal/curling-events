/* Local Clubs — curling-events' own view behind the switch's third stop (city-owned;
 * app.js, filter.js and styles.css are lqa-events' shared files, byte for byte).
 *
 * A sport has no home teams, so the Teams stop opens the club finder instead
 * (Steve, 2026-10-22: "the hometown teams section makes no sense here … make it
 * local club and ask for location permission"). On open the browser is asked
 * for the visitor's location once; the nearest clubs from clubs.json (every US
 * club: ice, sheets, website, region) are listed with their distance and the
 * next listed events from events.json (a club's rows end in " — Town, ST", or
 * carry its name as the venue). Permission refused, dismissed or unavailable:
 * the search box takes a town, a state (name or code) or a ZIP code — ZIP
 * positions come from zip3.json, the GeoNames three-digit prefix centroids
 * (CC BY 4.0, credited in Sources). Nothing leaves the browser: the location
 * is used in page and never stored or sent.
 *
 * Wiring: a capture-phase listener on the view switch takes the 'teams' stop
 * before app.js sees it; another stop closes the finder and falls through to
 * app.js as usual. The address is ?view=clubs (app.js reads ?view=month the
 * same way), with history and Back/Forward handled here.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var root = document.documentElement;
  var STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
  var NEAREST = 12; // clubs shown for a location
  var state = { open: false, at: null, label: '', data: null, loading: null, located: false };

  // ---- data: the club list, the ZIP centroids and the events, fetched on first open ----
  function load() {
    if (state.loading) return state.loading;
    var v = (document.querySelector('script[src^="clubs.js"]') || {}).src || '';
    var q = v.indexOf('?') > -1 ? v.slice(v.indexOf('?')) : '';
    var get = function (f) { return fetch(f + q, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(f + ' HTTP ' + r.status); return r.json(); }); };
    state.loading = Promise.all([get('clubs.json'), get('zip3.json'), fetch('events.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : { events: [] }; }).catch(function () { return { events: [] }; })])
      .then(function (r) {
        var today = new Date(); today = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        var upcoming = (r[2].events || []).filter(function (e) { return e.date >= today; });
        // a club with a row of its own in city.js (Granite, Evergreen) is matched by web site, not by
        // name — "Granite Curling Club" is also Nashua's name; every other club by the " — Town, ST"
        // its rows carry
        var host = function (u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
        var rowHost = {}, venues = (window.LQACity || {}).venues || {};
        Object.keys(venues).forEach(function (k) { var h = host(venues[k].url); if (h) rowHost[h] = k; });
        var rowOf = {}; r[0].clubs.forEach(function (c) { var h = host(c.url); if (h && rowHost[h]) rowOf[c.name] = rowHost[h]; });
        var byPlace = {}; // "Town, ST" or a club's own row → its upcoming events
        upcoming.forEach(function (e) {
          var m = / — ([^—]+)$/.exec(e.title || '');
          var key = m ? m[1].trim() : e.venue;
          (byPlace[key] = byPlace[key] || []).push(e);
        });
        state.data = { clubs: r[0].clubs.filter(function (c) { return c.lat != null; }), zip3: r[1], byPlace: byPlace, rowOf: rowOf };
        return state.data;
      });
    return state.loading;
  }
  function eventsOf(club) {
    var own = state.data.rowOf[club.name];
    var rows = (own ? state.data.byPlace[own] || [] : []).concat(state.data.byPlace[club.town + ', ' + club.state] || []);
    rows.sort(function (a, b) { return (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')); });
    var seen = {}, out = [];
    rows.forEach(function (e) { var k = e.title; if (seen[k]) return; seen[k] = 1; out.push(e); }); // a multi-day event is one line, its first day
    return out;
  }

  // ---- geography ----
  function dist(a, b) { // miles, great circle
    var R = 3958.8, toRad = Math.PI / 180;
    var dLat = (b[0] - a[0]) * toRad, dLon = (b[1] - a[1]) * toRad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function nearest(at) {
    return state.data.clubs.map(function (c) { return { club: c, miles: dist(at, [c.lat, c.lon]) }; })
      .sort(function (a, b) { return a.miles - b.miles; }).slice(0, NEAREST);
  }
  function fmtMiles(m) { return (m < 10 ? Math.round(m * 10) / 10 : Math.round(m)) + ' mi'; }

  // ---- the view ----
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function fmtDate(iso) { var d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  function status(text) { $('clubsStatus').textContent = text || ''; $('clubsStatus').hidden = !text; }
  function card(c, miles) {
    var a = el('article', 'club-card');
    var h = el('h3'); var link = el('a', null, c.name); if (c.url) { link.href = c.url; link.target = '_blank'; link.rel = 'noopener'; } h.appendChild(link); a.appendChild(h);
    var meta = el('p', 'club-meta');
    var bits = [c.town + ', ' + c.state];
    if (miles != null) { var d = el('span', 'club-dist', fmtMiles(miles)); meta.appendChild(d); meta.appendChild(document.createTextNode(' · ')); }
    if (c.ice === 'dedicated') bits.push('Dedicated ice' + (c.sheets ? ', ' + c.sheets + ' sheet' + (c.sheets === 1 ? '' : 's') : ''));
    else if (c.ice === 'arena') bits.push('Arena ice');
    if (c.member) bits.push('USA Curling member');
    meta.appendChild(document.createTextNode(bits.join(' · ')));
    a.appendChild(meta);
    var evs = eventsOf(c);
    if (evs.length) {
      var ul = el('ul', 'club-next');
      evs.slice(0, 3).forEach(function (e) {
        var li = el('li'); li.appendChild(el('time', null, fmtDate(e.date)));
        var t = el('a', null, e.title.replace(/ — [^—]+$/, '')); if (e.url) { t.href = e.url; t.target = '_blank'; t.rel = 'noopener'; }
        li.appendChild(t); if (e.soldOut) li.appendChild(el('span', 'club-sold', 'sold out')); ul.appendChild(li);
      });
      a.appendChild(ul);
      if (evs.length > 3) { var more = el('button', 'chip club-more', 'All ' + evs.length + ' in the list'); more.type = 'button'; more.addEventListener('click', function () { showInList(c); }); a.appendChild(more); }
    } else a.appendChild(el('p', 'club-none', 'No listed events yet — the club’s own site has its calendar.'));
    return a;
  }
  function list(rows, heading) {
    var grid = $('clubsGrid'); grid.textContent = '';
    rows.forEach(function (r) { grid.appendChild(card(r.club, r.miles)); });
    status(rows.length ? heading : 'No club matches that — try a town, a state or a ZIP code.');
  }
  // the whole list, searched by the club's town: back to the events with the search box filled
  function showInList(c) {
    setOpen(false, true, false);
    var ev = $('eventsBtn'); if (ev) ev.click(); // app.js: the Events stop
    var box = $('searchBox'); if (box) { box.value = state.data.rowOf[c.name] || c.town + ', ' + c.state; box.dispatchEvent(new Event('input', { bubbles: true })); } // its own row's name, else the town its rows end in
  }

  // ---- finding the visitor ----
  function locate(asked) {
    if (!navigator.geolocation) { status('This browser gives no location — search by town, state or ZIP.'); return; }
    if (!asked) status('Finding the clubs near you…');
    navigator.geolocation.getCurrentPosition(function (p) {
      state.at = [p.coords.latitude, p.coords.longitude]; state.label = 'The ' + NEAREST + ' clubs nearest you';
      state.located = true; $('clubsLocate').hidden = true;
      list(nearest(state.at), state.label);
    }, function (err) {
      $('clubsLocate').hidden = false;
      status(err.code === 1 ? 'Location is off for this site — search by town, state or ZIP, or allow it and tap Use my location.' : 'Your location could not be read — search by town, state or ZIP.');
    }, { timeout: 10000, maximumAge: 600000 });
  }
  function firstOpen() {
    var q = navigator.permissions && navigator.permissions.query ? navigator.permissions.query({ name: 'geolocation' }).catch(function () { return null; }) : Promise.resolve(null);
    q.then(function (p) {
      if (p && p.state === 'denied') { $('clubsLocate').hidden = false; status('Location is off for this site — search by town, state or ZIP (' + state.data.clubs.length + ' clubs in ' + Object.keys(state.data.clubs.reduce(function (m, c) { m[c.state] = 1; return m; }, {})).length + ' states).'); return; }
      locate(false);
    });
  }

  // ---- the search box: a town, a state, a ZIP ----
  function search(q) {
    q = q.trim();
    if (!q) { if (state.at) list(nearest(state.at), state.label); else { $('clubsGrid').textContent = ''; status(''); } return; }
    var zip = /^(\d{3})\d{0,2}$/.exec(q);
    if (zip) {
      var c = state.data.zip3[zip[1]];
      if (!c) { list([], ''); return; }
      list(nearest(c), 'The ' + NEAREST + ' clubs nearest ZIP ' + q); return;
    }
    var code = q.length === 2 && STATES[q.toUpperCase()] ? q.toUpperCase() : null;
    if (!code) Object.keys(STATES).forEach(function (k) { if (STATES[k].toLowerCase() === q.toLowerCase()) code = k; });
    var rows;
    if (code) rows = state.data.clubs.filter(function (c) { return c.state === code; }).sort(function (a, b) { return a.town.localeCompare(b.town) || a.name.localeCompare(b.name); });
    else { var lq = q.toLowerCase(); rows = state.data.clubs.filter(function (c) { return (c.name + ' ' + c.town + ', ' + c.state + ' ' + STATES[c.state]).toLowerCase().indexOf(lq) > -1; }).sort(function (a, b) { return a.name.localeCompare(b.name); }); }
    list(rows.map(function (c) { return { club: c, miles: state.at ? dist(state.at, [c.lat, c.lon]) : null }; }), rows.length + ' club' + (rows.length === 1 ? '' : 's') + (code ? ' in ' + STATES[code] : ' matching “' + q + '”'));
  }

  // ---- open / close ----
  function name(on) {
    [document.querySelector('.bar-name'), document.querySelector('.masthead h1')].forEach(function (n) {
      if (!n) return;
      if (!n.dataset.events) n.dataset.events = n.innerHTML;
      n.innerHTML = on ? 'Local Clubs' : n.dataset.events;
    });
  }
  function syncSwitch(v) {
    var tog = $('viewToggle'); tog.dataset.active = v;
    tog.querySelectorAll('button[data-view]').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.view === v)); });
  }
  function url(on) { var u = new URL(location.href); if (on) u.searchParams.set('view', 'clubs'); else u.searchParams.delete('view'); return u.pathname + u.search + u.hash; }
  function setOpen(on, push, sync) {
    if (state.open === on) return;
    state.open = on;
    if (on && window.LQAMap && LQAMap.isOpen()) LQAMap.open(false, false); // the Map stop's view steps aside for the finder
    root.classList.toggle('clubs-open', on);
    $('clubsView').hidden = !on;
    var agenda = document.querySelector('.agenda'); if (agenda) agenda.hidden = on;
    var tv = $('teamsView'); if (tv && on) tv.hidden = true;
    name(on);
    if (on) syncSwitch('teams'); else if (sync !== false) syncSwitch(root.classList.contains('month-open') ? 'month' : 'events');
    if (push) history.pushState(null, '', url(on));
    if (!on) return;
    var fp = $('filterPanel'), ft = $('filterToggle'); if (fp) fp.hidden = true; if (ft) ft.setAttribute('aria-expanded', 'false'); // the floating panel belongs to the agenda
    load().then(function () {
      if (state.at) list(nearest(state.at), state.label);
      else if ($('clubsSearch').value.trim()) search($('clubsSearch').value);
      else if (!state.located && !$('clubsGrid').childElementCount) firstOpen();
    }).catch(function (err) { status('The club list could not be loaded (' + err.message + ').'); });
  }

  var tog = $('viewToggle');
  if (!tog || !$('clubsView')) return;
  tog.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-view]'), cur = tog.dataset.active;
    var stops = Array.prototype.map.call(tog.querySelectorAll('button[data-view]'), function (x) { return x.dataset.view; });
    var view = b && b.dataset.view !== cur ? b.dataset.view : stops[(stops.indexOf(cur) + 1) % stops.length];
    if (view === 'teams') { e.stopImmediatePropagation(); e.preventDefault(); setOpen(true, true); return; }
    if (state.open) setOpen(false, true, false); // app.js takes it from here: the Events or Month stop
  }, true);
  // should app.js ever show its Teams view (an old link), the finder stands in for it
  new MutationObserver(function () { if ($('teamsView') && !$('teamsView').hidden) { $('teamsView').hidden = true; setOpen(true, false); } }).observe($('teamsView'), { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('popstate', function () { setOpen(new URLSearchParams(location.search).get('view') === 'clubs', false); });
  $('clubsSearch').addEventListener('input', function () { var v = this.value; clearTimeout(search.t); search.t = setTimeout(function () { if (state.data) search(v); }, 160); });
  $('clubsLocate').addEventListener('click', function () { $('clubsSearch').value = ''; locate(true); });
  if (new URLSearchParams(location.search).get('view') === 'clubs' || !$('teamsView').hidden) { $('teamsView').hidden = true; setOpen(true, false); } // ?view=clubs, or a tap on the stop that beat this script
})();
