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
		case "syncDiscordUsernameForPlayerTag":
			return syncDiscordUsernameForPlayerTag(args[0], args[1], args[2]);
		case "debugFirebaseAuthForDiscordSync":
			return debugFirebaseAuthForDiscordSync(args[0]);
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
	const sanitized = String(discordUsernameRaw == null ? "" : discordUsernameRaw)
		.replace(/[\u0000-\u001F\u007F]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (!sanitized) {
		throw new Error("Discord username is required.");
	}
	return sanitized;
}

// Return safe Firebase auth diagnostics for the Discord-sync transport path.
function debugFirebaseAuthForDiscordSync(botSecret) {
	assertDiscordBotApiSecret_(botSecret);
	clearFirebaseAccessTokenCache_();
	const config = getFirebaseConfig_();
	const diagnostics = {
		ok: true,
		dbUrlPresent: !!config.dbUrl,
		clientEmailPresent: !!config.clientEmail,
		tokenUriPresent: !!config.tokenUri,
		privateKeyHasBegin: config.privateKey.indexOf("-----BEGIN PRIVATE KEY-----") >= 0,
		privateKeyHasEnd: config.privateKey.indexOf("-----END PRIVATE KEY-----") >= 0,
		privateKeyNewlineCount: (config.privateKey.match(/\n/g) || []).length,
		privateKeyLength: config.privateKey.length,
	};
	requestFirebaseAccessToken_();
	diagnostics.tokenAcquired = true;
	return diagnostics;
}

// Set a missing Discord username for matching active-roster player tags.
function syncDiscordUsernameForPlayerTag(playerTag, discordUsername, botSecret) {
	assertDiscordBotApiSecret_(botSecret);
	const normalizedTag = normalizeDiscordSyncPlayerTag_(playerTag);
	const sanitizedDiscordUsername = sanitizeDiscordUsername_(discordUsername);

	return withActiveRosterJobLock_("discord-sync", ACTIVE_ROSTER_JOB_LOCK_WAIT_MS, function () {
		const sourceSnapshot = readActiveRosterSnapshot_();
		const rosterData = sourceSnapshot && sourceSnapshot.rosterData ? sourceSnapshot.rosterData : null;
		if (!rosterData || !Array.isArray(rosterData.rosters)) {
			throw new Error("Active roster data is unavailable.");
		}

		const locations = [];
		let updatedCount = 0;
		let skippedExistingCount = 0;
		const roles = ["main", "subs", "missing"];

		for (let i = 0; i < rosterData.rosters.length; i++) {
			const roster = rosterData.rosters[i] && typeof rosterData.rosters[i] === "object" ? rosterData.rosters[i] : {};
			for (let roleIndex = 0; roleIndex < roles.length; roleIndex++) {
				const role = roles[roleIndex];
				const players = Array.isArray(roster[role]) ? roster[role] : [];
				for (let playerIndex = 0; playerIndex < players.length; playerIndex++) {
					const player = players[playerIndex] && typeof players[playerIndex] === "object" ? players[playerIndex] : {};
					let storedTag = "";
					try {
						storedTag = normalizeDiscordSyncPlayerTag_(player.tag);
					} catch (err) {
						continue;
					}
					if (storedTag !== normalizedTag) continue;

					const previousDiscord = typeof player.discord === "string" ? player.discord : "";
					const hasExistingDiscord = previousDiscord.trim().length > 0;
					const updated = !hasExistingDiscord;
					if (updated) {
						player.discord = sanitizedDiscordUsername;
						updatedCount++;
					} else {
						skippedExistingCount++;
					}
					locations.push({
						rosterId: typeof roster.id === "string" ? roster.id : "",
						rosterTitle: typeof roster.title === "string" ? roster.title : "",
						role: role,
						index: playerIndex,
						previousDiscord: previousDiscord,
						updated: updated,
					});
				}
			}
		}

		if (!locations.length) {
			return {
				ok: true,
				found: false,
				updated: false,
				reason: "player-not-found",
				tag: normalizedTag,
			};
		}

		if (updatedCount > 0) {
			const updatedAt = new Date().toISOString();
			const validated = withRosterLastUpdatedAt_(rosterData, updatedAt);
			replaceActiveRosterData_(validated, { sourceSnapshot: sourceSnapshot });
			markActiveDataWriteSuccess_(updatedAt, ACTIVE_DATA_WRITE_SOURCE_DISCORD_SYNC);
		}

		return {
			ok: true,
			found: true,
			updated: updatedCount > 0,
			tag: normalizedTag,
			discordUsername: sanitizedDiscordUsername,
			updatedCount: updatedCount,
			skippedExistingCount: skippedExistingCount,
			locations: locations,
		};
	});
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
