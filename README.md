# Curling Events

Event feed and calendar for curling: USA Curling's national championships,
playdowns and qualifiers, World Curling's championships, the Grand Slam of
Curling, and bonspiels — Granite Curling Club (Seattle) and Evergreen Curling
Club (Beaverton) by name, every other club's by region (Northwest, Midwest,
Northeast, South, Mountain & Southwest).

Published at **https://curling.events/** (GitHub Pages, built by the Actions
workflow once a day at noon Pacific). **https://curling.here.events/** is a
redirect to it (repo sfosdal/curling-redirect).

Built 2026-10-21 on the here.events city pattern (template: salem-events) —
here the "city" is a sport. Everything that makes this curling's is
`site/city.js` (every row, type, default, share-code registry, holiday and
string), `site/index.html`, `scripts/fetch-events.mjs` (its sources),
`scripts/seo-places.mjs`, `site/embed.js`, the manifest and icons. Everything
else — `app.js`, `filter.js`, `styles.css` bar its `--v-*` hue lines, the
shared `scripts/*.mjs` and their tests — is lqa-events' own, byte for byte.

## Sources

All public and keyless, read at build time; no Ticketmaster.

- **USA Curling's Sport:80 event locator** —
  `POST usacurling.sport80.com/api/public/events/locator/data?p=N&i=100`, every
  page, kept by Status Active. Competitions (nationals, playdowns, qualifiers)
  → USA Curling Nationals; bonspiels → Evergreen (its zip), Granite (only dates
  its own page lacks) or the region row by state; one-week events kept,
  instructor/officials courses dropped.
- **Granite Curling Club** — its bonspiel page (the table above "Completed")
  and its public ice calendar (`calendar.curlingseattle.org/public/calendar.ics`:
  Learn To Curl, Other, Activities and Competitions; leagues, practice ice,
  maintenance, rentals and meetings left out; a PNWCA playdown "@ Evergreen
  CC" goes to the Evergreen row).
- **Grand Slam of Curling** — the season list its `/events` page embeds as
  URL-encoded JSON.
- **World Curling** — the results database's `/Championship/Year/<year>`
  table (this year and next, every grid page).

A multi-day event is one all-day row per day, so the days read as one series
("2 of 4"). Left out after scouting: the PNWCA's Google calendars (nothing
after June 2025), Curling Canada and worldcurling.org/events (403 to every
fetch), CurlingZone (no listing).

`seo-places.mjs` runs after the shared `seo.mjs` and gives each Event in the
page's JSON-LD the place its row names (seo.mjs would give them all one city).

## Build

```
ALLOW_NO_ARCHIVE=1 node scripts/fetch-events.mjs   # writes site/events.json and the .ics feeds
node --test scripts/*.test.mjs
python3 -m http.server 8000 --directory site
```

`ALLOW_NO_ARCHIVE=1` is only for the first build, before the `archive` branch
exists; in CI it is a repository variable until the first run has pushed the
archive, then it is deleted.

## Sister sites

lqa-events (Seattle Center) is the source of truth for the shared files. See
its README for the pipeline and the share codes.
