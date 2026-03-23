// Clash API transport and related tag/war fetch helpers.

// Normalize tag.
function normalizeTag_(tagRaw) {
	const t = String(tagRaw == null ? "" : tagRaw)
		.trim()
		.toUpperCase();
	if (!t) return "";
	return t.startsWith("#") ? t : "#" + t;
}

// Get roster tracking mode.
function getRosterTrackingMode_(rosterRaw) {
	const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
	return roster.trackingMode === "regularWar" ? "regularWar" : "cwl";
}

// Return whether valid player tag.
function isValidPlayerTag_(tagRaw) {
	const tag = normalizeTag_(tagRaw);
	return /^#[PYLQGRJCUV0289]{3,15}$/.test(tag);
}

// Return whether valid clan tag.
function isValidClanTag_(tagRaw) {
	return isValidPlayerTag_(tagRaw);
}

// Encode tag for path.
function encodeTagForPath_(tagRaw) {
	const normalized = normalizeTag_(tagRaw);
	if (!normalized) return "";
	return encodeURIComponent(normalized);
}

// Return whether published roster tag.
function isPublishedRosterTag_(tagRaw) {
	const wantedTag = normalizeTag_(tagRaw);
	if (!wantedTag) return false;

	const rosterData = getRosterData();
	const rosters = rosterData && Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		const players = []
			.concat(Array.isArray(roster.main) ? roster.main : [])
			.concat(Array.isArray(roster.subs) ? roster.subs : [])
			.concat(Array.isArray(roster.missing) ? roster.missing : []);
		for (let j = 0; j < players.length; j++) {
			if (normalizeTag_(players[j] && players[j].tag) === wantedTag) {
				return true;
			}
		}
	}
	return false;
}

// Normalize player profile error.
function normalizePlayerProfileError_(playerTag, err) {
	const tag = normalizeTag_(playerTag);
	if (err && err.statusCode === 404) {
		return new Error("Player not found for tag " + tag + ".");
	}
	if (err && err.statusCode === 429) {
		const retryAfter = err && err.retryAfter ? " Retry-After: " + err.retryAfter + "." : "";
		return new Error("Clash API rate limit reached. Please try again in a moment." + retryAfter);
	}
	if (err && err.statusCode >= 500) {
		return new Error("Clash API is temporarily unavailable. Please try again in a moment.");
	}
	if (err && (err.statusCode === 401 || err.statusCode === 403)) {
		return new Error("Clash API auth failed. Check COC_API_TOKEN and proxy access.");
	}
	if (err instanceof Error) return err;
	return new Error("Player profile request failed for " + tag + ".");
}

// Handle read town hall level.
function readTownHallLevel_(obj) {
	const raw = obj && obj.townHallLevel != null ? obj.townHallLevel : obj && obj.townhallLevel != null ? obj.townhallLevel : null;
	const n = Number(raw);
	if (!isFinite(n)) return null;
	return Math.max(0, Math.floor(n));
}

// Get CoC API token.
function getCocApiToken_() {
	const token = String(PropertiesService.getScriptProperties().getProperty("COC_API_TOKEN") || "").trim();
	if (!token) {
		throw new Error("Missing Script Property COC_API_TOKEN.");
	}
	return token;
}

// Build CoC fetch request config.
function buildCocFetchRequestConfig_(pathRaw, tokenRaw) {
	const token = String(tokenRaw == null ? "" : tokenRaw).trim();
	if (!token) throw new Error("Missing Clash API token.");
	const cleanPath = String(pathRaw || "").startsWith("/") ? String(pathRaw || "") : "/" + String(pathRaw || "");
	const url = COC_PROXY_BASE_URL + cleanPath;
	const params = {
		method: "get",
		muteHttpExceptions: true,
		headers: {
			Authorization: "Bearer " + token,
			Accept: "application/json",
		},
	};
	return {
		url: url,
		params: params,
		fetchAllRequest: Object.assign({ url: url }, params),
	};
}

// Parse CoC retry after ms.
function parseCocRetryAfterMs_(retryAfterRaw) {
	const retryAfter = String(retryAfterRaw == null ? "" : retryAfterRaw).trim();
	if (!retryAfter) return 0;
	const deltaSeconds = Number(retryAfter);
	if (isFinite(deltaSeconds) && deltaSeconds >= 0) {
		return Math.max(0, Math.floor(deltaSeconds * 1000));
	}
	const retryAtMs = new Date(retryAfter).getTime();
	if (!isFinite(retryAtMs)) return 0;
	return Math.max(0, Math.floor(retryAtMs - Date.now()));
}

