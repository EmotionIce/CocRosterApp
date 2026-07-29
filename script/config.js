// Global constants and harmless caches extracted from the legacy monolith.

// Asset publishing, locking, and refresh orchestration constants.
const ASSET_TEXT_CACHE_VERSION = "v2";
const ASSET_TEXT_CACHE_TTL_ROSTER_SECONDS = 30;
const ASSET_TEXT_CACHE_TTL_STATIC_SECONDS = 600;
const ACTIVE_ROSTER_FILENAME = "roster-data.json";
const ACTIVE_ROSTER_JOB_LOCK_KEY = "ACTIVE_ROSTER_JOB_LOCK";
const ACTIVE_ROSTER_JOB_LOCK_WAIT_MS = 30 * 1000;
const ACTIVE_ROSTER_JOB_LOCK_LEASE_MS = 15 * 60 * 1000;
const ACTIVE_ROSTER_JOB_LOCK_POLL_MS = 250;
const ADMIN_UNLOCK_V2_DISABLED_PROPERTY = "ADMIN_UNLOCK_V2_DISABLED";
const ADMIN_EDITING_ROSTER_SCHEMA_VERSION = 1;
const AUTO_REFRESH_HANDLER_NAME = "autoRefreshActiveRosterTick";
const AUTO_REFRESH_JOB_HANDLER_NAME = "autoRefreshWorkerTick";
const AUTO_REFRESH_LEGACY_JOB_HANDLER_NAME = "autoRefreshJobResumeTick";
const AUTO_REFRESH_INTERVAL_HOURS = 2;
const AUTO_REFRESH_INTERVAL_MS = AUTO_REFRESH_INTERVAL_HOURS * 60 * 60 * 1000;
const AUTO_REFRESH_ENABLED_PROPERTY = "AUTO_REFRESH_ENABLED";
const AUTO_REFRESH_TRIGGER_ID_PROPERTY = "AUTO_REFRESH_TRIGGER_ID";
const AUTO_REFRESH_JOB_TRIGGER_ID_PROPERTY = "AUTO_REFRESH_JOB_TRIGGER_ID";
const AUTO_REFRESH_JOB_TRIGGER_AT_PROPERTY = "AUTO_REFRESH_JOB_TRIGGER_AT";
const AUTO_REFRESH_JOB_WATCHDOG_TRIGGER_ID_PROPERTY = "AUTO_REFRESH_JOB_WATCHDOG_TRIGGER_ID";
const AUTO_REFRESH_JOB_WATCHDOG_TRIGGER_AT_PROPERTY = "AUTO_REFRESH_JOB_WATCHDOG_TRIGGER_AT";
const AUTO_REFRESH_JOB_PENDING_FRESH_RETRY_PROPERTY = "AUTO_REFRESH_JOB_PENDING_FRESH_RETRY";
const AUTO_REFRESH_SCHEDULER_REPAIR_MARKER_PROPERTY = "AUTO_REFRESH_SCHEDULER_REPAIR";
const AUTO_REFRESH_LAST_RUN_STARTED_AT_PROPERTY = "AUTO_REFRESH_LAST_RUN_STARTED_AT";
const AUTO_REFRESH_LAST_RUN_FINISHED_AT_PROPERTY = "AUTO_REFRESH_LAST_RUN_FINISHED_AT";
const AUTO_REFRESH_LAST_RUN_STATUS_PROPERTY = "AUTO_REFRESH_LAST_RUN_STATUS";
const AUTO_REFRESH_LAST_RUN_SUMMARY_PROPERTY = "AUTO_REFRESH_LAST_RUN_SUMMARY";
const AUTO_REFRESH_LAST_ISSUE_SUMMARY_PROPERTY = "AUTO_REFRESH_LAST_ISSUE_SUMMARY";
const AUTO_REFRESH_LAST_RUN_ERROR_PROPERTY = "AUTO_REFRESH_LAST_RUN_ERROR";
const AUTO_REFRESH_LAST_RUN_ISSUE_COUNT_PROPERTY = "AUTO_REFRESH_LAST_RUN_ISSUE_COUNT";
const AUTO_REFRESH_LAST_ARCHIVE_DATE_PROPERTY = "AUTO_REFRESH_LAST_ARCHIVE_DATE";
const AUTO_REFRESH_LAST_ARCHIVE_CLEANUP_DATE_PROPERTY = "AUTO_REFRESH_LAST_ARCHIVE_CLEANUP_DATE";
const DONATION_REFRESH_HANDLER_NAME = "donationRefreshTick";
const DONATION_REFRESH_INTERVAL_MINUTES = 15;
const DONATION_REFRESH_LOCK_KEY = "DONATION_REFRESH_LOCK";
const DONATION_REFRESH_LOCK_LEASE_MS = ACTIVE_ROSTER_JOB_LOCK_LEASE_MS;
const DONATION_REFRESH_ENABLED_PROPERTY = "DONATION_REFRESH_ENABLED";
const DONATION_REFRESH_TRIGGER_ID_PROPERTY = "DONATION_REFRESH_TRIGGER_ID";
const DONATION_REFRESH_LAST_RUN_STARTED_AT_PROPERTY = "DONATION_REFRESH_LAST_RUN_STARTED_AT";
const DONATION_REFRESH_LAST_RUN_FINISHED_AT_PROPERTY = "DONATION_REFRESH_LAST_RUN_FINISHED_AT";
const DONATION_REFRESH_LAST_RUN_STATUS_PROPERTY = "DONATION_REFRESH_LAST_RUN_STATUS";
const DONATION_REFRESH_LAST_RUN_SUMMARY_PROPERTY = "DONATION_REFRESH_LAST_RUN_SUMMARY";
const DONATION_REFRESH_LAST_RUN_ERROR_PROPERTY = "DONATION_REFRESH_LAST_RUN_ERROR";
const DONATION_REFRESH_LAST_SEASON_ID_PROPERTY = "DONATION_REFRESH_LAST_SEASON_ID";
const DONATION_REFRESH_LAST_WRITE_AT_PROPERTY = "DONATION_REFRESH_LAST_WRITE_AT";
const DONATION_REFRESH_RETENTION_LAST_MAINTENANCE_AT_PROPERTY = "DONATION_REFRESH_RETENTION_LAST_MAINTENANCE_AT";
const DONATION_REFRESH_RETENTION_MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DONATION_REFRESH_EXECUTION_BUDGET_MS = 240 * 1000;
const DONATION_REFRESH_CLEANUP_RESERVE_MS = 30 * 1000;
const REGULAR_WAR_FINALIZATION_HANDLER_NAME = "regularWarFinalizationTick";
const REGULAR_WAR_FINALIZATION_TRIGGER_ID_PROPERTY = "REGULAR_WAR_FINALIZATION_TRIGGER_ID";
const REGULAR_WAR_FINALIZATION_TRIGGER_AT_PROPERTY = "REGULAR_WAR_FINALIZATION_TRIGGER_AT";
const REGULAR_WAR_FINALIZATION_INITIAL_DELAY_MS = 2 * 60 * 1000;
const REGULAR_WAR_FINALIZATION_MIN_TRIGGER_DELAY_MS = 60 * 1000;
const REGULAR_WAR_FINALIZATION_RETRY_DELAYS_MS = [10 * 60 * 1000, 30 * 60 * 1000, 60 * 60 * 1000, 2 * 60 * 60 * 1000];
const ACTIVE_DATA_LAST_SUCCESSFUL_WRITE_AT_PROPERTY = "ACTIVE_DATA_LAST_SUCCESSFUL_WRITE_AT";
const ACTIVE_DATA_LAST_SUCCESSFUL_WRITE_SOURCE_PROPERTY = "ACTIVE_DATA_LAST_SUCCESSFUL_WRITE_SOURCE";
const ACTIVE_DATA_WRITE_SOURCE_UNKNOWN = "unknown";
const ACTIVE_DATA_WRITE_SOURCE_PUBLISH = "publish";
const ACTIVE_DATA_WRITE_SOURCE_AUTO_REFRESH = "auto-refresh";
const ACTIVE_DATA_WRITE_SOURCE_DISCORD_SYNC = "discord-sync";
const STATIC_ASSET_BASE_URL = "https://turtlecoc.4jbf82gng5.workers.dev/";
const STATIC_ASSET_VERSION_PROPERTY = "STATIC_ASSET_VERSION";
const STATIC_ASSET_VERSION_FALLBACK = "v1";
const CLOUDFLARE_PUBLIC_DATA_BASE_URL_PROPERTY = "CLOUDFLARE_PUBLIC_DATA_BASE_URL";
const CLOUDFLARE_PUBLIC_DATA_PUBLISH_SECRET_PROPERTY = "CLOUDFLARE_PUBLIC_DATA_PUBLISH_SECRET";
const CLOUDFLARE_PUBLIC_DATA_ENABLED_PROPERTY = "CLOUDFLARE_PUBLIC_DATA_ENABLED";
const CLOUDFLARE_PUBLIC_DATA_LAST_PUBLISH_AT_PROPERTY = "CLOUDFLARE_PUBLIC_DATA_LAST_PUBLISH_AT";
const CLOUDFLARE_PUBLIC_DATA_LAST_PUBLISH_STATUS_PROPERTY = "CLOUDFLARE_PUBLIC_DATA_LAST_PUBLISH_STATUS";
const CLOUDFLARE_PUBLIC_DATA_LAST_PUBLISH_ERROR_PROPERTY = "CLOUDFLARE_PUBLIC_DATA_LAST_PUBLISH_ERROR";
const CLOUDFLARE_PUBLICATION_MODE_PROPERTY = "CLOUDFLARE_PUBLICATION_MODE";
const CLOUDFLARE_PUBLICATION_MODE_QUEUED_V2 = "queued-v2";
const CLOUDFLARE_PUBLICATION_MODE_DISABLED = "disabled";
const CLOUDFLARE_PUBLICATION_MODE_LEGACY_MANUAL = "legacy-manual";
const CLOUDFLARE_PUBLISH_QUEUE_HANDLER_NAME = "cloudflarePublishWorkerTick";
const CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_HANDLER_NAME = "cloudflarePublishWorkerRecoveryTick";
const CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_ID_PROPERTY = "CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_ID";
const CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_AT_PROPERTY = "CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_AT";
const CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_ID_PROPERTY = "CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_ID";
const CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_AT_PROPERTY = "CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_TRIGGER_AT";
const CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY = "CLOUDFLARE_PUBLISH_QUEUE_LOCK";
const CLOUDFLARE_PUBLISH_QUEUE_LOCK_POLL_MS = 100;
const CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_DELAY_MS = 60 * 1000;
const CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_REUSE_TOLERANCE_MS = 30 * 1000;
// ClockTriggerBuilder.after() is a minimum delay, not a delivery guarantee.
// Stored one-shot timestamps are therefore bounded intent: normal Apps Script
// delay is tolerated, but an hours-old trigger is never treated as healthy.
const CLOUDFLARE_PUBLISH_QUEUE_CONTINUATION_MAX_OVERDUE_MS = 10 * 60 * 1000;
const CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_MAX_OVERDUE_MS = 10 * 60 * 1000;
const CLOUDFLARE_PUBLISH_QUEUE_EXECUTION_BUDGET_MS = 240 * 1000;
// Apps Script executions can remain alive for roughly six minutes after a
// transport stalls. Keep ownership longer than that hard runtime so a
// successor cannot overlap a hard-killed owner.
const CLOUDFLARE_PUBLISH_QUEUE_LEASE_SAFETY_MS = 3 * 60 * 1000;
const CLOUDFLARE_PUBLISH_QUEUE_LOCK_LEASE_MS = CLOUDFLARE_PUBLISH_QUEUE_EXECUTION_BUDGET_MS + CLOUDFLARE_PUBLISH_QUEUE_LEASE_SAFETY_MS;
const CLOUDFLARE_PUBLISH_QUEUE_REQUEST_TIMEOUT_SECONDS = 20;
const CLOUDFLARE_PUBLISH_QUEUE_MAX_OBJECTS_PER_REQUEST = 24;
const CLOUDFLARE_PUBLISH_QUEUE_MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;
const CLOUDFLARE_PUBLISH_QUEUE_HARD_OBJECT_BYTES = 8 * 1024 * 1024;
const CLOUDFLARE_PUBLISH_QUEUE_BASE_RETRY_MS = 60 * 1000;
const CLOUDFLARE_PUBLISH_QUEUE_MAX_RETRY_MS = 6 * 60 * 60 * 1000;
const CLOUDFLARE_PUBLISH_QUEUE_CAS_MAX_ATTEMPTS = 3;
const CLOUDFLARE_PUBLISH_QUEUE_MAX_ACTIVE_ROSTERS_PER_PHASE = 24;
const CLOUDFLARE_PUBLISH_QUEUE_MAX_ACTIVE_BURST_BEFORE_DIRTY = 3;
const CLOUDFLARE_PUBLISH_QUEUE_MAX_ITEMS_PER_INVOCATION = 8;
// One more item is admitted only when the budget still covers a worst-case
// Firebase build, Cloudflare request, completion CAS, checkpoint, scheduling,
// and cleanup. This remains deliberately below the four-minute worker budget.
const CLOUDFLARE_PUBLISH_QUEUE_ITEM_ADMISSION_RESERVE_MS = 120 * 1000;
const CLOUDFLARE_PUBLISH_QUEUE_RECOVERY_DELAY_MS = CLOUDFLARE_PUBLISH_QUEUE_LOCK_LEASE_MS + 60 * 1000;
const FIREBASE_OAUTH_REQUEST_TIMEOUT_SECONDS = 15;
const FIREBASE_REQUEST_TIMEOUT_SECONDS = 15;
const FIREBASE_BATCH_REQUEST_TIMEOUT_SECONDS = 15;
const COC_API_REQUEST_TIMEOUT_SECONDS = 15;

