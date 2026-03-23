// Live roster sync and roster mutation orchestration helpers.

// Find roster for clan sync.
function findRosterForClanSync_(rosterData, rosterIdRaw) {
	const ctx = findRosterById_(rosterData, rosterIdRaw);
	const roster = ctx.roster;
	const connectedClanTag = normalizeTag_(roster.connectedClanTag);
	if (!connectedClanTag) {
		throw new Error("Connected clan tag is missing for roster '" + ctx.rosterId + "'.");
	}
	if (!isValidClanTag_(connectedClanTag)) {
		throw new Error("Connected clan tag is invalid for roster '" + ctx.rosterId + "': " + connectedClanTag + ".");
	}
	roster.connectedClanTag = connectedClanTag;
	ctx.trackingMode = getRosterTrackingMode_(roster);
	ctx.clanTag = connectedClanTag;
	return ctx;
}

// Resolve roster pool source.
function resolveRosterPoolSource_(clanTagRaw, rosterIdRaw, ownershipSnapshotRaw) {
	const clanTag = normalizeTag_(clanTagRaw);
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	const snapshot = ownershipSnapshotRaw && typeof ownershipSnapshotRaw === "object" ? ownershipSnapshotRaw : null;
	if (snapshot && clanTag) {
		const poolSyncErrorByTag = snapshot.poolSyncErrorByTag && typeof snapshot.poolSyncErrorByTag === "object" ? snapshot.poolSyncErrorByTag : {};
		const legacyClanErrorByTag = snapshot.clanErrorByTag && typeof snapshot.clanErrorByTag === "object" ? snapshot.clanErrorByTag : {};
		let clanError = poolSyncErrorByTag[clanTag] && typeof poolSyncErrorByTag[clanTag] === "object" ? poolSyncErrorByTag[clanTag] : null;
		if (!clanError) {
			clanError = legacyClanErrorByTag[clanTag] && typeof legacyClanErrorByTag[clanTag] === "object" ? legacyClanErrorByTag[clanTag] : null;
		}
		if (clanError) {
			const step = String(clanError.step == null ? "" : clanError.step).trim() || "build shared ownership snapshot";
			const message = String(clanError.message == null ? "" : clanError.message).trim() || "unknown error";
			throw new Error("Unable to build shared roster ownership snapshot for clan " + clanTag + " (" + step + "): " + message);
		}
	}
	if (snapshot && rosterId) {
		const membersByRosterId = snapshot.membersByRosterId && typeof snapshot.membersByRosterId === "object" ? snapshot.membersByRosterId : {};
		if (Array.isArray(membersByRosterId[rosterId])) {
			return { sourceUsed: "members", members: membersByRosterId[rosterId] };
		}
	}
	return { sourceUsed: "members", members: fetchClanMembers_(clanTag) };
}

// Build roster player seed by tag.
function buildRosterPlayerSeedByTag_(rosterData) {
	const rosters = rosterData && Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	const out = {};

	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		const players = []
			.concat(Array.isArray(roster.main) ? roster.main : [])
			.concat(Array.isArray(roster.subs) ? roster.subs : [])
			.concat(Array.isArray(roster.missing) ? roster.missing : []);
		for (let j = 0; j < players.length; j++) {
			const player = players[j] && typeof players[j] === "object" ? players[j] : {};
			const tag = normalizeTag_(player.tag);
			if (!tag || out[tag]) continue;
			out[tag] = player;
		}
	}

	return out;
}

// Build live roster ownership snapshot.
function buildLiveRosterOwnershipSnapshot_(rosterData, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const shouldRecordMetrics = options.recordMetrics !== false;
	const prefetchedClanSnapshotsByTag = options.prefetchedClanSnapshotsByTag && typeof options.prefetchedClanSnapshotsByTag === "object" ? options.prefetchedClanSnapshotsByTag : {};
	const prefetchedClanErrorsByTag = options.prefetchedClanErrorsByTag && typeof options.prefetchedClanErrorsByTag === "object" ? options.prefetchedClanErrorsByTag : {};
	const snapshotStartedAtIso = new Date().toISOString();
	const metricsProfileModeRaw = String(options.metricsProfileMode == null ? "auto" : options.metricsProfileMode)
		.trim()
		.toLowerCase();
	const metricsProfileMode = metricsProfileModeRaw === "always" || metricsProfileModeRaw === "never" ? metricsProfileModeRaw : "auto";
	const metricsRunState = options.metricsRunState && typeof options.metricsRunState === "object" ? options.metricsRunState : { seenClanTags: {} };
	const metricsProfileRunState = shouldRecordMetrics
		? metricsRunState.profileRunState && typeof metricsRunState.profileRunState === "object"
			? metricsRunState.profileRunState
			: (metricsRunState.profileRunState = {})
		: null;
	let metricsCommittedRosterData = shouldRecordMetrics
		? { playerMetrics: sanitizePlayerMetricsStore_(rosterData && rosterData.playerMetrics, snapshotStartedAtIso) }
		: null;
	const rosters = rosterData && Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	const membersByRosterId = {};
	const memberTagSetByRosterId = {};
	const ownerRosterIdByTag = {};
	const liveMemberByTag = {};
	const connectedClanTagByRosterId = {};
	const connectedRosterIds = [];
	const membersByClanTag = {};
	const memberTrackingByRosterId = {};
	const memberTrackingByClanTag = {};
	const stagedMemberTrackingByClanTag = {};
	const committedMetricsByClanTag = {};
	const poolSyncErrorByTag = {};
	const metricsErrorByTag = {};

	// Register snapshot clan error.
	const registerSnapshotClanError = (targetMapRaw, errorTypeRaw, clanTagRaw, stepRaw, errRaw, rosterIdRaw) => {
		const targetMap = targetMapRaw && typeof targetMapRaw === "object" ? targetMapRaw : {};
		const clanTag = normalizeTag_(clanTagRaw);
		if (!clanTag) return null;
		if (targetMap[clanTag] && typeof targetMap[clanTag] === "object") return targetMap[clanTag];

		const step = String(stepRaw == null ? "" : stepRaw).trim() || "build snapshot";
		const errorType = String(errorTypeRaw == null ? "" : errorTypeRaw).trim() || "snapshot";
		const message = errorMessage_(errRaw);
		const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
		const payload = {
			clanTag: clanTag,
			rosterId: rosterId,
			step: step,
			message: message,
		};
		targetMap[clanTag] = payload;
		Logger.log(
			"buildLiveRosterOwnershipSnapshot: %s failed for clan '%s' at step '%s'%s: %s",
			errorType,
			clanTag,
			step,
			rosterId ? " (roster " + rosterId + ")" : "",
			message,
		);
		return payload;
	};
	// Register pool sync error.
	const registerPoolSyncError = (clanTagRaw, stepRaw, errRaw, rosterIdRaw) =>
		registerSnapshotClanError(poolSyncErrorByTag, "pool-sync", clanTagRaw, stepRaw, errRaw, rosterIdRaw);
	// Register metrics error.
	const registerMetricsError = (clanTagRaw, stepRaw, errRaw, rosterIdRaw) =>
		registerSnapshotClanError(metricsErrorByTag, "metrics", clanTagRaw, stepRaw, errRaw, rosterIdRaw);

	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		const rosterId = String(roster.id || "").trim();
		if (!rosterId) continue;

		const clanTag = normalizeTag_(roster.connectedClanTag);
		if (!clanTag) continue;

		connectedRosterIds.push(rosterId);
		connectedClanTagByRosterId[rosterId] = clanTag;

		let members = membersByClanTag[clanTag];
		if (!members && !poolSyncErrorByTag[clanTag]) {
			let clanSnapshot = null;
			const hasPrefetchedError = Object.prototype.hasOwnProperty.call(prefetchedClanErrorsByTag, clanTag);
			const hasPrefetchedSnapshot = Object.prototype.hasOwnProperty.call(prefetchedClanSnapshotsByTag, clanTag);
			if (hasPrefetchedError) {
				registerPoolSyncError(clanTag, "fetch clan members", prefetchedClanErrorsByTag[clanTag], rosterId);
				membersByClanTag[clanTag] = [];
				members = membersByClanTag[clanTag];
			} else {
				try {
					clanSnapshot = hasPrefetchedSnapshot ? prefetchedClanSnapshotsByTag[clanTag] : fetchClanMembersSnapshot_(clanTag);
					members = Array.isArray(clanSnapshot && clanSnapshot.members) ? clanSnapshot.members : [];
					membersByClanTag[clanTag] = members;
				} catch (err) {
					registerPoolSyncError(clanTag, "fetch clan members", err, rosterId);
					membersByClanTag[clanTag] = [];
					members = membersByClanTag[clanTag];
				}
			}

			if (!poolSyncErrorByTag[clanTag] && shouldRecordMetrics && metricsCommittedRosterData) {
				try {
					const metricsWorkingCopy = {
						playerMetrics: sanitizePlayerMetricsStore_(metricsCommittedRosterData.playerMetrics, snapshotStartedAtIso),
					};
					const enriched = enrichMetricsMembersWithProfiles_(clanSnapshot && clanSnapshot.metricsMembers, {
						mode: metricsProfileMode,
						runState: metricsProfileRunState,
						clanTag: clanTag,
						sourceRosterId: rosterId,
						source: "buildLiveRosterOwnershipSnapshot",
					});
					const metricsMembers = enriched && Array.isArray(enriched.members) ? enriched.members : clanSnapshot && clanSnapshot.metricsMembers;
					const metricsRecord = recordClanMemberMetricsSnapshot_(metricsWorkingCopy, clanTag, metricsMembers, {
						capturedAt: clanSnapshot && clanSnapshot.capturedAt,
						runState: metricsRunState,
						sourceRosterId: rosterId,
						source: "buildLiveRosterOwnershipSnapshot",
					});
					metricsCommittedRosterData = metricsWorkingCopy;
					committedMetricsByClanTag[clanTag] = true;
					const stagedTracking = {
						clanTag: clanTag,
						rosterId: rosterId,
						capturedAt: clanSnapshot && clanSnapshot.capturedAt ? clanSnapshot.capturedAt : "",
						attemptedClans: 1,
						capturedClans: 1,
						recorded: toNonNegativeInt_(metricsRecord && metricsRecord.recorded),
						updated: toNonNegativeInt_(metricsRecord && metricsRecord.updated),
						errors: [],
						entryCount: countPlayerMetricsEntries_(metricsCommittedRosterData && metricsCommittedRosterData.playerMetrics),
						profileEnriched: toNonNegativeInt_(enriched && enriched.enriched),
						profileAttempted: toNonNegativeInt_(enriched && enriched.attempted),
						metricsProfileMode: metricsProfileMode,
					};
					memberTrackingByClanTag[clanTag] = stagedTracking;
					stagedMemberTrackingByClanTag[clanTag] = stagedTracking;
				} catch (err) {
					registerMetricsError(clanTag, "record clan metrics", err, rosterId);
					const stagedTracking = {
						clanTag: clanTag,
						rosterId: rosterId,
						capturedAt: clanSnapshot && clanSnapshot.capturedAt ? clanSnapshot.capturedAt : "",
						attemptedClans: 1,
						capturedClans: 0,
						recorded: 0,
						updated: 0,
						errors: [{ clanTag: clanTag, message: errorMessage_(err) }],
						entryCount: countPlayerMetricsEntries_(metricsCommittedRosterData && metricsCommittedRosterData.playerMetrics),
						profileEnriched: 0,
						profileAttempted: 0,
						metricsProfileMode: metricsProfileMode,
					};
					memberTrackingByClanTag[clanTag] = stagedTracking;
					stagedMemberTrackingByClanTag[clanTag] = stagedTracking;
				}
			}
		}

		if (poolSyncErrorByTag[clanTag]) {
			membersByRosterId[rosterId] = [];
			memberTagSetByRosterId[rosterId] = {};
			continue;
		}

		members = Array.isArray(membersByClanTag[clanTag]) ? membersByClanTag[clanTag] : [];
		membersByRosterId[rosterId] = members;

		const tagSet = {};
		for (let j = 0; j < members.length; j++) {
			const member = members[j] && typeof members[j] === "object" ? members[j] : {};
			const tag = normalizeTag_(member.tag);
			if (!tag || tagSet[tag]) continue;
			tagSet[tag] = true;
			if (!ownerRosterIdByTag[tag]) ownerRosterIdByTag[tag] = rosterId;
			if (!liveMemberByTag[tag]) liveMemberByTag[tag] = member;
		}
		memberTagSetByRosterId[rosterId] = tagSet;
	}

	if (shouldRecordMetrics && metricsCommittedRosterData) {
		rosterData.playerMetrics = sanitizePlayerMetricsStore_(metricsCommittedRosterData.playerMetrics, new Date().toISOString());
	}
	const committedEntryCount = countPlayerMetricsEntries_(rosterData && rosterData.playerMetrics);
	const trackedClanTags = Object.keys(stagedMemberTrackingByClanTag);
	for (let i = 0; i < trackedClanTags.length; i++) {
		const clanTag = trackedClanTags[i];
		const stagedTracking = stagedMemberTrackingByClanTag[clanTag] && typeof stagedMemberTrackingByClanTag[clanTag] === "object" ? stagedMemberTrackingByClanTag[clanTag] : {};
		const committed = !!committedMetricsByClanTag[clanTag];
		const errors = Array.isArray(stagedTracking.errors) ? stagedTracking.errors.slice() : [];

		memberTrackingByClanTag[clanTag] = {
			clanTag: clanTag,
			capturedAt: String(stagedTracking.capturedAt == null ? "" : stagedTracking.capturedAt),
			attemptedClans: toNonNegativeInt_(stagedTracking.attemptedClans),
			capturedClans: committed ? toNonNegativeInt_(stagedTracking.capturedClans) : 0,
			recorded: committed ? toNonNegativeInt_(stagedTracking.recorded) : 0,
			updated: committed ? toNonNegativeInt_(stagedTracking.updated) : 0,
			errors: errors,
			entryCount: committedEntryCount,
			profileEnriched: toNonNegativeInt_(stagedTracking.profileEnriched),
			profileAttempted: toNonNegativeInt_(stagedTracking.profileAttempted),
			metricsProfileMode: String(stagedTracking.metricsProfileMode == null ? metricsProfileMode : stagedTracking.metricsProfileMode),
			committed: committed,
		};
	}
	const connectedTrackingRosterIds = Object.keys(connectedClanTagByRosterId);
	for (let i = 0; i < connectedTrackingRosterIds.length; i++) {
		const rosterId = connectedTrackingRosterIds[i];
		const clanTag = normalizeTag_(connectedClanTagByRosterId[rosterId]);
		const tracking = clanTag && memberTrackingByClanTag[clanTag] && typeof memberTrackingByClanTag[clanTag] === "object" ? memberTrackingByClanTag[clanTag] : null;
		if (tracking) memberTrackingByRosterId[rosterId] = tracking;
		else delete memberTrackingByRosterId[rosterId];
	}

	return {
		membersByRosterId: membersByRosterId,
		memberTagSetByRosterId: memberTagSetByRosterId,
		ownerRosterIdByTag: ownerRosterIdByTag,
		liveMemberByTag: liveMemberByTag,
		connectedClanTagByRosterId: connectedClanTagByRosterId,
		connectedRosterIds: connectedRosterIds,
		memberTrackingByRosterId: memberTrackingByRosterId,
		poolSyncErrorByTag: poolSyncErrorByTag,
		metricsErrorByTag: metricsErrorByTag,
		clanErrorByTag: poolSyncErrorByTag,
		seedPlayerByTag: buildRosterPlayerSeedByTag_(rosterData),
	};
}

