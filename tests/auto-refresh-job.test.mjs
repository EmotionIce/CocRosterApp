import assert from "node:assert/strict";
import crypto from "node:crypto";
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
  "script/rosterSync.gs",
  "script/benchPlanner.gs",
  "script/seasonEvents.gs",
  "script/publishAndTriggers.gs",
  "script/authAndLocks.gs",
  "script/adminApi.gs",
  "script/entrypoints.gs",
  "script/legacyCompat.gs",
  "script/debugTools.gs",
  "script/assets.gs",
];

const loadBackend = () => {
  const code = appScriptFiles
    .map((file) => fs.readFileSync(new URL(file, repoRoot), "utf8"))
    .join("\n");
  const properties = new Map([["DISCORD_BOT_API_SECRET", "secret"]]);
  const triggers = [];
  const makeTrigger = (handler) => ({
    id: "trigger-" + (triggers.length + 1),
    handler,
    getUniqueId() { return this.id; },
    getHandlerFunction() { return this.handler; },
  });
  const context = {
    Buffer,
    Date,
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
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger(trigger) {
        const index = triggers.indexOf(trigger);
        if (index >= 0) triggers.splice(index, 1);
      },
      newTrigger(handler) {
        return {
          timeBased() {
            const create = () => {
              const trigger = makeTrigger(handler);
              triggers.push(trigger);
              return trigger;
            };
            return {
              after: () => ({ create }),
              at: () => ({ create }),
              everyHours: () => ({ create }),
            };
          },
        };
      },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" },
      Charset: { UTF_8: "UTF-8" },
      computeDigest(_algorithm, value) {
        return Array.from(crypto.createHash("sha256").update(String(value), "utf8").digest())
          .map((byte) => byte > 127 ? byte - 256 : byte);
      },
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
  context.__properties = properties;
  context.__triggers = triggers;
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

const buildRosterData = () => ({
  schemaVersion: 1,
  pageTitle: "Roster",
  rosterOrder: ["main", "second"],
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
    {
      id: "second",
      title: "Second",
      connectedClanTag: "#CLAN2",
      trackingMode: "cwl",
      main: [],
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

const setupQueueRun = (backend, sourceDataRaw, options = {}) => {
  const data = backend.validateRosterData_(sourceDataRaw || buildRosterData());
  const runId = options.runId || "run-1";
  const rosterIds = options.rosterIds || ["main"];
  const startedAt = options.startedAt || "2026-05-25T00:00:00.000Z";
  const sourceFingerprint = backend.buildActiveRosterSourceFingerprintValidated_(data);
  backend.writeAutoRefreshRunSourceShards_(runId, data, sourceFingerprint, { rosterIds });
  const tasks = backend.buildAutoRefreshQueueTasks_(runId, rosterIds);
  const taskIds = backend.writeAutoRefreshQueueTasks_(runId, tasks);
  const current = backend.writeAutoRefreshQueueCurrent_({
    runId,
    kind: "auto-refresh-queue",
    status: options.status || "running",
    phase: "queued",
    startedAt,
    updatedAt: startedAt,
    sourceFingerprint,
    sourceLastUpdatedAt: String(data.lastUpdatedAt || ""),
    rosterIds,
    taskIds,
    taskCount: taskIds.length,
    currentTaskIndex: options.currentTaskIndex || 0,
    processedTasks: options.processedTasks || 0,
    processedRosters: options.processedRosters || 0,
    issueCount: options.issueCount || 0,
    issueSummary: "",
    taskSummary: null,
  });
  return { data, runId, rosterIds, sourceFingerprint, tasks, taskIds, current };
};

test("scheduleAutoRefreshJobResume keeps exactly one resume trigger", () => {
  const backend = loadBackend();

  backend.scheduleAutoRefreshJobResume_();
  backend.scheduleAutoRefreshJobResume_();

  const resumeTriggers = backend.__triggers.filter((trigger) => trigger.getHandlerFunction() === "autoRefreshWorkerTick");
  assert.equal(resumeTriggers.length, 1);
  assert.equal(backend.__properties.get("AUTO_REFRESH_JOB_TRIGGER_ID"), resumeTriggers[0].getUniqueId());
});

test("autoRefreshActiveRosterTick uses sharded queue coordinator path", () => {
  const backend = loadBackend();
  backend.__properties.set("AUTO_REFRESH_ENABLED", "true");
  let coordinatorCalls = 0;
  backend.startAutoRefreshQueueCoordinator_ = () => {
    coordinatorCalls++;
    return { ok: true, inProgress: true, processedRosters: 0, totalRosters: 2 };
  };
  backend.runRefreshAllRostersCore_ = () => {
    throw new Error("synchronous refresh-all should not be used by scheduled auto-refresh");
  };

  const result = backend.autoRefreshActiveRosterTick();

  assert.equal(result.inProgress, true);
  assert.equal(coordinatorCalls, 1);
});

test("autoRefreshActiveRosterTick schedules worker retry when overlap blocks coordinator", () => {
  const backend = loadBackend();
  backend.__properties.set("AUTO_REFRESH_ENABLED", "true");
  backend.startAutoRefreshQueueCoordinator_ = () => {
    throw backend.createActiveRosterJobLockBusyError_("auto-refresh-coordinator", 0);
  };

  const result = backend.autoRefreshActiveRosterTick();
  const resumeTriggers = backend.__triggers.filter((trigger) => trigger.getHandlerFunction() === "autoRefreshWorkerTick");

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "overlap");
  assert.equal(resumeTriggers.length, 1);
});

test("autoRefreshJobResumeTick delegates to the queue worker without pre-reading legacy job state", () => {
  const backend = loadBackend();
  backend.__properties.set("AUTO_REFRESH_ENABLED", "true");
  let workerCalls = 0;
  backend.continueAutoRefreshQueueWorker_ = () => {
    workerCalls++;
    return { ok: true, status: "skipped", skipped: true, reason: "noJob" };
  };

  const result = backend.autoRefreshJobResumeTick();

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "noJob");
  assert.equal(workerCalls, 1);
});

test("legacy full-state auto-refresh APIs are not available", () => {
  const backend = loadBackend();

  assert.equal(typeof backend.startOrResumeAutoRefreshJob_, "undefined");
  assert.equal(typeof backend.readAutoRefreshJobState_, "undefined");
  assert.equal(typeof backend.writeAutoRefreshJobState_, "undefined");
  assert.equal(typeof backend.processAutoRefreshJobChunk_, "undefined");
  assert.equal(typeof backend.finalizeAutoRefreshJob_, "undefined");
});

test("worker clears legacy current state without restoring the full checkpoint", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    internal: {
      autoRefresh: {
        current: {
          kind: "auto-refresh",
          rosterDataDraft: { huge: "legacy-payload" },
        },
      },
    },
  });
  backend.__properties.set("AUTO_REFRESH_ENABLED", "true");
  const originalFirebaseRequestJson = backend.firebaseRequestJson_;
  const rootCurrentGets = [];
  backend.firebaseRequestJson_ = (pathRaw, methodRaw = "GET", payloadRaw) => {
    const path = String(pathRaw || "").replace(/^\/+|\/+$/g, "");
    const method = String(methodRaw || "GET").toUpperCase();
    if (method === "GET" && path === "internal/autoRefresh/current") rootCurrentGets.push(path);
    return originalFirebaseRequestJson(pathRaw, methodRaw, payloadRaw);
  };

  const result = backend.autoRefreshWorkerTick();

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "noRun");
  assert.equal(rootCurrentGets.length, 0);
  assert.equal(backend.firebaseRequestJson_("internal/autoRefresh/current", "GET"), null);
});

