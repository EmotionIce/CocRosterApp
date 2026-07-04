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
  "script/seasonEvents.js",
  "script/publishAndTriggers.js",
  "script/authAndLocks.js",
  "script/assets.js",
  "script/cwlLeagueSignups.js",
  "script/adminApi.js",
  "script/entrypoints.js",
];

const loadBackend = () => {
  const code = appScriptFiles
    .map((file) => fs.readFileSync(new URL(file, repoRoot), "utf8"))
    .join("\n");
  const properties = new Map([["DISCORD_BOT_API_SECRET", "secret"]]);
  const context = {
    Buffer,
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => "Etc/UTC" },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => properties.has(key) ? properties.get(key) : null,
        setProperty: (key, value) => properties.set(key, String(value)),
        setProperties: (values) => {
          for (const [key, value] of Object.entries(values || {})) properties.set(key, String(value));
        },
        deleteProperty: (key) => properties.delete(key),
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
      getUuid: () => "test-uuid-" + Math.random().toString(16).slice(2),
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
        return Buffer.from(bytes || [])
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_");
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
        if (format === "yyyyMMdd'T'HHmmss_SSS'Z'") {
          return iso
            .replace(/[-:]/g, "")
            .replace(".", "_");
        }
        return iso;
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const captureError = (fn) => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  assert.fail("Expected function to throw.");
};

const installActiveRosterWriteHarness = (backend, activeDataRaw) => {
  let activeData = clone(activeDataRaw);
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: activeData, text: JSON.stringify(activeData) });
  backend.replaceActiveRosterData_ = (payload) => {
    activeData = backend.validateRosterData_(payload);
    return { validatedRosterData: activeData, text: JSON.stringify(activeData) };
  };
  return {
    getActiveData: () => activeData,
  };
};

const installMemoryFirebase = (backend, initial = {}) => {
  let db = clone(initial);
  const segmentsFor = (pathRaw) => String(pathRaw ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
  const getNode = (segments, create = false) => {
    let node = db;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (!node[segment]) {
        if (!create) return undefined;
        node[segment] = {};
      }
      if (!create && i === segments.length - 1) return node[segment];
      if (typeof node[segment] !== "object" || Array.isArray(node[segment])) {
        if (!create) return undefined;
        node[segment] = {};
      }
      node = node[segment];
    }
    return node;
  };
  backend.firebaseRequestJson_ = (pathRaw, methodRaw = "GET", payloadRaw) => {
    const method = String(methodRaw || "GET").toUpperCase();
    const segments = segmentsFor(pathRaw);
    if (method === "GET") {
      const node = segments.length ? getNode(segments, false) : db;
      return node === undefined ? null : clone(node);
    }
    if (!segments.length) {
      if (method === "PUT") {
        db = clone(payloadRaw);
        return clone(db);
      }
      if (method === "PATCH") {
        Object.assign(db, clone(payloadRaw));
        return clone(db);
      }
      throw new Error("Unsupported root Firebase method");
    }
    const parent = getNode(segments.slice(0, -1), true);
    const key = segments.at(-1);
    if (method === "PUT") {
      parent[key] = clone(payloadRaw);
      return clone(parent[key]);
    }
    if (method === "PATCH") {
      if (!parent[key] || typeof parent[key] !== "object" || Array.isArray(parent[key])) parent[key] = {};
      Object.assign(parent[key], clone(payloadRaw));
      return clone(parent[key]);
    }
    if (method === "DELETE") {
      delete parent[key];
      return null;
    }
    throw new Error(`Unsupported Firebase method ${method}`);
  };
  backend.firebaseBatchGetJson_ = (pathsRaw) => {
    const paths = Array.isArray(pathsRaw) ? pathsRaw : [];
    const out = {};
    for (const pathRaw of paths) {
      const path = String(pathRaw || "").replace(/^\/+|\/+$/g, "");
      out[path] = backend.firebaseRequestJson_(path, "GET");
    }
    return out;
  };
  backend.__getFirebaseDb = () => db;
  return backend;
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
      },
    },
  },
});

const buildCwlLeagueSignupRosterData = () => ({
  schemaVersion: 1,
  pageTitle: "Roster",
  rosterOrder: ["main", "second"],
  rosters: [
    {
      id: "main",
      title: "Turtle Main",
      connectedClanTag: "#2LUCULP",
      trackingMode: "cwl",
      cwlLeagueName: "Champion I",
      main: [
        {
          slot: 1,
          name: "Alpha",
          discord: "alpha",
          th: 16,
          tag: "#2LUCULP",
          notes: [],
          excludeAsSwapTarget: false,
          excludeAsSwapSource: false,
        },
      ],
      subs: [],
      missing: [],
    },
    {
      id: "second",
      title: "Turtle Second",
      connectedClanTag: "#9PYLQG",
      trackingMode: "cwl",
      cwlLeagueName: "Master II",
      main: [],
      subs: [],
      missing: [],
    },
  ],
  playerMetrics: {
    schemaVersion: 1,
    updatedAt: "2026-05-19T00:00:00.000Z",
    byTag: {
      "#2LUCULP": {
        identity: { tag: "#2LUCULP", name: "Alpha" },
        latestSnapshot: {
          tag: "#2LUCULP",
          name: "Alpha",
          townHallLevel: 16,
          trophies: 5000,
          capturedAt: "2026-05-19T00:00:00.000Z",
        },
        trophyHistoryDaily: [],
      },
    },
  },
});

const buildSameLeagueCwlSignupRosterData = () => ({
  schemaVersion: 1,
  pageTitle: "Roster",
  rosterOrder: ["main", "second"],
  rosters: [
    {
      id: "main",
      title: "Turtle Main",
      connectedClanTag: "#2LUCULP",
      trackingMode: "cwl",
      cwlLeagueName: "Champion I",
      clanName: "Turtle Main",
      main: [{ slot: 1, name: "Alpha", discord: "alpha", th: 16, tag: "#2LUCULP", notes: [] }],
      subs: [],
      missing: [],
    },
    {
      id: "second",
      title: "Turtle Second",
      connectedClanTag: "#9PYLQG",
      trackingMode: "cwl",
      cwlLeagueName: "Champion I",
      clanName: "Turtle Second",
      main: [],
      subs: [],
      missing: [],
    },
  ],
  playerMetrics: { schemaVersion: 1, updatedAt: "2026-05-19T00:00:00.000Z", byTag: {} },
});

const buildSeasonEventRosterData = () => ({
  schemaVersion: 1,
  pageTitle: "Roster",
  rosterOrder: ["main"],
  rosters: [],
  playerMetrics: {
    schemaVersion: 1,
    updatedAt: "2026-05-19T00:00:00.000Z",
    byTag: {
      "#2LUCULP": {
        identity: {
          tag: "#2LUCULP",
          name: "Alpha",
          discordId: "111",
          discordUsername: "alpha",
        },
        latestSnapshot: {
          tag: "#2LUCULP",
          name: "Alpha",
          townHallLevel: 16,
          trophies: 5500,
          donations: 100,
          donationsReceived: 20,
          capturedAt: "2026-05-19T00:00:00.000Z",
          league: { name: "Legend League" },
          leagueTier: { id: 105000036 },
        },
        trophyHistoryDaily: [],
      },
      "#9PYLQG": {
        identity: {
          tag: "#9PYLQG",
          name: "Bravo",
          discordId: "222",
          discordUsername: "bravo",
        },
        latestSnapshot: {
          tag: "#9PYLQG",
          name: "Bravo",
          townHallLevel: 15,
          trophies: 5100,
          donations: 80,
          donationsReceived: 30,
          capturedAt: "2026-05-19T00:00:00.000Z",
          league: { name: "Titan League" },
          leagueTier: { id: 105000027 },
        },
        trophyHistoryDaily: [],
      },
      "#8CCVV": {
        identity: {
          tag: "#8CCVV",
          name: "Charlie",
          discordId: "222",
          discordUsername: "bravo",
        },
        latestSnapshot: {
          tag: "#8CCVV",
          name: "Charlie",
          townHallLevel: 14,
          trophies: 4900,
          donations: 60,
          donationsReceived: 25,
          capturedAt: "2026-05-19T00:00:00.000Z",
          league: { name: "Titan League" },
          leagueTier: { id: 105000026 },
        },
        trophyHistoryDaily: [],
      },
      "#PYYQQ": {
        identity: {
          tag: "#PYYQQ",
          name: "Delta",
          discordId: "333",
          discordUsername: "delta",
        },
        latestSnapshot: {
          tag: "#PYYQQ",
          name: "Delta",
          townHallLevel: 13,
          trophies: 4700,
          donations: 50,
          donationsReceived: 25,
          capturedAt: "2026-05-19T00:00:00.000Z",
          league: { name: "Titan League" },
          leagueTier: { id: 105000025 },
        },
        trophyHistoryDaily: [],
      },
    },
  },
});

const buildSeasonEventLeaderboardRosterData = () => ({
  schemaVersion: 1,
  pageTitle: "Roster",
  rosterOrder: ["main"],
  rosters: [],
  playerMetrics: {
    schemaVersion: 1,
    updatedAt: "2026-05-20T15:00:00.000Z",
    byTag: {
      "#2LUCULP": {
        identity: { tag: "#2LUCULP", name: "Alpha", discordId: "111", discordUsername: "alpha" },
        latestSnapshot: {
          tag: "#2LUCULP",
          name: "Alpha",
          townHallLevel: 16,
          trophies: 5200,
          donations: 150,
          donationsReceived: 40,
          capturedAt: "2026-05-20T15:00:00.000Z",
          league: { name: "Legend League" },
          leagueTier: { id: 105000036 },
        },
        trophyHistoryDaily: [
          { dayKey: "2026-05-18", capturedAt: "2026-05-18T05:00:00.000Z", trophies: 5000, league: { name: "Legend League" }, leagueTier: { id: 105000036 } },
          { dayKey: "2026-05-20", capturedAt: "2026-05-20T15:00:00.000Z", trophies: 5200, league: { name: "Legend League" }, leagueTier: { id: 105000036 } },
        ],
        donationCycles: {
          "ranked-legend-i-2026-05-18": {
            seasonId: "ranked-legend-i-2026-05-18",
            startsAt: "2026-05-18T05:00:00.000Z",
            endsAt: "2026-06-15T05:00:00.000Z",
            rawDonationsLastSeen: 150,
            rawDonationsReceivedLastSeen: 40,
            cycleTotalDonations: 150,
            cycleTotalDonationsReceived: 40,
            firstSeenAt: "2026-05-18T05:00:00.000Z",
            lastSeenAt: "2026-05-20T15:00:00.000Z",
            lastClanTag: "#CLAN",
            resetCount: 0,
            receivedResetCount: 0,
          },
        },
      },
      "#9PYLQG": {
        identity: { tag: "#9PYLQG", name: "Bravo", discordId: "222", discordUsername: "bravo" },
        latestSnapshot: {
          tag: "#9PYLQG",
          name: "Bravo",
          townHallLevel: 15,
          trophies: 5600,
          donations: 200,
          donationsReceived: 50,
          capturedAt: "2026-05-20T15:00:00.000Z",
          league: { name: "Titan League" },
          leagueTier: { id: 105000027 },
        },
        trophyHistoryDaily: [
          { dayKey: "2026-05-18", capturedAt: "2026-05-18T05:00:00.000Z", trophies: 5050, league: { name: "Titan League" }, leagueTier: { id: 105000027 } },
          { dayKey: "2026-05-20", capturedAt: "2026-05-20T15:00:00.000Z", trophies: 5600, league: { name: "Titan League" }, leagueTier: { id: 105000027 } },
        ],
        donationCycles: {
          "ranked-legend-i-2026-05-18": {
            seasonId: "ranked-legend-i-2026-05-18",
            startsAt: "2026-05-18T05:00:00.000Z",
            endsAt: "2026-06-15T05:00:00.000Z",
            rawDonationsLastSeen: 200,
            rawDonationsReceivedLastSeen: 50,
            cycleTotalDonations: 200,
            cycleTotalDonationsReceived: 50,
            firstSeenAt: "2026-05-18T05:00:00.000Z",
            lastSeenAt: "2026-05-20T15:00:00.000Z",
            lastClanTag: "#CLAN",
            resetCount: 0,
            receivedResetCount: 0,
          },
        },
      },
      "#8CCVV": {
        identity: { tag: "#8CCVV", name: "Charlie", discordId: "222", discordUsername: "bravo" },
        latestSnapshot: {
          tag: "#8CCVV",
          name: "Charlie",
          townHallLevel: 14,
          trophies: 4900,
          donations: 75,
          donationsReceived: 30,
          capturedAt: "2026-05-20T15:00:00.000Z",
          league: { name: "Titan League" },
          leagueTier: { id: 105000026 },
        },
        trophyHistoryDaily: [
          { dayKey: "2026-05-20", capturedAt: "2026-05-20T15:00:00.000Z", trophies: 4900, league: { name: "Titan League" }, leagueTier: { id: 105000026 } },
        ],
        donationCycles: {
          "ranked-legend-i-2026-05-18": {
            seasonId: "ranked-legend-i-2026-05-18",
            startsAt: "2026-05-18T05:00:00.000Z",
            endsAt: "2026-06-15T05:00:00.000Z",
            rawDonationsLastSeen: 75,
            rawDonationsReceivedLastSeen: 30,
            cycleTotalDonations: 75,
            cycleTotalDonationsReceived: 30,
            firstSeenAt: "2026-05-20T15:00:00.000Z",
            lastSeenAt: "2026-05-20T15:00:00.000Z",
            lastClanTag: "#CLAN",
            resetCount: 0,
            receivedResetCount: 0,
          },
        },
      },
      "#PYYQQ": {
        identity: { tag: "#PYYQQ", name: "Delta", discordId: "444", discordUsername: "delta" },
        latestSnapshot: {
          tag: "#PYYQQ",
          name: "Delta",
          townHallLevel: 16,
          trophies: 6000,
          donations: 10,
          donationsReceived: 5,
          capturedAt: "2026-05-20T15:00:00.000Z",
          league: { name: "Legend League" },
          leagueTier: { id: 105000035 },
        },
        trophyHistoryDaily: [
          { dayKey: "2026-05-19", capturedAt: "2026-05-19T15:00:00.000Z", trophies: 6100, league: { name: "Legend League" }, leagueTier: { id: 105000036 } },
          { dayKey: "2026-05-20", capturedAt: "2026-05-20T15:00:00.000Z", trophies: 6000, league: { name: "Legend League" }, leagueTier: { id: 105000035 } },
        ],
      },
    },
  },
});

const seasonFixture = {
  seasonId: "2026-05",
  startsAt: "2020-01-01T00:00:00.000Z",
  endsAt: "2100-01-01T00:00:00.000Z",
};

const assertRankedSeason = (actual, expected) => {
  assert.equal(actual.seasonId, expected.seasonId);
  assert.equal(actual.startsAt, expected.startsAt);
  assert.equal(actual.endsAt, expected.endsAt);
  assert.equal(actual.source, expected.source || "legend-cycle");
};

