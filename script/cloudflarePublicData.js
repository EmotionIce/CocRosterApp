// Cloudflare R2 public/bot data publisher. Firebase remains canonical storage;
// this module mirrors read-optimized JSON objects after successful writes.

function getOptionalScriptProperty_(keyRaw) {
	const key = String(keyRaw == null ? "" : keyRaw).trim();
	if (!key) return "";
	try {
		return String(PropertiesService.getScriptProperties().getProperty(key) || "").trim();
	} catch (err) {
		return "";
	}
}

function normalizeCloudflareHttpBaseUrl_(valueRaw) {
	const value = String(valueRaw == null ? "" : valueRaw).trim();
	if (!value || !/^https?:\/\//i.test(value)) return "";
	return value.replace(/[\/\\]+$/, "");
}

function isCloudflarePublicDataEnabled_() {
	const raw = getOptionalScriptProperty_(CLOUDFLARE_PUBLIC_DATA_ENABLED_PROPERTY).toLowerCase();
	if (!raw) return true;
	return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function getCloudflarePublicDataBaseUrl_() {
	return normalizeCloudflareHttpBaseUrl_(
		getOptionalScriptProperty_(CLOUDFLARE_PUBLIC_DATA_BASE_URL_PROPERTY) || STATIC_ASSET_BASE_URL,
	);
}

function getCloudflarePublicDataPublishEndpoint_() {
	const baseUrl = getCloudflarePublicDataBaseUrl_();
	if (!baseUrl) return "";
	if (/\/api\/internal\/public-data\/publish$/i.test(baseUrl)) return baseUrl;
	if (/\/api\/(?:public-data|bot-data)$/i.test(baseUrl)) {
		return baseUrl.replace(/\/api\/(?:public-data|bot-data)$/i, "/api/internal/public-data/publish");
	}
	return baseUrl + "/api/internal/public-data/publish";
}

function getCloudflarePublicDataReadEndpoint_(pathRaw) {
	const baseUrl = getCloudflarePublicDataBaseUrl_();
	if (!baseUrl) return "";
	const path = normalizeCloudflareDataObjectPath_(pathRaw);
	let readBase = baseUrl;
	if (/\/api\/internal\/public-data\/publish$/i.test(readBase)) {
		readBase = readBase.replace(/\/api\/internal\/public-data\/publish$/i, "/api/public-data");
	} else if (/\/api\/bot-data$/i.test(readBase)) {
		readBase = readBase.replace(/\/api\/bot-data$/i, "/api/public-data");
	} else if (!/\/api\/public-data$/i.test(readBase)) {
		readBase += "/api/public-data";
	}
	return readBase + "/" + path;
}

function getCloudflarePublicDataPublishSecret_() {
	return (
		getOptionalScriptProperty_(CLOUDFLARE_PUBLIC_DATA_PUBLISH_SECRET_PROPERTY) ||
		getOptionalScriptProperty_("DISCORD_BOT_API_SECRET")
	);
}

function normalizeCloudflareDataScope_(scopeRaw) {
	const scope = String(scopeRaw == null ? "" : scopeRaw).trim().toLowerCase();
	if (scope === "bot" || scope === "bot-data") return "bot";
	return "public";
}

function normalizeCloudflareDataObjectPath_(pathRaw) {
	let path = String(pathRaw == null ? "" : pathRaw)
		.trim()
		.replace(/\\/g, "/")
		.replace(/^[\/]+|[\/]+$/g, "");
	if (!path) throw new Error("Cloudflare data object path is required.");
	path = path.replace(/\.json$/i, "");
	const parts = path.split("/").filter((part) => part);
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (!part || part === "." || part === ".." || part.indexOf("..") >= 0) {
			throw new Error("Invalid Cloudflare data object path.");
		}
	}
	return parts.join("/");
}

function makeCloudflareDataObject_(pathRaw, payloadRaw, scopeRaw) {
	return {
		path: normalizeCloudflareDataObjectPath_(pathRaw),
		scope: normalizeCloudflareDataScope_(scopeRaw),
		payload: payloadRaw,
	};
}

function recordCloudflarePublicDataPublishResult_(resultRaw, labelRaw) {
	try {
		const result = resultRaw && typeof resultRaw === "object" ? resultRaw : {};
		const label = String(labelRaw == null ? "" : labelRaw).trim();
		const status = result.ok === true ? "ok" : result.skipped === true ? "skipped" : "error";
		const errorText = String(result.error || result.reason || "").slice(0, 2000);
		const props = PropertiesService.getScriptProperties();
		props.setProperties({
			[CLOUDFLARE_PUBLIC_DATA_LAST_PUBLISH_AT_PROPERTY]: new Date().toISOString(),
			[CLOUDFLARE_PUBLIC_DATA_LAST_PUBLISH_STATUS_PROPERTY]: label ? label + ":" + status : status,
			[CLOUDFLARE_PUBLIC_DATA_LAST_PUBLISH_ERROR_PROPERTY]: errorText,
		}, false);
	} catch (err) {
		// Recording publish telemetry must never affect roster writes.
	}
}

function publishCloudflareDataObjectsBestEffort_(scopeRaw, objectsRaw, optionsRaw) {
	const scope = normalizeCloudflareDataScope_(scopeRaw);
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const label = String(options.label || scope).trim() || scope;
	const objectsIn = Array.isArray(objectsRaw) ? objectsRaw : [];
	const deletePathsIn = Array.isArray(options.deletePaths) ? options.deletePaths : [];
	if (!objectsIn.length && !deletePathsIn.length) {
		const skipped = { ok: true, skipped: true, reason: "empty" };
		recordCloudflarePublicDataPublishResult_(skipped, label);
		return skipped;
	}
	if (!isCloudflarePublicDataEnabled_()) {
		const disabled = { ok: false, skipped: true, reason: "disabled" };
		recordCloudflarePublicDataPublishResult_(disabled, label);
		return disabled;
	}
	if (typeof UrlFetchApp === "undefined" || !UrlFetchApp || typeof UrlFetchApp.fetch !== "function") {
		const unavailable = { ok: false, skipped: true, reason: "urlfetch-unavailable" };
		recordCloudflarePublicDataPublishResult_(unavailable, label);
		return unavailable;
	}
	const endpoint = getCloudflarePublicDataPublishEndpoint_();
	const secret = getCloudflarePublicDataPublishSecret_();
	if (!endpoint) {
		const missingUrl = { ok: false, skipped: true, reason: "missing-cloudflare-url" };
		recordCloudflarePublicDataPublishResult_(missingUrl, label);
		return missingUrl;
	}
	if (!secret) {
		const missingSecret = { ok: false, skipped: true, reason: "missing-publish-secret" };
		recordCloudflarePublicDataPublishResult_(missingSecret, label);
		return missingSecret;
	}

	try {
		const objects = [];
		for (let i = 0; i < objectsIn.length; i++) {
			const item = objectsIn[i] && typeof objectsIn[i] === "object" ? objectsIn[i] : null;
			if (!item) continue;
			objects.push(makeCloudflareDataObject_(item.path, item.payload, item.scope || scope));
		}
		const deletePaths = [];
		for (let i = 0; i < deletePathsIn.length; i++) {
			const item = deletePathsIn[i] && typeof deletePathsIn[i] === "object"
				? deletePathsIn[i]
				: { path: deletePathsIn[i] };
			deletePaths.push({
				path: normalizeCloudflareDataObjectPath_(item.path),
				scope: normalizeCloudflareDataScope_(item.scope || scope),
			});
		}
		const response = UrlFetchApp.fetch(endpoint, {
			method: "post",
			contentType: "application/json",
			headers: {
				Authorization: "Bearer " + secret,
			},
			payload: JSON.stringify({
				scope: scope,
				publishedAt: new Date().toISOString(),
				objects: objects,
				deletePaths: deletePaths,
			}),
			muteHttpExceptions: true,
		});
		const code = typeof response.getResponseCode === "function" ? response.getResponseCode() : 0;
		const text = typeof response.getContentText === "function" ? response.getContentText() : "";
		let parsed = null;
		try {
			parsed = text ? JSON.parse(text) : null;
		} catch (parseErr) {
			parsed = null;
		}
		if (code < 200 || code >= 300 || !parsed || parsed.ok !== true) {
			const message = parsed && parsed.error ? parsed.error : "Cloudflare publish failed with HTTP " + code + ".";
			throw new Error(message);
		}
		const ok = {
			ok: true,
			scope: scope,
			putCount: parsed.putCount || objects.length,
			deleteCount: parsed.deleteCount || deletePaths.length,
			publishedAt: parsed.publishedAt || "",
		};
		recordCloudflarePublicDataPublishResult_(ok, label);
		return ok;
	} catch (err) {
		const failed = {
			ok: false,
			error: errorMessage_(err),
		};
		Logger.log("Cloudflare data publish failed for %s: %s", label, failed.error);
		recordCloudflarePublicDataPublishResult_(failed, label);
		return failed;
	}
}

function buildCloudflareRosterMapById_(rostersRaw) {
	const rosters = Array.isArray(rostersRaw) ? rostersRaw : [];
	const out = {};
	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : null;
		const rosterId = roster ? String(roster.id || "").trim() : "";
		if (!rosterId) continue;
		out[rosterId] = roster;
	}
	return out;
}

