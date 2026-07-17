// Durable asynchronous Cloudflare mirror queue. Firebase remains canonical.
//
// The queue deliberately separates local coordination from remote state:
// ScriptLock protects only Script Properties and trigger-list edits. Queue
// state itself is updated with Firebase ETag compare-and-swap, so no global
// Apps Script lock is held during OAuth, Firebase, or Cloudflare I/O.

var cloudflarePublishQueueDeadlineMs_ = 0;
var cloudflarePublishQueueCurrentClaim_ = null;
var cloudflarePublishQueueExecution_ = null;

const CLOUDFLARE_PUBLISH_SCHEDULER_REPAIR_PROPERTY_ = "CLOUDFLARE_PUBLISH_SCHEDULER_REPAIR";
const CLOUDFLARE_PUBLISH_HEARTBEAT_PROPERTY_ = "CLOUDFLARE_PUBLISH_HEARTBEAT";
const CLOUDFLARE_QUEUE_ITEM_MAX_ATTEMPTS_ = 3;
const CLOUDFLARE_QUEUE_REPAIR_BURST_LIMIT_ = 1;

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
	if (name === "CLOUDFLARE_PUBLISH_QUEUE_CONTINUATION_MAX_OVERDUE_MS" && typeof CLOUDFLARE_PUBLISH_QUEUE_CONTINUATION_MAX_OVERDUE_MS !== "undefined") return CLOUDFLARE_PUBLISH_QUEUE_CONTINUATION_MAX_OVERDUE_MS;
	if (name === "CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_MAX_OVERDUE_MS" && typeof CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_MAX_OVERDUE_MS !== "undefined") return CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_MAX_OVERDUE_MS;
	if (name === "CLOUDFLARE_PUBLISH_QUEUE_EXECUTION_BUDGET_MS" && typeof CLOUDFLARE_PUBLISH_QUEUE_EXECUTION_BUDGET_MS !== "undefined") return CLOUDFLARE_PUBLISH_QUEUE_EXECUTION_BUDGET_MS;
	if (name === "CLOUDFLARE_PUBLISH_QUEUE_MAX_ACTIVE_ROSTERS_PER_PHASE" && typeof CLOUDFLARE_PUBLISH_QUEUE_MAX_ACTIVE_ROSTERS_PER_PHASE !== "undefined") return CLOUDFLARE_PUBLISH_QUEUE_MAX_ACTIVE_ROSTERS_PER_PHASE;
	if (name === "CLOUDFLARE_PUBLISH_QUEUE_MAX_ACTIVE_BURST_BEFORE_DIRTY" && typeof CLOUDFLARE_PUBLISH_QUEUE_MAX_ACTIVE_BURST_BEFORE_DIRTY !== "undefined") return CLOUDFLARE_PUBLISH_QUEUE_MAX_ACTIVE_BURST_BEFORE_DIRTY;
	if (name === "CLOUDFLARE_PUBLISH_QUEUE_MAX_ITEMS_PER_INVOCATION" && typeof CLOUDFLARE_PUBLISH_QUEUE_MAX_ITEMS_PER_INVOCATION !== "undefined") return CLOUDFLARE_PUBLISH_QUEUE_MAX_ITEMS_PER_INVOCATION;
	if (name === "CLOUDFLARE_PUBLISH_QUEUE_ITEM_ADMISSION_RESERVE_MS" && typeof CLOUDFLARE_PUBLISH_QUEUE_ITEM_ADMISSION_RESERVE_MS !== "undefined") return CLOUDFLARE_PUBLISH_QUEUE_ITEM_ADMISSION_RESERVE_MS;
	if (name === "CLOUDFLARE_PUBLISH_QUEUE_CAS_MAX_ATTEMPTS" && typeof CLOUDFLARE_PUBLISH_QUEUE_CAS_MAX_ATTEMPTS !== "undefined") return CLOUDFLARE_PUBLISH_QUEUE_CAS_MAX_ATTEMPTS;
	return fallbackRaw;
}

function cloudflareQueueNow_() { return Date.now(); }

function beginCloudflarePublishQueueExecution_(executionIdRaw, startedAtMsRaw) {
	const startedAtMs = Math.max(0, Number(startedAtMsRaw) || cloudflareQueueNow_());
	cloudflarePublishQueueExecution_ = {
		executionId: String(executionIdRaw || createCloudflareQueueToken_()),
		startedAtMs: startedAtMs,
		startedAt: new Date(startedAtMs).toISOString(),
		processedItems: 0,
		payloadBytes: 0,
		history: [],
	};
	return recordCloudflarePublishQueueHeartbeat_("start");
}

function recordCloudflarePublishQueueHeartbeat_(phaseRaw, detailsRaw) {
	const execution = cloudflarePublishQueueExecution_;
	if (!execution) return null;
	const nowMs = cloudflareQueueNow_();
	const details = detailsRaw && typeof detailsRaw === "object" ? detailsRaw : {};
	const claim = details.claim && typeof details.claim === "object" ? details.claim : cloudflarePublishQueueCurrentClaim_;
	if (details.processedItem === true) execution.processedItems += 1;
	if (details.payloadBytes != null) execution.payloadBytes = Math.max(execution.payloadBytes, toNonNegativeInt_(details.payloadBytes));
	const entry = {
		phase: String(phaseRaw || "unknown").slice(0, 80),
		enteredAt: new Date(nowMs).toISOString(),
		elapsedMs: Math.max(0, nowMs - execution.startedAtMs),
		remainingBudgetMs: cloudflarePublishQueueDeadlineMs_ ? Math.max(0, cloudflarePublishQueueDeadlineMs_ - nowMs) : 0,
		item: claim ? cloudflareQueueClaimItemKey_(claim) : "",
		revision: claim ? Math.max(0, toNonNegativeInt_(claim.generation || claim.revision)) : 0,
		payloadBytes: details.payloadBytes != null ? Math.max(0, toNonNegativeInt_(details.payloadBytes)) : 0,
		status: String(details.status || "").slice(0, 80),
	};
	execution.history.push(entry);
	if (execution.history.length > 40) execution.history = execution.history.slice(execution.history.length - 40);
	const heartbeat = {
		schemaVersion: 1,
		executionId: execution.executionId,
		startedAt: execution.startedAt,
		lastEnteredPhase: entry.phase,
		updatedAt: entry.enteredAt,
		elapsedMs: entry.elapsedMs,
		remainingBudgetMs: entry.remainingBudgetMs,
		item: entry.item,
		revision: entry.revision,
		payloadBytes: execution.payloadBytes,
		processedItems: execution.processedItems,
		history: execution.history.slice(),
	};
	PropertiesService.getScriptProperties().setProperty(CLOUDFLARE_PUBLISH_HEARTBEAT_PROPERTY_, JSON.stringify(heartbeat));
	Logger.log(
		"cloudflarePublish phase=%s executionId=%s item=%s revision=%s elapsedMs=%s remainingMs=%s payloadBytes=%s processedItems=%s status=%s",
		entry.phase,
		execution.executionId,
		entry.item,
		entry.revision,
		entry.elapsedMs,
		entry.remainingBudgetMs,
		heartbeat.payloadBytes,
		heartbeat.processedItems,
		entry.status,
	);
	return heartbeat;
}

function readCloudflarePublishQueueHeartbeat_() {
	const raw = PropertiesService.getScriptProperties().getProperty(CLOUDFLARE_PUBLISH_HEARTBEAT_PROPERTY_);
	if (!raw) return null;
	try { return JSON.parse(raw); } catch (err) { return { schemaVersion: 1, invalid: true }; }
}

