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
    for (const segment of segments) {
      if (!node[segment]) {
        if (!create) return undefined;
        node[segment] = {};
      }
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

const buildCompleteJob = (backend, sourceData) => ({
  jobId: "job-1",
  kind: "auto-refresh",
  status: "finalizing",
  startedAt: "2026-05-25T00:00:00.000Z",
  updatedAt: "2026-05-25T00:00:00.000Z",
  completedAt: "",
  failedAt: "",
  error: "",
  sourceFingerprint: backend.buildActiveRosterSourceFingerprintValidated_(sourceData),
  sourceLastUpdatedAt: String(sourceData.lastUpdatedAt || ""),
  rosterIds: ["main"],
  nextRosterIndex: 1,
  rosterDataDraft: sourceData,
  autoRefreshSnapshot: {},
  ownershipSnapshot: null,
  metricsRunState: { seenClanTags: {} },
  options: {
    allowRegularWarHistoryRepair: false,
    allowRegularWarProvisionalFallback: false,
    statsOnlyRegularWarFinalization: false,
    rosterIds: [],
  },
  processedRosters: 1,
  rostersWithIssues: 0,
  issues: [],
  perRoster: [
    {
      rosterId: "main",
      rosterName: "Main",
      trackingMode: "cwl",
      ok: true,
      partialFailure: false,
      issueCount: 0,
      message: "Refresh pipeline complete (CWL).",
      issues: [],
    },
  ],
  timings: {
    snapshotMs: 1,
    ownershipSnapshotMs: 1,
    rosterPipelineCumulativeMs: 1,
    rollbackCloneCumulativeMs: 0,
    finalValidationMs: 0,
    commitMs: 0,
  },
  writeResultSummary: null,
});

test("AutoRefreshSnapshot errors survive Firebase job serialization", () => {
  const backend = installMemoryFirebase(loadBackend());
  const err = new Error("private war log");
  err.statusCode = 403;
  err.endpoint = "regularWarLog";
  err.key = "#CLAN";
  const job = buildCompleteJob(backend, backend.validateRosterData_(buildRosterData()));
  job.autoRefreshSnapshot = {
    regularWarLogErrorByClanTag: { "#CLAN": err },
  };

  backend.writeAutoRefreshJobState_(job);
  const restored = backend.readAutoRefreshJobState_();
  const restoredErr = restored.autoRefreshSnapshot.regularWarLogErrorByClanTag["#CLAN"];

  assert.equal(restoredErr.message, "private war log");
  assert.equal(restoredErr.statusCode, 403);
  assert.equal(restoredErr.endpoint, "regularWarLog");
  assert.equal(backend.isPrivateWarLogError_(restoredErr), true);
});

test("job progress writes patch mutable state without rewriting immutable snapshot fields", () => {
  const backend = installMemoryFirebase(loadBackend());
  const sourceData = backend.validateRosterData_(buildRosterData());
  const job = buildCompleteJob(backend, sourceData);
  job.status = "running";
  job.nextRosterIndex = 0;
  job.processedRosters = 0;
  job.autoRefreshSnapshot = {
    capturedAt: "snapshot",
    currentRegularWarByClanTag: { "#CLAN": { state: "notInWar" } },
  };

  backend.writeAutoRefreshJobState_(job, { writeKind: "initial", writeScope: "full" });
  job.nextRosterIndex = 1;
  job.processedRosters = 1;
  job.autoRefreshSnapshot = {
    capturedAt: "mutated local snapshot should not be patched",
    currentRegularWarByClanTag: {},
  };
  backend.writeAutoRefreshJobState_(job, { writeKind: "progress", writeScope: "progress" });
  const restored = backend.readAutoRefreshJobState_();

  assert.equal(restored.nextRosterIndex, 1);
  assert.equal(restored.processedRosters, 1);
  assert.equal(restored.autoRefreshSnapshot.capturedAt, "snapshot");
  assert.equal(restored.autoRefreshSnapshot.currentRegularWarByClanTag["#CLAN"].state, "notInWar");
});

test("processAutoRefreshJobChunk persists one roster then stops before the next unsafe roster start", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildRosterData());
  const job = buildCompleteJob(backend, data);
  job.status = "running";
  job.rosterIds = ["main", "second"];
  job.nextRosterIndex = 0;
  job.processedRosters = 0;
  job.perRoster = [];
  job.rosterDataDraft = data;
  const originalNow = backend.Date.now;
  let now = 1_000_000;
  backend.Date.now = () => now;
  backend.runRosterRefreshPipelineCore_ = (rosterData, rosterId) => {
    now += 200_000;
    return {
      ok: true,
      rosterData,
      result: {
        rosterId,
        rosterName: rosterId,
        trackingMode: "cwl",
        partialFailure: false,
        issues: [],
        steps: {},
        rollbackCloneMs: 3,
      },
    };
  };

  try {
    const result = backend.processAutoRefreshJobChunk_(job, now);
    const stored = backend.readAutoRefreshJobState_();

    assert.equal(result.processedThisRun, 1);
    assert.equal(result.statePersisted, true);
    assert.equal(result.budgetStopReason, "beforeRoster");
    assert.equal(job.nextRosterIndex, 1);
    assert.equal(job.processedRosters, 1);
    assert.equal(job.timings.rollbackCloneCumulativeMs, 3);
    assert.equal(stored.nextRosterIndex, 1);
  } finally {
    backend.Date.now = originalNow;
  }
});