function metricToCloudflareLinkedAccount_(metricRaw, fallbackTagRaw, matchTypeRaw) {
	const metric = metricRaw && typeof metricRaw === "object" ? metricRaw : {};
	const identity = metric.identity && typeof metric.identity === "object" ? metric.identity : {};
	const latest = metric.latestSnapshot && typeof metric.latestSnapshot === "object" ? metric.latestSnapshot : {};
	const tag = normalizeTag_(identity.tag || latest.tag || fallbackTagRaw);
	if (!tag) return null;
	const league = latest.league && typeof latest.league === "object" ? latest.league : {};
	const leagueTier = latest.leagueTier && typeof latest.leagueTier === "object" ? latest.leagueTier : {};
	return {
		tag: tag,
		playerTag: tag,
		name: String(identity.name || latest.name || tag).trim(),
		townHall: toNonNegativeInt_(latest.townHallLevel != null ? latest.townHallLevel : latest.th),
		townHallLevel: toNonNegativeInt_(latest.townHallLevel != null ? latest.townHallLevel : latest.th),
		trophies: toNonNegativeInt_(latest.trophies),
		leagueName: String(league.name || leagueTier.name || "").trim(),
		discordId: String(identity.discordId || "").trim(),
		discordUsername: String(identity.discordUsername || "").trim(),
		matchType: String(matchTypeRaw || "").trim(),
	};
}

