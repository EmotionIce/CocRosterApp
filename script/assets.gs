// Asset/media serving and cache helpers.

function getStaticAssetVersion_() {
	if (staticAssetVersionCache_ !== null) return staticAssetVersionCache_;
	let configuredVersion = "";
	try {
		configuredVersion = String(PropertiesService.getScriptProperties().getProperty(STATIC_ASSET_VERSION_PROPERTY) || "").trim();
	} catch (err) {
		Logger.log(
			"Unable to read Script Property %s for static asset version: %s",
			STATIC_ASSET_VERSION_PROPERTY,
			err && (err.message || err.stack) ? err.message || err.stack : String(err),
		);
	}
	const version = configuredVersion || STATIC_ASSET_VERSION_FALLBACK;
	staticAssetVersionCache_ = version;
	return version;
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
