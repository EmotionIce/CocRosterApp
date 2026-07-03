import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const repoRoot = new URL("../", import.meta.url);
const appScriptFiles = [
  "script/config.js",
  "script/cocApi.js",
  "script/rosterDomain.js",
  "script/warDomain.js",
  "script/firebaseStore.js",
  "script/metricsTracking.js",
  "script/donationRefresh.js",
  "script/rosterSchema.js",
  "script/refreshEngine.js",
  "script/rosterSync.js",
  "script/benchPlanner.js",
  "script/seasonEvents.js",
  "script/cwlLeagueSignups.js",
  "script/publishAndTriggers.js",
  "script/authAndLocks.js",
  "script/adminApi.js",
  "script/entrypoints.js",
  "script/legacyCompat.js",
  "script/debugTools.js",
  "script/assets.js",
];

const loadBackend = () => {
  const code = appScriptFiles
    .map((file) => fs.readFileSync(new URL("../" + file, import.meta.url), "utf8"))
    .join("\n");
  const context = {
    Buffer,
    Date,
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => "Etc/UTC" },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: () => null,
        setProperty() {},
        setProperties() {},
        deleteProperty() {},
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => true,
        waitLock() {},
        releaseLock() {},
      }),
    },
    Utilities: {
      getUuid: () => "test-uuid",
      sleep() {},
      newBlob(value) {
        const bytes = Array.isArray(value)
          ? Buffer.from(value)
          : Buffer.from(String(value ?? ""), "utf8");
        return {
          getBytes: () => Array.from(bytes),
          getDataAsString: () => bytes.toString("utf8"),
        };
      },
      base64EncodeWebSafe(bytes) {
        return Buffer.from(bytes || []).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
      },
      base64DecodeWebSafe(value) {
        let text = String(value ?? "").replace(/-/g, "+").replace(/_/g, "/");
        while (text.length % 4) text += "=";
        return Array.from(Buffer.from(text, "base64"));
      },
      formatDate(dateRaw, _timezone, format) {
        const date = dateRaw instanceof Date ? dateRaw : new Date(dateRaw);
        const iso = date.toISOString();
        if (format === "yyyy-MM-dd") return iso.slice(0, 10);
        if (format === "yyyy-MM") return iso.slice(0, 7);
        return iso;
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const plain = (value) => JSON.parse(JSON.stringify(value));

const tag = (index) => {
  const alphabet = "PYLQGRJCUV0289";
  let n = index;
  let out = "";
  for (let i = 0; i < 5; i++) {
    out += alphabet[n % alphabet.length];
    n = Math.floor(n / alphabet.length);
  }
  return "#" + out;
};

const player = (index, overrides = {}) => ({
  slot: overrides.isSub ? null : (overrides.slot ?? index),
  name: overrides.name || `Player ${index}`,
  discord: "",
  th: overrides.th ?? 16,
  tag: overrides.tag || tag(index),
  notes: [],
  excludeAsSwapTarget: !!overrides.excludeAsSwapTarget,
  excludeAsSwapSource: !!overrides.excludeAsSwapSource,
});

const cwlStats = (overrides = {}) => ({
  starsTotal: overrides.starsTotal ?? 0,
  daysInLineup: overrides.resolvedWarDays ?? overrides.daysInLineup ?? 0,
  resolvedWarDays: overrides.resolvedWarDays ?? 0,
  attacksMade: overrides.attacksMade ?? overrides.countedAttacks ?? 0,
  missedAttacks: overrides.missedAttacks ?? 0,
  threeStarCount: overrides.threeStarCount ?? 0,
  totalDestruction: overrides.totalDestruction ?? 0,
  countedAttacks: overrides.countedAttacks ?? 0,
  currentWarAttackPending: overrides.currentWarAttackPending ?? 0,
  hitUpCount: overrides.hitUpCount ?? 0,
  hitDownCount: overrides.hitDownCount ?? 0,
  sameThHitCount: overrides.sameThHitCount ?? 0,
});

const wpStats = (overrides = {}) => ({
  warsInLineup: overrides.warsInLineup ?? 0,
  daysInLineup: overrides.daysInLineup ?? 0,
  resolvedWarDays: overrides.resolvedWarDays ?? 0,
  possibleAttacks: overrides.possibleAttacks ?? 0,
  usedAttacks: overrides.usedAttacks ?? overrides.attacksMade ?? 0,
  attacksMade: overrides.attacksMade ?? overrides.usedAttacks ?? 0,
  attacksMissed: overrides.attacksMissed ?? 0,
  starsTotal: overrides.starsTotal ?? 0,
  totalDestruction: overrides.totalDestruction ?? 0,
  countedAttacks: overrides.countedAttacks ?? 0,
  formEligibleAttacks: overrides.formEligibleAttacks ?? overrides.countedAttacks ?? 0,
  threeStarCount: overrides.threeStarCount ?? 0,
  hitUpCount: overrides.hitUpCount ?? 0,
  sameThHitCount: overrides.sameThHitCount ?? 0,
  hitDownCount: overrides.hitDownCount ?? 0,
});

const makeRoster = ({ main = [], subs = [], missing = [], cwlByTag = {}, warPerformance = null, trackingMode = "cwl", prep = null } = {}) => ({
  id: "main",
  title: "Main",
  connectedClanTag: "#P0L",
  trackingMode,
  badges: { main: main.length, subs: subs.length, missing: missing.length },
  main,
  subs,
  missing,
  cwlStats: { season: "2026-07", lastRefreshedAt: "2026-07-03T00:00:00.000Z", byTag: cwlByTag },
  ...(warPerformance ? { warPerformance } : {}),
  ...(prep ? { cwlPreparation: prep } : {}),
});

const seasonContext = (overrides = {}) => ({
  source: overrides.estimated ? "stats_estimate" : "leaguegroup",
  contextSource: overrides.estimated ? "stats_estimate" : "leaguegroup",
  estimated: !!overrides.estimated,
  season: overrides.season || "2026-07",
  totalSeasonDays: overrides.totalSeasonDays ?? 7,
  completedDays: overrides.completedDays ?? 0,
  lockedDays: overrides.lockedDays ?? 0,
  remainingEditableDays: overrides.remainingEditableDays ?? 1,
  nextEditableDayIndex: overrides.nextEditableDayIndex ?? 0,
  roundStates: overrides.roundStates || ["editable"],
  warnings: overrides.estimated ? ["season-context-estimated"] : [],
});

const runPlanner = (backend, roster, ctxOverrides = {}, configOverrides = {}) => {
  const config = Object.assign(backend.getBenchPlannerConfig_(), configOverrides);
  const snapshot = backend.buildCwlPlanningSnapshot_(roster, seasonContext(ctxOverrides), config);
  const plan = backend.solveSeasonLineupPlan_(snapshot, config);
  const suggestions = backend.deriveNextDaySwapSuggestionsFromPlan_(roster, plan, snapshot, config);
  const summary = backend.buildBenchSuggestionSummary_(roster, plan, suggestions, snapshot, config);
  return { config, snapshot, plan, suggestions, summary };
};

test("realistic 30v30 planning uses exact v2 DP without fallback", () => {
  const backend = loadBackend();
  const main = [];
  const subs = [];
  const cwlByTag = {};
  for (let i = 1; i <= 30; i++) {
    const p = player(i, { th: 18, slot: i });
    main.push(p);
    cwlByTag[p.tag] = cwlStats({ starsTotal: 8, resolvedWarDays: 3, attacksMade: 3, countedAttacks: 3, threeStarCount: 2, totalDestruction: 285 });
  }
  for (let i = 31; i <= 60; i++) {
    const p = player(i, { th: 16, isSub: true });
    subs.push(p);
    cwlByTag[p.tag] = cwlStats({ starsTotal: 7, resolvedWarDays: 3, attacksMade: 3, countedAttacks: 3, threeStarCount: 3, totalDestruction: 300 });
  }
  const started = Date.now();
  const result = runPlanner(backend, makeRoster({ main, subs, cwlByTag }), { remainingEditableDays: 1 });
  const elapsedMs = Date.now() - started;

  assert.equal(result.plan.solverMode, "exact_bounded_dp");
  assert.equal(result.suggestions.swapInTags.length, 30);
  assert.equal(result.summary.plannerSummary.selectedRewardPlayerTags.length, 30);
  assert.equal(result.plan.warnings.some((warning) => /fallback/i.test(warning)), false);
  assert.ok(elapsedMs < 1500, `30v30 planner took ${elapsedMs}ms`);
});

test("a feasible one-appearance reward beats a stronger impossible reward", () => {
  const backend = loadBackend();
  const done = player(1, { th: 18 });
  const feasible = player(2, { th: 14, isSub: true });
  const impossible = player(3, { th: 18, isSub: true });
  const roster = makeRoster({
    main: [done],
    subs: [feasible, impossible],
    cwlByTag: {
      [done.tag]: cwlStats({ starsTotal: 8, resolvedWarDays: 3, attacksMade: 3, countedAttacks: 3, threeStarCount: 3, totalDestruction: 300 }),
      [feasible.tag]: cwlStats({ starsTotal: 7, resolvedWarDays: 3, attacksMade: 3, countedAttacks: 3, threeStarCount: 3, totalDestruction: 300 }),
      [impossible.tag]: cwlStats({ starsTotal: 1, resolvedWarDays: 3, attacksMade: 3, countedAttacks: 3, threeStarCount: 3, totalDestruction: 300 }),
    },
  });
  const result = runPlanner(backend, roster, { remainingEditableDays: 1 });

  assert.deepEqual(plain(result.suggestions.swapInTags), [feasible.tag]);
  assert.equal(result.snapshot.playersByTag[impossible.tag].rewardStatus, "individually_impossible");
});

test("pending attacks reserve future appearances only when a triple cannot finish the reward", () => {
  const backend = loadBackend();
  const pendingSecure = player(1);
  const pendingNeedsFuture = player(2, { isSub: true });
  const roster = makeRoster({
    main: [pendingSecure],
    subs: [pendingNeedsFuture],
    cwlByTag: {
      [pendingSecure.tag]: cwlStats({ starsTotal: 5, currentWarAttackPending: 1 }),
      [pendingNeedsFuture.tag]: cwlStats({ starsTotal: 1, currentWarAttackPending: 1 }),
    },
  });
  const result = runPlanner(backend, roster, { remainingEditableDays: 2 });

  assert.equal(result.snapshot.playersByTag[pendingSecure.tag].rewardStatus, "pending_current_attack");
  assert.equal(result.snapshot.playersByTag[pendingSecure.tag].appearancesNeeded, 0);
  assert.ok(result.snapshot.playersByTag[pendingNeedsFuture.tag].appearancesNeeded > 0);
});

test("misses affect reliability and value, not conditional attack quality", () => {
  const backend = loadBackend();
  const clean = player(1);
  const missed = player(2, { isSub: true });
  const roster = makeRoster({
    main: [clean],
    subs: [missed],
    cwlByTag: {
      [clean.tag]: cwlStats({ starsTotal: 3, resolvedWarDays: 1, attacksMade: 1, countedAttacks: 1, threeStarCount: 1, totalDestruction: 100 }),
      [missed.tag]: cwlStats({ starsTotal: 3, resolvedWarDays: 2, attacksMade: 1, missedAttacks: 1, countedAttacks: 1, threeStarCount: 1, totalDestruction: 100 }),
    },
  });
  const result = runPlanner(backend, roster, { remainingEditableDays: 2 }, { optionalSwapMinScoreDelta: 999 });
  const cleanModel = result.snapshot.playersByTag[clean.tag];
  const missedModel = result.snapshot.playersByTag[missed.tag];

  assert.equal(cleanModel.expectedStarsWhenUsed, missedModel.expectedStarsWhenUsed);
  assert.equal(cleanModel.expectedDestructionWhenUsed, missedModel.expectedDestructionWhenUsed);
  assert.ok(missedModel.attackUseProbability < cleanModel.attackUseProbability);
  assert.ok(missedModel.lineupValue < cleanModel.lineupValue);
});

test("no-data quality uses optimistic triple prior and real attacks update it gradually", () => {
  const backend = loadBackend();
  const noData = backend.computeBenchAttackModel_(tag(1), cwlStats(), null, null, backend.getBenchPlannerConfig_());
  const oneBadAttack = backend.computeBenchAttackModel_(
    tag(2),
    cwlStats({ starsTotal: 1, resolvedWarDays: 1, attacksMade: 1, countedAttacks: 1, totalDestruction: 60 }),
    null,
    null,
    backend.getBenchPlannerConfig_(),
  );
  const withZeroAttackNeighbor = backend.computeBenchAttackModel_(tag(2), cwlStats({ starsTotal: 1, resolvedWarDays: 1, attacksMade: 1, countedAttacks: 1, totalDestruction: 60 }), null, null, backend.getBenchPlannerConfig_());

  assert.equal(noData.expectedStarsWhenUsed, 3);
  assert.equal(noData.expectedDestructionWhenUsed, 100);
  assert.equal(noData.threeStarProbability, 1);
  assert.ok(oneBadAttack.expectedStarsWhenUsed > 1 && oneBadAttack.expectedStarsWhenUsed < 3);
  assert.equal(withZeroAttackNeighbor.expectedStarsWhenUsed, oneBadAttack.expectedStarsWhenUsed);
});

test("always-in, never-in and conflicting restrictions are hard constraints", () => {
  const backend = loadBackend();
  const never = player(1, { th: 18, excludeAsSwapTarget: true });
  const keep = player(2, { th: 16 });
  const always = player(3, { th: 14, isSub: true, excludeAsSwapSource: true });
  const filler = player(4, { th: 13, isSub: true });
  const result = runPlanner(backend, makeRoster({ main: [never, keep], subs: [always, filler] }), { remainingEditableDays: 2 });
  assert.ok(result.suggestions.benchTags.includes(never.tag));
  assert.ok(result.suggestions.swapInTags.includes(always.tag));
  assert.ok(result.suggestions.targetMainTags.includes(always.tag));
  assert.equal(result.suggestions.targetMainTags.includes(never.tag), false);

  const both = player(5, { excludeAsSwapSource: true, excludeAsSwapTarget: true });
  const conflict = runPlanner(backend, makeRoster({ main: [both], subs: [] }), { remainingEditableDays: 1 });
  assert.equal(conflict.plan.invalidConstraints, true);
  assert.deepEqual(plain(conflict.suggestions.swapInTags), []);
});

test("estimated context suppresses optional swaps while exact context caps them at two and honors threshold", () => {
  const backend = loadBackend();
  const main = [player(1, { th: 10 }), player(2, { th: 10 }), player(3, { th: 10 })];
  const subs = [player(4, { th: 18, isSub: true }), player(5, { th: 18, isSub: true }), player(6, { th: 18, isSub: true })];
  const cwlByTag = {};
  for (const p of main.concat(subs)) cwlByTag[p.tag] = cwlStats({ starsTotal: 8, resolvedWarDays: 1, attacksMade: 1, countedAttacks: 1, threeStarCount: 1, totalDestruction: 100 });
  const roster = makeRoster({ main, subs, cwlByTag });

  const estimated = runPlanner(backend, roster, { remainingEditableDays: 2, estimated: true });
  assert.deepEqual(plain(estimated.suggestions.swapInTags), []);
  assert.ok(estimated.plan.warnings.includes("optional-swaps-suppressed-estimated-context"));

  const exact = runPlanner(backend, roster, { remainingEditableDays: 2 });
  assert.equal(exact.suggestions.swapInTags.length, 2);
  assert.ok(exact.suggestions.pairs.every((pair) => pair.optional === true));

  const thresholded = runPlanner(backend, roster, { remainingEditableDays: 2 }, { optionalSwapMinScoreDelta: 999 });
  assert.deepEqual(plain(thresholded.suggestions.swapInTags), []);
});

test("exact season context returns the real zero-based next editable round index", () => {
  const backend = loadBackend();
  const clanTag = "#P0L";
  const context = backend.buildCwlSeasonContext_(
    { connectedClanTag: clanTag, cwlStats: { season: "2026-07", byTag: {} } },
    backend.getBenchPlannerConfig_(),
    {
      prefetchedLeaguegroupRawByClanTag: {
        [clanTag]: {
          season: "2026-07",
          rounds: [{ warTags: [tag(10)] }, { warTags: [tag(11)] }, { warTags: [tag(12)] }],
        },
      },
      prefetchedCwlWarRawByTag: {
        [tag(10)]: { state: "warEnded", clan: { tag: clanTag, members: [] }, opponent: { tag: "#Y0L", members: [] } },
        [tag(11)]: { state: "inWar", clan: { tag: clanTag, members: [] }, opponent: { tag: "#Y0L", members: [] } },
        [tag(12)]: { state: "preparation", clan: { tag: clanTag, members: [] }, opponent: { tag: "#Y0L", members: [] } },
      },
    },
  );

  assert.equal(context.nextEditableDayIndex, 2);
  assert.deepEqual(plain(context.roundStates), ["completed", "locked", "editable"]);
  assert.equal(context.estimated, false);
});

test("shared capacity blocks feasible rewards and selected rewards remain schedulable", () => {
  const backend = loadBackend();
  const a = player(1, { th: 18 });
  const b = player(2, { th: 14, isSub: true });
  const roster = makeRoster({
    main: [a],
    subs: [b],
    cwlByTag: {
      [a.tag]: cwlStats({ starsTotal: 7, resolvedWarDays: 1, attacksMade: 1, countedAttacks: 1, threeStarCount: 1, totalDestruction: 100 }),
      [b.tag]: cwlStats({ starsTotal: 7, resolvedWarDays: 1, attacksMade: 1, countedAttacks: 1, threeStarCount: 1, totalDestruction: 100 }),
    },
  });
  const result = runPlanner(backend, roster, { remainingEditableDays: 1 }, { optionalSwapMinScoreDelta: 999 });
  const blockedTag = result.plan.selectedRewardTags.includes(a.tag) ? b.tag : a.tag;

  assert.equal(result.plan.rewardStatusByTag[blockedTag], "feasible_shared_capacity_blocked");
  assert.equal(backend.isNextLineupScheduleFeasible_(result.snapshot, { requiredAppearancesByTag: result.plan.startCountsByTag }, backend.listToTagSet_(result.suggestions.targetMainTags)), true);
});

test("minimum churn retains current mains when no reward, restriction or meaningful upgrade exists", () => {
  const backend = loadBackend();
  const main = [player(1, { th: 16 }), player(2, { th: 16 })];
  const subs = [player(3, { th: 16, isSub: true }), player(4, { th: 16, isSub: true })];
  const cwlByTag = {};
  for (const p of main.concat(subs)) cwlByTag[p.tag] = cwlStats({ starsTotal: 8 });
  const result = runPlanner(backend, makeRoster({ main, subs, cwlByTag }), { remainingEditableDays: 3 }, { optionalSwapMinScoreDelta: 999 });

  assert.deepEqual(plain(result.suggestions.targetMainTags), main.map((p) => p.tag));
  assert.deepEqual(plain(result.suggestions.pairs), []);
});

test("current-season CWL aggregate is not double-counted and active-season migration ignores unproven CWL history", () => {
  const backend = loadBackend();
  const p = player(1);
  const contaminatedAggregate = wpStats({ possibleAttacks: 10, usedAttacks: 1, attacksMade: 1, attacksMissed: 9, countedAttacks: 1, starsTotal: 3, totalDestruction: 100, threeStarCount: 1 });
  const cleanWarPerformance = {
    byTag: { [p.tag]: { overall: contaminatedAggregate, regular: wpStats(), cwl: contaminatedAggregate } },
    cwlPreSeasonBaselineByTag: {},
    cwlPreSeasonBaselineSeason: "2026-07",
    cwlHistoryStatus: "cleanPreSeason",
  };
  const roster = makeRoster({
    main: [p],
    cwlByTag: { [p.tag]: cwlStats({ starsTotal: 3, resolvedWarDays: 1, attacksMade: 1, countedAttacks: 1, threeStarCount: 1, totalDestruction: 100 }) },
    warPerformance: cleanWarPerformance,
  });
  const result = runPlanner(backend, roster, { remainingEditableDays: 2 });
  assert.ok(result.snapshot.playersByTag[p.tag].attackUseProbability > 0.95);

  const migrated = clone(cleanWarPerformance);
  delete migrated.cwlPreSeasonBaselineByTag;
  delete migrated.cwlPreSeasonBaselineSeason;
  delete migrated.cwlHistoryStatus;
  const ensured = backend.ensureCwlPreSeasonBaselineForSeason_(migrated, "2026-07", roster.cwlStats, "2026-07-03T00:00:00.000Z");
  assert.equal(ensured.status, "activeSeasonContaminated");
  assert.equal(Object.keys(migrated.cwlPreSeasonBaselineByTag).length, 0);
});

test("bench suggestion persistence sanitizes v2 metadata, rollback restores it, and history deletion prunes CWL baseline", () => {
  const backend = loadBackend();
  const p1 = player(1);
  const p2 = player(2, { isSub: true });
  const rosterData = {
    schemaVersion: 1,
    pageTitle: "Roster",
    rosterOrder: ["main"],
    rosters: [
      makeRoster({
        main: [p1],
        subs: [p2],
        warPerformance: {
          byTag: { [p1.tag]: { overall: wpStats(), regular: wpStats(), cwl: wpStats() } },
          cwlPreSeasonBaselineByTag: { [p1.tag]: wpStats({ possibleAttacks: 1, usedAttacks: 1, attacksMade: 1, countedAttacks: 1, starsTotal: 3 }) },
          cwlPreSeasonBaselineSeason: "2026-07",
          cwlHistoryStatus: "cleanPreSeason",
        },
      }),
    ],
    playerMetrics: { schemaVersion: 1, updatedAt: "2026-07-03T00:00:00.000Z", byTag: {} },
  };
  rosterData.rosters[0].benchSuggestions = {
    updatedAt: "2026-07-03T00:00:00.000Z",
    algorithm: "cwl_bench_exact_dp_v2",
    nextEditableDayIndex: 3,
    benchTags: [p1.tag, "#BADTAG"],
    swapInTags: [p2.tag],
    pairs: [{ outTag: p1.tag, inTag: p2.tag, reasonCode: "lineup_upgrade", scoreDelta: Number.POSITIVE_INFINITY, reliabilityDelta: 0.2, optional: true }],
    plannerSummary: {
      remainingEditableDays: 2,
      nextEditableDayIndex: 3,
      contextSource: "leaguegroup",
      selectedRewardPlayerTags: [p2.tag, "#BADTAG"],
      rewardStatusByTag: { [p2.tag]: "selected_projected_complete", "#BADTAG": "bad" },
      optimalTotalSlack: 999,
    },
  };
  const validated = backend.validateRosterData_(rosterData);
  const suggestions = validated.rosters[0].benchSuggestions;
  assert.deepEqual(plain(suggestions.benchTags), [p1.tag]);
  assert.equal("optimalTotalSlack" in suggestions.plannerSummary, false);
  assert.equal(suggestions.pairs[0].scoreDelta, undefined);
  assert.equal(suggestions.pairs[0].optional, true);

  const rollback = backend.snapshotRefreshStepRollbackState_(validated, "main", false, false);
  validated.rosters[0].benchSuggestions = { benchTags: [] };
  backend.restoreRefreshStepRollbackState_(validated, rollback);
  assert.deepEqual(plain(validated.rosters[0].benchSuggestions.benchTags), [p1.tag]);

  backend.pruneTagFromRosterTrackingState_(validated.rosters[0], p1.tag);
  assert.equal(validated.rosters[0].warPerformance.cwlPreSeasonBaselineByTag[p1.tag], undefined);
});

test("CWL preparation ranking still uses the legacy scorer, not bench-specific scoring", () => {
  const backend = loadBackend();
  const hitUp = player(1, { th: 16 });
  const noHitUp = player(2, { th: 16 });
  const roster = makeRoster({
    main: [],
    subs: [hitUp, noHitUp],
    cwlByTag: {
      [hitUp.tag]: cwlStats({ starsTotal: 6, resolvedWarDays: 3, attacksMade: 3, countedAttacks: 3, hitUpCount: 3, totalDestruction: 240 }),
      [noHitUp.tag]: cwlStats({ starsTotal: 6, resolvedWarDays: 3, attacksMade: 3, countedAttacks: 3, hitUpCount: 0, totalDestruction: 240 }),
    },
  });
  const ranking = backend.buildCwlPreparationRanking_(roster);

  assert.equal(ranking.ranked[0].tag, hitUp.tag);
  assert.ok(Object.prototype.hasOwnProperty.call(ranking.ranked[0].strengthComponents, "hitUpAbility"));
});

test("target lineup and pairing are deterministic and pairs exactly explain the final delta", () => {
  const backend = loadBackend();
  const a = player(1, { th: 15 });
  const b = player(2, { th: 14 });
  const c = player(3, { th: 18, isSub: true });
  const d = player(4, { th: 17, isSub: true });
  const cwlByTag = {
    [a.tag]: cwlStats({ starsTotal: 8 }),
    [b.tag]: cwlStats({ starsTotal: 8 }),
    [c.tag]: cwlStats({ starsTotal: 7 }),
    [d.tag]: cwlStats({ starsTotal: 7 }),
  };
  const roster = makeRoster({ main: [a, b], subs: [c, d], cwlByTag });
  const first = runPlanner(backend, roster, { remainingEditableDays: 1 });
  const second = runPlanner(backend, roster, { remainingEditableDays: 1 });

  assert.deepEqual(plain(first.suggestions.targetMainTags), plain(second.suggestions.targetMainTags));
  assert.deepEqual(plain(first.suggestions.pairs), plain(second.suggestions.pairs));
  const currentSet = new Set([a.tag, b.tag]);
  const targetSet = new Set(first.suggestions.targetMainTags);
  assert.deepEqual(plain(first.suggestions.benchTags).sort(), [...currentSet].filter((t) => !targetSet.has(t)).sort());
  assert.deepEqual(plain(first.suggestions.swapInTags).sort(), [...targetSet].filter((t) => !currentSet.has(t)).sort());
  assert.equal(first.suggestions.pairs.length, first.suggestions.swapInTags.length);
});

test("regular-war rosters and CWL Preparation Mode still disable bench suggestions", () => {
  const backend = loadBackend();
  const p = player(1);
  const regularData = {
    schemaVersion: 1,
    pageTitle: "Roster",
    rosterOrder: ["main"],
    rosters: [makeRoster({ main: [p], trackingMode: "regularWar" })],
    playerMetrics: { schemaVersion: 1, updatedAt: "2026-07-03T00:00:00.000Z", byTag: {} },
  };
  const regular = backend.computeBenchSuggestionsCore_(regularData, "main", {});
  assert.equal(regular.result.mode, "regularWar");
  assert.deepEqual(plain(regular.pairs), []);

  const prepData = clone(regularData);
  prepData.rosters[0].trackingMode = "cwl";
  prepData.rosters[0].cwlPreparation = { enabled: true, rosterSize: 5, lockStateByTag: {}, assignedTagSet: {}, excludedTagSet: {} };
  const prep = backend.computeBenchSuggestionsCore_(prepData, "main", {});
  assert.equal(prep.result.cwlPreparationBlocked, true);
  assert.deepEqual(plain(prep.pairs), []);
});
