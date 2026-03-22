// Roster schema sanitization and validation boundary.

function sanitizeNotes_(raw) {
	const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
	return arr.map((n) => String(n == null ? "" : n).trim()).filter((n) => n);
}

function sanitizePublicConfigUrl_(valueRaw) {
	const value = String(valueRaw == null ? "" : valueRaw).trim();
	if (!value) return "";
	return /^https?:\/\//i.test(value) ? value : "";
}

function copySanitizedPublicConfigUrls_(target, source, keys) {
	if (!target || typeof target !== "object" || !source || typeof source !== "object" || !Array.isArray(keys)) return;
	for (let i = 0; i < keys.length; i++) {
		const key = String(keys[i] == null ? "" : keys[i]).trim();
		if (!key) continue;
		const value = sanitizePublicConfigUrl_(source[key]);
		if (value) target[key] = value;
	}
}

function sanitizePublicConfig_(raw) {
	const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
	if (!source) return null;

	const mediaKeys = ["bannerMediaUrl", "bannerUrl", "bannerGifUrl", "squareMediaUrl", "squareUrl", "squareGifUrl", "discordInviteUrl"];
	const out = {};
	copySanitizedPublicConfigUrls_(out, source, mediaKeys);

	const landingSource = source.landing && typeof source.landing === "object" && !Array.isArray(source.landing) ? source.landing : null;
	if (landingSource) {
		const landingOut = {};
		copySanitizedPublicConfigUrls_(landingOut, landingSource, mediaKeys);
		if (Object.keys(landingOut).length) out.landing = landingOut;
	}

	return Object.keys(out).length ? out : null;
}

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
		let sanitizedWarPerformance = sanitizeRosterWarPerformance_(r.warPerformance);
		const retentionTagSet = buildHistoryRetentionTagSet_(rosterPoolTagSet, sanitizedWarPerformance, r.regularWar, new Date().toISOString());
		const sanitizedCwlStats = sanitizeRosterCwlStats_(r.cwlStats, retentionTagSet);
		const sanitizedRegularWar = sanitizeRosterRegularWar_(r.regularWar, retentionTagSet);
		sanitizedWarPerformance = backfillWarPerformanceFromLegacyRegularAggregate_(sanitizedWarPerformance, sanitizedRegularWar);
		const sanitizedBenchSuggestions = sanitizeRosterBenchSuggestions_(r.benchSuggestions, rosterPoolTagSet);
		const sanitizedCwlPreparation = sanitizeRosterCwlPreparation_(r.cwlPreparation, rosterPoolTagSet, trackingMode, {
			defaultRosterSize: normalizePreparationRosterSize_(outMain.length, CWL_PREPARATION_MIN_ROSTER_SIZE),
			enforceLockedInLimit: true,
		});

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