test("worker drains legacy current state then reschedules pending fresh retry", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    internal: {
      autoRefresh: {
        current: {
          kind: "auto-refresh",
          rosterDataDraft: { huge: "legacy-payload" },
        },
      },
    },
  });
  backend.__properties.set("AUTO_REFRESH_ENABLED", "true");
  backend.__properties.set("AUTO_REFRESH_JOB_PENDING_FRESH_RETRY", "sourceReadTooSlow|2026-05-25T00:00:00.000Z");

  const result = backend.autoRefreshWorkerTick();
  const resumeTriggers = backend.__triggers.filter((trigger) => trigger.getHandlerFunction() === "autoRefreshWorkerTick");

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "noRun");
  assert.equal(backend.firebaseRequestJson_("internal/autoRefresh/current", "GET"), null);
  assert.equal(resumeTriggers.length, 1);
});

test("queue coordinator stores tiny current state and sharded run data", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildRosterData());
  backend.__properties.set("AUTO_REFRESH_ENABLED", "true");
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: data, text: JSON.stringify(data) });
  backend.isRecentSuccessfulActiveWrite_ = () => false;
  backend.tryReconcileRegularWarFinalizationTriggerState_ = () => null;
  backend.prefetchClanMembersSnapshotsByTag_ = () => ({
    snapshotByClanTag: {
      "#CLAN": {
        clanTag: "#CLAN",
        members: [{ tag: "#PLAYER", name: "Player", th: 16 }],
        metricsMembers: [],
      },
    },
    errorByClanTag: {},
    requestCount: 1,
    batchCount: 1,
  });

  const result = backend.startAutoRefreshQueueCoordinator_({
    executionStartMs: Date.now(),
    startedAt: "2026-05-25T00:00:00.000Z",
  });
  const current = backend.readAutoRefreshQueueCurrent_();
  const sourceMeta = backend.readAutoRefreshRunShard_(current.runId, "source/meta");
  const sourceRosters = backend.readAutoRefreshRunShard_(current.runId, "source/rosters");
  const sourceMetrics = backend.readAutoRefreshRunShard_(current.runId, "source/playerMetrics");
  const sourceSeeds = backend.readAutoRefreshRunShard_(current.runId, "source/playerSeeds");
  const sourceOwnership = backend.readAutoRefreshRunShard_(current.runId, "source/ownership");

  assert.equal(result.inProgress, true);
  assert.equal(current.kind, "auto-refresh-queue");
  assert.equal(current.taskCount, 3);
  assert.equal(current.rosterIds.length, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(current, "rosterDataDraft"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(current, "autoRefreshSnapshot"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(current, "ownershipSnapshot"), false);
  assert.equal(sourceMeta.sourceFingerprint, current.sourceFingerprint);
  assert.ok(sourceRosters.main);
  assert.ok(sourceMetrics.byTag);
  assert.ok(sourceSeeds.byTag["#PLAYER"]);
  assert.equal(sourceOwnership.liveOwnerRosterIdByTag["#PLAYER"], "main");
  assert.equal(sourceOwnership.sourceOwnerRosterIdByTag["#PLAYER"], "main");
  const resumeTriggers = backend.__triggers.filter((trigger) => trigger.getHandlerFunction() === "autoRefreshWorkerTick");
  assert.equal(resumeTriggers.length, 1);
});

