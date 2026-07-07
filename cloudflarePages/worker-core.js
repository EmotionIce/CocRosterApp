// Cloudflare Worker routing, Apps Script fallback helpers, and roster data plane.

const FALLBACK_APPS_SCRIPT_EXEC_URL =
  "https://script.google.com/macros/s/AKfycbw6ASmNd5Ajn8p8dfN1d0I0GwG5agjMWjDCaa25umExFmV1_fxhvV3kcDLmoKNoC8Lnlw/exec";

const PUBLIC_DATA_ROUTE_PREFIX = "/api/public-data";
const BOT_DATA_ROUTE_PREFIX = "/api/bot-data";
const DATA_PUBLISH_ROUTE = "/api/internal/public-data/publish";
const PUBLIC_DATA_STORE_PREFIX = "public-data";
const BOT_DATA_STORE_PREFIX = "bot-data";
const PUBLIC_BOOTSTRAP_DATA_PATH = "bootstrap/current.json";
const PUBLIC_BOOTSTRAP_DATA_KEY = PUBLIC_DATA_STORE_PREFIX + "/" + PUBLIC_BOOTSTRAP_DATA_PATH;

// Normalize http URL.
const normalizeHttpUrl = (valueRaw) => {
  const value = String(valueRaw == null ? "" : valueRaw).trim();
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) return "";
  return value.replace(/[\/\\]+$/, "");
};

// Ensure Apps Script exec path.
const withAppsScriptExecPath = (baseRaw) => {
  const base = normalizeHttpUrl(baseRaw);
  if (!base) return "";
  if (/\/exec$/i.test(base)) return base;
  return base + "/exec";
};

// Resolve Apps Script exec URL.
const resolveAppsScriptExecUrl = (envRaw) => {
  const env = envRaw && typeof envRaw === "object" ? envRaw : {};
  const configured = normalizeHttpUrl(
    env.ROSTER_APPS_SCRIPT_URL || env.ROSTER_BASE_URL || ""
  );
  return withAppsScriptExecPath(configured || FALLBACK_APPS_SCRIPT_EXEC_URL);
};

// Resolve fallback Apps Script exec URL.
const resolveFallbackAppsScriptExecUrl = () =>
  withAppsScriptExecPath(FALLBACK_APPS_SCRIPT_EXEC_URL);

// Return whether upstream returned a Google HTML miss instead of Apps Script JSON.
const shouldRetryAppsScriptFallback = (response, textRaw, contentTypeRaw) => {
  const status = Number(response && response.status);
  if (![401, 403, 404, 405].includes(status)) return false;
  const contentType = String(contentTypeRaw || "").toLowerCase();
  const text = String(textRaw || "").trim();
  return contentType.includes("text/html") || /^<!doctype\b/i.test(text) || /^<html[\s>]/i.test(text);
};

// Build JSON response.
const jsonResponse = (status, payload, headersRaw) => {
  const headers = new Headers(headersRaw || {});
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(payload), { status, headers });
};

// Return whether admin API path.
const isAdminApiPath = (pathnameRaw) => {
  const pathname = String(pathnameRaw == null ? "" : pathnameRaw).trim();
  return pathname === "/api/admin" || pathname === "/api/admin/";
};

// Return whether Discord bot sync API path.
const isDiscordBotSyncApiPath = (pathnameRaw) => {
  const pathname = String(pathnameRaw == null ? "" : pathnameRaw).trim();
  return pathname === "/api/bot/discord-sync" || pathname === "/api/bot/discord-sync/";
};

// Return whether admin page path.
const isAdminPagePath = (pathnameRaw) => {
  const pathname = String(pathnameRaw == null ? "" : pathnameRaw).trim();
  return (
    pathname === "/admin" ||
    pathname === "/admin/" ||
    pathname === "/console" ||
    pathname === "/console/"
  );
};

// Return whether admin page query.
const isAdminPageQuery = (urlRaw) => {
  const url = urlRaw && typeof urlRaw === "object" ? urlRaw : null;
  if (!url) return false;
  const pathname = String(url.pathname == null ? "" : url.pathname).trim();
  if (pathname !== "/") return false;
  const page = String(url.searchParams && url.searchParams.get("page") || "").trim().toLowerCase();
  return page === "admin";
};

// Return whether public root path.
const isPublicRootPath = (pathnameRaw) => {
  const pathname = String(pathnameRaw == null ? "" : pathnameRaw).trim();
  return pathname === "" || pathname === "/";
};

// Return whether a path is under a route prefix.
const isRoutePrefixPath = (pathnameRaw, prefixRaw) => {
  const pathname = String(pathnameRaw == null ? "" : pathnameRaw).trim();
  const prefix = String(prefixRaw == null ? "" : prefixRaw).trim();
  return pathname === prefix || pathname === prefix + "/" || pathname.startsWith(prefix + "/");
};

