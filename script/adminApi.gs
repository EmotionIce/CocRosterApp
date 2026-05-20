// Admin API dispatcher and public callable wrappers.

// Handle run admin API method.
function runAdminApiMethod_(methodNameRaw, argsRaw) {
	const methodName = String(methodNameRaw == null ? "" : methodNameRaw).trim();
	const args = Array.isArray(argsRaw) ? argsRaw : [];
	switch (methodName) {
		case "getRosterData":
			return getRosterData();
		case "verifyAdminPassword":
			return verifyAdminPassword(args[0]);
		case "getAutoRefreshSettings":
			return getAutoRefreshSettings(args[0]);
		case "setAutoRefreshEnabled":
			return setAutoRefreshEnabled(args[0], args[1]);
		case "testClanConnection":
			return testClanConnection(args[0], args[1], args[2]);
		case "refreshAllRosters":
			return refreshAllRosters(args[0], args[1], args[2]);
		case "publishRosterData":
			return publishRosterData(args[0], args[1]);
		case "getPlayerProfile":
			return getPlayerProfile(args[0], args[1]);
		case "syncDiscordIdentityForPlayerTag":
			return syncDiscordIdentityForPlayerTag.apply(null, args);
		case "syncDiscordUsernameForPlayerTag":
			return syncDiscordUsernameForPlayerTag(args[0], args[1], args[2]);
		case "reconcileCurrentSeasonEvents":
			return reconcileCurrentSeasonEvents(args[0], args[1]);
		case "getCurrentSeasonEvents":
			return getCurrentSeasonEvents(args[0], args[1]);
		case "getSeasonEvent":
			return getSeasonEvent(args[0], args[1]);
		case "getSeasonEventLeaderboard":
			return getSeasonEventLeaderboard(args[0], args[1]);
		case "getCurrentSeasonEventLeaderboards":
			return getCurrentSeasonEventLeaderboards(args[0], args[1]);
		case "updateSeasonEvent":
			return updateSeasonEvent(args[0], args[1]);
		case "registerSeasonEventSignup":
			return registerSeasonEventSignup(args[0], args[1]);
		case "updateSeasonEventParticipantAccounts":
			return updateSeasonEventParticipantAccounts(args[0], args[1]);
		case "cancelSeasonEventSignup":
			return cancelSeasonEventSignup(args[0], args[1]);
		case "debugFirebaseAuthForDiscordSync":
			return debugFirebaseAuthForDiscordSync(args[0], args[1]);
		case "debugFirebasePrivateKeySigning":
			return debugFirebasePrivateKeySigning(args[0]);
		default:
			throw new Error("Unsupported admin method: " + methodName);
	}
}

// Get roster data.
function getRosterData() {
	return parseRosterDataText_(getAssetText_(ACTIVE_ROSTER_FILENAME), ACTIVE_ROSTER_FILENAME);
}

// Handle verify admin password.
function verifyAdminPassword(password) {
	assertAdminPassword_(password);
	return { ok: true };
}

// Get player profile.
function getPlayerProfile(playerTag, password) {
	const normalizedTag = normalizeTag_(playerTag);
	if (!isValidPlayerTag_(normalizedTag)) {
		throw new Error("Invalid player tag.");
	}

	const isAdmin = hasValidAdminPassword_(password);
	if (!isAdmin && !isPublishedRosterTag_(normalizedTag)) {
		throw new Error("Not authorized to fetch this player tag.");
	}

	const cache = CacheService.getScriptCache();
	const cacheKey = "playerProfile:" + normalizedTag;
	const cached = cache.get(cacheKey);
	if (cached) {
		try {
			const parsed = JSON.parse(cached);
			if (parsed && parsed.ok && normalizeTag_(parsed.tag) === normalizedTag) {
				return parsed;
			}
		} catch (err) {
			Logger.log("Ignoring invalid player profile cache for %s: %s", normalizedTag, err && err.message ? err.message : String(err));
		}
	}

	try {
		const player = cocFetch_("/players/" + encodeTagForPath_(normalizedTag));
		const payload = {
			ok: true,
			tag: normalizedTag,
			fetchedAt: new Date().toISOString(),
			player: player && typeof player === "object" ? player : {},
		};

		try {
			cache.put(cacheKey, JSON.stringify(payload), PLAYER_PROFILE_CACHE_TTL_SECONDS);
		} catch (cacheErr) {
			Logger.log("Unable to cache player profile for %s: %s", normalizedTag, cacheErr && cacheErr.message ? cacheErr.message : String(cacheErr));
		}

		return payload;
	} catch (err) {
		throw normalizePlayerProfileError_(normalizedTag, err);
	}
}