// Apply live member to roster player.
function applyLiveMemberToRosterPlayer_(playerRaw, memberRaw) {
	const player = playerRaw && typeof playerRaw === "object" ? playerRaw : {};
	const member = memberRaw && typeof memberRaw === "object" ? memberRaw : {};
	let changed = false;

	if (member.name && member.name !== player.name) {
		player.name = member.name;
		changed = true;
	}
	if (typeof member.th === "number" && isFinite(member.th) && member.th > 0 && member.th !== player.th) {
		player.th = Math.floor(member.th);
		changed = true;
	}

	return changed;
}

// Create a roster player from seed.
function createRosterPlayerFromSeed_(tagRaw, seedRaw, memberRaw) {
	const tag = normalizeTag_(tagRaw);
	const seed = seedRaw && typeof seedRaw === "object" ? seedRaw : {};
	const member = memberRaw && typeof memberRaw === "object" ? memberRaw : {};

	const seedTh = typeof seed.th === "number" && isFinite(seed.th) ? Math.max(0, Math.floor(seed.th)) : 0;
	const liveTh = typeof member.th === "number" && isFinite(member.th) && member.th > 0 ? Math.floor(member.th) : null;

	return {
		slot: null,
		name: member.name || (typeof seed.name === "string" ? seed.name : ""),
		discord: typeof seed.discord === "string" ? seed.discord : "",
		th: liveTh != null ? liveTh : seedTh,
		tag: tag,
		notes: sanitizeNotes_(seed.notes != null ? seed.notes : seed.note),
		excludeAsSwapTarget: toBooleanFlag_(seed.excludeAsSwapTarget),
		excludeAsSwapSource: toBooleanFlag_(seed.excludeAsSwapSource),
	};
}

// Prune tag from roster tracking state.
function pruneTagFromRosterTrackingState_(roster, tagRaw) {
	const tag = normalizeTag_(tagRaw);
	if (!tag || !roster || typeof roster !== "object") return false;
	let changed = false;

	const regularWar = roster.regularWar && typeof roster.regularWar === "object" ? roster.regularWar : null;
	if (regularWar && regularWar.byTag && typeof regularWar.byTag === "object" && Object.prototype.hasOwnProperty.call(regularWar.byTag, tag)) {
		delete regularWar.byTag[tag];
		changed = true;
	}
	if (regularWar && regularWar.membershipByTag && typeof regularWar.membershipByTag === "object" && Object.prototype.hasOwnProperty.call(regularWar.membershipByTag, tag)) {
		delete regularWar.membershipByTag[tag];
		changed = true;
	}

	const cwlStats = roster.cwlStats && typeof roster.cwlStats === "object" ? roster.cwlStats : null;
	if (cwlStats && cwlStats.byTag && typeof cwlStats.byTag === "object" && Object.prototype.hasOwnProperty.call(cwlStats.byTag, tag)) {
		delete cwlStats.byTag[tag];
		changed = true;
	}

	const warPerformance = roster.warPerformance && typeof roster.warPerformance === "object" ? roster.warPerformance : null;
	let regularHistoryOrBaselineChanged = false;
	if (warPerformance && warPerformance.byTag && typeof warPerformance.byTag === "object" && Object.prototype.hasOwnProperty.call(warPerformance.byTag, tag)) {
		delete warPerformance.byTag[tag];
		changed = true;
	}
	if (warPerformance && warPerformance.membershipByTag && typeof warPerformance.membershipByTag === "object" && Object.prototype.hasOwnProperty.call(warPerformance.membershipByTag, tag)) {
		delete warPerformance.membershipByTag[tag];
		changed = true;
	}
	if (
		warPerformance &&
		warPerformance.regularWarLegacyBaselineByTag &&
		typeof warPerformance.regularWarLegacyBaselineByTag === "object" &&
		Object.prototype.hasOwnProperty.call(warPerformance.regularWarLegacyBaselineByTag, tag)
	) {
		delete warPerformance.regularWarLegacyBaselineByTag[tag];
		changed = true;
		regularHistoryOrBaselineChanged = true;
	}
	if (warPerformance && warPerformance.regularWarHistoryByKey && typeof warPerformance.regularWarHistoryByKey === "object") {
		const historyByKey = sanitizeRegularWarHistoryByKey_(warPerformance.regularWarHistoryByKey);
		const warKeys = Object.keys(historyByKey);
		let historyChanged = false;
		for (let i = 0; i < warKeys.length; i++) {
			const warKey = warKeys[i];
			const entry = sanitizeRegularWarHistoryEntry_(historyByKey[warKey], warKey);
			if (!entry || !entry.statsByTag || typeof entry.statsByTag !== "object") continue;
			if (!Object.prototype.hasOwnProperty.call(entry.statsByTag, tag)) continue;
			delete entry.statsByTag[tag];
			historyChanged = true;
			if (Object.keys(entry.statsByTag).length < 1) {
				delete historyByKey[warKey];
			} else {
				historyByKey[warKey] = sanitizeRegularWarHistoryEntry_(entry, warKey);
			}
		}
		if (historyChanged) {
			warPerformance.regularWarHistoryByKey = historyByKey;
			changed = true;
			regularHistoryOrBaselineChanged = true;
		}
	}
	if (warPerformance && regularHistoryOrBaselineChanged) {
		rebuildRegularWarAggregatesFromHistory_(warPerformance, new Date().toISOString());
	}

	return changed;
}

// Evict owned source tags from other rosters.
function evictOwnedSourceTagsFromOtherRosters_(rosterData, ownerRosterIdRaw, sourceTagsRaw, ownerRosterIdByTagRaw) {
	const ownerRosterId = String(ownerRosterIdRaw == null ? "" : ownerRosterIdRaw).trim();
	const sourceTags = Array.isArray(sourceTagsRaw) ? sourceTagsRaw : [];
	const ownerRosterIdByTag = ownerRosterIdByTagRaw && typeof ownerRosterIdByTagRaw === "object" ? ownerRosterIdByTagRaw : {};
	const ownedTagSet = {};
	const ownedTags = [];
	for (let i = 0; i < sourceTags.length; i++) {
		const tag = normalizeTag_(sourceTags[i]);
		if (!tag || ownedTagSet[tag]) continue;
		const owner = String(ownerRosterIdByTag[tag] || "").trim();
		if (owner && owner !== ownerRosterId) continue;
		ownedTagSet[tag] = true;
		ownedTags.push(tag);
	}

	const seedByTag = {};
	let removedFromOtherRosters = 0;
	if (!ownedTags.length) {
		return {
			ownedTagSet: ownedTagSet,
			ownedTags: ownedTags,
			seedByTag: seedByTag,
			removedFromOtherRosters: removedFromOtherRosters,
		};
	}

	const rosters = rosterData && Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		const rosterId = String(roster.id || "").trim();
		if (!rosterId || rosterId === ownerRosterId) continue;

		let changed = false;
		const removedTagSet = {};
		// Handle filter players.
		const filterPlayers = (playersRaw) => {
			const players = Array.isArray(playersRaw) ? playersRaw : [];
			const next = [];
			for (let j = 0; j < players.length; j++) {
				const player = players[j] && typeof players[j] === "object" ? players[j] : {};
				const tag = normalizeTag_(player.tag);
				if (tag && ownedTagSet[tag]) {
					changed = true;
					removedFromOtherRosters++;
					removedTagSet[tag] = true;
					if (!seedByTag[tag]) seedByTag[tag] = player;
					continue;
				}
				next.push(player);
			}
			return next;
		};

		const nextMain = filterPlayers(roster.main);
		const nextSubs = filterPlayers(roster.subs);
		const nextMissing = filterPlayers(roster.missing);
		if (!changed) continue;

		roster.main = nextMain;
		roster.subs = nextSubs;
		roster.missing = nextMissing;
		const removedTags = Object.keys(removedTagSet);
		for (let j = 0; j < removedTags.length; j++) {
			pruneTagFromRosterTrackingState_(roster, removedTags[j]);
		}
		normalizeRosterSlots_(roster);
		clearRosterBenchSuggestions_(roster);
	}

	return {
		ownedTagSet: ownedTagSet,
		ownedTags: ownedTags,
		seedByTag: seedByTag,
		removedFromOtherRosters: removedFromOtherRosters,
	};
}