function buildCloudflareLinkedAccountIndexes_(rosterDataRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const metrics = rosterData.playerMetrics && typeof rosterData.playerMetrics === "object" ? rosterData.playerMetrics : {};
	const byTag = metrics.byTag && typeof metrics.byTag === "object" ? metrics.byTag : {};
	const byDiscordId = {};
	const byDiscordUsername = {};
	const keys = Object.keys(byTag);
	for (let i = 0; i < keys.length; i++) {
		const tag = normalizeTag_(keys[i]);
		const metric = byTag[keys[i]] && typeof byTag[keys[i]] === "object" ? byTag[keys[i]] : null;
		if (!tag || !metric) continue;
		const idAccount = metricToCloudflareLinkedAccount_(metric, tag, "discordId");
		if (idAccount && idAccount.discordId) {
			if (!byDiscordId[idAccount.discordId]) byDiscordId[idAccount.discordId] = [];
			byDiscordId[idAccount.discordId].push(idAccount);
			continue;
		}
		const usernameAccount = metricToCloudflareLinkedAccount_(metric, tag, "discordUsername");
		if (usernameAccount && usernameAccount.discordUsername) {
			if (!byDiscordUsername[usernameAccount.discordUsername]) byDiscordUsername[usernameAccount.discordUsername] = [];
			byDiscordUsername[usernameAccount.discordUsername].push(usernameAccount);
		}
	}
	const sortAccounts = function (accounts) {
		accounts.sort(function (left, right) {
			const leftName = String(left.name || left.tag || "");
			const rightName = String(right.name || right.tag || "");
			return leftName.localeCompare(rightName) || String(left.tag || "").localeCompare(String(right.tag || ""));
		});
	};
	Object.keys(byDiscordId).forEach(function (discordId) {
		sortAccounts(byDiscordId[discordId]);
	});
	Object.keys(byDiscordUsername).forEach(function (username) {
		sortAccounts(byDiscordUsername[username]);
	});
	return {
		byDiscordId: byDiscordId,
		byDiscordUsername: byDiscordUsername,
	};
}