// Apps Script entrypoints share one propagated wall-clock deadline. Individual
// transports still retain their own operator-configurable timeout, but that
// timeout is clamped to the usable time left after reserving cleanup. Nested
// flows inherit the earlier deadline so a helper can never extend its caller.
const APP_SCRIPT_HTTP_EXECUTION_BUDGET_MS = 270 * 1000;
const APP_SCRIPT_EXECUTION_CLEANUP_RESERVE_MS = 30 * 1000;
const RUNTIME_RECOVERY_MARKER_PROPERTY = "RUNTIME_RECOVERY_MARKER";
const RUNTIME_URLFETCH_QUOTA_COOLDOWN_UNTIL_PROPERTY = "RUNTIME_URLFETCH_QUOTA_COOLDOWN_UNTIL";
const RUNTIME_URLFETCH_QUOTA_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const PERMANENT_SCHEDULER_WATCHDOG_HANDLER_NAME = "permanentSchedulerWatchdogTick";
const PERMANENT_SCHEDULER_WATCHDOG_TRIGGER_ID_PROPERTY = "PERMANENT_SCHEDULER_WATCHDOG_TRIGGER_ID";
const PERMANENT_SCHEDULER_WATCHDOG_INTERVAL_HOURS = 6;
const CWL_RECOVERY_HANDLER_NAME = "cwlSeasonEventRecoveryTick";
const CWL_RECOVERY_TRIGGER_ID_PROPERTY = "CWL_RECOVERY_TRIGGER_ID";
const CWL_RECOVERY_TRIGGER_AT_PROPERTY = "CWL_RECOVERY_TRIGGER_AT";
const CWL_RECOVERY_TRIGGER_DELAY_MS = 5 * 60 * 1000;
const CWL_RECOVERY_TRIGGER_MAX_OVERDUE_MS = 10 * 60 * 1000;
let executionDeadlineContextStack_ = [];

