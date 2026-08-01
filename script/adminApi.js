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
		case "getAdminPublishStatusV2":
			return getAdminPublishStatusV2(args[0], args[1], args[2]);
		case "retryAdminPublishDeliveryV2":
			return retryAdminPublishDeliveryV2(args[0], args[1]);
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

function requireAdminPublishAttemptId_(attemptIdRaw) {
	const attemptId = String(attemptIdRaw == null ? "" : attemptIdRaw).trim();
	if (!/^[A-Za-z0-9][A-Za-z0-9_-]{15,79}$/.test(attemptId)) {
		throw createRosterBackendError_(
			"ADMIN_PUBLISH_ATTEMPT_INVALID",
			"Publish attempt id is missing or invalid. Reload the admin page before publishing.",
		);
	}
	return attemptId;
}

function buildAdminPublishTargetVersionId_(attemptIdRaw) {
	const attemptId = requireAdminPublishAttemptId_(attemptIdRaw);
	const versionId = "admin-publish-" + attemptId;
	if (!isSafeActiveVersionId_(versionId)) {
		throw createRosterBackendError_("ADMIN_PUBLISH_ATTEMPT_INVALID", "Publish attempt id cannot form a safe active version.");
	}
	return versionId;
}

function buildAdminPublishLockOwner_(attemptIdRaw, executionTokenRaw) {
	const attemptId = requireAdminPublishAttemptId_(attemptIdRaw);
	const executionToken = String(executionTokenRaw == null ? "" : executionTokenRaw)
		.trim()
		.replace(/[^A-Za-z0-9_-]/g, "")
		.slice(-12);
	return "manual-publish-v2-" + attemptId.slice(-18) + (executionToken ? ("-" + executionToken) : "");
}

function parseAdminPublishAttemptStore_(raw) {
	const text = String(raw == null ? "" : raw).trim();
	if (!text) return { schemaVersion: 2, attempts: [] };
	try {
		const parsed = JSON.parse(text);
		const attemptsRaw = parsed && Array.isArray(parsed.attempts) ? parsed.attempts : [];
		const attempts = [];
		const seen = {};
		for (let i = 0; i < attemptsRaw.length; i++) {
			const item = attemptsRaw[i] && typeof attemptsRaw[i] === "object" ? attemptsRaw[i] : null;
			const attemptId = item ? String(item.attemptId || "").trim() : "";
			if (!attemptId || seen[attemptId]) continue;
			seen[attemptId] = true;
			attempts.push(item);
		}
		return { schemaVersion: 2, attempts: attempts };
	} catch (err) {
		return { schemaVersion: 2, attempts: [] };
	}
}

function readAdminPublishAttemptStore_() {
	const raw = PropertiesService.getScriptProperties().getProperty(ADMIN_PUBLISH_ATTEMPTS_PROPERTY);
	return parseAdminPublishAttemptStore_(raw);
}

function readAdminPublishAttemptReceipt_(attemptIdRaw) {
	const attemptId = requireAdminPublishAttemptId_(attemptIdRaw);
	const store = readAdminPublishAttemptStore_();
	for (let i = 0; i < store.attempts.length; i++) {
		const item = store.attempts[i] && typeof store.attempts[i] === "object" ? store.attempts[i] : null;
		if (item && String(item.attemptId || "").trim() === attemptId) return item;
	}
	return null;
}