function buildCloudflareActiveRosterPublishObjects_(versionWriteRaw) {
	const versionWrite = versionWriteRaw && typeof versionWriteRaw === "object" ? versionWriteRaw : {};
	const rosterData = validateRosterData_(versionWrite.rosterData);
	const versionId = normalizeActiveVersionId_(versionWrite.versionId || "legacy-active");
	if (!versionId) throw new Error("Active version id is required for Cloudflare publish.");
	const manifest = versionWrite.manifest && typeof versionWrite.manifest === "object"
		? versionWrite.manifest
		: buildActiveVersionManifestFromValidatedData_(versionId, rosterData, {
				source: "cloudflare-public-data",
				publish: true,
			});
	const playerMetrics = sanitizePlayerMetricsStore_(
		rosterData.playerMetrics,
		rosterData.lastUpdatedAt || new Date().toISOString(),
	);
	const rosterMap = buildCloudflareRosterMapById_(rosterData.rosters);
	const encodedActive = encodeFirebaseObjectKeysRecursive_(rosterData);
	const encodedManifest = encodeFirebaseObjectKeysRecursive_(manifest);
	const encodedRosters = encodeFirebaseObjectKeysRecursive_(rosterMap);
	const encodedPlayerMetrics = encodeFirebaseObjectKeysRecursive_(playerMetrics);
	const encodedVersionId = encodeFirebaseObjectKey_(versionId);
	const publicObjects = [
		{ path: "activeVersions/" + encodedVersionId + "/manifest", payload: encodedManifest },
		{ path: "activeVersions/" + encodedVersionId + "/rosters", payload: encodedRosters },
		{ path: "activeVersions/" + encodedVersionId + "/playerMetrics", payload: encodedPlayerMetrics },
		{ path: "active", payload: encodedActive },
		{ path: "activePublished/currentManifest", payload: encodedManifest },
		{ path: "activePublished/currentVersionId", payload: versionId },
	];
	const linkedIndexes = buildCloudflareLinkedAccountIndexes_(rosterData);
	const botObjects = [
		{ path: "active", payload: encodedActive },
		{ path: "active/playerMetrics/byTag", payload: encodeFirebaseObjectKeysRecursive_(playerMetrics.byTag || {}) },
		{ path: "indexes/linkedAccountsByDiscordId", payload: encodeFirebaseObjectKeysRecursive_(linkedIndexes.byDiscordId) },
		{ path: "indexes/linkedAccountsByDiscordUsername", payload: encodeFirebaseObjectKeysRecursive_(linkedIndexes.byDiscordUsername) },
	];
	return {
		versionId: versionId,
		publicObjects: publicObjects,
		botObjects: botObjects,
	};
}

