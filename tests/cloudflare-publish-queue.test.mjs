import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const repoRoot = new URL("../", import.meta.url);

const clone = (value) => JSON.parse(JSON.stringify(value));

const loadQueue = () => {
  const source = fs.readFileSync(new URL("script/cloudflarePublishQueue.js", repoRoot), "utf8");
  let uuid = 0;
  const context = {
    console,
    Logger: { log() {} },
    Utilities: {
      getUuid: () => `uuid-${++uuid}`,
      sleep() {},
      newBlob: (value) => ({ getBytes: () => Array.from(Buffer.from(String(value ?? ""), "utf8")) }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {}, deleteProperty() {} }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    ScriptApp: undefined,
    CLOUDFLARE_PUBLICATION_MODE_PROPERTY: "MODE",
    CLOUDFLARE_PUBLICATION_MODE_QUEUED_V2: "queued-v2",
    CLOUDFLARE_PUBLICATION_MODE_DISABLED: "disabled",
    CLOUDFLARE_PUBLICATION_MODE_LEGACY_MANUAL: "legacy-manual",
    CLOUDFLARE_PUBLISH_QUEUE_HANDLER_NAME: "cloudflarePublishWorkerTick",
    CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_ID_PROPERTY: "TRIGGER",
    CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_AT_PROPERTY: "TRIGGER_AT",
    CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY: "LOCK",
    CLOUDFLARE_PUBLISH_QUEUE_LOCK_LEASE_MS: 300000,
    CLOUDFLARE_PUBLISH_QUEUE_LOCK_POLL_MS: 1,
    CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_DELAY_MS: 60000,
    CLOUDFLARE_PUBLISH_QUEUE_EXECUTION_BUDGET_MS: 240000,
    CLOUDFLARE_PUBLISH_QUEUE_REQUEST_TIMEOUT_SECONDS: 20,
    CLOUDFLARE_PUBLISH_QUEUE_MAX_REQUESTS_PER_TICK: 2,
    CLOUDFLARE_PUBLISH_QUEUE_MAX_OBJECTS_PER_REQUEST: 24,
    CLOUDFLARE_PUBLISH_QUEUE_MAX_PAYLOAD_BYTES: 10 * 1024 * 1024,
    CLOUDFLARE_PUBLISH_QUEUE_HARD_OBJECT_BYTES: 8 * 1024 * 1024,
    CLOUDFLARE_PUBLISH_QUEUE_BASE_RETRY_MS: 60000,
    CLOUDFLARE_PUBLISH_QUEUE_MAX_RETRY_MS: 21600000,
    FIREBASE_INTERNAL_CLOUDFLARE_PUBLISH_STATE_PATH: "internal/cloudflarePublish/state",
    CLOUDFLARE_PUBLIC_DATA_BOOTSTRAP_PATH: "bootstrap/current",
    SEASON_EVENTS_CURRENT_PATH: "events/seasonEvents/current",
    SEASON_EVENTS_CURRENT_CWL_PATH: "events/seasonEvents/currentCwl",
    SEASON_EVENTS_LATEST_COMPLETED_CWL_PATH: "events/seasonEvents/latestCompletedCwl",
    SEASON_EVENTS_SEASON_STATE_CURRENT_PATH: "events/seasonEvents/seasonState/current",
    SEASON_EVENTS_BY_SEASON_PATH: "events/seasonEvents/bySeason",
    SEASON_EVENTS_BY_ID_PATH: "events/seasonEvents/byId",
    FIREBASE_DONATION_REFRESH_PATH: "donationRefresh",
    CWL_LEAGUE_SIGNUPS_ACTIVE_PATH: "active/cwlLeagueSignups",
    normalizeActiveVersionId_: (value) => String(value ?? "").trim(),
    toNonNegativeInt_: (value) => Math.max(0, Math.floor(Number(value) || 0)),
    parseIsoToMs_: (value) => Date.parse(value) || 0,
    getOptionalScriptProperty_: () => "queued-v2",
    isCloudflarePublicDataEnabled_: () => true,
    sanitizeSeasonEventText_: (value) => String(value ?? "").trim(),
    normalizeSeasonEventType_: (value) => String(value ?? "").trim(),
    sanitizeDonationCycleKey_: (value) => String(value ?? "").trim(),
    normalizeCloudflareDataScope_: (value) => String(value || "public"),
    normalizeCloudflareDataObjectPath_: (value) => String(value || "").replace(/^\/+|\/+$/g, ""),
    makeCloudflareDataObject_: (path, payload, scope = "public") => ({ path, payload, scope }),
    encodeFirebaseObjectKeysRecursive_: (value) => value,
    decodeFirebaseObjectKeysRecursive_: (value) => value,
    buildFirebaseChildPath_: (...parts) => parts.filter(Boolean).join("/"),
    encodeFirebaseObjectKey_: (value) => String(value),
    errorMessage_: (err) => String(err?.message || err),
    getTriggerUniqueId_: () => "trigger",
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
};

const loadQueueTriggerHarness = () => {
  const queue = loadQueue();
  const properties = new Map([['MODE', 'queued-v2']]);
  let triggerSequence = 0;
  let createDelays = [];
  const triggers = [];
  const makeTrigger = (id) => ({
    id,
    getHandlerFunction: () => 'cloudflarePublishWorkerTick',
  });
  queue.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: key => properties.has(key) ? properties.get(key) : null,
      setProperty: (key, value) => properties.set(key, String(value)),
      deleteProperty: key => properties.delete(key),
    }),
  };
  queue.getTriggerUniqueId_ = trigger => trigger && trigger.id;
  queue.ScriptApp = {
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: trigger => {
      const index = triggers.indexOf(trigger);
      if (index >= 0) triggers.splice(index, 1);
    },
    newTrigger: () => ({
      timeBased: () => ({
        after: delay => ({
          create: () => {
            createDelays.push(delay);
            const trigger = makeTrigger(`trigger-${++triggerSequence}`);
            triggers.push(trigger);
            return trigger;
          },
        }),
      }),
    }),
  };
  queue.readCloudflarePublishQueueState_ = () => queue.__state;
  queue.__state = queue.createEmptyCloudflarePublishQueueState_();
  queue.__triggers = triggers;
  queue.__properties = properties;
  queue.__createDelays = createDelays;
  return queue;
};