test("firebaseRequestJson suppresses write response bodies", () => {
  const backend = loadBackend();
  const requests = [];
  backend.getFirebaseConfig_ = () => ({ dbUrl: "https://firebase.test/db" });
  backend.getFirebaseAccessToken_ = () => "token";
  backend.UrlFetchApp = {
    fetch(url, options) {
      requests.push({ url, options });
      if (String(options.method).toUpperCase() === "GET") {
        return {
          getResponseCode: () => 200,
          getContentText: () => "{\"ok\":true}",
        };
      }
      return {
        getResponseCode: () => 204,
        getContentText: () => "",
      };
    },
  };

  const writeResult = backend.firebaseRequestJson_("active", "PUT", { huge: true });
  const readResult = backend.firebaseRequestJson_("active", "GET");

  assert.equal(writeResult, null);
  assert.equal(readResult.ok, true);
  assert.equal(requests[0].url, "https://firebase.test/db/active.json?print=silent");
  assert.equal(requests[1].url, "https://firebase.test/db/active.json");
  assert.equal(requests[0].options.contentType, "application/json");
  assert.equal(requests[0].options.payload, "{\"huge\":true}");
});

test("Firebase child key listing uses shallow reads", () => {
  const backend = loadBackend();
  const requests = [];
  backend.getFirebaseConfig_ = () => ({ dbUrl: "https://firebase.test/db" });
  backend.getFirebaseAccessToken_ = () => "token";
  backend.UrlFetchApp = {
    fetch(url, options) {
      requests.push({ url, options });
      return {
        getResponseCode: () => 200,
        getContentText: () => "{\"backup-b\":true,\"backup-a\":true}",
      };
    },
  };

  const keys = backend.listFirebaseChildKeys_("archive/publish");

  const sortedKeys = keys.sort();
  assert.equal(sortedKeys.length, 2);
  assert.equal(sortedKeys[0], "backup-a");
  assert.equal(sortedKeys[1], "backup-b");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://firebase.test/db/archive/publish.json?shallow=true");
  assert.equal(String(requests[0].options.method).toUpperCase(), "GET");
});

test("active contract accepts canonical roster players and playerMetrics.byTag", () => {
  const backend = loadBackend();
  const validated = backend.validateRosterData_(buildValidRosterData());

  assert.deepEqual(Object.keys(validated.playerMetrics.byTag), ["#PLAYER"]);
  assert.equal(validated.rosters[0].main[0].discord, "player");
});

test("active reader reconstructs the published active version before legacy active", () => {
  const backend = installMemoryFirebase(loadBackend());
  const versionedData = buildValidRosterData();
  versionedData.pageTitle = "Versioned Roster";
  const legacyData = buildValidRosterData();
  legacyData.pageTitle = "Legacy Active";

  backend.writeActiveRosterVersionShards_("version-1", backend.validateRosterData_(versionedData), {
    publish: true,
    source: "test",
  });
  backend.firebaseRequestJson_("active", "PUT", backend.encodeFirebaseObjectKeysRecursive_(legacyData));
  const originalFirebaseRequestJson = backend.firebaseRequestJson_;
  const reads = [];
  backend.firebaseRequestJson_ = (pathRaw, methodRaw = "GET", payloadRaw, queryParamsRaw) => {
    const path = String(pathRaw || "").replace(/^\/+|\/+$/g, "");
    const method = String(methodRaw || "GET").toUpperCase();
    if (method === "GET") reads.push(path);
    if (method === "GET" && path === "activeVersions/version-1/rosters") {
      throw new Error("active reader should read roster shards individually");
    }
    return originalFirebaseRequestJson(pathRaw, methodRaw, payloadRaw, queryParamsRaw);
  };

  const snapshot = backend.readActiveRosterSnapshot_();

  assert.equal(snapshot.versionId, "version-1");
  assert.equal(snapshot.rosterData.pageTitle, "Versioned Roster");
  assert.equal(snapshot.rosterData.rosters[0].id, "main");
  assert.ok(reads.includes("activeVersions/version-1/manifest"));
  assert.ok(reads.includes("activeVersions/version-1/rosters/main"));
  assert.equal(reads.includes("activeVersions/version-1/rosters"), false);
});

test("storage retention cleanup keeps live active versions and deletes historical storage", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildValidRosterData());
  backend.writeActiveRosterVersionShards_("current-version", data, {
    publish: true,
    source: "test",
  });
  backend.firebaseRequestJson_("activeVersions/old-version", "PUT", { huge: true });
  backend.firebaseRequestJson_("activeVersions/live-run", "PUT", { staging: true });
  backend.firebaseRequestJson_("internal/autoRefresh/runs/old-run", "PUT", { huge: true });
  backend.firebaseRequestJson_("internal/autoRefresh/runs/live-run", "PUT", { needed: true });
  backend.firebaseRequestJson_("internal/autoRefresh/current", "PUT", {
    kind: "auto-refresh-queue",
    runId: "live-run",
    status: "running",
    sourceVersionId: "current-version",
    rosterIds: [],
    taskIds: [],
    taskCount: 0,
  });

  const result = backend.cleanupFirebaseStorageRetention_({ reason: "test" });

  assert.equal(result.ok, true);
  assert.equal(backend.firebaseRequestJson_("activeVersions/current-version", "GET") !== null, true);
  assert.equal(backend.firebaseRequestJson_("activeVersions/live-run", "GET") !== null, true);
  assert.equal(backend.firebaseRequestJson_("activeVersions/old-version", "GET"), null);
  assert.equal(backend.firebaseRequestJson_("internal/autoRefresh/runs/live-run", "GET") !== null, true);
  assert.equal(backend.firebaseRequestJson_("internal/autoRefresh/runs/old-run", "GET"), null);
  assert.equal(result.activeVersions.deletedCount, 1);
  assert.equal(result.autoRefreshRuns.deletedCount, 1);
});

test("storage retention cleanup clears legacy full auto-refresh current state", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    activePublished: {
      currentVersionId: "current-version",
    },
    activeVersions: {
      "current-version": { manifest: { versionId: "current-version" } },
      "old-version": { huge: true },
    },
    internal: {
      autoRefresh: {
        current: {
          kind: "auto-refresh",
          rosterDataDraft: { huge: true },
        },
        runs: {
          "old-run": { huge: true },
        },
      },
    },
  });

  const result = backend.cleanupFirebaseStorageRetention_({ reason: "test" });

  assert.equal(result.legacyAutoRefreshCurrent.deleted, true);
  assert.equal(backend.firebaseRequestJson_("internal/autoRefresh/current", "GET"), null);
  assert.equal(backend.firebaseRequestJson_("internal/autoRefresh/runs/old-run", "GET"), null);
  assert.equal(backend.firebaseRequestJson_("activeVersions/old-version", "GET"), null);
  assert.equal(backend.firebaseRequestJson_("activeVersions/current-version", "GET") !== null, true);
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

test("active contract preserves Discord identity-only playerMetrics entries", () => {
  const backend = loadBackend();
  const data = buildValidRosterData();
  data.playerMetrics.byTag["#PLAYER"] = {
    identity: {
      tag: "#PLAYER",
      name: "Player",
      discordId: "123456789012345678",
      discordUsername: "phuuni",
      discordLinkedAt: "2026-05-19T01:00:00.000Z",
      discordUpdatedAt: "2026-05-19T02:00:00.000Z",
      discordSource: "discord-sync",
    },
    trophyHistoryDaily: [],
  };

  const validated = backend.validateRosterData_(data);
  const identity = validated.playerMetrics.byTag["#PLAYER"].identity;

  assert.equal(identity.discordId, "123456789012345678");
  assert.equal(identity.discordUsername, "phuuni");
  assert.equal(identity.discordLinkedAt, "2026-05-19T01:00:00.000Z");
  assert.equal(identity.discordUpdatedAt, "2026-05-19T02:00:00.000Z");
  assert.equal(identity.discordSource, "discord-sync");
});

test("Discord-only playerMetrics entries do not count as metrics coverage", () => {
  const backend = loadBackend();
  const data = buildValidRosterData();
  data.playerMetrics.byTag["#PLAYER"] = {
    identity: {
      tag: "#PLAYER",
      name: "Player",
      discordUsername: "phuuni",
      discordSource: "discord-sync",
    },
    trophyHistoryDaily: [],
  };

  const validated = backend.validateRosterData_(data);
  const repairs = backend.listRostersNeedingMetricsCoverageRepair_(validated, 0.9);

  assert.equal(backend.countPlayerMetricsEntries_(validated.playerMetrics), 1);
  assert.equal(backend.countPlayerMetricDataEntries_(validated.playerMetrics), 0);
  assert.equal(repairs.length, 1);
  assert.equal(repairs[0].matchedTags, 0);
});

test("real metrics with Discord identity count as metrics coverage", () => {
  const backend = loadBackend();
  const data = buildValidRosterData();
  data.playerMetrics.byTag["#PLAYER"].identity.discordId = "123456789012345678";
  data.playerMetrics.byTag["#PLAYER"].identity.discordUsername = "phuuni";

  const validated = backend.validateRosterData_(data);
  const repairs = backend.listRostersNeedingMetricsCoverageRepair_(validated, 0.9);

  assert.equal(backend.countPlayerMetricsEntries_(validated.playerMetrics), 1);
  assert.equal(backend.countPlayerMetricDataEntries_(validated.playerMetrics), 1);
  assert.equal(repairs.length, 0);
});

test("publish with only Discord identity still runs metrics recapture", () => {
  const backend = loadBackend();
  const data = buildValidRosterData();
  data.playerMetrics.byTag["#PLAYER"] = {
    identity: {
      tag: "#PLAYER",
      name: "Player",
      discordUsername: "phuuni",
      discordSource: "discord-sync",
    },
    trophyHistoryDaily: [],
  };

  let captureCalls = 0;
  let written = null;
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: data, text: JSON.stringify(data) });
  backend.captureMemberTrackingForRoster_ = (rosterData) => {
    captureCalls++;
    rosterData.playerMetrics.byTag["#PLAYER"].latestSnapshot = {
      tag: "#PLAYER",
      name: "Player",
      trophies: 5000,
      donations: 10,
      donationsReceived: 5,
      capturedAt: "2026-05-19T03:00:00.000Z",
    };
    return { capturedClans: 1, recorded: 1, updated: 1, errors: [] };
  };
  backend.createPublishArchiveBackupFromSnapshot_ = () => ({ created: false, key: "" });
  backend.cleanupPublishArchiveBackups_ = () => 0;
  backend.firebaseRequestJson_ = () => null;
  backend.markActiveDataWriteSuccess_ = () => null;
  backend.reconcileRegularWarFinalizationTriggerStateValidated_ = () => null;
  backend.replaceActiveRosterData_ = (payload) => {
    written = backend.validateRosterData_(payload);
    return { validatedRosterData: written, text: JSON.stringify(written) };
  };

  const meta = backend.writePublishedRosterData_(data);
  const identity = written.playerMetrics.byTag["#PLAYER"].identity;

  assert.equal(captureCalls, 1);
  assert.equal(meta.metricEntryCount, 1);
  assert.equal(backend.countPlayerMetricDataEntries_(written.playerMetrics), 1);
  assert.equal(identity.discordUsername, "phuuni");
});

test("active contract prunes empty name-only playerMetrics entries", () => {
  const backend = loadBackend();
  const data = buildValidRosterData();
  data.playerMetrics.byTag["#OTHER"] = {
    identity: { tag: "#OTHER", name: "Only Name" },
    latestSnapshot: {},
    trophyHistoryDaily: [],
  };

  const validated = backend.validateRosterData_(data);

  assert.equal(validated.playerMetrics.byTag["#OTHER"], undefined);
});

test("canonicalize migrates roster Discord cache and preserves active Discord ID", () => {
  const backend = loadBackend();
  const active = buildValidRosterData();
  active.playerMetrics.byTag["#PLAYER"].identity = {
    tag: "#PLAYER",
    name: "Player",
    discordId: "123456789012345678",
    discordUsername: "oldname",
    discordLinkedAt: "2026-05-19T00:00:00.000Z",
    discordUpdatedAt: "2026-05-19T00:00:00.000Z",
    discordSource: "discord-sync",
  };
  active.rosters[0].main[0].discord = "oldname";

  const incoming = clone(active);
  incoming.playerMetrics = { schemaVersion: 1, updatedAt: "", byTag: {} };
  incoming.rosters[0].main[0].discord = "newname";

  const canonicalized = backend.canonicalizeDiscordIdentityForRosterData_(incoming, {
    sourceRosterData: active,
    updatedAt: "2026-05-19T03:00:00.000Z",
    source: "publish",
    allowRosterCacheUsernameUpdates: true,
  }).rosterData;
  const validated = backend.validateRosterData_(canonicalized);
  const identity = validated.playerMetrics.byTag["#PLAYER"].identity;

  assert.equal(identity.discordId, "123456789012345678");
  assert.equal(identity.discordUsername, "newname");
  assert.equal(validated.rosters[0].main[0].discord, "newname");
});

test("refresh-style validation keeps canonical Discord identity without metric evidence", () => {
  const backend = loadBackend();
  const data = buildValidRosterData();
  data.playerMetrics.byTag["#PLAYER"] = {
    identity: {
      tag: "#PLAYER",
      name: "Player",
      discordUsername: "phuuni",
      discordSource: "discord-sync",
    },
    trophyHistoryDaily: [],
  };

  const validated = backend.validateRosterData_(data);

  assert.equal(validated.playerMetrics.byTag["#PLAYER"].identity.discordUsername, "phuuni");
});

test("bot sync with Discord ID writes canonical identity", () => {
  const backend = loadBackend();
  let activeData = buildValidRosterData();
  activeData.rosters[0].main[0].tag = "#2LUCULP";
  activeData.rosters[0].main[0].discord = "";
  activeData.playerMetrics = { schemaVersion: 1, updatedAt: "", byTag: {} };
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: activeData, text: JSON.stringify(activeData) });
  backend.replaceActiveRosterData_ = (payload) => {
    activeData = backend.validateRosterData_(payload);
    return { validatedRosterData: activeData, text: JSON.stringify(activeData) };
  };

  const result = backend.syncDiscordIdentityForPlayerTag("#2LUCULP", "123456789012345678", "phuuni", "secret");
  const identity = activeData.playerMetrics.byTag["#2LUCULP"].identity;

  assert.equal(result.ok, true);
  assert.equal(result.discordId, "123456789012345678");
  assert.equal(identity.discordId, "123456789012345678");
  assert.equal(identity.discordUsername, "phuuni");
  assert.equal(activeData.rosters[0].main[0].discord, "phuuni");
});

