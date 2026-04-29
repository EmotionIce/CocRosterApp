// Roster schema sanitization and validation boundary.

// Sanitize notes.
function sanitizeNotes_(raw) {
	const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
	return arr.map((n) => String(n == null ? "" : n).trim()).filter((n) => n);
}

// Sanitize public config URL.
function sanitizePublicConfigUrl_(valueRaw) {
	const value = String(valueRaw == null ? "" : valueRaw).trim();
	if (!value) return "";
	return /^https?:\/\//i.test(value) ? value : "";
}

// Return whether plain object.
function isPlainObject_(valueRaw) {
	return !!(valueRaw && typeof valueRaw === "object" && !Array.isArray(valueRaw));
}

// Return whether safe profile object key.
function isSafePublicProfileKey_(keyRaw) {
	const key = String(keyRaw == null ? "" : keyRaw).trim();
	if (!key) return false;
	// Block prototype-mutating keys before copying dynamic objects.
	const normalized = key.toLowerCase();
	if (normalized === "__proto__" || normalized === "prototype" || normalized === "constructor") return false;
	return /^[A-Za-z0-9 _.#&'()-]{1,80}$/.test(key);
}

// Sanitize public profile node.
function sanitizePublicProfileNode_(valueRaw, depthRaw) {
	const depth = Math.max(0, toNonNegativeInt_(depthRaw));
	if (depth > 5) return null;

	if (valueRaw == null) return null;

	if (typeof valueRaw === "string") {
		const text = String(valueRaw).trim();
		return text ? text : null;
	}

	if (Array.isArray(valueRaw)) {
		const outArray = [];
		const maxItems = Math.min(30, valueRaw.length);
		for (let i = 0; i < maxItems; i++) {
			const next = sanitizePublicProfileNode_(valueRaw[i], depth + 1);
			if (next == null) continue;
			outArray.push(next);
		}
		return outArray.length ? outArray : null;
	}

	if (!isPlainObject_(valueRaw)) return null;

	const out = {};
	const keys = Object.keys(valueRaw);
	let copied = 0;
	for (let i = 0; i < keys.length; i++) {
		if (copied >= 80) break;
		const key = String(keys[i] == null ? "" : keys[i]).trim();
		if (!isSafePublicProfileKey_(key)) continue;
		const next = sanitizePublicProfileNode_(valueRaw[key], depth + 1);
		if (next == null) continue;
		out[key] = next;
		copied++;
	}
	return Object.keys(out).length ? out : null;
}

// Copy sanitized public config URLs.
function copySanitizedPublicConfigUrls_(target, source, keys) {
	if (!target || typeof target !== "object" || !source || typeof source !== "object" || !Array.isArray(keys)) return;
	for (let i = 0; i < keys.length; i++) {
		const key = String(keys[i] == null ? "" : keys[i]).trim();
		if (!key) continue;
		const value = sanitizePublicConfigUrl_(source[key]);
		if (value) target[key] = value;
	}
}

// Sanitize public config.
function sanitizePublicConfig_(raw) {
	const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
	if (!source) return null;

	const mediaKeys = ["bannerMediaUrl", "bannerUrl", "bannerGifUrl", "squareMediaUrl", "squareUrl", "squareGifUrl", "discordInviteUrl"];
	const out = {};
	copySanitizedPublicConfigUrls_(out, source, mediaKeys);

	const profile = sanitizePublicProfileNode_(source.profile, 0);
	if (profile) out.profile = profile;

	const landingSource = source.landing && typeof source.landing === "object" && !Array.isArray(source.landing) ? source.landing : null;
	if (landingSource) {
		const landingOut = {};
		copySanitizedPublicConfigUrls_(landingOut, landingSource, mediaKeys);
		const landingProfile = sanitizePublicProfileNode_(landingSource.profile, 0);
		if (landingProfile) landingOut.profile = landingProfile;
		if (Object.keys(landingOut).length) out.landing = landingOut;
		if (!out.profile && landingProfile) out.profile = landingProfile;
	}

	return Object.keys(out).length ? out : null;
}

// Sanitize roster public lineup projection.
function sanitizeRosterPublicLineupProjection_(rawProjection, rosterPoolTagSetRaw, trackingModeRaw) {
	if (!rawProjection || typeof rawProjection !== "object" || Array.isArray(rawProjection)) return null;
	const projection = rawProjection;
	const rosterPoolTagSet = rosterPoolTagSetRaw && typeof rosterPoolTagSetRaw === "object" ? rosterPoolTagSetRaw : {};
	const defaultTrackingMode = String(trackingModeRaw == null ? "" : trackingModeRaw).trim() === "regularWar" ? "regularWar" : "cwl";
	const projectionTrackingModeRaw = String(projection.trackingMode == null ? "" : projection.trackingMode).trim();
	const projectionTrackingMode = projectionTrackingModeRaw === "regularWar" || projectionTrackingModeRaw === "cwl" ? projectionTrackingModeRaw : defaultTrackingMode;
	const source = String(projection.source == null ? "" : projection.source).trim();
	const unavailableReason = String(projection.unavailableReason == null ? "" : projection.unavailableReason).trim();
	const updatedAt = String(projection.updatedAt == null ? "" : projection.updatedAt).trim();
	const playersRaw = Array.isArray(projection.players) ? projection.players : [];
	const players = [];
	const seen = {};

	for (let i = 0; i < playersRaw.length; i++) {
		const rawPlayer = playersRaw[i] && typeof playersRaw[i] === "object" ? playersRaw[i] : {};
		const tag = normalizeTag_(rawPlayer.tag);
		if (!tag || seen[tag]) continue;
		seen[tag] = true;
		const thRaw = Number(rawPlayer.th);
		const th = isFinite(thRaw) ? Math.max(0, Math.floor(thRaw)) : 0;
		const mapPositionRaw = Number(rawPlayer.mapPosition);
		const mapPosition = isFinite(mapPositionRaw) && mapPositionRaw > 0 ? Math.floor(mapPositionRaw) : null;
		const playerTrackingModeRaw = String(rawPlayer.trackingMode == null ? "" : rawPlayer.trackingMode).trim();
		const playerTrackingMode = playerTrackingModeRaw === "regularWar" || playerTrackingModeRaw === "cwl" ? playerTrackingModeRaw : projectionTrackingMode;
		const playerSource = String(rawPlayer.source == null ? "" : rawPlayer.source).trim() || source;
		const playerUpdatedAt = String(rawPlayer.updatedAt == null ? "" : rawPlayer.updatedAt).trim() || updatedAt;
		const synthetic = !rosterPoolTagSet[tag];
		players.push({
			slot: null,
			name: typeof rawPlayer.name === "string" ? rawPlayer.name : "",
			discord: typeof rawPlayer.discord === "string" ? rawPlayer.discord : "",
			th: th,
			tag: tag,
			notes: sanitizeNotes_(rawPlayer.notes != null ? rawPlayer.notes : rawPlayer.note),
			excludeAsSwapTarget: toBooleanFlag_(rawPlayer.excludeAsSwapTarget),
			excludeAsSwapSource: toBooleanFlag_(rawPlayer.excludeAsSwapSource),
			mapPosition: mapPosition,
			trackingMode: playerTrackingMode,
			source: playerSource,
			synthetic: synthetic,
			updatedAt: playerUpdatedAt,
		});
	}

	const hasActiveField = Object.prototype.hasOwnProperty.call(projection, "active");
	const active = hasActiveField ? projection.active === true && players.length > 0 : players.length > 0;
	const out = {
		active: active,
		trackingMode: projectionTrackingMode,
		source: source,
		unavailableReason: unavailableReason,
		updatedAt: updatedAt,
		players: active ? players : [],
	};
	const hasProjectionContent =
		active ||
		out.players.length > 0 ||
		!!source ||
		!!unavailableReason ||
		!!updatedAt ||
		hasActiveField;
	return hasProjectionContent ? out : null;
}

// Return whether a public lineup projection is compatible with the canonical roster state.
function shouldKeepRosterPublicLineupProjection_(projectionRaw, trackingModeRaw, cwlPreparationRaw) {
	const projection = projectionRaw && typeof projectionRaw === "object" && !Array.isArray(projectionRaw) ? projectionRaw : null;
	if (!projection) return false;
	const trackingMode = String(trackingModeRaw == null ? "" : trackingModeRaw).trim() === "regularWar" ? "regularWar" : "cwl";
	const projectionTrackingModeRaw = String(projection.trackingMode == null ? "" : projection.trackingMode).trim();
	const projectionTrackingMode = projectionTrackingModeRaw === "regularWar" || projectionTrackingModeRaw === "cwl" ? projectionTrackingModeRaw : trackingMode;
	if (projectionTrackingMode !== trackingMode) return false;
	const source = String(projection.source == null ? "" : projection.source).trim();
	if (trackingMode === "cwl" && source === "regularWarCurrentWar") return false;
	if (trackingMode === "regularWar" && (source === "cwlCurrentWar" || source === "cwlPreparation")) return false;
	const cwlPreparation = cwlPreparationRaw && typeof cwlPreparationRaw === "object" && !Array.isArray(cwlPreparationRaw) ? cwlPreparationRaw : null;
	if (trackingMode === "cwl" && cwlPreparation && cwlPreparation.enabled === true) return false;
	return true;
}

// Handle count roster payload.
function countRosterPayload_(rosterData) {
	const rosters = rosterData && Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	let playerCount = 0;
	let noteCount = 0;
	for (let i = 0; i < rosters.length; i++) {
		const r = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		const players = []
			.concat(Array.isArray(r.main) ? r.main : [])
			.concat(Array.isArray(r.subs) ? r.subs : [])
			.concat(Array.isArray(r.missing) ? r.missing : []);
		playerCount += players.length;
		for (let j = 0; j < players.length; j++) {
			const p = players[j] && typeof players[j] === "object" ? players[j] : {};
			noteCount += sanitizeNotes_(p.notes != null ? p.notes : p.note).length;
		}
	}
	return { playerCount, noteCount };
}

// Validate roster data.
function validateRosterData_(data) {
	if (!data || typeof data !== "object") throw new Error("Invalid roster data: expected an object.");

	const out = {
		schemaVersion: typeof data.schemaVersion === "number" && isFinite(data.schemaVersion) ? data.schemaVersion : 1,
		pageTitle: typeof data.pageTitle === "string" ? data.pageTitle : "",
		rosterOrder: [],
		rosters: [],
		playerMetrics: createEmptyPlayerMetricsStore_(),
	};
	const lastUpdatedAt = typeof data.lastUpdatedAt === "string" ? data.lastUpdatedAt.trim() : "";
	if (lastUpdatedAt) out.lastUpdatedAt = lastUpdatedAt;
	const publicConfig = sanitizePublicConfig_(data.publicConfig);
	if (publicConfig) out.publicConfig = publicConfig;

	const rosters = Array.isArray(data.rosters) ? data.rosters : null;
	if (!rosters) throw new Error("Invalid roster data: expected 'rosters' to be an array.");

	const seenTags = {};
	const seenRosterIds = {};

	for (let i = 0; i < rosters.length; i++) {
		const r = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		const id = typeof r.id === "string" ? r.id.trim() : "";
		const title = typeof r.title === "string" ? r.title : "";
		const connectedClanTag = normalizeTag_(r.connectedClanTag);
		const trackingMode = getRosterTrackingMode_(r);

		if (!id) throw new Error("Invalid roster: missing 'id' at index " + i + ".");
		if (seenRosterIds[id]) throw new Error("Invalid roster: duplicate 'id' value '" + id + "'.");
		seenRosterIds[id] = true;
		if (!title) throw new Error("Invalid roster: missing 'title' for roster '" + id + "'.");

		const main = Array.isArray(r.main) ? r.main : [];
		const subs = Array.isArray(r.subs) ? r.subs : [];
		const missing = Array.isArray(r.missing) ? r.missing : [];

		// Sanitize player.
		const sanitizePlayer = (p, role) => {
			const obj = p && typeof p === "object" ? p : {};
			const rawTag = typeof obj.tag === "string" ? obj.tag : "";
			const tag = normalizeTag_(rawTag);
			const th = obj.th;
			if (!tag) throw new Error("Invalid player in roster '" + id + "': missing 'tag'.");
			if (seenTags[tag]) throw new Error("Duplicate player tag in output: " + tag);
			seenTags[tag] = true;

			if (typeof th !== "number" || !isFinite(th)) throw new Error("Invalid player '" + tag + "': 'th' must be a number.");

			let slot = null;
			if (role === "main" && obj.slot != null) {
				slot = Number(obj.slot);
				if (!isFinite(slot) || slot < 1 || Math.floor(slot) !== slot) slot = null;
			}
			const notes = sanitizeNotes_(obj.notes != null ? obj.notes : obj.note);
			return {
				slot: role === "main" ? slot : null,
				name: typeof obj.name === "string" ? obj.name : "",
				discord: typeof obj.discord === "string" ? obj.discord : "",
				th: Math.floor(th),
				tag: tag,
				notes: notes,
				excludeAsSwapTarget: toBooleanFlag_(obj.excludeAsSwapTarget),
				excludeAsSwapSource: toBooleanFlag_(obj.excludeAsSwapSource),
			};
		};

		const outMain = main.map((p) => sanitizePlayer(p, "main"));
		const outSubs = subs.map((p) => sanitizePlayer(p, "subs"));
		const outMissing = missing.map((p) => sanitizePlayer(p, "missing"));
		const rosterPoolTagSet = {};
		const rosterPool = outMain.concat(outSubs).concat(outMissing);
		for (let j = 0; j < rosterPool.length; j++) {
			const playerTag = normalizeTag_(rosterPool[j] && rosterPool[j].tag);
			if (!playerTag) continue;
			rosterPoolTagSet[playerTag] = true;
		}
		const rosterUsableTagSet = {};
		const rosterUsable = outMain.concat(outSubs);
		for (let j = 0; j < rosterUsable.length; j++) {
			const playerTag = normalizeTag_(rosterUsable[j] && rosterUsable[j].tag);
			if (!playerTag) continue;
			rosterUsableTagSet[playerTag] = true;
		}
		const sanitizedCwlPreparation = sanitizeRosterCwlPreparation_(r.cwlPreparation, rosterPoolTagSet, trackingMode, {
			defaultRosterSize: normalizePreparationRosterSize_(outMain.length, CWL_PREPARATION_MIN_ROSTER_SIZE),
			enforceLockedInLimit: true,
		});
		let sanitizedPublicLineupProjection = sanitizeRosterPublicLineupProjection_(r.publicLineupProjection, rosterPoolTagSet, trackingMode);
		if (!shouldKeepRosterPublicLineupProjection_(sanitizedPublicLineupProjection, trackingMode, sanitizedCwlPreparation)) {
			sanitizedPublicLineupProjection = null;
		}
		const projectedRetentionTagSet = buildRosterPublicLineupProjectionTagSet_({
			trackingMode: trackingMode,
			cwlPreparation: sanitizedCwlPreparation,
			publicLineupProjection: sanitizedPublicLineupProjection,
		});
		let sanitizedWarPerformance = sanitizeRosterWarPerformance_(r.warPerformance);
		const retentionTagSet = buildHistoryRetentionTagSet_(rosterPoolTagSet, sanitizedWarPerformance, r.regularWar, new Date().toISOString(), projectedRetentionTagSet);
		const sanitizedCwlStats = sanitizeRosterCwlStats_(r.cwlStats, retentionTagSet);
		const sanitizedRegularWar = sanitizeRosterRegularWar_(r.regularWar, retentionTagSet);
		sanitizedWarPerformance = backfillWarPerformanceFromLegacyRegularAggregate_(sanitizedWarPerformance, sanitizedRegularWar);
		const sanitizedBenchSuggestions = sanitizeRosterBenchSuggestions_(r.benchSuggestions, rosterUsableTagSet);

		// Recompute badges to match array lengths (this avoids drift)
		const nextRoster = {
			id,
			title,
			connectedClanTag: connectedClanTag,
			trackingMode: trackingMode,
			badges: { main: outMain.length, subs: outSubs.length, missing: outMissing.length },
			main: outMain,
			subs: outSubs,
			missing: outMissing,
		};
		if (sanitizedCwlStats) nextRoster.cwlStats = sanitizedCwlStats;
		if (sanitizedRegularWar) nextRoster.regularWar = sanitizedRegularWar;
		if (sanitizedWarPerformance) nextRoster.warPerformance = sanitizedWarPerformance;
		if (sanitizedPublicLineupProjection) nextRoster.publicLineupProjection = sanitizedPublicLineupProjection;
		if (sanitizedCwlPreparation) nextRoster.cwlPreparation = sanitizedCwlPreparation;
		const prepActive = trackingMode === "cwl" && !!(sanitizedCwlPreparation && sanitizedCwlPreparation.enabled);
		if (prepActive) {
			clearRosterBenchSuggestions_(nextRoster);
			applyCwlPreparationRebalance_(nextRoster, { recordAppliedAt: false, enforceLockedInLimit: true });
		} else if (sanitizedBenchSuggestions) {
			nextRoster.benchSuggestions = sanitizedBenchSuggestions;
		}
		out.rosters.push(nextRoster);
	}

	const rosterIndexesById = {};
	for (let i = 0; i < out.rosters.length; i++) {
		const rosterId = String((out.rosters[i] && out.rosters[i].id) || "").trim();
		if (!rosterId) continue;
		if (!rosterIndexesById[rosterId]) rosterIndexesById[rosterId] = [];
		rosterIndexesById[rosterId].push(i);
	}

	const consumedRosterIndexes = {};
	const orderedRosters = [];
	// Push roster index.
	const pushRosterIndex = (index) => {
		if (!isFinite(index) || consumedRosterIndexes[index]) return;
		consumedRosterIndexes[index] = true;
		orderedRosters.push(out.rosters[index]);
	};

	const rawRosterOrder = Array.isArray(data.rosterOrder) ? data.rosterOrder : [];
	for (let i = 0; i < rawRosterOrder.length; i++) {
		const rosterId = String(rawRosterOrder[i] == null ? "" : rawRosterOrder[i]).trim();
		if (!rosterId) continue;
		const queue = rosterIndexesById[rosterId];
		if (!queue || !queue.length) continue;
		const nextIndex = queue.shift();
		pushRosterIndex(nextIndex);
	}

	for (let i = 0; i < out.rosters.length; i++) {
		pushRosterIndex(i);
	}
	out.rosters = orderedRosters;

	const normalizedRosterOrder = [];
	const rosterOrderSeen = {};
	for (let i = 0; i < out.rosters.length; i++) {
		const rosterId = String((out.rosters[i] && out.rosters[i].id) || "").trim();
		if (!rosterId || rosterOrderSeen[rosterId]) continue;
		rosterOrderSeen[rosterId] = true;
		normalizedRosterOrder.push(rosterId);
	}
	out.rosterOrder = normalizedRosterOrder;
	out.playerMetrics = sanitizePlayerMetricsStore_(data.playerMetrics, out.lastUpdatedAt || new Date().toISOString());

	return out;
}
