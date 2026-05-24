import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const generatorPath = new URL("../cloudflarePages/generator.js", import.meta.url);
const generatorCode = fs.readFileSync(generatorPath, "utf8");
const backendFiles = [
  "script/config.gs",
  "script/cocApi.gs",
  "script/rosterDomain.gs",
  "script/warDomain.gs",
  "script/firebaseStore.gs",
  "script/metricsTracking.gs",
  "script/rosterSchema.gs",
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
