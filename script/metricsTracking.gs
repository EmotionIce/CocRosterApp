// Player metrics capture, normalization, and tracking helpers.

// Sanitize metrics day key.
function sanitizeMetricsDayKey_(value) {
	const text = String(value == null ? "" : value).trim();
	return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

// Sanitize donation month key.
function sanitizeDonationMonthKey_(value) {
	const text = String(value == null ? "" : value).trim();
	const match = /^(\d{4})-(\d{2})$/.exec(text);
	if (!match) return "";
	const month = Number(match[2]);
	if (!isFinite(month) || month < 1 || month > 12) return "";
	return match[1] + "-" + match[2];
}

// Get donation month sort value.
function getDonationMonthSortValue_(value) {
	const key = sanitizeDonationMonthKey_(value);
	if (!key) return -1;
	const parts = key.split("-");
	const year = Number(parts[0]);
	const month = Number(parts[1]);
	if (!isFinite(year) || !isFinite(month)) return -1;
	return year * 12 + (month - 1);
}

// Sanitize metrics icon URLs.
function sanitizeMetricsIconUrls_(iconUrlsRaw) {
	const iconUrls = iconUrlsRaw && typeof iconUrlsRaw === "object" ? iconUrlsRaw : {};
	const out = {};
	const keys = ["tiny", "small", "medium"];
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		const value = String(iconUrls[key] == null ? "" : iconUrls[key]).trim();
		if (!value) continue;
		out[key] = value;
	}
	return Object.keys(out).length ? out : null;
}

// Sanitize metrics league snapshot.
function sanitizeMetricsLeagueSnapshot_(leagueRaw) {
	const league = leagueRaw && typeof leagueRaw === "object" ? leagueRaw : null;
	if (!league) return null;

	const id = toNonNegativeInt_(league.id);
	const name = String(league.name == null ? "" : league.name).trim();
	const iconUrls = sanitizeMetricsIconUrls_(league.iconUrls);
	if (!id && !name && !iconUrls) return null;

	const out = {};
	if (id > 0) out.id = id;
	if (name) out.name = name;
	if (iconUrls) out.iconUrls = iconUrls;
	return out;
}

// Sanitize metrics player house snapshot.
function sanitizeMetricsPlayerHouseSnapshot_(playerHouseRaw) {
	const playerHouse = playerHouseRaw && typeof playerHouseRaw === "object" ? playerHouseRaw : null;
	if (!playerHouse) return null;
	const elementsRaw = Array.isArray(playerHouse.elements) ? playerHouse.elements : [];
	const outElements = [];
	for (let i = 0; i < elementsRaw.length && outElements.length < PLAYER_METRICS_PLAYER_HOUSE_MAX_ELEMENTS; i++) {
		const element = elementsRaw[i] && typeof elementsRaw[i] === "object" ? elementsRaw[i] : {};
		const id = toNonNegativeInt_(element.id);
		const type = String(element.type == null ? "" : element.type)
			.trim()
			.slice(0, 40);
		if (!id && !type) continue;
		const outElement = {};
		if (id > 0) outElement.id = id;
		if (type) outElement.type = type;
		outElements.push(outElement);
	}
	if (!outElements.length) return null;
	return { elements: outElements };
}

// Sanitize metrics snapshot payload.
function sanitizeMetricsSnapshotPayload_(snapshotRaw, fallbackTagRaw) {
	const snapshot = snapshotRaw && typeof snapshotRaw === "object" ? snapshotRaw : {};
	const tag = normalizeTag_(snapshot.tag || fallbackTagRaw);
	if (!tag) return null;

	const out = {
		tag: tag,
		trophies: toNonNegativeInt_(snapshot.trophies),
		donations: toNonNegativeInt_(snapshot.donations),
		donationsReceived: toNonNegativeInt_(snapshot.donationsReceived),
	};

	const name = String(snapshot.name == null ? "" : snapshot.name).trim();
	if (name) out.name = name;

	const th = readTownHallLevel_(snapshot);
	if (isFinite(th) && th > 0) {
		out.townHallLevel = Math.floor(th);
		out.th = Math.floor(th);
	}

	if (snapshot.expLevel != null) out.expLevel = toNonNegativeInt_(snapshot.expLevel);
	if (snapshot.builderBaseTrophies != null) out.builderBaseTrophies = toNonNegativeInt_(snapshot.builderBaseTrophies);
	if (snapshot.clanRank != null) out.clanRank = toNonNegativeInt_(snapshot.clanRank);
	if (snapshot.previousClanRank != null) out.previousClanRank = toNonNegativeInt_(snapshot.previousClanRank);

	const mapPositionRaw = Number(snapshot.mapPosition);
	if (isFinite(mapPositionRaw)) out.mapPosition = Math.max(0, Math.floor(mapPositionRaw));

	const clanTag = normalizeTag_(snapshot.clanTag);
	if (clanTag) out.clanTag = clanTag;

	const capturedMs = parseIsoToMs_(snapshot.capturedAt);
	if (capturedMs > 0) out.capturedAt = new Date(capturedMs).toISOString();

	const league = sanitizeMetricsLeagueSnapshot_(snapshot.league);
	if (league) out.league = league;
	const leagueTier = sanitizeMetricsLeagueSnapshot_(snapshot.leagueTier);
	if (leagueTier) out.leagueTier = leagueTier;

	const builderBaseLeague = sanitizeMetricsLeagueSnapshot_(snapshot.builderBaseLeague);
	if (builderBaseLeague) out.builderBaseLeague = builderBaseLeague;

	const playerHouse = sanitizeMetricsPlayerHouseSnapshot_(snapshot.playerHouse);
	if (playerHouse) out.playerHouse = playerHouse;

	return out;
}