// Return whether CoC transient status code.
function isCocTransientStatusCode_(statusCodeRaw) {
	const statusCode = Number(statusCodeRaw);
	if (!isFinite(statusCode)) return false;
	return statusCode === 0 || statusCode === 429 || statusCode === 500 || statusCode === 502 || statusCode === 503 || statusCode === 504;
}

// Return whether retry CoC fetch error.
function shouldRetryCocFetchError_(errRaw) {
	const err = errRaw && typeof errRaw === "object" ? errRaw : null;
	if (!err) return false;
	const statusCode = Number(err.statusCode);
	if (isFinite(statusCode)) return isCocTransientStatusCode_(statusCode);
	// Transport/no-response failures can throw plain Error values without statusCode.
	return true;
}

// Compute CoC retry delay ms.
function computeCocRetryDelayMs_(errRaw, attemptIndexRaw) {
	const err = errRaw && typeof errRaw === "object" ? errRaw : null;
	const retryAfterMs = parseCocRetryAfterMs_(err && err.retryAfter);
	if (retryAfterMs > 0) {
		return Math.max(COC_FETCH_RETRY_MIN_DELAY_MS, Math.min(COC_FETCH_RETRY_MAX_DELAY_MS, retryAfterMs));
	}
	const attemptIndex = Math.max(1, toNonNegativeInt_(attemptIndexRaw) || 1);
	const exponentialBackoffMs = COC_FETCH_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, attemptIndex - 1));
	return Math.max(COC_FETCH_RETRY_MIN_DELAY_MS, Math.min(COC_FETCH_RETRY_MAX_DELAY_MS, Math.floor(exponentialBackoffMs)));
}

// Handle CoC fetch with retry.
function cocFetchWithRetry_(requestConfigRaw, labelRaw, optionsRaw) {
	const requestConfig = requestConfigRaw && typeof requestConfigRaw === "object" ? requestConfigRaw : null;
	if (!requestConfig || !requestConfig.url || !requestConfig.params) {
		throw new Error("Clash API request config is required.");
	}
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const maxAttempts = Math.max(1, toNonNegativeInt_(options.maxAttempts) || COC_FETCH_MAX_ATTEMPTS);
	const label = String(labelRaw == null ? "" : labelRaw).trim() || String(requestConfig.url || "");

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			touchActiveRosterLockLease_("cocFetch");
			const res = UrlFetchApp.fetch(requestConfig.url, requestConfig.params);
			return parseCocFetchResponse_(res);
		} catch (err) {
			if (!shouldRetryCocFetchError_(err) || attempt >= maxAttempts) throw err;
			const waitMs = computeCocRetryDelayMs_(err, attempt);
			const statusCode = Number(err && err.statusCode);
			const statusLabel = isFinite(statusCode) ? String(Math.floor(statusCode)) : "transport";
			Logger.log("cocFetch retry %s/%s path=%s status=%s waitMs=%s", attempt + 1, maxAttempts, label, statusLabel, waitMs);
			if (waitMs > 0) {
				touchActiveRosterLockLease_("cocFetch retry wait");
				Utilities.sleep(waitMs);
			}
		}
	}

	throw new Error("Clash API request failed after retries.");
}

// Parse CoC fetch response.
function parseCocFetchResponse_(resRaw) {
	const res = resRaw && typeof resRaw === "object" ? resRaw : null;
	if (!res || typeof res.getResponseCode !== "function") {
		const noResponseErr = new Error("Clash API request failed (no response).");
		noResponseErr.name = "CocApiError";
		noResponseErr.statusCode = 0;
		noResponseErr.retryAfter = "";
		noResponseErr.apiBody = null;
		throw noResponseErr;
	}

	const status = Number(res.getResponseCode());
	const headers = res.getAllHeaders ? res.getAllHeaders() : {};
	const retryAfter = headers && (headers["Retry-After"] || headers["retry-after"] || "");
	const text = res.getContentText("UTF-8");
	let body = null;
	try {
		body = text ? JSON.parse(text) : null;
	} catch (err) {
		body = null;
	}

	if (status >= 200 && status < 300) {
		return body && typeof body === "object" ? body : {};
	}

	let msg = "Clash API request failed (" + status + ").";
	if (status === 401 || status === 403) {
		msg = "Clash API auth failed (" + status + "). Check COC_API_TOKEN and proxy access.";
	} else if (status === 404) {
		msg = "Clash API resource not found (404).";
	} else if (status === 429) {
		msg = "Clash API rate limit reached (429)." + (retryAfter ? " Retry-After: " + retryAfter + "." : "");
	}

	const err = new Error(msg);
	err.name = "CocApiError";
	err.statusCode = status;
	err.retryAfter = retryAfter ? String(retryAfter) : "";
	err.apiBody = body;
	throw err;
}