test("continueAutoRefreshJobCore defers without processing when roster start budget is already unsafe", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildRosterData());
  const job = buildCompleteJob(backend, data);
  job.status = "running";
  job.rosterIds = ["main"];
  job.nextRosterIndex = 0;
  job.processedRosters = 0;
  job.perRoster = [];
  job.rosterDataDraft = data;
  let pipelineCalls = 0;
  backend.runRosterRefreshPipelineCore_ = () => {
    pipelineCalls++;
    throw new Error("pipeline should not start");
  };

  const result = backend.continueAutoRefreshJobCore_(job, { executionStartMs: Date.now() - 999999 });

  assert.equal(result.inProgress, true);
  assert.equal(result.reason, "chunk-beforeRoster");
  assert.equal(pipelineCalls, 0);
  assert.equal(job.nextRosterIndex, 0);
  const resumeTriggers = backend.__triggers.filter((trigger) => trigger.getHandlerFunction() === "autoRefreshJobResumeTick");
  assert.equal(resumeTriggers.length, 1);
});

test("startOrResumeAutoRefreshJob defers fresh start when source read leaves too little budget for initial state write", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildRosterData());
  const originalNow = backend.Date.now;
  let now = 1_000_000;
  let createCalls = 0;
  let writeCalls = 0;
  backend.Date.now = () => now;
  backend.readActiveRosterSnapshot_ = () => {
    now += 200_000;
    return { rosterData: data, text: JSON.stringify(data) };
  };
  backend.createAutoRefreshJobState_ = () => {
    createCalls++;
    throw new Error("job should not be created after slow source read");
  };
  backend.writeAutoRefreshJobState_ = () => {
    writeCalls++;
    throw new Error("initial state write should not start");
  };

  try {
    const result = backend.startOrResumeAutoRefreshJob_({
      executionStartMs: now,
      startedAt: "2026-05-25T00:00:00.000Z",
    });

    assert.equal(result.inProgress, true);
    assert.equal(result.reason, "sourceReadTooSlowBeforeInitialStateWrite");
    assert.equal(createCalls, 0);
    assert.equal(writeCalls, 0);
    assert.equal(backend.__properties.get("ACTIVE_ROSTER_JOB_LOCK"), undefined);
    assert.ok(String(backend.__properties.get("AUTO_REFRESH_JOB_PENDING_FRESH_RETRY") || "").includes("sourceReadTooSlowBeforeInitialStateWrite"));
    const resumeTriggers = backend.__triggers.filter((trigger) => trigger.getHandlerFunction() === "autoRefreshJobResumeTick");
    assert.equal(resumeTriggers.length, 1);
  } finally {
    backend.Date.now = originalNow;
  }
});

