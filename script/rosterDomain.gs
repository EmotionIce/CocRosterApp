// Core roster-domain normalization and manipulation helpers.

// Compare by ordering rule.
function compareByOrderingRule_(a, b) {
	const aTh = a && typeof a.th === "number" && isFinite(a.th) ? a.th : -1;
	const bTh = b && typeof b.th === "number" && isFinite(b.th) ? b.th : -1;
	if (aTh !== bTh) return bTh - aTh;
	const aTag = normalizeTag_(a && a.tag);
	const bTag = normalizeTag_(b && b.tag);
	return aTag < bTag ? -1 : aTag > bTag ? 1 : 0;
}

// Convert a value to non negative int.
function toNonNegativeInt_(value) {
	const n = Number(value);
	if (!isFinite(n)) return 0;
	return Math.max(0, Math.floor(n));
}

// Convert a value to boolean flag.
function toBooleanFlag_(value) {
	if (value === true || value === false) return value;
	const text = String(value == null ? "" : value)
		.trim()
		.toLowerCase();
	if (!text) return false;
	return text === "true" || text === "1" || text === "yes" || text === "on";
}

// Handle collect roster pool players.
function collectRosterPoolPlayers_(roster) {
	const main = Array.isArray(roster && roster.main) ? roster.main : [];
	const subs = Array.isArray(roster && roster.subs) ? roster.subs : [];
	const missing = Array.isArray(roster && roster.missing) ? roster.missing : [];
	const out = [];
	const seen = {};
	const pool = main.concat(subs).concat(missing);
	for (let i = 0; i < pool.length; i++) {
		const player = pool[i] && typeof pool[i] === "object" ? pool[i] : {};
		const tag = normalizeTag_(player.tag);
		if (!tag || seen[tag]) continue;
		seen[tag] = true;
		out.push(player);
	}
	return out;
}

// Build roster pool tag set.
function buildRosterPoolTagSet_(roster) {
	const out = {};
	const players = collectRosterPoolPlayers_(roster);
	for (let i = 0; i < players.length; i++) {
		const tag = normalizeTag_(players[i] && players[i].tag);
		if (!tag) continue;
		out[tag] = true;
	}
	return out;
}