// Normalize an externally supplied player tag for Discord bot lookups.
function normalizeDiscordSyncPlayerTag_(playerTagRaw) {
	const compact = String(playerTagRaw == null ? "" : playerTagRaw)
		.trim()
		.toUpperCase()
		.replace(/\s+/g, "")
		.replace(/O/g, "0");
	const normalizedTag = normalizeTag_(compact);
	if (!isValidPlayerTag_(normalizedTag)) {
		throw new Error("Invalid player tag.");
	}
	return normalizedTag;
}

// Sanitize a plain Discord username without imposing mention formatting.
function sanitizeDiscordUsername_(discordUsernameRaw) {
	const sanitized = sanitizeDiscordUsernameValue_(discordUsernameRaw);
	if (!sanitized) {
		throw new Error("Discord username is required.");
	}
	return sanitized;
}

// Return safe Firebase private-key signing diagnostics for comparison without exposing secrets.
function debugFirebasePrivateKeySigning(botSecret) {
	assertDiscordBotApiSecret_(botSecret);
	const raw = PropertiesService.getScriptProperties().getProperty("FIREBASE_PRIVATE_KEY");
	const legacyKey = legacyNormalizeFirebasePrivateKey_(raw);
	let strictKey;
	let strictDiagnostics = null;
	try {
		strictKey = normalizeFirebasePrivateKey_(raw);
		strictDiagnostics = Object.assign({}, getSafePrivateKeyDiagnostics_("strict", strictKey), {
			signing: trySignWithPrivateKeyForDiagnostics_(strictKey),
		});
	} catch (err) {
		strictDiagnostics = { normalizerError: errorMessage_(err) };
	}

	return {
		ok: true,
		legacy: Object.assign({}, getSafePrivateKeyDiagnostics_("legacy", legacyKey), {
			signing: trySignWithPrivateKeyForDiagnostics_(legacyKey),
		}),
		strict: strictDiagnostics,
		sameAsLegacy: legacyKey === strictKey,
	};
}

// Return safe Firebase auth diagnostics for the Discord-sync transport path.
function debugFirebaseAuthForDiscordSync(botSecret, forceRefreshRaw) {
	assertDiscordBotApiSecret_(botSecret);
	const forceRefresh = forceRefreshRaw === true;
	if (forceRefresh) {
		clearFirebaseAccessTokenCache_();
	}
	const config = getFirebaseConfig_();
	const diagnostics = {
		ok: true,
		forceRefresh: forceRefresh,
		dbUrlPresent: !!config.dbUrl,
		clientEmailPresent: !!config.clientEmail,
		tokenUriPresent: !!config.tokenUri,
		privateKeyHasBegin: config.privateKey.indexOf("-----BEGIN PRIVATE KEY-----") >= 0,
		privateKeyHasEnd: config.privateKey.indexOf("-----END PRIVATE KEY-----") >= 0,
		privateKeyNewlineCount: (config.privateKey.match(/\n/g) || []).length,
		privateKeyLength: config.privateKey.length,
	};
	getFirebaseAccessToken_(forceRefresh);
	diagnostics.tokenAcquired = true;
	return diagnostics;
}

// Parse old and new Discord bot sync argument shapes.
function parseDiscordIdentitySyncArgs_(arg0, arg1, arg2, arg3) {
	if (arg0 && typeof arg0 === "object" && !Array.isArray(arg0)) {
		const payload = arg0;
		return {
			playerTag: payload.playerTag || payload.tag,
			discordId: payload.discordId,
			discordUsername: payload.discordUsername != null ? payload.discordUsername : payload.username,
			botSecret: payload.botSecret != null ? payload.botSecret : arg1,
		};
	}
	if (arg3 != null) {
		return {
			playerTag: arg0,
			discordId: arg1,
			discordUsername: arg2,
			botSecret: arg3,
		};
	}
	return {
		playerTag: arg0,
		discordId: "",
		discordUsername: arg1,
		botSecret: arg2,
	};
}