// Handle admin API.
const handleAdminApi = async (request, env) => {
  const method = String(request.method || "").toUpperCase();
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "cache-control": "no-store",
      },
    });
  }
  if (method !== "POST") {
    return jsonResponse(405, {
      ok: false,
      error: "Method not allowed. Use POST.",
    });
  }

  const execUrl = resolveAppsScriptExecUrl(env);
  if (!execUrl) {
    return jsonResponse(500, {
      ok: false,
      error: "Apps Script URL is not configured.",
    });
  }

  let bodyText = "";
  try {
    bodyText = await request.text();
  } catch (err) {
    return jsonResponse(400, {
      ok: false,
      error: err && err.message ? err.message : "Invalid request body.",
    });
  }

  try {
    const buildUpstreamRequest = (url) => fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: bodyText || "{}",
    });

    let upstream = await buildUpstreamRequest(execUrl);
    let text = await upstream.text();
    let contentType =
      upstream.headers.get("content-type") || "application/json; charset=utf-8";
    const fallbackExecUrl = resolveFallbackAppsScriptExecUrl();
    if (
      fallbackExecUrl &&
      fallbackExecUrl !== execUrl &&
      shouldRetryAppsScriptFallback(upstream, text, contentType)
    ) {
      upstream = await buildUpstreamRequest(fallbackExecUrl);
      text = await upstream.text();
      contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
    }

    return new Response(text, {
      status: upstream.status,
      headers: {
        "content-type": contentType,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return jsonResponse(502, {
      ok: false,
      error: err && err.message ? err.message : "Upstream request failed.",
    });
  }
};

// Read Discord bot secret from supported headers.
const readDiscordBotSecret = (request) => {
  const authorization = String(request.headers.get("authorization") || "");
  const bearerMatch = /^\s*Bearer\s+(.+?)\s*$/i.exec(authorization);
  if (bearerMatch && bearerMatch[1]) return bearerMatch[1];
  return String(request.headers.get("x-discord-bot-secret") || "").trim();
};

// Read publish/bot data secret from supported headers.
const readRequestSecret = (request) => {
  const authorization = String(request.headers.get("authorization") || "");
  const bearerMatch = /^\s*Bearer\s+(.+?)\s*$/i.exec(authorization);
  if (bearerMatch && bearerMatch[1]) return bearerMatch[1];
  return (
    String(request.headers.get("x-roster-publish-secret") || "").trim() ||
    String(request.headers.get("x-discord-bot-secret") || "").trim()
  );
};

// Hash text for constant-time secret comparison.
const sha256Bytes = async (valueRaw) => {
  const text = String(valueRaw == null ? "" : valueRaw);
  const bytes = new TextEncoder().encode(text);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
};

// Convert bytes to lowercase hex.
const bytesToHex = (bytesRaw) => {
  const bytes = bytesRaw instanceof Uint8Array ? bytesRaw : new Uint8Array(bytesRaw || []);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
};

// Constant-time compare for two non-empty secret strings.
const constantTimeSecretEqual = async (leftRaw, rightRaw) => {
  const left = String(leftRaw == null ? "" : leftRaw);
  const right = String(rightRaw == null ? "" : rightRaw);
  if (!left || !right) return false;
  const [leftHash, rightHash] = await Promise.all([sha256Bytes(left), sha256Bytes(right)]);
  let diff = leftHash.length ^ rightHash.length;
  const length = Math.max(leftHash.length, rightHash.length);
  for (let i = 0; i < length; i++) {
    diff |= (leftHash[i] || 0) ^ (rightHash[i] || 0);
  }
  return diff === 0;
};

// Resolve the configured secret for protected data routes.
const resolveBotDataSecret = (envRaw) => {
  const env = envRaw && typeof envRaw === "object" ? envRaw : {};
  return String(
    env.ROSTER_BOT_SECRET ||
    env.DISCORD_BOT_API_SECRET ||
    env.ROSTER_PUBLIC_DATA_PUBLISH_SECRET ||
    env.CLOUDFLARE_PUBLIC_DATA_PUBLISH_SECRET ||
    ""
  );
};

// Resolve the configured secret for Apps Script publish calls.
const resolvePublishSecret = (envRaw) => {
  const env = envRaw && typeof envRaw === "object" ? envRaw : {};
  return String(
    env.ROSTER_PUBLIC_DATA_PUBLISH_SECRET ||
    env.CLOUDFLARE_PUBLIC_DATA_PUBLISH_SECRET ||
    env.ROSTER_BOT_SECRET ||
    env.DISCORD_BOT_API_SECRET ||
    ""
  );
};

// Verify a protected request.
const verifyRequestSecret = async (request, expectedRaw, labelRaw) => {
  const expected = String(expectedRaw == null ? "" : expectedRaw);
  if (!expected) {
    return {
      ok: false,
      response: jsonResponse(503, {
        ok: false,
        error: String(labelRaw || "Secret") + " is not configured.",
      }),
    };
  }
  const provided = readRequestSecret(request);
  if (!(await constantTimeSecretEqual(provided, expected))) {
    return {
      ok: false,
      response: jsonResponse(401, {
        ok: false,
        error: "Unauthorized.",
      }),
    };
  }
  return { ok: true, response: null };
};

// Normalize Discord bot sync/delete request body into an Apps Script call.
const buildDiscordBotSyncUpstreamCall = (body, secret) => {
  const requestedMethod = String(body && (body.methodName || body.method) || "").trim();
  const args = Array.isArray(body && body.args) ? body.args : [];
  const readObjectOrPositional = () => {
    const first = args[0] && typeof args[0] === "object" && !Array.isArray(args[0]) ? args[0] : null;
    if (first) {
      return {
        playerTag: typeof first.playerTag === "string" ? first.playerTag : typeof first.tag === "string" ? first.tag : "",
        discordId: typeof first.discordId === "string" ? first.discordId : "",
        discordUsername: typeof first.discordUsername === "string" ? first.discordUsername : typeof first.username === "string" ? first.username : "",
        force: first.force === true,
      };
    }
    return {
      playerTag: typeof args[0] === "string" ? args[0] : "",
      discordId: typeof args[1] === "string" ? args[1] : "",
      discordUsername: typeof args[2] === "string" ? args[2] : "",
      force: args[3] === true || args[4] === true,
    };
  };

  if (requestedMethod === "linkDiscordIdentityForPlayerTag") {
    const parsed = readObjectOrPositional();
    if (!parsed.playerTag.trim() || (!parsed.discordId.trim() && !parsed.discordUsername.trim())) {
      return {
        errorStatus: 400,
        error: "playerTag and discordUsername or discordId are required.",
      };
    }
    return {
      method: "linkDiscordIdentityForPlayerTag",
      args: [{
        playerTag: parsed.playerTag,
        discordId: parsed.discordId,
        discordUsername: parsed.discordUsername,
        force: parsed.force === true,
        botSecret: secret,
      }],
    };
  }

  if (requestedMethod === "syncDiscordIdentityForPlayerTag") {
    const parsed = readObjectOrPositional();
    if (!parsed.playerTag.trim() || (!parsed.discordId.trim() && !parsed.discordUsername.trim())) {
      return {
        errorStatus: 400,
        error: "playerTag and discordUsername or discordId are required.",
      };
    }
    return {
      method: "syncDiscordIdentityForPlayerTag",
      args: [{
        playerTag: parsed.playerTag,
        discordId: parsed.discordId,
        discordUsername: parsed.discordUsername,
        botSecret: secret,
      }],
    };
  }

  if (requestedMethod === "deleteDiscordIdentityLink") {
    const parsed = readObjectOrPositional();
    const hasPlayerTag = !!parsed.playerTag.trim();
    const hasDiscordUser = !!(parsed.discordId.trim() || parsed.discordUsername.trim());
    if (hasPlayerTag === hasDiscordUser) {
      return {
        errorStatus: 400,
        error: "Provide exactly one of playerTag or Discord user.",
      };
    }
    return {
      method: "deleteDiscordIdentityLink",
      args: [{
        playerTag: parsed.playerTag,
        discordId: parsed.discordId,
        discordUsername: parsed.discordUsername,
        botSecret: secret,
      }],
    };
  }

  if (requestedMethod === "deleteDiscordIdentityForPlayerTag") {
    const parsed = readObjectOrPositional();
    if (!parsed.playerTag.trim()) {
      return {
        errorStatus: 400,
        error: "playerTag is required.",
      };
    }
    return {
      method: "deleteDiscordIdentityForPlayerTag",
      args: [{
        playerTag: parsed.playerTag,
        botSecret: secret,
      }],
    };
  }

  const playerTag = body && typeof body.playerTag === "string" ? body.playerTag : "";
  const discordId = body && typeof body.discordId === "string" ? body.discordId : "";
  const discordUsername = body && typeof body.discordUsername === "string" ? body.discordUsername : "";
  const action = String(body && (body.action || body.operation || body.linkAction) || "").trim().toLowerCase();
  const isDelete = body && body.deleted === true || ["delete", "deleted", "remove", "removed", "unlink", "unlinked"].includes(action);

  if (isDelete) {
    if (!playerTag.trim()) {
      return {
        errorStatus: 400,
        error: "playerTag is required.",
      };
    }
    return {
      method: "deleteDiscordIdentityForPlayerTag",
      args: [{
        playerTag,
        botSecret: secret,
      }],
    };
  }

  if (!playerTag.trim() || (!discordId.trim() && !discordUsername.trim())) {
    return {
      errorStatus: 400,
      error: "playerTag and discordUsername or discordId are required.",
    };
  }

  return {
    method: "syncDiscordIdentityForPlayerTag",
    args: [{
      playerTag,
      discordId,
      discordUsername,
      botSecret: secret,
    }],
  };
};

// Handle Discord bot identity sync API.
const handleDiscordBotSyncApi = async (request, env) => {
  const method = String(request.method || "").toUpperCase();
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "authorization, content-type, x-discord-bot-secret",
        "cache-control": "no-store",
      },
    });
  }
  if (method !== "POST") {
    return jsonResponse(405, {
      ok: false,
      error: "Method not allowed. Use POST.",
    });
  }

  const secret = readDiscordBotSecret(request);
  if (!secret) {
    return jsonResponse(401, {
      ok: false,
      error: "Missing Discord bot secret.",
    });
  }

  let body = null;
  try {
    body = await request.json();
  } catch (err) {
    return jsonResponse(400, {
      ok: false,
      error: "Invalid JSON payload.",
    });
  }

  const upstreamCall = buildDiscordBotSyncUpstreamCall(body, secret);
  if (upstreamCall.error) {
    return jsonResponse(400, {
      ok: false,
      error: upstreamCall.error,
    });
  }

  const execUrl = resolveAppsScriptExecUrl(env);
  if (!execUrl) {
    return jsonResponse(500, {
      ok: false,
      error: "Apps Script URL is not configured.",
    });
  }

  try {
    const upstreamBody = JSON.stringify({
      method: upstreamCall.method,
      args: upstreamCall.args,
    });
    const buildUpstreamRequest = (url) => fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: upstreamBody,
    });

    let upstream = await buildUpstreamRequest(execUrl);
    let text = await upstream.text();
    let contentType =
      upstream.headers.get("content-type") || "application/json; charset=utf-8";
    const fallbackExecUrl = resolveFallbackAppsScriptExecUrl();
    if (
      fallbackExecUrl &&
      fallbackExecUrl !== execUrl &&
      shouldRetryAppsScriptFallback(upstream, text, contentType)
    ) {
      upstream = await buildUpstreamRequest(fallbackExecUrl);
      text = await upstream.text();
      contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
    }

    return new Response(text, {
      status: upstream.status,
      headers: {
        "content-type": contentType,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return jsonResponse(502, {
      ok: false,
      error: err && err.message ? err.message : "Upstream request failed.",
    });
  }
};

// Resolve the configured data store binding. Production uses KV; R2 remains
// supported for accounts where it is enabled.
const resolveRosterDataStore = (envRaw) => {
  const env = envRaw && typeof envRaw === "object" ? envRaw : {};
  if (env.ROSTER_DATA && typeof env.ROSTER_DATA.get === "function") {
    return { kind: "r2", binding: env.ROSTER_DATA };
  }
  if (env.ROSTER_PUBLIC_DATA && typeof env.ROSTER_PUBLIC_DATA.get === "function") {
    return { kind: "r2", binding: env.ROSTER_PUBLIC_DATA };
  }
  if (env.ROSTER_DATA_KV && typeof env.ROSTER_DATA_KV.get === "function") {
    return { kind: "kv", binding: env.ROSTER_DATA_KV };
  }
  return null;
};

// Read one data object from R2 or KV.
const getDataStoreObject = async (store, key) => {
  if (!store || !store.binding) return null;
  if (store.kind === "r2") {
    return store.binding.get(key);
  }
  if (store.kind === "kv") {
    if (typeof store.binding.getWithMetadata === "function") {
      const result = await store.binding.getWithMetadata(key, "text");
      if (!result || result.value == null) return null;
      const metadata = result.metadata && typeof result.metadata === "object" ? result.metadata : {};
      return {
        body: result.value,
        text: async () => result.value,
        httpEtag: String(metadata.etag || ""),
        etag: String(metadata.etag || ""),
        httpMetadata: {
          contentType: String(metadata.contentType || "application/json; charset=utf-8"),
          cacheControl: String(metadata.cacheControl || ""),
        },
      };
    }
    const value = await store.binding.get(key, "text");
    if (value == null) return null;
    return {
      body: value,
      text: async () => value,
      httpEtag: "",
      etag: "",
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
        cacheControl: "",
      },
    };
  }
  return null;
};