// Sanitize roster bench suggestions.
function sanitizeRosterBenchSuggestions_(rawSuggestions, rosterPoolTagSet) {
	if (rawSuggestions == null) return null;
	const suggestions = rawSuggestions && typeof rawSuggestions === "object" ? rawSuggestions : {};
	const allowedTags = rosterPoolTagSet && typeof rosterPoolTagSet === "object" ? rosterPoolTagSet : {};
	const pairsRaw = Array.isArray(suggestions.pairs) ? suggestions.pairs : [];
	const benchTagsRaw = Array.isArray(suggestions.benchTags) ? suggestions.benchTags : [];
	const swapInTagsRaw = Array.isArray(suggestions.swapInTags) ? suggestions.swapInTags : [];
	const resultRaw = suggestions.result && typeof suggestions.result === "object" ? suggestions.result : {};
	const seenPairKeys = {};
	const seenBenchTags = {};
	const seenSwapInTags = {};
	const benchTags = [];
	const swapInTags = [];
	const pairs = [];
	// Sanitize tag list.
	const sanitizeTagList = (rawList) => {
		const list = Array.isArray(rawList) ? rawList : [];
		const out = [];
		const seen = {};
		for (let i = 0; i < list.length; i++) {
			const tag = normalizeTag_(list[i]);
			if (!tag || !allowedTags[tag] || seen[tag]) continue;
			seen[tag] = true;
			out.push(tag);
		}
		return out;
	};
	// Sanitize string list.
	const sanitizeStringList = (rawList, limit) => {
		const list = Array.isArray(rawList) ? rawList : [];
		const maxLen = Math.max(0, toNonNegativeInt_(limit || 0));
		const out = [];
		const seen = {};
		for (let i = 0; i < list.length; i++) {
			const text = String(list[i] == null ? "" : list[i]).trim();
			if (!text || seen[text]) continue;
			seen[text] = true;
			out.push(text);
			if (maxLen > 0 && out.length >= maxLen) break;
		}
		return out;
	};
	// Convert a value to finite number or null.
	const toFiniteNumberOrNull = (value) => {
		const n = Number(value);
		return isFinite(n) ? n : null;
	};

	// Add bench tag.
	const addBenchTag = (tagRaw) => {
		const tag = normalizeTag_(tagRaw);
		if (!tag || !allowedTags[tag] || seenBenchTags[tag]) return;
		seenBenchTags[tag] = true;
		benchTags.push(tag);
	};

	// Add swap in tag.
	const addSwapInTag = (tagRaw) => {
		const tag = normalizeTag_(tagRaw);
		if (!tag || !allowedTags[tag] || seenSwapInTags[tag]) return;
		seenSwapInTags[tag] = true;
		swapInTags.push(tag);
	};

	for (let i = 0; i < pairsRaw.length; i++) {
		const pair = pairsRaw[i] && typeof pairsRaw[i] === "object" ? pairsRaw[i] : {};
		const outTag = normalizeTag_(pair.outTag);
		const inTag = normalizeTag_(pair.inTag);
		if (!outTag || !inTag || !allowedTags[outTag] || !allowedTags[inTag]) continue;
		const pairKey = outTag + "|" + inTag;
		if (seenPairKeys[pairKey]) continue;
		seenPairKeys[pairKey] = true;
		addBenchTag(outTag);
		addSwapInTag(inTag);
		const pairOut = {
			outTag: outTag,
			inTag: inTag,
			reasonCode: typeof pair.reasonCode === "string" ? pair.reasonCode : "",
			reasonText: typeof pair.reasonText === "string" ? pair.reasonText : "",
		};
		if (typeof pair.shortReason === "string") pairOut.shortReason = pair.shortReason;
		const scoreDelta = toFiniteNumberOrNull(pair.scoreDelta);
		if (scoreDelta != null) pairOut.scoreDelta = scoreDelta;
		if (typeof pair.rewardImpact === "string") pairOut.rewardImpact = pair.rewardImpact;
		pairs.push(pairOut);
	}

	for (let i = 0; i < benchTagsRaw.length; i++) addBenchTag(benchTagsRaw[i]);
	for (let i = 0; i < swapInTagsRaw.length; i++) addSwapInTag(swapInTagsRaw[i]);

	const updatedAt = typeof suggestions.updatedAt === "string" ? suggestions.updatedAt : "";
	const algorithm = typeof suggestions.algorithm === "string" ? suggestions.algorithm.trim() : "";
	const nextEditableDayIndexRaw = suggestions.nextEditableDayIndex;
	const nextEditableDayIndex = nextEditableDayIndexRaw == null ? null : Math.floor(Number(nextEditableDayIndexRaw));
	const safeNextEditableDayIndex = isFinite(nextEditableDayIndex) ? nextEditableDayIndex : null;
	const targetMainTags = sanitizeTagList(suggestions.targetMainTags);
	const actionableTargetMainTags = sanitizeTagList(suggestions.actionableTargetMainTags);
	const plannerSummaryRaw = suggestions.plannerSummary && typeof suggestions.plannerSummary === "object" ? suggestions.plannerSummary : null;
	let plannerSummary = null;
	if (plannerSummaryRaw) {
		const next = {
			remainingEditableDays: toNonNegativeInt_(plannerSummaryRaw.remainingEditableDays),
			optimalTotalSlack: toNonNegativeInt_(plannerSummaryRaw.optimalTotalSlack),
			rewardFeasiblePlayerCount: toNonNegativeInt_(plannerSummaryRaw.rewardFeasiblePlayerCount),
			rewardCriticalPlayerTags: sanitizeTagList(plannerSummaryRaw.rewardCriticalPlayerTags),
			impossibleRewardPlayerTags: sanitizeTagList(plannerSummaryRaw.impossibleRewardPlayerTags),
			blockedByExclusions: toBooleanFlag_(plannerSummaryRaw.blockedByExclusions),
			blockedByExclusionOutTags: sanitizeTagList(plannerSummaryRaw.blockedByExclusionOutTags),
			blockedByExclusionInTags: sanitizeTagList(plannerSummaryRaw.blockedByExclusionInTags),
		};
		const solverMode = String(plannerSummaryRaw.solverMode == null ? "" : plannerSummaryRaw.solverMode).trim();
		if (solverMode) next.solverMode = solverMode;
		const warnings = sanitizeStringList(plannerSummaryRaw.warnings, 20);
		if (warnings.length) next.warnings = warnings;
		plannerSummary = next;
	}
	const configSnapshotRaw = suggestions.configSnapshot && typeof suggestions.configSnapshot === "object" ? suggestions.configSnapshot : null;
	let configSnapshot = null;
	if (configSnapshotRaw) {
		const next = {};
		const numericConfigKeys = ["defaultSeasonDays", "priorMeanStarsPerStart", "priorWeightAttacks", "minExpectedStarsPerStart", "maxExpectedStarsPerStart", "weightTH", "weightStarsPerf", "weightDestructionPerf", "weightThreeStarRate", "weightHitUpAbility", "weightHitEvenAbility", "weightReliabilityPenalty", "churnPenalty"];
		for (let i = 0; i < numericConfigKeys.length; i++) {
			const key = numericConfigKeys[i];
			const value = toFiniteNumberOrNull(configSnapshotRaw[key]);
			if (value != null) next[key] = value;
		}
		configSnapshot = Object.keys(next).length ? next : null;
	}
	const hasPlannerMetadata = !!algorithm || safeNextEditableDayIndex != null || targetMainTags.length > 0 || actionableTargetMainTags.length > 0 || !!plannerSummary || !!configSnapshot;
	const hasContent = !!updatedAt || pairs.length > 0 || benchTags.length > 0 || swapInTags.length > 0 || Object.keys(resultRaw).length > 0 || hasPlannerMetadata;
	if (!hasContent) return null;

	const out = {
		updatedAt: updatedAt,
		benchTags: benchTags,
		swapInTags: swapInTags,
		pairs: pairs,
		result: {
			benchCount: benchTags.length > 0 ? benchTags.length : toNonNegativeInt_(resultRaw.benchCount),
			swapCount: pairs.length > 0 ? pairs.length : toNonNegativeInt_(resultRaw.swapCount),
			rosterPoolSize: toNonNegativeInt_(resultRaw.rosterPoolSize),
			activeSlots: toNonNegativeInt_(resultRaw.activeSlots),
			needsRewardsCount: toNonNegativeInt_(resultRaw.needsRewardsCount),
		},
	};
	if (algorithm) out.algorithm = algorithm;
	if (safeNextEditableDayIndex != null) out.nextEditableDayIndex = safeNextEditableDayIndex;
	if (targetMainTags.length) out.targetMainTags = targetMainTags;
	if (actionableTargetMainTags.length) out.actionableTargetMainTags = actionableTargetMainTags;
	if (plannerSummary) out.plannerSummary = plannerSummary;
	if (configSnapshot) out.configSnapshot = configSnapshot;
	return out;
}

