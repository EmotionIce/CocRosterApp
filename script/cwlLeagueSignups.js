// CWL league signup preferences shared by Discord and admin prep UI.

const CWL_LEAGUE_SIGNUPS_ACTIVE_PATH = "active/cwlLeagueSignups";
const CWL_LEAGUE_SIGNUPS_ARCHIVE_PATH = "archive/cwlLeagueSignups";
const CWL_LEAGUE_SIGNUPS_SCHEMA_VERSION = 1;

function withCwlLeagueSignupWriteLock_(callback) {
	if (typeof callback !== "function") throw new Error("CWL league signup callback is required.");
	if (Array.isArray(activeRosterLockContextStack_) && activeRosterLockContextStack_.length) {
		return callback();
	}
	return withActiveRosterJobLock_("cwl-league-signup", ACTIVE_ROSTER_JOB_LOCK_WAIT_MS, callback);
}

function sanitizeCwlSignupText_(valueRaw, maxLengthRaw) {
	const maxLength = Math.max(0, toNonNegativeInt_(maxLengthRaw) || 0);
	let value = String(valueRaw == null ? "" : valueRaw)
		.replace(/[\u0000-\u001F\u007F]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (maxLength > 0 && value.length > maxLength) value = value.slice(0, maxLength).trim();
	return value;
}

function normalizeCwlSignupLeagueKey_(leagueNameRaw) {
	const text = sanitizeCwlSignupText_(leagueNameRaw, 80);
	if (!text) return "";
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
}

function buildCwlLeagueSignupId_() {
	return Utilities.getUuid().replace(/-/g, "").slice(0, 12);
}

function getCwlSignupRosterPlayers_(rosterRaw) {
	const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
	return []
		.concat(Array.isArray(roster.main) ? roster.main : [])
		.concat(Array.isArray(roster.subs) ? roster.subs : [])
		.concat(Array.isArray(roster.missing) ? roster.missing : []);
}

function readCwlLeagueNameFromRoster_(rosterRaw) {
	const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
	const candidates = [
		roster.cwlLeagueName,
		roster.cwlLeague,
		roster.leagueName,
		roster.warLeagueName,
		roster.warLeague,
		roster.clanWarLeagueName,
		roster.clanWarLeague,
		roster.leagueGroup && roster.leagueGroup.league && roster.leagueGroup.league.name,
		roster.leagueGroup && roster.leagueGroup.leagueName,
	];
	for (let i = 0; i < candidates.length; i++) {
		const candidate = candidates[i];
		if (candidate && typeof candidate === "object") {
			const nested = sanitizeCwlSignupText_(candidate.name || candidate.label, 80);
			if (nested) return nested;
		}
		const text = sanitizeCwlSignupText_(candidate, 80);
		if (text) return text;
	}
	return "";
}

function readCwlClanNameFromRoster_(rosterRaw) {
	const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
	const candidates = [
		roster.clanName,
		roster.connectedClanName,
		roster.currentClanName,
		roster.clan && roster.clan.name,
		roster.title,
	];
	for (let i = 0; i < candidates.length; i++) {
		const text = sanitizeCwlSignupText_(candidates[i], 80);
		if (text) return text;
	}
	return "";
}

function fetchCwlSignupClanDetailsForClan_(clanTagRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const cache = options.clanDetailsCache && typeof options.clanDetailsCache === "object" ? options.clanDetailsCache : null;
	const clanTag = normalizeTag_(clanTagRaw);
	if (!clanTag || !isValidClanTag_(clanTag)) return { clanName: "", leagueName: "" };
	if (cache && cache[clanTag]) return cache[clanTag];
	const details = { clanName: "", leagueName: "" };
	try {
		const clan = cocFetch_("/clans/" + encodeTagForPath_(clanTag));
		details.clanName = sanitizeCwlSignupText_(clan && clan.name, 80);
		const warLeague = clan && typeof clan === "object" ? clan.warLeague : null;
		details.leagueName = sanitizeCwlSignupText_(
			(warLeague && (warLeague.name || warLeague.label)) ||
				(clan && (clan.warLeagueName || clan.clanWarLeagueName)),
			80,
		);
	} catch (err) {
		Logger.log("Unable to fetch clan war league for clan %s: %s", clanTag, errorMessage_(err));
	}
	if (!details.leagueName) {
		try {
			const group = cocFetch_("/clans/" + encodeTagForPath_(clanTag) + "/currentwar/leaguegroup");
			const league = group && typeof group === "object" ? group.league : null;
			details.leagueName = sanitizeCwlSignupText_(
				(league && (league.name || league.label)) ||
					(group && (group.leagueName || group.warLeagueName || group.clanWarLeagueName)),
				80,
			);
		} catch (err) {
			Logger.log("Unable to fetch CWL league for clan %s: %s", clanTag, errorMessage_(err));
		}
	}
	if (cache) cache[clanTag] = details;
	return details;
}

function fetchCwlLeagueNameForClan_(clanTagRaw, optionsRaw) {
	return fetchCwlSignupClanDetailsForClan_(clanTagRaw, optionsRaw).leagueName;
}

function resolveCwlSignupLeagueNameForRoster_(rosterRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
	const existing = readCwlLeagueNameFromRoster_(roster);
	if (existing || options.fetchMissing === false) return existing;
	return fetchCwlLeagueNameForClan_(roster.connectedClanTag, options);
}

function resolveCwlSignupClanNameForRoster_(rosterRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
	const existing = readCwlClanNameFromRoster_(roster);
	if (options.fetchMissing === false) return existing;
	const fetched = fetchCwlSignupClanDetailsForClan_(roster.connectedClanTag, options);
	return fetched.clanName || existing || normalizeTag_(roster.connectedClanTag);
}

function buildCwlLeagueSignupOptionsFromRosterData_(rosterDataRaw, optionsRaw) {
	return buildCwlLeagueSignupOptionsResultFromRosterData_(rosterDataRaw, optionsRaw).options;
}

function buildCwlLeagueSignupOptionsResultFromRosterData_(rosterDataRaw, optionsRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const clanDetailsCache = {};
	const resolveOptions = Object.assign({}, options, { clanDetailsCache: clanDetailsCache });
	const rosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	const byKey = {};
	const skippedRosters = [];
	let representedRosterCount = 0;
	let connectedRosterCount = 0;
	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		const rosterId = sanitizeCwlSignupText_(roster.id, 80);
		const rosterTitle = sanitizeCwlSignupText_(roster.title || roster.name, 80);
		const clanTag = normalizeTag_(roster.connectedClanTag);
		const hasConnectedClan = !!(clanTag && isValidClanTag_(clanTag));
		if (hasConnectedClan) connectedRosterCount++;
		if (!rosterId) {
			skippedRosters.push({
				rosterId: "",
				rosterTitle: rosterTitle,
				clanTag: clanTag,
				reason: "missingRosterId",
			});
			continue;
		}
		const leagueName = resolveCwlSignupLeagueNameForRoster_(roster, resolveOptions);
		const leagueKey = normalizeCwlSignupLeagueKey_(leagueName);
		if (!leagueKey) {
			skippedRosters.push({
				rosterId: rosterId,
				rosterTitle: rosterTitle,
				clanTag: clanTag,
				reason: hasConnectedClan ? "missingLeague" : "missingConnectedClanTag",
			});
			continue;
		}
		const clanName = resolveCwlSignupClanNameForRoster_(roster, resolveOptions);
		if (!byKey[leagueKey]) {
			byKey[leagueKey] = {
				leagueKey: leagueKey,
				leagueName: leagueName,
				rosterIds: [],
				clanTags: [],
				clanNames: [],
				playerCount: 0,
			};
		}
		byKey[leagueKey].rosterIds.push(rosterId);
		if (clanTag) byKey[leagueKey].clanTags.push(clanTag);
		if (clanName) byKey[leagueKey].clanNames.push(clanName);
		byKey[leagueKey].playerCount += getCwlSignupRosterPlayers_(roster).length;
		representedRosterCount++;
	}
	const keys = Object.keys(byKey).sort((a, b) => byKey[a].leagueName.localeCompare(byKey[b].leagueName));
	const signupOptions = keys.map((key) => {
		const option = byKey[key];
		option.rosterIds = option.rosterIds.filter((value, index, list) => list.indexOf(value) === index);
		option.clanTags = option.clanTags.filter((value, index, list) => list.indexOf(value) === index);
		option.clanNames = option.clanNames.filter((value, index, list) => list.indexOf(value) === index);
		return option;
	});
	return {
		options: signupOptions,
		diagnostics: {
			rosterCount: rosters.length,
			connectedRosterCount: connectedRosterCount,
			representedRosterCount: representedRosterCount,
			skippedRosters: skippedRosters,
		},
	};
}

