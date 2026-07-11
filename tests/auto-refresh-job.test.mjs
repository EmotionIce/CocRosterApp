import assert from "node:assert/strict";
import crypto from "node:crypto";
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
  "script/cwlLeagueSignups.js",
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
  const triggers = [];
  const triggerRequests = [];
  let uuidCounter = 0;
  let triggerCounter = 0;
  let triggerCreateFailures = 0;
  const makeTrigger = (handler, requestedDelayMs = null) => ({
    id: "trigger-" + (++triggerCounter),
    handler,
    requestedDelayMs,
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
            let requestedDelayMs = null;
            const create = () => {
              triggerRequests.push({ handler, delayMs: requestedDelayMs });
              if (triggerCreateFailures > 0) {
                triggerCreateFailures--;
                throw new Error("simulated trigger creation failure");
              }
              const trigger = makeTrigger(handler, requestedDelayMs);
              triggers.push(trigger);
              return trigger;
            };
            return {
              after: (delayMsRaw) => {
                requestedDelayMs = Number(delayMsRaw);
                return { create };
              },
              at: () => ({ create }),
              everyMinutes: () => ({ create }),
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
  context.__properties = properties;
  context.__triggers = triggers;
  context.__triggerRequests = triggerRequests;
  context.__failNextTriggerCreates = (count = 1) => { triggerCreateFailures = Math.max(0, Number(count) || 0); };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const installCloudflareMirrorSuccess = (backend) => {
  backend.publishCloudflarePublicDataSnapshot_ = () => {
    const versionId = backend.readPublishedActiveVersionId_();
    return {
      ok: true,
      active: {
        ok: true,
        versionId,
        publicResult: { ok: true, putCount: 6 },
        botResult: { ok: true, putCount: 4 },
      },
      cwlLeagueSignups: { ok: true, putCount: 1 },
      seasonEvents: { ok: true, putCount: 3, deleteCount: 1 },
    };
  };
  backend.verifyCloudflarePublicActiveVersionId_ = (versionId) => ({
    ok: true,
    statusCode: 200,
    expectedVersionId: versionId,
    actualVersionId: versionId,
  });
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
  backend.fetchCurrentRegularWar_ = (clanTag) => backend.buildNoCurrentRegularWarResult_(clanTag);
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

const buildRosterPlayer = ({ tag = "#8CCVV", name = "Departed", discord = "", th = 15 } = {}) => ({
  slot: 1,
  name,
  discord,
  th,
  tag,
  notes: [],
  excludeAsSwapTarget: false,
  excludeAsSwapSource: false,
});

const playerTags = (playersRaw) => Array.from(playersRaw || [], (player) => player.tag);

const buildPrepOutRosterData = (options = {}) => {
  const tag = options.tag || "#8CCVV";
  const data = buildRosterData();
  data.rosters[0].connectedClanTag = "#2LUCULP";
  data.rosters[1].connectedClanTag = "#9PYLQG";
  data.rosters[0].main = [];
  data.rosters[0].subs = [buildRosterPlayer({ tag, name: options.name || "Departed", discord: options.discord || "" })];
  data.rosters[0].missing = [];
  data.rosters[0].cwlPreparation = {
    enabled: true,
    rosterSize: 15,
    lockStateByTag: { [tag]: options.lockState || "lockedOut" },
    assignedTagSet: { [tag]: true },
    excludedTagSet: {},
  };
  if (options.identity) {
    data.playerMetrics.byTag[tag] = {
      identity: Object.assign({ tag, name: options.name || "Departed" }, options.identity),
      trophyHistoryDaily: [],
      donationCycles: [],
    };
  }
  return data;
};

const setupQueueRun = (backend, sourceDataRaw, options = {}) => {
  const data = backend.validateRosterData_(sourceDataRaw || buildRosterData());
  const runId = options.runId || "run-1";
  const rosterIds = options.rosterIds || ["main"];
  const startedAt = options.startedAt || "2026-05-25T00:00:00.000Z";
  const sourceVersionId = options.sourceVersionId || "";
  const sourceFingerprint = backend.buildActiveRosterSourceFingerprintValidated_(data);
  backend.writeAutoRefreshRunSourceShards_(runId, data, sourceFingerprint, { rosterIds }, null, sourceVersionId);
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
    sourceVersionId,
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

const firstRosterTask = (tasks) => tasks.find((task) => task.type === "roster");
const rosterTaskById = (tasks, rosterId) => tasks.find((task) => task.type === "roster" && task.rosterId === rosterId);

const disableQueueCwlPreflights = (backend) => {
  backend.runAutoRefreshCwlCoordinatorPreflightBeforeRoster_ = () => null;
  backend.runAutoRefreshFinalCwlCoordinatorPreflightBeforeFinalize_ = () => null;
};

const setupSyntheticQueueRun = (backend, specs, options = {}) => {
  backend.buildAutoRefreshQueueTasks_ = (runIdRaw) => {
    const runId = String(runIdRaw || "run-1");
    return specs.map((specRaw, index) => {
      const spec = specRaw && typeof specRaw === "object" ? specRaw : {};
      return Object.assign({
        taskId: `synthetic-${index}-${String(spec.type || "task")}`,
        runId,
        type: String(spec.type || "metricCopy"),
        status: "pending",
        rosterId: String(spec.rosterId || ""),
        index,
        attempts: 0,
        startedAt: "",
        updatedAt: "",
        completedAt: "",
        error: "",
        summary: "",
      }, spec, { runId, index });
    });
  };
  return setupQueueRun(backend, buildRosterData(), options);
};

const setupMetricCopyRun = (backend, metricKeys, options = {}) => {
  const runId = options.runId || "run-1";
  const sourceVersionId = options.sourceVersionId || "source-1";
  const rosterIds = options.rosterIds || ["main"];
  const tasks = backend.buildAutoRefreshQueueTasks_(runId, rosterIds, {
    metricCopyKeys: metricKeys,
    metricCopyTaskTagLimit: options.chunkLimit || 100,
  });
  const taskIds = backend.writeAutoRefreshQueueTasks_(runId, tasks);
  const current = backend.writeAutoRefreshQueueCurrent_({
    runId,
    kind: "auto-refresh-queue",
    status: options.status || "running",
    phase: "processing",
    sourceVersionId,
    rosterIds,
    taskIds,
    taskCount: taskIds.length,
    currentTaskIndex: options.currentTaskIndex || 0,
    processedTasks: options.processedTasks || 0,
    processedRosters: 0,
    issueCount: 0,
    issueSummary: "",
    taskSummary: null,
  });
  return { runId, sourceVersionId, tasks, taskIds, current };
};

const installMetricRangeResponse = (backend, sourceByKey) => {
  const parentPath = "activeVersions/source-1/playerMetrics/byTag";
  const originalFirebaseRequestJson = backend.firebaseRequestJson_;
  const rangeRequests = [];
  backend.firebaseRequestJson_ = (pathRaw, methodRaw = "GET", payloadRaw, queryParamsRaw) => {
    const method = String(methodRaw || "GET").toUpperCase();
    const query = queryParamsRaw && typeof queryParamsRaw === "object" ? queryParamsRaw : {};
    if (method === "GET" && String(pathRaw || "").replace(/^\/+|\/+$/g, "") === parentPath && query.orderBy) {
      rangeRequests.push({ path: String(pathRaw || ""), method, query: Object.assign({}, query) });
      return clone(sourceByKey);
    }
    return originalFirebaseRequestJson(pathRaw, methodRaw, payloadRaw, queryParamsRaw);
  };
  return { originalFirebaseRequestJson, rangeRequests };
};

const buildMetricSourceMap = (backend, encodedKeys) => {
  const sourceByKey = {};
  const keys = Array.isArray(encodedKeys) ? encodedKeys : [];
  for (let i = 0; i < keys.length; i++) {
    sourceByKey[keys[i]] = backend.encodeFirebaseObjectKeysRecursive_({
      identity: { tag: "#METRIC" + String(i), name: "Metric " + String(i) },
      latestSnapshot: { tag: "#METRIC" + String(i), trophies: 1000 + i },
      trophyHistoryDaily: [],
      donationCycles: [],
    });
  }
  return sourceByKey;
};

const buildOneRoundCwlLeagueGroup = (options = {}) => ({
  state: options.state || "inWar",
  season: options.season || "2026-07",
  clans: [{ tag: options.clanTag || "#CLAN", warLeague: { name: options.leagueName || "Champion I" } }, { tag: options.opponentTag || "#OPP" }],
  rounds: [{ warTags: [options.warTag || "#WAR1"] }],
});

const buildOneRoundCwlWar = (options = {}) => ({
  state: options.state || "inWar",
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

const buildCurrentCwlEventDb = () => ({
  events: {
    seasonEvents: {
      currentCwl: { eventId: "cwl-active", type: "cwl" },
      byId: {
        "cwl-active": {
          eventId: "cwl-active",
          type: "cwl",
          status: "open",
          visibility: "public",
          signupsOpen: true,
          startsAt: "",
          endsAt: "",
          cwlTrackingState: "active",
          cwl: { groups: {} },
          participantsByDiscordId: {
            "100": {
              discordId: "100",
              status: "signed_up",
              accounts: [{ tag: "#PLAYER", name: "Player" }],
            },
          },
        },
      },
    },
  },
});

const installPublishedActiveVersion = (backend, dataRaw) => {
  const data = backend.validateRosterData_(dataRaw || buildRosterData());
  return backend.writeActiveRosterVersionShards_("source-1", data, {
    source: "test",
    runId: "source-1",
    publishedAt: "2026-07-04T00:00:00.000Z",
    sourceFingerprint: "fingerprint-source-1",
    publish: true,
  });
};

const installCwlFetch = (backend, getWarRaw, options = {}) => {
  const paths = [];
  backend.cocFetchAllByPathEntries_ = (entriesRaw) => {
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    const dataByKey = {};
    const errorByKey = {};
    const leaguegroup = options.leaguegroup || buildOneRoundCwlLeagueGroup(options);
    const getWar = typeof getWarRaw === "function" ? getWarRaw : () => (getWarRaw || buildOneRoundCwlWar(options));
    for (const entry of entries) {
      paths.push(entry.path);
      if (entry.path.includes("/currentwar/leaguegroup")) {
        if (options.groupError) errorByKey[entry.key] = Object.assign(new Error("group failed"), { statusCode: 500 });
        else dataByKey[entry.key] = leaguegroup;
      } else if (entry.path.includes("/clans/") && !entry.path.includes("/currentwar")) {
        dataByKey[entry.key] = { tag: entry.key, warLeague: { name: entry.key === "#CLAN" ? "Champion I" : "Master I" } };
      } else if (entry.path.includes("/clanwarleagues/wars/")) {
        if (options.warError) errorByKey[entry.key] = Object.assign(new Error("war failed"), { statusCode: 500 });
        else dataByKey[entry.key] = getWar(entry.key);
      } else if (entry.path.endsWith("/members")) {
        dataByKey[entry.key] = { items: [] };
      } else if (entry.path.endsWith("/currentwar")) {
        errorByKey[entry.key] = Object.assign(new Error("not in war"), { statusCode: 404 });
      }
    }
    return { dataByKey, errorByKey, requestCount: entries.length, batchCount: entries.length ? 1 : 0 };
  };
  return paths;
};

test("queue worker drains several lightweight tasks in one invocation with diagnostics", () => {
  const backend = installMemoryFirebase(loadBackend());
  const { runId, tasks } = setupSyntheticQueueRun(backend, [
    { type: "metricCopy" },
    { type: "metricCopy" },
    { type: "metricCopy" },
    { type: "cwlFinalCoordinator" },
  ]);
  disableQueueCwlPreflights(backend);
  const completed = [];
  backend.executeAutoRefreshMetricCopyTask_ = (_current, task) => {
    completed.push(task.taskId);
    return { copiedCount: 1 };
  };

  const result = backend.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() });
  const current = backend.readAutoRefreshQueueCurrent_();

  assert.deepEqual(completed, tasks.slice(0, 3).map((task) => task.taskId));
  assert.equal(result.inProgress, true);
  assert.equal(result.reason, "cwlBoundary");
  assert.equal(result.tasksCompleted, 3);
  assert.equal(result.elapsedMs >= 0, true);
  assert.equal(result.remainingMs > 0, true);
  assert.equal(result.exitReason, "cwlBoundary");
  assert.equal(current.currentTaskIndex, 3);
  assert.equal(backend.readAutoRefreshTask_(runId, tasks[0].taskId).status, "completed");
  assert.equal(backend.readAutoRefreshTask_(runId, tasks[2].taskId).status, "completed");
  assert.equal(backend.__triggers.filter((trigger) => trigger.getHandlerFunction() === "autoRefreshWorkerTick").length, 2);
  assert.notEqual(backend.__properties.get("AUTO_REFRESH_JOB_TRIGGER_ID"), backend.__properties.get("AUTO_REFRESH_JOB_WATCHDOG_TRIGGER_ID"));
});

test("queue worker continues from a coordinator task into a roster task when budget permits", () => {
  const backend = installMemoryFirebase(loadBackend());
  const { tasks } = setupSyntheticQueueRun(backend, [
    { type: "cwlCoordinator" },
    { type: "roster", rosterId: "main" },
    { type: "cwlFinalCoordinator" },
  ], { rosterIds: ["main"] });
  disableQueueCwlPreflights(backend);
  const completed = [];
  backend.executeAutoRefreshCwlCoordinatorTask_ = (_current, task) => {
    completed.push(task.taskId);
    return { captured: true };
  };
  backend.executeAutoRefreshRosterTask_ = (_current, task) => {
    completed.push(task.taskId);
    return { issueCount: 0 };
  };

  const result = backend.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() });

  assert.deepEqual(completed, [tasks[0].taskId, tasks[1].taskId]);
  assert.equal(result.reason, "cwlBoundary");
  assert.equal(result.tasksCompleted, 2);
  assert.equal(result.processedRosters, 1);
});

test("queue worker drains multiple fast roster tasks before the CWL boundary", () => {
  const backend = installMemoryFirebase(loadBackend());
  const { tasks } = setupSyntheticQueueRun(backend, [
    { type: "roster", rosterId: "main" },
    { type: "roster", rosterId: "second" },
    { type: "roster", rosterId: "third" },
    { type: "cwlFinalCoordinator" },
  ], { rosterIds: ["main", "second", "third"] });
  disableQueueCwlPreflights(backend);
  const completed = [];
  backend.executeAutoRefreshRosterTask_ = (_current, task) => {
    completed.push(task.rosterId);
    return { issueCount: 0 };
  };

  const result = backend.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() });

  assert.deepEqual(completed, ["main", "second", "third"]);
  assert.equal(result.reason, "cwlBoundary");
  assert.equal(result.tasksCompleted, 3);
  assert.equal(result.processedRosters, 3);
});

test("queue worker refuses the next task when its start reserve is unavailable", () => {
  const backend = installMemoryFirebase(loadBackend());
  setupSyntheticQueueRun(backend, [{ type: "metricCopy" }]);
  disableQueueCwlPreflights(backend);
  let calls = 0;
  backend.executeAutoRefreshMetricCopyTask_ = () => {
    calls++;
    return {};
  };

  const result = backend.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() - 269000 });

  assert.equal(calls, 0);
  assert.equal(result.reason, "beforeTaskBudget");
  assert.equal(result.tasksCompleted, 0);
  assert.equal(result.exitReason, "beforeTaskBudget");
  assert.equal(backend.__triggers.filter((trigger) => trigger.getHandlerFunction() === "autoRefreshWorkerTick").length, 1);
});

test("queue worker retains a roster task when its next phase reserve is unavailable", () => {
  const backend = installMemoryFirebase(loadBackend());
  const { runId, tasks } = setupSyntheticQueueRun(backend, [
    { type: "metricCopy" },
    { type: "roster", rosterId: "main" },
    { type: "metricCopy" },
  ], { rosterIds: ["main"] });
  disableQueueCwlPreflights(backend);
  backend.executeAutoRefreshMetricCopyTask_ = () => ({});

  const result = backend.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() - 170000 });
  const current = backend.readAutoRefreshQueueCurrent_();

  assert.equal(result.inProgress, true);
  assert.equal(result.tasksCompleted, 1);
  assert.equal(result.reason, "beforePrimarySnapshotBudget");
  assert.equal(current.currentTaskIndex, 1);
  assert.equal(backend.readAutoRefreshTask_(runId, tasks[1].taskId).status, "pending");
  assert.equal(backend.readAutoRefreshTask_(runId, tasks[2].taskId).status, "pending");
  assert.equal(backend.__triggers.filter((trigger) => trigger.getHandlerFunction() === "autoRefreshWorkerTick").length, 2);
});

test("queue worker preserves continuation after a deferred task", () => {
  const backend = installMemoryFirebase(loadBackend());
  const { runId, tasks } = setupSyntheticQueueRun(backend, [
    { type: "metricCopy" },
    { type: "metricCopy" },
    { type: "metricCopy" },
  ]);
  disableQueueCwlPreflights(backend);
  const calls = [];
  backend.executeAutoRefreshMetricCopyTask_ = (_current, task) => {
    calls.push(task.taskId);
    return calls.length === 2 ? { deferred: true, reason: "after-input-chunk" } : {};
  };

  const result = backend.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() });
  const current = backend.readAutoRefreshQueueCurrent_();

  assert.deepEqual(calls, [tasks[0].taskId, tasks[1].taskId]);
  assert.equal(result.reason, "after-input-chunk");
  assert.equal(result.tasksCompleted, 1);
  assert.equal(current.currentTaskIndex, 1);
  assert.equal(backend.readAutoRefreshTask_(runId, tasks[1].taskId).status, "pending");
  assert.equal(backend.readAutoRefreshTask_(runId, tasks[2].taskId).status, "pending");
  assert.equal(backend.__triggers.filter((trigger) => trigger.getHandlerFunction() === "autoRefreshWorkerTick").length, 2);
});

test("queue worker stops at a newly reached CWL boundary", () => {
  const backend = installMemoryFirebase(loadBackend());
  const { runId, tasks } = setupSyntheticQueueRun(backend, [
    { type: "metricCopy" },
    { type: "cwlCoordinator" },
    { type: "roster", rosterId: "main" },
  ]);
  disableQueueCwlPreflights(backend);
  const calls = [];
  backend.executeAutoRefreshMetricCopyTask_ = (_current, task) => {
    calls.push(task.taskId);
    return {};
  };
  backend.executeAutoRefreshCwlCoordinatorTask_ = (_current, task) => {
    calls.push(task.taskId);
    return {};
  };

  const result = backend.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() });
  const current = backend.readAutoRefreshQueueCurrent_();

  assert.deepEqual(calls, [tasks[0].taskId]);
  assert.equal(result.reason, "cwlBoundary");
  assert.equal(current.currentTaskIndex, 1);
  assert.equal(backend.readAutoRefreshTask_(runId, tasks[1].taskId).status, "pending");
});

test("queue worker skips completed idempotent tasks and continues safely", () => {
  const backend = installMemoryFirebase(loadBackend());
  const { tasks } = setupSyntheticQueueRun(backend, [
    { type: "metricCopy", status: "completed", completedAt: "2026-05-25T00:00:00.000Z" },
    { type: "metricCopy" },
    { type: "cwlFinalCoordinator" },
  ]);
  disableQueueCwlPreflights(backend);
  backend.isAutoRefreshTaskResultComplete_ = (_runId, task) => task.taskId === tasks[0].taskId;
  const calls = [];
  backend.executeAutoRefreshMetricCopyTask_ = (_current, task) => {
    calls.push(task.taskId);
    return {};
  };

  const result = backend.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() });

  assert.deepEqual(calls, [tasks[1].taskId]);
  assert.equal(result.reason, "cwlBoundary");
  assert.equal(result.tasksCompleted, 1);
  assert.equal(backend.readAutoRefreshQueueCurrent_().currentTaskIndex, 2);
});

test("retryable queue failures do not start later tasks", () => {
  const backend = installMemoryFirebase(loadBackend());
  const { runId, tasks } = setupSyntheticQueueRun(backend, [
    { type: "metricCopy" },
    { type: "metricCopy" },
    { type: "cwlFinalCoordinator" },
  ]);
  disableQueueCwlPreflights(backend);
  const calls = [];
  backend.executeAutoRefreshMetricCopyTask_ = (_current, task) => {
    calls.push(task.taskId);
    if (calls.length === 1) return { deferred: true, reason: "retryable-external" };
    return {};
  };

  const result = backend.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() });

  assert.deepEqual(calls, [tasks[0].taskId]);
  assert.equal(result.reason, "retryable-external");
  assert.equal(result.tasksCompleted, 0);
  assert.equal(backend.readAutoRefreshTask_(runId, tasks[1].taskId).status, "pending");
});

test("fatal queue failures stop before later tasks and clean up the queue", () => {
  const backend = installMemoryFirebase(loadBackend());
  const { runId, tasks } = setupSyntheticQueueRun(backend, [
    { type: "metricCopy" },
    { type: "metricCopy" },
  ]);
  disableQueueCwlPreflights(backend);
  const calls = [];
  backend.executeAutoRefreshMetricCopyTask_ = (_current, task) => {
    calls.push(task.taskId);
    throw new Error("fatal-external");
  };

  assert.throws(
    () => backend.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() }),
    /fatal-external/,
  );

  assert.deepEqual(calls, [tasks[0].taskId]);
  assert.equal(backend.readAutoRefreshQueueCurrent_(), null);
  assert.equal(backend.readAutoRefreshTask_(runId, tasks[1].taskId), null);
  assert.equal(backend.__triggers.length, 0);
});

test("queue worker startup uses a later watchdog than normal continuation", () => {
  const backend = installMemoryFirebase(loadBackend());
  setupSyntheticQueueRun(backend, [
    { type: "metricCopy" },
    { type: "cwlFinalCoordinator" },
  ]);
  disableQueueCwlPreflights(backend);
  backend.executeAutoRefreshMetricCopyTask_ = () => {
    throw new Error("startup-watchdog-test");
  };

  assert.throws(
    () => backend.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() }),
    /startup-watchdog-test/,
  );

  const workerRequests = backend.__triggerRequests.filter((request) => request.handler === "autoRefreshWorkerTick");
  assert.equal(workerRequests.length, 1);
  assert.ok(workerRequests[0].delayMs <= 960000 && workerRequests[0].delayMs >= 959000);
  assert.equal(backend.__triggers.length, 0);
});