// Map API members for metrics snapshot.
function mapApiMembersForMetricsSnapshot_(membersRaw) {
	const out = [];
	const seen = {};
	const list = Array.isArray(membersRaw) ? membersRaw : [];
	for (let i = 0; i < list.length; i++) {
		const member = list[i] && typeof list[i] === "object" ? list[i] : {};
		const tag = normalizeTag_(member.tag);
		if (!tag || seen[tag]) continue;
		seen[tag] = true;

		const th = readTownHallLevel_(member);
		const snapshot = {
			tag: tag,
			name: String(member.name == null ? "" : member.name),
			trophies: toNonNegativeInt_(member.trophies),
			donations: toNonNegativeInt_(member.donations),
			donationsReceived: toNonNegativeInt_(member.donationsReceived),
		};
		if (isFinite(th) && th > 0) {
			snapshot.townHallLevel = Math.floor(th);
			snapshot.th = Math.floor(th);
		}
		if (member.expLevel != null) snapshot.expLevel = toNonNegativeInt_(member.expLevel);
		if (member.builderBaseTrophies != null) snapshot.builderBaseTrophies = toNonNegativeInt_(member.builderBaseTrophies);
		if (member.clanRank != null) snapshot.clanRank = toNonNegativeInt_(member.clanRank);
		if (member.previousClanRank != null) snapshot.previousClanRank = toNonNegativeInt_(member.previousClanRank);
		if (member.mapPosition != null) {
			const mapPosition = Number(member.mapPosition);
			if (isFinite(mapPosition)) snapshot.mapPosition = Math.max(0, Math.floor(mapPosition));
		}
		const leagueTier = sanitizeMetricsLeagueSnapshot_(member.leagueTier);
		if (leagueTier) snapshot.leagueTier = leagueTier;
		const league = sanitizeMetricsLeagueSnapshot_(member.league) || leagueTier;
		if (league) snapshot.league = league;
		const builderBaseLeague = sanitizeMetricsLeagueSnapshot_(member.builderBaseLeague);
		if (builderBaseLeague) snapshot.builderBaseLeague = builderBaseLeague;
		const playerHouse = sanitizeMetricsPlayerHouseSnapshot_(member.playerHouse);
		if (playerHouse) snapshot.playerHouse = playerHouse;
		out.push(snapshot);
	}
	return out;
}

// Sanitize metrics trophy history point.
function sanitizeMetricsTrophyHistoryPoint_(pointRaw) {
	const point = pointRaw && typeof pointRaw === "object" ? pointRaw : {};
	const dayKey = sanitizeMetricsDayKey_(point.dayKey);
	if (!dayKey) return null;

	const out = {
		dayKey: dayKey,
		trophies: toNonNegativeInt_(point.trophies),
	};

	const capturedMs = parseIsoToMs_(point.capturedAt);
	if (capturedMs > 0) out.capturedAt = new Date(capturedMs).toISOString();

	const clanTag = normalizeTag_(point.clanTag);
	if (clanTag) out.clanTag = clanTag;

	const league = sanitizeMetricsLeagueSnapshot_(point.league);
	if (league) out.league = league;

	return out;
}

// Sanitize metrics donation month ledger.
function sanitizeMetricsDonationMonthLedger_(ledgerRaw, monthKeyRaw) {
	const ledger = ledgerRaw && typeof ledgerRaw === "object" ? ledgerRaw : {};
	const monthKey = sanitizeDonationMonthKey_(monthKeyRaw || ledger.monthKey);
	if (!monthKey) return null;

	const out = {
		monthKey: monthKey,
		rawDonationsLastSeen: toNonNegativeInt_(ledger.rawDonationsLastSeen),
		rawDonationsReceivedLastSeen: toNonNegativeInt_(ledger.rawDonationsReceivedLastSeen),
		monthlyTotalDonations: toNonNegativeInt_(ledger.monthlyTotalDonations),
		monthlyTotalDonationsReceived: toNonNegativeInt_(ledger.monthlyTotalDonationsReceived),
		lastSeenAt: "",
		lastClanTag: "",
		resetCount: toNonNegativeInt_(ledger.resetCount),
		receivedResetCount: toNonNegativeInt_(ledger.receivedResetCount),
	};

	const lastSeenMs = parseIsoToMs_(ledger.lastSeenAt);
	if (lastSeenMs > 0) out.lastSeenAt = new Date(lastSeenMs).toISOString();

	const lastClanTag = normalizeTag_(ledger.lastClanTag);
	if (lastClanTag) out.lastClanTag = lastClanTag;

	return out;
}

// Create an empty player metrics store.
function createEmptyPlayerMetricsStore_() {
	return {
		schemaVersion: PLAYER_METRICS_SCHEMA_VERSION,
		updatedAt: "",
		byTag: {},
	};
}

// Create an empty player metrics entry.
function createEmptyPlayerMetricsEntry_(tagRaw, nameRaw) {
	const tag = normalizeTag_(tagRaw);
	return {
		identity: {
			tag: tag,
			name: String(nameRaw == null ? "" : nameRaw).trim(),
		},
		lastSeen: {},
		trophyHistoryDaily: [],
		donationMonths: {},
	};
}

