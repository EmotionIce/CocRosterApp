// Firebase transport, storage, and active snapshot helpers.

// Get required Script property.
function getRequiredScriptProperty_(keyRaw) {
	const key = String(keyRaw == null ? "" : keyRaw).trim();
	if (!key) throw new Error("Missing Script Property key.");
	const value = String(PropertiesService.getScriptProperties().getProperty(key) || "");
	if (!value.trim()) throw new Error("Missing Script Property " + key + ".");
	return value;
}

// Normalize Firebase db URL.
function normalizeFirebaseDbUrl_(urlRaw) {
	const raw = String(urlRaw == null ? "" : urlRaw).trim();
	if (!raw) return "";
	return raw.replace(/\/+$/, "");
}

// Preserve the original production Firebase private-key handling for signing.
function legacyNormalizeFirebasePrivateKey_(valueRaw) {
	return String(valueRaw == null ? "" : valueRaw).replace(/\\n/g, "\n");
}

// Normalize Firebase service-account private keys into canonical PEM text.
function normalizeFirebasePrivateKey_(valueRaw) {
	let value = String(valueRaw == null ? "" : valueRaw).trim();

	// Support values copied as JSON-stringified PEM text.
	if (value.length >= 2 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
		try {
			const parsedString = JSON.parse(value);
			if (typeof parsedString === "string") {
				value = parsedString;
			}
		} catch (err) {
			// Fall through to the wrapping-quote cleanup below for non-JSON quoted text.
		}
	}

	// Support pasting the full service-account JSON document into the Script Property.
	const objectCandidate = String(value == null ? "" : value).trim();
	if (objectCandidate.charAt(0) === "{" && objectCandidate.charAt(objectCandidate.length - 1) === "}") {
		try {
			const parsedObject = JSON.parse(objectCandidate);
			if (parsedObject && typeof parsedObject === "object" && !Array.isArray(parsedObject) && parsedObject.private_key != null) {
				value = String(parsedObject.private_key);
			}
		} catch (err) {
			// Validation below emits the safe, actionable error for unsupported formats.
		}
	}

	value = String(value == null ? "" : value);
	value = value
		.replace(/\\\\r\\\\n/g, "\n")
		.replace(/\\\\n/g, "\n")
		.replace(/\\r\\n/g, "\n")
		.replace(/\\n/g, "\n")
		.replace(/\r\n?/g, "\n")
		.trim();

	if (
		value.length >= 2 &&
		((value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') ||
			(value.charAt(0) === "'" && value.charAt(value.length - 1) === "'"))
	) {
		value = value.slice(1, -1).trim();
	}

	if (value.indexOf("-----BEGIN PRIVATE KEY-----") < 0 || value.indexOf("-----END PRIVATE KEY-----") < 0) {
		throw new Error("Invalid FIREBASE_PRIVATE_KEY format. Expected full PEM private key including BEGIN/END lines.");
	}
	return value;
}

// Return safe, non-secret diagnostics about a Firebase private key string.
function getSafePrivateKeyDiagnostics_(label, keyText) {
	const text = String(keyText == null ? "" : keyText);
	const beginMarker = "-----BEGIN PRIVATE KEY-----";
	const endMarker = "-----END PRIVATE KEY-----";
	const lines = text.split(/\r\n?|\n/);
	const firstLineRaw = lines.length ? lines[0] : "";
	const lastLineRaw = lines.length ? lines[lines.length - 1] : "";
	const firstLine = firstLineRaw === beginMarker || firstLineRaw === endMarker ? firstLineRaw : "";
	const lastLine = lastLineRaw === beginMarker || lastLineRaw === endMarker ? lastLineRaw : "";

	return {
		label: String(label == null ? "" : label),
		hasBegin: text.indexOf(beginMarker) >= 0,
		hasEnd: text.indexOf(endMarker) >= 0,
		newlineCount: (text.match(/\n/g) || []).length,
		length: text.length,
		startsWithBegin: text.indexOf(beginMarker) === 0,
		endsWithEnd: text.slice(-endMarker.length) === endMarker,
		hasLiteralBackslashN: text.indexOf("\\n") >= 0,
		firstLine: firstLine,
		lastLine: lastLine,
	};
}

// Attempt a safe diagnostic RSA signature without exposing signature bytes.
function trySignWithPrivateKeyForDiagnostics_(keyText) {
	try {
		Utilities.computeRsaSha256Signature("firebase-key-diagnostic", keyText);
		return { ok: true };
	} catch (err) {
		return { ok: false, error: errorMessage_(err) };
	}
}

// Normalize Firebase path.
function normalizeFirebasePath_(pathRaw) {
	return String(pathRaw == null ? "" : pathRaw)
		.trim()
		.replace(/\\/g, "/")
		.replace(/^[\/]+|[\/]+$/g, "")
		.replace(/\.\./g, "");
}

// Build Firebase JSON URL.
function buildFirebaseJsonUrl_(dbUrlRaw, pathRaw) {
	const dbUrl = normalizeFirebaseDbUrl_(dbUrlRaw);
	if (!dbUrl) throw new Error("Missing Firebase Realtime Database URL.");
	const safePath = normalizeFirebasePath_(pathRaw);
	if (/\.json(?:\?|$)/i.test(dbUrl)) {
		if (!safePath) return dbUrl;
		const base = dbUrl.replace(/\/+\.json/i, "");
		const encodedSegments = safePath
			.split("/")
			.filter((segment) => segment)
			.map((segment) => encodeURIComponent(segment));
		return base + "/" + encodedSegments.join("/") + ".json";
	}
	if (!safePath) return dbUrl + "/.json";
	const encodedSegments = safePath
		.split("/")
		.filter((segment) => segment)
		.map((segment) => encodeURIComponent(segment));
	return dbUrl + "/" + encodedSegments.join("/") + ".json";
}

// Build Firebase root JSON URL.
function buildFirebaseRootJsonUrl_(dbUrlRaw) {
	return buildFirebaseJsonUrl_(dbUrlRaw, "");
}

// Get Firebase config.
function getFirebaseConfig_() {
	if (firebaseConfigCache_) return firebaseConfigCache_;
	const config = {
		dbUrl: normalizeFirebaseDbUrl_(getRequiredScriptProperty_("FIREBASE_DB_URL")),
		clientEmail: String(getRequiredScriptProperty_("FIREBASE_CLIENT_EMAIL")).trim(),
		privateKey: legacyNormalizeFirebasePrivateKey_(getRequiredScriptProperty_("FIREBASE_PRIVATE_KEY")),
		tokenUri: String(getRequiredScriptProperty_("FIREBASE_TOKEN_URI")).trim(),
	};
	if (!config.dbUrl) throw new Error("Invalid FIREBASE_DB_URL Script Property.");
	if (!config.clientEmail) throw new Error("Invalid FIREBASE_CLIENT_EMAIL Script Property.");
	if (!config.privateKey) throw new Error("Invalid FIREBASE_PRIVATE_KEY Script Property.");
	if (!config.tokenUri) throw new Error("Invalid FIREBASE_TOKEN_URI Script Property.");
	firebaseConfigCache_ = config;
	return config;
}

// Handle utf8 string to bytes.
function utf8StringToBytes_(valueRaw) {
	return Utilities.newBlob(String(valueRaw == null ? "" : valueRaw)).getBytes();
}

// Handle utf8 bytes to string.
function utf8BytesToString_(bytesRaw) {
	return Utilities.newBlob(bytesRaw || []).getDataAsString("UTF-8");
}

// Handle base64 URL encode bytes.
function base64UrlEncodeBytes_(bytesRaw) {
	return Utilities.base64EncodeWebSafe(bytesRaw || []).replace(/=+$/g, "");
}

// Handle base64 URL encode utf8.
function base64UrlEncodeUtf8_(valueRaw) {
	return base64UrlEncodeBytes_(utf8StringToBytes_(valueRaw));
}

// Handle base64 URL decode to utf8.
function base64UrlDecodeToUtf8_(valueRaw) {
	let value = String(valueRaw == null ? "" : valueRaw).trim();
	if (!value) return "";
	const mod = value.length % 4;
	if (mod === 1) throw new Error("Invalid base64url payload length.");
	if (mod > 0) value += "====".slice(mod);
	const decoded = Utilities.base64DecodeWebSafe(value);
	return utf8BytesToString_(decoded);
}

// Handle needs Firebase key encoding.
function needsFirebaseKeyEncoding_(keyRaw) {
	const key = String(keyRaw == null ? "" : keyRaw);
	if (!key) return true;
	if (key.indexOf(FIREBASE_KEY_ENCODING_PREFIX) === 0) return true;
	if (/[.$#[\]\/]/.test(key)) return true;
	if (/[\u0000-\u001F\u007F]/.test(key)) return true;
	return false;
}

// Encode Firebase object key.
function encodeFirebaseObjectKey_(keyRaw) {
	const key = String(keyRaw == null ? "" : keyRaw);
	if (!needsFirebaseKeyEncoding_(key)) return key;
	return FIREBASE_KEY_ENCODING_PREFIX + base64UrlEncodeUtf8_(key);
}

// Decode Firebase object key.
function decodeFirebaseObjectKey_(keyRaw) {
	const key = String(keyRaw == null ? "" : keyRaw);
	if (key.indexOf(FIREBASE_KEY_ENCODING_PREFIX) !== 0) return key;
	const encodedPart = key.slice(FIREBASE_KEY_ENCODING_PREFIX.length);
	if (!encodedPart) throw new Error("Invalid Firebase encoded key with empty payload.");
	try {
		return base64UrlDecodeToUtf8_(encodedPart);
	} catch (err) {
		throw new Error("Invalid Firebase encoded key '" + key + "': " + errorMessage_(err));
	}
}

// Encode Firebase object keys recursive.
function encodeFirebaseObjectKeysRecursive_(valueRaw) {
	if (Array.isArray(valueRaw)) {
		const outArray = [];
		for (let i = 0; i < valueRaw.length; i++) outArray.push(encodeFirebaseObjectKeysRecursive_(valueRaw[i]));
		return outArray;
	}
	if (!valueRaw || typeof valueRaw !== "object") return valueRaw;
	const out = {};
	const keys = Object.keys(valueRaw);
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		const encodedKey = encodeFirebaseObjectKey_(key);
		if (Object.prototype.hasOwnProperty.call(out, encodedKey) && encodedKey !== key) {
			throw new Error("Firebase key encoding collision for object key '" + key + "'.");
		}
		out[encodedKey] = encodeFirebaseObjectKeysRecursive_(valueRaw[key]);
	}
	return out;
}

// Decode Firebase object keys recursive.
function decodeFirebaseObjectKeysRecursive_(valueRaw) {
	if (Array.isArray(valueRaw)) {
		const outArray = [];
		for (let i = 0; i < valueRaw.length; i++) outArray.push(decodeFirebaseObjectKeysRecursive_(valueRaw[i]));
		return outArray;
	}
	if (!valueRaw || typeof valueRaw !== "object") return valueRaw;
	const out = {};
	const keys = Object.keys(valueRaw);
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		const decodedKey = decodeFirebaseObjectKey_(key);
		if (Object.prototype.hasOwnProperty.call(out, decodedKey) && decodedKey !== key) {
			throw new Error("Firebase key decoding collision for object key '" + key + "'.");
		}
		out[decodedKey] = decodeFirebaseObjectKeysRecursive_(valueRaw[key]);
	}
	return out;
}

// Clear Firebase access token cache.
function clearFirebaseAccessTokenCache_() {
	const cache = getScriptCacheSafe_();
	removeStringFromCache_(cache, FIREBASE_ACCESS_TOKEN_CACHE_KEY);
}

// Handle request Firebase access token.
function requestFirebaseAccessToken_() {
	const config = getFirebaseConfig_();
	const nowSeconds = Math.floor(Date.now() / 1000);
	const header = { alg: "RS256", typ: "JWT" };
	const claims = {
		iss: config.clientEmail,
		scope: FIREBASE_ACCESS_TOKEN_SCOPE,
		aud: config.tokenUri,
		iat: nowSeconds,
		exp: nowSeconds + 3600,
	};
	const encodedHeader = base64UrlEncodeUtf8_(JSON.stringify(header));
	const encodedClaims = base64UrlEncodeUtf8_(JSON.stringify(claims));
	const unsignedToken = encodedHeader + "." + encodedClaims;
	let signatureBytes = null;
	try {
		signatureBytes = Utilities.computeRsaSha256Signature(unsignedToken, config.privateKey);
	} catch (err) {
		throw new Error("Firebase private key could not be used for RSA signing: " + errorMessage_(err));
	}
	const assertion = unsignedToken + "." + base64UrlEncodeBytes_(signatureBytes);

	const response = UrlFetchApp.fetch(config.tokenUri, {
		method: "post",
		muteHttpExceptions: true,
		payload: {
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion: assertion,
		},
	});
	const code = response && typeof response.getResponseCode === "function" ? Number(response.getResponseCode()) : 0;
	const text = response && typeof response.getContentText === "function" ? String(response.getContentText() || "") : "";
	if (!code || code < 200 || code >= 300) {
		throw new Error("Firebase token request failed (" + code + "): " + text);
	}
	let payload = null;
	try {
		payload = text ? JSON.parse(text) : null;
	} catch (err) {
		throw new Error("Firebase token endpoint returned invalid JSON.");
	}
	const accessToken = String(payload && payload.access_token ? payload.access_token : "").trim();
	const expiresIn = Math.max(60, Number(payload && payload.expires_in) || 3600);
	if (!accessToken) throw new Error("Firebase token endpoint response did not include access_token.");
	return { accessToken: accessToken, expiresIn: expiresIn };
}

// Get Firebase access token.
function getFirebaseAccessToken_(forceRefreshRaw) {
	const forceRefresh = !!forceRefreshRaw;
	const cache = getScriptCacheSafe_();
	if (!forceRefresh) {
		const cached = readStringFromCache_(cache, FIREBASE_ACCESS_TOKEN_CACHE_KEY);
		if (cached) return cached;
	}
	const tokenPayload = requestFirebaseAccessToken_();
	const ttl = Math.max(60, Math.floor(tokenPayload.expiresIn - FIREBASE_ACCESS_TOKEN_TTL_SAFETY_SECONDS));
	writeStringToCache_(cache, FIREBASE_ACCESS_TOKEN_CACHE_KEY, tokenPayload.accessToken, ttl);
	return tokenPayload.accessToken;
}

// Handle Firebase request JSON.
function firebaseRequestJson_(pathRaw, methodRaw, payloadRaw) {
	const path = normalizeFirebasePath_(pathRaw);
	const method = String(methodRaw == null ? "GET" : methodRaw).trim().toUpperCase();
	if (!method) throw new Error("Firebase request method is required.");
	const url = buildFirebaseJsonUrl_(getFirebaseConfig_().dbUrl, path);

	// Handle do request.
	const doRequest = (forceTokenRefresh) => {
		const accessToken = getFirebaseAccessToken_(forceTokenRefresh);
		const options = {
			method: method,
			muteHttpExceptions: true,
			headers: {
				Authorization: "Bearer " + accessToken,
				Accept: "application/json",
			},
		};
		if (payloadRaw !== undefined) {
			options.contentType = "application/json";
			options.payload = JSON.stringify(payloadRaw);
		}
		return UrlFetchApp.fetch(url, options);
	};

	let response = doRequest(false);
	let code = response && typeof response.getResponseCode === "function" ? Number(response.getResponseCode()) : 0;
	if (code === 401 || code === 403) {
		clearFirebaseAccessTokenCache_();
		response = doRequest(true);
		code = response && typeof response.getResponseCode === "function" ? Number(response.getResponseCode()) : 0;
	}

	const text = response && typeof response.getContentText === "function" ? String(response.getContentText() || "") : "";
	if (!code || code < 200 || code >= 300) {
		throw new Error("Firebase Realtime Database request failed (" + code + "): " + text);
	}
	const trimmed = text.trim();
	if (!trimmed) return null;
	try {
		return JSON.parse(trimmed);
	} catch (err) {
		throw new Error("Firebase Realtime Database response is not valid JSON: " + errorMessage_(err));
	}
}

// Handle Firebase root request JSON.
function firebaseRootRequestJson_(methodRaw, payloadRaw) {
	return firebaseRequestJson_("", methodRaw, payloadRaw);
}

// Parse roster data text.
function parseRosterDataText_(text, sourceLabel) {
	const label = String(sourceLabel == null ? ACTIVE_ROSTER_FILENAME : sourceLabel).trim() || ACTIVE_ROSTER_FILENAME;
	const raw = String(text == null ? "" : text);
	if (!raw) {
		if (label === ACTIVE_ROSTER_FILENAME) {
			throw new Error("Missing " + label + " in Firebase Realtime Database /active.");
		}
		throw new Error("Missing " + label + ".");
	}
	try {
		return JSON.parse(raw);
	} catch (err) {
		throw new Error(label + " is not valid JSON:\n\n" + errorMessage_(err));
	}
}

// Decode and validate active roster payload.
function decodeAndValidateActiveRosterPayload_(encodedPayload, sourceLabelRaw) {
	if (!encodedPayload || typeof encodedPayload !== "object" || Array.isArray(encodedPayload)) {
		throw new Error("Missing or invalid active roster payload at " + String(sourceLabelRaw || "unknown") + ".");
	}
	const decodedPayload = decodeFirebaseObjectKeysRecursive_(encodedPayload);
	const rosterData = validateRosterData_(decodedPayload);
	const text = JSON.stringify(rosterData);
	return {
		text: text,
		rosterData: rosterData,
		source: String(sourceLabelRaw || "firebase"),
	};
}

// Handle read legacy root active roster snapshot or null.
function readLegacyRootActiveRosterSnapshotOrNull_() {
	const encodedRoot = firebaseRootRequestJson_("GET");
	if (!encodedRoot || typeof encodedRoot !== "object" || Array.isArray(encodedRoot)) return null;
	try {
		return decodeAndValidateActiveRosterPayload_(encodedRoot, "firebase:/ (legacy-root)");
	} catch (err) {
		return null;
	}
}

// Handle read active roster snapshot from Firebase.
function readActiveRosterSnapshotFromFirebase_() {
	const encodedPayload = firebaseRequestJson_(FIREBASE_ACTIVE_PATH, "GET");
	if (encodedPayload != null) {
		return decodeAndValidateActiveRosterPayload_(encodedPayload, "firebase:/active");
	}
	throw new Error("Missing active roster payload at /active. Run migrateLegacyFirebaseRootToNamespacedLayout_() if this database still uses the old root layout.");
}

// Handle read active roster snapshot.
function readActiveRosterSnapshot_() {
	return readActiveRosterSnapshotFromFirebase_();
}

// Convenience wrapper used by active-write freshness and legacy compatibility shims.
function readActiveRosterData_() {
	return readActiveRosterSnapshot_().rosterData;
}

// Manual Apps Script migration entrypoint for databases that still have the old
// root-level active payload. Current reads and writes use /active.
function migrateLegacyFirebaseRootToNamespacedLayout_() {
	const activeNode = firebaseRequestJson_(FIREBASE_ACTIVE_PATH, "GET");
	if (activeNode != null) {
		const currentActive = decodeAndValidateActiveRosterPayload_(activeNode, "firebase:/active");
		const existingArchive = firebaseRequestJson_("archive", "GET");
		const archiveObj = existingArchive && typeof existingArchive === "object" && !Array.isArray(existingArchive) ? existingArchive : {};
		if (!archiveObj.publish || typeof archiveObj.publish !== "object" || Array.isArray(archiveObj.publish)) {
			firebaseRequestJson_(FIREBASE_ARCHIVE_PUBLISH_PATH, "PUT", {});
		}
		if (!archiveObj.autorefreshDaily || typeof archiveObj.autorefreshDaily !== "object" || Array.isArray(archiveObj.autorefreshDaily)) {
			firebaseRequestJson_(FIREBASE_ARCHIVE_AUTOREFRESH_DAILY_PATH, "PUT", {});
		}
		firebaseRequestJson_(FIREBASE_META_PATH, "PATCH", {
			layoutVersion: FIREBASE_LAYOUT_VERSION,
			lastMigrationCheckAt: new Date().toISOString(),
		});
		return {
			ok: true,
			migrated: false,
			reason: "already-namespaced",
			activeLastUpdatedAt: String((currentActive.rosterData && currentActive.rosterData.lastUpdatedAt) || "").trim(),
		};
	}

	const legacySnapshot = readLegacyRootActiveRosterSnapshotOrNull_();
	if (!legacySnapshot) {
		throw new Error("Legacy Firebase root payload was not found or is invalid; migration was not applied.");
	}

	const migratedAt = new Date().toISOString();
	const rootPayload = {
		active: encodeFirebaseObjectKeysRecursive_(legacySnapshot.rosterData),
		archive: {
			publish: {},
			autorefreshDaily: {},
		},
		meta: {
			layoutVersion: FIREBASE_LAYOUT_VERSION,
			migratedAt: migratedAt,
			migrationSource: "legacy-root",
		},
	};
	firebaseRootRequestJson_("PUT", rootPayload);
	updateActiveRosterDataCaches_(legacySnapshot.text);

	return {
		ok: true,
		migrated: true,
		migratedAt: migratedAt,
		activeLastUpdatedAt: String((legacySnapshot.rosterData && legacySnapshot.rosterData.lastUpdatedAt) || "").trim(),
	};
}

// Public Apps Script run-menu wrapper for the one-time legacy root -> /active
// migration. Keep the private helper for internal callers; Apps Script hides
// trailing-underscore names from the run dropdown.
function runFirebaseLayoutMigrationOnce() {
	return migrateLegacyFirebaseRootToNamespacedLayout_();
}

// Public Apps Script run-menu wrapper for a one-time canonical /active rewrite.
// Use after taking a Firebase backup. This validates and rewrites the current
// active payload through the same boundary used by production writes.
function cleanupActiveFirebaseSchemaOnce() {
	const snapshot = readActiveRosterSnapshotFromFirebase_();
	const cleanupAt = new Date().toISOString();
	const result = replaceActiveRosterData_(snapshot.rosterData, { sourceSnapshot: snapshot });
	const rosterData = result && result.validatedRosterData ? result.validatedRosterData : {};
	const counts = countRosterPayload_(rosterData);
	const metricEntryCount = countPlayerMetricsEntries_(rosterData && rosterData.playerMetrics);
	firebaseRequestJson_(FIREBASE_META_PATH, "PATCH", {
		layoutVersion: FIREBASE_LAYOUT_VERSION,
		manualSchemaCleanupAt: cleanupAt,
		manualSchemaCleanupMetricEntryCount: metricEntryCount,
	});
	return {
		ok: true,
		cleanedAt: cleanupAt,
		activeLastUpdatedAt: String((rosterData && rosterData.lastUpdatedAt) || "").trim(),
		rosterCount: Array.isArray(rosterData.rosters) ? rosterData.rosters.length : 0,
		playerCount: counts.playerCount,
		noteCount: counts.noteCount,
		metricEntryCount: metricEntryCount,
	};
}

// Build one canonical roster player from older active payload shapes.
function buildManualCleanupRosterPlayer_(playerRaw, statsRaw) {
	const player = playerRaw && typeof playerRaw === "object" && !Array.isArray(playerRaw) ? playerRaw : {};
	const stats = statsRaw && typeof statsRaw === "object" ? statsRaw : {};
	const allowed = buildExactKeySet_(ACTIVE_ROSTER_PLAYER_FIELD_NAMES);
	const keys = Object.keys(player);
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		if (allowed[key]) continue;
		if (key === "note" && !Object.prototype.hasOwnProperty.call(player, "notes")) {
			stats.convertedNoteFields = toNonNegativeInt_(stats.convertedNoteFields) + 1;
			continue;
		}
		stats.droppedPlayerFields = toNonNegativeInt_(stats.droppedPlayerFields) + 1;
	}
	const thNumber = Number(player.th);
	return {
		slot: player.slot == null ? null : Number(player.slot),
		name: typeof player.name === "string" ? player.name : "",
		discord: typeof player.discord === "string" ? player.discord : "",
		th: isFinite(thNumber) ? thNumber : 0,
		tag: normalizeTag_(player.tag),
		notes: sanitizeNotes_(Object.prototype.hasOwnProperty.call(player, "notes") ? player.notes : player.note),
		excludeAsSwapTarget: toBooleanFlag_(player.excludeAsSwapTarget),
		excludeAsSwapSource: toBooleanFlag_(player.excludeAsSwapSource),
	};
}