test("dirty revision completion cannot clear a newer mutation", () => {
  const q = loadQueue();
  const state = q.createEmptyCloudflarePublishQueueState_();
  state.dirty.events.event1 = { revision: 12, updatedAt: new Date().toISOString() };
  const work = { category: "event", key: "event1", revision: 12 };
  state.dirty.events.event1 = { revision: 13, updatedAt: new Date().toISOString() };

  q.clearCloudflareDirtyWorkIfRevisionMatches_(state, work);

  assert.equal(state.dirty.events.event1.revision, 13);
});

test("season-only bootstrap explicitly advertises the Cloudflare committed active version", () => {
  const q = loadQueue();
  const state = q.createEmptyCloudflarePublishQueueState_();
  state.active.targetVersionId = "version-B";
  state.active.committedVersionId = "version-A";
  let override = "";
  q.buildCloudflarePublicBootstrapObject_ = (options) => {
    override = options.activeVersionIdOverride;
    return { path: "bootstrap/current", payload: { activeVersionId: override } };
  };

  const result = q.buildCloudflareQueuedBootstrapCommit_(state);

  assert.equal(override, "version-A");
  assert.equal(result.payload.activeVersionId, "version-A");
});

test("a superseded active worker cannot advance or commit the newer target", () => {
  const q = loadQueue();
  let persisted = q.createEmptyCloudflarePublishQueueState_();
  persisted.active = {
    targetVersionId: "version-B",
    targetGeneration: 4,
    phase: "ordinary",
    cursor: 0,
    committedVersionId: "version-A",
    updatedAt: "",
  };
  q.buildCloudflareQueuedActivePlan_ = () => ({
    targetVersionId: "version-B",
    generation: 4,
    batches: [[{ path: "activeVersions/version-B/manifest", scope: "public", payload: {} }]],
    commits: [{ path: "bootstrap/current", scope: "public", payload: {} }],
  });
  q.sendCloudflareQueuedV2Request_ = () => {
    persisted.active.targetVersionId = "version-C";
    persisted.active.targetGeneration = 5;
    persisted.active.cursor = 0;
    return { response: { ok: true } };
  };
  q.mutateCloudflarePublishQueueState_ = (callback) => callback(persisted);

  q.processCloudflareActiveQueueRequest_(clone(persisted));

  assert.equal(persisted.active.targetVersionId, "version-C");
  assert.equal(persisted.active.targetGeneration, 5);
  assert.equal(persisted.active.cursor, 0);
  assert.equal(persisted.active.committedVersionId, "version-A");
});