// Handle are metrics snapshots equivalent.
function areMetricsSnapshotsEquivalent_(leftRaw, rightRaw) {
	const left = sanitizeMetricsSnapshotPayload_(leftRaw, "");
	const right = sanitizeMetricsSnapshotPayload_(rightRaw, "");
	if (!left || !right) return !left && !right;
	const l = Object.assign({}, left);
	const r = Object.assign({}, right);
	delete l.capturedAt;
	delete r.capturedAt;
	return JSON.stringify(l) === JSON.stringify(r);
}

// Handle are metrics trophy points equivalent.
function areMetricsTrophyPointsEquivalent_(leftRaw, rightRaw) {
	const left = sanitizeMetricsTrophyHistoryPoint_(leftRaw);
	const right = sanitizeMetricsTrophyHistoryPoint_(rightRaw);
	if (!left || !right) return !left && !right;
	return left.dayKey === right.dayKey && left.trophies === right.trophies && normalizeTag_(left.clanTag) === normalizeTag_(right.clanTag) && JSON.stringify(left.league || null) === JSON.stringify(right.league || null);
}

// Prune trophy history daily.
function pruneTrophyHistoryDaily_(historyRaw, nowDateRaw) {
	const history = Array.isArray(historyRaw) ? historyRaw : [];
	const nowDate = nowDateRaw instanceof Date ? nowDateRaw : new Date();
	const byDayKey = {};

	for (let i = 0; i < history.length; i++) {
		const point = sanitizeMetricsTrophyHistoryPoint_(history[i]);
		if (!point) continue;
		const existing = byDayKey[point.dayKey];
		if (!existing) {
			byDayKey[point.dayKey] = point;
			continue;
		}
		const existingMs = parseIsoToMs_(existing.capturedAt);
		const currentMs = parseIsoToMs_(point.capturedAt);
		if (currentMs >= existingMs) {
			byDayKey[point.dayKey] = point;
		}
	}

	const keys = Object.keys(byDayKey).sort();
	const cutoffDate = new Date(nowDate.getTime() - (PLAYER_METRICS_TROPHY_HISTORY_MAX_DAYS - 1) * 24 * 60 * 60 * 1000);
	const cutoffKey = getServerDateString_(cutoffDate);
	const pruned = [];
	for (let i = 0; i < keys.length; i++) {
		const dayKey = keys[i];
		if (dayKey < cutoffKey) continue;
		pruned.push(byDayKey[dayKey]);
	}
	if (pruned.length > PLAYER_METRICS_TROPHY_HISTORY_MAX_DAYS) {
		return pruned.slice(pruned.length - PLAYER_METRICS_TROPHY_HISTORY_MAX_DAYS);
	}
	return pruned;
}

// Prune donation months.
function pruneDonationMonths_(donationMonthsRaw) {
	const donationMonths = donationMonthsRaw && typeof donationMonthsRaw === "object" ? donationMonthsRaw : {};
	const keys = Object.keys(donationMonths)
		.map((key) => sanitizeDonationMonthKey_(key))
		.filter((key) => key)
		.sort((left, right) => getDonationMonthSortValue_(left) - getDonationMonthSortValue_(right));

	const limitedKeys = keys.length > PLAYER_METRICS_DONATION_MONTHS_MAX ? keys.slice(keys.length - PLAYER_METRICS_DONATION_MONTHS_MAX) : keys;
	const out = {};
	for (let i = 0; i < limitedKeys.length; i++) {
		const key = limitedKeys[i];
		const ledger = sanitizeMetricsDonationMonthLedger_(donationMonths[key], key);
		if (!ledger) continue;
		out[key] = ledger;
	}
	return out;
}

// Get player metrics entry evidence ms.
function getPlayerMetricsEntryEvidenceMs_(entryRaw) {
	const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
	let best = 0;
	// Handle keep best.
	const keepBest = (valueRaw) => {
		const ms = parseIsoToMs_(valueRaw);
		if (ms > best) best = ms;
	};

	const lastSeen = entry.lastSeen && typeof entry.lastSeen === "object" ? entry.lastSeen : {};
	keepBest(lastSeen.at);

	const latestSnapshot = entry.latestSnapshot && typeof entry.latestSnapshot === "object" ? entry.latestSnapshot : {};
	keepBest(latestSnapshot.capturedAt);

	const history = Array.isArray(entry.trophyHistoryDaily) ? entry.trophyHistoryDaily : [];
	for (let i = 0; i < history.length; i++) {
		const point = history[i] && typeof history[i] === "object" ? history[i] : {};
		keepBest(point.capturedAt);
		const dayKey = sanitizeMetricsDayKey_(point.dayKey);
		if (dayKey) {
			const dayMs = new Date(dayKey + "T00:00:00Z").getTime();
			if (isFinite(dayMs) && dayMs > best) best = dayMs;
		}
	}

	const donationMonths = entry.donationMonths && typeof entry.donationMonths === "object" ? entry.donationMonths : {};
	const donationKeys = Object.keys(donationMonths);
	for (let i = 0; i < donationKeys.length; i++) {
		const key = donationKeys[i];
		const ledger = donationMonths[key] && typeof donationMonths[key] === "object" ? donationMonths[key] : {};
		keepBest(ledger.lastSeenAt);
		const monthKey = sanitizeDonationMonthKey_(key);
		if (monthKey) {
			const monthMs = new Date(monthKey + "-01T00:00:00Z").getTime();
			if (isFinite(monthMs) && monthMs > best) best = monthMs;
		}
	}

	return best;
}

