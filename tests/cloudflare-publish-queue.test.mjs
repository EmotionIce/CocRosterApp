import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const repoRoot = new URL("../", import.meta.url);
const clone = (value) => JSON.parse(JSON.stringify(value));

const loadRealFirebaseCodec = () => {
  const source = fs.readFileSync(new URL("script/firebaseStore.js", repoRoot), "utf8");
  const blob = (value) => {
    const bytes = Array.isArray(value) || value instanceof Uint8Array ? Buffer.from(value) : Buffer.from(String(value ?? ""), "utf8");
    return {
      getBytes: () => Array.from(bytes),
      getDataAsString: () => bytes.toString("utf8"),
    };
  };
  const context = {
    FIREBASE_KEY_ENCODING_PREFIX: "__FB64__",
    Utilities: {
      newBlob: blob,
      base64EncodeWebSafe: (value) => Buffer.from(value).toString("base64url"),
      base64DecodeWebSafe: (value) => Array.from(Buffer.from(String(value), "base64url")),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    Logger: { log() {} },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return {
    encode: context.encodeFirebaseObjectKeysRecursive_,
    decode: context.decodeFirebaseObjectKeysRecursive_,
    isSafeVersionId: context.isSafeActiveVersionId_,
  };
};

const loadWorkerForBoundary = () => {
  const source = fs.readFileSync(new URL("cloudflarePages/worker-core.js", repoRoot), "utf8")
    .replace(/export\s+default\s+\{/, "globalThis.workerDefault = {")
    .replace(/export\s+\{\s*CloudflarePublicationCoordinator\s*\};?/, "");
  const context = { URL, Request, Response, Headers, TextEncoder, Uint8Array, crypto: webcrypto, console };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.workerDefault;
};

const loadQueue = () => {
  const source = fs.readFileSync(new URL("script/cloudflarePublishQueue.js", repoRoot), "utf8");
  let uuid = 0;
  const properties = new Map([
    ["MODE", "queued-v2"],
    ["CLOUDFLARE_PUBLIC_DATA_ENABLED", "true"],
  ]);
  const triggers = [];
  const triggerCalls = { enumerations: 0, schedules: 0, deletes: 0 };
  const context = {
    console,
    Logger: { log() {} },
    Date,
    Utilities: {
      getUuid: () => `uuid-${++uuid}`,
      sleep() {},
      newBlob: (value) => ({ getBytes: () => Array.from(Buffer.from(String(value ?? ""), "utf8")) }),
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key) => properties.has(key) ? properties.get(key) : null,
      setProperty: (key, value) => properties.set(key, String(value)),
      deleteProperty: (key) => properties.delete(key),
    }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    ScriptApp: {
      getProjectTriggers: () => { triggerCalls.enumerations += 1; return triggers.slice(); },
      deleteTrigger: (trigger) => {
        triggerCalls.deletes += 1;
        const index = triggers.indexOf(trigger);
        if (index >= 0) triggers.splice(index, 1);
      },
      newTrigger: (handler) => ({ timeBased: () => ({ after: (delay) => ({ create: () => {
        triggerCalls.schedules += 1;
        const trigger = { id: `${handler}-${triggers.length + 1}`, handler, delay, getUniqueId() { return this.id; }, getHandlerFunction() { return this.handler; } };
        triggers.push(trigger);
        return trigger;
      } }) }) }),
    },
    CLOUDFLARE_PUBLICATION_MODE_PROPERTY: "MODE",
    CLOUDFLARE_PUBLICATION_MODE_QUEUED_V2: "queued-v2",
    CLOUDFLARE_PUBLICATION_MODE_DISABLED: "disabled",
    CLOUDFLARE_PUBLICATION_MODE_LEGACY_MANUAL: "legacy-manual",
    CLOUDFLARE_PUBLISH_QUEUE_HANDLER_NAME: "cloudflarePublishWorkerTick",
    CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_ID_PROPERTY: "TRIGGER",
    CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_AT_PROPERTY: "TRIGGER_AT",
    CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY: "LOCK",
    CLOUDFLARE_PUBLISH_QUEUE_LOCK_LEASE_MS: 12 * 60 * 1000,
    CLOUDFLARE_PUBLISH_QUEUE_LOCK_POLL_MS: 1,
    CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_DELAY_MS: 1000,
    CLOUDFLARE_PUBLISH_QUEUE_EXECUTION_BUDGET_MS: 240000,
    CLOUDFLARE_PUBLISH_QUEUE_REQUEST_TIMEOUT_SECONDS: 20,
    CLOUDFLARE_PUBLISH_QUEUE_MAX_OBJECTS_PER_REQUEST: 24,
    CLOUDFLARE_PUBLISH_QUEUE_MAX_PAYLOAD_BYTES: 10 * 1024 * 1024,
    CLOUDFLARE_PUBLISH_QUEUE_HARD_OBJECT_BYTES: 8 * 1024 * 1024,
    CLOUDFLARE_PUBLISH_QUEUE_BASE_RETRY_MS: 60000,
    CLOUDFLARE_PUBLISH_QUEUE_MAX_RETRY_MS: 21600000,
    FIREBASE_INTERNAL_CLOUDFLARE_PUBLISH_STATE_PATH: "internal/cloudflarePublish/state",
    FIREBASE_ACTIVE_PUBLISHED_CURRENT_SELECTOR_PATH: "activePublished/currentSelector",
    CLOUDFLARE_PUBLIC_DATA_BOOTSTRAP_PATH: "bootstrap/current",
    SEASON_EVENTS_CURRENT_PATH: "events/seasonEvents/current",
    SEASON_EVENTS_CURRENT_CWL_PATH: "events/seasonEvents/currentCwl",
    SEASON_EVENTS_LATEST_COMPLETED_CWL_PATH: "events/seasonEvents/latestCompletedCwl",
    SEASON_EVENTS_SEASON_STATE_CURRENT_PATH: "events/seasonEvents/seasonState/current",
    SEASON_EVENTS_BY_SEASON_PATH: "events/seasonEvents/bySeason",
    SEASON_EVENTS_BY_ID_PATH: "events/seasonEvents/byId",
    FIREBASE_DONATION_REFRESH_PATH: "donationRefresh",
    CWL_LEAGUE_SIGNUPS_ACTIVE_PATH: "active/cwlLeagueSignups",
    CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_HANDLER_NAME: "cloudflarePublishWorkerRecoveryTick",
    CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_ID_PROPERTY: "RECOVERY_TRIGGER",
    CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_AT_PROPERTY: "RECOVERY_TRIGGER_AT",
    CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_DELAY_MS: 13 * 60 * 1000,
    CLOUDFLARE_PUBLISH_QUEUE_MAX_ACTIVE_ROSTERS_PER_PHASE: 24,
    CLOUDFLARE_PUBLISH_QUEUE_MAX_ACTIVE_BURST_BEFORE_DIRTY: 3,
    CLOUDFLARE_PUBLISH_QUEUE_CAS_MAX_ATTEMPTS: 3,
    normalizeActiveVersionId_: (value) => String(value ?? "").trim(),
    toNonNegativeInt_: (value) => Math.max(0, Math.floor(Number(value) || 0)),
    parseIsoToMs_: (value) => Date.parse(value) || 0,
    getOptionalScriptProperty_: (key) => properties.get(key) || "queued-v2",
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
    getTriggerUniqueId_: (trigger) => trigger && trigger.getUniqueId ? trigger.getUniqueId() : trigger && trigger.id,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  context.__properties = properties;
  context.__triggers = triggers;
  context.__triggerCalls = triggerCalls;
  return context;
};

const installCasFirebase = (queue, initialState) => {
  let state = clone(initialState || queue.createEmptyCloudflarePublishQueueState_());
  let etag = 1;
  const calls = [];
  let conflictWrites = 0;
  let alwaysConflict = false;
  queue.firebaseRequestJson_ = (path, method = "GET", payload) => {
    calls.push({ transport: "single", path, method });
    if (method === "GET") return clone(state);
    if (method === "PUT") { state = clone(payload); return clone(state); }
    throw new Error("unsupported transport");
  };
  queue.firebaseRequestJsonWithEtag_ = (path, method = "GET", payload, options = {}) => {
    calls.push({ transport: "etag", path, method, options: clone(options) });
    if (method === "GET") return { value: clone(state), etag: `etag-${etag}` };
    if (method === "PUT") {
      if (alwaysConflict || conflictWrites > 0) {
        if (conflictWrites > 0) conflictWrites -= 1;
        const error = new Error("412");
        error.code = "FIREBASE_ETAG_CONFLICT";
        throw error;
      }
      assert.equal(options.ifMatch, `etag-${etag}`);
      state = clone(payload);
      etag += 1;
      return { value: clone(state), etag: `etag-${etag}` };
    }
    throw new Error("unsupported ETag transport");
  };
  queue.__getState = () => state;
  queue.__setState = (next) => { state = clone(next); };
  queue.__calls = calls;
  queue.__setConflictWrites = (count) => { conflictWrites = count; };
  queue.__setAlwaysConflict = (value) => { alwaysConflict = value; };
  return queue;
};

const installCloudflareTransport = (queue, objectStore = new Map()) => {
  queue.getCloudflarePublicDataPublishV2Endpoint_ = () => "https://worker.test/api/internal/public-data/publish-v2";
  queue.getCloudflarePublicDataVerifyV2Endpoint_ = () => "https://worker.test/api/internal/public-data/verify-v2";
  queue.getCloudflarePublicDataPublishSecret_ = () => "secret";
  queue.sendCloudflareQueuedV2Request_ = (request) => {
    for (const item of request.objects || []) objectStore.set(`${item.scope}:${item.path}`, clone(item.payload));
    for (const item of request.commits || []) {
      if (item.delete) objectStore.delete(`${item.scope}:${item.path}`);
      else objectStore.set(`${item.scope}:${item.path}`, clone(item.payload));
    }
    return { ok: true, response: { ok: true } };
  };
  queue.verifyCloudflareActiveVersionObjects_ = (_versionId, required) => {
    const missing = required.filter((item) => !objectStore.has(`${item.scope}:${item.path}`));
    if (missing.length) throw new Error("Required Cloudflare objects are missing.");
    return { ok: true, verified: required.length };
  };
  return objectStore;
};

const activeState = (queue, phase = "public-manifest-rosters") => {
  const state = queue.createEmptyCloudflarePublishQueueState_();
  state.active = {
    targetVersionId: "version-B",
    targetGeneration: 7,
    phase,
    cursor: 0,
    committedVersionId: "version-A",
    dispatch: null,
    activeBurst: 0,
    updatedAt: "",
  };
  return state;
};

test("lease-busy performs zero external, enumeration, or scheduling work", () => {
  const q = loadQueue();
  q.__properties.set("LOCK", JSON.stringify({ token: "owner", owner: "worker", expiresAt: Date.now() + 600000 }));
  let firebaseCalls = 0;
  let cloudflareCalls = 0;
  q.firebaseRequestJson_ = () => { firebaseCalls += 1; throw new Error("must not call Firebase"); };
  q.UrlFetchApp = { fetch() { cloudflareCalls += 1; throw new Error("must not call Cloudflare"); } };
  const result = q.cloudflarePublishWorkerTick();
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "lease-busy");
  assert.equal(firebaseCalls, 0);
  assert.equal(cloudflareCalls, 0);
  assert.equal(q.__triggerCalls.enumerations, 0);
  assert.equal(q.__triggerCalls.schedules, 0);
});

test("failed active enqueue persists a durable local repair target", () => {
  const q = loadQueue();
  q.isCloudflareQueuedPublicationEnabled_ = () => true;
  q.mutateCloudflarePublishQueueState_ = () => { throw new Error("Firebase unavailable"); };

  const result = q.enqueueCloudflareActiveTarget_("version-B", "auto-refresh-finalize");
  const marker = JSON.parse(q.__properties.get("CLOUDFLARE_PUBLISH_SCHEDULER_REPAIR"));

  assert.equal(result.ok, false);
  assert.equal(result.repairPending, true);
  assert.equal(marker.activeVersionId, "version-B");
  assert.equal(marker.activeReason, "auto-refresh-finalize");
});

test("permanent watchdog merges a failed active enqueue idempotently and never restores a superseded target", () => {
  const q = installCasFirebase(loadQueue());
  q.isCloudflareQueuedPublicationEnabled_ = () => true;
  q.scheduleCloudflarePublishWorker_ = () => ({ scheduled: true });
  q.readPublishedActiveVersionId_ = () => "version-B";
  q.__properties.set("CLOUDFLARE_PUBLISH_SCHEDULER_REPAIR", JSON.stringify({ pending: true, activeVersionId: "version-B", activeReason: "auto-refresh" }));

  const repaired = q.repairCloudflarePublishSchedulingFromPermanentWatchdog_();
  const generation = q.__getState().active.targetGeneration;
  const repeated = q.repairCloudflarePublishSchedulingFromPermanentWatchdog_();

  assert.equal(repaired.ok, true);
  assert.equal(q.__getState().active.targetVersionId, "version-B");
  assert.equal(q.__getState().active.targetGeneration, generation);
  assert.equal(repeated.ok, true);

  q.__properties.set("CLOUDFLARE_PUBLISH_SCHEDULER_REPAIR", JSON.stringify({ pending: true, activeVersionId: "version-A", activeReason: "stale-auto-refresh" }));
  q.readPublishedActiveVersionId_ = () => "version-B";
  q.repairCloudflarePublishSchedulingFromPermanentWatchdog_();
  assert.equal(q.__getState().active.targetVersionId, "version-B");
});

test("permanent watchdog clears a terminal matching active repair marker without changing generation", () => {
  const q = installCasFirebase(loadQueue());
  const state = q.createEmptyCloudflarePublishQueueState_();
  state.active.targetVersionId = "version-B";
  state.active.targetGeneration = 41;
  state.active.committedVersionId = "version-B";
  state.active.phase = "idle";
  q.__setState(state);
  q.readPublishedActiveVersionId_ = () => "version-B";
  q.__properties.set("CLOUDFLARE_PUBLISH_SCHEDULER_REPAIR", JSON.stringify({ pending: true, activeVersionId: "version-B", activeReason: "terminal-test" }));

  const first = q.repairCloudflarePublishSchedulingFromPermanentWatchdog_();
  const repeated = q.repairCloudflarePublishSchedulingFromPermanentWatchdog_();

  assert.equal(first.ok, true);
  assert.equal(first.alreadyCommitted, true);
  assert.equal(first.pending, false);
  assert.equal(q.__properties.has("CLOUDFLARE_PUBLISH_SCHEDULER_REPAIR"), false);
  assert.equal(q.__getState().active.targetGeneration, 41);
  assert.equal(repeated.ok, true);
  assert.equal(q.__getState().active.targetGeneration, 41);
});

test("lifecycle descriptors dirty canonical event, exact aggregates, and pointers without payload trust", () => {
  const q = loadQueue();
  let state = q.createEmptyCloudflarePublishQueueState_();
  q.mutateCloudflarePublishQueueState_ = (callback) => callback(state);
  q.scheduleCloudflarePublishWorker_ = () => ({ scheduled: true });
  const descriptor = {
    category: "cwl-lifecycle", eventId: "cwl-1", lifecycleState: "completed",
    eventAction: "put", liveAggregateAction: "delete", finalAggregateAction: "put", pointerAction: "put",
  };
  q.enqueueCloudflareSeasonEventPublication_("cwl-1", "completion", {
    cwlLifecycle: descriptor,
    cwlLive: false,
    cwlFinal: false,
    pointers: false,
    eventPayload: { forged: true },
  });
  assert.ok(state.dirty.events["cwl-1"]);
  assert.ok(state.dirty.cwlAggregates["cwl-1"].live);
  assert.ok(state.dirty.cwlAggregates["cwl-1"].final);
  assert.ok(state.dirty.seasonPointers);
  assert.equal(JSON.stringify(state).includes("forged"), false);
});

test("lease lifetime exceeds the maximum live Apps Script execution and recovery is later", () => {
  const q = loadQueue();
  assert.ok(q.CLOUDFLARE_PUBLISH_QUEUE_LOCK_LEASE_MS > 360000);
  assert.ok(q.CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_DELAY_MS > q.CLOUDFLARE_PUBLISH_QUEUE_LOCK_LEASE_MS);
});

test("schema-v2 ordinary and commit states migrate to the first idempotent phase without changing the committed pointer", () => {
  const q = loadQueue();
  for (const phase of ["ordinary", "commit"]) {
    const migrated = q.normalizeCloudflarePublishQueueState_({
      schemaVersion: 2,
      active: { targetVersionId: "target", targetGeneration: 4, phase, cursor: 9, committedVersionId: "committed" },
      dirty: { relevantSnapshot: { revision: 3, phase: "ordinary", cursor: 4 } },
    });
    assert.equal(migrated.schemaVersion, 4);
    assert.equal(migrated.active.phase, "public-manifest-rosters");
    assert.equal(migrated.active.committedVersionId, "committed");
    assert.equal(migrated.dirty.repair.revision, 3);
  }
});

test("queue CAS retries a 412 and preserves a concurrent enqueue", () => {
  const q = installCasFirebase(loadQueue());
  const state = q.createEmptyCloudflarePublishQueueState_();
  q.__setState(state);
  q.__setConflictWrites(1);
  const result = q.mutateCloudflarePublishQueueState_((current) => {
    current.dirty.events["event-1"] = { revision: 1 };
    return { ok: true };
  });
  assert.equal(result.ok, true);
  assert.deepEqual(q.__getState().dirty.events, { "event-1": { revision: 1 } });
  assert.equal(q.__calls.filter((call) => call.method === "PUT").length, 2);
});

test("queue CAS decodes Firebase-safe keys before normalization", () => {
  const q = loadQueue();
  const codec = loadRealFirebaseCodec();
  q.encodeFirebaseObjectKeysRecursive_ = codec.encode;
  q.decodeFirebaseObjectKeysRecursive_ = codec.decode;
  const raw = q.createEmptyCloudflarePublishQueueState_();
  for (const key of ["event.one", "event#two", "event/three", "event[four]", "__FB64__literal"]) raw.dirty.events[key] = { revision: 1 };
  installCasFirebase(q, codec.encode(raw));
  q.mutateCloudflarePublishQueueState_((state) => ({ ok: true, keys: Object.keys(state.dirty.events).sort() }));
  const decoded = codec.decode(q.__getState());
  assert.deepEqual(Object.keys(decoded.dirty.events).sort(), Object.keys(raw.dirty.events).sort());
});

test("CAS exhaustion is resumable and does not discard the original queue state", () => {
  const q = installCasFirebase(loadQueue());
  const state = activeState(q);
  state.dirty.donationSeasons.season1 = { revision: 4 };
  q.__setState(state);
  q.__setAlwaysConflict(true);
  assert.throws(() => q.mutateCloudflarePublishQueueState_((current) => {
    current.dirty.events.newEvent = { revision: 5 };
  }), /compare-and-swap retries were exhausted/);
  assert.deepEqual(q.__getState().dirty.events, {});
  assert.deepEqual(q.__getState().dirty.donationSeasons, { season1: { revision: 4 } });
});

test("donation-season claim uses the selected season marker revision", () => {
  const q = installCasFirebase(loadQueue());
  const state = q.createEmptyCloudflarePublishQueueState_();
  state.dirty.donationSeasons["season-1"] = { revision: 7, category: "donationSeason" };
  q.__setState(state);
  const work = q.firstCloudflareDirtyWork_(state);
  const claim = q.allocateCloudflarePhaseClaim_(state, work);
  assert.equal(claim.stale, undefined);
  assert.equal(claim.category, "donationSeason");
  assert.equal(claim.key, "season-1");
  assert.equal(claim.revision, 7);
  assert.ok(claim.dispatchGuard);
});

test("no Firebase transport runs while ScriptLock is held", () => {
  const q = loadQueue();
  let held = false;
  const state = q.createEmptyCloudflarePublishQueueState_();
  q.LockService = { getScriptLock: () => ({
    tryLock() { held = true; return true; },
    waitLock() { held = true; },
    releaseLock() { held = false; },
  }) };
  q.firebaseRequestJsonWithEtag_ = (_path, method, payload, options) => {
    assert.equal(held, false, `${method} Firebase request ran while lock was held`);
    if (method === "GET") return { value: state, etag: "etag-1" };
    Object.assign(state, payload);
    return { value: state, etag: "etag-2" };
  };
  q.mutateCloudflarePublishQueueState_((current) => { current.dirty.events.e = { revision: 1 }; });
});

test("Firebase timeout leaves phase and cursor unchanged, applies backoff, and leaves one continuation plus recovery", () => {
  const q = installCasFirebase(loadQueue(), activeState(loadQueue()));
  q.__setState(activeState(q));
  q.readCloudflarePublishQueueState_ = () => clone(q.__getState());
  q.processCloudflareActiveQueueRequest_ = () => { throw new Error("Firebase request timed out"); };
  q.sendCloudflareQueuedV2Request_ = () => { throw new Error("must not reach Cloudflare"); };
  const result = q.cloudflarePublishWorkerTick();
  const after = q.__getState();
  assert.equal(result.ok, false);
  assert.equal(after.active.phase, "public-manifest-rosters");
  assert.equal(after.active.cursor, 0);
  assert.equal(after.infrastructure.attempt, 1);
  assert.ok(after.infrastructure.nextAttemptAt);
  assert.equal(q.__triggers.length, 2);
  assert.deepEqual(q.__triggers.map((trigger) => trigger.handler).sort(), ["cloudflarePublishWorkerRecoveryTick", "cloudflarePublishWorkerTick"]);
});

test("transport descriptors carry explicit bounded timeouts", () => {
  const q = loadQueue();
  let requestOptions;
  q.getCloudflarePublicDataPublishV2Endpoint_ = () => "https://worker.test/api/internal/public-data/publish-v2";
  q.getCloudflarePublicDataPublishSecret_ = () => "secret";
  q.allocateCloudflarePublishDispatchGuard_ = () => ({ kind: "queued-v2", generation: 1, batchId: "bounded" });
  q.UrlFetchApp = { fetch(_url, options) { requestOptions = options; return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true }) }; } };
  q.sendCloudflareQueuedV2Request_({ batchId: "bounded", objects: [{ path: "x", scope: "public", payload: {} }] });
  assert.equal(requestOptions.timeoutSeconds, 20);
});

