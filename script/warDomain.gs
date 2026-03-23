// War domain models, aggregation, finalization, and repair helpers.

// Create an empty CWL stat entry.
function createEmptyCwlStatEntry_() {
	return {
		starsTotal: 0,
		daysInLineup: 0,
		resolvedWarDays: 0,
		attacksMade: 0,
		missedAttacks: 0,
		threeStarCount: 0,
		totalDestruction: 0,
		countedAttacks: 0,
		currentWarAttackPending: 0,
		hitUpCount: 0,
		hitDownCount: 0,
		sameThHitCount: 0,
	};
}

// Create an empty regular war current entry.
function createEmptyRegularWarCurrentEntry_(attacksAllowedRaw) {
	const attacksAllowed = toNonNegativeInt_(attacksAllowedRaw);
	return {
		inWar: false,
		mapPosition: null,
		townHallLevel: 0,
		attacksAllowed: attacksAllowed,
		attacksUsed: 0,
		attacksRemaining: attacksAllowed,
		starsTotal: 0,
		totalDestruction: 0,
		countedAttacks: 0,
		threeStarCount: 0,
		opponentAttacks: 0,
		missedAttacks: 0,
		hitUpCount: 0,
		sameThHitCount: 0,
		hitDownCount: 0,
	};
}

// Create an empty regular war aggregate entry.
function createEmptyRegularWarAggregateEntry_() {
	return {
		warsInLineup: 0,
		attacksMade: 0,
		attacksMissed: 0,
		starsTotal: 0,
		totalDestruction: 0,
		countedAttacks: 0,
		threeStarCount: 0,
		hitUpCount: 0,
		sameThHitCount: 0,
		hitDownCount: 0,
	};
}

// Sanitize regular war current entry.
function sanitizeRegularWarCurrentEntry_(entryRaw, attacksAllowedRaw) {
	const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
	const out = createEmptyRegularWarCurrentEntry_(entry.attacksAllowed != null ? entry.attacksAllowed : attacksAllowedRaw);
	out.inWar = toBooleanFlag_(entry.inWar);
	out.mapPosition = entry.mapPosition == null ? null : toNonNegativeInt_(entry.mapPosition);
	out.townHallLevel = toNonNegativeInt_(entry.townHallLevel);
	out.attacksAllowed = toNonNegativeInt_(entry.attacksAllowed != null ? entry.attacksAllowed : attacksAllowedRaw);
	out.attacksUsed = toNonNegativeInt_(entry.attacksUsed);
	out.attacksRemaining = toNonNegativeInt_(entry.attacksRemaining != null ? entry.attacksRemaining : Math.max(0, out.attacksAllowed - out.attacksUsed));
	out.starsTotal = toNonNegativeInt_(entry.starsTotal);
	out.totalDestruction = toNonNegativeInt_(entry.totalDestruction);
	out.countedAttacks = toNonNegativeInt_(entry.countedAttacks);
	out.threeStarCount = toNonNegativeInt_(entry.threeStarCount);
	out.opponentAttacks = toNonNegativeInt_(entry.opponentAttacks);
	out.missedAttacks = toNonNegativeInt_(entry.missedAttacks);
	out.hitUpCount = toNonNegativeInt_(entry.hitUpCount);
	out.sameThHitCount = toNonNegativeInt_(entry.sameThHitCount);
	out.hitDownCount = toNonNegativeInt_(entry.hitDownCount);
	return out;
}

// Sanitize regular war aggregate entry.
function sanitizeRegularWarAggregateEntry_(entryRaw) {
	const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
	const out = createEmptyRegularWarAggregateEntry_();
	out.warsInLineup = toNonNegativeInt_(entry.warsInLineup);
	out.attacksMade = toNonNegativeInt_(entry.attacksMade);
	out.attacksMissed = toNonNegativeInt_(entry.attacksMissed);
	out.starsTotal = toNonNegativeInt_(entry.starsTotal);
	out.totalDestruction = toNonNegativeInt_(entry.totalDestruction);
	out.countedAttacks = toNonNegativeInt_(entry.countedAttacks);
	out.threeStarCount = toNonNegativeInt_(entry.threeStarCount);
	out.hitUpCount = toNonNegativeInt_(entry.hitUpCount);
	out.sameThHitCount = toNonNegativeInt_(entry.sameThHitCount);
	out.hitDownCount = toNonNegativeInt_(entry.hitDownCount);
	return out;
}

// Create an empty war-performance stats entry.
function createEmptyWarPerformanceStats_() {
	return {
		warsInLineup: 0,
		daysInLineup: 0,
		resolvedWarDays: 0,
		attacksMade: 0,
		attacksMissed: 0,
		starsTotal: 0,
		totalDestruction: 0,
		countedAttacks: 0,
		threeStarCount: 0,
		hitUpCount: 0,
		sameThHitCount: 0,
		hitDownCount: 0,
	};
}

// Create an empty war performance entry.
function createEmptyWarPerformanceEntry_() {
	return {
		overall: createEmptyWarPerformanceStats_(),
		regular: createEmptyWarPerformanceStats_(),
		cwl: createEmptyWarPerformanceStats_(),
	};
}

// Create an empty regular war membership entry.
function createEmptyRegularWarMembershipEntry_() {
	return {
		firstSeenAt: "",
		lastSeenAt: "",
		missingSince: "",
		status: "active",
	};
}

// Create an empty regular war lifecycle state.
function createEmptyRegularWarLifecycleState_() {
	return {
		activeWarKey: "",
		activeWarState: "notinwar",
		activeWarLastSeenAt: "",
		lastFinalizedWarKey: "",
		lastFinalizedAt: "",
		lastFinalizationSource: "",
		lastFinalizationIncomplete: false,
	};
}

// Sanitize war performance stats entry.
function sanitizeWarPerformanceStatsEntry_(entryRaw) {
	const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
	const out = createEmptyWarPerformanceStats_();
	out.warsInLineup = toNonNegativeInt_(entry.warsInLineup);
	out.daysInLineup = toNonNegativeInt_(entry.daysInLineup);
	out.resolvedWarDays = toNonNegativeInt_(entry.resolvedWarDays);
	out.attacksMade = toNonNegativeInt_(entry.attacksMade);
	out.attacksMissed = toNonNegativeInt_(entry.attacksMissed);
	out.starsTotal = toNonNegativeInt_(entry.starsTotal);
	out.totalDestruction = toNonNegativeInt_(entry.totalDestruction);
	out.countedAttacks = toNonNegativeInt_(entry.countedAttacks);
	out.threeStarCount = toNonNegativeInt_(entry.threeStarCount);
	out.hitUpCount = toNonNegativeInt_(entry.hitUpCount);
	out.sameThHitCount = toNonNegativeInt_(entry.sameThHitCount);
	out.hitDownCount = toNonNegativeInt_(entry.hitDownCount);
	return out;
}

// Sanitize war performance entry.
function sanitizeWarPerformanceEntry_(entryRaw) {
	const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
	const out = createEmptyWarPerformanceEntry_();
	out.overall = sanitizeWarPerformanceStatsEntry_(entry.overall);
	out.regular = sanitizeWarPerformanceStatsEntry_(entry.regular);
	out.cwl = sanitizeWarPerformanceStatsEntry_(entry.cwl);
	return out;
}

// Sanitize regular war lifecycle state.
function sanitizeRegularWarLifecycleState_(rawState) {
	const state = rawState && typeof rawState === "object" ? rawState : {};
	return {
		activeWarKey: String(state.activeWarKey == null ? "" : state.activeWarKey).trim(),
		activeWarState:
			String(state.activeWarState == null ? "" : state.activeWarState)
				.trim()
				.toLowerCase() || "notinwar",
		activeWarLastSeenAt: typeof state.activeWarLastSeenAt === "string" ? state.activeWarLastSeenAt : "",
		lastFinalizedWarKey: String(state.lastFinalizedWarKey == null ? "" : state.lastFinalizedWarKey).trim(),
		lastFinalizedAt: typeof state.lastFinalizedAt === "string" ? state.lastFinalizedAt : "",
		lastFinalizationSource: typeof state.lastFinalizationSource === "string" ? state.lastFinalizationSource : "",
		lastFinalizationIncomplete: toBooleanFlag_(state.lastFinalizationIncomplete),
	};
}

// Sanitize war performance meta.
function sanitizeWarPerformanceMeta_(rawMeta) {
	const meta = rawMeta && typeof rawMeta === "object" ? rawMeta : {};
	const out = {};
	const keys = Object.keys(meta);
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		const value = meta[key];
		if (typeof value === "string") out[key] = value;
		else if (typeof value === "boolean") out[key] = value;
		else if (typeof value === "number" && isFinite(value)) out[key] = Math.floor(value);
	}

	out.finalizedRegularWarCount = toNonNegativeInt_(meta.finalizedRegularWarCount != null ? meta.finalizedRegularWarCount : out.finalizedRegularWarCount);
	out.finalizedCwlWarCount = toNonNegativeInt_(meta.finalizedCwlWarCount != null ? meta.finalizedCwlWarCount : out.finalizedCwlWarCount);
	out.regularWarLegacyBaselineWarCount = toNonNegativeInt_(meta.regularWarLegacyBaselineWarCount != null ? meta.regularWarLegacyBaselineWarCount : out.regularWarLegacyBaselineWarCount);
	out.lastFinalizationReason = typeof meta.lastFinalizationReason === "string" ? meta.lastFinalizationReason : String(out.lastFinalizationReason || "");
	out.lastFinalizationSource = typeof meta.lastFinalizationSource === "string" ? meta.lastFinalizationSource : String(out.lastFinalizationSource || "");
	out.lastSuccessfulLongTermFinalizationAt = typeof meta.lastSuccessfulLongTermFinalizationAt === "string" ? meta.lastSuccessfulLongTermFinalizationAt : String(out.lastSuccessfulLongTermFinalizationAt || "");
	out.lastRegularWarFinalizedAt = typeof meta.lastRegularWarFinalizedAt === "string" ? meta.lastRegularWarFinalizedAt : String(out.lastRegularWarFinalizedAt || "");
	out.lastRegularWarFinalizationSource = typeof meta.lastRegularWarFinalizationSource === "string" ? meta.lastRegularWarFinalizationSource : String(out.lastRegularWarFinalizationSource || "");
	out.lastRegularWarFinalizationReason = typeof meta.lastRegularWarFinalizationReason === "string" ? meta.lastRegularWarFinalizationReason : String(out.lastRegularWarFinalizationReason || "");
	out.lastRegularWarFinalizationWarKey = typeof meta.lastRegularWarFinalizationWarKey === "string" ? meta.lastRegularWarFinalizationWarKey : String(out.lastRegularWarFinalizationWarKey || "");
	out.lastRegularWarFinalizationIncomplete = toBooleanFlag_(meta.lastRegularWarFinalizationIncomplete != null ? meta.lastRegularWarFinalizationIncomplete : out.lastRegularWarFinalizationIncomplete);
	out.lastRegularWarFinalizationAttemptAt = typeof meta.lastRegularWarFinalizationAttemptAt === "string" ? meta.lastRegularWarFinalizationAttemptAt : String(out.lastRegularWarFinalizationAttemptAt || "");
	out.lastRegularWarFinalizationStatus = typeof meta.lastRegularWarFinalizationStatus === "string" ? meta.lastRegularWarFinalizationStatus : String(out.lastRegularWarFinalizationStatus || "");
	out.unresolvedRegularWarCount = toNonNegativeInt_(meta.unresolvedRegularWarCount != null ? meta.unresolvedRegularWarCount : out.unresolvedRegularWarCount);
	out.pendingRegularWarRepairCount = toNonNegativeInt_(meta.pendingRegularWarRepairCount != null ? meta.pendingRegularWarRepairCount : out.pendingRegularWarRepairCount);
	out.oldestUnresolvedRegularWarAt = typeof meta.oldestUnresolvedRegularWarAt === "string" ? meta.oldestUnresolvedRegularWarAt : String(out.oldestUnresolvedRegularWarAt || "");
	out.lastRegularWarRepairAttemptAt = typeof meta.lastRegularWarRepairAttemptAt === "string" ? meta.lastRegularWarRepairAttemptAt : String(out.lastRegularWarRepairAttemptAt || "");
	out.lastRegularWarRepairSuccessAt = typeof meta.lastRegularWarRepairSuccessAt === "string" ? meta.lastRegularWarRepairSuccessAt : String(out.lastRegularWarRepairSuccessAt || "");
	const statusLevelRaw = String(meta.regularWarStatusLevel == null ? "" : meta.regularWarStatusLevel)
		.trim()
		.toLowerCase();
	out.regularWarStatusLevel = statusLevelRaw === "warning" || statusLevelRaw === "info" ? statusLevelRaw : "";
	out.regularWarStatusMessage = typeof meta.regularWarStatusMessage === "string" ? meta.regularWarStatusMessage : String(out.regularWarStatusMessage || "");
	out.lastCwlWarFinalizedAt = typeof meta.lastCwlWarFinalizedAt === "string" ? meta.lastCwlWarFinalizedAt : String(out.lastCwlWarFinalizedAt || "");
	out.lastCwlWarFinalizedTag = typeof meta.lastCwlWarFinalizedTag === "string" ? meta.lastCwlWarFinalizedTag : String(out.lastCwlWarFinalizedTag || "");
	return out;
}