test("failed active ordinary batch leaves cursor and mutable pointers unchanged", () => {
  const q = loadQueue();
  const state = q.createEmptyCloudflarePublishQueueState_();
  state.active = {
    targetVersionId: "version-B",
    targetGeneration: 2,
    phase: "ordinary",
    cursor: 0,
    committedVersionId: "version-A",
    updatedAt: "",
  };
  let mutationCalls = 0;
  q.buildCloudflareQueuedActivePlan_ = () => ({
    targetVersionId: "version-B",
    generation: 2,
    batches: [[{ path: "activeVersions/version-B/manifest", scope: "public", payload: {} }]],
    commits: [{ path: "activePublished/currentVersionId", scope: "public", payload: "version-B" }],
  });
  q.sendCloudflareQueuedV2Request_ = () => { throw new Error("Cloudflare unavailable"); };
  q.mutateCloudflarePublishQueueState_ = () => { mutationCalls += 1; };

  assert.throws(() => q.processCloudflareActiveQueueRequest_(state), /Cloudflare unavailable/);
  assert.equal(mutationCalls, 0);
  assert.equal(state.active.cursor, 0);
  assert.equal(state.active.committedVersionId, "version-A");
});

test("relevant-season enqueue records only a bounded generic marker", () => {
  const q = loadQueue();
  const currentEvent = { eventId: "current-event", type: "donation", seasonId: "season-current" };
  const previousEvent = { eventId: "previous-event", type: "donation", seasonId: "season-previous" };
  q.buildCloudflareCurrentSeasonEventsBundle_ = () => ({
    current: { donation: { eventId: currentEvent.eventId } },
    seasonState: { seasonId: "season-current" },
    byId: { [currentEvent.eventId]: currentEvent },
  });
  q.attachCloudflarePreviousSeasonBundle_ = (bundle) => ({
    ...bundle,
    previous: {
      current: { donation: { eventId: previousEvent.eventId } },
      seasonState: { seasonId: "season-previous" },
      byId: { [previousEvent.eventId]: previousEvent },
    },
  });
  q.collectCloudflareSeasonEventIdsFromPointerMap_ = (pointers, out) => {
    for (const value of Object.values(pointers || {})) if (value?.eventId) out[value.eventId] = true;
  };
  q.collectCloudflareDonationRefreshSeasonIdsFromBundle_ = () => ["season-current", "season-previous"];
  q.listFirebaseChildKeys_ = () => { throw new Error("historical enumeration must not occur"); };
  let stored = q.createEmptyCloudflarePublishQueueState_();
  q.mutateCloudflarePublishQueueState_ = (callback) => callback(stored);
  q.scheduleCloudflarePublishWorker_ = () => ({ scheduled: true });

  const result = q.enqueueCloudflareRelevantSeasonPublication_("test");

  assert.equal(result.ok, true);
  assert.equal(stored.dirty.relevantSnapshot.category, "relevantSnapshot");
  assert.deepEqual(Object.keys(stored.dirty.events), []);
  assert.deepEqual(Object.keys(stored.dirty.donationSeasons), []);
});

test("queued request uses explicit short timeout and rejects oversized payloads", () => {
  const q = loadQueue();
  let requestOptions = null;
  q.getCloudflarePublicDataPublishV2Endpoint_ = () => "https://worker.test/api/internal/public-data/publish-v2";
  q.getCloudflarePublicDataPublishSecret_ = () => "secret";
  const state = q.createEmptyCloudflarePublishQueueState_();
  q.mutateCloudflarePublishQueueState_ = (callback) => callback(state);
  q.UrlFetchApp = {
    fetch(_url, options) {
      requestOptions = options;
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true }) };
    },
  };

  q.sendCloudflareQueuedV2Request_({ batchId: "small", objects: [], deletes: [], commits: [] }, "test");
  assert.equal(requestOptions.timeoutSeconds, 20);
  const firstPayload = JSON.parse(requestOptions.payload);
  assert.equal(firstPayload.dispatchGuard.batchId, "small");
  assert.ok(firstPayload.dispatchGuard.generation > 0);

  q.sendCloudflareQueuedV2Request_({ batchId: "newer", objects: [], deletes: [], commits: [] }, "test");
  const secondPayload = JSON.parse(requestOptions.payload);
  assert.ok(secondPayload.dispatchGuard.generation > firstPayload.dispatchGuard.generation);

  const tooMany = Array.from({ length: 25 }, (_, index) => ({ path: `x/${index}`, scope: "public", payload: {} }));
  assert.throws(
    () => q.assertCloudflareQueuedRequestBounds_({ objects: tooMany, deletes: [], commits: [] }),
    /object-count limit/,
  );
});