// Put one data object into R2 or KV.
const putDataStoreObject = async (store, key, valueText, metadataRaw) => {
  if (!store || !store.binding) throw new Error("Roster data store is not configured.");
  const metadata = metadataRaw && typeof metadataRaw === "object" ? metadataRaw : {};
  if (store.kind === "r2") {
    return store.binding.put(key, valueText, {
      httpMetadata: {
        contentType: metadata.contentType || "application/json; charset=utf-8",
        cacheControl: metadata.cacheControl || "",
      },
      customMetadata: metadata.customMetadata || {},
    });
  }
  if (store.kind === "kv") {
    const etag = "\"" + bytesToHex(await sha256Bytes(valueText)) + "\"";
    return store.binding.put(key, valueText, {
      metadata: {
        etag,
        contentType: metadata.contentType || "application/json; charset=utf-8",
        cacheControl: metadata.cacheControl || "",
        publishedAt: metadata.customMetadata && metadata.customMetadata.publishedAt || "",
        scope: metadata.customMetadata && metadata.customMetadata.scope || "",
        schema: metadata.customMetadata && metadata.customMetadata.schema || "roster-public-data-v1",
      },
    });
  }
  throw new Error("Unsupported roster data store.");
};

// Delete one data object from R2 or KV.
const deleteDataStoreObject = async (store, key) => {
  if (!store || !store.binding || typeof store.binding.delete !== "function") {
    throw new Error("Roster data store is not configured.");
  }
  return store.binding.delete(key);
};