test("deferred queue work keeps independent watchdog and normal continuation paths", () => {
  const backend = installMemoryFirebase(loadBackend());
  const { runId, tasks } = setupSyntheticQueueRun(backend, [{ type: "metricCopy" }]);
  disableQueueCwlPreflights(backend);
  backend.executeAutoRefreshMetricCopyTask_ = () => ({ deferred: true, reason: "test-defer" });

  const result = backend.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() });
  const workerTriggers = backend.__triggers.filter((trigger) => trigger.getHandlerFunction() === "autoRefreshWorkerTick");
  const workerRequests = backend.__triggerRequests.filter((request) => request.handler === "autoRefreshWorkerTick");

  assert.equal(result.reason, "test-defer");
  assert.equal(backend.readAutoRefreshTask_(runId, tasks[0].taskId).status, "pending");
  assert.equal(workerRequests.length, 2);
  assert.ok(workerRequests[0].delayMs <= 960000 && workerRequests[0].delayMs >= 959000);
  assert.ok(workerRequests[1].delayMs >= 59500 && workerRequests[1].delayMs <= 60000);
  assert.equal(workerTriggers.length, 2);
  assert.equal(workerTriggers.some((trigger) => trigger.requestedDelayMs >= 59500 && trigger.requestedDelayMs <= 60000), true);
  assert.equal(workerTriggers.some((trigger) => trigger.requestedDelayMs <= 960000 && trigger.requestedDelayMs >= 959000), true);
});

test("terminal completion removes the delayed watchdog", () => {
  const backend = installMemoryFirebase(loadBackend());
  setupSyntheticQueueRun(backend, [
    { type: "metricCopy" },
    { type: "finalize" },
  ]);
  disableQueueCwlPreflights(backend);
  const calls = [];
  backend.executeAutoRefreshMetricCopyTask_ = (_current, task) => {
    calls.push(task.type);
    return {};
  };
  backend.executeAutoRefreshFinalizeTask_ = (current, task) => {
    calls.push(task.type);
    backend.archiveAndClearAutoRefreshQueueStateBestEffort_(current, "completed", "test complete", "", "test terminal cleanup");
    return { ok: true, status: "completed" };
  };

  const result = backend.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() });
  const workerRequests = backend.__triggerRequests.filter((request) => request.handler === "autoRefreshWorkerTick");

  assert.equal(result.status, "completed");
  assert.deepEqual(calls, ["metricCopy", "finalize"]);
  assert.equal(workerRequests.length, 1);
  assert.ok(workerRequests[0].delayMs <= 960000 && workerRequests[0].delayMs >= 959000);
  assert.equal(backend.__triggers.length, 0);
});

test("watchdog and continuation scheduling keep one effective trigger of each kind", () => {
  const backend = loadBackend();

  backend.scheduleAutoRefreshJobWatchdog_();
  backend.scheduleAutoRefreshJobResume_();
  backend.scheduleAutoRefreshJobWatchdog_();

  const workerTriggers = backend.__triggers.filter((trigger) => trigger.getHandlerFunction() === "autoRefreshWorkerTick");
  const workerRequests = backend.__triggerRequests.filter((request) => request.handler === "autoRefreshWorkerTick");

  assert.equal(workerRequests.length, 2);
  assert.ok(workerRequests[0].delayMs <= 960000 && workerRequests[0].delayMs >= 959000);
  assert.ok(workerRequests[1].delayMs >= 59500 && workerRequests[1].delayMs <= 60000);
  assert.equal(workerTriggers.length, 2);
  assert.equal(workerTriggers.some((trigger) => trigger.requestedDelayMs >= 59500 && trigger.requestedDelayMs <= 60000), true);
  assert.equal(workerTriggers.some((trigger) => trigger.requestedDelayMs <= 960000 && trigger.requestedDelayMs >= 959000), true);
  assert.notEqual(backend.__properties.get("AUTO_REFRESH_JOB_TRIGGER_ID"), backend.__properties.get("AUTO_REFRESH_JOB_WATCHDOG_TRIGGER_ID"));
});

test("final CWL coordinator and finalization can complete in one invocation", () => {
  const backend = installMemoryFirebase(loadBackend());
  setupSyntheticQueueRun(backend, [
    { type: "cwlFinalCoordinator" },
    { type: "finalize" },
  ]);
  disableQueueCwlPreflights(backend);
  const calls = [];
  backend.executeAutoRefreshFinalCwlCoordinatorTask_ = (_current, task) => {
    calls.push(task.type);
    return { captured: true };
  };
  backend.executeAutoRefreshFinalizeTask_ = (current, task) => {
    calls.push(task.type);
    backend.archiveAndClearAutoRefreshQueueStateBestEffort_(current, "completed", "test CWL complete", "", "test CWL cleanup");
    return { ok: true, status: "completed" };
  };

  const result = backend.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() });

  assert.equal(result.status, "completed");
  assert.deepEqual(calls, ["cwlFinalCoordinator", "finalize"]);
  assert.equal(result.tasksCompleted, 2);
  assert.equal(backend.__triggers.length, 0);
});

test("deferred finalization leaves the task pending with one normal continuation", () => {
  const backend = installMemoryFirebase(loadBackend());
  const { runId, tasks } = setupSyntheticQueueRun(backend, [
    { type: "cwlFinalCoordinator", status: "completed", completedAt: "2026-05-25T00:00:00.000Z" },
    { type: "finalize" },
  ], { currentTaskIndex: 1, processedTasks: 1, status: "finalizing" });
  disableQueueCwlPreflights(backend);
  backend.executeAutoRefreshFinalizeTask_ = () => ({ deferred: true, reason: "beforeFinalize" });

  const result = backend.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() });
  const workerTriggers = backend.__triggers.filter((trigger) => trigger.getHandlerFunction() === "autoRefreshWorkerTick");
  const workerRequests = backend.__triggerRequests.filter((request) => request.handler === "autoRefreshWorkerTick");

  assert.equal(result.reason, "beforeFinalize");
  assert.equal(backend.readAutoRefreshTask_(runId, tasks[1].taskId).status, "pending");
  assert.ok(workerRequests[0].delayMs >= 959000 && workerRequests[0].delayMs <= 960000);
  assert.ok(workerRequests[1].delayMs >= 59500 && workerRequests[1].delayMs <= 60000);
  assert.equal(workerTriggers.length, 2);
  assert.equal(workerTriggers.some((trigger) => trigger.requestedDelayMs >= 59500 && trigger.requestedDelayMs <= 60000), true);
  assert.equal(workerTriggers.some((trigger) => trigger.requestedDelayMs >= 959000 && trigger.requestedDelayMs <= 960000), true);
});

const stageCompletedRosterOutputs = (backend, runId, dataRaw, rosterIdsRaw = ["main"]) => {
  const data = backend.validateRosterData_(dataRaw || buildRosterData());
  const rosterIds = Array.isArray(rosterIdsRaw) ? rosterIdsRaw : ["main"];
  for (const rosterId of rosterIds) {
    const roster = data.rosters.find((entry) => entry.id === rosterId);
    if (!roster) continue;
    backend.firebaseRequestJson_("activeVersions/" + runId + "/rosters/" + rosterId, "PUT", backend.encodeFirebaseObjectKeysRecursive_(roster));
    backend.writeAutoRefreshRunShard_(runId, "rosterWrites/" + rosterId, { rosterId, versionId: runId, playerTags: (roster.main || []).map((player) => backend.normalizeTag_(player.tag)).filter(Boolean) }, "PUT");
    backend.writeAutoRefreshRunShard_(runId, "warResults/" + rosterId, { rosterId, rosterShardWritten: true, issues: [] }, "PUT");
    backend.writeAutoRefreshRunShard_(runId, "metricResults/" + rosterId, { metricResultMode: "activeVersionPatches", metricsStaged: true, tags: [] }, "PUT");
  }
};

test("scheduleAutoRefreshJobResume keeps exactly one resume trigger", () => {
  const backend = loadBackend();

  backend.scheduleAutoRefreshJobResume_();
  backend.scheduleAutoRefreshJobResume_();

  const resumeTriggers = backend.__triggers.filter((trigger) => trigger.getHandlerFunction() === "autoRefreshWorkerTick");
  assert.equal(resumeTriggers.length, 1);
  assert.equal(backend.__properties.get("AUTO_REFRESH_JOB_TRIGGER_ID"), resumeTriggers[0].getUniqueId());
});

test("repairAutoRefreshScheduler recreates stale triggers and preserves a running queue", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.__properties.set("AUTO_REFRESH_ENABLED", "1");
  const staleAuto = backend.ScriptApp.newTrigger("autoRefreshActiveRosterTick").timeBased().everyHours(2).create();
  const staleResume = backend.ScriptApp.newTrigger("autoRefreshWorkerTick").timeBased().after(60000).create();
  backend.__properties.set("AUTO_REFRESH_TRIGGER_ID", staleAuto.getUniqueId());
  backend.__properties.set("AUTO_REFRESH_JOB_TRIGGER_ID", staleResume.getUniqueId());
  const { runId, current } = setupQueueRun(backend, buildRosterData(), {
    rosterIds: ["main"],
    currentTaskIndex: 1,
    processedTasks: 1,
    processedRosters: 0,
  });
  current.status = "running";
  backend.writeAutoRefreshQueueCurrent_(current, false);

  const result = backend.runAdminApiMethod_("repairAutoRefreshScheduler", [
    { reason: "test-current-deployment" },
    "secret",
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.status, "repaired");
  assert.equal(result.auth, "discord-bot");
  assert.equal(result.currentRunId, runId);
  assert.equal(result.currentStatus, "running");
  assert.equal(result.removedAutoRefreshTriggers, 1);
  assert.equal(result.removedResumeTriggers, 0);
  const autoTriggers = backend.__triggers.filter((trigger) => trigger.getHandlerFunction() === "autoRefreshActiveRosterTick");
  const resumeTriggers = backend.__triggers.filter((trigger) => trigger.getHandlerFunction() === "autoRefreshWorkerTick");
  assert.equal(autoTriggers.length, 1);
  assert.equal(resumeTriggers.length, 1);
  assert.equal(backend.__properties.get("AUTO_REFRESH_TRIGGER_ID"), autoTriggers[0].getUniqueId());
  assert.equal(backend.__properties.get("AUTO_REFRESH_JOB_TRIGGER_ID"), resumeTriggers[0].getUniqueId());
  assert.notEqual(backend.readAutoRefreshQueueCurrent_(), null);
});

test("repairAutoRefreshScheduler rejects invalid credentials", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.__properties.set("AUTO_REFRESH_ENABLED", "1");

  assert.throws(
    () => backend.runAdminApiMethod_("repairAutoRefreshScheduler", [{ reason: "test" }, "wrong"]),
    /Authentication failed/,
  );
});

test("admin diagnostics exposes current auto-refresh queue state without roster payloads", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.__properties.set("ADMIN_PW", "secret");
  backend.__properties.set("AUTO_REFRESH_ENABLED", "1");
  backend.__properties.set("ACTIVE_ROSTER_JOB_LOCK", JSON.stringify({
    token: "lock-token",
    owner: "auto-refresh-worker",
    expiresAt: Date.now() + 30000,
  }));
  const { runId, current, tasks } = setupQueueRun(backend, buildRosterData(), {
    rosterIds: ["main"],
    currentTaskIndex: 3,
    processedTasks: 2,
    processedRosters: 1,
  });
  const finalizeTask = tasks.find((task) => task.type === "finalize");
  finalizeTask.status = "running";
  finalizeTask.startedAt = "2026-05-25T00:02:00.000Z";
  finalizeTask.summary = "finalizing";
  backend.writeAutoRefreshTask_(runId, finalizeTask);
  current.status = "finalizing";
  current.phase = "cloudflare-publish";
  current.taskSummary = { taskId: finalizeTask.taskId, type: "finalize", startedAt: finalizeTask.startedAt };
  current.cloudflarePublicDataPublish = { ok: false, status: "publishing", label: "test" };
  backend.writeAutoRefreshQueueCurrent_(current, false);

  const result = backend.runAdminApiMethod_("getAutoRefreshDiagnostics", ["secret"]);

  assert.equal(result.ok, true);
  assert.equal(result.enabled, true);
  assert.equal(result.current.runId, runId);
  assert.equal(result.current.status, "finalizing");
  assert.equal(result.current.phase, "cloudflare-publish");
  assert.equal(result.current.currentTaskIndex, finalizeTask.index);
  assert.equal(result.current.taskSummary.taskId, finalizeTask.taskId);
  assert.equal(result.current.cloudflarePublicDataPublish.status, "publishing");
  assert.equal(result.currentTask.taskId, finalizeTask.taskId);
  assert.equal(result.currentTask.status, "running");
  assert.equal(result.activeRosterJobLock.owner, "auto-refresh-worker");
  assert.equal(Object.prototype.hasOwnProperty.call(result.current, "rosterData"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.current, "rosters"), false);
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

test("autoRefreshActiveRosterTick leaves Cloudflare repair to the durable queue after non-queue outcome", () => {
  const backend = loadBackend();
  backend.__properties.set("AUTO_REFRESH_ENABLED", "true");
  backend.startAutoRefreshQueueCoordinator_ = () => ({
    ok: true,
    status: "skipped",
    skipped: true,
    reason: "cooldown",
  });
  let repairCalls = 0;
  backend.repairCloudflareActiveRosterMirrorIfStale_ = (options) => {
    repairCalls++;
    return { ok: true, status: "inSync", label: options.label };
  };

  const result = backend.autoRefreshActiveRosterTick();

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "cooldown");
  assert.equal(repairCalls, 0);
});

test("autoRefreshActiveRosterTick does not repair Cloudflare active mirror while queue is active", () => {
  const backend = loadBackend();
  backend.__properties.set("AUTO_REFRESH_ENABLED", "true");
  backend.startAutoRefreshQueueCoordinator_ = () => ({
    ok: true,
    status: "inProgress",
    inProgress: true,
    processedRosters: 0,
    totalRosters: 2,
  });
  let repairCalls = 0;
  backend.repairCloudflareActiveRosterMirrorIfStale_ = () => {
    repairCalls++;
    return { ok: true };
  };

  const result = backend.autoRefreshActiveRosterTick();

  assert.equal(result.inProgress, true);
  assert.equal(repairCalls, 0);
});

test("cooldown CWL refresh queues season events exactly once and updates active-war hash", () => {
  const backend = installMemoryFirebase(loadBackend(), buildCurrentCwlEventDb());
  const sourceData = buildRosterData();
  sourceData.rosters = [sourceData.rosters[0]];
  sourceData.rosterOrder = ["main"];
  installPublishedActiveVersion(backend, sourceData);
  backend.isRecentSuccessfulActiveWrite_ = () => true;
  backend.getLastSuccessfulActiveWriteAt_ = () => "2026-07-04T00:00:00.000Z";
  backend.getLastSuccessfulActiveWriteSource_ = () => "manual";
  backend.tryReconcileRegularWarFinalizationTriggerState_ = () => null;
  let activeSnapshotReads = 0;
  backend.readActiveRosterSnapshot_ = () => {
    activeSnapshotReads++;
    throw new Error("cooldown CWL refresh should use active-version coordinator-light source");
  };
  let war = buildOneRoundCwlWar({ state: "inWar", stars: 2, destruction: 80 });
  installCwlFetch(backend, () => war);
  const publishLabels = [];
  backend.enqueueCloudflareSeasonEventPublication_ = (eventId, label, options) => {
    publishLabels.push({ eventId, label, options });
    return { ok: true, queued: true, eventId };
  };
  const originalFirebaseRequestJson = backend.firebaseRequestJson_;
  const getPaths = [];
  backend.firebaseRequestJson_ = (pathRaw, methodRaw, payloadRaw, queryParamsRaw) => {
    if (String(methodRaw || "GET").toUpperCase() === "GET") getPaths.push(String(pathRaw || ""));
    return originalFirebaseRequestJson(pathRaw, methodRaw, payloadRaw, queryParamsRaw);
  };

  const first = backend.startAutoRefreshQueueCoordinator_({
    executionStartMs: Date.now(),
    startedAt: "2026-07-04T00:00:00.000Z",
  });
  assert.equal(publishLabels.length, 1);
  const firstTickGetPaths = getPaths.slice();
  const firstLive = backend.readCwlSeasonEventAggregate_("cwl-active", "live");
  const firstHash = firstLive.hash;
  war = buildOneRoundCwlWar({ state: "inWar", stars: 3, destruction: 100 });
  getPaths.length = 0;
  const second = backend.startAutoRefreshQueueCoordinator_({
    executionStartMs: Date.now(),
    startedAt: "2026-07-04T02:00:00.000Z",
  });
  const secondLive = backend.readCwlSeasonEventAggregate_("cwl-active", "live");

  assert.equal(first.skipped, true);
  assert.equal(first.reason, "cooldown");
  assert.equal(first.cwlSeasonEventRefresh.ok, true);
  assert.equal(first.cwlSeasonEventRefresh.status, "active");
  assert.equal(first.cwlSeasonEventCloudflarePublish.ok, true);
  assert.equal(publishLabels.length, 2);
  assert.deepEqual(publishLabels.map((entry) => entry.label), ["cwl-lifecycle-active", "cwl-lifecycle-active"]);
  assert.equal(activeSnapshotReads, 0);
  assert.equal(firstTickGetPaths.some((path) => path.startsWith("activeVersions/source-1/playerMetrics")), false);
  assert.equal(firstLive.byTag["#PLAYER"].starsTotal, 2);
  assert.equal(second.cwlSeasonEventRefresh.status, "active");
  assert.equal(second.cwlSeasonEventCloudflarePublish.ok, true);
  assert.equal(secondLive.byTag["#PLAYER"].starsTotal, 3);
  assert.notEqual(secondLive.hash, firstHash);
});

test("cooldown CWL refresh does not publish when not needed or collection fails", () => {
  const notNeeded = installMemoryFirebase(loadBackend());
  installPublishedActiveVersion(notNeeded, buildRosterData());
  notNeeded.isRecentSuccessfulActiveWrite_ = () => true;
  notNeeded.getLastSuccessfulActiveWriteAt_ = () => "2026-07-04T00:00:00.000Z";
  notNeeded.getLastSuccessfulActiveWriteSource_ = () => "manual";
  notNeeded.tryReconcileRegularWarFinalizationTriggerState_ = () => null;
  let publishCalls = 0;
  notNeeded.publishCloudflareSeasonEventsAndDonationDataBestEffort_ = () => {
    publishCalls++;
    return { ok: true };
  };

  const notNeededResult = notNeeded.startAutoRefreshQueueCoordinator_({
    executionStartMs: Date.now(),
    startedAt: "2026-07-04T00:00:00.000Z",
  });

  assert.equal(notNeededResult.cwlSeasonEventRefresh.status, "not-needed");
  assert.equal(notNeededResult.cwlSeasonEventCloudflarePublish.reason, "cwl-refresh-not-attempted");
  assert.equal(publishCalls, 0);

  const failed = installMemoryFirebase(loadBackend(), buildCurrentCwlEventDb());
  installPublishedActiveVersion(failed, buildRosterData());
  failed.isRecentSuccessfulActiveWrite_ = () => true;
  failed.getLastSuccessfulActiveWriteAt_ = () => "2026-07-04T00:00:00.000Z";
  failed.getLastSuccessfulActiveWriteSource_ = () => "manual";
  failed.tryReconcileRegularWarFinalizationTriggerState_ = () => null;
  failed.buildCwlCoordinatorResult_ = () => {
    throw new Error("collection failed");
  };
  failed.publishCloudflareSeasonEventsAndDonationDataBestEffort_ = () => {
    publishCalls++;
    return { ok: true };
  };

  const failedResult = failed.startAutoRefreshQueueCoordinator_({
    executionStartMs: Date.now(),
    startedAt: "2026-07-04T02:00:00.000Z",
  });

  assert.equal(failedResult.cwlSeasonEventRefresh.ok, false);
  assert.match(failedResult.cwlSeasonEventRefresh.error, /collection failed/);
  assert.equal(failedResult.cwlSeasonEventCloudflarePublish.reason, "cwl-refresh-failed");
  assert.equal(publishCalls, 0);
});

test("cooldown CWL queue failure remains separate from Firebase refresh success", () => {
  const backend = installMemoryFirebase(loadBackend(), buildCurrentCwlEventDb());
  const sourceData = buildRosterData();
  sourceData.rosters = [sourceData.rosters[0]];
  sourceData.rosterOrder = ["main"];
  installPublishedActiveVersion(backend, sourceData);
  backend.isRecentSuccessfulActiveWrite_ = () => true;
  backend.getLastSuccessfulActiveWriteAt_ = () => "2026-07-04T00:00:00.000Z";
  backend.getLastSuccessfulActiveWriteSource_ = () => "manual";
  backend.tryReconcileRegularWarFinalizationTriggerState_ = () => null;
  installCwlFetch(backend, buildOneRoundCwlWar({ state: "inWar", stars: 3 }));
  backend.enqueueCloudflareSeasonEventPublication_ = () => ({
    ok: false,
    error: "queue write failed",
  });

  const result = backend.startAutoRefreshQueueCoordinator_({
    executionStartMs: Date.now(),
    startedAt: "2026-07-04T00:00:00.000Z",
  });
  const live = backend.readCwlSeasonEventAggregate_("cwl-active", "live");

  assert.equal(result.ok, true);
  assert.equal(result.cwlSeasonEventRefresh.ok, true);
  assert.equal(result.cwlSeasonEventRefresh.status, "active");
  assert.equal(result.cwlSeasonEventCloudflarePublish.ok, false);
  assert.equal(result.cwlSeasonEventCloudflarePublish.error, "queue write failed");
  assert.equal(live.byTag["#PLAYER"].starsTotal, 3);
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

test("autoRefreshWorkerTick leaves Cloudflare repair to the durable queue after skipped worker outcome", () => {
  const backend = loadBackend();
  backend.__properties.set("AUTO_REFRESH_ENABLED", "true");
  backend.continueAutoRefreshQueueWorker_ = () => ({
    ok: true,
    status: "skipped",
    skipped: true,
    reason: "noRun",
  });
  let repairCalls = 0;
  backend.repairCloudflareActiveRosterMirrorIfStale_ = (options) => {
    repairCalls++;
    return { ok: true, status: "repaired", label: options.label };
  };

  const result = backend.autoRefreshWorkerTick();

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "noRun");
  assert.equal(repairCalls, 0);
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
  assert.equal(current.taskCount, 5);
  assert.equal(current.rosterIds.length, 2);
  assert.equal(backend.readAutoRefreshTask_(current.runId, current.taskIds[0]).type, "cwlCoordinator");
  assert.equal(backend.readAutoRefreshTask_(current.runId, current.taskIds[1]).type, "roster");
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

test("queue coordinator references published source version without copying full source payloads", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildRosterData());
  backend.__properties.set("AUTO_REFRESH_ENABLED", "true");
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: data, text: JSON.stringify(data), versionId: "source-1" });
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

  assert.equal(result.inProgress, true);
  assert.equal(current.sourceVersionId, "source-1");
  assert.equal(sourceMeta.sourceVersionId, "source-1");
  assert.equal(sourceMeta.sourceShardMode, "activeVersion");
  assert.equal(sourceRosters, null);
  assert.equal(sourceMetrics, null);
  assert.ok(sourceSeeds.byTag["#PLAYER"]);
});

