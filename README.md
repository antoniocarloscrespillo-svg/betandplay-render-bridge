# Betandplay Render Bridge

Small read-only bridge for testing whether Render can reach the public Betandplay sportsbook API.

## Endpoints

- `GET /health`
- `GET /matches`
- `GET /matches/:id/markets`

The markets endpoint normalizes integer odds such as `1390` to decimal `1.39` while also returning `raw_odds: 1390`.

This service does not expose betting, player, wallet, bonus, authentication, or write endpoints.

## Render

The repository contains `render.yaml` for a free Render Web Service.

After deployment, test:

`/health`

If `upstream_status` is `200`, Render can reach Betandplay and the bridge is usable.

If it is `403`, Betandplay is blocking Render's outbound IP and this hosting option should be discarded.
