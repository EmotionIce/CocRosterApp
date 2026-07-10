// Durable asynchronous Cloudflare mirror queue. Firebase remains canonical.
//
// The queue deliberately separates local coordination from remote state:
// ScriptLock protects only Script Properties and trigger-list edits. Queue
// state itself is updated with Firebase ETag compare-and-swap, so no global
// Apps Script lock is held during OAuth, Firebase, or Cloudflare I/O.

var cloudflarePublishQueueDeadlineMs_ = 0;

function cloudflareQueueConstant_(nameRaw, fallbackRaw) {
	const name = String(nameRaw || "");
	try {
		if (typeof globalThis !== "undefined" && globalThis[name] !== undefined) return globalThis[name];
	} catch (err) {}
	// Apps Script top-level const bindings are lexical rather than properties
	// on globalThis, so resolve the policy constants explicitly as well.
	if (name === "CLOUDFLARE_PUBLISH_QUEUE_LOCK_LEASE_MS" && typeof CLOUDFLARE_PUBLISH_QUEUE_LOCK_LEASE_MS !== "undefined") return CLOUDFLARE_PUBLISH_QUEUE_LOCK_LEASE_MS;
	if (name === "CLOUDFLARE_PUBLISH_QUEUE_LOCK_POLL_MS" && typeof CLOUDFLARE_PUBLISH_QUEUE_LOCK_POLL_MS !== "undefined") return CLOUDFLARE_PUBLISH_QUEUE_LOCK_POLL_MS;
	if (name === "CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_DELAY_MS" && typeof CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_DELAY_MS !== "undefined") return CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_DELAY_MS;
	if (name === "CLOUDFLARE_PUBLISH_QUEUE_EXECUTION_BUDGET_MS" && typeof CLOUDFLARE_PUBLISH_QUEUE_EXECUTION_BUDGET_MS !== "undefined") return CLOUDFLARE_PUBLISH_QUEUE_EXECUTION_BUDGET_MS;
	if (name === "CLOUDFLARE_PUBLISH_QUEUE_MAX_ACTIVE_ROSTERS_PER_PHASE" && typeof CLOUDFLARE_PUBLISH_QUEUE_MAX_ACTIVE_ROSTERS_PER_PHASE !== "undefined") return CLOUDFLARE_PUBLISH_QUEUE_MAX_ACTIVE_ROSTERS_PER_PHASE;
	if (name === "CLOUDFLARE_PUBLISH_QUEUE_MAX_ACTIVE_BURST_BEFORE_DIRTY" && typeof CLOUDFLARE_PUBLISH_QUEUE_MAX_ACTIVE_BURST_BEFORE_DIRTY !== "undefined") return CLOUDFLARE_PUBLISH_QUEUE_MAX_ACTIVE_BURST_BEFORE_DIRTY;
	if (name === "CLOUDFLARE_PUBLISH_QUEUE_CAS_MAX_ATTEMPTS" && typeof CLOUDFLARE_PUBLISH_QUEUE_CAS_MAX_ATTEMPTS !== "undefined") return CLOUDFLARE_PUBLISH_QUEUE_CAS_MAX_ATTEMPTS;
	return fallbackRaw;
}

function cloudflareQueueNow_() { return Date.now(); }

function cloudflareQueueDeadlineReserveMs_(reserveRaw) {
	return Math.max(0, Number(reserveRaw) || 0);
}

function assertCloudflarePublishQueueDeadline_(reserveRaw, labelRaw) {
	const deadline = Number(cloudflarePublishQueueDeadlineMs_ || 0);
	if (!deadline) return true;
	const reserve = cloudflareQueueDeadlineReserveMs_(reserveRaw);
	if (cloudflareQueueNow_() + reserve <= deadline) return true;
	const error = new Error("Cloudflare queue deadline reserve is unavailable before " + String(labelRaw || "operation") + ".");
	error.code = "CLOUDFLARE_QUEUE_DEADLINE";
	error.resumable = true;
	throw error;
}

function getCloudflarePublicationMode_() {
	const properties = PropertiesService.getScriptProperties();
	const configured = typeof getOptionalScriptProperty_ === "function"
		? getOptionalScriptProperty_(CLOUDFLARE_PUBLICATION_MODE_PROPERTY)
		: properties.getProperty(CLOUDFLARE_PUBLICATION_MODE_PROPERTY);
	const raw = String(configured || "").trim().toLowerCase();
	if (raw === CLOUDFLARE_PUBLICATION_MODE_QUEUED_V2 || raw === CLOUDFLARE_PUBLICATION_MODE_DISABLED || raw === CLOUDFLARE_PUBLICATION_MODE_LEGACY_MANUAL) return raw;
	return CLOUDFLARE_PUBLICATION_MODE_LEGACY_MANUAL;
}

function isCloudflareQueuedPublicationEnabled_() {
	const publicDataEnabled = typeof isCloudflarePublicDataEnabled_ !== "function" || isCloudflarePublicDataEnabled_();
	return getCloudflarePublicationMode_() === CLOUDFLARE_PUBLICATION_MODE_QUEUED_V2 && publicDataEnabled;
}

function getCloudflarePublicDataPublishV2Endpoint_() {
	const legacy = getCloudflarePublicDataPublishEndpoint_();
	if (!legacy) return "";
	return legacy.replace(/\/api\/internal\/public-data\/publish$/i, "/api/internal/public-data/publish-v2");
}

function getCloudflarePublicDataVerifyV2Endpoint_() {
	const endpoint = getCloudflarePublicDataPublishV2Endpoint_();
	return endpoint ? endpoint.replace(/\/publish-v2$/i, "/verify-v2") : "";
}

function getCloudflareQueueRequestTimeoutSeconds_() {
	const fallback = typeof CLOUDFLARE_PUBLISH_QUEUE_REQUEST_TIMEOUT_SECONDS !== "undefined" ? CLOUDFLARE_PUBLISH_QUEUE_REQUEST_TIMEOUT_SECONDS : 20;
	return typeof getExternalRequestTimeoutSeconds_ === "function"
		? getExternalRequestTimeoutSeconds_("CLOUDFLARE_PUBLISH_QUEUE_REQUEST_TIMEOUT_SECONDS", fallback, 5, 25)
		: Math.max(5, Math.min(25, Number(fallback) || 20));
}

function createCloudflareQueueToken_() {
	try { return Utilities.getUuid(); } catch (err) {
		return String(Date.now()) + "-" + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(Date.now()))).slice(0, 20);
	}
}

function parseCloudflarePublishQueueLockState_(raw) {
	const text = String(raw == null ? "" : raw).trim();
	if (!text) return null;
	try {
		const parsed = JSON.parse(text);
		const token = String((parsed && parsed.token) || "").trim();
		const expiresAt = Number(parsed && parsed.expiresAt);
		if (!token || !isFinite(expiresAt)) return null;
		return { token: token, owner: String((parsed && parsed.owner) || "").trim(), expiresAt: Math.floor(expiresAt) };
	} catch (err) { return null; }
}