test("repeated event mutations coalesce into one newest dirty revision", () => {
  const q = loadQueue();
  const state = q.createEmptyCloudflarePublishQueueState_();
  q.mutateCloudflarePublishQueueState_ = (callback) => callback(state);
  q.scheduleCloudflarePublishWorker_ = () => ({ scheduled: true });

  const first = q.enqueueCloudflareSeasonEventPublication_("event-1", "signup-1");
  const second = q.enqueueCloudflareSeasonEventPublication_("event-1", "signup-2");

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(Object.keys(state.dirty.events), ["event-1"]);
  assert.ok(state.dirty.events["event-1"].revision > first.revision);
  assert.equal(state.dirty.events["event-1"].revision, second.revision);
});

test("active commit request is fenced and writes bootstrap last", () => {
  const q = loadQueue();
  const state = q.createEmptyCloudflarePublishQueueState_();
  state.active = {
    targetVersionId: "version-B",
    targetGeneration: 7,
    phase: "commit",
    cursor: 1,
    committedVersionId: "version-A",
    updatedAt: "",
  };
  let sentRequest = null;
  q.buildCloudflareQueuedActivePlan_ = () => ({
    targetVersionId: "version-B",
    generation: 7,
    bootstrapRevision: 0,
    batches: [[{ path: "activeVersions/version-B/manifest", scope: "public", payload: {} }]],
    commits: [
      { path: "active", scope: "bot", payload: { activeVersionId: "version-B" } },
      { path: "activePublished/currentVersionId", scope: "public", payload: "version-B" },
      { path: "bootstrap/current", scope: "public", payload: { activeVersionId: "version-B" } },
    ],
  });
  q.sendCloudflareQueuedV2Request_ = (request) => {
    sentRequest = clone(request);
    return { response: { ok: true } };
  };
  q.mutateCloudflarePublishQueueState_ = (callback) => callback(state);

  q.processCloudflareActiveQueueRequest_(clone(state));

  assert.deepEqual(sentRequest.commitGuard, {
    kind: "active",
    generation: 7,
    targetVersionId: "version-B",
  });
  assert.equal(sentRequest.commits.at(-1).path, "bootstrap/current");
  assert.equal(state.active.committedVersionId, "version-B");
});

test("large active commit objects are split into resumable ordered batches", () => {
  const q = loadQueue();
  const state = q.createEmptyCloudflarePublishQueueState_();
  state.active = {
    targetVersionId: "version-B",
    targetGeneration: 8,
    phase: "commit",
    cursor: 0,
    committedVersionId: "version-A",
    updatedAt: "",
  };
  const batches = [
    [{ path: "active", scope: "bot", payload: { activeVersionId: "version-B" } }],
    [{ path: "activePublished/currentManifest", scope: "public", payload: { versionId: "version-B" } }],
    [{ path: "bootstrap/current", scope: "public", payload: { activeVersionId: "version-B" } }],
  ];
  const sent = [];
  q.buildCloudflareQueuedActivePlan_ = () => ({
    targetVersionId: "version-B",
    generation: 8,
    bootstrapRevision: 0,
    batches: [],
    commits: batches.flat(),
    commitBatches: batches,
  });
  q.sendCloudflareQueuedV2Request_ = (request) => {
    sent.push(clone(request));
    return { response: { ok: true } };
  };
  q.mutateCloudflarePublishQueueState_ = (callback) => callback(state);

  q.processCloudflareActiveQueueRequest_(clone(state));
  q.processCloudflareActiveQueueRequest_(clone(state));
  q.processCloudflareActiveQueueRequest_(clone(state));

  assert.deepEqual(sent.map((request) => request.commits.map((item) => item.path)), [
    ["active"],
    ["activePublished/currentManifest"],
    ["bootstrap/current"],
  ]);
  assert.equal(state.active.phase, "idle");
  assert.equal(state.active.committedVersionId, "version-B");
});

