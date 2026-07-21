/*
 * Public runtime config for the static roster page.
 *
 * Fill the default values below with real values for production:
 * - ROSTER_PUBLIC_DATA_BASE_URL: public JSON data route served by the Worker.
 * - ROSTER_BASE_URL: Apps Script web app URL used as backend source.
 * - ROSTER_ADMIN_URL (optional): absolute or root-relative admin page URL.
 * - ROSTER_ADMIN_API_BASE (optional): admin API base. Defaults to the same-origin
 *   Cloudflare Worker route; the Apps Script URL remains the client fallback.
 * - ROSTER_PUBLIC_CONFIG_OVERRIDES (optional): static public/branding overrides.
 *
 * `ROSTER_PUBLIC_CONFIG_OVERRIDES` supports these optional keys:
 * - bannerMediaUrl
 * - squareMediaUrl
 * - discordInviteUrl
 * - landing (object): same keys as above, plus profile
 * - profile (object): landing/nav copy plus optional importMappingSeeds hints
 * Runtime overrides take precedence over published payload values.
 * The default public-data route is same-origin `/api/public-data`.
 */
(function initRosterPublicConfig(globalScope) {
    if (!globalScope || typeof globalScope !== "object") return;
    var DEFAULT_PUBLIC_DATA_BASE_PATH = "/api/public-data";
    var DEFAULT_APPS_SCRIPT_BASE_URL = "https://script.google.com/macros/s/AKfycbw6ASmNd5Ajn8p8dfN1d0I0GwG5agjMWjDCaa25umExFmV1_fxhvV3kcDLmoKNoC8Lnlw/exec";

    // Handle as trimmed text.
    function asTrimmedText(valueRaw) {
        if (valueRaw == null) return "";
        return String(valueRaw).trim();
    }

    // Normalize http base URL.
    function normalizeHttpBaseUrl(valueRaw) {
        var value = asTrimmedText(valueRaw);
        if (!value) return "";
        if (!/^https?:\/\//i.test(value)) return "";
        return value.replace(/[\/\\]+$/, "");
    }

    // Normalize a public-data base URL.
    function normalizePublicDataBaseUrl(valueRaw) {
        var value = asTrimmedText(valueRaw);
        if (!value) return "";
        if (/^https?:\/\//i.test(value) || value.charAt(0) === "/") {
            return value.replace(/[\/\\]+$/, "");
        }
        return "";
    }

    // Normalize admin API base URL.
    function normalizeAdminApiBaseUrl(valueRaw) {
        var value = asTrimmedText(valueRaw);
        if (!value) return "";
        if (/^https?:\/\//i.test(value) || value.charAt(0) === "/") {
            return value.replace(/[\/\\]+$/, "");
        }
        return "";
    }

    var locationRef = globalScope.location || null;
    var sameOriginBaseUrl = "/";
    if (locationRef && typeof locationRef.origin === "string" && locationRef.origin && locationRef.origin !== "null") {
        sameOriginBaseUrl = locationRef.origin.replace(/[\/\\]+$/, "") + "/";
    }

    var configuredStaticBaseUrl = normalizeHttpBaseUrl(globalScope.ROSTER_STATIC_BASE_URL);
    globalScope.ROSTER_STATIC_BASE_URL = configuredStaticBaseUrl || sameOriginBaseUrl;

    var configuredPublicDataBaseUrl = normalizePublicDataBaseUrl(globalScope.ROSTER_PUBLIC_DATA_BASE_URL);
    globalScope.ROSTER_PUBLIC_DATA_BASE_URL = configuredPublicDataBaseUrl || DEFAULT_PUBLIC_DATA_BASE_PATH;

    var configuredRosterBaseUrl = normalizeHttpBaseUrl(globalScope.ROSTER_BASE_URL);
    var defaultRosterBaseUrl = normalizeHttpBaseUrl(DEFAULT_APPS_SCRIPT_BASE_URL);
    globalScope.ROSTER_BASE_URL = configuredRosterBaseUrl || defaultRosterBaseUrl;

    var configuredAdminApiBase = normalizeAdminApiBaseUrl(globalScope.ROSTER_ADMIN_API_BASE);
    globalScope.ROSTER_ADMIN_API_BASE = configuredAdminApiBase || "/api/admin";

    var configuredPublicOverrides = globalScope.ROSTER_PUBLIC_CONFIG_OVERRIDES;
    if (!configuredPublicOverrides || typeof configuredPublicOverrides !== "object" || Array.isArray(configuredPublicOverrides)) {
        configuredPublicOverrides = {};
    }
    globalScope.ROSTER_PUBLIC_CONFIG_OVERRIDES = configuredPublicOverrides;

    if (typeof globalScope.__ROSTER_DATA__ === "undefined") {
        globalScope.__ROSTER_DATA__ = null;
    }
})(typeof window !== "undefined" ? window : this);
