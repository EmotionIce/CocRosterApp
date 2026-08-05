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
  "script/playerWarTracking.js",
  "script/firebaseStore.js",
  "script/metricsTracking.js",
  "script/donationRefresh.js",
  "script/rosterSchema.js",
  "script/refreshEngine.js",
  "script/rosterSync.js",
  "script/seasonEvents.js",
  "script/cloudflarePublishQueue.js",
  "script/publishAndTriggers.js",
  "script/authAndLocks.js",
  "script/assets.js",
  "script/cwlLeagueSignups.js",
  "script/warFollowup.js",
  "script/adminApi.js",
  "script/entrypoints.js",
];

const loadBackend = () => {
  const code = appScriptFiles
    .map((file) => fs.readFileSync(new URL(file, repoRoot), "utf8"))
    .join("\n");
  const properties = new Map([["DISCORD_BOT_API_SECRET", "secret"]]);
  let uuidCounter = 0;
  const context = {
    Buffer,
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => "Etc/UTC" },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => properties.has(key) ? properties.get(key) : null,
        getProperties: () => Object.fromEntries(properties),
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
      getUuid: () => "uuid" + String(++uuidCounter).padStart(8, "0") + "-test",
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
  let etagRevision = 1;
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
  backend.firebaseRequestJsonWithEtag_ = (pathRaw, methodRaw = "GET", payloadRaw, optionsRaw = {}) => {
    const method = String(methodRaw || "GET").toUpperCase();
    if (method === "GET") {
      return { value: backend.firebaseRequestJson_(pathRaw, "GET"), etag: `etag-${etagRevision}` };
    }
    if (String(optionsRaw.ifMatch || "") !== `etag-${etagRevision}`) {
      const conflict = new Error("Firebase ETag conflict");
      conflict.code = "FIREBASE_ETAG_CONFLICT";
      throw conflict;
    }
    if (method === "PATCH") {
      const base = String(pathRaw || "").replace(/^\/+|\/+$/g, "");
      for (const [relativePath, value] of Object.entries(payloadRaw || {})) {
        const path = [base, relativePath].filter(Boolean).join("/");
        backend.firebaseRequestJson_(path, "PUT", value);
      }
      etagRevision += 1;
      return { value: null, etag: `etag-${etagRevision}` };
    }
    const value = backend.firebaseRequestJson_(pathRaw, method, payloadRaw);
    etagRevision += 1;
    return { value, etag: `etag-${etagRevision}` };
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

const buildOneRoundCwlLeagueGroup = (options = {}) => ({
  state: options.state || "inWar",
  season: options.season || "2026-07",
  clans: [{ tag: options.clanTag || "#CLAN", warLeague: { name: options.leagueName || "Champion I" } }, { tag: options.opponentTag || "#OPP" }],
  rounds: [{ warTags: [options.warTag || "#WAR1"] }],
});

const buildOneRoundCwlWar = (options = {}) => ({
  state: options.state || "warEnded",
  startTime: options.startTime || "2026-07-04T20:00:00.000Z",
  endTime: options.endTime || "2026-07-05T20:00:00.000Z",
  clan: {
    tag: options.clanTag || "#CLAN",
    members: [{
      tag: options.playerTag || "#PLAYER",
      name: options.playerName || "Player",
      attacks: [{
        defenderTag: options.defenderTag || "#BASE",
        stars: options.stars == null ? 3 : options.stars,
        destructionPercentage: options.destruction == null ? 100 : options.destruction,
      }],
    }],
  },
  opponent: {
    tag: options.opponentTag || "#OPP",
    members: [{ tag: options.defenderTag || "#BASE", name: "Base", attacks: [] }],
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
        identity: { tag: "#2LUCULP", name: "Alpha", discordId: "111", discordUsername: "alpha" },
        latestSnapshot: {
          tag: "#2LUCULP",
          name: "Alpha",
          townHallLevel: 16,
          trophies: 5000,
          capturedAt: "2026-05-19T00:00:00.000Z",
        },
        trophyHistoryDaily: [],
      },
      "#9PYLQG": {
        identity: { tag: "#9PYLQG", name: "Bravo", discordId: "222", discordUsername: "bravo" },
        latestSnapshot: {
          tag: "#9PYLQG",
          name: "Bravo",
          townHallLevel: 15,
          trophies: 4500,
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
  playerMetrics: {
    schemaVersion: 1,
    updatedAt: "2026-05-19T00:00:00.000Z",
    byTag: {
      "#2LUCULP": { identity: { tag: "#2LUCULP", name: "Alpha", discordId: "111", discordUsername: "alpha" } },
      "#9PYLQG": { identity: { tag: "#9PYLQG", name: "Bravo", discordId: "222", discordUsername: "bravo" } },
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

test("active contract preserves and clamps CWL prep distribution settings", () => {
  const backend = loadBackend();
  const data = buildValidRosterData();
  data.rosters[0].trackingMode = "cwl";
  data.rosters[0].cwlPreparation = {
    enabled: true,
    rosterSize: 15,
    distributionMode: "fill",
    substituteCount: 99,
    requirements: {
      minTownHall: 16,
      maxMissedAttacks: 1,
      maxMissedAttackRate: 0.15,
    },
    lockStateByTag: {},
    assignedTagSet: { "#PLAYER": true },
    excludedTagSet: {},
    clanAbsentTagSet: {},
  };

  const validated = backend.validateRosterData_(data);
  const prep = validated.rosters[0].cwlPreparation;

  assert.equal(prep.distributionMode, "fill");
  assert.equal(prep.substituteCount, 35);
  assert.equal(prep.rosterSize, 15);
  assert.deepEqual({ ...prep.requirements }, {
    minTownHall: 16,
    maxMissedAttacks: 1,
    maxMissedAttackRate: 0.15,
  });
  assert.equal(prep.assignedTagSet["#PLAYER"], true);
});

test("active contract preserves missing CWL reserve records without counting their locks or assignments", () => {
  const backend = loadBackend();
  const data = buildValidRosterData();
  const makePlayer = (index) => ({
    slot: index + 1,
    name: "Player " + index,
    discord: "player" + index,
    th: 17,
    tag: "#P" + String(index).padStart(3, "0"),
    notes: ["history " + index],
  });
  data.rosters[0].main = Array.from({ length: 15 }, (_, index) => makePlayer(index));
  const reserve = makePlayer(15);
  reserve.slot = null;
  reserve.name = "Missing reserve";
  data.rosters[0].missing = [reserve];
  const allTags = data.rosters[0].main.concat(data.rosters[0].missing).map((player) => player.tag);
  data.rosters[0].trackingMode = "cwl";
  data.rosters[0].cwlPreparation = {
    enabled: true,
    rosterSize: 15,
    substituteCount: 0,
    lockStateByTag: Object.fromEntries(allTags.map((tag) => [tag, "lockedIn"])),
    assignedTagSet: Object.fromEntries(allTags.map((tag) => [tag, true])),
    excludedTagSet: {},
    clanAbsentTagSet: { [reserve.tag]: true },
  };

  const validated = backend.validateRosterData_(data);
  const roster = validated.rosters[0];

  assert.equal(roster.main.length, 15);
  assert.equal(roster.missing.length, 1);
  assert.equal(roster.missing[0].tag, reserve.tag);
  assert.equal(roster.missing[0].name, "Missing reserve");
  assert.deepEqual(Array.from(roster.missing[0].notes), ["history 15"]);
  assert.equal(roster.cwlPreparation.lockStateByTag[reserve.tag], "lockedIn", "return-time intent is retained");
  assert.equal(roster.cwlPreparation.assignedTagSet[reserve.tag], undefined, "reserve is not an active assignment");
  assert.equal(roster.cwlPreparation.clanAbsentTagSet[reserve.tag], true);
});

test("active contract defaults missing or null CWL prep requirements to disabled", () => {
  const backend = loadBackend();
  const buildData = (requirementsValue, includeRequirements) => {
    const data = buildValidRosterData();
    data.rosters[0].trackingMode = "cwl";
    data.rosters[0].cwlPreparation = {
      enabled: true,
      rosterSize: 15,
      distributionMode: "subs",
      substituteCount: 0,
      lockStateByTag: {},
      assignedTagSet: { "#PLAYER": true },
      excludedTagSet: {},
      clanAbsentTagSet: {},
    };
    if (includeRequirements) data.rosters[0].cwlPreparation.requirements = requirementsValue;
    return data;
  };

  const missing = backend.validateRosterData_(buildData(undefined, false)).rosters[0].cwlPreparation.requirements;
  const explicitNull = backend.validateRosterData_(buildData(null, true)).rosters[0].cwlPreparation.requirements;

  const disabled = { minTownHall: 0, maxMissedAttacks: null, maxMissedAttackRate: null };
  assert.deepEqual({ ...missing }, disabled);
  assert.deepEqual({ ...explicitNull }, disabled);
});

test("active contract clamps CWL prep requirements without coercing null gates to zero", () => {
  const backend = loadBackend();
  const validateRequirements = (requirements) => {
    const data = buildValidRosterData();
    data.rosters[0].trackingMode = "cwl";
    data.rosters[0].cwlPreparation = {
      enabled: true,
      rosterSize: 15,
      requirements,
    };
    return backend.validateRosterData_(data).rosters[0].cwlPreparation.requirements;
  };

  assert.deepEqual({ ...validateRequirements({
    minTownHall: 123.9,
    maxMissedAttacks: 1200.8,
    maxMissedAttackRate: 4,
  }) }, {
    minTownHall: 99,
    maxMissedAttacks: 999,
    maxMissedAttackRate: 1,
  });
  assert.deepEqual({ ...validateRequirements({
    minTownHall: -4,
    maxMissedAttacks: -7,
    maxMissedAttackRate: -0.25,
  }) }, {
    minTownHall: 0,
    maxMissedAttacks: 0,
    maxMissedAttackRate: 0,
  });
  assert.deepEqual({ ...validateRequirements({
    minTownHall: null,
    maxMissedAttacks: null,
    maxMissedAttackRate: null,
  }) }, {
    minTownHall: 0,
    maxMissedAttacks: null,
    maxMissedAttackRate: null,
  });
});

test("CWL prep missed-attack limits fail closed when misses exist without recorded opportunities", () => {
  const backend = loadBackend();

  assert.equal(backend.meetsCwlPreparationRequirements_({
    th: 17,
    missedAttacks: 1,
    attackOpportunities: 0,
  }, {
    maxMissedAttackRate: 0,
  }), false);
});

test("active reader reconstructs the published active version before legacy active", () => {
  const backend = installMemoryFirebase(loadBackend());
  const versionedData = buildValidRosterData();
  versionedData.pageTitle = "Versioned Roster";
  versionedData.playerWarPerformance = backend.sanitizePlayerWarPerformanceStore_({
    stage: "shadow",
    byTag: {
      "#PLAYER": {
        regular: {
          warsInLineup: 1,
          possibleAttacks: 2,
          usedAttacks: 1,
          attacksMade: 1,
          attacksMissed: 1,
          starsTotal: 2,
          totalDestruction: 75,
          countedAttacks: 1,
          formEligibleAttacks: 1,
          threeStarCount: 0,
        },
      },
    },
    meta: {
      eventCount: 1,
      baselineCount: 0,
      conflictCount: 0,
    },
  });
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
  assert.equal(snapshot.rosterData.playerWarPerformance.schemaVersion, 2);
  assert.equal(snapshot.rosterData.playerWarPerformance.stage, "shadow");
  assert.equal(snapshot.rosterData.playerWarPerformance.byTag["#PLAYER"].regular.starsTotal, 2);
  assert.ok(reads.includes("activeVersions/version-1/manifest"));
  assert.ok(reads.includes("activeVersions/version-1/rosters/main"));
  assert.ok(reads.includes("activeVersions/version-1/playerWarPerformance"));
  assert.equal(reads.includes("activeVersions/version-1/rosters"), false);
});

test("canonical active writes propagate their new immutable version id through every return path", () => {
  const backend = installMemoryFirebase(loadBackend());
  const rosterData = backend.validateRosterData_(buildValidRosterData());
  backend.cleanupFirebaseStorageRetentionBestEffort_ = () => ({ ok: true });
  backend.enqueueCloudflareActiveTarget_ = () => ({ ok: true, queued: true });

  const replaced = backend.replaceActiveRosterData_(rosterData, {
    sourceSnapshot: {
      versionId: "source-version",
      rosterData,
      text: JSON.stringify(rosterData),
    },
  });

  assert.equal(backend.isSafeActiveVersionId_(replaced.versionId), true);
  assert.equal(backend.readPublishedActiveVersionIdRaw_(), replaced.versionId);

  backend.deferActiveRosterLockAction_ = () => true;
  const deferred = backend.putValidatedActiveRosterDataToFirebase_(rosterData);
  assert.equal(backend.isSafeActiveVersionId_(deferred.versionId), true);
  assert.equal(backend.readPublishedActiveVersionIdRaw_(), deferred.versionId);

  const deterministicVersionId = "admin-publish-deterministic-test";
  const deterministic = backend.replaceActiveRosterData_(rosterData, {
    sourceSnapshot: {
      versionId: deferred.versionId,
      rosterData,
      text: JSON.stringify(rosterData),
    },
    activeVersionIdOverride: deterministicVersionId,
    activeVersionSource: "admin-publish-v2",
  });
  assert.equal(deterministic.versionId, deterministicVersionId);
  assert.equal(backend.readPublishedActiveVersionIdRaw_(), deterministicVersionId);
  const manifest = backend.decodeFirebaseObjectKeysRecursive_(
    backend.firebaseRequestJson_("activeVersions/" + deterministicVersionId + "/manifest", "GET"),
  );
  assert.equal(manifest.source, "admin-publish-v2");
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
  assert.equal(Object.prototype.hasOwnProperty.call(meta, "rosterData"), false);
  assert.equal(backend.countPlayerMetricDataEntries_(written.playerMetrics), 1);
  assert.equal(identity.discordUsername, "phuuni");
});

test("publish meta returns the exact canonical written roster only when requested", () => {
  const backend = loadBackend();
  const data = buildValidRosterData();
  const sourceSnapshot = { rosterData: buildValidRosterData(), text: "{}" };
  let canonicalWritten = null;

  backend.readActiveRosterSnapshot_ = () => sourceSnapshot;
  backend.createPublishArchiveBackupFromSnapshot_ = () => ({ created: false, key: "" });
  backend.cleanupPublishArchiveBackups_ = () => 0;
  backend.firebaseRequestJson_ = () => null;
  backend.markActiveDataWriteSuccess_ = () => null;
  backend.reconcileRegularWarFinalizationTriggerStateValidated_ = () => null;
  backend.replaceActiveRosterData_ = (payload) => {
    canonicalWritten = backend.validateRosterData_(payload);
    canonicalWritten.pageTitle = "Canonical server result";
    return {
      validatedRosterData: canonicalWritten,
      text: JSON.stringify(canonicalWritten),
      versionId: "version-canonical",
    };
  };

  const meta = backend.writePublishedRosterData_(data, {
    sourceSnapshot,
    includeRosterDataInResult: true,
  });

  assert.equal(meta.activeVersionId, "version-canonical");
  assert.equal(meta.rosterData.pageTitle, "Canonical server result");
  assert.deepEqual(clone(meta.rosterData), clone(canonicalWritten));
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

  const donationSentinel = {
    current: { seasonId: "season-existing", sourceVersionId: "version-existing" },
    bySeason: { "season-existing": { byTag: { sentinel: { total: 123 } } } },
  };
  backend.firebaseRequestJson_("donationRefresh", "PUT", donationSentinel);
  backend.runDonationRefreshCore_ = () => {
    throw new Error("refresh-all must not invoke detached donation refresh");
  };

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
  assert.deepEqual(backend.firebaseRequestJson_("donationRefresh", "GET"), donationSentinel);
});

test("storage retention protects canonical repair source and staging versions", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildValidRosterData());
  backend.writeActiveRosterVersionShards_("selected-corrupt", data, { publish: true, source: "test" });
  backend.writeActiveRosterVersionShards_("known-good-source", data, { publish: false, source: "test" });
  backend.writeActiveRosterVersionShards_("repair-staging", data, { publish: false, source: "test" });
  backend.writeActiveRosterVersionShards_("unreferenced-old", data, { publish: false, source: "test" });
  backend.firebaseRequestJson_("internal/autoRefresh/canonicalRepairs/selected-corrupt", "PUT", {
    runId: "selected-corrupt",
    sourceVersionId: "known-good-source",
    repairVersionId: "repair-staging",
    status: "repairing",
  });

  const result = backend.cleanupFirebaseStorageRetention_({ reason: "repair-retention-test" });

  assert.ok(backend.firebaseRequestJson_("activeVersions/selected-corrupt", "GET"));
  assert.ok(backend.firebaseRequestJson_("activeVersions/known-good-source", "GET"));
  assert.ok(backend.firebaseRequestJson_("activeVersions/repair-staging", "GET"));
  assert.equal(backend.firebaseRequestJson_("activeVersions/unreferenced-old", "GET"), null);
  assert.equal(result.activeVersions.deletedCount, 1);
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
  assert.deepEqual(Array.from(donationNeedsChoice.linkedAccounts, account => account.tag), ["#8CCVV", "#9PYLQG"]);

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

test("season event signup resolves the current event directly and preserves existing-participant behavior", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.reconcileCurrentSeasonEvents({ manualSeason: seasonFixture }, "secret");
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildSeasonEventRosterData(), text: "" });

  const signed = backend.registerSeasonEventSignup({
    eventType: "donation",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
    playerTags: ["#9PYLQG"],
    source: { type: "discord-button" },
  }, "secret");

  assert.equal(signed.status, "signed-up");
  assert.equal(signed.event.eventId, "donation-2026-05");

  const existingEventIdContract = backend.registerSeasonEventSignup({
    eventId: "donation-2026-05",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
    source: { type: "discord-button" },
  }, "secret");
  assert.equal(existingEventIdContract.status, "multiple-linked-accounts");

  backend.readActivePlayerMetricsSnapshot_ = () => {
    throw new Error("already-signed-up must not reload active player metrics");
  };
  const existing = backend.registerSeasonEventSignup({
    eventType: "donation",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
    source: { type: "discord-button" },
  }, "secret");

  assert.equal(existing.status, "already-signed-up");
  assert.equal(existing.participant.discordId, "222");
});

test("direct current CWL signup reports unresolved target before existing participant state", () => {
  const backend = installMemoryFirebase(loadBackend());
  const event = {
    eventId: "cwl-unresolved-direct",
    type: "cwl",
    title: "CWL",
    status: "open",
    visibility: "public",
    signupsOpen: true,
    startsAt: "2000-01-01T00:00:00.000Z",
    endsAt: "2100-01-01T00:00:00.000Z",
    cwlTrackingState: "active",
    cwl: { target: { status: "unresolved", reason: "not-selected" } },
    participantsByDiscordId: {
      "111": { discordId: "111", status: "signed_up", accounts: [{ tag: "#2LUCULP", name: "Alpha" }] },
    },
  };
  backend.writeSeasonEventFirebasePayload_(backend.buildSeasonEventByIdPath_(event.eventId), "PUT", event);
  backend.writeSeasonEventFirebasePayload_("events/seasonEvents/currentCwl", "PUT", { eventId: event.eventId, type: "cwl" });
  backend.readActivePlayerMetricsSnapshot_ = () => {
    throw new Error("unresolved CWL must not load active player metrics");
  };

  const result = backend.registerSeasonEventSignup({
    eventType: "cwl",
    discordUser: { id: "111", username: "alpha" },
  }, "secret");

  assert.equal(result.status, "cwl-target-unresolved");
});

test("direct current push and resolved CWL seasonal signups use the optimized mutation contract", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.reconcileCurrentSeasonEvents({ manualSeason: seasonFixture }, "secret");
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildSeasonEventRosterData(), text: "" });
  const publications = [];
  backend.enqueueCloudflareSeasonEventPublication_ = (eventId, reason, options) => {
    publications.push({ eventId, reason, options: clone(options || {}) });
    return { ok: true, queued: true };
  };

  const push = backend.registerSeasonEventSignup({
    eventType: "push",
    discordUser: { id: "111", username: "alpha", globalName: "Alpha", displayName: "Alpha" },
    source: { type: "discord-button" },
  }, "secret");

  const cwlEvent = {
    eventId: "cwl-direct-optimized",
    type: "cwl",
    title: "CWL",
    status: "open",
    visibility: "public",
    signupsOpen: true,
    cwlTrackingState: "active",
    cwl: {
      target: {
        resolved: true,
        status: "resolved",
        rosterId: "main",
        clanTag: "#2LUCULP",
        leagueName: "Champion I",
        leagueRank: 0,
        eligibleAccountTags: ["#2LUCULP"],
      },
    },
    participantsByDiscordId: {},
    participantsByTag: {},
  };
  backend.writeSeasonEventFirebasePayload_(backend.buildSeasonEventByIdPath_(cwlEvent.eventId), "PUT", cwlEvent);
  backend.writeSeasonEventFirebasePayload_("events/seasonEvents/currentCwl", "PUT", { eventId: cwlEvent.eventId, type: "cwl" });

  const cwl = backend.registerSeasonEventSignup({
    eventType: "cwl",
    discordUser: { id: "111", username: "alpha", globalName: "Alpha", displayName: "Alpha" },
    source: { type: "discord-button" },
  }, "secret");

  assert.equal(push.status, "signed-up");
  assert.equal(push.event.type, "push");
  assert.equal(cwl.status, "signed-up");
  assert.equal(cwl.event.type, "cwl");
  assert.equal(publications.length, 2);
  assert.equal(publications[0].eventId, push.event.eventId);
  assert.deepEqual(publications[0].options, {});
  assert.equal(publications[1].eventId, cwlEvent.eventId);
  assert.equal(publications[1].options.cwlLifecycle.liveAggregateAction, "put");
  assert.equal(publications[1].options.cwlLifecycle.finalAggregateAction, "none");
  assert.equal(publications[1].options.cwlLifecycle.pointerAction, "none");
});

test("season event signup commits participant state with one atomic Firebase batch", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.reconcileCurrentSeasonEvents({ manualSeason: seasonFixture }, "secret");
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildSeasonEventRosterData(), text: "" });
  backend.enqueueCloudflareSeasonEventPublication_ = () => ({ ok: true, queued: true });
  const originalBatchPut = backend.firebaseBatchPutJson_;
  const batches = [];
  backend.firebaseBatchPutJson_ = (entries, options) => {
    batches.push({ entries: clone(entries), options: clone(options || {}) });
    return originalBatchPut(entries, options);
  };
  backend.removeSeasonEventParticipantTagIndexes_ = () => assert.fail("signup must not issue serial tag-index removals");
  backend.addSeasonEventParticipantTagIndexes_ = () => assert.fail("signup must not issue serial tag-index writes");

  const result = backend.registerSeasonEventSignup({
    eventId: "donation-2026-05",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
    playerTags: ["#9PYLQG", "#8CCVV"],
    source: { type: "discord-button" },
  }, "secret");

  assert.equal(result.status, "signed-up");
  assert.equal(batches.length, 1);
  assert.equal(batches[0].options.disableFallback, true);
  const paths = batches[0].entries.map(entry => entry.path);
  assert.ok(paths.includes(backend.buildSeasonEventParticipantPath_("donation-2026-05", "222")));
  assert.ok(paths.includes(backend.buildSeasonEventParticipantTagIndexPath_("donation-2026-05", "#9PYLQG")));
  assert.ok(paths.includes(backend.buildSeasonEventParticipantTagIndexPath_("donation-2026-05", "#8CCVV")));
  assert.ok(paths.includes(backend.buildFirebaseChildPath_(backend.buildSeasonEventByIdPath_("donation-2026-05"), "updatedAt")));
  assert.equal(paths.filter(path => path.includes("/audit/")).length, 1);
});

test("failed atomic season event signup leaves Firebase unchanged and does not enqueue publication", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.reconcileCurrentSeasonEvents({ manualSeason: seasonFixture }, "secret");
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildSeasonEventRosterData(), text: "" });
  let enqueueCount = 0;
  backend.enqueueCloudflareSeasonEventPublication_ = () => {
    enqueueCount += 1;
    return { ok: true, queued: true };
  };
  const before = clone(backend.__getFirebaseDb());
  backend.firebaseBatchPutJson_ = () => {
    throw new Error("atomic write failed");
  };

  assert.throws(() => backend.registerSeasonEventSignup({
    eventId: "donation-2026-05",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
    playerTags: ["#9PYLQG"],
  }, "secret"), /atomic write failed/);
  assert.deepEqual(backend.__getFirebaseDb(), before);
  assert.equal(enqueueCount, 0);
});

test("active player metrics snapshot reads only the selected immutable metrics shard", () => {
  const backend = loadBackend();
  const playerMetrics = buildSeasonEventRosterData().playerMetrics;
  installMemoryFirebase(backend, {
    activePublished: { currentVersionId: "version-1" },
    activeVersions: {
      "version-1": {
        playerMetrics: backend.encodeFirebaseObjectKeysRecursive_(playerMetrics),
      },
    },
  });
  const realRequest = backend.firebaseRequestJson_;
  const requests = [];
  backend.firebaseRequestJson_ = (path, method, payload) => {
    requests.push({ path: String(path || ""), method: String(method || "GET").toUpperCase() });
    return realRequest(path, method, payload);
  };
  backend.readActiveRosterSnapshot_ = () => {
    throw new Error("complete active roster reconstruction must not be used");
  };

  const snapshot = backend.readActivePlayerMetricsSnapshot_();

  assert.equal(snapshot.versionId, "version-1");
  assert.equal(JSON.stringify(snapshot.playerMetrics), JSON.stringify(playerMetrics));
  assert.deepEqual(requests, [
    { path: "activePublished/currentVersionId", method: "GET" },
    { path: "activeVersions/version-1/playerMetrics", method: "GET" },
  ]);
});

test("active player metrics subset reads only exact requested tag children", () => {
  const backend = installMemoryFirebase(loadBackend());
  const rosterData = backend.validateRosterData_(buildSeasonEventRosterData());
  backend.writeActiveRosterVersionShards_("subset-version", rosterData, { publish: true, source: "test" });
  const requestedPaths = [];
  const realBatchGet = backend.firebaseBatchGetJson_;
  backend.firebaseBatchGetJson_ = (paths, options) => {
    requestedPaths.push(...Array.from(paths || [], path => String(path)));
    return realBatchGet(paths, options);
  };
  backend.readActivePlayerMetricsSnapshot_ = () => {
    throw new Error("complete metrics snapshot must not be used for a valid subset read");
  };

  const snapshot = backend.readActivePlayerMetricsSubsetSnapshot_([
    "#9PYLQG",
    "#2LUCULP",
    "#9PYLQG",
    "#NOTTHERE",
  ]);

  assert.equal(snapshot.versionId, "subset-version");
  assert.equal(snapshot.requestedTagCount, 3);
  assert.equal(snapshot.foundTagCount, 2);
  assert.deepEqual(Object.keys(snapshot.playerMetrics.byTag).sort(), ["#2LUCULP", "#9PYLQG"]);
  assert.deepEqual(requestedPaths.sort(), ["#2LUCULP", "#9PYLQG", "#NOTTHERE"].map(tag =>
    backend.buildActiveVersionPath_("subset-version", "playerMetrics/byTag/" + backend.encodeFirebaseObjectKey_(tag))
  ).sort());
  assert.equal(requestedPaths.some(path => /\/playerMetrics$/.test(path)), false);
});