// Decode a slash path safely.
const decodePathSegments = (pathRaw) => {
  const path = String(pathRaw == null ? "" : pathRaw);
  if (!path) return "";
  const parts = path.split("/");
  const decoded = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    decoded.push(decodeURIComponent(part));
  }
  return decoded.join("/");
};

// Normalize a logical data object path.
const normalizeDataObjectPath = (pathRaw) => {
  let path = String(pathRaw == null ? "" : pathRaw)
    .trim()
    .replace(/\\/g, "/")
    .replace(/^[\/]+|[\/]+$/g, "");
  if (!path) throw new Error("Data object path is required.");
  path = path.replace(/\.json$/i, "");
  const parts = path.split("/").filter((part) => part);
  if (!parts.length) throw new Error("Data object path is required.");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === "." || part === ".." || part.includes("..")) {
      throw new Error("Invalid data object path.");
    }
    if (/[\u0000-\u001F\u007F]/.test(part)) {
      throw new Error("Invalid data object path.");
    }
  }
  return parts.join("/") + ".json";
};

// Normalize scope.
const normalizeDataScope = (scopeRaw) => {
  const scope = String(scopeRaw == null ? "" : scopeRaw).trim().toLowerCase();
  if (scope === "bot" || scope === "bot-data") return "bot";
  if (scope === "public" || scope === "public-data" || !scope) return "public";
  throw new Error("Invalid data scope.");
};

// Build a data-store key for one data object.
const buildDataObjectKey = (scopeRaw, pathRaw) => {
  const scope = normalizeDataScope(scopeRaw);
  const path = normalizeDataObjectPath(pathRaw);
  return (scope === "bot" ? BOT_DATA_STORE_PREFIX : PUBLIC_DATA_STORE_PREFIX) + "/" + path;
};

// Read route-relative data path.
const readDataRoutePath = (pathnameRaw, prefixRaw) => {
  const pathname = String(pathnameRaw == null ? "" : pathnameRaw);
  const prefix = String(prefixRaw == null ? "" : prefixRaw);
  let relative = pathname.slice(prefix.length).replace(/^\/+/, "");
  relative = decodePathSegments(relative);
  return relative;
};

// Return cache policy by scope and logical path.
const getDataObjectCacheControl = (scopeRaw, logicalPathRaw) => {
  const scope = normalizeDataScope(scopeRaw);
  const path = String(logicalPathRaw == null ? "" : logicalPathRaw).replace(/\.json$/i, "");
  if (scope === "bot") return "private, max-age=30";
  if (path.startsWith("activeVersions/")) return "public, max-age=31536000, immutable";
  if (
    path === "active" ||
    path.startsWith("activePublished/") ||
    path.startsWith("events/seasonEvents/") ||
    path.startsWith("donationRefresh/")
  ) {
    return "no-store";
  }
  return "public, max-age=30, stale-while-revalidate=120";
};

// Return a nested object value only when it exists as a direct own property.
const readOwnObjectValue = (sourceRaw, keyRaw) => {
  const source = sourceRaw && typeof sourceRaw === "object" && !Array.isArray(sourceRaw) ? sourceRaw : {};
  const key = String(keyRaw == null ? "" : keyRaw);
  return key && Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
};

