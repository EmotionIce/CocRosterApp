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
		case "getAdminWorkspaceBootstrap":
			return getAdminWorkspaceBootstrap(args[0]);
		case "getAdminUnlockSnapshotV2":
			return getAdminUnlockSnapshotV2(args[0]);
		case "getAdminRosterSnapshotV2":
			return getAdminRosterSnapshotV2(args[0], args[1]);
		case "repairAdminRuntimeState":
			return repairAdminRuntimeState(args[0], args[1]);
		case "getAutoRefreshSettings":
			return getAutoRefreshSettings(args[0]);
		case "getAutoRefreshDiagnostics":
			return getAutoRefreshDiagnostics(args[0]);
		case "getProductionTriggerAuthorizationDiagnostics":
			return getProductionTriggerAuthorizationDiagnostics(args[0]);
		case "setAutoRefreshEnabled":
			return setAutoRefreshEnabled(args[0], args[1]);
		case "repairAutoRefreshScheduler":
			return repairAutoRefreshScheduler(args[0], args[1]);
		case "getDonationRefreshSettings":
			return getDonationRefreshSettings(args[0]);
		case "setDonationRefreshEnabled":
			return setDonationRefreshEnabled(args[0], args[1]);
		case "runDonationRefreshNow":
			return runDonationRefreshNow(args[0]);
		case "testClanConnection":
			return testClanConnection(args[0], args[1], args[2]);
		case "refreshAllRosters":
			return refreshAllRosters(args[0], args[1], args[2]);
		case "publishRosterData":
			return publishRosterData(args[0], args[1]);
		case "publishRosterDataV2":
			return publishRosterDataV2(args[0], args[1], args[2], args[3]);
		case "getPlayerProfile":
			return getPlayerProfile(args[0], args[1]);
		case "deleteDiscordIdentityLink":
			return deleteDiscordIdentityLink.apply(null, args);
		case "deleteDiscordIdentityForPlayerTag":
			return deleteDiscordIdentityForPlayerTag.apply(null, args);
		case "linkDiscordIdentityForPlayerTag":
			return linkDiscordIdentityForPlayerTag.apply(null, args);
		case "syncDiscordIdentityForPlayerTag":
			return syncDiscordIdentityForPlayerTag.apply(null, args);
		case "syncDiscordUsernameForPlayerTag":
			return syncDiscordUsernameForPlayerTag(args[0], args[1], args[2]);
		case "backfillDiscordIdentitiesFromRosterCacheOnce":
			return backfillDiscordIdentitiesFromRosterCacheOnce(args[0]);
		case "reconcileCurrentSeasonEvents":
			return reconcileCurrentSeasonEvents(args[0], args[1]);
		case "getCurrentSeasonEvents":
			return getCurrentSeasonEvents(args[0], args[1]);
		case "ensureCurrentCwlSeasonEvent":
			return ensureCurrentCwlSeasonEvent(args[0], args[1]);
		case "getCurrentCwlSeasonEvent":
			return getCurrentCwlSeasonEvent(args[0], args[1]);
		case "refreshCurrentCwlSeasonEvent":
			return refreshCurrentCwlSeasonEvent(args[0], args[1]);
		case "auditCwlSeasonEventCompletionIntegrity":
			return auditCwlSeasonEventCompletionIntegrity(args[0], args[1]);
		case "recoverFalseCompletedCwlSeasonEvent":
			return recoverFalseCompletedCwlSeasonEvent(args[0], args[1]);
		case "repairLegacyCwlSeasonEventBinding":
			return repairLegacyCwlSeasonEventBinding(args[0], args[1]);
		case "getSeasonEvent":
			return getSeasonEvent(args[0], args[1]);
		case "getSeasonEventMutationContext":
			return getSeasonEventMutationContext(args[0], args[1]);
		case "getSeasonEventLeaderboard":
			return getSeasonEventLeaderboard(args[0], args[1]);
		case "getCurrentSeasonEventLeaderboards":
			return getCurrentSeasonEventLeaderboards(args[0], args[1]);
		case "getCwlLeagueSignupOptions":
			return getCwlLeagueSignupOptions(args[0], args[1]);
		case "setCwlLeaguePreference":
			return setCwlLeaguePreference(args[0], args[1]);
		case "getCwlLeaguePreferencesForDiscordUser":
			return getCwlLeaguePreferencesForDiscordUser(args[0], args[1]);
		case "getCwlLeagueSignupContextForDiscordUser":
			return getCwlLeagueSignupContextForDiscordUser(args[0], args[1]);
		case "clearCwlLeaguePreference":
			return clearCwlLeaguePreference(args[0], args[1]);
		case "resetCwlLeaguePreferences":
			return resetCwlLeaguePreferences(args[0], args[1]);
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
		case "cleanupFirebaseStorageRetention":
			return cleanupFirebaseStorageRetention(args[0]);
		case "ensureActiveLinkedAccountTagIndex":
			return ensureActiveLinkedAccountTagIndex(args[0]);
		case "migrateCwlSeasonEventDefenseStarsStorage":
			return migrateCwlSeasonEventDefenseStarsStorage(args[0], args[1]);
		case "publishCloudflarePublicDataSnapshot":
			return publishCloudflarePublicDataSnapshot(args[0], args[1]);
		case "repairCloudflareActiveRosterMirror":
			return repairCloudflareActiveRosterMirror(args[0], args[1]);
		case "initializeCloudflarePublishQueue":
			if (typeof ensurePermanentSchedulerWatchdogTrigger_ === "function") ensurePermanentSchedulerWatchdogTrigger_();
			return initializeCloudflarePublishQueue(args[0], args[1]);
		case "setCloudflarePublicationMode":
			return setCloudflarePublicationMode(args[0], args[1]);
		case "inspectCloudflarePublishQueue":
			return inspectCloudflarePublishQueue(args[0], args[1]);
		case "retryCloudflarePublishQueue":
			return retryCloudflarePublishQueue(args[0], args[1]);
		case "runCloudflarePublishWorkerTick":
			return runCloudflarePublishWorkerTick(args[0], args[1]);
		case "runAutoRefreshActiveRosterTick":
			return runAutoRefreshActiveRosterTick(args[0], args[1]);
		case "runAutoRefreshWorkerTick":
			return runAutoRefreshWorkerTick(args[0], args[1]);
		case "repairCloudflarePublishQueue":
			return repairCloudflarePublishQueue(args[0], args[1]);
		case "repairCloudflareBotVersionObjects":
			return repairCloudflareBotVersionObjects(args[0], args[1]);
		case "runCanonicalRepairMarker":
			assertAdminPassword_(args[1]);
			return runCanonicalRepairMarker_(args[0] && args[0].runId);
		case "pauseCloudflarePublishQueue":
			return pauseCloudflarePublishQueue(args[0], args[1]);
		case "dryRunPlayerWarTrackingMigration":
			return dryRunPlayerWarTrackingMigration(args[0], args[1]);
		case "stagePlayerWarTrackingMigration":
			return stagePlayerWarTrackingMigration(args[0], args[1]);
		case "commitPlayerWarTrackingMigration":
			return commitPlayerWarTrackingMigration(args[0], args[1]);
		case "rollbackPlayerWarTrackingMigration":
			return rollbackPlayerWarTrackingMigration(args[0], args[1]);
		case "inspectPlayerWarTracking":
			return inspectPlayerWarTracking(args[0], args[1]);
		case "setPlayerWarTrackingRolloutStage":
			return setPlayerWarTrackingRolloutStage(args[0], args[1]);
		case "getWarFollowupState":
			return getWarFollowupState(args[0]);
		case "getWarFollowupCase":
			return getWarFollowupCase(args[0], args[1]);
		case "saveWarFollowupSettings":
			return saveWarFollowupSettings(args[0], args[1], args[2], args[3]);
		case "getWarFollowupRulesStatus":
			return getWarFollowupRulesStatus(args[0], args[1]);
		case "getWarFollowupTrustStatus":
			return getWarFollowupTrustStatus(args[0], args[1], args[2]);
		case "setWarFollowupTrustedAccount":
			return setWarFollowupTrustedAccount(args[0], args[1], args[2], args[3]);
		case "mutateWarFollowupCase":
			return mutateWarFollowupCase(args[0], args[1]);
		default:
			throw new Error("Unsupported admin method: " + methodName);
	}
}