// Normalize roster slots.
function normalizeRosterSlots_(roster) {
	if (!roster || typeof roster !== "object") return;
	if (!Array.isArray(roster.main)) roster.main = [];
	if (!Array.isArray(roster.subs)) roster.subs = [];
	if (!Array.isArray(roster.missing)) roster.missing = [];

	for (let i = 0; i < roster.main.length; i++) {
		if (!roster.main[i] || typeof roster.main[i] !== "object") roster.main[i] = {};
		roster.main[i].slot = i + 1;
	}
	for (let i = 0; i < roster.subs.length; i++) {
		if (!roster.subs[i] || typeof roster.subs[i] !== "object") roster.subs[i] = {};
		roster.subs[i].slot = null;
	}
	for (let i = 0; i < roster.missing.length; i++) {
		if (!roster.missing[i] || typeof roster.missing[i] !== "object") roster.missing[i] = {};
		roster.missing[i].slot = null;
	}
	roster.badges = { main: roster.main.length, subs: roster.subs.length, missing: roster.missing.length };
}

// Deduplicate roster sections by tag.
function dedupeRosterSectionsByTag_(rosterRaw) {
	const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : null;
	if (!roster) return { changed: false, removedCount: 0, removed: [] };
	if (!Array.isArray(roster.main)) roster.main = [];
	if (!Array.isArray(roster.subs)) roster.subs = [];
	if (!Array.isArray(roster.missing)) roster.missing = [];

	const sections = ["main", "subs", "missing"];
	const keptByTag = {};
	const removed = [];

	for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
		const section = sections[sectionIndex];
		const players = Array.isArray(roster[section]) ? roster[section] : [];
		const nextPlayers = [];
		for (let i = 0; i < players.length; i++) {
			const player = players[i] && typeof players[i] === "object" ? players[i] : {};
			const tag = normalizeTag_(player.tag);
			if (!tag) {
				nextPlayers.push(player);
				continue;
			}
			if (!keptByTag[tag]) {
				keptByTag[tag] = {
					section: section,
					index: nextPlayers.length,
				};
				nextPlayers.push(player);
				continue;
			}
			removed.push({
				tag: tag,
				removedFromSection: section,
				removedFromIndex: i,
				keptInSection: keptByTag[tag].section,
				keptIndex: keptByTag[tag].index,
			});
		}
		roster[section] = nextPlayers;
	}

	normalizeRosterSlots_(roster);
	return {
		changed: removed.length > 0,
		removedCount: removed.length,
		removed: removed,
	};
}

