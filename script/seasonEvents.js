// Season-event data model, reconciliation, and Discord bot callable helpers.

const SEASON_EVENTS_BASE_PATH = "events/seasonEvents";
const SEASON_EVENTS_BY_ID_PATH = SEASON_EVENTS_BASE_PATH + "/byId";
const SEASON_EVENTS_CURRENT_PATH = SEASON_EVENTS_BASE_PATH + "/current";
const SEASON_EVENTS_CURRENT_CWL_PATH = SEASON_EVENTS_BASE_PATH + "/currentCwl";
const SEASON_EVENTS_LATEST_COMPLETED_CWL_PATH = SEASON_EVENTS_BASE_PATH + "/latestCompletedCwl";
const SEASON_EVENTS_CWL_AGGREGATES_PATH = SEASON_EVENTS_BASE_PATH + "/cwlAggregates/byEvent";
const SEASON_EVENTS_BY_SEASON_PATH = SEASON_EVENTS_BASE_PATH + "/bySeason";
const SEASON_EVENTS_SEASON_STATE_CURRENT_PATH = SEASON_EVENTS_BASE_PATH + "/seasonState/current";
const SEASON_EVENTS_SEASON_STATE_MANUAL_PATH = SEASON_EVENTS_BASE_PATH + "/seasonState/manual";
const SEASON_EVENT_SEASON_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const SEASON_EVENT_LOCK_WAIT_MS = 30 * 1000;
const SEASON_EVENT_CWL_GROUP_BIND_TOLERANCE_MS = 72 * 60 * 60 * 1000;
const SEASON_EVENT_RANKED_LEGEND_ANCHOR_ISO = "2026-05-18T05:00:00.000Z";
const SEASON_EVENT_RANKED_LEGEND_CYCLE_MS = 28 * 24 * 60 * 60 * 1000;
const SEASON_EVENT_PUSH_LEADERBOARD_METRIC = "leagueTrophies";
const SEASON_EVENT_LEAGUE_FALLBACK_RANK = 999;
const SEASON_EVENT_EXACT_LEAGUE_ORDER = [
	"Legends I",
	"Legends II",
	"Legends III",
	"Electro 33",
	"Electro 32",
	"Electro 31",
	"Dragon 30",
	"Dragon 29",
	"Dragon 28",
	"Titan 27",
	"Titan 26",
	"Titan 25",
	"P.E.K.K.A 24",
	"P.E.K.K.A 23",
	"P.E.K.K.A 22",
	"Golem 21",
	"Golem 20",
	"Golem 19",
	"Witch 18",
	"Witch 17",
	"Witch 16",
	"Valkyrie 15",
	"Valkyrie 14",
	"Valkyrie 13",
	"Wizard 12",
	"Wizard 11",
	"Wizard 10",
	"Archer 9",
	"Archer 8",
	"Archer 7",
	"Barbarian 6",
	"Barbarian 5",
	"Barbarian 4",
	"Skeleton 3",
	"Skeleton 2",
	"Skeleton 1",
	"Unranked",
];

const SEASON_EVENT_STATUS_VALUES = {
	draft: true,
	open: true,
	closed: true,
	archived: true,
};

const SEASON_EVENT_VISIBILITY_VALUES = {
	public: true,
	hidden: true,
};

const SEASON_EVENT_CWL_TRACKING_STATE_VALUES = {
	waiting: true,
	active: true,
	finalizing: true,
	completed: true,
};

const SEASON_EVENT_DEFAULTS_BY_TYPE = {
	push: {
		maxAccountsPerParticipant: 1,
		leaderboardMetric: SEASON_EVENT_PUSH_LEADERBOARD_METRIC,
		titlePrefix: "Push Event",
	},
	donation: {
		maxAccountsPerParticipant: 2,
		leaderboardMetric: "donations",
		titlePrefix: "Donation Event",
	},
	cwl: {
		maxAccountsPerParticipant: 50,
		leaderboardMetric: "cwl",
		titlePrefix: "CWL Event",
	},
};

const SEASON_EVENT_PATCH_FIELDS = {
	title: true,
	description: true,
	status: true,
	visibility: true,
	signupsOpen: true,
	startsAt: true,
	endsAt: true,
};

// Return whether plain object.
function isSeasonEventPlainObject_(valueRaw) {
	return !!(valueRaw && typeof valueRaw === "object" && !Array.isArray(valueRaw));
}

// Sanitize a short season-event text value.
function sanitizeSeasonEventText_(valueRaw, maxLengthRaw) {
	const maxLength = Math.max(0, toNonNegativeInt_(maxLengthRaw) || 0);
	let value = String(valueRaw == null ? "" : valueRaw)
		.replace(/[\u0000-\u001F\u007F]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (maxLength > 0 && value.length > maxLength) value = value.slice(0, maxLength).trim();
	return value;
}

// Sanitize optional timestamp to ISO.
function sanitizeSeasonEventTimestamp_(valueRaw) {
	const text = String(valueRaw == null ? "" : valueRaw).trim();
	if (!text) return "";
	const ms = parseIsoToMs_(text);
	if (ms <= 0) throw new Error("Invalid timestamp: " + text);
	return new Date(ms).toISOString();
}

// Sanitize optional timestamp without throwing.
function sanitizeSeasonEventTimestampOrEmpty_(valueRaw) {
	try {
		return sanitizeSeasonEventTimestamp_(valueRaw);
	} catch (err) {
		return "";
	}
}

// Normalize event type.
function normalizeSeasonEventType_(typeRaw) {
	const type = String(typeRaw == null ? "" : typeRaw)
		.trim()
		.toLowerCase();
	return Object.prototype.hasOwnProperty.call(SEASON_EVENT_DEFAULTS_BY_TYPE, type) ? type : "";
}

// Normalize event status.
function normalizeSeasonEventStatus_(statusRaw) {
	const status = String(statusRaw == null ? "" : statusRaw)
		.trim()
		.toLowerCase();
	return Object.prototype.hasOwnProperty.call(SEASON_EVENT_STATUS_VALUES, status) ? status : "";
}

// Normalize event visibility.
function normalizeSeasonEventVisibility_(visibilityRaw) {
	const visibility = String(visibilityRaw == null ? "" : visibilityRaw)
		.trim()
		.toLowerCase();
	return Object.prototype.hasOwnProperty.call(SEASON_EVENT_VISIBILITY_VALUES, visibility) ? visibility : "";
}

// Normalize CWL tracking lifecycle state.
function normalizeCwlTrackingState_(stateRaw) {
	const state = String(stateRaw == null ? "" : stateRaw)
		.trim()
		.toLowerCase();
	return Object.prototype.hasOwnProperty.call(SEASON_EVENT_CWL_TRACKING_STATE_VALUES, state) ? state : "";
}

// Return whether a CWL event needs refresh-all league group or war data.
function isCwlSeasonEventRefreshableState_(stateRaw) {
	const state = normalizeCwlTrackingState_(stateRaw);
	return state === "waiting" || state === "active" || state === "finalizing";
}

// Return whether a raw league group looks like a live or upcoming CWL group.
function isCwlLeagueGroupPotentiallyLive_(leaguegroupRaw) {
	const leaguegroup = leaguegroupRaw && typeof leaguegroupRaw === "object" ? leaguegroupRaw : {};
	const state = normalizeWarState_(leaguegroup.state);
	if (state === "ended" || state === "warended") return false;
	return extractLeagueGroupWarTags_(leaguegroup).length > 0;
}

// Build a safe season id for deterministic event ids.
function normalizeSeasonIdForEventId_(seasonIdRaw) {
	const seasonId = String(seasonIdRaw == null ? "" : seasonIdRaw).trim();
	if (!seasonId) throw new Error("Season ID is required.");
	if (/^[A-Za-z0-9_-]+$/.test(seasonId)) return seasonId;
	return "b64-" + base64UrlEncodeUtf8_(seasonId);
}

// Build deterministic season-event id.
function buildSeasonEventId_(eventTypeRaw, seasonIdRaw) {
	const eventType = normalizeSeasonEventType_(eventTypeRaw);
	if (!eventType) throw new Error("Invalid season event type.");
	return eventType + "-" + normalizeSeasonIdForEventId_(seasonIdRaw);
}

// Get event defaults.
function getSeasonEventTypeDefaults_(eventTypeRaw) {
	const eventType = normalizeSeasonEventType_(eventTypeRaw);
	if (!eventType) throw new Error("Invalid season event type.");
	return SEASON_EVENT_DEFAULTS_BY_TYPE[eventType];
}

// Return path to event by id.
function buildSeasonEventByIdPath_(eventIdRaw) {
	const eventId = sanitizeSeasonEventText_(eventIdRaw, 180);
	if (!eventId) throw new Error("Event ID is required.");
	return buildFirebaseChildPath_(SEASON_EVENTS_BY_ID_PATH, encodeFirebaseObjectKey_(eventId));
}

// Return path to current event pointer.
function buildSeasonEventCurrentPointerPath_(eventTypeRaw) {
	const eventType = normalizeSeasonEventType_(eventTypeRaw);
	if (!eventType) throw new Error("Invalid season event type.");
	return buildFirebaseChildPath_(SEASON_EVENTS_CURRENT_PATH, eventType);
}

// Return path to season event pointer.
function buildSeasonEventBySeasonPointerPath_(seasonIdRaw, eventTypeRaw) {
	const seasonId = String(seasonIdRaw == null ? "" : seasonIdRaw).trim();
	const eventType = normalizeSeasonEventType_(eventTypeRaw);
	if (!seasonId) throw new Error("Season ID is required.");
	if (!eventType) throw new Error("Invalid season event type.");
	return buildFirebaseChildPath_(buildFirebaseChildPath_(SEASON_EVENTS_BY_SEASON_PATH, encodeFirebaseObjectKey_(seasonId)), eventType);
}

// Return path to compact CWL aggregate for an event.
function buildCwlSeasonEventAggregatePath_(eventIdRaw, kindRaw) {
	const eventId = sanitizeSeasonEventText_(eventIdRaw, 180);
	const kind = String(kindRaw == null ? "" : kindRaw)
		.trim()
		.toLowerCase();
	if (!eventId) throw new Error("Event ID is required.");
	if (kind !== "live" && kind !== "final") throw new Error("Invalid CWL aggregate kind.");
	return buildFirebaseChildPath_(buildFirebaseChildPath_(SEASON_EVENTS_CWL_AGGREGATES_PATH, encodeFirebaseObjectKey_(eventId)), kind);
}

// Return path to participant by Discord id.
function buildSeasonEventParticipantPath_(eventIdRaw, discordIdRaw) {
	const discordId = sanitizeDiscordIdValue_(discordIdRaw);
	if (!discordId) throw new Error("Discord user ID is required.");
	return buildFirebaseChildPath_(buildFirebaseChildPath_(buildSeasonEventByIdPath_(eventIdRaw), "participantsByDiscordId"), encodeFirebaseObjectKey_(discordId));
}

// Return path to player-tag participant index.
function buildSeasonEventParticipantTagIndexPath_(eventIdRaw, playerTagRaw) {
	const tag = normalizeTag_(playerTagRaw);
	if (!tag) throw new Error("Player tag is required.");
	return buildFirebaseChildPath_(buildFirebaseChildPath_(buildSeasonEventByIdPath_(eventIdRaw), "participantsByTag"), encodeFirebaseObjectKey_(tag));
}

// Return path to event audit entry.
function buildSeasonEventAuditPath_(eventIdRaw, auditKeyRaw) {
	const auditKey = sanitizeSeasonEventText_(auditKeyRaw, 180);
	if (!auditKey) throw new Error("Audit key is required.");
	return buildFirebaseChildPath_(buildFirebaseChildPath_(buildSeasonEventByIdPath_(eventIdRaw), "audit"), encodeFirebaseObjectKey_(auditKey));
}

// Sanitize source metadata.
function sanitizeSeasonEventSource_(sourceRaw) {
	if (sourceRaw == null) return "";
	if (typeof sourceRaw === "string") return sanitizeSeasonEventText_(sourceRaw, 120);
	if (!isSeasonEventPlainObject_(sourceRaw)) return sanitizeSeasonEventText_(sourceRaw, 120);

	const allowed = ["type", "guildId", "channelId", "messageId", "interactionId", "userId", "username", "method", "seasonSource"];
	const out = {};
	for (let i = 0; i < allowed.length; i++) {
		const key = allowed[i];
		if (!Object.prototype.hasOwnProperty.call(sourceRaw, key)) continue;
		const value = sanitizeSeasonEventText_(sourceRaw[key], 180);
		if (value) out[key] = value;
	}
	return Object.keys(out).length ? out : "";
}

// Assert season-event read/manual API auth.
function assertSeasonEventSecretOrAdmin_(secretOrPasswordRaw) {
	try {
		assertDiscordBotApiSecret_(secretOrPasswordRaw);
		return "discord-bot";
	} catch (botErr) {
		assertAdminPassword_(secretOrPasswordRaw);
		return "admin";
	}
}

// Parse optional payload call shapes used by bot/admin callers.
function parseSeasonEventOptionalPayloadAndSecret_(payloadRaw, secretOrPasswordRaw) {
	if (secretOrPasswordRaw == null && (typeof payloadRaw === "string" || typeof payloadRaw === "number")) {
		return {
			payload: {},
			secretOrPassword: payloadRaw,
		};
	}
	return {
		payload: payloadRaw && typeof payloadRaw === "object" && !Array.isArray(payloadRaw) ? payloadRaw : {},
		secretOrPassword: secretOrPasswordRaw,
	};
}

// Decode a Firebase payload object.
function decodeSeasonEventFirebasePayload_(payloadRaw) {
	if (!payloadRaw || typeof payloadRaw !== "object" || Array.isArray(payloadRaw)) return null;
	return decodeFirebaseObjectKeysRecursive_(payloadRaw);
}

// Read season event by id.
function readSeasonEventById_(eventIdRaw) {
	const payload = firebaseRequestJson_(buildSeasonEventByIdPath_(eventIdRaw), "GET");
	return decodeSeasonEventFirebasePayload_(payload);
}

// Read pointer object.
function readSeasonEventPointer_(pathRaw) {
	return decodeSeasonEventFirebasePayload_(firebaseRequestJson_(pathRaw, "GET"));
}

// Write encoded Firebase payload.
function writeSeasonEventFirebasePayload_(pathRaw, methodRaw, payloadRaw) {
	return firebaseRequestJson_(pathRaw, methodRaw, encodeFirebaseObjectKeysRecursive_(payloadRaw));
}

function publishCloudflareSeasonEventsAfterMutation_(labelRaw) {
	if (typeof publishCloudflareSeasonEventsAndDonationDataBestEffort_ !== "function") return null;
	return publishCloudflareSeasonEventsAndDonationDataBestEffort_(labelRaw);
}

// Build audit key.
function buildSeasonEventAuditKey_(timestampRaw) {
	const date = timestampRaw ? new Date(timestampRaw) : new Date();
	const safeDate = isFinite(date.getTime()) ? date : new Date();
	return Utilities.formatDate(safeDate, "Etc/UTC", "yyyyMMdd'T'HHmmss_SSS'Z'") + "_" + Utilities.getUuid().slice(0, 8);
}

// Write event audit entry.
function writeSeasonEventAuditEntry_(eventIdRaw, auditRaw) {
	const audit = auditRaw && typeof auditRaw === "object" ? auditRaw : {};
	const eventId = sanitizeSeasonEventText_(eventIdRaw || audit.eventId, 180);
	if (!eventId) throw new Error("Event ID is required for audit.");
	const nowIso = sanitizeSeasonEventTimestampOrEmpty_(audit.createdAt) || new Date().toISOString();
	const playerTagsRaw = Array.isArray(audit.playerTags) ? audit.playerTags : [];
	const playerTags = [];
	const seen = {};
	for (let i = 0; i < playerTagsRaw.length; i++) {
		const tag = normalizeTag_(playerTagsRaw[i]);
		if (!tag || seen[tag]) continue;
		seen[tag] = true;
		playerTags.push(tag);
	}
	const entry = {
		action: sanitizeSeasonEventText_(audit.action, 80),
		eventId: eventId,
		discordId: sanitizeDiscordIdValue_(audit.discordId),
		playerTags: playerTags,
		createdAt: nowIso,
		source: sanitizeSeasonEventSource_(audit.source),
		details: isSeasonEventPlainObject_(audit.details) ? audit.details : {},
	};
	const auditKey = buildSeasonEventAuditKey_(nowIso);
	writeSeasonEventFirebasePayload_(buildSeasonEventAuditPath_(eventId, auditKey), "PUT", entry);
	return entry;
}

// Format YYYY-MM season id in UTC.
function formatSeasonIdFromDate_(dateRaw) {
	const date = dateRaw instanceof Date ? dateRaw : new Date(dateRaw);
	const safeDate = isFinite(date.getTime()) ? date : new Date();
	return Utilities.formatDate(safeDate, "Etc/UTC", "yyyy-MM");
}

// Sanitize resolved season object.
function sanitizeResolvedRankedSeason_(seasonRaw, sourceRaw) {
	const season = seasonRaw && typeof seasonRaw === "object" ? seasonRaw : {};
	const startsAt = sanitizeSeasonEventTimestampOrEmpty_(season.startsAt || season.startTime);
	const endsAt = sanitizeSeasonEventTimestampOrEmpty_(season.endsAt || season.endTime);
	let seasonId = sanitizeSeasonEventText_(season.seasonId || season.id, 80);
	if (!seasonId && startsAt) seasonId = formatSeasonIdFromDate_(new Date(startsAt));
	if (!seasonId) seasonId = formatSeasonIdFromDate_(new Date());
	const source = String(sourceRaw || season.source || "")
		.trim()
		.toLowerCase();
	const safeSource = source === "legend-cycle" || source === "cache" || source === "manual" || source === "estimated" ? source : "estimated";
	const out = {
		seasonId: seasonId,
		startsAt: startsAt,
		endsAt: endsAt,
		source: safeSource,
	};
	if (!out.startsAt || !out.endsAt) return null;
	if (parseIsoToMs_(out.endsAt) <= parseIsoToMs_(out.startsAt)) return null;
	return out;
}

// Read manual season from script properties.
function readManualRankedSeasonFromProperties_() {
	const props = PropertiesService.getScriptProperties();
	const seasonId = sanitizeSeasonEventText_(props.getProperty("SEASON_EVENT_MANUAL_SEASON_ID"), 80);
	const startsAt = sanitizeSeasonEventTimestampOrEmpty_(props.getProperty("SEASON_EVENT_MANUAL_STARTS_AT"));
	const endsAt = sanitizeSeasonEventTimestampOrEmpty_(props.getProperty("SEASON_EVENT_MANUAL_ENDS_AT"));
	if (!seasonId && !startsAt && !endsAt) return null;
	return sanitizeResolvedRankedSeason_(
		{
			seasonId: seasonId,
			startsAt: startsAt,
			endsAt: endsAt,
		},
		"manual",
	);
}

// Read manual season from Firebase.
function readManualRankedSeasonFromFirebase_() {
	try {
		const manual = decodeSeasonEventFirebasePayload_(firebaseRequestJson_(SEASON_EVENTS_SEASON_STATE_MANUAL_PATH, "GET"));
		if (!manual) return null;
		return sanitizeResolvedRankedSeason_(manual, "manual");
	} catch (err) {
		Logger.log("Unable to read manual season event state: %s", errorMessage_(err));
		return null;
	}
}

// Read current season cache.
function readCurrentRankedSeasonCache_() {
	try {
		return decodeSeasonEventFirebasePayload_(firebaseRequestJson_(SEASON_EVENTS_SEASON_STATE_CURRENT_PATH, "GET"));
	} catch (err) {
		Logger.log("Unable to read current season event cache: %s", errorMessage_(err));
		return null;
	}
}

// Return whether cached season is usable.
function isUsableCurrentRankedSeasonCache_(cacheRaw, nowMsRaw, maxAgeMsRaw) {
	const nowMs = isFinite(Number(nowMsRaw)) ? Number(nowMsRaw) : Date.now();
	const maxAgeMs = Math.max(60 * 1000, Number(maxAgeMsRaw) || SEASON_EVENT_SEASON_CACHE_TTL_MS);
	const season = sanitizeResolvedRankedSeason_(cacheRaw, cacheRaw && cacheRaw.source === "manual" ? "manual" : "cache");
	if (!season) return false;
	const startsMs = parseIsoToMs_(season.startsAt);
	const endsMs = parseIsoToMs_(season.endsAt);
	if (startsMs > 0 && nowMs < startsMs - 24 * 60 * 60 * 1000) return false;
	if (endsMs > 0 && nowMs > endsMs) return false;
	if (cacheRaw && cacheRaw.source === "manual") return true;
	const resolvedAtMs = parseIsoToMs_(cacheRaw && cacheRaw.resolvedAt);
	if (!resolvedAtMs) return false;
	return nowMs - resolvedAtMs <= maxAgeMs;
}

// Return whether a season window can still represent the current event window.
function isCurrentRankedSeasonWindowLive_(seasonRaw, nowMsRaw) {
	const nowMs = isFinite(Number(nowMsRaw)) ? Number(nowMsRaw) : Date.now();
	const season = sanitizeResolvedRankedSeason_(seasonRaw, "cache");
	if (!season) return false;
	const startsMs = parseIsoToMs_(season.startsAt);
	const endsMs = parseIsoToMs_(season.endsAt);
	if (startsMs > 0 && nowMs < startsMs - 24 * 60 * 60 * 1000) return false;
	if (endsMs > 0 && nowMs > endsMs) return false;
	return true;
}

// Write current season cache.
function writeCurrentRankedSeasonCache_(seasonRaw, extraRaw) {
	const season = sanitizeResolvedRankedSeason_(seasonRaw, seasonRaw && seasonRaw.source);
	if (!season) return null;
	const extra = extraRaw && typeof extraRaw === "object" ? extraRaw : {};
	const nowIso = new Date().toISOString();
	const payload = Object.assign({}, season, {
		resolvedAt: nowIso,
		updatedAt: nowIso,
	});
	if (extra.apiEndpoint) payload.apiEndpoint = sanitizeSeasonEventText_(extra.apiEndpoint, 180);
	writeSeasonEventFirebasePayload_(SEASON_EVENTS_SEASON_STATE_CURRENT_PATH, "PUT", payload);
	return payload;
}

// Return whether two resolved ranked seasons describe the same cycle.
function areResolvedRankedSeasonsEquivalent_(leftRaw, rightRaw) {
	const left = sanitizeResolvedRankedSeason_(leftRaw, leftRaw && leftRaw.source);
	const right = sanitizeResolvedRankedSeason_(rightRaw, rightRaw && rightRaw.source);
	if (!left || !right) return !left && !right;
	return left.seasonId === right.seasonId && left.startsAt === right.startsAt && left.endsAt === right.endsAt && left.source === right.source;
}

// Optionally write current ranked season cache if it differs.
function writeCurrentRankedSeasonCacheIfChanged_(seasonRaw, existingCacheRaw) {
	const season = sanitizeResolvedRankedSeason_(seasonRaw, seasonRaw && seasonRaw.source);
	if (!season) return null;
	if (areResolvedRankedSeasonsEquivalent_(season, existingCacheRaw)) return existingCacheRaw;
	return writeCurrentRankedSeasonCache_(season);
}

// Resolve a timestamp option for deterministic season calculations.
function resolveRankedSeasonNowMs_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	if (isFinite(Number(options.nowMs))) return Number(options.nowMs);
	const nowCandidate = options.now != null ? options.now : options.nowIso;
	if (nowCandidate instanceof Date && isFinite(nowCandidate.getTime())) return nowCandidate.getTime();
	const nowMs = parseIsoToMs_(nowCandidate);
	return nowMs > 0 ? nowMs : Date.now();
}