test("active roster layout reconstruction never reads player metrics", () => {
  const backend = installMemoryFirebase(loadBackend());
  const rosterData = backend.validateRosterData_(buildCwlLeagueSignupRosterData());
  backend.writeActiveRosterVersionShards_("layout-version", rosterData, { publish: true, source: "test" });
  const reads = [];
  const realRequest = backend.firebaseRequestJson_;
  backend.firebaseRequestJson_ = (path, method, payload, options) => {
    if (String(method || "GET").toUpperCase() === "GET") reads.push(String(path || ""));
    return realRequest(path, method, payload, options);
  };

  const snapshot = backend.readActiveRosterLayoutSnapshot_();

  assert.equal(snapshot.versionId, "layout-version");
  assert.equal(snapshot.layoutOnly, true);
  assert.equal(snapshot.rosterData.rosters.length, rosterData.rosters.length);
  assert.deepEqual(Object.keys(snapshot.rosterData.playerMetrics.byTag), []);
  assert.equal(reads.some(path => /\/playerMetrics(?:\/|$)/.test(path)), false);
});

test("published roster authorization uses compact immutable manifest membership", () => {
  const backend = installMemoryFirebase(loadBackend());
  const rosterData = backend.validateRosterData_(buildCwlLeagueSignupRosterData());
  backend.writeActiveRosterVersionShards_("membership-version", rosterData, { publish: true, source: "test" });
  const cacheValues = new Map();
  backend.CacheService = {
    getScriptCache: () => ({
      get: key => cacheValues.has(key) ? cacheValues.get(key) : null,
      put: (key, value) => cacheValues.set(String(key), String(value)),
    }),
  };
  const reads = [];
  const realRequest = backend.firebaseRequestJson_;
  backend.firebaseRequestJson_ = (path, method, payload, options) => {
    if (String(method || "GET").toUpperCase() === "GET") reads.push(String(path || ""));
    return realRequest(path, method, payload, options);
  };
  backend.getRosterData = () => {
    throw new Error("complete active roster must not be used for manifest membership");
  };

  assert.equal(backend.isPublishedRosterTag_("#2LUCULP"), true);
  assert.equal(backend.isPublishedRosterTag_("#PYYQQ"), false);
  assert.equal(reads.filter(path => /\/manifest$/.test(path)).length, 1);
  assert.equal(reads.some(path => /\/playerMetrics(?:\/|$)/.test(path)), false);
  assert.ok(cacheValues.has("published-roster-tags-v1:membership-version"));
});

test("active player metrics snapshot rejects noncanonical identities and uses the validated fallback", () => {
  const backend = loadBackend();
  const fallbackMetrics = buildSeasonEventRosterData().playerMetrics;
  installMemoryFirebase(backend, {
    activePublished: { currentVersionId: "version-bad" },
    activeVersions: {
      "version-bad": {
        playerMetrics: backend.encodeFirebaseObjectKeysRecursive_({
          byTag: {
            "#2LUCULP": {
              identity: { tag: "#9PYLQG", name: "Wrong identity" },
              latestSnapshot: { tag: "#9PYLQG", name: "Wrong identity" },
            },
          },
        }),
      },
    },
  });
  let fallbackCalls = 0;
  backend.readActiveRosterSnapshot_ = () => {
    fallbackCalls += 1;
    return {
      rosterData: { playerMetrics: fallbackMetrics },
      source: "firebase:/active",
      versionId: "fallback-version",
    };
  };

  const snapshot = backend.readActivePlayerMetricsSnapshot_();

  assert.equal(fallbackCalls, 1);
  assert.equal(snapshot.fallback, true);
  assert.equal(snapshot.source, "firebase:/active");
  assert.equal(snapshot.versionId, "fallback-version");
  assert.equal(JSON.stringify(snapshot.playerMetrics), JSON.stringify(fallbackMetrics));
});

test("active player metrics snapshot recovers a missing selected shard from validated active data", () => {
  const backend = installMemoryFirebase(loadBackend());
  const versionedData = backend.validateRosterData_(buildValidRosterData());
  const fallbackData = buildValidRosterData();
  fallbackData.pageTitle = "Fallback Active";
  fallbackData.playerMetrics.byTag["#PLAYER"].identity.name = "Fallback Identity";
  backend.writeActiveRosterVersionShards_("version-missing-metrics", versionedData, { publish: true, source: "test" });
  backend.firebaseRequestJson_(backend.buildActiveVersionPath_("version-missing-metrics", "playerMetrics"), "DELETE");
  backend.firebaseRequestJson_("active", "PUT", backend.encodeFirebaseObjectKeysRecursive_(fallbackData));

  const snapshot = backend.readActivePlayerMetricsSnapshot_();

  assert.equal(snapshot.fallback, true);
  assert.equal(snapshot.source, "firebase:/active");
  assert.equal(snapshot.playerMetrics.byTag["#PLAYER"].identity.name, "Fallback Identity");
});

test("legacy active version linked-account lookup builds its persistent index once", () => {
  const backend = installMemoryFirebase(loadBackend());
  const rosterDataRaw = buildSeasonEventRosterData();
  rosterDataRaw.playerMetrics.byTag["#2PPYQQ"] = {
    identity: { tag: "#2PPYQQ", name: "Legacy", discordUsername: "legacy_user" },
    latestSnapshot: { tag: "#2PPYQQ", name: "Legacy", townHallLevel: 14, trophies: 4800 },
    trophyHistoryDaily: [],
  };
  const rosterData = backend.validateRosterData_(rosterDataRaw);
  backend.writeActiveRosterVersionShards_("link-cache-v1", rosterData, { publish: true, source: "test" });
  backend.firebaseRequestJson_(
    backend.buildActiveVersionPath_("link-cache-v1", "indexes/linkedAccountTags"),
    "DELETE",
  );
  const originalRequest = backend.firebaseRequestJson_;
  let metricsReads = 0;
  backend.firebaseRequestJson_ = (path, method, payload, query) => {
    if (String(method || "GET").toUpperCase() === "GET" && /activeVersions\/[^/]+\/playerMetrics$/.test(String(path || ""))) metricsReads += 1;
    return originalRequest(path, method, payload, query);
  };

  const bravo = backend.readSeasonEventLinkedAccountsForDiscordUser_({ id: "222", username: "bravo" });
  const alpha = backend.readSeasonEventLinkedAccountsForDiscordUser_({ id: "111", username: "alpha" });
  const legacy = backend.readSeasonEventLinkedAccountsForDiscordUser_({ id: "legacy-discord-id", username: "legacy_user" });
  const missing = backend.readSeasonEventLinkedAccountsForDiscordUser_({ id: "unknown", username: "unknown" });

  assert.deepEqual(Array.from(bravo, account => account.tag), ["#8CCVV", "#9PYLQG"]);
  assert.deepEqual(Array.from(alpha, account => account.tag), ["#2LUCULP"]);
  assert.deepEqual(Array.from(legacy, account => [account.tag, account.matchType]), [["#2PPYQQ", "discordUsername"]]);
  assert.equal(missing.length, 0);
  assert.equal(metricsReads, 1);
  const storedManifest = backend.decodeFirebaseObjectKeysRecursive_(backend.firebaseRequestJson_(
    backend.buildActiveVersionPath_("link-cache-v1", "indexes/linkedAccountTags/manifest"),
    "GET",
  ));
  assert.equal(storedManifest.complete, true);
  assert.equal(storedManifest.versionId, "link-cache-v1");
});

test("season event linked-account index reads and verifies only exact metric entries", () => {
  const backend = installMemoryFirebase(loadBackend());
  const rosterData = backend.validateRosterData_(buildSeasonEventRosterData());
  backend.writeActiveRosterVersionShards_("indexed-links-v1", rosterData, { publish: true, source: "test" });
  const requestedPaths = [];
  const realBatchGet = backend.firebaseBatchGetJson_;
  backend.firebaseBatchGetJson_ = (paths, options) => {
    requestedPaths.push(...Array.from(paths || [], path => String(path)));
    return realBatchGet(paths, options);
  };
  backend.readActivePlayerMetricsSnapshot_ = () => {
    throw new Error("full Firebase playerMetrics must not be downloaded for an indexed lookup");
  };

  const accounts = backend.readSeasonEventLinkedAccountsForDiscordUser_({ id: "111", username: "alpha" });

  assert.deepEqual(Array.from(accounts, account => account.tag), ["#2LUCULP"]);
  assert.equal(accounts[0].matchType, "discordId");
  assert.equal(requestedPaths.some(path => /\/playerMetrics$/.test(path)), false);
  assert.deepEqual(
    requestedPaths.filter(path => /\/playerMetrics\/byTag\//.test(path)),
    [backend.buildActiveVersionPath_("indexed-links-v1", "playerMetrics/byTag/" + backend.encodeFirebaseObjectKey_("#2LUCULP"))],
  );
  assert.equal(requestedPaths.some(path => /\/indexes\/linkedAccountTags\/manifest$/.test(path)), true);
  assert.equal(requestedPaths.some(path => /\/indexes\/linkedAccountTags\/byDiscordId\/111$/.test(path)), true);
});

test("admin bridge materializes a legacy linked-account index idempotently", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.PropertiesService.getScriptProperties().setProperty("ADMIN_PW", "secret");
  const rosterData = backend.validateRosterData_(buildSeasonEventRosterData());
  backend.writeActiveRosterVersionShards_("legacy-index-v1", rosterData, { publish: true, source: "test" });
  backend.firebaseRequestJson_(backend.buildActiveVersionPath_("legacy-index-v1", "indexes/linkedAccountTags"), "DELETE");

  const first = backend.runAdminApiMethod_("ensureActiveLinkedAccountTagIndex", ["secret"]);
  const second = backend.runAdminApiMethod_("ensureActiveLinkedAccountTagIndex", ["secret"]);

  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  assert.equal(first.versionId, "legacy-index-v1");
  assert.equal(first.linkedTagCount, 4);
  assert.equal(second.ok, true);
  assert.equal(second.created, false);
  assert.equal(second.reason, "already-complete");
});

test("admin workspace bootstrap authenticates once and loads both settings under one lock", () => {
  const backend = loadBackend();
  backend.PropertiesService.getScriptProperties().setProperty("ADMIN_PW", "secret");
  const calls = [];
  let waitCount = 0;
  let releaseCount = 0;
  backend.LockService.getScriptLock = () => ({
    waitLock() {
      waitCount += 1;
    },
    releaseLock() {
      releaseCount += 1;
    },
  });
  backend.reconcileAutoRefreshTriggerState_ = () => {
    calls.push("auto-reconcile");
  };
  backend.reconcileRegularWarFinalizationTriggerState_ = () => {
    calls.push("war-reconcile");
  };
  backend.readAutoRefreshSettings_ = () => {
    calls.push("auto-read");
    return { enabled: true, intervalHours: 2 };
  };
  backend.reconcileDonationRefreshTriggerState_ = () => {
    calls.push("donation-reconcile");
  };
  backend.readDonationRefreshSettings_ = () => {
    calls.push("donation-read");
    return { enabled: false, intervalMinutes: 30 };
  };

  const result = clone(backend.runAdminApiMethod_("getAdminWorkspaceBootstrap", ["secret"]));

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.authenticated, true);
  assert.deepEqual(result.autoRefresh, {
    ok: true,
    value: { enabled: true, intervalHours: 2 },
  });
  assert.deepEqual(result.donationRefresh, {
    ok: true,
    value: { enabled: false, intervalMinutes: 30 },
  });
  assert.deepEqual(calls, [
    "auto-reconcile",
    "war-reconcile",
    "auto-read",
    "donation-reconcile",
    "donation-read",
  ]);
  assert.equal(waitCount, 1);
  assert.equal(releaseCount, 1);
  assert.throws(
    () => backend.runAdminApiMethod_("getAdminWorkspaceBootstrap", ["wrong"]),
    /Authentication failed/,
  );
  assert.equal(waitCount, 1);
});

test("admin workspace bootstrap preserves partial settings failures", () => {
  const backend = loadBackend();
  backend.PropertiesService.getScriptProperties().setProperty("ADMIN_PW", "secret");
  let donationReads = 0;
  backend.reconcileAutoRefreshTriggerState_ = () => {
    throw new Error("auto startup failed");
  };
  backend.reconcileDonationRefreshTriggerState_ = () => {};
  backend.readDonationRefreshSettings_ = () => {
    donationReads += 1;
    return { enabled: true };
  };

  const result = clone(backend.runAdminApiMethod_("getAdminWorkspaceBootstrap", ["secret"]));

  assert.equal(result.authenticated, true);
  assert.deepEqual(result.autoRefresh, {
    ok: false,
    error: "auto startup failed",
  });
  assert.deepEqual(result.donationRefresh, {
    ok: true,
    value: { enabled: true },
  });
  assert.equal(donationReads, 1);
});

test("admin workspace bootstrap preserves unlock when the settings lock is busy", () => {
  const backend = loadBackend();
  backend.PropertiesService.getScriptProperties().setProperty("ADMIN_PW", "secret");
  backend.LockService.getScriptLock = () => ({
    waitLock() {
      throw new Error("settings lock timeout");
    },
    releaseLock() {
      assert.fail("An unacquired script lock must not be released.");
    },
  });

  const result = clone(backend.runAdminApiMethod_("getAdminWorkspaceBootstrap", ["secret"]));

  assert.equal(result.authenticated, true);
  assert.deepEqual(result.autoRefresh, {
    ok: false,
    error: "settings lock timeout",
  });
  assert.deepEqual(result.donationRefresh, {
    ok: false,
    error: "settings lock timeout",
  });
});

test("Admin Unlock V2 authenticates before one small control batch and performs no runtime or roster work", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.PropertiesService.getScriptProperties().setProperty("ADMIN_PW", "secret");
  backend.PropertiesService.getScriptProperties().setProperty("AUTO_REFRESH_ENABLED", "1");
  backend.PropertiesService.getScriptProperties().setProperty("DONATION_REFRESH_ENABLED", "1");
  backend.firebaseRequestJson_("activePublished/currentVersionId", "PUT", "version-control");
  backend.firebaseRequestJson_("active/cwlLeagueSignups", "PUT", backend.encodeFirebaseObjectKeysRecursive_({
    schemaVersion: 2,
    signupId: "signup-control",
    status: "open",
    createdAt: "2026-07-29T00:00:00.000Z",
    optionsByKey: {},
    preferencesByTag: {},
    audit: {},
  }));

  const realBatchGet = backend.firebaseBatchGetJson_;
  const batches = [];
  backend.firebaseBatchGetJson_ = (paths, options) => {
    batches.push(Array.from(paths || [], String));
    return realBatchGet(paths, options);
  };
  backend.readActiveRosterSnapshot_ = () => {
    throw new Error("control snapshot must not reconstruct the roster");
  };
  backend.findLatestAutoRefreshArchiveDate_ = () => {
    throw new Error("control snapshot must not scan archives");
  };
  backend.reconcileAutoRefreshTriggerState_ = () => {
    throw new Error("control snapshot must not repair triggers");
  };
  backend.ScriptApp = {
    getProjectTriggers() {
      throw new Error("control snapshot must not enumerate triggers");
    },
  };

  const result = clone(backend.runAdminApiMethod_("getAdminUnlockSnapshotV2", ["secret"]));

  assert.equal(result.schemaVersion, 2);
  assert.equal(result.authenticated, true);
  assert.equal(result.activeVersionId, "version-control");
  assert.equal(result.autoRefresh.ok, true);
  assert.equal(result.autoRefresh.value.enabled, true);
  assert.equal(result.autoRefresh.value.runtimeVerified, false);
  assert.equal(result.donationRefresh.value.enabled, true);
  assert.equal(result.cwlLeagueSignups.ok, true);
  assert.equal(result.cwlLeagueSignups.value.signupId, "signup-control");
  assert.deepEqual(batches, [[
    "activePublished/currentVersionId",
    "active/cwlLeagueSignups",
  ]]);

  let postAuthReads = 0;
  backend.firebaseBatchGetJson_ = () => {
    postAuthReads += 1;
    return {};
  };
  assert.throws(
    () => backend.runAdminApiMethod_("getAdminUnlockSnapshotV2", ["wrong"]),
    /Authentication failed/,
  );
  assert.equal(postAuthReads, 0);
});

test("Admin Unlock V2 reports private signup failure while salvaging the canonical pointer", () => {
  const backend = loadBackend();
  backend.PropertiesService.getScriptProperties().setProperty("ADMIN_PW", "secret");
  backend.firebaseBatchGetJson_ = () => {
    throw new Error("signup transport failed");
  };
  backend.readPublishedActiveVersionIdRaw_ = () => "version-salvaged";

  const result = clone(backend.getAdminUnlockSnapshotV2("secret"));

  assert.equal(result.authenticated, true);
  assert.equal(result.activeVersionId, "version-salvaged");
  assert.equal(result.activeRoster.ok, true);
  assert.equal(result.activeRoster.recovered, true);
  assert.equal(result.cwlLeagueSignups.ok, false);
  assert.match(result.cwlLeagueSignups.error, /signup transport failed/);
});

test("Admin roster V2 reads one exact immutable generation in two batches and rejects pointer drift", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.PropertiesService.getScriptProperties().setProperty("ADMIN_PW", "secret");
  const rosterData = backend.validateRosterData_(buildValidRosterData());
  backend.writeActiveRosterVersionShards_("version-exact", rosterData, {
    publish: true,
    source: "test",
  });
  const realBatchGet = backend.firebaseBatchGetJson_;
  const batches = [];
  backend.firebaseBatchGetJson_ = (paths, options) => {
    batches.push(Array.from(paths || [], String));
    return realBatchGet(paths, options);
  };
  const reads = [];
  const realRequest = backend.firebaseRequestJson_;
  backend.firebaseRequestJson_ = (path, method, payload, query) => {
    if (String(method || "GET").toUpperCase() === "GET") reads.push(String(path || ""));
    return realRequest(path, method, payload, query);
  };

  const result = backend.getAdminRosterSnapshotV2("secret", "version-exact");

  assert.equal(result.sourceVersionId, "version-exact");
  assert.equal(result.rosterData.rosters[0].id, "main");
  assert.equal(batches.length, 2);
  assert.deepEqual(batches[0], [
    "activePublished/currentVersionId",
    "activeVersions/version-exact/manifest",
  ]);
  assert.ok(batches[1].includes("activeVersions/version-exact/rosters"));
  assert.ok(batches[1].includes("activeVersions/version-exact/playerMetrics"));
  assert.equal(reads.includes("active"), false);

  backend.readPublishedActiveVersionIdRaw_ = () => "version-newer";
  const conflict = captureError(() => backend.getAdminRosterSnapshotV2("secret", "version-exact"));
  assert.equal(conflict.code, "ADMIN_ACTIVE_VERSION_CONFLICT", conflict && conflict.stack);

  backend.readPublishedActiveVersionIdRaw_ = () => "version-exact";
  backend.firebaseRequestJson_("activeVersions/version-exact/playerMetrics", "DELETE");
  assert.throws(
    () => backend.getAdminRosterSnapshotV2("secret", "version-exact"),
    /Missing active version player metrics/,
  );
});

test("Admin exact roster reader rejects malformed immutable manifest and shard contracts", async (t) => {
  const cases = [
    {
      name: "mismatched manifest version",
      mutate: ({ manifest }) => { manifest.versionId = "version-other"; },
      pattern: /manifest does not match requested version/,
    },
    {
      name: "future root roster schema",
      mutate: ({ manifest }) => { manifest.schemaVersion = 2; },
      pattern: /roster schema is unsupported for admin editing/,
    },
    {
      name: "missing requiredShards",
      mutate: ({ manifest }) => { delete manifest.requiredShards; },
      pattern: /missing requiredShards/,
    },
    {
      name: "duplicate required shard",
      mutate: ({ manifest }) => { manifest.requiredShards.push("rosters"); },
      pattern: /duplicate required shard 'rosters'/,
    },
    {
      name: "unsupported required shard",
      mutate: ({ manifest }) => { manifest.requiredShards.push("futureShard"); },
      pattern: /unsupported required shard 'futureShard'/,
    },
    {
      name: "missing mandatory shard declaration",
      mutate: ({ manifest }) => {
        manifest.requiredShards = manifest.requiredShards.filter((name) => name !== "playerMetrics");
      },
      pattern: /missing required shard 'playerMetrics'/,
    },
    {
      name: "inconsistent performance metadata",
      mutate: ({ manifest }) => {
        manifest.requiredShards = manifest.requiredShards.filter((name) => name !== "playerWarPerformance");
      },
      pattern: /inconsistent playerWarPerformance metadata/,
    },
    {
      name: "duplicate roster id",
      mutate: ({ manifest }) => { manifest.rosterIds.push("main"); },
      pattern: /invalid or duplicate roster id/,
    },
    {
      name: "undeclared roster map entry",
      mutate: ({ rosters }) => {
        rosters.undeclared = { id: "undeclared", title: "Undeclared", main: [], subs: [], missing: [] };
      },
      pattern: /roster map does not match manifest rosterIds/,
    },
    {
      name: "invalid roster order",
      mutate: ({ manifest }) => { manifest.rosterOrder = ["missing"]; },
      pattern: /rosterOrder is not a unique manifest roster permutation/,
    },
    {
      name: "metrics schema mismatch",
      mutate: ({ playerMetrics }) => { playerMetrics.schemaVersion = 2; },
      pattern: /playerMetrics schema does not match its manifest/,
    },
    {
      name: "missing metrics count",
      mutate: ({ manifest }) => { delete manifest.playerMetricEntryCount; },
      pattern: /playerMetrics entry count does not match its manifest/,
    },
    {
      name: "performance schema mismatch",
      mutate: ({ playerWarPerformance }) => { playerWarPerformance.schemaVersion = 3; },
      pattern: /playerWarPerformance schema does not match its manifest/,
    },
    {
      name: "performance count mismatch",
      mutate: ({ manifest }) => { manifest.playerWarPerformanceEntryCount += 1; },
      pattern: /playerWarPerformance entry count does not match its manifest/,
    },
    {
      name: "performance hash mismatch",
      mutate: ({ playerWarPerformance }) => { playerWarPerformance.contentHash = "different"; },
      pattern: /playerWarPerformance hash does not match its manifest/,
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, () => {
      const backend = installMemoryFirebase(loadBackend());
      const versionId = "version-malformed";
      const rosterData = buildValidRosterData();
      rosterData.playerWarPerformance = backend.createEmptyPlayerWarPerformanceStore_();
      backend.writeActiveRosterVersionShards_(
        versionId,
        backend.validateRosterData_(rosterData),
        { source: "strict-contract-test" },
      );

      const readDecoded = (child) => backend.decodeFirebaseObjectKeysRecursive_(
        backend.firebaseRequestJson_(`activeVersions/${versionId}/${child}`, "GET"),
      );
      const writeDecoded = (child, value) => backend.firebaseRequestJson_(
        `activeVersions/${versionId}/${child}`,
        "PUT",
        backend.encodeFirebaseObjectKeysRecursive_(value),
      );
      const values = {
        manifest: readDecoded("manifest"),
        rosters: readDecoded("rosters"),
        playerMetrics: readDecoded("playerMetrics"),
        playerWarPerformance: readDecoded("playerWarPerformance"),
      };
      testCase.mutate(values);
      writeDecoded("manifest", values.manifest);
      writeDecoded("rosters", values.rosters);
      writeDecoded("playerMetrics", values.playerMetrics);
      writeDecoded("playerWarPerformance", values.playerWarPerformance);

      assert.throws(
        () => backend.readActiveRosterSnapshotFromVersionBatchedExact_(versionId),
        testCase.pattern,
      );
    });
  }
});

test("Admin runtime V2 uses one script lock and one mutable trigger inventory", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.PropertiesService.getScriptProperties().setProperty("ADMIN_PW", "secret");
  backend.PropertiesService.getScriptProperties().setProperty("AUTO_REFRESH_ENABLED", "1");
  backend.PropertiesService.getScriptProperties().setProperty("DONATION_REFRESH_ENABLED", "1");
  const rosterData = backend.validateRosterData_(buildValidRosterData());
  backend.writeActiveRosterVersionShards_("version-runtime", rosterData, {
    publish: true,
    source: "test",
  });

  const triggers = [];
  let triggerId = 0;
  let triggerReads = 0;
  let lockReads = 0;
  let releases = 0;
  const createTrigger = (handler) => {
    const trigger = {
      handler,
      id: "runtime-trigger-" + (++triggerId),
      getHandlerFunction() { return this.handler; },
      getUniqueId() { return this.id; },
    };
    triggers.push(trigger);
    return trigger;
  };
  backend.ScriptApp = {
    getProjectTriggers() {
      triggerReads += 1;
      return triggers.slice();
    },
    deleteTrigger(trigger) {
      const index = triggers.indexOf(trigger);
      if (index >= 0) triggers.splice(index, 1);
    },
    newTrigger(handler) {
      return {
        timeBased() {
          const builder = {
            everyHours() { return builder; },
            everyMinutes() { return builder; },
            at() { return builder; },
            create() { return createTrigger(handler); },
          };
          return builder;
        },
      };
    },
  };
  backend.LockService.getScriptLock = () => {
    lockReads += 1;
    return {
      tryLock: () => true,
      releaseLock() {
        releases += 1;
      },
    };
  };

  const first = clone(backend.repairAdminRuntimeState("secret", "version-runtime"));
  const second = clone(backend.repairAdminRuntimeState("secret", "version-runtime"));

  assert.equal(first.status, "ok");
  assert.equal(first.autoRefresh.value.runtimeVerified, true);
  assert.equal(first.donationRefresh.value.runtimeVerified, true);
  assert.equal(second.status, "ok");
  assert.equal(triggerReads, 2);
  assert.equal(lockReads, 2);
  assert.equal(releases, 2);
  assert.equal(triggers.filter(trigger => trigger.handler === "permanentSchedulerWatchdogTick").length, 1);
  assert.equal(triggers.filter(trigger => trigger.handler === "autoRefreshActiveRosterTick").length, 1);
  assert.equal(triggers.filter(trigger => trigger.handler === "donationRefreshTick").length, 1);

  let busyTriggerReads = 0;
  backend.ScriptApp.getProjectTriggers = () => {
    busyTriggerReads += 1;
    return [];
  };
  backend.LockService.getScriptLock = () => ({
    tryLock: () => false,
    releaseLock() {
      assert.fail("busy runtime lock must not be released");
    },
  });
  const busy = clone(backend.repairAdminRuntimeState("secret", "version-runtime"));
  assert.equal(busy.status, "busy");
  assert.equal(busyTriggerReads, 0);
});