test("bot sync username-only works and does not erase existing Discord ID", () => {
  const backend = loadBackend();
  let activeData = buildValidRosterData();
  activeData.rosters[0].main[0].tag = "#2LUCULP";
  activeData.rosters[0].main[0].discord = "oldname";
  activeData.playerMetrics.byTag = {
    "#2LUCULP": {
      identity: {
        tag: "#2LUCULP",
        name: "Player",
        discordId: "123456789012345678",
        discordUsername: "oldname",
        discordLinkedAt: "2026-05-19T00:00:00.000Z",
        discordUpdatedAt: "2026-05-19T00:00:00.000Z",
        discordSource: "discord-sync",
      },
      trophyHistoryDaily: [],
    },
  };
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: activeData, text: JSON.stringify(activeData) });
  backend.replaceActiveRosterData_ = (payload) => {
    activeData = backend.validateRosterData_(payload);
    return { validatedRosterData: activeData, text: JSON.stringify(activeData) };
  };

  const result = backend.syncDiscordUsernameForPlayerTag("#2LUCULP", "newname", "secret");
  const identity = activeData.playerMetrics.byTag["#2LUCULP"].identity;

  assert.equal(result.ok, true);
  assert.equal(result.discordId, "123456789012345678");
  assert.equal(result.discordUsername, "newname");
  assert.equal(identity.discordId, "123456789012345678");
  assert.equal(identity.discordUsername, "newname");
  assert.equal(activeData.rosters[0].main[0].discord, "newname");
});

const buildManualDiscordLinkRosterData = () => {
  const data = buildValidRosterData();
  data.rosters[0].main[0] = {
    slot: 1,
    name: "Alpha",
    discord: "alpha",
    th: 16,
    tag: "#2LUCULP",
    notes: [],
    excludeAsSwapTarget: false,
    excludeAsSwapSource: false,
  };
  data.rosters[0].subs = [
    {
      slot: null,
      name: "Bravo",
      discord: "bravo",
      th: 15,
      tag: "#9PYLQG",
      notes: [],
      excludeAsSwapTarget: false,
      excludeAsSwapSource: false,
    },
  ];
  data.playerMetrics.byTag = {
    "#2LUCULP": {
      identity: {
        tag: "#2LUCULP",
        name: "Alpha",
        discordId: "111111111111111111",
        discordUsername: "alpha",
        discordLinkedAt: "2026-05-19T00:00:00.000Z",
        discordUpdatedAt: "2026-05-19T00:00:00.000Z",
        discordSource: "discord-sync",
      },
      trophyHistoryDaily: [],
    },
    "#9PYLQG": {
      identity: {
        tag: "#9PYLQG",
        name: "Bravo",
        discordId: "222222222222222222",
        discordUsername: "bravo",
        discordLinkedAt: "2026-05-19T00:00:00.000Z",
        discordUpdatedAt: "2026-05-19T00:00:00.000Z",
        discordSource: "discord-sync",
      },
      trophyHistoryDaily: [],
    },
  };
  return data;
};

test("bot sync allows the same Discord ID on multiple players without clearing username collisions", () => {
  const backend = loadBackend();
  const data = buildManualDiscordLinkRosterData();
  data.rosters[0].missing.push({
    slot: null,
    name: "Charlie",
    discord: "bravo",
    th: 14,
    tag: "#8CCVV",
    notes: [],
    excludeAsSwapTarget: false,
    excludeAsSwapSource: false,
  });
  data.playerMetrics.byTag["#8CCVV"] = {
    identity: {
      tag: "#8CCVV",
      name: "Charlie",
      discordId: "333333333333333333",
      discordUsername: "bravo",
    },
    trophyHistoryDaily: [],
  };
  const harness = installActiveRosterWriteHarness(backend, data);

  const result = backend.syncDiscordIdentityForPlayerTag("#2LUCULP", "222222222222222222", "bravo", "secret");
  const activeData = harness.getActiveData();

  assert.equal(result.ok, true);
  assert.equal(result.conflictsResolvedCount, 0);
  assert.equal(activeData.playerMetrics.byTag["#2LUCULP"].identity.discordId, "222222222222222222");
  assert.equal(activeData.playerMetrics.byTag["#9PYLQG"].identity.discordId, "222222222222222222");
  assert.equal(activeData.rosters[0].subs[0].discord, "bravo");
  assert.equal(activeData.playerMetrics.byTag["#8CCVV"].identity.discordId, "333333333333333333");
  assert.equal(activeData.rosters[0].missing[0].discord, "bravo");
});

test("manual link writes Discord ID and player tag as the canonical identity", () => {
  const backend = loadBackend();
  const harness = installActiveRosterWriteHarness(backend, buildManualDiscordLinkRosterData());
  backend.cocFetch_ = () => ({ tag: "#9PYLQG", name: "Bravo" });

  const result = backend.linkDiscordIdentityForPlayerTag({
    playerTag: "9PYLQG",
    discordId: "222222222222222222",
    discordUsername: "bravo_new",
    botSecret: "secret",
  });
  const activeData = harness.getActiveData();
  const identity = activeData.playerMetrics.byTag["#9PYLQG"].identity;

  assert.equal(result.ok, true);
  assert.equal(result.tag, "#9PYLQG");
  assert.equal(result.discordId, "222222222222222222");
  assert.equal(identity.tag, "#9PYLQG");
  assert.equal(identity.discordId, "222222222222222222");
  assert.equal(identity.discordUsername, "bravo_new");
  assert.equal(activeData.rosters[0].subs[0].discord, "bravo_new");
});

test("manual link reports an exact existing link without rewriting active data", () => {
  const backend = loadBackend();
  const harness = installActiveRosterWriteHarness(backend, buildManualDiscordLinkRosterData());
  backend.cocFetch_ = () => ({ tag: "#9PYLQG", name: "Bravo" });
  const before = JSON.stringify(harness.getActiveData());

  const result = backend.linkDiscordIdentityForPlayerTag({
    playerTag: "#9PYLQG",
    discordId: "222222222222222222",
    discordUsername: "bravo",
    botSecret: "secret",
  });

  assert.equal(result.ok, true);
  assert.equal(result.alreadyLinked, true);
  assert.equal(result.updated, false);
  assert.equal(result.conflictsResolvedCount, 0);
  assert.equal(JSON.stringify(harness.getActiveData()), before);
});

test("manual link refuses player conflicts without force", () => {
  const backend = loadBackend();
  const harness = installActiveRosterWriteHarness(backend, buildManualDiscordLinkRosterData());
  backend.cocFetch_ = () => ({ tag: "#2LUCULP", name: "Alpha" });

  const playerConflict = captureError(() => backend.linkDiscordIdentityForPlayerTag({
    playerTag: "2LUCULP",
    discordId: "333333333333333333",
    discordUsername: "charlie",
    botSecret: "secret",
  }));

  assert.equal(playerConflict.code, "DISCORD_LINK_CONFLICT");
  assert.match(playerConflict.message, /already linked/);
  assert.equal(harness.getActiveData().playerMetrics.byTag["#2LUCULP"].identity.discordId, "111111111111111111");
});

test("manual link allows one Discord user to own multiple player tags", () => {
  const backend = loadBackend();
  const harness = installActiveRosterWriteHarness(backend, buildManualDiscordLinkRosterData());
  backend.cocFetch_ = () => ({ tag: "#PYYQQ", name: "Charlie" });

  const result = backend.linkDiscordIdentityForPlayerTag({
    playerTag: "#PYYQQ",
    discordId: "222222222222222222",
    discordUsername: "bravo",
    botSecret: "secret",
  });
  const activeData = harness.getActiveData();
  const linkedMissing = activeData.rosters[0].missing.find((player) => player.tag === "#PYYQQ");

  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.conflictsResolvedCount, 0);
  assert.equal(activeData.playerMetrics.byTag["#9PYLQG"].identity.discordId, "222222222222222222");
  assert.equal(activeData.playerMetrics.byTag["#PYYQQ"].identity.discordId, "222222222222222222");
  assert.equal(activeData.rosters[0].subs[0].discord, "bravo");
  assert.equal(linkedMissing.discord, "bravo");
});

test("manual link force overwrites target player without clearing the Discord user's other players", () => {
  const backend = loadBackend();
  const harness = installActiveRosterWriteHarness(backend, buildManualDiscordLinkRosterData());
  backend.cocFetch_ = () => ({ tag: "#2LUCULP", name: "Alpha" });

  const result = backend.linkDiscordIdentityForPlayerTag({
    playerTag: "2LUCULP",
    discordId: "222222222222222222",
    discordUsername: "bravo",
    force: true,
    botSecret: "secret",
  });
  const activeData = harness.getActiveData();

  assert.equal(result.ok, true);
  assert.equal(result.force, true);
  assert.equal(result.conflictsResolvedCount, 1);
  assert.equal(activeData.playerMetrics.byTag["#2LUCULP"].identity.discordId, "222222222222222222");
  assert.equal(activeData.playerMetrics.byTag["#2LUCULP"].identity.discordUsername, "bravo");
  assert.equal(activeData.rosters[0].main[0].discord, "bravo");
  assert.equal(activeData.playerMetrics.byTag["#9PYLQG"].identity.discordId, "222222222222222222");
  assert.equal(activeData.rosters[0].subs[0].discord, "bravo");
});

test("manual link does not overwrite a different Discord ID only because the username matches", () => {
  const backend = loadBackend();
  const harness = installActiveRosterWriteHarness(backend, buildManualDiscordLinkRosterData());
  backend.cocFetch_ = () => ({ tag: "#PYYQQ", name: "Same Username" });

  const result = backend.linkDiscordIdentityForPlayerTag({
    playerTag: "#PYYQQ",
    discordId: "333333333333333333",
    discordUsername: "bravo",
    force: true,
    botSecret: "secret",
  });
  const activeData = harness.getActiveData();

  assert.equal(result.ok, true);
  assert.equal(result.conflictsResolvedCount, 0);
  assert.equal(activeData.playerMetrics.byTag["#PYYQQ"].identity.discordId, "333333333333333333");
  assert.equal(activeData.playerMetrics.byTag["#9PYLQG"].identity.discordId, "222222222222222222");
  assert.equal(activeData.rosters[0].subs[0].discord, "bravo");
});

test("manual link allows legacy username-only identities on other player tags", () => {
  const backend = loadBackend();
  const data = buildManualDiscordLinkRosterData();
  data.rosters[0].missing.push({
    slot: null,
    name: "Legacy",
    discord: "legacy_user",
    th: 14,
    tag: "#8CCVV",
    notes: [],
    excludeAsSwapTarget: false,
    excludeAsSwapSource: false,
  });
  data.playerMetrics.byTag["#8CCVV"] = {
    identity: {
      tag: "#8CCVV",
      name: "Legacy",
      discordUsername: "legacy_user",
    },
    trophyHistoryDaily: [],
  };
  const harness = installActiveRosterWriteHarness(backend, data);
  backend.cocFetch_ = () => ({ tag: "#PYYQQ", name: "Delta" });

  const result = backend.linkDiscordIdentityForPlayerTag({
    playerTag: "#PYYQQ",
    discordId: "333333333333333333",
    discordUsername: "legacy_user",
    botSecret: "secret",
  });
  const activeData = harness.getActiveData();

  assert.equal(result.ok, true);
  assert.equal(result.conflictsResolvedCount, 0);
  assert.equal(activeData.playerMetrics.byTag["#PYYQQ"].identity.discordId, "333333333333333333");
  assert.equal(activeData.playerMetrics.byTag["#8CCVV"].identity.discordUsername, "legacy_user");
  assert.equal(activeData.rosters[0].missing[0].discord, "legacy_user");
});

test("manual link-created missing player survives refresh-all when absent from the clan", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = buildManualDiscordLinkRosterData();
  data.rosters[0].trackingMode = "regularWar";
  data.rosters[0].connectedClanTag = "#CLAN";
  const harness = installActiveRosterWriteHarness(backend, data);
  backend.cocFetch_ = () => ({ tag: "#PYYQQ", name: "Charlie", townHallLevel: 14 });

  const linkResult = backend.linkDiscordIdentityForPlayerTag({
    playerTag: "PYYQQ",
    discordId: "333333333333333333",
    discordUsername: "charlie",
    botSecret: "secret",
  });
  const linkedData = harness.getActiveData();
  const linkedMissing = linkedData.rosters[0].missing.find((player) => player.tag === "#PYYQQ");

  assert.equal(linkResult.ok, true);
  assert.equal(linkResult.created, true);
  assert.equal(linkedMissing.name, "Charlie");
  assert.equal(linkedMissing.th, 14);
  assert.equal(linkedMissing.discord, "charlie");
  assert.equal(linkedData.playerMetrics.byTag["#PYYQQ"].identity.discordId, "333333333333333333");

  backend.cocFetchAllByPathEntries_ = (entriesRaw) => {
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    const dataByKey = {};
    const errorByKey = {};
    for (const entry of entries) {
      const key = String(entry && entry.key ? entry.key : "");
      const path = String(entry && entry.path ? entry.path : "");
      if (key === "members:#CLAN") {
        dataByKey[key] = {
          items: [{ tag: "#2LUCULP", name: "Alpha", townHallLevel: 16 }],
        };
      } else if (key === "regularWar:#CLAN") {
        const err = new Error("not found");
        err.statusCode = 404;
        errorByKey[key] = err;
      } else {
        throw new Error(`Unexpected Clash batch request ${key} ${path}`);
      }
    }
    return {
      dataByKey,
      errorByKey,
      requestCount: entries.length,
      batchCount: entries.length ? 1 : 0,
    };
  };

  const refreshResult = backend.runRefreshAllRostersCore_(linkedData, {
    allowRegularWarHistoryRepair: false,
    allowRegularWarProvisionalFallback: false,
  });
  const refreshedRoster = refreshResult.rosterData.rosters[0];
  const refreshedMissing = refreshedRoster.missing.find((player) => player.tag === "#PYYQQ");

  assert.equal(refreshResult.processedRosters, 1);
  assert.ok(refreshedMissing);
  assert.equal(refreshedMissing.discord, "charlie");
  assert.equal(refreshResult.rosterData.playerMetrics.byTag["#PYYQQ"].identity.discordId, "333333333333333333");
});

test("manual link rejects invalid tags and missing Clash players", () => {
  const backend = loadBackend();
  installActiveRosterWriteHarness(backend, buildManualDiscordLinkRosterData());
  backend.cocFetch_ = () => {
    throw new Error("Clash should not be called for invalid tags");
  };

  const invalid = captureError(() => backend.linkDiscordIdentityForPlayerTag({
    playerTag: "#ABC",
    discordId: "333333333333333333",
    discordUsername: "charlie",
    botSecret: "secret",
  }));

  assert.equal(invalid.code, "INVALID_PLAYER_TAG");

  backend.cocFetch_ = () => {
    const err = new Error("not found");
    err.statusCode = 404;
    throw err;
  };
  const missing = captureError(() => backend.linkDiscordIdentityForPlayerTag({
    playerTag: "#PYYQQ",
    discordId: "333333333333333333",
    discordUsername: "charlie",
    botSecret: "secret",
  }));

  assert.equal(missing.code, "PLAYER_NOT_FOUND");
});