// Build canonical roster player arrays from older active payload shapes.
function buildManualCleanupRosterPlayers_(playersRaw, statsRaw) {
	const players = Array.isArray(playersRaw) ? playersRaw : [];
	const out = [];
	for (let i = 0; i < players.length; i++) {
		out.push(buildManualCleanupRosterPlayer_(players[i], statsRaw));
	}
	return out;
}

// Collect canonical Discord identity candidates from playerMetrics and roster cache rows.
function collectDiscordIdentityCandidatesByTag_(rosterDataRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const out = {};
	const store = rosterData.playerMetrics && typeof rosterData.playerMetrics === "object" ? rosterData.playerMetrics : {};
	const byTag = store.byTag && typeof store.byTag === "object" ? store.byTag : {};
	const metricTags = Object.keys(byTag);
	for (let i = 0; i < metricTags.length; i++) {
		const rawKey = metricTags[i];
		const tag = normalizeTag_(rawKey);
		if (!tag) continue;
		const entry = byTag[rawKey] && typeof byTag[rawKey] === "object" ? byTag[rawKey] : {};
		const identity = sanitizePlayerMetricsIdentity_(entry.identity, tag, entry.identity && entry.identity.name);
		if (identity && hasCanonicalDiscordIdentity_(identity)) out[tag] = identity;
	}

	const roles = ["main", "subs", "missing"];
	const rosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		for (let roleIndex = 0; roleIndex < roles.length; roleIndex++) {
			const role = roles[roleIndex];
			const players = Array.isArray(roster[role]) ? roster[role] : [];
			for (let playerIndex = 0; playerIndex < players.length; playerIndex++) {
				const player = players[playerIndex] && typeof players[playerIndex] === "object" ? players[playerIndex] : {};
				const tag = normalizeTag_(player.tag);
				const discordUsername = sanitizeDiscordUsernameValue_(player.discord);
				if (!tag || !discordUsername) continue;
				const existing = out[tag] && typeof out[tag] === "object" ? out[tag] : { tag: tag, name: "" };
				if (!existing.name && typeof player.name === "string" && player.name.trim()) existing.name = player.name.trim();
				if (!sanitizeDiscordUsernameValue_(existing.discordUsername)) existing.discordUsername = discordUsername;
				out[tag] = sanitizePlayerMetricsIdentity_(existing, tag, existing.name) || existing;
			}
		}
	}
	return out;
}