// Create an empty regular war history entry.
function createEmptyRegularWarHistoryEntry_(warKeyRaw) {
	const warKey = String(warKeyRaw == null ? "" : warKeyRaw).trim();
	return {
		warKey: warKey,
		finalizedAt: "",
		lastUpdatedAt: "",
		source: "",
		reason: "",
		incomplete: false,
		authoritative: false,
		firstIncompleteAt: "",
		lastRepairAttemptAt: "",
		repairedAt: "",
		statsByTag: {},
	};
}

// Sanitize regular war history stats by tag.
function sanitizeRegularWarHistoryStatsByTag_(statsByTagRaw) {
	const statsByTag = statsByTagRaw && typeof statsByTagRaw === "object" ? statsByTagRaw : {};
	const out = {};
	const keys = Object.keys(statsByTag);
	for (let i = 0; i < keys.length; i++) {
		const tag = normalizeTag_(keys[i]);
		if (!tag) continue;
		const stats = sanitizeWarPerformanceStatsEntry_(statsByTag[keys[i]]);
		if (!hasWarPerformanceStatsData_(stats)) continue;
		out[tag] = stats;
	}
	return out;
}

// Sanitize regular war history entry.
function sanitizeRegularWarHistoryEntry_(entryRaw, warKeyRaw) {
	const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
	const fallbackWarKey = String(warKeyRaw == null ? "" : warKeyRaw).trim();
	const warKey = String(entry.warKey == null ? fallbackWarKey : entry.warKey).trim();
	if (!warKey) return null;

	const out = createEmptyRegularWarHistoryEntry_(warKey);
	out.finalizedAt = typeof entry.finalizedAt === "string" ? entry.finalizedAt : "";
	out.lastUpdatedAt = typeof entry.lastUpdatedAt === "string" ? entry.lastUpdatedAt : "";
	out.source = typeof entry.source === "string" ? entry.source : "";
	out.reason = typeof entry.reason === "string" ? entry.reason : "";
	out.incomplete = toBooleanFlag_(entry.incomplete);
	out.authoritative = toBooleanFlag_(entry.authoritative);
	if (out.authoritative) out.incomplete = false;
	out.firstIncompleteAt = typeof entry.firstIncompleteAt === "string" ? entry.firstIncompleteAt : "";
	out.lastRepairAttemptAt = typeof entry.lastRepairAttemptAt === "string" ? entry.lastRepairAttemptAt : "";
	out.repairedAt = typeof entry.repairedAt === "string" ? entry.repairedAt : "";
	out.statsByTag = sanitizeRegularWarHistoryStatsByTag_(entry.statsByTag);
	if (!out.lastUpdatedAt) out.lastUpdatedAt = out.finalizedAt;
	if (out.incomplete && !out.firstIncompleteAt) out.firstIncompleteAt = out.finalizedAt || out.lastUpdatedAt;
	return out;
}

// Sanitize regular war history by key.
function sanitizeRegularWarHistoryByKey_(historyRaw) {
	const history = historyRaw && typeof historyRaw === "object" ? historyRaw : {};
	const out = {};
	const keys = Object.keys(history);
	for (let i = 0; i < keys.length; i++) {
		const key = String(keys[i] == null ? "" : keys[i]).trim();
		if (!key) continue;
		const sanitized = sanitizeRegularWarHistoryEntry_(history[key], key);
		if (!sanitized) continue;
		out[sanitized.warKey] = sanitized;
	}
	return out;
}

// Sanitize regular war legacy baseline by tag.
function sanitizeRegularWarLegacyBaselineByTag_(baselineRaw) {
	const baseline = baselineRaw && typeof baselineRaw === "object" ? baselineRaw : {};
	const out = {};
	const keys = Object.keys(baseline);
	for (let i = 0; i < keys.length; i++) {
		const tag = normalizeTag_(keys[i]);
		if (!tag) continue;
		const stats = sanitizeWarPerformanceStatsEntry_(baseline[keys[i]]);
		if (!hasWarPerformanceStatsData_(stats)) continue;
		out[tag] = stats;
	}
	return out;
}

// Sanitize regular war snapshot.
function sanitizeRegularWarSnapshot_(rawSnapshot) {
	const snapshot = rawSnapshot && typeof rawSnapshot === "object" ? rawSnapshot : null;
	if (!snapshot) return null;

	const warMeta = sanitizeRegularWarCurrentWar_(snapshot.warMeta && typeof snapshot.warMeta === "object" ? snapshot.warMeta : snapshot);
	if (!warMeta || !warMeta.warKey) return null;

	const statsByTagRaw = snapshot.statsByTag && typeof snapshot.statsByTag === "object" ? snapshot.statsByTag : {};
	const statsByTag = {};
	const statTags = Object.keys(statsByTagRaw);
	for (let i = 0; i < statTags.length; i++) {
		const tag = normalizeTag_(statTags[i]);
		if (!tag) continue;
		statsByTag[tag] = sanitizeWarPerformanceStatsEntry_(statsByTagRaw[statTags[i]]);
	}

	const currentByTagRaw = snapshot.currentByTag && typeof snapshot.currentByTag === "object" ? snapshot.currentByTag : {};
	const currentByTag = {};
	const currentTags = Object.keys(currentByTagRaw);
	for (let i = 0; i < currentTags.length; i++) {
		const tag = normalizeTag_(currentTags[i]);
		if (!tag) continue;
		currentByTag[tag] = sanitizeRegularWarCurrentEntry_(currentByTagRaw[currentTags[i]], warMeta.attacksPerMember);
	}

	return {
		warMeta: warMeta,
		capturedAt: typeof snapshot.capturedAt === "string" ? snapshot.capturedAt : "",
		isFinal: toBooleanFlag_(snapshot.isFinal),
		isComplete: snapshot.isComplete == null ? true : toBooleanFlag_(snapshot.isComplete),
		source: typeof snapshot.source === "string" ? snapshot.source : "",
		statsByTag: statsByTag,
		currentByTag: currentByTag,
	};
}

// Sanitize roster war performance.
function sanitizeRosterWarPerformance_(rawWarPerformance) {
	if (rawWarPerformance == null) return null;
	const warPerformance = rawWarPerformance && typeof rawWarPerformance === "object" ? rawWarPerformance : {};
	const byTagRaw = warPerformance.byTag && typeof warPerformance.byTag === "object" ? warPerformance.byTag : {};
	const byTag = {};
	const tagKeys = Object.keys(byTagRaw);
	for (let i = 0; i < tagKeys.length; i++) {
		const tag = normalizeTag_(tagKeys[i]);
		if (!tag) continue;
		byTag[tag] = sanitizeWarPerformanceEntry_(byTagRaw[tagKeys[i]]);
	}

	const processedRegularWarKeysRaw = warPerformance.processedRegularWarKeys && typeof warPerformance.processedRegularWarKeys === "object" ? warPerformance.processedRegularWarKeys : {};
	const processedRegularWarKeys = {};
	const regularWarKeys = Object.keys(processedRegularWarKeysRaw);
	for (let i = 0; i < regularWarKeys.length; i++) {
		const key = String(regularWarKeys[i] == null ? "" : regularWarKeys[i]).trim();
		if (!key) continue;
		processedRegularWarKeys[key] = true;
	}

	const processedCwlWarTagsRaw = warPerformance.processedCwlWarTags && typeof warPerformance.processedCwlWarTags === "object" ? warPerformance.processedCwlWarTags : {};
	const processedCwlWarTags = {};
	const cwlWarTags = Object.keys(processedCwlWarTagsRaw);
	for (let i = 0; i < cwlWarTags.length; i++) {
		const tag = normalizeTag_(cwlWarTags[i]);
		if (!tag) continue;
		processedCwlWarTags[tag] = true;
	}

	const regularWarHistoryByKeyRaw =
		warPerformance.regularWarHistoryByKey && typeof warPerformance.regularWarHistoryByKey === "object" ? warPerformance.regularWarHistoryByKey : {};
	const regularWarHistoryByKey = sanitizeRegularWarHistoryByKey_(regularWarHistoryByKeyRaw);
	const regularWarLegacyBaselineByTagRaw =
		warPerformance.regularWarLegacyBaselineByTag && typeof warPerformance.regularWarLegacyBaselineByTag === "object" ? warPerformance.regularWarLegacyBaselineByTag : {};
	const regularWarLegacyBaselineByTag = sanitizeRegularWarLegacyBaselineByTag_(regularWarLegacyBaselineByTagRaw);

	const meta = sanitizeWarPerformanceMeta_(warPerformance.meta);
	if (!meta.lastFinalizationReason && typeof warPerformance.lastFinalizationReason === "string") {
		meta.lastFinalizationReason = warPerformance.lastFinalizationReason;
	}
	if (!meta.lastFinalizationSource && typeof warPerformance.lastFinalizationSource === "string") {
		meta.lastFinalizationSource = warPerformance.lastFinalizationSource;
	}
	const membershipByTagRaw = warPerformance.membershipByTag && typeof warPerformance.membershipByTag === "object" ? warPerformance.membershipByTag : {};
	const membershipByTag = {};
	const membershipKeys = Object.keys(membershipByTagRaw);
	for (let i = 0; i < membershipKeys.length; i++) {
		const tag = normalizeTag_(membershipKeys[i]);
		if (!tag) continue;
		membershipByTag[tag] = sanitizeRegularWarMembershipEntry_(membershipByTagRaw[membershipKeys[i]]);
	}

	const lifecycleRaw = warPerformance.regularWarLifecycle && typeof warPerformance.regularWarLifecycle === "object" ? warPerformance.regularWarLifecycle : {};
	const lifecycle = sanitizeRegularWarLifecycleState_(lifecycleRaw);
	const snapshot = sanitizeRegularWarSnapshot_(warPerformance.lastRegularWarSnapshot);
	return {
		lastRefreshedAt: typeof warPerformance.lastRefreshedAt === "string" ? warPerformance.lastRefreshedAt : "",
		lastFinalizedAt: typeof warPerformance.lastFinalizedAt === "string" ? warPerformance.lastFinalizedAt : "",
		lastFinalizationReason: typeof meta.lastFinalizationReason === "string" ? meta.lastFinalizationReason : "",
		lastFinalizationSource: typeof meta.lastFinalizationSource === "string" ? meta.lastFinalizationSource : "",
		processedRegularWarKeys: processedRegularWarKeys,
		processedCwlWarTags: processedCwlWarTags,
		regularWarLegacyBaselineByTag: regularWarLegacyBaselineByTag,
		regularWarHistoryByKey: regularWarHistoryByKey,
		byTag: byTag,
		membershipByTag: membershipByTag,
		meta: meta,
		regularWarLifecycle: lifecycle,
		lastRegularWarSnapshot: snapshot,
	};
}

// Create an empty roster war performance.
function createEmptyRosterWarPerformance_() {
	return {
		lastRefreshedAt: "",
		lastFinalizedAt: "",
		lastFinalizationReason: "",
		lastFinalizationSource: "",
		processedRegularWarKeys: {},
		processedCwlWarTags: {},
		regularWarLegacyBaselineByTag: {},
		regularWarHistoryByKey: {},
		lastRegularWarSnapshot: null,
		byTag: {},
		membershipByTag: {},
		meta: sanitizeWarPerformanceMeta_(null),
		regularWarLifecycle: createEmptyRegularWarLifecycleState_(),
	};
}

// Ensure war performance.
function ensureWarPerformance_(roster) {
	if (!roster || typeof roster !== "object") return null;
	const next = sanitizeRosterWarPerformance_(roster.warPerformance) || createEmptyRosterWarPerformance_();
	if (!next.processedRegularWarKeys || typeof next.processedRegularWarKeys !== "object") next.processedRegularWarKeys = {};
	if (!next.processedCwlWarTags || typeof next.processedCwlWarTags !== "object") next.processedCwlWarTags = {};
	if (!next.regularWarLegacyBaselineByTag || typeof next.regularWarLegacyBaselineByTag !== "object") next.regularWarLegacyBaselineByTag = {};
	if (!next.regularWarHistoryByKey || typeof next.regularWarHistoryByKey !== "object") next.regularWarHistoryByKey = {};
	if (!next.byTag || typeof next.byTag !== "object") next.byTag = {};
	if (!next.membershipByTag || typeof next.membershipByTag !== "object") next.membershipByTag = {};
	if (!next.meta || typeof next.meta !== "object") next.meta = sanitizeWarPerformanceMeta_(null);
	if (!next.regularWarLifecycle || typeof next.regularWarLifecycle !== "object") next.regularWarLifecycle = createEmptyRegularWarLifecycleState_();
	next.lastRegularWarSnapshot = sanitizeRegularWarSnapshot_(next.lastRegularWarSnapshot);
	return next;
}

// Return whether war performance stats data.
function hasWarPerformanceStatsData_(statsRaw) {
	const stats = sanitizeWarPerformanceStatsEntry_(statsRaw);
	return (
		stats.warsInLineup > 0 ||
		stats.daysInLineup > 0 ||
		stats.resolvedWarDays > 0 ||
		stats.attacksMade > 0 ||
		stats.attacksMissed > 0 ||
		stats.starsTotal > 0 ||
		stats.totalDestruction > 0 ||
		stats.countedAttacks > 0 ||
		stats.threeStarCount > 0 ||
		stats.hitUpCount > 0 ||
		stats.sameThHitCount > 0 ||
		stats.hitDownCount > 0
	);
}

