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
    CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY: "LOCK",
    CLOUDFLARE_PUBLISH_QUEUE_LOCK_LEASE_MS: 120000,
    CLOUDFLARE_PUBLISH_QUEUE_LOCK_POLL_MS: 1,
    CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_DELAY_MS: 60000,
    CLOUDFLARE_PUBLISH_QUEUE_EXECUTION_BUDGET_MS: 240000,
    CLOUDFLARE_PUBLISH_QUEUE_REQUEST_TIMEOUT_SECONDS: 20,
    CLOUDFLARE_PUBLISH_QUEUE_MAX_REQUESTS_PER_TICK: 2,
    CLOUDFLARE_PUBLISH_QUEUE_MAX_OBJECTS_PER_REQUEST: 24,
    CLOUDFLARE_PUBLISH_QUEUE_MAX_PAYLOAD_BYTES: 4 * 1024 * 1024,
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
    normalizeActiveVersionId_: (value) => String(value ?? "").trim(),
    toNonNegativeInt_: (value) => Math.max(0, Math.floor(Number(value) || 0)),
    parseIsoToMs_: (value) => Date.parse(value) || 0,
    getOptionalScriptProperty_: () => "queued-v2",
    isCloudflarePublicDataEnabled_: () => true,
    sanitizeSeasonEventText_: (value) => String(value ?? "").trim(),
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
