# Deploy Checklist

This checklist is for swapping deployment from `script/` monolith to `script_modular/`.

## 1) Preflight Static Gate (required)

Run from `rosterApp/`:

```bash
python tools/verify_apps_script_migration.py
```

Expected result:
- `RESULT: PASS`
- `Snapshot drift (source->snapshot): 0`
- `runAdminApiMethod_ method surface match: YES`

If `RESULT` is `FAIL`, do not deploy.

## 2) Upload Completeness Gate (required)

Ensure the deployed Apps Script project contains all `script_modular/*.gs` files:

- `config.gs`
- `entrypoints.gs`
- `adminApi.gs`
- `assets.gs`
- `authAndLocks.gs`
- `firebaseStore.gs`
- `cocApi.gs`
- `metricsTracking.gs`
- `warDomain.gs`
- `rosterDomain.gs`
- `rosterSync.gs`
- `refreshEngine.gs`
- `publishAndTriggers.gs`
- `benchPlanner.gs`
- `rosterSchema.gs`
- `legacyCompat.gs`
- `debugTools.gs`

Also ensure non-server files are present and unchanged:
- `Admin.html`
- `Index.html`

## 3) Script Properties Gate (required)

Before cutover, confirm these Script Properties exist and are valid:

- `ADMIN_PW`
- `COC_API_TOKEN`
- `FIREBASE_DB_URL`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_TOKEN_URI`

Internal runtime properties (created/updated by app flows) include values like:
- `LAST_PUBLISH_MS`
- auto-refresh status keys
- lock/last-run metadata keys

## 4) Trigger Gate (required)

Ensure the project can create and run the handler:

- `autoRefreshActiveRosterTick`

After enabling auto-refresh in admin UI, confirm exactly one periodic trigger exists for this handler.

## 5) Smoke Tests After Deploy (required)

Run these in order against the deployed web app:

1. `GET` public route:
- no error
- redirect HTML returned as before

2. `GET ?page=admin`:
- admin page renders
- assets/URLs resolve

3. `POST` admin API invalid JSON:
- returns `{ ok:false, error: ... }`

4. `POST` `verifyAdminPassword`:
- wrong password fails
- correct password succeeds

5. `POST` `getRosterData` and `getPlayerProfile`:
- expected shape and auth behavior unchanged

6. `POST` `refreshAllRosters`:
- completes with same summary semantics
- no unexpected method/lock errors

7. `POST` `publishRosterData`:
- publish succeeds
- archive/meta updates happen

8. Enable auto-refresh and wait one interval tick:
- tick runs
- status fields update

9. Lock contention probe:
- start long refresh/publish flow
- second concurrent flow receives expected lock-busy behavior

## 6) Rollback Plan (required)

If any smoke test fails:
- stop cutover,
- redeploy previous monolithic `script/` version,
- keep modular candidate for debugging only.