function readRuntimeRecoveryMarker_() {
	try {
		const raw = String(PropertiesService.getScriptProperties().getProperty(RUNTIME_RECOVERY_MARKER_PROPERTY) || "").trim();
		if (!raw) return { scopes: {} };
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" && parsed.scopes && typeof parsed.scopes === "object"
			? parsed
			: { scopes: {} };
	} catch (err) {
		return { scopes: {} };
	}
}

function markRuntimeRecoveryNeeded_(scopeRaw, reasonRaw, extraRaw) {
	const scope = String(scopeRaw == null ? "runtime" : scopeRaw).trim() || "runtime";
	const reason = String(reasonRaw == null ? "recovery-required" : reasonRaw).trim().slice(0, 240) || "recovery-required";
	try {
		const props = PropertiesService.getScriptProperties();
		const marker = readRuntimeRecoveryMarker_();
		const existing = marker.scopes[scope] && typeof marker.scopes[scope] === "object" ? marker.scopes[scope] : {};
		marker.scopes[scope] = Object.assign({}, existing, {
			pending: true,
			reason: reason,
			createdAt: String(existing.createdAt || new Date().toISOString()),
			updatedAt: new Date().toISOString(),
		}, extraRaw && typeof extraRaw === "object" ? extraRaw : {});
		props.setProperty(RUNTIME_RECOVERY_MARKER_PROPERTY, JSON.stringify(marker));
		return marker.scopes[scope];
	} catch (err) {
		return null;
	}
}

