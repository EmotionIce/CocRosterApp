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

test("CWL prep distribution protects roster voters and cascades only below-cutoff non-voters", () => {
  const generator = loadGenerator();
  const makePlayer = (tag, th = 17) => ({ slot: null, name: tag, tag, th, notes: [] });
  const prep = (rosterSize, substituteCount = 0, lockStateByTag = {}) => ({
    enabled: true,
    rosterSize,
    distributionMode: "subs",
    substituteCount,
    lockStateByTag,
  });
  const rosterData = {
    rosterOrder: ["top", "mid", "low"],
    rosters: [
      {
        id: "top", trackingMode: "cwl", cwlPreparation: prep(2),
        main: [makePlayer("#A"), makePlayer("#B")],
        subs: [makePlayer("#C"), makePlayer("#D")], missing: [],
      },
      {
        id: "mid", trackingMode: "cwl", cwlPreparation: prep(2, 0, { "#G": "lockedOut" }),
        main: [makePlayer("#E"), makePlayer("#F")],
        subs: [makePlayer("#G")], missing: [],
      },
      {
        id: "low", trackingMode: "cwl", cwlPreparation: prep(2),
        main: [makePlayer("#H"), makePlayer("#I")], subs: [], missing: [],
      },
    ],
    cwlLeagueSignups: {
      preferencesByTag: {
        "#D": { playerTag: "#D", targetRosterId: "top", leagueName: "Top" },
      },
    },
  };
  const strengthByTag = {
    "#A": { strengthScore: 100 }, "#B": { strengthScore: 90 },
    "#C": { strengthScore: 80 }, "#D": { strengthScore: 10 },
    "#E": { strengthScore: 70 }, "#F": { strengthScore: 60 },
    "#G": { strengthScore: 50 }, "#H": { strengthScore: 40 }, "#I": { strengthScore: 30 },
  };
  const before = JSON.stringify(rosterData);

  const plan = generator.planCwlPrepRosterDistribution({ rosterData, strengthByTag });

  assert.equal(JSON.stringify(rosterData), before);
  assert.equal(plan.finalRosterIdByTag["#D"], "top", "a voter for the current roster must stay even below cutoff");
  assert.equal(plan.finalRosterIdByTag["#C"], "mid");
  assert.equal(plan.finalRosterIdByTag["#F"], "low");
  assert.equal(plan.finalRosterIdByTag["#G"], "mid", "manual prep locks must prevent automatic cross-roster moves");
  assert.equal(plan.summary.playerCount, 9);
  assert.equal(plan.summary.cascadeMoveCount, 2);
  assert.equal(plan.summary.shiftedPlayerCount, 2);
  assert.equal(plan.summary.conserved, true);
  assert.equal(plan.rosterResults[0].preferredOutsideCutoffCount, 1);
});

test("CWL prep distribution applies votes first and preserves the strongest non-voter cutoff", () => {
  const generator = loadGenerator();
  const player = (tag, score) => ({ slot: null, name: tag, tag, th: score, notes: [] });
  const prep = { enabled: true, rosterSize: 1, distributionMode: "subs", substituteCount: 0, lockStateByTag: {} };
  const rosterData = {
    rosterOrder: ["one", "two", "three"],
    rosters: [
      { id: "one", trackingMode: "cwl", cwlPreparation: { ...prep }, main: [player("#KEEP", 20)], subs: [player("#VOTE", 1)], missing: [] },
      { id: "two", trackingMode: "cwl", cwlPreparation: { ...prep }, main: [player("#TWO", 19)], subs: [], missing: [] },
      { id: "three", trackingMode: "cwl", cwlPreparation: { ...prep }, main: [player("#THREE", 18)], subs: [], missing: [] },
    ],
    cwlLeagueSignups: {
      preferencesByTag: {
        "#VOTE": { playerTag: "#VOTE", targetRosterId: "two", leagueName: "Two" },
      },
    },
  };
  const plan = generator.planCwlPrepRosterDistribution({
    rosterData,
    strengthByTag: {
      "#KEEP": { strengthScore: 100 }, "#TWO": { strengthScore: 90 },
      "#THREE": { strengthScore: 80 }, "#VOTE": { strengthScore: 1 },
    },
  });

  assert.equal(plan.preferencePlan.summary.validMoveCount, 1);
  assert.equal(plan.finalRosterIdByTag["#VOTE"], "two", "the selected roster protects the voter from its cutoff");
  assert.equal(plan.finalRosterIdByTag["#TWO"], "two");
  assert.equal(plan.rosterResults[1].preferredOutsideCutoffCount, 1);
  assert.equal(plan.summary.playerCount, 4);
  assert.equal(Object.keys(plan.finalRosterIdByTag).length, 4);
});

test("CWL prep fill mode uses a cutoff of 50 and preserves final-roster overflow", () => {
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
        cwlPreparation: { enabled: true, rosterSize: 15, distributionMode: "fill", substituteCount: 0, lockStateByTag: {} },
        main: topPlayers.slice(0, 15), subs: topPlayers.slice(15), missing: [],
      },
      {
        id: "last", trackingMode: "cwl",
        cwlPreparation: { enabled: true, rosterSize: 5, distributionMode: "subs", substituteCount: 0, lockStateByTag: {} },
        main: [{ slot: 1, name: "Last", tag: "#LAST", th: 17, notes: [] }], subs: [], missing: [],
      },
    ],
    cwlLeagueSignups: { preferencesByTag: {} },
  };
  const strengthByTag = Object.fromEntries(topPlayers.map((entry, index) => [entry.tag, { strengthScore: 100 - index }]));
  strengthByTag["#LAST"] = { strengthScore: 200 };

  const plan = generator.planCwlPrepRosterDistribution({ rosterData, strengthByTag });

  assert.equal(plan.rosterResults[0].capacity, 50);
  assert.equal(plan.rosterResults[0].movedDownCount, 1);
  assert.equal(plan.rosterResults[1].terminalOverflowCount, 0);
  assert.equal(plan.summary.playerCount, 52);
  assert.equal(Object.keys(plan.finalRosterIdByTag).length, 52);
});

test("CWL prep distribution rejects duplicate tags before planning any move", () => {
  const generator = loadGenerator();
  const prep = { enabled: true, rosterSize: 5, distributionMode: "subs", substituteCount: 0, lockStateByTag: {} };
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