function sanitizeCwlLeagueSignupsPayload_(payloadRaw) {
	const payload = payloadRaw && typeof payloadRaw === "object" && !Array.isArray(payloadRaw) ? payloadRaw : {};
	const preferencesRaw = payload.preferencesByTag && typeof payload.preferencesByTag === "object" ? payload.preferencesByTag : {};
	const preferencesByTag = {};
	const tags = Object.keys(preferencesRaw);
	for (let i = 0; i < tags.length; i++) {
		const tag = normalizeTag_(tags[i]);
		const prefRaw = preferencesRaw[tags[i]] && typeof preferencesRaw[tags[i]] === "object" ? preferencesRaw[tags[i]] : {};
		const leagueName = sanitizeCwlSignupText_(prefRaw.leagueName, 80);
		const leagueKey = normalizeCwlSignupLeagueKey_(prefRaw.leagueKey || leagueName);
		if (!tag || !leagueKey || !leagueName) continue;
		preferencesByTag[tag] = {
			playerTag: tag,
			playerName: sanitizeCwlSignupText_(prefRaw.playerName, 80),
			leagueKey: leagueKey,
			leagueName: leagueName,
			discordId: sanitizeDiscordIdValue_(prefRaw.discordId),
			discordUsername: sanitizeDiscordUsernameValue_(prefRaw.discordUsername),
			discordDisplayName: sanitizeCwlSignupText_(prefRaw.discordDisplayName, 120),
			messageId: sanitizeCwlSignupText_(prefRaw.messageId, 80),
			channelId: sanitizeCwlSignupText_(prefRaw.channelId, 80),
			guildId: sanitizeCwlSignupText_(prefRaw.guildId, 80),
			createdAt: sanitizeCwlSignupText_(prefRaw.createdAt, 40),
			updatedAt: sanitizeCwlSignupText_(prefRaw.updatedAt, 40),
		};
	}
	const auditRaw = payload.audit && typeof payload.audit === "object" ? payload.audit : {};
	const audit = {};
	const auditKeys = Object.keys(auditRaw).sort().slice(-500);
	for (let i = 0; i < auditKeys.length; i++) {
		const key = sanitizeCwlSignupText_(auditKeys[i], 120);
		const entryRaw = auditRaw[auditKeys[i]] && typeof auditRaw[auditKeys[i]] === "object" ? auditRaw[auditKeys[i]] : {};
		if (!key) continue;
		audit[key] = entryRaw;
	}
	return {
		schemaVersion: CWL_LEAGUE_SIGNUPS_SCHEMA_VERSION,
		signupId: sanitizeCwlSignupText_(payload.signupId, 40),
		status: sanitizeCwlSignupText_(payload.status, 40) || "open",
		createdAt: sanitizeCwlSignupText_(payload.createdAt, 40) || new Date().toISOString(),
		updatedAt: sanitizeCwlSignupText_(payload.updatedAt, 40),
		preferencesByTag: preferencesByTag,
		audit: audit,
	};
}