test("trigger reconciliation reuses earlier work and replaces later or invalid metadata", () => {
  const q = loadQueue();
  const desired = Date.now() + 120000;
  const earlier = { id: "earlier", handler: "cloudflarePublishWorkerTick", getUniqueId() { return this.id; }, getHandlerFunction() { return this.handler; } };
  const duplicate = { id: "duplicate", handler: "cloudflarePublishWorkerTick", getUniqueId() { return this.id; }, getHandlerFunction() { return this.handler; } };
  q.__triggers.push(earlier, duplicate);
  q.__properties.set("TRIGGER", "earlier");
  q.__properties.set("TRIGGER_AT", String(desired - 1000));
  const reused = q.ensureCloudflareTrigger_("cloudflarePublishWorkerTick", "TRIGGER", "TRIGGER_AT", desired);
  assert.equal(reused.reused, true);
  assert.equal(q.__triggerCalls.schedules, 0);
  assert.deepEqual(q.__triggers.map((item) => item.id), ["earlier"]);

  const later = { id: "later", handler: "cloudflarePublishWorkerTick", getUniqueId() { return this.id; }, getHandlerFunction() { return this.handler; } };
  q.__triggers.push(later);
  q.__properties.set("TRIGGER", "later");
  q.__properties.set("TRIGGER_AT", String(desired + 60000));
  const replaced = q.ensureCloudflareTrigger_("cloudflarePublishWorkerTick", "TRIGGER", "TRIGGER_AT", desired);
  assert.equal(replaced.reused, false);
  assert.equal(q.__triggerCalls.schedules, 1);
  assert.equal(q.__triggers.filter((item) => item.handler === "cloudflarePublishWorkerTick").length, 1);

  const stale = q.__triggers[0];
  q.__properties.set("TRIGGER", stale.id);
  q.__properties.set("TRIGGER_AT", String(Date.now() - 60000));
  const staleReplaced = q.ensureCloudflareTrigger_("cloudflarePublishWorkerTick", "TRIGGER", "TRIGGER_AT", desired);
  assert.equal(staleReplaced.reused, true);
  assert.equal(q.__triggerCalls.schedules, 1);
  assert.equal(q.__triggers.filter((item) => item.handler === "cloudflarePublishWorkerTick").length, 1);
});