// Sanitize player metrics entry.
function sanitizePlayerMetricsEntry_(tagRaw, entryRaw, nowMsRaw, nowDateRaw) {
	const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
	const identity = entry.identity && typeof entry.identity === "object" ? entry.identity : {};
	const tag = normalizeTag_(tagRaw || identity.tag || (entry.latestSnapshot && entry.latestSnapshot.tag));
	if (!tag) return null;

	const nowMs = isFinite(Number(nowMsRaw)) ? Number(nowMsRaw) : Date.now();
	const nowDate = nowDateRaw instanceof Date ? nowDateRaw : new Date(nowMs);

	const latestSnapshot = sanitizeMetricsSnapshotPayload_(entry.latestSnapshot, tag);
	const nameCandidate = String(identity.name == null ? "" : identity.name).trim() || String(entry.name == null ? "" : entry.name).trim() || (latestSnapshot && latestSnapshot.name ? latestSnapshot.name : "");

	const lastSeenRaw = entry.lastSeen && typeof entry.lastSeen === "object" ? entry.lastSeen : {};
	const lastSeenAtMs = parseIsoToMs_(lastSeenRaw.at || entry.lastSeenAt);
	const lastSeen = {};
	if (lastSeenAtMs > 0) {
		lastSeen.at = new Date(lastSeenAtMs).toISOString();
	}
	const dayKey = sanitizeMetricsDayKey_(lastSeenRaw.dayKey || entry.lastSeenDayKey) || (lastSeen.at ? getServerDateString_(new Date(lastSeen.at)) : "");
	if (dayKey) lastSeen.dayKey = dayKey;
	const monthKey = sanitizeDonationMonthKey_(lastSeenRaw.monthKey || entry.lastSeenMonthKey) || (lastSeen.at ? getServerMonthKey_(new Date(lastSeen.at)) : dayKey ? dayKey.slice(0, 7) : "");
	if (monthKey) lastSeen.monthKey = monthKey;
	const lastSeenClanTag = normalizeTag_(lastSeenRaw.clanTag || entry.lastClanTag || (latestSnapshot && latestSnapshot.clanTag));
	if (lastSeenClanTag) lastSeen.clanTag = lastSeenClanTag;

	const trophyHistoryDaily = pruneTrophyHistoryDaily_(entry.trophyHistoryDaily, nowDate);
	const donationMonths = pruneDonationMonths_(entry.donationMonths);

	const out = {
		identity: {
			tag: tag,
			name: nameCandidate,
		},
		trophyHistoryDaily: trophyHistoryDaily,
		donationMonths: donationMonths,
	};
	if (latestSnapshot) out.latestSnapshot = latestSnapshot;
	if (Object.keys(lastSeen).length) out.lastSeen = lastSeen;

	const hasAnyData = !!out.latestSnapshot || out.trophyHistoryDaily.length > 0 || Object.keys(out.donationMonths).length > 0;
	if (!hasAnyData) return null;

	const retentionMs = PLAYER_METRICS_ENTRY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
	const evidenceMs = getPlayerMetricsEntryEvidenceMs_(out);
	if (evidenceMs > 0 && nowMs - evidenceMs > retentionMs) {
		return null;
	}

	return out;
}

// Sanitize player metrics store.
function sanitizePlayerMetricsStore_(storeRaw, nowIsoRaw) {
	const store = storeRaw && typeof storeRaw === "object" ? storeRaw : {};
	const nowMs = parseIsoToMs_(nowIsoRaw) || Date.now();
	const nowDate = new Date(nowMs);
	const updatedAtMs = parseIsoToMs_(store.updatedAt);
	const byTagRaw = store.byTag && typeof store.byTag === "object" ? store.byTag : {};
	const outByTag = {};
	const tagKeys = Object.keys(byTagRaw);
	for (let i = 0; i < tagKeys.length; i++) {
		const key = tagKeys[i];
		const sanitizedEntry = sanitizePlayerMetricsEntry_(key, byTagRaw[key], nowMs, nowDate);
		if (!sanitizedEntry) continue;
		const tag = sanitizeEntryTag_(sanitizedEntry);
		if (!tag) continue;
		outByTag[tag] = sanitizedEntry;
	}

	return {
		schemaVersion: PLAYER_METRICS_SCHEMA_VERSION,
		updatedAt: updatedAtMs > 0 ? new Date(updatedAtMs).toISOString() : "",
		byTag: outByTag,
	};
}

// Sanitize entry tag.
function sanitizeEntryTag_(entryRaw) {
	const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
	const identity = entry.identity && typeof entry.identity === "object" ? entry.identity : {};
	return normalizeTag_(identity.tag || (entry.latestSnapshot && entry.latestSnapshot.tag));
}

// Ensure player metrics store.
function ensurePlayerMetricsStore_(rosterData) {
	if (!rosterData || typeof rosterData !== "object") return createEmptyPlayerMetricsStore_();
	const sanitized = sanitizePlayerMetricsStore_(rosterData.playerMetrics, new Date().toISOString());
	rosterData.playerMetrics = sanitized;
	return sanitized;
}

// Ensure player metrics store shape without a full sanitize/prune pass.
function ensureMutablePlayerMetricsStoreWithoutSanitize_(rosterDataRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : null;
	if (!rosterData) return createEmptyPlayerMetricsStore_();
	const storeRaw = rosterData.playerMetrics && typeof rosterData.playerMetrics === "object" ? rosterData.playerMetrics : createEmptyPlayerMetricsStore_();
	const byTag = storeRaw.byTag && typeof storeRaw.byTag === "object" ? storeRaw.byTag : {};
	const out = {
		schemaVersion: PLAYER_METRICS_SCHEMA_VERSION,
		updatedAt: String(storeRaw.updatedAt == null ? "" : storeRaw.updatedAt).trim(),
		byTag: byTag,
	};
	rosterData.playerMetrics = out;
	return out;
}

