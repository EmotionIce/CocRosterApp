/*
 * Public runtime config for the static roster page.
 *
 * Fill the default values below with real values for production:
 * - ROSTER_FIREBASE_DB_URL: public Firebase Realtime Database URL.
 * - ROSTER_BASE_URL: Apps Script web app URL used as backend source.
 * - ROSTER_ADMIN_URL (optional): absolute or root-relative admin page URL.
 * - ROSTER_ADMIN_API_BASE (optional): admin API proxy base (default /api/admin).
 * - ROSTER_PUBLIC_CONFIG_OVERRIDES (optional): static public/branding overrides.
 *
 * `ROSTER_PUBLIC_CONFIG_OVERRIDES` supports these optional keys:
 * - bannerMediaUrl
 * - squareMediaUrl
 * - discordInviteUrl
 * - landing (object): same keys as above, plus profile
 * - profile (object): landing/nav copy plus optional importMappingSeeds hints
 * Runtime overrides take precedence over published payload values.
 * At minimum set ROSTER_FIREBASE_DB_URL for direct Firebase hydration.
 */
(function initRosterPublicConfig(globalScope) {
    if (!globalScope || typeof globalScope !== "object") return;
    var DEFAULT_FIREBASE_DB_URL = "https://turtlecoc-37f22-default-rtdb.firebaseio.com";
    var DEFAULT_APPS_SCRIPT_BASE_URL = "https://script.google.com/macros/s/AKfycbyIrN6gBS2DkhJwO6NzdtnHPEBQJCCkOtiPOM9EslkQ6AaQjXmFFDGGVn_sENGKxEwuhg/exec";

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

    var locationRef = globalScope.location || null;
    var sameOriginBaseUrl = "/";
    if (locationRef && typeof locationRef.origin === "string" && locationRef.origin && locationRef.origin !== "null") {
        sameOriginBaseUrl = locationRef.origin.replace(/[\/\\]+$/, "") + "/";
    }

    var configuredStaticBaseUrl = normalizeHttpBaseUrl(globalScope.ROSTER_STATIC_BASE_URL);
    globalScope.ROSTER_STATIC_BASE_URL = configuredStaticBaseUrl || sameOriginBaseUrl;

    var configuredFirebaseDbUrl = normalizeHttpBaseUrl(globalScope.ROSTER_FIREBASE_DB_URL);
    var defaultFirebaseDbUrl = normalizeHttpBaseUrl(DEFAULT_FIREBASE_DB_URL);
    globalScope.ROSTER_FIREBASE_DB_URL = configuredFirebaseDbUrl || defaultFirebaseDbUrl;

    var configuredRosterBaseUrl = normalizeHttpBaseUrl(globalScope.ROSTER_BASE_URL);
    var defaultRosterBaseUrl = normalizeHttpBaseUrl(DEFAULT_APPS_SCRIPT_BASE_URL);
    globalScope.ROSTER_BASE_URL = configuredRosterBaseUrl || defaultRosterBaseUrl;

    var configuredPublicOverrides = globalScope.ROSTER_PUBLIC_CONFIG_OVERRIDES;
    if (!configuredPublicOverrides || typeof configuredPublicOverrides !== "object" || Array.isArray(configuredPublicOverrides)) {
        configuredPublicOverrides = {};
    }
    globalScope.ROSTER_PUBLIC_CONFIG_OVERRIDES = configuredPublicOverrides;

    if (typeof globalScope.__ROSTER_DATA__ === "undefined") {
        globalScope.__ROSTER_DATA__ = null;
    }
})(typeof window !== "undefined" ? window : this);