// Apply roster pool sync.
function applyRosterPoolSync_(rosterData, roster, sourceMembers, sourceUsed, ownershipSnapshotRaw, nowIsoRaw) {
	const nowText = String(nowIsoRaw == null ? "" : nowIsoRaw).trim() || new Date().toISOString();
	const nowMs = parseIsoToMs_(nowText) || Date.now();
	if (!roster || typeof roster !== "object") throw new Error("Roster is required.");
	if (!Array.isArray(roster.main)) roster.main = [];
	if (!Array.isArray(roster.subs)) roster.subs = [];
	if (!Array.isArray(roster.missing)) roster.missing = [];

	const rosterId = String(roster.id || "").trim();
	const sourceList = Array.isArray(sourceMembers) ? sourceMembers : [];
	const ownershipSnapshot = ownershipSnapshotRaw && typeof ownershipSnapshotRaw === "object" ? ownershipSnapshotRaw : {};
	const ownerRosterIdByTag = ownershipSnapshot.ownerRosterIdByTag && typeof ownershipSnapshot.ownerRosterIdByTag === "object" ? ownershipSnapshot.ownerRosterIdByTag : {};
	const liveMemberByTag = ownershipSnapshot.liveMemberByTag && typeof ownershipSnapshot.liveMemberByTag === "object" ? ownershipSnapshot.liveMemberByTag : {};
	const seedPlayerByTag = ownershipSnapshot.seedPlayerByTag && typeof ownershipSnapshot.seedPlayerByTag === "object" ? ownershipSnapshot.seedPlayerByTag : {};

	const sourceByTag = {};
	for (let i = 0; i < sourceList.length; i++) {
		const member = sourceList[i] && typeof sourceList[i] === "object" ? sourceList[i] : {};
		const tag = normalizeTag_(member.tag);
		if (!tag || sourceByTag[tag]) continue;
		sourceByTag[tag] = member;
	}
	const sourceTags = Object.keys(sourceByTag);
	const ownershipMove = evictOwnedSourceTagsFromOtherRosters_(rosterData, rosterId, sourceTags, ownerRosterIdByTag);
	const sourceSet = ownershipMove.ownedTagSet;
	const ownedSourceTags = ownershipMove.ownedTags;
	const displacedSeedByTag = ownershipMove.seedByTag;

	// Deduplicate players while preserving first-seen order.
	const dedupePlayers = (playersRaw) => {
		const list = Array.isArray(playersRaw) ? playersRaw : [];
		const out = [];
		const seen = {};
		for (let i = 0; i < list.length; i++) {
			const player = list[i] && typeof list[i] === "object" ? list[i] : {};
			const tag = normalizeTag_(player.tag);
			if (!tag || seen[tag]) continue;
			seen[tag] = true;
			out.push(player);
		}
		return out;
	};

	// Mark from live.
	const markFromLive = (playerRaw) => {
		const player = playerRaw && typeof playerRaw === "object" ? playerRaw : {};
		const tag = normalizeTag_(player.tag);
		if (!tag) return;
		const live = sourceByTag[tag] || liveMemberByTag[tag];
		if (!live) return;
		applyLiveMemberToRosterPlayer_(player, live);
	};

	let main = dedupePlayers(roster.main);
	let subs = dedupePlayers(roster.subs);
	let missing = dedupePlayers(roster.missing);

	const trackedByTag = {};
	const trackedTags = [];
	const trackedPlayerByTag = {};
	// Handle collect tracked.
	const collectTracked = (playersRaw) => {
		const players = Array.isArray(playersRaw) ? playersRaw : [];
		for (let i = 0; i < players.length; i++) {
			const player = players[i] && typeof players[i] === "object" ? players[i] : {};
			const tag = normalizeTag_(player.tag);
			if (!tag || trackedByTag[tag]) continue;
			trackedByTag[tag] = true;
			trackedTags.push(tag);
			trackedPlayerByTag[tag] = player;
		}
	};
	collectTracked(main);
	collectTracked(subs);
	collectTracked(missing);

	const warPerformance = ensureWarPerformance_(roster);
	const membershipByTag = warPerformance.membershipByTag && typeof warPerformance.membershipByTag === "object" ? warPerformance.membershipByTag : {};
	warPerformance.membershipByTag = membershipByTag;
	// Ensure membership.
	const ensureMembership = (tag) => {
		const current = sanitizeRegularWarMembershipEntry_(membershipByTag[tag]);
		membershipByTag[tag] = current;
		return current;
	};
	// Set membership active.
	const setMembershipActive = (tag) => {
		const membership = ensureMembership(tag);
		if (!membership.firstSeenAt) membership.firstSeenAt = nowText;
		membership.lastSeenAt = nowText;
		membership.missingSince = "";
		membership.status = "active";
		membershipByTag[tag] = membership;
	};
	// Set membership temporary missing.
	const setMembershipTemporaryMissing = (tag) => {
		const membership = ensureMembership(tag);
		if (!membership.firstSeenAt) membership.firstSeenAt = nowText;
		const missingSinceMs = parseIsoToMs_(membership.missingSince);
		membership.missingSince = missingSinceMs > 0 ? membership.missingSince : nowText;
		membership.status = "temporaryMissing";
		membershipByTag[tag] = membership;
	};

	for (let i = 0; i < main.length; i++) markFromLive(main[i]);
	for (let i = 0; i < subs.length; i++) markFromLive(subs[i]);
	for (let i = 0; i < missing.length; i++) markFromLive(missing[i]);

	const updated = trackedTags.filter((tag) => sourceSet[tag]).length;
	for (let i = 0; i < trackedTags.length; i++) {
		const tag = trackedTags[i];
		if (!sourceSet[tag]) continue;
		setMembershipActive(tag);
	}

	let movedToMissing = 0;
	let removed = 0;
	let removedCrossOwned = 0;
	const missingSet = {};
	for (let i = 0; i < missing.length; i++) {
		const tag = normalizeTag_(missing[i] && missing[i].tag);
		if (!tag || missingSet[tag]) continue;
		missingSet[tag] = true;
	}

	const keptMain = [];
	for (let i = 0; i < main.length; i++) {
		const player = main[i] && typeof main[i] === "object" ? main[i] : {};
		const tag = normalizeTag_(player.tag);
		if (!tag) continue;
		if (sourceSet[tag]) {
			keptMain.push(player);
			continue;
		}
		const owner = String(ownerRosterIdByTag[tag] || "").trim();
		if (owner && owner !== rosterId) {
			removed++;
			removedCrossOwned++;
			pruneTagFromRosterTrackingState_(roster, tag);
			continue;
		}
		movedToMissing++;
		if (!missingSet[tag]) {
			missing.push(player);
			missingSet[tag] = true;
		}
		setMembershipTemporaryMissing(tag);
	}
	main = keptMain;

	const keptSubs = [];
	for (let i = 0; i < subs.length; i++) {
		const player = subs[i] && typeof subs[i] === "object" ? subs[i] : {};
		const tag = normalizeTag_(player.tag);
		if (!tag) continue;
		if (sourceSet[tag]) {
			keptSubs.push(player);
			continue;
		}
		const owner = String(ownerRosterIdByTag[tag] || "").trim();
		if (owner && owner !== rosterId) {
			removed++;
			removedCrossOwned++;
			pruneTagFromRosterTrackingState_(roster, tag);
			continue;
		}
		movedToMissing++;
		if (!missingSet[tag]) {
			missing.push(player);
			missingSet[tag] = true;
		}
		setMembershipTemporaryMissing(tag);
	}
	subs = keptSubs;

	const mainSet = {};
	const subsSet = {};
	for (let i = 0; i < main.length; i++) {
		const tag = normalizeTag_(main[i] && main[i].tag);
		if (tag) mainSet[tag] = true;
	}
	for (let i = 0; i < subs.length; i++) {
		const tag = normalizeTag_(subs[i] && subs[i].tag);
		if (tag) subsSet[tag] = true;
	}

	let restored = 0;
	let retainedMissing = 0;
	const nextMissing = [];
	for (let i = 0; i < missing.length; i++) {
		const player = missing[i] && typeof missing[i] === "object" ? missing[i] : {};
		const tag = normalizeTag_(player.tag);
		if (!tag) continue;

		if (sourceSet[tag]) {
			restored++;
			if (!mainSet[tag] && !subsSet[tag]) {
				subs.push(player);
				subsSet[tag] = true;
			}
			setMembershipActive(tag);
			continue;
		}

		const owner = String(ownerRosterIdByTag[tag] || "").trim();
		if (owner && owner !== rosterId) {
			removed++;
			removedCrossOwned++;
			pruneTagFromRosterTrackingState_(roster, tag);
			continue;
		}

		const membership = ensureMembership(tag);
		if (!membership.firstSeenAt) membership.firstSeenAt = nowText;
		if (!membership.missingSince || parseIsoToMs_(membership.missingSince) <= 0) membership.missingSince = nowText;
		membership.status = "temporaryMissing";
		membershipByTag[tag] = membership;
		const missingSinceMs = parseIsoToMs_(membership.missingSince);
		const expired = missingSinceMs > 0 && nowMs - missingSinceMs >= REGULAR_WAR_MISSING_GRACE_MS;
		if (expired) {
			removed++;
			pruneTagFromRosterTrackingState_(roster, tag);
			continue;
		}

		retainedMissing++;
		nextMissing.push(player);
	}
	missing = nextMissing;

	const presentSet = {};
	// Mark tags already present in the current roster sections.
	const markPresent = (playersRaw) => {
		const players = Array.isArray(playersRaw) ? playersRaw : [];
		for (let i = 0; i < players.length; i++) {
			const tag = normalizeTag_(players[i] && players[i].tag);
			if (tag) presentSet[tag] = true;
		}
	};
	markPresent(main);
	markPresent(subs);
	markPresent(missing);

	let added = 0;
	for (let i = 0; i < ownedSourceTags.length; i++) {
		const tag = ownedSourceTags[i];
		if (!tag || presentSet[tag]) continue;
		const source = sourceByTag[tag] || liveMemberByTag[tag];
		const seed = displacedSeedByTag[tag] || trackedPlayerByTag[tag] || seedPlayerByTag[tag];
		const player = createRosterPlayerFromSeed_(tag, seed, source);
		subs.push(player);
		presentSet[tag] = true;
		added++;
		setMembershipActive(tag);
	}
	subs.sort(compareByOrderingRule_);

	roster.main = main;
	roster.subs = subs;
	roster.missing = missing;
	roster.warPerformance = warPerformance;
	const dedupeResult = dedupeRosterSectionsByTag_(roster);
	if (dedupeResult.changed) {
		Logger.log(
			"applyRosterPoolSync_ deduped roster '%s': removed %s cross-section duplicate(s). %s",
			rosterId,
			dedupeResult.removedCount,
			summarizeRosterSectionDedupe_(dedupeResult, 6),
		);
	}

	if (added > 0 || movedToMissing > 0 || restored > 0 || removed > 0 || updated > 0 || dedupeResult.changed) {
		clearRosterBenchSuggestions_(roster);
	}

	return {
		added: added,
		removed: removed,
		removedCrossOwned: removedCrossOwned,
		updated: updated,
		movedToMissing: movedToMissing,
		restored: restored,
		retainedMissing: retainedMissing,
		sourceUsed: sourceUsed,
	};
}

