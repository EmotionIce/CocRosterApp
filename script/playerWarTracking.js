// Cross-clan player-war tracking v2.
//
// Detailed events live only under the private ledger. The active-version
// playerWarPerformance shard is a compact, immutable read model keyed by the
// normalized player tag. Roster workers may emit candidates, but only the
// serialized active-version finalizer calls finalizePlayerWarEventCandidates_.

const PLAYER_WAR_TRACKING_SCHEMA_VERSION = 2;
const PLAYER_WAR_EVENT_SCHEMA_VERSION = 1;
const PLAYER_WAR_MIGRATION_CHECKSUM_VERSION = 2;
const PLAYER_WAR_LEDGER_SHARD_COUNT = 32;
const PLAYER_WAR_RECENT_REGULAR_LIMIT = 8;
const PLAYER_WAR_CWL_SEASON_LIMIT = 8;
const PLAYER_WAR_TRACKING_STAGE_PROPERTY = "PLAYER_WAR_TRACKING_STAGE";
const PLAYER_WAR_LEDGER_PATH = "private/playerWarEventLedger";
const PLAYER_WAR_PERFORMANCE_CURRENT_PATH = "private/playerWarPerformance/current";
const PLAYER_WAR_MIGRATION_PATH = "private/playerWarTrackingMigrations";
let playerWarEventCandidateSink_ = null;

function normalizePlayerWarTrackingStage_(valueRaw) {
	const value = String(valueRaw == null ? "" : valueRaw).trim().toLowerCase();
	return value === "cutover" || value === "shadow" ? value : "legacy";
}

function getPlayerWarTrackingStage_() {
	try {
		return normalizePlayerWarTrackingStage_(PropertiesService.getScriptProperties().getProperty(PLAYER_WAR_TRACKING_STAGE_PROPERTY));
	} catch (err) {
		return "legacy";
	}
}

function setPlayerWarTrackingStage_(valueRaw) {
	const value = normalizePlayerWarTrackingStage_(valueRaw);
	PropertiesService.getScriptProperties().setProperty(PLAYER_WAR_TRACKING_STAGE_PROPERTY, value);
	return value;
}

function stablePlayerWarStringify_(value) {
	if (value == null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return "[" + value.map(stablePlayerWarStringify_).join(",") + "]";
	const keys = Object.keys(value).sort();
	return "{" + keys.map(function (key) {
		return JSON.stringify(key) + ":" + stablePlayerWarStringify_(value[key]);
	}).join(",") + "}";
}

// Deterministic 128-bit content identifier that works in both Apps Script and
// the Node VM test harness. It is a content identity, not a security boundary.
function hashPlayerWarValue_(value) {
	const text = typeof value === "string" ? value : stablePlayerWarStringify_(value);
	let a = 2166136261;
	let b = 2246822507;
	let c = 3266489909;
	let d = 668265263;
	for (let i = 0; i < text.length; i++) {
		const n = text.charCodeAt(i);
		a = Math.imul(a ^ n, 16777619);
		b = Math.imul(b ^ n, 3266489917);
		c = Math.imul(c ^ n, 668265263);
		d = Math.imul(d ^ n, 374761393);
	}
	return [a, b, c, d].map(function (n) { return (n >>> 0).toString(16).padStart(8, "0"); }).join("");
}

function createEmptyPlayerWarPerformanceStore_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	return {
		schemaVersion: PLAYER_WAR_TRACKING_SCHEMA_VERSION,
		updatedAt: String(options.updatedAt || ""),
		stage: normalizePlayerWarTrackingStage_(options.stage),
		byTag: {},
		meta: {
			eventCount: 0,
			baselineCount: 0,
			conflictCount: 0,
			migrationId: String(options.migrationId || ""),
			sourceFingerprint: String(options.sourceFingerprint || ""),
			provenance: String(options.provenance || "event-ledger"),
		},
	};
}

function sanitizePlayerWarStats_(valueRaw) {
	return sanitizeWarPerformanceStatsEntry_(valueRaw);
}

function hasPlayerWarStats_(valueRaw) {
	return hasWarPerformanceStatsData_(sanitizePlayerWarStats_(valueRaw));
}

function addSignedPlayerWarStats_(targetRaw, deltaRaw, signRaw) {
	const target = targetRaw && typeof targetRaw === "object" ? targetRaw : createEmptyWarPerformanceStats_();
	const delta = sanitizePlayerWarStats_(deltaRaw);
	const sign = Number(signRaw) < 0 ? -1 : 1;
	const keys = Object.keys(createEmptyWarPerformanceStats_());
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		target[key] = Math.max(0, toNonNegativeInt_(target[key]) + sign * toNonNegativeInt_(delta[key]));
	}
	return target;
}

function ensureGlobalPlayerWarEntry_(storeRaw, tagRaw) {
	const store = storeRaw && typeof storeRaw === "object" ? storeRaw : createEmptyPlayerWarPerformanceStore_();
	if (!store.byTag || typeof store.byTag !== "object") store.byTag = {};
	const tag = normalizeTag_(tagRaw);
	if (!tag) return null;
	if (!store.byTag[tag] || typeof store.byTag[tag] !== "object") {
		store.byTag[tag] = createEmptyWarPerformanceEntry_();
		store.byTag[tag].formStats = createEmptyFormWarPerformanceEntry_();
		store.byTag[tag].recentRegularWarForm = [];
		store.byTag[tag].cwlSeasonContext = { bySeason: {} };
		store.byTag[tag].meta = { eventCount: 0, baselineCount: 0, lastEventAt: "", provenance: "event-ledger" };
	}
	const entry = store.byTag[tag];
	entry.overall = sanitizePlayerWarStats_(entry.overall);
	entry.regular = sanitizePlayerWarStats_(entry.regular);
	entry.cwl = sanitizePlayerWarStats_(entry.cwl);
	const form = entry.formStats && typeof entry.formStats === "object" ? entry.formStats : {};
	entry.formStats = {
		overall: sanitizePlayerWarStats_(form.overall),
		regular: sanitizePlayerWarStats_(form.regular),
		cwl: sanitizePlayerWarStats_(form.cwl),
	};
	if (!Array.isArray(entry.recentRegularWarForm)) entry.recentRegularWarForm = [];
	if (!entry.cwlSeasonContext || typeof entry.cwlSeasonContext !== "object") entry.cwlSeasonContext = { bySeason: {} };
	if (!entry.cwlSeasonContext.bySeason || typeof entry.cwlSeasonContext.bySeason !== "object") entry.cwlSeasonContext.bySeason = {};
	if (!entry.meta || typeof entry.meta !== "object") entry.meta = {};
	return entry;
}

function sanitizePlayerWarContributionMap_(mapRaw) {
	const map = mapRaw && typeof mapRaw === "object" ? mapRaw : {};
	const out = {};
	Object.keys(map).sort().forEach(function (tagRaw) {
		const tag = normalizeTag_(tagRaw);
		if (!tag) return;
		const raw = map[tagRaw] && typeof map[tagRaw] === "object" ? map[tagRaw] : {};
		const stats = sanitizePlayerWarStats_(raw.stats != null ? raw.stats : raw);
		const form = sanitizePlayerWarStats_(raw.form);
		if (!hasPlayerWarStats_(stats) && !hasPlayerWarStats_(form)) return;
		out[tag] = { stats: stats };
		if (hasPlayerWarStats_(form)) out[tag].form = form;
	});
	return out;
}

function buildPlayerWarEventId_(kindRaw, clanTagRaw, identifierRaw) {
	const kind = String(kindRaw || "").toLowerCase() === "cwl" ? "cwl" : "regular";
	const identifier = kind === "cwl" ? normalizeTag_(identifierRaw) : String(identifierRaw == null ? "" : identifierRaw).trim();
	const clanTag = normalizeTag_(clanTagRaw);
	if (!identifier) return "";
	return kind + ":" + hashPlayerWarValue_([kind, clanTag, identifier]).slice(0, 24);
}

