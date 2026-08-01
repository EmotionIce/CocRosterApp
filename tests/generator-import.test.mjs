import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const generatorPath = new URL("../cloudflarePages/generator.js", import.meta.url);
const generatorCode = fs.readFileSync(generatorPath, "utf8");
const backendFiles = [
  "script/config.js",
  "script/cocApi.js",
  "script/rosterDomain.js",
  "script/warDomain.js",
  "script/playerWarTracking.js",
  "script/firebaseStore.js",
  "script/metricsTracking.js",
  "script/rosterSchema.js",
];

const loadGenerator = () => {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(generatorCode, context);
  return context.window.RosterGenerator;
};

const loadBackend = () => {
  const code = backendFiles
    .map((file) => fs.readFileSync(new URL("../" + file, import.meta.url), "utf8"))
    .join("\n");
  const context = {
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => "Etc/UTC" },
    Utilities: {
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

const buildCwlPreferencePlanRosterData = () => ({
  rosterOrder: ["champ", "master", "later"],
  rosters: [
    {
      id: "champ",
      title: "Champion",
      trackingMode: "cwl",
      main: [
        { slot: 1, name: "Move Me", tag: "#MOVE1", th: 16, notes: [] },
        { slot: 2, name: "Locked", tag: "#LOCK1", th: 16, notes: [] },
      ],
      subs: [],
      missing: [],
      cwlPreparation: {
        enabled: true,
        rosterSize: 5,
        lockStateByTag: {
          "#LOCK1": "lockedIn",
        },
      },
    },
    {
      id: "master",
      title: "Master",
      trackingMode: "cwl",
      main: [
        { slot: 1, name: "Already", tag: "#ALRDY", th: 15, notes: [] },
      ],
      subs: [],
      missing: [],
    },
    {
      id: "later",
      title: "Later",
      trackingMode: "cwl",
      main: [],
      subs: [],
      missing: [],
    },
  ],
  cwlLeagueSignups: {
    optionsByLeagueKey: {
      "champion-i": {
        leagueKey: "champion-i",
        leagueName: "Champion I",
        rosterIds: ["champ"],
      },
      "master-ii": {
        leagueKey: "master-ii",
        leagueName: "Master II",
        rosterIds: ["later", "master"],
      },
    },
    preferencesByTag: {
      "#MOVE1": {
        playerTag: "#MOVE1",
        playerName: "Move Me",
        leagueKey: "master-ii",
        leagueName: "Master II",
      },
      "#ALRDY": {
        playerTag: "#ALRDY",
        playerName: "Already",
        leagueKey: "master-ii",
        leagueName: "Master II",
      },
      "#LOCK1": {
        playerTag: "#LOCK1",
        playerName: "Locked",
        leagueKey: "master-ii",
        leagueName: "Master II",
      },
      "#MISS1": {
        playerTag: "#MISS1",
        playerName: "Missing",
        leagueKey: "master-ii",
        leagueName: "Master II",
      },
      "#NOOPT": {
        playerTag: "#NOOPT",
        playerName: "No Option",
        leagueKey: "crystal-i",
        leagueName: "Crystal I",
      },
      "#SKIP1": {
        playerTag: "#SKIP1",
        playerName: "Skip",
        leagueKey: "",
        leagueName: "",
      },
    },
  },
});

test("prefers Username over Discord display name when both are present", () => {
  const generator = loadGenerator();
  const parsed = generator.parseXlsxRowsTolerant([
    {
      NAME: "Phuni",
      TAG: "#2LUCULPQ2",
      Discord: "Phuni",
      Username: "phuuni",
      ID: "123456789012345678",
      CLAN: "TURTLE",
      "War Preference": "in",
      "Town-Hall": 18,
    },
  ]);

  assert.equal(parsed.accounts[0].discord, "phuuni");
  assert.equal(parsed.accounts[0].discordId, "123456789012345678");
});

test("falls back to Discord display name when Username is blank or a placeholder", () => {
  const generator = loadGenerator();
  const blankParsed = generator.parseXlsxRowsTolerant([
    {
      NAME: "Phuni",
      TAG: "#2LUCULPQ2",
      Discord: "Phuni",
      Username: "",
      CLAN: "TURTLE",
      "War Preference": "in",
      "Town-Hall": 18,
    },
  ]);
  const placeholderParsed = generator.parseXlsxRowsTolerant([
    {
      NAME: "Phuni",
      TAG: "#2LUCULPQ2",
      Discord: "Phuni",
      Username: "n/a",
      CLAN: "TURTLE",
      "War Preference": "in",
      "Town-Hall": 18,
    },
  ]);

  assert.equal(blankParsed.accounts[0].discord, "Phuni");
  assert.equal(placeholderParsed.accounts[0].discord, "Phuni");
});

test("updates existing war-out roster members while still excluding new war-out additions", () => {
  const generator = loadGenerator();
  const accounts = generator.parseXlsxRowsTolerant([
    {
      NAME: "Phuni #2",
      TAG: "#28VYJ9URP",
      Discord: "Phuni",
      Username: "phuuni",
      CLAN: "TURTLE",
      "War Preference": "out",
      "Town-Hall": 17,
    },
    {
      NAME: "Brand New",
      TAG: "#NEW123",
      Discord: "Brand New",
      Username: "brandnew",
      CLAN: "TURTLE",
      "War Preference": "out",
      "Town-Hall": 16,
    },
  ]).accounts;

  const rosterData = {
    rosters: [
      {
        id: "turtle",
        title: "TURTLE",
        main: [
          {
            name: "Phuni #2",
            discord: "",
            th: 17,
            tag: "#28VYJ9URP",
          },
        ],
        subs: [],
        missing: [],
      },
    ],
  };

  const comparison = generator.buildImportComparison({
    rosterData,
    accounts,
    importedClanValues: generator.extractImportedClanValues(accounts),
    mapping: { TURTLE: "turtle" },
    filters: { excludeWarOut: true },
  });

  assert.equal(comparison.summary.matchedWithUpdates, 1);
  assert.equal(comparison.summary.newAddable, 0);
  assert.equal(comparison.summary.ignoredWarOut, 1);
  assert.equal(comparison.buckets.matchedWithUpdates[0].updates.discord, "phuuni");
  assert.equal(comparison.buckets.ignored.warOut[0].tag, "#NEW123");
});

test("applying import updates preserves existing player metrics store", () => {
  const generator = loadGenerator();
  const playerMetrics = {
    schemaVersion: 1,
    updatedAt: "2026-05-19T00:00:00.000Z",
    byTag: {
      "#28VYJ9URP": {
        identity: {
          tag: "#28VYJ9URP",
          name: "Phuni #2",
          discordId: "123456789012345678",
          discordUsername: "old-phuni",
          discordLinkedAt: "2026-05-19T00:00:00.000Z",
          discordUpdatedAt: "2026-05-19T00:00:00.000Z",
          discordSource: "discord-sync",
        },
        latestSnapshot: {
          tag: "#28VYJ9URP",
          trophies: 5000,
          donations: 10,
          donationsReceived: 4,
        },
        trophyHistoryDaily: [],
        donationCycles: {},
      },
    },
  };
  const rosterData = {
    playerMetrics,
    rosters: [
      {
        id: "turtle",
        title: "TURTLE",
        main: [
          {
            name: "Phuni #2",
            discord: "",
            th: 17,
            tag: "#28VYJ9URP",
          },
        ],
        subs: [],
        missing: [],
      },
    ],
  };
  const accounts = generator.parseXlsxRowsTolerant([
    {
      NAME: "Phuni #2",
      TAG: "#28VYJ9URP",
      Username: "phuuni",
      CLAN: "TURTLE",
      "War Preference": "in",
      "Town-Hall": 17,
    },
  ]).accounts;
  const comparison = generator.buildImportComparison({
    rosterData,
    accounts,
    importedClanValues: generator.extractImportedClanValues(accounts),
    mapping: { TURTLE: "turtle" },
    filters: {},
  });

  const applied = generator.applyImportComparison({ rosterData, comparison });

  assert.deepEqual(JSON.parse(JSON.stringify(applied.rosterData.playerMetrics)), playerMetrics);
  assert.equal(applied.rosterData.rosters[0].main[0].discord, "phuuni");

  const backend = loadBackend();
  const publishReady = backend.canonicalizeDiscordIdentityForRosterData_(applied.rosterData, {
    sourceRosterData: rosterData,
    updatedAt: "2026-05-19T03:00:00.000Z",
    source: "publish",
    allowRosterCacheUsernameUpdates: true,
  }).rosterData;
  const identity = publishReady.playerMetrics.byTag["#28VYJ9URP"].identity;
  assert.equal(identity.discordId, "123456789012345678");
  assert.equal(identity.discordUsername, "phuuni");
});

test("applying import fills missing playerMetrics Discord IDs", () => {
  const generator = loadGenerator();
  const rosterData = {
    playerMetrics: { schemaVersion: 1, updatedAt: "", byTag: {} },
    rosters: [
      {
        id: "turtle",
        title: "TURTLE",
        main: [
          {
            name: "Phuni #2",
            discord: "phuuni",
            th: 17,
            tag: "#28VYJ9URP",
          },
        ],
        subs: [],
        missing: [],
      },
    ],
  };
  const accounts = generator.parseXlsxRowsTolerant([
    {
      NAME: "Phuni #2",
      TAG: "#28VYJ9URP",
      Username: "phuuni",
      ID: "123456789012345678",
      CLAN: "TURTLE",
      "War Preference": "in",
      "Town-Hall": 17,
    },
  ]).accounts;
  const comparison = generator.buildImportComparison({
    rosterData,
    accounts,
    importedClanValues: generator.extractImportedClanValues(accounts),
    mapping: { TURTLE: "turtle" },
    filters: {},
  });

  assert.equal(comparison.summary.matchedWithUpdates, 1);
  assert.equal(comparison.summary.actionableTotal, 1);
  assert.equal(comparison.summary.importedDiscordIdCount, 1);
  assert.equal(comparison.summary.matchedMissingPlayerMetricsDiscordId, 1);
  assert.equal(comparison.buckets.matchedWithUpdates[0].updates.discordId, "123456789012345678");

  const applied = generator.applyImportComparison({ rosterData, comparison });
  const identity = applied.rosterData.playerMetrics.byTag["#28VYJ9URP"].identity;

  assert.equal(applied.applied.identityUpdateCount, 1);
  assert.equal(identity.discordId, "123456789012345678");
  assert.equal(identity.discordUsername, "phuuni");
  assert.equal(identity.discordSource, "xlsx-import");
});

test("applying import does not overwrite existing playerMetrics Discord IDs", () => {
  const generator = loadGenerator();
  const rosterData = {
    playerMetrics: {
      schemaVersion: 1,
      updatedAt: "2026-05-19T00:00:00.000Z",
      byTag: {
        "#28VYJ9URP": {
          identity: {
            tag: "#28VYJ9URP",
            name: "Phuni #2",
            discordId: "111111111111111111",
            discordUsername: "phuuni",
            discordSource: "discord-sync",
          },
          trophyHistoryDaily: [],
          donationCycles: {},
        },
      },
    },
    rosters: [
      {
        id: "turtle",
        title: "TURTLE",
        main: [
          {
            name: "Phuni #2",
            discord: "phuuni",
            th: 17,
            tag: "#28VYJ9URP",
          },
        ],
        subs: [],
        missing: [],
      },
    ],
  };
  const accounts = generator.parseXlsxRowsTolerant([
    {
      NAME: "Phuni #2",
      TAG: "#28VYJ9URP",
      Username: "phuuni",
      ID: "222222222222222222",
      CLAN: "TURTLE",
      "War Preference": "in",
      "Town-Hall": 17,
    },
  ]).accounts;
  const comparison = generator.buildImportComparison({
    rosterData,
    accounts,
    importedClanValues: generator.extractImportedClanValues(accounts),
    mapping: { TURTLE: "turtle" },
    filters: {},
  });

  assert.equal(comparison.summary.matchedWithUpdates, 0);
  assert.equal(comparison.summary.matchedDiscordIdConflicts, 1);
  assert.equal(comparison.buckets.matchedDiscordIdConflicts[0].currentDiscordId, "111111111111111111");
  assert.equal(comparison.buckets.matchedDiscordIdConflicts[0].importedDiscordId, "222222222222222222");
});

test("CWL preference planner reports moves and skipped cases without mutating roster order", () => {
  const generator = loadGenerator();
  const rosterData = buildCwlPreferencePlanRosterData();
  const before = JSON.stringify(rosterData);

  const plan = generator.planCwlLeaguePreferenceMoves({ rosterData });

  assert.equal(JSON.stringify(rosterData), before);
  assert.deepEqual(rosterData.rosterOrder, ["champ", "master", "later"]);
  assert.equal(plan.summary.preferenceCount, 6);
  assert.equal(plan.summary.validMoveCount, 1);
  assert.equal(plan.summary.alreadyCorrectCount, 1);
  assert.equal(plan.summary.skippedCount, 1);
  assert.equal(plan.summary.conflictCount, 1);
  assert.equal(plan.summary.missingPlayerCount, 1);
  assert.equal(plan.summary.missingOptionCount, 1);
  assert.equal(JSON.stringify(plan.moves.map((move) => ({
    playerTag: move.playerTag,
    fromRosterId: move.fromRosterId,
    targetRosterId: move.targetRosterId,
  }))), JSON.stringify([{
    playerTag: "#MOVE1",
    fromRosterId: "champ",
    targetRosterId: "master",
  }]));
  assert.equal(plan.alreadyCorrect[0].playerTag, "#ALRDY");
  assert.equal(plan.conflicts[0].playerTag, "#LOCK1");
  assert.equal(plan.conflicts[0].lockState, "lockedIn");
  assert.equal(plan.missingPlayers[0].playerTag, "#MISS1");
  assert.equal(plan.missingOptions[0].playerTag, "#NOOPT");
  assert.equal(plan.skipped[0].reason, "missing-league");
});

test("CWL preference planner targets the selected same-league roster", () => {
  const generator = loadGenerator();
  const rosterData = {
    rosterOrder: ["source", "first", "selected"],
    rosters: [
      {
        id: "source",
        title: "Source",
        trackingMode: "cwl",
        main: [{ slot: 1, name: "Move Me", tag: "#MOVE1", th: 16, notes: [] }],
        subs: [],
        missing: [],
      },
      { id: "first", title: "First Champion", trackingMode: "cwl", main: [], subs: [], missing: [] },
      { id: "selected", title: "Selected Champion", trackingMode: "cwl", main: [], subs: [], missing: [] },
    ],
    cwlLeagueSignups: {
      optionsByKey: {
        "first-champion": {
          optionKey: "first-champion",
          leagueKey: "champion-i",
          leagueName: "Champion I",
          targetRosterId: "first",
          targetClanName: "First Champion",
          rosterIds: ["first"],
        },
        "selected-champion": {
          optionKey: "selected-champion",
          leagueKey: "champion-i",
          leagueName: "Champion I",
          targetRosterId: "selected",
          targetClanName: "Selected Champion",
          rosterIds: ["selected"],
        },
      },
      optionsByLeagueKey: {
        "champion-i": {
          leagueKey: "champion-i",
          leagueName: "Champion I",
          rosterIds: ["first", "selected"],
        },
      },
      preferencesByTag: {
        "#MOVE1": {
          playerTag: "#MOVE1",
          playerName: "Move Me",
          optionKey: "selected-champion",
          leagueKey: "champion-i",
          leagueName: "Champion I",
          targetRosterId: "selected",
          targetClanName: "Selected Champion",
        },
      },
    },
  };

  const plan = generator.planCwlLeaguePreferenceMoves({ rosterData });

  assert.equal(plan.summary.validMoveCount, 1);
  assert.equal(plan.moves[0].targetRosterId, "selected");
  assert.equal(plan.moves[0].targetClanName, "Selected Champion");
});

test("CWL preference planner is idempotent after preferences are already satisfied", () => {
  const generator = loadGenerator();
  const rosterData = buildCwlPreferencePlanRosterData();
  const champ = rosterData.rosters.find((roster) => roster.id === "champ");
  const master = rosterData.rosters.find((roster) => roster.id === "master");
  const moved = champ.main.shift();
  master.subs.push(moved);

  const plan = generator.planCwlLeaguePreferenceMoves({ rosterData });

  assert.equal(plan.moves.some((move) => move.playerTag === "#MOVE1"), false);
  assert.ok(plan.alreadyCorrect.some((item) => item.playerTag === "#MOVE1"));
  assert.equal(plan.summary.validMoveCount, 0);
});

test("CWL preference planner tolerates missing roster arrays without mutating preview shape", () => {
  const generator = loadGenerator();
  const rosterData = buildCwlPreferencePlanRosterData();
  delete rosterData.rosters[1].subs;
  delete rosterData.rosters[1].missing;
  delete rosterData.rosters[2].main;
  const before = JSON.stringify(rosterData);

  const plan = generator.planCwlLeaguePreferenceMoves({ rosterData });

  assert.equal(JSON.stringify(rosterData), before);
  assert.equal(plan.summary.preferenceCount, 6);
  assert.equal(Array.isArray(rosterData.rosters[1].subs), false);
  assert.equal(Array.isArray(rosterData.rosters[2].main), false);
});

const makeCwlPrepPlayer = (tag, th = 17) => ({ slot: null, name: tag, tag, th, notes: [] });
const makeCwlPrepConfig = (rosterSize, substituteCount = 0, options = {}) => ({
  enabled: true,
  rosterSize,
  distributionMode: options.distributionMode === "fill" ? "fill" : "subs",
  substituteCount,
  lockStateByTag: options.lockStateByTag || {},
  requirements: options.requirements || {},
});

test("CWL prep hard capacity makes a voter consume a slot without forcing them into main", () => {
  const generator = loadGenerator();
  const rosterData = {
    rosterOrder: ["top", "mid", "low"],
    rosters: [
      {
        id: "top", trackingMode: "cwl", cwlPreparation: makeCwlPrepConfig(1, 1),
        main: [makeCwlPrepPlayer("#A")],
        subs: [makeCwlPrepPlayer("#B"), makeCwlPrepPlayer("#VOTE")], missing: [],
      },
      {
        id: "mid", trackingMode: "cwl", cwlPreparation: makeCwlPrepConfig(1, 1),
        main: [makeCwlPrepPlayer("#MID")], subs: [], missing: [],
      },
      {
        id: "low", trackingMode: "cwl", cwlPreparation: makeCwlPrepConfig(1, 2),
        main: [makeCwlPrepPlayer("#LOW")], subs: [makeCwlPrepPlayer("#LAST")], missing: [],
      },
    ],
    cwlLeagueSignups: {
      preferencesByTag: {
        "#VOTE": { playerTag: "#VOTE", targetRosterId: "top", leagueName: "Top" },
      },
    },
  };
  const before = JSON.stringify(rosterData);
  const plan = generator.planCwlPrepRosterDistribution({
    rosterData,
    strengthByTag: {
      "#A": { strengthScore: 100 }, "#B": { strengthScore: 90 }, "#VOTE": { strengthScore: 1 },
      "#MID": { strengthScore: 80 }, "#LOW": { strengthScore: 70 }, "#LAST": { strengthScore: 60 },
    },
  });

  assert.equal(JSON.stringify(rosterData), before, "pure planning must not mutate the preview");
  assert.equal(plan.rosterResults[0].afterCount, 2);
  assert.equal(plan.rosterResults[0].capacity, 2);
  assert.equal(plan.rosterResults[0].expectedMainCount, 1);
  assert.equal(plan.rosterResults[0].expectedSubCount, 1);
  assert.equal(plan.rosterResults[0].targetMet, true);
  assert.equal(plan.finalRosterIdByTag["#VOTE"], "top");
  assert.equal(plan.finalRoleByTag["#VOTE"], "sub", "a weak voter retains a roster slot, not a main slot");
  assert.equal(plan.finalRoleByTag["#A"], "main");
  assert.equal(plan.finalRosterIdByTag["#B"], "mid", "the voter must displace another player instead of enlarging capacity");
  assert.equal(plan.summary.capacityMoveCount, 1);
  assert.equal(plan.summary.playerCount, 6);
  assert.equal(Object.keys(plan.finalRosterIdByTag).length, 6);
  assert.equal(plan.summary.conserved, true);
});

test("CWL prep Locked-In consumes main while Locked-Out can move and only occupy a sub slot", () => {
  const generator = loadGenerator();
  const rosterData = {
    rosterOrder: ["top", "low"],
    rosters: [
      {
        id: "top", trackingMode: "cwl",
        cwlPreparation: makeCwlPrepConfig(1, 1, {
          lockStateByTag: { "#IN": "lockedIn", "#OUT1": "lockedOut", "#OUT2": "lockedOut" },
        }),
        main: [makeCwlPrepPlayer("#IN")],
        subs: [makeCwlPrepPlayer("#OUT1"), makeCwlPrepPlayer("#OUT2"), makeCwlPrepPlayer("#STRONG")], missing: [],
      },
      {
        id: "low", trackingMode: "cwl", cwlPreparation: makeCwlPrepConfig(1, 3),
        main: [makeCwlPrepPlayer("#LOW")], subs: [], missing: [],
      },
    ],
    cwlLeagueSignups: {
      preferencesByTag: {
        "#OUT1": { playerTag: "#OUT1", targetRosterId: "top", leagueName: "Top" },
      },
    },
  };
  const plan = generator.planCwlPrepRosterDistribution({
    rosterData,
    strengthByTag: {
      "#IN": { strengthScore: 1 }, "#OUT1": { strengthScore: 2 }, "#OUT2": { strengthScore: 99 },
      "#STRONG": { strengthScore: 100 }, "#LOW": { strengthScore: 50 },
    },
  });

  assert.equal(plan.finalRosterIdByTag["#IN"], "top");
  assert.equal(plan.finalRoleByTag["#IN"], "main");
  assert.equal(plan.finalRosterIdByTag["#OUT1"], "top", "the eligible voter consumes the only sub slot");
  assert.equal(plan.finalRoleByTag["#OUT1"], "sub");
  assert.equal(plan.finalRosterIdByTag["#OUT2"], "low", "Locked-Out must not pin a player to an over-capacity roster");
  assert.equal(plan.finalRosterIdByTag["#STRONG"], "low", "Locked-In and the voter consume both hard slots");
  assert.equal(plan.rosterResults[0].expectedMainCount, 1);
  assert.equal(plan.rosterResults[0].expectedSubCount, 1);
});

test("CWL prep turns a Locked-Out vote conflict into a real vote move", () => {
  const generator = loadGenerator();
  const rosterData = {
    rosterOrder: ["top", "low"],
    rosters: [
      {
        id: "top", trackingMode: "cwl",
        cwlPreparation: makeCwlPrepConfig(1, 0, { lockStateByTag: { "#OUT": "lockedOut" } }),
        main: [makeCwlPrepPlayer("#TOP")], subs: [makeCwlPrepPlayer("#OUT")], missing: [],
      },
      {
        id: "low", trackingMode: "cwl", cwlPreparation: makeCwlPrepConfig(1, 1),
        main: [makeCwlPrepPlayer("#LOW")], subs: [], missing: [],
      },
    ],
    cwlLeagueSignups: {
      preferencesByTag: {
        "#OUT": { playerTag: "#OUT", targetRosterId: "low", leagueName: "Low" },
      },
    },
  };
  const plan = generator.planCwlPrepRosterDistribution({
    rosterData,
    strengthByTag: {
      "#TOP": { strengthScore: 100 }, "#LOW": { strengthScore: 90 }, "#OUT": { strengthScore: 80 },
    },
  });

  assert.equal(plan.preferencePlan.summary.validMoveCount, 1);
  assert.equal(plan.preferencePlan.summary.conflictCount, 0);
  assert.equal(plan.preferencePlan.moves[0].allowLockedOutMove, true);
  assert.equal(plan.finalRosterIdByTag["#OUT"], "low");
  assert.equal(plan.finalRoleByTag["#OUT"], "sub");
});

test("CWL prep hard requirements override both a vote and Locked-In and cascade until eligible", () => {
  const generator = loadGenerator();
  const rosterData = {
    rosterOrder: ["top", "mid", "low"],
    rosters: [
      {
        id: "top", trackingMode: "cwl",
        cwlPreparation: makeCwlPrepConfig(1, 1, {
          lockStateByTag: { "#MISS": "lockedIn" },
          requirements: { minTownHall: 17, maxMissedAttacks: 0, maxMissedAttackRate: 0.25 },
        }),
        main: [makeCwlPrepPlayer("#GOOD", 17)],
        subs: [makeCwlPrepPlayer("#MISS", 17), makeCwlPrepPlayer("#TH16", 16)], missing: [],
      },
      {
        id: "mid", trackingMode: "cwl",
        cwlPreparation: makeCwlPrepConfig(2, 1, {
          requirements: { minTownHall: 16, maxMissedAttacks: 1, maxMissedAttackRate: 0.6 },
        }),
        main: [makeCwlPrepPlayer("#MID", 17)], subs: [], missing: [],
      },
      {
        id: "low", trackingMode: "cwl", cwlPreparation: makeCwlPrepConfig(1, 1),
        main: [makeCwlPrepPlayer("#LOW", 15)], subs: [], missing: [],
      },
    ],
    cwlLeagueSignups: {
      preferencesByTag: {
        "#MISS": { playerTag: "#MISS", targetRosterId: "top", leagueName: "Top" },
      },
    },
  };
  const plan = generator.planCwlPrepRosterDistribution({
    rosterData,
    strengthByTag: {
      "#GOOD": { strengthScore: 100, th: 17, missedAttacks: 0, resolvedWarDays: 2 },
      "#MISS": { strengthScore: 99, th: 17, missedAttacks: 1, resolvedWarDays: 2 },
      "#TH16": { strengthScore: 98, th: 16, missedAttacks: 0, resolvedWarDays: 2 },
      "#MID": { strengthScore: 80, th: 17, missedAttacks: 0, resolvedWarDays: 2 },
      "#LOW": { strengthScore: 70, th: 15, missedAttacks: 0, resolvedWarDays: 2 },
    },
  });

  assert.equal(plan.finalRosterIdByTag["#MISS"], "mid", "requirements must override a vote and Locked-In");
  assert.equal(plan.finalRosterIdByTag["#TH16"], "mid");
  assert.equal(plan.rosterResults[0].requirementsMovedDownCount, 2);
  assert.equal(plan.rosterResults[0].requirementFailureCounts.minTownHall, 1);
  assert.equal(plan.rosterResults[0].requirementFailureCounts.maxMissedAttacks, 1);
  assert.equal(plan.rosterResults[0].requirementFailureCounts.maxMissedAttackRate, 1);
  assert.equal(plan.summary.requirementsMoveCount, 2);
  const missedMove = plan.cascadeMoves.find((move) => move.playerTag === "#MISS");
  assert.equal(missedMove.reason, "requirements");
  assert.equal(missedMove.requirementFailures.map((failure) => failure.key).join(","), "maxMissedAttacks,maxMissedAttackRate");
  assert.equal(plan.finalRoleByTag["#MISS"], "main", "the transferred Locked-In state consumes a lower-roster main slot");
});

test("CWL prep missed-attack rate uses attack opportunities before the legacy war-day fallback", () => {
  const generator = loadGenerator();
  const rosterData = {
    rosterOrder: ["top", "low"],
    rosters: [
      {
        id: "top", trackingMode: "cwl",
        cwlPreparation: makeCwlPrepConfig(1, 0, { requirements: { maxMissedAttackRate: 0.25 } }),
        main: [makeCwlPrepPlayer("#RATE")], subs: [], missing: [],
      },
      {
        id: "low", trackingMode: "cwl", cwlPreparation: makeCwlPrepConfig(1, 0),
        main: [makeCwlPrepPlayer("#LOW")], subs: [], missing: [],
      },
    ],
    cwlLeagueSignups: { preferencesByTag: {} },
  };
  const plan = generator.planCwlPrepRosterDistribution({
    rosterData,
    strengthByTag: {
      "#RATE": { strengthScore: 100, missedAttacks: 2, attackOpportunities: 10, resolvedWarDays: 2 },
      "#LOW": { strengthScore: 90 },
    },
  });

  assert.equal(plan.finalRosterIdByTag["#RATE"], "top");
  assert.equal(plan.summary.requirementsMoveCount, 0);
});

test("CWL prep fails preflight when total configured capacity cannot conserve the active pool", () => {
  const generator = loadGenerator();
  const prep = makeCwlPrepConfig(1, 0);
  const rosterData = {
    rosterOrder: ["top", "low"],
    rosters: [
      { id: "top", trackingMode: "cwl", cwlPreparation: { ...prep }, main: [makeCwlPrepPlayer("#A")], subs: [makeCwlPrepPlayer("#B")], missing: [] },
      { id: "low", trackingMode: "cwl", cwlPreparation: { ...prep }, main: [makeCwlPrepPlayer("#C")], subs: [], missing: [] },
    ],
    cwlLeagueSignups: { preferencesByTag: {} },
  };
  const before = JSON.stringify(rosterData);
  assert.throws(
    () => generator.planCwlPrepRosterDistribution({ rosterData, strengthByTag: {} }),
    (error) => {
      assert.equal(error.code, "CWL_PREP_DISTRIBUTION_INFEASIBLE");
      assert.equal(error.details.reason, "total-capacity");
      assert.equal(error.details.unplacedCount, 1);
      assert.match(error.message, /1 more spot is required/i);
      return true;
    }
  );
  assert.equal(JSON.stringify(rosterData), before);
});

test("CWL prep final roster rejects players that fail requirements instead of retaining overflow", () => {
  const generator = loadGenerator();
  const requirements = { minTownHall: 17, maxMissedAttacks: 0, maxMissedAttackRate: 0 };
  const rosterData = {
    rosterOrder: ["top", "low"],
    rosters: [
      {
        id: "top", trackingMode: "cwl", cwlPreparation: makeCwlPrepConfig(1, 0, { requirements }),
        main: [makeCwlPrepPlayer("#GOOD", 17)], subs: [makeCwlPrepPlayer("#BAD", 16)], missing: [],
      },
      {
        id: "low", trackingMode: "cwl", cwlPreparation: makeCwlPrepConfig(1, 1, { requirements }),
        main: [makeCwlPrepPlayer("#LOW", 17)], subs: [], missing: [],
      },
    ],
    cwlLeagueSignups: { preferencesByTag: {} },
  };
  const before = JSON.stringify(rosterData);
  assert.throws(
    () => generator.planCwlPrepRosterDistribution({
      rosterData,
      strengthByTag: {
        "#GOOD": { strengthScore: 100, th: 17 }, "#BAD": { strengthScore: 90, th: 16 }, "#LOW": { strengthScore: 80, th: 17 },
      },
    }),
    (error) => {
      assert.equal(error.code, "CWL_PREP_DISTRIBUTION_INFEASIBLE");
      assert.equal(error.details.reason, "final-roster-unplaced");
      assert.equal(error.details.requirementsRejectedCount, 1);
      assert.equal(Array.from(error.details.playerTags).join(","), "#BAD");
      assert.match(error.message, /final roster low/i);
      return true;
    }
  );
  assert.equal(JSON.stringify(rosterData), before);
});

test("CWL prep final roster enforces capacity even when an upper roster has unused spots", () => {
  const generator = loadGenerator();
  const rosterData = {
    rosterOrder: ["top", "low"],
    rosters: [
      {
        id: "top", trackingMode: "cwl", cwlPreparation: makeCwlPrepConfig(1, 1),
        main: [makeCwlPrepPlayer("#TOP")], subs: [], missing: [],
      },
      {
        id: "low", trackingMode: "cwl", cwlPreparation: makeCwlPrepConfig(1, 0),
        main: [makeCwlPrepPlayer("#LOW1")], subs: [makeCwlPrepPlayer("#LOW2")], missing: [],
      },
    ],
    cwlLeagueSignups: { preferencesByTag: {} },
  };
  const before = JSON.stringify(rosterData);
  assert.throws(
    () => generator.planCwlPrepRosterDistribution({
      rosterData,
      strengthByTag: {
        "#TOP": { strengthScore: 100 }, "#LOW1": { strengthScore: 90 }, "#LOW2": { strengthScore: 80 },
      },
    }),
    (error) => {
      assert.equal(error.code, "CWL_PREP_DISTRIBUTION_INFEASIBLE");
      assert.equal(error.details.reason, "final-roster-unplaced");
      assert.equal(error.details.capacityRejectedCount, 1);
      assert.equal(error.details.requirementsRejectedCount, 0);
      assert.match(error.message, /exceeds usable capacity/i);
      return true;
    }
  );
  assert.equal(JSON.stringify(rosterData), before);
});

test("CWL prep final roster rejects excess Locked-Out players when no sub slot exists", () => {
  const generator = loadGenerator();
  const rosterData = {
    rosterOrder: ["top", "low"],
    rosters: [
      {
        id: "top", trackingMode: "cwl", cwlPreparation: makeCwlPrepConfig(1, 1),
        main: [makeCwlPrepPlayer("#TOP")], subs: [], missing: [],
      },
      {
        id: "low", trackingMode: "cwl",
        cwlPreparation: makeCwlPrepConfig(1, 0, { lockStateByTag: { "#OUT": "lockedOut" } }),
        main: [makeCwlPrepPlayer("#LOW")], subs: [makeCwlPrepPlayer("#OUT")], missing: [],
      },
    ],
    cwlLeagueSignups: { preferencesByTag: {} },
  };
  assert.throws(
    () => generator.planCwlPrepRosterDistribution({ rosterData, strengthByTag: {} }),
    (error) => {
      assert.equal(error.code, "CWL_PREP_DISTRIBUTION_INFEASIBLE");
      assert.equal(error.details.reason, "final-roster-unplaced");
      assert.equal(error.details.lockedOutRoleCount, 1);
      assert.match(error.message, /Locked-Out player has no available sub slot/i);
      return true;
    }
  );
});

test("CWL prep cascades excess eligible Locked-In players from a nonterminal roster", () => {
  const generator = loadGenerator();
  const rosterData = {
    rosterOrder: ["top", "mid", "low"],
    rosters: [
      {
        id: "top", trackingMode: "cwl",
        cwlPreparation: makeCwlPrepConfig(1, 2, { lockStateByTag: { "#IN1": "lockedIn", "#IN2": "lockedIn" } }),
        main: [makeCwlPrepPlayer("#IN1")], subs: [makeCwlPrepPlayer("#IN2")], missing: [],
      },
      {
        id: "mid", trackingMode: "cwl", cwlPreparation: makeCwlPrepConfig(1, 1),
        main: [makeCwlPrepPlayer("#MID")], subs: [], missing: [],
      },
      {
        id: "low", trackingMode: "cwl", cwlPreparation: makeCwlPrepConfig(1, 1),
        main: [makeCwlPrepPlayer("#LOW")], subs: [], missing: [],
      },
    ],
    cwlLeagueSignups: { preferencesByTag: {} },
  };
  const plan = generator.planCwlPrepRosterDistribution({
    rosterData,
    strengthByTag: {
      "#IN1": { strengthScore: 100 }, "#IN2": { strengthScore: 90 },
      "#MID": { strengthScore: 80 }, "#LOW": { strengthScore: 70 },
    },
  });

  assert.equal(plan.finalRosterIdByTag["#IN1"], "top");
  assert.equal(plan.finalRosterIdByTag["#IN2"], "mid");
  assert.equal(plan.finalRoleByTag["#IN2"], "main");
  const overflowMove = plan.cascadeMoves.find((move) => move.playerTag === "#IN2" && move.fromRosterId === "top");
  assert.equal(overflowMove.reason, "capacity");
  assert.equal(overflowMove.capacityReason, "locked-in-main");
});

test("CWL prep fails clearly when the final roster has more eligible Locked-In players than main slots", () => {
  const generator = loadGenerator();
  const rosterData = {
    rosterOrder: ["top", "low"],
    rosters: [
      {
        id: "top", trackingMode: "cwl", cwlPreparation: makeCwlPrepConfig(1, 1),
        main: [makeCwlPrepPlayer("#TOP")], subs: [], missing: [],
      },
      {
        id: "low", trackingMode: "cwl",
        cwlPreparation: makeCwlPrepConfig(1, 2, { lockStateByTag: { "#IN1": "lockedIn", "#IN2": "lockedIn" } }),
        main: [makeCwlPrepPlayer("#IN1")], subs: [makeCwlPrepPlayer("#IN2")], missing: [],
      },
    ],
    cwlLeagueSignups: { preferencesByTag: {} },
  };
  assert.throws(
    () => generator.planCwlPrepRosterDistribution({ rosterData, strengthByTag: {} }),
    (error) => {
      assert.equal(error.code, "CWL_PREP_DISTRIBUTION_INFEASIBLE");
      assert.equal(error.details.reason, "locked-in-main-capacity");
      assert.equal(error.details.lockedInCount, 2);
      assert.equal(error.details.rosterId, "low");
      return true;
    }
  );
});

test("CWL prep fill mode retains exactly 50 with explicit main and sub counts", () => {
  const generator = loadGenerator();
  const topPlayers = Array.from({ length: 51 }, (_, index) => ({
    slot: null,
    name: "P" + index,
    tag: "#P" + index,
    th: 17,
    notes: [],
  }));
  const rosterData = {
    rosterOrder: ["top", "last"],
    rosters: [
      {
        id: "top", trackingMode: "cwl",
        cwlPreparation: makeCwlPrepConfig(15, 0, { distributionMode: "fill" }),
        main: topPlayers.slice(0, 15), subs: topPlayers.slice(15), missing: [],
      },
      {
        id: "last", trackingMode: "cwl",
        cwlPreparation: makeCwlPrepConfig(5, 0),
        main: [{ slot: 1, name: "Last", tag: "#LAST", th: 17, notes: [] }], subs: [], missing: [],
      },
    ],
    cwlLeagueSignups: { preferencesByTag: {} },
  };
  const strengthByTag = Object.fromEntries(topPlayers.map((entry, index) => [entry.tag, { strengthScore: 100 - index }]));
  strengthByTag["#LAST"] = { strengthScore: 200 };

  const plan = generator.planCwlPrepRosterDistribution({ rosterData, strengthByTag });

  assert.equal(plan.rosterResults[0].capacity, 50);
  assert.equal(plan.rosterResults[0].afterCount, 50);
  assert.equal(plan.rosterResults[0].expectedMainCount, 15);
  assert.equal(plan.rosterResults[0].expectedSubCount, 35);
  assert.equal(plan.rosterResults[0].targetMet, true);
  assert.equal(plan.rosterResults[0].movedDownCount, 1);
  assert.equal(plan.rosterResults[1].terminalOverflowCount, 0);
  assert.equal(plan.summary.playerCount, 52);
  assert.equal(Object.keys(plan.finalRosterIdByTag).length, 52);
});

test("CWL prep global assignment preserves a required sub slot instead of failing greedily", () => {
  const generator = loadGenerator();
  const rosterData = {
    rosterOrder: ["top", "low"],
    rosters: [
      {
        id: "top", trackingMode: "cwl",
        cwlPreparation: makeCwlPrepConfig(1, 1, { lockStateByTag: { "#OUT": "lockedOut" } }),
        main: [makeCwlPrepPlayer("#A")],
        subs: [makeCwlPrepPlayer("#B"), makeCwlPrepPlayer("#OUT")], missing: [],
      },
      {
        id: "low", trackingMode: "cwl", cwlPreparation: makeCwlPrepConfig(1, 0),
        main: [], subs: [], missing: [],
      },
    ],
    cwlLeagueSignups: { preferencesByTag: {} },
  };
  const before = JSON.stringify(rosterData);
  const args = {
    rosterData,
    strengthByTag: {
      "#A": { strengthScore: 100 }, "#B": { strengthScore: 90 }, "#OUT": { strengthScore: 10 },
    },
  };

  const plan = generator.planCwlPrepRosterDistribution(args);
  const repeatedPlan = generator.planCwlPrepRosterDistribution(args);

  assert.equal(JSON.stringify(rosterData), before, "global planning must remain pure");
  assert.equal(JSON.stringify(plan), JSON.stringify(repeatedPlan), "the selected feasible assignment must be deterministic");
  assert.equal(plan.finalRosterIdByTag["#A"], "top");
  assert.equal(plan.finalRoleByTag["#A"], "main");
  assert.equal(plan.finalRosterIdByTag["#OUT"], "top", "the only sub-only player must consume the available sub slot");
  assert.equal(plan.finalRoleByTag["#OUT"], "sub");
  assert.equal(plan.finalRosterIdByTag["#B"], "low");
  assert.equal(plan.finalRoleByTag["#B"], "main");
  assert.equal(plan.summary.conserved, true);
  assert.equal(Object.keys(plan.finalRosterIdByTag).length, 3);
});

test("CWL prep permits an underfilled main roster to retain a valid Locked-Out sub", () => {
  const generator = loadGenerator();
  const rosterData = {
    rosterOrder: ["top", "low"],
    rosters: [
      {
        id: "top", trackingMode: "cwl",
        cwlPreparation: makeCwlPrepConfig(2, 1, { lockStateByTag: { "#OUT": "lockedOut" } }),
        main: [makeCwlPrepPlayer("#A")], subs: [makeCwlPrepPlayer("#OUT")], missing: [],
      },
      {
        id: "low", trackingMode: "cwl", cwlPreparation: makeCwlPrepConfig(1, 0),
        main: [makeCwlPrepPlayer("#LOW")], subs: [], missing: [],
      },
    ],
    cwlLeagueSignups: { preferencesByTag: {} },
  };

  const plan = generator.planCwlPrepRosterDistribution({
    rosterData,
    strengthByTag: {
      "#A": { strengthScore: 100 }, "#OUT": { strengthScore: 90 }, "#LOW": { strengthScore: 80 },
    },
  });

  assert.equal(plan.rosterResults[0].expectedMainCount, 1);
  assert.equal(plan.rosterResults[0].expectedSubCount, 1);
  assert.equal(plan.rosterResults[0].afterCount, 2);
  assert.equal(plan.rosterResults[0].targetMet, false);
  assert.equal(plan.finalRosterIdByTag["#OUT"], "top");
  assert.equal(plan.finalRoleByTag["#OUT"], "sub");
  assert.equal(plan.summary.conserved, true);
});

test("CWL prep uses one assignment solve across many active rosters", () => {
  const generator = loadGenerator();
  const rosterOrder = Array.from({ length: 12 }, (_, index) => "r" + index);
  const rosters = rosterOrder.map((rosterId, index) => ({
    id: rosterId,
    trackingMode: "cwl",
    cwlPreparation: makeCwlPrepConfig(1, 1),
    main: [makeCwlPrepPlayer("#M" + index)],
    subs: [makeCwlPrepPlayer("#S" + index)],
    missing: [],
  }));
  const strengthByTag = {};
  for (let index = 0; index < rosterOrder.length; index++) {
    strengthByTag["#M" + index] = { strengthScore: 1000 - (index * 2) };
    strengthByTag["#S" + index] = { strengthScore: 999 - (index * 2) };
  }

  const plan = generator.planCwlPrepRosterDistribution({
    rosterData: { rosterOrder, rosters, cwlLeagueSignups: { preferencesByTag: {} } },
    strengthByTag,
  });

  assert.equal(plan.summary.activeRosterCount, 12);
  assert.equal(plan.summary.solverRunCount, 1);
  assert.equal(plan.summary.playerCount, 24);
  assert.equal(plan.summary.conserved, true);
  assert.equal(Object.keys(plan.finalRosterIdByTag).length, 24);
});

test("CWL prep global assignment keeps a constrained player where it remains feasible", () => {
  const generator = loadGenerator();
  const rosterData = {
    rosterOrder: ["top", "low"],
    rosters: [
      {
        id: "top", trackingMode: "cwl", cwlPreparation: makeCwlPrepConfig(1, 0),
        main: [makeCwlPrepPlayer("#FLEX", 17)], subs: [makeCwlPrepPlayer("#CONSTRAINED", 16)], missing: [],
      },
      {
        id: "low", trackingMode: "cwl",
        cwlPreparation: makeCwlPrepConfig(1, 0, { requirements: { minTownHall: 17 } }),
        main: [], subs: [], missing: [],
      },
    ],
    cwlLeagueSignups: { preferencesByTag: {} },
  };

  const plan = generator.planCwlPrepRosterDistribution({
    rosterData,
    strengthByTag: {
      "#FLEX": { strengthScore: 100, th: 17 },
      "#CONSTRAINED": { strengthScore: 10, th: 16 },
    },
  });

  assert.equal(plan.finalRosterIdByTag["#CONSTRAINED"], "top");
  assert.equal(plan.finalRosterIdByTag["#FLEX"], "low");
  assert.equal(plan.finalRoleByTag["#CONSTRAINED"], "main");
  assert.equal(plan.finalRoleByTag["#FLEX"], "main");
  assert.equal(plan.summary.conserved, true);
});

test("CWL prep rejects real and converted Locked-Out moves to a prep-disabled roster", () => {
  const generator = loadGenerator();
  const rosterData = {
    rosterOrder: ["top", "low", "disabled"],
    rosters: [
      {
        id: "top", trackingMode: "cwl",
        cwlPreparation: makeCwlPrepConfig(1, 1, { lockStateByTag: { "#OUT": "lockedOut" } }),
        main: [makeCwlPrepPlayer("#VOTE")], subs: [makeCwlPrepPlayer("#OUT")], missing: [],
      },
      {
        id: "low", trackingMode: "cwl", cwlPreparation: makeCwlPrepConfig(1, 0),
        main: [makeCwlPrepPlayer("#LOW")], subs: [], missing: [],
      },
      {
        id: "disabled", trackingMode: "cwl", cwlPreparation: { enabled: false, rosterSize: 1 },
        main: [], subs: [], missing: [],
      },
    ],
    cwlLeagueSignups: {
      preferencesByTag: {
        "#VOTE": { playerTag: "#VOTE", targetRosterId: "disabled", leagueName: "Disabled" },
        "#OUT": { playerTag: "#OUT", targetRosterId: "disabled", leagueName: "Disabled" },
      },
    },
  };
  const before = JSON.stringify(rosterData);
  const preferencePlan = generator.planCwlLeaguePreferenceMoves({ rosterData });
  assert.equal(preferencePlan.summary.validMoveCount, 1, "the standalone preference planner remains roster-agnostic");
  assert.equal(preferencePlan.summary.conflictCount, 1);

  assert.throws(
    () => generator.planCwlPrepRosterDistribution({ rosterData, strengthByTag: {} }),
    (error) => {
      assert.equal(error.code, "CWL_PREP_DISTRIBUTION_INFEASIBLE");
      assert.equal(error.details.reason, "preference-target-prep-disabled");
      assert.equal(error.details.violationCount, 2);
      assert.equal(error.details.playerTags.join(","), "#OUT,#VOTE");
      assert.ok(error.details.violations.every((item) => item.targetRosterId === "disabled"));
      return true;
    }
  );
  assert.equal(JSON.stringify(rosterData), before);
});

test("CWL prep allows an already-correct vote on a prep-disabled roster", () => {
  const generator = loadGenerator();
  const rosterData = {
    rosterOrder: ["top", "low", "disabled"],
    rosters: [
      {
        id: "top", trackingMode: "cwl", cwlPreparation: makeCwlPrepConfig(1, 0),
        main: [makeCwlPrepPlayer("#TOP")], subs: [], missing: [],
      },
      {
        id: "low", trackingMode: "cwl", cwlPreparation: makeCwlPrepConfig(1, 0),
        main: [makeCwlPrepPlayer("#LOW")], subs: [], missing: [],
      },
      {
        id: "disabled", trackingMode: "cwl", cwlPreparation: { enabled: false, rosterSize: 1 },
        main: [makeCwlPrepPlayer("#STAY")], subs: [], missing: [],
      },
    ],
    cwlLeagueSignups: {
      preferencesByTag: {
        "#STAY": { playerTag: "#STAY", targetRosterId: "disabled", leagueName: "Disabled" },
      },
    },
  };

  const plan = generator.planCwlPrepRosterDistribution({ rosterData, strengthByTag: {} });

  assert.equal(plan.preferencePlan.summary.alreadyCorrectCount, 1);
  assert.equal(plan.preferencePlan.summary.validMoveCount, 0);
  assert.equal(plan.finalRosterIdByTag["#STAY"], "disabled");
  assert.equal(plan.summary.conserved, true);
});

test("CWL prep allows a Locked-In conflict targeting a prep-disabled roster", () => {
  const generator = loadGenerator();
  const rosterData = {
    rosterOrder: ["top", "low", "disabled"],
    rosters: [
      {
        id: "top", trackingMode: "cwl",
        cwlPreparation: makeCwlPrepConfig(1, 0, { lockStateByTag: { "#LOCK": "lockedIn" } }),
        main: [makeCwlPrepPlayer("#LOCK")], subs: [], missing: [],
      },
      {
        id: "low", trackingMode: "cwl", cwlPreparation: makeCwlPrepConfig(1, 0),
        main: [makeCwlPrepPlayer("#LOW")], subs: [], missing: [],
      },
      {
        id: "disabled", trackingMode: "cwl", cwlPreparation: { enabled: false, rosterSize: 1 },
        main: [], subs: [], missing: [],
      },
    ],
    cwlLeagueSignups: {
      preferencesByTag: {
        "#LOCK": { playerTag: "#LOCK", targetRosterId: "disabled", leagueName: "Disabled" },
      },
    },
  };

  const plan = generator.planCwlPrepRosterDistribution({ rosterData, strengthByTag: {} });

  assert.equal(plan.preferencePlan.summary.conflictCount, 1);
  assert.equal(plan.preferencePlan.summary.validMoveCount, 0);
  assert.equal(plan.finalRosterIdByTag["#LOCK"], "top");
  assert.equal(plan.finalRoleByTag["#LOCK"], "main");
  assert.equal(plan.summary.conserved, true);
});

test("CWL prep distribution rejects duplicate tags before planning any move", () => {
  const generator = loadGenerator();
  const prep = makeCwlPrepConfig(5, 0);
  const rosterData = {
    rosterOrder: ["a", "b"],
    rosters: [
      { id: "a", trackingMode: "cwl", cwlPreparation: prep, main: [{ tag: "#DUP", th: 17 }], subs: [], missing: [] },
      { id: "b", trackingMode: "cwl", cwlPreparation: prep, main: [{ tag: "#DUP", th: 16 }], subs: [], missing: [] },
    ],
    cwlLeagueSignups: { preferencesByTag: {} },
  };

  assert.throws(
    () => generator.planCwlPrepRosterDistribution({ rosterData, strengthByTag: {} }),
    /duplicate player tag: #DUP/i
  );
});
