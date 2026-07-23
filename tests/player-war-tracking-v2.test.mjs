import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const files = [
  "script/config.js",
  "script/cocApi.js",
  "script/rosterDomain.js",
  "script/warDomain.js",
  "script/playerWarTracking.js",
  "script/firebaseStore.js",
  "script/rosterSync.js",
  "script/rosterSchema.js",
  "script/refreshEngine.js",
];

const loadBackend = () => {
  const code = files.map((file) => fs.readFileSync(new URL("../" + file, import.meta.url), "utf8")).join("\n");
  const context = {
    Logger: { log() {} },
    Utilities: { formatDate: (date) => new Date(date).toISOString().slice(0, 10) },
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
};

const stats = (stars, attacks = 1) => ({
  warsInLineup: 1,
  possibleAttacks: 2,
  usedAttacks: attacks,
  attacksMade: attacks,
  attacksMissed: 2 - attacks,
  starsTotal: stars,
  totalDestruction: stars * 30,
  countedAttacks: attacks,
  formEligibleAttacks: attacks,
  threeStarCount: stars === 3 ? 1 : 0,
});

test("central player-war finalizer is idempotent and applies exact old/new deltas", () => {
  const b = loadBackend();
  const tag = "#P2L9";
  const provisional = b.buildPlayerWarEventCandidate_({
    kind: "regular",
    warKey: "war-a",
    clanTag: "#CLANA",
    authoritative: false,
    complete: false,
    contributionsByTag: { [tag]: { stats: stats(1), form: stats(1) } },
  });
  const firstResolution = b.resolvePlayerWarEventCandidate_(null, provisional, "2026-07-01T00:00:00.000Z");
  const first = b.finalizePlayerWarEventCandidates_(null, [provisional], {
    persist: false,
    existingRecordsByEventId: {},
    nowIso: "2026-07-01T00:00:00.000Z",
    stage: "cutover",
  });
  assert.equal(first.acceptedCount, 1);
  assert.equal(first.store.byTag[tag].regular.starsTotal, 1);

  const duplicate = b.finalizePlayerWarEventCandidates_(first.store, [provisional], {
    persist: false,
    existingRecordsByEventId: { [provisional.eventId]: firstResolution.record },
    nowIso: "2026-07-01T00:01:00.000Z",
    stage: "cutover",
  });
  assert.equal(duplicate.acceptedCount, 0);
  assert.equal(duplicate.store.byTag[tag].regular.starsTotal, 1);

  const rebuiltAfterPublicationFailure = b.finalizePlayerWarEventCandidates_(null, [provisional], {
    persist: false,
    rebuildFromResolvedEvents: true,
    existingRecordsByEventId: { [provisional.eventId]: firstResolution.record },
    nowIso: "2026-07-01T00:01:30.000Z",
    stage: "cutover",
  });
  assert.equal(rebuiltAfterPublicationFailure.acceptedCount, 0);
  assert.equal(rebuiltAfterPublicationFailure.store.byTag[tag].regular.starsTotal, 1);

  const authoritative = b.buildPlayerWarEventCandidate_({
    kind: "regular",
    warKey: "war-a",
    clanTag: "#CLANA",
    authoritative: true,
    complete: true,
    contributionsByTag: { [tag]: { stats: stats(3), form: stats(3) } },
  });
  const upgraded = b.finalizePlayerWarEventCandidates_(duplicate.store, [authoritative], {
    persist: false,
    existingRecordsByEventId: { [authoritative.eventId]: firstResolution.record },
    nowIso: "2026-07-01T00:02:00.000Z",
    stage: "cutover",
  });
  assert.equal(upgraded.acceptedCount, 1);
  assert.equal(upgraded.store.byTag[tag].regular.starsTotal, 3);
  assert.equal(upgraded.store.byTag[tag].overall.starsTotal, 3);
  assert.equal(upgraded.store.byTag[tag].recentRegularWarForm.length, 1);
});

test("canonical move preserves history and active participation until authoritative completion", () => {
  const b = loadBackend();
  const tag = "#P2L9";
  const player = { slot: 1, name: "Mover", tag, th: 16, notes: [] };
  const rosterA = {
    id: "a",
    title: "Clan A",
    connectedClanTag: "#CLANA",
    trackingMode: "regularWar",
    main: [player],
    subs: [],
    missing: [],
    warPerformance: b.createEmptyRosterWarPerformance_(),
  };
  const rosterB = {
    id: "b",
    title: "Clan B",
    connectedClanTag: "#CLANB",
    trackingMode: "regularWar",
    main: [],
    subs: [],
    missing: [],
  };
  b.upsertRegularWarHistoryEntry_(rosterA.warPerformance, "old-war", { [tag]: stats(2) }, {
    authoritative: true,
    incomplete: false,
    formStatsByTag: { [tag]: stats(2) },
    nowIso: "2026-06-01T00:00:00.000Z",
  });
  const data = { rosters: [rosterA, rosterB] };
  b.deriveRosterProjectionProtectionFromPrefetch_(data, "a", {
    prefetchedCurrentRegularWarByClanTag: {
      "#CLANA": {
        state: "inWar",
        startTime: "20260701T000000.000Z",
        endTime: "20260702T000000.000Z",
        opponent: { tag: "#OPP" },
        participants: [{ tag, name: "Mover", townhallLevel: 16, mapPosition: 1 }],
      },
    },
  });
  assert.equal(rosterA.publicLineupProjection.active, true);
  assert.equal(rosterA.publicLineupProjection.players[0].tag, tag);

  rosterB.main.push({ ...player });
  b.evictOwnedSourceTagsFromOtherRosters_(data, "b", [tag], { [tag]: "b" });
  assert.equal(rosterA.main.length, 0);
  assert.equal(rosterB.main.length, 1);
  assert.ok(rosterA.warPerformance.regularWarHistoryByKey["old-war"].statsByTag[tag]);
  assert.ok(rosterA.warPerformance.byTag[tag]);
  assert.equal(rosterA.publicLineupProjection.players[0].tag, tag);

  b.deriveRosterProjectionProtectionFromPrefetch_(data, "a", {
    prefetchedCurrentRegularWarByClanTag: { "#CLANA": { state: "notInWar" } },
  });
  assert.equal(rosterA.publicLineupProjection.active, false);
  assert.equal(rosterB.main[0].tag, tag);
});

test("migration deduplicates regular events and preserves ambiguous CWL only as a baseline", () => {
  const b = loadBackend();
  const tag = "#P2L9";
  const wp = b.createEmptyRosterWarPerformance_();
  b.upsertRegularWarHistoryEntry_(wp, "old-war", { [tag]: stats(2) }, {
    authoritative: true,
    incomplete: false,
    formStatsByTag: { [tag]: stats(2) },
    nowIso: "2026-06-01T00:00:00.000Z",
  });
  wp.byTag[tag].cwl = b.sanitizeWarPerformanceStatsEntry_({ daysInLineup: 3, attacksMade: 3, starsTotal: 7, countedAttacks: 3 });
  const rosterData = {
    rosters: [{
      id: "a",
      title: "A",
      connectedClanTag: "#CLANA",
      main: [{ slot: 1, tag, name: "Mover", th: 16, notes: [] }],
      subs: [],
      missing: [],
      warPerformance: wp,
    }],
  };
  const plan = b.buildPlayerWarTrackingMigrationPlan_([
    { id: "active", rosterData },
    { id: "archive-copy", rosterData },
  ], { createdAt: "2026-07-01T00:00:00.000Z" });
  assert.equal(plan.report.eventCandidateCount, 2);
  assert.equal(plan.report.deduplicatedEventCount, 1);
  assert.equal(plan.report.classifications.ambiguous, 1);
  assert.match(plan.report.warnings[0], /no per-war CWL events were fabricated/i);

  const executed = b.executePlayerWarMigrationPlan_(plan, { persist: false, stage: "cutover" });
  assert.equal(executed.store.byTag[tag].regular.starsTotal, 2);
  assert.equal(executed.store.byTag[tag].cwl.starsTotal, 7);
  assert.equal(executed.store.meta.eventCount, 1);
  assert.equal(executed.store.meta.baselineCount, 1);
});

test("migration reconstructs only a single monotonic CWL archive segment and subtracts it from the baseline", () => {
  const b = loadBackend();
  const tag = "#P2L9";
  const makeSource = (id, updatedAt, processedWarTags, cwl) => ({
    id,
    rosterData: {
      lastUpdatedAt: updatedAt,
      rosters: [{
        id: "a",
        connectedClanTag: "#CLANA",
        main: [{ slot: 1, tag, name: "Mover", th: 16, notes: [] }],
        subs: [],
        missing: [],
        warPerformance: {
          lastFinalizedAt: updatedAt,
          processedCwlWarTags: Object.fromEntries(processedWarTags.map((warTag) => [warTag, true])),
          byTag: { [tag]: { cwl } },
        },
      }],
    },
  });
  const before = stats(2);
  const after = {
    warsInLineup: 2,
    possibleAttacks: 4,
    usedAttacks: 2,
    attacksMade: 2,
    attacksMissed: 2,
    starsTotal: 5,
    totalDestruction: 150,
    countedAttacks: 2,
    formEligibleAttacks: 2,
    threeStarCount: 1,
  };
  const plan = b.buildPlayerWarTrackingMigrationPlan_([
    makeSource("active", "2026-07-02T00:00:00.000Z", ["#WAR1", "#WAR2"], after),
    makeSource("archive-before", "2026-07-01T00:00:00.000Z", ["#WAR1"], before),
  ], { createdAt: "2026-07-03T00:00:00.000Z" });
  assert.equal(plan.report.reconstructedCwlSegmentCount, 1);
  assert.equal(plan.candidates.filter((candidate) => candidate.kind === "cwl").length, 1);
  const executed = b.executePlayerWarMigrationPlan_(plan, { persist: false, stage: "shadow" });
  assert.equal(executed.store.byTag[tag].cwl.starsTotal, 5);
  assert.equal(executed.store.meta.eventCount, 1);
  assert.equal(executed.store.meta.baselineCount, 1);
});

test("migration checksum survives Firebase empty-container elision between stage and commit", () => {
  const b = loadBackend();
  const tag = "#P2L9";
  const wp = b.createEmptyRosterWarPerformance_();
  b.upsertRegularWarHistoryEntry_(wp, "war-one", { [tag]: stats(3) }, {
    authoritative: true,
    incomplete: false,
    formStatsByTag: { [tag]: stats(3) },
    nowIso: "2026-07-01T00:00:00.000Z",
  });
  const plan = b.buildPlayerWarTrackingMigrationPlan_([{
    id: "active",
    rosterData: {
      rosters: [{
        id: "a",
        connectedClanTag: "#CLANA",
        main: [{ slot: 1, tag, name: "Mover", th: 16, notes: [] }],
        subs: [],
        missing: [],
        warPerformance: wp,
      }],
    },
  }], { createdAt: "2026-07-02T00:00:00.000Z" });
  const stripFirebaseEmpty = (value) => {
    if (Array.isArray(value)) {
      const items = value.map(stripFirebaseEmpty).filter((item) => item !== undefined);
      return items.length ? items : undefined;
    }
    if (value && typeof value === "object") {
      const out = {};
      for (const [key, child] of Object.entries(value)) {
        const stripped = stripFirebaseEmpty(child);
        if (stripped !== undefined) out[key] = stripped;
      }
      return Object.keys(out).length ? out : undefined;
    }
    return value;
  };
  const stagedRoundTrip = stripFirebaseEmpty(plan);
  assert.equal(plan.checksumVersion, 2);
  assert.equal(b.calculatePlayerWarMigrationChecksum_(stagedRoundTrip), plan.checksum);
  assert.doesNotThrow(() => b.executePlayerWarMigrationPlan_(stagedRoundTrip, {
    persist: false,
    stage: "shadow",
  }));
});

test("cross-clan move acceptance scenario finalizes once and immediately updates both contexts", () => {
  const b = loadBackend();
  const tag = "#P2L9";
  const oldEvent = b.buildPlayerWarEventCandidate_({
    kind: "regular",
    warKey: "war-old",
    clanTag: "#CLANA",
    authoritative: true,
    complete: true,
    observedAt: "2026-06-01T00:00:00.000Z",
    contributionsByTag: { [tag]: { stats: stats(2), form: stats(2) } },
  });
  const oldResolved = b.resolvePlayerWarEventCandidate_(null, oldEvent, "2026-06-01T00:00:00.000Z");
  const history = b.finalizePlayerWarEventCandidates_(null, [oldEvent], {
    persist: false,
    existingRecordsByEventId: {},
    stage: "cutover",
    nowIso: "2026-06-01T00:00:00.000Z",
  });
  const rosterA = {
    id: "a",
    title: "Clan A",
    connectedClanTag: "#CLANA",
    trackingMode: "regularWar",
    main: [],
    subs: [],
    missing: [],
    publicLineupProjection: {
      active: true,
      authoritative: true,
      stale: false,
      players: [{ tag, name: "Mover", canonicalRosterId: "b" }],
    },
  };
  const rosterB = {
    id: "b",
    title: "Clan B",
    connectedClanTag: "#CLANB",
    trackingMode: "regularWar",
    main: [{ slot: 1, tag, name: "Mover", th: 16, notes: [] }],
    subs: [],
    missing: [],
  };
  const contexts = { projectedA: rosterA.publicLineupProjection.players[0], canonicalB: rosterB.main[0] };
  assert.equal(contexts.projectedA.tag, contexts.canonicalB.tag);
  assert.deepEqual(history.store.byTag[contexts.projectedA.tag], history.store.byTag[contexts.canonicalB.tag]);

  const activeEvent = b.buildPlayerWarEventCandidate_({
    kind: "regular",
    warKey: "war-active",
    clanTag: "#CLANA",
    authoritative: true,
    complete: true,
    observedAt: "2026-07-02T00:00:00.000Z",
    contributionsByTag: { [tag]: { stats: stats(3), form: stats(3) } },
  });
  const finalized = b.finalizePlayerWarEventCandidates_(history.store, [activeEvent], {
    persist: false,
    existingRecordsByEventId: { [oldEvent.eventId]: oldResolved.record },
    stage: "cutover",
    nowIso: "2026-07-02T00:00:00.000Z",
  });
  const activeResolved = b.resolvePlayerWarEventCandidate_(null, activeEvent, "2026-07-02T00:00:00.000Z");
  const retried = b.finalizePlayerWarEventCandidates_(finalized.store, [activeEvent, activeEvent], {
    persist: false,
    existingRecordsByEventId: { [activeEvent.eventId]: activeResolved.record },
    stage: "cutover",
    nowIso: "2026-07-02T00:01:00.000Z",
  });
  assert.equal(finalized.acceptedCount, 1);
  assert.equal(retried.acceptedCount, 0);
  assert.equal(retried.store.byTag[tag].regular.starsTotal, 5);
  assert.equal(retried.store.byTag[tag].recentRegularWarForm.length, 2);
  assert.deepEqual(retried.store.byTag[contexts.projectedA.tag], retried.store.byTag[contexts.canonicalB.tag]);

  b.deriveRosterProjectionProtectionFromPrefetch_({ rosters: [rosterA, rosterB] }, "a", {
    prefetchedCurrentRegularWarByClanTag: { "#CLANA": { state: "notInWar" } },
  });
  assert.equal(rosterA.publicLineupProjection.active, false);
  assert.equal(rosterB.main[0].tag, tag);
});