function readActiveCwlLeagueSignups_() {
	const payload = decodeFirebaseObjectKeysRecursive_(firebaseRequestJson_(CWL_LEAGUE_SIGNUPS_ACTIVE_PATH, "GET"));
	return sanitizeCwlLeagueSignupsPayload_(payload);
}

function writeActiveCwlLeagueSignups_(payloadRaw) {
	const payload = sanitizeCwlLeagueSignupsPayload_(payloadRaw);
	if (!payload.signupId) payload.signupId = buildCwlLeagueSignupId_();
	firebaseRequestJson_(CWL_LEAGUE_SIGNUPS_ACTIVE_PATH, "PUT", encodeFirebaseObjectKeysRecursive_(payload));
	clearActiveRosterDataCache_();
	return payload;
}

function ensureActiveCwlLeagueSignupId_() {
	return withCwlLeagueSignupWriteLock_(function () {
		const signups = readActiveCwlLeagueSignups_();
		if (signups.signupId) return signups;
		return writeActiveCwlLeagueSignups_(signups);
	});
}

function buildCwlSignupAuditKey_(timestampRaw) {
	const date = timestampRaw ? new Date(timestampRaw) : new Date();
	const safeDate = isFinite(date.getTime()) ? date : new Date();
	return Utilities.formatDate(safeDate, "Etc/UTC", "yyyyMMdd'T'HHmmss_SSS'Z'") + "_" + Utilities.getUuid().slice(0, 8);
}