// Handle CoC fetch.
function cocFetch_(path) {
	const token = getCocApiToken_();
	const req = buildCocFetchRequestConfig_(path, token);
	return cocFetchWithRetry_(req, path);
}

// Handle CoC fetch all by path entries.
function cocFetchAllByPathEntries_(entriesRaw, optionsRaw) {
	const entriesInput = Array.isArray(entriesRaw) ? entriesRaw : [];
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const batchSize = Math.max(1, toNonNegativeInt_(options.batchSize) || AUTO_REFRESH_PREFETCH_BATCH_SIZE);
	const batchDelayMs = Math.max(0, toNonNegativeInt_(options.batchDelayMs) || AUTO_REFRESH_PREFETCH_BATCH_DELAY_MS);
	const out = {
		dataByKey: {},
		errorByKey: {},
		requestCount: 0,
		batchCount: 0,
	};
	const seenKey = {};
	const entries = [];
	for (let i = 0; i < entriesInput.length; i++) {
		const entry = entriesInput[i] && typeof entriesInput[i] === "object" ? entriesInput[i] : {};
		const key = String(entry.key == null ? "" : entry.key).trim();
		const path = String(entry.path == null ? "" : entry.path).trim();
		if (!key || !path || seenKey[key]) continue;
		seenKey[key] = true;
		entries.push({
			key: key,
			path: path,
		});
	}
	out.requestCount = entries.length;
	if (!entries.length) return out;

	let token = "";
	try {
		token = getCocApiToken_();
	} catch (err) {
		for (let i = 0; i < entries.length; i++) {
			out.errorByKey[entries[i].key] = err;
		}
		return out;
	}

	const requestConfigByKey = {};
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		try {
			requestConfigByKey[entry.key] = buildCocFetchRequestConfig_(entry.path, token);
		} catch (err) {
			out.errorByKey[entry.key] = err;
		}
	}

	const runnableEntries = [];
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (!requestConfigByKey[entry.key]) continue;
		runnableEntries.push(entry);
	}
	if (!runnableEntries.length) return out;

	for (let offset = 0; offset < runnableEntries.length; offset += batchSize) {
		touchActiveRosterLockLease_("cocFetchAll batch");
		const batch = runnableEntries.slice(offset, offset + batchSize);
		if (!batch.length) continue;
		if (out.batchCount > 0 && batchDelayMs > 0) {
			touchActiveRosterLockLease_("cocFetchAll batch delay");
			Utilities.sleep(batchDelayMs);
		}
		out.batchCount++;

		const fetchAllRequests = [];
		for (let i = 0; i < batch.length; i++) {
			const config = requestConfigByKey[batch[i].key];
			fetchAllRequests.push(config.fetchAllRequest);
		}

		let responses = null;
		try {
			touchActiveRosterLockLease_("cocFetchAll fetch");
			responses = UrlFetchApp.fetchAll(fetchAllRequests);
		} catch (err) {
			Logger.log("cocFetchAllByPathEntries: fetchAll batch failed (%s request(s)): %s", batch.length, errorMessage_(err));
			responses = null;
		}

		for (let i = 0; i < batch.length; i++) {
			const entry = batch[i];
			const config = requestConfigByKey[entry.key];
			try {
				const response = responses && Array.isArray(responses) && responses[i] && typeof responses[i].getResponseCode === "function" ? responses[i] : null;
				if (response) {
					try {
						out.dataByKey[entry.key] = parseCocFetchResponse_(response);
						continue;
					} catch (err) {
						if (!shouldRetryCocFetchError_(err)) throw err;
						const remainingAttempts = Math.max(1, COC_FETCH_MAX_ATTEMPTS - 1);
						const initialWaitMs = computeCocRetryDelayMs_(err, 1);
						Logger.log(
							"cocFetchAllByPathEntries: retrying path=%s after transient fetchAll response error (waitMs=%s): %s",
							entry.path,
							initialWaitMs,
							errorMessage_(err),
						);
						if (initialWaitMs > 0) {
							touchActiveRosterLockLease_("cocFetchAll response retry wait");
							Utilities.sleep(initialWaitMs);
						}
						out.dataByKey[entry.key] = cocFetchWithRetry_(config, entry.path, { maxAttempts: remainingAttempts });
						continue;
					}
				}
				out.dataByKey[entry.key] = cocFetchWithRetry_(config, entry.path);
			} catch (err) {
				out.errorByKey[entry.key] = err;
			}
		}
	}

	return out;
}

