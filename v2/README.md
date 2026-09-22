# Betandplay Content Hub V2

V2 is designed to minimize hosting cost while preserving the Singapore egress path that currently works with the Betandplay sportsbook API.

## Design goals

- No background polling.
- No cron jobs.
- No persistent database.
- API calls happen only when the user presses Generate.
- Short in-memory cache reduces duplicate sportsbook requests.
- Static frontend is served with browser caching.
- Server can sleep when unused and wake on demand.
- V1 remains untouched on `main` while V2 lives on the `v2-free-architecture` branch.

## Recommended deployment

Use the existing Railway project but create a separate V2 service only when ready to test.

Set its root directory to:

`/v2`

Keep the region in:

`sin`

Then enable Railway **Sleep Application / Serverless** mode after confirming the Betandplay API still works when the service wakes.

This dramatically reduces idle runtime because the app is not doing background work.

## Why not move Betandplay API traffic straight to Cloudflare?

Betandplay has already returned 403 from some cloud/datacenter networks in our testing. V2 therefore separates the UI and API logic so the frontend can later move to a free static host while the small API can stay on whichever Singapore host Betandplay accepts.

## Future migration options

The frontend can be hosted for free on GitHub Pages, Cloudflare Pages, or similar static hosting.

The backend is intentionally small and provider-agnostic. If another free Singapore runtime works with Betandplay, only the API base deployment changes.

## API

`POST /api/generate`

Example:

```json
{
  "tournamentKey": "champions",
  "contentType": "acca",
  "count": 3,
  "excludeGermany": true
}
```

Supported content types:

- `match`
- `tournament`
- `acca`
- `picks`
- `weekend`

Supported tournament keys include Champions League, Europa League, Conference League, Nations League, Premier League, Bundesliga, Serie A, LaLiga, Ligue 1, FA Cup, Carabao Cup and DFB-Pokal.