// Read and parse the public bootstrap bundle.
const readPublicBootstrapPayload = async (store) => {
  const object = await getDataStoreObject(store, PUBLIC_BOOTSTRAP_DATA_KEY);
  if (!object) return null;
  try {
    const payload = JSON.parse(await object.text());
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  } catch (err) {
    return null;
  }
};

// Read a legacy public JSON object by logical path.
const readLegacyPublicJsonObject = async (store, pathRaw) => {
  let key = "";
  try {
    key = buildDataObjectKey("public", pathRaw);
  } catch (err) {
    return undefined;
  }
  const object = await getDataStoreObject(store, key);
  if (!object) return undefined;
  try {
    return JSON.parse(await object.text());
  } catch (err) {
    return undefined;
  }
};

const collectEventIdsFromPointerMap = (pointersRaw, seenRaw) => {
  const pointers = pointersRaw && typeof pointersRaw === "object" && !Array.isArray(pointersRaw) ? pointersRaw : {};
  const seen = seenRaw && typeof seenRaw === "object" ? seenRaw : {};
  const keys = Object.keys(pointers);
  for (let i = 0; i < keys.length; i++) {
    const pointer = pointers[keys[i]] && typeof pointers[keys[i]] === "object" ? pointers[keys[i]] : null;
    const eventId = pointer ? String(pointer.eventId || "").trim() : "";
    if (eventId) seen[eventId] = true;
  }
  return seen;
};

const collectDonationSeasonIdsFromBundle = (seasonEventsRaw, seenRaw) => {
  const seasonEvents = seasonEventsRaw && typeof seasonEventsRaw === "object" ? seasonEventsRaw : {};
  const seen = seenRaw && typeof seenRaw === "object" ? seenRaw : {};
  const ids = [];
  const collect = (valueRaw) => {
    const value = String(valueRaw == null ? "" : valueRaw).trim();
    if (!value || seen[value]) return;
    seen[value] = true;
    ids.push(value);
  };
  const current = seasonEvents.current && typeof seasonEvents.current === "object" ? seasonEvents.current : {};
  const donation = current.donation && typeof current.donation === "object" ? current.donation : {};
  collect(donation.seasonId);
  const seasonState = seasonEvents.seasonState && typeof seasonEvents.seasonState === "object" ? seasonEvents.seasonState : {};
  collect(seasonState.seasonId);
  const byId = seasonEvents.byId && typeof seasonEvents.byId === "object" ? seasonEvents.byId : {};
  const eventIds = Object.keys(byId);
  for (let i = 0; i < eventIds.length; i++) {
    const event = byId[eventIds[i]] && typeof byId[eventIds[i]] === "object" ? byId[eventIds[i]] : {};
    if (String(event.type || "").trim().toLowerCase() === "donation") collect(event.seasonId);
  }
  return ids;
};

// Compose bootstrap from legacy public objects during rollout if the real object is absent.
const synthesizePublicBootstrapFromLegacyObjects = async (store) => {
  const [currentVersionIdRaw, manifestRaw, currentRaw, currentCwlRaw, latestCompletedCwlRaw, seasonStateRaw] = await Promise.all([
    readLegacyPublicJsonObject(store, "activePublished/currentVersionId"),
    readLegacyPublicJsonObject(store, "activePublished/currentManifest"),
    readLegacyPublicJsonObject(store, "events/seasonEvents/current"),
    readLegacyPublicJsonObject(store, "events/seasonEvents/currentCwl"),
    readLegacyPublicJsonObject(store, "events/seasonEvents/latestCompletedCwl"),
    readLegacyPublicJsonObject(store, "events/seasonEvents/seasonState/current"),
  ]);
  const activeVersionId = String(currentVersionIdRaw || "").trim();
  if (!activeVersionId) return null;
  const current = currentRaw && typeof currentRaw === "object" && !Array.isArray(currentRaw) ? currentRaw : {};
  if (currentCwlRaw && typeof currentCwlRaw === "object" && !Array.isArray(currentCwlRaw)) current.cwl = currentCwlRaw;
  const eventPointerMap = Object.assign({}, current);
  if (latestCompletedCwlRaw && typeof latestCompletedCwlRaw === "object" && !Array.isArray(latestCompletedCwlRaw)) {
    eventPointerMap.latestCompletedCwl = latestCompletedCwlRaw;
  }
  const eventIdsByKey = collectEventIdsFromPointerMap(eventPointerMap, {});
  const eventIds = Object.keys(eventIdsByKey);
  const byId = {};
  const cwlAggregatesByEventId = {};
  await Promise.all(eventIds.map(async (eventId) => {
    const event = await readLegacyPublicJsonObject(store, "events/seasonEvents/byId/" + eventId);
    if (event && typeof event === "object" && !Array.isArray(event)) {
      byId[eventId] = event;
      if (String(event.type || "").trim().toLowerCase() === "cwl") {
        const [live, finalAggregate] = await Promise.all([
          readLegacyPublicJsonObject(store, "events/seasonEvents/cwlAggregates/byEvent/" + eventId + "/live"),
          readLegacyPublicJsonObject(store, "events/seasonEvents/cwlAggregates/byEvent/" + eventId + "/final"),
        ]);
        const byKind = {};
        if (live && typeof live === "object" && !Array.isArray(live)) byKind.live = live;
        if (finalAggregate && typeof finalAggregate === "object" && !Array.isArray(finalAggregate)) byKind.final = finalAggregate;
        if (Object.keys(byKind).length) cwlAggregatesByEventId[eventId] = byKind;
      }
    }
  }));
  const seasonEvents = {
    current,
    seasonState: seasonStateRaw && typeof seasonStateRaw === "object" && !Array.isArray(seasonStateRaw) ? seasonStateRaw : {},
    byId,
    cwlAggregatesByEventId,
    latestCompletedCwl: latestCompletedCwlRaw && typeof latestCompletedCwlRaw === "object" && !Array.isArray(latestCompletedCwlRaw)
      ? latestCompletedCwlRaw
      : null,
    loadErrors: [],
    loadedAt: new Date().toISOString(),
  };
  const donationSeasonIds = collectDonationSeasonIdsFromBundle(seasonEvents, {});
  const donationBySeasonPairs = await Promise.all(donationSeasonIds.map(async (seasonId) => [
    seasonId,
    await readLegacyPublicJsonObject(store, "donationRefresh/bySeason/" + seasonId),
  ]));
  const donationBySeason = {};
  for (let i = 0; i < donationBySeasonPairs.length; i++) {
    const seasonId = donationBySeasonPairs[i][0];
    const overlay = donationBySeasonPairs[i][1];
    if (overlay && typeof overlay === "object" && !Array.isArray(overlay)) donationBySeason[seasonId] = overlay;
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    activeVersionId,
    active: {
      versionId: activeVersionId,
      manifest: manifestRaw && typeof manifestRaw === "object" && !Array.isArray(manifestRaw) ? manifestRaw : null,
    },
    seasonEvents,
    donationRefresh: {
      current: await readLegacyPublicJsonObject(store, "donationRefresh/current"),
      bySeason: donationBySeason,
    },
  };
};