// Apply regular war roster pool sync.
function applyRegularWarRosterPoolSync_(rosterData, roster, sourceMembers, nowIso, ownershipSnapshotRaw) {
	const nowText = String(nowIso == null ? "" : nowIso).trim() || new Date().toISOString();
	const nowMs = parseIsoToMs_(nowText) || Date.now();
	if (!roster || typeof roster !== "object") throw new Error("Roster is required.");
	if (!Array.isArray(roster.main)) roster.main = [];
	if (!Array.isArray(roster.subs)) roster.subs = [];
	if (!Array.isArray(roster.missing)) roster.missing = [];

	const rosterId = String(roster.id || "").trim();
	const sourceList = Array.isArray(sourceMembers) ? sourceMembers : [];
	const ownershipSnapshot = ownershipSnapshotRaw && typeof ownershipSnapshotRaw === "object" ? ownershipSnapshotRaw : {};
	const ownerRosterIdByTag = ownershipSnapshot.ownerRosterIdByTag && typeof ownershipSnapshot.ownerRosterIdByTag === "object" ? ownershipSnapshot.ownerRosterIdByTag : {};
	const liveMemberByTag = ownershipSnapshot.liveMemberByTag && typeof ownershipSnapshot.liveMemberByTag === "object" ? ownershipSnapshot.liveMemberByTag : {};
	const seedPlayerByTag = ownershipSnapshot.seedPlayerByTag && typeof ownershipSnapshot.seedPlayerByTag === "object" ? ownershipSnapshot.seedPlayerByTag : {};

	const sourceByTag = {};
	for (let i = 0; i < sourceList.length; i++) {
		const member = sourceList[i] && typeof sourceList[i] === "object" ? sourceList[i] : {};
		const tag = normalizeTag_(member.tag);
		if (!tag || sourceByTag[tag]) continue;
		sourceByTag[tag] = member;
	}
	const sourceTags = Object.keys(sourceByTag);
	const ownershipMove = evictOwnedSourceTagsFromOtherRosters_(rosterData, rosterId, sourceTags, ownerRosterIdByTag);
	const sourceSet = ownershipMove.ownedTagSet;
	const ownedSourceTags = ownershipMove.ownedTags;
	const displacedSeedByTag = ownershipMove.seedByTag;

	// Deduplicate players while preserving first-seen order.
	const dedupePlayers = (playersRaw) => {
		const list = Array.isArray(playersRaw) ? playersRaw : [];
		const out = [];
		const seen = {};
		for (let i = 0; i < list.length; i++) {
			const player = list[i] && typeof list[i] === "object" ? list[i] : {};
			const tag = normalizeTag_(player.tag);
			if (!tag || seen[tag]) continue;
			seen[tag] = true;
			out.push(player);
		}
		return out;
	};

	// Mark from live.
	const markFromLive = (playerRaw) => {
		const player = playerRaw && typeof playerRaw === "object" ? playerRaw : {};
		const tag = normalizeTag_(player.tag);
		if (!tag) return;
		const live = sourceByTag[tag] || liveMemberByTag[tag];
		if (!live) return;
		applyLiveMemberToRosterPlayer_(player, live);
	};

	let main = dedupePlayers(roster.main);
	let subs = dedupePlayers(roster.subs);
	let missing = dedupePlayers(roster.missing);

	const trackedByTag = {};
	const trackedTags = [];
	const trackedPlayerByTag = {};
	// Handle collect tracked.
	const collectTracked = (playersRaw) => {
		const players = Array.isArray(playersRaw) ? playersRaw : [];
		for (let i = 0; i < players.length; i++) {
			const player = players[i] && typeof players[i] === "object" ? players[i] : {};
			const tag = normalizeTag_(player.tag);
			if (!tag || trackedByTag[tag]) continue;
			trackedByTag[tag] = true;
			trackedTags.push(tag);
			trackedPlayerByTag[tag] = player;
		}
	};
	collectTracked(main);
	collectTracked(subs);
	collectTracked(missing);

	const regularWar = roster.regularWar && typeof roster.regularWar === "object" ? roster.regularWar : {};
	const byTag = regularWar.byTag && typeof regularWar.byTag === "object" ? regularWar.byTag : {};
	const membershipByTag = regularWar.membershipByTag && typeof regularWar.membershipByTag === "object" ? regularWar.membershipByTag : {};
	regularWar.byTag = byTag;
	regularWar.membershipByTag = membershipByTag;
	roster.regularWar = regularWar;

	// Ensure membership.
	const ensureMembership = (tag) => {
		const current = sanitizeRegularWarMembershipEntry_(membershipByTag[tag]);
		membershipByTag[tag] = current;
		return current;
	};
	// Set membership active.
	const setMembershipActive = (tag) => {
		const membership = ensureMembership(tag);
		if (!membership.firstSeenAt) membership.firstSeenAt = nowText;
		membership.lastSeenAt = nowText;
		membership.missingSince = "";
		membership.status = "active";
		membershipByTag[tag] = membership;
	};
	// Set membership temporary missing.
	const setMembershipTemporaryMissing = (tag) => {
		const membership = ensureMembership(tag);
		if (!membership.firstSeenAt) membership.firstSeenAt = nowText;
		membership.lastSeenAt = membership.lastSeenAt || "";
		const missingSinceMs = parseIsoToMs_(membership.missingSince);
		membership.missingSince = missingSinceMs > 0 ? membership.missingSince : nowText;
		membership.status = "temporaryMissing";
		membershipByTag[tag] = membership;
	};

	for (let i = 0; i < main.length; i++) markFromLive(main[i]);
	for (let i = 0; i < subs.length; i++) markFromLive(subs[i]);
	for (let i = 0; i < missing.length; i++) markFromLive(missing[i]);

	const updated = trackedTags.filter((tag) => sourceSet[tag]).length;
	for (let i = 0; i < trackedTags.length; i++) {
		const tag = trackedTags[i];
		if (!sourceSet[tag]) continue;
		setMembershipActive(tag);
	}

	let movedToMissing = 0;
	const missingSet = {};
	for (let i = 0; i < missing.length; i++) {
		const tag = normalizeTag_(missing[i] && missing[i].tag);
		if (!tag || missingSet[tag]) continue;
		missingSet[tag] = true;
	}

	let removed = 0;
	let removedCrossOwned = 0;

	const keptMain = [];
	for (let i = 0; i < main.length; i++) {
		const player = main[i] && typeof main[i] === "object" ? main[i] : {};
		const tag = normalizeTag_(player.tag);
		if (!tag) continue;
		if (sourceSet[tag]) {
			keptMain.push(player);
			continue;
		}

		const owner = String(ownerRosterIdByTag[tag] || "").trim();
		if (owner && owner !== rosterId) {
			removed++;
			removedCrossOwned++;
			delete byTag[tag];
			delete membershipByTag[tag];
			continue;
		}

		movedToMissing++;
		if (!missingSet[tag]) {
			missing.push(player);
			missingSet[tag] = true;
		}
		setMembershipTemporaryMissing(tag);
	}
	main = keptMain;

	const keptSubs = [];
	for (let i = 0; i < subs.length; i++) {
		const player = subs[i] && typeof subs[i] === "object" ? subs[i] : {};
		const tag = normalizeTag_(player.tag);
		if (!tag) continue;
		if (sourceSet[tag]) {
			keptSubs.push(player);
			continue;
		}

		const owner = String(ownerRosterIdByTag[tag] || "").trim();
		if (owner && owner !== rosterId) {
			removed++;
			removedCrossOwned++;
			delete byTag[tag];
			delete membershipByTag[tag];
			continue;
		}

		movedToMissing++;
		if (!missingSet[tag]) {
			missing.push(player);
			missingSet[tag] = true;
		}
		setMembershipTemporaryMissing(tag);
	}
	subs = keptSubs;

	const mainSet = {};
	const subsSet = {};
	for (let i = 0; i < main.length; i++) {
		const tag = normalizeTag_(main[i] && main[i].tag);
		if (tag) mainSet[tag] = true;
	}
	for (let i = 0; i < subs.length; i++) {
		const tag = normalizeTag_(subs[i] && subs[i].tag);
		if (tag) subsSet[tag] = true;
	}

	let restored = 0;
	let retainedMissing = 0;
	const nextMissing = [];
	for (let i = 0; i < missing.length; i++) {
		const player = missing[i] && typeof missing[i] === "object" ? missing[i] : {};
		const tag = normalizeTag_(player.tag);
		if (!tag) continue;
		if (sourceSet[tag]) {
			restored++;
			if (!mainSet[tag] && !subsSet[tag]) {
				subs.push(player);
				subsSet[tag] = true;
			}
			setMembershipActive(tag);
			continue;
		}

		const owner = String(ownerRosterIdByTag[tag] || "").trim();
		if (owner && owner !== rosterId) {
			removed++;
			removedCrossOwned++;
			delete byTag[tag];
			delete membershipByTag[tag];
			continue;
		}

		const membership = ensureMembership(tag);
		if (!membership.firstSeenAt) membership.firstSeenAt = nowText;
		if (!membership.missingSince || parseIsoToMs_(membership.missingSince) <= 0) membership.missingSince = nowText;
		membership.status = "temporaryMissing";
		membershipByTag[tag] = membership;
		const missingSinceMs = parseIsoToMs_(membership.missingSince);
		const expired = missingSinceMs > 0 && nowMs - missingSinceMs >= REGULAR_WAR_MISSING_GRACE_MS;
		if (expired) {
			removed++;
			delete byTag[tag];
			delete membershipByTag[tag];
			continue;
		}

		retainedMissing++;
		nextMissing.push(player);
	}
	missing = nextMissing;

	const presentSet = {};
	// Mark tags already present in the current roster sections.
	const markPresent = (playersRaw) => {
		const players = Array.isArray(playersRaw) ? playersRaw : [];
		for (let i = 0; i < players.length; i++) {
			const tag = normalizeTag_(players[i] && players[i].tag);
			if (tag) presentSet[tag] = true;
		}
	};
	markPresent(main);
	markPresent(subs);
	markPresent(missing);

	let added = 0;
	for (let i = 0; i < ownedSourceTags.length; i++) {
		const tag = ownedSourceTags[i];
		if (!tag || presentSet[tag]) continue;
		const source = sourceByTag[tag] || liveMemberByTag[tag];
		const seed = displacedSeedByTag[tag] || trackedPlayerByTag[tag] || seedPlayerByTag[tag];
		const player = createRosterPlayerFromSeed_(tag, seed, source);
		subs.push(player);
		presentSet[tag] = true;
		added++;
		setMembershipActive(tag);
	}
	subs.sort(compareByOrderingRule_);

	roster.main = main;
	roster.subs = subs;
	roster.missing = missing;
	const dedupeResult = dedupeRosterSectionsByTag_(roster);
	if (dedupeResult.changed) {
		Logger.log(
			"applyRegularWarRosterPoolSync_ deduped roster '%s': removed %s cross-section duplicate(s). %s",
			rosterId,
			dedupeResult.removedCount,
			summarizeRosterSectionDedupe_(dedupeResult, 6),
		);
	}

	const finalTagSet = buildRosterPoolTagSet_(roster);
	const byTagKeys = Object.keys(byTag);
	for (let i = 0; i < byTagKeys.length; i++) {
		const tag = normalizeTag_(byTagKeys[i]);
		if (!tag || finalTagSet[tag]) continue;
		delete byTag[byTagKeys[i]];
	}
	const membershipKeys = Object.keys(membershipByTag);
	for (let i = 0; i < membershipKeys.length; i++) {
		const tag = normalizeTag_(membershipKeys[i]);
		if (!tag || finalTagSet[tag]) continue;
		delete membershipByTag[membershipKeys[i]];
	}

	if (added > 0 || movedToMissing > 0 || restored > 0 || removed > 0 || dedupeResult.changed) {
		clearRosterBenchSuggestions_(roster);
	}

	return {
		mode: "regularWar",
		added: added,
		removed: removed,
		removedCrossOwned: removedCrossOwned,
		updated: updated,
		movedToMissing: movedToMissing,
		restored: restored,
		retainedMissing: retainedMissing,
		sourceUsed: "members",
	};
}

