import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const repoRoot = new URL("../", import.meta.url);
const appScriptFiles = [
  "script/config.gs",
  "script/cocApi.gs",
  "script/rosterDomain.gs",
  "script/warDomain.gs",
  "script/firebaseStore.gs",
  "script/metricsTracking.gs",
  "script/rosterSchema.gs",
];

const loadBackend = () => {
  const code = appScriptFiles
    .map((file) => fs.readFileSync(new URL(file, repoRoot), "utf8"))
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

const buildValidRosterData = () => ({
  schemaVersion: 1,
  pageTitle: "Roster",
  rosterOrder: ["main"],
  rosters: [
    {
      id: "main",
      title: "Main",
      connectedClanTag: "#CLAN",
      trackingMode: "cwl",
      main: [
        {
          slot: 1,
          name: "Player",
          discord: "player",
          th: 16,
          tag: "#PLAYER",
          notes: [],
          excludeAsSwapTarget: false,
          excludeAsSwapSource: false,
        },
      ],
      subs: [],
      missing: [],
    },
  ],
  playerMetrics: {
    schemaVersion: 1,
    updatedAt: "2026-05-19T00:00:00.000Z",
    byTag: {
      "#PLAYER": {
        identity: { tag: "#PLAYER", name: "Player" },
        latestSnapshot: {
          tag: "#PLAYER",
          name: "Player",
          trophies: 5000,
          donations: 10,
          donationsReceived: 5,
          capturedAt: "2026-05-19T00:00:00.000Z",
        },
        trophyHistoryDaily: [],
        donationMonths: {},
      },
    },
  },
});

test("active contract accepts canonical roster players and playerMetrics.byTag", () => {
  const backend = loadBackend();
  const validated = backend.validateRosterData_(buildValidRosterData());

  assert.deepEqual(Object.keys(validated.playerMetrics.byTag), ["#PLAYER"]);
  assert.equal(validated.rosters[0].main[0].discord, "player");
});

test("active contract rejects metric-like fields on roster players", () => {
  const backend = loadBackend();
  const data = buildValidRosterData();
  data.rosters[0].main[0].latestSnapshot = { trophies: 5000 };

  assert.throws(
    () => backend.validateRosterData_(data),
    /metric-like field 'latestSnapshot' is not allowed/
  );
});

test("active contract rejects unsupported roster player fields", () => {
  const backend = loadBackend();
  const data = buildValidRosterData();
  data.rosters[0].main[0].mapPosition = 1;

  assert.throws(
    () => backend.validateRosterData_(data),
    /unsupported field 'mapPosition'/
  );
});

test("active contract rejects roster-scoped playerMetrics", () => {
  const backend = loadBackend();
  const data = buildValidRosterData();
  data.rosters[0].playerMetrics = { byTag: {} };

  assert.throws(
    () => backend.validateRosterData_(data),
    /field 'playerMetrics' is not allowed/
  );
});

test("active contract rejects deeply nested roster playerMetrics", () => {
  const backend = loadBackend();
  const data = buildValidRosterData();
  data.rosters[0].regularWar = {
    currentWar: {
      diagnostics: {
        profile: {
          playerMetrics: { byTag: {} },
        },
      },
    },
  };

  assert.throws(
    () => backend.validateRosterData_(data),
    /nested playerMetrics/
  );
});

test("active contract rejects mismatched playerMetrics byTag identities", () => {
  const backend = loadBackend();
  const data = buildValidRosterData();
  data.playerMetrics.byTag["#PLAYER"].identity.tag = "#OTHER";

  assert.throws(
    () => backend.validateRosterData_(data),
    /does not match entry\.identity\.tag/
  );
});

test("manual cleanup converts known legacy active schema leftovers", () => {
  const backend = loadBackend();
  const data = buildValidRosterData();
  data.playerMetrics = undefined;
  data.metrics = {
    schemaVersion: 1,
    updatedAt: "2026-05-19T00:00:00.000Z",
    byTag: {
      "#PLAYER": {
        identity: { tag: "#OTHER", name: "Player" },
        latestSnapshot: {
          tag: "#PLAYER",
          name: "Player",
          trophies: 5000,
          donations: 10,
          donationsReceived: 5,
          capturedAt: "2026-05-19T00:00:00.000Z",
        },
      },
    },
  };
  data.rosters[0].playerMetrics = { byTag: {} };
  data.rosters[0].main[0].note = "legacy note";
  data.rosters[0].main[0].latestSnapshot = { trophies: 5000 };
  delete data.rosters[0].main[0].notes;

  const repaired = backend.buildManualCleanupActivePayload_(data);

  assert.equal(repaired.stats.convertedNoteFields, 1);
  assert.equal(repaired.stats.droppedRosterMetricStores, 1);
  assert.equal(repaired.stats.migratedRootMetrics, true);
  assert.equal(JSON.stringify(repaired.rosterData.rosters[0].main[0].notes), JSON.stringify(["legacy note"]));
  assert.equal(repaired.rosterData.rosters[0].main[0].latestSnapshot, undefined);
  assert.deepEqual(Object.keys(repaired.rosterData.playerMetrics.byTag), ["#PLAYER"]);
  assert.equal(repaired.rosterData.playerMetrics.byTag["#PLAYER"].identity.tag, "#PLAYER");
});