test("roster ownership snapshot preserves live cross-roster owners for isolated workers", () => {
  const backend = installMemoryFirebase(loadBackend());
  const sourceData = buildRosterData();
  sourceData.rosters[0].main = [{
    slot: 1,
    name: "Moved",
    discord: "moved",
    th: 15,
    tag: "#MOVED",
    notes: [],
    excludeAsSwapTarget: false,
    excludeAsSwapSource: false,
  }];
  const data = backend.validateRosterData_(sourceData);
  const runId = "run-1";
  const sourceFingerprint = backend.buildActiveRosterSourceFingerprintValidated_(data);
  const sourceOwnershipIndex = backend.buildAutoRefreshSourceOwnershipIndex_(data, {
    "#CLAN2": {
      clanTag: "#CLAN2",
      members: [{ tag: "#MOVED", name: "Moved", th: 15 }],
      metricsMembers: [],
    },
  });
  backend.writeAutoRefreshRunSourceShards_(runId, data, sourceFingerprint, { rosterIds: ["main", "second"] }, sourceOwnershipIndex);
  const sourceMeta = backend.readAutoRefreshRunShard_(runId, "source/meta");
  const sourceRoster = backend.readAutoRefreshRunShard_(runId, "source/rosters/main");
  const sourceOwnership = backend.readAutoRefreshRunShard_(runId, "source/ownership");

  const ownershipSnapshot = backend.buildAutoRefreshRosterOwnershipSnapshot_(
    sourceMeta,
    sourceRoster,
    "main",
    { clanTag: "#CLAN", members: [], metricsMembers: [] },
    {},
    sourceOwnership,
  );
  const workingRosterData = backend.buildAutoRefreshRosterWorkingData_(sourceMeta, sourceRoster, {});
  const result = backend.applyRosterPoolSync_(
    workingRosterData,
    workingRosterData.rosters[0],
    [],
    "members",
    ownershipSnapshot,
    "2026-05-25T00:00:00.000Z",
  );

  assert.equal(sourceOwnership.sourceOwnerRosterIdByTag["#MOVED"], "main");
  assert.equal(sourceOwnership.liveOwnerRosterIdByTag["#MOVED"], "second");
  assert.equal(ownershipSnapshot.ownerRosterIdByTag["#MOVED"], "second");
  assert.equal(result.removedCrossOwned, 1);
  assert.equal(workingRosterData.rosters[0].main.length, 0);
  assert.equal(workingRosterData.rosters[0].subs.length, 0);
  assert.equal(workingRosterData.rosters[0].missing.length, 0);
});

