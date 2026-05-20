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

const clone = (value) => JSON.parse(JSON.stringify(value));

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
    donationMonths: {},
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
    donationMonths: {},
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
    donationMonths: {},
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
    donationMonths: {},
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
    donationMonths: {},
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
      donationMonths: {},
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
