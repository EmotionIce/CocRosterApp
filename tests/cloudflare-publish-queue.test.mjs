import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const repoRoot = new URL("../", import.meta.url);
const clone = (value) => JSON.parse(JSON.stringify(value));

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
    assert.equal(migrated.schemaVersion, 3);
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
  assert.equal(after.retry.attempt, 1);
  assert.ok(after.retry.nextAttemptAt);
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
  assert.equal(built.request.commits.at(-1).path, "active/currentVersionId");
  assert.equal(verified.length, 7);
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

test("two consecutive active publications and an unchanged enqueue are idempotent", () => {
  const q = loadQueue();
  let state = activeState(q);
  const store = installCloudflareTransport(q);
  q.readCloudflarePublishQueueState_ = () => clone(state);
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

test("queued v2 source has no whole-plan or history enumeration path", () => {
  const source = fs.readFileSync(new URL("script/cloudflarePublishQueue.js", repoRoot), "utf8");
  assert.equal(source.includes("buildCloudflareQueuedActivePlan_"), false);
  assert.equal(source.includes("buildCloudflareRelevantSnapshotPlan_"), false);
  assert.equal(source.includes("readActiveRosterSnapshotFromVersion_(target)"), false);
  assert.equal(source.includes("forceNext"), false);
});