function mutateAdminPublishAttemptStore_(callback) {
	if (typeof callback !== "function") throw new Error("Publish-attempt mutation callback is required.");
	const lock = LockService.getScriptLock();
	let didLock = false;
	try {
		didLock = typeof lock.tryLock === "function" ? lock.tryLock(5000) : (lock.waitLock(5000), true);
	} catch (err) {
		didLock = false;
	}
	if (!didLock) {
		throw createRosterBackendError_("ADMIN_PUBLISH_STATUS_BUSY", "Publish status is briefly busy. Please try again.");
	}
	try {
		const props = PropertiesService.getScriptProperties();
		const store = parseAdminPublishAttemptStore_(props.getProperty(ADMIN_PUBLISH_ATTEMPTS_PROPERTY));
		const result = callback(store);
		const cutoffMs = Date.now() - ADMIN_PUBLISH_ATTEMPT_RETENTION_MS;
		store.attempts = store.attempts
			.filter(function (item) {
				const updatedMs = new Date(String(item && item.updatedAt || "")).getTime();
				return !isFinite(updatedMs) || updatedMs >= cutoffMs;
			})
			.sort(function (left, right) {
				return (new Date(String(right && right.updatedAt || "")).getTime() || 0) -
					(new Date(String(left && left.updatedAt || "")).getTime() || 0);
			})
			.slice(0, ADMIN_PUBLISH_ATTEMPT_HISTORY_LIMIT);
		props.setProperty(ADMIN_PUBLISH_ATTEMPTS_PROPERTY, JSON.stringify({
			schemaVersion: 2,
			attempts: store.attempts,
		}));
		return result;
	} finally {
		lock.releaseLock();
	}
}

function upsertAdminPublishAttemptReceipt_(attemptRaw, patchRaw) {
	const attempt = attemptRaw && typeof attemptRaw === "object" ? attemptRaw : {};
	const patch = patchRaw && typeof patchRaw === "object" ? patchRaw : {};
	const attemptId = requireAdminPublishAttemptId_(attempt.attemptId);
	return mutateAdminPublishAttemptStore_(function (store) {
		let existing = null;
		for (let i = 0; i < store.attempts.length; i++) {
			if (String(store.attempts[i] && store.attempts[i].attemptId || "").trim() === attemptId) {
				existing = store.attempts[i];
				break;
			}
		}
		if (existing) {
			const expectedSourceVersionId = String(attempt.expectedSourceVersionId || "").trim();
			const targetVersionId = String(attempt.targetVersionId || "").trim();
			const payloadFingerprint = String(attempt.payloadFingerprint || "").trim();
			if (
				(expectedSourceVersionId && String(existing.expectedSourceVersionId || "").trim() !== expectedSourceVersionId) ||
				(targetVersionId && String(existing.targetVersionId || "").trim() !== targetVersionId) ||
				(payloadFingerprint && String(existing.payloadFingerprint || "").trim() && String(existing.payloadFingerprint || "").trim() !== payloadFingerprint)
			) {
				throw createRosterBackendError_(
					"ADMIN_PUBLISH_ATTEMPT_MISMATCH",
					"This publish attempt was already used for a different roster snapshot. Reload the admin page before publishing.",
				);
			}
			if (payloadFingerprint && !String(existing.payloadFingerprint || "").trim()) {
				existing.payloadFingerprint = payloadFingerprint;
			}
		} else {
			existing = {
				attemptId: attemptId,
				expectedSourceVersionId: String(attempt.expectedSourceVersionId || "").trim(),
				targetVersionId: String(attempt.targetVersionId || "").trim(),
				payloadFingerprint: String(attempt.payloadFingerprint || "").trim(),
				createdAt: new Date().toISOString(),
			};
			store.attempts.push(existing);
		}
		const patchKeys = Object.keys(patch);
		for (let i = 0; i < patchKeys.length; i++) {
			const key = patchKeys[i];
			existing[key] = patch[key];
		}
		existing.updatedAt = new Date().toISOString();
		return existing;
	});
}

function describeAdminActiveRosterActivity_(ownerRaw) {
	const owner = String(ownerRaw == null ? "" : ownerRaw).trim().toLowerCase();
	if (!owner) return "another roster update";
	if (owner.indexOf("auto-refresh") >= 0) return "the scheduled roster refresh";
	if (owner.indexOf("manual-refresh-all") >= 0 || owner === "refresh-all") return "Refresh all";
	if (owner.indexOf("manual-publish") >= 0) return "another roster publish";
	if (owner.indexOf("regular-war") >= 0) return "the regular-war finalizer";
	if (owner.indexOf("discord") >= 0) return "a Discord roster update";
	if (owner.indexOf("cwl-league-signup") >= 0) return "a CWL signup update";
	return "another roster update";
}