test("manual delete removes a link by player tag", () => {
  const backend = loadBackend();
  const harness = installActiveRosterWriteHarness(backend, buildManualDiscordLinkRosterData());

  const result = backend.deleteDiscordIdentityLink({
    playerTag: "9PYLQG",
    botSecret: "secret",
  });
  const activeData = harness.getActiveData();

  assert.equal(result.ok, true);
  assert.equal(result.lookupType, "playerTag");
  assert.equal(result.deletedCount, 1);
  assert.equal(result.removedPlayerTags[0], "#9PYLQG");
  assert.equal(activeData.playerMetrics.byTag["#9PYLQG"], undefined);
  assert.equal(activeData.rosters[0].subs[0].discord, "");
  assert.equal(activeData.playerMetrics.byTag["#2LUCULP"].identity.discordId, "111111111111111111");
});

test("manual delete removes a link by Discord user", () => {
  const backend = loadBackend();
  const harness = installActiveRosterWriteHarness(backend, buildManualDiscordLinkRosterData());

  const result = backend.deleteDiscordIdentityLink({
    discordId: "222222222222222222",
    discordUsername: "bravo",
    botSecret: "secret",
  });
  const activeData = harness.getActiveData();

  assert.equal(result.ok, true);
  assert.equal(result.lookupType, "discordUser");
  assert.equal(JSON.stringify(result.removedPlayerTags), JSON.stringify(["#9PYLQG"]));
  assert.equal(activeData.playerMetrics.byTag["#9PYLQG"], undefined);
  assert.equal(activeData.rosters[0].subs[0].discord, "");
});

test("manual delete by Discord user does not delete a different stored Discord ID with the same username", () => {
  const backend = loadBackend();
  const data = buildManualDiscordLinkRosterData();
  data.rosters[0].missing.push({
    slot: null,
    name: "Charlie",
    discord: "bravo",
    th: 14,
    tag: "#8CCVV",
    notes: [],
    excludeAsSwapTarget: false,
    excludeAsSwapSource: false,
  });
  data.playerMetrics.byTag["#8CCVV"] = {
    identity: {
      tag: "#8CCVV",
      name: "Charlie",
      discordId: "333333333333333333",
      discordUsername: "bravo",
    },
    trophyHistoryDaily: [],
  };
  const harness = installActiveRosterWriteHarness(backend, data);

  const result = backend.deleteDiscordIdentityLink({
    discordId: "222222222222222222",
    discordUsername: "bravo",
    botSecret: "secret",
  });
  const activeData = harness.getActiveData();

  assert.equal(JSON.stringify(result.removedPlayerTags), JSON.stringify(["#9PYLQG"]));
  assert.equal(activeData.playerMetrics.byTag["#9PYLQG"], undefined);
  assert.equal(activeData.playerMetrics.byTag["#8CCVV"].identity.discordId, "333333333333333333");
  assert.equal(activeData.rosters[0].missing[0].discord, "bravo");
});

test("manual delete by Discord user prefers ID matches over legacy username-only matches", () => {
  const backend = loadBackend();
  const data = buildManualDiscordLinkRosterData();
  data.rosters[0].missing.push({
    slot: null,
    name: "Legacy Bravo",
    discord: "bravo",
    th: 14,
    tag: "#8CCVV",
    notes: [],
    excludeAsSwapTarget: false,
    excludeAsSwapSource: false,
  });
  data.playerMetrics.byTag["#8CCVV"] = {
    identity: {
      tag: "#8CCVV",
      name: "Legacy Bravo",
      discordUsername: "bravo",
    },
    trophyHistoryDaily: [],
  };
  const harness = installActiveRosterWriteHarness(backend, data);

  const result = backend.deleteDiscordIdentityLink({
    discordId: "222222222222222222",
    discordUsername: "bravo",
    botSecret: "secret",
  });
  const activeData = harness.getActiveData();

  assert.equal(JSON.stringify(result.removedPlayerTags), JSON.stringify(["#9PYLQG"]));
  assert.equal(activeData.playerMetrics.byTag["#9PYLQG"], undefined);
  assert.equal(activeData.playerMetrics.byTag["#8CCVV"].identity.discordUsername, "bravo");
  assert.equal(activeData.rosters[0].missing[0].discord, "bravo");
});

test("manual delete by Discord user falls back to legacy username-only identities when no ID match exists", () => {
  const backend = loadBackend();
  const data = buildManualDiscordLinkRosterData();
  data.rosters[0].missing.push({
    slot: null,
    name: "Legacy",
    discord: "legacy_user",
    th: 14,
    tag: "#8CCVV",
    notes: [],
    excludeAsSwapTarget: false,
    excludeAsSwapSource: false,
  });
  data.playerMetrics.byTag["#8CCVV"] = {
    identity: {
      tag: "#8CCVV",
      name: "Legacy",
      discordUsername: "legacy_user",
    },
    trophyHistoryDaily: [],
  };
  const harness = installActiveRosterWriteHarness(backend, data);

  const result = backend.deleteDiscordIdentityLink({
    discordId: "333333333333333333",
    discordUsername: "legacy_user",
    botSecret: "secret",
  });
  const activeData = harness.getActiveData();

  assert.equal(JSON.stringify(result.removedPlayerTags), JSON.stringify(["#8CCVV"]));
  assert.equal(activeData.playerMetrics.byTag["#8CCVV"], undefined);
  assert.equal(activeData.playerMetrics.byTag["#9PYLQG"].identity.discordId, "222222222222222222");
  assert.equal(activeData.rosters[0].missing[0].discord, "");
});

test("manual delete rejects ambiguous lookup and missing links", () => {
  const backend = loadBackend();
  installActiveRosterWriteHarness(backend, buildManualDiscordLinkRosterData());

  const ambiguous = captureError(() => backend.deleteDiscordIdentityLink({
    playerTag: "#2LUCULP",
    discordId: "111111111111111111",
    botSecret: "secret",
  }));
  assert.equal(ambiguous.code, "DISCORD_LINK_LOOKUP_REQUIRED");

  const missingByTag = captureError(() => backend.deleteDiscordIdentityLink({
    playerTag: "#PYYQQ",
    botSecret: "secret",
  }));
  assert.equal(missingByTag.code, "DISCORD_LINK_MISSING");

  const missingByUser = captureError(() => backend.deleteDiscordIdentityLink({
    discordId: "999999999999999999",
    discordUsername: "missing",
    botSecret: "secret",
  }));
  assert.equal(missingByUser.code, "DISCORD_LINK_MISSING");
});

test("bot delete clears Discord identity and roster cache for a player tag", () => {
  const backend = loadBackend();
  let activeData = buildValidRosterData();
  activeData.rosters[0].main[0].tag = "#2LUCULP";
  activeData.rosters[0].main[0].discord = "phuuni";
  activeData.playerMetrics.byTag = {
    "#2LUCULP": {
      identity: {
        tag: "#2LUCULP",
        name: "Player",
        discordId: "123456789012345678",
        discordUsername: "phuuni",
        discordLinkedAt: "2026-05-19T00:00:00.000Z",
        discordUpdatedAt: "2026-05-19T00:00:00.000Z",
        discordSource: "discord-sync",
      },
      trophyHistoryDaily: [],
    },
  };
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: activeData, text: JSON.stringify(activeData) });
  backend.replaceActiveRosterData_ = (payload) => {
    activeData = backend.validateRosterData_(payload);
    return { validatedRosterData: activeData, text: JSON.stringify(activeData) };
  };

  const result = backend.deleteDiscordIdentityForPlayerTag("#2LUCULP", "secret");

  assert.equal(result.ok, true);
  assert.equal(result.found, true);
  assert.equal(result.updated, true);
  assert.equal(result.discordId, "");
  assert.equal(result.discordUsername, "");
  assert.equal(result.removedDiscordId, "123456789012345678");
  assert.equal(result.removedDiscordUsername, "phuuni");
  assert.equal(activeData.rosters[0].main[0].discord, "");
  assert.equal(activeData.playerMetrics.byTag["#2LUCULP"], undefined);
});

test("bot delete preserves real metrics while removing Discord identity fields", () => {
  const backend = loadBackend();
  let activeData = buildValidRosterData();
  activeData.rosters[0].main[0].tag = "#2LUCULP";
  activeData.rosters[0].main[0].discord = "phuuni";
  activeData.playerMetrics.byTag = {
    "#2LUCULP": {
      identity: {
        tag: "#2LUCULP",
        name: "Player",
        discordId: "123456789012345678",
        discordUsername: "phuuni",
        discordLinkedAt: "2026-05-19T00:00:00.000Z",
        discordUpdatedAt: "2026-05-19T00:00:00.000Z",
        discordSource: "discord-sync",
      },
      latestSnapshot: {
        tag: "#2LUCULP",
        name: "Player",
        trophies: 5000,
        donations: 10,
        donationsReceived: 5,
        capturedAt: "2026-05-19T03:00:00.000Z",
      },
      trophyHistoryDaily: [],
    },
  };
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: activeData, text: JSON.stringify(activeData) });
  backend.replaceActiveRosterData_ = (payload) => {
    activeData = backend.validateRosterData_(payload);
    return { validatedRosterData: activeData, text: JSON.stringify(activeData) };
  };

  const result = backend.deleteDiscordIdentityForPlayerTag({ playerTag: "#2LUCULP", botSecret: "secret" });
  const entry = activeData.playerMetrics.byTag["#2LUCULP"];

  assert.equal(result.ok, true);
  assert.equal(result.updatedCanonical, true);
  assert.equal(result.updatedRosterCache, true);
  assert.equal(activeData.rosters[0].main[0].discord, "");
  assert.equal(entry.identity.tag, "#2LUCULP");
  assert.equal(entry.identity.name, "Player");
  assert.equal(entry.identity.discordId, undefined);
  assert.equal(entry.identity.discordUsername, undefined);
  assert.equal(entry.identity.discordLinkedAt, undefined);
  assert.equal(entry.identity.discordUpdatedAt, undefined);
  assert.equal(entry.identity.discordSource, undefined);
  assert.equal(entry.latestSnapshot.trophies, 5000);
});

test("one-time Discord backfill copies roster cache names into playerMetrics byTag", () => {
  const backendRaw = loadBackend();
  const data = buildValidRosterData();
  data.rosters[0].main[0].tag = "#2LUCULP";
  data.rosters[0].main[0].name = "Alpha";
  data.rosters[0].main[0].discord = "alpha";
  data.playerMetrics = { schemaVersion: 1, updatedAt: "", byTag: {} };
  const backend = installMemoryFirebase(backendRaw, {
    active: backendRaw.encodeFirebaseObjectKeysRecursive_(data),
  });
  backend.updateActiveRosterDataCaches_ = () => null;

  const result = backend.backfillDiscordIdentitiesFromRosterCacheOnce("change-me");
  const active = backend.readActiveRosterData_();
  const identity = active.playerMetrics.byTag["#2LUCULP"].identity;

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.rosterCacheTagCount, 1);
  assert.equal(result.metricEntryCountBefore, 0);
  assert.equal(result.metricEntryCountAfter, 1);
  assert.equal(result.migratedFromRosterCache, 1);
  assert.equal(identity.tag, "#2LUCULP");
  assert.equal(identity.name, "Alpha");
  assert.equal(identity.discordUsername, "alpha");
  assert.equal(identity.discordSource, "roster-cache-backfill");
  assert.equal(active.rosters[0].main[0].discord, "alpha");
});

test("one-time Discord backfill preserves bot-linked identities over roster cache", () => {
  const backendRaw = loadBackend();
  const data = buildValidRosterData();
  data.rosters[0].main[0].tag = "#2LUCULP";
  data.rosters[0].main[0].name = "Alpha";
  data.rosters[0].main[0].discord = "old-row-name";
  data.playerMetrics.byTag = {
    "#2LUCULP": {
      identity: {
        tag: "#2LUCULP",
        name: "Alpha",
        discordId: "123456789012345678",
        discordUsername: "bot-linked-name",
        discordLinkedAt: "2026-05-19T00:00:00.000Z",
        discordUpdatedAt: "2026-05-19T00:00:00.000Z",
        discordSource: "discord-sync",
      },
      trophyHistoryDaily: [],
    },
  };
  const backend = installMemoryFirebase(backendRaw, {
    active: backendRaw.encodeFirebaseObjectKeysRecursive_(data),
  });
  backend.updateActiveRosterDataCaches_ = () => null;

  const result = backend.backfillDiscordIdentitiesFromRosterCacheOnce("change-me");
  const active = backend.readActiveRosterData_();
  const identity = active.playerMetrics.byTag["#2LUCULP"].identity;

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.migratedFromRosterCache, 0);
  assert.equal(result.hydratedRosterCache, 1);
  assert.equal(identity.discordId, "123456789012345678");
  assert.equal(identity.discordUsername, "bot-linked-name");
  assert.equal(identity.discordSource, "discord-sync");
  assert.equal(active.rosters[0].main[0].discord, "bot-linked-name");
});

test("ranked season resolver uses deterministic Legend I cycle boundaries", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.cocFetch_ = () => {
    throw new Error("ranked season resolver must not call Clash API");
  };

  assertRankedSeason(
    backend.resolveCurrentRankedSeason_({ now: "2026-05-20T15:00:00.000Z" }),
    {
      seasonId: "ranked-legend-i-2026-05-18",
      startsAt: "2026-05-18T05:00:00.000Z",
      endsAt: "2026-06-15T05:00:00.000Z",
    },
  );

  assertRankedSeason(
    backend.resolveCurrentRankedSeason_({ now: "2026-06-15T04:59:59.000Z" }),
    {
      seasonId: "ranked-legend-i-2026-05-18",
      startsAt: "2026-05-18T05:00:00.000Z",
      endsAt: "2026-06-15T05:00:00.000Z",
    },
  );

  assertRankedSeason(
    backend.resolveCurrentRankedSeason_({ now: "2026-06-15T05:00:00.000Z" }),
    {
      seasonId: "ranked-legend-i-2026-06-15",
      startsAt: "2026-06-15T05:00:00.000Z",
      endsAt: "2026-07-13T05:00:00.000Z",
    },
  );
});

test("season event reconcile uses ranked Legend I cycle ids by default", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.cocFetch_ = () => {
    throw new Error("ranked season reconcile must not call Clash API");
  };

  const result = backend.reconcileCurrentSeasonEvents_({ now: "2026-05-20T15:00:00.000Z" });

  assertRankedSeason(result.season, {
    seasonId: "ranked-legend-i-2026-05-18",
    startsAt: "2026-05-18T05:00:00.000Z",
    endsAt: "2026-06-15T05:00:00.000Z",
  });
  assert.equal(JSON.stringify(result.createdEventIds.sort()), JSON.stringify([
    "donation-ranked-legend-i-2026-05-18",
    "push-ranked-legend-i-2026-05-18",
  ]));
  assert.equal(result.events.push.eventId, "push-ranked-legend-i-2026-05-18");
  assert.equal(result.events.donation.eventId, "donation-ranked-legend-i-2026-05-18");
  assert.equal(backend.readSeasonEventPointer_("events/seasonEvents/current/push").eventId, "push-ranked-legend-i-2026-05-18");
  assert.equal(
    backend.readSeasonEventPointer_("events/seasonEvents/bySeason/ranked-legend-i-2026-05-18/donation").eventId,
    "donation-ranked-legend-i-2026-05-18",
  );
});