function publishCloudflareActiveRosterDataBestEffort_(versionWriteRaw, labelRaw) {
	try {
		const objects = buildCloudflareActiveRosterPublishObjects_(versionWriteRaw);
		const publicResult = publishCloudflareDataObjectsBestEffort_("public", objects.publicObjects, {
			label: String(labelRaw || "active-roster-public"),
		});
		const botResult = publishCloudflareDataObjectsBestEffort_("bot", objects.botObjects, {
			label: String(labelRaw || "active-roster-bot"),
		});
		return {
			ok: publicResult.ok === true && botResult.ok === true,
			versionId: objects.versionId,
			publicResult: publicResult,
			botResult: botResult,
		};
	} catch (err) {
		const failed = { ok: false, error: errorMessage_(err) };
		recordCloudflarePublicDataPublishResult_(failed, String(labelRaw || "active-roster"));
		Logger.log("Cloudflare active roster publish failed: %s", failed.error);
		return failed;
	}
}

function publishCloudflareCwlLeagueSignupsBestEffort_(payloadRaw, labelRaw) {
	try {
		const payload = sanitizeCwlLeagueSignupsPayload_(payloadRaw);
		return publishCloudflareDataObjectsBestEffort_("bot", [
			{ path: "active/cwlLeagueSignups", payload: encodeFirebaseObjectKeysRecursive_(payload) },
		], {
			label: String(labelRaw || "cwl-league-signups"),
		});
	} catch (err) {
		const failed = { ok: false, error: errorMessage_(err) };
		recordCloudflarePublicDataPublishResult_(failed, String(labelRaw || "cwl-league-signups"));
		Logger.log("Cloudflare CWL league signup publish failed: %s", failed.error);
		return failed;
	}
}

function readDecodedCloudflareFirebaseObject_(pathRaw) {
	const encoded = firebaseRequestJson_(pathRaw, "GET");
	if (encoded == null) return null;
	return decodeFirebaseObjectKeysRecursive_(encoded);
}

function addCloudflarePublishObjectIfPresent_(objects, pathRaw, payloadRaw) {
	if (payloadRaw == null) return false;
	objects.push({
		path: normalizeCloudflareDataObjectPath_(pathRaw),
		payload: encodeFirebaseObjectKeysRecursive_(payloadRaw),
	});
	return true;
}

function addCloudflareDeletePath_(deletePaths, pathRaw) {
	deletePaths.push(normalizeCloudflareDataObjectPath_(pathRaw));
}

function buildCloudflareBotScopeMirroredPublishBatch_(objectsRaw, deletePathsRaw) {
	const objectsIn = Array.isArray(objectsRaw) ? objectsRaw : [];
	const deletePathsIn = Array.isArray(deletePathsRaw) ? deletePathsRaw : [];
	const objects = objectsIn.slice();
	const deletePaths = deletePathsIn.slice();
	for (let i = 0; i < objectsIn.length; i++) {
		const item = objectsIn[i] && typeof objectsIn[i] === "object" ? objectsIn[i] : null;
		if (!item || normalizeCloudflareDataScope_(item.scope || "public") === "bot") continue;
		objects.push({
			path: item.path,
			payload: item.payload,
			scope: "bot",
		});
	}
	for (let i = 0; i < deletePathsIn.length; i++) {
		const item = deletePathsIn[i] && typeof deletePathsIn[i] === "object"
			? deletePathsIn[i]
			: { path: deletePathsIn[i] };
		if (!item.path || normalizeCloudflareDataScope_(item.scope || "public") === "bot") continue;
		deletePaths.push({
			path: item.path,
			scope: "bot",
		});
	}
	return {
		objects: objects,
		deletePaths: deletePaths,
	};
}