function buildAdminPublishPayloadFingerprint_(validatedRosterData) {
	const normalized = normalizeActiveRosterForCompareValidated_(validatedRosterData);
	if (typeof Utilities !== "undefined" && Utilities && typeof Utilities.computeDigest === "function") {
		const algorithm = Utilities.DigestAlgorithm && Utilities.DigestAlgorithm.SHA_256
			? Utilities.DigestAlgorithm.SHA_256
			: "SHA_256";
		const charset = Utilities.Charset && Utilities.Charset.UTF_8 ? Utilities.Charset.UTF_8 : "UTF-8";
		return bytesToHex_(Utilities.computeDigest(algorithm, normalized, charset));
	}
	let hash = 2166136261;
	for (let i = 0; i < normalized.length; i++) {
		hash ^= normalized.charCodeAt(i);
		hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
	}
	return ("00000000" + (hash >>> 0).toString(16)).slice(-8);
}

function buildAdminPublishAttemptBase_(rosterData, expectedSourceVersionIdRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const attemptId = requireAdminPublishAttemptId_(options.publishAttemptId);
	const expectedSourceVersionId = requireExactSafeActiveVersionId_(
		expectedSourceVersionIdRaw,
		"Expected source version id",
	);
	const validated = validateRosterData_(rosterData);
	return {
		attemptId: attemptId,
		expectedSourceVersionId: expectedSourceVersionId,
		targetVersionId: buildAdminPublishTargetVersionId_(attemptId),
		payloadFingerprint: buildAdminPublishPayloadFingerprint_(validated),
	};
}

function buildAdminPublishCommittedResult_(attemptRaw, receiptRaw, manifestRaw) {
	const attempt = attemptRaw && typeof attemptRaw === "object" ? attemptRaw : {};
	const receipt = receiptRaw && typeof receiptRaw === "object" ? receiptRaw : {};
	const manifest = manifestRaw && typeof manifestRaw === "object" ? manifestRaw : {};
	const rosterPlayerTags = Array.isArray(manifest.rosterPlayerTags) ? manifest.rosterPlayerTags : [];
	return {
		schemaVersion: 2,
		ok: true,
		status: "committed",
		publishAttemptId: String(attempt.attemptId || ""),
		sourceVersionId: String(attempt.expectedSourceVersionId || ""),
		activeVersionId: String(attempt.targetVersionId || ""),
		publishedAt: String(receipt.publishedAt || manifest.publishedAt || ""),
		playerCount: Number.isFinite(Number(receipt.playerCount)) ? Math.max(0, Math.floor(Number(receipt.playerCount))) : rosterPlayerTags.length,
		noteCount: Number.isFinite(Number(receipt.noteCount)) ? Math.max(0, Math.floor(Number(receipt.noteCount))) : null,
		metricEntryCount: Number.isFinite(Number(receipt.metricEntryCount))
			? Math.max(0, Math.floor(Number(receipt.metricEntryCount)))
			: Math.max(0, Math.floor(Number(manifest.playerMetricEntryCount) || 0)),
	};
}

function readAdminPublishCurrentManifest_(versionIdRaw) {
	const versionId = String(versionIdRaw == null ? "" : versionIdRaw).trim();
	const path = versionId
		? buildActiveVersionPath_(requireExactSafeActiveVersionId_(versionId, "Published version id"), "manifest")
		: FIREBASE_ACTIVE_PUBLISHED_CURRENT_MANIFEST_PATH;
	const encoded = firebaseRequestJson_(path, "GET");
	if (!encoded || typeof encoded !== "object" || Array.isArray(encoded)) return {};
	return decodeFirebaseObjectKeysRecursive_(encoded);
}