test("active public manifest/roster phase reads no metrics", () => {
  const q = loadQueue();
  const state = activeState(q, "public-manifest-rosters");
  const reads = [];
  q.buildActiveVersionPath_ = (version, child) => `activeVersions/${version}/${child}`;
  q.firebaseRequestJson_ = (path) => { reads.push(path); if (path.endsWith("/manifest")) return { versionId: "version-B", rosterIds: ["main"] }; throw new Error(`unexpected read ${path}`); };
  q.firebaseBatchGetJson_ = (paths) => { reads.push(...paths); return { [paths[0]]: { id: "main" } }; };
  q.buildCloudflareActivePhaseRequest_(state, { phase: "public-manifest-rosters", cursor: 0 });
  assert.ok(reads.includes("activeVersions/version-B/manifest"));
  assert.ok(reads.includes("activeVersions/version-B/rosters/main"));
  assert.equal(reads.some((path) => path.includes("playerMetrics")), false);
});

test("active metrics and bot-derived phases only read their required metric path", () => {
  const q = loadQueue();
  q.buildActiveVersionPath_ = (version, child) => `activeVersions/${version}/${child}`;
  const reads = [];
  q.firebaseRequestJson_ = (path) => { reads.push(path); return { byTag: { "#P": { identity: { tag: "#P", discordId: "d1" } } } }; };
  q.buildCloudflareLinkedAccountIndexes_ = () => ({ byDiscordId: { d1: [{ tag: "#P" }] }, byDiscordUsername: {} });
  q.buildCloudflareActivePhaseRequest_(activeState(q, "public-player-metrics"), { phase: "public-player-metrics", cursor: 0 });
  q.buildCloudflareActivePhaseRequest_(activeState(q, "bot-derived"), { phase: "bot-derived", cursor: 0 });
  assert.deepEqual(reads, ["activeVersions/version-B/playerMetrics", "activeVersions/version-B/playerMetrics"]);
});