function tryAcquireCloudflarePublishQueueLease_(ownerRaw, waitMsRaw) {
	const owner = String(ownerRaw || "cloudflare-publish-worker").trim() || "cloudflare-publish-worker";
	const waitMs = Math.max(0, Number(waitMsRaw) || 0);
	const deadline = Date.now() + waitMs;
	const props = PropertiesService.getScriptProperties();
	const token = createCloudflareQueueToken_();
	while (true) {
		const lock = LockService.getScriptLock();
		const locked = lock.tryLock(Math.min(5000, Math.max(250, deadline - Date.now())));
		if (locked) {
			try {
				const now = Date.now();
				const current = parseCloudflarePublishQueueLockState_(props.getProperty(CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY));
				if (!current || current.expiresAt <= now) {
					props.setProperty(CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY, JSON.stringify({
						token: token,
						owner: owner,
						expiresAt: now + cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_LOCK_LEASE_MS", 8 * 60 * 1000),
					}));
					return { token: token, owner: owner, expiresAt: now + cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_LOCK_LEASE_MS", 8 * 60 * 1000) };
				}
			} finally { lock.releaseLock(); }
		}
		if (waitMs <= 0 || Date.now() >= deadline) return null;
		Utilities.sleep(cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_LOCK_POLL_MS", 100));
	}
}

function renewCloudflarePublishQueueLease_(tokenRaw) {
	const token = String(tokenRaw || "").trim();
	if (!token) return false;
	const props = PropertiesService.getScriptProperties();
	const lock = LockService.getScriptLock();
	if (!lock.tryLock(5000)) return false;
	try {
		const current = parseCloudflarePublishQueueLockState_(props.getProperty(CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY));
		if (!current || current.token !== token || current.expiresAt <= Date.now()) return false;
		current.expiresAt = Date.now() + cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_LOCK_LEASE_MS", 8 * 60 * 1000);
		props.setProperty(CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY, JSON.stringify(current));
		return true;
	} finally { lock.releaseLock(); }
}

function renewCloudflarePublishQueueLeaseOrThrow_(tokenRaw) {
	if (!renewCloudflarePublishQueueLease_(tokenRaw)) {
		const error = new Error("Cloudflare queue lease renewal failed.");
		error.code = "CLOUDFLARE_QUEUE_LEASE_LOST";
		throw error;
	}
	assertCloudflarePublishQueueLeaseOwned_(tokenRaw);
	return true;
}

function releaseCloudflarePublishQueueLease_(tokenRaw) {
	const token = String(tokenRaw || "").trim();
	if (!token) return false;
	const props = PropertiesService.getScriptProperties();
	const lock = LockService.getScriptLock();
	if (!lock.tryLock(5000)) return false;
	try {
		const current = parseCloudflarePublishQueueLockState_(props.getProperty(CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY));
		if (!current || current.token !== token) return false;
		props.deleteProperty(CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY);
		return true;
	} finally { lock.releaseLock(); }
}

function createEmptyCloudflarePublishQueueState_() {
	return {
		schemaVersion: 3,
		paused: false,
		nextRevision: 0,
		nextDispatchGeneration: 0,
		active: {
			targetVersionId: "",
			targetGeneration: 0,
			phase: "idle",
			cursor: 0,
			committedVersionId: "",
			dispatch: null,
			activeBurst: 0,
			republish: false,
			updatedAt: "",
		},
		dirty: {
			events: {},
			cwlAggregates: {},
			donationSeasons: {},
			cwlLeagueSignups: null,
			seasonPointers: null,
			repair: null,
			bootstrap: null,
		},
		retry: { attempt: 0, nextAttemptAt: "", lastError: "", lastFailureAt: "", permanent: false },
		lastSuccessAt: "",
		lastBatch: null,
		lastDriftRepairAt: "",
		initializedAt: "",
		updatedAt: "",
	};
}

function normalizeCloudflareQueuePhase_(phaseRaw, hasTargetRaw) {
	const phase = String(phaseRaw || "idle").trim();
	if (!hasTargetRaw) return "idle";
	if (phase === "public-manifest-rosters" || phase === "public-player-metrics" || phase === "bot-active" || phase === "bot-derived" || phase === "commit") return phase;
	// schema-v2 ordinary and commit states are restarted at the first
	// idempotent phase; committedVersionId is never changed by migration.
	return "public-manifest-rosters";
}

function normalizeCloudflarePublishQueueState_(raw) {
	const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
	const activeRaw = source.active && typeof source.active === "object" ? source.active : {};
	const dirtyRaw = source.dirty && typeof source.dirty === "object" ? source.dirty : {};
	const retryRaw = source.retry && typeof source.retry === "object" ? source.retry : {};
	const targetVersionId = normalizeActiveVersionId_(activeRaw.targetVersionId);
	const committedVersionId = normalizeActiveVersionId_(activeRaw.committedVersionId);
	const legacySchema = Math.max(0, toNonNegativeInt_(source.schemaVersion)) < 3;
	const repairLegacy = dirtyRaw.repair || dirtyRaw.relevantSnapshot;
	const repair = repairLegacy && typeof repairLegacy === "object" ? {
		revision: Math.max(0, toNonNegativeInt_(repairLegacy.revision)),
		step: ["discover", "events", "season-maps", "donations", "pointers"].includes(String(repairLegacy.step || "")) ? String(repairLegacy.step) : "discover",
		seasonIndex: Math.max(0, toNonNegativeInt_(repairLegacy.seasonIndex)),
		eventIndex: Math.max(0, toNonNegativeInt_(repairLegacy.eventIndex)),
		donationIndex: Math.max(0, toNonNegativeInt_(repairLegacy.donationIndex)),
		seasonIds: Array.isArray(repairLegacy.seasonIds) ? repairLegacy.seasonIds.map((id) => String(id || "").trim()).filter(Boolean) : [],
		eventIds: Array.isArray(repairLegacy.eventIds) ? repairLegacy.eventIds.map((id) => String(id || "").trim()).filter(Boolean) : [],
		donationSeasonIds: Array.isArray(repairLegacy.donationSeasonIds) ? repairLegacy.donationSeasonIds.map((id) => String(id || "").trim()).filter(Boolean) : [],
		updatedAt: String(repairLegacy.updatedAt || ""),
		reason: String(repairLegacy.reason || "repair").slice(0, 160),
	} : null;
	const rawPhase = String(activeRaw.phase || "idle").trim();
	const republish = activeRaw.republish === true;
	const hasUncommittedTarget = !!targetVersionId && (targetVersionId !== committedVersionId || republish || rawPhase !== "idle");
	const normalizedPhase = legacySchema && hasUncommittedTarget
		? "public-manifest-rosters"
		: normalizeCloudflareQueuePhase_(activeRaw.phase, hasUncommittedTarget);
	const normalizedCursor = normalizedPhase === "public-manifest-rosters" && (legacySchema || rawPhase !== normalizedPhase)
		? 0
		: Math.max(0, toNonNegativeInt_(activeRaw.cursor));
	return {
		schemaVersion: 3,
		paused: source.paused === true,
		nextRevision: Math.max(0, toNonNegativeInt_(source.nextRevision)),
		nextDispatchGeneration: Math.max(0, toNonNegativeInt_(source.nextDispatchGeneration)),
		active: {
			targetVersionId: targetVersionId,
			targetGeneration: Math.max(0, toNonNegativeInt_(activeRaw.targetGeneration)),
			phase: normalizedPhase,
			cursor: normalizedCursor,
			committedVersionId: committedVersionId,
			dispatch: activeRaw.dispatch && typeof activeRaw.dispatch === "object" ? activeRaw.dispatch : null,
			activeBurst: Math.max(0, toNonNegativeInt_(activeRaw.activeBurst)),
			republish: republish,
			updatedAt: String(activeRaw.updatedAt || ""),
		},
		dirty: {
			events: dirtyRaw.events && typeof dirtyRaw.events === "object" ? dirtyRaw.events : {},
			cwlAggregates: dirtyRaw.cwlAggregates && typeof dirtyRaw.cwlAggregates === "object" ? dirtyRaw.cwlAggregates : {},
			donationSeasons: dirtyRaw.donationSeasons && typeof dirtyRaw.donationSeasons === "object" ? dirtyRaw.donationSeasons : {},
			cwlLeagueSignups: dirtyRaw.cwlLeagueSignups && typeof dirtyRaw.cwlLeagueSignups === "object" ? dirtyRaw.cwlLeagueSignups : null,
			seasonPointers: dirtyRaw.seasonPointers && typeof dirtyRaw.seasonPointers === "object" ? dirtyRaw.seasonPointers : null,
			repair: repair,
			bootstrap: dirtyRaw.bootstrap && typeof dirtyRaw.bootstrap === "object" ? dirtyRaw.bootstrap : null,
		},
		retry: {
			attempt: Math.max(0, toNonNegativeInt_(retryRaw.attempt)),
			nextAttemptAt: String(retryRaw.nextAttemptAt || ""),
			lastError: String(retryRaw.lastError || "").slice(0, 2000),
			lastFailureAt: String(retryRaw.lastFailureAt || ""),
			permanent: retryRaw.permanent === true,
		},
		lastSuccessAt: String(source.lastSuccessAt || ""),
		lastBatch: source.lastBatch && typeof source.lastBatch === "object" ? source.lastBatch : null,
		lastDriftRepairAt: String(source.lastDriftRepairAt || ""),
		initializedAt: String(source.initializedAt || ""),
		updatedAt: String(source.updatedAt || ""),
	};
}

function readCloudflarePublishQueueState_() {
	assertCloudflarePublishQueueDeadline_(15000, "queue-state read");
	const encoded = firebaseRequestJson_(FIREBASE_INTERNAL_CLOUDFLARE_PUBLISH_STATE_PATH, "GET");
	const decoded = encoded == null ? null : decodeFirebaseObjectKeysRecursive_(encoded);
	return normalizeCloudflarePublishQueueState_(decoded);
}

function assertCloudflarePublishQueueLeaseOwned_(tokenRaw) {
	const token = String(tokenRaw || "").trim();
	if (!token) throw new Error("Cloudflare queue lease token is required.");
	const current = parseCloudflarePublishQueueLockState_(PropertiesService.getScriptProperties().getProperty(CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY));
	if (!current || current.token !== token || current.expiresAt <= Date.now()) {
		const error = new Error("Cloudflare queue lease ownership was lost.");
		error.code = "CLOUDFLARE_QUEUE_LEASE_LOST";
		throw error;
	}
	return true;
}

function buildCloudflareQueueCasConflictError_() {
	const error = new Error("Cloudflare publish queue compare-and-swap retries were exhausted.");
	error.code = "CLOUDFLARE_QUEUE_CAS_CONFLICT";
	error.resumable = true;
	return error;
}

// Mutations are deterministic pure callbacks. Each attempt reads an ETag,
// mutates a local normalized copy, and conditionally writes it. A 412 causes
// the callback to run again against the newer state, preserving concurrent
// enqueue categories and revisions.
function mutateCloudflarePublishQueueState_(callback, ownerTokenRaw) {
	if (typeof callback !== "function") throw new Error("Cloudflare queue mutation callback is required.");
	if (typeof firebaseRequestJsonWithEtag_ !== "function") throw new Error("Firebase ETag transport is unavailable.");
	const maxAttempts = Math.max(1, Number(cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_CAS_MAX_ATTEMPTS", 3)) || 3);
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		if (ownerTokenRaw) assertCloudflarePublishQueueLeaseOwned_(ownerTokenRaw);
		assertCloudflarePublishQueueDeadline_(30000, "queue-state CAS");
		const current = firebaseRequestJsonWithEtag_(FIREBASE_INTERNAL_CLOUDFLARE_PUBLISH_STATE_PATH, "GET");
		const state = normalizeCloudflarePublishQueueState_(current && current.value);
		const result = callback(state);
		if (ownerTokenRaw) assertCloudflarePublishQueueLeaseOwned_(ownerTokenRaw);
		assertCloudflarePublishQueueDeadline_(30000, "queue-state CAS write");
		try {
			firebaseRequestJsonWithEtag_(FIREBASE_INTERNAL_CLOUDFLARE_PUBLISH_STATE_PATH, "PUT", encodeFirebaseObjectKeysRecursive_(state), { ifMatch: current.etag });
			if (ownerTokenRaw) assertCloudflarePublishQueueLeaseOwned_(ownerTokenRaw);
			return result;
		} catch (err) {
			if (err && err.code === "FIREBASE_ETAG_CONFLICT") continue;
			throw err;
		}
	}
	throw buildCloudflareQueueCasConflictError_();
}

function nextCloudflarePublishRevision_(state) {
	state.nextRevision = Math.max(0, toNonNegativeInt_(state.nextRevision)) + 1;
	return state.nextRevision;
}

function makeCloudflareDirtyRevision_(state, reasonRaw, extraRaw) {
	return Object.assign({
		revision: nextCloudflarePublishRevision_(state),
		updatedAt: new Date().toISOString(),
		reason: String(reasonRaw || "mutation").slice(0, 160),
	}, extraRaw && typeof extraRaw === "object" ? extraRaw : {});
}

function hasPendingCloudflarePublishWork_(stateRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	if (state.active.targetVersionId && (state.active.targetVersionId !== state.active.committedVersionId || state.active.republish || state.active.phase !== "idle")) return true;
	const dirty = state.dirty;
	return Object.keys(dirty.events).length > 0 || Object.keys(dirty.cwlAggregates).length > 0 ||
		Object.keys(dirty.donationSeasons).length > 0 || !!dirty.cwlLeagueSignups || !!dirty.seasonPointers ||
		!!dirty.repair || !!dirty.bootstrap;
}

function getCloudflareTriggerId_(propertyNameRaw) {
	return String(PropertiesService.getScriptProperties().getProperty(propertyNameRaw) || "").trim();
}

function getCloudflareTriggerAtMs_(propertyNameRaw) {
	return Math.max(0, Number(PropertiesService.getScriptProperties().getProperty(propertyNameRaw) || 0));
}

function getCloudflareTriggerCandidates_(handlerNameRaw) {
	if (typeof ScriptApp === "undefined" || !ScriptApp || typeof ScriptApp.getProjectTriggers !== "function") return [];
	const handlerName = String(handlerNameRaw || "");
	return ScriptApp.getProjectTriggers().filter(function (trigger) {
		return String(trigger.getHandlerFunction ? trigger.getHandlerFunction() : "") === handlerName;
	});
}

function ensureCloudflareTrigger_(handlerNameRaw, idPropertyRaw, atPropertyRaw, desiredAtMsRaw) {
	if (typeof ScriptApp === "undefined" || !ScriptApp || typeof ScriptApp.newTrigger !== "function") return { scheduled: false, reason: "scriptapp-unavailable" };
	const desiredAtMs = Math.max(Date.now() + 1000, Number(desiredAtMsRaw) || Date.now() + 1000);
	const properties = PropertiesService.getScriptProperties();
	const candidates = getCloudflareTriggerCandidates_(handlerNameRaw);
	const configuredId = getCloudflareTriggerId_(idPropertyRaw);
	const configuredTrigger = candidates.find((trigger) => getTriggerUniqueId_(trigger) === configuredId) || null;
	const configuredAtMs = getCloudflareTriggerAtMs_(atPropertyRaw);
	const toleranceMs = typeof CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_REUSE_TOLERANCE_MS !== "undefined"
		? Math.max(0, Number(CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_REUSE_TOLERANCE_MS) || 0)
		: 30000;
	// The stored timestamp is the only schedule timestamp Apps Script exposes.
	// Reuse only when the known trigger is no later than the requested time,
	// allowing a small clock/scheduler tolerance. A later or metadata-invalid
	// trigger is replaced and all duplicates are removed.
	if (configuredTrigger && configuredAtMs > 0 && configuredAtMs <= desiredAtMs + toleranceMs) {
		for (let i = 0; i < candidates.length; i++) if (candidates[i] !== configuredTrigger) { try { ScriptApp.deleteTrigger(candidates[i]); } catch (err) {} }
		const triggerId = getTriggerUniqueId_(configuredTrigger);
		if (triggerId) properties.setProperty(idPropertyRaw, triggerId);
		properties.setProperty(atPropertyRaw, String(configuredAtMs));
		return { scheduled: true, reused: true, triggerId: triggerId, scheduledAt: new Date(configuredAtMs).toISOString() };
	}
	const delay = Math.max(1000, desiredAtMs - Date.now());
	const created = ScriptApp.newTrigger(handlerNameRaw).timeBased().after(delay).create();
	for (let i = 0; i < candidates.length; i++) { try { ScriptApp.deleteTrigger(candidates[i]); } catch (err) {} }
	const triggerId = getTriggerUniqueId_(created);
	if (triggerId) properties.setProperty(idPropertyRaw, triggerId);
	properties.setProperty(atPropertyRaw, String(Date.now() + delay));
	return { scheduled: true, reused: false, triggerId: triggerId, scheduledAt: new Date(Date.now() + delay).toISOString() };
}

// Scheduling consumes already-known state from the preceding CAS. It never
// reads Firebase to rediscover pending work.
function scheduleCloudflarePublishWorker_(ownerTokenRaw, pendingKnownRaw, notBeforeRaw) {
	if (!isCloudflareQueuedPublicationEnabled_()) return { scheduled: false, reason: "disabled" };
	if (pendingKnownRaw === false) return { scheduled: false, reason: "empty" };
	if (ownerTokenRaw) assertCloudflarePublishQueueLeaseOwned_(ownerTokenRaw);
	const nextAttemptMs = typeof notBeforeRaw === "number" ? notBeforeRaw : parseIsoToMs_(notBeforeRaw);
	const desiredAtMs = Math.max(Date.now() + CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_DELAY_MS, nextAttemptMs || 0);
	const lock = LockService.getScriptLock();
	lock.waitLock(10000);
	try {
		return ensureCloudflareTrigger_(CLOUDFLARE_PUBLISH_QUEUE_HANDLER_NAME, CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_ID_PROPERTY, CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_AT_PROPERTY, desiredAtMs);
	} finally { lock.releaseLock(); }
}

function scheduleCloudflarePublishWorkerRecovery_(pendingKnownRaw) {
	if (pendingKnownRaw === false || typeof ScriptApp === "undefined" || !ScriptApp) return { scheduled: false, reason: pendingKnownRaw === false ? "empty" : "scriptapp-unavailable" };
	const lock = LockService.getScriptLock();
	lock.waitLock(10000);
	try {
		return ensureCloudflareTrigger_(
			cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_HANDLER_NAME", "cloudflarePublishWorkerRecoveryTick"),
			cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_ID_PROPERTY", "CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_ID"),
			cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_AT_PROPERTY", "CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_AT"),
			Date.now() + cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_DELAY_MS", 9 * 60 * 1000),
		);
	} finally { lock.releaseLock(); }
}

function removeCloudflarePublishWorkerTriggers_(pendingKnownRaw) {
	if (pendingKnownRaw !== false || typeof ScriptApp === "undefined" || !ScriptApp || typeof ScriptApp.getProjectTriggers !== "function") return 0;
	const lock = LockService.getScriptLock();
	lock.waitLock(10000);
	try {
		const properties = PropertiesService.getScriptProperties();
			const handlers = [CLOUDFLARE_PUBLISH_QUEUE_HANDLER_NAME, cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_HANDLER_NAME", "cloudflarePublishWorkerRecoveryTick")];
		const triggers = ScriptApp.getProjectTriggers();
		let removed = 0;
		for (let i = 0; i < triggers.length; i++) {
			const handler = String(triggers[i].getHandlerFunction ? triggers[i].getHandlerFunction() : "");
			if (!handlers.includes(handler)) continue;
			try { ScriptApp.deleteTrigger(triggers[i]); removed++; } catch (err) {}
		}
		properties.deleteProperty(CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_ID_PROPERTY);
		properties.deleteProperty(CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_AT_PROPERTY);
		properties.deleteProperty(cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_ID_PROPERTY", "CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_ID"));
		properties.deleteProperty(cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_AT_PROPERTY", "CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_AT"));
		return removed;
	} finally { lock.releaseLock(); }
}

function scheduleCloudflareAfterMutation_(resultRaw) {
	const result = resultRaw && typeof resultRaw === "object" ? resultRaw : {};
	try { return scheduleCloudflarePublishWorker_(undefined, result.pending !== false, result.nextAttemptAt || ""); } catch (err) {
		Logger.log("Cloudflare continuation scheduling failed: %s", errorMessage_(err));
		return { scheduled: false, error: errorMessage_(err) };
	}
}

function enqueueCloudflareActiveTarget_(versionIdRaw, reasonRaw) {
	const versionId = normalizeActiveVersionId_(versionIdRaw);
	if (!versionId || !isCloudflareQueuedPublicationEnabled_()) return { ok: false, skipped: true, reason: !versionId ? "missing-version" : "disabled" };
	try {
		const result = mutateCloudflarePublishQueueState_(function (state) {
			if (state.active.targetVersionId !== versionId) {
				state.active.targetVersionId = versionId;
				state.active.targetGeneration = Math.max(Math.max(0, toNonNegativeInt_(state.active.targetGeneration)) + 1, Date.now());
				state.active.phase = "public-manifest-rosters";
				state.active.cursor = 0;
				state.active.dispatch = null;
			}
			state.active.updatedAt = new Date().toISOString();
			return { ok: true, versionId: versionId, generation: state.active.targetGeneration, pending: true, nextAttemptAt: state.retry.nextAttemptAt };
		});
		scheduleCloudflareAfterMutation_(result);
		return result;
	} catch (err) {
		Logger.log("Cloudflare active target enqueue failed versionId=%s error=%s", versionId, errorMessage_(err));
		return { ok: false, error: errorMessage_(err), versionId: versionId };
	}
}

function enqueueCloudflareSeasonEventPublication_(eventIdRaw, reasonRaw, optionsRaw) {
	const eventId = sanitizeSeasonEventText_(eventIdRaw, 180);
	if (!eventId || !isCloudflareQueuedPublicationEnabled_()) return { ok: false, skipped: true, reason: !eventId ? "missing-event" : "disabled" };
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	try {
		const result = mutateCloudflarePublishQueueState_(function (state) {
			state.dirty.events[eventId] = makeCloudflareDirtyRevision_(state, reasonRaw || "event-mutation", { eventId: eventId, category: "event" });
			if (options.cwlLive === true || options.cwlFinal === true) {
				const kinds = state.dirty.cwlAggregates[eventId] && typeof state.dirty.cwlAggregates[eventId] === "object" ? state.dirty.cwlAggregates[eventId] : {};
				if (options.cwlLive === true) kinds.live = makeCloudflareDirtyRevision_(state, reasonRaw || "cwl-live", { eventId: eventId, kind: "live", category: "cwlAggregate" });
				if (options.cwlFinal === true) kinds.final = makeCloudflareDirtyRevision_(state, reasonRaw || "cwl-final", { eventId: eventId, kind: "final", category: "cwlAggregate" });
				state.dirty.cwlAggregates[eventId] = kinds;
			}
			if (options.pointers === true) state.dirty.seasonPointers = makeCloudflareDirtyRevision_(state, reasonRaw || "event-pointers", { category: "seasonPointers" });
			return { ok: true, eventId: eventId, revision: state.dirty.events[eventId].revision, pending: true, nextAttemptAt: state.retry.nextAttemptAt };
		});
		scheduleCloudflareAfterMutation_(result);
		return result;
	} catch (err) {
		Logger.log("Cloudflare event enqueue failed eventId=%s error=%s", eventId, errorMessage_(err));
		return { ok: false, error: errorMessage_(err), eventId: eventId };
	}
}

function enqueueCloudflareRelevantSeasonPublication_(reasonRaw) {
	if (!isCloudflareQueuedPublicationEnabled_()) return { ok: false, skipped: true, reason: "disabled" };
	try {
		const result = mutateCloudflarePublishQueueState_(function (state) {
			state.dirty.repair = makeCloudflareDirtyRevision_(state, reasonRaw || "targeted-repair", {
				category: "repair", step: "discover", seasonIndex: 0, eventIndex: 0, donationIndex: 0,
				seasonIds: [], eventIds: [], donationSeasonIds: [],
			});
			state.lastDriftRepairAt = new Date().toISOString();
			return { ok: true, category: "repair", pending: true, nextAttemptAt: state.retry.nextAttemptAt };
		});
		scheduleCloudflareAfterMutation_(result);
		return result;
	} catch (err) {
		Logger.log("Cloudflare targeted repair enqueue failed error=%s", errorMessage_(err));
		return { ok: false, error: errorMessage_(err) };
	}
}

function enqueueCloudflareDonationSeasonPublication_(seasonIdRaw, reasonRaw) {
	const seasonId = sanitizeDonationCycleKey_(seasonIdRaw);
	if (!seasonId || !isCloudflareQueuedPublicationEnabled_()) return { ok: false, skipped: true, reason: !seasonId ? "missing-season" : "disabled" };
	try {
		const result = mutateCloudflarePublishQueueState_(function (state) {
			state.dirty.donationSeasons[seasonId] = makeCloudflareDirtyRevision_(state, reasonRaw || "donation-refresh", { seasonId: seasonId, category: "donationSeason" });
			return { ok: true, seasonId: seasonId, revision: state.dirty.donationSeasons[seasonId].revision, pending: true, nextAttemptAt: state.retry.nextAttemptAt };
		});
		scheduleCloudflareAfterMutation_(result);
		return result;
	} catch (err) {
		Logger.log("Cloudflare donation enqueue failed seasonId=%s error=%s", seasonId, errorMessage_(err));
		return { ok: false, error: errorMessage_(err), seasonId: seasonId };
	}
}

function enqueueCloudflareCwlLeagueSignupsPublication_(reasonRaw) {
	if (!isCloudflareQueuedPublicationEnabled_()) return { ok: false, skipped: true, reason: "disabled" };
	try {
		const result = mutateCloudflarePublishQueueState_(function (state) {
			state.dirty.cwlLeagueSignups = makeCloudflareDirtyRevision_(state, reasonRaw || "cwl-signups", { category: "cwlLeagueSignups" });
			return { ok: true, revision: state.dirty.cwlLeagueSignups.revision, pending: true, nextAttemptAt: state.retry.nextAttemptAt };
		});
		scheduleCloudflareAfterMutation_(result);
		return result;
	} catch (err) {
		Logger.log("Cloudflare CWL signup enqueue failed error=%s", errorMessage_(err));
		return { ok: false, error: errorMessage_(err) };
	}
}

function cloudflareQueueJsonBytes_(valueRaw) {
	const text = JSON.stringify(valueRaw);
	try { return Utilities.newBlob(text).getBytes().length; } catch (err) { return text.length; }
}

function cloudflareQueueTextBytes_(textRaw) {
	const text = String(textRaw == null ? "" : textRaw);
	try { return Utilities.newBlob(text).getBytes().length; } catch (err) { return text.length; }
}

function cloudflareQueueWorkerPath_(pathRaw) {
	return normalizeCloudflareDataObjectPath_(pathRaw) + ".json";
}

function cloudflareQueueWorkerKey_(scopeRaw, pathRaw) {
	const scope = normalizeCloudflareDataScope_(scopeRaw);
	return (scope === "bot" ? "bot-data" : "public-data") + "/" + cloudflareQueueWorkerPath_(pathRaw);
}

function cloudflareQueueWorkerCacheControl_(scopeRaw, pathRaw) {
	const scope = normalizeCloudflareDataScope_(scopeRaw);
	const path = normalizeCloudflareDataObjectPath_(pathRaw);
	if (scope === "bot") return "private, max-age=30";
	if (path.indexOf("activeVersions/") === 0) return "public, max-age=31536000, immutable";
	if (path === "active" || path === "bootstrap/current" || path.indexOf("activePublished/") === 0 || path.indexOf("events/seasonEvents/") === 0 || path.indexOf("donationRefresh/") === 0) return "no-store";
	return "public, max-age=30, stale-while-revalidate=120";
}

function cloudflareQueuePublishPayload_(entryRaw) {
	const entry = entryRaw && typeof entryRaw === "object" && !Array.isArray(entryRaw) ? entryRaw : null;
	if (!entry) throw new Error("Each publish object must be an object.");
	if (Object.prototype.hasOwnProperty.call(entry, "payload")) return entry.payload;
	if (Object.prototype.hasOwnProperty.call(entry, "value")) return entry.value;
	if (Object.prototype.hasOwnProperty.call(entry, "json")) return entry.json;
	throw new Error("Publish object payload is required.");
}

// Mirror Worker normalizePublishObject exactly. This is intentionally kept
// separate from the queue's encoded storage representation: size checks are
// performed on the envelope the Worker will actually evaluate.
function normalizeCloudflareQueuePublishObjectForSize_(entryRaw, defaultScopeRaw, publishedAtRaw) {
	const entry = entryRaw && typeof entryRaw === "object" && !Array.isArray(entryRaw) ? entryRaw : null;
	if (!entry) throw new Error("Each publish object must be an object.");
	const scope = normalizeCloudflareDataScope_(entry.scope || defaultScopeRaw);
	const path = normalizeCloudflareDataObjectPath_(entry.path || entry.key || entry.name);
	const payloadText = JSON.stringify(cloudflareQueuePublishPayload_(entry));
	return {
		scope: scope,
		path: cloudflareQueueWorkerPath_(path),
		key: cloudflareQueueWorkerKey_(scope, path),
		payloadText: payloadText,
		cacheControl: String(entry.cacheControl || cloudflareQueueWorkerCacheControl_(scope, path)).trim(),
		contentType: String(entry.contentType || "application/json; charset=utf-8").trim(),
		publishedAt: String(publishedAtRaw || new Date().toISOString()),
	};
}

function normalizeCloudflareQueueDeleteForSize_(entryRaw, defaultScopeRaw) {
	const entry = entryRaw && typeof entryRaw === "object" && !Array.isArray(entryRaw) ? entryRaw : { path: entryRaw };
	const scope = normalizeCloudflareDataScope_(entry.scope || defaultScopeRaw);
	const path = normalizeCloudflareDataObjectPath_(entry.path || entry.key || entry.name);
	return { scope: scope, path: cloudflareQueueWorkerPath_(path), key: cloudflareQueueWorkerKey_(scope, path) };
}

function normalizeCloudflareQueueCommitForSize_(entryRaw, defaultScopeRaw, publishedAtRaw) {
	const entry = entryRaw && typeof entryRaw === "object" && !Array.isArray(entryRaw) ? entryRaw : null;
	if (!entry) throw new Error("Each commit must be an object.");
	if (entry.delete === true || String(entry.operation || entry.action || "").toLowerCase() === "delete") {
		return Object.assign({ operation: "delete" }, normalizeCloudflareQueueDeleteForSize_(entry, defaultScopeRaw));
	}
	return Object.assign({ operation: "put" }, normalizeCloudflareQueuePublishObjectForSize_(entry, defaultScopeRaw, publishedAtRaw));
}

function cloudflareQueueNormalizedEnvelopeBytes_(requestRaw) {
	const request = requestRaw && typeof requestRaw === "object" ? requestRaw : {};
	const defaultScope = normalizeCloudflareDataScope_(request.scope || "public");
	const publishedAt = String(request.publishedAt || new Date().toISOString());
	const objects = (Array.isArray(request.objects) ? request.objects : []).map((entry) => normalizeCloudflareQueuePublishObjectForSize_(entry, defaultScope, publishedAt));
	const deletesRaw = Array.isArray(request.deletePaths) ? request.deletePaths : Array.isArray(request.deletes) ? request.deletes : [];
	const deletes = deletesRaw.map((entry) => normalizeCloudflareQueueDeleteForSize_(entry, defaultScope));
	const commitsRaw = Array.isArray(request.commits) ? request.commits : Array.isArray(request.commitObjects) ? request.commitObjects : [];
	const commits = commitsRaw.map((entry) => normalizeCloudflareQueueCommitForSize_(entry, defaultScope, publishedAt));
	return cloudflareQueueJsonBytes_({
		requestId: String(request.requestId || "request-id"),
		batchId: String(request.batchId || "batch-id"),
		publishedAt: publishedAt,
		objects: objects,
		deletes: deletes,
		commits: commits,
		commitGuard: request.commitGuard || null,
		dispatchGuard: request.dispatchGuard || null,
	});
}

function assertCloudflareQueuedRequestBounds_(requestRaw) {
	const request = requestRaw && typeof requestRaw === "object" ? requestRaw : {};
	const objects = Array.isArray(request.objects) ? request.objects : [];
	const deletes = Array.isArray(request.deletes) ? request.deletes : [];
	const commits = Array.isArray(request.commits) ? request.commits : [];
	const maxObjects = Number(cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_MAX_OBJECTS_PER_REQUEST", 24));
	if (objects.length > maxObjects || deletes.length > maxObjects || commits.length > maxObjects) throw new Error("Cloudflare queued request exceeds object-count limit.");
	const publishedAt = String(request.publishedAt || new Date().toISOString());
	const defaultScope = normalizeCloudflareDataScope_(request.scope || "public");
	const all = objects.map((entry) => normalizeCloudflareQueuePublishObjectForSize_(entry, defaultScope, publishedAt)).concat(
		commits.map((entry) => normalizeCloudflareQueueCommitForSize_(entry, defaultScope, publishedAt)),
	);
	for (let i = 0; i < all.length; i++) {
		const bytes = cloudflareQueueTextBytes_(all[i].payloadText || "");
		if (bytes > Number(cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_HARD_OBJECT_BYTES", 8 * 1024 * 1024))) throw new Error("Cloudflare object exceeds hard limit path=" + all[i].scope + ":" + all[i].path + " bytes=" + bytes + ".");
	}
	const bytes = cloudflareQueueNormalizedEnvelopeBytes_(request);
	if (bytes > Number(cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_MAX_PAYLOAD_BYTES", 10 * 1024 * 1024))) throw new Error("Cloudflare queued request exceeds payload limit bytes=" + bytes + ".");
	return bytes;
}

// Retained for explicit/manual callers. Normal worker phase claims allocate
// their dispatch generation in the same queue CAS that records the claim.
function allocateCloudflarePublishDispatchGuard_(batchIdRaw, ownerTokenRaw) {
	const batchId = String(batchIdRaw || "").trim();
	if (!batchId) throw new Error("Cloudflare queued publication batchId is required.");
	return mutateCloudflarePublishQueueState_(function (state) {
		state.nextDispatchGeneration = Math.max(Math.max(0, toNonNegativeInt_(state.nextDispatchGeneration)) + 1, Date.now());
		return { kind: "queued-v2", generation: state.nextDispatchGeneration, batchId: batchId };
	}, ownerTokenRaw);
}

function sendCloudflareQueuedV2Request_(requestRaw, labelRaw, ownerTokenRaw) {
	const endpoint = getCloudflarePublicDataPublishV2Endpoint_();
	const secret = getCloudflarePublicDataPublishSecret_();
	if (!endpoint) throw new Error("Missing Cloudflare v2 publish endpoint.");
	if (!secret) throw new Error("Missing Cloudflare publish secret.");
	if (typeof UrlFetchApp === "undefined" || !UrlFetchApp || typeof UrlFetchApp.fetch !== "function") throw new Error("UrlFetchApp is unavailable.");
	const request = Object.assign({}, requestRaw || {});
	request.requestId = String(request.requestId || createCloudflareQueueToken_());
	request.publishedAt = String(request.publishedAt || new Date().toISOString());
	request.dispatchGuard = request.dispatchGuard || allocateCloudflarePublishDispatchGuard_(request.batchId, ownerTokenRaw);
	assertCloudflarePublishQueueDeadline_(getCloudflareQueueRequestTimeoutSeconds_() * 1000 + 15000, "Cloudflare publication request");
	const payloadBytes = assertCloudflareQueuedRequestBounds_(request);
	assertCloudflarePublishQueueDeadline_(15000, "Cloudflare publication serialization");
	const payloadText = JSON.stringify(request);
	const startedAt = Date.now();
	const response = UrlFetchApp.fetch(endpoint, {
		method: "post",
		contentType: "application/json",
		headers: { Authorization: "Bearer " + secret },
		payload: payloadText,
		muteHttpExceptions: true,
		timeoutSeconds: getCloudflareQueueRequestTimeoutSeconds_(),
	});
	const statusCode = typeof response.getResponseCode === "function" ? response.getResponseCode() : 0;
	const text = typeof response.getContentText === "function" ? response.getContentText() : "";
	let parsed = null;
	try { parsed = text ? JSON.parse(text) : null; } catch (err) { parsed = null; }
	if (statusCode < 200 || statusCode >= 300 || !parsed || parsed.ok !== true) {
		const failure = parsed && parsed.failed ? " failed=" + String(parsed.failed.scope || "") + ":" + String(parsed.failed.path || "") : "";
		throw new Error(String((parsed && parsed.error) || ("Cloudflare v2 publish failed with HTTP " + statusCode + ".")) + failure);
	}
	Logger.log("Cloudflare queued publish label=%s batch=%s objects=%s deletes=%s commits=%s bytes=%s httpMs=%s status=%s", String(labelRaw || ""), String(request.batchId || ""), (request.objects || []).length, (request.deletes || []).length, (request.commits || []).length, payloadBytes, Math.max(0, Date.now() - startedAt), statusCode);
	return { ok: true, response: parsed, statusCode: statusCode, payloadBytes: payloadBytes, durationMs: Math.max(0, Date.now() - startedAt) };
}

function verifyCloudflareActiveVersionObjects_(versionIdRaw, requiredRaw, ownerTokenRaw) {
	const versionId = normalizeActiveVersionId_(versionIdRaw);
	const required = Array.isArray(requiredRaw) ? requiredRaw : [];
	const endpoint = getCloudflarePublicDataVerifyV2Endpoint_();
	const secret = getCloudflarePublicDataPublishSecret_();
	if (!endpoint || !secret) throw new Error("Missing Cloudflare v2 verification configuration.");
	assertCloudflarePublishQueueDeadline_(35000, "Cloudflare object verification");
	assertCloudflarePublishQueueDeadline_(15000, "Cloudflare verification serialization");
	const payloadText = JSON.stringify({ versionId: versionId, objects: required });
	const response = UrlFetchApp.fetch(endpoint, {
		method: "post",
		contentType: "application/json",
		headers: { Authorization: "Bearer " + secret },
		payload: payloadText,
		muteHttpExceptions: true,
		timeoutSeconds: getCloudflareQueueRequestTimeoutSeconds_(),
	});
	const status = typeof response.getResponseCode === "function" ? response.getResponseCode() : 0;
	const text = typeof response.getContentText === "function" ? response.getContentText() : "";
	let parsed = null;
	try { parsed = text ? JSON.parse(text) : null; } catch (err) { parsed = null; }
	if (status < 200 || status >= 300 || !parsed || parsed.ok !== true) throw new Error(String(parsed && parsed.error || "Cloudflare active version object verification failed."));
	return parsed;
}

function buildCloudflareQueuedBootstrapCommit_(stateRaw, activeVersionOverrideRaw, manifestOverrideRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	const versionId = normalizeActiveVersionId_(activeVersionOverrideRaw) || getCloudflareCommittedActiveVersionId_(state);
	if (!versionId) throw new Error("Cloudflare bootstrap requires a committed active version.");
	if (typeof buildCloudflarePublicBootstrapPayload_ === "function") {
		return {
			path: CLOUDFLARE_PUBLIC_DATA_BOOTSTRAP_PATH,
			payload: buildCloudflarePublicBootstrapPayload_({ compact: true, activeVersionIdOverride: versionId, manifestOverride: manifestOverrideRaw }),
		};
	}
	return { path: CLOUDFLARE_PUBLIC_DATA_BOOTSTRAP_PATH, payload: { schemaVersion: 2, generatedAt: new Date().toISOString(), activeVersionId: versionId, active: { versionId: versionId, manifest: manifestOverrideRaw || null } } };
}

function getCloudflareCommittedActiveVersionId_(stateRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	return normalizeActiveVersionId_(state.active.committedVersionId);
}

function buildCloudflareCommittedVersionSelector_(stateRaw, currentVersionIdRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	const currentVersionId = normalizeActiveVersionId_(currentVersionIdRaw);
	const previousVersionId = normalizeActiveVersionId_(state.active.committedVersionId);
	return {
		schemaVersion: 1,
		currentVersionId: currentVersionId,
		previousVersionId: previousVersionId && previousVersionId !== currentVersionId ? previousVersionId : "",
		generation: Math.max(0, toNonNegativeInt_(state.active.targetGeneration)),
		committedAt: new Date().toISOString(),
	};
}

function addCloudflareMirroredQueueObject_(objects, pathRaw, payloadRaw) {
	if (payloadRaw == null) return;
	objects.push(makeCloudflareQueueObject_(pathRaw, payloadRaw, "public"));
	objects.push(makeCloudflareQueueObject_(pathRaw, payloadRaw, "bot"));
}

function addCloudflareMirroredQueueDelete_(deletes, pathRaw) {
	deletes.push({ path: normalizeCloudflareDataObjectPath_(pathRaw), scope: "public" });
	deletes.push({ path: normalizeCloudflareDataObjectPath_(pathRaw), scope: "bot" });
}

function readDecodedCloudflareQueueObject_(pathRaw) {
	assertCloudflarePublishQueueDeadline_(15000, "Firebase publication read");
	const encoded = firebaseRequestJson_(pathRaw, "GET");
	return encoded == null ? null : decodeFirebaseObjectKeysRecursive_(encoded);
}

function makeCloudflareQueueObject_(pathRaw, payloadRaw, scopeRaw) {
	// Queue builders pass decoded objects. This is the single encoding boundary
	// for Cloudflare object payloads; callers must never pre-encode payloadRaw.
	return makeCloudflareDataObject_(pathRaw, encodeFirebaseObjectKeysRecursive_(payloadRaw), scopeRaw || "public");
}

function readCloudflareTargetManifest_(versionIdRaw) {
	const path = typeof buildActiveVersionPath_ === "function"
		? buildActiveVersionPath_(versionIdRaw, "manifest")
		: buildFirebaseChildPath_("activeVersions", encodeFirebaseObjectKey_(versionIdRaw), "manifest");
	const manifest = readDecodedCloudflareQueueObject_(path);
	if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Missing active version manifest for " + versionIdRaw + ".");
	return manifest;
}

function readCloudflareTargetRosterMap_(versionIdRaw, manifestRaw) {
	const manifest = manifestRaw && typeof manifestRaw === "object" ? manifestRaw : {};
	const rosterIds = Array.isArray(manifest.rosterIds) ? manifest.rosterIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
	if (rosterIds.length > Number(cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_MAX_ACTIVE_ROSTERS_PER_PHASE", 24))) throw new Error("Active roster count exceeds one bounded publication phase.");
	const buildPath = (child) => typeof buildActiveVersionPath_ === "function"
		? buildActiveVersionPath_(versionIdRaw, child)
		: buildFirebaseChildPath_("activeVersions", encodeFirebaseObjectKey_(versionIdRaw), child);
	const paths = rosterIds.map((id) => buildPath("rosters/" + encodeFirebaseObjectKey_(id)));
	let encodedByPath = {};
	if (paths.length && typeof firebaseBatchGetJson_ === "function") encodedByPath = firebaseBatchGetJson_(paths, { disableFallback: true });
	else if (!paths.length) {
		const fallback = readDecodedCloudflareQueueObject_(buildPath("rosters"));
		return fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};
	}
	const rosterMap = {};
	for (let i = 0; i < paths.length; i++) {
		const encoded = encodedByPath[paths[i]];
		if (!encoded || typeof encoded !== "object" || Array.isArray(encoded)) throw new Error("Missing active version roster shard '" + rosterIds[i] + "'.");
		rosterMap[rosterIds[i]] = decodeFirebaseObjectKeysRecursive_(encoded);
	}
	return rosterMap;
}

function buildCloudflareActivePhaseRequest_(stateRaw, claimRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	const claim = claimRaw && typeof claimRaw === "object" ? claimRaw : {};
	const versionId = state.active.targetVersionId;
	const encodedVersionId = encodeFirebaseObjectKey_(versionId);
	const phase = String(claim.phase || state.active.phase);
	if (phase === "public-manifest-rosters") {
		assertCloudflarePublishQueueDeadline_(60000, "active public manifest and rosters reconstruction");
		const manifest = readCloudflareTargetManifest_(versionId);
		const rosters = readCloudflareTargetRosterMap_(versionId, manifest);
		return { label: "active-public-manifest-rosters", request: { batchId: "active:" + versionId + ":public-manifest-rosters", objects: [makeCloudflareQueueObject_("activeVersions/" + encodedVersionId + "/manifest", manifest, "public"), makeCloudflareQueueObject_("activeVersions/" + encodedVersionId + "/rosters", rosters, "public")] } };
	}
	if (phase === "public-player-metrics") {
		assertCloudflarePublishQueueDeadline_(45000, "active player metrics read");
		const metrics = readDecodedCloudflareQueueObject_(typeof buildActiveVersionPath_ === "function" ? buildActiveVersionPath_(versionId, "playerMetrics") : buildFirebaseChildPath_("activeVersions", encodeFirebaseObjectKey_(versionId), "playerMetrics")) || {};
		return { label: "active-public-player-metrics", request: { batchId: "active:" + versionId + ":public-player-metrics", objects: [makeCloudflareQueueObject_("activeVersions/" + encodedVersionId + "/playerMetrics", metrics, "public")] } };
	}
	if (phase === "bot-active") {
		assertCloudflarePublishQueueDeadline_(90000, "active bot payload reconstruction");
		const snapshot = readActiveRosterSnapshotFromVersion_(versionId);
		if (!snapshot || !snapshot.rosterData) throw new Error("Active target version is incomplete: " + versionId + ".");
		const payload = Object.assign({}, snapshot.rosterData, { activeVersionId: versionId });
		return { label: "active-bot-versioned-active", request: { batchId: "active:" + versionId + ":bot-active", objects: [makeCloudflareQueueObject_("activeVersions/" + encodedVersionId + "/active", payload, "bot")] } };
	}
	if (phase === "bot-derived") {
		assertCloudflarePublishQueueDeadline_(60000, "active bot derived data");
		const metrics = readDecodedCloudflareQueueObject_(typeof buildActiveVersionPath_ === "function" ? buildActiveVersionPath_(versionId, "playerMetrics") : buildFirebaseChildPath_("activeVersions", encodeFirebaseObjectKey_(versionId), "playerMetrics")) || {};
		const byTag = metrics.byTag && typeof metrics.byTag === "object" ? metrics.byTag : {};
		const linked = buildCloudflareLinkedAccountIndexes_({ playerMetrics: metrics });
		return { label: "active-bot-derived", request: { batchId: "active:" + versionId + ":bot-derived", objects: [
			makeCloudflareQueueObject_("activeVersions/" + encodedVersionId + "/playerMetrics/byTag", byTag, "bot"),
			makeCloudflareQueueObject_("activeVersions/" + encodedVersionId + "/indexes/linkedAccountsByDiscordId", linked.byDiscordId, "bot"),
			makeCloudflareQueueObject_("activeVersions/" + encodedVersionId + "/indexes/linkedAccountsByDiscordUsername", linked.byDiscordUsername, "bot"),
		] } };
	}
	if (phase === "commit") {
		assertCloudflarePublishQueueDeadline_(60000, "active commit preparation");
		const manifest = readCloudflareTargetManifest_(versionId);
		const required = [
			{ scope: "public", path: "activeVersions/" + encodedVersionId + "/manifest" },
			{ scope: "public", path: "activeVersions/" + encodedVersionId + "/rosters" },
			{ scope: "public", path: "activeVersions/" + encodedVersionId + "/playerMetrics" },
			{ scope: "bot", path: "activeVersions/" + encodedVersionId + "/active" },
			{ scope: "bot", path: "activeVersions/" + encodedVersionId + "/playerMetrics/byTag" },
			{ scope: "bot", path: "activeVersions/" + encodedVersionId + "/indexes/linkedAccountsByDiscordId" },
			{ scope: "bot", path: "activeVersions/" + encodedVersionId + "/indexes/linkedAccountsByDiscordUsername" },
		];
		verifyCloudflareActiveVersionObjects_(versionId, required);
		const bootstrap = buildCloudflareQueuedBootstrapCommit_(state, versionId, manifest);
		const selector = buildCloudflareCommittedVersionSelector_(state, versionId);
		return { label: "active-atomic-pointer-commit", request: { batchId: "active:" + versionId + ":commit", commits: [
			// The selector is the authoritative cross-scope commit. Publish it
			// first; legacy pointers follow only for rollout compatibility.
			makeCloudflareQueueObject_(FIREBASE_ACTIVE_PUBLISHED_CURRENT_SELECTOR_PATH, selector, "public"),
			makeCloudflareQueueObject_("activePublished/currentManifest", manifest, "public"),
			bootstrap && makeCloudflareQueueObject_(bootstrap.path, bootstrap.payload, "public"),
			makeCloudflareQueueObject_("activePublished/currentVersionId", versionId, "public"),
			makeCloudflareQueueObject_("active/currentVersionId", versionId, "bot"),
		], commitGuard: { kind: "active", generation: state.active.targetGeneration, targetVersionId: versionId } } };
	}
	throw new Error("Unknown active publication phase: " + phase);
}

function firstCloudflareDirtyWork_(stateRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	if (state.dirty.repair) {
		const repair = state.dirty.repair;
		return Object.assign({
			category: "repair",
			revision: repair.revision,
			step: repair.step,
			seasonIndex: repair.seasonIndex,
			eventIndex: repair.eventIndex,
			donationIndex: repair.donationIndex,
			seasonIds: repair.seasonIds,
			eventIds: repair.eventIds,
			donationSeasonIds: repair.donationSeasonIds,
		}, { dispatchKey: cloudflareRepairDispatchKey_(repair) });
	}
	const eventIds = Object.keys(state.dirty.events).sort();
	if (eventIds.length) return { category: "event", key: eventIds[0], revision: state.dirty.events[eventIds[0]].revision };
	const aggregateEventIds = Object.keys(state.dirty.cwlAggregates).sort();
	for (let i = 0; i < aggregateEventIds.length; i++) {
		const eventId = aggregateEventIds[i];
		const kinds = state.dirty.cwlAggregates[eventId] || {};
		if (kinds.live) return { category: "cwlAggregate", key: eventId, kind: "live", revision: kinds.live.revision };
		if (kinds.final) return { category: "cwlAggregate", key: eventId, kind: "final", revision: kinds.final.revision };
	}
	const donationIds = Object.keys(state.dirty.donationSeasons).sort();
	if (donationIds.length) return { category: "donationSeason", key: donationIds[0], revision: state.dirty.donationSeasons[donationIds[0]].revision };
	if (state.dirty.cwlLeagueSignups) return { category: "cwlLeagueSignups", revision: state.dirty.cwlLeagueSignups.revision };
	if (state.dirty.seasonPointers) return { category: "seasonPointers", revision: state.dirty.seasonPointers.revision };
	if (state.dirty.bootstrap) return { category: "bootstrap", revision: state.dirty.bootstrap.revision };
	return null;
}

function cloudflareRepairDispatchKey_(repairRaw) {
	const repair = repairRaw && typeof repairRaw === "object" ? repairRaw : {};
	return [repair.revision, repair.step, repair.seasonIndex, repair.eventIndex, repair.donationIndex, (repair.eventIds || [])[repair.eventIndex] || ""].join(":");
}

function discoverCloudflareRepairContext_(workRaw) {
	const work = workRaw && typeof workRaw === "object" ? workRaw : {};
	const currentState = readDecodedCloudflareQueueObject_(SEASON_EVENTS_SEASON_STATE_CURRENT_PATH) || {};
	const currentSeasonId = String(currentState.seasonId || "").trim();
	let previousSeasonId = "";
	if (currentSeasonId && typeof resolveLegendIRankedSeasonCycle_ === "function") {
		const startsAtMs = parseIsoToMs_(currentState.startsAt);
		if (startsAtMs > 0) {
			try { previousSeasonId = String(resolveLegendIRankedSeasonCycle_(startsAtMs - 1).seasonId || "").trim(); } catch (err) { previousSeasonId = ""; }
		}
	}
	const seasonIds = [currentSeasonId, previousSeasonId].filter((id, index, all) => id && all.indexOf(id) === index);
	const eventIds = {};
	const donationSeasonIds = {};
	for (let i = 0; i < seasonIds.length; i++) {
		const seasonPath = buildFirebaseChildPath_(SEASON_EVENTS_BY_SEASON_PATH, encodeFirebaseObjectKey_(seasonIds[i]));
		const seasonPointers = readDecodedCloudflareQueueObject_(seasonPath) || {};
		collectCloudflareSeasonEventIdsFromPointerMap_(seasonPointers, eventIds);
		const pointerKeys = Object.keys(seasonPointers || {});
		for (let j = 0; j < pointerKeys.length; j++) {
			const pointer = seasonPointers[pointerKeys[j]];
			const donationSeasonId = pointer && typeof pointer === "object" ? String(pointer.seasonId || "").trim() : "";
			if (donationSeasonId) donationSeasonIds[donationSeasonId] = true;
		}
	}
	const currentCwl = readDecodedCloudflareQueueObject_(SEASON_EVENTS_CURRENT_CWL_PATH);
	const latestCompletedCwl = readDecodedCloudflareQueueObject_(SEASON_EVENTS_LATEST_COMPLETED_CWL_PATH);
	collectCloudflareSeasonEventIdsFromPointerMap_({ currentCwl: currentCwl }, eventIds);
	collectCloudflareSeasonEventIdsFromPointerMap_({ latestCompletedCwl: latestCompletedCwl }, eventIds);
	if (currentSeasonId) donationSeasonIds[currentSeasonId] = true;
	return {
		seasonIds: seasonIds,
		eventIds: Object.keys(eventIds).sort(),
		donationSeasonIds: Object.keys(donationSeasonIds).sort(),
		step: "events",
		seasonIndex: 0,
		eventIndex: 0,
		donationIndex: 0,
	};
}

function buildCloudflareTargetedRepairRequest_(workRaw) {
	const work = workRaw && typeof workRaw === "object" ? workRaw : {};
	const discovered = work.step === "discover" || !Array.isArray(work.eventIds) || !work.eventIds.length && !Array.isArray(work.seasonIds)
		? discoverCloudflareRepairContext_(work)
		: {
			step: work.step || "events", seasonIds: Array.isArray(work.seasonIds) ? work.seasonIds : [],
			eventIds: Array.isArray(work.eventIds) ? work.eventIds : [],
			donationSeasonIds: Array.isArray(work.donationSeasonIds) ? work.donationSeasonIds : [],
			seasonIndex: Math.max(0, toNonNegativeInt_(work.seasonIndex)),
			eventIndex: Math.max(0, toNonNegativeInt_(work.eventIndex)),
			donationIndex: Math.max(0, toNonNegativeInt_(work.donationIndex)),
		};
	const commits = [];
	const objects = [];
	if (discovered.step === "events" && discovered.eventIndex >= discovered.eventIds.length) discovered.step = "season-maps";
	if (discovered.step === "season-maps" && discovered.seasonIndex >= discovered.seasonIds.length) discovered.step = "donations";
	if (discovered.step === "donations" && discovered.donationIndex >= discovered.donationSeasonIds.length) discovered.step = "pointers";
	const addPointer = (path, scope) => {
		const value = readDecodedCloudflareQueueObject_(path);
		const scopes = scope ? [scope] : ["public", "bot"];
		for (let i = 0; i < scopes.length; i++) {
			if (value == null) commits.push({ path: normalizeCloudflareDataObjectPath_(path), scope: scopes[i], delete: true });
			else commits.push(makeCloudflareQueueObject_(path, value, scopes[i]));
		}
	};
	let repairAdvance = null;
	if (discovered.step === "events" && discovered.eventIndex < discovered.eventIds.length) {
		const eventId = discovered.eventIds[discovered.eventIndex];
		const event = readSeasonEventById_(eventId);
		if (!event) { const error = new Error("Referenced season event is missing: " + eventId); error.resumable = true; throw error; }
		addCloudflareMirroredQueueObject_(objects, buildFirebaseChildPath_(SEASON_EVENTS_BY_ID_PATH, encodeFirebaseObjectKey_(eventId)), event);
		if (normalizeSeasonEventType_(event.type) === "cwl" && typeof readCwlSeasonEventAggregate_ === "function") {
			["live", "final"].forEach((kind) => {
				const aggregate = readCwlSeasonEventAggregate_(eventId, kind);
				if (aggregate && aggregate.eventId) addCloudflareMirroredQueueObject_(objects, buildCwlSeasonEventAggregatePath_(eventId, kind), projectCloudflareCwlAggregateForEvent_(event, aggregate, kind));
			});
		}
		repairAdvance = Object.assign({}, discovered, {
			eventIndex: discovered.eventIndex + 1,
			step: discovered.eventIndex + 1 >= discovered.eventIds.length ? "season-maps" : "events",
		});
	} else if (discovered.step === "season-maps" && discovered.seasonIndex < discovered.seasonIds.length) {
		const seasonId = discovered.seasonIds[discovered.seasonIndex];
		const seasonPath = buildFirebaseChildPath_(SEASON_EVENTS_BY_SEASON_PATH, encodeFirebaseObjectKey_(seasonId));
		const seasonPointers = readDecodedCloudflareQueueObject_(seasonPath);
		if (!seasonPointers) { const error = new Error("Referenced season pointer map is missing: " + seasonId); error.resumable = true; throw error; }
		addCloudflareMirroredQueueObject_(objects, seasonPath, seasonPointers);
		repairAdvance = Object.assign({}, discovered, {
			seasonIndex: discovered.seasonIndex + 1,
			step: discovered.seasonIndex + 1 >= discovered.seasonIds.length ? "donations" : "season-maps",
		});
	} else if (discovered.step === "donations" && discovered.donationIndex < discovered.donationSeasonIds.length) {
		const seasonId = discovered.donationSeasonIds[discovered.donationIndex];
		const overlayPath = buildFirebaseChildPath_(buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "bySeason"), encodeFirebaseObjectKey_(seasonId));
		const overlay = readDecodedCloudflareQueueObject_(overlayPath);
		if (!overlay) { const error = new Error("Referenced donation overlay is missing: " + seasonId); error.resumable = true; throw error; }
		addCloudflareMirroredQueueObject_(objects, overlayPath, overlay);
		repairAdvance = Object.assign({}, discovered, {
			donationIndex: discovered.donationIndex + 1,
			step: discovered.donationIndex + 1 >= discovered.donationSeasonIds.length ? "pointers" : "donations",
		});
	} else if (discovered.step === "pointers" || (discovered.step === "season-maps" && !discovered.seasonIds.length) || (discovered.step === "donations" && discovered.donationIndex >= discovered.donationSeasonIds.length)) {
		// Season and CWL pointers are read by both website and bot consumers;
		// mirror them together only after the referenced objects/aggregates have
		// completed their earlier repair phases. CWL signup data remains bot-only
		// in its dedicated dirty category.
		[SEASON_EVENTS_CURRENT_PATH, SEASON_EVENTS_CURRENT_CWL_PATH, SEASON_EVENTS_LATEST_COMPLETED_CWL_PATH, SEASON_EVENTS_SEASON_STATE_CURRENT_PATH].forEach((path) => addPointer(path));
		const currentDonationPath = buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "current");
		const donationCurrent = readDecodedCloudflareQueueObject_(currentDonationPath);
		if (donationCurrent) {
			commits.push(makeCloudflareQueueObject_(currentDonationPath, donationCurrent, "public"));
			commits.push(makeCloudflareQueueObject_(currentDonationPath, donationCurrent, "bot"));
		} else addCloudflareMirroredQueueCommitDelete_(commits, currentDonationPath);
		repairAdvance = Object.assign({}, discovered, { step: "done" });
	}
	return { objects: objects, deletes: [], commits: commits, repairAdvance: repairAdvance };
}

function buildCloudflareDirtyRequest_(stateRaw, workRaw) {
	const work = workRaw && typeof workRaw === "object" ? workRaw : {};
	const objects = [];
	const deletes = [];
	const commits = [];
	if (work.category === "repair") return buildCloudflareTargetedRepairRequest_(work);
	if (work.category === "event") {
		const event = readSeasonEventById_(work.key);
		const path = buildFirebaseChildPath_(SEASON_EVENTS_BY_ID_PATH, encodeFirebaseObjectKey_(work.key));
		if (event) addCloudflareMirroredQueueObject_(objects, path, event); else addCloudflareMirroredQueueDelete_(deletes, path);
	} else if (work.category === "cwlAggregate") {
		const event = readSeasonEventById_(work.key);
		const aggregate = readCwlSeasonEventAggregate_(work.key, work.kind);
		const path = buildCwlSeasonEventAggregatePath_(work.key, work.kind);
		if (aggregate && aggregate.eventId) addCloudflareMirroredQueueObject_(objects, path, projectCloudflareCwlAggregateForEvent_(event, aggregate, work.kind)); else addCloudflareMirroredQueueDelete_(deletes, path);
	} else if (work.category === "donationSeason") {
		const path = buildFirebaseChildPath_(buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "bySeason"), encodeFirebaseObjectKey_(work.key));
		const overlay = readDecodedCloudflareQueueObject_(path);
		if (overlay) addCloudflareMirroredQueueObject_(objects, path, overlay); else addCloudflareMirroredQueueDelete_(deletes, path);
		const currentPath = buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "current");
		const current = readDecodedCloudflareQueueObject_(currentPath);
		if (current) {
			commits.push(makeCloudflareQueueObject_(currentPath, current, "public"));
			commits.push(makeCloudflareQueueObject_(currentPath, current, "bot"));
		} else addCloudflareMirroredQueueCommitDelete_(commits, currentPath);
	} else if (work.category === "cwlLeagueSignups") {
		const signup = readActiveCwlLeagueSignups_();
		if (signup) objects.push(makeCloudflareQueueObject_(CWL_LEAGUE_SIGNUPS_ACTIVE_PATH, signup, "bot")); else deletes.push({ path: normalizeCloudflareDataObjectPath_(CWL_LEAGUE_SIGNUPS_ACTIVE_PATH), scope: "bot" });
	} else if (work.category === "seasonPointers") {
		[SEASON_EVENTS_CURRENT_PATH, SEASON_EVENTS_CURRENT_CWL_PATH, SEASON_EVENTS_LATEST_COMPLETED_CWL_PATH, SEASON_EVENTS_SEASON_STATE_CURRENT_PATH].forEach((path) => {
			const value = readDecodedCloudflareQueueObject_(path);
			if (value == null) addCloudflareMirroredQueueCommitDelete_(commits, path);
			else { commits.push(makeCloudflareQueueObject_(path, value, "public")); commits.push(makeCloudflareQueueObject_(path, value, "bot")); }
		});
	} else if (work.category === "bootstrap") {
		const bootstrap = buildCloudflareQueuedBootstrapCommit_(stateRaw);
		commits.push(makeCloudflareQueueObject_(bootstrap.path, bootstrap.payload, "public"));
	}
	return { objects: objects, deletes: deletes, commits: commits };
}

function clearCloudflareDirtyWorkIfRevisionMatches_(state, workRaw) {
	const work = workRaw && typeof workRaw === "object" ? workRaw : {};
	const revision = Math.max(0, toNonNegativeInt_(work.revision));
	if (work.category === "event") { if (state.dirty.events[work.key] && toNonNegativeInt_(state.dirty.events[work.key].revision) === revision) delete state.dirty.events[work.key]; }
	else if (work.category === "cwlAggregate") { const kinds = state.dirty.cwlAggregates[work.key]; if (kinds && kinds[work.kind] && toNonNegativeInt_(kinds[work.kind].revision) === revision) delete kinds[work.kind]; if (kinds && !Object.keys(kinds).length) delete state.dirty.cwlAggregates[work.key]; }
	else if (work.category === "donationSeason") { if (state.dirty.donationSeasons[work.key] && toNonNegativeInt_(state.dirty.donationSeasons[work.key].revision) === revision) delete state.dirty.donationSeasons[work.key]; }
	else if (work.category === "cwlLeagueSignups") { if (state.dirty.cwlLeagueSignups && toNonNegativeInt_(state.dirty.cwlLeagueSignups.revision) === revision) state.dirty.cwlLeagueSignups = null; }
	else if (work.category === "seasonPointers") { if (state.dirty.seasonPointers && toNonNegativeInt_(state.dirty.seasonPointers.revision) === revision) state.dirty.seasonPointers = null; }
	else if (work.category === "bootstrap") { if (state.dirty.bootstrap && toNonNegativeInt_(state.dirty.bootstrap.revision) === revision) state.dirty.bootstrap = null; }
	else if (work.category === "repair") {
		if (state.dirty.repair && toNonNegativeInt_(state.dirty.repair.revision) === revision) {
			const advance = work.repairAdvance && typeof work.repairAdvance === "object" ? work.repairAdvance : null;
			if (!advance || advance.step === "done") state.dirty.repair = null;
			else state.dirty.repair = Object.assign({}, state.dirty.repair, {
				step: advance.step,
				seasonIndex: Math.max(0, toNonNegativeInt_(advance.seasonIndex)),
				eventIndex: Math.max(0, toNonNegativeInt_(advance.eventIndex)),
				donationIndex: Math.max(0, toNonNegativeInt_(advance.donationIndex)),
				seasonIds: Array.isArray(advance.seasonIds) ? advance.seasonIds.slice() : [],
				eventIds: Array.isArray(advance.eventIds) ? advance.eventIds.slice() : [],
				donationSeasonIds: Array.isArray(advance.donationSeasonIds) ? advance.donationSeasonIds.slice() : [],
				updatedAt: new Date().toISOString(),
			});
		}
	}
}

function resetCloudflareQueueRetry_(state, batchRaw) {
	state.retry = { attempt: 0, nextAttemptAt: "", lastError: "", lastFailureAt: "", permanent: false };
	state.lastSuccessAt = new Date().toISOString();
	state.lastBatch = batchRaw && typeof batchRaw === "object" ? batchRaw : null;
}

function recordCloudflareQueueFailure_(messageRaw, batchRaw, ownerTokenRaw) {
	const message = String(messageRaw || "Cloudflare publication failed.").slice(0, 2000);
	const permanent = /cannot fit|hard limit|payload limit|roster count exceeds/i.test(message);
	return mutateCloudflarePublishQueueState_(function (state) {
		const attempt = Math.max(0, toNonNegativeInt_(state.retry.attempt)) + 1;
		const delay = Math.min(CLOUDFLARE_PUBLISH_QUEUE_MAX_RETRY_MS, CLOUDFLARE_PUBLISH_QUEUE_BASE_RETRY_MS * Math.pow(2, Math.min(10, attempt - 1)));
		state.retry.attempt = attempt;
		state.retry.nextAttemptAt = permanent ? "" : new Date(Date.now() + delay).toISOString();
		state.retry.lastError = message;
		state.retry.lastFailureAt = new Date().toISOString();
		state.retry.permanent = permanent;
		if (permanent) state.paused = true;
		state.lastBatch = batchRaw && typeof batchRaw === "object" ? batchRaw : null;
		return { attempt: attempt, nextAttemptAt: state.retry.nextAttemptAt, permanent: permanent, pending: !permanent || hasPendingCloudflarePublishWork_(state) };
	}, ownerTokenRaw);
}

function allocateCloudflarePhaseClaim_(stateRaw, workRaw, ownerTokenRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	const work = workRaw && typeof workRaw === "object" ? workRaw : null;
	return mutateCloudflarePublishQueueState_(function (latest) {
		if (work && work.category === "active") {
			if (latest.active.targetVersionId !== state.active.targetVersionId || latest.active.targetGeneration !== state.active.targetGeneration) return { stale: true };
			const phase = latest.active.phase;
			const cursor = latest.active.cursor;
			const existing = latest.active.dispatch;
			if (existing && existing.phase === phase && existing.cursor === cursor && existing.generation === latest.active.targetGeneration) return { category: "active", phase: phase, cursor: cursor, targetVersionId: latest.active.targetVersionId, generation: latest.active.targetGeneration, dispatchGuard: existing.guard };
			latest.nextDispatchGeneration = Math.max(Math.max(0, toNonNegativeInt_(latest.nextDispatchGeneration)) + 1, Date.now());
			const batchId = "active:" + latest.active.targetVersionId + ":" + phase + ":" + cursor;
			const guard = { kind: "queued-v2", generation: latest.nextDispatchGeneration, batchId: batchId };
			latest.active.dispatch = { phase: phase, cursor: cursor, generation: latest.active.targetGeneration, guard: guard };
			return { category: "active", phase: phase, cursor: cursor, targetVersionId: latest.active.targetVersionId, generation: latest.active.targetGeneration, dispatchGuard: guard };
		}
		if (!work) return { stale: true };
		const marker = latest.dirty[work.category === "repair" ? "repair" : work.category === "event" ? "events" : work.category === "cwlAggregate" ? "cwlAggregates" : work.category === "donationSeason" ? "donationSeasons" : work.category === "cwlLeagueSignups" ? "cwlLeagueSignups" : work.category === "seasonPointers" ? "seasonPointers" : "bootstrap"];
		const currentMarker = work.category === "event" ? marker && marker[work.key] : work.category === "cwlAggregate" ? marker && marker[work.key] && marker[work.key][work.kind] : marker;
		if (!currentMarker || toNonNegativeInt_(currentMarker.revision) !== toNonNegativeInt_(work.revision)) return { stale: true };
		const dispatchKey = work.category === "repair" ? cloudflareRepairDispatchKey_(work) : String(work.cursor || 0);
		if (currentMarker.dispatch && currentMarker.dispatch.revision === work.revision && currentMarker.dispatch.key === dispatchKey) return Object.assign({}, work, { dispatchGuard: currentMarker.dispatch.guard });
		latest.nextDispatchGeneration = Math.max(Math.max(0, toNonNegativeInt_(latest.nextDispatchGeneration)) + 1, Date.now());
		const batchId = work.category + ":" + String(work.key || work.kind || "current") + ":" + work.revision + ":" + String(work.cursor || 0);
		const guard = { kind: "queued-v2", generation: latest.nextDispatchGeneration, batchId: batchId };
		currentMarker.dispatch = { revision: work.revision, cursor: toNonNegativeInt_(work.cursor), key: dispatchKey, guard: guard };
		return Object.assign({}, work, { dispatchGuard: guard });
	}, ownerTokenRaw);
}

function completeCloudflareActivePhase_(claimRaw, sentRaw, ownerTokenRaw) {
	const claim = claimRaw && typeof claimRaw === "object" ? claimRaw : {};
	return mutateCloudflarePublishQueueState_(function (state) {
		if (state.active.targetVersionId !== claim.targetVersionId || state.active.targetGeneration !== claim.generation || state.active.phase !== claim.phase || state.active.cursor !== claim.cursor) return { stale: true, pending: hasPendingCloudflarePublishWork_(state) };
		state.active.dispatch = null;
		if (claim.phase === "public-manifest-rosters") state.active.phase = "public-player-metrics";
		else if (claim.phase === "public-player-metrics") state.active.phase = "bot-active";
		else if (claim.phase === "bot-active") state.active.phase = "bot-derived";
		else if (claim.phase === "bot-derived") state.active.phase = "commit";
		else if (claim.phase === "commit") {
			state.active.committedVersionId = claim.targetVersionId;
			state.active.phase = "idle";
			state.active.cursor = 0;
			state.active.republish = false;
		}
		state.active.updatedAt = new Date().toISOString();
		state.active.activeBurst = Math.max(0, toNonNegativeInt_(state.active.activeBurst)) + 1;
		resetCloudflareQueueRetry_(state, { category: "active", phase: claim.phase, targetVersionId: claim.targetVersionId, response: sentRaw && sentRaw.response });
		return { ok: true, category: "active", phase: claim.phase, pending: hasPendingCloudflarePublishWork_(state), nextAttemptAt: state.retry.nextAttemptAt };
	}, ownerTokenRaw);
}

function completeCloudflareDirtyPhase_(claimRaw, sentRaw, ownerTokenRaw) {
	const claim = claimRaw && typeof claimRaw === "object" ? claimRaw : {};
	return mutateCloudflarePublishQueueState_(function (state) {
		const current = firstCloudflareDirtyWork_(state);
		if (!current || current.category !== claim.category || toNonNegativeInt_(current.revision) !== toNonNegativeInt_(claim.revision) || (claim.category === "repair" && current.dispatchKey !== claim.dispatchKey)) return { stale: true, pending: hasPendingCloudflarePublishWork_(state) };
		clearCloudflareDirtyWorkIfRevisionMatches_(state, claim);
		state.active.activeBurst = 0;
		resetCloudflareQueueRetry_(state, { category: claim.category, revision: claim.revision, cursor: claim.cursor, response: sentRaw && sentRaw.response });
		return { ok: true, category: claim.category, pending: hasPendingCloudflarePublishWork_(state), nextAttemptAt: state.retry.nextAttemptAt };
	}, ownerTokenRaw);
}

function cloudflareActiveClaimMatchesState_(stateRaw, claimRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	const claim = claimRaw && typeof claimRaw === "object" ? claimRaw : {};
	const dispatch = state.active.dispatch && typeof state.active.dispatch === "object" ? state.active.dispatch : null;
	return state.active.targetVersionId === claim.targetVersionId &&
		state.active.targetGeneration === claim.generation &&
		state.active.phase === claim.phase &&
		state.active.cursor === claim.cursor &&
		!!dispatch && dispatch.generation === claim.generation &&
		dispatch.guard && dispatch.guard.batchId === claim.dispatchGuard.batchId;
}

// The final active request is allowed to publish only after a fresh
// owner-checked canonical read. Enqueueing a newer target clears the dispatch
// claim, so a superseded request becomes resumable before it reaches Worker.
function isCloudflareActiveCommitClaimCurrent_(claimRaw, ownerTokenRaw) {
	if (ownerTokenRaw) renewCloudflarePublishQueueLeaseOrThrow_(ownerTokenRaw);
	const latest = readCloudflarePublishQueueState_();
	if (!cloudflareActiveClaimMatchesState_(latest, claimRaw)) return false;
	if (ownerTokenRaw) renewCloudflarePublishQueueLeaseOrThrow_(ownerTokenRaw);
	return true;
}

function processCloudflareActiveQueueRequest_(stateRaw, ownerTokenRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	const claim = allocateCloudflarePhaseClaim_(state, { category: "active" }, ownerTokenRaw);
	if (!claim || claim.stale) return { ok: true, skipped: true, reason: "superseded" };
	const built = buildCloudflareActivePhaseRequest_(state, claim);
	const request = Object.assign({}, built.request, { dispatchGuard: claim.dispatchGuard, revision: claim.generation });
	request.batchId = claim.dispatchGuard.batchId;
	if (claim.phase === "commit") request.commitGuard = { kind: "active", generation: claim.generation, targetVersionId: claim.targetVersionId };
	if (claim.phase === "commit" && !isCloudflareActiveCommitClaimCurrent_(claim, ownerTokenRaw)) {
		return { ok: true, skipped: true, reason: "superseded" };
	}
	if (ownerTokenRaw) renewCloudflarePublishQueueLeaseOrThrow_(ownerTokenRaw);
	const sent = sendCloudflareQueuedV2Request_(request, built.label, ownerTokenRaw);
	return completeCloudflareActivePhase_(claim, sent, ownerTokenRaw);
}

function processCloudflareDirtyQueueRequest_(stateRaw, ownerTokenRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	const work = firstCloudflareDirtyWork_(state);
	if (!work) return { ok: true, skipped: true, reason: "empty" };
	const claim = allocateCloudflarePhaseClaim_(state, work, ownerTokenRaw);
	if (!claim || claim.stale) return { ok: true, skipped: true, reason: "superseded" };
	const built = buildCloudflareDirtyRequest_(state, claim);
	const request = Object.assign({}, built, { dispatchGuard: claim.dispatchGuard, revision: claim.revision, batchId: claim.dispatchGuard.batchId });
	if (claim.category === "repair") {
		claim.repairAdvance = built.repairAdvance || null;
		delete request.repairAdvance;
	}
	if (ownerTokenRaw) renewCloudflarePublishQueueLeaseOrThrow_(ownerTokenRaw);
	const sent = sendCloudflareQueuedV2Request_(request, built.label || claim.category, ownerTokenRaw);
	return completeCloudflareDirtyPhase_(claim, sent, ownerTokenRaw);
}

function markCloudflarePublishQueueReconstructionDirty_(state, reasonRaw, canonicalVersionIdRaw) {
	const canonicalVersionId = normalizeActiveVersionId_(canonicalVersionIdRaw);
	if (canonicalVersionId && state.active.targetVersionId !== canonicalVersionId && state.active.committedVersionId !== canonicalVersionId) {
		state.active.targetVersionId = canonicalVersionId;
		state.active.targetGeneration = Math.max(Math.max(0, toNonNegativeInt_(state.active.targetGeneration)) + 1, Date.now());
		state.active.phase = "public-manifest-rosters";
		state.active.cursor = 0;
		state.active.dispatch = null;
	}
	state.dirty.repair = makeCloudflareDirtyRevision_(state, reasonRaw || "drift-repair", {
		category: "repair", step: "discover", seasonIndex: 0, eventIndex: 0, donationIndex: 0,
		seasonIds: [], eventIds: [], donationSeasonIds: [],
	});
	state.dirty.cwlLeagueSignups = makeCloudflareDirtyRevision_(state, reasonRaw || "drift-repair", { category: "cwlLeagueSignups" });
	state.lastDriftRepairAt = new Date().toISOString();
	return { active: canonicalVersionId ? { ok: true, versionId: canonicalVersionId } : { ok: true, skipped: true, reason: "missing-canonical-version" }, repair: { ok: true, category: "repair" }, signups: { ok: true, category: "cwlLeagueSignups" } };
}

function repairCloudflarePublishQueueDrift_(ownerTokenRaw, canonicalVersionOverrideRaw) {
	if (!isCloudflareQueuedPublicationEnabled_()) return { ok: false, skipped: true, reason: "disabled" };
	const canonicalVersionId = normalizeActiveVersionId_(canonicalVersionOverrideRaw) || readPublishedActiveVersionId_();
	try {
		const result = mutateCloudflarePublishQueueState_(function (state) { return markCloudflarePublishQueueReconstructionDirty_(state, "drift-repair", canonicalVersionId); }, ownerTokenRaw);
		const scheduled = scheduleCloudflareAfterMutation_({ pending: true });
		return { ok: true, active: result.active, repair: result.repair, signups: result.signups, scheduled: scheduled };
	} catch (err) { return { ok: false, error: errorMessage_(err) }; }
}

function cloudflarePublishWorkerTick() {
	const startedAtMs = Date.now();
	const lease = tryAcquireCloudflarePublishQueueLease_("cloudflare-publish-worker", 0);
	// This branch is intentionally before every Firebase, Cloudflare, trigger,
	// and scheduling operation.
	if (!lease) return { skipped: true, reason: "lease-busy" };
	cloudflarePublishQueueDeadlineMs_ = startedAtMs + cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_EXECUTION_BUDGET_MS", 240000);
	let finalPendingKnown = true;
	let result = null;
	try {
		if (!isCloudflareQueuedPublicationEnabled_()) { finalPendingKnown = false; removeCloudflarePublishWorkerTriggers_(false); return { ok: true, skipped: true, reason: "disabled" }; }
		// Recovery is installed from local trigger state before the first remote
		// read. It protects a hard-killed owner without reading queue state.
		scheduleCloudflarePublishWorkerRecovery_(true);
		let state = readCloudflarePublishQueueState_();
		if (state.paused) { finalPendingKnown = false; removeCloudflarePublishWorkerTriggers_(false); return { ok: true, skipped: true, reason: "paused" }; }
		if (state.retry.permanent) { finalPendingKnown = false; removeCloudflarePublishWorkerTriggers_(false); return { ok: false, skipped: true, reason: "permanent-size-failure", error: state.retry.lastError }; }
		if (parseIsoToMs_(state.retry.nextAttemptAt) > Date.now()) {
			finalPendingKnown = hasPendingCloudflarePublishWork_(state);
			scheduleCloudflarePublishWorker_(lease.token, finalPendingKnown, state.retry.nextAttemptAt);
			return { ok: true, skipped: true, reason: "backoff", nextAttemptAt: state.retry.nextAttemptAt };
		}
		if (!hasPendingCloudflarePublishWork_(state)) {
			const driftAge = Date.now() - parseIsoToMs_(state.lastDriftRepairAt);
			if (!state.lastDriftRepairAt || driftAge > 6 * 60 * 60 * 1000) {
				const repair = repairCloudflarePublishQueueDrift_(lease.token);
				if (repair && repair.ok) state = readCloudflarePublishQueueState_();
			}
		}
		if (!hasPendingCloudflarePublishWork_(state)) { finalPendingKnown = false; removeCloudflarePublishWorkerTriggers_(false); return { ok: true, pending: false, results: [] }; }
		const activePending = state.active.targetVersionId && (state.active.targetVersionId !== state.active.committedVersionId || state.active.republish || state.active.phase !== "idle");
		const dirty = firstCloudflareDirtyWork_(state);
		const dirtyEligible = dirty && (!activePending || state.active.phase === "commit" || state.active.activeBurst >= cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_MAX_ACTIVE_BURST_BEFORE_DIRTY", 3));
		if (dirtyEligible && state.active.phase !== "commit") result = processCloudflareDirtyQueueRequest_(state, lease.token);
		else if (activePending) result = processCloudflareActiveQueueRequest_(state, lease.token);
		else result = processCloudflareDirtyQueueRequest_(state, lease.token);
		state = readCloudflarePublishQueueState_();
		finalPendingKnown = hasPendingCloudflarePublishWork_(state);
		if (finalPendingKnown) scheduleCloudflarePublishWorker_(lease.token, true, state.retry.nextAttemptAt);
		else removeCloudflarePublishWorkerTriggers_(false);
		return { ok: !result || result.ok !== false, results: result ? [result] : [], pending: finalPendingKnown };
	} catch (err) {
		if (err && err.code === "CLOUDFLARE_QUEUE_LEASE_LOST") return { ok: false, skipped: true, reason: "lease-lost", error: errorMessage_(err) };
		let retry = null;
		try { retry = recordCloudflareQueueFailure_(errorMessage_(err), { error: errorMessage_(err) }, lease.token); } catch (recordErr) {
			if (recordErr && recordErr.code === "CLOUDFLARE_QUEUE_LEASE_LOST") throw recordErr;
			Logger.log("Cloudflare publish retry state could not be updated: %s", errorMessage_(recordErr));
		}
		finalPendingKnown = true;
		try { scheduleCloudflarePublishWorker_(lease.token, true, retry && retry.nextAttemptAt); } catch (scheduleErr) { Logger.log("Cloudflare continuation scheduling failed: %s", errorMessage_(scheduleErr)); }
		return { ok: false, error: errorMessage_(err), retry: retry, pending: true, result: result };
	} finally {
		// No Firebase read, Cloudflare request, trigger enumeration, or watchdog
		// reconciliation is allowed from finally. Lease release is local only.
		releaseCloudflarePublishQueueLease_(lease.token);
		cloudflarePublishQueueDeadlineMs_ = 0;
	}
}

function getCloudflarePublishQueueDiagnostics_() {
	const state = readCloudflarePublishQueueState_();
	const dirty = state.dirty;
	const ages = [];
	const addAge = (item) => { const ms = parseIsoToMs_(item && item.updatedAt); if (ms) ages.push(ms); };
	Object.keys(dirty.events).forEach((key) => addAge(dirty.events[key]));
	Object.keys(dirty.cwlAggregates).forEach((key) => { addAge(dirty.cwlAggregates[key].live); addAge(dirty.cwlAggregates[key].final); });
	Object.keys(dirty.donationSeasons).forEach((key) => addAge(dirty.donationSeasons[key]));
	addAge(dirty.cwlLeagueSignups); addAge(dirty.seasonPointers); addAge(dirty.repair); addAge(dirty.bootstrap);
	const oldest = ages.length ? Math.min.apply(Math, ages) : 0;
	const props = PropertiesService.getScriptProperties();
	const lease = parseCloudflarePublishQueueLockState_(props.getProperty(CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY));
	return {
		mode: getCloudflarePublicationMode_(), paused: state.paused,
		canonicalActiveVersionId: readPublishedActiveVersionId_(), committedActiveVersionId: state.active.committedVersionId,
		activeTargetVersionId: state.active.targetVersionId, activeTargetGeneration: state.active.targetGeneration,
		activePhase: state.active.phase, activeCursor: state.active.cursor,
		pendingDirtyCounts: { events: Object.keys(dirty.events).length, cwlAggregateEvents: Object.keys(dirty.cwlAggregates).length, donationSeasons: Object.keys(dirty.donationSeasons).length, cwlLeagueSignups: dirty.cwlLeagueSignups ? 1 : 0, seasonPointers: dirty.seasonPointers ? 1 : 0, repair: dirty.repair ? 1 : 0, bootstrap: dirty.bootstrap ? 1 : 0 },
		oldestPendingAt: oldest ? new Date(oldest).toISOString() : "", retryAttempt: state.retry.attempt, nextRetryAt: state.retry.nextAttemptAt, lastError: state.retry.lastError, permanentFailure: state.retry.permanent === true, lastSuccessAt: state.lastSuccessAt, lastBatch: state.lastBatch,
		triggerId: getCloudflareTriggerId_(CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_ID_PROPERTY), hasTrigger: !!getCloudflareTriggerId_(CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_ID_PROPERTY), triggerAt: getCloudflareTriggerAtMs_(CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_AT_PROPERTY) ? new Date(getCloudflareTriggerAtMs_(CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_AT_PROPERTY)).toISOString() : "",
		lease: lease ? { owner: lease.owner, expiresAt: new Date(lease.expiresAt).toISOString() } : null,
	};
}

function initializeCloudflarePublishQueue_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	let committed = normalizeActiveVersionId_(options.committedVersionId);
	const canonical = committed || readPublishedActiveVersionId_();
	if (!committed && canonical && typeof verifyCloudflarePublicActiveVersionId_ === "function") {
		const verified = verifyCloudflarePublicActiveVersionId_(canonical);
		if (verified && verified.ok === true) committed = normalizeActiveVersionId_(verified.actualVersionId || canonical);
	}
	const result = mutateCloudflarePublishQueueState_(function (state) {
		if (committed) state.active.committedVersionId = committed;
		if (committed) markCloudflarePublishQueueReconstructionDirty_(state, "queue-initialization", canonical);
		if (!state.initializedAt) state.initializedAt = new Date().toISOString();
		return { pending: hasPendingCloudflarePublishWork_(state), committedVersionId: committed };
	});
	if (isCloudflareQueuedPublicationEnabled_()) scheduleCloudflareAfterMutation_(result);
	return { ok: true, committedVersionId: committed, diagnostics: getCloudflarePublishQueueDiagnostics_() };
}

function setCloudflarePublicationMode_(payloadRaw, secretOrPasswordRaw) {
	assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw);
	const payload = payloadRaw && typeof payloadRaw === "object" ? payloadRaw : {};
	const mode = String(payload.mode || "").trim().toLowerCase();
	if (![CLOUDFLARE_PUBLICATION_MODE_QUEUED_V2, CLOUDFLARE_PUBLICATION_MODE_DISABLED, CLOUDFLARE_PUBLICATION_MODE_LEGACY_MANUAL].includes(mode)) throw new Error("Invalid Cloudflare publication mode. Use queued-v2, disabled, or legacy-manual.");
	if (mode === CLOUDFLARE_PUBLICATION_MODE_QUEUED_V2) {
		const state = readCloudflarePublishQueueState_();
		if (!state.active.committedVersionId) throw new Error("Initialize the Cloudflare queue with a committed active version before enabling queued-v2.");
	}
	PropertiesService.getScriptProperties().setProperty(CLOUDFLARE_PUBLICATION_MODE_PROPERTY, mode);
	if (mode === CLOUDFLARE_PUBLICATION_MODE_QUEUED_V2) scheduleCloudflarePublishWorker_(undefined, true);
	else removeCloudflarePublishWorkerTriggers_(false);
	return getCloudflarePublishQueueDiagnostics_();
}

function retryCloudflarePublishQueue(payloadRaw, secretOrPasswordRaw) {
	assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw);
	const result = mutateCloudflarePublishQueueState_(function (state) {
		state.retry.nextAttemptAt = ""; state.retry.lastError = ""; state.retry.permanent = false; state.paused = false;
		return { pending: hasPendingCloudflarePublishWork_(state) };
	});
	scheduleCloudflareAfterMutation_(result);
	return getCloudflarePublishQueueDiagnostics_();
}

// Explicit, idempotent migration entry point for a missing/corrupted
// versioned bot generation. It only changes the remote queue state; the
// normal worker regenerates and verifies immutable bot objects before the
// shared selector can move. It never writes Cloudflare data directly.
function repairCloudflareBotVersionObjects_(payloadRaw) {
	const payload = payloadRaw && typeof payloadRaw === "object" ? payloadRaw : {};
	const requestedVersion = normalizeActiveVersionId_(payload.versionId);
	// Resolve this before entering the CAS mutation callback. Mutation callbacks
	// must remain deterministic and side-effect free so a 412 retry can safely
	// reapply them to the latest state without performing another remote read.
	const fallbackVersion = requestedVersion || readPublishedActiveVersionId_();
	const result = mutateCloudflarePublishQueueState_(function (state) {
		const versionId = requestedVersion || state.active.committedVersionId || fallbackVersion;
		if (!versionId) throw new Error("A committed active version is required for bot-object repair.");
		const otherUncommittedTarget = state.active.targetVersionId && state.active.targetVersionId !== state.active.committedVersionId && state.active.targetVersionId !== versionId;
		if (otherUncommittedTarget) return { ok: false, skipped: true, reason: "newer-active-target-in-progress", targetVersionId: state.active.targetVersionId };
		if (state.active.targetVersionId === versionId && state.active.republish && state.active.phase !== "idle") {
			return { ok: true, idempotent: true, versionId: versionId, generation: state.active.targetGeneration, pending: true, nextAttemptAt: state.retry.nextAttemptAt };
		}
		state.active.targetVersionId = versionId;
		state.active.targetGeneration = Math.max(Math.max(0, toNonNegativeInt_(state.active.targetGeneration)) + 1, Date.now());
		state.active.phase = "bot-active";
		state.active.cursor = 0;
		state.active.dispatch = null;
		state.active.republish = true;
		state.active.updatedAt = new Date().toISOString();
		return { ok: true, idempotent: false, versionId: versionId, generation: state.active.targetGeneration, pending: true, nextAttemptAt: state.retry.nextAttemptAt };
	});
	if (result && result.pending) scheduleCloudflareAfterMutation_(result);
	return result;
}

function runCloudflarePublishWorkerTick(payloadRaw, secretOrPasswordRaw) { assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw); return cloudflarePublishWorkerTick(); }

function cloudflarePublishWorkerRecoveryTick() { return cloudflarePublishWorkerTick(); }

function pauseCloudflarePublishQueue(payloadRaw, secretOrPasswordRaw) {
	assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw);
	const payload = payloadRaw && typeof payloadRaw === "object" ? payloadRaw : {};
	const paused = payload.paused !== false;
	const result = mutateCloudflarePublishQueueState_(function (state) { state.paused = paused; return { pending: !paused && hasPendingCloudflarePublishWork_(state) }; });
	if (paused) removeCloudflarePublishWorkerTriggers_(false); else scheduleCloudflareAfterMutation_(result);
	return getCloudflarePublishQueueDiagnostics_();
}

function repairCloudflarePublishQueue(payloadRaw, secretOrPasswordRaw) { assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw); return repairCloudflarePublishQueueDrift_(); }
function repairCloudflareBotVersionObjects(payloadRaw, secretOrPasswordRaw) { assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw); return repairCloudflareBotVersionObjects_(payloadRaw); }
function inspectCloudflarePublishQueue(payloadRaw, secretOrPasswordRaw) { assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw); return getCloudflarePublishQueueDiagnostics_(); }
function initializeCloudflarePublishQueue(payloadRaw, secretOrPasswordRaw) { assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw); return initializeCloudflarePublishQueue_(payloadRaw); }
function setCloudflarePublicationMode(payloadRaw, secretOrPasswordRaw) { return setCloudflarePublicationMode_(payloadRaw, secretOrPasswordRaw); }