// Summarize roster section dedupe.
function summarizeRosterSectionDedupe_(dedupeRaw, maxItemsRaw) {
	const dedupe = dedupeRaw && typeof dedupeRaw === "object" ? dedupeRaw : {};
	const removed = Array.isArray(dedupe.removed) ? dedupe.removed : [];
	if (!removed.length) return "";
	const maxItems = Math.max(1, toNonNegativeInt_(maxItemsRaw) || 4);
	const parts = [];
	for (let i = 0; i < removed.length && i < maxItems; i++) {
		const item = removed[i] && typeof removed[i] === "object" ? removed[i] : {};
		const tag = normalizeTag_(item.tag) || String(item.tag || "");
		const removedSection = String(item.removedFromSection || "").trim() || "?";
		const keptSection = String(item.keptInSection || "").trim() || "?";
		const removedIndex = toNonNegativeInt_(item.removedFromIndex);
		const keptIndex = toNonNegativeInt_(item.keptIndex);
		parts.push(tag + " " + removedSection + "[" + removedIndex + "] -> " + keptSection + "[" + keptIndex + "]");
	}
	if (removed.length > maxItems) parts.push("+" + (removed.length - maxItems) + " more");
	return parts.join(" ; ");
}

// Clear roster bench suggestions.
function clearRosterBenchSuggestions_(roster) {
	if (!roster || typeof roster !== "object") return;
	if (Object.prototype.hasOwnProperty.call(roster, "benchSuggestions")) {
		delete roster.benchSuggestions;
	}
}

// Normalize preparation roster size.
function normalizePreparationRosterSize_(rawValue, fallbackValue) {
	// Normalize state.
	const normalize = (value) => {
		const n = Number(value);
		if (!isFinite(n)) return 0;
		const floored = Math.floor(n);
		if (floored <= 0) return 0;
		const snapped = Math.floor(floored / CWL_PREPARATION_ROSTER_SIZE_STEP) * CWL_PREPARATION_ROSTER_SIZE_STEP;
		if (snapped <= 0) return 0;
		return Math.max(CWL_PREPARATION_MIN_ROSTER_SIZE, Math.min(CWL_PREPARATION_MAX_ROSTER_SIZE, snapped));
	};
	const primary = normalize(rawValue);
	if (primary) return primary;
	const fallback = normalize(fallbackValue);
	if (fallback) return fallback;
	return CWL_PREPARATION_MIN_ROSTER_SIZE;
}

// Normalize preparation lock state.
function normalizePreparationLockState_(rawValue, rosterPoolTagSetRaw) {
	const raw = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
	const rosterPoolTagSet = rosterPoolTagSetRaw && typeof rosterPoolTagSetRaw === "object" ? rosterPoolTagSetRaw : {};
	const out = {};
	const keys = Object.keys(raw);
	for (let i = 0; i < keys.length; i++) {
		const tag = normalizeTag_(keys[i]);
		if (!tag || !rosterPoolTagSet[tag]) continue;
		const state = String(raw[keys[i]] == null ? "" : raw[keys[i]])
			.trim()
			.toLowerCase();
		if (state !== "lockedin" && state !== "lockedout") continue;
		out[tag] = state === "lockedin" ? "lockedIn" : "lockedOut";
	}
	return out;
}