function buildPlayerWarEventCandidate_(inputRaw) {
	const input = inputRaw && typeof inputRaw === "object" ? inputRaw : {};
	const kind = String(input.kind || "").toLowerCase() === "cwl" ? "cwl" : "regular";
	const clanTag = normalizeTag_(input.clanTag);
	const identifier = kind === "cwl" ? normalizeTag_(input.warTag || input.identifier) : String(input.warKey || input.identifier || "").trim();
	const eventId = String(input.eventId || buildPlayerWarEventId_(kind, clanTag, identifier)).trim();
	const contributionsByTag = sanitizePlayerWarContributionMap_(input.contributionsByTag);
	if (!eventId || !identifier || !Object.keys(contributionsByTag).length) return null;
	const authorityInput = input.authority && typeof input.authority === "object" ? input.authority : {};
	const qualityInput = input.quality && typeof input.quality === "object" ? input.quality : {};
	const authorityLevel = String(input.authorityLevel || authorityInput.level || (input.authoritative === false ? "provisional" : "authoritative")).toLowerCase();
	const authorityRankDefault = authorityLevel === "authoritative" ? 300 : authorityLevel === "reconstructed" ? 200 : 100;
	const authorityRank = Math.max(authorityRankDefault, toNonNegativeInt_(authorityInput.rank));
	const classificationRaw = String(input.classification || qualityInput.classification || "").toLowerCase();
	const classification = ["exact", "reconstructed", "ambiguous", "partial", "unrecoverable"].indexOf(classificationRaw) >= 0
		? classificationRaw
		: (authorityRank >= 300 ? "exact" : "partial");
	const candidate = {
		schemaVersion: PLAYER_WAR_EVENT_SCHEMA_VERSION,
		eventId: eventId,
		kind: kind,
		identifier: identifier,
		warKey: kind === "regular" ? identifier : "",
		warTag: kind === "cwl" ? identifier : "",
		season: String(input.season || ""),
		clanTag: clanTag,
		rosterId: String(input.rosterId || ""),
		state: "finalized",
		startTime: String(input.startTime || ""),
		endTime: String(input.endTime || ""),
		observedAt: String(input.observedAt || input.finalizedAt || new Date().toISOString()),
		source: String(input.source || "roster-worker"),
		authority: { level: authorityLevel, rank: authorityRank },
		quality: {
			classification: classification,
			complete: input.complete != null ? input.complete === true : (qualityInput.complete != null ? qualityInput.complete === true : authorityRank >= 300),
			reason: String(input.qualityReason || qualityInput.reason || ""),
		},
		contributionsByTag: contributionsByTag,
		formEvidence: input.formEvidence && typeof input.formEvidence === "object" ? input.formEvidence : {},
		provenance: input.provenance && typeof input.provenance === "object" ? input.provenance : {},
	};
	candidate.contentHash = hashPlayerWarValue_({
		kind: candidate.kind,
		identifier: candidate.identifier,
		season: candidate.season,
		clanTag: candidate.clanTag,
		startTime: candidate.startTime,
		endTime: candidate.endTime,
		contributionsByTag: candidate.contributionsByTag,
		formEvidence: candidate.formEvidence,
	});
	return candidate;
}

function sanitizePlayerWarEventCandidate_(candidateRaw) {
	return buildPlayerWarEventCandidate_(candidateRaw);
}

function beginPlayerWarEventCandidateCapture_(sinkRaw) {
	const previous = playerWarEventCandidateSink_;
	playerWarEventCandidateSink_ = Array.isArray(sinkRaw) ? sinkRaw : [];
	return previous;
}

function endPlayerWarEventCandidateCapture_(previousRaw) {
	const captured = Array.isArray(playerWarEventCandidateSink_) ? playerWarEventCandidateSink_.slice() : [];
	playerWarEventCandidateSink_ = Array.isArray(previousRaw) ? previousRaw : null;
	return captured;
}

function emitPlayerWarEventCandidate_(candidateRaw) {
	if (!Array.isArray(playerWarEventCandidateSink_)) return false;
	const candidate = sanitizePlayerWarEventCandidate_(candidateRaw);
	if (!candidate) return false;
	const duplicate = playerWarEventCandidateSink_.some(function (entry) {
		return entry && entry.eventId === candidate.eventId && entry.contentHash === candidate.contentHash;
	});
	if (!duplicate) playerWarEventCandidateSink_.push(candidate);
	return !duplicate;
}

function buildRegularPlayerWarCandidate_(warPerformanceRaw, warKeyRaw, clanTagRaw, rosterIdRaw) {
	const warPerformance = warPerformanceRaw && typeof warPerformanceRaw === "object" ? warPerformanceRaw : {};
	const history = sanitizeRegularWarHistoryByKey_(warPerformance.regularWarHistoryByKey);
	const warKey = String(warKeyRaw || "").trim();
	const entry = warKey ? history[warKey] : null;
	if (!entry) return null;
	const contributions = {};
	const statsByTag = entry.statsByTag && typeof entry.statsByTag === "object" ? entry.statsByTag : {};
	const formByTag = entry.formStatsByTag && typeof entry.formStatsByTag === "object" ? entry.formStatsByTag : {};
	Object.keys(statsByTag).forEach(function (tagRaw) {
		const tag = normalizeTag_(tagRaw);
		if (!tag) return;
		contributions[tag] = { stats: statsByTag[tagRaw], form: formByTag[tag] || formByTag[tagRaw] || null };
	});
	return buildPlayerWarEventCandidate_({
		kind: "regular",
		warKey: warKey,
		clanTag: clanTagRaw,
		rosterId: rosterIdRaw,
		observedAt: entry.lastUpdatedAt || entry.finalizedAt,
		source: entry.source || "regular-war-history",
		authoritative: entry.authoritative === true && entry.incomplete !== true,
		complete: entry.incomplete !== true,
		classification: entry.incomplete === true ? "partial" : "exact",
		qualityReason: entry.reason || "",
		contributionsByTag: contributions,
	});
}

function buildCwlPlayerWarCandidate_(statsByTagRaw, warTagRaw, clanTagRaw, rosterIdRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const contributions = {};
	const statsByTag = statsByTagRaw && typeof statsByTagRaw === "object" ? statsByTagRaw : {};
	Object.keys(statsByTag).forEach(function (tagRaw) {
		const tag = normalizeTag_(tagRaw);
		if (!tag) return;
		contributions[tag] = { stats: statsByTag[tagRaw] };
	});
	return buildPlayerWarEventCandidate_({
		kind: "cwl",
		warTag: warTagRaw,
		season: options.season,
		clanTag: clanTagRaw,
		rosterId: rosterIdRaw,
		startTime: options.startTime,
		endTime: options.endTime,
		observedAt: options.observedAt,
		source: options.source || "cwl-war-ended",
		authorityLevel: "authoritative",
		complete: true,
		classification: "exact",
		contributionsByTag: contributions,
	});
}

function comparePlayerWarCandidatePriority_(leftRaw, rightRaw) {
	const left = sanitizePlayerWarEventCandidate_(leftRaw);
	const right = sanitizePlayerWarEventCandidate_(rightRaw);
	if (!left && !right) return 0;
	if (!left) return -1;
	if (!right) return 1;
	const leftRank = toNonNegativeInt_(left.authority && left.authority.rank);
	const rightRank = toNonNegativeInt_(right.authority && right.authority.rank);
	if (leftRank !== rightRank) return leftRank > rightRank ? 1 : -1;
	const leftComplete = left.quality && left.quality.complete === true ? 1 : 0;
	const rightComplete = right.quality && right.quality.complete === true ? 1 : 0;
	if (leftComplete !== rightComplete) return leftComplete > rightComplete ? 1 : -1;
	if (left.contentHash === right.contentHash) return 0;
	// Equal-quality conflicts choose the lexically smaller content hash. The
	// conflict remains explicit in the private revision record.
	return left.contentHash < right.contentHash ? 1 : -1;
}

function sanitizePlayerWarPerformanceStore_(storeRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const raw = storeRaw && typeof storeRaw === "object" ? storeRaw : {};
	const out = createEmptyPlayerWarPerformanceStore_({
		updatedAt: raw.updatedAt,
		stage: options.stage != null ? options.stage : raw.stage,
		migrationId: raw.meta && raw.meta.migrationId,
		sourceFingerprint: raw.meta && raw.meta.sourceFingerprint,
		provenance: raw.meta && raw.meta.provenance,
	});
	const byTag = raw.byTag && typeof raw.byTag === "object" ? raw.byTag : {};
	Object.keys(byTag).sort().forEach(function (tagRaw) {
		const tag = normalizeTag_(tagRaw);
		if (!tag) return;
		const rawEntry = byTag[tagRaw] && typeof byTag[tagRaw] === "object" ? byTag[tagRaw] : {};
		const entry = ensureGlobalPlayerWarEntry_(out, tag);
		entry.overall = sanitizePlayerWarStats_(rawEntry.overall);
		entry.regular = sanitizePlayerWarStats_(rawEntry.regular);
		entry.cwl = sanitizePlayerWarStats_(rawEntry.cwl);
		const form = rawEntry.formStats && typeof rawEntry.formStats === "object" ? rawEntry.formStats : {};
		entry.formStats = {
			overall: sanitizePlayerWarStats_(form.overall),
			regular: sanitizePlayerWarStats_(form.regular),
			cwl: sanitizePlayerWarStats_(form.cwl),
		};
		entry.recentRegularWarForm = (Array.isArray(rawEntry.recentRegularWarForm) ? rawEntry.recentRegularWarForm : [])
			.map(function (item) {
				const value = item && typeof item === "object" ? item : {};
				return {
					eventId: String(value.eventId || ""),
					warKey: String(value.warKey || ""),
					clanTag: normalizeTag_(value.clanTag),
					finalizedAt: String(value.finalizedAt || ""),
					stats: sanitizePlayerWarStats_(value.stats),
				};
			})
			.filter(function (item) { return item.eventId && hasPlayerWarStats_(item.stats); })
			.sort(function (a, b) { return String(b.finalizedAt).localeCompare(String(a.finalizedAt)) || a.eventId.localeCompare(b.eventId); })
			.slice(0, PLAYER_WAR_RECENT_REGULAR_LIMIT);
		const seasonsRaw = rawEntry.cwlSeasonContext && rawEntry.cwlSeasonContext.bySeason && typeof rawEntry.cwlSeasonContext.bySeason === "object"
			? rawEntry.cwlSeasonContext.bySeason
			: {};
		entry.cwlSeasonContext = { bySeason: {} };
		Object.keys(seasonsRaw).sort().slice(-PLAYER_WAR_CWL_SEASON_LIMIT).forEach(function (season) {
			const value = seasonsRaw[season] && typeof seasonsRaw[season] === "object" ? seasonsRaw[season] : {};
			entry.cwlSeasonContext.bySeason[season] = {
				stats: sanitizePlayerWarStats_(value.stats),
				finalizedEventIds: (Array.isArray(value.finalizedEventIds) ? value.finalizedEventIds : []).map(String).sort(),
				lastEventAt: String(value.lastEventAt || ""),
			};
		});
		entry.meta = {
			eventCount: toNonNegativeInt_(rawEntry.meta && rawEntry.meta.eventCount),
			baselineCount: toNonNegativeInt_(rawEntry.meta && rawEntry.meta.baselineCount),
			lastEventAt: String(rawEntry.meta && rawEntry.meta.lastEventAt || ""),
			provenance: String(rawEntry.meta && rawEntry.meta.provenance || "event-ledger"),
		};
	});
	out.meta.eventCount = toNonNegativeInt_(raw.meta && raw.meta.eventCount);
	out.meta.baselineCount = toNonNegativeInt_(raw.meta && raw.meta.baselineCount);
	out.meta.conflictCount = toNonNegativeInt_(raw.meta && raw.meta.conflictCount);
	out.contentHash = hashPlayerWarValue_({ schemaVersion: out.schemaVersion, byTag: out.byTag, meta: out.meta });
	return out;
}