// Map regular aggregate to war performance stats.
function mapRegularAggregateToWarPerformanceStats_(aggregateRaw) {
	const aggregate = sanitizeRegularWarAggregateEntry_(aggregateRaw);
	const out = createEmptyWarPerformanceStats_();
	out.warsInLineup = aggregate.warsInLineup;
	out.attacksMade = aggregate.attacksMade;
	out.attacksMissed = aggregate.attacksMissed;
	out.starsTotal = aggregate.starsTotal;
	out.totalDestruction = aggregate.totalDestruction;
	out.countedAttacks = aggregate.countedAttacks;
	out.threeStarCount = aggregate.threeStarCount;
	out.hitUpCount = aggregate.hitUpCount;
	out.sameThHitCount = aggregate.sameThHitCount;
	out.hitDownCount = aggregate.hitDownCount;
	return out;
}

// Build regular war legacy baseline from war performance by tag.
function buildRegularWarLegacyBaselineFromWarPerformanceByTag_(warPerformanceRaw) {
	const warPerformance = warPerformanceRaw && typeof warPerformanceRaw === "object" ? warPerformanceRaw : {};
	const byTagRaw = warPerformance.byTag && typeof warPerformance.byTag === "object" ? warPerformance.byTag : {};
	const out = {};
	const tags = Object.keys(byTagRaw);
	for (let i = 0; i < tags.length; i++) {
		const tag = normalizeTag_(tags[i]);
		if (!tag) continue;
		const entry = byTagRaw[tags[i]] && typeof byTagRaw[tags[i]] === "object" ? byTagRaw[tags[i]] : {};
		const regularStats = sanitizeWarPerformanceStatsEntry_(entry.regular);
		if (!hasWarPerformanceStatsData_(regularStats)) continue;
		out[tag] = regularStats;
	}
	return out;
}

// Build regular war legacy baseline from regular war compat.
function buildRegularWarLegacyBaselineFromRegularWarCompat_(regularWarRaw) {
	const regularWar = regularWarRaw && typeof regularWarRaw === "object" ? regularWarRaw : {};
	const byTagRaw = regularWar.byTag && typeof regularWar.byTag === "object" ? regularWar.byTag : {};
	const out = {};
	const tags = Object.keys(byTagRaw);
	for (let i = 0; i < tags.length; i++) {
		const tag = normalizeTag_(tags[i]);
		if (!tag) continue;
		const compatEntry = byTagRaw[tags[i]] && typeof byTagRaw[tags[i]] === "object" ? byTagRaw[tags[i]] : {};
		const mapped = mapRegularAggregateToWarPerformanceStats_(compatEntry.aggregate);
		if (!hasWarPerformanceStatsData_(mapped)) continue;
		out[tag] = mapped;
	}
	return out;
}

// Ensure regular war legacy baseline.
function ensureRegularWarLegacyBaseline_(warPerformanceRaw, regularWarRaw) {
	const warPerformance = warPerformanceRaw && typeof warPerformanceRaw === "object" ? warPerformanceRaw : null;
	if (!warPerformance) return { changed: false, baselineByTag: {} };

	const existingBaseline = sanitizeRegularWarLegacyBaselineByTag_(warPerformance.regularWarLegacyBaselineByTag);
	if (Object.keys(existingBaseline).length > 0) {
		warPerformance.regularWarLegacyBaselineByTag = existingBaseline;
		return { changed: false, baselineByTag: existingBaseline };
	}

	const historyByKey = sanitizeRegularWarHistoryByKey_(warPerformance.regularWarHistoryByKey);
	let baselineByTag = {};
	if (Object.keys(historyByKey).length < 1) {
		baselineByTag = buildRegularWarLegacyBaselineFromWarPerformanceByTag_(warPerformance);
		if (Object.keys(baselineByTag).length < 1) {
			baselineByTag = buildRegularWarLegacyBaselineFromRegularWarCompat_(regularWarRaw);
		}
	}

	warPerformance.regularWarLegacyBaselineByTag = baselineByTag;
	const meta = sanitizeWarPerformanceMeta_(warPerformance.meta);
	const baselineWarCount = toNonNegativeInt_(meta.regularWarLegacyBaselineWarCount);
	const legacyFinalizedCount = toNonNegativeInt_(meta.finalizedRegularWarCount);
	const regularWarCompat = regularWarRaw && typeof regularWarRaw === "object" ? regularWarRaw : {};
	const compatAggregateMeta = regularWarCompat.aggregateMeta && typeof regularWarCompat.aggregateMeta === "object" ? regularWarCompat.aggregateMeta : {};
	const compatWarsTracked = toNonNegativeInt_(compatAggregateMeta.warsTracked);
	if (baselineWarCount < 1 && Object.keys(baselineByTag).length > 0) {
		const legacyCountSeed = legacyFinalizedCount > 0 ? legacyFinalizedCount : compatWarsTracked;
		if (legacyCountSeed > 0) meta.regularWarLegacyBaselineWarCount = legacyCountSeed;
	}
	warPerformance.meta = meta;
	return { changed: true, baselineByTag: baselineByTag };
}

// Summarize regular war history state.
function summarizeRegularWarHistoryState_(warPerformanceRaw, nowIsoRaw) {
	const warPerformance = warPerformanceRaw && typeof warPerformanceRaw === "object" ? warPerformanceRaw : {};
	const nowIso = typeof nowIsoRaw === "string" && nowIsoRaw ? nowIsoRaw : new Date().toISOString();
	const nowMs = parseIsoToMs_(nowIso) || Date.now();
	const historyByKey = sanitizeRegularWarHistoryByKey_(warPerformance.regularWarHistoryByKey);
	const keys = Object.keys(historyByKey).sort();
	let unresolvedIncompleteWarCount = 0;
	let pendingRecentRepairCount = 0;
	let oldestUnresolvedMs = 0;
	let lastRepairAttemptMs = 0;
	let lastRepairSuccessMs = 0;
	let latestFinalizedMs = 0;

	for (let i = 0; i < keys.length; i++) {
		const entry = historyByKey[keys[i]];
		const finalizedMs = parseIsoToMs_(entry.finalizedAt);
		if (finalizedMs > latestFinalizedMs) latestFinalizedMs = finalizedMs;
		const repairAttemptMs = parseIsoToMs_(entry.lastRepairAttemptAt);
		if (repairAttemptMs > lastRepairAttemptMs) lastRepairAttemptMs = repairAttemptMs;
		const repairedMs = parseIsoToMs_(entry.repairedAt);
		if (repairedMs > lastRepairSuccessMs) lastRepairSuccessMs = repairedMs;
		if (!entry.incomplete) continue;
		unresolvedIncompleteWarCount++;
		const firstIncompleteMs = parseIsoToMs_(entry.firstIncompleteAt || entry.finalizedAt || entry.lastUpdatedAt);
		if (!oldestUnresolvedMs || (firstIncompleteMs > 0 && firstIncompleteMs < oldestUnresolvedMs)) {
			oldestUnresolvedMs = firstIncompleteMs;
		}
		if (!(firstIncompleteMs > 0) || nowMs - firstIncompleteMs <= REGULAR_WAR_REPAIR_GRACE_MS) {
			pendingRecentRepairCount++;
		}
	}

	const staleUnresolvedWarCount = Math.max(0, unresolvedIncompleteWarCount - pendingRecentRepairCount);
	let statusLevel = "";
	let statusMessage = "";
	if (unresolvedIncompleteWarCount > 0) {
		if (staleUnresolvedWarCount > 0) {
			statusLevel = "warning";
			statusMessage =
				staleUnresolvedWarCount === 1
					? "1 regular war is still using provisional history data; aggregate regular-war totals may be slightly incomplete."
					: staleUnresolvedWarCount + " regular wars are still using provisional history data; aggregate regular-war totals may be slightly incomplete.";
			if (pendingRecentRepairCount > 0) {
				statusMessage +=
					" " +
					(pendingRecentRepairCount === 1
						? "1 recent war is still in the verification window."
						: pendingRecentRepairCount + " recent wars are still in the verification window.");
			}
		} else {
			statusLevel = "info";
			// Keep pending-repair states quiet in player-facing UI; only stale unresolved states should warn.
			statusMessage = "";
		}
	}

	return {
		historyCount: keys.length,
		unresolvedIncompleteWarCount: unresolvedIncompleteWarCount,
		pendingRecentRepairCount: pendingRecentRepairCount,
		staleUnresolvedWarCount: staleUnresolvedWarCount,
		oldestUnresolvedIncompleteAt: oldestUnresolvedMs > 0 ? new Date(oldestUnresolvedMs).toISOString() : "",
		lastRepairAttemptAt: lastRepairAttemptMs > 0 ? new Date(lastRepairAttemptMs).toISOString() : "",
		lastRepairSuccessAt: lastRepairSuccessMs > 0 ? new Date(lastRepairSuccessMs).toISOString() : "",
		latestFinalizedAt: latestFinalizedMs > 0 ? new Date(latestFinalizedMs).toISOString() : "",
		statusLevel: statusLevel,
		statusMessage: statusMessage,
	};
}

// Apply regular war history summary to meta.
function applyRegularWarHistorySummaryToMeta_(warPerformanceRaw, summaryRaw) {
	const warPerformance = warPerformanceRaw && typeof warPerformanceRaw === "object" ? warPerformanceRaw : null;
	if (!warPerformance) return sanitizeWarPerformanceMeta_(null);
	const summary = summaryRaw && typeof summaryRaw === "object" ? summaryRaw : {};
	const meta = sanitizeWarPerformanceMeta_(warPerformance.meta);
	const baselineWarCount = toNonNegativeInt_(meta.regularWarLegacyBaselineWarCount);
	meta.finalizedRegularWarCount = baselineWarCount + toNonNegativeInt_(summary.historyCount);
	meta.unresolvedRegularWarCount = toNonNegativeInt_(summary.unresolvedIncompleteWarCount);
	meta.pendingRegularWarRepairCount = toNonNegativeInt_(summary.pendingRecentRepairCount);
	meta.oldestUnresolvedRegularWarAt = String(summary.oldestUnresolvedIncompleteAt || "");
	meta.lastRegularWarRepairAttemptAt = String(summary.lastRepairAttemptAt || "");
	meta.lastRegularWarRepairSuccessAt = String(summary.lastRepairSuccessAt || "");
	meta.regularWarStatusLevel = String(summary.statusLevel || "");
	meta.regularWarStatusMessage = String(summary.statusMessage || "");
	meta.lastRegularWarFinalizationIncomplete = meta.unresolvedRegularWarCount > 0;
	if (summary.latestFinalizedAt) {
		meta.lastRegularWarFinalizedAt = String(summary.latestFinalizedAt);
	}

	const latestLongTermMs = Math.max(parseIsoToMs_(meta.lastSuccessfulLongTermFinalizationAt), parseIsoToMs_(summary.latestFinalizedAt), parseIsoToMs_(summary.lastRepairSuccessAt));
	if (latestLongTermMs > 0) {
		meta.lastSuccessfulLongTermFinalizationAt = new Date(latestLongTermMs).toISOString();
	}

	warPerformance.meta = meta;
	return meta;
}

// Build regular war aggregate meta from war performance.
function buildRegularWarAggregateMetaFromWarPerformance_(warPerformanceRaw, repairResultRaw, nowIsoRaw) {
	const warPerformance = warPerformanceRaw && typeof warPerformanceRaw === "object" ? warPerformanceRaw : {};
	const repairResult = repairResultRaw && typeof repairResultRaw === "object" ? repairResultRaw : {};
	const meta = sanitizeWarPerformanceMeta_(warPerformance.meta);
	const summary = summarizeRegularWarHistoryState_(warPerformance, nowIsoRaw);
	const unresolvedCount = toNonNegativeInt_(summary.unresolvedIncompleteWarCount);
	const warLogUnavailableReason = String(repairResult.warLogUnavailableReason == null ? "" : repairResult.warLogUnavailableReason).trim();
	return sanitizeRegularWarAggregateMeta_({
		source: "warPerformanceHistoryLedger",
		warLogAvailable: toBooleanFlag_(repairResult.warLogAvailable),
		warsTracked: toNonNegativeInt_(meta.finalizedRegularWarCount),
		lastSuccessfulWarLogRefreshAt: String(summary.lastRepairSuccessAt || meta.lastRegularWarFinalizedAt || ""),
		unavailableReason: unresolvedCount > 0 ? warLogUnavailableReason : "",
		unresolvedIncompleteWarCount: unresolvedCount,
		pendingRecentRepairCount: toNonNegativeInt_(summary.pendingRecentRepairCount),
		staleUnresolvedWarCount: toNonNegativeInt_(summary.staleUnresolvedWarCount),
		oldestUnresolvedIncompleteAt: String(summary.oldestUnresolvedIncompleteAt || ""),
		lastRepairAttemptAt: String(summary.lastRepairAttemptAt || meta.lastRegularWarRepairAttemptAt || ""),
		lastRepairSuccessAt: String(summary.lastRepairSuccessAt || meta.lastRegularWarRepairSuccessAt || ""),
		// Always derive status from current ledger summary to avoid stale sticky messages.
		statusLevel: String(summary.statusLevel || ""),
		statusMessage: String(summary.statusMessage || ""),
	});
}