// Handle count player metrics entries.
function countPlayerMetricsEntries_(storeRaw) {
	const store = storeRaw && typeof storeRaw === "object" ? storeRaw : {};
	const byTag = store.byTag && typeof store.byTag === "object" ? store.byTag : {};
	const keys = Object.keys(byTag);
	let count = 0;
	for (let i = 0; i < keys.length; i++) {
		if (normalizeTag_(keys[i])) count++;
	}
	return count;
}

// Handle list rosters needing metrics coverage repair.
function listRostersNeedingMetricsCoverageRepair_(rosterDataRaw, minCoverageRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const rosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	const store = rosterData.playerMetrics && typeof rosterData.playerMetrics === "object" ? rosterData.playerMetrics : {};
	const byTagRaw = store.byTag && typeof store.byTag === "object" ? store.byTag : {};
	const byTag = {};
	const keys = Object.keys(byTagRaw);
	for (let i = 0; i < keys.length; i++) {
		const normalized = normalizeTag_(keys[i]);
		if (!normalized) continue;
		byTag[normalized] = byTagRaw[keys[i]];
	}

	const minCoverage = Math.max(0, Math.min(1, Number(minCoverageRaw)));
	const out = [];
	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		const rosterId = String(roster.id == null ? "" : roster.id).trim();
		if (!rosterId) continue;

		const connectedClanTag = normalizeTag_(roster.connectedClanTag);
		const players = collectRosterPoolPlayers_(roster);
		const seen = {};
		let total = 0;
		let matched = 0;
		for (let j = 0; j < players.length; j++) {
			const tag = normalizeTag_(players[j] && players[j].tag);
			if (!tag || seen[tag]) continue;
			seen[tag] = true;
			total++;
			if (byTag[tag] && typeof byTag[tag] === "object") matched++;
		}

		if (total < 1) continue;
		const coverage = matched / total;
		if (coverage >= minCoverage) continue;
		out.push({
			rosterId: rosterId,
			clanTag: connectedClanTag,
			totalTags: total,
			matchedTags: matched,
			coverage: coverage,
		});
	}
	return out;
}

// Handle list connected clan tags for metrics.
function listConnectedClanTagsForMetrics_(rosterDataRaw, rosterIdFilterRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const rosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	const rosterIdFilter = String(rosterIdFilterRaw == null ? "" : rosterIdFilterRaw).trim();
	const seen = {};
	const out = [];

	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		const rosterId = String(roster.id || "").trim();
		if (rosterIdFilter && rosterId !== rosterIdFilter) continue;
		const clanTag = normalizeTag_(roster.connectedClanTag);
		if (!clanTag || seen[clanTag]) continue;
		seen[clanTag] = true;
		out.push(clanTag);
	}

	return out;
}

// Capture connected clan metrics.
function captureConnectedClanMetrics_(rosterDataRaw, optionsRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : null;
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const rosterIdFilter = String(options.rosterId == null ? "" : options.rosterId).trim();
	const continueOnError = options.continueOnError !== false;
	const deferStoreSanitize = options.deferStoreSanitize === true;
	const assumeStoreAlreadySanitized = options.assumeStoreAlreadySanitized === true;
	const prefetchedClanSnapshotsByTag = options.prefetchedClanSnapshotsByTag && typeof options.prefetchedClanSnapshotsByTag === "object" ? options.prefetchedClanSnapshotsByTag : {};
	const prefetchedClanErrorsByTag = options.prefetchedClanErrorsByTag && typeof options.prefetchedClanErrorsByTag === "object" ? options.prefetchedClanErrorsByTag : {};
	if (!rosterData) {
		return { attemptedClans: 0, capturedClans: 0, recorded: 0, updated: 0, errors: [], entryCount: 0, capturedTags: [] };
	}

	const clanTags = listConnectedClanTagsForMetrics_(rosterData, rosterIdFilter);
	const runState = options.runState && typeof options.runState === "object"
		? options.runState
		: { seenClanTags: {} };
	if (!runState.seenClanTags || typeof runState.seenClanTags !== "object") runState.seenClanTags = {};
	const errors = [];
	let capturedClans = 0;
	let recorded = 0;
	let updated = 0;
	const capturedTagSet = {};

	for (let i = 0; i < clanTags.length; i++) {
		const clanTag = clanTags[i];
		try {
			const hasPrefetchedError = Object.prototype.hasOwnProperty.call(prefetchedClanErrorsByTag, clanTag);
			if (hasPrefetchedError) throw prefetchedClanErrorsByTag[clanTag];
			const hasPrefetchedSnapshot = Object.prototype.hasOwnProperty.call(prefetchedClanSnapshotsByTag, clanTag);
			const snapshot = hasPrefetchedSnapshot ? prefetchedClanSnapshotsByTag[clanTag] : fetchClanMembersSnapshot_(clanTag);
			const metricsMembers = snapshot && snapshot.metricsMembers;
			const result = recordClanMemberMetricsSnapshot_(rosterData, clanTag, metricsMembers, {
				capturedAt: snapshot && snapshot.capturedAt,
				runState: runState,
				source: "captureConnectedClanMetrics",
				deferStoreSanitize: deferStoreSanitize,
				assumeStoreAlreadySanitized: assumeStoreAlreadySanitized,
				collectTags: true,
			});
			capturedClans++;
			recorded += toNonNegativeInt_(result && result.recorded);
			updated += toNonNegativeInt_(result && result.updated);
			const tags = result && Array.isArray(result.tags) ? result.tags : [];
			for (let j = 0; j < tags.length; j++) {
				const tag = normalizeTag_(tags[j]);
				if (!tag) continue;
				capturedTagSet[tag] = true;
			}
		} catch (err) {
			const message = errorMessage_(err);
			errors.push({ clanTag: clanTag, message: message });
			if (!continueOnError) throw err;
		}
	}

	if (!deferStoreSanitize) ensurePlayerMetricsStore_(rosterData);
	return {
		attemptedClans: clanTags.length,
		capturedClans: capturedClans,
		recorded: recorded,
		updated: updated,
		errors: errors,
		entryCount: countPlayerMetricsEntries_(rosterData.playerMetrics),
		profileEnriched: 0,
		profileAttempted: 0,
		capturedTags: Object.keys(capturedTagSet),
		deferredSanitize: deferStoreSanitize,
	};
}

