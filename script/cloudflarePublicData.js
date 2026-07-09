// Cloudflare R2/KV public/bot data publisher. Firebase remains canonical
// storage; this module mirrors read-optimized JSON objects after successful
// writes.

const CLOUDFLARE_PUBLIC_DATA_BOOTSTRAP_PATH = "bootstrap/current";
const CLOUDFLARE_PUBLIC_DATA_HASH_PROPERTY_PREFIX = "CLOUDFLARE_PUBLIC_DATA_HASH_";

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


function getCloudflareLegacyRequestTimeoutSeconds_() {
	return typeof CLOUDFLARE_PUBLISH_QUEUE_REQUEST_TIMEOUT_SECONDS !== "undefined"
		? Math.max(1, Math.min(30, toNonNegativeInt_(CLOUDFLARE_PUBLISH_QUEUE_REQUEST_TIMEOUT_SECONDS) || 20))
		: 20;
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

function stableCloudflareJsonStringify_(valueRaw) {
	if (valueRaw === null || valueRaw === undefined) return "null";
	if (typeof valueRaw !== "object") return JSON.stringify(valueRaw);
	if (Array.isArray(valueRaw)) {
		const values = [];
		for (let i = 0; i < valueRaw.length; i++) {
			values.push(stableCloudflareJsonStringify_(valueRaw[i]));
		}
		return "[" + values.join(",") + "]";
	}
	const keys = Object.keys(valueRaw).sort();
	const parts = [];
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		const value = valueRaw[key];
		if (value === undefined) continue;
		parts.push(JSON.stringify(key) + ":" + stableCloudflareJsonStringify_(value));
	}
	return "{" + parts.join(",") + "}";
}

function hashCloudflareText_(textRaw) {
	const text = String(textRaw == null ? "" : textRaw);
	if (typeof Utilities !== "undefined" && Utilities && typeof Utilities.computeDigest === "function") {
		const algorithm = Utilities.DigestAlgorithm && Utilities.DigestAlgorithm.SHA_256 ? Utilities.DigestAlgorithm.SHA_256 : "SHA_256";
		const charset = Utilities.Charset && Utilities.Charset.UTF_8 ? Utilities.Charset.UTF_8 : "UTF-8";
		const bytes = Utilities.computeDigest(algorithm, text, charset);
		let out = "";
		for (let i = 0; i < bytes.length; i++) {
			const n = (Number(bytes[i]) + 256) % 256;
			out += (n < 16 ? "0" : "") + n.toString(16);
		}
		return out;
	}
	let hash = 2166136261;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
	}
	return ("00000000" + (hash >>> 0).toString(16)).slice(-8);
}

function buildCloudflareDataObjectHash_(scopeRaw, pathRaw, payloadRaw) {
	const scope = normalizeCloudflareDataScope_(scopeRaw);
	const path = normalizeCloudflareDataObjectPath_(pathRaw);
	return hashCloudflareText_(scope + "\n" + path + "\n" + stableCloudflareJsonStringify_(payloadRaw));
}

function buildCloudflareDataObjectDeleteHash_(scopeRaw, pathRaw) {
	const scope = normalizeCloudflareDataScope_(scopeRaw);
	const path = normalizeCloudflareDataObjectPath_(pathRaw);
	return hashCloudflareText_(scope + "\n" + path + "\n__DELETE__");
}

function getCloudflareDataObjectHashPropertyKey_(scopeRaw, pathRaw) {
	const scope = normalizeCloudflareDataScope_(scopeRaw);
	const path = normalizeCloudflareDataObjectPath_(pathRaw);
	return CLOUDFLARE_PUBLIC_DATA_HASH_PROPERTY_PREFIX + hashCloudflareText_(scope + "\n" + path);
}

function readCloudflareDataObjectPublishedHash_(scopeRaw, pathRaw) {
	try {
		return String(PropertiesService.getScriptProperties().getProperty(
			getCloudflareDataObjectHashPropertyKey_(scopeRaw, pathRaw),
		) || "").trim();
	} catch (err) {
		return "";
	}
}