// Sync canonical Discord identity for a player tag.
function syncDiscordIdentityForPlayerTag(arg0, arg1, arg2, arg3) {
	const parsed = parseDiscordIdentitySyncArgs_(arg0, arg1, arg2, arg3);
	assertDiscordBotApiSecret_(parsed.botSecret);
	const normalizedTag = normalizeDiscordSyncPlayerTag_(parsed.playerTag);
	const discordId = sanitizeDiscordIdValue_(parsed.discordId);
	const discordUsername = sanitizeDiscordUsernameValue_(parsed.discordUsername);
	if (!discordId && !discordUsername) {
		throw new Error("Discord username or Discord ID is required.");
	}

	return withActiveRosterJobLock_("discord-sync", ACTIVE_ROSTER_JOB_LOCK_WAIT_MS, function () {
		const updatedAt = new Date().toISOString();
		const result = syncDiscordIdentityIntoActiveRoster_(
			{
				playerTag: normalizedTag,
				discordId: discordId,
				discordUsername: discordUsername,
				discordSource: ACTIVE_DATA_WRITE_SOURCE_DISCORD_SYNC,
			},
			{
				updatedAt: updatedAt,
				source: ACTIVE_DATA_WRITE_SOURCE_DISCORD_SYNC,
				createMissing: true,
			},
		);
		if (result && result.updated) {
			markActiveDataWriteSuccess_(updatedAt, ACTIVE_DATA_WRITE_SOURCE_DISCORD_SYNC);
		}
		return result;
	});
}

// Backwards-compatible username-only wrapper.
function syncDiscordUsernameForPlayerTag(playerTag, discordUsername, botSecret) {
	return syncDiscordIdentityForPlayerTag(playerTag, "", discordUsername, botSecret);
}

// Get auto refresh settings.
function getAutoRefreshSettings(password) {
	assertAdminPassword_(password);
	const scriptLock = LockService.getScriptLock();
	scriptLock.waitLock(30000);
	try {
		reconcileAutoRefreshTriggerState_();
		reconcileRegularWarFinalizationTriggerState_();
		return readAutoRefreshSettings_();
	} finally {
		scriptLock.releaseLock();
	}
}

// Set auto refresh enabled.
function setAutoRefreshEnabled(enabledRaw, password) {
	assertAdminPassword_(password);
	const enabled = toBooleanFlag_(enabledRaw);
	const scriptLock = LockService.getScriptLock();
	scriptLock.waitLock(30000);
	try {
		const props = PropertiesService.getScriptProperties();
		if (enabled) props.setProperty(AUTO_REFRESH_ENABLED_PROPERTY, "1");
		else props.deleteProperty(AUTO_REFRESH_ENABLED_PROPERTY);
		reconcileAutoRefreshTriggerState_();
		reconcileRegularWarFinalizationTriggerState_();
		return readAutoRefreshSettings_();
	} finally {
		scriptLock.releaseLock();
	}
}

// Publish roster data.
function publishRosterData(rosterData, password) {
	assertAdminPassword_(password);
	checkPublishCooldown_();
	return withActiveRosterJobLock_("manual-publish", ACTIVE_ROSTER_JOB_LOCK_WAIT_MS, function () {
		const meta = writePublishedRosterData_(rosterData);
		markPublish_();
		return { ok: true, publishedAt: meta.publishedAt, playerCount: meta.playerCount, noteCount: meta.noteCount, metricEntryCount: meta.metricEntryCount };
	});
}

// Asset route remains for active roster JSON compatibility.

function testClanConnection(rosterData, rosterId, password) {
	assertAdminPassword_(password);
	const ctx = findRosterForClanSync_(rosterData, rosterId);
	const members = fetchClanMembers_(ctx.clanTag);
	return { ok: true, memberCount: members.length };
}

// Refresh all rosters.
function refreshAllRosters(rosterData, password, optionsRaw) {
	assertAdminPassword_(password);
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const runOptions = Object.assign({}, options);
	runOptions.lockOwner = "manual-refresh-all";
	runOptions.lockWaitMs = ACTIVE_ROSTER_JOB_LOCK_WAIT_MS;
	const runResult = runRefreshAllRostersCore_(rosterData, runOptions);
	if (runResult && runResult.skipped) {
		throw new Error("Refresh all was skipped.");
	}
	return runResult;
}