test("Admin publish V2 uses one deterministic version and confirms idempotent retries", () => {
  const backend = loadBackend();
  backend.PropertiesService.getScriptProperties().setProperty("ADMIN_PW", "secret");
  const rosterData = buildValidRosterData();
  const publishAttemptId = "publish-attempt-00000001";
  const targetVersionId = "admin-publish-" + publishAttemptId;
  let activeVersionId = "version-old";
  let inActiveLock = false;
  let writeCalls = 0;
  let markCalls = 0;
  let lockCalls = 0;
  let steps = [];
  backend.withActiveRosterJobLock_ = (owner, wait, callback) => {
    lockCalls += 1;
    assert.match(owner, /^manual-publish-v2-/);
    assert.equal(wait, 0);
    inActiveLock = true;
    try {
      return callback();
    } finally {
      inActiveLock = false;
    }
  };
  backend.checkPublishCooldown_ = () => {
    assert.equal(inActiveLock, true);
    steps.push("cooldown");
  };
  backend.readExactPublishedActiveRosterSnapshot_ = () => {
    assert.equal(inActiveLock, true);
    steps.push("source-guard");
    const err = new Error("source changed");
    err.code = "ADMIN_ACTIVE_VERSION_CONFLICT";
    throw err;
  };
  backend.writePublishedRosterData_ = () => {
    writeCalls += 1;
    return {};
  };
  backend.markPublish_ = () => {
    markCalls += 1;
  };
  backend.readPublishedActiveVersionIdRaw_ = () => activeVersionId;

  const conflict = captureError(() => backend.publishRosterDataV2(
    rosterData,
    "secret",
    "version-old",
    { publishAttemptId },
  ));
  assert.equal(conflict.code, "ADMIN_ACTIVE_VERSION_CONFLICT");
  assert.deepEqual(steps, ["source-guard"]);
  assert.equal(writeCalls, 0);
  assert.equal(markCalls, 0);

  steps = [];
  const sourceSnapshot = { versionId: "version-old", rosterData };
  backend.readExactPublishedActiveRosterSnapshot_ = () => {
    assert.equal(inActiveLock, true);
    steps.push("source-guard");
    return sourceSnapshot;
  };
  backend.readPublishedActiveVersionIdRaw_ = () => {
    steps.push("pointer-recheck");
    return activeVersionId;
  };
  backend.writePublishedRosterData_ = (_payload, options) => {
    writeCalls += 1;
    assert.equal(inActiveLock, true);
    assert.equal(options.sourceSnapshot, sourceSnapshot);
    assert.equal(options.includeRosterDataInResult, false);
    assert.equal(options.activeVersionIdOverride, targetVersionId);
    steps.push("write");
    activeVersionId = targetVersionId;
    return {
      activeVersionId: targetVersionId,
      publishedAt: "2026-07-29T00:00:00.000Z",
      playerCount: 1,
      noteCount: 0,
      metricEntryCount: 1,
    };
  };
  const success = clone(backend.publishRosterDataV2(
    rosterData,
    "secret",
    "version-old",
    { publishAttemptId, includeRosterDataInResult: true },
  ));
  assert.equal(success.status, "committed");
  assert.equal(success.publishAttemptId, publishAttemptId);
  assert.equal(success.sourceVersionId, "version-old");
  assert.equal(success.activeVersionId, targetVersionId);
  assert.equal(Object.prototype.hasOwnProperty.call(success, "rosterData"), false);
  assert.ok(steps.includes("source-guard"));
  assert.ok(steps.includes("cooldown"));
  assert.ok(steps.includes("write"));
  assert.equal(writeCalls, 1);
  assert.equal(markCalls, 1);

  backend.readAdminPublishCurrentManifest_ = () => ({
    versionId: targetVersionId,
    publishedAt: "2026-07-29T00:00:00.000Z",
    rosterPlayerTags: ["#PLAYER"],
    playerMetricEntryCount: 1,
  });
  const replay = clone(backend.publishRosterDataV2(
    rosterData,
    "secret",
    "version-old",
    { publishAttemptId },
  ));
  assert.equal(replay.status, "committed");
  assert.equal(replay.activeVersionId, targetVersionId);
  assert.equal(writeCalls, 1);
  assert.equal(markCalls, 1);
  assert.equal(lockCalls, 2);

  const status = clone(backend.getAdminPublishStatusV2("secret", publishAttemptId, "version-old"));
  assert.equal(status.status, "committed");
  assert.equal(status.activeVersionId, targetVersionId);
  assert.equal(status.canRetry, false);
});

test("Admin publish V2 reports refresh and donation overlap without losing its retry", () => {
  const backend = loadBackend();
  const props = backend.PropertiesService.getScriptProperties();
  props.setProperty("ADMIN_PW", "secret");
  props.setProperty("DONATION_REFRESH_LOCK", JSON.stringify({
    token: "donation-token",
    owner: "donation-refresh-trigger",
    expiresAt: Date.now() + 60_000,
  }));
  const publishAttemptId = "publish-attempt-00000002";
  let activeLock = {
    token: "refresh-token",
    owner: "auto-refresh-worker",
    expiresAt: Date.now() + 60_000,
  };
  let writeCalls = 0;
  backend.readPublishedActiveVersionIdRaw_ = () => "version-old";
  backend.readActiveRosterJobLockState_ = () => activeLock;
  backend.withActiveRosterJobLock_ = () => {
    const err = new Error("Another active roster refresh/publish flow is running.");
    err.code = "activeRosterJobLockBusy";
    throw err;
  };
  backend.writePublishedRosterData_ = () => {
    writeCalls += 1;
    return {};
  };

  const busy = captureError(() => backend.publishRosterDataV2(
    buildValidRosterData(),
    "secret",
    "version-old",
    { publishAttemptId },
  ));
  assert.equal(busy.code, "ADMIN_PUBLISH_BUSY", busy && busy.stack);
  assert.match(busy.message, /scheduled roster refresh/i);
  assert.equal(writeCalls, 0);

  const waiting = clone(backend.runAdminApiMethod_("getAdminPublishStatusV2", [
    "secret",
    publishAttemptId,
    "version-old",
  ]));
  assert.equal(waiting.status, "waiting");
  assert.equal(waiting.activity, "the scheduled roster refresh");
  assert.equal(waiting.donationRefreshActive, true);
  assert.equal(waiting.canRetry, false);

  activeLock = null;
  const retryable = clone(backend.getAdminPublishStatusV2("secret", publishAttemptId, "version-old"));
  assert.equal(retryable.status, "retryable");
  assert.equal(retryable.canRetry, true);
  assert.equal(retryable.donationRefreshActive, true);

  const receiptStore = JSON.parse(props.getProperty("ADMIN_PUBLISH_ATTEMPTS_V2"));
  receiptStore.attempts[0].runningStartedAt = new Date(Date.now() - 8 * 60 * 1000).toISOString();
  const ownOwner = backend.buildAdminPublishLockOwner_(publishAttemptId);
  receiptStore.attempts[0].lockOwner = ownOwner;
  props.setProperty("ADMIN_PUBLISH_ATTEMPTS_V2", JSON.stringify(receiptStore));
  activeLock = { token: "stale-publish", owner: ownOwner, expiresAt: Date.now() + 60_000 };
  backend.clearActiveRosterJobLockForOwners_ = (ownerMap, label) => {
    assert.equal(ownerMap[ownOwner], true);
    assert.equal(label, "stale admin publish recovery");
    activeLock = null;
    return { cleared: true, owner: ownOwner };
  };
  const recovered = clone(backend.getAdminPublishStatusV2("secret", publishAttemptId, "version-old"));
  assert.equal(recovered.status, "retryable");
  assert.equal(recovered.canRetry, true);
  assert.match(recovered.message, /can now be retried safely/i);
});

test("Admin publish V2 recovers a committed pointer even when post-write work throws", () => {
  const backend = loadBackend();
  backend.PropertiesService.getScriptProperties().setProperty("ADMIN_PW", "secret");
  const publishAttemptId = "publish-attempt-00000003";
  const targetVersionId = "admin-publish-" + publishAttemptId;
  let activeVersionId = "version-old";
  let writeCalls = 0;
  backend.withActiveRosterJobLock_ = (_owner, wait, callback) => {
    assert.equal(wait, 0);
    return callback();
  };
  backend.readPublishedActiveVersionIdRaw_ = () => activeVersionId;
  backend.readExactPublishedActiveRosterSnapshot_ = () => ({
    versionId: "version-old",
    rosterData: buildValidRosterData(),
  });
  backend.checkPublishCooldown_ = () => {};
  backend.writePublishedRosterData_ = (_payload, options) => {
    writeCalls += 1;
    assert.equal(options.activeVersionIdOverride, targetVersionId);
    activeVersionId = targetVersionId;
    throw new Error("simulated response-finalization failure after pointer commit");
  };
  backend.readAdminPublishCurrentManifest_ = () => ({
    versionId: targetVersionId,
    publishedAt: "2026-08-01T00:00:00.000Z",
    rosterPlayerTags: ["#PLAYER"],
    playerMetricEntryCount: 1,
  });

  const recovered = clone(backend.publishRosterDataV2(
    buildValidRosterData(),
    "secret",
    "version-old",
    { publishAttemptId },
  ));
  assert.equal(recovered.status, "committed");
  assert.equal(recovered.activeVersionId, targetVersionId);
  assert.equal(recovered.playerCount, 1);
  assert.equal(writeCalls, 1);

  let queuedVersionId = "";
  backend.enqueueCloudflareActiveTarget_ = (versionId, reason) => {
    queuedVersionId = versionId;
    assert.equal(reason, "admin-publish-delivery-retry");
    return { ok: true, queued: true, scheduled: true, nextAttemptAt: "" };
  };
  const delivery = clone(backend.runAdminApiMethod_("retryAdminPublishDeliveryV2", [
    "secret",
    publishAttemptId,
  ]));
  assert.equal(delivery.status, "queued");
  assert.equal(delivery.activeVersionId, targetVersionId);
  assert.equal(delivery.queued, true);
  assert.equal(queuedVersionId, targetVersionId);
});

test("Admin publish V2 keeps the canonical-roster response for cached legacy clients", () => {
  const backend = loadBackend();
  backend.PropertiesService.getScriptProperties().setProperty("ADMIN_PW", "secret");
  const rosterData = buildValidRosterData();
  backend.withActiveRosterJobLock_ = (owner, wait, callback) => {
    assert.equal(owner, "manual-publish-v2-legacy-client");
    assert.equal(wait, 30_000);
    return callback();
  };
  backend.readExactPublishedActiveRosterSnapshot_ = () => ({ versionId: "version-old", rosterData });
  backend.readPublishedActiveVersionIdRaw_ = () => "version-old";
  backend.checkPublishCooldown_ = () => {};
  backend.markPublish_ = () => {};
  backend.writePublishedRosterData_ = (_payload, options) => {
    assert.equal(options.includeRosterDataInResult, true);
    return {
      activeVersionId: "version-new",
      publishedAt: "2026-08-01T00:00:00.000Z",
      playerCount: 1,
      noteCount: 0,
      metricEntryCount: 1,
      rosterData,
    };
  };

  const legacy = clone(backend.publishRosterDataV2(
    rosterData,
    "secret",
    "version-old",
    { includeRosterDataInResult: true },
  ));
  assert.equal(legacy.activeVersionId, "version-new");
  assert.deepEqual(legacy.rosterData, clone(rosterData));
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

test("season event atomic updates preserve tag indexes owned by another participant", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.reconcileCurrentSeasonEvents({ manualSeason: seasonFixture }, "secret");
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildSeasonEventRosterData(), text: "" });
  backend.registerSeasonEventSignup({
    eventId: "donation-2026-05",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
    playerTags: ["#9PYLQG", "#8CCVV"],
  }, "secret");

  const removedPath = backend.buildSeasonEventParticipantTagIndexPath_("donation-2026-05", "#9PYLQG");
  const retainedPath = backend.buildSeasonEventParticipantTagIndexPath_("donation-2026-05", "#8CCVV");
  backend.writeSeasonEventFirebasePayload_(removedPath, "PUT", { discordId: "foreign-user", tag: "#9PYLQG" });
  const originalBatchPut = backend.firebaseBatchPutJson_;
  const batches = [];
  backend.firebaseBatchPutJson_ = (entries, options) => {
    batches.push(clone(entries));
    return originalBatchPut(entries, options);
  };

  const updated = backend.updateSeasonEventParticipantAccounts({
    eventId: "donation-2026-05",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
    playerTags: ["#8CCVV"],
  }, "secret");

  assert.equal(updated.status, "updated");
  assert.equal(backend.decodeSeasonEventFirebasePayload_(backend.firebaseRequestJson_(removedPath, "GET")).discordId, "foreign-user");
  assert.equal(batches[0].some(entry => entry.path === removedPath && entry.payload === null), false);
  assert.equal(batches[0].some(entry => entry.path === retainedPath && entry.payload === null), true);
  assert.equal(batches[0].some(entry => entry.path === retainedPath && entry.payload && entry.payload.discordId === "222"), true);
  assert.equal(backend.decodeSeasonEventFirebasePayload_(backend.firebaseRequestJson_(retainedPath, "GET")).discordId, "222");

  backend.writeSeasonEventFirebasePayload_(retainedPath, "PUT", { discordId: "foreign-user", tag: "#8CCVV" });
  const cancelled = backend.cancelSeasonEventSignup({
    eventId: "donation-2026-05",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
  }, "secret");

  assert.equal(cancelled.status, "cancelled");
  assert.equal(batches[1].some(entry => entry.path === retainedPath && entry.payload === null), false);
  assert.equal(backend.decodeSeasonEventFirebasePayload_(backend.firebaseRequestJson_(retainedPath, "GET")).discordId, "foreign-user");
});

test("OAuth, Firebase single, Firebase fetchAll, and ETag CAS requests have explicit timeouts", () => {
  const backend = loadBackend();
  const requests = [];
  backend.getFirebaseConfig_ = () => ({
    dbUrl: "https://firebase.test/db",
    clientEmail: "client@example.test",
    privateKey: "key",
    tokenUri: "https://oauth.test/token",
  });
  backend.getFirebaseAccessToken_ = () => "token";
  backend.Utilities.computeRsaSha256Signature = () => [1, 2, 3];
  backend.UrlFetchApp = {
    fetch(url, options) {
      requests.push({ kind: "fetch", url, options });
      if (url.includes("oauth")) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ access_token: "fresh", expires_in: 3600 }) };
      return { getResponseCode: () => 200, getContentText: () => "{}", getAllHeaders: () => ({ ETag: '"etag-1"' }) };
    },
    fetchAll(descriptors) {
      requests.push({ kind: "fetchAll", descriptors });
      return descriptors.map(() => ({ getResponseCode: () => 200, getContentText: () => "{}" }));
    },
  };

  backend.requestFirebaseAccessToken_();
  backend.firebaseRequestJson_("active", "GET");
  backend.firebaseBatchGetJson_(["active", "activePublished"]);
  const etagRead = backend.firebaseRequestJsonWithEtag_("queue", "GET");
  backend.firebaseRequestJsonWithEtag_("queue", "PUT", { ok: true }, { ifMatch: etagRead.etag });

  const oauth = requests.find((request) => request.url.includes("oauth"));
  const single = requests.find((request) => request.kind === "fetch" && request.url.includes("/active.json"));
  const batch = requests.find((request) => request.kind === "fetchAll");
  const etagGet = requests.find((request) => request.kind === "fetch" && request.url.includes("/queue.json") && request.options.method === "GET");
  const etagPut = requests.find((request) => request.kind === "fetch" && request.url.includes("/queue.json") && request.options.method === "PUT");
  assert.equal(oauth.options.timeoutSeconds, 15);
  assert.equal(single.options.timeoutSeconds, 15);
  assert.ok(batch.descriptors.every((descriptor) => descriptor.timeoutSeconds === 15));
  assert.equal(etagGet.options.headers["X-Firebase-ETag"], "true");
  assert.equal(etagPut.options.headers["If-Match"], '"etag-1"');
  assert.equal(etagPut.options.timeoutSeconds, 15);
  assert.equal(etagPut.url.includes("print=silent"), false);
});

test("CoC single and fetchAll descriptors use the bounded transport policy", () => {
  const backend = loadBackend();
  backend.PropertiesService.getScriptProperties().setProperty("COC_API_TOKEN", "token");
  const requestLog = [];
  backend.UrlFetchApp = {
    fetch(url, options) { requestLog.push({ url, options }); return { getResponseCode: () => 200, getContentText: () => "{}" }; },
    fetchAll(descriptors) { requestLog.push({ descriptors }); return descriptors.map(() => ({ getResponseCode: () => 200, getContentText: () => "{}" })); },
  };
  backend.cocFetch_("/clans/%23CLAN");
  backend.cocFetchAllByPathEntries_([{ key: "one", path: "/clans/%23CLAN" }]);
  const single = requestLog.find((entry) => entry.url);
  const batch = requestLog.find((entry) => entry.descriptors);
  assert.equal(single.options.timeoutSeconds, 15);
  assert.equal(batch.descriptors[0].timeoutSeconds, 15);
});

test("season-event publication enqueueing happens only after the participant lock is released", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.reconcileCurrentSeasonEvents({ manualSeason: seasonFixture }, "secret");
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildSeasonEventRosterData(), text: "" });
  const originalLock = backend.withSeasonEventParticipantWriteLock_;
  let lockHeld = false;
  const enqueueCalls = [];
  backend.withSeasonEventParticipantWriteLock_ = callback => {
    lockHeld = true;
    try {
      return callback();
    } finally {
      lockHeld = false;
    }
  };
  backend.enqueueCloudflareSeasonEventPublication_ = (eventId, reason, options) => {
    assert.equal(lockHeld, false);
    enqueueCalls.push({ eventId, reason, options });
    return { ok: true, queued: true };
  };

  const signup = backend.registerSeasonEventSignup({
    eventId: "donation-2026-05",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
    playerTags: ["#9PYLQG"],
  }, "secret");
  assert.equal(signup.status, "signed-up");
  const update = backend.updateSeasonEventParticipantAccounts({
    eventId: "donation-2026-05",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
    playerTags: ["#8CCVV"],
  }, "secret");
  assert.equal(update.status, "updated");
  const cancel = backend.cancelSeasonEventSignup({
    eventId: "donation-2026-05",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
  }, "secret");

  backend.withSeasonEventParticipantWriteLock_ = originalLock;
  assert.deepEqual(enqueueCalls.map(call => call.reason), [
    "discord-season-event-signup",
    "discord-season-event-account-update",
    "discord-season-event-cancel",
  ]);
});

test("CWL participant mutations enqueue the participant-projected aggregate immediately", () => {
  const backend = installMemoryFirebase(loadBackend());
  const rosterData = buildSeasonEventRosterData();
  backend.readActiveRosterSnapshot_ = () => ({ rosterData, text: "" });
  backend.writeSeasonEventFirebasePayload_(backend.buildSeasonEventByIdPath_("cwl-live"), "PUT", {
    eventId: "cwl-live",
    type: "cwl",
    seasonId: "2026-05",
    status: "open",
    visibility: "public",
    signupsOpen: true,
    maxAccounts: 1,
    startsAt: "2020-01-01T00:00:00.000Z",
    endsAt: "2100-01-01T00:00:00.000Z",
    cwlTrackingState: "active",
    cwl: {
      target: {
        resolved: true,
        status: "resolved",
        rosterId: "main",
        clanTag: "#CLAN",
        leagueName: "Champion I",
        eligibleAccountTags: ["#2LUCULP"],
      },
    },
    participantsByDiscordId: {},
  });
  const calls = [];
  backend.enqueueCloudflareSeasonEventPublication_ = (eventId, reason, options) => {
    calls.push({ eventId, reason, options });
    return { ok: true, queued: true };
  };

  const signup = backend.registerSeasonEventSignup({
    eventId: "cwl-live",
    discordUser: { id: "111", username: "alpha", globalName: "Alpha", displayName: "Alpha" },
    playerTags: ["#2LUCULP"],
  }, "secret");
  assert.equal(signup.status, "signed-up");
  const update = backend.updateSeasonEventParticipantAccounts({
    eventId: "cwl-live",
    discordUser: { id: "111", username: "alpha", globalName: "Alpha", displayName: "Alpha" },
    playerTags: ["#2LUCULP"],
  }, "secret");
  assert.equal(update.status, "updated");
  const cancel = backend.cancelSeasonEventSignup({
    eventId: "cwl-live",
    discordUser: { id: "111", username: "alpha", globalName: "Alpha", displayName: "Alpha" },
  }, "secret");

  assert.equal(cancel.status, "cancelled");
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => call.options.cwlLifecycle.liveAggregateAction), ["put", "put", "put"]);
  assert.deepEqual(calls.map(call => call.options.cwlLifecycle.finalAggregateAction), ["none", "none", "none"]);
  assert.deepEqual(calls.map(call => call.options.cwlLifecycle.pointerAction), ["none", "none", "none"]);
});

test("Cloudflare enqueue failure cannot block a canonical Discord mutation", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.reconcileCurrentSeasonEvents({ manualSeason: seasonFixture }, "secret");
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildSeasonEventRosterData(), text: "" });
  backend.enqueueCloudflareSeasonEventPublication_ = () => {
    throw new Error("Cloudflare queue unavailable");
  };

  const result = backend.registerSeasonEventSignup({
    eventId: "donation-2026-05",
    discordUser: { id: "222", username: "bravo", globalName: "Bravo", displayName: "Bravo" },
    playerTags: ["#9PYLQG"],
  }, "secret");

  assert.equal(result.status, "signed-up");
  assert.equal(backend.readSeasonEventById_("donation-2026-05").participantsByDiscordId["222"].status, "signed_up");
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

test("current season event leaderboards ensure local push and donation metadata without CWL discovery", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.reconcileCurrentSeasonEvents_({ now: "2026-05-20T15:00:00.000Z" });
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildSeasonEventLeaderboardRosterData(), text: "" });
  let discoveryCalls = 0;
  let broadRepairCalls = 0;
  backend.collectFreshCwlTargetEvidence_ = () => { discoveryCalls++; throw new Error("leaderboard must not discover CWL"); };
  backend.enqueueCloudflareRelevantSeasonPublication_ = () => { broadRepairCalls++; return { ok: true }; };

  const result = backend.getCurrentSeasonEventLeaderboards({
    now: "2026-06-15T05:00:00.000Z",
  }, "secret");

  assert.equal(result.season.seasonId, "ranked-legend-i-2026-06-15");
  assert.equal(result.leaderboards.push.event.eventId, "push-ranked-legend-i-2026-06-15");
  assert.equal(result.leaderboards.donation.event.eventId, "donation-ranked-legend-i-2026-06-15");
  assert.equal(backend.readSeasonEventPointer_("events/seasonEvents/current/push").eventId, "push-ranked-legend-i-2026-06-15");
  assert.equal(discoveryCalls, 0);
  assert.equal(broadRepairCalls, 0);
  assert.equal(backend.readSeasonEventPointer_("events/seasonEvents/currentCwl"), null);
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

test("CWL signup context reuses stored options and compact linked-account lookup", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildCwlLeagueSignupRosterData(), text: "" });
  const signup = backend.getCwlLeagueSignupOptions({ fetchMissing: false }, "secret");
  backend.readActiveRosterLayoutSnapshot_ = () => {
    throw new Error("stored signup options must not rebuild roster layout");
  };
  backend.readActiveRosterSnapshot_ = () => {
    throw new Error("signup context must not reconstruct the complete active roster");
  };
  backend.readSeasonEventLinkedAccountsForDiscordUser_ = () => [{
    tag: "#2LUCULP",
    name: "Alpha",
    discordId: "111",
    matchType: "discordId",
  }];

  const result = backend.getCwlLeagueSignupContextForDiscordUser({
    signupId: signup.signupId,
    discordId: "111",
    discordUsername: "alpha",
  }, "secret");

  assert.equal(result.ok, true);
  assert.equal(result.options.length, 2);
  assert.deepEqual(Array.from(result.linkedAccounts, account => account.tag), ["#2LUCULP"]);
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

test("CWL league preference saves from the message snapshot while revalidating the canonical link", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildCwlLeagueSignupRosterData(), text: "" });
  const signup = backend.getCwlLeagueSignupOptions({ fetchMissing: false }, "secret");
  backend.readActiveRosterSnapshot_ = () => {
	throw new Error("snapshotted preference save must not reconstruct the complete active roster");
  };
	backend.readActiveRosterLayoutSnapshot_ = () => {
		throw new Error("snapshotted preference save must not rebuild roster layout");
	};
	backend.readSeasonEventLinkedAccountsForDiscordUser_ = () => [{
		tag: "#2LUCULP",
		name: "Alpha",
		discordId: "111",
		matchType: "discordId",
	}];
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
  }, "secret"), /not linked to the requesting Discord user/i);

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
  assert.equal(stats["#A"].defenseStarsConceded, 3);
  assert.equal(stats["#A"].bestStarsConceded, 3);
  assert.equal(stats["#A"].bestDestructionConceded, 90);

  assert.equal(stats["#B"].missedAttacks, 1);
  assert.equal(stats["#B"].unattackedDefenseDays, 1);
  assert.equal(stats["#B"].defenseHolds, 0);
  assert.equal(stats["#B"].defenseStarsConceded, 0);

  assert.equal(stats["#C"].attacksMade, 0);
  assert.equal(stats["#C"].missedAttacks, 1);
  assert.equal(stats["#C"].defenseAttacksReceived, 1);
  assert.equal(stats["#C"].successfulDefensiveAttacks, 1);
  assert.equal(stats["#C"].defenseHolds, 1);
  assert.equal(stats["#C"].defenseStarsConceded, 2);
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
  assert.equal(stats["#B"].defenseStarsConceded, 2);
});

test("CWL ranking uses offensive stars then defensive stars conceded", () => {
  const backend = loadBackend();
  const rows = [
    {
      tag: "#MORESTARS",
      _sortName: "MoreStars",
      cwlStats: {
        starsTotal: 7,
        attacksMade: 3,
        defenseStarsConceded: 21,
        bestStarsConceded: 21,
      },
    },
    {
      tag: "#BETTERDEF",
      _sortName: "BetterDef",
      cwlStats: {
        starsTotal: 6,
        attacksMade: 3,
        attackedDefenseDays: 1,
        defenseStarsConceded: 1,
        bestStarsConceded: 1,
        bestDestructionConceded: 100,
      },
    },
    {
      tag: "#WORSEDEF",
      _sortName: "WorseDef",
      cwlStats: {
        starsTotal: 6,
        attacksMade: 3,
        attackedDefenseDays: 1,
        defenseStarsConceded: 3,
        bestStarsConceded: 3,
        bestDestructionConceded: 100,
      },
    },
  ];

  rows.sort(backend.compareCwlSeasonEventLeaderboardRows_);

  assert.deepEqual(rows.map((row) => row.tag), ["#MORESTARS", "#BETTERDEF", "#WORSEDEF"]);
});

test("CWL ranking ignores defensive destruction after defensive stars tie", () => {
  const backend = loadBackend();
  const rows = [
    {
      tag: "#ALPHA",
      _sortName: "Alpha",
      cwlStats: {
        starsTotal: 9,
        attacksMade: 3,
        attackedDefenseDays: 2,
        defenseStarsConceded: 4,
        bestStarsConceded: 4,
        bestDestructionConceded: 300,
      },
    },
    {
      tag: "#BRAVO",
      _sortName: "Bravo",
      cwlStats: {
        starsTotal: 9,
        attacksMade: 3,
        attackedDefenseDays: 2,
        defenseStarsConceded: 4,
        bestStarsConceded: 4,
        bestDestructionConceded: 100,
      },
    },
  ];

  rows.sort(backend.compareCwlSeasonEventLeaderboardRows_);

  assert.deepEqual(rows.map((row) => row.tag), ["#ALPHA", "#BRAVO"]);
});