function recordCloudflareDataObjectPublishedHashes_(itemsRaw) {
	const items = Array.isArray(itemsRaw) ? itemsRaw : [];
	if (!items.length) return;
	try {
		const props = {};
		for (let i = 0; i < items.length; i++) {
			const item = items[i] && typeof items[i] === "object" ? items[i] : null;
			if (!item || !item.hash) continue;
			props[getCloudflareDataObjectHashPropertyKey_(item.scope, item.path)] = String(item.hash || "");
		}
		const keys = Object.keys(props);
		if (keys.length) PropertiesService.getScriptProperties().setProperties(props, false);
	} catch (err) {
		// Hash telemetry is only an optimization; publish success is authoritative.
	}
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
	const force = options.force === true;
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
		const publishedHashItems = [];
		let skippedPutCount = 0;
		for (let i = 0; i < objectsIn.length; i++) {
			const item = objectsIn[i] && typeof objectsIn[i] === "object" ? objectsIn[i] : null;
			if (!item) continue;
			const object = makeCloudflareDataObject_(item.path, item.payload, item.scope || scope);
			const hash = buildCloudflareDataObjectHash_(object.scope, object.path, object.payload);
			if (!force && readCloudflareDataObjectPublishedHash_(object.scope, object.path) === hash) {
				skippedPutCount++;
				continue;
			}
			objects.push(object);
			publishedHashItems.push({
				scope: object.scope,
				path: object.path,
				hash: hash,
			});
		}
		const deletePaths = [];
		let skippedDeleteCount = 0;
		for (let i = 0; i < deletePathsIn.length; i++) {
			const item = deletePathsIn[i] && typeof deletePathsIn[i] === "object"
				? deletePathsIn[i]
				: { path: deletePathsIn[i] };
			const deleteItem = {
				path: normalizeCloudflareDataObjectPath_(item.path),
				scope: normalizeCloudflareDataScope_(item.scope || scope),
			};
			const hash = buildCloudflareDataObjectDeleteHash_(deleteItem.scope, deleteItem.path);
			if (!force && readCloudflareDataObjectPublishedHash_(deleteItem.scope, deleteItem.path) === hash) {
				skippedDeleteCount++;
				continue;
			}
			deletePaths.push(deleteItem);
			publishedHashItems.push({
				scope: deleteItem.scope,
				path: deleteItem.path,
				hash: hash,
			});
		}
		if (!objects.length && !deletePaths.length) {
			const unchanged = {
				ok: true,
				skipped: true,
				reason: "unchanged",
				scope: scope,
				putCount: 0,
				deleteCount: 0,
				skippedPutCount: skippedPutCount,
				skippedDeleteCount: skippedDeleteCount,
			};
			recordCloudflarePublicDataPublishResult_(unchanged, label);
			return unchanged;
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
			timeoutSeconds: getCloudflareLegacyRequestTimeoutSeconds_(),
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
			force: force,
			putCount: parsed.putCount || objects.length,
			deleteCount: parsed.deleteCount || deletePaths.length,
			skippedPutCount: skippedPutCount,
			skippedDeleteCount: skippedDeleteCount,
			publishedAt: parsed.publishedAt || "",
		};
		recordCloudflareDataObjectPublishedHashes_(publishedHashItems);
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

function createCloudflarePublicDataVersionId_(prefixRaw) {
	if (typeof createActiveVersionId_ === "function") {
		return createActiveVersionId_(prefixRaw);
	}
	const prefix = String(prefixRaw == null ? "cloudflare-publish" : prefixRaw)
		.trim()
		.replace(/[^A-Za-z0-9_.-]/g, "_")
		.slice(0, 40) || "cloudflare-publish";
	const timestamp = new Date().toISOString()
		.replace(/[-:]/g, "")
		.replace(/\./g, "_");
	const suffix = Math.random().toString(36).slice(2, 10) || String(Date.now()).slice(-8);
	return String(prefix + "-" + timestamp + "-" + suffix)
		.replace(/[^A-Za-z0-9_.-]/g, "_")
		.slice(0, 160);
}

function buildCloudflareActiveRosterPublishObjects_(versionWriteRaw) {
	const versionWrite = versionWriteRaw && typeof versionWriteRaw === "object" ? versionWriteRaw : {};
	const rosterData = validateRosterData_(versionWrite.rosterData);
	const versionId = normalizeActiveVersionId_(versionWrite.versionId) || createCloudflarePublicDataVersionId_("cloudflare-publish");
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
	const activePayload = Object.assign({}, rosterData, { activeVersionId: versionId });
	const encodedActive = encodeFirebaseObjectKeysRecursive_(activePayload);
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
	const publishOptions = versionWrite.options && typeof versionWrite.options === "object" ? versionWrite.options : {};
	if (publishOptions.includeBootstrap !== false) {
		publicObjects.push(buildCloudflarePublicBootstrapObject_({
			versionWrite: {
				versionId: versionId,
				manifest: manifest,
			},
		}));
	}
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
		const options = versionWriteRaw && typeof versionWriteRaw === "object" && versionWriteRaw.options && typeof versionWriteRaw.options === "object"
			? versionWriteRaw.options
			: {};
		const publicResult = publishCloudflareDataObjectsBestEffort_("public", objects.publicObjects, {
			label: String(labelRaw || "active-roster-public"),
			force: options.force === true,
		});
		const botResult = publishCloudflareDataObjectsBestEffort_("bot", objects.botObjects, {
			label: String(labelRaw || "active-roster-bot"),
			force: options.force === true,
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

function asCloudflarePlainObject_(valueRaw) {
	return valueRaw && typeof valueRaw === "object" && !Array.isArray(valueRaw) ? valueRaw : {};
}

function buildCloudflareEventPointerMap_(currentRaw, currentCwlRaw, latestCompletedCwlRaw) {
	const current = asCloudflarePlainObject_(currentRaw);
	const out = {};
	const keys = Object.keys(current);
	for (let i = 0; i < keys.length; i++) {
		const value = current[keys[i]];
		if (value && typeof value === "object" && !Array.isArray(value)) out[keys[i]] = value;
	}
	if (currentCwlRaw && typeof currentCwlRaw === "object" && !Array.isArray(currentCwlRaw)) out.cwl = currentCwlRaw;
	if (latestCompletedCwlRaw && typeof latestCompletedCwlRaw === "object" && !Array.isArray(latestCompletedCwlRaw)) {
		out.latestCompletedCwl = latestCompletedCwlRaw;
	}
	return out;
}

function addCloudflareCwlAggregatesForEvent_(outRaw, eventRaw) {
	const out = outRaw && typeof outRaw === "object" ? outRaw : {};
	const event = eventRaw && typeof eventRaw === "object" && !Array.isArray(eventRaw) ? eventRaw : null;
	const eventId = event ? sanitizeSeasonEventText_(event.eventId, 180) : "";
	if (!eventId || normalizeSeasonEventType_(event.type) !== "cwl") return out;
	const byKind = {};
	try {
		const live = readCwlSeasonEventAggregate_(eventId, "live");
		if (live && typeof live === "object" && !Array.isArray(live) && live.eventId) byKind.live = projectCloudflareCwlAggregateForEvent_(event, live, "live");
	} catch (err) {
		// Missing live aggregates are allowed for completed or not-yet-started CWL events.
	}
	try {
		const finalAggregate = readCwlSeasonEventAggregate_(eventId, "final");
		if (finalAggregate && typeof finalAggregate === "object" && !Array.isArray(finalAggregate) && finalAggregate.eventId) {
			byKind.final = projectCloudflareCwlAggregateForEvent_(event, finalAggregate, "final");
		}
	} catch (err) {
		// Missing final aggregates are allowed for active CWL events.
	}
	if (Object.keys(byKind).length) out[eventId] = byKind;
	return out;
}

function buildCloudflareSeasonEventsBundleFromPointers_(pointersRaw, seasonStateRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const current = asCloudflarePlainObject_(pointersRaw);
	const seasonState = asCloudflarePlainObject_(seasonStateRaw);
	const loadErrors = [];
	const byId = {};
	const cwlAggregatesByEventId = {};
	const eventIds = {};
	collectCloudflareSeasonEventIdsFromPointerMap_(current, eventIds);
	const eventIdList = Object.keys(eventIds);
	for (let i = 0; i < eventIdList.length; i++) {
		const eventId = eventIdList[i];
		try {
			const event = readSeasonEventById_(eventId);
			if (event && typeof event === "object" && !Array.isArray(event)) {
				byId[eventId] = event;
				addCloudflareCwlAggregatesForEvent_(cwlAggregatesByEventId, event);
			}
		} catch (err) {
			loadErrors.push({
				path: "/" + buildFirebaseChildPath_(SEASON_EVENTS_BY_ID_PATH, encodeFirebaseObjectKey_(eventId)),
				message: errorMessage_(err),
			});
		}
	}
	const latestCompletedCwl = current.latestCompletedCwl && typeof current.latestCompletedCwl === "object"
		? current.latestCompletedCwl
		: null;
	const publicCurrent = {};
	const currentKeys = Object.keys(current);
	for (let i = 0; i < currentKeys.length; i++) {
		const key = currentKeys[i];
		if (key === "latestCompletedCwl") continue;
		publicCurrent[key] = current[key];
	}
	return {
		current: publicCurrent,
		seasonState: seasonState,
		byId: byId,
		cwlAggregatesByEventId: cwlAggregatesByEventId,
		latestCompletedCwl: latestCompletedCwl,
		loadErrors: loadErrors,
		loadedAt: String(options.loadedAt || new Date().toISOString()),
	};
}

function buildCloudflareCurrentSeasonEventsBundle_() {
	const current = readDecodedCloudflareFirebaseObject_(SEASON_EVENTS_CURRENT_PATH);
	const currentCwl = readDecodedCloudflareFirebaseObject_(SEASON_EVENTS_CURRENT_CWL_PATH);
	const latestCompletedCwl = readDecodedCloudflareFirebaseObject_(SEASON_EVENTS_LATEST_COMPLETED_CWL_PATH);
	const seasonState = readDecodedCloudflareFirebaseObject_(SEASON_EVENTS_SEASON_STATE_CURRENT_PATH);
	return buildCloudflareSeasonEventsBundleFromPointers_(
		buildCloudflareEventPointerMap_(current, currentCwl, latestCompletedCwl),
		seasonState,
	);
}

function buildCloudflareSeasonEventsBundleForSeason_(seasonRaw) {
	const season = seasonRaw && typeof seasonRaw === "object" ? seasonRaw : {};
	const seasonId = String(season.seasonId == null ? "" : season.seasonId).trim();
	if (!seasonId) return null;
	const path = buildFirebaseChildPath_(SEASON_EVENTS_BY_SEASON_PATH, encodeFirebaseObjectKey_(seasonId));
	const pointers = readDecodedCloudflareFirebaseObject_(path);
	if (!pointers || typeof pointers !== "object" || Array.isArray(pointers)) return null;
	return buildCloudflareSeasonEventsBundleFromPointers_(pointers, {
		seasonId: seasonId,
		startsAt: String(season.startsAt || ""),
		endsAt: String(season.endsAt || ""),
	});
}

function resolveCloudflarePreviousSeasonFromBundle_(bundleRaw) {
	const bundle = bundleRaw && typeof bundleRaw === "object" ? bundleRaw : {};
	const seasonState = asCloudflarePlainObject_(bundle.seasonState);
	const current = asCloudflarePlainObject_(bundle.current);
	const push = asCloudflarePlainObject_(current.push);
	const donation = asCloudflarePlainObject_(current.donation);
	const startsAt = String(seasonState.startsAt || push.startsAt || donation.startsAt || "").trim();
	const startsMs = parseIsoToMs_(startsAt);
	if (startsMs > 0 && typeof resolveLegendIRankedSeasonCycle_ === "function") {
		return resolveLegendIRankedSeasonCycle_(startsMs - 1);
	}
	return null;
}

function attachCloudflarePreviousSeasonBundle_(bundleRaw) {
	const bundle = bundleRaw && typeof bundleRaw === "object" ? bundleRaw : {};
	try {
		const previousSeason = resolveCloudflarePreviousSeasonFromBundle_(bundle);
		const previous = previousSeason ? buildCloudflareSeasonEventsBundleForSeason_(previousSeason) : null;
		if (previous) bundle.previous = previous;
	} catch (err) {
		if (!Array.isArray(bundle.loadErrors)) bundle.loadErrors = [];
		bundle.loadErrors.push({
			path: "/" + SEASON_EVENTS_BY_SEASON_PATH,
			message: errorMessage_(err),
		});
	}
	return bundle;
}

function collectCloudflareDonationRefreshSeasonIdsFromBundle_(bundleRaw, seenRaw) {
	const bundle = bundleRaw && typeof bundleRaw === "object" ? bundleRaw : {};
	const seen = seenRaw && typeof seenRaw === "object" ? seenRaw : {};
	const ids = [];
	const collect = function (valueRaw) {
		const value = sanitizeDonationCycleKey_(valueRaw);
		if (!value || seen[value]) return;
		seen[value] = true;
		ids.push(value);
	};
	const current = asCloudflarePlainObject_(bundle.current);
	const donation = asCloudflarePlainObject_(current.donation);
	collect(donation.seasonId);
	const seasonState = asCloudflarePlainObject_(bundle.seasonState);
	collect(seasonState.seasonId);
	const byId = asCloudflarePlainObject_(bundle.byId);
	const eventIds = Object.keys(byId);
	for (let i = 0; i < eventIds.length; i++) {
		const event = asCloudflarePlainObject_(byId[eventIds[i]]);
		if (normalizeSeasonEventType_(event.type) === "donation") collect(event.seasonId);
	}
	if (bundle.previous && typeof bundle.previous === "object" && !Array.isArray(bundle.previous)) {
		const nested = collectCloudflareDonationRefreshSeasonIdsFromBundle_(bundle.previous, seen);
		for (let i = 0; i < nested.length; i++) ids.push(nested[i]);
	}
	return ids;
}

function buildCloudflareDonationRefreshBundleForSeasonEvents_(seasonEventsRaw) {
	const seasonIds = collectCloudflareDonationRefreshSeasonIdsFromBundle_(seasonEventsRaw, {});
	const bySeason = {};
	for (let i = 0; i < seasonIds.length; i++) {
		const overlay = readDonationRefreshOverlayBySeason_(seasonIds[i]);
		if (overlay && overlay.seasonId) bySeason[overlay.seasonId] = overlay;
	}
	return {
		current: readDecodedCloudflareFirebaseObject_(buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "current")),
		bySeason: bySeason,
	};
}

function readCloudflarePublishedActiveManifest_(versionIdRaw) {
	const versionId = normalizeActiveVersionId_(versionIdRaw);
	if (!versionId) return null;
	const currentManifest = readDecodedCloudflareFirebaseObject_(FIREBASE_ACTIVE_PUBLISHED_CURRENT_MANIFEST_PATH);
	const currentManifestVersionId = currentManifest && typeof currentManifest === "object" && !Array.isArray(currentManifest)
		? normalizeActiveVersionId_(currentManifest.versionId)
		: "";
	if (currentManifestVersionId && currentManifestVersionId === versionId) return currentManifest;
	const encoded = firebaseRequestJson_(buildActiveVersionPath_(versionId, "manifest"), "GET");
	return encoded && typeof encoded === "object" && !Array.isArray(encoded)
		? decodeFirebaseObjectKeysRecursive_(encoded)
		: null;
}

function buildCloudflarePublicBootstrapPayload_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const versionWrite = options.versionWrite && typeof options.versionWrite === "object" ? options.versionWrite : {};
	const activeVersionId = normalizeActiveVersionId_(options.activeVersionIdOverride) || normalizeActiveVersionId_(versionWrite.versionId) || readPublishedActiveVersionId_();
	const manifestOverride = options.manifestOverride && typeof options.manifestOverride === "object" && !Array.isArray(options.manifestOverride)
		? options.manifestOverride
		: null;
	const manifest = manifestOverride || (versionWrite.manifest && typeof versionWrite.manifest === "object" && !Array.isArray(versionWrite.manifest)
		? versionWrite.manifest
		: readCloudflarePublishedActiveManifest_(activeVersionId));
	const seasonEvents = attachCloudflarePreviousSeasonBundle_(buildCloudflareCurrentSeasonEventsBundle_());
	const donationRefresh = buildCloudflareDonationRefreshBundleForSeasonEvents_(seasonEvents);
	const generatedAt = String(options.generatedAt || new Date().toISOString());
	return {
		schemaVersion: 1,
		generatedAt: generatedAt,
		activeVersionId: activeVersionId,
		active: {
			versionId: activeVersionId,
			manifest: manifest && typeof manifest === "object" && !Array.isArray(manifest) ? manifest : null,
		},
		seasonEvents: seasonEvents,
		donationRefresh: donationRefresh,
	};
}

function buildCloudflarePublicBootstrapObject_(optionsRaw) {
	return {
		path: CLOUDFLARE_PUBLIC_DATA_BOOTSTRAP_PATH,
		payload: encodeFirebaseObjectKeysRecursive_(buildCloudflarePublicBootstrapPayload_(optionsRaw)),
	};
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

function projectCloudflareCwlAggregateForEvent_(eventRaw, aggregateRaw, kindRaw) {
	const event = eventRaw && typeof eventRaw === "object" && !Array.isArray(eventRaw) ? eventRaw : null;
	const aggregate = aggregateRaw && typeof aggregateRaw === "object" && !Array.isArray(aggregateRaw) ? aggregateRaw : null;
	if (!event || !aggregate || !aggregate.eventId) return aggregate;
	const projected = Object.assign({}, aggregate);
	projected.kind = String(kindRaw || projected.kind || "").trim() || projected.kind;
	try {
		if (typeof filterCwlAggregateToRegisteredParticipants_ === "function") {
			const filtered = filterCwlAggregateToRegisteredParticipants_(event, projected);
			if (filtered && Array.isArray(filtered.rankedTags)) projected.rankedTags = filtered.rankedTags;
		}
	} catch (err) {
		Logger.log("Cloudflare CWL aggregate ranked-tag projection skipped eventId=%s kind=%s error=%s", String(projected.eventId || ""), String(kindRaw || projected.kind || ""), errorMessage_(err));
	}
	return projected;
}

function publishCloudflareSeasonEventsAndDonationDataBestEffort_(labelRaw) {
	const label = String(labelRaw || "season-events").trim() || "season-events";
	try {
		const publicObjects = [
			buildCloudflarePublicBootstrapObject_(),
		];
		const seasonObjects = [];
		const deletePaths = [];
		const eventIds = {};
		const current = readDecodedCloudflareFirebaseObject_(SEASON_EVENTS_CURRENT_PATH);
		if (addCloudflarePublishObjectIfPresent_(seasonObjects, SEASON_EVENTS_CURRENT_PATH, current)) {
			collectCloudflareSeasonEventIdsFromPointerMap_(current, eventIds);
		}
		const currentCwl = readDecodedCloudflareFirebaseObject_(SEASON_EVENTS_CURRENT_CWL_PATH);
		if (currentCwl) {
			addCloudflarePublishObjectIfPresent_(seasonObjects, SEASON_EVENTS_CURRENT_CWL_PATH, currentCwl);
			collectCloudflareSeasonEventIdsFromPointerMap_({ cwl: currentCwl }, eventIds);
		} else {
			addCloudflareDeletePath_(deletePaths, SEASON_EVENTS_CURRENT_CWL_PATH);
		}
		const latestCompletedCwl = readDecodedCloudflareFirebaseObject_(SEASON_EVENTS_LATEST_COMPLETED_CWL_PATH);
		if (latestCompletedCwl) {
			addCloudflarePublishObjectIfPresent_(seasonObjects, SEASON_EVENTS_LATEST_COMPLETED_CWL_PATH, latestCompletedCwl);
			collectCloudflareSeasonEventIdsFromPointerMap_({ latestCompletedCwl: latestCompletedCwl }, eventIds);
		} else {
			addCloudflareDeletePath_(deletePaths, SEASON_EVENTS_LATEST_COMPLETED_CWL_PATH);
		}
		addCloudflarePublishObjectIfPresent_(
			seasonObjects,
			SEASON_EVENTS_SEASON_STATE_CURRENT_PATH,
			readDecodedCloudflareFirebaseObject_(SEASON_EVENTS_SEASON_STATE_CURRENT_PATH),
		);

		const bySeasonKeys = listFirebaseChildKeys_(SEASON_EVENTS_BY_SEASON_PATH);
		for (let i = 0; i < bySeasonKeys.length; i++) {
			const key = bySeasonKeys[i];
			const seasonPayload = readDecodedCloudflareFirebaseObject_(buildFirebaseChildPath_(SEASON_EVENTS_BY_SEASON_PATH, key));
			if (seasonPayload) {
				addCloudflarePublishObjectIfPresent_(seasonObjects, buildFirebaseChildPath_(SEASON_EVENTS_BY_SEASON_PATH, key), seasonPayload);
				collectCloudflareSeasonEventIdsFromPointerMap_(seasonPayload, eventIds);
			}
		}

		const eventIdList = Object.keys(eventIds);
		for (let i = 0; i < eventIdList.length; i++) {
			const eventId = eventIdList[i];
			const event = readSeasonEventById_(eventId);
			const encodedEventId = encodeFirebaseObjectKey_(eventId);
			if (event) {
				addCloudflarePublishObjectIfPresent_(seasonObjects, buildFirebaseChildPath_(SEASON_EVENTS_BY_ID_PATH, encodedEventId), event);
				if (normalizeSeasonEventType_(event.type) === "cwl") {
					const live = readCwlSeasonEventAggregate_(eventId, "live");
					const final = readCwlSeasonEventAggregate_(eventId, "final");
					if (live && live.eventId) {
						addCloudflarePublishObjectIfPresent_(seasonObjects, buildCwlSeasonEventAggregatePath_(eventId, "live"), projectCloudflareCwlAggregateForEvent_(event, live, "live"));
					} else {
						addCloudflareDeletePath_(deletePaths, buildCwlSeasonEventAggregatePath_(eventId, "live"));
					}
					if (final && final.eventId) {
						addCloudflarePublishObjectIfPresent_(seasonObjects, buildCwlSeasonEventAggregatePath_(eventId, "final"), projectCloudflareCwlAggregateForEvent_(event, final, "final"));
					} else {
						addCloudflareDeletePath_(deletePaths, buildCwlSeasonEventAggregatePath_(eventId, "final"));
					}
				}
			} else {
				addCloudflareDeletePath_(deletePaths, buildFirebaseChildPath_(SEASON_EVENTS_BY_ID_PATH, encodedEventId));
			}
		}

		const donationCurrent = readDecodedCloudflareFirebaseObject_(buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "current"));
		addCloudflarePublishObjectIfPresent_(seasonObjects, buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "current"), donationCurrent);
		const donationBySeasonPath = buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "bySeason");
		const donationSeasonKeys = listFirebaseChildKeys_(donationBySeasonPath);
		for (let i = 0; i < donationSeasonKeys.length; i++) {
			const key = donationSeasonKeys[i];
			const overlay = readDecodedCloudflareFirebaseObject_(buildFirebaseChildPath_(donationBySeasonPath, key));
			addCloudflarePublishObjectIfPresent_(seasonObjects, buildFirebaseChildPath_(donationBySeasonPath, key), overlay);
		}
		const mirroredSeasonBatch = buildCloudflareBotScopeMirroredPublishBatch_(seasonObjects, deletePaths);
		const publishResult = publishCloudflareDataObjectsBestEffort_("public", publicObjects.concat(mirroredSeasonBatch.objects), {
			label: label + ":season-data",
			deletePaths: mirroredSeasonBatch.deletePaths,
		});
		return {
			ok: publishResult.ok === true,
			publicResult: publishResult,
			botResult: publishResult,
			batchResult: publishResult,
		};
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
		const publicObjects = [
			buildCloudflarePublicBootstrapObject_(),
		];
		const donationObjects = [];
		const encodedSeasonId = encodeFirebaseObjectKey_(seasonId);
		const seasonPath = buildFirebaseChildPath_(
			buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "bySeason"),
			encodedSeasonId,
		);
		const overlay = readDecodedCloudflareFirebaseObject_(seasonPath);
		addCloudflarePublishObjectIfPresent_(donationObjects, seasonPath, overlay);
		addCloudflarePublishObjectIfPresent_(
			donationObjects,
			buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "current"),
			readDecodedCloudflareFirebaseObject_(buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "current")),
		);
		const mirroredDonationBatch = buildCloudflareBotScopeMirroredPublishBatch_(donationObjects, []);
		const publishResult = publishCloudflareDataObjectsBestEffort_("public", publicObjects.concat(mirroredDonationBatch.objects), {
			label: String(labelRaw || "donation-refresh") + ":season-data",
		});
		return {
			ok: publishResult.ok === true,
			seasonId: seasonId,
			publicResult: publishResult,
			botResult: publishResult,
			batchResult: publishResult,
		};
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
	const suppliedVersionWrite = options.versionWrite && typeof options.versionWrite === "object" ? options.versionWrite : null;
	let snapshot = null;
	if (!suppliedVersionWrite || !suppliedVersionWrite.rosterData) {
		const versionId = normalizeActiveVersionId_(options.versionId);
		snapshot = versionId && typeof readActiveRosterSnapshotFromVersion_ === "function"
			? readActiveRosterSnapshotFromVersion_(versionId)
			: readActiveRosterSnapshot_();
	}
	const suppliedRosterData = suppliedVersionWrite && suppliedVersionWrite.rosterData
		? validateRosterData_(suppliedVersionWrite.rosterData)
		: null;
	const versionWrite = {
		versionId:
			normalizeActiveVersionId_(suppliedVersionWrite && suppliedVersionWrite.versionId) ||
			normalizeActiveVersionId_(snapshot && snapshot.versionId) ||
			readPublishedActiveVersionId_() ||
			createCloudflarePublicDataVersionId_(label),
		manifest:
			suppliedVersionWrite && suppliedVersionWrite.manifest && typeof suppliedVersionWrite.manifest === "object"
				? suppliedVersionWrite.manifest
				: snapshot && snapshot.manifest && typeof snapshot.manifest === "object"
					? snapshot.manifest
					: null,
		rosterData: suppliedRosterData || (snapshot && snapshot.rosterData ? snapshot.rosterData : parseRosterDataText_(snapshot && snapshot.text, ACTIVE_ROSTER_FILENAME)),
		options: {
			force: options.force === true,
		},
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
		force: options.force === true,
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
	const endpoint = getCloudflarePublicDataReadEndpoint_("health");
	if (!endpoint) return { ok: false, skipped: true, reason: "missing-cloudflare-url" };
	try {
		const separator = endpoint.indexOf("?") >= 0 ? "&" : "?";
		const response = UrlFetchApp.fetch(
			endpoint
				+ separator
				+ "_verify=" + encodeURIComponent(new Date().toISOString())
				+ "&expectedVersionId=" + encodeURIComponent(expectedVersionId),
			{
				method: "get",
				headers: {
					"Cache-Control": "no-cache",
				},
				muteHttpExceptions: true,
				timeoutSeconds: getCloudflareLegacyRequestTimeoutSeconds_(),
			},
		);
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
		const health = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
		const actualVersionId = health
			? normalizeActiveVersionId_(health.currentVersionId)
			: normalizeActiveVersionId_(payload);
		if (actualVersionId !== expectedVersionId) {
			return {
				ok: false,
				statusCode: code,
				expectedVersionId: expectedVersionId,
				actualVersionId: actualVersionId,
				error: "Cloudflare active version pointer mismatch.",
			};
		}
		const shards = health && health.activeVersionShards && typeof health.activeVersionShards === "object"
			? health.activeVersionShards
			: null;
		if (shards && shards.complete === false) {
			return {
				ok: false,
				statusCode: code,
				expectedVersionId: expectedVersionId,
				actualVersionId: actualVersionId,
				activeVersionShards: shards,
				error: "Cloudflare active version shards missing.",
			};
		}
		return {
			ok: true,
			statusCode: code,
			expectedVersionId: expectedVersionId,
			actualVersionId: actualVersionId,
			activeVersionShards: shards || null,
		};
	} catch (err) {
		return { ok: false, error: errorMessage_(err) };
	}
}