test("queue coordinator reads published source version without full playerMetrics payload", () => {
  const backend = installMemoryFirebase(loadBackend());
  const sourceData = buildRosterData();
  sourceData.playerMetrics.byTag["#PLAYER"] = {
    identity: { tag: "#PLAYER", name: "Player" },
    latestSnapshot: { tag: "#PLAYER", name: "Player", trophies: 5000 },
    trophyHistoryDaily: [],
    donationCycles: [],
  };
  const data = backend.validateRosterData_(sourceData);
  const sourceManifest = backend.buildActiveVersionManifestFromValidatedData_("source-1", data, {
    source: "test",
    runId: "source-1",
    publishedAt: "2026-05-25T00:00:00.000Z",
    sourceFingerprint: "fingerprint-1",
  });
  backend.firebaseRequestJson_("activePublished/currentVersionId", "PUT", "source-1");
  backend.firebaseRequestJson_("activeVersions/source-1/manifest", "PUT", backend.encodeFirebaseObjectKeysRecursive_(sourceManifest));
  for (const roster of data.rosters) {
    backend.firebaseRequestJson_("activeVersions/source-1/rosters/" + roster.id, "PUT", backend.encodeFirebaseObjectKeysRecursive_(roster));
  }
  backend.firebaseRequestJson_("activeVersions/source-1/playerMetrics", "PUT", backend.encodeFirebaseObjectKeysRecursive_(data.playerMetrics));
  backend.__properties.set("AUTO_REFRESH_ENABLED", "true");
  backend.readActiveRosterSnapshot_ = () => {
    throw new Error("coordinator should not read the full active payload");
  };
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
  const firstTask = backend.readAutoRefreshTask_(current.runId, current.taskIds[0]);
  const stagedMetrics = backend.decodeFirebaseObjectKeysRecursive_(
    backend.firebaseRequestJson_("activeVersions/" + current.runId + "/playerMetrics", "GET"),
  );

  assert.equal(result.inProgress, true);
  assert.equal(current.sourceVersionId, "source-1");
  assert.equal(current.sourceFingerprint, "fingerprint-1");
  assert.equal(firstTask.type, "metricCopy");
  assert.equal(sourceMeta.metricCopyKeyCount, 1);
  assert.equal(sourceMeta.sourceMetricEntryCount, 0);
  assert.equal(backend.readAutoRefreshRunShard_(current.runId, "source/playerMetrics"), null);
  assert.equal(Object.keys(stagedMetrics.byTag).length, 0);
});

test("metric copy queue task stages source metric entries in the target active version", () => {
  const backend = installMemoryFirebase(loadBackend());
  const encodedTag = backend.encodeFirebaseObjectKey_("#PLAYER");
  backend.firebaseRequestJson_("activeVersions/source-1/playerMetrics/byTag/" + encodedTag, "PUT", backend.encodeFirebaseObjectKeysRecursive_({
    identity: { tag: "#PLAYER", name: "Player" },
    latestSnapshot: { tag: "#PLAYER", name: "Player", trophies: 5000 },
    trophyHistoryDaily: [],
    donationCycles: [],
  }));
  const tasks = backend.buildAutoRefreshQueueTasks_("run-1", ["main"], { metricCopyKeys: [encodedTag] });
  const current = backend.writeAutoRefreshQueueCurrent_({
    runId: "run-1",
    kind: "auto-refresh-queue",
    status: "running",
    sourceVersionId: "source-1",
    rosterIds: ["main"],
    taskIds: tasks.map((task) => task.taskId),
    taskCount: tasks.length,
  });
  backend.writeAutoRefreshQueueTasks_("run-1", tasks);

  const result = backend.executeAutoRefreshMetricCopyTask_(current, tasks[0], Date.now());
  const copiedEntry = backend.decodeFirebaseObjectKeysRecursive_(
    backend.firebaseRequestJson_("activeVersions/run-1/playerMetrics/byTag/" + encodedTag, "GET"),
  );
  const marker = backend.readAutoRefreshRunShard_("run-1", "metricCopies/" + tasks[0].taskId);

  assert.equal(result.copiedCount, 1);
  assert.equal(result.missingCount, 0);
  assert.equal(copiedEntry.latestSnapshot.trophies, 5000);
  assert.equal(marker.copiedCount, 1);
});

test("metric copy reads one bounded Firebase key range per task and preserves values", () => {
  const backend = installMemoryFirebase(loadBackend());
  const encodedKeys = ["#B", "#A", "#Ü/[]", "plain.key", "normal"]
    .map((key) => backend.encodeFirebaseObjectKey_(key));
  const sourceByKey = buildMetricSourceMap(backend, encodedKeys);
  const sourcePath = "activeVersions/source-1/playerMetrics/byTag";
  backend.firebaseRequestJson_(sourcePath, "PUT", sourceByKey);
  const { tasks, current } = setupMetricCopyRun(backend, encodedKeys);
  const { rangeRequests } = installMetricRangeResponse(backend, sourceByKey);

  const result = backend.executeAutoRefreshMetricCopyTask_(current, tasks[0], Date.now());
  const destination = backend.firebaseRequestJson_("activeVersions/run-1/playerMetrics/byTag", "GET");
  const marker = backend.readAutoRefreshRunShard_("run-1", "metricCopies/" + tasks[0].taskId);

  assert.equal(rangeRequests.length, 1);
  assert.equal(rangeRequests[0].path, sourcePath);
  assert.equal(rangeRequests[0].query.orderBy, JSON.stringify("$key"));
  assert.equal(rangeRequests[0].query.startAt, JSON.stringify(tasks[0].metricKeys[0]));
  assert.equal(rangeRequests[0].query.endAt, JSON.stringify(tasks[0].metricKeys.at(-1)));
  assert.equal(result.copiedCount, encodedKeys.length);
  assert.equal(result.missingCount, 0);
  assert.deepEqual(clone(destination), clone(sourceByKey));
  assert.equal(marker.copiedCount, encodedKeys.length);
});

test("metric range query quotes and URL-encodes Firebase query parameters", () => {
  const backend = loadBackend();
  const requests = [];
  const first = backend.encodeFirebaseObjectKey_("#Ü/[]");
  backend.getFirebaseConfig_ = () => ({ dbUrl: "https://firebase.test/db" });
  backend.getFirebaseAccessToken_ = () => "token";
  backend.UrlFetchApp = {
    fetch(url) {
      requests.push(url);
      return {
        getResponseCode: () => 200,
        getContentText: () => "{}",
      };
    },
  };

  backend.firebaseRequestJson_("activeVersions/source-1/playerMetrics/byTag", "GET", undefined, {
    orderBy: JSON.stringify("$key"),
    startAt: JSON.stringify(first),
    endAt: JSON.stringify(first),
  });

  assert.equal(
    requests[0],
    "https://firebase.test/db/activeVersions/source-1/playerMetrics/byTag.json?orderBy=%22%24key%22&startAt=" +
      encodeURIComponent(JSON.stringify(first)) +
      "&endAt=" +
      encodeURIComponent(JSON.stringify(first)),
  );
});

test("metric keys sort deterministically before bounded chunking", () => {
  const backend = loadBackend();
  const rawKeys = Array.from({ length: 205 }, (_value, index) => "#METRIC" + String(index).padStart(3, "0")).reverse();
  const encodedKeys = rawKeys.map((key) => backend.encodeFirebaseObjectKey_(key));
  const tasks = backend.buildAutoRefreshQueueTasks_("run-1", ["main"], {
    metricCopyKeys: encodedKeys,
    metricCopyTaskTagLimit: 100,
  }).filter((task) => task.type === "metricCopy");
  const expectedKeys = encodedKeys.slice().sort();

  assert.deepEqual(Array.from(tasks.map((task) => task.metricKeys.length)), [100, 100, 5]);
  assert.deepEqual(Array.from(tasks.flatMap((task) => task.metricKeys)), expectedKeys);
  assert.equal(new Set(Array.from(tasks.flatMap((task) => task.metricKeys))).size, expectedKeys.length);
});

test("metric copy rejects a missing expected range key before writing a marker", () => {
  const backend = installMemoryFirebase(loadBackend());
  const encodedKeys = ["#A", "#B", "#C"].map((key) => backend.encodeFirebaseObjectKey_(key));
  const sourceByKey = buildMetricSourceMap(backend, encodedKeys);
  const { tasks, current, runId } = setupMetricCopyRun(backend, encodedKeys);
  const incomplete = Object.assign({}, sourceByKey);
  delete incomplete[encodedKeys[1]];
  installMetricRangeResponse(backend, incomplete);

  assert.throws(
    () => backend.executeAutoRefreshMetricCopyTask_(current, tasks[0], Date.now()),
    /missing source metric key/,
  );
  assert.equal(backend.readAutoRefreshRunShard_(runId, "metricCopies/" + tasks[0].taskId), null);
  assert.equal(backend.readAutoRefreshTask_(runId, tasks[0].taskId).status, "pending");
});

test("metric copy rejects an unexpected key returned inside the range", () => {
  const backend = installMemoryFirebase(loadBackend());
  const encodedKeys = ["#A", "#B"].map((key) => backend.encodeFirebaseObjectKey_(key));
  const sourceByKey = buildMetricSourceMap(backend, encodedKeys);
  const { tasks, current, runId } = setupMetricCopyRun(backend, encodedKeys);
  const unexpectedKey = backend.encodeFirebaseObjectKey_("#UNEXPECTED");
  const response = Object.assign({}, sourceByKey, buildMetricSourceMap(backend, [unexpectedKey]));
  installMetricRangeResponse(backend, response);

  assert.throws(
    () => backend.executeAutoRefreshMetricCopyTask_(current, tasks[0], Date.now()),
    /unexpected key/,
  );
  assert.equal(backend.readAutoRefreshRunShard_(runId, "metricCopies/" + tasks[0].taskId), null);
});

test("empty metric-copy chunks complete without a Firebase range read", () => {
  const backend = installMemoryFirebase(loadBackend());
  const { tasks, current, runId } = setupMetricCopyRun(backend, []);
  const { rangeRequests } = installMetricRangeResponse(backend, {});

  const result = backend.executeAutoRefreshMetricCopyTask_(current, tasks[0], Date.now());
  const marker = backend.readAutoRefreshRunShard_(runId, "metricCopies/" + tasks[0].taskId);

  assert.equal(rangeRequests.length, 0);
  assert.equal(result.copiedCount, 0);
  assert.equal(result.missingCount, 0);
  assert.equal(marker.requestedCount, 0);
  assert.equal(marker.copiedCount, 0);
});

test("failed metric range reads leave the task resumable without completion", () => {
  const backend = installMemoryFirebase(loadBackend());
  const encodedKeys = ["#A", "#B"].map((key) => backend.encodeFirebaseObjectKey_(key));
  const { tasks, current, runId } = setupMetricCopyRun(backend, encodedKeys);
  const originalFirebaseRequestJson = backend.firebaseRequestJson_;
  backend.firebaseRequestJson_ = (pathRaw, methodRaw = "GET", payloadRaw, queryParamsRaw) => {
    if (String(methodRaw).toUpperCase() === "GET" && queryParamsRaw && queryParamsRaw.orderBy) throw new Error("range read failed");
    return originalFirebaseRequestJson(pathRaw, methodRaw, payloadRaw, queryParamsRaw);
  };

  assert.throws(
    () => backend.executeAutoRefreshMetricCopyTask_(current, tasks[0], Date.now()),
    /range read failed/,
  );
  assert.equal(backend.readAutoRefreshRunShard_(runId, "metricCopies/" + tasks[0].taskId), null);
  assert.equal(backend.readAutoRefreshTask_(runId, tasks[0].taskId).status, "pending");
});

test("metric copy remains idempotent after its completion marker exists", () => {
  const backend = installMemoryFirebase(loadBackend());
  const encodedKeys = ["#A", "#B"].map((key) => backend.encodeFirebaseObjectKey_(key));
  const sourceByKey = buildMetricSourceMap(backend, encodedKeys);
  const { tasks, current } = setupMetricCopyRun(backend, encodedKeys);
  const range = installMetricRangeResponse(backend, sourceByKey);

  const first = backend.executeAutoRefreshMetricCopyTask_(current, tasks[0], Date.now());
  backend.firebaseRequestJson_ = (pathRaw, methodRaw = "GET", payloadRaw, queryParamsRaw) => {
    if (queryParamsRaw && queryParamsRaw.orderBy) throw new Error("idempotent retry must not read range");
    return range.originalFirebaseRequestJson(pathRaw, methodRaw, payloadRaw, queryParamsRaw);
  };
  const second = backend.executeAutoRefreshMetricCopyTask_(current, tasks[0], Date.now());

  assert.equal(first.copiedCount, encodedKeys.length);
  assert.equal(second.skipped, true);
  assert.equal(second.reason, "resultExists");
  assert.equal(range.rangeRequests.length, 1);
});

test("interruption after metric read does not create a completion marker", () => {
  const backend = installMemoryFirebase(loadBackend());
  const encodedKeys = ["#A", "#B"].map((key) => backend.encodeFirebaseObjectKey_(key));
  const sourceByKey = buildMetricSourceMap(backend, encodedKeys);
  const { tasks, current, runId } = setupMetricCopyRun(backend, encodedKeys);
  installMetricRangeResponse(backend, sourceByKey);
  backend.firebaseBatchPutJson_ = () => {
    throw new Error("write interrupted");
  };

  assert.throws(
    () => backend.executeAutoRefreshMetricCopyTask_(current, tasks[0], Date.now()),
    /write interrupted/,
  );
  assert.equal(backend.readAutoRefreshRunShard_(runId, "metricCopies/" + tasks[0].taskId), null);
});

test("one thousand metric entries use ten bounded reads and preserve the old result", () => {
  const backend = installMemoryFirebase(loadBackend());
  const encodedKeys = Array.from({ length: 1000 }, (_value, index) => backend.encodeFirebaseObjectKey_("#METRIC" + String(index).padStart(4, "0")));
  const sourceByKey = buildMetricSourceMap(backend, encodedKeys);
  const sourcePath = "activeVersions/source-1/playerMetrics/byTag";
  backend.firebaseRequestJson_(sourcePath, "PUT", sourceByKey);
  const { tasks, current } = setupMetricCopyRun(backend, encodedKeys, { chunkLimit: 100 });
  const originalFirebaseRequestJson = backend.firebaseRequestJson_;
  let rangeReadCount = 0;
  backend.firebaseRequestJson_ = (pathRaw, methodRaw = "GET", payloadRaw, queryParamsRaw) => {
    const method = String(methodRaw || "GET").toUpperCase();
    if (method === "GET" && String(pathRaw || "").replace(/^\/+|\/+$/g, "") === sourcePath && queryParamsRaw && queryParamsRaw.orderBy) {
      rangeReadCount++;
      const startAt = JSON.parse(queryParamsRaw.startAt);
      const endAt = JSON.parse(queryParamsRaw.endAt);
      const response = {};
      const keys = Object.keys(sourceByKey).filter((key) => key >= startAt && key <= endAt);
      for (let i = 0; i < keys.length; i++) response[keys[i]] = sourceByKey[keys[i]];
      return response;
    }
    return originalFirebaseRequestJson(pathRaw, methodRaw, payloadRaw, queryParamsRaw);
  };

  const metricTasks = tasks.filter((task) => task.type === "metricCopy");
  for (let i = 0; i < metricTasks.length; i++) backend.executeAutoRefreshMetricCopyTask_(current, metricTasks[i], Date.now());
  const destination = originalFirebaseRequestJson(sourcePath.replace("source-1", "run-1"), "GET");

  assert.equal(metricTasks.length, 10);
  assert.equal(rangeReadCount, 10);
  assert.equal(Object.keys(destination).length, 1000);
  assert.deepEqual(clone(destination), clone(sourceByKey));
  for (let i = 0; i < metricTasks.length; i++) {
    assert.equal(backend.readAutoRefreshRunShard_("run-1", "metricCopies/" + metricTasks[i].taskId).copiedCount, 100);
  }
});

test("daily UrlFetch quota errors pause the worker without rapid retries", () => {
  const backend = loadBackend();
  backend.getFirebaseConfig_ = () => ({ dbUrl: "https://firebase.test/db" });
  backend.getFirebaseAccessToken_ = () => "token";
  backend.UrlFetchApp = {
    fetch() {
      throw new Error("Service invoked too many times for one day: urlfetch");
    },
  };
  assert.throws(
    () => backend.firebaseRequestJson_("activeVersions/source-1/playerMetrics/byTag", "GET"),
    (err) => err && err.firebaseDailyUrlFetchQuota === true && err.autoRefreshDefer === true && err.reason === "firebaseUrlFetchQuota",
  );

  const worker = installMemoryFirebase(loadBackend());
  const { runId, tasks } = setupMetricCopyRun(worker, [worker.encodeFirebaseObjectKey_("#A")]);
  worker.executeAutoRefreshMetricCopyTask_ = () => {
    const err = new Error("Service invoked too many times for one day: urlfetch");
    err.firebaseDailyUrlFetchQuota = true;
    err.autoRefreshDefer = true;
    err.reason = "firebaseUrlFetchQuota";
    throw err;
  };
  const result = worker.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() });

  assert.equal(result.reason, "firebaseUrlFetchQuota");
  assert.equal(result.quotaPaused, true);
  assert.equal(worker.__triggers.length, 0);
  assert.equal(worker.readAutoRefreshQueueCurrent_().runId, runId);
  assert.equal(worker.readAutoRefreshTask_(runId, tasks[0].taskId).status, "running");

  const entryWorker = installMemoryFirebase(loadBackend());
  entryWorker.isAutoRefreshEnabled_ = () => true;
  entryWorker.readAutoRefreshQueueCurrent_ = () => {
    const err = new Error("Service invoked too many times for one day: urlfetch");
    err.firebaseDailyUrlFetchQuota = true;
    throw err;
  };
  const entryResult = entryWorker.autoRefreshWorkerTick();
  assert.equal(entryResult.reason, "firebaseUrlFetchQuota");
  assert.equal(entryResult.quotaPaused, true);
  assert.equal(entryWorker.__triggers.length, 0);
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

test("CWL prep sync retains and marks unlinked locked-out players after they leave the connected clan", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildPrepOutRosterData());
  backend.fetchClanMembersSnapshot_ = (clanTag) => ({
    clanTag,
    capturedAt: "2026-05-25T00:00:00.000Z",
    members: [],
    metricsMembers: [],
  });

  const result = backend.syncClanRosterPoolCore_(data, "main");
  const roster = result.rosterData.rosters.find((entry) => entry.id === "main");

  assert.equal(result.result.cwlPreparationClanAbsent, 1);
  assert.deepEqual(playerTags(roster.main), []);
  assert.deepEqual(playerTags(roster.subs), ["#8CCVV"]);
  assert.deepEqual(playerTags(roster.missing), []);
  assert.equal(roster.cwlPreparation.lockStateByTag["#8CCVV"], "lockedOut");
  assert.equal(roster.cwlPreparation.clanAbsentTagSet["#8CCVV"], true);
});

test("CWL prep sync marks Discord-linked locked-out players the same way when absent", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildPrepOutRosterData({
    identity: {
      discordId: "123456789012345678",
      discordUsername: "departed",
      discordSource: "discord-sync",
    },
  }));
  backend.fetchClanMembersSnapshot_ = (clanTag) => ({
    clanTag,
    capturedAt: "2026-05-25T00:00:00.000Z",
    members: [],
    metricsMembers: [],
  });

  const result = backend.syncClanRosterPoolCore_(data, "main");
  const roster = result.rosterData.rosters.find((entry) => entry.id === "main");

  assert.equal(result.result.cwlPreparationClanAbsent, 1);
  assert.deepEqual(playerTags(roster.main), []);
  assert.deepEqual(playerTags(roster.subs), ["#8CCVV"]);
  assert.deepEqual(playerTags(roster.missing), []);
  assert.equal(roster.cwlPreparation.lockStateByTag["#8CCVV"], "lockedOut");
  assert.equal(roster.cwlPreparation.clanAbsentTagSet["#8CCVV"], true);
});

test("CWL prep sync marks locked-in players absent from the connected clan", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildPrepOutRosterData({
    lockState: "lockedIn",
  }));
  backend.fetchClanMembersSnapshot_ = (clanTag) => ({
    clanTag,
    capturedAt: "2026-05-25T00:00:00.000Z",
    members: [],
    metricsMembers: [],
  });

  const result = backend.syncClanRosterPoolCore_(data, "main");
  const roster = result.rosterData.rosters.find((entry) => entry.id === "main");

  assert.equal(result.result.cwlPreparationClanAbsent, 1);
  assert.deepEqual(playerTags(roster.main), ["#8CCVV"]);
  assert.deepEqual(playerTags(roster.subs), []);
  assert.deepEqual(playerTags(roster.missing), []);
  assert.equal(roster.cwlPreparation.lockStateByTag["#8CCVV"], "lockedIn");
  assert.equal(roster.cwlPreparation.clanAbsentTagSet["#8CCVV"], true);
  assert.match(roster.cwlPreparation.clanAbsentUpdatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("CWL prep sync clears absent marker when a player rejoins the connected clan", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = buildPrepOutRosterData({
    identity: {
      discordId: "123456789012345678",
      discordUsername: "departed",
      discordSource: "discord-sync",
    },
  });
  data.rosters[0].cwlPreparation.clanAbsentTagSet = { "#8CCVV": true };
  data.rosters[0].cwlPreparation.clanAbsentUpdatedAt = "2026-05-25T00:00:00.000Z";
  const validated = backend.validateRosterData_(data);
  backend.fetchClanMembersSnapshot_ = (clanTag) => ({
    clanTag,
    capturedAt: "2026-05-26T00:00:00.000Z",
    members: clanTag === "#2LUCULP" ? [{ tag: "#8CCVV", name: "Departed", th: 15 }] : [],
    metricsMembers: [],
  });

  const result = backend.syncClanRosterPoolCore_(validated, "main");
  const roster = result.rosterData.rosters.find((entry) => entry.id === "main");

  assert.equal(result.result.cwlPreparationClanAbsent, 0);
  assert.equal(roster.cwlPreparation.clanAbsentTagSet["#8CCVV"], undefined);
});

