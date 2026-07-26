import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const followup = require("../cloudflarePages/war-followup.js");

const regularEvent = (id, at, clanTag, stats) => ({
  eventId: id,
  warKey: id,
  finalizedAt: at,
  clanTag,
  stats,
});

const buildRosterData = () => ({
  lastUpdatedAt: "2026-07-25T00:00:00.000Z",
  rosters: [{
    id: "main",
    title: "Main clan",
    connectedClanTag: "#MAIN",
    trackingMode: "regularWar",
    main: [
      { tag: "#P0LYGQ", name: "Player One", discord: "player-one", th: 17 },
      { tag: "#P0LYGJ", name: "Discord Gap", discord: "", th: 16 },
    ],
    subs: [],
    missing: [{ tag: "#P0LYGR", name: "Missing Member", discord: "", th: 15 }],
  }, {
    id: "training",
    title: "Hero-down clan",
    connectedClanTag: "#TRAIN",
    trackingMode: "regularWar",
    main: [],
    subs: [],
    missing: [],
  }],
  playerMetrics: { byTag: {} },
  playerWarPerformance: {
    updatedAt: "2026-07-25T00:00:00.000Z",
    byTag: {
      "#P0LYGQ": {
        recentRegularWarForm: [
          regularEvent("rw-2", "2026-07-24T00:00:00.000Z", "#MAIN", {
            possibleAttacks: 2, usedAttacks: 1, attacksMade: 1, attacksMissed: 1,
            countedAttacks: 1, starsTotal: 1, totalDestruction: 54,
          }),
          regularEvent("rw-1", "2026-07-20T00:00:00.000Z", "#MAIN", {
            possibleAttacks: 2, usedAttacks: 1, attacksMade: 1, attacksMissed: 1,
            countedAttacks: 1, starsTotal: 1, totalDestruction: 60,
          }),
        ],
        cwlSeasonContext: {
          bySeason: {
            "2026-07": {
              finalizedEventIds: ["cwl-war-1"],
              stats: {
                possibleAttacks: 2, usedAttacks: 1, attacksMade: 1, attacksMissed: 1,
                countedAttacks: 1, starsTotal: 1, totalDestruction: 62,
              },
            },
          },
        },
      },
    },
  },
});

test("candidate signals use only regular-war and CWL evidence with conservative result thresholds", () => {
  const rosterData = buildRosterData();
  const work = followup.buildWorkItems(rosterData, {
    settings: {
      regularMissedThreshold: 2,
      regularPerformanceEnabled: true,
      regularMinimumAttacks: 2,
      regularAverageStarsThreshold: 1.8,
      regularAverageDestructionThreshold: 75,
      cwlMissedThreshold: 1,
      cwlPerformanceEnabled: true,
      cwlMinimumAttacks: 2,
    },
    cases: [],
  });
  const item = work.items.find((entry) => entry.tag === "#P0LYGQ");
  assert.ok(item);
  assert.equal(item.signalIds.every((id) => id.length < 120), true, "signal revisions must remain safe to persist");
  assert.deepEqual(
    item.signals.map((signal) => signal.reasonCode).sort(),
    ["cwl_missed", "regular_missed", "regular_performance"],
  );
  assert.equal(work.items.some((entry) => entry.tag === "#P0LYGR"), false, "missing roster rows must not be automatic candidates");
  assert.equal(item.signals.some((signal) => /fit|availability|declin/i.test(signal.reasonCode + signal.title)), false);

  const evidence = structuredClone(item.evidence);
  evidence.regular.totalDestruction = 190;
  const signals = followup.buildSignals(evidence, {
    regularMinimumAttacks: 2,
    regularAverageStarsThreshold: 1.8,
    regularAverageDestructionThreshold: 75,
    cwlPerformanceEnabled: false,
  });
  assert.equal(
    signals.some((signal) => signal.reasonCode === "regular_performance"),
    false,
    "one healthy result dimension must prevent an automatic performance signal",
  );
});