function getAdminPublishStatusV2(password, publishAttemptIdRaw, expectedSourceVersionIdRaw) {
	assertAdminPassword_(password);
	const attemptId = requireAdminPublishAttemptId_(publishAttemptIdRaw);
	const attempt = {
		attemptId: attemptId,
		expectedSourceVersionId: requireExactSafeActiveVersionId_(expectedSourceVersionIdRaw, "Expected source version id"),
		targetVersionId: buildAdminPublishTargetVersionId_(attemptId),
	};
	const activeVersionId = String(readPublishedActiveVersionIdRaw_() || "").trim();
	let receipt = readAdminPublishAttemptReceipt_(attemptId);
	const props = PropertiesService.getScriptProperties();
	const donationLock = parseDonationRefreshLockState_(props.getProperty(DONATION_REFRESH_LOCK_KEY));
	const donationRefreshActive = !!(donationLock && donationLock.expiresAt > Date.now());
	const base = {
		schemaVersion: 2,
		authenticated: true,
		publishAttemptId: attemptId,
		expectedSourceVersionId: attempt.expectedSourceVersionId,
		targetVersionId: attempt.targetVersionId,
		activeVersionId: activeVersionId,
		donationRefreshActive: donationRefreshActive,
	};
	if (activeVersionId === attempt.targetVersionId) {
		const manifest = readAdminPublishCurrentManifest_(attempt.targetVersionId);
		if (!receipt || String(receipt.status || "") !== "committed") {
			receipt = upsertAdminPublishAttemptReceipt_(attempt, {
				status: "committed",
				publishedAt: String(manifest.publishedAt || ""),
				lastError: "",
			});
		}
		return Object.assign(base, buildAdminPublishCommittedResult_(attempt, receipt, manifest), {
			canRetry: false,
			retryAfterMs: 0,
		});
	}
	if (activeVersionId !== attempt.expectedSourceVersionId) {
		return Object.assign(base, {
			status: "conflict",
			canRetry: false,
			retryAfterMs: 0,
			message: "Active roster data changed before this publish could commit.",
		});
	}

	const activeLock = readActiveRosterJobLockState_();
	if (activeLock && activeLock.expiresAt > Date.now()) {
		const ownLockOwner = String(receipt && receipt.lockOwner || "").trim();
		const ownAttempt = String(activeLock.owner || "") === ownLockOwner;
		const runningStartedMs = new Date(String(receipt && receipt.runningStartedAt || "")).getTime();
		if (
			ownAttempt &&
			isFinite(runningStartedMs) &&
			Date.now() - runningStartedMs >= ADMIN_PUBLISH_ATTEMPT_STALE_MS
		) {
			const ownerMap = {};
			ownerMap[ownLockOwner] = true;
			const cleared = clearActiveRosterJobLockForOwners_(ownerMap, "stale admin publish recovery");
			if (cleared && cleared.cleared === true) {
				upsertAdminPublishAttemptReceipt_(attempt, {
					status: "retryable",
					lastError: "The previous publish execution ended before committing and its stale lock was recovered.",
				});
				return Object.assign(base, {
					status: "retryable",
					canRetry: true,
					retryAfterMs: 0,
					message: "The previous publish execution ended before committing and can now be retried safely.",
				});
			}
		}
		return Object.assign(base, {
			status: ownAttempt ? "running" : "waiting",
			canRetry: false,
			retryAfterMs: ownAttempt ? 1500 : 2500,
			activity: ownAttempt ? "this roster publish" : describeAdminActiveRosterActivity_(activeLock.owner),
			message: ownAttempt
				? "The roster snapshot is still being saved."
				: ("Waiting for " + describeAdminActiveRosterActivity_(activeLock.owner) + " to finish."),
		});
	}

	const receiptUpdatedMs = new Date(String(receipt && receipt.updatedAt || "")).getTime();
	const receiptStatus = String(receipt && receipt.status || "").trim().toLowerCase();
	if (
		(receiptStatus === "accepted" || receiptStatus === "running") &&
		isFinite(receiptUpdatedMs) &&
		Date.now() - receiptUpdatedMs < ADMIN_PUBLISH_ATTEMPT_RUNNING_GRACE_MS
	) {
		return Object.assign(base, {
			status: "running",
			canRetry: false,
			retryAfterMs: 1000,
			activity: "this roster publish",
			message: "The publish request is starting.",
		});
	}
	return Object.assign(base, {
		status: "retryable",
		canRetry: true,
		retryAfterMs: 0,
		message: String(receipt && receipt.lastError || "").trim() || "The roster snapshot has not committed yet and can be retried safely.",
	});
}