test("CWL participant-filtered aggregate ranked tags use backend display-name tie-break", () => {
  const backend = loadBackend();
  const finalAggregate = backend.filterCwlAggregateToRegisteredParticipants_(
    {
      eventId: "cwl-test",
      type: "cwl",
      cwlTrackingState: "active",
      cwl: {
        target: {
          resolved: true,
          status: "resolved",
          rosterId: "main",
          clanTag: "#CLAN",
          leagueName: "Champion I",
          leagueRank: 0,
          eligibleAccountTags: ["#2LUCULP", "#9PYLQG"],
        },
      },
      participantsByDiscordId: {
        "200": {
          discordId: "200",
          discordDisplayName: "Zulu",
          status: "signed_up",
          accounts: [{ tag: "#9PYLQG", name: "Zulu" }],
        },
        "100": {
          discordId: "100",
          discordDisplayName: "Alpha",
          status: "signed_up",
          accounts: [{ tag: "#2LUCULP", name: "Alpha" }],
        },
      },
    },
    {
      eventId: "cwl-test",
      kind: "live",
      warTags: ["#WAR1"],
      byTag: {
        "#2LUCULP": { starsTotal: 3, attacksMade: 1, totalDestruction: 100 },
        "#9PYLQG": { starsTotal: 3, attacksMade: 1, totalDestruction: 100 },
      },
    },
  );

  assert.equal(JSON.stringify(finalAggregate.rankedTags), JSON.stringify(["#2LUCULP", "#9PYLQG"]));
});

test("CWL event target leaves fresh tied league evidence unresolved unless explicit priority resolves it", () => {
  const backend = loadBackend();
  const rosterData = {
    schemaVersion: 1,
    pageTitle: "Roster",
    rosterOrder: ["second", "main", "third"],
    rosters: [
      {
        id: "main",
        title: "Main",
        connectedClanTag: "#2LUCULP",
        trackingMode: "cwl",
        cwlLeagueName: "Champion I",
        main: [{ tag: "#2LUCULP", name: "Alpha", th: 16 }],
        subs: [],
        missing: [],
      },
      {
        id: "third",
        title: "Third",
        connectedClanTag: "#PYYQQ",
        trackingMode: "cwl",
        cwlLeagueName: "Champion II",
        main: [{ tag: "#PYYQQ", name: "Charlie", th: 16 }],
        subs: [],
        missing: [],
      },
      {
        id: "second",
        title: "Second",
        connectedClanTag: "#9PYLQG",
        trackingMode: "cwl",
        cwlLeagueName: "Champion I",
        main: [{ tag: "#9PYLQG", name: "Bravo", th: 16 }],
        subs: [{ tag: "#8CCVV", name: "Bravo Sub", th: 15 }],
        missing: [{ tag: "#2LUCULP", name: "Missing", th: 16 }],
      },
    ],
  };

  const freshEvidence = {
    capturedAt: "2026-07-01T00:00:00.000Z",
    observationId: "observation-tie-1",
    leaguegroupRawByClanTag: {
      "#2LUCULP": { state: "inWar", season: "2026-07", clans: [{ tag: "#2LUCULP" }], rounds: [{ warTags: ["#WAR1"] }] },
      "#9PYLQG": { state: "inWar", season: "2026-07", clans: [{ tag: "#9PYLQG" }], rounds: [{ warTags: ["#WAR2"] }] },
      "#PYYQQ": { state: "inWar", season: "2026-07", clans: [{ tag: "#PYYQQ" }], rounds: [{ warTags: ["#WAR3"] }] },
    },
    clanDetailsRawByClanTag: {
      "#2LUCULP": { warLeague: { name: "Champion I" } },
      "#9PYLQG": { warLeague: { name: "Champion I" } },
      "#PYYQQ": { warLeague: { name: "Champion II" } },
    },
  };
  const result = backend.resolveCwlSeasonEventTargetFromRosterData_(rosterData, {
    nowIso: "2026-07-01T00:00:00.000Z",
    freshEvidence,
  });

  assert.equal(result.ok, false);
  assert.equal(result.target.reason, "tied-cwl-target-evidence");

  rosterData.cwlEventTargetPriorityByRosterId = { second: 0 };
  const prioritized = backend.resolveCwlSeasonEventTargetFromRosterData_(rosterData, {
    nowIso: "2026-07-01T00:00:00.000Z",
    freshEvidence,
  });
  assert.equal(prioritized.ok, true);
  assert.equal(prioritized.target.rosterId, "second");
  assert.equal(JSON.stringify(prioritized.target.eligibleAccountTags), JSON.stringify(["#9PYLQG", "#8CCVV"]));
});

test("two roster-selected CWL events keep pointers, signups, aggregates, and runtimes isolated", () => {
  const backend = installMemoryFirebase(loadBackend());
  const rosterData = buildSameLeagueCwlSignupRosterData();
  rosterData.rosters[1].cwlLeagueName = "";
  rosterData.rosters[1].main = [{ slot: 1, name: "Bravo", discord: "alpha", th: 16, tag: "#9PYLQG", notes: [] }];
  rosterData.playerMetrics.byTag["#9PYLQG"].identity.discordId = "111";
  rosterData.playerMetrics.byTag["#9PYLQG"].identity.discordUsername = "alpha";
  backend.readActiveRosterSnapshot_ = () => ({ rosterData, text: JSON.stringify(rosterData) });
  backend.enqueueCloudflareSeasonEventPublication_ = () => ({ ok: true, queued: true });

  const mainResult = backend.ensureCurrentCwlSeasonEvent_({ type: "test-dual-cwl" }, { rosterId: "main" });
  const secondResult = backend.ensureCurrentCwlSeasonEvent_({ type: "test-dual-cwl" }, { rosterId: "second" });
  const mainEventId = mainResult.event.eventId;
  const secondEventId = secondResult.event.eventId;

  assert.equal(mainResult.created, true);
  assert.equal(secondResult.created, true);
  assert.notEqual(mainEventId, secondEventId);
  assert.equal(mainResult.event.cwl.target.selectionMode, "explicit");
  assert.equal(mainResult.event.cwl.target.rosterId, "main");
  assert.equal(secondResult.event.cwl.target.selectionMode, "explicit");
  assert.equal(secondResult.event.cwl.target.rosterId, "second");
  assert.equal(secondResult.event.cwl.target.resolved, true);
  assert.equal(secondResult.event.cwl.target.leagueRank, null);
  assert.deepEqual(Array.from(mainResult.event.cwl.target.eligibleAccountTags), ["#2LUCULP"]);
  assert.deepEqual(Array.from(secondResult.event.cwl.target.eligibleAccountTags), ["#9PYLQG"]);
  assert.equal(backend.readSeasonEventPointer_(backend.buildCurrentCwlSeasonEventRosterPointerPath_("main")).eventId, mainEventId);
  assert.equal(backend.readSeasonEventPointer_(backend.buildCurrentCwlSeasonEventRosterPointerPath_("second")).eventId, secondEventId);
  assert.equal(backend.readSeasonEventPointer_("events/seasonEvents/currentCwl").eventId, mainEventId);
  assert.equal(backend.getCurrentCwlSeasonEvent({ rosterId: "second" }, "secret").event.eventId, secondEventId);
  const currentEvents = backend.getCurrentSeasonEvents({}, "secret");
  assert.equal(currentEvents.events.cwl.eventId, mainEventId);
  assert.equal(currentEvents.events.cwlByRoster.main.eventId, mainEventId);
  assert.equal(currentEvents.events.cwlByRoster.second.eventId, secondEventId);
  assert.equal(currentEvents.cwl.currentByRoster.main.eventId, mainEventId);
  assert.equal(currentEvents.cwl.currentByRoster.second.eventId, secondEventId);

  const discordUser = { id: "111", username: "alpha", globalName: "Alpha", displayName: "Alpha" };
  const wrongRoster = backend.registerSeasonEventSignup({ eventId: secondEventId, discordUser, playerTags: ["#2LUCULP"] }, "secret");
  const mainSignup = backend.registerSeasonEventSignup({ eventId: mainEventId, discordUser, playerTags: ["#2LUCULP"] }, "secret");
  const secondSignup = backend.registerSeasonEventSignup({ eventId: secondEventId, discordUser, playerTags: ["#9PYLQG"] }, "secret");
  assert.equal(wrongRoster.status, "player-tag-outside-event-roster");
  assert.equal(mainSignup.status, "signed-up");
  assert.equal(secondSignup.status, "signed-up");
  assert.equal(backend.getSeasonEventMutationContext({ eventType: "cwl", eventId: secondEventId, discordUser }, "secret").event.eventId, secondEventId);

  const mixedAggregate = {
    kind: "live",
    warTags: ["#WAR1", "#WAR2"],
    byTag: {
      "#2LUCULP": { starsTotal: 3, attacksMade: 1 },
      "#9PYLQG": { starsTotal: 9, attacksMade: 3 },
    },
  };
  const mainFiltered = backend.filterCwlAggregateToRegisteredParticipants_(backend.readSeasonEventById_(mainEventId), { ...mixedAggregate, eventId: mainEventId });
  const secondFiltered = backend.filterCwlAggregateToRegisteredParticipants_(backend.readSeasonEventById_(secondEventId), { ...mixedAggregate, eventId: secondEventId });
  assert.deepEqual(Object.keys(mainFiltered.byTag), ["#2LUCULP"]);
  assert.deepEqual(Object.keys(secondFiltered.byTag), ["#9PYLQG"]);

  const mainRuntime = backend.createEmptyCwlRuntime_(mainEventId, "2026-07-11T12:00:00.000Z");
  const secondRuntime = backend.createEmptyCwlRuntime_(secondEventId, "2026-07-11T12:00:00.000Z");
  mainRuntime.counts = { marker: 1 };
  secondRuntime.counts = { marker: 2 };
  backend.writeCwlRuntime_(mainRuntime);
  backend.writeCwlRuntime_(secondRuntime);
  assert.equal(backend.readCwlRuntime_(mainEventId).counts.marker, 1);
  assert.equal(backend.readCwlRuntime_(secondEventId).counts.marker, 2);
  assert.notEqual(backend.buildCwlRuntimePath_(mainEventId), backend.buildCwlRuntimePath_(secondEventId));

  const refreshCalls = [];
  backend.tryRefreshCurrentCwlSeasonEventFromSnapshot_ = (_data, _snapshot, options) => {
    refreshCalls.push({ eventId: options.eventId, rosterId: options.rosterId });
    return { ok: true, status: "active", eventId: options.eventId, cloudflarePublish: { ok: true } };
  };
  const refreshed = backend.tryRefreshAllCurrentCwlSeasonEventsFromSnapshot_(rosterData, {}, { source: "test-dual-cwl" });
  assert.equal(refreshed.ok, true);
  assert.deepEqual(refreshCalls.map(call => call.eventId).sort(), [mainEventId, secondEventId].sort());
  assert.deepEqual(refreshCalls.map(call => call.rosterId).sort(), ["main", "second"]);

  backend.reconcileCurrentSeasonEvents_ = () => ({
    ok: true,
    season: { seasonId: "season-test" },
    events: { push: null, donation: null },
    publicationMutations: { eventIds: [], pointerPaths: [] },
  });
  backend.readActivePlayerMetricsSubsetSnapshot_ = () => ({ playerMetrics: backend.createEmptyPlayerMetricsStore_() });
  backend.buildSeasonEventLeaderboard_ = (event) => ({ ok: true, event: { eventId: event && event.eventId }, leaderboard: [] });
  const leaderboards = backend.getCurrentSeasonEventLeaderboards({}, "secret").leaderboards;
  assert.equal(leaderboards.cwl.event.eventId, mainEventId);
  assert.equal(leaderboards.cwlByRoster.main.event.eventId, mainEventId);
  assert.equal(leaderboards.cwlByRoster.second.event.eventId, secondEventId);
});

test("ensure-current CWL automatically rolls a previous cycle without carrying signups forward", () => {
  const backend = installMemoryFirebase(loadBackend());
  const rosterData = buildValidRosterData();
  backend.readActiveRosterSnapshot_ = () => ({ rosterData });

  const july = backend.ensureCurrentCwlSeasonEvent_(
    { type: "discord-admin", interactionId: "july-panel" },
    { rosterId: "main", nowIso: "2026-07-04T12:00:00.000Z" },
  );
  const julyEvent = backend.readSeasonEventById_(july.event.eventId);
  julyEvent.status = "closed";
  julyEvent.signupsOpen = false;
  julyEvent.cwlTrackingState = "active";
  julyEvent.startsAt = "2026-07-04T03:20:17.000Z";
  julyEvent.endsAt = "2026-07-11T08:12:16.000Z";
  julyEvent.cwl.target = {
    ...julyEvent.cwl.target,
    groupId: "july-group",
    season: "2026-07-03",
    groupState: "ended",
    observedAt: "2026-07-11T20:48:57.627Z",
  };
  julyEvent.participantsByDiscordId = {
    "111": {
      discordId: "111",
      discordUsername: "alpha",
      status: "signed_up",
      accounts: [{ tag: "#PLAYER", name: "Player" }],
    },
  };
  julyEvent.participantsByTag = { "#PLAYER": "111" };
  backend.writeSeasonEventFirebasePayload_(backend.buildSeasonEventByIdPath_(julyEvent.eventId), "PUT", julyEvent);

  const august = backend.ensureCurrentCwlSeasonEvent_(
    { type: "discord-admin", interactionId: "august-panel" },
    { rosterId: "main", nowIso: "2026-08-05T20:10:00.000Z" },
  );
  const archivedJuly = backend.readSeasonEventById_(julyEvent.eventId);
  const freshAugust = backend.readSeasonEventById_(august.event.eventId);

  assert.equal(august.created, true);
  assert.equal(august.status, "current-cwl-event-rolled-over");
  assert.equal(august.rolloverReason, "previous-cwl-season");
  assert.equal(august.rolloverForced, false);
  assert.equal(august.supersededEventId, julyEvent.eventId);
  assert.notEqual(august.event.eventId, julyEvent.eventId);
  assert.equal(archivedJuly.status, "archived");
  assert.equal(archivedJuly.signupsOpen, false);
  assert.equal(archivedJuly.cwlTrackingState, "active");
  assert.equal(archivedJuly.supersededByEventId, august.event.eventId);
  assert.equal(archivedJuly.participantsByDiscordId["111"].accounts[0].tag, "#PLAYER");
  assert.equal(freshAugust.status, "open");
  assert.equal(freshAugust.signupsOpen, true);
  assert.deepEqual(Object.keys(freshAugust.participantsByDiscordId), []);
  assert.equal(backend.readSeasonEventPointer_(backend.buildCurrentCwlSeasonEventRosterPointerPath_("main")).eventId, august.event.eventId);
  assert.equal(backend.readSeasonEventPointer_("events/seasonEvents/currentCwl").eventId, august.event.eventId);
  assert.equal(backend.readSeasonEventPointer_("events/seasonEvents/current/cwl").eventId, august.event.eventId);

  const repeated = backend.ensureCurrentCwlSeasonEvent_(
    { type: "discord-admin", interactionId: "august-panel-retry" },
    { rosterId: "main", nowIso: "2026-08-05T20:11:00.000Z" },
  );
  assert.equal(repeated.created, false);
  assert.equal(repeated.event.eventId, august.event.eventId);
});

test("closed same-cycle CWL events remain reusable", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildValidRosterData() });
  const created = backend.ensureCurrentCwlSeasonEvent_(
    { type: "discord-admin", interactionId: "same-cycle-create" },
    { rosterId: "main", nowIso: "2026-08-04T12:00:00.000Z" },
  );
  const event = backend.readSeasonEventById_(created.event.eventId);
  event.status = "closed";
  event.signupsOpen = false;
  event.cwlTrackingState = "active";
  event.endsAt = "2026-08-11T08:00:00.000Z";
  event.cwl.target = { ...event.cwl.target, groupId: "august-group", season: "2026-08", groupState: "inwar" };
  backend.writeSeasonEventFirebasePayload_(backend.buildSeasonEventByIdPath_(event.eventId), "PUT", event);

  const reused = backend.ensureCurrentCwlSeasonEvent_(
    { type: "discord-admin", interactionId: "same-cycle-repost" },
    { rosterId: "main", nowIso: "2026-08-06T12:00:00.000Z" },
  );
  assert.equal(reused.created, false);
  assert.equal(reused.status, "current-cwl-event-reused");
  assert.equal(reused.event.eventId, event.eventId);
  assert.equal(backend.readSeasonEventById_(event.eventId).status, "closed");
});

test("administrator CWL rollover is roster-scoped, publishes both records, and is retry-safe", () => {
  const backend = installMemoryFirebase(loadBackend());
  const rosterData = buildSameLeagueCwlSignupRosterData();
  rosterData.rosters[1].main = [{ slot: 1, name: "Bravo", discord: "bravo", th: 16, tag: "#9PYLQG", notes: [] }];
  backend.readActiveRosterSnapshot_ = () => ({ rosterData, text: JSON.stringify(rosterData) });
  const main = backend.ensureCurrentCwlSeasonEvent_({ type: "test-main" }, { rosterId: "main", nowIso: "2026-08-05T18:00:00.000Z" });
  const second = backend.ensureCurrentCwlSeasonEvent_({ type: "test-second" }, { rosterId: "second", nowIso: "2026-08-05T18:01:00.000Z" });
  const descriptors = [];
  backend.publishCwlLifecycleDescriptor_ = (descriptor) => {
    descriptors.push(clone(descriptor));
    return { ok: true, queued: true };
  };

  const source = { type: "discord-admin", interactionId: "force-second-once" };
  const forced = backend.ensureCurrentCwlSeasonEvent({ rosterId: "second", forceNewEvent: true, source }, "secret");
  const forcedEventId = forced.event.eventId;

  assert.equal(forced.created, true);
  assert.equal(forced.rolloverForced, true);
  assert.equal(forced.rolloverReason, "administrator-forced");
  assert.equal(forced.supersededEventId, second.event.eventId);
  assert.equal(backend.readSeasonEventById_(second.event.eventId).status, "archived");
  assert.equal(backend.readSeasonEventPointer_(backend.buildCurrentCwlSeasonEventRosterPointerPath_("second")).eventId, forcedEventId);
  assert.equal(backend.readSeasonEventPointer_(backend.buildCurrentCwlSeasonEventRosterPointerPath_("main")).eventId, main.event.eventId);
  assert.equal(backend.readSeasonEventPointer_("events/seasonEvents/currentCwl").eventId, main.event.eventId);
  assert.deepEqual(descriptors.map((descriptor) => descriptor.eventId), [forcedEventId, second.event.eventId]);
  assert.equal(descriptors[0].pointerAction, "put");
  assert.equal(descriptors[1].liveAggregateAction, "none");
  assert.equal(descriptors[1].finalAggregateAction, "none");
  assert.equal(descriptors[1].pointerAction, "none");

  const retried = backend.ensureCurrentCwlSeasonEvent({ rosterId: "second", forceNewEvent: true, source }, "secret");
  assert.equal(retried.created, false);
  assert.equal(retried.forceRetryReused, true);
  assert.equal(retried.event.eventId, forcedEventId);
  assert.equal(retried.supersededEventId, second.event.eventId);
  assert.equal(retried.rolloverForced, true);
  assert.deepEqual(descriptors.map((descriptor) => descriptor.eventId), [forcedEventId, second.event.eventId, forcedEventId, second.event.eventId]);
  assert.equal(backend.ensureCurrentCwlSeasonEvent({ forceNewEvent: true, source }, "secret").status, "force-new-cwl-event-requires-roster");
});

test("CWL event target stays frozen and target migration prunes non-target bindings", () => {
  const backend = loadBackend();
  const event = {
    eventId: "cwl-frozen",
    type: "cwl",
    cwlTrackingState: "active",
    cwl: {
      target: {
        resolved: true,
        status: "resolved",
        rosterId: "main",
        rosterTitle: "Main",
        clanTag: "#2LUCULP",
        clanName: "Main Clan",
        leagueName: "Master III",
        leagueRank: 8,
        resolvedAt: "2026-07-01T00:00:00.000Z",
        source: { type: "test" },
        eligibleAccountTags: ["#2LUCULP"],
      },
      groups: {
        old: {
          groupId: "old",
          clanTags: ["#2LUCULP", "#9PYLQG"],
          warTags: ["#WAR1"],
          expectedRounds: 1,
        },
        wrong: {
          groupId: "wrong",
          clanTags: ["#9PYLQG"],
          warTags: ["#WAR2"],
          expectedRounds: 1,
        },
      },
      finalizationHash: "unsafe",
      finalizationFirstSeenAt: "2026-07-02T00:00:00.000Z",
    },
  };
  const rosterData = {
    rosterOrder: ["second", "main"],
    rosters: [
      { id: "second", title: "Second", connectedClanTag: "#9PYLQG", trackingMode: "cwl", cwlLeagueName: "Champion I", main: [] },
      { id: "main", title: "Main", connectedClanTag: "#2LUCULP", trackingMode: "cwl", cwlLeagueName: "Master III", main: [{ tag: "#2LUCULP", th: 16 }] },
    ],
  };

  const result = backend.applyCwlSeasonEventTargetResolution_(event, rosterData, {
    fetchMissing: false,
    nowIso: "2026-07-03T00:00:00.000Z",
  });

  assert.equal(result.changed, true);
  assert.equal(result.target.rosterId, "main");
  assert.equal(JSON.stringify(Object.keys(result.event.cwl.groups)), JSON.stringify(["old"]));
  assert.equal(JSON.stringify(result.event.cwl.groups.old.clanTags), JSON.stringify(["#2LUCULP"]));
  assert.equal(result.event.cwl.finalizationHash, "unsafe");
});

test("CWL dormant and mixed signups count and rank only target-eligible accounts", () => {
  const backend = loadBackend();
  const event = {
    eventId: "cwl-dormant",
    type: "cwl",
    cwlTrackingState: "active",
    cwl: {
      target: {
        resolved: true,
        status: "resolved",
        rosterId: "main",
        clanTag: "#2LUCULP",
        leagueName: "Champion I",
        leagueRank: 0,
        eligibleAccountTags: ["#2LUCULP"],
      },
    },
    participantsByDiscordId: {
      "111": { discordId: "111", discordDisplayName: "Mixed", status: "signed_up", accounts: [{ tag: "#2LUCULP", name: "Alpha" }, { tag: "#9PYLQG", name: "Dormant" }] },
      "222": { discordId: "222", discordDisplayName: "Dormant", status: "signed_up", accounts: [{ tag: "#9PYLQG", name: "Wrong" }] },
      "333": { discordId: "333", discordDisplayName: "Cancelled", status: "cancelled", accounts: [{ tag: "#2LUCULP", name: "Alpha" }] },
    },
  };

  const counts = backend.summarizeSeasonEventParticipantCounts_(event);
  const registered = backend.listCwlSeasonEventRegisteredAccounts_(event);
  const finalAggregate = backend.filterCwlAggregateToRegisteredParticipants_(event, {
    eventId: "cwl-dormant",
    kind: "live",
    warTags: ["#WAR1"],
    byTag: {
      "#2LUCULP": { starsTotal: 6, attacksMade: 2 },
      "#9PYLQG": { starsTotal: 21, attacksMade: 7 },
    },
  });

  assert.equal(JSON.stringify(counts), JSON.stringify({ participantCount: 1, activeParticipantCount: 1, accountCount: 1 }));
  assert.equal(JSON.stringify(registered.map((row) => row.tag)), JSON.stringify(["#2LUCULP"]));
  assert.equal(JSON.stringify(Object.keys(finalAggregate.byTag)), JSON.stringify(["#2LUCULP"]));
  assert.equal(JSON.stringify(finalAggregate.rankedTags), JSON.stringify(["#2LUCULP"]));
});

test("CWL signup validation rejects outside target accounts before and inside the write lock", () => {
  const backend = installMemoryFirebase(loadBackend());
  const event = {
    eventId: "cwl-signup",
    type: "cwl",
    status: "open",
    signupsOpen: true,
    cwlTrackingState: "active",
    cwl: {
      target: {
        resolved: true,
        status: "resolved",
        rosterId: "main",
        clanTag: "#2LUCULP",
        leagueName: "Champion I",
        leagueRank: 0,
        eligibleAccountTags: ["#2LUCULP"],
      },
    },
    participantsByDiscordId: {},
    participantsByTag: {},
  };
  const activeData = buildSeasonEventRosterData();
  activeData.playerMetrics.byTag["#9PYLQG"].identity.discordId = "111";
  activeData.playerMetrics.byTag["#9PYLQG"].identity.discordUsername = "alpha";
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: activeData });
  backend.writeSeasonEventFirebasePayload_(backend.buildSeasonEventByIdPath_("cwl-signup"), "PUT", event);

  const outside = backend.registerSeasonEventSignup({
    eventId: "cwl-signup",
    discordUser: { id: "111", username: "alpha" },
    playerTags: ["#2LUCULP", "#9PYLQG"],
  }, "secret");

  assert.equal(outside.status, "player-tag-outside-event-roster");

  const originalLock = backend.withSeasonEventParticipantWriteLock_;
  backend.withSeasonEventParticipantWriteLock_ = (callback) => {
    backend.writeSeasonEventFirebasePayload_(backend.buildSeasonEventByIdPath_("cwl-signup"), "PATCH", {
      cwl: {
        target: {
          resolved: true,
          status: "resolved",
          rosterId: "second",
          clanTag: "#9PYLQG",
          leagueName: "Champion I",
          leagueRank: 0,
          eligibleAccountTags: ["#9PYLQG"],
        },
      },
    });
    return callback();
  };
  const locked = backend.registerSeasonEventSignup({
    eventId: "cwl-signup",
    discordUser: { id: "111", username: "alpha" },
    playerTags: ["#2LUCULP"],
  }, "secret");
  backend.withSeasonEventParticipantWriteLock_ = originalLock;

  assert.equal(locked.status, "player-tag-outside-event-roster");
});

test("CWL unresolved targets wait while legacy completed targetless events remain readable", () => {
  const backend = installMemoryFirebase(loadBackend());
  const unresolvedEvent = {
    eventId: "cwl-unresolved",
    type: "cwl",
    cwlTrackingState: "active",
    cwl: { target: { status: "unresolved", reason: "no-current-cwl-league" } },
    participantsByDiscordId: {
      "111": { discordId: "111", status: "signed_up", accounts: [{ tag: "#2LUCULP", name: "Alpha" }] },
    },
  };
  const legacyEvent = {
    eventId: "cwl-legacy",
    type: "cwl",
    cwlTrackingState: "completed",
    cwl: { groups: {} },
    participantsByDiscordId: {
      "111": { discordId: "111", status: "signed_up", accounts: [{ tag: "#2LUCULP", name: "Alpha" }] },
    },
  };
  backend.writeSeasonEventFirebasePayload_(backend.buildCwlSeasonEventAggregatePath_("cwl-legacy", "final"), "PUT", {
    eventId: "cwl-legacy",
    kind: "final",
    warTags: ["#WAR1"],
    byTag: { "#2LUCULP": { starsTotal: 3, attacksMade: 1 } },
  });

  const unresolved = backend.buildCwlSeasonEventLeaderboard_(unresolvedEvent, {}, {});
  const legacy = backend.buildCwlSeasonEventLeaderboard_(legacyEvent, {}, {});

  assert.equal(unresolved.status, "cwl-target-unresolved");
  assert.equal(JSON.stringify(unresolved.leaderboard), JSON.stringify([]));
  assert.equal(legacy.leaderboard.length, 1);
  assert.equal(legacy.leaderboard[0].tag, "#2LUCULP");
});

