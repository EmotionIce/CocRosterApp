# Cross-clan player-war tracking v2

## Data ownership

The system deliberately separates three concepts:

- Canonical membership remains in exactly one roster's `main`, `subs`, or
  `missing` collection. Existing duplicate-tag validation remains authoritative.
- Active participation is the roster-local `publicLineupProjection`. It is
  derived from the prefetched war snapshot before membership reconciliation and
  may therefore contain a player whose canonical roster is elsewhere.
- Historical performance is global and tag-keyed. Detailed events are private
  under `private/playerWarEventLedger`; the compact read model is the immutable
  active-version shard `playerWarPerformance`.

Roster workers can only produce sanitized event candidates. The serialized
coordinator reads the current private ledger records, deterministically selects
event revisions, applies the exact negative old delta and positive new delta,
and atomically writes the ledger revisions, canonical private compact checkpoint
at `private/playerWarPerformance/current`, immutable-run read model, and
completion checkpoint with one Firebase multi-location update. A later run
starts from the private checkpoint, so a publication failure after event
deduplication cannot lose an already selected delta.

Stable event identity is:

- regular war: kind, normalized clan tag, and the existing stable war key;
- CWL: kind and normalized CWL war tag.

Equal-authority conflicts are retained in the private ledger and resolved by
completeness followed by content-hash order. Repeated candidates with the
selected content hash are idempotent.

## Projection lifecycle

An authoritative in-war snapshot creates or refreshes a projection. If the
CoC API temporarily fails or returns a private/inaccessible snapshot, the last
valid projection is retained with `stale: true` and error metadata. Only
authoritative lifecycle evidence such as `notInWar`, a completed war, or a CWL
group/round result clears it.

Public and admin views render projected cards. Admin projections are read-only;
when canonical placement is known, the card links to that roster. Both canonical
and projected cards resolve statistics from the same global tag entry after
cutover.

## Immutable publication

Firebase layout version 3 contains these required active-version shards:

1. `manifest`
2. `rosters`
3. `playerMetrics`
4. `playerWarPerformance`

The manifest records the required shard set, performance schema, entry count,
content hash, and rollout stage. The active pointer is committed only after all
declared shards validate.

Cloudflare publishes the same generation as bounded immutable public and bot
objects. The shared selector is committed last. Hydration reads the manifest
first and never combines shards from different versions; incomplete current
generations fall back to the previous complete generation. Browsers and bots
load one compact global shard, never one object per player. Detailed ledger
records and migration plans are never public.

## Migration and rollout

All operations below are authenticated admin-bridge methods. The bridge request
shape remains `{ method, args }`, with the admin password as the final method
argument.

1. Deploy the Apps Script and Worker code while the stage remains `legacy`.
2. Call `dryRunPlayerWarTrackingMigration` with an optional
   `{ archiveLimit }`. Review its source inventory, fingerprints, checksum,
   classifications, warnings, and counts. This does not write migration data.
3. Call `stagePlayerWarTrackingMigration` with the same options. Record the
   returned `migrationId` and `checksum`. Staging writes a private plan but does
   not change the active version.
4. Explicitly call `commitPlayerWarTrackingMigration` with
   `{ migrationId, checksum, stage: "shadow" }`. Commit refuses stale source
   fingerprints and creates a new immutable generation.
5. Let the existing Cloudflare publish queue finish. Call
   `inspectPlayerWarTracking` to review the schema, content hash, counts, and
   bounded legacy/global shadow differences.
6. When the comparison is accepted, call
   `setPlayerWarTrackingRolloutStage` with `"cutover"`. A stage transition
   publishes another complete immutable generation; it never changes only a
   local flag.
7. To return consumers to schema-v1 reads without removing v2 data, call the
   stage method with `"legacy"`. To restore the pre-migration active generation,
   call `rollbackPlayerWarTrackingMigration` with `{ migrationId }`.

Rollback changes the active pointer and queues that exact previous generation.
It does not delete ledger data, staged plans, immutable versions, or source
archives.

## Legacy reconstruction policy

Migration discovers current active data plus retained publish and daily
auto-refresh archives. Regular-war history entries become stable candidates and
are deduplicated across copies. Explicit aggregate data not covered by exact
events is retained as a provenance-bearing baseline.

Legacy CWL aggregates generally cannot be losslessly divided into individual
war events. A segment is reconstructed only when two ordered archives show
exactly one newly processed war tag and every per-player aggregate delta is
monotonic. That proven delta becomes a `reconstructed` event and is subtracted
from the retained baseline. Repeated archive snapshots for the same tracked
clan are deduplicated, while explicit baselines from distinct tracked clans are
summed under the normalized player tag so cross-clan history is not discarded.
All other CWL evidence is classified as `ambiguous`, `partial`, or
`unrecoverable` and kept in the baseline/report; the migration never invents
war tags, attacks, or per-war outcomes.

## Diagnostics and recovery

- `inspectPlayerWarTracking` reports rollout stage, active version, schema,
  player/event/baseline/conflict counts, content hash, and shadow comparison.
- The existing queue inspection, one-tick execution, retry, repair, watchdog,
  continuation, stale-source, and rollback controls remain the recovery path.
- Projection records expose authoritative/stale timestamps and lifecycle reason
  without publishing private event details.
- Commit requires the exact staged checksum. A changed active fingerprint
  requires a new dry-run and stage.