// Capture member tracking for roster.
function captureMemberTrackingForRoster_(rosterDataRaw, rosterIdRaw, optionsRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : null;
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	if (!rosterData || !rosterId) {
		return { attemptedClans: 0, capturedClans: 0, recorded: 0, updated: 0, errors: [], entryCount: 0 };
	}
	const captureStartMs = Date.now();
	const runState = options.runState && typeof options.runState === "object" ? options.runState : {};
	if (!runState.seenClanTags || typeof runState.seenClanTags !== "object") runState.seenClanTags = {};
	const existingStore = rosterData.playerMetrics && typeof rosterData.playerMetrics === "object" ? rosterData.playerMetrics : null;
	const looksPreparedStore =
		!!existingStore &&
		Number(existingStore.schemaVersion) === PLAYER_METRICS_SCHEMA_VERSION &&
		existingStore.byTag &&
		typeof existingStore.byTag === "object";
	if (runState.metricsStorePrepared === true || looksPreparedStore) {
		ensureMutablePlayerMetricsStoreWithoutSanitize_(rosterData);
	} else {
		ensurePlayerMetricsStore_(rosterData);
	}
	runState.metricsStorePrepared = true;

	const primaryStartMs = Date.now();
	const primary = captureConnectedClanMetrics_(rosterData, {
		rosterId: rosterId,
		continueOnError: options.continueOnError !== false,
		runState: runState,
		prefetchedClanSnapshotsByTag: options.prefetchedClanSnapshotsByTag,
		prefetchedClanErrorsByTag: options.prefetchedClanErrorsByTag,
		deferStoreSanitize: true,
		assumeStoreAlreadySanitized: true,
	});
	const primaryDurationMs = Math.max(0, Date.now() - primaryStartMs);
	const finalErrors = [].concat(primary && Array.isArray(primary.errors) ? primary.errors : []);

	const finalizeStartMs = Date.now();
	ensurePlayerMetricsStore_(rosterData);
	runState.metricsStorePrepared = true;
	const finalizeDurationMs = Math.max(0, Date.now() - finalizeStartMs);
	const totalDurationMs = Math.max(0, Date.now() - captureStartMs);

	return {
		attemptedClans: toNonNegativeInt_(primary && primary.attemptedClans),
		capturedClans: toNonNegativeInt_(primary && primary.capturedClans),
		recorded: toNonNegativeInt_(primary && primary.recorded),
		updated: toNonNegativeInt_(primary && primary.updated),
		errors: finalErrors,
		entryCount: countPlayerMetricsEntries_(rosterData.playerMetrics),
		profileAttempted: 0,
		profileEnriched: 0,
		usedProfileFallback: false,
		primaryRecorded: toNonNegativeInt_(primary && primary.recorded),
		fallbackRecorded: 0,
		fallbackSkippedPlayerTags: 0,
		fallbackSkippedByClanTag: 0,
		captureTimingMs: {
			primary: primaryDurationMs,
			fallback: 0,
			finalize: finalizeDurationMs,
			total: totalDurationMs,
		},
	};
}

// Build metrics capture context.
function buildMetricsCaptureContext_(capturedAtRaw) {
	const capturedMs = parseIsoToMs_(capturedAtRaw);
	const capturedAt = capturedMs > 0 ? new Date(capturedMs).toISOString() : new Date().toISOString();
	const capturedDate = new Date(capturedAt);
	return {
		capturedAt: capturedAt,
		capturedDate: capturedDate,
		dayKey: getServerDateString_(capturedDate),
		monthKey: getServerMonthKey_(capturedDate),
	};
}

// Handle upsert daily trophy history point.
function upsertDailyTrophyHistoryPoint_(entry, pointRaw, captureDateRaw) {
	const entryObj = entry && typeof entry === "object" ? entry : {};
	const point = sanitizeMetricsTrophyHistoryPoint_(pointRaw);
	if (!point) return false;
	const captureDate = captureDateRaw instanceof Date ? captureDateRaw : new Date();
	const history = Array.isArray(entryObj.trophyHistoryDaily) ? entryObj.trophyHistoryDaily.slice() : [];

	let replaced = false;
	for (let i = 0; i < history.length; i++) {
		const existing = sanitizeMetricsTrophyHistoryPoint_(history[i]);
		if (!existing || existing.dayKey !== point.dayKey) continue;
		if (!areMetricsTrophyPointsEquivalent_(existing, point)) {
			history[i] = point;
			replaced = true;
		}
		const prunedSameDay = pruneTrophyHistoryDaily_(history, captureDate);
		const changedSameDay = replaced || JSON.stringify(prunedSameDay) !== JSON.stringify(entryObj.trophyHistoryDaily || []);
		entryObj.trophyHistoryDaily = prunedSameDay;
		return changedSameDay;
	}

	history.push(point);
	const pruned = pruneTrophyHistoryDaily_(history, captureDate);
	const changed = JSON.stringify(pruned) !== JSON.stringify(entryObj.trophyHistoryDaily || []);
	entryObj.trophyHistoryDaily = pruned;
	return changed;
}

