const ASSET_TEXT_CACHE_VERSION = "v2";
const ASSET_TEXT_CACHE_TTL_ROSTER_SECONDS = 30;
const ASSET_TEXT_CACHE_TTL_STATIC_SECONDS = 600;
const ACTIVE_ROSTER_FILENAME = "roster-data.json";
const ACTIVE_ROSTER_JOB_LOCK_KEY = "ACTIVE_ROSTER_JOB_LOCK";
const ACTIVE_ROSTER_JOB_LOCK_WAIT_MS = 30 * 1000;
const ACTIVE_ROSTER_JOB_LOCK_LEASE_MS = 15 * 60 * 1000;
const ACTIVE_ROSTER_JOB_LOCK_POLL_MS = 250;
const AUTO_REFRESH_HANDLER_NAME = "autoRefreshActiveRosterTick";
const AUTO_REFRESH_INTERVAL_HOURS = 2;
const AUTO_REFRESH_INTERVAL_MS = AUTO_REFRESH_INTERVAL_HOURS * 60 * 60 * 1000;
const AUTO_REFRESH_ENABLED_PROPERTY = "AUTO_REFRESH_ENABLED";
const AUTO_REFRESH_TRIGGER_ID_PROPERTY = "AUTO_REFRESH_TRIGGER_ID";
const AUTO_REFRESH_LAST_RUN_STARTED_AT_PROPERTY = "AUTO_REFRESH_LAST_RUN_STARTED_AT";
const AUTO_REFRESH_LAST_RUN_FINISHED_AT_PROPERTY = "AUTO_REFRESH_LAST_RUN_FINISHED_AT";
const AUTO_REFRESH_LAST_RUN_STATUS_PROPERTY = "AUTO_REFRESH_LAST_RUN_STATUS";
const AUTO_REFRESH_LAST_RUN_SUMMARY_PROPERTY = "AUTO_REFRESH_LAST_RUN_SUMMARY";
const AUTO_REFRESH_LAST_ISSUE_SUMMARY_PROPERTY = "AUTO_REFRESH_LAST_ISSUE_SUMMARY";
const AUTO_REFRESH_LAST_RUN_ERROR_PROPERTY = "AUTO_REFRESH_LAST_RUN_ERROR";
const AUTO_REFRESH_LAST_RUN_ISSUE_COUNT_PROPERTY = "AUTO_REFRESH_LAST_RUN_ISSUE_COUNT";
const AUTO_REFRESH_LAST_ARCHIVE_DATE_PROPERTY = "AUTO_REFRESH_LAST_ARCHIVE_DATE";
const ACTIVE_DATA_LAST_SUCCESSFUL_WRITE_AT_PROPERTY = "ACTIVE_DATA_LAST_SUCCESSFUL_WRITE_AT";
const STATIC_ASSET_BASE_URL = "https://turtlecoc.4jbf82gng5.workers.dev/";
const FIREBASE_KEY_ENCODING_PREFIX = "__FB64__";
const FIREBASE_LAYOUT_VERSION = 2;
const FIREBASE_ACTIVE_PATH = "active";
const FIREBASE_ARCHIVE_PUBLISH_PATH = "archive/publish";
const FIREBASE_ARCHIVE_AUTOREFRESH_DAILY_PATH = "archive/autorefreshDaily";
const FIREBASE_META_PATH = "meta";
const FIREBASE_PUBLISH_ARCHIVE_KEEP_COUNT = 10;
const FIREBASE_AUTOREFRESH_DAILY_KEEP_COUNT = 2;
const FIREBASE_ACCESS_TOKEN_CACHE_KEY = "firebaseAccessToken:v1";
const FIREBASE_ACCESS_TOKEN_SCOPE = "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email";
const FIREBASE_ACCESS_TOKEN_TTL_SAFETY_SECONDS = 60;
const CACHE_SAFE_TEXT_MAX_CHARS = 90 * 1024;
let firebaseConfigCache_ = null;

function doGet(e) {
	const p = e && e.parameter ? e.parameter : {};
	const asset = p.asset ? String(p.asset) : "";
	if (asset) return serveAsset_(asset);
	const assetData = p.assetData ? String(p.assetData) : "";
	if (assetData) return serveMediaAssetData_(assetData);

	if (p.debug === "1") {
		const info = listFirebaseDataDebugInfo_();
		return ContentService.createTextOutput(JSON.stringify(info, null, 2)).setMimeType(ContentService.MimeType.JSON);
	}

	const buildStamp = new Date().toISOString();
	const baseUrl = ScriptApp.getService().getUrl();
	const staticBaseUrl = STATIC_ASSET_BASE_URL;

	if (String(p.page || "") === "admin") {
		const t = HtmlService.createTemplateFromFile("Admin");
		t.buildStamp = buildStamp;
		t.baseUrl = baseUrl;
		t.staticBaseUrl = staticBaseUrl;
		return t.evaluate().setTitle("Roster Admin").setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
	}

	const cloudflareStylesUrl = buildStaticAssetUrl_("styles.css", buildStamp);
	const cloudflareClientJsUrl = buildStaticAssetUrl_("client.js", buildStamp);
	const cloudflareAppHtml = getCloudflareTextAsset_("app.html", buildStamp);
	if (!cloudflareAppHtml) {
		return HtmlService.createHtmlOutput(
			[
				"<!doctype html>",
				"<html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>",
				"<title>CWL Roster</title></head>",
				"<body style='font-family:system-ui,sans-serif;padding:24px'>",
				"<h1>Static Shell Unavailable</h1>",
				"<p>Unable to load <code>app.html</code> from Cloudflare static origin.</p>",
				"<p>Try again shortly.</p>",
				"</body></html>",
			].join(""),
		).setTitle("CWL Roster");
	}
	const appHtmlSource = cloudflareAppHtml;
	const appHtml = String(appHtmlSource || "").replace(/__ADMIN_URL__/g, baseUrl + "?page=admin");
	const shouldInlineRosterData = /^(1|true|yes|on)$/i.test(String(p.inlineRosterData || p.inlineRoster || p.inline || "").trim());
	let inlineRosterData = null;
	if (shouldInlineRosterData) {
		const rosterDataText = getAssetText_(ACTIVE_ROSTER_FILENAME);
		if (rosterDataText) {
			try {
				inlineRosterData = JSON.parse(rosterDataText);
			} catch (err) {
				Logger.log("Unable to parse %s for inline bootstrap: %s", ACTIVE_ROSTER_FILENAME, err && (err.message || err.stack) ? err.message || err.stack : String(err));
			}
		}
	}
	const html = buildIndexHtml_({
		stylesUrl: cloudflareStylesUrl,
		appHtml: appHtml,
		clientJsUrl: cloudflareClientJsUrl,
		buildStamp: buildStamp,
		baseUrl: baseUrl,
		staticBaseUrl: staticBaseUrl,
		inlineRosterData: inlineRosterData,
	});

	return HtmlService.createHtmlOutput(html).setTitle("CWL Roster").setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function buildIndexHtml_(view) {
	const model = view && typeof view === "object" ? view : {};
	const stylesUrl = typeof model.stylesUrl === "string" ? model.stylesUrl : "";
	const appHtml = typeof model.appHtml === "string" ? model.appHtml : "";
	const clientJsUrl = typeof model.clientJsUrl === "string" ? model.clientJsUrl : "";
	const buildStamp = typeof model.buildStamp === "string" ? model.buildStamp : "";
	const baseUrl = typeof model.baseUrl === "string" ? model.baseUrl : "";
	const staticBaseUrl = typeof model.staticBaseUrl === "string" ? model.staticBaseUrl : "";
	const inlineRosterData = model && typeof model.inlineRosterData === "object" && model.inlineRosterData ? model.inlineRosterData : null;
	const inlineRosterScriptJson = serializeJsonForScriptEmbedding_(inlineRosterData);

	return [
		"<!doctype html>",
		"<html>",
		"",
		"<head>",
		'    <meta charset="utf-8" />',
		'    <meta name="viewport" content="width=device-width, initial-scale=1" />',
		"    <title>CWL Roster</title>",
		'    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />',
		'    <meta http-equiv="Pragma" content="no-cache" />',
		'    <meta http-equiv="Expires" content="0" />',
		'    <meta name="build-stamp" content="' + escapeHtmlAttribute_(buildStamp) + '" />',
		'    <link rel="stylesheet" href="' + escapeHtmlAttribute_(stylesUrl) + '" />',
		"</head>",
		"",
		'<body style="margin:0;">',
		'    <div id="app">',
		appHtml,
		"    </div>",
		"",
		"    <script>",
		"        // useful for debugging caching in devtools",
		"        window.BUILD_STAMP = " + JSON.stringify(buildStamp) + ";",
		"        window.ROSTER_BASE_URL = " + JSON.stringify(baseUrl) + ";",
		"        window.ROSTER_STATIC_BASE_URL = " + JSON.stringify(staticBaseUrl) + ";",
		"        window.__ROSTER_DATA__ = " + inlineRosterScriptJson + ";",
		"    </script>",
		"",
		'    <script defer src="' + escapeHtmlAttribute_(clientJsUrl) + '"></script>',
		"</body>",
		"",
		"</html>",
	].join("\n");
}

function buildScriptAssetUrl_(baseUrlRaw, assetNameRaw) {
	const baseUrl = String(baseUrlRaw == null ? "" : baseUrlRaw).trim();
	const assetName = String(assetNameRaw == null ? "" : assetNameRaw)
		.trim()
		.replace(/^[\/\\]+/, "")
		.replace(/\.\./g, "");
	if (!baseUrl || !assetName) return "";
	const sep = baseUrl.indexOf("?") >= 0 ? "&" : "?";
	return baseUrl + sep + "asset=" + encodeURIComponent(assetName);
}

function buildStaticAssetUrl_(relativePathRaw, versionRaw) {
	const baseUrl = String(STATIC_ASSET_BASE_URL == null ? "" : STATIC_ASSET_BASE_URL).trim().replace(/[\/\\]+$/, "");
	const relativePath = String(relativePathRaw == null ? "" : relativePathRaw)
		.trim()
		.replace(/^[\/\\]+/, "")
		.replace(/\.\./g, "")
		.replace(/\\/g, "/");
	if (!baseUrl || !relativePath) return "";
	let url = baseUrl + "/" + relativePath;
	const version = String(versionRaw == null ? "" : versionRaw).trim();
	if (version) {
		const sep = url.indexOf("?") >= 0 ? "&" : "?";
		url += sep + "v=" + encodeURIComponent(version);
	}
	return url;
}

function getCloudflareTextAsset_(relativePathRaw, versionRaw) {
	const url = buildStaticAssetUrl_(relativePathRaw, versionRaw);
	if (!url) return "";
	try {
		const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
		const code = response && typeof response.getResponseCode === "function" ? Number(response.getResponseCode()) : 0;
		if (!code || code < 200 || code >= 300) return "";
		const text = response && typeof response.getContentText === "function" ? String(response.getContentText() || "") : "";
		return text.trim() ? text : "";
	} catch (err) {
		Logger.log("Cloudflare static fetch failed for %s: %s", url, err && (err.message || err.stack) ? err.message || err.stack : String(err));
		return "";
	}
}

function getRequiredScriptProperty_(keyRaw) {
	const key = String(keyRaw == null ? "" : keyRaw).trim();
	if (!key) throw new Error("Missing Script Property key.");
	const value = String(PropertiesService.getScriptProperties().getProperty(key) || "");
	if (!value.trim()) throw new Error("Missing Script Property " + key + ".");
	return value;
}

function normalizeFirebaseDbUrl_(urlRaw) {
	const raw = String(urlRaw == null ? "" : urlRaw).trim();
	if (!raw) return "";
	return raw.replace(/\/+$/, "");
}

function normalizeFirebasePath_(pathRaw) {
	return String(pathRaw == null ? "" : pathRaw)
		.trim()
		.replace(/\\/g, "/")
		.replace(/^[\/]+|[\/]+$/g, "")
		.replace(/\.\./g, "");
}

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

function buildFirebaseRootJsonUrl_(dbUrlRaw) {
	return buildFirebaseJsonUrl_(dbUrlRaw, "");
}

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

function utf8StringToBytes_(valueRaw) {
	return Utilities.newBlob(String(valueRaw == null ? "" : valueRaw)).getBytes();
}

function utf8BytesToString_(bytesRaw) {
	return Utilities.newBlob(bytesRaw || []).getDataAsString("UTF-8");
}

function base64UrlEncodeBytes_(bytesRaw) {
	return Utilities.base64EncodeWebSafe(bytesRaw || []).replace(/=+$/g, "");
}

function base64UrlEncodeUtf8_(valueRaw) {
	return base64UrlEncodeBytes_(utf8StringToBytes_(valueRaw));
}

function base64UrlDecodeToUtf8_(valueRaw) {
	let value = String(valueRaw == null ? "" : valueRaw).trim();
	if (!value) return "";
	const mod = value.length % 4;
	if (mod === 1) throw new Error("Invalid base64url payload length.");
	if (mod > 0) value += "====".slice(mod);
	const decoded = Utilities.base64DecodeWebSafe(value);
	return utf8BytesToString_(decoded);
}

function needsFirebaseKeyEncoding_(keyRaw) {
	const key = String(keyRaw == null ? "" : keyRaw);
	if (!key) return true;
	if (key.indexOf(FIREBASE_KEY_ENCODING_PREFIX) === 0) return true;
	if (/[.$#[\]\/]/.test(key)) return true;
	if (/[\u0000-\u001F\u007F]/.test(key)) return true;
	return false;
}

function encodeFirebaseObjectKey_(keyRaw) {
	const key = String(keyRaw == null ? "" : keyRaw);
	if (!needsFirebaseKeyEncoding_(key)) return key;
	return FIREBASE_KEY_ENCODING_PREFIX + base64UrlEncodeUtf8_(key);
}

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

function clearFirebaseAccessTokenCache_() {
	const cache = getScriptCacheSafe_();
	removeStringFromCache_(cache, FIREBASE_ACCESS_TOKEN_CACHE_KEY);
}

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

function firebaseRequestJson_(pathRaw, methodRaw, payloadRaw) {
	const path = normalizeFirebasePath_(pathRaw);
	const method = String(methodRaw == null ? "GET" : methodRaw).trim().toUpperCase();
	if (!method) throw new Error("Firebase request method is required.");
	const url = buildFirebaseJsonUrl_(getFirebaseConfig_().dbUrl, path);

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

function firebaseRootRequestJson_(methodRaw, payloadRaw) {
	return firebaseRequestJson_("", methodRaw, payloadRaw);
}

function escapeHtmlAttribute_(value) {
	return String(value == null ? "" : value)
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function serializeJsonForScriptEmbedding_(value) {
	return JSON.stringify(value == null ? null : value).replace(/</g, "\\u003c");
}

function escapeInlineScriptText_(value) {
	return String(value == null ? "" : value).replace(/<\/script/gi, "<\\/script");
}

function errorMessage_(err) {
	return err && (err.message || err.stack) ? err.message || err.stack : String(err);
}

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

function readLegacyRootActiveRosterSnapshotOrNull_() {
	const encodedRoot = firebaseRootRequestJson_("GET");
	if (!encodedRoot || typeof encodedRoot !== "object" || Array.isArray(encodedRoot)) return null;
	try {
		return decodeAndValidateActiveRosterPayload_(encodedRoot, "firebase:/ (legacy-root)");
	} catch (err) {
		return null;
	}
}

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

function readActiveRosterSnapshot_() {
	return readActiveRosterSnapshotFromFirebase_();
}

// Legacy wrapper kept to avoid breaking any indirect references.
function readActiveRosterSnapshotFromDrive_() {
	return readActiveRosterSnapshot_();
}

function readActiveRosterData_() {
	return readActiveRosterSnapshot_().rosterData;
}

// Legacy wrapper kept to avoid breaking any indirect references.
function readActiveRosterDataFromDrive_() {
	return readActiveRosterData_();
}

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

function getTownHallIconData(levelRaw) {
	const level = toNonNegativeInt_(levelRaw);
	if (level < 1 || level > 18) {
		throw new Error("Invalid Town Hall level.");
	}

	const cache = CacheService.getScriptCache();
	const cacheKey = "townHallIcon:" + level;
	const cached = cache.get(cacheKey);
	if (cached) {
		try {
			const parsed = JSON.parse(cached);
			if (parsed && parsed.ok && Number(parsed.level) === level && parsed.dataUrl) {
				return parsed;
			}
		} catch (err) {
			Logger.log("Ignoring invalid Town Hall icon cache for level %s: %s", level, err && err.message ? err.message : String(err));
		}
	}

	const assetPath = "assets/icons/th" + level + ".webp";
	const url = buildStaticAssetUrl_(assetPath);
	const payload = {
		ok: !!url,
		level: level,
		assetPath: assetPath,
		fileName: "th" + level + ".webp",
		mimeType: "image/webp",
		dataUrl: url || "",
	};

	try {
		cache.put(cacheKey, JSON.stringify(payload), TOWN_HALL_ICON_CACHE_TTL_SECONDS);
	} catch (cacheErr) {
		Logger.log("Unable to cache Town Hall icon for level %s: %s", level, cacheErr && cacheErr.message ? cacheErr.message : String(cacheErr));
	}

	return payload;
}

function normalizeImageAssetPath_(assetPathRaw) {
	return String(assetPathRaw == null ? "" : assetPathRaw)
		.trim()
		.replace(/^[\/\\]+/, "")
		.replace(/\.\./g, "")
		.replace(/\\/g, "/")
		.replace(/^drive\//i, "");
}

function pickMostRecentlyUpdatedFile_(filesRaw) {
	const files = Array.isArray(filesRaw) ? filesRaw : [];
	let newest = null;
	let newestMs = 0;
	for (let i = 0; i < files.length; i++) {
		const file = files[i];
		if (!file) continue;
		const updatedMs = file.getLastUpdated ? file.getLastUpdated().getTime() : 0;
		if (!newest || updatedMs >= newestMs) {
			newest = file;
			newestMs = updatedMs;
		}
	}
	return newest;
}

function findFileByRelativePathCaseInsensitive_(pathRaw) {
	return null;
}

function findFileByNameRecursivelyCaseInsensitive_(filenameRaw) {
	return null;
}

function findImageAssetFile_(assetPathRaw) {
	const safeAssetPath = normalizeImageAssetPath_(assetPathRaw);
	if (!safeAssetPath) return { assetPath: "", file: null };

	const baseName = safeAssetPath.split(/[\/\\]/).pop() || safeAssetPath;
	const pathCandidates = [];
	const seenCandidates = {};
	const pushPathCandidate = (valueRaw) => {
		const value = normalizeImageAssetPath_(valueRaw);
		if (!value || seenCandidates[value]) return;
		seenCandidates[value] = true;
		pathCandidates.push(value);
	};

	pushPathCandidate(safeAssetPath);
	pushPathCandidate(String(safeAssetPath).toLowerCase());
	if (baseName) {
		pushPathCandidate("assets/images/" + baseName);
		pushPathCandidate("assets/Images/" + baseName);
	}

	for (let i = 0; i < pathCandidates.length; i++) {
		const candidate = pathCandidates[i];
		const file = findFileByRelativePath_(candidate) || findFileByRelativePathCaseInsensitive_(candidate);
		if (file) return { assetPath: safeAssetPath, file: file };
	}

	const byName = findFirstFileByNameCandidates_([safeAssetPath, baseName]);
	if (byName) return { assetPath: safeAssetPath, file: byName };

	const deepByName = findFileByNameRecursivelyCaseInsensitive_(baseName);
	if (deepByName) return { assetPath: safeAssetPath, file: deepByName };

	return { assetPath: safeAssetPath, file: null };
}

function isSupportedMediaAssetExtension_(assetPathRaw) {
	const safeAssetPath = normalizeImageAssetPath_(assetPathRaw);
	return /\.(gif|png|jpe?g|we?bp|webm|mp4|ogv)$/i.test(safeAssetPath);
}

function isSupportedMediaMimeType_(mimeTypeRaw) {
	const mimeType = String(mimeTypeRaw == null ? "" : mimeTypeRaw).trim().toLowerCase();
	if (!mimeType) return false;
	return String(mimeType).indexOf("image/") === 0 || String(mimeType).indexOf("video/") === 0;
}

function getMediaAssetData(assetPathRaw) {
	const safeAssetPath = normalizeImageAssetPath_(assetPathRaw);
	if (!safeAssetPath) {
		return { ok: false, assetPath: "", dataUrl: "", fileName: "", mimeType: "" };
	}

	if (!isSupportedMediaAssetExtension_(safeAssetPath)) {
		return { ok: false, assetPath: safeAssetPath, dataUrl: "", fileName: "", mimeType: "" };
	}

	const fileName = safeAssetPath.split(/[\/\\]/).pop() || safeAssetPath;
	const mimeType = inferAssetMimeType_(fileName, "");
	if (!isSupportedMediaMimeType_(mimeType)) return { ok: false, assetPath: safeAssetPath, dataUrl: "", fileName: fileName, mimeType: String(mimeType || "") };
	const url = buildStaticAssetUrl_(safeAssetPath);
	const payload = {
		ok: !!url,
		assetPath: safeAssetPath,
		fileName: fileName,
		mimeType: mimeType,
		dataUrl: url || "",
		url: url || "",
	};
	return payload;
}

function getImageAssetData(assetPathRaw) {
	const safeAssetPath = normalizeImageAssetPath_(assetPathRaw);
	if (!safeAssetPath) {
		return { ok: false, assetPath: "", dataUrl: "", fileName: "", mimeType: "" };
	}

	const payload = getMediaAssetData(safeAssetPath);
	if (!payload || !payload.ok) {
		return {
			ok: false,
			assetPath: safeAssetPath,
			dataUrl: "",
			fileName: payload && payload.fileName ? payload.fileName : "",
			mimeType: payload && payload.mimeType ? payload.mimeType : "",
		};
	}
	if (String(payload.mimeType || "").indexOf("image/") !== 0) {
		return {
			ok: false,
			assetPath: safeAssetPath,
			dataUrl: "",
			fileName: payload.fileName || "",
			mimeType: payload.mimeType || "",
		};
	}
	return payload;
}

function normalizeLeagueFamilyKey_(value) {
	const raw = String(value == null ? "" : value)
		.trim()
		.toLowerCase();
	if (!raw) return "";
	const normalized = typeof raw.normalize === "function" ? raw.normalize("NFKD") : raw;
	return normalized.replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
}

function normalizeLeagueMatchText_(value) {
	const raw = String(value == null ? "" : value)
		.trim()
		.toLowerCase();
	if (!raw) return "";
	const normalized = typeof raw.normalize === "function" ? raw.normalize("NFKD") : raw;
	return normalized
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function resolveHomeLeagueAssetFamily_(leagueNameRaw) {
	const text = normalizeLeagueMatchText_(leagueNameRaw);
	const compact = normalizeLeagueFamilyKey_(leagueNameRaw);
	if (!text) return "";
	const hasWord = (word) => new RegExp("(^|\\s)" + String(word) + "(\\s|$)").test(text);
	const hasCompact = (fragment) => compact.indexOf(String(fragment)) >= 0;
	if (hasWord("unranked")) return "unranked";
	if (hasWord("skeleton")) return "skeleton";
	if (hasWord("barbarian")) return "barbarian";
	if (hasWord("archer")) return "archer";
	if (hasWord("wizard")) return "wizard";
	if (hasWord("valkyrie")) return "valkyrie";
	if (hasWord("witch")) return "witch";
	if (hasWord("golem")) return "golem";
	if (hasWord("pekka") || hasCompact("pekka")) return "pekka";
	if (hasWord("titan")) return "titan";
	if (hasWord("electro")) return "electro";
	if (hasWord("dragon")) return "dragon";
	if (hasWord("legend")) return "legend";
	return "";
}

function getHomeLeagueAssetPath_(leagueNameRaw) {
	const family = resolveHomeLeagueAssetFamily_(leagueNameRaw);
	if (family === "unranked") return "assets/icons/league-unranked.webp";
	if (family === "skeleton") return "assets/icons/league-skeleton.webp";
	if (family === "barbarian") return "assets/icons/league-barbarian.webp";
	if (family === "archer") return "assets/icons/league-archer.webp";
	if (family === "wizard") return "assets/icons/league-wizard.webp";
	if (family === "valkyrie") return "assets/icons/league-valkyrie.webp";
	if (family === "witch") return "assets/icons/league-witch.webp";
	if (family === "golem") return "assets/icons/league-golem.webp";
	if (family === "pekka") return "assets/icons/league-pekka.webp";
	if (family === "titan") return "assets/icons/league-titan.webp";
	if (family === "dragon") return "assets/icons/league-dragon.webp";
	if (family === "electro") return "assets/icons/league-electro.webp";
	if (family === "legend") return "assets/icons/league-legend.webp";
	return "";
}

function getLeagueIconData(leagueNameRaw) {
	const leagueName = String(leagueNameRaw == null ? "" : leagueNameRaw).trim();
	const family = resolveHomeLeagueAssetFamily_(leagueName);
	const assetPath = getHomeLeagueAssetPath_(leagueName);
	if (!assetPath) {
		Logger.log("No local league icon mapping for league name '%s'.", leagueName);
		return { ok: false, leagueName: leagueName, family: family, assetPath: "", dataUrl: "", fileName: "" };
	}

	const key = normalizeLeagueFamilyKey_(family) || assetPath;
	const url = buildStaticAssetUrl_(assetPath);
	const baseName = assetPath.split(/[\/\\]/).pop() || "";
	const payload = {
		ok: !!url,
		key: key,
		leagueName: leagueName,
		family: family,
		assetPath: assetPath,
		fileName: baseName,
		mimeType: "image/webp",
		dataUrl: url || "",
	};

	return payload;
}

function parseActiveRosterJobLockState_(raw) {
	const text = String(raw == null ? "" : raw).trim();
	if (!text) return null;
	try {
		const parsed = JSON.parse(text);
		const token = String((parsed && parsed.token) || "").trim();
		const owner = String((parsed && parsed.owner) || "").trim();
		const expiresAt = Number(parsed && parsed.expiresAt);
		if (!token || !isFinite(expiresAt)) return null;
		return {
			token: token,
			owner: owner,
			expiresAt: Math.floor(expiresAt),
		};
	} catch (err) {
		return null;
	}
}

function tryAcquireActiveRosterJobLock_(ownerRaw, waitMsRaw) {
	const owner = String(ownerRaw == null ? "unknown" : ownerRaw).trim() || "unknown";
	const waitMs = Math.max(0, Number(waitMsRaw) || 0);
	const deadlineMs = Date.now() + waitMs;
	const props = PropertiesService.getScriptProperties();
	const token = Utilities.getUuid();
	let acquired = false;

	while (!acquired) {
		const scriptLock = LockService.getScriptLock();
		const remainingMs = waitMs > 0 ? Math.max(250, deadlineMs - Date.now()) : 250;
		const didLock = scriptLock.tryLock(Math.min(5000, remainingMs));
		if (!didLock) {
			if (waitMs <= 0 || Date.now() >= deadlineMs) break;
			Utilities.sleep(ACTIVE_ROSTER_JOB_LOCK_POLL_MS);
			continue;
		}

		try {
			const nowMs = Date.now();
			const current = parseActiveRosterJobLockState_(props.getProperty(ACTIVE_ROSTER_JOB_LOCK_KEY));
			if (!current || current.expiresAt <= nowMs) {
				props.setProperty(
					ACTIVE_ROSTER_JOB_LOCK_KEY,
					JSON.stringify({
						token: token,
						owner: owner,
						expiresAt: nowMs + ACTIVE_ROSTER_JOB_LOCK_LEASE_MS,
					}),
				);
				acquired = true;
			}
		} finally {
			scriptLock.releaseLock();
		}

		if (acquired) {
			return { token: token, owner: owner };
		}
		if (waitMs <= 0 || Date.now() >= deadlineMs) break;
		Utilities.sleep(ACTIVE_ROSTER_JOB_LOCK_POLL_MS);
	}
	return null;
}

function releaseActiveRosterJobLock_(tokenRaw) {
	const token = String(tokenRaw == null ? "" : tokenRaw).trim();
	if (!token) return false;
	const props = PropertiesService.getScriptProperties();
	const scriptLock = LockService.getScriptLock();
	const didLock = scriptLock.tryLock(5000);
	if (!didLock) return false;
	try {
		const current = parseActiveRosterJobLockState_(props.getProperty(ACTIVE_ROSTER_JOB_LOCK_KEY));
		if (current && current.token === token) {
			props.deleteProperty(ACTIVE_ROSTER_JOB_LOCK_KEY);
			return true;
		}
		return false;
	} finally {
		scriptLock.releaseLock();
	}
}

function withActiveRosterJobLock_(ownerRaw, waitMsRaw, callback) {
	if (typeof callback !== "function") {
		throw new Error("Active roster job callback is required.");
	}
	const acquired = tryAcquireActiveRosterJobLock_(ownerRaw, waitMsRaw);
	if (!acquired) {
		throw new Error("Another active roster refresh/publish flow is running. Please wait and try again.");
	}
	try {
		return callback();
	} finally {
		releaseActiveRosterJobLock_(acquired.token);
	}
}

function updateActiveRosterDataCaches_(text) {
	const cache = getScriptCacheSafe_();
	const payloadText = String(text == null ? "" : text);
	maybeCacheText_(cache, buildAssetTextCacheKey_(ACTIVE_ROSTER_FILENAME), payloadText, getAssetTextCacheTtlSeconds_(ACTIVE_ROSTER_FILENAME), {
		maxChars: CACHE_SAFE_TEXT_MAX_CHARS,
		logOversize: true,
	});
}

function writeActiveRosterDataToFirebase_(rosterDataRaw) {
	const validated = validateRosterData_(rosterDataRaw);
	const encodedPayload = encodeFirebaseObjectKeysRecursive_(validated);
	firebaseRequestJson_(FIREBASE_ACTIVE_PATH, "PUT", encodedPayload);
	const payloadText = JSON.stringify(validated);
	updateActiveRosterDataCaches_(payloadText);
	return { rosterData: validated, text: payloadText };
}

function getServerDateString_(dateRaw) {
	const date = dateRaw instanceof Date ? dateRaw : new Date();
	const timezone = Session.getScriptTimeZone ? Session.getScriptTimeZone() : "Etc/UTC";
	return Utilities.formatDate(date, timezone, "yyyy-MM-dd");
}

function getServerMonthKey_(dateRaw) {
	const date = dateRaw instanceof Date ? dateRaw : new Date();
	const timezone = Session.getScriptTimeZone ? Session.getScriptTimeZone() : "Etc/UTC";
	return Utilities.formatDate(date, timezone, "yyyy-MM");
}

function parseIsoToMs_(isoRaw) {
	const text = String(isoRaw == null ? "" : isoRaw).trim();
	if (!text) return 0;
	const ms = new Date(text).getTime();
	return isFinite(ms) ? ms : 0;
}

function buildSafePublishArchiveKey_(timestampRaw) {
	const date = timestampRaw ? new Date(timestampRaw) : new Date();
	const safeDate = isFinite(date.getTime()) ? date : new Date();
	const prefix = Utilities.formatDate(safeDate, "Etc/UTC", "yyyyMMdd'T'HHmmss_SSS'Z'");
	return prefix + "_" + Utilities.getUuid().slice(0, 8);
}

function buildFirebaseChildPath_(parentPathRaw, keyRaw) {
	const parentPath = normalizeFirebasePath_(parentPathRaw);
	const key = String(keyRaw == null ? "" : keyRaw).trim();
	if (!key) return parentPath;
	return parentPath ? parentPath + "/" + key : key;
}

function readFirebaseMapObject_(pathRaw) {
	const payload = firebaseRequestJson_(pathRaw, "GET");
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
	return payload;
}

function listFirebaseChildKeys_(pathRaw) {
	return Object.keys(readFirebaseMapObject_(pathRaw));
}

function writeArchivedRosterPayload_(pathRaw, rosterDataRaw) {
	const validated = validateRosterData_(rosterDataRaw);
	const encoded = encodeFirebaseObjectKeysRecursive_(validated);
	firebaseRequestJson_(pathRaw, "PUT", encoded);
	return validated;
}

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

function findLatestAutoRefreshArchiveDate_() {
	const keys = listFirebaseChildKeys_(FIREBASE_ARCHIVE_AUTOREFRESH_DAILY_PATH)
		.filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key))
		.sort();
	return keys.length ? keys[keys.length - 1] : "";
}

function listFirebaseDataDebugInfo_() {
	let activeExists = false;
	let activeLastUpdatedAt = "";
	let hasLegacyRootPayload = false;
	try {
		const activeSnapshot = readActiveRosterSnapshotFromFirebase_();
		activeExists = !!(activeSnapshot && activeSnapshot.rosterData);
		activeLastUpdatedAt = String((activeSnapshot && activeSnapshot.rosterData && activeSnapshot.rosterData.lastUpdatedAt) || "").trim();
		hasLegacyRootPayload = activeSnapshot && activeSnapshot.source === "firebase:/ (legacy-root)";
	} catch (err) {}
	return {
		activePath: FIREBASE_ACTIVE_PATH,
		activeExists: activeExists,
		activeLastUpdatedAt: activeLastUpdatedAt,
		hasLegacyRootPayload: hasLegacyRootPayload,
		publishArchiveCount: listFirebaseChildKeys_(FIREBASE_ARCHIVE_PUBLISH_PATH).length,
		autorefreshDailyCount: listFirebaseChildKeys_(FIREBASE_ARCHIVE_AUTOREFRESH_DAILY_PATH).length,
		latestAutorefreshDailyArchiveDate: findLatestAutoRefreshArchiveDate_(),
	};
}

function normalizeActiveRosterForCompare_(rosterDataRaw) {
	const validated = validateRosterData_(rosterDataRaw);
	return JSON.stringify({
		schemaVersion: validated.schemaVersion,
		pageTitle: validated.pageTitle,
		rosterOrder: validated.rosterOrder,
		rosters: validated.rosters,
		playerMetrics: validated.playerMetrics,
	});
}

function hasActiveRosterPayloadChanged_(beforeRaw, afterRaw) {
	return normalizeActiveRosterForCompare_(beforeRaw) !== normalizeActiveRosterForCompare_(afterRaw);
}

function withRosterLastUpdatedAt_(rosterDataRaw, timestampRaw) {
	const timestamp = String(timestampRaw == null ? "" : timestampRaw).trim() || new Date().toISOString();
	const validated = validateRosterData_(rosterDataRaw);
	const out = {
		schemaVersion: validated.schemaVersion,
		pageTitle: validated.pageTitle,
		rosterOrder: validated.rosterOrder,
		rosters: validated.rosters,
		playerMetrics: validated.playerMetrics,
		lastUpdatedAt: timestamp,
	};
	return validateRosterData_(out);
}

function markActiveDataWriteSuccess_(timestampRaw) {
	const timestamp = String(timestampRaw == null ? "" : timestampRaw).trim() || new Date().toISOString();
	const props = PropertiesService.getScriptProperties();
	props.setProperty(ACTIVE_DATA_LAST_SUCCESSFUL_WRITE_AT_PROPERTY, timestamp);
}

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

function isRecentSuccessfulActiveWrite_() {
	const lastWriteAt = getLastSuccessfulActiveWriteAt_();
	const lastWriteMs = parseIsoToMs_(lastWriteAt);
	if (!lastWriteMs) return false;
	return Date.now() - lastWriteMs < AUTO_REFRESH_INTERVAL_MS;
}

function shortenIssueMessage_(messageRaw, maxLenRaw) {
	const text = String(messageRaw == null ? "" : messageRaw)
		.replace(/\s+/g, " ")
		.trim();
	if (!text) return "";
	const maxLen = Math.max(40, toNonNegativeInt_(maxLenRaw) || 160);
	if (text.length <= maxLen) return text;
	return text.slice(0, Math.max(0, maxLen - 3)).trim() + "...";
}

function buildAutoRefreshIssueSummary_(issuesRaw) {
	const issues = Array.isArray(issuesRaw) ? issuesRaw : [];
	if (!issues.length) return "";
	const first = issues[0] && typeof issues[0] === "object" ? issues[0] : {};
	const rosterName = String(first.rosterName == null ? "" : first.rosterName).trim() || "Unknown roster";
	const step = String(first.step == null ? "" : first.step).trim() || "pipeline";
	const message = shortenIssueMessage_(first.message, 180) || "Unknown issue.";
	return rosterName + " | " + step + " | " + message;
}

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
function replaceActiveRosterDataFile_(validatedRosterData, options) {
	return replaceActiveRosterData_(validatedRosterData, options);
}

function writePublishedRosterData_(rosterDataRaw) {
	const publishedAt = new Date().toISOString();
	let validationStepLabel = "prepare publish payload";
	let duplicateDiagnosticsRosterData = rosterDataRaw;
	let validated = null;

	try {
		validationStepLabel = "set publish timestamp";
		validated = withRosterLastUpdatedAt_(rosterDataRaw, publishedAt);
		duplicateDiagnosticsRosterData = validated;

		let activeSourceSnapshot = null;
		let activeData = null;
		try {
			activeSourceSnapshot = readActiveRosterSnapshot_();
			activeData = activeSourceSnapshot && activeSourceSnapshot.rosterData ? activeSourceSnapshot.rosterData : null;
		} catch (err) {
			Logger.log("publishRosterData: unable to read current active roster snapshot from Firebase: %s", errorMessage_(err));
		}

		// Protect against accidental metric loss when preview payload has no metrics.
		const incomingMetricCount = countPlayerMetricsEntries_(validated && validated.playerMetrics);
		if (incomingMetricCount < 1) {
			try {
				const activeMetricCount = countPlayerMetricsEntries_(activeData && activeData.playerMetrics);
				if (activeMetricCount > 0) {
					validated.playerMetrics = sanitizePlayerMetricsStore_(activeData.playerMetrics, publishedAt);
					validationStepLabel = "validate payload after metrics preservation";
					validated = validateRosterData_(validated);
					duplicateDiagnosticsRosterData = validated;
					Logger.log("publishRosterData: preserved existing playerMetrics (entries=%s) because incoming payload had none.", activeMetricCount);
				}
			} catch (err) {
				Logger.log("publishRosterData: unable to preserve existing playerMetrics fallback: %s", errorMessage_(err));
			}
		}

		const lowCoverageRosters = incomingMetricCount > 0 ? listRostersNeedingMetricsCoverageRepair_(validated, PLAYER_METRICS_MIN_ROSTER_COVERAGE_FOR_PUBLISH) : [];
		if (lowCoverageRosters.length > 0) {
			Logger.log(
				"publishRosterData: detected %s roster(s) below metrics coverage threshold %.2f; running targeted recapture.",
				lowCoverageRosters.length,
				PLAYER_METRICS_MIN_ROSTER_COVERAGE_FOR_PUBLISH,
			);
		}

		// Do publish-time capture when payload has no metrics, or when one/more rosters have low metrics coverage.
		const shouldRunPublishMetricsCapture = incomingMetricCount < 1 || lowCoverageRosters.length > 0;
		if (shouldRunPublishMetricsCapture) {
			try {
				const rosters = Array.isArray(validated && validated.rosters) ? validated.rosters : [];
				const rosterCaptureQueue = [];
				if (incomingMetricCount < 1) {
					for (let i = 0; i < rosters.length; i++) {
						const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
						const rosterId = String(roster.id == null ? "" : roster.id).trim();
						const clanTag = normalizeTag_(roster.connectedClanTag);
						if (!rosterId || !clanTag) continue;
						rosterCaptureQueue.push({ rosterId: rosterId, clanTag: clanTag, reason: "emptyMetricsStore" });
					}
				} else {
					for (let i = 0; i < lowCoverageRosters.length; i++) {
						const item = lowCoverageRosters[i] && typeof lowCoverageRosters[i] === "object" ? lowCoverageRosters[i] : {};
						const rosterId = String(item.rosterId == null ? "" : item.rosterId).trim();
						if (!rosterId) continue;
						rosterCaptureQueue.push({ rosterId: rosterId, clanTag: normalizeTag_(item.clanTag), reason: "lowCoverage" });
					}
				}

				let attemptedClans = 0;
				let capturedClans = 0;
				let recorded = 0;
				let updated = 0;
				let profileAttempted = 0;
				let profileEnriched = 0;
				const errors = [];

				for (let i = 0; i < rosterCaptureQueue.length; i++) {
					const item = rosterCaptureQueue[i] && typeof rosterCaptureQueue[i] === "object" ? rosterCaptureQueue[i] : {};
					const rosterId = String(item.rosterId == null ? "" : item.rosterId).trim();
					const clanTag = normalizeTag_(item.clanTag);
					if (!rosterId) continue;
					attemptedClans++;
					try {
						const capture = captureMemberTrackingForRoster_(validated, rosterId, {
							continueOnError: true,
							metricsProfileMode: "always",
						});
						if (capture) {
							capturedClans += toNonNegativeInt_(capture.capturedClans) > 0 ? 1 : 0;
							recorded += toNonNegativeInt_(capture.recorded);
							updated += toNonNegativeInt_(capture.updated);
							profileAttempted += toNonNegativeInt_(capture.profileAttempted);
							profileEnriched += toNonNegativeInt_(capture.profileEnriched);
							if (Array.isArray(capture.errors) && capture.errors.length) {
								for (let j = 0; j < capture.errors.length; j++) {
									errors.push(capture.errors[j]);
								}
							}
						}
					} catch (err) {
						errors.push({ clanTag: clanTag, message: errorMessage_(err) });
					}
				}

				validationStepLabel = "validate payload after metrics recapture";
				validated = validateRosterData_(validated);
				duplicateDiagnosticsRosterData = validated;
				Logger.log(
					"publishRosterData metrics capture attempted=%s captured=%s recorded=%s updated=%s entries=%s profileAttempted=%s profileEnriched=%s errors=%s repairedRosters=%s",
					attemptedClans,
					capturedClans,
					recorded,
					updated,
					countPlayerMetricsEntries_(validated && validated.playerMetrics),
					profileAttempted,
					profileEnriched,
					errors.length,
					lowCoverageRosters.length,
				);
			} catch (err) {
				Logger.log("publishRosterData: fallback metrics capture failed: %s", errorMessage_(err));
			}
		} else {
			Logger.log("publishRosterData: skipped live metrics capture because incoming payload already has %s metric entries.", incomingMetricCount);
		}

		const publishBackup = createPublishArchiveBackupFromSnapshot_(activeSourceSnapshot, publishedAt);
		validationStepLabel = "validate payload before active write";
		duplicateDiagnosticsRosterData = validated;
		replaceActiveRosterData_(validated, { sourceSnapshot: activeSourceSnapshot });
		const publishArchiveCleanupDeleted = cleanupPublishArchiveBackups_();

		const counts = countRosterPayload_(validated);
		const metricEntryCount = countPlayerMetricsEntries_(validated && validated.playerMetrics);
		const meta = {
			publishedAt: publishedAt,
			lastUpdatedAt: publishedAt,
			pageTitle: validated.pageTitle || "",
			rosterCount: Array.isArray(validated.rosters) ? validated.rosters.length : 0,
			playerCount: counts.playerCount,
			noteCount: counts.noteCount,
			metricEntryCount: metricEntryCount,
			publishArchiveCreated: !!publishBackup.created,
			publishArchiveKey: String(publishBackup.key || ""),
			publishArchiveCleanupDeleted: publishArchiveCleanupDeleted,
		};
		firebaseRequestJson_(FIREBASE_META_PATH, "PATCH", {
			layoutVersion: FIREBASE_LAYOUT_VERSION,
			lastPublishAt: publishedAt,
			lastPublishArchiveKey: meta.publishArchiveKey,
			lastPublishArchiveCleanupDeleted: publishArchiveCleanupDeleted,
		});
		Logger.log(
			"publishRosterData ok rosters=%s players=%s notes=%s metricEntries=%s backupCreated=%s backupKey=%s backupCleanupDeleted=%s",
			meta.rosterCount,
			counts.playerCount,
			counts.noteCount,
			metricEntryCount,
			meta.publishArchiveCreated,
			meta.publishArchiveKey,
			publishArchiveCleanupDeleted,
		);
		markActiveDataWriteSuccess_(publishedAt);
		return meta;
	} catch (err) {
		rethrowWithDuplicateRosterTagDetails_(validationStepLabel, err, duplicateDiagnosticsRosterData);
	}
}

function writeAutoRefreshedActiveRosterData_(sourceSnapshotRaw, refreshedRosterDataRaw) {
	const sourceSnapshot = sourceSnapshotRaw && typeof sourceSnapshotRaw === "object" ? sourceSnapshotRaw : readActiveRosterSnapshot_();
	const sourceData = validateRosterData_(sourceSnapshot.rosterData);
	const refreshedData = validateRosterData_(refreshedRosterDataRaw);
	const changed = hasActiveRosterPayloadChanged_(sourceData, refreshedData);
	if (!changed) {
		const sourceCounts = countRosterPayload_(sourceData);
		return {
			changed: false,
			written: false,
			writtenAt: "",
			replacedCount: 0,
			playerCount: sourceCounts.playerCount,
			noteCount: sourceCounts.noteCount,
			rosterCount: Array.isArray(sourceData.rosters) ? sourceData.rosters.length : 0,
			archiveCreated: false,
			archiveDate: "",
			archiveCleanupDeleted: 0,
		};
	}

	const writtenAt = new Date().toISOString();
	const payloadToWrite = withRosterLastUpdatedAt_(refreshedData, writtenAt);
	const counts = countRosterPayload_(payloadToWrite);
	const writeResult = replaceActiveRosterData_(payloadToWrite, { sourceSnapshot: sourceSnapshot });
	const archiveDate = getServerDateString_(new Date());
	let archiveCreated = false;
	try {
		const archiveResult = createAutoRefreshDailyArchiveIfNeeded_(archiveDate, payloadToWrite);
		archiveCreated = !!archiveResult.created;
		if (archiveResult.archiveDate) {
			PropertiesService.getScriptProperties().setProperty(AUTO_REFRESH_LAST_ARCHIVE_DATE_PROPERTY, archiveResult.archiveDate);
		}
	} catch (err) {
		Logger.log("Unable to create auto-refresh daily archive: %s", errorMessage_(err));
	}
	const archiveCleanupDeleted = cleanupOldAutoRefreshDailyArchives_();
	firebaseRequestJson_(FIREBASE_META_PATH, "PATCH", {
		layoutVersion: FIREBASE_LAYOUT_VERSION,
		lastAutoRefreshWriteAt: writtenAt,
		lastAutoRefreshArchiveDate: archiveDate,
		lastAutoRefreshArchiveCleanupDeleted: archiveCleanupDeleted,
	});
	markActiveDataWriteSuccess_(writtenAt);

	return {
		changed: true,
		written: true,
		writtenAt: writtenAt,
		replacedCount: writeResult.replacedCount,
		playerCount: counts.playerCount,
		noteCount: counts.noteCount,
		rosterCount: Array.isArray(payloadToWrite.rosters) ? payloadToWrite.rosters.length : 0,
		archiveCreated: archiveCreated,
		archiveDate: archiveDate,
		archiveCleanupDeleted: archiveCleanupDeleted,
	};
}

function findRosterInDataById_(rosterData, rosterIdRaw) {
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	if (!rosterId) return null;
	const rosters = rosterData && Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		if (String(roster.id || "").trim() === rosterId) return roster;
	}
	return null;
}

function cloneRosterDataForRefresh_(rosterDataRaw) {
	try {
		return JSON.parse(JSON.stringify(rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {}));
	} catch (err) {
		throw new Error("Unable to clone roster data for refresh rollback: " + errorMessage_(err));
	}
}

function findDuplicateRosterTags_(rosterDataRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const rosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	const byTag = {};
	const sections = ["main", "subs", "missing"];

	for (let rosterIndex = 0; rosterIndex < rosters.length; rosterIndex++) {
		const roster = rosters[rosterIndex] && typeof rosters[rosterIndex] === "object" ? rosters[rosterIndex] : {};
		const rosterId = String(roster.id == null ? "" : roster.id).trim() || "(missing-id@" + rosterIndex + ")";
		for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
			const section = sections[sectionIndex];
			const players = Array.isArray(roster[section]) ? roster[section] : [];
			for (let playerIndex = 0; playerIndex < players.length; playerIndex++) {
				const player = players[playerIndex] && typeof players[playerIndex] === "object" ? players[playerIndex] : {};
				const tag = normalizeTag_(player.tag);
				if (!tag) continue;
				if (!byTag[tag]) byTag[tag] = [];
				byTag[tag].push({
					rosterId: rosterId,
					section: section,
					index: playerIndex,
				});
			}
		}
	}

	const tags = Object.keys(byTag).sort();
	const duplicates = [];
	for (let i = 0; i < tags.length; i++) {
		const tag = tags[i];
		const occurrences = byTag[tag];
		if (!Array.isArray(occurrences) || occurrences.length < 2) continue;
		duplicates.push({
			tag: tag,
			occurrences: occurrences,
		});
	}
	return duplicates;
}

function formatDuplicateRosterTagsForMessage_(duplicatesRaw, maxTagsRaw, maxLocationsRaw) {
	const duplicates = Array.isArray(duplicatesRaw) ? duplicatesRaw : [];
	if (!duplicates.length) return "";
	const maxTags = Math.max(1, toNonNegativeInt_(maxTagsRaw) || 3);
	const maxLocations = Math.max(1, toNonNegativeInt_(maxLocationsRaw) || 4);
	const tagParts = [];
	for (let i = 0; i < duplicates.length && i < maxTags; i++) {
		const duplicate = duplicates[i] && typeof duplicates[i] === "object" ? duplicates[i] : {};
		const tag = normalizeTag_(duplicate.tag) || String(duplicate.tag || "");
		const occurrences = Array.isArray(duplicate.occurrences) ? duplicate.occurrences : [];
		const locationParts = [];
		for (let j = 0; j < occurrences.length && j < maxLocations; j++) {
			const occurrence = occurrences[j] && typeof occurrences[j] === "object" ? occurrences[j] : {};
			const rosterId = String(occurrence.rosterId == null ? "" : occurrence.rosterId).trim() || "?";
			const section = String(occurrence.section == null ? "" : occurrence.section).trim() || "?";
			const index = toNonNegativeInt_(occurrence.index);
			locationParts.push(rosterId + "/" + section + "[" + index + "]");
		}
		if (occurrences.length > maxLocations) locationParts.push("+" + (occurrences.length - maxLocations) + " more");
		tagParts.push(tag + ": " + locationParts.join(", "));
	}
	if (duplicates.length > maxTags) tagParts.push("+" + (duplicates.length - maxTags) + " more tag(s)");
	return "duplicate tag detail: " + tagParts.join(" ; ");
}

function appendDuplicateRosterTagDetailsToError_(stepLabelRaw, err, rosterDataRaw) {
	const baseMessage = errorMessage_(err);
	if (!/duplicate player tag in output/i.test(baseMessage)) return baseMessage;
	const duplicates = findDuplicateRosterTags_(rosterDataRaw);
	if (!duplicates.length) return baseMessage;
	const stepLabel = String(stepLabelRaw == null ? "" : stepLabelRaw).trim() || "refresh";
	Logger.log("duplicate-tag diagnostics (%s): %s", stepLabel, JSON.stringify(duplicates));
	const detail = formatDuplicateRosterTagsForMessage_(duplicates, 2, 3);
	return detail ? detail + " | " + baseMessage : baseMessage;
}

function rethrowWithDuplicateRosterTagDetails_(stepLabelRaw, err, rosterDataRaw) {
	const detailedMessage = appendDuplicateRosterTagDetailsToError_(stepLabelRaw, err, rosterDataRaw);
	if (detailedMessage === errorMessage_(err)) throw err;
	throw new Error(detailedMessage);
}

function buildAutoRefreshPrefetchBundle_(sourceRostersRaw) {
	const sourceRosters = Array.isArray(sourceRostersRaw) ? sourceRostersRaw : [];
	const connectedClanTagSet = {};
	const regularWarClanTagSet = {};
	const cwlClanTagSet = {};

	for (let i = 0; i < sourceRosters.length; i++) {
		const roster = sourceRosters[i] && typeof sourceRosters[i] === "object" ? sourceRosters[i] : {};
		const rosterId = String(roster.id == null ? "" : roster.id).trim();
		if (!rosterId) continue;
		const clanTag = normalizeTag_(roster.connectedClanTag);
		if (!clanTag) continue;
		connectedClanTagSet[clanTag] = true;
		const trackingMode = getRosterTrackingMode_(roster);
		if (trackingMode === "regularWar") {
			regularWarClanTagSet[clanTag] = true;
		} else {
			cwlClanTagSet[clanTag] = true;
		}
	}

	const prefetchOptions = {
		batchSize: AUTO_REFRESH_PREFETCH_BATCH_SIZE,
		batchDelayMs: AUTO_REFRESH_PREFETCH_BATCH_DELAY_MS,
	};
	const connectedClanTags = Object.keys(connectedClanTagSet);
	const regularWarClanTags = Object.keys(regularWarClanTagSet);
	const cwlClanTags = Object.keys(cwlClanTagSet);
	const memberPrefetch = prefetchClanMembersSnapshotsByTag_(connectedClanTags, prefetchOptions);
	const regularWarPrefetch = prefetchCurrentRegularWarByClanTag_(regularWarClanTags, prefetchOptions);
	const leaguegroupPrefetch = prefetchLeagueGroupRawByClanTag_(cwlClanTags, prefetchOptions);

	const cwlWarTagSet = {};
	const leaguegroupTags = Object.keys(leaguegroupPrefetch.rawByClanTag);
	for (let i = 0; i < leaguegroupTags.length; i++) {
		const clanTag = leaguegroupTags[i];
		if (Object.prototype.hasOwnProperty.call(leaguegroupPrefetch.errorByClanTag, clanTag)) continue;
		const leaguegroup = leaguegroupPrefetch.rawByClanTag[clanTag];
		const warTags = extractLeagueGroupWarTags_(leaguegroup);
		for (let j = 0; j < warTags.length; j++) {
			const warTag = normalizeTag_(warTags[j]);
			if (!warTag || warTag === "#0") continue;
			cwlWarTagSet[warTag] = true;
		}
	}
	const cwlWarPrefetch = prefetchCwlWarRawByTag_(Object.keys(cwlWarTagSet), prefetchOptions);

	return {
		clanMembersSnapshotByTag: memberPrefetch.snapshotByClanTag,
		clanMembersErrorByTag: memberPrefetch.errorByClanTag,
		currentRegularWarByClanTag: regularWarPrefetch.currentWarByClanTag,
		currentRegularWarErrorByClanTag: regularWarPrefetch.errorByClanTag,
		leaguegroupRawByClanTag: leaguegroupPrefetch.rawByClanTag,
		leaguegroupErrorByClanTag: leaguegroupPrefetch.errorByClanTag,
		cwlWarRawByTag: cwlWarPrefetch.rawByWarTag,
		cwlWarErrorByTag: cwlWarPrefetch.errorByWarTag,
	};
}

function runAutoRefreshAllRosters_(rosterDataRaw) {
	let rosterData = null;
	try {
		rosterData = validateRosterData_(rosterDataRaw);
	} catch (err) {
		rethrowWithDuplicateRosterTagDetails_("initialize refresh payload", err, rosterDataRaw);
	}
	const sourceRosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	const rosterIds = [];
	for (let i = 0; i < sourceRosters.length; i++) {
		const rosterId = String((sourceRosters[i] && sourceRosters[i].id) || "").trim();
		if (!rosterId) continue;
		rosterIds.push(rosterId);
	}
	const issues = [];
	const perRoster = [];
	let processedRosters = 0;
	let rostersWithIssues = 0;
	const autoRefreshPrefetch = buildAutoRefreshPrefetchBundle_(sourceRosters);
	const pipelinePrefetchOptions = {
		prefetchedClanSnapshotsByTag: autoRefreshPrefetch.clanMembersSnapshotByTag,
		prefetchedClanErrorsByTag: autoRefreshPrefetch.clanMembersErrorByTag,
		prefetchedCurrentRegularWarByClanTag: autoRefreshPrefetch.currentRegularWarByClanTag,
		prefetchedRegularWarErrorByClanTag: autoRefreshPrefetch.currentRegularWarErrorByClanTag,
		prefetchedLeaguegroupRawByClanTag: autoRefreshPrefetch.leaguegroupRawByClanTag,
		prefetchedLeaguegroupErrorByClanTag: autoRefreshPrefetch.leaguegroupErrorByClanTag,
		prefetchedCwlWarRawByTag: autoRefreshPrefetch.cwlWarRawByTag,
		prefetchedCwlWarErrorByTag: autoRefreshPrefetch.cwlWarErrorByTag,
	};
	const ownershipSnapshot = buildLiveRosterOwnershipSnapshot_(rosterData, {
		prefetchedClanSnapshotsByTag: autoRefreshPrefetch.clanMembersSnapshotByTag,
		prefetchedClanErrorsByTag: autoRefreshPrefetch.clanMembersErrorByTag,
	});
	const rosterStates = [];
	const rosterQueue = [];

	const addIssueForState = (state, stepRaw, messageRaw) => {
		const step = String(stepRaw == null ? "" : stepRaw).trim() || "pipeline";
		const message = shortenIssueMessage_(messageRaw, 200);
		if (!message) return;
		const issue = {
			rosterId: state.rosterId,
			rosterName: state.rosterName,
			step: step,
			message: message,
		};
		state.rosterIssues.push(issue);
		issues.push(issue);
	};

	const addSkippedIssueForState = (state, stepLabelRaw, prerequisiteStepLabelRaw) => {
		const stepLabel = String(stepLabelRaw == null ? "" : stepLabelRaw).trim() || "pipeline";
		const prerequisiteStepLabel = String(prerequisiteStepLabelRaw == null ? "" : prerequisiteStepLabelRaw).trim();
		const suffix = prerequisiteStepLabel ? ": " + prerequisiteStepLabel : "";
		addIssueForState(state, stepLabel, "skipped because previous step failed" + suffix + ".");
	};

	const runStepWithRollbackForState = (state, stepLabelRaw, stepFn) => {
		const stepLabel = String(stepLabelRaw == null ? "" : stepLabelRaw).trim() || "pipeline";
		const beforeStep = cloneRosterDataForRefresh_(rosterData);
		try {
			const stepResult = stepFn();
			if (stepResult && stepResult.rosterData) {
				rosterData = stepResult.rosterData;
			}
			return { ok: true, result: stepResult };
		} catch (err) {
			const detailedMessage = appendDuplicateRosterTagDetailsToError_(stepLabel, err, rosterData);
			rosterData = beforeStep;
			addIssueForState(state, stepLabel, detailedMessage);
			return { ok: false, error: err };
		}
	};

	for (let i = 0; i < rosterIds.length; i++) {
		const rosterId = rosterIds[i];
		processedRosters++;
		const currentRoster = findRosterInDataById_(rosterData, rosterId);
		const rosterTitle = String((currentRoster && currentRoster.title) || "").trim();
		const trackingMode = currentRoster ? getRosterTrackingMode_(currentRoster) : "cwl";
		const state = {
			rosterId: rosterId,
			rosterName: rosterTitle ? rosterTitle : rosterId,
			trackingMode: trackingMode,
			poolStepLabel: "sync clan roster pool",
			lineupStepLabel: trackingMode === "regularWar" ? "sync current war lineup" : "sync today lineup",
			statsStepLabel: trackingMode === "regularWar" ? "refresh tracking stats" : "refresh CWL stats",
			benchStepLabel: "compute bench suggestions",
			noCurrentWarMessage: trackingMode === "regularWar" ? "no current regular war found" : "no current cwl war found",
			hasConnectedClanTag: !!normalizeTag_(currentRoster && currentRoster.connectedClanTag),
			rosterIssues: [],
			poolStepOk: false,
			lineupStepOk: false,
			statsStepOk: false,
			nextStepIndex: 0,
			done: false,
		};
		rosterStates.push(state);

		if (!currentRoster) {
			addIssueForState(state, "pipeline", "Roster not found in current refresh payload.");
			state.done = true;
			continue;
		}
		if (!state.hasConnectedClanTag) {
			addIssueForState(state, state.poolStepLabel, "Connected clan tag is missing.");
		}
		rosterQueue.push(state);
	}

	while (rosterQueue.length > 0) {
		const state = rosterQueue.shift();
		if (!state || state.done) continue;

		if (state.nextStepIndex === 0) {
			if (state.hasConnectedClanTag) {
				const poolStep = runStepWithRollbackForState(state, state.poolStepLabel, () => {
					return syncClanRosterPoolInternal_(rosterData, state.rosterId, { ownershipSnapshot: ownershipSnapshot });
				});
				state.poolStepOk = !!poolStep.ok;
			} else {
				state.poolStepOk = false;
			}
		} else if (state.nextStepIndex === 1) {
			if (!state.hasConnectedClanTag || !state.poolStepOk) {
				addSkippedIssueForState(state, state.lineupStepLabel, state.poolStepLabel);
			} else {
				const syncTodayStep = runStepWithRollbackForState(state, state.lineupStepLabel, () => syncClanTodayLineupInternal_(rosterData, state.rosterId, pipelinePrefetchOptions));
				state.lineupStepOk = !!syncTodayStep.ok;
				if (syncTodayStep.ok) {
					const syncToday = syncTodayStep.result;
					const message = String((syncToday && syncToday.result && syncToday.result.message) || "")
						.trim()
						.toLowerCase();
					if (message === state.noCurrentWarMessage) {
						Logger.log("autoRefresh: roster '%s' has no current war for mode '%s'; treated as non-fatal.", state.rosterId, state.trackingMode);
					}
				}
			}
		} else if (state.nextStepIndex === 2) {
			if (!state.hasConnectedClanTag || !state.poolStepOk || !state.lineupStepOk) {
				addSkippedIssueForState(state, state.statsStepLabel, !state.poolStepOk || !state.hasConnectedClanTag ? state.poolStepLabel : state.lineupStepLabel);
			} else {
				const statsStep = runStepWithRollbackForState(state, state.statsStepLabel, () => refreshTrackingStatsInternal_(rosterData, state.rosterId, pipelinePrefetchOptions));
				state.statsStepOk = !!statsStep.ok;
			}
		} else if (state.nextStepIndex === 3 && state.trackingMode === "cwl") {
			if (!state.hasConnectedClanTag || !state.poolStepOk || !state.lineupStepOk || !state.statsStepOk) {
				const failedStepLabel = !state.poolStepOk || !state.hasConnectedClanTag ? state.poolStepLabel : !state.lineupStepOk ? state.lineupStepLabel : state.statsStepLabel;
				addSkippedIssueForState(state, state.benchStepLabel, failedStepLabel);
			} else {
				runStepWithRollbackForState(state, state.benchStepLabel, () => computeBenchSuggestionsInternal_(rosterData, state.rosterId));
			}
		}

		state.nextStepIndex++;
		const totalSteps = state.trackingMode === "cwl" ? 4 : 3;
		if (state.nextStepIndex < totalSteps) {
			rosterQueue.push(state);
		} else {
			state.done = true;
		}
	}

	for (let i = 0; i < rosterStates.length; i++) {
		const state = rosterStates[i];
		if (state.rosterIssues.length > 0) rostersWithIssues++;
		perRoster.push({
			rosterId: state.rosterId,
			rosterName: state.rosterName,
			issueCount: state.rosterIssues.length,
			issues: state.rosterIssues,
		});
	}

	let validatedRosterData = null;
	try {
		validatedRosterData = validateRosterData_(rosterData);
	} catch (err) {
		throw new Error(appendDuplicateRosterTagDetailsToError_("finalize refresh payload", err, rosterData));
	}

	return {
		rosterData: validatedRosterData,
		processedRosters: processedRosters,
		rostersWithIssues: rostersWithIssues,
		issueCount: issues.length,
		issues: issues,
		issueSummary: buildAutoRefreshIssueSummary_(issues),
		perRoster: perRoster,
	};
}

function buildAutoRefreshSummary_(runResult, writeResult) {
	const run = runResult && typeof runResult === "object" ? runResult : {};
	const write = writeResult && typeof writeResult === "object" ? writeResult : {};
	const processed = Math.max(0, toNonNegativeInt_(run.processedRosters));
	const withIssues = Math.max(0, toNonNegativeInt_(run.rostersWithIssues));
	const issueCount = Math.max(0, toNonNegativeInt_(run.issueCount));
	const changed = !!write.changed;
	if (!changed) {
		return "Processed " + processed + " roster(s), issues " + issueCount + " across " + withIssues + " roster(s), no active payload change.";
	}
	const rostersWritten = Math.max(0, toNonNegativeInt_(write.rosterCount));
	return "Processed " + processed + " roster(s), issues " + issueCount + " across " + withIssues + " roster(s), wrote " + rostersWritten + " roster(s).";
}

function setAutoRefreshRunResult_(statusRaw, summaryRaw, errorRaw, issueCountRaw, issueSummaryRaw, startedAtRaw, finishedAtRaw) {
	const status = String(statusRaw == null ? "" : statusRaw).trim() || "error";
	const summary = String(summaryRaw == null ? "" : summaryRaw)
		.trim()
		.slice(0, 500);
	const error = String(errorRaw == null ? "" : errorRaw)
		.trim()
		.slice(0, 2000);
	const issueSummary = String(issueSummaryRaw == null ? "" : issueSummaryRaw)
		.trim()
		.slice(0, 500);
	const issueCount = Math.max(0, toNonNegativeInt_(issueCountRaw));
	const startedAt = String(startedAtRaw == null ? "" : startedAtRaw).trim() || new Date().toISOString();
	const finishedAt = String(finishedAtRaw == null ? "" : finishedAtRaw).trim() || new Date().toISOString();
	const props = PropertiesService.getScriptProperties();
	props.setProperties(
		{
			[AUTO_REFRESH_LAST_RUN_STARTED_AT_PROPERTY]: startedAt,
			[AUTO_REFRESH_LAST_RUN_FINISHED_AT_PROPERTY]: finishedAt,
			[AUTO_REFRESH_LAST_RUN_STATUS_PROPERTY]: status,
			[AUTO_REFRESH_LAST_RUN_SUMMARY_PROPERTY]: summary,
			[AUTO_REFRESH_LAST_ISSUE_SUMMARY_PROPERTY]: issueSummary,
			[AUTO_REFRESH_LAST_RUN_ERROR_PROPERTY]: error,
			[AUTO_REFRESH_LAST_RUN_ISSUE_COUNT_PROPERTY]: String(issueCount),
		},
		false,
	);
}

function isAutoRefreshEnabled_() {
	const raw = String(PropertiesService.getScriptProperties().getProperty(AUTO_REFRESH_ENABLED_PROPERTY) || "")
		.trim()
		.toLowerCase();
	return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function getTriggerUniqueId_(trigger) {
	if (!trigger || typeof trigger !== "object" || typeof trigger.getUniqueId !== "function") return "";
	try {
		return String(trigger.getUniqueId() || "").trim();
	} catch (err) {
		return "";
	}
}

function listAutoRefreshTriggers_() {
	const all = ScriptApp.getProjectTriggers();
	return all.filter((trigger) => {
		try {
			return String(trigger.getHandlerFunction() || "") === AUTO_REFRESH_HANDLER_NAME;
		} catch (err) {
			return false;
		}
	});
}

function removeAutoRefreshTriggers_() {
	const triggers = listAutoRefreshTriggers_();
	let removed = 0;
	for (let i = 0; i < triggers.length; i++) {
		try {
			ScriptApp.deleteTrigger(triggers[i]);
			removed++;
		} catch (err) {
			Logger.log("Unable to delete auto-refresh trigger: %s", errorMessage_(err));
		}
	}
	return removed;
}

function ensureSingleAutoRefreshTrigger_() {
	const props = PropertiesService.getScriptProperties();
	const configuredId = String(props.getProperty(AUTO_REFRESH_TRIGGER_ID_PROPERTY) || "").trim();
	const triggers = listAutoRefreshTriggers_();
	let keep = null;

	if (configuredId) {
		for (let i = 0; i < triggers.length; i++) {
			if (getTriggerUniqueId_(triggers[i]) === configuredId) {
				keep = triggers[i];
				break;
			}
		}
	}
	if (!keep && triggers.length) keep = triggers[0];

	const keepId = getTriggerUniqueId_(keep);
	for (let i = 0; i < triggers.length; i++) {
		const trigger = triggers[i];
		const triggerId = getTriggerUniqueId_(trigger);
		const isKeptTrigger = !!keep && ((keepId && triggerId === keepId) || (!keepId && trigger === keep));
		if (isKeptTrigger) continue;
		try {
			ScriptApp.deleteTrigger(trigger);
		} catch (err) {
			Logger.log("Unable to delete duplicate auto-refresh trigger: %s", errorMessage_(err));
		}
	}

	if (!keep) {
		keep = ScriptApp.newTrigger(AUTO_REFRESH_HANDLER_NAME).timeBased().everyHours(AUTO_REFRESH_INTERVAL_HOURS).create();
	}
	return keep;
}

function reconcileAutoRefreshTriggerState_() {
	const props = PropertiesService.getScriptProperties();
	const enabled = isAutoRefreshEnabled_();
	if (!enabled) {
		removeAutoRefreshTriggers_();
		props.deleteProperty(AUTO_REFRESH_TRIGGER_ID_PROPERTY);
		return { enabled: false, triggerId: "", hasTrigger: false };
	}

	const trigger = ensureSingleAutoRefreshTrigger_();
	const triggerId = getTriggerUniqueId_(trigger);
	if (triggerId) props.setProperty(AUTO_REFRESH_TRIGGER_ID_PROPERTY, triggerId);
	else props.deleteProperty(AUTO_REFRESH_TRIGGER_ID_PROPERTY);
	return { enabled: true, triggerId: triggerId, hasTrigger: !!triggerId };
}

function readAutoRefreshSettings_() {
	const props = PropertiesService.getScriptProperties();
	const enabled = isAutoRefreshEnabled_();
	const triggerId = String(props.getProperty(AUTO_REFRESH_TRIGGER_ID_PROPERTY) || "").trim();
	const lastRunIssueCount = Math.max(0, toNonNegativeInt_(props.getProperty(AUTO_REFRESH_LAST_RUN_ISSUE_COUNT_PROPERTY)));
	let lastArchiveDate = "";
	try {
		lastArchiveDate = findLatestAutoRefreshArchiveDate_();
		if (lastArchiveDate) props.setProperty(AUTO_REFRESH_LAST_ARCHIVE_DATE_PROPERTY, lastArchiveDate);
		else props.deleteProperty(AUTO_REFRESH_LAST_ARCHIVE_DATE_PROPERTY);
	} catch (err) {
		lastArchiveDate = String(props.getProperty(AUTO_REFRESH_LAST_ARCHIVE_DATE_PROPERTY) || "").trim();
		Logger.log("Unable to resolve latest auto-refresh archive date: %s", errorMessage_(err));
	}
	return {
		enabled: enabled,
		intervalHours: AUTO_REFRESH_INTERVAL_HOURS,
		intervalMinutes: AUTO_REFRESH_INTERVAL_HOURS * 60,
		triggerId: triggerId,
		hasTrigger: !!triggerId,
		lastRunStartedAt: String(props.getProperty(AUTO_REFRESH_LAST_RUN_STARTED_AT_PROPERTY) || "").trim(),
		lastRunFinishedAt: String(props.getProperty(AUTO_REFRESH_LAST_RUN_FINISHED_AT_PROPERTY) || "").trim(),
		lastRunStatus: String(props.getProperty(AUTO_REFRESH_LAST_RUN_STATUS_PROPERTY) || "").trim(),
		lastRunSummary: String(props.getProperty(AUTO_REFRESH_LAST_RUN_SUMMARY_PROPERTY) || "").trim(),
		lastIssueSummary: String(props.getProperty(AUTO_REFRESH_LAST_ISSUE_SUMMARY_PROPERTY) || "").trim(),
		lastRunError: String(props.getProperty(AUTO_REFRESH_LAST_RUN_ERROR_PROPERTY) || "").trim(),
		lastRunIssueCount: lastRunIssueCount,
		lastSuccessfulActiveRefreshAt: getLastSuccessfulActiveWriteAt_(),
		lastArchiveDate: lastArchiveDate,
	};
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

function autoRefreshActiveRosterTick() {
	const startedAt = new Date().toISOString();
	let runIssueCount = 0;
	let runIssueSummary = "";

	if (!isAutoRefreshEnabled_()) {
		setAutoRefreshRunResult_("skipped", "Auto-refresh skipped because it is disabled.", "", 0, "", startedAt, new Date().toISOString());
		return { ok: true, skipped: true, reason: "disabled" };
	}

	const acquired = tryAcquireActiveRosterJobLock_("auto-refresh", 0);
	if (!acquired) {
		setAutoRefreshRunResult_("skipped", "Auto-refresh skipped due to overlap with another active roster refresh/publish flow.", "", 0, "", startedAt, new Date().toISOString());
		return { ok: true, skipped: true, reason: "overlap" };
	}

	try {
		PropertiesService.getScriptProperties().setProperty(AUTO_REFRESH_LAST_RUN_STARTED_AT_PROPERTY, startedAt);
		if (isRecentSuccessfulActiveWrite_()) {
			const lastWriteAt = getLastSuccessfulActiveWriteAt_();
			const summary = "Auto-refresh skipped: active data was written recently (" + (lastWriteAt || "unknown") + ").";
			try {
				cleanupOldAutoRefreshDailyArchives_();
			} catch (cleanupErr) {
				Logger.log("Unable to cleanup stale auto-refresh archives: %s", errorMessage_(cleanupErr));
			}
			setAutoRefreshRunResult_("skipped", summary, "", 0, "", startedAt, new Date().toISOString());
			return { ok: true, skipped: true, reason: "cooldown", lastWriteAt: lastWriteAt };
		}

		const sourceSnapshot = readActiveRosterSnapshot_();
		const runResult = runAutoRefreshAllRosters_(sourceSnapshot.rosterData);
		runIssueCount = runResult.issueCount;
		runIssueSummary = String(runResult.issueSummary || "").trim();
		const writeResult = writeAutoRefreshedActiveRosterData_(sourceSnapshot, runResult.rosterData);

		let summary = buildAutoRefreshSummary_(runResult, writeResult);
		if (writeResult.changed && writeResult.archiveCreated) {
			summary += " Daily archive created for " + writeResult.archiveDate + ".";
		}
		if (writeResult.changed && writeResult.archiveCleanupDeleted > 0) {
			summary += " Cleaned " + writeResult.archiveCleanupDeleted + " stale daily archive(s).";
		}
		if (!writeResult.changed) {
			try {
				const cleanupDeleted = cleanupOldAutoRefreshDailyArchives_();
				if (cleanupDeleted > 0) {
					summary += " Cleaned " + cleanupDeleted + " stale daily archive(s).";
				}
			} catch (cleanupErr) {
				Logger.log("Unable to cleanup stale auto-refresh archives: %s", errorMessage_(cleanupErr));
			}
		}

		setAutoRefreshRunResult_("ok", summary, "", runIssueCount, runIssueSummary, startedAt, new Date().toISOString());
		Logger.log("autoRefreshActiveRosterTick ok: %s", summary);
		return {
			ok: true,
			summary: summary,
			changed: !!writeResult.changed,
			processedRosters: runResult.processedRosters,
			issueCount: runIssueCount,
		};
	} catch (err) {
		const message = errorMessage_(err);
		setAutoRefreshRunResult_("error", "Auto-refresh run failed.", message, runIssueCount, runIssueSummary, startedAt, new Date().toISOString());
		Logger.log("autoRefreshActiveRosterTick failed: %s", message);
		return { ok: false, error: message };
	} finally {
		releaseActiveRosterJobLock_(acquired.token);
	}
}

/**
 * Replaces the active roster payload in Firebase Realtime Database and keeps publish backups in Firebase archive.
 * Called from Admin UI via google.script.run.publishRosterData(rosterData, password)
 */
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
function serveAsset_(name) {
	const safeName = String(name)
		.replace(/^[\/\\]+/, "")
		.replace(/\.\./g, "");
	if (safeName.toLowerCase() !== ACTIVE_ROSTER_FILENAME.toLowerCase()) {
		return ContentService.createTextOutput("404 - asset not found: " + safeName).setMimeType(ContentService.MimeType.TEXT);
	}
	try {
		const text = getAssetText_(safeName);
		if (!text) {
			return ContentService.createTextOutput("404 - asset not found: " + safeName).setMimeType(ContentService.MimeType.TEXT);
		}
		return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
	} catch (err) {
		return ContentService.createTextOutput("ASSET_ERROR for " + safeName + ":\n\n" + errorMessage_(err)).setMimeType(ContentService.MimeType.TEXT);
	}
}

function serveMediaAssetData_(assetPathRaw) {
	const safeAssetPath = normalizeImageAssetPath_(assetPathRaw);
	return ContentService.createTextOutput(
		JSON.stringify({
			ok: false,
			assetPath: safeAssetPath,
			reason: "disabled-use-cloudflare-static-url",
			mimeType: "",
			dataBase64: "",
			fileName: "",
		}),
	).setMimeType(ContentService.MimeType.JSON);
}

function serveImageAssetData_(assetPathRaw) {
	return serveMediaAssetData_(assetPathRaw);
}

function getAssetText_(filename) {
	const safeFilename = String(filename == null ? "" : filename).trim();
	if (!safeFilename) return "";
	const isActiveRosterAsset = safeFilename.toLowerCase() === ACTIVE_ROSTER_FILENAME.toLowerCase();

	const cache = getScriptCacheSafe_();
	const cacheKey = buildAssetTextCacheKey_(safeFilename);
	const cachedText = readStringFromCache_(cache, cacheKey);
	if (cachedText !== null) return cachedText;

	if (isActiveRosterAsset) {
		try {
			const snapshot = readActiveRosterSnapshot_();
			const text = snapshot && typeof snapshot.text === "string" ? snapshot.text : "";
			if (text) {
				maybeCacheText_(cache, cacheKey, text, getAssetTextCacheTtlSeconds_(safeFilename), {
					maxChars: CACHE_SAFE_TEXT_MAX_CHARS,
					logOversize: false,
				});
			}
			return text;
		} catch (err) {
			Logger.log("Unable to read active roster payload from Firebase for asset route: %s", errorMessage_(err));
			return "";
		}
	}

	return "";
}

function getScriptCacheSafe_() {
	try {
		return CacheService.getScriptCache();
	} catch (err) {
		Logger.log("Unable to get script cache: %s", err && err.message ? err.message : String(err));
		return null;
	}
}

function readStringFromCache_(cache, key) {
	if (!cache || !key) return null;
	try {
		const value = cache.get(key);
		return value == null ? null : String(value);
	} catch (err) {
		Logger.log("Cache get failed for key '%s': %s", key, err && err.message ? err.message : String(err));
		return null;
	}
}

function writeStringToCache_(cache, key, value, ttlSeconds) {
	if (!cache || !key || value == null) return;
	const ttl = Math.max(1, Number(ttlSeconds) || 0);
	try {
		cache.put(key, String(value), ttl);
	} catch (err) {
		Logger.log("Cache put failed for key '%s': %s", key, err && err.message ? err.message : String(err));
	}
}

function maybeCacheText_(cache, key, textRaw, ttlSeconds, optionsRaw) {
	if (!cache || !key || textRaw == null) return false;
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const maxCharsRaw = Number(options.maxChars);
	const maxChars = isFinite(maxCharsRaw) && maxCharsRaw > 0 ? Math.floor(maxCharsRaw) : CACHE_SAFE_TEXT_MAX_CHARS;
	const logOversize = options.logOversize !== false;
	const text = String(textRaw);
	if (text.length > maxChars) {
		if (logOversize) {
			Logger.log(
				"Skipping cache for %s because payload exceeds safe CacheService size threshold (%s > %s chars).",
				key,
				text.length,
				maxChars,
			);
		}
		return false;
	}
	const ttl = Math.max(1, Number(ttlSeconds) || 0);
	try {
		cache.put(key, text, ttl);
		return true;
	} catch (err) {
		Logger.log("Skipping cache write for key '%s' due to non-fatal cache error: %s", key, err && err.message ? err.message : String(err));
		return false;
	}
}

function removeStringFromCache_(cache, key) {
	if (!cache || !key) return;
	try {
		if (typeof cache.remove === "function") cache.remove(key);
	} catch (err) {
		Logger.log("Cache remove failed for key '%s': %s", key, err && err.message ? err.message : String(err));
	}
}

function buildAssetTextCacheKey_(filename) {
	return "assetText:" + ASSET_TEXT_CACHE_VERSION + ":" + encodeURIComponent(String(filename == null ? "" : filename));
}

function getAssetTextCacheTtlSeconds_(filename) {
	const lower = String(filename == null ? "" : filename)
		.trim()
		.toLowerCase();
	if (lower === ACTIVE_ROSTER_FILENAME.toLowerCase()) return ASSET_TEXT_CACHE_TTL_ROSTER_SECONDS;
	return ASSET_TEXT_CACHE_TTL_STATIC_SECONDS;
}

function listFolderFiles_() {
	return listFirebaseDataDebugInfo_();
}

function assertAdminPassword_(password) {
	const props = PropertiesService.getScriptProperties();
	const configured = props.getProperty("ADMIN_PW");
	const adminPwRaw = configured != null && String(configured).length > 0 ? String(configured) : "change-me";
	const adminPw = adminPwRaw.trim();
	const providedPw = String(password || "").trim();

	if (providedPw !== adminPw) {
		throw new Error("Authentication failed. Check script property ADMIN_PW (default is 'change-me' when unset).");
	}
}

function checkPublishCooldown_() {
	const props = PropertiesService.getScriptProperties();
	const nowMs = Date.now();
	const lastMs = parseInt(props.getProperty("LAST_PUBLISH_MS") || "0", 10) || 0;

	// 10 seconds cooldown
	if (nowMs - lastMs < 10000) {
		throw new Error("Publish cooldown: please wait a few seconds and try again.");
	}
}

function markPublish_() {
	PropertiesService.getScriptProperties().setProperty("LAST_PUBLISH_MS", String(Date.now()));
}

const COC_PROXY_BASE_URL = "https://cocproxy.royaleapi.dev/v1";
const PLAYER_PROFILE_CACHE_TTL_SECONDS = 300;
const TOWN_HALL_ICON_CACHE_TTL_SECONDS = 3600;
const LEAGUE_ICON_CACHE_TTL_SECONDS = 3600;
const LEAGUE_ICON_CACHE_VERSION = "v4";
// How long to retain a member's tracking data after they stop appearing in the roster.
// This is intentionally long (e.g., 28 days) to avoid losing war history for temporary departures.
const REGULAR_WAR_MISSING_GRACE_MS = 28 * 24 * 60 * 60 * 1000; // 28 days
const REGULAR_WAR_WARLOG_LIMIT = 25;
const ROSTER_LOCK_KEY_PREFIX = "ROSTER_LOCK:";
const ROSTER_LOCK_WAIT_MS = 30 * 1000;
const ROSTER_LOCK_LEASE_MS = 10 * 60 * 1000;
const ROSTER_LOCK_POLL_MS = 250;
const AUTO_REFRESH_PREFETCH_BATCH_SIZE = 8;
const AUTO_REFRESH_PREFETCH_BATCH_DELAY_MS = 1000;
const PLAYER_METRICS_SCHEMA_VERSION = 1;
const PLAYER_METRICS_TROPHY_HISTORY_MAX_DAYS = 120;
const PLAYER_METRICS_DONATION_MONTHS_MAX = 12;
const PLAYER_METRICS_ENTRY_RETENTION_DAYS = 240;
const PLAYER_METRICS_PLAYER_HOUSE_MAX_ELEMENTS = 8;
const PLAYER_METRICS_PROFILE_SNAPSHOT_CACHE_VERSION = "v1";
const PLAYER_METRICS_PROFILE_SNAPSHOT_CACHE_TTL_SECONDS = 300;
const PLAYER_METRICS_PROFILE_ENRICH_MIN_MEMBER_COUNT = 8;
const PLAYER_METRICS_PROFILE_ENRICH_MAX_NONZERO_RATIO = 0.2;
const PLAYER_METRICS_PROFILE_ENRICH_MIN_UNRANKED_RATIO = 0.7;
const PLAYER_METRICS_MIN_ROSTER_COVERAGE_FOR_PUBLISH = 0.9;

function parseRosterLockState_(raw) {
	const text = String(raw == null ? "" : raw).trim();
	if (!text) return null;

	try {
		const parsed = JSON.parse(text);
		const token = String((parsed && parsed.token) || "").trim();
		const expiresAt = Number(parsed && parsed.expiresAt);
		if (!token || !isFinite(expiresAt)) return null;
		return {
			token: token,
			expiresAt: Math.floor(expiresAt),
		};
	} catch (err) {
		return null;
	}
}

function withRosterLock_(rosterIdRaw, callback) {
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	if (!rosterId) throw new Error("Roster ID is required.");
	if (typeof callback !== "function") throw new Error("Roster lock callback is required.");

	const props = PropertiesService.getScriptProperties();
	const lockKey = ROSTER_LOCK_KEY_PREFIX + rosterId;
	const token = Utilities.getUuid();
	const deadlineMs = Date.now() + ROSTER_LOCK_WAIT_MS;
	let acquired = false;

	while (!acquired && Date.now() < deadlineMs) {
		const scriptLock = LockService.getScriptLock();
		const remainingMs = Math.max(250, deadlineMs - Date.now());
		const didLock = scriptLock.tryLock(Math.min(5000, remainingMs));
		if (!didLock) {
			Utilities.sleep(ROSTER_LOCK_POLL_MS);
			continue;
		}

		try {
			const nowMs = Date.now();
			const current = parseRosterLockState_(props.getProperty(lockKey));
			if (!current || current.expiresAt <= nowMs) {
				props.setProperty(
					lockKey,
					JSON.stringify({
						token: token,
						expiresAt: nowMs + ROSTER_LOCK_LEASE_MS,
					}),
				);
				acquired = true;
			}
		} finally {
			scriptLock.releaseLock();
		}

		if (!acquired) Utilities.sleep(ROSTER_LOCK_POLL_MS);
	}

	if (!acquired) {
		throw new Error("Roster refresh is already running for '" + rosterId + "'. Please wait and try again.");
	}

	try {
		return callback();
	} finally {
		const releaseLock = LockService.getScriptLock();
		const didLock = releaseLock.tryLock(5000);
		if (!didLock) return;

		try {
			const current = parseRosterLockState_(props.getProperty(lockKey));
			if (current && current.token === token) {
				props.deleteProperty(lockKey);
			}
		} finally {
			releaseLock.releaseLock();
		}
	}
}

function hasValidAdminPassword_(password) {
	try {
		assertAdminPassword_(password);
		return true;
	} catch (err) {
		return false;
	}
}

function normalizeTag_(tagRaw) {
	const t = String(tagRaw == null ? "" : tagRaw)
		.trim()
		.toUpperCase();
	if (!t) return "";
	return t.startsWith("#") ? t : "#" + t;
}

function getRosterTrackingMode_(rosterRaw) {
	const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
	return roster.trackingMode === "regularWar" ? "regularWar" : "cwl";
}

function isValidPlayerTag_(tagRaw) {
	const tag = normalizeTag_(tagRaw);
	return /^#[PYLQGRJCUV0289]{3,15}$/.test(tag);
}

function isValidClanTag_(tagRaw) {
	return isValidPlayerTag_(tagRaw);
}

function encodeTagForPath_(tagRaw) {
	const normalized = normalizeTag_(tagRaw);
	if (!normalized) return "";
	return encodeURIComponent(normalized);
}

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

function findFirstFileByNameCandidates_(names) {
	return null;
}

function findFileByRelativePath_(pathRaw) {
	return null;
}

function inferAssetMimeType_(filename, providedMimeType) {
	const mimeType = String(providedMimeType || "").trim().toLowerCase();
	if (mimeType && mimeType !== "application/octet-stream") return mimeType;

	const lowerName = String(filename || "").toLowerCase();
	if (/\.webm$/i.test(lowerName)) return "video/webm";
	if (/\.mp4$/i.test(lowerName)) return "video/mp4";
	if (/\.ogv$/i.test(lowerName)) return "video/ogg";
	if (/\.we?bp$/i.test(lowerName)) return "image/webp";
	if (/\.png$/i.test(lowerName)) return "image/png";
	if (/\.jpe?g$/i.test(lowerName)) return "image/jpeg";
	if (/\.gif$/i.test(lowerName)) return "image/gif";
	return "application/octet-stream";
}

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

function readTownHallLevel_(obj) {
	const raw = obj && obj.townHallLevel != null ? obj.townHallLevel : obj && obj.townhallLevel != null ? obj.townhallLevel : null;
	const n = Number(raw);
	if (!isFinite(n)) return null;
	return Math.max(0, Math.floor(n));
}

function getCocApiToken_() {
	const token = String(PropertiesService.getScriptProperties().getProperty("COC_API_TOKEN") || "").trim();
	if (!token) {
		throw new Error("Missing Script Property COC_API_TOKEN.");
	}
	return token;
}

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

function cocFetch_(path) {
	const token = getCocApiToken_();
	const req = buildCocFetchRequestConfig_(path, token);
	const res = UrlFetchApp.fetch(req.url, req.params);
	return parseCocFetchResponse_(res);
}

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
		const batch = runnableEntries.slice(offset, offset + batchSize);
		if (!batch.length) continue;
		if (out.batchCount > 0 && batchDelayMs > 0) Utilities.sleep(batchDelayMs);
		out.batchCount++;

		const fetchAllRequests = [];
		for (let i = 0; i < batch.length; i++) {
			const config = requestConfigByKey[batch[i].key];
			fetchAllRequests.push(config.fetchAllRequest);
		}

		let responses = null;
		try {
			responses = UrlFetchApp.fetchAll(fetchAllRequests);
		} catch (err) {
			Logger.log("cocFetchAllByPathEntries: fetchAll batch failed (%s request(s)): %s", batch.length, errorMessage_(err));
			responses = null;
		}

		for (let i = 0; i < batch.length; i++) {
			const entry = batch[i];
			const config = requestConfigByKey[entry.key];
			try {
				const response =
					responses && Array.isArray(responses) && responses[i] && typeof responses[i].getResponseCode === "function"
						? responses[i]
						: UrlFetchApp.fetch(config.url, config.params);
				out.dataByKey[entry.key] = parseCocFetchResponse_(response);
			} catch (err) {
				out.errorByKey[entry.key] = err;
			}
		}
	}

	return out;
}

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

function sanitizeMetricsDayKey_(value) {
	const text = String(value == null ? "" : value).trim();
	return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function sanitizeDonationMonthKey_(value) {
	const text = String(value == null ? "" : value).trim();
	const match = /^(\d{4})-(\d{2})$/.exec(text);
	if (!match) return "";
	const month = Number(match[2]);
	if (!isFinite(month) || month < 1 || month > 12) return "";
	return match[1] + "-" + match[2];
}

function getDonationMonthSortValue_(value) {
	const key = sanitizeDonationMonthKey_(value);
	if (!key) return -1;
	const parts = key.split("-");
	const year = Number(parts[0]);
	const month = Number(parts[1]);
	if (!isFinite(year) || !isFinite(month)) return -1;
	return year * 12 + (month - 1);
}

function sanitizeMetricsIconUrls_(iconUrlsRaw) {
	const iconUrls = iconUrlsRaw && typeof iconUrlsRaw === "object" ? iconUrlsRaw : {};
	const out = {};
	const keys = ["tiny", "small", "medium"];
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		const value = String(iconUrls[key] == null ? "" : iconUrls[key]).trim();
		if (!value) continue;
		out[key] = value;
	}
	return Object.keys(out).length ? out : null;
}

function sanitizeMetricsLeagueSnapshot_(leagueRaw) {
	const league = leagueRaw && typeof leagueRaw === "object" ? leagueRaw : null;
	if (!league) return null;

	const id = toNonNegativeInt_(league.id);
	const name = String(league.name == null ? "" : league.name).trim();
	const iconUrls = sanitizeMetricsIconUrls_(league.iconUrls);
	if (!id && !name && !iconUrls) return null;

	const out = {};
	if (id > 0) out.id = id;
	if (name) out.name = name;
	if (iconUrls) out.iconUrls = iconUrls;
	return out;
}

function sanitizeMetricsPlayerHouseSnapshot_(playerHouseRaw) {
	const playerHouse = playerHouseRaw && typeof playerHouseRaw === "object" ? playerHouseRaw : null;
	if (!playerHouse) return null;
	const elementsRaw = Array.isArray(playerHouse.elements) ? playerHouse.elements : [];
	const outElements = [];
	for (let i = 0; i < elementsRaw.length && outElements.length < PLAYER_METRICS_PLAYER_HOUSE_MAX_ELEMENTS; i++) {
		const element = elementsRaw[i] && typeof elementsRaw[i] === "object" ? elementsRaw[i] : {};
		const id = toNonNegativeInt_(element.id);
		const type = String(element.type == null ? "" : element.type)
			.trim()
			.slice(0, 40);
		if (!id && !type) continue;
		const outElement = {};
		if (id > 0) outElement.id = id;
		if (type) outElement.type = type;
		outElements.push(outElement);
	}
	if (!outElements.length) return null;
	return { elements: outElements };
}

function sanitizeMetricsSnapshotPayload_(snapshotRaw, fallbackTagRaw) {
	const snapshot = snapshotRaw && typeof snapshotRaw === "object" ? snapshotRaw : {};
	const tag = normalizeTag_(snapshot.tag || fallbackTagRaw);
	if (!tag) return null;

	const out = {
		tag: tag,
		trophies: toNonNegativeInt_(snapshot.trophies),
		donations: toNonNegativeInt_(snapshot.donations),
		donationsReceived: toNonNegativeInt_(snapshot.donationsReceived),
	};

	const name = String(snapshot.name == null ? "" : snapshot.name).trim();
	if (name) out.name = name;

	const th = readTownHallLevel_(snapshot);
	if (isFinite(th) && th > 0) {
		out.townHallLevel = Math.floor(th);
		out.th = Math.floor(th);
	}

	if (snapshot.expLevel != null) out.expLevel = toNonNegativeInt_(snapshot.expLevel);
	if (snapshot.builderBaseTrophies != null) out.builderBaseTrophies = toNonNegativeInt_(snapshot.builderBaseTrophies);
	if (snapshot.clanRank != null) out.clanRank = toNonNegativeInt_(snapshot.clanRank);
	if (snapshot.previousClanRank != null) out.previousClanRank = toNonNegativeInt_(snapshot.previousClanRank);

	const mapPositionRaw = Number(snapshot.mapPosition);
	if (isFinite(mapPositionRaw)) out.mapPosition = Math.max(0, Math.floor(mapPositionRaw));

	const clanTag = normalizeTag_(snapshot.clanTag);
	if (clanTag) out.clanTag = clanTag;

	const capturedMs = parseIsoToMs_(snapshot.capturedAt);
	if (capturedMs > 0) out.capturedAt = new Date(capturedMs).toISOString();

	const league = sanitizeMetricsLeagueSnapshot_(snapshot.league);
	if (league) out.league = league;
	const leagueTier = sanitizeMetricsLeagueSnapshot_(snapshot.leagueTier);
	if (leagueTier) out.leagueTier = leagueTier;

	const builderBaseLeague = sanitizeMetricsLeagueSnapshot_(snapshot.builderBaseLeague);
	if (builderBaseLeague) out.builderBaseLeague = builderBaseLeague;

	const playerHouse = sanitizeMetricsPlayerHouseSnapshot_(snapshot.playerHouse);
	if (playerHouse) out.playerHouse = playerHouse;

	return out;
}

function mapApiMembersForMetricsSnapshot_(membersRaw) {
	const out = [];
	const seen = {};
	const list = Array.isArray(membersRaw) ? membersRaw : [];
	for (let i = 0; i < list.length; i++) {
		const member = list[i] && typeof list[i] === "object" ? list[i] : {};
		const tag = normalizeTag_(member.tag);
		if (!tag || seen[tag]) continue;
		seen[tag] = true;

		const th = readTownHallLevel_(member);
		const snapshot = {
			tag: tag,
			name: String(member.name == null ? "" : member.name),
			trophies: toNonNegativeInt_(member.trophies),
			donations: toNonNegativeInt_(member.donations),
			donationsReceived: toNonNegativeInt_(member.donationsReceived),
		};
		if (isFinite(th) && th > 0) {
			snapshot.townHallLevel = Math.floor(th);
			snapshot.th = Math.floor(th);
		}
		if (member.expLevel != null) snapshot.expLevel = toNonNegativeInt_(member.expLevel);
		if (member.builderBaseTrophies != null) snapshot.builderBaseTrophies = toNonNegativeInt_(member.builderBaseTrophies);
		if (member.clanRank != null) snapshot.clanRank = toNonNegativeInt_(member.clanRank);
		if (member.previousClanRank != null) snapshot.previousClanRank = toNonNegativeInt_(member.previousClanRank);
		if (member.mapPosition != null) {
			const mapPosition = Number(member.mapPosition);
			if (isFinite(mapPosition)) snapshot.mapPosition = Math.max(0, Math.floor(mapPosition));
		}
		const leagueTier = sanitizeMetricsLeagueSnapshot_(member.leagueTier);
		if (leagueTier) snapshot.leagueTier = leagueTier;
		const league = sanitizeMetricsLeagueSnapshot_(member.league) || leagueTier;
		if (league) snapshot.league = league;
		const builderBaseLeague = sanitizeMetricsLeagueSnapshot_(member.builderBaseLeague);
		if (builderBaseLeague) snapshot.builderBaseLeague = builderBaseLeague;
		const playerHouse = sanitizeMetricsPlayerHouseSnapshot_(member.playerHouse);
		if (playerHouse) snapshot.playerHouse = playerHouse;
		out.push(snapshot);
	}
	return out;
}

function buildPlayerMetricsProfileSnapshotCacheKey_(tagRaw) {
	const tag = normalizeTag_(tagRaw);
	if (!tag) return "";
	return "playerMetricsProfileSnapshot:" + PLAYER_METRICS_PROFILE_SNAPSHOT_CACHE_VERSION + ":" + encodeURIComponent(tag);
}

function readCachedPlayerMetricsProfileSnapshot_(tagRaw) {
	const tag = normalizeTag_(tagRaw);
	if (!tag) return null;
	const cache = getScriptCacheSafe_();
	const cacheKey = buildPlayerMetricsProfileSnapshotCacheKey_(tag);
	if (!cacheKey) return null;
	const raw = readStringFromCache_(cache, cacheKey);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		return sanitizeMetricsSnapshotPayload_(parsed, tag);
	} catch (err) {
		return null;
	}
}

function writeCachedPlayerMetricsProfileSnapshot_(tagRaw, snapshotRaw) {
	const tag = normalizeTag_(tagRaw);
	if (!tag) return;
	const snapshot = sanitizeMetricsSnapshotPayload_(snapshotRaw, tag);
	if (!snapshot) return;
	const cache = getScriptCacheSafe_();
	const cacheKey = buildPlayerMetricsProfileSnapshotCacheKey_(tag);
	if (!cacheKey) return;
	writeStringToCache_(cache, cacheKey, JSON.stringify(snapshot), PLAYER_METRICS_PROFILE_SNAPSHOT_CACHE_TTL_SECONDS);
}

function buildMetricsSnapshotFromPlayerProfile_(profileRaw, fallbackTagRaw) {
	const profile = profileRaw && typeof profileRaw === "object" ? profileRaw : {};
	const tag = normalizeTag_(profile.tag || fallbackTagRaw);
	if (!tag) return null;

	const clan = profile.clan && typeof profile.clan === "object" ? profile.clan : {};
	const th = readTownHallLevel_(profile);
	const snapshot = {
		tag: tag,
		name: String(profile.name == null ? "" : profile.name),
		trophies: toNonNegativeInt_(profile.trophies),
		donations: toNonNegativeInt_(profile.donations),
		donationsReceived: toNonNegativeInt_(profile.donationsReceived),
		capturedAt: new Date().toISOString(),
		clanTag: normalizeTag_(clan.tag),
		league: sanitizeMetricsLeagueSnapshot_(profile.league),
		leagueTier: sanitizeMetricsLeagueSnapshot_(profile.leagueTier),
		builderBaseLeague: sanitizeMetricsLeagueSnapshot_(profile.builderBaseLeague),
		playerHouse: sanitizeMetricsPlayerHouseSnapshot_(profile.playerHouse),
		expLevel: toNonNegativeInt_(profile.expLevel),
		builderBaseTrophies: toNonNegativeInt_(profile.builderBaseTrophies),
		clanRank: toNonNegativeInt_(profile.clanRank),
		previousClanRank: toNonNegativeInt_(profile.previousClanRank),
	};
	if (isFinite(th) && th > 0) {
		snapshot.townHallLevel = Math.floor(th);
		snapshot.th = Math.floor(th);
	}
	return sanitizeMetricsSnapshotPayload_(snapshot, tag);
}

function mergeMetricsSnapshotPreferAuthoritative_(fallbackRaw, authoritativeRaw) {
	const fallback = sanitizeMetricsSnapshotPayload_(fallbackRaw, "");
	const authoritative = sanitizeMetricsSnapshotPayload_(authoritativeRaw, fallback && fallback.tag);
	if (!fallback) return authoritative;
	if (!authoritative) return fallback;

	const merged = sanitizeMetricsSnapshotPayload_(authoritative, fallback.tag) || fallback;
	if ((merged.mapPosition == null || !isFinite(Number(merged.mapPosition))) && fallback.mapPosition != null) {
		merged.mapPosition = toNonNegativeInt_(fallback.mapPosition);
	}
	if (!merged.clanTag && fallback.clanTag) merged.clanTag = fallback.clanTag;
	if (!merged.capturedAt && fallback.capturedAt) merged.capturedAt = fallback.capturedAt;
	return merged;
}

function isMetricsSnapshotLikelyIncomplete_(snapshotRaw) {
	const snapshot = sanitizeMetricsSnapshotPayload_(snapshotRaw, "");
	if (!snapshot) return true;
	const trophies = toNonNegativeInt_(snapshot.trophies);
	const leagueName = String(snapshot && snapshot.league && snapshot.league.name != null ? snapshot.league.name : "").trim();
	const family = resolveHomeLeagueAssetFamily_(leagueName);

	if (!leagueName) return true;
	if (trophies <= 0) return true;
	if (family === "unranked" && trophies >= 400) return true;
	if (family === "legend" && trophies > 0 && trophies < 4900) return true;
	return false;
}

function shouldEnrichMetricsMembersWithProfiles_(membersRaw) {
	const members = Array.isArray(membersRaw) ? membersRaw : [];
	const total = members.length;
	if (total < PLAYER_METRICS_PROFILE_ENRICH_MIN_MEMBER_COUNT) return false;

	let nonZeroCount = 0;
	let unrankedCount = 0;
	let incompleteCount = 0;

	for (let i = 0; i < members.length; i++) {
		const snapshot = sanitizeMetricsSnapshotPayload_(members[i], "");
		if (!snapshot) {
			incompleteCount++;
			continue;
		}

		const trophies = toNonNegativeInt_(snapshot.trophies);
		if (trophies > 0) nonZeroCount++;
		if (isMetricsSnapshotLikelyIncomplete_(snapshot)) incompleteCount++;

			const leagueName = String(snapshot && snapshot.league && snapshot.league.name != null ? snapshot.league.name : "").trim();
			const family = resolveHomeLeagueAssetFamily_(leagueName);
			if (family === "unranked") unrankedCount++;
			if (family === "unranked" && trophies >= 400) return true;
			if (family === "legend" && trophies > 0 && trophies < 4900) return true;
		}

	const nonZeroRatio = total > 0 ? nonZeroCount / total : 0;
	const unrankedRatio = total > 0 ? unrankedCount / total : 0;
	const incompleteRatio = total > 0 ? incompleteCount / total : 0;
	if (incompleteRatio >= 0.6) return true;
	if (nonZeroRatio <= PLAYER_METRICS_PROFILE_ENRICH_MAX_NONZERO_RATIO && unrankedRatio >= PLAYER_METRICS_PROFILE_ENRICH_MIN_UNRANKED_RATIO) {
		return true;
	}
	return false;
}

function fetchAuthoritativePlayerMetricsSnapshot_(tagRaw, runStateRaw) {
	const tag = normalizeTag_(tagRaw);
	if (!tag) return null;
	const runState = runStateRaw && typeof runStateRaw === "object" ? runStateRaw : null;
	if (runState) {
		if (!runState.profileSnapshotByTag || typeof runState.profileSnapshotByTag !== "object") runState.profileSnapshotByTag = {};
		if (!runState.profileSnapshotErrorByTag || typeof runState.profileSnapshotErrorByTag !== "object") runState.profileSnapshotErrorByTag = {};
		if (runState.profileSnapshotByTag[tag]) return runState.profileSnapshotByTag[tag];
		if (runState.profileSnapshotErrorByTag[tag]) return null;
		if (runState.profileFetchBlocked) return null;
	}

	const cached = readCachedPlayerMetricsProfileSnapshot_(tag);
	if (cached) {
		if (runState) runState.profileSnapshotByTag[tag] = cached;
		return cached;
	}

	try {
		const profile = cocFetch_("/players/" + encodeTagForPath_(tag));
		const snapshot = buildMetricsSnapshotFromPlayerProfile_(profile, tag);
		if (!snapshot) return null;
		writeCachedPlayerMetricsProfileSnapshot_(tag, snapshot);
		if (runState) runState.profileSnapshotByTag[tag] = snapshot;
		return snapshot;
	} catch (err) {
		if (runState) {
			runState.profileSnapshotErrorByTag[tag] = true;
			if (err && Number(err.statusCode) === 429) runState.profileFetchBlocked = true;
		}
		Logger.log("Unable to fetch authoritative player metrics snapshot for %s: %s", tag, errorMessage_(err));
		return null;
	}
}

function enrichMetricsMembersWithProfiles_(membersRaw, optionsRaw) {
	const members = Array.isArray(membersRaw) ? membersRaw : [];
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const modeRaw = String(options.mode == null ? "auto" : options.mode)
		.trim()
		.toLowerCase();
	const mode = modeRaw === "always" || modeRaw === "never" ? modeRaw : "auto";
	if (!members.length || mode === "never") {
		return { members: members, attempted: 0, enriched: 0, enabled: false };
	}

	const shouldEnrichAll = mode === "always" ? true : shouldEnrichMetricsMembersWithProfiles_(members);

	const runState = options.runState && typeof options.runState === "object" ? options.runState : {};
	const out = [];
	let attempted = 0;
	let enriched = 0;

	for (let i = 0; i < members.length; i++) {
		const baseline = sanitizeMetricsSnapshotPayload_(members[i], "");
		if (!baseline) continue;
		const tag = normalizeTag_(baseline.tag);
			if (!tag) {
				out.push(baseline);
				continue;
			}
			const shouldFetchProfile = shouldEnrichAll || isMetricsSnapshotLikelyIncomplete_(baseline);
			if (!shouldFetchProfile) {
				out.push(baseline);
				continue;
			}
			attempted++;
			const authoritative = fetchAuthoritativePlayerMetricsSnapshot_(tag, runState);
			if (!authoritative) {
				out.push(baseline);
				continue;
		}
		const merged = mergeMetricsSnapshotPreferAuthoritative_(baseline, authoritative);
		out.push(merged || baseline);
		enriched++;
	}

	return {
		members: out.length ? out : members,
		attempted: attempted,
		enriched: enriched,
		enabled: shouldEnrichAll || attempted > 0,
	};
}

function sanitizeMetricsTrophyHistoryPoint_(pointRaw) {
	const point = pointRaw && typeof pointRaw === "object" ? pointRaw : {};
	const dayKey = sanitizeMetricsDayKey_(point.dayKey);
	if (!dayKey) return null;

	const out = {
		dayKey: dayKey,
		trophies: toNonNegativeInt_(point.trophies),
	};

	const capturedMs = parseIsoToMs_(point.capturedAt);
	if (capturedMs > 0) out.capturedAt = new Date(capturedMs).toISOString();

	const clanTag = normalizeTag_(point.clanTag);
	if (clanTag) out.clanTag = clanTag;

	const league = sanitizeMetricsLeagueSnapshot_(point.league);
	if (league) out.league = league;

	return out;
}

function sanitizeMetricsDonationMonthLedger_(ledgerRaw, monthKeyRaw) {
	const ledger = ledgerRaw && typeof ledgerRaw === "object" ? ledgerRaw : {};
	const monthKey = sanitizeDonationMonthKey_(monthKeyRaw || ledger.monthKey);
	if (!monthKey) return null;

	const out = {
		monthKey: monthKey,
		rawDonationsLastSeen: toNonNegativeInt_(ledger.rawDonationsLastSeen),
		rawDonationsReceivedLastSeen: toNonNegativeInt_(ledger.rawDonationsReceivedLastSeen),
		monthlyTotalDonations: toNonNegativeInt_(ledger.monthlyTotalDonations),
		monthlyTotalDonationsReceived: toNonNegativeInt_(ledger.monthlyTotalDonationsReceived),
		lastSeenAt: "",
		lastClanTag: "",
		resetCount: toNonNegativeInt_(ledger.resetCount),
		receivedResetCount: toNonNegativeInt_(ledger.receivedResetCount),
	};

	const lastSeenMs = parseIsoToMs_(ledger.lastSeenAt);
	if (lastSeenMs > 0) out.lastSeenAt = new Date(lastSeenMs).toISOString();

	const lastClanTag = normalizeTag_(ledger.lastClanTag);
	if (lastClanTag) out.lastClanTag = lastClanTag;

	return out;
}

function createEmptyPlayerMetricsStore_() {
	return {
		schemaVersion: PLAYER_METRICS_SCHEMA_VERSION,
		updatedAt: "",
		byTag: {},
	};
}

function createEmptyPlayerMetricsEntry_(tagRaw, nameRaw) {
	const tag = normalizeTag_(tagRaw);
	return {
		identity: {
			tag: tag,
			name: String(nameRaw == null ? "" : nameRaw).trim(),
		},
		lastSeen: {},
		trophyHistoryDaily: [],
		donationMonths: {},
	};
}

function areMetricsSnapshotsEquivalent_(leftRaw, rightRaw) {
	const left = sanitizeMetricsSnapshotPayload_(leftRaw, "");
	const right = sanitizeMetricsSnapshotPayload_(rightRaw, "");
	if (!left || !right) return !left && !right;
	const l = Object.assign({}, left);
	const r = Object.assign({}, right);
	delete l.capturedAt;
	delete r.capturedAt;
	return JSON.stringify(l) === JSON.stringify(r);
}

function areMetricsTrophyPointsEquivalent_(leftRaw, rightRaw) {
	const left = sanitizeMetricsTrophyHistoryPoint_(leftRaw);
	const right = sanitizeMetricsTrophyHistoryPoint_(rightRaw);
	if (!left || !right) return !left && !right;
	return left.dayKey === right.dayKey && left.trophies === right.trophies && normalizeTag_(left.clanTag) === normalizeTag_(right.clanTag) && JSON.stringify(left.league || null) === JSON.stringify(right.league || null);
}

function pruneTrophyHistoryDaily_(historyRaw, nowDateRaw) {
	const history = Array.isArray(historyRaw) ? historyRaw : [];
	const nowDate = nowDateRaw instanceof Date ? nowDateRaw : new Date();
	const byDayKey = {};

	for (let i = 0; i < history.length; i++) {
		const point = sanitizeMetricsTrophyHistoryPoint_(history[i]);
		if (!point) continue;
		const existing = byDayKey[point.dayKey];
		if (!existing) {
			byDayKey[point.dayKey] = point;
			continue;
		}
		const existingMs = parseIsoToMs_(existing.capturedAt);
		const currentMs = parseIsoToMs_(point.capturedAt);
		if (currentMs >= existingMs) {
			byDayKey[point.dayKey] = point;
		}
	}

	const keys = Object.keys(byDayKey).sort();
	const cutoffDate = new Date(nowDate.getTime() - (PLAYER_METRICS_TROPHY_HISTORY_MAX_DAYS - 1) * 24 * 60 * 60 * 1000);
	const cutoffKey = getServerDateString_(cutoffDate);
	const pruned = [];
	for (let i = 0; i < keys.length; i++) {
		const dayKey = keys[i];
		if (dayKey < cutoffKey) continue;
		pruned.push(byDayKey[dayKey]);
	}
	if (pruned.length > PLAYER_METRICS_TROPHY_HISTORY_MAX_DAYS) {
		return pruned.slice(pruned.length - PLAYER_METRICS_TROPHY_HISTORY_MAX_DAYS);
	}
	return pruned;
}

function pruneDonationMonths_(donationMonthsRaw) {
	const donationMonths = donationMonthsRaw && typeof donationMonthsRaw === "object" ? donationMonthsRaw : {};
	const keys = Object.keys(donationMonths)
		.map((key) => sanitizeDonationMonthKey_(key))
		.filter((key) => key)
		.sort((left, right) => getDonationMonthSortValue_(left) - getDonationMonthSortValue_(right));

	const limitedKeys = keys.length > PLAYER_METRICS_DONATION_MONTHS_MAX ? keys.slice(keys.length - PLAYER_METRICS_DONATION_MONTHS_MAX) : keys;
	const out = {};
	for (let i = 0; i < limitedKeys.length; i++) {
		const key = limitedKeys[i];
		const ledger = sanitizeMetricsDonationMonthLedger_(donationMonths[key], key);
		if (!ledger) continue;
		out[key] = ledger;
	}
	return out;
}

function getPlayerMetricsEntryEvidenceMs_(entryRaw) {
	const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
	let best = 0;
	const keepBest = (valueRaw) => {
		const ms = parseIsoToMs_(valueRaw);
		if (ms > best) best = ms;
	};

	const lastSeen = entry.lastSeen && typeof entry.lastSeen === "object" ? entry.lastSeen : {};
	keepBest(lastSeen.at);

	const latestSnapshot = entry.latestSnapshot && typeof entry.latestSnapshot === "object" ? entry.latestSnapshot : {};
	keepBest(latestSnapshot.capturedAt);

	const history = Array.isArray(entry.trophyHistoryDaily) ? entry.trophyHistoryDaily : [];
	for (let i = 0; i < history.length; i++) {
		const point = history[i] && typeof history[i] === "object" ? history[i] : {};
		keepBest(point.capturedAt);
		const dayKey = sanitizeMetricsDayKey_(point.dayKey);
		if (dayKey) {
			const dayMs = new Date(dayKey + "T00:00:00Z").getTime();
			if (isFinite(dayMs) && dayMs > best) best = dayMs;
		}
	}

	const donationMonths = entry.donationMonths && typeof entry.donationMonths === "object" ? entry.donationMonths : {};
	const donationKeys = Object.keys(donationMonths);
	for (let i = 0; i < donationKeys.length; i++) {
		const key = donationKeys[i];
		const ledger = donationMonths[key] && typeof donationMonths[key] === "object" ? donationMonths[key] : {};
		keepBest(ledger.lastSeenAt);
		const monthKey = sanitizeDonationMonthKey_(key);
		if (monthKey) {
			const monthMs = new Date(monthKey + "-01T00:00:00Z").getTime();
			if (isFinite(monthMs) && monthMs > best) best = monthMs;
		}
	}

	return best;
}

function sanitizePlayerMetricsEntry_(tagRaw, entryRaw, nowMsRaw, nowDateRaw) {
	const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
	const identity = entry.identity && typeof entry.identity === "object" ? entry.identity : {};
	const tag = normalizeTag_(tagRaw || identity.tag || (entry.latestSnapshot && entry.latestSnapshot.tag));
	if (!tag) return null;

	const nowMs = isFinite(Number(nowMsRaw)) ? Number(nowMsRaw) : Date.now();
	const nowDate = nowDateRaw instanceof Date ? nowDateRaw : new Date(nowMs);

	const latestSnapshot = sanitizeMetricsSnapshotPayload_(entry.latestSnapshot, tag);
	const nameCandidate = String(identity.name == null ? "" : identity.name).trim() || String(entry.name == null ? "" : entry.name).trim() || (latestSnapshot && latestSnapshot.name ? latestSnapshot.name : "");

	const lastSeenRaw = entry.lastSeen && typeof entry.lastSeen === "object" ? entry.lastSeen : {};
	const lastSeenAtMs = parseIsoToMs_(lastSeenRaw.at || entry.lastSeenAt);
	const lastSeen = {};
	if (lastSeenAtMs > 0) {
		lastSeen.at = new Date(lastSeenAtMs).toISOString();
	}
	const dayKey = sanitizeMetricsDayKey_(lastSeenRaw.dayKey || entry.lastSeenDayKey) || (lastSeen.at ? getServerDateString_(new Date(lastSeen.at)) : "");
	if (dayKey) lastSeen.dayKey = dayKey;
	const monthKey = sanitizeDonationMonthKey_(lastSeenRaw.monthKey || entry.lastSeenMonthKey) || (lastSeen.at ? getServerMonthKey_(new Date(lastSeen.at)) : dayKey ? dayKey.slice(0, 7) : "");
	if (monthKey) lastSeen.monthKey = monthKey;
	const lastSeenClanTag = normalizeTag_(lastSeenRaw.clanTag || entry.lastClanTag || (latestSnapshot && latestSnapshot.clanTag));
	if (lastSeenClanTag) lastSeen.clanTag = lastSeenClanTag;

	const trophyHistoryDaily = pruneTrophyHistoryDaily_(entry.trophyHistoryDaily, nowDate);
	const donationMonths = pruneDonationMonths_(entry.donationMonths);

	const out = {
		identity: {
			tag: tag,
			name: nameCandidate,
		},
		trophyHistoryDaily: trophyHistoryDaily,
		donationMonths: donationMonths,
	};
	if (latestSnapshot) out.latestSnapshot = latestSnapshot;
	if (Object.keys(lastSeen).length) out.lastSeen = lastSeen;

	const hasAnyData = !!out.latestSnapshot || out.trophyHistoryDaily.length > 0 || Object.keys(out.donationMonths).length > 0;
	if (!hasAnyData) return null;

	const retentionMs = PLAYER_METRICS_ENTRY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
	const evidenceMs = getPlayerMetricsEntryEvidenceMs_(out);
	if (evidenceMs > 0 && nowMs - evidenceMs > retentionMs) {
		return null;
	}

	return out;
}

function sanitizePlayerMetricsStore_(storeRaw, nowIsoRaw) {
	const store = storeRaw && typeof storeRaw === "object" ? storeRaw : {};
	const nowMs = parseIsoToMs_(nowIsoRaw) || Date.now();
	const nowDate = new Date(nowMs);
	const updatedAtMs = parseIsoToMs_(store.updatedAt);
	const byTagRaw = store.byTag && typeof store.byTag === "object" ? store.byTag : {};
	const outByTag = {};
	const tagKeys = Object.keys(byTagRaw);
	for (let i = 0; i < tagKeys.length; i++) {
		const key = tagKeys[i];
		const sanitizedEntry = sanitizePlayerMetricsEntry_(key, byTagRaw[key], nowMs, nowDate);
		if (!sanitizedEntry) continue;
		const tag = sanitizeEntryTag_(sanitizedEntry);
		if (!tag) continue;
		outByTag[tag] = sanitizedEntry;
	}

	return {
		schemaVersion: PLAYER_METRICS_SCHEMA_VERSION,
		updatedAt: updatedAtMs > 0 ? new Date(updatedAtMs).toISOString() : "",
		byTag: outByTag,
	};
}

function sanitizeEntryTag_(entryRaw) {
	const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
	const identity = entry.identity && typeof entry.identity === "object" ? entry.identity : {};
	return normalizeTag_(identity.tag || (entry.latestSnapshot && entry.latestSnapshot.tag));
}

function ensurePlayerMetricsStore_(rosterData) {
	if (!rosterData || typeof rosterData !== "object") return createEmptyPlayerMetricsStore_();
	const sanitized = sanitizePlayerMetricsStore_(rosterData.playerMetrics, new Date().toISOString());
	rosterData.playerMetrics = sanitized;
	return sanitized;
}

function countPlayerMetricsEntries_(storeRaw) {
	const store = storeRaw && typeof storeRaw === "object" ? storeRaw : {};
	const byTag = store.byTag && typeof store.byTag === "object" ? store.byTag : {};
	const keys = Object.keys(byTag);
	let count = 0;
	for (let i = 0; i < keys.length; i++) {
		if (normalizeTag_(keys[i])) count++;
	}
	return count;
}

function listRostersNeedingMetricsCoverageRepair_(rosterDataRaw, minCoverageRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const rosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	const store = rosterData.playerMetrics && typeof rosterData.playerMetrics === "object" ? rosterData.playerMetrics : {};
	const byTagRaw = store.byTag && typeof store.byTag === "object" ? store.byTag : {};
	const byTag = {};
	const keys = Object.keys(byTagRaw);
	for (let i = 0; i < keys.length; i++) {
		const normalized = normalizeTag_(keys[i]);
		if (!normalized) continue;
		byTag[normalized] = byTagRaw[keys[i]];
	}

	const minCoverage = Math.max(0, Math.min(1, Number(minCoverageRaw)));
	const out = [];
	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		const rosterId = String(roster.id == null ? "" : roster.id).trim();
		if (!rosterId) continue;

		const connectedClanTag = normalizeTag_(roster.connectedClanTag);
		const players = collectRosterPoolPlayers_(roster);
		const seen = {};
		let total = 0;
		let matched = 0;
		for (let j = 0; j < players.length; j++) {
			const tag = normalizeTag_(players[j] && players[j].tag);
			if (!tag || seen[tag]) continue;
			seen[tag] = true;
			total++;
			if (byTag[tag] && typeof byTag[tag] === "object") matched++;
		}

		if (total < 1) continue;
		const coverage = matched / total;
		if (coverage >= minCoverage) continue;
		out.push({
			rosterId: rosterId,
			clanTag: connectedClanTag,
			totalTags: total,
			matchedTags: matched,
			coverage: coverage,
		});
	}
	return out;
}

function listConnectedClanTagsForMetrics_(rosterDataRaw, rosterIdFilterRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const rosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	const rosterIdFilter = String(rosterIdFilterRaw == null ? "" : rosterIdFilterRaw).trim();
	const seen = {};
	const out = [];

	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		const rosterId = String(roster.id || "").trim();
		if (rosterIdFilter && rosterId !== rosterIdFilter) continue;
		const clanTag = normalizeTag_(roster.connectedClanTag);
		if (!clanTag || seen[clanTag]) continue;
		seen[clanTag] = true;
		out.push(clanTag);
	}

	return out;
}

function captureConnectedClanMetrics_(rosterDataRaw, optionsRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : null;
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const rosterIdFilter = String(options.rosterId == null ? "" : options.rosterId).trim();
	const continueOnError = options.continueOnError !== false;
	const metricsProfileModeRaw = String(options.metricsProfileMode == null ? "auto" : options.metricsProfileMode)
		.trim()
		.toLowerCase();
	const metricsProfileMode = metricsProfileModeRaw === "always" || metricsProfileModeRaw === "never" ? metricsProfileModeRaw : "auto";
	const prefetchedClanSnapshotsByTag = options.prefetchedClanSnapshotsByTag && typeof options.prefetchedClanSnapshotsByTag === "object" ? options.prefetchedClanSnapshotsByTag : {};
	const prefetchedClanErrorsByTag = options.prefetchedClanErrorsByTag && typeof options.prefetchedClanErrorsByTag === "object" ? options.prefetchedClanErrorsByTag : {};
	if (!rosterData) {
		return { attemptedClans: 0, capturedClans: 0, recorded: 0, updated: 0, errors: [], entryCount: 0 };
	}

	const clanTags = listConnectedClanTagsForMetrics_(rosterData, rosterIdFilter);
	const runState = options.runState && typeof options.runState === "object"
		? options.runState
		: { seenClanTags: {}, profileSnapshotByTag: {}, profileSnapshotErrorByTag: {}, profileFetchBlocked: false };
	if (!runState.seenClanTags || typeof runState.seenClanTags !== "object") runState.seenClanTags = {};
	if (!runState.profileSnapshotByTag || typeof runState.profileSnapshotByTag !== "object") runState.profileSnapshotByTag = {};
	if (!runState.profileSnapshotErrorByTag || typeof runState.profileSnapshotErrorByTag !== "object") runState.profileSnapshotErrorByTag = {};
	if (typeof runState.profileFetchBlocked !== "boolean") runState.profileFetchBlocked = false;
	const errors = [];
	let capturedClans = 0;
	let recorded = 0;
	let updated = 0;
	let profileEnriched = 0;
	let profileAttempted = 0;

	for (let i = 0; i < clanTags.length; i++) {
		const clanTag = clanTags[i];
		try {
			const hasPrefetchedError = Object.prototype.hasOwnProperty.call(prefetchedClanErrorsByTag, clanTag);
			if (hasPrefetchedError) throw prefetchedClanErrorsByTag[clanTag];
			const hasPrefetchedSnapshot = Object.prototype.hasOwnProperty.call(prefetchedClanSnapshotsByTag, clanTag);
			const snapshot = hasPrefetchedSnapshot ? prefetchedClanSnapshotsByTag[clanTag] : fetchClanMembersSnapshot_(clanTag);
			const enriched = enrichMetricsMembersWithProfiles_(snapshot && snapshot.metricsMembers, {
				mode: metricsProfileMode,
				runState: runState,
			});
			const metricsMembers = enriched && Array.isArray(enriched.members) ? enriched.members : snapshot && snapshot.metricsMembers;
			profileEnriched += toNonNegativeInt_(enriched && enriched.enriched);
			profileAttempted += toNonNegativeInt_(enriched && enriched.attempted);
			const result = recordClanMemberMetricsSnapshot_(rosterData, clanTag, metricsMembers, {
				capturedAt: snapshot && snapshot.capturedAt,
				runState: runState,
				source: "captureConnectedClanMetrics",
			});
			capturedClans++;
			recorded += toNonNegativeInt_(result && result.recorded);
			updated += toNonNegativeInt_(result && result.updated);
		} catch (err) {
			const message = errorMessage_(err);
			errors.push({ clanTag: clanTag, message: message });
			if (!continueOnError) throw err;
		}
	}

	ensurePlayerMetricsStore_(rosterData);
	return {
		attemptedClans: clanTags.length,
		capturedClans: capturedClans,
		recorded: recorded,
		updated: updated,
		errors: errors,
		entryCount: countPlayerMetricsEntries_(rosterData.playerMetrics),
		profileEnriched: profileEnriched,
		profileAttempted: profileAttempted,
		metricsProfileMode: metricsProfileMode,
	};
}

function captureRosterPoolProfileMetrics_(rosterDataRaw, rosterIdRaw, optionsRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : null;
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	if (!rosterData || !rosterId) {
		return { attemptedClans: 0, capturedClans: 0, recorded: 0, updated: 0, errors: [], entryCount: 0, profileAttempted: 0, profileEnriched: 0, metricsProfileMode: "always", usedProfileFallback: true };
	}

	const ctx = findRosterById_(rosterData, rosterId);
	const roster = ctx && ctx.roster ? ctx.roster : null;
	if (!roster) {
		return { attemptedClans: 0, capturedClans: 0, recorded: 0, updated: 0, errors: [], entryCount: 0, profileAttempted: 0, profileEnriched: 0, metricsProfileMode: "always", usedProfileFallback: true };
	}

	const connectedClanTag = normalizeTag_(roster.connectedClanTag);
	const players = collectRosterPoolPlayers_(roster);
	const profileRunState = options.profileRunState && typeof options.profileRunState === "object" ? options.profileRunState : {};
	const snapshotsByClanTag = {};
	const seenTags = {};
	const errors = [];
	let profileAttempted = 0;
	let profileEnriched = 0;

	for (let i = 0; i < players.length; i++) {
		const tag = normalizeTag_(players[i] && players[i].tag);
		if (!tag || seenTags[tag] || !isValidPlayerTag_(tag)) continue;
		seenTags[tag] = true;
		profileAttempted++;

		const snapshot = fetchAuthoritativePlayerMetricsSnapshot_(tag, profileRunState);
		if (!snapshot) {
			errors.push({ clanTag: connectedClanTag || "", message: "Unable to fetch player profile snapshot for " + tag + "." });
			continue;
		}

		profileEnriched++;
		const clanTag = normalizeTag_(snapshot.clanTag) || connectedClanTag || "#0";
		const normalizedSnapshot = sanitizeMetricsSnapshotPayload_(Object.assign({}, snapshot, { clanTag: clanTag }), tag);
		if (!normalizedSnapshot) continue;
		if (!snapshotsByClanTag[clanTag]) snapshotsByClanTag[clanTag] = [];
		snapshotsByClanTag[clanTag].push(normalizedSnapshot);
	}

	let recorded = 0;
	let updated = 0;
	const clanTags = Object.keys(snapshotsByClanTag);
	for (let i = 0; i < clanTags.length; i++) {
		const clanTag = clanTags[i];
		const snapshots = snapshotsByClanTag[clanTag];
		if (!Array.isArray(snapshots) || !snapshots.length) continue;
		const result = recordClanMemberMetricsSnapshot_(ctx.rosterData, clanTag, snapshots, {
			source: "captureRosterPoolProfileMetrics",
		});
		recorded += toNonNegativeInt_(result && result.recorded);
		updated += toNonNegativeInt_(result && result.updated);
	}

	ensurePlayerMetricsStore_(ctx.rosterData);
	return {
		attemptedClans: clanTags.length,
		capturedClans: clanTags.length,
		recorded: recorded,
		updated: updated,
		errors: errors,
		entryCount: countPlayerMetricsEntries_(ctx.rosterData.playerMetrics),
		profileAttempted: profileAttempted,
		profileEnriched: profileEnriched,
		metricsProfileMode: "always",
		usedProfileFallback: true,
	};
}

function captureMemberTrackingForRoster_(rosterDataRaw, rosterIdRaw, optionsRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : null;
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	if (!rosterData || !rosterId) {
		return { attemptedClans: 0, capturedClans: 0, recorded: 0, updated: 0, errors: [], entryCount: 0 };
	}
	const metricsProfileModeRaw = String(options.metricsProfileMode == null ? "auto" : options.metricsProfileMode)
		.trim()
		.toLowerCase();
	const metricsProfileMode = metricsProfileModeRaw === "always" || metricsProfileModeRaw === "never" ? metricsProfileModeRaw : "auto";
	const primary = captureConnectedClanMetrics_(rosterData, {
		rosterId: rosterId,
		continueOnError: options.continueOnError !== false,
		metricsProfileMode: metricsProfileMode,
		runState: options.runState,
	});
	if (metricsProfileMode !== "always") return primary;

	// When strict profile mode is requested, also refresh directly from player profiles
	// so metrics still update even if clan-member snapshots are incomplete or unavailable.
	const fallback = captureRosterPoolProfileMetrics_(rosterData, rosterId, {
		profileRunState: options.runState && options.runState.profileRunState,
	});

	return {
		attemptedClans: toNonNegativeInt_(primary && primary.attemptedClans) + toNonNegativeInt_(fallback && fallback.attemptedClans),
		capturedClans: toNonNegativeInt_(primary && primary.capturedClans) + toNonNegativeInt_(fallback && fallback.capturedClans),
		recorded: toNonNegativeInt_(primary && primary.recorded) + toNonNegativeInt_(fallback && fallback.recorded),
		updated: toNonNegativeInt_(primary && primary.updated) + toNonNegativeInt_(fallback && fallback.updated),
		errors: []
			.concat(primary && Array.isArray(primary.errors) ? primary.errors : [])
			.concat(fallback && Array.isArray(fallback.errors) ? fallback.errors : []),
		entryCount: countPlayerMetricsEntries_(rosterData.playerMetrics),
		profileAttempted: toNonNegativeInt_(primary && primary.profileAttempted) + toNonNegativeInt_(fallback && fallback.profileAttempted),
		profileEnriched: toNonNegativeInt_(primary && primary.profileEnriched) + toNonNegativeInt_(fallback && fallback.profileEnriched),
		metricsProfileMode: "always",
		usedProfileFallback: true,
	};
}

function buildMetricsCaptureContext_(capturedAtRaw) {
	const capturedMs = parseIsoToMs_(capturedAtRaw);
	const capturedAt = capturedMs > 0 ? new Date(capturedMs).toISOString() : new Date().toISOString();
	const capturedDate = new Date(capturedAt);
	return {
		capturedAt: capturedAt,
		capturedDate: capturedDate,
		dayKey: getServerDateString_(capturedDate),
		monthKey: getServerMonthKey_(capturedDate),
	};
}

function upsertDailyTrophyHistoryPoint_(entry, pointRaw, captureDateRaw) {
	const entryObj = entry && typeof entry === "object" ? entry : {};
	const point = sanitizeMetricsTrophyHistoryPoint_(pointRaw);
	if (!point) return false;
	const captureDate = captureDateRaw instanceof Date ? captureDateRaw : new Date();
	const history = Array.isArray(entryObj.trophyHistoryDaily) ? entryObj.trophyHistoryDaily.slice() : [];

	let replaced = false;
	for (let i = 0; i < history.length; i++) {
		const existing = sanitizeMetricsTrophyHistoryPoint_(history[i]);
		if (!existing || existing.dayKey !== point.dayKey) continue;
		if (!areMetricsTrophyPointsEquivalent_(existing, point)) {
			history[i] = point;
			replaced = true;
		}
		const prunedSameDay = pruneTrophyHistoryDaily_(history, captureDate);
		const changedSameDay = replaced || JSON.stringify(prunedSameDay) !== JSON.stringify(entryObj.trophyHistoryDaily || []);
		entryObj.trophyHistoryDaily = prunedSameDay;
		return changedSameDay;
	}

	history.push(point);
	const pruned = pruneTrophyHistoryDaily_(history, captureDate);
	const changed = JSON.stringify(pruned) !== JSON.stringify(entryObj.trophyHistoryDaily || []);
	entryObj.trophyHistoryDaily = pruned;
	return changed;
}

function updateDonationLedgerValue_(ledger, rawValue, rawFieldName, totalFieldName, resetFieldName) {
	const state = ledger && typeof ledger === "object" ? ledger : {};
	const currentRaw = toNonNegativeInt_(rawValue);
	const hasPrevious = Object.prototype.hasOwnProperty.call(state, rawFieldName);
	const previousRaw = hasPrevious ? toNonNegativeInt_(state[rawFieldName]) : null;

	let delta = currentRaw;
	let resetDetected = false;
	if (previousRaw != null) {
		if (currentRaw >= previousRaw) {
			delta = currentRaw - previousRaw;
		} else {
			delta = currentRaw;
			resetDetected = true;
		}
	}

	state[rawFieldName] = currentRaw;
	state[totalFieldName] = toNonNegativeInt_(state[totalFieldName]) + delta;
	if (resetDetected) {
		state[resetFieldName] = toNonNegativeInt_(state[resetFieldName]) + 1;
	} else if (!Object.prototype.hasOwnProperty.call(state, resetFieldName)) {
		state[resetFieldName] = 0;
	}

	return {
		delta: delta,
		resetDetected: resetDetected,
	};
}

function updateMonthlyDonationLedgerForSnapshot_(entry, snapshotRaw, captureCtx) {
	const entryObj = entry && typeof entry === "object" ? entry : {};
	const snapshot = sanitizeMetricsSnapshotPayload_(snapshotRaw, "");
	const context = captureCtx && typeof captureCtx === "object" ? captureCtx : buildMetricsCaptureContext_("");
	if (!snapshot) return false;
	const monthKey = sanitizeDonationMonthKey_(context.monthKey);
	if (!monthKey) return false;

	const donationMonths = entryObj.donationMonths && typeof entryObj.donationMonths === "object" ? entryObj.donationMonths : {};
	const before = JSON.stringify(pruneDonationMonths_(donationMonths));
	const currentLedger = sanitizeMetricsDonationMonthLedger_(donationMonths[monthKey], monthKey) || {
		monthKey: monthKey,
		rawDonationsLastSeen: 0,
		rawDonationsReceivedLastSeen: 0,
		monthlyTotalDonations: 0,
		monthlyTotalDonationsReceived: 0,
		lastSeenAt: "",
		lastClanTag: "",
		resetCount: 0,
		receivedResetCount: 0,
	};

	const donationResult = updateDonationLedgerValue_(currentLedger, snapshot.donations, "rawDonationsLastSeen", "monthlyTotalDonations", "resetCount");
	const receivedResult = updateDonationLedgerValue_(currentLedger, snapshot.donationsReceived, "rawDonationsReceivedLastSeen", "monthlyTotalDonationsReceived", "receivedResetCount");

	if (donationResult.delta > 0 || receivedResult.delta > 0 || donationResult.resetDetected || receivedResult.resetDetected || !currentLedger.lastSeenAt) {
		currentLedger.lastSeenAt = context.capturedAt;
	}
	const clanTag = normalizeTag_(snapshot.clanTag);
	if (clanTag) currentLedger.lastClanTag = clanTag;

	donationMonths[monthKey] = currentLedger;
	entryObj.donationMonths = pruneDonationMonths_(donationMonths);
	const after = JSON.stringify(entryObj.donationMonths);
	return before !== after;
}

function updatePlayerMetricsEntryFromSnapshot_(entry, snapshotRaw, captureCtxRaw) {
	const entryObj = entry && typeof entry === "object" ? entry : {};
	const captureCtx = captureCtxRaw && typeof captureCtxRaw === "object" ? captureCtxRaw : buildMetricsCaptureContext_("");
	const snapshot = sanitizeMetricsSnapshotPayload_(snapshotRaw, "");
	if (!snapshot) return false;

	if (!snapshot.capturedAt) snapshot.capturedAt = captureCtx.capturedAt;
	if (!snapshot.clanTag && captureCtx.clanTag) snapshot.clanTag = captureCtx.clanTag;

	const tag = normalizeTag_(snapshot.tag);
	if (!tag) return false;

	const identity = entryObj.identity && typeof entryObj.identity === "object" ? entryObj.identity : {};
	const currentName = String(identity.name == null ? "" : identity.name).trim();
	const nextName = String(snapshot.name == null ? "" : snapshot.name).trim() || currentName;
	entryObj.identity = {
		tag: tag,
		name: nextName,
	};

	const currentLatest = sanitizeMetricsSnapshotPayload_(entryObj.latestSnapshot, tag);
	let latestChanged = false;
	if (!currentLatest || !areMetricsSnapshotsEquivalent_(currentLatest, snapshot)) {
		entryObj.latestSnapshot = snapshot;
		latestChanged = true;
	} else if (currentLatest && !currentLatest.capturedAt && snapshot.capturedAt) {
		currentLatest.capturedAt = snapshot.capturedAt;
		entryObj.latestSnapshot = currentLatest;
		latestChanged = true;
	}

	const point = {
		dayKey: captureCtx.dayKey,
		capturedAt: captureCtx.capturedAt,
		trophies: toNonNegativeInt_(snapshot.trophies),
		clanTag: normalizeTag_(snapshot.clanTag),
		league: sanitizeMetricsLeagueSnapshot_(snapshot.league),
	};
	const trophyChanged = upsertDailyTrophyHistoryPoint_(entryObj, point, captureCtx.capturedDate);
	const donationChanged = updateMonthlyDonationLedgerForSnapshot_(entryObj, snapshot, captureCtx);

	const lastSeen = entryObj.lastSeen && typeof entryObj.lastSeen === "object" ? entryObj.lastSeen : {};
	const lastSeenDayKey = sanitizeMetricsDayKey_(lastSeen.dayKey);
	const shouldUpdateLastSeen = lastSeenDayKey !== captureCtx.dayKey || latestChanged || trophyChanged || donationChanged || !lastSeen.dayKey;
	if (shouldUpdateLastSeen) {
		entryObj.lastSeen = {
			at: captureCtx.capturedAt,
			dayKey: captureCtx.dayKey,
			monthKey: captureCtx.monthKey,
			clanTag: normalizeTag_(snapshot.clanTag) || "",
		};
	}

	if (!Array.isArray(entryObj.trophyHistoryDaily)) entryObj.trophyHistoryDaily = [];
	if (!entryObj.donationMonths || typeof entryObj.donationMonths !== "object") entryObj.donationMonths = {};

	return latestChanged || trophyChanged || donationChanged || shouldUpdateLastSeen;
}

function recordClanMemberMetricsSnapshot_(rosterData, clanTagRaw, membersRaw, optionsRaw) {
	const rosterDataSafe = rosterData && typeof rosterData === "object" ? rosterData : null;
	if (!rosterDataSafe) {
		return { recorded: 0, updated: 0, deduped: false, changed: false };
	}

	const clanTag = normalizeTag_(clanTagRaw);
	if (!clanTag) {
		return { recorded: 0, updated: 0, deduped: false, changed: false };
	}

	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const runState = options.runState && typeof options.runState === "object" ? options.runState : null;
	if (runState) {
		if (!runState.seenClanTags || typeof runState.seenClanTags !== "object") runState.seenClanTags = {};
		if (runState.seenClanTags[clanTag]) {
			return { recorded: 0, updated: 0, deduped: true, changed: false };
		}
		runState.seenClanTags[clanTag] = true;
	}

	const captureCtx = buildMetricsCaptureContext_(options.capturedAt);
	captureCtx.clanTag = clanTag;
	const store = ensurePlayerMetricsStore_(rosterDataSafe);
	const byTag = store.byTag && typeof store.byTag === "object" ? store.byTag : {};
	store.byTag = byTag;

	const members = Array.isArray(membersRaw) ? membersRaw : [];
	let recorded = 0;
	let updated = 0;
	for (let i = 0; i < members.length; i++) {
		const baseSnapshot = sanitizeMetricsSnapshotPayload_(members[i], "");
		if (!baseSnapshot) continue;

		const tag = normalizeTag_(baseSnapshot.tag);
		if (!tag) continue;

		baseSnapshot.tag = tag;
		baseSnapshot.clanTag = clanTag;
		baseSnapshot.capturedAt = captureCtx.capturedAt;

		const currentEntry = sanitizePlayerMetricsEntry_(tag, byTag[tag], captureCtx.capturedDate.getTime(), captureCtx.capturedDate) || createEmptyPlayerMetricsEntry_(tag, baseSnapshot.name || "");
		const changed = updatePlayerMetricsEntryFromSnapshot_(currentEntry, baseSnapshot, captureCtx);
		byTag[tag] = currentEntry;
		recorded++;
		if (changed) updated++;
	}

	const sanitizedStore = sanitizePlayerMetricsStore_(store, captureCtx.capturedAt);
	if (updated > 0 || !sanitizedStore.updatedAt) {
		sanitizedStore.updatedAt = captureCtx.capturedAt;
	}
	rosterDataSafe.playerMetrics = sanitizedStore;

	return {
		recorded: recorded,
		updated: updated,
		deduped: false,
		changed: updated > 0,
	};
}

function compareByOrderingRule_(a, b) {
	const aTh = a && typeof a.th === "number" && isFinite(a.th) ? a.th : -1;
	const bTh = b && typeof b.th === "number" && isFinite(b.th) ? b.th : -1;
	if (aTh !== bTh) return bTh - aTh;
	const aTag = normalizeTag_(a && a.tag);
	const bTag = normalizeTag_(b && b.tag);
	return aTag < bTag ? -1 : aTag > bTag ? 1 : 0;
}

function toNonNegativeInt_(value) {
	const n = Number(value);
	if (!isFinite(n)) return 0;
	return Math.max(0, Math.floor(n));
}

function toBooleanFlag_(value) {
	if (value === true || value === false) return value;
	const text = String(value == null ? "" : value)
		.trim()
		.toLowerCase();
	if (!text) return false;
	return text === "true" || text === "1" || text === "yes" || text === "on";
}

function collectRosterPoolPlayers_(roster) {
	const main = Array.isArray(roster && roster.main) ? roster.main : [];
	const subs = Array.isArray(roster && roster.subs) ? roster.subs : [];
	const missing = Array.isArray(roster && roster.missing) ? roster.missing : [];
	const out = [];
	const seen = {};
	const pool = main.concat(subs).concat(missing);
	for (let i = 0; i < pool.length; i++) {
		const player = pool[i] && typeof pool[i] === "object" ? pool[i] : {};
		const tag = normalizeTag_(player.tag);
		if (!tag || seen[tag]) continue;
		seen[tag] = true;
		out.push(player);
	}
	return out;
}

function buildRosterPoolTagSet_(roster) {
	const out = {};
	const players = collectRosterPoolPlayers_(roster);
	for (let i = 0; i < players.length; i++) {
		const tag = normalizeTag_(players[i] && players[i].tag);
		if (!tag) continue;
		out[tag] = true;
	}
	return out;
}

function createEmptyCwlStatEntry_() {
	return {
		starsTotal: 0,
		daysInLineup: 0,
		resolvedWarDays: 0,
		attacksMade: 0,
		missedAttacks: 0,
		threeStarCount: 0,
		totalDestruction: 0,
		countedAttacks: 0,
		currentWarAttackPending: 0,
		hitUpCount: 0,
		hitDownCount: 0,
		sameThHitCount: 0,
	};
}

function createEmptyRegularWarCurrentEntry_(attacksAllowedRaw) {
	const attacksAllowed = toNonNegativeInt_(attacksAllowedRaw);
	return {
		inWar: false,
		mapPosition: null,
		townHallLevel: 0,
		attacksAllowed: attacksAllowed,
		attacksUsed: 0,
		attacksRemaining: attacksAllowed,
		starsTotal: 0,
		totalDestruction: 0,
		countedAttacks: 0,
		threeStarCount: 0,
		opponentAttacks: 0,
		missedAttacks: 0,
		hitUpCount: 0,
		sameThHitCount: 0,
		hitDownCount: 0,
	};
}

function createEmptyRegularWarAggregateEntry_() {
	return {
		warsInLineup: 0,
		attacksMade: 0,
		attacksMissed: 0,
		starsTotal: 0,
		totalDestruction: 0,
		countedAttacks: 0,
		threeStarCount: 0,
		hitUpCount: 0,
		sameThHitCount: 0,
		hitDownCount: 0,
	};
}

function sanitizeRegularWarCurrentEntry_(entryRaw, attacksAllowedRaw) {
	const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
	const out = createEmptyRegularWarCurrentEntry_(entry.attacksAllowed != null ? entry.attacksAllowed : attacksAllowedRaw);
	out.inWar = toBooleanFlag_(entry.inWar);
	out.mapPosition = entry.mapPosition == null ? null : toNonNegativeInt_(entry.mapPosition);
	out.townHallLevel = toNonNegativeInt_(entry.townHallLevel);
	out.attacksAllowed = toNonNegativeInt_(entry.attacksAllowed != null ? entry.attacksAllowed : attacksAllowedRaw);
	out.attacksUsed = toNonNegativeInt_(entry.attacksUsed);
	out.attacksRemaining = toNonNegativeInt_(entry.attacksRemaining != null ? entry.attacksRemaining : Math.max(0, out.attacksAllowed - out.attacksUsed));
	out.starsTotal = toNonNegativeInt_(entry.starsTotal);
	out.totalDestruction = toNonNegativeInt_(entry.totalDestruction);
	out.countedAttacks = toNonNegativeInt_(entry.countedAttacks);
	out.threeStarCount = toNonNegativeInt_(entry.threeStarCount);
	out.opponentAttacks = toNonNegativeInt_(entry.opponentAttacks);
	out.missedAttacks = toNonNegativeInt_(entry.missedAttacks);
	out.hitUpCount = toNonNegativeInt_(entry.hitUpCount);
	out.sameThHitCount = toNonNegativeInt_(entry.sameThHitCount);
	out.hitDownCount = toNonNegativeInt_(entry.hitDownCount);
	return out;
}

function sanitizeRegularWarAggregateEntry_(entryRaw) {
	const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
	const out = createEmptyRegularWarAggregateEntry_();
	out.warsInLineup = toNonNegativeInt_(entry.warsInLineup);
	out.attacksMade = toNonNegativeInt_(entry.attacksMade);
	out.attacksMissed = toNonNegativeInt_(entry.attacksMissed);
	out.starsTotal = toNonNegativeInt_(entry.starsTotal);
	out.totalDestruction = toNonNegativeInt_(entry.totalDestruction);
	out.countedAttacks = toNonNegativeInt_(entry.countedAttacks);
	out.threeStarCount = toNonNegativeInt_(entry.threeStarCount);
	out.hitUpCount = toNonNegativeInt_(entry.hitUpCount);
	out.sameThHitCount = toNonNegativeInt_(entry.sameThHitCount);
	out.hitDownCount = toNonNegativeInt_(entry.hitDownCount);
	return out;
}

function createEmptyWarPerformanceStats_() {
	return {
		warsInLineup: 0,
		daysInLineup: 0,
		resolvedWarDays: 0,
		attacksMade: 0,
		attacksMissed: 0,
		starsTotal: 0,
		totalDestruction: 0,
		countedAttacks: 0,
		threeStarCount: 0,
		hitUpCount: 0,
		sameThHitCount: 0,
		hitDownCount: 0,
	};
}

function createEmptyWarPerformanceEntry_() {
	return {
		overall: createEmptyWarPerformanceStats_(),
		regular: createEmptyWarPerformanceStats_(),
		cwl: createEmptyWarPerformanceStats_(),
	};
}

function createEmptyRegularWarMembershipEntry_() {
	return {
		firstSeenAt: "",
		lastSeenAt: "",
		missingSince: "",
		status: "active",
	};
}

function createEmptyRegularWarLifecycleState_() {
	return {
		activeWarKey: "",
		activeWarState: "notinwar",
		activeWarLastSeenAt: "",
		lastFinalizedWarKey: "",
		lastFinalizedAt: "",
		lastFinalizationSource: "",
		lastFinalizationIncomplete: false,
	};
}

function sanitizeWarPerformanceStatsEntry_(entryRaw) {
	const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
	const out = createEmptyWarPerformanceStats_();
	out.warsInLineup = toNonNegativeInt_(entry.warsInLineup);
	out.daysInLineup = toNonNegativeInt_(entry.daysInLineup);
	out.resolvedWarDays = toNonNegativeInt_(entry.resolvedWarDays);
	out.attacksMade = toNonNegativeInt_(entry.attacksMade);
	out.attacksMissed = toNonNegativeInt_(entry.attacksMissed);
	out.starsTotal = toNonNegativeInt_(entry.starsTotal);
	out.totalDestruction = toNonNegativeInt_(entry.totalDestruction);
	out.countedAttacks = toNonNegativeInt_(entry.countedAttacks);
	out.threeStarCount = toNonNegativeInt_(entry.threeStarCount);
	out.hitUpCount = toNonNegativeInt_(entry.hitUpCount);
	out.sameThHitCount = toNonNegativeInt_(entry.sameThHitCount);
	out.hitDownCount = toNonNegativeInt_(entry.hitDownCount);
	return out;
}

function sanitizeWarPerformanceEntry_(entryRaw) {
	const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
	const out = createEmptyWarPerformanceEntry_();
	out.overall = sanitizeWarPerformanceStatsEntry_(entry.overall);
	out.regular = sanitizeWarPerformanceStatsEntry_(entry.regular);
	out.cwl = sanitizeWarPerformanceStatsEntry_(entry.cwl);
	return out;
}

function sanitizeRegularWarLifecycleState_(rawState) {
	const state = rawState && typeof rawState === "object" ? rawState : {};
	return {
		activeWarKey: String(state.activeWarKey == null ? "" : state.activeWarKey).trim(),
		activeWarState:
			String(state.activeWarState == null ? "" : state.activeWarState)
				.trim()
				.toLowerCase() || "notinwar",
		activeWarLastSeenAt: typeof state.activeWarLastSeenAt === "string" ? state.activeWarLastSeenAt : "",
		lastFinalizedWarKey: String(state.lastFinalizedWarKey == null ? "" : state.lastFinalizedWarKey).trim(),
		lastFinalizedAt: typeof state.lastFinalizedAt === "string" ? state.lastFinalizedAt : "",
		lastFinalizationSource: typeof state.lastFinalizationSource === "string" ? state.lastFinalizationSource : "",
		lastFinalizationIncomplete: toBooleanFlag_(state.lastFinalizationIncomplete),
	};
}

function sanitizeWarPerformanceMeta_(rawMeta) {
	const meta = rawMeta && typeof rawMeta === "object" ? rawMeta : {};
	const out = {};
	const keys = Object.keys(meta);
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		const value = meta[key];
		if (typeof value === "string") out[key] = value;
		else if (typeof value === "boolean") out[key] = value;
		else if (typeof value === "number" && isFinite(value)) out[key] = Math.floor(value);
	}

	out.finalizedRegularWarCount = toNonNegativeInt_(meta.finalizedRegularWarCount != null ? meta.finalizedRegularWarCount : out.finalizedRegularWarCount);
	out.finalizedCwlWarCount = toNonNegativeInt_(meta.finalizedCwlWarCount != null ? meta.finalizedCwlWarCount : out.finalizedCwlWarCount);
	out.lastFinalizationReason = typeof meta.lastFinalizationReason === "string" ? meta.lastFinalizationReason : String(out.lastFinalizationReason || "");
	out.lastFinalizationSource = typeof meta.lastFinalizationSource === "string" ? meta.lastFinalizationSource : String(out.lastFinalizationSource || "");
	out.lastSuccessfulLongTermFinalizationAt = typeof meta.lastSuccessfulLongTermFinalizationAt === "string" ? meta.lastSuccessfulLongTermFinalizationAt : String(out.lastSuccessfulLongTermFinalizationAt || "");
	out.lastRegularWarFinalizedAt = typeof meta.lastRegularWarFinalizedAt === "string" ? meta.lastRegularWarFinalizedAt : String(out.lastRegularWarFinalizedAt || "");
	out.lastRegularWarFinalizationSource = typeof meta.lastRegularWarFinalizationSource === "string" ? meta.lastRegularWarFinalizationSource : String(out.lastRegularWarFinalizationSource || "");
	out.lastRegularWarFinalizationReason = typeof meta.lastRegularWarFinalizationReason === "string" ? meta.lastRegularWarFinalizationReason : String(out.lastRegularWarFinalizationReason || "");
	out.lastRegularWarFinalizationWarKey = typeof meta.lastRegularWarFinalizationWarKey === "string" ? meta.lastRegularWarFinalizationWarKey : String(out.lastRegularWarFinalizationWarKey || "");
	out.lastRegularWarFinalizationIncomplete = toBooleanFlag_(meta.lastRegularWarFinalizationIncomplete != null ? meta.lastRegularWarFinalizationIncomplete : out.lastRegularWarFinalizationIncomplete);
	out.lastCwlWarFinalizedAt = typeof meta.lastCwlWarFinalizedAt === "string" ? meta.lastCwlWarFinalizedAt : String(out.lastCwlWarFinalizedAt || "");
	out.lastCwlWarFinalizedTag = typeof meta.lastCwlWarFinalizedTag === "string" ? meta.lastCwlWarFinalizedTag : String(out.lastCwlWarFinalizedTag || "");
	return out;
}

function sanitizeRegularWarSnapshot_(rawSnapshot) {
	const snapshot = rawSnapshot && typeof rawSnapshot === "object" ? rawSnapshot : null;
	if (!snapshot) return null;

	const warMeta = sanitizeRegularWarCurrentWar_(snapshot.warMeta && typeof snapshot.warMeta === "object" ? snapshot.warMeta : snapshot);
	if (!warMeta || !warMeta.warKey) return null;

	const statsByTagRaw = snapshot.statsByTag && typeof snapshot.statsByTag === "object" ? snapshot.statsByTag : {};
	const statsByTag = {};
	const statTags = Object.keys(statsByTagRaw);
	for (let i = 0; i < statTags.length; i++) {
		const tag = normalizeTag_(statTags[i]);
		if (!tag) continue;
		statsByTag[tag] = sanitizeWarPerformanceStatsEntry_(statsByTagRaw[statTags[i]]);
	}

	const currentByTagRaw = snapshot.currentByTag && typeof snapshot.currentByTag === "object" ? snapshot.currentByTag : {};
	const currentByTag = {};
	const currentTags = Object.keys(currentByTagRaw);
	for (let i = 0; i < currentTags.length; i++) {
		const tag = normalizeTag_(currentTags[i]);
		if (!tag) continue;
		currentByTag[tag] = sanitizeRegularWarCurrentEntry_(currentByTagRaw[currentTags[i]], warMeta.attacksPerMember);
	}

	return {
		warMeta: warMeta,
		capturedAt: typeof snapshot.capturedAt === "string" ? snapshot.capturedAt : "",
		isFinal: toBooleanFlag_(snapshot.isFinal),
		isComplete: snapshot.isComplete == null ? true : toBooleanFlag_(snapshot.isComplete),
		source: typeof snapshot.source === "string" ? snapshot.source : "",
		statsByTag: statsByTag,
		currentByTag: currentByTag,
	};
}

function sanitizeRosterWarPerformance_(rawWarPerformance) {
	if (rawWarPerformance == null) return null;
	const warPerformance = rawWarPerformance && typeof rawWarPerformance === "object" ? rawWarPerformance : {};
	const byTagRaw = warPerformance.byTag && typeof warPerformance.byTag === "object" ? warPerformance.byTag : {};
	const byTag = {};
	const tagKeys = Object.keys(byTagRaw);
	for (let i = 0; i < tagKeys.length; i++) {
		const tag = normalizeTag_(tagKeys[i]);
		if (!tag) continue;
		byTag[tag] = sanitizeWarPerformanceEntry_(byTagRaw[tagKeys[i]]);
	}

	const processedRegularWarKeysRaw = warPerformance.processedRegularWarKeys && typeof warPerformance.processedRegularWarKeys === "object" ? warPerformance.processedRegularWarKeys : {};
	const processedRegularWarKeys = {};
	const regularWarKeys = Object.keys(processedRegularWarKeysRaw);
	for (let i = 0; i < regularWarKeys.length; i++) {
		const key = String(regularWarKeys[i] == null ? "" : regularWarKeys[i]).trim();
		if (!key) continue;
		processedRegularWarKeys[key] = true;
	}

	const processedCwlWarTagsRaw = warPerformance.processedCwlWarTags && typeof warPerformance.processedCwlWarTags === "object" ? warPerformance.processedCwlWarTags : {};
	const processedCwlWarTags = {};
	const cwlWarTags = Object.keys(processedCwlWarTagsRaw);
	for (let i = 0; i < cwlWarTags.length; i++) {
		const tag = normalizeTag_(cwlWarTags[i]);
		if (!tag) continue;
		processedCwlWarTags[tag] = true;
	}

	const meta = sanitizeWarPerformanceMeta_(warPerformance.meta);
	if (!meta.lastFinalizationReason && typeof warPerformance.lastFinalizationReason === "string") {
		meta.lastFinalizationReason = warPerformance.lastFinalizationReason;
	}
	if (!meta.lastFinalizationSource && typeof warPerformance.lastFinalizationSource === "string") {
		meta.lastFinalizationSource = warPerformance.lastFinalizationSource;
	}
	const membershipByTagRaw = warPerformance.membershipByTag && typeof warPerformance.membershipByTag === "object" ? warPerformance.membershipByTag : {};
	const membershipByTag = {};
	const membershipKeys = Object.keys(membershipByTagRaw);
	for (let i = 0; i < membershipKeys.length; i++) {
		const tag = normalizeTag_(membershipKeys[i]);
		if (!tag) continue;
		membershipByTag[tag] = sanitizeRegularWarMembershipEntry_(membershipByTagRaw[membershipKeys[i]]);
	}

	const lifecycleRaw = warPerformance.regularWarLifecycle && typeof warPerformance.regularWarLifecycle === "object" ? warPerformance.regularWarLifecycle : {};
	const lifecycle = sanitizeRegularWarLifecycleState_(lifecycleRaw);
	const snapshot = sanitizeRegularWarSnapshot_(warPerformance.lastRegularWarSnapshot);
	return {
		lastRefreshedAt: typeof warPerformance.lastRefreshedAt === "string" ? warPerformance.lastRefreshedAt : "",
		lastFinalizedAt: typeof warPerformance.lastFinalizedAt === "string" ? warPerformance.lastFinalizedAt : "",
		lastFinalizationReason: typeof meta.lastFinalizationReason === "string" ? meta.lastFinalizationReason : "",
		lastFinalizationSource: typeof meta.lastFinalizationSource === "string" ? meta.lastFinalizationSource : "",
		processedRegularWarKeys: processedRegularWarKeys,
		processedCwlWarTags: processedCwlWarTags,
		byTag: byTag,
		membershipByTag: membershipByTag,
		meta: meta,
		regularWarLifecycle: lifecycle,
		lastRegularWarSnapshot: snapshot,
	};
}

function createEmptyRosterWarPerformance_() {
	return {
		lastRefreshedAt: "",
		lastFinalizedAt: "",
		lastFinalizationReason: "",
		lastFinalizationSource: "",
		processedRegularWarKeys: {},
		processedCwlWarTags: {},
		lastRegularWarSnapshot: null,
		byTag: {},
		membershipByTag: {},
		meta: sanitizeWarPerformanceMeta_(null),
		regularWarLifecycle: createEmptyRegularWarLifecycleState_(),
	};
}

function ensureWarPerformance_(roster) {
	if (!roster || typeof roster !== "object") return null;
	const next = sanitizeRosterWarPerformance_(roster.warPerformance) || createEmptyRosterWarPerformance_();
	if (!next.processedRegularWarKeys || typeof next.processedRegularWarKeys !== "object") next.processedRegularWarKeys = {};
	if (!next.processedCwlWarTags || typeof next.processedCwlWarTags !== "object") next.processedCwlWarTags = {};
	if (!next.byTag || typeof next.byTag !== "object") next.byTag = {};
	if (!next.membershipByTag || typeof next.membershipByTag !== "object") next.membershipByTag = {};
	if (!next.meta || typeof next.meta !== "object") next.meta = sanitizeWarPerformanceMeta_(null);
	if (!next.regularWarLifecycle || typeof next.regularWarLifecycle !== "object") next.regularWarLifecycle = createEmptyRegularWarLifecycleState_();
	next.lastRegularWarSnapshot = sanitizeRegularWarSnapshot_(next.lastRegularWarSnapshot);
	return next;
}

function hasWarPerformanceStatsData_(statsRaw) {
	const stats = sanitizeWarPerformanceStatsEntry_(statsRaw);
	return (
		stats.warsInLineup > 0 ||
		stats.daysInLineup > 0 ||
		stats.resolvedWarDays > 0 ||
		stats.attacksMade > 0 ||
		stats.attacksMissed > 0 ||
		stats.starsTotal > 0 ||
		stats.totalDestruction > 0 ||
		stats.countedAttacks > 0 ||
		stats.threeStarCount > 0 ||
		stats.hitUpCount > 0 ||
		stats.sameThHitCount > 0 ||
		stats.hitDownCount > 0
	);
}

function mapRegularAggregateToWarPerformanceStats_(aggregateRaw) {
	const aggregate = sanitizeRegularWarAggregateEntry_(aggregateRaw);
	const out = createEmptyWarPerformanceStats_();
	out.warsInLineup = aggregate.warsInLineup;
	out.attacksMade = aggregate.attacksMade;
	out.attacksMissed = aggregate.attacksMissed;
	out.starsTotal = aggregate.starsTotal;
	out.totalDestruction = aggregate.totalDestruction;
	out.countedAttacks = aggregate.countedAttacks;
	out.threeStarCount = aggregate.threeStarCount;
	out.hitUpCount = aggregate.hitUpCount;
	out.sameThHitCount = aggregate.sameThHitCount;
	out.hitDownCount = aggregate.hitDownCount;
	return out;
}

function hydrateWarPerformanceOverallFromBreakdown_(entryRaw) {
	const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : null;
	if (!entry) return false;
	const currentOverall = sanitizeWarPerformanceStatsEntry_(entry.overall);
	if (hasWarPerformanceStatsData_(currentOverall)) {
		entry.overall = currentOverall;
		return false;
	}
	const mergedOverall = createEmptyWarPerformanceStats_();
	mergeWarPerformanceStats_(mergedOverall, sanitizeWarPerformanceStatsEntry_(entry.regular));
	mergeWarPerformanceStats_(mergedOverall, sanitizeWarPerformanceStatsEntry_(entry.cwl));
	if (!hasWarPerformanceStatsData_(mergedOverall)) {
		entry.overall = currentOverall;
		return false;
	}
	entry.overall = mergedOverall;
	return true;
}

function backfillWarPerformanceFromLegacyRegularAggregate_(warPerformanceRaw, regularWarRaw) {
	const regularWar = regularWarRaw && typeof regularWarRaw === "object" ? regularWarRaw : {};
	const regularByTag = regularWar.byTag && typeof regularWar.byTag === "object" ? regularWar.byTag : {};
	const regularTags = Object.keys(regularByTag);

	const sourceWarPerformance = warPerformanceRaw && typeof warPerformanceRaw === "object" ? warPerformanceRaw : null;
	let hasLegacyRegularHistory = false;
	for (let i = 0; i < regularTags.length; i++) {
		const tag = normalizeTag_(regularTags[i]);
		if (!tag) continue;
		const compatEntry = regularByTag[regularTags[i]] && typeof regularByTag[regularTags[i]] === "object" ? regularByTag[regularTags[i]] : {};
		const mapped = mapRegularAggregateToWarPerformanceStats_(compatEntry.aggregate);
		if (hasWarPerformanceStatsData_(mapped)) {
			hasLegacyRegularHistory = true;
			break;
		}
	}

	if (!sourceWarPerformance && !hasLegacyRegularHistory) return sourceWarPerformance;

	const warPerformance = sourceWarPerformance || createEmptyRosterWarPerformance_();
	if (!warPerformance.byTag || typeof warPerformance.byTag !== "object") warPerformance.byTag = {};

	let changed = !sourceWarPerformance && hasLegacyRegularHistory;
	const byTag = warPerformance.byTag;
	const allTagMap = {};
	const existingTags = Object.keys(byTag);
	for (let i = 0; i < existingTags.length; i++) {
		const tag = normalizeTag_(existingTags[i]);
		if (tag) allTagMap[tag] = true;
	}
	for (let i = 0; i < regularTags.length; i++) {
		const tag = normalizeTag_(regularTags[i]);
		if (tag) allTagMap[tag] = true;
	}

	const allTags = Object.keys(allTagMap);
	for (let i = 0; i < allTags.length; i++) {
		const tag = normalizeTag_(allTags[i]);
		if (!tag) continue;

		const compatEntry = regularByTag[tag] && typeof regularByTag[tag] === "object" ? regularByTag[tag] : {};
		const mappedRegular = mapRegularAggregateToWarPerformanceStats_(compatEntry.aggregate);
		const hasMappedRegular = hasWarPerformanceStatsData_(mappedRegular);

		let entry = byTag[tag] && typeof byTag[tag] === "object" ? byTag[tag] : null;
		if (!entry && !hasMappedRegular) continue;
		if (!entry) {
			entry = createEmptyWarPerformanceEntry_();
			byTag[tag] = entry;
			changed = true;
		}

		const sanitizedRegular = sanitizeWarPerformanceStatsEntry_(entry.regular);
		const sanitizedCwl = sanitizeWarPerformanceStatsEntry_(entry.cwl);
		entry.regular = sanitizedRegular;
		entry.cwl = sanitizedCwl;
		entry.overall = sanitizeWarPerformanceStatsEntry_(entry.overall);

		if (hasMappedRegular && !hasWarPerformanceStatsData_(sanitizedRegular)) {
			entry.regular = mappedRegular;
			changed = true;
		}

		if (hydrateWarPerformanceOverallFromBreakdown_(entry)) {
			changed = true;
		}
	}

	return changed ? warPerformance : sourceWarPerformance;
}

function prepareWarPerformanceForRefresh_(roster, nowIso) {
	if (!roster || typeof roster !== "object") return null;
	let warPerformance = ensureWarPerformance_(roster);
	roster.warPerformance = warPerformance;
	updateWarPerformanceMembership_(roster, nowIso);
	warPerformance = ensureWarPerformance_(roster);
	roster.warPerformance = warPerformance;
	return warPerformance;
}

function mergeWarPerformanceStats_(dest, src) {
	if (!dest || typeof dest !== "object" || !src || typeof src !== "object") return;
	dest.warsInLineup = toNonNegativeInt_(dest.warsInLineup) + toNonNegativeInt_(src.warsInLineup);
	dest.daysInLineup = toNonNegativeInt_(dest.daysInLineup) + toNonNegativeInt_(src.daysInLineup);
	dest.resolvedWarDays = toNonNegativeInt_(dest.resolvedWarDays) + toNonNegativeInt_(src.resolvedWarDays);
	dest.attacksMade = toNonNegativeInt_(dest.attacksMade) + toNonNegativeInt_(src.attacksMade);
	dest.attacksMissed = toNonNegativeInt_(dest.attacksMissed) + toNonNegativeInt_(src.attacksMissed);
	dest.starsTotal = toNonNegativeInt_(dest.starsTotal) + toNonNegativeInt_(src.starsTotal);
	dest.totalDestruction = toNonNegativeInt_(dest.totalDestruction) + toNonNegativeInt_(src.totalDestruction);
	dest.countedAttacks = toNonNegativeInt_(dest.countedAttacks) + toNonNegativeInt_(src.countedAttacks);
	dest.threeStarCount = toNonNegativeInt_(dest.threeStarCount) + toNonNegativeInt_(src.threeStarCount);
	dest.hitUpCount = toNonNegativeInt_(dest.hitUpCount) + toNonNegativeInt_(src.hitUpCount);
	dest.sameThHitCount = toNonNegativeInt_(dest.sameThHitCount) + toNonNegativeInt_(src.sameThHitCount);
	dest.hitDownCount = toNonNegativeInt_(dest.hitDownCount) + toNonNegativeInt_(src.hitDownCount);
}

function getWarSidesForClan_(warRaw, clanTagRaw) {
	const war = warRaw && typeof warRaw === "object" ? warRaw : {};
	const clanTag = normalizeTag_(clanTagRaw);
	if (!clanTag) return null;

	if (war.clan || war.opponent) {
		const side = pickWarSideForClan_(war, clanTag);
		if (!side) return null;
		return {
			side: side,
			opponentSide: getOpponentSideForClan_(war, clanTag),
			attacksPerMember: toNonNegativeInt_(war.attacksPerMember),
		};
	}

	const clanSideRaw = war.clanSide && typeof war.clanSide === "object" ? war.clanSide : null;
	const opponentSideRaw = war.opponentSide && typeof war.opponentSide === "object" ? war.opponentSide : null;
	if (!clanSideRaw && !opponentSideRaw) return null;
	const clanSideTag = normalizeTag_(clanSideRaw && clanSideRaw.tag);
	const opponentSideTag = normalizeTag_(opponentSideRaw && opponentSideRaw.tag);
	const attacksPerMember = toNonNegativeInt_(war.attacksPerMember != null ? war.attacksPerMember : war.currentWarMeta && war.currentWarMeta.attacksPerMember);
	if (clanSideTag === clanTag) return { side: clanSideRaw, opponentSide: opponentSideRaw, attacksPerMember: attacksPerMember };
	if (opponentSideTag === clanTag) return { side: opponentSideRaw, opponentSide: clanSideRaw, attacksPerMember: attacksPerMember };
	return null;
}

function buildWarStatsFromMembers_(membersRaw, attacksPerMemberRaw, opponentThByTagRaw, trackedTagSet, modeRaw) {
	const out = {};
	const members = Array.isArray(membersRaw) ? membersRaw : [];
	const opponentThByTag = opponentThByTagRaw && typeof opponentThByTagRaw === "object" ? opponentThByTagRaw : {};
	const mode = String(modeRaw == null ? "" : modeRaw)
		.trim()
		.toLowerCase();
	const attacksPerMember = toNonNegativeInt_(attacksPerMemberRaw);
	const useTrackedFilter = trackedTagSet && typeof trackedTagSet === "object" && Object.keys(trackedTagSet).length > 0;

	for (let i = 0; i < members.length; i++) {
		const member = members[i] && typeof members[i] === "object" ? members[i] : {};
		const tag = normalizeTag_(member.tag);
		if (!tag) continue;
		if (useTrackedFilter && !trackedTagSet[tag]) continue;
		const attacks = Array.isArray(member.attacks) ? member.attacks : [];
		const stats = createEmptyWarPerformanceStats_();
		if (mode === "cwl") {
			stats.daysInLineup = 1;
			stats.resolvedWarDays = 1;
			stats.attacksMissed = attacks.length === 0 ? 1 : 0;
		} else {
			stats.warsInLineup = 1;
			stats.attacksMissed = Math.max(0, attacksPerMember - attacks.length);
		}
		stats.attacksMade = attacks.length;
		const attackerTh = readTownHallLevel_(member);
		for (let j = 0; j < attacks.length; j++) {
			const attack = attacks[j] && typeof attacks[j] === "object" ? attacks[j] : {};
			const stars = toNonNegativeInt_(attack.stars);
			const destruction = readAttackDestruction_(attack);
			const defenderTag = normalizeTag_(attack.defenderTag);
			const defenderTh = defenderTag && Object.prototype.hasOwnProperty.call(opponentThByTag, defenderTag) ? opponentThByTag[defenderTag] : null;
			stats.starsTotal += stars;
			stats.totalDestruction += destruction;
			stats.countedAttacks++;
			if (stars === 3) stats.threeStarCount++;
			if (typeof attackerTh === "number" && isFinite(attackerTh) && typeof defenderTh === "number" && isFinite(defenderTh)) {
				if (attackerTh < defenderTh) stats.hitUpCount++;
				else if (attackerTh > defenderTh) stats.hitDownCount++;
				else stats.sameThHitCount++;
			}
		}
		out[tag] = stats;
	}
	return out;
}

function computeRegularWarStatsFromWar_(war, clanTag, trackedTagSet) {
	const sides = getWarSidesForClan_(war, clanTag);
	if (!sides) return {};
	const opponentThByTag = buildMemberThByTag_(sides.opponentSide && sides.opponentSide.members);
	return buildWarStatsFromMembers_(sides.side && sides.side.members, sides.attacksPerMember, opponentThByTag, trackedTagSet, "regular");
}

function computeCwlWarStatsFromWar_(war, clanTag, trackedTagSet) {
	const sides = getWarSidesForClan_(war, clanTag);
	if (!sides) return {};
	const opponentThByTag = buildMemberThByTag_(sides.opponentSide && sides.opponentSide.members);
	return buildWarStatsFromMembers_(sides.side && sides.side.members, sides.attacksPerMember, opponentThByTag, trackedTagSet, "cwl");
}

function getStableRegularWarKey_(warLikeRaw, clanTagRaw) {
	const warLike = warLikeRaw && typeof warLikeRaw === "object" ? warLikeRaw : {};
	const clanTagFallback = normalizeTag_(clanTagRaw);
	const currentWarMeta = warLike.currentWarMeta && typeof warLike.currentWarMeta === "object" ? warLike.currentWarMeta : {};
	const warMeta = warLike.warMeta && typeof warLike.warMeta === "object" ? warLike.warMeta : {};
	const directWarKey = String(warLike.warKey != null ? warLike.warKey : currentWarMeta.warKey != null ? currentWarMeta.warKey : warMeta.warKey != null ? warMeta.warKey : "").trim();

	let clanTag = normalizeTag_(warLike.clanTag || currentWarMeta.clanTag || warMeta.clanTag || clanTagFallback);
	let opponentTag = normalizeTag_(warLike.opponentTag || currentWarMeta.opponentTag || warMeta.opponentTag);

	if (!clanTag || !opponentTag) {
		const sides = getWarSidesForClan_(warLike, clanTagFallback || clanTag);
		if (sides) {
			const sideTag = normalizeTag_(sides.side && sides.side.tag);
			const opponentSideTag = normalizeTag_(sides.opponentSide && sides.opponentSide.tag);
			clanTag = clanTag || sideTag || clanTagFallback;
			opponentTag = opponentTag || opponentSideTag;
		}
	}

	const preparationStartTime = String(warLike.preparationStartTime != null ? warLike.preparationStartTime : currentWarMeta.preparationStartTime != null ? currentWarMeta.preparationStartTime : warMeta.preparationStartTime != null ? warMeta.preparationStartTime : "");
	const startTime = String(warLike.startTime != null ? warLike.startTime : currentWarMeta.startTime != null ? currentWarMeta.startTime : warMeta.startTime != null ? warMeta.startTime : "");
	const endTime = String(warLike.endTime != null ? warLike.endTime : currentWarMeta.endTime != null ? currentWarMeta.endTime : warMeta.endTime != null ? warMeta.endTime : "");
	const keySeed = preparationStartTime || startTime || endTime || "";

	if (directWarKey) {
		const parts = directWarKey.split("|");
		if (parts.length >= 3) {
			const keyClan = normalizeTag_(parts[0]) || clanTag || clanTagFallback || "";
			const keyOpponent = normalizeTag_(parts[1]) || opponentTag || "";
			const keySuffix = parts.slice(2).join("|");
			return keyClan + "|" + keyOpponent + "|" + keySuffix;
		}
	}

	return (clanTag || clanTagFallback || "") + "|" + (opponentTag || "") + "|" + keySeed;
}

function findWarLogEntryByWarKey_(clanTag, warKey, limitRaw) {
	if (!clanTag || !warKey) return null;
	const entries = fetchClanWarLog_(clanTag, limitRaw || REGULAR_WAR_WARLOG_LIMIT);
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i] && typeof entries[i] === "object" ? entries[i] : {};
		const entryWarKey = getStableRegularWarKey_(entry, clanTag);
		if (entryWarKey && entryWarKey === warKey) return entry;
	}
	return null;
}

function warHasMemberLevelDataForClan_(war, clanTag) {
	const sides = getWarSidesForClan_(war, clanTag);
	if (!sides) return false;
	const members = Array.isArray(sides.side && sides.side.members) ? sides.side.members : [];
	return members.length > 0;
}

function ensureWarPerformancePlayerEntry_(warPerformance, tagRaw) {
	const tag = normalizeTag_(tagRaw);
	if (!tag || !warPerformance || typeof warPerformance !== "object") return null;
	if (!warPerformance.byTag || typeof warPerformance.byTag !== "object") warPerformance.byTag = {};
	if (!warPerformance.byTag[tag]) {
		warPerformance.byTag[tag] = createEmptyWarPerformanceEntry_();
	}
	return warPerformance.byTag[tag];
}

function recordRegularWarFinalizationAttempt_(warPerformance, warKey, source, reason, incomplete, finalized, nowIso) {
	if (!warPerformance || typeof warPerformance !== "object") return;
	const nowText = typeof nowIso === "string" && nowIso ? nowIso : new Date().toISOString();
	const meta = sanitizeWarPerformanceMeta_(warPerformance.meta);
	meta.lastRegularWarFinalizationWarKey = String(warKey == null ? "" : warKey).trim();
	meta.lastRegularWarFinalizationSource = String(source == null ? "" : source).trim();
	meta.lastRegularWarFinalizationReason = String(reason == null ? "" : reason).trim();
	meta.lastRegularWarFinalizationIncomplete = !!incomplete;
	meta.lastRegularWarFinalizationAttemptAt = nowText;
	meta.lastRegularWarFinalizationStatus = finalized ? "finalized" : "skipped";
	warPerformance.meta = meta;
}

function resolveWarPerformanceFinalizationTarget_(modeRaw, identifierRaw) {
	const mode = String(modeRaw == null ? "" : modeRaw)
		.trim()
		.toLowerCase();
	const identifier = mode === "cwl" ? normalizeTag_(identifierRaw) : String(identifierRaw == null ? "" : identifierRaw).trim();
	return { mode: mode, identifier: identifier };
}

function markWarPerformanceFinalization_(warPerformance, modeRaw, identifierRaw, nowIso, sourceRaw, reasonRaw, incompleteFlag) {
	if (!warPerformance || typeof warPerformance !== "object") return;
	const target = resolveWarPerformanceFinalizationTarget_(modeRaw, identifierRaw);
	const mode = target.mode;
	const identifier = target.identifier;
	const nowText = typeof nowIso === "string" && nowIso ? nowIso : new Date().toISOString();
	const source = String(sourceRaw == null ? "" : sourceRaw).trim() || "finalized";
	const reason = String(reasonRaw == null ? "" : reasonRaw).trim() || source;
	const incomplete = !!incompleteFlag;

	const meta = sanitizeWarPerformanceMeta_(warPerformance.meta);
	meta.lastFinalizationReason = reason;
	meta.lastFinalizationSource = source;
	meta.lastSuccessfulLongTermFinalizationAt = nowText;
	if (mode === "regular") {
		meta.finalizedRegularWarCount = toNonNegativeInt_(meta.finalizedRegularWarCount) + 1;
		meta.lastRegularWarFinalizedAt = nowText;
		meta.lastRegularWarFinalizationSource = source;
		meta.lastRegularWarFinalizationReason = reason;
		meta.lastRegularWarFinalizationWarKey = identifier;
		meta.lastRegularWarFinalizationIncomplete = incomplete;
	} else if (mode === "cwl") {
		meta.finalizedCwlWarCount = toNonNegativeInt_(meta.finalizedCwlWarCount) + 1;
		meta.lastCwlWarFinalizedAt = nowText;
		meta.lastCwlWarFinalizedTag = identifier;
	}
	warPerformance.meta = meta;
	warPerformance.lastFinalizedAt = nowText;
	warPerformance.lastFinalizationReason = reason;
	warPerformance.lastFinalizationSource = source;

	const lifecycle = sanitizeRegularWarLifecycleState_(warPerformance.regularWarLifecycle);
	if (mode === "regular") {
		lifecycle.lastFinalizedWarKey = identifier;
		lifecycle.lastFinalizedAt = nowText;
		lifecycle.lastFinalizationSource = source;
		lifecycle.lastFinalizationIncomplete = incomplete;
	}
	warPerformance.regularWarLifecycle = lifecycle;
}

function applyWarSnapshotToLongTermAggregate_(warPerformance, modeRaw, identifierRaw, statsByTagRaw, nowIso, source, reason, incomplete) {
	const target = resolveWarPerformanceFinalizationTarget_(modeRaw, identifierRaw);
	const mode = target.mode;
	if (!warPerformance || typeof warPerformance !== "object") {
		return {
			applied: false,
			identifier: "",
			mode: mode,
			reason: "invalidWarPerformance",
		};
	}
	if (mode !== "regular" && mode !== "cwl") return { applied: false, identifier: "", mode: mode, reason: "unsupportedMode" };
	const identifier = target.identifier;
	if (!identifier) return { applied: false, identifier: "", mode: mode, reason: "missingIdentifier" };

	if (!warPerformance.processedRegularWarKeys || typeof warPerformance.processedRegularWarKeys !== "object") warPerformance.processedRegularWarKeys = {};
	if (!warPerformance.processedCwlWarTags || typeof warPerformance.processedCwlWarTags !== "object") warPerformance.processedCwlWarTags = {};
	const processedMap = mode === "regular" ? warPerformance.processedRegularWarKeys : warPerformance.processedCwlWarTags;
	if (processedMap[identifier]) return { applied: false, identifier: identifier, mode: mode, reason: "alreadyProcessed" };

	const statsByTag = statsByTagRaw && typeof statsByTagRaw === "object" ? statsByTagRaw : {};
	const tagKeys = Object.keys(statsByTag);
	for (let i = 0; i < tagKeys.length; i++) {
		const tag = normalizeTag_(tagKeys[i]);
		if (!tag) continue;
		const stats = sanitizeWarPerformanceStatsEntry_(statsByTag[tagKeys[i]]);
		const entry = ensureWarPerformancePlayerEntry_(warPerformance, tag);
		if (!entry) continue;
		if (mode === "regular") mergeWarPerformanceStats_(entry.regular, stats);
		else mergeWarPerformanceStats_(entry.cwl, stats);
		mergeWarPerformanceStats_(entry.overall, stats);
	}

	processedMap[identifier] = true;
	markWarPerformanceFinalization_(warPerformance, mode, identifier, nowIso, source, reason, incomplete);
	return { applied: true, identifier: identifier, mode: mode, reason: "applied" };
}

function finalizeRegularWarIntoWarPerformance_(warPerformance, war, clanTag, trackedTagSet, nowIso, source, reason, incomplete) {
	const warKey = getStableRegularWarKey_(war, clanTag);
	if (!warKey) return false;
	const warStatsByTag = computeRegularWarStatsFromWar_(war, clanTag, trackedTagSet);
	const result = applyWarSnapshotToLongTermAggregate_(warPerformance, "regular", warKey, warStatsByTag, nowIso, source || "regularWarFinalized", reason || "regularWarFinalized", !!incomplete);
	return !!result.applied;
}

function finalizeRegularWarFromSnapshot_(warPerformance, snapshotRaw, trackedTagSet, nowIso, source, reason, incomplete) {
	const snapshot = sanitizeRegularWarSnapshot_(snapshotRaw);
	if (!snapshot || !snapshot.warMeta || !snapshot.warMeta.warKey) return false;
	const statsByTagRaw = snapshot.statsByTag && typeof snapshot.statsByTag === "object" ? snapshot.statsByTag : {};
	const filteredStats = {};
	const useTrackedFilter = trackedTagSet && typeof trackedTagSet === "object" && Object.keys(trackedTagSet).length > 0;
	const tags = Object.keys(statsByTagRaw);
	for (let i = 0; i < tags.length; i++) {
		const tag = normalizeTag_(tags[i]);
		if (!tag) continue;
		if (useTrackedFilter && !trackedTagSet[tag]) continue;
		filteredStats[tag] = sanitizeWarPerformanceStatsEntry_(statsByTagRaw[tags[i]]);
	}
	const result = applyWarSnapshotToLongTermAggregate_(warPerformance, "regular", snapshot.warMeta.warKey, filteredStats, nowIso, source || "regularWarSnapshotFinalized", reason || "regularWarSnapshotFinalized", !!incomplete);
	return !!result.applied;
}

function ingestCwlWarIntoWarPerformance_(warPerformance, war, warTagRaw, clanTag, trackedTagSet, nowIso, source) {
	const warTag = normalizeTag_(warTagRaw) || normalizeTag_(war && war.warTag);
	if (!warTag) return false;
	const statsByTag = computeCwlWarStatsFromWar_(war, clanTag, trackedTagSet);
	const result = applyWarSnapshotToLongTermAggregate_(warPerformance, "cwl", warTag, statsByTag, nowIso, source || "cwlWarFinalized", "cwlWarFinalized", false);
	return !!result.applied;
}

function buildRegularWarLiveSnapshot_(currentWarRaw, clanTag, trackedTagSet, nowIso) {
	const currentWar = currentWarRaw && typeof currentWarRaw === "object" ? currentWarRaw : null;
	if (!currentWar) return null;
	const currentWarMetaRaw = currentWar.currentWarMeta && typeof currentWar.currentWarMeta === "object" ? currentWar.currentWarMeta : currentWar;
	const warMeta = sanitizeRegularWarCurrentWar_(
		Object.assign({}, currentWarMetaRaw, {
			warKey: getStableRegularWarKey_(currentWar, clanTag),
			available: currentWar.available == null ? currentWarMetaRaw.available : currentWar.available,
		}),
	);
	const state = String(warMeta.state == null ? "" : warMeta.state)
		.trim()
		.toLowerCase();
	if (state !== "preparation" && state !== "inwar" && state !== "warended") return null;

	const sides = getWarSidesForClan_(currentWar, clanTag);
	if (!sides) return null;
	const attacksPerMember = toNonNegativeInt_(warMeta.attacksPerMember != null ? warMeta.attacksPerMember : sides.attacksPerMember);
	const opponentThByTag = buildMemberThByTag_(sides.opponentSide && sides.opponentSide.members);
	const members = Array.isArray(sides.side && sides.side.members) ? sides.side.members : [];
	const statsByTag = buildWarStatsFromMembers_(members, attacksPerMember, opponentThByTag, trackedTagSet, "regular");
	if (state !== "warended") {
		const statTags = Object.keys(statsByTag);
		for (let i = 0; i < statTags.length; i++) {
			const tag = normalizeTag_(statTags[i]);
			if (!tag || !statsByTag[tag]) continue;
			statsByTag[tag].attacksMissed = 0;
		}
	}
	const currentByTag = {};
	const useTrackedFilter = trackedTagSet && typeof trackedTagSet === "object" && Object.keys(trackedTagSet).length > 0;

	for (let i = 0; i < members.length; i++) {
		const member = members[i] && typeof members[i] === "object" ? members[i] : {};
		const tag = normalizeTag_(member.tag);
		if (!tag) continue;
		if (useTrackedFilter && !trackedTagSet[tag]) continue;
		const entry = createEmptyRegularWarCurrentEntry_(attacksPerMember);
		entry.inWar = true;
		entry.mapPosition = member.mapPosition == null ? null : toNonNegativeInt_(member.mapPosition);
		entry.townHallLevel = toNonNegativeInt_(readTownHallLevel_(member));
		entry.attacksAllowed = attacksPerMember;
		const attacks = Array.isArray(member.attacks) ? member.attacks : [];
		entry.attacksUsed = attacks.length;
		entry.attacksRemaining = Math.max(0, entry.attacksAllowed - entry.attacksUsed);
		entry.opponentAttacks = toNonNegativeInt_(member.opponentAttacks);
		entry.missedAttacks = state === "warended" ? Math.max(0, entry.attacksAllowed - entry.attacksUsed) : 0;
		const attackerTh = readTownHallLevel_(member);
		for (let j = 0; j < attacks.length; j++) {
			const attack = attacks[j] && typeof attacks[j] === "object" ? attacks[j] : {};
			const stars = toNonNegativeInt_(attack.stars);
			const destruction = readAttackDestruction_(attack);
			const defenderTag = normalizeTag_(attack.defenderTag);
			const defenderTh = defenderTag && Object.prototype.hasOwnProperty.call(opponentThByTag, defenderTag) ? opponentThByTag[defenderTag] : null;
			entry.starsTotal += stars;
			entry.totalDestruction += destruction;
			entry.countedAttacks++;
			if (stars === 3) entry.threeStarCount++;
			if (typeof attackerTh === "number" && isFinite(attackerTh) && typeof defenderTh === "number" && isFinite(defenderTh)) {
				if (attackerTh < defenderTh) entry.hitUpCount++;
				else if (attackerTh > defenderTh) entry.hitDownCount++;
				else entry.sameThHitCount++;
			}
		}
		currentByTag[tag] = sanitizeRegularWarCurrentEntry_(entry, attacksPerMember);
	}

	return {
		warMeta: warMeta,
		capturedAt: typeof nowIso === "string" && nowIso ? nowIso : new Date().toISOString(),
		isFinal: state === "warended",
		isComplete: true,
		source: "currentWar",
		statsByTag: statsByTag,
		currentByTag: currentByTag,
	};
}

function shouldFinalizePreviousRegularWar_(previousWarKeyRaw, currentWarKeyRaw, currentWarStateRaw) {
	const previousWarKey = String(previousWarKeyRaw == null ? "" : previousWarKeyRaw).trim();
	if (!previousWarKey) return false;
	const currentWarKey = String(currentWarKeyRaw == null ? "" : currentWarKeyRaw).trim();
	const currentWarState = String(currentWarStateRaw == null ? "" : currentWarStateRaw)
		.trim()
		.toLowerCase();
	if (currentWarKey && previousWarKey === currentWarKey && currentWarState !== "warended") return false;
	return true;
}

function finalizeRegularWarFromLiveOrFallback_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const warPerformance = options.warPerformance && typeof options.warPerformance === "object" ? options.warPerformance : null;
	if (!warPerformance) return { attempted: false, finalized: false, source: "", incomplete: false, reason: "missingWarPerformance" };
	const previousWarKey = String(options.previousWarKey == null ? "" : options.previousWarKey).trim();
	if (!previousWarKey) return { attempted: false, finalized: false, source: "", incomplete: false, reason: "missingPreviousWarKey" };
	const nowIso = typeof options.nowIso === "string" && options.nowIso ? options.nowIso : new Date().toISOString();
	const trackedTagSet = options.trackedTagSet && typeof options.trackedTagSet === "object" ? options.trackedTagSet : {};
	const clanTag = normalizeTag_(options.clanTag);
	const currentWar = options.currentWar && typeof options.currentWar === "object" ? options.currentWar : null;
	const currentWarMeta = sanitizeRegularWarCurrentWar_(options.currentWarMeta);
	const previousSnapshot = sanitizeRegularWarSnapshot_(options.previousSnapshot);

	if (warPerformance.processedRegularWarKeys && warPerformance.processedRegularWarKeys[previousWarKey]) {
		recordRegularWarFinalizationAttempt_(warPerformance, previousWarKey, "alreadyProcessed", "alreadyProcessed", false, false, nowIso);
		return { attempted: true, finalized: false, source: "alreadyProcessed", incomplete: false, reason: "alreadyProcessed" };
	}

	if (currentWar && currentWarMeta.warKey === previousWarKey && String(currentWarMeta.state || "").toLowerCase() === "warended" && warHasMemberLevelDataForClan_(currentWar, clanTag)) {
		const finalized = finalizeRegularWarIntoWarPerformance_(warPerformance, currentWar, clanTag, trackedTagSet, nowIso, "currentWarEnded", "directCurrentWarEnded", false);
		recordRegularWarFinalizationAttempt_(warPerformance, previousWarKey, "currentWarEnded", "directCurrentWarEnded", false, finalized, nowIso);
		return { attempted: true, finalized: finalized, source: "currentWarEnded", incomplete: false, reason: finalized ? "directCurrentWarEnded" : "directCurrentWarEndedSkipped" };
	}

	let warLogEntry = null;
	let warLogLookupFailed = false;
	try {
		warLogEntry = findWarLogEntryByWarKey_(clanTag, previousWarKey, REGULAR_WAR_WARLOG_LIMIT);
	} catch (err) {
		warLogLookupFailed = true;
	}
	if (warLogEntry && warHasMemberLevelDataForClan_(warLogEntry, clanTag)) {
		const finalized = finalizeRegularWarIntoWarPerformance_(warPerformance, warLogEntry, clanTag, trackedTagSet, nowIso, "targetedWarLog", "targetedWarLogFallback", false);
		recordRegularWarFinalizationAttempt_(warPerformance, previousWarKey, "targetedWarLog", "targetedWarLogFallback", false, finalized, nowIso);
		return { attempted: true, finalized: finalized, source: "targetedWarLog", incomplete: false, reason: finalized ? "targetedWarLogFallback" : "targetedWarLogFallbackSkipped" };
	}

	if (previousSnapshot && previousSnapshot.warMeta && previousSnapshot.warMeta.warKey === previousWarKey) {
		const fallbackReason = warLogEntry ? "warLogMissingMemberDetail_snapshotFallback" : warLogLookupFailed ? "warLogLookupFailed_snapshotFallback" : "snapshotFallbackNoFinalData";
		const finalized = finalizeRegularWarFromSnapshot_(warPerformance, previousSnapshot, trackedTagSet, nowIso, "liveSnapshotFallback", fallbackReason, true);
		recordRegularWarFinalizationAttempt_(warPerformance, previousWarKey, "liveSnapshotFallback", fallbackReason, true, finalized, nowIso);
		return { attempted: true, finalized: finalized, source: "liveSnapshotFallback", incomplete: true, reason: fallbackReason };
	}
	if (warLogLookupFailed) {
		recordRegularWarFinalizationAttempt_(warPerformance, previousWarKey, "warLogLookupFailed", "warLogLookupFailed_noSnapshot", true, false, nowIso);
		return { attempted: true, finalized: false, source: "warLogLookupFailed", incomplete: true, reason: "warLogLookupFailed_noSnapshot" };
	}

	recordRegularWarFinalizationAttempt_(warPerformance, previousWarKey, "noFinalData", "noFinalDataAvailable", true, false, nowIso);
	return { attempted: true, finalized: false, source: "noFinalData", incomplete: true, reason: "noFinalDataAvailable" };
}

function tryFinalizePreviousRegularWar_(optionsRaw) {
	return finalizeRegularWarFromLiveOrFallback_(optionsRaw);
}

function ensureTrackedWarMembership_(warPerformance, activeTagSetRaw, nowIso) {
	if (!warPerformance || typeof warPerformance !== "object") return;
	const activeTagSet = activeTagSetRaw && typeof activeTagSetRaw === "object" ? activeTagSetRaw : {};
	const nowText = typeof nowIso === "string" && nowIso ? nowIso : new Date().toISOString();
	const membershipByTag = warPerformance.membershipByTag && typeof warPerformance.membershipByTag === "object" ? warPerformance.membershipByTag : {};
	const allTags = Object.assign({}, membershipByTag, activeTagSet);
	for (const rawTag in allTags) {
		if (!Object.prototype.hasOwnProperty.call(allTags, rawTag)) continue;
		const tag = normalizeTag_(rawTag);
		if (!tag) continue;
		const entry = sanitizeRegularWarMembershipEntry_(membershipByTag[tag]);
		const isActive = !!activeTagSet[tag];
		if (!entry.firstSeenAt) entry.firstSeenAt = nowText;
		if (isActive) {
			entry.status = "active";
			entry.lastSeenAt = nowText;
			entry.missingSince = "";
		} else {
			if (entry.status !== "temporaryMissing") {
				entry.status = "temporaryMissing";
				entry.missingSince = nowText;
			} else if (!(parseIsoToMs_(entry.missingSince) > 0)) {
				entry.missingSince = nowText;
			}
		}
		membershipByTag[tag] = entry;
	}
	warPerformance.membershipByTag = membershipByTag;
}

function markTrackedMemberMissing_(warPerformance, missingTagSetRaw, nowIso) {
	if (!warPerformance || typeof warPerformance !== "object") return;
	const missingTagSet = missingTagSetRaw && typeof missingTagSetRaw === "object" ? missingTagSetRaw : {};
	const nowText = typeof nowIso === "string" && nowIso ? nowIso : new Date().toISOString();
	const membershipByTag = warPerformance.membershipByTag && typeof warPerformance.membershipByTag === "object" ? warPerformance.membershipByTag : {};
	const tags = Object.keys(missingTagSet);
	for (let i = 0; i < tags.length; i++) {
		const tag = normalizeTag_(tags[i]);
		if (!tag) continue;
		const entry = sanitizeRegularWarMembershipEntry_(membershipByTag[tag]);
		if (!entry.firstSeenAt) entry.firstSeenAt = nowText;
		if (!(parseIsoToMs_(entry.missingSince) > 0)) entry.missingSince = nowText;
		entry.status = "temporaryMissing";
		membershipByTag[tag] = entry;
	}
	warPerformance.membershipByTag = membershipByTag;
}

function pruneExpiredTrackedWarMembers_(warPerformance, nowIso) {
	if (!warPerformance || typeof warPerformance !== "object") return [];
	const membershipByTag = warPerformance.membershipByTag && typeof warPerformance.membershipByTag === "object" ? warPerformance.membershipByTag : {};
	const nowMs = parseIsoToMs_(nowIso) || Date.now();
	const removedTags = [];
	for (const rawTag in membershipByTag) {
		if (!Object.prototype.hasOwnProperty.call(membershipByTag, rawTag)) continue;
		const tag = normalizeTag_(rawTag);
		if (!tag) continue;
		const entry = sanitizeRegularWarMembershipEntry_(membershipByTag[rawTag]);
		if (entry.status !== "temporaryMissing") continue;
		const missingSinceMs = parseIsoToMs_(entry.missingSince);
		if (!(missingSinceMs > 0) || nowMs - missingSinceMs < REGULAR_WAR_MISSING_GRACE_MS) continue;
		delete membershipByTag[rawTag];
		if (warPerformance.byTag && Object.prototype.hasOwnProperty.call(warPerformance.byTag, tag)) {
			delete warPerformance.byTag[tag];
		}
		removedTags.push(tag);
	}
	warPerformance.membershipByTag = membershipByTag;
	return removedTags;
}

function buildRosterActiveTagSet_(roster) {
	const out = {};
	const rosterObj = roster && typeof roster === "object" ? roster : {};
	const players = [].concat(Array.isArray(rosterObj.main) ? rosterObj.main : []).concat(Array.isArray(rosterObj.subs) ? rosterObj.subs : []);
	for (let i = 0; i < players.length; i++) {
		const tag = normalizeTag_(players[i] && players[i].tag);
		if (!tag) continue;
		out[tag] = true;
	}
	return out;
}

function buildRosterMissingTagSet_(roster) {
	const out = {};
	const missing = Array.isArray(roster && roster.missing) ? roster.missing : [];
	for (let i = 0; i < missing.length; i++) {
		const tag = normalizeTag_(missing[i] && missing[i].tag);
		if (!tag) continue;
		out[tag] = true;
	}
	return out;
}

function removeRosterPlayersByTagSet_(roster, tagSetRaw) {
	if (!roster || typeof roster !== "object") return false;
	const tagSet = tagSetRaw && typeof tagSetRaw === "object" ? tagSetRaw : {};
	let changed = false;
	const filterPlayers = (playersRaw) => {
		const players = Array.isArray(playersRaw) ? playersRaw : [];
		const out = [];
		for (let i = 0; i < players.length; i++) {
			const player = players[i] && typeof players[i] === "object" ? players[i] : {};
			const tag = normalizeTag_(player.tag);
			if (tag && tagSet[tag]) {
				changed = true;
				continue;
			}
			out.push(player);
		}
		return out;
	};
	roster.main = filterPlayers(roster.main);
	roster.subs = filterPlayers(roster.subs);
	roster.missing = filterPlayers(roster.missing);
	return changed;
}

function buildTrackedWarHistoryTagSet_(roster, warPerformanceRaw, nowIso) {
	const out = buildRosterPoolTagSet_(roster);
	const warPerformance = warPerformanceRaw && typeof warPerformanceRaw === "object" ? warPerformanceRaw : {};
	const membershipByTag = warPerformance.membershipByTag && typeof warPerformance.membershipByTag === "object" ? warPerformance.membershipByTag : {};
	const nowMs = parseIsoToMs_(nowIso) || Date.now();
	const tags = Object.keys(membershipByTag);
	for (let i = 0; i < tags.length; i++) {
		const tag = normalizeTag_(tags[i]);
		if (!tag) continue;
		const entry = sanitizeRegularWarMembershipEntry_(membershipByTag[tags[i]]);
		if (entry.status !== "temporaryMissing") {
			out[tag] = true;
			continue;
		}
		const missingSinceMs = parseIsoToMs_(entry.missingSince);
		if (!(missingSinceMs > 0) || nowMs - missingSinceMs < REGULAR_WAR_MISSING_GRACE_MS) out[tag] = true;
	}
	return out;
}

function updateWarPerformanceMembership_(roster, nowIso) {
	if (!roster || typeof roster !== "object") return;
	const warPerformance = ensureWarPerformance_(roster);
	const nowText = typeof nowIso === "string" && nowIso ? nowIso : new Date().toISOString();
	const activeTagSet = buildRosterActiveTagSet_(roster);
	const missingTagSet = buildRosterMissingTagSet_(roster);
	ensureTrackedWarMembership_(warPerformance, activeTagSet, nowText);
	markTrackedMemberMissing_(warPerformance, missingTagSet, nowText);
	const removedTags = pruneExpiredTrackedWarMembers_(warPerformance, nowText);
	const removedTagSet = {};
	for (let i = 0; i < removedTags.length; i++) {
		removedTagSet[removedTags[i]] = true;
	}
	if (Object.keys(removedTagSet).length > 0) {
		const removedFromRoster = removeRosterPlayersByTagSet_(roster, removedTagSet);
		if (removedFromRoster) {
			normalizeRosterSlots_(roster);
			clearRosterBenchSuggestions_(roster);
		}
	}
	for (let i = 0; i < removedTags.length; i++) {
		pruneTagFromRosterTrackingState_(roster, removedTags[i]);
	}
	warPerformance.lastRefreshedAt = nowText;
	roster.warPerformance = warPerformance;
}

function sanitizeRegularWarMembershipEntry_(entryRaw) {
	const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
	const out = createEmptyRegularWarMembershipEntry_();
	const statusRaw = String(entry.status == null ? "" : entry.status)
		.trim()
		.toLowerCase();
	out.firstSeenAt = typeof entry.firstSeenAt === "string" ? entry.firstSeenAt : "";
	out.lastSeenAt = typeof entry.lastSeenAt === "string" ? entry.lastSeenAt : "";
	out.missingSince = typeof entry.missingSince === "string" ? entry.missingSince : "";
	out.status = statusRaw === "temporarymissing" ? "temporaryMissing" : "active";
	return out;
}

function sanitizeRegularWarCurrentWar_(rawCurrentWar) {
	const currentWar = rawCurrentWar && typeof rawCurrentWar === "object" ? rawCurrentWar : {};
	const state = String(currentWar.state == null ? "" : currentWar.state)
		.trim()
		.toLowerCase();
	const clanTag = normalizeTag_(currentWar.clanTag);
	const opponentTag = normalizeTag_(currentWar.opponentTag);
	const preparationStartTime = typeof currentWar.preparationStartTime === "string" ? currentWar.preparationStartTime : "";
	const startTime = typeof currentWar.startTime === "string" ? currentWar.startTime : "";
	const endTime = typeof currentWar.endTime === "string" ? currentWar.endTime : "";
	const warKey = getStableRegularWarKey_(currentWar, clanTag);
	return {
		warKey: warKey,
		available: toBooleanFlag_(currentWar.available),
		state: state || "notinwar",
		teamSize: toNonNegativeInt_(currentWar.teamSize),
		attacksPerMember: toNonNegativeInt_(currentWar.attacksPerMember),
		clanTag: clanTag,
		clanName: typeof currentWar.clanName === "string" ? currentWar.clanName : "",
		opponentTag: opponentTag,
		opponentName: typeof currentWar.opponentName === "string" ? currentWar.opponentName : "",
		preparationStartTime: preparationStartTime,
		startTime: startTime,
		endTime: endTime,
		unavailableReason: typeof currentWar.unavailableReason === "string" ? currentWar.unavailableReason : "",
		statusMessage: typeof currentWar.statusMessage === "string" ? currentWar.statusMessage : "",
	};
}

function sanitizeRegularWarAggregateMeta_(rawMeta) {
	const meta = rawMeta && typeof rawMeta === "object" ? rawMeta : {};
	return {
		source: typeof meta.source === "string" ? meta.source : "",
		warLogAvailable: toBooleanFlag_(meta.warLogAvailable),
		warsTracked: toNonNegativeInt_(meta.warsTracked),
		lastSuccessfulWarLogRefreshAt: typeof meta.lastSuccessfulWarLogRefreshAt === "string" ? meta.lastSuccessfulWarLogRefreshAt : "",
		unavailableReason: typeof meta.unavailableReason === "string" ? meta.unavailableReason : "",
		statusMessage: typeof meta.statusMessage === "string" ? meta.statusMessage : "",
	};
}

function sanitizeCwlStatEntry_(entryRaw) {
	const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
	const resolvedWarDays = entry.resolvedWarDays != null ? toNonNegativeInt_(entry.resolvedWarDays) : toNonNegativeInt_(entry.daysInLineup);
	const out = createEmptyCwlStatEntry_();
	out.starsTotal = toNonNegativeInt_(entry.starsTotal);
	out.daysInLineup = resolvedWarDays;
	out.resolvedWarDays = resolvedWarDays;
	out.attacksMade = toNonNegativeInt_(entry.attacksMade);
	out.missedAttacks = toNonNegativeInt_(entry.missedAttacks);
	out.threeStarCount = toNonNegativeInt_(entry.threeStarCount);
	out.totalDestruction = toNonNegativeInt_(entry.totalDestruction);
	out.countedAttacks = toNonNegativeInt_(entry.countedAttacks);
	out.currentWarAttackPending = Math.min(1, toNonNegativeInt_(entry.currentWarAttackPending));
	out.hitUpCount = toNonNegativeInt_(entry.hitUpCount);
	out.hitDownCount = toNonNegativeInt_(entry.hitDownCount);
	out.sameThHitCount = toNonNegativeInt_(entry.sameThHitCount);
	return out;
}

function deriveCwlMetrics_(entryRaw) {
	const entry = sanitizeCwlStatEntry_(entryRaw);
	const possibleStars = 3 * entry.resolvedWarDays;
	return {
		starsTotal: entry.starsTotal,
		daysInLineup: entry.daysInLineup,
		resolvedWarDays: entry.resolvedWarDays,
		attacksMade: entry.attacksMade,
		missedAttacks: entry.missedAttacks,
		threeStarCount: entry.threeStarCount,
		totalDestruction: entry.totalDestruction,
		countedAttacks: entry.countedAttacks,
		currentWarAttackPending: entry.currentWarAttackPending,
		hitUpCount: entry.hitUpCount,
		hitDownCount: entry.hitDownCount,
		sameThHitCount: entry.sameThHitCount,
		possibleStars: possibleStars,
		starsPerf: possibleStars > 0 ? entry.starsTotal / possibleStars : null,
		avgDestruction: entry.countedAttacks > 0 ? entry.totalDestruction / entry.countedAttacks : null,
		destructionPerf: entry.resolvedWarDays > 0 ? entry.totalDestruction / (100 * entry.resolvedWarDays) : null,
	};
}

function readAttackDestruction_(attackRaw) {
	const attack = attackRaw && typeof attackRaw === "object" ? attackRaw : {};
	const raw = attack.destructionPercentage != null ? attack.destructionPercentage : attack.destruction;
	return toNonNegativeInt_(raw);
}

function buildMemberThByTag_(membersRaw) {
	const out = {};
	const members = Array.isArray(membersRaw) ? membersRaw : [];
	for (let i = 0; i < members.length; i++) {
		const member = members[i] && typeof members[i] === "object" ? members[i] : {};
		const tag = normalizeTag_(member.tag);
		const th = readTownHallLevel_(member);
		if (!tag || !isFinite(th)) continue;
		out[tag] = Math.max(0, Math.floor(th));
	}
	return out;
}

function getOpponentSideForClan_(war, clanTagRaw) {
	const clanTag = normalizeTag_(clanTagRaw);
	if (war && war.clan && normalizeTag_(war.clan.tag) === clanTag) return war.opponent || null;
	if (war && war.opponent && normalizeTag_(war.opponent.tag) === clanTag) return war.clan || null;
	return null;
}

function metricCompareValue_(value) {
	return value == null ? -1 : value;
}

function buildHistoryRetentionTagSet_(rosterPoolTagSetRaw, warPerformanceRaw, regularWarRaw, nowIso) {
	const out = {};
	const rosterPoolTagSet = rosterPoolTagSetRaw && typeof rosterPoolTagSetRaw === "object" ? rosterPoolTagSetRaw : {};
	for (const rawTag in rosterPoolTagSet) {
		if (!Object.prototype.hasOwnProperty.call(rosterPoolTagSet, rawTag)) continue;
		const tag = normalizeTag_(rawTag);
		if (tag) out[tag] = true;
	}

	const nowMs = parseIsoToMs_(nowIso) || Date.now();
	const addMembership = (membershipRaw) => {
		const membershipByTag = membershipRaw && typeof membershipRaw === "object" ? membershipRaw : {};
		const keys = Object.keys(membershipByTag);
		for (let i = 0; i < keys.length; i++) {
			const tag = normalizeTag_(keys[i]);
			if (!tag) continue;
			const entry = sanitizeRegularWarMembershipEntry_(membershipByTag[keys[i]]);
			if (entry.status !== "temporaryMissing") {
				out[tag] = true;
				continue;
			}
			const missingSinceMs = parseIsoToMs_(entry.missingSince);
			if (!(missingSinceMs > 0) || nowMs - missingSinceMs < REGULAR_WAR_MISSING_GRACE_MS) {
				out[tag] = true;
			}
		}
	};

	const warPerformance = warPerformanceRaw && typeof warPerformanceRaw === "object" ? warPerformanceRaw : {};
	addMembership(warPerformance.membershipByTag);
	const regularWar = regularWarRaw && typeof regularWarRaw === "object" ? regularWarRaw : {};
	addMembership(regularWar.membershipByTag);
	return out;
}

function sanitizeRosterCwlStats_(rawStats, retainedTagSet) {
	if (rawStats == null) return null;
	const stats = rawStats && typeof rawStats === "object" ? rawStats : {};
	const allowedTags = retainedTagSet && typeof retainedTagSet === "object" ? retainedTagSet : {};
	const byTagRaw = stats.byTag && typeof stats.byTag === "object" ? stats.byTag : {};
	const byTag = {};
	const keys = Object.keys(byTagRaw);

	for (let i = 0; i < keys.length; i++) {
		const normalizedTag = normalizeTag_(keys[i]);
		if (!normalizedTag || !allowedTags[normalizedTag]) continue;

		byTag[normalizedTag] = sanitizeCwlStatEntry_(byTagRaw[keys[i]]);
	}

	return {
		lastRefreshedAt: typeof stats.lastRefreshedAt === "string" ? stats.lastRefreshedAt : "",
		season: typeof stats.season === "string" ? stats.season : "",
		byTag: byTag,
	};
}

function sanitizeRosterRegularWar_(regularWarRaw, retainedTagSet) {
	if (regularWarRaw == null) return null;
	const regularWar = regularWarRaw && typeof regularWarRaw === "object" ? regularWarRaw : {};
	const allowedTags = retainedTagSet && typeof retainedTagSet === "object" ? retainedTagSet : {};
	const byTagRaw = regularWar.byTag && typeof regularWar.byTag === "object" ? regularWar.byTag : {};
	const membershipByTagRaw = regularWar.membershipByTag && typeof regularWar.membershipByTag === "object" ? regularWar.membershipByTag : {};
	const byTag = {};
	const membershipByTag = {};
	const byTagKeys = Object.keys(byTagRaw);
	const membershipKeys = Object.keys(membershipByTagRaw);

	for (let i = 0; i < byTagKeys.length; i++) {
		const normalizedTag = normalizeTag_(byTagKeys[i]);
		if (!normalizedTag || !allowedTags[normalizedTag]) continue;
		const entry = byTagRaw[byTagKeys[i]] && typeof byTagRaw[byTagKeys[i]] === "object" ? byTagRaw[byTagKeys[i]] : {};
		byTag[normalizedTag] = {
			current: sanitizeRegularWarCurrentEntry_(entry.current, entry.current && entry.current.attacksAllowed),
			aggregate: sanitizeRegularWarAggregateEntry_(entry.aggregate),
		};
	}

	for (let i = 0; i < membershipKeys.length; i++) {
		const normalizedTag = normalizeTag_(membershipKeys[i]);
		if (!normalizedTag || !allowedTags[normalizedTag]) continue;
		membershipByTag[normalizedTag] = sanitizeRegularWarMembershipEntry_(membershipByTagRaw[membershipKeys[i]]);
	}

	return {
		lastRefreshedAt: typeof regularWar.lastRefreshedAt === "string" ? regularWar.lastRefreshedAt : "",
		currentWar: sanitizeRegularWarCurrentWar_(regularWar.currentWar),
		aggregateMeta: sanitizeRegularWarAggregateMeta_(regularWar.aggregateMeta),
		byTag: byTag,
		membershipByTag: membershipByTag,
	};
}

function sanitizeRosterBenchSuggestions_(rawSuggestions, rosterPoolTagSet) {
	if (rawSuggestions == null) return null;
	const suggestions = rawSuggestions && typeof rawSuggestions === "object" ? rawSuggestions : {};
	const allowedTags = rosterPoolTagSet && typeof rosterPoolTagSet === "object" ? rosterPoolTagSet : {};
	const pairsRaw = Array.isArray(suggestions.pairs) ? suggestions.pairs : [];
	const benchTagsRaw = Array.isArray(suggestions.benchTags) ? suggestions.benchTags : [];
	const swapInTagsRaw = Array.isArray(suggestions.swapInTags) ? suggestions.swapInTags : [];
	const resultRaw = suggestions.result && typeof suggestions.result === "object" ? suggestions.result : {};
	const seenPairKeys = {};
	const seenBenchTags = {};
	const seenSwapInTags = {};
	const benchTags = [];
	const swapInTags = [];
	const pairs = [];
	const sanitizeTagList = (rawList) => {
		const list = Array.isArray(rawList) ? rawList : [];
		const out = [];
		const seen = {};
		for (let i = 0; i < list.length; i++) {
			const tag = normalizeTag_(list[i]);
			if (!tag || !allowedTags[tag] || seen[tag]) continue;
			seen[tag] = true;
			out.push(tag);
		}
		return out;
	};
	const sanitizeStringList = (rawList, limit) => {
		const list = Array.isArray(rawList) ? rawList : [];
		const maxLen = Math.max(0, toNonNegativeInt_(limit || 0));
		const out = [];
		const seen = {};
		for (let i = 0; i < list.length; i++) {
			const text = String(list[i] == null ? "" : list[i]).trim();
			if (!text || seen[text]) continue;
			seen[text] = true;
			out.push(text);
			if (maxLen > 0 && out.length >= maxLen) break;
		}
		return out;
	};
	const toFiniteNumberOrNull = (value) => {
		const n = Number(value);
		return isFinite(n) ? n : null;
	};

	const addBenchTag = (tagRaw) => {
		const tag = normalizeTag_(tagRaw);
		if (!tag || !allowedTags[tag] || seenBenchTags[tag]) return;
		seenBenchTags[tag] = true;
		benchTags.push(tag);
	};

	const addSwapInTag = (tagRaw) => {
		const tag = normalizeTag_(tagRaw);
		if (!tag || !allowedTags[tag] || seenSwapInTags[tag]) return;
		seenSwapInTags[tag] = true;
		swapInTags.push(tag);
	};

	for (let i = 0; i < pairsRaw.length; i++) {
		const pair = pairsRaw[i] && typeof pairsRaw[i] === "object" ? pairsRaw[i] : {};
		const outTag = normalizeTag_(pair.outTag);
		const inTag = normalizeTag_(pair.inTag);
		if (!outTag || !inTag || !allowedTags[outTag] || !allowedTags[inTag]) continue;
		const pairKey = outTag + "|" + inTag;
		if (seenPairKeys[pairKey]) continue;
		seenPairKeys[pairKey] = true;
		addBenchTag(outTag);
		addSwapInTag(inTag);
		const pairOut = {
			outTag: outTag,
			inTag: inTag,
			reasonCode: typeof pair.reasonCode === "string" ? pair.reasonCode : "",
			reasonText: typeof pair.reasonText === "string" ? pair.reasonText : "",
		};
		if (typeof pair.shortReason === "string") pairOut.shortReason = pair.shortReason;
		const scoreDelta = toFiniteNumberOrNull(pair.scoreDelta);
		if (scoreDelta != null) pairOut.scoreDelta = scoreDelta;
		if (typeof pair.rewardImpact === "string") pairOut.rewardImpact = pair.rewardImpact;
		pairs.push(pairOut);
	}

	for (let i = 0; i < benchTagsRaw.length; i++) addBenchTag(benchTagsRaw[i]);
	for (let i = 0; i < swapInTagsRaw.length; i++) addSwapInTag(swapInTagsRaw[i]);

	const updatedAt = typeof suggestions.updatedAt === "string" ? suggestions.updatedAt : "";
	const algorithm = typeof suggestions.algorithm === "string" ? suggestions.algorithm.trim() : "";
	const nextEditableDayIndexRaw = suggestions.nextEditableDayIndex;
	const nextEditableDayIndex = nextEditableDayIndexRaw == null ? null : Math.floor(Number(nextEditableDayIndexRaw));
	const safeNextEditableDayIndex = isFinite(nextEditableDayIndex) ? nextEditableDayIndex : null;
	const targetMainTags = sanitizeTagList(suggestions.targetMainTags);
	const actionableTargetMainTags = sanitizeTagList(suggestions.actionableTargetMainTags);
	const plannerSummaryRaw = suggestions.plannerSummary && typeof suggestions.plannerSummary === "object" ? suggestions.plannerSummary : null;
	let plannerSummary = null;
	if (plannerSummaryRaw) {
		const next = {
			remainingEditableDays: toNonNegativeInt_(plannerSummaryRaw.remainingEditableDays),
			optimalTotalSlack: toNonNegativeInt_(plannerSummaryRaw.optimalTotalSlack),
			rewardFeasiblePlayerCount: toNonNegativeInt_(plannerSummaryRaw.rewardFeasiblePlayerCount),
			rewardCriticalPlayerTags: sanitizeTagList(plannerSummaryRaw.rewardCriticalPlayerTags),
			impossibleRewardPlayerTags: sanitizeTagList(plannerSummaryRaw.impossibleRewardPlayerTags),
			blockedByExclusions: toBooleanFlag_(plannerSummaryRaw.blockedByExclusions),
			blockedByExclusionOutTags: sanitizeTagList(plannerSummaryRaw.blockedByExclusionOutTags),
			blockedByExclusionInTags: sanitizeTagList(plannerSummaryRaw.blockedByExclusionInTags),
		};
		const solverMode = String(plannerSummaryRaw.solverMode == null ? "" : plannerSummaryRaw.solverMode).trim();
		if (solverMode) next.solverMode = solverMode;
		const warnings = sanitizeStringList(plannerSummaryRaw.warnings, 20);
		if (warnings.length) next.warnings = warnings;
		plannerSummary = next;
	}
	const configSnapshotRaw = suggestions.configSnapshot && typeof suggestions.configSnapshot === "object" ? suggestions.configSnapshot : null;
	let configSnapshot = null;
	if (configSnapshotRaw) {
		const next = {};
		const numericConfigKeys = ["defaultSeasonDays", "priorMeanStarsPerStart", "priorWeightAttacks", "minExpectedStarsPerStart", "maxExpectedStarsPerStart", "weightTH", "weightStarsPerf", "weightDestructionPerf", "weightThreeStarRate", "weightHitUpAbility", "weightHitEvenAbility", "weightReliabilityPenalty", "churnPenalty"];
		for (let i = 0; i < numericConfigKeys.length; i++) {
			const key = numericConfigKeys[i];
			const value = toFiniteNumberOrNull(configSnapshotRaw[key]);
			if (value != null) next[key] = value;
		}
		configSnapshot = Object.keys(next).length ? next : null;
	}
	const hasPlannerMetadata = !!algorithm || safeNextEditableDayIndex != null || targetMainTags.length > 0 || actionableTargetMainTags.length > 0 || !!plannerSummary || !!configSnapshot;
	const hasContent = !!updatedAt || pairs.length > 0 || benchTags.length > 0 || swapInTags.length > 0 || Object.keys(resultRaw).length > 0 || hasPlannerMetadata;
	if (!hasContent) return null;

	const out = {
		updatedAt: updatedAt,
		benchTags: benchTags,
		swapInTags: swapInTags,
		pairs: pairs,
		result: {
			benchCount: benchTags.length > 0 ? benchTags.length : toNonNegativeInt_(resultRaw.benchCount),
			swapCount: pairs.length > 0 ? pairs.length : toNonNegativeInt_(resultRaw.swapCount),
			rosterPoolSize: toNonNegativeInt_(resultRaw.rosterPoolSize),
			activeSlots: toNonNegativeInt_(resultRaw.activeSlots),
			needsRewardsCount: toNonNegativeInt_(resultRaw.needsRewardsCount),
		},
	};
	if (algorithm) out.algorithm = algorithm;
	if (safeNextEditableDayIndex != null) out.nextEditableDayIndex = safeNextEditableDayIndex;
	if (targetMainTags.length) out.targetMainTags = targetMainTags;
	if (actionableTargetMainTags.length) out.actionableTargetMainTags = actionableTargetMainTags;
	if (plannerSummary) out.plannerSummary = plannerSummary;
	if (configSnapshot) out.configSnapshot = configSnapshot;
	return out;
}

function normalizeRosterSlots_(roster) {
	if (!roster || typeof roster !== "object") return;
	if (!Array.isArray(roster.main)) roster.main = [];
	if (!Array.isArray(roster.subs)) roster.subs = [];
	if (!Array.isArray(roster.missing)) roster.missing = [];

	for (let i = 0; i < roster.main.length; i++) {
		if (!roster.main[i] || typeof roster.main[i] !== "object") roster.main[i] = {};
		roster.main[i].slot = i + 1;
	}
	for (let i = 0; i < roster.subs.length; i++) {
		if (!roster.subs[i] || typeof roster.subs[i] !== "object") roster.subs[i] = {};
		roster.subs[i].slot = null;
	}
	for (let i = 0; i < roster.missing.length; i++) {
		if (!roster.missing[i] || typeof roster.missing[i] !== "object") roster.missing[i] = {};
		roster.missing[i].slot = null;
	}
	roster.badges = { main: roster.main.length, subs: roster.subs.length, missing: roster.missing.length };
}

function dedupeRosterSectionsByTag_(rosterRaw) {
	const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : null;
	if (!roster) return { changed: false, removedCount: 0, removed: [] };
	if (!Array.isArray(roster.main)) roster.main = [];
	if (!Array.isArray(roster.subs)) roster.subs = [];
	if (!Array.isArray(roster.missing)) roster.missing = [];

	const sections = ["main", "subs", "missing"];
	const keptByTag = {};
	const removed = [];

	for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
		const section = sections[sectionIndex];
		const players = Array.isArray(roster[section]) ? roster[section] : [];
		const nextPlayers = [];
		for (let i = 0; i < players.length; i++) {
			const player = players[i] && typeof players[i] === "object" ? players[i] : {};
			const tag = normalizeTag_(player.tag);
			if (!tag) {
				nextPlayers.push(player);
				continue;
			}
			if (!keptByTag[tag]) {
				keptByTag[tag] = {
					section: section,
					index: nextPlayers.length,
				};
				nextPlayers.push(player);
				continue;
			}
			removed.push({
				tag: tag,
				removedFromSection: section,
				removedFromIndex: i,
				keptInSection: keptByTag[tag].section,
				keptIndex: keptByTag[tag].index,
			});
		}
		roster[section] = nextPlayers;
	}

	normalizeRosterSlots_(roster);
	return {
		changed: removed.length > 0,
		removedCount: removed.length,
		removed: removed,
	};
}

function summarizeRosterSectionDedupe_(dedupeRaw, maxItemsRaw) {
	const dedupe = dedupeRaw && typeof dedupeRaw === "object" ? dedupeRaw : {};
	const removed = Array.isArray(dedupe.removed) ? dedupe.removed : [];
	if (!removed.length) return "";
	const maxItems = Math.max(1, toNonNegativeInt_(maxItemsRaw) || 4);
	const parts = [];
	for (let i = 0; i < removed.length && i < maxItems; i++) {
		const item = removed[i] && typeof removed[i] === "object" ? removed[i] : {};
		const tag = normalizeTag_(item.tag) || String(item.tag || "");
		const removedSection = String(item.removedFromSection || "").trim() || "?";
		const keptSection = String(item.keptInSection || "").trim() || "?";
		const removedIndex = toNonNegativeInt_(item.removedFromIndex);
		const keptIndex = toNonNegativeInt_(item.keptIndex);
		parts.push(tag + " " + removedSection + "[" + removedIndex + "] -> " + keptSection + "[" + keptIndex + "]");
	}
	if (removed.length > maxItems) parts.push("+" + (removed.length - maxItems) + " more");
	return parts.join(" ; ");
}

function clearRosterBenchSuggestions_(roster) {
	if (!roster || typeof roster !== "object") return;
	if (Object.prototype.hasOwnProperty.call(roster, "benchSuggestions")) {
		delete roster.benchSuggestions;
	}
}

function findRosterById_(rosterData, rosterIdRaw) {
	const rosterDataSafe = validateRosterData_(rosterData);
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	if (!rosterId) throw new Error("Roster ID is required.");

	const rosters = Array.isArray(rosterDataSafe.rosters) ? rosterDataSafe.rosters : [];
	const roster = rosters.find((r) => String((r && r.id) || "").trim() === rosterId);
	if (!roster) throw new Error("Roster not found: " + rosterId);

	return { rosterData: rosterDataSafe, roster: roster, rosterId: rosterId };
}

function findRosterForClanSync_(rosterData, rosterIdRaw) {
	const ctx = findRosterById_(rosterData, rosterIdRaw);
	const roster = ctx.roster;
	const connectedClanTag = normalizeTag_(roster.connectedClanTag);
	if (!connectedClanTag) {
		throw new Error("Connected clan tag is missing for roster '" + ctx.rosterId + "'.");
	}
	if (!isValidClanTag_(connectedClanTag)) {
		throw new Error("Connected clan tag is invalid for roster '" + ctx.rosterId + "': " + connectedClanTag + ".");
	}
	roster.connectedClanTag = connectedClanTag;
	ctx.trackingMode = getRosterTrackingMode_(roster);
	ctx.clanTag = connectedClanTag;
	return ctx;
}

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

function fetchClanMembers_(clanTagRaw) {
	return fetchClanMembersSnapshot_(clanTagRaw).members;
}

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

function mapLeagueGroupDataForClan_(clanTagRaw, leaguegroupRaw) {
	const clanTag = normalizeTag_(clanTagRaw);
	if (!clanTag) throw new Error("Clan tag is required.");
	const data = leaguegroupRaw && typeof leaguegroupRaw === "object" ? leaguegroupRaw : {};
	const clans = Array.isArray(data && data.clans) ? data.clans : [];
	let clanEntry = null;
	for (let i = 0; i < clans.length; i++) {
		const c = clans[i] && typeof clans[i] === "object" ? clans[i] : {};
		if (normalizeTag_(c.tag) === clanTag) {
			clanEntry = c;
			break;
		}
	}
	return {
		clanFound: !!clanEntry,
		members: mapApiMembers_(clanEntry && clanEntry.members),
		warTags: extractLeagueGroupWarTags_(data),
		season: typeof data.season === "string" ? data.season : "",
	};
}

function fetchLeagueGroupData_(clanTagRaw) {
	const clanTag = normalizeTag_(clanTagRaw);
	if (!clanTag) throw new Error("Clan tag is required.");
	const data = cocFetch_("/clans/" + encodeTagForPath_(clanTag) + "/currentwar/leaguegroup");
	return mapLeagueGroupDataForClan_(clanTag, data);
}

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

function isPrivateWarLogError_(err) {
	return !!(err && Number(err.statusCode) === 403);
}

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

function buildPrivateRegularWarResult_(clanTagRaw) {
	const base = buildNoCurrentRegularWarResult_(clanTagRaw);
	base.currentWarMeta.unavailableReason = "privateWarLog";
	base.currentWarMeta.statusMessage = "Live war data unavailable because the clan war log is private.";
	return base;
}

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

function leagueGroupContainsClan_(leaguegroupRaw, clanTagRaw) {
	const clanTag = normalizeTag_(clanTagRaw);
	const clans = Array.isArray(leaguegroupRaw && leaguegroupRaw.clans) ? leaguegroupRaw.clans : [];
	for (let i = 0; i < clans.length; i++) {
		const clan = clans[i] && typeof clans[i] === "object" ? clans[i] : {};
		if (normalizeTag_(clan.tag) === clanTag) return true;
	}
	return false;
}

function pickWarSideForClan_(war, clanTagRaw) {
	const clanTag = normalizeTag_(clanTagRaw);
	const clanSide = war && war.clan && normalizeTag_(war.clan.tag) === clanTag ? war.clan : null;
	if (clanSide) return clanSide;
	const oppSide = war && war.opponent && normalizeTag_(war.opponent.tag) === clanTag ? war.opponent : null;
	return oppSide;
}

function resolveRosterPoolSource_(clanTagRaw, rosterIdRaw, ownershipSnapshotRaw) {
	const clanTag = normalizeTag_(clanTagRaw);
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	const snapshot = ownershipSnapshotRaw && typeof ownershipSnapshotRaw === "object" ? ownershipSnapshotRaw : null;
	if (snapshot && clanTag) {
		const clanErrorByTag = snapshot.clanErrorByTag && typeof snapshot.clanErrorByTag === "object" ? snapshot.clanErrorByTag : {};
		const clanError = clanErrorByTag[clanTag] && typeof clanErrorByTag[clanTag] === "object" ? clanErrorByTag[clanTag] : null;
		if (clanError) {
			const step = String(clanError.step == null ? "" : clanError.step).trim() || "build shared ownership snapshot";
			const message = String(clanError.message == null ? "" : clanError.message).trim() || "unknown error";
			throw new Error("Unable to build shared roster ownership snapshot for clan " + clanTag + " (" + step + "): " + message);
		}
	}
	if (snapshot && rosterId) {
		const membersByRosterId = snapshot.membersByRosterId && typeof snapshot.membersByRosterId === "object" ? snapshot.membersByRosterId : {};
		if (Array.isArray(membersByRosterId[rosterId])) {
			return { sourceUsed: "members", members: membersByRosterId[rosterId] };
		}
	}
	return { sourceUsed: "members", members: fetchClanMembers_(clanTag) };
}

function buildRosterPlayerSeedByTag_(rosterData) {
	const rosters = rosterData && Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	const out = {};

	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		const players = []
			.concat(Array.isArray(roster.main) ? roster.main : [])
			.concat(Array.isArray(roster.subs) ? roster.subs : [])
			.concat(Array.isArray(roster.missing) ? roster.missing : []);
		for (let j = 0; j < players.length; j++) {
			const player = players[j] && typeof players[j] === "object" ? players[j] : {};
			const tag = normalizeTag_(player.tag);
			if (!tag || out[tag]) continue;
			out[tag] = player;
		}
	}

	return out;
}

function buildLiveRosterOwnershipSnapshot_(rosterData, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const shouldRecordMetrics = options.recordMetrics !== false;
	const prefetchedClanSnapshotsByTag = options.prefetchedClanSnapshotsByTag && typeof options.prefetchedClanSnapshotsByTag === "object" ? options.prefetchedClanSnapshotsByTag : {};
	const prefetchedClanErrorsByTag = options.prefetchedClanErrorsByTag && typeof options.prefetchedClanErrorsByTag === "object" ? options.prefetchedClanErrorsByTag : {};
	const snapshotStartedAtIso = new Date().toISOString();
	const metricsProfileModeRaw = String(options.metricsProfileMode == null ? "auto" : options.metricsProfileMode)
		.trim()
		.toLowerCase();
	const metricsProfileMode = metricsProfileModeRaw === "always" || metricsProfileModeRaw === "never" ? metricsProfileModeRaw : "auto";
	const metricsRunState = options.metricsRunState && typeof options.metricsRunState === "object" ? options.metricsRunState : { seenClanTags: {} };
	const metricsProfileRunState = shouldRecordMetrics
		? metricsRunState.profileRunState && typeof metricsRunState.profileRunState === "object"
			? metricsRunState.profileRunState
			: (metricsRunState.profileRunState = {})
		: null;
	const metricsWorkingRosterData = shouldRecordMetrics
		? { playerMetrics: sanitizePlayerMetricsStore_(rosterData && rosterData.playerMetrics, snapshotStartedAtIso) }
		: null;
	const rosters = rosterData && Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	const membersByRosterId = {};
	const memberTagSetByRosterId = {};
	const ownerRosterIdByTag = {};
	const liveMemberByTag = {};
	const connectedClanTagByRosterId = {};
	const connectedRosterIds = [];
	const membersByClanTag = {};
	const memberTrackingByRosterId = {};
	const memberTrackingByClanTag = {};
	const clanErrorByTag = {};

	const registerClanError = (clanTagRaw, stepRaw, errRaw, rosterIdRaw) => {
		const clanTag = normalizeTag_(clanTagRaw);
		if (!clanTag) return null;
		if (clanErrorByTag[clanTag] && typeof clanErrorByTag[clanTag] === "object") return clanErrorByTag[clanTag];

		const step = String(stepRaw == null ? "" : stepRaw).trim() || "build snapshot";
		const message = errorMessage_(errRaw);
		const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
		const payload = {
			clanTag: clanTag,
			rosterId: rosterId,
			step: step,
			message: message,
		};
		clanErrorByTag[clanTag] = payload;
		Logger.log(
			"buildLiveRosterOwnershipSnapshot: failed for clan '%s' at step '%s'%s: %s",
			clanTag,
			step,
			rosterId ? " (roster " + rosterId + ")" : "",
			message,
		);
		return payload;
	};

	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		const rosterId = String(roster.id || "").trim();
		if (!rosterId) continue;

		const clanTag = normalizeTag_(roster.connectedClanTag);
		if (!clanTag) continue;

		connectedRosterIds.push(rosterId);
		connectedClanTagByRosterId[rosterId] = clanTag;

		let members = membersByClanTag[clanTag];
		if (!members && !clanErrorByTag[clanTag]) {
			let clanSnapshot = null;
			const hasPrefetchedError = Object.prototype.hasOwnProperty.call(prefetchedClanErrorsByTag, clanTag);
			const hasPrefetchedSnapshot = Object.prototype.hasOwnProperty.call(prefetchedClanSnapshotsByTag, clanTag);
			if (hasPrefetchedError) {
				registerClanError(clanTag, "fetch clan members", prefetchedClanErrorsByTag[clanTag], rosterId);
				membersByClanTag[clanTag] = [];
				members = membersByClanTag[clanTag];
			} else {
				try {
					clanSnapshot = hasPrefetchedSnapshot ? prefetchedClanSnapshotsByTag[clanTag] : fetchClanMembersSnapshot_(clanTag);
					members = Array.isArray(clanSnapshot && clanSnapshot.members) ? clanSnapshot.members : [];
					membersByClanTag[clanTag] = members;
				} catch (err) {
					registerClanError(clanTag, "fetch clan members", err, rosterId);
					membersByClanTag[clanTag] = [];
					members = membersByClanTag[clanTag];
				}
			}

			if (!clanErrorByTag[clanTag] && shouldRecordMetrics) {
				try {
					const enriched = enrichMetricsMembersWithProfiles_(clanSnapshot && clanSnapshot.metricsMembers, {
						mode: metricsProfileMode,
						runState: metricsProfileRunState,
						clanTag: clanTag,
						sourceRosterId: rosterId,
						source: "buildLiveRosterOwnershipSnapshot",
					});
					const metricsMembers = enriched && Array.isArray(enriched.members) ? enriched.members : clanSnapshot && clanSnapshot.metricsMembers;
					const metricsRecord = recordClanMemberMetricsSnapshot_(metricsWorkingRosterData, clanTag, metricsMembers, {
						capturedAt: clanSnapshot && clanSnapshot.capturedAt,
						runState: metricsRunState,
						sourceRosterId: rosterId,
						source: "buildLiveRosterOwnershipSnapshot",
					});
					memberTrackingByClanTag[clanTag] = {
						clanTag: clanTag,
						capturedAt: clanSnapshot && clanSnapshot.capturedAt ? clanSnapshot.capturedAt : "",
						attemptedClans: 1,
						capturedClans: 1,
						recorded: toNonNegativeInt_(metricsRecord && metricsRecord.recorded),
						updated: toNonNegativeInt_(metricsRecord && metricsRecord.updated),
						errors: [],
						entryCount: countPlayerMetricsEntries_(metricsWorkingRosterData && metricsWorkingRosterData.playerMetrics),
						profileEnriched: toNonNegativeInt_(enriched && enriched.enriched),
						profileAttempted: toNonNegativeInt_(enriched && enriched.attempted),
						metricsProfileMode: metricsProfileMode,
					};
				} catch (err) {
					registerClanError(clanTag, "record clan metrics", err, rosterId);
					memberTrackingByClanTag[clanTag] = {
						clanTag: clanTag,
						capturedAt: clanSnapshot && clanSnapshot.capturedAt ? clanSnapshot.capturedAt : "",
						attemptedClans: 1,
						capturedClans: 0,
						recorded: 0,
						updated: 0,
						errors: [{ clanTag: clanTag, message: errorMessage_(err) }],
						entryCount: countPlayerMetricsEntries_(metricsWorkingRosterData && metricsWorkingRosterData.playerMetrics),
						profileEnriched: 0,
						profileAttempted: 0,
						metricsProfileMode: metricsProfileMode,
					};
				}
			}
		}
		if (memberTrackingByClanTag[clanTag]) {
			memberTrackingByRosterId[rosterId] = memberTrackingByClanTag[clanTag];
		}

		if (clanErrorByTag[clanTag]) {
			membersByRosterId[rosterId] = [];
			memberTagSetByRosterId[rosterId] = {};
			continue;
		}

		members = Array.isArray(membersByClanTag[clanTag]) ? membersByClanTag[clanTag] : [];
		membersByRosterId[rosterId] = members;

		const tagSet = {};
		for (let j = 0; j < members.length; j++) {
			const member = members[j] && typeof members[j] === "object" ? members[j] : {};
			const tag = normalizeTag_(member.tag);
			if (!tag || tagSet[tag]) continue;
			tagSet[tag] = true;
			if (!ownerRosterIdByTag[tag]) ownerRosterIdByTag[tag] = rosterId;
			if (!liveMemberByTag[tag]) liveMemberByTag[tag] = member;
		}
		memberTagSetByRosterId[rosterId] = tagSet;
	}

	if (shouldRecordMetrics && metricsWorkingRosterData) {
		const failedClanCount = Object.keys(clanErrorByTag).length;
		if (failedClanCount < 1) {
			rosterData.playerMetrics = sanitizePlayerMetricsStore_(metricsWorkingRosterData.playerMetrics, new Date().toISOString());
		} else {
			Logger.log(
				"buildLiveRosterOwnershipSnapshot: discarding staged playerMetrics updates because %s connected clan(s) failed during snapshot build.",
				failedClanCount,
			);
		}
	}

	return {
		membersByRosterId: membersByRosterId,
		memberTagSetByRosterId: memberTagSetByRosterId,
		ownerRosterIdByTag: ownerRosterIdByTag,
		liveMemberByTag: liveMemberByTag,
		connectedClanTagByRosterId: connectedClanTagByRosterId,
		connectedRosterIds: connectedRosterIds,
		memberTrackingByRosterId: memberTrackingByRosterId,
		clanErrorByTag: clanErrorByTag,
		seedPlayerByTag: buildRosterPlayerSeedByTag_(rosterData),
	};
}

function applyLiveMemberToRosterPlayer_(playerRaw, memberRaw) {
	const player = playerRaw && typeof playerRaw === "object" ? playerRaw : {};
	const member = memberRaw && typeof memberRaw === "object" ? memberRaw : {};
	let changed = false;

	if (member.name && member.name !== player.name) {
		player.name = member.name;
		changed = true;
	}
	if (typeof member.th === "number" && isFinite(member.th) && member.th > 0 && member.th !== player.th) {
		player.th = Math.floor(member.th);
		changed = true;
	}

	return changed;
}

function createRosterPlayerFromSeed_(tagRaw, seedRaw, memberRaw) {
	const tag = normalizeTag_(tagRaw);
	const seed = seedRaw && typeof seedRaw === "object" ? seedRaw : {};
	const member = memberRaw && typeof memberRaw === "object" ? memberRaw : {};

	const seedTh = typeof seed.th === "number" && isFinite(seed.th) ? Math.max(0, Math.floor(seed.th)) : 0;
	const liveTh = typeof member.th === "number" && isFinite(member.th) && member.th > 0 ? Math.floor(member.th) : null;

	return {
		slot: null,
		name: member.name || (typeof seed.name === "string" ? seed.name : ""),
		discord: typeof seed.discord === "string" ? seed.discord : "",
		th: liveTh != null ? liveTh : seedTh,
		tag: tag,
		notes: sanitizeNotes_(seed.notes != null ? seed.notes : seed.note),
		excludeAsSwapTarget: toBooleanFlag_(seed.excludeAsSwapTarget),
		excludeAsSwapSource: toBooleanFlag_(seed.excludeAsSwapSource),
	};
}

function pruneTagFromRosterTrackingState_(roster, tagRaw) {
	const tag = normalizeTag_(tagRaw);
	if (!tag || !roster || typeof roster !== "object") return false;
	let changed = false;

	const regularWar = roster.regularWar && typeof roster.regularWar === "object" ? roster.regularWar : null;
	if (regularWar && regularWar.byTag && typeof regularWar.byTag === "object" && Object.prototype.hasOwnProperty.call(regularWar.byTag, tag)) {
		delete regularWar.byTag[tag];
		changed = true;
	}
	if (regularWar && regularWar.membershipByTag && typeof regularWar.membershipByTag === "object" && Object.prototype.hasOwnProperty.call(regularWar.membershipByTag, tag)) {
		delete regularWar.membershipByTag[tag];
		changed = true;
	}

	const cwlStats = roster.cwlStats && typeof roster.cwlStats === "object" ? roster.cwlStats : null;
	if (cwlStats && cwlStats.byTag && typeof cwlStats.byTag === "object" && Object.prototype.hasOwnProperty.call(cwlStats.byTag, tag)) {
		delete cwlStats.byTag[tag];
		changed = true;
	}

	const warPerformance = roster.warPerformance && typeof roster.warPerformance === "object" ? roster.warPerformance : null;
	if (warPerformance && warPerformance.byTag && typeof warPerformance.byTag === "object" && Object.prototype.hasOwnProperty.call(warPerformance.byTag, tag)) {
		delete warPerformance.byTag[tag];
		changed = true;
	}
	if (warPerformance && warPerformance.membershipByTag && typeof warPerformance.membershipByTag === "object" && Object.prototype.hasOwnProperty.call(warPerformance.membershipByTag, tag)) {
		delete warPerformance.membershipByTag[tag];
		changed = true;
	}

	return changed;
}

function evictOwnedSourceTagsFromOtherRosters_(rosterData, ownerRosterIdRaw, sourceTagsRaw, ownerRosterIdByTagRaw) {
	const ownerRosterId = String(ownerRosterIdRaw == null ? "" : ownerRosterIdRaw).trim();
	const sourceTags = Array.isArray(sourceTagsRaw) ? sourceTagsRaw : [];
	const ownerRosterIdByTag = ownerRosterIdByTagRaw && typeof ownerRosterIdByTagRaw === "object" ? ownerRosterIdByTagRaw : {};
	const ownedTagSet = {};
	const ownedTags = [];
	for (let i = 0; i < sourceTags.length; i++) {
		const tag = normalizeTag_(sourceTags[i]);
		if (!tag || ownedTagSet[tag]) continue;
		const owner = String(ownerRosterIdByTag[tag] || "").trim();
		if (owner && owner !== ownerRosterId) continue;
		ownedTagSet[tag] = true;
		ownedTags.push(tag);
	}

	const seedByTag = {};
	let removedFromOtherRosters = 0;
	if (!ownedTags.length) {
		return {
			ownedTagSet: ownedTagSet,
			ownedTags: ownedTags,
			seedByTag: seedByTag,
			removedFromOtherRosters: removedFromOtherRosters,
		};
	}

	const rosters = rosterData && Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		const rosterId = String(roster.id || "").trim();
		if (!rosterId || rosterId === ownerRosterId) continue;

		let changed = false;
		const removedTagSet = {};
		const filterPlayers = (playersRaw) => {
			const players = Array.isArray(playersRaw) ? playersRaw : [];
			const next = [];
			for (let j = 0; j < players.length; j++) {
				const player = players[j] && typeof players[j] === "object" ? players[j] : {};
				const tag = normalizeTag_(player.tag);
				if (tag && ownedTagSet[tag]) {
					changed = true;
					removedFromOtherRosters++;
					removedTagSet[tag] = true;
					if (!seedByTag[tag]) seedByTag[tag] = player;
					continue;
				}
				next.push(player);
			}
			return next;
		};

		const nextMain = filterPlayers(roster.main);
		const nextSubs = filterPlayers(roster.subs);
		const nextMissing = filterPlayers(roster.missing);
		if (!changed) continue;

		roster.main = nextMain;
		roster.subs = nextSubs;
		roster.missing = nextMissing;
		const removedTags = Object.keys(removedTagSet);
		for (let j = 0; j < removedTags.length; j++) {
			pruneTagFromRosterTrackingState_(roster, removedTags[j]);
		}
		normalizeRosterSlots_(roster);
		clearRosterBenchSuggestions_(roster);
	}

	return {
		ownedTagSet: ownedTagSet,
		ownedTags: ownedTags,
		seedByTag: seedByTag,
		removedFromOtherRosters: removedFromOtherRosters,
	};
}

function applyRosterPoolSync_(rosterData, roster, sourceMembers, sourceUsed, ownershipSnapshotRaw, nowIsoRaw) {
	const nowText = String(nowIsoRaw == null ? "" : nowIsoRaw).trim() || new Date().toISOString();
	const nowMs = parseIsoToMs_(nowText) || Date.now();
	if (!roster || typeof roster !== "object") throw new Error("Roster is required.");
	if (!Array.isArray(roster.main)) roster.main = [];
	if (!Array.isArray(roster.subs)) roster.subs = [];
	if (!Array.isArray(roster.missing)) roster.missing = [];

	const rosterId = String(roster.id || "").trim();
	const sourceList = Array.isArray(sourceMembers) ? sourceMembers : [];
	const ownershipSnapshot = ownershipSnapshotRaw && typeof ownershipSnapshotRaw === "object" ? ownershipSnapshotRaw : {};
	const ownerRosterIdByTag = ownershipSnapshot.ownerRosterIdByTag && typeof ownershipSnapshot.ownerRosterIdByTag === "object" ? ownershipSnapshot.ownerRosterIdByTag : {};
	const liveMemberByTag = ownershipSnapshot.liveMemberByTag && typeof ownershipSnapshot.liveMemberByTag === "object" ? ownershipSnapshot.liveMemberByTag : {};
	const seedPlayerByTag = ownershipSnapshot.seedPlayerByTag && typeof ownershipSnapshot.seedPlayerByTag === "object" ? ownershipSnapshot.seedPlayerByTag : {};

	const sourceByTag = {};
	for (let i = 0; i < sourceList.length; i++) {
		const member = sourceList[i] && typeof sourceList[i] === "object" ? sourceList[i] : {};
		const tag = normalizeTag_(member.tag);
		if (!tag || sourceByTag[tag]) continue;
		sourceByTag[tag] = member;
	}
	const sourceTags = Object.keys(sourceByTag);
	const ownershipMove = evictOwnedSourceTagsFromOtherRosters_(rosterData, rosterId, sourceTags, ownerRosterIdByTag);
	const sourceSet = ownershipMove.ownedTagSet;
	const ownedSourceTags = ownershipMove.ownedTags;
	const displacedSeedByTag = ownershipMove.seedByTag;

	const dedupePlayers = (playersRaw) => {
		const list = Array.isArray(playersRaw) ? playersRaw : [];
		const out = [];
		const seen = {};
		for (let i = 0; i < list.length; i++) {
			const player = list[i] && typeof list[i] === "object" ? list[i] : {};
			const tag = normalizeTag_(player.tag);
			if (!tag || seen[tag]) continue;
			seen[tag] = true;
			out.push(player);
		}
		return out;
	};

	const markFromLive = (playerRaw) => {
		const player = playerRaw && typeof playerRaw === "object" ? playerRaw : {};
		const tag = normalizeTag_(player.tag);
		if (!tag) return;
		const live = sourceByTag[tag] || liveMemberByTag[tag];
		if (!live) return;
		applyLiveMemberToRosterPlayer_(player, live);
	};

	let main = dedupePlayers(roster.main);
	let subs = dedupePlayers(roster.subs);
	let missing = dedupePlayers(roster.missing);

	const trackedByTag = {};
	const trackedTags = [];
	const trackedPlayerByTag = {};
	const collectTracked = (playersRaw) => {
		const players = Array.isArray(playersRaw) ? playersRaw : [];
		for (let i = 0; i < players.length; i++) {
			const player = players[i] && typeof players[i] === "object" ? players[i] : {};
			const tag = normalizeTag_(player.tag);
			if (!tag || trackedByTag[tag]) continue;
			trackedByTag[tag] = true;
			trackedTags.push(tag);
			trackedPlayerByTag[tag] = player;
		}
	};
	collectTracked(main);
	collectTracked(subs);
	collectTracked(missing);

	const warPerformance = ensureWarPerformance_(roster);
	const membershipByTag = warPerformance.membershipByTag && typeof warPerformance.membershipByTag === "object" ? warPerformance.membershipByTag : {};
	warPerformance.membershipByTag = membershipByTag;
	const ensureMembership = (tag) => {
		const current = sanitizeRegularWarMembershipEntry_(membershipByTag[tag]);
		membershipByTag[tag] = current;
		return current;
	};
	const setMembershipActive = (tag) => {
		const membership = ensureMembership(tag);
		if (!membership.firstSeenAt) membership.firstSeenAt = nowText;
		membership.lastSeenAt = nowText;
		membership.missingSince = "";
		membership.status = "active";
		membershipByTag[tag] = membership;
	};
	const setMembershipTemporaryMissing = (tag) => {
		const membership = ensureMembership(tag);
		if (!membership.firstSeenAt) membership.firstSeenAt = nowText;
		const missingSinceMs = parseIsoToMs_(membership.missingSince);
		membership.missingSince = missingSinceMs > 0 ? membership.missingSince : nowText;
		membership.status = "temporaryMissing";
		membershipByTag[tag] = membership;
	};

	for (let i = 0; i < main.length; i++) markFromLive(main[i]);
	for (let i = 0; i < subs.length; i++) markFromLive(subs[i]);
	for (let i = 0; i < missing.length; i++) markFromLive(missing[i]);

	const updated = trackedTags.filter((tag) => sourceSet[tag]).length;
	for (let i = 0; i < trackedTags.length; i++) {
		const tag = trackedTags[i];
		if (!sourceSet[tag]) continue;
		setMembershipActive(tag);
	}

	let movedToMissing = 0;
	let removed = 0;
	let removedCrossOwned = 0;
	const missingSet = {};
	for (let i = 0; i < missing.length; i++) {
		const tag = normalizeTag_(missing[i] && missing[i].tag);
		if (!tag || missingSet[tag]) continue;
		missingSet[tag] = true;
	}

	const keptMain = [];
	for (let i = 0; i < main.length; i++) {
		const player = main[i] && typeof main[i] === "object" ? main[i] : {};
		const tag = normalizeTag_(player.tag);
		if (!tag) continue;
		if (sourceSet[tag]) {
			keptMain.push(player);
			continue;
		}
		const owner = String(ownerRosterIdByTag[tag] || "").trim();
		if (owner && owner !== rosterId) {
			removed++;
			removedCrossOwned++;
			pruneTagFromRosterTrackingState_(roster, tag);
			continue;
		}
		movedToMissing++;
		if (!missingSet[tag]) {
			missing.push(player);
			missingSet[tag] = true;
		}
		setMembershipTemporaryMissing(tag);
	}
	main = keptMain;

	const keptSubs = [];
	for (let i = 0; i < subs.length; i++) {
		const player = subs[i] && typeof subs[i] === "object" ? subs[i] : {};
		const tag = normalizeTag_(player.tag);
		if (!tag) continue;
		if (sourceSet[tag]) {
			keptSubs.push(player);
			continue;
		}
		const owner = String(ownerRosterIdByTag[tag] || "").trim();
		if (owner && owner !== rosterId) {
			removed++;
			removedCrossOwned++;
			pruneTagFromRosterTrackingState_(roster, tag);
			continue;
		}
		movedToMissing++;
		if (!missingSet[tag]) {
			missing.push(player);
			missingSet[tag] = true;
		}
		setMembershipTemporaryMissing(tag);
	}
	subs = keptSubs;

	const mainSet = {};
	const subsSet = {};
	for (let i = 0; i < main.length; i++) {
		const tag = normalizeTag_(main[i] && main[i].tag);
		if (tag) mainSet[tag] = true;
	}
	for (let i = 0; i < subs.length; i++) {
		const tag = normalizeTag_(subs[i] && subs[i].tag);
		if (tag) subsSet[tag] = true;
	}

	let restored = 0;
	let retainedMissing = 0;
	const nextMissing = [];
	for (let i = 0; i < missing.length; i++) {
		const player = missing[i] && typeof missing[i] === "object" ? missing[i] : {};
		const tag = normalizeTag_(player.tag);
		if (!tag) continue;

		if (sourceSet[tag]) {
			restored++;
			if (!mainSet[tag] && !subsSet[tag]) {
				subs.push(player);
				subsSet[tag] = true;
			}
			setMembershipActive(tag);
			continue;
		}

		const owner = String(ownerRosterIdByTag[tag] || "").trim();
		if (owner && owner !== rosterId) {
			removed++;
			removedCrossOwned++;
			pruneTagFromRosterTrackingState_(roster, tag);
			continue;
		}

		const membership = ensureMembership(tag);
		if (!membership.firstSeenAt) membership.firstSeenAt = nowText;
		if (!membership.missingSince || parseIsoToMs_(membership.missingSince) <= 0) membership.missingSince = nowText;
		membership.status = "temporaryMissing";
		membershipByTag[tag] = membership;
		const missingSinceMs = parseIsoToMs_(membership.missingSince);
		const expired = missingSinceMs > 0 && nowMs - missingSinceMs >= REGULAR_WAR_MISSING_GRACE_MS;
		if (expired) {
			removed++;
			pruneTagFromRosterTrackingState_(roster, tag);
			continue;
		}

		retainedMissing++;
		nextMissing.push(player);
	}
	missing = nextMissing;

	const presentSet = {};
	const markPresent = (playersRaw) => {
		const players = Array.isArray(playersRaw) ? playersRaw : [];
		for (let i = 0; i < players.length; i++) {
			const tag = normalizeTag_(players[i] && players[i].tag);
			if (tag) presentSet[tag] = true;
		}
	};
	markPresent(main);
	markPresent(subs);
	markPresent(missing);

	let added = 0;
	for (let i = 0; i < ownedSourceTags.length; i++) {
		const tag = ownedSourceTags[i];
		if (!tag || presentSet[tag]) continue;
		const source = sourceByTag[tag] || liveMemberByTag[tag];
		const seed = displacedSeedByTag[tag] || trackedPlayerByTag[tag] || seedPlayerByTag[tag];
		const player = createRosterPlayerFromSeed_(tag, seed, source);
		subs.push(player);
		presentSet[tag] = true;
		added++;
		setMembershipActive(tag);
	}
	subs.sort(compareByOrderingRule_);

	roster.main = main;
	roster.subs = subs;
	roster.missing = missing;
	roster.warPerformance = warPerformance;
	const dedupeResult = dedupeRosterSectionsByTag_(roster);
	if (dedupeResult.changed) {
		Logger.log(
			"applyRosterPoolSync_ deduped roster '%s': removed %s cross-section duplicate(s). %s",
			rosterId,
			dedupeResult.removedCount,
			summarizeRosterSectionDedupe_(dedupeResult, 6),
		);
	}

	if (added > 0 || movedToMissing > 0 || restored > 0 || removed > 0 || updated > 0 || dedupeResult.changed) {
		clearRosterBenchSuggestions_(roster);
	}

	return {
		added: added,
		removed: removed,
		removedCrossOwned: removedCrossOwned,
		updated: updated,
		movedToMissing: movedToMissing,
		restored: restored,
		retainedMissing: retainedMissing,
		sourceUsed: sourceUsed,
	};
}

function applyRegularWarRosterPoolSync_(rosterData, roster, sourceMembers, nowIso, ownershipSnapshotRaw) {
	const nowText = String(nowIso == null ? "" : nowIso).trim() || new Date().toISOString();
	const nowMs = parseIsoToMs_(nowText) || Date.now();
	if (!roster || typeof roster !== "object") throw new Error("Roster is required.");
	if (!Array.isArray(roster.main)) roster.main = [];
	if (!Array.isArray(roster.subs)) roster.subs = [];
	if (!Array.isArray(roster.missing)) roster.missing = [];

	const rosterId = String(roster.id || "").trim();
	const sourceList = Array.isArray(sourceMembers) ? sourceMembers : [];
	const ownershipSnapshot = ownershipSnapshotRaw && typeof ownershipSnapshotRaw === "object" ? ownershipSnapshotRaw : {};
	const ownerRosterIdByTag = ownershipSnapshot.ownerRosterIdByTag && typeof ownershipSnapshot.ownerRosterIdByTag === "object" ? ownershipSnapshot.ownerRosterIdByTag : {};
	const liveMemberByTag = ownershipSnapshot.liveMemberByTag && typeof ownershipSnapshot.liveMemberByTag === "object" ? ownershipSnapshot.liveMemberByTag : {};
	const seedPlayerByTag = ownershipSnapshot.seedPlayerByTag && typeof ownershipSnapshot.seedPlayerByTag === "object" ? ownershipSnapshot.seedPlayerByTag : {};

	const sourceByTag = {};
	for (let i = 0; i < sourceList.length; i++) {
		const member = sourceList[i] && typeof sourceList[i] === "object" ? sourceList[i] : {};
		const tag = normalizeTag_(member.tag);
		if (!tag || sourceByTag[tag]) continue;
		sourceByTag[tag] = member;
	}
	const sourceTags = Object.keys(sourceByTag);
	const ownershipMove = evictOwnedSourceTagsFromOtherRosters_(rosterData, rosterId, sourceTags, ownerRosterIdByTag);
	const sourceSet = ownershipMove.ownedTagSet;
	const ownedSourceTags = ownershipMove.ownedTags;
	const displacedSeedByTag = ownershipMove.seedByTag;

	const dedupePlayers = (playersRaw) => {
		const list = Array.isArray(playersRaw) ? playersRaw : [];
		const out = [];
		const seen = {};
		for (let i = 0; i < list.length; i++) {
			const player = list[i] && typeof list[i] === "object" ? list[i] : {};
			const tag = normalizeTag_(player.tag);
			if (!tag || seen[tag]) continue;
			seen[tag] = true;
			out.push(player);
		}
		return out;
	};

	const markFromLive = (playerRaw) => {
		const player = playerRaw && typeof playerRaw === "object" ? playerRaw : {};
		const tag = normalizeTag_(player.tag);
		if (!tag) return;
		const live = sourceByTag[tag] || liveMemberByTag[tag];
		if (!live) return;
		applyLiveMemberToRosterPlayer_(player, live);
	};

	let main = dedupePlayers(roster.main);
	let subs = dedupePlayers(roster.subs);
	let missing = dedupePlayers(roster.missing);

	const trackedByTag = {};
	const trackedTags = [];
	const trackedPlayerByTag = {};
	const collectTracked = (playersRaw) => {
		const players = Array.isArray(playersRaw) ? playersRaw : [];
		for (let i = 0; i < players.length; i++) {
			const player = players[i] && typeof players[i] === "object" ? players[i] : {};
			const tag = normalizeTag_(player.tag);
			if (!tag || trackedByTag[tag]) continue;
			trackedByTag[tag] = true;
			trackedTags.push(tag);
			trackedPlayerByTag[tag] = player;
		}
	};
	collectTracked(main);
	collectTracked(subs);
	collectTracked(missing);

	const regularWar = roster.regularWar && typeof roster.regularWar === "object" ? roster.regularWar : {};
	const byTag = regularWar.byTag && typeof regularWar.byTag === "object" ? regularWar.byTag : {};
	const membershipByTag = regularWar.membershipByTag && typeof regularWar.membershipByTag === "object" ? regularWar.membershipByTag : {};
	regularWar.byTag = byTag;
	regularWar.membershipByTag = membershipByTag;
	roster.regularWar = regularWar;

	const ensureMembership = (tag) => {
		const current = sanitizeRegularWarMembershipEntry_(membershipByTag[tag]);
		membershipByTag[tag] = current;
		return current;
	};
	const setMembershipActive = (tag) => {
		const membership = ensureMembership(tag);
		if (!membership.firstSeenAt) membership.firstSeenAt = nowText;
		membership.lastSeenAt = nowText;
		membership.missingSince = "";
		membership.status = "active";
		membershipByTag[tag] = membership;
	};
	const setMembershipTemporaryMissing = (tag) => {
		const membership = ensureMembership(tag);
		if (!membership.firstSeenAt) membership.firstSeenAt = nowText;
		membership.lastSeenAt = membership.lastSeenAt || "";
		const missingSinceMs = parseIsoToMs_(membership.missingSince);
		membership.missingSince = missingSinceMs > 0 ? membership.missingSince : nowText;
		membership.status = "temporaryMissing";
		membershipByTag[tag] = membership;
	};

	for (let i = 0; i < main.length; i++) markFromLive(main[i]);
	for (let i = 0; i < subs.length; i++) markFromLive(subs[i]);
	for (let i = 0; i < missing.length; i++) markFromLive(missing[i]);

	const updated = trackedTags.filter((tag) => sourceSet[tag]).length;
	for (let i = 0; i < trackedTags.length; i++) {
		const tag = trackedTags[i];
		if (!sourceSet[tag]) continue;
		setMembershipActive(tag);
	}

	let movedToMissing = 0;
	const missingSet = {};
	for (let i = 0; i < missing.length; i++) {
		const tag = normalizeTag_(missing[i] && missing[i].tag);
		if (!tag || missingSet[tag]) continue;
		missingSet[tag] = true;
	}

	let removed = 0;
	let removedCrossOwned = 0;

	const keptMain = [];
	for (let i = 0; i < main.length; i++) {
		const player = main[i] && typeof main[i] === "object" ? main[i] : {};
		const tag = normalizeTag_(player.tag);
		if (!tag) continue;
		if (sourceSet[tag]) {
			keptMain.push(player);
			continue;
		}

		const owner = String(ownerRosterIdByTag[tag] || "").trim();
		if (owner && owner !== rosterId) {
			removed++;
			removedCrossOwned++;
			delete byTag[tag];
			delete membershipByTag[tag];
			continue;
		}

		movedToMissing++;
		if (!missingSet[tag]) {
			missing.push(player);
			missingSet[tag] = true;
		}
		setMembershipTemporaryMissing(tag);
	}
	main = keptMain;

	const keptSubs = [];
	for (let i = 0; i < subs.length; i++) {
		const player = subs[i] && typeof subs[i] === "object" ? subs[i] : {};
		const tag = normalizeTag_(player.tag);
		if (!tag) continue;
		if (sourceSet[tag]) {
			keptSubs.push(player);
			continue;
		}

		const owner = String(ownerRosterIdByTag[tag] || "").trim();
		if (owner && owner !== rosterId) {
			removed++;
			removedCrossOwned++;
			delete byTag[tag];
			delete membershipByTag[tag];
			continue;
		}

		movedToMissing++;
		if (!missingSet[tag]) {
			missing.push(player);
			missingSet[tag] = true;
		}
		setMembershipTemporaryMissing(tag);
	}
	subs = keptSubs;

	const mainSet = {};
	const subsSet = {};
	for (let i = 0; i < main.length; i++) {
		const tag = normalizeTag_(main[i] && main[i].tag);
		if (tag) mainSet[tag] = true;
	}
	for (let i = 0; i < subs.length; i++) {
		const tag = normalizeTag_(subs[i] && subs[i].tag);
		if (tag) subsSet[tag] = true;
	}

	let restored = 0;
	let retainedMissing = 0;
	const nextMissing = [];
	for (let i = 0; i < missing.length; i++) {
		const player = missing[i] && typeof missing[i] === "object" ? missing[i] : {};
		const tag = normalizeTag_(player.tag);
		if (!tag) continue;
		if (sourceSet[tag]) {
			restored++;
			if (!mainSet[tag] && !subsSet[tag]) {
				subs.push(player);
				subsSet[tag] = true;
			}
			setMembershipActive(tag);
			continue;
		}

		const owner = String(ownerRosterIdByTag[tag] || "").trim();
		if (owner && owner !== rosterId) {
			removed++;
			removedCrossOwned++;
			delete byTag[tag];
			delete membershipByTag[tag];
			continue;
		}

		const membership = ensureMembership(tag);
		if (!membership.firstSeenAt) membership.firstSeenAt = nowText;
		if (!membership.missingSince || parseIsoToMs_(membership.missingSince) <= 0) membership.missingSince = nowText;
		membership.status = "temporaryMissing";
		membershipByTag[tag] = membership;
		const missingSinceMs = parseIsoToMs_(membership.missingSince);
		const expired = missingSinceMs > 0 && nowMs - missingSinceMs >= REGULAR_WAR_MISSING_GRACE_MS;
		if (expired) {
			removed++;
			delete byTag[tag];
			delete membershipByTag[tag];
			continue;
		}

		retainedMissing++;
		nextMissing.push(player);
	}
	missing = nextMissing;

	const presentSet = {};
	const markPresent = (playersRaw) => {
		const players = Array.isArray(playersRaw) ? playersRaw : [];
		for (let i = 0; i < players.length; i++) {
			const tag = normalizeTag_(players[i] && players[i].tag);
			if (tag) presentSet[tag] = true;
		}
	};
	markPresent(main);
	markPresent(subs);
	markPresent(missing);

	let added = 0;
	for (let i = 0; i < ownedSourceTags.length; i++) {
		const tag = ownedSourceTags[i];
		if (!tag || presentSet[tag]) continue;
		const source = sourceByTag[tag] || liveMemberByTag[tag];
		const seed = displacedSeedByTag[tag] || trackedPlayerByTag[tag] || seedPlayerByTag[tag];
		const player = createRosterPlayerFromSeed_(tag, seed, source);
		subs.push(player);
		presentSet[tag] = true;
		added++;
		setMembershipActive(tag);
	}
	subs.sort(compareByOrderingRule_);

	roster.main = main;
	roster.subs = subs;
	roster.missing = missing;
	const dedupeResult = dedupeRosterSectionsByTag_(roster);
	if (dedupeResult.changed) {
		Logger.log(
			"applyRegularWarRosterPoolSync_ deduped roster '%s': removed %s cross-section duplicate(s). %s",
			rosterId,
			dedupeResult.removedCount,
			summarizeRosterSectionDedupe_(dedupeResult, 6),
		);
	}

	const finalTagSet = buildRosterPoolTagSet_(roster);
	const byTagKeys = Object.keys(byTag);
	for (let i = 0; i < byTagKeys.length; i++) {
		const tag = normalizeTag_(byTagKeys[i]);
		if (!tag || finalTagSet[tag]) continue;
		delete byTag[byTagKeys[i]];
	}
	const membershipKeys = Object.keys(membershipByTag);
	for (let i = 0; i < membershipKeys.length; i++) {
		const tag = normalizeTag_(membershipKeys[i]);
		if (!tag || finalTagSet[tag]) continue;
		delete membershipByTag[membershipKeys[i]];
	}

	if (added > 0 || movedToMissing > 0 || restored > 0 || removed > 0 || dedupeResult.changed) {
		clearRosterBenchSuggestions_(roster);
	}

	return {
		mode: "regularWar",
		added: added,
		removed: removed,
		removedCrossOwned: removedCrossOwned,
		updated: updated,
		movedToMissing: movedToMissing,
		restored: restored,
		retainedMissing: retainedMissing,
		sourceUsed: "members",
	};
}

function findCurrentCwlWarForClan_(clanTagRaw, warTagsRaw, optionsRaw) {
	const clanTag = normalizeTag_(clanTagRaw);
	const warTags = Array.isArray(warTagsRaw) ? warTagsRaw : [];
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const prefetchedCwlWarRawByTag = options.prefetchedCwlWarRawByTag && typeof options.prefetchedCwlWarRawByTag === "object" ? options.prefetchedCwlWarRawByTag : {};
	const prefetchedCwlWarErrorByTag = options.prefetchedCwlWarErrorByTag && typeof options.prefetchedCwlWarErrorByTag === "object" ? options.prefetchedCwlWarErrorByTag : {};
	for (let i = 0; i < warTags.length; i++) {
		const warTag = normalizeTag_(warTags[i]);
		if (!warTag || warTag === "#0") continue;

		let war = null;
		if (Object.prototype.hasOwnProperty.call(prefetchedCwlWarErrorByTag, warTag)) {
			throw prefetchedCwlWarErrorByTag[warTag];
		}
		if (Object.prototype.hasOwnProperty.call(prefetchedCwlWarRawByTag, warTag)) {
			war = prefetchedCwlWarRawByTag[warTag];
		} else {
			war = cocFetch_("/clanwarleagues/wars/" + encodeTagForPath_(warTag));
		}
		const state = String((war && war.state) || "").toLowerCase();
		if (state !== "preparation" && state !== "inwar") continue;

		const side = pickWarSideForClan_(war, clanTag);
		if (!side) continue;

		return {
			warTag: warTag,
			warState: state,
			members: mapApiMembers_(side.members),
		};
	}
	return null;
}

function applyTodayLineupSync_(roster, participantsRaw) {
	const main = Array.isArray(roster && roster.main) ? roster.main : [];
	const subs = Array.isArray(roster && roster.subs) ? roster.subs : [];
	const rosterPool = main.concat(subs);
	const beforeMainOrder = main.map((player) => normalizeTag_(player && player.tag)).filter((tag) => tag);
	const beforeSubsOrder = subs.map((player) => normalizeTag_(player && player.tag)).filter((tag) => tag);

	const poolByTag = {};
	const poolTagsInOrder = [];
	for (let i = 0; i < rosterPool.length; i++) {
		const p = rosterPool[i] && typeof rosterPool[i] === "object" ? rosterPool[i] : {};
		const tag = normalizeTag_(p.tag);
		if (!tag || poolByTag[tag]) continue;
		poolByTag[tag] = p;
		poolTagsInOrder.push(tag);
	}

	const participantsAll = mapApiMembers_(participantsRaw);
	const participantsByTag = {};
	for (let i = 0; i < participantsAll.length; i++) {
		participantsByTag[participantsAll[i].tag] = participantsAll[i];
	}

	const participantsFiltered = participantsAll.filter((m) => !!poolByTag[m.tag]);
	const hasAnyMapPosition = participantsFiltered.some((m) => typeof m.mapPosition === "number" && isFinite(m.mapPosition));

	let orderedParticipantTags = [];
	if (hasAnyMapPosition) {
		const sorted = participantsFiltered.slice().sort((a, b) => {
			const aPos = typeof a.mapPosition === "number" && isFinite(a.mapPosition) ? a.mapPosition : Number.MAX_SAFE_INTEGER;
			const bPos = typeof b.mapPosition === "number" && isFinite(b.mapPosition) ? b.mapPosition : Number.MAX_SAFE_INTEGER;
			if (aPos !== bPos) return aPos - bPos;
			return compareByOrderingRule_(a, b);
		});
		orderedParticipantTags = sorted.map((x) => x.tag);
	} else {
		const wantedSet = {};
		for (let i = 0; i < participantsFiltered.length; i++) wantedSet[participantsFiltered[i].tag] = true;

		const ordered = [];
		for (let i = 0; i < poolTagsInOrder.length; i++) {
			const tag = poolTagsInOrder[i];
			if (wantedSet[tag]) ordered.push(tag);
		}

		const orderedSet = {};
		for (let i = 0; i < ordered.length; i++) orderedSet[ordered[i]] = true;
		const unplaced = participantsFiltered
			.filter((p) => !orderedSet[p.tag])
			.sort(compareByOrderingRule_)
			.map((p) => p.tag);

		orderedParticipantTags = ordered.concat(unplaced);
	}

	let updated = 0;
	for (let i = 0; i < orderedParticipantTags.length; i++) {
		const tag = orderedParticipantTags[i];
		const player = poolByTag[tag];
		const src = participantsByTag[tag];
		if (!player || !src) continue;

		let changed = false;
		if (src.name && src.name !== player.name) {
			player.name = src.name;
			changed = true;
		}
		if (typeof src.th === "number" && isFinite(src.th) && src.th > 0 && src.th !== player.th) {
			player.th = src.th;
			changed = true;
		}
		if (changed) updated++;
	}

	const participantSet = {};
	for (let i = 0; i < orderedParticipantTags.length; i++) participantSet[orderedParticipantTags[i]] = true;
	const nonParticipantTags = poolTagsInOrder.filter((tag) => !participantSet[tag]);
	const nonSet = {};
	for (let i = 0; i < nonParticipantTags.length; i++) nonSet[nonParticipantTags[i]] = true;

	const subsOrderedTags = [];
	for (let i = 0; i < subs.length; i++) {
		const tag = normalizeTag_(subs[i] && subs[i].tag);
		if (tag && nonSet[tag]) subsOrderedTags.push(tag);
	}
	const subsOrderedSet = {};
	for (let i = 0; i < subsOrderedTags.length; i++) subsOrderedSet[subsOrderedTags[i]] = true;

	for (let i = 0; i < main.length; i++) {
		const tag = normalizeTag_(main[i] && main[i].tag);
		if (tag && nonSet[tag] && !subsOrderedSet[tag]) {
			subsOrderedTags.push(tag);
			subsOrderedSet[tag] = true;
		}
	}

	const remainder = nonParticipantTags
		.filter((tag) => !subsOrderedSet[tag])
		.map((tag) => poolByTag[tag])
		.sort(compareByOrderingRule_)
		.map((p) => normalizeTag_(p && p.tag));
	for (let i = 0; i < remainder.length; i++) subsOrderedTags.push(remainder[i]);

	roster.main = orderedParticipantTags.map((tag) => poolByTag[tag]).filter(Boolean);
	roster.subs = subsOrderedTags.map((tag) => poolByTag[tag]).filter(Boolean);
	const dedupeResult = dedupeRosterSectionsByTag_(roster);
	if (dedupeResult.changed) {
		const rosterId = String((roster && roster.id) || "").trim() || "unknown";
		Logger.log(
			"applyTodayLineupSync_ deduped roster '%s': removed %s cross-section duplicate(s). %s",
			rosterId,
			dedupeResult.removedCount,
			summarizeRosterSectionDedupe_(dedupeResult, 6),
		);
	}

	const afterMainOrder = roster.main.map((player) => normalizeTag_(player && player.tag)).filter((tag) => tag);
	const afterSubsOrder = roster.subs.map((player) => normalizeTag_(player && player.tag)).filter((tag) => tag);
	if (beforeMainOrder.join("|") !== afterMainOrder.join("|") || beforeSubsOrder.join("|") !== afterSubsOrder.join("|") || updated > 0 || dedupeResult.changed) {
		clearRosterBenchSuggestions_(roster);
	}

	return {
		activeSet: roster.main.length,
		benched: roster.subs.length,
		updated: updated,
	};
}

function testClanConnection(rosterData, rosterId, password) {
	assertAdminPassword_(password);
	const ctx = findRosterForClanSync_(rosterData, rosterId);
	const members = fetchClanMembers_(ctx.clanTag);
	return { ok: true, memberCount: members.length };
}

function syncClanRosterPoolCore_(rosterData, rosterId, optionsRaw) {
	const ctx = findRosterForClanSync_(rosterData, rosterId);
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const ownershipSnapshot = options.ownershipSnapshot && typeof options.ownershipSnapshot === "object" ? options.ownershipSnapshot : buildLiveRosterOwnershipSnapshot_(ctx.rosterData);
	const memberTrackingByRosterId = ownershipSnapshot && ownershipSnapshot.memberTrackingByRosterId && typeof ownershipSnapshot.memberTrackingByRosterId === "object" ? ownershipSnapshot.memberTrackingByRosterId : {};
	const nowIso = new Date().toISOString();
	let result = null;
	const source = resolveRosterPoolSource_(ctx.clanTag, ctx.rosterId, ownershipSnapshot);
	if (ctx.trackingMode === "regularWar") {
		result = applyRegularWarRosterPoolSync_(ctx.rosterData, ctx.roster, source.members, nowIso, ownershipSnapshot);
	} else {
		result = applyRosterPoolSync_(ctx.rosterData, ctx.roster, source.members, source.sourceUsed, ownershipSnapshot, nowIso);
	}
	if (result && typeof result === "object") {
		result.memberTracking = memberTrackingByRosterId[ctx.rosterId] && typeof memberTrackingByRosterId[ctx.rosterId] === "object" ? memberTrackingByRosterId[ctx.rosterId] : null;
	}
	updateWarPerformanceMembership_(ctx.roster, nowIso);
	const outRosterData = validateRosterData_(ctx.rosterData);
	return { ok: true, rosterData: outRosterData, result: result };
}

function syncClanRosterPoolInternal_(rosterData, rosterId, optionsRaw) {
	return withRosterLock_(rosterId, function () {
		return syncClanRosterPoolCore_(rosterData, rosterId, optionsRaw);
	});
}

function syncClanRosterPool(rosterData, rosterId, password) {
	assertAdminPassword_(password);
	return syncClanRosterPoolInternal_(rosterData, rosterId);
}

function syncClanTodayLineupCore_(rosterData, rosterId, optionsRaw) {
	const ctx = findRosterForClanSync_(rosterData, rosterId);
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const prefetchedCurrentRegularWarByClanTag =
		options.prefetchedCurrentRegularWarByClanTag && typeof options.prefetchedCurrentRegularWarByClanTag === "object" ? options.prefetchedCurrentRegularWarByClanTag : {};
	const prefetchedRegularWarErrorByClanTag =
		options.prefetchedRegularWarErrorByClanTag && typeof options.prefetchedRegularWarErrorByClanTag === "object" ? options.prefetchedRegularWarErrorByClanTag : {};
	const prefetchedLeaguegroupRawByClanTag =
		options.prefetchedLeaguegroupRawByClanTag && typeof options.prefetchedLeaguegroupRawByClanTag === "object" ? options.prefetchedLeaguegroupRawByClanTag : {};
	const prefetchedLeaguegroupErrorByClanTag =
		options.prefetchedLeaguegroupErrorByClanTag && typeof options.prefetchedLeaguegroupErrorByClanTag === "object" ? options.prefetchedLeaguegroupErrorByClanTag : {};
	const prefetchedCwlWarRawByTag = options.prefetchedCwlWarRawByTag && typeof options.prefetchedCwlWarRawByTag === "object" ? options.prefetchedCwlWarRawByTag : {};
	const prefetchedCwlWarErrorByTag = options.prefetchedCwlWarErrorByTag && typeof options.prefetchedCwlWarErrorByTag === "object" ? options.prefetchedCwlWarErrorByTag : {};
	if (ctx.trackingMode === "regularWar") {
		let currentWar = null;
		if (Object.prototype.hasOwnProperty.call(prefetchedRegularWarErrorByClanTag, ctx.clanTag)) {
			throw prefetchedRegularWarErrorByClanTag[ctx.clanTag];
		}
		if (Object.prototype.hasOwnProperty.call(prefetchedCurrentRegularWarByClanTag, ctx.clanTag)) {
			currentWar = prefetchedCurrentRegularWarByClanTag[ctx.clanTag];
		} else {
			currentWar = fetchCurrentRegularWar_(ctx.clanTag);
		}
		const currentWarMeta = currentWar && currentWar.currentWarMeta && typeof currentWar.currentWarMeta === "object" ? currentWar.currentWarMeta : {};
		const unavailableReason = String((currentWarMeta && currentWarMeta.unavailableReason) || "").trim();
		if (unavailableReason === "privateWarLog") {
			const previousRegularWar = ctx.roster.regularWar && typeof ctx.roster.regularWar === "object" ? ctx.roster.regularWar : {};
			const previousCurrentWar = sanitizeRegularWarCurrentWar_(previousRegularWar.currentWar);
			const nextCurrentWar = Object.assign({}, previousCurrentWar);
			if (!nextCurrentWar.clanTag) nextCurrentWar.clanTag = ctx.clanTag;
			if (!nextCurrentWar.warKey || nextCurrentWar.warKey === "||") nextCurrentWar.warKey = normalizeTag_(ctx.clanTag) + "||";
			nextCurrentWar.available = false;
			nextCurrentWar.state = "notinwar";
			nextCurrentWar.unavailableReason = "privateWarLog";
			nextCurrentWar.statusMessage = "Live war data unavailable because the clan war log is private.";
			if (!ctx.roster.regularWar || typeof ctx.roster.regularWar !== "object") ctx.roster.regularWar = {};
			ctx.roster.regularWar.currentWar = nextCurrentWar;
			const outRosterData = validateRosterData_(ctx.rosterData);
			return {
				ok: true,
				rosterData: outRosterData,
				result: {
					mode: "regularWar",
					activeSet: Array.isArray(ctx.roster.main) ? ctx.roster.main.length : 0,
					benched: Array.isArray(ctx.roster.subs) ? ctx.roster.subs.length : 0,
					missing: Array.isArray(ctx.roster.missing) ? ctx.roster.missing.length : 0,
					updated: 0,
					unavailableReason: "privateWarLog",
					message: "current war lineup unavailable: private war log",
				},
			};
		}
		const state = String((currentWar && currentWar.state) || "")
			.trim()
			.toLowerCase();
		const lineupSource = state === "preparation" || state === "inwar" ? currentWar.participants : [];
		const result = applyTodayLineupSync_(ctx.roster, lineupSource);
		const outRosterData = validateRosterData_(ctx.rosterData);
		return {
			ok: true,
			rosterData: outRosterData,
			result: {
				mode: "regularWar",
				activeSet: result.activeSet,
				benched: result.benched,
				missing: Array.isArray(ctx.roster.missing) ? ctx.roster.missing.length : 0,
				updated: result.updated,
				message: state === "preparation" || state === "inwar" ? "" : "no current regular war found",
			},
		};
	}

	let leaguegroup = null;
	try {
		if (Object.prototype.hasOwnProperty.call(prefetchedLeaguegroupErrorByClanTag, ctx.clanTag)) {
			throw prefetchedLeaguegroupErrorByClanTag[ctx.clanTag];
		}
		if (Object.prototype.hasOwnProperty.call(prefetchedLeaguegroupRawByClanTag, ctx.clanTag)) {
			leaguegroup = mapLeagueGroupDataForClan_(ctx.clanTag, prefetchedLeaguegroupRawByClanTag[ctx.clanTag]);
		} else {
			leaguegroup = fetchLeagueGroupData_(ctx.clanTag);
		}
	} catch (err) {
		if (err && err.statusCode === 404) {
			throw new Error("No CWL league group found (404). Sync today lineup requires an active CWL league group.");
		}
		throw err;
	}

	if (!leaguegroup || !leaguegroup.clanFound) {
		throw new Error("Connected clan is not present in the current CWL league group.");
	}

	const currentWar = findCurrentCwlWarForClan_(ctx.clanTag, leaguegroup.warTags, {
		prefetchedCwlWarRawByTag: prefetchedCwlWarRawByTag,
		prefetchedCwlWarErrorByTag: prefetchedCwlWarErrorByTag,
	});
	if (!currentWar) {
		return {
			ok: true,
			rosterData: ctx.rosterData,
			result: { mode: "cwl", activeSet: 0, benched: 0, updated: 0, message: "no current CWL war found" },
		};
	}

	const result = applyTodayLineupSync_(ctx.roster, currentWar.members);
	const outRosterData = validateRosterData_(ctx.rosterData);
	return {
		ok: true,
		rosterData: outRosterData,
		result: Object.assign({ mode: "cwl" }, result),
	};
}

function syncClanTodayLineupInternal_(rosterData, rosterId, optionsRaw) {
	return withRosterLock_(rosterId, function () {
		return syncClanTodayLineupCore_(rosterData, rosterId, optionsRaw);
	});
}

function syncClanTodayLineup(rosterData, rosterId, password) {
	assertAdminPassword_(password);
	return syncClanTodayLineupInternal_(rosterData, rosterId);
}

function refreshCwlStatsCore_(rosterData, rosterId, optionsRaw) {
	const ctx = findRosterForClanSync_(rosterData, rosterId);
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const prefetchedLeaguegroupRawByClanTag =
		options.prefetchedLeaguegroupRawByClanTag && typeof options.prefetchedLeaguegroupRawByClanTag === "object" ? options.prefetchedLeaguegroupRawByClanTag : {};
	const prefetchedLeaguegroupErrorByClanTag =
		options.prefetchedLeaguegroupErrorByClanTag && typeof options.prefetchedLeaguegroupErrorByClanTag === "object" ? options.prefetchedLeaguegroupErrorByClanTag : {};
	const prefetchedCwlWarRawByTag = options.prefetchedCwlWarRawByTag && typeof options.prefetchedCwlWarRawByTag === "object" ? options.prefetchedCwlWarRawByTag : {};
	const prefetchedCwlWarErrorByTag = options.prefetchedCwlWarErrorByTag && typeof options.prefetchedCwlWarErrorByTag === "object" ? options.prefetchedCwlWarErrorByTag : {};
	const nowIso = new Date().toISOString();
	const warPerformance = prepareWarPerformanceForRefresh_(ctx.roster, nowIso);
	let leaguegroup = null;
	try {
		if (Object.prototype.hasOwnProperty.call(prefetchedLeaguegroupErrorByClanTag, ctx.clanTag)) {
			throw prefetchedLeaguegroupErrorByClanTag[ctx.clanTag];
		}
		if (Object.prototype.hasOwnProperty.call(prefetchedLeaguegroupRawByClanTag, ctx.clanTag)) {
			leaguegroup = prefetchedLeaguegroupRawByClanTag[ctx.clanTag];
		} else {
			leaguegroup = cocFetch_("/clans/" + encodeTagForPath_(ctx.clanTag) + "/currentwar/leaguegroup");
		}
	} catch (err) {
		if (err && err.statusCode === 404) {
			throw new Error("CWL not available");
		}
		throw err;
	}

	const warTags = extractLeagueGroupWarTags_(leaguegroup);
	if (!leagueGroupContainsClan_(leaguegroup, ctx.clanTag) || !warTags.length) {
		throw new Error("CWL not available");
	}

	const rosterPoolTagSet = buildRosterPoolTagSet_(ctx.roster);
	const trackedHistoryTagSet = buildTrackedWarHistoryTagSet_(ctx.roster, warPerformance, nowIso);
	const byTag = {};
	let warsProcessed = 0;
	let finalizedCwlWars = 0;

	for (let i = 0; i < warTags.length; i++) {
		const warTag = warTags[i];
		let war = null;
		if (Object.prototype.hasOwnProperty.call(prefetchedCwlWarErrorByTag, warTag)) {
			throw prefetchedCwlWarErrorByTag[warTag];
		}
		if (Object.prototype.hasOwnProperty.call(prefetchedCwlWarRawByTag, warTag)) {
			war = prefetchedCwlWarRawByTag[warTag];
		} else {
			war = cocFetch_("/clanwarleagues/wars/" + encodeTagForPath_(warTag));
		}
		const warState = String((war && war.state) || "").toLowerCase();
		if (warState !== "inwar" && warState !== "warended") continue;

		const side = pickWarSideForClan_(war, ctx.clanTag);
		if (!side) continue;
		warsProcessed++;
		if (warState === "warended") {
			const ingested = ingestCwlWarIntoWarPerformance_(warPerformance, war, warTag, ctx.clanTag, trackedHistoryTagSet, nowIso, "cwlRefreshWarEnded");
			if (ingested) finalizedCwlWars++;
		}

		const opponentSide = getOpponentSideForClan_(war, ctx.clanTag);
		const opponentThByTag = buildMemberThByTag_(opponentSide && opponentSide.members);

		const members = Array.isArray(side.members) ? side.members : [];
		for (let j = 0; j < members.length; j++) {
			const member = members[j] && typeof members[j] === "object" ? members[j] : {};
			const tag = normalizeTag_(member.tag);
			if (!tag || !rosterPoolTagSet[tag]) continue;

			if (!byTag[tag]) {
				byTag[tag] = createEmptyCwlStatEntry_();
			}

			const stats = byTag[tag];
			const attacks = Array.isArray(member.attacks) ? member.attacks : [];
			if (warState === "inwar" && attacks.length === 0) {
				stats.currentWarAttackPending = 1;
				continue;
			}

			const attackerTh = readTownHallLevel_(member);
			stats.daysInLineup++;
			stats.resolvedWarDays++;
			stats.attacksMade += attacks.length;
			if (attacks.length === 0) stats.missedAttacks++;

			for (let k = 0; k < attacks.length; k++) {
				const attack = attacks[k] && typeof attacks[k] === "object" ? attacks[k] : {};
				const stars = toNonNegativeInt_(attack.stars);
				const destruction = readAttackDestruction_(attack);
				const defenderTag = normalizeTag_(attack.defenderTag);
				const defenderTh = defenderTag && Object.prototype.hasOwnProperty.call(opponentThByTag, defenderTag) ? opponentThByTag[defenderTag] : null;
				stats.starsTotal += stars;
				stats.totalDestruction += destruction;
				stats.countedAttacks++;
				if (stars === 3) stats.threeStarCount++;
				if (typeof attackerTh === "number" && isFinite(attackerTh) && typeof defenderTh === "number" && isFinite(defenderTh)) {
					if (attackerTh < defenderTh) stats.hitUpCount++;
					else if (attackerTh > defenderTh) stats.hitDownCount++;
					else stats.sameThHitCount++;
				}
			}
		}
	}

	ctx.roster.cwlStats = {
		lastRefreshedAt: nowIso,
		season: typeof leaguegroup.season === "string" ? leaguegroup.season : "",
		byTag: byTag,
	};
	warPerformance.lastRefreshedAt = nowIso;
	ctx.roster.warPerformance = warPerformance;
	clearRosterBenchSuggestions_(ctx.roster);

	const outRosterData = validateRosterData_(ctx.rosterData);
	return {
		ok: true,
		rosterData: outRosterData,
		result: {
			mode: "cwl",
			warsProcessed: warsProcessed,
			playersTracked: Object.keys(byTag).length,
			finalizedCwlWars: finalizedCwlWars,
		},
	};
}

function refreshRegularWarStatsCore_(rosterData, rosterId, optionsRaw) {
	const ctx = findRosterForClanSync_(rosterData, rosterId);
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const prefetchedCurrentRegularWarByClanTag =
		options.prefetchedCurrentRegularWarByClanTag && typeof options.prefetchedCurrentRegularWarByClanTag === "object" ? options.prefetchedCurrentRegularWarByClanTag : {};
	const prefetchedRegularWarErrorByClanTag =
		options.prefetchedRegularWarErrorByClanTag && typeof options.prefetchedRegularWarErrorByClanTag === "object" ? options.prefetchedRegularWarErrorByClanTag : {};
	const nowIso = new Date().toISOString();

	const previousRegularWar = ctx.roster.regularWar && typeof ctx.roster.regularWar === "object" ? ctx.roster.regularWar : {};
	const previousByTag = previousRegularWar.byTag && typeof previousRegularWar.byTag === "object" ? previousRegularWar.byTag : {};
	const previousMembershipByTag = previousRegularWar.membershipByTag && typeof previousRegularWar.membershipByTag === "object" ? previousRegularWar.membershipByTag : {};
	const previousCurrentWarMeta = sanitizeRegularWarCurrentWar_(previousRegularWar.currentWar);

	const warPerformance = prepareWarPerformanceForRefresh_(ctx.roster, nowIso);
	const previousSnapshot = sanitizeRegularWarSnapshot_(warPerformance.lastRegularWarSnapshot);
	const lifecycle = sanitizeRegularWarLifecycleState_(warPerformance.regularWarLifecycle);
	warPerformance.regularWarLifecycle = lifecycle;
	const trackedTagSet = buildRosterPoolTagSet_(ctx.roster);
	const trackedTags = Object.keys(trackedTagSet);

	let currentWar = null;
	if (Object.prototype.hasOwnProperty.call(prefetchedRegularWarErrorByClanTag, ctx.clanTag)) {
		throw prefetchedRegularWarErrorByClanTag[ctx.clanTag];
	}
	if (Object.prototype.hasOwnProperty.call(prefetchedCurrentRegularWarByClanTag, ctx.clanTag)) {
		currentWar = prefetchedCurrentRegularWarByClanTag[ctx.clanTag];
	} else {
		currentWar = fetchCurrentRegularWar_(ctx.clanTag);
	}
	const currentWarMetaBase = currentWar && currentWar.currentWarMeta && typeof currentWar.currentWarMeta === "object" ? currentWar.currentWarMeta : buildNoCurrentRegularWarResult_(ctx.clanTag).currentWarMeta;
	const fetchedCurrentWarMeta = sanitizeRegularWarCurrentWar_(Object.assign({}, currentWarMetaBase, { available: !!(currentWar && currentWar.available) }));
	const currentWarUnavailableReason = String(fetchedCurrentWarMeta.unavailableReason || "").trim();
	const isCurrentWarPrivate = currentWarUnavailableReason === "privateWarLog";
	const currentWarMeta = isCurrentWarPrivate ? Object.assign({}, previousCurrentWarMeta) : fetchedCurrentWarMeta;
	if (!currentWarMeta.clanTag) currentWarMeta.clanTag = ctx.clanTag;
	if (!currentWarMeta.warKey || currentWarMeta.warKey === "||") {
		currentWarMeta.warKey = getStableRegularWarKey_(currentWarMeta, ctx.clanTag);
	}
	if (!currentWarMeta.warKey || currentWarMeta.warKey === "||") currentWarMeta.warKey = normalizeTag_(ctx.clanTag) + "||";
	if (isCurrentWarPrivate) {
		currentWarMeta.available = false;
		currentWarMeta.state = "notinwar";
		currentWarMeta.unavailableReason = "privateWarLog";
		currentWarMeta.statusMessage = "Live war data unavailable because the clan war log is private.";
	} else {
		currentWarMeta.unavailableReason = "";
		currentWarMeta.statusMessage = "";
	}
	const currentWarState =
		String((currentWar && currentWar.state) || currentWarMeta.state || "")
			.trim()
			.toLowerCase() || "notinwar";
	currentWarMeta.state = currentWarState;

	const trackedHistoryTagSet = buildTrackedWarHistoryTagSet_(ctx.roster, warPerformance, nowIso);
	const liveSnapshot = isCurrentWarPrivate ? null : buildRegularWarLiveSnapshot_(currentWar, ctx.clanTag, trackedHistoryTagSet, nowIso);
	const currentLiveWarKey = liveSnapshot && liveSnapshot.warMeta ? String(liveSnapshot.warMeta.warKey || "").trim() : "";
	const previousActiveWarKey = String((lifecycle && lifecycle.activeWarKey) || (previousSnapshot && previousSnapshot.warMeta && previousSnapshot.warMeta.warKey) || "").trim();

	let finalization = { attempted: false, finalized: false, source: "", incomplete: false, reason: "" };
	const shouldFinalizePrevious = !isCurrentWarPrivate && shouldFinalizePreviousRegularWar_(previousActiveWarKey, currentLiveWarKey || currentWarMeta.warKey, currentWarState);
	if (shouldFinalizePrevious) {
		finalization = tryFinalizePreviousRegularWar_({
			warPerformance: warPerformance,
			previousWarKey: previousActiveWarKey,
			currentWar: currentWar,
			currentWarMeta: liveSnapshot && liveSnapshot.warMeta ? liveSnapshot.warMeta : currentWarMeta,
			previousSnapshot: previousSnapshot,
			clanTag: ctx.clanTag,
			trackedTagSet: trackedHistoryTagSet,
			nowIso: nowIso,
		});
	}

	if (!previousActiveWarKey && liveSnapshot && currentWarState === "warended" && currentLiveWarKey) {
		finalization = tryFinalizePreviousRegularWar_({
			warPerformance: warPerformance,
			previousWarKey: currentLiveWarKey,
			currentWar: currentWar,
			currentWarMeta: liveSnapshot.warMeta,
			previousSnapshot: liveSnapshot,
			clanTag: ctx.clanTag,
			trackedTagSet: trackedHistoryTagSet,
			nowIso: nowIso,
		});
	}

	const nextLifecycle = sanitizeRegularWarLifecycleState_(warPerformance.regularWarLifecycle);
	const keepPendingPreviousWar = !isCurrentWarPrivate && !liveSnapshot && !!previousActiveWarKey && !!shouldFinalizePrevious && !!(finalization && finalization.attempted) && !(finalization && finalization.finalized);
	if (isCurrentWarPrivate) {
		nextLifecycle.activeWarKey = previousActiveWarKey || nextLifecycle.activeWarKey;
		nextLifecycle.activeWarState = nextLifecycle.activeWarState || "notinwar";
		nextLifecycle.activeWarLastSeenAt = nextLifecycle.activeWarLastSeenAt || nowIso;
	} else if (liveSnapshot && currentWarState !== "warended") {
		nextLifecycle.activeWarKey = String(liveSnapshot.warMeta && liveSnapshot.warMeta.warKey ? liveSnapshot.warMeta.warKey : "");
		nextLifecycle.activeWarState = currentWarState;
		nextLifecycle.activeWarLastSeenAt = nowIso;
		warPerformance.lastRegularWarSnapshot = liveSnapshot;
	} else if (keepPendingPreviousWar) {
		nextLifecycle.activeWarKey = previousActiveWarKey;
		nextLifecycle.activeWarState = "pendingfinalization";
		nextLifecycle.activeWarLastSeenAt = nowIso;
	} else {
		nextLifecycle.activeWarKey = "";
		nextLifecycle.activeWarState = currentWarState || "notinwar";
		nextLifecycle.activeWarLastSeenAt = nowIso;
		if (liveSnapshot && currentWarState === "warended") {
			warPerformance.lastRegularWarSnapshot = liveSnapshot;
		}
	}
	if (finalization && finalization.finalized) {
		nextLifecycle.lastFinalizedWarKey = previousActiveWarKey || currentLiveWarKey || nextLifecycle.lastFinalizedWarKey;
		nextLifecycle.lastFinalizedAt = nowIso;
		nextLifecycle.lastFinalizationSource = String(finalization.source || "");
		nextLifecycle.lastFinalizationIncomplete = !!finalization.incomplete;
	}
	warPerformance.regularWarLifecycle = nextLifecycle;
	warPerformance.lastRefreshedAt = nowIso;
	ctx.roster.warPerformance = warPerformance;

	const attacksPerMember = toNonNegativeInt_(currentWarMeta.attacksPerMember);
	const liveCurrentByTag = liveSnapshot && liveSnapshot.currentByTag && typeof liveSnapshot.currentByTag === "object" ? liveSnapshot.currentByTag : {};
	const byTag = {};
	for (let i = 0; i < trackedTags.length; i++) {
		const tag = trackedTags[i];
		const previousEntry = previousByTag[tag] && typeof previousByTag[tag] === "object" ? previousByTag[tag] : {};
		let currentEntry = createEmptyRegularWarCurrentEntry_(attacksPerMember);
		if (isCurrentWarPrivate && previousEntry.current) {
			currentEntry = sanitizeRegularWarCurrentEntry_(previousEntry.current, previousEntry.current && previousEntry.current.attacksAllowed);
		} else if (Object.prototype.hasOwnProperty.call(liveCurrentByTag, tag)) {
			currentEntry = sanitizeRegularWarCurrentEntry_(liveCurrentByTag[tag], attacksPerMember);
		}

		const perfEntry = warPerformance && warPerformance.byTag && typeof warPerformance.byTag === "object" && warPerformance.byTag[tag] && typeof warPerformance.byTag[tag] === "object" ? warPerformance.byTag[tag] : null;
		const perfRegular = perfEntry && perfEntry.regular ? sanitizeWarPerformanceStatsEntry_(perfEntry.regular) : null;
		const aggregateEntry = perfRegular
			? sanitizeRegularWarAggregateEntry_({
					warsInLineup: perfRegular.warsInLineup,
					attacksMade: perfRegular.attacksMade,
					attacksMissed: perfRegular.attacksMissed,
					starsTotal: perfRegular.starsTotal,
					totalDestruction: perfRegular.totalDestruction,
					countedAttacks: perfRegular.countedAttacks,
					threeStarCount: perfRegular.threeStarCount,
					hitUpCount: perfRegular.hitUpCount,
					sameThHitCount: perfRegular.sameThHitCount,
					hitDownCount: perfRegular.hitDownCount,
				})
			: previousEntry.aggregate
				? sanitizeRegularWarAggregateEntry_(previousEntry.aggregate)
				: createEmptyRegularWarAggregateEntry_();
		byTag[tag] = {
			current: sanitizeRegularWarCurrentEntry_(currentEntry, attacksPerMember),
			aggregate: aggregateEntry,
		};
	}

	const meta = sanitizeWarPerformanceMeta_(warPerformance.meta);
	const aggregateMeta = {
		source: "warPerformance",
		warLogAvailable: false,
		warsTracked: toNonNegativeInt_(meta.finalizedRegularWarCount),
		lastSuccessfulWarLogRefreshAt: typeof meta.lastRegularWarFinalizedAt === "string" ? meta.lastRegularWarFinalizedAt : "",
		unavailableReason: "",
		statusMessage: meta.lastRegularWarFinalizationIncomplete ? "At least one regular-war finalization used fallback data and may be incomplete." : "",
	};

	const membershipByTag = {};
	const setMembership = (playersRaw, role) => {
		const players = Array.isArray(playersRaw) ? playersRaw : [];
		for (let i = 0; i < players.length; i++) {
			const tag = normalizeTag_(players[i] && players[i].tag);
			if (!tag || !trackedTagSet[tag]) continue;
			const previousMembership = sanitizeRegularWarMembershipEntry_(previousMembershipByTag[tag]);
			const isMissing = role === "temporaryMissing";
			membershipByTag[tag] = {
				firstSeenAt: previousMembership.firstSeenAt || nowIso,
				lastSeenAt: isMissing ? previousMembership.lastSeenAt || "" : nowIso,
				missingSince: isMissing ? previousMembership.missingSince || nowIso : "",
				status: isMissing ? "temporaryMissing" : "active",
			};
		}
	};
	setMembership(ctx.roster.main, "active");
	setMembership(ctx.roster.subs, "active");
	setMembership(ctx.roster.missing, "temporaryMissing");

	ctx.roster.regularWar = {
		lastRefreshedAt: nowIso,
		currentWar: currentWarMeta,
		aggregateMeta: sanitizeRegularWarAggregateMeta_(aggregateMeta),
		byTag: byTag,
		membershipByTag: membershipByTag,
	};
	updateWarPerformanceMembership_(ctx.roster, nowIso);
	clearRosterBenchSuggestions_(ctx.roster);

	const outRosterData = validateRosterData_(ctx.rosterData);
	return {
		ok: true,
		rosterData: outRosterData,
		result: {
			mode: "regularWar",
			currentWarState: currentWarState,
			playersTracked: trackedTags.length,
			warsProcessed: toNonNegativeInt_(aggregateMeta.warsTracked),
			warLogAvailable: false,
			finalizationAttempted: !!(finalization && finalization.attempted),
			finalizedRegularWar: !!(finalization && finalization.finalized),
			finalizationSource: String((finalization && finalization.source) || ""),
			finalizationReason: String((finalization && finalization.reason) || ""),
			finalizationIncomplete: !!(finalization && finalization.incomplete),
			teamSize: toNonNegativeInt_(currentWarMeta.teamSize),
			attacksPerMember: toNonNegativeInt_(currentWarMeta.attacksPerMember),
			currentWarUnavailableReason: String(currentWarMeta.unavailableReason || ""),
			currentWarStatusMessage: String(currentWarMeta.statusMessage || ""),
			aggregateUnavailableReason: String(aggregateMeta && aggregateMeta.unavailableReason ? aggregateMeta.unavailableReason : ""),
			aggregateStatusMessage: String(aggregateMeta && aggregateMeta.statusMessage ? aggregateMeta.statusMessage : ""),
		},
	};
}

function refreshTrackingStatsCore_(rosterData, rosterId, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const prefetchedClanSnapshotsByTag = options.prefetchedClanSnapshotsByTag && typeof options.prefetchedClanSnapshotsByTag === "object" ? options.prefetchedClanSnapshotsByTag : {};
	const prefetchedClanErrorsByTag = options.prefetchedClanErrorsByTag && typeof options.prefetchedClanErrorsByTag === "object" ? options.prefetchedClanErrorsByTag : {};
	const ctx = findRosterById_(rosterData, rosterId);
	let capture = null;
	try {
		capture = captureMemberTrackingForRoster_(ctx.rosterData, ctx.rosterId, {
			continueOnError: true,
			metricsProfileMode: "always",
			prefetchedClanSnapshotsByTag: prefetchedClanSnapshotsByTag,
			prefetchedClanErrorsByTag: prefetchedClanErrorsByTag,
		});
		if (capture && capture.errors && capture.errors.length) {
			Logger.log(
				"refreshTrackingStatsCore metrics capture for roster '%s' had %s error(s), first=%s",
				ctx.rosterId,
				capture.errors.length,
				capture.errors[0] && capture.errors[0].message ? capture.errors[0].message : "",
			);
		}
	} catch (err) {
		Logger.log("refreshTrackingStatsCore metrics capture failed for roster '%s': %s", ctx.rosterId, errorMessage_(err));
	}
	const trackingMode = getRosterTrackingMode_(ctx.roster);
	let refresh = null;
	try {
		refresh = trackingMode === "regularWar" ? refreshRegularWarStatsCore_(ctx.rosterData, ctx.rosterId, options) : refreshCwlStatsCore_(ctx.rosterData, ctx.rosterId, options);
	} catch (err) {
		// Keep member metrics updates even when optional war endpoints are blocked by private war logs.
		if (capture && isPrivateWarLogError_(err)) {
			Logger.log("refreshTrackingStatsCore war refresh skipped for roster '%s' because war log is private: %s", ctx.rosterId, errorMessage_(err));
			return {
				ok: true,
				rosterData: validateRosterData_(ctx.rosterData),
				result: {
					mode: trackingMode,
					warDataSkipped: true,
					currentWarUnavailableReason: "privateWarLog",
					message: "war data unavailable: private war log",
					memberTracking: capture,
				},
			};
		}
		throw err;
	}
	if (capture && refresh && refresh.result && typeof refresh.result === "object") {
		refresh.result.memberTracking = capture;
	}
	return refresh;
}

function refreshCwlStatsInternal_(rosterData, rosterId, optionsRaw) {
	return withRosterLock_(rosterId, function () {
		return refreshCwlStatsCore_(rosterData, rosterId, optionsRaw);
	});
}

function refreshCwlStats(rosterData, rosterId, password) {
	assertAdminPassword_(password);
	return refreshCwlStatsInternal_(rosterData, rosterId);
}

function refreshTrackingStatsInternal_(rosterData, rosterId, optionsRaw) {
	return withRosterLock_(rosterId, function () {
		return refreshTrackingStatsCore_(rosterData, rosterId, optionsRaw);
	});
}

function refreshTrackingStats(rosterData, rosterId, password) {
	assertAdminPassword_(password);
	return refreshTrackingStatsInternal_(rosterData, rosterId);
}

const CWL_BENCH_PLANNER_CONFIG = {
	algorithm: "season_milp_v1",
	defaultSeasonDays: 7,
	priorMeanStarsPerStart: 2.0,
	priorWeightAttacks: 2.5,
	minExpectedStarsPerStart: 1.25,
	maxExpectedStarsPerStart: 2.75,
	perfPriorWeight: 3.0,
	starsPerfPriorMean: 0.5,
	destructionPerfPriorMean: 0.5,
	threeStarRatePriorWeight: 4.0,
	reliabilityPriorWeight: 2.5,
	weightTH: 0.38,
	weightStarsPerf: 0.22,
	weightDestructionPerf: 0.14,
	weightThreeStarRate: 0.1,
	weightHitUpAbility: 0.08,
	weightHitEvenAbility: 0.08,
	weightReliabilityPenalty: 0.2,
	churnPenalty: 0.03,
	reasonStrengthDeltaThreshold: 0.05,
	optimizerMaxPlayers: 42,
	optimizerMaxDays: 8,
	optimizerMaxStateCells: 250000,
	optimizerScoreScale: 100000,
};

function getBenchPlannerConfig_() {
	const out = {};
	const keys = Object.keys(CWL_BENCH_PLANNER_CONFIG);
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		out[key] = CWL_BENCH_PLANNER_CONFIG[key];
	}
	return out;
}

function compareTagsAsc_(a, b) {
	const left = String(a == null ? "" : a);
	const right = String(b == null ? "" : b);
	return left < right ? -1 : left > right ? 1 : 0;
}

function clampNumber_(value, minValue, maxValue) {
	const n = Number(value);
	if (!isFinite(n)) return Number(minValue);
	if (n < minValue) return Number(minValue);
	if (n > maxValue) return Number(maxValue);
	return n;
}

function normalizeUnitMetric_(value, fallbackValue) {
	const fallback = clampNumber_(fallbackValue, 0, 1);
	const n = Number(value);
	if (!isFinite(n)) return fallback;
	return clampNumber_(n, 0, 1);
}

function shrinkToward_(observedValue, priorMean, sampleSize, priorWeight) {
	const observed = Number(observedValue);
	const prior = Number(priorMean);
	const n = Math.max(0, Number(sampleSize) || 0);
	const w = Math.max(0, Number(priorWeight) || 0);
	const safeObserved = isFinite(observed) ? observed : prior;
	const safePrior = isFinite(prior) ? prior : 0;
	const denom = w + n;
	if (denom <= 0) return safePrior;
	return (w * safePrior + n * safeObserved) / denom;
}

function dedupeTagList_(tagsRaw) {
	const list = Array.isArray(tagsRaw) ? tagsRaw : [];
	const out = [];
	const seen = {};
	for (let i = 0; i < list.length; i++) {
		const tag = normalizeTag_(list[i]);
		if (!tag || seen[tag]) continue;
		seen[tag] = true;
		out.push(tag);
	}
	return out;
}

function dedupeStringList_(listRaw, limit) {
	const list = Array.isArray(listRaw) ? listRaw : [];
	const maxLen = Math.max(0, toNonNegativeInt_(limit || 0));
	const out = [];
	const seen = {};
	for (let i = 0; i < list.length; i++) {
		const text = String(list[i] == null ? "" : list[i]).trim();
		if (!text || seen[text]) continue;
		seen[text] = true;
		out.push(text);
		if (maxLen > 0 && out.length >= maxLen) break;
	}
	return out;
}

function listToTagSet_(listRaw) {
	const tags = Array.isArray(listRaw) ? listRaw : [];
	const out = {};
	for (let i = 0; i < tags.length; i++) {
		const tag = normalizeTag_(tags[i]);
		if (!tag) continue;
		out[tag] = true;
	}
	return out;
}

function tagListDiff_(leftListRaw, rightSetRaw) {
	const leftList = Array.isArray(leftListRaw) ? leftListRaw : [];
	const rightSet = rightSetRaw && typeof rightSetRaw === "object" ? rightSetRaw : {};
	const out = [];
	const seen = {};
	for (let i = 0; i < leftList.length; i++) {
		const tag = normalizeTag_(leftList[i]);
		if (!tag || seen[tag] || rightSet[tag]) continue;
		seen[tag] = true;
		out.push(tag);
	}
	return out;
}

function safeRoundNumber_(value, digits) {
	const n = Number(value);
	if (!isFinite(n)) return 0;
	const p = Math.pow(10, Math.max(0, toNonNegativeInt_(digits || 0)));
	return Math.round(n * p) / p;
}

function computeExpectedStarsPerStart_(playerStats, config) {
	const stats = playerStats && typeof playerStats === "object" ? playerStats : {};
	const priorMean = isFinite(Number(config && config.priorMeanStarsPerStart)) ? Number(config.priorMeanStarsPerStart) : 2.0;
	const priorWeight = Math.max(0, Number(config && config.priorWeightAttacks) || 0);
	const minExpected = isFinite(Number(config && config.minExpectedStarsPerStart)) ? Number(config.minExpectedStarsPerStart) : 1.25;
	const maxExpected = isFinite(Number(config && config.maxExpectedStarsPerStart)) ? Number(config.maxExpectedStarsPerStart) : 2.75;
	const countedAttacks = toNonNegativeInt_(stats.countedAttacks);
	const starsTotal = toNonNegativeInt_(stats.starsTotal);
	const observedAvgStars = starsTotal / Math.max(1, countedAttacks);
	const denom = priorWeight + countedAttacks;
	const raw = denom > 0 ? (priorWeight * priorMean + countedAttacks * observedAvgStars) / denom : priorMean;
	return clampNumber_(raw, minExpected, maxExpected);
}

function computeStartsNeededForReward_(playerStats, remainingDays, config) {
	const stats = playerStats && typeof playerStats === "object" ? playerStats : {};
	const starsTotal = toNonNegativeInt_(stats.starsTotal);
	const starsNeeded = Math.max(0, 8 - starsTotal);
	const expectedStarsPerStart = computeExpectedStarsPerStart_(stats, config);
	const startsNeeded = starsNeeded > 0 ? Math.max(0, Math.ceil(starsNeeded / Math.max(0.01, expectedStarsPerStart))) : 0;
	const remainingEditableDays = Math.max(0, toNonNegativeInt_(remainingDays));
	const rewardSlackMargin = remainingEditableDays - startsNeeded;
	return {
		starsNeeded: starsNeeded,
		expectedStarsPerStart: expectedStarsPerStart,
		startsNeeded: startsNeeded,
		rewardSlackMargin: rewardSlackMargin,
		rewardFeasible: rewardSlackMargin >= 0,
		rewardCritical: startsNeeded > 0 && rewardSlackMargin === 0,
		impossibleReward: rewardSlackMargin < 0,
	};
}

function computeStrengthScore_(playerStats, planningContext, config) {
	const stats = playerStats && typeof playerStats === "object" ? playerStats : {};
	const ctx = planningContext && typeof planningContext === "object" ? planningContext : {};
	const weights = config && typeof config === "object" ? config : {};
	const th = toNonNegativeInt_(stats.th);
	const countedAttacks = toNonNegativeInt_(stats.countedAttacks);
	const resolvedWarDays = toNonNegativeInt_(stats.resolvedWarDays);
	const thMin = toNonNegativeInt_(ctx.thMin);
	const thMax = toNonNegativeInt_(ctx.thMax);
	const normTH = thMax > thMin ? clampNumber_((th - thMin) / (thMax - thMin), 0, 1) : 0.5;

	const starsPerfPrior = normalizeUnitMetric_(weights.starsPerfPriorMean, 0.5);
	const destructionPrior = normalizeUnitMetric_(weights.destructionPerfPriorMean, 0.5);
	const perfPriorWeight = Math.max(0, Number(weights.perfPriorWeight) || 0);
	const starsPerfRaw = normalizeUnitMetric_(stats.starsPerf, starsPerfPrior);
	const destructionPerfRaw = normalizeUnitMetric_(stats.destructionPerf, destructionPrior);
	const shrinkedStarsPerf = normalizeUnitMetric_(shrinkToward_(starsPerfRaw, starsPerfPrior, countedAttacks, perfPriorWeight), starsPerfPrior);
	const shrinkedDestructionPerf = normalizeUnitMetric_(shrinkToward_(destructionPerfRaw, destructionPrior, countedAttacks, perfPriorWeight), destructionPrior);

	const threeStarRateRaw = clampNumber_(toNonNegativeInt_(stats.threeStarCount) / Math.max(1, countedAttacks), 0, 1);
	const threeStarRateMean = normalizeUnitMetric_(ctx.poolThreeStarRateMean, 0.33);
	const shrinkedThreeStarRate = normalizeUnitMetric_(shrinkToward_(threeStarRateRaw, threeStarRateMean, countedAttacks, Math.max(0, Number(weights.threeStarRatePriorWeight) || 0)), threeStarRateMean);

	const hitUpShare = clampNumber_(toNonNegativeInt_(stats.hitUpCount) / Math.max(1, countedAttacks), 0, 1);
	const hitEvenShare = clampNumber_(toNonNegativeInt_(stats.sameThHitCount) / Math.max(1, countedAttacks), 0, 1);
	const hitUpAbility = clampNumber_(0.65 * shrinkedStarsPerf + 0.35 * hitUpShare, 0, 1);
	const hitEvenAbility = clampNumber_(0.65 * shrinkedStarsPerf + 0.35 * hitEvenShare, 0, 1);

	const missRateRaw = clampNumber_(toNonNegativeInt_(stats.missedAttacks) / Math.max(1, resolvedWarDays), 0, 1);
	const poolMissRateMean = normalizeUnitMetric_(ctx.poolMissRateMean, 0.1);
	const reliabilityPenalty = normalizeUnitMetric_(shrinkToward_(missRateRaw, poolMissRateMean, resolvedWarDays, Math.max(0, Number(weights.reliabilityPriorWeight) || 0)), poolMissRateMean);

	const score = (Number(weights.weightTH) || 0) * normTH + (Number(weights.weightStarsPerf) || 0) * shrinkedStarsPerf + (Number(weights.weightDestructionPerf) || 0) * shrinkedDestructionPerf + (Number(weights.weightThreeStarRate) || 0) * shrinkedThreeStarRate + (Number(weights.weightHitUpAbility) || 0) * hitUpAbility + (Number(weights.weightHitEvenAbility) || 0) * hitEvenAbility - (Number(weights.weightReliabilityPenalty) || 0) * reliabilityPenalty;

	return {
		score: score,
		normTH: normTH,
		shrinkedStarsPerf: shrinkedStarsPerf,
		shrinkedDestructionPerf: shrinkedDestructionPerf,
		shrinkedThreeStarRate: shrinkedThreeStarRate,
		hitUpAbility: hitUpAbility,
		hitEvenAbility: hitEvenAbility,
		reliabilityPenalty: reliabilityPenalty,
	};
}

function buildCwlSeasonContext_(roster, config) {
	const rosterSafe = roster && typeof roster === "object" ? roster : {};
	const rosterStatsByTag = rosterSafe && rosterSafe.cwlStats && rosterSafe.cwlStats.byTag && typeof rosterSafe.cwlStats.byTag === "object" ? rosterSafe.cwlStats.byTag : {};
	const defaultSeasonDays = Math.max(1, toNonNegativeInt_((config && config.defaultSeasonDays) || 7));
	let maxResolvedWarDays = 0;
	let hasPendingCurrentWarAttack = false;
	const statsTags = Object.keys(rosterStatsByTag);
	for (let i = 0; i < statsTags.length; i++) {
		const entry = sanitizeCwlStatEntry_(rosterStatsByTag[statsTags[i]]);
		maxResolvedWarDays = Math.max(maxResolvedWarDays, toNonNegativeInt_(entry.resolvedWarDays));
		if (toNonNegativeInt_(entry.currentWarAttackPending) > 0) {
			hasPendingCurrentWarAttack = true;
		}
	}

	const lockedDaysEstimate = clampNumber_(maxResolvedWarDays + (hasPendingCurrentWarAttack ? 1 : 0), 0, defaultSeasonDays);
	const seasonFromRoster = rosterSafe && rosterSafe.cwlStats && typeof rosterSafe.cwlStats.season === "string" ? rosterSafe.cwlStats.season : "";
	const fallbackContext = {
		source: "stats_fallback",
		season: seasonFromRoster || "",
		totalSeasonDays: defaultSeasonDays,
		completedDays: clampNumber_(maxResolvedWarDays, 0, defaultSeasonDays),
		lockedDays: lockedDaysEstimate,
		remainingEditableDays: Math.max(0, defaultSeasonDays - lockedDaysEstimate),
		nextEditableDayIndex: defaultSeasonDays - lockedDaysEstimate > 0 ? 0 : -1,
		warnings: [],
	};

	const clanTag = normalizeTag_(rosterSafe.connectedClanTag);
	if (!clanTag) {
		fallbackContext.warnings.push("season-context-no-connected-clan-tag");
		return fallbackContext;
	}

	try {
		const leaguegroup = cocFetch_("/clans/" + encodeTagForPath_(clanTag) + "/currentwar/leaguegroup");
		const rounds = Array.isArray(leaguegroup && leaguegroup.rounds) ? leaguegroup.rounds : [];
		const totalSeasonDays = rounds.length > 0 ? rounds.length : fallbackContext.totalSeasonDays;
		const roundStates = [];

		for (let i = 0; i < totalSeasonDays; i++) {
			const round = rounds[i] && typeof rounds[i] === "object" ? rounds[i] : {};
			const warTags = Array.isArray(round.warTags) ? round.warTags : [];
			let roundState = "editable";
			let foundClanWar = false;

			for (let j = 0; j < warTags.length; j++) {
				const warTag = normalizeTag_(warTags[j]);
				if (!warTag || warTag === "#0") continue;

				let war = null;
				try {
					war = cocFetch_("/clanwarleagues/wars/" + encodeTagForPath_(warTag));
				} catch (err) {
					if (err && err.statusCode === 404) continue;
					throw err;
				}
				if (!pickWarSideForClan_(war, clanTag)) continue;
				foundClanWar = true;

				const warState = String((war && war.state) || "").toLowerCase();
				if (warState === "warended") roundState = "completed";
				else if (warState === "inwar") roundState = "locked";
				else roundState = "editable";
				break;
			}

			if (!foundClanWar) {
				roundState = "editable";
			}
			roundStates.push(roundState);
		}

		let completedDays = 0;
		let lockedDays = 0;
		let remainingEditableDays = 0;
		for (let i = 0; i < roundStates.length; i++) {
			if (roundStates[i] === "completed") {
				completedDays++;
				lockedDays++;
			} else if (roundStates[i] === "locked") {
				lockedDays++;
			} else {
				remainingEditableDays++;
			}
		}

		return {
			source: "leaguegroup",
			season: leaguegroup && typeof leaguegroup.season === "string" ? leaguegroup.season : seasonFromRoster || "",
			totalSeasonDays: totalSeasonDays,
			completedDays: completedDays,
			lockedDays: lockedDays,
			remainingEditableDays: remainingEditableDays,
			nextEditableDayIndex: remainingEditableDays > 0 ? 0 : -1,
			warnings: [],
		};
	} catch (err) {
		Logger.log("buildCwlSeasonContext_ fallback for clan %s: %s", clanTag, err && err.message ? err.message : String(err));
		fallbackContext.warnings.push("season-context-api-fallback");
		return fallbackContext;
	}
}

function buildCwlPlanningSnapshot_(roster, seasonContext, config) {
	const rosterSafe = roster && typeof roster === "object" ? roster : {};
	const season = seasonContext && typeof seasonContext === "object" ? seasonContext : {};
	const rosterStatsByTag = rosterSafe && rosterSafe.cwlStats && rosterSafe.cwlStats.byTag && typeof rosterSafe.cwlStats.byTag === "object" ? rosterSafe.cwlStats.byTag : {};
	const currentMainRaw = Array.isArray(rosterSafe.main) ? rosterSafe.main : [];
	const poolPlayersRaw = collectRosterPoolPlayers_(rosterSafe);
	let requestedMainSize = Number(rosterSafe && rosterSafe.badges && rosterSafe.badges.main);
	if (!isFinite(requestedMainSize)) requestedMainSize = currentMainRaw.length;
	requestedMainSize = Math.max(0, Math.floor(requestedMainSize));

	const currentMainTags = [];
	const currentMainSeen = {};
	for (let i = 0; i < currentMainRaw.length; i++) {
		const tag = normalizeTag_(currentMainRaw[i] && currentMainRaw[i].tag);
		if (!tag || currentMainSeen[tag]) continue;
		currentMainSeen[tag] = true;
		currentMainTags.push(tag);
	}
	const currentMainTagSet = listToTagSet_(currentMainTags);

	const players = [];
	const playersByTag = {};
	let thMin = Number.MAX_SAFE_INTEGER;
	let thMax = 0;
	let sumThreeStarRate = 0;
	let sumMissRate = 0;
	let countedForMeans = 0;

	for (let i = 0; i < poolPlayersRaw.length; i++) {
		const player = poolPlayersRaw[i] && typeof poolPlayersRaw[i] === "object" ? poolPlayersRaw[i] : {};
		const tag = normalizeTag_(player.tag);
		if (!tag || playersByTag[tag]) continue;

		const metrics = deriveCwlMetrics_(rosterStatsByTag[tag]);
		const rewardModel = computeStartsNeededForReward_(metrics, season.remainingEditableDays, config);
		const th = typeof player.th === "number" && isFinite(player.th) ? Math.floor(player.th) : 0;
		const next = {
			tag: tag,
			name: String(player.name == null ? "" : player.name),
			th: th,
			isCurrentMain: !!currentMainTagSet[tag],
			starsTotal: metrics.starsTotal,
			missedAttacks: metrics.missedAttacks,
			countedAttacks: metrics.countedAttacks,
			starsPerf: metrics.starsPerf,
			destructionPerf: metrics.destructionPerf,
			avgDestruction: metrics.avgDestruction,
			currentWarAttackPending: metrics.currentWarAttackPending,
			threeStarCount: metrics.threeStarCount,
			hitUpCount: metrics.hitUpCount,
			sameThHitCount: metrics.sameThHitCount,
			hitDownCount: metrics.hitDownCount,
			resolvedWarDays: metrics.resolvedWarDays,
			attacksMade: metrics.attacksMade,
			excludeAsSwapTarget: toBooleanFlag_(player.excludeAsSwapTarget),
			excludeAsSwapSource: toBooleanFlag_(player.excludeAsSwapSource),
			expectedStarsPerStart: rewardModel.expectedStarsPerStart,
			starsNeeded: rewardModel.starsNeeded,
			startsNeeded: rewardModel.startsNeeded,
			rewardSlackMargin: rewardModel.rewardSlackMargin,
			rewardFeasible: rewardModel.rewardFeasible,
			rewardCritical: rewardModel.rewardCritical,
			impossibleReward: rewardModel.impossibleReward,
			hasMissedAttackHistory: metrics.missedAttacks > 0,
			strengthScore: 0,
		};
		players.push(next);
		playersByTag[tag] = next;

		thMin = Math.min(thMin, th);
		thMax = Math.max(thMax, th);
		sumThreeStarRate += toNonNegativeInt_(metrics.threeStarCount) / Math.max(1, toNonNegativeInt_(metrics.countedAttacks));
		sumMissRate += toNonNegativeInt_(metrics.missedAttacks) / Math.max(1, toNonNegativeInt_(metrics.resolvedWarDays));
		countedForMeans++;
	}

	if (players.length === 0) thMin = 0;
	const planningContext = {
		thMin: thMin,
		thMax: thMax,
		poolThreeStarRateMean: countedForMeans > 0 ? sumThreeStarRate / countedForMeans : 0.33,
		poolMissRateMean: countedForMeans > 0 ? sumMissRate / countedForMeans : 0.1,
	};

	for (let i = 0; i < players.length; i++) {
		const strength = computeStrengthScore_(players[i], planningContext, config);
		players[i].strengthScore = strength.score;
		players[i].strengthComponents = strength;
	}

	const dedupedCurrentMainTags = [];
	for (let i = 0; i < currentMainTags.length; i++) {
		if (!playersByTag[currentMainTags[i]]) continue;
		dedupedCurrentMainTags.push(currentMainTags[i]);
	}

	const effectiveMainSize = Math.max(0, Math.min(requestedMainSize, players.length));
	const needsRewardsCount = players.filter((p) => p.starsNeeded > 0).length;

	return {
		players: players,
		playersByTag: playersByTag,
		rosterPoolSize: players.length,
		requestedMainSize: requestedMainSize,
		mainSize: effectiveMainSize,
		currentMainTags: dedupedCurrentMainTags,
		currentMainTagSet: listToTagSet_(dedupedCurrentMainTags),
		remainingEditableDays: Math.max(0, toNonNegativeInt_(season.remainingEditableDays)),
		needsRewardsCount: needsRewardsCount,
		seasonContext: season,
	};
}

function parsePlannerStateKey_(stateKey) {
	const parts = String(stateKey == null ? "" : stateKey).split("|");
	const starts = Math.max(0, parseInt(parts[0] || "0", 10) || 0);
	const coverage = Math.max(0, parseInt(parts[1] || "0", 10) || 0);
	return { starts: starts, coverage: coverage };
}

function comparePlannerStateKeys_(a, b) {
	const pa = parsePlannerStateKey_(a);
	const pb = parsePlannerStateKey_(b);
	if (pa.starts !== pb.starts) return pa.starts - pb.starts;
	if (pa.coverage !== pb.coverage) return pa.coverage - pb.coverage;
	return compareTagsAsc_(String(a), String(b));
}

function calculateCoveredStarts_(players, startCountsByTag) {
	const list = Array.isArray(players) ? players : [];
	const startsByTag = startCountsByTag && typeof startCountsByTag === "object" ? startCountsByTag : {};
	let covered = 0;
	for (let i = 0; i < list.length; i++) {
		const p = list[i] && typeof list[i] === "object" ? list[i] : {};
		const starts = toNonNegativeInt_(startsByTag[p.tag]);
		const startsNeeded = toNonNegativeInt_(p.startsNeeded);
		covered += Math.min(starts, startsNeeded);
	}
	return covered;
}

function buildDayZeroTargetLineup_(snapshot, remainingByTag) {
	const remaining = remainingByTag && typeof remainingByTag === "object" ? remainingByTag : {};
	const mainSize = Math.max(0, toNonNegativeInt_(snapshot && snapshot.mainSize));
	const daysLeftIncludingToday = Math.max(0, toNonNegativeInt_(snapshot && snapshot.remainingEditableDays));
	const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
	const currentMainSet = snapshot && snapshot.currentMainTagSet && typeof snapshot.currentMainTagSet === "object" ? snapshot.currentMainTagSet : {};
	const seen = {};
	const candidates = [];

	for (let i = 0; i < players.length; i++) {
		const player = players[i] && typeof players[i] === "object" ? players[i] : {};
		const tag = normalizeTag_(player.tag);
		if (!tag || seen[tag]) continue;
		seen[tag] = true;

		const remainingAssignedStarts = toNonNegativeInt_(remaining[tag]);
		if (remainingAssignedStarts <= 0) continue;

		const rewardSlackRaw = Number(player.rewardSlackMargin);
		candidates.push({
			tag: tag,
			mustPlayToday: remainingAssignedStarts >= daysLeftIncludingToday,
			rewardSlackMargin: isFinite(rewardSlackRaw) ? rewardSlackRaw : Number.MAX_SAFE_INTEGER,
			strengthScore: Number(player.strengthScore) || 0,
			startsNeeded: toNonNegativeInt_(player.startsNeeded),
			isCurrentMain: !!currentMainSet[tag],
		});
	}

	candidates.sort((a, b) => {
		if (a.mustPlayToday !== b.mustPlayToday) return a.mustPlayToday ? -1 : 1;
		if (a.rewardSlackMargin !== b.rewardSlackMargin) return a.rewardSlackMargin - b.rewardSlackMargin;
		if (a.strengthScore !== b.strengthScore) return b.strengthScore - a.strengthScore;
		if (a.startsNeeded !== b.startsNeeded) return b.startsNeeded - a.startsNeeded;
		if (a.isCurrentMain !== b.isCurrentMain) return a.isCurrentMain ? -1 : 1;
		return compareTagsAsc_(a.tag, b.tag);
	});

	return candidates.slice(0, mainSize).map((p) => p.tag);
}

function buildDayAssignmentsFromStartCounts_(snapshot, startCountsByTag) {
	const days = Math.max(0, toNonNegativeInt_(snapshot && snapshot.remainingEditableDays));
	const mainSize = Math.max(0, toNonNegativeInt_(snapshot && snapshot.mainSize));
	const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
	const startsByTag = startCountsByTag && typeof startCountsByTag === "object" ? startCountsByTag : {};
	const remainingByTag = {};
	for (let i = 0; i < players.length; i++) {
		const tag = players[i].tag;
		remainingByTag[tag] = toNonNegativeInt_(startsByTag[tag]);
	}

	const assignments = [];
	for (let day = 0; day < days; day++) {
		let selectedTags = [];
		if (day === 0) {
			selectedTags = buildDayZeroTargetLineup_(snapshot, remainingByTag);
		} else {
			selectedTags = players
				.filter((p) => toNonNegativeInt_(remainingByTag[p.tag]) > 0)
				.sort((a, b) => {
					const aRemaining = toNonNegativeInt_(remainingByTag[a.tag]);
					const bRemaining = toNonNegativeInt_(remainingByTag[b.tag]);
					if (aRemaining !== bRemaining) return bRemaining - aRemaining;
					if (a.strengthScore !== b.strengthScore) return b.strengthScore - a.strengthScore;
					if (a.startsNeeded !== b.startsNeeded) return b.startsNeeded - a.startsNeeded;
					return compareTagsAsc_(a.tag, b.tag);
				})
				.slice(0, mainSize)
				.map((p) => p.tag);
		}

		if (selectedTags.length < mainSize) return null;
		assignments.push(selectedTags);
		for (let i = 0; i < selectedTags.length; i++) {
			const tag = selectedTags[i];
			remainingByTag[tag] = Math.max(0, toNonNegativeInt_(remainingByTag[tag]) - 1);
		}
	}

	for (let i = 0; i < players.length; i++) {
		if (toNonNegativeInt_(remainingByTag[players[i].tag]) > 0) return null;
	}
	return assignments;
}

function optimizeSeasonPlanByDynamicProgramming_(snapshot, coverageTarget, config) {
	const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
	const days = Math.max(0, toNonNegativeInt_(snapshot && snapshot.remainingEditableDays));
	const mainSize = Math.max(0, toNonNegativeInt_(snapshot && snapshot.mainSize));
	const totalStarts = days * mainSize;
	const targetCoverage = Math.max(0, toNonNegativeInt_(coverageTarget));
	const scale = Math.max(1, toNonNegativeInt_((config && config.optimizerScoreScale) || 100000));
	const retentionBonus = Math.max(0, Number(config && config.churnPenalty) || 0) * 2;

	let currentLayer = {
		"0|0": {
			value: 0,
			prevKey: "",
			starts: 0,
		},
	};
	const layers = [currentLayer];

	for (let i = 0; i < players.length; i++) {
		const player = players[i];
		const nextLayer = {};
		const stateKeys = Object.keys(currentLayer).sort(comparePlannerStateKeys_);
		const startsNeeded = Math.max(0, toNonNegativeInt_(player.startsNeeded));

		for (let j = 0; j < stateKeys.length; j++) {
			const key = stateKeys[j];
			const state = currentLayer[key];
			const parsed = parsePlannerStateKey_(key);
			const currentStarts = parsed.starts;
			const currentCoverage = parsed.coverage;

			for (let starts = 0; starts <= days; starts++) {
				const nextStarts = currentStarts + starts;
				if (nextStarts > totalStarts) continue;
				const nextCoverage = Math.min(targetCoverage, currentCoverage + Math.min(starts, startsNeeded));
				const bonus = player.isCurrentMain && starts > 0 ? retentionBonus : 0;
				const contribution = starts * player.strengthScore + bonus;
				const scoreInt = state.value + Math.round(contribution * scale);
				const nextKey = nextStarts + "|" + nextCoverage;
				const existing = nextLayer[nextKey];
				if (!existing || scoreInt > existing.value || (scoreInt === existing.value && starts < existing.starts)) {
					nextLayer[nextKey] = {
						value: scoreInt,
						prevKey: key,
						starts: starts,
					};
				}
			}
		}

		currentLayer = nextLayer;
		layers.push(currentLayer);
	}

	const finalKey = totalStarts + "|" + targetCoverage;
	if (!currentLayer[finalKey]) return null;

	const startCountsByTag = {};
	let backtrackKey = finalKey;
	for (let i = players.length - 1; i >= 0; i--) {
		const layer = layers[i + 1];
		const entry = layer[backtrackKey];
		if (!entry) return null;
		startCountsByTag[players[i].tag] = entry.starts;
		backtrackKey = entry.prevKey;
	}

	const dayAssignments = buildDayAssignmentsFromStartCounts_(snapshot, startCountsByTag);
	if (!dayAssignments) return null;

	let totalStrength = 0;
	for (let i = 0; i < players.length; i++) {
		const starts = toNonNegativeInt_(startCountsByTag[players[i].tag]);
		totalStrength += starts * players[i].strengthScore;
	}
	const coveredStarts = calculateCoveredStarts_(players, startCountsByTag);
	return {
		mode: "optimizer",
		startCountsByTag: startCountsByTag,
		dayAssignments: dayAssignments,
		totalStrength: totalStrength,
		coveredStarts: coveredStarts,
	};
}

function boostFallbackCoverageTowardTarget_(players, startCountsByTag, coverageTarget, days) {
	const list = Array.isArray(players) ? players : [];
	const startsByTag = startCountsByTag && typeof startCountsByTag === "object" ? startCountsByTag : {};
	const target = Math.max(0, toNonNegativeInt_(coverageTarget));
	let covered = calculateCoveredStarts_(list, startsByTag);
	let guard = 0;
	const maxGuard = 5000;

	while (covered < target && guard < maxGuard) {
		guard++;
		const needers = list
			.filter((p) => toNonNegativeInt_(startsByTag[p.tag]) < days && toNonNegativeInt_(startsByTag[p.tag]) < toNonNegativeInt_(p.startsNeeded))
			.sort((a, b) => {
				if (a.rewardSlackMargin !== b.rewardSlackMargin) return a.rewardSlackMargin - b.rewardSlackMargin;
				if (a.startsNeeded !== b.startsNeeded) return b.startsNeeded - a.startsNeeded;
				if (a.strengthScore !== b.strengthScore) return b.strengthScore - a.strengthScore;
				return compareTagsAsc_(a.tag, b.tag);
			});
		if (!needers.length) break;

		const donors = list
			.filter((p) => toNonNegativeInt_(startsByTag[p.tag]) > 0)
			.sort((a, b) => {
				const aStarts = toNonNegativeInt_(startsByTag[a.tag]);
				const bStarts = toNonNegativeInt_(startsByTag[b.tag]);
				const aExcess = Math.max(0, aStarts - toNonNegativeInt_(a.startsNeeded));
				const bExcess = Math.max(0, bStarts - toNonNegativeInt_(b.startsNeeded));
				if (aExcess !== bExcess) return bExcess - aExcess;
				if (a.strengthScore !== b.strengthScore) return a.strengthScore - b.strengthScore;
				return compareTagsAsc_(a.tag, b.tag);
			});
		if (!donors.length) break;

		let improved = false;
		for (let i = 0; i < needers.length && !improved; i++) {
			const needy = needers[i];
			for (let j = 0; j < donors.length && !improved; j++) {
				const donor = donors[j];
				if (donor.tag === needy.tag) continue;
				const donorStarts = toNonNegativeInt_(startsByTag[donor.tag]);
				const needyStarts = toNonNegativeInt_(startsByTag[needy.tag]);
				if (donorStarts <= 0 || needyStarts >= days) continue;

				const donorCoverageBefore = Math.min(donorStarts, toNonNegativeInt_(donor.startsNeeded));
				const needyCoverageBefore = Math.min(needyStarts, toNonNegativeInt_(needy.startsNeeded));
				const donorCoverageAfter = Math.min(Math.max(0, donorStarts - 1), toNonNegativeInt_(donor.startsNeeded));
				const needyCoverageAfter = Math.min(needyStarts + 1, toNonNegativeInt_(needy.startsNeeded));
				const deltaCoverage = donorCoverageAfter + needyCoverageAfter - (donorCoverageBefore + needyCoverageBefore);
				if (deltaCoverage <= 0) continue;

				startsByTag[donor.tag] = donorStarts - 1;
				startsByTag[needy.tag] = needyStarts + 1;
				covered += deltaCoverage;
				improved = true;
			}
		}
		if (!improved) break;
	}
}

function buildFallbackSeasonLineupPlan_(snapshot, coverageTarget) {
	const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
	const days = Math.max(0, toNonNegativeInt_(snapshot && snapshot.remainingEditableDays));
	const mainSize = Math.max(0, toNonNegativeInt_(snapshot && snapshot.mainSize));
	const totalStarts = days * mainSize;
	const startCountsByTag = {};
	for (let i = 0; i < players.length; i++) startCountsByTag[players[i].tag] = 0;

	let slotsRemaining = totalStarts;
	const rewardOrder = players.slice().sort((a, b) => {
		if (a.rewardSlackMargin !== b.rewardSlackMargin) return a.rewardSlackMargin - b.rewardSlackMargin;
		if (a.startsNeeded !== b.startsNeeded) return b.startsNeeded - a.startsNeeded;
		if (a.strengthScore !== b.strengthScore) return b.strengthScore - a.strengthScore;
		return compareTagsAsc_(a.tag, b.tag);
	});

	let progressed = true;
	while (slotsRemaining > 0 && progressed) {
		progressed = false;
		for (let i = 0; i < rewardOrder.length; i++) {
			const p = rewardOrder[i];
			const currentStarts = toNonNegativeInt_(startCountsByTag[p.tag]);
			if (currentStarts >= days) continue;
			if (currentStarts >= toNonNegativeInt_(p.startsNeeded)) continue;
			startCountsByTag[p.tag] = currentStarts + 1;
			slotsRemaining--;
			progressed = true;
			if (slotsRemaining <= 0) break;
		}
	}

	const strengthOrder = players.slice().sort((a, b) => {
		if (a.strengthScore !== b.strengthScore) return b.strengthScore - a.strengthScore;
		if (a.rewardSlackMargin !== b.rewardSlackMargin) return a.rewardSlackMargin - b.rewardSlackMargin;
		return compareTagsAsc_(a.tag, b.tag);
	});

	while (slotsRemaining > 0) {
		let assigned = false;
		for (let i = 0; i < strengthOrder.length; i++) {
			const p = strengthOrder[i];
			const currentStarts = toNonNegativeInt_(startCountsByTag[p.tag]);
			if (currentStarts >= days) continue;
			startCountsByTag[p.tag] = currentStarts + 1;
			slotsRemaining--;
			assigned = true;
			if (slotsRemaining <= 0) break;
		}
		if (!assigned) break;
	}

	boostFallbackCoverageTowardTarget_(players, startCountsByTag, coverageTarget, days);
	const dayAssignments = buildDayAssignmentsFromStartCounts_(snapshot, startCountsByTag);
	if (!dayAssignments) return null;

	let totalStrength = 0;
	for (let i = 0; i < players.length; i++) {
		const starts = toNonNegativeInt_(startCountsByTag[players[i].tag]);
		totalStrength += starts * players[i].strengthScore;
	}
	return {
		mode: "fallback",
		startCountsByTag: startCountsByTag,
		dayAssignments: dayAssignments,
		totalStrength: totalStrength,
		coveredStarts: calculateCoveredStarts_(players, startCountsByTag),
	};
}

function buildEmergencySeasonPlan_(snapshot) {
	const days = Math.max(0, toNonNegativeInt_(snapshot && snapshot.remainingEditableDays));
	const mainSize = Math.max(0, toNonNegativeInt_(snapshot && snapshot.mainSize));
	const currentMainTags = Array.isArray(snapshot && snapshot.currentMainTags) ? snapshot.currentMainTags : [];
	const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
	const currentMainSet = listToTagSet_(currentMainTags);
	const sortedPlayers = players.slice().sort((a, b) => {
		const aCurrent = !!currentMainSet[a.tag];
		const bCurrent = !!currentMainSet[b.tag];
		if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
		if (a.strengthScore !== b.strengthScore) return b.strengthScore - a.strengthScore;
		return compareTagsAsc_(a.tag, b.tag);
	});
	const targetMain = sortedPlayers.slice(0, mainSize).map((p) => p.tag);
	const dayAssignments = [];
	for (let d = 0; d < days; d++) dayAssignments.push(targetMain.slice());
	const startCountsByTag = {};
	for (let i = 0; i < players.length; i++) startCountsByTag[players[i].tag] = 0;
	for (let d = 0; d < dayAssignments.length; d++) {
		for (let i = 0; i < dayAssignments[d].length; i++) {
			const tag = dayAssignments[d][i];
			startCountsByTag[tag] = toNonNegativeInt_(startCountsByTag[tag]) + 1;
		}
	}
	let totalStrength = 0;
	for (let i = 0; i < players.length; i++) {
		totalStrength += toNonNegativeInt_(startCountsByTag[players[i].tag]) * players[i].strengthScore;
	}
	return {
		mode: "emergency",
		startCountsByTag: startCountsByTag,
		dayAssignments: dayAssignments,
		totalStrength: totalStrength,
		coveredStarts: calculateCoveredStarts_(players, startCountsByTag),
	};
}

function solveSeasonLineupPlan_(snapshot, config) {
	const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
	const remainingEditableDays = Math.max(0, toNonNegativeInt_(snapshot && snapshot.remainingEditableDays));
	const mainSize = Math.max(0, toNonNegativeInt_(snapshot && snapshot.mainSize));
	const totalStarts = remainingEditableDays * mainSize;
	const plan = {
		dayAssignments: [],
		targetMainTags: [],
		startCountsByTag: {},
		optimalTotalSlack: 0,
		totalSlack: 0,
		coveredStarts: 0,
		solverMode: "none",
		warnings: [],
	};

	if (remainingEditableDays <= 0 || mainSize <= 0 || players.length <= 0) {
		plan.solverMode = "none";
		return plan;
	}

	let totalStartsNeeded = 0;
	let coverageCapacity = 0;
	for (let i = 0; i < players.length; i++) {
		const startsNeeded = toNonNegativeInt_(players[i].startsNeeded);
		totalStartsNeeded += startsNeeded;
		coverageCapacity += Math.min(remainingEditableDays, startsNeeded);
	}
	const coverageTarget = Math.min(totalStarts, coverageCapacity);
	plan.optimalTotalSlack = Math.max(0, totalStartsNeeded - coverageTarget);

	const estimatedStateCells = players.length * (totalStarts + 1) * (coverageTarget + 1);
	const exceedsGuards = players.length > toNonNegativeInt_(config && config.optimizerMaxPlayers) || remainingEditableDays > toNonNegativeInt_(config && config.optimizerMaxDays) || estimatedStateCells > toNonNegativeInt_(config && config.optimizerMaxStateCells);

	let solved = null;
	if (!exceedsGuards) {
		try {
			solved = optimizeSeasonPlanByDynamicProgramming_(snapshot, coverageTarget, config);
		} catch (err) {
			Logger.log("optimizeSeasonPlanByDynamicProgramming_ failed: %s", err && err.message ? err.message : String(err));
			plan.warnings.push("optimizer-error-fallback");
		}
	} else {
		plan.warnings.push("optimizer-guard-fallback");
	}

	if (!solved) {
		solved = buildFallbackSeasonLineupPlan_(snapshot, coverageTarget);
	}
	if (!solved) {
		plan.warnings.push("fallback-scheduler-failed-emergency-plan");
		solved = buildEmergencySeasonPlan_(snapshot);
	}

	plan.solverMode = solved && solved.mode ? solved.mode : "unknown";
	plan.startCountsByTag = solved && solved.startCountsByTag ? solved.startCountsByTag : {};
	plan.dayAssignments = solved && Array.isArray(solved.dayAssignments) ? solved.dayAssignments : [];
	plan.targetMainTags = plan.dayAssignments.length ? plan.dayAssignments[0].slice() : [];
	plan.coveredStarts = toNonNegativeInt_(solved && solved.coveredStarts);
	plan.totalSlack = Math.max(0, totalStartsNeeded - plan.coveredStarts);
	plan.totalStrength = Number(solved && solved.totalStrength) || 0;
	return plan;
}

function compareActionableRemovalPriority_(tagA, tagB, snapshot, forcedKeepSet) {
	const playersByTag = snapshot && snapshot.playersByTag && typeof snapshot.playersByTag === "object" ? snapshot.playersByTag : {};
	const currentMainSet = snapshot && snapshot.currentMainTagSet && typeof snapshot.currentMainTagSet === "object" ? snapshot.currentMainTagSet : {};
	const playerA = playersByTag[tagA] || {};
	const playerB = playersByTag[tagB] || {};
	const aForced = !!(forcedKeepSet && forcedKeepSet[tagA]);
	const bForced = !!(forcedKeepSet && forcedKeepSet[tagB]);
	if (aForced !== bForced) return aForced ? 1 : -1;
	const aCurrent = !!currentMainSet[tagA];
	const bCurrent = !!currentMainSet[tagB];
	if (aCurrent !== bCurrent) return aCurrent ? 1 : -1;
	const aNeeded = toNonNegativeInt_(playerA.startsNeeded);
	const bNeeded = toNonNegativeInt_(playerB.startsNeeded);
	if (aNeeded !== bNeeded) return aNeeded - bNeeded;
	const aScore = Number(playerA.strengthScore) || 0;
	const bScore = Number(playerB.strengthScore) || 0;
	if (aScore !== bScore) return aScore - bScore;
	return compareTagsAsc_(tagA, tagB);
}

function orderTargetMainTags_(selectedSet, snapshot) {
	const set = selectedSet && typeof selectedSet === "object" ? selectedSet : {};
	const currentMainTags = Array.isArray(snapshot && snapshot.currentMainTags) ? snapshot.currentMainTags : [];
	const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
	const out = [];
	const seen = {};
	const mainSize = Math.max(0, toNonNegativeInt_(snapshot && snapshot.mainSize));

	for (let i = 0; i < currentMainTags.length; i++) {
		const tag = normalizeTag_(currentMainTags[i]);
		if (!tag || !set[tag] || seen[tag]) continue;
		seen[tag] = true;
		out.push(tag);
		if (out.length >= mainSize) return out;
	}

	const rest = players
		.filter((p) => set[p.tag] && !seen[p.tag])
		.sort((a, b) => {
			if (a.strengthScore !== b.strengthScore) return b.strengthScore - a.strengthScore;
			if (a.startsNeeded !== b.startsNeeded) return b.startsNeeded - a.startsNeeded;
			return compareTagsAsc_(a.tag, b.tag);
		});
	for (let i = 0; i < rest.length && out.length < mainSize; i++) {
		out.push(rest[i].tag);
	}
	return out;
}

function buildActionableTargetMainTags_(snapshot, idealTargetTagsRaw) {
	const idealTargetTags = dedupeTagList_(idealTargetTagsRaw);
	const mainSize = Math.max(0, toNonNegativeInt_(snapshot && snapshot.mainSize));
	const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
	const playersByTag = snapshot && snapshot.playersByTag && typeof snapshot.playersByTag === "object" ? snapshot.playersByTag : {};
	const currentMainTags = Array.isArray(snapshot && snapshot.currentMainTags) ? snapshot.currentMainTags : [];
	const currentMainSet = snapshot && snapshot.currentMainTagSet && typeof snapshot.currentMainTagSet === "object" ? snapshot.currentMainTagSet : {};
	const selectedSet = {};

	for (let i = 0; i < idealTargetTags.length; i++) {
		const tag = idealTargetTags[i];
		if (!playersByTag[tag]) continue;
		selectedSet[tag] = true;
	}

	const forcedKeepSet = {};
	for (let i = 0; i < currentMainTags.length; i++) {
		const tag = currentMainTags[i];
		const player = playersByTag[tag];
		if (!player || !player.excludeAsSwapSource) continue;
		forcedKeepSet[tag] = true;
		selectedSet[tag] = true;
	}

	const blockedInSet = {};
	const selectedTagsForCheck = Object.keys(selectedSet);
	for (let i = 0; i < selectedTagsForCheck.length; i++) {
		const tag = selectedTagsForCheck[i];
		const player = playersByTag[tag];
		if (!player) continue;
		if (!currentMainSet[tag] && player.excludeAsSwapTarget) {
			blockedInSet[tag] = true;
			delete selectedSet[tag];
		}
	}

	while (Object.keys(selectedSet).length > mainSize) {
		const removable = Object.keys(selectedSet).filter((tag) => !forcedKeepSet[tag]);
		if (!removable.length) break;
		removable.sort((a, b) => compareActionableRemovalPriority_(a, b, snapshot, forcedKeepSet));
		delete selectedSet[removable[0]];
	}

	if (Object.keys(selectedSet).length < mainSize) {
		for (let i = 0; i < currentMainTags.length && Object.keys(selectedSet).length < mainSize; i++) {
			const tag = currentMainTags[i];
			if (!playersByTag[tag] || selectedSet[tag]) continue;
			selectedSet[tag] = true;
		}
	}

	if (Object.keys(selectedSet).length < mainSize) {
		const fillCandidates = players.slice().sort((a, b) => {
			if (a.strengthScore !== b.strengthScore) return b.strengthScore - a.strengthScore;
			if (a.startsNeeded !== b.startsNeeded) return b.startsNeeded - a.startsNeeded;
			return compareTagsAsc_(a.tag, b.tag);
		});
		for (let i = 0; i < fillCandidates.length && Object.keys(selectedSet).length < mainSize; i++) {
			const p = fillCandidates[i];
			if (selectedSet[p.tag]) continue;
			if (!currentMainSet[p.tag] && p.excludeAsSwapTarget) continue;
			selectedSet[p.tag] = true;
		}
	}

	const blockedOutTags = [];
	const idealSet = listToTagSet_(idealTargetTags);
	for (let i = 0; i < currentMainTags.length; i++) {
		const tag = currentMainTags[i];
		if (idealSet[tag]) continue;
		const player = playersByTag[tag];
		if (player && player.excludeAsSwapSource) blockedOutTags.push(tag);
	}

	const targetTags = orderTargetMainTags_(selectedSet, snapshot);
	return {
		targetTags: targetTags,
		blockedOutTags: dedupeTagList_(blockedOutTags),
		blockedInTags: dedupeTagList_(Object.keys(blockedInSet)),
	};
}

function reasonRankForCode_(code) {
	const c = String(code == null ? "" : code);
	if (c === "reward_critical") return 4;
	if (c === "missed_attack_risk") return 3;
	if (c === "strength_upgrade") return 2;
	if (c === "th_upgrade") return 1;
	if (c === "blocked_by_exclusion") return 0;
	return -1;
}

function buildSwapExplanation_(swapInPlayer, benchOutPlayer, config) {
	const inPlayer = swapInPlayer && typeof swapInPlayer === "object" ? swapInPlayer : {};
	const outPlayer = benchOutPlayer && typeof benchOutPlayer === "object" ? benchOutPlayer : {};
	const strengthDelta = (Number(inPlayer.strengthScore) || 0) - (Number(outPlayer.strengthScore) || 0);
	const strengthThreshold = isFinite(Number(config && config.reasonStrengthDeltaThreshold)) ? Number(config.reasonStrengthDeltaThreshold) : 0.05;
	const rewardCriticalIn = toNonNegativeInt_(inPlayer.startsNeeded) > 0 && Number(inPlayer.rewardSlackMargin) <= 0;
	const missedAttackRisk = !!(outPlayer.hasMissedAttackHistory && !inPlayer.hasMissedAttackHistory);
	const thUpgrade = toNonNegativeInt_(inPlayer.th) > toNonNegativeInt_(outPlayer.th);

	let reasonCode = "strength_upgrade";
	let shortReason = "Strength upgrade";
	if (rewardCriticalIn) {
		reasonCode = "reward_critical";
		shortReason = "Reward-critical start allocation";
	} else if (missedAttackRisk) {
		reasonCode = "missed_attack_risk";
		shortReason = "Lower missed-attack risk";
	} else if (strengthDelta >= strengthThreshold) {
		reasonCode = "strength_upgrade";
		shortReason = "Clear strength upgrade";
	} else if (thUpgrade && strengthDelta >= -0.02) {
		reasonCode = "th_upgrade";
		shortReason = "TH upgrade with no major downside";
	} else {
		reasonCode = "strength_upgrade";
		shortReason = "Lineup strength balancing";
	}

	const rewardImpact = "in needs " + toNonNegativeInt_(inPlayer.startsNeeded) + " start(s), out needs " + toNonNegativeInt_(outPlayer.startsNeeded) + ".";
	const reasonText = shortReason + " (" + rewardImpact + ")";
	return {
		reasonCode: reasonCode,
		shortReason: shortReason,
		scoreDelta: safeRoundNumber_(strengthDelta, 4),
		rewardImpact: rewardImpact,
		reasonText: reasonText,
		reasonRank: reasonRankForCode_(reasonCode),
	};
}

function buildPairsFromDelta_(swapInTagsRaw, benchOutTagsRaw, snapshot, config) {
	const swapInTags = dedupeTagList_(swapInTagsRaw);
	const benchOutTags = dedupeTagList_(benchOutTagsRaw);
	const playersByTag = snapshot && snapshot.playersByTag && typeof snapshot.playersByTag === "object" ? snapshot.playersByTag : {};
	const availableOutByTag = listToTagSet_(benchOutTags);
	const pairs = [];

	const swapInPlayers = swapInTags
		.map((tag) => playersByTag[tag])
		.filter(Boolean)
		.sort((a, b) => {
			const aCritical = a.startsNeeded > 0 && Number(a.rewardSlackMargin) <= 0;
			const bCritical = b.startsNeeded > 0 && Number(b.rewardSlackMargin) <= 0;
			if (aCritical !== bCritical) return aCritical ? -1 : 1;
			if (a.startsNeeded !== b.startsNeeded) return b.startsNeeded - a.startsNeeded;
			if (a.strengthScore !== b.strengthScore) return b.strengthScore - a.strengthScore;
			return compareTagsAsc_(a.tag, b.tag);
		});

	for (let i = 0; i < swapInPlayers.length; i++) {
		const swapInPlayer = swapInPlayers[i];
		const outCandidates = [];
		for (let j = 0; j < benchOutTags.length; j++) {
			const outTag = benchOutTags[j];
			if (!availableOutByTag[outTag]) continue;
			const outPlayer = playersByTag[outTag];
			if (!outPlayer) continue;
			const explanation = buildSwapExplanation_(swapInPlayer, outPlayer, config);
			outCandidates.push({
				outPlayer: outPlayer,
				explanation: explanation,
				thDiff: Math.abs(toNonNegativeInt_(swapInPlayer.th) - toNonNegativeInt_(outPlayer.th)),
			});
		}
		if (!outCandidates.length) continue;

		outCandidates.sort((a, b) => {
			if (a.thDiff !== b.thDiff) return a.thDiff - b.thDiff;
			if (a.explanation.reasonRank !== b.explanation.reasonRank) {
				return b.explanation.reasonRank - a.explanation.reasonRank;
			}
			if (a.explanation.scoreDelta !== b.explanation.scoreDelta) {
				return b.explanation.scoreDelta - a.explanation.scoreDelta;
			}
			if (a.outPlayer.strengthScore !== b.outPlayer.strengthScore) {
				return a.outPlayer.strengthScore - b.outPlayer.strengthScore;
			}
			return compareTagsAsc_(a.outPlayer.tag, b.outPlayer.tag);
		});

		const chosen = outCandidates[0];
		delete availableOutByTag[chosen.outPlayer.tag];
		pairs.push({
			outTag: chosen.outPlayer.tag,
			inTag: swapInPlayer.tag,
			reasonCode: chosen.explanation.reasonCode,
			reasonText: chosen.explanation.reasonText,
			shortReason: chosen.explanation.shortReason,
			scoreDelta: chosen.explanation.scoreDelta,
			rewardImpact: chosen.explanation.rewardImpact,
		});
	}

	return pairs;
}

function deriveNextDaySwapSuggestionsFromPlan_(roster, plan, snapshot, config) {
	const currentMainTags = dedupeTagList_(snapshot && snapshot.currentMainTags);
	const currentMainSet = listToTagSet_(currentMainTags);
	const idealTargetMainTags = dedupeTagList_(plan && plan.targetMainTags);
	const actionable = buildActionableTargetMainTags_(snapshot, idealTargetMainTags);
	const actionableTargetMainTags = dedupeTagList_(actionable && actionable.targetTags);
	const actionableTargetSet = listToTagSet_(actionableTargetMainTags);

	let benchTags = tagListDiff_(currentMainTags, actionableTargetSet);
	let swapInTags = tagListDiff_(actionableTargetMainTags, currentMainSet);

	const playersByTag = snapshot && snapshot.playersByTag && typeof snapshot.playersByTag === "object" ? snapshot.playersByTag : {};
	benchTags = benchTags.filter((tag) => !(playersByTag[tag] && playersByTag[tag].excludeAsSwapSource));
	swapInTags = swapInTags.filter((tag) => !(playersByTag[tag] && playersByTag[tag].excludeAsSwapTarget));

	const pairs = buildPairsFromDelta_(swapInTags, benchTags, snapshot, config);
	const blockedOutTags = dedupeTagList_(actionable && actionable.blockedOutTags);
	const blockedInTags = dedupeTagList_(actionable && actionable.blockedInTags);
	const blockedByExclusions = blockedOutTags.length > 0 || blockedInTags.length > 0;

	return {
		targetMainTags: idealTargetMainTags,
		actionableTargetMainTags: actionableTargetMainTags,
		benchTags: benchTags,
		swapInTags: swapInTags,
		pairs: pairs,
		blockedByExclusions: blockedByExclusions,
		blockedByExclusionOutTags: blockedOutTags,
		blockedByExclusionInTags: blockedInTags,
	};
}

function buildBenchSuggestionSummary_(roster, plan, suggestions, snapshot, config) {
	const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
	const rewardCriticalPlayerTags = players.filter((p) => p.rewardCritical).map((p) => p.tag);
	const impossibleRewardPlayerTags = players.filter((p) => p.impossibleReward).map((p) => p.tag);
	const rewardFeasiblePlayerCount = players.length - impossibleRewardPlayerTags.length;
	const warnings = [];
	const seasonWarnings = snapshot && snapshot.seasonContext && Array.isArray(snapshot.seasonContext.warnings) ? snapshot.seasonContext.warnings : [];
	for (let i = 0; i < seasonWarnings.length; i++) warnings.push(seasonWarnings[i]);
	if (snapshot && snapshot.requestedMainSize > snapshot.mainSize) warnings.push("active-slots-clamped-to-roster-size");
	if (plan && Array.isArray(plan.warnings)) {
		for (let i = 0; i < plan.warnings.length; i++) warnings.push(plan.warnings[i]);
	}
	if (snapshot && snapshot.remainingEditableDays <= 0) warnings.push("no-editable-cwl-day");

	const plannerSummary = {
		remainingEditableDays: Math.max(0, toNonNegativeInt_(snapshot && snapshot.remainingEditableDays)),
		optimalTotalSlack: Math.max(0, toNonNegativeInt_(plan && plan.optimalTotalSlack)),
		rewardFeasiblePlayerCount: Math.max(0, toNonNegativeInt_(rewardFeasiblePlayerCount)),
		rewardCriticalPlayerTags: rewardCriticalPlayerTags,
		impossibleRewardPlayerTags: impossibleRewardPlayerTags,
		blockedByExclusions: !!(suggestions && suggestions.blockedByExclusions),
		blockedByExclusionOutTags: dedupeTagList_(suggestions && suggestions.blockedByExclusionOutTags),
		blockedByExclusionInTags: dedupeTagList_(suggestions && suggestions.blockedByExclusionInTags),
		solverMode: String((plan && plan.solverMode) || ""),
	};
	const dedupedWarnings = dedupeStringList_(warnings, 20);
	if (dedupedWarnings.length) plannerSummary.warnings = dedupedWarnings;

	return {
		plannerSummary: plannerSummary,
		configSnapshot: {
			defaultSeasonDays: Number(config && config.defaultSeasonDays) || 7,
			priorMeanStarsPerStart: Number(config && config.priorMeanStarsPerStart) || 2,
			priorWeightAttacks: Number(config && config.priorWeightAttacks) || 0,
			minExpectedStarsPerStart: Number(config && config.minExpectedStarsPerStart) || 0,
			maxExpectedStarsPerStart: Number(config && config.maxExpectedStarsPerStart) || 0,
			weightTH: Number(config && config.weightTH) || 0,
			weightStarsPerf: Number(config && config.weightStarsPerf) || 0,
			weightDestructionPerf: Number(config && config.weightDestructionPerf) || 0,
			weightThreeStarRate: Number(config && config.weightThreeStarRate) || 0,
			weightHitUpAbility: Number(config && config.weightHitUpAbility) || 0,
			weightHitEvenAbility: Number(config && config.weightHitEvenAbility) || 0,
			weightReliabilityPenalty: Number(config && config.weightReliabilityPenalty) || 0,
			churnPenalty: Number(config && config.churnPenalty) || 0,
		},
	};
}

function computeBenchSuggestionsCore_(rosterData, rosterId) {
	const ctx = findRosterById_(rosterData, rosterId);
	const trackingMode = getRosterTrackingMode_(ctx.roster);
	if (trackingMode === "regularWar") {
		clearRosterBenchSuggestions_(ctx.roster);
		const outRosterData = validateRosterData_(ctx.rosterData);
		return {
			ok: true,
			mode: "regularWar",
			benchTags: [],
			swapInTags: [],
			pairs: [],
			rosterData: outRosterData,
			result: {
				mode: "regularWar",
				benchCount: 0,
				swapCount: 0,
				needsRewardsCount: 0,
				message: "bench suggestions are disabled for regular war rosters",
			},
			algorithm: "",
			nextEditableDayIndex: -1,
			plannerSummary: null,
			targetMainTags: [],
			actionableTargetMainTags: [],
		};
	}
	const config = getBenchPlannerConfig_();
	const updatedAt = new Date().toISOString();
	const seasonContext = buildCwlSeasonContext_(ctx.roster, config);
	const snapshot = buildCwlPlanningSnapshot_(ctx.roster, seasonContext, config);
	const plan = solveSeasonLineupPlan_(snapshot, config);
	const suggestions = deriveNextDaySwapSuggestionsFromPlan_(ctx.roster, plan, snapshot, config);
	const summary = buildBenchSuggestionSummary_(ctx.roster, plan, suggestions, snapshot, config);

	const benchSuggestions = {
		updatedAt: updatedAt,
		algorithm: String(config.algorithm || "season_milp_v1"),
		nextEditableDayIndex: snapshot.remainingEditableDays > 0 ? 0 : -1,
		targetMainTags: suggestions.targetMainTags,
		actionableTargetMainTags: suggestions.actionableTargetMainTags,
		benchTags: suggestions.benchTags,
		swapInTags: suggestions.swapInTags,
		pairs: suggestions.pairs,
		result: {
			benchCount: suggestions.benchTags.length,
			swapCount: suggestions.pairs.length,
			rosterPoolSize: snapshot.rosterPoolSize,
			activeSlots: snapshot.requestedMainSize,
			needsRewardsCount: snapshot.needsRewardsCount,
		},
		plannerSummary: summary.plannerSummary,
		configSnapshot: summary.configSnapshot,
	};

	ctx.roster.benchSuggestions = benchSuggestions;
	Logger.log("computeBenchSuggestions planner rosterId=%s days=%s slack=%s solver=%s swaps=%s blocked=%s", ctx.rosterId, snapshot.remainingEditableDays, plan.optimalTotalSlack, plan.solverMode, suggestions.pairs.length, suggestions.blockedByExclusions ? "1" : "0");

	const outRosterData = validateRosterData_(ctx.rosterData);
	return {
		ok: true,
		benchTags: benchSuggestions.benchTags,
		swapInTags: benchSuggestions.swapInTags,
		pairs: benchSuggestions.pairs,
		rosterData: outRosterData,
		result: benchSuggestions.result,
		algorithm: benchSuggestions.algorithm,
		nextEditableDayIndex: benchSuggestions.nextEditableDayIndex,
		plannerSummary: benchSuggestions.plannerSummary,
		targetMainTags: benchSuggestions.targetMainTags,
		actionableTargetMainTags: benchSuggestions.actionableTargetMainTags,
	};
}

function computeBenchSuggestionsInternal_(rosterData, rosterId) {
	return withRosterLock_(rosterId, function () {
		return computeBenchSuggestionsCore_(rosterData, rosterId);
	});
}

function computeBenchSuggestions(rosterData, rosterId, password) {
	assertAdminPassword_(password);
	return computeBenchSuggestionsInternal_(rosterData, rosterId);
}

function createDebugPlayer_(tag, name, th, opts) {
	const options = opts && typeof opts === "object" ? opts : {};
	return {
		slot: options.isSub ? null : 1,
		name: String(name == null ? "" : name),
		discord: "",
		th: Math.max(0, toNonNegativeInt_(th)),
		tag: normalizeTag_(tag),
		notes: [],
		excludeAsSwapTarget: toBooleanFlag_(options.excludeAsSwapTarget),
		excludeAsSwapSource: toBooleanFlag_(options.excludeAsSwapSource),
	};
}

function createDebugStats_(opts) {
	const options = opts && typeof opts === "object" ? opts : {};
	const out = createEmptyCwlStatEntry_();
	const keys = Object.keys(out);
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		out[key] = toNonNegativeInt_(options[key]);
	}
	return out;
}

function runBenchPlannerDebugScenarios() {
	const config = getBenchPlannerConfig_();
	const runScenario = (name, roster, remainingEditableDays, check) => {
		const seasonContext = {
			source: "debug",
			season: "debug",
			totalSeasonDays: Math.max(0, toNonNegativeInt_(remainingEditableDays)),
			completedDays: 0,
			lockedDays: 0,
			remainingEditableDays: Math.max(0, toNonNegativeInt_(remainingEditableDays)),
			nextEditableDayIndex: remainingEditableDays > 0 ? 0 : -1,
			warnings: [],
		};
		const snapshot = buildCwlPlanningSnapshot_(roster, seasonContext, config);
		const plan = solveSeasonLineupPlan_(snapshot, config);
		const suggestions = deriveNextDaySwapSuggestionsFromPlan_(roster, plan, snapshot, config);
		const summary = buildBenchSuggestionSummary_(roster, plan, suggestions, snapshot, config);
		let pass = false;
		try {
			pass = !!check({
				snapshot: snapshot,
				plan: plan,
				suggestions: suggestions,
				summary: summary,
			});
		} catch (err) {
			pass = false;
		}
		return {
			name: name,
			pass: pass,
			solverMode: plan.solverMode,
			optimalTotalSlack: plan.optimalTotalSlack,
			benchTags: suggestions.benchTags,
			swapInTags: suggestions.swapInTags,
			blockedByExclusions: suggestions.blockedByExclusions,
		};
	};

	const scenario1Roster = {
		id: "dbg-1",
		title: "Scenario 1",
		badges: { main: 1, subs: 1 },
		main: [createDebugPlayer_("#P20Y", "MainWeak", 13)],
		subs: [createDebugPlayer_("#Q8LG", "SubStrong", 16, { isSub: true })],
		cwlStats: {
			season: "debug",
			byTag: {
				"#P20Y": createDebugStats_({
					starsTotal: 8,
					resolvedWarDays: 6,
					attacksMade: 6,
					missedAttacks: 1,
					threeStarCount: 0,
					totalDestruction: 420,
					countedAttacks: 6,
					hitUpCount: 0,
					sameThHitCount: 2,
					hitDownCount: 4,
				}),
				"#Q8LG": createDebugStats_({
					starsTotal: 10,
					resolvedWarDays: 4,
					attacksMade: 4,
					missedAttacks: 0,
					threeStarCount: 3,
					totalDestruction: 360,
					countedAttacks: 4,
					hitUpCount: 1,
					sameThHitCount: 2,
					hitDownCount: 1,
				}),
			},
		},
	};

	const scenario2Roster = {
		id: "dbg-2",
		title: "Scenario 2",
		badges: { main: 1, subs: 1 },
		main: [createDebugPlayer_("#Y2P8", "MainSafe", 15)],
		subs: [createDebugPlayer_("#G0CU", "SubCritical", 14, { isSub: true })],
		cwlStats: {
			season: "debug",
			byTag: {
				"#Y2P8": createDebugStats_({
					starsTotal: 10,
					resolvedWarDays: 4,
					attacksMade: 4,
					missedAttacks: 0,
					threeStarCount: 2,
					totalDestruction: 320,
					countedAttacks: 4,
				}),
				"#G0CU": createDebugStats_({
					starsTotal: 7,
					resolvedWarDays: 3,
					attacksMade: 3,
					missedAttacks: 0,
					threeStarCount: 1,
					totalDestruction: 240,
					countedAttacks: 3,
				}),
			},
		},
	};

	const scenario3Roster = {
		id: "dbg-3",
		title: "Scenario 3",
		badges: { main: 1, subs: 0 },
		main: [createDebugPlayer_("#JQ28", "PendingOnly", 14)],
		subs: [],
		cwlStats: {
			season: "debug",
			byTag: {
				"#JQ28": createDebugStats_({
					starsTotal: 6,
					resolvedWarDays: 3,
					attacksMade: 3,
					missedAttacks: 0,
					threeStarCount: 1,
					totalDestruction: 255,
					countedAttacks: 3,
					currentWarAttackPending: 1,
				}),
			},
		},
	};

	const scenario4Roster = {
		id: "dbg-4",
		title: "Scenario 4",
		badges: { main: 1, subs: 1 },
		main: [createDebugPlayer_("#L0VG", "LockedMain", 12, { excludeAsSwapSource: true })],
		subs: [createDebugPlayer_("#RCU2", "IdealSub", 16, { isSub: true })],
		cwlStats: {
			season: "debug",
			byTag: {
				"#L0VG": createDebugStats_({
					starsTotal: 10,
					resolvedWarDays: 4,
					attacksMade: 4,
					missedAttacks: 1,
					threeStarCount: 0,
					totalDestruction: 220,
					countedAttacks: 4,
				}),
				"#RCU2": createDebugStats_({
					starsTotal: 9,
					resolvedWarDays: 3,
					attacksMade: 3,
					missedAttacks: 0,
					threeStarCount: 2,
					totalDestruction: 300,
					countedAttacks: 3,
				}),
			},
		},
	};

	const scenario5Roster = {
		id: "dbg-5",
		title: "Scenario 5",
		badges: { main: 1, subs: 1 },
		main: [createDebugPlayer_("#U8P0", "NeedOneA", 14)],
		subs: [createDebugPlayer_("#V2GQ", "NeedOneB", 14, { isSub: true })],
		cwlStats: {
			season: "debug",
			byTag: {
				"#U8P0": createDebugStats_({
					starsTotal: 6,
					resolvedWarDays: 3,
					attacksMade: 3,
					missedAttacks: 0,
					threeStarCount: 1,
					totalDestruction: 255,
					countedAttacks: 3,
				}),
				"#V2GQ": createDebugStats_({
					starsTotal: 6,
					resolvedWarDays: 3,
					attacksMade: 3,
					missedAttacks: 0,
					threeStarCount: 1,
					totalDestruction: 250,
					countedAttacks: 3,
				}),
			},
		},
	};

	const scenarios = [
		runScenario("scenario_1_strength_sub", scenario1Roster, 2, (ctx) => ctx.suggestions.swapInTags.indexOf("#Q8LG") >= 0 && ctx.suggestions.benchTags.indexOf("#P20Y") >= 0),
		runScenario("scenario_2_reward_critical", scenario2Roster, 1, (ctx) => ctx.suggestions.swapInTags.indexOf("#G0CU") >= 0),
		runScenario("scenario_3_pending_neutral", scenario3Roster, 1, (ctx) => {
			const p = ctx.snapshot.playersByTag["#JQ28"];
			const penalty = p && p.strengthComponents ? Number(p.strengthComponents.reliabilityPenalty) : 1;
			return isFinite(penalty) && penalty <= 0.05;
		}),
		runScenario("scenario_4_exclusion_block", scenario4Roster, 1, (ctx) => ctx.suggestions.benchTags.indexOf("#L0VG") < 0 && ctx.suggestions.blockedByExclusions),
		runScenario("scenario_5_impossible_reward", scenario5Roster, 1, (ctx) => toNonNegativeInt_(ctx.summary && ctx.summary.plannerSummary && ctx.summary.plannerSummary.optimalTotalSlack) === 1),
	];

	return {
		ok: scenarios.every((s) => !!s.pass),
		scenarios: scenarios,
	};
}

function sanitizeNotes_(raw) {
	const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
	return arr.map((n) => String(n == null ? "" : n).trim()).filter((n) => n);
}

function countRosterPayload_(rosterData) {
	const rosters = rosterData && Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	let playerCount = 0;
	let noteCount = 0;
	for (let i = 0; i < rosters.length; i++) {
		const r = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		const players = []
			.concat(Array.isArray(r.main) ? r.main : [])
			.concat(Array.isArray(r.subs) ? r.subs : [])
			.concat(Array.isArray(r.missing) ? r.missing : []);
		playerCount += players.length;
		for (let j = 0; j < players.length; j++) {
			const p = players[j] && typeof players[j] === "object" ? players[j] : {};
			noteCount += sanitizeNotes_(p.notes != null ? p.notes : p.note).length;
		}
	}
	return { playerCount, noteCount };
}

function validateRosterData_(data) {
	if (!data || typeof data !== "object") throw new Error("Invalid roster data: expected an object.");

	const out = {
		schemaVersion: typeof data.schemaVersion === "number" && isFinite(data.schemaVersion) ? data.schemaVersion : 1,
		pageTitle: typeof data.pageTitle === "string" ? data.pageTitle : "",
		rosterOrder: [],
		rosters: [],
		playerMetrics: createEmptyPlayerMetricsStore_(),
	};
	const lastUpdatedAt = typeof data.lastUpdatedAt === "string" ? data.lastUpdatedAt.trim() : "";
	if (lastUpdatedAt) out.lastUpdatedAt = lastUpdatedAt;

	const rosters = Array.isArray(data.rosters) ? data.rosters : null;
	if (!rosters) throw new Error("Invalid roster data: expected 'rosters' to be an array.");

	const seenTags = {};

	for (let i = 0; i < rosters.length; i++) {
		const r = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		const id = typeof r.id === "string" ? r.id : "";
		const title = typeof r.title === "string" ? r.title : "";
		const connectedClanTag = normalizeTag_(r.connectedClanTag);
		const trackingMode = getRosterTrackingMode_(r);

		if (!id) throw new Error("Invalid roster: missing 'id' at index " + i + ".");
		if (!title) throw new Error("Invalid roster: missing 'title' for roster '" + id + "'.");

		const main = Array.isArray(r.main) ? r.main : [];
		const subs = Array.isArray(r.subs) ? r.subs : [];
		const missing = Array.isArray(r.missing) ? r.missing : [];

		const sanitizePlayer = (p, role) => {
			const obj = p && typeof p === "object" ? p : {};
			const rawTag = typeof obj.tag === "string" ? obj.tag : "";
			const tag = normalizeTag_(rawTag);
			const th = obj.th;
			if (!tag) throw new Error("Invalid player in roster '" + id + "': missing 'tag'.");
			if (seenTags[tag]) throw new Error("Duplicate player tag in output: " + tag);
			seenTags[tag] = true;

			if (typeof th !== "number" || !isFinite(th)) throw new Error("Invalid player '" + tag + "': 'th' must be a number.");

			let slot = null;
			if (role === "main" && obj.slot != null) {
				slot = Number(obj.slot);
				if (!isFinite(slot) || slot < 1 || Math.floor(slot) !== slot) slot = null;
			}
			const notes = sanitizeNotes_(obj.notes != null ? obj.notes : obj.note);
			return {
				slot: role === "main" ? slot : null,
				name: typeof obj.name === "string" ? obj.name : "",
				discord: typeof obj.discord === "string" ? obj.discord : "",
				th: Math.floor(th),
				tag: tag,
				notes: notes,
				excludeAsSwapTarget: toBooleanFlag_(obj.excludeAsSwapTarget),
				excludeAsSwapSource: toBooleanFlag_(obj.excludeAsSwapSource),
			};
		};

		const outMain = main.map((p) => sanitizePlayer(p, "main"));
		const outSubs = subs.map((p) => sanitizePlayer(p, "subs"));
		const outMissing = missing.map((p) => sanitizePlayer(p, "missing"));
		const rosterPoolTagSet = {};
		const rosterPool = outMain.concat(outSubs).concat(outMissing);
		for (let j = 0; j < rosterPool.length; j++) {
			const playerTag = normalizeTag_(rosterPool[j] && rosterPool[j].tag);
			if (!playerTag) continue;
			rosterPoolTagSet[playerTag] = true;
		}
		let sanitizedWarPerformance = sanitizeRosterWarPerformance_(r.warPerformance);
		const retentionTagSet = buildHistoryRetentionTagSet_(rosterPoolTagSet, sanitizedWarPerformance, r.regularWar, new Date().toISOString());
		const sanitizedCwlStats = sanitizeRosterCwlStats_(r.cwlStats, retentionTagSet);
		const sanitizedRegularWar = sanitizeRosterRegularWar_(r.regularWar, retentionTagSet);
		sanitizedWarPerformance = backfillWarPerformanceFromLegacyRegularAggregate_(sanitizedWarPerformance, sanitizedRegularWar);
		const sanitizedBenchSuggestions = sanitizeRosterBenchSuggestions_(r.benchSuggestions, rosterPoolTagSet);

		// Recompute badges to match array lengths (this avoids drift)
		const nextRoster = {
			id,
			title,
			connectedClanTag: connectedClanTag,
			trackingMode: trackingMode,
			badges: { main: outMain.length, subs: outSubs.length, missing: outMissing.length },
			main: outMain,
			subs: outSubs,
			missing: outMissing,
		};
		if (sanitizedCwlStats) nextRoster.cwlStats = sanitizedCwlStats;
		if (sanitizedRegularWar) nextRoster.regularWar = sanitizedRegularWar;
		if (sanitizedWarPerformance) nextRoster.warPerformance = sanitizedWarPerformance;
		if (sanitizedBenchSuggestions) nextRoster.benchSuggestions = sanitizedBenchSuggestions;
		out.rosters.push(nextRoster);
	}

	const rosterIndexesById = {};
	for (let i = 0; i < out.rosters.length; i++) {
		const rosterId = String((out.rosters[i] && out.rosters[i].id) || "").trim();
		if (!rosterId) continue;
		if (!rosterIndexesById[rosterId]) rosterIndexesById[rosterId] = [];
		rosterIndexesById[rosterId].push(i);
	}

	const consumedRosterIndexes = {};
	const orderedRosters = [];
	const pushRosterIndex = (index) => {
		if (!isFinite(index) || consumedRosterIndexes[index]) return;
		consumedRosterIndexes[index] = true;
		orderedRosters.push(out.rosters[index]);
	};

	const rawRosterOrder = Array.isArray(data.rosterOrder) ? data.rosterOrder : [];
	for (let i = 0; i < rawRosterOrder.length; i++) {
		const rosterId = String(rawRosterOrder[i] == null ? "" : rawRosterOrder[i]).trim();
		if (!rosterId) continue;
		const queue = rosterIndexesById[rosterId];
		if (!queue || !queue.length) continue;
		const nextIndex = queue.shift();
		pushRosterIndex(nextIndex);
	}

	for (let i = 0; i < out.rosters.length; i++) {
		pushRosterIndex(i);
	}
	out.rosters = orderedRosters;

	const normalizedRosterOrder = [];
	const rosterOrderSeen = {};
	for (let i = 0; i < out.rosters.length; i++) {
		const rosterId = String((out.rosters[i] && out.rosters[i].id) || "").trim();
		if (!rosterId || rosterOrderSeen[rosterId]) continue;
		rosterOrderSeen[rosterId] = true;
		normalizedRosterOrder.push(rosterId);
	}
	out.rosterOrder = normalizedRosterOrder;
	out.playerMetrics = sanitizePlayerMetricsStore_(data.playerMetrics, out.lastUpdatedAt || new Date().toISOString());

	return out;
}