// Version-guarded manual publish used by Admin Unlock V2.
function publishRosterDataV2(rosterData, password, expectedSourceVersionIdRaw, optionsRaw) {
	assertAdminPassword_(password);
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	// Preserve the original V2 response contract for already-open/cached admin
	// clients during rollout. New clients always send an idempotent attempt id.
	if (!String(options.publishAttemptId || "").trim()) {
		const expectedSourceVersionId = requireExactSafeActiveVersionId_(
			expectedSourceVersionIdRaw,
			"Expected source version id",
		);
		const includeRosterDataInResult = options.includeRosterDataInResult === true;
		return withActiveRosterJobLock_("manual-publish-v2-legacy-client", ACTIVE_ROSTER_JOB_LOCK_WAIT_MS, function () {
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
			const legacyResult = {
				ok: true,
				sourceVersionId: expectedSourceVersionId,
				activeVersionId: activeVersionId,
				publishedAt: meta.publishedAt,
				playerCount: meta.playerCount,
				noteCount: meta.noteCount,
				metricEntryCount: meta.metricEntryCount,
			};
			if (includeRosterDataInResult) legacyResult.rosterData = meta.rosterData;
			return legacyResult;
		});
	}
	const attempt = buildAdminPublishAttemptBase_(rosterData, expectedSourceVersionIdRaw, options);
	const publishLockOwner = buildAdminPublishLockOwner_(attempt.attemptId, Utilities.getUuid());
	let receipt = upsertAdminPublishAttemptReceipt_(attempt, {
		status: "accepted",
		lastError: "",
	});
	const currentBeforeLock = String(readPublishedActiveVersionIdRaw_() || "").trim();
	if (currentBeforeLock === attempt.targetVersionId) {
		const manifest = readAdminPublishCurrentManifest_(attempt.targetVersionId);
		receipt = upsertAdminPublishAttemptReceipt_(attempt, {
			status: "committed",
			publishedAt: String(manifest.publishedAt || ""),
			lastError: "",
		});
		return buildAdminPublishCommittedResult_(attempt, receipt, manifest);
	}

	try {
		return withActiveRosterJobLock_(publishLockOwner, 0, function () {
			const currentVersionId = String(readPublishedActiveVersionIdRaw_() || "").trim();
			if (currentVersionId === attempt.targetVersionId) {
				const manifest = readAdminPublishCurrentManifest_(attempt.targetVersionId);
				receipt = upsertAdminPublishAttemptReceipt_(attempt, {
					status: "committed",
					publishedAt: String(manifest.publishedAt || ""),
					lastError: "",
				});
				return buildAdminPublishCommittedResult_(attempt, receipt, manifest);
			}
			if (currentVersionId !== attempt.expectedSourceVersionId) throw buildAdminActiveVersionConflictError_();

			receipt = upsertAdminPublishAttemptReceipt_(attempt, {
				status: "running",
				lockOwner: publishLockOwner,
				runningStartedAt: new Date().toISOString(),
				lastError: "",
			});
			const sourceSnapshot = readExactPublishedActiveRosterSnapshot_(attempt.expectedSourceVersionId);
			const stableSourceVersionId = String(readPublishedActiveVersionIdRaw_() || "").trim();
			if (stableSourceVersionId !== attempt.expectedSourceVersionId) throw buildAdminActiveVersionConflictError_();
			checkPublishCooldown_();
			const meta = writePublishedRosterData_(rosterData, {
				sourceSnapshot: sourceSnapshot,
				includeRosterDataInResult: false,
				activeVersionIdOverride: attempt.targetVersionId,
				activeVersionSource: "admin-publish-v2",
			});
			const activeVersionId = String(meta.activeVersionId || "").trim();
			if (activeVersionId !== attempt.targetVersionId) {
				throw new Error("Published active version did not match its idempotent target.");
			}
			markPublish_();
			receipt = upsertAdminPublishAttemptReceipt_(attempt, {
				status: "committed",
				publishedAt: String(meta.publishedAt || ""),
				playerCount: Math.max(0, Math.floor(Number(meta.playerCount) || 0)),
				noteCount: Math.max(0, Math.floor(Number(meta.noteCount) || 0)),
				metricEntryCount: Math.max(0, Math.floor(Number(meta.metricEntryCount) || 0)),
				lastError: "",
			});
			return buildAdminPublishCommittedResult_(attempt, receipt, {});
		});
	} catch (err) {
		let currentAfterError = "";
		try { currentAfterError = String(readPublishedActiveVersionIdRaw_() || "").trim(); } catch (readErr) {}
		if (currentAfterError === attempt.targetVersionId) {
			let manifest = {};
			try { manifest = readAdminPublishCurrentManifest_(attempt.targetVersionId); } catch (manifestErr) {}
			receipt = upsertAdminPublishAttemptReceipt_(attempt, {
				status: "committed",
				publishedAt: String(manifest.publishedAt || receipt.publishedAt || ""),
				lastError: "",
			});
			return buildAdminPublishCommittedResult_(attempt, receipt, manifest);
		}
		if (isActiveRosterJobLockBusyError_(err)) {
			const activeLock = readActiveRosterJobLockState_();
			const activity = describeAdminActiveRosterActivity_(activeLock && activeLock.owner);
			upsertAdminPublishAttemptReceipt_(attempt, {
				status: "waiting",
				lastError: "Waiting for " + activity + " to finish.",
			});
			throw createRosterBackendError_(
				"ADMIN_PUBLISH_BUSY",
				"Publish is waiting for " + activity + " to finish. The roster snapshot can be retried safely.",
			);
		}
		const conflict = String(err && err.code || "") === "ADMIN_ACTIVE_VERSION_CONFLICT";
		upsertAdminPublishAttemptReceipt_(attempt, {
			status: conflict ? "conflict" : "retryable",
			lastError: errorMessage_(err).slice(0, 400),
		});
		throw err;
	}
}

