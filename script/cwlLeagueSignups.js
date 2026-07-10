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

function normalizeCwlSignupOptionKey_(optionKeyRaw) {
	return normalizeCwlSignupLeagueKey_(optionKeyRaw);
}

function buildCwlSignupOptionKeyCandidate_(rosterIdRaw, clanTagRaw, clanNameRaw, leagueKeyRaw) {
	const candidates = [
		rosterIdRaw,
		clanTagRaw,
		clanNameRaw,
		leagueKeyRaw,
	];
	for (let i = 0; i < candidates.length; i++) {
		const key = normalizeCwlSignupOptionKey_(candidates[i]);
		if (key) return key;
	}
	return "option";
}

function ensureUniqueCwlSignupOptionKey_(candidateRaw, usedRaw) {
	const used = usedRaw && typeof usedRaw === "object" ? usedRaw : {};
	let key = normalizeCwlSignupOptionKey_(candidateRaw) || "option";
	if (!used[key]) {
		used[key] = true;
		return key;
	}
	for (let i = 2; i < 1000; i++) {
		const suffix = "-" + i;
		const base = key.slice(0, Math.max(1, 48 - suffix.length)).replace(/-+$/g, "") || "option";
		const candidate = base + suffix;
		if (!used[candidate]) {
			used[candidate] = true;
			return candidate;
		}
	}
	throw new Error("Unable to build a unique CWL signup option key.");
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

function sanitizeCwlLeagueSignupOption_(optionRaw) {
	const option = optionRaw && typeof optionRaw === "object" ? optionRaw : {};
	const leagueName = sanitizeCwlSignupText_(option.leagueName || option.leagueLabel, 80);
	const leagueKey = normalizeCwlSignupLeagueKey_(option.leagueKey || leagueName);
	if (!leagueKey || !leagueName) return null;
	const sanitizeList = function (valuesRaw) {
		const values = Array.isArray(valuesRaw) ? valuesRaw : [];
		const out = [];
		const seen = {};
		for (let i = 0; i < values.length; i++) {
			const value = sanitizeCwlSignupText_(values[i], 80);
			const key = value.toLowerCase();
			if (!value || seen[key]) continue;
			seen[key] = true;
			out.push(value);
		}
		return out;
	};
	const rosterIds = sanitizeList(
		option.rosterIds || (option.rosterId || option.targetRosterId ? [option.rosterId || option.targetRosterId] : []),
	);
	const clanTags = sanitizeList(
		option.clanTags || (option.clanTag || option.targetClanTag ? [option.clanTag || option.targetClanTag] : []),
	).map((tag) => normalizeTag_(tag)).filter((tag) => tag);
	const clanNames = sanitizeList(
		option.clanNames || (option.clanName || option.targetClanName ? [option.clanName || option.targetClanName] : []),
	);
	const targetRosterId = sanitizeCwlSignupText_(option.targetRosterId || option.rosterId || rosterIds[0], 80);
	const targetRosterTitle = sanitizeCwlSignupText_(option.targetRosterTitle || option.rosterTitle, 80);
	const targetClanTag = normalizeTag_(option.targetClanTag || option.clanTag || clanTags[0]);
	const targetClanName = sanitizeCwlSignupText_(option.targetClanName || option.clanName || clanNames[0], 80);
	const optionKey = normalizeCwlSignupOptionKey_(
		option.optionKey ||
			option.optionId ||
			option.key ||
			buildCwlSignupOptionKeyCandidate_(targetRosterId, targetClanTag, targetClanName, leagueKey),
	);
	if (!optionKey) return null;
	return {
		optionKey: optionKey,
		leagueKey: leagueKey,
		leagueName: leagueName,
		rosterId: targetRosterId,
		rosterTitle: targetRosterTitle,
		clanTag: targetClanTag,
		clanName: targetClanName,
		targetRosterId: targetRosterId,
		targetRosterTitle: targetRosterTitle,
		targetClanTag: targetClanTag,
		targetClanName: targetClanName,
		rosterIds: rosterIds,
		clanTags: clanTags,
		clanNames: clanNames,
		playerCount: toNonNegativeInt_(option.playerCount),
	};
}

function buildCwlLeagueSignupOptionList_(optionsRaw) {
	let options = [];
	if (Array.isArray(optionsRaw)) {
		options = optionsRaw;
	} else if (optionsRaw && typeof optionsRaw === "object") {
		const keys = Object.keys(optionsRaw);
		for (let i = 0; i < keys.length; i++) {
			const option = optionsRaw[keys[i]];
			if (option && typeof option === "object" && !option.optionKey) {
				option.optionKey = keys[i];
			}
			options.push(option);
		}
	}
	const out = [];
	for (let i = 0; i < options.length; i++) {
		const option = sanitizeCwlLeagueSignupOption_(options[i]);
		if (!option) continue;
		out.push(option);
	}
	return out;
}

function buildCwlLeagueSignupOptionsByOptionKey_(optionsRaw) {
	const options = buildCwlLeagueSignupOptionList_(optionsRaw);
	const byKey = {};
	for (let i = 0; i < options.length; i++) {
		byKey[options[i].optionKey] = options[i];
	}
	return byKey;
}

function buildCwlLeagueSignupOptionsByLeagueKey_(optionsRaw) {
	const options = buildCwlLeagueSignupOptionList_(optionsRaw);
	const byKey = {};
	for (let i = 0; i < options.length; i++) {
		const option = options[i];
		if (!byKey[option.leagueKey]) {
			byKey[option.leagueKey] = {
				optionKey: option.leagueKey,
				leagueKey: option.leagueKey,
				leagueName: option.leagueName,
				rosterIds: [],
				clanTags: [],
				clanNames: [],
				playerCount: 0,
			};
		}
		const aggregate = byKey[option.leagueKey];
		if (option.targetRosterId) aggregate.rosterIds.push(option.targetRosterId);
		else aggregate.rosterIds = aggregate.rosterIds.concat(option.rosterIds || []);
		if (option.targetClanTag) aggregate.clanTags.push(option.targetClanTag);
		else aggregate.clanTags = aggregate.clanTags.concat(option.clanTags || []);
		if (option.targetClanName) aggregate.clanNames.push(option.targetClanName);
		else aggregate.clanNames = aggregate.clanNames.concat(option.clanNames || []);
		aggregate.playerCount += toNonNegativeInt_(option.playerCount);
	}
	const keys = Object.keys(byKey);
	for (let i = 0; i < keys.length; i++) {
		const option = byKey[keys[i]];
		option.rosterIds = option.rosterIds.filter((value, index, list) => value && list.indexOf(value) === index);
		option.clanTags = option.clanTags.filter((value, index, list) => value && list.indexOf(value) === index);
		option.clanNames = option.clanNames.filter((value, index, list) => value && list.indexOf(value) === index);
		option.targetRosterId = option.rosterIds[0] || "";
		option.targetClanTag = option.clanTags[0] || "";
		option.targetClanName = option.clanNames[0] || "";
		option.rosterId = option.targetRosterId;
		option.clanTag = option.targetClanTag;
		option.clanName = option.targetClanName;
	}
	return byKey;
}

function buildCwlLeagueSignupOptionsResultFromRosterData_(rosterDataRaw, optionsRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const clanDetailsCache = {};
	const resolveOptions = Object.assign({}, options, { clanDetailsCache: clanDetailsCache });
	const rosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	const signupOptions = [];
	const usedOptionKeys = {};
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
		const optionKey = ensureUniqueCwlSignupOptionKey_(
			buildCwlSignupOptionKeyCandidate_(rosterId, clanTag, clanName, leagueKey),
			usedOptionKeys,
		);
		signupOptions.push({
			optionKey: optionKey,
			leagueKey: leagueKey,
			leagueName: leagueName,
			rosterId: rosterId,
			rosterTitle: rosterTitle,
			clanTag: clanTag,
			clanName: clanName,
			targetRosterId: rosterId,
			targetRosterTitle: rosterTitle,
			targetClanTag: clanTag,
			targetClanName: clanName,
			rosterIds: [rosterId],
			clanTags: clanTag ? [clanTag] : [],
			clanNames: clanName ? [clanName] : [],
			playerCount: getCwlSignupRosterPlayers_(roster).length,
		});
		representedRosterCount++;
	}
	signupOptions.sort((left, right) => {
		const leagueCompare = left.leagueName.localeCompare(right.leagueName);
		if (leagueCompare) return leagueCompare;
		const leftClan = left.clanName || left.rosterTitle || left.rosterId;
		const rightClan = right.clanName || right.rosterTitle || right.rosterId;
		return leftClan.localeCompare(rightClan);
	});
	for (let i = 0; i < signupOptions.length; i++) {
		const option = signupOptions[i];
		option.rosterIds = option.rosterIds.filter((value, index, list) => list.indexOf(value) === index);
		option.clanTags = option.clanTags.filter((value, index, list) => list.indexOf(value) === index);
		option.clanNames = option.clanNames.filter((value, index, list) => list.indexOf(value) === index);
	}
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
		const leagueName = sanitizeCwlSignupText_(prefRaw.leagueName || prefRaw.leagueLabel || prefRaw.leagueKey, 80);
		const leagueKey = normalizeCwlSignupLeagueKey_(prefRaw.leagueKey || leagueName);
		if (!tag || !leagueKey || !leagueName) continue;
		const optionKey = normalizeCwlSignupOptionKey_(prefRaw.optionKey || prefRaw.optionId || prefRaw.choiceKey);
		const targetRosterId = sanitizeCwlSignupText_(prefRaw.targetRosterId || prefRaw.rosterId, 80);
		const targetRosterTitle = sanitizeCwlSignupText_(prefRaw.targetRosterTitle || prefRaw.rosterTitle, 80);
		const targetClanTag = normalizeTag_(prefRaw.targetClanTag || prefRaw.clanTag);
		const targetClanName = sanitizeCwlSignupText_(prefRaw.targetClanName || prefRaw.clanName, 80);
		preferencesByTag[tag] = {
			playerTag: tag,
			playerName: sanitizeCwlSignupText_(prefRaw.playerName, 80),
			optionKey: optionKey,
			leagueKey: leagueKey,
			leagueName: leagueName,
			targetRosterId: targetRosterId,
			targetRosterTitle: targetRosterTitle,
			targetClanTag: targetClanTag,
			targetClanName: targetClanName,
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
	const optionSource = payload.optionsByKey && typeof payload.optionsByKey === "object"
		? payload.optionsByKey
		: payload.optionsByLeagueKey;
	const optionsByKey = buildCwlLeagueSignupOptionsByOptionKey_(optionSource);
	const optionsByLeagueKey = buildCwlLeagueSignupOptionsByLeagueKey_(Object.keys(optionsByKey).map((key) => optionsByKey[key]));
	return {
		schemaVersion: CWL_LEAGUE_SIGNUPS_SCHEMA_VERSION,
		signupId: sanitizeCwlSignupText_(payload.signupId, 40),
		status: sanitizeCwlSignupText_(payload.status, 40) || "open",
		createdAt: sanitizeCwlSignupText_(payload.createdAt, 40) || new Date().toISOString(),
		updatedAt: sanitizeCwlSignupText_(payload.updatedAt, 40),
		optionSnapshotUpdatedAt: sanitizeCwlSignupText_(payload.optionSnapshotUpdatedAt, 40),
		optionsByKey: optionsByKey,
		optionsByLeagueKey: optionsByLeagueKey,
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

function enqueueActiveCwlLeagueSignupsAfterMutation_(reasonRaw) {
	if (typeof enqueueCloudflareCwlLeagueSignupsPublication_ !== "function") return null;
	try {
		return enqueueCloudflareCwlLeagueSignupsPublication_(reasonRaw || "cwl-league-signups-write");
	} catch (err) {
		Logger.log("CWL signup enqueue failed after canonical mutation: %s", errorMessage_(err));
		return { ok: false, error: errorMessage_(err), queued: false };
	}
}

function enqueueCurrentCwlAggregateAfterPreferenceMutation_(reasonRaw) {
	if (typeof publishCloudflareSeasonEventsAfterMutation_ !== "function") return null;
	let event = null;
	try {
		event = typeof readCurrentCwlSeasonEvent_ === "function" ? readCurrentCwlSeasonEvent_() : null;
	} catch (err) {
		Logger.log("Unable to read current CWL event for preference mirror enqueue: %s", errorMessage_(err));
	}
	const eventId = sanitizeCwlSignupText_(event && event.eventId, 180);
	return publishCloudflareSeasonEventsAfterMutation_(reasonRaw || "cwl-preference-write", eventId, { cwlLive: !!eventId });
}

function enqueueCwlPreferenceMirrorsAfterMutation_(reasonRaw) {
	let cwlLeagueSignups = null;
	let cwlAggregate = null;
	try {
		cwlLeagueSignups = enqueueActiveCwlLeagueSignupsAfterMutation_(reasonRaw);
	} catch (err) {
		Logger.log("CWL signup mirror enqueue failed after canonical mutation: %s", errorMessage_(err));
		cwlLeagueSignups = { ok: false, error: errorMessage_(err), queued: false };
	}
	try {
		cwlAggregate = enqueueCurrentCwlAggregateAfterPreferenceMutation_(reasonRaw);
	} catch (err) {
		Logger.log("CWL aggregate mirror enqueue failed after canonical mutation: %s", errorMessage_(err));
		cwlAggregate = { ok: false, error: errorMessage_(err), queued: false };
	}
	return {
		cwlLeagueSignups: cwlLeagueSignups,
		cwlAggregate: cwlAggregate,
	};
}

function assertCwlPreferencePlayerLinkedToDiscord_(playerTagRaw, discordUserRaw) {
	const playerTag = normalizeTag_(playerTagRaw);
	const discordUser = discordUserRaw && typeof discordUserRaw === "object" ? discordUserRaw : { id: discordUserRaw };
	const discordId = sanitizeDiscordIdValue_(discordUser.id || discordUser.discordId);
	if (!discordId) throw createRosterBackendError_("DISCORD_ID_REQUIRED", "Discord ID is required.");
	const snapshot = readActiveRosterSnapshot_();
	const rosterData = snapshot && snapshot.rosterData ? snapshot.rosterData : {};
	const linkedAccounts = typeof findLinkedAccountsForDiscordUser_ === "function"
		? findLinkedAccountsForDiscordUser_(rosterData, {
			id: discordId,
			username: sanitizeDiscordUsernameValue_(discordUser.username || discordUser.discordUsername),
			globalName: sanitizeCwlSignupText_(discordUser.globalName || discordUser.discordGlobalName, 120),
			displayName: sanitizeCwlSignupText_(discordUser.displayName || discordUser.discordDisplayName, 120),
		})
		: [];
	const linked = Array.isArray(linkedAccounts) && linkedAccounts.some(function (account) {
		return normalizeTag_(account && account.tag) === playerTag;
	});
	if (!linked) {
		throw createRosterBackendError_("CWL_PLAYER_NOT_LINKED", "This player tag is not linked to the requesting Discord user.");
	}
	return linkedAccounts;
}

function ensureActiveCwlLeagueSignupId_() {
	let created = false;
	const signups = withCwlLeagueSignupWriteLock_(function () {
		const current = readActiveCwlLeagueSignups_();
		if (current.signupId) return current;
		created = true;
		return writeActiveCwlLeagueSignups_(current);
	});
	if (created) enqueueActiveCwlLeagueSignupsAfterMutation_("cwl-signup-id-created");
	return signups;
}

function buildCwlSignupAuditKey_(timestampRaw) {
	const date = timestampRaw ? new Date(timestampRaw) : new Date();
	const safeDate = isFinite(date.getTime()) ? date : new Date();
	const uuid = typeof Utilities !== "undefined" && Utilities && typeof Utilities.getUuid === "function"
		? String(Utilities.getUuid()).replace(/[^0-9A-Za-z_-]/g, "").slice(0, 32)
		: String(Date.now());
	return Utilities.formatDate(safeDate, "Etc/UTC", "yyyyMMdd'T'HHmmss_SSS'Z'") + "_" + uuid;
}

function findCwlSignupOptionBySelection_(optionsRaw, optionKeyRaw, leagueKeyRaw) {
	const optionKey = normalizeCwlSignupOptionKey_(optionKeyRaw);
	const leagueKey = normalizeCwlSignupLeagueKey_(leagueKeyRaw);
	const options = Array.isArray(optionsRaw) ? optionsRaw : [];
	for (let i = 0; i < options.length; i++) {
		if (optionKey && options[i] && options[i].optionKey === optionKey) return options[i];
	}
	for (let i = 0; i < options.length; i++) {
		if (leagueKey && options[i] && options[i].leagueKey === leagueKey) return options[i];
	}
	return null;
}

function getCwlSignupOptionTargetRosterId_(optionRaw) {
	const option = optionRaw && typeof optionRaw === "object" ? optionRaw : {};
	const rosterIds = Array.isArray(option.rosterIds) ? option.rosterIds : [];
	return sanitizeCwlSignupText_(option.targetRosterId || option.rosterId || rosterIds[0], 80);
}

function getCwlSignupOptionTargetClanTag_(optionRaw) {
	const option = optionRaw && typeof optionRaw === "object" ? optionRaw : {};
	const clanTags = Array.isArray(option.clanTags) ? option.clanTags : [];
	return normalizeTag_(option.targetClanTag || option.clanTag || clanTags[0]);
}

function getCwlSignupOptionTargetClanName_(optionRaw) {
	const option = optionRaw && typeof optionRaw === "object" ? optionRaw : {};
	const clanNames = Array.isArray(option.clanNames) ? option.clanNames : [];
	return sanitizeCwlSignupText_(option.targetClanName || option.clanName || clanNames[0], 80);
}

function cwlSignupPreferenceMatchesOption_(preferenceRaw, optionRaw) {
	const preference = preferenceRaw && typeof preferenceRaw === "object" ? preferenceRaw : {};
	const option = optionRaw && typeof optionRaw === "object" ? optionRaw : {};
	const existingOptionKey = normalizeCwlSignupOptionKey_(preference.optionKey || preference.optionId || preference.choiceKey);
	const selectedOptionKey = normalizeCwlSignupOptionKey_(option.optionKey);
	if (existingOptionKey || selectedOptionKey) return !!(existingOptionKey && selectedOptionKey && existingOptionKey === selectedOptionKey);
	const existingRosterId = sanitizeCwlSignupText_(preference.targetRosterId || preference.rosterId, 80);
	const selectedRosterId = getCwlSignupOptionTargetRosterId_(option);
	if (existingRosterId || selectedRosterId) return !!(existingRosterId && selectedRosterId && existingRosterId === selectedRosterId);
	const existingLeagueKey = normalizeCwlSignupLeagueKey_(preference.leagueKey || preference.leagueName);
	const selectedLeagueKey = normalizeCwlSignupLeagueKey_(option.leagueKey || option.leagueName);
	return !!(existingLeagueKey && selectedLeagueKey && existingLeagueKey === selectedLeagueKey);
}

function getCwlLeagueSignupOptions(payloadRaw, secretOrPasswordRaw) {
	const parsed = parseSeasonEventOptionalPayloadAndSecret_(payloadRaw, secretOrPasswordRaw);
	assertSeasonEventSecretOrAdmin_(parsed.secretOrPassword);
	const snapshot = readActiveRosterSnapshot_();
	const rosterData = snapshot && snapshot.rosterData ? snapshot.rosterData : {};
	const signupOptionsResult = buildCwlLeagueSignupOptionsResultFromRosterData_(rosterData, { fetchMissing: parsed.payload.fetchMissing !== false });
	const signups = withCwlLeagueSignupWriteLock_(function () {
		const current = readActiveCwlLeagueSignups_();
		const nowIso = new Date().toISOString();
		if (!current.signupId) current.signupId = buildCwlLeagueSignupId_();
		current.optionsByKey = buildCwlLeagueSignupOptionsByOptionKey_(signupOptionsResult.options);
		current.optionsByLeagueKey = buildCwlLeagueSignupOptionsByLeagueKey_(signupOptionsResult.options);
		current.optionSnapshotUpdatedAt = nowIso;
		if (!current.updatedAt) current.updatedAt = nowIso;
		return writeActiveCwlLeagueSignups_(current);
	});
	enqueueActiveCwlLeagueSignupsAfterMutation_("cwl-signup-options-refresh");
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
	const discordId = sanitizeDiscordIdValue_(payload.discordId);
	const result = withCwlLeagueSignupWriteLock_(function () {
		const nowIso = new Date().toISOString();
		const signups = readActiveCwlLeagueSignups_();
		const signupId = sanitizeCwlSignupText_(payload.signupId, 40);
		if (!signupId || signupId !== signups.signupId) {
			throw new Error("This CWL league signup message is no longer active. Please use the latest signup message.");
		}
		assertCwlPreferencePlayerLinkedToDiscord_(playerTag, {
			id: discordId,
			username: payload.discordUsername,
			globalName: payload.discordGlobalName,
			displayName: payload.discordDisplayName,
		});
		const existing = signups.preferencesByTag[playerTag] && typeof signups.preferencesByTag[playerTag] === "object"
			? signups.preferencesByTag[playerTag]
			: null;
		const existingHasPreference = !!(existing && (
			normalizeCwlSignupOptionKey_(existing.optionKey) ||
			sanitizeCwlSignupText_(existing.targetRosterId, 80) ||
			normalizeCwlSignupLeagueKey_(existing.leagueKey || existing.leagueName)
		));
		const existingDiscordId = sanitizeDiscordIdValue_(existing && existing.discordId);
		const allowChange = payload.allowChange === true || payload.changeExisting === true;
		if (existing && existingHasPreference) {
			if (!existingDiscordId || existingDiscordId !== discordId) {
				throw createRosterBackendError_("CWL_PREFERENCE_NOT_OWNER", "This CWL league preference belongs to another Discord user.");
			}
			if (!allowChange) {
				throw createRosterBackendError_("CWL_PREFERENCE_EXISTS", "This player tag already has an active CWL league preference.");
			}
		}
		const storedOptionKeys = Object.keys(signups.optionsByKey || {});
		const storedOptions = [];
		for (let i = 0; i < storedOptionKeys.length; i++) {
			storedOptions.push(signups.optionsByKey[storedOptionKeys[i]]);
		}
		const selectedOptionKey = payload.optionKey || payload.optionId || payload.choiceKey;
		const selectedLeagueKey = payload.leagueKey || payload.leagueName;
		let selected = findCwlSignupOptionBySelection_(storedOptions, selectedOptionKey, selectedLeagueKey);
		if (!selected) {
			const snapshot = readActiveRosterSnapshot_();
			const rosterData = snapshot && snapshot.rosterData ? snapshot.rosterData : {};
			const options = buildCwlLeagueSignupOptionsFromRosterData_(rosterData, { fetchMissing: true });
			selected = findCwlSignupOptionBySelection_(options, selectedOptionKey, selectedLeagueKey);
		}
		if (!selected) throw new Error("Selected CWL league is not available.");
		if (existing && existingHasPreference && cwlSignupPreferenceMatchesOption_(existing, selected)) {
			return {
				ok: true,
				status: "unchanged",
				created: false,
				changed: false,
				preference: existing,
				previousPreference: existing,
				preferenceCount: Object.keys(signups.preferencesByTag || {}).length,
			};
		}
		const action = existing && existingHasPreference ? "changed" : "created";
		const targetRosterId = getCwlSignupOptionTargetRosterId_(selected);
		const targetClanTag = getCwlSignupOptionTargetClanTag_(selected);
		const targetClanName = getCwlSignupOptionTargetClanName_(selected);
		const pref = {
			playerTag: playerTag,
			playerName: sanitizeCwlSignupText_(payload.playerName || (existing && existing.playerName), 80),
			optionKey: selected.optionKey,
			leagueKey: selected.leagueKey,
			leagueName: selected.leagueName,
			targetRosterId: targetRosterId,
			targetRosterTitle: sanitizeCwlSignupText_(selected.targetRosterTitle || selected.rosterTitle, 80),
			targetClanTag: targetClanTag,
			targetClanName: targetClanName,
			discordId: discordId,
			discordUsername: sanitizeDiscordUsernameValue_(payload.discordUsername),
			discordDisplayName: sanitizeCwlSignupText_(payload.discordDisplayName || payload.discordUsername, 120),
			messageId: sanitizeCwlSignupText_(payload.messageId, 80),
			channelId: sanitizeCwlSignupText_(payload.channelId, 80),
			guildId: sanitizeCwlSignupText_(payload.guildId, 80),
			createdAt: (existing && existing.createdAt) || nowIso,
			updatedAt: nowIso,
		};
		signups.preferencesByTag[playerTag] = pref;
		signups.updatedAt = nowIso;
		signups.status = "open";
		signups.audit[buildCwlSignupAuditKey_(nowIso)] = {
			action: action,
			playerTag: playerTag,
			optionKey: selected.optionKey,
			leagueKey: selected.leagueKey,
			leagueName: selected.leagueName,
			targetRosterId: targetRosterId,
			targetClanTag: targetClanTag,
			targetClanName: targetClanName,
			previousOptionKey: sanitizeCwlSignupText_(existing && existing.optionKey, 80),
			previousLeagueKey: sanitizeCwlSignupText_(existing && existing.leagueKey, 80),
			previousLeagueName: sanitizeCwlSignupText_(existing && existing.leagueName, 80),
			previousTargetRosterId: sanitizeCwlSignupText_(existing && existing.targetRosterId, 80),
			previousTargetClanTag: normalizeTag_(existing && existing.targetClanTag),
			previousTargetClanName: sanitizeCwlSignupText_(existing && existing.targetClanName, 80),
			discordId: pref.discordId,
			discordUsername: pref.discordUsername,
			messageId: pref.messageId,
			createdAt: nowIso,
		};
		const saved = writeActiveCwlLeagueSignups_(signups);
		return {
			ok: true,
			status: action,
			created: action === "created",
			changed: action === "changed",
			preference: saved.preferencesByTag[playerTag],
			previousPreference: action === "changed" ? existing : null,
			preferenceCount: Object.keys(saved.preferencesByTag).length,
		};
	});
	if (result && (result.created === true || result.changed === true)) enqueueCwlPreferenceMirrorsAfterMutation_("cwl-preference-write");
	return result;
}

function buildCwlLeaguePreferencesForDiscordId_(signupsRaw, discordIdRaw) {
	const signups = sanitizeCwlLeagueSignupsPayload_(signupsRaw);
	const discordId = sanitizeDiscordIdValue_(discordIdRaw);
	const preferences = [];
	const preferencesByTag = signups.preferencesByTag || {};
	const tags = Object.keys(preferencesByTag).sort();
	for (let i = 0; i < tags.length; i++) {
		const preference = preferencesByTag[tags[i]] && typeof preferencesByTag[tags[i]] === "object" ? preferencesByTag[tags[i]] : {};
		if (sanitizeDiscordIdValue_(preference.discordId) !== discordId) continue;
		preferences.push({
			playerTag: normalizeTag_(preference.playerTag || tags[i]),
			playerName: sanitizeCwlSignupText_(preference.playerName, 80),
			optionKey: normalizeCwlSignupOptionKey_(preference.optionKey || preference.optionId || preference.choiceKey),
			leagueKey: normalizeCwlSignupLeagueKey_(preference.leagueKey || preference.leagueName),
			leagueName: sanitizeCwlSignupText_(preference.leagueName, 80),
			targetRosterId: sanitizeCwlSignupText_(preference.targetRosterId || preference.rosterId, 80),
			targetRosterTitle: sanitizeCwlSignupText_(preference.targetRosterTitle || preference.rosterTitle, 80),
			targetClanTag: normalizeTag_(preference.targetClanTag || preference.clanTag),
			targetClanName: sanitizeCwlSignupText_(preference.targetClanName || preference.clanName, 80),
			discordId: sanitizeDiscordIdValue_(preference.discordId),
			discordUsername: sanitizeDiscordUsernameValue_(preference.discordUsername),
			discordDisplayName: sanitizeCwlSignupText_(preference.discordDisplayName, 120),
			messageId: sanitizeCwlSignupText_(preference.messageId, 80),
			channelId: sanitizeCwlSignupText_(preference.channelId, 80),
			guildId: sanitizeCwlSignupText_(preference.guildId, 80),
			createdAt: sanitizeCwlSignupText_(preference.createdAt, 40),
			updatedAt: sanitizeCwlSignupText_(preference.updatedAt, 40),
		});
	}
	preferences.sort((left, right) => String(left && (left.leagueName || "")).localeCompare(String(right && (right.leagueName || ""))) || String(left && (left.playerName || left.playerTag) || "").localeCompare(String(right && (right.playerName || right.playerTag) || "")));
	return preferences;
}

function getCwlLeaguePreferencesForDiscordUser(payloadRaw, secretOrPasswordRaw) {
	const parsed = parseSeasonEventOptionalPayloadAndSecret_(payloadRaw, secretOrPasswordRaw);
	assertDiscordBotApiSecret_(parsed.secretOrPassword);
	const payload = parsed.payload;
	const discordId = sanitizeDiscordIdValue_(payload.discordId);
	if (!discordId) throw createRosterBackendError_("DISCORD_ID_REQUIRED", "Discord ID is required.");
	const signups = readActiveCwlLeagueSignups_();
	const signupId = sanitizeCwlSignupText_(payload.signupId, 40);
	if (signupId && signupId !== signups.signupId) {
		throw createRosterBackendError_("CWL_SIGNUP_NOT_ACTIVE", "This CWL league signup message is no longer active. Please use the latest signup message.");
	}
	const preferences = buildCwlLeaguePreferencesForDiscordId_(signups, discordId);
	return {
		ok: true,
		signupId: signups.signupId,
		preferences: preferences,
		preferenceCount: preferences.length,
		updatedAt: signups.updatedAt || "",
	};
}

function getCwlLeagueSignupContextForDiscordUser(payloadRaw, secretOrPasswordRaw) {
	const parsed = parseSeasonEventOptionalPayloadAndSecret_(payloadRaw, secretOrPasswordRaw);
	assertDiscordBotApiSecret_(parsed.secretOrPassword);
	const payload = parsed.payload;
	const discordId = sanitizeDiscordIdValue_(payload.discordId);
	if (!discordId) throw createRosterBackendError_("DISCORD_ID_REQUIRED", "Discord ID is required.");
	const signups = readActiveCwlLeagueSignups_();
	const signupId = sanitizeCwlSignupText_(payload.signupId, 40);
	if (signupId && signupId !== signups.signupId) {
		throw createRosterBackendError_("CWL_SIGNUP_NOT_ACTIVE", "This CWL league signup message is no longer active. Please use the latest signup message.");
	}
	const snapshot = readActiveRosterSnapshot_();
	const rosterData = snapshot && snapshot.rosterData ? snapshot.rosterData : {};
	const optionsResult = buildCwlLeagueSignupOptionsResultFromRosterData_(rosterData, { fetchMissing: false });
	const discordUser = {
		id: discordId,
		username: payload.discordUsername,
		globalName: payload.discordGlobalName,
		displayName: payload.discordDisplayName,
	};
	const preferences = buildCwlLeaguePreferencesForDiscordId_(signups, discordId);
	return {
		ok: true,
		signupId: signups.signupId,
		options: optionsResult.options,
		linkedAccounts: findLinkedAccountsForDiscordUser_(rosterData, discordUser),
		preferences: preferences,
		preferenceCount: preferences.length,
		updatedAt: signups.updatedAt || "",
	};
}

function clearCwlLeaguePreference(payloadRaw, secretOrPasswordRaw) {
	const parsed = parseSeasonEventOptionalPayloadAndSecret_(payloadRaw, secretOrPasswordRaw);
	assertDiscordBotApiSecret_(parsed.secretOrPassword);
	const payload = parsed.payload;
	const discordId = sanitizeDiscordIdValue_(payload.discordId);
	const playerTag = normalizeTag_(payload.playerTag);
	if (!discordId) throw createRosterBackendError_("DISCORD_ID_REQUIRED", "Discord ID is required.");
	if (!playerTag || !isValidPlayerTag_(playerTag)) throw createRosterBackendError_("INVALID_PLAYER_TAG", "Invalid player tag.");
	const result = withCwlLeagueSignupWriteLock_(function () {
		const nowIso = new Date().toISOString();
		const signups = readActiveCwlLeagueSignups_();
		const signupId = sanitizeCwlSignupText_(payload.signupId, 40);
		if (signupId && signupId !== signups.signupId) {
			throw createRosterBackendError_("CWL_SIGNUP_NOT_ACTIVE", "This CWL league signup message is no longer active. Please use the latest signup message.");
		}
		const existing = signups.preferencesByTag[playerTag] && typeof signups.preferencesByTag[playerTag] === "object"
			? signups.preferencesByTag[playerTag]
			: null;
		let status = "not-found";
		let cleared = false;
		let removedPreference = null;
		if (existing) {
			if (sanitizeDiscordIdValue_(existing.discordId) === discordId) {
				removedPreference = existing;
				delete signups.preferencesByTag[playerTag];
				status = "cleared";
				cleared = true;
			} else {
				status = "not-owner";
			}
		}
		signups.updatedAt = nowIso;
		signups.audit[buildCwlSignupAuditKey_(nowIso)] = {
			action: cleared ? "cleared" : "clear_noop",
			status: status,
			playerTag: playerTag,
			optionKey: sanitizeCwlSignupText_(existing && existing.optionKey, 80),
			leagueKey: sanitizeCwlSignupText_(existing && existing.leagueKey, 80),
			leagueName: sanitizeCwlSignupText_(existing && existing.leagueName, 80),
			targetRosterId: sanitizeCwlSignupText_(existing && existing.targetRosterId, 80),
			targetClanTag: normalizeTag_(existing && existing.targetClanTag),
			targetClanName: sanitizeCwlSignupText_(existing && existing.targetClanName, 80),
			discordId: discordId,
			discordUsername: sanitizeDiscordUsernameValue_(payload.discordUsername),
			messageId: sanitizeCwlSignupText_(payload.messageId, 80),
			channelId: sanitizeCwlSignupText_(payload.channelId, 80),
			guildId: sanitizeCwlSignupText_(payload.guildId, 80),
			source: sanitizeCwlSignupText_(payload.source || "discord-user-clear", 120),
			createdAt: nowIso,
		};
		const saved = writeActiveCwlLeagueSignups_(signups);
		return {
			ok: true,
			status: status,
			cleared: cleared,
			playerTag: playerTag,
			signupId: saved.signupId,
			preference: cleared ? null : (existing || null),
			removedPreference: cleared ? removedPreference : null,
			preferenceCount: Object.keys(saved.preferencesByTag || {}).length,
		};
	});
	if (result && result.cleared === true) enqueueCwlPreferenceMirrorsAfterMutation_("cwl-preference-clear");
	return result;
}

function archiveAndResetCwlLeagueSignups_(reasonRaw, sourceRaw) {
	const result = withCwlLeagueSignupWriteLock_(function () {
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
			optionSnapshotUpdatedAt: "",
			optionsByKey: {},
			optionsByLeagueKey: {},
			preferencesByTag: {},
			audit: {},
		});
		return { archived: hasArchiveData, count: count, archiveKey: archiveKey, signupId: saved.signupId };
	});
	enqueueActiveCwlLeagueSignupsAfterMutation_("cwl-signups-reset");
	return result;
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
