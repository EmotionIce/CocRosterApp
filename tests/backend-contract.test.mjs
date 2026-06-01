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
  "script/refreshEngine.gs",
  "script/seasonEvents.gs",
  "script/publishAndTriggers.gs",
  "script/authAndLocks.gs",
  "script/adminApi.gs",
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

  const snapshot = backend.readActiveRosterSnapshot_();

  assert.equal(snapshot.versionId, "version-1");
  assert.equal(snapshot.rosterData.pageTitle, "Versioned Roster");
  assert.equal(snapshot.rosterData.rosters[0].id, "main");
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
  assert.equal(push.leaderboard[0].bestLeagueName, "Legends I");
  assert.equal(push.leaderboard[0].hasPushRank, true);
  assert.equal(push.leaderboard[1].displayName, "Delta");
  assert.equal(push.leaderboard[1].score, 6000);
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