function clearRuntimeRecoveryNeeded_(scopeRaw) {
	const scope = String(scopeRaw == null ? "" : scopeRaw).trim();
	if (!scope) return false;
	try {
		const props = PropertiesService.getScriptProperties();
		const marker = readRuntimeRecoveryMarker_();
		if (!Object.prototype.hasOwnProperty.call(marker.scopes, scope)) return false;
		delete marker.scopes[scope];
		if (Object.keys(marker.scopes).length) props.setProperty(RUNTIME_RECOVERY_MARKER_PROPERTY, JSON.stringify(marker));
		else props.deleteProperty(RUNTIME_RECOVERY_MARKER_PROPERTY);
		return true;
	} catch (err) {
		return false;
	}
}

function listRuntimeRecoveryScopes_(prefixRaw) {
	const prefix = String(prefixRaw == null ? "" : prefixRaw).trim();
	const marker = readRuntimeRecoveryMarker_();
	return Object.keys(marker.scopes || {}).filter(function (scope) { return !prefix || scope.indexOf(prefix) === 0; }).sort();
}

function buildCwlRuntimeRecoveryScope_(eventIdRaw) {
	const eventId = String(eventIdRaw == null ? "" : eventIdRaw).trim().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 180);
	return "cwl-refresh:" + (eventId || "unbound");
}