// Handle hydrate war performance overall from breakdown.
function hydrateWarPerformanceOverallFromBreakdown_(entryRaw) {
	const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : null;
	if (!entry) return false;
	const currentOverall = sanitizeWarPerformanceStatsEntry_(entry.overall);
	if (hasWarPerformanceStatsData_(currentOverall)) {
		entry.overall = currentOverall;
		return false;
	}
	const mergedOverall = createEmptyWarPerformanceStats_();
	mergeWarPerformanceStats_(mergedOverall, sanitizeWarPerformanceStatsEntry_(entry.regular));
	mergeWarPerformanceStats_(mergedOverall, sanitizeWarPerformanceStatsEntry_(entry.cwl));
	if (!hasWarPerformanceStatsData_(mergedOverall)) {
		entry.overall = currentOverall;
		return false;
	}
	entry.overall = mergedOverall;
	return true;
}

// Handle rebuild regular war aggregates from history.
function rebuildRegularWarAggregatesFromHistory_(warPerformanceRaw, nowIsoRaw) {
	const warPerformance = warPerformanceRaw && typeof warPerformanceRaw === "object" ? warPerformanceRaw : null;
	if (!warPerformance) return { changed: false, summary: summarizeRegularWarHistoryState_(null, nowIsoRaw) };

	const baselineByTag = sanitizeRegularWarLegacyBaselineByTag_(warPerformance.regularWarLegacyBaselineByTag);
	const historyByKey = sanitizeRegularWarHistoryByKey_(warPerformance.regularWarHistoryByKey);
	const aggregateRegularByTag = {};
	const baselineTags = Object.keys(baselineByTag);
	for (let i = 0; i < baselineTags.length; i++) {
		const tag = normalizeTag_(baselineTags[i]);
		if (!tag) continue;
		aggregateRegularByTag[tag] = sanitizeWarPerformanceStatsEntry_(baselineByTag[baselineTags[i]]);
	}

	const warKeys = Object.keys(historyByKey).sort();
	for (let i = 0; i < warKeys.length; i++) {
		const entry = historyByKey[warKeys[i]];
		const statsByTag = entry && entry.statsByTag && typeof entry.statsByTag === "object" ? entry.statsByTag : {};
		const statTags = Object.keys(statsByTag);
		for (let j = 0; j < statTags.length; j++) {
			const tag = normalizeTag_(statTags[j]);
			if (!tag) continue;
			if (!aggregateRegularByTag[tag]) aggregateRegularByTag[tag] = createEmptyWarPerformanceStats_();
			mergeWarPerformanceStats_(aggregateRegularByTag[tag], sanitizeWarPerformanceStatsEntry_(statsByTag[statTags[j]]));
		}
	}

	const currentByTagRaw = warPerformance.byTag && typeof warPerformance.byTag === "object" ? warPerformance.byTag : {};
	const currentByTag = {};
	const currentTags = Object.keys(currentByTagRaw);
	for (let i = 0; i < currentTags.length; i++) {
		const tag = normalizeTag_(currentTags[i]);
		if (!tag) continue;
		currentByTag[tag] = sanitizeWarPerformanceEntry_(currentByTagRaw[currentTags[i]]);
	}

	const allTagSet = {};
	const aggregateTags = Object.keys(aggregateRegularByTag);
	for (let i = 0; i < aggregateTags.length; i++) allTagSet[aggregateTags[i]] = true;
	for (let i = 0; i < currentTags.length; i++) {
		const tag = normalizeTag_(currentTags[i]);
		if (!tag) continue;
		allTagSet[tag] = true;
	}

	const rebuiltByTag = {};
	const allTags = Object.keys(allTagSet);
	for (let i = 0; i < allTags.length; i++) {
		const tag = normalizeTag_(allTags[i]);
		if (!tag) continue;
		const currentEntry = currentByTag[tag] && typeof currentByTag[tag] === "object" ? currentByTag[tag] : createEmptyWarPerformanceEntry_();
		const regularStats = aggregateRegularByTag[tag] ? sanitizeWarPerformanceStatsEntry_(aggregateRegularByTag[tag]) : createEmptyWarPerformanceStats_();
		const cwlStats = sanitizeWarPerformanceStatsEntry_(currentEntry.cwl);
		const overallStats = createEmptyWarPerformanceStats_();
		mergeWarPerformanceStats_(overallStats, regularStats);
		mergeWarPerformanceStats_(overallStats, cwlStats);
		if (!hasWarPerformanceStatsData_(overallStats) && !hasWarPerformanceStatsData_(regularStats) && !hasWarPerformanceStatsData_(cwlStats)) continue;
		rebuiltByTag[tag] = {
			overall: overallStats,
			regular: regularStats,
			cwl: cwlStats,
		};
	}

	warPerformance.regularWarLegacyBaselineByTag = baselineByTag;
	warPerformance.regularWarHistoryByKey = historyByKey;
	warPerformance.byTag = rebuiltByTag;
	const summary = summarizeRegularWarHistoryState_(warPerformance, nowIsoRaw);
	applyRegularWarHistorySummaryToMeta_(warPerformance, summary);
	return { changed: true, summary: summary };
}

// Handle backfill war performance from legacy regular aggregate.
function backfillWarPerformanceFromLegacyRegularAggregate_(warPerformanceRaw, regularWarRaw) {
	const sourceWarPerformance = warPerformanceRaw && typeof warPerformanceRaw === "object" ? warPerformanceRaw : null;
	const hasLegacyCompatibilityData = Object.keys(buildRegularWarLegacyBaselineFromRegularWarCompat_(regularWarRaw)).length > 0;
	if (!sourceWarPerformance && !hasLegacyCompatibilityData) return sourceWarPerformance;

	const warPerformance = sourceWarPerformance || createEmptyRosterWarPerformance_();
	ensureRegularWarLegacyBaseline_(warPerformance, regularWarRaw);
	rebuildRegularWarAggregatesFromHistory_(warPerformance, new Date().toISOString());
	return warPerformance;
}

// Handle prepare war performance for refresh.
function prepareWarPerformanceForRefresh_(roster, nowIso) {
	if (!roster || typeof roster !== "object") return null;
	let warPerformance = ensureWarPerformance_(roster);
	ensureRegularWarLegacyBaseline_(warPerformance, roster.regularWar);
	rebuildRegularWarAggregatesFromHistory_(warPerformance, nowIso);
	roster.warPerformance = warPerformance;
	updateWarPerformanceMembership_(roster, nowIso);
	warPerformance = ensureWarPerformance_(roster);
	ensureRegularWarLegacyBaseline_(warPerformance, roster.regularWar);
	rebuildRegularWarAggregatesFromHistory_(warPerformance, nowIso);
	roster.warPerformance = warPerformance;
	return warPerformance;
}

// Merge war performance stats.
function mergeWarPerformanceStats_(dest, src) {
	if (!dest || typeof dest !== "object" || !src || typeof src !== "object") return;
	dest.warsInLineup = toNonNegativeInt_(dest.warsInLineup) + toNonNegativeInt_(src.warsInLineup);
	dest.daysInLineup = toNonNegativeInt_(dest.daysInLineup) + toNonNegativeInt_(src.daysInLineup);
	dest.resolvedWarDays = toNonNegativeInt_(dest.resolvedWarDays) + toNonNegativeInt_(src.resolvedWarDays);
	dest.attacksMade = toNonNegativeInt_(dest.attacksMade) + toNonNegativeInt_(src.attacksMade);
	dest.attacksMissed = toNonNegativeInt_(dest.attacksMissed) + toNonNegativeInt_(src.attacksMissed);
	dest.starsTotal = toNonNegativeInt_(dest.starsTotal) + toNonNegativeInt_(src.starsTotal);
	dest.totalDestruction = toNonNegativeInt_(dest.totalDestruction) + toNonNegativeInt_(src.totalDestruction);
	dest.countedAttacks = toNonNegativeInt_(dest.countedAttacks) + toNonNegativeInt_(src.countedAttacks);
	dest.threeStarCount = toNonNegativeInt_(dest.threeStarCount) + toNonNegativeInt_(src.threeStarCount);
	dest.hitUpCount = toNonNegativeInt_(dest.hitUpCount) + toNonNegativeInt_(src.hitUpCount);
	dest.sameThHitCount = toNonNegativeInt_(dest.sameThHitCount) + toNonNegativeInt_(src.sameThHitCount);
	dest.hitDownCount = toNonNegativeInt_(dest.hitDownCount) + toNonNegativeInt_(src.hitDownCount);
}

// Get war sides for clan.
function getWarSidesForClan_(warRaw, clanTagRaw) {
	const war = warRaw && typeof warRaw === "object" ? warRaw : {};
	const clanTag = normalizeTag_(clanTagRaw);
	if (!clanTag) return null;

	if (war.clan || war.opponent) {
		const side = pickWarSideForClan_(war, clanTag);
		if (!side) return null;
		return {
			side: side,
			opponentSide: getOpponentSideForClan_(war, clanTag),
			attacksPerMember: toNonNegativeInt_(war.attacksPerMember),
		};
	}

	const clanSideRaw = war.clanSide && typeof war.clanSide === "object" ? war.clanSide : null;
	const opponentSideRaw = war.opponentSide && typeof war.opponentSide === "object" ? war.opponentSide : null;
	if (!clanSideRaw && !opponentSideRaw) return null;
	const clanSideTag = normalizeTag_(clanSideRaw && clanSideRaw.tag);
	const opponentSideTag = normalizeTag_(opponentSideRaw && opponentSideRaw.tag);
	const attacksPerMember = toNonNegativeInt_(war.attacksPerMember != null ? war.attacksPerMember : war.currentWarMeta && war.currentWarMeta.attacksPerMember);
	if (clanSideTag === clanTag) return { side: clanSideRaw, opponentSide: opponentSideRaw, attacksPerMember: attacksPerMember };
	if (opponentSideTag === clanTag) return { side: opponentSideRaw, opponentSide: clanSideRaw, attacksPerMember: attacksPerMember };
	return null;
}

// Build war stats from members.
function buildWarStatsFromMembers_(membersRaw, attacksPerMemberRaw, opponentThByTagRaw, trackedTagSet, modeRaw) {
	const out = {};
	const members = Array.isArray(membersRaw) ? membersRaw : [];
	const opponentThByTag = opponentThByTagRaw && typeof opponentThByTagRaw === "object" ? opponentThByTagRaw : {};
	const mode = String(modeRaw == null ? "" : modeRaw)
		.trim()
		.toLowerCase();
	const attacksPerMember = toNonNegativeInt_(attacksPerMemberRaw);
	const useTrackedFilter = trackedTagSet && typeof trackedTagSet === "object" && Object.keys(trackedTagSet).length > 0;

	for (let i = 0; i < members.length; i++) {
		const member = members[i] && typeof members[i] === "object" ? members[i] : {};
		const tag = normalizeTag_(member.tag);
		if (!tag) continue;
		if (useTrackedFilter && !trackedTagSet[tag]) continue;
		const attacks = Array.isArray(member.attacks) ? member.attacks : [];
		const stats = createEmptyWarPerformanceStats_();
		if (mode === "cwl") {
			stats.daysInLineup = 1;
			stats.resolvedWarDays = 1;
			stats.attacksMissed = attacks.length === 0 ? 1 : 0;
		} else {
			stats.warsInLineup = 1;
			stats.attacksMissed = Math.max(0, attacksPerMember - attacks.length);
		}
		stats.attacksMade = attacks.length;
		const attackerTh = readTownHallLevel_(member);
		for (let j = 0; j < attacks.length; j++) {
			const attack = attacks[j] && typeof attacks[j] === "object" ? attacks[j] : {};
			const stars = toNonNegativeInt_(attack.stars);
			const destruction = readAttackDestruction_(attack);
			const defenderTag = normalizeTag_(attack.defenderTag);
			const defenderTh = defenderTag && Object.prototype.hasOwnProperty.call(opponentThByTag, defenderTag) ? opponentThByTag[defenderTag] : null;
			stats.starsTotal += stars;
			stats.totalDestruction += destruction;
			stats.countedAttacks++;
			if (stars === 3) stats.threeStarCount++;
			if (typeof attackerTh === "number" && isFinite(attackerTh) && typeof defenderTh === "number" && isFinite(defenderTh)) {
				if (attackerTh < defenderTh) stats.hitUpCount++;
				else if (attackerTh > defenderTh) stats.hitDownCount++;
				else stats.sameThHitCount++;
			}
		}
		out[tag] = stats;
	}
	return out;
}

// Compute regular war stats from war.
function computeRegularWarStatsFromWar_(war, clanTag, trackedTagSet) {
	const sides = getWarSidesForClan_(war, clanTag);
	if (!sides) return {};
	const opponentThByTag = buildMemberThByTag_(sides.opponentSide && sides.opponentSide.members);
	return buildWarStatsFromMembers_(sides.side && sides.side.members, sides.attacksPerMember, opponentThByTag, trackedTagSet, "regular");
}

// Compute CWL war stats from war.
function computeCwlWarStatsFromWar_(war, clanTag, trackedTagSet) {
	const sides = getWarSidesForClan_(war, clanTag);
	if (!sides) return {};
	const opponentThByTag = buildMemberThByTag_(sides.opponentSide && sides.opponentSide.members);
	return buildWarStatsFromMembers_(sides.side && sides.side.members, sides.attacksPerMember, opponentThByTag, trackedTagSet, "cwl");
}