function collectCloudflareSeasonEventIdsFromPointerMap_(pointerMapRaw, setRaw) {
	const pointerMap = pointerMapRaw && typeof pointerMapRaw === "object" && !Array.isArray(pointerMapRaw) ? pointerMapRaw : {};
	const set = setRaw && typeof setRaw === "object" ? setRaw : {};
	const keys = Object.keys(pointerMap);
	for (let i = 0; i < keys.length; i++) {
		const pointer = pointerMap[keys[i]] && typeof pointerMap[keys[i]] === "object" ? pointerMap[keys[i]] : null;
		const eventId = pointer ? sanitizeSeasonEventText_(pointer.eventId, 180) : "";
		if (eventId) set[eventId] = true;
	}
	return set;
}

function publishCloudflareSeasonEventsAndDonationDataBestEffort_(labelRaw) {
	const label = String(labelRaw || "season-events").trim() || "season-events";
	try {
		const objects = [];
		const deletePaths = [];
		const eventIds = {};
		const current = readDecodedCloudflareFirebaseObject_(SEASON_EVENTS_CURRENT_PATH);
		if (addCloudflarePublishObjectIfPresent_(objects, SEASON_EVENTS_CURRENT_PATH, current)) {
			collectCloudflareSeasonEventIdsFromPointerMap_(current, eventIds);
		}
		const currentCwl = readDecodedCloudflareFirebaseObject_(SEASON_EVENTS_CURRENT_CWL_PATH);
		if (currentCwl) {
			addCloudflarePublishObjectIfPresent_(objects, SEASON_EVENTS_CURRENT_CWL_PATH, currentCwl);
			collectCloudflareSeasonEventIdsFromPointerMap_({ cwl: currentCwl }, eventIds);
		} else {
			addCloudflareDeletePath_(deletePaths, SEASON_EVENTS_CURRENT_CWL_PATH);
		}
		const latestCompletedCwl = readDecodedCloudflareFirebaseObject_(SEASON_EVENTS_LATEST_COMPLETED_CWL_PATH);
		if (latestCompletedCwl) {
			addCloudflarePublishObjectIfPresent_(objects, SEASON_EVENTS_LATEST_COMPLETED_CWL_PATH, latestCompletedCwl);
			collectCloudflareSeasonEventIdsFromPointerMap_({ latestCompletedCwl: latestCompletedCwl }, eventIds);
		} else {
			addCloudflareDeletePath_(deletePaths, SEASON_EVENTS_LATEST_COMPLETED_CWL_PATH);
		}
		addCloudflarePublishObjectIfPresent_(
			objects,
			SEASON_EVENTS_SEASON_STATE_CURRENT_PATH,
			readDecodedCloudflareFirebaseObject_(SEASON_EVENTS_SEASON_STATE_CURRENT_PATH),
		);

		const bySeasonKeys = listFirebaseChildKeys_(SEASON_EVENTS_BY_SEASON_PATH);
		for (let i = 0; i < bySeasonKeys.length; i++) {
			const key = bySeasonKeys[i];
			const seasonPayload = readDecodedCloudflareFirebaseObject_(buildFirebaseChildPath_(SEASON_EVENTS_BY_SEASON_PATH, key));
			if (seasonPayload) {
				addCloudflarePublishObjectIfPresent_(objects, buildFirebaseChildPath_(SEASON_EVENTS_BY_SEASON_PATH, key), seasonPayload);
				collectCloudflareSeasonEventIdsFromPointerMap_(seasonPayload, eventIds);
			}
		}

		const eventIdList = Object.keys(eventIds);
		for (let i = 0; i < eventIdList.length; i++) {
			const eventId = eventIdList[i];
			const event = readSeasonEventById_(eventId);
			const encodedEventId = encodeFirebaseObjectKey_(eventId);
			if (event) {
				addCloudflarePublishObjectIfPresent_(objects, buildFirebaseChildPath_(SEASON_EVENTS_BY_ID_PATH, encodedEventId), event);
				if (normalizeSeasonEventType_(event.type) === "cwl") {
					const live = readCwlSeasonEventAggregate_(eventId, "live");
					const final = readCwlSeasonEventAggregate_(eventId, "final");
					if (live && live.eventId) {
						addCloudflarePublishObjectIfPresent_(objects, buildCwlSeasonEventAggregatePath_(eventId, "live"), live);
					} else {
						addCloudflareDeletePath_(deletePaths, buildCwlSeasonEventAggregatePath_(eventId, "live"));
					}
					if (final && final.eventId) {
						addCloudflarePublishObjectIfPresent_(objects, buildCwlSeasonEventAggregatePath_(eventId, "final"), final);
					} else {
						addCloudflareDeletePath_(deletePaths, buildCwlSeasonEventAggregatePath_(eventId, "final"));
					}
				}
			} else {
				addCloudflareDeletePath_(deletePaths, buildFirebaseChildPath_(SEASON_EVENTS_BY_ID_PATH, encodedEventId));
			}
		}

		const donationCurrent = readDecodedCloudflareFirebaseObject_(buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "current"));
		addCloudflarePublishObjectIfPresent_(objects, buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "current"), donationCurrent);
		const donationBySeasonPath = buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "bySeason");
		const donationSeasonKeys = listFirebaseChildKeys_(donationBySeasonPath);
		for (let i = 0; i < donationSeasonKeys.length; i++) {
			const key = donationSeasonKeys[i];
			const overlay = readDecodedCloudflareFirebaseObject_(buildFirebaseChildPath_(donationBySeasonPath, key));
			addCloudflarePublishObjectIfPresent_(objects, buildFirebaseChildPath_(donationBySeasonPath, key), overlay);
		}
		const mirrored = buildCloudflareBotScopeMirroredPublishBatch_(objects, deletePaths);
		return publishCloudflareDataObjectsBestEffort_("public", mirrored.objects, {
			label: label,
			deletePaths: mirrored.deletePaths,
		});
	} catch (err) {
		const failed = { ok: false, error: errorMessage_(err) };
		recordCloudflarePublicDataPublishResult_(failed, label);
		Logger.log("Cloudflare season/donation publish failed: %s", failed.error);
		return failed;
	}
}

