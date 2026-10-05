import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const appScriptFiles = [
  "script/config.js",
  "script/cocApi.js",
  "script/rosterDomain.js",
  "script/warDomain.js",
  "script/playerWarTracking.js",
  "script/firebaseStore.js",
  "script/metricsTracking.js",
  "script/donationRefresh.js",
  "script/rosterSchema.js",
  "script/refreshEngine.js",
  "script/rosterSync.js",
  "script/benchPlanner.js",
  "script/seasonEvents.js",
  "script/cwlLeagueSignups.js",
  "script/cloudflarePublishQueue.js",
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
  ...(overrides.attackResults ? { attackResults: overrides.attackResults } : {}),
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

// Results are chronological here; production sanitization orders the newest first.
const resultsStats = (results, delta = 0, extra = {}) => cwlStats({
  resolvedWarDays: results.length, countedAttacks: results.filter((r) => r != null).length,
  attacksMade: results.filter((r) => r != null).length, missedAttacks: results.filter((r) => r == null).length,
  starsTotal: results.reduce((sum, r) => sum + (r || 0), 0), threeStarCount: results.filter((r) => r === 3).length,
  totalDestruction: results.reduce((sum, r) => sum + (r === 3 ? 100 : r == null ? 0 : 60), 0),
  attackResults: results.map((stars, i) => ({ warId: 'war-' + i, endedAt: '2026-07-' + String(i + 1).padStart(2, '0') + 'T00:00:00Z', stars: stars || 0, missed: stars == null, townHallDelta: delta, destruction: stars === 3 ? 100 : 60 })),
  ...extra,
});
const twoPlayerRoster = (mainStats, subStats, mainTh = 16, subTh = 16) => {
  const main = player(1, { th: mainTh }), sub = player(2, { th: subTh, isSub: true });
  return makeRoster({ main: [main], subs: [sub], cwlByTag: { [main.tag]: mainStats, [sub.tag]: subStats } });
};

test('healthy triple mains stay in after eight stars even when many substitutes need rewards', () => {
  const backend = loadBackend(), main = [], subs = [], cwlByTag = {};
  for (let i = 1; i <= 30; i++) { main.push(player(i, { th: 18 })); cwlByTag[tag(i)] = resultsStats([3, 3, 3]); }
  for (let i = 31; i <= 60; i++) { subs.push(player(i, { th: 16, isSub: true })); cwlByTag[tag(i)] = resultsStats([1, 1, 1, 1, 3]); }
  const started = Date.now();
  const r = runPlanner(backend, makeRoster({ main, subs, cwlByTag }));
  assert.deepEqual(plain(r.suggestions.pairs), []);
  assert.deepEqual(plain(r.suggestions.targetMainTags), main.map((p) => p.tag));
  assert.ok(Date.now() - started < 1500);
});

test('poor main at seven stars is replaced by excellent substitute regardless of reward deadline', () => {
  const r = runPlanner(loadBackend(), twoPlayerRoster(resultsStats([1, 1, 1, 1, 3]), resultsStats([3, 3, 3])));
  assert.equal(r.suggestions.pairs.length, 1);
  assert.equal(r.suggestions.pairs[0].reasonCode, 'poor_performance');
  assert.equal(r.suggestions.pairs[0].outTag, tag(1));
});

test('one confirmed miss overrides excellent historical performance and a negative score delta', () => {
  const backend = loadBackend();
  const roster = twoPlayerRoster(resultsStats([3, 3, 3, 3, 3, null]), resultsStats([2, 2, 2]));
  roster.warPerformance = { byTag: { [tag(1)]: { regular: wpStats({ possibleAttacks: 1000, usedAttacks: 1000, countedAttacks: 1000, starsTotal: 3000 }) } } };
  const r = runPlanner(backend, roster);
  assert.equal(r.suggestions.pairs.length, 1);
  assert.equal(r.suggestions.pairs[0].reasonCode, 'missed_attack');
  // Force a higher outgoing value to prove the replacement policy is independent of score gain.
  r.snapshot.playersByTag[tag(1)].lineupValue = 3;
  const plan = backend.solveSeasonLineupPlan_(r.snapshot, r.config);
  assert.ok(plan.pairs[0].scoreDelta < 0);
  assert.equal(plan.pairs[0].reasonCode, 'missed_attack');
});

test('confirmed misses are replaced without an arbitrary two-swap cap', () => {
  const backend = loadBackend(), main = [], subs = [], cwlByTag = {};
  for (let i = 1; i <= 5; i++) { main.push(player(i)); cwlByTag[tag(i)] = resultsStats([3, null]); }
  for (let i = 6; i <= 10; i++) { subs.push(player(i, { isSub: true })); cwlByTag[tag(i)] = resultsStats([2, 2]); }
  const r = runPlanner(backend, makeRoster({ main, subs, cwlByTag }));
  assert.equal(r.suggestions.pairs.length, 5);
  assert.equal(r.plan.missedAttackSwapCount, 5);
});

test('poor one-star performers can all be replaced without the marginal cap', () => {
  const main = [player(1), player(2), player(3), player(4)], subs = [player(5, { isSub: true }), player(6, { isSub: true }), player(7, { isSub: true }), player(8, { isSub: true })];
  const cwlByTag = {};
  for (const p of main) cwlByTag[p.tag] = resultsStats([1, 1]);
  for (const p of subs) cwlByTag[p.tag] = resultsStats([2, 2]);
  const r = runPlanner(loadBackend(), makeRoster({ main, subs, cwlByTag }));
  assert.equal(r.plan.performanceSwapCount, 4);
});

test('missed main stays when substitutes are incapable, much lower TH, or also missed', () => {
  for (const [subStats, th] of [[resultsStats([1, 1]), 16], [resultsStats([3, 3]), 12], [resultsStats([3, null]), 16], [resultsStats([3, 3]), 0]]) {
    const r = runPlanner(loadBackend(), twoPlayerRoster(resultsStats([3, null]), subStats, 16, th));
    assert.deepEqual(plain(r.suggestions.pairs), []);
    assert.deepEqual(plain(r.plan.unreplacedMissedAttackTags), [tag(1)]);
  }
});

test('a capable substitute two TH lower may replace a missed attacker', () => {
  const r = runPlanner(loadBackend(), twoPlayerRoster(resultsStats([3, null]), resultsStats([2, 2]), 18, 16));
  assert.equal(r.suggestions.pairs[0].reasonCode, 'missed_attack');
});

test('substitute matching preserves scarce TH replacements and prioritizes misses over poor attacks', () => {
  const main = [player(1, { th: 16 }), player(2, { th: 18 })];
  const subs = [player(3, { th: 16, isSub: true }), player(4, { th: 14, isSub: true })];
  const cwlByTag = { [tag(1)]: resultsStats([null]), [tag(2)]: resultsStats([null]), [tag(3)]: resultsStats([2, 2]), [tag(4)]: resultsStats([2, 2]) };
  const r = runPlanner(loadBackend(), makeRoster({ main, subs, cwlByTag }));
  assert.equal(r.plan.missedAttackSwapCount, 2);
  assert.equal(r.suggestions.pairs.find((pair) => pair.outTag === tag(2)).inTag, tag(3));
  cwlByTag[tag(1)] = resultsStats([1, 1]);
  const scarce = runPlanner(loadBackend(), makeRoster({ main, subs: [subs[0]], cwlByTag }));
  assert.equal(scarce.suggestions.pairs.length, 1);
  assert.equal(scarce.suggestions.pairs[0].outTag, tag(2));
});

test('pending current attack is never interpreted as a miss', () => {
  const r = runPlanner(loadBackend(), twoPlayerRoster(resultsStats([3, 3], 0, { currentWarAttackPending: 1 }), resultsStats([2, 2])));
  assert.deepEqual(plain(r.suggestions.pairs), []);
  assert.equal(r.snapshot.playersByTag[tag(1)].missedAttacks, 0);
});

test('one-star attacks have a much stronger effect than two-star attacks', () => {
  const b = loadBackend(), config = b.getBenchPlannerConfig_();
  const one = b.computeBenchAttackModel_(tag(1), resultsStats([1]), null, null, config);
  const two = b.computeBenchAttackModel_(tag(1), resultsStats([2]), null, null, config);
  assert.ok(two.performanceValue - one.performanceValue >= 1);
  assert.equal(one.poorPerformance, true);
  assert.equal(two.poorPerformance, false);
});

test('target difficulty softens hit-ups and penalizes equal or lower TH one-stars', () => {
  const b = loadBackend(), config = b.getBenchPlannerConfig_();
  const model = (delta) => b.computeBenchAttackModel_(tag(1), resultsStats([1], delta), null, null, config);
  assert.ok(model(-1).performanceValue < model(0).performanceValue);
  assert.ok(model(0).performanceValue < model(1).performanceValue);
  assert.ok(model(1).performanceValue < model(2).performanceValue);
  assert.equal(model(null).performanceValue, model(0).performanceValue);
  // An isolated difficult hit-up after good attacks should not trigger a weak-performance replacement.
  const r = runPlanner(b, twoPlayerRoster(resultsStats([3, 3, 1], 2), resultsStats([2, 2])));
  assert.equal(r.snapshot.playersByTag[tag(1)].poorPerformance, false);
  assert.deepEqual(plain(r.suggestions.pairs), []);
});

test('zero-star attacks are penalized more than one-star attacks', () => {
  const b = loadBackend(), c = b.getBenchPlannerConfig_();
  assert.ok(b.computeBenchAttackModel_(tag(1), resultsStats([0]), null, null, c).performanceValue < b.computeBenchAttackModel_(tag(1), resultsStats([1]), null, null, c).performanceValue);
});

test('recent decline matters more than an old bad attack and huge history stays capped', () => {
  const b = loadBackend(), c = b.getBenchPlannerConfig_();
  const history = { regular: wpStats({ possibleAttacks: 1000, usedAttacks: 1000, countedAttacks: 1000, starsTotal: 3000 }) };
  const recent = b.computeBenchAttackModel_(tag(1), resultsStats([3, 3, 1]), history, null, c);
  const old = b.computeBenchAttackModel_(tag(1), resultsStats([1, 3, 3]), history, null, c);
  assert.ok(recent.performanceValue < old.performanceValue);
  assert.equal(recent.historicalSampleWeight, 0.4);
});

test('unknown substitute is neutral and cannot displace an established good attacker', () => {
  const b = loadBackend();
  const r = runPlanner(b, twoPlayerRoster(resultsStats([3, 3, 3]), cwlStats(), 16, 18));
  assert.deepEqual(plain(r.suggestions.pairs), []);
  assert.equal(r.snapshot.playersByTag[tag(2)].expectedStarsPerAppearance, 2);
});

test('marginal upgrades are capped at two and require a meaningful improvement', () => {
  const main = [player(1), player(2), player(3)], subs = [player(4, { isSub: true }), player(5, { isSub: true }), player(6, { isSub: true })];
  const cwlByTag = {};
  main.forEach((p) => { cwlByTag[p.tag] = resultsStats([2, 2, 2]); });
  subs.forEach((p) => { cwlByTag[p.tag] = resultsStats([3, 3, 3]); });
  const roster = makeRoster({ main, subs, cwlByTag });
  const r = runPlanner(loadBackend(), roster);
  assert.equal(r.plan.marginalSwapCount, 2);
  assert.equal(r.suggestions.pairs.length, 2);
  const thresholded = runPlanner(loadBackend(), roster, {}, { meaningfulUpgradeMinGain: 999 });
  assert.deepEqual(plain(thresholded.suggestions.pairs), []);
});

test('estimated timing preserves confirmed performance replacements but suppresses marginal and reward swaps', () => {
  const b = loadBackend();
  const missed = runPlanner(b, twoPlayerRoster(resultsStats([3, null]), resultsStats([2, 2])), { estimated: true });
  assert.equal(missed.suggestions.pairs[0].reasonCode, 'missed_attack');
  const poor = runPlanner(b, twoPlayerRoster(resultsStats([1, 1]), resultsStats([2, 2])), { estimated: true });
  assert.equal(poor.suggestions.pairs[0].reasonCode, 'poor_performance');
  const marginal = runPlanner(b, twoPlayerRoster(resultsStats([2, 2]), resultsStats([3, 3])), { estimated: true });
  assert.deepEqual(plain(marginal.suggestions.pairs), []);
});

test('reward rotation is limited to one equivalent player and never loses material performance', () => {
  const main = [player(1), player(2), player(3)], subs = [player(4, { isSub: true }), player(5, { isSub: true }), player(6, { isSub: true })];
  const cwlByTag = {};
  main.forEach((p) => { cwlByTag[p.tag] = resultsStats([2, 2, 2, 2]); });
  subs.forEach((p) => { cwlByTag[p.tag] = resultsStats([2, 2, 2]); });
  const r = runPlanner(loadBackend(), makeRoster({ main, subs, cwlByTag }));
  assert.equal(r.suggestions.pairs.length, 1);
  assert.equal(r.plan.rewardRotationCount, 1);
  assert.equal(r.suggestions.pairs[0].reasonCode, 'reward_rotation');
  assert.ok(r.suggestions.pairs[0].scoreDelta >= -r.config.rewardRotationMaxLoss);
});

test('pending rewards and poor or missed substitutes cannot cause reward rotation', () => {
  const b = loadBackend();
  for (const stats of [resultsStats([2, 2, 2], 0, { currentWarAttackPending: 1 }), resultsStats([1, 1, 1, 1, 3]), resultsStats([3, 3, null])]) {
    const r = runPlanner(b, twoPlayerRoster(resultsStats([2, 2, 2, 2]), stats));
    assert.deepEqual(plain(r.suggestions.pairs), []);
  }
});

test('always-in and never-in are hard constraints even for missed attackers', () => {
  const main = [player(1, { excludeAsSwapTarget: true }), player(2)], subs = [player(3, { isSub: true, excludeAsSwapSource: true }), player(4, { isSub: true })];
  const cwlByTag = { [tag(1)]: resultsStats([3, 3]), [tag(2)]: resultsStats([3, 3]), [tag(3)]: resultsStats([null]) };
  const r = runPlanner(loadBackend(), makeRoster({ main, subs, cwlByTag }));
  assert.ok(r.suggestions.targetMainTags.includes(tag(3)));
  assert.equal(r.suggestions.targetMainTags.includes(tag(1)), false);
  assert.equal(r.suggestions.pairs[0].reasonCode, 'restriction_never_in');
});

test('conflicting restrictions, insufficient pool and no editable rounds produce a no-op', () => {
  const b = loadBackend();
  const conflict = runPlanner(b, makeRoster({ main: [player(1, { excludeAsSwapSource: true, excludeAsSwapTarget: true })] }));
  assert.equal(conflict.plan.invalidConstraints, true);
  assert.deepEqual(plain(conflict.suggestions.pairs), []);
  const roster = twoPlayerRoster(resultsStats([null]), resultsStats([3]));
  roster.badges.main = 3;
  assert.equal(runPlanner(b, roster).plan.invalidConstraints, true);
  const ended = runPlanner(b, twoPlayerRoster(resultsStats([null]), resultsStats([3])), { remainingEditableDays: 0 });
  assert.deepEqual(plain(ended.suggestions.pairs), []);
});

test('actual selected pairs deterministically explain the entire final delta', () => {
  const b = loadBackend(), main = [player(1), player(2), player(3)], subs = [player(4, { isSub: true }), player(5, { isSub: true }), player(6, { isSub: true })];
  const cwlByTag = {};
  main.forEach((p, i) => { cwlByTag[p.tag] = resultsStats(i === 0 ? [null] : [1, 1]); });
  subs.forEach((p) => { cwlByTag[p.tag] = resultsStats([2, 2]); });
  const roster = makeRoster({ main, subs, cwlByTag });
  const first = runPlanner(b, roster), second = runPlanner(b, roster);
  assert.deepEqual(plain(first.suggestions), plain(second.suggestions));
  assert.deepEqual(plain(first.suggestions.benchTags).sort(), plain(first.suggestions.pairs.map((p) => p.outTag)).sort());
  assert.deepEqual(plain(first.suggestions.swapInTags).sort(), plain(first.suggestions.pairs.map((p) => p.inTag)).sort());
  assert.equal(new Set(first.suggestions.pairs.map((p) => p.inTag)).size, 3);
  assert.equal(first.suggestions.pairs[0].reasonCode, 'missed_attack');
});

test('war ingestion preserves exact stars and TH difference; active pending attacks have no failure result', () => {
  const b = loadBackend();
  const war = { state: 'inWar', endTime: '20260702T000000.000Z', clan: { tag: '#P0L', members: [{ tag: tag(1), townHallLevel: 16, attacks: [{ stars: 1, defenderTag: tag(3), destructionPercentage: 60 }] }, { tag: tag(2), townHallLevel: 16, attacks: [] }] }, opponent: { tag: '#Y0L', members: [{ tag: tag(3), townHallLevel: 18 }] } };
  const active = b.buildCwlWarAggregateForClan_(war, '#P0L', null, tag(10));
  assert.equal(active[tag(1)].attackResults[0].stars, 1);
  assert.equal(active[tag(1)].attackResults[0].townHallDelta, 2);
  assert.equal(active[tag(2)].attackResults, undefined);
  war.state = 'warEnded';
  const ended = b.buildCwlWarAggregateForClan_(war, '#P0L', null, tag(10));
  assert.equal(ended[tag(2)].attackResults[0].missed, true);
  const coordinator = b.buildCwlRuntimeContributionFromWar_(war, tag(10), '#P0L', 'group', 0);
  const dest = {};
  b.mergeFilteredCwlAggregateByTag_(dest, coordinator.aggregateByTag, { [tag(1)]: true, [tag(2)]: true });
  assert.equal(dest[tag(1)].attackResults[0].townHallDelta, 2);
  assert.equal(dest[tag(2)].attackResults[0].missed, true);
});

test('cached settled contributions recover exact per-war results without refetching', () => {
  const b = loadBackend();
  const cached = b.sanitizeCwlRuntimeContribution_({ warTag: tag(10), clanTag: '#P0L', state: 'warEnded', endTime: '2026-07-01T00:00:00Z', aggregateByTag: { [tag(1)]: cwlStats({ starsTotal: 1, countedAttacks: 1, attacksMade: 1, resolvedWarDays: 1, hitUpCount: 1 }), [tag(2)]: cwlStats({ missedAttacks: 1, resolvedWarDays: 1 }) } });
  assert.equal(cached.aggregateByTag[tag(1)].attackResults[0].stars, 1);
  assert.equal(cached.aggregateByTag[tag(1)].attackResults[0].townHallDelta, 1);
  assert.equal(cached.aggregateByTag[tag(2)].attackResults[0].missed, true);
  const again = b.sanitizeCwlRuntimeContribution_(cached);
  assert.deepEqual(plain(cached), plain(again));
});

test('result lists are bounded, deduplicated, chronologically sorted and survive roster validation', () => {
  const b = loadBackend();
  const records = Array.from({ length: 12 }, (_, i) => ({ warId: 'war' + i, endedAt: '2026-07-' + String(i + 1).padStart(2, '0') + 'T00:00:00Z', stars: 1, townHallDelta: 0 }));
  records.push({ warId: 'bad', stars: 99 }, records[11]);
  const sanitized = b.sanitizeCwlAttackResults_(records);
  assert.equal(sanitized.length, 8);
  assert.equal(sanitized[0].warId, 'war11');
  const roster = makeRoster({ main: [player(1)], cwlByTag: { [tag(1)]: resultsStats([1, 2]) } });
  const data = b.validateRosterData_({ schemaVersion: 1, pageTitle: 'Roster', rosterOrder: ['main'], rosters: [roster] });
  assert.equal(data.rosters[0].cwlStats.byTag[tag(1)].attackResults.length, 2);
});

test('partial per-war evidence does not double-count aggregate stars or misses', () => {
  const b = loadBackend(), c = b.getBenchPlannerConfig_();
  const full = resultsStats([3, 1, null]);
  const partial = { ...full, attackResults: [full.attackResults[1]] };
  const model = b.computeBenchAttackModel_(tag(1), partial, null, null, c);
  assert.equal(model.missedAttacks, 1);
  assert.ok(model.expectedStarsPerAppearance <= 2);
  assert.equal(model.badAttackCount, 1);
  const aggregated = b.computeBenchAttackModel_(tag(1), { ...full, attackResults: undefined }, null, null, c);
  assert.equal(aggregated.badAttackCount, 1);
  assert.equal(aggregated.missedAttacks, 1);
});

test('global history excludes current-season CWL and contaminated roster history is ignored', () => {
  const b = loadBackend();
  const stats = wpStats({ possibleAttacks: 5, usedAttacks: 0, attacksMissed: 5 });
  const global = { stage: 'cutover', byTag: { [tag(1)]: { cwl: stats, cwlSeasonContext: { bySeason: { '2026-07': { stats } } } } } };
  const history = b.buildBenchHistoryContext_(makeRoster(), '2026-07', global);
  assert.equal(history.previousCwlByTag[tag(1)], undefined);
  const contaminated = b.buildBenchHistoryContext_(makeRoster({ warPerformance: { byTag: { [tag(1)]: { cwl: stats } }, cwlHistoryStatus: 'activeSeasonContaminated' } }), '2026-07');
  assert.equal(Object.keys(contaminated.previousCwlByTag).length, 0);
});

test('sanitization retains new diagnostics and drops obsolete reward scheduler metadata', () => {
  const b = loadBackend();
  const r = runPlanner(b, twoPlayerRoster(resultsStats([null]), resultsStats([1])));
  const summary = { ...r.summary.plannerSummary, selectedRewardPlayerTags: [tag(2)], optionalSwapCount: 20 };
  const saved = b.sanitizeRosterBenchSuggestions_({ updatedAt: '2026-07-03T00:00:00Z', algorithm: 'cwl_performance_swaps_v3', targetMainTags: r.plan.targetMainTags, plannerSummary: summary, configSnapshot: r.summary.configSnapshot, pairs: [{ outTag: tag(1), inTag: tag(2), reasonCode: 'missed_attack', scoreDelta: Infinity }] }, { [tag(1)]: true, [tag(2)]: true });
  assert.deepEqual(plain(saved.plannerSummary.unreplacedMissedAttackTags), [tag(1)]);
  assert.equal('selectedRewardPlayerTags' in saved.plannerSummary, false);
  assert.equal('optionalSwapCount' in saved.plannerSummary, false);
  assert.equal(saved.pairs[0].scoreDelta, undefined);
  assert.equal(saved.configSnapshot.oneStarPenalty, 1);
});

test('core runs end-to-end, persists suggestions and rollback restores them', () => {
  const b = loadBackend();
  const roster = twoPlayerRoster(resultsStats([3, null]), resultsStats([2, 2]));
  b.buildCwlSeasonContext_ = () => seasonContext();
  const data = { schemaVersion: 1, pageTitle: 'Roster', rosterOrder: ['main'], rosters: [roster] };
  const r = b.computeBenchSuggestionsCore_(data, 'main', {});
  assert.equal(r.algorithm, 'cwl_performance_swaps_v3');
  assert.equal(r.pairs[0].reasonCode, 'missed_attack');
  assert.equal(r.rosterData.rosters[0].benchSuggestions.plannerSummary.missedAttackSwapCount, 1);
  const rollback = b.snapshotRefreshStepRollbackState_(r.rosterData, 'main', false, false);
  r.rosterData.rosters[0].benchSuggestions = { benchTags: [] };
  b.restoreRefreshStepRollbackState_(r.rosterData, rollback);
  assert.equal(r.rosterData.rosters[0].benchSuggestions.pairs[0].reasonCode, 'missed_attack');
});

test('preparation ranking remains functional with its separate scorer', () => {
  const b = loadBackend(), hitUp = player(1), even = player(2);
  const roster = makeRoster({ subs: [hitUp, even], cwlByTag: { [hitUp.tag]: cwlStats({ starsTotal: 6, resolvedWarDays: 3, countedAttacks: 3, hitUpCount: 3, totalDestruction: 240 }), [even.tag]: cwlStats({ starsTotal: 6, resolvedWarDays: 3, countedAttacks: 3, totalDestruction: 240 }) } });
  assert.equal(b.buildCwlPreparationRanking_(roster).ranked[0].tag, hitUp.tag);
  assert.equal(typeof b.computeStrengthScore_, 'undefined');
  assert.equal(typeof b.optimizeRewardCompletionsExact_, 'undefined');
});

test('regular-war rosters and preparation mode still disable swap suggestions', () => {
  const b = loadBackend();
  for (const roster of [makeRoster({ main: [player(1)], trackingMode: 'regularWar' }), makeRoster({ main: [player(1)], prep: { enabled: true, rosterSize: 5, lockStateByTag: {}, assignedTagSet: {}, excludedTagSet: {} } })]) {
    const r = b.computeBenchSuggestionsCore_({ schemaVersion: 1, pageTitle: 'Roster', rosterOrder: ['main'], rosters: [roster] }, 'main', {});
    assert.deepEqual(plain(r.pairs), []);
  }
});