// Get stable regular war key.
function getStableRegularWarKey_(warLikeRaw, clanTagRaw) {
	const warLike = warLikeRaw && typeof warLikeRaw === "object" ? warLikeRaw : {};
	const clanTagFallback = normalizeTag_(clanTagRaw);
	const currentWarMeta = warLike.currentWarMeta && typeof warLike.currentWarMeta === "object" ? warLike.currentWarMeta : {};
	const warMeta = warLike.warMeta && typeof warLike.warMeta === "object" ? warLike.warMeta : {};
	const directWarKey = String(warLike.warKey != null ? warLike.warKey : currentWarMeta.warKey != null ? currentWarMeta.warKey : warMeta.warKey != null ? warMeta.warKey : "").trim();

	let clanTag = normalizeTag_(warLike.clanTag || currentWarMeta.clanTag || warMeta.clanTag || clanTagFallback);
	let opponentTag = normalizeTag_(warLike.opponentTag || currentWarMeta.opponentTag || warMeta.opponentTag);

	if (!clanTag || !opponentTag) {
		const sides = getWarSidesForClan_(warLike, clanTagFallback || clanTag);
		if (sides) {
			const sideTag = normalizeTag_(sides.side && sides.side.tag);
			const opponentSideTag = normalizeTag_(sides.opponentSide && sides.opponentSide.tag);
			clanTag = clanTag || sideTag || clanTagFallback;
			opponentTag = opponentTag || opponentSideTag;
		}
	}

	const preparationStartTime = String(warLike.preparationStartTime != null ? warLike.preparationStartTime : currentWarMeta.preparationStartTime != null ? currentWarMeta.preparationStartTime : warMeta.preparationStartTime != null ? warMeta.preparationStartTime : "");
	const startTime = String(warLike.startTime != null ? warLike.startTime : currentWarMeta.startTime != null ? currentWarMeta.startTime : warMeta.startTime != null ? warMeta.startTime : "");
	const endTime = String(warLike.endTime != null ? warLike.endTime : currentWarMeta.endTime != null ? currentWarMeta.endTime : warMeta.endTime != null ? warMeta.endTime : "");
	const keySeed = preparationStartTime || startTime || endTime || "";

	if (directWarKey) {
		const parts = directWarKey.split("|");
		if (parts.length >= 3) {
			const keyClan = normalizeTag_(parts[0]) || clanTag || clanTagFallback || "";
			const keyOpponent = normalizeTag_(parts[1]) || opponentTag || "";
			const keySuffix = parts.slice(2).join("|");
			return keyClan + "|" + keyOpponent + "|" + keySuffix;
		}
	}

	return (clanTag || clanTagFallback || "") + "|" + (opponentTag || "") + "|" + keySeed;
}

// Find war log entry by war key.
function findWarLogEntryByWarKey_(clanTag, warKey, limitRaw) {
	if (!clanTag || !warKey) return null;
	const entries = fetchClanWarLog_(clanTag, limitRaw || REGULAR_WAR_WARLOG_LIMIT);
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i] && typeof entries[i] === "object" ? entries[i] : {};
		const entryWarKey = getStableRegularWarKey_(entry, clanTag);
		if (entryWarKey && entryWarKey === warKey) return entry;
	}
	return null;
}

// Handle war has member level data for clan.
function warHasMemberLevelDataForClan_(war, clanTag) {
	const sides = getWarSidesForClan_(war, clanTag);
	if (!sides) return false;
	const members = Array.isArray(sides.side && sides.side.members) ? sides.side.members : [];
	return members.length > 0;
}

// Ensure war performance player entry.
function ensureWarPerformancePlayerEntry_(warPerformance, tagRaw) {
	const tag = normalizeTag_(tagRaw);
	if (!tag || !warPerformance || typeof warPerformance !== "object") return null;
	if (!warPerformance.byTag || typeof warPerformance.byTag !== "object") warPerformance.byTag = {};
	if (!warPerformance.byTag[tag]) {
		warPerformance.byTag[tag] = createEmptyWarPerformanceEntry_();
	}
	return warPerformance.byTag[tag];
}

// Build tag set from raw.
function buildTagSetFromRaw_(tagSetRaw) {
	const tagSet = tagSetRaw && typeof tagSetRaw === "object" ? tagSetRaw : {};
	const out = {};
	const keys = Object.keys(tagSet);
	for (let i = 0; i < keys.length; i++) {
		const tag = normalizeTag_(keys[i]);
		if (!tag) continue;
		out[tag] = true;
	}
	return out;
}

// Build regular war finalize tag set.
function buildRegularWarFinalizeTagSet_(warPerformanceRaw, warKeyRaw, trackedTagSetRaw) {
	const warPerformance = warPerformanceRaw && typeof warPerformanceRaw === "object" ? warPerformanceRaw : {};
	const warKey = String(warKeyRaw == null ? "" : warKeyRaw).trim();
	const out = buildTagSetFromRaw_(trackedTagSetRaw);
	if (!warKey) return out;
	const historyByKey = sanitizeRegularWarHistoryByKey_(warPerformance.regularWarHistoryByKey);
	const existing = sanitizeRegularWarHistoryEntry_(historyByKey[warKey], warKey);
	if (!existing || !existing.statsByTag || typeof existing.statsByTag !== "object") return out;
	const tags = Object.keys(existing.statsByTag);
	for (let i = 0; i < tags.length; i++) {
		const tag = normalizeTag_(tags[i]);
		if (!tag) continue;
		out[tag] = true;
	}
	return out;
}

// Handle upsert regular war history entry.
function upsertRegularWarHistoryEntry_(warPerformanceRaw, warKeyRaw, statsByTagRaw, optionsRaw) {
	const warPerformance = warPerformanceRaw && typeof warPerformanceRaw === "object" ? warPerformanceRaw : null;
	const warKey = String(warKeyRaw == null ? "" : warKeyRaw).trim();
	if (!warPerformance || !warKey) {
		return { applied: false, warKey: warKey, repaired: false, authoritative: false, incomplete: false, reason: "invalidInput" };
	}
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const nowText = typeof options.nowIso === "string" && options.nowIso ? options.nowIso : new Date().toISOString();
	const source = String(options.source == null ? "" : options.source).trim();
	const reason = String(options.reason == null ? "" : options.reason).trim();
	const incomplete = toBooleanFlag_(options.incomplete);
	const authoritative = options.authoritative == null ? !incomplete : toBooleanFlag_(options.authoritative);

	const historyByKey = sanitizeRegularWarHistoryByKey_(warPerformance.regularWarHistoryByKey);
	const existing = sanitizeRegularWarHistoryEntry_(historyByKey[warKey], warKey);
	if (existing && existing.authoritative && !authoritative) {
		return { applied: false, warKey: warKey, repaired: false, authoritative: true, incomplete: false, reason: "authoritativeAlreadyStored" };
	}

	const sanitizedStatsByTag = sanitizeRegularWarHistoryStatsByTag_(statsByTagRaw);
	const hasIncomingStats = Object.keys(sanitizedStatsByTag).length > 0;
	if (!hasIncomingStats && !(existing && existing.statsByTag && Object.keys(existing.statsByTag).length > 0)) {
		return { applied: false, warKey: warKey, repaired: false, authoritative: authoritative, incomplete: incomplete, reason: "missingStatsByTag" };
	}

	const next = existing ? sanitizeRegularWarHistoryEntry_(existing, warKey) : createEmptyRegularWarHistoryEntry_(warKey);
	next.finalizedAt = next.finalizedAt || nowText;
	next.lastUpdatedAt = nowText;
	next.source = source || next.source;
	next.reason = reason || next.reason;
	next.incomplete = !!incomplete;
	next.authoritative = authoritative && !incomplete;
	if (next.incomplete) {
		next.firstIncompleteAt = next.firstIncompleteAt || nowText;
	} else if (!next.firstIncompleteAt && existing && existing.firstIncompleteAt) {
		next.firstIncompleteAt = existing.firstIncompleteAt;
	}
	if (toBooleanFlag_(options.recordRepairAttempt)) {
		next.lastRepairAttemptAt = nowText;
	}
	const repaired = !!(existing && existing.incomplete && next.authoritative);
	if (repaired) {
		next.repairedAt = nowText;
		next.lastRepairAttemptAt = nowText;
	} else if (existing && existing.repairedAt) {
		next.repairedAt = existing.repairedAt;
	}
	if (hasIncomingStats) {
		next.statsByTag = sanitizedStatsByTag;
	}

	historyByKey[warKey] = sanitizeRegularWarHistoryEntry_(next, warKey);
	warPerformance.regularWarHistoryByKey = historyByKey;
	rebuildRegularWarAggregatesFromHistory_(warPerformance, nowText);
	markWarPerformanceFinalization_(warPerformance, "regular", warKey, nowText, source || "regularWarFinalized", reason || source || "regularWarFinalized", next.incomplete);
	return {
		applied: true,
		warKey: warKey,
		repaired: repaired,
		authoritative: !!next.authoritative,
		incomplete: !!next.incomplete,
		reason: repaired ? "repaired" : "applied",
	};
}

// Mark regular war history repair attempt.
function markRegularWarHistoryRepairAttempt_(warPerformanceRaw, warKeyRaw, nowIsoRaw) {
	const warPerformance = warPerformanceRaw && typeof warPerformanceRaw === "object" ? warPerformanceRaw : null;
	const warKey = String(warKeyRaw == null ? "" : warKeyRaw).trim();
	if (!warPerformance || !warKey) return false;
	const nowText = typeof nowIsoRaw === "string" && nowIsoRaw ? nowIsoRaw : new Date().toISOString();
	const historyByKey = sanitizeRegularWarHistoryByKey_(warPerformance.regularWarHistoryByKey);
	const entry = sanitizeRegularWarHistoryEntry_(historyByKey[warKey], warKey);
	if (!entry || !entry.incomplete) return false;
	entry.lastRepairAttemptAt = nowText;
	entry.lastUpdatedAt = nowText;
	historyByKey[warKey] = entry;
	warPerformance.regularWarHistoryByKey = historyByKey;
	return true;
}

// Build war log entry map by war key.
function buildWarLogEntryMapByWarKey_(entriesRaw, clanTagRaw) {
	const clanTag = normalizeTag_(clanTagRaw);
	const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
	const out = {};
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i] && typeof entries[i] === "object" ? entries[i] : {};
		const warKey = getStableRegularWarKey_(entry, clanTag);
		if (!warKey || out[warKey]) continue;
		out[warKey] = entry;
	}
	return out;
}

// Record regular war finalization attempt.
function recordRegularWarFinalizationAttempt_(warPerformance, warKey, source, reason, incomplete, finalized, nowIso) {
	if (!warPerformance || typeof warPerformance !== "object") return;
	const nowText = typeof nowIso === "string" && nowIso ? nowIso : new Date().toISOString();
	const meta = sanitizeWarPerformanceMeta_(warPerformance.meta);
	meta.lastRegularWarFinalizationWarKey = String(warKey == null ? "" : warKey).trim();
	meta.lastRegularWarFinalizationSource = String(source == null ? "" : source).trim();
	meta.lastRegularWarFinalizationReason = String(reason == null ? "" : reason).trim();
	meta.lastRegularWarFinalizationIncomplete = toNonNegativeInt_(meta.unresolvedRegularWarCount) > 0;
	meta.lastRegularWarFinalizationAttemptAt = nowText;
	meta.lastRegularWarFinalizationStatus = finalized ? "finalized" : "skipped";
	if (finalized) meta.lastRegularWarFinalizedAt = nowText;
	warPerformance.meta = meta;
}

// Resolve war performance finalization target.
function resolveWarPerformanceFinalizationTarget_(modeRaw, identifierRaw) {
	const mode = String(modeRaw == null ? "" : modeRaw)
		.trim()
		.toLowerCase();
	const identifier = mode === "cwl" ? normalizeTag_(identifierRaw) : String(identifierRaw == null ? "" : identifierRaw).trim();
	return { mode: mode, identifier: identifier };
}

// Mark war performance finalization.
function markWarPerformanceFinalization_(warPerformance, modeRaw, identifierRaw, nowIso, sourceRaw, reasonRaw, incompleteFlag) {
	if (!warPerformance || typeof warPerformance !== "object") return;
	const target = resolveWarPerformanceFinalizationTarget_(modeRaw, identifierRaw);
	const mode = target.mode;
	const identifier = target.identifier;
	const nowText = typeof nowIso === "string" && nowIso ? nowIso : new Date().toISOString();
	const source = String(sourceRaw == null ? "" : sourceRaw).trim() || "finalized";
	const reason = String(reasonRaw == null ? "" : reasonRaw).trim() || source;
	const incomplete = !!incompleteFlag;

	const meta = sanitizeWarPerformanceMeta_(warPerformance.meta);
	meta.lastFinalizationReason = reason;
	meta.lastFinalizationSource = source;
	meta.lastSuccessfulLongTermFinalizationAt = nowText;
	if (mode === "regular") {
		meta.lastRegularWarFinalizedAt = nowText;
		meta.lastRegularWarFinalizationSource = source;
		meta.lastRegularWarFinalizationReason = reason;
		meta.lastRegularWarFinalizationWarKey = identifier;
		meta.lastRegularWarFinalizationIncomplete = incomplete;
	} else if (mode === "cwl") {
		meta.finalizedCwlWarCount = toNonNegativeInt_(meta.finalizedCwlWarCount) + 1;
		meta.lastCwlWarFinalizedAt = nowText;
		meta.lastCwlWarFinalizedTag = identifier;
	}
	warPerformance.meta = meta;
	warPerformance.lastFinalizedAt = nowText;
	warPerformance.lastFinalizationReason = reason;
	warPerformance.lastFinalizationSource = source;

	const lifecycle = sanitizeRegularWarLifecycleState_(warPerformance.regularWarLifecycle);
	if (mode === "regular") {
		lifecycle.lastFinalizedWarKey = identifier;
		lifecycle.lastFinalizedAt = nowText;
		lifecycle.lastFinalizationSource = source;
		lifecycle.lastFinalizationIncomplete = incomplete;
	}
	warPerformance.regularWarLifecycle = lifecycle;
}