function canAdmitAnotherCloudflareQueueItem_() {
	const deadline = Number(cloudflarePublishQueueDeadlineMs_ || 0);
	if (!deadline) return true;
	const reserve = Math.max(30000, Number(cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_ITEM_ADMISSION_RESERVE_MS", 120000)) || 120000);
	return cloudflareQueueNow_() + reserve <= deadline;
}

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
		const leaseMs = cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_LOCK_LEASE_MS", 8 * 60 * 1000);
		// A queue invocation already owns a lease that extends beyond the Apps
		// Script hard-runtime horizon. Keep that fixed horizon instead of sliding
		// it on every checkpoint, which could postpone hard-kill recovery long
		// after the original owner is gone. Direct owner-scoped calls without an
		// execution heartbeat retain the legacy rolling lease behavior.
		const execution = cloudflarePublishQueueExecution_;
		const requiredExpiresAt = execution && execution.startedAtMs
			? execution.startedAtMs + leaseMs
			: Date.now() + leaseMs;
		if (current.expiresAt < requiredExpiresAt) {
			current.expiresAt = requiredExpiresAt;
			props.setProperty(CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY, JSON.stringify(current));
		}
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
		schemaVersion: 4,
		paused: false,
		nextRevision: 0,
		nextDispatchGeneration: 0,
		active: {
			targetVersionId: "",
			targetGeneration: 0,
			phase: "idle",
			cursor: 0,
			committedVersionId: "",
			committedGeneration: 0,
			dispatch: null,
			failure: null,
			migration: null,
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
			repairBurst: 0,
			bootstrap: null,
			retention: null,
		},
		infrastructure: { attempt: 0, nextAttemptAt: "", lastError: "", lastFailureAt: "" },
		deadLetters: {},
		versionMigrations: {},
		lastSuccessAt: "",
		lastBatch: null,
		lastDriftRepairAt: "",
		lastRetentionVersionId: "",
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

function normalizeCloudflareQueueFailure_(raw) {
	const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
	if (!source) return null;
	return {
		revision: Math.max(0, toNonNegativeInt_(source.revision)),
		itemKey: String(source.itemKey || "").slice(0, 300),
		attempt: Math.max(0, toNonNegativeInt_(source.attempt)),
		nextAttemptAt: String(source.nextAttemptAt || ""),
		lastError: String(source.lastError || "").slice(0, 2000),
		lastFailureAt: String(source.lastFailureAt || ""),
		deadLetter: source.deadLetter === true,
		permanent: source.permanent === true,
		scope: String(source.scope || "").slice(0, 40),
		path: String(source.path || "").slice(0, 500),
	};
}

function normalizeCloudflareDirtyMarker_(raw) {
	const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
	const marker = Object.assign({}, source);
	marker.revision = Math.max(0, toNonNegativeInt_(source.revision));
	marker.updatedAt = String(source.updatedAt || "");
	marker.reason = String(source.reason || "").slice(0, 160);
	marker.failure = normalizeCloudflareQueueFailure_(source.failure);
	return marker;
}

function normalizeCloudflareDirtyMap_(raw) {
	const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
	const out = {};
	Object.keys(source).forEach(function (key) { out[key] = normalizeCloudflareDirtyMarker_(source[key]); });
	return out;
}

function normalizeCloudflareCwlAggregateMap_(raw) {
	const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
	const out = {};
	Object.keys(source).forEach(function (eventId) {
		const kindsRaw = source[eventId] && typeof source[eventId] === "object" ? source[eventId] : {};
		const kinds = {};
		if (kindsRaw.live) kinds.live = normalizeCloudflareDirtyMarker_(kindsRaw.live);
		if (kindsRaw.final) kinds.final = normalizeCloudflareDirtyMarker_(kindsRaw.final);
		if (Object.keys(kinds).length) out[eventId] = kinds;
	});
	return out;
}

function normalizeCloudflareRepairMarker_(raw) {
	const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
	if (!source) return null;
	const reasons = (Array.isArray(source.reasons) ? source.reasons : [source.reason || "repair"])
		.map((value) => String(value || "").slice(0, 160)).filter((value, index, all) => value && all.indexOf(value) === index);
	const scopes = (Array.isArray(source.scopes) ? source.scopes : ["current", "previous"])
		.map((value) => String(value || "").slice(0, 80)).filter((value, index, all) => value && all.indexOf(value) === index);
	return Object.assign(normalizeCloudflareDirtyMarker_(source), {
		step: ["discover", "events", "season-maps", "donations", "pointers"].includes(String(source.step || "")) ? String(source.step) : "discover",
		seasonIndex: Math.max(0, toNonNegativeInt_(source.seasonIndex)),
		eventIndex: Math.max(0, toNonNegativeInt_(source.eventIndex)),
		donationIndex: Math.max(0, toNonNegativeInt_(source.donationIndex)),
		seasonIds: Array.isArray(source.seasonIds) ? source.seasonIds.map((id) => String(id || "").trim()).filter(Boolean) : [],
		eventIds: Array.isArray(source.eventIds) ? source.eventIds.map((id) => String(id || "").trim()).filter(Boolean) : [],
		donationSeasonIds: Array.isArray(source.donationSeasonIds) ? source.donationSeasonIds.map((id) => String(id || "").trim()).filter(Boolean) : [],
		reasons: reasons.length ? reasons : ["repair"],
		scopes: scopes.length ? scopes : ["current", "previous"],
		diagnostics: Array.isArray(source.diagnostics) ? source.diagnostics.slice(-100) : [],
	});
}

function normalizeCloudflarePublishQueueState_(raw) {
	const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
	const activeRaw = source.active && typeof source.active === "object" ? source.active : {};
	const dirtyRaw = source.dirty && typeof source.dirty === "object" ? source.dirty : {};
	const legacyRetryRaw = source.retry && typeof source.retry === "object" ? source.retry : {};
	const infrastructureRaw = source.infrastructure && typeof source.infrastructure === "object" ? source.infrastructure : legacyRetryRaw;
	const targetVersionId = normalizeActiveVersionId_(activeRaw.targetVersionId);
	const committedVersionId = normalizeActiveVersionId_(activeRaw.committedVersionId);
	const legacySchema = Math.max(0, toNonNegativeInt_(source.schemaVersion)) < 3;
	const repair = normalizeCloudflareRepairMarker_(dirtyRaw.repair || dirtyRaw.relevantSnapshot);
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
		schemaVersion: 4,
		// Schema-v3 used paused for automatic size failures. During migration only
		// a non-permanent legacy pause can be known to be administrative.
		paused: source.paused === true && !(Math.max(0, toNonNegativeInt_(source.schemaVersion)) < 4 && legacyRetryRaw.permanent === true),
		pauseReason: String(source.pauseReason || (source.paused === true && legacyRetryRaw.permanent !== true ? "admin" : "")),
		nextRevision: Math.max(0, toNonNegativeInt_(source.nextRevision)),
		nextDispatchGeneration: Math.max(0, toNonNegativeInt_(source.nextDispatchGeneration)),
		active: {
			targetVersionId: targetVersionId,
			targetGeneration: Math.max(0, toNonNegativeInt_(activeRaw.targetGeneration)),
			phase: normalizedPhase,
			cursor: normalizedCursor,
			committedVersionId: committedVersionId,
			committedGeneration: Math.max(0, toNonNegativeInt_(activeRaw.committedGeneration)),
			dispatch: activeRaw.dispatch && typeof activeRaw.dispatch === "object" ? activeRaw.dispatch : null,
			failure: normalizeCloudflareQueueFailure_(activeRaw.failure),
			migration: activeRaw.migration && typeof activeRaw.migration === "object" ? activeRaw.migration : null,
			activeBurst: Math.max(0, toNonNegativeInt_(activeRaw.activeBurst)),
			republish: republish,
			updatedAt: String(activeRaw.updatedAt || ""),
		},
		dirty: {
			events: normalizeCloudflareDirtyMap_(dirtyRaw.events),
			cwlAggregates: normalizeCloudflareCwlAggregateMap_(dirtyRaw.cwlAggregates),
			donationSeasons: normalizeCloudflareDirtyMap_(dirtyRaw.donationSeasons),
			cwlLeagueSignups: dirtyRaw.cwlLeagueSignups && typeof dirtyRaw.cwlLeagueSignups === "object" ? normalizeCloudflareDirtyMarker_(dirtyRaw.cwlLeagueSignups) : null,
			seasonPointers: dirtyRaw.seasonPointers && typeof dirtyRaw.seasonPointers === "object" ? normalizeCloudflareDirtyMarker_(dirtyRaw.seasonPointers) : null,
			repair: repair,
			repairBurst: Math.max(0, toNonNegativeInt_(dirtyRaw.repairBurst)),
			bootstrap: dirtyRaw.bootstrap && typeof dirtyRaw.bootstrap === "object" ? normalizeCloudflareDirtyMarker_(dirtyRaw.bootstrap) : null,
			retention: dirtyRaw.retention && typeof dirtyRaw.retention === "object" ? normalizeCloudflareDirtyMarker_(dirtyRaw.retention) : null,
		},
		infrastructure: {
			attempt: Math.max(0, toNonNegativeInt_(infrastructureRaw.attempt)),
			nextAttemptAt: infrastructureRaw.permanent === true ? "" : String(infrastructureRaw.nextAttemptAt || ""),
			lastError: String(infrastructureRaw.lastError || "").slice(0, 2000),
			lastFailureAt: String(infrastructureRaw.lastFailureAt || ""),
		},
		deadLetters: source.deadLetters && typeof source.deadLetters === "object" ? source.deadLetters : {},
		versionMigrations: source.versionMigrations && typeof source.versionMigrations === "object" ? source.versionMigrations : {},
		lastSuccessAt: String(source.lastSuccessAt || ""),
		lastBatch: source.lastBatch && typeof source.lastBatch === "object" ? source.lastBatch : null,
		lastDriftRepairAt: String(source.lastDriftRepairAt || ""),
		lastRetentionVersionId: normalizeActiveVersionId_(source.lastRetentionVersionId),
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
		const decodedCurrent = current && current.value != null ? decodeFirebaseObjectKeysRecursive_(current.value) : null;
		const state = normalizeCloudflarePublishQueueState_(decodedCurrent);
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
	let maximum = Math.max(0, toNonNegativeInt_(state.nextRevision));
	const include = function (marker) { maximum = Math.max(maximum, toNonNegativeInt_(marker && marker.revision)); };
	Object.keys(state.dirty.events || {}).forEach(function (key) { include(state.dirty.events[key]); });
	Object.keys(state.dirty.cwlAggregates || {}).forEach(function (key) { include(state.dirty.cwlAggregates[key].live); include(state.dirty.cwlAggregates[key].final); });
	Object.keys(state.dirty.donationSeasons || {}).forEach(function (key) { include(state.dirty.donationSeasons[key]); });
	include(state.dirty.cwlLeagueSignups);
	include(state.dirty.seasonPointers);
	include(state.dirty.repair);
	include(state.dirty.bootstrap);
	include(state.dirty.retention);
	state.nextRevision = maximum + 1;
	return state.nextRevision;
}

function makeCloudflareDirtyRevision_(state, reasonRaw, extraRaw) {
	return Object.assign({
		revision: nextCloudflarePublishRevision_(state),
		updatedAt: new Date().toISOString(),
		reason: String(reasonRaw || "mutation").slice(0, 160),
		failure: null,
	}, extraRaw && typeof extraRaw === "object" ? extraRaw : {});
}

function clearSupersededCloudflareDeadLetters_(state, categoryRaw, keyRaw, kindRaw) {
	const category = String(categoryRaw || "");
	const key = String(keyRaw || "");
	const kind = String(kindRaw || "");
	Object.keys(state.deadLetters || {}).forEach(function (itemKey) {
		const dead = state.deadLetters[itemKey] || {};
		if (String(dead.category || "") === category && String(dead.key || "") === key && String(dead.kind || "") === kind) delete state.deadLetters[itemKey];
	});
}

function isCloudflareQueueFailureDead_(failureRaw) {
	const failure = normalizeCloudflareQueueFailure_(failureRaw);
	return !!(failure && failure.deadLetter);
}

function isCloudflareQueueMarkerPending_(markerRaw) {
	return !!markerRaw && !isCloudflareQueueFailureDead_(markerRaw.failure);
}

function isCloudflareQueueMarkerEligible_(markerRaw, nowRaw) {
	if (!isCloudflareQueueMarkerPending_(markerRaw)) return false;
	const failure = normalizeCloudflareQueueFailure_(markerRaw && markerRaw.failure);
	return !failure || !failure.nextAttemptAt || parseIsoToMs_(failure.nextAttemptAt) <= Number(nowRaw || Date.now());
}

function collectCloudflareQueueNextAttemptMs_(stateRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	const attempts = [];
	const add = function (marker) {
		const failure = normalizeCloudflareQueueFailure_(marker && marker.failure);
		const at = failure && !failure.deadLetter ? parseIsoToMs_(failure.nextAttemptAt) : 0;
		if (at > Date.now()) attempts.push(at);
	};
	add(state.active);
	Object.keys(state.dirty.events).forEach((key) => add(state.dirty.events[key]));
	Object.keys(state.dirty.cwlAggregates).forEach((key) => { add(state.dirty.cwlAggregates[key].live); add(state.dirty.cwlAggregates[key].final); });
	Object.keys(state.dirty.donationSeasons).forEach((key) => add(state.dirty.donationSeasons[key]));
	add(state.dirty.cwlLeagueSignups); add(state.dirty.seasonPointers); add(state.dirty.repair); add(state.dirty.bootstrap); add(state.dirty.retention);
	const infrastructureAt = parseIsoToMs_(state.infrastructure.nextAttemptAt);
	if (infrastructureAt > Date.now()) attempts.push(infrastructureAt);
	return attempts.length ? Math.min.apply(Math, attempts) : 0;
}

function cloudflareQueueNextAttemptIso_(stateRaw) {
	const at = collectCloudflareQueueNextAttemptMs_(stateRaw);
	return at ? new Date(at).toISOString() : "";
}

function hasPendingCloudflarePublishWork_(stateRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	if (state.active.targetVersionId && (state.active.targetVersionId !== state.active.committedVersionId || state.active.republish || state.active.phase !== "idle") && !isCloudflareQueueFailureDead_(state.active.failure)) return true;
	const dirty = state.dirty;
	if (Object.keys(dirty.events).some((key) => isCloudflareQueueMarkerPending_(dirty.events[key]))) return true;
	if (Object.keys(dirty.cwlAggregates).some((key) => isCloudflareQueueMarkerPending_(dirty.cwlAggregates[key].live) || isCloudflareQueueMarkerPending_(dirty.cwlAggregates[key].final))) return true;
	if (Object.keys(dirty.donationSeasons).some((key) => isCloudflareQueueMarkerPending_(dirty.donationSeasons[key]))) return true;
	return isCloudflareQueueMarkerPending_(dirty.cwlLeagueSignups) || isCloudflareQueueMarkerPending_(dirty.seasonPointers) ||
		isCloudflareQueueMarkerPending_(dirty.repair) || isCloudflareQueueMarkerPending_(dirty.bootstrap) || isCloudflareQueueMarkerPending_(dirty.retention);
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

function ensureCloudflareTrigger_(handlerNameRaw, idPropertyRaw, atPropertyRaw, desiredAtMsRaw, optionsRaw) {
	if (typeof ScriptApp === "undefined" || !ScriptApp || typeof ScriptApp.newTrigger !== "function") return { scheduled: false, reason: "scriptapp-unavailable" };
	assertCloudflarePublishQueueDeadline_(15000, "Cloudflare trigger reconciliation");
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const nowMs = Date.now();
	const desiredAtMs = Math.max(nowMs + 1000, Number(desiredAtMsRaw) || nowMs + 1000);
	const properties = PropertiesService.getScriptProperties();
	const candidates = getCloudflareTriggerCandidates_(handlerNameRaw);
	const configuredId = getCloudflareTriggerId_(idPropertyRaw);
	const configuredTrigger = candidates.find((trigger) => getTriggerUniqueId_(trigger) === configuredId) || null;
	const configuredAtMs = getCloudflareTriggerAtMs_(atPropertyRaw);
	const toleranceMs = typeof CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_REUSE_TOLERANCE_MS !== "undefined"
		? Math.max(0, Number(CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_REUSE_TOLERANCE_MS) || 0)
		: 30000;
	const maxOverdueMs = Math.max(1000, Number(options.maxOverdueMs) || cloudflareQueueConstant_(
		options.recoveryNotBeforeMs ? "CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_MAX_OVERDUE_MS" : "CLOUDFLARE_PUBLISH_QUEUE_CONTINUATION_MAX_OVERDUE_MS",
		10 * 60 * 1000,
	));
	// Apps Script exposes the requested timestamp, not a guaranteed delivery
	// time. Reuse bounded delayed intent, but replace an installed one-shot once
	// its requested time is too far overdue or violates a durable lower bound.
	const recoveryNotBeforeMs = Math.max(0, Number(options.recoveryNotBeforeMs) || 0);
	const notBeforeMs = Math.max(recoveryNotBeforeMs, Number(options.notBeforeMs) || 0);
	const overdueAgeMs = configuredAtMs > 0 ? Math.max(0, nowMs - configuredAtMs) : 0;
	const reusable = !!(
		configuredTrigger &&
		configuredAtMs > 0 &&
		overdueAgeMs <= maxOverdueMs &&
		(!notBeforeMs || configuredAtMs + toleranceMs >= notBeforeMs) &&
		configuredAtMs <= desiredAtMs + toleranceMs
	);
	if (reusable) {
		for (let i = 0; i < candidates.length; i++) if (candidates[i] !== configuredTrigger) { try { ScriptApp.deleteTrigger(candidates[i]); } catch (err) {} }
		const triggerId = getTriggerUniqueId_(configuredTrigger);
		if (triggerId) properties.setProperty(idPropertyRaw, triggerId);
		properties.setProperty(atPropertyRaw, String(configuredAtMs));
		return { scheduled: true, reused: true, healthy: true, triggerId: triggerId, scheduledAt: new Date(configuredAtMs).toISOString(), overdueAgeMs: overdueAgeMs };
	}
	const delay = Math.max(1000, desiredAtMs - nowMs);
	// Create first. If Apps Script refuses creation, every previous trigger and
	// its local identity remain intact as the only recovery path.
	let created = null;
	try {
		created = ScriptApp.newTrigger(handlerNameRaw).timeBased().after(delay).create();
	} catch (err) {
		return {
			scheduled: false,
			degraded: true,
			reason: "create-failed",
			error: errorMessage_(err),
			preservedTriggerId: configuredId || (candidates[0] && getTriggerUniqueId_(candidates[0])) || "",
			overdueAgeMs: overdueAgeMs,
		};
	}
	const triggerId = getTriggerUniqueId_(created);
	if (!triggerId) {
		try { ScriptApp.deleteTrigger(created); } catch (err) {}
		return { scheduled: false, degraded: true, reason: "created-trigger-missing-identity", preservedTriggerId: configuredId || "" };
	}
	const scheduledAtMs = nowMs + delay;
	try {
		const values = {};
		values[idPropertyRaw] = triggerId;
		values[atPropertyRaw] = String(scheduledAtMs);
		if (typeof properties.setProperties === "function") properties.setProperties(values, false);
		else {
			properties.setProperty(idPropertyRaw, triggerId);
			properties.setProperty(atPropertyRaw, String(scheduledAtMs));
		}
	} catch (err) {
		try { ScriptApp.deleteTrigger(created); } catch (deleteErr) {}
		return { scheduled: false, degraded: true, reason: "identity-publish-failed", error: errorMessage_(err), preservedTriggerId: configuredId || "" };
	}
	// Publish the replacement identity before retiring the prior path. A crash or
	// create failure therefore cannot leave the queue with no known trigger.
	for (let i = 0; i < candidates.length; i++) { try { ScriptApp.deleteTrigger(candidates[i]); } catch (err) {} }
	return { scheduled: true, reused: false, healthy: true, triggerId: triggerId, scheduledAt: new Date(scheduledAtMs).toISOString(), overdueAgeMs: overdueAgeMs };
}

// Scheduling consumes already-known state from the preceding CAS. It never
// reads Firebase to rediscover pending work.
function scheduleCloudflarePublishWorker_(ownerTokenRaw, pendingKnownRaw, notBeforeRaw) {
	if (!isCloudflareQueuedPublicationEnabled_()) return { scheduled: false, reason: "disabled" };
	if (pendingKnownRaw === false) return { scheduled: false, reason: "empty" };
	if (ownerTokenRaw) assertCloudflarePublishQueueLeaseOwned_(ownerTokenRaw);
	const nextAttemptMs = typeof notBeforeRaw === "number" ? notBeforeRaw : parseIsoToMs_(notBeforeRaw);
	const desiredAtMs = Math.max(Date.now() + CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_DELAY_MS, nextAttemptMs || 0);
	assertCloudflarePublishQueueDeadline_(15000, "Cloudflare continuation scheduling");
	const lock = LockService.getScriptLock();
	lock.waitLock(10000);
	try {
		return ensureCloudflareTrigger_(CLOUDFLARE_PUBLISH_QUEUE_HANDLER_NAME, CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_ID_PROPERTY, CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_AT_PROPERTY, desiredAtMs, {
			notBeforeMs: nextAttemptMs || 0,
			maxOverdueMs: cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_CONTINUATION_MAX_OVERDUE_MS", 10 * 60 * 1000),
		});
	} finally { lock.releaseLock(); }
}

function scheduleCloudflarePublishWorkerRecovery_(pendingKnownRaw, leaseRaw, notBeforeRaw) {
	if (pendingKnownRaw === false || typeof ScriptApp === "undefined" || !ScriptApp) return { scheduled: false, reason: pendingKnownRaw === false ? "empty" : "scriptapp-unavailable" };
	const lease = leaseRaw && typeof leaseRaw === "object" ? leaseRaw : {};
	const nowMs = Date.now();
	const leaseExpiresAt = Math.max(nowMs, Number(lease.expiresAt) || 0);
	const safetyMs = 60 * 1000;
	const recoveryDelayMs = cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_DELAY_MS", 9 * 60 * 1000);
	const explicitNotBeforeMs = typeof notBeforeRaw === "number" ? Math.max(0, notBeforeRaw) : parseIsoToMs_(notBeforeRaw);
	const recoveryNotBeforeMs = Math.max(
		Number(lease.expiresAt) > 0 ? leaseExpiresAt + safetyMs : 0,
		explicitNotBeforeMs > 0 ? explicitNotBeforeMs + recoveryDelayMs : 0,
	);
	const desiredAtMs = Math.max(
		recoveryNotBeforeMs,
		nowMs + recoveryDelayMs,
	);
	assertCloudflarePublishQueueDeadline_(15000, "Cloudflare recovery scheduling");
	const lock = LockService.getScriptLock();
	lock.waitLock(10000);
	try {
		return ensureCloudflareTrigger_(
			cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_HANDLER_NAME", "cloudflarePublishWorkerRecoveryTick"),
			cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_ID_PROPERTY", "CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_ID"),
			cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_AT_PROPERTY", "CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_AT"),
			desiredAtMs,
			{
				recoveryNotBeforeMs: recoveryNotBeforeMs,
				maxOverdueMs: cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_MAX_OVERDUE_MS", 10 * 60 * 1000),
			},
		);
	} finally { lock.releaseLock(); }
}

function ensureCloudflarePendingTriggerPaths_(ownerTokenRaw, pendingKnownRaw, notBeforeRaw, leaseRaw, optionsRaw) {
	if (pendingKnownRaw === false) return { scheduled: false, reason: "empty", continuation: { scheduled: false, reason: "empty" }, recovery: { scheduled: false, reason: "empty" } };
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	let continuation;
	let recovery;
	try { continuation = scheduleCloudflarePublishWorker_(ownerTokenRaw, true, notBeforeRaw); }
	catch (err) { continuation = { scheduled: false, degraded: true, error: errorMessage_(err), reason: "continuation-failed" }; }
	let lease = leaseRaw && typeof leaseRaw === "object" ? leaseRaw : null;
	if (!lease && ownerTokenRaw) lease = parseCloudflarePublishQueueLockState_(PropertiesService.getScriptProperties().getProperty(CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY));
	const recoveryNotBefore = Object.prototype.hasOwnProperty.call(options, "recoveryNotBefore") ? options.recoveryNotBefore : notBeforeRaw;
	try { recovery = scheduleCloudflarePublishWorkerRecovery_(true, lease || {}, recoveryNotBefore); }
	catch (err) { recovery = { scheduled: false, degraded: true, error: errorMessage_(err), reason: "recovery-failed" }; }
	return {
		scheduled: !!(continuation && continuation.scheduled && recovery && recovery.scheduled),
		continuation: continuation,
		recovery: recovery,
	};
}

function consumeCloudflareFiredTriggerIdentity_(eventRaw, idPropertyRaw, atPropertyRaw, handlerNameRaw) {
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
	const firedId = String(event.triggerUid || event.triggerId || "").trim();
	if (!firedId) return { consumed: false, firedId: "", clearedCurrent: false, deleted: false };
	const lock = LockService.getScriptLock();
	lock.waitLock(10000);
	try {
		const properties = PropertiesService.getScriptProperties();
		const handlerName = String(handlerNameRaw || "");
		const candidates = handlerName ? getCloudflareTriggerCandidates_(handlerName) : [];
		const firedTrigger = candidates.find(function (trigger) { return getTriggerUniqueId_(trigger) === firedId; }) || null;
		let deleted = false;
		if (firedTrigger) {
			try { ScriptApp.deleteTrigger(firedTrigger); deleted = true; } catch (err) {}
		}
		const isCurrent = String(properties.getProperty(idPropertyRaw) || "").trim() === firedId;
		if (isCurrent) {
			properties.deleteProperty(idPropertyRaw);
			properties.deleteProperty(atPropertyRaw);
		}
		return { consumed: true, firedId: firedId, clearedCurrent: isCurrent, deleted: deleted };
	} finally { lock.releaseLock(); }
}

function getCloudflareDynamicTriggerDiagnostics_() {
	const nowMs = Date.now();
	const inspect = function (handlerName, idProperty, atProperty, maxOverdueMs) {
		const configuredId = getCloudflareTriggerId_(idProperty);
		const scheduledAtMs = getCloudflareTriggerAtMs_(atProperty);
		const candidates = getCloudflareTriggerCandidates_(handlerName);
		const configuredPresent = !!configuredId && candidates.some(function (trigger) { return getTriggerUniqueId_(trigger) === configuredId; });
		const overdueAgeMs = scheduledAtMs > 0 ? Math.max(0, nowMs - scheduledAtMs) : 0;
		let health = "healthy";
		if (!configuredId || !configuredPresent) health = "missing";
		else if (!scheduledAtMs) health = "invalid-time";
		else if (overdueAgeMs > maxOverdueMs) health = "overdue";
		return {
			handler: handlerName,
			configuredId: configuredId,
			scheduledAt: scheduledAtMs ? new Date(scheduledAtMs).toISOString() : "",
			scheduledAtMs: scheduledAtMs,
			overdueAgeMs: overdueAgeMs,
			maxOverdueMs: maxOverdueMs,
			health: health,
			healthy: health === "healthy",
			configuredPresent: configuredPresent,
			actualCount: candidates.length,
			actualIds: candidates.map(function (trigger) { return getTriggerUniqueId_(trigger); }).filter(Boolean),
		};
	};
	return {
		continuation: inspect(
			CLOUDFLARE_PUBLISH_QUEUE_HANDLER_NAME,
			CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_ID_PROPERTY,
			CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_AT_PROPERTY,
			cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_CONTINUATION_MAX_OVERDUE_MS", 10 * 60 * 1000),
		),
		recovery: inspect(
			cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_HANDLER_NAME", "cloudflarePublishWorkerRecoveryTick"),
			cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_ID_PROPERTY", "CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_ID"),
			cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_AT_PROPERTY", "CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_AT"),
			cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_MAX_OVERDUE_MS", 10 * 60 * 1000),
		),
	};
}

function markCloudflarePublishSchedulerRepair_(reasonRaw, nextAttemptAtRaw, detailsRaw) {
	const properties = PropertiesService.getScriptProperties();
	const lock = LockService.getScriptLock();
	lock.waitLock(10000);
	try {
		const snapshot = readCloudflarePublishSchedulerRepairSnapshot_();
		const existing = snapshot.marker;
		const payload = Object.assign({}, existing && typeof existing === "object" ? existing : {}, {
			pending: true,
			reason: String(reasonRaw || "dynamic-scheduling-failed").slice(0, 500),
			updatedAt: new Date().toISOString(),
			nextAttemptAt: String(nextAttemptAtRaw || ""),
		}, detailsRaw && typeof detailsRaw === "object" ? detailsRaw : {});
		properties.setProperty(CLOUDFLARE_PUBLISH_SCHEDULER_REPAIR_PROPERTY_, JSON.stringify(payload));
		return payload;
	} finally { lock.releaseLock(); }
}

function readCloudflarePublishSchedulerRepairSnapshot_() {
	try {
		const raw = String(PropertiesService.getScriptProperties().getProperty(CLOUDFLARE_PUBLISH_SCHEDULER_REPAIR_PROPERTY_) || "").trim();
		const parsed = raw ? JSON.parse(raw) : {};
		return { raw: raw, marker: parsed && typeof parsed === "object" ? parsed : {} };
	} catch (err) { return { raw: "", marker: {} }; }
}

function readCloudflarePublishSchedulerRepair_() {
	return readCloudflarePublishSchedulerRepairSnapshot_().marker;
}

function clearCloudflarePublishSchedulerRepair_(forceRaw, expectedRawSnapshot) {
	const lock = LockService.getScriptLock();
	lock.waitLock(10000);
	try {
		const snapshot = readCloudflarePublishSchedulerRepairSnapshot_();
		if (expectedRawSnapshot !== undefined && snapshot.raw !== String(expectedRawSnapshot || "")) return false;
		// A failed canonical target enqueue and a trigger-scheduling failure share
		// this durable local marker. Healthy trigger reconciliation must never erase
		// an active target that the permanent watchdog has not yet merged/superseded.
		if (forceRaw !== true && normalizeActiveVersionId_(snapshot.marker.activeVersionId)) return false;
		PropertiesService.getScriptProperties().deleteProperty(CLOUDFLARE_PUBLISH_SCHEDULER_REPAIR_PROPERTY_);
		return true;
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
	try {
		const scheduled = ensureCloudflarePendingTriggerPaths_(undefined, result.pending !== false, result.nextAttemptAt || "", null);
		if (scheduled && scheduled.scheduled) clearCloudflarePublishSchedulerRepair_();
		else if (result.pending !== false) markCloudflarePublishSchedulerRepair_(
			String(scheduled && scheduled.continuation && (scheduled.continuation.error || scheduled.continuation.reason) || "") + " " +
			String(scheduled && scheduled.recovery && (scheduled.recovery.error || scheduled.recovery.reason) || ""),
			result.nextAttemptAt || "",
		);
		return scheduled;
	} catch (err) {
		Logger.log("Cloudflare pending trigger scheduling failed: %s", errorMessage_(err));
		if (result.pending !== false) markCloudflarePublishSchedulerRepair_(errorMessage_(err), result.nextAttemptAt || "");
		return { scheduled: false, error: errorMessage_(err) };
	}
}

function recordCloudflarePendingTriggerPaths_(pathsRaw, nextAttemptAtRaw, detailsRaw) {
	const paths = pathsRaw && typeof pathsRaw === "object" ? pathsRaw : {};
	if (paths.scheduled === true) clearCloudflarePublishSchedulerRepair_();
	else {
		const continuationReason = paths.continuation && (paths.continuation.error || paths.continuation.reason);
		const recoveryReason = paths.recovery && (paths.recovery.error || paths.recovery.reason);
		markCloudflarePublishSchedulerRepair_(
			[continuationReason, recoveryReason].filter(Boolean).join("; ") || "dynamic-trigger-path-unavailable",
			nextAttemptAtRaw || "",
			detailsRaw,
		);
	}
	return paths;
}

function finalizeCloudflareEnqueueResult_(resultRaw) {
	const result = resultRaw && typeof resultRaw === "object" ? resultRaw : {};
	const scheduling = scheduleCloudflareAfterMutation_(result);
	return Object.assign({}, result, {
		queued: result.pending !== false,
		scheduled: !!(scheduling && scheduling.scheduled),
		degradedScheduling: result.pending !== false && !(scheduling && scheduling.scheduled),
		scheduling: scheduling,
	});
}

function isCloudflareSafeActiveVersionId_(versionIdRaw) {
	return typeof isSafeActiveVersionId_ === "function"
		? isSafeActiveVersionId_(versionIdRaw)
		: /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(String(versionIdRaw || "").trim());
}

function migrateUnsafeCloudflareActiveVersion_(legacyVersionIdRaw, reasonRaw) {
	const legacyVersionId = String(legacyVersionIdRaw || "").trim();
	if (!legacyVersionId || isCloudflareSafeActiveVersionId_(legacyVersionId)) return { migrated: false, versionId: legacyVersionId };
	if (typeof readLegacyActiveRosterSnapshotFromRawVersion_ !== "function" || typeof writeActiveRosterVersionShards_ !== "function") throw new Error("Unsafe active version migration requires canonical snapshot helpers.");
	const safeVersionId = typeof createMigratedActiveVersionId_ === "function"
		? createMigratedActiveVersionId_(legacyVersionId, "legacy-migration")
		: "legacy-migration-" + String(hashCloudflareText_(legacyVersionId)).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32);
	const snapshot = readLegacyActiveRosterSnapshotFromRawVersion_(legacyVersionId);
	if (!snapshot || !snapshot.rosterData) throw new Error("Unsafe legacy active version snapshot is incomplete: " + legacyVersionId + ".");
	const written = writeActiveRosterVersionShards_(safeVersionId, snapshot.rosterData, {
		source: "unsafe-active-version-migration",
		publish: false,
		sourceVersionId: legacyVersionId,
	});
	return { migrated: true, legacyVersionId: legacyVersionId, versionId: safeVersionId, manifest: written && written.manifest || null, reason: String(reasonRaw || "unsafe-version") };
}

function mergeCloudflareActiveTargetIntoQueueState_(stateRaw, versionIdRaw, reasonRaw, migrationRaw) {
	const state = stateRaw && typeof stateRaw === "object" ? stateRaw : createEmptyCloudflarePublishQueueState_();
	const versionId = normalizeActiveVersionId_(versionIdRaw);
	const migration = migrationRaw && typeof migrationRaw === "object" ? migrationRaw : null;
	if (!versionId) throw new Error("A valid Cloudflare active target version is required.");
	if (state.active.targetVersionId !== versionId || isCloudflareQueueFailureDead_(state.active.failure)) {
		Object.keys(state.deadLetters || {}).forEach(function (itemKey) { if ((state.deadLetters[itemKey] || {}).category === "active") delete state.deadLetters[itemKey]; });
		state.active.targetVersionId = versionId;
		state.active.targetGeneration = Math.max(Math.max(0, toNonNegativeInt_(state.active.targetGeneration)) + 1, Date.now());
		state.active.phase = "public-manifest-rosters";
		state.active.cursor = 0;
		state.active.dispatch = null;
		state.active.failure = null;
		state.active.migration = migration && migration.migrated ? { kind: "unsafe-version", sourceVersionId: migration.legacyVersionId, targetVersionId: versionId } : null;
	}
	if (migration && migration.migrated) state.versionMigrations[migration.legacyVersionId] = { safeVersionId: versionId, migratedAt: new Date().toISOString(), reason: String(reasonRaw || "unsafe-version") };
	state.active.updatedAt = new Date().toISOString();
	return { ok: true, versionId: versionId, generation: state.active.targetGeneration, pending: hasPendingCloudflarePublishWork_(state), nextAttemptAt: cloudflareQueueNextAttemptIso_(state) };
}

function enqueueCloudflareActiveTarget_(versionIdRaw, reasonRaw) {
	const requestedVersionId = String(versionIdRaw == null ? "" : versionIdRaw).trim();
	let migration = null;
	let versionId = normalizeActiveVersionId_(requestedVersionId);
	if (requestedVersionId && !isCloudflareSafeActiveVersionId_(requestedVersionId)) {
		migration = migrateUnsafeCloudflareActiveVersion_(requestedVersionId, reasonRaw);
		versionId = migration.versionId;
	}
	if (!versionId) return { ok: false, skipped: true, reason: "missing-version" };
	if (!isCloudflareQueuedPublicationEnabled_()) {
		markCloudflarePublishSchedulerRepair_("active-target-queue-disabled", "", { activeVersionId: versionId, activeReason: String(reasonRaw || "") });
		return { ok: false, skipped: true, reason: "disabled", versionId: versionId, repairPending: true };
	}
	try {
		const result = mutateCloudflarePublishQueueState_(function (state) {
			return mergeCloudflareActiveTargetIntoQueueState_(state, versionId, reasonRaw, migration);
		});
		return Object.assign(finalizeCloudflareEnqueueResult_(result), { migration: migration });
	} catch (err) {
		Logger.log("Cloudflare active target enqueue failed versionId=%s error=%s", versionId, errorMessage_(err));
		const cooldownUntilMs = typeof getRuntimeUrlFetchQuotaCooldownUntilMs_ === "function" ? getRuntimeUrlFetchQuotaCooldownUntilMs_() : 0;
		const nextAttemptAt = cooldownUntilMs > Date.now() ? new Date(cooldownUntilMs).toISOString() : "";
		const repairDetails = { activeVersionId: versionId, activeReason: String(reasonRaw || "") };
		markCloudflarePublishSchedulerRepair_("active-target-enqueue-failed:" + errorMessage_(err), nextAttemptAt, repairDetails);
		let scheduling;
		try {
			scheduling = recordCloudflarePendingTriggerPaths_(
				ensureCloudflarePendingTriggerPaths_(undefined, true, nextAttemptAt, null),
				nextAttemptAt,
				repairDetails,
			);
		} catch (scheduleErr) {
			markCloudflarePublishSchedulerRepair_("active-target-recovery-scheduling-failed:" + errorMessage_(scheduleErr), nextAttemptAt, repairDetails);
			scheduling = { scheduled: false, error: errorMessage_(scheduleErr) };
		}
		return {
			ok: false,
			error: errorMessage_(err),
			versionId: versionId,
			repairPending: true,
			scheduled: !!(scheduling && scheduling.scheduled),
			scheduling: scheduling,
		};
	}
}

function recoverCloudflareActiveSchedulerRepairForWorker_(ownerTokenRaw) {
	let lastResult = null;
	for (let attempt = 1; attempt <= 3; attempt++) {
		const markerSnapshot = readCloudflarePublishSchedulerRepairSnapshot_();
		const marker = markerSnapshot.marker;
		const markedVersionId = normalizeActiveVersionId_(marker.activeVersionId);
		if (!markedVersionId) return lastResult || { ok: true, skipped: true, reason: "no-active-target-repair" };
		const canonicalBefore = normalizeActiveVersionId_(readPublishedActiveVersionId_());
		if (!canonicalBefore) {
			const missing = new Error("Canonical active version is unavailable while recovering Cloudflare publication scheduling.");
			missing.code = "CLOUDFLARE_ACTIVE_REPAIR_CANONICAL_UNAVAILABLE";
			missing.resumable = true;
			throw missing;
		}
		// The marker is wake-up intent, while Firebase's selector is authoritative.
		// A newer canonical publication may have replaced the marked target between
		// trigger creation and this recovery execution.
		const result = mutateCloudflarePublishQueueState_(function (state) {
			return mergeCloudflareActiveTargetIntoQueueState_(state, canonicalBefore, marker.activeReason || "dynamic-trigger-active-repair", null);
		}, ownerTokenRaw);
		const canonicalAfter = normalizeActiveVersionId_(readPublishedActiveVersionId_());
		if (!canonicalAfter) {
			const missingAfter = new Error("Canonical active version disappeared while recovering Cloudflare publication scheduling.");
			missingAfter.code = "CLOUDFLARE_ACTIVE_REPAIR_CANONICAL_UNAVAILABLE";
			missingAfter.resumable = true;
			throw missingAfter;
		}
		lastResult = Object.assign({
			repaired: true,
			attempt: attempt,
			markedVersionId: markedVersionId,
			canonicalVersionId: canonicalAfter,
		}, result);
		if (canonicalAfter !== canonicalBefore) continue;
		// Marker writers and this exact compare-and-clear share ScriptLock. A
		// concurrently installed newer-version marker can therefore never be erased
		// after the queue CAS for an older candidate.
		if (clearCloudflarePublishSchedulerRepair_(true, markerSnapshot.raw)) return Object.assign(lastResult, { markerCleared: true });
	}
	const unstable = new Error("Canonical Cloudflare repair target changed repeatedly during bounded recovery.");
	unstable.code = "CLOUDFLARE_ACTIVE_REPAIR_SUPERSEDED";
	unstable.resumable = true;
	throw unstable;
}

function enqueueCloudflareSeasonEventPublication_(eventIdRaw, reasonRaw, optionsRaw) {
	const eventId = sanitizeSeasonEventText_(eventIdRaw, 180);
	if (!eventId || !isCloudflareQueuedPublicationEnabled_()) return { ok: false, skipped: true, reason: !eventId ? "missing-event" : "disabled" };
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const lifecycle = options.cwlLifecycle && typeof options.cwlLifecycle === "object" ? options.cwlLifecycle : null;
	const dirtyCwlLive = lifecycle ? String(lifecycle.liveAggregateAction || "") === "put" || String(lifecycle.liveAggregateAction || "") === "delete" : options.cwlLive === true;
	const dirtyCwlFinal = lifecycle ? String(lifecycle.finalAggregateAction || "") === "put" || String(lifecycle.finalAggregateAction || "") === "delete" : options.cwlFinal === true;
	const dirtyPointers = lifecycle ? String(lifecycle.pointerAction || "") === "put" || String(lifecycle.pointerAction || "") === "delete" : options.pointers === true;
	try {
		const result = mutateCloudflarePublishQueueState_(function (state) {
			clearSupersededCloudflareDeadLetters_(state, "event", eventId, "");
			state.dirty.events[eventId] = makeCloudflareDirtyRevision_(state, reasonRaw || "event-mutation", { eventId: eventId, category: "event" });
			if (dirtyCwlLive || dirtyCwlFinal) {
				const kinds = state.dirty.cwlAggregates[eventId] && typeof state.dirty.cwlAggregates[eventId] === "object" ? state.dirty.cwlAggregates[eventId] : {};
				if (dirtyCwlLive) { clearSupersededCloudflareDeadLetters_(state, "cwlAggregate", eventId, "live"); kinds.live = makeCloudflareDirtyRevision_(state, reasonRaw || "cwl-live", { eventId: eventId, kind: "live", category: "cwlAggregate" }); }
				if (dirtyCwlFinal) { clearSupersededCloudflareDeadLetters_(state, "cwlAggregate", eventId, "final"); kinds.final = makeCloudflareDirtyRevision_(state, reasonRaw || "cwl-final", { eventId: eventId, kind: "final", category: "cwlAggregate" }); }
				state.dirty.cwlAggregates[eventId] = kinds;
			}
			if (dirtyPointers) { clearSupersededCloudflareDeadLetters_(state, "seasonPointers", "", ""); state.dirty.seasonPointers = makeCloudflareDirtyRevision_(state, reasonRaw || "event-pointers", { category: "seasonPointers" }); }
			return { ok: true, eventId: eventId, revision: state.dirty.events[eventId].revision, pending: true, nextAttemptAt: cloudflareQueueNextAttemptIso_(state) };
		});
		return finalizeCloudflareEnqueueResult_(result);
	} catch (err) {
		Logger.log("Cloudflare event enqueue failed eventId=%s error=%s", eventId, errorMessage_(err));
		return { ok: false, error: errorMessage_(err), eventId: eventId };
	}
}

function enqueueCloudflareSeasonEventReconciliation_(mutationsRaw, reasonRaw) {
	if (!isCloudflareQueuedPublicationEnabled_()) return { ok: false, skipped: true, reason: "disabled" };
	const mutations = mutationsRaw && typeof mutationsRaw === "object" ? mutationsRaw : {};
	const eventIdsRaw = Array.isArray(mutations.eventIds) ? mutations.eventIds : [];
	const eventIds = [];
	for (let i = 0; i < eventIdsRaw.length; i++) {
		const eventId = sanitizeSeasonEventText_(eventIdsRaw[i], 180);
		if (eventId && eventIds.indexOf(eventId) < 0) eventIds.push(eventId);
	}
	const pointerPaths = Array.isArray(mutations.pointerPaths) ? mutations.pointerPaths.filter(Boolean) : [];
	if (!eventIds.length && !pointerPaths.length) return { ok: true, skipped: true, reason: "no-reconciliation-mutations" };
	try {
		const result = mutateCloudflarePublishQueueState_(function (state) {
			for (let i = 0; i < eventIds.length; i++) {
				const eventId = eventIds[i];
				clearSupersededCloudflareDeadLetters_(state, "event", eventId, "");
				state.dirty.events[eventId] = makeCloudflareDirtyRevision_(state, reasonRaw || "season-event-reconciliation", { eventId: eventId, category: "event" });
			}
			if (pointerPaths.length) {
				clearSupersededCloudflareDeadLetters_(state, "seasonPointers", "", "");
				state.dirty.seasonPointers = makeCloudflareDirtyRevision_(state, reasonRaw || "season-event-reconciliation-pointers", { category: "seasonPointers", pointerPaths: pointerPaths.slice() });
			}
			return { ok: true, eventIds: eventIds.slice(), pointerPaths: pointerPaths.slice(), pending: true, nextAttemptAt: cloudflareQueueNextAttemptIso_(state) };
		});
		return finalizeCloudflareEnqueueResult_(result);
	} catch (err) {
		Logger.log("Cloudflare reconciliation enqueue failed: %s", errorMessage_(err));
		return { ok: false, error: errorMessage_(err), eventIds: eventIds, pointerPaths: pointerPaths };
	}
}

function mergeCloudflareRepairRequest_(state, reasonRaw, scopesRaw) {
	const reason = String(reasonRaw || "targeted-repair").slice(0, 160);
	const scopes = (Array.isArray(scopesRaw) ? scopesRaw : ["current", "previous"])
		.map((value) => String(value || "").slice(0, 80)).filter(Boolean);
	if (!state.dirty.repair) {
		state.dirty.repair = makeCloudflareDirtyRevision_(state, reason, {
			category: "repair", step: "discover", seasonIndex: 0, eventIndex: 0, donationIndex: 0,
			seasonIds: [], eventIds: [], donationSeasonIds: [], reasons: [reason], scopes: scopes,
			diagnostics: [],
		});
		return state.dirty.repair;
	}
	const repair = state.dirty.repair;
	const reasons = (Array.isArray(repair.reasons) ? repair.reasons : [repair.reason]).concat([reason]);
	repair.reasons = reasons.filter((value, index, all) => value && all.indexOf(value) === index).slice(-20);
	repair.scopes = (Array.isArray(repair.scopes) ? repair.scopes : []).concat(scopes)
		.filter((value, index, all) => value && all.indexOf(value) === index).slice(-20);
	repair.updatedAt = new Date().toISOString();
	return repair;
}

function enqueueCloudflareRelevantSeasonPublication_(reasonRaw, optionsRaw) {
	if (!isCloudflareQueuedPublicationEnabled_()) return { ok: false, skipped: true, reason: "disabled" };
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	try {
		const result = mutateCloudflarePublishQueueState_(function (state) {
			const repair = mergeCloudflareRepairRequest_(state, reasonRaw || "targeted-repair", options.scopes);
			state.lastDriftRepairAt = new Date().toISOString();
			return { ok: true, category: "repair", revision: repair.revision, reasons: repair.reasons.slice(), scopes: repair.scopes.slice(), pending: true, nextAttemptAt: cloudflareQueueNextAttemptIso_(state) };
		});
		return finalizeCloudflareEnqueueResult_(result);
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
			clearSupersededCloudflareDeadLetters_(state, "donationSeason", seasonId, "");
			state.dirty.donationSeasons[seasonId] = makeCloudflareDirtyRevision_(state, reasonRaw || "donation-refresh", { seasonId: seasonId, category: "donationSeason" });
			return { ok: true, seasonId: seasonId, revision: state.dirty.donationSeasons[seasonId].revision, pending: true, nextAttemptAt: cloudflareQueueNextAttemptIso_(state) };
		});
		return finalizeCloudflareEnqueueResult_(result);
	} catch (err) {
		Logger.log("Cloudflare donation enqueue failed seasonId=%s error=%s", seasonId, errorMessage_(err));
		return { ok: false, error: errorMessage_(err), seasonId: seasonId };
	}
}

function enqueueCloudflareCwlLeagueSignupsPublication_(reasonRaw) {
	if (!isCloudflareQueuedPublicationEnabled_()) return { ok: false, skipped: true, reason: "disabled" };
	try {
		const result = mutateCloudflarePublishQueueState_(function (state) {
			clearSupersededCloudflareDeadLetters_(state, "cwlLeagueSignups", "", "");
			state.dirty.cwlLeagueSignups = makeCloudflareDirtyRevision_(state, reasonRaw || "cwl-signups", { category: "cwlLeagueSignups" });
			return { ok: true, revision: state.dirty.cwlLeagueSignups.revision, pending: true, nextAttemptAt: cloudflareQueueNextAttemptIso_(state) };
		});
		return finalizeCloudflareEnqueueResult_(result);
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
		retention: request.retention || null,
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
	recordCloudflarePublishQueueHeartbeat_("serialization");
	const payloadBytes = assertCloudflareQueuedRequestBounds_(request);
	assertCloudflarePublishQueueDeadline_(15000, "Cloudflare publication serialization");
	const payloadText = JSON.stringify(request);
	const startedAt = Date.now();
	recordCloudflarePublishQueueHeartbeat_("http", { payloadBytes: payloadBytes });
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
		const error = new Error(String((parsed && parsed.error) || ("Cloudflare v2 publish failed with HTTP " + statusCode + ".")) + failure);
		error.publishFailure = parsed && parsed.failed || null;
		error.publishResponse = parsed || null;
		throw error;
	}
	recordCloudflarePublishQueueHeartbeat_("http-complete", { payloadBytes: payloadBytes, status: String(statusCode) });
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
			payload: buildCloudflarePublicBootstrapPayload_({
				compact: true,
				activeVersionIdOverride: versionId,
				previousVersionIdOverride: state.active.committedVersionId,
				generationOverride: state.active.targetGeneration,
				manifestOverride: manifestOverrideRaw,
			}),
		};
	}
	const previousVersionId = normalizeActiveVersionId_(state.active.committedVersionId);
	return { path: CLOUDFLARE_PUBLIC_DATA_BOOTSTRAP_PATH, payload: {
		schemaVersion: 2,
		generatedAt: new Date().toISOString(),
		currentVersionId: versionId,
		activeVersionId: versionId,
		previousVersionId: previousVersionId && previousVersionId !== versionId ? previousVersionId : "",
		generation: Math.max(0, toNonNegativeInt_(state.active.targetGeneration)),
		active: { versionId: versionId },
	} };
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