// Map API members.
function mapApiMembers_(membersRaw) {
	const out = [];
	const seen = {};
	const list = Array.isArray(membersRaw) ? membersRaw : [];
	for (let i = 0; i < list.length; i++) {
		const m = list[i] && typeof list[i] === "object" ? list[i] : {};
		const tag = normalizeTag_(m.tag);
		if (!tag || seen[tag]) continue;
		seen[tag] = true;

		const mp = Number(m.mapPosition);
		out.push({
			tag: tag,
			name: String(m.name == null ? "" : m.name),
			th: readTownHallLevel_(m),
			mapPosition: isFinite(mp) ? Math.floor(mp) : null,
		});
	}
	return out;
}

// Get opponent side for clan.
function getOpponentSideForClan_(war, clanTagRaw) {
	const clanTag = normalizeTag_(clanTagRaw);
	if (war && war.clan && normalizeTag_(war.clan.tag) === clanTag) return war.opponent || null;
	if (war && war.opponent && normalizeTag_(war.opponent.tag) === clanTag) return war.clan || null;
	return null;
}

// Fetch clan members snapshot.
function fetchClanMembersSnapshot_(clanTagRaw) {
	const clanTag = normalizeTag_(clanTagRaw);
	if (!clanTag) throw new Error("Clan tag is required.");
	const data = cocFetch_("/clans/" + encodeTagForPath_(clanTag) + "/members");
	const items = Array.isArray(data && data.items) ? data.items : [];
	return {
		clanTag: clanTag,
		capturedAt: new Date().toISOString(),
		members: mapApiMembers_(items),
		metricsMembers: mapApiMembersForMetricsSnapshot_(items),
	};
}

// Fetch clan members.
function fetchClanMembers_(clanTagRaw) {
	return fetchClanMembersSnapshot_(clanTagRaw).members;
}

// Handle prefetch clan members snapshots by tag.
function prefetchClanMembersSnapshotsByTag_(clanTagsRaw, optionsRaw) {
	const tagsRaw = Array.isArray(clanTagsRaw) ? clanTagsRaw : [];
	const entries = [];
	const seen = {};
	for (let i = 0; i < tagsRaw.length; i++) {
		const clanTag = normalizeTag_(tagsRaw[i]);
		if (!clanTag || seen[clanTag]) continue;
		seen[clanTag] = true;
		entries.push({
			key: clanTag,
			path: "/clans/" + encodeTagForPath_(clanTag) + "/members",
		});
	}
	const fetched = cocFetchAllByPathEntries_(entries, optionsRaw);
	const snapshotByClanTag = {};
	const errorByClanTag = {};
	const capturedAt = new Date().toISOString();
	for (let i = 0; i < entries.length; i++) {
		const clanTag = entries[i].key;
		if (Object.prototype.hasOwnProperty.call(fetched.dataByKey, clanTag)) {
			const data = fetched.dataByKey[clanTag];
			const items = Array.isArray(data && data.items) ? data.items : [];
			snapshotByClanTag[clanTag] = {
				clanTag: clanTag,
				capturedAt: capturedAt,
				members: mapApiMembers_(items),
				metricsMembers: mapApiMembersForMetricsSnapshot_(items),
			};
			continue;
		}
		if (Object.prototype.hasOwnProperty.call(fetched.errorByKey, clanTag)) {
			errorByClanTag[clanTag] = fetched.errorByKey[clanTag];
		}
	}
	return {
		snapshotByClanTag: snapshotByClanTag,
		errorByClanTag: errorByClanTag,
		requestCount: fetched.requestCount,
		batchCount: fetched.batchCount,
	};
}