test("dismissed evidence stays closed until a genuinely new war revision appears", () => {
  const rosterData = buildRosterData();
  const initial = followup.buildWorkItems(rosterData, { settings: {}, cases: [] });
  const signalIds = initial.items.find((entry) => entry.tag === "#P0LYGQ").signalIds;
  const caseValue = {
    tag: "#P0LYGQ",
    status: "dismissed",
    dismissedSignalIds: signalIds,
    updatedAt: "2026-07-25T00:00:00.000Z",
  };
  const unchanged = followup.buildWorkItems(rosterData, { settings: {}, cases: [caseValue] });
  assert.equal(unchanged.items.find((entry) => entry.tag === "#P0LYGQ").status, "closed");

  rosterData.playerWarPerformance.byTag["#P0LYGQ"].recentRegularWarForm.unshift(
    regularEvent("rw-3", "2026-07-26T00:00:00.000Z", "#MAIN", {
      possibleAttacks: 2, usedAttacks: 0, attacksMade: 0, attacksMissed: 2,
    }),
  );
  const changed = followup.buildWorkItems(rosterData, { settings: {}, cases: [caseValue] });
  assert.equal(changed.items.find((entry) => entry.tag === "#P0LYGQ").status, "needs_review");
});

test("hero-down recovery counts consecutive clean regular wars only in the selected clan after the DM", () => {
  const evidence = {
    regularEvents: [
      { id: "before", at: "2026-07-01T00:00:00.000Z", clanTag: "#TRAIN", stats: { possibleAttacks: 2, usedAttacks: 2 } },
      { id: "clean-1", at: "2026-07-11T00:00:00.000Z", clanTag: "#TRAIN", stats: { possibleAttacks: 2, usedAttacks: 2 } },
      { id: "wrong-clan", at: "2026-07-12T00:00:00.000Z", clanTag: "#MAIN", stats: { possibleAttacks: 2, usedAttacks: 2 } },
      { id: "miss", at: "2026-07-13T00:00:00.000Z", clanTag: "#TRAIN", stats: { possibleAttacks: 2, usedAttacks: 1, missedAttacks: 1 } },
      { id: "clean-2", at: "2026-07-14T00:00:00.000Z", clanTag: "#TRAIN", stats: { possibleAttacks: 2, usedAttacks: 2 } },
      { id: "clean-3", at: "2026-07-15T00:00:00.000Z", clanTag: "#TRAIN", stats: { possibleAttacks: 2, usedAttacks: 2 } },
    ],
  };
  const progress = followup.buildRecoveryProgress({
    tag: "#P0LYGQ",
    status: "hero_down",
    recoveryStartedAt: "2026-07-10T00:00:00.000Z",
    targetClanTag: "#TRAIN",
    recoveryWarTarget: 2,
    requireNoMisses: true,
  }, evidence);
  assert.equal(progress.totalWars, 4);
  assert.equal(progress.completedWars, 2);
  assert.equal(progress.ready, true);
  assert.equal(progress.missedAttacks, 1);
});

test("decision DM states the exact evidence, clan handoff, and recovery requirement", () => {
  const text = followup.buildDmText({
    playerName: "Player One",
    sourceClan: "Main clan",
    targetClan: "Hero-down clan",
    recoveryWars: 3,
    reasonCodes: ["regular_missed", "cwl_performance"],
    evidence: {
      regular: { possibleAttacks: 8, usedAttacks: 6, missedAttacks: 2 },
      cwl: { countedAttacks: 5, starsTotal: 7, totalDestruction: 340 },
    },
  });
  assert.match(text, /2 of 8 available attacks/);
  assert.match(text, /5 CWL attacks/);
  assert.match(text, /Main clan/);
  assert.match(text, /Hero-down clan/);
  assert.match(text, /3 consecutive wars/);
});

test("Discord identity gaps remain optional and are available by roster group", () => {
  const directory = followup.buildPlayerDirectory(buildRosterData());
  const gaps = directory.players.filter((player) => !player.hasDiscord);
  assert.deepEqual(
    gaps.map((player) => [player.rosterTitle, player.name]),
    [["Main clan", "Discord Gap"], ["Main clan", "Missing Member"]],
  );
});
