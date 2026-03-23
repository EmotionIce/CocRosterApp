# CWL Roster App

This repository powers a Clash of Clans roster system with two deploy targets:

- `script/` contains the Google Apps Script backend, admin RPC endpoints, refresh/publish pipeline, Firebase integration, and the Apps Script HTML shells.
- `cloudflarePages/` contains the public site, static admin/console shells, Cloudflare Worker routing, and the browser-side UI logic.

The app supports live roster syncing, regular-war and CWL tracking, player metrics/history capture, roster publishing, and public roster/leaderboard views.

## What Lives Where

### `script/`

- `entrypoints.gs`: Apps Script `doGet`/`doPost` entrypoints.
- `adminApi.gs`: admin RPC dispatcher used by the admin UI.
- `refreshEngine.gs`: refresh-all orchestration, rollback, and issue aggregation.
- `rosterSync.gs`: clan roster sync, lineup sync, and live ownership helpers.
- `warDomain.gs`: war aggregation, finalization, and repair logic.
- `metricsTracking.gs`: player metrics capture, normalization, and retention logic.
- `benchPlanner.gs`: CWL bench-planning and suggestion logic.
- `firebaseStore.gs`: published snapshot writes, archive handling, and Firebase transport.
- `Admin.html` / `Index.html`: Apps Script HTML shells.

### `cloudflarePages/`

- `index.html`: public shell for landing, rosters, and leaderboard views.
- `client.js`: public-facing roster/leaderboard client.
- `admin.html` / `console.html`: static admin shells.
- `admin.js`: admin-side UI logic.
- `generator.js`: spreadsheet import parsing and preview generation helpers.
- `public-config.js`: runtime configuration for the public/admin clients.
- `worker.js` / `_worker.js`: Cloudflare Worker routing and Apps Script admin proxy.
- `styles.css`: shared public/admin styling.

## High-Level Flow

1. Admin users work through the admin UI.
2. The admin UI calls Apps Script methods through the admin API bridge.
3. Apps Script refreshes roster data from Clash endpoints, updates metrics, and computes bench suggestions.
4. Publishing writes the active roster snapshot and public Firebase-facing data.
5. The public Cloudflare site hydrates from the published snapshot, with Firebase and asset-based fallbacks.

## Key Concepts

- `roster-data.json` is the active roster payload that the system refreshes and publishes.
- Refresh runs are step-based: pool sync, lineup sync, stats refresh, then bench suggestions.
- Regular-war and CWL rosters share infrastructure but differ in lineup/stat handling.
- Public pages are static assets; most dynamic behavior comes from the Apps Script backend and published data.

## Configuration

- Apps Script constants live in `script/config.gs`.
- Apps Script runtime secrets/settings are expected in Script Properties.
- Public client defaults live in `cloudflarePages/public-config.js`.
- Cloudflare Worker config starts from `cloudflarePages/wrangler.example.toml`.

Important runtime values:

- `STATIC_ASSET_BASE_URL`: where Apps Script should send public/admin asset traffic.
- `ROSTER_FIREBASE_DB_URL`: public Firebase database URL for hydration.
- `ROSTER_BASE_URL`: Apps Script base URL used as a backend source.
- `ROSTER_APPS_SCRIPT_URL`: optional Worker override for the Apps Script admin bridge.

## Development Notes

- There is no build step in this repository; the checked-in HTML/CSS/JS files are the deployable assets.
- Keep `script/` and `cloudflarePages/` behavior aligned when changing shared admin/public flows.
- `cloudflarePages/assets/` contains static media and icons, not source code.

## Deployment Outline

1. Deploy `script/` as a Google Apps Script web app.
2. Set the required Apps Script properties and asset base URL.
3. Deploy `cloudflarePages/` with its static assets and Worker entrypoint.
4. Point the Worker at the correct Apps Script deployment if you are not using the embedded fallback URL.
5. Fill production values in `cloudflarePages/public-config.js` or inject them at runtime.

## License

See `LICENSE`.