// Collect roster-row Discord cache values by player tag.
function collectRosterDiscordCacheByTag_(rosterDataRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const out = {};
	const roles = ["main", "subs", "missing"];
	const rosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		for (let roleIndex = 0; roleIndex < roles.length; roleIndex++) {
			const players = Array.isArray(roster[roles[roleIndex]]) ? roster[roles[roleIndex]] : [];
			for (let playerIndex = 0; playerIndex < players.length; playerIndex++) {
				const player = players[playerIndex] && typeof players[playerIndex] === "object" ? players[playerIndex] : {};
				const tag = normalizeTag_(player.tag);
				const discordUsername = sanitizeDiscordUsernameValue_(player.discord);
				if (!tag || !discordUsername || Object.prototype.hasOwnProperty.call(out, tag)) continue;
				out[tag] = discordUsername;
			}
		}
	}
	return out;
}

// Collect roster player locations for a player tag.
function collectRosterPlayerLocationsByTag_(rosterDataRaw, playerTagRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const wantedTag = normalizeTag_(playerTagRaw);
	const locations = [];
	const roles = ["main", "subs", "missing"];
	const rosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		for (let roleIndex = 0; roleIndex < roles.length; roleIndex++) {
			const role = roles[roleIndex];
			const players = Array.isArray(roster[role]) ? roster[role] : [];
			for (let playerIndex = 0; playerIndex < players.length; playerIndex++) {
				const player = players[playerIndex] && typeof players[playerIndex] === "object" ? players[playerIndex] : {};
				const tag = normalizeTag_(player.tag);
				if (!tag || (wantedTag && tag !== wantedTag)) continue;
				locations.push({
					roster: roster,
					player: player,
					rosterId: typeof roster.id === "string" ? roster.id : "",
					rosterTitle: typeof roster.title === "string" ? roster.title : "",
					role: role,
					index: playerIndex,
					tag: tag,
					previousDiscord: typeof player.discord === "string" ? player.discord : "",
				});
			}
		}
	}
	return locations;
}