test("CWL refresh repairs a resolved empty target eligibility snapshot", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    events: {
      seasonEvents: {
        currentCwl: { eventId: "cwl-broken", type: "cwl" },
        byId: {
          "cwl-broken": {
            eventId: "cwl-broken",
            type: "cwl",
            status: "open",
            visibility: "public",
            signupsOpen: true,
            startsAt: "",
            endsAt: "",
            cwlTrackingState: "active",
            cwl: {
              target: {
                resolved: true,
                status: "resolved",
                rosterId: "main",
                rosterTitle: "Main",
                clanTag: "#CLAN",
                clanName: "Main",
                leagueName: "Champion I",
                leagueRank: 0,
                resolvedAt: "2026-07-04T00:00:00.000Z",
                eligibleAccountTags: [],
              },
              groups: {},
            },
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
  const snapshot = {
    leaguegroupRawByClanTag: {
      "#CLAN": {
        state: "inWar",
        season: "2026-07",
        clans: [{ tag: "#CLAN", warLeague: { name: "Champion I" } }, { tag: "#OPP" }],
        rounds: [{ warTags: ["#WAR1"] }],
      },
    },
    cwlWarRawByTag: {
      "#WAR1": {
        state: "inWar",
        startTime: "2026-07-04T20:00:00.000Z",
        endTime: "2026-07-05T20:00:00.000Z",
        clan: {
          tag: "#CLAN",
          members: [{ tag: "#PLAYER", name: "Player", attacks: [{ defenderTag: "#BASE", stars: 3, destructionPercentage: 100 }] }],
        },
        opponent: {
          tag: "#OPP",
          members: [{ tag: "#BASE", name: "Base", attacks: [] }],
        },
      },
    },
    cwlWarErrorByTag: {},
  };

  const result = backend.refreshCurrentCwlSeasonEventFromSnapshot_(rosterData, snapshot, { nowIso: "2026-07-05T00:00:00.000Z" });
  const event = backend.readSeasonEventById_("cwl-broken");
  const live = backend.readCwlSeasonEventAggregate_("cwl-broken", "live");
  const leaderboard = backend.buildSeasonEventLeaderboard_(event, rosterData, { nowIso: "2026-07-05T00:00:00.000Z" });

  assert.equal(result.status, "active");
  assert.equal(result.publication.lifecycleState, "active");
  assert.equal(JSON.stringify(event.cwl.target.eligibleAccountTags), JSON.stringify(["#PLAYER"]));
  assert.equal(backend.summarizeSeasonEvent_(event).activeParticipantCount, 1);
  assert.equal(JSON.stringify(live.rankedTags), JSON.stringify(["#PLAYER"]));
  assert.equal(leaderboard.event.activeParticipantCount, 1);
  assert.equal(leaderboard.leaderboard.length, 1);
  assert.equal(leaderboard.leaderboard[0].tag, "#PLAYER");
});

test("CWL runtime aggregation is target-only and ignores non-target discovery and audit failures", () => {
  const backend = loadBackend();
  const nowIso = "2026-07-05T00:00:00.000Z";
  const event = {
    eventId: "cwl-runtime",
    type: "cwl",
    cwlTrackingState: "active",
    cwl: {
      target: {
        resolved: true,
        status: "resolved",
        rosterId: "main",
        clanTag: "#2LUCULP",
        leagueName: "Champion I",
        leagueRank: 0,
        groupId: "group",
        season: "2026-07",
        groupState: "ended",
        observedAt: nowIso,
        evidenceStatus: "authoritative",
        evidenceObservationId: "runtime-target-observation",
        evidenceProvenance: "deterministic-fresh-observation-v1",
        eligibleAccountTags: ["#2LUCULP"],
      },
    },
  };
  const runtime = {
    schemaVersion: 1,
    eventId: "cwl-runtime",
    discoveryIncomplete: true,
    bootstrapRequired: false,
    groups: {
      group: {
        groupId: "group",
        season: "2026-07",
        state: "ended",
        observedAt: nowIso,
        observationSucceeded: true,
        observedRoundCount: 1,
        observationTopologyComplete: true,
        roundWarTagsByIndex: { "0": ["#WAR1", "#WAR2"] },
        expectedRounds: 1,
        clanTags: ["#2LUCULP", "#9PYLQG"],
        candidateClanTags: ["#2LUCULP", "#9PYLQG"],
        relevantWarTags: ["#WAR1", "#WAR2"],
      },
    },
    roundsByClanTag: {
      "#2LUCULP": { "0": { groupId: "group", roundIndex: 0, warTag: "#WAR1" } },
    },
    warRecords: {
      "#WAR1|#2LUCULP": {
        warTag: "#WAR1",
        clanTag: "#2LUCULP",
        groupId: "group",
        roundIndex: 0,
        status: "settled",
        state: "warended",
        auditStatus: "matched",
        auditedAt: nowIso,
        lastFetchedAt: nowIso,
        lastValidContribution: {
          warTag: "#WAR1",
          clanTag: "#2LUCULP",
          roundIndex: 0,
          state: "warended",
          hash: "target-hash",
          endTime: "2026-07-03T00:00:00.000Z",
          aggregateByTag: { "#2LUCULP": { starsTotal: 3, attacksMade: 1 } },
        },
      },
      "#WAR2|#9PYLQG": {
        warTag: "#WAR2",
        clanTag: "#9PYLQG",
        groupId: "group",
        roundIndex: 0,
        status: "settled",
        state: "warended",
        auditStatus: "fetch-failed",
        lastFetchedAt: nowIso,
        lastValidContribution: {
          warTag: "#WAR2",
          clanTag: "#9PYLQG",
          roundIndex: 0,
          state: "warended",
          hash: "non-target-hash",
          aggregateByTag: { "#9PYLQG": { starsTotal: 21, attacksMade: 7 } },
        },
      },
    },
    ignoredMarkers: {},
  };

  const result = backend.buildCwlSeasonEventAggregateFromRuntime_(event, runtime, { eventBoundClanTags: ["#2LUCULP", "#9PYLQG"] }, nowIso);

  assert.equal(result.discoveryIncomplete, false);
  assert.equal(result.auditIncomplete, false);
  assert.equal(result.complete, true);
  assert.equal(JSON.stringify(Object.keys(result.aggregate.byTag)), JSON.stringify(["#2LUCULP"]));
  assert.equal(JSON.stringify(result.aggregate.warTags), JSON.stringify(["#WAR1"]));
});

test("CWL backend leaderboard resolves display names from current player metrics before tag fallback", () => {
  const backend = installMemoryFirebase(loadBackend());
  const rosterData = backend.validateRosterData_(buildSeasonEventLeaderboardRosterData());
  rosterData.playerMetrics.byTag["#2LUCULP"].identity.name = "Current Clash";
  rosterData.playerMetrics.byTag["#2LUCULP"].latestSnapshot.name = "Latest Clash";
  const event = {
    eventId: "cwl-name",
    type: "cwl",
    status: "open",
    cwlTrackingState: "active",
    cwl: {
      target: {
        resolved: true,
        status: "resolved",
        rosterId: "main",
        clanTag: "#CLAN",
        leagueName: "Champion I",
        leagueRank: 0,
        eligibleAccountTags: ["#2LUCULP"],
      },
    },
    participantsByDiscordId: {
      "100": {
        discordId: "100",
        status: "signed_up",
        accounts: [{ tag: "#2LUCULP" }],
      },
    },
  };
  backend.writeSeasonEventFirebasePayload_(backend.buildCwlSeasonEventAggregatePath_("cwl-name", "live"), "PUT", {
    eventId: "cwl-name",
    kind: "live",
    hash: "hash-1",
    scoreSchema: "cwl-offense-stars-defense-stars-v2",
    warTags: ["#WAR1"],
    byTag: {
      "#2LUCULP": { starsTotal: 3, attacksMade: 1, totalDestruction: 100 },
    },
  });

  const leaderboard = backend.buildSeasonEventLeaderboard_(event, rosterData, {
    nowIso: "2026-07-05T00:00:00.000Z",
  });

  assert.equal(leaderboard.leaderboard.length, 1);
  assert.equal(leaderboard.leaderboard[0].displayName, "Current Clash");
  assert.equal(leaderboard.leaderboard[0].accounts[0].name, "Current Clash");
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
    { eventId: "cwl-test", type: "cwl", cwlTrackingState: "completed", participantsByDiscordId },
    { eventId: "cwl-test", kind: "live", warTags: ["#WAR1", "#WAR2"], byTag }
  );

  assert.ok(Buffer.byteLength(JSON.stringify(finalAggregate), "utf8") < 128 * 1024);
  assert.equal(Object.keys(finalAggregate.byTag).length, 200);
  assert.equal(finalAggregate.rankedTags.length, 200);
});

test("CWL defense-stars migration backfills stored aggregates", () => {
  const backend = loadBackend();
  const encodedEventId = backend.encodeFirebaseObjectKey_("cwl-old");
  const initialAggregate = backend.encodeFirebaseObjectKeysRecursive_({
    eventId: "cwl-old",
    kind: "live",
    cwlTrackingState: "active",
    generatedAt: "2026-07-05T00:00:00.000Z",
    lastSuccessfulRefreshAt: "2026-07-05T00:00:00.000Z",
    hash: "old-hash",
    warTags: ["#WAR1"],
    byTag: {
      "#AAA": {
        starsTotal: 6,
        attacksMade: 2,
        attackedDefenseDays: 1,
        bestStarsConceded: 3,
        bestDestructionConceded: 100,
      },
    },
  });
  installMemoryFirebase(backend, {
    events: {
      seasonEvents: {
        cwlAggregates: {
          byEvent: {
            [encodedEventId]: {
              live: initialAggregate,
            },
          },
        },
      },
    },
  });
  backend.publishCloudflareSeasonEventsAfterMutation_ = () => ({ ok: true });

  const result = backend.migrateCwlSeasonEventDefenseStarsStorage_({
    nowIso: "2026-07-06T00:00:00.000Z",
  });
  const second = backend.migrateCwlSeasonEventDefenseStarsStorage_({
    dryRun: true,
    nowIso: "2026-07-06T00:01:00.000Z",
  });
  const stored = backend.decodeFirebaseObjectKeysRecursive_(
    backend.__getFirebaseDb().events.seasonEvents.cwlAggregates.byEvent[encodedEventId].live,
  );

  assert.equal(result.changedAggregateCount, 1);
  assert.equal(result.writtenAggregateCount, 1);
  assert.equal(second.changedAggregateCount, 0);
  assert.equal(second.writtenAggregateCount, 0);
  assert.equal(stored.scoreSchema, "cwl-offense-stars-defense-stars-v2");
  assert.equal(stored.byTag["#AAA"].defenseStarsConceded, 3);
  assert.equal(stored.byTag["#AAA"].bestStarsConceded, 3);
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
    clans: [{ tag: "#CLAN", warLeague: { name: "Champion I" } }, { tag: "#OPP" }],
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
  assert.equal(result.publication.lifecycleState, "active");
  assert.equal(result.requestCounts.leagueGroup, 1);
  assert.equal(result.requestCounts.cwlWar, 1);
  assert.equal(event.cwlTrackingState, "active");
  assert.equal(event.startsAt, "2026-07-04T20:00:00.000Z");
  assert.equal(live.byTag["#PLAYER"].starsTotal, 3);
});

test("CWL event window projects through expected future rounds without duplicating the group", () => {
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
            startsAt: "2026-07-04T03:20:17.000Z",
            endsAt: "2026-07-05T03:20:30.000Z",
            cwlTrackingState: "active",
            cwl: {
              groups: {
                "grp-existing": {
                  groupId: "grp-existing",
                  anchorWarTag: "#WAR1",
                  clanTags: ["#CLAN"],
                  warTags: ["#WAR1"],
                  firstWarStartTime: "2026-07-04T03:20:17.000Z",
                  lastWarEndTime: "2026-07-05T03:20:30.000Z",
                  expectedRounds: 7,
                },
              },
            },
          },
        },
      },
    },
  });
  const rosterData = buildValidRosterData();
  rosterData.rosters[0].connectedClanTag = "#CLAN";
  const leaguegroup = {
    state: "inWar",
    season: "2026-07",
    clans: [{ tag: "#CLAN", warLeague: { name: "Champion I" } }, { tag: "#OPP" }],
    rounds: [
      { warTags: ["#WAR1", "#OTHER1"] },
      { warTags: ["#WAR2", "#OTHER2"] },
      { warTags: ["#0"] },
      { warTags: ["#0"] },
      { warTags: ["#0"] },
      { warTags: ["#0"] },
      { warTags: ["#0"] },
    ],
  };
  const makeWar = (tag, start, end, stars) => ({
    state: tag === "#WAR1" ? "warEnded" : "inWar",
    startTime: start,
    endTime: end,
    clan: {
      tag: "#CLAN",
      members: [{ tag: "#PLAYER", attacks: [{ defenderTag: "#BASE", stars, destructionPercentage: stars === 3 ? 100 : 80 }] }],
    },
    opponent: {
      tag: "#OPP",
      members: [{ tag: "#BASE", attacks: [] }],
    },
  });
  const snapshot = {
    leaguegroupRawByClanTag: { "#CLAN": leaguegroup },
    cwlWarRawByTag: {
      "#WAR1": makeWar("#WAR1", "2026-07-04T03:20:17.000Z", "2026-07-05T03:20:30.000Z", 3),
      "#WAR2": makeWar("#WAR2", "2026-07-05T03:20:17.000Z", "2026-07-06T03:20:30.000Z", 2),
      "#OTHER1": {
        state: "warEnded",
        startTime: "2026-07-04T03:20:17.000Z",
        endTime: "2026-07-05T03:20:30.000Z",
        clan: { tag: "#AAA", members: [] },
        opponent: { tag: "#BBB", members: [] },
      },
      "#OTHER2": {
        state: "inWar",
        startTime: "2026-07-05T03:20:17.000Z",
        endTime: "2026-07-06T03:20:30.000Z",
        clan: { tag: "#AAA", members: [] },
        opponent: { tag: "#BBB", members: [] },
      },
    },
    cwlWarErrorByTag: {},
  };

  const result = backend.refreshCurrentCwlSeasonEventFromSnapshot_(rosterData, snapshot, { nowIso: "2026-07-05T00:00:00.000Z" });
  const event = backend.readSeasonEventById_("cwl-active");
  const groupIds = Object.keys(event.cwl.groups);

  assert.equal(result.status, "active");
  assert.equal(event.endsAt, "2026-07-11T03:20:30.000Z");
  assert.equal(groupIds.length, 1);
  const boundGroupId = backend.buildCwlRuntimeGroupId_(leaguegroup);
  assert.equal(groupIds[0], boundGroupId);
  assert.equal(
    JSON.stringify(event.cwl.groups[boundGroupId].warTags),
    JSON.stringify(["#WAR1", "#WAR2"])
  );
  assert.equal(event.cwl.groups[boundGroupId].projectedLastWarEndTime, "2026-07-11T03:20:30.000Z");
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
              target: {
                resolved: true,
                status: "resolved",
                rosterId: "a",
                clanTag: "#AAA",
                leagueName: "Unranked",
                leagueRank: 999,
                eligibleAccountTags: ["#A"],
              },
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
  const runtime = backend.readCwlRuntime_("cwl-active");
  assert.equal(runtime.roundsByClanTag["#AAA"]["0"].warTag, "#WAR1");
  assert.equal(paths.filter((path) => path.includes("/clanwarleagues/wars/")).length, 2);
});

test("CWL locally ended wars cannot finalize without authoritative group evidence", () => {
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
                "grp-shared": {
                  groupId: "grp-shared",
                  clanTags: ["#AAA", "#BBB"],
                  warTags: ["#A1", "#B1", "#A2", "#B2", "#A3", "#B3", "#A4", "#B4"],
                  expectedRounds: 7,
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
    { ...rosterData.rosters[0], id: "a", connectedClanTag: "#AAA" },
    { ...rosterData.rosters[0], id: "b", connectedClanTag: "#BBB" },
  ];
  const makeWar = (warClanTag, playerTag) => ({
    state: "warEnded",
    startTime: "2026-07-04T00:00:00.000Z",
    endTime: "2026-07-05T00:00:00.000Z",
    clan: {
      tag: warClanTag,
      members: [{ tag: playerTag, attacks: [{ defenderTag: "#BASE", stars: 3, destructionPercentage: 100 }] }],
    },
    opponent: {
      tag: warClanTag === "#AAA" ? "#OPPA" : "#OPPB",
      members: [{ tag: "#BASE", attacks: [] }],
    },
  });
  const snapshot = {
    leaguegroupRawByClanTag: {},
    cwlWarRawByTag: {
      "#A1": makeWar("#AAA", "#PLAYER"),
      "#B1": makeWar("#BBB", "#PLAYERB"),
      "#A2": makeWar("#AAA", "#PLAYER"),
      "#B2": makeWar("#BBB", "#PLAYERB"),
      "#A3": makeWar("#AAA", "#PLAYER"),
      "#B3": makeWar("#BBB", "#PLAYERB"),
      "#A4": makeWar("#AAA", "#PLAYER"),
      "#B4": makeWar("#BBB", "#PLAYERB"),
    },
    cwlWarErrorByTag: {},
  };

  const result = backend.refreshCurrentCwlSeasonEventFromSnapshot_(rosterData, snapshot, { nowIso: "2026-07-08T00:00:00.000Z" });
  const event = backend.readSeasonEventById_("cwl-active");

  assert.equal(result.status, "waiting");
  assert.equal(event.cwlTrackingState, "active");
  assert.equal(event.cwl.finalizationHash, "");
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
              target: {
                resolved: true,
                status: "resolved",
                rosterId: "a",
                clanTag: "#AAA",
                leagueName: "Champion I",
                leagueRank: 0,
                groupId: "grp-test",
                season: "2026-07",
                observedAt: "2026-07-03T23:55:00.000Z",
                evidenceStatus: "authoritative",
                evidenceObservationId: "ended-target-observation",
                evidenceProvenance: "deterministic-fresh-observation-v1",
                eligibleAccountTags: ["#A"],
              },
              groups: {
                "grp-test": {
                  groupId: "grp-test",
                  clanTags: ["#AAA"],
                  warTags: ["#WAR1"],
                  expectedRounds: 1,
                },
              },
              groupCount: 1,
              firstBoundGroupId: "grp-test",
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
  assert.equal(result.publication.liveAggregateAction, "put");
  assert.equal(result.publication.finalAggregateAction, "none");
  assert.equal(result.publication.pointerAction, "none");
  assert.equal(live.stale, true);
});

test("CWL completion requires authoritative group end plus two spaced complete observations", () => {
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
            cwl: { groups: {} },
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
  rosterData.rosters[0].id = "a";
  rosterData.rosters[0].connectedClanTag = "#AAA";
  rosterData.rosters[0].main[0].tag = "#A";
  const leaguegroup = {
    state: "ended",
    season: "2026-07",
    clans: [{ tag: "#AAA", warLeague: { name: "Champion I" } }, { tag: "#BBB" }],
    rounds: [{ warTags: ["#WAR1"] }],
  };
  const snapshot = {
    leaguegroupRawByClanTag: { "#AAA": leaguegroup },
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

  backend.refreshCurrentCwlSeasonEventFromSnapshot_(rosterData, snapshot, { nowIso: "2026-07-04T00:00:00.000Z" });
  backend.refreshCurrentCwlSeasonEventFromSnapshot_(rosterData, snapshot, { nowIso: "2026-07-04T00:03:00.000Z" });
  const first = backend.refreshCurrentCwlSeasonEventFromSnapshot_(rosterData, snapshot, { nowIso: "2026-07-04T00:06:00.000Z" });
  const second = backend.refreshCurrentCwlSeasonEventFromSnapshot_(rosterData, snapshot, { nowIso: "2026-07-04T00:09:00.000Z" });
  const db = backend.__getFirebaseDb().events.seasonEvents;
  const finalAggregate = backend.readCwlSeasonEventAggregate_("cwl-active", "final");

  assert.equal(first.status, "finalizing");
  assert.equal(second.status, "completed");
  assert.equal(first.publication.lifecycleState, "finalizing");
  assert.equal(second.publication.lifecycleState, "completed");
  assert.equal(first.publication.finalAggregateAction, "none");
  assert.equal(first.publication.pointerAction, "put");
  assert.equal(second.publication.liveAggregateAction, "delete");
  assert.equal(second.publication.finalAggregateAction, "put");
  assert.equal(second.publication.pointerAction, "put");
  assert.equal(backend.readSeasonEventPointer_("events/seasonEvents/currentCwl"), null);
  assert.equal(backend.readSeasonEventPointer_("events/seasonEvents/current/cwl"), null);
  assert.equal(db.latestCompletedCwl.eventId, "cwl-active");
  assert.equal(backend.readCwlSeasonEventAggregate_("cwl-active", "live"), null);
  assert.equal(finalAggregate.byTag["#A"].starsTotal, 3);
});

test("CWL runtime restarts ended-war confirmation when the canonical contribution changes", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    events: {
      seasonEvents: {
        currentCwl: { eventId: "cwl-active", type: "cwl" },
        byId: {
          "cwl-active": {
            eventId: "cwl-active",
            type: "cwl",
            status: "open",
            cwlTrackingState: "active",
            cwl: { groups: {} },
          },
        },
      },
    },
  });
  const rosterData = backend.validateRosterData_(buildValidRosterData());
  const leaguegroup = buildOneRoundCwlLeagueGroup();
  let war = buildOneRoundCwlWar({ stars: 2, destruction: 80 });
  backend.cocFetchAllByPathEntries_ = (entriesRaw) => {
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    const dataByKey = {};
    for (const entry of entries) {
      if (entry.path.includes("/currentwar/leaguegroup")) dataByKey[entry.key] = leaguegroup;
      else if (entry.path.includes("/clanwarleagues/wars/")) dataByKey[entry.key] = war;
    }
    return { dataByKey, errorByKey: {}, requestCount: entries.length, batchCount: entries.length ? 1 : 0 };
  };

  backend.buildCwlCoordinatorResult_(rosterData, { nowIso: "2026-07-05T20:05:00.000Z" });
  const firstRecord = backend.readCwlRuntime_("cwl-active").warRecords["#WAR1|#CLAN"];
  war = buildOneRoundCwlWar({ stars: 3, destruction: 100 });
  backend.buildCwlCoordinatorResult_(rosterData, { nowIso: "2026-07-05T20:10:00.000Z" });
  const changedRecord = backend.readCwlRuntime_("cwl-active").warRecords["#WAR1|#CLAN"];
  backend.buildCwlCoordinatorResult_(rosterData, { nowIso: "2026-07-05T20:15:00.000Z" });
  const settledRecord = backend.readCwlRuntime_("cwl-active").warRecords["#WAR1|#CLAN"];

  assert.equal(firstRecord.status, "confirming");
  assert.equal(firstRecord.lastValidContribution.aggregateByTag["#PLAYER"].starsTotal, 2);
  assert.equal(changedRecord.status, "confirming");
  assert.notEqual(changedRecord.confirmingHash, firstRecord.confirmingHash);
  assert.equal(changedRecord.lastValidContribution.aggregateByTag["#PLAYER"].starsTotal, 3);
  assert.equal(settledRecord.status, "settled");
});

test("CWL final audit reopens settled wars whose contribution hash changed", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    events: {
      seasonEvents: {
        currentCwl: { eventId: "cwl-active", type: "cwl" },
        byId: {
          "cwl-active": {
            eventId: "cwl-active",
            type: "cwl",
            status: "open",
            cwlTrackingState: "finalizing",
            cwl: { groups: {} },
          },
        },
      },
    },
  });
  const rosterData = backend.validateRosterData_(buildValidRosterData());
  const leaguegroup = buildOneRoundCwlLeagueGroup();
  let war = buildOneRoundCwlWar({ stars: 3, destruction: 90 });
  backend.cocFetchAllByPathEntries_ = (entriesRaw) => {
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    const dataByKey = {};
    for (const entry of entries) {
      if (entry.path.includes("/currentwar/leaguegroup")) dataByKey[entry.key] = leaguegroup;
      else if (entry.path.includes("/clanwarleagues/wars/")) dataByKey[entry.key] = war;
    }
    return { dataByKey, errorByKey: {}, requestCount: entries.length, batchCount: entries.length ? 1 : 0 };
  };

  backend.buildCwlCoordinatorResult_(rosterData, { nowIso: "2026-07-05T20:05:00.000Z" });
  backend.buildCwlCoordinatorResult_(rosterData, { nowIso: "2026-07-05T20:10:00.000Z" });
  assert.equal(backend.readCwlRuntime_("cwl-active").warRecords["#WAR1|#CLAN"].status, "settled");
  war = buildOneRoundCwlWar({ stars: 3, destruction: 100 });
  backend.buildCwlCoordinatorResult_(rosterData, { nowIso: "2026-07-05T20:15:00.000Z", finalAudit: true });
  const reopenedRecord = backend.readCwlRuntime_("cwl-active").warRecords["#WAR1|#CLAN"];

  assert.equal(reopenedRecord.status, "confirming");
  assert.equal(reopenedRecord.auditStatus, "changed-reopened");
  assert.equal(reopenedRecord.lastValidContribution.aggregateByTag["#PLAYER"].totalDestruction, 100);
});