// Sanitize roster CWL preparation.
function sanitizeRosterCwlPreparation_(rawValue, rosterPoolTagSetRaw, trackingModeRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const raw = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : null;
	const rosterPoolTagSet = rosterPoolTagSetRaw && typeof rosterPoolTagSetRaw === "object" ? rosterPoolTagSetRaw : {};
	const trackingMode = String(trackingModeRaw == null ? "" : trackingModeRaw).trim() === "regularWar" ? "regularWar" : "cwl";
	const defaultRosterSize = normalizePreparationRosterSize_(options.defaultRosterSize, CWL_PREPARATION_MIN_ROSTER_SIZE);
	const lockStateByTag = normalizePreparationLockState_(raw && raw.lockStateByTag, rosterPoolTagSet);
	const lockTags = Object.keys(lockStateByTag);
	const enabledRaw = raw ? toBooleanFlag_(raw.enabled) : false;
	const enabled = trackingMode === "cwl" ? enabledRaw : false;
	const rosterSize = normalizePreparationRosterSize_(raw && raw.rosterSize, defaultRosterSize);
	const lockedInCount = lockTags.filter((tag) => lockStateByTag[tag] === "lockedIn").length;
	if (enabled && lockedInCount > rosterSize && options.enforceLockedInLimit !== false) {
		throw new Error("CWL Preparation Mode invalid: lockedIn count (" + lockedInCount + ") exceeds roster size (" + rosterSize + ").");
	}
	const lastAppliedAt = raw && typeof raw.lastAppliedAt === "string" ? raw.lastAppliedAt.trim() : "";
	const hasSource = !!raw;
	const hasMeaningfulContent = hasSource || enabled || lockTags.length > 0;
	if (!hasMeaningfulContent) return null;
	const out = {
		enabled: enabled,
		rosterSize: rosterSize,
		lockStateByTag: lockStateByTag,
		algorithm: CWL_PREPARATION_ALGORITHM,
	};
	if (lastAppliedAt) out.lastAppliedAt = lastAppliedAt;
	return out;
}

// Handle collect roster pool players with section.
function collectRosterPoolPlayersWithSection_(rosterRaw) {
	const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
	const main = Array.isArray(roster.main) ? roster.main : [];
	const subs = Array.isArray(roster.subs) ? roster.subs : [];
	const missing = Array.isArray(roster.missing) ? roster.missing : [];
	const sections = [
		{ key: "main", players: main },
		{ key: "subs", players: subs },
		{ key: "missing", players: missing },
	];
	const out = [];
	const seen = {};
	let order = 0;
	for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
		const section = sections[sectionIndex];
		const players = Array.isArray(section.players) ? section.players : [];
		for (let i = 0; i < players.length; i++) {
			const player = players[i] && typeof players[i] === "object" ? players[i] : {};
			const tag = normalizeTag_(player.tag);
			if (!tag || seen[tag]) continue;
			seen[tag] = true;
			out.push({
				tag: tag,
				player: player,
				sourceSection: section.key,
				sourceIndex: i,
				sourceOrder: order++,
			});
		}
	}
	return out;
}

// Get roster CWL preparation.
function getRosterCwlPreparation_(rosterRaw) {
	const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
	const trackingMode = getRosterTrackingMode_(roster);
	const poolEntries = collectRosterPoolPlayersWithSection_(roster);
	const rosterPoolTagSet = {};
	for (let i = 0; i < poolEntries.length; i++) rosterPoolTagSet[poolEntries[i].tag] = true;
	const fallbackRosterSize = normalizePreparationRosterSize_(
		Array.isArray(roster.main) ? roster.main.length : 0,
		CWL_PREPARATION_MIN_ROSTER_SIZE,
	);
	const sanitized =
		sanitizeRosterCwlPreparation_(roster.cwlPreparation, rosterPoolTagSet, trackingMode, {
			defaultRosterSize: fallbackRosterSize,
			enforceLockedInLimit: true,
		}) || {
			enabled: false,
			rosterSize: fallbackRosterSize,
			lockStateByTag: {},
			algorithm: CWL_PREPARATION_ALGORITHM,
		};
	if (!sanitized.lockStateByTag || typeof sanitized.lockStateByTag !== "object") sanitized.lockStateByTag = {};
	if (!sanitized.algorithm) sanitized.algorithm = CWL_PREPARATION_ALGORITHM;
	return sanitized;
}