// Format deterministic Legend I ranked season id from the cycle start.
function formatLegendIRankedSeasonId_(startMsRaw) {
	const startMs = Number(startMsRaw);
	const start = new Date(isFinite(startMs) ? startMs : Date.now());
	return "ranked-legend-i-" + Utilities.formatDate(start, "Etc/UTC", "yyyy-MM-dd");
}

// Resolve the deterministic 4-week Legend I ranked season cycle.
function resolveLegendIRankedSeasonCycle_(nowMsRaw) {
	const anchorMs = parseIsoToMs_(SEASON_EVENT_RANKED_LEGEND_ANCHOR_ISO);
	if (anchorMs <= 0) throw new Error("Invalid Legend I ranked season anchor.");
	const nowMs = isFinite(Number(nowMsRaw)) ? Number(nowMsRaw) : Date.now();
	const cycleIndex = Math.floor((nowMs - anchorMs) / SEASON_EVENT_RANKED_LEGEND_CYCLE_MS);
	const startMs = anchorMs + cycleIndex * SEASON_EVENT_RANKED_LEGEND_CYCLE_MS;
	const endMs = startMs + SEASON_EVENT_RANKED_LEGEND_CYCLE_MS;
	return {
		seasonId: formatLegendIRankedSeasonId_(startMs),
		startsAt: new Date(startMs).toISOString(),
		endsAt: new Date(endMs).toISOString(),
		source: "legend-cycle",
	};
}

// Resolve current Legend I ranked season window.
function resolveCurrentRankedSeason_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const nowMs = resolveRankedSeasonNowMs_(options);
	const maxAgeMs = Math.max(60 * 1000, Number(options.cacheTtlMs) || SEASON_EVENT_SEASON_CACHE_TTL_MS);

	const manualFromOptions = sanitizeResolvedRankedSeason_(options.manualSeason || options.season, "manual");
	if (manualFromOptions) {
		writeCurrentRankedSeasonCache_(manualFromOptions);
		return manualFromOptions;
	}

	const manualFromProperties = readManualRankedSeasonFromProperties_();
	if (manualFromProperties) {
		writeCurrentRankedSeasonCache_(manualFromProperties);
		return manualFromProperties;
	}

	const manualFromFirebase = readManualRankedSeasonFromFirebase_();
	if (manualFromFirebase) {
		writeCurrentRankedSeasonCache_(manualFromFirebase);
		return manualFromFirebase;
	}

	const cycleSeason = resolveLegendIRankedSeasonCycle_(nowMs);
	const cached = readCurrentRankedSeasonCache_();
	if (options.forceRefresh !== true && isUsableCurrentRankedSeasonCache_(cached, nowMs, maxAgeMs) && areResolvedRankedSeasonsEquivalent_(cached, cycleSeason)) {
		return sanitizeResolvedRankedSeason_(cached, "legend-cycle") || cycleSeason;
	}
	writeCurrentRankedSeasonCacheIfChanged_(cycleSeason, cached);
	return cycleSeason;
}

// Build default event object.
function buildDefaultSeasonEvent_(eventTypeRaw, seasonRaw, sourceRaw) {
	const eventType = normalizeSeasonEventType_(eventTypeRaw);
	const season = sanitizeResolvedRankedSeason_(seasonRaw, seasonRaw && seasonRaw.source);
	if (!eventType || !season) throw new Error("Season event type and season are required.");
	const defaults = getSeasonEventTypeDefaults_(eventType);
	const nowIso = new Date().toISOString();
	const eventId = buildSeasonEventId_(eventType, season.seasonId);
	return {
		eventId: eventId,
		type: eventType,
		seasonId: season.seasonId,
		title: defaults.titlePrefix + " " + season.seasonId,
		description: "",
		status: "open",
		visibility: "public",
		signupsOpen: true,
		startsAt: season.startsAt,
		endsAt: season.endsAt,
		createdAt: nowIso,
		updatedAt: nowIso,
		source: sanitizeSeasonEventSource_(sourceRaw || { type: "reconcile", seasonSource: season.source }),
		settings: {
			maxAccountsPerParticipant: defaults.maxAccountsPerParticipant,
			leaderboardMetric: defaults.leaderboardMetric,
		},
		participantsByDiscordId: {},
		participantsByTag: {},
		audit: {},
	};
}

// Build a generated CWL event id.
function buildCwlSeasonEventId_(nowIsoRaw) {
	const nowIso = sanitizeSeasonEventTimestampOrEmpty_(nowIsoRaw) || new Date().toISOString();
	const stamp = nowIso.replace(/[^0-9A-Za-z]+/g, "").slice(0, 17);
	const uuid = typeof Utilities !== "undefined" && Utilities && typeof Utilities.getUuid === "function" ? Utilities.getUuid() : String(Date.now());
	return "cwl-" + stamp + "-" + sanitizeSeasonEventText_(uuid, 80).replace(/[^0-9A-Za-z]+/g, "").slice(0, 8);
}

// Sanitize one compact CWL group binding.
function sanitizeCwlSeasonEventGroup_(groupRaw) {
	const group = groupRaw && typeof groupRaw === "object" ? groupRaw : {};
	const clanTagsRaw = Array.isArray(group.clanTags) ? group.clanTags : [];
	const clanTagSet = {};
	for (let i = 0; i < clanTagsRaw.length; i++) {
		const tag = normalizeTag_(clanTagsRaw[i]);
		if (tag) clanTagSet[tag] = true;
	}
	const warTagsRaw = Array.isArray(group.warTags) ? group.warTags : [];
	const warTagSet = {};
	for (let i = 0; i < warTagsRaw.length; i++) {
		const tag = normalizeTag_(warTagsRaw[i]);
		if (tag && tag !== "#0") warTagSet[tag] = true;
	}
	return {
		groupId: sanitizeSeasonEventText_(group.groupId, 180),
		anchorWarTag: normalizeTag_(group.anchorWarTag),
		season: sanitizeSeasonEventText_(group.season, 40),
		firstWarStartTime: sanitizeSeasonEventTimestampOrEmpty_(group.firstWarStartTime),
		lastWarEndTime: sanitizeSeasonEventTimestampOrEmpty_(group.lastWarEndTime),
		projectedLastWarEndTime: sanitizeSeasonEventTimestampOrEmpty_(group.projectedLastWarEndTime),
		expectedRounds: toNonNegativeInt_(group.expectedRounds),
		clanTags: Object.keys(clanTagSet).sort(),
		warTags: Object.keys(warTagSet).sort(),
	};
}

// Sanitize compact CWL event metadata.
function sanitizeCwlSeasonEventMeta_(metaRaw) {
	const meta = metaRaw && typeof metaRaw === "object" ? metaRaw : {};
	const groupsRaw = meta.groups && typeof meta.groups === "object" ? meta.groups : {};
	const groups = {};
	const groupKeys = Object.keys(groupsRaw).sort();
	for (let i = 0; i < groupKeys.length; i++) {
		const group = sanitizeCwlSeasonEventGroup_(groupsRaw[groupKeys[i]]);
		const groupId = group.groupId || sanitizeSeasonEventText_(groupKeys[i], 180);
		if (!groupId) continue;
		group.groupId = groupId;
		groups[groupId] = group;
	}
	return {
		bindToleranceMs: Math.max(60 * 60 * 1000, toNonNegativeInt_(meta.bindToleranceMs) || SEASON_EVENT_CWL_GROUP_BIND_TOLERANCE_MS),
		groups: groups,
		groupCount: Object.keys(groups).length,
		firstBoundGroupId: sanitizeSeasonEventText_(meta.firstBoundGroupId, 180),
		firstBoundAt: sanitizeSeasonEventTimestampOrEmpty_(meta.firstBoundAt),
		lastSuccessfulRefreshAt: sanitizeSeasonEventTimestampOrEmpty_(meta.lastSuccessfulRefreshAt),
		lastAttemptedRefreshAt: sanitizeSeasonEventTimestampOrEmpty_(meta.lastAttemptedRefreshAt),
		lastAggregateHash: sanitizeSeasonEventText_(meta.lastAggregateHash, 120),
		finalizationHash: sanitizeSeasonEventText_(meta.finalizationHash, 120),
		finalizationFirstSeenAt: sanitizeSeasonEventTimestampOrEmpty_(meta.finalizationFirstSeenAt),
		finalizedAt: sanitizeSeasonEventTimestampOrEmpty_(meta.finalizedAt),
		stale: toBooleanFlag_(meta.stale),
		staleSince: sanitizeSeasonEventTimestampOrEmpty_(meta.staleSince),
		staleReason: sanitizeSeasonEventText_(meta.staleReason, 160),
	};
}

// Build a default waiting CWL event.
function buildDefaultCwlSeasonEvent_(sourceRaw) {
	const nowIso = new Date().toISOString();
	const eventId = buildCwlSeasonEventId_(nowIso);
	return {
		eventId: eventId,
		type: "cwl",
		seasonId: eventId,
		title: "CWL Event",
		description: "",
		status: "open",
		visibility: "public",
		signupsOpen: true,
		startsAt: "",
		endsAt: "",
		createdAt: nowIso,
		updatedAt: nowIso,
		source: sanitizeSeasonEventSource_(sourceRaw || { type: "cwl-event-created" }),
		settings: {
			maxAccountsPerParticipant: SEASON_EVENT_DEFAULTS_BY_TYPE.cwl.maxAccountsPerParticipant,
			leaderboardMetric: SEASON_EVENT_DEFAULTS_BY_TYPE.cwl.leaderboardMetric,
		},
		cwlTrackingState: "waiting",
		cwl: {
			bindToleranceMs: SEASON_EVENT_CWL_GROUP_BIND_TOLERANCE_MS,
			groups: {},
			groupCount: 0,
			firstBoundGroupId: "",
			firstBoundAt: "",
			lastSuccessfulRefreshAt: "",
			lastAttemptedRefreshAt: "",
			lastAggregateHash: "",
			finalizationHash: "",
			finalizationFirstSeenAt: "",
			finalizedAt: "",
			stale: false,
			staleSince: "",
			staleReason: "",
		},
		participantsByDiscordId: {},
		participantsByTag: {},
		audit: {},
	};
}

// Summarize event participant counts.
function summarizeSeasonEventParticipantCounts_(eventRaw) {
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
	const byDiscordId = event.participantsByDiscordId && typeof event.participantsByDiscordId === "object" ? event.participantsByDiscordId : {};
	const ids = Object.keys(byDiscordId);
	let activeParticipantCount = 0;
	let accountCount = 0;
	for (let i = 0; i < ids.length; i++) {
		const participant = byDiscordId[ids[i]] && typeof byDiscordId[ids[i]] === "object" ? byDiscordId[ids[i]] : {};
		if (participant.status === "signed_up") {
			activeParticipantCount++;
			accountCount += Array.isArray(participant.accounts) ? participant.accounts.length : 0;
		}
	}
	return {
		participantCount: ids.length,
		activeParticipantCount: activeParticipantCount,
		accountCount: accountCount,
	};
}

// Summarize season event.
function summarizeSeasonEvent_(eventRaw) {
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
	const counts = summarizeSeasonEventParticipantCounts_(event);
	const settings = event.settings && typeof event.settings === "object" ? event.settings : {};
	const eventType = normalizeSeasonEventType_(event.type);
	const defaults = eventType ? getSeasonEventTypeDefaults_(eventType) : { maxAccountsPerParticipant: 1, leaderboardMetric: "" };
	let leaderboardMetric = sanitizeSeasonEventText_(settings.leaderboardMetric, 80) || defaults.leaderboardMetric;
	if (eventType === "push" && leaderboardMetric === "trophyDelta") leaderboardMetric = defaults.leaderboardMetric;
	const out = {
		eventId: sanitizeSeasonEventText_(event.eventId, 180),
		type: eventType,
		seasonId: sanitizeSeasonEventText_(event.seasonId, 80),
		title: sanitizeSeasonEventText_(event.title, 160),
		description: String(event.description == null ? "" : event.description),
		status: normalizeSeasonEventStatus_(event.status) || "draft",
		visibility: normalizeSeasonEventVisibility_(event.visibility) || "hidden",
		signupsOpen: event.signupsOpen === true,
		startsAt: sanitizeSeasonEventTimestampOrEmpty_(event.startsAt),
		endsAt: sanitizeSeasonEventTimestampOrEmpty_(event.endsAt),
		createdAt: sanitizeSeasonEventTimestampOrEmpty_(event.createdAt),
		updatedAt: sanitizeSeasonEventTimestampOrEmpty_(event.updatedAt),
		source: event.source || "",
		settings: {
			maxAccountsPerParticipant: Math.max(1, toNonNegativeInt_(settings.maxAccountsPerParticipant) || defaults.maxAccountsPerParticipant),
			leaderboardMetric: leaderboardMetric,
		},
		participantCount: counts.participantCount,
		activeParticipantCount: counts.activeParticipantCount,
		accountCount: counts.accountCount,
	};
	if (eventType === "cwl") {
		const cwl = sanitizeCwlSeasonEventMeta_(event.cwl);
		out.cwlTrackingState = normalizeCwlTrackingState_(event.cwlTrackingState) || "waiting";
		out.cwlStatus = out.cwlTrackingState;
		out.cwl = {
			groupCount: cwl.groupCount,
			firstBoundGroupId: cwl.firstBoundGroupId,
			firstBoundAt: cwl.firstBoundAt,
			lastSuccessfulRefreshAt: cwl.lastSuccessfulRefreshAt,
			lastAttemptedRefreshAt: cwl.lastAttemptedRefreshAt,
			stale: cwl.stale,
			staleSince: cwl.staleSince,
			staleReason: cwl.staleReason,
			finalizationFirstSeenAt: cwl.finalizationFirstSeenAt,
			finalizedAt: cwl.finalizedAt,
		};
	}
	return out;
}

// Build pointer payload.
function buildSeasonEventPointerPayload_(eventRaw, seasonRaw) {
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
	const season = seasonRaw && typeof seasonRaw === "object" ? seasonRaw : {};
	return {
		eventId: sanitizeSeasonEventText_(event.eventId, 180),
		type: normalizeSeasonEventType_(event.type),
		seasonId: sanitizeSeasonEventText_(event.seasonId || season.seasonId, 80),
		startsAt: sanitizeSeasonEventTimestampOrEmpty_(event.startsAt || season.startsAt),
		endsAt: sanitizeSeasonEventTimestampOrEmpty_(event.endsAt || season.endsAt),
	};
}

// Put pointer if changed.
function putSeasonEventPointerIfChanged_(pathRaw, pointerRaw) {
	const pointer = pointerRaw && typeof pointerRaw === "object" ? pointerRaw : {};
	const existing = readSeasonEventPointer_(pathRaw);
	if (JSON.stringify(existing || null) === JSON.stringify(pointer)) return false;
	writeSeasonEventFirebasePayload_(pathRaw, "PUT", pointer);
	return true;
}

// Reconcile current season events.
function reconcileCurrentSeasonEvents_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const season = resolveCurrentRankedSeason_(options);
	const source = sanitizeSeasonEventSource_(options.source || { type: "reconcile", seasonSource: season.source });
	const eventTypes = ["push", "donation"];
	const events = {};
	const createdEventIds = [];
	let pointerChangedCount = 0;

	for (let i = 0; i < eventTypes.length; i++) {
		const eventType = eventTypes[i];
		const eventId = buildSeasonEventId_(eventType, season.seasonId);
		let event = readSeasonEventById_(eventId);
		if (!event) {
			event = buildDefaultSeasonEvent_(eventType, season, source);
			writeSeasonEventFirebasePayload_(buildSeasonEventByIdPath_(event.eventId), "PUT", event);
			writeSeasonEventAuditEntry_(event.eventId, {
				action: "event-created",
				eventId: event.eventId,
				createdAt: event.createdAt,
				source: source,
				details: {
					type: eventType,
					seasonId: season.seasonId,
					seasonSource: season.source,
				},
			});
			createdEventIds.push(event.eventId);
		}

		const pointer = buildSeasonEventPointerPayload_(event, season);
		if (putSeasonEventPointerIfChanged_(buildSeasonEventCurrentPointerPath_(eventType), pointer)) pointerChangedCount++;
		if (putSeasonEventPointerIfChanged_(buildSeasonEventBySeasonPointerPath_(season.seasonId, eventType), pointer)) pointerChangedCount++;
		events[eventType] = summarizeSeasonEvent_(event);
	}

	// TODO: Close/archive prior-season current events after an explicit retention
	// policy exists. Phase 1 leaves previous events untouched.
	return {
		ok: true,
		season: season,
		events: events,
		createdEventIds: createdEventIds,
		pointerChangedCount: pointerChangedCount,
		previousEventsClosed: false,
	};
}

// Public reconcile callable.
function reconcileCurrentSeasonEvents(payloadRaw, secretOrPassword) {
	const parsed = parseSeasonEventOptionalPayloadAndSecret_(payloadRaw, secretOrPassword);
	assertSeasonEventSecretOrAdmin_(parsed.secretOrPassword);
	const payload = parsed.payload;
	const result = reconcileCurrentSeasonEvents_({
		forceRefresh: payload.forceRefresh === true,
		manualSeason: payload.manualSeason,
		now: payload.now || payload.nowIso,
		source: payload.source || { type: "api-reconcile" },
	});
	publishCloudflareSeasonEventsAfterMutation_("api-reconcile-season-events");
	return result;
}

// Public get current events callable.
function getCurrentSeasonEvents(payloadRaw, secretOrPassword) {
	const parsed = parseSeasonEventOptionalPayloadAndSecret_(payloadRaw, secretOrPassword);
	assertSeasonEventSecretOrAdmin_(parsed.secretOrPassword);
	const payload = parsed.payload;
	const season = resolveCurrentRankedSeason_({
		forceRefresh: payload.forceRefresh === true,
		manualSeason: payload.manualSeason,
		now: payload.now || payload.nowIso,
	});
	const events = {};
	const eventTypes = ["push", "donation"];
	for (let i = 0; i < eventTypes.length; i++) {
		const eventType = eventTypes[i];
		const pointer = readSeasonEventPointer_(buildSeasonEventCurrentPointerPath_(eventType));
		const eventId = sanitizeSeasonEventText_((pointer && pointer.eventId) || buildSeasonEventId_(eventType, season.seasonId), 180);
		const event = eventId ? readSeasonEventById_(eventId) : null;
		events[eventType] = event ? summarizeSeasonEvent_(event) : null;
	}
	const cwlPointer = readSeasonEventPointer_(SEASON_EVENTS_CURRENT_CWL_PATH);
	const cwlEventId = sanitizeSeasonEventText_(cwlPointer && cwlPointer.eventId, 180);
	const cwlEvent = cwlEventId ? readSeasonEventById_(cwlEventId) : null;
	events.cwl = cwlEvent ? summarizeSeasonEvent_(cwlEvent) : null;
	const latestCompletedCwlPointer = readSeasonEventPointer_(SEASON_EVENTS_LATEST_COMPLETED_CWL_PATH);
	return {
		ok: true,
		season: season,
		events: events,
		cwl: {
			current: events.cwl,
			latestCompleted: latestCompletedCwlPointer || null,
		},
	};
}

// Read the current CWL event pointed to by the independent CWL pointer.
function readCurrentCwlSeasonEvent_() {
	const pointer = readSeasonEventPointer_(SEASON_EVENTS_CURRENT_CWL_PATH);
	const eventId = sanitizeSeasonEventText_(pointer && pointer.eventId, 180);
	return eventId ? readSeasonEventById_(eventId) : null;
}