test("season event reconcile creates current events and preserves manual edits", () => {
  const backend = installMemoryFirebase(loadBackend());

  const first = backend.reconcileCurrentSeasonEvents({ manualSeason: seasonFixture }, "secret");
  assert.equal(first.ok, true);
  assert.equal(JSON.stringify(first.createdEventIds.sort()), JSON.stringify(["donation-2026-05", "push-2026-05"]));
  assert.equal(first.events.push.status, "open");
  assert.equal(first.events.donation.settings.maxAccountsPerParticipant, 2);

  backend.updateSeasonEvent({
    eventId: "push-2026-05",
    patch: {
      title: "Manual Push Title",
      status: "closed",
    },
  }, "secret");

  const second = backend.reconcileCurrentSeasonEvents({ manualSeason: seasonFixture }, "secret");
  const push = backend.readSeasonEventById_("push-2026-05");

  assert.equal(second.createdEventIds.length, 0);
  assert.equal(push.title, "Manual Push Title");
  assert.equal(push.status, "closed");
  assert.ok(Object.keys(push.audit).length >= 2);
  assert.equal(backend.readSeasonEventPointer_("events/seasonEvents/current/push").eventId, "push-2026-05");
  assert.equal(backend.readSeasonEventPointer_("events/seasonEvents/bySeason/2026-05/donation").eventId, "donation-2026-05");

  const readWithSecretOnly = backend.getCurrentSeasonEvents("secret");
  assert.equal(readWithSecretOnly.ok, true);
  assert.equal(readWithSecretOnly.events.push.eventId, "push-2026-05");
});

test("season event signup enforces linked accounts and account limits", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.reconcileCurrentSeasonEvents({ manualSeason: seasonFixture }, "secret");
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildSeasonEventRosterData(), text: "" });

  const pushSignup = backend.registerSeasonEventSignup({
    eventId: "push-2026-05",
    discordUser: { id: "111", username: "alpha", globalName: "Alpha", displayName: "Alpha" },
    source: { type: "discord-button" },
  }, "secret");

  assert.equal(pushSignup.status, "signed-up");
  assert.equal(pushSignup.participant.accounts.length, 1);
  assert.equal(pushSignup.participant.accounts[0].tag, "#2LUCULP");

  const pushTooMany = backend.registerSeasonEventSignup({
    eventId: "push-2026-05",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
    playerTags: ["#9PYLQG", "#8CCVV"],
    source: { type: "discord-button" },
  }, "secret");

  assert.equal(pushTooMany.status, "too-many-accounts");

  const donationNeedsChoice = backend.registerSeasonEventSignup({
    eventId: "donation-2026-05",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
    source: { type: "discord-button" },
  }, "secret");

  assert.equal(donationNeedsChoice.status, "multiple-linked-accounts");

  const donationSignup = backend.registerSeasonEventSignup({
    eventId: "donation-2026-05",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
    playerTags: ["#9PYLQG", "#8CCVV"],
    source: { type: "discord-button" },
  }, "secret");

  assert.equal(donationSignup.status, "signed-up");
  assert.equal(donationSignup.participant.accounts.length, 2);

  const donationTooMany = backend.registerSeasonEventSignup({
    eventId: "donation-2026-05",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
    playerTags: ["#9PYLQG", "#8CCVV", "#PYYQQ"],
    source: { type: "discord-button" },
  }, "secret");

  assert.equal(donationTooMany.status, "too-many-accounts");

  const notLinked = backend.registerSeasonEventSignup({
    eventId: "donation-2026-05",
    discordUser: { id: "999", username: "nobody", globalName: "Nobody", displayName: "Nobody" },
    source: { type: "discord-button" },
  }, "secret");

  assert.equal(notLinked.status, "not-linked");
});

test("season event signup does not match an ID-linked account by username collision", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.reconcileCurrentSeasonEvents({ manualSeason: seasonFixture }, "secret");
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildSeasonEventRosterData(), text: "" });

  const result = backend.registerSeasonEventSignup({
    eventId: "push-2026-05",
    discordUser: { id: "999", username: "alpha", globalName: "Other Alpha", displayName: "Other Alpha" },
    source: { type: "discord-button" },
  }, "secret");

  assert.equal(result.status, "not-linked");
});

test("season event signup still accepts a single legacy username-only identity", () => {
  const backend = installMemoryFirebase(loadBackend());
  const rosterData = buildSeasonEventRosterData();
  rosterData.playerMetrics.byTag["#2PPYQQ"] = {
    identity: {
      tag: "#2PPYQQ",
      name: "Legacy",
      discordUsername: "legacy_user",
    },
    latestSnapshot: {
      tag: "#2PPYQQ",
      name: "Legacy",
      townHallLevel: 14,
      trophies: 4800,
      donations: 0,
      donationsReceived: 0,
      capturedAt: "2026-05-19T00:00:00.000Z",
    },
    trophyHistoryDaily: [],
  };
  backend.reconcileCurrentSeasonEvents({ manualSeason: seasonFixture }, "secret");
  backend.readActiveRosterSnapshot_ = () => ({ rosterData, text: "" });

  const result = backend.registerSeasonEventSignup({
    eventId: "push-2026-05",
    discordUser: { id: "999", username: "legacy_user", globalName: "Legacy", displayName: "Legacy" },
    source: { type: "discord-button" },
  }, "secret");

  assert.equal(result.status, "signed-up");
  assert.equal(result.participant.accounts[0].tag, "#2PPYQQ");
  assert.equal(result.participant.accounts[0].matchType, "discordUsername");
});

test("season event signup distinguishes duplicate, unlinked, already-signed, and differing accounts", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.reconcileCurrentSeasonEvents({ manualSeason: seasonFixture }, "secret");
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildSeasonEventRosterData(), text: "" });

  const duplicate = backend.registerSeasonEventSignup({
    eventId: "donation-2026-05",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
    playerTags: ["#9PYLQG", "#9PYLQG"],
    source: { type: "discord-button" },
  }, "secret");

  assert.equal(duplicate.status, "duplicate-player-tags");

  const unlinkedTag = backend.registerSeasonEventSignup({
    eventId: "donation-2026-05",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
    playerTags: ["#PYYQQ"],
    source: { type: "discord-button" },
  }, "secret");

  assert.equal(unlinkedTag.status, "player-tag-not-linked");

  const signed = backend.registerSeasonEventSignup({
    eventId: "donation-2026-05",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
    playerTags: ["#9PYLQG"],
    source: { type: "discord-button" },
  }, "secret");
  assert.equal(signed.status, "signed-up");

  const same = backend.registerSeasonEventSignup({
    eventId: "donation-2026-05",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
    playerTags: ["#9PYLQG"],
    source: { type: "discord-button" },
  }, "secret");
  assert.equal(same.status, "already-signed-up");

  const different = backend.registerSeasonEventSignup({
    eventId: "donation-2026-05",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
    playerTags: ["#8CCVV"],
    source: { type: "discord-button" },
  }, "secret");
  assert.equal(different.status, "accounts-differ-use-update-endpoint");
});

test("season event participant account updates and cancellation maintain tag indexes", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.reconcileCurrentSeasonEvents({ manualSeason: seasonFixture }, "secret");
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildSeasonEventRosterData(), text: "" });

  backend.registerSeasonEventSignup({
    eventId: "donation-2026-05",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
    playerTags: ["#9PYLQG", "#8CCVV"],
    source: { type: "discord-button" },
  }, "secret");

  const updated = backend.updateSeasonEventParticipantAccounts({
    eventId: "donation-2026-05",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
    playerTags: ["#8CCVV"],
    source: { type: "discord-select" },
  }, "secret");

  assert.equal(updated.status, "updated");
  assert.equal(updated.participant.accounts.length, 1);
  assert.equal(backend.firebaseRequestJson_(backend.buildSeasonEventParticipantTagIndexPath_("donation-2026-05", "#9PYLQG"), "GET"), null);
  assert.equal(
    backend.decodeSeasonEventFirebasePayload_(backend.firebaseRequestJson_(backend.buildSeasonEventParticipantTagIndexPath_("donation-2026-05", "#8CCVV"), "GET")).discordId,
    "222",
  );

  const cancelled = backend.cancelSeasonEventSignup({
    eventId: "donation-2026-05",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
    source: { type: "discord-button" },
  }, "secret");

  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.participant.status, "cancelled");
  assert.equal(backend.firebaseRequestJson_(backend.buildSeasonEventParticipantTagIndexPath_("donation-2026-05", "#8CCVV"), "GET"), null);
});

test("season event signup rejects assigned tags and closed signup windows", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.reconcileCurrentSeasonEvents({ manualSeason: seasonFixture }, "secret");
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildSeasonEventRosterData(), text: "" });

  backend.firebaseRequestJson_(
    backend.buildSeasonEventParticipantTagIndexPath_("donation-2026-05", "#9PYLQG"),
    "PUT",
    { discordId: "111", tag: "#9PYLQG", assignedAt: "2026-05-19T00:00:00.000Z" },
  );

  const assigned = backend.registerSeasonEventSignup({
    eventId: "donation-2026-05",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
    playerTags: ["#9PYLQG"],
    source: { type: "discord-button" },
  }, "secret");

  assert.equal(assigned.status, "tag-already-assigned");

  backend.updateSeasonEvent({
    eventId: "donation-2026-05",
    patch: { signupsOpen: false },
  }, "secret");

  const closed = backend.registerSeasonEventSignup({
    eventId: "donation-2026-05",
    discordUser: { id: "333", username: "delta", globalName: "Delta", displayName: "Delta" },
    playerTags: ["#PYYQQ"],
    source: { type: "discord-button" },
  }, "secret");

  assert.equal(closed.status, "signups-closed");
});

test("donation cycle ledger is keyed by ranked Legend I season", () => {
  const backend = installMemoryFirebase(loadBackend());
  const entry = backend.createEmptyPlayerMetricsEntry_("#2LUCULP", "Alpha");
  const ctx = backend.buildMetricsCaptureContext_("2026-05-20T15:00:00.000Z");

  const changed = backend.updatePlayerMetricsEntryFromSnapshot_(entry, {
    tag: "#2LUCULP",
    name: "Alpha",
    trophies: 5200,
    donations: 150,
    donationsReceived: 40,
    clanTag: "#CLAN",
    capturedAt: "2026-05-20T15:00:00.000Z",
  }, ctx);

  assert.equal(changed, true);
  assert.equal(Object.keys(entry.donationCycles).join(","), "ranked-legend-i-2026-05-18");
  assert.equal(entry.donationCycles["ranked-legend-i-2026-05-18"].startsAt, "2026-05-18T05:00:00.000Z");
  assert.equal(entry.donationCycles["ranked-legend-i-2026-05-18"].endsAt, "2026-06-15T05:00:00.000Z");
  assert.equal(entry.donationCycles["ranked-legend-i-2026-05-18"].cycleTotalDonations, 150);
  assert.equal(entry.donationCycles["ranked-legend-i-2026-05-18"].cycleTotalDonationsReceived, 40);
  assert.equal(entry.lastSeen.donationCycleKey, "ranked-legend-i-2026-05-18");

  const sanitized = backend.sanitizePlayerMetricsEntry_("#2LUCULP", entry, Date.parse("2026-05-20T15:00:00.000Z"), new Date("2026-05-20T15:00:00.000Z"));
  assert.equal(sanitized.donationCycles["ranked-legend-i-2026-05-18"].cycleTotalDonations, 150);
});

test("donation overlay merge prefers the freshest season ledger", () => {
  const backend = loadBackend();
  const seasonId = "ranked-legend-i-2026-05-18";
  const baseByTag = {
    "#PLAYER": {
      identity: { tag: "#PLAYER", name: "Player" },
      donationCycles: {
        [seasonId]: {
          seasonId,
          startsAt: "2026-05-18T05:00:00.000Z",
          endsAt: "2026-06-15T05:00:00.000Z",
          rawDonationsLastSeen: 100,
          rawDonationsReceivedLastSeen: 20,
          cycleTotalDonations: 100,
          cycleTotalDonationsReceived: 20,
          firstSeenAt: "2026-05-20T00:00:00.000Z",
          lastSeenAt: "2026-05-22T00:00:00.000Z",
          lastClanTag: "#CLAN",
          resetCount: 0,
          receivedResetCount: 0,
        },
      },
    },
    "#FRESHBASE": {
      identity: { tag: "#FRESHBASE", name: "Fresh Base" },
      donationCycles: {
        [seasonId]: {
          seasonId,
          startsAt: "2026-05-18T05:00:00.000Z",
          endsAt: "2026-06-15T05:00:00.000Z",
          rawDonationsLastSeen: 200,
          rawDonationsReceivedLastSeen: 20,
          cycleTotalDonations: 200,
          cycleTotalDonationsReceived: 20,
          firstSeenAt: "2026-05-20T00:00:00.000Z",
          lastSeenAt: "2026-05-26T00:00:00.000Z",
          lastClanTag: "#CLAN",
          resetCount: 0,
          receivedResetCount: 0,
        },
      },
    },
  };
  const overlayByTag = {
    "#PLAYER": {
      tag: "#PLAYER",
      name: "Player",
      seasonId,
      donationCycle: {
        seasonId,
        startsAt: "2026-05-18T05:00:00.000Z",
        endsAt: "2026-06-15T05:00:00.000Z",
        rawDonationsLastSeen: 175,
        rawDonationsReceivedLastSeen: 30,
        cycleTotalDonations: 175,
        cycleTotalDonationsReceived: 30,
        firstSeenAt: "2026-05-20T00:00:00.000Z",
        lastSeenAt: "2026-05-25T00:00:00.000Z",
        lastClanTag: "#CLAN",
        resetCount: 0,
        receivedResetCount: 0,
      },
    },
    "#FRESHBASE": {
      tag: "#FRESHBASE",
      name: "Fresh Base",
      seasonId,
      donationCycle: {
        seasonId,
        startsAt: "2026-05-18T05:00:00.000Z",
        endsAt: "2026-06-15T05:00:00.000Z",
        rawDonationsLastSeen: 150,
        rawDonationsReceivedLastSeen: 20,
        cycleTotalDonations: 150,
        cycleTotalDonationsReceived: 20,
        firstSeenAt: "2026-05-20T00:00:00.000Z",
        lastSeenAt: "2026-05-24T00:00:00.000Z",
        lastClanTag: "#CLAN",
        resetCount: 0,
        receivedResetCount: 0,
      },
    },
  };

  const merged = backend.mergeDonationRefreshOverlayIntoPlayerMetricsByTag_(baseByTag, overlayByTag, seasonId);

  assert.equal(merged["#PLAYER"].donationCycles[seasonId].cycleTotalDonations, 175);
  assert.equal(merged["#FRESHBASE"].donationCycles[seasonId].cycleTotalDonations, 200);
});