// Project one legacy public-data object from the bootstrap bundle.
const projectPublicBootstrapDataPath = (bootstrapRaw, objectPathRaw) => {
  const bootstrap = bootstrapRaw && typeof bootstrapRaw === "object" && !Array.isArray(bootstrapRaw) ? bootstrapRaw : null;
  if (!bootstrap) return undefined;
  const path = String(objectPathRaw == null ? "" : objectPathRaw).replace(/\.json$/i, "");
  const active = bootstrap.active && typeof bootstrap.active === "object" ? bootstrap.active : {};
  const seasonEvents = bootstrap.seasonEvents && typeof bootstrap.seasonEvents === "object" ? bootstrap.seasonEvents : {};
  const donationRefresh = bootstrap.donationRefresh && typeof bootstrap.donationRefresh === "object" ? bootstrap.donationRefresh : {};

  if (path === "activePublished/currentVersionId") return bootstrap.activeVersionId || active.versionId || undefined;
  if (path === "activePublished/currentManifest") return active.manifest || undefined;

  if (path === "events/seasonEvents/current") return seasonEvents.current || undefined;
  if (path === "events/seasonEvents/currentCwl") {
    const current = seasonEvents.current && typeof seasonEvents.current === "object" ? seasonEvents.current : {};
    return current.cwl || undefined;
  }
  if (path === "events/seasonEvents/latestCompletedCwl") return seasonEvents.latestCompletedCwl || undefined;
  if (path === "events/seasonEvents/seasonState/current") return seasonEvents.seasonState || undefined;

  const byIdPrefix = "events/seasonEvents/byId/";
  if (path.startsWith(byIdPrefix)) {
    const eventId = path.slice(byIdPrefix.length);
    return readOwnObjectValue(seasonEvents.byId, eventId);
  }

  const aggregatePrefix = "events/seasonEvents/cwlAggregates/byEvent/";
  if (path.startsWith(aggregatePrefix)) {
    const parts = path.slice(aggregatePrefix.length).split("/");
    const eventId = parts[0] || "";
    const kind = parts[1] || "";
    const byEvent = readOwnObjectValue(seasonEvents.cwlAggregatesByEventId, eventId);
    return byEvent && typeof byEvent === "object" ? readOwnObjectValue(byEvent, kind) : undefined;
  }

  const bySeasonPrefix = "events/seasonEvents/bySeason/";
  if (path.startsWith(bySeasonPrefix)) {
    const seasonId = path.slice(bySeasonPrefix.length);
    const currentSeasonState = seasonEvents.seasonState && typeof seasonEvents.seasonState === "object" ? seasonEvents.seasonState : {};
    if (seasonId && currentSeasonState.seasonId === seasonId) return seasonEvents.current || undefined;
    const previous = seasonEvents.previous && typeof seasonEvents.previous === "object" ? seasonEvents.previous : {};
    const previousSeasonState = previous.seasonState && typeof previous.seasonState === "object" ? previous.seasonState : {};
    if (seasonId && previousSeasonState.seasonId === seasonId) return previous.current || undefined;
  }

  if (path === "donationRefresh/current") return donationRefresh.current || undefined;
  const donationSeasonPrefix = "donationRefresh/bySeason/";
  if (path.startsWith(donationSeasonPrefix)) {
    const seasonId = path.slice(donationSeasonPrefix.length);
    return readOwnObjectValue(donationRefresh.bySeason, seasonId);
  }

  return undefined;
};

// Return whether a mutable public-data path should be served from bootstrap first.
const shouldPreferPublicBootstrapPath = (objectPathRaw) => {
  const path = String(objectPathRaw == null ? "" : objectPathRaw).replace(/\.json$/i, "");
  return (
    path.startsWith("activePublished/") ||
    path.startsWith("events/seasonEvents/") ||
    path.startsWith("donationRefresh/")
  );
};

// Build a data-store-like object from a bootstrap projection.
const buildProjectedDataStoreObject = async (valueRaw) => {
  if (valueRaw === undefined) return null;
  const body = JSON.stringify(valueRaw == null ? null : valueRaw);
  const etag = "\"" + bytesToHex(await sha256Bytes(body)) + "\"";
  return {
    body,
    text: async () => body,
    httpEtag: etag,
    etag,
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      cacheControl: "",
    },
  };
};