// Build CWL lineup unavailable noop result.
function buildCwlLineupUnavailableNoopResult_(rosterRaw, unavailableReasonRaw) {
	const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
	const result = {
		mode: "cwl",
		activeSet: Array.isArray(roster.main) ? roster.main.length : 0,
		benched: Array.isArray(roster.subs) ? roster.subs.length : 0,
		updated: 0,
		message: "no current CWL war found",
	};
	const unavailableReason = String(unavailableReasonRaw == null ? "" : unavailableReasonRaw).trim();
	if (unavailableReason) result.unavailableReason = unavailableReason;
	return result;
}

// Build CWL stats unavailable noop result.
function buildCwlStatsUnavailableNoopResult_(unavailableReasonRaw, messageRaw) {
	const unavailableReason = String(unavailableReasonRaw == null ? "" : unavailableReasonRaw).trim();
	const message = String(messageRaw == null ? "" : messageRaw).trim() || "CWL unavailable; stats unchanged";
	const result = {
		mode: "cwl",
		warsProcessed: 0,
		playersTracked: 0,
		cwlUnavailable: true,
		statsUnchanged: true,
		message: message,
	};
	if (unavailableReason) result.unavailableReason = unavailableReason;
	return result;
}

// Find current CWL war for clan.
function findCurrentCwlWarForClan_(clanTagRaw, warTagsRaw, optionsRaw) {
	const clanTag = normalizeTag_(clanTagRaw);
	const warTags = Array.isArray(warTagsRaw) ? warTagsRaw : [];
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const prefetchedCwlWarRawByTag = options.prefetchedCwlWarRawByTag && typeof options.prefetchedCwlWarRawByTag === "object" ? options.prefetchedCwlWarRawByTag : {};
	const prefetchedCwlWarErrorByTag = options.prefetchedCwlWarErrorByTag && typeof options.prefetchedCwlWarErrorByTag === "object" ? options.prefetchedCwlWarErrorByTag : {};
	for (let i = 0; i < warTags.length; i++) {
		const warTag = normalizeTag_(warTags[i]);
		if (!warTag || warTag === "#0") continue;

		let war = null;
		if (Object.prototype.hasOwnProperty.call(prefetchedCwlWarErrorByTag, warTag)) {
			const prefetchedErr = prefetchedCwlWarErrorByTag[warTag];
			if (prefetchedErr && Number(prefetchedErr.statusCode) === 404) continue;
			throw prefetchedErr;
		}
		if (Object.prototype.hasOwnProperty.call(prefetchedCwlWarRawByTag, warTag)) {
			war = prefetchedCwlWarRawByTag[warTag];
		} else {
			try {
				war = cocFetch_("/clanwarleagues/wars/" + encodeTagForPath_(warTag));
			} catch (err) {
				if (err && Number(err.statusCode) === 404) continue;
				throw err;
			}
		}
		if (!war || typeof war !== "object" || Array.isArray(war)) {
			throw new Error("Invalid CWL war payload for war tag " + warTag + ".");
		}
		const state = String((war && war.state) || "").toLowerCase();
		if (state !== "preparation" && state !== "inwar") continue;

		const side = pickWarSideForClan_(war, clanTag);
		if (!side) continue;

		return {
			warTag: warTag,
			warState: state,
			members: mapApiMembers_(side.members),
		};
	}
	return null;
}

// Apply today lineup sync.
function applyTodayLineupSync_(roster, participantsRaw) {
	const main = Array.isArray(roster && roster.main) ? roster.main : [];
	const subs = Array.isArray(roster && roster.subs) ? roster.subs : [];
	const rosterPool = main.concat(subs);
	const beforeMainOrder = main.map((player) => normalizeTag_(player && player.tag)).filter((tag) => tag);
	const beforeSubsOrder = subs.map((player) => normalizeTag_(player && player.tag)).filter((tag) => tag);

	const poolByTag = {};
	const poolTagsInOrder = [];
	for (let i = 0; i < rosterPool.length; i++) {
		const p = rosterPool[i] && typeof rosterPool[i] === "object" ? rosterPool[i] : {};
		const tag = normalizeTag_(p.tag);
		if (!tag || poolByTag[tag]) continue;
		poolByTag[tag] = p;
		poolTagsInOrder.push(tag);
	}

	const participantsAll = mapApiMembers_(participantsRaw);
	const participantsByTag = {};
	for (let i = 0; i < participantsAll.length; i++) {
		participantsByTag[participantsAll[i].tag] = participantsAll[i];
	}

	const participantsFiltered = participantsAll.filter((m) => !!poolByTag[m.tag]);
	const hasAnyMapPosition = participantsFiltered.some((m) => typeof m.mapPosition === "number" && isFinite(m.mapPosition));

	let orderedParticipantTags = [];
	if (hasAnyMapPosition) {
		const sorted = participantsFiltered.slice().sort((a, b) => {
			const aPos = typeof a.mapPosition === "number" && isFinite(a.mapPosition) ? a.mapPosition : Number.MAX_SAFE_INTEGER;
			const bPos = typeof b.mapPosition === "number" && isFinite(b.mapPosition) ? b.mapPosition : Number.MAX_SAFE_INTEGER;
			if (aPos !== bPos) return aPos - bPos;
			return compareByOrderingRule_(a, b);
		});
		orderedParticipantTags = sorted.map((x) => x.tag);
	} else {
		const wantedSet = {};
		for (let i = 0; i < participantsFiltered.length; i++) wantedSet[participantsFiltered[i].tag] = true;

		const ordered = [];
		for (let i = 0; i < poolTagsInOrder.length; i++) {
			const tag = poolTagsInOrder[i];
			if (wantedSet[tag]) ordered.push(tag);
		}

		const orderedSet = {};
		for (let i = 0; i < ordered.length; i++) orderedSet[ordered[i]] = true;
		const unplaced = participantsFiltered
			.filter((p) => !orderedSet[p.tag])
			.sort(compareByOrderingRule_)
			.map((p) => p.tag);

		orderedParticipantTags = ordered.concat(unplaced);
	}

	let updated = 0;
	for (let i = 0; i < orderedParticipantTags.length; i++) {
		const tag = orderedParticipantTags[i];
		const player = poolByTag[tag];
		const src = participantsByTag[tag];
		if (!player || !src) continue;

		let changed = false;
		if (src.name && src.name !== player.name) {
			player.name = src.name;
			changed = true;
		}
		if (typeof src.th === "number" && isFinite(src.th) && src.th > 0 && src.th !== player.th) {
			player.th = src.th;
			changed = true;
		}
		if (changed) updated++;
	}

	const participantSet = {};
	for (let i = 0; i < orderedParticipantTags.length; i++) participantSet[orderedParticipantTags[i]] = true;
	const nonParticipantTags = poolTagsInOrder.filter((tag) => !participantSet[tag]);
	const nonSet = {};
	for (let i = 0; i < nonParticipantTags.length; i++) nonSet[nonParticipantTags[i]] = true;

	const subsOrderedTags = [];
	for (let i = 0; i < subs.length; i++) {
		const tag = normalizeTag_(subs[i] && subs[i].tag);
		if (tag && nonSet[tag]) subsOrderedTags.push(tag);
	}
	const subsOrderedSet = {};
	for (let i = 0; i < subsOrderedTags.length; i++) subsOrderedSet[subsOrderedTags[i]] = true;

	for (let i = 0; i < main.length; i++) {
		const tag = normalizeTag_(main[i] && main[i].tag);
		if (tag && nonSet[tag] && !subsOrderedSet[tag]) {
			subsOrderedTags.push(tag);
			subsOrderedSet[tag] = true;
		}
	}

	const remainder = nonParticipantTags
		.filter((tag) => !subsOrderedSet[tag])
		.map((tag) => poolByTag[tag])
		.sort(compareByOrderingRule_)
		.map((p) => normalizeTag_(p && p.tag));
	for (let i = 0; i < remainder.length; i++) subsOrderedTags.push(remainder[i]);

	roster.main = orderedParticipantTags.map((tag) => poolByTag[tag]).filter(Boolean);
	roster.subs = subsOrderedTags.map((tag) => poolByTag[tag]).filter(Boolean);
	const dedupeResult = dedupeRosterSectionsByTag_(roster);
	if (dedupeResult.changed) {
		const rosterId = String((roster && roster.id) || "").trim() || "unknown";
		Logger.log(
			"applyTodayLineupSync_ deduped roster '%s': removed %s cross-section duplicate(s). %s",
			rosterId,
			dedupeResult.removedCount,
			summarizeRosterSectionDedupe_(dedupeResult, 6),
		);
	}

	const afterMainOrder = roster.main.map((player) => normalizeTag_(player && player.tag)).filter((tag) => tag);
	const afterSubsOrder = roster.subs.map((player) => normalizeTag_(player && player.tag)).filter((tag) => tag);
	if (beforeMainOrder.join("|") !== afterMainOrder.join("|") || beforeSubsOrder.join("|") !== afterSubsOrder.join("|") || updated > 0 || dedupeResult.changed) {
		clearRosterBenchSuggestions_(roster);
	}

	return {
		activeSet: roster.main.length,
		benched: roster.subs.length,
		updated: updated,
	};
}

// Sync clan roster pool core.
function syncClanRosterPoolCore_(rosterData, rosterId, optionsRaw) {
	const ctx = findRosterForClanSync_(rosterData, rosterId);
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const ownershipSnapshot =
		options.ownershipSnapshot && typeof options.ownershipSnapshot === "object"
			? options.ownershipSnapshot
			: buildLiveRosterOwnershipSnapshot_(ctx.rosterData, { recordMetrics: false });
	const memberTrackingByRosterId = ownershipSnapshot && ownershipSnapshot.memberTrackingByRosterId && typeof ownershipSnapshot.memberTrackingByRosterId === "object" ? ownershipSnapshot.memberTrackingByRosterId : {};
	const nowIso = new Date().toISOString();
	let result = null;
	const source = resolveRosterPoolSource_(ctx.clanTag, ctx.rosterId, ownershipSnapshot);
	if (ctx.trackingMode === "regularWar") {
		result = applyRegularWarRosterPoolSync_(ctx.rosterData, ctx.roster, source.members, nowIso, ownershipSnapshot);
	} else {
		result = applyRosterPoolSync_(ctx.rosterData, ctx.roster, source.members, source.sourceUsed, ownershipSnapshot, nowIso);
	}
	if (result && typeof result === "object") {
		result.memberTracking = memberTrackingByRosterId[ctx.rosterId] && typeof memberTrackingByRosterId[ctx.rosterId] === "object" ? memberTrackingByRosterId[ctx.rosterId] : null;
	}
	if (ctx.trackingMode === "cwl" && isCwlPreparationActive_(ctx.roster)) {
		const prepSummary = applyCwlPreparationRebalance_(ctx.roster, { enforceLockedInLimit: true, recordAppliedAt: true });
		if (result && typeof result === "object") result.cwlPreparation = prepSummary;
	}
	updateWarPerformanceMembership_(ctx.roster, nowIso);
	const outRosterData = validateRosterData_(ctx.rosterData);
	return { ok: true, rosterData: outRosterData, result: result };
}