// Update donation ledger value.
function updateDonationLedgerValue_(ledger, rawValue, rawFieldName, totalFieldName, resetFieldName) {
	const state = ledger && typeof ledger === "object" ? ledger : {};
	const currentRaw = toNonNegativeInt_(rawValue);
	const hasPrevious = Object.prototype.hasOwnProperty.call(state, rawFieldName);
	const previousRaw = hasPrevious ? toNonNegativeInt_(state[rawFieldName]) : null;

	let delta = currentRaw;
	let resetDetected = false;
	if (previousRaw != null) {
		if (currentRaw >= previousRaw) {
			delta = currentRaw - previousRaw;
		} else {
			delta = currentRaw;
			resetDetected = true;
		}
	}

	state[rawFieldName] = currentRaw;
	state[totalFieldName] = toNonNegativeInt_(state[totalFieldName]) + delta;
	if (resetDetected) {
		state[resetFieldName] = toNonNegativeInt_(state[resetFieldName]) + 1;
	} else if (!Object.prototype.hasOwnProperty.call(state, resetFieldName)) {
		state[resetFieldName] = 0;
	}

	return {
		delta: delta,
		resetDetected: resetDetected,
	};
}

// Update monthly donation ledger for snapshot.
function updateMonthlyDonationLedgerForSnapshot_(entry, snapshotRaw, captureCtx) {
	const entryObj = entry && typeof entry === "object" ? entry : {};
	const snapshot = sanitizeMetricsSnapshotPayload_(snapshotRaw, "");
	const context = captureCtx && typeof captureCtx === "object" ? captureCtx : buildMetricsCaptureContext_("");
	if (!snapshot) return false;
	const monthKey = sanitizeDonationMonthKey_(context.monthKey);
	if (!monthKey) return false;

	const donationMonths = entryObj.donationMonths && typeof entryObj.donationMonths === "object" ? entryObj.donationMonths : {};
	const before = JSON.stringify(pruneDonationMonths_(donationMonths));
	const currentLedger = sanitizeMetricsDonationMonthLedger_(donationMonths[monthKey], monthKey) || {
		monthKey: monthKey,
		rawDonationsLastSeen: 0,
		rawDonationsReceivedLastSeen: 0,
		monthlyTotalDonations: 0,
		monthlyTotalDonationsReceived: 0,
		lastSeenAt: "",
		lastClanTag: "",
		resetCount: 0,
		receivedResetCount: 0,
	};

	const donationResult = updateDonationLedgerValue_(currentLedger, snapshot.donations, "rawDonationsLastSeen", "monthlyTotalDonations", "resetCount");
	const receivedResult = updateDonationLedgerValue_(currentLedger, snapshot.donationsReceived, "rawDonationsReceivedLastSeen", "monthlyTotalDonationsReceived", "receivedResetCount");

	if (donationResult.delta > 0 || receivedResult.delta > 0 || donationResult.resetDetected || receivedResult.resetDetected || !currentLedger.lastSeenAt) {
		currentLedger.lastSeenAt = context.capturedAt;
	}
	const clanTag = normalizeTag_(snapshot.clanTag);
	if (clanTag) currentLedger.lastClanTag = clanTag;

	donationMonths[monthKey] = currentLedger;
	entryObj.donationMonths = pruneDonationMonths_(donationMonths);
	const after = JSON.stringify(entryObj.donationMonths);
	return before !== after;
}