function getRuntimeUrlFetchQuotaCooldownUntilMs_() {
	try {
		return Math.max(0, Number(PropertiesService.getScriptProperties().getProperty(RUNTIME_URLFETCH_QUOTA_COOLDOWN_UNTIL_PROPERTY) || 0));
	} catch (err) {
		return 0;
	}
}

function isRuntimeUrlFetchQuotaCooldownActive_() {
	return getRuntimeUrlFetchQuotaCooldownUntilMs_() > Date.now();
}

function clearExpiredRuntimeUrlFetchQuotaCooldown_() {
	const untilMs = getRuntimeUrlFetchQuotaCooldownUntilMs_();
	if (!untilMs || untilMs > Date.now()) return false;
	try {
		PropertiesService.getScriptProperties().deleteProperty(RUNTIME_URLFETCH_QUOTA_COOLDOWN_UNTIL_PROPERTY);
		clearRuntimeRecoveryNeeded_("urlFetchQuota");
		return true;
	} catch (err) {
		return false;
	}
}

function getExecutionDeadlineContext_() {
	return executionDeadlineContextStack_.length
		? executionDeadlineContextStack_[executionDeadlineContextStack_.length - 1]
		: null;
}

function getExecutionDeadlineMs_() {
	const context = getExecutionDeadlineContext_();
	let deadlineMs = context ? Math.max(0, Number(context.deadlineMs) || 0) : 0;
	try {
		if (typeof cloudflarePublishQueueDeadlineMs_ !== "undefined" && Number(cloudflarePublishQueueDeadlineMs_) > 0) {
			const cloudflareDeadlineMs = Number(cloudflarePublishQueueDeadlineMs_);
			deadlineMs = deadlineMs > 0 ? Math.min(deadlineMs, cloudflareDeadlineMs) : cloudflareDeadlineMs;
		}
	} catch (err) {}
	return deadlineMs;
}

function getExecutionRemainingMs_() {
	const deadlineMs = getExecutionDeadlineMs_();
	return deadlineMs > 0 ? Math.max(0, deadlineMs - Date.now()) : Number.POSITIVE_INFINITY;
}

function getExecutionCleanupReserveMs_() {
	const context = getExecutionDeadlineContext_();
	return context
		? Math.max(0, Number(context.cleanupReserveMs) || 0)
		: APP_SCRIPT_EXECUTION_CLEANUP_RESERVE_MS;
}

function isExecutionDeadlineActive_() {
	return isFinite(getExecutionRemainingMs_());
}

function isExecutionDeadlineError_(errRaw) {
	return !!(errRaw && String(errRaw.code || "") === "EXECUTION_DEADLINE");
}

function createExecutionDeadlineError_(labelRaw, requiredMsRaw) {
	const label = String(labelRaw == null ? "operation" : labelRaw).trim() || "operation";
	const requiredMs = Math.max(0, Number(requiredMsRaw) || 0);
	const context = getExecutionDeadlineContext_();
	const error = new Error("Execution deadline reserve is unavailable before " + label + ".");
	error.code = "EXECUTION_DEADLINE";
	error.resumable = true;
	error.autoRefreshDefer = true;
	error.reason = "executionDeadline";
	error.requiredMs = requiredMs;
	error.remainingMs = getExecutionRemainingMs_();
	let recoveryScope = context && context.recoveryScope ? String(context.recoveryScope) : "";
	if (!recoveryScope) {
		try {
			if (typeof cloudflarePublishQueueDeadlineMs_ !== "undefined" && Number(cloudflarePublishQueueDeadlineMs_) > 0) recoveryScope = "cloudflarePublish";
		} catch (err) {}
	}
	if (recoveryScope) markRuntimeRecoveryNeeded_(recoveryScope, "deadline:" + label, { remainingMs: error.remainingMs });
	return error;
}

function assertExecutionBudget_(worstCaseMsRaw, labelRaw, optionsRaw) {
	const remainingMs = getExecutionRemainingMs_();
	if (!isFinite(remainingMs)) return true;
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const cleanupReserveMs = options.includeCleanupReserve === false ? 0 : getExecutionCleanupReserveMs_();
	const worstCaseMs = Math.max(0, Number(worstCaseMsRaw) || 0);
	if (remainingMs >= worstCaseMs + cleanupReserveMs) return true;
	throw createExecutionDeadlineError_(labelRaw, worstCaseMs + cleanupReserveMs);
}