test("source tag reads batch duplicate encoded paths and skip missing entries", () => {
  const backend = loadBackend();
  let batchPaths = [];
  backend.firebaseBatchGetJson_ = (pathsRaw) => {
    batchPaths = Array.isArray(pathsRaw) ? pathsRaw.slice() : [];
    return {
      [batchPaths[0]]: {
        latestSnapshot: { tag: "#P.L/A", trophies: 5000 },
        nested: { [backend.encodeFirebaseObjectKey_("#INNER.KEY")]: true },
      },
      [batchPaths[1]]: null,
    };
  };

  const result = backend.readAutoRefreshSourceEntriesForTags_("run-1", "source/playerMetrics/byTag", [
    "#p.l/a",
    "#P.L/A",
    "#missing",
    "",
  ]);

  assert.equal(batchPaths.length, 2);
  assert.match(batchPaths[0], /source\/playerMetrics\/byTag\/__FB64__/);
  assert.match(batchPaths[1], /source\/playerMetrics\/byTag\/__FB64__/);
  assert.deepEqual(Object.keys(result), ["#P.L/A"]);
  assert.equal(result["#P.L/A"].latestSnapshot.trophies, 5000);
  assert.equal(result["#P.L/A"].nested["#INNER.KEY"], true);
});

test("firebaseBatchGetJson falls back per failed response", () => {
  const backend = loadBackend();
  const responses = (code, body) => ({
    getResponseCode: () => code,
    getContentText: () => body,
  });
  const fetchAllRequests = [];
  const fallbackCalls = [];
  backend.getFirebaseConfig_ = () => ({ dbUrl: "https://firebase.test/db" });
  backend.getFirebaseAccessToken_ = () => "token";
  backend.UrlFetchApp = {
    fetchAll(requests) {
      fetchAllRequests.push(requests);
      return [
        responses(200, "{\"ok\":true}"),
        responses(500, "server-error"),
        responses(200, "null"),
      ];
    },
  };
  backend.firebaseRequestJson_ = (pathRaw, methodRaw) => {
    fallbackCalls.push({ path: pathRaw, method: methodRaw });
    return { fallback: String(pathRaw) };
  };

  const result = backend.firebaseBatchGetJson_(["ok/path", "bad/path", "missing/path"]);

  assert.equal(fetchAllRequests.length, 1);
  assert.equal(fetchAllRequests[0].length, 3);
  assert.equal(fetchAllRequests[0][0].headers.Authorization, "Bearer token");
  assert.equal(result["ok/path"].ok, true);
  assert.equal(result["bad/path"].fallback, "bad/path");
  assert.equal(result["missing/path"], null);
  assert.deepEqual(fallbackCalls, [{ path: "bad/path", method: "GET" }]);
});

test("queue worker treats existing roster result shards as an idempotent retry", () => {
  const backend = installMemoryFirebase(loadBackend());
  const { runId, taskIds } = setupQueueRun(backend, buildRosterData(), { rosterIds: ["main"] });
  const data = backend.validateRosterData_(buildRosterData());
  const roster = data.rosters.find((entry) => entry.id === "main");
  backend.firebaseRequestJson_("activeVersions/run-1/rosters/main", "PUT", backend.encodeFirebaseObjectKeysRecursive_(roster));
  backend.writeAutoRefreshRunShard_(runId, "rosterWrites/main", { rosterId: "main", versionId: runId }, "PUT");
  backend.writeAutoRefreshRunShard_(runId, "warResults/main", { rosterId: "main", rosterShardWritten: true, issues: [] }, "PUT");
  backend.writeAutoRefreshRunShard_(runId, "metricResults/main", { byTag: {}, tags: [] }, "PUT");
  backend.fetchClanMembersSnapshot_ = () => {
    throw new Error("existing result shard should skip fetch");
  };
  backend.processRefreshAllRosterPipelineIntoAccumulator_ = () => {
    throw new Error("existing result shard should skip processing");
  };

  const result = backend.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() });
  const task = backend.readAutoRefreshTask_(runId, taskIds[0]);
  const current = backend.readAutoRefreshQueueCurrent_();

  assert.equal(result.inProgress, true);
  assert.equal(task.status, "completed");
  assert.equal(current.processedRosters, 1);
  assert.equal(current.currentTaskIndex, 1);
});