// Sync clan today lineup core.
function syncClanTodayLineupCore_(rosterData, rosterId, optionsRaw) {
	const ctx = findRosterForClanSync_(rosterData, rosterId);
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const prefetchedCurrentRegularWarByClanTag =
		options.prefetchedCurrentRegularWarByClanTag && typeof options.prefetchedCurrentRegularWarByClanTag === "object" ? options.prefetchedCurrentRegularWarByClanTag : {};
	const prefetchedRegularWarErrorByClanTag =
		options.prefetchedRegularWarErrorByClanTag && typeof options.prefetchedRegularWarErrorByClanTag === "object" ? options.prefetchedRegularWarErrorByClanTag : {};
	const prefetchedLeaguegroupRawByClanTag =
		options.prefetchedLeaguegroupRawByClanTag && typeof options.prefetchedLeaguegroupRawByClanTag === "object" ? options.prefetchedLeaguegroupRawByClanTag : {};
	const prefetchedLeaguegroupErrorByClanTag =
		options.prefetchedLeaguegroupErrorByClanTag && typeof options.prefetchedLeaguegroupErrorByClanTag === "object" ? options.prefetchedLeaguegroupErrorByClanTag : {};
	const prefetchedCwlWarRawByTag = options.prefetchedCwlWarRawByTag && typeof options.prefetchedCwlWarRawByTag === "object" ? options.prefetchedCwlWarRawByTag : {};
	const prefetchedCwlWarErrorByTag = options.prefetchedCwlWarErrorByTag && typeof options.prefetchedCwlWarErrorByTag === "object" ? options.prefetchedCwlWarErrorByTag : {};
	if (ctx.trackingMode === "cwl" && isCwlPreparationActive_(ctx.roster)) {
		const prep = getRosterCwlPreparation_(ctx.roster);
		const outRosterData = validateRosterData_(ctx.rosterData);
		return {
			ok: true,
			rosterData: outRosterData,
			result: {
				mode: "cwl",
				activeSet: Array.isArray(ctx.roster.main) ? ctx.roster.main.length : 0,
				benched: Array.isArray(ctx.roster.subs) ? ctx.roster.subs.length : 0,
				updated: 0,
				cwlPreparationBlocked: true,
				rosterSize: normalizePreparationRosterSize_(prep && prep.rosterSize, CWL_PREPARATION_MIN_ROSTER_SIZE),
				message: "CWL Preparation Mode active; live CWL lineup sync blocked",
			},
		};
	}
	if (ctx.trackingMode === "regularWar") {
		let currentWar = null;
		if (Object.prototype.hasOwnProperty.call(prefetchedRegularWarErrorByClanTag, ctx.clanTag)) {
			throw prefetchedRegularWarErrorByClanTag[ctx.clanTag];
		}
		if (Object.prototype.hasOwnProperty.call(prefetchedCurrentRegularWarByClanTag, ctx.clanTag)) {
			currentWar = prefetchedCurrentRegularWarByClanTag[ctx.clanTag];
		} else {
			currentWar = fetchCurrentRegularWar_(ctx.clanTag);
		}
		const currentWarMeta = currentWar && currentWar.currentWarMeta && typeof currentWar.currentWarMeta === "object" ? currentWar.currentWarMeta : {};
		const unavailableReason = String((currentWarMeta && currentWarMeta.unavailableReason) || "").trim();
		if (unavailableReason === "privateWarLog") {
			const previousRegularWar = ctx.roster.regularWar && typeof ctx.roster.regularWar === "object" ? ctx.roster.regularWar : {};
			const previousCurrentWar = sanitizeRegularWarCurrentWar_(previousRegularWar.currentWar);
			const nextCurrentWar = Object.assign({}, previousCurrentWar);
			if (!nextCurrentWar.clanTag) nextCurrentWar.clanTag = ctx.clanTag;
			if (!nextCurrentWar.warKey || nextCurrentWar.warKey === "||") nextCurrentWar.warKey = normalizeTag_(ctx.clanTag) + "||";
			nextCurrentWar.available = false;
			nextCurrentWar.state = "notinwar";
			nextCurrentWar.unavailableReason = "privateWarLog";
			nextCurrentWar.statusMessage = "Live war data unavailable because the clan war log is private.";
			if (!ctx.roster.regularWar || typeof ctx.roster.regularWar !== "object") ctx.roster.regularWar = {};
			ctx.roster.regularWar.currentWar = nextCurrentWar;
			const outRosterData = validateRosterData_(ctx.rosterData);
			return {
				ok: true,
				rosterData: outRosterData,
				result: {
					mode: "regularWar",
					activeSet: Array.isArray(ctx.roster.main) ? ctx.roster.main.length : 0,
					benched: Array.isArray(ctx.roster.subs) ? ctx.roster.subs.length : 0,
					missing: Array.isArray(ctx.roster.missing) ? ctx.roster.missing.length : 0,
					updated: 0,
					unavailableReason: "privateWarLog",
					message: "current war lineup unavailable: private war log",
				},
			};
		}
		const state = String((currentWar && currentWar.state) || "")
			.trim()
			.toLowerCase();
		const isLiveRegularWar = state === "preparation" || state === "inwar";
		if (!isLiveRegularWar) {
			const outRosterData = validateRosterData_(ctx.rosterData);
			return {
				ok: true,
				rosterData: outRosterData,
				result: {
					mode: "regularWar",
					activeSet: Array.isArray(ctx.roster.main) ? ctx.roster.main.length : 0,
					benched: Array.isArray(ctx.roster.subs) ? ctx.roster.subs.length : 0,
					missing: Array.isArray(ctx.roster.missing) ? ctx.roster.missing.length : 0,
					updated: 0,
					message: "no current regular war found",
				},
			};
		}
		const result = applyTodayLineupSync_(ctx.roster, currentWar.participants);
		const outRosterData = validateRosterData_(ctx.rosterData);
		return {
			ok: true,
			rosterData: outRosterData,
			result: {
				mode: "regularWar",
				activeSet: result.activeSet,
				benched: result.benched,
				missing: Array.isArray(ctx.roster.missing) ? ctx.roster.missing.length : 0,
				updated: result.updated,
				message: "",
			},
		};
	}

	let leaguegroup = null;
	try {
		if (Object.prototype.hasOwnProperty.call(prefetchedLeaguegroupErrorByClanTag, ctx.clanTag)) {
			throw prefetchedLeaguegroupErrorByClanTag[ctx.clanTag];
		}
		if (Object.prototype.hasOwnProperty.call(prefetchedLeaguegroupRawByClanTag, ctx.clanTag)) {
			leaguegroup = mapLeagueGroupDataForClan_(ctx.clanTag, prefetchedLeaguegroupRawByClanTag[ctx.clanTag]);
		} else {
			leaguegroup = fetchLeagueGroupData_(ctx.clanTag);
		}
	} catch (err) {
		if (err && Number(err.statusCode) === 404) {
			const outRosterData = validateRosterData_(ctx.rosterData);
			return {
				ok: true,
				rosterData: outRosterData,
				result: buildCwlLineupUnavailableNoopResult_(ctx.roster, "leagueGroup404"),
			};
		}
		throw err;
	}

	if (!leaguegroup || leaguegroup.isMalformed) {
		throw new Error("Invalid CWL league group payload.");
	}
	if (!leaguegroup.clanFound) {
		const outRosterData = validateRosterData_(ctx.rosterData);
		return {
			ok: true,
			rosterData: outRosterData,
			result: buildCwlLineupUnavailableNoopResult_(ctx.roster, "clanNotInLeagueGroup"),
		};
	}
	if (!Array.isArray(leaguegroup.warTags) || !leaguegroup.warTags.length) {
		const outRosterData = validateRosterData_(ctx.rosterData);
		return {
			ok: true,
			rosterData: outRosterData,
			result: buildCwlLineupUnavailableNoopResult_(ctx.roster, "noWarTags"),
		};
	}

	const currentWar = findCurrentCwlWarForClan_(ctx.clanTag, leaguegroup.warTags, {
		prefetchedCwlWarRawByTag: prefetchedCwlWarRawByTag,
		prefetchedCwlWarErrorByTag: prefetchedCwlWarErrorByTag,
	});
	if (!currentWar) {
		const outRosterData = validateRosterData_(ctx.rosterData);
		return {
			ok: true,
			rosterData: outRosterData,
			result: buildCwlLineupUnavailableNoopResult_(ctx.roster, "noUsableWars"),
		};
	}

	const result = applyTodayLineupSync_(ctx.roster, currentWar.members);
	const outRosterData = validateRosterData_(ctx.rosterData);
	return {
		ok: true,
		rosterData: outRosterData,
		result: Object.assign({ mode: "cwl" }, result),
	};
}