test("season event leaderboards score push and donation events from event-cycle metrics", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.reconcileCurrentSeasonEvents_({ now: "2026-05-20T15:00:00.000Z" });
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildSeasonEventLeaderboardRosterData(), text: "" });

  const pushEventId = "push-ranked-legend-i-2026-05-18";
  const donationEventId = "donation-ranked-legend-i-2026-05-18";
  const writeParticipant = (eventId, participant) => {
    backend.firebaseRequestJson_(backend.buildSeasonEventParticipantPath_(eventId, participant.discordId), "PUT", participant);
  };

  writeParticipant(pushEventId, {
    discordId: "111",
    discordUsername: "alpha",
    discordDisplayName: "Alpha",
    status: "signed_up",
    accounts: [{ tag: "#2LUCULP", name: "Alpha", townHallLevel: 16, trophies: 5000, leagueName: "Legends I", matchType: "discordId" }],
    signedUpAt: "2026-05-18T06:00:00.000Z",
    updatedAt: "2026-05-18T06:00:00.000Z",
    source: { type: "test" },
  });
  writeParticipant(pushEventId, {
    discordId: "222",
    discordUsername: "bravo",
    discordDisplayName: "Bravo",
    status: "signed_up",
    accounts: [{ tag: "#9PYLQG", name: "Bravo", townHallLevel: 15, trophies: 5050, leagueName: "Titan 27", matchType: "discordId" }],
    signedUpAt: "2026-05-18T06:00:00.000Z",
    updatedAt: "2026-05-18T06:00:00.000Z",
    source: { type: "test" },
  });
  writeParticipant(pushEventId, {
    discordId: "333",
    discordUsername: "charlie",
    discordDisplayName: "Charlie",
    status: "signed_up",
    accounts: [{ tag: "#8CCVV", name: "Charlie", townHallLevel: 14, trophies: 4900, leagueName: "Titan 26", matchType: "discordId" }],
    signedUpAt: "2026-05-18T06:00:00.000Z",
    updatedAt: "2026-05-18T06:00:00.000Z",
    source: { type: "test" },
  });
  writeParticipant(pushEventId, {
    discordId: "444",
    discordUsername: "delta",
    discordDisplayName: "Delta",
    status: "signed_up",
    accounts: [{ tag: "#PYYQQ", name: "Delta", townHallLevel: 16, trophies: 6000, leagueName: "Legends II", matchType: "discordId" }],
    signedUpAt: "2026-05-18T06:00:00.000Z",
    updatedAt: "2026-05-18T06:00:00.000Z",
    source: { type: "test" },
  });
  writeParticipant(pushEventId, {
    discordId: "666",
    discordUsername: "missing",
    discordDisplayName: "Missing",
    status: "signed_up",
    accounts: [{ tag: "#MISS", name: "Missing", townHallLevel: 13, trophies: 0, leagueName: "", matchType: "discordId" }],
    signedUpAt: "2026-05-18T06:00:00.000Z",
    updatedAt: "2026-05-18T06:00:00.000Z",
    source: { type: "test" },
  });
  writeParticipant(pushEventId, {
    discordId: "555",
    discordUsername: "cancelled",
    discordDisplayName: "Cancelled",
    status: "cancelled",
    accounts: [{ tag: "#2LUCULP", name: "Alpha", townHallLevel: 16, trophies: 5000, leagueName: "Legends I", matchType: "discordId" }],
    signedUpAt: "2026-05-18T06:00:00.000Z",
    updatedAt: "2026-05-18T06:00:00.000Z",
    cancelledAt: "2026-05-19T00:00:00.000Z",
    source: { type: "test" },
  });

  writeParticipant(donationEventId, {
    discordId: "111",
    discordUsername: "alpha",
    discordDisplayName: "Alpha",
    status: "signed_up",
    accounts: [{ tag: "#2LUCULP", name: "Alpha", townHallLevel: 16, trophies: 5000, leagueName: "Legends I", matchType: "discordId" }],
    signedUpAt: "2026-05-18T06:00:00.000Z",
    updatedAt: "2026-05-18T06:00:00.000Z",
    source: { type: "test" },
  });
  writeParticipant(donationEventId, {
    discordId: "222",
    discordUsername: "bravo",
    discordDisplayName: "Bravo",
    status: "signed_up",
    accounts: [
      { tag: "#9PYLQG", name: "Bravo", townHallLevel: 15, trophies: 5050, leagueName: "Titan 27", matchType: "discordId" },
      { tag: "#8CCVV", name: "Charlie", townHallLevel: 14, trophies: 4900, leagueName: "Titan 26", matchType: "discordId" },
    ],
    signedUpAt: "2026-05-18T06:00:00.000Z",
    updatedAt: "2026-05-18T06:00:00.000Z",
    source: { type: "test" },
  });
  writeParticipant(donationEventId, {
    discordId: "555",
    discordUsername: "cancelled",
    discordDisplayName: "Cancelled",
    status: "cancelled",
    accounts: [{ tag: "#2LUCULP", name: "Alpha", townHallLevel: 16, trophies: 5000, leagueName: "Legends I", matchType: "discordId" }],
    signedUpAt: "2026-05-18T06:00:00.000Z",
    updatedAt: "2026-05-18T06:00:00.000Z",
    cancelledAt: "2026-05-19T00:00:00.000Z",
    source: { type: "test" },
  });

  const push = backend.getSeasonEventLeaderboard({
    eventId: pushEventId,
    includeDebug: true,
    now: "2026-05-20T15:00:00.000Z",
  }, "secret");

  assert.equal(push.leaderboard.length, 5);
  assert.equal(push.leaderboard[0].displayName, "Alpha");
  assert.equal(push.leaderboard[0].score, 5200);
  assert.equal(push.leaderboard[0].scoreLabel, "Legends I - 5200 trophies");
  assert.equal(push.leaderboard[0].metric, "leagueTrophies");
  assert.equal(push.leaderboard[0].currentLeagueName, "Legends I");
  assert.equal(push.leaderboard[0].bestLeagueName, "Legends I");
  assert.equal(push.leaderboard[0].hasPushRank, true);
  assert.equal(push.leaderboard[1].displayName, "Delta");
  assert.equal(push.leaderboard[1].score, 6000);
  assert.equal(push.leaderboard[1].currentLeagueName, "Legends II");
  assert.equal(push.leaderboard[1].bestLeagueName, "Legends II");
  assert.equal(push.leaderboard[2].displayName, "Bravo");
  assert.equal(push.leaderboard[2].score, 5600);
  assert.equal(push.leaderboard[3].displayName, "Charlie");
  assert.equal(push.leaderboard.find((row) => row.displayName === "Charlie").coverage, "full");
  assert.ok(push.leaderboard.find((row) => row.displayName === "Missing").warnings.includes("missing-player-metrics"));
  assert.equal(push.leaderboard.some((row) => row.displayName === "Cancelled"), false);

  const donation = backend.getSeasonEventLeaderboard({
    eventId: donationEventId,
    includeDebug: true,
    now: "2026-05-20T15:00:00.000Z",
  }, "secret");

  assert.equal(donation.leaderboard.length, 2);
  assert.equal(donation.leaderboard[0].displayName, "Bravo");
  assert.equal(donation.leaderboard[0].score, 275);
  assert.equal(donation.leaderboard[0].accounts[0].score, 200);
  assert.equal(donation.leaderboard[0].accounts[1].score, 75);
  assert.equal(donation.leaderboard[1].displayName, "Alpha");
  assert.equal(donation.leaderboard[1].score, 150);
  assert.equal(donation.leaderboard[1].accounts[0].debug.hasPlayerMetrics, true);
  assert.equal(donation.leaderboard[1].accounts[0].debug.donationCycleLedger.seasonId, "ranked-legend-i-2026-05-18");
});

test("current season event leaderboards reconcile before reading current pointers", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.reconcileCurrentSeasonEvents_({ now: "2026-05-20T15:00:00.000Z" });
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildSeasonEventLeaderboardRosterData(), text: "" });

  const result = backend.getCurrentSeasonEventLeaderboards({
    now: "2026-06-15T05:00:00.000Z",
  }, "secret");

  assert.equal(result.season.seasonId, "ranked-legend-i-2026-06-15");
  assert.equal(result.leaderboards.push.event.eventId, "push-ranked-legend-i-2026-06-15");
  assert.equal(result.leaderboards.donation.event.eventId, "donation-ranked-legend-i-2026-06-15");
  assert.equal(backend.readSeasonEventPointer_("events/seasonEvents/current/push").eventId, "push-ranked-legend-i-2026-06-15");
});

test("CWL league signup options store the active message snapshot", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildCwlLeagueSignupRosterData(), text: "" });

  const result = backend.getCwlLeagueSignupOptions({ fetchMissing: false }, "secret");
  const signups = backend.decodeFirebaseObjectKeysRecursive_(backend.firebaseRequestJson_("active/cwlLeagueSignups", "GET"));

  assert.equal(result.ok, true);
  assert.ok(result.signupId);
  assert.equal(JSON.stringify(result.options.map((option) => option.leagueKey)), JSON.stringify(["champion-i", "master-ii"]));
  assert.equal(signups.signupId, result.signupId);
  assert.equal(signups.optionsByLeagueKey["champion-i"].leagueName, "Champion I");
  assert.equal(signups.optionsByLeagueKey["master-ii"].leagueName, "Master II");
  assert.ok(signups.optionSnapshotUpdatedAt);
});

test("CWL signup options keep same-league rosters distinct", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildSameLeagueCwlSignupRosterData(), text: "" });

  const result = backend.getCwlLeagueSignupOptions({ fetchMissing: false }, "secret");
  const signups = backend.decodeFirebaseObjectKeysRecursive_(backend.firebaseRequestJson_("active/cwlLeagueSignups", "GET"));

  assert.equal(result.ok, true);
  assert.equal(result.options.length, 2);
  assert.equal(JSON.stringify(result.options.map((option) => option.leagueKey)), JSON.stringify(["champion-i", "champion-i"]));
  assert.equal(JSON.stringify(result.options.map((option) => option.clanName)), JSON.stringify(["Turtle Main", "Turtle Second"]));
  assert.deepEqual(new Set(result.options.map((option) => option.optionKey)).size, 2);
  assert.ok(signups.optionsByKey[result.options[0].optionKey]);
  assert.ok(signups.optionsByKey[result.options[1].optionKey]);
  assert.equal(JSON.stringify(signups.optionsByLeagueKey["champion-i"].rosterIds), JSON.stringify(["main", "second"]));
});

test("CWL league preference stores selected clan target metadata", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildSameLeagueCwlSignupRosterData(), text: "" });
  const signup = backend.getCwlLeagueSignupOptions({ fetchMissing: false }, "secret");
  const secondOption = signup.options.find((option) => option.targetRosterId === "second");

  const result = backend.setCwlLeaguePreference({
    playerTag: "#2LUCULP",
    playerName: "Alpha",
    signupId: signup.signupId,
    optionKey: secondOption.optionKey,
    leagueKey: secondOption.leagueKey,
    discordId: "111",
    discordUsername: "alpha",
    discordDisplayName: "Alpha",
  }, "secret");
  const signups = backend.decodeFirebaseObjectKeysRecursive_(backend.firebaseRequestJson_("active/cwlLeagueSignups", "GET"));

  assert.equal(result.ok, true);
  assert.equal(result.preference.optionKey, secondOption.optionKey);
  assert.equal(result.preference.leagueKey, "champion-i");
  assert.equal(result.preference.leagueName, "Champion I");
  assert.equal(result.preference.targetRosterId, "second");
  assert.equal(result.preference.targetClanTag, "#9PYLQG");
  assert.equal(result.preference.targetClanName, "Turtle Second");
  assert.equal(signups.preferencesByTag["#2LUCULP"].targetRosterId, "second");
});

test("CWL league preference saves from the message snapshot without rebuilding options", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildCwlLeagueSignupRosterData(), text: "" });
  const signup = backend.getCwlLeagueSignupOptions({ fetchMissing: false }, "secret");
  let rosterSnapshotReads = 0;
  backend.readActiveRosterSnapshot_ = () => {
    rosterSnapshotReads += 1;
    throw new Error("roster options should not rebuild for a snapshotted signup");
  };
  backend.cocFetch_ = () => {
    throw new Error("Clash should not be fetched for a snapshotted signup");
  };

  const result = backend.setCwlLeaguePreference({
    playerTag: "#2LUCULP",
    playerName: "Alpha",
    signupId: signup.signupId,
    leagueKey: "champion-i",
    discordId: "111",
    discordUsername: "alpha",
    discordDisplayName: "Alpha",
    messageId: "message-1",
    channelId: "channel-1",
    guildId: "guild-1",
  }, "secret");

  assert.equal(result.ok, true);
  assert.equal(result.status, "created");
  assert.equal(result.created, true);
  assert.equal(result.preference.leagueName, "Champion I");
  assert.equal(result.preferenceCount, 1);
  assert.equal(rosterSnapshotReads, 0);
});

test("CWL league preference changes require owner confirmation", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildCwlLeagueSignupRosterData(), text: "" });
  const signup = backend.getCwlLeagueSignupOptions({ fetchMissing: false }, "secret");
  backend.setCwlLeaguePreference({
    playerTag: "#2LUCULP",
    playerName: "Alpha",
    signupId: signup.signupId,
    leagueKey: "champion-i",
    discordId: "111",
    discordUsername: "alpha",
    discordDisplayName: "Alpha",
  }, "secret");

  assert.throws(() => backend.setCwlLeaguePreference({
    playerTag: "#2LUCULP",
    playerName: "Alpha",
    signupId: signup.signupId,
    leagueKey: "master-ii",
    discordId: "111",
    discordUsername: "alpha",
    discordDisplayName: "Alpha",
  }, "secret"), /already has an active CWL league preference/i);

  assert.throws(() => backend.setCwlLeaguePreference({
    playerTag: "#2LUCULP",
    playerName: "Alpha",
    signupId: signup.signupId,
    leagueKey: "master-ii",
    discordId: "222",
    discordUsername: "bravo",
    discordDisplayName: "Bravo",
    allowChange: true,
  }, "secret"), /belongs to another Discord user/i);

  const result = backend.setCwlLeaguePreference({
    playerTag: "#2LUCULP",
    playerName: "Alpha",
    signupId: signup.signupId,
    leagueKey: "master-ii",
    discordId: "111",
    discordUsername: "alpha",
    discordDisplayName: "Alpha",
    allowChange: true,
  }, "secret");
  const signups = backend.decodeFirebaseObjectKeysRecursive_(backend.firebaseRequestJson_("active/cwlLeagueSignups", "GET"));
  const auditEntries = Object.values(signups.audit || {});

  assert.equal(result.ok, true);
  assert.equal(result.status, "changed");
  assert.equal(result.changed, true);
  assert.equal(result.previousPreference.leagueName, "Champion I");
  assert.equal(result.preference.leagueName, "Master II");
  assert.equal(result.preferenceCount, 1);
  assert.equal(signups.preferencesByTag["#2LUCULP"].discordId, "111");
  assert.equal(signups.preferencesByTag["#2LUCULP"].leagueName, "Master II");
  assert.ok(auditEntries.some((entry) =>
    entry.action === "changed" &&
    entry.playerTag === "#2LUCULP" &&
    entry.previousLeagueName === "Champion I" &&
    entry.leagueName === "Master II" &&
    entry.discordId === "111"
  ));
});