test("roster queue task writes war and metric shards from clan member data", () => {
  const backend = installMemoryFirebase(loadBackend());
  const { runId, current, tasks } = setupQueueRun(backend, buildRosterData(), { rosterIds: ["main"] });
  let fetchCalls = 0;
  let processCalls = 0;
  const originalFirebaseRequestJson = backend.firebaseRequestJson_;
  const rootSourceRosterGets = [];
  backend.firebaseRequestJson_ = (pathRaw, methodRaw = "GET", payloadRaw) => {
    const path = String(pathRaw || "").replace(/^\/+|\/+$/g, "");
    const method = String(methodRaw || "GET").toUpperCase();
    if (method === "GET" && path === "internal/autoRefresh/runs/run-1/source/rosters") {
      rootSourceRosterGets.push(path);
    }
    return originalFirebaseRequestJson(pathRaw, methodRaw, payloadRaw);
  };
  backend.fetchClanMembersSnapshot_ = (clanTag) => {
    fetchCalls++;
    assert.equal(clanTag, "#CLAN");
    return {
      clanTag: "#CLAN",
      capturedAt: "2026-05-25T00:00:00.000Z",
      members: [{ tag: "#PLAYER", name: "Player", townHallLevel: 16 }],
      metricsMembers: [{ tag: "#PLAYER", name: "Player", trophies: 5000, donations: 12, donationsReceived: 3 }],
    };
  };
  backend.processRefreshAllRosterPipelineIntoAccumulator_ = (rosterData, rosterId, options, accumulator) => {
    processCalls++;
    assert.equal(rosterId, "main");
    assert.ok(options.prefetchedClanSnapshotsByTag["#CLAN"]);
    assert.equal(options.ownershipSnapshot.memberTagSetByRosterId.main["#PLAYER"], true);
    assert.equal(rosterData.rosters.length, 1);
    const processed = clone(rosterData);
    processed.playerMetrics.byTag["#PLAYER"] = {
      latestSnapshot: { tag: "#PLAYER", name: "Player", trophies: 5000 },
      trophyHistoryDaily: [],
      donationCycles: [],
    };
    processed.rosters[0].regularWar = { state: "notInWar" };
    accumulator.perRoster.push({ rosterId: "main", ok: true, issueCount: 0, issues: [] });
    return { rosterData: processed, pipelineResult: { memberTracking: { capturedPlayers: 1 } } };
  };

  const result = backend.executeAutoRefreshRosterTask_(current, tasks[0], Date.now());
  const warResult = backend.readAutoRefreshRunShard_(runId, "warResults/main");
  const metricResult = backend.readAutoRefreshRunShard_(runId, "metricResults/main");
  const activeRosterShard = backend.decodeFirebaseObjectKeysRecursive_(
    backend.firebaseRequestJson_("activeVersions/run-1/rosters/main", "GET"),
  );

  assert.equal(result.rosterId, "main");
  assert.equal(fetchCalls, 1);
  assert.equal(processCalls, 1);
  assert.equal(rootSourceRosterGets.length, 0);
  assert.equal(warResult.rosterShardWritten, true);
  assert.equal(warResult.rosterSummary.trackingMode, "cwl");
  assert.equal(metricResult.byTag["#PLAYER"].latestSnapshot.trophies, 5000);
  assert.equal(activeRosterShard.regularWar.state, "notInWar");
});