function applyPlayerWarEventDelta_(storeRaw, eventRaw, signRaw) {
	const store = storeRaw && typeof storeRaw === "object" ? storeRaw : createEmptyPlayerWarPerformanceStore_();
	const event = sanitizePlayerWarEventCandidate_(eventRaw);
	if (!event) return store;
	const sign = Number(signRaw) < 0 ? -1 : 1;
	Object.keys(event.contributionsByTag).forEach(function (tag) {
		const contribution = event.contributionsByTag[tag];
		const entry = ensureGlobalPlayerWarEntry_(store, tag);
		const bucket = event.kind === "cwl" ? entry.cwl : entry.regular;
		addSignedPlayerWarStats_(bucket, contribution.stats, sign);
		addSignedPlayerWarStats_(entry.overall, contribution.stats, sign);
		if (contribution.form && hasPlayerWarStats_(contribution.form)) {
			const formBucket = event.kind === "cwl" ? entry.formStats.cwl : entry.formStats.regular;
			addSignedPlayerWarStats_(formBucket, contribution.form, sign);
			addSignedPlayerWarStats_(entry.formStats.overall, contribution.form, sign);
		}
		if (event.kind === "regular" && contribution.form && hasPlayerWarStats_(contribution.form)) {
			entry.recentRegularWarForm = entry.recentRegularWarForm.filter(function (item) { return item.eventId !== event.eventId; });
			if (sign > 0) {
				entry.recentRegularWarForm.push({
					eventId: event.eventId,
					warKey: event.warKey,
					clanTag: event.clanTag,
					finalizedAt: event.observedAt,
					stats: sanitizePlayerWarStats_(contribution.form),
				});
			}
			entry.recentRegularWarForm.sort(function (a, b) {
				return String(b.finalizedAt).localeCompare(String(a.finalizedAt)) || String(a.eventId).localeCompare(String(b.eventId));
			});
			entry.recentRegularWarForm = entry.recentRegularWarForm.slice(0, PLAYER_WAR_RECENT_REGULAR_LIMIT);
		}
		if (event.kind === "cwl" && event.season) {
			const seasons = entry.cwlSeasonContext.bySeason;
			if (!seasons[event.season]) seasons[event.season] = { stats: createEmptyWarPerformanceStats_(), finalizedEventIds: [], lastEventAt: "" };
			addSignedPlayerWarStats_(seasons[event.season].stats, contribution.stats, sign);
			seasons[event.season].finalizedEventIds = seasons[event.season].finalizedEventIds.filter(function (id) { return id !== event.eventId; });
			if (sign > 0) {
				seasons[event.season].finalizedEventIds.push(event.eventId);
				if (String(event.observedAt || "") > String(seasons[event.season].lastEventAt || "")) {
					seasons[event.season].lastEventAt = String(event.observedAt || "");
				}
			} else if (!seasons[event.season].finalizedEventIds.length) {
				seasons[event.season].lastEventAt = "";
			}
			seasons[event.season].finalizedEventIds.sort();
		}
		entry.meta.eventCount = Math.max(0, toNonNegativeInt_(entry.meta.eventCount) + sign);
		if (sign > 0) entry.meta.lastEventAt = event.observedAt || entry.meta.lastEventAt;
	});
	store.meta.eventCount = Math.max(0, toNonNegativeInt_(store.meta.eventCount) + sign);
	return store;
}

function resolvePlayerWarEventCandidate_(existingRecordRaw, candidateRaw, nowIsoRaw) {
	const candidate = sanitizePlayerWarEventCandidate_(candidateRaw);
	if (!candidate) return { accepted: false, reason: "invalid-candidate", record: existingRecordRaw || null };
	const existingRecord = existingRecordRaw && typeof existingRecordRaw === "object" ? existingRecordRaw : null;
	const existingEvent = existingRecord && existingRecord.current && typeof existingRecord.current === "object"
		? sanitizePlayerWarEventCandidate_(existingRecord.current)
		: null;
	if (existingEvent && existingEvent.contentHash === candidate.contentHash) {
		return { accepted: false, idempotent: true, reason: "content-already-current", oldEvent: existingEvent, newEvent: existingEvent, record: existingRecord };
	}
	const priority = comparePlayerWarCandidatePriority_(candidate, existingEvent);
	if (existingEvent && priority < 0) {
		const equalAuthority = toNonNegativeInt_(existingEvent.authority && existingEvent.authority.rank)
			=== toNonNegativeInt_(candidate.authority && candidate.authority.rank);
		if (!equalAuthority) {
			return { accepted: false, reason: "lower-priority-candidate", oldEvent: existingEvent, newEvent: existingEvent, record: existingRecord };
		}
		const nowIso = String(nowIsoRaw || new Date().toISOString());
		const conflicts = Array.isArray(existingRecord && existingRecord.conflicts) ? existingRecord.conflicts.slice() : [];
		conflicts.push({
			at: nowIso,
			previousContentHash: existingEvent.contentHash,
			incomingContentHash: candidate.contentHash,
			selectedContentHash: existingEvent.contentHash,
			resolution: "authority-completeness-hash-order",
		});
		const conflictRecord = Object.assign({}, existingRecord, {
			conflicts: conflicts.slice(-20),
			updatedAt: nowIso,
		});
		return {
			accepted: false,
			conflict: true,
			recordChanged: true,
			reason: "lower-priority-conflict",
			oldEvent: existingEvent,
			newEvent: existingEvent,
			record: conflictRecord,
		};
	}
	const nowIso = String(nowIsoRaw || new Date().toISOString());
	const revision = Math.max(0, toNonNegativeInt_(existingRecord && existingRecord.currentRevision)) + 1;
	const conflict = !!(existingEvent && toNonNegativeInt_(existingEvent.authority && existingEvent.authority.rank) === toNonNegativeInt_(candidate.authority && candidate.authority.rank));
	const revisions = existingRecord && existingRecord.revisions && typeof existingRecord.revisions === "object"
		? Object.assign({}, existingRecord.revisions)
		: {};
	revisions[String(revision)] = {
		revision: revision,
		contentHash: candidate.contentHash,
		receivedAt: nowIso,
		source: candidate.source,
		authority: candidate.authority,
		quality: candidate.quality,
		selected: true,
	};
	const conflicts = Array.isArray(existingRecord && existingRecord.conflicts) ? existingRecord.conflicts.slice() : [];
	if (conflict) {
		conflicts.push({
			at: nowIso,
			previousContentHash: existingEvent.contentHash,
			incomingContentHash: candidate.contentHash,
			selectedContentHash: candidate.contentHash,
			resolution: "authority-completeness-hash-order",
		});
	}
	const record = {
		schemaVersion: PLAYER_WAR_EVENT_SCHEMA_VERSION,
		eventId: candidate.eventId,
		currentRevision: revision,
		currentContentHash: candidate.contentHash,
		current: candidate,
		revisions: revisions,
		conflicts: conflicts.slice(-20),
		createdAt: String(existingRecord && existingRecord.createdAt || nowIso),
		updatedAt: nowIso,
	};
	return { accepted: true, conflict: conflict, reason: existingEvent ? "replaced" : "created", oldEvent: existingEvent, newEvent: candidate, record: record };
}

function getPlayerWarLedgerShardId_(eventIdRaw) {
	const hash = hashPlayerWarValue_(String(eventIdRaw || ""));
	return String(parseInt(hash.slice(0, 8), 16) % PLAYER_WAR_LEDGER_SHARD_COUNT).padStart(2, "0");
}