function publishCloudflareDonationRefreshSeasonBestEffort_(seasonIdRaw, labelRaw) {
	const seasonId = sanitizeDonationCycleKey_(seasonIdRaw);
	if (!seasonId) return { ok: false, skipped: true, reason: "missing-season-id" };
	try {
		const objects = [];
		const encodedSeasonId = encodeFirebaseObjectKey_(seasonId);
		const seasonPath = buildFirebaseChildPath_(
			buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "bySeason"),
			encodedSeasonId,
		);
		const overlay = readDecodedCloudflareFirebaseObject_(seasonPath);
		addCloudflarePublishObjectIfPresent_(objects, seasonPath, overlay);
		addCloudflarePublishObjectIfPresent_(
			objects,
			buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "current"),
			readDecodedCloudflareFirebaseObject_(buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "current")),
		);
		const mirrored = buildCloudflareBotScopeMirroredPublishBatch_(objects, []);
		return publishCloudflareDataObjectsBestEffort_("public", mirrored.objects, {
			label: String(labelRaw || "donation-refresh"),
			deletePaths: mirrored.deletePaths,
		});
	} catch (err) {
		const failed = { ok: false, error: errorMessage_(err) };
		recordCloudflarePublicDataPublishResult_(failed, String(labelRaw || "donation-refresh"));
		Logger.log("Cloudflare donation refresh publish failed: %s", failed.error);
		return failed;
	}
}