test("queue finalization publishes completed shards through the active version pointer", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildRosterData());
  const { runId, current, tasks } = setupQueueRun(backend, data, {
    rosterIds: ["main", "second"],
    currentTaskIndex: 2,
    processedTasks: 2,
    processedRosters: 2,
  });
  for (const roster of data.rosters) {
    backend.firebaseRequestJson_("activeVersions/run-1/rosters/" + roster.id, "PUT", backend.encodeFirebaseObjectKeysRecursive_(roster));
    backend.writeAutoRefreshRunShard_(runId, "rosterWrites/" + roster.id, { rosterId: roster.id, versionId: runId }, "PUT");
    backend.writeAutoRefreshRunShard_(runId, "warResults/" + roster.id, { rosterId: roster.id, rosterShardWritten: true, issues: [] }, "PUT");
    backend.writeAutoRefreshRunShard_(runId, "metricResults/" + roster.id, { byTag: {}, tags: [] }, "PUT");
  }
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: data, text: JSON.stringify(data) });
  backend.updateActiveRosterDataCaches_ = () => null;
  backend.tryReconcileRegularWarFinalizationTriggerStateValidated_ = () => null;
  backend.tryReconcileCurrentSeasonEventsForAutoRefresh_ = () => null;

  const finalizeTask = tasks.find((task) => task.type === "finalize");
  const result = backend.executeAutoRefreshFinalizeTask_(current, finalizeTask, Date.now());
  const publishedVersion = backend.readPublishedActiveVersionId_();
  const manifest = backend.decodeFirebaseObjectKeysRecursive_(backend.firebaseRequestJson_("activeVersions/run-1/manifest", "GET"));
  const activeRosterShard = backend.decodeFirebaseObjectKeysRecursive_(backend.firebaseRequestJson_("activeVersions/run-1/rosters/main", "GET"));
  const lastJob = backend.decodeFirebaseObjectKeysRecursive_(backend.firebaseRequestJson_("internal/autoRefresh/lastJob", "GET"));

  assert.equal(result.status, "completed");
  assert.equal(publishedVersion, runId);
  assert.equal(manifest.rosterIds.length, 2);
  assert.equal(activeRosterShard.id, "main");
  assert.equal(lastJob.status, "completed");
  assert.equal(backend.readAutoRefreshQueueCurrent_(), null);
});

test("queue finalization refuses to publish when a metric shard is missing", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildRosterData());
  const { runId, current, tasks } = setupQueueRun(backend, data, {
    rosterIds: ["main"],
    currentTaskIndex: 1,
    processedTasks: 1,
    processedRosters: 1,
  });
  backend.firebaseRequestJson_("activeVersions/run-1/rosters/main", "PUT", backend.encodeFirebaseObjectKeysRecursive_(data.rosters[0]));
  backend.writeAutoRefreshRunShard_(runId, "rosterWrites/main", { rosterId: "main", versionId: runId }, "PUT");
  backend.writeAutoRefreshRunShard_(runId, "warResults/main", { rosterId: "main", rosterShardWritten: true, issues: [] }, "PUT");
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: data, text: JSON.stringify(data) });
  const finalizeTask = tasks.find((task) => task.type === "finalize");

  assert.throws(
    () => backend.executeAutoRefreshFinalizeTask_(current, finalizeTask, Date.now()),
    /missing metric result shard: main/,
  );
  assert.equal(backend.firebaseRequestJson_("activePublished/currentVersionId", "GET"), null);
});

test("queue finalization aborts when the active source fingerprint changed", () => {
  const backend = installMemoryFirebase(loadBackend());
  const sourceData = backend.validateRosterData_(buildRosterData());
  const changedSource = backend.validateRosterData_(Object.assign({}, buildRosterData(), { pageTitle: "Changed" }));
  const { runId, current, tasks } = setupQueueRun(backend, sourceData, {
    rosterIds: ["main"],
    currentTaskIndex: 1,
    processedTasks: 1,
    processedRosters: 1,
  });
  backend.firebaseRequestJson_("activeVersions/run-1/rosters/main", "PUT", backend.encodeFirebaseObjectKeysRecursive_(sourceData.rosters[0]));
  backend.writeAutoRefreshRunShard_(runId, "rosterWrites/main", { rosterId: "main", versionId: runId }, "PUT");
  backend.writeAutoRefreshRunShard_(runId, "warResults/main", { rosterId: "main", rosterShardWritten: true, issues: [] }, "PUT");
  backend.writeAutoRefreshRunShard_(runId, "metricResults/main", { byTag: {}, tags: [] }, "PUT");
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: changedSource, text: JSON.stringify(changedSource) });
  backend.tryReconcileRegularWarFinalizationTriggerStateValidated_ = () => null;
  const finalizeTask = tasks.find((task) => task.type === "finalize");

  const result = backend.executeAutoRefreshFinalizeTask_(current, finalizeTask, Date.now());

  assert.equal(result.stale, true);
  assert.equal(backend.firebaseRequestJson_("activePublished/currentVersionId", "GET"), null);
  assert.equal(backend.readAutoRefreshQueueCurrent_(), null);
  assert.equal(backend.__properties.get("AUTO_REFRESH_LAST_RUN_STATUS"), "stale");
});