// Normalize explicit Discord identity upserts passed to canonicalization helpers.
function normalizeDiscordIdentityUpsertsByTag_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const out = {};
	const addIdentity = (tagRaw, identityRaw) => {
		const identity = identityRaw && typeof identityRaw === "object" ? identityRaw : {};
		const tag = normalizeTag_(tagRaw || identity.tag || identity.playerTag);
		if (!tag) return;
		const normalized = sanitizePlayerMetricsIdentity_(
			{
				tag: tag,
				name: identity.name,
				discordId: identity.discordId,
				discordUsername: identity.discordUsername != null ? identity.discordUsername : identity.username,
				discordLinkedAt: identity.discordLinkedAt,
				discordUpdatedAt: identity.discordUpdatedAt,
				discordSource: identity.discordSource || options.source,
			},
			tag,
			identity.name,
		);
		if (normalized && hasCanonicalDiscordIdentity_(normalized)) out[tag] = normalized;
	};

	if (options.identity && typeof options.identity === "object") {
		addIdentity(options.identity.tag || options.identity.playerTag || options.playerTag, options.identity);
	}
	const identityByTag = options.identityByTag && typeof options.identityByTag === "object" ? options.identityByTag : {};
	const identityTags = Object.keys(identityByTag);
	for (let i = 0; i < identityTags.length; i++) {
		addIdentity(identityTags[i], identityByTag[identityTags[i]]);
	}
	const identities = Array.isArray(options.identities) ? options.identities : [];
	for (let i = 0; i < identities.length; i++) {
		addIdentity(identities[i] && (identities[i].tag || identities[i].playerTag), identities[i]);
	}
	return out;
}