function getCloudflarePublicDataResultError_(resultRaw, fallbackRaw) {
	const fallback = String(fallbackRaw || "Cloudflare public data operation failed.").trim() || "Cloudflare public data operation failed.";
	const result = resultRaw && typeof resultRaw === "object" ? resultRaw : null;
	if (!result) return fallback;
	const parts = [];
	const push = function (label, itemRaw) {
		const item = itemRaw && typeof itemRaw === "object" ? itemRaw : null;
		if (!item || item.ok === true) return;
		const reason = String(item.error || item.reason || "").trim();
		if (reason) parts.push(label ? label + ": " + reason : reason);
	};
	push("", result);
	push("active", result.active);
	if (result.active && typeof result.active === "object") {
		push("active public", result.active.publicResult);
		push("active bot", result.active.botResult);
	}
	push("cwlLeagueSignups", result.cwlLeagueSignups);
	push("seasonEvents", result.seasonEvents);
	if (result.seasonEvents && typeof result.seasonEvents === "object") {
		push("seasonEvents public", result.seasonEvents.publicResult);
		push("seasonEvents bot", result.seasonEvents.botResult);
	}
	if (result.publicResult || result.botResult) {
		push("public", result.publicResult);
		push("bot", result.botResult);
	}
	return (parts.join("; ") || fallback).slice(0, 1000);
}