test("worker outage preserves pending state, records backoff, and releases its independent lease", () => {
  const q = loadQueue();
  const state = q.createEmptyCloudflarePublishQueueState_();
  state.active = {
    targetVersionId: "version-B",
    targetGeneration: 2,
    phase: "ordinary",
    cursor: 0,
    committedVersionId: "version-A",
    updatedAt: new Date().toISOString(),
  };
  let released = false;
  let scheduled = 0;
  q.tryAcquireCloudflarePublishQueueLease_ = () => ({ token: "lease-1" });
  q.renewCloudflarePublishQueueLease_ = () => true;
  q.assertCloudflarePublishQueueLeaseOwned_ = () => true;
  q.releaseCloudflarePublishQueueLease_ = () => { released = true; return true; };
  q.readCloudflarePublishQueueState_ = () => clone(state);
  q.buildCloudflareQueuedActivePlan_ = () => ({
    targetVersionId: "version-B",
    generation: 2,
    batches: [[{ path: "activeVersions/version-B/manifest", scope: "public", payload: {} }]],
    commits: [],
  });
  q.processCloudflareActiveQueueRequest_ = () => { throw new Error("simulated Cloudflare timeout"); };
  q.recordCloudflareQueueFailure_ = (message) => {
    state.retry.attempt += 1;
    state.retry.lastError = message;
    state.retry.nextAttemptAt = new Date(Date.now() + 60000).toISOString();
    return { attempt: state.retry.attempt, nextAttemptAt: state.retry.nextAttemptAt };
  };
  q.scheduleCloudflarePublishWorker_ = () => { scheduled += 1; return { scheduled: true }; };

  const result = q.cloudflarePublishWorkerTick();

  assert.equal(result.ok, false);
  assert.equal(result.pending, true);
  assert.equal(state.active.targetVersionId, "version-B");
  assert.equal(state.active.committedVersionId, "version-A");
  assert.equal(state.active.cursor, 0);
  assert.equal(state.retry.attempt, 1);
  assert.match(state.retry.lastError, /Cloudflare timeout/);
  assert.equal(released, true);
  assert.ok(scheduled >= 1);
});

test("a plan that outlives an expired lease leaves a watchdog and completes on the successor", () => {
  const q = loadQueueTriggerHarness();
  q.CLOUDFLARE_PUBLISH_QUEUE_LOCK_LEASE_MS = 120000;
  let now = 0;
  let firstPlan = true;
  const BaseDate = Date;
  class AdversarialDate extends BaseDate {
    constructor(...args) {
      super(args.length ? args[0] : now);
    }

    static now() {
      return now;
    }
  }
  q.Date = AdversarialDate;
  q.__state.active = {
    targetVersionId: "version-B",
    targetGeneration: 2,
    phase: "ordinary",
    cursor: 0,
    committedVersionId: "version-A",
    updatedAt: "",
  };
  q.readCloudflarePublishQueueState_ = () => q.__state;
  q.mutateCloudflarePublishQueueState_ = callback => callback(q.__state);
  q.buildCloudflareQueuedActivePlan_ = () => {
    if (firstPlan) {
      firstPlan = false;
      now = 180000;
    }
    return {
      targetVersionId: "version-B",
      generation: 2,
      batches: [[{ path: "activeVersions/version-B/manifest", scope: "public", payload: {} }]],
      commits: [{ path: "bootstrap/current", scope: "public", payload: {} }],
    };
  };
  q.sendCloudflareQueuedV2Request_ = () => ({ response: { ok: true } });

  const first = q.cloudflarePublishWorkerTick();

  assert.equal(first.ok, false);
  assert.equal(first.reason, "lease-lost");
  assert.equal(q.hasPendingCloudflarePublishWork_(q.__state), true);
  assert.equal(q.__triggers.length, 1);
  assert.ok(Number(q.__properties.get("TRIGGER_AT")) > now);

  const successor = q.cloudflarePublishWorkerTick();

  assert.equal(successor.ok, true);
  assert.equal(successor.pending, false);
  assert.equal(q.hasPendingCloudflarePublishWork_(q.__state), false);
  assert.equal(q.__triggers.length, 0);
});

test("a busy lease still schedules a future watchdog for pending work", () => {
  const q = loadQueueTriggerHarness();
  q.__state.dirty.bootstrap = { revision: 1, updatedAt: new Date().toISOString() };
  q.tryAcquireCloudflarePublishQueueLease_ = () => null;

  const result = q.cloudflarePublishWorkerTick();

  assert.equal(result.reason, "lease-busy");
  assert.equal(result.watchdog.scheduled, true);
  assert.equal(q.__triggers.length, 1);
  assert.ok(Number(q.__properties.get("TRIGGER_AT")) > Date.now());
});