// Read a public object from bootstrap first, falling back to its legacy key.
const getPublicDataObjectWithBootstrapFallback = async (store, key, objectPath) => {
  if (String(objectPath || "") === PUBLIC_BOOTSTRAP_DATA_PATH) {
    const direct = await getDataStoreObject(store, key);
    if (direct) return direct;
    return buildProjectedDataStoreObject(await synthesizePublicBootstrapFromLegacyObjects(store));
  }
  if (shouldPreferPublicBootstrapPath(objectPath)) {
    const bootstrap = await readPublicBootstrapPayload(store);
    const projected = await buildProjectedDataStoreObject(projectPublicBootstrapDataPath(bootstrap, objectPath));
    if (projected) return projected;
  }
  return getDataStoreObject(store, key);
};

// Return CORS headers for public data routes.
const publicDataCorsHeaders = () => ({
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "if-none-match, content-type",
  "access-control-max-age": "86400",
});

// Return CORS headers for publish route.
const publishCorsHeaders = () => ({
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, x-discord-bot-secret, x-roster-publish-secret",
  "cache-control": "no-store",
});

// Return whether an If-None-Match header matches an object ETag.
const requestEtagMatches = (request, etagRaw) => {
  const etag = String(etagRaw == null ? "" : etagRaw).trim();
  if (!etag) return false;
  const header = String(request.headers.get("if-none-match") || "").trim();
  if (!header) return false;
  if (header === "*") return true;
  return header.split(",").map((part) => part.trim()).includes(etag);
};

// Handle public/bot data health.
const handleDataHealth = async (request, env, scopeRaw) => {
  const method = String(request.method || "").toUpperCase();
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: scopeRaw === "public" ? publicDataCorsHeaders() : { "cache-control": "no-store" },
    });
  }
  if (method !== "GET" && method !== "HEAD") {
    return jsonResponse(405, { ok: false, error: "Method not allowed. Use GET." });
  }

  if (normalizeDataScope(scopeRaw) === "bot") {
    const auth = await verifyRequestSecret(request, resolveBotDataSecret(env), "Bot data secret");
    if (!auth.ok) return auth.response;
  }

  const store = resolveRosterDataStore(env);
  if (!store) {
    return jsonResponse(503, { ok: false, error: "Roster data store is not configured." });
  }

  const pointerKey = buildDataObjectKey("public", "activePublished/currentVersionId");
  const pointer = await getDataStoreObject(store, pointerKey);
  let currentVersionId = "";
  if (pointer) {
    try {
      currentVersionId = String(JSON.parse(await pointer.text()) || "").trim();
    } catch (err) {
      currentVersionId = "";
    }
  }
  const response = jsonResponse(200, {
    ok: true,
    scope: normalizeDataScope(scopeRaw),
    storeConfigured: true,
    storeKind: store.kind,
    currentVersionId,
    hasCurrentVersion: !!currentVersionId,
  }, scopeRaw === "public" ? publicDataCorsHeaders() : {});
  if (method === "HEAD") return new Response(null, { status: response.status, headers: response.headers });
  return response;
};

