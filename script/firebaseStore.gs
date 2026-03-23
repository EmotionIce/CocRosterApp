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
		privateKey: String(getRequiredScriptProperty_("FIREBASE_PRIVATE_KEY")).replace(/\\n/g, "\n"),
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
	const signatureBytes = Utilities.computeRsaSha256Signature(unsignedToken, config.privateKey);
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
	const legacySnapshot = readLegacyRootActiveRosterSnapshotOrNull_();
	if (legacySnapshot) {
		return legacySnapshot;
	}
	throw new Error("Missing active roster payload at /active and no valid legacy root payload fallback was found.");
}

// Handle read active roster snapshot.
function readActiveRosterSnapshot_() {
	return readActiveRosterSnapshotFromFirebase_();
}

// Legacy wrapper kept to avoid breaking any indirect references.

function readActiveRosterData_() {
	return readActiveRosterSnapshot_().rosterData;
}

// Legacy wrapper kept to avoid breaking any indirect references.

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

// Handle write active roster data to Firebase.
function writeActiveRosterDataToFirebase_(rosterDataRaw) {
	const validated = validateRosterData_(rosterDataRaw);
	const encodedPayload = encodeFirebaseObjectKeysRecursive_(validated);
	firebaseRequestJson_(FIREBASE_ACTIVE_PATH, "PUT", encodedPayload);
	const payloadText = JSON.stringify(validated);
	updateActiveRosterDataCaches_(payloadText);
	return { rosterData: validated, text: payloadText };
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
	const ms = new Date(text).getTime();
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
function markActiveDataWriteSuccess_(timestampRaw) {
	const timestamp = String(timestampRaw == null ? "" : timestampRaw).trim() || new Date().toISOString();
	const props = PropertiesService.getScriptProperties();
	props.setProperty(ACTIVE_DATA_LAST_SUCCESSFUL_WRITE_AT_PROPERTY, timestamp);
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
		props.setProperty(ACTIVE_DATA_LAST_SUCCESSFUL_WRITE_AT_PROPERTY, fallback);
		return fallback;
	} catch (err) {
		return "";
	}
}

// Return whether recent successful active write.
function isRecentSuccessfulActiveWrite_() {
	const lastWriteAt = getLastSuccessfulActiveWriteAt_();
	const lastWriteMs = parseIsoToMs_(lastWriteAt);
	if (!lastWriteMs) return false;
	return Date.now() - lastWriteMs < AUTO_REFRESH_INTERVAL_MS;
}

// Handle replace active roster data.
function replaceActiveRosterData_(validatedRosterData, options) {
	const opts = options && typeof options === "object" ? options : {};
	const validated = validateRosterData_(validatedRosterData);
	let sourceSnapshot = opts.sourceSnapshot && typeof opts.sourceSnapshot === "object" ? opts.sourceSnapshot : null;
	if (!sourceSnapshot) {
		try {
			sourceSnapshot = readActiveRosterSnapshot_();
		} catch (err) {
			sourceSnapshot = null;
		}
	}
	const writeResult = writeActiveRosterDataToFirebase_(validated);

	return {
		replacedCount: sourceSnapshot ? 1 : 0,
		validatedRosterData: writeResult.rosterData,
		text: writeResult.text,
	};
}

// Legacy wrapper kept to avoid breaking any indirect references.