// Ensure there is a non-completed current CWL event.
function ensureCurrentCwlSeasonEvent_(sourceRaw) {
	return withSeasonEventParticipantWriteLock_(function () {
		const existing = readCurrentCwlSeasonEvent_();
		const existingState = existing ? normalizeCwlTrackingState_(existing.cwlTrackingState) || "waiting" : "";
		if (existing && existing.type === "cwl" && existingState !== "completed") {
			return {
				ok: true,
				status: "current-cwl-event-reused",
				event: summarizeSeasonEvent_(existing),
				created: false,
			};
		}

		const event = buildDefaultCwlSeasonEvent_(sourceRaw || { type: "api-ensure-cwl-event" });
		writeSeasonEventFirebasePayload_(buildSeasonEventByIdPath_(event.eventId), "PUT", event);
		writeSeasonEventFirebasePayload_(SEASON_EVENTS_CURRENT_CWL_PATH, "PUT", buildSeasonEventPointerPayload_(event, event));
		writeSeasonEventAuditEntry_(event.eventId, {
			action: "event-created",
			eventId: event.eventId,
			createdAt: event.createdAt,
			source: sourceRaw || { type: "api-ensure-cwl-event" },
			details: {
				type: "cwl",
				cwlTrackingState: "waiting",
			},
		});
		return {
			ok: true,
			status: "current-cwl-event-created",
			event: summarizeSeasonEvent_(event),
			created: true,
		};
	});
}

// Public ensure-current CWL event callable.
function ensureCurrentCwlSeasonEvent(payloadRaw, secretOrPassword) {
	const parsed = parseSeasonEventOptionalPayloadAndSecret_(payloadRaw, secretOrPassword);
	assertSeasonEventSecretOrAdmin_(parsed.secretOrPassword);
	const payload = parsed.payload;
	const result = ensureCurrentCwlSeasonEvent_(payload.source || { type: "api-ensure-cwl-event" });
	if (result && result.created === true) publishCloudflareSeasonEventsAfterMutation_("api-ensure-current-cwl");
	return result;
}

// Public current-CWL event read callable.
function getCurrentCwlSeasonEvent(payloadRaw, secretOrPassword) {
	const parsed = parseSeasonEventOptionalPayloadAndSecret_(payloadRaw, secretOrPassword);
	assertSeasonEventSecretOrAdmin_(parsed.secretOrPassword);
	const event = readCurrentCwlSeasonEvent_();
	const latestCompleted = readSeasonEventPointer_(SEASON_EVENTS_LATEST_COMPLETED_CWL_PATH);
	return {
		ok: true,
		event: event ? summarizeSeasonEvent_(event) : null,
		latestCompleted: latestCompleted || null,
	};
}

// Public current-CWL refresh callable. This uses the same shared snapshot and
// aggregation path as refresh-all without mutating roster payloads.
function refreshCurrentCwlSeasonEvent(payloadRaw, secretOrPassword) {
	const parsed = parseSeasonEventOptionalPayloadAndSecret_(payloadRaw, secretOrPassword);
	const payload = parsed.payload;
	assertSeasonEventSecretOrAdmin_(parsed.secretOrPassword);
	const sourceSnapshot =
		typeof readAutoRefreshCoordinatorSourceSnapshot_ === "function"
			? readAutoRefreshCoordinatorSourceSnapshot_()
			: readActiveRosterSnapshot_();
	const rosterData = validateRosterData_(sourceSnapshot && sourceSnapshot.rosterData);
	const snapshot = buildAutoRefreshSnapshot_(rosterData, {
		sourceRosters: Array.isArray(rosterData.rosters) ? rosterData.rosters : [],
		allowRegularWarHistoryRepair: false,
	});
	const result = tryRefreshCurrentCwlSeasonEventFromSnapshot_(rosterData, snapshot, {
		source: payload.source || { type: "api-refresh-current-cwl-event" },
		nowIso: payload.nowIso || payload.now,
	});
	if (result && typeof result === "object") {
		result.requestCounts = snapshot && snapshot.requestCounts && typeof snapshot.requestCounts === "object"
			? {
				leagueGroup: toNonNegativeInt_(snapshot.requestCounts.leagueGroup),
				cwlWar: toNonNegativeInt_(snapshot.requestCounts.cwlWar),
				total: toNonNegativeInt_(snapshot.requestCounts.total),
			}
			: {};
	}
	if (result && result.ok !== false) publishCloudflareSeasonEventsAfterMutation_("api-refresh-current-cwl");
	return result || { ok: false, status: "unknown" };
}

// Sanitize participant account.
function sanitizeSeasonEventParticipantAccount_(accountRaw) {
	const account = accountRaw && typeof accountRaw === "object" ? accountRaw : {};
	const tag = normalizeTag_(account.tag);
	if (!tag) return null;
	const league = account.leagueName != null ? account.leagueName : account.league && account.league.name;
	return {
		tag: tag,
		name: sanitizeSeasonEventText_(account.name, 120),
		townHallLevel: toNonNegativeInt_(account.townHallLevel != null ? account.townHallLevel : account.th),
		trophies: toNonNegativeInt_(account.trophies),
		leagueName: sanitizeSeasonEventText_(league, 120),
		matchType: account.matchType === "discordUsername" ? "discordUsername" : "discordId",
	};
}

// Sanitize participant.
function sanitizeSeasonEventParticipant_(participantRaw) {
	const participant = participantRaw && typeof participantRaw === "object" ? participantRaw : {};
	const accountsRaw = Array.isArray(participant.accounts) ? participant.accounts : [];
	const accounts = [];
	const seen = {};
	for (let i = 0; i < accountsRaw.length; i++) {
		const account = sanitizeSeasonEventParticipantAccount_(accountsRaw[i]);
		if (!account || seen[account.tag]) continue;
		seen[account.tag] = true;
		accounts.push(account);
	}
	const statusText = String(participant.status == null ? "" : participant.status)
		.trim()
		.toLowerCase();
	const status = statusText === "cancelled" || statusText === "removed" ? statusText : "signed_up";
	return {
		discordId: sanitizeDiscordIdValue_(participant.discordId),
		discordUsername: sanitizeDiscordUsernameValue_(participant.discordUsername),
		discordGlobalName: sanitizeSeasonEventText_(participant.discordGlobalName, 120),
		discordDisplayName: sanitizeSeasonEventText_(participant.discordDisplayName, 120),
		status: status,
		accounts: accounts,
		signedUpAt: sanitizeSeasonEventTimestampOrEmpty_(participant.signedUpAt),
		updatedAt: sanitizeSeasonEventTimestampOrEmpty_(participant.updatedAt),
		cancelledAt: sanitizeSeasonEventTimestampOrEmpty_(participant.cancelledAt),
		removedAt: sanitizeSeasonEventTimestampOrEmpty_(participant.removedAt),
		source: participant.source || "",
	};
}

// Summarize participants for read endpoint.
function listSeasonEventParticipantSummaries_(eventRaw) {
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
	const byDiscordId = event.participantsByDiscordId && typeof event.participantsByDiscordId === "object" ? event.participantsByDiscordId : {};
	const ids = Object.keys(byDiscordId).sort();
	const participants = [];
	for (let i = 0; i < ids.length; i++) {
		const participant = sanitizeSeasonEventParticipant_(byDiscordId[ids[i]]);
		if (!participant.discordId) participant.discordId = sanitizeDiscordIdValue_(ids[i]);
		participants.push(participant);
	}
	participants.sort((left, right) => {
		if (left.status !== right.status) return left.status === "signed_up" ? -1 : right.status === "signed_up" ? 1 : left.status < right.status ? -1 : 1;
		const leftName = left.discordDisplayName || left.discordGlobalName || left.discordUsername || left.discordId;
		const rightName = right.discordDisplayName || right.discordGlobalName || right.discordUsername || right.discordId;
		return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
	});
	return participants;
}

// Public get event callable.
function getSeasonEvent(payloadRaw, secretOrPassword) {
	assertSeasonEventSecretOrAdmin_(secretOrPassword);
	const payload = payloadRaw && typeof payloadRaw === "object" ? payloadRaw : {};
	const eventId = sanitizeSeasonEventText_(payload.eventId, 180);
	if (!eventId) throw new Error("Event ID is required.");
	const event = readSeasonEventById_(eventId);
	if (!event) {
		return {
			ok: true,
			status: "event-not-found",
			event: null,
			participants: payload.includeParticipants === true ? [] : undefined,
		};
	}
	const out = {
		ok: true,
		event: summarizeSeasonEvent_(event),
	};
	if (payload.includeParticipants === true) out.participants = listSeasonEventParticipantSummaries_(event);
	return out;
}

// Public update event callable.
function updateSeasonEvent(payloadRaw, secretOrPassword) {
	assertSeasonEventSecretOrAdmin_(secretOrPassword);
	const payload = payloadRaw && typeof payloadRaw === "object" ? payloadRaw : {};
	const eventId = sanitizeSeasonEventText_(payload.eventId, 180);
	if (!eventId) throw new Error("Event ID is required.");
	const patchRaw = payload.patch && typeof payload.patch === "object" ? payload.patch : {};
	const patchKeys = Object.keys(patchRaw);
	if (!patchKeys.length) throw new Error("Season event patch is required.");
	for (let i = 0; i < patchKeys.length; i++) {
		const key = patchKeys[i];
		if (key === "eventId" || key === "type" || key === "seasonId") {
			throw new Error("Season event field '" + key + "' cannot be changed in phase 1.");
		}
		if (!Object.prototype.hasOwnProperty.call(SEASON_EVENT_PATCH_FIELDS, key)) {
			throw new Error("Unsupported season event patch field: " + key);
		}
	}

	const event = readSeasonEventById_(eventId);
	if (!event) throw new Error("Season event not found: " + eventId);

	const patch = {};
	for (let i = 0; i < patchKeys.length; i++) {
		const key = patchKeys[i];
		if (key === "title") patch.title = sanitizeSeasonEventText_(patchRaw.title, 160);
		else if (key === "description") patch.description = String(patchRaw.description == null ? "" : patchRaw.description).slice(0, 2000);
		else if (key === "status") {
			const status = normalizeSeasonEventStatus_(patchRaw.status);
			if (!status) throw new Error("Invalid season event status.");
			patch.status = status;
		} else if (key === "visibility") {
			const visibility = normalizeSeasonEventVisibility_(patchRaw.visibility);
			if (!visibility) throw new Error("Invalid season event visibility.");
			patch.visibility = visibility;
		} else if (key === "signupsOpen") {
			patch.signupsOpen = toBooleanFlag_(patchRaw.signupsOpen);
		} else if (key === "startsAt" || key === "endsAt") {
			patch[key] = patchRaw[key] == null || String(patchRaw[key]).trim() === "" ? "" : sanitizeSeasonEventTimestamp_(patchRaw[key]);
		}
	}
	patch.updatedAt = new Date().toISOString();
	writeSeasonEventFirebasePayload_(buildSeasonEventByIdPath_(eventId), "PATCH", patch);
	const updated = Object.assign({}, event, patch);
	writeSeasonEventAuditEntry_(eventId, {
		action: "event-updated",
		eventId: eventId,
		createdAt: patch.updatedAt,
		source: payload.source || { type: "api-update-event" },
		details: {
			changedFields: patchKeys,
		},
	});
	publishCloudflareSeasonEventsAfterMutation_("api-update-season-event");
	return {
		ok: true,
		event: summarizeSeasonEvent_(updated),
	};
}

// Sanitize Discord user payload.
function sanitizeSeasonEventDiscordUser_(discordUserRaw) {
	const user = discordUserRaw && typeof discordUserRaw === "object" ? discordUserRaw : {};
	const username = sanitizeDiscordUsernameValue_(user.username);
	const globalName = sanitizeSeasonEventText_(user.globalName, 120);
	const displayName = sanitizeSeasonEventText_(user.displayName, 120) || globalName || username;
	const discordId = sanitizeDiscordIdValue_(user.id || user.discordId);
	if (!discordId) throw new Error("Discord user ID is required.");
	return {
		id: discordId,
		username: username,
		globalName: globalName,
		displayName: displayName,
	};
}

// Find linked accounts for Discord user from canonical playerMetrics identity.
function findLinkedAccountsForDiscordUser_(rosterDataRaw, discordUserRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const user = discordUserRaw && typeof discordUserRaw === "object" ? discordUserRaw : {};
	const wantedDiscordId = sanitizeDiscordIdValue_(user.id || user.discordId);
	const wantedUsername = sanitizeDiscordUsernameValue_(user.username || user.discordUsername);
	const store = rosterData.playerMetrics && typeof rosterData.playerMetrics === "object" ? rosterData.playerMetrics : {};
	const byTag = store.byTag && typeof store.byTag === "object" ? store.byTag : {};
	const keys = Object.keys(byTag).sort();
	const idMatches = [];
	const usernameMatches = [];

	for (let i = 0; i < keys.length; i++) {
		const tag = normalizeTag_(keys[i]);
		if (!tag) continue;
		const entry = byTag[keys[i]] && typeof byTag[keys[i]] === "object" ? byTag[keys[i]] : {};
		const identity = sanitizePlayerMetricsIdentity_(entry.identity, tag, entry.identity && entry.identity.name);
		if (!identity || !hasCanonicalDiscordIdentity_(identity)) continue;
		const identityDiscordId = sanitizeDiscordIdValue_(identity.discordId);
		const identityUsername = sanitizeDiscordUsernameValue_(identity.discordUsername);
		const latest = entry.latestSnapshot && typeof entry.latestSnapshot === "object" ? entry.latestSnapshot : {};
		const leagueName =
			(latest.league && typeof latest.league === "object" && latest.league.name) ||
			(latest.leagueTier && typeof latest.leagueTier === "object" && latest.leagueTier.name) ||
			"";
		const account = {
			tag: tag,
			name: sanitizeSeasonEventText_(identity.name || latest.name, 120),
			townHallLevel: toNonNegativeInt_(latest.townHallLevel != null ? latest.townHallLevel : latest.th),
			trophies: toNonNegativeInt_(latest.trophies),
			leagueName: sanitizeSeasonEventText_(leagueName, 120),
			discordId: identityDiscordId,
			discordUsername: identityUsername,
			matchType: "discordId",
		};
		if (wantedDiscordId && identityDiscordId && identityDiscordId === wantedDiscordId) {
			idMatches.push(account);
			continue;
		}
		if (wantedUsername && !identityDiscordId && identityUsername && identityUsername === wantedUsername) {
			const usernameAccount = Object.assign({}, account, { matchType: "discordUsername" });
			usernameMatches.push(usernameAccount);
		}
	}

	if (idMatches.length > 0) return idMatches;
	if (usernameMatches.length === 1) return usernameMatches;
	return [];
}

// Return event max accounts.
function getSeasonEventMaxAccounts_(eventRaw) {
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
	const settings = event.settings && typeof event.settings === "object" ? event.settings : {};
	const fallback = getSeasonEventTypeDefaults_(event.type).maxAccountsPerParticipant;
	return Math.max(1, toNonNegativeInt_(settings.maxAccountsPerParticipant) || fallback);
}

// Build linked account map.
function buildSeasonEventLinkedAccountMap_(linkedAccountsRaw) {
	const linkedAccounts = Array.isArray(linkedAccountsRaw) ? linkedAccountsRaw : [];
	const byTag = {};
	for (let i = 0; i < linkedAccounts.length; i++) {
		const account = linkedAccounts[i] && typeof linkedAccounts[i] === "object" ? linkedAccounts[i] : {};
		const tag = normalizeTag_(account.tag);
		if (!tag) continue;
		byTag[tag] = account;
	}
	return byTag;
}

// Normalize selected player tags.
function normalizeSeasonEventSelectedPlayerTags_(playerTagsRaw) {
	const list = Array.isArray(playerTagsRaw) ? playerTagsRaw : [];
	const tags = [];
	const seen = {};
	for (let i = 0; i < list.length; i++) {
		const tag = normalizeTag_(list[i]);
		if (!isValidPlayerTag_(tag)) {
			return {
				ok: false,
				status: "player-tag-not-linked",
				playerTags: tags,
				invalidTag: String(list[i] == null ? "" : list[i]).trim(),
			};
		}
		if (seen[tag]) {
			return {
				ok: false,
				status: "duplicate-player-tags",
				playerTags: tags,
				duplicateTag: tag,
			};
		}
		seen[tag] = true;
		tags.push(tag);
	}
	return {
		ok: true,
		playerTags: tags,
	};
}

// Select signup accounts.
function selectSeasonEventAccountsForDiscordUser_(eventRaw, linkedAccountsRaw, playerTagsRaw) {
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
	const linkedAccounts = Array.isArray(linkedAccountsRaw) ? linkedAccountsRaw : [];
	const maxAccounts = getSeasonEventMaxAccounts_(event);
	if (!linkedAccounts.length) {
		return {
			ok: false,
			status: "not-linked",
			linkedAccounts: [],
		};
	}

	const hasExplicitTags = Array.isArray(playerTagsRaw) && playerTagsRaw.length > 0;
	if (!hasExplicitTags) {
		if (linkedAccounts.length === 1) {
			return {
				ok: true,
				accounts: [linkedAccounts[0]],
				linkedAccounts: linkedAccounts,
			};
		}
		return {
			ok: false,
			status: "multiple-linked-accounts",
			linkedAccounts: linkedAccounts,
		};
	}

	const normalized = normalizeSeasonEventSelectedPlayerTags_(playerTagsRaw);
	if (!normalized.ok) {
		return Object.assign({}, normalized, { linkedAccounts: linkedAccounts });
	}
	if (normalized.playerTags.length > maxAccounts) {
		return {
			ok: false,
			status: "too-many-accounts",
			playerTags: normalized.playerTags,
			maxAccounts: maxAccounts,
			linkedAccounts: linkedAccounts,
		};
	}

	const linkedByTag = buildSeasonEventLinkedAccountMap_(linkedAccounts);
	const accounts = [];
	for (let i = 0; i < normalized.playerTags.length; i++) {
		const tag = normalized.playerTags[i];
		if (!linkedByTag[tag]) {
			return {
				ok: false,
				status: "player-tag-not-linked",
				playerTags: normalized.playerTags,
				unlinkedTag: tag,
				linkedAccounts: linkedAccounts,
			};
		}
		accounts.push(linkedByTag[tag]);
	}
	return {
		ok: true,
		accounts: accounts,
		linkedAccounts: linkedAccounts,
	};
}

// Build simple status response.
function buildSeasonEventStatusResponse_(statusRaw, extraRaw) {
	const extra = extraRaw && typeof extraRaw === "object" ? extraRaw : {};
	return Object.assign({ ok: true, status: String(statusRaw || "") }, extra);
}

// Check event signup availability.
function checkSeasonEventSignupAvailability_(eventRaw, nowIsoRaw) {
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : null;
	if (!event) return "event-not-found";
	if (normalizeSeasonEventStatus_(event.status) !== "open") return "event-not-open";
	if (event.signupsOpen !== true) return "signups-closed";
	const nowMs = parseIsoToMs_(nowIsoRaw) || Date.now();
	const startsMs = parseIsoToMs_(event.startsAt);
	const endsMs = parseIsoToMs_(event.endsAt);
	if ((startsMs > 0 && nowMs < startsMs) || (endsMs > 0 && nowMs > endsMs)) return "event-closed";
	return "";
}

// Compare account tag sets.
function sameSeasonEventAccountSet_(leftRaw, rightRaw) {
	const normalize = (accountsRaw) => {
		const accounts = Array.isArray(accountsRaw) ? accountsRaw : [];
		const tags = [];
		const seen = {};
		for (let i = 0; i < accounts.length; i++) {
			const tag = normalizeTag_(accounts[i] && accounts[i].tag);
			if (!tag || seen[tag]) continue;
			seen[tag] = true;
			tags.push(tag);
		}
		return tags.sort().join("|");
	};
	return normalize(leftRaw) === normalize(rightRaw);
}

// Build participant payload.
function buildSeasonEventParticipantPayload_(discordUserRaw, accountsRaw, nowIsoRaw, sourceRaw, existingRaw) {
	const user = sanitizeSeasonEventDiscordUser_(discordUserRaw);
	const nowIso = sanitizeSeasonEventTimestampOrEmpty_(nowIsoRaw) || new Date().toISOString();
	const existing = existingRaw && typeof existingRaw === "object" ? sanitizeSeasonEventParticipant_(existingRaw) : null;
	const accounts = [];
	const selected = Array.isArray(accountsRaw) ? accountsRaw : [];
	for (let i = 0; i < selected.length; i++) {
		const account = sanitizeSeasonEventParticipantAccount_(selected[i]);
		if (account) accounts.push(account);
	}
	return {
		discordId: user.id,
		discordUsername: user.username,
		discordGlobalName: user.globalName,
		discordDisplayName: user.displayName,
		status: "signed_up",
		accounts: accounts,
		signedUpAt: existing && existing.status === "signed_up" && existing.signedUpAt ? existing.signedUpAt : nowIso,
		updatedAt: nowIso,
		cancelledAt: "",
		removedAt: "",
		source: sanitizeSeasonEventSource_(sourceRaw),
	};
}

// Find tag assigned to another Discord user.
function findSeasonEventTagAssignedToOther_(eventRaw, tagsRaw, discordIdRaw) {
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
	const tags = Array.isArray(tagsRaw) ? tagsRaw : [];
	const discordId = sanitizeDiscordIdValue_(discordIdRaw);
	const participantsByTag = event.participantsByTag && typeof event.participantsByTag === "object" ? event.participantsByTag : {};
	for (let i = 0; i < tags.length; i++) {
		const tag = normalizeTag_(tags[i]);
		if (!tag) continue;
		const index = participantsByTag[tag] && typeof participantsByTag[tag] === "object" ? participantsByTag[tag] : null;
		const assignedDiscordId = sanitizeDiscordIdValue_(index && index.discordId);
		if (assignedDiscordId && assignedDiscordId !== discordId) {
			return {
				tag: tag,
				discordId: assignedDiscordId,
			};
		}
	}
	return null;
}