function buildPlayerWarLedgerEventPath_(eventIdRaw) {
	const eventId = String(eventIdRaw || "").trim();
	return buildFirebaseChildPath_(
		PLAYER_WAR_LEDGER_PATH,
		"shards",
		getPlayerWarLedgerShardId_(eventId),
		"events",
		encodeFirebaseObjectKey_(eventId),
	);
}

function dedupePlayerWarCandidates_(candidatesRaw) {
	const candidates = Array.isArray(candidatesRaw) ? candidatesRaw : [];
	const byEventId = {};
	for (let i = 0; i < candidates.length; i++) {
		const candidate = sanitizePlayerWarEventCandidate_(candidates[i]);
		if (!candidate) continue;
		const existing = byEventId[candidate.eventId];
		if (!existing || comparePlayerWarCandidatePriority_(candidate, existing) > 0) byEventId[candidate.eventId] = candidate;
	}
	return Object.keys(byEventId).sort().map(function (eventId) { return byEventId[eventId]; });
}

function finalizePlayerWarEventCandidates_(sourceStoreRaw, candidatesRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const nowIso = String(options.nowIso || new Date().toISOString());
	let store = sanitizePlayerWarPerformanceStore_(sourceStoreRaw, { stage: options.stage });
	const candidates = dedupePlayerWarCandidates_(candidatesRaw);
	const results = [];
	const writes = [];
	for (let i = 0; i < candidates.length; i++) {
		const candidate = candidates[i];
		const path = typeof buildFirebaseChildPath_ === "function" ? buildPlayerWarLedgerEventPath_(candidate.eventId) : "";
		let existingRecord = options.existingRecordsByEventId && options.existingRecordsByEventId[candidate.eventId];
		if (existingRecord == null && options.persist !== false && path) {
			existingRecord = decodeFirebaseObjectKeysRecursive_(firebaseRequestJson_(path, "GET"));
		}
		const resolved = resolvePlayerWarEventCandidate_(existingRecord, candidate, nowIso);
		results.push({
			eventId: candidate.eventId,
			accepted: resolved.accepted === true,
			idempotent: resolved.idempotent === true,
			conflict: resolved.conflict === true,
			reason: resolved.reason,
			contentHash: candidate.contentHash,
		});
		if (options.rebuildFromResolvedEvents === true) {
			if (resolved.newEvent) applyPlayerWarEventDelta_(store, resolved.newEvent, 1);
			if (resolved.conflict) store.meta.conflictCount = toNonNegativeInt_(store.meta.conflictCount) + 1;
			if (resolved.recordChanged && path && (options.persist !== false || options.collectLedgerWrites === true)) {
				writes.push({ path: path, method: "PUT", payload: encodeFirebaseObjectKeysRecursive_(resolved.record) });
			} else if (resolved.accepted && path && (options.persist !== false || options.collectLedgerWrites === true)) {
				writes.push({ path: path, method: "PUT", payload: encodeFirebaseObjectKeysRecursive_(resolved.record) });
			}
			continue;
		}
		if (!resolved.accepted) {
			if (resolved.conflict) store.meta.conflictCount = toNonNegativeInt_(store.meta.conflictCount) + 1;
			if (resolved.recordChanged && path && (options.persist !== false || options.collectLedgerWrites === true)) {
				writes.push({ path: path, method: "PUT", payload: encodeFirebaseObjectKeysRecursive_(resolved.record) });
			}
			continue;
		}
		if (resolved.oldEvent) applyPlayerWarEventDelta_(store, resolved.oldEvent, -1);
		applyPlayerWarEventDelta_(store, resolved.newEvent, 1);
		if (resolved.conflict) store.meta.conflictCount = toNonNegativeInt_(store.meta.conflictCount) + 1;
		if (path && (options.persist !== false || options.collectLedgerWrites === true)) {
			writes.push({ path: path, method: "PUT", payload: encodeFirebaseObjectKeysRecursive_(resolved.record) });
		}
	}
	store.updatedAt = nowIso;
	store.stage = normalizePlayerWarTrackingStage_(options.stage != null ? options.stage : store.stage);
	store = sanitizePlayerWarPerformanceStore_(store, { stage: store.stage });
	if (options.persist !== false && writes.length) firebaseBatchPutJson_(writes, { disableFallback: true });
	if (options.persist !== false) {
		firebaseRequestJson_(buildFirebaseChildPath_(PLAYER_WAR_LEDGER_PATH, "meta"), "PATCH", {
			schemaVersion: PLAYER_WAR_EVENT_SCHEMA_VERSION,
			shardCount: PLAYER_WAR_LEDGER_SHARD_COUNT,
			updatedAt: nowIso,
			eventCount: toNonNegativeInt_(store.meta.eventCount),
			conflictCount: toNonNegativeInt_(store.meta.conflictCount),
		});
	}
	return {
		store: store,
		results: results,
		ledgerWrites: writes,
		acceptedCount: results.filter(function (item) { return item.accepted; }).length,
	};
}

// Commit a bounded set of captured war events to the canonical read model and
// event ledger in one Firebase rollback boundary. Callers that also publish an
// active roster generation must hold the active-roster job lock while doing so.
function finalizePlayerWarEventCandidatesToCurrent_(sourceStoreRaw, candidatesRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const stage = normalizePlayerWarTrackingStage_(options.stage != null ? options.stage : getPlayerWarTrackingStage_());
	const candidates = dedupePlayerWarCandidates_(candidatesRaw);
	const canonicalEncoded = firebaseRequestJson_(PLAYER_WAR_PERFORMANCE_CURRENT_PATH, "GET");
	const sourceStore = canonicalEncoded && typeof canonicalEncoded === "object"
		? decodeFirebaseObjectKeysRecursive_(canonicalEncoded)
		: (sourceStoreRaw && typeof sourceStoreRaw === "object"
			? sourceStoreRaw
			: createEmptyPlayerWarPerformanceStore_({ stage: stage, provenance: "captured-war-events-bootstrap" }));
	if (!candidates.length) {
		return {
			store: sanitizePlayerWarPerformanceStore_(sourceStore, { stage: stage }),
			results: [],
			acceptedCount: 0,
		};
	}

	const ledgerPaths = candidates.map(function (candidate) {
		return buildPlayerWarLedgerEventPath_(candidate.eventId);
	});
	const existingEncodedByPath = firebaseBatchGetJson_(ledgerPaths, { disableFallback: true });
	const existingRecordsByEventId = {};
	for (let i = 0; i < candidates.length; i++) {
		const decoded = decodeFirebaseObjectKeysRecursive_(existingEncodedByPath[ledgerPaths[i]]);
		if (decoded && typeof decoded === "object") existingRecordsByEventId[candidates[i].eventId] = decoded;
	}
	const finalized = finalizePlayerWarEventCandidates_(sourceStore, candidates, {
		persist: false,
		collectLedgerWrites: true,
		existingRecordsByEventId: existingRecordsByEventId,
		stage: stage,
		nowIso: String(options.nowIso || new Date().toISOString()),
	});
	const store = sanitizePlayerWarPerformanceStore_(finalized.store, { stage: stage });
	const writes = Array.isArray(finalized.ledgerWrites) ? finalized.ledgerWrites.slice() : [];
	writes.push(
		{
			path: PLAYER_WAR_PERFORMANCE_CURRENT_PATH,
			method: "PUT",
			payload: encodeFirebaseObjectKeysRecursive_(store),
		},
		{
			path: buildFirebaseChildPath_(PLAYER_WAR_LEDGER_PATH, "meta"),
			method: "PUT",
			payload: encodeFirebaseObjectKeysRecursive_({
				schemaVersion: PLAYER_WAR_EVENT_SCHEMA_VERSION,
				shardCount: PLAYER_WAR_LEDGER_SHARD_COUNT,
				updatedAt: store.updatedAt,
				eventCount: toNonNegativeInt_(store.meta && store.meta.eventCount),
				conflictCount: toNonNegativeInt_(store.meta && store.meta.conflictCount),
			}),
		},
	);
	firebaseBatchPutJson_(writes, { disableFallback: true });
	return {
		store: store,
		results: finalized.results,
		acceptedCount: finalized.acceptedCount,
	};
}

function buildPlayerWarShadowComparison_(legacyRosterDataRaw, globalStoreRaw) {
	const rosterData = legacyRosterDataRaw && typeof legacyRosterDataRaw === "object" ? legacyRosterDataRaw : {};
	const globalStore = sanitizePlayerWarPerformanceStore_(globalStoreRaw);
	const legacyByTag = {};
	(Array.isArray(rosterData.rosters) ? rosterData.rosters : []).forEach(function (roster) {
		const byTag = roster && roster.warPerformance && roster.warPerformance.byTag && typeof roster.warPerformance.byTag === "object"
			? roster.warPerformance.byTag
			: {};
		Object.keys(byTag).forEach(function (tagRaw) {
			const tag = normalizeTag_(tagRaw);
			if (!tag) return;
			if (!legacyByTag[tag]) legacyByTag[tag] = createEmptyWarPerformanceEntry_();
			const value = sanitizeWarPerformanceEntry_(byTag[tagRaw]);
			mergeWarPerformanceStats_(legacyByTag[tag].overall, value.overall);
			mergeWarPerformanceStats_(legacyByTag[tag].regular, value.regular);
			mergeWarPerformanceStats_(legacyByTag[tag].cwl, value.cwl);
		});
	});
	const tags = {};
	Object.keys(legacyByTag).forEach(function (tag) { tags[tag] = true; });
	Object.keys(globalStore.byTag).forEach(function (tag) { tags[tag] = true; });
	const differences = [];
	Object.keys(tags).sort().forEach(function (tag) {
		const legacy = sanitizeWarPerformanceEntry_(legacyByTag[tag]);
		const global = sanitizeWarPerformanceEntry_(globalStore.byTag[tag]);
		const legacyHash = hashPlayerWarValue_(legacy);
		const globalHash = hashPlayerWarValue_({ overall: global.overall, regular: global.regular, cwl: global.cwl });
		if (legacyHash !== globalHash) differences.push({ tag: tag, legacyHash: legacyHash, globalHash: globalHash });
	});
	return { tagCount: Object.keys(tags).length, differenceCount: differences.length, differences: differences.slice(0, 200) };
}