test("resume with pending fresh retry can create the initial job when no job state exists", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildRosterData());
  const job = buildCompleteJob(backend, data);
  job.status = "running";
  job.nextRosterIndex = 0;
  job.processedRosters = 0;
  backend.__properties.set("AUTO_REFRESH_ENABLED", "true");
  backend.__properties.set("AUTO_REFRESH_JOB_PENDING_FRESH_RETRY", "sourceReadTooSlowBeforeInitialStateWrite|2026-05-25T00:00:00.000Z");
  let createCalls = 0;
  let continueCalls = 0;
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: data, text: JSON.stringify(data) });
  backend.createAutoRefreshJobState_ = () => {
    createCalls++;
    return job;
  };
  backend.continueAutoRefreshJobCore_ = () => {
    continueCalls++;
    return { ok: true, inProgress: true, status: "running", processedRosters: 0, totalRosters: 1 };
  };

  const result = backend.autoRefreshJobResumeTick();
  const stored = backend.readAutoRefreshJobState_();

  assert.equal(result.inProgress, true);
  assert.equal(createCalls, 1);
  assert.equal(continueCalls, 1);
  assert.equal(stored.jobId, job.jobId);
  assert.equal(backend.__properties.get("AUTO_REFRESH_JOB_PENDING_FRESH_RETRY"), undefined);
});

test("finalizeAutoRefreshJob aborts stale source without writing active data", () => {
  const backend = installMemoryFirebase(loadBackend());
  const sourceData = backend.validateRosterData_(buildRosterData());
  const changedSource = backend.validateRosterData_(Object.assign({}, buildRosterData(), { pageTitle: "Changed" }));
  const job = buildCompleteJob(backend, sourceData);
  let writeCalls = 0;
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: changedSource, text: JSON.stringify(changedSource) });
  backend.writeAutoRefreshedActiveRosterData_ = () => {
    writeCalls++;
    throw new Error("should not write");
  };
  let validatedReconcileCalls = 0;
  let fallbackReconcileCalls = 0;
  backend.tryReconcileRegularWarFinalizationTriggerStateValidated_ = () => {
    validatedReconcileCalls++;
    return null;
  };
  backend.tryReconcileRegularWarFinalizationTriggerState_ = () => {
    fallbackReconcileCalls++;
    return null;
  };

  const result = backend.finalizeAutoRefreshJob_(job);

  assert.equal(result.stale, true);
  assert.equal(writeCalls, 0);
  assert.equal(validatedReconcileCalls, 1);
  assert.equal(fallbackReconcileCalls, 0);
  assert.equal(backend.readAutoRefreshJobState_(), null);
  assert.equal(backend.__properties.get("AUTO_REFRESH_LAST_RUN_STATUS"), "stale");
});

test("finalizeAutoRefreshJob defers before validation when finalization budget is unsafe", () => {
  const backend = installMemoryFirebase(loadBackend());
  const sourceData = backend.validateRosterData_(buildRosterData());
  const job = buildCompleteJob(backend, sourceData);
  const originalValidate = backend.validateRosterData_;
  let validateCalls = 0;
  let writeCalls = 0;
  backend.validateRosterData_ = (value) => {
    validateCalls++;
    return originalValidate(value);
  };
  backend.writeAutoRefreshedActiveRosterData_ = () => {
    writeCalls++;
    throw new Error("should not write");
  };

  const result = backend.finalizeAutoRefreshJob_(job, { executionStartMs: Date.now() - 999999 });

  assert.equal(result.inProgress, true);
  assert.equal(result.reason, "beforeFinalValidation");
  assert.equal(validateCalls, 0);
  assert.equal(writeCalls, 0);
  const resumeTriggers = backend.__triggers.filter((trigger) => trigger.getHandlerFunction() === "autoRefreshJobResumeTick");
  assert.equal(resumeTriggers.length, 1);
});