// Remove indexes for participant old accounts.
function removeSeasonEventParticipantTagIndexes_(eventIdRaw, participantRaw) {
	const participant = sanitizeSeasonEventParticipant_(participantRaw);
	const accounts = Array.isArray(participant.accounts) ? participant.accounts : [];
	for (let i = 0; i < accounts.length; i++) {
		const tag = normalizeTag_(accounts[i] && accounts[i].tag);
		if (!tag) continue;
		const path = buildSeasonEventParticipantTagIndexPath_(eventIdRaw, tag);
		const existing = decodeSeasonEventFirebasePayload_(firebaseRequestJson_(path, "GET"));
		const assignedDiscordId = sanitizeDiscordIdValue_(existing && existing.discordId);
		if (!assignedDiscordId || assignedDiscordId === participant.discordId) {
			firebaseRequestJson_(path, "DELETE");
		}
	}
}

// Add indexes for participant accounts.
function addSeasonEventParticipantTagIndexes_(eventIdRaw, participantRaw, assignedAtRaw) {
	const participant = sanitizeSeasonEventParticipant_(participantRaw);
	const assignedAt = sanitizeSeasonEventTimestampOrEmpty_(assignedAtRaw) || new Date().toISOString();
	const accounts = Array.isArray(participant.accounts) ? participant.accounts : [];
	for (let i = 0; i < accounts.length; i++) {
		const tag = normalizeTag_(accounts[i] && accounts[i].tag);
		if (!tag) continue;
		writeSeasonEventFirebasePayload_(buildSeasonEventParticipantTagIndexPath_(eventIdRaw, tag), "PUT", {
			discordId: participant.discordId,
			tag: tag,
			assignedAt: assignedAt,
		});
	}
}

// Run a short season-event participant write lock section.
function withSeasonEventParticipantWriteLock_(callback) {
	if (typeof callback !== "function") throw new Error("Season event participant write callback is required.");
	const lock = LockService.getScriptLock();
	lock.waitLock(SEASON_EVENT_LOCK_WAIT_MS);
	try {
		return callback();
	} finally {
		lock.releaseLock();
	}
}

// Public signup callable.
function registerSeasonEventSignup(payloadRaw, botSecret) {
	assertDiscordBotApiSecret_(botSecret);
	const payload = payloadRaw && typeof payloadRaw === "object" ? payloadRaw : {};
	const eventId = sanitizeSeasonEventText_(payload.eventId, 180);
	if (!eventId) throw new Error("Event ID is required.");
	const discordUser = sanitizeSeasonEventDiscordUser_(payload.discordUser);
	const nowIso = new Date().toISOString();

	const eventBeforeLock = readSeasonEventById_(eventId);
	const availability = checkSeasonEventSignupAvailability_(eventBeforeLock, nowIso);
	if (availability) return buildSeasonEventStatusResponse_(availability, { event: eventBeforeLock ? summarizeSeasonEvent_(eventBeforeLock) : null });

	const activeSnapshot = readActiveRosterSnapshot_();
	const rosterData = activeSnapshot && activeSnapshot.rosterData ? activeSnapshot.rosterData : {};
	const linkedAccounts = findLinkedAccountsForDiscordUser_(rosterData, discordUser);
	const selected = selectSeasonEventAccountsForDiscordUser_(eventBeforeLock, linkedAccounts, payload.playerTags);
	if (!selected.ok) {
		return buildSeasonEventStatusResponse_(selected.status, {
			event: summarizeSeasonEvent_(eventBeforeLock),
			linkedAccounts: selected.linkedAccounts || linkedAccounts,
			playerTags: selected.playerTags || [],
			maxAccounts: selected.maxAccounts || getSeasonEventMaxAccounts_(eventBeforeLock),
		});
	}

	return withSeasonEventParticipantWriteLock_(function () {
		const event = readSeasonEventById_(eventId);
		const lockedAvailability = checkSeasonEventSignupAvailability_(event, nowIso);
		if (lockedAvailability) return buildSeasonEventStatusResponse_(lockedAvailability, { event: event ? summarizeSeasonEvent_(event) : null });

		const tags = selected.accounts.map((account) => normalizeTag_(account && account.tag)).filter((tag) => tag);
		const assigned = findSeasonEventTagAssignedToOther_(event, tags, discordUser.id);
		if (assigned) {
			return buildSeasonEventStatusResponse_("tag-already-assigned", {
				event: summarizeSeasonEvent_(event),
				tag: assigned.tag,
				discordId: assigned.discordId,
			});
		}

		const participantsByDiscordId = event.participantsByDiscordId && typeof event.participantsByDiscordId === "object" ? event.participantsByDiscordId : {};
		const existing = participantsByDiscordId[discordUser.id] && typeof participantsByDiscordId[discordUser.id] === "object" ? participantsByDiscordId[discordUser.id] : null;
		if (existing && sanitizeSeasonEventParticipant_(existing).status === "signed_up") {
			if (sameSeasonEventAccountSet_(existing.accounts, selected.accounts)) {
				return buildSeasonEventStatusResponse_("already-signed-up", {
					event: summarizeSeasonEvent_(event),
					participant: sanitizeSeasonEventParticipant_(existing),
				});
			}
			return buildSeasonEventStatusResponse_("accounts-differ-use-update-endpoint", {
				event: summarizeSeasonEvent_(event),
				participant: sanitizeSeasonEventParticipant_(existing),
			});
		}

		if (existing) removeSeasonEventParticipantTagIndexes_(eventId, existing);
		const participant = buildSeasonEventParticipantPayload_(discordUser, selected.accounts, nowIso, payload.source || { type: "discord-signup" }, existing);
		writeSeasonEventFirebasePayload_(buildSeasonEventParticipantPath_(eventId, participant.discordId), "PUT", participant);
		addSeasonEventParticipantTagIndexes_(eventId, participant, nowIso);
		writeSeasonEventFirebasePayload_(buildSeasonEventByIdPath_(eventId), "PATCH", { updatedAt: nowIso });
		writeSeasonEventAuditEntry_(eventId, {
			action: "participant-signed-up",
			eventId: eventId,
			discordId: participant.discordId,
			playerTags: tags,
			createdAt: nowIso,
			source: payload.source || { type: "discord-signup" },
			details: {
				accountCount: participant.accounts.length,
			},
		});
		const updatedParticipantsByDiscordId = Object.assign({}, participantsByDiscordId);
		updatedParticipantsByDiscordId[participant.discordId] = participant;
		const updatedEvent = Object.assign({}, event, {
			updatedAt: nowIso,
			participantsByDiscordId: updatedParticipantsByDiscordId,
		});
		publishCloudflareSeasonEventsAfterMutation_("discord-season-event-signup");
		return buildSeasonEventStatusResponse_("signed-up", {
			event: summarizeSeasonEvent_(updatedEvent),
			participant: participant,
		});
	});
}

// Public participant account update callable.
function updateSeasonEventParticipantAccounts(payloadRaw, botSecret) {
	assertDiscordBotApiSecret_(botSecret);
	const payload = payloadRaw && typeof payloadRaw === "object" ? payloadRaw : {};
	const eventId = sanitizeSeasonEventText_(payload.eventId, 180);
	if (!eventId) throw new Error("Event ID is required.");
	const discordUser = sanitizeSeasonEventDiscordUser_(payload.discordUser);
	const nowIso = new Date().toISOString();
	const eventBeforeLock = readSeasonEventById_(eventId);
	if (!eventBeforeLock) return buildSeasonEventStatusResponse_("event-not-found", { event: null });

	const activeSnapshot = readActiveRosterSnapshot_();
	const rosterData = activeSnapshot && activeSnapshot.rosterData ? activeSnapshot.rosterData : {};
	const linkedAccounts = findLinkedAccountsForDiscordUser_(rosterData, discordUser);
	const selected = selectSeasonEventAccountsForDiscordUser_(eventBeforeLock, linkedAccounts, payload.playerTags);
	if (!selected.ok) {
		return buildSeasonEventStatusResponse_(selected.status, {
			event: summarizeSeasonEvent_(eventBeforeLock),
			linkedAccounts: selected.linkedAccounts || linkedAccounts,
			playerTags: selected.playerTags || [],
			maxAccounts: selected.maxAccounts || getSeasonEventMaxAccounts_(eventBeforeLock),
		});
	}

	return withSeasonEventParticipantWriteLock_(function () {
		const event = readSeasonEventById_(eventId);
		if (!event) return buildSeasonEventStatusResponse_("event-not-found", { event: null });
		const participantsByDiscordId = event.participantsByDiscordId && typeof event.participantsByDiscordId === "object" ? event.participantsByDiscordId : {};
		const existingRaw = participantsByDiscordId[discordUser.id] && typeof participantsByDiscordId[discordUser.id] === "object" ? participantsByDiscordId[discordUser.id] : null;
		const existing = existingRaw ? sanitizeSeasonEventParticipant_(existingRaw) : null;
		if (!existing || existing.status !== "signed_up") {
			return buildSeasonEventStatusResponse_("participant-not-active", {
				event: summarizeSeasonEvent_(event),
				participant: existing,
			});
		}

		const tags = selected.accounts.map((account) => normalizeTag_(account && account.tag)).filter((tag) => tag);
		const assigned = findSeasonEventTagAssignedToOther_(event, tags, discordUser.id);
		if (assigned) {
			return buildSeasonEventStatusResponse_("tag-already-assigned", {
				event: summarizeSeasonEvent_(event),
				tag: assigned.tag,
				discordId: assigned.discordId,
			});
		}

		removeSeasonEventParticipantTagIndexes_(eventId, existing);
		const participant = buildSeasonEventParticipantPayload_(discordUser, selected.accounts, nowIso, payload.source || { type: "discord-account-update" }, existing);
		writeSeasonEventFirebasePayload_(buildSeasonEventParticipantPath_(eventId, participant.discordId), "PUT", participant);
		addSeasonEventParticipantTagIndexes_(eventId, participant, nowIso);
		writeSeasonEventFirebasePayload_(buildSeasonEventByIdPath_(eventId), "PATCH", { updatedAt: nowIso });
		writeSeasonEventAuditEntry_(eventId, {
			action: "participant-accounts-updated",
			eventId: eventId,
			discordId: participant.discordId,
			playerTags: tags,
			createdAt: nowIso,
			source: payload.source || { type: "discord-account-update" },
			details: {
				previousPlayerTags: existing.accounts.map((account) => normalizeTag_(account && account.tag)).filter((tag) => tag),
				accountCount: participant.accounts.length,
			},
		});
		const updatedParticipantsByDiscordId = Object.assign({}, participantsByDiscordId);
		updatedParticipantsByDiscordId[participant.discordId] = participant;
		const updatedEvent = Object.assign({}, event, {
			updatedAt: nowIso,
			participantsByDiscordId: updatedParticipantsByDiscordId,
		});
		publishCloudflareSeasonEventsAfterMutation_("discord-season-event-account-update");
		return buildSeasonEventStatusResponse_("updated", {
			event: summarizeSeasonEvent_(updatedEvent),
			participant: participant,
		});
	});
}

// Public cancellation callable.
function cancelSeasonEventSignup(payloadRaw, botSecret) {
	assertDiscordBotApiSecret_(botSecret);
	const payload = payloadRaw && typeof payloadRaw === "object" ? payloadRaw : {};
	const eventId = sanitizeSeasonEventText_(payload.eventId, 180);
	if (!eventId) throw new Error("Event ID is required.");
	const discordUser = sanitizeSeasonEventDiscordUser_(payload.discordUser);
	const nowIso = new Date().toISOString();

	return withSeasonEventParticipantWriteLock_(function () {
		const event = readSeasonEventById_(eventId);
		if (!event) return buildSeasonEventStatusResponse_("event-not-found", { event: null });
		const participantsByDiscordId = event.participantsByDiscordId && typeof event.participantsByDiscordId === "object" ? event.participantsByDiscordId : {};
		const existingRaw = participantsByDiscordId[discordUser.id] && typeof participantsByDiscordId[discordUser.id] === "object" ? participantsByDiscordId[discordUser.id] : null;
		const existing = existingRaw ? sanitizeSeasonEventParticipant_(existingRaw) : null;
		if (!existing) return buildSeasonEventStatusResponse_("not-signed-up", { event: summarizeSeasonEvent_(event), participant: null });

		removeSeasonEventParticipantTagIndexes_(eventId, existing);
		const participant = Object.assign({}, existing, {
			discordUsername: discordUser.username || existing.discordUsername,
			discordGlobalName: discordUser.globalName || existing.discordGlobalName,
			discordDisplayName: discordUser.displayName || existing.discordDisplayName,
			status: "cancelled",
			updatedAt: nowIso,
			cancelledAt: existing.cancelledAt || nowIso,
			source: sanitizeSeasonEventSource_(payload.source || { type: "discord-cancel" }),
		});
		writeSeasonEventFirebasePayload_(buildSeasonEventParticipantPath_(eventId, participant.discordId), "PUT", participant);
		writeSeasonEventFirebasePayload_(buildSeasonEventByIdPath_(eventId), "PATCH", { updatedAt: nowIso });
		writeSeasonEventAuditEntry_(eventId, {
			action: "participant-cancelled",
			eventId: eventId,
			discordId: participant.discordId,
			playerTags: existing.accounts.map((account) => normalizeTag_(account && account.tag)).filter((tag) => tag),
			createdAt: nowIso,
			source: payload.source || { type: "discord-cancel" },
			details: {},
		});
		const updatedParticipantsByDiscordId = Object.assign({}, participantsByDiscordId);
		updatedParticipantsByDiscordId[participant.discordId] = participant;
		const updatedEvent = Object.assign({}, event, {
			updatedAt: nowIso,
			participantsByDiscordId: updatedParticipantsByDiscordId,
		});
		publishCloudflareSeasonEventsAfterMutation_("discord-season-event-cancel");
		return buildSeasonEventStatusResponse_(existing.status === "cancelled" ? "already-cancelled" : "cancelled", {
			event: summarizeSeasonEvent_(updatedEvent),
			participant: participant,
		});
	});
}

// Normalize leaderboard limit.
function normalizeSeasonEventLeaderboardLimit_(limitRaw) {
	const limit = toNonNegativeInt_(limitRaw);
	if (!limit) return 100;
	return Math.max(1, Math.min(500, limit));
}

// Build normalized player metrics map by tag.
function buildSeasonEventPlayerMetricsByTag_(rosterDataRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const store = rosterData.playerMetrics && typeof rosterData.playerMetrics === "object" ? rosterData.playerMetrics : {};
	const byTagRaw = store.byTag && typeof store.byTag === "object" ? store.byTag : {};
	const out = {};
	const keys = Object.keys(byTagRaw);
	for (let i = 0; i < keys.length; i++) {
		const tag = normalizeTag_(keys[i]);
		if (!tag) continue;
		const entry = byTagRaw[keys[i]] && typeof byTagRaw[keys[i]] === "object" ? byTagRaw[keys[i]] : null;
		if (entry) out[tag] = entry;
	}
	return out;
}

function buildSeasonEventPlayerMetricsByTagWithDonationRefresh_(eventRaw, rosterDataRaw) {
	const byTag = buildSeasonEventPlayerMetricsByTag_(rosterDataRaw);
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
	if (normalizeSeasonEventType_(event.type) !== "donation") return byTag;
	const seasonId = sanitizeDonationCycleKey_(event.seasonId);
	if (!seasonId || typeof readDonationRefreshOverlayBySeason_ !== "function" || typeof mergeDonationRefreshOverlayIntoPlayerMetricsByTag_ !== "function") {
		return byTag;
	}
	try {
		const overlay = readDonationRefreshOverlayBySeason_(seasonId);
		return mergeDonationRefreshOverlayIntoPlayerMetricsByTag_(byTag, overlay && overlay.byTag, seasonId);
	} catch (err) {
		Logger.log("Season event donation overlay unavailable for %s: %s", seasonId, errorMessage_(err));
		return byTag;
	}
}

// Return a preferred display label for a metrics entry or signup account.
function getSeasonEventAccountDisplayName_(metricsEntryRaw, accountRaw) {
	const metricsEntry = metricsEntryRaw && typeof metricsEntryRaw === "object" ? metricsEntryRaw : {};
	const account = accountRaw && typeof accountRaw === "object" ? accountRaw : {};
	const identity = metricsEntry.identity && typeof metricsEntry.identity === "object" ? metricsEntry.identity : {};
	const latest = metricsEntry.latestSnapshot && typeof metricsEntry.latestSnapshot === "object" ? metricsEntry.latestSnapshot : {};
	return sanitizeSeasonEventText_(identity.name || latest.name || account.name, 120);
}

// Return preferred league name for a metrics entry or signup account.
function getSeasonEventAccountLeagueName_(metricsEntryRaw, accountRaw) {
	const metricsEntry = metricsEntryRaw && typeof metricsEntryRaw === "object" ? metricsEntryRaw : {};
	const account = accountRaw && typeof accountRaw === "object" ? accountRaw : {};
	const latest = metricsEntry.latestSnapshot && typeof metricsEntry.latestSnapshot === "object" ? metricsEntry.latestSnapshot : {};
	const leagueName =
		(latest.league && typeof latest.league === "object" && latest.league.name) ||
		(latest.leagueTier && typeof latest.leagueTier === "object" && latest.leagueTier.name) ||
		account.leagueName ||
		"";
	return sanitizeSeasonEventText_(leagueName, 120);
}

// Return preferred TH value for a metrics entry or signup account.
function getSeasonEventAccountTownHallLevel_(metricsEntryRaw, accountRaw) {
	const metricsEntry = metricsEntryRaw && typeof metricsEntryRaw === "object" ? metricsEntryRaw : {};
	const account = accountRaw && typeof accountRaw === "object" ? accountRaw : {};
	const latest = metricsEntry.latestSnapshot && typeof metricsEntry.latestSnapshot === "object" ? metricsEntry.latestSnapshot : {};
	return toNonNegativeInt_(latest.townHallLevel != null ? latest.townHallLevel : latest.th != null ? latest.th : account.townHallLevel);
}

// Resolve event scoring window.
function getSeasonEventScoringWindow_(eventRaw, nowIsoRaw) {
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
	const nowMs = parseIsoToMs_(nowIsoRaw) || Date.now();
	const startsMs = parseIsoToMs_(event.startsAt);
	const endsMs = parseIsoToMs_(event.endsAt);
	const effectiveEndMs = endsMs > 0 ? Math.min(nowMs, endsMs) : nowMs;
	return {
		startsMs: startsMs,
		endsMs: endsMs,
		nowMs: nowMs,
		effectiveEndMs: effectiveEndMs,
	};
}

// Add a unique warning string.
function addSeasonEventWarning_(warnings, warningRaw) {
	const warning = sanitizeSeasonEventText_(warningRaw, 80);
	if (!warning) return;
	for (let i = 0; i < warnings.length; i++) {
		if (warnings[i] === warning) return;
	}
	warnings.push(warning);
}