test("CWL partial-event bootstrap preserves stale aggregate until a coherent runtime succeeds", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    events: {
      seasonEvents: {
        currentCwl: { eventId: "cwl-partial", type: "cwl" },
        byId: {
          "cwl-partial": {
            eventId: "cwl-partial",
            type: "cwl",
            status: "open",
            cwlTrackingState: "active",
            cwl: {
              groups: {
                "grp-existing": {
                  groupId: "grp-existing",
                  clanTags: ["#CLAN"],
                  warTags: ["#WAR1"],
                  expectedRounds: 1,
                },
              },
            },
            participantsByDiscordId: {
              "100": {
                discordId: "100",
                discordUsername: "alpha",
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
  backend.writeSeasonEventFirebasePayload_(backend.buildCwlSeasonEventAggregatePath_("cwl-partial", "live"), "PUT", {
    eventId: "cwl-partial",
    kind: "live",
    hash: "stale-display",
    scoreSchema: "cwl-offense-stars-defense-stars-v2",
    warTags: ["#OLD"],
    byTag: { "#PLAYER": { starsTotal: 1, attacksMade: 1, totalDestruction: 50 } },
  });
  backend.cocFetchAllByPathEntries_ = (entriesRaw) => {
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    const errorByKey = {};
    for (const entry of entries) errorByKey[entry.key] = Object.assign(new Error("temporary group failure"), { statusCode: 500 });
    return { dataByKey: {}, errorByKey, requestCount: entries.length, batchCount: entries.length ? 1 : 0 };
  };

  const failed = backend.refreshCurrentCwlSeasonEventFromSnapshot_(rosterData, {}, { nowIso: "2026-07-05T20:00:00.000Z" });
  const staleLive = backend.readCwlSeasonEventAggregate_("cwl-partial", "live");
  backend.cocFetchAllByPathEntries_ = (entriesRaw) => {
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    const dataByKey = {};
    for (const entry of entries) {
      if (entry.path.includes("/currentwar/leaguegroup")) dataByKey[entry.key] = buildOneRoundCwlLeagueGroup({ state: "ended" });
      else if (entry.path.includes("/clanwarleagues/wars/")) dataByKey[entry.key] = buildOneRoundCwlWar({ stars: 3, destruction: 100 });
    }
    return { dataByKey, errorByKey: {}, requestCount: entries.length, batchCount: entries.length ? 1 : 0 };
  };
  const recovered = backend.refreshCurrentCwlSeasonEventFromSnapshot_(rosterData, {}, { nowIso: "2026-07-05T20:05:00.000Z" });
  const recoveredLive = backend.readCwlSeasonEventAggregate_("cwl-partial", "live");
  const event = backend.readSeasonEventById_("cwl-partial");

  assert.equal(failed.status, "stale");
  assert.equal(failed.publication.liveAggregateAction, "put");
  assert.equal(failed.publication.finalAggregateAction, "none");
  assert.equal(failed.publication.pointerAction, "none");
  assert.equal(staleLive.hash, "stale-display");
  assert.equal(staleLive.byTag["#PLAYER"].starsTotal, 1);
  assert.equal(recovered.status, "active");
  assert.equal(recoveredLive.byTag["#PLAYER"].starsTotal, 3);
  assert.equal(event.participantsByDiscordId["100"].accounts[0].tag, "#PLAYER");
});

test("CWL current-run failure does not advance freshness while valid known-war updates stay partial", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    events: {
      seasonEvents: {
        currentCwl: { eventId: "cwl-active", type: "cwl" },
        byId: {
          "cwl-active": {
            eventId: "cwl-active",
            type: "cwl",
            status: "open",
            cwlTrackingState: "active",
            cwl: { groups: {} },
            participantsByDiscordId: {
              "100": { discordId: "100", status: "signed_up", accounts: [{ tag: "#PLAYER", name: "Player" }] },
            },
          },
        },
      },
    },
  });
  const rosterData = backend.validateRosterData_(buildValidRosterData());
  let mode = "ok";
  let war = buildOneRoundCwlWar({ state: "inWar", stars: 2, destruction: 80 });
  backend.cocFetchAllByPathEntries_ = (entriesRaw) => {
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    const dataByKey = {};
    const errorByKey = {};
    for (const entry of entries) {
      if (entry.path.includes("/currentwar/leaguegroup")) {
        if (mode === "ok") dataByKey[entry.key] = buildOneRoundCwlLeagueGroup();
        else errorByKey[entry.key] = Object.assign(new Error("group failed"), { statusCode: 500 });
      } else if (entry.path.includes("/clanwarleagues/wars/")) {
        if (mode === "allFail") errorByKey[entry.key] = Object.assign(new Error("war failed"), { statusCode: 500 });
        else dataByKey[entry.key] = war;
      }
    }
    return { dataByKey, errorByKey, requestCount: entries.length, batchCount: entries.length ? 1 : 0 };
  };

  backend.refreshCurrentCwlSeasonEventFromSnapshot_(rosterData, {}, { nowIso: "2026-07-05T20:00:00.000Z" });
  war = buildOneRoundCwlWar({ state: "inWar", stars: 3, destruction: 100 });
  mode = "groupFail";
  const partial = backend.refreshCurrentCwlSeasonEventFromSnapshot_(rosterData, {}, { nowIso: "2026-07-05T20:05:00.000Z" });
  const partialLive = backend.readCwlSeasonEventAggregate_("cwl-active", "live");
  const partialEvent = backend.readSeasonEventById_("cwl-active");
  mode = "allFail";
  const failed = backend.refreshCurrentCwlSeasonEventFromSnapshot_(rosterData, {}, { nowIso: "2026-07-05T20:10:00.000Z" });
  const failedLive = backend.readCwlSeasonEventAggregate_("cwl-active", "live");
  const runtime = backend.readCwlRuntime_("cwl-active");

  assert.equal(partial.status, "active");
  assert.equal(partialLive.byTag["#PLAYER"].starsTotal, 3);
  assert.equal(partialLive.stale, true);
  assert.equal(partialEvent.cwl.stale, true);
  assert.equal(partialEvent.cwl.lastDataSuccessAt, "2026-07-05T20:05:00.000Z");
  assert.equal(failed.status, "active");
  assert.equal(failedLive.byTag["#PLAYER"].starsTotal, 3);
  assert.equal(runtime.lastDataSuccessAt, "2026-07-05T20:05:00.000Z");
  assert.notEqual(runtime.lastDataSuccessAt, "2026-07-05T20:10:00.000Z");
});

test("CWL runtime group id stays stable when later rounds materialize", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    events: {
      seasonEvents: {
        currentCwl: { eventId: "cwl-active", type: "cwl" },
        byId: { "cwl-active": { eventId: "cwl-active", type: "cwl", status: "open", cwlTrackingState: "active", cwl: { groups: {} } } },
      },
    },
  });
  const rosterData = backend.validateRosterData_(buildValidRosterData());
  let leaguegroup = {
    state: "inWar",
    season: "2026-07",
    clans: [{ tag: "#CLAN", warLeague: { name: "Champion I" } }, { tag: "#OPP" }],
    rounds: [{ warTags: ["#WAR1"] }, { warTags: ["#0"] }],
  };
  backend.cocFetchAllByPathEntries_ = (entriesRaw) => {
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    const dataByKey = {};
    for (const entry of entries) {
      if (entry.path.includes("/currentwar/leaguegroup")) dataByKey[entry.key] = leaguegroup;
      else if (entry.path.includes("/clanwarleagues/wars/")) {
        dataByKey[entry.key] = buildOneRoundCwlWar({ warTag: entry.key, state: "inWar" });
      }
    }
    return { dataByKey, errorByKey: {}, requestCount: entries.length, batchCount: entries.length ? 1 : 0 };
  };

  backend.buildCwlCoordinatorResult_(rosterData, { nowIso: "2026-07-05T20:00:00.000Z" });
  const firstRuntime = backend.readCwlRuntime_("cwl-active");
  const firstGroupIds = Object.keys(firstRuntime.groups);
  leaguegroup = {
    state: "inWar",
    season: "2026-07",
    clans: [{ tag: "#CLAN", warLeague: { name: "Champion I" } }, { tag: "#OPP" }],
    rounds: [{ warTags: ["#WAR1"] }, { warTags: ["#WAR2"] }],
  };
  backend.buildCwlCoordinatorResult_(rosterData, { nowIso: "2026-07-05T20:05:00.000Z" });
  const secondRuntime = backend.readCwlRuntime_("cwl-active");
  const secondGroupIds = Object.keys(secondRuntime.groups);

  assert.equal(firstGroupIds.length, 1);
  assert.deepEqual(secondGroupIds, firstGroupIds);
  assert.equal(JSON.stringify(secondRuntime.groups[secondGroupIds[0]].materializedRoundIndexes), JSON.stringify([0, 1]));
});

test("CWL immediate ended-war retry does not settle until the confirmation delay elapses", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    events: {
      seasonEvents: {
        currentCwl: { eventId: "cwl-active", type: "cwl" },
        byId: { "cwl-active": { eventId: "cwl-active", type: "cwl", status: "open", cwlTrackingState: "active", cwl: { groups: {} } } },
      },
    },
  });
  const rosterData = backend.validateRosterData_(buildValidRosterData());
  backend.cocFetchAllByPathEntries_ = (entriesRaw) => {
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    const dataByKey = {};
    for (const entry of entries) {
      if (entry.path.includes("/currentwar/leaguegroup")) dataByKey[entry.key] = buildOneRoundCwlLeagueGroup();
      else if (entry.path.includes("/clanwarleagues/wars/")) dataByKey[entry.key] = buildOneRoundCwlWar({ state: "warEnded" });
    }
    return { dataByKey, errorByKey: {}, requestCount: entries.length, batchCount: entries.length ? 1 : 0 };
  };

  backend.buildCwlCoordinatorResult_(rosterData, { nowIso: "2026-07-05T20:00:00.000Z" });
  backend.buildCwlCoordinatorResult_(rosterData, { nowIso: "2026-07-05T20:00:10.000Z" });
  const immediate = backend.readCwlRuntime_("cwl-active").warRecords["#WAR1|#CLAN"];
  backend.buildCwlCoordinatorResult_(rosterData, { nowIso: "2026-07-05T20:03:00.000Z" });
  const delayed = backend.readCwlRuntime_("cwl-active").warRecords["#WAR1|#CLAN"];

  assert.equal(immediate.status, "confirming");
  assert.equal(delayed.status, "settled");
  assert.equal(delayed.lastValidContribution.members.length, 0);
});

test("CWL settled-war post-delay audit reopens changed contributions once and then stops", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    events: {
      seasonEvents: {
        currentCwl: { eventId: "cwl-active", type: "cwl" },
        byId: {
          "cwl-active": {
            eventId: "cwl-active",
            type: "cwl",
            status: "open",
            cwlTrackingState: "active",
            cwl: { groups: {} },
            participantsByDiscordId: {
              "100": { discordId: "100", status: "signed_up", accounts: [{ tag: "#PLAYER", name: "Player" }] },
            },
          },
        },
      },
    },
  });
  const rosterData = backend.validateRosterData_(buildValidRosterData());
  let war = buildOneRoundCwlWar({ state: "warEnded", stars: 2, destruction: 80 });
  const warRequests = [];
  backend.cocFetchAllByPathEntries_ = (entriesRaw) => {
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    const dataByKey = {};
    let warRequestCount = 0;
    for (const entry of entries) {
      if (entry.path.includes("/currentwar/leaguegroup")) dataByKey[entry.key] = buildOneRoundCwlLeagueGroup();
      else if (entry.path.includes("/clanwarleagues/wars/")) {
        warRequestCount++;
        dataByKey[entry.key] = war;
      }
    }
    warRequests.push(warRequestCount);
    return { dataByKey, errorByKey: {}, requestCount: entries.length, batchCount: entries.length ? 1 : 0 };
  };
  const runAt = (nowIso) => {
    const before = warRequests.length;
    backend.buildCwlCoordinatorResult_(rosterData, { nowIso });
    return warRequests.slice(before).reduce((sum, count) => sum + count, 0);
  };

  assert.equal(runAt("2026-07-05T20:00:00.000Z"), 1);
  assert.equal(runAt("2026-07-05T20:03:00.000Z"), 1);
  let record = backend.readCwlRuntime_("cwl-active").warRecords["#WAR1|#CLAN"];
  assert.equal(record.status, "settled");
  assert.equal(record.lastValidContribution.aggregateByTag["#PLAYER"].starsTotal, 2);
  war = buildOneRoundCwlWar({ state: "warEnded", stars: 3, destruction: 100 });
  assert.equal(runAt("2026-07-05T20:04:00.000Z"), 0);
  record = backend.readCwlRuntime_("cwl-active").warRecords["#WAR1|#CLAN"];
  assert.equal(record.status, "settled");
  assert.equal(record.lastValidContribution.aggregateByTag["#PLAYER"].starsTotal, 2);
  assert.equal(runAt("2026-07-05T20:05:30.000Z"), 1);
  record = backend.readCwlRuntime_("cwl-active").warRecords["#WAR1|#CLAN"];
  assert.equal(record.status, "confirming");
  assert.equal(record.auditStatus, "changed-reopened");
  assert.equal(record.lastValidContribution.aggregateByTag["#PLAYER"].starsTotal, 3);
  assert.equal(runAt("2026-07-05T20:08:00.000Z"), 1);
  record = backend.readCwlRuntime_("cwl-active").warRecords["#WAR1|#CLAN"];
  assert.equal(record.status, "settled");
  assert.equal(record.auditStatus, "");
  assert.equal(runAt("2026-07-05T20:09:00.000Z"), 0);
  assert.equal(runAt("2026-07-05T20:10:30.000Z"), 1);
  record = backend.readCwlRuntime_("cwl-active").warRecords["#WAR1|#CLAN"];
  assert.equal(record.auditStatus, "matched");
  assert.equal(runAt("2026-07-05T20:13:00.000Z"), 0);
});

test("CWL audit failure remains retryable and reopened data completes after clean audit", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    events: {
      seasonEvents: {
        currentCwl: { eventId: "cwl-active", type: "cwl" },
        byId: {
          "cwl-active": {
            eventId: "cwl-active",
            type: "cwl",
            status: "open",
            cwlTrackingState: "active",
            cwl: { groups: {} },
            participantsByDiscordId: {
              "100": { discordId: "100", status: "signed_up", accounts: [{ tag: "#PLAYER", name: "Player" }] },
            },
          },
        },
      },
    },
  });
  const rosterData = backend.validateRosterData_(buildValidRosterData());
  let war = buildOneRoundCwlWar({ state: "warEnded", stars: 2, destruction: 80 });
  let failWar = false;
  backend.cocFetchAllByPathEntries_ = (entriesRaw) => {
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    const dataByKey = {};
    const errorByKey = {};
    for (const entry of entries) {
      if (entry.path.includes("/currentwar/leaguegroup")) dataByKey[entry.key] = buildOneRoundCwlLeagueGroup({ state: "ended" });
      else if (entry.path.includes("/clanwarleagues/wars/")) {
        if (failWar) errorByKey[entry.key] = Object.assign(new Error("audit failed"), { statusCode: 500 });
        else dataByKey[entry.key] = war;
      }
    }
    return { dataByKey, errorByKey, requestCount: entries.length, batchCount: entries.length ? 1 : 0 };
  };

  backend.refreshCurrentCwlSeasonEventFromSnapshot_(rosterData, {}, { nowIso: "2026-07-05T20:00:00.000Z" });
  backend.refreshCurrentCwlSeasonEventFromSnapshot_(rosterData, {}, { nowIso: "2026-07-05T20:03:00.000Z" });
  assert.equal(backend.readSeasonEventById_("cwl-active").cwlTrackingState, "active");
  failWar = true;
  backend.refreshCurrentCwlSeasonEventFromSnapshot_(rosterData, {}, { nowIso: "2026-07-05T20:06:00.000Z" });
  assert.equal(backend.readSeasonEventById_("cwl-active").cwlTrackingState, "active");
  assert.equal(backend.readCwlRuntime_("cwl-active").warRecords["#WAR1|#CLAN"].auditStatus, "fetch-failed");
  failWar = false;
  war = buildOneRoundCwlWar({ state: "warEnded", stars: 3, destruction: 100 });
  backend.refreshCurrentCwlSeasonEventFromSnapshot_(rosterData, {}, { nowIso: "2026-07-05T20:09:00.000Z" });
  assert.equal(backend.readCwlRuntime_("cwl-active").warRecords["#WAR1|#CLAN"].status, "confirming");
  backend.refreshCurrentCwlSeasonEventFromSnapshot_(rosterData, {}, { nowIso: "2026-07-05T20:12:00.000Z" });
  assert.equal(backend.readSeasonEventById_("cwl-active").cwlTrackingState, "active");
  assert.equal(backend.readCwlRuntime_("cwl-active").warRecords["#WAR1|#CLAN"].auditStatus, "");
  const firstComplete = backend.refreshCurrentCwlSeasonEventFromSnapshot_(rosterData, {}, { nowIso: "2026-07-05T20:15:00.000Z" });
  const completed = backend.refreshCurrentCwlSeasonEventFromSnapshot_(rosterData, {}, { nowIso: "2026-07-05T20:18:00.000Z" });
  const finalAggregate = backend.readCwlSeasonEventAggregate_("cwl-active", "final");
  const runtime = backend.readCwlRuntime_("cwl-active");

  assert.equal(firstComplete.status, "finalizing");
  assert.equal(completed.status, "completed");
  assert.equal(finalAggregate.byTag["#PLAYER"].starsTotal, 3);
  assert.equal(runtime.finalizedAt, "2026-07-05T20:18:00.000Z");
  assert.equal(runtime.warRecords["#WAR1|#CLAN"].auditStatus, "matched");

  const unprocessedAck = backend.ackFinalizedCwlRuntimeRosterConsumptionFromRosterData_("cwl-active", rosterData, "2026-07-05T20:19:00.000Z");
  const retainedRuntime = backend.readCwlRuntime_("cwl-active");
  const committedRosterData = JSON.parse(JSON.stringify(rosterData));
  committedRosterData.rosters[0].warPerformance = { processedCwlWarTags: { "#WAR1": true } };
  const processedAck = backend.ackFinalizedCwlRuntimeRosterConsumptionFromRosterData_("cwl-active", committedRosterData, "2026-07-05T20:20:00.000Z");
  const clearedRuntime = backend.readCwlRuntime_("cwl-active");

  assert.equal(unprocessedAck.cleared, false);
  assert.equal(retainedRuntime.finalizedAt, "2026-07-05T20:18:00.000Z");
  assert.equal(JSON.stringify(processedAck.acknowledgedClanTags), JSON.stringify(["#CLAN"]));
  assert.equal(processedAck.cleared, true);
  assert.equal(clearedRuntime.finalizedAt, "");
});

test("CWL event-bound clans freeze after bootstrap while other coordinator views remain available", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    events: {
      seasonEvents: {
        currentCwl: { eventId: "cwl-active", type: "cwl" },
        byId: {
          "cwl-active": {
            eventId: "cwl-active",
            type: "cwl",
            status: "open",
            cwlTrackingState: "active",
            cwl: {
              groups: {
                "grp-existing": {
                  groupId: "grp-existing",
                  clanTags: ["#CLAN"],
                  warTags: ["#WAR1"],
                  expectedRounds: 1,
                },
              },
            },
            participantsByDiscordId: {
              "100": { discordId: "100", status: "signed_up", accounts: [{ tag: "#PLAYER", name: "Player" }] },
              "200": { discordId: "200", status: "signed_up", accounts: [{ tag: "#OTHERP", name: "Other" }] },
            },
          },
        },
      },
    },
  });
  const rosterData = backend.validateRosterData_({
    ...buildValidRosterData(),
    publicConfig: { cwlEventTargetPriorityByRosterId: { main: 0 } },
    rosterOrder: ["main", "other"],
    rosters: [
      buildValidRosterData().rosters[0],
      { ...buildValidRosterData().rosters[0], id: "other", connectedClanTag: "#OTHER", main: [{ ...buildValidRosterData().rosters[0].main[0], tag: "#OTHERP", name: "Other" }] },
    ],
    playerMetrics: { schemaVersion: 1, updatedAt: "", byTag: {} },
  });
  backend.writeCwlRuntime_({
    schemaVersion: 1,
    eventId: "cwl-active",
    bootstrapRequired: true,
    bootstrapCompletedAt: "2026-07-05T19:00:00.000Z",
  });
  backend.cocFetchAllByPathEntries_ = (entriesRaw) => {
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    const dataByKey = {};
    for (const entry of entries) {
      if (entry.path.includes("/currentwar/leaguegroup")) {
        dataByKey[entry.key] = entry.key === "#OTHER"
          ? buildOneRoundCwlLeagueGroup({ clanTag: "#OTHER", opponentTag: "#OPP2", warTag: "#WAR2" })
          : buildOneRoundCwlLeagueGroup({ clanTag: "#CLAN", opponentTag: "#OPP", warTag: "#WAR1" });
      } else if (entry.path.includes("/clanwarleagues/wars/")) {
        dataByKey[entry.key] = entry.key === "#WAR2"
          ? buildOneRoundCwlWar({ warTag: "#WAR2", clanTag: "#OTHER", opponentTag: "#OPP2", playerTag: "#OTHERP", stars: 3 })
          : buildOneRoundCwlWar({ warTag: "#WAR1", clanTag: "#CLAN", opponentTag: "#OPP", playerTag: "#PLAYER", stars: 2 });
      }
    }
    return { dataByKey, errorByKey: {}, requestCount: entries.length, batchCount: entries.length ? 1 : 0 };
  };

  const result = backend.refreshCurrentCwlSeasonEventFromSnapshot_(rosterData, {}, { nowIso: "2026-07-05T20:00:00.000Z" });
  const event = backend.readSeasonEventById_("cwl-active");
  const live = backend.readCwlSeasonEventAggregate_("cwl-active", "live");
  const runtime = backend.readCwlRuntime_("cwl-active");

  assert.equal(result.status, "active");
  assert.equal(Object.values(event.cwl.groups).some((group) => group.clanTags.includes("#OTHER")), false);
  assert.equal(live.byTag["#OTHERP"], undefined);
  assert.ok(runtime.roundsByClanTag["#OTHER"]);
});

test("CWL coordinator batches deduped candidate war requests", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    events: {
      seasonEvents: {
        currentCwl: { eventId: "cwl-active", type: "cwl" },
        byId: { "cwl-active": { eventId: "cwl-active", type: "cwl", status: "open", cwlTrackingState: "active", cwl: { groups: {} } } },
      },
    },
  });
  const rosterData = backend.validateRosterData_(buildValidRosterData());
  const warBatchSizes = [];
  backend.cocFetchAllByPathEntries_ = (entriesRaw) => {
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    const dataByKey = {};
    if (entries.some((entry) => String(entry.path || "").includes("/clanwarleagues/wars/"))) warBatchSizes.push(entries.length);
    for (const entry of entries) {
      if (entry.path.includes("/currentwar/leaguegroup")) {
        dataByKey[entry.key] = {
          state: "inWar",
          season: "2026-07",
          clans: [{ tag: "#CLAN", warLeague: { name: "Champion I" } }, { tag: "#OPP" }],
          rounds: [{ warTags: ["#WAR1", "#WAR2", "#WAR1"] }],
        };
      } else if (entry.path.includes("/clanwarleagues/wars/")) {
        dataByKey[entry.key] = entry.key === "#WAR1"
          ? buildOneRoundCwlWar({ warTag: "#WAR1", clanTag: "#AAA", opponentTag: "#BBB" })
          : buildOneRoundCwlWar({ warTag: "#WAR2", clanTag: "#CLAN", opponentTag: "#OPP" });
      }
    }
    return { dataByKey, errorByKey: {}, requestCount: entries.length, batchCount: entries.length ? 1 : 0 };
  };

  const result = backend.buildCwlCoordinatorResult_(rosterData, { nowIso: "2026-07-05T20:00:00.000Z" });

  assert.equal(result.requestCounts.cwlWar, 2);
  assert.deepEqual(warBatchSizes, [2]);
  assert.equal(backend.readCwlRuntime_("cwl-active").roundsByClanTag["#CLAN"]["0"].warTag, "#WAR2");
});

test("CWL completion integrity audit is read-only and guarded recovery atomically reopens only an active bound group", () => {
  const backend = installMemoryFirebase(loadBackend());
  const rosterData = backend.validateRosterData_(buildValidRosterData());
  const nowIso = "2026-07-11T12:00:00.000Z";
  const group = buildOneRoundCwlLeagueGroup({ state: "inWar", season: "2026-07" });
  const groupId = backend.buildCwlRuntimeGroupId_(group);
  const target = {
    resolved: true, status: "resolved", rosterId: "main", rosterTitle: "Main", clanTag: "#CLAN",
    leagueName: "Champion I", leagueRank: 0, groupId, season: "2026-07", groupState: "inwar",
    observedAt: nowIso, boundAt: nowIso, evidenceStatus: "authoritative", evidenceObservationId: "integrity-observation-1", evidenceProvenance: "deterministic-fresh-observation-v1", eligibleAccountTags: ["#PLAYER"],
  };
  const event = {
    eventId: "cwl-false-complete", type: "cwl", status: "closed", signupsOpen: false,
    cwlTrackingState: "completed", updatedAt: "2026-07-11T11:50:00.000Z",
    cwl: { target, groups: { [groupId]: { groupId, season: "2026-07", clanTags: ["#CLAN"], warTags: ["#WAR1"], expectedRounds: 1 } }, finalizedAt: "2026-07-11T11:50:00.000Z" },
    participantsByDiscordId: {}, participantsByTag: {},
  };
  backend.writeSeasonEventFirebasePayload_(backend.buildSeasonEventByIdPath_(event.eventId), "PUT", event);
  backend.writeSeasonEventFirebasePayload_(backend.SEASON_EVENTS_LATEST_COMPLETED_CWL_PATH || "events/seasonEvents/latestCompletedCwl", "PUT", { eventId: event.eventId, type: "cwl" });
  backend.writeSeasonEventFirebasePayload_(backend.buildCwlSeasonEventAggregatePath_(event.eventId, "final"), "PUT", { eventId: event.eventId, kind: "final", byTag: { "#PLAYER": { starsTotal: 3 } }, warTags: ["#WAR1"] });
  backend.readActiveRosterSnapshot_ = () => ({ rosterData });
  const evidence = {
    capturedAt: nowIso, observationId: "integrity-observation-1",
    leaguegroupRawByClanTag: { "#CLAN": group }, leaguegroupErrorByClanTag: {},
    clanDetailsRawByClanTag: { "#CLAN": { warLeague: { name: "Champion I" } } }, clanDetailsErrorByClanTag: {},
  };
  const before = JSON.stringify(backend.__getFirebaseDb());
  const audit = backend.auditCwlSeasonEventCompletionIntegrity_({ eventId: event.eventId, nowIso, freshEvidence: evidence });
  assert.equal(audit.recoverable, true);
  assert.equal(JSON.stringify(backend.__getFirebaseDb()), before);

  const recovered = backend.recoverFalseCompletedCwlSeasonEvent_({ eventId: event.eventId, nowIso, freshEvidence: evidence });
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.publication.lifecycleState, "active");
  assert.equal(backend.readSeasonEventById_(event.eventId).cwlTrackingState, "active");
  assert.equal(backend.readSeasonEventPointer_("events/seasonEvents/current/cwl").eventId, event.eventId);
  assert.equal(backend.readSeasonEventPointer_("events/seasonEvents/currentCwl").eventId, event.eventId);
  assert.equal(backend.readCwlSeasonEventAggregate_(event.eventId, "final"), null);

  const ended = buildOneRoundCwlLeagueGroup({ state: "ended", season: "2026-07" });
  const endedEvidence = { ...evidence, observationId: "integrity-observation-2", leaguegroupRawByClanTag: { "#CLAN": ended } };
  const second = backend.recoverFalseCompletedCwlSeasonEvent_({ eventId: event.eventId, nowIso, freshEvidence: endedEvidence });
  assert.equal(second.recovered, false);
});