// Map league group data for clan.
function mapLeagueGroupDataForClan_(clanTagRaw, leaguegroupRaw) {
	const clanTag = normalizeTag_(clanTagRaw);
	if (!clanTag) throw new Error("Clan tag is required.");
	const data = leaguegroupRaw && typeof leaguegroupRaw === "object" ? leaguegroupRaw : {};
	const hasClansArray = Array.isArray(data && data.clans);
	const hasRoundsArray = Array.isArray(data && data.rounds);
	const clans = hasClansArray ? data.clans : [];
	let clanEntry = null;
	for (let i = 0; i < clans.length; i++) {
		const c = clans[i] && typeof clans[i] === "object" ? clans[i] : {};
		if (normalizeTag_(c.tag) === clanTag) {
			clanEntry = c;
			break;
		}
	}
	return {
		isMalformed: !hasClansArray || !hasRoundsArray,
		clanFound: !!clanEntry,
		members: mapApiMembers_(clanEntry && clanEntry.members),
		warTags: extractLeagueGroupWarTags_(data),
		season: typeof data.season === "string" ? data.season : "",
	};
}

// Fetch league group data.
function fetchLeagueGroupData_(clanTagRaw) {
	const clanTag = normalizeTag_(clanTagRaw);
	if (!clanTag) throw new Error("Clan tag is required.");
	const data = cocFetch_("/clans/" + encodeTagForPath_(clanTag) + "/currentwar/leaguegroup");
	return mapLeagueGroupDataForClan_(clanTag, data);
}

// Handle prefetch league group raw by clan tag.
function prefetchLeagueGroupRawByClanTag_(clanTagsRaw, optionsRaw) {
	const tagsRaw = Array.isArray(clanTagsRaw) ? clanTagsRaw : [];
	const entries = [];
	const seen = {};
	for (let i = 0; i < tagsRaw.length; i++) {
		const clanTag = normalizeTag_(tagsRaw[i]);
		if (!clanTag || seen[clanTag]) continue;
		seen[clanTag] = true;
		entries.push({
			key: clanTag,
			path: "/clans/" + encodeTagForPath_(clanTag) + "/currentwar/leaguegroup",
		});
	}
	const fetched = cocFetchAllByPathEntries_(entries, optionsRaw);
	const rawByClanTag = {};
	const errorByClanTag = {};
	for (let i = 0; i < entries.length; i++) {
		const clanTag = entries[i].key;
		if (Object.prototype.hasOwnProperty.call(fetched.dataByKey, clanTag)) {
			rawByClanTag[clanTag] = fetched.dataByKey[clanTag];
			continue;
		}
		if (Object.prototype.hasOwnProperty.call(fetched.errorByKey, clanTag)) {
			errorByClanTag[clanTag] = fetched.errorByKey[clanTag];
		}
	}
	return {
		rawByClanTag: rawByClanTag,
		errorByClanTag: errorByClanTag,
		requestCount: fetched.requestCount,
		batchCount: fetched.batchCount,
	};
}

// Return whether private war log error.
function isPrivateWarLogError_(err) {
	return !!(err && Number(err.statusCode) === 403);
}

// Build no current regular war result.
function buildNoCurrentRegularWarResult_(clanTagRaw) {
	const clanTag = normalizeTag_(clanTagRaw);
	return {
		available: false,
		state: "notinwar",
		participants: [],
		clanSide: null,
		opponentSide: null,
		currentWarMeta: {
			warKey: clanTag + "||",
			available: false,
			state: "notinwar",
			teamSize: 0,
			attacksPerMember: 0,
			clanTag: clanTag,
			clanName: "",
			opponentTag: "",
			opponentName: "",
			preparationStartTime: "",
			startTime: "",
			endTime: "",
		},
	};
}

// Build private regular war result.
function buildPrivateRegularWarResult_(clanTagRaw) {
	const base = buildNoCurrentRegularWarResult_(clanTagRaw);
	base.currentWarMeta.unavailableReason = "privateWarLog";
	base.currentWarMeta.statusMessage = "Live war data unavailable because the clan war log is private.";
	return base;
}

