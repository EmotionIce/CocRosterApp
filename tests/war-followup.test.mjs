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
    regularWar: {
      currentWar: {
        state: "inWar",
        endTime: "20260727T203045.000Z",
      },
    },
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

test("follow-up dates always use compact international English formatting", () => {
  assert.equal(followup.formatDate("2026-07-04T12:00:00.000Z"), "04 Jul 2026");
  assert.equal(followup.formatDate("not-a-date"), "");
});

test("root UI snapshots keep their focus origin while an overlay or loader has focus", () => {
  const original = {
    openDetails: ["more"],
    focusKey: "card:#P0LYGQ",
    focusControlIndex: 7,
    hadFocus: true,
  };
  const preserved = followup.mergeRootUiSnapshot(original, {
    rootReady: false,
    openDetails: [],
    rootHadFocus: false,
    focusKey: "",
    focusControlIndex: -1,
  });
  assert.deepEqual(preserved, original);

  const refreshed = followup.mergeRootUiSnapshot(preserved, {
    rootReady: true,
    openDetails: ["filters"],
    rootHadFocus: false,
  });
  assert.deepEqual(refreshed, {
    openDetails: ["filters"],
    focusKey: "card:#P0LYGQ",
    focusControlIndex: 7,
    hadFocus: true,
  });
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

test("candidate signals fall back to finalized per-roster war history and current CWL data", () => {
  const rosterData = buildRosterData();
  delete rosterData.playerWarPerformance;
  const roster = rosterData.rosters[0];
  roster.warPerformance = {
    lastRefreshedAt: "2026-07-25T01:00:00.000Z",
    regularWarHistoryByKey: {
      "rw-old": {
        warKey: "rw-old",
        authoritative: true,
        finalizedAt: "2026-07-10T00:00:00.000Z",
        statsByTag: {
          "#P0LYGQ": {
            possibleAttacks: 2, usedAttacks: 2, attacksMade: 2, attacksMissed: 0,
            countedAttacks: 2, starsTotal: 6, totalDestruction: 200,
          },
        },
      },
      "rw-ignored": {
        warKey: "rw-ignored",
        authoritative: false,
        finalizedAt: "2026-07-25T00:00:00.000Z",
        statsByTag: {
          "#P0LYGQ": { possibleAttacks: 2, usedAttacks: 0, attacksMissed: 2 },
        },
      },
      "rw-recent": {
        warKey: "rw-recent",
        authoritative: true,
        finalizedAt: "2026-07-24T00:00:00.000Z",
        statsByTag: {
          "#P0LYGQ": {
            possibleAttacks: 2, usedAttacks: 0, attacksMade: 0, attacksMissed: 2,
            countedAttacks: 0, starsTotal: 0, totalDestruction: 0,
          },
        },
        formStatsByTag: {
          "#P0LYGQ": {
            countedAttacks: 0, starsTotal: 0, totalDestruction: 0,
          },
        },
      },
    },
  };
  roster.cwlStats = {
    season: "2026-07-03",
    lastRefreshedAt: "2026-07-25T02:00:00.000Z",
    byTag: {
      "#P0LYGQ": {
        resolvedWarDays: 4,
        attacksMade: 3,
        missedAttacks: 1,
        countedAttacks: 3,
        starsTotal: 4,
        totalDestruction: 205,
      },
    },
  };

  const work = followup.buildWorkItems(rosterData, {
    settings: {
      regularLookbackWars: 1,
      regularMissedThreshold: 2,
      regularPerformanceEnabled: false,
      cwlMissedThreshold: 1,
      cwlPerformanceEnabled: true,
      cwlMinimumAttacks: 3,
      cwlAverageStarsThreshold: 1.8,
      cwlAverageDestructionThreshold: 75,
    },
    cases: [],
  });
  const item = work.items.find((entry) => entry.tag === "#P0LYGQ");
  assert.ok(item, "the production-shaped roster data must create moderation work");
  assert.deepEqual(
    item.signals.map((signal) => signal.reasonCode).sort(),
    ["cwl_missed", "cwl_performance", "regular_missed"],
  );
  assert.equal(item.evidence.regularEvents.length, 1, "the configured recent-war window must be respected");
  assert.equal(item.evidence.regularEvents[0].id, "rw-recent");
  assert.equal(item.evidence.regularEvents[0].clanTag, "#MAIN", "recovery evidence must retain its roster clan");
  assert.equal(item.evidence.cwl.possibleAttacks, 4);
  assert.equal(item.evidence.cwl.warCount, 4);
  assert.equal(item.evidence.cwlEvents[0].id, "cwl:2026-07-03");
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

test("dismissed evidence stays closed when refresh promotes the same wars into the canonical ledger", () => {
  const fallbackData = buildRosterData();
  const canonicalEntry = structuredClone(fallbackData.playerWarPerformance.byTag["#P0LYGQ"]);
  delete fallbackData.playerWarPerformance;
  fallbackData.rosters[0].warPerformance = {
    lastRefreshedAt: "2026-07-25T01:00:00.000Z",
    regularWarHistoryByKey: Object.fromEntries(
      canonicalEntry.recentRegularWarForm.map((event) => [event.warKey, {
        warKey: event.warKey,
        authoritative: true,
        finalizedAt: event.finalizedAt,
        statsByTag: { "#P0LYGQ": structuredClone(event.stats) },
        formStatsByTag: { "#P0LYGQ": structuredClone(event.stats) },
      }]),
    ),
  };
  const cwlStats = canonicalEntry.cwlSeasonContext.bySeason["2026-07"].stats;
  fallbackData.rosters[0].cwlStats = {
    season: "2026-07",
    lastRefreshedAt: "2026-07-25T01:00:00.000Z",
    byTag: {
      "#P0LYGQ": Object.assign({ resolvedWarDays: 1 }, structuredClone(cwlStats)),
    },
  };

  const settings = {
    regularPerformanceEnabled: true,
    regularMinimumAttacks: 2,
    cwlPerformanceEnabled: false,
  };
  const fallback = followup.buildWorkItems(fallbackData, { settings, cases: [] });
  const fallbackItem = fallback.items.find((entry) => entry.tag === "#P0LYGQ");
  assert.ok(fallbackItem);

  const dismissedCase = {
    tag: fallbackItem.tag,
    status: "dismissed",
    dismissedSignalIds: fallbackItem.signals.map((signal) => signal.legacyIds[0] || signal.id),
    updatedAt: "2026-07-25T02:00:00.000Z",
  };
  const canonicalData = buildRosterData();
  canonicalData.playerWarPerformance.updatedAt = "2026-07-26T00:00:00.000Z";
  for (const event of canonicalData.playerWarPerformance.byTag["#P0LYGQ"].recentRegularWarForm) {
    event.eventId = "ledger-event-" + event.warKey;
  }
  const promoted = followup.buildWorkItems(canonicalData, {
    settings,
    cases: [dismissedCase],
  });
  assert.equal(
    promoted.items.find((entry) => entry.tag === "#P0LYGQ").status,
    "closed",
    "a refresh source promotion must not masquerade as a new war",
  );
});

test("dismissals saved with canonical ledger event ids remain closed after identity normalization", () => {
  const rosterData = buildRosterData();
  for (const event of rosterData.playerWarPerformance.byTag["#P0LYGQ"].recentRegularWarForm) {
    event.eventId = "legacy-ledger-" + event.warKey;
  }
  const initial = followup.buildWorkItems(rosterData, {
    settings: { regularMinimumAttacks: 2 },
    cases: [],
  });
  const item = initial.items.find((entry) => entry.tag === "#P0LYGQ");
  const legacySignalIds = item.signals.map((signal) => signal.legacyIds[0] || signal.id);
  assert.equal(
    item.signals.some((signal) => signal.reasonCode.indexOf("regular_") === 0 && signal.legacyIds.length > 0),
    true,
  );

  const rebuilt = followup.buildWorkItems(rosterData, {
    settings: { regularMinimumAttacks: 2 },
    cases: [{
      tag: item.tag,
      status: "dismissed",
      dismissedSignalIds: legacySignalIds,
      updatedAt: "2026-07-25T02:00:00.000Z",
    }],
  });
  assert.equal(rebuilt.items.find((entry) => entry.tag === item.tag).status, "closed");
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

test("per-roster fallback follows hero-down wars across roster boundaries", () => {
  const rosterData = buildRosterData();
  delete rosterData.playerWarPerformance;
  rosterData.rosters[0].warPerformance = {
    regularWarHistoryByKey: {
      source: {
        warKey: "source",
        authoritative: true,
        finalizedAt: "2026-07-09T00:00:00.000Z",
        statsByTag: {
          "#P0LYGQ": { possibleAttacks: 2, usedAttacks: 1, attacksMissed: 1 },
        },
      },
    },
  };
  rosterData.rosters[1].warPerformance = {
    regularWarHistoryByKey: {
      recovery: {
        warKey: "recovery",
        authoritative: true,
        finalizedAt: "2026-07-12T00:00:00.000Z",
        statsByTag: {
          "#P0LYGQ": { possibleAttacks: 2, usedAttacks: 2, attacksMissed: 0 },
        },
      },
    },
  };
  const work = followup.buildWorkItems(rosterData, {
    settings: { regularLookbackWars: 8 },
    cases: [{
      tag: "#P0LYGQ",
      status: "hero_down",
      recoveryStartedAt: "2026-07-10T00:00:00.000Z",
      targetClanTag: "#TRAIN",
      recoveryWarTarget: 1,
      requireNoMisses: true,
    }],
  });
  const item = work.items.find((entry) => entry.tag === "#P0LYGQ");
  assert.ok(item);
  assert.equal(item.evidence.regularEvents.length, 2);
  assert.equal(item.recovery.totalWars, 1);
  assert.equal(item.recovery.ready, true);
  assert.equal(item.status, "ready");
});

test("decision DM states the exact evidence, clan handoff, and recovery requirement", () => {
  const text = followup.buildDmText({
    playerName: "Player One",
    sourceClan: "Main clan",
    targetClan: "Hero-down clan",
    targetClanTag: "#2CPRYQRGR",
    nextWarStartAt: "20260727T203045.000Z",
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
  assert.match(text, new RegExp("<t:" + Math.floor(Date.UTC(2026, 6, 27, 20, 30, 45) / 1000) + ":R>"));
  assert.match(text, /https:\/\/link\.clashofclans\.com\/en\/\?action=OpenClanProfile&tag=%232CPRYQRGR/);
  assert.match(text, /when the current war ends/);
});

test("DM timing and clan links fail safely when target data is unavailable", () => {
  assert.equal(
    followup.discordRelativeTimestamp("20260727T203045.000Z"),
    "<t:" + Math.floor(Date.UTC(2026, 6, 27, 20, 30, 45) / 1000) + ":R>",
  );
  assert.equal(followup.discordRelativeTimestamp("not-a-time"), "");
  assert.equal(
    followup.buildClanProfileLink("#2CPRYQRGR"),
    "https://link.clashofclans.com/en/?action=OpenClanProfile&tag=%232CPRYQRGR",
  );
  assert.equal(followup.buildClanProfileLink(""), "");

  const text = followup.buildDmText({
    playerName: "Player One",
    targetClan: "Hero-down clan",
    recoveryWars: 3,
    reasonCodes: [],
    evidence: {},
  });
  assert.match(text, /The next war there will start when the current war ends\./);
  assert.doesNotMatch(text, /<t:/);
  assert.doesNotMatch(text, /OpenClanProfile/);
});

test("hero-down roster directory exposes only an active war end as the next start", () => {
  const rosterData = buildRosterData();
  let directory = followup.buildPlayerDirectory(rosterData);
  assert.equal(
    directory.rosters.find((roster) => roster.id === "training").nextWarStartAt,
    "20260727T203045.000Z",
  );

  rosterData.rosters[1].regularWar.currentWar.state = "warEnded";
  directory = followup.buildPlayerDirectory(rosterData);
  assert.equal(directory.rosters.find((roster) => roster.id === "training").nextWarStartAt, "");
});

test("missing roster rows are excluded from both work and Discord gaps", () => {
  const work = followup.buildWorkItems(buildRosterData(), {
    settings: {},
    cases: [{ tag: "#P0LYGR", status: "needs_review", reasonCodes: ["manual"] }],
  });
  assert.equal(work.items.some((item) => item.tag === "#P0LYGR"), false);
  const directory = followup.buildPlayerDirectory(buildRosterData());
  const gaps = directory.players.filter((player) => !player.hasDiscord);
  assert.deepEqual(
    gaps.map((player) => [player.rosterTitle, player.name]),
    [["Main clan", "Discord Gap"]],
  );
  assert.equal(directory.players.some((player) => player.tag === "#P0LYGR"), false);
});

test("trusted accounts are ignored by automatic work, manual cases, and Discord gaps", () => {
  const work = followup.buildWorkItems(buildRosterData(), {
    settings: { trustedPlayerTags: ["#P0LYGQ", "#P0LYGJ"] },
    cases: [{ tag: "#P0LYGQ", status: "needs_review", reasonCodes: ["manual"] }],
  });
  assert.equal(work.items.some((item) => item.tag === "#P0LYGQ"), false);
  assert.equal(work.directory.byTag["#P0LYGQ"].trusted, true);
  assert.equal(work.directory.byTag["#P0LYGJ"].trusted, true);
  assert.equal(
    work.directory.players.filter((player) => !player.hasDiscord && !player.trusted).length,
    0,
  );
});

test("ignored-player entries stay searchable even when an account leaves the current roster", () => {
  const rosterData = buildRosterData();
  const settings = { trustedPlayerTags: ["#P0LYGQ", "#P0LYGC"] };
  const directory = followup.buildPlayerDirectory(rosterData, settings);
  const entries = followup.buildIgnoredPlayerEntries(directory, settings, [{
    tag: "#P0LYGC",
    name: "Former Filler",
    discord: "former.filler",
    sourceRosterId: "old-main",
    sourceRosterTitle: "Old main",
    sourceClanTag: "#OLD",
  }]);
  assert.deepEqual(
    entries.map((entry) => ({
      tag: entry.tag,
      name: entry.name,
      rosterTitle: entry.rosterTitle,
      inCurrentRoster: entry.inCurrentRoster,
    })),
    [
      { tag: "#P0LYGQ", name: "Player One", rosterTitle: "Main clan", inCurrentRoster: true },
      { tag: "#P0LYGC", name: "Former Filler", rosterTitle: "Old main", inCurrentRoster: false },
    ],
  );
});

test("player cards can use the linked Discord username or fall back to its ID", () => {
  assert.equal(
    followup.discordIdentityText({ discord: "leader.alt", discordId: "123456789012345678" }),
    "leader.alt",
  );
  assert.equal(
    followup.discordIdentityText({ discord: "", discordId: "123456789012345678" }),
    "ID 123456789012345678",
  );
  assert.equal(followup.discordIdentityText({}), "");

  const rosterData = buildRosterData();
  rosterData.playerMetrics.byTag["#P0LYGQ"] = {
    identity: {
      discordId: "123456789012345678",
      discordUsername: "current.username",
    },
  };
  const player = followup.buildPlayerDirectory(rosterData).byTag["#P0LYGQ"];
  assert.equal(player.discord, "current.username");
  assert.equal(player.discordId, "123456789012345678");
});

test("optimistic cases mirror every visible workflow transition", () => {
  const player = {
    tag: "#P0LYGQ",
    name: "Player One",
    rosterId: "main",
    rosterTitle: "Main clan",
    clanTag: "#MAIN",
  };
  const build = (caseValue, action, patch = {}) => followup.buildOptimisticCase({
    tag: player.tag,
    player,
    case: caseValue,
    signalIds: ["signal-1"],
  }, action, Object.assign({
    tag: player.tag,
    name: player.name,
    signalIds: ["signal-1"],
  }, patch), "test-" + action);

  const watching = build(null, "watch", { watchWarTarget: 3 });
  assert.equal(watching.status, "watching");
  assert.equal(watching.watchWarTarget, 3);
  assert.ok(watching.watchStartedAt);

  const needsDm = build(null, "hero_down", {
    targetRosterId: "training",
    targetRosterTitle: "Hero-down clan",
    targetClanTag: "#TRAIN",
    recoveryWarTarget: 4,
    reasonCodes: ["regular_missed"],
    evidence: { regular: { missedAttacks: 2 } },
    dmText: "Prepared decision",
  });
  assert.equal(needsDm.status, "needs_dm");
  assert.equal(needsDm.recoveryWarTarget, 4);
  assert.equal(needsDm.dmText, "Prepared decision");

  const inRecovery = build(needsDm, "mark_dm_sent", { dmText: "Prepared decision" });
  assert.equal(inRecovery.status, "hero_down");
  assert.ok(inRecovery.dmSentAt);
  assert.equal(inRecovery.recoveryStartedAt, inRecovery.dmSentAt);

  const extended = build(inRecovery, "extend", {
    recoveryWarTarget: 5,
    dmText: "Extension decision",
  });
  assert.equal(extended.status, "needs_dm");
  assert.equal(extended.recoveryWarTarget, 5);
  assert.equal(extended.dmSentAt, "");
  assert.equal(extended.recoveryStartedAt, "");

  const noReturn = build(inRecovery, "close", { outcome: "no_return" });
  assert.equal(noReturn.status, "closed");
  assert.equal(noReturn.outcome, "no_return");

  const approved = build(inRecovery, "approve_return");
  assert.equal(approved.status, "closed");
  assert.equal(approved.outcome, "approved_return");

  const reopened = build(approved, "reopen");
  assert.equal(reopened.status, "needs_review");
  assert.equal(reopened.outcome, "");
});

test("form snapshots preserve unsaved values, checks, and text selection across background renders", () => {
  const text = {
    type: "textarea",
    value: "custom DM wording",
    checked: false,
    selectionStart: 4,
    selectionEnd: 9,
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
  };
  const checkbox = { type: "checkbox", value: "regular_missed", checked: true };
  const select = { type: "select-one", value: "training", checked: false };
  const controls = [text, checkbox, select];
  const container = { querySelectorAll: () => controls };
  const snapshot = followup.snapshotFormControls(container);

  text.value = "";
  text.selectionStart = 0;
  text.selectionEnd = 0;
  checkbox.checked = false;
  select.value = "";
  followup.restoreFormControls(container, snapshot);

  assert.equal(text.value, "custom DM wording");
  assert.deepEqual([text.selectionStart, text.selectionEnd], [4, 9]);
  assert.equal(checkbox.checked, true);
  assert.equal(select.value, "training");

  const reasonA = {
    type: "checkbox",
    name: "wfu-reason",
    value: "regular_missed",
    checked: true,
    dataset: {},
  };
  const reasonB = {
    type: "checkbox",
    name: "wfu-reason",
    value: "cwl_missed",
    checked: false,
    dataset: {},
  };
  const dm = {
    type: "textarea",
    value: "keep this custom DM",
    checked: false,
    dataset: { wfuFocusKey: "field:decision-message" },
    selectionStart: 0,
    selectionEnd: 0,
  };
  let dynamicControls = [reasonA, reasonB, dm];
  const dynamicContainer = { querySelectorAll: () => dynamicControls };
  const dynamicSnapshot = followup.snapshotFormControls(dynamicContainer);
  reasonA.checked = false;
  reasonB.checked = true;
  dm.value = "";
  dynamicControls = [reasonB, reasonA, dm];
  followup.restoreFormControls(dynamicContainer, dynamicSnapshot);
  assert.equal(reasonA.checked, true, "the regular-war choice follows its identity after reordering");
  assert.equal(reasonB.checked, false, "the CWL choice follows its identity after reordering");
  assert.equal(dm.value, "keep this custom DM");
});

test("Start watching changes state immediately and reconciles the authoritative save", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    let resolveSave;
    let savedRequest = null;
    const save = new Promise((resolve) => {
      resolveSave = resolve;
    });
    const rosterData = buildRosterData();
    const controller = followup.createController({
      getRosterData: () => rosterData,
      getPassword: () => "change-me",
      callServer: (method, args) => {
        assert.equal(method, "mutateWarFollowupCase");
        savedRequest = args[0];
        return save;
      },
    });
    controller.state.loaded = true;
    controller.state.work = followup.buildWorkItems(rosterData, controller.state.privateState);
    const item = controller.state.work.items.find((entry) => entry.tag === "#P0LYGQ");
    controller.state.selectedTag = item.tag;
    controller.state.decisionMode = "watch";

    const operation = controller.mutateCase(item, "watch", { watchWarTarget: 3 });
    const optimistic = controller.state.work.items.find((entry) => entry.tag === item.tag);
    assert.equal(optimistic.status, "watching");
    assert.equal(optimistic.case.watchWarTarget, 3);
    assert.equal(controller.state.decisionMode, "");
    assert.equal(controller.state.pendingCaseMutations.has(item.tag), true);
    assert.equal(controller.mutateCase(optimistic, "reopen"), null, "the same player must not queue a stale second action");

    await Promise.resolve();
    assert.equal(savedRequest.expectedUpdatedAt, "");
    assert.ok(savedRequest.mutationId);
    resolveSave({
      tag: item.tag,
      name: item.player.name,
      status: "watching",
      watchWarTarget: 3,
      watchStartedAt: "2026-07-28T12:00:00.000Z",
      updatedAt: "2026-07-28T12:00:00.000Z",
      mutationLedger: [{
        mutationId: savedRequest.mutationId,
        action: "watch",
        updatedAt: "2026-07-28T12:00:00.000Z",
      }],
    });
    const saved = await operation;
    assert.equal(saved.status, "watching");
    assert.equal(controller.state.pendingCaseMutations.has(item.tag), false);
    assert.equal(
      controller.state.work.items.find((entry) => entry.tag === item.tag).case.updatedAt,
      "2026-07-28T12:00:00.000Z",
    );
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("different-player optimistic changes dispatch immediately and reconcile independently", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    const rosterData = buildRosterData();
    rosterData.rosters[0].main.push({
      tag: "#P0LYGC",
      name: "Player Two",
      discord: "player-two",
      th: 16,
    });
    rosterData.playerWarPerformance.byTag["#P0LYGC"] =
      structuredClone(rosterData.playerWarPerformance.byTag["#P0LYGQ"]);
    const calls = [];
    const deferred = [];
    const controller = followup.createController({
      getRosterData: () => rosterData,
      getPassword: () => "change-me",
      callServer: (method, args) => {
        assert.equal(method, "mutateWarFollowupCase");
        calls.push(args[0]);
        return new Promise((resolve) => deferred.push(resolve));
      },
    });
    controller.state.loaded = true;
    controller.state.work = followup.buildWorkItems(rosterData, controller.state.privateState);
    const first = controller.state.work.items.find((entry) => entry.tag === "#P0LYGQ");
    const second = controller.state.work.items.find((entry) => entry.tag === "#P0LYGC");

    const firstOperation = controller.mutateCase(first, "watch", { watchWarTarget: 2 });
    const secondOperation = controller.mutateCase(second, "watch", { watchWarTarget: 4 });
    assert.equal(controller.state.pendingCaseMutations.size, 2);
    assert.equal(controller.state.work.items.find((entry) => entry.tag === first.tag).status, "watching");
    assert.equal(controller.state.work.items.find((entry) => entry.tag === second.tag).status, "watching");

    await Promise.resolve();
    assert.equal(calls.length, 2, "an unrelated slow save must not keep the next action only in browser memory");
    deferred[1]({
      tag: second.tag,
      status: "watching",
      watchWarTarget: 4,
      watchStartedAt: "2026-07-28T12:00:00.000Z",
      updatedAt: "2026-07-28T12:00:00.000Z",
    });
    await secondOperation;
    assert.equal(controller.state.pendingCaseMutations.has(first.tag), true);
    assert.equal(controller.state.pendingCaseMutations.has(second.tag), false);
    deferred[0]({
      tag: first.tag,
      status: "watching",
      watchWarTarget: 2,
      watchStartedAt: "2026-07-28T12:00:01.000Z",
      updatedAt: "2026-07-28T12:00:01.000Z",
    });
    await firstOperation;
    assert.equal(controller.state.pendingCaseMutations.size, 0);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("leaving is guarded only while an optimistic save is still in flight", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const windowListeners = {};
  globalThis.document = {
    getElementById: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window = {
    addEventListener(type, listener) {
      windowListeners[type] = listener;
    },
    removeEventListener(type) {
      delete windowListeners[type];
    },
  };
  try {
    let resolveSave;
    const save = new Promise((resolve) => {
      resolveSave = resolve;
    });
    const rosterData = buildRosterData();
    const controller = followup.createController({
      getRosterData: () => rosterData,
      getPassword: () => "change-me",
      callServer: () => save,
    });
    controller.init();
    controller.state.loaded = true;
    controller.state.work = followup.buildWorkItems(rosterData, controller.state.privateState);
    const item = controller.state.work.items.find((entry) => entry.tag === "#P0LYGQ");
    const operation = controller.mutateCase(item, "watch", { watchWarTarget: 2 });
    await Promise.resolve();

    let prevented = false;
    const pendingEvent = {
      returnValue: null,
      preventDefault() {
        prevented = true;
      },
    };
    windowListeners.beforeunload(pendingEvent);
    assert.equal(prevented, true);
    assert.equal(pendingEvent.returnValue, "");

    resolveSave({
      tag: item.tag,
      status: "watching",
      watchWarTarget: 2,
      watchStartedAt: "2026-07-28T12:00:00.000Z",
      updatedAt: "2026-07-28T12:00:00.000Z",
    });
    await operation;
    prevented = false;
    windowListeners.beforeunload({
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, false);
    controller.destroy();
    assert.equal(windowListeners.beforeunload, undefined);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("a rejected optimistic mutation reconciles and rolls back before reopening the decision", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    const methods = [];
    const rosterData = buildRosterData();
    const controller = followup.createController({
      getRosterData: () => rosterData,
      getPassword: () => "change-me",
      callServer: (method) => {
        methods.push(method);
        if (method === "mutateWarFollowupCase") {
          return Promise.reject(new Error("This follow-up changed since it was opened."));
        }
        return Promise.resolve(null);
      },
    });
    controller.state.loaded = true;
    controller.state.work = followup.buildWorkItems(rosterData, controller.state.privateState);
    const item = controller.state.work.items.find((entry) => entry.tag === "#P0LYGQ");
    controller.state.selectedTag = item.tag;
    controller.state.decisionMode = "watch";

    const operation = controller.mutateCase(item, "watch", { watchWarTarget: 3 });
    assert.equal(controller.state.work.items.find((entry) => entry.tag === item.tag).status, "watching");
    assert.equal(await operation, null);
    assert.deepEqual(methods, ["mutateWarFollowupCase", "getWarFollowupCase"]);
    assert.equal(controller.state.privateState.cases.length, 0, "an absent base case must be removed again");
    assert.equal(controller.state.work.items.find((entry) => entry.tag === item.tag).status, "needs_review");
    assert.equal(controller.state.selectedTag, item.tag);
    assert.equal(controller.state.decisionMode, "watch");
    assert.equal(controller.state.pendingCaseMutations.has(item.tag), false);
    assert.match(controller.state.error, /changed since it was opened/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("a background failure never steals a different player's open drawer", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    const rosterData = buildRosterData();
    rosterData.rosters[0].main.push({
      tag: "#P0LYGC",
      name: "Player Two",
      discord: "player-two",
      th: 16,
    });
    rosterData.playerWarPerformance.byTag["#P0LYGC"] =
      structuredClone(rosterData.playerWarPerformance.byTag["#P0LYGQ"]);
    const controller = followup.createController({
      getRosterData: () => rosterData,
      getPassword: () => "change-me",
      callServer: (method) => method === "mutateWarFollowupCase"
        ? Promise.reject(new Error("temporary failure"))
        : Promise.resolve(null),
    });
    controller.state.loaded = true;
    controller.state.work = followup.buildWorkItems(rosterData, controller.state.privateState);
    const first = controller.state.work.items.find((entry) => entry.tag === "#P0LYGQ");
    const second = controller.state.work.items.find((entry) => entry.tag === "#P0LYGC");
    controller.state.selectedTag = first.tag;
    controller.state.decisionMode = "watch";

    const operation = controller.mutateCase(first, "watch", { watchWarTarget: 2 });
    controller.state.selectedTag = second.tag;
    controller.state.decisionMode = "";
    assert.equal(await operation, null);
    assert.equal(controller.state.selectedTag, second.tag);
    assert.equal(controller.state.noticeTag, first.tag);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("a lost mutation response is accepted when reconciliation finds its mutation ID", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    let mutationRequest = null;
    const rosterData = buildRosterData();
    const controller = followup.createController({
      getRosterData: () => rosterData,
      getPassword: () => "change-me",
      callServer: (method, args) => {
        if (method === "mutateWarFollowupCase") {
          mutationRequest = args[0];
          return Promise.reject(new Error("temporary response failure"));
        }
        return Promise.resolve({
          tag: mutationRequest.tag,
          status: "watching",
          watchWarTarget: 2,
          watchStartedAt: "2026-07-28T12:00:00.000Z",
          updatedAt: "2026-07-28T12:00:00.000Z",
          mutationLedger: [{
            mutationId: mutationRequest.mutationId,
            action: "watch",
            updatedAt: "2026-07-28T12:00:00.000Z",
          }],
        });
      },
    });
    controller.state.loaded = true;
    controller.state.work = followup.buildWorkItems(rosterData, controller.state.privateState);
    const item = controller.state.work.items.find((entry) => entry.tag === "#P0LYGQ");

    const result = await controller.mutateCase(item, "watch", { watchWarTarget: 2 });
    assert.equal(result.status, "watching");
    assert.equal(controller.state.work.items.find((entry) => entry.tag === item.tag).status, "watching");
    assert.equal(controller.state.error, "");
    assert.equal(controller.state.pendingCaseMutations.size, 0);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("No action closes immediately while its save continues in the background", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    let resolveSave;
    let saveCalls = 0;
    let savedMethod = "";
    let savedRequest = null;
    const save = new Promise((resolve) => {
      resolveSave = resolve;
    });
    const rosterData = buildRosterData();
    const controller = followup.createController({
      getRosterData: () => rosterData,
      getPassword: () => "change-me",
      callServer: (method, args) => {
        saveCalls += 1;
        savedMethod = method;
        savedRequest = args[0];
        return save;
      },
    });
    controller.state.loaded = true;
    controller.state.work = followup.buildWorkItems(rosterData, controller.state.privateState);
    const item = controller.state.work.items.find((entry) => entry.tag === "#P0LYGQ");
    controller.state.selectedTag = item.tag;

    const operation = controller.dismissInBackground(item);
    assert.equal(controller.state.selectedTag, "", "the drawer must close before the request settles");
    assert.equal(controller.state.pendingDismissTags.has(item.tag), true);
    assert.equal(controller.dismissInBackground(item), null, "a pending decision must not be submitted twice");

    resolveSave({
      tag: item.tag,
      name: item.player.name,
      status: "dismissed",
      outcome: "no_action",
      dismissedSignalIds: item.signalIds,
      updatedAt: "2026-07-26T12:00:00.000Z",
    });
    const result = await operation;
    assert.equal(savedMethod, "mutateWarFollowupCase");
    assert.equal(saveCalls, 1);
    assert.equal(savedRequest.action, "dismiss");
    assert.equal(result.status, "dismissed");
    assert.equal(controller.state.pendingDismissTags.has(item.tag), false);
    assert.equal(controller.state.work.items.find((entry) => entry.tag === item.tag).status, "closed");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("a failed background No action save restores and reopens the player", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    let rejectSave;
    const save = new Promise((resolve, reject) => {
      rejectSave = reject;
    });
    const rosterData = buildRosterData();
    const controller = followup.createController({
      getRosterData: () => rosterData,
      getPassword: () => "change-me",
      callServer: () => save,
    });
    controller.state.loaded = true;
    controller.state.work = followup.buildWorkItems(rosterData, controller.state.privateState);
    const item = controller.state.work.items.find((entry) => entry.tag === "#P0LYGQ");
    controller.state.selectedTag = item.tag;

    const operation = controller.dismissInBackground(item);
    assert.equal(controller.state.selectedTag, "");
    rejectSave(new Error("This follow-up changed since it was opened."));
    assert.equal(await operation, null);
    assert.equal(controller.state.pendingDismissTags.has(item.tag), false);
    assert.equal(controller.state.selectedTag, item.tag);
    assert.equal(controller.state.noticeTag, item.tag);
    assert.match(controller.state.error, /Could not save No action/);
    assert.match(controller.state.error, /changed since it was opened/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("Always ignore hides an account immediately and persists outside the refresh pipeline", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    let resolveSave;
    let savedMethod = "";
    let savedArgs = null;
    const save = new Promise((resolve) => {
      resolveSave = resolve;
    });
    const rosterData = buildRosterData();
    const controller = followup.createController({
      getRosterData: () => rosterData,
      getPassword: () => "change-me",
      callServer: (method, args) => {
        savedMethod = method;
        savedArgs = args;
        return save;
      },
    });
    controller.state.loaded = true;
    controller.state.work = followup.buildWorkItems(rosterData, controller.state.privateState);
    const item = controller.state.work.items.find((entry) => entry.tag === "#P0LYGQ");
    controller.state.selectedTag = item.tag;

    const operation = controller.ignoreAccountInBackground(item);
    assert.equal(controller.state.selectedTag, "");
    assert.equal(controller.state.privateState.settings.trustedPlayerTags.includes(item.tag), true);
    assert.equal(controller.state.work.items.some((entry) => entry.tag === item.tag), false);
    const immediateOrder = controller.state.work.items.map((entry) => entry.tag + ":" + entry.status);

    resolveSave({ tag: item.tag, trusted: true, updatedAt: "2026-07-26T12:00:00.000Z" });
    const result = await operation;
    assert.equal(savedMethod, "setWarFollowupTrustedAccount");
    assert.deepEqual(savedArgs.slice(0, 3), [item.tag, true, "change-me"]);
    assert.match(savedArgs[3], /^wfu-/);
    assert.equal(result.trusted, true);
    assert.equal(controller.state.pendingIgnoreTags.has(item.tag), false);
    assert.equal(controller.state.message, "", "success must not insert a late in-flow notice");
    assert.deepEqual(
      controller.state.work.items.map((entry) => entry.tag + ":" + entry.status),
      immediateOrder,
      "server confirmation must not reorder the already-updated list",
    );

    controller.state.work = followup.buildWorkItems(rosterData, controller.state.privateState);
    assert.equal(
      controller.state.work.items.some((entry) => entry.tag === item.tag),
      false,
      "the account must stay excluded when roster data is recomputed",
    );
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("a trust change received during initial loading overlays the older state response", async () => {
  const previousDocument = globalThis.document;
  const listeners = {};
  globalThis.document = {
    getElementById: () => null,
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
    removeEventListener(type) {
      delete listeners[type];
    },
  };
  try {
    let resolveState;
    const stateResponse = new Promise((resolve) => {
      resolveState = resolve;
    });
    const rosterData = buildRosterData();
    const controller = followup.createController({
      getRosterData: () => rosterData,
      getPassword: () => "change-me",
      callServer: (method) => {
        assert.equal(method, "getWarFollowupState");
        return stateResponse;
      },
    });
    controller.init();
    const loading = controller.load(false);
    await Promise.resolve();
    listeners["admin:warfollowuptrustchange"]({
      detail: {
        tag: "#P0LYGQ",
        trusted: true,
        updatedAt: "2026-07-28T12:00:02.000Z",
      },
    });
    resolveState({
      settings: {
        trustedPlayerTags: [],
        updatedAt: "2026-07-28T12:00:01.000Z",
      },
      cases: [],
    });
    await loading;

    assert.equal(controller.state.privateState.settings.trustedPlayerTags.includes("#P0LYGQ"), true);
    assert.equal(controller.state.work.items.some((entry) => entry.tag === "#P0LYGQ"), false);
    controller.destroy();
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("an older ignore response cannot overwrite a newer trust decision in the UI", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    let resolveSave;
    const save = new Promise((resolve) => {
      resolveSave = resolve;
    });
    const rosterData = buildRosterData();
    const controller = followup.createController({
      getRosterData: () => rosterData,
      getPassword: () => "change-me",
      callServer: () => save,
    });
    controller.state.loaded = true;
    controller.state.privateState.settings = followup.sanitizeSettings({
      trustedPlayerTags: [],
      updatedAt: "2026-07-28T12:00:00.000Z",
    });
    controller.state.work = followup.buildWorkItems(rosterData, controller.state.privateState);
    const item = controller.state.work.items.find((entry) => entry.tag === "#P0LYGQ");

    const operation = controller.ignoreAccountInBackground(item);
    controller.state.privateState.settings = followup.sanitizeSettings({
      trustedPlayerTags: [],
      updatedAt: "2026-07-28T12:00:02.000Z",
    });
    controller.state.trustUpdatedAtByTag[item.tag] = "2026-07-28T12:00:02.000Z";
    controller.state.work = followup.buildWorkItems(rosterData, controller.state.privateState);
    resolveSave({
      tag: item.tag,
      trusted: true,
      updatedAt: "2026-07-28T12:00:01.000Z",
    });
    await operation;

    assert.equal(
      controller.state.privateState.settings.trustedPlayerTags.includes(item.tag),
      false,
      "the later restore must remain authoritative",
    );
    assert.equal(controller.state.privateState.settings.updatedAt, "2026-07-28T12:00:02.000Z");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("a stale Rules response preserves newer completed trust decisions and concurrent notices", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    let savedArgs = null;
    const rosterData = buildRosterData();
    const controller = followup.createController({
      getRosterData: () => rosterData,
      getPassword: () => "change-me",
      callServer: (method, args) => {
        assert.equal(method, "saveWarFollowupSettings");
        savedArgs = args;
        return Promise.resolve({
          regularLookbackWars: 5,
          trustedPlayerTags: ["#P0LYGJ"],
          rulesUpdatedAt: "2026-07-28T12:00:02.000Z",
          updatedAt: "2026-07-28T12:00:02.000Z",
        });
      },
    });
    controller.state.loaded = true;
    controller.state.privateState.settings = followup.sanitizeSettings({
      trustedPlayerTags: ["#P0LYGQ"],
      rulesUpdatedAt: "2026-07-28T12:00:00.000Z",
      updatedAt: "2026-07-28T12:00:04.000Z",
    });
    controller.state.trustBaselineUpdatedAt = "2026-07-28T12:00:00.000Z";
    controller.state.trustUpdatedAtByTag["#P0LYGQ"] = "2026-07-28T12:00:03.000Z";
    controller.state.trustUpdatedAtByTag["#P0LYGJ"] = "2026-07-28T12:00:04.000Z";
    controller.state.work = followup.buildWorkItems(rosterData, controller.state.privateState);

    const operation = controller.saveRulesInBackground(
      { regularLookbackWars: 5 },
      "2026-07-28T12:00:00.000Z",
    );
    controller.state.error = "A different player change failed.";
    controller.state.noticeTag = "#OTHER";
    controller.state.noticeOwner = "";
    assert.equal(await operation, true);

    assert.equal(savedArgs[2], "2026-07-28T12:00:00.000Z");
    assert.match(savedArgs[3], /^wfu-/);
    assert.deepEqual(
      controller.state.privateState.settings.trustedPlayerTags,
      ["#P0LYGQ"],
      "the newer ignore and restore must both win over the older Rules snapshot",
    );
    assert.equal(controller.state.error, "A different player change failed.");
    assert.equal(controller.state.noticeTag, "#OTHER");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("a failed background Rules save keeps a newer overlay open and retains its draft", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    const rosterData = buildRosterData();
    const controller = followup.createController({
      getRosterData: () => rosterData,
      getPassword: () => "change-me",
      callServer: (method) => {
        if (method === "saveWarFollowupSettings") {
          return Promise.reject(new Error("Rules could not be saved."));
        }
        assert.equal(method, "getWarFollowupRulesStatus");
        return Promise.resolve({
          committed: false,
          settings: {
            regularLookbackWars: 8,
            rulesUpdatedAt: "2026-07-28T12:00:00.000Z",
            updatedAt: "2026-07-28T12:00:00.000Z",
          },
        });
      },
    });
    controller.state.loaded = true;
    controller.state.modal = "settings";
    controller.state.modalUiByName.settings = {
      controls: [{ key: "data:rules-regular-lookback", type: "number", value: "5" }],
    };
    controller.state.privateState.settings = followup.sanitizeSettings({
      rulesUpdatedAt: "2026-07-28T12:00:00.000Z",
      updatedAt: "2026-07-28T12:00:00.000Z",
    });
    controller.state.work = followup.buildWorkItems(rosterData, controller.state.privateState);

    const operation = controller.saveRulesInBackground(
      { regularLookbackWars: 5 },
      "2026-07-28T12:00:00.000Z",
    );
    assert.equal(controller.state.modal, "", "Rules closes optimistically");
    controller.state.modal = "add";
    assert.equal(await operation, false);

    assert.equal(controller.state.modal, "add", "the newer modal must not be interrupted");
    assert.equal(controller.state.modalUiByName.settings.controls[0].value, "5");
    assert.equal(controller.state.noticeTag, "");
    assert.match(controller.state.noticeOwner, /^rules:wfu-/);
    assert.match(controller.state.error, /Rules could not be saved/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("a failed Always ignore save verifies storage, then restores the account", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    const methods = [];
    const rosterData = buildRosterData();
    const controller = followup.createController({
      getRosterData: () => rosterData,
      getPassword: () => "change-me",
      callServer: (method) => {
        methods.push(method);
        if (method === "setWarFollowupTrustedAccount") return Promise.reject(new Error("temporary network failure"));
        return Promise.resolve({ tag: "#P0LYGQ", trusted: false });
      },
    });
    controller.state.loaded = true;
    controller.state.work = followup.buildWorkItems(rosterData, controller.state.privateState);
    const item = controller.state.work.items.find((entry) => entry.tag === "#P0LYGQ");
    controller.state.selectedTag = item.tag;

    const result = await controller.ignoreAccountInBackground(item);
    assert.equal(result, null);
    assert.deepEqual(methods, ["setWarFollowupTrustedAccount", "getWarFollowupTrustStatus"]);
    assert.equal(controller.state.privateState.settings.trustedPlayerTags.includes(item.tag), false);
    assert.equal(controller.state.selectedTag, item.tag);
    assert.equal(controller.state.pendingIgnoreTags.has(item.tag), false);
    assert.match(controller.state.error, /Could not save Always ignore/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("an unrelated settings update does not prevent rollback of a failed ignore", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    let rejectSave;
    const save = new Promise((resolve, reject) => {
      rejectSave = reject;
    });
    const rosterData = buildRosterData();
    const controller = followup.createController({
      getRosterData: () => rosterData,
      getPassword: () => "change-me",
      callServer: (method) => {
        if (method === "setWarFollowupTrustedAccount") return save;
        return Promise.reject(new Error("status unavailable"));
      },
    });
    controller.state.loaded = true;
    controller.state.privateState.settings = followup.sanitizeSettings({
      updatedAt: "2026-07-28T12:00:00.000Z",
    });
    controller.state.trustBaselineUpdatedAt = "2026-07-28T12:00:00.000Z";
    controller.state.work = followup.buildWorkItems(rosterData, controller.state.privateState);
    const item = controller.state.work.items.find((entry) => entry.tag === "#P0LYGQ");

    const operation = controller.ignoreAccountInBackground(item);
    controller.state.privateState.settings = followup.sanitizeSettings(Object.assign(
      {},
      controller.state.privateState.settings,
      { updatedAt: "2026-07-28T12:00:02.000Z" },
    ));
    controller.state.trustBaselineUpdatedAt = "2026-07-28T12:00:02.000Z";
    rejectSave(new Error("write failed"));
    assert.equal(await operation, null);
    assert.equal(controller.state.privateState.settings.trustedPlayerTags.includes(item.tag), false);
    assert.equal(controller.state.work.items.some((entry) => entry.tag === item.tag), true);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("Restore removes an account from ignored settings immediately and persists it", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    let resolveSave;
    let savedMethod = "";
    let savedArgs = null;
    const save = new Promise((resolve) => {
      resolveSave = resolve;
    });
    const rosterData = buildRosterData();
    const controller = followup.createController({
      getRosterData: () => rosterData,
      getPassword: () => "change-me",
      callServer: (method, args) => {
        savedMethod = method;
        savedArgs = args;
        return save;
      },
    });
    controller.state.loaded = true;
    controller.state.privateState.settings = followup.sanitizeSettings({
      trustedPlayerTags: ["#P0LYGQ"],
    });
    controller.state.work = followup.buildWorkItems(rosterData, controller.state.privateState);
    const entry = followup.buildIgnoredPlayerEntries(
      controller.state.work.directory,
      controller.state.privateState.settings,
      controller.state.privateState.cases,
    )[0];

    const operation = controller.restoreIgnoredAccountInBackground(entry);
    assert.equal(controller.state.privateState.settings.trustedPlayerTags.includes(entry.tag), false);
    assert.equal(controller.state.pendingIgnoreTags.has(entry.tag), true);
    assert.equal(controller.restoreIgnoredAccountInBackground(entry), null, "a pending restore must not be submitted twice");

    resolveSave({ tag: entry.tag, trusted: false, updatedAt: "2026-07-27T12:00:00.000Z" });
    const result = await operation;
    assert.equal(savedMethod, "setWarFollowupTrustedAccount");
    assert.deepEqual(savedArgs.slice(0, 3), [entry.tag, false, "change-me"]);
    assert.match(savedArgs[3], /^wfu-/);
    assert.equal(result.trusted, false);
    assert.equal(controller.state.pendingIgnoreTags.has(entry.tag), false);
    assert.equal(controller.state.privateState.settings.trustedPlayerTags.includes(entry.tag), false);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("a failed Restore verifies storage and returns the account to the ignored list", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    const methods = [];
    const rosterData = buildRosterData();
    const controller = followup.createController({
      getRosterData: () => rosterData,
      getPassword: () => "change-me",
      callServer: (method) => {
        methods.push(method);
        if (method === "setWarFollowupTrustedAccount") return Promise.reject(new Error("temporary network failure"));
        return Promise.resolve({ tag: "#P0LYGQ", trusted: true });
      },
    });
    controller.state.loaded = true;
    controller.state.modal = "ignored";
    controller.state.privateState.settings = followup.sanitizeSettings({
      trustedPlayerTags: ["#P0LYGQ"],
    });
    controller.state.work = followup.buildWorkItems(rosterData, controller.state.privateState);
    const entry = followup.buildIgnoredPlayerEntries(
      controller.state.work.directory,
      controller.state.privateState.settings,
      controller.state.privateState.cases,
    )[0];

    const result = await controller.restoreIgnoredAccountInBackground(entry);
    assert.equal(result, null);
    assert.deepEqual(methods, ["setWarFollowupTrustedAccount", "getWarFollowupTrustStatus"]);
    assert.equal(controller.state.privateState.settings.trustedPlayerTags.includes(entry.tag), true);
    assert.equal(controller.state.pendingIgnoreTags.has(entry.tag), false);
    assert.equal(controller.state.modal, "ignored");
    assert.match(controller.state.error, /Could not restore account/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