function buildCwlMigrationSnapshot_(sourceRaw, rosterRaw, sourceIndexRaw) {
	const source = sourceRaw && typeof sourceRaw === "object" ? sourceRaw : {};
	const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
	const wp = roster.warPerformance && typeof roster.warPerformance === "object" ? roster.warPerformance : {};
	const processedRaw = wp.processedCwlWarTags && typeof wp.processedCwlWarTags === "object" ? wp.processedCwlWarTags : {};
	const processedWarTags = Object.keys(processedRaw).map(normalizeTag_).filter(Boolean).sort();
	if (!processedWarTags.length) return null;
	const byTagRaw = wp.byTag && typeof wp.byTag === "object" ? wp.byTag : {};
	const byTag = {};
	Object.keys(byTagRaw).forEach(function (tagRaw) {
		const tag = normalizeTag_(tagRaw);
		const value = byTagRaw[tagRaw] && typeof byTagRaw[tagRaw] === "object" ? byTagRaw[tagRaw] : {};
		const stats = sanitizePlayerWarStats_(value.cwl);
		if (tag && hasPlayerWarStats_(stats)) byTag[tag] = stats;
	});
	const observedAt = String(
		wp.lastFinalizedAt
		|| wp.lastRefreshedAt
		|| (source.rosterData && source.rosterData.lastUpdatedAt)
		|| source.lastUpdatedAt
		|| "",
	);
	if (!observedAt) return null;
	return {
		sourceId: String(source.id || "source-" + sourceIndexRaw),
		rosterId: String(roster.id || ""),
		clanTag: normalizeTag_(roster.connectedClanTag),
		season: String(wp.cwlPreSeasonBaselineSeason || (roster.cwlStats && roster.cwlStats.season) || ""),
		observedAt: observedAt,
		processedWarTags: processedWarTags,
		byTag: byTag,
		fingerprint: hashPlayerWarValue_({ processedWarTags: processedWarTags, byTag: byTag }),
	};
}

function subtractMonotonicPlayerWarStats_(currentRaw, previousRaw) {
	const current = sanitizePlayerWarStats_(currentRaw);
	const previous = sanitizePlayerWarStats_(previousRaw);
	const delta = createEmptyWarPerformanceStats_();
	const keys = Object.keys(delta);
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		const currentValue = toNonNegativeInt_(current[key]);
		const previousValue = toNonNegativeInt_(previous[key]);
		if (currentValue < previousValue) return null;
		delta[key] = currentValue - previousValue;
	}
	return delta;
}

// Legacy CWL has no contribution ledger. Reconstruct a segment only when two
// ordered archives prove that exactly one war tag was added and all per-player
// aggregate fields moved monotonically. Multi-war or decreasing gaps remain
// explicit baseline evidence.
function reconstructLegacyCwlEventCandidates_(seriesByRosterKeyRaw) {
	const seriesByRosterKey = seriesByRosterKeyRaw && typeof seriesByRosterKeyRaw === "object" ? seriesByRosterKeyRaw : {};
	const candidates = [];
	const issues = [];
	Object.keys(seriesByRosterKey).sort().forEach(function (key) {
		const snapshotsRaw = Array.isArray(seriesByRosterKey[key]) ? seriesByRosterKey[key] : [];
		const byFingerprint = {};
		snapshotsRaw.forEach(function (snapshot) {
			if (!snapshot || !snapshot.fingerprint) return;
			const existing = byFingerprint[snapshot.fingerprint];
			if (!existing || String(snapshot.observedAt).localeCompare(String(existing.observedAt)) < 0) {
				byFingerprint[snapshot.fingerprint] = snapshot;
			}
		});
		const snapshots = Object.keys(byFingerprint).map(function (hash) { return byFingerprint[hash]; }).sort(function (a, b) {
			return String(a.observedAt).localeCompare(String(b.observedAt)) || String(a.sourceId).localeCompare(String(b.sourceId));
		});
		for (let i = 1; i < snapshots.length; i++) {
			const previous = snapshots[i - 1];
			const current = snapshots[i];
			const previousSet = {};
			previous.processedWarTags.forEach(function (tag) { previousSet[tag] = true; });
			const removed = previous.processedWarTags.filter(function (tag) { return current.processedWarTags.indexOf(tag) < 0; });
			const added = current.processedWarTags.filter(function (tag) { return !previousSet[tag]; });
			if (removed.length || added.length !== 1) {
				if (added.length || removed.length) {
					issues.push({
						rosterKey: key,
						fromSource: previous.sourceId,
						toSource: current.sourceId,
						classification: added.length > 1 ? "partial" : "ambiguous",
						reason: removed.length ? "processed-war-tags-decreased" : "multiple-war-gap",
						addedWarTagCount: added.length,
					});
				}
				continue;
			}
			const contributions = {};
			let monotonic = true;
			const tags = {};
			Object.keys(previous.byTag).forEach(function (tag) { tags[tag] = true; });
			Object.keys(current.byTag).forEach(function (tag) { tags[tag] = true; });
			Object.keys(tags).sort().forEach(function (tag) {
				const delta = subtractMonotonicPlayerWarStats_(current.byTag[tag], previous.byTag[tag]);
				if (!delta) {
					monotonic = false;
					return;
				}
				if (hasPlayerWarStats_(delta)) contributions[tag] = { stats: delta };
			});
			if (!monotonic || !Object.keys(contributions).length) {
				issues.push({
					rosterKey: key,
					fromSource: previous.sourceId,
					toSource: current.sourceId,
					classification: monotonic ? "unrecoverable" : "ambiguous",
					reason: monotonic ? "no-contribution-delta" : "non-monotonic-aggregate",
					warTag: added[0],
				});
				continue;
			}
			const candidate = buildPlayerWarEventCandidate_({
				kind: "cwl",
				warTag: added[0],
				season: current.season || previous.season,
				clanTag: current.clanTag,
				rosterId: current.rosterId,
				observedAt: current.observedAt,
				source: "migration-cwl-archive-delta",
				authorityLevel: "reconstructed",
				complete: true,
				classification: "reconstructed",
				qualityReason: "single-monotonic-archive-segment",
				provenance: { fromSource: previous.sourceId, toSource: current.sourceId },
				contributionsByTag: contributions,
			});
			if (candidate) candidates.push(candidate);
		}
	});
	return { candidates: candidates, issues: issues.slice(0, 200) };
}

// Hash only canonical migration data. Firebase Realtime Database elides empty
// objects and arrays, so raw plan serialization is not stable across the
// required stage/read/commit round trip.
function buildPlayerWarMigrationChecksumPayload_(planRaw) {
	const plan = planRaw && typeof planRaw === "object" ? planRaw : {};
	const baselinesRaw = plan.baselinesByTag && typeof plan.baselinesByTag === "object" ? plan.baselinesByTag : {};
	const baselinesByTag = {};
	Object.keys(baselinesRaw).sort().forEach(function (tagRaw) {
		const tag = normalizeTag_(tagRaw);
		if (!tag) return;
		const raw = baselinesRaw[tagRaw] && typeof baselinesRaw[tagRaw] === "object" ? baselinesRaw[tagRaw] : {};
		const cwlByRosterKeyRaw = raw.cwlByRosterKey && typeof raw.cwlByRosterKey === "object" ? raw.cwlByRosterKey : {};
		const cwlByRosterKey = {};
		Object.keys(cwlByRosterKeyRaw).sort().forEach(function (rosterKey) {
			cwlByRosterKey[String(rosterKey || "")] = sanitizePlayerWarStats_(cwlByRosterKeyRaw[rosterKey]);
		});
		baselinesByTag[tag] = {
			regular: sanitizePlayerWarStats_(raw.regular),
			cwl: sanitizePlayerWarStats_(raw.cwl),
			cwlRosterKey: String(raw.cwlRosterKey || ""),
			cwlByRosterKey: cwlByRosterKey,
			provenance: (Array.isArray(raw.provenance) ? raw.provenance : []).map(function (item) {
				const value = item && typeof item === "object" ? item : {};
				return {
					source: String(value.source || ""),
					rosterKey: String(value.rosterKey || ""),
					kind: String(value.kind || ""),
					classification: String(value.classification || ""),
				};
			}),
		};
	});
	return {
		checksumVersion: Math.max(1, toNonNegativeInt_(plan.checksumVersion) || PLAYER_WAR_MIGRATION_CHECKSUM_VERSION),
		migrationId: String(plan.migrationId || ""),
		sourceFingerprint: String(plan.sourceFingerprint || ""),
		candidates: dedupePlayerWarCandidates_(plan.candidates),
		baselinesByTag: baselinesByTag,
	};
}

