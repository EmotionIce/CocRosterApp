var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// cloudflarePages/worker-core.js
var FALLBACK_APPS_SCRIPT_EXEC_URL = "https://script.google.com/macros/s/AKfycbw6ASmNd5Ajn8p8dfN1d0I0GwG5agjMWjDCaa25umExFmV1_fxhvV3kcDLmoKNoC8Lnlw/exec";
var PUBLIC_DATA_ROUTE_PREFIX = "/api/public-data";
var BOT_DATA_ROUTE_PREFIX = "/api/bot-data";
var DATA_PUBLISH_ROUTE = "/api/internal/public-data/publish";
var PUBLIC_DATA_STORE_PREFIX = "public-data";
var BOT_DATA_STORE_PREFIX = "bot-data";
var normalizeHttpUrl = /* @__PURE__ */ __name((valueRaw) => {
  const value = String(valueRaw == null ? "" : valueRaw).trim();
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) return "";
  return value.replace(/[\/\\]+$/, "");
}, "normalizeHttpUrl");
var withAppsScriptExecPath = /* @__PURE__ */ __name((baseRaw) => {
  const base = normalizeHttpUrl(baseRaw);
  if (!base) return "";
  if (/\/exec$/i.test(base)) return base;
  return base + "/exec";
}, "withAppsScriptExecPath");
var resolveAppsScriptExecUrl = /* @__PURE__ */ __name((envRaw) => {
  const env = envRaw && typeof envRaw === "object" ? envRaw : {};
  const configured = normalizeHttpUrl(
    env.ROSTER_APPS_SCRIPT_URL || env.ROSTER_BASE_URL || ""
  );
  return withAppsScriptExecPath(configured || FALLBACK_APPS_SCRIPT_EXEC_URL);
}, "resolveAppsScriptExecUrl");
var resolveFallbackAppsScriptExecUrl = /* @__PURE__ */ __name(() => withAppsScriptExecPath(FALLBACK_APPS_SCRIPT_EXEC_URL), "resolveFallbackAppsScriptExecUrl");
var shouldRetryAppsScriptFallback = /* @__PURE__ */ __name((response, textRaw, contentTypeRaw) => {
  const status = Number(response && response.status);
  if (![401, 403, 404, 405].includes(status)) return false;
  const contentType = String(contentTypeRaw || "").toLowerCase();
  const text = String(textRaw || "").trim();
  return contentType.includes("text/html") || /^<!doctype\b/i.test(text) || /^<html[\s>]/i.test(text);
}, "shouldRetryAppsScriptFallback");
var jsonResponse = /* @__PURE__ */ __name((status, payload, headersRaw) => {
  const headers = new Headers(headersRaw || {});
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(payload), { status, headers });
}, "jsonResponse");
var isAdminApiPath = /* @__PURE__ */ __name((pathnameRaw) => {
  const pathname = String(pathnameRaw == null ? "" : pathnameRaw).trim();
  return pathname === "/api/admin" || pathname === "/api/admin/";
}, "isAdminApiPath");
var isDiscordBotSyncApiPath = /* @__PURE__ */ __name((pathnameRaw) => {
  const pathname = String(pathnameRaw == null ? "" : pathnameRaw).trim();
  return pathname === "/api/bot/discord-sync" || pathname === "/api/bot/discord-sync/";
}, "isDiscordBotSyncApiPath");
var isAdminPagePath = /* @__PURE__ */ __name((pathnameRaw) => {
  const pathname = String(pathnameRaw == null ? "" : pathnameRaw).trim();
  return pathname === "/admin" || pathname === "/admin/" || pathname === "/console" || pathname === "/console/";
}, "isAdminPagePath");
var isAdminPageQuery = /* @__PURE__ */ __name((urlRaw) => {
  const url = urlRaw && typeof urlRaw === "object" ? urlRaw : null;
  if (!url) return false;
  const pathname = String(url.pathname == null ? "" : url.pathname).trim();
  if (pathname !== "/") return false;
  const page = String(url.searchParams && url.searchParams.get("page") || "").trim().toLowerCase();
  return page === "admin";
}, "isAdminPageQuery");
var isPublicRootPath = /* @__PURE__ */ __name((pathnameRaw) => {
  const pathname = String(pathnameRaw == null ? "" : pathnameRaw).trim();
  return pathname === "" || pathname === "/";
}, "isPublicRootPath");
var isRoutePrefixPath = /* @__PURE__ */ __name((pathnameRaw, prefixRaw) => {
  const pathname = String(pathnameRaw == null ? "" : pathnameRaw).trim();
  const prefix = String(prefixRaw == null ? "" : prefixRaw).trim();
  return pathname === prefix || pathname === prefix + "/" || pathname.startsWith(prefix + "/");
}, "isRoutePrefixPath");
var handleAdminApi = /* @__PURE__ */ __name(async (request, env) => {
  const method = String(request.method || "").toUpperCase();
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "cache-control": "no-store"
      }
    });
  }
  if (method !== "POST") {
    return jsonResponse(405, {
      ok: false,
      error: "Method not allowed. Use POST."
    });
  }
  const execUrl = resolveAppsScriptExecUrl(env);
  if (!execUrl) {
    return jsonResponse(500, {
      ok: false,
      error: "Apps Script URL is not configured."
    });
  }
  let bodyText = "";
  try {
    bodyText = await request.text();
  } catch (err) {
    return jsonResponse(400, {
      ok: false,
      error: err && err.message ? err.message : "Invalid request body."
    });
  }
  try {
    const buildUpstreamRequest = /* @__PURE__ */ __name((url) => fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: bodyText || "{}"
    }), "buildUpstreamRequest");
    let upstream = await buildUpstreamRequest(execUrl);
    let text = await upstream.text();
    let contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
    const fallbackExecUrl = resolveFallbackAppsScriptExecUrl();
    if (fallbackExecUrl && fallbackExecUrl !== execUrl && shouldRetryAppsScriptFallback(upstream, text, contentType)) {
      upstream = await buildUpstreamRequest(fallbackExecUrl);
      text = await upstream.text();
      contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
    }
    return new Response(text, {
      status: upstream.status,
      headers: {
        "content-type": contentType,
        "cache-control": "no-store"
      }
    });
  } catch (err) {
    return jsonResponse(502, {
      ok: false,
      error: err && err.message ? err.message : "Upstream request failed."
    });
  }
}, "handleAdminApi");
var readDiscordBotSecret = /* @__PURE__ */ __name((request) => {
  const authorization = String(request.headers.get("authorization") || "");
  const bearerMatch = /^\s*Bearer\s+(.+?)\s*$/i.exec(authorization);
  if (bearerMatch && bearerMatch[1]) return bearerMatch[1];
  return String(request.headers.get("x-discord-bot-secret") || "").trim();
}, "readDiscordBotSecret");
var readRequestSecret = /* @__PURE__ */ __name((request) => {
  const authorization = String(request.headers.get("authorization") || "");
  const bearerMatch = /^\s*Bearer\s+(.+?)\s*$/i.exec(authorization);
  if (bearerMatch && bearerMatch[1]) return bearerMatch[1];
  return String(request.headers.get("x-roster-publish-secret") || "").trim() || String(request.headers.get("x-discord-bot-secret") || "").trim();
}, "readRequestSecret");
var sha256Bytes = /* @__PURE__ */ __name(async (valueRaw) => {
  const text = String(valueRaw == null ? "" : valueRaw);
  const bytes = new TextEncoder().encode(text);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}, "sha256Bytes");