// Refresh CWL stats core.
function refreshCwlStatsCore_(rosterData, rosterId, optionsRaw) {
	const ctx = findRosterForClanSync_(rosterData, rosterId);
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const prefetchedLeaguegroupRawByClanTag =
		options.prefetchedLeaguegroupRawByClanTag && typeof options.prefetchedLeaguegroupRawByClanTag === "object" ? options.prefetchedLeaguegroupRawByClanTag : {};
	const prefetchedLeaguegroupErrorByClanTag =
		options.prefetchedLeaguegroupErrorByClanTag && typeof options.prefetchedLeaguegroupErrorByClanTag === "object" ? options.prefetchedLeaguegroupErrorByClanTag : {};
	const prefetchedCwlWarRawByTag = options.prefetchedCwlWarRawByTag && typeof options.prefetchedCwlWarRawByTag === "object" ? options.prefetchedCwlWarRawByTag : {};
	const prefetchedCwlWarErrorByTag = options.prefetchedCwlWarErrorByTag && typeof options.prefetchedCwlWarErrorByTag === "object" ? options.prefetchedCwlWarErrorByTag : {};
	const nowIso = new Date().toISOString();
	let leaguegroup = null;
	try {
		if (Object.prototype.hasOwnProperty.call(prefetchedLeaguegroupErrorByClanTag, ctx.clanTag)) {
			throw prefetchedLeaguegroupErrorByClanTag[ctx.clanTag];
		}
		if (Object.prototype.hasOwnProperty.call(prefetchedLeaguegroupRawByClanTag, ctx.clanTag)) {
			leaguegroup = prefetchedLeaguegroupRawByClanTag[ctx.clanTag];
		} else {
			leaguegroup = cocFetch_("/clans/" + encodeTagForPath_(ctx.clanTag) + "/currentwar/leaguegroup");
		}
	} catch (err) {
		if (err && Number(err.statusCode) === 404) {
			const outRosterData = validateRosterData_(ctx.rosterData);
			return {
				ok: true,
				rosterData: outRosterData,
				result: buildCwlStatsUnavailableNoopResult_("leagueGroup404"),
			};
		}
		throw err;
	}

	const isMalformedLeaguegroup =
		!leaguegroup ||
		typeof leaguegroup !== "object" ||
		Array.isArray(leaguegroup) ||
		!Array.isArray(leaguegroup.clans) ||
		!Array.isArray(leaguegroup.rounds);
	if (isMalformedLeaguegroup) {
		throw new Error("Invalid CWL league group payload.");
	}

	const warTags = extractLeagueGroupWarTags_(leaguegroup);
	if (!leagueGroupContainsClan_(leaguegroup, ctx.clanTag)) {
		const outRosterData = validateRosterData_(ctx.rosterData);
		return {
			ok: true,
			rosterData: outRosterData,
			result: buildCwlStatsUnavailableNoopResult_("clanNotInLeagueGroup"),
		};
	}
	if (!warTags.length) {
		const outRosterData = validateRosterData_(ctx.rosterData);
		return {
			ok: true,
			rosterData: outRosterData,
			result: buildCwlStatsUnavailableNoopResult_("noWarTags"),
		};
	}

	const usableWars = [];
	let sawWarTag404 = false;
	for (let i = 0; i < warTags.length; i++) {
		const warTag = warTags[i];
		let war = null;
		if (Object.prototype.hasOwnProperty.call(prefetchedCwlWarErrorByTag, warTag)) {
			const prefetchedErr = prefetchedCwlWarErrorByTag[warTag];
			if (prefetchedErr && Number(prefetchedErr.statusCode) === 404) {
				sawWarTag404 = true;
				continue;
			}
			throw prefetchedErr;
		}
		if (Object.prototype.hasOwnProperty.call(prefetchedCwlWarRawByTag, warTag)) {
			war = prefetchedCwlWarRawByTag[warTag];
		} else {
			try {
				war = cocFetch_("/clanwarleagues/wars/" + encodeTagForPath_(warTag));
			} catch (err) {
				if (err && Number(err.statusCode) === 404) {
					sawWarTag404 = true;
					continue;
				}
				throw err;
			}
		}
		if (!war || typeof war !== "object" || Array.isArray(war)) {
			throw new Error("Invalid CWL war payload for war tag " + warTag + ".");
		}
		const warState = String((war && war.state) || "").toLowerCase();
		if (warState !== "inwar" && warState !== "warended") continue;

		const side = pickWarSideForClan_(war, ctx.clanTag);
		if (!side) continue;

		usableWars.push({
			warTag: warTag,
			war: war,
			warState: warState,
			side: side,
		});
	}
	if (!usableWars.length) {
		const outRosterData = validateRosterData_(ctx.rosterData);
		return {
			ok: true,
			rosterData: outRosterData,
			result: buildCwlStatsUnavailableNoopResult_(sawWarTag404 ? "warTag404" : "noUsableWars"),
		};
	}

	const warPerformance = prepareWarPerformanceForRefresh_(ctx.roster, nowIso);
	const rosterPoolTagSet = buildRosterPoolTagSet_(ctx.roster);
	const trackedHistoryTagSet = buildTrackedWarHistoryTagSet_(ctx.roster, warPerformance, nowIso);
	const byTag = {};
	let warsProcessed = 0;
	let finalizedCwlWars = 0;

	for (let i = 0; i < usableWars.length; i++) {
		const warTag = usableWars[i].warTag;
		const war = usableWars[i].war;
		const warState = usableWars[i].warState;
		const side = usableWars[i].side;
		warsProcessed++;
		if (warState === "warended") {
			const ingested = ingestCwlWarIntoWarPerformance_(warPerformance, war, warTag, ctx.clanTag, trackedHistoryTagSet, nowIso, "cwlRefreshWarEnded");
			if (ingested) finalizedCwlWars++;
		}

		const opponentSide = getOpponentSideForClan_(war, ctx.clanTag);
		const opponentThByTag = buildMemberThByTag_(opponentSide && opponentSide.members);

		const members = Array.isArray(side.members) ? side.members : [];
		for (let j = 0; j < members.length; j++) {
			const member = members[j] && typeof members[j] === "object" ? members[j] : {};
			const tag = normalizeTag_(member.tag);
			if (!tag || !rosterPoolTagSet[tag]) continue;

			if (!byTag[tag]) {
				byTag[tag] = createEmptyCwlStatEntry_();
			}

			const stats = byTag[tag];
			const attacks = Array.isArray(member.attacks) ? member.attacks : [];
			if (warState === "inwar" && attacks.length === 0) {
				stats.currentWarAttackPending = 1;
				continue;
			}

			const attackerTh = readTownHallLevel_(member);
			stats.daysInLineup++;
			stats.resolvedWarDays++;
			stats.attacksMade += attacks.length;
			if (attacks.length === 0) stats.missedAttacks++;

			for (let k = 0; k < attacks.length; k++) {
				const attack = attacks[k] && typeof attacks[k] === "object" ? attacks[k] : {};
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
		}
	}

	ctx.roster.cwlStats = {
		lastRefreshedAt: nowIso,
		season: typeof leaguegroup.season === "string" ? leaguegroup.season : "",
		byTag: byTag,
	};
	warPerformance.lastRefreshedAt = nowIso;
	ctx.roster.warPerformance = warPerformance;
	clearRosterBenchSuggestions_(ctx.roster);

	const outRosterData = validateRosterData_(ctx.rosterData);
	return {
		ok: true,
		rosterData: outRosterData,
		result: {
			mode: "cwl",
			warsProcessed: warsProcessed,
			playersTracked: Object.keys(byTag).length,
			finalizedCwlWars: finalizedCwlWars,
		},
	};
}

// Refresh regular war stats core.
function refreshRegularWarStatsCore_(rosterData, rosterId, optionsRaw) {
	const ctx = findRosterForClanSync_(rosterData, rosterId);
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const prefetchedCurrentRegularWarByClanTag =
		options.prefetchedCurrentRegularWarByClanTag && typeof options.prefetchedCurrentRegularWarByClanTag === "object" ? options.prefetchedCurrentRegularWarByClanTag : {};
	const prefetchedRegularWarErrorByClanTag =
		options.prefetchedRegularWarErrorByClanTag && typeof options.prefetchedRegularWarErrorByClanTag === "object" ? options.prefetchedRegularWarErrorByClanTag : {};
	const nowIso = new Date().toISOString();

	const previousRegularWar = ctx.roster.regularWar && typeof ctx.roster.regularWar === "object" ? ctx.roster.regularWar : {};
	const previousByTag = previousRegularWar.byTag && typeof previousRegularWar.byTag === "object" ? previousRegularWar.byTag : {};
	const previousMembershipByTag = previousRegularWar.membershipByTag && typeof previousRegularWar.membershipByTag === "object" ? previousRegularWar.membershipByTag : {};
	const previousCurrentWarMeta = sanitizeRegularWarCurrentWar_(previousRegularWar.currentWar);

	const warPerformance = prepareWarPerformanceForRefresh_(ctx.roster, nowIso);
	const previousSnapshot = sanitizeRegularWarSnapshot_(warPerformance.lastRegularWarSnapshot);
	const lifecycle = sanitizeRegularWarLifecycleState_(warPerformance.regularWarLifecycle);
	warPerformance.regularWarLifecycle = lifecycle;
	const trackedTagSet = buildRosterPoolTagSet_(ctx.roster);
	const trackedTags = Object.keys(trackedTagSet);

	let currentWar = null;
	if (Object.prototype.hasOwnProperty.call(prefetchedRegularWarErrorByClanTag, ctx.clanTag)) {
		throw prefetchedRegularWarErrorByClanTag[ctx.clanTag];
	}
	if (Object.prototype.hasOwnProperty.call(prefetchedCurrentRegularWarByClanTag, ctx.clanTag)) {
		currentWar = prefetchedCurrentRegularWarByClanTag[ctx.clanTag];
	} else {
		currentWar = fetchCurrentRegularWar_(ctx.clanTag);
	}
	const currentWarMetaBase = currentWar && currentWar.currentWarMeta && typeof currentWar.currentWarMeta === "object" ? currentWar.currentWarMeta : buildNoCurrentRegularWarResult_(ctx.clanTag).currentWarMeta;
	const fetchedCurrentWarMeta = sanitizeRegularWarCurrentWar_(Object.assign({}, currentWarMetaBase, { available: !!(currentWar && currentWar.available) }));
	const currentWarUnavailableReason = String(fetchedCurrentWarMeta.unavailableReason || "").trim();
	const isCurrentWarPrivate = currentWarUnavailableReason === "privateWarLog";
	const currentWarMeta = isCurrentWarPrivate ? Object.assign({}, previousCurrentWarMeta) : fetchedCurrentWarMeta;
	if (!currentWarMeta.clanTag) currentWarMeta.clanTag = ctx.clanTag;
	if (!currentWarMeta.warKey || currentWarMeta.warKey === "||") {
		currentWarMeta.warKey = getStableRegularWarKey_(currentWarMeta, ctx.clanTag);
	}
	if (!currentWarMeta.warKey || currentWarMeta.warKey === "||") currentWarMeta.warKey = normalizeTag_(ctx.clanTag) + "||";
	if (isCurrentWarPrivate) {
		currentWarMeta.available = false;
		currentWarMeta.state = "notinwar";
		currentWarMeta.unavailableReason = "privateWarLog";
		currentWarMeta.statusMessage = "Live war data unavailable because the clan war log is private.";
	} else {
		currentWarMeta.unavailableReason = "";
		currentWarMeta.statusMessage = "";
	}
	const currentWarState =
		String((currentWar && currentWar.state) || currentWarMeta.state || "")
			.trim()
			.toLowerCase() || "notinwar";
	currentWarMeta.state = currentWarState;

	const trackedHistoryTagSet = buildTrackedWarHistoryTagSet_(ctx.roster, warPerformance, nowIso);
	const liveSnapshot = isCurrentWarPrivate ? null : buildRegularWarLiveSnapshot_(currentWar, ctx.clanTag, trackedHistoryTagSet, nowIso);
	const currentLiveWarKey = liveSnapshot && liveSnapshot.warMeta ? String(liveSnapshot.warMeta.warKey || "").trim() : "";
	const previousActiveWarKey = String((lifecycle && lifecycle.activeWarKey) || (previousSnapshot && previousSnapshot.warMeta && previousSnapshot.warMeta.warKey) || "").trim();

	let finalization = { attempted: false, finalized: false, source: "", incomplete: false, reason: "" };
	const shouldFinalizePrevious = !isCurrentWarPrivate && shouldFinalizePreviousRegularWar_(previousActiveWarKey, currentLiveWarKey || currentWarMeta.warKey, currentWarState);
	if (shouldFinalizePrevious) {
		finalization = tryFinalizePreviousRegularWar_({
			warPerformance: warPerformance,
			previousWarKey: previousActiveWarKey,
			currentWar: currentWar,
			currentWarMeta: liveSnapshot && liveSnapshot.warMeta ? liveSnapshot.warMeta : currentWarMeta,
			previousSnapshot: previousSnapshot,
			clanTag: ctx.clanTag,
			trackedTagSet: trackedHistoryTagSet,
			nowIso: nowIso,
		});
	}

	if (!previousActiveWarKey && liveSnapshot && currentWarState === "warended" && currentLiveWarKey) {
		finalization = tryFinalizePreviousRegularWar_({
			warPerformance: warPerformance,
			previousWarKey: currentLiveWarKey,
			currentWar: currentWar,
			currentWarMeta: liveSnapshot.warMeta,
			previousSnapshot: liveSnapshot,
			clanTag: ctx.clanTag,
			trackedTagSet: trackedHistoryTagSet,
			nowIso: nowIso,
		});
	}
	const repairResult = attemptRepairIncompleteRegularWarHistory_({
		warPerformance: warPerformance,
		clanTag: ctx.clanTag,
		trackedTagSet: trackedHistoryTagSet,
		nowIso: nowIso,
	});

	const nextLifecycle = sanitizeRegularWarLifecycleState_(warPerformance.regularWarLifecycle);
	const keepPendingPreviousWar = !isCurrentWarPrivate && !liveSnapshot && !!previousActiveWarKey && !!shouldFinalizePrevious && !!(finalization && finalization.attempted) && !(finalization && finalization.finalized);
	if (isCurrentWarPrivate) {
		nextLifecycle.activeWarKey = previousActiveWarKey || nextLifecycle.activeWarKey;
		nextLifecycle.activeWarState = nextLifecycle.activeWarState || "notinwar";
		nextLifecycle.activeWarLastSeenAt = nextLifecycle.activeWarLastSeenAt || nowIso;
	} else if (liveSnapshot && currentWarState !== "warended") {
		nextLifecycle.activeWarKey = String(liveSnapshot.warMeta && liveSnapshot.warMeta.warKey ? liveSnapshot.warMeta.warKey : "");
		nextLifecycle.activeWarState = currentWarState;
		nextLifecycle.activeWarLastSeenAt = nowIso;
		warPerformance.lastRegularWarSnapshot = liveSnapshot;
	} else if (keepPendingPreviousWar) {
		nextLifecycle.activeWarKey = previousActiveWarKey;
		nextLifecycle.activeWarState = "pendingfinalization";
		nextLifecycle.activeWarLastSeenAt = nowIso;
	} else {
		nextLifecycle.activeWarKey = "";
		nextLifecycle.activeWarState = currentWarState || "notinwar";
		nextLifecycle.activeWarLastSeenAt = nowIso;
		if (liveSnapshot && currentWarState === "warended") {
			warPerformance.lastRegularWarSnapshot = liveSnapshot;
		}
	}
	if (finalization && finalization.finalized) {
		nextLifecycle.lastFinalizedWarKey = previousActiveWarKey || currentLiveWarKey || nextLifecycle.lastFinalizedWarKey;
		nextLifecycle.lastFinalizedAt = nowIso;
		nextLifecycle.lastFinalizationSource = String(finalization.source || "");
		nextLifecycle.lastFinalizationIncomplete = !!finalization.incomplete;
	}
	warPerformance.regularWarLifecycle = nextLifecycle;
	warPerformance.lastRefreshedAt = nowIso;
	ctx.roster.warPerformance = warPerformance;
	const aggregateMeta = buildRegularWarAggregateMetaFromWarPerformance_(warPerformance, repairResult, nowIso);

	const attacksPerMember = toNonNegativeInt_(currentWarMeta.attacksPerMember);
	const liveCurrentByTag = liveSnapshot && liveSnapshot.currentByTag && typeof liveSnapshot.currentByTag === "object" ? liveSnapshot.currentByTag : {};
	const byTag = {};
	for (let i = 0; i < trackedTags.length; i++) {
		const tag = trackedTags[i];
		const previousEntry = previousByTag[tag] && typeof previousByTag[tag] === "object" ? previousByTag[tag] : {};
		let currentEntry = createEmptyRegularWarCurrentEntry_(attacksPerMember);
		if (isCurrentWarPrivate && previousEntry.current) {
			currentEntry = sanitizeRegularWarCurrentEntry_(previousEntry.current, previousEntry.current && previousEntry.current.attacksAllowed);
		} else if (Object.prototype.hasOwnProperty.call(liveCurrentByTag, tag)) {
			currentEntry = sanitizeRegularWarCurrentEntry_(liveCurrentByTag[tag], attacksPerMember);
		}

		const perfEntry = warPerformance && warPerformance.byTag && typeof warPerformance.byTag === "object" && warPerformance.byTag[tag] && typeof warPerformance.byTag[tag] === "object" ? warPerformance.byTag[tag] : null;
		const perfRegular = perfEntry && perfEntry.regular ? sanitizeWarPerformanceStatsEntry_(perfEntry.regular) : null;
		const aggregateEntry = perfRegular
			? sanitizeRegularWarAggregateEntry_({
					warsInLineup: perfRegular.warsInLineup,
					attacksMade: perfRegular.attacksMade,
					attacksMissed: perfRegular.attacksMissed,
					starsTotal: perfRegular.starsTotal,
					totalDestruction: perfRegular.totalDestruction,
					countedAttacks: perfRegular.countedAttacks,
					threeStarCount: perfRegular.threeStarCount,
					hitUpCount: perfRegular.hitUpCount,
					sameThHitCount: perfRegular.sameThHitCount,
					hitDownCount: perfRegular.hitDownCount,
				})
			: previousEntry.aggregate
				? sanitizeRegularWarAggregateEntry_(previousEntry.aggregate)
				: createEmptyRegularWarAggregateEntry_();
		byTag[tag] = {
			current: sanitizeRegularWarCurrentEntry_(currentEntry, attacksPerMember),
			aggregate: aggregateEntry,
		};
	}

	const membershipByTag = {};
	// Rebuild tracked membership state from the roster's current sections.
	const setMembership = (playersRaw, role) => {
		const players = Array.isArray(playersRaw) ? playersRaw : [];
		for (let i = 0; i < players.length; i++) {
			const tag = normalizeTag_(players[i] && players[i].tag);
			if (!tag || !trackedTagSet[tag]) continue;
			const previousMembership = sanitizeRegularWarMembershipEntry_(previousMembershipByTag[tag]);
			const isMissing = role === "temporaryMissing";
			membershipByTag[tag] = {
				firstSeenAt: previousMembership.firstSeenAt || nowIso,
				lastSeenAt: isMissing ? previousMembership.lastSeenAt || "" : nowIso,
				missingSince: isMissing ? previousMembership.missingSince || nowIso : "",
				status: isMissing ? "temporaryMissing" : "active",
			};
		}
	};
	setMembership(ctx.roster.main, "active");
	setMembership(ctx.roster.subs, "active");
	setMembership(ctx.roster.missing, "temporaryMissing");

	ctx.roster.regularWar = {
		lastRefreshedAt: nowIso,
		currentWar: currentWarMeta,
		aggregateMeta: sanitizeRegularWarAggregateMeta_(aggregateMeta),
		byTag: byTag,
		membershipByTag: membershipByTag,
	};
	updateWarPerformanceMembership_(ctx.roster, nowIso);
	const refreshedWarPerformance = ensureWarPerformance_(ctx.roster);
	ctx.roster.warPerformance = refreshedWarPerformance;
	const aggregateMetaFinal = buildRegularWarAggregateMetaFromWarPerformance_(refreshedWarPerformance, repairResult, nowIso);
	ctx.roster.regularWar.aggregateMeta = sanitizeRegularWarAggregateMeta_(aggregateMetaFinal);
	clearRosterBenchSuggestions_(ctx.roster);

	const outRosterData = validateRosterData_(ctx.rosterData);
	return {
		ok: true,
		rosterData: outRosterData,
		result: {
			mode: "regularWar",
			currentWarState: currentWarState,
			playersTracked: trackedTags.length,
			warsProcessed: toNonNegativeInt_(aggregateMetaFinal.warsTracked),
			warLogAvailable: toBooleanFlag_(aggregateMetaFinal.warLogAvailable),
			finalizationAttempted: !!(finalization && finalization.attempted),
			finalizedRegularWar: !!(finalization && finalization.finalized),
			finalizationSource: String((finalization && finalization.source) || ""),
			finalizationReason: String((finalization && finalization.reason) || ""),
			finalizationIncomplete: !!(finalization && finalization.incomplete),
			repairAttemptedWarCount: toNonNegativeInt_(repairResult && repairResult.attemptedWarCount),
			repairedWarCount: toNonNegativeInt_(repairResult && repairResult.repairedWarCount),
			teamSize: toNonNegativeInt_(currentWarMeta.teamSize),
			attacksPerMember: toNonNegativeInt_(currentWarMeta.attacksPerMember),
			currentWarUnavailableReason: String(currentWarMeta.unavailableReason || ""),
			currentWarStatusMessage: String(currentWarMeta.statusMessage || ""),
			aggregateUnavailableReason: String(aggregateMetaFinal && aggregateMetaFinal.unavailableReason ? aggregateMetaFinal.unavailableReason : ""),
			aggregateStatusMessage: String(aggregateMetaFinal && aggregateMetaFinal.statusMessage ? aggregateMetaFinal.statusMessage : ""),
		},
	};
}

// Refresh tracking stats core.
function refreshTrackingStatsCore_(rosterData, rosterId, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const prefetchedClanSnapshotsByTag = options.prefetchedClanSnapshotsByTag && typeof options.prefetchedClanSnapshotsByTag === "object" ? options.prefetchedClanSnapshotsByTag : {};
	const prefetchedClanErrorsByTag = options.prefetchedClanErrorsByTag && typeof options.prefetchedClanErrorsByTag === "object" ? options.prefetchedClanErrorsByTag : {};
	const metricsRunState = options.metricsRunState && typeof options.metricsRunState === "object" ? options.metricsRunState : null;
	const ctx = findRosterById_(rosterData, rosterId);
	let capture = null;
	let postCaptureRosterData = null;
	try {
		capture = captureMemberTrackingForRoster_(ctx.rosterData, ctx.rosterId, {
			continueOnError: true,
			metricsProfileMode: "always",
			runState: metricsRunState,
			prefetchedClanSnapshotsByTag: prefetchedClanSnapshotsByTag,
			prefetchedClanErrorsByTag: prefetchedClanErrorsByTag,
		});
		if (capture && capture.errors && capture.errors.length) {
			Logger.log(
				"refreshTrackingStatsCore metrics capture for roster '%s' had %s error(s), first=%s",
				ctx.rosterId,
				capture.errors.length,
				capture.errors[0] && capture.errors[0].message ? capture.errors[0].message : "",
			);
		}
	} catch (err) {
		Logger.log("refreshTrackingStatsCore metrics capture failed for roster '%s': %s", ctx.rosterId, errorMessage_(err));
	}
	if (capture) {
		try {
			// Keep a clean post-capture snapshot so later war-refresh failures can preserve metrics safely.
			postCaptureRosterData = validateRosterData_(ctx.rosterData);
		} catch (snapshotErr) {
			Logger.log("refreshTrackingStatsCore unable to create post-capture snapshot for roster '%s': %s", ctx.rosterId, errorMessage_(snapshotErr));
		}
	}
	const trackingMode = getRosterTrackingMode_(ctx.roster);
	let refresh = null;
	try {
		refresh = trackingMode === "regularWar" ? refreshRegularWarStatsCore_(ctx.rosterData, ctx.rosterId, options) : refreshCwlStatsCore_(ctx.rosterData, ctx.rosterId, options);
	} catch (err) {
		// Keep member metrics updates even when optional war endpoints are blocked by private war logs.
		if (capture && isPrivateWarLogError_(err)) {
			Logger.log("refreshTrackingStatsCore war refresh skipped for roster '%s' because war log is private: %s", ctx.rosterId, errorMessage_(err));
			return {
				ok: true,
				rosterData: postCaptureRosterData || validateRosterData_(ctx.rosterData),
				result: {
					mode: trackingMode,
					warDataSkipped: true,
					currentWarUnavailableReason: "privateWarLog",
					message: "war data unavailable: private war log",
					memberTracking: capture,
				},
			};
		}
		if (capture && postCaptureRosterData) {
			const warRefreshError = errorMessage_(err);
			const refreshLabel = trackingMode === "regularWar" ? "regular war refresh" : "CWL refresh";
			return {
				ok: false,
				rosterData: postCaptureRosterData,
				result: {
					mode: trackingMode,
					memberTracking: capture,
					partialFailure: true,
					warRefreshFailed: true,
					memberTrackingPreserved: true,
					warRefreshError: warRefreshError,
					message: "member tracking captured; " + refreshLabel + " failed: " + warRefreshError,
				},
				error: {
					step: trackingMode === "regularWar" ? "refreshRegularWarStats" : "refreshCwlStats",
					code: "warRefreshFailedAfterMemberTracking",
					message: warRefreshError,
				},
			};
		}
		throw err;
	}
	if (capture && refresh && refresh.result && typeof refresh.result === "object") {
		refresh.result.memberTracking = capture;
	}
	return refresh;
}
