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
  "script/benchPlanner.js",
  "script/seasonEvents.js",
  "script/cloudflarePublishQueue.js",
  "script/publishAndTriggers.js",
  "script/authAndLocks.js",
  "script/adminApi.js",
  "script/entrypoints.js",
  "script/legacyCompat.js",
  "script/debugTools.js",
  "script/assets.js",
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

const buildRosterData = () => ({
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
    byTag: {},
  },
});

const addMetricEntry = (backend, rosterData, tag = "#PLAYER") => {
  const store = backend.ensureMutablePlayerMetricsStoreWithoutSanitize_(rosterData);
  store.byTag[tag] = {
    identity: { tag, name: "Player" },
    latestSnapshot: {
      tag,
      name: "Player",
      trophies: 5000,
      donations: 10,
      donationsReceived: 5,
      capturedAt: "2026-05-19T03:00:00.000Z",
    },
    trophyHistoryDaily: [],
  };
  return store.byTag[tag];
};

test("captureMemberTrackingForRoster can defer final playerMetrics sanitize", () => {
  const backend = loadBackend();
  const data = buildRosterData();
  const originalEnsure = backend.ensurePlayerMetricsStore_;
  let ensureCalls = 0;
  backend.ensurePlayerMetricsStore_ = (rosterData) => {
    ensureCalls++;
    return originalEnsure(rosterData);
  };
  backend.captureConnectedClanMetrics_ = (rosterData) => {
    addMetricEntry(backend, rosterData);
    return {
      attemptedClans: 1,
      capturedClans: 1,
      recorded: 1,
      updated: 1,
      errors: [],
      entryCount: 1,
      capturedTags: ["#PLAYER"],
      deferredSanitize: true,
    };
  };

  const result = backend.captureMemberTrackingForRoster_(data, "main", {
    runState: { seenClanTags: {}, metricsStorePrepared: true },
    deferFinalStoreSanitize: true,
  });

  assert.equal(ensureCalls, 0);
  assert.equal(result.deferredFinalSanitize, true);
  assert.equal(result.recorded, 1);
  assert.ok(data.playerMetrics.byTag["#PLAYER"]);
});

test("captureMemberTrackingForRoster keeps manual final sanitize fallback", () => {
  const backend = loadBackend();
  const data = buildRosterData();
  const originalEnsure = backend.ensurePlayerMetricsStore_;
  let ensureCalls = 0;
  backend.ensurePlayerMetricsStore_ = (rosterData) => {
    ensureCalls++;
    return originalEnsure(rosterData);
  };
  backend.captureConnectedClanMetrics_ = (rosterData) => {
    addMetricEntry(backend, rosterData);
    return {
      attemptedClans: 1,
      capturedClans: 1,
      recorded: 1,
      updated: 1,
      errors: [],
      entryCount: 1,
      capturedTags: ["#PLAYER"],
      deferredSanitize: true,
    };
  };

  const result = backend.captureMemberTrackingForRoster_(data, "main", {
    runState: { seenClanTags: {}, metricsStorePrepared: true },
  });

  assert.equal(ensureCalls, 1);
  assert.equal(result.deferredFinalSanitize, false);
  assert.equal(result.recorded, 1);
});

test("refresh tracking metrics capture does not mutate donation cycles", () => {
  const backend = loadBackend();
  const data = buildRosterData();
  backend.fetchClanMembersSnapshot_ = (clanTag) => ({
    clanTag,
    capturedAt: "2026-05-25T00:00:00.000Z",
    members: [{ tag: "#PLAYER", name: "Player", townHallLevel: 16 }],
    metricsMembers: [{ tag: "#PLAYER", name: "Player", trophies: 5100, donations: 120, donationsReceived: 30 }],
  });

  const result = backend.captureMemberTrackingForRoster_(data, "main", {
    runState: { seenClanTags: {}, metricsStorePrepared: true },
    skipDonationCycles: true,
  });
  const entry = data.playerMetrics.byTag["#PLAYER"];

  assert.equal(result.recorded, 1);
  assert.equal(entry.latestSnapshot.donations, 120);
  assert.equal(JSON.stringify(entry.donationCycles), "{}");
  assert.equal(entry.lastSeen.donationCycleKey, undefined);
});

test("refreshTrackingStatsCore fast mode preserves captured metrics without post-capture validate", () => {
  const backend = loadBackend();
  const data = buildRosterData();
  let validateCalls = 0;
  backend.validateRosterData_ = () => {
    validateCalls++;
    throw new Error("unexpected validate in fast mode");
  };
  backend.captureMemberTrackingForRoster_ = (rosterData, rosterId, options) => {
    assert.equal(options.skipDonationCycles, true);
    addMetricEntry(backend, rosterData, "#NEW");
    return {
      attemptedClans: 1,
      capturedClans: 1,
      recorded: 1,
      updated: 1,
      errors: [],
      entryCount: 1,
      captureTimingMs: { primary: 0, finalize: 0, total: 0 },
      deferredFinalSanitize: true,
    };
  };
  backend.refreshCwlStatsCore_ = () => {
    throw new Error("planned CWL failure");
  };

  const result = backend.refreshTrackingStatsCore_(data, "main", {
    autoRefreshFinalValidationMode: true,
    metricsRunState: { seenClanTags: {}, metricsStorePrepared: true },
  });

  assert.equal(result.ok, false);
  assert.equal(result.result.partialFailure, true);
  assert.equal(result.result.memberTrackingPreserved, true);
  assert.equal(validateCalls, 0);
  assert.ok(data.playerMetrics.byTag["#NEW"]);
});

test("refresh step finalizer validates manual returns and skips fast-mode full validation", () => {
  const backend = loadBackend();
  const data = buildRosterData();
  const originalValidate = backend.validateRosterData_;
  let validateCalls = 0;
  backend.validateRosterData_ = (rosterData) => {
    validateCalls++;
    return originalValidate(rosterData);
  };

  const manual = backend.finalizeRefreshStepRosterDataForReturn_(data, {}, "manual");
  assert.equal(validateCalls, 1);
  assert.notEqual(manual, data);

  const fast = backend.finalizeRefreshStepRosterDataForReturn_(data, {
    autoRefreshFinalValidationMode: true,
  }, "fast");
  assert.equal(validateCalls, 1);
  assert.equal(fast, data);
});