test("CWL prep sync treats players in another connected clan as cross-owned, not departed", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildPrepOutRosterData());
  backend.fetchClanMembersSnapshot_ = (clanTag) => ({
    clanTag,
    capturedAt: "2026-05-25T00:00:00.000Z",
    members: clanTag === "#9PYLQG" ? [{ tag: "#8CCVV", name: "Departed", th: 15 }] : [],
    metricsMembers: [],
  });

  const result = backend.syncClanRosterPoolCore_(data, "main");
  const roster = result.rosterData.rosters.find((entry) => entry.id === "main");

  assert.equal(result.result.removedCrossOwned, 1);
  assert.deepEqual(playerTags(roster.main), []);
  assert.deepEqual(playerTags(roster.subs), []);
  assert.deepEqual(playerTags(roster.missing), []);
  assert.equal(roster.cwlPreparation.clanAbsentTagSet["#8CCVV"], undefined);
});

test("CWL prep sync keeps and marks absent players when another connected clan membership read fails", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildPrepOutRosterData());
  backend.fetchClanMembersSnapshot_ = (clanTag) => {
    if (clanTag === "#9PYLQG") throw new Error("temporary clan read failure");
    return {
      clanTag,
      capturedAt: "2026-05-25T00:00:00.000Z",
      members: [],
      metricsMembers: [],
    };
  };

  const result = backend.syncClanRosterPoolCore_(data, "main");
  const roster = result.rosterData.rosters.find((entry) => entry.id === "main");

  assert.equal(result.result.cwlPreparationClanAbsent, 1);
  assert.deepEqual(playerTags(roster.main), []);
  assert.deepEqual(playerTags(roster.subs), ["#8CCVV"]);
  assert.deepEqual(playerTags(roster.missing), []);
  assert.equal(roster.cwlPreparation.clanAbsentTagSet["#8CCVV"], true);
});

test("regular-war pool sync still moves absent players to missing without CWL prep markers", () => {
  const backend = installMemoryFirebase(loadBackend());
  const source = buildRosterData();
  source.rosters[0].connectedClanTag = "#2LUCULP";
  source.rosters[1].connectedClanTag = "#9PYLQG";
  source.rosters[0].main[0].tag = "#8CCVV";
  source.rosters[0].trackingMode = "regularWar";
  const data = backend.validateRosterData_(source);
  backend.fetchClanMembersSnapshot_ = (clanTag) => ({
    clanTag,
    capturedAt: "2026-05-25T00:00:00.000Z",
    members: [],
    metricsMembers: [],
  });

  const result = backend.syncClanRosterPoolCore_(data, "main");
  const roster = result.rosterData.rosters.find((entry) => entry.id === "main");

  assert.equal(result.result.movedToMissing, 1);
  assert.deepEqual(playerTags(roster.main), []);
  assert.deepEqual(playerTags(roster.subs), []);
  assert.deepEqual(playerTags(roster.missing), ["#8CCVV"]);
  assert.equal(roster.cwlPreparation, undefined);
});

test("automatic prep disable clears prep-only absence state without dropping lock state", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildPrepOutRosterData());
  const roster = data.rosters[0];
  roster.cwlPreparation.clanAbsentTagSet = { "#8CCVV": true };
  roster.cwlPreparation.clanAbsentUpdatedAt = "2026-05-25T00:00:00.000Z";
  roster.cwlPreparation.excludedTagSet = { "#OTHER": true };

  const disabled = backend.disableCwlPreparationForAutomaticTransition_(roster);

  assert.equal(disabled, true);
  assert.equal(roster.cwlPreparation.enabled, false);
  assert.equal(Object.keys(roster.cwlPreparation.assignedTagSet).length, 0);
  assert.equal(Object.keys(roster.cwlPreparation.excludedTagSet).length, 0);
  assert.equal(Object.keys(roster.cwlPreparation.clanAbsentTagSet).length, 0);
  assert.equal(roster.cwlPreparation.clanAbsentUpdatedAt, undefined);
  assert.equal(roster.cwlPreparation.lockStateByTag["#8CCVV"], "lockedOut");
  assert.deepEqual(playerTags(roster.main), []);
  assert.deepEqual(playerTags(roster.subs), ["#8CCVV"]);
  assert.deepEqual(playerTags(roster.missing), []);
});

test("automatic active-CWL transition clears prep absence markers and keeps CWL mode", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildPrepOutRosterData());
  data.rosters[0].cwlPreparation.clanAbsentTagSet = { "#8CCVV": true };
  data.rosters[0].cwlPreparation.clanAbsentUpdatedAt = "2026-05-25T00:00:00.000Z";

  const result = backend.detectAndApplyAutomaticTrackingModeTransition_(data, "main", {
    prefetchedLeaguegroupRawByClanTag: {
      "#2LUCULP": {
        state: "inWar",
        clans: [{ tag: "#2LUCULP", members: [] }],
        rounds: [],
      },
    },
  });
  const roster = result.rosterData.rosters.find((entry) => entry.id === "main");

  assert.equal(result.result.cwlPreparationDisabled, true);
  assert.equal(result.result.switchedToRegularWar, false);
  assert.equal(roster.trackingMode, "cwl");
  assert.equal(roster.cwlPreparation.enabled, false);
  assert.equal(Object.keys(roster.cwlPreparation.clanAbsentTagSet).length, 0);
  assert.equal(roster.cwlPreparation.clanAbsentUpdatedAt, undefined);
  assert.deepEqual(playerTags(roster.main), []);
  assert.deepEqual(playerTags(roster.subs), ["#8CCVV"]);
  assert.deepEqual(playerTags(roster.missing), []);
});

test("automatic regular-war transition clears stale prep absence markers without creating missing players", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildPrepOutRosterData());
  const rosterBefore = data.rosters[0];
  rosterBefore.cwlPreparation.enabled = false;
  rosterBefore.cwlPreparation.assignedTagSet = {};
  rosterBefore.cwlPreparation.clanAbsentTagSet = { "#8CCVV": true };
  rosterBefore.cwlPreparation.clanAbsentUpdatedAt = "2026-05-25T00:00:00.000Z";

  const result = backend.detectAndApplyAutomaticTrackingModeTransition_(data, "main", {
    prefetchedCurrentRegularWarByClanTag: {
      "#2LUCULP": {
        available: true,
        state: "inWar",
        clanSide: { tag: "#2LUCULP" },
        opponentSide: { tag: "#9PYLQG" },
      },
    },
  });
  const roster = result.rosterData.rosters.find((entry) => entry.id === "main");

  assert.equal(result.result.cwlPreparationDisabled, false);
  assert.equal(result.result.switchedToRegularWar, true);
  assert.equal(roster.trackingMode, "regularWar");
  assert.equal(roster.cwlPreparation.enabled, false);
  assert.equal(Object.keys(roster.cwlPreparation.clanAbsentTagSet).length, 0);
  assert.equal(roster.cwlPreparation.clanAbsentUpdatedAt, undefined);
  assert.deepEqual(playerTags(roster.main), []);
  assert.deepEqual(playerTags(roster.subs), ["#8CCVV"]);
  assert.deepEqual(playerTags(roster.missing), []);
});

test("queue worker loads source metrics for departed prep-out players before pool sync", () => {
  const backend = installMemoryFirebase(loadBackend());
  const sourceData = buildPrepOutRosterData({
    identity: {
      discordId: "123456789012345678",
      discordUsername: "departed",
      discordSource: "discord-sync",
    },
  });
  const { runId, current, tasks } = setupQueueRun(backend, sourceData, { rosterIds: ["main"] });
  backend.fetchClanMembersSnapshot_ = (clanTag) => ({
    clanTag,
    capturedAt: "2026-05-25T00:00:00.000Z",
    members: [],
    metricsMembers: [],
  });
  backend.processRefreshAllRosterPipelineIntoAccumulator_ = (rosterData, rosterId, options, accumulator) => {
    assert.equal(rosterData.playerMetrics.byTag["#8CCVV"].identity.discordId, "123456789012345678");
    const poolResult = backend.syncClanRosterPoolCore_(rosterData, rosterId, options);
    accumulator.perRoster.push({ rosterId, ok: true, issueCount: 0, issues: [] });
    return {
      rosterData: poolResult.rosterData,
      pipelineResult: {
        memberTracking: { capturedPlayers: 0 },
        pool: poolResult.result,
      },
    };
  };

  backend.executeAutoRefreshRosterTask_(current, firstRosterTask(tasks), Date.now());
  const activeRosterShard = backend.decodeFirebaseObjectKeysRecursive_(
    backend.firebaseRequestJson_("activeVersions/" + runId + "/rosters/main", "GET"),
  );

  assert.deepEqual(playerTags(activeRosterShard.main), []);
  assert.deepEqual(playerTags(activeRosterShard.subs), ["#8CCVV"]);
  assert.deepEqual(playerTags(activeRosterShard.missing), []);
});

test("queue worker reads immutable source version shards when sourceVersionId is available", () => {
  const backend = installMemoryFirebase(loadBackend());
  const sourceData = buildPrepOutRosterData({
    identity: {
      discordId: "123456789012345678",
      discordUsername: "departed",
      discordSource: "discord-sync",
    },
  });
  const data = backend.validateRosterData_(sourceData);
  backend.firebaseRequestJson_("activeVersions/source-1/rosters/main", "PUT", backend.encodeFirebaseObjectKeysRecursive_(data.rosters[0]));
  backend.firebaseRequestJson_("activeVersions/source-1/playerMetrics", "PUT", backend.encodeFirebaseObjectKeysRecursive_(data.playerMetrics));
  const { runId, current, tasks } = setupQueueRun(backend, data, {
    rosterIds: ["main"],
    sourceVersionId: "source-1",
  });
  const originalFirebaseRequestJson = backend.firebaseRequestJson_;
  const reads = [];
  backend.firebaseRequestJson_ = (pathRaw, methodRaw = "GET", payloadRaw) => {
    const path = String(pathRaw || "").replace(/^\/+|\/+$/g, "");
    const method = String(methodRaw || "GET").toUpperCase();
    if (method === "GET") reads.push(path);
    return originalFirebaseRequestJson(pathRaw, methodRaw, payloadRaw);
  };
  backend.fetchClanMembersSnapshot_ = () => ({
    clanTag: "#2LUCULP",
    capturedAt: "2026-05-25T00:00:00.000Z",
    members: [],
    metricsMembers: [],
  });
  backend.processRefreshAllRosterPipelineIntoAccumulator_ = (rosterData, rosterId, options, accumulator) => {
    assert.equal(rosterId, "main");
    assert.equal(rosterData.playerMetrics.byTag["#8CCVV"].identity.discordId, "123456789012345678");
    accumulator.perRoster.push({ rosterId, ok: true, issueCount: 0, issues: [] });
    return {
      rosterData,
      pipelineResult: {
        memberTracking: { capturedPlayers: 0 },
      },
    };
  };

  const result = backend.executeAutoRefreshRosterTask_(current, firstRosterTask(tasks), Date.now());

  assert.equal(result.rosterId, "main");
  assert.equal(backend.readAutoRefreshRunShard_(runId, "source/rosters"), null);
  assert.equal(backend.readAutoRefreshRunShard_(runId, "source/playerMetrics"), null);
  assert.ok(reads.includes("activeVersions/source-1/rosters/main"));
  assert.ok(reads.some((path) => path.startsWith("activeVersions/source-1/playerMetrics/byTag/")));
  assert.equal(reads.some((path) => path.startsWith("internal/autoRefresh/runs/run-1/source/rosters/")), false);
  assert.equal(reads.some((path) => path.startsWith("internal/autoRefresh/runs/run-1/source/playerMetrics/")), false);
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

test("firebaseBatchWriteJson batches write requests and falls back per failed response", () => {
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
        responses(200, "null"),
        responses(500, "server-error"),
      ];
    },
  };
  backend.firebaseRequestJson_ = (pathRaw, methodRaw, payloadRaw) => {
    fallbackCalls.push({ path: pathRaw, method: methodRaw, payload: payloadRaw });
    return { fallback: String(pathRaw) };
  };

  const result = backend.firebaseBatchWriteJson_([
    { path: "ok/path", method: "PUT", payload: { ok: true } },
    { path: "bad/path", method: "PATCH", payload: { retry: true } },
  ]);

  assert.equal(fetchAllRequests.length, 1);
  assert.equal(fetchAllRequests[0].length, 2);
  assert.equal(fetchAllRequests[0][0].headers.Authorization, "Bearer token");
  assert.match(fetchAllRequests[0][0].url, /print=silent/);
  assert.equal(fetchAllRequests[0][0].method, "put");
  assert.equal(fetchAllRequests[0][0].payload, "{\"ok\":true}");
  assert.equal(result[0], null);
  assert.deepEqual(result[1], { fallback: "bad/path" });
  assert.deepEqual(fallbackCalls, [{ path: "bad/path", method: "PATCH", payload: { retry: true } }]);
});

test("firebaseBatchPutJson uses one multi-location root patch for exact child writes", () => {
  const backend = loadBackend();
  const fetchCalls = [];
  backend.getFirebaseConfig_ = () => ({ dbUrl: "https://firebase.test/db" });
  backend.getFirebaseAccessToken_ = () => "token";
  backend.UrlFetchApp = {
    fetch(url, options) {
      fetchCalls.push({ url, options });
      return {
        getResponseCode: () => 200,
        getContentText: () => "",
      };
    },
  };

  const result = backend.firebaseBatchPutJson_([
    { path: "activeVersions/run-1/rosters/main", payload: { id: "main" } },
    { path: "internal/autoRefresh/runs/run-1/warResults/main", payload: { rosterId: "main" } },
  ]);

  assert.equal(result, null);
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0].url, /^https:\/\/firebase\.test\/db\/\.json\?/);
  assert.match(fetchCalls[0].url, /print=silent/);
  assert.equal(fetchCalls[0].options.method, "PATCH");
  assert.deepEqual(JSON.parse(fetchCalls[0].options.payload), {
    "activeVersions/run-1/rosters/main": { id: "main" },
    "internal/autoRefresh/runs/run-1/warResults/main": { rosterId: "main" },
  });
});

test("queue-mode Firebase batches defer instead of serial fallback", () => {
  const backend = loadBackend();
  const response = {
    getResponseCode: () => 500,
    getContentText: () => "server-error",
  };
  const fallbackCalls = [];
  backend.getFirebaseConfig_ = () => ({ dbUrl: "https://firebase.test/db" });
  backend.getFirebaseAccessToken_ = () => "token";
  backend.UrlFetchApp = {
    fetchAll() {
      return [response, response];
    },
    fetch() {
      return response;
    },
  };
  backend.firebaseRequestJson_ = (pathRaw, methodRaw, payloadRaw) => {
    fallbackCalls.push({ path: pathRaw, method: methodRaw, payload: payloadRaw });
    if (!String(pathRaw || "") && String(methodRaw || "").toUpperCase() === "PATCH") {
      throw new Error("root patch failed");
    }
    return { fallback: String(pathRaw) };
  };

  assert.throws(
    () => backend.firebaseBatchGetJson_(["bad/one", "bad/two"], { disableFallback: true }),
    (err) => err && err.autoRefreshDefer === true && err.reason === "firebaseBatch",
  );
  assert.throws(
    () => backend.firebaseBatchPutJson_([{ path: "bad/one", payload: { ok: true } }], { disableFallback: true }),
    (err) => err && err.autoRefreshDefer === true && err.reason === "firebaseBatch",
  );
  assert.equal(fallbackCalls.length, 1);
  assert.equal(fallbackCalls[0].path, "");
  assert.equal(fallbackCalls[0].method, "PATCH");
  assert.equal(fallbackCalls[0].payload["bad/one"].ok, true);
});

test("detached donation refresh is atomic and preserves continuity across version changes and leave/rejoin", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildRosterData());
  const seasonId = "ranked-legend-i-2026-05-18";
  data.playerMetrics.byTag["#PLAYER"] = {
    identity: { tag: "#PLAYER", name: "Player" },
    trophyHistoryDaily: [],
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
        lastSeenAt: "2026-05-20T00:00:00.000Z",
        lastClanTag: "#CLAN",
        resetCount: 0,
        receivedResetCount: 0,
      },
    },
  };
  const versionId = "source-1";
  const manifest = backend.buildActiveVersionManifestFromValidatedData_(versionId, data, {
    publishedAt: "2026-05-20T00:00:00.000Z",
  });
  backend.firebaseRequestJson_("activePublished/currentVersionId", "PUT", versionId);
  backend.firebaseRequestJson_("activeVersions/source-1/manifest", "PUT", backend.encodeFirebaseObjectKeysRecursive_(manifest));
  for (const roster of data.rosters) {
    backend.firebaseRequestJson_(
      "activeVersions/source-1/rosters/" + backend.encodeFirebaseObjectKey_(roster.id),
      "PUT",
      backend.encodeFirebaseObjectKeysRecursive_(roster),
    );
  }
  backend.firebaseRequestJson_("activeVersions/source-1/playerMetrics", "PUT", backend.encodeFirebaseObjectKeysRecursive_(data.playerMetrics));

  const batchWrites = [];
  backend.firebaseBatchPutJson_ = (entriesRaw) => {
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    batchWrites.push(entries.map((entry) => ({ path: entry.path, payload: clone(entry.payload) })));
    for (const entry of entries) backend.firebaseRequestJson_(entry.path, "PUT", entry.payload);
    return null;
  };
  let donationRefreshFetchCalls = 0;
  backend.prefetchClanMembersSnapshotsByTag_ = (clanTags) => {
    assert.equal(JSON.stringify(clanTags.slice().sort()), JSON.stringify(["#CLAN", "#CLAN2"]));
    donationRefreshFetchCalls++;
    const capturedAtByCall = [
      "2026-05-25T00:00:00.000Z",
      "2026-05-25T00:15:00.000Z",
      "2026-05-25T00:30:00.000Z",
      "2026-05-25T00:45:00.000Z",
      "2026-05-25T01:00:00.000Z",
    ];
    const capturedAt = capturedAtByCall[Math.min(donationRefreshFetchCalls - 1, capturedAtByCall.length - 1)];
    const playerDonations = donationRefreshFetchCalls >= 5 ? 170 : donationRefreshFetchCalls >= 3 ? 160 : 125;
    const playerMembers = donationRefreshFetchCalls === 4
      ? []
      : [{ tag: "#PLAYER", name: "Player", trophies: 5000, donations: playerDonations, donationsReceived: 25 }];
    return {
      snapshotByClanTag: {
        "#CLAN": {
          clanTag: "#CLAN",
          capturedAt,
          metricsMembers: playerMembers,
        },
        "#CLAN2": {
          clanTag: "#CLAN2",
          capturedAt,
          metricsMembers: [{ tag: "#SECOND", name: "Second", trophies: 4900, donations: 5, donationsReceived: 1 }],
        },
      },
      errorByClanTag: {},
      requestCount: 2,
      batchCount: 1,
    };
  };

  const result = backend.runDonationRefreshCore_({ lockWaitMs: 0 });
  const playerOverlay = backend.decodeFirebaseObjectKeysRecursive_(
    backend.firebaseRequestJson_(
      "donationRefresh/bySeason/" + seasonId + "/byTag/" + backend.encodeFirebaseObjectKey_("#PLAYER"),
      "GET",
    ),
  );
  const activeLedger = backend.decodeFirebaseObjectKeysRecursive_(
    backend.firebaseRequestJson_(
      "activeVersions/source-1/playerMetrics/byTag/" + backend.encodeFirebaseObjectKey_("#PLAYER") + "/donationCycles/" + seasonId,
      "GET",
    ),
  );

  assert.equal(result.status, "ok");
  assert.equal(result.playerCount, 2);
  assert.equal(result.updatedPlayerCount, 2);
  assert.equal(batchWrites.length, 1);
  assert.equal(playerOverlay.donationCycle.cycleTotalDonations, 125);
  assert.equal(playerOverlay.donationCycle.rawDonationsLastSeen, 125);
  assert.equal(playerOverlay.updatedAt, "2026-05-25T00:00:00.000Z");
  const firstMeta = backend.decodeFirebaseObjectKeysRecursive_(
    backend.firebaseRequestJson_("donationRefresh/current", "GET"),
  );
  assert.equal(firstMeta.updatedAt, "2026-05-25T00:00:00.000Z");
  assert.equal(activeLedger.cycleTotalDonations, 100);
  assert.equal(backend.__properties.has("ACTIVE_DATA_LAST_SUCCESSFUL_WRITE_AT"), false);

  const originalBatchGet = backend.firebaseBatchGetJson_;
  let activeBaseLedgerReadCount = 0;
  backend.firebaseBatchGetJson_ = (pathsRaw) => {
    const paths = Array.isArray(pathsRaw) ? pathsRaw : [];
    activeBaseLedgerReadCount += paths.filter((path) => String(path || "").includes("activeVersions/source-1/playerMetrics/byTag")).length;
    return originalBatchGet(pathsRaw);
  };

  const secondResult = backend.runDonationRefreshCore_({ lockWaitMs: 0 });
  const secondPlayerOverlay = backend.decodeFirebaseObjectKeysRecursive_(
    backend.firebaseRequestJson_(
      "donationRefresh/bySeason/" + seasonId + "/byTag/" + backend.encodeFirebaseObjectKey_("#PLAYER"),
      "GET",
    ),
  );
  const secondMeta = backend.decodeFirebaseObjectKeysRecursive_(
    backend.firebaseRequestJson_("donationRefresh/current", "GET"),
  );

  assert.equal(secondResult.status, "ok");
  assert.equal(secondResult.updatedPlayerCount, 0);
  assert.equal(secondPlayerOverlay.updatedAt, "2026-05-25T00:00:00.000Z");
  assert.equal(secondMeta.updatedAt, "2026-05-25T00:00:00.000Z");
  assert.equal(activeBaseLedgerReadCount, 2);

  const source2Data = clone(data);
  source2Data.playerMetrics.byTag["#PLAYER"].donationCycles[seasonId] = {
    seasonId,
    startsAt: "2026-05-18T05:00:00.000Z",
    endsAt: "2026-06-15T05:00:00.000Z",
    rawDonationsLastSeen: 150,
    rawDonationsReceivedLastSeen: 25,
    cycleTotalDonations: 180,
    cycleTotalDonationsReceived: 25,
    firstSeenAt: "2026-05-20T00:00:00.000Z",
    lastSeenAt: "2026-05-25T00:20:00.000Z",
    lastClanTag: "#CLAN",
    resetCount: 1,
    receivedResetCount: 0,
  };
  const source2Manifest = backend.buildActiveVersionManifestFromValidatedData_("source-2", source2Data, {
    publishedAt: "2026-05-25T00:20:00.000Z",
  });
  backend.firebaseRequestJson_("activeVersions/source-2/manifest", "PUT", backend.encodeFirebaseObjectKeysRecursive_(source2Manifest));
  backend.firebaseRequestJson_("activeVersions/source-2/playerMetrics", "PUT", backend.encodeFirebaseObjectKeysRecursive_(source2Data.playerMetrics));
  backend.firebaseRequestJson_("activePublished/currentVersionId", "PUT", "source-2");

  const rebasedResult = backend.runDonationRefreshCore_({ lockWaitMs: 0 });
  const rebasedOverlay = backend.decodeFirebaseObjectKeysRecursive_(
    backend.firebaseRequestJson_(
      "donationRefresh/bySeason/" + seasonId + "/byTag/" + backend.encodeFirebaseObjectKey_("#PLAYER"),
      "GET",
    ),
  );
  assert.equal(rebasedResult.sourceVersionId, "source-2");
  assert.equal(rebasedOverlay.donationCycle.rawDonationsLastSeen, 160);
  assert.equal(rebasedOverlay.donationCycle.cycleTotalDonations, 190);
  assert.equal(rebasedOverlay.donationCycle.resetCount, 1);

  const leaveResult = backend.runDonationRefreshCore_({ lockWaitMs: 0 });
  const leftOverlay = backend.decodeFirebaseObjectKeysRecursive_(
    backend.firebaseRequestJson_(
      "donationRefresh/bySeason/" + seasonId + "/byTag/" + backend.encodeFirebaseObjectKey_("#PLAYER"),
      "GET",
    ),
  );
  assert.equal(leaveResult.status, "ok");
  assert.equal(leftOverlay.donationCycle.cycleTotalDonations, 190);

  const rejoinResult = backend.runDonationRefreshCore_({ lockWaitMs: 0 });
  const rejoinedOverlay = backend.decodeFirebaseObjectKeysRecursive_(
    backend.firebaseRequestJson_(
      "donationRefresh/bySeason/" + seasonId + "/byTag/" + backend.encodeFirebaseObjectKey_("#PLAYER"),
      "GET",
    ),
  );
  assert.equal(rejoinResult.status, "ok");
  assert.equal(rejoinedOverlay.donationCycle.rawDonationsLastSeen, 170);
  assert.equal(rejoinedOverlay.donationCycle.cycleTotalDonations, 200);

  const pointerBeforeAtomicFailure = backend.firebaseRequestJson_("donationRefresh/current", "GET");
  const overlayBeforeAtomicFailure = backend.firebaseRequestJson_("donationRefresh/bySeason/" + seasonId, "GET");
  const memoryRequest = backend.firebaseRequestJson_;
  const unexpectedSerialWrites = [];
  backend.firebaseRequestJson_ = (pathRaw, methodRaw = "GET", payloadRaw) => {
    const method = String(methodRaw || "GET").toUpperCase();
    if (method !== "GET") unexpectedSerialWrites.push({ path: String(pathRaw || ""), method });
    return memoryRequest(pathRaw, methodRaw, payloadRaw);
  };
  backend.firebaseBatchPutJson_ = () => {
    throw new Error("simulated atomic donation write failure");
  };

  assert.throws(
    () => backend.runDonationRefreshCore_({ lockWaitMs: 0 }),
    /simulated atomic donation write failure/,
  );
  assert.deepEqual(
    backend.firebaseRequestJson_("donationRefresh/current", "GET"),
    pointerBeforeAtomicFailure,
  );
  assert.deepEqual(
    backend.firebaseRequestJson_("donationRefresh/bySeason/" + seasonId, "GET"),
    overlayBeforeAtomicFailure,
  );
  assert.deepEqual(unexpectedSerialWrites, []);
});