test("CWL league preferences lookup returns only the requesting Discord user's votes", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildCwlLeagueSignupRosterData(), text: "" });
  const signup = backend.getCwlLeagueSignupOptions({ fetchMissing: false }, "secret");

  backend.setCwlLeaguePreference({
    playerTag: "#2LUCULP",
    playerName: "Alpha",
    signupId: signup.signupId,
    leagueKey: "champion-i",
    discordId: "111",
    discordUsername: "alpha",
    discordDisplayName: "Alpha",
  }, "secret");
  backend.setCwlLeaguePreference({
    playerTag: "#9PYLQG",
    playerName: "Bravo",
    signupId: signup.signupId,
    leagueKey: "master-ii",
    discordId: "222",
    discordUsername: "bravo",
    discordDisplayName: "Bravo",
  }, "secret");

  backend.readActiveRosterSnapshot_ = () => {
    throw new Error("user preference lookup should not read roster snapshots");
  };
  backend.cocFetch_ = () => {
    throw new Error("user preference lookup should not call Clash API");
  };

  const result = backend.getCwlLeaguePreferencesForDiscordUser({
    signupId: signup.signupId,
    discordId: "111",
    discordUsername: "alpha",
    discordDisplayName: "Alpha",
  }, "secret");

  assert.equal(result.ok, true);
  assert.equal(result.signupId, signup.signupId);
  assert.equal(result.preferenceCount, 1);
  assert.equal(JSON.stringify(result.preferences.map((pref) => pref.playerTag)), JSON.stringify(["#2LUCULP"]));
  assert.equal(result.preferences[0].playerName, "Alpha");
  assert.equal(result.preferences[0].leagueKey, "champion-i");
  assert.equal(result.preferences[0].leagueName, "Champion I");
  assert.equal(result.preferences[0].discordId, "111");
});

test("CWL league-only preference data remains readable", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    active: {
      cwlLeagueSignups: {
        signupId: "legacy-signup",
        status: "open",
        optionsByLeagueKey: {
          "champion-i": {
            leagueKey: "champion-i",
            leagueName: "Champion I",
            rosterIds: ["main"],
          },
        },
        preferencesByTag: {
          "#2LUCULP": {
            playerTag: "#2LUCULP",
            playerName: "Alpha",
            leagueKey: "champion-i",
            leagueName: "Champion I",
            discordId: "111",
          },
        },
      },
    },
  });

  const result = backend.getCwlLeaguePreferencesForDiscordUser({
    signupId: "legacy-signup",
    discordId: "111",
  }, "secret");

  assert.equal(result.ok, true);
  assert.equal(result.preferenceCount, 1);
  assert.equal(result.preferences[0].leagueKey, "champion-i");
  assert.equal(result.preferences[0].optionKey, "");
  assert.equal(result.preferences[0].targetRosterId, "");
});

test("CWL league preference clear removes only the clicking user's one vote and writes audit", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildCwlLeagueSignupRosterData(), text: "" });
  const signup = backend.getCwlLeagueSignupOptions({ fetchMissing: false }, "secret");
  backend.setCwlLeaguePreference({
    playerTag: "#2LUCULP",
    playerName: "Alpha",
    signupId: signup.signupId,
    leagueKey: "champion-i",
    discordId: "111",
    discordUsername: "alpha",
    discordDisplayName: "Alpha",
  }, "secret");
  backend.setCwlLeaguePreference({
    playerTag: "#9PYLQG",
    playerName: "Bravo",
    signupId: signup.signupId,
    leagueKey: "master-ii",
    discordId: "222",
    discordUsername: "bravo",
    discordDisplayName: "Bravo",
  }, "secret");
  backend.readActiveRosterSnapshot_ = () => {
    throw new Error("user preference clear should not read roster snapshots");
  };
  backend.cocFetch_ = () => {
    throw new Error("user preference clear should not call Clash API");
  };

  const result = backend.clearCwlLeaguePreference({
    signupId: signup.signupId,
    discordId: "111",
    discordUsername: "alpha",
    playerTag: "#2LUCULP",
    source: "discord-user-clear",
    messageId: "message-1",
    channelId: "channel-1",
    guildId: "guild-1",
  }, "secret");
  const signups = backend.decodeFirebaseObjectKeysRecursive_(backend.firebaseRequestJson_("active/cwlLeagueSignups", "GET"));
  const auditEntries = Object.values(signups.audit || {});

  assert.equal(result.ok, true);
  assert.equal(result.status, "cleared");
  assert.equal(result.cleared, true);
  assert.equal(result.playerTag, "#2LUCULP");
  assert.equal(result.preferenceCount, 1);
  assert.equal(signups.preferencesByTag["#2LUCULP"], undefined);
  assert.equal(signups.preferencesByTag["#9PYLQG"].discordId, "222");
  assert.ok(auditEntries.some((entry) =>
    entry.action === "cleared" &&
    entry.playerTag === "#2LUCULP" &&
    entry.discordId === "111" &&
    entry.source === "discord-user-clear"
  ));
});

test("CWL league preference clear is a no-op when the vote belongs to another Discord user", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildCwlLeagueSignupRosterData(), text: "" });
  const signup = backend.getCwlLeagueSignupOptions({ fetchMissing: false }, "secret");
  backend.setCwlLeaguePreference({
    playerTag: "#2LUCULP",
    playerName: "Alpha",
    signupId: signup.signupId,
    leagueKey: "champion-i",
    discordId: "111",
    discordUsername: "alpha",
    discordDisplayName: "Alpha",
  }, "secret");

  const result = backend.clearCwlLeaguePreference({
    signupId: signup.signupId,
    discordId: "222",
    discordUsername: "bravo",
    playerTag: "#2LUCULP",
  }, "secret");
  const signups = backend.decodeFirebaseObjectKeysRecursive_(backend.firebaseRequestJson_("active/cwlLeagueSignups", "GET"));
  const auditEntries = Object.values(signups.audit || {});

  assert.equal(result.ok, true);
  assert.equal(result.status, "not-owner");
  assert.equal(result.cleared, false);
  assert.equal(signups.preferencesByTag["#2LUCULP"].discordId, "111");
  assert.ok(auditEntries.some((entry) =>
    entry.action === "clear_noop" &&
    entry.status === "not-owner" &&
    entry.playerTag === "#2LUCULP" &&
    entry.discordId === "222"
  ));
});

test("CWL league preference lookup and clear handle a no-vote state without broad reads", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildCwlLeagueSignupRosterData(), text: "" });
  const signup = backend.getCwlLeagueSignupOptions({ fetchMissing: false }, "secret");
  backend.readActiveRosterSnapshot_ = () => {
    throw new Error("user preference no-vote actions should not read roster snapshots");
  };
  backend.cocFetch_ = () => {
    throw new Error("user preference no-vote actions should not call Clash API");
  };

  const lookup = backend.getCwlLeaguePreferencesForDiscordUser({
    signupId: signup.signupId,
    discordId: "111",
  }, "secret");
  const clear = backend.clearCwlLeaguePreference({
    signupId: signup.signupId,
    discordId: "111",
    playerTag: "#2LUCULP",
  }, "secret");
  const signups = backend.decodeFirebaseObjectKeysRecursive_(backend.firebaseRequestJson_("active/cwlLeagueSignups", "GET"));
  const auditEntries = Object.values(signups.audit || {});

  assert.equal(lookup.ok, true);
  assert.equal(lookup.preferenceCount, 0);
  assert.equal(JSON.stringify(lookup.preferences), JSON.stringify([]));
  assert.equal(clear.ok, true);
  assert.equal(clear.status, "not-found");
  assert.equal(clear.cleared, false);
  assert.equal(clear.preferenceCount, 0);
  assert.equal(JSON.stringify(signups.preferencesByTag || {}), JSON.stringify({}));
  assert.ok(auditEntries.some((entry) =>
    entry.action === "clear_noop" &&
    entry.status === "not-found" &&
    entry.playerTag === "#2LUCULP" &&
    entry.discordId === "111"
  ));
});

test("CWL user preference methods reject invalid Discord bot secrets", () => {
  const backend = installMemoryFirebase(loadBackend());

  assert.throws(() => backend.getCwlLeaguePreferencesForDiscordUser({
    discordId: "111",
  }, "wrong-secret"), /Authentication failed for Discord bot API/i);
  assert.throws(() => backend.clearCwlLeaguePreference({
    discordId: "111",
    playerTag: "#2LUCULP",
  }, "wrong-secret"), /Authentication failed for Discord bot API/i);
});

test("CWL user preference methods reject stale signup ids through the admin API dispatcher", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildCwlLeagueSignupRosterData(), text: "" });
  const signup = backend.getCwlLeagueSignupOptions({ fetchMissing: false }, "secret");
  backend.resetCwlLeaguePreferences({ source: "test", reason: "new-message" }, "secret");

  assert.throws(() => backend.runAdminApiMethod_("getCwlLeaguePreferencesForDiscordUser", [{
    signupId: signup.signupId,
    discordId: "111",
  }, "secret"]), /no longer active/i);
  assert.throws(() => backend.runAdminApiMethod_("clearCwlLeaguePreference", [{
    signupId: signup.signupId,
    discordId: "111",
    playerTag: "#2LUCULP",
  }, "secret"]), /no longer active/i);
});

test("stale CWL league signup messages reject before rebuilding options", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildCwlLeagueSignupRosterData(), text: "" });
  const signup = backend.getCwlLeagueSignupOptions({ fetchMissing: false }, "secret");
  const reset = backend.resetCwlLeaguePreferences({ source: "test", reason: "new-message" }, "secret");
  let rosterSnapshotReads = 0;
  backend.readActiveRosterSnapshot_ = () => {
    rosterSnapshotReads += 1;
    throw new Error("stale signup should fail before roster option rebuild");
  };
  backend.cocFetch_ = () => {
    throw new Error("stale signup should fail before Clash fetch");
  };

  assert.notEqual(reset.signupId, signup.signupId);
  assert.throws(() => backend.setCwlLeaguePreference({
    playerTag: "#2LUCULP",
    playerName: "Alpha",
    signupId: signup.signupId,
    leagueKey: "champion-i",
    discordId: "111",
    discordUsername: "alpha",
    discordDisplayName: "Alpha",
    messageId: "message-1",
    channelId: "channel-1",
    guildId: "guild-1",
  }, "secret"), /no longer active/i);
  assert.equal(rosterSnapshotReads, 0);
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

test("CWL aggregation tracks offense and defense independently", () => {
  const backend = loadBackend();
  const war = {
    state: "warEnded",
    attacksPerMember: 1,
    clan: {
      tag: "#AAA",
      members: [
        { tag: "#A", name: "A", townHallLevel: 16, attacks: [{ defenderTag: "#X", stars: 2, destructionPercentage: 80 }] },
        { tag: "#B", name: "B", townHallLevel: 16, attacks: [] },
        { tag: "#C", name: "C", townHallLevel: 16, attacks: [] },
      ],
    },
    opponent: {
      tag: "#BBB",
      members: [
        { tag: "#X", townHallLevel: 16, attacks: [{ defenderTag: "#A", stars: 1, destructionPercentage: 60 }] },
        { tag: "#Y", townHallLevel: 16, attacks: [{ defenderTag: "#A", stars: 2, destructionPercentage: 80 }] },
        { tag: "#Z", townHallLevel: 16, attacks: [{ defenderTag: "#A", stars: 3, destructionPercentage: 90 }] },
        { tag: "#Q", townHallLevel: 16, attacks: [{ defenderTag: "#C", stars: 2, destructionPercentage: 70 }] },
      ],
    },
  };

  const stats = backend.buildCwlWarAggregateForClan_(war, "#AAA", null);

  assert.equal(stats["#A"].starsTotal, 2);
  assert.equal(stats["#A"].attacksMade, 1);
  assert.equal(stats["#A"].defenseAttacksReceived, 3);
  assert.equal(stats["#A"].successfulDefensiveAttacks, 2);
  assert.equal(stats["#A"].threeStarAttacksConceded, 1);
  assert.equal(stats["#A"].defenseHolds, 0);
  assert.equal(stats["#A"].bestStarsConceded, 3);
  assert.equal(stats["#A"].bestDestructionConceded, 90);

  assert.equal(stats["#B"].missedAttacks, 1);
  assert.equal(stats["#B"].unattackedDefenseDays, 1);
  assert.equal(stats["#B"].defenseHolds, 0);

  assert.equal(stats["#C"].attacksMade, 0);
  assert.equal(stats["#C"].missedAttacks, 1);
  assert.equal(stats["#C"].defenseAttacksReceived, 1);
  assert.equal(stats["#C"].successfulDefensiveAttacks, 1);
  assert.equal(stats["#C"].defenseHolds, 1);
});

test("CWL active war missed attacks and unattacked defenses stay provisional", () => {
  const backend = loadBackend();
  const war = {
    state: "inWar",
    attacksPerMember: 1,
    clan: {
      tag: "#AAA",
      members: [
        { tag: "#A", townHallLevel: 16, attacks: [] },
        { tag: "#B", townHallLevel: 16, attacks: [] },
      ],
    },
    opponent: {
      tag: "#BBB",
      members: [
        { tag: "#X", townHallLevel: 16, attacks: [{ defenderTag: "#B", stars: 2, destructionPercentage: 70 }] },
      ],
    },
  };

  const stats = backend.buildCwlWarAggregateForClan_(war, "#AAA", null);

  assert.equal(stats["#A"].currentWarAttackPending, 1);
  assert.equal(stats["#A"].missedAttacks, 0);
  assert.equal(stats["#A"].unattackedDefenseDays, 0);
  assert.equal(stats["#B"].currentWarAttackPending, 1);
  assert.equal(stats["#B"].defenseAttacksReceived, 1);
  assert.equal(stats["#B"].defenseHolds, 0);
});

test("CWL ranking uses backend comparator and does not give no-defense perfect credit", () => {
  const backend = loadBackend();
  const rows = [
    { tag: "#NODEF", _sortName: "NoDef", cwlStats: { starsTotal: 6, totalDestruction: 180, attackedDefenseDays: 0 } },
    {
      tag: "#DEF",
      _sortName: "Def",
      cwlStats: {
        starsTotal: 6,
        totalDestruction: 150,
        attackedDefenseDays: 1,
        defenseHolds: 0,
        successfulDefensiveAttacks: 1,
        threeStarAttacksConceded: 1,
        bestStarsConceded: 3,
        bestDestructionConceded: 100,
      },
    },
    { tag: "#NONE", _sortName: "None", cwlStats: {} },
  ];

  rows.sort(backend.compareCwlSeasonEventLeaderboardRows_);

  assert.deepEqual(rows.map((row) => row.tag), ["#DEF", "#NODEF", "#NONE"]);
});