function repairCloudflareActiveRosterMirrorIfStale_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const label = String(options.label || "active-mirror-repair").trim() || "active-mirror-repair";
	const startedAt = new Date().toISOString();
	try {
		const expectedVersionId = normalizeActiveVersionId_(options.expectedVersionId) || readPublishedActiveVersionId_();
		if (!expectedVersionId) {
			return { ok: true, skipped: true, reason: "missing-active-version", repaired: false, label: label, startedAt: startedAt };
		}
		const publicationMode = typeof getCloudflarePublicationMode_ === "function"
			? String(getCloudflarePublicationMode_() || "").trim().toLowerCase()
			: "legacy-manual";
		if (publicationMode === "queued-v2") {
			const active = enqueueCloudflareActiveTarget_(expectedVersionId, label);
			const relevant = enqueueCloudflareRelevantSeasonPublication_(label);
			const signups = enqueueCloudflareCwlLeagueSignupsPublication_(label);
			const ok = active && active.ok !== false && relevant && relevant.ok !== false && signups && signups.ok !== false;
			return {
				ok: !!ok,
				status: ok ? "queued" : "queueFailed",
				queued: true,
				repaired: false,
				label: label,
				expectedVersionId: expectedVersionId,
				active: active || null,
				relevantSeason: relevant || null,
				cwlLeagueSignups: signups || null,
				diagnostics: typeof getCloudflarePublishQueueDiagnostics_ === "function" ? getCloudflarePublishQueueDiagnostics_() : null,
				startedAt: startedAt,
				finishedAt: new Date().toISOString(),
			};
		}
		if (publicationMode === "disabled") {
			return {
				ok: true,
				skipped: true,
				repaired: false,
				status: "disabled",
				reason: "cloudflare-publication-disabled",
				label: label,
				expectedVersionId: expectedVersionId,
				startedAt: startedAt,
				finishedAt: new Date().toISOString(),
			};
		}
		const beforeVerify = verifyCloudflarePublicActiveVersionId_(expectedVersionId);
		if (beforeVerify && beforeVerify.ok === true) {
			return {
				ok: true,
				status: "inSync",
				repaired: false,
				label: label,
				expectedVersionId: expectedVersionId,
				verifyResult: beforeVerify,
				startedAt: startedAt,
				finishedAt: new Date().toISOString(),
			};
		}
		if (beforeVerify && beforeVerify.skipped === true) {
			return {
				ok: false,
				skipped: true,
				repaired: false,
				label: label,
				expectedVersionId: expectedVersionId,
				verifyResult: beforeVerify,
				reason: beforeVerify.reason || beforeVerify.error || "verification-skipped",
				startedAt: startedAt,
				finishedAt: new Date().toISOString(),
			};
		}
		const publishResult = publishCloudflarePublicDataSnapshot_({ label: label, force: true });
		if (!publishResult || publishResult.ok !== true) {
			return {
				ok: false,
				status: "publishFailed",
				repaired: false,
				label: label,
				expectedVersionId: expectedVersionId,
				verifyResult: beforeVerify || null,
				publishResult: publishResult || null,
				error: getCloudflarePublicDataResultError_(publishResult, "Cloudflare active mirror repair publish failed."),
				startedAt: startedAt,
				finishedAt: new Date().toISOString(),
			};
		}
		const afterVerify = verifyCloudflarePublicActiveVersionId_(expectedVersionId);
		if (!afterVerify || afterVerify.ok !== true) {
			const message = afterVerify && (afterVerify.error || afterVerify.reason)
				? String(afterVerify.error || afterVerify.reason)
				: "Cloudflare active version pointer did not verify after repair.";
			return {
				ok: false,
				status: "verifyFailed",
				repaired: true,
				label: label,
				expectedVersionId: expectedVersionId,
				verifyResult: beforeVerify || null,
				publishResult: publishResult,
				afterVerifyResult: afterVerify || null,
				error: message.slice(0, 1000),
				startedAt: startedAt,
				finishedAt: new Date().toISOString(),
			};
		}
		Logger.log(
			"Cloudflare active mirror repaired label=%s expectedVersionId=%s previousVersionId=%s",
			label,
			expectedVersionId,
			String((beforeVerify && beforeVerify.actualVersionId) || ""),
		);
		return {
			ok: true,
			status: "repaired",
			repaired: true,
			label: label,
			expectedVersionId: expectedVersionId,
			verifyResult: beforeVerify,
			publishResult: publishResult,
			afterVerifyResult: afterVerify,
			startedAt: startedAt,
			finishedAt: new Date().toISOString(),
		};
	} catch (err) {
		return {
			ok: false,
			status: "error",
			repaired: false,
			label: label,
			error: errorMessage_(err),
			startedAt: startedAt,
			finishedAt: new Date().toISOString(),
		};
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
	if (typeof getCloudflarePublicationMode_ === "function" && getCloudflarePublicationMode_() === CLOUDFLARE_PUBLICATION_MODE_QUEUED_V2) {
		return { ok: false, skipped: true, reason: "queued-v2-publisher-owns-mutable-pointers" };
	}
	return publishCloudflarePublicDataSnapshot_({
		label: String(payload.label || "api-snapshot").trim() || "api-snapshot",
	});
}

function repairCloudflareActiveRosterMirror(payloadRaw, secretOrPasswordRaw) {
	const payload = payloadRaw && typeof payloadRaw === "object" && !Array.isArray(payloadRaw) ? payloadRaw : {};
	assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw);
	return repairCloudflareActiveRosterMirrorIfStale_({
		label: String(payload.label || "api-active-mirror-repair").trim() || "api-active-mirror-repair",
		expectedVersionId: payload.expectedVersionId,
	});
}