test("finalizeAutoRefreshJob commits through existing write boundary and clears current job", () => {
  const backend = installMemoryFirebase(loadBackend());
  const sourceData = backend.validateRosterData_(buildRosterData());
  const job = buildCompleteJob(backend, sourceData);
  let writeCalls = 0;
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: sourceData, text: JSON.stringify(sourceData) });
  backend.writeAutoRefreshedActiveRosterData_ = (_sourceSnapshot, refreshedRosterData) => {
    writeCalls++;
    return {
      changed: false,
      written: false,
      rosterCount: refreshedRosterData.rosters.length,
      playerCount: 1,
      noteCount: 0,
      archiveCreated: false,
      archiveDate: "",
      archiveCleanupDeleted: 0,
      rosterData: sourceData,
    };
  };
  backend.tryReconcileRegularWarFinalizationTriggerStateValidated_ = () => null;
  backend.tryReconcileRegularWarFinalizationTriggerState_ = () => null;
  backend.tryReconcileCurrentSeasonEventsForAutoRefresh_ = () => null;

  const result = backend.finalizeAutoRefreshJob_(job);
  const lastJobEncoded = backend.firebaseRequestJson_("internal/autoRefresh/lastJob", "GET");
  const lastJob = backend.decodeFirebaseObjectKeysRecursive_(lastJobEncoded);

  assert.equal(result.ok, true);
  assert.equal(writeCalls, 1);
  assert.equal(backend.readAutoRefreshJobState_(), null);
  assert.equal(lastJob.status, "completed");
  assert.equal(backend.__properties.get("AUTO_REFRESH_LAST_RUN_STATUS"), "ok");
});

test("scheduleAutoRefreshJobResume keeps exactly one resume trigger", () => {
  const backend = loadBackend();

  backend.scheduleAutoRefreshJobResume_();
  backend.scheduleAutoRefreshJobResume_();

  const resumeTriggers = backend.__triggers.filter((trigger) => trigger.getHandlerFunction() === "autoRefreshJobResumeTick");
  assert.equal(resumeTriggers.length, 1);
  assert.equal(backend.__properties.get("AUTO_REFRESH_JOB_TRIGGER_ID"), resumeTriggers[0].getUniqueId());
});

test("autoRefreshActiveRosterTick uses resumable job path", () => {
  const backend = loadBackend();
  backend.__properties.set("AUTO_REFRESH_ENABLED", "true");
  let jobPathCalls = 0;
  backend.startOrResumeAutoRefreshJob_ = () => {
    jobPathCalls++;
    return { ok: true, inProgress: true, processedRosters: 0, totalRosters: 2 };
  };
  backend.runRefreshAllRostersCore_ = () => {
    throw new Error("synchronous refresh-all should not be used by scheduled auto-refresh");
  };

  const result = backend.autoRefreshActiveRosterTick();

  assert.equal(result.inProgress, true);
  assert.equal(jobPathCalls, 1);
});

test("autoRefreshJobResumeTick delegates to the locked resume path without pre-reading the job", () => {
  const backend = loadBackend();
  backend.__properties.set("AUTO_REFRESH_ENABLED", "true");
  let jobPathCalls = 0;
  backend.readAutoRefreshJobState_ = () => {
    throw new Error("resume tick should not pre-read job state");
  };
  backend.startOrResumeAutoRefreshJob_ = (options) => {
    jobPathCalls++;
    assert.equal(options.resume, true);
    return { ok: true, status: "skipped", skipped: true, reason: "noJob" };
  };

  const result = backend.autoRefreshJobResumeTick();

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "noJob");
  assert.equal(jobPathCalls, 1);
});