// Return whether CWL preparation active.
function isCwlPreparationActive_(rosterRaw) {
	const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
	if (getRosterTrackingMode_(roster) !== "cwl") return false;
	const prep = getRosterCwlPreparation_(roster);
	return !!(prep && prep.enabled);
}

// Build CWL preparation ranking.
function buildCwlPreparationRanking_(rosterRaw, optionsRaw) {
	const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const poolEntries = Array.isArray(options.poolEntries) ? options.poolEntries : collectRosterPoolPlayersWithSection_(roster);
	const cwlStatsByTag = roster && roster.cwlStats && roster.cwlStats.byTag && typeof roster.cwlStats.byTag === "object" ? roster.cwlStats.byTag : {};
	const config = options.config && typeof options.config === "object" ? options.config : getBenchPlannerConfig_();
	const ranked = [];
	let thMin = Number.MAX_SAFE_INTEGER;
	let thMax = 0;
	let sumThreeStarRate = 0;
	let sumMissRate = 0;
	let meanCount = 0;
	for (let i = 0; i < poolEntries.length; i++) {
		const entry = poolEntries[i] && typeof poolEntries[i] === "object" ? poolEntries[i] : {};
		const player = entry.player && typeof entry.player === "object" ? entry.player : {};
		const tag = normalizeTag_(entry.tag || player.tag);
		if (!tag) continue;
		const metrics = deriveCwlMetrics_(cwlStatsByTag[tag]);
		const th = toNonNegativeInt_(player.th);
		const playerStats = {
			tag: tag,
			th: th,
			countedAttacks: metrics.countedAttacks,
			resolvedWarDays: metrics.resolvedWarDays,
			starsPerf: metrics.starsPerf,
			destructionPerf: metrics.destructionPerf,
			threeStarCount: metrics.threeStarCount,
			hitUpCount: metrics.hitUpCount,
			sameThHitCount: metrics.sameThHitCount,
			missedAttacks: metrics.missedAttacks,
		};
		ranked.push({
			tag: tag,
			player: player,
			th: th,
			sourceSection: entry.sourceSection || "subs",
			sourceOrder: toNonNegativeInt_(entry.sourceOrder),
			playerStats: playerStats,
			strengthScore: Number.NEGATIVE_INFINITY,
			strengthComponents: null,
		});
		thMin = Math.min(thMin, th);
		thMax = Math.max(thMax, th);
		sumThreeStarRate += toNonNegativeInt_(metrics.threeStarCount) / Math.max(1, toNonNegativeInt_(metrics.countedAttacks));
		sumMissRate += toNonNegativeInt_(metrics.missedAttacks) / Math.max(1, toNonNegativeInt_(metrics.resolvedWarDays));
		meanCount++;
	}
	if (!ranked.length) {
		return {
			ranked: [],
			byTag: {},
		};
	}
	if (thMin === Number.MAX_SAFE_INTEGER) thMin = 0;
	const planningContext = {
		thMin: thMin,
		thMax: thMax,
		poolThreeStarRateMean: meanCount > 0 ? sumThreeStarRate / meanCount : 0.33,
		poolMissRateMean: meanCount > 0 ? sumMissRate / meanCount : 0.1,
	};
	const sectionPriority = { main: 0, subs: 1, missing: 2 };
	for (let i = 0; i < ranked.length; i++) {
		const strength = computeStrengthScore_(ranked[i].playerStats, planningContext, config);
		const score = strength && isFinite(Number(strength.score)) ? Number(strength.score) : Number.NEGATIVE_INFINITY;
		ranked[i].strengthScore = score;
		ranked[i].strengthComponents = strength && typeof strength === "object" ? strength : null;
	}
	ranked.sort((left, right) => {
		const leftScore = isFinite(Number(left && left.strengthScore)) ? Number(left.strengthScore) : Number.NEGATIVE_INFINITY;
		const rightScore = isFinite(Number(right && right.strengthScore)) ? Number(right.strengthScore) : Number.NEGATIVE_INFINITY;
		if (leftScore !== rightScore) return rightScore - leftScore;
		const leftTh = toNonNegativeInt_(left && left.th);
		const rightTh = toNonNegativeInt_(right && right.th);
		if (leftTh !== rightTh) return rightTh - leftTh;
		const leftPriority = Object.prototype.hasOwnProperty.call(sectionPriority, left && left.sourceSection) ? sectionPriority[left.sourceSection] : 9;
		const rightPriority = Object.prototype.hasOwnProperty.call(sectionPriority, right && right.sourceSection) ? sectionPriority[right.sourceSection] : 9;
		if (leftPriority !== rightPriority) return leftPriority - rightPriority;
		const leftOrder = toNonNegativeInt_(left && left.sourceOrder);
		const rightOrder = toNonNegativeInt_(right && right.sourceOrder);
		if (leftOrder !== rightOrder) return leftOrder - rightOrder;
		return compareTagsAsc_(left && left.tag, right && right.tag);
	});
	const byTag = {};
	for (let i = 0; i < ranked.length; i++) byTag[ranked[i].tag] = ranked[i];
	return {
		ranked: ranked,
		byTag: byTag,
	};
}

