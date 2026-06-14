// Cloudflare Worker routing and Apps Script fallback helpers.

const FALLBACK_APPS_SCRIPT_EXEC_URL =
  "https://script.google.com/macros/s/AKfycbyA5QJUW3Lb2QVyVRKKTWMS9zyBBm82ubtYLGEQU-eoKuC4pRY4PA-oYraYWGaxDCBdFg/exec";

// Normalize http URL.
const normalizeHttpUrl = (valueRaw) => {
  const value = String(valueRaw == null ? "" : valueRaw).trim();
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) return "";
  return value.replace(/[\/\\]+$/, "");
};

// Resolve Apps Script exec URL.
const resolveAppsScriptExecUrl = (envRaw) => {
  const env = envRaw && typeof envRaw === "object" ? envRaw : {};
  const configured = normalizeHttpUrl(
    env.ROSTER_APPS_SCRIPT_URL || env.ROSTER_BASE_URL || ""
  );
  const base = configured || normalizeHttpUrl(FALLBACK_APPS_SCRIPT_EXEC_URL);
  if (!base) return "";
  if (/\/exec$/i.test(base)) return base;
  return base + "/exec";
};

// Handle JSON response.
const jsonResponse = (status, payload) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

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
    const upstream = await fetch(execUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: bodyText || "{}",
    });

    const text = await upstream.text();
    const contentType =
      upstream.headers.get("content-type") || "application/json; charset=utf-8";

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
    const upstream = await fetch(execUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        method: upstreamCall.method,
        args: upstreamCall.args,
      }),
    });

    const text = await upstream.text();
    const contentType =
      upstream.headers.get("content-type") || "application/json; charset=utf-8";

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
    return serveStaticAsset(request, env, ctx);
  },
};