// Canonicalize Discord identity into playerMetrics and hydrate roster-row cache values.
function canonicalizeDiscordIdentityForRosterData_(rosterDataRaw, optionsRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : null;
	if (!rosterData) {
		return {
			rosterData: rosterDataRaw,
			updatedCanonical: false,
			updatedRosterCache: false,
			migratedFromRosterCache: 0,
			preservedFromSource: 0,
			explicitUpserts: 0,
			hydratedRosterCache: 0,
			tags: [],
		};
	}

	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const nowIso = String(options.updatedAt == null ? "" : options.updatedAt).trim() || new Date().toISOString();
	const source = sanitizeDiscordIdentitySource_(options.source || "canonicalize");
	const sourceRosterData = options.sourceRosterData && typeof options.sourceRosterData === "object"
		? options.sourceRosterData
		: options.currentActiveRosterData && typeof options.currentActiveRosterData === "object"
			? options.currentActiveRosterData
			: null;
	const allowRosterCacheUsernameUpdates = options.allowRosterCacheUsernameUpdates === true;
	const changedTags = {};
	let preservedFromSource = 0;
	let migratedFromRosterCache = 0;
	let explicitUpserts = 0;
	let hydratedRosterCache = 0;

	const sourceCandidates = collectDiscordIdentityCandidatesByTag_(sourceRosterData);
	const sourceTags = Object.keys(sourceCandidates);
	for (let i = 0; i < sourceTags.length; i++) {
		const tag = sourceTags[i];
		const result = upsertDiscordIdentityForPlayerTag_(rosterData, tag, sourceCandidates[tag], {
			updatedAt: nowIso,
			source: sourceCandidates[tag].discordSource || source || "active-preserve",
			onlyFillMissing: true,
		});
		if (result && result.changed) {
			preservedFromSource++;
			changedTags[tag] = true;
		}
	}

	const sourceRosterCacheByTag = collectRosterDiscordCacheByTag_(sourceRosterData);
	const targetRosterCacheByTag = collectRosterDiscordCacheByTag_(rosterData);
	const targetCacheTags = Object.keys(targetRosterCacheByTag);
	for (let i = 0; i < targetCacheTags.length; i++) {
		const tag = targetCacheTags[i];
		const discordUsername = sanitizeDiscordUsernameValue_(targetRosterCacheByTag[tag]);
		if (!discordUsername) continue;
		const existingIdentity = readDiscordIdentityForPlayerTag_(rosterData, tag);
		const existingUsername = sanitizeDiscordUsernameValue_(existingIdentity && existingIdentity.discordUsername);
		const sourceRosterUsername = sanitizeDiscordUsernameValue_(sourceRosterCacheByTag[tag]);
		const shouldUpdateFromRosterCache =
			!existingUsername ||
			(allowRosterCacheUsernameUpdates && (!sourceRosterData || discordUsername !== sourceRosterUsername));
		if (!shouldUpdateFromRosterCache) continue;
		const result = upsertDiscordIdentityForPlayerTag_(
			rosterData,
			tag,
			{
				tag: tag,
				discordUsername: discordUsername,
				discordSource: source || "roster-cache",
			},
			{
				updatedAt: nowIso,
				source: source || "roster-cache",
			},
		);
		if (result && result.changed) {
			migratedFromRosterCache++;
			changedTags[tag] = true;
		}
	}

	const explicitByTag = normalizeDiscordIdentityUpsertsByTag_(options);
	const explicitTags = Object.keys(explicitByTag);
	for (let i = 0; i < explicitTags.length; i++) {
		const tag = explicitTags[i];
		const result = upsertDiscordIdentityForPlayerTag_(rosterData, tag, explicitByTag[tag], {
			updatedAt: nowIso,
			source: explicitByTag[tag].discordSource || source || "discord-sync",
			touchUpdatedAt: options.touchUpdatedAt === true,
		});
		if (result && result.changed) {
			explicitUpserts++;
			changedTags[tag] = true;
		}
	}

	const allLocations = collectRosterPlayerLocationsByTag_(rosterData, "");
	for (let i = 0; i < allLocations.length; i++) {
		const location = allLocations[i];
		const tag = normalizeTag_(location && location.tag);
		if (!tag || !location.player) continue;
		const identity = readDiscordIdentityForPlayerTag_(rosterData, tag);
		if (!identity || !hasCanonicalDiscordIdentity_(identity)) continue;
		const canonicalUsername = sanitizeDiscordUsernameValue_(identity.discordUsername);
		const previousDiscord = typeof location.player.discord === "string" ? location.player.discord : "";
		if (previousDiscord === canonicalUsername) continue;
		location.player.discord = canonicalUsername;
		hydratedRosterCache++;
		changedTags[tag] = true;
	}

	rosterData.playerMetrics = sanitizePlayerMetricsStore_(rosterData.playerMetrics, nowIso);
	return {
		rosterData: rosterData,
		updatedCanonical: preservedFromSource > 0 || migratedFromRosterCache > 0 || explicitUpserts > 0,
		updatedRosterCache: hydratedRosterCache > 0,
		migratedFromRosterCache: migratedFromRosterCache,
		preservedFromSource: preservedFromSource,
		explicitUpserts: explicitUpserts,
		hydratedRosterCache: hydratedRosterCache,
		tags: Object.keys(changedTags),
	};
}

