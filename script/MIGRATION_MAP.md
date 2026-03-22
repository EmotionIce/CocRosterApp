# Migration Map

This map reflects the modular placement of the current `script_legacy/Code.gs` logic into `script_modular/`.

## File Responsibilities

| File | Major Function Groups Placed Here |
| --- | --- |
| `config.gs` | All top-level constants, cache/version constants, Firebase path/version constants, auto-refresh constants, planner/static constants, harmless cache globals. |
| `entrypoints.gs` | `doGet`, `doPost`, admin payload parsing, JSON response shaping, redirect HTML/URL helpers, entrypoint-safe escaping helpers. |
| `adminApi.gs` | `runAdminApiMethod_` and current public callable wrappers (`getRosterData`, `verifyAdminPassword`, `getPlayerProfile`, `testClanConnection`, `refreshAllRosters`, `publishRosterData`, `getAutoRefreshSettings`, `setAutoRefreshEnabled`). |
| `assets.gs` | Static/media asset serving and URL helpers, league/townhall icon helpers, asset text cache helpers. |
| `authAndLocks.gs` | Admin password checks, publish cooldown helpers, single active-roster lock acquisition/lease/release/context helpers, lock-busy error helpers. |
| `firebaseStore.gs` | Firebase config/token/request helpers, active snapshot read/write/migration helpers, archive/meta helpers, roster payload write helpers, active-write timestamp helpers. |
| `cocApi.gs` | Clash API request/retry helpers, tag normalization/validation, clan/war/league transport and prefetch helpers, profile error normalization helpers. |
| `metricsTracking.gs` | Metrics snapshot sanitization, profile enrichment, capture flows, daily/monthly ledger updates, player metrics store lifecycle helpers. |
| `warDomain.gs` | War-performance data model/sanitizers, regular-war history/finalization/repair, aggregate rebuild/hydration, tracked membership lifecycle, CWL/regular stats derivation. |
| `rosterDomain.gs` | Generic roster data utilities, slot normalization/dedupe, CWL preparation ranking/rebalance, generic list/set helpers used across roster logic. |
| `rosterSync.gs` | Live roster sync ownership/source resolution, roster pool + lineup sync flows, refresh tracking/CWL/regular-war sync cores, clan-sync orchestration helpers. |
| `refreshEngine.gs` | Refresh pipeline orchestration (`runRosterRefreshPipelineCore_`), refresh-all prefetch/summary/ownership helpers, duplicate-tag diagnostics and error enrichment, refresh-all core orchestration. |
| `publishAndTriggers.gs` | Publish/auto-refresh orchestration internals, auto-refresh status summaries, trigger lifecycle helpers, periodic auto-refresh tick flow. |
| `benchPlanner.gs` | Bench planner config accessor + scoring, dynamic-programming optimizer, fallback planner paths, swap suggestion explanation builders. |
| `rosterSchema.gs` | Canonical roster payload sanitization/validation (`validateRosterData_`) and related sanitizers/counters. |
| `legacyCompat.gs` | Current legacy wrappers retained for compatibility (`readActiveRosterDataFromDrive_`, `readActiveRosterSnapshotFromDrive_`, `replaceActiveRosterDataFile_`, legacy Drive/file lookup wrappers). |
| `debugTools.gs` | Debug-oriented helpers (`listFirebaseDataDebugInfo_`, planner debug scenario generators). |

## Functions That Were Hard To Place Cleanly
- Public wrappers that trigger domain-heavy work (`refreshAllRosters`, `publishRosterData`, `getAutoRefreshSettings`, `setAutoRefreshEnabled`, `testClanConnection`) were kept in `adminApi.gs` to preserve current public surface clarity.
- They still call domain internals that now live in `refreshEngine.gs`, `publishAndTriggers.gs`, and `rosterSync.gs`.

## Intentional Tiny Compatibility Adjustments
- Top-level constants from multiple legacy locations were centralized into `config.gs` without renaming.
- Existing legacy compatibility wrappers remained as-is in `legacyCompat.gs`.
- Debug helper `listFirebaseDataDebugInfo_` is housed in `debugTools.gs` while still callable from `doGet` debug path.

## Refresh-All Consolidation Placement
- Transitional but live refresh-all consolidation logic from the current monolith was housed in `refreshEngine.gs` (prefetch bundle, shared pipeline, refresh-all orchestration helpers), preserving behavior.
- Single active-roster lock model remains in `authAndLocks.gs`; no removed per-roster lock subsystem was reintroduced.

## Unresolved Hotspots / Risks Before Cutover
- High cross-file coupling remains due Apps Script shared-global scope and large helper surface.
- War + sync + metrics interactions are still complex; behavior was preserved by moving function bodies with minimal edits rather than redesigning internals.
- Any future deployment swap should rerun `tools/verify_apps_script_migration.py` and perform runtime smoke tests for admin refresh-all/publish/auto-refresh paths.