function findCwlSignupOptionByKey_(optionsRaw, leagueKeyRaw) {
	const leagueKey = normalizeCwlSignupLeagueKey_(leagueKeyRaw);
	const options = Array.isArray(optionsRaw) ? optionsRaw : [];
	for (let i = 0; i < options.length; i++) {
		if (options[i] && options[i].leagueKey === leagueKey) return options[i];
	}
	return null;
}

function getCwlLeagueSignupOptions(payloadRaw, secretOrPasswordRaw) {
	const parsed = parseSeasonEventOptionalPayloadAndSecret_(payloadRaw, secretOrPasswordRaw);
	assertSeasonEventSecretOrAdmin_(parsed.secretOrPassword);
	const snapshot = readActiveRosterSnapshot_();
	const rosterData = snapshot && snapshot.rosterData ? snapshot.rosterData : {};
	const signups = ensureActiveCwlLeagueSignupId_();
	const signupOptionsResult = buildCwlLeagueSignupOptionsResultFromRosterData_(rosterData, { fetchMissing: parsed.payload.fetchMissing !== false });
	return {
		ok: true,
		signupId: signups.signupId,
		options: signupOptionsResult.options,
		diagnostics: signupOptionsResult.diagnostics,
		preferencesByTag: signups.preferencesByTag,
		updatedAt: signups.updatedAt || "",
	};
}