test("commit phase verifies immutable objects and never rebuilds the complete snapshot", () => {
  const q = loadQueue();
  q.buildActiveVersionPath_ = (version, child) => `activeVersions/${version}/${child}`;
  q.firebaseRequestJson_ = (path) => { assert.equal(path.endsWith("/manifest"), true); return { versionId: "version-B", rosterIds: ["main"] }; };
  q.readActiveRosterSnapshotFromVersion_ = () => { throw new Error("commit must not read complete snapshot"); };
  let verified = null;
  q.verifyCloudflareActiveVersionObjects_ = (_version, required) => { verified = required; return { ok: true }; };
  q.buildCloudflarePublicBootstrapObject_ = (options) => ({ path: "bootstrap/current", payload: { schemaVersion: 2, activeVersionId: options.activeVersionIdOverride } });
  const built = q.buildCloudflareActivePhaseRequest_(activeState(q, "commit"), { phase: "commit", cursor: 0 });
  assert.equal(built.request.commits.at(-1).path, "activePublished/currentSelector");
  assert.equal(built.request.commits.filter((item) => item.path === "activePublished/currentSelector").length, 1);
  assert.equal(verified.length, 9);
  assert.equal(built.request.commits.some((item) => item.path.includes("rosters")), false);
  assert.equal(built.request.commits.some((item) => item.path.includes("playerMetrics")), false);
});

test("missing immutable objects prevent pointer commit", () => {
  const q = loadQueue();
  q.buildActiveVersionPath_ = (version, child) => `activeVersions/${version}/${child}`;
  q.firebaseRequestJson_ = () => ({ versionId: "version-B", rosterIds: ["main"] });
  q.verifyCloudflareActiveVersionObjects_ = () => { throw new Error("Required Cloudflare objects are missing."); };
  assert.throws(() => q.buildCloudflareActivePhaseRequest_(activeState(q, "commit"), { phase: "commit", cursor: 0 }), /Required Cloudflare objects are missing/);
});

test("event, donation, and pointer mutations do not dirty compact bootstrap", () => {
  const q = loadQueue();
  let state = q.createEmptyCloudflarePublishQueueState_();
  q.mutateCloudflarePublishQueueState_ = (callback) => callback(state);
  q.scheduleCloudflarePublishWorker_ = () => ({ scheduled: true });
  q.enqueueCloudflareSeasonEventPublication_("event-1", "event");
  q.enqueueCloudflareDonationSeasonPublication_("season-1", "donation");
  assert.equal(state.dirty.bootstrap, null);
  assert.ok(state.dirty.events["event-1"]);
  assert.ok(state.dirty.donationSeasons["season-1"]);
});

test("repair is cursor-based and does not enumerate Firebase history", () => {
  const q = loadQueue();
  const source = fs.readFileSync(new URL("script/cloudflarePublishQueue.js", repoRoot), "utf8");
  assert.equal(source.includes("listFirebaseChildKeys_("), false);
  const state = q.createEmptyCloudflarePublishQueueState_();
  state.dirty.repair = { revision: 1, category: "repair", step: "season", cursor: 1, updatedAt: "" };
  q.readDecodedCloudflareQueueObject_ = (path) => path.endsWith("seasonState/current") ? { seasonId: "season-1" } : { push: { eventId: "event-1" } };
  q.readSeasonEventById_ = () => ({ eventId: "event-1", type: "push" });
  q.collectCloudflareSeasonEventIdsFromPointerMap_ = (pointers, out) => { if (pointers.push) out["event-1"] = true; return out; };
  const built = q.buildCloudflareTargetedRepairRequest_({ category: "repair", revision: 1, cursor: 1 });
  assert.ok(built.objects.length > 0);
  assert.equal(built.commits.length, 0);
});

test("fairness selects dirty work after the bounded active burst", () => {
  const q = loadQueue();
  const state = activeState(q);
  state.active.activeBurst = 3;
  state.dirty.events.event1 = { revision: 1 };
  const dirty = q.firstCloudflareDirtyWork_(state);
  assert.equal(dirty.category, "event");
  assert.ok(state.active.phase !== "commit");
});