function calculatePlayerWarMigrationChecksum_(planRaw) {
	return hashPlayerWarValue_(buildPlayerWarMigrationChecksumPayload_(planRaw));
}

// Build a conservative migration plan without inventing per-war CWL history.
function buildPlayerWarTrackingMigrationPlan_(sourcesRaw, optionsRaw) {
	const sources = Array.isArray(sourcesRaw) ? sourcesRaw : [];
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const candidates = [];
	const baselinesByTag = {};
	const cwlBaselinesByTagAndRoster = {};
	const cwlSeriesByRosterKey = {};
	const classifications = { exact: 0, reconstructed: 0, ambiguous: 0, partial: 0, unrecoverable: 0 };
	const sourceFingerprints = [];
	for (let s = 0; s < sources.length; s++) {
		const source = sources[s] && typeof sources[s] === "object" ? sources[s] : {};
		const rosterData = source.rosterData && typeof source.rosterData === "object" ? source.rosterData : source;
		sourceFingerprints.push({ id: String(source.id || "source-" + s), hash: hashPlayerWarValue_(rosterData) });
		(Array.isArray(rosterData.rosters) ? rosterData.rosters : []).forEach(function (roster) {
			const wp = roster && roster.warPerformance && typeof roster.warPerformance === "object" ? roster.warPerformance : {};
			const cwlSnapshot = buildCwlMigrationSnapshot_(source, roster, s);
			const cwlRosterKey = cwlSnapshot ? (cwlSnapshot.clanTag || cwlSnapshot.rosterId) : (normalizeTag_(roster.connectedClanTag) || String(roster.id || ""));
			if (cwlSnapshot) {
				if (!cwlSeriesByRosterKey[cwlRosterKey]) cwlSeriesByRosterKey[cwlRosterKey] = [];
				cwlSeriesByRosterKey[cwlRosterKey].push(cwlSnapshot);
			}
			const history = sanitizeRegularWarHistoryByKey_(wp.regularWarHistoryByKey);
			Object.keys(history).sort().forEach(function (warKey) {
				const candidate = buildRegularPlayerWarCandidate_(wp, warKey, roster.connectedClanTag, roster.id);
				if (!candidate) return;
				candidate.authority.level = history[warKey].authoritative ? "authoritative" : "reconstructed";
				candidate.authority.rank = history[warKey].authoritative ? 300 : 200;
				candidate.quality.classification = history[warKey].authoritative ? "exact" : "reconstructed";
				candidate.quality.complete = history[warKey].incomplete !== true;
				candidate.contentHash = hashPlayerWarValue_({
					kind: candidate.kind,
					identifier: candidate.identifier,
					clanTag: candidate.clanTag,
					contributionsByTag: candidate.contributionsByTag,
				});
				candidates.push(candidate);
				classifications[candidate.quality.classification]++;
			});
			const legacyRegular = sanitizeRegularWarLegacyBaselineByTag_(wp.regularWarLegacyBaselineByTag);
			const legacyCwl = wp.byTag && typeof wp.byTag === "object" ? wp.byTag : {};
			const tags = {};
			Object.keys(legacyRegular).forEach(function (tag) { tags[normalizeTag_(tag)] = true; });
			Object.keys(legacyCwl).forEach(function (tag) { tags[normalizeTag_(tag)] = true; });
			Object.keys(tags).forEach(function (tag) {
				if (!tag) return;
				if (!baselinesByTag[tag]) baselinesByTag[tag] = { regular: createEmptyWarPerformanceStats_(), cwl: createEmptyWarPerformanceStats_(), provenance: [] };
				if (legacyRegular[tag]) {
					if (!hasPlayerWarStats_(baselinesByTag[tag].regular)) {
						baselinesByTag[tag].regular = sanitizePlayerWarStats_(legacyRegular[tag]);
						baselinesByTag[tag].provenance.push({ source: String(source.id || ""), kind: "explicit-regular-baseline", classification: "exact" });
						classifications.exact++;
					}
				}
				const cwlStats = legacyCwl[tag] && legacyCwl[tag].cwl;
				if (hasPlayerWarStats_(cwlStats)) {
					const baselineKey = tag + "|" + cwlRosterKey;
					if (!cwlBaselinesByTagAndRoster[baselineKey]) {
						cwlBaselinesByTagAndRoster[baselineKey] = {
							tag: tag,
							rosterKey: cwlRosterKey,
							stats: sanitizePlayerWarStats_(cwlStats),
							provenance: {
								source: String(source.id || ""),
								rosterKey: cwlRosterKey,
								kind: "legacy-cwl-aggregate",
								classification: "ambiguous",
							},
						};
						classifications.ambiguous++;
					}
				}
			});
		});
	}
	const cwlReconstruction = reconstructLegacyCwlEventCandidates_(cwlSeriesByRosterKey);
	for (let i = 0; i < cwlReconstruction.candidates.length; i++) {
		candidates.push(cwlReconstruction.candidates[i]);
		classifications.reconstructed++;
	}
	for (let i = 0; i < cwlReconstruction.issues.length; i++) {
		const classification = cwlReconstruction.issues[i].classification;
		if (Object.prototype.hasOwnProperty.call(classifications, classification)) classifications[classification]++;
	}
	const deduped = dedupePlayerWarCandidates_(candidates);
	// One newest legacy CWL aggregate is retained per player and tracked clan.
	// Repeated archives for the same clan are duplicates, while aggregates from
	// distinct clans are independent history and must follow the player tag.
	// Remove safely reconstructed segments from their matching clan baseline so
	// each contribution is applied exactly once.
	const reconstructedCwlByTagAndRoster = {};
	deduped.filter(function (candidate) { return candidate.kind === "cwl"; }).forEach(function (candidate) {
		Object.keys(candidate.contributionsByTag).forEach(function (tag) {
			const key = tag + "|" + String(candidate.clanTag || candidate.rosterId || "");
			if (!reconstructedCwlByTagAndRoster[key]) reconstructedCwlByTagAndRoster[key] = createEmptyWarPerformanceStats_();
			addSignedPlayerWarStats_(reconstructedCwlByTagAndRoster[key], candidate.contributionsByTag[tag].stats, 1);
		});
	});
	Object.keys(cwlBaselinesByTagAndRoster).sort().forEach(function (baselineKey) {
		const evidence = cwlBaselinesByTagAndRoster[baselineKey];
		let residual = sanitizePlayerWarStats_(evidence.stats);
		const reconstructed = reconstructedCwlByTagAndRoster[baselineKey];
		if (reconstructed) {
			const subtracted = subtractMonotonicPlayerWarStats_(residual, reconstructed);
			if (subtracted) residual = subtracted;
		}
		if (!hasPlayerWarStats_(residual)) return;
		if (!baselinesByTag[evidence.tag]) {
			baselinesByTag[evidence.tag] = {
				regular: createEmptyWarPerformanceStats_(),
				cwl: createEmptyWarPerformanceStats_(),
				provenance: [],
			};
		}
		const baseline = baselinesByTag[evidence.tag];
		if (!baseline.cwlByRosterKey || typeof baseline.cwlByRosterKey !== "object") baseline.cwlByRosterKey = {};
		baseline.cwlByRosterKey[evidence.rosterKey] = residual;
		addSignedPlayerWarStats_(baseline.cwl, residual, 1);
		baseline.provenance.push(evidence.provenance);
	});
	Object.keys(baselinesByTag).forEach(function (tag) {
		const baseline = baselinesByTag[tag];
		if (!hasPlayerWarStats_(baseline.regular) && !hasPlayerWarStats_(baseline.cwl)) delete baselinesByTag[tag];
	});
	const migrationId = "pwt-" + hashPlayerWarValue_({
		checksumVersion: PLAYER_WAR_MIGRATION_CHECKSUM_VERSION,
		sourceFingerprints: sourceFingerprints,
		candidates: deduped,
		baselinesByTag: baselinesByTag,
	}).slice(0, 20);
	const plan = {
		schemaVersion: PLAYER_WAR_TRACKING_SCHEMA_VERSION,
		checksumVersion: PLAYER_WAR_MIGRATION_CHECKSUM_VERSION,
		migrationId: migrationId,
		createdAt: String(options.createdAt || new Date().toISOString()),
		sourceFingerprints: sourceFingerprints,
		sourceFingerprint: hashPlayerWarValue_(sourceFingerprints),
		candidates: deduped,
		baselinesByTag: baselinesByTag,
		report: {
			sourceCount: sources.length,
			eventCandidateCount: candidates.length,
			deduplicatedEventCount: deduped.length,
			reconstructedCwlSegmentCount: cwlReconstruction.candidates.length,
			baselinePlayerCount: Object.keys(baselinesByTag).length,
			classifications: classifications,
			cwlReconstructionIssues: cwlReconstruction.issues,
			warnings: classifications.ambiguous || classifications.partial || classifications.unrecoverable
				? ["Legacy CWL aggregates are preserved as explicit baselines unless a single monotonic archive segment proves one war; no per-war CWL events were fabricated without that evidence."]
				: [],
		},
	};
	plan.checksum = calculatePlayerWarMigrationChecksum_(plan);
	return plan;
}