// Write one Discord identity update through the active Firebase write boundary.
function syncDiscordIdentityIntoActiveRoster_(payloadRaw, optionsRaw) {
	const payload = payloadRaw && typeof payloadRaw === "object" ? payloadRaw : {};
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const normalizedTag = normalizeTag_(payload.playerTag || payload.tag);
	if (!normalizedTag || !isValidPlayerTag_(normalizedTag)) {
		throw new Error("Invalid player tag.");
	}
	const discordId = sanitizeDiscordIdValue_(payload.discordId);
	const discordUsername = sanitizeDiscordUsernameValue_(payload.discordUsername != null ? payload.discordUsername : payload.username);
	if (!discordId && !discordUsername) {
		throw new Error("Discord username or Discord ID is required.");
	}

	const sourceSnapshot = options.sourceSnapshot && typeof options.sourceSnapshot === "object" ? options.sourceSnapshot : readActiveRosterSnapshot_();
	const rosterData = sourceSnapshot && sourceSnapshot.rosterData ? sourceSnapshot.rosterData : null;
	if (!rosterData || !Array.isArray(rosterData.rosters)) {
		throw new Error("Active roster data is unavailable.");
	}

	const beforeLocations = collectRosterPlayerLocationsByTag_(rosterData, normalizedTag);
	let created = false;
	let insertedIndex = -1;
	if (!beforeLocations.length && options.createMissing !== false) {
		const firstRoster = rosterData.rosters[0];
		if (!firstRoster || typeof firstRoster !== "object") {
			throw new Error("Cannot add missing player because the first roster is unavailable.");
		}
		if (!Array.isArray(firstRoster.missing)) firstRoster.missing = [];
		firstRoster.missing.push({
			slot: null,
			name: "",
			discord: "",
			th: 0,
			tag: normalizedTag,
			notes: [],
			excludeAsSwapTarget: false,
			excludeAsSwapSource: false,
		});
		created = true;
		insertedIndex = firstRoster.missing.length - 1;
	}

	const updatedAt = String(options.updatedAt == null ? "" : options.updatedAt).trim() || new Date().toISOString();
	const canonicalizeResult = canonicalizeDiscordIdentityForRosterData_(rosterData, {
		sourceRosterData: sourceSnapshot.rosterData,
		updatedAt: updatedAt,
		source: options.source || payload.discordSource || ACTIVE_DATA_WRITE_SOURCE_DISCORD_SYNC,
		identity: {
			tag: normalizedTag,
			name: payload.name,
			discordId: discordId,
			discordUsername: discordUsername,
			discordSource: options.source || payload.discordSource || ACTIVE_DATA_WRITE_SOURCE_DISCORD_SYNC,
		},
	});
	const afterLocations = collectRosterPlayerLocationsByTag_(rosterData, normalizedTag);
	const locations = [];
	let updatedLocationCount = 0;
	let skippedExistingCount = 0;
	for (let i = 0; i < afterLocations.length; i++) {
		const after = afterLocations[i];
		let previousDiscord = "";
		for (let j = 0; j < beforeLocations.length; j++) {
			const before = beforeLocations[j];
			if (before.rosterId === after.rosterId && before.role === after.role && before.index === after.index) {
				previousDiscord = before.previousDiscord;
				break;
			}
		}
		const currentDiscord = typeof after.player.discord === "string" ? after.player.discord : "";
		const updatedRosterCacheForLocation = previousDiscord !== currentDiscord;
		if (updatedRosterCacheForLocation) updatedLocationCount++;
		else if (!(created && after.role === "missing" && after.index === insertedIndex)) skippedExistingCount++;
		locations.push({
			rosterId: after.rosterId,
			rosterTitle: after.rosterTitle,
			role: after.role,
			index: after.index,
			previousDiscord: previousDiscord,
			discord: currentDiscord,
			updatedRosterCache: updatedRosterCacheForLocation,
			updated: updatedRosterCacheForLocation,
			created: created && after.role === "missing" && after.index === insertedIndex,
		});
	}

	const finalIdentity = readDiscordIdentityForPlayerTag_(rosterData, normalizedTag) || {};
	const updatedCanonical = !!(canonicalizeResult && canonicalizeResult.updatedCanonical);
	const updatedRosterCache = !!(canonicalizeResult && canonicalizeResult.updatedRosterCache);
	const updated = created || updatedCanonical || updatedRosterCache;
	if (updated) {
		const validated = withRosterLastUpdatedAt_(rosterData, updatedAt);
		replaceActiveRosterData_(validated, { sourceSnapshot: sourceSnapshot });
	}

	return {
		ok: true,
		found: beforeLocations.length > 0,
		created: created,
		updated: updated,
		tag: normalizedTag,
		discordId: sanitizeDiscordIdValue_(finalIdentity.discordId),
		discordUsername: sanitizeDiscordUsernameValue_(finalIdentity.discordUsername),
		updatedCanonical: updatedCanonical,
		updatedRosterCache: updatedRosterCache,
		reason: created ? "player-created-in-missing" : "",
		updatedCount: updatedLocationCount,
		skippedExistingCount: skippedExistingCount,
		addedCount: created ? 1 : 0,
		locations: locations,
	};
}

// Convert a decoded active payload into the current strict active schema before
// validation. This is intentionally only used by manual one-time cleanup.
function buildManualCleanupActivePayload_(payloadRaw) {
	const data = payloadRaw && typeof payloadRaw === "object" && !Array.isArray(payloadRaw) ? payloadRaw : {};
	const stats = {
		convertedNoteFields: 0,
		droppedPlayerFields: 0,
		droppedRosterMetricStores: 0,
		migratedRootMetrics: false,
	};
	const out = {
		schemaVersion: typeof data.schemaVersion === "number" && isFinite(data.schemaVersion) ? data.schemaVersion : 1,
		pageTitle: typeof data.pageTitle === "string" ? data.pageTitle : "",
		rosterOrder: Array.isArray(data.rosterOrder) ? data.rosterOrder.slice() : [],
		rosters: [],
	};
	if (typeof data.lastUpdatedAt === "string" && data.lastUpdatedAt.trim()) out.lastUpdatedAt = data.lastUpdatedAt.trim();
	if (data.publicConfig && typeof data.publicConfig === "object" && !Array.isArray(data.publicConfig)) out.publicConfig = data.publicConfig;

	const metricsSource =
		data.playerMetrics && typeof data.playerMetrics === "object" && !Array.isArray(data.playerMetrics)
			? data.playerMetrics
			: data.metrics && typeof data.metrics === "object" && !Array.isArray(data.metrics)
				? data.metrics
				: null;
	stats.migratedRootMetrics = !data.playerMetrics && !!metricsSource;
	out.playerMetrics = sanitizePlayerMetricsStore_(metricsSource, out.lastUpdatedAt || new Date().toISOString());

	const rosters = Array.isArray(data.rosters) ? data.rosters : [];
	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" && !Array.isArray(rosters[i]) ? rosters[i] : {};
		if (roster.metrics && typeof roster.metrics === "object") stats.droppedRosterMetricStores++;
		if (roster.playerMetrics && typeof roster.playerMetrics === "object") stats.droppedRosterMetricStores++;
		const nextRoster = {
			id: typeof roster.id === "string" ? roster.id.trim() : "",
			title: typeof roster.title === "string" ? roster.title : "",
			connectedClanTag: normalizeTag_(roster.connectedClanTag),
			trackingMode: getRosterTrackingMode_(roster),
			main: buildManualCleanupRosterPlayers_(roster.main, stats),
			subs: buildManualCleanupRosterPlayers_(roster.subs, stats),
			missing: buildManualCleanupRosterPlayers_(roster.missing, stats),
		};
		if (roster.cwlStats && typeof roster.cwlStats === "object") nextRoster.cwlStats = roster.cwlStats;
		if (roster.regularWar && typeof roster.regularWar === "object") nextRoster.regularWar = roster.regularWar;
		if (roster.warPerformance && typeof roster.warPerformance === "object") nextRoster.warPerformance = roster.warPerformance;
		if (roster.publicLineupProjection && typeof roster.publicLineupProjection === "object") nextRoster.publicLineupProjection = roster.publicLineupProjection;
		if (roster.cwlPreparation && typeof roster.cwlPreparation === "object") nextRoster.cwlPreparation = roster.cwlPreparation;
		if (roster.benchSuggestions && typeof roster.benchSuggestions === "object") nextRoster.benchSuggestions = roster.benchSuggestions;
		out.rosters.push(nextRoster);
	}

	const canonicalized = canonicalizeDiscordIdentityForRosterData_(out, {
		updatedAt: out.lastUpdatedAt || new Date().toISOString(),
		source: "manual-cleanup",
		allowRosterCacheUsernameUpdates: true,
	});
	stats.migratedDiscordIdentityFromRosterCache = toNonNegativeInt_(canonicalized && canonicalized.migratedFromRosterCache);
	stats.hydratedDiscordRosterCache = toNonNegativeInt_(canonicalized && canonicalized.hydratedRosterCache);

	return {
		rosterData: validateRosterData_(out),
		stats: stats,
	};
}

