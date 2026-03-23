// Cloudflare Worker routing and Apps Script fallback helpers.

const FALLBACK_APPS_SCRIPT_EXEC_URL =
  "https://script.google.com/macros/s/AKfycbyIrN6gBS2DkhJwO6NzdtnHPEBQJCCkOtiPOM9EslkQ6AaQjXmFFDGGVn_sENGKxEwuhg/exec";

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
    if (isAdminPageQuery(url)) {
      return serveStaticAsset(createAssetRequest(request, "/console.html"), env, ctx);
    }
    if (isAdminPagePath(url.pathname)) {
      return serveStaticAsset(createAssetRequest(request, "/console.html"), env, ctx);
    }
    return serveStaticAsset(request, env, ctx);
  },
};