// Normalize league text for rank parsing.
function normalizeSeasonEventLeagueText_(valueRaw) {
	const raw = String(valueRaw == null ? "" : valueRaw).trim().toLowerCase();
	if (!raw) return "";
	const normalized = typeof raw.normalize === "function" ? raw.normalize("NFKD") : raw;
	return normalized
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

// Normalize compact league text for rank parsing.
function normalizeSeasonEventLeagueCompact_(valueRaw) {
	const raw = String(valueRaw == null ? "" : valueRaw).trim().toLowerCase();
	if (!raw) return "";
	const normalized = typeof raw.normalize === "function" ? raw.normalize("NFKD") : raw;
	return normalized.replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
}

// Return a display name from a league-like value.
function getSeasonEventLeagueDisplayName_(valueRaw) {
	if (typeof valueRaw === "string") return sanitizeSeasonEventText_(valueRaw, 120);
	const value = valueRaw && typeof valueRaw === "object" ? valueRaw : null;
	if (!value) return "";
	const candidates = [
		value.name,
		value.leagueName,
		value.displayName,
		value.tierName,
		value.label,
		value.value,
	];
	for (let i = 0; i < candidates.length; i++) {
		const text = sanitizeSeasonEventText_(candidates[i], 120);
		if (text) return text;
	}
	return "";
}

// Return league family by display text.
function getSeasonEventLeagueFamilyByName_(leagueNameRaw) {
	const text = normalizeSeasonEventLeagueText_(leagueNameRaw);
	const compact = normalizeSeasonEventLeagueCompact_(leagueNameRaw);
	if (!text && !compact) return "";
	const hasWord = (word) => new RegExp("(^|\\s)" + String(word) + "s?(\\s|$)").test(text);
	const hasCompact = (fragment) => compact.indexOf(String(fragment)) >= 0;
	if (hasWord("legend") || hasCompact("legend")) return "legend";
	if (hasWord("electro") || hasCompact("electro")) return "electro";
	if (hasWord("dragon") || hasCompact("dragon")) return "dragon";
	if (hasWord("titan") || hasCompact("titan")) return "titan";
	if (hasWord("pekka") || hasCompact("pekka")) return "pekka";
	if (hasWord("golem") || hasCompact("golem")) return "golem";
	if (hasWord("witch") || hasCompact("witch")) return "witch";
	if (hasWord("valkyrie") || hasCompact("valkyrie")) return "valkyrie";
	if (hasWord("wizard") || hasCompact("wizard")) return "wizard";
	if (hasWord("archer") || hasCompact("archer")) return "archer";
	if (hasWord("barbarian") || hasCompact("barbarian")) return "barbarian";
	if (hasWord("skeleton") || hasCompact("skeleton")) return "skeleton";
	if (hasWord("unranked") || hasCompact("unranked")) return "unranked";
	return "";
}

// Parse a roman league division value.
function parseSeasonEventLeagueRomanTier_(leagueNameRaw) {
	const text = normalizeSeasonEventLeagueText_(leagueNameRaw);
	const matches = text.match(/\b(i|ii|iii)\b/g);
	if (!matches || !matches.length) return 0;
	const value = matches[matches.length - 1];
	if (value === "i") return 1;
	if (value === "ii") return 2;
	if (value === "iii") return 3;
	return 0;
}

// Parse numeric league tier value.
function parseSeasonEventLeagueTierNumber_(leagueNameRaw) {
	const text = normalizeSeasonEventLeagueText_(leagueNameRaw);
	const compact = normalizeSeasonEventLeagueCompact_(leagueNameRaw);
	const matches = text.match(/\b(\d{1,2})\b/g);
	if (matches && matches.length) {
		const last = Number(matches[matches.length - 1]);
		if (isFinite(last)) return Math.floor(last);
	}
	const compactMatch = compact.match(/(\d{1,2})(?!.*\d)/);
	if (!compactMatch) return 0;
	const value = Number(compactMatch[1]);
	return isFinite(value) ? Math.floor(value) : 0;
}

// Return the human label for a Legend tier value.
function formatSeasonEventLegendTierLabel_(tierValueRaw) {
	const tierValue = toNonNegativeInt_(tierValueRaw);
	if (tierValue === 36) return "Legends I";
	if (tierValue === 35) return "Legends II";
	if (tierValue === 34) return "Legends III";
	return "Legends";
}

// Resolve the Clash API's numeric league tier suffix into this app's league family.
function resolveSeasonEventLeagueTierFromRankValue_(tierValueRaw) {
	const tierValue = toNonNegativeInt_(tierValueRaw);
	let family = "";
	let labelPrefix = "";
	if (tierValue >= 34 && tierValue <= 36) {
		return { family: "legend", tierValue: tierValue, label: formatSeasonEventLegendTierLabel_(tierValue) };
	}
	if (tierValue >= 31 && tierValue <= 33) {
		family = "electro";
		labelPrefix = "Electro";
	} else if (tierValue >= 28 && tierValue <= 30) {
		family = "dragon";
		labelPrefix = "Dragon";
	} else if (tierValue >= 25 && tierValue <= 27) {
		family = "titan";
		labelPrefix = "Titan";
	} else if (tierValue >= 22 && tierValue <= 24) {
		family = "pekka";
		labelPrefix = "P.E.K.K.A";
	} else if (tierValue >= 19 && tierValue <= 21) {
		family = "golem";
		labelPrefix = "Golem";
	} else if (tierValue >= 16 && tierValue <= 18) {
		family = "witch";
		labelPrefix = "Witch";
	} else if (tierValue >= 13 && tierValue <= 15) {
		family = "valkyrie";
		labelPrefix = "Valkyrie";
	} else if (tierValue >= 10 && tierValue <= 12) {
		family = "wizard";
		labelPrefix = "Wizard";
	} else if (tierValue >= 7 && tierValue <= 9) {
		family = "archer";
		labelPrefix = "Archer";
	} else if (tierValue >= 4 && tierValue <= 6) {
		family = "barbarian";
		labelPrefix = "Barbarian";
	} else if (tierValue >= 1 && tierValue <= 3) {
		family = "skeleton";
		labelPrefix = "Skeleton";
	}
	if (!family) return null;
	return { family: family, tierValue: tierValue, label: labelPrefix + " " + tierValue };
}

// Resolve known Clash API league ids into this app's rank tiers.
function resolveSeasonEventLeagueTierFromOfficialId_(leagueIdRaw) {
	const leagueId = toNonNegativeInt_(leagueIdRaw);
	const suffixTier = leagueId % 100;
	return resolveSeasonEventLeagueTierFromRankValue_(suffixTier);
}

// Resolve a family-specific roman division into the app's rank tiers.
function resolveSeasonEventLeagueTierFromRomanDivision_(familyRaw, divisionRaw) {
	const family = sanitizeSeasonEventText_(familyRaw, 40).toLowerCase();
	const division = toNonNegativeInt_(divisionRaw);
	if (family === "legend" && division >= 1 && division <= 3) {
		return 37 - division;
	}
	if (family === "titan" && division >= 1 && division <= 3) {
		return 28 - division;
	}
	return 0;
}

// Build league rank key.
function buildSeasonEventLeagueRankKey_(familyRaw, tierRaw) {
	const family = sanitizeSeasonEventText_(familyRaw, 40).toLowerCase();
	if (!family) return "";
	if (family === "unranked") return family;
	const tier = toNonNegativeInt_(tierRaw);
	if (tier < 1) return "";
	return family + ":" + tier;
}

// Parse one configured league order label.
function parseSeasonEventLeagueOrderEntryLabel_(labelRaw) {
	const label = sanitizeSeasonEventText_(labelRaw, 120);
	if (!label) return null;
	const family = getSeasonEventLeagueFamilyByName_(label);
	if (!family) return null;
	if (family === "unranked") return { family: "unranked", tierValue: 0, label: label };
	let tierValue = parseSeasonEventLeagueTierNumber_(label) || resolveSeasonEventLeagueTierFromRomanDivision_(family, parseSeasonEventLeagueRomanTier_(label));
	if (family === "legend" && tierValue < 1) tierValue = 34;
	if (tierValue < 1) return null;
	return { family: family, tierValue: tierValue, label: label };
}

// Return league order config.
function getSeasonEventLeagueOrderConfig_() {
	const rankByKey = {};
	const labelByKey = {};
	const validTiersByFamily = {};
	const orderedLabels = Array.isArray(SEASON_EVENT_EXACT_LEAGUE_ORDER) ? SEASON_EVENT_EXACT_LEAGUE_ORDER : [];
	for (let i = 0; i < orderedLabels.length; i++) {
		const parsed = parseSeasonEventLeagueOrderEntryLabel_(orderedLabels[i]);
		if (!parsed) continue;
		const key = buildSeasonEventLeagueRankKey_(parsed.family, parsed.tierValue);
		if (!key) continue;
		rankByKey[key] = i;
		labelByKey[key] = parsed.label;
		if (parsed.family !== "unranked") {
			if (!validTiersByFamily[parsed.family]) validTiersByFamily[parsed.family] = {};
			validTiersByFamily[parsed.family][String(parsed.tierValue)] = true;
		}
	}
	return {
		rankByKey: rankByKey,
		labelByKey: labelByKey,
		validTiersByFamily: validTiersByFamily,
		fallbackRank: Math.max(0, orderedLabels.length - 1),
	};
}

// Read a structured tier from a league-like value.
function readSeasonEventStructuredLeagueTierValue_(leagueRaw, familyRaw, nameRaw) {
	const league = leagueRaw && typeof leagueRaw === "object" ? leagueRaw : null;
	const official = league ? resolveSeasonEventLeagueTierFromOfficialId_(league.id) : null;
	const family = sanitizeSeasonEventText_(familyRaw, 40).toLowerCase();
	if (official && (!family || official.family === family)) return official.tierValue;
	const name = sanitizeSeasonEventText_(nameRaw, 120);
	const romanTier = resolveSeasonEventLeagueTierFromRomanDivision_(family, parseSeasonEventLeagueRomanTier_(name));
	if (romanTier > 0) return romanTier;
	const keys = ["tier", "tierNumber", "tierValue", "leagueTier", "leagueTierNumber", "rank", "rankNumber", "number", "index", "level"];
	if (league) {
		for (let i = 0; i < keys.length; i++) {
			const value = Number(league[keys[i]]);
			if (!isFinite(value)) continue;
			const tier = Math.floor(value);
			if (tier >= 1 && tier <= 36) return tier;
		}
	}
	return 0;
}

// Resolve a league descriptor from a source value.
function readSeasonEventLeagueDescriptorFromSource_(leagueRaw, sourceLabelRaw) {
	const league = leagueRaw && typeof leagueRaw === "object" ? leagueRaw : null;
	if (!league && typeof leagueRaw !== "string") return null;
	const official = league ? resolveSeasonEventLeagueTierFromOfficialId_(league.id) : null;
	const name = getSeasonEventLeagueDisplayName_(leagueRaw) || (official && official.label) || "";
	const nameFamily = getSeasonEventLeagueFamilyByName_(name);
	const useOfficial = !!(official && (!nameFamily || official.family === nameFamily));
	const family = (useOfficial && official.family) || nameFamily || (official && official.family) || "";
	const tierValue = (useOfficial && official.tierValue) || readSeasonEventStructuredLeagueTierValue_(league, family, name);
	if (!name && !family && tierValue < 1) return null;
	return {
		source: sanitizeSeasonEventText_(sourceLabelRaw, 40),
		name: name,
		family: family,
		tierValue: tierValue,
	};
}

// Resolve the preferred league descriptor from a trophy point or snapshot.
function resolveSeasonEventLeagueDescriptorFromSnapshot_(snapshotRaw) {
	const snapshot = snapshotRaw && typeof snapshotRaw === "object" ? snapshotRaw : {};
	const fromLeagueTier = readSeasonEventLeagueDescriptorFromSource_(snapshot.leagueTier, "leagueTier");
	const fromLeague = readSeasonEventLeagueDescriptorFromSource_(snapshot.league, "league");
	const fallback = readSeasonEventLeagueDescriptorFromSource_(snapshot.leagueName || snapshot.leagueLabel || snapshot.leagueTierName, "string");
	const name = sanitizeSeasonEventText_((fromLeagueTier && fromLeagueTier.name) || (fromLeague && fromLeague.name) || (fallback && fallback.name), 120);
	const family = sanitizeSeasonEventText_((fromLeagueTier && fromLeagueTier.family) || (fromLeague && fromLeague.family) || (fallback && fallback.family), 40).toLowerCase() || getSeasonEventLeagueFamilyByName_(name);
	let tierValue = toNonNegativeInt_((fromLeagueTier && fromLeagueTier.tierValue) || (fromLeague && fromLeague.tierValue) || (fallback && fallback.tierValue));
	if (!tierValue && family !== "unranked") {
		tierValue = parseSeasonEventLeagueTierNumber_(name) || resolveSeasonEventLeagueTierFromRomanDivision_(family, parseSeasonEventLeagueRomanTier_(name));
	}
	if (!tierValue && family === "legend") tierValue = 34;
	return {
		source: (fromLeagueTier && fromLeagueTier.source) || (fromLeague && fromLeague.source) || (fallback && fallback.source) || "",
		name: name,
		family: family,
		tierValue: tierValue,
	};
}

// Parse league descriptor into a sortable rank key.
function parseSeasonEventLeagueSortKey_(leagueInputRaw) {
	const config = getSeasonEventLeagueOrderConfig_();
	const leagueInput = leagueInputRaw && typeof leagueInputRaw === "object" ? leagueInputRaw : { name: leagueInputRaw };
	const leagueName = sanitizeSeasonEventText_(leagueInput.name, 120);
	let family = sanitizeSeasonEventText_(leagueInput.family, 40).toLowerCase();
	let tierValue = toNonNegativeInt_(leagueInput.tierValue);
	if (!family) family = getSeasonEventLeagueFamilyByName_(leagueName);
	if (!tierValue && family !== "unranked") {
		tierValue = parseSeasonEventLeagueTierNumber_(leagueName) || resolveSeasonEventLeagueTierFromRomanDivision_(family, parseSeasonEventLeagueRomanTier_(leagueName));
	}
	if (family === "legend") {
		if (!tierValue) tierValue = 34;
		const key = buildSeasonEventLeagueRankKey_("legend", tierValue);
		return {
			rank: Object.prototype.hasOwnProperty.call(config.rankByKey, key) ? config.rankByKey[key] : 0,
			tierLabel: config.labelByKey[key] || leagueName || formatSeasonEventLegendTierLabel_(tierValue),
			tierValue: tierValue,
			family: "legend",
			parsed: true,
		};
	}
	if (family === "unranked" || (!leagueName && !family && tierValue < 1)) {
		const key = "unranked";
		return {
			rank: Object.prototype.hasOwnProperty.call(config.rankByKey, key) ? config.rankByKey[key] : config.fallbackRank,
			tierLabel: config.labelByKey[key] || "Unranked",
			tierValue: 0,
			family: "unranked",
			parsed: family === "unranked",
		};
	}
	const validTiers = family && config.validTiersByFamily[family] ? config.validTiersByFamily[family] : null;
	const hasKnownTier = !!(validTiers && validTiers[String(tierValue)]);
	if (hasKnownTier) {
		const key = buildSeasonEventLeagueRankKey_(family, tierValue);
		return {
			rank: config.rankByKey[key],
			tierLabel: config.labelByKey[key] || leagueName || (family + " " + tierValue),
			tierValue: tierValue,
			family: family,
			parsed: true,
		};
	}
	return {
		rank: SEASON_EVENT_LEAGUE_FALLBACK_RANK,
		tierLabel: leagueName || "Unranked",
		tierValue: tierValue || 0,
		family: family || "",
		parsed: false,
	};
}

// Return whether left is a better push rank point than right.
function isBetterSeasonEventPushRankPoint_(leftRaw, rightRaw) {
	const left = leftRaw && typeof leftRaw === "object" ? leftRaw : null;
	const right = rightRaw && typeof rightRaw === "object" ? rightRaw : null;
	if (!left) return false;
	if (!right) return true;
	const leftSort = left.leagueSort && typeof left.leagueSort === "object" ? left.leagueSort : {};
	const rightSort = right.leagueSort && typeof right.leagueSort === "object" ? right.leagueSort : {};
	const leftRank = isFinite(Number(leftSort.rank)) ? Number(leftSort.rank) : SEASON_EVENT_LEAGUE_FALLBACK_RANK;
	const rightRank = isFinite(Number(rightSort.rank)) ? Number(rightSort.rank) : SEASON_EVENT_LEAGUE_FALLBACK_RANK;
	if (leftRank !== rightRank) return leftRank < rightRank;
	const leftTrophies = toNonNegativeInt_(left.trophies);
	const rightTrophies = toNonNegativeInt_(right.trophies);
	if (leftTrophies !== rightTrophies) return leftTrophies > rightTrophies;
	return Number(left.capturedMs) > Number(right.capturedMs);
}

// Format a push event score label.
function buildSeasonEventPushScoreLabel_(trophiesRaw, leagueSortRaw, leagueNameRaw) {
	const trophies = toNonNegativeInt_(trophiesRaw);
	const leagueSort = leagueSortRaw && typeof leagueSortRaw === "object" ? leagueSortRaw : {};
	if (trophies <= 0 && !sanitizeSeasonEventText_(leagueNameRaw, 120)) return "0 trophies";
	const leagueLabel = sanitizeSeasonEventText_(leagueNameRaw || leagueSort.tierLabel, 120);
	const trophyLabel = String(trophies) + " trophies";
	return leagueLabel ? leagueLabel + " - " + trophyLabel : trophyLabel;
}

// Collect trophy values for push scoring.
function collectPushEventTrophyPoints_(metricsEntryRaw, eventRaw, nowIsoRaw) {
	const metricsEntry = metricsEntryRaw && typeof metricsEntryRaw === "object" ? metricsEntryRaw : {};
	const points = [];
	const latest = metricsEntry.latestSnapshot && typeof metricsEntry.latestSnapshot === "object" ? metricsEntry.latestSnapshot : null;
	const latestLeagueDescriptor = latest ? resolveSeasonEventLeagueDescriptorFromSnapshot_(latest) : null;
	const pushPoint = (pointRaw, sourceRaw) => {
		const point = pointRaw && typeof pointRaw === "object" ? pointRaw : {};
		const trophies = toNonNegativeInt_(point.trophies);
		let capturedMs = parseIsoToMs_(point.capturedAt);
		if (capturedMs <= 0) {
			const dayKey = sanitizeMetricsDayKey_(point.dayKey);
			if (dayKey) {
				const dayMs = new Date(dayKey + "T00:00:00.000Z").getTime();
				if (isFinite(dayMs)) capturedMs = dayMs;
			}
		}
		if (capturedMs <= 0) return;
		const leagueDescriptor = resolveSeasonEventLeagueDescriptorFromSnapshot_(point);
		if (!leagueDescriptor.name && latestLeagueDescriptor && latestLeagueDescriptor.name) {
			leagueDescriptor.name = latestLeagueDescriptor.name;
			leagueDescriptor.family = latestLeagueDescriptor.family;
			leagueDescriptor.tierValue = latestLeagueDescriptor.tierValue;
		}
		const leagueSort = parseSeasonEventLeagueSortKey_(leagueDescriptor);
		points.push({
			capturedMs: capturedMs,
			capturedAt: new Date(capturedMs).toISOString(),
			trophies: trophies,
			leagueName: sanitizeSeasonEventText_(leagueDescriptor.name, 120),
			leagueSort: leagueSort,
			source: sanitizeSeasonEventText_(sourceRaw, 40),
		});
	};

	const history = Array.isArray(metricsEntry.trophyHistoryDaily) ? metricsEntry.trophyHistoryDaily : [];
	for (let i = 0; i < history.length; i++) pushPoint(history[i], "trophyHistoryDaily");
	if (latest && Object.prototype.hasOwnProperty.call(latest, "trophies")) pushPoint(latest, "latestSnapshot");

	points.sort((left, right) => {
		if (left.capturedMs !== right.capturedMs) return left.capturedMs - right.capturedMs;
		if (left.trophies !== right.trophies) return left.trophies - right.trophies;
		return left.source < right.source ? -1 : left.source > right.source ? 1 : 0;
	});
	return points;
}

// Calculate one account's push score.
function calculatePushEventAccountScore_(metricsEntryRaw, eventRaw, nowIsoRaw, accountRaw) {
	const metricsEntry = metricsEntryRaw && typeof metricsEntryRaw === "object" ? metricsEntryRaw : null;
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
	const account = accountRaw && typeof accountRaw === "object" ? accountRaw : {};
	const warnings = [];
	if (!metricsEntry) {
		const fallbackLeagueSort = parseSeasonEventLeagueSortKey_(account.leagueName);
		return {
			score: 0,
			startValue: 0,
			currentValue: 0,
			delta: 0,
			coverage: "no-history",
			warnings: ["missing-player-metrics"],
			currentTrophies: 0,
			bestTrophies: 0,
			currentLeagueName: sanitizeSeasonEventText_(account.leagueName, 120),
			currentLeagueSort: fallbackLeagueSort,
			currentCapturedAt: "",
			bestLeagueName: sanitizeSeasonEventText_(account.leagueName, 120),
			bestLeagueSort: fallbackLeagueSort,
			bestCapturedAt: "",
			hasPushRank: false,
		};
	}

	const window = getSeasonEventScoringWindow_(event, nowIsoRaw);
	const points = collectPushEventTrophyPoints_(metricsEntry, event, nowIsoRaw);
	if (!points.length || window.startsMs <= 0 || window.effectiveEndMs <= 0 || window.effectiveEndMs < window.startsMs) {
		const latest = metricsEntry.latestSnapshot && typeof metricsEntry.latestSnapshot === "object" ? metricsEntry.latestSnapshot : {};
		const fallbackDescriptor = resolveSeasonEventLeagueDescriptorFromSnapshot_(latest);
		if (!fallbackDescriptor.name && account.leagueName) fallbackDescriptor.name = sanitizeSeasonEventText_(account.leagueName, 120);
		const fallbackLeagueSort = parseSeasonEventLeagueSortKey_(fallbackDescriptor);
		return {
			score: 0,
			startValue: 0,
			currentValue: 0,
			delta: 0,
			coverage: "no-history",
			warnings: ["missing-trophy-history"],
			currentTrophies: 0,
			bestTrophies: 0,
			currentLeagueName: sanitizeSeasonEventText_(fallbackDescriptor.name, 120),
			currentLeagueSort: fallbackLeagueSort,
			currentCapturedAt: "",
			bestLeagueName: sanitizeSeasonEventText_(fallbackDescriptor.name, 120),
			bestLeagueSort: fallbackLeagueSort,
			bestCapturedAt: "",
			hasPushRank: false,
		};
	}

	// Push standings use the latest captured point in the event window, not the season peak.
	let currentPoint = null;
	for (let i = 0; i < points.length; i++) {
		const point = points[i];
		if (point.capturedMs < window.startsMs || point.capturedMs > window.effectiveEndMs) continue;
		if (
			!currentPoint ||
			point.capturedMs > currentPoint.capturedMs ||
			(point.capturedMs === currentPoint.capturedMs && isBetterSeasonEventPushRankPoint_(point, currentPoint))
		) {
			currentPoint = point;
		}
	}

	if (!currentPoint) {
		addSeasonEventWarning_(warnings, "missing-current");
		return {
			score: 0,
			startValue: 0,
			currentValue: 0,
			delta: 0,
			coverage: "missing-current",
			warnings: warnings,
			currentTrophies: 0,
			bestTrophies: 0,
			currentLeagueName: "",
			currentLeagueSort: parseSeasonEventLeagueSortKey_(""),
			currentCapturedAt: "",
			bestLeagueName: "",
			bestLeagueSort: parseSeasonEventLeagueSortKey_(""),
			bestCapturedAt: "",
			hasPushRank: false,
		};
	}

	return {
		score: currentPoint.trophies,
		startValue: 0,
		currentValue: currentPoint.trophies,
		delta: 0,
		coverage: "full",
		warnings: warnings,
		currentTrophies: currentPoint.trophies,
		bestTrophies: currentPoint.trophies,
		currentLeagueName: sanitizeSeasonEventText_(currentPoint.leagueName, 120),
		currentLeagueSort: currentPoint.leagueSort && typeof currentPoint.leagueSort === "object" ? currentPoint.leagueSort : parseSeasonEventLeagueSortKey_(""),
		currentCapturedAt: currentPoint.capturedAt,
		bestLeagueName: sanitizeSeasonEventText_(currentPoint.leagueName, 120),
		bestLeagueSort: currentPoint.leagueSort && typeof currentPoint.leagueSort === "object" ? currentPoint.leagueSort : parseSeasonEventLeagueSortKey_(""),
		bestCapturedAt: currentPoint.capturedAt,
		hasPushRank: true,
	};
}

// Find a donation cycle ledger for an event.
function findDonationCycleLedgerForSeasonEvent_(metricsEntryRaw, eventRaw) {
	const metricsEntry = metricsEntryRaw && typeof metricsEntryRaw === "object" ? metricsEntryRaw : {};
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
	const donationCycles = metricsEntry.donationCycles && typeof metricsEntry.donationCycles === "object" ? metricsEntry.donationCycles : {};
	const seasonId = sanitizeDonationCycleKey_(event.seasonId);
	if (seasonId && donationCycles[seasonId]) {
		const direct = sanitizeMetricsDonationCycleLedger_(donationCycles[seasonId], seasonId);
		if (direct) return direct;
	}

	const startsAt = sanitizeSeasonEventTimestampOrEmpty_(event.startsAt);
	const endsAt = sanitizeSeasonEventTimestampOrEmpty_(event.endsAt);
	const keys = Object.keys(donationCycles).sort();
	for (let i = 0; i < keys.length; i++) {
		const key = sanitizeDonationCycleKey_(keys[i]);
		if (!key) continue;
		const ledger = sanitizeMetricsDonationCycleLedger_(donationCycles[key], key);
		if (!ledger) continue;
		if (startsAt && endsAt && ledger.startsAt === startsAt && ledger.endsAt === endsAt) return ledger;
	}
	return null;
}

// Calculate one account's donation score.
function calculateDonationEventAccountScore_(metricsEntryRaw, eventRaw, nowIsoRaw) {
	const metricsEntry = metricsEntryRaw && typeof metricsEntryRaw === "object" ? metricsEntryRaw : null;
	if (!metricsEntry) {
		return {
			score: 0,
			startValue: 0,
			currentValue: 0,
			delta: 0,
			coverage: "missing-cycle-ledger",
			warnings: ["missing-player-metrics", "missing-donation-cycle-ledger"],
		};
	}

	const ledger = findDonationCycleLedgerForSeasonEvent_(metricsEntry, eventRaw);
	if (!ledger) {
		return {
			score: 0,
			startValue: 0,
			currentValue: 0,
			delta: 0,
			coverage: "missing-cycle-ledger",
			warnings: ["missing-donation-cycle-ledger"],
		};
	}

	const score = toNonNegativeInt_(ledger.cycleTotalDonations);
	return {
		score: score,
		startValue: 0,
		currentValue: score,
		delta: score,
		coverage: "full",
		warnings: [],
		ledger: ledger,
	};
}

// Build a stable hash for compact CWL aggregate change detection.
function buildSeasonEventStableHash_(valueRaw) {
	const text = JSON.stringify(valueRaw == null ? null : valueRaw);
	if (typeof Utilities !== "undefined" && Utilities && typeof Utilities.computeDigest === "function") {
		const algorithm = Utilities.DigestAlgorithm && Utilities.DigestAlgorithm.SHA_256 ? Utilities.DigestAlgorithm.SHA_256 : "SHA_256";
		const charset = Utilities.Charset && Utilities.Charset.UTF_8 ? Utilities.Charset.UTF_8 : "UTF-8";
		const bytes = Utilities.computeDigest(algorithm, text, charset);
		let out = "";
		for (let i = 0; i < bytes.length; i++) {
			const n = (Number(bytes[i]) + 256) % 256;
			out += (n < 16 ? "0" : "") + n.toString(16);
		}
		return out;
	}
	let hash = 2166136261;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
	}
	return ("00000000" + (hash >>> 0).toString(16)).slice(-8);
}