// Public Apps Script run-menu wrapper for repairing old active data that cannot
// pass the strict validator yet. It reads raw Firebase data, converts only known
// legacy active schema leftovers, validates, then writes the canonical layout.
function repairActiveFirebaseSchemaFromRawOnce() {
	const cleanupAt = new Date().toISOString();
	const activeNode = firebaseRequestJson_(FIREBASE_ACTIVE_PATH, "GET");
	let decodedPayload = null;
	let source = "firebase:/active";
	if (activeNode != null) {
		decodedPayload = decodeFirebaseObjectKeysRecursive_(activeNode);
	} else {
		const rootNode = firebaseRootRequestJson_("GET");
		if (!rootNode || typeof rootNode !== "object" || Array.isArray(rootNode)) {
			throw new Error("No /active payload or legacy root active payload was found.");
		}
		decodedPayload = decodeFirebaseObjectKeysRecursive_(rootNode);
		source = "firebase:/ (legacy-root)";
	}

	const repaired = buildManualCleanupActivePayload_(decodedPayload);
	const rosterData = repaired.rosterData;
	const metricEntryCount = countPlayerMetricsEntries_(rosterData && rosterData.playerMetrics);

	if (source === "firebase:/ (legacy-root)") {
		firebaseRootRequestJson_("PUT", {
			active: encodeFirebaseObjectKeysRecursive_(rosterData),
			archive: {
				publish: {},
				autorefreshDaily: {},
			},
			meta: {
				layoutVersion: FIREBASE_LAYOUT_VERSION,
				manualSchemaCleanupAt: cleanupAt,
				manualSchemaCleanupSource: source,
				manualSchemaCleanupMetricEntryCount: metricEntryCount,
			},
		});
		updateActiveRosterDataCaches_(JSON.stringify(rosterData));
	} else {
		writeValidatedActiveRosterDataToFirebase_(rosterData);
		firebaseRequestJson_(FIREBASE_META_PATH, "PATCH", {
			layoutVersion: FIREBASE_LAYOUT_VERSION,
			manualSchemaCleanupAt: cleanupAt,
			manualSchemaCleanupSource: source,
			manualSchemaCleanupMetricEntryCount: metricEntryCount,
		});
	}

	const counts = countRosterPayload_(rosterData);
	return {
		ok: true,
		cleanedAt: cleanupAt,
		source: source,
		activeLastUpdatedAt: String((rosterData && rosterData.lastUpdatedAt) || "").trim(),
		rosterCount: Array.isArray(rosterData.rosters) ? rosterData.rosters.length : 0,
		playerCount: counts.playerCount,
		noteCount: counts.noteCount,
		metricEntryCount: metricEntryCount,
		convertedNoteFields: toNonNegativeInt_(repaired.stats && repaired.stats.convertedNoteFields),
		droppedPlayerFields: toNonNegativeInt_(repaired.stats && repaired.stats.droppedPlayerFields),
		droppedRosterMetricStores: toNonNegativeInt_(repaired.stats && repaired.stats.droppedRosterMetricStores),
		migratedRootMetrics: !!(repaired.stats && repaired.stats.migratedRootMetrics),
	};
}

// Called from client.js via google.script.run (no CORS, short cache with Firebase backend)

function updateActiveRosterDataCaches_(text) {
	const cache = getScriptCacheSafe_();
	const payloadText = String(text == null ? "" : text);
	const cacheKey = buildAssetTextCacheKey_(ACTIVE_ROSTER_FILENAME);
	// Ensure successful Firebase writes never leave an older active-roster cache value behind.
	removeStringFromCache_(cache, cacheKey);
	maybeCacheText_(cache, cacheKey, payloadText, getAssetTextCacheTtlSeconds_(ACTIVE_ROSTER_FILENAME), {
		maxChars: CACHE_SAFE_TEXT_MAX_CHARS,
		logOversize: true,
	});
}

// PUT an active roster payload to Firebase without touching caches.
// This is the final active write boundary, so it re-validates the contract even
// when callers believe they already hold validated data.
function putValidatedActiveRosterDataToFirebase_(validatedRosterData) {
	const validated = validateRosterData_(validatedRosterData);
	const encodedPayload = encodeFirebaseObjectKeysRecursive_(validated);
	firebaseRequestJson_(FIREBASE_ACTIVE_PATH, "PUT", encodedPayload);
	const payloadText = JSON.stringify(validated);
	return { rosterData: validated, text: payloadText };
}

// Handle write already-validated active roster data to Firebase.
function writeValidatedActiveRosterDataToFirebase_(validatedRosterData) {
	const writeResult = putValidatedActiveRosterDataToFirebase_(validatedRosterData);
	updateActiveRosterDataCaches_(writeResult.text);
	return writeResult;
}

// Get server date string.
function getServerDateString_(dateRaw) {
	const date = dateRaw instanceof Date ? dateRaw : new Date();
	const timezone = Session.getScriptTimeZone ? Session.getScriptTimeZone() : "Etc/UTC";
	return Utilities.formatDate(date, timezone, "yyyy-MM-dd");
}

// Get server month key.
function getServerMonthKey_(dateRaw) {
	const date = dateRaw instanceof Date ? dateRaw : new Date();
	const timezone = Session.getScriptTimeZone ? Session.getScriptTimeZone() : "Etc/UTC";
	return Utilities.formatDate(date, timezone, "yyyy-MM");
}

// Parse iso to ms.
function parseIsoToMs_(isoRaw) {
	const text = String(isoRaw == null ? "" : isoRaw).trim();
	if (!text) return 0;
	let normalized = text;
	const clashTimestampMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.(\d{3}))?Z$/.exec(text);
	if (clashTimestampMatch) {
		normalized =
			clashTimestampMatch[1] +
			"-" +
			clashTimestampMatch[2] +
			"-" +
			clashTimestampMatch[3] +
			"T" +
			clashTimestampMatch[4] +
			":" +
			clashTimestampMatch[5] +
			":" +
			clashTimestampMatch[6] +
			"." +
			(clashTimestampMatch[7] || "000") +
			"Z";
	}
	const ms = new Date(normalized).getTime();
	return isFinite(ms) ? ms : 0;
}

// Build safe publish archive key.
function buildSafePublishArchiveKey_(timestampRaw) {
	const date = timestampRaw ? new Date(timestampRaw) : new Date();
	const safeDate = isFinite(date.getTime()) ? date : new Date();
	const prefix = Utilities.formatDate(safeDate, "Etc/UTC", "yyyyMMdd'T'HHmmss_SSS'Z'");
	return prefix + "_" + Utilities.getUuid().slice(0, 8);
}

// Build Firebase child path.
function buildFirebaseChildPath_(parentPathRaw, keyRaw) {
	const parentPath = normalizeFirebasePath_(parentPathRaw);
	const key = String(keyRaw == null ? "" : keyRaw).trim();
	if (!key) return parentPath;
	return parentPath ? parentPath + "/" + key : key;
}

// Handle read Firebase map object.
function readFirebaseMapObject_(pathRaw) {
	const payload = firebaseRequestJson_(pathRaw, "GET");
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
	return payload;
}

// Handle list Firebase child keys.
function listFirebaseChildKeys_(pathRaw) {
	return Object.keys(readFirebaseMapObject_(pathRaw));
}

// Handle write archived roster payload.
function writeArchivedRosterPayload_(pathRaw, rosterDataRaw) {
	const validated = validateRosterData_(rosterDataRaw);
	const encoded = encodeFirebaseObjectKeysRecursive_(validated);
	firebaseRequestJson_(pathRaw, "PUT", encoded);
	return validated;
}

// Create a publish archive backup from snapshot.
function createPublishArchiveBackupFromSnapshot_(sourceSnapshotRaw, timestampRaw) {
	const sourceSnapshot = sourceSnapshotRaw && typeof sourceSnapshotRaw === "object" ? sourceSnapshotRaw : null;
	if (!sourceSnapshot || !sourceSnapshot.rosterData) {
		return { created: false, key: "" };
	}
	const key = buildSafePublishArchiveKey_(timestampRaw);
	const path = buildFirebaseChildPath_(FIREBASE_ARCHIVE_PUBLISH_PATH, key);
	writeArchivedRosterPayload_(path, sourceSnapshot.rosterData);
	return { created: true, key: key };
}