test("new active targets use a wall-clock generation that survives queue-state recreation", () => {
  const q = loadQueue();
  const state = q.createEmptyCloudflarePublishQueueState_();
  q.mutateCloudflarePublishQueueState_ = (callback) => callback(state);
  q.scheduleCloudflarePublishWorker_ = () => ({ scheduled: true });
  const before = Date.now();

  const result = q.enqueueCloudflareActiveTarget_("version-reset-safe", "test");

  assert.equal(result.ok, true);
  assert.ok(result.generation >= before);
  assert.equal(state.active.targetGeneration, result.generation);
});

test("event, aggregate, donation, pointer, and bootstrap work produce one final bootstrap commit", () => {
  const q = loadQueue();
  const state = q.createEmptyCloudflarePublishQueueState_();
  state.dirty.events.event1 = { revision: 1 };
  state.dirty.cwlAggregates.event1 = { live: { revision: 2 } };
  state.dirty.donationSeasons.season1 = { revision: 3 };
  state.dirty.seasonPointers = { revision: 4 };
  state.dirty.bootstrap = { revision: 5 };
  const sent = [];
  q.mutateCloudflarePublishQueueState_ = callback => callback(state);
  q.buildCloudflareDirtyRequest_ = (_state, work) => work.category === "bootstrap"
    ? { objects: [], deletes: [], commits: [{ path: "bootstrap/current", payload: {} }] }
    : { objects: [{ path: `${work.category}/${work.key || work.kind || "current"}`, payload: {} }], deletes: [], commits: [] };
  q.sendCloudflareQueuedV2Request_ = request => {
    sent.push(clone(request));
    return { response: { ok: true } };
  };

  for (let i = 0; i < 5; i++) q.processCloudflareDirtyQueueRequest_(state);

  assert.deepEqual(sent.map(request => request.objects.map(item => item.path).concat(request.commits.map(item => item.path))), [
    ["event/event1"],
    ["cwlAggregate/event1"],
    ["donationSeason/season1"],
    ["seasonPointers/current"],
    ["bootstrap/current"],
  ]);
  assert.equal(sent.filter(request => request.commits.some(item => item.path === "bootstrap/current")).length, 1);
});

test("a newer bootstrap revision survives an older in-flight request", () => {
  const q = loadQueue();
  const state = q.createEmptyCloudflarePublishQueueState_();
  state.dirty.bootstrap = { revision: 10 };
  const oldWork = { category: "bootstrap", revision: 10 };
  state.dirty.bootstrap = { revision: 11 };

  q.clearCloudflareDirtyWorkIfRevisionMatches_(state, oldWork);

  assert.equal(state.dirty.bootstrap.revision, 11);
});

test("relevant reconstruction batches referenced objects before pointers and bootstrap", () => {
  const q = loadQueue();
  const state = q.createEmptyCloudflarePublishQueueState_();
  q.buildCloudflareRelevantSeasonPointerCommits_ = () => ({
    commits: [{ path: "events/seasonEvents/current", payload: { push: { eventId: "event-current" } } }],
    deletes: [],
  });
  q.buildCloudflareCurrentSeasonEventsBundle_ = () => ({
    current: { push: { eventId: "event-current" }, donation: { eventId: "donation-current" } },
    seasonState: { seasonId: "season-current" },
    byId: {
      "event-current": { eventId: "event-current", type: "push" },
      "donation-current": { eventId: "donation-current", type: "donation", seasonId: "season-current" },
    },
    cwlAggregatesByEventId: {},
  });
  q.attachCloudflarePreviousSeasonBundle_ = bundle => bundle;
  q.collectCloudflareDonationRefreshSeasonIdsFromBundle_ = () => ["season-current"];
  q.readDecodedCloudflareFirebaseObject_ = path => path === "donationRefresh/bySeason/season-current"
    ? { seasonId: "season-current", byTag: {} }
    : path === "donationRefresh/current" ? { seasonId: "season-current" } : null;
  q.buildCloudflareQueuedBootstrapCommit_ = () => ({ path: "bootstrap/current", payload: { activeVersionId: "version-A" } });

  const plan = q.buildCloudflareRelevantSnapshotPlan_(state);
  const ordinaryPaths = plan.ordinaryBatches.flat().map(item => item.path);
  const commitPaths = plan.commitBatches.flat().map(item => item.path);

  assert.ok(ordinaryPaths.some(path => path.includes("events/seasonEvents/byId/event-current")));
  assert.ok(ordinaryPaths.some(path => path.includes("donationRefresh/bySeason/season-current")));
  assert.ok(commitPaths.includes("events/seasonEvents/current"));
  assert.ok(commitPaths.includes("donationRefresh/current"));
  assert.equal(commitPaths.includes("bootstrap/current"), false);
  assert.equal(q.buildCloudflareDirtyRequest_(state, { category: "bootstrap", revision: 1 }).commits.map(item => item.path).join(","), "bootstrap/current");
});