function applyPlayerWarMigrationBaselines_(storeRaw, baselinesByTagRaw) {
	const store = storeRaw && typeof storeRaw === "object" ? storeRaw : createEmptyPlayerWarPerformanceStore_();
	const baselines = baselinesByTagRaw && typeof baselinesByTagRaw === "object" ? baselinesByTagRaw : {};
	Object.keys(baselines).sort().forEach(function (tagRaw) {
		const tag = normalizeTag_(tagRaw);
		if (!tag) return;
		const baseline = baselines[tagRaw] && typeof baselines[tagRaw] === "object" ? baselines[tagRaw] : {};
		const entry = ensureGlobalPlayerWarEntry_(store, tag);
		addSignedPlayerWarStats_(entry.regular, baseline.regular, 1);
		addSignedPlayerWarStats_(entry.cwl, baseline.cwl, 1);
		addSignedPlayerWarStats_(entry.overall, baseline.regular, 1);
		addSignedPlayerWarStats_(entry.overall, baseline.cwl, 1);
		entry.meta.baselineCount = toNonNegativeInt_(entry.meta.baselineCount) + 1;
		entry.meta.provenance = "migration-baseline+event-ledger";
		store.meta.baselineCount = toNonNegativeInt_(store.meta.baselineCount) + 1;
	});
	return store;
}

function executePlayerWarMigrationPlan_(planRaw, optionsRaw) {
	const plan = planRaw && typeof planRaw === "object" ? planRaw : {};
	if (!plan.migrationId || plan.checksum !== calculatePlayerWarMigrationChecksum_(plan)) {
		throw new Error("Player-war migration checksum mismatch.");
	}
	let store = createEmptyPlayerWarPerformanceStore_({
		stage: optionsRaw && optionsRaw.stage,
		migrationId: plan.migrationId,
		sourceFingerprint: plan.sourceFingerprint,
		provenance: "migration",
	});
	store = applyPlayerWarMigrationBaselines_(store, plan.baselinesByTag);
	const finalized = finalizePlayerWarEventCandidates_(store, plan.candidates, optionsRaw);
	finalized.store.meta.migrationId = plan.migrationId;
	finalized.store.meta.sourceFingerprint = plan.sourceFingerprint;
	finalized.store.meta.provenance = "migration+event-ledger";
	finalized.store = sanitizePlayerWarPerformanceStore_(finalized.store, { stage: optionsRaw && optionsRaw.stage });
	return finalized;
}

function readPlayerWarMigrationArchiveSources_(pathRaw, kindRaw, limitRaw) {
	const path = String(pathRaw || "");
	const kind = String(kindRaw || "archive");
	const limit = Math.max(0, Math.min(20, toNonNegativeInt_(limitRaw) || 8));
	const keys = listFirebaseChildKeys_(path).slice().sort().reverse().slice(0, limit);
	const sources = [];
	for (let i = 0; i < keys.length; i++) {
		const encoded = firebaseRequestJson_(buildFirebaseChildPath_(path, keys[i]), "GET");
		if (!encoded || typeof encoded !== "object" || Array.isArray(encoded)) continue;
		const decoded = decodeFirebaseObjectKeysRecursive_(encoded);
		const rosterData = decoded && decoded.rosterData && typeof decoded.rosterData === "object"
			? decoded.rosterData
			: decoded;
		if (!rosterData || !Array.isArray(rosterData.rosters)) continue;
		sources.push({ id: kind + ":" + String(keys[i]), kind: kind, rosterData: rosterData });
	}
	return sources;
}

// Discover active data plus retained archives without modifying any source.
function discoverPlayerWarTrackingMigrationSources_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const active = readActiveRosterSnapshot_();
	const sources = [{
		id: "active:" + String(active.versionId || "legacy"),
		kind: "active",
		rosterData: active.rosterData,
	}];
	const publishSources = readPlayerWarMigrationArchiveSources_(
		typeof FIREBASE_ARCHIVE_PUBLISH_PATH === "string" ? FIREBASE_ARCHIVE_PUBLISH_PATH : "archive/publish",
		"publish",
		options.archiveLimit,
	);
	const autoSources = readPlayerWarMigrationArchiveSources_(
		typeof FIREBASE_ARCHIVE_AUTOREFRESH_DAILY_PATH === "string" ? FIREBASE_ARCHIVE_AUTOREFRESH_DAILY_PATH : "archive/autorefreshDaily",
		"autorefresh",
		options.archiveLimit,
	);
	Array.prototype.push.apply(sources, publishSources);
	Array.prototype.push.apply(sources, autoSources);
	return {
		activeVersionId: String(active.versionId || ""),
		sources: sources,
		sourceInventory: sources.map(function (source) {
			return { id: source.id, kind: source.kind, fingerprint: hashPlayerWarValue_(source.rosterData) };
		}),
	};
}

function dryRunPlayerWarTrackingMigration_(optionsRaw) {
	const discovery = discoverPlayerWarTrackingMigrationSources_(optionsRaw);
	const plan = buildPlayerWarTrackingMigrationPlan_(discovery.sources, optionsRaw);
	return {
		ok: true,
		dryRun: true,
		activeVersionId: discovery.activeVersionId,
		migrationId: plan.migrationId,
		checksum: plan.checksum,
		sourceFingerprint: plan.sourceFingerprint,
		sourceInventory: discovery.sourceInventory,
		report: plan.report,
	};
}

function buildPlayerWarMigrationStageStorageKey_(migrationIdRaw, checksumRaw, legacyRaw) {
	const migrationId = String(migrationIdRaw || "").trim();
	const checksum = String(checksumRaw || "").trim();
	return legacyRaw === true
		? migrationId
		: migrationId + "-" + checksum.slice(0, 16);
}

function buildPlayerWarMigrationStagePath_(migrationIdRaw, checksumRaw, legacyRaw) {
	return buildFirebaseChildPath_(
		PLAYER_WAR_MIGRATION_PATH,
		"staged",
		encodeFirebaseObjectKey_(buildPlayerWarMigrationStageStorageKey_(migrationIdRaw, checksumRaw, legacyRaw)),
	);
}

function stagePlayerWarTrackingMigration_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const discovery = discoverPlayerWarTrackingMigrationSources_(options);
	const plan = buildPlayerWarTrackingMigrationPlan_(discovery.sources, options);
	const path = buildPlayerWarMigrationStagePath_(plan.migrationId, plan.checksum, false);
	const existing = decodeFirebaseObjectKeysRecursive_(firebaseRequestJson_(path, "GET"));
	if (existing && existing.checksum && existing.checksum !== plan.checksum) {
		throw new Error("A staged migration with this id has a different checksum.");
	}
	const staged = {
		status: "staged",
		stagedAt: new Date().toISOString(),
		activeVersionId: discovery.activeVersionId,
		sourceInventory: discovery.sourceInventory,
		migrationId: plan.migrationId,
		checksum: plan.checksum,
		plan: plan,
	};
	firebaseRequestJson_(path, "PUT", encodeFirebaseObjectKeysRecursive_(staged));
	return {
		ok: true,
		staged: true,
		migrationId: plan.migrationId,
		checksum: plan.checksum,
		stageStorageKey: buildPlayerWarMigrationStageStorageKey_(plan.migrationId, plan.checksum, false),
		activeVersionId: discovery.activeVersionId,
		report: plan.report,
	};
}