// Clean up publish archive backups.
function cleanupPublishArchiveBackups_() {
	const keys = listFirebaseChildKeys_(FIREBASE_ARCHIVE_PUBLISH_PATH)
		.filter((key) => key)
		.sort()
		.reverse();
	let deletedCount = 0;
	for (let i = FIREBASE_PUBLISH_ARCHIVE_KEEP_COUNT; i < keys.length; i++) {
		firebaseRequestJson_(buildFirebaseChildPath_(FIREBASE_ARCHIVE_PUBLISH_PATH, keys[i]), "DELETE");
		deletedCount++;
	}
	return deletedCount;
}

// Create an auto refresh daily archive if needed.
function createAutoRefreshDailyArchiveIfNeeded_(dateStringRaw, rosterDataRaw) {
	const archiveDate = String(dateStringRaw == null ? "" : dateStringRaw).trim() || getServerDateString_(new Date());
	if (!/^\d{4}-\d{2}-\d{2}$/.test(archiveDate)) {
		return { created: false, existed: false, archiveDate: "", key: "" };
	}
	const path = buildFirebaseChildPath_(FIREBASE_ARCHIVE_AUTOREFRESH_DAILY_PATH, archiveDate);
	const existing = firebaseRequestJson_(path, "GET");
	if (existing && typeof existing === "object" && !Array.isArray(existing)) {
		return { created: false, existed: true, archiveDate: archiveDate, key: archiveDate };
	}
	writeArchivedRosterPayload_(path, rosterDataRaw);
	return { created: true, existed: false, archiveDate: archiveDate, key: archiveDate };
}

// Clean up old auto refresh daily archives.
function cleanupOldAutoRefreshDailyArchives_() {
	const keys = listFirebaseChildKeys_(FIREBASE_ARCHIVE_AUTOREFRESH_DAILY_PATH)
		.filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key))
		.sort()
		.reverse();
	let deletedCount = 0;
	for (let i = FIREBASE_AUTOREFRESH_DAILY_KEEP_COUNT; i < keys.length; i++) {
		firebaseRequestJson_(buildFirebaseChildPath_(FIREBASE_ARCHIVE_AUTOREFRESH_DAILY_PATH, keys[i]), "DELETE");
		deletedCount++;
	}
	return deletedCount;
}

// Find latest auto refresh archive date.
function findLatestAutoRefreshArchiveDate_() {
	const keys = listFirebaseChildKeys_(FIREBASE_ARCHIVE_AUTOREFRESH_DAILY_PATH)
		.filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key))
		.sort();
	return keys.length ? keys[keys.length - 1] : "";
}

// Mark active data write success.
function markActiveDataWriteSuccess_(timestampRaw, sourceRaw) {
	const timestamp = String(timestampRaw == null ? "" : timestampRaw).trim() || new Date().toISOString();
	const sourceText = String(sourceRaw == null ? "" : sourceRaw)
		.trim()
		.toLowerCase();
	const source =
		sourceText === ACTIVE_DATA_WRITE_SOURCE_PUBLISH ||
		sourceText === ACTIVE_DATA_WRITE_SOURCE_AUTO_REFRESH ||
		sourceText === ACTIVE_DATA_WRITE_SOURCE_DISCORD_SYNC
			? sourceText
			: ACTIVE_DATA_WRITE_SOURCE_UNKNOWN;
	const props = PropertiesService.getScriptProperties();
	props.setProperties(
		{
			[ACTIVE_DATA_LAST_SUCCESSFUL_WRITE_AT_PROPERTY]: timestamp,
			[ACTIVE_DATA_LAST_SUCCESSFUL_WRITE_SOURCE_PROPERTY]: source,
		},
		false,
	);
}

// Get last successful active write at.
function getLastSuccessfulActiveWriteAt_() {
	const props = PropertiesService.getScriptProperties();
	const text = String(props.getProperty(ACTIVE_DATA_LAST_SUCCESSFUL_WRITE_AT_PROPERTY) || "").trim();
	if (text) return text;
	try {
		const activeData = readActiveRosterData_();
		const fallback = String((activeData && activeData.lastUpdatedAt) || "").trim();
		if (!fallback) return "";
		props.setProperties(
			{
				[ACTIVE_DATA_LAST_SUCCESSFUL_WRITE_AT_PROPERTY]: fallback,
				[ACTIVE_DATA_LAST_SUCCESSFUL_WRITE_SOURCE_PROPERTY]: ACTIVE_DATA_WRITE_SOURCE_UNKNOWN,
			},
			false,
		);
		return fallback;
	} catch (err) {
		return "";
	}
}

// Get last successful active write source.
function getLastSuccessfulActiveWriteSource_() {
	const props = PropertiesService.getScriptProperties();
	const source = String(props.getProperty(ACTIVE_DATA_LAST_SUCCESSFUL_WRITE_SOURCE_PROPERTY) || "")
		.trim()
		.toLowerCase();
	if (
		source === ACTIVE_DATA_WRITE_SOURCE_PUBLISH ||
		source === ACTIVE_DATA_WRITE_SOURCE_AUTO_REFRESH ||
		source === ACTIVE_DATA_WRITE_SOURCE_DISCORD_SYNC
	)
		return source;
	return ACTIVE_DATA_WRITE_SOURCE_UNKNOWN;
}

// Return whether recent successful active write.
function isRecentSuccessfulActiveWrite_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const ignoreAutoRefreshWrites = options.ignoreAutoRefreshWrites === true;
	const lastWriteAt = getLastSuccessfulActiveWriteAt_();
	const lastWriteMs = parseIsoToMs_(lastWriteAt);
	if (!lastWriteMs) return false;
	if (ignoreAutoRefreshWrites) {
		const source = getLastSuccessfulActiveWriteSource_();
		if (source === ACTIVE_DATA_WRITE_SOURCE_AUTO_REFRESH) return false;
	}
	return Date.now() - lastWriteMs < AUTO_REFRESH_INTERVAL_MS;
}

// Handle replace active roster data.
function replaceActiveRosterData_(validatedRosterData, options) {
	const opts = options && typeof options === "object" ? options : {};
	let validated = validateRosterData_(validatedRosterData);
	let sourceSnapshot = opts.sourceSnapshot && typeof opts.sourceSnapshot === "object" ? opts.sourceSnapshot : null;
	if (!sourceSnapshot) {
		try {
			sourceSnapshot = readActiveRosterSnapshot_();
		} catch (err) {
			sourceSnapshot = null;
		}
	}
	const canonicalized = canonicalizeDiscordIdentityForRosterData_(validated, {
		sourceRosterData: sourceSnapshot && sourceSnapshot.rosterData,
		updatedAt: validated.lastUpdatedAt || new Date().toISOString(),
		source: opts.discordSource || "active-write",
		allowRosterCacheUsernameUpdates: opts.allowRosterCacheUsernameUpdates === true,
	});
	if (canonicalized && (canonicalized.updatedCanonical || canonicalized.updatedRosterCache)) {
		validated = validateRosterData_(canonicalized.rosterData);
	}
	const writeResult = writeValidatedActiveRosterDataToFirebase_(validated);

	return {
		replacedCount: sourceSnapshot ? 1 : 0,
		validatedRosterData: writeResult.rosterData,
		text: writeResult.text,
	};
}