// Map current regular war from API data.
function mapCurrentRegularWarFromApiData_(clanTagRaw, warRaw) {
	const clanTag = normalizeTag_(clanTagRaw);
	const warObj = warRaw && typeof warRaw === "object" ? warRaw : {};
	const state = String((warObj && warObj.state) || "")
		.trim()
		.toLowerCase();
	const clanSide = pickWarSideForClan_(warObj, clanTag);
	if (!clanSide) {
		return buildNoCurrentRegularWarResult_(clanTag);
	}

	const opponentSide = getOpponentSideForClan_(warObj, clanTag);
	const opponentTag = normalizeTag_(opponentSide && opponentSide.tag);
	const preparationStartTime = typeof warObj.preparationStartTime === "string" ? warObj.preparationStartTime : "";
	const startTime = typeof warObj.startTime === "string" ? warObj.startTime : "";
	const endTime = typeof warObj.endTime === "string" ? warObj.endTime : "";
	const warKey = getStableRegularWarKey_(
		{
			clanTag: normalizeTag_(clanSide.tag) || clanTag,
			opponentTag: opponentTag,
			preparationStartTime: preparationStartTime,
			startTime: startTime,
			endTime: endTime,
		},
		clanTag,
	);
	const currentWarMeta = {
		warKey: warKey,
		available: true,
		state: state || "notinwar",
		teamSize: toNonNegativeInt_(warObj.teamSize),
		attacksPerMember: toNonNegativeInt_(warObj.attacksPerMember),
		clanTag: normalizeTag_(clanSide.tag) || clanTag,
		clanName: String(clanSide.name == null ? "" : clanSide.name),
		opponentTag: opponentTag,
		opponentName: String(opponentSide && opponentSide.name != null ? opponentSide.name : ""),
		preparationStartTime: preparationStartTime,
		startTime: startTime,
		endTime: endTime,
	};

	return {
		available: true,
		state: currentWarMeta.state,
		participants: mapApiMembers_(clanSide.members),
		clanSide: clanSide,
		opponentSide: opponentSide,
		currentWarMeta: currentWarMeta,
	};
}

// Fetch current regular war.
function fetchCurrentRegularWar_(clanTagRaw) {
	const clanTag = normalizeTag_(clanTagRaw);
	if (!clanTag) throw new Error("Clan tag is required.");

	let war = null;
	try {
		war = cocFetch_("/clans/" + encodeTagForPath_(clanTag) + "/currentwar");
	} catch (err) {
		if (err && err.statusCode === 404) {
			return buildNoCurrentRegularWarResult_(clanTag);
		}
		if (isPrivateWarLogError_(err)) {
			return buildPrivateRegularWarResult_(clanTag);
		}
		throw err;
	}
	return mapCurrentRegularWarFromApiData_(clanTag, war);
}

// Handle prefetch current regular war by clan tag.
function prefetchCurrentRegularWarByClanTag_(clanTagsRaw, optionsRaw) {
	const tagsRaw = Array.isArray(clanTagsRaw) ? clanTagsRaw : [];
	const entries = [];
	const seen = {};
	for (let i = 0; i < tagsRaw.length; i++) {
		const clanTag = normalizeTag_(tagsRaw[i]);
		if (!clanTag || seen[clanTag]) continue;
		seen[clanTag] = true;
		entries.push({
			key: clanTag,
			path: "/clans/" + encodeTagForPath_(clanTag) + "/currentwar",
		});
	}
	const fetched = cocFetchAllByPathEntries_(entries, optionsRaw);
	const currentWarByClanTag = {};
	const errorByClanTag = {};
	for (let i = 0; i < entries.length; i++) {
		const clanTag = entries[i].key;
		if (Object.prototype.hasOwnProperty.call(fetched.dataByKey, clanTag)) {
			currentWarByClanTag[clanTag] = mapCurrentRegularWarFromApiData_(clanTag, fetched.dataByKey[clanTag]);
			continue;
		}
		if (!Object.prototype.hasOwnProperty.call(fetched.errorByKey, clanTag)) continue;
		const err = fetched.errorByKey[clanTag];
		if (err && Number(err.statusCode) === 404) {
			currentWarByClanTag[clanTag] = buildNoCurrentRegularWarResult_(clanTag);
			continue;
		}
		if (isPrivateWarLogError_(err)) {
			currentWarByClanTag[clanTag] = buildPrivateRegularWarResult_(clanTag);
			continue;
		}
		errorByClanTag[clanTag] = err;
	}
	return {
		currentWarByClanTag: currentWarByClanTag,
		errorByClanTag: errorByClanTag,
		requestCount: fetched.requestCount,
		batchCount: fetched.batchCount,
	};
}