function getExecutionClampedTimeoutSeconds_(configuredSecondsRaw, labelRaw, extraReserveMsRaw) {
	const configuredSeconds = Math.max(1, Math.floor(Number(configuredSecondsRaw) || 1));
	const remainingMs = getExecutionRemainingMs_();
	if (!isFinite(remainingMs)) return configuredSeconds;
	const extraReserveMs = Math.max(0, Number(extraReserveMsRaw) || 0);
	const usableMs = remainingMs - getExecutionCleanupReserveMs_() - extraReserveMs;
	if (usableMs < 1000) throw createExecutionDeadlineError_(labelRaw || "external request", 1000 + extraReserveMs + getExecutionCleanupReserveMs_());
	return Math.max(1, Math.min(configuredSeconds, Math.floor(usableMs / 1000)));
}

function sleepWithExecutionDeadline_(sleepMsRaw, labelRaw) {
	const sleepMs = Math.max(0, Number(sleepMsRaw) || 0);
	if (!sleepMs) return;
	assertExecutionBudget_(sleepMs, labelRaw || "sleep");
	Utilities.sleep(sleepMs);
}

function runWithExecutionDeadline_(labelRaw, budgetMsRaw, callback, optionsRaw) {
	if (typeof callback !== "function") throw new Error("Execution deadline callback is required.");
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const nowMs = Date.now();
	const requestedDeadlineMs = nowMs + Math.max(1000, Number(budgetMsRaw) || APP_SCRIPT_HTTP_EXECUTION_BUDGET_MS);
	const parent = getExecutionDeadlineContext_();
	const parentCleanupReserveMs = parent ? Math.max(0, Number(parent.cleanupReserveMs) || 0) : 0;
	const hasRequestedCleanupReserve = Object.prototype.hasOwnProperty.call(options, "cleanupReserveMs");
	const requestedCleanupReserveMs = hasRequestedCleanupReserve
		? Math.max(0, Number(options.cleanupReserveMs) || 0)
		: APP_SCRIPT_EXECUTION_CLEANUP_RESERVE_MS;
	const context = {
		label: String(labelRaw || "entrypoint"),
		deadlineMs: parent && parent.deadlineMs ? Math.min(Number(parent.deadlineMs), requestedDeadlineMs) : requestedDeadlineMs,
		// A nested helper may ask for more cleanup time but can never consume the
		// caller's reserve. An explicit zero is honored only at the outermost scope.
		cleanupReserveMs: Math.max(parentCleanupReserveMs, requestedCleanupReserveMs),
		recoveryScope: String(options.recoveryScope || (parent && parent.recoveryScope) || ""),
	};
	executionDeadlineContextStack_.push(context);
	try {
		return callback(context);
	} finally {
		executionDeadlineContextStack_.pop();
	}
}

// Read one bounded external transport timeout. Operators can tune a policy
// without changing code, but values are always clamped so a request cannot
// silently become an execution-length operation.
function getExternalRequestTimeoutSeconds_(propertyNameRaw, fallbackRaw, minimumRaw, maximumRaw) {
	const propertyName = String(propertyNameRaw || "").trim();
	const fallback = Math.max(1, Number(fallbackRaw) || 15);
	const minimum = Math.max(1, Number(minimumRaw) || 5);
	const maximum = Math.max(minimum, Number(maximumRaw) || 30);
	let configured = 0;
	try {
		configured = propertyName && typeof PropertiesService !== "undefined" && PropertiesService
			? Number(PropertiesService.getScriptProperties().getProperty(propertyName) || 0)
			: 0;
	} catch (err) {
		configured = 0;
	}
	const bounded = Math.max(minimum, Math.min(maximum, Math.floor(configured > 0 ? configured : fallback)));
	return getExecutionClampedTimeoutSeconds_(bounded, propertyName || "external request", 1000);
}
const FIREBASE_INTERNAL_CLOUDFLARE_PUBLISH_PATH = "internal/cloudflarePublish";
const FIREBASE_INTERNAL_CLOUDFLARE_PUBLISH_STATE_PATH = "internal/cloudflarePublish/state";
const FIREBASE_KEY_ENCODING_PREFIX = "__FB64__";
const FIREBASE_LAYOUT_VERSION = 3;
const FIREBASE_ACTIVE_PATH = "active";
const FIREBASE_ACTIVE_PUBLISHED_PATH = "activePublished";
const FIREBASE_ACTIVE_PUBLISHED_CURRENT_VERSION_PATH = "activePublished/currentVersionId";
const FIREBASE_ACTIVE_PUBLISHED_CURRENT_SELECTOR_PATH = "activePublished/currentSelector";
const FIREBASE_ACTIVE_PUBLISHED_CURRENT_MANIFEST_PATH = "activePublished/currentManifest";
const FIREBASE_ACTIVE_VERSIONS_PATH = "activeVersions";
const FIREBASE_ACTIVE_LINKED_ACCOUNT_TAG_INDEX_CHILD_PATH = "indexes/linkedAccountTags";
const FIREBASE_ACTIVE_LINKED_ACCOUNT_TAG_INDEX_SCHEMA_VERSION = 1;
const FIREBASE_ARCHIVE_PUBLISH_PATH = "archive/publish";
const FIREBASE_ARCHIVE_AUTOREFRESH_DAILY_PATH = "archive/autorefreshDaily";
const FIREBASE_DONATION_REFRESH_PATH = "donationRefresh";
const FIREBASE_INTERNAL_AUTO_REFRESH_JOB_PATH = "internal/autoRefresh/current";
const FIREBASE_INTERNAL_AUTO_REFRESH_LAST_JOB_PATH = "internal/autoRefresh/lastJob";
const FIREBASE_INTERNAL_AUTO_REFRESH_RUNS_PATH = "internal/autoRefresh/runs";
const FIREBASE_INTERNAL_AUTO_REFRESH_CANONICAL_REPAIRS_PATH = "internal/autoRefresh/canonicalRepairs";
const FIREBASE_META_PATH = "meta";
const FIREBASE_PUBLISH_ARCHIVE_KEEP_COUNT = 10;
const FIREBASE_AUTOREFRESH_DAILY_KEEP_COUNT = 2;
const FIREBASE_DONATION_REFRESH_SEASON_KEEP_COUNT = 16;
const FIREBASE_ACTIVE_VERSION_HISTORY_KEEP_COUNT = 0;
const FIREBASE_AUTOREFRESH_RUN_HISTORY_KEEP_COUNT = 0;
const FIREBASE_ACCESS_TOKEN_CACHE_KEY = "firebaseAccessToken:v1";
const FIREBASE_ACCESS_TOKEN_SCOPE = "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email";
const FIREBASE_ACCESS_TOKEN_TTL_SAFETY_SECONDS = 60;
const CACHE_SAFE_TEXT_MAX_CHARS = 90 * 1024;
let staticAssetVersionCache_ = null;
let firebaseConfigCache_ = null;