test("scheduled reconciliation creates a missing current CWL event from fresh current-season group evidence, including ended discovery", () => {
  for (const state of ["inWar", "ended"]) {
    const backend = installMemoryFirebase(loadBackend());
    const rosterData = backend.validateRosterData_(buildValidRosterData());
    const group = buildOneRoundCwlLeagueGroup({ state, season: "2026-07" });
    backend.readAutoRefreshCoordinatorSourceSnapshot_ = () => ({ rosterData });
    backend.collectFreshCwlTargetEvidence_ = () => ({
      capturedAt: "2026-07-11T12:00:00.000Z", observationId: `scheduled-${state}`,
      leaguegroupRawByClanTag: { "#CLAN": group }, leaguegroupErrorByClanTag: {},
      clanDetailsRawByClanTag: { "#CLAN": { warLeague: { name: "Champion I" } } }, clanDetailsErrorByClanTag: {},
    });
    const result = backend.reconcileMissingCurrentCwlSeasonEvent_({ nowIso: "2026-07-11T12:00:00.000Z" });
    const current = backend.readCurrentCwlSeasonEvent_();
  assert.equal(result.created, true);
  assert.equal(current.cwl.target.groupId, backend.buildCwlRuntimeGroupId_(group));
  assert.equal(current.cwlTrackingState, "active");
  assert.equal(current.signupsOpen, state !== "ended");
  assert.equal(result.publication.lifecycleState, "active");
    assert.equal(backend.readSeasonEventPointer_("events/seasonEvents/currentCwl").eventId, current.eventId);
    assert.equal(backend.readSeasonEventPointer_("events/seasonEvents/current/cwl").eventId, current.eventId);
  }
});

test("scheduled reconciliation does not duplicate an already genuinely completed ended group", () => {
  const backend = installMemoryFirebase(loadBackend());
  const rosterData = buildValidRosterData();
  const nowIso = "2026-07-11T12:00:00.000Z";
  const group = buildOneRoundCwlLeagueGroup({ state: "ended", season: "2026-07" });
  const groupId = backend.buildCwlRuntimeGroupId_(group);
  const completed = {
    eventId: "cwl-completed-group", type: "cwl", status: "closed", signupsOpen: false, cwlTrackingState: "completed", updatedAt: nowIso,
    cwl: { target: { resolved: true, status: "resolved", rosterId: "main", clanTag: "#CLAN", leagueName: "Champion I", leagueRank: 0, groupId, season: "2026-07", observedAt: nowIso, evidenceStatus: "authoritative", evidenceObservationId: "completed-group-observation", evidenceProvenance: "deterministic-fresh-observation-v1", eligibleAccountTags: ["#PLAYER"] }, finalizedAt: nowIso, groups: {} },
    participantsByDiscordId: {}, participantsByTag: {},
  };
  backend.writeSeasonEventFirebasePayload_(backend.buildSeasonEventByIdPath_(completed.eventId), "PUT", completed);
  backend.writeSeasonEventFirebasePayload_("events/seasonEvents/latestCompletedCwl", "PUT", { eventId: completed.eventId, type: "cwl" });
  backend.writeSeasonEventFirebasePayload_(backend.buildCwlSeasonEventAggregatePath_(completed.eventId, "final"), "PUT", { eventId: completed.eventId, kind: "final", byTag: {}, rankedTags: [], warTags: [] });
  backend.readAutoRefreshCoordinatorSourceSnapshot_ = () => ({ rosterData });
  backend.collectFreshCwlTargetEvidence_ = () => ({ capturedAt: nowIso, observationId: "ended-current", leaguegroupRawByClanTag: { "#CLAN": group }, leaguegroupErrorByClanTag: {}, clanDetailsRawByClanTag: {}, clanDetailsErrorByClanTag: {} });
  const result = backend.reconcileMissingCurrentCwlSeasonEvent_({ nowIso });
  assert.equal(result.created, false);
  assert.equal(result.status, "current-cwl-group-already-completed");
  assert.equal(backend.readSeasonEventPointer_("events/seasonEvents/currentCwl"), null);
});

test("CWL lifecycle runtime checkpoint uses a conditional root PUT and preserves unrelated state", () => {
  const event = {
    eventId: "cwl-etag-put",
    type: "cwl",
    status: "open",
    signupsOpen: true,
    cwlTrackingState: "active",
    cwl: {},
    participantsByDiscordId: {},
    participantsByTag: {},
  };
  const backend = installMemoryFirebase(loadBackend(), {
    events: {
      seasonEvents: {
        sentinel: { keep: true },
        byId: { [event.eventId]: event },
        currentCwl: { eventId: event.eventId, type: "cwl" },
        current: { cwl: { eventId: event.eventId, type: "cwl" } },
        cwlAggregates: { byEvent: { [event.eventId]: { live: { eventId: event.eventId, kind: "live" } } } },
      },
    },
  });
  const originalEtagRequest = backend.firebaseRequestJsonWithEtag_;
  const conditionalMethods = [];
  backend.firebaseRequestJsonWithEtag_ = (path, method = "GET", payload, options = {}) => {
    if (options.ifMatch) {
      conditionalMethods.push(String(method).toUpperCase());
      if (String(method).toUpperCase() === "PATCH") throw new Error("Firebase does not support If-Match with PATCH");
    }
    return originalEtagRequest(path, method, payload, options);
  };
  const updatedEvent = { ...event, status: "closed", signupsOpen: false };
  const runtime = backend.createEmptyCwlRuntime_(event.eventId, "2026-08-05T20:00:00.000Z");

  backend.writeSeasonEventAtomicPayloads_([
    { path: backend.buildSeasonEventByIdPath_(event.eventId), payload: updatedEvent },
    { path: backend.buildCwlRuntimePath_(event.eventId), payload: runtime },
    { path: backend.buildCwlSeasonEventAggregatePath_(event.eventId, "live"), payload: null },
  ]);

  assert.deepEqual(conditionalMethods, ["PUT"]);
  assert.equal(backend.__getFirebaseDb().events.seasonEvents.sentinel.keep, true);
  assert.equal(backend.readSeasonEventById_(event.eventId).status, "closed");
  assert.equal(backend.readCwlRuntime_(event.eventId).eventId, event.eventId);
  assert.equal(backend.readCwlSeasonEventAggregate_(event.eventId, "live"), null);
});

test("atomic legacy target reset failure preserves event, aggregates, runtime, and both pointers", () => {
  const backend = installMemoryFirebase(loadBackend());
  const nowIso = "2026-07-11T12:00:00.000Z";
  const rosterData = buildValidRosterData();
  const group = buildOneRoundCwlLeagueGroup({ state: "inWar" });
  const evidence = { capturedAt: nowIso, observationId: "atomic-failure", leaguegroupRawByClanTag: { "#CLAN": group }, leaguegroupErrorByClanTag: {}, clanDetailsRawByClanTag: {}, clanDetailsErrorByClanTag: {} };
  const event = { eventId: "cwl-atomic", type: "cwl", status: "open", signupsOpen: true, cwlTrackingState: "active", updatedAt: nowIso, cwl: { target: { resolved: true, status: "resolved", rosterId: "wrong", clanTag: "#WRONG", leagueName: "Unranked", leagueRank: 99, evidenceStatus: "legacy-unverified", eligibleAccountTags: [] }, groups: {} }, participantsByDiscordId: {}, participantsByTag: {} };
  backend.writeSeasonEventFirebasePayload_(backend.buildSeasonEventByIdPath_(event.eventId), "PUT", event);
  backend.writeSeasonEventFirebasePayload_("events/seasonEvents/currentCwl", "PUT", { eventId: event.eventId });
  backend.writeSeasonEventFirebasePayload_("events/seasonEvents/current/cwl", "PUT", { eventId: event.eventId });
  backend.writeSeasonEventFirebasePayload_("events/seasonEvents/privateCwlRuntime/current", "PUT", backend.createEmptyCwlRuntime_(event.eventId, nowIso));
  backend.writeSeasonEventFirebasePayload_(backend.buildCwlSeasonEventAggregatePath_(event.eventId, "live"), "PUT", { eventId: event.eventId, kind: "live", byTag: {} });
  backend.readActiveRosterSnapshot_ = () => ({ rosterData });
  const before = clone(backend.__getFirebaseDb());
  const originalEtagRequest = backend.firebaseRequestJsonWithEtag_;
  backend.firebaseRequestJsonWithEtag_ = (path, method = "GET", payload, options = {}) => {
    if (String(path) === "events/seasonEvents" && String(method).toUpperCase() === "PUT") throw new Error("injected atomic write failure");
    return originalEtagRequest(path, method, payload, options);
  };
  assert.throws(() => backend.repairLegacyCwlSeasonEventBinding_({ eventId: event.eventId, nowIso, freshEvidence: evidence }), /atomic write failure/);
  assert.deepEqual(backend.__getFirebaseDb(), before);
});

test("legacy CWL binding repair is explicit, revision-guarded, and refuses meaningful activity", () => {
  const backend = installMemoryFirebase(loadBackend());
  const rosterData = backend.validateRosterData_(buildValidRosterData());
  backend.readActiveRosterSnapshot_ = () => ({ rosterData });
  const group = buildOneRoundCwlLeagueGroup({ state: "inWar", season: "2026-07" });
  const evidence = {
    capturedAt: "2026-07-11T12:00:00.000Z", observationId: "repair-observation",
    leaguegroupRawByClanTag: { "#CLAN": group }, leaguegroupErrorByClanTag: {},
    clanDetailsRawByClanTag: { "#CLAN": { warLeague: { name: "Champion I" } } }, clanDetailsErrorByClanTag: {},
  };
  const makeEvent = (id, participants = {}) => ({
    eventId: id, type: "cwl", status: "open", signupsOpen: true, cwlTrackingState: "active",
    cwl: { target: { resolved: true, status: "resolved", rosterId: "legacy", clanTag: "#WRONG", leagueName: "Unranked", leagueRank: 999, evidenceStatus: "legacy", eligibleAccountTags: [] }, groups: {} },
    participantsByDiscordId: participants, participantsByTag: {},
  });
  const repairable = makeEvent("cwl-repairable");
  backend.writeSeasonEventFirebasePayload_(backend.buildSeasonEventByIdPath_(repairable.eventId), "PUT", repairable);
  backend.writeSeasonEventFirebasePayload_("events/seasonEvents/currentCwl", "PUT", { eventId: repairable.eventId, type: "cwl" });
  backend.writeSeasonEventFirebasePayload_("events/seasonEvents/current/cwl", "PUT", { eventId: repairable.eventId, type: "cwl" });
  const fingerprint = backend.buildCwlSeasonEventTargetFingerprint_(repairable.cwl.target);
  const repaired = backend.repairLegacyCwlSeasonEventBinding_({ eventId: repairable.eventId, expectedTargetFingerprint: fingerprint, nowIso: evidence.capturedAt, freshEvidence: evidence });
  assert.equal(repaired.repaired, true);
  assert.equal(repaired.publication.lifecycleState, "waiting");
  assert.equal(backend.readSeasonEventById_(repairable.eventId).cwl.target.clanTag, "#CLAN");

  const scored = makeEvent("cwl-stable", { "100": { discordId: "100", status: "signed_up", accounts: [{ tag: "#PLAYER" }] } });
  backend.writeSeasonEventFirebasePayload_(backend.buildSeasonEventByIdPath_(scored.eventId), "PUT", scored);
  backend.writeSeasonEventFirebasePayload_("events/seasonEvents/currentCwl", "PUT", { eventId: scored.eventId, type: "cwl" });
  backend.writeSeasonEventFirebasePayload_("events/seasonEvents/current/cwl", "PUT", { eventId: scored.eventId, type: "cwl" });
  const refused = backend.repairLegacyCwlSeasonEventBinding_({ eventId: scored.eventId, nowIso: evidence.capturedAt, freshEvidence: evidence });
  assert.equal(refused.repaired, false);
  assert.equal(refused.status, "stable-binding-has-meaningful-activity");
  assert.equal(backend.readSeasonEventById_(scored.eventId).cwl.target.clanTag, "#WRONG");
});

test("CWL target provenance never promotes complete legacy evidence without a fresh observation identity", () => {
  const backend = loadBackend();
  const base = {
    resolved: true, status: "resolved", rosterId: "main", clanTag: "#CLAN", leagueName: "Champion I", leagueRank: 0,
    groupId: "group-1", season: "2026-07", observedAt: "2026-07-11T12:00:00.000Z", eligibleAccountTags: ["#PLAYER"],
  };
  assert.equal(backend.sanitizeCwlSeasonEventTarget_({ ...base, evidenceStatus: "legacy-unverified" }).evidenceStatus, "legacy-unverified");
  assert.equal(backend.sanitizeCwlSeasonEventTarget_({ ...base }).evidenceStatus, "legacy-unverified");
  assert.equal(backend.sanitizeCwlSeasonEventTarget_({ ...base, evidenceStatus: "authoritative" }).evidenceStatus, "legacy-unverified");
  const authoritative = backend.sanitizeCwlSeasonEventTarget_({ ...base, evidenceStatus: "authoritative", evidenceObservationId: "fresh-observation", evidenceProvenance: "deterministic-fresh-observation-v1" });
  assert.equal(authoritative.evidenceStatus, "authoritative");
  assert.equal(authoritative.groupId, "group-1");
});

test("false-completion recovery audits frozen Clan A directly even when Clan B now ranks higher", () => {
  const backend = installMemoryFirebase(loadBackend());
  const nowIso = "2026-07-11T12:00:00.000Z";
  const rosterData = backend.validateRosterData_(buildValidRosterData());
  rosterData.rosters.push({ ...clone(rosterData.rosters[0]), id: "higher", title: "Higher", connectedClanTag: "#HIGH", main: [{ ...clone(rosterData.rosters[0].main[0]), tag: "#HIGHPLAYER" }] });
  rosterData.rosterOrder.push("higher");
  rosterData.publicConfig = { cwlEventTargetPriorityByRosterId: { higher: -100 } };
  const groupA = buildOneRoundCwlLeagueGroup({ clanTag: "#CLAN", leagueName: "Master I", state: "inWar" });
  const groupB = buildOneRoundCwlLeagueGroup({ clanTag: "#HIGH", leagueName: "Champion I", state: "inWar", warTag: "#WAR2" });
  const groupIdA = backend.buildCwlRuntimeGroupId_(groupA);
  const event = {
    eventId: "cwl-frozen-a", type: "cwl", status: "closed", signupsOpen: false, cwlTrackingState: "completed", updatedAt: "2026-07-11T11:50:00.000Z",
    cwl: { target: { resolved: true, status: "resolved", rosterId: "main", clanTag: "#CLAN", leagueName: "Master I", leagueRank: 3, groupId: groupIdA, season: "2026-07", observedAt: nowIso, evidenceStatus: "authoritative", evidenceObservationId: "frozen-a-observation", evidenceProvenance: "deterministic-fresh-observation-v1", eligibleAccountTags: ["#PLAYER"] }, finalizedAt: "2026-07-11T11:50:00.000Z" },
    participantsByDiscordId: {}, participantsByTag: {},
  };
  const evidence = { capturedAt: nowIso, observationId: "fresh-audit", leaguegroupRawByClanTag: { "#CLAN": groupA, "#HIGH": groupB }, leaguegroupErrorByClanTag: {}, clanDetailsRawByClanTag: {}, clanDetailsErrorByClanTag: {} };
  const audit = backend.buildCwlIntegrityAuditResult_(event, rosterData, evidence, nowIso);
  assert.equal(audit.recoverable, true);
  assert.equal(audit.eventId, "cwl-frozen-a");
});

test("strict CWL runtime failures abort coordinator, finalization, repair, and recovery mutations", () => {
  const nowIso = "2026-07-11T12:00:00.000Z";
  const rosterData = buildValidRosterData();
  const group = buildOneRoundCwlLeagueGroup({ state: "inWar" });
  const groupId = (() => { const b = loadBackend(); return b.buildCwlRuntimeGroupId_(group); })();
  const authoritativeTarget = { resolved: true, status: "resolved", rosterId: "main", clanTag: "#CLAN", leagueName: "Champion I", leagueRank: 0, groupId, season: "2026-07", observedAt: nowIso, evidenceStatus: "authoritative", evidenceObservationId: "strict-read-observation", evidenceProvenance: "deterministic-fresh-observation-v1", eligibleAccountTags: ["#PLAYER"] };
  const evidence = { capturedAt: nowIso, observationId: "strict-read-evidence", leaguegroupRawByClanTag: { "#CLAN": group }, leaguegroupErrorByClanTag: {}, clanDetailsRawByClanTag: {}, clanDetailsErrorByClanTag: {} };
  const installFailure = (backend) => {
    const original = backend.firebaseRequestJson_;
    backend.firebaseRequestJson_ = (path, method = "GET", payload) => {
      if (String(path).startsWith("events/seasonEvents/privateCwlRuntime/byEvent/") && String(method).toUpperCase() === "GET") throw new Error("injected runtime GET failure");
      return original(path, method, payload);
    };
  };

  {
    const event = { eventId: "cwl-coordinator", type: "cwl", status: "open", signupsOpen: true, cwlTrackingState: "active", cwl: { target: authoritativeTarget, groups: {} }, participantsByDiscordId: {}, participantsByTag: {} };
    const backend = installMemoryFirebase(loadBackend(), { sentinel: { value: 1 } });
    const before = clone(backend.__getFirebaseDb());
    installFailure(backend);
    assert.throws(() => backend.buildCwlCoordinatorResult_(rosterData, { event, nowIso, prefetchedLeaguegroupRawByClanTag: { "#CLAN": group }, prefetchedLeaguegroupErrorByClanTag: {} }), /runtime for mutation/);
    assert.deepEqual(backend.__getFirebaseDb(), before);
  }
  {
    const event = { eventId: "cwl-finalize", type: "cwl", status: "open", signupsOpen: true, cwlTrackingState: "active", updatedAt: nowIso, cwl: { target: authoritativeTarget, groups: {} }, participantsByDiscordId: {}, participantsByTag: {} };
    const backend = installMemoryFirebase(loadBackend(), { events: { seasonEvents: { currentCwl: { eventId: event.eventId }, current: { cwl: { eventId: event.eventId } }, byId: { [event.eventId]: event } } } });
    const before = clone(backend.__getFirebaseDb());
    installFailure(backend);
    assert.throws(() => backend.publishCwlSeasonEventRefreshResult_(event, event.cwl, { ok: true, aggregate: { eventId: event.eventId, kind: "live", byTag: {}, rankedTags: [], warTags: [] }, hash: "hash", runtimeState: {} }, nowIso), /runtime for mutation/);
    assert.deepEqual(backend.__getFirebaseDb(), before);
  }
  for (const lifecycle of ["repair", "recovery"]) {
    const completed = lifecycle === "recovery";
    const target = completed ? authoritativeTarget : { ...authoritativeTarget, clanTag: "#WRONG", groupId: "", season: "", observedAt: "", evidenceStatus: "legacy-unverified", evidenceObservationId: "" };
    const event = { eventId: `cwl-${lifecycle}`, type: "cwl", status: completed ? "closed" : "open", signupsOpen: !completed, cwlTrackingState: completed ? "completed" : "active", updatedAt: nowIso, cwl: { target, groups: {}, finalizedAt: completed ? nowIso : "" }, participantsByDiscordId: {}, participantsByTag: {} };
    const seasonEvents = { byId: { [event.eventId]: event }, currentCwl: completed ? null : { eventId: event.eventId }, current: completed ? {} : { cwl: { eventId: event.eventId } }, latestCompletedCwl: completed ? { eventId: event.eventId } : null };
    const backend = installMemoryFirebase(loadBackend(), { events: { seasonEvents } });
    backend.readActiveRosterSnapshot_ = () => ({ rosterData });
    const before = clone(backend.__getFirebaseDb());
    installFailure(backend);
    const call = () => completed
      ? backend.recoverFalseCompletedCwlSeasonEvent_({ eventId: event.eventId, nowIso, freshEvidence: evidence })
      : backend.repairLegacyCwlSeasonEventBinding_({ eventId: event.eventId, nowIso, freshEvidence: evidence });
    assert.throws(call, /runtime for mutation/);
    assert.deepEqual(backend.__getFirebaseDb(), before);
  }
});

test("CWL runtime delete rereads after CAS conflict and never deletes a newer owner", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    events: { seasonEvents: {
      currentCwl: { eventId: "cwl-old" },
      current: { cwl: { eventId: "cwl-old" } },
      byId: { "cwl-old": { eventId: "cwl-old", type: "cwl", status: "open", cwlTrackingState: "active", cwl: {} } },
    } },
  });
  backend.writeCwlRuntime_(backend.createEmptyCwlRuntime_("cwl-old", "2026-07-11T12:00:00.000Z"));
  const runtimePath = backend.buildCwlRuntimePath_("cwl-old");
  const originalEtagRequest = backend.firebaseRequestJsonWithEtag_;
  let replaced = false;
  backend.firebaseRequestJsonWithEtag_ = (path, method = "GET", payload, options = {}) => {
    if (!replaced && String(path) === runtimePath && String(method).toUpperCase() === "DELETE") {
      replaced = true;
      backend.firebaseRequestJson_(path, "PUT", backend.encodeFirebaseObjectKeysRecursive_(backend.createEmptyCwlRuntime_("cwl-new", "2026-07-11T12:01:00.000Z")));
      const conflict = new Error("simulated owner replacement");
      conflict.code = "FIREBASE_ETAG_CONFLICT";
      throw conflict;
    }
    return originalEtagRequest(path, method, payload, options);
  };

  assert.equal(backend.clearCwlRuntimeForEvent_("cwl-old"), false);
  const stored = backend.decodeSeasonEventFirebasePayload_(backend.firebaseRequestJson_(runtimePath, "GET"));
  assert.equal(stored.eventId, "cwl-new");
});

test("CWL runtime CAS conflict preserves seven-round topology against a late partial writer", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    events: { seasonEvents: {
      currentCwl: { eventId: "cwl-seven" },
      current: { cwl: { eventId: "cwl-seven" } },
      byId: { "cwl-seven": { eventId: "cwl-seven", type: "cwl", status: "open", cwlTrackingState: "active", cwl: {} } },
    } },
  });
  const initial = backend.createEmptyCwlRuntime_("cwl-seven", "2026-07-11T12:00:00.000Z");
  initial.groups.group = {
    groupId: "group", season: "2026-07", expectedRounds: 1, state: "inWar", observedAt: "2026-07-11T12:00:00.000Z",
    observationSucceeded: true, observedRoundCount: 1, observationTopologyComplete: false,
    roundWarTagsByIndex: { 0: ["#WAR0"] }, clanTags: ["#CLAN"], candidateClanTags: ["#CLAN"], relevantWarTags: ["#WAR0"], materializedRoundIndexes: [0],
  };
  initial.roundsByClanTag["#CLAN"] = { 0: { groupId: "group", roundIndex: 0, warTag: "#WAR0", status: "settled", state: "warEnded", updatedAt: "2026-07-11T12:00:00.000Z" } };
  initial.warRecords["#WAR0|#CLAN"] = { warTag: "#WAR0", clanTag: "#CLAN", groupId: "group", roundIndex: 0, status: "settled", state: "warEnded", contributionHash: "hash-0", settledAt: "2026-07-11T12:00:00.000Z", auditedAt: "2026-07-11T12:00:00.000Z", auditStatus: "matched", lastValidContribution: { warTag: "#WAR0", clanTag: "#CLAN", roundIndex: 0, state: "warEnded", hash: "hash-0", aggregateByTag: {}, historyStatsByTag: {} } };
  backend.writeCwlRuntime_(initial);

  const staleRead = backend.readCwlRuntimeStrict_("cwl-seven");
  const latePartial = staleRead.runtime;
  const complete = clone(staleRead.runtime);
  complete.__firebaseEtag = staleRead.etag;
  complete.groups.group.expectedRounds = 7;
  complete.groups.group.observedRoundCount = 7;
  complete.groups.group.observationTopologyComplete = true;
  complete.groups.group.materializedRoundIndexes = [];
  complete.groups.group.relevantWarTags = [];
  complete.groups.group.roundWarTagsByIndex = {};
  complete.rosterAckByClanTag["#CLAN"] = "2026-07-11T12:07:00.000Z";
  for (let round = 0; round < 7; round++) {
    const warTag = `#WAR${round}`;
    complete.groups.group.materializedRoundIndexes.push(round);
    complete.groups.group.relevantWarTags.push(warTag);
    complete.groups.group.roundWarTagsByIndex[round] = [warTag];
    complete.roundsByClanTag["#CLAN"][round] = { groupId: "group", roundIndex: round, warTag, status: "settled", state: "warEnded", updatedAt: `2026-07-11T12:0${round}:00.000Z` };
    complete.warRecords[`${warTag}|#CLAN`] = { warTag, clanTag: "#CLAN", groupId: "group", roundIndex: round, status: "settled", state: "warEnded", contributionHash: `hash-${round}`, settledAt: `2026-07-11T12:0${round}:00.000Z`, auditedAt: `2026-07-11T12:0${round}:00.000Z`, auditStatus: "matched", lastValidContribution: { warTag, clanTag: "#CLAN", roundIndex: round, state: "warEnded", hash: `hash-${round}`, aggregateByTag: {}, historyStatsByTag: {} } };
  }
  backend.writeCwlRuntime_(complete);
  backend.writeCwlRuntime_(latePartial);

  const stored = backend.readCwlRuntime_("cwl-seven");
  assert.equal(stored.groups.group.expectedRounds, 7);
  assert.equal(stored.groups.group.observationTopologyComplete, true);
  assert.equal(Object.keys(stored.roundsByClanTag["#CLAN"]).length, 7);
  assert.equal(Object.keys(stored.warRecords).length, 7);
  assert.equal(stored.warRecords["#WAR6|#CLAN"].status, "settled");
  assert.equal(stored.warRecords["#WAR6|#CLAN"].auditStatus, "matched");
  assert.equal(stored.rosterAckByClanTag["#CLAN"], "2026-07-11T12:07:00.000Z");
});

test("late CWL runtime response after finalization cannot recreate cleared runtime or live data", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    events: { seasonEvents: {
      currentCwl: { eventId: "cwl-final" },
      current: { cwl: { eventId: "cwl-final" } },
      byId: { "cwl-final": { eventId: "cwl-final", type: "cwl", status: "open", cwlTrackingState: "active", cwl: {} } },
    } },
  });
  backend.writeSeasonEventFirebasePayload_(backend.buildCwlSeasonEventAggregatePath_("cwl-final", "final"), "PUT", { eventId: "cwl-final", kind: "final", byTag: {} });
  backend.writeCwlRuntime_(backend.createEmptyCwlRuntime_("cwl-final", "2026-07-11T12:00:00.000Z"));
  const stale = backend.readCwlRuntimeStrict_("cwl-final").runtime;
  const finalRead = backend.readCwlRuntimeStrict_("cwl-final");
  finalRead.runtime.finalizedAt = "2026-07-11T12:10:00.000Z";
  backend.writeCwlRuntime_(finalRead.runtime);
  assert.equal(backend.clearCwlRuntimeForEvent_("cwl-final"), true);
  backend.writeSeasonEventFirebasePayload_(backend.buildSeasonEventByIdPath_("cwl-final"), "PATCH", { status: "closed", cwlTrackingState: "completed" });
  backend.writeSeasonEventFirebasePayload_("events/seasonEvents/currentCwl", "PUT", null);
  backend.writeSeasonEventFirebasePayload_("events/seasonEvents/current/cwl", "PUT", null);

  const error = captureError(() => backend.writeCwlRuntime_(stale));
  assert.equal(error.code, "CWL_RUNTIME_STALE_EVENT");
  assert.equal(backend.firebaseRequestJson_(backend.buildCwlRuntimePath_("cwl-final"), "GET"), null);
  assert.equal(backend.readCwlSeasonEventAggregate_("cwl-final", "live"), null);
  assert.equal(backend.readCwlSeasonEventAggregate_("cwl-final", "final").eventId, "cwl-final");
});