// Read a compact CWL aggregate.
function readCwlSeasonEventAggregate_(eventIdRaw, kindRaw) {
	const eventId = sanitizeSeasonEventText_(eventIdRaw, 180);
	if (!eventId) return null;
	return decodeSeasonEventFirebasePayload_(firebaseRequestJson_(buildCwlSeasonEventAggregatePath_(eventId, kindRaw), "GET"));
}

// Sanitize compact CWL aggregate.
function sanitizeCwlSeasonEventAggregate_(aggregateRaw) {
	const aggregate = aggregateRaw && typeof aggregateRaw === "object" ? aggregateRaw : {};
	const byTagRaw = aggregate.byTag && typeof aggregate.byTag === "object" ? aggregate.byTag : {};
	const byTag = {};
	const tags = Object.keys(byTagRaw).sort();
	for (let i = 0; i < tags.length; i++) {
		const tag = normalizeTag_(tags[i]);
		if (!tag) continue;
		byTag[tag] = sanitizeCwlStatEntry_(byTagRaw[tags[i]]);
	}
	const warTagsRaw = Array.isArray(aggregate.warTags) ? aggregate.warTags : [];
	const warTags = [];
	const seenWarTags = {};
	for (let i = 0; i < warTagsRaw.length; i++) {
		const warTag = normalizeTag_(warTagsRaw[i]);
		if (!warTag || warTag === "#0" || seenWarTags[warTag]) continue;
		seenWarTags[warTag] = true;
		warTags.push(warTag);
	}
	warTags.sort();
	return {
		eventId: sanitizeSeasonEventText_(aggregate.eventId, 180),
		kind: sanitizeSeasonEventText_(aggregate.kind, 20),
		cwlTrackingState: normalizeCwlTrackingState_(aggregate.cwlTrackingState) || "",
		generatedAt: sanitizeSeasonEventTimestampOrEmpty_(aggregate.generatedAt),
		lastSuccessfulRefreshAt: sanitizeSeasonEventTimestampOrEmpty_(aggregate.lastSuccessfulRefreshAt),
		stale: toBooleanFlag_(aggregate.stale),
		staleSince: sanitizeSeasonEventTimestampOrEmpty_(aggregate.staleSince),
		staleReason: sanitizeSeasonEventText_(aggregate.staleReason, 160),
		hash: sanitizeSeasonEventText_(aggregate.hash, 120),
		scoreSchema: sanitizeSeasonEventText_(aggregate.scoreSchema, 80) || "cwl-offense-stars-defense-stars-v2",
		playerCount: Object.keys(byTag).length,
		warTags: warTags,
		byTag: byTag,
		rankedTags: Array.isArray(aggregate.rankedTags) ? aggregate.rankedTags.map((tag) => normalizeTag_(tag)).filter((tag) => tag) : [],
	};
}

// Return active signed-up CWL accounts, deduped globally by player tag.
function listCwlSeasonEventRegisteredAccounts_(eventRaw) {
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
	const participantsByDiscordId = event.participantsByDiscordId && typeof event.participantsByDiscordId === "object" ? event.participantsByDiscordId : {};
	const ids = Object.keys(participantsByDiscordId).sort();
	const rows = [];
	const seenTags = {};
	for (let i = 0; i < ids.length; i++) {
		const participant = sanitizeSeasonEventParticipant_(participantsByDiscordId[ids[i]]);
		if (!participant.discordId) participant.discordId = sanitizeDiscordIdValue_(ids[i]);
		if (participant.status !== "signed_up") continue;
		const accounts = Array.isArray(participant.accounts) ? participant.accounts : [];
		for (let j = 0; j < accounts.length; j++) {
			const account = sanitizeSeasonEventParticipantAccount_(accounts[j]);
			const tag = normalizeTag_(account && account.tag);
			if (!tag || seenTags[tag]) continue;
			seenTags[tag] = true;
			rows.push({
				participant: participant,
				account: account,
				tag: tag,
			});
		}
	}
	return rows;
}

// Return whether a compact CWL stat entry represents participation.
function hasCwlSeasonEventParticipation_(statsRaw) {
	const stats = sanitizeCwlStatEntry_(statsRaw);
	return (
		stats.resolvedWarDays > 0 ||
		stats.currentWarAttackPending > 0 ||
		stats.attacksMade > 0 ||
		stats.missedAttacks > 0 ||
		stats.defenseAttacksReceived > 0 ||
		stats.attackedDefenseDays > 0 ||
		stats.unattackedDefenseDays > 0
	);
}

// Return whether a CWL stat entry has actual defensive results for ranking.
function hasCwlSeasonEventDefenseResults_(statsRaw) {
	const stats = sanitizeCwlStatEntry_(statsRaw);
	return stats.attackedDefenseDays > 0;
}

// Return the canonical CWL defensive-star tie-break value.
function getCwlSeasonEventDefenseStarsConceded_(statsRaw) {
	const stats = sanitizeCwlStatEntry_(statsRaw);
	return toNonNegativeInt_(stats.defenseStarsConceded != null ? stats.defenseStarsConceded : stats.bestStarsConceded);
}

// Compare CWL leaderboard rows canonically.
function compareCwlSeasonEventLeaderboardRows_(leftRaw, rightRaw) {
	const left = leftRaw && typeof leftRaw === "object" ? leftRaw : {};
	const right = rightRaw && typeof rightRaw === "object" ? rightRaw : {};
	const leftStats = sanitizeCwlStatEntry_(left.cwlStats);
	const rightStats = sanitizeCwlStatEntry_(right.cwlStats);
	const leftParticipated = hasCwlSeasonEventParticipation_(leftStats);
	const rightParticipated = hasCwlSeasonEventParticipation_(rightStats);
	if (leftParticipated !== rightParticipated) return leftParticipated ? -1 : 1;
	if (leftStats.starsTotal !== rightStats.starsTotal) return rightStats.starsTotal - leftStats.starsTotal;
	const leftDefenseStars = getCwlSeasonEventDefenseStarsConceded_(leftStats);
	const rightDefenseStars = getCwlSeasonEventDefenseStarsConceded_(rightStats);
	if (leftDefenseStars !== rightDefenseStars) return leftDefenseStars - rightDefenseStars;
	const leftName = String(left._sortName || "").toLowerCase();
	const rightName = String(right._sortName || "").toLowerCase();
	if (leftName !== rightName) return leftName < rightName ? -1 : 1;
	const leftTag = normalizeTag_(left.tag);
	const rightTag = normalizeTag_(right.tag);
	return leftTag < rightTag ? -1 : leftTag > rightTag ? 1 : 0;
}

// Build CWL score label.
function buildCwlSeasonEventScoreLabel_(statsRaw) {
	const stats = sanitizeCwlStatEntry_(statsRaw);
	return (
		String(stats.starsTotal) +
		" stars, " +
		String(getCwlSeasonEventDefenseStarsConceded_(stats)) +
		" defense stars"
	);
}

// Build a CWL leaderboard from the stored compact aggregate.
function buildCwlSeasonEventLeaderboard_(eventRaw, optionsRaw) {
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : null;
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const nowIso = sanitizeSeasonEventTimestampOrEmpty_(options.now || options.nowIso) || new Date().toISOString();
	const limit = normalizeSeasonEventLeaderboardLimit_(options.limit);
	if (!event) {
		return {
			ok: true,
			status: "event-not-found",
			event: null,
			leaderboard: [],
			generatedAt: nowIso,
		};
	}
	const state = normalizeCwlTrackingState_(event.cwlTrackingState) || "waiting";
	const aggregateKind = state === "completed" ? "final" : "live";
	const aggregate = sanitizeCwlSeasonEventAggregate_(readCwlSeasonEventAggregate_(event.eventId, aggregateKind));
	const registered = listCwlSeasonEventRegisteredAccounts_(event);
	const rows = [];
	for (let i = 0; i < registered.length; i++) {
		const item = registered[i];
		const stats = sanitizeCwlStatEntry_(aggregate.byTag[item.tag]);
		const participant = item.participant;
		const account = item.account;
		const displayName = sanitizeSeasonEventText_(account.name, 120) || participant.discordDisplayName || participant.discordGlobalName || participant.discordUsername || participant.discordId;
		const metrics = deriveCwlMetrics_(stats);
		const row = {
			rank: 0,
			tag: item.tag,
			playerTag: item.tag,
			displayName: displayName,
			discordUsername: participant.discordUsername,
			accounts: [
				Object.assign({}, account, {
					score: stats.starsTotal,
					coverage: hasCwlSeasonEventParticipation_(stats) ? "full" : "no-cwl-participation",
					cwlStats: stats,
				}),
			],
			score: stats.starsTotal,
			scoreLabel: buildCwlSeasonEventScoreLabel_(stats),
			metric: "cwl",
			coverage: hasCwlSeasonEventParticipation_(stats) ? "full" : "no-cwl-participation",
			cwlStats: stats,
			cwlMetrics: metrics,
			_sortName: displayName,
		};
		rows.push(row);
	}
	rows.sort(compareCwlSeasonEventLeaderboardRows_);
	const rankedTags = [];
	const limited = rows.slice(0, limit);
	for (let i = 0; i < limited.length; i++) {
		limited[i].rank = i + 1;
		rankedTags.push(limited[i].tag);
		delete limited[i]._sortName;
	}
	return {
		ok: true,
		event: summarizeSeasonEvent_(event),
		leaderboard: limited,
		generatedAt: nowIso,
		cwlTrackingState: state,
		aggregate: {
			kind: aggregateKind,
			stale: aggregate.stale,
			staleSince: aggregate.staleSince,
			staleReason: aggregate.staleReason,
			lastSuccessfulRefreshAt: aggregate.lastSuccessfulRefreshAt,
			generatedAt: aggregate.generatedAt,
			hash: aggregate.hash,
			playerCount: aggregate.playerCount,
			warCount: aggregate.warTags.length,
			rankedTags: rankedTags,
		},
	};
}

// Combine account coverage values into a participant coverage value.
function combineSeasonEventCoverage_(accountsRaw) {
	const accounts = Array.isArray(accountsRaw) ? accountsRaw : [];
	if (!accounts.length) return "no-history";
	const priority = {
		"missing-cycle-ledger": 5,
		"no-history": 4,
		"missing-current": 3,
		"missing-baseline": 2,
		partial: 1,
		full: 0,
	};
	let bestCoverage = "full";
	let bestPriority = -1;
	for (let i = 0; i < accounts.length; i++) {
		const coverage = sanitizeSeasonEventText_(accounts[i] && accounts[i].coverage, 80) || "no-history";
		const score = Object.prototype.hasOwnProperty.call(priority, coverage) ? priority[coverage] : 1;
		if (score > bestPriority) {
			bestPriority = score;
			bestCoverage = coverage;
		}
	}
	return bestCoverage;
}

// Build score label.
function buildSeasonEventScoreLabel_(eventRaw, scoreRaw, rankRaw) {
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
	const score = Number(scoreRaw) || 0;
	const rank = rankRaw && typeof rankRaw === "object" ? rankRaw : {};
	if (normalizeSeasonEventType_(event.type) === "push") return buildSeasonEventPushScoreLabel_(score, rank.leagueSort, rank.leagueName);
	return String(toNonNegativeInt_(score)) + " donations";
}

// Calculate account breakdown for a leaderboard entry.
function calculateSeasonEventAccountLeaderboardScore_(eventRaw, accountRaw, metricsEntryRaw, nowIsoRaw, includeDebugRaw) {
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
	const account = sanitizeSeasonEventParticipantAccount_(accountRaw);
	const tag = normalizeTag_(account && account.tag);
	const metricsEntry = metricsEntryRaw && typeof metricsEntryRaw === "object" ? metricsEntryRaw : null;
	const eventType = normalizeSeasonEventType_(event.type);
	let score = null;
	if (eventType === "push") score = calculatePushEventAccountScore_(metricsEntry, event, nowIsoRaw, account);
	else if (eventType === "donation") score = calculateDonationEventAccountScore_(metricsEntry, event, nowIsoRaw);
	else throw new Error("Unsupported season event scoring type: " + (eventType || "unknown"));
	const out = {
		tag: tag,
		name: getSeasonEventAccountDisplayName_(metricsEntry, account),
		townHallLevel: getSeasonEventAccountTownHallLevel_(metricsEntry, account),
		leagueName: getSeasonEventAccountLeagueName_(metricsEntry, account),
		startValue: toNonNegativeInt_(score.startValue),
		currentValue: toNonNegativeInt_(score.currentValue),
		delta: Number(score.delta) || 0,
		score: Number(score.score) || 0,
		coverage: score.coverage,
		warnings: Array.isArray(score.warnings) ? score.warnings.slice() : [],
	};
	if (eventType === "push") {
		out.currentTrophies = toNonNegativeInt_(score.currentTrophies);
		out.bestTrophies = toNonNegativeInt_(score.bestTrophies);
		out.currentLeagueName = sanitizeSeasonEventText_(score.currentLeagueName, 120);
		out.currentLeagueRank = isFinite(Number(score.currentLeagueSort && score.currentLeagueSort.rank)) ? Number(score.currentLeagueSort.rank) : SEASON_EVENT_LEAGUE_FALLBACK_RANK;
		out.currentLeagueLabel = sanitizeSeasonEventText_((score.currentLeagueSort && score.currentLeagueSort.tierLabel) || score.currentLeagueName, 120);
		out.currentCapturedAt = sanitizeSeasonEventTimestampOrEmpty_(score.currentCapturedAt);
		out.bestLeagueName = out.currentLeagueName;
		out.bestLeagueRank = out.currentLeagueRank;
		out.bestLeagueLabel = out.currentLeagueLabel;
		out.bestCapturedAt = out.currentCapturedAt;
		out.hasPushRank = score.hasPushRank === true;
	}
	if (includeDebugRaw === true) {
		out.debug = {
			hasPlayerMetrics: !!metricsEntry,
		};
		if (score.ledger) {
			out.debug.donationCycleLedger = score.ledger;
		}
	}
	return {
		account: out,
		score: Number(score.score) || 0,
		currentTrophies: toNonNegativeInt_(score.currentTrophies),
		bestTrophies: toNonNegativeInt_(score.bestTrophies),
		currentLeagueName: sanitizeSeasonEventText_(score.currentLeagueName, 120),
		currentLeagueSort: score.currentLeagueSort && typeof score.currentLeagueSort === "object" ? score.currentLeagueSort : parseSeasonEventLeagueSortKey_(""),
		currentCapturedAt: sanitizeSeasonEventTimestampOrEmpty_(score.currentCapturedAt),
		bestLeagueName: sanitizeSeasonEventText_(score.currentLeagueName, 120),
		bestLeagueSort: score.currentLeagueSort && typeof score.currentLeagueSort === "object" ? score.currentLeagueSort : parseSeasonEventLeagueSortKey_(""),
		hasPushRank: score.hasPushRank === true,
	};
}

// Build one participant leaderboard row.
function buildSeasonEventLeaderboardRow_(eventRaw, participantRaw, playerMetricsByTagRaw, nowIsoRaw, includeDebugRaw) {
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
	const participant = sanitizeSeasonEventParticipant_(participantRaw);
	const playerMetricsByTag = playerMetricsByTagRaw && typeof playerMetricsByTagRaw === "object" ? playerMetricsByTagRaw : {};
	const accountsRaw = Array.isArray(participant.accounts) ? participant.accounts : [];
	const accounts = [];
	const warnings = [];
	const eventType = normalizeSeasonEventType_(event.type);
	let score = 0;
	let currentTrophies = 0;
	let bestTrophies = 0;
	let currentLeagueName = "";
	let currentLeagueSort = parseSeasonEventLeagueSortKey_("");
	let currentCapturedAt = "";
	let hasPushRank = false;

	for (let i = 0; i < accountsRaw.length; i++) {
		const account = sanitizeSeasonEventParticipantAccount_(accountsRaw[i]);
		const tag = normalizeTag_(account && account.tag);
		if (!tag) continue;
		const metricsEntry = playerMetricsByTag[tag] && typeof playerMetricsByTag[tag] === "object" ? playerMetricsByTag[tag] : null;
		const result = calculateSeasonEventAccountLeaderboardScore_(event, account, metricsEntry, nowIsoRaw, includeDebugRaw);
		accounts.push(result.account);
		if (eventType === "push") {
			const candidate = {
				trophies: result.currentTrophies,
				leagueSort: result.currentLeagueSort,
				capturedMs: parseIsoToMs_(result.currentCapturedAt),
			};
			const currentBest = hasPushRank ? { trophies: currentTrophies, leagueSort: currentLeagueSort, capturedMs: parseIsoToMs_(currentCapturedAt) } : null;
			if (result.hasPushRank && isBetterSeasonEventPushRankPoint_(candidate, currentBest)) {
				score = result.score;
				currentTrophies = result.currentTrophies;
				bestTrophies = result.currentTrophies;
				currentLeagueName = result.currentLeagueName;
				currentLeagueSort = result.currentLeagueSort;
				currentCapturedAt = result.currentCapturedAt;
				hasPushRank = true;
			}
		} else {
			score += result.score;
			if (result.currentTrophies > currentTrophies) currentTrophies = result.currentTrophies;
			if (result.bestTrophies > bestTrophies) bestTrophies = result.bestTrophies;
		}
		const accountWarnings = Array.isArray(result.account.warnings) ? result.account.warnings : [];
		for (let j = 0; j < accountWarnings.length; j++) addSeasonEventWarning_(warnings, accountWarnings[j]);
	}

	if (!accounts.length) addSeasonEventWarning_(warnings, "no-registered-accounts");
	const displayName = participant.discordDisplayName || participant.discordGlobalName || participant.discordUsername || participant.discordId;
	const row = {
		rank: 0,
		discordUsername: participant.discordUsername,
		displayName: displayName,
		accounts: accounts,
		score: score,
		scoreLabel: buildSeasonEventScoreLabel_(event, score, { leagueSort: currentLeagueSort, leagueName: currentLeagueName }),
		metric: summarizeSeasonEvent_(event).settings.leaderboardMetric,
		coverage: combineSeasonEventCoverage_(accounts),
		warnings: warnings,
	};
	if (eventType === "push") {
		row.currentTrophies = currentTrophies;
		row.bestTrophies = bestTrophies;
		row.currentLeagueName = currentLeagueName;
		row.currentLeagueRank = isFinite(Number(currentLeagueSort && currentLeagueSort.rank)) ? Number(currentLeagueSort.rank) : SEASON_EVENT_LEAGUE_FALLBACK_RANK;
		row.currentLeagueLabel = sanitizeSeasonEventText_((currentLeagueSort && currentLeagueSort.tierLabel) || currentLeagueName, 120);
		row.currentCapturedAt = currentCapturedAt;
		row.bestLeagueName = currentLeagueName;
		row.bestLeagueRank = row.currentLeagueRank;
		row.bestLeagueLabel = row.currentLeagueLabel;
		row.bestCapturedAt = currentCapturedAt;
		row.hasPushRank = hasPushRank;
	}
	row._sort = {
		displayName: String(displayName || "").toLowerCase(),
		accountCount: accounts.length,
		currentTrophies: currentTrophies,
		bestTrophies: bestTrophies,
		hasPushRank: hasPushRank,
		leagueRank: isFinite(Number(currentLeagueSort && currentLeagueSort.rank)) ? Number(currentLeagueSort.rank) : SEASON_EVENT_LEAGUE_FALLBACK_RANK,
		leagueLabel: sanitizeSeasonEventText_((currentLeagueSort && currentLeagueSort.tierLabel) || currentLeagueName, 120).toLowerCase(),
	};
	if (includeDebugRaw === true) row.discordId = participant.discordId;
	return row;
}