// External service, roster-tracking, and metrics retention constants.
const COC_PROXY_BASE_URL = "https://cocproxy.royaleapi.dev/v1";
const PLAYER_PROFILE_CACHE_TTL_SECONDS = 300;
const TOWN_HALL_ICON_CACHE_TTL_SECONDS = 3600;
const LEAGUE_ICON_CACHE_TTL_SECONDS = 3600;
const LEAGUE_ICON_CACHE_VERSION = "v4";
const CWL_PREPARATION_ALGORITHM = "strength_top_x_v1";
const CWL_PREPARATION_MIN_ROSTER_SIZE = 5;
const CWL_PREPARATION_MAX_ROSTER_SIZE = 50;
const CWL_PREPARATION_ROSTER_SIZE_STEP = 5;
// How long to retain a member's tracking data after they stop appearing in the roster.
// This is intentionally long (e.g., 28 days) to avoid losing war history for temporary departures.
const REGULAR_WAR_MISSING_GRACE_MS = 28 * 24 * 60 * 60 * 1000; // 28 days
const REGULAR_WAR_WARLOG_LIMIT = 25;
const REGULAR_WAR_REPAIR_GRACE_MS = 6 * 60 * 60 * 1000; // 6 hours
const ACTIVE_ROSTER_LOCK_HEARTBEAT_MIN_INTERVAL_MS = 15 * 1000;
const AUTO_REFRESH_PREFETCH_BATCH_SIZE = 8;
const AUTO_REFRESH_PREFETCH_BATCH_DELAY_MS = 1000;
const AUTO_REFRESH_JOB_EXECUTION_BUDGET_MS = 270 * 1000;
const AUTO_REFRESH_JOB_RESUME_DELAY_MS = 60 * 1000;
const AUTO_REFRESH_COOLDOWN_RETRY_GRACE_MS = 5 * 1000;
// A hard-killed worker retains the active-roster lease. Its recovery watchdog
// must therefore run only after that lease expires plus a safety margin.
const AUTO_REFRESH_JOB_WATCHDOG_SAFETY_MS = 60 * 1000;
const AUTO_REFRESH_JOB_WATCHDOG_DELAY_MS = ACTIVE_ROSTER_JOB_LOCK_LEASE_MS + AUTO_REFRESH_JOB_WATCHDOG_SAFETY_MS;
const AUTO_REFRESH_QUEUE_TASK_STALE_MS = 8 * 60 * 1000;
const AUTO_REFRESH_QUEUE_WORKER_START_RESERVE_MS = 90 * 1000;
const AUTO_REFRESH_QUEUE_FINALIZE_RESERVE_MS = 120 * 1000;
const AUTO_REFRESH_QUEUE_ROSTER_PROCESS_RESERVE_MS = 120 * 1000;
const AUTO_REFRESH_QUEUE_ROSTER_WRITE_RESERVE_MS = 60 * 1000;
// CWL coordination is side work and must never consume the parent worker's
// checkpoint/scheduling reserve. A nested deadline leaves enough of the outer
// execution available to terminalize the side task and continue canonical work.
const AUTO_REFRESH_QUEUE_CWL_SIDE_TASK_BUDGET_MS = 150 * 1000;
const AUTO_REFRESH_QUEUE_CWL_SIDE_TASK_CHECKPOINT_RESERVE_MS = 30 * 1000;
const AUTO_REFRESH_QUEUE_CWL_SIDE_TASK_START_RESERVE_MS = 180 * 1000;
const AUTO_REFRESH_METRIC_COPY_TASK_TAG_LIMIT = 100;
const AUTO_REFRESH_ROSTER_INPUT_READ_CHUNK_TAG_LIMIT = 25;
const AUTO_REFRESH_ROSTER_PHASE_MAX_ATTEMPTS = 6;
const COC_FETCH_MAX_ATTEMPTS = 3;
const COC_FETCH_RETRY_BASE_DELAY_MS = 300;
const COC_FETCH_RETRY_MIN_DELAY_MS = 150;
const COC_FETCH_RETRY_MAX_DELAY_MS = 2500;
const PLAYER_METRICS_SCHEMA_VERSION = 1;
const PLAYER_METRICS_TROPHY_HISTORY_MAX_DAYS = 120;
const PLAYER_METRICS_DONATION_CYCLES_MAX = 16;
const PLAYER_METRICS_ENTRY_RETENTION_DAYS = 240;
const PLAYER_METRICS_PLAYER_HOUSE_MAX_ELEMENTS = 8;
const PLAYER_METRICS_MIN_ROSTER_COVERAGE_FOR_PUBLISH = 0.9;
let activeRosterLockContextStack_ = [];