test("queue worker treats existing roster result shards as an idempotent retry", () => {
  const backend = installMemoryFirebase(loadBackend());
  const { runId, taskIds } = setupQueueRun(backend, buildRosterData(), {
    rosterIds: ["main"],
    currentTaskIndex: 1,
    processedTasks: 1,
  });
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
  const task = backend.readAutoRefreshTask_(runId, taskIds[1]);
  const current = backend.readAutoRefreshQueueCurrent_();

  assert.equal(result.inProgress, true);
  assert.equal(task.status, "completed");
  assert.equal(current.processedRosters, 1);
  assert.equal(current.currentTaskIndex, 2);
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
    processed.rosters[0].title = "Main Processed";
    accumulator.perRoster.push({ rosterId: "main", ok: true, issueCount: 0, issues: [] });
    return { rosterData: processed, pipelineResult: { memberTracking: { capturedPlayers: 1 } } };
  };

  const result = backend.executeAutoRefreshRosterTask_(current, firstRosterTask(tasks), Date.now());
  const warResult = backend.readAutoRefreshRunShard_(runId, "warResults/main");
  const metricResult = backend.readAutoRefreshRunShard_(runId, "metricResults/main");
  const activeRosterShard = backend.decodeFirebaseObjectKeysRecursive_(
    backend.firebaseRequestJson_("activeVersions/run-1/rosters/main", "GET"),
  );
  const activeMetricEntry = backend.decodeFirebaseObjectKeysRecursive_(
    backend.firebaseRequestJson_("activeVersions/run-1/playerMetrics/byTag/" + backend.encodeFirebaseObjectKey_("#PLAYER"), "GET"),
  );

  assert.equal(result.rosterId, "main");
  assert.equal(fetchCalls, 1);
  assert.equal(processCalls, 1);
  assert.equal(rootSourceRosterGets.length, 0);
  assert.equal(warResult.rosterShardWritten, true);
  assert.equal(warResult.rosterSummary.trackingMode, "cwl");
  assert.equal(metricResult.metricsStaged, true);
  assert.equal(metricResult.entryCount, 1);
  assert.equal(metricResult.tags.join(","), "#PLAYER");
  assert.equal(backend.readAutoRefreshRunShard_(runId, "rosterWrites/main").playerTags.join(","), "#PLAYER");
  assert.equal(activeMetricEntry.latestSnapshot.trophies, 5000);
  assert.equal(activeRosterShard.title, "Main Processed");
});

test("roster queue shards reuse the CWL coordinator view without league or war refetches", () => {
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
  const rawData = buildRosterData();
  rawData.rosters[0].connectedClanTag = "#2LUCULP";
  rawData.rosters[0].main[0].tag = "#8CCVV";
  rawData.playerMetrics.byTag = {
    "#8CCVV": {
      identity: { tag: "#8CCVV", name: "Player" },
      trophyHistoryDaily: [],
      donationCycles: [],
    },
  };
  const data = backend.validateRosterData_(rawData);
  const { current, tasks } = setupQueueRun(backend, data, { rosterIds: ["main"] });
  const leaguegroup = {
    state: "inWar",
    season: "2026-07",
    clans: [{ tag: "#2LUCULP" }, { tag: "#9PYLQG" }],
    rounds: [{ warTags: ["#WAR1"] }],
  };
  const war = {
    state: "inWar",
    startTime: "2026-07-04T20:00:00.000Z",
    endTime: "2026-07-05T20:00:00.000Z",
    clan: {
      tag: "#2LUCULP",
      members: [{ tag: "#8CCVV", name: "Player", attacks: [{ defenderTag: "#BASE", stars: 3, destructionPercentage: 100 }] }],
    },
    opponent: {
      tag: "#9PYLQG",
      members: [{ tag: "#BASE", name: "Base", attacks: [] }],
    },
  };
  backend.cocFetchAllByPathEntries_ = (entriesRaw) => {
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    const dataByKey = {};
    for (const entry of entries) {
      if (entry.path.includes("/currentwar/leaguegroup")) dataByKey[entry.key] = leaguegroup;
      else if (entry.path.includes("/clanwarleagues/wars/")) dataByKey[entry.key] = war;
    }
    return { dataByKey, errorByKey: {}, requestCount: entries.length, batchCount: entries.length ? 1 : 0 };
  };
  const cwlTask = tasks.find((task) => task.type === "cwlCoordinator");
  const cwlResult = backend.executeAutoRefreshCwlCoordinatorTask_(current, cwlTask, Date.now());
  let blockedCwlRequestCount = 0;
  backend.cocFetchAllByPathEntries_ = (entriesRaw) => {
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    if (entries.some((entry) => String(entry.path || "").includes("/currentwar/leaguegroup") || String(entry.path || "").includes("/clanwarleagues/wars/"))) {
      blockedCwlRequestCount += entries.length;
      throw new Error("roster shard should use persisted CWL coordinator view");
    }
    return { dataByKey: {}, errorByKey: {}, requestCount: entries.length, batchCount: entries.length ? 1 : 0 };
  };
  backend.fetchClanMembersSnapshot_ = () => ({
    clanTag: "#2LUCULP",
    members: [{ tag: "#8CCVV", name: "Player", townHallLevel: 16 }],
    metricsMembers: [{ tag: "#8CCVV", name: "Player", trophies: 5000 }],
  });
  backend.processRefreshAllRosterPipelineIntoAccumulator_ = (rosterData, rosterId, options, accumulator) => {
    assert.equal(rosterId, "main");
    assert.equal(options.cwlCoordinatorClanView.clanTag, "#2LUCULP");
    const stats = backend.refreshCwlStatsCore_(rosterData, rosterId, options);
    assert.equal(stats.result.source, "cwlRuntime");
    assert.equal(stats.rosterData.rosters[0].cwlStats.byTag["#8CCVV"].starsTotal, 3);
    accumulator.perRoster.push({ rosterId, ok: true, issueCount: 0, issues: [] });
    return { rosterData: stats.rosterData, pipelineResult: { cwlStats: stats.result } };
  };

  const result = backend.executeAutoRefreshRosterTask_(current, firstRosterTask(tasks), Date.now());

  assert.equal(cwlResult.requestCounts.leagueGroup, 1);
  assert.equal(cwlResult.requestCounts.cwlWar, 1);
  assert.equal(result.rosterId, "main");
  assert.equal(blockedCwlRequestCount, 0);
});

test("roster pipeline does not build a full CWL coordinator when a clan view is supplied", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildRosterData());
  backend.buildCwlCoordinatorResult_ = () => {
    throw new Error("pipeline should use the supplied CWL coordinator clan view");
  };
  const pass = (rosterData) => ({ rosterData, result: {} });
  backend.syncClanRosterPoolCore_ = pass;
  backend.detectAndApplyAutomaticTrackingModeTransition_ = pass;
  backend.syncClanTodayLineupCore_ = pass;
  backend.refreshTrackingStatsCore_ = (rosterData) => ({
    rosterData,
    result: { cwlUnavailable: false, statsUnchanged: false },
  });
  backend.computeBenchSuggestionsCore_ = pass;

  const result = backend.runRosterRefreshPipelineCore_(data, "main", {
    cwlCoordinatorClanView: {
      clanTag: "#CLAN",
      eventId: "cwl-active",
      groupStates: [{ groupId: "group-1", state: "active" }],
      rounds: [],
      currentWar: null,
      aggregateByTag: {},
      settledAggregateByTag: {},
      contributions: [],
      seasonContext: {},
      freshness: { discoveryIncomplete: false },
    },
  });

  assert.equal(result.ok, true);
});

test("legacy roster queue task captures missing shared CWL coordinator before processing", () => {
  const backend = installMemoryFirebase(loadBackend(), buildCurrentCwlEventDb());
  const data = backend.validateRosterData_(buildRosterData());
  const { runId, current, tasks } = setupQueueRun(backend, data, { rosterIds: ["main"] });
  const rosterTask = firstRosterTask(tasks);
  current.taskIds = [rosterTask.taskId];
  current.taskCount = 1;
  current.currentTaskIndex = 0;
  backend.writeAutoRefreshQueueCurrent_(current, false);
  const paths = installCwlFetch(backend, () => buildOneRoundCwlWar({ state: "inWar", stars: 3, destruction: 100 }));
  const originalBuildCwlCoordinatorResult = backend.buildCwlCoordinatorResult_;
  let coordinatorCalls = 0;
  backend.buildCwlCoordinatorResult_ = (...args) => {
    coordinatorCalls++;
    return originalBuildCwlCoordinatorResult(...args);
  };
  const originalFirebaseRequestJson = backend.firebaseRequestJson_;
  const getPaths = [];
  backend.firebaseRequestJson_ = (pathRaw, methodRaw = "GET", payloadRaw, queryParamsRaw) => {
    if (String(methodRaw || "GET").toUpperCase() === "GET") getPaths.push(String(pathRaw || "").replace(/^\/+|\/+$/g, ""));
    return originalFirebaseRequestJson(pathRaw, methodRaw, payloadRaw, queryParamsRaw);
  };
  let clanFetchCalls = 0;
  backend.fetchClanMembersSnapshot_ = () => {
    clanFetchCalls++;
    return {
      clanTag: "#CLAN",
      members: [{ tag: "#PLAYER", name: "Player", townHallLevel: 16 }],
      metricsMembers: [{ tag: "#PLAYER", name: "Player", trophies: 5000 }],
    };
  };
  let pipelineCalls = 0;
  backend.processRefreshAllRosterPipelineIntoAccumulator_ = (rosterData, rosterId, options, accumulator) => {
    pipelineCalls++;
    assert.equal(rosterId, "main");
    assert.equal(options.cwlCoordinatorClanView.clanTag, "#CLAN");
    accumulator.perRoster.push({ rosterId, ok: true, issueCount: 0, issues: [] });
    return {
      rosterData,
      pipelineResult: { memberTracking: { capturedPlayers: 1 } },
    };
  };
	backend.executeAutoRefreshFinalizeTask_ = () => ({ deferred: true, reason: "test-stop-after-roster" });

  const preflight = backend.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() });
  const summary = backend.readAutoRefreshCwlCoordinatorSummary_(runId);
  const getPathsBeforeRoster = getPaths.slice();

  assert.equal(preflight.inProgress, true);
	assert.equal(preflight.reason, "test-stop-after-roster");
  assert.equal(pipelineCalls, 1);
  assert.equal(coordinatorCalls, 1);
  assert.equal(clanFetchCalls, 1);
  assert.equal(summary.completed, true);
  assert.equal(summary.capturePhase, "early");
  assert.equal(summary.viewClanTags.includes("#CLAN"), true);
  assert.equal(paths.filter((path) => path.includes("/currentwar/leaguegroup")).length, 1);
  assert.equal(paths.filter((path) => path.includes("/clanwarleagues/wars/")).length, 1);
});

test("roster queue task defers before pipeline when pre-process reads consume the budget", () => {
  const backend = installMemoryFirebase(loadBackend());
  const sourceData = buildRosterData();
  sourceData.rosters[0].trackingMode = "regularWar";
  const { runId, current, tasks } = setupQueueRun(backend, sourceData, { rosterIds: ["main"] });
  let processCalls = 0;
  let clanFetchCalls = 0;
  backend.fetchClanMembersSnapshot_ = () => {
    clanFetchCalls++;
    return {
      clanTag: "#CLAN",
      members: [{ tag: "#PLAYER", name: "Player", townHallLevel: 16 }],
      metricsMembers: [{ tag: "#PLAYER", name: "Player", trophies: 5000 }],
    };
  };
  backend.processRefreshAllRosterPipelineIntoAccumulator_ = () => {
    processCalls++;
    throw new Error("pipeline should not start when the worker budget is already low");
  };

  const result = backend.executeAutoRefreshRosterTask_(
    current,
    firstRosterTask(tasks),
    Date.now() - (270 * 1000) + 1000,
  );

  assert.equal(result.deferred, true);
  assert.equal(result.reason, "beforeRosterPhaseBudget");
  assert.equal(processCalls, 0);
  assert.equal(clanFetchCalls, 0);
  assert.equal(backend.readAutoRefreshPreparedRosterInput_(runId, "main"), null);

  backend.fetchClanMembersSnapshot_ = () => {
    clanFetchCalls++;
    return {
      clanTag: "#CLAN",
      members: [{ tag: "#PLAYER", name: "Player", townHallLevel: 16 }],
      metricsMembers: [{ tag: "#PLAYER", name: "Player", trophies: 5000 }],
    };
  };
  backend.processRefreshAllRosterPipelineIntoAccumulator_ = (rosterData, rosterId, _options, accumulator) => {
    processCalls++;
    accumulator.perRoster.push({ rosterId, ok: true, issueCount: 0, issues: [] });
    return {
      rosterData,
      pipelineResult: { memberTracking: { capturedPlayers: 1 } },
    };
  };

  const retry = backend.executeAutoRefreshRosterTask_(current, firstRosterTask(tasks), Date.now());

  assert.equal(retry.rosterId, "main");
  assert.equal(processCalls, 1);
  assert.equal(clanFetchCalls, 1);
});

test("roster queue task resumes from persisted primary snapshot phase after transient failure", () => {
  const backend = installMemoryFirebase(loadBackend());
  const { runId, current, tasks } = setupQueueRun(backend, buildRosterData(), { rosterIds: ["main"] });
  const originalBatchGet = backend.firebaseBatchGetJson_;
  let sourceBatchReads = 0;
  backend.firebaseBatchGetJson_ = (pathsRaw, optionsRaw) => {
    const paths = Array.isArray(pathsRaw) ? pathsRaw : [];
    if (paths.some((path) => String(path).includes("/source/meta"))) sourceBatchReads++;
    return originalBatchGet(pathsRaw, optionsRaw);
  };
  let clanFetchCalls = 0;
  backend.fetchClanMembersSnapshot_ = () => {
    clanFetchCalls++;
    if (clanFetchCalls === 1) throw Object.assign(new Error("temporary clan timeout"), { statusCode: 500 });
    return {
      clanTag: "#CLAN",
      members: [{ tag: "#PLAYER", name: "Player", townHallLevel: 16 }],
      metricsMembers: [{ tag: "#PLAYER", name: "Player", trophies: 5000 }],
    };
  };
  backend.processRefreshAllRosterPipelineIntoAccumulator_ = (rosterData, rosterId, _options, accumulator) => {
    accumulator.perRoster.push({ rosterId, ok: true, issueCount: 0, issues: [] });
    return {
      rosterData,
      pipelineResult: { memberTracking: { capturedPlayers: 1 } },
    };
  };

  const first = backend.executeAutoRefreshRosterTask_(current, firstRosterTask(tasks), Date.now());
  const stateAfterFailure = backend.readAutoRefreshRosterPhaseState_(runId, "main");
  const preparedAfterFailure = backend.readAutoRefreshPreparedRosterInput_(runId, "main");
  const retry = backend.executeAutoRefreshRosterTask_(current, firstRosterTask(tasks), Date.now());

  assert.equal(first.deferred, true);
  assert.equal(first.reason, "clan-members-snapshot");
  assert.equal(stateAfterFailure.phase, "primarySnapshot");
  assert.equal(stateAfterFailure.attemptByPhase.primarySnapshot, 1);
  assert.equal(preparedAfterFailure.sourceMeta.connectedClanTagByRosterId.main, "#CLAN");
  assert.equal(preparedAfterFailure.sourceRoster, null);
  assert.equal(retry.rosterId, "main");
  assert.equal(clanFetchCalls, 2);
  assert.equal(sourceBatchReads, 1);
});

test("roster queue migrates old prepared inputs back to snapshot collection", () => {
  const backend = installMemoryFirebase(loadBackend());
  const sourceData = buildRosterData();
  const { runId, current, tasks } = setupQueueRun(backend, sourceData, { rosterIds: ["main"] });
  const rosterTask = firstRosterTask(tasks);
  rosterTask.phase = "processSnapshot";
  backend.writeAutoRefreshTask_(runId, rosterTask);
  backend.writeAutoRefreshRunShard_(runId, "rosterInputs/main", {
    rosterId: "main",
    sourceMeta: backend.readAutoRefreshRunShard_(runId, "source/meta"),
    sourceRoster: sourceData.rosters[0],
    sourceOwnership: {},
    clanSnapshot: {
      clanTag: "#CLAN",
      members: [{ tag: "#PLAYER", name: "Player", townHallLevel: 16 }],
      metricsMembers: [{ tag: "#PLAYER", name: "Player", trophies: 5000 }],
    },
    sourceMetricByTag: {},
    sourceSeedByTag: {},
  }, "PUT");
  let clanFetchCalls = 0;
  let sawSnapshotPlan = false;
  backend.fetchClanMembersSnapshot_ = () => {
    clanFetchCalls++;
    return {
      clanTag: "#CLAN",
      members: [{ tag: "#PLAYER", name: "Player", townHallLevel: 16 }],
      metricsMembers: [{ tag: "#PLAYER", name: "Player", trophies: 5000 }],
    };
  };
  backend.processRefreshAllRosterPipelineIntoAccumulator_ = (rosterData, rosterId, options, accumulator) => {
    sawSnapshotPlan = Array.isArray(backend.readAutoRefreshPreparedRosterInput_(runId, "main").metricReadTags) &&
      options.autoRefreshSnapshotMode === true;
    accumulator.perRoster.push({ rosterId, ok: true, issueCount: 0, issues: [] });
    return {
      rosterData,
      pipelineResult: { memberTracking: { capturedPlayers: 1 } },
    };
  };

  const result = backend.executeAutoRefreshRosterTask_(current, rosterTask, Date.now());
  const prepared = backend.readAutoRefreshPreparedRosterInput_(runId, "main");

  assert.equal(result.rosterId, "main");
  assert.equal(clanFetchCalls, 1);
  assert.equal(sawSnapshotPlan, true);
  assert.equal(prepared.sourceRoster, null);
});

test("roster queue resumes metric planning from captured primary snapshot without Clash recollect", () => {
  const backend = installMemoryFirebase(loadBackend());
  const sourceData = buildRosterData();
  const { runId, current, tasks } = setupQueueRun(backend, sourceData, { rosterIds: ["main"] });
  const rosterTask = firstRosterTask(tasks);
  rosterTask.phase = "processSnapshot";
  backend.writeAutoRefreshTask_(runId, rosterTask);
  backend.writeAutoRefreshRunShard_(runId, "rosterInputs/main", {
    rosterId: "main",
    sourceMeta: backend.readAutoRefreshRunShard_(runId, "source/meta"),
    sourceRoster: null,
    sourceOwnership: {},
    clanSnapshot: {
      clanTag: "#CLAN",
      members: [{ tag: "#PLAYER", name: "Player", townHallLevel: 16 }],
      metricsMembers: [{ tag: "#PLAYER", name: "Player", trophies: 5000 }],
    },
    currentRegularWarByClanTag: {},
    currentRegularWarErrorByClanTag: {},
    sourceMetricByTag: {},
    sourceSeedByTag: {},
  }, "PUT");
  let clanFetchCalls = 0;
  backend.fetchClanMembersSnapshot_ = () => {
    clanFetchCalls++;
    throw new Error("captured primary snapshot should be reused");
  };
  backend.processRefreshAllRosterPipelineIntoAccumulator_ = (rosterData, rosterId, _options, accumulator) => {
    accumulator.perRoster.push({ rosterId, ok: true, issueCount: 0, issues: [] });
    return {
      rosterData,
      pipelineResult: { memberTracking: { capturedPlayers: 1 } },
    };
  };

  const result = backend.executeAutoRefreshRosterTask_(current, rosterTask, Date.now());
  const state = backend.readAutoRefreshRosterPhaseState_(runId, "main");
  const prepared = backend.readAutoRefreshPreparedRosterInput_(runId, "main");

  assert.equal(result.rosterId, "main");
  assert.equal(clanFetchCalls, 0);
  assert.equal(state.phase, "completed");
  assert.equal(prepared.sourceRoster, null);
  assert.equal(prepared.metricReadTags.join(","), "#PLAYER");
});