// Apply war snapshot to long term aggregate.
function applyWarSnapshotToLongTermAggregate_(warPerformance, modeRaw, identifierRaw, statsByTagRaw, nowIso, source, reason, incomplete) {
	const target = resolveWarPerformanceFinalizationTarget_(modeRaw, identifierRaw);
	const mode = target.mode;
	if (!warPerformance || typeof warPerformance !== "object") {
		return {
			applied: false,
			identifier: "",
			mode: mode,
			reason: "invalidWarPerformance",
		};
	}
	if (mode !== "regular" && mode !== "cwl") return { applied: false, identifier: "", mode: mode, reason: "unsupportedMode" };
	const identifier = target.identifier;
	if (!identifier) return { applied: false, identifier: "", mode: mode, reason: "missingIdentifier" };

	if (mode === "regular") {
		const historyResult = upsertRegularWarHistoryEntry_(warPerformance, identifier, statsByTagRaw, {
			nowIso: nowIso,
			source: source,
			reason: reason,
			incomplete: incomplete,
			authoritative: !toBooleanFlag_(incomplete),
		});
		return {
			applied: !!historyResult.applied,
			identifier: identifier,
			mode: mode,
			reason: historyResult.reason || (historyResult.applied ? "applied" : "skipped"),
		};
	}

	if (!warPerformance.processedCwlWarTags || typeof warPerformance.processedCwlWarTags !== "object") warPerformance.processedCwlWarTags = {};
	if (warPerformance.processedCwlWarTags[identifier]) return { applied: false, identifier: identifier, mode: mode, reason: "alreadyProcessed" };

	const statsByTag = statsByTagRaw && typeof statsByTagRaw === "object" ? statsByTagRaw : {};
	const tagKeys = Object.keys(statsByTag);
	for (let i = 0; i < tagKeys.length; i++) {
		const tag = normalizeTag_(tagKeys[i]);
		if (!tag) continue;
		const stats = sanitizeWarPerformanceStatsEntry_(statsByTag[tagKeys[i]]);
		const entry = ensureWarPerformancePlayerEntry_(warPerformance, tag);
		if (!entry) continue;
		mergeWarPerformanceStats_(entry.cwl, stats);
		mergeWarPerformanceStats_(entry.overall, stats);
	}

	warPerformance.processedCwlWarTags[identifier] = true;
	markWarPerformanceFinalization_(warPerformance, mode, identifier, nowIso, source, reason, incomplete);
	return { applied: true, identifier: identifier, mode: mode, reason: "applied" };
}

// Handle finalize regular war into war performance.
function finalizeRegularWarIntoWarPerformance_(warPerformance, war, clanTag, trackedTagSet, nowIso, source, reason, incomplete) {
	const warKey = getStableRegularWarKey_(war, clanTag);
	if (!warKey) return false;
	const warStatsByTag = computeRegularWarStatsFromWar_(war, clanTag, trackedTagSet);
	const result = applyWarSnapshotToLongTermAggregate_(warPerformance, "regular", warKey, warStatsByTag, nowIso, source || "regularWarFinalized", reason || "regularWarFinalized", !!incomplete);
	return !!result.applied;
}

// Handle finalize regular war from snapshot.
function finalizeRegularWarFromSnapshot_(warPerformance, snapshotRaw, trackedTagSet, nowIso, source, reason, incomplete) {
	const snapshot = sanitizeRegularWarSnapshot_(snapshotRaw);
	if (!snapshot || !snapshot.warMeta || !snapshot.warMeta.warKey) return false;
	const statsByTagRaw = snapshot.statsByTag && typeof snapshot.statsByTag === "object" ? snapshot.statsByTag : {};
	const filteredStats = {};
	const useTrackedFilter = trackedTagSet && typeof trackedTagSet === "object" && Object.keys(trackedTagSet).length > 0;
	const tags = Object.keys(statsByTagRaw);
	for (let i = 0; i < tags.length; i++) {
		const tag = normalizeTag_(tags[i]);
		if (!tag) continue;
		if (useTrackedFilter && !trackedTagSet[tag]) continue;
		filteredStats[tag] = sanitizeWarPerformanceStatsEntry_(statsByTagRaw[tags[i]]);
	}
	const result = applyWarSnapshotToLongTermAggregate_(warPerformance, "regular", snapshot.warMeta.warKey, filteredStats, nowIso, source || "regularWarSnapshotFinalized", reason || "regularWarSnapshotFinalized", !!incomplete);
	return !!result.applied;
}

// Ingest CWL war into war performance.
function ingestCwlWarIntoWarPerformance_(warPerformance, war, warTagRaw, clanTag, trackedTagSet, nowIso, source) {
	const warTag = normalizeTag_(warTagRaw) || normalizeTag_(war && war.warTag);
	if (!warTag) return false;
	const statsByTag = computeCwlWarStatsFromWar_(war, clanTag, trackedTagSet);
	const result = applyWarSnapshotToLongTermAggregate_(warPerformance, "cwl", warTag, statsByTag, nowIso, source || "cwlWarFinalized", "cwlWarFinalized", false);
	return !!result.applied;
}

// Build regular war live snapshot.
function buildRegularWarLiveSnapshot_(currentWarRaw, clanTag, trackedTagSet, nowIso) {
	const currentWar = currentWarRaw && typeof currentWarRaw === "object" ? currentWarRaw : null;
	if (!currentWar) return null;
	const currentWarMetaRaw = currentWar.currentWarMeta && typeof currentWar.currentWarMeta === "object" ? currentWar.currentWarMeta : currentWar;
	const warMeta = sanitizeRegularWarCurrentWar_(
		Object.assign({}, currentWarMetaRaw, {
			warKey: getStableRegularWarKey_(currentWar, clanTag),
			available: currentWar.available == null ? currentWarMetaRaw.available : currentWar.available,
		}),
	);
	const state = String(warMeta.state == null ? "" : warMeta.state)
		.trim()
		.toLowerCase();
	if (state !== "preparation" && state !== "inwar" && state !== "warended") return null;

	const sides = getWarSidesForClan_(currentWar, clanTag);
	if (!sides) return null;
	const attacksPerMember = toNonNegativeInt_(warMeta.attacksPerMember != null ? warMeta.attacksPerMember : sides.attacksPerMember);
	const opponentThByTag = buildMemberThByTag_(sides.opponentSide && sides.opponentSide.members);
	const members = Array.isArray(sides.side && sides.side.members) ? sides.side.members : [];
	const statsByTag = buildWarStatsFromMembers_(members, attacksPerMember, opponentThByTag, trackedTagSet, "regular");
	if (state !== "warended") {
		const statTags = Object.keys(statsByTag);
		for (let i = 0; i < statTags.length; i++) {
			const tag = normalizeTag_(statTags[i]);
			if (!tag || !statsByTag[tag]) continue;
			statsByTag[tag].attacksMissed = 0;
		}
	}
	const currentByTag = {};
	const useTrackedFilter = trackedTagSet && typeof trackedTagSet === "object" && Object.keys(trackedTagSet).length > 0;

	for (let i = 0; i < members.length; i++) {
		const member = members[i] && typeof members[i] === "object" ? members[i] : {};
		const tag = normalizeTag_(member.tag);
		if (!tag) continue;
		if (useTrackedFilter && !trackedTagSet[tag]) continue;
		const entry = createEmptyRegularWarCurrentEntry_(attacksPerMember);
		entry.inWar = true;
		entry.mapPosition = member.mapPosition == null ? null : toNonNegativeInt_(member.mapPosition);
		entry.townHallLevel = toNonNegativeInt_(readTownHallLevel_(member));
		entry.attacksAllowed = attacksPerMember;
		const attacks = Array.isArray(member.attacks) ? member.attacks : [];
		entry.attacksUsed = attacks.length;
		entry.attacksRemaining = Math.max(0, entry.attacksAllowed - entry.attacksUsed);
		entry.opponentAttacks = toNonNegativeInt_(member.opponentAttacks);
		entry.missedAttacks = state === "warended" ? Math.max(0, entry.attacksAllowed - entry.attacksUsed) : 0;
		const attackerTh = readTownHallLevel_(member);
		for (let j = 0; j < attacks.length; j++) {
			const attack = attacks[j] && typeof attacks[j] === "object" ? attacks[j] : {};
			const stars = toNonNegativeInt_(attack.stars);
			const destruction = readAttackDestruction_(attack);
			const defenderTag = normalizeTag_(attack.defenderTag);
			const defenderTh = defenderTag && Object.prototype.hasOwnProperty.call(opponentThByTag, defenderTag) ? opponentThByTag[defenderTag] : null;
			entry.starsTotal += stars;
			entry.totalDestruction += destruction;
			entry.countedAttacks++;
			if (stars === 3) entry.threeStarCount++;
			if (typeof attackerTh === "number" && isFinite(attackerTh) && typeof defenderTh === "number" && isFinite(defenderTh)) {
				if (attackerTh < defenderTh) entry.hitUpCount++;
				else if (attackerTh > defenderTh) entry.hitDownCount++;
				else entry.sameThHitCount++;
			}
		}
		currentByTag[tag] = sanitizeRegularWarCurrentEntry_(entry, attacksPerMember);
	}

	return {
		warMeta: warMeta,
		capturedAt: typeof nowIso === "string" && nowIso ? nowIso : new Date().toISOString(),
		isFinal: state === "warended",
		isComplete: true,
		source: "currentWar",
		statsByTag: statsByTag,
		currentByTag: currentByTag,
	};
}

// Return whether finalize previous regular war.
function shouldFinalizePreviousRegularWar_(previousWarKeyRaw, currentWarKeyRaw, currentWarStateRaw) {
	const previousWarKey = String(previousWarKeyRaw == null ? "" : previousWarKeyRaw).trim();
	if (!previousWarKey) return false;
	const currentWarKey = String(currentWarKeyRaw == null ? "" : currentWarKeyRaw).trim();
	const currentWarState = String(currentWarStateRaw == null ? "" : currentWarStateRaw)
		.trim()
		.toLowerCase();
	if (currentWarKey && previousWarKey === currentWarKey && currentWarState !== "warended") return false;
	return true;
}

// Handle finalize regular war from live or fallback.
function finalizeRegularWarFromLiveOrFallback_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const warPerformance = options.warPerformance && typeof options.warPerformance === "object" ? options.warPerformance : null;
	if (!warPerformance) return { attempted: false, finalized: false, source: "", incomplete: false, reason: "missingWarPerformance" };
	const previousWarKey = String(options.previousWarKey == null ? "" : options.previousWarKey).trim();
	if (!previousWarKey) return { attempted: false, finalized: false, source: "", incomplete: false, reason: "missingPreviousWarKey" };
	const nowIso = typeof options.nowIso === "string" && options.nowIso ? options.nowIso : new Date().toISOString();
	const trackedTagSet = options.trackedTagSet && typeof options.trackedTagSet === "object" ? options.trackedTagSet : {};
	const clanTag = normalizeTag_(options.clanTag);
	const currentWar = options.currentWar && typeof options.currentWar === "object" ? options.currentWar : null;
	const currentWarMeta = sanitizeRegularWarCurrentWar_(options.currentWarMeta);
	const previousSnapshot = sanitizeRegularWarSnapshot_(options.previousSnapshot);
	const finalizationTagSet = buildRegularWarFinalizeTagSet_(warPerformance, previousWarKey, trackedTagSet);

	if (currentWar && currentWarMeta.warKey === previousWarKey && String(currentWarMeta.state || "").toLowerCase() === "warended" && warHasMemberLevelDataForClan_(currentWar, clanTag)) {
		const finalized = finalizeRegularWarIntoWarPerformance_(warPerformance, currentWar, clanTag, finalizationTagSet, nowIso, "currentWarEnded", "directCurrentWarEnded", false);
		recordRegularWarFinalizationAttempt_(warPerformance, previousWarKey, "currentWarEnded", "directCurrentWarEnded", false, finalized, nowIso);
		return { attempted: true, finalized: finalized, source: "currentWarEnded", incomplete: false, reason: finalized ? "directCurrentWarEnded" : "directCurrentWarEndedSkipped" };
	}

	let warLogEntry = null;
	let warLogLookupFailed = false;
	try {
		warLogEntry = findWarLogEntryByWarKey_(clanTag, previousWarKey, REGULAR_WAR_WARLOG_LIMIT);
	} catch (err) {
		warLogLookupFailed = true;
	}
	if (warLogEntry && warHasMemberLevelDataForClan_(warLogEntry, clanTag)) {
		const finalized = finalizeRegularWarIntoWarPerformance_(warPerformance, warLogEntry, clanTag, finalizationTagSet, nowIso, "targetedWarLog", "targetedWarLogFallback", false);
		recordRegularWarFinalizationAttempt_(warPerformance, previousWarKey, "targetedWarLog", "targetedWarLogFallback", false, finalized, nowIso);
		return { attempted: true, finalized: finalized, source: "targetedWarLog", incomplete: false, reason: finalized ? "targetedWarLogFallback" : "targetedWarLogFallbackSkipped" };
	}

	if (previousSnapshot && previousSnapshot.warMeta && previousSnapshot.warMeta.warKey === previousWarKey) {
		const fallbackReason = warLogEntry ? "warLogMissingMemberDetail_snapshotFallback" : warLogLookupFailed ? "warLogLookupFailed_snapshotFallback" : "snapshotFallbackNoFinalData";
		const finalized = finalizeRegularWarFromSnapshot_(warPerformance, previousSnapshot, finalizationTagSet, nowIso, "liveSnapshotFallback", fallbackReason, true);
		recordRegularWarFinalizationAttempt_(warPerformance, previousWarKey, "liveSnapshotFallback", fallbackReason, true, finalized, nowIso);
		return { attempted: true, finalized: finalized, source: "liveSnapshotFallback", incomplete: true, reason: fallbackReason };
	}
	if (warLogLookupFailed) {
		recordRegularWarFinalizationAttempt_(warPerformance, previousWarKey, "warLogLookupFailed", "warLogLookupFailed_noSnapshot", true, false, nowIso);
		return { attempted: true, finalized: false, source: "warLogLookupFailed", incomplete: true, reason: "warLogLookupFailed_noSnapshot" };
	}

	recordRegularWarFinalizationAttempt_(warPerformance, previousWarKey, "noFinalData", "noFinalDataAvailable", true, false, nowIso);
	return { attempted: true, finalized: false, source: "noFinalData", incomplete: true, reason: "noFinalDataAvailable" };
}