function setCwlLeaguePreference(payloadRaw, secretOrPasswordRaw) {
	const parsed = parseSeasonEventOptionalPayloadAndSecret_(payloadRaw, secretOrPasswordRaw);
	assertDiscordBotApiSecret_(parsed.secretOrPassword);
	const payload = parsed.payload;
	const playerTag = normalizeTag_(payload.playerTag);
	if (!playerTag || !isValidPlayerTag_(playerTag)) throw new Error("Invalid player tag.");
	return withCwlLeagueSignupWriteLock_(function () {
		const snapshot = readActiveRosterSnapshot_();
		const rosterData = snapshot && snapshot.rosterData ? snapshot.rosterData : {};
		const options = buildCwlLeagueSignupOptionsFromRosterData_(rosterData, { fetchMissing: true });
		const selected = findCwlSignupOptionByKey_(options, payload.leagueKey || payload.leagueName);
		if (!selected) throw new Error("Selected CWL league is not available.");
		const nowIso = new Date().toISOString();
		const signups = ensureActiveCwlLeagueSignupId_();
		const signupId = sanitizeCwlSignupText_(payload.signupId, 40);
		if (!signupId || signupId !== signups.signupId) {
			throw new Error("This CWL league signup message is no longer active. Please use the latest signup message.");
		}
		const existing = signups.preferencesByTag[playerTag] || {};
		if (existing && existing.leagueKey) {
			throw new Error("This player tag already has an active CWL league preference.");
		}
		const pref = {
			playerTag: playerTag,
			playerName: sanitizeCwlSignupText_(payload.playerName || existing.playerName, 80),
			leagueKey: selected.leagueKey,
			leagueName: selected.leagueName,
			discordId: sanitizeDiscordIdValue_(payload.discordId),
			discordUsername: sanitizeDiscordUsernameValue_(payload.discordUsername),
			discordDisplayName: sanitizeCwlSignupText_(payload.discordDisplayName || payload.discordUsername, 120),
			messageId: sanitizeCwlSignupText_(payload.messageId, 80),
			channelId: sanitizeCwlSignupText_(payload.channelId, 80),
			guildId: sanitizeCwlSignupText_(payload.guildId, 80),
			createdAt: existing.createdAt || nowIso,
			updatedAt: nowIso,
		};
		signups.preferencesByTag[playerTag] = pref;
		signups.updatedAt = nowIso;
		signups.status = "open";
		signups.audit[buildCwlSignupAuditKey_(nowIso)] = {
			action: "created",
			playerTag: playerTag,
			leagueKey: selected.leagueKey,
			leagueName: selected.leagueName,
			discordId: pref.discordId,
			discordUsername: pref.discordUsername,
			messageId: pref.messageId,
			createdAt: nowIso,
		};
		const saved = writeActiveCwlLeagueSignups_(signups);
		return {
			ok: true,
			preference: saved.preferencesByTag[playerTag],
			preferenceCount: Object.keys(saved.preferencesByTag).length,
		};
	});
}

function archiveAndResetCwlLeagueSignups_(reasonRaw, sourceRaw) {
	return withCwlLeagueSignupWriteLock_(function () {
		const signups = readActiveCwlLeagueSignups_();
		const count = Object.keys(signups.preferencesByTag || {}).length;
		const hasArchiveData = !!(count || Object.keys(signups.audit || {}).length);
		const nowIso = new Date().toISOString();
		let archiveKey = "";
		if (hasArchiveData) {
			archiveKey = buildCwlSignupAuditKey_(nowIso);
			const archivePayload = Object.assign({}, signups, {
				status: "archived",
				archivedAt: nowIso,
				archiveReason: sanitizeCwlSignupText_(reasonRaw, 120),
				archiveSource: sanitizeCwlSignupText_(sourceRaw, 120),
			});
			firebaseRequestJson_(
				buildFirebaseChildPath_(CWL_LEAGUE_SIGNUPS_ARCHIVE_PATH, encodeFirebaseObjectKey_(archiveKey)),
				"PUT",
				encodeFirebaseObjectKeysRecursive_(archivePayload),
			);
		}
		const saved = writeActiveCwlLeagueSignups_({
			schemaVersion: CWL_LEAGUE_SIGNUPS_SCHEMA_VERSION,
			signupId: buildCwlLeagueSignupId_(),
			status: "open",
			createdAt: nowIso,
			updatedAt: nowIso,
			preferencesByTag: {},
			audit: {},
		});
		return { archived: hasArchiveData, count: count, archiveKey: archiveKey, signupId: saved.signupId };
	});
}

function resetCwlLeaguePreferences(payloadRaw, secretOrPasswordRaw) {
	const parsed = parseSeasonEventOptionalPayloadAndSecret_(payloadRaw, secretOrPasswordRaw);
	assertDiscordBotApiSecret_(parsed.secretOrPassword);
	const payload = parsed.payload;
	const source = sanitizeCwlSignupText_(payload.source || "discord-manual-reset", 120);
	const reason = sanitizeCwlSignupText_(payload.reason || "manual-reset", 120);
	const result = archiveAndResetCwlLeagueSignups_(reason, source);
	return {
		ok: true,
		archived: !!(result && result.archived),
		count: toNonNegativeInt_(result && result.count),
		archiveKey: sanitizeCwlSignupText_(result && result.archiveKey, 160),
		signupId: sanitizeCwlSignupText_(result && result.signupId, 40),
	};
}