function addCloudflareMirroredQueueCommitDelete_(commits, pathRaw) {
	commits.push({ path: normalizeCloudflareDataObjectPath_(pathRaw), scope: "public", delete: true });
	commits.push({ path: normalizeCloudflareDataObjectPath_(pathRaw), scope: "bot", delete: true });
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
		// This phase publishes roster metadata and roster shards only. Reconstruct
		// them without downloading the large playerMetrics shard that is consumed
		// separately by the public-player-metrics and bot-derived phases.
		const manifest = readCloudflareTargetManifest_(versionId);
		const rosterMap = readCloudflareTargetRosterMap_(versionId, manifest);
		const rosterIds = Array.isArray(manifest.rosterIds) && manifest.rosterIds.length
			? manifest.rosterIds.map((id) => String(id || "").trim()).filter(Boolean)
			: Object.keys(rosterMap);
		const rosterData = validateRosterData_({
			schemaVersion: typeof manifest.schemaVersion === "number" && isFinite(manifest.schemaVersion) ? manifest.schemaVersion : 1,
			pageTitle: typeof manifest.pageTitle === "string" ? manifest.pageTitle : "",
			rosterOrder: Array.isArray(manifest.rosterOrder) ? manifest.rosterOrder : rosterIds,
			rosters: rosterIds.map((rosterId) => rosterMap[rosterId]).filter((roster) => roster && typeof roster === "object"),
			playerMetrics: createEmptyPlayerMetricsStore_(),
			lastUpdatedAt: String(manifest.lastUpdatedAt || ""),
			publicConfig: manifest.publicConfig && typeof manifest.publicConfig === "object" ? manifest.publicConfig : undefined,
		});
		const activeMeta = Object.assign({}, rosterData, { activeVersionId: versionId });
		const rosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
		delete activeMeta.rosters;
		delete activeMeta.playerMetrics;
		const descriptor = {
			schemaVersion: 2,
			activeVersionId: versionId,
			shardedActive: true,
			activeMeta: activeMeta,
			rostersPath: "activeVersions/" + encodedVersionId + "/rosters",
			playerMetricsMetaPath: "activeVersions/" + encodedVersionId + "/playerMetrics/meta",
			playerMetricsByTagPath: "activeVersions/" + encodedVersionId + "/playerMetrics/byTag",
		};
		return { label: "active-bot-versioned-active", request: { batchId: "active:" + versionId + ":bot-active", objects: [
			makeCloudflareQueueObject_("activeVersions/" + encodedVersionId + "/active", descriptor, "bot"),
			makeCloudflareQueueObject_("activeVersions/" + encodedVersionId + "/rosters", rosters, "bot"),
		] } };
	}
	if (phase === "bot-derived") {
		assertCloudflarePublishQueueDeadline_(60000, "active bot derived data");
		const metrics = readDecodedCloudflareQueueObject_(typeof buildActiveVersionPath_ === "function" ? buildActiveVersionPath_(versionId, "playerMetrics") : buildFirebaseChildPath_("activeVersions", encodeFirebaseObjectKey_(versionId), "playerMetrics")) || {};
		const byTag = metrics.byTag && typeof metrics.byTag === "object" ? metrics.byTag : {};
		const metricsMeta = Object.assign({}, metrics);
		delete metricsMeta.byTag;
		const linked = buildCloudflareLinkedAccountIndexes_({ playerMetrics: metrics });
		return { label: "active-bot-derived", request: { batchId: "active:" + versionId + ":bot-derived", objects: [
			makeCloudflareQueueObject_("activeVersions/" + encodedVersionId + "/playerMetrics/byTag", byTag, "bot"),
			makeCloudflareQueueObject_("activeVersions/" + encodedVersionId + "/playerMetrics/meta", metricsMeta, "bot"),
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
			{ scope: "bot", path: "activeVersions/" + encodedVersionId + "/rosters" },
			{ scope: "bot", path: "activeVersions/" + encodedVersionId + "/playerMetrics/byTag" },
			{ scope: "bot", path: "activeVersions/" + encodedVersionId + "/playerMetrics/meta" },
			{ scope: "bot", path: "activeVersions/" + encodedVersionId + "/indexes/linkedAccountsByDiscordId" },
			{ scope: "bot", path: "activeVersions/" + encodedVersionId + "/indexes/linkedAccountsByDiscordUsername" },
		];
		verifyCloudflareActiveVersionObjects_(versionId, required);
		const bootstrap = buildCloudflareQueuedBootstrapCommit_(state, versionId, manifest);
		const selector = buildCloudflareCommittedVersionSelector_(state, versionId);
		return { label: "active-atomic-pointer-commit", request: { batchId: "active:" + versionId + ":commit", commits: [
			// Compatibility/supporting metadata is idempotent and is written first.
			// The one authoritative cross-scope selector is the final operation.
			makeCloudflareQueueObject_("activePublished/currentManifest", manifest, "public"),
			bootstrap && makeCloudflareQueueObject_(bootstrap.path, bootstrap.payload, "public"),
			makeCloudflareQueueObject_("activePublished/currentVersionId", versionId, "public"),
			makeCloudflareQueueObject_("active/currentVersionId", versionId, "bot"),
			makeCloudflareQueueObject_(FIREBASE_ACTIVE_PUBLISHED_CURRENT_SELECTOR_PATH, selector, "public"),
		], commitGuard: { kind: "active", generation: state.active.targetGeneration, targetVersionId: versionId } } };
	}
	throw new Error("Unknown active publication phase: " + phase);
}

// Read-only instrumentation used by the sanitized production-shaped audit.
// It invokes the exact phase builders and Worker-envelope normalization without
// sending a request or mutating queue/Cloudflare state.
function measureCloudflareActivePhasePayloads_(versionIdRaw, optionsRaw) {
	const versionId = normalizeActiveVersionId_(versionIdRaw);
	if (!versionId) throw new Error("Active version id is required for phase measurement.");
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const state = createEmptyCloudflarePublishQueueState_();
	state.active.targetVersionId = versionId;
	state.active.targetGeneration = Math.max(1, toNonNegativeInt_(options.generation) || 1);
	state.active.committedVersionId = normalizeActiveVersionId_(options.previousVersionId);
	const phases = ["public-manifest-rosters", "public-player-metrics", "bot-active", "bot-derived", "commit"];
	return phases.map(function (phase) {
		state.active.phase = phase;
		const built = buildCloudflareActivePhaseRequest_(state, { phase: phase, cursor: 0, targetVersionId: versionId, generation: state.active.targetGeneration });
		const request = Object.assign({ requestId: "measure", publishedAt: "2026-01-01T00:00:00.000Z" }, built.request);
		const defaultScope = normalizeCloudflareDataScope_(request.scope || "public");
		const publishedAt = request.publishedAt;
		const objectBytes = (request.objects || []).map(function (entry) {
			const normalized = normalizeCloudflareQueuePublishObjectForSize_(entry, defaultScope, publishedAt);
			return { scope: normalized.scope, path: normalized.path.replace(/\.json$/i, ""), bytes: cloudflareQueueTextBytes_(normalized.payloadText) };
		});
		const commitBytes = (request.commits || []).map(function (entry) {
			const normalized = normalizeCloudflareQueueCommitForSize_(entry, defaultScope, publishedAt);
			return { scope: normalized.scope, path: normalized.path.replace(/\.json$/i, ""), operation: normalized.operation, bytes: cloudflareQueueTextBytes_(normalized.payloadText || "") };
		});
		return { phase: phase, label: built.label, objectBytes: objectBytes, commitBytes: commitBytes, envelopeBytes: cloudflareQueueNormalizedEnvelopeBytes_(request) };
	});
}

function firstCloudflareDirtyWork_(stateRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	const now = Date.now();
	let repairWork = null;
	if (isCloudflareQueueMarkerEligible_(state.dirty.repair, now)) {
		const repair = state.dirty.repair;
		repairWork = Object.assign({
			category: "repair",
			revision: repair.revision,
			step: repair.step,
			seasonIndex: repair.seasonIndex,
			eventIndex: repair.eventIndex,
			donationIndex: repair.donationIndex,
			seasonIds: repair.seasonIds,
			eventIds: repair.eventIds,
			donationSeasonIds: repair.donationSeasonIds,
			diagnostics: repair.diagnostics,
			reasons: repair.reasons,
			scopes: repair.scopes,
		}, { dispatchKey: cloudflareRepairDispatchKey_(repair) });
	}
	const eventIds = Object.keys(state.dirty.events).sort();
	let liveWork = null;
	for (let i = 0; i < eventIds.length && !liveWork; i++) if (isCloudflareQueueMarkerEligible_(state.dirty.events[eventIds[i]], now)) liveWork = { category: "event", key: eventIds[i], revision: state.dirty.events[eventIds[i]].revision };
	const aggregateEventIds = Object.keys(state.dirty.cwlAggregates).sort();
	for (let i = 0; i < aggregateEventIds.length && !liveWork; i++) {
		const eventId = aggregateEventIds[i];
		const kinds = state.dirty.cwlAggregates[eventId] || {};
		if (isCloudflareQueueMarkerEligible_(kinds.live, now)) liveWork = { category: "cwlAggregate", key: eventId, kind: "live", revision: kinds.live.revision };
		else if (isCloudflareQueueMarkerEligible_(kinds.final, now)) liveWork = { category: "cwlAggregate", key: eventId, kind: "final", revision: kinds.final.revision };
	}
	const donationIds = Object.keys(state.dirty.donationSeasons).sort();
	for (let i = 0; i < donationIds.length && !liveWork; i++) if (isCloudflareQueueMarkerEligible_(state.dirty.donationSeasons[donationIds[i]], now)) liveWork = { category: "donationSeason", key: donationIds[i], revision: state.dirty.donationSeasons[donationIds[i]].revision };
	if (!liveWork && isCloudflareQueueMarkerEligible_(state.dirty.cwlLeagueSignups, now)) liveWork = { category: "cwlLeagueSignups", revision: state.dirty.cwlLeagueSignups.revision };
	if (!liveWork && isCloudflareQueueMarkerEligible_(state.dirty.seasonPointers, now)) liveWork = { category: "seasonPointers", revision: state.dirty.seasonPointers.revision };
	if (!liveWork && isCloudflareQueueMarkerEligible_(state.dirty.bootstrap, now)) liveWork = { category: "bootstrap", revision: state.dirty.bootstrap.revision };
	if (!liveWork && isCloudflareQueueMarkerEligible_(state.dirty.retention, now)) liveWork = { category: "retention", revision: state.dirty.retention.revision, cursor: String(state.dirty.retention.cursor || "") };
	if (repairWork && (!liveWork || state.dirty.repairBurst < CLOUDFLARE_QUEUE_REPAIR_BURST_LIMIT_)) return repairWork;
	return liveWork || repairWork;
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
			diagnostics: Array.isArray(work.diagnostics) ? work.diagnostics.slice(-100) : [],
		};
	if (!Array.isArray(discovered.diagnostics)) discovered.diagnostics = Array.isArray(work.diagnostics) ? work.diagnostics.slice(-100) : [];
	const commits = [];
	const objects = [];
	const deletes = [];
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
		const eventPath = buildFirebaseChildPath_(SEASON_EVENTS_BY_ID_PATH, encodeFirebaseObjectKey_(eventId));
		if (!event) {
			addCloudflareMirroredQueueDelete_(deletes, eventPath);
			["live", "final"].forEach((kind) => addCloudflareMirroredQueueDelete_(deletes, buildCwlSeasonEventAggregatePath_(eventId, kind)));
			discovered.diagnostics = discovered.diagnostics.concat([{ at: new Date().toISOString(), category: "missing-historical-event", eventId: eventId }]).slice(-100);
		} else addCloudflareMirroredQueueObject_(objects, eventPath, event);
		if (event && normalizeSeasonEventType_(event.type) === "cwl" && typeof readCwlSeasonEventAggregate_ === "function") {
			["live", "final"].forEach((kind) => {
				const aggregate = readCwlSeasonEventAggregate_(eventId, kind);
				if (aggregate && aggregate.eventId) addCloudflareMirroredQueueObject_(objects, buildCwlSeasonEventAggregatePath_(eventId, kind), projectCloudflareCwlAggregateForEvent_(event, aggregate, kind));
				else addCloudflareMirroredQueueDelete_(deletes, buildCwlSeasonEventAggregatePath_(eventId, kind));
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
		if (!seasonPointers) {
			addCloudflareMirroredQueueDelete_(deletes, seasonPath);
			discovered.diagnostics = discovered.diagnostics.concat([{ at: new Date().toISOString(), category: "missing-historical-season-map", seasonId: seasonId }]).slice(-100);
		} else addCloudflareMirroredQueueObject_(objects, seasonPath, seasonPointers);
		repairAdvance = Object.assign({}, discovered, {
			seasonIndex: discovered.seasonIndex + 1,
			step: discovered.seasonIndex + 1 >= discovered.seasonIds.length ? "donations" : "season-maps",
		});
	} else if (discovered.step === "donations" && discovered.donationIndex < discovered.donationSeasonIds.length) {
		const seasonId = discovered.donationSeasonIds[discovered.donationIndex];
		const overlayPath = buildFirebaseChildPath_(buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "bySeason"), encodeFirebaseObjectKey_(seasonId));
		const overlay = readDecodedCloudflareQueueObject_(overlayPath);
		if (overlay) {
			addCloudflareMirroredQueueObject_(objects, overlayPath, overlay);
		} else {
			const currentDonation = readDecodedCloudflareQueueObject_(buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "current"));
			const currentDonationSeasonId = String(currentDonation && currentDonation.seasonId || "").trim();
			if (currentDonationSeasonId === seasonId) {
				const error = new Error("Current donation pointer references a missing overlay: " + seasonId);
				error.resumable = true;
				throw error;
			}
			// An archived event may legitimately outlive its detached overlay. Remove
			// any stale mirror object and continue; only donationRefresh/current is
			// forbidden from advertising a missing overlay.
			addCloudflareMirroredQueueDelete_(deletes, overlayPath);
		}
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
	return { objects: objects, deletes: deletes, commits: commits, repairAdvance: repairAdvance };
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
	} else if (work.category === "retention") {
		const state = normalizeCloudflarePublishQueueState_(stateRaw);
		return {
			objects: objects,
			deletes: deletes,
			commits: commits,
			retention: {
				cursor: String(work.cursor || ""),
				limit: 100,
				preserveVersionIds: [state.active.committedVersionId, state.active.targetVersionId].filter(function (value, index, all) { return value && all.indexOf(value) === index; }),
			},
		};
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
	else if (work.category === "retention") {
		if (state.dirty.retention && toNonNegativeInt_(state.dirty.retention.revision) === revision) {
			const advance = work.retentionAdvance && typeof work.retentionAdvance === "object" ? work.retentionAdvance : null;
			if (!advance || advance.done === true || !advance.cursor) {
				state.dirty.retention = null;
				state.lastRetentionVersionId = state.active.committedVersionId;
			}
			else state.dirty.retention = Object.assign({}, state.dirty.retention, { cursor: String(advance.cursor || ""), dispatch: null, failure: null, updatedAt: new Date().toISOString() });
		}
	}
	else if (work.category === "repair") {
		if (state.dirty.repair && toNonNegativeInt_(state.dirty.repair.revision) === revision) {
			const advance = work.repairAdvance && typeof work.repairAdvance === "object" ? work.repairAdvance : null;
			if (!advance || advance.step === "done") { state.dirty.repair = null; state.dirty.repairBurst = 0; }
			else state.dirty.repair = Object.assign({}, state.dirty.repair, {
				step: advance.step,
				seasonIndex: Math.max(0, toNonNegativeInt_(advance.seasonIndex)),
				eventIndex: Math.max(0, toNonNegativeInt_(advance.eventIndex)),
				donationIndex: Math.max(0, toNonNegativeInt_(advance.donationIndex)),
				seasonIds: Array.isArray(advance.seasonIds) ? advance.seasonIds.slice() : [],
				eventIds: Array.isArray(advance.eventIds) ? advance.eventIds.slice() : [],
				donationSeasonIds: Array.isArray(advance.donationSeasonIds) ? advance.donationSeasonIds.slice() : [],
				diagnostics: Array.isArray(advance.diagnostics) ? advance.diagnostics.slice(-100) : (state.dirty.repair.diagnostics || []),
				failure: null,
				dispatch: null,
				updatedAt: new Date().toISOString(),
			});
		}
	}
}

function resetCloudflareQueueRetry_(state, batchRaw) {
	state.infrastructure = { attempt: 0, nextAttemptAt: "", lastError: "", lastFailureAt: "" };
	state.lastSuccessAt = new Date().toISOString();
	state.lastBatch = batchRaw && typeof batchRaw === "object" ? batchRaw : null;
}

function cloudflareQueueClaimItemKey_(claimRaw) {
	const claim = claimRaw && typeof claimRaw === "object" ? claimRaw : {};
	if (claim.category === "active") return ["active", claim.targetVersionId, claim.generation, claim.phase, claim.cursor].join(":");
	return [claim.category || "unknown", claim.key || "", claim.kind || "", claim.revision || 0, claim.dispatchKey || claim.cursor || 0].join(":");
}

function getCloudflareQueueClaimMarker_(state, claimRaw) {
	const claim = claimRaw && typeof claimRaw === "object" ? claimRaw : {};
	if (claim.category === "active") {
		if (state.active.targetVersionId !== claim.targetVersionId || state.active.targetGeneration !== claim.generation || state.active.phase !== claim.phase || state.active.cursor !== claim.cursor) return null;
		return state.active;
	}
	if (claim.category === "event") return state.dirty.events[claim.key] || null;
	if (claim.category === "cwlAggregate") return state.dirty.cwlAggregates[claim.key] && state.dirty.cwlAggregates[claim.key][claim.kind] || null;
	if (claim.category === "donationSeason") return state.dirty.donationSeasons[claim.key] || null;
	if (claim.category === "cwlLeagueSignups") return state.dirty.cwlLeagueSignups;
	if (claim.category === "seasonPointers") return state.dirty.seasonPointers;
	if (claim.category === "repair") return state.dirty.repair;
	if (claim.category === "bootstrap") return state.dirty.bootstrap;
	if (claim.category === "retention") return state.dirty.retention;
	return null;
}

function advanceCloudflareRepairPastDeadLetter_(repair) {
	if (!repair) return;
	if (repair.step === "events") repair.eventIndex = Math.max(0, toNonNegativeInt_(repair.eventIndex)) + 1;
	else if (repair.step === "season-maps") repair.seasonIndex = Math.max(0, toNonNegativeInt_(repair.seasonIndex)) + 1;
	else if (repair.step === "donations") repair.donationIndex = Math.max(0, toNonNegativeInt_(repair.donationIndex)) + 1;
	else if (repair.step === "pointers") repair.step = "done";
	if (repair.step === "events" && repair.eventIndex >= (repair.eventIds || []).length) repair.step = "season-maps";
	if (repair.step === "season-maps" && repair.seasonIndex >= (repair.seasonIds || []).length) repair.step = "donations";
	if (repair.step === "donations" && repair.donationIndex >= (repair.donationSeasonIds || []).length) repair.step = "pointers";
	repair.failure = null;
	repair.dispatch = null;
	repair.updatedAt = new Date().toISOString();
}

function recordCloudflareQueueFailure_(messageRaw, batchRaw, ownerTokenRaw, claimRaw) {
	const message = String(messageRaw || "Cloudflare publication failed.").slice(0, 2000);
	const claim = claimRaw && typeof claimRaw === "object" ? claimRaw : null;
	if (!claim) return recordCloudflareInfrastructureFailure_(message, batchRaw, ownerTokenRaw);
	const permanent = /cannot fit|hard limit|payload limit|roster count exceeds|invalid publish object|malformed|unsupported/i.test(message);
	return mutateCloudflarePublishQueueState_(function (state) {
		const marker = getCloudflareQueueClaimMarker_(state, claim);
		if (!marker) return { stale: true, pending: hasPendingCloudflarePublishWork_(state), nextAttemptAt: cloudflareQueueNextAttemptIso_(state) };
		if (claim.category !== "active" && toNonNegativeInt_(marker.revision) !== toNonNegativeInt_(claim.revision)) return { stale: true, pending: hasPendingCloudflarePublishWork_(state), nextAttemptAt: cloudflareQueueNextAttemptIso_(state) };
		const previous = normalizeCloudflareQueueFailure_(marker.failure);
		const itemKey = cloudflareQueueClaimItemKey_(claim);
		const attempt = previous && previous.itemKey === itemKey ? previous.attempt + 1 : 1;
		const delay = Math.min(CLOUDFLARE_PUBLISH_QUEUE_MAX_RETRY_MS, CLOUDFLARE_PUBLISH_QUEUE_BASE_RETRY_MS * Math.pow(2, Math.min(10, attempt - 1)));
		const deadLetter = permanent || attempt >= CLOUDFLARE_QUEUE_ITEM_MAX_ATTEMPTS_;
		const failed = batchRaw && batchRaw.failed && typeof batchRaw.failed === "object" ? batchRaw.failed : {};
		marker.failure = {
			revision: claim.category === "active" ? claim.generation : claim.revision,
			itemKey: itemKey,
			attempt: attempt,
			nextAttemptAt: deadLetter ? "" : new Date(Date.now() + delay).toISOString(),
			lastError: message,
			lastFailureAt: new Date().toISOString(),
			deadLetter: deadLetter,
			permanent: permanent,
			scope: String(failed.scope || ""),
			path: String(failed.path || ""),
		};
		marker.dispatch = null;
		if (deadLetter) {
			state.deadLetters[itemKey] = Object.assign({}, marker.failure, { category: claim.category, key: claim.key || "", kind: claim.kind || "" });
			if (claim.category === "repair") {
				marker.diagnostics = (Array.isArray(marker.diagnostics) ? marker.diagnostics : []).concat([{ at: new Date().toISOString(), category: "repair-dead-letter", itemKey: itemKey, error: message }]).slice(-100);
				advanceCloudflareRepairPastDeadLetter_(marker);
				if (marker.step === "done") state.dirty.repair = null;
			}
		}
		state.lastBatch = batchRaw && typeof batchRaw === "object" ? batchRaw : null;
		return { attempt: attempt, nextAttemptAt: cloudflareQueueNextAttemptIso_(state), permanent: permanent, deadLetter: deadLetter, itemKey: itemKey, pending: hasPendingCloudflarePublishWork_(state) };
	}, ownerTokenRaw);
}

function recordCloudflareInfrastructureFailure_(messageRaw, batchRaw, ownerTokenRaw) {
	const message = String(messageRaw || "Cloudflare publication infrastructure failed.").slice(0, 2000);
	return mutateCloudflarePublishQueueState_(function (state) {
		const attempt = Math.max(0, toNonNegativeInt_(state.infrastructure.attempt)) + 1;
		const delay = Math.min(CLOUDFLARE_PUBLISH_QUEUE_MAX_RETRY_MS, CLOUDFLARE_PUBLISH_QUEUE_BASE_RETRY_MS * Math.pow(2, Math.min(10, attempt - 1)));
		state.infrastructure = { attempt: attempt, nextAttemptAt: new Date(Date.now() + delay).toISOString(), lastError: message, lastFailureAt: new Date().toISOString() };
		state.lastBatch = batchRaw && typeof batchRaw === "object" ? batchRaw : null;
		return { attempt: attempt, nextAttemptAt: state.infrastructure.nextAttemptAt, infrastructure: true, pending: hasPendingCloudflarePublishWork_(state) };
	}, ownerTokenRaw);
}

function allocateCloudflarePhaseClaim_(stateRaw, workRaw, ownerTokenRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	const work = workRaw && typeof workRaw === "object" ? workRaw : null;
	return mutateCloudflarePublishQueueState_(function (latest) {
		if (work && work.category === "active") {
			if (latest.active.targetVersionId !== state.active.targetVersionId || latest.active.targetGeneration !== state.active.targetGeneration) return { stale: true };
			if (!isCloudflareQueueMarkerEligible_(latest.active, Date.now())) return { deferred: true, nextAttemptAt: cloudflareQueueNextAttemptIso_(latest) };
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
		const marker = latest.dirty[work.category === "repair" ? "repair" : work.category === "event" ? "events" : work.category === "cwlAggregate" ? "cwlAggregates" : work.category === "donationSeason" ? "donationSeasons" : work.category === "cwlLeagueSignups" ? "cwlLeagueSignups" : work.category === "seasonPointers" ? "seasonPointers" : work.category === "retention" ? "retention" : "bootstrap"];
		const currentMarker = work.category === "event" || work.category === "donationSeason"
			? marker && marker[work.key]
			: work.category === "cwlAggregate"
				? marker && marker[work.key] && marker[work.key][work.kind]
				: marker;
		if (!currentMarker || toNonNegativeInt_(currentMarker.revision) !== toNonNegativeInt_(work.revision)) return { stale: true };
		if (!isCloudflareQueueMarkerEligible_(currentMarker, Date.now())) return { deferred: true, nextAttemptAt: cloudflareQueueNextAttemptIso_(latest) };
		const dispatchKey = work.category === "repair" ? cloudflareRepairDispatchKey_(work) : String(work.cursor || 0);
		if (currentMarker.dispatch && currentMarker.dispatch.revision === work.revision && currentMarker.dispatch.key === dispatchKey) return Object.assign({}, work, { dispatchGuard: currentMarker.dispatch.guard });
		latest.nextDispatchGeneration = Math.max(Math.max(0, toNonNegativeInt_(latest.nextDispatchGeneration)) + 1, Date.now());
		const batchId = work.category + ":" + String(work.key || work.kind || "current") + ":" + work.revision + ":" + String(work.cursor || 0);
		const guard = { kind: "queued-v2", generation: latest.nextDispatchGeneration, batchId: batchId };
		currentMarker.dispatch = { revision: work.revision, cursor: toNonNegativeInt_(work.cursor), key: dispatchKey, guard: guard };
		return Object.assign({}, work, { dispatchGuard: guard });
	}, ownerTokenRaw);
}

function reconcileCloudflareAcceptedCommit_(state, sentRaw) {
	const response = sentRaw && sentRaw.response && typeof sentRaw.response === "object" ? sentRaw.response : {};
	const accepted = response.acceptedCommit && typeof response.acceptedCommit === "object" ? response.acceptedCommit : null;
	if (!accepted) return null;
	const generation = Math.max(0, toNonNegativeInt_(accepted.generation));
	const versionId = normalizeActiveVersionId_(accepted.targetVersionId);
	if (!generation || !versionId || generation < Math.max(0, toNonNegativeInt_(state.active.committedGeneration))) return null;
	state.active.committedVersionId = versionId;
	state.active.committedGeneration = generation;
	return { generation: generation, targetVersionId: versionId, committedAt: String(accepted.committedAt || "") };
}

function completeCloudflareActivePhase_(claimRaw, sentRaw, ownerTokenRaw) {
	const claim = claimRaw && typeof claimRaw === "object" ? claimRaw : {};
	return mutateCloudflarePublishQueueState_(function (state) {
		const acceptedCommit = reconcileCloudflareAcceptedCommit_(state, sentRaw);
		if (state.active.targetVersionId !== claim.targetVersionId || state.active.targetGeneration !== claim.generation || state.active.phase !== claim.phase || state.active.cursor !== claim.cursor) {
			return { stale: true, acceptedCommit: acceptedCommit, pending: hasPendingCloudflarePublishWork_(state), nextAttemptAt: cloudflareQueueNextAttemptIso_(state) };
		}
		state.active.dispatch = null;
		state.active.failure = null;
		if (claim.phase === "public-manifest-rosters") state.active.phase = "public-player-metrics";
		else if (claim.phase === "public-player-metrics") state.active.phase = "bot-active";
		else if (claim.phase === "bot-active") state.active.phase = "bot-derived";
		else if (claim.phase === "bot-derived") state.active.phase = "commit";
		else if (claim.phase === "commit") {
			state.active.committedVersionId = claim.targetVersionId;
			state.active.committedGeneration = Math.max(state.active.committedGeneration, claim.generation);
			state.active.phase = "idle";
			state.active.cursor = 0;
			state.active.republish = false;
			state.active.migration = null;
			state.dirty.retention = makeCloudflareDirtyRevision_(state, "active-version-commit", { category: "retention", cursor: "" });
		}
		state.active.updatedAt = new Date().toISOString();
		state.active.activeBurst = Math.max(0, toNonNegativeInt_(state.active.activeBurst)) + 1;
		resetCloudflareQueueRetry_(state, { category: "active", phase: claim.phase, targetVersionId: claim.targetVersionId, response: sentRaw && sentRaw.response });
		return { ok: true, category: "active", phase: claim.phase, acceptedCommit: acceptedCommit, pending: hasPendingCloudflarePublishWork_(state), nextAttemptAt: cloudflareQueueNextAttemptIso_(state) };
	}, ownerTokenRaw);
}

function completeCloudflareDirtyPhase_(claimRaw, sentRaw, ownerTokenRaw) {
	const claim = claimRaw && typeof claimRaw === "object" ? claimRaw : {};
	if (claim.category === "retention" && !claim.retentionAdvance) claim.retentionAdvance = sentRaw && sentRaw.response && sentRaw.response.retention || null;
	return mutateCloudflarePublishQueueState_(function (state) {
		const current = firstCloudflareDirtyWork_(state);
		if (!current || current.category !== claim.category || toNonNegativeInt_(current.revision) !== toNonNegativeInt_(claim.revision) || (claim.category === "repair" && current.dispatchKey !== claim.dispatchKey)) return { stale: true, pending: hasPendingCloudflarePublishWork_(state) };
		clearCloudflareDirtyWorkIfRevisionMatches_(state, claim);
		state.active.activeBurst = 0;
		state.dirty.repairBurst = claim.category === "repair" ? Math.max(0, toNonNegativeInt_(state.dirty.repairBurst)) + 1 : 0;
		resetCloudflareQueueRetry_(state, { category: claim.category, revision: claim.revision, cursor: claim.cursor, response: sentRaw && sentRaw.response });
		return { ok: true, category: claim.category, pending: hasPendingCloudflarePublishWork_(state), nextAttemptAt: cloudflareQueueNextAttemptIso_(state) };
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

// Revalidate hard-kill recovery after a durable dispatch claim. Enqueue and
// pending-worker reconciliation install the independent recovery path earlier;
// this owner check prevents claimed remote work if that path later disappears.
function ensureCloudflareClaimRecoveryScheduled_(ownerTokenRaw, claimRaw) {
	const ownerToken = String(ownerTokenRaw || "").trim();
	if (!ownerToken) return { scheduled: false, skipped: true, reason: "ownerless-direct-call" };
	const lease = parseCloudflarePublishQueueLockState_(PropertiesService.getScriptProperties().getProperty(CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY));
	if (!lease || lease.token !== ownerToken || lease.expiresAt <= Date.now()) {
		const error = new Error("Cloudflare queue lease ownership was lost before recovery scheduling.");
		error.code = "CLOUDFLARE_QUEUE_LEASE_LOST";
		throw error;
	}
	let scheduled = null;
	try {
		scheduled = scheduleCloudflarePublishWorkerRecovery_(true, lease);
	} catch (err) {
		markCloudflarePublishSchedulerRepair_(errorMessage_(err), "", {
			claim: cloudflareQueueClaimItemKey_(claimRaw),
			recovery: true,
		});
		const failure = new Error("Cloudflare claimed-work recovery scheduling failed: " + errorMessage_(err));
		failure.code = "CLOUDFLARE_QUEUE_RECOVERY_UNAVAILABLE";
		failure.resumable = true;
		throw failure;
	}
	if (!scheduled || scheduled.scheduled !== true) {
		const reason = String(scheduled && (scheduled.error || scheduled.reason) || "recovery-trigger-unavailable");
		markCloudflarePublishSchedulerRepair_(reason, "", {
			claim: cloudflareQueueClaimItemKey_(claimRaw),
			recovery: true,
		});
		const failure = new Error("Cloudflare claimed-work recovery trigger is unavailable: " + reason);
		failure.code = "CLOUDFLARE_QUEUE_RECOVERY_UNAVAILABLE";
		failure.resumable = true;
		throw failure;
	}
	return scheduled;
}

function renewCloudflarePublishQueueLeaseWithRecoveryOrThrow_(ownerTokenRaw, claimRaw) {
	renewCloudflarePublishQueueLeaseOrThrow_(ownerTokenRaw);
	return ensureCloudflareClaimRecoveryScheduled_(ownerTokenRaw, claimRaw);
}

// The final active request is allowed to publish only after a fresh
// owner-checked canonical read. Enqueueing a newer target clears the dispatch
// claim, so a superseded request becomes resumable before it reaches Worker.
function isCloudflareActiveCommitClaimCurrent_(claimRaw, ownerTokenRaw) {
	if (ownerTokenRaw) renewCloudflarePublishQueueLeaseWithRecoveryOrThrow_(ownerTokenRaw, claimRaw);
	const latest = readCloudflarePublishQueueState_();
	if (!cloudflareActiveClaimMatchesState_(latest, claimRaw)) return false;
	if (ownerTokenRaw) renewCloudflarePublishQueueLeaseWithRecoveryOrThrow_(ownerTokenRaw, claimRaw);
	return true;
}

function processCloudflareActiveQueueRequest_(stateRaw, ownerTokenRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	recordCloudflarePublishQueueHeartbeat_("claim", { status: "active" });
	const claim = allocateCloudflarePhaseClaim_(state, { category: "active" }, ownerTokenRaw);
	if (!claim || claim.stale) return { ok: true, skipped: true, reason: "superseded" };
	if (claim.deferred) return { ok: true, skipped: true, reason: "backoff", nextAttemptAt: claim.nextAttemptAt };
	cloudflarePublishQueueCurrentClaim_ = claim;
	recordCloudflarePublishQueueHeartbeat_("claim-durable", { claim: claim });
	try {
		recordCloudflarePublishQueueHeartbeat_("scheduling", { claim: claim, status: "recovery" });
		ensureCloudflareClaimRecoveryScheduled_(ownerTokenRaw, claim);
		recordCloudflarePublishQueueHeartbeat_("firebase-build", { claim: claim });
		const built = buildCloudflareActivePhaseRequest_(state, claim);
		const request = Object.assign({}, built.request, { dispatchGuard: claim.dispatchGuard, revision: claim.generation });
		request.batchId = claim.dispatchGuard.batchId;
		if (claim.phase === "commit") request.commitGuard = { kind: "active", generation: claim.generation, targetVersionId: claim.targetVersionId };
		if (claim.phase === "commit" && !isCloudflareActiveCommitClaimCurrent_(claim, ownerTokenRaw)) {
			return { ok: true, skipped: true, reason: "superseded" };
		}
		if (ownerTokenRaw) renewCloudflarePublishQueueLeaseWithRecoveryOrThrow_(ownerTokenRaw, claim);
		const sent = sendCloudflareQueuedV2Request_(request, built.label, ownerTokenRaw);
		recordCloudflarePublishQueueHeartbeat_("completion-cas", { claim: claim, payloadBytes: sent && sent.payloadBytes });
		return completeCloudflareActivePhase_(claim, sent, ownerTokenRaw);
	} catch (err) {
		if (err && (err.code === "CLOUDFLARE_QUEUE_LEASE_LOST" || err.code === "CLOUDFLARE_QUEUE_DEADLINE" || err.code === "CLOUDFLARE_QUEUE_RECOVERY_UNAVAILABLE")) throw err;
		const failure = recordCloudflareQueueFailure_(errorMessage_(err), { category: "active", phase: claim.phase, targetVersionId: claim.targetVersionId, failed: err && err.publishFailure || null }, ownerTokenRaw, claim);
		return { ok: false, error: errorMessage_(err), failure: failure, claim: claim };
	} finally {
		cloudflarePublishQueueCurrentClaim_ = null;
	}
}

function processCloudflareDirtyQueueRequest_(stateRaw, ownerTokenRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	const work = firstCloudflareDirtyWork_(state);
	if (!work) return { ok: true, skipped: true, reason: "empty" };
	recordCloudflarePublishQueueHeartbeat_("claim", { claim: work, status: work.category });
	const claim = allocateCloudflarePhaseClaim_(state, work, ownerTokenRaw);
	if (!claim || claim.stale) return { ok: true, skipped: true, reason: "superseded" };
	if (claim.deferred) return { ok: true, skipped: true, reason: "backoff", nextAttemptAt: claim.nextAttemptAt };
	cloudflarePublishQueueCurrentClaim_ = claim;
	recordCloudflarePublishQueueHeartbeat_("claim-durable", { claim: claim });
	try {
		recordCloudflarePublishQueueHeartbeat_("scheduling", { claim: claim, status: "recovery" });
		ensureCloudflareClaimRecoveryScheduled_(ownerTokenRaw, claim);
		recordCloudflarePublishQueueHeartbeat_("firebase-build", { claim: claim });
		const built = buildCloudflareDirtyRequest_(state, claim);
		const request = Object.assign({}, built, { dispatchGuard: claim.dispatchGuard, revision: claim.revision, batchId: claim.dispatchGuard.batchId });
		if (claim.category === "repair") {
			claim.repairAdvance = built.repairAdvance || null;
			delete request.repairAdvance;
		}
		if (ownerTokenRaw) renewCloudflarePublishQueueLeaseWithRecoveryOrThrow_(ownerTokenRaw, claim);
		const sent = sendCloudflareQueuedV2Request_(request, built.label || claim.category, ownerTokenRaw);
		if (claim.category === "retention") claim.retentionAdvance = sent && sent.response && sent.response.retention || null;
		recordCloudflarePublishQueueHeartbeat_("completion-cas", { claim: claim, payloadBytes: sent && sent.payloadBytes });
		return completeCloudflareDirtyPhase_(claim, sent, ownerTokenRaw);
	} catch (err) {
		if (err && (err.code === "CLOUDFLARE_QUEUE_LEASE_LOST" || err.code === "CLOUDFLARE_QUEUE_DEADLINE" || err.code === "CLOUDFLARE_QUEUE_RECOVERY_UNAVAILABLE")) throw err;
		const failure = recordCloudflareQueueFailure_(errorMessage_(err), { category: claim.category, revision: claim.revision, failed: err && err.publishFailure || null }, ownerTokenRaw, claim);
		return { ok: false, error: errorMessage_(err), failure: failure, claim: claim };
	} finally {
		cloudflarePublishQueueCurrentClaim_ = null;
	}
}

function markCloudflarePublishQueueReconstructionDirty_(state, reasonRaw, canonicalVersionIdRaw, scopesRaw) {
	const canonicalSourceVersionId = normalizeActiveVersionId_(canonicalVersionIdRaw);
	const botRepairMigration = state.versionMigrations && state.versionMigrations["bot-repair:" + canonicalSourceVersionId];
	const mappedVersionId = normalizeActiveVersionId_(botRepairMigration && botRepairMigration.safeVersionId);
	const canonicalVersionId = mappedVersionId && state.active.committedVersionId === mappedVersionId ? mappedVersionId : canonicalSourceVersionId;
	if (canonicalVersionId && state.active.targetVersionId !== canonicalVersionId && state.active.committedVersionId !== canonicalVersionId) {
		state.active.targetVersionId = canonicalVersionId;
		state.active.targetGeneration = Math.max(Math.max(0, toNonNegativeInt_(state.active.targetGeneration)) + 1, Date.now());
		state.active.phase = "public-manifest-rosters";
		state.active.cursor = 0;
		state.active.dispatch = null;
		state.active.failure = null;
	}
	const repair = mergeCloudflareRepairRequest_(state, reasonRaw || "drift-repair", scopesRaw || ["current", "previous"]);
	if (!state.dirty.cwlLeagueSignups) state.dirty.cwlLeagueSignups = makeCloudflareDirtyRevision_(state, reasonRaw || "drift-repair", { category: "cwlLeagueSignups" });
	state.lastDriftRepairAt = new Date().toISOString();
	return { active: canonicalVersionId ? { ok: true, versionId: canonicalVersionId } : { ok: true, skipped: true, reason: "missing-canonical-version" }, repair: { ok: true, category: "repair", revision: repair.revision, reasons: repair.reasons }, signups: { ok: true, category: "cwlLeagueSignups" }, pending: hasPendingCloudflarePublishWork_(state), nextAttemptAt: cloudflareQueueNextAttemptIso_(state) };
}

function repairCloudflarePublishQueueDrift_(ownerTokenRaw, canonicalVersionOverrideRaw, optionsRaw) {
	if (!isCloudflareQueuedPublicationEnabled_()) return { ok: false, skipped: true, reason: "disabled" };
	const canonicalVersionId = normalizeActiveVersionId_(canonicalVersionOverrideRaw) || readPublishedActiveVersionId_();
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const reason = String(options.reason || "drift-repair");
	const result = mutateCloudflarePublishQueueState_(function (state) { return markCloudflarePublishQueueReconstructionDirty_(state, reason, canonicalVersionId, options.scopes); }, ownerTokenRaw);
	return { ok: true, active: result.active, repair: result.repair, signups: result.signups, pending: result.pending, nextAttemptAt: result.nextAttemptAt };
}

function cloudflarePublishWorkerTick(eventRaw, triggerKindRaw) {
	const startedAtMs = Date.now();
	const triggerKind = String(triggerKindRaw || "continuation");
	const recoveryHandler = cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_HANDLER_NAME", "cloudflarePublishWorkerRecoveryTick");
	const fired = triggerKind === "recovery"
		? consumeCloudflareFiredTriggerIdentity_(eventRaw, cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_ID_PROPERTY", "CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_ID"), cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_AT_PROPERTY", "CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_AT"), recoveryHandler)
		: consumeCloudflareFiredTriggerIdentity_(eventRaw, CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_ID_PROPERTY, CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_AT_PROPERTY, CLOUDFLARE_PUBLISH_QUEUE_HANDLER_NAME);
	const lease = tryAcquireCloudflarePublishQueueLease_("cloudflare-publish-worker", 0);
	if (!lease) {
		let scheduling = null;
		// A fired one-shot has been consumed even when another invocation owns the
		// queue. Reinstall both local paths beyond that owner's lease without any
		// Firebase or Cloudflare request. Direct/admin overlap without a trigger UID
		// remains an immediate no-op.
		if (fired && fired.consumed && isCloudflareQueuedPublicationEnabled_()) {
			const heldLease = parseCloudflarePublishQueueLockState_(PropertiesService.getScriptProperties().getProperty(CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY));
			const cooldownUntilMs = typeof getRuntimeUrlFetchQuotaCooldownUntilMs_ === "function" ? getRuntimeUrlFetchQuotaCooldownUntilMs_() : 0;
			const continuationNotBeforeMs = Math.max(cooldownUntilMs, heldLease && heldLease.expiresAt ? heldLease.expiresAt + 1000 : startedAtMs + CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_DELAY_MS);
			scheduling = ensureCloudflarePendingTriggerPaths_(undefined, true, continuationNotBeforeMs, heldLease || {}, {
				recoveryNotBefore: cooldownUntilMs > startedAtMs ? cooldownUntilMs : 0,
			});
			recordCloudflarePendingTriggerPaths_(scheduling, continuationNotBeforeMs, { overlap: true, firedTriggerId: fired.firedId });
		}
		return { skipped: true, reason: "lease-busy", scheduling: scheduling };
	}
	cloudflarePublishQueueDeadlineMs_ = startedAtMs + cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_EXECUTION_BUDGET_MS", 240000);
	beginCloudflarePublishQueueExecution_(lease.token, startedAtMs);
	recordCloudflarePublishQueueHeartbeat_("lease", { status: "acquired" });
	let finalPendingKnown = true;
	let result = null;
	const results = [];
	let activeSchedulerRepair = null;
	try {
		if (!isCloudflareQueuedPublicationEnabled_()) { finalPendingKnown = false; return { ok: true, skipped: true, reason: "disabled" }; }
		recordCloudflarePublishQueueHeartbeat_("trigger-handling", { status: triggerKind + (fired && fired.consumed ? ":consumed" : ":direct") });
		const cooldownUntilMs = typeof getRuntimeUrlFetchQuotaCooldownUntilMs_ === "function" ? getRuntimeUrlFetchQuotaCooldownUntilMs_() : 0;
		if (cooldownUntilMs > Date.now()) {
			const scheduling = recordCloudflarePendingTriggerPaths_(
				ensureCloudflarePendingTriggerPaths_(lease.token, true, cooldownUntilMs, lease),
				cooldownUntilMs,
				{ cooldown: true },
			);
			recordCloudflarePublishQueueHeartbeat_("scheduling", { status: "urlfetch-cooldown" });
			return {
				ok: true,
				skipped: true,
				reason: "urlFetchQuotaCooldown",
				cooldownUntil: new Date(cooldownUntilMs).toISOString(),
				scheduling: scheduling,
			};
		}
		if (typeof clearExpiredRuntimeUrlFetchQuotaCooldown_ === "function") clearExpiredRuntimeUrlFetchQuotaCooldown_();
		const schedulerMarker = readCloudflarePublishSchedulerRepair_();
		if (normalizeActiveVersionId_(schedulerMarker.activeVersionId)) {
			recordCloudflarePublishQueueHeartbeat_("queue-read", { status: "active-scheduler-repair" });
			activeSchedulerRepair = recoverCloudflareActiveSchedulerRepairForWorker_(lease.token);
		}
		recordCloudflarePublishQueueHeartbeat_("queue-read");
		let state = readCloudflarePublishQueueState_();
		if (state.paused) { finalPendingKnown = false; return { ok: true, skipped: true, reason: "paused", activeSchedulerRepair: activeSchedulerRepair }; }
		if (parseIsoToMs_(state.infrastructure.nextAttemptAt) > Date.now()) {
			finalPendingKnown = hasPendingCloudflarePublishWork_(state);
			const scheduling = recordCloudflarePendingTriggerPaths_(ensureCloudflarePendingTriggerPaths_(lease.token, finalPendingKnown, state.infrastructure.nextAttemptAt, lease), state.infrastructure.nextAttemptAt);
			return { ok: true, skipped: true, reason: "infrastructure-backoff", nextAttemptAt: state.infrastructure.nextAttemptAt, scheduling: scheduling };
		}
		if (!hasPendingCloudflarePublishWork_(state)) { finalPendingKnown = false; return { ok: true, pending: false, results: [], activeSchedulerRepair: activeSchedulerRepair }; }
		const initialNextAttemptAt = cloudflareQueueNextAttemptIso_(state);
		const initialScheduling = recordCloudflarePendingTriggerPaths_(ensureCloudflarePendingTriggerPaths_(lease.token, true, initialNextAttemptAt, lease), initialNextAttemptAt);
		if (!initialScheduling.scheduled) return { ok: false, skipped: true, reason: "trigger-path-unavailable", pending: true, scheduling: initialScheduling };
		const maxItems = Math.max(1, Math.min(20, toNonNegativeInt_(cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_MAX_ITEMS_PER_INVOCATION", 8)) || 8));
		while (results.length < maxItems && canAdmitAnotherCloudflareQueueItem_()) {
			const activePending = state.active.targetVersionId && (state.active.targetVersionId !== state.active.committedVersionId || state.active.republish || state.active.phase !== "idle") && !isCloudflareQueueFailureDead_(state.active.failure);
			const activeEligible = activePending && isCloudflareQueueMarkerEligible_(state.active, Date.now());
			const dirty = firstCloudflareDirtyWork_(state);
			const dirtyEligible = dirty && (!activeEligible || state.active.phase === "commit" || state.active.activeBurst >= cloudflareQueueConstant_("CLOUDFLARE_PUBLISH_QUEUE_MAX_ACTIVE_BURST_BEFORE_DIRTY", 3));
			if (dirtyEligible && state.active.phase !== "commit") result = processCloudflareDirtyQueueRequest_(state, lease.token);
			else if (activeEligible) result = processCloudflareActiveQueueRequest_(state, lease.token);
			else if (dirty) result = processCloudflareDirtyQueueRequest_(state, lease.token);
			else result = { ok: true, skipped: true, reason: "item-backoff", nextAttemptAt: cloudflareQueueNextAttemptIso_(state) };
			results.push(result);
			recordCloudflarePublishQueueHeartbeat_("checkpoint", { processedItem: !(result && result.skipped), status: result && (result.reason || result.category || (result.ok === false ? "failed" : "ok")) });
			if (result && result.skipped && (result.reason === "backoff" || result.reason === "item-backoff")) break;
			recordCloudflarePublishQueueHeartbeat_("queue-read");
			state = readCloudflarePublishQueueState_();
			if (!hasPendingCloudflarePublishWork_(state)) break;
		}
		if (!canAdmitAnotherCloudflareQueueItem_() && hasPendingCloudflarePublishWork_(state)) recordCloudflarePublishQueueHeartbeat_("controlled-exit-pending", { status: "admission-reserve" });
		recordCloudflarePublishQueueHeartbeat_("queue-read");
		state = readCloudflarePublishQueueState_();
		finalPendingKnown = hasPendingCloudflarePublishWork_(state);
		if (finalPendingKnown) {
			const nextAttemptAt = cloudflareQueueNextAttemptIso_(state);
			recordCloudflarePublishQueueHeartbeat_("scheduling", { status: "continuation-and-recovery" });
			recordCloudflarePendingTriggerPaths_(ensureCloudflarePendingTriggerPaths_(lease.token, true, nextAttemptAt, lease), nextAttemptAt);
		}
		// When the observed state is terminal, do not broadly enumerate/delete
		// dynamic triggers here. A concurrent enqueue may have committed immediately
		// after this Firebase read and reused those same identities. Each installed
		// one-shot instead consumes only its own UID and exits immediately on empty.
		return { ok: results.every(function (item) { return !item || item.ok !== false; }), results: results, pending: finalPendingKnown, activeSchedulerRepair: activeSchedulerRepair };
	} catch (err) {
		if (err && err.code === "CLOUDFLARE_QUEUE_LEASE_LOST") return { ok: false, skipped: true, reason: "lease-lost", error: errorMessage_(err) };
		const cooldownUntilMs = typeof getRuntimeUrlFetchQuotaCooldownUntilMs_ === "function" ? getRuntimeUrlFetchQuotaCooldownUntilMs_() : 0;
		if (cooldownUntilMs > Date.now()) {
			finalPendingKnown = true;
			const scheduling = recordCloudflarePendingTriggerPaths_(ensureCloudflarePendingTriggerPaths_(lease.token, true, cooldownUntilMs, lease), cooldownUntilMs, { cooldown: true, afterFailure: true });
			return { ok: false, skipped: true, reason: "urlFetchQuotaCooldown", error: errorMessage_(err), cooldownUntil: new Date(cooldownUntilMs).toISOString(), pending: true, scheduling: scheduling };
		}
		let retry = null;
		try { retry = recordCloudflareInfrastructureFailure_(errorMessage_(err), { error: errorMessage_(err) }, lease.token); } catch (recordErr) {
			if (recordErr && recordErr.code === "CLOUDFLARE_QUEUE_LEASE_LOST") throw recordErr;
			Logger.log("Cloudflare publish retry state could not be updated: %s", errorMessage_(recordErr));
		}
		finalPendingKnown = true;
		try {
			recordCloudflarePublishQueueHeartbeat_("scheduling", { status: "retry" });
			recordCloudflarePendingTriggerPaths_(ensureCloudflarePendingTriggerPaths_(lease.token, true, retry && retry.nextAttemptAt, lease), retry && retry.nextAttemptAt);
		} catch (scheduleErr) { markCloudflarePublishSchedulerRepair_(errorMessage_(scheduleErr), retry && retry.nextAttemptAt); Logger.log("Cloudflare pending trigger scheduling failed: %s", errorMessage_(scheduleErr)); }
		return { ok: false, error: errorMessage_(err), retry: retry, pending: true, result: result };
	} finally {
		// No Firebase read, Cloudflare request, trigger enumeration, or watchdog
		// reconciliation is allowed from finally. Lease release is local only.
		recordCloudflarePublishQueueHeartbeat_("cleanup", { status: finalPendingKnown ? "pending" : "idle" });
		recordCloudflarePublishQueueHeartbeat_("controlled-exit", { status: finalPendingKnown ? "pending" : "idle" });
		releaseCloudflarePublishQueueLease_(lease.token);
		cloudflarePublishQueueDeadlineMs_ = 0;
		cloudflarePublishQueueExecution_ = null;
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
	addAge(dirty.cwlLeagueSignups); addAge(dirty.seasonPointers); addAge(dirty.repair); addAge(dirty.bootstrap); addAge(dirty.retention);
	const oldest = ages.length ? Math.min.apply(Math, ages) : 0;
	const props = PropertiesService.getScriptProperties();
	const lease = parseCloudflarePublishQueueLockState_(props.getProperty(CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY));
	const cooldownUntilMs = typeof getRuntimeUrlFetchQuotaCooldownUntilMs_ === "function" ? getRuntimeUrlFetchQuotaCooldownUntilMs_() : 0;
	return {
		mode: getCloudflarePublicationMode_(), paused: state.paused,
		canonicalActiveVersionId: readPublishedActiveVersionId_(), committedActiveVersionId: state.active.committedVersionId,
		activeTargetVersionId: state.active.targetVersionId, activeTargetGeneration: state.active.targetGeneration,
		activePhase: state.active.phase, activeCursor: state.active.cursor,
		pendingDirtyCounts: { events: Object.keys(dirty.events).length, cwlAggregateEvents: Object.keys(dirty.cwlAggregates).length, donationSeasons: Object.keys(dirty.donationSeasons).length, cwlLeagueSignups: dirty.cwlLeagueSignups ? 1 : 0, seasonPointers: dirty.seasonPointers ? 1 : 0, repair: dirty.repair ? 1 : 0, bootstrap: dirty.bootstrap ? 1 : 0, retention: dirty.retention ? 1 : 0 },
		oldestPendingAt: oldest ? new Date(oldest).toISOString() : "", infrastructureRetryAttempt: state.infrastructure.attempt, nextRetryAt: cloudflareQueueNextAttemptIso_(state), lastError: state.infrastructure.lastError, deadLetterCount: Object.keys(state.deadLetters).length, deadLetters: state.deadLetters, lastSuccessAt: state.lastSuccessAt, lastBatch: state.lastBatch,
		triggerId: getCloudflareTriggerId_(CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_ID_PROPERTY), hasTrigger: !!getCloudflareTriggerId_(CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_ID_PROPERTY), triggerAt: getCloudflareTriggerAtMs_(CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_AT_PROPERTY) ? new Date(getCloudflareTriggerAtMs_(CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_AT_PROPERTY)).toISOString() : "",
		dynamicTriggers: getCloudflareDynamicTriggerDiagnostics_(),
		schedulerRepair: readCloudflarePublishSchedulerRepair_(),
		urlFetchCooldown: { active: cooldownUntilMs > Date.now(), until: cooldownUntilMs ? new Date(cooldownUntilMs).toISOString() : "", untilMs: cooldownUntilMs },
		lease: lease ? { owner: lease.owner, expiresAt: new Date(lease.expiresAt).toISOString() } : null,
		heartbeat: readCloudflarePublishQueueHeartbeat_(),
	};
}

function initializeCloudflarePublishQueue_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const requestedRaw = String(options.committedVersionId || "").trim();
	const canonicalRaw = requestedRaw || (typeof readPublishedActiveVersionIdRaw_ === "function" ? readPublishedActiveVersionIdRaw_() : readPublishedActiveVersionId_());
	let migration = null;
	let canonical = normalizeActiveVersionId_(canonicalRaw);
	if (canonicalRaw && !isCloudflareSafeActiveVersionId_(canonicalRaw)) {
		migration = migrateUnsafeCloudflareActiveVersion_(canonicalRaw, "queue-initialization");
		canonical = migration.versionId;
	}
	let committed = normalizeActiveVersionId_(requestedRaw);
	let verified = null;
	if (canonical && typeof verifyCloudflarePublicActiveVersionId_ === "function") verified = verifyCloudflarePublicActiveVersionId_(canonical);
	if (!committed && verified && verified.ok === true) committed = normalizeActiveVersionId_(verified.actualVersionId || canonical);
	if (migration && migration.migrated) committed = "";
	const sharedSelectorPresent = options.sharedSelectorPresent === true || !!(verified && verified.sharedSelector && verified.sharedSelector.currentVersionId);
	const result = mutateCloudflarePublishQueueState_(function (state) {
		// Never replace a known committed selector during migration. Only an empty
		// queue may be initialized from verified Cloudflare state.
		if (!state.active.committedVersionId && committed) state.active.committedVersionId = committed;
		if (migration && migration.migrated) {
			state.versionMigrations[migration.legacyVersionId] = { safeVersionId: canonical, migratedAt: new Date().toISOString(), reason: "queue-initialization" };
			if (!state.active.targetVersionId || state.active.targetVersionId === migration.legacyVersionId) {
				state.active.targetVersionId = canonical;
				state.active.targetGeneration = Math.max(Math.max(0, toNonNegativeInt_(state.active.targetGeneration)) + 1, Date.now());
				state.active.phase = "public-manifest-rosters"; state.active.cursor = 0; state.active.dispatch = null; state.active.failure = null;
				state.active.migration = { kind: "unsafe-version", sourceVersionId: migration.legacyVersionId, targetVersionId: canonical };
			}
		} else if (committed && !sharedSelectorPresent && (!state.active.targetVersionId || state.active.phase === "idle")) {
			state.active.targetVersionId = canonical;
			state.active.targetGeneration = Math.max(Math.max(0, toNonNegativeInt_(state.active.targetGeneration)) + 1, Date.now());
			state.active.phase = "public-manifest-rosters"; state.active.cursor = 0; state.active.dispatch = null; state.active.failure = null; state.active.republish = true;
			state.active.migration = { kind: "shared-selector", sourceVersionId: canonical, targetVersionId: canonical };
		}
		if (state.active.committedVersionId || canonical) markCloudflarePublishQueueReconstructionDirty_(state, "queue-initialization", canonical);
		if (!state.initializedAt) state.initializedAt = new Date().toISOString();
		return { pending: hasPendingCloudflarePublishWork_(state), committedVersionId: state.active.committedVersionId, migration: migration, sharedSelectorPresent: sharedSelectorPresent, nextAttemptAt: cloudflareQueueNextAttemptIso_(state) };
	});
	const scheduled = isCloudflareQueuedPublicationEnabled_() ? finalizeCloudflareEnqueueResult_(result) : result;
	return { ok: true, committedVersionId: result.committedVersionId, migration: migration, sharedSelectorPresent: sharedSelectorPresent, scheduling: scheduled.scheduling || null, diagnostics: getCloudflarePublishQueueDiagnostics_() };
}

function setCloudflarePublicationMode_(payloadRaw, secretOrPasswordRaw) {
	assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw);
	const payload = payloadRaw && typeof payloadRaw === "object" ? payloadRaw : {};
	const mode = String(payload.mode || "").trim().toLowerCase();
	if (![CLOUDFLARE_PUBLICATION_MODE_QUEUED_V2, CLOUDFLARE_PUBLICATION_MODE_DISABLED, CLOUDFLARE_PUBLICATION_MODE_LEGACY_MANUAL].includes(mode)) throw new Error("Invalid Cloudflare publication mode. Use queued-v2, disabled, or legacy-manual.");
	let queueState = null;
	if (mode === CLOUDFLARE_PUBLICATION_MODE_QUEUED_V2) {
		queueState = readCloudflarePublishQueueState_();
		if (!queueState.active.committedVersionId) throw new Error("Initialize the Cloudflare queue with a committed active version before enabling queued-v2.");
	}
	PropertiesService.getScriptProperties().setProperty(CLOUDFLARE_PUBLICATION_MODE_PROPERTY, mode);
	if (mode === CLOUDFLARE_PUBLICATION_MODE_QUEUED_V2 && hasPendingCloudflarePublishWork_(queueState)) {
		const nextAttemptAt = cloudflareQueueNextAttemptIso_(queueState);
		recordCloudflarePendingTriggerPaths_(ensureCloudflarePendingTriggerPaths_(undefined, true, nextAttemptAt, null), nextAttemptAt);
	}
	else removeCloudflarePublishWorkerTriggers_(false);
	return getCloudflarePublishQueueDiagnostics_();
}

function retryCloudflarePublishQueue(payloadRaw, secretOrPasswordRaw) {
	assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw);
	const payload = payloadRaw && typeof payloadRaw === "object" ? payloadRaw : {};
	const itemKey = String(payload.itemKey || "").trim();
	const result = mutateCloudflarePublishQueueState_(function (state) {
		if (!itemKey) state.infrastructure = { attempt: 0, nextAttemptAt: "", lastError: "", lastFailureAt: "" };
		else if (state.deadLetters[itemKey]) {
			const dead = state.deadLetters[itemKey];
			const claim = { category: dead.category, key: dead.key, kind: dead.kind, revision: dead.revision, generation: dead.revision };
			const marker = getCloudflareQueueClaimMarker_(state, claim);
			if (marker && marker.failure && marker.failure.itemKey === itemKey) marker.failure = null;
			delete state.deadLetters[itemKey];
		}
		return { pending: hasPendingCloudflarePublishWork_(state), nextAttemptAt: cloudflareQueueNextAttemptIso_(state) };
	});
	finalizeCloudflareEnqueueResult_(result);
	return getCloudflarePublishQueueDiagnostics_();
}

// Explicit, idempotent migration entry point for a missing/corrupted selected
// bot generation. The selected immutable objects are never overwritten. A
// fresh canonical Firebase version is created first, then the normal complete
// public/bot phase sequence verifies it before selector-last commit.
function repairCloudflareBotVersionObjects_(payloadRaw) {
	const payload = payloadRaw && typeof payloadRaw === "object" ? payloadRaw : {};
	const requestedVersion = String(payload.versionId || "").trim();
	const before = readCloudflarePublishQueueState_();
	if (before.active.migration && before.active.migration.kind === "bot-repair" && before.active.targetVersionId && before.active.phase !== "idle") {
		return finalizeCloudflareEnqueueResult_({ ok: true, idempotent: true, sourceVersionId: before.active.migration.sourceVersionId, versionId: before.active.targetVersionId, generation: before.active.targetGeneration, pending: true, nextAttemptAt: cloudflareQueueNextAttemptIso_(before) });
	}
	const sourceVersionId = requestedVersion || before.active.committedVersionId || (typeof readPublishedActiveVersionIdRaw_ === "function" ? readPublishedActiveVersionIdRaw_() : readPublishedActiveVersionId_());
	if (!sourceVersionId) throw new Error("A committed active version is required for bot-object repair.");
	const otherUncommittedTarget = before.active.targetVersionId && before.active.targetVersionId !== before.active.committedVersionId;
	if (otherUncommittedTarget) return { ok: false, skipped: true, reason: "newer-active-target-in-progress", targetVersionId: before.active.targetVersionId };
	const snapshot = readActiveRosterSnapshotFromVersion_(sourceVersionId);
	if (!snapshot || !snapshot.rosterData) throw new Error("The canonical active snapshot is incomplete for bot-object repair.");
	const freshVersionId = createActiveVersionId_("bot-repair");
	// This is a publication-only immutable copy. Keep Firebase's canonical
	// pointer on the source snapshot; a concurrent real active-version B owns
	// that pointer and must never be clobbered by repair.
	const written = writeActiveRosterVersionShards_(freshVersionId, snapshot.rosterData, { source: "cloudflare-bot-repair", publish: false, sourceVersionId: sourceVersionId });
	const result = mutateCloudflarePublishQueueState_(function (state) {
		const newerTarget = state.active.targetVersionId && state.active.targetVersionId !== state.active.committedVersionId;
		if (newerTarget) return { ok: false, skipped: true, reason: "newer-active-target-in-progress", targetVersionId: state.active.targetVersionId, pending: hasPendingCloudflarePublishWork_(state), nextAttemptAt: cloudflareQueueNextAttemptIso_(state) };
		state.active.targetVersionId = freshVersionId;
		state.active.targetGeneration = Math.max(Math.max(0, toNonNegativeInt_(state.active.targetGeneration)) + 1, Date.now());
		state.active.phase = "public-manifest-rosters";
		state.active.cursor = 0;
		state.active.dispatch = null;
		state.active.failure = null;
		state.active.republish = false;
		state.active.migration = { kind: "bot-repair", sourceVersionId: sourceVersionId, targetVersionId: freshVersionId, createdAt: new Date().toISOString() };
		state.versionMigrations["bot-repair:" + sourceVersionId] = { safeVersionId: freshVersionId, migratedAt: new Date().toISOString(), reason: "corrupt-selected-bot-data" };
		state.active.updatedAt = new Date().toISOString();
		return { ok: true, idempotent: false, sourceVersionId: sourceVersionId, versionId: freshVersionId, manifest: written && written.manifest || null, generation: state.active.targetGeneration, pending: true, nextAttemptAt: cloudflareQueueNextAttemptIso_(state) };
	});
	return result && result.pending ? finalizeCloudflareEnqueueResult_(result) : result;
}

function runCloudflarePublishWorkerTick(payloadRaw, secretOrPasswordRaw) { assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw); return cloudflarePublishWorkerTick(); }

function cloudflarePublishWorkerRecoveryTick(eventRaw) { return cloudflarePublishWorkerTick(eventRaw, "recovery"); }

function pauseCloudflarePublishQueue(payloadRaw, secretOrPasswordRaw) {
	assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw);
	const payload = payloadRaw && typeof payloadRaw === "object" ? payloadRaw : {};
	const paused = payload.paused !== false;
	const result = mutateCloudflarePublishQueueState_(function (state) { state.paused = paused; state.pauseReason = paused ? "admin" : ""; return { pending: !paused && hasPendingCloudflarePublishWork_(state), nextAttemptAt: cloudflareQueueNextAttemptIso_(state) }; });
	if (paused) removeCloudflarePublishWorkerTriggers_(false); else scheduleCloudflareAfterMutation_(result);
	return getCloudflarePublishQueueDiagnostics_();
}

function repairCloudflarePublishQueue(payloadRaw, secretOrPasswordRaw) {
	assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw);
	const payload = payloadRaw && typeof payloadRaw === "object" ? payloadRaw : {};
	const result = repairCloudflarePublishQueueDrift_(undefined, payload.versionId, { reason: payload.reason || "admin-drift-repair", scopes: payload.scopes });
	return Object.assign({}, result, finalizeCloudflareEnqueueResult_(result));
}

// Called by the low-frequency permanent watchdog in publishAndTriggers.js.
// Dynamic scheduling failures are represented locally so this recovery path
// remains available even when the failed invocation could not persist remote
// failure state before its deadline.
function repairCloudflarePublishSchedulingFromPermanentWatchdog_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const properties = PropertiesService.getScriptProperties();
	const marker = readCloudflarePublishSchedulerRepair_();
	if (options.localOnly === true) {
		if (!isCloudflareQueuedPublicationEnabled_()) {
			// The permanent watchdog has no generation guard against a concurrent
			// re-enable/enqueue. Leave installed one-shots to consume their exact
			// identities instead of broadly deleting a newly published path.
			return { ok: true, localOnly: true, pending: false, removed: 0, reason: "disabled", exactIdentityCleanup: true };
		}
		const diagnostics = getCloudflareDynamicTriggerDiagnostics_();
		const hasLocalIntent = !!(
			marker.pending ||
			diagnostics.continuation.configuredId || diagnostics.continuation.actualCount ||
			diagnostics.recovery.configuredId || diagnostics.recovery.actualCount
		);
		if (!hasLocalIntent) return { ok: true, localOnly: true, pending: false, diagnostics: diagnostics, reason: "no-local-intent" };
		const notBeforeMs = Math.max(
			Number(options.notBeforeMs) || 0,
			parseIsoToMs_(marker.nextAttemptAt),
			typeof getRuntimeUrlFetchQuotaCooldownUntilMs_ === "function" ? getRuntimeUrlFetchQuotaCooldownUntilMs_() : 0,
		);
		const lease = parseCloudflarePublishQueueLockState_(properties.getProperty(CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY));
		const paths = recordCloudflarePendingTriggerPaths_(ensureCloudflarePendingTriggerPaths_(undefined, true, notBeforeMs, lease || {}), notBeforeMs, { localOnly: true });
		return { ok: !!paths.scheduled, localOnly: true, pending: true, repaired: !!paths.scheduled, continuation: paths.continuation, recovery: paths.recovery, markerRetained: !!normalizeActiveVersionId_(marker.activeVersionId) };
	}
	if (!isCloudflareQueuedPublicationEnabled_()) return { ok: true, pending: false, reason: "disabled", exactIdentityCleanup: true };
	let activeRepair = null;
	if (normalizeActiveVersionId_(marker.activeVersionId)) activeRepair = recoverCloudflareActiveSchedulerRepairForWorker_(undefined);
	let markerBeforeState = readCloudflarePublishSchedulerRepairSnapshot_();
	// A marker may have been installed while the first bounded repair was
	// finishing. Give it one immediate bounded consumption attempt; if another
	// writer wins later, the compare-and-clear checks below retain and schedule it.
	if (normalizeActiveVersionId_(markerBeforeState.marker.activeVersionId)) {
		activeRepair = recoverCloudflareActiveSchedulerRepairForWorker_(undefined);
		markerBeforeState = readCloudflarePublishSchedulerRepairSnapshot_();
	}
	let state = readCloudflarePublishQueueState_();
	if (
		state.active.committedVersionId &&
		state.lastRetentionVersionId !== state.active.committedVersionId &&
		!state.dirty.retention
	) {
		mutateCloudflarePublishQueueState_(function (latest) {
			if (latest.active.committedVersionId && latest.lastRetentionVersionId !== latest.active.committedVersionId && !latest.dirty.retention) {
				latest.dirty.retention = makeCloudflareDirtyRevision_(latest, "permanent-watchdog-retention", { category: "retention", cursor: "" });
			}
			return { pending: hasPendingCloudflarePublishWork_(latest) };
		});
		markerBeforeState = readCloudflarePublishSchedulerRepairSnapshot_();
		state = readCloudflarePublishQueueState_();
	}
	const pending = hasPendingCloudflarePublishWork_(state);
	if (!pending) {
		const markerAfterState = readCloudflarePublishSchedulerRepairSnapshot_();
		if (markerAfterState.marker.pending === true) {
			const markerNotBefore = parseIsoToMs_(markerAfterState.marker.nextAttemptAt);
			const leaseForMarker = parseCloudflarePublishQueueLockState_(properties.getProperty(CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY));
			const markerPaths = recordCloudflarePendingTriggerPaths_(ensureCloudflarePendingTriggerPaths_(undefined, true, markerNotBefore, leaseForMarker || {}), markerNotBefore, { markerOnly: true });
			return { ok: !!markerPaths.scheduled, pending: true, repaired: !!(activeRepair && activeRepair.repaired), activeRepair: activeRepair, markerOnly: true, continuation: markerPaths.continuation, recovery: markerPaths.recovery };
		}
		let markerCleared = false;
		if (markerBeforeState.raw && markerAfterState.raw === markerBeforeState.raw) markerCleared = clearCloudflarePublishSchedulerRepair_(true, markerBeforeState.raw);
		return { ok: true, pending: false, repaired: !!(activeRepair && activeRepair.repaired), activeRepair: activeRepair, markerCleared: markerCleared, exactIdentityCleanup: true };
	}
	const nextAttemptAt = cloudflareQueueNextAttemptIso_(state);
	const lease = parseCloudflarePublishQueueLockState_(properties.getProperty(CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY));
	const paths = recordCloudflarePendingTriggerPaths_(ensureCloudflarePendingTriggerPaths_(undefined, true, nextAttemptAt, lease || {}), nextAttemptAt);
	return { ok: !!paths.scheduled, pending: true, repaired: !!paths.scheduled, activeRepair: activeRepair, continuation: paths.continuation, recovery: paths.recovery };
}
function repairCloudflareBotVersionObjects(payloadRaw, secretOrPasswordRaw) { assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw); return repairCloudflareBotVersionObjects_(payloadRaw); }
function inspectCloudflarePublishQueue(payloadRaw, secretOrPasswordRaw) { assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw); return getCloudflarePublishQueueDiagnostics_(); }
function initializeCloudflarePublishQueue(payloadRaw, secretOrPasswordRaw) { assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw); return initializeCloudflarePublishQueue_(payloadRaw); }
function setCloudflarePublicationMode(payloadRaw, secretOrPasswordRaw) { return setCloudflarePublicationMode_(payloadRaw, secretOrPasswordRaw); }