function publishCloudflarePublicDataSnapshot_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const label = String(options.label || "manual-snapshot").trim() || "manual-snapshot";
	const snapshot = readActiveRosterSnapshot_();
	const versionWrite = {
		versionId: normalizeActiveVersionId_(snapshot && snapshot.versionId) || readPublishedActiveVersionId_() || "legacy-active",
		manifest: snapshot && snapshot.manifest && typeof snapshot.manifest === "object" ? snapshot.manifest : null,
		rosterData: snapshot && snapshot.rosterData ? snapshot.rosterData : parseRosterDataText_(snapshot && snapshot.text, ACTIVE_ROSTER_FILENAME),
	};
	const active = publishCloudflareActiveRosterDataBestEffort_(versionWrite, label + ":active");
	let signups = { ok: true, skipped: true, reason: "unavailable" };
	if (typeof readActiveCwlLeagueSignups_ === "function") {
		signups = publishCloudflareCwlLeagueSignupsBestEffort_(readActiveCwlLeagueSignups_(), label + ":cwl-signups");
	}
	let seasonEvents = { ok: true, skipped: true, reason: "unavailable" };
	if (typeof publishCloudflareSeasonEventsAndDonationDataBestEffort_ === "function") {
		seasonEvents = publishCloudflareSeasonEventsAndDonationDataBestEffort_(label + ":season-events");
	}
	return {
		ok: active.ok === true && signups.ok === true && seasonEvents.ok === true,
		active: active,
		cwlLeagueSignups: signups,
		seasonEvents: seasonEvents,
	};
}

function verifyCloudflarePublicActiveVersionId_(expectedVersionIdRaw) {
	const expectedVersionId = normalizeActiveVersionId_(expectedVersionIdRaw);
	if (!expectedVersionId) return { ok: false, error: "Missing expected active version id." };
	if (!isCloudflarePublicDataEnabled_()) return { ok: false, skipped: true, reason: "disabled" };
	if (typeof UrlFetchApp === "undefined" || !UrlFetchApp || typeof UrlFetchApp.fetch !== "function") {
		return { ok: false, skipped: true, reason: "urlfetch-unavailable" };
	}
	const endpoint = getCloudflarePublicDataReadEndpoint_("activePublished/currentVersionId");
	if (!endpoint) return { ok: false, skipped: true, reason: "missing-cloudflare-url" };
	try {
		const separator = endpoint.indexOf("?") >= 0 ? "&" : "?";
		const response = UrlFetchApp.fetch(endpoint + separator + "_verify=" + encodeURIComponent(new Date().toISOString()), {
			method: "get",
			headers: {
				"Cache-Control": "no-cache",
			},
			muteHttpExceptions: true,
		});
		const code = typeof response.getResponseCode === "function" ? response.getResponseCode() : 0;
		const text = typeof response.getContentText === "function" ? response.getContentText() : "";
		if (code < 200 || code >= 300) {
			return { ok: false, statusCode: code, error: "Cloudflare active version verification failed with HTTP " + code + "." };
		}
		let parsed = null;
		try {
			parsed = text ? JSON.parse(text) : null;
		} catch (parseErr) {
			return { ok: false, statusCode: code, error: "Cloudflare active version verification returned invalid JSON." };
		}
		const payload = parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, "data")
			? parsed.data
			: parsed;
		const actualVersionId = normalizeActiveVersionId_(payload);
		if (actualVersionId !== expectedVersionId) {
			return {
				ok: false,
				statusCode: code,
				expectedVersionId: expectedVersionId,
				actualVersionId: actualVersionId,
				error: "Cloudflare active version pointer mismatch.",
			};
		}
		return {
			ok: true,
			statusCode: code,
			expectedVersionId: expectedVersionId,
			actualVersionId: actualVersionId,
		};
	} catch (err) {
		return { ok: false, error: errorMessage_(err) };
	}
}

function assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw) {
	try {
		assertDiscordBotApiSecret_(secretOrPasswordRaw);
		return "discord-bot";
	} catch (botErr) {
		assertAdminPassword_(secretOrPasswordRaw);
		return "admin";
	}
}

function publishCloudflarePublicDataSnapshot(payloadRaw, secretOrPasswordRaw) {
	const payload = payloadRaw && typeof payloadRaw === "object" && !Array.isArray(payloadRaw) ? payloadRaw : {};
	assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw);
	return publishCloudflarePublicDataSnapshot_({
		label: String(payload.label || "api-snapshot").trim() || "api-snapshot",
	});
}