test("roster queue processing is snapshot-only and defers forbidden live fetches", () => {
  const backend = installMemoryFirebase(loadBackend());
  const { runId, current, tasks } = setupQueueRun(backend, buildRosterData(), { rosterIds: ["main"] });
  let sawSnapshotMode = false;
  let sawPrefetchedClan = false;
  backend.fetchClanMembersSnapshot_ = () => ({
    clanTag: "#CLAN",
    members: [{ tag: "#PLAYER", name: "Player", townHallLevel: 16 }],
    metricsMembers: [{ tag: "#PLAYER", name: "Player", trophies: 5000 }],
  });
  backend.processRefreshAllRosterPipelineIntoAccumulator_ = (rosterData, rosterId, options, accumulator) => {
    sawSnapshotMode = options && options.autoRefreshSnapshotMode === true;
    sawPrefetchedClan = !!(options && options.prefetchedClanSnapshotsByTag && options.prefetchedClanSnapshotsByTag["#CLAN"]);
    try {
      backend.fetchClanMembersSnapshot_("#CLAN");
    } catch (err) {
      accumulator.issues.push({ severity: "error", message: String(err && err.message || err) });
    }
    accumulator.perRoster.push({ rosterId, ok: true, issueCount: 0, issues: [] });
    return {
      rosterData,
      pipelineResult: { memberTracking: { capturedPlayers: 1 } },
    };
  };

  const result = backend.executeAutoRefreshRosterTask_(current, firstRosterTask(tasks), Date.now());

  assert.equal(result.deferred, true);
  assert.equal(result.reason, "forbidden-live-fetch");
  assert.equal(sawSnapshotMode, true);
  assert.equal(sawPrefetchedClan, true);
  assert.equal(backend.firebaseRequestJson_("activeVersions/" + runId + "/rosters/main", "GET"), null);
});

test("roster queue defers forbidden live fetches that escape processing directly", () => {
  const backend = installMemoryFirebase(loadBackend());
  const { runId, current, tasks } = setupQueueRun(backend, buildRosterData(), { rosterIds: ["main"] });
  backend.fetchClanMembersSnapshot_ = () => ({
    clanTag: "#CLAN",
    members: [{ tag: "#PLAYER", name: "Player", townHallLevel: 16 }],
    metricsMembers: [{ tag: "#PLAYER", name: "Player", trophies: 5000 }],
  });
  backend.processRefreshAllRosterPipelineIntoAccumulator_ = () => {
    backend.fetchClanMembersSnapshot_("#CLAN");
  };

  const result = backend.executeAutoRefreshRosterTask_(current, firstRosterTask(tasks), Date.now());
  const state = backend.readAutoRefreshRosterPhaseState_(runId, "main");

  assert.equal(result.deferred, true);
  assert.equal(result.reason, "forbidden-live-fetch");
  assert.equal(state.phase, "processSnapshot");
  assert.match(state.error, /forbidden live fetch/i);
  assert.equal(backend.firebaseRequestJson_("activeVersions/" + runId + "/rosters/main", "GET"), null);
});

test("roster queue reads metric and seed inputs in cursor chunks", () => {
  const backend = installMemoryFirebase(loadBackend());
  const sourceData = buildRosterData();
  const metricTags = Array.from({ length: 30 }, (_, index) => "#P" + String(index + 1).padStart(2, "0"));
  const seedTags = Array.from({ length: 30 }, (_, index) => "#L" + String(index + 1).padStart(2, "0"));
  sourceData.rosters[0].main[0].tag = metricTags[0];
  const { runId, current, tasks } = setupQueueRun(backend, sourceData, { rosterIds: ["main"] });
  const metricChunks = [];
  const seedChunks = [];
  backend.fetchClanMembersSnapshot_ = () => ({
    clanTag: "#CLAN",
    members: seedTags.map((tag) => ({ tag, name: tag, townHallLevel: 16 })),
    metricsMembers: metricTags.map((tag) => ({ tag, name: tag, trophies: 5000 })),
  });
  backend.readAutoRefreshSourceMetricEntriesForTags_ = (_runId, tagsRaw, _sourceVersionId, optionsRaw) => {
    const tags = Array.isArray(tagsRaw) ? tagsRaw : [];
    metricChunks.push(tags.slice());
    assert.equal(optionsRaw.disableFirebaseFallback, true);
    return Object.fromEntries(tags.map((tag) => [tag, { latestSnapshot: { tag, trophies: 5000 } }]));
  };
  backend.readAutoRefreshSourcePlayerSeedEntriesForTags_ = (_runId, tagsRaw, optionsRaw) => {
    const tags = Array.isArray(tagsRaw) ? tagsRaw : [];
    seedChunks.push(tags.slice());
    assert.equal(optionsRaw.disableFirebaseFallback, true);
    return Object.fromEntries(tags.map((tag) => [tag, { tag, name: tag, th: 16 }]));
  };
  backend.processRefreshAllRosterPipelineIntoAccumulator_ = (rosterData, rosterId, _options, accumulator) => {
    accumulator.perRoster.push({ rosterId, ok: true, issueCount: 0, issues: [] });
    return {
      rosterData,
      pipelineResult: { memberTracking: { capturedPlayers: 1 } },
    };
  };

  const result = backend.executeAutoRefreshRosterTask_(current, firstRosterTask(tasks), Date.now());
  const state = backend.readAutoRefreshRosterPhaseState_(runId, "main");

  assert.equal(result.rosterId, "main");
  assert.deepEqual(metricChunks.map((chunk) => chunk.length), [25, 5]);
  assert.deepEqual(seedChunks.map((chunk) => chunk.length), [25, 5]);
  assert.equal(state.phase, "completed");
});

test("roster queue chunk progress does not consume metric seed retry attempts", () => {
  const backend = installMemoryFirebase(loadBackend());
  const sourceData = buildRosterData();
  const metricTags = Array.from({ length: 80 }, (_, index) => "#M" + String(index + 1).padStart(3, "0"));
  const seedTags = Array.from({ length: 80 }, (_, index) => "#S" + String(index + 1).padStart(3, "0"));
  sourceData.rosters[0].main[0].tag = metricTags[0];
  const { runId, current, tasks } = setupQueueRun(backend, sourceData, { rosterIds: ["main"] });
  const metricChunks = [];
  const seedChunks = [];
  backend.fetchClanMembersSnapshot_ = () => ({
    clanTag: "#CLAN",
    members: seedTags.map((tag) => ({ tag, name: tag, townHallLevel: 16 })),
    metricsMembers: metricTags.map((tag) => ({ tag, name: tag, trophies: 5000 })),
  });
  backend.readAutoRefreshSourceMetricEntriesForTags_ = (_runId, tagsRaw) => {
    const tags = Array.isArray(tagsRaw) ? tagsRaw : [];
    metricChunks.push(tags.slice());
    return Object.fromEntries(tags.map((tag) => [tag, { latestSnapshot: { tag, trophies: 5000 } }]));
  };
  backend.readAutoRefreshSourcePlayerSeedEntriesForTags_ = (_runId, tagsRaw) => {
    const tags = Array.isArray(tagsRaw) ? tagsRaw : [];
    seedChunks.push(tags.slice());
    return Object.fromEntries(tags.map((tag) => [tag, { tag, name: tag, th: 16 }]));
  };
  backend.processRefreshAllRosterPipelineIntoAccumulator_ = (rosterData, rosterId, _options, accumulator) => {
    accumulator.perRoster.push({ rosterId, ok: true, issueCount: 0, issues: [] });
    return {
      rosterData,
      pipelineResult: { memberTracking: { capturedPlayers: 1 } },
    };
  };

  const result = backend.executeAutoRefreshRosterTask_(current, firstRosterTask(tasks), Date.now());
  const state = backend.readAutoRefreshRosterPhaseState_(runId, "main");

  assert.equal(result.rosterId, "main");
  assert.deepEqual(metricChunks.map((chunk) => chunk.length), [25, 25, 25, 5]);
  assert.deepEqual(seedChunks.map((chunk) => chunk.length), [25, 25, 25, 5]);
  assert.equal(state.phase, "completed");
  assert.equal(state.attemptByPhase.metricSeedInputs, 1);
});

test("roster queue task validates the staged roster shard before writing it", () => {
  const backend = installMemoryFirebase(loadBackend());
  const { current, tasks } = setupQueueRun(backend, buildRosterData(), { rosterIds: ["main"] });
  backend.fetchClanMembersSnapshot_ = () => ({
    clanTag: "#CLAN",
    members: [{ tag: "#PLAYER", name: "Player", townHallLevel: 16 }],
    metricsMembers: [{ tag: "#PLAYER", name: "Player", trophies: 5000 }],
  });
  backend.processRefreshAllRosterPipelineIntoAccumulator_ = (rosterData, rosterId, _options, accumulator) => {
    const processed = clone(rosterData);
    processed.rosters[0].main[0].latestSnapshot = { tag: "#PLAYER", trophies: 5000 };
    accumulator.perRoster.push({ rosterId, ok: true, issueCount: 0, issues: [] });
    return {
      rosterData: processed,
      pipelineResult: { memberTracking: { capturedPlayers: 1 } },
    };
  };

  assert.throws(
    () => backend.executeAutoRefreshRosterTask_(current, firstRosterTask(tasks), Date.now()),
    /metric-like field 'latestSnapshot' is not allowed/,
  );
  assert.equal(backend.firebaseRequestJson_("activeVersions/run-1/rosters/main", "GET"), null);
  assert.equal(backend.readAutoRefreshRunShard_("run-1", "rosterWrites/main"), null);
});

test("queue finalization publishes completed shards through the active version pointer", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildRosterData());
  const { runId, current, tasks } = setupQueueRun(backend, data, {
    rosterIds: ["main", "second"],
    currentTaskIndex: 3,
    processedTasks: 3,
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
  installCloudflareMirrorSuccess(backend);

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
  assert.equal(backend.firebaseRequestJson_("internal/autoRefresh/runs/run-1", "GET"), null);
  assert.equal(backend.firebaseRequestJson_("activeVersions/run-1", "GET") !== null, true);
});

test("queue finalization completes without waiting for Cloudflare public data", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildRosterData());
  const { runId, current, tasks } = setupQueueRun(backend, data, {
    rosterIds: ["main"],
    currentTaskIndex: 2,
    processedTasks: 2,
    processedRosters: 1,
  });
  backend.firebaseRequestJson_("activeVersions/run-1/rosters/main", "PUT", backend.encodeFirebaseObjectKeysRecursive_(data.rosters[0]));
  backend.writeAutoRefreshRunShard_(runId, "rosterWrites/main", { rosterId: "main", versionId: runId }, "PUT");
  backend.writeAutoRefreshRunShard_(runId, "warResults/main", { rosterId: "main", rosterShardWritten: true, issues: [] }, "PUT");
  backend.writeAutoRefreshRunShard_(runId, "metricResults/main", { byTag: {}, tags: [] }, "PUT");
  backend.readActiveRosterSnapshot_ = () => ({ rosterData: data, text: JSON.stringify(data) });
  backend.updateActiveRosterDataCaches_ = () => null;
  backend.tryReconcileRegularWarFinalizationTriggerStateValidated_ = () => null;
  backend.tryReconcileCurrentSeasonEventsForAutoRefresh_ = () => null;
  backend.publishCloudflarePublicDataSnapshot_ = () => ({
    ok: true,
    active: {
      ok: true,
      versionId: runId,
      publicResult: { ok: true, putCount: 6 },
      botResult: { ok: true, putCount: 4 },
    },
    cwlLeagueSignups: { ok: true, putCount: 1 },
    seasonEvents: { ok: true, putCount: 3, deleteCount: 1 },
  });
  backend.verifyCloudflarePublicActiveVersionId_ = () => ({
    ok: false,
    expectedVersionId: runId,
    actualVersionId: "old-version",
    error: "Cloudflare active version pointer mismatch.",
  });
  const finalizeTask = tasks.find((task) => task.type === "finalize");

  const result = backend.executeAutoRefreshFinalizeTask_(current, finalizeTask, Date.now());
  const queue = backend.readAutoRefreshQueueCurrent_();

  assert.equal(result.status, "completed");
  assert.equal(backend.readPublishedActiveVersionId_(), runId);
  assert.equal(queue, null);
  assert.equal(backend.__properties.get("AUTO_REFRESH_LAST_RUN_STATUS"), "ok");
  assert.equal(backend.firebaseRequestJson_("internal/autoRefresh/runs/run-1", "GET"), null);
  assert.equal(backend.firebaseRequestJson_("internal/autoRefresh/lastJob", "GET") !== null, true);
});

test("staged queue finalization does not gate canonical completion on side-phase verification", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildRosterData());
  const { runId, current, tasks } = setupQueueRun(backend, data, {
    rosterIds: ["main"],
    currentTaskIndex: 2,
    processedTasks: 2,
    processedRosters: 1,
    sourceVersionId: "source-1",
  });
  backend.firebaseRequestJson_("activePublished/currentVersionId", "PUT", "source-1");
  stageCompletedRosterOutputs(backend, runId, data, ["main"]);
  backend.readActiveRosterSnapshot_ = () => {
    throw new Error("staged finalization should not read the full active payload");
  };
  backend.runAutoRefreshRequiredFinalPhases_ = () => ({ ok: true, status: "skipped" });
  const finalizeTask = tasks.find((task) => task.type === "finalize");

  const result = backend.executeAutoRefreshFinalizeTask_(current, finalizeTask, Date.now());
  const queue = backend.readAutoRefreshQueueCurrent_();

	assert.equal(result.status, "completed");
  assert.equal(backend.readPublishedActiveVersionId_(), runId);
	assert.equal(queue, null);
	assert.equal(backend.firebaseRequestJson_("internal/autoRefresh/runs/run-1", "GET"), null);
	assert.equal(backend.firebaseRequestJson_("internal/autoRefresh/lastJob", "GET") !== null, true);
	assert.equal(backend.__triggers.filter((trigger) => trigger.handler === "autoRefreshWorkerTick").length, 0);
});

test("queue finalization uses source version guard without reading the active payload", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildRosterData());
  const { runId, current, tasks } = setupQueueRun(backend, data, {
    rosterIds: ["main"],
    currentTaskIndex: 2,
    processedTasks: 2,
    processedRosters: 1,
    sourceVersionId: "source-1",
  });
  backend.firebaseRequestJson_("activePublished/currentVersionId", "PUT", "source-1");
  backend.firebaseRequestJson_("activeVersions/run-1/rosters/main", "PUT", backend.encodeFirebaseObjectKeysRecursive_(data.rosters[0]));
  backend.writeAutoRefreshRunShard_(runId, "rosterWrites/main", { rosterId: "main", versionId: runId, playerTags: ["#PLAYER"] }, "PUT");
  backend.writeAutoRefreshRunShard_(runId, "warResults/main", { rosterId: "main", rosterShardWritten: true, issues: [] }, "PUT");
  backend.writeAutoRefreshRunShard_(runId, "metricResults/main", { byTag: {}, tags: [] }, "PUT");
  let activePayloadReads = 0;
  let targetRosterReads = 0;
  const originalFirebaseRequestJson = backend.firebaseRequestJson_;
  backend.firebaseRequestJson_ = (pathRaw, methodRaw = "GET", payloadRaw, queryParamsRaw) => {
    const path = String(pathRaw || "").replace(/^\/+|\/+$/g, "");
    const method = String(methodRaw || "GET").toUpperCase();
    if (method === "GET" && path === "activeVersions/run-1/rosters/main") {
      targetRosterReads++;
      throw new Error("finalization should not read target roster shards in staged metrics mode");
    }
    if (method === "GET" && path === "internal/autoRefresh/runs/run-1/metricResults/main/byTag") {
      throw new Error("finalization should not read full metric result payloads");
    }
    return originalFirebaseRequestJson(pathRaw, methodRaw, payloadRaw, queryParamsRaw);
  };
  backend.readActiveRosterSnapshot_ = () => {
    activePayloadReads++;
    throw new Error("finalization should not read the active payload");
  };
  backend.updateActiveRosterDataCaches_ = () => null;
  backend.tryReconcileRegularWarFinalizationTriggerStateValidated_ = () => null;
  backend.tryReconcileCurrentSeasonEventsForAutoRefresh_ = () => null;
  installCloudflareMirrorSuccess(backend);
  const finalizeTask = tasks.find((task) => task.type === "finalize");

  const result = backend.executeAutoRefreshFinalizeTask_(current, finalizeTask, Date.now());

  assert.equal(result.status, "completed");
  assert.equal(activePayloadReads, 0);
  assert.equal(targetRosterReads, 0);
  assert.equal(backend.readPublishedActiveVersionId_(), runId);
});