// Get roster data.
function getRosterData() {
	const rosterData = parseRosterDataText_(getAssetText_(ACTIVE_ROSTER_FILENAME), ACTIVE_ROSTER_FILENAME);
	try {
		rosterData.cwlLeagueSignups = readActiveCwlLeagueSignups_();
	} catch (err) {
		Logger.log("Unable to hydrate CWL league signups into roster data: %s", errorMessage_(err));
	}
	return rosterData;
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
		throw createRosterBackendError_("INVALID_PLAYER_TAG", "Invalid player tag.");
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

// Run Firebase storage retention cleanup through the admin bridge.
function cleanupFirebaseStorageRetention(password) {
	assertAdminPassword_(password);
	return cleanupFirebaseStorageRetention_({ reason: "admin-api" });
}

function dryRunPlayerWarTrackingMigration(optionsRaw, password) {
	assertAdminPassword_(password);
	return dryRunPlayerWarTrackingMigration_(optionsRaw);
}

function stagePlayerWarTrackingMigration(optionsRaw, password) {
	assertAdminPassword_(password);
	return stagePlayerWarTrackingMigration_(optionsRaw);
}

function commitPlayerWarTrackingMigration(requestRaw, password) {
	assertAdminPassword_(password);
	return withActiveRosterJobLock_("player-war-migration-commit", ACTIVE_ROSTER_JOB_LOCK_WAIT_MS, function () {
		return commitPlayerWarTrackingMigration_(requestRaw);
	});
}

function rollbackPlayerWarTrackingMigration(requestRaw, password) {
	assertAdminPassword_(password);
	return withActiveRosterJobLock_("player-war-migration-rollback", ACTIVE_ROSTER_JOB_LOCK_WAIT_MS, function () {
		return rollbackPlayerWarTrackingMigration_(requestRaw);
	});
}

function inspectPlayerWarTracking(optionsRaw, password) {
	assertAdminPassword_(password);
	return inspectPlayerWarTracking_(optionsRaw);
}

function setPlayerWarTrackingRolloutStage(stageRaw, password) {
	assertAdminPassword_(password);
	return withActiveRosterJobLock_("player-war-stage-transition", ACTIVE_ROSTER_JOB_LOCK_WAIT_MS, function () {
		return publishPlayerWarTrackingStageVersion_(stageRaw);
	});
}

// Materialize the compact derived linked-account index for the currently
// published immutable version. This is idempotent and lets a legacy version be
// upgraded once without publishing or changing its canonical roster payload.
function ensureActiveLinkedAccountTagIndex(password) {
	assertAdminPassword_(password);
	const versionId = readPublishedActiveVersionId_();
	if (!versionId) throw new Error("No published active version is available.");
	const existing = readActiveVersionLinkedAccountCandidateTags_(versionId, {});
	if (existing && existing.complete === true) {
		return { ok: true, created: false, versionId: versionId, reason: "already-complete" };
	}
	const snapshot = readActivePlayerMetricsSnapshot_(versionId);
	if (!snapshot || snapshot.fallback === true || normalizeActiveVersionId_(snapshot.versionId) !== versionId) {
		throw new Error("Unable to read canonical player metrics for active version " + versionId + ".");
	}
	const manifest = writeActiveVersionLinkedAccountTagIndex_(versionId, snapshot.playerMetrics, {
		builtAt: new Date().toISOString(),
	});
	return {
		ok: true,
		created: true,
		versionId: versionId,
		metricEntryCount: toNonNegativeInt_(manifest.metricEntryCount),
		linkedTagCount: toNonNegativeInt_(manifest.linkedTagCount),
	};
}

// Parse old and new Discord bot sync argument shapes.
function parseDiscordIdentitySyncArgs_(arg0, arg1, arg2, arg3, arg4) {
	if (arg0 && typeof arg0 === "object" && !Array.isArray(arg0)) {
		const payload = arg0;
		return {
			playerTag: payload.playerTag || payload.tag,
			discordId: payload.discordId,
			discordUsername: payload.discordUsername != null ? payload.discordUsername : payload.username,
			botSecret: payload.botSecret != null ? payload.botSecret : arg1,
			force: payload.force === true,
		};
	}
	if (arg3 != null) {
		return {
			playerTag: arg0,
			discordId: arg1,
			discordUsername: arg2,
			botSecret: arg3,
			force: arg4 === true,
		};
	}
	return {
		playerTag: arg0,
		discordId: "",
		discordUsername: arg1,
		botSecret: arg2,
		force: false,
	};
}

// Parse Discord bot delete argument shapes.
function parseDiscordIdentityDeleteArgs_(arg0, arg1) {
	if (arg0 && typeof arg0 === "object" && !Array.isArray(arg0)) {
		const payload = arg0;
		return {
			playerTag: payload.playerTag || payload.tag,
			botSecret: payload.botSecret != null ? payload.botSecret : arg1,
		};
	}
	return {
		playerTag: arg0,
		botSecret: arg1,
	};
}

// Parse Discord bot manual-link delete argument shapes.
function parseDiscordIdentityLinkDeleteArgs_(arg0, arg1) {
	if (arg0 && typeof arg0 === "object" && !Array.isArray(arg0)) {
		const payload = arg0;
		const discordUser = payload.discordUser && typeof payload.discordUser === "object" ? payload.discordUser : {};
		return {
			playerTag: payload.playerTag || payload.tag,
			discordId: payload.discordId != null ? payload.discordId : discordUser.id || discordUser.discordId,
			discordUsername: payload.discordUsername != null ? payload.discordUsername : payload.username != null ? payload.username : discordUser.username || discordUser.discordUsername,
			botSecret: payload.botSecret != null ? payload.botSecret : arg1,
		};
	}
	return {
		playerTag: arg0,
		discordId: "",
		discordUsername: "",
		botSecret: arg1,
	};
}

// Fetch and normalize a player profile for manual Discord link creation.
function fetchDiscordLinkPlayerProfile_(normalizedTag) {
	try {
		const player = cocFetch_("/players/" + encodeTagForPath_(normalizedTag));
		return {
			tag: normalizeTag_(player && player.tag) || normalizedTag,
			name: String(player && player.name != null ? player.name : "").trim(),
			th: readTownHallLevel_(player),
		};
	} catch (err) {
		if (err && Number(err.statusCode) === 404) {
			throw createRosterBackendError_("PLAYER_NOT_FOUND", "Player not found for tag " + normalizedTag + ".");
		}
		const normalized = normalizePlayerProfileError_(normalizedTag, err);
		throw createRosterBackendError_("PLAYER_LOOKUP_FAILED", errorMessage_(normalized));
	}
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

// Create or update a canonical Discord identity link with conflict handling for staff commands.
function linkDiscordIdentityForPlayerTag(arg0, arg1, arg2, arg3, arg4) {
	const parsed = parseDiscordIdentitySyncArgs_(arg0, arg1, arg2, arg3, arg4);
	assertDiscordBotApiSecret_(parsed.botSecret);
	const normalizedTag = normalizeDiscordSyncPlayerTag_(parsed.playerTag);
	const discordId = sanitizeDiscordIdValue_(parsed.discordId);
	const discordUsername = sanitizeDiscordUsernameValue_(parsed.discordUsername);
	if (!discordId && !discordUsername) {
		throw new Error("Discord username or Discord ID is required.");
	}
	const playerProfile = fetchDiscordLinkPlayerProfile_(normalizedTag);

	return withActiveRosterJobLock_("discord-manual-link", ACTIVE_ROSTER_JOB_LOCK_WAIT_MS, function () {
		const updatedAt = new Date().toISOString();
		const result = linkDiscordIdentityIntoActiveRoster_(
			{
				playerTag: normalizedTag,
				name: playerProfile.name,
				th: playerProfile.th,
				discordId: discordId,
				discordUsername: discordUsername,
				discordSource: "discord-manual-link",
				force: parsed.force === true,
			},
			{
				updatedAt: updatedAt,
				source: "discord-manual-link",
				createMissing: true,
				force: parsed.force === true,
			},
		);
		if (result && result.updated) {
			markActiveDataWriteSuccess_(updatedAt, ACTIVE_DATA_WRITE_SOURCE_DISCORD_SYNC);
		}
		return Object.assign({}, result, {
			playerName: playerProfile.name,
		});
	});
}

// Delete canonical Discord identity for a player tag.
function deleteDiscordIdentityForPlayerTag(arg0, arg1) {
	const parsed = parseDiscordIdentityDeleteArgs_(arg0, arg1);
	assertDiscordBotApiSecret_(parsed.botSecret);
	const normalizedTag = normalizeDiscordSyncPlayerTag_(parsed.playerTag);

	return withActiveRosterJobLock_("discord-sync", ACTIVE_ROSTER_JOB_LOCK_WAIT_MS, function () {
		const updatedAt = new Date().toISOString();
		const result = deleteDiscordIdentityFromActiveRoster_(
			{
				playerTag: normalizedTag,
			},
			{
				updatedAt: updatedAt,
				source: ACTIVE_DATA_WRITE_SOURCE_DISCORD_SYNC,
			},
		);
		if (result && result.updated) {
			markActiveDataWriteSuccess_(updatedAt, ACTIVE_DATA_WRITE_SOURCE_DISCORD_SYNC);
		}
		return result;
	});
}

// Delete canonical Discord identity by exactly one manual lookup: player tag or Discord user.
function deleteDiscordIdentityLink(arg0, arg1) {
	const parsed = parseDiscordIdentityLinkDeleteArgs_(arg0, arg1);
	assertDiscordBotApiSecret_(parsed.botSecret);
	const hasPlayerTag = !!String(parsed.playerTag == null ? "" : parsed.playerTag).trim();
	const discordId = sanitizeDiscordIdValue_(parsed.discordId);
	const discordUsername = sanitizeDiscordUsernameValue_(parsed.discordUsername);
	const hasDiscordUser = !!(discordId || discordUsername);
	if (hasPlayerTag === hasDiscordUser) {
		throw createRosterBackendError_("DISCORD_LINK_LOOKUP_REQUIRED", "Provide exactly one of playerTag or Discord user.");
	}

	return withActiveRosterJobLock_("discord-manual-link-delete", ACTIVE_ROSTER_JOB_LOCK_WAIT_MS, function () {
		const updatedAt = new Date().toISOString();
		let result;
		if (hasPlayerTag) {
			const normalizedTag = normalizeDiscordSyncPlayerTag_(parsed.playerTag);
			result = deleteDiscordIdentityFromActiveRoster_(
				{
					playerTag: normalizedTag,
				},
				{
					updatedAt: updatedAt,
					source: "discord-manual-link-delete",
				},
			);
			result.lookupType = "playerTag";
			result.deletedCount = result.found ? 1 : 0;
			result.removedPlayerTags = result.found ? [normalizedTag] : [];
			result.removedLinks = result.found
				? [{
					tag: normalizedTag,
					playerTag: normalizedTag,
					discordId: result.removedDiscordId || "",
					discordUsername: result.removedDiscordUsername || "",
				}]
				: [];
		} else {
			result = deleteDiscordIdentityFromActiveRosterByDiscordUser_(
				{
					discordId: discordId,
					discordUsername: discordUsername,
				},
				{
					updatedAt: updatedAt,
					source: "discord-manual-link-delete",
				},
			);
		}

		if (!result || !result.found) {
			throw createRosterBackendError_("DISCORD_LINK_MISSING", "No backend Discord link was found for that lookup.");
		}
		if (result.updated) {
			markActiveDataWriteSuccess_(updatedAt, ACTIVE_DATA_WRITE_SOURCE_DISCORD_SYNC);
		}
		return result;
	});
}

// Backwards-compatible username-only wrapper.
function syncDiscordUsernameForPlayerTag(playerTag, discordUsername, botSecret) {
	return syncDiscordIdentityForPlayerTag(playerTag, "", discordUsername, botSecret);
}

// Load reconciled auto-refresh settings while the caller holds the script lock.
function loadAutoRefreshSettingsForAdmin_() {
	reconcileAutoRefreshTriggerState_();
	reconcileRegularWarFinalizationTriggerState_();
	return readAutoRefreshSettings_();
}

// Load reconciled donation-refresh settings while the caller holds the script lock.
function loadDonationRefreshSettingsForAdmin_() {
	reconcileDonationRefreshTriggerState_();
	return readDonationRefreshSettings_();
}

// Capture one independently recoverable admin-workspace bootstrap section.
function settleAdminWorkspaceBootstrapSection_(callback) {
	try {
		return {
			ok: true,
			value: callback(),
		};
	} catch (err) {
		return {
			ok: false,
			error: errorMessage_(err),
		};
	}
}

// Build matching partial failures when startup settings cannot acquire their shared lock.
function buildAdminWorkspaceBootstrapLockFailure_(err) {
	const message = errorMessage_(err);
	return {
		schemaVersion: 1,
		authenticated: true,
		autoRefresh: {
			ok: false,
			error: message,
		},
		donationRefresh: {
			ok: false,
			error: message,
		},
	};
}

// Authenticate once and load both startup settings under one script lock.
function getAdminWorkspaceBootstrap(password) {
	assertAdminPassword_(password);
	try {
		const scriptLock = LockService.getScriptLock();
		scriptLock.waitLock(30000);
		const result = {
			schemaVersion: 1,
			authenticated: true,
			autoRefresh: settleAdminWorkspaceBootstrapSection_(function () {
				return loadAutoRefreshSettingsForAdmin_();
			}),
			donationRefresh: settleAdminWorkspaceBootstrapSection_(function () {
				return loadDonationRefreshSettingsForAdmin_();
			}),
		};
		try {
			scriptLock.releaseLock();
		} catch (releaseErr) {
			Logger.log("Admin workspace bootstrap could not release its script lock cleanly: %s", errorMessage_(releaseErr));
		}
		return result;
	} catch (err) {
		return buildAdminWorkspaceBootstrapLockFailure_(err);
	}
}

function readAdminScriptPropertiesSnapshot_() {
	const props = PropertiesService.getScriptProperties();
	if (typeof props.getProperties === "function") return props.getProperties();
	const keys = [
		ADMIN_UNLOCK_V2_DISABLED_PROPERTY,
		AUTO_REFRESH_ENABLED_PROPERTY,
		AUTO_REFRESH_TRIGGER_ID_PROPERTY,
		AUTO_REFRESH_JOB_TRIGGER_ID_PROPERTY,
		AUTO_REFRESH_JOB_WATCHDOG_TRIGGER_ID_PROPERTY,
		PERMANENT_SCHEDULER_WATCHDOG_TRIGGER_ID_PROPERTY,
		AUTO_REFRESH_LAST_RUN_STARTED_AT_PROPERTY,
		AUTO_REFRESH_LAST_RUN_FINISHED_AT_PROPERTY,
		AUTO_REFRESH_LAST_RUN_STATUS_PROPERTY,
		AUTO_REFRESH_LAST_RUN_SUMMARY_PROPERTY,
		AUTO_REFRESH_LAST_ISSUE_SUMMARY_PROPERTY,
		AUTO_REFRESH_LAST_RUN_ERROR_PROPERTY,
		AUTO_REFRESH_LAST_RUN_ISSUE_COUNT_PROPERTY,
		ACTIVE_DATA_LAST_SUCCESSFUL_WRITE_AT_PROPERTY,
		AUTO_REFRESH_LAST_ARCHIVE_DATE_PROPERTY,
		REGULAR_WAR_FINALIZATION_TRIGGER_ID_PROPERTY,
		REGULAR_WAR_FINALIZATION_TRIGGER_AT_PROPERTY,
		DONATION_REFRESH_ENABLED_PROPERTY,
		DONATION_REFRESH_TRIGGER_ID_PROPERTY,
		DONATION_REFRESH_LAST_RUN_STARTED_AT_PROPERTY,
		DONATION_REFRESH_LAST_RUN_FINISHED_AT_PROPERTY,
		DONATION_REFRESH_LAST_RUN_STATUS_PROPERTY,
		DONATION_REFRESH_LAST_RUN_SUMMARY_PROPERTY,
		DONATION_REFRESH_LAST_RUN_ERROR_PROPERTY,
		DONATION_REFRESH_LAST_SEASON_ID_PROPERTY,
		DONATION_REFRESH_LAST_WRITE_AT_PROPERTY,
	];
	const result = {};
	for (let i = 0; i < keys.length; i++) result[keys[i]] = props.getProperty(keys[i]);
	return result;
}

function isAdminUnlockV2DisabledFromProperties_(propertiesRaw) {
	const properties = propertiesRaw && typeof propertiesRaw === "object" ? propertiesRaw : {};
	const raw = String(properties[ADMIN_UNLOCK_V2_DISABLED_PROPERTY] || "").trim().toLowerCase();
	return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function buildAdminV2DisabledError_() {
	return createRosterBackendError_("ADMIN_UNLOCK_V2_DISABLED", "Admin Unlock V2 is temporarily disabled.");
}

function buildAdminActiveVersionConflictError_() {
	return createRosterBackendError_(
		"ADMIN_ACTIVE_VERSION_CONFLICT",
		"The active roster version changed while this admin workspace was loading. Reload before publishing.",
	);
}

// Authenticate without reconstructing the roster or mutating runtime state.
function getAdminUnlockSnapshotV2(password) {
	const startedMs = Date.now();
	assertAdminPassword_(password);
	const propertiesStartedMs = Date.now();
	const properties = readAdminScriptPropertiesSnapshot_();
	const propertiesMs = Math.max(0, Date.now() - propertiesStartedMs);
	if (isAdminUnlockV2DisabledFromProperties_(properties)) throw buildAdminV2DisabledError_();

	const autoRefresh = settleAdminWorkspaceBootstrapSection_(function () {
		return readAutoRefreshSettingsFromProperties_(properties, { runtimeVerified: false });
	});
	const donationRefresh = settleAdminWorkspaceBootstrapSection_(function () {
		return readDonationRefreshSettingsFromProperties_(properties, { runtimeVerified: false });
	});

	const firebaseStartedMs = Date.now();
	let activeVersionId = "";
	let activeRoster = null;
	let cwlLeagueSignups = null;
	try {
		const values = firebaseBatchGetJson_([
			FIREBASE_ACTIVE_PUBLISHED_CURRENT_VERSION_PATH,
			CWL_LEAGUE_SIGNUPS_ACTIVE_PATH,
		]);
		try {
			activeVersionId = requireExactSafeActiveVersionId_(
				values[FIREBASE_ACTIVE_PUBLISHED_CURRENT_VERSION_PATH],
				"Published active version id",
			);
			activeRoster = { ok: true, value: { versionId: activeVersionId } };
		} catch (err) {
			activeRoster = { ok: false, error: errorMessage_(err) };
		}
		cwlLeagueSignups = settleAdminWorkspaceBootstrapSection_(function () {
			return sanitizeCwlLeagueSignupsPayload_(
				decodeFirebaseObjectKeysRecursive_(values[CWL_LEAGUE_SIGNUPS_ACTIVE_PATH]),
			);
		});
	} catch (err) {
		const message = errorMessage_(err);
		activeRoster = { ok: false, error: message };
		cwlLeagueSignups = { ok: false, error: message };
		if (!isFirebaseDailyUrlFetchQuotaError_(err)) {
			try {
				activeVersionId = requireExactSafeActiveVersionId_(
					readPublishedActiveVersionIdRaw_(),
					"Published active version id",
				);
				activeRoster = { ok: true, value: { versionId: activeVersionId }, recovered: true };
			} catch (pointerErr) {
				activeRoster = { ok: false, error: errorMessage_(pointerErr) };
			}
		}
	}
	const firebaseMs = Math.max(0, Date.now() - firebaseStartedMs);
	return {
		schemaVersion: 2,
		authenticated: true,
		activeVersionId: activeVersionId,
		activeRoster: activeRoster,
		autoRefresh: autoRefresh,
		donationRefresh: donationRefresh,
		cwlLeagueSignups: cwlLeagueSignups,
		timings: {
			propertiesMs: propertiesMs,
			firebaseMs: firebaseMs,
			totalMs: Math.max(0, Date.now() - startedMs),
		},
	};
}

// Authenticated canonical fallback for an exact generation. A final pointer
// check prevents returning a generation that changed during reconstruction.
function getAdminRosterSnapshotV2(password, expectedVersionIdRaw) {
	const startedMs = Date.now();
	assertAdminPassword_(password);
	const expectedVersionId = requireExactSafeActiveVersionId_(expectedVersionIdRaw, "Expected source version id");
	const snapshot = readExactPublishedActiveRosterSnapshot_(expectedVersionId);
	const finalVersionId = String(readPublishedActiveVersionIdRaw_() || "").trim();
	if (finalVersionId !== expectedVersionId) throw buildAdminActiveVersionConflictError_();
	return {
		schemaVersion: 2,
		authenticated: true,
		sourceVersionId: expectedVersionId,
		rosterData: snapshot.rosterData,
		timings: {
			totalMs: Math.max(0, Date.now() - startedMs),
		},
	};
}

function buildAdminRuntimeBusyResult_(expectedVersionIdRaw) {
	const properties = readAdminScriptPropertiesSnapshot_();
	return {
		schemaVersion: 2,
		authenticated: true,
		status: "busy",
		activeVersionId: String(expectedVersionIdRaw || ""),
		autoRefresh: {
			ok: true,
			value: readAutoRefreshSettingsFromProperties_(properties, { runtimeVerified: false }),
		},
		donationRefresh: {
			ok: true,
			value: readDonationRefreshSettingsFromProperties_(properties, { runtimeVerified: false }),
		},
		families: {
			runtime: { ok: false, busy: true, error: "Runtime verification is already busy." },
		},
	};
}

// Verify and repair only the admin settings-related trigger families. Roster
// data is loaded before taking the script lock; its generation is rechecked
// while locked before regular-war scheduling can use it.
function repairAdminRuntimeState(password, expectedVersionIdRaw) {
	assertAdminPassword_(password);
	let expectedVersionId = "";
	let layoutSection = null;
	try {
		expectedVersionId = requireExactSafeActiveVersionId_(expectedVersionIdRaw, "Expected source version id");
		const layoutSnapshot = readActiveRosterLayoutSnapshotFromVersion_(expectedVersionId);
		if (
			!layoutSnapshot ||
			!layoutSnapshot.manifest ||
			String(layoutSnapshot.manifest.versionId || "").trim() !== expectedVersionId ||
			Number(layoutSnapshot.manifest.schemaVersion) !== ADMIN_EDITING_ROSTER_SCHEMA_VERSION
		) {
			throw new Error("Exact roster layout manifest is not supported for this admin runtime.");
		}
		layoutSection = {
			ok: true,
			value: layoutSnapshot,
		};
	} catch (err) {
		layoutSection = { ok: false, error: errorMessage_(err) };
	}

	const scriptLock = LockService.getScriptLock();
	let didLock = false;
	try {
		didLock = typeof scriptLock.tryLock === "function"
			? scriptLock.tryLock(1000)
			: (scriptLock.waitLock(1000), true);
	} catch (err) {
		didLock = false;
	}
	if (!didLock) return buildAdminRuntimeBusyResult_(expectedVersionId);

	let inventory = null;
	let observedActiveVersionId = expectedVersionId;
	const families = {};
	try {
		try {
			inventory = createProjectTriggerInventory_();
		} catch (err) {
			const properties = readAdminScriptPropertiesSnapshot_();
			return {
				schemaVersion: 2,
				authenticated: true,
				status: "partial",
				activeVersionId: expectedVersionId,
				autoRefresh: { ok: false, error: errorMessage_(err) },
				donationRefresh: { ok: false, error: errorMessage_(err) },
				families: { inventory: { ok: false, error: errorMessage_(err) } },
			};
		}

		families.permanent = settleAdminWorkspaceBootstrapSection_(function () {
			return ensurePermanentSchedulerWatchdogTrigger_(inventory);
		});
		families.autoRefresh = settleAdminWorkspaceBootstrapSection_(function () {
			return reconcileAutoRefreshTriggerState_(inventory);
		});
		families.donationRefresh = settleAdminWorkspaceBootstrapSection_(function () {
			return reconcileDonationRefreshTriggerState_(inventory);
		});
		families.regularWarFinalization = settleAdminWorkspaceBootstrapSection_(function () {
			if (!layoutSection || layoutSection.ok !== true) {
				throw new Error(String((layoutSection && layoutSection.error) || "Exact roster layout is unavailable."));
			}
			const currentVersionId = String(readPublishedActiveVersionIdRaw_() || "").trim();
			if (currentVersionId) observedActiveVersionId = currentVersionId;
			if (currentVersionId !== expectedVersionId) {
				throw buildAdminActiveVersionConflictError_();
			}
			const activeJob = readActiveRosterJobLockState_();
			if (activeJob && Number(activeJob.expiresAt) > Date.now()) {
				throw new Error("Regular-war runtime verification deferred because an active roster write is running.");
			}
			return reconcileRegularWarFinalizationTriggerStateValidated_(
				layoutSection.value.rosterData,
				inventory,
			);
		});

		const properties = readAdminScriptPropertiesSnapshot_();
		const autoRefresh = families.autoRefresh.ok
			? {
				ok: true,
				value: readAutoRefreshSettingsFromProperties_(properties, { runtimeVerified: true }),
			}
			: { ok: false, error: families.autoRefresh.error };
		const donationRefresh = families.donationRefresh.ok
			? {
				ok: true,
				value: readDonationRefreshSettingsFromProperties_(properties, { runtimeVerified: true }),
			}
			: { ok: false, error: families.donationRefresh.error };
		const familyKeys = Object.keys(families);
		const partial = familyKeys.some(function (key) {
			const section = families[key];
			const value = section && section.value && typeof section.value === "object" ? section.value : null;
			return !section ||
				section.ok !== true ||
				!!(value && value.ok === false) ||
				!!(value && value.scheduled === false && value.degraded === true);
		});
		return {
			schemaVersion: 2,
			authenticated: true,
			status: partial ? "partial" : "ok",
			activeVersionId: observedActiveVersionId,
			autoRefresh: autoRefresh,
			donationRefresh: donationRefresh,
			families: families,
		};
	} finally {
		scriptLock.releaseLock();
	}
}

// Get auto refresh settings.
function getAutoRefreshSettings(password) {
	assertAdminPassword_(password);
	const scriptLock = LockService.getScriptLock();
	scriptLock.waitLock(30000);
	try {
		return loadAutoRefreshSettingsForAdmin_();
	} finally {
		scriptLock.releaseLock();
	}
}

// Get read-only auto-refresh queue diagnostics.
function getAutoRefreshDiagnostics(password) {
	assertAdminPassword_(password);
	return buildAutoRefreshDiagnostics_();
}

// Read-only, authenticated authorization and production-trigger diagnostics.
// Deliberately omits AuthorizationInfo.getAuthorizationUrl(). Interactive
// consent must be completed from the Apps Script editor.
function getProductionTriggerAuthorizationDiagnostics(password) {
	assertAdminPassword_(password);
	return buildProductionTriggerAuthorizationDiagnostics_();
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

// Get detached donation refresh settings.
function getDonationRefreshSettings(password) {
	assertAdminPassword_(password);
	const scriptLock = LockService.getScriptLock();
	scriptLock.waitLock(30000);
	try {
		return loadDonationRefreshSettingsForAdmin_();
	} finally {
		scriptLock.releaseLock();
	}
}

// Set detached donation refresh enabled.
function setDonationRefreshEnabled(enabledRaw, password) {
	assertAdminPassword_(password);
	const enabled = toBooleanFlag_(enabledRaw);
	const scriptLock = LockService.getScriptLock();
	scriptLock.waitLock(30000);
	try {
		const props = PropertiesService.getScriptProperties();
		if (enabled) props.setProperty(DONATION_REFRESH_ENABLED_PROPERTY, "1");
		else props.deleteProperty(DONATION_REFRESH_ENABLED_PROPERTY);
		reconcileDonationRefreshTriggerState_();
		return readDonationRefreshSettings_();
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

// Version-guarded manual publish used by Admin Unlock V2.
function publishRosterDataV2(rosterData, password, expectedSourceVersionIdRaw, optionsRaw) {
	assertAdminPassword_(password);
	const expectedSourceVersionId = requireExactSafeActiveVersionId_(
		expectedSourceVersionIdRaw,
		"Expected source version id",
	);
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const includeRosterDataInResult = options.includeRosterDataInResult === true;
	return withActiveRosterJobLock_("manual-publish-v2", ACTIVE_ROSTER_JOB_LOCK_WAIT_MS, function () {
		const sourceSnapshot = readExactPublishedActiveRosterSnapshot_(expectedSourceVersionId);
		const stableSourceVersionId = String(readPublishedActiveVersionIdRaw_() || "").trim();
		if (stableSourceVersionId !== expectedSourceVersionId) throw buildAdminActiveVersionConflictError_();
		checkPublishCooldown_();
		const meta = writePublishedRosterData_(rosterData, {
			sourceSnapshot: sourceSnapshot,
			includeRosterDataInResult: includeRosterDataInResult,
		});
		let activeVersionId = String(meta.activeVersionId || "").trim();
		if (!activeVersionId) activeVersionId = String(readPublishedActiveVersionIdRaw_() || "").trim();
		markPublish_();
		const result = {
			ok: true,
			sourceVersionId: expectedSourceVersionId,
			activeVersionId: activeVersionId,
			publishedAt: meta.publishedAt,
			playerCount: meta.playerCount,
			noteCount: meta.noteCount,
			metricEntryCount: meta.metricEntryCount,
		};
		if (includeRosterDataInResult) result.rosterData = meta.rosterData;
		return result;
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