// Update player metrics entry from snapshot.
function updatePlayerMetricsEntryFromSnapshot_(entry, snapshotRaw, captureCtxRaw) {
	const entryObj = entry && typeof entry === "object" ? entry : {};
	const captureCtx = captureCtxRaw && typeof captureCtxRaw === "object" ? captureCtxRaw : buildMetricsCaptureContext_("");
	const snapshot = sanitizeMetricsSnapshotPayload_(snapshotRaw, "");
	if (!snapshot) return false;

	if (!snapshot.capturedAt) snapshot.capturedAt = captureCtx.capturedAt;
	if (!snapshot.clanTag && captureCtx.clanTag) snapshot.clanTag = captureCtx.clanTag;

	const tag = normalizeTag_(snapshot.tag);
	if (!tag) return false;

	const identity = entryObj.identity && typeof entryObj.identity === "object" ? entryObj.identity : {};
	const currentName = String(identity.name == null ? "" : identity.name).trim();
	const nextName = String(snapshot.name == null ? "" : snapshot.name).trim() || currentName;
	entryObj.identity = {
		tag: tag,
		name: nextName,
	};

	const currentLatest = sanitizeMetricsSnapshotPayload_(entryObj.latestSnapshot, tag);
	let latestChanged = false;
	if (!currentLatest || !areMetricsSnapshotsEquivalent_(currentLatest, snapshot)) {
		entryObj.latestSnapshot = snapshot;
		latestChanged = true;
	} else if (currentLatest && !currentLatest.capturedAt && snapshot.capturedAt) {
		currentLatest.capturedAt = snapshot.capturedAt;
		entryObj.latestSnapshot = currentLatest;
		latestChanged = true;
	}

	const point = {
		dayKey: captureCtx.dayKey,
		capturedAt: captureCtx.capturedAt,
		trophies: toNonNegativeInt_(snapshot.trophies),
		clanTag: normalizeTag_(snapshot.clanTag),
		league: sanitizeMetricsLeagueSnapshot_(snapshot.league),
	};
	const trophyChanged = upsertDailyTrophyHistoryPoint_(entryObj, point, captureCtx.capturedDate);
	const donationChanged = updateMonthlyDonationLedgerForSnapshot_(entryObj, snapshot, captureCtx);

	const lastSeen = entryObj.lastSeen && typeof entryObj.lastSeen === "object" ? entryObj.lastSeen : {};
	const lastSeenDayKey = sanitizeMetricsDayKey_(lastSeen.dayKey);
	const shouldUpdateLastSeen = lastSeenDayKey !== captureCtx.dayKey || latestChanged || trophyChanged || donationChanged || !lastSeen.dayKey;
	if (shouldUpdateLastSeen) {
		entryObj.lastSeen = {
			at: captureCtx.capturedAt,
			dayKey: captureCtx.dayKey,
			monthKey: captureCtx.monthKey,
			clanTag: normalizeTag_(snapshot.clanTag) || "",
		};
	}

	if (!Array.isArray(entryObj.trophyHistoryDaily)) entryObj.trophyHistoryDaily = [];
	if (!entryObj.donationMonths || typeof entryObj.donationMonths !== "object") entryObj.donationMonths = {};

	return latestChanged || trophyChanged || donationChanged || shouldUpdateLastSeen;
}

// Record clan member metrics snapshot.
function recordClanMemberMetricsSnapshot_(rosterData, clanTagRaw, membersRaw, optionsRaw) {
	const rosterDataSafe = rosterData && typeof rosterData === "object" ? rosterData : null;
	if (!rosterDataSafe) {
		return { recorded: 0, updated: 0, deduped: false, changed: false };
	}

	const clanTag = normalizeTag_(clanTagRaw);
	if (!clanTag) {
		return { recorded: 0, updated: 0, deduped: false, changed: false };
	}

	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const deferStoreSanitize = options.deferStoreSanitize === true;
	const assumeStoreAlreadySanitized = options.assumeStoreAlreadySanitized === true;
	const collectTags = options.collectTags === true;
	const runState = options.runState && typeof options.runState === "object" ? options.runState : null;
	if (runState) {
		if (!runState.seenClanTags || typeof runState.seenClanTags !== "object") runState.seenClanTags = {};
		if (runState.seenClanTags[clanTag]) {
			const dedupedResult = { recorded: 0, updated: 0, deduped: true, changed: false };
			if (collectTags) dedupedResult.tags = [];
			return dedupedResult;
		}
		runState.seenClanTags[clanTag] = true;
	}

	const captureCtx = buildMetricsCaptureContext_(options.capturedAt);
	captureCtx.clanTag = clanTag;
	const store = deferStoreSanitize ? ensureMutablePlayerMetricsStoreWithoutSanitize_(rosterDataSafe) : ensurePlayerMetricsStore_(rosterDataSafe);
	const byTag = store.byTag && typeof store.byTag === "object" ? store.byTag : {};
	store.byTag = byTag;

	const members = Array.isArray(membersRaw) ? membersRaw : [];
	let recorded = 0;
	let updated = 0;
	const touchedTags = collectTags ? {} : null;
	for (let i = 0; i < members.length; i++) {
		const baseSnapshot = sanitizeMetricsSnapshotPayload_(members[i], "");
		if (!baseSnapshot) continue;

		const tag = normalizeTag_(baseSnapshot.tag);
		if (!tag) continue;

		baseSnapshot.tag = tag;
		baseSnapshot.clanTag = clanTag;
		baseSnapshot.capturedAt = captureCtx.capturedAt;

		let currentEntry = null;
		if (assumeStoreAlreadySanitized) {
			const existingEntry = byTag[tag] && typeof byTag[tag] === "object" ? byTag[tag] : null;
			currentEntry = existingEntry || createEmptyPlayerMetricsEntry_(tag, baseSnapshot.name || "");
		} else {
			currentEntry = sanitizePlayerMetricsEntry_(tag, byTag[tag], captureCtx.capturedDate.getTime(), captureCtx.capturedDate) || createEmptyPlayerMetricsEntry_(tag, baseSnapshot.name || "");
		}
		const changed = updatePlayerMetricsEntryFromSnapshot_(currentEntry, baseSnapshot, captureCtx);
		byTag[tag] = currentEntry;
		recorded++;
		if (changed) updated++;
		if (touchedTags) touchedTags[tag] = true;
	}

	if (deferStoreSanitize) {
		if (updated > 0 || !store.updatedAt) store.updatedAt = captureCtx.capturedAt;
		rosterDataSafe.playerMetrics = store;
	} else {
		const sanitizedStore = sanitizePlayerMetricsStore_(store, captureCtx.capturedAt);
		if (updated > 0 || !sanitizedStore.updatedAt) {
			sanitizedStore.updatedAt = captureCtx.capturedAt;
		}
		rosterDataSafe.playerMetrics = sanitizedStore;
	}

	const out = {
		recorded: recorded,
		updated: updated,
		deduped: false,
		changed: updated > 0,
	};
	if (touchedTags) out.tags = Object.keys(touchedTags);
	return out;
}