test("one permanently failed item is dead-lettered while unrelated work remains, and a newer revision supersedes it", () => {
  const q = installCasFirebase(loadQueue());
  const state = q.createEmptyCloudflarePublishQueueState_();
  state.dirty.events.bad = { revision: 1, category: "event" };
  state.dirty.events.good = { revision: 2, category: "event" };
  q.__setState(state);
  q.isCloudflareQueuedPublicationEnabled_ = () => true;
  q.scheduleCloudflarePublishWorker_ = () => ({ scheduled: true });
  const claim = { category: "event", key: "bad", kind: "", revision: 1, cursor: 0, dispatchKey: "event:bad:1" };
  const failed = q.recordCloudflareQueueFailure_("malformed publish object", { failed: { scope: "public", path: "events/bad" } }, "", claim);
  assert.equal(failed.deadLetter, true);
  assert.ok(q.__getState().dirty.events.good);
  assert.equal(q.hasPendingCloudflarePublishWork_(q.__getState()), true);

  q.enqueueCloudflareSeasonEventPublication_("bad", "new-revision");
  const next = q.__getState();
  assert.ok(next.dirty.events.bad.revision > 1);
  assert.equal(next.dirty.events.bad.failure, null);
  assert.equal(Object.values(next.deadLetters).some((dead) => dead.category === "event" && dead.key === "bad"), false);
});

test("duplicate repair enqueue merges reasons and scopes without resetting its cursor", () => {
  const q = installCasFirebase(loadQueue());
  const state = q.createEmptyCloudflarePublishQueueState_();
  state.dirty.repair = { revision: 4, category: "repair", step: "events", eventIndex: 3, seasonIndex: 2, donationIndex: 1, reasons: ["first"], scopes: ["current"] };
  q.__setState(state);
  q.isCloudflareQueuedPublicationEnabled_ = () => true;
  q.scheduleCloudflarePublishWorker_ = () => ({ scheduled: true });
  q.enqueueCloudflareRelevantSeasonPublication_("second", { scopes: ["previous", "current"] });
  const repair = q.__getState().dirty.repair;
  assert.deepEqual(repair.reasons, ["first", "second"]);
  assert.deepEqual(repair.scopes, ["current", "previous"]);
  assert.equal(repair.step, "events");
  assert.equal(repair.eventIndex, 3);
  assert.equal(repair.seasonIndex, 2);
  assert.equal(repair.donationIndex, 1);
});

test("an accepted A commit is recorded while already-queued B remains the next target", () => {
  const q = installCasFirebase(loadQueue());
  const state = activeState(q, "public-manifest-rosters");
  state.active.targetVersionId = "version-B";
  state.active.targetGeneration = 8;
  state.active.committedVersionId = "version-old";
  state.active.committedGeneration = 6;
  q.__setState(state);
  const result = q.completeCloudflareActivePhase_(
    { category: "active", targetVersionId: "version-A", generation: 7, phase: "commit", cursor: 0 },
    { response: { acceptedCommit: { targetVersionId: "version-A", generation: 7, committedAt: "2026-07-11T12:00:00.000Z" } } },
  );
  assert.equal(result.stale, true);
  assert.equal(result.acceptedCommit.targetVersionId, "version-A");
  assert.equal(q.__getState().active.committedVersionId, "version-A");
  assert.equal(q.__getState().active.targetVersionId, "version-B");
  assert.equal(q.__getState().active.phase, "public-manifest-rosters");
});

test("two consecutive active publications and an unchanged enqueue are idempotent", () => {
  const q = loadQueue();
  let state = activeState(q);
  const store = installCloudflareTransport(q);
  q.readCloudflarePublishQueueState_ = () => clone(q.__getState());
  q.mutateCloudflarePublishQueueState_ = (callback) => { const result = callback(state); return result; };
  q.buildCloudflareActivePhaseRequest_ = (current, claim) => {
    if (claim.phase === "commit") {
      q.verifyCloudflareActiveVersionObjects_ = () => ({ ok: true });
      return { label: claim.phase, request: { batchId: `active:${claim.targetVersionId}:${claim.phase}`, objects: [], commits: [{ path: "activePublished/currentVersionId", scope: "public", payload: claim.targetVersionId }] } };
    }
    const path = `activeVersions/${claim.targetVersionId}/${claim.phase}`;
    return { label: claim.phase, request: { batchId: `active:${claim.targetVersionId}:${claim.phase}`, objects: [{ path, scope: "public", payload: { versionId: claim.targetVersionId } }] } };
  };
  // Direct state progression proves the persisted phase order without
  // rereading a snapshot in the final commit.
  for (const phase of ["public-manifest-rosters", "public-player-metrics", "bot-active", "bot-derived", "commit"]) {
    state.active.phase = phase;
    const claim = { category: "active", phase, cursor: 0, targetVersionId: "version-B", generation: 7, dispatchGuard: { kind: "queued-v2", generation: phase.length + 1, batchId: `active:version-B:${phase}` } };
    const built = q.buildCloudflareActivePhaseRequest_(state, claim);
    store.set(`public:${built.request.objects?.[0]?.path || "activePublished/currentVersionId"}`, {});
    if (phase === "commit") state.active.committedVersionId = "version-B";
  }
  assert.equal(state.active.committedVersionId, "version-B");
  const before = clone(state);
  state.active.targetVersionId = "version-B";
  assert.deepEqual(state.active, before.active);
});

test("canonical active enqueue traces all five phases to public and bot pointer reads", () => {
  const q = installCasFirebase(loadQueue());
  const state = q.createEmptyCloudflarePublishQueueState_();
  state.active.committedVersionId = "version-A";
  q.__setState(state);
  q.isCloudflareQueuedPublicationEnabled_ = () => true;
  q.scheduleCloudflarePublishWorker_ = () => ({ scheduled: true });
  q.readCloudflarePublishQueueState_ = () => clone(q.__getState());
  const manifest = { versionId: "version-B", schemaVersion: 1, rosterIds: ["main"], rosterOrder: ["main"], pageTitle: "Roster" };
  const roster = { id: "main", main: [], subs: [], missing: [] };
  const metrics = { schemaVersion: 1, byTag: { "#P": { identity: { tag: "#P", discordId: "discord-1" }, latestSnapshot: { trophies: 5000 } } } };
  q.buildActiveVersionPath_ = (version, child) => `activeVersions/${version}/${child}`;
  q.firebaseRequestJson_ = (path) => {
    if (path.endsWith("/manifest")) return manifest;
    if (path.endsWith("/playerMetrics")) return metrics;
    if (path.endsWith("/rosters/main")) return roster;
    throw new Error(`unexpected Firebase read ${path}`);
  };
  q.firebaseBatchGetJson_ = (paths) => Object.fromEntries(paths.map((path) => [path, roster]));
  q.readActiveRosterSnapshotFromVersion_ = () => ({ versionId: "version-B", manifest, rosterData: { schemaVersion: 1, pageTitle: "Roster", rosterOrder: ["main"], rosters: [roster], playerMetrics: metrics } });
  q.buildCloudflareLinkedAccountIndexes_ = () => ({ byDiscordId: { "discord-1": [{ tag: "#P" }] }, byDiscordUsername: {} });
  q.buildCloudflarePublicBootstrapObject_ = (options) => ({ path: "bootstrap/current", payload: { schemaVersion: 2, activeVersionId: options.activeVersionIdOverride, active: { versionId: options.activeVersionIdOverride, manifest: options.manifestOverride } } });
  const objectStore = installCloudflareTransport(q);

  const enqueue = q.enqueueCloudflareActiveTarget_("version-B", "auto-refresh");
  assert.equal(enqueue.ok, true);
  const phases = [];
  while (q.__getState().active.phase !== "idle") {
    const before = q.__getState().active.phase;
    phases.push(before);
    q.processCloudflareActiveQueueRequest_(q.__getState());
  }
  assert.deepEqual(phases, ["public-manifest-rosters", "public-player-metrics", "bot-active", "bot-derived", "commit"]);
  assert.equal(q.__getState().active.committedVersionId, "version-B");
  assert.equal(objectStore.get("public:activePublished/currentVersionId"), "version-B");
  assert.equal(objectStore.get("bot:active/currentVersionId"), "version-B");
  assert.ok(objectStore.has("public:activeVersions/version-B/manifest"));
  assert.ok(objectStore.has("bot:activeVersions/version-B/active"));
  assert.ok(objectStore.has("bot:activeVersions/version-B/playerMetrics/byTag"));
});