// Try to finalize previous regular war.
function tryFinalizePreviousRegularWar_(optionsRaw) {
	return finalizeRegularWarFromLiveOrFallback_(optionsRaw);
}

// Handle attempt repair incomplete regular war history.
function attemptRepairIncompleteRegularWarHistory_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const warPerformance = options.warPerformance && typeof options.warPerformance === "object" ? options.warPerformance : null;
	if (!warPerformance) {
		return {
			attemptedWarCount: 0,
			repairedWarCount: 0,
			warLogAvailable: false,
			warLogUnavailableReason: "",
			errorCount: 0,
			summary: summarizeRegularWarHistoryState_(null, options.nowIso),
		};
	}

	const nowIso = typeof options.nowIso === "string" && options.nowIso ? options.nowIso : new Date().toISOString();
	const clanTag = normalizeTag_(options.clanTag);
	const trackedTagSet = buildTagSetFromRaw_(options.trackedTagSet);
	const historyByKey = sanitizeRegularWarHistoryByKey_(warPerformance.regularWarHistoryByKey);
	const unresolvedWarKeys = Object.keys(historyByKey)
		.filter((warKey) => {
			const entry = sanitizeRegularWarHistoryEntry_(historyByKey[warKey], warKey);
			return !!(entry && entry.incomplete);
		})
		.sort();

	if (!unresolvedWarKeys.length) {
		rebuildRegularWarAggregatesFromHistory_(warPerformance, nowIso);
		return {
			attemptedWarCount: 0,
			repairedWarCount: 0,
			warLogAvailable: false,
			warLogUnavailableReason: "",
			errorCount: 0,
			summary: summarizeRegularWarHistoryState_(warPerformance, nowIso),
		};
	}

	let warLogEntries = [];
	let warLogAvailable = false;
	let warLogUnavailableReason = "";
	const errors = [];
	if (clanTag) {
		try {
			warLogEntries = fetchClanWarLog_(clanTag, REGULAR_WAR_WARLOG_LIMIT);
			warLogAvailable = true;
		} catch (err) {
			if (isPrivateWarLogError_(err)) {
				warLogUnavailableReason = "privateWarLog";
			} else {
				warLogUnavailableReason = "warLogLookupFailed";
				errors.push(errorMessage_(err));
			}
		}
	}
	const warLogByKey = warLogAvailable ? buildWarLogEntryMapByWarKey_(warLogEntries, clanTag) : {};
	let repairedWarCount = 0;
	let attemptedWarCount = 0;

	for (let i = 0; i < unresolvedWarKeys.length; i++) {
		const warKey = unresolvedWarKeys[i];
		attemptedWarCount++;
		markRegularWarHistoryRepairAttempt_(warPerformance, warKey, nowIso);
		if (!warLogAvailable) continue;
		const warLogEntry = Object.prototype.hasOwnProperty.call(warLogByKey, warKey) ? warLogByKey[warKey] : null;
		if (!warLogEntry || !warHasMemberLevelDataForClan_(warLogEntry, clanTag)) continue;
		const repairTagSet = buildRegularWarFinalizeTagSet_(warPerformance, warKey, trackedTagSet);
		const repaired = finalizeRegularWarIntoWarPerformance_(warPerformance, warLogEntry, clanTag, repairTagSet, nowIso, "repairWarLog", "repairFromWarLog", false);
		if (repaired) repairedWarCount++;
	}

	rebuildRegularWarAggregatesFromHistory_(warPerformance, nowIso);
	return {
		attemptedWarCount: attemptedWarCount,
		repairedWarCount: repairedWarCount,
		warLogAvailable: warLogAvailable,
		warLogUnavailableReason: warLogUnavailableReason,
		errorCount: errors.length,
		errors: errors,
		summary: summarizeRegularWarHistoryState_(warPerformance, nowIso),
	};
}

// Ensure tracked war membership.
function ensureTrackedWarMembership_(warPerformance, activeTagSetRaw, nowIso) {
	if (!warPerformance || typeof warPerformance !== "object") return;
	const activeTagSet = activeTagSetRaw && typeof activeTagSetRaw === "object" ? activeTagSetRaw : {};
	const nowText = typeof nowIso === "string" && nowIso ? nowIso : new Date().toISOString();
	const membershipByTag = warPerformance.membershipByTag && typeof warPerformance.membershipByTag === "object" ? warPerformance.membershipByTag : {};
	const allTags = Object.assign({}, membershipByTag, activeTagSet);
	for (const rawTag in allTags) {
		if (!Object.prototype.hasOwnProperty.call(allTags, rawTag)) continue;
		const tag = normalizeTag_(rawTag);
		if (!tag) continue;
		const entry = sanitizeRegularWarMembershipEntry_(membershipByTag[tag]);
		const isActive = !!activeTagSet[tag];
		if (!entry.firstSeenAt) entry.firstSeenAt = nowText;
		if (isActive) {
			entry.status = "active";
			entry.lastSeenAt = nowText;
			entry.missingSince = "";
		} else {
			if (entry.status !== "temporaryMissing") {
				entry.status = "temporaryMissing";
				entry.missingSince = nowText;
			} else if (!(parseIsoToMs_(entry.missingSince) > 0)) {
				entry.missingSince = nowText;
			}
		}
		membershipByTag[tag] = entry;
	}
	warPerformance.membershipByTag = membershipByTag;
}

// Mark tracked member missing.
function markTrackedMemberMissing_(warPerformance, missingTagSetRaw, nowIso) {
	if (!warPerformance || typeof warPerformance !== "object") return;
	const missingTagSet = missingTagSetRaw && typeof missingTagSetRaw === "object" ? missingTagSetRaw : {};
	const nowText = typeof nowIso === "string" && nowIso ? nowIso : new Date().toISOString();
	const membershipByTag = warPerformance.membershipByTag && typeof warPerformance.membershipByTag === "object" ? warPerformance.membershipByTag : {};
	const tags = Object.keys(missingTagSet);
	for (let i = 0; i < tags.length; i++) {
		const tag = normalizeTag_(tags[i]);
		if (!tag) continue;
		const entry = sanitizeRegularWarMembershipEntry_(membershipByTag[tag]);
		if (!entry.firstSeenAt) entry.firstSeenAt = nowText;
		if (!(parseIsoToMs_(entry.missingSince) > 0)) entry.missingSince = nowText;
		entry.status = "temporaryMissing";
		membershipByTag[tag] = entry;
	}
	warPerformance.membershipByTag = membershipByTag;
}

// Prune expired tracked war members.
function pruneExpiredTrackedWarMembers_(warPerformance, nowIso) {
	if (!warPerformance || typeof warPerformance !== "object") return [];
	const membershipByTag = warPerformance.membershipByTag && typeof warPerformance.membershipByTag === "object" ? warPerformance.membershipByTag : {};
	const nowMs = parseIsoToMs_(nowIso) || Date.now();
	const removedTags = [];
	for (const rawTag in membershipByTag) {
		if (!Object.prototype.hasOwnProperty.call(membershipByTag, rawTag)) continue;
		const tag = normalizeTag_(rawTag);
		if (!tag) continue;
		const entry = sanitizeRegularWarMembershipEntry_(membershipByTag[rawTag]);
		if (entry.status !== "temporaryMissing") continue;
		const missingSinceMs = parseIsoToMs_(entry.missingSince);
		if (!(missingSinceMs > 0) || nowMs - missingSinceMs < REGULAR_WAR_MISSING_GRACE_MS) continue;
		delete membershipByTag[rawTag];
		if (warPerformance.byTag && Object.prototype.hasOwnProperty.call(warPerformance.byTag, tag)) {
			delete warPerformance.byTag[tag];
		}
		removedTags.push(tag);
	}
	warPerformance.membershipByTag = membershipByTag;
	return removedTags;
}

// Build roster active tag set.
function buildRosterActiveTagSet_(roster) {
	const out = {};
	const rosterObj = roster && typeof roster === "object" ? roster : {};
	const players = [].concat(Array.isArray(rosterObj.main) ? rosterObj.main : []).concat(Array.isArray(rosterObj.subs) ? rosterObj.subs : []);
	for (let i = 0; i < players.length; i++) {
		const tag = normalizeTag_(players[i] && players[i].tag);
		if (!tag) continue;
		out[tag] = true;
	}
	return out;
}

// Build roster missing tag set.
function buildRosterMissingTagSet_(roster) {
	const out = {};
	const missing = Array.isArray(roster && roster.missing) ? roster.missing : [];
	for (let i = 0; i < missing.length; i++) {
		const tag = normalizeTag_(missing[i] && missing[i].tag);
		if (!tag) continue;
		out[tag] = true;
	}
	return out;
}

// Remove roster players by tag set.
function removeRosterPlayersByTagSet_(roster, tagSetRaw) {
	if (!roster || typeof roster !== "object") return false;
	const tagSet = tagSetRaw && typeof tagSetRaw === "object" ? tagSetRaw : {};
	let changed = false;
	// Handle filter players.
	const filterPlayers = (playersRaw) => {
		const players = Array.isArray(playersRaw) ? playersRaw : [];
		const out = [];
		for (let i = 0; i < players.length; i++) {
			const player = players[i] && typeof players[i] === "object" ? players[i] : {};
			const tag = normalizeTag_(player.tag);
			if (tag && tagSet[tag]) {
				changed = true;
				continue;
			}
			out.push(player);
		}
		return out;
	};
	roster.main = filterPlayers(roster.main);
	roster.subs = filterPlayers(roster.subs);
	roster.missing = filterPlayers(roster.missing);
	return changed;
}

// Build tracked war history tag set.
function buildTrackedWarHistoryTagSet_(roster, warPerformanceRaw, nowIso) {
	const out = buildRosterPoolTagSet_(roster);
	const warPerformance = warPerformanceRaw && typeof warPerformanceRaw === "object" ? warPerformanceRaw : {};
	const membershipByTag = warPerformance.membershipByTag && typeof warPerformance.membershipByTag === "object" ? warPerformance.membershipByTag : {};
	const nowMs = parseIsoToMs_(nowIso) || Date.now();
	const tags = Object.keys(membershipByTag);
	for (let i = 0; i < tags.length; i++) {
		const tag = normalizeTag_(tags[i]);
		if (!tag) continue;
		const entry = sanitizeRegularWarMembershipEntry_(membershipByTag[tags[i]]);
		if (entry.status !== "temporaryMissing") {
			out[tag] = true;
			continue;
		}
		const missingSinceMs = parseIsoToMs_(entry.missingSince);
		if (!(missingSinceMs > 0) || nowMs - missingSinceMs < REGULAR_WAR_MISSING_GRACE_MS) out[tag] = true;
	}
	return out;
}