function retryAdminPublishDeliveryV2(password, publishAttemptIdRaw) {
	assertAdminPassword_(password);
	const attemptId = requireAdminPublishAttemptId_(publishAttemptIdRaw);
	const targetVersionId = buildAdminPublishTargetVersionId_(attemptId);
	try {
		return withActiveRosterJobLock_("admin-publish-delivery-retry-" + attemptId.slice(-16), 0, function () {
			const activeVersionId = String(readPublishedActiveVersionIdRaw_() || "").trim();
			if (activeVersionId !== targetVersionId) throw buildAdminActiveVersionConflictError_();
			const queueResult = enqueueCloudflareActiveTarget_(targetVersionId, "admin-publish-delivery-retry");
			return {
				schemaVersion: 2,
				ok: queueResult && queueResult.ok !== false,
				status: "queued",
				activeVersionId: targetVersionId,
				queued: !!(queueResult && queueResult.queued),
				scheduled: !!(queueResult && queueResult.scheduled),
				nextAttemptAt: String(queueResult && queueResult.nextAttemptAt || ""),
			};
		});
	} catch (err) {
		if (isActiveRosterJobLockBusyError_(err)) {
			throw createRosterBackendError_(
				"ADMIN_PUBLISH_BUSY",
				"Public delivery retry is waiting for the current roster update to finish.",
			);
		}
		throw err;
	}
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