test("relevant snapshot deletes are sent once before ordered commits", () => {
  const q = loadQueue();
  const state = q.createEmptyCloudflarePublishQueueState_();
  state.dirty.relevantSnapshot = { revision: 3, phase: "ordinary", cursor: 0 };
  const sent = [];
  q.mutateCloudflarePublishQueueState_ = callback => callback(state);
  q.sendCloudflareQueuedV2Request_ = request => {
    sent.push(clone(request));
    return { response: { ok: true } };
  };

  q.processCloudflareDirtyQueueRequest_(state, "", {
    revision: 3,
    ordinaryBatches: [[{ path: "events/seasonEvents/byId/live", scope: "public", payload: {} }]],
    commitBatches: [[{ path: "events/seasonEvents/current", scope: "public", payload: {} }]],
    deletes: [{ path: "events/seasonEvents/byId/old", scope: "public" }],
  });
  q.processCloudflareDirtyQueueRequest_(state, "", {
    revision: 3,
    ordinaryBatches: [[{ path: "events/seasonEvents/byId/live", scope: "public", payload: {} }]],
    commitBatches: [[{ path: "events/seasonEvents/current", scope: "public", payload: {} }]],
    deletes: [{ path: "events/seasonEvents/byId/old", scope: "public" }],
  });

  assert.deepEqual(sent.map(request => ({ deletes: request.deletes, commits: request.commits.map(item => item.path) })), [
    { deletes: [{ path: "events/seasonEvents/byId/old", scope: "public" }], commits: [] },
    { deletes: [], commits: ["events/seasonEvents/current"] },
  ]);
});

test("queue initialization marks reconstruction, pointers, signups, and bootstrap in one state mutation", () => {
  const q = loadQueue();
  const state = q.createEmptyCloudflarePublishQueueState_();
  let mutationCalls = 0;
  q.readPublishedActiveVersionId_ = () => "version-A";
  q.verifyCloudflarePublicActiveVersionId_ = () => ({ ok: true, actualVersionId: "version-A" });
  q.mutateCloudflarePublishQueueState_ = callback => {
    mutationCalls++;
    return callback(state);
  };
  q.scheduleCloudflarePublishWorker_ = () => ({ scheduled: true });
  q.getCloudflarePublishQueueDiagnostics_ = () => ({ pending: true });

  const result = q.initializeCloudflarePublishQueue_({});

  assert.equal(result.ok, true);
  assert.equal(mutationCalls, 1);
  assert.ok(state.dirty.relevantSnapshot);
  assert.ok(state.dirty.cwlLeagueSignups);
  assert.ok(state.dirty.bootstrap);
});

test("queue diagnostics includes relevant snapshot age when it is the oldest pending work", () => {
  const q = loadQueue();
  const state = q.createEmptyCloudflarePublishQueueState_();
  state.dirty.relevantSnapshot = { revision: 9, updatedAt: "2026-07-01T00:00:00.000Z" };
  q.readCloudflarePublishQueueState_ = () => state;
  q.readPublishedActiveVersionId_ = () => "version-A";

  const diagnostics = q.getCloudflarePublishQueueDiagnostics_();

  assert.equal(diagnostics.oldestPendingAt, "2026-07-01T00:00:00.000Z");
  assert.equal(diagnostics.pendingDirtyCounts.relevantSnapshot, 1);
});