// Handle data object read.
const handleDataRead = async (request, env, url, scopeRaw) => {
  const scope = normalizeDataScope(scopeRaw);
  const method = String(request.method || "").toUpperCase();
  const cors = scope === "public" ? publicDataCorsHeaders() : {};
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (method !== "GET" && method !== "HEAD") {
    return jsonResponse(405, { ok: false, error: "Method not allowed. Use GET." }, cors);
  }

  if (scope === "bot") {
    const auth = await verifyRequestSecret(request, resolveBotDataSecret(env), "Bot data secret");
    if (!auth.ok) return auth.response;
  }

  const relativePath = readDataRoutePath(
    url.pathname,
    scope === "bot" ? BOT_DATA_ROUTE_PREFIX : PUBLIC_DATA_ROUTE_PREFIX
  );
  if (!relativePath || relativePath === "health") {
    return handleDataHealth(request, env, scope);
  }

  let objectPath = "";
  let key = "";
  try {
    objectPath = normalizeDataObjectPath(relativePath);
    key = buildDataObjectKey(scope, objectPath);
  } catch (err) {
    return jsonResponse(400, { ok: false, error: err && err.message ? err.message : "Invalid data path." }, cors);
  }

  const store = resolveRosterDataStore(env);
  if (!store) {
    return jsonResponse(503, { ok: false, error: "Roster data store is not configured." }, cors);
  }

  const object = scope === "public"
    ? await getPublicDataObjectWithBootstrapFallback(store, key, objectPath)
    : await getDataStoreObject(store, key);
  if (!object) {
    return jsonResponse(404, {
      ok: false,
      error: "Data object not found.",
      path: objectPath.replace(/\.json$/i, ""),
    }, Object.assign({}, cors, { "cache-control": "no-store" }));
  }

  const etag = object.httpEtag || object.etag || "";
  const headers = new Headers(cors);
  headers.set("content-type", object.httpMetadata && object.httpMetadata.contentType || "application/json; charset=utf-8");
  headers.set("cache-control", getDataObjectCacheControl(scope, objectPath));
  if (etag) headers.set("etag", etag);
  if (requestEtagMatches(request, etag)) {
    return new Response(null, { status: 304, headers });
  }
  if (method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  return new Response(object.body, { status: 200, headers });
};

// Parse publish request body.
const readPublishBody = async (request) => {
  let body = null;
  try {
    body = await request.json();
  } catch (err) {
    throw new Error("Invalid JSON payload.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Publish payload must be an object.");
  }
  return body;
};

// Read an object payload from a publish entry.
const readPublishEntryPayload = (entry) => {
  if (Object.prototype.hasOwnProperty.call(entry, "payload")) return entry.payload;
  if (Object.prototype.hasOwnProperty.call(entry, "value")) return entry.value;
  if (Object.prototype.hasOwnProperty.call(entry, "json")) return entry.json;
  throw new Error("Publish object payload is required.");
};

// Prepare one publish object.
const normalizePublishObject = (entryRaw, defaultScopeRaw, publishedAt) => {
  const entry = entryRaw && typeof entryRaw === "object" && !Array.isArray(entryRaw) ? entryRaw : null;
  if (!entry) throw new Error("Each publish object must be an object.");
  const scope = normalizeDataScope(entry.scope || defaultScopeRaw);
  const path = normalizeDataObjectPath(entry.path || entry.key || entry.name);
  const payload = readPublishEntryPayload(entry);
  return {
    scope,
    path,
    key: buildDataObjectKey(scope, path),
    payloadText: JSON.stringify(payload),
    cacheControl: String(entry.cacheControl || getDataObjectCacheControl(scope, path)).trim(),
    contentType: String(entry.contentType || "application/json; charset=utf-8").trim(),
    publishedAt,
  };
};

// Prepare one delete object.
const normalizeDeleteObject = (entryRaw, defaultScopeRaw) => {
  const entry = entryRaw && typeof entryRaw === "object" && !Array.isArray(entryRaw)
    ? entryRaw
    : { path: entryRaw };
  const scope = normalizeDataScope(entry.scope || defaultScopeRaw);
  const path = normalizeDataObjectPath(entry.path || entry.key || entry.name);
  return {
    scope,
    path,
    key: buildDataObjectKey(scope, path),
  };
};

// Handle internal Apps Script -> data-store publish.
const handleDataPublish = async (request, env) => {
  const method = String(request.method || "").toUpperCase();
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: publishCorsHeaders() });
  }
  if (method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed. Use POST." }, publishCorsHeaders());
  }

  const auth = await verifyRequestSecret(request, resolvePublishSecret(env), "Roster data publish secret");
  if (!auth.ok) return auth.response;

  const store = resolveRosterDataStore(env);
  if (!store) {
    return jsonResponse(503, { ok: false, error: "Roster data store is not configured." });
  }

  let body = null;
  try {
    body = await readPublishBody(request);
  } catch (err) {
    return jsonResponse(400, { ok: false, error: err && err.message ? err.message : "Invalid publish payload." });
  }

  const defaultScope = normalizeDataScope(body.scope || "public");
  const publishedAt = String(body.publishedAt || new Date().toISOString());
  const objectsRaw = Array.isArray(body.objects) ? body.objects : [];
  const deletesRaw = Array.isArray(body.deletePaths) ? body.deletePaths : Array.isArray(body.deletes) ? body.deletes : [];
  if (!objectsRaw.length && !deletesRaw.length) {
    return jsonResponse(400, { ok: false, error: "At least one object or delete path is required." });
  }
  if (objectsRaw.length > 500 || deletesRaw.length > 500) {
    return jsonResponse(413, { ok: false, error: "Publish batch is too large." });
  }

  let objects = [];
  let deletes = [];
  try {
    objects = objectsRaw.map((entry) => normalizePublishObject(entry, defaultScope, publishedAt));
    deletes = deletesRaw.map((entry) => normalizeDeleteObject(entry, defaultScope));
  } catch (err) {
    return jsonResponse(400, { ok: false, error: err && err.message ? err.message : "Invalid publish object." });
  }

  try {
    for (let i = 0; i < objects.length; i++) {
      const item = objects[i];
      await putDataStoreObject(store, item.key, item.payloadText, {
        contentType: item.contentType,
        cacheControl: item.cacheControl,
        customMetadata: {
          publishedAt: item.publishedAt,
          scope: item.scope,
          schema: "roster-public-data-v1",
        },
      });
    }
    for (let i = 0; i < deletes.length; i++) {
      await deleteDataStoreObject(store, deletes[i].key);
    }
    return jsonResponse(200, {
      ok: true,
      publishedAt,
      putCount: objects.length,
      deleteCount: deletes.length,
      scopes: Array.from(new Set(objects.concat(deletes).map((item) => item.scope))).sort(),
    });
  } catch (err) {
    return jsonResponse(502, {
      ok: false,
      error: err && err.message ? err.message : "Roster data publish failed.",
    });
  }
};

// Create an asset request.
const createAssetRequest = (request, pathnameRaw) => {
  const pathname = String(pathnameRaw == null ? "" : pathnameRaw).trim();
  if (!pathname) return request;
  const rewrittenUrl = new URL(request.url);
  rewrittenUrl.pathname = pathname;
  return new Request(rewrittenUrl.toString(), request);
};

// Handle serve static asset.
const serveStaticAsset = (request, env) => {
  if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== "function") {
    return new Response("ASSETS binding is missing.", { status: 500 });
  }
  return env.ASSETS.fetch(request);
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === DATA_PUBLISH_ROUTE || url.pathname === DATA_PUBLISH_ROUTE + "/") {
      return handleDataPublish(request, env);
    }
    if (isRoutePrefixPath(url.pathname, PUBLIC_DATA_ROUTE_PREFIX)) {
      return handleDataRead(request, env, url, "public");
    }
    if (isRoutePrefixPath(url.pathname, BOT_DATA_ROUTE_PREFIX)) {
      return handleDataRead(request, env, url, "bot");
    }
    if (isAdminApiPath(url.pathname)) {
      return handleAdminApi(request, env);
    }
    if (isDiscordBotSyncApiPath(url.pathname)) {
      return handleDiscordBotSyncApi(request, env);
    }
    if (isAdminPageQuery(url)) {
      return serveStaticAsset(createAssetRequest(request, "/console.html"), env, ctx);
    }
    if (isAdminPagePath(url.pathname)) {
      return serveStaticAsset(createAssetRequest(request, "/console.html"), env, ctx);
    }
    if (isPublicRootPath(url.pathname)) {
      return serveStaticAsset(createAssetRequest(request, "/index.html"), env, ctx);
    }
    return serveStaticAsset(request, env, ctx);
  },
};