// Bench planner weights and solver limits.
const CWL_BENCH_PLANNER_CONFIG = {
	algorithm: "cwl_bench_exact_dp_v2",
	defaultSeasonDays: 7,
	// Legacy strength scorer inputs are still used by CWL Preparation Mode.
	priorMeanStarsPerStart: 2.0,
	priorWeightAttacks: 2.5,
	minExpectedStarsPerStart: 1.25,
	maxExpectedStarsPerStart: 2.75,
	perfPriorWeight: 3.0,
	starsPerfPriorMean: 0.5,
	destructionPerfPriorMean: 0.5,
	threeStarRatePriorWeight: 4.0,
	reliabilityPriorWeight: 2.5,
	weightTH: 0.38,
	weightStarsPerf: 0.22,
	weightDestructionPerf: 0.14,
	weightThreeStarRate: 0.1,
	weightHitUpAbility: 0.08,
	weightHitEvenAbility: 0.08,
	weightReliabilityPenalty: 0.2,
	churnPenalty: 0.03,
	reasonStrengthDeltaThreshold: 0.05,
	// Bench planner v2 uses a separate fixed-scale value model.
	supportedTownHallMin: 1,
	supportedTownHallMax: 18,
	unknownTownHallNormalized: 0.5,
	qualityPriorMeanStarsWhenUsed: 3.0,
	qualityPriorMeanDestruction: 100.0,
	qualityPriorMeanThreeStarProbability: 1.0,
	qualityPriorWeightAttacks: 2.0,
	reliabilityPriorMean: 0.98,
	reliabilityPriorWeight: 5.0,
	currentCwlQualityWeight: 1.0,
	previousCwlQualityWeight: 0.7,
	regularWarQualityWeight: 0.35,
	currentCwlReliabilityWeight: 1.0,
	previousCwlReliabilityWeight: 0.7,
	regularWarReliabilityWeight: 0.35,
	previousCwlMaxAttacks: 12,
	regularWarMaxAttacks: 24,
	previousCwlMaxOpportunities: 12,
	regularWarMaxOpportunities: 30,
	benchWeightTownHall: 0.42,
	benchWeightStarsWhenUsed: 0.28,
	benchWeightDestructionWhenUsed: 0.12,
	benchWeightThreeStarProbability: 0.12,
	benchReliabilityExponent: 1.35,
	rewardSelectionValueScale: 100000,
	baselineValueScale: 100000,
	optionalSwapMinScoreDelta: 0.08,
	maxOptionalSwaps: 2,
	reasonReliabilityDeltaThreshold: 0.12,
	rewardOptimizerMaxPlayers: 60,
	rewardOptimizerMaxCapacity: 240,
	optimizerMaxPlayers: 42,
	optimizerMaxDays: 8,
	optimizerMaxStateCells: 250000,
	optimizerScoreScale: 100000,
};