test("compact bootstrap contains coordination data only", () => {
  const q = loadQueue();
  const state = q.createEmptyCloudflarePublishQueueState_();
  state.active.committedVersionId = "version-A";
  q.buildCloudflarePublicBootstrapObject_ = (options) => ({ path: "bootstrap/current", payload: { schemaVersion: 2, generatedAt: "now", activeVersionId: options.activeVersionIdOverride, active: { versionId: options.activeVersionIdOverride, manifest: options.manifestOverride || null } } });
  const result = q.buildCloudflareQueuedBootstrapCommit_(state);
  assert.equal(result.payload.activeVersionId, "version-A");
  assert.equal(Object.hasOwn(result.payload, "seasonEvents"), false);
  assert.equal(Object.hasOwn(result.payload, "donationRefresh"), false);
});

test("active fixture payload stays within repository and Worker limits", () => {
  const q = loadQueue();
  const fixture = {
    schemaVersion: 1,
    pageTitle: "Roster",
    rosterIds: ["main", "second", "third"],
    rosters: Object.fromEntries(["main", "second", "third"].map((id) => [id, { id, main: Array.from({ length: 30 }, (_, i) => ({ tag: `#${id}${i}`, name: "Player" + i })), subs: [], missing: [] }])),
    playerMetrics: { schemaVersion: 1, byTag: Object.fromEntries(Array.from({ length: 90 }, (_, i) => [`#P${i}`, { identity: { tag: `#P${i}`, name: "Player" + i }, latestSnapshot: { trophies: 5000 } }])) },
  };
  const bytes = q.cloudflareQueueJsonBytes_(fixture);
  assert.ok(bytes < 8 * 1024 * 1024);
  assert.ok(q.cloudflareQueueNormalizedEnvelopeBytes_({ batchId: "fixture", objects: [{ scope: "public", path: "activeVersions/v/active", payload: fixture }] }) < 10 * 1024 * 1024);
});

test("near-maximum active schema fixture has a comfortable normalized margin", () => {
  const q = loadQueue();
  const codec = loadRealFirebaseCodec();
  q.encodeFirebaseObjectKeysRecursive_ = codec.encode;
  const tags = Array.from({ length: 608 }, (_, index) => `#P${String(index).padStart(4, "0")}`);
  const metricFor = (tag, index) => ({
    identity: { tag, name: `Player ${index}`, discordId: `discord-${index}`, discordUsername: `player_${index}` },
    trophyHistoryDaily: Array.from({ length: 30 }, (_, day) => ({ dayKey: `2026-06-${String((day % 28) + 1).padStart(2, "0")}`, trophies: 5000 + index + day, clanTag: "#8L28LJCC" })),
    regularWar: { current: { inWar: index % 2 === 0, attacksAllowed: 2, attacksUsed: 1, starsTotal: 2, totalDestruction: 80 }, aggregate: { warsInLineup: 15, attacksMade: 20, attacksMissed: 2, starsTotal: 38, totalDestruction: 1320 } },
    cwlStats: { season: "2026-07-03", starsTotal: 18, daysInLineup: 7, attacksMade: 7, missedAttacks: 0, threeStarCount: 5, totalDestruction: 680, defenseStarsConceded: 18 },
    donationCycles: { "ranked-legend-i-2026-06-15": { seasonId: "ranked-legend-i-2026-06-15", cycleTotalDonations: 250, cycleTotalDonationsReceived: 180, lastSeenAt: "2026-07-09T20:00:00.000Z" } },
    latestSnapshot: { tag, name: `Player ${index}`, trophies: 5200 + index, donations: 250, donationsReceived: 180, clanTag: "#8L28LJCC", capturedAt: "2026-07-09T20:00:00.000Z" },
  });
  const fixture = {
    schemaVersion: 1,
    pageTitle: "TURTLE Clan Family Overview",
    rosterOrder: ["turtle-main", "purpleTurtle", "turtle-cwl-crystal-2-30v30"],
    rosters: ["turtle-main", "purpleTurtle", "turtle-cwl-crystal-2-30v30"].map((id) => ({
      id, title: id, main: tags.slice(0, 30).map((tag, index) => ({ slot: index + 1, tag, name: `Player ${index}`, th: 18 })),
      subs: tags.slice(30, 50).map((tag, index) => ({ slot: null, tag, name: `Sub ${index}`, th: 18 })),
      missing: tags.slice(50, 60).map((tag) => ({ slot: null, tag, name: "Missing", th: 18 })),
    })),
    playerMetrics: { schemaVersion: 1, byTag: Object.fromEntries(tags.map((tag, index) => [tag, metricFor(tag, index)])) },
    cwlLeagueSignups: { schemaVersion: 1, entries: tags.slice(0, 90).map((tag) => ({ tag, league: "crystal-2", selected: true })) },
  };
  const object = q.makeCloudflareQueueObject_("activeVersions/near-max/active", fixture, "bot");
  const normalized = q.normalizeCloudflareQueuePublishObjectForSize_(object, "public", "2026-07-10T00:00:00.000Z");
  const objectBytes = q.cloudflareQueueTextBytes_(normalized.payloadText);
  const envelopeBytes = q.cloudflareQueueNormalizedEnvelopeBytes_({ requestId: "near-max", batchId: "near-max", publishedAt: "2026-07-10T00:00:00.000Z", objects: [object] });
  assert.ok(objectBytes < 6 * 1024 * 1024, `near-maximum object bytes=${objectBytes}`);
  assert.ok(envelopeBytes < 7 * 1024 * 1024, `near-maximum envelope bytes=${envelopeBytes}`);
  assert.ok(q.assertCloudflareQueuedRequestBounds_({ requestId: "near-max", batchId: "near-max", publishedAt: "2026-07-10T00:00:00.000Z", objects: [object] }) === envelopeBytes);
  if (process.env.REPORT_SIZES === "1") process.stdout.write(`near-max object bytes=${objectBytes} envelope bytes=${envelopeBytes}\n`);
});