// Apply CWL preparation rebalance.
function applyCwlPreparationRebalance_(rosterRaw, optionsRaw) {
	const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : null;
	if (!roster) throw new Error("Roster is required.");
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const trackingMode = getRosterTrackingMode_(roster);
	if (!Array.isArray(roster.main)) roster.main = [];
	if (!Array.isArray(roster.subs)) roster.subs = [];
	if (!Array.isArray(roster.missing)) roster.missing = [];

	const poolEntries = collectRosterPoolPlayersWithSection_(roster);
	const rosterPoolTagSet = {};
	for (let i = 0; i < poolEntries.length; i++) rosterPoolTagSet[poolEntries[i].tag] = true;
	const fallbackRosterSize = normalizePreparationRosterSize_(
		Array.isArray(roster.main) ? roster.main.length : 0,
		CWL_PREPARATION_MIN_ROSTER_SIZE,
	);
	const prep =
		sanitizeRosterCwlPreparation_(roster.cwlPreparation, rosterPoolTagSet, trackingMode, {
			defaultRosterSize: fallbackRosterSize,
			enforceLockedInLimit: options.enforceLockedInLimit !== false,
		}) || {
			enabled: false,
			rosterSize: fallbackRosterSize,
			lockStateByTag: {},
			algorithm: CWL_PREPARATION_ALGORITHM,
		};
	if (!prep.lockStateByTag || typeof prep.lockStateByTag !== "object") prep.lockStateByTag = {};
	prep.algorithm = CWL_PREPARATION_ALGORITHM;

	const lockStateByTag = prep.lockStateByTag;
	const lockTags = Object.keys(lockStateByTag);
	let lockedInCount = 0;
	let lockedOutCount = 0;
	for (let i = 0; i < lockTags.length; i++) {
		if (lockStateByTag[lockTags[i]] === "lockedIn") lockedInCount++;
		else if (lockStateByTag[lockTags[i]] === "lockedOut") lockedOutCount++;
	}

	const beforeMainTags = roster.main.map((player) => normalizeTag_(player && player.tag)).filter((tag) => tag);
	const beforeSubsTags = roster.subs.map((player) => normalizeTag_(player && player.tag)).filter((tag) => tag);
	const beforeMissingTags = roster.missing.map((player) => normalizeTag_(player && player.tag)).filter((tag) => tag);

	if (trackingMode !== "cwl" || !prep.enabled) {
		prep.enabled = false;
		roster.cwlPreparation = prep;
		return {
			enabled: false,
			rosterSize: prep.rosterSize,
			filledMainCount: beforeMainTags.length,
			underfilled: false,
			lockedInCount: lockedInCount,
			lockedOutCount: lockedOutCount,
			autoSelectedCount: Math.max(0, beforeMainTags.length - lockedInCount),
			changed: false,
			cwlPreparationBlocked: false,
		};
	}

	if (lockedInCount > prep.rosterSize) {
		throw new Error("CWL Preparation Mode invalid: lockedIn count (" + lockedInCount + ") exceeds roster size (" + prep.rosterSize + ").");
	}

	const ranking = buildCwlPreparationRanking_(roster, { poolEntries: poolEntries });
	const ranked = Array.isArray(ranking.ranked) ? ranking.ranked : [];
	const rankedByTag = ranking.byTag && typeof ranking.byTag === "object" ? ranking.byTag : {};
	const lockedInEntries = [];
	const selectedSet = {};
	for (let i = 0; i < lockTags.length; i++) {
		const tag = lockTags[i];
		if (lockStateByTag[tag] !== "lockedIn") continue;
		const entry = rankedByTag[tag];
		if (!entry || !entry.player) continue;
		lockedInEntries.push(entry);
		selectedSet[tag] = true;
	}
	lockedInEntries.sort((left, right) => {
		const leftScore = isFinite(Number(left && left.strengthScore)) ? Number(left.strengthScore) : Number.NEGATIVE_INFINITY;
		const rightScore = isFinite(Number(right && right.strengthScore)) ? Number(right.strengthScore) : Number.NEGATIVE_INFINITY;
		if (leftScore !== rightScore) return rightScore - leftScore;
		const leftTh = toNonNegativeInt_(left && left.th);
		const rightTh = toNonNegativeInt_(right && right.th);
		if (leftTh !== rightTh) return rightTh - leftTh;
		return compareTagsAsc_(left && left.tag, right && right.tag);
	});
	const nextMain = [];
	for (let i = 0; i < lockedInEntries.length; i++) nextMain.push(lockedInEntries[i].player);

	let remainingSlots = Math.max(0, prep.rosterSize - nextMain.length);
	for (let i = 0; i < ranked.length && remainingSlots > 0; i++) {
		const entry = ranked[i];
		const tag = entry && entry.tag ? entry.tag : "";
		if (!tag || selectedSet[tag]) continue;
		if (lockStateByTag[tag] === "lockedOut") continue;
		nextMain.push(entry.player);
		selectedSet[tag] = true;
		remainingSlots--;
	}
	const nextSubs = [];
	for (let i = 0; i < ranked.length; i++) {
		const entry = ranked[i];
		const tag = entry && entry.tag ? entry.tag : "";
		if (!tag || selectedSet[tag]) continue;
		nextSubs.push(entry.player);
	}

	roster.main = nextMain;
	roster.subs = nextSubs;
	roster.missing = [];
	normalizeRosterSlots_(roster);
	const dedupeResult = dedupeRosterSectionsByTag_(roster);
	if (dedupeResult.changed) {
		Logger.log(
			"applyCwlPreparationRebalance_ deduped roster '%s': removed %s duplicate(s). %s",
			String((roster && roster.id) || "").trim() || "unknown",
			dedupeResult.removedCount,
			summarizeRosterSectionDedupe_(dedupeResult, 6),
		);
	}

	const afterMainTags = roster.main.map((player) => normalizeTag_(player && player.tag)).filter((tag) => tag);
	const afterSubsTags = roster.subs.map((player) => normalizeTag_(player && player.tag)).filter((tag) => tag);
	const afterMissingTags = roster.missing.map((player) => normalizeTag_(player && player.tag)).filter((tag) => tag);
	const compositionChanged =
		beforeMainTags.join("|") !== afterMainTags.join("|") ||
		beforeSubsTags.join("|") !== afterSubsTags.join("|") ||
		beforeMissingTags.join("|") !== afterMissingTags.join("|") ||
		!!dedupeResult.changed;
	if (compositionChanged) {
		clearRosterBenchSuggestions_(roster);
	}

	if (options.recordAppliedAt !== false) {
		prep.lastAppliedAt = new Date().toISOString();
	}
	roster.cwlPreparation = prep;
	return {
		enabled: true,
		rosterSize: prep.rosterSize,
		filledMainCount: afterMainTags.length,
		underfilled: afterMainTags.length < prep.rosterSize,
		lockedInCount: lockedInCount,
		lockedOutCount: lockedOutCount,
		autoSelectedCount: Math.max(0, afterMainTags.length - lockedInCount),
		changed: compositionChanged,
		cwlPreparationBlocked: false,
	};
}

// Find roster by ID.
function findRosterById_(rosterData, rosterIdRaw) {
	const rosterDataSafe = validateRosterData_(rosterData);
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	if (!rosterId) throw new Error("Roster ID is required.");

	const rosters = Array.isArray(rosterDataSafe.rosters) ? rosterDataSafe.rosters : [];
	const roster = rosters.find((r) => String((r && r.id) || "").trim() === rosterId);
	if (!roster) throw new Error("Roster not found: " + rosterId);

	return { rosterData: rosterDataSafe, roster: roster, rosterId: rosterId };
}
