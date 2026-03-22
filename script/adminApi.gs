// Admin API dispatcher and public callable wrappers.

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
		default:
			throw new Error("Unsupported admin method: " + methodName);
	}
}

function getRosterData() {
	return parseRosterDataText_(getAssetText_(ACTIVE_ROSTER_FILENAME), ACTIVE_ROSTER_FILENAME);
}

function verifyAdminPassword(password) {
	assertAdminPassword_(password);
	return { ok: true };
}

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

function getAutoRefreshSettings(password) {
	assertAdminPassword_(password);
	const scriptLock = LockService.getScriptLock();
	scriptLock.waitLock(30000);
	try {
		reconcileAutoRefreshTriggerState_();
		return readAutoRefreshSettings_();
	} finally {
		scriptLock.releaseLock();
	}
}

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
		return readAutoRefreshSettings_();
	} finally {
		scriptLock.releaseLock();
	}
}

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