test("Apps Script size checks match Worker normalization at realistic boundaries", async () => {
  const q = loadQueue();
  const codec = loadRealFirebaseCodec();
  q.encodeFirebaseObjectKeysRecursive_ = codec.encode;
  const fixture = {
    schemaVersion: 1,
    rosters: { main: [{ tag: "#PLAYER", name: "Quote\\\\Player", notes: "\\\"quoted\\\"" }] },
    playerMetrics: { byTag: {
      "#PLAYER": { identity: { tag: "#PLAYER", linked: "a/b" }, history: Array.from({ length: 20 }, (_, index) => ({ season: index, text: "metric" })) },
      "__FB64__original": { identity: { tag: "__FB64__original" } },
    } },
  };
  const object = q.makeCloudflareQueueObject_("activeVersions/version-1/playerMetrics", fixture, "public");
  const request = { requestId: "size-test", batchId: "size-test", publishedAt: "2026-07-10T00:00:00.000Z", objects: [object], commits: [] };
  const appsBytes = q.cloudflareQueueNormalizedEnvelopeBytes_(request);
  assert.equal(q.assertCloudflareQueuedRequestBounds_(request), appsBytes);

  const worker = loadWorkerForBoundary();
  const env = { ROSTER_PUBLIC_DATA_PUBLISH_SECRET: "secret", ROSTER_DATA_KV: { async get() { return null; }, async put() {} } };
  const accepted = await worker.fetch(new Request("https://worker.test/api/internal/public-data/publish-v2", {
    method: "POST", headers: { authorization: "Bearer secret", "content-type": "application/json" },
    body: JSON.stringify(Object.assign({}, request, { dryRun: true })),
  }), env, {});
  assert.equal(accepted.status, 200);

  const tooLargeObject = { requestId: "large-object", batchId: "large-object", publishedAt: request.publishedAt, objects: [{ path: "activeVersions/v/metrics", scope: "public", payload: { text: "x".repeat(8 * 1024 * 1024) } }] };
  assert.throws(() => q.assertCloudflareQueuedRequestBounds_(tooLargeObject), /object exceeds hard limit/i);
  const rejectedObject = await worker.fetch(new Request("https://worker.test/api/internal/public-data/publish-v2", {
    method: "POST", headers: { authorization: "Bearer secret", "content-type": "application/json" },
    body: JSON.stringify(Object.assign({}, tooLargeObject, { dryRun: true })),
  }), env, {});
  assert.equal(rejectedObject.status, 413);

  const envelopeTooLarge = {
    requestId: "large-envelope", batchId: "large-envelope", publishedAt: request.publishedAt,
    objects: [
      { path: "activeVersions/v/a", scope: "public", payload: { text: "a".repeat(5.2 * 1024 * 1024) } },
      { path: "activeVersions/v/b", scope: "public", payload: { text: "b".repeat(5.2 * 1024 * 1024) } },
    ],
  };
  assert.throws(() => q.assertCloudflareQueuedRequestBounds_(envelopeTooLarge), /payload limit/i);
  const rejectedEnvelope = await worker.fetch(new Request("https://worker.test/api/internal/public-data/publish-v2", {
    method: "POST", headers: { authorization: "Bearer secret", "content-type": "application/json" },
    body: JSON.stringify(Object.assign({}, envelopeTooLarge, { dryRun: true })),
  }), env, {});
  assert.equal(rejectedEnvelope.status, 413);
});