test("CWL participant-filtered aggregate ranked tags use backend display-name tie-break", () => {
  const backend = loadBackend();
  const finalAggregate = backend.filterCwlAggregateToRegisteredParticipants_(
    {
      eventId: "cwl-test",
      type: "cwl",
      participantsByDiscordId: {
        "200": {
          discordId: "200",
          discordDisplayName: "Zulu",
          status: "signed_up",
          accounts: [{ tag: "#BBB", name: "Zulu" }],
        },
        "100": {
          discordId: "100",
          discordDisplayName: "Alpha",
          status: "signed_up",
          accounts: [{ tag: "#AAA", name: "Alpha" }],
        },
      },
    },
    {
      eventId: "cwl-test",
      kind: "live",
      warTags: ["#WAR1"],
      byTag: {
        "#AAA": { starsTotal: 3, attacksMade: 1, totalDestruction: 100 },
        "#BBB": { starsTotal: 3, attacksMade: 1, totalDestruction: 100 },
      },
    },
  );

  assert.equal(JSON.stringify(finalAggregate.rankedTags), JSON.stringify(["#AAA", "#BBB"]));
});

test("CWL final aggregate remains compact for a large synthetic leaderboard", () => {
  const backend = loadBackend();
  const participantsByDiscordId = {};
  const byTag = {};
  for (let i = 0; i < 200; i++) {
    const tag = `#P${String(i).padStart(4, "0")}`;
    participantsByDiscordId[String(1000 + i)] = {
      discordId: String(1000 + i),
      discordUsername: `user${i}`,
      discordDisplayName: `User ${i}`,
      status: "signed_up",
      accounts: [{ tag, name: `Player ${i}`, townHallLevel: 16 }],
    };
    byTag[tag] = {
      starsTotal: i % 21,
      attacksMade: 7,
      missedAttacks: i % 2,
      threeStarCount: i % 5,
      totalDestruction: 500 + i,
      countedAttacks: 7,
      defenseAttacksReceived: 4,
      successfulDefensiveAttacks: i % 4,
      attackedDefenseDays: 4,
      defenseHolds: i % 3,
      threeStarAttacksConceded: i % 2,
      bestStarsConceded: 8,
      bestDestructionConceded: 320,
      unattackedDefenseDays: 0,
    };
  }

  const finalAggregate = backend.filterCwlAggregateToRegisteredParticipants_(
    { eventId: "cwl-test", type: "cwl", participantsByDiscordId },
    { eventId: "cwl-test", kind: "live", warTags: ["#WAR1", "#WAR2"], byTag }
  );

  assert.ok(Buffer.byteLength(JSON.stringify(finalAggregate), "utf8") < 128 * 1024);
  assert.equal(Object.keys(finalAggregate.byTag).length, 200);
  assert.equal(finalAggregate.rankedTags.length, 200);
});

test("CWL snapshot planning adds zero CWL requests without roster or event need", () => {
  const backend = installMemoryFirebase(loadBackend());
  const rosterData = buildValidRosterData();
  rosterData.rosters[0].trackingMode = "regularWar";
  const paths = [];
  backend.cocFetchAllByPathEntries_ = (entriesRaw) => {
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    const dataByKey = {};
    const errorByKey = {};
    for (const entry of entries) {
      paths.push(entry.path);
      if (entry.path.endsWith("/members")) dataByKey[entry.key] = { items: [] };
      else errorByKey[entry.key] = Object.assign(new Error("not found"), { statusCode: 404 });
    }
    return { dataByKey, errorByKey, requestCount: entries.length, batchCount: entries.length ? 1 : 0 };
  };

  const snapshot = backend.buildAutoRefreshSnapshot_(rosterData, { sourceRosters: rosterData.rosters });

  assert.equal(snapshot.requestCounts.leagueGroup, 0);
  assert.equal(snapshot.requestCounts.cwlWar, 0);
  assert.equal(paths.some((path) => path.includes("leaguegroup")), false);
  assert.equal(paths.some((path) => path.includes("/clanwarleagues/wars/")), false);
});

test("CWL waiting event with no league group fetches groups once per unique clan and no wars", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    events: {
      seasonEvents: {
        currentCwl: { eventId: "cwl-waiting", type: "cwl" },
        byId: {
          "cwl-waiting": {
            eventId: "cwl-waiting",
            type: "cwl",
            status: "open",
            signupsOpen: true,
            cwlTrackingState: "waiting",
            cwl: { groups: {} },
          },
        },
      },
    },
  });
  const rosterData = buildValidRosterData();
  rosterData.rosters = [
    { ...rosterData.rosters[0], id: "a", connectedClanTag: "#AAA", trackingMode: "regularWar" },
    { ...rosterData.rosters[0], id: "b", connectedClanTag: "#AAA", trackingMode: "regularWar" },
    { ...rosterData.rosters[0], id: "c", connectedClanTag: "#BBB", trackingMode: "regularWar" },
  ];
  const paths = [];
  backend.cocFetchAllByPathEntries_ = (entriesRaw) => {
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    const dataByKey = {};
    const errorByKey = {};
    for (const entry of entries) {
      paths.push(entry.path);
      if (entry.path.endsWith("/members")) dataByKey[entry.key] = { items: [] };
      else errorByKey[entry.key] = Object.assign(new Error("not in CWL"), { statusCode: 404 });
    }
    return { dataByKey, errorByKey, requestCount: entries.length, batchCount: entries.length ? 1 : 0 };
  };

  const snapshot = backend.buildAutoRefreshSnapshot_(rosterData, { sourceRosters: rosterData.rosters });

  assert.equal(snapshot.requestCounts.leagueGroup, 2);
  assert.equal(snapshot.requestCounts.cwlWar, 0);
  assert.equal(paths.filter((path) => path.includes("leaguegroup")).length, 2);
  assert.equal(paths.some((path) => path.includes("/clanwarleagues/wars/")), false);
});

test("authenticated CWL event refresh callable binds the current published group", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    events: {
      seasonEvents: {
        currentCwl: { eventId: "cwl-waiting", type: "cwl" },
        byId: {
          "cwl-waiting": {
            eventId: "cwl-waiting",
            type: "cwl",
            status: "open",
            signupsOpen: true,
            startsAt: "",
            endsAt: "",
            cwlTrackingState: "waiting",
            cwl: { groups: {} },
            participantsByDiscordId: {
              "100": {
                discordId: "100",
                discordUsername: "alpha",
                discordDisplayName: "Alpha",
                status: "signed_up",
                accounts: [{ tag: "#PLAYER", name: "Player" }],
              },
            },
          },
        },
      },
    },
  });
  const rosterData = backend.validateRosterData_(buildValidRosterData());
  backend.readAutoRefreshCoordinatorSourceSnapshot_ = () => ({ rosterData, source: "test" });
  const leaguegroup = {
    state: "inWar",
    season: "2026-07",
    clans: [{ tag: "#CLAN" }, { tag: "#OPP" }],
    rounds: [{ warTags: ["#WAR1"] }],
  };
  const war = {
    state: "inWar",
    startTime: "2026-07-04T20:00:00.000Z",
    endTime: "2026-07-05T20:00:00.000Z",
    clan: {
      tag: "#CLAN",
      members: [{ tag: "#PLAYER", attacks: [{ defenderTag: "#BASE", stars: 3, destructionPercentage: 100 }] }],
    },
    opponent: {
      tag: "#OPP",
      members: [{ tag: "#BASE", attacks: [] }],
    },
  };
  backend.cocFetchAllByPathEntries_ = (entriesRaw) => {
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    const dataByKey = {};
    const errorByKey = {};
    for (const entry of entries) {
      if (entry.path.endsWith("/members")) dataByKey[entry.key] = { items: [] };
      else if (entry.path.includes("/currentwar/leaguegroup")) dataByKey[entry.key] = leaguegroup;
      else if (entry.path.includes("/clanwarleagues/wars/")) dataByKey[entry.key] = war;
      else if (entry.path.endsWith("/currentwar")) errorByKey[entry.key] = Object.assign(new Error("not in war"), { statusCode: 404 });
    }
    return { dataByKey, errorByKey, requestCount: entries.length, batchCount: entries.length ? 1 : 0 };
  };

  const result = backend.runAdminApiMethod_("refreshCurrentCwlSeasonEvent", [{ source: { type: "test" } }, "secret"]);
  const event = backend.readSeasonEventById_("cwl-waiting");
  const live = backend.readCwlSeasonEventAggregate_("cwl-waiting", "live");

  assert.equal(result.status, "active");
  assert.equal(result.requestCounts.leagueGroup, 1);
  assert.equal(result.requestCounts.cwlWar, 1);
  assert.equal(event.cwlTrackingState, "active");
  assert.equal(event.startsAt, "2026-07-04T20:00:00.000Z");
  assert.equal(live.byTag["#PLAYER"].starsTotal, 3);
});

test("CWL active event dedupes shared league groups and war tags per snapshot run", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    events: {
      seasonEvents: {
        currentCwl: { eventId: "cwl-active", type: "cwl" },
        byId: {
          "cwl-active": {
            eventId: "cwl-active",
            type: "cwl",
            status: "open",
            signupsOpen: true,
            cwlTrackingState: "active",
            cwl: {
              groups: {
                "grp-test": {
                  groupId: "grp-test",
                  clanTags: ["#AAA", "#BBB"],
                  warTags: ["#WAR1", "#WAR2"],
                  expectedRounds: 2,
                },
              },
            },
          },
        },
      },
    },
  });
  const rosterData = buildValidRosterData();
  rosterData.rosters = [
    { ...rosterData.rosters[0], id: "a", connectedClanTag: "#AAA", trackingMode: "regularWar" },
    { ...rosterData.rosters[0], id: "b", connectedClanTag: "#BBB", trackingMode: "regularWar" },
  ];
  const leaguegroup = {
    state: "inWar",
    season: "2026-07",
    clans: [{ tag: "#AAA" }, { tag: "#BBB" }],
    rounds: [{ warTags: ["#WAR1", "#WAR2", "#WAR1"] }],
  };
  const war = {
    state: "inWar",
    clan: { tag: "#AAA", members: [] },
    opponent: { tag: "#BBB", members: [] },
  };
  const paths = [];
  backend.cocFetchAllByPathEntries_ = (entriesRaw) => {
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    const dataByKey = {};
    const errorByKey = {};
    for (const entry of entries) {
      paths.push(entry.path);
      if (entry.path.endsWith("/members")) dataByKey[entry.key] = { items: [] };
      else if (entry.path.includes("leaguegroup")) dataByKey[entry.key] = leaguegroup;
      else if (entry.path.includes("/clanwarleagues/wars/")) dataByKey[entry.key] = war;
      else errorByKey[entry.key] = Object.assign(new Error("not found"), { statusCode: 404 });
    }
    return { dataByKey, errorByKey, requestCount: entries.length, batchCount: entries.length ? 1 : 0 };
  };

  const snapshot = backend.buildAutoRefreshSnapshot_(rosterData, { sourceRosters: rosterData.rosters });

  assert.equal(snapshot.requestCounts.leagueGroup, 2);
  assert.equal(snapshot.requestCounts.cwlWar, 2);
  assert.equal(JSON.stringify(snapshot.requestPlan.cwlWarTags.sort()), JSON.stringify(["#WAR1", "#WAR2"]));
  assert.equal(paths.filter((path) => path.includes("/clanwarleagues/wars/")).length, 2);
});

test("CWL partial refresh marks previous aggregate stale without replacing scores", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    events: {
      seasonEvents: {
        currentCwl: { eventId: "cwl-active", type: "cwl" },
        byId: {
          "cwl-active": {
            eventId: "cwl-active",
            type: "cwl",
            status: "open",
            signupsOpen: true,
            cwlTrackingState: "active",
            cwl: {
              groups: {
                "grp-test": {
                  groupId: "grp-test",
                  clanTags: ["#AAA"],
                  warTags: ["#WAR1"],
                  expectedRounds: 1,
                },
              },
            },
          },
        },
        cwlAggregates: {
          byEvent: {
            "cwl-active": {
              live: {
                eventId: "cwl-active",
                kind: "live",
                hash: "old",
                byTag: { "#A": { starsTotal: 3, attacksMade: 1 } },
                warTags: ["#WAR1"],
              },
            },
          },
        },
      },
    },
  });
  const rosterData = buildValidRosterData();
  rosterData.rosters[0].connectedClanTag = "#AAA";
  const snapshot = {
    leaguegroupRawByClanTag: {},
    cwlWarRawByTag: {},
    cwlWarErrorByTag: {
      "#WAR1": Object.assign(new Error("api failed"), { statusCode: 500 }),
    },
  };

  const result = backend.refreshCurrentCwlSeasonEventFromSnapshot_(rosterData, snapshot, { nowIso: "2026-07-04T00:00:00.000Z" });
  const live = backend.readCwlSeasonEventAggregate_("cwl-active", "live");

  assert.equal(result.status, "stale");
  assert.equal(live.byTag["#A"].starsTotal, 3);
  assert.equal(live.stale, true);
});

test("CWL completion freezes only after a second matching complete refresh", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    events: {
      seasonEvents: {
        currentCwl: { eventId: "cwl-active", type: "cwl" },
        byId: {
          "cwl-active": {
            eventId: "cwl-active",
            type: "cwl",
            status: "open",
            signupsOpen: true,
            cwlTrackingState: "active",
            cwl: {
              groups: {
                "grp-test": {
                  groupId: "grp-test",
                  clanTags: ["#AAA"],
                  warTags: ["#WAR1"],
                  expectedRounds: 1,
                },
              },
            },
            participantsByDiscordId: {
              "100": {
                discordId: "100",
                discordUsername: "alpha",
                discordDisplayName: "Alpha",
                status: "signed_up",
                accounts: [{ tag: "#A", name: "Alpha" }],
              },
            },
          },
        },
      },
    },
  });
  const rosterData = buildValidRosterData();
  rosterData.rosters[0].connectedClanTag = "#AAA";
  const snapshot = {
    leaguegroupRawByClanTag: {},
    cwlWarRawByTag: {
      "#WAR1": {
        state: "warEnded",
        startTime: "2026-07-01T00:00:00.000Z",
        endTime: "2026-07-02T00:00:00.000Z",
        clan: {
          tag: "#AAA",
          members: [{ tag: "#A", attacks: [{ defenderTag: "#X", stars: 3, destructionPercentage: 100 }] }],
        },
        opponent: {
          tag: "#BBB",
          members: [{ tag: "#X", attacks: [] }],
        },
      },
    },
    cwlWarErrorByTag: {},
  };

  const first = backend.refreshCurrentCwlSeasonEventFromSnapshot_(rosterData, snapshot, { nowIso: "2026-07-04T00:00:00.000Z" });
  const second = backend.refreshCurrentCwlSeasonEventFromSnapshot_(rosterData, snapshot, { nowIso: "2026-07-04T01:00:00.000Z" });
  const db = backend.__getFirebaseDb().events.seasonEvents;
  const finalAggregate = backend.readCwlSeasonEventAggregate_("cwl-active", "final");

  assert.equal(first.status, "finalizing");
  assert.equal(second.status, "completed");
  assert.equal(db.currentCwl, undefined);
  assert.equal(db.latestCompletedCwl.eventId, "cwl-active");
  assert.equal(db.cwlAggregates.byEvent["cwl-active"].live, undefined);
  assert.equal(finalAggregate.byTag["#A"].starsTotal, 3);
});