// Update war performance membership.
function updateWarPerformanceMembership_(roster, nowIso) {
	if (!roster || typeof roster !== "object") return;
	const warPerformance = ensureWarPerformance_(roster);
	const nowText = typeof nowIso === "string" && nowIso ? nowIso : new Date().toISOString();
	const activeTagSet = buildRosterActiveTagSet_(roster);
	const missingTagSet = buildRosterMissingTagSet_(roster);
	ensureTrackedWarMembership_(warPerformance, activeTagSet, nowText);
	markTrackedMemberMissing_(warPerformance, missingTagSet, nowText);
	const removedTags = pruneExpiredTrackedWarMembers_(warPerformance, nowText);
	const removedTagSet = {};
	for (let i = 0; i < removedTags.length; i++) {
		removedTagSet[removedTags[i]] = true;
	}
	if (Object.keys(removedTagSet).length > 0) {
		const removedFromRoster = removeRosterPlayersByTagSet_(roster, removedTagSet);
		if (removedFromRoster) {
			normalizeRosterSlots_(roster);
			clearRosterBenchSuggestions_(roster);
		}
	}
	for (let i = 0; i < removedTags.length; i++) {
		pruneTagFromRosterTrackingState_(roster, removedTags[i]);
	}
	warPerformance.lastRefreshedAt = nowText;
	roster.warPerformance = warPerformance;
}

// Sanitize regular war membership entry.
function sanitizeRegularWarMembershipEntry_(entryRaw) {
	const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
	const out = createEmptyRegularWarMembershipEntry_();
	const statusRaw = String(entry.status == null ? "" : entry.status)
		.trim()
		.toLowerCase();
	out.firstSeenAt = typeof entry.firstSeenAt === "string" ? entry.firstSeenAt : "";
	out.lastSeenAt = typeof entry.lastSeenAt === "string" ? entry.lastSeenAt : "";
	out.missingSince = typeof entry.missingSince === "string" ? entry.missingSince : "";
	out.status = statusRaw === "temporarymissing" ? "temporaryMissing" : "active";
	return out;
}

// Sanitize regular war current war.
function sanitizeRegularWarCurrentWar_(rawCurrentWar) {
	const currentWar = rawCurrentWar && typeof rawCurrentWar === "object" ? rawCurrentWar : {};
	const state = String(currentWar.state == null ? "" : currentWar.state)
		.trim()
		.toLowerCase();
	const clanTag = normalizeTag_(currentWar.clanTag);
	const opponentTag = normalizeTag_(currentWar.opponentTag);
	const preparationStartTime = typeof currentWar.preparationStartTime === "string" ? currentWar.preparationStartTime : "";
	const startTime = typeof currentWar.startTime === "string" ? currentWar.startTime : "";
	const endTime = typeof currentWar.endTime === "string" ? currentWar.endTime : "";
	const warKey = getStableRegularWarKey_(currentWar, clanTag);
	return {
		warKey: warKey,
		available: toBooleanFlag_(currentWar.available),
		state: state || "notinwar",
		teamSize: toNonNegativeInt_(currentWar.teamSize),
		attacksPerMember: toNonNegativeInt_(currentWar.attacksPerMember),
		clanTag: clanTag,
		clanName: typeof currentWar.clanName === "string" ? currentWar.clanName : "",
		opponentTag: opponentTag,
		opponentName: typeof currentWar.opponentName === "string" ? currentWar.opponentName : "",
		preparationStartTime: preparationStartTime,
		startTime: startTime,
		endTime: endTime,
		unavailableReason: typeof currentWar.unavailableReason === "string" ? currentWar.unavailableReason : "",
		statusMessage: typeof currentWar.statusMessage === "string" ? currentWar.statusMessage : "",
	};
}

// Sanitize regular war aggregate meta.
function sanitizeRegularWarAggregateMeta_(rawMeta) {
	const meta = rawMeta && typeof rawMeta === "object" ? rawMeta : {};
	const statusLevelRaw = String(meta.statusLevel == null ? "" : meta.statusLevel)
		.trim()
		.toLowerCase();
	return {
		source: typeof meta.source === "string" ? meta.source : "",
		warLogAvailable: toBooleanFlag_(meta.warLogAvailable),
		warsTracked: toNonNegativeInt_(meta.warsTracked),
		lastSuccessfulWarLogRefreshAt: typeof meta.lastSuccessfulWarLogRefreshAt === "string" ? meta.lastSuccessfulWarLogRefreshAt : "",
		unavailableReason: typeof meta.unavailableReason === "string" ? meta.unavailableReason : "",
		unresolvedIncompleteWarCount: toNonNegativeInt_(meta.unresolvedIncompleteWarCount),
		pendingRecentRepairCount: toNonNegativeInt_(meta.pendingRecentRepairCount),
		staleUnresolvedWarCount: toNonNegativeInt_(meta.staleUnresolvedWarCount),
		oldestUnresolvedIncompleteAt: typeof meta.oldestUnresolvedIncompleteAt === "string" ? meta.oldestUnresolvedIncompleteAt : "",
		lastRepairAttemptAt: typeof meta.lastRepairAttemptAt === "string" ? meta.lastRepairAttemptAt : "",
		lastRepairSuccessAt: typeof meta.lastRepairSuccessAt === "string" ? meta.lastRepairSuccessAt : "",
		statusLevel: statusLevelRaw === "warning" || statusLevelRaw === "info" ? statusLevelRaw : "",
		statusMessage: typeof meta.statusMessage === "string" ? meta.statusMessage : "",
	};
}

// Sanitize CWL stat entry.
function sanitizeCwlStatEntry_(entryRaw) {
	const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
	const resolvedWarDays = entry.resolvedWarDays != null ? toNonNegativeInt_(entry.resolvedWarDays) : toNonNegativeInt_(entry.daysInLineup);
	const out = createEmptyCwlStatEntry_();
	out.starsTotal = toNonNegativeInt_(entry.starsTotal);
	out.daysInLineup = resolvedWarDays;
	out.resolvedWarDays = resolvedWarDays;
	out.attacksMade = toNonNegativeInt_(entry.attacksMade);
	out.missedAttacks = toNonNegativeInt_(entry.missedAttacks);
	out.threeStarCount = toNonNegativeInt_(entry.threeStarCount);
	out.totalDestruction = toNonNegativeInt_(entry.totalDestruction);
	out.countedAttacks = toNonNegativeInt_(entry.countedAttacks);
	out.currentWarAttackPending = Math.min(1, toNonNegativeInt_(entry.currentWarAttackPending));
	out.hitUpCount = toNonNegativeInt_(entry.hitUpCount);
	out.hitDownCount = toNonNegativeInt_(entry.hitDownCount);
	out.sameThHitCount = toNonNegativeInt_(entry.sameThHitCount);
	return out;
}

// Derive CWL metrics.
function deriveCwlMetrics_(entryRaw) {
	const entry = sanitizeCwlStatEntry_(entryRaw);
	const possibleStars = 3 * entry.resolvedWarDays;
	return {
		starsTotal: entry.starsTotal,
		daysInLineup: entry.daysInLineup,
		resolvedWarDays: entry.resolvedWarDays,
		attacksMade: entry.attacksMade,
		missedAttacks: entry.missedAttacks,
		threeStarCount: entry.threeStarCount,
		totalDestruction: entry.totalDestruction,
		countedAttacks: entry.countedAttacks,
		currentWarAttackPending: entry.currentWarAttackPending,
		hitUpCount: entry.hitUpCount,
		hitDownCount: entry.hitDownCount,
		sameThHitCount: entry.sameThHitCount,
		possibleStars: possibleStars,
		starsPerf: possibleStars > 0 ? entry.starsTotal / possibleStars : null,
		avgDestruction: entry.countedAttacks > 0 ? entry.totalDestruction / entry.countedAttacks : null,
		destructionPerf: entry.resolvedWarDays > 0 ? entry.totalDestruction / (100 * entry.resolvedWarDays) : null,
	};
}

// Handle read attack destruction.
function readAttackDestruction_(attackRaw) {
	const attack = attackRaw && typeof attackRaw === "object" ? attackRaw : {};
	const raw = attack.destructionPercentage != null ? attack.destructionPercentage : attack.destruction;
	return toNonNegativeInt_(raw);
}

// Build member TH by tag.
function buildMemberThByTag_(membersRaw) {
	const out = {};
	const members = Array.isArray(membersRaw) ? membersRaw : [];
	for (let i = 0; i < members.length; i++) {
		const member = members[i] && typeof members[i] === "object" ? members[i] : {};
		const tag = normalizeTag_(member.tag);
		const th = readTownHallLevel_(member);
		if (!tag || !isFinite(th)) continue;
		out[tag] = Math.max(0, Math.floor(th));
	}
	return out;
}

// Handle metric compare value.
function metricCompareValue_(value) {
	return value == null ? -1 : value;
}

// Build history retention tag set.
function buildHistoryRetentionTagSet_(rosterPoolTagSetRaw, warPerformanceRaw, regularWarRaw, nowIso) {
	const out = {};
	const rosterPoolTagSet = rosterPoolTagSetRaw && typeof rosterPoolTagSetRaw === "object" ? rosterPoolTagSetRaw : {};
	for (const rawTag in rosterPoolTagSet) {
		if (!Object.prototype.hasOwnProperty.call(rosterPoolTagSet, rawTag)) continue;
		const tag = normalizeTag_(rawTag);
		if (tag) out[tag] = true;
	}

	const nowMs = parseIsoToMs_(nowIso) || Date.now();
	// Add membership.
	const addMembership = (membershipRaw) => {
		const membershipByTag = membershipRaw && typeof membershipRaw === "object" ? membershipRaw : {};
		const keys = Object.keys(membershipByTag);
		for (let i = 0; i < keys.length; i++) {
			const tag = normalizeTag_(keys[i]);
			if (!tag) continue;
			const entry = sanitizeRegularWarMembershipEntry_(membershipByTag[keys[i]]);
			if (entry.status !== "temporaryMissing") {
				out[tag] = true;
				continue;
			}
			const missingSinceMs = parseIsoToMs_(entry.missingSince);
			if (!(missingSinceMs > 0) || nowMs - missingSinceMs < REGULAR_WAR_MISSING_GRACE_MS) {
				out[tag] = true;
			}
		}
	};

	const warPerformance = warPerformanceRaw && typeof warPerformanceRaw === "object" ? warPerformanceRaw : {};
	addMembership(warPerformance.membershipByTag);
	const regularWar = regularWarRaw && typeof regularWarRaw === "object" ? regularWarRaw : {};
	addMembership(regularWar.membershipByTag);
	return out;
}

// Sanitize roster CWL stats.
function sanitizeRosterCwlStats_(rawStats, retainedTagSet) {
	if (rawStats == null) return null;
	const stats = rawStats && typeof rawStats === "object" ? rawStats : {};
	const allowedTags = retainedTagSet && typeof retainedTagSet === "object" ? retainedTagSet : {};
	const byTagRaw = stats.byTag && typeof stats.byTag === "object" ? stats.byTag : {};
	const byTag = {};
	const keys = Object.keys(byTagRaw);

	for (let i = 0; i < keys.length; i++) {
		const normalizedTag = normalizeTag_(keys[i]);
		if (!normalizedTag || !allowedTags[normalizedTag]) continue;

		byTag[normalizedTag] = sanitizeCwlStatEntry_(byTagRaw[keys[i]]);
	}

	return {
		lastRefreshedAt: typeof stats.lastRefreshedAt === "string" ? stats.lastRefreshedAt : "",
		season: typeof stats.season === "string" ? stats.season : "",
		byTag: byTag,
	};
}

// Sanitize roster regular war.
function sanitizeRosterRegularWar_(regularWarRaw, retainedTagSet) {
	if (regularWarRaw == null) return null;
	const regularWar = regularWarRaw && typeof regularWarRaw === "object" ? regularWarRaw : {};
	const allowedTags = retainedTagSet && typeof retainedTagSet === "object" ? retainedTagSet : {};
	const byTagRaw = regularWar.byTag && typeof regularWar.byTag === "object" ? regularWar.byTag : {};
	const membershipByTagRaw = regularWar.membershipByTag && typeof regularWar.membershipByTag === "object" ? regularWar.membershipByTag : {};
	const byTag = {};
	const membershipByTag = {};
	const byTagKeys = Object.keys(byTagRaw);
	const membershipKeys = Object.keys(membershipByTagRaw);

	for (let i = 0; i < byTagKeys.length; i++) {
		const normalizedTag = normalizeTag_(byTagKeys[i]);
		if (!normalizedTag || !allowedTags[normalizedTag]) continue;
		const entry = byTagRaw[byTagKeys[i]] && typeof byTagRaw[byTagKeys[i]] === "object" ? byTagRaw[byTagKeys[i]] : {};
		byTag[normalizedTag] = {
			current: sanitizeRegularWarCurrentEntry_(entry.current, entry.current && entry.current.attacksAllowed),
			aggregate: sanitizeRegularWarAggregateEntry_(entry.aggregate),
		};
	}

	for (let i = 0; i < membershipKeys.length; i++) {
		const normalizedTag = normalizeTag_(membershipKeys[i]);
		if (!normalizedTag || !allowedTags[normalizedTag]) continue;
		membershipByTag[normalizedTag] = sanitizeRegularWarMembershipEntry_(membershipByTagRaw[membershipKeys[i]]);
	}

	return {
		lastRefreshedAt: typeof regularWar.lastRefreshedAt === "string" ? regularWar.lastRefreshedAt : "",
		currentWar: sanitizeRegularWarCurrentWar_(regularWar.currentWar),
		aggregateMeta: sanitizeRegularWarAggregateMeta_(regularWar.aggregateMeta),
		byTag: byTag,
		membershipByTag: membershipByTag,
	};
}