test("queue finalization refreshes a waiting CWL season event from staged source metadata", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    events: {
      seasonEvents: {
        currentCwl: { eventId: "cwl-waiting", type: "cwl" },
        byId: {
          "cwl-waiting": {
            eventId: "cwl-waiting",
            type: "cwl",
            status: "open",
            visibility: "public",
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
  const data = backend.validateRosterData_(buildRosterData());
  const { runId, current, tasks } = setupQueueRun(backend, data, {
    rosterIds: ["main"],
    currentTaskIndex: 2,
    processedTasks: 2,
    processedRosters: 1,
    sourceVersionId: "source-1",
  });
  backend.firebaseRequestJson_("activePublished/currentVersionId", "PUT", "source-1");
  backend.writeAutoRefreshRunShard_(runId, "rosterWrites/main", { rosterId: "main", versionId: runId, playerTags: ["#PLAYER"] }, "PUT");
  backend.writeAutoRefreshRunShard_(runId, "warResults/main", { rosterId: "main", rosterShardWritten: true, issues: [] }, "PUT");
  backend.writeAutoRefreshRunShard_(runId, "metricResults/main", { metricResultMode: "activeVersionPatches", metricsStaged: true, tags: [] }, "PUT");
  const leaguegroup = {
    state: "inWar",
    season: "2026-07",
    clans: [{ tag: "#CLAN", name: "Main", warLeague: { name: "Champion I" } }, { tag: "#OPP", name: "Opponent" }],
    rounds: [{ warTags: ["#WAR1"] }],
  };
  const war = {
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
  };
  const paths = [];
  backend.cocFetchAllByPathEntries_ = (entriesRaw) => {
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    const dataByKey = {};
    const errorByKey = {};
    for (const entry of entries) {
      paths.push(entry.path);
      if (entry.path.endsWith("/members")) dataByKey[entry.key] = { items: [] };
      else if (entry.path.includes("/currentwar/leaguegroup")) dataByKey[entry.key] = leaguegroup;
      else if (entry.path.includes("/clanwarleagues/wars/")) dataByKey[entry.key] = war;
      else if (entry.path.endsWith("/currentwar")) errorByKey[entry.key] = Object.assign(new Error("not in war"), { statusCode: 404 });
    }
    return { dataByKey, errorByKey, requestCount: entries.length, batchCount: entries.length ? 1 : 0 };
  };
  backend.readActiveRosterSnapshot_ = () => {
    throw new Error("staged CWL event refresh should not read the full active payload");
  };
  backend.tryReconcileRegularWarFinalizationTriggerStateValidated_ = () => null;
  backend.tryReconcileCurrentSeasonEventsForAutoRefresh_ = () => null;
  installCloudflareMirrorSuccess(backend);
  const cwlTask = tasks.find((task) => task.type === "cwlCoordinator");
  const cwlResult = backend.executeAutoRefreshCwlCoordinatorTask_(current, cwlTask, Date.now());
  assert.equal(cwlResult.requestCounts.leagueGroup, 1);
  assert.equal(cwlResult.requestCounts.cwlWar, 1);
  assert.equal(paths.filter((path) => path.includes("/currentwar/leaguegroup")).length, 1);
  assert.equal(paths.filter((path) => path.includes("/clanwarleagues/wars/")).length, 1);
  paths.length = 0;
  const finalizeTask = tasks.find((task) => task.type === "finalize");

  const result = backend.executeAutoRefreshFinalizeTask_(current, finalizeTask, Date.now());
  const event = backend.readSeasonEventById_("cwl-waiting");
  const live = backend.readCwlSeasonEventAggregate_("cwl-waiting", "live");
  const leaderboard = backend.buildSeasonEventLeaderboard_(event, data, { nowIso: "2026-07-05T00:00:00.000Z" });
  const lastJob = backend.decodeFirebaseObjectKeysRecursive_(backend.firebaseRequestJson_("internal/autoRefresh/lastJob", "GET"));

  assert.equal(result.status, "completed");
  assert.equal(event.cwlTrackingState, "active", JSON.stringify({ result, event, summary: backend.readAutoRefreshCwlCoordinatorSummary_(runId) }));
  assert.equal(event.startsAt, "2026-07-04T20:00:00.000Z");
  assert.equal(event.endsAt, "2026-07-05T20:00:00.000Z");
  assert.equal(JSON.stringify(event.cwl.target.eligibleAccountTags), JSON.stringify(["#PLAYER"]));
  assert.equal(event.activeParticipantCount || backend.summarizeSeasonEvent_(event).activeParticipantCount, 1);
  assert.equal(live.byTag["#PLAYER"].starsTotal, 3);
  assert.equal(JSON.stringify(live.rankedTags), JSON.stringify(["#PLAYER"]));
  assert.equal(leaderboard.event.activeParticipantCount, 1);
  assert.equal(leaderboard.leaderboard.length, 1);
  assert.equal(leaderboard.leaderboard[0].tag, "#PLAYER");
  assert.equal(lastJob.cwlSeasonEventRefresh.status, "active");
  assert.equal(lastJob.cwlSeasonEventRefresh.requestCounts.leagueGroup, 1);
  assert.equal(lastJob.cwlSeasonEventRefresh.requestCounts.cwlWar, 1);
  assert.equal(paths.filter((path) => path.includes("/currentwar/leaguegroup")).length, 1);
  assert.equal(paths.filter((path) => path.includes("/clanwarleagues/wars/")).length, 1);
  assert.equal(lastJob.cwlFinalCoordinatorCapture.status, "captured");
});

test("queue finalization recaptures CWL after roster processing and publishes the latest aggregate once", () => {
  const backend = installMemoryFirebase(loadBackend(), buildCurrentCwlEventDb());
  const data = backend.validateRosterData_(buildRosterData());
  const { runId, current, tasks } = setupQueueRun(backend, data, {
    rosterIds: ["main"],
    currentTaskIndex: 3,
    processedTasks: 3,
    processedRosters: 1,
    sourceVersionId: "source-1",
  });
  backend.firebaseRequestJson_("activePublished/currentVersionId", "PUT", "source-1");
  stageCompletedRosterOutputs(backend, runId, data, ["main"]);
  let war = buildOneRoundCwlWar({ state: "inWar", stars: 1, destruction: 40 });
  installCwlFetch(backend, () => war);
  backend.readActiveRosterSnapshot_ = () => {
    throw new Error("late CWL finalization should not read the full active payload");
  };
  backend.tryReconcileRegularWarFinalizationTriggerStateValidated_ = () => null;
  backend.tryReconcileCurrentSeasonEventsForAutoRefresh_ = () => null;
  let publishCalls = 0;
  backend.publishCloudflarePublicDataSnapshot_ = () => {
    publishCalls++;
    const versionId = backend.readPublishedActiveVersionId_();
    return {
      ok: true,
      active: { ok: true, versionId, publicResult: { ok: true, putCount: 6 }, botResult: { ok: true, putCount: 4 } },
      cwlLeagueSignups: { ok: true, putCount: 1 },
      seasonEvents: { ok: true, putCount: 3, deleteCount: 0 },
    };
  };
  backend.verifyCloudflarePublicActiveVersionId_ = (versionId) => ({ ok: true, statusCode: 200, expectedVersionId: versionId, actualVersionId: versionId });
  backend.executeAutoRefreshCwlCoordinatorTask_(current, tasks.find((task) => task.type === "cwlCoordinator"), Date.now());
  const earlySummary = backend.readAutoRefreshRunShard_(runId, "cwl/summary");
  war = buildOneRoundCwlWar({ state: "inWar", stars: 3, destruction: 100 });

  const result = backend.executeAutoRefreshFinalizeTask_(current, tasks.find((task) => task.type === "finalize"), Date.now());
  const live = backend.readCwlSeasonEventAggregate_("cwl-active", "live");
  const lastJob = backend.decodeFirebaseObjectKeysRecursive_(backend.firebaseRequestJson_("internal/autoRefresh/lastJob", "GET"));

  assert.equal(result.status, "completed");
  assert.equal(publishCalls, 0);
  assert.equal(live.byTag["#PLAYER"].starsTotal, 3);
  assert.notEqual(live.hash, earlySummary.aggregateHash);
  assert.equal(lastJob.cwlFinalCoordinatorCapture.status, "captured");
  assert.equal(lastJob.cwlFinalCoordinatorCapture.aggregateHash, live.hash);
});

test("queue finalization forces final CWL capture for runs without the new task", () => {
  const backend = installMemoryFirebase(loadBackend(), buildCurrentCwlEventDb());
  const data = backend.validateRosterData_(buildRosterData());
  const { runId, current, tasks } = setupQueueRun(backend, data, {
    rosterIds: ["main"],
    currentTaskIndex: 2,
    processedTasks: 2,
    processedRosters: 1,
    sourceVersionId: "source-1",
  });
  backend.firebaseRequestJson_("activePublished/currentVersionId", "PUT", "source-1");
  stageCompletedRosterOutputs(backend, runId, data, ["main"]);
  const legacyTaskIds = current.taskIds.filter((taskId) => backend.readAutoRefreshTask_(runId, taskId).type !== "cwlFinalCoordinator");
  current.taskIds = legacyTaskIds;
  current.taskCount = legacyTaskIds.length;
  current.currentTaskIndex = legacyTaskIds.findIndex((taskId) => backend.readAutoRefreshTask_(runId, taskId).type === "finalize");
  backend.writeAutoRefreshQueueCurrent_(current, false);
  const paths = installCwlFetch(backend, () => buildOneRoundCwlWar({ state: "inWar", stars: 2, destruction: 90 }));
  backend.readActiveRosterSnapshot_ = () => {
    throw new Error("legacy finalization should use source metadata and run shards");
  };
  backend.tryReconcileRegularWarFinalizationTriggerStateValidated_ = () => null;
  backend.tryReconcileCurrentSeasonEventsForAutoRefresh_ = () => null;
  installCloudflareMirrorSuccess(backend);

  const result = backend.executeAutoRefreshFinalizeTask_(current, tasks.find((task) => task.type === "finalize"), Date.now());
  const lastJob = backend.decodeFirebaseObjectKeysRecursive_(backend.firebaseRequestJson_("internal/autoRefresh/lastJob", "GET"));

  assert.equal(result.status, "completed");
  assert.equal(lastJob.cwlFinalCoordinatorCapture.status, "captured");
  assert.equal(paths.filter((path) => path.includes("/currentwar/leaguegroup")).length, 1);
  assert.equal(paths.filter((path) => path.includes("/clanwarleagues/wars/")).length, 1);
});

test("queue worker records final CWL capture without a standalone main-queue continuation", () => {
  const backend = installMemoryFirebase(loadBackend(), buildCurrentCwlEventDb());
  const data = backend.validateRosterData_(buildRosterData());
  const { runId, current, tasks } = setupQueueRun(backend, data, {
    rosterIds: ["main"],
    sourceVersionId: "source-1",
  });
  backend.firebaseRequestJson_("activePublished/currentVersionId", "PUT", "source-1");
  stageCompletedRosterOutputs(backend, runId, data, ["main"]);
  const finalizeTask = tasks.find((task) => task.type === "finalize");
  current.taskIds = [finalizeTask.taskId];
  current.taskCount = 1;
  current.currentTaskIndex = 0;
  current.processedTasks = 0;
  current.processedRosters = 1;
  backend.writeAutoRefreshQueueCurrent_(current, false);
  installCwlFetch(backend, () => buildOneRoundCwlWar({ state: "inWar", stars: 2, destruction: 90 }));
  let publishCalls = 0;
  backend.publishCloudflarePublicDataSnapshot_ = () => {
    publishCalls++;
    return { ok: true };
  };

  const result = backend.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() });
	const lastJob = backend.decodeFirebaseObjectKeysRecursive_(backend.firebaseRequestJson_("internal/autoRefresh/lastJob", "GET"));
  const updatedCurrent = backend.readAutoRefreshQueueCurrent_();

	assert.equal(result.status, "completed");
	assert.equal(lastJob.cwlFinalCoordinatorCapture.status, "reused");
	assert.equal(updatedCurrent, null);
	assert.equal(backend.__triggers.filter((trigger) => trigger.handler === "autoRefreshWorkerTick").length, 0);
  assert.equal(publishCalls, 0);
});

test("final CWL capture freshness uses persisted write time after slow collection", () => {
  const backend = loadBackend();
  const nowMs = Date.parse("2026-05-25T12:04:00.000Z");
  const summary = {
    completed: true,
    finalCapture: true,
    eventId: "cwl-active",
    capturedAt: "2026-05-25T11:56:00.000Z",
    writtenAt: "2026-05-25T12:00:30.000Z",
  };

  assert.equal(
    backend.isAutoRefreshFinalCwlCoordinatorSummaryFresh_(summary, { eventId: "cwl-active" }, nowMs),
    true,
  );
  assert.equal(
    backend.isAutoRefreshFinalCwlCoordinatorSummaryFresh_(
      Object.assign({}, summary, { writtenAt: "2026-05-25T11:53:30.000Z" }),
      { eventId: "cwl-active" },
      nowMs,
    ),
    false,
  );
});

test("queue finalization records failed final CWL refresh and completes the canonical run", () => {
  const initial = buildCurrentCwlEventDb();
  initial.events.seasonEvents.byId["cwl-active"].cwl.groups = {
    "grp-existing": { groupId: "grp-existing", clanTags: ["#CLAN"], warTags: ["#WAR1"], expectedRounds: 1 },
  };
  const backend = installMemoryFirebase(loadBackend(), initial);
  const data = backend.validateRosterData_(buildRosterData());
  const { runId, current, tasks } = setupQueueRun(backend, data, {
    rosterIds: ["main"],
    currentTaskIndex: 3,
    processedTasks: 3,
    processedRosters: 1,
    sourceVersionId: "source-1",
  });
  backend.firebaseRequestJson_("activePublished/currentVersionId", "PUT", "source-1");
  stageCompletedRosterOutputs(backend, runId, data, ["main"]);
  installCwlFetch(backend, () => buildOneRoundCwlWar(), { warError: true });
  backend.readActiveRosterSnapshot_ = () => {
    throw new Error("failed final CWL refresh should not read full active payload");
  };
  backend.tryReconcileRegularWarFinalizationTriggerStateValidated_ = () => null;
  let publishCalls = 0;
  backend.publishCloudflarePublicDataSnapshot_ = () => {
    publishCalls++;
    return { ok: true };
  };

  const result = backend.executeAutoRefreshFinalizeTask_(current, tasks.find((task) => task.type === "finalize"), Date.now());
  const queue = backend.readAutoRefreshQueueCurrent_();
	const event = backend.readSeasonEventById_("cwl-active");
	const lastJob = backend.decodeFirebaseObjectKeysRecursive_(backend.firebaseRequestJson_("internal/autoRefresh/lastJob", "GET"));

	assert.equal(result.status, "completed");
  assert.equal(backend.readPublishedActiveVersionId_(), runId);
	assert.equal(queue, null);
	assert.equal(lastJob.cwlFinalCoordinatorCapture.aggregateOk, false);
	assert.equal(["stale", "deferred", "failed"].includes(lastJob.cwlFinalOutcome.status), true);
	assert.notEqual(event.cwlTrackingState, "completed");
	assert.equal(backend.firebaseRequestJson_("internal/autoRefresh/runs/run-1", "GET"), null);
  assert.equal(publishCalls, 0);
});

test("production-shaped stuck finalization self-heals without reopening roster or CWL work", () => {
  const backend = installMemoryFirebase(loadBackend(), buildCurrentCwlEventDb());
  const data = backend.validateRosterData_(buildRosterData());
  const { runId, current, tasks } = setupQueueRun(backend, data, {
    rosterIds: ["main"],
    currentTaskIndex: 3,
    processedTasks: 3,
    processedRosters: 1,
    sourceVersionId: "source-1",
    status: "finalizing",
  });
  stageCompletedRosterOutputs(backend, runId, data, ["main"]);
  backend.writeActiveRosterVersionShards_(runId, data, {
    source: "auto-refresh",
    runId,
    publishedAt: "2026-07-11T00:00:00.000Z",
    publish: true,
  });
  backend.writeAutoRefreshRunShard_(runId, "cwl/summary", {
    completed: true,
    finalCapture: true,
    eventId: "cwl-active",
    capturedAt: "2026-07-11T00:00:00.000Z",
    writtenAt: "2026-07-11T00:00:01.000Z",
    aggregateHash: "same-aggregate",
    eventAggregateResult: { ok: false, status: "partial-cwl-refresh" },
    requestCounts: { leagueGroup: 1, cwlWar: 1, total: 2 },
  }, "PUT");
  backend.writeAutoRefreshRunShard_(runId, "final/cwlSeasonEventRefresh", {
    completed: true,
    ok: true,
    status: "active",
    eventId: "cwl-active",
    aggregateHash: "same-aggregate",
    writtenAt: "2026-07-11T00:00:02.000Z",
  }, "PUT");
  current.status = "finalizing";
  current.phase = "cwl-season-event-refresh";
  backend.writeAutoRefreshQueueCurrent_(current, false);
  backend.scheduleAutoRefreshJobResume_();
  backend.scheduleAutoRefreshJobWatchdog_();
  let enqueueAttempts = 0;
  backend.enqueueCloudflareActiveTarget_ = (versionId) => {
    enqueueAttempts++;
    return { ok: true, pending: true, queued: true, scheduled: true, versionId };
  };

  const recovered = backend.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() });
  const lastJob = backend.decodeFirebaseObjectKeysRecursive_(backend.firebaseRequestJson_("internal/autoRefresh/lastJob", "GET"));
  const event = backend.readSeasonEventById_("cwl-active");

  assert.equal(recovered.status, "completed");
  assert.equal(recovered.alreadyPublished, true);
  assert.equal(enqueueAttempts, 1);
  assert.equal(lastJob.cwlFinalCoordinatorCapture.aggregateOk, false);
  assert.equal(lastJob.cwlSeasonEventRefresh.status, "active");
  assert.equal(lastJob.cwlFinalOutcome.status, "failed");
  assert.equal(event.cwlTrackingState, "active");
  assert.equal(backend.readAutoRefreshQueueCurrent_(), null);
  assert.equal(backend.__triggers.filter((trigger) => trigger.getHandlerFunction() === "autoRefreshWorkerTick").length, 0);

  const repeated = backend.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() });
  assert.equal(repeated.reason, "noRun");
  assert.equal(enqueueAttempts, 1);
  backend.isRecentSuccessfulActiveWrite_ = () => true;
  backend.getCurrentCwlSeasonEventRefreshNeed_ = () => ({ needsCwl: false });
  const nextCoordinator = backend.startAutoRefreshQueueCoordinator_({ executionStartMs: Date.now() });
  assert.notEqual(nextCoordinator.reason, "existingRun");
});

test("CWL side outcomes never block canonical roster completion or falsely complete an event", () => {
  const cases = [
    { name: "waiting", capture: { ok: true, status: "captured", aggregateOk: true }, refresh: { ok: true, status: "waiting", eventId: "cwl-active" } },
    { name: "finalizing", capture: { ok: true, status: "captured", aggregateOk: true }, refresh: { ok: true, status: "finalizing", eventId: "cwl-active" } },
    { name: "stale", capture: { ok: true, status: "captured", aggregateOk: false }, refresh: { ok: false, status: "stale", eventId: "cwl-active", reason: "partial" } },
    { name: "bootstrap-incomplete", capture: { ok: true, status: "captured", aggregateOk: false }, refresh: { ok: false, status: "bootstrap-incomplete", eventId: "cwl-active" } },
    { name: "fetch-failure", capture: { ok: true, status: "captured", aggregateOk: false }, refresh: { ok: false, status: "error", eventId: "cwl-active", error: "fetch failed" } },
    { name: "deadline", capture: { ok: false, status: "deferred", reason: "executionDeadline", eventId: "cwl-active" }, refresh: null },
  ];
  for (const scenario of cases) {
    const initial = buildCurrentCwlEventDb();
    initial.events.seasonEvents.byId["cwl-active"].cwlTrackingState = scenario.name === "finalizing" ? "finalizing" : "active";
    const backend = installMemoryFirebase(loadBackend(), initial);
    const data = backend.validateRosterData_(buildRosterData());
    const { runId, current, tasks } = setupQueueRun(backend, data, {
      rosterIds: ["main"],
      currentTaskIndex: 3,
      processedTasks: 3,
      processedRosters: 1,
      sourceVersionId: "source-1",
    });
    backend.firebaseRequestJson_("activePublished/currentVersionId", "PUT", "source-1");
    stageCompletedRosterOutputs(backend, runId, data, ["main"]);
    backend.ensureAutoRefreshFinalCwlCoordinatorCapture_ = () => clone(scenario.capture);
    backend.refreshCwlSeasonEventForAutoRefreshQueue_ = () => scenario.refresh ? clone(scenario.refresh) : (() => { throw new Error("lifecycle refresh must not run after deferred capture"); })();
    backend.tryReconcileRegularWarFinalizationTriggerStateValidated_ = () => null;
    backend.tryReconcileCurrentSeasonEventsForAutoRefresh_ = () => null;
    backend.enqueueCloudflareActiveTarget_ = () => ({ ok: true, pending: true, queued: true, scheduled: true });

    const result = backend.executeAutoRefreshFinalizeTask_(current, tasks.find((task) => task.type === "finalize"), Date.now());
    const event = backend.readSeasonEventById_("cwl-active");
    const lastJob = backend.decodeFirebaseObjectKeysRecursive_(backend.firebaseRequestJson_("internal/autoRefresh/lastJob", "GET"));
    assert.equal(result.status, "completed", scenario.name);
    assert.equal(backend.readPublishedActiveVersionId_(), runId, scenario.name);
    assert.equal(backend.readAutoRefreshQueueCurrent_(), null, scenario.name);
    assert.notEqual(event.cwlTrackingState, "completed", scenario.name);
    assert.equal(["successful", "stale", "deferred", "failed"].includes(lastJob.cwlFinalOutcome.status), true, scenario.name);
  }
});

test("Cloudflare degraded scheduling completes the roster run and records repair state", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildRosterData());
  const { runId, current, tasks } = setupQueueRun(backend, data, {
    rosterIds: ["main"],
    currentTaskIndex: 2,
    processedTasks: 2,
    processedRosters: 1,
    sourceVersionId: "source-1",
  });
  backend.firebaseRequestJson_("activePublished/currentVersionId", "PUT", "source-1");
  stageCompletedRosterOutputs(backend, runId, data, ["main"]);
  backend.enqueueCloudflareActiveTarget_ = () => ({ ok: true, pending: true, queued: true, scheduled: false, degradedScheduling: true });
  const result = backend.executeAutoRefreshFinalizeTask_(current, tasks.find((task) => task.type === "finalize"), Date.now());
  const lastJob = backend.decodeFirebaseObjectKeysRecursive_(backend.firebaseRequestJson_("internal/autoRefresh/lastJob", "GET"));
  assert.equal(result.status, "completed");
  assert.equal(lastJob.cloudflarePublicDataPublish.degradedScheduling, true);
  assert.equal(lastJob.cloudflarePublicDataPublish.repairPending, true);
  assert.equal(backend.readAutoRefreshQueueCurrent_(), null);
});

test("failed CWL side work gets an independent retry whose marker survives scheduling failure and clears on success", () => {
  const backend = installMemoryFirebase(loadBackend(), {
    events: { seasonEvents: { currentCwl: { eventId: "cwl-retry" }, current: { cwl: { eventId: "cwl-retry" } }, byId: { "cwl-retry": { eventId: "cwl-retry", type: "cwl", status: "open", cwlTrackingState: "active", cwl: {}, participantsByDiscordId: {}, participantsByTag: {} } } } },
  });
  const scope = backend.buildCwlRuntimeRecoveryScope_("cwl-retry");
  backend.markRuntimeRecoveryNeeded_(scope, "side-phase-failed", { eventId: "cwl-retry" });
  backend.__failNextTriggerCreates(1);
  const failedSchedule = backend.scheduleCwlSeasonEventRecovery_();
  assert.equal(failedSchedule.scheduled, false);
  assert.ok(backend.readRuntimeRecoveryMarker_().scopes[scope]);

  const watchdogRepair = backend.repairCwlSeasonEventRecoverySchedulingFromPermanentWatchdog_();
  assert.equal(watchdogRepair.scheduled, true);
  const configuredTriggerId = backend.__properties.get("CWL_RECOVERY_TRIGGER_ID");
  backend.refreshCurrentCwlSeasonEventCore_ = () => ({ ok: true, status: "active", eventId: "cwl-retry" });
  const recovered = backend.runOneCwlSeasonEventRecovery_();
  assert.equal(recovered.cleared, true);
  assert.equal(backend.readRuntimeRecoveryMarker_().scopes[scope], undefined);
  assert.equal(backend.readAutoRefreshQueueCurrent_(), null);

  backend.markRuntimeRecoveryNeeded_("cwl-refresh", "legacy-side-marker", { eventId: "cwl-retry" });
  const migratedLegacy = backend.runOneCwlSeasonEventRecovery_();
  assert.equal(migratedLegacy.cleared, true);
  assert.equal(backend.readRuntimeRecoveryMarker_().scopes["cwl-refresh"], undefined);

  const otherScope = backend.buildCwlRuntimeRecoveryScope_("cwl-other");
  backend.markRuntimeRecoveryNeeded_(otherScope, "other-event-failed", { eventId: "cwl-other" });
  backend.recordAutoRefreshCwlFinalOutcomeRecovery_("deleted-run", { eventId: "cwl-retry", status: "successful", retryPending: false });
  assert.ok(backend.readRuntimeRecoveryMarker_().scopes[otherScope]);
  assert.equal(backend.runOneCwlSeasonEventRecovery_.toString().includes("readAutoRefreshRunShard_"), false);

  const foreignConsume = backend.consumeCwlSeasonEventRecoveryTrigger_({ triggerUid: "another-owner" });
  assert.equal(foreignConsume.owned, false);
  assert.equal(backend.__properties.get("CWL_RECOVERY_TRIGGER_ID"), configuredTriggerId);
});

test("auto-refresh reconciliation queues exact new push and donation events while roster completion stays independent", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildRosterData());
  const { runId, current, tasks } = setupQueueRun(backend, data, {
    rosterIds: ["main"], currentTaskIndex: 2, processedTasks: 2, processedRosters: 1, sourceVersionId: "source-1",
  });
  backend.firebaseRequestJson_("activePublished/currentVersionId", "PUT", "source-1");
  stageCompletedRosterOutputs(backend, runId, data, ["main"]);
  backend.getCurrentCwlSeasonEventRefreshNeed_ = () => ({ needsCwl: false });
  backend.enqueueCloudflareActiveTarget_ = () => ({ ok: false, queued: true, scheduled: false, degradedScheduling: true });
  let exactMutation = null;
  let broadRepairs = 0;
  backend.enqueueCloudflareSeasonEventReconciliation_ = (mutation) => { exactMutation = clone(mutation); return { ok: false, scheduled: false, repairPending: true }; };
  backend.enqueueCloudflareRelevantSeasonPublication_ = () => { broadRepairs++; return { ok: true }; };

  const result = backend.executeAutoRefreshFinalizeTask_(current, tasks.find((task) => task.type === "finalize"), Date.now());
  assert.equal(result.status, "completed");
  assert.equal(backend.readAutoRefreshQueueCurrent_(), null);
  assert.deepEqual(exactMutation.eventIds.map((id) => id.split("-")[0]).sort(), ["donation", "push"]);
  assert.equal(exactMutation.pointerPaths.length, 4);
  assert.equal(broadRepairs, 0);
});