test("every active commit operation is retryable and the shared selector remains last", async () => {
  const worker = loadWorkerForBoundary();
  const commits = [
    { path: "activePublished/currentManifest", scope: "public", payload: { versionId: "version-A" } },
    { path: "bootstrap/current", scope: "public", payload: { activeVersionId: "version-A" } },
    { path: "activePublished/currentVersionId", scope: "public", payload: "version-A" },
    { path: "active/currentVersionId", scope: "bot", payload: "version-A" },
    { path: "activePublished/currentSelector", scope: "public", payload: { currentVersionId: "version-A", generation: 11 } },
  ];
  const keyFor = (entry) => `${entry.scope === "bot" ? "bot-data" : "public-data"}/${entry.path}.json`;

  for (let failedIndex = 0; failedIndex < commits.length; failedIndex++) {
    const values = new Map();
    let rejectedKey = keyFor(commits[failedIndex]);
    const store = {
      async get(key) {
        return values.has(key) ? values.get(key) : null;
      },
      async put(key, value) {
        if (key === rejectedKey) throw new Error(`simulated commit failure ${failedIndex}`);
        values.set(key, String(value));
      },
      async delete(key) {
        values.delete(key);
      },
    };
    const env = { ROSTER_PUBLIC_DATA_PUBLISH_SECRET: "secret", ROSTER_DATA_KV: store };
    const body = {
      requestId: `commit-failure-${failedIndex}`,
      batchId: `commit-failure-${failedIndex}`,
      publishedAt: "2026-07-10T00:00:00.000Z",
      commits,
      commitGuard: { generation: 11, targetVersionId: "version-A" },
    };
    const request = () => new Request("https://worker.test/api/internal/public-data/publish-v2", {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const failed = await worker.fetch(request(), env, {});
    const failedPayload = await failed.json();
    assert.equal(failed.status, 502, `failure index ${failedIndex}`);
    assert.equal(failedPayload.completedCommitCount, failedIndex);
    assert.equal(values.has(keyFor(commits.at(-1))), false, `selector advertised at failure index ${failedIndex}`);

    rejectedKey = "";
    const retried = await worker.fetch(request(), env, {});
    const retriedPayload = await retried.json();
    assert.equal(retried.status, 200, `retry index ${failedIndex}`);
    assert.equal(retriedPayload.completedCommitCount, commits.length);
    assert.equal(JSON.parse(values.get(keyFor(commits.at(-1)))).currentVersionId, "version-A");
  }
});

test("queued v2 source has no whole-plan or history enumeration path", () => {
  const source = fs.readFileSync(new URL("script/cloudflarePublishQueue.js", repoRoot), "utf8");
  assert.equal(source.includes("buildCloudflareQueuedActivePlan_"), false);
  assert.equal(source.includes("buildCloudflareRelevantSnapshotPlan_"), false);
  assert.equal(source.includes("readActiveRosterSnapshotFromVersion_(target)"), false);
  assert.equal(source.includes("forceNext"), false);
});

test("Cloudflare queue objects encode player tags exactly once with the production codec", () => {
  const q = loadQueue();
  const codec = loadRealFirebaseCodec();
  q.encodeFirebaseObjectKeysRecursive_ = codec.encode;
  q.decodeFirebaseObjectKeysRecursive_ = codec.decode;
  const original = {
    "#PLAYER": { "a.b": 1, "x/y": 2, "[x]": 3 },
    "plain": { "__FB64__original": { "#SECOND": true } },
  };
  const queued = q.makeCloudflareQueueObject_("activeVersions/v/active", original, "bot");
  assert.deepEqual(JSON.parse(JSON.stringify(codec.decode(queued.payload))), original);
  assert.equal(Object.keys(queued.payload).includes("#PLAYER"), false);
  assert.equal(Object.keys(queued.payload).some((key) => key.startsWith("__FB64__")), true);

  const accidentallyPreEncoded = codec.encode(original);
  const doubleQueued = q.makeCloudflareQueueObject_("activeVersions/v/active", accidentallyPreEncoded, "bot");
  assert.notDeepEqual(codec.decode(doubleQueued.payload), original);
});

test("superseded active generation cannot publish or commit its selector", () => {
  const q = installCasFirebase(loadQueue());
  const state = activeState(q, "commit");
  state.active.targetVersionId = "generation-A";
  state.active.targetGeneration = 11;
  state.active.committedVersionId = "version-old";
  q.__setState(state);
  q.isCloudflareQueuedPublicationEnabled_ = () => true;
  q.scheduleCloudflarePublishWorker_ = () => ({ scheduled: true });
  q.buildCloudflareActivePhaseRequest_ = (_state, claim) => ({
    label: "commit",
    request: { batchId: `active:${claim.targetVersionId}:commit`, commits: [{ path: "activePublished/currentSelector", scope: "public", payload: { currentVersionId: claim.targetVersionId } }] },
  });
  let sends = 0;
  q.sendCloudflareQueuedV2Request_ = () => { sends += 1; return { ok: true, response: { ok: true } }; };
  let supersede = true;
  q.readCloudflarePublishQueueState_ = () => {
    if (supersede) {
      supersede = false;
      q.enqueueCloudflareActiveTarget_("generation-B", "newer-target");
    }
    return clone(q.__getState());
  };
  const first = q.processCloudflareActiveQueueRequest_(q.__getState());
  assert.equal(first.reason, "superseded");
  assert.equal(sends, 0);
  assert.equal(q.__getState().active.committedVersionId, "version-old");
  assert.equal(q.__getState().active.targetVersionId, "generation-B");
});

test("bot-object repair creates a fresh immutable full publication and is idempotent", () => {
  const q = installCasFirebase(loadQueue());
  const state = q.createEmptyCloudflarePublishQueueState_();
  state.active.committedVersionId = "known-good";
  state.dirty.events["event-1"] = { revision: 12 };
  q.__setState(state);
  q.isCloudflareQueuedPublicationEnabled_ = () => true;
  q.readCloudflarePublishQueueState_ = () => clone(q.__getState());
  q.scheduleCloudflarePublishWorker_ = () => ({ scheduled: true });
  q.readActiveRosterSnapshotFromVersion_ = (versionId) => ({ versionId, rosterData: { schemaVersion: 1, rosters: [], playerMetrics: { byTag: {} } } });
  q.createActiveVersionId_ = () => "bot-repair-fresh";
  let writeOptions;
  q.writeActiveRosterVersionShards_ = (versionId, rosterData, options) => {
    assert.equal(versionId, "bot-repair-fresh");
    assert.equal(rosterData.schemaVersion, 1);
    writeOptions = options;
    return { versionId, manifest: { versionId } };
  };
  const first = q.repairCloudflareBotVersionObjects_({ versionId: "known-good" });
  assert.equal(first.ok, true);
  assert.equal(first.idempotent, false);
  assert.equal(q.__getState().active.committedVersionId, "known-good");
  assert.equal(q.__getState().active.targetVersionId, "bot-repair-fresh");
  assert.equal(q.__getState().active.phase, "public-manifest-rosters");
  assert.equal(q.__getState().active.republish, false);
  assert.equal(writeOptions.publish, false);
  assert.ok(q.__getState().dirty.events["event-1"]);
  const second = q.repairCloudflareBotVersionObjects_({ versionId: "known-good" });
  assert.equal(second.idempotent, true);
  assert.equal(q.__getState().active.committedVersionId, "known-good");
  assert.equal(second.versionId, "bot-repair-fresh");
});

test("bounded repair resumes through every event, CWL aggregate, season map, and donation overlay", () => {
  const q = loadQueue();
  const state = q.createEmptyCloudflarePublishQueueState_();
  const eventIds = Array.from({ length: 8 }, (_, index) => `push-${index + 1}`);
  eventIds.push("cwl-current", "cwl-completed");
  state.dirty.repair = {
    revision: 9, category: "repair", step: "discover", seasonIndex: 0, eventIndex: 0, donationIndex: 0,
    seasonIds: [], eventIds: [], donationSeasonIds: [], updatedAt: "",
  };
  q.resolveLegendIRankedSeasonCycle_ = () => ({ seasonId: "season-previous" });
  q.collectCloudflareSeasonEventIdsFromPointerMap_ = (pointers, output) => {
    for (const value of Object.values(pointers || {})) if (value && value.eventId) output[value.eventId] = true;
    return output;
  };
  q.readDecodedCloudflareQueueObject_ = (path) => {
    if (path.endsWith("seasonState/current")) return { seasonId: "season-current", startsAt: "2026-07-01T00:00:00.000Z" };
    if (path.endsWith("currentCwl")) return { eventId: "cwl-current", seasonId: "season-current" };
    if (path.endsWith("latestCompletedCwl")) return { eventId: "cwl-completed", seasonId: "season-previous" };
    if (path.includes("donationRefresh/bySeason/")) return { seasonId: path.includes("season-previous") ? "season-previous" : "season-current", totals: {} };
    if (path.endsWith("donationRefresh/current")) return { seasonId: "season-current" };
    if (path.includes("bySeason/season-current")) return Object.fromEntries(eventIds.slice(0, 5).map((id) => [id, { eventId: id, seasonId: "season-current" }]));
    if (path.includes("bySeason/season-previous")) return Object.fromEntries(eventIds.slice(5, 8).map((id) => [id, { eventId: id, seasonId: "season-previous" }]));
    return { pointer: true };
  };
  q.readSeasonEventById_ = (eventId) => ({ eventId, type: eventId.startsWith("cwl-") ? "cwl" : "push", seasonId: eventId === "cwl-completed" ? "season-previous" : "season-current" });
  q.readCwlSeasonEventAggregate_ = (eventId, kind) => ({ eventId, kind, rankedTags: [] });
  q.projectCloudflareCwlAggregateForEvent_ = (_event, aggregate, kind) => Object.assign({}, aggregate, { kind });
  q.buildCwlSeasonEventAggregatePath_ = (eventId, kind) => `events/seasonEvents/cwlAggregates/byEvent/${eventId}/${kind}`;
  q.makeCloudflareQueueObject_ = (path, payload, scope) => ({ path, payload, scope });

  const repairedEvents = [];
  const repairedAggregates = [];
  const repairPhases = [];
  const pointerScopes = new Map();
  while (state.dirty.repair) {
    const work = q.firstCloudflareDirtyWork_(state);
    const built = q.buildCloudflareTargetedRepairRequest_(work);
    const advance = built.repairAdvance;
    for (const item of built.objects) {
      if (item.path.includes("/byId/")) repairedEvents.push(item.path);
      if (item.path.includes("cwlAggregates")) repairedAggregates.push(item.path);
      if (item.path.includes("/bySeason/")) repairPhases.push("season-map");
    }
    for (const item of built.commits) {
      if (item.path.includes("seasonEvents/current") || item.path.includes("seasonEvents/currentCwl") || item.path.includes("seasonEvents/latestCompletedCwl") || item.path.includes("seasonEvents/seasonState/current")) {
        const scopes = pointerScopes.get(item.path) || [];
        scopes.push(item.scope);
        pointerScopes.set(item.path, scopes);
      }
    }
    if (built.commits.length) repairPhases.push("pointers");
    const claim = Object.assign({}, work, { repairAdvance: advance });
    q.clearCloudflareDirtyWorkIfRevisionMatches_(state, claim);
  }
  assert.equal(repairedEvents.length, eventIds.length * 2);
  assert.equal(repairedAggregates.length, 8);
  assert.ok(repairPhases.indexOf("season-map") > -1);
  assert.ok(repairPhases.indexOf("pointers") > repairPhases.lastIndexOf("season-map"));
  for (const scopes of pointerScopes.values()) assert.deepEqual(scopes.sort(), ["bot", "public"]);
  assert.equal(state.dirty.repair, null);
});

test("repair skips a missing archived donation overlay but blocks a missing current overlay", () => {
  const q = loadQueue();
  q.makeCloudflareQueueObject_ = (path, payload, scope) => ({ path, payload, scope });
  q.readDecodedCloudflareQueueObject_ = (path) => {
    if (path.endsWith("donationRefresh/current")) return { seasonId: "season-current" };
    if (path.includes("bySeason/season-current")) return null;
    if (path.includes("bySeason/season-archived")) return null;
    return null;
  };
  const archived = q.buildCloudflareTargetedRepairRequest_({
    category: "repair", revision: 1, step: "donations", seasonIds: [], eventIds: [],
    donationSeasonIds: ["season-archived"], seasonIndex: 0, eventIndex: 0, donationIndex: 0,
  });
  assert.equal(archived.deletes.length, 2);
  assert.equal(archived.repairAdvance.step, "pointers");
  assert.throws(() => q.buildCloudflareTargetedRepairRequest_({
    category: "repair", revision: 2, step: "donations", seasonIds: [], eventIds: [],
    donationSeasonIds: ["season-current"], seasonIndex: 0, eventIndex: 0, donationIndex: 0,
  }), /Current donation pointer references a missing overlay/);
});