test("queue finalization clears current state when the version is already published", () => {
  const backend = installMemoryFirebase(loadBackend());
  const { runId, current, tasks } = setupQueueRun(backend, buildRosterData(), {
    rosterIds: ["main"],
    currentTaskIndex: 1,
    processedTasks: 1,
    processedRosters: 1,
  });
  backend.publishActiveRosterVersionPointer_(runId, {
    versionId: runId,
    publishedAt: "2026-05-25T00:00:00.000Z",
    rosterIds: ["main"],
  });
  const finalizeTask = tasks.find((task) => task.type === "finalize");

  const result = backend.executeAutoRefreshFinalizeTask_(current, finalizeTask, Date.now());

  assert.equal(result.status, "completed");
  assert.equal(result.alreadyPublished, true);
  assert.equal(backend.readAutoRefreshQueueCurrent_(), null);
});

test("queue worker recovers after partial completion by continuing at the next pending task", () => {
  const backend = installMemoryFirebase(loadBackend());
  const { runId, taskIds } = setupQueueRun(backend, buildRosterData(), { rosterIds: ["main", "second"], processedRosters: 1 });
  const data = backend.validateRosterData_(buildRosterData());
  backend.firebaseRequestJson_("activeVersions/run-1/rosters/main", "PUT", backend.encodeFirebaseObjectKeysRecursive_(data.rosters[0]));
  backend.writeAutoRefreshRunShard_(runId, "rosterWrites/main", { rosterId: "main", versionId: runId }, "PUT");
  backend.writeAutoRefreshRunShard_(runId, "warResults/main", { rosterId: "main", rosterShardWritten: true, issues: [] }, "PUT");
  backend.writeAutoRefreshRunShard_(runId, "metricResults/main", { byTag: {}, tags: [] }, "PUT");
  const firstTask = backend.readAutoRefreshTask_(runId, taskIds[0]);
  firstTask.status = "completed";
  firstTask.completedAt = "2026-05-25T00:00:00.000Z";
  backend.writeAutoRefreshTask_(runId, firstTask);
  let processedRosterId = "";
  backend.fetchClanMembersSnapshot_ = () => ({ clanTag: "#CLAN2", members: [], metricsMembers: [] });
  backend.processRefreshAllRosterPipelineIntoAccumulator_ = (rosterData, rosterId, _options, accumulator) => {
    processedRosterId = rosterId;
    accumulator.perRoster.push({ rosterId, ok: true, issueCount: 0, issues: [] });
    return { rosterData, pipelineResult: { memberTracking: { capturedPlayers: 0 } } };
  };

  const result = backend.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() });
  const current = backend.readAutoRefreshQueueCurrent_();

  assert.equal(result.inProgress, true);
  assert.equal(processedRosterId, "second");
  assert.equal(current.currentTaskIndex, 2);
  assert.equal(current.processedRosters, 2);
});

test("expired lock and stale worker triggers are cleaned up", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.__properties.set("AUTO_REFRESH_ENABLED", "true");
  backend.__properties.set("ACTIVE_ROSTER_JOB_LOCK", JSON.stringify({
    token: "stale",
    owner: "previous-worker",
    expiresAt: Date.now() - 1,
  }));
  backend.scheduleAutoRefreshJobResume_();

  const result = backend.autoRefreshWorkerTick();
  const resumeTriggers = backend.__triggers.filter((trigger) => trigger.getHandlerFunction() === "autoRefreshWorkerTick");

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "noRun");
  assert.equal(backend.__properties.get("ACTIVE_ROSTER_JOB_LOCK"), undefined);
  assert.equal(resumeTriggers.length, 0);
  assert.equal(backend.__properties.get("AUTO_REFRESH_JOB_TRIGGER_ID"), undefined);
});