test("legacy repair removes same-event wrong-target runtime atomically and refuses historical completed events", () => {
  const backend = installMemoryFirebase(loadBackend());
  const nowIso = "2026-07-11T12:00:00.000Z";
  const rosterData = buildValidRosterData();
  backend.readActiveRosterSnapshot_ = () => ({ rosterData });
  const group = buildOneRoundCwlLeagueGroup({ state: "inWar" });
  const evidence = { capturedAt: nowIso, observationId: "repair-reset", leaguegroupRawByClanTag: { "#CLAN": group }, leaguegroupErrorByClanTag: {}, clanDetailsRawByClanTag: {}, clanDetailsErrorByClanTag: {} };
  const repairable = { eventId: "cwl-reset", type: "cwl", status: "open", signupsOpen: true, cwlTrackingState: "active", updatedAt: nowIso, cwl: { target: { resolved: true, status: "resolved", rosterId: "old", clanTag: "#WRONG", leagueName: "Unranked", leagueRank: 99, evidenceStatus: "legacy-unverified", eligibleAccountTags: [] }, groups: {} }, participantsByDiscordId: {}, participantsByTag: {} };
  backend.writeSeasonEventFirebasePayload_(backend.buildSeasonEventByIdPath_(repairable.eventId), "PUT", repairable);
  backend.writeSeasonEventFirebasePayload_("events/seasonEvents/currentCwl", "PUT", { eventId: repairable.eventId });
  backend.writeSeasonEventFirebasePayload_("events/seasonEvents/current/cwl", "PUT", { eventId: repairable.eventId });
  backend.writeSeasonEventFirebasePayload_("events/seasonEvents/privateCwlRuntime/current", "PUT", backend.createEmptyCwlRuntime_(repairable.eventId, nowIso));
  backend.writeSeasonEventFirebasePayload_(backend.buildCwlSeasonEventAggregatePath_(repairable.eventId, "live"), "PUT", { eventId: repairable.eventId, kind: "live", byTag: {} });
  const repaired = backend.repairLegacyCwlSeasonEventBinding_({ eventId: repairable.eventId, nowIso, freshEvidence: evidence });
  assert.equal(repaired.repaired, true);
  assert.equal(backend.firebaseRequestJson_("events/seasonEvents/privateCwlRuntime/current", "GET"), null);
  assert.equal(backend.readCwlSeasonEventAggregate_(repairable.eventId, "live"), null);
  assert.equal(backend.readSeasonEventPointer_("events/seasonEvents/currentCwl").eventId, repairable.eventId);
  assert.equal(backend.readSeasonEventPointer_("events/seasonEvents/current/cwl").eventId, repairable.eventId);

  const historical = { ...clone(repairable), eventId: "cwl-historical", status: "closed", cwlTrackingState: "completed" };
  backend.writeSeasonEventFirebasePayload_(backend.buildSeasonEventByIdPath_(historical.eventId), "PUT", historical);
  const refused = backend.repairLegacyCwlSeasonEventBinding_({ eventId: historical.eventId, nowIso, freshEvidence: evidence });
  assert.equal(refused.repaired, false);
  assert.equal(refused.status, "event-not-current-on-both-pointers");

  const otherBackend = installMemoryFirebase(loadBackend());
  otherBackend.readActiveRosterSnapshot_ = () => ({ rosterData });
  otherBackend.writeSeasonEventFirebasePayload_(otherBackend.buildSeasonEventByIdPath_(repairable.eventId), "PUT", repairable);
  otherBackend.writeSeasonEventFirebasePayload_("events/seasonEvents/currentCwl", "PUT", { eventId: repairable.eventId });
  otherBackend.writeSeasonEventFirebasePayload_("events/seasonEvents/current/cwl", "PUT", { eventId: repairable.eventId });
  const otherRuntime = otherBackend.createEmptyCwlRuntime_("cwl-other-owner", nowIso);
  otherBackend.writeSeasonEventFirebasePayload_("events/seasonEvents/privateCwlRuntime/current", "PUT", otherRuntime);
  const preserved = otherBackend.repairLegacyCwlSeasonEventBinding_({ eventId: repairable.eventId, nowIso, freshEvidence: evidence });
  assert.equal(preserved.repaired, true);
  assert.equal(otherBackend.readCwlRuntimeStrict_(repairable.eventId).status, "absent");
  assert.equal(otherBackend.decodeSeasonEventFirebasePayload_(otherBackend.firebaseRequestJson_("events/seasonEvents/privateCwlRuntime/current", "GET")).eventId, "cwl-other-owner");
});

test("fresh CWL evidence avoids clan-detail requests when successful group evidence already contains ranking", () => {
  const backend = loadBackend();
  const rosterData = buildValidRosterData();
  rosterData.rosters.push({ ...clone(rosterData.rosters[0]), id: "second", connectedClanTag: "#SECOND", main: [{ ...clone(rosterData.rosters[0].main[0]), tag: "#SECONDPLAYER" }] });
  rosterData.rosterOrder.push("second");
  const paths = [];
  backend.cocFetchAllByPathEntries_ = (entriesRaw) => {
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    const dataByKey = {};
    for (const entry of entries) {
      paths.push(entry.path);
      if (entry.path.includes("leaguegroup")) dataByKey[entry.key] = buildOneRoundCwlLeagueGroup({ clanTag: entry.key, leagueName: entry.key === "#CLAN" ? "Champion I" : "Master I", warTag: entry.key === "#CLAN" ? "#WAR1" : "#WAR2" });
      else throw new Error(`avoidable clan-detail request: ${entry.path}`);
    }
    return { dataByKey, errorByKey: {}, requestCount: entries.length, batchCount: entries.length ? 1 : 0 };
  };
  const evidence = backend.collectFreshCwlTargetEvidence_(rosterData, { nowIso: "2026-07-11T12:00:00.000Z" });
  assert.equal(evidence.requestCounts.leagueGroup, 2);
  assert.equal(evidence.requestCounts.clanDetails, 0);
  assert.equal(evidence.requestCounts.total, 2);
  assert.equal(paths.filter((path) => path.includes("/clans/") && !path.includes("leaguegroup")).length, 0);
});

test("CWL lifecycle descriptors map waiting, active, finalizing, and completion to exact canonical categories", () => {
  const backend = loadBackend();
  const waiting = backend.buildCwlLifecyclePublicationDescriptor_("cwl-1", "waiting");
  const active = backend.buildCwlLifecyclePublicationDescriptor_("cwl-1", "active");
  const finalizing = backend.buildCwlLifecyclePublicationDescriptor_("cwl-1", "finalizing");
  const completed = backend.buildCwlLifecyclePublicationDescriptor_("cwl-1", "completed");
  assert.deepEqual({ event: waiting.eventAction, live: waiting.liveAggregateAction, final: waiting.finalAggregateAction, pointers: waiting.pointerAction }, { event: "put", live: "delete", final: "delete", pointers: "put" });
  assert.deepEqual({ live: active.liveAggregateAction, final: active.finalAggregateAction }, { live: "put", final: "delete" });
  assert.deepEqual({ live: finalizing.liveAggregateAction, final: finalizing.finalAggregateAction }, { live: "put", final: "delete" });
  assert.deepEqual({ live: completed.liveAggregateAction, final: completed.finalAggregateAction, pointers: completed.pointerAction }, { live: "delete", final: "put", pointers: "put" });
});

test("ensure-current CWL creation uses the shared waiting lifecycle publication and both pointers", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: buildValidRosterData() });
  const result = backend.ensureCurrentCwlSeasonEvent({}, "secret");
  assert.equal(result.created, true);
  assert.equal(result.publication.lifecycleState, "waiting");
  assert.equal(backend.readSeasonEventPointer_("events/seasonEvents/currentCwl").eventId, result.event.eventId);
  assert.equal(backend.readSeasonEventPointer_("events/seasonEvents/current/cwl").eventId, result.event.eventId);
});

test("CWL current-pointer migration is idempotent and preserves the valid newer event", () => {
  const backend = installMemoryFirebase(loadBackend());
  const older = { eventId: "cwl-older", type: "cwl", status: "open", cwlTrackingState: "active", createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z", cwl: {}, participantsByDiscordId: {}, participantsByTag: {} };
  const newer = { ...clone(older), eventId: "cwl-newer", createdAt: "2026-07-02T00:00:00.000Z", updatedAt: "2026-07-02T00:00:00.000Z" };
  backend.writeSeasonEventFirebasePayload_(backend.buildSeasonEventByIdPath_(older.eventId), "PUT", older);
  backend.writeSeasonEventFirebasePayload_(backend.buildSeasonEventByIdPath_(newer.eventId), "PUT", newer);
  backend.writeSeasonEventFirebasePayload_("events/seasonEvents/currentCwl", "PUT", { eventId: older.eventId });
  backend.writeSeasonEventFirebasePayload_("events/seasonEvents/current/cwl", "PUT", { eventId: newer.eventId });
  const repaired = backend.repairCwlCurrentPointerRepresentations_();
  const repeated = backend.repairCwlCurrentPointerRepresentations_();
  assert.equal(repaired.changed, true);
  assert.equal(repeated.changed, false);
  assert.equal(backend.readSeasonEventPointer_("events/seasonEvents/currentCwl").eventId, newer.eventId);
  assert.equal(backend.readSeasonEventPointer_("events/seasonEvents/current/cwl").eventId, newer.eventId);
});

test("unsafe legacy active version ids are read by their exact encoded key and republished without switching the selector", () => {
  const unsafeIds = ["legacy.one", "legacy#hash", "legacy/path", "legacy[brackets]", "__FB64__literal"];
  for (let unsafeIndex = 0; unsafeIndex < unsafeIds.length; unsafeIndex++) {
    const legacyId = unsafeIds[unsafeIndex];
    const backend = installMemoryFirebase(loadBackend());
    backend.createMigratedActiveVersionId_ = () => `legacy-migration-${unsafeIndex}`;
    const rosterData = backend.validateRosterData_(buildValidRosterData());
    const manifest = backend.buildActiveVersionManifestFromValidatedData_("placeholder", rosterData, { source: "test" });
    manifest.rosterIds = ["main"];
    backend.firebaseRequestJson_(backend.buildRawLegacyActiveVersionPath_(legacyId, "manifest"), "PUT", backend.encodeFirebaseObjectKeysRecursive_(manifest));
    backend.firebaseRequestJson_(backend.buildRawLegacyActiveVersionPath_(legacyId, "rosters/main"), "PUT", backend.encodeFirebaseObjectKeysRecursive_(rosterData.rosters[0]));
    backend.firebaseRequestJson_(backend.buildRawLegacyActiveVersionPath_(legacyId, "playerMetrics"), "PUT", backend.encodeFirebaseObjectKeysRecursive_(rosterData.playerMetrics));
    backend.firebaseRequestJson_("activePublished/currentVersionId", "PUT", "known-good");

    const migration = backend.migrateUnsafeCloudflareActiveVersion_(legacyId, "test");
    assert.equal(migration.migrated, true);
    assert.equal(backend.isSafeActiveVersionId_(migration.versionId), true);
    assert.equal(backend.readActiveRosterSnapshotFromVersion_(migration.versionId).rosterData.rosters[0].id, "main");
    assert.equal(backend.firebaseRequestJson_("activePublished/currentVersionId", "GET"), "known-good");
    assert.equal(backend.buildRawLegacyActiveVersionPath_(legacyId, "manifest").includes(backend.encodeFirebaseObjectKey_(legacyId)), true);
  }
});

test("war follow-up state is authenticated, private, and independent from roster publication", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    activePublished: { currentVersionId: "keep-this-version" },
    internal: { cloudflarePublish: { sentinel: "untouched" } },
  });

  assert.throws(
    () => backend.runAdminApiMethod_("getWarFollowupState", ["wrong"]),
    /Authentication failed/,
  );

  const settings = backend.runAdminApiMethod_("saveWarFollowupSettings", [{
    regularLookbackWars: 99,
    regularMissedThreshold: 2,
    regularPerformanceEnabled: false,
    cwlLookbackSeasons: 2,
    defaultRecoveryWars: 4,
    missingDiscordEnabled: true,
    moderatorNames: ["Alex", "Alex", " Sam "],
    trustedPlayerTags: ["#P0LYGQ", " P0LYGQ ", "invalid"],
  }, "change-me"]);
  assert.equal(settings.regularLookbackWars, 8);
  assert.equal(settings.regularPerformanceEnabled, false);
  assert.deepEqual(Array.from(settings.moderatorNames), ["Alex", "Sam"]);
  assert.deepEqual(Array.from(settings.trustedPlayerTags), [], "rules saves must not edit ignored accounts");

  backend.runAdminApiMethod_("setWarFollowupTrustedAccount", ["#P0LYGQ", true, "change-me"]);
  const initialTrust = backend.runAdminApiMethod_("getWarFollowupTrustStatus", ["#P0LYGQ", "change-me"]);
  assert.equal(initialTrust.trusted, true);
  const addedTrust = backend.runAdminApiMethod_("setWarFollowupTrustedAccount", ["#P0LYGJ", true, "change-me"]);
  assert.equal(addedTrust.trusted, true);
  const removedTrust = backend.runAdminApiMethod_("setWarFollowupTrustedAccount", ["#P0LYGQ", false, "change-me"]);
  assert.equal(removedTrust.trusted, false);

  const legacySettingsSave = backend.runAdminApiMethod_("saveWarFollowupSettings", [{
    regularMissedThreshold: 3,
    trustedPlayerTags: ["#P0LYGQ"],
  }, "change-me"]);
  assert.deepEqual(
    Array.from(legacySettingsSave.trustedPlayerTags),
    ["#P0LYGJ"],
    "a cached older Rules form must not replace dedicated trust decisions",
  );

  const db = backend.__getFirebaseDb();
  assert.equal(db.activePublished.currentVersionId, "keep-this-version");
  assert.equal(db.internal.cloudflarePublish.sentinel, "untouched");
  assert.ok(db.private.warFollowup.v1.settings);
  assert.deepEqual(Object.keys(db).sort(), ["activePublished", "internal", "private"]);

  const state = backend.runAdminApiMethod_("getWarFollowupState", ["change-me"]);
  assert.equal(state.settings.defaultRecoveryWars, 4);
  assert.deepEqual(Array.from(state.settings.trustedPlayerTags), ["#P0LYGJ"]);
  assert.deepEqual(Array.from(state.cases), []);
});

test("war follow-up trust retries cannot overwrite a newer opposite decision", () => {
  const backend = installMemoryFirebase(loadBackend());
  const tag = "#P0LYGQ";
  const ignored = backend.runAdminApiMethod_("setWarFollowupTrustedAccount", [
    tag,
    true,
    "change-me",
    "trust-operation-ignore",
  ]);
  assert.equal(ignored.trusted, true);

  const restored = backend.runAdminApiMethod_("setWarFollowupTrustedAccount", [
    tag,
    false,
    "change-me",
    "trust-operation-restore",
  ]);
  assert.equal(restored.trusted, false);

  const tagAlphabet = "PYLQGRJCUV0289";
  for (let index = 0; index < 40; index++) {
    const unrelatedTag = "#Q" +
      tagAlphabet[Math.floor(index / tagAlphabet.length)] +
      tagAlphabet[index % tagAlphabet.length] +
      "P";
    backend.runAdminApiMethod_("setWarFollowupTrustedAccount", [
      unrelatedTag,
      true,
      "change-me",
      "unrelated-trust-operation-" + index,
    ]);
  }

  const lateRetry = backend.runAdminApiMethod_("setWarFollowupTrustedAccount", [
    tag,
    true,
    "change-me",
    "trust-operation-ignore",
  ]);
  assert.equal(
    lateRetry.trusted,
    false,
    "a delayed replay must not reapply its superseded value after many unrelated writes",
  );
  assert.equal(
    backend.runAdminApiMethod_("getWarFollowupTrustStatus", [tag, "change-me"]).trusted,
    false,
  );
  const committedStatus = backend.runAdminApiMethod_("getWarFollowupTrustStatus", [
    tag,
    "change-me",
    "trust-operation-ignore",
  ]);
  assert.equal(committedStatus.committed, true);
  assert.equal(committedStatus.trusted, false, "reconciliation returns the current truth after a superseding change");

  assert.throws(
    () => backend.runAdminApiMethod_("setWarFollowupTrustedAccount", [
      tag,
      true,
      "change-me",
      "trust-operation-restore",
    ]),
    /already used for another change/,
  );
  const state = backend.runAdminApiMethod_("getWarFollowupState", ["change-me"]);
  assert.equal(Object.prototype.hasOwnProperty.call(state.settings, "trustMutationLedger"), false);
});

test("war follow-up rules reject stale forms without conflicting with trust updates", () => {
  const backend = installMemoryFirebase(loadBackend());
  const first = backend.runAdminApiMethod_("saveWarFollowupSettings", [{
    regularMissedThreshold: 2,
  }, "change-me", "", "rules-operation-first"]);
  assert.ok(first.rulesUpdatedAt);
  const firstReplay = backend.runAdminApiMethod_("saveWarFollowupSettings", [{
    regularMissedThreshold: 8,
  }, "change-me", "", "rules-operation-first"]);
  assert.equal(firstReplay.regularMissedThreshold, 2, "an interrupted response can retry without applying twice");

  backend.runAdminApiMethod_("setWarFollowupTrustedAccount", [
    "#P0LYGQ",
    true,
    "change-me",
    "rules-race-trust",
  ]);
  const second = backend.runAdminApiMethod_("saveWarFollowupSettings", [{
    regularMissedThreshold: 3,
  }, "change-me", first.rulesUpdatedAt, "rules-operation-second"]);
  assert.equal(second.regularMissedThreshold, 3);
  assert.deepEqual(Array.from(second.trustedPlayerTags), ["#P0LYGQ"]);
  const lateFirstReplay = backend.runAdminApiMethod_("saveWarFollowupSettings", [{
    regularMissedThreshold: 7,
  }, "change-me", "", "rules-operation-first"]);
  assert.equal(lateFirstReplay.regularMissedThreshold, 3, "an older replay must not replace newer rules");

  assert.throws(
    () => backend.runAdminApiMethod_("saveWarFollowupSettings", [{
      regularMissedThreshold: 4,
    }, "change-me", first.rulesUpdatedAt, "rules-operation-stale"]),
    /rules changed since they were opened/,
  );
  const committed = backend.runAdminApiMethod_("getWarFollowupRulesStatus", [
    "rules-operation-first",
    "change-me",
  ]);
  assert.equal(committed.committed, true);
  assert.equal(committed.settings.regularMissedThreshold, 3);
  assert.equal(Object.prototype.hasOwnProperty.call(committed.settings, "rulesMutationLedger"), false);
  const rejected = backend.runAdminApiMethod_("getWarFollowupRulesStatus", [
    "rules-operation-stale",
    "change-me",
  ]);
  assert.equal(rejected.committed, false);
  assert.throws(
    () => backend.runAdminApiMethod_("getWarFollowupRulesStatus", ["rules-operation-first", "wrong"]),
    /Authentication failed/,
  );
  const state = backend.runAdminApiMethod_("getWarFollowupState", ["change-me"]);
  assert.equal(state.settings.regularMissedThreshold, 3);
  assert.deepEqual(Array.from(state.settings.trustedPlayerTags), ["#P0LYGQ"]);
  assert.equal(Object.prototype.hasOwnProperty.call(state.settings, "rulesMutationLedger"), false);
});

test("war follow-up case lifecycle preserves evidence, DM handoff, ownership, and private history", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    activePublished: { currentVersionId: "v-existing" },
  });
  const tag = "#P0LYGQ";
  const evidence = {
    capturedAt: "2026-07-20T00:00:00.000Z",
    regular: { warCount: 3, possibleAttacks: 6, usedAttacks: 4, missedAttacks: 2, countedAttacks: 4, starsTotal: 7, totalDestruction: 278 },
    cwl: { warCount: 2, possibleAttacks: 2, usedAttacks: 2, missedAttacks: 0, countedAttacks: 2, starsTotal: 4, totalDestruction: 151 },
    regularEvents: [{
      id: "regular-1",
      label: "War 1",
      at: "2026-07-20T00:00:00.000Z",
      clanTag: "#MAIN",
      stats: { possibleAttacks: 2, usedAttacks: 0, missedAttacks: 2 },
    }],
    cwlEvents: [],
  };

  const decided = backend.runAdminApiMethod_("mutateWarFollowupCase", [{
    action: "hero_down",
    tag,
    name: "Player",
    sourceRosterId: "main",
    sourceRosterTitle: "Main clan",
    sourceClanTag: "#MAIN",
    targetRosterId: "training",
    targetRosterTitle: "Hero-down clan",
    targetClanTag: "#TRAIN",
    handledBy: "Alex",
    reasonCodes: ["regular_missed"],
    evidence,
    dmText: "Specific moderation DM.",
    recoveryWarTarget: 3,
    requireNoMisses: true,
    signalIds: ["regular_missed:event"],
  }, "change-me"]);
  assert.equal(decided.status, "needs_dm");
  assert.equal(decided.handledBy, "Alex");
  assert.equal(decided.evidence.regular.missedAttacks, 2);
  assert.equal(decided.activity[0].type, "hero_down_decision");

  const sent = backend.runAdminApiMethod_("mutateWarFollowupCase", [{
    action: "mark_dm_sent",
    tag,
    actor: "Alex",
    expectedUpdatedAt: decided.updatedAt,
    dmText: "Specific moderation DM.",
  }, "change-me"]);
  assert.equal(sent.status, "hero_down");
  assert.ok(sent.dmSentAt);
  assert.equal(sent.activity.at(-1).type, "dm_sent");

  const noted = backend.runAdminApiMethod_("mutateWarFollowupCase", [{
    action: "add_note",
    tag,
    actor: "Sam",
    expectedUpdatedAt: sent.updatedAt,
    note: "Player acknowledged the decision.",
  }, "change-me"]);
  assert.equal(noted.activity.at(-1).text, "Player acknowledged the decision.");
  assert.equal(noted.status, "hero_down");

  const closed = backend.runAdminApiMethod_("mutateWarFollowupCase", [{
    action: "approve_return",
    tag,
    actor: "Alex",
    expectedUpdatedAt: noted.updatedAt,
    signalIds: ["regular_missed:event"],
  }, "change-me"]);
  assert.equal(closed.status, "closed");
  assert.equal(closed.outcome, "approved_return");
  assert.equal(closed.activity.at(-1).type, "approved_return");

  assert.throws(
    () => backend.runAdminApiMethod_("mutateWarFollowupCase", [{
      action: "reopen",
      tag,
      expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
    }, "change-me"]),
    /changed since it was opened/,
  );

  const state = backend.runAdminApiMethod_("getWarFollowupState", ["change-me"]);
  assert.equal(state.cases.length, 1);
  assert.equal(state.cases[0].tag, tag);
  assert.equal(backend.__getFirebaseDb().activePublished.currentVersionId, "v-existing");
  assert.equal(backend.__getFirebaseDb().internal, undefined);
});

test("war follow-up mutations are idempotent and enforce exact optional case versions", () => {
  const backend = installMemoryFirebase(loadBackend());
  const tag = "#P0LYGQ";

  assert.throws(
    () => backend.runAdminApiMethod_("getWarFollowupCase", [tag, "wrong"]),
    /Authentication failed/,
  );
  assert.equal(
    backend.runAdminApiMethod_("getWarFollowupCase", [tag, "change-me"]),
    null,
  );

  const created = backend.runAdminApiMethod_("mutateWarFollowupCase", [{
    action: "manual_review",
    tag,
    name: "Player",
    expectedUpdatedAt: "",
    mutationId: "client-operation-1",
  }, "change-me"]);
  assert.equal(created.status, "needs_review");
  assert.equal(created.activity.length, 1);
  assert.deepEqual(
    Array.from(created.mutationLedger, (entry) => entry.mutationId),
    ["client-operation-1"],
  );

  assert.throws(
    () => backend.runAdminApiMethod_("mutateWarFollowupCase", [{
      action: "reopen",
      tag,
      expectedUpdatedAt: "",
      mutationId: "client-operation-2",
    }, "change-me"]),
    /changed since it was opened/,
    "an explicit empty version is a create-only precondition",
  );

  const retry = backend.runAdminApiMethod_("mutateWarFollowupCase", [{
    action: "manual_review",
    tag,
    name: "Player",
    expectedUpdatedAt: "",
    mutationId: "client-operation-1",
  }, "change-me"]);
  assert.equal(retry.updatedAt, created.updatedAt);
  assert.equal(retry.activity.length, 1, "a retry must not append duplicate activity");

  assert.throws(
    () => backend.runAdminApiMethod_("mutateWarFollowupCase", [{
      action: "close",
      tag,
      mutationId: "client-operation-1",
    }, "change-me"]),
    /already used for another action/,
  );

  const legacy = backend.runAdminApiMethod_("mutateWarFollowupCase", [{
    action: "add_note",
    tag,
    note: "Legacy callers may omit expectedUpdatedAt.",
  }, "change-me"]);
  assert.equal(legacy.activity.at(-1).text, "Legacy callers may omit expectedUpdatedAt.");

  assert.throws(
    () => backend.runAdminApiMethod_("mutateWarFollowupCase", [{
      action: "manual_review",
      tag: "#P0LYGJ",
      expectedUpdatedAt: created.updatedAt,
      mutationId: "client-operation-3",
    }, "change-me"]),
    /changed since it was opened/,
    "a timestamp cannot create a case that no longer matches its expected existence",
  );

  const current = backend.runAdminApiMethod_("getWarFollowupCase", [tag, "change-me"]);
  assert.equal(current.updatedAt, legacy.updatedAt);
  assert.equal(current.activity.length, 2);
  const workspaceState = backend.runAdminApiMethod_("getWarFollowupState", ["change-me"]);
  assert.equal(
    Object.prototype.hasOwnProperty.call(workspaceState.cases[0], "mutationLedger"),
    false,
    "normal workspace loads must not carry internal retry metadata",
  );
});

test("war follow-up mutation id ledger stays bounded and deduplicates after later updates", () => {
  const backend = installMemoryFirebase(loadBackend());
  const tag = "#P0LYGQ";
  let current = backend.runAdminApiMethod_("mutateWarFollowupCase", [{
    action: "manual_review",
    tag,
    expectedUpdatedAt: "",
    mutationId: "bounded-0",
  }, "change-me"]);

  for (let i = 1; i <= 45; i++) {
    current = backend.runAdminApiMethod_("mutateWarFollowupCase", [{
      action: "add_note",
      tag,
      expectedUpdatedAt: current.updatedAt,
      mutationId: `bounded-${i}`,
      note: `Note ${i}`,
    }, "change-me"]);
  }
  assert.equal(current.mutationLedger.length, 16);
  assert.equal(current.mutationLedger[0].mutationId, "bounded-30");
  assert.equal(current.mutationLedger.at(-1).mutationId, "bounded-45");

  const beforeRetryActivity = current.activity.length;
  const retried = backend.runAdminApiMethod_("mutateWarFollowupCase", [{
    action: "add_note",
    tag,
    expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
    mutationId: "bounded-45",
    note: "This must not be added twice.",
  }, "change-me"]);
  assert.equal(retried.updatedAt, current.updatedAt);
  assert.equal(retried.activity.length, beforeRetryActivity);
  assert.equal(retried.activity.at(-1).text, "Note 45");
});