function commitPlayerWarTrackingMigration_(requestRaw) {
	const request = requestRaw && typeof requestRaw === "object" ? requestRaw : {};
	const migrationId = String(request.migrationId || "").trim();
	const checksum = String(request.checksum || "").trim();
	if (!migrationId || !checksum) throw new Error("Explicit migrationId and checksum are required.");
	let stagePath = buildPlayerWarMigrationStagePath_(migrationId, checksum, false);
	let staged = decodeFirebaseObjectKeysRecursive_(firebaseRequestJson_(stagePath, "GET"));
	if (!staged) {
		stagePath = buildPlayerWarMigrationStagePath_(migrationId, checksum, true);
		staged = decodeFirebaseObjectKeysRecursive_(firebaseRequestJson_(stagePath, "GET"));
	}
	if (!staged || staged.status !== "staged" || staged.checksum !== checksum || !staged.plan) {
		throw new Error("Matching staged player-war migration was not found.");
	}
	const activeVersionId = readPublishedActiveVersionId_();
	if (String(staged.activeVersionId || "") !== String(activeVersionId || "")) {
		throw new Error("Active version changed after staging; run a new dry-run and stage.");
	}
	const active = readActiveRosterSnapshotFromVersion_(activeVersionId);
	const currentFingerprint = hashPlayerWarValue_(active.rosterData);
	const activeInventory = Array.isArray(staged.sourceInventory)
		? staged.sourceInventory.find(function (source) { return source.kind === "active"; })
		: null;
	if (activeInventory && activeInventory.fingerprint !== currentFingerprint) {
		throw new Error("Active source fingerprint changed after staging.");
	}
	const stage = normalizePlayerWarTrackingStage_(request.stage || "shadow");
	const migrationCandidates = dedupePlayerWarCandidates_(staged.plan.candidates);
	const migrationLedgerPaths = migrationCandidates.map(function (candidate) {
		return buildPlayerWarLedgerEventPath_(candidate.eventId);
	});
	const migrationEncodedByPath = migrationLedgerPaths.length
		? firebaseBatchGetJson_(migrationLedgerPaths, { disableFallback: true })
		: {};
	const migrationExistingByEventId = {};
	for (let i = 0; i < migrationCandidates.length; i++) {
		const decoded = decodeFirebaseObjectKeysRecursive_(migrationEncodedByPath[migrationLedgerPaths[i]]);
		if (decoded && typeof decoded === "object") migrationExistingByEventId[migrationCandidates[i].eventId] = decoded;
	}
	const execution = executePlayerWarMigrationPlan_(staged.plan, {
		persist: false,
		collectLedgerWrites: true,
		rebuildFromResolvedEvents: true,
		existingRecordsByEventId: migrationExistingByEventId,
		stage: stage,
	});
	const migrationWrites = Array.isArray(execution.ledgerWrites) ? execution.ledgerWrites.slice() : [];
	migrationWrites.push(
		{
			path: PLAYER_WAR_PERFORMANCE_CURRENT_PATH,
			method: "PUT",
			payload: encodeFirebaseObjectKeysRecursive_(execution.store),
		},
		{
			path: buildFirebaseChildPath_(PLAYER_WAR_LEDGER_PATH, "meta"),
			method: "PUT",
			payload: encodeFirebaseObjectKeysRecursive_({
				schemaVersion: PLAYER_WAR_EVENT_SCHEMA_VERSION,
				shardCount: PLAYER_WAR_LEDGER_SHARD_COUNT,
				updatedAt: execution.store.updatedAt,
				eventCount: toNonNegativeInt_(execution.store.meta && execution.store.meta.eventCount),
				conflictCount: toNonNegativeInt_(execution.store.meta && execution.store.meta.conflictCount),
			}),
		},
	);
	firebaseBatchPutJson_(migrationWrites, { disableFallback: true });
	const nextRosterData = validateRosterData_(Object.assign({}, active.rosterData, {
		playerWarPerformance: execution.store,
	}));
	const versionId = createActiveVersionId_("player-war-migration");
	const written = writeActiveRosterVersionShards_(versionId, nextRosterData, {
		source: "player-war-migration",
		sourceVersionId: activeVersionId,
		publishedAt: new Date().toISOString(),
		publish: false,
	});
	validateActiveVersionRequiredShards_(versionId, written.manifest);
	publishActiveRosterVersionPointer_(versionId, written.manifest);
	setPlayerWarTrackingStage_(stage);
	clearActiveRosterDataCache_();
	const queueResult = enqueueCloudflareActiveTarget_(versionId, "player-war-migration");
	const committed = {
		status: "committed",
		committedAt: new Date().toISOString(),
		migrationId: migrationId,
		checksum: checksum,
		previousVersionId: activeVersionId,
		versionId: versionId,
		stage: stage,
		acceptedEventCount: execution.acceptedCount,
	};
	firebaseRequestJson_(
		buildFirebaseChildPath_(PLAYER_WAR_MIGRATION_PATH, "committed", encodeFirebaseObjectKey_(migrationId)),
		"PUT",
		encodeFirebaseObjectKeysRecursive_(committed),
	);
	firebaseRequestJson_(stagePath, "PATCH", encodeFirebaseObjectKeysRecursive_({ status: "committed", committedAt: committed.committedAt, versionId: versionId }));
	return Object.assign({ ok: true, queueResult: queueResult }, committed);
}

function rollbackPlayerWarTrackingMigration_(requestRaw) {
	const request = requestRaw && typeof requestRaw === "object" ? requestRaw : {};
	const migrationId = String(request.migrationId || "").trim();
	if (!migrationId) throw new Error("Migration id is required for rollback.");
	const commitPath = buildFirebaseChildPath_(PLAYER_WAR_MIGRATION_PATH, "committed", encodeFirebaseObjectKey_(migrationId));
	const committed = decodeFirebaseObjectKeysRecursive_(firebaseRequestJson_(commitPath, "GET"));
	if (!committed || !committed.previousVersionId) throw new Error("Committed migration rollback metadata was not found.");
	const previousVersionId = normalizeActiveVersionId_(committed.previousVersionId);
	const encodedManifest = firebaseRequestJson_(buildActiveVersionPath_(previousVersionId, "manifest"), "GET");
	const manifest = decodeFirebaseObjectKeysRecursive_(encodedManifest);
	if (!manifest || typeof manifest !== "object") throw new Error("Previous active version manifest is unavailable.");
	validateActiveVersionRequiredShards_(previousVersionId, manifest);
	const previousSnapshot = readActiveRosterSnapshotFromVersion_(previousVersionId);
	const previousPerformance = previousSnapshot.rosterData && previousSnapshot.rosterData.playerWarPerformance
		? sanitizePlayerWarPerformanceStore_(previousSnapshot.rosterData.playerWarPerformance, { stage: "legacy" })
		: createEmptyPlayerWarPerformanceStore_({ stage: "legacy", provenance: "migration-rollback" });
	firebaseRequestJson_(PLAYER_WAR_PERFORMANCE_CURRENT_PATH, "PUT", encodeFirebaseObjectKeysRecursive_(previousPerformance));
	publishActiveRosterVersionPointer_(previousVersionId, manifest);
	setPlayerWarTrackingStage_("legacy");
	clearActiveRosterDataCache_();
	const queueResult = enqueueCloudflareActiveTarget_(previousVersionId, "player-war-migration-rollback");
	firebaseRequestJson_(commitPath, "PATCH", encodeFirebaseObjectKeysRecursive_({
		rolledBackAt: new Date().toISOString(),
		rollbackVersionId: previousVersionId,
	}));
	return { ok: true, rolledBack: true, migrationId: migrationId, versionId: previousVersionId, queueResult: queueResult };
}

// Publish a new immutable generation when changing rollout stage so Firebase,
// Cloudflare, browsers, and authenticated bot readers all observe the same
// schema/stage pair. Updating a Script Property alone would create a mixed
// generation during cutover.
function publishPlayerWarTrackingStageVersion_(stageRaw) {
	const stage = normalizePlayerWarTrackingStage_(stageRaw);
	const active = readActiveRosterSnapshot_();
	const current = active.rosterData && active.rosterData.playerWarPerformance;
	if (!current || typeof current !== "object") {
		if (stage !== "legacy") throw new Error("Player-war migration must be committed before enabling " + stage + ".");
		setPlayerWarTrackingStage_(stage);
		return { ok: true, stage: stage, versionId: String(active.versionId || ""), published: false };
	}
	const performance = sanitizePlayerWarPerformanceStore_(current, { stage: stage });
	performance.stage = stage;
	performance.updatedAt = new Date().toISOString();
	performance.meta = Object.assign({}, performance.meta, {
		lastStageTransitionAt: performance.updatedAt,
	});
	const nextRosterData = validateRosterData_(Object.assign({}, active.rosterData, {
		playerWarPerformance: sanitizePlayerWarPerformanceStore_(performance, { stage: stage }),
	}));
	const versionId = createActiveVersionId_("player-war-" + stage);
	const written = writeActiveRosterVersionShards_(versionId, nextRosterData, {
		source: "player-war-stage-" + stage,
		sourceVersionId: active.versionId,
		publishedAt: new Date().toISOString(),
		publish: false,
	});
	validateActiveVersionRequiredShards_(versionId, written.manifest);
	firebaseRequestJson_(PLAYER_WAR_PERFORMANCE_CURRENT_PATH, "PUT", encodeFirebaseObjectKeysRecursive_(nextRosterData.playerWarPerformance));
	publishActiveRosterVersionPointer_(versionId, written.manifest);
	setPlayerWarTrackingStage_(stage);
	clearActiveRosterDataCache_();
	const queueResult = enqueueCloudflareActiveTarget_(versionId, "player-war-stage-" + stage);
	return {
		ok: true,
		stage: stage,
		previousVersionId: String(active.versionId || ""),
		versionId: versionId,
		published: true,
		queueResult: queueResult,
	};
}

function inspectPlayerWarTracking_(optionsRaw) {
	const active = readActiveRosterSnapshot_();
	const store = active.rosterData && active.rosterData.playerWarPerformance
		? sanitizePlayerWarPerformanceStore_(active.rosterData.playerWarPerformance)
		: null;
	const shadow = store ? buildPlayerWarShadowComparison_(active.rosterData, store) : null;
	return {
		ok: true,
		activeVersionId: String(active.versionId || ""),
		stage: store ? store.stage : getPlayerWarTrackingStage_(),
		schemaVersion: store ? store.schemaVersion : 0,
		playerCount: store ? Object.keys(store.byTag || {}).length : 0,
		meta: store ? store.meta : null,
		contentHash: store ? store.contentHash : "",
		shadowComparison: shadow,
		options: optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {},
	};
}
