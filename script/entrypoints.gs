// Request entrypoints and response helpers.

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

	const baseUrl = ScriptApp.getService().getUrl();
	const staticBaseUrl = STATIC_ASSET_BASE_URL;
	const page = String(p.page || "").trim().toLowerCase();

	if (page === "admin") {
		const buildStamp = new Date().toISOString();
		const assetVersion = getStaticAssetVersion_();
		const t = HtmlService.createTemplateFromFile("Admin");
		t.buildStamp = buildStamp;
		t.assetVersion = assetVersion;
		t.baseUrl = baseUrl;
		t.staticBaseUrl = staticBaseUrl;
		return t.evaluate().setTitle("Roster Admin").setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
	}

	const queryString = e && typeof e.queryString === "string" ? e.queryString : "";
	const redirectUrl = buildPublicSiteRedirectUrl_(staticBaseUrl, queryString);
	const redirectHtml = buildPublicSiteRedirectHtml_(redirectUrl);
	return HtmlService.createHtmlOutput(redirectHtml).setTitle("Redirecting to CWL Roster").setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Cloudflare admin bridge endpoint.
 * Accepts JSON: { method: string, args: any[] } and returns { ok, result|error }.
 */

function doPost(e) {
	let payload = {};
	try {
		payload = parseAdminApiPayload_(e);
	} catch (err) {
		return createAdminApiJsonResponse_({
			ok: false,
			error: errorMessage_(err),
		});
	}

	try {
		const method = String(payload.method == null ? "" : payload.method).trim();
		const args = Array.isArray(payload.args) ? payload.args : [];
		const result = runAdminApiMethod_(method, args);
		return createAdminApiJsonResponse_({
			ok: true,
			result: result == null ? null : result,
		});
	} catch (err) {
		return createAdminApiJsonResponse_({
			ok: false,
			error: errorMessage_(err),
		});
	}
}

function parseAdminApiPayload_(e) {
	const raw = e && e.postData && typeof e.postData.contents === "string" ? e.postData.contents : "";
	if (!raw) return {};
	let parsed = null;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new Error("Invalid JSON payload.");
	}
	if (!parsed || typeof parsed !== "object") {
		throw new Error("Payload must be an object.");
	}
	return parsed;
}

function createAdminApiJsonResponse_(payload) {
	const safePayload = payload && typeof payload === "object" ? payload : { ok: false, error: "Invalid response payload." };
	return ContentService
		.createTextOutput(JSON.stringify(safePayload))
		.setMimeType(ContentService.MimeType.JSON);
}

function buildPublicSiteRedirectHtml_(targetUrlRaw) {
	const targetUrl = String(targetUrlRaw == null ? "" : targetUrlRaw).trim() || "/";
	const escapedTargetUrl = escapeHtmlAttribute_(targetUrl);
	const targetUrlJson = escapeInlineScriptText_(JSON.stringify(targetUrl));
	return [
		"<!doctype html>",
		"<html>",
		"<head>",
		'    <meta charset="utf-8" />',
		'    <meta name="viewport" content="width=device-width, initial-scale=1" />',
		"    <title>Redirecting to CWL Roster</title>",
		'    <meta http-equiv="refresh" content="0;url=' + escapedTargetUrl + '" />',
		'    <meta name="robots" content="noindex" />',
		'    <link rel="canonical" href="' + escapedTargetUrl + '" />',
		"</head>",
		'<body style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:16px;background:#0b0f17;color:#e5e7eb;">',
		'    <p style="margin:0 0 6px;">Redirecting to the public roster site.</p>',
		'    <p style="margin:0;"><a style="color:#93c5fd;" href="' + escapedTargetUrl + '">Continue</a></p>',
		"    <script>",
		"        (function () {",
		"            var target = " + targetUrlJson + ";",
		"            if (typeof window === 'undefined' || !window.location) return;",
		"            window.location.replace(target);",
		"        })();",
		"    </script>",
		"</body>",
		"</html>",
	].join("\n");
}

function buildPublicSiteRedirectUrl_(publicBaseUrlRaw, queryStringRaw) {
	const baseUrl = String(publicBaseUrlRaw == null ? "" : publicBaseUrlRaw).trim().replace(/[\/\\]+$/, "");
	const queryString = String(queryStringRaw == null ? "" : queryStringRaw).replace(/^\?+/, "");
	const targetBase = baseUrl ? baseUrl + "/" : "/";
	if (!queryString) return targetBase;
	return targetBase + "?" + queryString;
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

function escapeHtmlAttribute_(value) {
	return String(value == null ? "" : value)
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function escapeInlineScriptText_(value) {
	return String(value == null ? "" : value).replace(/<\/script/gi, "<\\/script");
}

function errorMessage_(err) {
	return err && (err.message || err.stack) ? err.message || err.stack : String(err);
}