test("a stale lease owner cannot record success, failure, backoff, or pause state", () => {
  const q = loadQueue();
  let lockState = JSON.stringify({ token: "worker-B", owner: "B", expiresAt: Date.now() + 60_000 });
  let callbackCalls = 0;
  q.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: key => key === "LOCK" ? lockState : null,
      setProperty: () => {},
      deleteProperty: () => {},
    }),
  };
  q.mutateCloudflarePublishQueueState_ = (callback, ownerToken) => {
    q.assertCloudflarePublishQueueLeaseOwned_(ownerToken);
    callbackCalls++;
    return callback(q.createEmptyCloudflarePublishQueueState_());
  };

  assert.throws(() => q.recordCloudflareQueueFailure_("failure", {}, "worker-A"), /lease ownership was lost/);
  assert.throws(() => q.mutateCloudflarePublishQueueState_(state => { state.retry.attempt = 9; }, "worker-A"), /lease ownership was lost/);
  assert.throws(() => q.mutateCloudflarePublishQueueState_(state => { state.retry.nextAttemptAt = new Date().toISOString(); }, "worker-A"), /lease ownership was lost/);
  assert.throws(() => q.mutateCloudflarePublishQueueState_(state => { state.paused = true; }, "worker-A"), /lease ownership was lost/);
  assert.equal(callbackCalls, 0);
});

test("worker A cannot update success or failure after worker B acquires the lease", () => {
  const q = loadQueue();
  const state = q.createEmptyCloudflarePublishQueueState_();
  state.active = {
    targetVersionId: "version-B",
    targetGeneration: 2,
    phase: "ordinary",
    cursor: 0,
    committedVersionId: "version-A",
    updatedAt: "",
  };
  let currentToken = "worker-A";
  q.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: key => key === "LOCK" ? JSON.stringify({ token: currentToken, expiresAt: Date.now() + 60_000 }) : null,
      setProperty: () => {},
      deleteProperty: () => {},
    }),
  };
  q.buildCloudflareQueuedActivePlan_ = () => ({
    targetVersionId: "version-B",
    generation: 2,
    batches: [[{ path: "activeVersions/version-B/manifest", payload: {} }]],
    commits: [],
  });
  q.sendCloudflareQueuedV2Request_ = () => {
    currentToken = "worker-B";
    return { response: { ok: true } };
  };
  q.mutateCloudflarePublishQueueState_ = (callback, ownerToken) => {
    q.assertCloudflarePublishQueueLeaseOwned_(ownerToken);
    return callback(state);
  };

  assert.throws(() => q.processCloudflareActiveQueueRequest_(state, "worker-A"), /lease ownership was lost/);
  assert.equal(state.active.cursor, 0);
  assert.throws(() => q.recordCloudflareQueueFailure_("late failure", {}, "worker-A"), /lease ownership was lost/);
  assert.equal(state.retry.attempt, 0);
});

test("concurrent enqueue scheduling keeps one effective trigger and honors long backoff", () => {
  const q = loadQueueTriggerHarness();
  q.__state.dirty.bootstrap = { revision: 1, updatedAt: new Date().toISOString() };
  q.__state.retry.nextAttemptAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  const earlyTrigger = {
    id: "early-trigger",
    getHandlerFunction: () => "cloudflarePublishWorkerTick",
  };
  q.__triggers.push(earlyTrigger);
  q.__properties.set("TRIGGER", earlyTrigger.id);
  q.__properties.set("TRIGGER_AT", String(Date.now() + 60 * 1000));

  q.scheduleCloudflarePublishWorker_();
  q.scheduleCloudflarePublishWorker_();

  assert.equal(q.__triggers.length, 1);
  assert.equal(q.__createDelays.length, 1);
  assert.ok(q.__createDelays[0] > 2 * 60 * 60 * 1000);
  assert.equal(q.__properties.get("TRIGGER"), q.__triggers[0].id);
});

test("donation-current creation and deletion are mirrored by queued donation work", () => {
  const q = loadQueue();
  const state = q.createEmptyCloudflarePublishQueueState_();
  q.readDecodedCloudflareFirebaseObject_ = path => {
    if (path === "donationRefresh/bySeason/season-1") return { seasonId: "season-1", byTag: {} };
    if (path === "donationRefresh/current") return q.__currentDonation;
    return null;
  };
  const work = { category: "donationSeason", key: "season-1", revision: 1 };
  q.__currentDonation = { seasonId: "season-1", updatedAt: "2026-07-10T00:00:00.000Z" };
  const created = q.buildCloudflareDirtyRequest_(state, work);
  assert.equal(created.commits.map(item => item.path).join(","), "donationRefresh/current,donationRefresh/current");
  assert.equal(created.commits.every(item => item.delete !== true), true);

  q.__currentDonation = null;
  const deleted = q.buildCloudflareDirtyRequest_(state, work);
  assert.equal(deleted.commits.length, 2);
  assert.equal(deleted.commits.every(item => item.delete === true), true);
});