test("continuation and watchdog replacement failures preserve the previously owned recovery triggers", () => {
  const backend = loadBackend();
  const oldContinuation = backend.scheduleAutoRefreshJobResume_();
  const continuationId = oldContinuation.triggerId;
  backend.__properties.set("AUTO_REFRESH_JOB_TRIGGER_AT", String(Date.now() + 10 * 60 * 1000));
  backend.__failNextTriggerCreates(1);
  const continuationFailure = backend.scheduleAutoRefreshJobResume_();
  assert.equal(continuationFailure.scheduled, false);
  assert.equal(continuationFailure.preservedTriggerId, continuationId);
  assert.equal(backend.__triggers.some((trigger) => trigger.getUniqueId() === continuationId), true);

  const oldWatchdog = backend.scheduleAutoRefreshJobWatchdog_();
  const watchdogId = oldWatchdog.triggerId;
  backend.__properties.set("AUTO_REFRESH_JOB_WATCHDOG_TRIGGER_AT", String(Date.now() + 1000));
  backend.__failNextTriggerCreates(1);
  const watchdogFailure = backend.scheduleAutoRefreshJobWatchdog_();
  assert.equal(watchdogFailure.scheduled, false);
  assert.equal(watchdogFailure.preservedTriggerId, watchdogId);
  assert.equal(backend.__triggers.some((trigger) => trigger.getUniqueId() === watchdogId), true);
});

test("already-published recovery never resumes writes into an incomplete selected immutable version", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildRosterData());
  backend.writeActiveRosterVersionShards_("source-1", data, { source: "test-source", publishedAt: "2026-07-10T00:00:00.000Z", publish: true });
  const { runId, current, tasks } = setupQueueRun(backend, data, {
    rosterIds: ["main"],
    currentTaskIndex: 3,
    processedTasks: 3,
    processedRosters: 1,
    sourceVersionId: "source-1",
    status: "finalizing",
  });
  backend.writeActiveRosterVersionShards_(runId, data, { source: "test", runId, publish: true });
  backend.firebaseRequestJson_(`activeVersions/${runId}/rosters/main`, "DELETE");
  let enqueues = 0;
  backend.enqueueCloudflareActiveTarget_ = () => { enqueues++; return { ok: true }; };

  const result = backend.executeAutoRefreshFinalizeTask_(current, tasks.find((task) => task.type === "finalize"), Date.now());
  assert.equal(result.terminal, true);
  assert.equal(result.status, "repaired");
  assert.equal(result.canonicalRepair.status, "rolled-back-to-known-good");
  assert.equal(backend.readPublishedActiveVersionId_(), "source-1");
  assert.equal(backend.readAutoRefreshQueueCurrent_(), null);
  assert.equal(backend.firebaseRequestJson_(`activeVersions/${runId}/rosters/main`, "GET"), null);
  assert.equal(enqueues, 1);
  const repeated = backend.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() });
  assert.equal(repeated.reason, "noRun");
  assert.equal(backend.readPublishedActiveVersionId_(), "source-1");
  assert.equal(enqueues, 1);
});

test("terminal cleanup preserves a newer run and its owned dynamic triggers", () => {
  const backend = installMemoryFirebase(loadBackend());
  const oldRun = setupQueueRun(backend, buildRosterData(), { runId: "old-run", rosterIds: ["main"] });
  backend.scheduleAutoRefreshJobResume_();
  backend.scheduleAutoRefreshJobWatchdog_();
  const triggerIds = backend.__triggers.map((trigger) => trigger.getUniqueId()).sort();
  const newer = Object.assign({}, oldRun.current, { runId: "new-run", status: "running" });
  backend.writeAutoRefreshQueueCurrent_(newer, false);

  backend.archiveAndClearAutoRefreshQueueStateBestEffort_(oldRun.current, "completed", "old complete", "", "ownership-test");

  assert.equal(backend.readAutoRefreshQueueCurrent_().runId, "new-run");
  assert.deepEqual(backend.__triggers.map((trigger) => trigger.getUniqueId()).sort(), triggerIds);
});

test("queue finalization completes canonically while Cloudflare publication is unavailable", () => {
  const backend = installMemoryFirebase(loadBackend(), buildCurrentCwlEventDb());
  const data = backend.validateRosterData_(buildRosterData());
  const { runId, current, tasks } = setupQueueRun(backend, data, {
    rosterIds: ["main"],
    currentTaskIndex: 3,
    processedTasks: 3,
    processedRosters: 1,
    sourceVersionId: "source-1",
  });
  backend.firebaseRequestJson_("activePublished/currentVersionId", "PUT", "source-1");
  stageCompletedRosterOutputs(backend, runId, data, ["main"]);
  const paths = installCwlFetch(backend, () => buildOneRoundCwlWar({ state: "inWar", stars: 3, destruction: 100 }));
  let activeSnapshotReads = 0;
  backend.readActiveRosterSnapshot_ = () => {
    activeSnapshotReads++;
    throw new Error("already-published recovery should not read the full active snapshot");
  };
  backend.tryReconcileRegularWarFinalizationTriggerStateValidated_ = () => null;
  backend.tryReconcileCurrentSeasonEventsForAutoRefresh_ = () => null;
  let enqueueAttempts = 0;
  backend.enqueueCloudflareActiveTarget_ = (versionId, label) => {
    enqueueAttempts++;
    return { ok: false, skipped: true, reason: "cloudflare-unavailable", versionId, label };
  };

  const first = backend.executeAutoRefreshFinalizeTask_(current, tasks.find((task) => task.type === "finalize"), Date.now());
  const firstCwlRequests = paths.filter((path) => path.includes("/currentwar/leaguegroup") || path.includes("/clanwarleagues/wars/")).length;
  const lastJob = backend.decodeFirebaseObjectKeysRecursive_(backend.firebaseRequestJson_("internal/autoRefresh/lastJob", "GET"));

  assert.equal(first.status, "completed");
  assert.equal(firstCwlRequests, 2);
  assert.equal(enqueueAttempts, 1);
  assert.equal(activeSnapshotReads, 0);
  assert.equal(lastJob.cwlSeasonEventRefresh.status, "active");
  assert.equal(backend.readAutoRefreshQueueCurrent_(), null);
  assert.equal(backend.firebaseRequestJson_("internal/autoRefresh/runs/run-1", "GET"), null);
});

test("queue finalization skips CWL collection when there is no current CWL event", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildRosterData());
  const { runId, current, tasks } = setupQueueRun(backend, data, {
    rosterIds: ["main"],
    currentTaskIndex: 3,
    processedTasks: 3,
    processedRosters: 1,
    sourceVersionId: "source-1",
  });
  backend.firebaseRequestJson_("activePublished/currentVersionId", "PUT", "source-1");
  stageCompletedRosterOutputs(backend, runId, data, ["main"]);
  let cwlRequests = 0;
  backend.cocFetchAllByPathEntries_ = (entriesRaw) => {
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
    cwlRequests += entries.filter((entry) => String(entry.path || "").includes("/currentwar/leaguegroup") || String(entry.path || "").includes("/clanwarleagues/wars/")).length;
    return { dataByKey: {}, errorByKey: {}, requestCount: entries.length, batchCount: entries.length ? 1 : 0 };
  };
  backend.readActiveRosterSnapshot_ = () => {
    throw new Error("no-current-CWL finalization should not read full active payload");
  };
  backend.tryReconcileRegularWarFinalizationTriggerStateValidated_ = () => null;
  backend.tryReconcileCurrentSeasonEventsForAutoRefresh_ = () => null;
  let publishCalls = 0;
  backend.publishCloudflarePublicDataSnapshot_ = () => {
    publishCalls++;
    const versionId = backend.readPublishedActiveVersionId_();
    return {
      ok: true,
      active: { ok: true, versionId, publicResult: { ok: true, putCount: 6 }, botResult: { ok: true, putCount: 4 } },
      cwlLeagueSignups: { ok: true, putCount: 0 },
      seasonEvents: { ok: true, putCount: 0, deleteCount: 0 },
    };
  };
  backend.verifyCloudflarePublicActiveVersionId_ = (versionId) => ({ ok: true, statusCode: 200, expectedVersionId: versionId, actualVersionId: versionId });

  const finalCwlTaskResult = backend.executeAutoRefreshFinalCwlCoordinatorTask_(current, tasks.find((task) => task.type === "cwlFinalCoordinator"), Date.now());
  const result = backend.executeAutoRefreshFinalizeTask_(current, tasks.find((task) => task.type === "finalize"), Date.now());
  const lastJob = backend.decodeFirebaseObjectKeysRecursive_(backend.firebaseRequestJson_("internal/autoRefresh/lastJob", "GET"));

  assert.equal(finalCwlTaskResult.skipped, true);
  assert.equal(finalCwlTaskResult.reason, "no-current-cwl-event");
  assert.equal(result.status, "completed");
  assert.equal(cwlRequests, 0);
  assert.equal(publishCalls, 0);
  assert.equal(lastJob.cwlFinalCoordinatorCapture.status, "no-current-cwl-event");
  assert.equal(lastJob.cwlSeasonEventRefresh.status, "no-current-cwl-event");
});

test("queue finalization refuses duplicate player tags before publishing staged active version", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildRosterData());
  const { runId, current, tasks } = setupQueueRun(backend, data, {
    rosterIds: ["main", "second"],
    currentTaskIndex: 3,
    processedTasks: 3,
    processedRosters: 2,
    sourceVersionId: "source-1",
  });
  backend.firebaseRequestJson_("activePublished/currentVersionId", "PUT", "source-1");
  for (const roster of data.rosters) {
    backend.firebaseRequestJson_("activeVersions/run-1/rosters/" + roster.id, "PUT", backend.encodeFirebaseObjectKeysRecursive_(roster));
    backend.writeAutoRefreshRunShard_(runId, "warResults/" + roster.id, { rosterId: roster.id, rosterShardWritten: true, issues: [] }, "PUT");
    backend.writeAutoRefreshRunShard_(runId, "metricResults/" + roster.id, { metricsStaged: true, tags: [] }, "PUT");
  }
  backend.writeAutoRefreshRunShard_(runId, "rosterWrites/main", { rosterId: "main", versionId: runId, playerTags: ["#DUP"] }, "PUT");
  backend.writeAutoRefreshRunShard_(runId, "rosterWrites/second", { rosterId: "second", versionId: runId, playerTags: ["#DUP"] }, "PUT");
  backend.readActiveRosterSnapshot_ = () => {
    throw new Error("duplicate marker validation should not read the active payload");
  };
  const finalizeTask = tasks.find((task) => task.type === "finalize");

  assert.throws(
    () => backend.executeAutoRefreshFinalizeTask_(current, finalizeTask, Date.now()),
    /Duplicate player tag in output: #DUP/,
  );
  assert.equal(backend.readPublishedActiveVersionId_(), "source-1");
});

test("queue finalization marks stale source version mismatch without reading the active payload", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildRosterData());
  const { runId, current, tasks } = setupQueueRun(backend, data, {
    rosterIds: ["main"],
    currentTaskIndex: 2,
    processedTasks: 2,
    processedRosters: 1,
    sourceVersionId: "source-1",
  });
  backend.firebaseRequestJson_("activePublished/currentVersionId", "PUT", "source-2");
  backend.firebaseRequestJson_("activeVersions/run-1/rosters/main", "PUT", backend.encodeFirebaseObjectKeysRecursive_(data.rosters[0]));
  backend.writeAutoRefreshRunShard_(runId, "rosterWrites/main", { rosterId: "main", versionId: runId }, "PUT");
  backend.writeAutoRefreshRunShard_(runId, "warResults/main", { rosterId: "main", rosterShardWritten: true, issues: [] }, "PUT");
  backend.writeAutoRefreshRunShard_(runId, "metricResults/main", { byTag: {}, tags: [] }, "PUT");
  let activePayloadReads = 0;
  backend.readActiveRosterSnapshot_ = () => {
    activePayloadReads++;
    throw new Error("stale finalization should not read the active payload");
  };
  backend.tryReconcileRegularWarFinalizationTriggerStateValidated_ = () => null;
  const finalizeTask = tasks.find((task) => task.type === "finalize");

  const result = backend.executeAutoRefreshFinalizeTask_(current, finalizeTask, Date.now());

  assert.equal(result.status, "stale");
  assert.equal(activePayloadReads, 0);
  assert.equal(backend.readPublishedActiveVersionId_(), "source-2");
  assert.equal(backend.firebaseRequestJson_("internal/autoRefresh/runs/run-1", "GET"), null);
  assert.equal(backend.firebaseRequestJson_("activeVersions/run-1", "GET"), null);
});

test("queue finalization refuses to publish when a metric shard is missing", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildRosterData());
  const { runId, current, tasks } = setupQueueRun(backend, data, {
    rosterIds: ["main"],
    currentTaskIndex: 2,
    processedTasks: 2,
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
    currentTaskIndex: 2,
    processedTasks: 2,
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
  assert.equal(backend.firebaseRequestJson_("internal/autoRefresh/runs/run-1", "GET"), null);
  assert.equal(backend.firebaseRequestJson_("activeVersions/run-1", "GET"), null);
});

test("selected complete canonical version terminalizes with missing internal task and source markers", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildRosterData());
  const { runId, current, tasks } = setupQueueRun(backend, data, {
    rosterIds: ["main"],
    currentTaskIndex: 3,
    processedTasks: 2,
    processedRosters: 1,
  });
  backend.writeActiveRosterVersionShards_(runId, data, { source: "auto-refresh", runId, publishedAt: "2026-05-25T00:00:00.000Z", publish: true });
  backend.firebaseRequestJson_(`internal/autoRefresh/runs/${runId}/source`, "DELETE");
  backend.firebaseRequestJson_(`internal/autoRefresh/runs/${runId}/tasks`, "DELETE");
  backend.firebaseRequestJson_(`internal/autoRefresh/runs/${runId}/results`, "DELETE");
  backend.firebaseRequestJson_(`internal/autoRefresh/runs/${runId}/rosterWrites`, "DELETE");
  let activeReads = 0;
  let cloudflarePublishSawClearedQueue = false;
  backend.readActiveRosterSnapshot_ = () => {
    activeReads++;
    throw new Error("active read intentionally skipped in test");
  };
  const publishOptions = [];
  backend.publishCloudflarePublicDataSnapshot_ = (options) => {
    publishOptions.push(clone(options));
    cloudflarePublishSawClearedQueue = backend.readAutoRefreshQueueCurrent_() === null;
    return {
      ok: true,
      active: {
        ok: true,
        versionId: runId,
        publicResult: { ok: true, putCount: 6 },
        botResult: { ok: true, putCount: 4 },
      },
      cwlLeagueSignups: { ok: true, putCount: 1 },
      seasonEvents: { ok: true, putCount: 3, deleteCount: 1 },
    };
  };
  backend.verifyCloudflarePublicActiveVersionId_ = (versionId) => ({
    ok: true,
    statusCode: 200,
    expectedVersionId: versionId,
    actualVersionId: versionId,
  });
  const finalizeTask = tasks.find((task) => task.type === "finalize");

  const result = backend.executeAutoRefreshFinalizeTask_(current, finalizeTask, Date.now());

  assert.equal(result.status, "completed");
  assert.equal(result.alreadyPublished, true);
  assert.equal(activeReads, 0);
  assert.equal(publishOptions.length, 0);
  assert.equal(cloudflarePublishSawClearedQueue, false);
  assert.equal(result.skipPostTickMirrorRepair, true);
  assert.equal(backend.readAutoRefreshQueueCurrent_(), null);
  assert.equal(backend.firebaseRequestJson_("internal/autoRefresh/runs/run-1", "GET"), null);
});

test("queue worker recovers after partial completion by continuing at the next pending task", () => {
  const backend = installMemoryFirebase(loadBackend());
  const { runId, taskIds } = setupQueueRun(backend, buildRosterData(), {
    rosterIds: ["main", "second"],
    currentTaskIndex: 1,
    processedTasks: 1,
    processedRosters: 1,
  });
  const data = backend.validateRosterData_(buildRosterData());
  backend.firebaseRequestJson_("activeVersions/run-1/rosters/main", "PUT", backend.encodeFirebaseObjectKeysRecursive_(data.rosters[0]));
  backend.writeAutoRefreshRunShard_(runId, "rosterWrites/main", { rosterId: "main", versionId: runId }, "PUT");
  backend.writeAutoRefreshRunShard_(runId, "warResults/main", { rosterId: "main", rosterShardWritten: true, issues: [] }, "PUT");
  backend.writeAutoRefreshRunShard_(runId, "metricResults/main", { byTag: {}, tags: [] }, "PUT");
  const mainTask = backend.readAutoRefreshTask_(runId, taskIds[1]);
  mainTask.status = "completed";
  mainTask.completedAt = "2026-05-25T00:00:00.000Z";
  backend.writeAutoRefreshTask_(runId, mainTask);
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
  assert.equal(current.currentTaskIndex, 3);
  assert.equal(current.processedRosters, 2);
});

test("queue worker retries a stale running roster task instead of waiting", () => {
  const backend = installMemoryFirebase(loadBackend());
  const sourceData = buildRosterData();
  sourceData.rosters[0].trackingMode = "regularWar";
  const { runId, current, tasks } = setupQueueRun(backend, sourceData, {
    rosterIds: ["main"],
  });
  const rosterTask = firstRosterTask(tasks);
  const staleAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  rosterTask.status = "running";
  rosterTask.startedAt = staleAt;
  rosterTask.updatedAt = staleAt;
  rosterTask.attempts = 1;
  backend.writeAutoRefreshRunShard_(runId, "tasks/" + backend.encodeFirebaseObjectKey_(rosterTask.taskId), rosterTask, "PUT");
  current.currentTaskIndex = rosterTask.index;
  current.processedTasks = rosterTask.index;
  backend.writeAutoRefreshQueueCurrent_(current, false);
  let pipelineCalls = 0;
  backend.fetchClanMembersSnapshot_ = () => ({
    clanTag: "#CLAN",
    members: [{ tag: "#PLAYER", name: "Player", townHallLevel: 16 }],
    metricsMembers: [{ tag: "#PLAYER", name: "Player", trophies: 5000 }],
  });
  backend.processRefreshAllRosterPipelineIntoAccumulator_ = (rosterData, rosterId, _options, accumulator) => {
    pipelineCalls++;
    accumulator.perRoster.push({ rosterId, ok: true, issueCount: 0, issues: [] });
    return {
      rosterData,
      pipelineResult: { memberTracking: { capturedPlayers: 1 } },
    };
  };

  const result = backend.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() });
  const updatedTask = backend.readAutoRefreshTask_(runId, rosterTask.taskId);
  const updatedCurrent = backend.readAutoRefreshQueueCurrent_();

  assert.equal(result.inProgress, true);
  assert.notEqual(result.reason, "taskRunning");
  assert.equal(pipelineCalls, 1);
  assert.equal(updatedTask.status, "completed");
  assert.equal(updatedCurrent.processedRosters, 1);
});

test("queue worker synthesizes finalization when persisted task list has no finalize task", () => {
  const backend = installMemoryFirebase(loadBackend());
  const data = backend.validateRosterData_(buildRosterData());
  const { runId, current } = setupQueueRun(backend, data, {
    rosterIds: ["main"],
    sourceVersionId: "source-1",
  });
  backend.firebaseRequestJson_("activePublished/currentVersionId", "PUT", "source-1");
  stageCompletedRosterOutputs(backend, runId, data, ["main"]);
  const keptTaskIds = [];
  for (const taskId of current.taskIds) {
    const task = backend.readAutoRefreshTask_(runId, taskId);
    if (task.type === "finalize") continue;
    task.status = "completed";
    task.completedAt = "2026-05-25T00:00:00.000Z";
    backend.writeAutoRefreshTask_(runId, task);
    keptTaskIds.push(taskId);
  }
  current.taskIds = keptTaskIds;
  current.taskCount = keptTaskIds.length;
  current.currentTaskIndex = keptTaskIds.length;
  current.processedTasks = keptTaskIds.length;
  current.processedRosters = 1;
  backend.writeAutoRefreshQueueCurrent_(current, false);
  backend.readActiveRosterSnapshot_ = () => {
    throw new Error("synthetic finalization should use source metadata and run shards");
  };
  backend.tryReconcileRegularWarFinalizationTriggerStateValidated_ = () => null;
  backend.tryReconcileCurrentSeasonEventsForAutoRefresh_ = () => null;
  installCloudflareMirrorSuccess(backend);

  const result = backend.continueAutoRefreshQueueWorker_({ executionStartMs: Date.now() });

  assert.equal(result.status, "completed");
  assert.equal(backend.readPublishedActiveVersionId_(), runId);
  assert.equal(backend.readAutoRefreshQueueCurrent_(), null);
  assert.equal(backend.firebaseRequestJson_("internal/autoRefresh/runs/run-1", "GET"), null);
});

test("queue worker clears stale auto-refresh lock after timeout-shaped finalization", () => {
  const backend = installMemoryFirebase(loadBackend());
  backend.__properties.set("AUTO_REFRESH_ENABLED", "true");
  const { runId, current, tasks } = setupQueueRun(backend, buildRosterData(), {
    rosterIds: ["main"],
    currentTaskIndex: 3,
    processedTasks: 2,
    processedRosters: 1,
    status: "finalizing",
  });
  const finalizeTask = tasks.find((task) => task.type === "finalize");
  finalizeTask.status = "running";
  finalizeTask.startedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  finalizeTask.updatedAt = finalizeTask.startedAt;
  backend.writeAutoRefreshRunShard_(runId, "tasks/" + backend.encodeFirebaseObjectKey_(finalizeTask.taskId), finalizeTask, "PUT");
  current.status = "finalizing";
  current.phase = "cloudflare-publish";
  current.taskSummary = {
    taskId: finalizeTask.taskId,
    type: "finalize",
    startedAt: finalizeTask.startedAt,
    updatedAt: finalizeTask.updatedAt,
  };
  backend.writeAutoRefreshQueueCurrent_(current, false);
  backend.__properties.set("ACTIVE_ROSTER_JOB_LOCK", JSON.stringify({
    token: "stale-auto-refresh",
    owner: "auto-refresh-worker",
    expiresAt: Date.now() + 10 * 60 * 1000,
  }));

  const result = backend.autoRefreshWorkerTick();

  assert.equal(result.inProgress, true);
  assert.equal(result.reason, "overlap");
  assert.equal(result.lockRecovery.cleared, true);
  assert.equal(result.lockRecovery.taskId, finalizeTask.taskId);
  assert.equal(backend.__properties.get("ACTIVE_ROSTER_JOB_LOCK"), undefined);
  assert.equal(backend.__triggers.filter((trigger) => trigger.getHandlerFunction() === "autoRefreshWorkerTick").length, 1);
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