// Sort leaderboard rows.
function sortSeasonEventLeaderboardRows_(eventRaw, rowsRaw) {
	const eventType = normalizeSeasonEventType_(eventRaw && eventRaw.type);
	const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
	rows.sort((left, right) => {
		if (eventType === "push") {
			const leftHasPushRank = left._sort && left._sort.hasPushRank === true;
			const rightHasPushRank = right._sort && right._sort.hasPushRank === true;
			if (leftHasPushRank !== rightHasPushRank) return leftHasPushRank ? -1 : 1;
			const leftLeagueRank = isFinite(Number(left._sort && left._sort.leagueRank)) ? Number(left._sort.leagueRank) : SEASON_EVENT_LEAGUE_FALLBACK_RANK;
			const rightLeagueRank = isFinite(Number(right._sort && right._sort.leagueRank)) ? Number(right._sort.leagueRank) : SEASON_EVENT_LEAGUE_FALLBACK_RANK;
			if (leftLeagueRank !== rightLeagueRank) return leftLeagueRank - rightLeagueRank;
			if (left._sort.currentTrophies !== right._sort.currentTrophies) return right._sort.currentTrophies - left._sort.currentTrophies;
		} else {
			if (left.score !== right.score) return right.score - left.score;
			if (left._sort.accountCount !== right._sort.accountCount) return right._sort.accountCount - left._sort.accountCount;
		}
		if (left._sort.displayName !== right._sort.displayName) return left._sort.displayName < right._sort.displayName ? -1 : 1;
		const leftTag = left.accounts.length ? left.accounts[0].tag : "";
		const rightTag = right.accounts.length ? right.accounts[0].tag : "";
		return leftTag < rightTag ? -1 : leftTag > rightTag ? 1 : 0;
	});
	return rows;
}

// Build a season event leaderboard.
function buildSeasonEventLeaderboard_(eventRaw, rosterDataRaw, optionsRaw) {
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : null;
	if (!event) {
		return {
			ok: true,
			status: "event-not-found",
			event: null,
			leaderboard: [],
			generatedAt: new Date().toISOString(),
		};
	}
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const eventType = normalizeSeasonEventType_(event.type);
	if (eventType === "cwl") {
		return buildCwlSeasonEventLeaderboard_(event, options);
	}
	if (eventType !== "push" && eventType !== "donation") {
		throw new Error("Unsupported season event leaderboard type: " + (eventType || "unknown"));
	}
	const nowIso = sanitizeSeasonEventTimestampOrEmpty_(options.now || options.nowIso) || new Date().toISOString();
	const includeDebug = options.includeDebug === true;
	const limit = normalizeSeasonEventLeaderboardLimit_(options.limit);
	const playerMetricsByTag = buildSeasonEventPlayerMetricsByTagWithDonationRefresh_(event, rosterDataRaw);
	const participantsByDiscordId = event.participantsByDiscordId && typeof event.participantsByDiscordId === "object" ? event.participantsByDiscordId : {};
	const participantIds = Object.keys(participantsByDiscordId).sort();
	const rows = [];

	for (let i = 0; i < participantIds.length; i++) {
		const participant = sanitizeSeasonEventParticipant_(participantsByDiscordId[participantIds[i]]);
		if (!participant.discordId) participant.discordId = sanitizeDiscordIdValue_(participantIds[i]);
		if (participant.status !== "signed_up") continue;
		rows.push(buildSeasonEventLeaderboardRow_(event, participant, playerMetricsByTag, nowIso, includeDebug));
	}

	const sorted = sortSeasonEventLeaderboardRows_(event, rows).slice(0, limit);
	for (let i = 0; i < sorted.length; i++) {
		sorted[i].rank = i + 1;
		delete sorted[i]._sort;
	}

	return {
		ok: true,
		event: summarizeSeasonEvent_(event),
		leaderboard: sorted,
		generatedAt: nowIso,
	};
}

// Public event leaderboard callable.
function getSeasonEventLeaderboard(payloadRaw, secretOrPassword) {
	assertSeasonEventSecretOrAdmin_(secretOrPassword);
	const payload = payloadRaw && typeof payloadRaw === "object" ? payloadRaw : {};
	const eventId = sanitizeSeasonEventText_(payload.eventId, 180);
	if (!eventId) throw new Error("Event ID is required.");
	const event = readSeasonEventById_(eventId);
	if (!event) return buildSeasonEventLeaderboard_(null, {}, { now: payload.now || payload.nowIso });
	const activeSnapshot = readActiveRosterSnapshot_();
	const rosterData = activeSnapshot && activeSnapshot.rosterData ? activeSnapshot.rosterData : {};
	return buildSeasonEventLeaderboard_(event, rosterData, {
		limit: payload.limit,
		includeDebug: payload.includeDebug === true,
		now: payload.now || payload.nowIso,
	});
}

// Public current event leaderboards callable.
function getCurrentSeasonEventLeaderboards(payloadRaw, secretOrPassword) {
	const parsed = parseSeasonEventOptionalPayloadAndSecret_(payloadRaw, secretOrPassword);
	assertSeasonEventSecretOrAdmin_(parsed.secretOrPassword);
	const payload = parsed.payload;
	const reconcile = reconcileCurrentSeasonEvents_({
		forceRefresh: payload.forceRefresh === true,
		manualSeason: payload.manualSeason,
		now: payload.now || payload.nowIso,
		source: payload.source || { type: "api-current-leaderboards" },
	});
	const activeSnapshot = readActiveRosterSnapshot_();
	const rosterData = activeSnapshot && activeSnapshot.rosterData ? activeSnapshot.rosterData : {};
	const nowIso = sanitizeSeasonEventTimestampOrEmpty_(payload.now || payload.nowIso) || new Date().toISOString();
	const pushEvent = reconcile.events && reconcile.events.push && reconcile.events.push.eventId ? readSeasonEventById_(reconcile.events.push.eventId) : null;
	const donationEvent = reconcile.events && reconcile.events.donation && reconcile.events.donation.eventId ? readSeasonEventById_(reconcile.events.donation.eventId) : null;
	const cwlEvent = readCurrentCwlSeasonEvent_();
	return {
		ok: true,
		season: reconcile.season,
		leaderboards: {
			push: buildSeasonEventLeaderboard_(pushEvent, rosterData, {
				limit: payload.limit,
				includeDebug: payload.includeDebug === true,
				now: nowIso,
			}),
			donation: buildSeasonEventLeaderboard_(donationEvent, rosterData, {
				limit: payload.limit,
				includeDebug: payload.includeDebug === true,
				now: nowIso,
			}),
			cwl: cwlEvent
				? buildSeasonEventLeaderboard_(cwlEvent, rosterData, {
						limit: payload.limit,
						includeDebug: payload.includeDebug === true,
						now: nowIso,
					})
				: {
						ok: true,
						event: null,
						leaderboard: [],
						generatedAt: nowIso,
					},
		},
		generatedAt: nowIso,
	};
}

// Build connected clan tag list from roster data.
function listConnectedClanTagsForCwlEvent_(rosterDataRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const rosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	const tagSet = {};
	for (let i = 0; i < rosters.length; i++) {
		const tag = normalizeTag_(rosters[i] && rosters[i].connectedClanTag);
		if (tag) tagSet[tag] = true;
	}
	return Object.keys(tagSet).sort();
}

// Return current CWL event refresh need for refresh-all planning.
function getCurrentCwlSeasonEventRefreshNeed_() {
	try {
		const event = readCurrentCwlSeasonEvent_();
		const state = event ? normalizeCwlTrackingState_(event.cwlTrackingState) || "waiting" : "";
		if (!event || event.type !== "cwl" || !isCwlSeasonEventRefreshableState_(state)) {
			return {
				needsCwl: false,
				state: state,
				eventId: event ? sanitizeSeasonEventText_(event.eventId, 180) : "",
				knownWarTags: [],
			};
		}
		const cwl = sanitizeCwlSeasonEventMeta_(event.cwl);
		const knownWarTagSet = {};
		const groupIds = Object.keys(cwl.groups);
		for (let i = 0; i < groupIds.length; i++) {
			const tags = cwl.groups[groupIds[i]].warTags || [];
			for (let j = 0; j < tags.length; j++) {
				const tag = normalizeTag_(tags[j]);
				if (tag && tag !== "#0") knownWarTagSet[tag] = true;
			}
		}
		return {
			needsCwl: true,
			state: state,
			eventId: sanitizeSeasonEventText_(event.eventId, 180),
			knownWarTags: Object.keys(knownWarTagSet).sort(),
		};
	} catch (err) {
		Logger.log("Current CWL season event refresh need unavailable: %s", errorMessage_(err));
		return { needsCwl: false, state: "", eventId: "", knownWarTags: [] };
	}
}

// Extract compact timing from materialized CWL wars.
function extractCwlWarTiming_(warTagsRaw, warRawByTagRaw) {
	const warTags = Array.isArray(warTagsRaw) ? warTagsRaw : [];
	const warRawByTag = warRawByTagRaw && typeof warRawByTagRaw === "object" ? warRawByTagRaw : {};
	let firstMs = 0;
	let lastMs = 0;
	let firstIso = "";
	let lastIso = "";
	for (let i = 0; i < warTags.length; i++) {
		const warTag = normalizeTag_(warTags[i]);
		const war = warTag && warRawByTag[warTag] && typeof warRawByTag[warTag] === "object" ? warRawByTag[warTag] : null;
		if (!war) continue;
		const startIso = sanitizeSeasonEventTimestampOrEmpty_(war.startTime || war.preparationStartTime);
		const endIso = sanitizeSeasonEventTimestampOrEmpty_(war.endTime || war.startTime || war.preparationStartTime);
		const startMs = parseIsoToMs_(startIso);
		const endMs = parseIsoToMs_(endIso);
		if (startMs > 0 && (!firstMs || startMs < firstMs)) {
			firstMs = startMs;
			firstIso = startIso;
		}
		if (endMs > 0 && endMs > lastMs) {
			lastMs = endMs;
			lastIso = endIso;
		}
	}
	return {
		firstMs: firstMs,
		lastMs: lastMs,
		firstIso: firstIso,
		lastIso: lastIso,
	};
}

function medianPositiveNumber_(valuesRaw) {
	const values = Array.isArray(valuesRaw) ? valuesRaw.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b) : [];
	if (!values.length) return 0;
	const mid = Math.floor(values.length / 2);
	return values.length % 2 ? values[mid] : Math.round((values[mid - 1] + values[mid]) / 2);
}

function getCwlWarStartEndMs_(warRaw) {
	const war = warRaw && typeof warRaw === "object" ? warRaw : {};
	const startIso = sanitizeSeasonEventTimestampOrEmpty_(war.startTime || war.preparationStartTime);
	const endIso = sanitizeSeasonEventTimestampOrEmpty_(war.endTime || war.startTime || war.preparationStartTime);
	return {
		startMs: parseIsoToMs_(startIso),
		endMs: parseIsoToMs_(endIso),
		startIso: startIso,
		endIso: endIso,
	};
}

function extractCwlLeagueGroupRoundTiming_(leaguegroupRaw, warRawByTagRaw) {
	const leaguegroup = leaguegroupRaw && typeof leaguegroupRaw === "object" ? leaguegroupRaw : {};
	const warRawByTag = warRawByTagRaw && typeof warRawByTagRaw === "object" ? warRawByTagRaw : {};
	const rounds = Array.isArray(leaguegroup.rounds) ? leaguegroup.rounds : [];
	const materializedRounds = [];
	const warDurations = [];
	let firstMs = 0;
	let lastMs = 0;
	let firstIso = "";
	let lastIso = "";

	for (let i = 0; i < rounds.length; i++) {
		const round = rounds[i] && typeof rounds[i] === "object" ? rounds[i] : {};
		const tags = Array.isArray(round.warTags) ? round.warTags : [];
		let roundStartMs = 0;
		let roundEndMs = 0;
		for (let j = 0; j < tags.length; j++) {
			const warTag = normalizeTag_(tags[j]);
			const war = warTag && warTag !== "#0" && warRawByTag[warTag] && typeof warRawByTag[warTag] === "object" ? warRawByTag[warTag] : null;
			if (!war) continue;
			const timing = getCwlWarStartEndMs_(war);
			if (timing.startMs > 0 && (!roundStartMs || timing.startMs < roundStartMs)) roundStartMs = timing.startMs;
			if (timing.endMs > 0 && timing.endMs > roundEndMs) roundEndMs = timing.endMs;
			if (timing.startMs > 0 && timing.endMs > timing.startMs) warDurations.push(timing.endMs - timing.startMs);
			if (timing.startMs > 0 && (!firstMs || timing.startMs < firstMs)) {
				firstMs = timing.startMs;
				firstIso = timing.startIso;
			}
			if (timing.endMs > 0 && timing.endMs > lastMs) {
				lastMs = timing.endMs;
				lastIso = timing.endIso;
			}
		}
		if (roundStartMs > 0 || roundEndMs > 0) {
			materializedRounds.push({
				index: i,
				startMs: roundStartMs,
				endMs: roundEndMs,
			});
		}
	}

	let cadenceMs = 0;
	const roundStartDeltas = [];
	for (let i = 1; i < materializedRounds.length; i++) {
		const prev = materializedRounds[i - 1];
		const current = materializedRounds[i];
		const indexDelta = current.index - prev.index;
		if (indexDelta > 0 && prev.startMs > 0 && current.startMs > prev.startMs) {
			roundStartDeltas.push(Math.round((current.startMs - prev.startMs) / indexDelta));
		}
	}
	cadenceMs = medianPositiveNumber_(roundStartDeltas) || medianPositiveNumber_(warDurations);

	let projectedLastMs = lastMs;
	if (rounds.length > 0 && materializedRounds.length > 0 && cadenceMs > 0) {
		const roundsWithEnd = materializedRounds.filter((round) => round.endMs > 0).sort((left, right) => left.index - right.index);
		const anchorRound = roundsWithEnd.length ? roundsWithEnd[roundsWithEnd.length - 1] : materializedRounds[materializedRounds.length - 1];
		const anchorMs = anchorRound.endMs || anchorRound.startMs;
		const remainingRounds = Math.max(0, rounds.length - 1 - anchorRound.index);
		if (anchorMs > 0) projectedLastMs = anchorMs + remainingRounds * cadenceMs;
	}

	return {
		firstMs: firstMs,
		lastMs: lastMs,
		projectedLastMs: projectedLastMs,
		firstIso: firstIso,
		lastIso: lastIso,
		projectedLastIso: projectedLastMs > 0 ? new Date(projectedLastMs).toISOString() : "",
		materializedRoundCount: materializedRounds.length,
		cadenceMs: cadenceMs,
	};
}

// Build a compact group binding from a league group.
function buildCwlSeasonEventGroupBinding_(clanTagRaw, leaguegroupRaw, warRawByTagRaw) {
	const clanTag = normalizeTag_(clanTagRaw);
	const leaguegroup = leaguegroupRaw && typeof leaguegroupRaw === "object" ? leaguegroupRaw : {};
	if (!clanTag || !leagueGroupContainsClan_(leaguegroup, clanTag)) return null;
	const warTags = extractLeagueGroupWarTags_(leaguegroup);
	if (!warTags.length) return null;
	const roundTiming = extractCwlLeagueGroupRoundTiming_(leaguegroup, warRawByTagRaw);
	const timing = roundTiming.firstIso || roundTiming.lastIso ? roundTiming : extractCwlWarTiming_(warTags, warRawByTagRaw);
	const seed = {
		season: typeof leaguegroup.season === "string" ? leaguegroup.season : "",
		warTags: warTags.slice().sort(),
	};
	const groupId = "grp-" + buildSeasonEventStableHash_(seed).slice(0, 24);
	return sanitizeCwlSeasonEventGroup_({
		groupId: groupId,
		anchorWarTag: warTags[0],
		season: seed.season,
		firstWarStartTime: timing.firstIso,
		lastWarEndTime: timing.lastIso,
		projectedLastWarEndTime: timing.projectedLastIso || timing.lastIso,
		expectedRounds: Array.isArray(leaguegroup.rounds) ? leaguegroup.rounds.length : 0,
		clanTags: [clanTag],
		warTags: warTags,
	});
}

// Merge a group binding into compact CWL metadata.
function mergeCwlSeasonEventGroupBinding_(metaRaw, bindingRaw) {
	const meta = sanitizeCwlSeasonEventMeta_(metaRaw);
	let binding = sanitizeCwlSeasonEventGroup_(bindingRaw);
	if (!binding.groupId) return meta;
	if (!meta.groups[binding.groupId]) {
		const existingIds = Object.keys(meta.groups).sort();
		for (let i = 0; i < existingIds.length; i++) {
			const candidate = sanitizeCwlSeasonEventGroup_(meta.groups[existingIds[i]]);
			const sharedWarTag = candidate.warTags.some((tag) => binding.warTags.indexOf(tag) >= 0);
			const sharedClanTag = candidate.clanTags.some((tag) => binding.clanTags.indexOf(tag) >= 0);
			if ((sharedWarTag && sharedClanTag) || (candidate.anchorWarTag && binding.warTags.indexOf(candidate.anchorWarTag) >= 0)) {
				binding = sanitizeCwlSeasonEventGroup_(Object.assign({}, binding, { groupId: candidate.groupId }));
				break;
			}
		}
	}
	const existing = sanitizeCwlSeasonEventGroup_(meta.groups[binding.groupId]);
	const clanTagSet = {};
	const warTagSet = {};
	const addTags = (tagsRaw, out) => {
		const tags = Array.isArray(tagsRaw) ? tagsRaw : [];
		for (let i = 0; i < tags.length; i++) {
			const tag = normalizeTag_(tags[i]);
			if (tag && tag !== "#0") out[tag] = true;
		}
	};
	addTags(existing.clanTags, clanTagSet);
	addTags(binding.clanTags, clanTagSet);
	addTags(existing.warTags, warTagSet);
	addTags(binding.warTags, warTagSet);
	const merged = sanitizeCwlSeasonEventGroup_({
		groupId: binding.groupId,
		anchorWarTag: existing.anchorWarTag || binding.anchorWarTag,
		season: existing.season || binding.season,
		firstWarStartTime: existing.firstWarStartTime || binding.firstWarStartTime,
		lastWarEndTime: binding.lastWarEndTime || existing.lastWarEndTime,
		projectedLastWarEndTime: binding.projectedLastWarEndTime || existing.projectedLastWarEndTime || binding.lastWarEndTime || existing.lastWarEndTime,
		expectedRounds: Math.max(toNonNegativeInt_(existing.expectedRounds), toNonNegativeInt_(binding.expectedRounds)),
		clanTags: Object.keys(clanTagSet).sort(),
		warTags: Object.keys(warTagSet).sort(),
	});
	meta.groups[merged.groupId] = merged;
	meta.groupCount = Object.keys(meta.groups).length;
	if (!meta.firstBoundGroupId) meta.firstBoundGroupId = merged.groupId;
	if (!meta.firstBoundAt) meta.firstBoundAt = new Date().toISOString();
	return meta;
}

// Bind eligible CWL groups from the shared snapshot.
function bindEligibleCwlSeasonEventGroupsFromSnapshot_(eventRaw, rosterDataRaw, snapshotRaw) {
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
	const snapshot = snapshotRaw && typeof snapshotRaw === "object" ? snapshotRaw : {};
	const state = normalizeCwlTrackingState_(event.cwlTrackingState) || "waiting";
	let meta = sanitizeCwlSeasonEventMeta_(event.cwl);
	const connectedClanTags = listConnectedClanTagsForCwlEvent_(rosterDataRaw);
	const leaguegroups = snapshot.leaguegroupRawByClanTag && typeof snapshot.leaguegroupRawByClanTag === "object" ? snapshot.leaguegroupRawByClanTag : {};
	const warRawByTag = snapshot.cwlWarRawByTag && typeof snapshot.cwlWarRawByTag === "object" ? snapshot.cwlWarRawByTag : {};
	const candidates = [];
	for (let i = 0; i < connectedClanTags.length; i++) {
		const clanTag = connectedClanTags[i];
		const leaguegroup = leaguegroups[clanTag] && typeof leaguegroups[clanTag] === "object" ? leaguegroups[clanTag] : null;
		if (!leaguegroup || !leagueGroupContainsClan_(leaguegroup, clanTag)) continue;
		if (state === "waiting" && !isCwlLeagueGroupPotentiallyLive_(leaguegroup)) continue;
		const binding = buildCwlSeasonEventGroupBinding_(clanTag, leaguegroup, warRawByTag);
		if (!binding || !binding.warTags.length) continue;
		candidates.push(binding);
	}
	if (!candidates.length) return meta;
	candidates.sort((left, right) => {
		const leftMs = parseIsoToMs_(left.firstWarStartTime) || Number.MAX_SAFE_INTEGER;
		const rightMs = parseIsoToMs_(right.firstWarStartTime) || Number.MAX_SAFE_INTEGER;
		if (leftMs !== rightMs) return leftMs - rightMs;
		return left.groupId < right.groupId ? -1 : left.groupId > right.groupId ? 1 : 0;
	});
	let anchorMs = 0;
	const existingGroupIds = Object.keys(meta.groups);
	if (existingGroupIds.length) {
		const first = meta.groups[meta.firstBoundGroupId] || meta.groups[existingGroupIds[0]];
		anchorMs = parseIsoToMs_(first && first.firstWarStartTime);
	}
	if (!anchorMs) anchorMs = parseIsoToMs_(candidates[0].firstWarStartTime) || Date.now();
	const toleranceMs = Math.max(60 * 60 * 1000, meta.bindToleranceMs || SEASON_EVENT_CWL_GROUP_BIND_TOLERANCE_MS);
	for (let i = 0; i < candidates.length; i++) {
		const candidateMs = parseIsoToMs_(candidates[i].firstWarStartTime) || anchorMs;
		if (Math.abs(candidateMs - anchorMs) > toleranceMs) continue;
		meta = mergeCwlSeasonEventGroupBinding_(meta, candidates[i]);
	}
	return meta;
}