var bytesToHex = /* @__PURE__ */ __name((bytesRaw) => {
  const bytes = bytesRaw instanceof Uint8Array ? bytesRaw : new Uint8Array(bytesRaw || []);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}, "bytesToHex");
var constantTimeSecretEqual = /* @__PURE__ */ __name(async (leftRaw, rightRaw) => {
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
}, "constantTimeSecretEqual");
var resolveBotDataSecret = /* @__PURE__ */ __name((envRaw) => {
  const env = envRaw && typeof envRaw === "object" ? envRaw : {};
  return String(
    env.ROSTER_BOT_SECRET || env.DISCORD_BOT_API_SECRET || env.ROSTER_PUBLIC_DATA_PUBLISH_SECRET || env.CLOUDFLARE_PUBLIC_DATA_PUBLISH_SECRET || ""
  );
}, "resolveBotDataSecret");
var resolvePublishSecret = /* @__PURE__ */ __name((envRaw) => {
  const env = envRaw && typeof envRaw === "object" ? envRaw : {};
  return String(
    env.ROSTER_PUBLIC_DATA_PUBLISH_SECRET || env.CLOUDFLARE_PUBLIC_DATA_PUBLISH_SECRET || env.ROSTER_BOT_SECRET || env.DISCORD_BOT_API_SECRET || ""
  );
}, "resolvePublishSecret");
var verifyRequestSecret = /* @__PURE__ */ __name(async (request, expectedRaw, labelRaw) => {
  const expected = String(expectedRaw == null ? "" : expectedRaw);
  if (!expected) {
    return {
      ok: false,
      response: jsonResponse(503, {
        ok: false,
        error: String(labelRaw || "Secret") + " is not configured."
      })
    };
  }
  const provided = readRequestSecret(request);
  if (!await constantTimeSecretEqual(provided, expected)) {
    return {
      ok: false,
      response: jsonResponse(401, {
        ok: false,
        error: "Unauthorized."
      })
    };
  }
  return { ok: true, response: null };
}, "verifyRequestSecret");
var buildDiscordBotSyncUpstreamCall = /* @__PURE__ */ __name((body, secret) => {
  const requestedMethod = String(body && (body.methodName || body.method) || "").trim();
  const args = Array.isArray(body && body.args) ? body.args : [];
  const readObjectOrPositional = /* @__PURE__ */ __name(() => {
    const first = args[0] && typeof args[0] === "object" && !Array.isArray(args[0]) ? args[0] : null;
    if (first) {
      return {
        playerTag: typeof first.playerTag === "string" ? first.playerTag : typeof first.tag === "string" ? first.tag : "",
        discordId: typeof first.discordId === "string" ? first.discordId : "",
        discordUsername: typeof first.discordUsername === "string" ? first.discordUsername : typeof first.username === "string" ? first.username : "",
        force: first.force === true
      };
    }
    return {
      playerTag: typeof args[0] === "string" ? args[0] : "",
      discordId: typeof args[1] === "string" ? args[1] : "",
      discordUsername: typeof args[2] === "string" ? args[2] : "",
      force: args[3] === true || args[4] === true
    };
  }, "readObjectOrPositional");
  if (requestedMethod === "linkDiscordIdentityForPlayerTag") {
    const parsed = readObjectOrPositional();
    if (!parsed.playerTag.trim() || !parsed.discordId.trim() && !parsed.discordUsername.trim()) {
      return {
        errorStatus: 400,
        error: "playerTag and discordUsername or discordId are required."
      };
    }
    return {
      method: "linkDiscordIdentityForPlayerTag",
      args: [{
        playerTag: parsed.playerTag,
        discordId: parsed.discordId,
        discordUsername: parsed.discordUsername,
        force: parsed.force === true,
        botSecret: secret
      }]
    };
  }
  if (requestedMethod === "syncDiscordIdentityForPlayerTag") {
    const parsed = readObjectOrPositional();
    if (!parsed.playerTag.trim() || !parsed.discordId.trim() && !parsed.discordUsername.trim()) {
      return {
        errorStatus: 400,
        error: "playerTag and discordUsername or discordId are required."
      };
    }
    return {
      method: "syncDiscordIdentityForPlayerTag",
      args: [{
        playerTag: parsed.playerTag,
        discordId: parsed.discordId,
        discordUsername: parsed.discordUsername,
        botSecret: secret
      }]
    };
  }
  if (requestedMethod === "deleteDiscordIdentityLink") {
    const parsed = readObjectOrPositional();
    const hasPlayerTag = !!parsed.playerTag.trim();
    const hasDiscordUser = !!(parsed.discordId.trim() || parsed.discordUsername.trim());
    if (hasPlayerTag === hasDiscordUser) {
      return {
        errorStatus: 400,
        error: "Provide exactly one of playerTag or Discord user."
      };
    }
    return {
      method: "deleteDiscordIdentityLink",
      args: [{
        playerTag: parsed.playerTag,
        discordId: parsed.discordId,
        discordUsername: parsed.discordUsername,
        botSecret: secret
      }]
    };
  }
  if (requestedMethod === "deleteDiscordIdentityForPlayerTag") {
    const parsed = readObjectOrPositional();
    if (!parsed.playerTag.trim()) {
      return {
        errorStatus: 400,
        error: "playerTag is required."
      };
    }
    return {
      method: "deleteDiscordIdentityForPlayerTag",
      args: [{
        playerTag: parsed.playerTag,
        botSecret: secret
      }]
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
        error: "playerTag is required."
      };
    }
    return {
      method: "deleteDiscordIdentityForPlayerTag",
      args: [{
        playerTag,
        botSecret: secret
      }]
    };
  }
  if (!playerTag.trim() || !discordId.trim() && !discordUsername.trim()) {
    return {
      errorStatus: 400,
      error: "playerTag and discordUsername or discordId are required."
    };
  }
  return {
    method: "syncDiscordIdentityForPlayerTag",
    args: [{
      playerTag,
      discordId,
      discordUsername,
      botSecret: secret
    }]
  };
}, "buildDiscordBotSyncUpstreamCall");
var handleDiscordBotSyncApi = /* @__PURE__ */ __name(async (request, env) => {
  const method = String(request.method || "").toUpperCase();
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "authorization, content-type, x-discord-bot-secret",
        "cache-control": "no-store"
      }
    });
  }
  if (method !== "POST") {
    return jsonResponse(405, {
      ok: false,
      error: "Method not allowed. Use POST."
    });
  }
  const secret = readDiscordBotSecret(request);
  if (!secret) {
    return jsonResponse(401, {
      ok: false,
      error: "Missing Discord bot secret."
    });
  }
  let body = null;
  try {
    body = await request.json();
  } catch (err) {
    return jsonResponse(400, {
      ok: false,
      error: "Invalid JSON payload."
    });
  }
  const upstreamCall = buildDiscordBotSyncUpstreamCall(body, secret);
  if (upstreamCall.error) {
    return jsonResponse(400, {
      ok: false,
      error: upstreamCall.error
    });
  }
  const execUrl = resolveAppsScriptExecUrl(env);
  if (!execUrl) {
    return jsonResponse(500, {
      ok: false,
      error: "Apps Script URL is not configured."
    });
  }
  try {
    const upstreamBody = JSON.stringify({
      method: upstreamCall.method,
      args: upstreamCall.args
    });
    const buildUpstreamRequest = /* @__PURE__ */ __name((url) => fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: upstreamBody
    }), "buildUpstreamRequest");
    let upstream = await buildUpstreamRequest(execUrl);
    let text = await upstream.text();
    let contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
    const fallbackExecUrl = resolveFallbackAppsScriptExecUrl();
    if (fallbackExecUrl && fallbackExecUrl !== execUrl && shouldRetryAppsScriptFallback(upstream, text, contentType)) {
      upstream = await buildUpstreamRequest(fallbackExecUrl);
      text = await upstream.text();
      contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
    }
    return new Response(text, {
      status: upstream.status,
      headers: {
        "content-type": contentType,
        "cache-control": "no-store"
      }
    });
  } catch (err) {
    return jsonResponse(502, {
      ok: false,
      error: err && err.message ? err.message : "Upstream request failed."
    });
  }
}, "handleDiscordBotSyncApi");
var resolveRosterDataStore = /* @__PURE__ */ __name((envRaw) => {
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
}, "resolveRosterDataStore");
var getDataStoreObject = /* @__PURE__ */ __name(async (store, key) => {
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
        text: /* @__PURE__ */ __name(async () => result.value, "text"),
        httpEtag: String(metadata.etag || ""),
        etag: String(metadata.etag || ""),
        httpMetadata: {
          contentType: String(metadata.contentType || "application/json; charset=utf-8"),
          cacheControl: String(metadata.cacheControl || "")
        }
      };
    }
    const value = await store.binding.get(key, "text");
    if (value == null) return null;
    return {
      body: value,
      text: /* @__PURE__ */ __name(async () => value, "text"),
      httpEtag: "",
      etag: "",
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
        cacheControl: ""
      }
    };
  }
  return null;
}, "getDataStoreObject");
var putDataStoreObject = /* @__PURE__ */ __name(async (store, key, valueText, metadataRaw) => {
  if (!store || !store.binding) throw new Error("Roster data store is not configured.");
  const metadata = metadataRaw && typeof metadataRaw === "object" ? metadataRaw : {};
  if (store.kind === "r2") {
    return store.binding.put(key, valueText, {
      httpMetadata: {
        contentType: metadata.contentType || "application/json; charset=utf-8",
        cacheControl: metadata.cacheControl || ""
      },
      customMetadata: metadata.customMetadata || {}
    });
  }
  if (store.kind === "kv") {
    const etag = '"' + bytesToHex(await sha256Bytes(valueText)) + '"';
    return store.binding.put(key, valueText, {
      metadata: {
        etag,
        contentType: metadata.contentType || "application/json; charset=utf-8",
        cacheControl: metadata.cacheControl || "",
        publishedAt: metadata.customMetadata && metadata.customMetadata.publishedAt || "",
        scope: metadata.customMetadata && metadata.customMetadata.scope || "",
        schema: metadata.customMetadata && metadata.customMetadata.schema || "roster-public-data-v1"
      }
    });
  }
  throw new Error("Unsupported roster data store.");
}, "putDataStoreObject");
var deleteDataStoreObject = /* @__PURE__ */ __name(async (store, key) => {
  if (!store || !store.binding || typeof store.binding.delete !== "function") {
    throw new Error("Roster data store is not configured.");
  }
  return store.binding.delete(key);
}, "deleteDataStoreObject");
var decodePathSegments = /* @__PURE__ */ __name((pathRaw) => {
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
}, "decodePathSegments");
var normalizeDataObjectPath = /* @__PURE__ */ __name((pathRaw) => {
  let path = String(pathRaw == null ? "" : pathRaw).trim().replace(/\\/g, "/").replace(/^[\/]+|[\/]+$/g, "");
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
}, "normalizeDataObjectPath");
var normalizeDataScope = /* @__PURE__ */ __name((scopeRaw) => {
  const scope = String(scopeRaw == null ? "" : scopeRaw).trim().toLowerCase();
  if (scope === "bot" || scope === "bot-data") return "bot";
  if (scope === "public" || scope === "public-data" || !scope) return "public";
  throw new Error("Invalid data scope.");
}, "normalizeDataScope");
var buildDataObjectKey = /* @__PURE__ */ __name((scopeRaw, pathRaw) => {
  const scope = normalizeDataScope(scopeRaw);
  const path = normalizeDataObjectPath(pathRaw);
  return (scope === "bot" ? BOT_DATA_STORE_PREFIX : PUBLIC_DATA_STORE_PREFIX) + "/" + path;
}, "buildDataObjectKey");
var readDataRoutePath = /* @__PURE__ */ __name((pathnameRaw, prefixRaw) => {
  const pathname = String(pathnameRaw == null ? "" : pathnameRaw);
  const prefix = String(prefixRaw == null ? "" : prefixRaw);
  let relative = pathname.slice(prefix.length).replace(/^\/+/, "");
  relative = decodePathSegments(relative);
  return relative;
}, "readDataRoutePath");
var getDataObjectCacheControl = /* @__PURE__ */ __name((scopeRaw, logicalPathRaw) => {
  const scope = normalizeDataScope(scopeRaw);
  const path = String(logicalPathRaw == null ? "" : logicalPathRaw).replace(/\.json$/i, "");
  if (scope === "bot") return "private, max-age=30";
  if (path.startsWith("activeVersions/")) return "public, max-age=31536000, immutable";
  if (path === "active" || path.startsWith("activePublished/") || path.startsWith("events/seasonEvents/") || path.startsWith("donationRefresh/")) {
    return "no-store";
  }
  return "public, max-age=30, stale-while-revalidate=120";
}, "getDataObjectCacheControl");
var publicDataCorsHeaders = /* @__PURE__ */ __name(() => ({
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "if-none-match, content-type",
  "access-control-max-age": "86400"
}), "publicDataCorsHeaders");
var publishCorsHeaders = /* @__PURE__ */ __name(() => ({
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, x-discord-bot-secret, x-roster-publish-secret",
  "cache-control": "no-store"
}), "publishCorsHeaders");
var requestEtagMatches = /* @__PURE__ */ __name((request, etagRaw) => {
  const etag = String(etagRaw == null ? "" : etagRaw).trim();
  if (!etag) return false;
  const header = String(request.headers.get("if-none-match") || "").trim();
  if (!header) return false;
  if (header === "*") return true;
  return header.split(",").map((part) => part.trim()).includes(etag);
}, "requestEtagMatches");
var handleDataHealth = /* @__PURE__ */ __name(async (request, env, scopeRaw) => {
  const method = String(request.method || "").toUpperCase();
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: scopeRaw === "public" ? publicDataCorsHeaders() : { "cache-control": "no-store" }
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
    hasCurrentVersion: !!currentVersionId
  }, scopeRaw === "public" ? publicDataCorsHeaders() : {});
  if (method === "HEAD") return new Response(null, { status: response.status, headers: response.headers });
  return response;
}, "handleDataHealth");
var handleDataRead = /* @__PURE__ */ __name(async (request, env, url, scopeRaw) => {
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
  const object = await getDataStoreObject(store, key);
  if (!object) {
    return jsonResponse(404, {
      ok: false,
      error: "Data object not found.",
      path: objectPath.replace(/\.json$/i, "")
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
}, "handleDataRead");
var readPublishBody = /* @__PURE__ */ __name(async (request) => {
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
}, "readPublishBody");
var readPublishEntryPayload = /* @__PURE__ */ __name((entry) => {
  if (Object.prototype.hasOwnProperty.call(entry, "payload")) return entry.payload;
  if (Object.prototype.hasOwnProperty.call(entry, "value")) return entry.value;
  if (Object.prototype.hasOwnProperty.call(entry, "json")) return entry.json;
  throw new Error("Publish object payload is required.");
}, "readPublishEntryPayload");
var normalizePublishObject = /* @__PURE__ */ __name((entryRaw, defaultScopeRaw, publishedAt) => {
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
    publishedAt
  };
}, "normalizePublishObject");
var normalizeDeleteObject = /* @__PURE__ */ __name((entryRaw, defaultScopeRaw) => {
  const entry = entryRaw && typeof entryRaw === "object" && !Array.isArray(entryRaw) ? entryRaw : { path: entryRaw };
  const scope = normalizeDataScope(entry.scope || defaultScopeRaw);
  const path = normalizeDataObjectPath(entry.path || entry.key || entry.name);
  return {
    scope,
    path,
    key: buildDataObjectKey(scope, path)
  };
}, "normalizeDeleteObject");
var handleDataPublish = /* @__PURE__ */ __name(async (request, env) => {
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
  const publishedAt = String(body.publishedAt || (/* @__PURE__ */ new Date()).toISOString());
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
          schema: "roster-public-data-v1"
        }
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
      scopes: Array.from(new Set(objects.concat(deletes).map((item) => item.scope))).sort()
    });
  } catch (err) {
    return jsonResponse(502, {
      ok: false,
      error: err && err.message ? err.message : "Roster data publish failed."
    });
  }
}, "handleDataPublish");
var createAssetRequest = /* @__PURE__ */ __name((request, pathnameRaw) => {
  const pathname = String(pathnameRaw == null ? "" : pathnameRaw).trim();
  if (!pathname) return request;
  const rewrittenUrl = new URL(request.url);
  rewrittenUrl.pathname = pathname;
  return new Request(rewrittenUrl.toString(), request);
}, "createAssetRequest");
var serveStaticAsset = /* @__PURE__ */ __name((request, env) => {
  if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== "function") {
    return new Response("ASSETS binding is missing.", { status: 500 });
  }
  return env.ASSETS.fetch(request);
}, "serveStaticAsset");
var worker_core_default = {
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
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-yPjK3n/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_core_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-yPjK3n/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=_worker.js.map