// Handle prefetch CWL war raw by tag.
function prefetchCwlWarRawByTag_(warTagsRaw, optionsRaw) {
	const tagsRaw = Array.isArray(warTagsRaw) ? warTagsRaw : [];
	const entries = [];
	const seen = {};
	for (let i = 0; i < tagsRaw.length; i++) {
		const warTag = normalizeTag_(tagsRaw[i]);
		if (!warTag || warTag === "#0" || seen[warTag]) continue;
		seen[warTag] = true;
		entries.push({
			key: warTag,
			path: "/clanwarleagues/wars/" + encodeTagForPath_(warTag),
		});
	}
	const fetched = cocFetchAllByPathEntries_(entries, optionsRaw);
	const rawByWarTag = {};
	const errorByWarTag = {};
	for (let i = 0; i < entries.length; i++) {
		const warTag = entries[i].key;
		if (Object.prototype.hasOwnProperty.call(fetched.dataByKey, warTag)) {
			rawByWarTag[warTag] = fetched.dataByKey[warTag];
			continue;
		}
		if (Object.prototype.hasOwnProperty.call(fetched.errorByKey, warTag)) {
			errorByWarTag[warTag] = fetched.errorByKey[warTag];
		}
	}
	return {
		rawByWarTag: rawByWarTag,
		errorByWarTag: errorByWarTag,
		requestCount: fetched.requestCount,
		batchCount: fetched.batchCount,
	};
}

// Fetch clan war log.
function fetchClanWarLog_(clanTagRaw, limitRaw) {
	const clanTag = normalizeTag_(clanTagRaw);
	if (!clanTag) throw new Error("Clan tag is required.");
	const limit = Math.max(1, toNonNegativeInt_(limitRaw) || REGULAR_WAR_WARLOG_LIMIT);
	const data = cocFetch_("/clans/" + encodeTagForPath_(clanTag) + "/warlog?limit=" + limit);
	const itemsRaw = Array.isArray(data) ? data : Array.isArray(data && data.items) ? data.items : [];
	const out = [];
	for (let i = 0; i < itemsRaw.length; i++) {
		const entry = itemsRaw[i] && typeof itemsRaw[i] === "object" ? itemsRaw[i] : {};
		out.push(entry);
	}
	return out;
}

// Extract league group war tags.
function extractLeagueGroupWarTags_(leaguegroupRaw) {
	const rounds = Array.isArray(leaguegroupRaw && leaguegroupRaw.rounds) ? leaguegroupRaw.rounds : [];
	const warTags = [];
	const seen = {};
	for (let i = 0; i < rounds.length; i++) {
		const round = rounds[i] && typeof rounds[i] === "object" ? rounds[i] : {};
		const tags = Array.isArray(round.warTags) ? round.warTags : [];
		for (let j = 0; j < tags.length; j++) {
			const warTag = normalizeTag_(tags[j]);
			if (!warTag || warTag === "#0" || seen[warTag]) continue;
			seen[warTag] = true;
			warTags.push(warTag);
		}
	}
	return warTags;
}

// Handle league group contains clan.
function leagueGroupContainsClan_(leaguegroupRaw, clanTagRaw) {
	const clanTag = normalizeTag_(clanTagRaw);
	const clans = Array.isArray(leaguegroupRaw && leaguegroupRaw.clans) ? leaguegroupRaw.clans : [];
	for (let i = 0; i < clans.length; i++) {
		const clan = clans[i] && typeof clans[i] === "object" ? clans[i] : {};
		if (normalizeTag_(clan.tag) === clanTag) return true;
	}
	return false;
}

// Handle pick war side for clan.
function pickWarSideForClan_(war, clanTagRaw) {
	const clanTag = normalizeTag_(clanTagRaw);
	const clanSide = war && war.clan && normalizeTag_(war.clan.tag) === clanTag ? war.clan : null;
	if (clanSide) return clanSide;
	const oppSide = war && war.opponent && normalizeTag_(war.opponent.tag) === clanTag ? war.opponent : null;
	return oppSide;
}
