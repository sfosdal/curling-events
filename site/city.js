// The "city" — here a sport rather than a town: every fact that makes this
// calendar curling.events rather than a city's (2026-10-21, Steve: "build a
// curling front", "curling.events should be primary. curling.here.events is a
// redirect to the other"). Built on the family's city pattern (template:
// salem-events). The browser (filter.js, app.js) and the build
// (scripts/*.mjs) both read it; nothing else names a row. The shared files
// (app.js, filter.js, styles.css bar its --v-* hues, scripts/*.mjs bar
// fetch-events.mjs and sources.mjs) are lqa-events' own, byte for byte.
//
// The "venues" are the panel's rows: the three championship circuits, then
// the bonspiels by club and region. A multi-day event is one row per day, so
// the days read as one series ("2 of 3"), as a festival's do.
//
// Loaded before filter.js (a plain script, so the tests can share it): it
// sets globalThis.LQACity (the name is the shared code's, not the city's).
(function (global) {
  'use strict';

  // No clubs: curling has no ESPN or league feed the Teams view could read,
  // so the Teams view stays empty.
  var TEAMS = [];

  // The rows, one record each. Per row:
  //   capacity  a rough house size (championship arenas against club sheets)
  //             — only the "big" preset reads it
  //   area      absent = the Championships column; 'town' = Bonspiels & Clubs
  //   type      the event type when the title decides nothing
  //   cssVar    the hue styles.css sets for it (dark block --v-*); color the
  //             same hue as a value, for the series graph
  //   url       the row's own listing
  //   icon      the row's mark
  //   states    (bonspiel regions) the USA Curling locator's state names that
  //             fall in the row — read by fetch-events.mjs
  // Scouted (README "Sources"): the Pacific Northwest Curling Association's
  // three Google calendars (public, but nothing entered after June 2025 —
  // left out), Curling Canada (a Cloudflare challenge to every fetch — CurlingZone's
  // schedule carries its championships instead), worldcurling.org/events
  // (403; its results database is read instead).
  var VENUES = {
    // --- Championships ---
    'USA Curling Nationals': { // USA Curling's national championships, playdowns and qualifiers — its Sport:80 event locator
      capacity: 1500,
      type: 'sports',
      cssVar: '--v-usac',
      color: '#86b4ea',
      url: 'https://www.usacurling.org/championships',
      icon: 'https://www.google.com/s2/favicons?domain=www.usacurling.org&sz=128',
    },
    'World Curling': { // the World Curling Federation's championships — its results database's season list
      capacity: 5000,
      type: 'sports',
      cssVar: '--v-wcf',
      color: '#ea9a86',
      url: 'https://results.worldcurling.org/Championship',
      icon: 'https://www.google.com/s2/favicons?domain=worldcurling.org&sz=128',
    },
    'Grand Slam of Curling': { // the professional tour's Slams — the season list its events page embeds
      capacity: 4000,
      type: 'sports',
      cssVar: '--v-gsoc',
      color: '#eadb86',
      url: 'https://www.thegrandslamofcurling.com/events',
      icon: 'https://www.google.com/s2/favicons?domain=www.thegrandslamofcurling.com&sz=128',
    },
    'World Tour': { // the World Curling Tour and other nations' championships outside North America — CurlingZone's schedule
      capacity: 1000,
      type: 'sports',
      cssVar: '--v-tour',
      color: '#86eaea',
      url: 'https://www.curlingzone.com/schedule.php',
      icon: 'https://www.google.com/s2/favicons?domain=www.curlingzone.com&sz=128',
    },
    // --- Bonspiels & clubs ---
    'Granite Curling Club': { // Seattle, 1440 N 128th St, five sheets — its bonspiel list, and its public calendar for learn-to-curls, clinics and club nights
      capacity: 200,
      type: 'sports',
      area: 'town',
      cssVar: '--v-granite',
      color: '#86eabe',
      url: 'https://curlingseattle.org/bonspiels',
      icon: 'https://www.google.com/s2/favicons?domain=curlingseattle.org&sz=128',
      alias: /granite curling/i,
      geo: [47.7224, -122.3447], town: 'Seattle, WA', // the club's own spot: the Map pins its rows there (scripts/places.mjs)
    },
    'Evergreen Curling Club': { // Beaverton, Oregon — its bonspiels from the USA Curling locator
      capacity: 150,
      type: 'sports',
      area: 'town',
      cssVar: '--v-evergreen',
      color: '#a4ea86',
      url: 'https://www.evergreencurling.org/',
      icon: 'https://www.google.com/s2/favicons?domain=www.evergreencurling.org&sz=128',
      alias: /evergreen curling/i,
      geo: [45.4895, -122.7919], town: 'Beaverton, OR',
    },
    'Northwest': { // the rest of Washington, Oregon, Idaho, Montana and Alaska
      capacity: 150,
      type: 'sports',
      area: 'town',
      cssVar: '--v-northwest',
      color: '#86dcea',
      url: 'https://www.usacurling.org/bonspiel-calendar',
      icon: 'https://www.google.com/s2/favicons?domain=www.usacurling.org&sz=128',
      states: ['Washington', 'Oregon', 'Idaho', 'Montana', 'Alaska'],
    },
    'Midwest': { // the heartland of American curling
      capacity: 150,
      type: 'sports',
      area: 'town',
      cssVar: '--v-midwest',
      color: '#c286ea',
      url: 'https://www.usacurling.org/bonspiel-calendar',
      icon: 'https://www.google.com/s2/favicons?domain=www.usacurling.org&sz=128',
      states: ['Wisconsin', 'Minnesota', 'Michigan', 'Illinois', 'Indiana', 'Ohio', 'Iowa', 'Nebraska', 'North Dakota', 'South Dakota', 'Missouri', 'Kansas'],
    },
    'Northeast': {
      capacity: 150,
      type: 'sports',
      area: 'town',
      cssVar: '--v-northeast',
      color: '#ea86b8',
      url: 'https://www.usacurling.org/bonspiel-calendar',
      icon: 'https://www.google.com/s2/favicons?domain=www.usacurling.org&sz=128',
      states: ['Maine', 'New Hampshire', 'Vermont', 'Massachusetts', 'Rhode Island', 'Connecticut', 'New York', 'New Jersey', 'Pennsylvania', 'Maryland', 'Delaware', 'District of Columbia', 'Virginia', 'West Virginia'],
    },
    'South': {
      capacity: 150,
      type: 'sports',
      area: 'town',
      cssVar: '--v-south',
      color: '#eab886',
      url: 'https://www.usacurling.org/bonspiel-calendar',
      icon: 'https://www.google.com/s2/favicons?domain=www.usacurling.org&sz=128',
      states: ['Texas', 'North Carolina', 'South Carolina', 'Georgia', 'Florida', 'Tennessee', 'Alabama', 'Kentucky', 'Louisiana', 'Arkansas', 'Oklahoma', 'Mississippi'],
    },
    'Canada': { // Canada's tour bonspiels, provincials, the Brier and the Scotties — CurlingZone's schedule (curling.ca 403s every fetch)
      capacity: 500,
      type: 'sports',
      area: 'town',
      cssVar: '--v-canada',
      color: '#ea8686',
      url: 'https://www.curlingzone.com/schedule.php',
      icon: 'https://www.google.com/s2/favicons?domain=www.curlingzone.com&sz=128',
    },
    'Mountain & Southwest': {
      capacity: 150,
      type: 'sports',
      area: 'town',
      cssVar: '--v-mountain',
      color: '#d0ea86',
      url: 'https://www.usacurling.org/bonspiel-calendar',
      icon: 'https://www.google.com/s2/favicons?domain=www.usacurling.org&sz=128',
      states: ['California', 'Nevada', 'Arizona', 'Utah', 'Colorado', 'New Mexico', 'Wyoming', 'Hawaii'],
    },
  };

  // The two regional calendars the shared feeds.mjs reads (fetch-events.mjs
  // pins each to its region's row); the clubs' own calendars are listed per
  // club in clubs.json (`feeds`), the other sources are fetch-events.mjs's own.
  var FEEDS = [
    { kind: 'icsfile', label: 'Dakota Territory Curling Association', venue: 'Midwest', url: 'https://calendar.google.com/calendar/ical/e6b57480ec3c946e9073c18ba27336a79195b1c2c7b8251c1fc86b695dae5727%40group.calendar.google.com/public/basic.ics' },
    { kind: 'tribe', label: 'Midwest Curling Association', venue: 'Midwest', url: 'https://www.midwestcurling.com/wp-json/tribe/events/v1/events' },
  ];

  // The usual view: every row on
  var DEFAULT_ON = Object.keys(VENUES);
  var DEFAULT_OFF = [];
  var PREFS_KNOWN_FROM = null;

  // Event types (the shared keys): Learn to Curl first — the sessions,
  // try-curling nights and open houses new curlers are looking for (the
  // shared key 'expo', its name here; fetch-events.mjs tags them by title);
  // every championship, playdown and bonspiel is a competition; clinics and
  // club nights are the rest — except the courses: officiating, instructor,
  // coaching and ice-technician certification (USA Curling's and the clubs'),
  // the Officials type (its own key; filter.js admits a city's keys).
  var TYPES = [
    { key: 'expo', label: 'Learn to Curl', title: 'Learn-to-curl sessions, try-curling nights and open houses' },
    { key: 'sports', label: 'Competitions', title: 'Championships, Slams, playdowns, qualifiers and bonspiels' },
    { key: 'community', label: 'Clinics & Club Nights', title: 'Clinics, camps, club nights and the rest of the club calendar' },
    { key: 'officials', label: 'Officials & Instructors', title: 'Officiating, instructor, coaching and ice-technician courses' },
  ];
  var MOVIE_VENUE = null;

  // Share codes (?f=CODE): REGISTRY is every filterable key in a fixed
  // order and a code is a bitmask over it, so the list is APPEND-ONLY once
  // published — adding an entry adds a bit and every existing code keeps
  // meaning what it meant. 20 slots: 4 base-36 digits hold exactly 20 bits —
  // the next entry needs CODE_LENGTH 5.
  var CODE_LENGTH = 4;
  var REGISTRY = [
    ['venue', 'USA Curling Nationals'], ['venue', 'World Curling'], ['venue', 'Grand Slam of Curling'],
    ['venue', 'Granite Curling Club'], ['venue', 'Evergreen Curling Club'], ['venue', 'Northwest'], ['venue', 'Midwest'], ['venue', 'Northeast'], ['venue', 'South'], ['venue', 'Mountain & Southwest'],
    ['badge', 'sports'], ['badge', 'community'],
    ['cap', 'stadium'], ['cap', 'arena'], ['cap', 'hall'], ['cap', 'room'],
    ['venue', 'World Tour'], ['venue', 'Canada'], ['badge', 'expo'], // 2026-10-22
    ['badge', 'officials'], // 2026-10-22, the US sweep
  ];

  var WORDS = {
    teamCity: '',
    presetDefault: 'Every championship and every bonspiel — Nationals, World Curling, the Grand Slam, the World Tour, Granite, Evergreen, every region and Canada',
    presetNeighborhood: 'The championships only — USA Curling Nationals, World Curling, the Grand Slam and the World Tour',
    presetBig: 'The arena events only — World Curling and the Grand Slam',
    phrases: { all: 'Showing everything.', none: 'Showing nothing yet — open Filter and pick some rows.', neighborhood: 'Showing the championships only.', big: 'Showing World Curling and the Grand Slam only.' },
  };

  // The federal holidays
  function nthWeekday(y, month, weekday, n) { var d = new Date(y, month, 1); while (d.getDay() !== weekday) d.setDate(d.getDate() + 1); d.setDate(d.getDate() + (n - 1) * 7); return d; }
  function lastMonday(y, month) { var d = new Date(y, month + 1, 0); while (d.getDay() !== 1) d.setDate(d.getDate() - 1); return d; }
  var HOLIDAYS = function (y) {
    return [
      [new Date(y, 0, 1), "New Year's Day"],
      [nthWeekday(y, 0, 1, 3), 'Martin Luther King Jr. Day'],
      [nthWeekday(y, 1, 1, 3), "Presidents' Day"],
      [lastMonday(y, 4), 'Memorial Day'],
      [new Date(y, 5, 19), 'Juneteenth'],
      [new Date(y, 6, 4), 'Independence Day'],
      [nthWeekday(y, 8, 1, 1), 'Labor Day'],
      [nthWeekday(y, 9, 1, 2), 'Columbus Day'],
      [new Date(y, 10, 11), 'Veterans Day'],
      [nthWeekday(y, 10, 4, 4), 'Thanksgiving'],
      [new Date(y, 11, 25), 'Christmas Day'],
    ];
  };

  global.LQACity = {
    key: 'curling',
    name: 'Curling',
    site: 'https://curling.events/',
    userAgent: 'Mozilla/5.0 (compatible; curling-events/1.0; +https://curling.events/)',
    tz: 'America/Los_Angeles', tzName: 'Pacific', // Granite's clocks; the championships are all-day rows
    state: 'USA', stateOutline: null,
    // the calendar feed's header; the UID domain never changes
    ics: { name: 'Curling Events', short: 'Curling Events', teams: 'Curling', prodid: '-//here.events//curling-events//EN', uidDomain: 'fosdal.net',
      desc: 'Upcoming curling — USA Curling national championships\, World Curling\, the Grand Slam of Curling\, bonspiels\, learn-to-curls and courses at Granite (Seattle)\, Evergreen (Beaverton) and ninety clubs across the country\, and Canada\'s tour and provincials' },
    teams: TEAMS,
    venues: VENUES,
    feeds: FEEDS,
    // the Map view (Steve, 2026-10-24: "curling.events should have the map"): the
    // world on a Miller projection (scripts/build-local-map.mjs, Natural Earth),
    // opening on North America; the pins are the places the events name — the
    // "— Town, State" tail of each title, located by scripts/places.mjs from the
    // committed gazetteer — not the rows, which are circuits and regions
    map: {
      kind: 'world',
      pins: 'places',
      bbox: [-48, -170, 72, 180], // south, west, north, east — Alaska to New Zealand, Japan on the right
      home: [24, -130, 60, -52], // the opening view: the US and southern Canada
      states: ['USA', 'CAN'], // whose states and provinces are drawn as faint lines
      labels: [
        { name: 'Canada', lat: 56, lon: -103, anchor: 'middle', dy: 0 },
        { name: 'United States', lat: 39.5, lon: -99, anchor: 'middle', dy: 0 },
        { name: 'Scotland', lat: 56.8, lon: -4.2, anchor: 'end' },
        { name: 'Sweden', lat: 62.5, lon: 15.5, anchor: 'start' },
        { name: 'Switzerland', lat: 46.8, lon: 8.2, anchor: 'start' },
        { name: 'Japan', lat: 36.5, lon: 138.5, anchor: 'start' },
        { name: 'Korea', lat: 36.5, lon: 127.8, anchor: 'end' },
        { name: 'New Zealand', lat: -42, lon: 172.5, anchor: 'end' },
        { name: 'Pacific Ocean', lat: 20, lon: -150, kind: 'water', anchor: 'middle' },
        { name: 'Atlantic Ocean', lat: 30, lon: -45, kind: 'water', anchor: 'middle' },
      ],
    },
    defaultOn: DEFAULT_ON,
    defaultOff: DEFAULT_OFF,
    prefsKnownFrom: PREFS_KNOWN_FROM,
    types: TYPES,
    movieVenue: MOVIE_VENUE,
    groundsVenue: null,
    codeLength: CODE_LENGTH,
    registry: REGISTRY,
    words: WORDS,
    holidays: HOLIDAYS,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