function getCwlSeasonEventWindowFromMeta_(metaRaw) {
	const meta = sanitizeCwlSeasonEventMeta_(metaRaw);
	const groupIds = Object.keys(meta.groups);
	let startMs = 0;
	let endMs = 0;
	let startsAt = "";
	let endsAt = "";
	for (let i = 0; i < groupIds.length; i++) {
		const group = sanitizeCwlSeasonEventGroup_(meta.groups[groupIds[i]]);
		const groupStartMs = parseIsoToMs_(group.firstWarStartTime);
		const projectedEnd = group.projectedLastWarEndTime || group.lastWarEndTime;
		const groupEndMs = parseIsoToMs_(projectedEnd);
		if (groupStartMs > 0 && (!startMs || groupStartMs < startMs)) {
			startMs = groupStartMs;
			startsAt = group.firstWarStartTime;
		}
		if (groupEndMs > 0 && groupEndMs > endMs) {
			endMs = groupEndMs;
			endsAt = projectedEnd;
		}
	}
	return {
		startsAt: startsAt,
		endsAt: endsAt,
	};
}

// Build compact CWL event aggregate from bound groups and shared wars.
function buildCwlSeasonEventAggregateFromSnapshot_(eventRaw, rosterDataRaw, snapshotRaw, metaRaw, nowIsoRaw) {
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
	const snapshot = snapshotRaw && typeof snapshotRaw === "object" ? snapshotRaw : {};
	const meta = sanitizeCwlSeasonEventMeta_(metaRaw);
	const nowIso = sanitizeSeasonEventTimestampOrEmpty_(nowIsoRaw) || new Date().toISOString();
	const warRawByTag = snapshot.cwlWarRawByTag && typeof snapshot.cwlWarRawByTag === "object" ? snapshot.cwlWarRawByTag : {};
	const warErrorByTag = snapshot.cwlWarErrorByTag && typeof snapshot.cwlWarErrorByTag === "object" ? snapshot.cwlWarErrorByTag : {};
	const connectedClanTags = listConnectedClanTagsForCwlEvent_(rosterDataRaw);
	const connectedClanSet = {};
	for (let i = 0; i < connectedClanTags.length; i++) connectedClanSet[connectedClanTags[i]] = true;
	const groupIds = Object.keys(meta.groups).sort();
	const aggregateByTag = {};
	const relevantWarTagSet = {};
	const missingWarTags = [];
	const errorWarTags = [];
	const endedWarTagSet = {};
	let expectedRelevantRounds = 0;
	let materializedRelevantRounds = 0;
	let endedRelevantRounds = 0;
	const processedWarClanKey = {};

	for (let i = 0; i < groupIds.length; i++) {
		const group = sanitizeCwlSeasonEventGroup_(meta.groups[groupIds[i]]);
		const groupClanTags = group.clanTags.filter((tag) => connectedClanSet[tag]);
		const warTags = Array.isArray(group.warTags) ? group.warTags : [];
		if (groupClanTags.length > 0 && group.expectedRounds > 0) expectedRelevantRounds += group.expectedRounds * groupClanTags.length;
		for (let j = 0; j < warTags.length; j++) {
			const warTag = normalizeTag_(warTags[j]);
			if (!warTag || warTag === "#0") continue;
			if (Object.prototype.hasOwnProperty.call(warErrorByTag, warTag)) {
				errorWarTags.push(warTag);
				continue;
			}
			const war = warRawByTag[warTag] && typeof warRawByTag[warTag] === "object" ? warRawByTag[warTag] : null;
			if (!war) {
				missingWarTags.push(warTag);
				continue;
			}
			let relevantClanRoundCount = 0;
			for (let k = 0; k < groupClanTags.length; k++) {
				const clanTag = groupClanTags[k];
				if (!pickWarSideForClan_(war, clanTag)) continue;
				relevantClanRoundCount++;
				const key = warTag + "|" + clanTag;
				if (processedWarClanKey[key]) continue;
				processedWarClanKey[key] = true;
				mergeCwlAggregateByTag_(aggregateByTag, buildCwlWarAggregateForClan_(war, clanTag, null));
			}
			if (relevantClanRoundCount > 0) {
				relevantWarTagSet[warTag] = true;
				materializedRelevantRounds += relevantClanRoundCount;
				if (normalizeWarState_(war.state) === "warended") {
					endedWarTagSet[warTag] = true;
					endedRelevantRounds += relevantClanRoundCount;
				}
			}
		}
	}
	const relevantWarTags = Object.keys(relevantWarTagSet).sort();
	const byTag = {};
	const playerTags = Object.keys(aggregateByTag).sort();
	for (let i = 0; i < playerTags.length; i++) {
		const tag = normalizeTag_(playerTags[i]);
		if (tag) byTag[tag] = sanitizeCwlStatEntry_(aggregateByTag[playerTags[i]]);
	}
	const hashSource = {
		eventId: sanitizeSeasonEventText_(event.eventId, 180),
		warTags: relevantWarTags,
		byTag: byTag,
	};
	const hash = buildSeasonEventStableHash_(hashSource);
	const complete =
		relevantWarTags.length > 0 &&
		materializedRelevantRounds === endedRelevantRounds &&
		(expectedRelevantRounds <= 0 || materializedRelevantRounds >= expectedRelevantRounds);
	return {
		ok: missingWarTags.length === 0 && errorWarTags.length === 0,
		reason: errorWarTags.length ? "war-fetch-error" : missingWarTags.length ? "war-missing" : "",
		missingWarTags: missingWarTags,
		errorWarTags: errorWarTags,
		aggregate: {
			eventId: sanitizeSeasonEventText_(event.eventId, 180),
			kind: "live",
			cwlTrackingState: normalizeCwlTrackingState_(event.cwlTrackingState) || "waiting",
			generatedAt: nowIso,
			lastSuccessfulRefreshAt: nowIso,
			stale: false,
			staleSince: "",
			staleReason: "",
			hash: hash,
			scoreSchema: "cwl-offense-stars-defense-stars-v2",
			playerCount: Object.keys(byTag).length,
			warTags: relevantWarTags,
			byTag: byTag,
		},
		hash: hash,
		complete: complete,
		relevantWarCount: relevantWarTags.length,
		endedWarCount: Object.keys(endedWarTagSet).length,
		expectedRelevantRounds: expectedRelevantRounds,
		materializedRelevantRounds: materializedRelevantRounds,
	};
}

// Filter a compact CWL aggregate down to registered participant tags.
function filterCwlAggregateToRegisteredParticipants_(eventRaw, aggregateRaw) {
	const aggregate = sanitizeCwlSeasonEventAggregate_(aggregateRaw);
	const registered = listCwlSeasonEventRegisteredAccounts_(eventRaw);
	const byTag = {};
	const sortNameByTag = {};
	for (let i = 0; i < registered.length; i++) {
		const tag = registered[i].tag;
		if (!tag) continue;
		byTag[tag] = sanitizeCwlStatEntry_(aggregate.byTag[tag]);
		const participant = registered[i].participant || {};
		const account = registered[i].account || {};
		sortNameByTag[tag] =
			sanitizeSeasonEventText_(account.name, 120) ||
			participant.discordDisplayName ||
			participant.discordGlobalName ||
			participant.discordUsername ||
			participant.discordId ||
			tag;
	}
	const rankedRows = [];
	const tags = Object.keys(byTag).sort();
	for (let i = 0; i < tags.length; i++) {
		rankedRows.push({ tag: tags[i], cwlStats: byTag[tags[i]], _sortName: sortNameByTag[tags[i]] || tags[i] });
	}
	rankedRows.sort(compareCwlSeasonEventLeaderboardRows_);
	return {
		eventId: aggregate.eventId,
		kind: "final",
		cwlTrackingState: "completed",
		generatedAt: aggregate.generatedAt,
		lastSuccessfulRefreshAt: aggregate.lastSuccessfulRefreshAt,
		stale: false,
		staleSince: "",
		staleReason: "",
		hash: buildSeasonEventStableHash_({ eventId: aggregate.eventId, byTag: byTag, warTags: aggregate.warTags }),
		scoreSchema: "cwl-offense-stars-defense-stars-v2",
		playerCount: Object.keys(byTag).length,
		warTags: aggregate.warTags,
		rankedTags: rankedRows.map((row) => row.tag),
		byTag: byTag,
	};
}

// Rewrite stored CWL season-event aggregates through the current stat schema.
function migrateCwlSeasonEventDefenseStarsStorage_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const dryRun = options.dryRun === true;
	const nowIso = sanitizeSeasonEventTimestampOrEmpty_(options.nowIso || options.now) || new Date().toISOString();
	const eventKeys = listFirebaseChildKeys_(SEASON_EVENTS_CWL_AGGREGATES_PATH);
	const kinds = ["live", "final"];
	const writes = [];
	const changed = [];
	let scannedAggregateCount = 0;

	for (let i = 0; i < eventKeys.length; i++) {
		const eventId = sanitizeSeasonEventText_(decodeFirebaseObjectKey_(eventKeys[i]), 180);
		if (!eventId) continue;
		const event = readSeasonEventById_(eventId);
		for (let j = 0; j < kinds.length; j++) {
			const kind = kinds[j];
			const path = buildCwlSeasonEventAggregatePath_(eventId, kind);
			const aggregateRaw = readCwlSeasonEventAggregate_(eventId, kind);
			if (!aggregateRaw || typeof aggregateRaw !== "object" || !aggregateRaw.eventId) continue;
			scannedAggregateCount++;
			const next = sanitizeCwlSeasonEventAggregate_(aggregateRaw);
			next.eventId = next.eventId || eventId;
			next.kind = kind;
			next.scoreSchema = "cwl-offense-stars-defense-stars-v2";
			if (event) next.rankedTags = filterCwlAggregateToRegisteredParticipants_(event, next).rankedTags;
			const beforeJson = JSON.stringify(aggregateRaw);
			const afterJson = JSON.stringify(next);
			if (beforeJson === afterJson) continue;
			changed.push({
				eventId: eventId,
				kind: kind,
				playerCount: next.playerCount,
			});
			if (!dryRun) {
				writes.push({
					path: path,
					method: "PUT",
					payload: encodeFirebaseObjectKeysRecursive_(next),
				});
			}
		}
	}

	if (writes.length) {
		firebaseBatchWriteJson_(writes);
		firebaseRequestJson_(FIREBASE_META_PATH, "PATCH", {
			cwlDefenseStarsMigrationAt: nowIso,
			cwlDefenseStarsMigrationAggregateCount: writes.length,
		});
		publishCloudflareSeasonEventsAfterMutation_("migrate-cwl-defense-stars");
	}

	return {
		ok: true,
		dryRun: dryRun,
		scannedEventCount: eventKeys.length,
		scannedAggregateCount: scannedAggregateCount,
		changedAggregateCount: changed.length,
		writtenAggregateCount: dryRun ? 0 : writes.length,
		changed: changed.slice(0, 50),
	};
}

// Public Apps Script run-menu wrapper for the one-time CWL defensive-star schema migration.
function runCwlSeasonEventDefenseStarsMigrationOnce() {
	return migrateCwlSeasonEventDefenseStarsStorage_({ dryRun: false });
}

// Admin API wrapper for the one-time CWL defensive-star schema migration.
function migrateCwlSeasonEventDefenseStarsStorage(payloadRaw, password) {
	assertSeasonEventSecretOrAdmin_(password);
	return migrateCwlSeasonEventDefenseStarsStorage_(payloadRaw);
}

// Mark the live CWL aggregate stale without replacing scores.
function markCwlSeasonEventAggregateStale_(eventRaw, reasonRaw, nowIsoRaw) {
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
	const eventId = sanitizeSeasonEventText_(event.eventId, 180);
	if (!eventId) return { ok: false, status: "missing-event-id" };
	const nowIso = sanitizeSeasonEventTimestampOrEmpty_(nowIsoRaw) || new Date().toISOString();
	const existing = sanitizeCwlSeasonEventAggregate_(readCwlSeasonEventAggregate_(eventId, "live"));
	if (existing && existing.eventId) {
		existing.stale = true;
		existing.staleSince = existing.staleSince || nowIso;
		existing.staleReason = sanitizeSeasonEventText_(reasonRaw, 160) || "partial-cwl-refresh";
		writeSeasonEventFirebasePayload_(buildCwlSeasonEventAggregatePath_(eventId, "live"), "PUT", existing);
	}
	const cwl = sanitizeCwlSeasonEventMeta_(event.cwl);
	cwl.stale = true;
	cwl.staleSince = cwl.staleSince || nowIso;
	cwl.staleReason = sanitizeSeasonEventText_(reasonRaw, 160) || "partial-cwl-refresh";
	cwl.lastAttemptedRefreshAt = nowIso;
	writeSeasonEventFirebasePayload_(buildSeasonEventByIdPath_(eventId), "PATCH", {
		cwl: cwl,
		updatedAt: nowIso,
	});
	return { ok: true, status: "stale", eventId: eventId, reason: cwl.staleReason };
}

// Publish CWL aggregate and lifecycle update from a complete shared snapshot.
function publishCwlSeasonEventRefreshResult_(eventRaw, metaRaw, aggregateResultRaw, nowIsoRaw) {
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
	const eventId = sanitizeSeasonEventText_(event.eventId, 180);
	const nowIso = sanitizeSeasonEventTimestampOrEmpty_(nowIsoRaw) || new Date().toISOString();
	const aggregateResult = aggregateResultRaw && typeof aggregateResultRaw === "object" ? aggregateResultRaw : {};
	if (!eventId) return { ok: false, status: "missing-event-id" };
	return withSeasonEventParticipantWriteLock_(function () {
		const currentPointer = readSeasonEventPointer_(SEASON_EVENTS_CURRENT_CWL_PATH);
		if (sanitizeSeasonEventText_(currentPointer && currentPointer.eventId, 180) !== eventId) {
			return { ok: false, status: "stale-event-pointer", eventId: eventId };
		}
		const lockedEvent = readSeasonEventById_(eventId);
		const lockedState = lockedEvent ? normalizeCwlTrackingState_(lockedEvent.cwlTrackingState) || "waiting" : "";
		if (!lockedEvent || lockedState === "completed") return { ok: false, status: "event-not-refreshable", eventId: eventId };

		const meta = sanitizeCwlSeasonEventMeta_(metaRaw);
		meta.lastAttemptedRefreshAt = nowIso;
		meta.lastSuccessfulRefreshAt = nowIso;
		meta.lastAggregateHash = aggregateResult.hash || meta.lastAggregateHash;
		meta.stale = false;
		meta.staleSince = "";
		meta.staleReason = "";
		const aggregate = sanitizeCwlSeasonEventAggregate_(aggregateResult.aggregate);
		aggregate.cwlTrackingState = lockedState === "waiting" ? "active" : lockedState;
		aggregate.rankedTags = filterCwlAggregateToRegisteredParticipants_(lockedEvent, aggregate).rankedTags;
		const existingLive = sanitizeCwlSeasonEventAggregate_(readCwlSeasonEventAggregate_(eventId, "live"));
		const existingRankedTagsJson = JSON.stringify(Array.isArray(existingLive.rankedTags) ? existingLive.rankedTags : []);
		const nextRankedTagsJson = JSON.stringify(Array.isArray(aggregate.rankedTags) ? aggregate.rankedTags : []);
		if (existingLive.hash !== aggregate.hash || existingLive.stale === true || existingRankedTagsJson !== nextRankedTagsJson) {
			writeSeasonEventFirebasePayload_(buildCwlSeasonEventAggregatePath_(eventId, "live"), "PUT", aggregate);
		}

		let nextState = lockedState === "waiting" ? "active" : lockedState;
		let finalAggregate = null;
		if (aggregateResult.complete) {
			if (lockedState === "finalizing" && meta.finalizationHash && meta.finalizationHash === aggregate.hash) {
				nextState = "completed";
				meta.finalizedAt = nowIso;
				finalAggregate = filterCwlAggregateToRegisteredParticipants_(lockedEvent, aggregate);
				writeSeasonEventFirebasePayload_(buildCwlSeasonEventAggregatePath_(eventId, "final"), "PUT", finalAggregate);
				try {
					firebaseRequestJson_(buildCwlSeasonEventAggregatePath_(eventId, "live"), "DELETE");
				} catch (deleteErr) {
					Logger.log("Unable to delete completed CWL live aggregate for %s: %s", eventId, errorMessage_(deleteErr));
				}
			} else {
				nextState = "finalizing";
				meta.finalizationHash = aggregate.hash;
				meta.finalizationFirstSeenAt = nowIso;
			}
		} else if (lockedState === "finalizing") {
			nextState = "active";
			meta.finalizationHash = "";
			meta.finalizationFirstSeenAt = "";
		}

		const cwlWindow = getCwlSeasonEventWindowFromMeta_(meta);
		const patch = {
			cwlTrackingState: nextState,
			cwl: meta,
			startsAt: lockedEvent.startsAt || cwlWindow.startsAt || "",
			endsAt: cwlWindow.endsAt || lockedEvent.endsAt || "",
			updatedAt: nowIso,
		};
		writeSeasonEventFirebasePayload_(buildSeasonEventByIdPath_(eventId), "PATCH", patch);
		const updatedEvent = Object.assign({}, lockedEvent, patch);
		if (nextState === "completed") {
			writeSeasonEventFirebasePayload_(SEASON_EVENTS_LATEST_COMPLETED_CWL_PATH, "PUT", buildSeasonEventPointerPayload_(updatedEvent, updatedEvent));
			writeSeasonEventFirebasePayload_(SEASON_EVENTS_CURRENT_CWL_PATH, "DELETE");
		}
		return {
			ok: true,
			status: nextState,
			event: summarizeSeasonEvent_(updatedEvent),
			aggregateHash: aggregate.hash,
			finalized: nextState === "completed",
			finalPlayerCount: finalAggregate ? finalAggregate.playerCount : 0,
		};
	});
}

// Refresh current CWL season event from a shared refresh-all snapshot.
function refreshCurrentCwlSeasonEventFromSnapshot_(rosterDataRaw, snapshotRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const nowIso = sanitizeSeasonEventTimestampOrEmpty_(options.now || options.nowIso) || new Date().toISOString();
	const event = readCurrentCwlSeasonEvent_();
	const state = event ? normalizeCwlTrackingState_(event.cwlTrackingState) || "waiting" : "";
	if (!event || event.type !== "cwl" || !isCwlSeasonEventRefreshableState_(state)) {
		return { ok: true, status: "no-current-cwl-event" };
	}
	const meta = bindEligibleCwlSeasonEventGroupsFromSnapshot_(event, rosterDataRaw, snapshotRaw);
	if (!Object.keys(meta.groups).length) {
		meta.lastAttemptedRefreshAt = nowIso;
		writeSeasonEventFirebasePayload_(buildSeasonEventByIdPath_(event.eventId), "PATCH", {
			cwl: meta,
			updatedAt: nowIso,
		});
		return { ok: true, status: "waiting", event: summarizeSeasonEvent_(Object.assign({}, event, { cwl: meta })) };
	}
	const aggregateResult = buildCwlSeasonEventAggregateFromSnapshot_(event, rosterDataRaw, snapshotRaw, meta, nowIso);
	if (!aggregateResult.ok) {
		return markCwlSeasonEventAggregateStale_(event, aggregateResult.reason || "partial-cwl-refresh", nowIso);
	}
	return publishCwlSeasonEventRefreshResult_(event, meta, aggregateResult, nowIso);
}

// Safe auto-refresh wrapper for CWL events.
function tryRefreshCurrentCwlSeasonEventFromSnapshot_(rosterDataRaw, snapshotRaw, optionsRaw) {
	try {
		return refreshCurrentCwlSeasonEventFromSnapshot_(rosterDataRaw, snapshotRaw, optionsRaw);
	} catch (err) {
		Logger.log("Auto-refresh CWL season event refresh skipped: %s", errorMessage_(err));
		return {
			ok: false,
			error: errorMessage_(err),
		};
	}
}

// Auto-refresh integration wrapper. This should never fail the roster refresh.
function tryReconcileCurrentSeasonEventsForAutoRefresh_() {
	try {
		return reconcileCurrentSeasonEvents_({
			source: { type: "auto-refresh" },
			cacheTtlMs: SEASON_EVENT_SEASON_CACHE_TTL_MS,
		});
	} catch (err) {
		Logger.log("Auto-refresh season event reconciliation skipped: %s", errorMessage_(err));
		return {
			ok: false,
			error: errorMessage_(err),
		};
	}
}
