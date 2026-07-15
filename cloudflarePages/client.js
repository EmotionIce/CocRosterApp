// Cloudflare public client state, rendering, and interaction helpers.

(() => {
    // Select the first element that matches a selector.
    const $ = (sel) => document.querySelector(sel);
    // Convert a value to a string safely.
    const toStr = (v) => (v == null ? "" : String(v));
    // Choose the singular or plural label for a count.
    const pluralize = (count, singular, plural) => (count === 1 ? singular : plural);
    const PROFILE_MODAL_ID = "rosterPlayerProfileModal";
    const DAY_MS = 24 * 60 * 60 * 1000;
    const PUBLIC_DATA_KEY_ENCODING_PREFIX = "__FB64__";
    const ACTIVE_PUBLISHED_CURRENT_VERSION_PATH = "activePublished/currentVersionId";
    const ACTIVE_VERSIONS_PATH = "activeVersions";
    const PUBLIC_BOOTSTRAP_CURRENT_PATH = "bootstrap/current";
    const DONATION_REFRESH_BASE_PATH = "donationRefresh";
    const SEASON_EVENTS_BASE_PATH = "events/seasonEvents";
    const SEASON_EVENTS_CURRENT_PATH = SEASON_EVENTS_BASE_PATH + "/current";
    const SEASON_EVENTS_CURRENT_CWL_PATH = SEASON_EVENTS_BASE_PATH + "/currentCwl";
    const SEASON_EVENTS_LATEST_COMPLETED_CWL_PATH = SEASON_EVENTS_BASE_PATH + "/latestCompletedCwl";
    const SEASON_EVENTS_CWL_AGGREGATES_PATH = SEASON_EVENTS_BASE_PATH + "/cwlAggregates/byEvent";
    const SEASON_EVENTS_BY_ID_PATH = SEASON_EVENTS_BASE_PATH + "/byId";
    const SEASON_EVENTS_BY_SEASON_PATH = SEASON_EVENTS_BASE_PATH + "/bySeason";
    const SEASON_EVENTS_SEASON_STATE_CURRENT_PATH = SEASON_EVENTS_BASE_PATH + "/seasonState/current";
    const SEASON_EVENT_COLLAPSED_ROW_COUNT = 3;
    const CLOUDFLARE_PUBLIC_SOURCE = "cloudflare-public";
    const PUBLIC_DATA_BASE_FALLBACK_URL = "/api/public-data";
    const PUBLIC_DATA_IMMUTABLE_RETRY_DELAY_CAP_MS = 1250;
    const PUBLIC_DATA_BOOT_RETRY_BUDGET_MS = 2500;
    const STATIC_ASSET_BASE_FALLBACK_URL = "https://turtlecoc.4jbf82gng5.workers.dev/";
    const ROSTER_SNAPSHOT_CACHE_KEY = "roster.publicSnapshot.v1";
    const ROSTER_SNAPSHOT_IDB_DB_NAME = "roster-public-cache";
    const ROSTER_SNAPSHOT_IDB_STORE_NAME = "snapshots";
    const ROSTER_SNAPSHOT_CACHE_MAX_AGE_MS = 14 * DAY_MS;
    const ROSTER_ANCHOR_PREFIX = "roster-";
    const numberFormatter = typeof Intl !== "undefined" && Intl.NumberFormat
        ? new Intl.NumberFormat()
        : { format: (value) => String(value) };

    let lastRenderedData = null;
    let lastRenderedRosterDisplayById = Object.create(null);
    let lastRenderedRosterFreshnessKey = "";
    let searchUiBound = false;
    let publicViewUiBound = false;
    let profileUiBound = false;
    let seasonEventCardExpandedByType = Object.create(null);
    let previousSeasonEventsLoadInFlight = false;
    let previousSeasonEventsLoadRequestId = 0;
    let globalLastUpdatedTimerId = 0;
    let globalLastUpdatedTimerValue = "";
    let warCountdownTimerId = 0;
    let landingRevealObserver = null;
    let landingScrollEffectsBound = false;
    let landingScrollRafId = 0;
    let landingSquareStoryActiveStep = -1;
    let landingMediaCanStart = false;
    let landingMediaDeferredStartScheduled = false;
    let rosterHydrationInFlight = false;
    let rosterNavigatorBound = false;
    let rosterNavigatorEntries = [];
    let rosterNavigatorFrameId = 0;
    let rosterNavigatorHeaderResizeObserver = null;
    let rosterNavigatorLastHandledHash = "";
    const missingSectionExpandedByRoster = Object.create(null);

    const profileCache = Object.create(null);
    const profilePending = Object.create(null);
    const townHallIconCache = Object.create(null);
    const townHallIconPending = Object.create(null);
    const leagueIconCache = Object.create(null);
    const leagueIconPending = Object.create(null);
    const landingMediaAssetCache = Object.create(null);
    const landingMediaAssetPending = Object.create(null);
    const landingMediaLoadTokens = Object.create(null);
    const profileState = {
        root: null,
        titleEl: null,
        subtitleEl: null,
        topbarLeagueEl: null,
        topbarThEl: null,
        topbarStatusEl: null,
        topbarFormEl: null,
        bodyEl: null,
        closeEl: null,
        open: false,
        triggerEl: null,
        activeTag: "",
        activeRosterId: "",
        activeContext: null,
        requestToken: 0,
        bodyOverflow: "",
        bodyPaddingRight: "",
    };
    const PROFILE_LEAGUE_DEBUG = typeof window !== "undefined" && window && window.ROSTER_DEBUG_LEAGUE_BADGE === true;
    const PUBLIC_VIEW_STORAGE_KEY = "roster.publicViewState.v1";
    const PUBLIC_VIEW_VALUES = {
        rosters: "rosters",
        leaderboard: "leaderboard",
        landing: "landing",
    };
    const PUBLIC_VIEW_SYNC_COPY = {
        rosters: {
            loadingTitle: "Preparing roster board",
            loadingText: "Building live roster cards and sections.",
            refreshTitle: "Refreshing roster board",
            refreshText: "Showing the current snapshot while live member data syncs.",
        },
        leaderboard: {
            loadingTitle: "Preparing leaderboard",
            loadingText: "Assembling current season event standings.",
            refreshTitle: "Refreshing leaderboard",
            refreshText: "Season event standings stay visible while fresh data syncs.",
        },
        landing: {
            loadingTitle: "Preparing clan overview",
            loadingText: "Loading the latest family snapshot and media.",
            refreshTitle: "Refreshing clan overview",
            refreshText: "Home content remains visible while fresh clan data syncs.",
        },
    };
    const PUBLIC_PAGE_QUERY_VALUES = {
        auto: "auto",
        rosters: "rosters",
        leaderboard: "leaderboard",
        landing: "landing",
    };
    const LANDING_COMPACT_LAYOUT_QUERY = "(max-width: 820px), (max-height: 520px) and (max-width: 940px)";
    const PUBLIC_LANDING_DEFAULTS = {
        bannerMediaUrl: "https://player.cloudinary.com/embed/?cloud_name=dq2az35aa&public_id=banner_xwhksj&profile=cld-looping",
        squareMediaUrl: "https://player.cloudinary.com/embed/?cloud_name=dq2az35aa&public_id=square_ofyufv&profile=cld-looping",
        discordInviteUrl: "https://discord.gg/turtlecoc",
    };
    const PUBLIC_PROFILE_DEFAULTS = {
        brand: {
            eyebrow: "Discord \u2022 War \u2022 CWL",
        },
        nav: {
            homeLabel: "Home",
            rostersLabel: "Rosters",
            leaderboardLabel: "Leaderboard",
            discordLabel: "Discord",
            adminLabel: "Admin Panel",
        },
        hero: {
            eyebrow: "Join \u2022 Match \u2022 War",
            title: "TURTLE",
            body: "Join Discord. Send your tag. Get matched.",
            primaryCtaLabel: "Join Discord",
            secondaryCtaLabel: "View Rosters",
        },
        journey: {
            eyebrow: "Entry",
            title: "Send tag. Get matched. Climb.",
            steps: [
                { label: "01", title: "Join Discord", body: "Open a ticket with your tag." },
                { label: "02", title: "Get matched", body: "Placed by TH, activity, and goals." },
                { label: "03", title: "Move up", body: "War, CWL, stronger lineups." },
            ],
        },
        family: {
            eyebrow: "Live clans",
            title: "Real rosters. Clear path.",
            metaTemplate: "{clanCount} clans \u2022 {playerCount} rostered players",
            loadingMetaText: "Syncing live rosters.",
            playersLabel: "Rostered players",
            cwlLabel: "CWL status",
            regularWarLabel: "War status",
        },
        war: {
            eyebrow: "War",
            title: "Opt in. Use hits. Improve.",
            body: "Organised wars without the noise.",
            highlights: [
                { label: "Rhythm", value: "Back-to-back" },
                { label: "Hits", value: "Both expected" },
                { label: "Record", value: "Misses tracked" },
                { label: "Help", value: "Planning support" },
            ],
        },
        cwl: {
            eyebrow: "CWL",
            title: "Planned lineups. Clear rewards.",
            body: "Set before league week. Side wars keep running.",
            highlights: [
                { label: "Places", value: "Active" },
                { label: "Rosters", value: "Pre-set" },
                { label: "Rewards", value: "Full path" },
                { label: "Wars", value: "Still running" },
            ],
        },
        network: {
            eyebrow: "Progression",
            title: "Strong hits. Stronger lineups.",
            body: "Reliability moves you up.",
            highlights: [
                { label: "Signal", value: "Results" },
                { label: "Lineups", value: "Higher CWL" },
                { label: "Practice", value: "Wars" },
                { label: "Path", value: "Move up" },
            ],
        },
        proof: {
            eyebrow: "Standards",
            title: "Discord on.\nHits used.\nProgress earned.",
            body: "Be reachable. Use attacks. Communicate early.",
        },
        finalCta: {
            eyebrow: "Ready",
            title: "Enter the shell.",
            steps: [
                "Join Discord.",
                "Send your tag.",
                "Get matched.",
            ],
            primaryCtaLabel: "Join Discord",
            secondaryCtaLabel: "View Leaderboard",
        },
        media: {
            bannerLabel: "TURTLE banner animation",
            squareLabel: "TURTLE icon animation",
            bannerPlaceholderLabel: "TURTLE banner preview",
            squarePlaceholderLabel: "TURTLE icon preview",
        },
    };
    const LANDING_MEDIA_REMOTE_LOAD_TIMEOUT_MS = 9000;
    const LANDING_MEDIA_LOCAL_LOAD_TIMEOUT_MS = 7000;
    const LANDING_MEDIA_FALLBACK_CANDIDATES = {
        banner: [
            "assets/images/banner-static.webm",
            "assets/images/banner_static.webm",
            "assets/images/banner.webm",
            "assets/images/banner-static.webp",
            "assets/images/banner.webp",
            "assets/images/banner-static.png",
            "assets/images/banner.png",
        ],
        square: [
            "assets/images/square-static.webm",
            "assets/images/square_static.webm",
            "assets/images/square.webm",
            "assets/images/square-static.webp",
            "assets/images/square.webp",
            "assets/images/square-static.png",
            "assets/images/square.png",
        ],
    };
    const LEADERBOARD_RANKED_SEASON_ANCHOR_ISO = "2026-05-18T05:00:00.000Z";
    const LEADERBOARD_RANKED_SEASON_CYCLE_MS = 28 * 24 * 60 * 60 * 1000;
    const SEASON_EVENT_RESULT_MODE_VALUES = {
        current: "current",
        previous: "previous",
    };
    const LEADERBOARD_LEAGUE_FALLBACK_RANK = 999;
    const LEADERBOARD_EXACT_LEAGUE_ORDER = [
        "Legends I",
        "Legends II",
        "Legends III",
        "Electro 33",
        "Electro 32",
        "Electro 31",
        "Dragon 30",
        "Dragon 29",
        "Dragon 28",
        "Titan 27",
        "Titan 26",
        "Titan 25",
        "P.E.K.K.A 24",
        "P.E.K.K.A 23",
        "P.E.K.K.A 22",
        "Golem 21",
        "Golem 20",
        "Golem 19",
        "Witch 18",
        "Witch 17",
        "Witch 16",
        "Valkyrie 15",
        "Valkyrie 14",
        "Valkyrie 13",
        "Wizard 12",
        "Wizard 11",
        "Wizard 10",
        "Archer 9",
        "Archer 8",
        "Archer 7",
        "Barbarian 6",
        "Barbarian 5",
        "Barbarian 4",
        "Skeleton 3",
        "Skeleton 2",
        "Skeleton 1",
        "Unranked",
    ];

    // Update admin link.
    const updateAdminLink = () => {
        const adminLink = $("#openAdminLink");
        if (!adminLink) return;

        const hostName = toStr(
            typeof window !== "undefined" && window && window.location ? window.location.hostname : ""
        ).toLowerCase();
        const isAppsScriptHost = /(^|\.)script\.google\.com$/.test(hostName);
        if (!isAppsScriptHost) {
            adminLink.href = "/console";
            adminLink.removeAttribute("aria-disabled");
            adminLink.classList.remove("is-disabled");
            return;
        }

        const explicitAdminUrl = toStr(
            typeof window !== "undefined" && window ? window.ROSTER_ADMIN_URL : ""
        ).trim();
        const normalizedExplicitAdminUrl =
            explicitAdminUrl && (/^https?:\/\//i.test(explicitAdminUrl) || explicitAdminUrl.startsWith("/"))
                ? explicitAdminUrl
                : "";

        const baseUrl = toStr(
            (typeof window !== "undefined" && window && (window.ROSTER_BASE_URL || window.BASE_URL))
                ? (window.ROSTER_BASE_URL || window.BASE_URL)
                : ""
        ).trim();
        const normalizedBaseUrl =
            baseUrl && (/^https?:\/\//i.test(baseUrl) || baseUrl.startsWith("/"))
                ? baseUrl
                : "";

        const targetUrl = normalizedBaseUrl
            ? (normalizedBaseUrl + (normalizedBaseUrl.indexOf("?") >= 0 ? "&" : "?") + "page=admin")
            : (normalizedExplicitAdminUrl || "/console");

        adminLink.href = targetUrl;
        adminLink.removeAttribute("aria-disabled");
        adminLink.classList.remove("is-disabled");
    };

    // Normalize http URL.
    const normalizeHttpUrl = (valueRaw) => {
        const value = toStr(valueRaw).trim();
        if (!value) return "";
        if (/^https?:\/\//i.test(value)) return value;
        return "";
    };

    // Handle pick first http URL.
    const pickFirstHttpUrl = (...values) => {
        for (let i = 0; i < values.length; i++) {
            const normalized = normalizeHttpUrl(values[i]);
            if (normalized) return normalized;
        }
        return "";
    };

    // Resolve landing media source.
    const resolveLandingMediaSource = (valueRaw) => {
        const value = toStr(valueRaw).trim();
        if (!value) return { kind: "none", value: "" };
        if (/^https?:\/\//i.test(value) || /^data:(image|video)\//i.test(value)) {
            return { kind: "url", value: value };
        }
        return { kind: "none", value: "" };
    };

    // Return whether plain object.
    const isPlainObject_ = (valueRaw) => !!(valueRaw && typeof valueRaw === "object" && !Array.isArray(valueRaw));

    // Read runtime public config overrides from global scope.
    const readRuntimePublicConfigOverrides_ = () => {
        if (typeof window === "undefined" || !window) return {};
        const overrides = window.ROSTER_PUBLIC_CONFIG_OVERRIDES;
        return isPlainObject_(overrides) ? overrides : {};
    };

    // Sanitize profile values by template shape.
    const sanitizePublicProfileByTemplate_ = (templateRaw, candidateRaw) => {
        if (typeof templateRaw === "string") {
            const text = toStr(candidateRaw).trim();
            return text || templateRaw;
        }

        if (Array.isArray(templateRaw)) {
            if (!templateRaw.length) return [];
            const templateItem = templateRaw[0];
            const sourceArray = Array.isArray(candidateRaw) ? candidateRaw : [];

            if (typeof templateItem === "string") {
                const outStrings = [];
                for (let i = 0; i < templateRaw.length; i++) {
                    const fallbackText = toStr(templateRaw[i]).trim();
                    const candidateText = toStr(sourceArray[i]).trim();
                    outStrings.push(candidateText || fallbackText);
                }
                return outStrings;
            }

            const outObjects = [];
            for (let i = 0; i < templateRaw.length; i++) {
                const fallbackItem = isPlainObject_(templateRaw[i]) ? templateRaw[i] : templateItem;
                const sourceItem = isPlainObject_(sourceArray[i]) ? sourceArray[i] : {};
                outObjects.push(sanitizePublicProfileByTemplate_(fallbackItem, sourceItem));
            }
            return outObjects;
        }

        if (!isPlainObject_(templateRaw)) return templateRaw;
        const sourceObject = isPlainObject_(candidateRaw) ? candidateRaw : {};
        const out = {};
        const keys = Object.keys(templateRaw);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            out[key] = sanitizePublicProfileByTemplate_(templateRaw[key], sourceObject[key]);
        }
        return out;
    };

    // Build resolved public profile from defaults, payload data, then runtime overrides.
    // Runtime overrides win so static rebranding can be applied without republishing data.
    const buildResolvedPublicProfile_ = (runtimeConfigRaw, payloadConfigRaw, landingConfigRaw, runtimeLandingRaw) => {
        const runtimeConfig = isPlainObject_(runtimeConfigRaw) ? runtimeConfigRaw : {};
        const payloadConfig = isPlainObject_(payloadConfigRaw) ? payloadConfigRaw : {};
        const landingConfig = isPlainObject_(landingConfigRaw) ? landingConfigRaw : {};
        const runtimeLanding = isPlainObject_(runtimeLandingRaw) ? runtimeLandingRaw : {};

        let merged = sanitizePublicProfileByTemplate_(PUBLIC_PROFILE_DEFAULTS, {});
        merged = sanitizePublicProfileByTemplate_(merged, payloadConfig.profile);
        merged = sanitizePublicProfileByTemplate_(merged, landingConfig.profile);
        merged = sanitizePublicProfileByTemplate_(merged, runtimeConfig.profile);
        merged = sanitizePublicProfileByTemplate_(merged, runtimeLanding.profile);
        return merged;
    };

    // Get public config from data.
    const getPublicConfigFromData = (dataRaw) => {
        const data = dataRaw && typeof dataRaw === "object" ? dataRaw : {};
        const configRoot = data.publicConfig && typeof data.publicConfig === "object" ? data.publicConfig : {};
        const landingConfig = configRoot.landing && typeof configRoot.landing === "object" ? configRoot.landing : {};
        const runtimeOverrides = readRuntimePublicConfigOverrides_();
        const runtimeLanding = runtimeOverrides.landing && typeof runtimeOverrides.landing === "object" ? runtimeOverrides.landing : {};
        const bannerMediaUrl = pickFirstHttpUrl(
            runtimeLanding.bannerMediaUrl,
            runtimeLanding.bannerUrl,
            runtimeLanding.bannerGifUrl,
            runtimeOverrides.bannerMediaUrl,
            runtimeOverrides.bannerUrl,
            runtimeOverrides.bannerGifUrl,
            landingConfig.bannerMediaUrl,
            landingConfig.bannerUrl,
            landingConfig.bannerGifUrl,
            configRoot.bannerMediaUrl,
            configRoot.bannerUrl,
            configRoot.bannerGifUrl,
            PUBLIC_LANDING_DEFAULTS.bannerMediaUrl
        );
        const squareMediaUrl = pickFirstHttpUrl(
            runtimeLanding.squareMediaUrl,
            runtimeLanding.squareUrl,
            runtimeLanding.squareGifUrl,
            runtimeOverrides.squareMediaUrl,
            runtimeOverrides.squareUrl,
            runtimeOverrides.squareGifUrl,
            landingConfig.squareMediaUrl,
            landingConfig.squareUrl,
            landingConfig.squareGifUrl,
            configRoot.squareMediaUrl,
            configRoot.squareUrl,
            configRoot.squareGifUrl,
            PUBLIC_LANDING_DEFAULTS.squareMediaUrl
        );
        const discordInviteUrl = normalizeHttpUrl(
            runtimeLanding.discordInviteUrl ||
            runtimeOverrides.discordInviteUrl ||
            landingConfig.discordInviteUrl ||
            configRoot.discordInviteUrl ||
            PUBLIC_LANDING_DEFAULTS.discordInviteUrl
        );
        const profile = buildResolvedPublicProfile_(runtimeOverrides, configRoot, landingConfig, runtimeLanding);
        return {
            bannerMediaUrl,
            squareMediaUrl,
            discordInviteUrl,
            profile,
        };
    };

    // Set discord link target.
    const setDiscordLinkTarget = (anchor, url) => {
        if (!anchor) return;
        if (!url) {
            anchor.removeAttribute("href");
            anchor.setAttribute("aria-disabled", "true");
            anchor.classList.add("is-disabled");
            return;
        }
        anchor.href = url;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.removeAttribute("aria-disabled");
        anchor.classList.remove("is-disabled");
    };

    // Apply discord links.
    const applyDiscordLinks = (urlRaw) => {
        const url = normalizeHttpUrl(urlRaw);
        setDiscordLinkTarget($("#openDiscordLink"), url);
        setDiscordLinkTarget($("#landingHeroDiscordCta"), url);
        setDiscordLinkTarget($("#landingBottomDiscordCta"), url);
    };

    // Set element text content when the target exists.
    const setElementTextIfPresent_ = (idRaw, textRaw) => {
        const id = toStr(idRaw).trim();
        if (!id) return;
        const node = $("#" + id);
        if (!node) return;
        const text = toStr(textRaw);
        if (node.textContent !== text) node.textContent = text;
    };

    // Apply resolved public profile copy to static DOM content.
    const applyLandingProfileCopy_ = (profileRaw) => {
        const profile = isPlainObject_(profileRaw) ? profileRaw : PUBLIC_PROFILE_DEFAULTS;
        const brand = isPlainObject_(profile.brand) ? profile.brand : {};
        const nav = isPlainObject_(profile.nav) ? profile.nav : {};
        const hero = isPlainObject_(profile.hero) ? profile.hero : {};
        const journey = isPlainObject_(profile.journey) ? profile.journey : {};
        const journeySteps = Array.isArray(journey.steps) ? journey.steps : [];
        const family = isPlainObject_(profile.family) ? profile.family : {};
        const war = isPlainObject_(profile.war) ? profile.war : {};
        const warHighlights = Array.isArray(war.highlights) ? war.highlights : [];
        const cwl = isPlainObject_(profile.cwl) ? profile.cwl : {};
        const cwlHighlights = Array.isArray(cwl.highlights) ? cwl.highlights : [];
        const network = isPlainObject_(profile.network) ? profile.network : {};
        const networkHighlights = Array.isArray(network.highlights) ? network.highlights : [];
        const proof = isPlainObject_(profile.proof) ? profile.proof : {};
        const finalCta = isPlainObject_(profile.finalCta) ? profile.finalCta : {};
        const finalSteps = Array.isArray(finalCta.steps) ? finalCta.steps : [];
        const media = isPlainObject_(profile.media) ? profile.media : {};

        setElementTextIfPresent_("publicBrandEyebrow", brand.eyebrow);
        setElementTextIfPresent_("openLandingViewBtn", nav.homeLabel);
        setElementTextIfPresent_("openRostersViewBtn", nav.rostersLabel);
        setElementTextIfPresent_("openLeaderboardViewBtn", nav.leaderboardLabel);
        setElementTextIfPresent_("openDiscordLink", nav.discordLabel);
        setElementTextIfPresent_("openAdminLink", nav.adminLabel);

        setElementTextIfPresent_("landingHeroEyebrow", hero.eyebrow);
        setElementTextIfPresent_("landingHeroTitle", hero.title);
        setElementTextIfPresent_("landingHeroBody", hero.body);
        setElementTextIfPresent_("landingHeroDiscordCta", hero.primaryCtaLabel);
        setElementTextIfPresent_("landingHeroRostersCta", hero.secondaryCtaLabel);
        setElementTextIfPresent_("landingRouteDiscordLabel", nav.discordLabel || hero.primaryCtaLabel);
        setElementTextIfPresent_("landingRouteMatchLabel", journeySteps[1] && journeySteps[1].title);
        setElementTextIfPresent_("landingRouteWarLabel", war.eyebrow);
        setElementTextIfPresent_("landingRouteCwlLabel", cwl.eyebrow);

        setElementTextIfPresent_("landingJourneyEyebrow", journey.eyebrow);
        setElementTextIfPresent_("landingJourneyTitle", journey.title);
        setElementTextIfPresent_("landingJourneyStep1Label", journeySteps[0] && journeySteps[0].label);
        setElementTextIfPresent_("landingJourneyStep1Title", journeySteps[0] && journeySteps[0].title);
        setElementTextIfPresent_("landingJourneyStep1Body", journeySteps[0] && journeySteps[0].body);
        setElementTextIfPresent_("landingJourneyStep2Label", journeySteps[1] && journeySteps[1].label);
        setElementTextIfPresent_("landingJourneyStep2Title", journeySteps[1] && journeySteps[1].title);
        setElementTextIfPresent_("landingJourneyStep2Body", journeySteps[1] && journeySteps[1].body);
        setElementTextIfPresent_("landingJourneyStep3Label", journeySteps[2] && journeySteps[2].label);
        setElementTextIfPresent_("landingJourneyStep3Title", journeySteps[2] && journeySteps[2].title);
        setElementTextIfPresent_("landingJourneyStep3Body", journeySteps[2] && journeySteps[2].body);

        setElementTextIfPresent_("landingFamilyEyebrow", family.eyebrow);
        setElementTextIfPresent_("landingFamilyTitle", family.title);

        setElementTextIfPresent_("landingWarEyebrow", war.eyebrow);
        setElementTextIfPresent_("landingWarTitle", war.title);
        setElementTextIfPresent_("landingWarBody", war.body);
        setElementTextIfPresent_("landingWarChip1Label", warHighlights[0] && warHighlights[0].label);
        setElementTextIfPresent_("landingWarChip1Value", warHighlights[0] && warHighlights[0].value);
        setElementTextIfPresent_("landingWarChip2Label", warHighlights[1] && warHighlights[1].label);
        setElementTextIfPresent_("landingWarChip2Value", warHighlights[1] && warHighlights[1].value);

        setElementTextIfPresent_("landingCwlEyebrow", cwl.eyebrow);
        setElementTextIfPresent_("landingCwlTitle", cwl.title);
        setElementTextIfPresent_("landingCwlBody", cwl.body);
        setElementTextIfPresent_("landingCwlChip1Label", cwlHighlights[0] && cwlHighlights[0].label);
        setElementTextIfPresent_("landingCwlChip1Value", cwlHighlights[0] && cwlHighlights[0].value);
        setElementTextIfPresent_("landingCwlChip2Label", cwlHighlights[1] && cwlHighlights[1].label);
        setElementTextIfPresent_("landingCwlChip2Value", cwlHighlights[1] && cwlHighlights[1].value);
        setElementTextIfPresent_("landingCwlChip3Label", cwlHighlights[2] && cwlHighlights[2].label);
        setElementTextIfPresent_("landingCwlChip3Value", cwlHighlights[2] && cwlHighlights[2].value);

        setElementTextIfPresent_("landingNetworkEyebrow", network.eyebrow);
        setElementTextIfPresent_("landingNetworkTitle", network.title);
        setElementTextIfPresent_("landingNetworkBody", network.body);
        setElementTextIfPresent_("landingNetworkChip1Label", networkHighlights[0] && networkHighlights[0].label);
        setElementTextIfPresent_("landingNetworkChip1Value", networkHighlights[0] && networkHighlights[0].value);
        setElementTextIfPresent_("landingNetworkChip2Label", networkHighlights[1] && networkHighlights[1].label);
        setElementTextIfPresent_("landingNetworkChip2Value", networkHighlights[1] && networkHighlights[1].value);
        setElementTextIfPresent_("landingNetworkChip3Label", networkHighlights[2] && networkHighlights[2].label);
        setElementTextIfPresent_("landingNetworkChip3Value", networkHighlights[2] && networkHighlights[2].value);

        setElementTextIfPresent_("landingProofEyebrow", proof.eyebrow);
        setElementTextIfPresent_("landingProofTitle", proof.title);
        setElementTextIfPresent_("landingProofBody", proof.body);

        setElementTextIfPresent_("landingFinalEyebrow", finalCta.eyebrow);
        setElementTextIfPresent_("landingFinalTitle", finalCta.title);
        setElementTextIfPresent_("landingFinalStep1", finalSteps[0]);
        setElementTextIfPresent_("landingFinalStep2", finalSteps[1]);
        setElementTextIfPresent_("landingFinalStep3", finalSteps[2]);
        setElementTextIfPresent_("landingBottomDiscordCta", finalCta.primaryCtaLabel);
        setElementTextIfPresent_("landingBottomLeaderboardCta", finalCta.secondaryCtaLabel);

        setElementTextIfPresent_("landingBannerPlaceholderText", media.bannerPlaceholderLabel);
        setElementTextIfPresent_("landingSquarePlaceholderText", media.squarePlaceholderLabel);
    };

    // Format family meta text by replacing known placeholders.
    const formatFamilyMetaText_ = (templateRaw, valuesRaw) => {
        const template = toStr(templateRaw).trim();
        const values = valuesRaw && typeof valuesRaw === "object" ? valuesRaw : {};
        if (!template) return "";
        return template
            .replace(/\{clanCount\}/g, toStr(values.clanCount))
            .replace(/\{playerCount\}/g, toStr(values.playerCount));
    };

    // Create a DOM element with optional class and text content.
    const el = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = String(text);
        return node;
    };

    // Remove all child nodes from a container.
    const clearNode = (node) => {
        if (!node) return node;
        while (node.firstChild) node.removeChild(node.firstChild);
        return node;
    };

    // Mark boot timing.
    const markBootTiming = (labelRaw, detailsRaw) => {
        const label = toStr(labelRaw).trim();
        if (!label) return;
        const markName = "roster.boot." + label;
        try {
            if (typeof performance !== "undefined" && performance && typeof performance.mark === "function") {
                performance.mark(markName);
            }
        } catch (err) {
            // Ignore timing API errors.
        }
        if (typeof console !== "undefined" && console && typeof console.debug === "function") {
            const details = detailsRaw && typeof detailsRaw === "object" ? detailsRaw : null;
            if (details && Object.keys(details).length) console.debug("[RosterBoot]", label, details);
            else console.debug("[RosterBoot]", label);
        }
    };

    // Handle measure boot timing.
    const measureBootTiming = (measureLabelRaw, startLabelRaw, endLabelRaw) => {
        const measureLabel = toStr(measureLabelRaw).trim();
        const startLabel = toStr(startLabelRaw).trim();
        const endLabel = toStr(endLabelRaw).trim();
        if (!measureLabel || !startLabel || !endLabel) return;
        try {
            if (typeof performance === "undefined" || !performance || typeof performance.measure !== "function") return;
            const measureName = "roster.boot.measure." + measureLabel;
            const startMark = "roster.boot." + startLabel;
            const endMark = "roster.boot." + endLabel;
            performance.measure(measureName, startMark, endMark);
            if (typeof console !== "undefined" && console && typeof console.debug === "function" && typeof performance.getEntriesByName === "function") {
                const entries = performance.getEntriesByName(measureName);
                if (entries && entries.length) {
                    const latest = entries[entries.length - 1];
                    if (latest && Number.isFinite(latest.duration)) {
                        console.debug("[RosterBoot]", measureLabel + " durationMs=", Math.round(latest.duration));
                    }
                }
            }
        } catch (err) {
            // Ignore timing API errors.
        }
    };

    // Handle escape HTML.
    const escapeHtml = (value) =>
        toStr(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");

    // Handle escape attr.
    const escapeAttr = (value) => escapeHtml(value).replace(/`/g, "&#96;");

    // Normalize clan tag.
    const normalizeClanTag = (tagRaw) => {
        const tag = toStr(tagRaw).trim().toUpperCase();
        if (!tag) return "";
        return tag.startsWith("#") ? tag : ("#" + tag);
    };

    // Get roster tracking mode.
    const getRosterTrackingMode = (rosterRaw) =>
        rosterRaw && rosterRaw.trackingMode === "regularWar" ? "regularWar" : "cwl";

    // Get roster CWL preparation model.
    const getRosterCwlPreparationModel = (rosterRaw) => {
        const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
        const raw = roster && roster.cwlPreparation && typeof roster.cwlPreparation === "object" && !Array.isArray(roster.cwlPreparation)
            ? roster.cwlPreparation
            : null;
        if (!raw) return null;
        const enabled = getRosterTrackingMode(roster) === "cwl" && raw.enabled === true;
        const rosterSizeRaw = Number(raw.rosterSize);
        const rosterSize = Number.isFinite(rosterSizeRaw)
            ? Math.max(5, Math.min(50, Math.floor(rosterSizeRaw / 5) * 5))
            : 0;
        const clanAbsentTagSet = {};
        const rawClanAbsentTagSet = raw.clanAbsentTagSet && typeof raw.clanAbsentTagSet === "object" && !Array.isArray(raw.clanAbsentTagSet)
            ? raw.clanAbsentTagSet
            : {};
        for (const rawTag of Object.keys(rawClanAbsentTagSet)) {
            const tag = normalizeClanTag(rawTag);
            if (tag && rawClanAbsentTagSet[rawTag] === true) clanAbsentTagSet[tag] = true;
        }
        return {
            enabled: enabled,
            rosterSize: rosterSize > 0 ? rosterSize : 0,
            clanAbsentTagSet: clanAbsentTagSet,
            clanAbsentUpdatedAt: enabled ? toStr(raw.clanAbsentUpdatedAt).trim() : "",
        };
    };

    // Return whether CWL preparation active public.
    const isCwlPreparationActivePublic_ = (rosterRaw) => {
        const prep = getRosterCwlPreparationModel(rosterRaw);
        return !!(prep && prep.enabled);
    };

    // Return whether a CWL-prep player was absent from the connected clan at last refresh.
    const isCwlPreparationPlayerClanAbsent_ = (rosterRaw, playerTagRaw) => {
        const tag = normalizeClanTag(playerTagRaw);
        if (!tag) return false;
        const prep = getRosterCwlPreparationModel(rosterRaw);
        return !!(prep && prep.enabled && prep.clanAbsentTagSet && prep.clanAbsentTagSet[tag]);
    };

    // Build default public view state.
    const buildDefaultPublicViewState = () => ({
        view: PUBLIC_VIEW_VALUES.landing,
        leaderboard: {
            seasonEventResultsMode: SEASON_EVENT_RESULT_MODE_VALUES.current,
        },
    });

    // Sanitize public view value.
    const sanitizePublicViewValue = (valueRaw) => {
        const value = toStr(valueRaw).trim().toLowerCase();
        if (!value) return PUBLIC_VIEW_VALUES.landing;
        if (value === PUBLIC_VIEW_VALUES.leaderboard) return PUBLIC_VIEW_VALUES.leaderboard;
        if (value === PUBLIC_VIEW_VALUES.landing) return PUBLIC_VIEW_VALUES.landing;
        return PUBLIC_VIEW_VALUES.rosters;
    };

    // Sanitize season event results mode.
    const sanitizeSeasonEventResultsMode = (valueRaw) => {
        const value = toStr(valueRaw).trim();
        if (value === SEASON_EVENT_RESULT_MODE_VALUES.previous) return SEASON_EVENT_RESULT_MODE_VALUES.previous;
        return SEASON_EVENT_RESULT_MODE_VALUES.current;
    };

    // Sanitize public view state.
    const sanitizePublicViewState = (stateRaw) => {
        const defaults = buildDefaultPublicViewState();
        const state = stateRaw && typeof stateRaw === "object" ? stateRaw : {};
        const leaderboard = state.leaderboard && typeof state.leaderboard === "object" ? state.leaderboard : {};
        return {
            view: sanitizePublicViewValue(state.view),
            leaderboard: {
                seasonEventResultsMode: sanitizeSeasonEventResultsMode(leaderboard.seasonEventResultsMode || defaults.leaderboard.seasonEventResultsMode),
            },
        };
    };

    // Handle read local storage JSON.
    const readLocalStorageJson = (key) => {
        if (!key || typeof window === "undefined" || !window.localStorage) return null;
        try {
            const raw = window.localStorage.getItem(key);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (err) {
            return null;
        }
    };

    // Handle write local storage JSON.
    const writeLocalStorageJson = (key, value) => {
        if (!key || typeof window === "undefined" || !window.localStorage) return false;
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (err) {
            // ignore quota/storage errors
            return false;
        }
    };

    // Handle remove local storage item.
    const removeLocalStorageItem = (key) => {
        if (!key || typeof window === "undefined" || !window.localStorage) return;
        try {
            window.localStorage.removeItem(key);
        } catch (err) {
            // ignore storage errors
        }
    };

    // Load public view state.
    const loadPublicViewState = () => sanitizePublicViewState(readLocalStorageJson(PUBLIC_VIEW_STORAGE_KEY));

    let publicViewState = loadPublicViewState();

    // Handle read public page query value.
    const readPublicPageQueryValue = () => {
        if (typeof window === "undefined" || !window.location) return "";
        const query = toStr(window.location.search).trim();
        if (!query) return "";
        try {
            const params = new URLSearchParams(query);
            if (params.has("rosters")) return PUBLIC_PAGE_QUERY_VALUES.rosters;
            return toStr(params.get("page")).trim().toLowerCase();
        } catch (err) {
            return "";
        }
    };

    // Parse a supported roster anchor from a URL hash.
    const parseRosterAnchorHash = (hashRaw) => {
        let value = toStr(hashRaw).trim().replace(/^#/, "");
        if (!value) return "";
        try {
            value = decodeURIComponent(value);
        } catch (err) {
            return "";
        }
        value = value.toLowerCase();
        if (!value.startsWith(ROSTER_ANCHOR_PREFIX)) return "";
        return /^roster-[a-z0-9][a-z0-9-]*$/.test(value) ? value : "";
    };

    // Read the current roster anchor from the browser URL.
    const readRosterAnchorHash = () => {
        if (typeof window === "undefined" || !window.location) return "";
        return parseRosterAnchorHash(window.location.hash);
    };

    // Resolve load time public view.
    const resolveLoadTimePublicView = () => {
        if (typeof window !== "undefined" && window && window.ROSTER_ADMIN_MODE) {
            return PUBLIC_VIEW_VALUES.rosters;
        }
        const pageQueryValue = readPublicPageQueryValue();
        const savedView = sanitizePublicViewValue(publicViewState && publicViewState.view);
        if (readRosterAnchorHash()) return PUBLIC_VIEW_VALUES.rosters;
        if (pageQueryValue === PUBLIC_PAGE_QUERY_VALUES.landing) return PUBLIC_VIEW_VALUES.landing;
        if (pageQueryValue === PUBLIC_PAGE_QUERY_VALUES.rosters) return PUBLIC_VIEW_VALUES.rosters;
        if (pageQueryValue === PUBLIC_PAGE_QUERY_VALUES.leaderboard) return PUBLIC_VIEW_VALUES.leaderboard;
        if (pageQueryValue === PUBLIC_PAGE_QUERY_VALUES.auto || !pageQueryValue) {
            return savedView || PUBLIC_VIEW_VALUES.landing;
        }
        return savedView || PUBLIC_VIEW_VALUES.landing;
    };

    // Handle persist public view state.
    const persistPublicViewState = () => {
        publicViewState = sanitizePublicViewState(publicViewState);
        writeLocalStorageJson(PUBLIC_VIEW_STORAGE_KEY, publicViewState);
    };

    // Apply load time public view selection.
    const applyLoadTimePublicViewSelection = () => {
        if (!publicViewState || typeof publicViewState !== "object") {
            publicViewState = buildDefaultPublicViewState();
        }
        publicViewState.view = resolveLoadTimePublicView();
        persistPublicViewState();
    };

    // Resolve deterministic Legend I ranked season cycle.
    const resolveLeaderboardRankedSeasonCycle = (dateRaw) => {
        const anchorMs = new Date(LEADERBOARD_RANKED_SEASON_ANCHOR_ISO).getTime();
        const nowMsRaw = dateRaw instanceof Date ? dateRaw.getTime() : new Date(dateRaw || Date.now()).getTime();
        const nowMs = Number.isFinite(nowMsRaw) ? nowMsRaw : Date.now();
        const cycleIndex = Math.floor((nowMs - anchorMs) / LEADERBOARD_RANKED_SEASON_CYCLE_MS);
        const startMs = anchorMs + cycleIndex * LEADERBOARD_RANKED_SEASON_CYCLE_MS;
        const endMs = startMs + LEADERBOARD_RANKED_SEASON_CYCLE_MS;
        return {
            seasonId: "ranked-legend-i-" + new Date(startMs).toISOString().slice(0, 10),
            startsAt: new Date(startMs).toISOString(),
            endsAt: new Date(endMs).toISOString(),
        };
    };

    // Resolve previous deterministic Legend I ranked season cycle.
    const resolvePreviousLeaderboardRankedSeasonCycle = (dateRaw) => {
        const current = resolveLeaderboardRankedSeasonCycle(dateRaw);
        return resolveLeaderboardRankedSeasonCycle(new Date(new Date(current.startsAt).getTime() - 1));
    };

    // Get public view buttons.
    const getPublicViewButtons = () => ({
        landing: $("#openLandingViewBtn"),
        rosters: $("#openRostersViewBtn"),
        leaderboard: $("#openLeaderboardViewBtn"),
    });

    // Get effective public view.
    const getEffectivePublicView = () => {
        if (typeof window !== "undefined" && window && window.ROSTER_ADMIN_MODE) {
            return PUBLIC_VIEW_VALUES.rosters;
        }
        return sanitizePublicViewValue(publicViewState && publicViewState.view);
    };

    // Sync public view buttons UI.
    const syncPublicViewButtonsUi = () => {
        const buttons = getPublicViewButtons();
        const activeView = getEffectivePublicView();
        if (buttons.landing) buttons.landing.classList.toggle("is-active", activeView === PUBLIC_VIEW_VALUES.landing);
        if (buttons.rosters) buttons.rosters.classList.toggle("is-active", activeView === PUBLIC_VIEW_VALUES.rosters);
        if (buttons.leaderboard) buttons.leaderboard.classList.toggle("is-active", activeView === PUBLIC_VIEW_VALUES.leaderboard);
    };

    // Get ordered rosters from data.
    const getOrderedRostersFromData = (dataRaw) => {
        const data = dataRaw && typeof dataRaw === "object" ? dataRaw : {};
        const rosters = Array.isArray(data.rosters) ? data.rosters : [];
        if (!rosters.length) return [];

        const rosterIndexesById = Object.create(null);
        for (let i = 0; i < rosters.length; i++) {
            const rosterId = toStr(rosters[i] && rosters[i].id).trim();
            if (!rosterId) continue;
            if (!rosterIndexesById[rosterId]) rosterIndexesById[rosterId] = [];
            rosterIndexesById[rosterId].push(i);
        }

        const consumedIndexes = Object.create(null);
        const ordered = [];
        // Push roster index.
        const pushRosterIndex = (index) => {
            if (!Number.isInteger(index) || consumedIndexes[index]) return;
            consumedIndexes[index] = true;
            ordered.push(rosters[index]);
        };

        const rosterOrder = Array.isArray(data.rosterOrder) ? data.rosterOrder : [];
        for (let i = 0; i < rosterOrder.length; i++) {
            const rosterId = toStr(rosterOrder[i]).trim();
            if (!rosterId) continue;
            const queue = rosterIndexesById[rosterId];
            if (!queue || !queue.length) continue;
            pushRosterIndex(queue.shift());
        }

        for (let i = 0; i < rosters.length; i++) {
            pushRosterIndex(i);
        }
        return ordered;
    };

    // Build roster order from rosters.
    const buildRosterOrderFromRosters = (rostersRaw) => {
        const rosters = Array.isArray(rostersRaw) ? rostersRaw : [];
        const order = [];
        const seen = Object.create(null);
        for (let i = 0; i < rosters.length; i++) {
            const rosterId = toStr(rosters[i] && rosters[i].id).trim();
            if (!rosterId || seen[rosterId]) continue;
            seen[rosterId] = true;
            order.push(rosterId);
        }
        return order;
    };

    // Convert a value to non negative int.
    const toNonNegativeInt = (value) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return 0;
        return Math.max(0, Math.floor(num));
    };

    // Convert a value to bool flag.
    const toBoolFlag = (value) => {
        if (value === true || value === false) return value;
        const text = toStr(value).trim().toLowerCase();
        if (!text) return false;
        return text === "true" || text === "1" || text === "yes" || text === "on";
    };

    // Handle clamp01.
    const clamp01 = (value) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return 0;
        return Math.max(0, Math.min(1, num));
    };

    // Handle clamp signed unit.
    const clampSignedUnit = (value) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return 0;
        return Math.max(-1, Math.min(1, num));
    };

    // Format a number with the shared locale formatter.
    const formatNumber = (value) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return "-";
        return numberFormatter.format(Math.round(num));
    };

    // Format a numeric value as a percentage.
    const formatPercent = (value, digits) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return "-";
        const pct = num <= 1 ? (num * 100) : num;
        const places = typeof digits === "number" ? digits : (pct >= 10 ? 0 : 1);
        return pct.toFixed(places) + "%";
    };

    // Format a number with a fixed decimal count.
    const formatFixed = (value, digits) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return "-";
        const places = typeof digits === "number" ? digits : 2;
        return num.toFixed(places);
    };

    // Handle title case.
    const titleCase = (value) => {
        const text = toStr(value).trim();
        if (!text) return "";
        return text
            .replace(/([a-z])([A-Z])/g, "$1 $2")
            .replace(/[_-]+/g, " ")
            .split(/\s+/)
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ");
    };

    // Format a roster role label for display.
    const formatRole = (value) => {
        const role = toStr(value).trim();
        if (!role) return "";
        if (role === "admin") return "Elder";
        if (role === "coLeader") return "Co-Leader";
        return titleCase(role);
    };

    // Format war state label.
    const formatWarStateLabel = (value) => {
        const state = toStr(value).trim().toLowerCase();
        if (!state) return "-";
        if (state === "notinwar") return "Not in war";
        if (state === "warended") return "War ended";
        if (state === "inwar") return "In war";
        if (state === "preparation") return "Preparation";
        return titleCase(state);
    };

    // Build placement label.
    const buildPlacementLabel = (ctx) => {
        if (!ctx || !ctx.player) return "-";
        const trackingMode = toStr(ctx.trackingMode).trim() === "regularWar" ? "regularWar" : "cwl";
        const role = toStr(ctx.role).trim().toLowerCase();
        if (trackingMode === "regularWar") {
            if (role === "main") return ctx.player.slot == null ? "In war" : ("In war #" + toStr(ctx.player.slot));
            if (role === "missing") return "Temporarily missing";
            return "Out of war";
        }
        if (role === "sub") return "Sub";
        return ctx.player.slot == null ? "Main" : ("Main #" + toStr(ctx.player.slot));
    };

    // Build long term war stats layer.
    const buildLongTermWarStatsLayer = (entryRaw) => {
        const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
        const warsInLineup = toNonNegativeInt(entry.warsInLineup);
        const resolvedWarDays = entry.resolvedWarDays != null
            ? toNonNegativeInt(entry.resolvedWarDays)
            : toNonNegativeInt(entry.daysInLineup);
        const daysInLineup = entry.daysInLineup != null
            ? toNonNegativeInt(entry.daysInLineup)
            : resolvedWarDays;
        const attacksMade = toNonNegativeInt(entry.attacksMade);
        const missedAttacks = entry.attacksMissed != null
            ? toNonNegativeInt(entry.attacksMissed)
            : toNonNegativeInt(entry.missedAttacks);
        const starsTotal = toNonNegativeInt(entry.starsTotal);
        const totalDestruction = toNonNegativeInt(entry.totalDestruction);
        const countedAttacks = toNonNegativeInt(entry.countedAttacks);
        const threeStarCount = toNonNegativeInt(entry.threeStarCount);
        const hitUpCount = toNonNegativeInt(entry.hitUpCount);
        const sameThHitCount = toNonNegativeInt(entry.sameThHitCount);
        const hitDownCount = toNonNegativeInt(entry.hitDownCount);
        return {
            warsInLineup: warsInLineup,
            daysInLineup: daysInLineup,
            resolvedWarDays: resolvedWarDays,
            participationCount: warsInLineup + resolvedWarDays,
            attacksMade: attacksMade,
            missedAttacks: missedAttacks,
            starsTotal: starsTotal,
            totalDestruction: totalDestruction,
            countedAttacks: countedAttacks,
            threeStarCount: threeStarCount,
            hitUpCount: hitUpCount,
            sameThHitCount: sameThHitCount,
            hitDownCount: hitDownCount,
            avgStarsPerAttack: countedAttacks > 0 ? (starsTotal / countedAttacks) : null,
            avgDestructionPerAttack: countedAttacks > 0 ? (totalDestruction / countedAttacks) : null,
        };
    };

    // Get war performance by tag.
    const getWarPerformanceByTag = (warPerformanceRaw) =>
        warPerformanceRaw && typeof warPerformanceRaw === "object" && warPerformanceRaw.byTag && typeof warPerformanceRaw.byTag === "object"
            ? warPerformanceRaw.byTag
            : {};

    // Get war performance player entry.
    const getWarPerformancePlayerEntry = (warPerformanceRaw, tagRaw) => {
        const tag = normalizeClanTag(tagRaw);
        const byTag = getWarPerformanceByTag(warPerformanceRaw);
        return tag && byTag[tag] && typeof byTag[tag] === "object" ? byTag[tag] : {};
    };

    // Get war performance meta.
    const getWarPerformanceMeta = (warPerformanceRaw) =>
        warPerformanceRaw && typeof warPerformanceRaw === "object" && warPerformanceRaw.meta && typeof warPerformanceRaw.meta === "object"
            ? warPerformanceRaw.meta
            : {};

    // Get player long term war stats.
    const getPlayerLongTermWarStats = (warPerformanceRaw, tagRaw) => {
        const entry = getWarPerformancePlayerEntry(warPerformanceRaw, tagRaw);
        const meta = getWarPerformanceMeta(warPerformanceRaw);
        const overall = buildLongTermWarStatsLayer(entry.overall);
        const regular = buildLongTermWarStatsLayer(entry.regular);
        const cwl = buildLongTermWarStatsLayer(entry.cwl);
        return {
            overall: overall,
            regular: regular,
            cwl: cwl,
            hasAnyHistory: overall.participationCount > 0 || overall.attacksMade > 0 || overall.countedAttacks > 0 || overall.starsTotal > 0,
            meta: {
                finalizedRegularWarCount: toNonNegativeInt(meta.finalizedRegularWarCount),
                finalizedCwlWarCount: toNonNegativeInt(meta.finalizedCwlWarCount),
                lastSuccessfulLongTermFinalizationAt: toStr(meta.lastSuccessfulLongTermFinalizationAt).trim(),
            },
        };
    };

    // Return any additive form-specific long-term buckets without changing the raw public stats layer.
    const getPlayerLongTermFormStats = (warPerformanceRaw, tagRaw) => {
        const entry = getWarPerformancePlayerEntry(warPerformanceRaw, tagRaw);
        return entry.formStats && typeof entry.formStats === "object" ? entry.formStats : null;
    };

    // Get player CWL stats.
    const getPlayerCwlStats = (cwlStatsRaw, tagRaw) => {
        const tag = normalizeClanTag(tagRaw);
        const byTag = cwlStatsRaw && typeof cwlStatsRaw === "object" && cwlStatsRaw.byTag && typeof cwlStatsRaw.byTag === "object"
            ? cwlStatsRaw.byTag
            : {};
        const entry = tag && byTag[tag] && typeof byTag[tag] === "object" ? byTag[tag] : {};

        const resolvedWarDays = entry.resolvedWarDays != null
            ? toNonNegativeInt(entry.resolvedWarDays)
            : toNonNegativeInt(entry.daysInLineup);
        const starsTotal = toNonNegativeInt(entry.starsTotal);
        const countedAttacks = toNonNegativeInt(entry.countedAttacks);
        const totalDestruction = toNonNegativeInt(entry.totalDestruction);
        const attackedDefenseDays = toNonNegativeInt(entry.attackedDefenseDays);
        const defenseStarsConceded = entry.defenseStarsConceded != null
            ? toNonNegativeInt(entry.defenseStarsConceded)
            : toNonNegativeInt(entry.bestStarsConceded);
        const bestStarsConceded = defenseStarsConceded;
        const bestDestructionConceded = toNonNegativeInt(entry.bestDestructionConceded);
        const possibleStars = 3 * resolvedWarDays;
        return {
            season: toStr(cwlStatsRaw && cwlStatsRaw.season).trim(),
            starsTotal: starsTotal,
            daysInLineup: resolvedWarDays,
            resolvedWarDays: resolvedWarDays,
            attacksMade: toNonNegativeInt(entry.attacksMade),
            missedAttacks: toNonNegativeInt(entry.missedAttacks),
            threeStarCount: toNonNegativeInt(entry.threeStarCount),
            totalDestruction: totalDestruction,
            countedAttacks: countedAttacks,
            currentWarAttackPending: Math.min(1, toNonNegativeInt(entry.currentWarAttackPending)),
            hitUpCount: toNonNegativeInt(entry.hitUpCount),
            sameThHitCount: toNonNegativeInt(entry.sameThHitCount),
            hitDownCount: toNonNegativeInt(entry.hitDownCount),
            defenseAttacksReceived: toNonNegativeInt(entry.defenseAttacksReceived),
            successfulDefensiveAttacks: toNonNegativeInt(entry.successfulDefensiveAttacks),
            attackedDefenseDays: attackedDefenseDays,
            defenseHolds: toNonNegativeInt(entry.defenseHolds),
            threeStarAttacksConceded: toNonNegativeInt(entry.threeStarAttacksConceded),
            defenseStarsConceded: defenseStarsConceded,
            bestStarsConceded: bestStarsConceded,
            bestDestructionConceded: bestDestructionConceded,
            unattackedDefenseDays: toNonNegativeInt(entry.unattackedDefenseDays),
            avgDefenseStarsConceded: attackedDefenseDays > 0 ? (defenseStarsConceded / attackedDefenseDays) : null,
            avgBestStarsConceded: attackedDefenseDays > 0 ? (bestStarsConceded / attackedDefenseDays) : null,
            avgBestDestructionConceded: attackedDefenseDays > 0 ? (bestDestructionConceded / attackedDefenseDays) : null,
            possibleStars,
            starsPerf: possibleStars > 0 ? (starsTotal / possibleStars) : null,
            avgDestruction: countedAttacks > 0 ? (totalDestruction / countedAttacks) : null,
            destructionPerf: resolvedWarDays > 0 ? (totalDestruction / (100 * resolvedWarDays)) : null,
        };
    };

    // Get player regular war stats.
    const getPlayerRegularWarStats = (regularWarRaw, tagRaw, warPerformanceRaw) => {
        const tag = normalizeClanTag(tagRaw);
        const regularWar = regularWarRaw && typeof regularWarRaw === "object" ? regularWarRaw : {};
        const byTag = regularWar.byTag && typeof regularWar.byTag === "object" ? regularWar.byTag : {};
        const aggregateMetaRaw = regularWar.aggregateMeta && typeof regularWar.aggregateMeta === "object"
            ? regularWar.aggregateMeta
            : {};
        const currentWarRaw = regularWar.currentWar && typeof regularWar.currentWar === "object"
            ? regularWar.currentWar
            : {};
        const entry = tag && byTag[tag] && typeof byTag[tag] === "object" ? byTag[tag] : {};
        const currentRaw = entry.current && typeof entry.current === "object" ? entry.current : {};
        const aggregateRaw = entry.aggregate && typeof entry.aggregate === "object" ? entry.aggregate : {};

        const perfMeta = getWarPerformanceMeta(warPerformanceRaw);
        const perfEntry = getWarPerformancePlayerEntry(warPerformanceRaw, tag);
        const perfRegular = perfEntry && perfEntry.regular ? perfEntry.regular : null;

        const currentAttacksAllowed = toNonNegativeInt(
            currentRaw.attacksAllowed != null ? currentRaw.attacksAllowed : currentWarRaw.attacksPerMember
        );
        const currentAttacksUsed = toNonNegativeInt(currentRaw.attacksUsed);
        const currentAttacksRemaining = currentRaw.attacksRemaining != null
            ? toNonNegativeInt(currentRaw.attacksRemaining)
            : Math.max(0, currentAttacksAllowed - currentAttacksUsed);
        const currentCountedAttacks = toNonNegativeInt(currentRaw.countedAttacks);
        const currentTotalDestruction = toNonNegativeInt(currentRaw.totalDestruction);

        const aggregateCountedAttacks = perfRegular ? toNonNegativeInt(perfRegular.countedAttacks) : toNonNegativeInt(aggregateRaw.countedAttacks);
        const aggregateTotalDestruction = perfRegular ? toNonNegativeInt(perfRegular.totalDestruction) : toNonNegativeInt(aggregateRaw.totalDestruction);

        const warsInLineup = perfRegular ? toNonNegativeInt(perfRegular.warsInLineup) : toNonNegativeInt(aggregateRaw.warsInLineup);
        const attacksMade = perfRegular ? toNonNegativeInt(perfRegular.attacksMade) : toNonNegativeInt(aggregateRaw.attacksMade);
        const attacksMissed = perfRegular ? toNonNegativeInt(perfRegular.attacksMissed) : toNonNegativeInt(aggregateRaw.attacksMissed);
        const starsTotal = perfRegular ? toNonNegativeInt(perfRegular.starsTotal) : toNonNegativeInt(aggregateRaw.starsTotal);
        const hitUpCount = perfRegular ? toNonNegativeInt(perfRegular.hitUpCount) : toNonNegativeInt(aggregateRaw.hitUpCount);
        const sameThHitCount = perfRegular ? toNonNegativeInt(perfRegular.sameThHitCount) : toNonNegativeInt(aggregateRaw.sameThHitCount);
        const hitDownCount = perfRegular ? toNonNegativeInt(perfRegular.hitDownCount) : toNonNegativeInt(aggregateRaw.hitDownCount);
        const aggregateThreeStars = perfRegular ? toNonNegativeInt(perfRegular.threeStarCount) : toNonNegativeInt(aggregateRaw.threeStarCount);
        const aggregateSource = perfRegular ? "warPerformance" : (toStr(aggregateMetaRaw.source).trim() || "legacy");
        const aggregateWarsTracked = toNonNegativeInt(
            perfMeta.finalizedRegularWarCount != null ? perfMeta.finalizedRegularWarCount : aggregateMetaRaw.warsTracked
        );
        const aggregateStatusLevelRaw = toStr(aggregateMetaRaw.statusLevel).trim().toLowerCase();
        const aggregateStatusLevel = aggregateStatusLevelRaw === "warning" || aggregateStatusLevelRaw === "info"
            ? aggregateStatusLevelRaw
            : "";
        const aggregateStatusMessage = aggregateStatusLevel === "warning"
            ? toStr(aggregateMetaRaw.statusMessage).trim()
            : "";
        const aggregateUnresolvedIncompleteWarCount = toNonNegativeInt(aggregateMetaRaw.unresolvedIncompleteWarCount);
        const aggregatePendingRecentRepairCount = toNonNegativeInt(aggregateMetaRaw.pendingRecentRepairCount);
        const aggregateStaleUnresolvedWarCount = toNonNegativeInt(aggregateMetaRaw.staleUnresolvedWarCount);

        return {
            lastRefreshedAt: toStr(regularWar.lastRefreshedAt).trim(),
            currentWarState: toStr(currentWarRaw.state).trim().toLowerCase() || "notinwar",
            currentWarUnavailableReason: toStr(currentWarRaw.unavailableReason).trim(),
            currentWarStatusMessage: toStr(currentWarRaw.statusMessage).trim(),
            aggregateUnavailableReason: toStr(aggregateMetaRaw.unavailableReason).trim(),
            aggregateStatusLevel: aggregateStatusLevel,
            aggregateStatusMessage: aggregateStatusMessage,
            teamSize: toNonNegativeInt(currentWarRaw.teamSize),
            attacksPerMember: toNonNegativeInt(currentWarRaw.attacksPerMember),
            current: {
                inWar: toBoolFlag(currentRaw.inWar),
                mapPosition: currentRaw.mapPosition == null ? null : toNonNegativeInt(currentRaw.mapPosition),
                townHallLevel: toNonNegativeInt(currentRaw.townHallLevel),
                attacksAllowed: currentAttacksAllowed,
                attacksUsed: currentAttacksUsed,
                attacksRemaining: currentAttacksRemaining,
                starsTotal: toNonNegativeInt(currentRaw.starsTotal),
                totalDestruction: currentTotalDestruction,
                countedAttacks: currentCountedAttacks,
                threeStarCount: toNonNegativeInt(currentRaw.threeStarCount),
                opponentAttacks: toNonNegativeInt(currentRaw.opponentAttacks),
                missedAttacks: toNonNegativeInt(currentRaw.missedAttacks),
                hitUpCount: toNonNegativeInt(currentRaw.hitUpCount),
                sameThHitCount: toNonNegativeInt(currentRaw.sameThHitCount),
                hitDownCount: toNonNegativeInt(currentRaw.hitDownCount),
                avgDestruction: currentCountedAttacks > 0 ? (currentTotalDestruction / currentCountedAttacks) : null,
            },
            aggregate: {
                warsInLineup: warsInLineup,
                attacksMade: attacksMade,
                attacksMissed: attacksMissed,
                starsTotal: starsTotal,
                totalDestruction: aggregateTotalDestruction,
                countedAttacks: aggregateCountedAttacks,
                threeStarCount: aggregateThreeStars,
                hitUpCount: hitUpCount,
                sameThHitCount: sameThHitCount,
                hitDownCount: hitDownCount,
                avgDestruction: aggregateCountedAttacks > 0 ? (aggregateTotalDestruction / aggregateCountedAttacks) : null,
            },
            aggregateMeta: {
                source: aggregateSource,
                warLogAvailable: toBoolFlag(aggregateMetaRaw.warLogAvailable),
                warsTracked: aggregateWarsTracked,
                unresolvedIncompleteWarCount: aggregateUnresolvedIncompleteWarCount,
                pendingRecentRepairCount: aggregatePendingRecentRepairCount,
                staleUnresolvedWarCount: aggregateStaleUnresolvedWarCount,
                lastRepairAttemptAt: toStr(aggregateMetaRaw.lastRepairAttemptAt).trim(),
                lastRepairSuccessAt: toStr(aggregateMetaRaw.lastRepairSuccessAt).trim(),
                statusLevel: aggregateStatusLevel,
            },
        };
    };

    // Get clan profile URL.
    const getClanProfileUrl = (tagRaw) => {
        const tag = normalizeClanTag(tagRaw);
        if (!tag) return "";
        return "https://link.clashofclans.com/en/?action=OpenClanProfile&tag=" + encodeURIComponent(tag);
    };

    // Get player profile URL.
    const getPlayerProfileUrl = (tagRaw) => {
        const tag = normalizeClanTag(tagRaw);
        if (!tag) return "";
        return "https://link.clashofclans.com/en/?action=OpenPlayerProfile&tag=" + encodeURIComponent(tag);
    };

    // Get player action builder.
    const getPlayerActionBuilder = () => {
        if (typeof window !== "undefined" && typeof window.ROSTER_PLAYER_ACTION_BUILDER === "function") {
            return window.ROSTER_PLAYER_ACTION_BUILDER;
        }
        return null;
    };

    // Get roster action builder.
    const getRosterActionBuilder = () => {
        if (typeof window !== "undefined" && typeof window.ROSTER_ROSTER_ACTION_BUILDER === "function") {
            return window.ROSTER_ROSTER_ACTION_BUILDER;
        }
        return null;
    };

    // Get admin password.
    const getAdminPassword = () => {
        if (typeof window !== "undefined" && typeof window.ROSTER_GET_ADMIN_PASSWORD === "function") {
            return toStr(window.ROSTER_GET_ADMIN_PASSWORD()).trim();
        }
        return "";
    };

    // Resolve public view sync copy.
    const resolvePublicViewSyncCopy = (viewRaw, modeRaw) => {
        const view = sanitizePublicViewValue(viewRaw);
        const mode = toStr(modeRaw).trim().toLowerCase() === "refresh" ? "refresh" : "loading";
        const defaults = PUBLIC_VIEW_SYNC_COPY[PUBLIC_VIEW_VALUES.landing] || {};
        const copy = PUBLIC_VIEW_SYNC_COPY[view] || defaults;
        if (mode === "refresh") {
            return {
                title: toStr(copy.refreshTitle).trim() || "Refreshing live data",
                text: toStr(copy.refreshText).trim() || "Showing the current snapshot while fresh data syncs.",
            };
        }
        return {
            title: toStr(copy.loadingTitle).trim() || "Loading live data",
            text: toStr(copy.loadingText).trim() || "Building the latest roster view.",
        };
    };

    // Resolve public view container.
    const resolvePublicViewContainer = (viewRaw) => {
        const view = sanitizePublicViewValue(viewRaw);
        if (view === PUBLIC_VIEW_VALUES.rosters) return $("#publicViewRosters");
        if (view === PUBLIC_VIEW_VALUES.leaderboard) return $("#publicViewLeaderboard");
        return $("#publicViewLanding");
    };

    // Hide all public-view sync chips.
    const hideAllPublicViewSyncChips = () => {
        const selectors = ["#publicViewLanding", "#publicViewRosters", "#publicViewLeaderboard"];
        for (let i = 0; i < selectors.length; i++) {
            const container = $(selectors[i]);
            if (!container || typeof container.querySelectorAll !== "function") continue;
            const chips = container.querySelectorAll(".public-view-sync-chip");
            if (!chips || !chips.length) continue;
            for (let j = 0; j < chips.length; j++) {
                const chip = chips[j];
                if (!chip || !chip.classList) continue;
                chip.classList.add("hidden");
                chip.setAttribute("aria-hidden", "true");
            }
        }
    };

    // Ensure public-view sync chip.
    const ensurePublicViewSyncChip = (viewRaw) => {
        const container = resolvePublicViewContainer(viewRaw);
        if (!container || typeof container.querySelector !== "function") return null;

        let chip = container.querySelector(".public-view-sync-chip");
        if (!chip) {
            chip = el("div", "public-view-sync-chip hidden");
            chip.setAttribute("aria-hidden", "true");
            chip.setAttribute("role", "status");
            chip.setAttribute("aria-live", "polite");

            const pulse = el("span", "public-view-sync-chip__pulse");
            pulse.setAttribute("aria-hidden", "true");

            const content = el("div", "public-view-sync-chip__content");
            const titleEl = el("div", "public-view-sync-chip__title");
            titleEl.setAttribute("data-public-view-sync-title", "1");
            const textEl = el("div", "public-view-sync-chip__text");
            textEl.setAttribute("data-public-view-sync-text", "1");

            content.appendChild(titleEl);
            content.appendChild(textEl);
            chip.appendChild(pulse);
            chip.appendChild(content);
            container.appendChild(chip);
        }

        const titleEl = chip.querySelector("[data-public-view-sync-title='1']");
        const textEl = chip.querySelector("[data-public-view-sync-text='1']");
        if (!titleEl || !textEl) return null;
        return { chip, titleEl, textEl };
    };

    // Show public-view sync chip.
    const showPublicViewSyncChip = (viewRaw, modeRaw) => {
        const view = sanitizePublicViewValue(viewRaw);
        hideAllPublicViewSyncChips();

        const refs = ensurePublicViewSyncChip(view);
        if (!refs) return;
        const copy = resolvePublicViewSyncCopy(view, modeRaw);
        refs.titleEl.textContent = copy.title;
        refs.textEl.textContent = copy.text;
        refs.chip.classList.remove("hidden");
        refs.chip.setAttribute("aria-hidden", "false");
    };

    // Handle show shell loading notice.
    const showShellLoadingNotice = (viewRaw) => {
        const view = sanitizePublicViewValue(viewRaw);
        const mode = lastRenderedData ? "refresh" : "loading";
        const copy = resolvePublicViewSyncCopy(view, mode);
        const notice = $("#shellLoadingNotice");
        const titleEl = $("#shellLoadingNoticeTitle");
        const textEl = $("#shellLoadingNoticeText");
        if (titleEl) titleEl.textContent = copy.title;
        if (textEl) textEl.textContent = copy.text;
        if (mode === "refresh") {
            if (notice) {
                notice.classList.add("hidden");
                notice.setAttribute("aria-hidden", "true");
            }
            showPublicViewSyncChip(view, mode);
            return;
        }

        hideAllPublicViewSyncChips();
        if (notice) {
            notice.classList.remove("hidden");
            notice.setAttribute("aria-hidden", "false");
        }
    };

    // Handle hide shell loading notice.
    const hideShellLoadingNotice = () => {
        const notice = $("#shellLoadingNotice");
        if (notice) {
            notice.classList.add("hidden");
            notice.setAttribute("aria-hidden", "true");
        }
        hideAllPublicViewSyncChips();
    };

    // Handle show error.
    const showError = (title, err) => {
        const card = $("#load-error");
        if (card) {
            card.classList.remove("hidden");
            card.style.whiteSpace = "pre-wrap";
            card.textContent =
                title +
                "\n\n" +
                ((err && (err.stack || err.message)) ? (err.stack || err.message) : String(err));
        }

        const loading = $("#loading");
        if (loading) loading.remove();
        hideShellLoadingNotice();
        const freshnessCard = $("#globalLastUpdated");
        if (freshnessCard) freshnessCard.classList.add("hidden");
        clearGlobalLastUpdatedTimer();
    };

    // Normalize player.
    const normalizePlayer = (p) => {
        const obj = p && typeof p === "object" ? p : {};
        const rawNotes = obj.notes != null ? obj.notes : obj.note;
        const notesRaw = Array.isArray(rawNotes) ? rawNotes : (rawNotes == null ? [] : [rawNotes]);
        const notes = notesRaw.map((n) => toStr(n).trim()).filter(Boolean);
        return {
            slot: obj.slot == null ? null : obj.slot,
            name: toStr(obj.name) || "(no name)",
            discord: toStr(obj.discord),
            th: obj.th == null ? "" : obj.th,
            tag: normalizeClanTag(obj.tag),
            notes,
            excludeAsSwapTarget: toBoolFlag(obj.excludeAsSwapTarget),
            excludeAsSwapSource: toBoolFlag(obj.excludeAsSwapSource),
        };
    };

    // Build roster player lookup by tag.
    const buildRosterPlayerByTag = (rosterRaw) => {
        const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
        const out = Object.create(null);
        const players = []
            .concat(Array.isArray(roster.main) ? roster.main : [])
            .concat(Array.isArray(roster.subs) ? roster.subs : [])
            .concat(Array.isArray(roster.missing) ? roster.missing : []);
        for (let i = 0; i < players.length; i++) {
            const player = players[i] && typeof players[i] === "object" ? players[i] : {};
            const tag = normalizeClanTag(player.tag);
            if (!tag || Object.prototype.hasOwnProperty.call(out, tag)) continue;
            out[tag] = player;
        }
        return out;
    };

    // Build roster public display model (projection-first without mutating canonical sections).
    const buildRosterPublicDisplayModel = (rosterRaw) => {
        const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
        const mainCanonical = Array.isArray(roster.main) ? roster.main : [];
        const subsCanonical = Array.isArray(roster.subs) ? roster.subs : [];
        const missingCanonical = Array.isArray(roster.missing) ? roster.missing : [];
        const canonicalByTag = buildRosterPlayerByTag(roster);
        const projection = roster.publicLineupProjection && typeof roster.publicLineupProjection === "object"
            ? roster.publicLineupProjection
            : null;
        const rosterTrackingMode = getRosterTrackingMode(roster);
        const projectionSource = toStr(projection && projection.source).trim();
        const projectionTrackingModeRaw = toStr(projection && projection.trackingMode).trim();
        const projectionTrackingMode = projectionTrackingModeRaw === "regularWar" || projectionTrackingModeRaw === "cwl"
            ? projectionTrackingModeRaw
            : rosterTrackingMode;
        const projectionSourceCompatible = rosterTrackingMode === "cwl"
            ? projectionSource !== "regularWarCurrentWar"
            : projectionSource !== "cwlCurrentWar" && projectionSource !== "cwlPreparation";
        const projectionCompatible = !!projection
            && projectionTrackingMode === rosterTrackingMode
            && projectionSourceCompatible
            && !(rosterTrackingMode === "cwl" && isCwlPreparationActivePublic_(roster));
        const projectionPlayersRaw = projectionCompatible && projection.active === true && Array.isArray(projection.players)
            ? projection.players
            : [];
        const projectionUpdatedAt = toStr(projection && projection.updatedAt).trim();
        const projectionHasMapPosition = projectionPlayersRaw.some((playerRaw) => {
            const mapPosition = Number(playerRaw && playerRaw.mapPosition);
            return Number.isFinite(mapPosition) && mapPosition > 0;
        });
        const projectionPlayersOrdered = projectionPlayersRaw.slice().sort((leftRaw, rightRaw) => {
            if (projectionHasMapPosition) {
                const leftMapPositionRaw = Number(leftRaw && leftRaw.mapPosition);
                const rightMapPositionRaw = Number(rightRaw && rightRaw.mapPosition);
                const leftMapPosition = Number.isFinite(leftMapPositionRaw) && leftMapPositionRaw > 0
                    ? Math.floor(leftMapPositionRaw)
                    : Number.MAX_SAFE_INTEGER;
                const rightMapPosition = Number.isFinite(rightMapPositionRaw) && rightMapPositionRaw > 0
                    ? Math.floor(rightMapPositionRaw)
                    : Number.MAX_SAFE_INTEGER;
                if (leftMapPosition !== rightMapPosition) return leftMapPosition - rightMapPosition;
            }
            const left = normalizePlayer(leftRaw);
            const right = normalizePlayer(rightRaw);
            const leftTh = toNonNegativeInt(left.th);
            const rightTh = toNonNegativeInt(right.th);
            if (leftTh !== rightTh) return rightTh - leftTh;
            return left.tag < right.tag ? -1 : left.tag > right.tag ? 1 : 0;
        });
        const activeTagSet = Object.create(null);

        // Merge canonical player metadata with projected live lineup metadata.
        const mergeProjectedPlayer = (projectedRaw) => {
            const projected = projectedRaw && typeof projectedRaw === "object" ? projectedRaw : {};
            const projectedTag = normalizeClanTag(projected.tag);
            if (!projectedTag) return null;
            const hasCanonicalPlayer = Object.prototype.hasOwnProperty.call(canonicalByTag, projectedTag);
            const canonicalSeed = hasCanonicalPlayer && canonicalByTag[projectedTag] && typeof canonicalByTag[projectedTag] === "object"
                ? canonicalByTag[projectedTag]
                : {};
            const merged = Object.assign({}, canonicalSeed, projected);
            merged.tag = projectedTag;
            const projectedThRaw = Number(projected.th);
            if (Number.isFinite(projectedThRaw) && projectedThRaw > 0) merged.th = Math.floor(projectedThRaw);
            const projectedMapPositionRaw = Number(projected.mapPosition);
            merged.mapPosition = Number.isFinite(projectedMapPositionRaw) && projectedMapPositionRaw > 0
                ? Math.floor(projectedMapPositionRaw)
                : null;
            merged.trackingMode = toStr(projected.trackingMode).trim() || projectionTrackingMode;
            merged.source = toStr(projected.source).trim() || projectionSource;
            merged.updatedAt = toStr(projected.updatedAt).trim() || projectionUpdatedAt;
            merged.synthetic = projected.synthetic === true || !Object.prototype.hasOwnProperty.call(canonicalByTag, projectedTag);
            merged.slot = null;

            // Public lineup projections are snapshots of live lineup order. For players
            // that still exist in the canonical roster, keep admin-owned profile
            // metadata canonical so a stale projection cannot hide later edits.
            if (hasCanonicalPlayer) {
                merged.discord = toStr(canonicalSeed.discord);
                merged.notes = canonicalSeed.notes != null ? canonicalSeed.notes : canonicalSeed.note;
                merged.excludeAsSwapTarget = toBoolFlag(canonicalSeed.excludeAsSwapTarget);
                merged.excludeAsSwapSource = toBoolFlag(canonicalSeed.excludeAsSwapSource);
            }
            return merged;
        };

        // Dedupe by player tag while preserving first-seen order.
        const dedupePlayersByTag = (playersRaw) => {
            const players = Array.isArray(playersRaw) ? playersRaw : [];
            const out = [];
            const seen = Object.create(null);
            for (let i = 0; i < players.length; i++) {
                const tag = normalizeClanTag(players[i] && players[i].tag);
                if (!tag || seen[tag]) continue;
                seen[tag] = true;
                out.push(players[i]);
            }
            return out;
        };

        const projectedMain = [];
        for (let i = 0; i < projectionPlayersOrdered.length; i++) {
            const mergedProjectedPlayer = mergeProjectedPlayer(projectionPlayersOrdered[i]);
            if (!mergedProjectedPlayer) continue;
            const tag = normalizeClanTag(mergedProjectedPlayer.tag);
            if (!tag || activeTagSet[tag]) continue;
            activeTagSet[tag] = true;
            projectedMain.push(mergedProjectedPlayer);
        }

        const displayMain = projectedMain.concat(
            mainCanonical.filter((playerRaw) => {
                const tag = normalizeClanTag(playerRaw && playerRaw.tag);
                return !tag || !activeTagSet[tag];
            }),
        );
        const displaySubs = subsCanonical.filter((playerRaw) => {
            const tag = normalizeClanTag(playerRaw && playerRaw.tag);
            return !tag || !activeTagSet[tag];
        });
        const displayMissing = missingCanonical.filter((playerRaw) => {
            const tag = normalizeClanTag(playerRaw && playerRaw.tag);
            return !tag || !activeTagSet[tag];
        });

        const main = dedupePlayersByTag(displayMain);
        const subs = dedupePlayersByTag(displaySubs);
        const missing = dedupePlayersByTag(displayMissing);
        return {
            main: main,
            subs: subs,
            missing: missing,
            activeTagSet: activeTagSet,
            badges: {
                main: main.length,
                subs: subs.length,
                missing: missing.length,
            },
        };
    };

    // Build roster display bundle for rendering/search.
    const buildRosterDisplayBundle = (rostersRaw, optionsRaw) => {
        const rosters = Array.isArray(rostersRaw) ? rostersRaw : [];
        const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
        const useProjection = options.useProjection !== false;
        const outRosters = [];
        const byRosterId = Object.create(null);
        for (let i = 0; i < rosters.length; i++) {
            const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
            const trackingMode = getRosterTrackingMode(roster);
            const model = useProjection
                ? buildRosterPublicDisplayModel(roster)
                : {
                    main: Array.isArray(roster.main) ? roster.main : [],
                    subs: Array.isArray(roster.subs) ? roster.subs : [],
                    missing: Array.isArray(roster.missing) ? roster.missing : [],
                    badges: {
                        main: Array.isArray(roster.main) ? roster.main.length : 0,
                        subs: Array.isArray(roster.subs) ? roster.subs.length : 0,
                        missing: Array.isArray(roster.missing) ? roster.missing.length : 0,
                    },
                };
            const nextRoster = Object.assign({}, roster, {
                trackingMode: trackingMode,
                main: model.main,
                subs: model.subs,
                missing: model.missing,
                badges: trackingMode === "regularWar"
                    ? { main: model.badges.main, subs: model.badges.subs, missing: model.badges.missing }
                    : { main: model.badges.main, subs: model.badges.subs },
            });
            outRosters.push(nextRoster);
            const rosterId = toStr(nextRoster && nextRoster.id).trim();
            if (rosterId) byRosterId[rosterId] = nextRoster;
        }
        return {
            rosters: outRosters,
            byRosterId: byRosterId,
        };
    };

    // Find roster player by tag.
    const findRosterPlayerByTag = (roster, tagRaw) => {
        const tag = normalizeClanTag(tagRaw);
        if (!tag) return null;
        const players = []
            .concat(Array.isArray(roster && roster.main) ? roster.main : [])
            .concat(Array.isArray(roster && roster.subs) ? roster.subs : [])
            .concat(Array.isArray(roster && roster.missing) ? roster.missing : []);
        for (let i = 0; i < players.length; i++) {
            const player = normalizePlayer(players[i]);
            if (player.tag === tag) return player;
        }
        return null;
    };

    // Get roster player label.
    const getRosterPlayerLabel = (roster, tagRaw) => {
        const tag = normalizeClanTag(tagRaw);
        if (!tag) return "";
        const player = findRosterPlayerByTag(roster, tag);
        const name = toStr(player && player.name).trim();
        return name || tag;
    };

    // Get roster bench suggestion model.
    const getRosterBenchSuggestionModel = (roster) => {
        if (getRosterTrackingMode(roster) !== "cwl") return null;
        if (isCwlPreparationActivePublic_(roster)) return null;
        const raw = roster && typeof roster === "object" && roster.benchSuggestions && typeof roster.benchSuggestions === "object"
            ? roster.benchSuggestions
            : null;
        if (!raw) return null;

        const benchByTag = Object.create(null);
        const swapInByTag = Object.create(null);
        const notesByTag = Object.create(null);
        const pairByTag = Object.create(null);
        const benchTags = [];
        const swapInTags = [];
        const pairs = [];
        const seenBenchTags = Object.create(null);
        const seenSwapInTags = Object.create(null);
        const seenPairs = Object.create(null);

        // Add bench tag.
        const addBenchTag = (tagRaw) => {
            const tag = normalizeClanTag(tagRaw);
            if (!tag || seenBenchTags[tag]) return "";
            seenBenchTags[tag] = true;
            benchByTag[tag] = true;
            benchTags.push(tag);
            return tag;
        };

        // Add swap in tag.
        const addSwapInTag = (tagRaw) => {
            const tag = normalizeClanTag(tagRaw);
            if (!tag || seenSwapInTags[tag]) return "";
            seenSwapInTags[tag] = true;
            swapInByTag[tag] = true;
            swapInTags.push(tag);
            return tag;
        };

        const rawPairs = Array.isArray(raw.pairs) ? raw.pairs : [];
        for (let i = 0; i < rawPairs.length; i++) {
            const pair = rawPairs[i] && typeof rawPairs[i] === "object" ? rawPairs[i] : {};
            const outTag = addBenchTag(pair.outTag);
            const inTag = addSwapInTag(pair.inTag);
            if (!outTag || !inTag) continue;
            const pairKey = outTag + "|" + inTag;
            if (seenPairs[pairKey]) continue;
            seenPairs[pairKey] = true;

            const reasonText = toStr(pair.reasonText).trim();
            const reasonCode = toStr(pair.reasonCode).trim();
            const outLabel = getRosterPlayerLabel(roster, outTag) || outTag;
            const inLabel = getRosterPlayerLabel(roster, inTag) || inTag;
            const outNote = "Suggested out for " + inLabel + (reasonText ? (": " + reasonText) : "");
            const inNote = "Suggested in for " + outLabel + (reasonText ? (": " + reasonText) : "");
            const normalizedPair = {
                outTag,
                inTag,
                outLabel,
                inLabel,
                reasonCode,
                reasonText,
            };

            notesByTag[outTag] = outNote;
            notesByTag[inTag] = inNote;
            pairByTag[outTag] = Object.assign({ status: "out", noteText: outNote }, normalizedPair);
            pairByTag[inTag] = Object.assign({ status: "in", noteText: inNote }, normalizedPair);
            pairs.push(normalizedPair);
        }

        const rawBenchTags = Array.isArray(raw.benchTags) ? raw.benchTags : [];
        for (let i = 0; i < rawBenchTags.length; i++) {
            const tag = addBenchTag(rawBenchTags[i]);
            if (!tag || notesByTag[tag]) continue;
            const noteText = "Suggested bench out";
            notesByTag[tag] = noteText;
            pairByTag[tag] = { status: "out", noteText };
        }

        const rawSwapInTags = Array.isArray(raw.swapInTags) ? raw.swapInTags : [];
        for (let i = 0; i < rawSwapInTags.length; i++) {
            const tag = addSwapInTag(rawSwapInTags[i]);
            if (!tag || notesByTag[tag]) continue;
            const noteText = "Suggested swap in";
            notesByTag[tag] = noteText;
            pairByTag[tag] = { status: "in", noteText };
        }

        const updatedAtRaw = toStr(raw.updatedAt).trim();
        const resultRaw = raw.result && typeof raw.result === "object" ? raw.result : {};
        const hasResultData = Object.keys(resultRaw).length > 0;
        if (!updatedAtRaw && !benchTags.length && !swapInTags.length && !pairs.length && !hasResultData) {
            return null;
        }

        return {
            updatedAtRaw,
            updatedAtLabel: updatedAtRaw ? formatProfileTimestamp(updatedAtRaw) : "",
            benchTags,
            swapInTags,
            pairs,
            benchByTag,
            swapInByTag,
            notesByTag,
            pairByTag,
            result: {
                benchCount: benchTags.length || toNonNegativeInt(resultRaw.benchCount),
                swapCount: pairs.length || toNonNegativeInt(resultRaw.swapCount),
                rosterPoolSize: toNonNegativeInt(resultRaw.rosterPoolSize),
                activeSlots: toNonNegativeInt(resultRaw.activeSlots),
                needsRewardsCount: toNonNegativeInt(resultRaw.needsRewardsCount),
            },
        };
    };

    // Get player bench suggestion.
    const getPlayerBenchSuggestion = (suggestionModel, tagRaw) => {
        const tag = normalizeClanTag(tagRaw);
        if (!tag || !suggestionModel) return null;
        const pair = suggestionModel.pairByTag && suggestionModel.pairByTag[tag] ? suggestionModel.pairByTag[tag] : null;
        const status = pair && pair.status
            ? pair.status
            : (suggestionModel.benchByTag && suggestionModel.benchByTag[tag]
                ? "out"
                : (suggestionModel.swapInByTag && suggestionModel.swapInByTag[tag] ? "in" : ""));
        if (!status && !(suggestionModel.notesByTag && suggestionModel.notesByTag[tag])) return null;

        return {
            status,
            statusLabel: status === "out" ? "Suggested out" : (status === "in" ? "Suggested in" : "Suggested"),
            noteText: toStr(pair && pair.noteText).trim() || toStr(suggestionModel.notesByTag && suggestionModel.notesByTag[tag]).trim(),
            pair: pair || null,
        };
    };

    // Find player context.
    const findPlayerContext = (tagRaw, rosterIdRaw) => {
        const tag = normalizeClanTag(tagRaw);
        const rosterId = toStr(rosterIdRaw).trim();
        const rosters = lastRenderedData && Array.isArray(lastRenderedData.rosters) ? lastRenderedData.rosters : [];
        const displayByRosterId = lastRenderedRosterDisplayById && typeof lastRenderedRosterDisplayById === "object"
            ? lastRenderedRosterDisplayById
            : Object.create(null);
        if (!tag || !rosters.length) return null;

        // Handle find canonical entry.
        const findCanonicalEntry = (roster) => {
            const sections = [
                { role: "main", players: Array.isArray(roster && roster.main) ? roster.main : [] },
                { role: "sub", players: Array.isArray(roster && roster.subs) ? roster.subs : [] },
                { role: "missing", players: Array.isArray(roster && roster.missing) ? roster.missing : [] },
            ];
            for (let s = 0; s < sections.length; s++) {
                const section = sections[s];
                const players = Array.isArray(section.players) ? section.players : [];
                for (let i = 0; i < players.length; i++) {
                    const player = normalizePlayer(players[i]);
                    if (normalizeClanTag(player.tag) !== tag) continue;
                    return {
                        role: section.role,
                        index: i,
                        rawPlayer: players[i],
                        player: player,
                    };
                }
            }
            return null;
        };

        // Handle scan roster.
        const scanRoster = (roster, displayRosterRaw) => {
            const displayRoster = displayRosterRaw && typeof displayRosterRaw === "object" ? displayRosterRaw : roster;
            const main = Array.isArray(displayRoster && displayRoster.main) ? displayRoster.main : [];
            const subs = Array.isArray(displayRoster && displayRoster.subs) ? displayRoster.subs : [];
            const missing = Array.isArray(displayRoster && displayRoster.missing) ? displayRoster.missing : [];
            const trackingMode = getRosterTrackingMode(roster);
            const suggestionModel = trackingMode === "cwl" ? getRosterBenchSuggestionModel(roster) : null;
            const sections = [
                { role: "main", players: main },
                { role: "sub", players: subs },
                { role: "missing", players: missing },
            ];

            for (let s = 0; s < sections.length; s++) {
                const section = sections[s];
                const players = Array.isArray(section.players) ? section.players : [];
                for (let i = 0; i < players.length; i++) {
                    const displayPlayer = normalizePlayer(players[i]);
                    if (normalizeClanTag(displayPlayer.tag) !== tag) continue;
                    const canonicalEntry = findCanonicalEntry(roster);
                    return {
                        rosterId: toStr(roster && roster.id).trim(),
                        rosterTitle: toStr(roster && roster.title).trim(),
                        trackingMode,
                        player: displayPlayer,
                        rawPlayer: players[i],
                        role: section.role,
                        index: i,
                        cwl: getPlayerCwlStats(roster && roster.cwlStats, tag),
                        regularWar: getPlayerRegularWarStats(roster && roster.regularWar, tag, roster && roster.warPerformance),
                        longTerm: getPlayerLongTermWarStats(roster && roster.warPerformance, tag),
                        warPerformance: roster && roster.warPerformance,
                        suggestionModel,
                        suggestion: trackingMode === "cwl" ? getPlayerBenchSuggestion(suggestionModel, tag) : null,
                        canonicalRole: canonicalEntry ? canonicalEntry.role : "",
                    };
                }
            }
            return null;
        };

        if (rosterId) {
            for (const roster of rosters) {
                if (toStr(roster && roster.id).trim() !== rosterId) continue;
                return scanRoster(roster, displayByRosterId[rosterId]);
            }
        }

        for (const roster of rosters) {
            const id = toStr(roster && roster.id).trim();
            const found = scanRoster(roster, displayByRosterId[id]);
            if (found) return found;
        }
        return null;
    };

    // Render a small profile chip label.
    const renderChip = (text, extraClass) =>
        '<span class="profile-chip' + (extraClass ? (" " + extraClass) : "") + '">' + escapeHtml(text) + "</span>";

    // Render a compact progress bar fragment.
    const renderProgress = (value, tone) =>
        '<div class="profile-progress' + (tone ? (" profile-progress--" + tone) : "") + '"><div class="profile-progress__fill" style="width:' +
        Math.round(clamp01(value) * 100) + '%"></div></div>';

    // Render stat card.
    const renderStatCard = (label, value, options) => {
        const opts = options && typeof options === "object" ? options : {};
        const valueText = toStr(value).trim() || "-";
        const isEmpty = valueText === "-" || valueText.toLowerCase() === "not set";
        return [
            '<div class="profile-stat-card',
            isEmpty ? " profile-stat-card--empty" : "",
            opts.alert ? " profile-stat-card--alert" : "",
            opts.success ? " profile-stat-card--success" : "",
            '">',
            '<div class="profile-stat-card__label">', escapeHtml(label), "</div>",
            '<div class="profile-stat-card__value">', escapeHtml(valueText), "</div>",
            opts.subText ? ('<div class="profile-stat-card__sub">' + escapeHtml(opts.subText) + "</div>") : "",
            opts.progress != null ? renderProgress(opts.progress, opts.alert ? "alert" : (opts.success ? "success" : "")) : "",
            "</div>",
        ].join("");
    };

    // Render long term stats cards.
    const renderLongTermStatsCards = (statsRaw, options) => {
        const stats = statsRaw && typeof statsRaw === "object" ? statsRaw : {};
        const opts = options && typeof options === "object" ? options : {};
        const avgStarsLabel = stats.avgStarsPerAttack != null ? (formatFixed(stats.avgStarsPerAttack, 2) + " stars/atk") : "-";
        const avgDestructionLabel = stats.avgDestructionPerAttack != null ? formatPercent(stats.avgDestructionPerAttack, 0) : "-";
        return [
            renderStatCard("Participations", formatNumber(opts.participationsValue), { subText: toStr(opts.participationsSubText).trim() || "" }),
            renderStatCard("Attacks made", formatNumber(stats.attacksMade)),
            renderStatCard("Missed attacks", formatNumber(stats.missedAttacks), { alert: stats.missedAttacks > 0 }),
            renderStatCard("Stars total", formatNumber(stats.starsTotal)),
            renderStatCard("Counted attacks", formatNumber(stats.countedAttacks)),
            renderStatCard("Avg stars per attack", avgStarsLabel),
            renderStatCard("Total destruction", formatNumber(stats.totalDestruction)),
            renderStatCard("Avg destruction per attack", avgDestructionLabel, { progress: stats.avgDestructionPerAttack != null ? (Number(stats.avgDestructionPerAttack) / 100) : null }),
            renderStatCard("Three-star attacks", formatNumber(stats.threeStarCount)),
            renderStatCard("Hit up", formatNumber(stats.hitUpCount)),
            renderStatCard("Same TH hits", formatNumber(stats.sameThHitCount)),
            renderStatCard("Hit down", formatNumber(stats.hitDownCount)),
        ].join("");
    };

    // Render meta card.
    const renderMetaCard = (label, value, options) => {
        const opts = options && typeof options === "object" ? options : {};
        const valueText = toStr(value).trim();
        const displayValue = valueText || toStr(opts.emptyText).trim() || "Not set";
        const isEmpty = !valueText || valueText === "-" || valueText.toLowerCase() === "not set";
        return [
            '<div class="profile-meta-card',
            isEmpty ? " profile-meta-card--empty" : "",
            opts.alert ? " profile-meta-card--alert" : "",
            '">',
            '<div class="profile-meta-card__label">', escapeHtml(label), "</div>",
            '<div class="profile-meta-card__value">', escapeHtml(displayValue), "</div>",
            opts.subText ? ('<div class="profile-meta-card__sub">' + escapeHtml(opts.subText) + "</div>") : "",
            "</div>",
        ].join("");
    };

    // Render summary item.
    const renderSummaryItem = (label, value, options) => {
        const opts = options && typeof options === "object" ? options : {};
        const valueText = toStr(value).trim();
        const displayValue = valueText || toStr(opts.emptyText).trim() || "-";
        return [
            '<span class="profile-summary-item',
            opts.tone ? (" profile-summary-item--" + opts.tone) : "",
            !valueText ? " is-empty" : "",
            '">',
            '<span class="profile-summary-item__label">', escapeHtml(label), "</span>",
            '<span class="profile-summary-item__value">', escapeHtml(displayValue), "</span>",
            opts.subText ? ('<span class="profile-summary-item__sub">' + escapeHtml(opts.subText) + "</span>") : "",
            "</span>",
        ].join("");
    };

    // Render hero snapshot item.
    const renderHeroSnapshotItem = (label, value, options) => {
        const opts = options && typeof options === "object" ? options : {};
        const valueText = toStr(value).trim();
        const displayValue = valueText || toStr(opts.emptyText).trim() || "-";
        return [
            '<div class="profile-hero-snapshot__item',
            opts.tone ? (" profile-hero-snapshot__item--" + opts.tone) : "",
            !valueText ? " is-empty" : "",
            '">',
            '<div class="profile-hero-snapshot__label">', escapeHtml(label), "</div>",
            '<div class="profile-hero-snapshot__value">', escapeHtml(displayValue), "</div>",
            opts.subText ? ('<div class="profile-hero-snapshot__sub">' + escapeHtml(opts.subText) + "</div>") : "",
            "</div>",
        ].join("");
    };

    // Render a profile notice fragment.
    const renderNotice = (label, text, tone) =>
        '<div class="profile-notice' + (tone ? (" profile-notice--" + tone) : "") + '"><div class="profile-notice__label">' +
        escapeHtml(label) + '</div><div class="profile-notice__text">' + escapeHtml(text) + "</div></div>";

    // Render compact topbar TH token.
    const renderCompactTopbarTownHallToken = (levelRaw) => {
        const level = toNonNegativeInt(levelRaw);
        const iconDataUrl = level > 0 && Object.prototype.hasOwnProperty.call(townHallIconCache, level)
            ? toStr(townHallIconCache[level]).trim()
            : "";
        if (iconDataUrl) {
            return '<span class="profile-modal__th-token"><img class="profile-modal__th-token-icon" src="' +
                escapeAttr(iconDataUrl) + '" alt="Town Hall ' + escapeAttr(String(level)) + '"></span>';
        }
        return '<span class="profile-modal__th-token profile-modal__th-token--fallback">TH' +
            escapeHtml(level > 0 ? String(level) : "?") + "</span>";
    };

    // Render compact topbar league token.
    const renderCompactTopbarLeagueToken = (badgeRaw) => {
        const badge = badgeRaw && typeof badgeRaw === "object" ? badgeRaw : {};
        const src = toStr(badge.src).trim() || getLeagueIconUrlFromFamily("unranked");
        const name = toStr(badge.name).trim() || "Unranked";
        const tierOverlayText = toStr(badge.tierOverlayText).trim();
        if (src) {
            return '<span class="profile-modal__league-token"><img class="profile-modal__league-icon" src="' +
                escapeAttr(src) + '" alt="' + escapeAttr(name) + '" loading="eager" decoding="async">' +
                (tierOverlayText
                    ? ('<span class="league-tier-overlay profile-modal__league-tier-overlay" aria-hidden="true">' +
                        escapeHtml(tierOverlayText) + "</span>")
                    : "") +
                "</span>";
        }
        return '<span class="profile-modal__league-fallback" aria-label="' + escapeAttr(name) + '">' +
            escapeHtml(name.slice(0, 3).toUpperCase() || "LG") + "</span>";
    };

    // Render compact topbar live status chip.
    const renderProfileTopbarStatusChip = (textRaw, toneRaw) => {
        const text = toStr(textRaw).trim() || "Status unavailable";
        const tone = toStr(toneRaw).trim().toLowerCase();
        const allowedTone = tone === "alert" || tone === "warning" || tone === "success" || tone === "info"
            ? tone
            : "neutral";
        return '<span class="profile-modal__status-chip profile-modal__status-chip--' + allowedTone + '">' +
            escapeHtml(text) + "</span>";
    };

    // Render compact topbar form badge.
    const renderProfileTopbarFormBadge = (formScoreRaw) => {
        const formScore = formScoreRaw && typeof formScoreRaw === "object" ? formScoreRaw : {};
        const toneRaw = toStr(formScore.tone).trim().toLowerCase();
        const tone = toneRaw === "low" || toneRaw === "fair" || toneRaw === "good" || toneRaw === "strong"
            ? toneRaw
            : "neutral";
        const valueText = toStr(formScore.valueText).trim() || "--";
        const ariaLabel = toStr(formScore.ariaLabel).trim() || "Form score unavailable";
        return '<span class="player-form-badge profile-modal__form-badge tone-' + tone + '" role="img" aria-label="' +
            escapeAttr(ariaLabel) + '"><span class="player-form-icon">Form</span><span class="player-form-value">' +
            escapeHtml(valueText) + "</span></span>";
    };

    // Build compact live status meta for topbar.
    const buildProfileTopbarLiveStatusMeta = (trackingModeRaw, roleRaw, regularWarRaw, cwlRaw) => {
        const trackingMode = toStr(trackingModeRaw).trim() === "regularWar" ? "regularWar" : "cwl";
        const role = toStr(roleRaw).trim().toLowerCase();
        const regularWar = regularWarRaw && typeof regularWarRaw === "object" ? regularWarRaw : {};
        const cwl = cwlRaw && typeof cwlRaw === "object" ? cwlRaw : {};
        if (trackingMode === "regularWar") {
            const state = toStr(regularWar.currentWarState).trim().toLowerCase();
            const attacksRemaining = toNonNegativeInt(regularWar.current && regularWar.current.attacksRemaining);
            const missedAttacks = toNonNegativeInt(regularWar.current && regularWar.current.missedAttacks);
            if (regularWar.currentWarUnavailableReason === "privateWarLog") {
                return { text: "Live war log private", tone: "warning" };
            }
            if (state === "inwar" && attacksRemaining > 0) {
                return {
                    text: "In war • " + attacksRemaining + " " + pluralize(attacksRemaining, "attack", "attacks") + " left",
                    tone: "alert",
                };
            }
            if (state === "inwar") return { text: "In war • attacks done", tone: "success" };
            if (state === "preparation") return { text: "Preparation day", tone: "info" };
            if (state === "warended" && missedAttacks > 0) return { text: "War ended • missed attacks", tone: "alert" };
            if (state === "warended") return { text: "War ended", tone: "info" };
            if (role === "main") return { text: "In regular rotation", tone: "success" };
            if (role === "missing") return { text: "Temporarily missing", tone: "warning" };
            return { text: "Out of war", tone: "neutral" };
        }

        if (cwl.currentWarAttackPending >= 1) return { text: "CWL • attack pending", tone: "alert" };
        if (toNonNegativeInt(cwl.missedAttacks) > 0) return { text: "CWL • missed attacks", tone: "alert" };
        if (toNonNegativeInt(cwl.possibleStars) > 0 && toNonNegativeInt(cwl.starsTotal) < 8) return { text: "CWL • below 8-star target", tone: "warning" };
        if (toNonNegativeInt(cwl.starsTotal) >= 8) return { text: "CWL • reward target met", tone: "success" };
        return { text: "CWL • in progress", tone: "info" };
    };

    // Render sticky profile modal topbar values.
    const renderProfileModalTopbar = (optionsRaw) => {
        const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
        const name = toStr(options.name).trim() || "Player profile";
        const tag = toStr(options.tag).trim() || "-";
        const townHallLevel = toNonNegativeInt(options.townHallLevel);
        const leagueBadge = options.leagueBadge && typeof options.leagueBadge === "object" ? options.leagueBadge : null;
        const liveStatus = options.liveStatus && typeof options.liveStatus === "object" ? options.liveStatus : {};

        if (profileState.titleEl) profileState.titleEl.textContent = name;
        if (profileState.subtitleEl) profileState.subtitleEl.textContent = tag;
        if (profileState.topbarLeagueEl) profileState.topbarLeagueEl.innerHTML = renderCompactTopbarLeagueToken(leagueBadge);
        if (profileState.topbarThEl) profileState.topbarThEl.innerHTML = renderCompactTopbarTownHallToken(townHallLevel);
        if (profileState.topbarStatusEl) {
            profileState.topbarStatusEl.innerHTML = renderProfileTopbarStatusChip(liveStatus.text, liveStatus.tone);
        }
        if (profileState.topbarFormEl) {
            profileState.topbarFormEl.innerHTML = renderProfileTopbarFormBadge(options.formScore);
        }
    };

    // Format signed number.
    const formatSignedNumber = (valueRaw) => {
        const value = Number(valueRaw);
        if (!Number.isFinite(value)) return "-";
        if (value === 0) return "0";
        return (value > 0 ? "+" : "") + formatNumber(Math.abs(value));
    };

    const LEGEND_WINDOW_OPTIONS = [7, 14, 30];
    const LEGEND_EMPTY_STATE_TEXT = "Not enough local history yet, tracking just started recently.";

    // Return whether valid day key.
    const isValidDayKey = (valueRaw) => /^\d{4}-\d{2}-\d{2}$/.test(toStr(valueRaw).trim());

    // Parse time ms.
    const parseTimeMs = (valueRaw) => {
        const value = toStr(valueRaw).trim();
        if (!value) return 0;
        const ms = new Date(value).getTime();
        return Number.isFinite(ms) ? ms : 0;
    };

    // Parse day key ms.
    const parseDayKeyMs = (dayKeyRaw) => {
        const dayKey = toStr(dayKeyRaw).trim();
        if (!isValidDayKey(dayKey)) return 0;
        const ms = new Date(dayKey + "T00:00:00Z").getTime();
        return Number.isFinite(ms) ? ms : 0;
    };

    // Get player metrics entry.
    const getPlayerMetricsEntry = (tagRaw, dataRaw) => {
        const tag = normalizeClanTag(tagRaw);
        if (!tag) return null;
        const bareTag = tag.charAt(0) === "#" ? tag.slice(1) : tag;
        const data = dataRaw && typeof dataRaw === "object" ? dataRaw : null;
        const metrics = data && data.playerMetrics && typeof data.playerMetrics === "object" ? data.playerMetrics : null;
        const byTag = metrics && metrics.byTag && typeof metrics.byTag === "object" ? metrics.byTag : null;
        if (!byTag) return null;

        const candidateKeys = [tag, bareTag, tag.toUpperCase(), bareTag.toUpperCase()];
        for (let i = 0; i < candidateKeys.length; i++) {
            const key = candidateKeys[i];
            const candidate = byTag[key];
            if (candidate && typeof candidate === "object") return candidate;
        }

        const keys = Object.keys(byTag);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (normalizeClanTag(key) === tag) {
                const candidate = byTag[key];
                if (candidate && typeof candidate === "object") return candidate;
            }
        }

        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const candidate = byTag[key] && typeof byTag[key] === "object" ? byTag[key] : null;
            const identityTag = normalizeClanTag(candidate && candidate.identity && candidate.identity.tag);
            if (identityTag && identityTag === tag) return candidate;
        }

        return null;
    };

    // Resolve display Discord from canonical metrics identity, falling back to roster cache.
    const getDisplayDiscordUsernameForPlayer = (playerRaw, dataRaw) => {
        const player = playerRaw && typeof playerRaw === "object" ? playerRaw : {};
        const tag = normalizeClanTag(player.tag);
        const metricsEntry = tag ? getPlayerMetricsEntry(tag, dataRaw) : null;
        const identity = metricsEntry && metricsEntry.identity && typeof metricsEntry.identity === "object"
            ? metricsEntry.identity
            : null;
        const canonicalUsername = toStr(identity && identity.discordUsername).trim();
        return canonicalUsername || toStr(player.discord).trim();
    };

    // Normalize local history points.
    const normalizeLocalHistoryPoints = (historyRaw, latestSnapshotRaw) => {
        const pointsByDay = Object.create(null);
        const history = Array.isArray(historyRaw) ? historyRaw : [];

        // Push point.
        const pushPoint = (rawPoint) => {
            const point = rawPoint && typeof rawPoint === "object" ? rawPoint : {};
            const trophiesRaw = point.trophies != null ? point.trophies : point.trophyCount;
            const trophies = toNonNegativeInt(trophiesRaw);
            const capturedMs = parseTimeMs(point.capturedAt || point.at || point.timestamp);
            let dayKey = toStr(point.dayKey || point.day || point.date).trim();
            if (!isValidDayKey(dayKey) && capturedMs > 0) {
                dayKey = new Date(capturedMs).toISOString().slice(0, 10);
            }
            if (!isValidDayKey(dayKey)) return;
            const dayMs = parseDayKeyMs(dayKey);
            if (!dayMs) return;
            const ms = capturedMs > 0 ? capturedMs : (dayMs + 12 * 60 * 60 * 1000);
            const normalized = {
                dayKey: dayKey,
                dayMs: dayMs,
                ms: ms,
                trophies: trophies,
                capturedAt: capturedMs > 0 ? new Date(capturedMs).toISOString() : "",
                clanTag: normalizeClanTag(point.clanTag),
                leagueName: toStr(point.league && point.league.name).trim(),
            };
            const existing = pointsByDay[dayKey];
            if (!existing || normalized.ms >= existing.ms) {
                pointsByDay[dayKey] = normalized;
            }
        };

        for (let i = 0; i < history.length; i++) {
            pushPoint(history[i]);
        }

        const latestSnapshot = latestSnapshotRaw && typeof latestSnapshotRaw === "object" ? latestSnapshotRaw : null;
        if (latestSnapshot && latestSnapshot.trophies != null) {
            const latestCapturedMs = parseTimeMs(latestSnapshot.capturedAt || latestSnapshot.at || latestSnapshot.timestamp);
            pushPoint({
                dayKey: latestSnapshot.dayKey || (latestCapturedMs > 0 ? new Date(latestCapturedMs).toISOString().slice(0, 10) : ""),
                capturedAt: latestSnapshot.capturedAt,
                trophies: latestSnapshot.trophies,
                clanTag: latestSnapshot.clanTag,
                league: latestSnapshot.league,
            });
        }

        return Object.keys(pointsByDay)
            .sort()
            .map((dayKey) => pointsByDay[dayKey]);
    };

    // Get local trophy history for tag.
    const getLocalTrophyHistoryForTag = (tagRaw, dataRaw) => {
        const entry = getPlayerMetricsEntry(tagRaw, dataRaw);
        if (!entry) return [];
        const history = Array.isArray(entry.trophyHistoryDaily) ? entry.trophyHistoryDaily : [];
        const latestSnapshot = entry.latestSnapshot && typeof entry.latestSnapshot === "object"
            ? entry.latestSnapshot
            : null;
        return normalizeLocalHistoryPoints(history, latestSnapshot);
    };

    // Get legend window coverage.
    const getLegendWindowCoverage = (pointsRaw, windowDaysRaw) => {
        const points = Array.isArray(pointsRaw) ? pointsRaw : [];
        const windowDays = Math.max(1, toNonNegativeInt(windowDaysRaw));
        if (!points.length) {
            return { windowDays: windowDays, supported: false, latestDayMs: 0, cutoffDayMs: 0 };
        }
        const latestPoint = points[points.length - 1];
        const latestDayMs = Number.isFinite(latestPoint && latestPoint.dayMs) ? latestPoint.dayMs : 0;
        if (!latestDayMs) {
            return { windowDays: windowDays, supported: false, latestDayMs: 0, cutoffDayMs: 0 };
        }
        const cutoffDayMs = latestDayMs - (windowDays - 1) * DAY_MS;
        const supported = points.some((point) => Number.isFinite(point && point.dayMs) && point.dayMs <= cutoffDayMs);
        return {
            windowDays: windowDays,
            supported: supported,
            latestDayMs: latestDayMs,
            cutoffDayMs: cutoffDayMs,
        };
    };

    // Get legend window availability.
    const getLegendWindowAvailability = (pointsRaw) =>
        LEGEND_WINDOW_OPTIONS.map((days) => {
            const coverage = getLegendWindowCoverage(pointsRaw, days);
            return {
                days: days,
                supported: coverage.supported,
            };
        });

    // Get legend default window days.
    const getLegendDefaultWindowDays = (pointsRaw) =>
        getLegendWindowCoverage(pointsRaw, 30).supported ? 30 : 0;

    // Get legend trend points.
    const getLegendTrendPoints = (pointsRaw, windowDaysRaw) => {
        const points = Array.isArray(pointsRaw) ? pointsRaw : [];
        const windowDays = toNonNegativeInt(windowDaysRaw);
        if (!points.length) return [];
        if (windowDays < 1) return points.slice();
        const coverage = getLegendWindowCoverage(points, windowDays);
        if (!coverage.supported) return points.slice();
        return points.filter((point) => Number.isFinite(point && point.dayMs) && point.dayMs >= coverage.cutoffDayMs);
    };

    // Compute legend delta.
    const computeLegendDelta = (pointsRaw, selectedIndexRaw) => {
        const points = Array.isArray(pointsRaw) ? pointsRaw : [];
        const selectedIndex = Math.max(0, Math.min(points.length - 1, toNonNegativeInt(selectedIndexRaw)));
        if (selectedIndex <= 0 || !points[selectedIndex] || !points[selectedIndex - 1]) {
            return { available: false };
        }
        const delta = toNonNegativeInt(points[selectedIndex].trophies) - toNonNegativeInt(points[selectedIndex - 1].trophies);
        return {
            available: true,
            delta: delta,
        };
    };

    // Format a legend point day label.
    const formatLegendPointDayLabel = (pointRaw) => {
        const point = pointRaw && typeof pointRaw === "object" ? pointRaw : {};
        const dayKey = toStr(point.dayKey).trim();
        const capturedAt = toStr(point.capturedAt).trim();
        if (capturedAt) {
            const capturedDate = new Date(capturedAt);
            if (Number.isFinite(capturedDate.getTime())) return capturedDate.toLocaleDateString();
        }
        if (dayKey && /^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
            const dayDate = new Date(dayKey + "T00:00:00Z");
            if (Number.isFinite(dayDate.getTime())) return dayDate.toLocaleDateString();
        }
        return dayKey || "-";
    };

    // Render legend trend sparkline.
    const renderLegendTrendSparkline = (pointsRaw) => {
        const points = Array.isArray(pointsRaw) ? pointsRaw : [];
        if (points.length < 2) {
            return {
                hasData: false,
                points: [],
                chartPoints: [],
                selectedIndex: 0,
                width: 0,
                html: '<div class="profile-legend-trend__empty">' + escapeHtml(LEGEND_EMPTY_STATE_TEXT) + "</div>",
            };
        }

        const width = 372;
        const height = 164;
        const padX = 12;
        const padY = 14;
        const padBottom = 22;
        const innerWidth = width - padX * 2;
        const innerHeight = height - padY - padBottom;

        const minX = points[0].dayMs;
        const maxX = points[points.length - 1].dayMs;
        const xRange = Math.max(1, maxX - minX);

        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (let i = 0; i < points.length; i++) {
            const trophies = toNonNegativeInt(points[i] && points[i].trophies);
            if (trophies < minY) minY = trophies;
            if (trophies > maxY) maxY = trophies;
        }
        if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
            return {
                hasData: false,
                points: [],
                chartPoints: [],
                selectedIndex: 0,
                width: 0,
                html: '<div class="profile-legend-trend__empty">' + escapeHtml(LEGEND_EMPTY_STATE_TEXT) + "</div>",
            };
        }
        if (minY === maxY) {
            minY -= 10;
            maxY += 10;
        }
        const yRange = Math.max(1, maxY - minY);
        const chartPoints = points.map((point) => {
            const x = padX + ((point.dayMs - minX) / xRange) * innerWidth;
            const y = padY + ((maxY - toNonNegativeInt(point.trophies)) / yRange) * innerHeight;
            return {
                x: x,
                y: y,
                dayKey: point.dayKey,
                capturedAt: point.capturedAt,
                trophies: toNonNegativeInt(point.trophies),
            };
        });

        const linePath = chartPoints
            .map((point, index) => (index === 0 ? "M" : "L") + point.x.toFixed(2) + " " + point.y.toFixed(2))
            .join(" ");
        const firstPoint = chartPoints[0];
        const lastPoint = chartPoints[chartPoints.length - 1];
        const baselineY = padY + innerHeight;
        const areaPath = [
            "M", firstPoint.x.toFixed(2), baselineY.toFixed(2),
            "L", firstPoint.x.toFixed(2), firstPoint.y.toFixed(2),
            linePath.slice(1),
            "L", lastPoint.x.toFixed(2), baselineY.toFixed(2),
            "Z",
        ].join(" ");
        const selectedIndex = chartPoints.length - 1;
        const selectedPoint = chartPoints[selectedIndex];
        const selectedDelta = computeLegendDelta(points, selectedIndex);
        const selectedDayText = formatLegendPointDayLabel(points[selectedIndex]);
        const tooltipLeftPct = Math.max(8, Math.min(92, (selectedPoint.x / width) * 100));
        const deltaText = selectedDelta.available ? formatSignedNumber(selectedDelta.delta) : "\u2013";

        const grid1 = padY + innerHeight * 0.25;
        const grid2 = padY + innerHeight * 0.5;
        const grid3 = padY + innerHeight * 0.75;
        const startDay = points[0].dayKey || "";
        const endDay = points[points.length - 1].dayKey || "";

        return {
            hasData: true,
            points: points,
            chartPoints: chartPoints,
            selectedIndex: selectedIndex,
            width: width,
            html: [
                '<div class="profile-legend-trend__chart-shell">',
                '<div class="profile-legend-trend__chart-wrap">',
                '<svg class="profile-legend-trend__svg" viewBox="0 0 ', width, " ", height, '" role="img" aria-label="Legends Journey trophy trend">',
                '<line class="profile-legend-trend__grid" x1="', padX, '" y1="', grid1.toFixed(2), '" x2="', (padX + innerWidth), '" y2="', grid1.toFixed(2), '"></line>',
                '<line class="profile-legend-trend__grid" x1="', padX, '" y1="', grid2.toFixed(2), '" x2="', (padX + innerWidth), '" y2="', grid2.toFixed(2), '"></line>',
                '<line class="profile-legend-trend__grid" x1="', padX, '" y1="', grid3.toFixed(2), '" x2="', (padX + innerWidth), '" y2="', grid3.toFixed(2), '"></line>',
                '<path class="profile-legend-trend__area" d="', areaPath, '"></path>',
                '<path class="profile-legend-trend__line" d="', linePath, '"></path>',
                '<line class="profile-legend-trend__cursor-line" data-legend-cursor-line="1" x1="', selectedPoint.x.toFixed(2), '" y1="', padY.toFixed(2), '" x2="', selectedPoint.x.toFixed(2), '" y2="', baselineY.toFixed(2), '"></line>',
                '<circle class="profile-legend-trend__cursor-dot" data-legend-cursor-dot="1" cx="', selectedPoint.x.toFixed(2), '" cy="', selectedPoint.y.toFixed(2), '" r="4.4"></circle>',
                '<rect class="profile-legend-trend__hitbox" data-legend-hitbox="1" x="0" y="0" width="', width, '" height="', height, '" fill="transparent"></rect>',
                "</svg>",
                '<div class="profile-legend-trend__axis"><span>', escapeHtml(startDay), '</span><span>', escapeHtml(endDay), "</span></div>",
                '<div class="profile-legend-tooltip" data-legend-tooltip="1" style="left:', tooltipLeftPct.toFixed(2), '%;">',
                '<div class="profile-legend-tooltip__row"><span class="profile-legend-tooltip__label">Day</span><span class="profile-legend-tooltip__value" data-legend-day="1">', escapeHtml(selectedDayText), "</span></div>",
                '<div class="profile-legend-tooltip__row"><span class="profile-legend-tooltip__label">Final</span><span class="profile-legend-tooltip__value" data-legend-final="1">', escapeHtml(formatNumber(selectedPoint.trophies)), "</span></div>",
                '<div class="profile-legend-tooltip__row"><span class="profile-legend-tooltip__label">&#177; Delta</span><span class="profile-legend-tooltip__value" data-legend-delta="1">', escapeHtml(deltaText), "</span></div>",
                "</div>",
                '<div class="profile-legend-detail-strip" data-legend-detail-strip="1">',
                '<div class="profile-legend-detail-strip__item"><span class="profile-legend-detail-strip__label">Day</span><span class="profile-legend-detail-strip__value" data-legend-day="1">', escapeHtml(selectedDayText), "</span></div>",
                '<div class="profile-legend-detail-strip__item"><span class="profile-legend-detail-strip__label">Final</span><span class="profile-legend-detail-strip__value" data-legend-final="1">', escapeHtml(formatNumber(selectedPoint.trophies)), "</span></div>",
                '<div class="profile-legend-detail-strip__item"><span class="profile-legend-detail-strip__label">Delta</span><span class="profile-legend-detail-strip__value" data-legend-delta="1">', escapeHtml(deltaText), "</span></div>",
                "</div>",
                "</div>",
                "</div>",
            ].join(""),
        };
    };

    // Render legend window toggle button.
    const renderLegendWindowToggleButton = (daysRaw, enabledRaw, activeRaw) => {
        const days = Math.max(1, toNonNegativeInt(daysRaw));
        const enabled = !!enabledRaw;
        const active = !!activeRaw;
        return [
            '<button type="button" class="profile-legend-trend__toggle',
            active ? " is-active" : "",
            '" data-legend-window="', days,
            '" aria-pressed="', active ? "true" : "false",
            '"',
            enabled ? "" : ' disabled aria-disabled="true"',
            ">", days, "</button>",
        ].join("");
    };

    // Parse legend points payload.
    const parseLegendPointsPayload = (payloadTextRaw) => {
        const payloadText = toStr(payloadTextRaw).trim();
        if (!payloadText) return [];
        try {
            const parsed = JSON.parse(payloadText);
            return normalizeLocalHistoryPoints(Array.isArray(parsed) ? parsed : [], null);
        } catch (err) {
            return [];
        }
    };

    // Update legend chart selection.
    const updateLegendChartSelection = (stageEl, chartState, selectedIndexRaw) => {
        const stage = stageEl && stageEl.querySelector ? stageEl : null;
        if (!stage || !chartState || !chartState.hasData) return;
        const chartPoints = Array.isArray(chartState.chartPoints) ? chartState.chartPoints : [];
        const points = Array.isArray(chartState.points) ? chartState.points : [];
        if (!chartPoints.length || !points.length) return;
        const selectedIndex = Math.max(0, Math.min(chartPoints.length - 1, toNonNegativeInt(selectedIndexRaw)));
        const selectedPoint = chartPoints[selectedIndex];
        const delta = computeLegendDelta(points, selectedIndex);
        const dayText = formatLegendPointDayLabel(points[selectedIndex]);
        const tooltipLeftPct = Math.max(8, Math.min(92, (selectedPoint.x / chartState.width) * 100));

        const finalEls = stage.querySelectorAll("[data-legend-final='1']");
        const deltaEls = stage.querySelectorAll("[data-legend-delta='1']");
        const dayEls = stage.querySelectorAll("[data-legend-day='1']");
        const tooltipEl = stage.querySelector("[data-legend-tooltip='1']");
        const cursorLine = stage.querySelector("[data-legend-cursor-line='1']");
        const cursorDot = stage.querySelector("[data-legend-cursor-dot='1']");

        finalEls.forEach((el) => {
            el.textContent = formatNumber(selectedPoint.trophies);
        });
        deltaEls.forEach((el) => {
            el.textContent = delta.available ? formatSignedNumber(delta.delta) : "\u2013";
        });
        dayEls.forEach((el) => {
            el.textContent = dayText;
        });
        if (tooltipEl && tooltipEl.style) tooltipEl.style.left = tooltipLeftPct.toFixed(2) + "%";
        if (cursorLine) {
            cursorLine.setAttribute("x1", selectedPoint.x.toFixed(2));
            cursorLine.setAttribute("x2", selectedPoint.x.toFixed(2));
        }
        if (cursorDot) {
            cursorDot.setAttribute("cx", selectedPoint.x.toFixed(2));
            cursorDot.setAttribute("cy", selectedPoint.y.toFixed(2));
        }
    };

    // Bind legend chart interaction.
    const bindLegendChartInteraction = (stageEl, chartState) => {
        const stage = stageEl && stageEl.querySelector ? stageEl : null;
        if (!stage || !chartState || !chartState.hasData) return;
        const hitbox = stage.querySelector("[data-legend-hitbox='1']");
        if (!hitbox) return;

        const chartPoints = Array.isArray(chartState.chartPoints) ? chartState.chartPoints : [];
        if (!chartPoints.length) return;
        updateLegendChartSelection(stage, chartState, chartState.selectedIndex);

        // Handle pick index from client X.
        const pickIndexFromClientX = (clientXRaw) => {
            const clientX = Number(clientXRaw);
            if (!Number.isFinite(clientX)) return;
            const rect = hitbox.getBoundingClientRect();
            if (!rect || rect.width <= 0) return;
            const relX = Math.max(0, Math.min(rect.width, clientX - rect.left));
            const targetX = (relX / rect.width) * chartState.width;
            let bestIndex = 0;
            let bestDistance = Number.POSITIVE_INFINITY;
            for (let i = 0; i < chartPoints.length; i++) {
                const distance = Math.abs(chartPoints[i].x - targetX);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestIndex = i;
                }
            }
            updateLegendChartSelection(stage, chartState, bestIndex);
        };

        if (typeof window !== "undefined" && window.PointerEvent) {
            let pointerDown = false;
            hitbox.addEventListener("pointerdown", (event) => {
                pointerDown = true;
                if (hitbox.setPointerCapture && event.pointerId != null) {
                    try { hitbox.setPointerCapture(event.pointerId); } catch (err) { /* noop */ }
                }
                pickIndexFromClientX(event.clientX);
                if (event.pointerType && event.pointerType !== "mouse" && event.cancelable) event.preventDefault();
            });
            hitbox.addEventListener("pointermove", (event) => {
                if (event.pointerType === "mouse" || pointerDown) {
                    pickIndexFromClientX(event.clientX);
                }
                if (event.pointerType && event.pointerType !== "mouse" && pointerDown && event.cancelable) event.preventDefault();
            });
            hitbox.addEventListener("pointerenter", (event) => {
                if (event.pointerType === "mouse") pickIndexFromClientX(event.clientX);
            });
            hitbox.addEventListener("pointerup", (event) => {
                pointerDown = false;
                pickIndexFromClientX(event.clientX);
                if (hitbox.releasePointerCapture && event.pointerId != null) {
                    try { hitbox.releasePointerCapture(event.pointerId); } catch (err) { /* noop */ }
                }
                if (event.pointerType && event.pointerType !== "mouse" && event.cancelable) event.preventDefault();
            });
            hitbox.addEventListener("pointercancel", () => {
                pointerDown = false;
            });
            return;
        }

        hitbox.addEventListener("mousemove", (event) => {
            pickIndexFromClientX(event.clientX);
        });
        hitbox.addEventListener("mousedown", (event) => {
            pickIndexFromClientX(event.clientX);
        });
        hitbox.addEventListener("touchstart", (event) => {
            const touch = event.touches && event.touches[0] ? event.touches[0] : null;
            if (touch) pickIndexFromClientX(touch.clientX);
            if (event.cancelable) event.preventDefault();
        }, { passive: false });
        hitbox.addEventListener("touchmove", (event) => {
            const touch = event.touches && event.touches[0] ? event.touches[0] : null;
            if (touch) pickIndexFromClientX(touch.clientX);
            if (event.cancelable) event.preventDefault();
        }, { passive: false });
    };

    // Bind legends journey section.
    const bindLegendsJourneySection = (sectionEl) => {
        const section = sectionEl && sectionEl.querySelector ? sectionEl : null;
        if (!section || section.dataset.legendJourneyBound === "1") return;
        section.dataset.legendJourneyBound = "1";

        const payloadEl = section.querySelector("[data-legend-points-json='1']");
        const stageEl = section.querySelector("[data-legend-stage='1']");
        const toggleButtons = Array.from(section.querySelectorAll("[data-legend-window]"));
        if (!payloadEl || !stageEl || !toggleButtons.length) return;

        const state = {
            allPoints: parseLegendPointsPayload(payloadEl.textContent),
            activeWindowDays: 0,
        };
        state.activeWindowDays = getLegendDefaultWindowDays(state.allPoints);

        // Re-render the current view state.
        const rerender = () => {
            const availability = getLegendWindowAvailability(state.allPoints);
            const supportByDays = Object.create(null);
            for (let i = 0; i < availability.length; i++) {
                supportByDays[availability[i].days] = !!availability[i].supported;
            }
            if (state.activeWindowDays > 0 && !supportByDays[state.activeWindowDays]) {
                state.activeWindowDays = getLegendDefaultWindowDays(state.allPoints);
            }
            const visiblePoints = getLegendTrendPoints(state.allPoints, state.activeWindowDays);
            const trend = renderLegendTrendSparkline(visiblePoints);
            stageEl.innerHTML = trend.html;
            if (trend.hasData) bindLegendChartInteraction(stageEl, trend);

            for (let i = 0; i < toggleButtons.length; i++) {
                const button = toggleButtons[i];
                const days = Math.max(1, toNonNegativeInt(button.dataset && button.dataset.legendWindow));
                const supported = !!supportByDays[days];
                const active = state.activeWindowDays > 0 && state.activeWindowDays === days;
                button.disabled = !supported;
                button.setAttribute("aria-disabled", supported ? "false" : "true");
                button.setAttribute("aria-pressed", active ? "true" : "false");
                button.classList.toggle("is-active", active);
            }
        };

        for (let i = 0; i < toggleButtons.length; i++) {
            const button = toggleButtons[i];
            button.addEventListener("click", (event) => {
                event.preventDefault();
                if (button.disabled) return;
                const days = Math.max(1, toNonNegativeInt(button.dataset && button.dataset.legendWindow));
                if (!days) return;
                state.activeWindowDays = days;
                rerender();
            });
        }

        rerender();
    };

    // Initialize legends journey sections.
    const initLegendsJourneySections = (containerRaw) => {
        const container = containerRaw && containerRaw.querySelectorAll ? containerRaw : null;
        if (!container) return;
        container.querySelectorAll("[data-legends-journey='1']").forEach((section) => {
            bindLegendsJourneySection(section);
        });
    };

    // Bind long-term segmented section.
    const bindLongTermSegmentedSection = (sectionEl) => {
        const section = sectionEl && sectionEl.querySelector ? sectionEl : null;
        if (!section || section.dataset.longTermBound === "1") return;
        section.dataset.longTermBound = "1";

        const buttons = Array.from(section.querySelectorAll("[data-longterm-segment]"));
        const panels = Array.from(section.querySelectorAll("[data-longterm-panel]"));
        if (!buttons.length || !panels.length) return;
        const panelByKey = Object.create(null);
        for (let i = 0; i < panels.length; i++) {
            const key = toStr(panels[i].dataset && panels[i].dataset.longtermPanel).trim().toLowerCase();
            if (key) panelByKey[key] = panels[i];
        }
        let activeKey = "";

        // Set active long-term segment.
        const setActiveSegment = (keyRaw) => {
            const key = toStr(keyRaw).trim().toLowerCase();
            if (!key || !panelByKey[key]) return;
            activeKey = key;
            for (let i = 0; i < buttons.length; i++) {
                const button = buttons[i];
                const buttonKey = toStr(button.dataset && button.dataset.longtermSegment).trim().toLowerCase();
                const isActive = buttonKey === activeKey;
                button.classList.toggle("is-active", isActive);
                button.setAttribute("aria-pressed", isActive ? "true" : "false");
                button.setAttribute("tabindex", isActive ? "0" : "-1");
            }
            for (let i = 0; i < panels.length; i++) {
                const panel = panels[i];
                const panelKey = toStr(panel.dataset && panel.dataset.longtermPanel).trim().toLowerCase();
                const isActive = panelKey === activeKey;
                panel.classList.toggle("is-active", isActive);
                panel.hidden = !isActive;
                panel.setAttribute("aria-hidden", isActive ? "false" : "true");
            }
        };

        for (let i = 0; i < buttons.length; i++) {
            const button = buttons[i];
            const key = toStr(button.dataset && button.dataset.longtermSegment).trim().toLowerCase();
            if (!key || !panelByKey[key]) continue;
            button.addEventListener("click", (event) => {
                event.preventDefault();
                setActiveSegment(key);
            });
            button.addEventListener("keydown", (event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
                event.preventDefault();
                const enabledButtons = buttons.filter((candidate) => !candidate.disabled);
                const currentIndex = enabledButtons.indexOf(button);
                if (currentIndex < 0) return;
                if (event.key === "Home") {
                    enabledButtons[0].click();
                    enabledButtons[0].focus();
                    return;
                }
                if (event.key === "End") {
                    enabledButtons[enabledButtons.length - 1].click();
                    enabledButtons[enabledButtons.length - 1].focus();
                    return;
                }
                const direction = event.key === "ArrowRight" ? 1 : -1;
                const nextIndex = (currentIndex + direction + enabledButtons.length) % enabledButtons.length;
                const nextButton = enabledButtons[nextIndex];
                if (!nextButton) return;
                nextButton.click();
                nextButton.focus();
            });
        }

        const defaultKey = toStr(section.dataset && section.dataset.longtermDefault).trim().toLowerCase();
        const firstKey = toStr(buttons[0] && buttons[0].dataset && buttons[0].dataset.longtermSegment).trim().toLowerCase();
        setActiveSegment(defaultKey || firstKey);
    };

    // Initialize long-term segmented sections.
    const initLongTermSegmentedSections = (containerRaw) => {
        const container = containerRaw && containerRaw.querySelectorAll ? containerRaw : null;
        if (!container) return;
        container.querySelectorAll("[data-longterm-segmented='1']").forEach((section) => {
            bindLongTermSegmentedSection(section);
        });
    };

    // Return whether legend league name.
    const isLegendLeagueName = (nameRaw) => {
        const text = toStr(nameRaw).trim();
        if (!text) return false;
        return normalizeLeagueFamilyKey(text).indexOf("legend") >= 0 || normalizeLeagueMatchText(text).indexOf("legend") >= 0;
    };

    // Handle read league name for legend check.
    const readLeagueNameForLegendCheck = (leagueRaw) => {
        const league = leagueRaw && typeof leagueRaw === "object" ? leagueRaw : null;
        if (!league) return toStr(leagueRaw).trim();
        if (typeof league.name === "string") return league.name.trim();
        if (!league.name || typeof league.name !== "object") return "";
        const preferred = [league.name.en, league.name.english, league.name.default, league.name.value];
        for (let i = 0; i < preferred.length; i++) {
            const value = toStr(preferred[i]).trim();
            if (value) return value;
        }
        const keys = Object.keys(league.name);
        for (let i = 0; i < keys.length; i++) {
            const value = toStr(league.name[keys[i]]).trim();
            if (value) return value;
        }
        return "";
    };

    // Return whether show legends journey.
    const shouldShowLegendsJourney = (playerRaw) => {
        const player = playerRaw && typeof playerRaw === "object" ? playerRaw : {};
        const legend = player.legendStatistics && typeof player.legendStatistics === "object" ? player.legendStatistics : null;
        if (legend) return true;
        const leagueName = readLeagueNameForLegendCheck(player.league);
        const leagueTierName = readLeagueNameForLegendCheck(player.leagueTier);
        return isLegendLeagueName(leagueName) || isLegendLeagueName(leagueTierName);
    };

    // Render legends journey section.
    const renderLegendsJourneySection = (playerRaw, tagRaw) => {
        const player = playerRaw && typeof playerRaw === "object" ? playerRaw : {};
        if (!shouldShowLegendsJourney(player)) return "";

        const tag = normalizeClanTag(tagRaw);
        const localPoints = getLocalTrophyHistoryForTag(tag, lastRenderedData);
        const windowAvailability = getLegendWindowAvailability(localPoints);
        const defaultWindowDays = getLegendDefaultWindowDays(localPoints);
        const initialPoints = getLegendTrendPoints(localPoints, defaultWindowDays);
        const trend = renderLegendTrendSparkline(initialPoints);
        const payloadPoints = localPoints.map((point) => ({
            dayKey: point.dayKey,
            capturedAt: point.capturedAt,
            trophies: point.trophies,
            clanTag: point.clanTag,
            league: point.leagueName ? { name: point.leagueName } : null,
        }));
        const payloadJson = JSON.stringify(payloadPoints).replace(/<\//g, "<\\/");

        const toggleButtonsHtml = windowAvailability
            .map((item) => renderLegendWindowToggleButton(item.days, item.supported, defaultWindowDays > 0 && defaultWindowDays === item.days))
            .join("");

        const sectionBody = [
            '<div class="profile-section-grid">',
            '<div class="profile-subsection profile-legend-journey" data-legends-journey="1">',
            '<div class="profile-subsection__title">Legends Journey</div>',
            '<div class="profile-legend-trend">',
            '<div class="profile-legend-trend__controls" role="group" aria-label="Legends Journey windows">',
            toggleButtonsHtml,
            "</div>",
            '<div class="profile-legend-trend__stage" data-legend-stage="1">', trend.html, "</div>",
            '<script type="application/json" data-legend-points-json="1">', payloadJson, "</script>",
            "</div>",
            "</div>",
            "</div>",
        ].join("");

        return renderDisclosureSection({
            title: "Legends Journey",
            subtitle: "Recent trophy movement across tracked days.",
            bodyHtml: sectionBody,
            open: false,
            sectionClass: "profile-disclosure--legend",
        });
    };

    // Render profile loading screen.
    const renderProfileLoadingScreen = (context, displayName, tag) => {
        const rosterTitle = toStr(context && context.rosterTitle).trim();
        const placement = buildPlacementLabel(context);
        return [
            '<section class="profile-loading-screen" aria-live="polite" aria-busy="true">',
            '<div class="profile-loading-screen__pulse" aria-hidden="true"></div>',
            '<div class="profile-loading-screen__title">Loading player profile</div>',
            '<div class="profile-loading-screen__subtitle">Fetching official Clash data for this player.</div>',
            '<div class="profile-loading-screen__meta">',
            displayName ? ('<span class="profile-loading-screen__chip">' + escapeHtml(displayName) + "</span>") : "",
            tag ? ('<span class="profile-loading-screen__chip">' + escapeHtml(tag) + "</span>") : "",
            rosterTitle ? ('<span class="profile-loading-screen__chip">' + escapeHtml(rosterTitle) + "</span>") : "",
            placement && placement !== "-" ? ('<span class="profile-loading-screen__chip">' + escapeHtml(placement) + "</span>") : "",
            "</div>",
            '<div class="profile-loading-grid">',
            '<div class="profile-skeleton profile-skeleton--card"></div>',
            '<div class="profile-skeleton profile-skeleton--card"></div>',
            '<div class="profile-skeleton profile-skeleton--card"></div>',
            '<div class="profile-skeleton profile-skeleton--card"></div>',
            "</div>",
            "</section>",
        ].join("");
    };

    // Render disclosure section.
    const renderDisclosureSection = (options) => {
        const opts = options && typeof options === "object" ? options : {};
        const summaryItems = Array.isArray(opts.summaryItems) ? opts.summaryItems.filter(Boolean).join("") : "";
        const isOpen = !!opts.open;
        const bodyHtml = opts.bodyHtml || '<div class="profile-empty">No details available.</div>';
        const sectionClass = toStr(opts.sectionClass).replace(/[^a-z0-9 _-]/gi, "").trim();
        return [
            '<section class="profile-disclosure', sectionClass ? (" " + sectionClass) : "", isOpen ? " is-open" : "", '">',
            '<button type="button" class="profile-disclosure__summary" data-profile-section-toggle="1" aria-expanded="', isOpen ? "true" : "false", '">',
            '<span class="profile-disclosure__summary-head">',
            '<span class="profile-disclosure__summary-copy">',
            opts.source ? ('<span class="profile-disclosure__eyebrow">' + escapeHtml(opts.source) + "</span>") : "",
            '<span class="profile-disclosure__title-row"><span class="profile-disclosure__title">' + escapeHtml(opts.title || "") + '</span>' +
            (opts.badge ? ('<span class="profile-disclosure__badge">' + escapeHtml(opts.badge) + "</span>") : "") +
            "</span>",
            opts.subtitle ? ('<span class="profile-disclosure__subtitle">' + escapeHtml(opts.subtitle) + "</span>") : "",
            "</span>",
            '<span class="profile-disclosure__toggle" aria-hidden="true"></span>',
            "</span>",
            summaryItems ? ('<span class="profile-disclosure__preview">' + summaryItems + "</span>") : "",
            "</button>",
            '<div class="profile-disclosure__body" aria-hidden="', isOpen ? "false" : "true", '">', bodyHtml, "</div>",
            "</section>",
        ].join("");
    };

    // Format profile timestamp.
    const formatProfileTimestamp = (value) => {
        const text = toStr(value).trim();
        if (!text) return "";
        const date = new Date(normalizeWarTimestampForDate(text));
        return Number.isNaN(date.getTime()) ? text : date.toLocaleString();
    };

    // Normalize compact Clash timestamps so browser Date parsing is reliable.
    const normalizeWarTimestampForDate = (value) => {
        const text = toStr(value).trim();
        const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.(\d{3}))?Z$/.exec(text);
        if (!match) return text;
        return match[1] + "-" + match[2] + "-" + match[3] + "T" +
            match[4] + ":" + match[5] + ":" + match[6] + "." + (match[7] || "000") + "Z";
    };

    // Parse compact Clash or standard ISO timestamps into milliseconds.
    const parseWarTimestampMs = (value) => {
        const text = toStr(value).trim();
        if (!text) return 0;
        const ms = new Date(normalizeWarTimestampForDate(text)).getTime();
        return Number.isFinite(ms) ? ms : 0;
    };

    // Format a positive remaining duration for roster timer badges.
    const formatRemainingWarDuration = (diffMsRaw) => {
        const diffMs = Math.max(0, Number(diffMsRaw) || 0);
        const totalMinutes = Math.max(0, Math.ceil(diffMs / (60 * 1000)));
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        if (hours > 0) return hours + "h" + (minutes > 0 ? (" " + minutes + "min") : "");
        return minutes + "min";
    };

    // Build a countdown descriptor from regular-war metadata.
    const getRegularWarCountdownDescriptor = (currentWarRaw) => {
        const currentWar = currentWarRaw && typeof currentWarRaw === "object" ? currentWarRaw : {};
        const state = toStr(currentWar.state).trim().toLowerCase();
        if (state === "preparation") {
            return { kind: "starts", targetAt: toStr(currentWar.startTime).trim() };
        }
        if (state === "inwar") {
            return { kind: "ends", targetAt: toStr(currentWar.endTime).trim() };
        }
        return null;
    };

    // Render one live regular-war countdown badge.
    const renderWarCountdownNode = (node) => {
        if (!node) return;
        const kind = toStr(node.dataset && node.dataset.warCountdownKind).trim();
        const targetAt = toStr(node.dataset && node.dataset.warCountdownTargetAt).trim();
        const targetMs = parseWarTimestampMs(targetAt);
        if (!kind || !(targetMs > 0)) {
            node.textContent = "";
            return;
        }
        const diffMs = targetMs - Date.now();
        if (diffMs <= 0) {
            node.textContent = kind === "starts" ? "War starting" : "War ending";
            return;
        }
        node.textContent = (kind === "starts" ? "War starts in " : "War ends in ") + formatRemainingWarDuration(diffMs);
        node.title = formatProfileTimestamp(targetAt) || targetAt;
    };

    // Clear the shared live war-countdown interval.
    const clearWarCountdownTimer = () => {
        if (!warCountdownTimerId || typeof window === "undefined" || !window.clearInterval) return;
        window.clearInterval(warCountdownTimerId);
        warCountdownTimerId = 0;
    };

    // Refresh all visible regular-war countdown nodes.
    const refreshWarCountdownNodes = () => {
        const nodes = document.querySelectorAll("[data-war-countdown-kind]");
        for (let i = 0; i < nodes.length; i++) {
            renderWarCountdownNode(nodes[i]);
        }
        return nodes.length;
    };

    // Keep visible regular-war countdowns current without waiting for a data refresh.
    const ensureWarCountdownTimer = () => {
        const nodeCount = refreshWarCountdownNodes();
        if (nodeCount < 1) {
            clearWarCountdownTimer();
            return;
        }
        if (warCountdownTimerId || typeof window === "undefined" || !window.setInterval) return;
        warCountdownTimerId = window.setInterval(() => {
            refreshWarCountdownNodes();
        }, 60 * 1000);
    };

    // Format global relative timestamp.
    const formatGlobalRelativeTimestamp = (value) => {
        const text = toStr(value).trim();
        if (!text) return "";
        const date = new Date(text);
        const timeMs = date.getTime();
        if (!Number.isFinite(timeMs)) return "";

        const diffMs = Date.now() - timeMs;
        if (!Number.isFinite(diffMs)) return "";
        if (diffMs <= 0) return "just now";

        const minuteMs = 60 * 1000;
        const hourMs = 60 * minuteMs;
        const dayMs = 24 * hourMs;

        const days = Math.floor(diffMs / dayMs);
        const hours = Math.floor((diffMs % dayMs) / hourMs);
        const minutes = Math.floor((diffMs % hourMs) / minuteMs);

        if (days > 0) {
            return days + " " + pluralize(days, "day", "days") + (hours > 0 ? (" " + hours + "h") : "") + " ago";
        }
        if (hours > 0) {
            return hours + "h" + (minutes > 0 ? (" " + minutes + "min") : "") + " ago";
        }
        if (minutes > 0) return minutes + "min ago";
        return "just now";
    };

    // Clear global last updated timer.
    const clearGlobalLastUpdatedTimer = () => {
        if (!globalLastUpdatedTimerId || typeof window === "undefined" || !window.clearInterval) return;
        window.clearInterval(globalLastUpdatedTimerId);
        globalLastUpdatedTimerId = 0;
        globalLastUpdatedTimerValue = "";
    };

    // Render global last updated value.
    const renderGlobalLastUpdatedValue = (valueEl, valueRaw) => {
        if (!valueEl) return;
        const value = toStr(valueRaw).trim();
        if (!value) {
            valueEl.textContent = "-";
            valueEl.removeAttribute("title");
            return;
        }
        const relativeLabel = formatGlobalRelativeTimestamp(value);
        valueEl.textContent = relativeLabel || value;
        valueEl.title = formatProfileTimestamp(value) || value;
    };

    // Render global last updated.
    const renderGlobalLastUpdated = (dataRaw) => {
        const card = $("#globalLastUpdated");
        const valueEl = $("#globalLastUpdatedValue");
        if (!card || !valueEl) {
            clearGlobalLastUpdatedTimer();
            return;
        }
        const value = toStr(dataRaw && dataRaw.lastUpdatedAt).trim();
        if (!value) {
            card.classList.add("hidden");
            clearGlobalLastUpdatedTimer();
            renderGlobalLastUpdatedValue(valueEl, "");
            return;
        }
        card.classList.remove("hidden");
        renderGlobalLastUpdatedValue(valueEl, value);
        if (typeof window === "undefined" || !window.setInterval) return;
        if (globalLastUpdatedTimerId && globalLastUpdatedTimerValue === value) return;
        clearGlobalLastUpdatedTimer();
        globalLastUpdatedTimerValue = value;
        globalLastUpdatedTimerId = window.setInterval(() => {
            renderGlobalLastUpdatedValue(valueEl, globalLastUpdatedTimerValue);
        }, 60 * 1000);
    };

    // Normalize league family key.
    const normalizeLeagueFamilyKey = (value) => {
        const raw = toStr(value).trim().toLowerCase();
        if (!raw) return "";
        const normalized = typeof raw.normalize === "function" ? raw.normalize("NFKD") : raw;
        return normalized
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "");
    };

    // Normalize league match text.
    const normalizeLeagueMatchText = (value) => {
        const raw = toStr(value).trim().toLowerCase();
        if (!raw) return "";
        const normalized = typeof raw.normalize === "function" ? raw.normalize("NFKD") : raw;
        return normalized
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    };

    // Resolve home league asset family.
    const resolveHomeLeagueAssetFamily = (leagueNameRaw) => {
        const text = normalizeLeagueMatchText(leagueNameRaw);
        const compact = normalizeLeagueFamilyKey(leagueNameRaw);
        if (!text) return "";
        // Return whether word.
        const hasWord = (word) => new RegExp("(^|\\s)" + String(word) + "(\\s|$)").test(text);
        // Return whether compact.
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
    };

    // Get town hall icon URL.
    const getTownHallIconUrl = (levelRaw) => {
        const level = toNonNegativeInt(levelRaw);
        if (level < 1 || level > 18) return "";
        return buildStaticAssetUrl("assets/icons/th" + level + ".webp");
    };

    // Get Discord icon URL.
    const getDiscordIconUrl = () => buildStaticAssetUrl("assets/icons/discord.webp");
    // Get no-Discord icon URL.
    const getNoDiscordIconUrl = () => buildStaticAssetUrl("assets/icons/no-discord.webp");

    const LEAGUE_ICON_ASSET_BY_FAMILY = {
        unranked: "assets/icons/league-unranked.webp",
        skeleton: "assets/icons/league-skeleton.webp",
        barbarian: "assets/icons/league-barbarian.webp",
        archer: "assets/icons/league-archer.webp",
        wizard: "assets/icons/league-wizard.webp",
        valkyrie: "assets/icons/league-valkyrie.webp",
        witch: "assets/icons/league-witch.webp",
        golem: "assets/icons/league-golem.webp",
        pekka: "assets/icons/league-pekka.webp",
        titan: "assets/icons/league-titan.webp",
        dragon: "assets/icons/league-dragon.webp",
        electro: "assets/icons/league-electro.webp",
        legend: "assets/icons/league-legend.webp",
    };

    const LEGEND_LEAGUE_TIER_OVERLAY_BY_ID = {
        105000036: "I",
        105000035: "II",
        105000034: "III",
    };
    const LEAGUE_TIER_ID_BASE = 105000000;

    // Get league icon URL from family.
    const getLeagueIconUrlFromFamily = (familyRaw) => {
        const family = normalizeLeagueFamilyKey(familyRaw);
        if (!family) return "";
        const assetPath = LEAGUE_ICON_ASSET_BY_FAMILY[family] || "";
        if (!assetPath) return "";
        return buildStaticAssetUrl(assetPath);
    };

    // Ensure one local/static league icon is available synchronously for a resolved family.
    const getLocalLeagueIconSource = (familyRaw) => {
        const key = normalizeLeagueFamilyKey(familyRaw);
        if (!key) return null;
        if (!Object.prototype.hasOwnProperty.call(leagueIconCache, key)) {
            leagueIconCache[key] = { dataUrl: getLeagueIconUrlFromFamily(key) };
        }
        const localEntry = leagueIconCache[key] && typeof leagueIconCache[key] === "object" ? leagueIconCache[key] : null;
        return {
            key: key,
            src: localEntry && localEntry.dataUrl ? toStr(localEntry.dataUrl).trim() : "",
        };
    };

    // Handle read league display name.
    const readLeagueDisplayName = (leagueObj) => {
        const league = leagueObj && typeof leagueObj === "object" ? leagueObj : null;
        if (!league) return "";
        const rawName = league.name;
        if (typeof rawName === "string") return rawName.trim();
        if (!rawName || typeof rawName !== "object") return "";
        const preferred = [rawName.en, rawName.english, rawName.default, rawName.value];
        for (let i = 0; i < preferred.length; i++) {
            if (typeof preferred[i] === "string" && preferred[i].trim()) return preferred[i].trim();
        }
        const values = Object.keys(rawName).map((key) => rawName[key]);
        for (let i = 0; i < values.length; i++) {
            if (typeof values[i] === "string" && values[i].trim()) return values[i].trim();
        }
        return "";
    };

    // Read the first available icon URL from a league icon payload.
    const readLeagueIconUrlByPriority = (iconUrlsRaw, priorityKeysRaw) => {
        const iconUrls = iconUrlsRaw && typeof iconUrlsRaw === "object" ? iconUrlsRaw : {};
        const priorityKeys = Array.isArray(priorityKeysRaw) ? priorityKeysRaw : [];
        for (let i = 0; i < priorityKeys.length; i++) {
            const value = toStr(iconUrls[priorityKeys[i]]).trim();
            if (value) return value;
        }
        return "";
    };

    // Get league tier overlay text from an explicit API leagueTier.id only.
    const getLeagueTierOverlayText = (playerRaw) => {
        const player = playerRaw && typeof playerRaw === "object" ? playerRaw : {};
        const leagueTier = player.leagueTier && typeof player.leagueTier === "object" ? player.leagueTier : null;
        const tierId = toNonNegativeInt(leagueTier && leagueTier.id);
        if (tierId > 0 && Object.prototype.hasOwnProperty.call(LEGEND_LEAGUE_TIER_OVERLAY_BY_ID, tierId)) {
            return LEGEND_LEAGUE_TIER_OVERLAY_BY_ID[tierId];
        }
        const tierNumber = tierId - LEAGUE_TIER_ID_BASE;
        return tierNumber >= 1 && tierNumber <= 33 ? String(tierNumber) : "";
    };

    // Resolve home league object from player.
    const resolveHomeLeagueObjectFromPlayer = (playerRaw) => {
        const player = playerRaw && typeof playerRaw === "object" ? playerRaw : null;
        if (!player) {
            if (PROFILE_LEAGUE_DEBUG && typeof console !== "undefined" && console.log) {
                console.log("[league-badge:resolve]", { leagueTierName: "", leagueName: "", sourceUsed: "", finalChosenLeagueName: "" });
            }
            return null;
        }

        const leagueTier = player.leagueTier && typeof player.leagueTier === "object" ? player.leagueTier : null;
        const league = player.league && typeof player.league === "object" ? player.league : null;
        const leagueTierName = readLeagueDisplayName(leagueTier);
        const leagueName = readLeagueDisplayName(league);

        if (leagueTier && leagueTierName) {
            if (PROFILE_LEAGUE_DEBUG && typeof console !== "undefined" && console.log) {
                console.log("[league-badge:resolve]", {
                    leagueTierName: leagueTierName,
                    leagueName: leagueName,
                    sourceUsed: "player.leagueTier",
                    finalChosenLeagueName: leagueTierName,
                });
            }
            return leagueTier;
        }

        if (league && leagueName) {
            if (PROFILE_LEAGUE_DEBUG && typeof console !== "undefined" && console.log) {
                console.log("[league-badge:resolve]", {
                    leagueTierName: leagueTierName,
                    leagueName: leagueName,
                    sourceUsed: "player.league",
                    finalChosenLeagueName: leagueName,
                });
            }
            return league;
        }

        if (PROFILE_LEAGUE_DEBUG && typeof console !== "undefined" && console.log) {
            console.log("[league-badge:resolve]", { leagueTierName: leagueTierName, leagueName: leagueName, sourceUsed: "", finalChosenLeagueName: "" });
        }
        return null;
    };

    // Extract home league badge source.
    const extractHomeLeagueBadgeSource = (playerRaw) => {
        const player = playerRaw && typeof playerRaw === "object" ? playerRaw : {};
        const legacyLeague = player.league && typeof player.league === "object" ? player.league : null;
        const league = resolveHomeLeagueObjectFromPlayer(player);
        if (!league) return null;
        const name = readLeagueDisplayName(league);
        if (!name) return null;
        const legacyLeagueIconSrc = readLeagueIconUrlByPriority(legacyLeague && legacyLeague.iconUrls, ["medium", "small", "tiny"]);
        return {
            name: name,
            legacyLeagueIconSrc: legacyLeagueIconSrc,
            fallbackAssetFamily: resolveHomeLeagueAssetFamily(name),
            tierOverlayText: getLeagueTierOverlayText(player),
        };
    };

    // Get home league badge meta.
    const getHomeLeagueBadgeMeta = (playerRaw) => {
        const source = extractHomeLeagueBadgeSource(playerRaw);
        if (!source || !source.name) return null;
        const localSource = getLocalLeagueIconSource(source.fallbackAssetFamily);
        const key = localSource && localSource.key ? localSource.key : "";
        if (localSource && localSource.src) {
            const meta = {
                name: source.name,
                src: localSource.src,
                key: key,
                tierOverlayText: source.tierOverlayText,
            };
            if (PROFILE_LEAGUE_DEBUG && typeof console !== "undefined" && console.log) {
                console.log("[league-badge]", { source: source, chosen: meta, from: "local-cache" });
            }
            return meta;
        }
        const meta = {
            name: source.name,
            src: toStr(source.legacyLeagueIconSrc).trim(),
            key: key || "",
            tierOverlayText: source.tierOverlayText,
        };
        if (PROFILE_LEAGUE_DEBUG && typeof console !== "undefined" && console.log) {
            console.log("[league-badge]", { source: source, chosen: meta, from: meta.src ? "player.league.iconUrls" : "no-icon" });
        }
        return meta;
    };

    // Get roster card league badge meta using local/static league icons plus explicit league tier overlays.
    const getRosterCardLeagueBadgeMeta = (playerRaw, dataRaw) => {
        // Resolve local icon for a league name/family pair.
        const resolveLocalLeagueMeta = (nameRaw, familyRaw, tierOverlayTextRaw) => {
            const name = toStr(nameRaw).trim();
            const localSource = getLocalLeagueIconSource(familyRaw || resolveHomeLeagueAssetFamily(name));
            if (!localSource || !localSource.src) return null;
            return {
                name: name || "Home league",
                key: localSource.key,
                src: localSource.src,
                tierOverlayText: toStr(tierOverlayTextRaw).trim(),
            };
        };

        // Resolve one player-like payload, including metrics snapshots with league/leagueTier objects.
        const resolvePlayerLikeLeagueMeta = (playerLikeRaw) => {
            const source = extractHomeLeagueBadgeSource(playerLikeRaw);
            if (!source || !source.name) return null;
            const localMeta = resolveLocalLeagueMeta(source.name, source.fallbackAssetFamily, source.tierOverlayText);
            if (localMeta) return localMeta;
            const legacyLeagueIconSrc = toStr(source.legacyLeagueIconSrc).trim();
            if (!legacyLeagueIconSrc) return null;
            return {
                name: source.name,
                key: "",
                src: legacyLeagueIconSrc,
                tierOverlayText: source.tierOverlayText,
            };
        };

        const directMeta = resolvePlayerLikeLeagueMeta(playerRaw);
        if (directMeta) return directMeta;

        const tag = normalizeClanTag(playerRaw && playerRaw.tag);
        if (!tag) return null;
        const data = dataRaw && typeof dataRaw === "object" ? dataRaw : lastRenderedData;
        const metricsEntry = getPlayerMetricsEntry(tag, data);
        const latestSnapshot = readMetricsLatestSnapshot(metricsEntry);
        if (!latestSnapshot || typeof latestSnapshot !== "object") return null;
        const snapshotMeta = resolvePlayerLikeLeagueMeta(latestSnapshot);
        if (snapshotMeta) return snapshotMeta;
        const descriptor = resolveLeaderboardLeagueDescriptorFromSnapshot(latestSnapshot);
        return resolveLocalLeagueMeta(descriptor && descriptor.name, descriptor && descriptor.family, "");
    };

    // Swap this generated palette helper for local TH asset mapping later if desired.
    const getTownHallPalette = (levelRaw) => {
        const level = toNonNegativeInt(levelRaw);
        if (level >= 17) return { accent: "#f59e0b", accentStrong: "#fb7185", shadow: "rgba(245,158,11,.28)" };
        if (level >= 15) return { accent: "#22c55e", accentStrong: "#38bdf8", shadow: "rgba(34,197,94,.24)" };
        if (level >= 13) return { accent: "#a78bfa", accentStrong: "#60a5fa", shadow: "rgba(167,139,250,.24)" };
        if (level >= 10) return { accent: "#f97316", accentStrong: "#facc15", shadow: "rgba(249,115,22,.24)" };
        return { accent: "#60a5fa", accentStrong: "#38bdf8", shadow: "rgba(59,130,246,.24)" };
    };

    // Render town hall badge.
    const renderTownHallBadge = (levelRaw, weaponLevelRaw) => {
        const level = toNonNegativeInt(levelRaw);
        const iconDataUrl = townHallIconCache[level] || "";
        const palette = getTownHallPalette(level);
        const weaponLevel = toNonNegativeInt(weaponLevelRaw);
        return [
            '<div class="profile-th-badge" style="--th-accent:', palette.accent, ";--th-accent-strong:", palette.accentStrong, ";--th-shadow:", palette.shadow, ';">',
            iconDataUrl
                ? ('<div class="profile-th-badge__asset-wrap"><img class="profile-th-badge__asset" src="' + escapeAttr(iconDataUrl) + '" alt="Town Hall ' + escapeAttr(level > 0 ? String(level) : "?") + '"></div>')
                : ('<div class="profile-th-badge__shield"><div class="profile-th-badge__label">TH</div><div class="profile-th-badge__level">' + escapeHtml(level > 0 ? String(level) : "?") + "</div></div>"),
            weaponLevel > 0 ? ('<div class="profile-th-badge__weapon">Weapon ' + escapeHtml(String(weaponLevel)) + "</div>") : "",
            "</div>",
        ].join("");
    };

    // Sort army items.
    const sortArmyItems = (itemsRaw, type, village) => {
        const list = Array.isArray(itemsRaw) ? itemsRaw.slice() : [];
        const preferred = {
            heroes: ["Barbarian King", "Archer Queen", "Grand Warden", "Royal Champion", "Minion Prince", "Battle Machine", "Battle Copter"],
            spells: ["Lightning Spell", "Healing Spell", "Rage Spell", "Jump Spell", "Freeze Spell", "Clone Spell", "Invisibility Spell", "Recall Spell", "Poison Spell", "Earthquake Spell", "Haste Spell", "Skeleton Spell", "Bat Spell", "Overgrowth Spell"],
            troopsHome: ["Barbarian", "Archer", "Giant", "Goblin", "Wall Breaker", "Balloon", "Wizard", "Healer", "Dragon", "P.E.K.K.A", "Baby Dragon", "Miner", "Electro Dragon", "Yeti", "Dragon Rider", "Electro Titan", "Root Rider"],
            troopsBuilder: ["Raged Barbarian", "Sneaky Archer", "Boxer Giant", "Beta Minion", "Bomber", "Baby Dragon", "Cannon Cart", "Night Witch", "Drop Ship", "Super P.E.K.K.A", "Hog Glider", "Electrofire Wizard"],
        };
        const order = type === "heroes"
            ? preferred.heroes
            : (type === "spells" ? preferred.spells : (village === "builderBase" ? preferred.troopsBuilder : preferred.troopsHome));
        return list.sort((a, b) => {
            const aName = toStr(a && a.name).trim();
            const bName = toStr(b && b.name).trim();
            const aIndex = order.indexOf(aName);
            const bIndex = order.indexOf(bName);
            if (aIndex !== bIndex) return (aIndex < 0 ? 999 : aIndex) - (bIndex < 0 ? 999 : bIndex);
            return aName.localeCompare(bName);
        });
    };

    // Render profile content.
    const renderProfileContent = (ctx, response, mode, errorText) => {
        const context = ctx && typeof ctx === "object" ? ctx : null;
        const player = response && response.player && typeof response.player === "object" ? response.player : {};
        const localPlayer = context && context.player ? context.player : {};
        const tag = normalizeClanTag((response && response.tag) || player.tag || localPlayer.tag);
        const displayName = toStr(localPlayer.name).trim() || toStr(player.name).trim() || "Player profile";
        const trackingMode = context && context.trackingMode === "regularWar" ? "regularWar" : "cwl";
        const role = toStr(context && context.role).trim().toLowerCase();
        const cwl = context && context.cwl ? context.cwl : getPlayerCwlStats(null, tag);
        const regularWar = context && context.regularWar ? context.regularWar : getPlayerRegularWarStats(null, tag, context && context.warPerformance);
        const longTerm = context && context.longTerm ? context.longTerm : getPlayerLongTermWarStats(context && context.warPerformance, tag);
        const townHallLevel = player.townHallLevel != null ? player.townHallLevel : localPlayer.th;
        const builderHall = toNonNegativeInt(player.builderHallLevel);
        const clanName = toStr(player.clan && player.clan.name).trim();
        const clanTag = normalizeClanTag(player.clan && player.clan.tag);
        const leagueBadge = getHomeLeagueBadgeMeta(player);
        const leagueName = leagueBadge && leagueBadge.name ? leagueBadge.name : "";
        const roleRaw = formatRole(player.role);
        const roleLabel = roleRaw || "Member";
        const publicFormScore = buildPlayerPublicFormScore(trackingMode, cwl, longTerm, context && context.warPerformance, tag);
        const liveStatusMeta = buildProfileTopbarLiveStatusMeta(trackingMode, role, regularWar, cwl);
        const placementLabel = buildPlacementLabel(context);
        const hasStoredTh = localPlayer.th !== "" && localPlayer.th != null;
        const localStoredThLabel = hasStoredTh ? ("TH" + localPlayer.th) : "Not set";
        const discordLabel = getDisplayDiscordUsernameForPlayer(localPlayer, lastRenderedData) || "Not set";
        const localNotes = context && Array.isArray(localPlayer.notes) ? localPlayer.notes : [];
        const suggestion = trackingMode === "cwl"
            ? (context && context.suggestion ? context.suggestion : getPlayerBenchSuggestion(context && context.suggestionModel, tag))
            : null;
        const rosterName = toStr(context && context.rosterTitle).trim() || "-";
        const rosterSlot = context && context.player ? placementLabel : "-";
        const cwlStarsLabel = cwl.possibleStars > 0 ? (formatNumber(cwl.starsTotal) + " / " + formatNumber(cwl.possibleStars)) : "-";
        const cwlAvgDestructionLabel = cwl.avgDestruction != null ? formatPercent(cwl.avgDestruction, 0) : "-";
        const cwlAttacksLabel = cwl.resolvedWarDays > 0
            ? (formatNumber(cwl.attacksMade) + " / " + formatNumber(cwl.resolvedWarDays) + " days")
            : (cwl.attacksMade > 0 ? (formatNumber(cwl.attacksMade) + " attacks") : "-");
        const regularCurrentAttacksLabel = formatNumber(regularWar.current.attacksUsed) + " / " + formatNumber(regularWar.current.attacksAllowed);
        const regularCurrentRemainingLabel = formatNumber(regularWar.current.attacksRemaining);
        const regularCurrentStarsLabel = formatNumber(regularWar.current.starsTotal);
        const regularCurrentAvgDestructionLabel = regularWar.current.avgDestruction != null ? formatPercent(regularWar.current.avgDestruction, 0) : "-";
        const storedThMismatch = hasStoredTh
            && toNonNegativeInt(localPlayer.th) > 0
            && toNonNegativeInt(localPlayer.th) !== toNonNegativeInt(townHallLevel);
        const officialNameDiffers = toStr(player.name).trim() && toStr(player.name).trim() !== toStr(localPlayer.name).trim();

        requestTownHallIcon(townHallLevel);
        requestLeagueIcon(player);
        renderProfileModalTopbar({
            name: displayName,
            tag: tag,
            townHallLevel: townHallLevel,
            leagueBadge: leagueBadge,
            liveStatus: liveStatusMeta,
            formScore: publicFormScore,
        });
        if (mode === "loading") {
            profileState.bodyEl.innerHTML = renderProfileLoadingScreen(context, displayName, tag);
            return;
        }

        const actionButtons = [
            '<a class="profile-action-btn" href="' + escapeAttr(getPlayerProfileUrl(tag)) + '">Open player in-game</a>',
        ];
        if (typeof window !== "undefined" && typeof window.ROSTER_OPEN_PLAYER_EDIT === "function" && tag) {
            actionButtons.push('<button type="button" class="profile-action-btn secondary" data-profile-edit="1">Edit player</button>');
        }

        const placementTone = context && context.player
            ? (trackingMode === "regularWar"
                ? (role === "main" ? "success" : (role === "missing" ? "alert" : "warning"))
                : (role === "sub" ? "warning" : "success"))
            : "";
        const regularWarStateLabel = formatWarStateLabel(regularWar.currentWarState || "notinwar");
        const clanDisplay = clanName || clanTag
            ? (clanName || "Clan") + (clanTag ? (" " + clanTag) : "")
            : "No clan";

        const renderOverviewIdentityLine = (label, value, options) => {
            const opts = options && typeof options === "object" ? options : {};
            return '<div class="profile-overview__identity-line' + (opts.alert ? " is-alert" : "") + '">' +
                '<span class="profile-overview__identity-label">' + escapeHtml(label) + "</span>" +
                '<span class="profile-overview__identity-value">' + escapeHtml(toStr(value).trim() || "-") + "</span></div>";
        };

        const overviewQuickItems = trackingMode === "regularWar"
            ? [
                renderSummaryItem("Roster status", rosterSlot, { tone: placementTone }),
                renderSummaryItem("War state", regularWarStateLabel),
                renderSummaryItem("Current attacks", regularCurrentAttacksLabel, {
                    tone: regularWar.currentWarState === "inwar" && regularWar.current.attacksRemaining > 0 ? "alert" : "",
                }),
                renderSummaryItem("Current stars", regularCurrentStarsLabel, {
                    subText: regularCurrentAvgDestructionLabel !== "-" ? ("Avg " + regularCurrentAvgDestructionLabel) : "",
                }),
            ]
            : [
                renderSummaryItem("Roster status", rosterSlot, { tone: placementTone }),
                renderSummaryItem("CWL stars", cwlStarsLabel, {
                    tone: cwl.possibleStars > 0 ? (cwl.starsTotal < 8 ? "alert" : "success") : "",
                }),
                renderSummaryItem("Avg destruction", cwlAvgDestructionLabel),
                suggestion
                    ? renderSummaryItem("Suggestion", suggestion.statusLabel, { tone: suggestion.status === "out" ? "warning" : "success" })
                    : renderSummaryItem("Attacks made", cwlAttacksLabel),
            ];

        const overviewDangerNotices = [];
        const overviewInfoNotices = [];
        const overviewNoteNotices = [];
        for (let i = 0; i < localNotes.length; i++) {
            overviewNoteNotices.push(renderNotice("Roster note", localNotes[i], "note"));
        }
        if (trackingMode === "cwl" && suggestion && suggestion.noteText) {
            overviewNoteNotices.push(renderNotice("Suggestion note", suggestion.noteText, "note"));
        }
        if (storedThMismatch) {
            overviewInfoNotices.push(renderNotice("TH mismatch", "Stored TH and official TH differ.", "warning"));
        }
        if (officialNameDiffers) {
            overviewInfoNotices.push(renderNotice("Official name mismatch", "Official profile name differs from local roster name.", "warning"));
        }
        if (trackingMode === "regularWar") {
            if (regularWar.currentWarUnavailableReason === "privateWarLog") {
                overviewInfoNotices.push(renderNotice("Live war data", "Unavailable because the clan war log is private.", "warning"));
            }
            if (regularWar.aggregateStatusLevel === "warning" && regularWar.aggregateStatusMessage) {
                overviewInfoNotices.push(renderNotice("Aggregate status", regularWar.aggregateStatusMessage, "warning"));
            }
            if (regularWar.currentWarState === "inwar" && regularWar.current.attacksRemaining > 0) {
                overviewDangerNotices.push(renderNotice("Pending attacks", formatNumber(regularWar.current.attacksRemaining) + " attacks remaining in the current war.", "alert"));
            }
            if (regularWar.current.missedAttacks > 0) {
                overviewDangerNotices.push(renderNotice("Missed attacks", "Missed " + formatNumber(regularWar.current.missedAttacks) + " attacks.", "alert"));
            }
        } else {
            if (cwl.currentWarAttackPending >= 1) overviewDangerNotices.push(renderNotice("Pending attack", "Current CWL attack pending.", "alert"));
            if (cwl.missedAttacks > 0) overviewDangerNotices.push(renderNotice("Missed attacks", "Missed " + formatNumber(cwl.missedAttacks) + " attacks.", "alert"));
            if (cwl.possibleStars > 0 && cwl.starsTotal < 8) overviewDangerNotices.push(renderNotice("Reward target", "Below 8-star CWL threshold.", "alert"));
        }

        const renderNoticeRow = (itemsRaw, toneRaw) => {
            const items = Array.isArray(itemsRaw) ? itemsRaw.filter(Boolean) : [];
            if (!items.length) return "";
            return '<div class="profile-overview__notice-row profile-overview__notice-row--' + escapeAttr(toStr(toneRaw).trim() || "note") + '">' + items.join("") + "</div>";
        };

        const overviewHtml = [
            '<section class="profile-overview">',
            '<div class="profile-overview__layout">',
            '<div class="profile-overview__identity">',
            '<div class="profile-overview__identity-head">',
            '<div class="profile-overview__th-wrap">', renderTownHallBadge(townHallLevel, player.townHallWeaponLevel), "</div>",
            '<div class="profile-overview__identity-copy"><h2 class="profile-overview__name">', escapeHtml(displayName), '</h2><div class="profile-overview__tag">', escapeHtml(tag || "-"), "</div></div>",
            "</div>",
            '<div class="profile-overview__identity-meta">',
            renderOverviewIdentityLine("Discord", discordLabel),
            renderOverviewIdentityLine("Clan", clanDisplay),
            renderOverviewIdentityLine("Home league", leagueName || "Unranked"),
            renderOverviewIdentityLine("Clan role", roleLabel || "Member"),
            "</div>",
            '<div class="profile-overview__actions">', actionButtons.join(""), "</div>",
            "</div>",
            '<aside class="profile-overview__snapshot"><div class="profile-overview__snapshot-title">Quick snapshot</div><div class="profile-overview__snapshot-grid">', overviewQuickItems.join(""), "</div></aside>",
            "</div>",
            renderNoticeRow(overviewDangerNotices, "danger"),
            renderNoticeRow(overviewInfoNotices, "warning"),
            renderNoticeRow(overviewNoteNotices, "note"),
            "</section>",
        ].join("");
        const heroHtml = overviewHtml;

        const localInfoCards = context && context.player ? [
            renderMetaCard("Roster name", context.rosterTitle || "-", {
                emptyText: "Not assigned",
                subText: context.rosterId ? ("Roster ID " + context.rosterId) : "",
            }),
            renderMetaCard("Roster status", placementLabel, { alert: role === "sub" || role === "missing" }),
            renderMetaCard("Discord", discordLabel, { emptyText: "Not set" }),
            renderMetaCard("Stored TH", localStoredThLabel, {
                alert: storedThMismatch,
                subText: storedThMismatch ? ("Official TH" + formatNumber(toNonNegativeInt(townHallLevel))) : "",
            }),
            trackingMode === "cwl"
                ? renderMetaCard("Suggestion status", suggestion ? suggestion.statusLabel : "None", {
                    emptyText: "None",
                    alert: suggestion && suggestion.status === "out",
                })
                : renderMetaCard("Current war state", regularWarStateLabel),
            officialNameDiffers ? renderMetaCard("Official name", player.name, { alert: true }) : "",
            trackingMode === "cwl" && suggestion && suggestion.noteText ? renderMetaCard("Suggestion note", suggestion.noteText) : "",
        ].filter(Boolean).join("") : "";

        const cwlStatsHtml = [
            renderStatCard("CWL season", cwl.season || "-"),
            renderStatCard("CWL stars", cwlStarsLabel, {
                progress: cwl.starsPerf,
                alert: cwl.possibleStars > 0 && cwl.starsTotal < 8,
            }),
            renderStatCard("Avg destruction", cwlAvgDestructionLabel, {
                progress: cwl.avgDestruction != null ? (Number(cwl.avgDestruction) / 100) : null,
            }),
            renderStatCard("Attacks made", cwlAttacksLabel),
            renderStatCard("Missed attacks", formatNumber(cwl.missedAttacks), { alert: cwl.missedAttacks > 0 }),
            renderStatCard("Attack pending", cwl.currentWarAttackPending >= 1 ? "Yes" : "No", { alert: cwl.currentWarAttackPending >= 1 }),
            renderStatCard("Reward threshold", cwl.possibleStars > 0 ? (cwl.starsTotal >= 8 ? "Met" : "Below 8 stars") : "N/A", {
                alert: cwl.possibleStars > 0 && cwl.starsTotal < 8,
                success: cwl.possibleStars > 0 && cwl.starsTotal >= 8,
            }),
            renderStatCard("Hit up / same / down", formatNumber(cwl.hitUpCount) + " / " + formatNumber(cwl.sameThHitCount) + " / " + formatNumber(cwl.hitDownCount)),
        ].join("");
        const regularWarStatsHtml = [
            renderStatCard("Current war state", regularWarStateLabel),
            renderStatCard("Attacks used / allowed", regularCurrentAttacksLabel),
            renderStatCard("Attacks remaining", regularCurrentRemainingLabel, {
                alert: regularWar.currentWarState === "inwar" && regularWar.current.attacksRemaining > 0,
            }),
            renderStatCard("Current stars", regularCurrentStarsLabel),
            renderStatCard("Avg destruction", regularCurrentAvgDestructionLabel),
            renderStatCard("Missed attacks", formatNumber(regularWar.current.missedAttacks), {
                alert: regularWar.current.missedAttacks > 0,
            }),
            renderStatCard("Pending attacks", regularWar.currentWarState === "inwar" && regularWar.current.attacksRemaining > 0 ? "Yes" : "No", {
                alert: regularWar.currentWarState === "inwar" && regularWar.current.attacksRemaining > 0,
            }),
            renderStatCard("Hit up / same / down", formatNumber(regularWar.current.hitUpCount) + " / " + formatNumber(regularWar.current.sameThHitCount) + " / " + formatNumber(regularWar.current.hitDownCount)),
        ].join("");

        const renderLongTermFocusedStatsCards = (statsRaw, options) => {
            const stats = statsRaw && typeof statsRaw === "object" ? statsRaw : {};
            const opts = options && typeof options === "object" ? options : {};
            return [
                renderStatCard("Participations", formatNumber(opts.participationsValue), {
                    subText: toStr(opts.participationsSubText).trim(),
                }),
                renderStatCard("Attacks made", formatNumber(stats.attacksMade)),
                renderStatCard("Missed attacks", formatNumber(stats.missedAttacks), { alert: stats.missedAttacks > 0 }),
                renderStatCard("Avg stars per attack", stats.avgStarsPerAttack != null ? formatFixed(stats.avgStarsPerAttack, 2) : "-"),
                renderStatCard("Avg destruction per attack", stats.avgDestructionPerAttack != null ? formatPercent(stats.avgDestructionPerAttack, 0) : "-", {
                    progress: stats.avgDestructionPerAttack != null ? (Number(stats.avgDestructionPerAttack) / 100) : null,
                }),
                renderStatCard("Three-star attacks", formatNumber(stats.threeStarCount)),
                renderStatCard("Hit up / same / down", formatNumber(stats.hitUpCount) + " / " + formatNumber(stats.sameThHitCount) + " / " + formatNumber(stats.hitDownCount)),
            ].join("");
        };
        const overallLongTermStatsHtml = renderLongTermFocusedStatsCards(longTerm.overall, {
            participationsValue: longTerm.overall.participationCount,
            participationsSubText: "Regular wars + resolved CWL war days",
        });
        const regularLongTermStatsHtml = renderLongTermFocusedStatsCards(longTerm.regular, {
            participationsValue: longTerm.regular.warsInLineup,
            participationsSubText: "Regular wars in lineup",
        });
        const cwlLongTermStatsHtml = renderLongTermFocusedStatsCards(longTerm.cwl, {
            participationsValue: longTerm.cwl.resolvedWarDays,
            participationsSubText: "Resolved CWL war days",
        });
        const longTermCoverageParts = [];
        if (longTerm.meta.finalizedRegularWarCount > 0 || longTerm.meta.finalizedCwlWarCount > 0) {
            longTermCoverageParts.push(
                "Regular wars finalized " + formatNumber(longTerm.meta.finalizedRegularWarCount) +
                " | CWL wars finalized " + formatNumber(longTerm.meta.finalizedCwlWarCount)
            );
        }
        if (longTerm.meta.lastSuccessfulLongTermFinalizationAt) {
            longTermCoverageParts.push("Last long-term update " + formatProfileTimestamp(longTerm.meta.lastSuccessfulLongTermFinalizationAt));
        }
        const longTermCoverageNotice = longTermCoverageParts.length
            ? renderNotice("Long-term coverage", longTermCoverageParts.join(" | "), "info")
            : "";
        const longTermHistoryBodyHtml = longTerm.hasAnyHistory
            ? [
                longTermCoverageNotice,
                '<div class="profile-longterm" data-longterm-segmented="1" data-longterm-default="overall">',
                '<div class="profile-longterm__controls" role="group" aria-label="Long-term view">',
                '<button type="button" class="profile-longterm__toggle is-active" data-longterm-segment="overall" aria-pressed="true">Overall</button>',
                '<button type="button" class="profile-longterm__toggle" data-longterm-segment="regular" aria-pressed="false">Regular</button>',
                '<button type="button" class="profile-longterm__toggle" data-longterm-segment="cwl" aria-pressed="false">CWL</button>',
                "</div>",
                '<div class="profile-longterm__panel is-active" data-longterm-panel="overall" aria-hidden="false">',
                '<div class="profile-stats-grid profile-stats-grid--dense">', overallLongTermStatsHtml, "</div>",
                "</div>",
                '<div class="profile-longterm__panel" data-longterm-panel="regular" aria-hidden="true" hidden>',
                '<div class="profile-stats-grid profile-stats-grid--dense">', regularLongTermStatsHtml, "</div>",
                "</div>",
                '<div class="profile-longterm__panel" data-longterm-panel="cwl" aria-hidden="true" hidden>',
                '<div class="profile-stats-grid profile-stats-grid--dense">', cwlLongTermStatsHtml, "</div>",
                "</div>",
                "</div>",
            ].join("")
            : '<div class="profile-empty">No finalized long-term war history is stored for this player yet.</div>';

        const cwlPreviewItems = [
            renderSummaryItem("CWL stars", cwlStarsLabel, { tone: cwl.possibleStars > 0 ? (cwl.starsTotal < 8 ? "alert" : "success") : "" }),
            suggestion
                ? renderSummaryItem("Suggestion", suggestion.statusLabel, { tone: suggestion.status === "out" ? "warning" : "success" })
                : renderSummaryItem("Attacks made", cwlAttacksLabel),
        ];
        const regularWarPreviewItems = [
            renderSummaryItem("Roster", context && context.player ? placementLabel : "-", { tone: placementTone }),
            renderSummaryItem("Live status", liveStatusMeta.text, { tone: liveStatusMeta.tone }),
        ];
        const longTermPreviewItems = [
            renderSummaryItem("Participations", formatNumber(longTerm.overall.participationCount)),
            renderSummaryItem("Avg stars/atk", longTerm.overall.avgStarsPerAttack != null ? formatFixed(longTerm.overall.avgStarsPerAttack, 2) : "-"),
        ];
        const trackingPreviewItems = trackingMode === "regularWar" ? regularWarPreviewItems : cwlPreviewItems;
        const trackingStatsHtml = trackingMode === "regularWar" ? regularWarStatsHtml : cwlStatsHtml;
        const trackingStatsTitle = "Live war/CWL context";
        const trackingDisclosureTitle = "Current context";
        const trackingDisclosureSubtitle = trackingMode === "regularWar"
            ? "Roster context and live regular-war details."
            : (cwl.season ? ("Roster context and season " + cwl.season + " CWL details.") : "Roster context and live CWL details.");
        const trackingDisclosureSource = trackingMode === "regularWar" ? "Local roster + current regular war" : "Local roster + current CWL season";
        const longTermDisclosureTitle = "Long-term performance";
        const longTermDisclosureSubtitle = "Segmented history across Overall, Regular, and CWL.";
        const longTermDisclosureSource = "Shared warPerformance history";
        const liveContextWarningNotices = [];
        if (trackingMode === "regularWar") {
            if (regularWar.currentWarUnavailableReason === "privateWarLog") {
                liveContextWarningNotices.push(renderNotice("Live war data", "Unavailable because the clan war log is private.", "warning"));
            }
            if (regularWar.aggregateStatusLevel === "warning" && regularWar.aggregateStatusMessage) {
                liveContextWarningNotices.push(renderNotice("Aggregate status", regularWar.aggregateStatusMessage, "warning"));
            }
        } else if (cwl.possibleStars > 0 && cwl.starsTotal < 8) {
            liveContextWarningNotices.push(renderNotice("Reward target", "Below the 8-star CWL threshold.", "warning"));
        }

        const trackingRosterBodyHtml = [
            '<div class="profile-section-grid profile-section-grid--two">',
            '<div class="profile-subsection profile-subsection--dense">',
            '<div class="profile-subsection__title">Roster context</div>',
            '<div class="profile-meta-grid">', localInfoCards || '<div class="profile-empty">No local roster details are available.</div>', "</div>",
            "</div>",
            '<div class="profile-subsection profile-subsection--dense">',
            '<div class="profile-subsection__title">', escapeHtml(trackingStatsTitle), "</div>",
            liveContextWarningNotices.length ? ('<div class="profile-overview__notice-row profile-overview__notice-row--warning">' + liveContextWarningNotices.join("") + "</div>") : "",
            '<div class="profile-stats-grid profile-stats-grid--dense">', trackingStatsHtml, "</div>",
            "</div>",
            "</div>",
        ].join("");

        if (mode === "error") {
            const rosterBody = trackingRosterBodyHtml +
                '<div class="profile-error-panel"><div class="profile-error-panel__title">Unable to load official profile data</div><div class="profile-error-panel__body">' +
                escapeHtml(errorText || "Unknown error.") + "</div></div>";
            const localSections = [
                renderDisclosureSection({
                    title: trackingDisclosureTitle,
                    subtitle: "Local roster details remain available even when the official profile request fails.",
                    source: trackingDisclosureSource,
                    summaryItems: trackingPreviewItems,
                    bodyHtml: rosterBody,
                    open: true,
                }),
                renderDisclosureSection({
                    title: longTermDisclosureTitle,
                    subtitle: longTermDisclosureSubtitle,
                    source: longTermDisclosureSource,
                    summaryItems: longTermPreviewItems,
                    bodyHtml: longTermHistoryBodyHtml,
                    open: false,
                }),
            ].join("");
            profileState.bodyEl.innerHTML = heroHtml + localSections;
            syncProfileDisclosureState(profileState.bodyEl);
            initLongTermSegmentedSections(profileState.bodyEl);
            return;
        }

        const renderOfficialSnapshotGroup = (title, cards) =>
            '<div class="profile-subsection profile-subsection--dense"><div class="profile-subsection__title">' + escapeHtml(title) +
            '</div><div class="profile-stats-grid profile-stats-grid--dense">' + cards.join("") + "</div></div>";
        const officialSnapshotBodyHtml = [
            '<div class="profile-section-grid">',
            renderOfficialSnapshotGroup("Combat", [
                renderStatCard("Trophies", formatNumber(player.trophies)),
                renderStatCard("Best trophies", formatNumber(player.bestTrophies)),
                renderStatCard("War stars", formatNumber(player.warStars)),
                renderStatCard("Attack wins", formatNumber(player.attackWins)),
                renderStatCard("Defense wins", formatNumber(player.defenseWins)),
            ]),
            renderOfficialSnapshotGroup("Contribution", [
                renderStatCard("Donations", formatNumber(player.donations)),
                renderStatCard("Donations received", formatNumber(player.donationsReceived)),
                renderStatCard("Clan capital contributions", formatNumber(player.clanCapitalContributions)),
            ]),
            renderOfficialSnapshotGroup("Account", [
                renderStatCard("Exp level", formatNumber(player.expLevel)),
                renderStatCard("Builder Hall", builderHall > 0 ? ("BH" + builderHall) : "-"),
                renderStatCard("Builder trophies", formatNumber(player.versusTrophies)),
            ]),
            "</div>",
        ].join("");

        // Build army village.
        const buildArmyVillageData = (key) => {
            const isBuilder = key === "builderBase";
            const heroes = sortArmyItems((player.heroes || []).filter((item) => toStr(item && item.village).toLowerCase().indexOf(isBuilder ? "builder" : "home") >= 0 || (!item.village && !isBuilder)), "heroes", key);
            const troops = sortArmyItems((player.troops || []).filter((item) => toStr(item && item.village).toLowerCase().indexOf(isBuilder ? "builder" : "home") >= 0 || (!item.village && !isBuilder)), "troops", key);
            const spells = isBuilder ? [] : sortArmyItems((player.spells || []).filter(() => !isBuilder), "spells", key);
            return {
                heroes: heroes,
                troops: troops,
                spells: spells,
                counts: { heroes: heroes.length, troops: troops.length, spells: spells.length },
            };
        };
        const renderVillageUnitRows = (itemsRaw) => {
            const items = Array.isArray(itemsRaw) ? itemsRaw : [];
            return items.map((item) => {
                const level = toNonNegativeInt(item && item.level);
                const maxLevel = toNonNegativeInt(item && item.maxLevel);
                return '<div class="profile-unit-row"><div class="profile-unit-row__top"><div class="profile-unit-row__name">' + escapeHtml(item && item.name) + '</div>' +
                    (item && item.superTroopIsActive ? renderChip("Active", "profile-chip--success") : "") +
                    '</div><div class="profile-unit-row__level">Level ' + escapeHtml(formatNumber(level)) + (maxLevel > 0 ? (" / " + escapeHtml(formatNumber(maxLevel))) : "") + '</div>' +
                    (maxLevel > 0 ? renderProgress(level / maxLevel, level >= maxLevel ? "success" : "") : "") + "</div>";
            }).join("");
        };
        const renderVillageGroup = (label, itemsRaw, openByDefault) => {
            const items = Array.isArray(itemsRaw) ? itemsRaw : [];
            if (!items.length) return "";
            return '<details class="profile-village-group"' + (openByDefault ? " open" : "") + '><summary><span class="profile-village-group__title">' +
                escapeHtml(label) + '</span><span class="profile-village-group__count">' + escapeHtml(formatNumber(items.length)) + "</span></summary>" +
                '<div class="profile-unit-list profile-unit-list--dense">' + renderVillageUnitRows(items) + "</div></details>";
        };
        const renderVillageSummaryPill = (label, value) =>
            '<div class="profile-village-summary-pill"><span class="profile-village-summary-pill__label">' + escapeHtml(label) +
            '</span><span class="profile-village-summary-pill__value">' + escapeHtml(value) + "</span></div>";

        const homeArmy = buildArmyVillageData("homeVillage");
        const builderArmy = buildArmyVillageData("builderBase");
        const homeVillageHtml = [
            '<div class="profile-village-card">',
            '<div class="profile-village-card__title">Home Village</div>',
            '<div class="profile-village-summary-grid">',
            renderVillageSummaryPill("Heroes", formatNumber(homeArmy.counts.heroes)),
            renderVillageSummaryPill("Troops", formatNumber(homeArmy.counts.troops)),
            renderVillageSummaryPill("Spells", formatNumber(homeArmy.counts.spells)),
            "</div>",
            renderVillageGroup("Heroes", homeArmy.heroes, true),
            renderVillageGroup("Troops", homeArmy.troops, false),
            renderVillageGroup("Spells", homeArmy.spells, false),
            "</div>",
        ].join("");
        const hasBuilderData = builderHall > 0 || player.versusTrophies != null || player.bestVersusTrophies != null || player.versusBattleWins != null
            || builderArmy.counts.heroes > 0 || builderArmy.counts.troops > 0;
        const builderVillageHtml = hasBuilderData
            ? [
                '<div class="profile-village-card profile-village-card--secondary">',
                '<div class="profile-village-card__title">Builder Base</div>',
                '<div class="profile-village-summary-grid">',
                renderVillageSummaryPill("Builder Hall", builderHall > 0 ? ("BH" + builderHall) : "-"),
                renderVillageSummaryPill("Trophies", formatNumber(player.versusTrophies)),
                renderVillageSummaryPill("Wins", formatNumber(player.versusBattleWins)),
                "</div>",
                renderVillageGroup("Heroes", builderArmy.heroes, false),
                renderVillageGroup("Troops", builderArmy.troops, false),
                "</div>",
            ].join("")
            : "";
        const villageProgressBodyHtml = '<div class="profile-village-grid">' + homeVillageHtml + builderVillageHtml + "</div>";

        const labels = Array.isArray(player.labels) ? player.labels : [];
        const hasLabels = labels.length > 0;
        const labelsHtml = hasLabels
            ? labels.map((label) =>
                '<div class="profile-label-chip">' +
                (label && label.iconUrls && (label.iconUrls.small || label.iconUrls.medium)
                    ? ('<img class="profile-label-chip__icon" alt="" src="' + escapeAttr(label.iconUrls.small || label.iconUrls.medium) + '">')
                    : "") +
                '<span class="profile-label-chip__text">' + escapeHtml(label && label.name) + "</span></div>"
            ).join("")
            : "";

        const achievements = Array.isArray(player.achievements) ? player.achievements : [];
        const hasAchievements = achievements.length > 0;
        const achievementsHtml = hasAchievements
            ? '<details class="profile-achievements"><summary><span class="profile-achievements__summary-title">Show achievements</span>' +
            renderChip(formatNumber(achievements.length), "profile-chip--muted") + "</summary><div class=\"profile-achievement-list\">" +
            achievements.map((item) => {
                const value = Number(item && item.value);
                const target = Number(item && item.target);
                return '<div class="profile-achievement-row"><div class="profile-achievement-row__top"><div class="profile-achievement-row__name">' +
                    escapeHtml(item && item.name) + "</div>" + renderChip(formatNumber(toNonNegativeInt(item && item.stars)) + "/3 stars", "profile-chip--info") +
                    "</div><div class=\"profile-achievement-row__meta\">" +
                    escapeHtml((Number.isFinite(value) || Number.isFinite(target) ? (formatNumber(value) + " / " + formatNumber(target)) : "-") +
                        (item && item.village ? (" • " + titleCase(item.village)) : "")) +
                    "</div>" +
                    (Number.isFinite(value) && Number.isFinite(target) && target > 0 ? renderProgress(value / target, value >= target ? "success" : "") : "") +
                    "</div>";
            }).join("") + "</div></details>"
            : "";

        const legendsJourneySection = renderLegendsJourneySection(player, tag);

        const playerHouse = player.playerHouse && typeof player.playerHouse === "object" ? player.playerHouse : null;
        const houseCards = playerHouse ? Object.keys(playerHouse).map((key) => {
            if (key === "elements" || typeof playerHouse[key] === "object") return "";
            return renderMetaCard(titleCase(key), playerHouse[key]);
        }).join("") + ((Array.isArray(playerHouse.elements) ? playerHouse.elements : []).map((item) =>
            renderMetaCard(titleCase(item && item.type || "Element"), item && (item.name != null ? item.name : item.id))
        ).join("")) : "";
        const hasAccountExtras = hasLabels || hasAchievements || !!houseCards;

        const sections = [
            renderDisclosureSection({
                title: trackingDisclosureTitle,
                subtitle: trackingDisclosureSubtitle,
                source: trackingDisclosureSource,
                summaryItems: trackingPreviewItems,
                bodyHtml: trackingRosterBodyHtml,
                open: true,
            }),
            renderDisclosureSection({
                title: longTermDisclosureTitle,
                subtitle: longTermDisclosureSubtitle,
                source: longTermDisclosureSource,
                summaryItems: longTermPreviewItems,
                bodyHtml: longTermHistoryBodyHtml,
                open: false,
            }),
            renderDisclosureSection({
                title: "Official snapshot",
                subtitle: "Grouped official totals for combat, contribution, and account context.",
                source: "Official Clash data",
                summaryItems: [
                    renderSummaryItem("Trophies", formatNumber(player.trophies)),
                    renderSummaryItem("War stars", formatNumber(player.warStars)),
                ],
                bodyHtml: officialSnapshotBodyHtml,
                open: false,
            }),
            renderDisclosureSection({
                title: "Village progress",
                subtitle: "Home Village first, then Builder Base as lower-priority context.",
                source: "Official Clash data",
                summaryItems: [
                    renderSummaryItem("Home heroes", homeArmy.counts.heroes ? formatNumber(homeArmy.counts.heroes) : "-"),
                    renderSummaryItem("Builder Hall", builderHall > 0 ? ("BH" + builderHall) : "-"),
                ],
                bodyHtml: villageProgressBodyHtml,
                open: false,
            }),
            legendsJourneySection,
            hasAccountExtras ? renderDisclosureSection({
                title: "Account extras",
                subtitle: "Optional account metadata and long-tail profile details.",
                source: "Official Clash data",
                summaryItems: [
                    renderSummaryItem("Labels", formatNumber(labels.length)),
                    renderSummaryItem("Achievements", formatNumber(achievements.length)),
                ],
                bodyHtml: '<div class="profile-section-grid profile-section-grid--two">' +
                    (hasLabels ? ('<div class="profile-subsection profile-subsection--dense"><div class="profile-subsection__title">Labels</div><div class="profile-label-list">' + labelsHtml + "</div></div>") : "") +
                    (hasAchievements ? ('<div class="profile-subsection profile-subsection--dense"><div class="profile-subsection__title">Achievements</div>' + achievementsHtml + "</div></div>") : "") +
                    (houseCards ? ('<div class="profile-subsection profile-subsection--dense"><div class="profile-subsection__title">Player House</div><div class="profile-meta-grid">' + houseCards + "</div></div>") : "") +
                    "</div>",
                sectionClass: "profile-disclosure--secondary",
                open: false,
            }) : "",
        ].filter(Boolean).join("");

        profileState.bodyEl.innerHTML = heroHtml + sections;
        syncProfileDisclosureState(profileState.bodyEl);
        initLongTermSegmentedSections(profileState.bodyEl);
        initLegendsJourneySections(profileState.bodyEl);
    };

    // Normalize admin API endpoint.
    const normalizeAdminApiEndpoint = (valueRaw) => {
        const value = toStr(valueRaw).trim();
        if (!value) return "";
        if (/^https?:\/\//i.test(value) || value.startsWith("/")) return value;
        return "";
    };

    // Resolve Script server base URL.
    const resolveScriptServerBaseUrl = () => {
        const value = toStr(
            (typeof window !== "undefined" && window && (window.ROSTER_BASE_URL || window.BASE_URL))
                ? (window.ROSTER_BASE_URL || window.BASE_URL)
                : ""
        ).trim();
        if (!/^https?:\/\//i.test(value)) return "";
        return value;
    };

    // Return whether likely worker admin API endpoint.
    const isLikelyWorkerAdminApiEndpoint = (endpointRaw) => {
        const endpoint = toStr(endpointRaw).trim().toLowerCase();
        if (!endpoint) return false;
        return endpoint.indexOf("/api/admin") >= 0;
    };

    // Return whether absolute http endpoint.
    const isAbsoluteHttpEndpoint = (endpointRaw) =>
        /^https?:\/\//i.test(toStr(endpointRaw).trim());

    // Resolve admin API endpoints.
    const resolveAdminApiEndpoints = () => {
        const configured = normalizeAdminApiEndpoint(
            typeof window !== "undefined" && window
                ? window.ROSTER_ADMIN_API_BASE
                : ""
        );
        const endpoints = [];
        const seen = Object.create(null);
        // Push a value only when it is not already present.
        const pushUnique = (endpointRaw) => {
            const endpoint = normalizeAdminApiEndpoint(endpointRaw);
            if (!endpoint) return;
            if (seen[endpoint]) return;
            seen[endpoint] = true;
            endpoints.push(endpoint);
        };

        pushUnique(configured || "/api/admin");
        pushUnique(resolveScriptServerBaseUrl());
        return endpoints;
    };

    // Create an admin API error.
    const createAdminApiError = (messageRaw, retryableRaw) => {
        const err = new Error(toStr(messageRaw).trim() || "Admin API call failed.");
        err.retryable = !!retryableRaw;
        return err;
    };

    // Handle call admin API endpoint.
    const callAdminApiEndpoint = async (endpoint, methodName, args) => {
        let response = null;
        let rawText = "";
        const payloadText = JSON.stringify({
            method: methodName,
            args: Array.isArray(args) ? args : [],
        });
        const isCrossOrigin = isAbsoluteHttpEndpoint(endpoint);
        try {
            response = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": isCrossOrigin ? "text/plain;charset=utf-8" : "application/json",
                },
                body: payloadText,
                redirect: "follow",
            });
            rawText = await response.text();
        } catch (err) {
            const endpointIsProxy = isLikelyWorkerAdminApiEndpoint(endpoint);
            const msg = err && err.message
                ? err.message
                : ("Network error while calling " + methodName + ".");
            throw createAdminApiError(msg, endpointIsProxy);
        }

        let payload = null;
        try {
            payload = JSON.parse(rawText);
        } catch {
            payload = null;
        }

        // Handle infer upstream error.
        const inferUpstreamError = () => {
            const text = toStr(rawText).toLowerCase();
            if (response.status === 404 && isLikelyWorkerAdminApiEndpoint(endpoint)) {
                return "Admin API route is missing at /api/admin. Falling back to Apps Script endpoint.";
            }
            if (!text) return "";
            if (text.indexOf("script-funktion nicht gefunden: dopost") >= 0 || text.indexOf("script function not found: dopost") >= 0) {
                return "Apps Script is missing doPost. Deploy the latest script version and redeploy the web app.";
            }
            return "";
        };

        const endpointIsProxy = isLikelyWorkerAdminApiEndpoint(endpoint);
        if (!response.ok) {
            const msg = payload && payload.error
                ? toStr(payload.error).trim()
                : (inferUpstreamError() || ("HTTP " + response.status + " while calling " + methodName + "."));
            const retryable = endpointIsProxy && (response.status === 404 || response.status === 405 || response.status >= 500);
            throw createAdminApiError(msg, retryable);
        }
        if (!payload || payload.ok !== true) {
            const msg = payload && payload.error
                ? toStr(payload.error).trim()
                : (inferUpstreamError() || ("Server method failed: " + methodName));
            const retryable = endpointIsProxy && !payload;
            throw createAdminApiError(msg || ("Server method failed: " + methodName), retryable);
        }
        return payload.result;
    };

    // Handle run server method via http.
    const runServerMethodViaHttp = async (methodName, args) => {
        const endpoints = resolveAdminApiEndpoints();
        let lastError = null;
        for (let i = 0; i < endpoints.length; i++) {
            const endpoint = endpoints[i];
            try {
                return await callAdminApiEndpoint(endpoint, methodName, args);
            } catch (err) {
                lastError = err;
                const hasNext = i < endpoints.length - 1;
                if (!hasNext || !(err && err.retryable)) {
                    throw err;
                }
            }
        }
        if (lastError) throw lastError;
        throw new Error("No admin API endpoints are configured.");
    };

    // Handle run server method.
    const runServerMethod = (methodName, args) =>
        new Promise((resolve, reject) => {
            if (window.google && google.script && google.script.run) {
                const runner = google.script.run
                    .withSuccessHandler(resolve)
                    .withFailureHandler((err) => reject(err && err.message ? new Error(err.message) : err));
                if (!runner || typeof runner[methodName] !== "function") {
                    reject(new Error("Server method is not available: " + methodName));
                    return;
                }
                runner[methodName](...(Array.isArray(args) ? args : []));
                return;
            }
            runServerMethodViaHttp(methodName, args).then(resolve).catch(reject);
        });

    // Ensure the local/static league icon cache is warm for this player.
    const requestLeagueIcon = (playerRaw) => {
        const source = extractHomeLeagueBadgeSource(playerRaw);
        if (!source || !source.name) return;
        getLocalLeagueIconSource(source.fallbackAssetFamily);
    };

    // Handle request town hall icon.
    const requestTownHallIcon = (levelRaw) => {
        const level = toNonNegativeInt(levelRaw);
        if (level < 1 || level > 18) return;
        if (Object.prototype.hasOwnProperty.call(townHallIconCache, level)) return;

        townHallIconCache[level] = getTownHallIconUrl(level);
        if (profileState.open && profileState.activeTag && profileCache[profileState.activeTag]) {
            renderProfileContent(profileState.activeContext, profileCache[profileState.activeTag], "ready");
        }
    };

    // Set active profile trigger.
    const setActiveProfileTrigger = (triggerEl) => {
        if (profileState.triggerEl && profileState.triggerEl.setAttribute) {
            profileState.triggerEl.setAttribute("aria-expanded", "false");
        }
        profileState.triggerEl = triggerEl && triggerEl.setAttribute ? triggerEl : null;
        if (profileState.triggerEl) {
            profileState.triggerEl.setAttribute("aria-expanded", "true");
        }
    };

    // Handle lock body scroll.
    const lockBodyScroll = () => {
        const body = document.body;
        if (!body) return;
        profileState.bodyOverflow = body.style.overflow;
        profileState.bodyPaddingRight = body.style.paddingRight;
        const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
        body.classList.add("profile-modal-open");
        body.style.overflow = "hidden";
        if (scrollbarWidth > 0) body.style.paddingRight = scrollbarWidth + "px";
    };

    // Unlock body scroll.
    const unlockBodyScroll = () => {
        const body = document.body;
        if (!body) return;
        body.classList.remove("profile-modal-open");
        body.style.overflow = profileState.bodyOverflow || "";
        body.style.paddingRight = profileState.bodyPaddingRight || "";
    };

    // Set profile disclosure state.
    const setProfileDisclosureState = (section, open) => {
        if (!section) return;
        const summary = section.querySelector(".profile-disclosure__summary[data-profile-section-toggle='1']");
        const body = section.querySelector(".profile-disclosure__body");
        if (!summary || !body) return;
        const isOpen = !!open;
        section.classList.toggle("is-open", isOpen);
        summary.setAttribute("aria-expanded", isOpen ? "true" : "false");
        body.setAttribute("aria-hidden", isOpen ? "false" : "true");
    };

    // Sync profile disclosure state.
    const syncProfileDisclosureState = (container) => {
        if (!container || !container.querySelectorAll) return;
        container.querySelectorAll(".profile-disclosure").forEach((section) => {
            const summary = section.querySelector(".profile-disclosure__summary[data-profile-section-toggle='1']");
            const body = section.querySelector(".profile-disclosure__body");
            if (!summary || !body) return;
            if (!summary.dataset.profileToggleBound) {
                summary.dataset.profileToggleBound = "1";
                summary.addEventListener("click", (event) => {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    const parentSection = summary.closest(".profile-disclosure");
                    const isOpen = parentSection
                        ? (parentSection.classList.contains("is-open")
                            || summary.getAttribute("aria-expanded") === "true")
                        : false;
                    if (parentSection) setProfileDisclosureState(parentSection, !isOpen);
                });
            }
            const shouldOpen = summary.getAttribute("aria-expanded") === "true" || section.classList.contains("is-open");
            setProfileDisclosureState(section, shouldOpen);
        });
    };

    // Ensure profile modal.
    const ensureProfileModal = () => {
        if (profileState.root) return profileState.root;

        const root = el("div", "profile-modal");
        root.id = PROFILE_MODAL_ID;
        root.setAttribute("aria-hidden", "true");
        root.innerHTML = [
            '<div class="profile-modal__backdrop" data-profile-dismiss="backdrop"></div>',
            '<div class="profile-modal__panel glass-surface glass-surface--strong" role="dialog" aria-modal="true" aria-labelledby="' + PROFILE_MODAL_ID + 'Title">',
            '<div class="profile-modal__topbar glass-surface glass-surface--soft">',
            '<div class="profile-modal__topbar-main">',
            '<div class="profile-modal__topbar-id">',
            '<div class="profile-modal__topbar-league" data-profile-topbar-league="1"></div>',
            '<div class="profile-modal__topbar-th" data-profile-topbar-th="1"></div>',
            '<div class="profile-modal__title-wrap"><div class="profile-modal__title" id="' + PROFILE_MODAL_ID + 'Title">Player profile</div><div class="profile-modal__subtitle" data-profile-topbar-tag="1">-</div></div>',
            '</div>',
            '<div class="profile-modal__topbar-meta"><div class="profile-modal__topbar-status" data-profile-topbar-status="1"></div><div class="profile-modal__topbar-form" data-profile-topbar-form="1"></div></div>',
            '</div>',
            '<button type="button" class="profile-modal__close" data-profile-dismiss="close" aria-label="Close player profile">Close</button>',
            '</div>',
            '<div class="profile-modal__body"></div>',
            '</div>',
        ].join("");

        root.addEventListener("click", (event) => {
            const eventTarget = event.target && event.target.nodeType === 1
                ? event.target
                : (event.target && event.target.parentElement ? event.target.parentElement : null);
            const dismiss = eventTarget && eventTarget.closest ? eventTarget.closest("[data-profile-dismiss]") : null;
            if (dismiss) {
                closeProfileModal();
                return;
            }
            const edit = eventTarget && eventTarget.closest ? eventTarget.closest("[data-profile-edit='1']") : null;
            if (!edit) return;
            if (typeof window === "undefined" || typeof window.ROSTER_OPEN_PLAYER_EDIT !== "function" || !profileState.activeTag) return;
            closeProfileModal({ restoreFocus: false });
            window.ROSTER_OPEN_PLAYER_EDIT({
                tag: profileState.activeTag,
                rosterId: profileState.activeRosterId,
                reopenProfile: true,
            });
        });

        document.body.appendChild(root);
        profileState.root = root;
        profileState.titleEl = root.querySelector(".profile-modal__title");
        profileState.subtitleEl = root.querySelector("[data-profile-topbar-tag='1']");
        profileState.topbarLeagueEl = root.querySelector("[data-profile-topbar-league='1']");
        profileState.topbarThEl = root.querySelector("[data-profile-topbar-th='1']");
        profileState.topbarStatusEl = root.querySelector("[data-profile-topbar-status='1']");
        profileState.topbarFormEl = root.querySelector("[data-profile-topbar-form='1']");
        profileState.bodyEl = root.querySelector(".profile-modal__body");
        profileState.closeEl = root.querySelector(".profile-modal__close");
        return root;
    };

    // Close profile modal.
    const closeProfileModal = (opts) => {
        const options = opts && typeof opts === "object" ? opts : {};
        if (!profileState.open || !profileState.root) return;
        profileState.open = false;
        profileState.requestToken++;
        profileState.root.classList.remove("is-open");
        profileState.root.setAttribute("aria-hidden", "true");
        unlockBodyScroll();

        const focusTarget = profileState.triggerEl && document.contains(profileState.triggerEl) ? profileState.triggerEl : null;
        setActiveProfileTrigger(null);
        profileState.activeTag = "";
        profileState.activeRosterId = "";
        profileState.activeContext = null;

        if (options.restoreFocus !== false && focusTarget) focusTarget.focus();
    };

    // Open profile modal.
    const openProfileModal = (ctx, triggerEl) => {
        const context = ctx && typeof ctx === "object" ? ctx : null;
        const tag = normalizeClanTag(context && context.player && context.player.tag);
        if (!tag) return;

        ensureProfileModal();
        profileState.open = true;
        profileState.activeTag = tag;
        profileState.activeRosterId = toStr(context && context.rosterId).trim();
        profileState.activeContext = context;
        profileState.requestToken++;
        const requestToken = profileState.requestToken;
        setActiveProfileTrigger(triggerEl);

        const wasOpen = profileState.root.classList.contains("is-open");
        profileState.root.classList.add("is-open");
        profileState.root.setAttribute("aria-hidden", "false");
        if (!wasOpen) {
            lockBodyScroll();
            window.setTimeout(() => {
                if (profileState.open && profileState.closeEl) profileState.closeEl.focus();
            }, 0);
        }

        if (profileCache[tag]) {
            renderProfileContent(context, profileCache[tag], "ready");
            return;
        }

        renderProfileContent(context, null, "loading");

        const request = profilePending[tag] || runServerMethod("getPlayerProfile", [tag, getAdminPassword()]);
        profilePending[tag] = request;

        request
            .then((response) => {
                delete profilePending[tag];
                if (!response || !response.ok) throw new Error("Player profile response is invalid.");
                profileCache[tag] = response;
                if (!profileState.open || requestToken !== profileState.requestToken || profileState.activeTag !== tag) return;
                profileState.activeContext = findPlayerContext(tag, profileState.activeRosterId) || context;
                renderProfileContent(profileState.activeContext, response, "ready");
            })
            .catch((err) => {
                delete profilePending[tag];
                if (!profileState.open || requestToken !== profileState.requestToken || profileState.activeTag !== tag) return;
                let message = err && err.message ? err.message : String(err);
                if (window.ROSTER_ADMIN_MODE && !getAdminPassword() && message.toLowerCase().indexOf("not authorized") >= 0) {
                    message += " Unlock admin to inspect unpublished preview tags.";
                }
                renderProfileContent(context, null, "error", message);
            });
    };

    // Sync profile modal from render.
    const syncProfileModalFromRender = () => {
        if (!profileState.open || !profileState.activeTag) return;
        profileState.activeContext = findPlayerContext(profileState.activeTag, profileState.activeRosterId) || profileState.activeContext;
        if (profileCache[profileState.activeTag]) {
            renderProfileContent(profileState.activeContext, profileCache[profileState.activeTag], "ready");
        }
    };

    // Bind profile UI.
    const bindProfileUi = () => {
        if (profileUiBound) return;
        profileUiBound = true;
        ensureProfileModal();

        document.addEventListener("click", (event) => {
            const eventTarget = event.target && event.target.nodeType === 1
                ? event.target
                : (event.target && event.target.parentElement ? event.target.parentElement : null);
            const trigger = eventTarget && eventTarget.closest ? eventTarget.closest("[data-player-profile-trigger='1']") : null;
            if (!trigger) return;
            const card = trigger.closest(".player");
            if (!card) return;
            const context = findPlayerContext(card.dataset && card.dataset.tag, card.dataset && card.dataset.rosterId);
            if (!context) return;
            openProfileModal(context, trigger);
        });

        document.addEventListener("keydown", (event) => {
            if (profileState.open && event.key === "Escape") {
                event.preventDefault();
                closeProfileModal();
                return;
            }
            if (event.key !== "Enter" && event.key !== " ") return;
            const eventTarget = event.target && event.target.nodeType === 1
                ? event.target
                : (event.target && event.target.parentElement ? event.target.parentElement : null);
            const trigger = eventTarget && eventTarget.closest ? eventTarget.closest("[data-player-profile-trigger='1']") : null;
            if (!trigger) return;
            const card = trigger.closest(".player");
            if (!card) return;
            const context = findPlayerContext(card.dataset && card.dataset.tag, card.dataset && card.dataset.rosterId);
            if (!context) return;
            event.preventDefault();
            openProfileModal(context, trigger);
        });
    };

    // Handle count players in rosters.
    const countPlayersInRosters = (rosters) => {
        let count = 0;
        for (const roster of rosters) {
            const trackingMode = getRosterTrackingMode(roster);
            const main = Array.isArray(roster && roster.main) ? roster.main : [];
            const subs = Array.isArray(roster && roster.subs) ? roster.subs : [];
            const missing = Array.isArray(roster && roster.missing) ? roster.missing : [];
            count += main.length + subs.length + (trackingMode === "regularWar" ? missing.length : 0);
        }
        return count;
    };

    // Handle player matches query.
    const playerMatchesQuery = (rawPlayer, normalizedQuery) => {
        if (!normalizedQuery) return true;
        const player = normalizePlayer(rawPlayer);
        const name = toStr(player.name).toLowerCase();
        const tag = toStr(player.tag).toLowerCase();
        return name.includes(normalizedQuery) || tag.includes(normalizedQuery);
    };

    // Handle filter rosters by query.
    const filterRostersByQuery = (rosters, rawQuery) => {
        const query = toStr(rawQuery).trim().toLowerCase();
        if (!query) {
            return {
                query,
                rosters,
                matchedPlayers: countPlayersInRosters(rosters),
            };
        }

        const filtered = [];
        let matchedPlayers = 0;

        for (const roster of rosters) {
            const trackingMode = getRosterTrackingMode(roster);
            const main = (Array.isArray(roster && roster.main) ? roster.main : []).filter((p) => playerMatchesQuery(p, query));
            const subs = (Array.isArray(roster && roster.subs) ? roster.subs : []).filter((p) => playerMatchesQuery(p, query));
            const missing = trackingMode === "regularWar"
                ? (Array.isArray(roster && roster.missing) ? roster.missing : []).filter((p) => playerMatchesQuery(p, query))
                : [];

            if (!main.length && !subs.length && !missing.length) continue;

            matchedPlayers += main.length + subs.length + (trackingMode === "regularWar" ? missing.length : 0);
            const nextRoster = Object.assign({}, roster, {
                trackingMode,
                main,
                subs,
                badges: trackingMode === "regularWar"
                    ? { main: main.length, subs: subs.length, missing: missing.length }
                    : { main: main.length, subs: subs.length },
            });
            if (trackingMode === "regularWar") nextRoster.missing = missing;
            filtered.push(nextRoster);
        }

        return {
            query,
            rosters: filtered,
            matchedPlayers,
        };
    };

    // Update search info.
    const updateSearchInfo = (ctx) => {
        const info = $("#rosterSearchInfo");
        const clearBtn = $("#clearRosterSearchBtn");
        const hasQuery = !!(ctx && ctx.query);

        if (clearBtn) clearBtn.classList.toggle("hidden", !hasQuery);
        if (!info) return;

        const totalPlayers = (ctx && Number.isFinite(ctx.totalPlayers)) ? ctx.totalPlayers : 0;
        const totalRosters = (ctx && Number.isFinite(ctx.totalRosters)) ? ctx.totalRosters : 0;
        const matchedPlayers = (ctx && Number.isFinite(ctx.matchedPlayers)) ? ctx.matchedPlayers : 0;
        const matchedRosters = (ctx && Number.isFinite(ctx.matchedRosters)) ? ctx.matchedRosters : 0;

        if (!hasQuery) {
            info.textContent =
                "Showing all " + totalPlayers + " " + pluralize(totalPlayers, "player", "players") +
                " in " + totalRosters + " " + pluralize(totalRosters, "roster", "rosters") + ".";
            return;
        }

        info.textContent =
            "Showing " + matchedPlayers + " matching " + pluralize(matchedPlayers, "player", "players") +
            " in " + matchedRosters + " " + pluralize(matchedRosters, "roster", "rosters") + ".";
    };

    // Convert roster identity text into a stable URL-safe anchor fragment.
    const slugifyRosterAnchorPart = (valueRaw) => {
        const raw = toStr(valueRaw).trim().toLowerCase();
        if (!raw) return "";
        const normalized = typeof raw.normalize === "function" ? raw.normalize("NFKD") : raw;
        return normalized
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 56)
            .replace(/-+$/g, "");
    };

    // Build the ordered roster navigator model with collision-safe anchors.
    const buildRosterNavigatorModels = (rostersRaw) => {
        const rosters = Array.isArray(rostersRaw) ? rostersRaw : [];
        const usedAnchors = Object.create(null);
        const models = [];
        for (let i = 0; i < rosters.length; i++) {
            const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
            const title = toStr(roster.title).trim() || ("Roster " + (i + 1));
            const identityPart = slugifyRosterAnchorPart(roster.id) || slugifyRosterAnchorPart(title) || String(i + 1);
            const anchorBase = ROSTER_ANCHOR_PREFIX + identityPart;
            usedAnchors[anchorBase] = (usedAnchors[anchorBase] || 0) + 1;
            const duplicateIndex = usedAnchors[anchorBase];
            models.push({
                roster: roster,
                index: i,
                anchorId: duplicateIndex === 1 ? anchorBase : (anchorBase + "-" + duplicateIndex),
                title: title,
                modeLabel: getRosterTrackingMode(roster) === "regularWar" ? "Regular war" : "CWL",
            });
        }
        return models;
    };

    // Resolve the active roster from ordered section top coordinates.
    const resolveRosterNavigatorActiveIndex = (sectionTopsRaw, markerYRaw, atDocumentEnd) => {
        const sectionTops = Array.isArray(sectionTopsRaw) ? sectionTopsRaw : [];
        if (!sectionTops.length) return -1;
        if (atDocumentEnd) return sectionTops.length - 1;
        const markerY = Number(markerYRaw);
        const safeMarkerY = Number.isFinite(markerY) ? markerY : 0;
        let activeIndex = 0;
        for (let i = 0; i < sectionTops.length; i++) {
            const top = Number(sectionTops[i]);
            if (!Number.isFinite(top)) continue;
            if (top <= safeMarkerY + 1) activeIndex = i;
            else break;
        }
        return activeIndex;
    };

    // Keep the scroll marker below whichever sticky navigation layer is visible.
    const resolveRosterNavigatorMarkerY = (headerBottomRaw, mobileBottomRaw) => {
        const headerBottom = Number(headerBottomRaw);
        const mobileBottom = Number(mobileBottomRaw);
        return Math.max(
            24,
            Number.isFinite(headerBottom) ? headerBottom + 18 : 0,
            Number.isFinite(mobileBottom) ? mobileBottom + 10 : 0,
        );
    };

    // Get static roster navigator elements.
    const getRosterNavigatorRefs = () => ({
        desktop: $("#rosterNavigator"),
        list: $("#rosterNavigatorList"),
        position: $("#rosterNavigatorPosition"),
        mobile: $("#rosterMobileNavigator"),
        select: $("#rosterMobileSelect"),
        shell: $(".public-shell"),
        header: $(".public-header"),
    });

    // Hide or reveal both navigator variants as one feature.
    const setRosterNavigatorVisibility = (isVisible) => {
        const refs = getRosterNavigatorRefs();
        if (refs.desktop) refs.desktop.classList.toggle("hidden", !isVisible);
        if (refs.mobile) refs.mobile.classList.toggle("hidden", !isVisible);
        const layout = $("#rosterBoardLayout");
        if (layout) layout.classList.toggle("has-roster-navigator", !!isVisible);
    };

    // Measure the primary sticky header so secondary navigation never overlaps it.
    const syncRosterNavigatorHeaderOffset = () => {
        const refs = getRosterNavigatorRefs();
        if (!refs.shell || !refs.header || typeof refs.header.getBoundingClientRect !== "function") return;
        const headerHeight = Math.max(0, Math.ceil(refs.header.getBoundingClientRect().height));
        refs.shell.style.setProperty("--roster-sticky-header-height", headerHeight + "px");
        const mobileHeight = refs.mobile && typeof refs.mobile.getBoundingClientRect === "function"
            ? Math.max(0, Math.ceil(refs.mobile.getBoundingClientRect().height))
            : 0;
        if (mobileHeight) refs.shell.style.setProperty("--roster-mobile-navigator-height", mobileHeight + "px");
    };

    // Synchronize the desktop highlight and mobile chooser.
    const syncRosterNavigatorActiveState = (indexRaw) => {
        if (!rosterNavigatorEntries.length) return;
        const index = Math.max(0, Math.min(rosterNavigatorEntries.length - 1, Number(indexRaw) || 0));
        const refs = getRosterNavigatorRefs();
        for (let i = 0; i < rosterNavigatorEntries.length; i++) {
            const entry = rosterNavigatorEntries[i];
            const isActive = i === index;
            if (entry.link) {
                entry.link.classList.toggle("is-current", isActive);
                if (isActive) entry.link.setAttribute("aria-current", "location");
                else entry.link.removeAttribute("aria-current");
            }
        }
        const activeEntry = rosterNavigatorEntries[index];
        if (refs.select && activeEntry && refs.select.value !== activeEntry.model.anchorId) {
            refs.select.value = activeEntry.model.anchorId;
        }
        if (refs.position) {
            refs.position.textContent = String(index + 1).padStart(2, "0") + " / " + String(rosterNavigatorEntries.length).padStart(2, "0");
        }
    };

    // Update the highlighted roster from the current scroll position.
    const updateRosterNavigatorFromScroll = () => {
        rosterNavigatorFrameId = 0;
        if (!rosterNavigatorEntries.length || getEffectivePublicView() !== PUBLIC_VIEW_VALUES.rosters) return;
        const refs = getRosterNavigatorRefs();
        const headerBottom = refs.header && typeof refs.header.getBoundingClientRect === "function"
            ? refs.header.getBoundingClientRect().bottom
            : 0;
        const mobileStyles = refs.mobile && typeof window.getComputedStyle === "function"
            ? window.getComputedStyle(refs.mobile)
            : null;
        const mobileBottom = refs.mobile && mobileStyles && mobileStyles.display !== "none" && !refs.mobile.classList.contains("hidden")
            ? refs.mobile.getBoundingClientRect().bottom
            : 0;
        const markerY = resolveRosterNavigatorMarkerY(headerBottom, mobileBottom);
        const sectionTops = rosterNavigatorEntries.map((entry) => entry.card.getBoundingClientRect().top);
        const documentElement = typeof document !== "undefined" ? document.documentElement : null;
        const atDocumentEnd = !!(
            documentElement &&
            typeof window !== "undefined" &&
            window.scrollY + window.innerHeight >= documentElement.scrollHeight - 2
        );
        syncRosterNavigatorActiveState(resolveRosterNavigatorActiveIndex(sectionTops, markerY, atDocumentEnd));
    };

    // Queue one scrollspy update per animation frame.
    const queueRosterNavigatorScrollSync = () => {
        if (rosterNavigatorFrameId || typeof window === "undefined") return;
        const requestFrame = typeof window.requestAnimationFrame === "function"
            ? window.requestAnimationFrame.bind(window)
            : (callback) => window.setTimeout(callback, 0);
        rosterNavigatorFrameId = requestFrame(updateRosterNavigatorFromScroll);
    };

    // Replace a roster anchor without polluting history when leaving the roster view.
    function clearRosterAnchorHash() {
        if (!readRosterAnchorHash() || typeof window === "undefined" || !window.location) return;
        rosterNavigatorLastHandledHash = "";
        const nextUrl = toStr(window.location.pathname) + toStr(window.location.search);
        if (window.history && typeof window.history.replaceState === "function") {
            window.history.replaceState(null, "", nextUrl || "/");
        }
    }

    // Scroll to one roster and optionally create a direct-link history entry.
    const jumpToRosterAnchor = (anchorRaw, optionsRaw) => {
        const anchorId = parseRosterAnchorHash("#" + toStr(anchorRaw).replace(/^#/, ""));
        if (!anchorId) return false;
        const entry = rosterNavigatorEntries.find((item) => item.model.anchorId === anchorId);
        if (!entry || !entry.card || typeof entry.card.scrollIntoView !== "function") return false;
        const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
        const reduceMotion = typeof window !== "undefined" && typeof window.matchMedia === "function"
            ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
            : false;
        if (options.writeHistory !== false && typeof window !== "undefined" && window.location) {
            const nextUrl = toStr(window.location.pathname) + toStr(window.location.search) + "#" + anchorId;
            if (window.history && typeof window.history.pushState === "function") {
                window.history.pushState(null, "", nextUrl);
            } else {
                window.location.hash = anchorId;
            }
        }
        rosterNavigatorLastHandledHash = anchorId;
        syncRosterNavigatorActiveState(entry.model.index);
        entry.card.scrollIntoView({
            behavior: options.smooth === false || reduceMotion ? "auto" : "smooth",
            block: "start",
        });
        return true;
    };

    // Honor a direct roster URL after cards have rendered.
    const syncRosterNavigatorFromHash = (forceScroll) => {
        const anchorId = readRosterAnchorHash();
        if (!anchorId) return false;
        const entryIndex = rosterNavigatorEntries.findIndex((item) => item.model.anchorId === anchorId);
        if (entryIndex < 0) return false;
        syncRosterNavigatorActiveState(entryIndex);
        if (!forceScroll && rosterNavigatorLastHandledHash === anchorId) return true;
        rosterNavigatorLastHandledHash = anchorId;
        const run = () => jumpToRosterAnchor(anchorId, { writeHistory: false, smooth: false });
        if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(run);
        else if (typeof window !== "undefined") window.setTimeout(run, 0);
        return true;
    };

    // Respond to browser back/forward and manually entered roster anchors.
    const handleRosterNavigatorHistoryChange = () => {
        const anchorId = readRosterAnchorHash();
        if (!anchorId) return;
        rosterNavigatorLastHandledHash = "";
        if (getEffectivePublicView() !== PUBLIC_VIEW_VALUES.rosters) setPublicView(PUBLIC_VIEW_VALUES.rosters);
        syncRosterNavigatorFromHash(true);
    };

    // Bind long-lived navigator interactions once.
    const bindRosterNavigatorUi = () => {
        if (rosterNavigatorBound || typeof window === "undefined") return;
        const refs = getRosterNavigatorRefs();
        if (!refs.list || !refs.select) return;
        rosterNavigatorBound = true;
        refs.list.addEventListener("click", (event) => {
            const eventTarget = event.target && event.target.nodeType === 1
                ? event.target
                : (event.target && event.target.parentElement ? event.target.parentElement : null);
            const link = eventTarget && eventTarget.closest ? eventTarget.closest("a[data-roster-anchor]") : null;
            if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            if (typeof event.button === "number" && event.button !== 0) return;
            event.preventDefault();
            jumpToRosterAnchor(link.dataset.rosterAnchor, { writeHistory: true, smooth: true });
        });
        refs.select.addEventListener("change", () => {
            jumpToRosterAnchor(refs.select.value, { writeHistory: true, smooth: true });
        });
        window.addEventListener("scroll", queueRosterNavigatorScrollSync, { passive: true });
        window.addEventListener("resize", () => {
            syncRosterNavigatorHeaderOffset();
            queueRosterNavigatorScrollSync();
        });
        window.addEventListener("hashchange", handleRosterNavigatorHistoryChange);
        window.addEventListener("popstate", handleRosterNavigatorHistoryChange);
        if (typeof window.ResizeObserver === "function" && refs.header) {
            rosterNavigatorHeaderResizeObserver = new window.ResizeObserver(() => {
                syncRosterNavigatorHeaderOffset();
                queueRosterNavigatorScrollSync();
            });
            rosterNavigatorHeaderResizeObserver.observe(refs.header);
        }
        syncRosterNavigatorHeaderOffset();
    };

    // Render both responsive roster navigator controls from visible cards.
    const renderRosterNavigator = (modelsRaw, cardsRaw) => {
        const models = Array.isArray(modelsRaw) ? modelsRaw : [];
        const cards = Array.isArray(cardsRaw) ? cardsRaw : [];
        const refs = getRosterNavigatorRefs();
        rosterNavigatorEntries = [];
        if (!refs.list || !refs.select) return;
        refs.list.textContent = "";
        refs.select.textContent = "";
        const isAdminMode = typeof window !== "undefined" && !!window.ROSTER_ADMIN_MODE;
        const isVisible = !isAdminMode && models.length > 1 && models.length === cards.length;
        setRosterNavigatorVisibility(isVisible);
        if (!isVisible) return;

        for (let i = 0; i < models.length; i++) {
            const model = models[i];
            const card = cards[i];
            const item = document.createElement("li");
            item.className = "roster-navigator__item";
            const link = document.createElement("a");
            link.className = "roster-navigator__link";
            link.href = "#" + model.anchorId;
            link.dataset.rosterAnchor = model.anchorId;
            link.setAttribute("aria-label", "Jump to " + model.title);
            const index = el("span", "roster-navigator__index", String(i + 1).padStart(2, "0"));
            index.setAttribute("aria-hidden", "true");
            const copy = el("span", "roster-navigator__copy");
            copy.appendChild(el("span", "roster-navigator__title", model.title));
            copy.appendChild(el("span", "roster-navigator__mode", model.modeLabel));
            link.appendChild(index);
            link.appendChild(copy);
            item.appendChild(link);
            refs.list.appendChild(item);

            const option = document.createElement("option");
            option.value = model.anchorId;
            option.textContent = String(i + 1) + ". " + model.title;
            refs.select.appendChild(option);
            rosterNavigatorEntries.push({ model: model, card: card, link: link, option: option });
        }

        bindRosterNavigatorUi();
        syncRosterNavigatorHeaderOffset();
        if (!syncRosterNavigatorFromHash(false)) syncRosterNavigatorActiveState(0);
        queueRosterNavigatorScrollSync();
    };

    // Normalize leaderboard league text.
    const normalizeLeaderboardLeagueText = (valueRaw) => {
        const raw = toStr(valueRaw).trim().toLowerCase();
        if (!raw) return "";
        const normalized = typeof raw.normalize === "function" ? raw.normalize("NFKD") : raw;
        return normalized
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    };

    // Normalize leaderboard league compact.
    const normalizeLeaderboardLeagueCompact = (valueRaw) => {
        const raw = toStr(valueRaw).trim().toLowerCase();
        if (!raw) return "";
        const normalized = typeof raw.normalize === "function" ? raw.normalize("NFKD") : raw;
        return normalized.replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
    };

    let leaderboardLeagueOrderConfigCache = null;

    // Get leaderboard league display name.
    const getLeaderboardLeagueDisplayName = (valueRaw) => {
        if (typeof valueRaw === "string") return valueRaw.trim();
        const value = valueRaw && typeof valueRaw === "object" ? valueRaw : null;
        if (!value) return "";
        const byName = readLeagueDisplayName(value);
        if (byName) return byName;
        const candidates = [
            value.leagueName,
            value.displayName,
            value.tierName,
            value.label,
            value.value,
        ];
        for (let i = 0; i < candidates.length; i++) {
            const text = toStr(candidates[i]).trim();
            if (text) return text;
        }
        return "";
    };

    // Get leaderboard league family by name.
    const getLeaderboardLeagueFamilyByName = (leagueNameRaw) => {
        const text = normalizeLeaderboardLeagueText(leagueNameRaw);
        const compact = normalizeLeaderboardLeagueCompact(leagueNameRaw);
        if (!text && !compact) return "";
        // Return whether word.
        const hasWord = (word) => new RegExp("(^|\\s)" + String(word) + "(\\s|$)").test(text);
        // Return whether compact.
        const hasCompact = (fragment) => compact.indexOf(String(fragment)) >= 0;
        if (hasWord("legend") || hasCompact("legend")) return "legend";
        if (hasWord("electro") || hasCompact("electro")) return "electro";
        if (hasWord("dragon") || hasCompact("dragon")) return "dragon";
        if (hasWord("titan") || hasCompact("titan")) return "titan";
        if (hasWord("pekka") || hasCompact("pekka")) return "pekka";
        if (hasWord("golem") || hasCompact("golem")) return "golem";
        if (hasWord("witch") || hasCompact("witch")) return "witch";
        if (hasWord("valkyrie") || hasCompact("valkyrie")) return "valkyrie";
        if (hasWord("wizard") || hasCompact("wizard")) return "wizard";
        if (hasWord("archer") || hasCompact("archer")) return "archer";
        if (hasWord("barbarian") || hasCompact("barbarian")) return "barbarian";
        if (hasWord("skeleton") || hasCompact("skeleton")) return "skeleton";
        if (hasWord("unranked") || hasCompact("unranked")) return "unranked";
        return "";
    };

    // Parse leaderboard league tier number.
    const parseLeaderboardLeagueTierNumber = (leagueNameRaw) => {
        const text = normalizeLeaderboardLeagueText(leagueNameRaw);
        const compact = normalizeLeaderboardLeagueCompact(leagueNameRaw);
        const matches = text.match(/\b(\d{1,2})\b/g);
        if (matches && matches.length) {
            const last = Number(matches[matches.length - 1]);
            if (Number.isFinite(last)) return Math.floor(last);
        }
        const compactMatch = compact.match(/(\d{1,2})(?!.*\d)/);
        if (!compactMatch) return 0;
        const value = Number(compactMatch[1]);
        return Number.isFinite(value) ? Math.floor(value) : 0;
    };

    // Parse a roman league division value.
    const parseLeaderboardLeagueRomanTier = (leagueNameRaw) => {
        const text = normalizeLeaderboardLeagueText(leagueNameRaw);
        const matches = text.match(/\b(i|ii|iii)\b/g);
        if (!matches || !matches.length) return 0;
        const value = matches[matches.length - 1];
        if (value === "i") return 1;
        if (value === "ii") return 2;
        if (value === "iii") return 3;
        return 0;
    };

    // Format a human label for the Legend tier values returned by the Clash API.
    const formatLeaderboardLegendTierLabel = (tierValueRaw) => {
        const tierValue = toNonNegativeInt(tierValueRaw);
        if (tierValue === 36) return "Legends I";
        if (tierValue === 35) return "Legends II";
        if (tierValue === 34) return "Legends III";
        return "Legends";
    };

    // Resolve a Clash API league tier suffix into the app's ranking family.
    const resolveLeaderboardLeagueTierFromRankValue = (tierValueRaw) => {
        const tierValue = toNonNegativeInt(tierValueRaw);
        let family = "";
        let labelPrefix = "";
        if (tierValue >= 34 && tierValue <= 36) {
            return { family: "legend", tierValue: tierValue, label: formatLeaderboardLegendTierLabel(tierValue) };
        }
        if (tierValue >= 31 && tierValue <= 33) {
            family = "electro";
            labelPrefix = "Electro";
        } else if (tierValue >= 28 && tierValue <= 30) {
            family = "dragon";
            labelPrefix = "Dragon";
        } else if (tierValue >= 25 && tierValue <= 27) {
            family = "titan";
            labelPrefix = "Titan";
        } else if (tierValue >= 22 && tierValue <= 24) {
            family = "pekka";
            labelPrefix = "P.E.K.K.A";
        } else if (tierValue >= 19 && tierValue <= 21) {
            family = "golem";
            labelPrefix = "Golem";
        } else if (tierValue >= 16 && tierValue <= 18) {
            family = "witch";
            labelPrefix = "Witch";
        } else if (tierValue >= 13 && tierValue <= 15) {
            family = "valkyrie";
            labelPrefix = "Valkyrie";
        } else if (tierValue >= 10 && tierValue <= 12) {
            family = "wizard";
            labelPrefix = "Wizard";
        } else if (tierValue >= 7 && tierValue <= 9) {
            family = "archer";
            labelPrefix = "Archer";
        } else if (tierValue >= 4 && tierValue <= 6) {
            family = "barbarian";
            labelPrefix = "Barbarian";
        } else if (tierValue >= 1 && tierValue <= 3) {
            family = "skeleton";
            labelPrefix = "Skeleton";
        }
        if (!family) return null;
        return { family: family, tierValue: tierValue, label: labelPrefix + " " + tierValue };
    };

    // Resolve known Clash API league ids into this app's rank tiers.
    const resolveLeaderboardLeagueTierFromOfficialId = (leagueIdRaw) => {
        const leagueId = toNonNegativeInt(leagueIdRaw);
        const suffixTier = leagueId % 100;
        return resolveLeaderboardLeagueTierFromRankValue(suffixTier);
    };

    // Resolve a family-specific roman division into this app's rank tiers.
    const resolveLeaderboardLeagueTierFromRomanDivision = (familyRaw, divisionRaw) => {
        const family = toStr(familyRaw).trim().toLowerCase();
        const division = toNonNegativeInt(divisionRaw);
        if (family === "legend" && division >= 1 && division <= 3) return 37 - division;
        if (family === "titan" && division >= 1 && division <= 3) return 28 - division;
        return 0;
    };

    // Build leaderboard league rank key.
    const buildLeaderboardLeagueRankKey = (familyRaw, tierRaw) => {
        const family = toStr(familyRaw).trim().toLowerCase();
        if (!family) return "";
        if (family === "unranked") return family;
        const tier = toNonNegativeInt(tierRaw);
        if (tier < 1) return "";
        return family + ":" + tier;
    };

    // Parse leaderboard league order entry label.
    const parseLeaderboardLeagueOrderEntryLabel = (labelRaw) => {
        const label = toStr(labelRaw).trim();
        if (!label) return null;
        const family = getLeaderboardLeagueFamilyByName(label);
        if (!family) return null;
        if (family === "unranked") return { family: "unranked", tierValue: 0, label: label };
        let tierValue = parseLeaderboardLeagueTierNumber(label) || resolveLeaderboardLeagueTierFromRomanDivision(family, parseLeaderboardLeagueRomanTier(label));
        if (family === "legend" && tierValue < 1) tierValue = 34;
        if (tierValue < 1) return null;
        return { family: family, tierValue: tierValue, label: label };
    };

    // Get leaderboard league order config.
    const getLeaderboardLeagueOrderConfig = () => {
        if (leaderboardLeagueOrderConfigCache) return leaderboardLeagueOrderConfigCache;
        const rankByKey = Object.create(null);
        const labelByKey = Object.create(null);
        const validTiersByFamily = Object.create(null);
        const orderedLabels = Array.isArray(LEADERBOARD_EXACT_LEAGUE_ORDER) ? LEADERBOARD_EXACT_LEAGUE_ORDER : [];

        for (let i = 0; i < orderedLabels.length; i++) {
            const parsed = parseLeaderboardLeagueOrderEntryLabel(orderedLabels[i]);
            if (!parsed) continue;
            const key = buildLeaderboardLeagueRankKey(parsed.family, parsed.tierValue);
            if (!key) continue;
            rankByKey[key] = i;
            labelByKey[key] = parsed.label;
            if (parsed.family !== "unranked") {
                if (!validTiersByFamily[parsed.family]) validTiersByFamily[parsed.family] = Object.create(null);
                validTiersByFamily[parsed.family][String(parsed.tierValue)] = true;
            }
        }

        leaderboardLeagueOrderConfigCache = {
            rankByKey: rankByKey,
            labelByKey: labelByKey,
            validTiersByFamily: validTiersByFamily,
            fallbackRank: Math.max(0, orderedLabels.length - 1),
        };
        return leaderboardLeagueOrderConfigCache;
    };

    // Handle read structured tier from value.
    const readStructuredTierFromValue = (valueRaw, depthRaw) => {
        const depth = toNonNegativeInt(depthRaw);
        if (depth > 2) return null;
        if (valueRaw == null) return null;

        if (typeof valueRaw === "number" || typeof valueRaw === "string") {
            const numeric = Number(valueRaw);
            if (!Number.isFinite(numeric)) return null;
            return Math.floor(numeric);
        }

        const value = valueRaw && typeof valueRaw === "object" ? valueRaw : null;
        if (!value) return null;

        const nestedKeys = [
            "value",
            "number",
            "id",
            "tier",
            "tierNumber",
            "tierValue",
            "leagueTier",
            "leagueTierNumber",
            "rank",
            "rankNumber",
            "position",
            "index",
            "level",
        ];
        for (let i = 0; i < nestedKeys.length; i++) {
            const nestedValue = value[nestedKeys[i]];
            if (nestedValue == null || nestedValue === value) continue;
            const parsed = readStructuredTierFromValue(nestedValue, depth + 1);
            if (parsed != null) return parsed;
        }

        return null;
    };

    // Handle read structured league tier value.
    const readStructuredLeagueTierValue = (leagueRaw) => {
        const league = leagueRaw && typeof leagueRaw === "object" ? leagueRaw : null;
        if (!league) return 0;
        const official = resolveLeaderboardLeagueTierFromOfficialId(league.id);
        const leagueName = getLeaderboardLeagueDisplayName(league);
        const family = readStructuredLeagueFamily(league);
        if (official && (!family || official.family === family)) return official.tierValue;
        const romanTier = resolveLeaderboardLeagueTierFromRomanDivision(family, parseLeaderboardLeagueRomanTier(leagueName));
        if (romanTier > 0) return romanTier;
        const keys = [
            "tier",
            "tierNumber",
            "tierValue",
            "leagueTier",
            "leagueTierNumber",
            "division",
            "divisionNumber",
            "rank",
            "rankNumber",
            "position",
            "number",
            "index",
            "level",
            "id",
        ];
        for (let i = 0; i < keys.length; i++) {
            const out = readStructuredTierFromValue(league[keys[i]], 0);
            if (out == null) continue;
            if (out === 0) return 0;
            if (out >= 1 && out <= 36) return out;
        }
        return 0;
    };

    // Handle read structured league family.
    const readStructuredLeagueFamily = (leagueRaw) => {
        const league = leagueRaw && typeof leagueRaw === "object" ? leagueRaw : null;
        if (!league) return "";
        const candidates = [
            league.family,
            league.leagueFamily,
            league.tierFamily,
            league.familyName,
            league.group,
            league.category,
            league.type,
            league.name,
            league.displayName,
            league.label,
            league.value,
        ];
        for (let i = 0; i < candidates.length; i++) {
            const sourceValue = candidates[i];
            const sourceText = sourceValue && typeof sourceValue === "object"
                ? getLeaderboardLeagueDisplayName(sourceValue)
                : sourceValue;
            const family = getLeaderboardLeagueFamilyByName(sourceText);
            if (family) return family;
        }
        return "";
    };

    // Handle read leaderboard league descriptor from source.
    const readLeaderboardLeagueDescriptorFromSource = (leagueRaw, sourceLabelRaw) => {
        const league = leagueRaw && typeof leagueRaw === "object" ? leagueRaw : null;
        if (!league) return null;
        const official = resolveLeaderboardLeagueTierFromOfficialId(league.id);
        const name = getLeaderboardLeagueDisplayName(league) || (official && official.label) || "";
        const nameFamily = getLeaderboardLeagueFamilyByName(name) || readStructuredLeagueFamily(league);
        const useOfficial = !!(official && (!nameFamily || official.family === nameFamily));
        const family = (useOfficial && official.family) || nameFamily || (official && official.family) || "";
        const tierValue = (useOfficial && official.tierValue) || readStructuredLeagueTierValue(league);
        if (!name && !family && tierValue < 1) return null;
        return {
            source: toStr(sourceLabelRaw).trim(),
            name: name,
            family: family,
            tierValue: tierValue,
        };
    };

    // Resolve leaderboard league descriptor from snapshot.
    const resolveLeaderboardLeagueDescriptorFromSnapshot = (snapshotRaw) => {
        const snapshot = snapshotRaw && typeof snapshotRaw === "object" ? snapshotRaw : {};
        const fromLeagueTier = readLeaderboardLeagueDescriptorFromSource(snapshot.leagueTier, "leagueTier");
        const fromLeague = readLeaderboardLeagueDescriptorFromSource(snapshot.league, "league");
        const fallbackName = getLeaderboardLeagueDisplayName(snapshot.leagueName || snapshot.leagueLabel || snapshot.leagueTierName);
        const mergedName = toStr((fromLeagueTier && fromLeagueTier.name) || (fromLeague && fromLeague.name) || fallbackName).trim();
        const mergedFamily =
            toStr((fromLeagueTier && fromLeagueTier.family) || (fromLeague && fromLeague.family)).trim().toLowerCase()
            || getLeaderboardLeagueFamilyByName(mergedName);
        let mergedTierValue =
            toNonNegativeInt(fromLeagueTier && fromLeagueTier.tierValue)
            || toNonNegativeInt(fromLeague && fromLeague.tierValue);
        if (!mergedTierValue && mergedFamily !== "unranked") {
            mergedTierValue = parseLeaderboardLeagueTierNumber(mergedName) || resolveLeaderboardLeagueTierFromRomanDivision(mergedFamily, parseLeaderboardLeagueRomanTier(mergedName));
        }
        if (!mergedTierValue && mergedFamily === "legend") mergedTierValue = 34;
        return {
            source: (fromLeagueTier && fromLeagueTier.source) || (fromLeague && fromLeague.source) || (fallbackName ? "string" : ""),
            name: mergedName,
            family: mergedFamily,
            tierValue: mergedTierValue,
        };
    };

    // Parse leaderboard league sort key.
    const parseLeaderboardLeagueSortKey = (leagueInputRaw) => {
        const config = getLeaderboardLeagueOrderConfig();
        const leagueInput = leagueInputRaw && typeof leagueInputRaw === "object" && !Array.isArray(leagueInputRaw)
            ? leagueInputRaw
            : { name: leagueInputRaw };
        const leagueName = toStr(leagueInput.name).trim();
        let family = toStr(leagueInput.family).trim().toLowerCase();
        let tierValue = toNonNegativeInt(leagueInput.tierValue);

        if (!family) family = getLeaderboardLeagueFamilyByName(leagueName);
        if (!tierValue && family !== "unranked") {
            tierValue = parseLeaderboardLeagueTierNumber(leagueName) || resolveLeaderboardLeagueTierFromRomanDivision(family, parseLeaderboardLeagueRomanTier(leagueName));
        }

        if (family === "legend") {
            if (!tierValue) tierValue = 34;
            const key = buildLeaderboardLeagueRankKey("legend", tierValue);
            return {
                rank: Object.prototype.hasOwnProperty.call(config.rankByKey, key) ? config.rankByKey[key] : 0,
                tierLabel: config.labelByKey[key] || leagueName || formatLeaderboardLegendTierLabel(tierValue),
                tierValue: tierValue,
                family: "legend",
                parsed: true,
            };
        }

        if (family === "unranked" || (!leagueName && !family && tierValue < 1)) {
            const key = "unranked";
            return {
                rank: Object.prototype.hasOwnProperty.call(config.rankByKey, key) ? config.rankByKey[key] : config.fallbackRank,
                tierLabel: config.labelByKey[key] || "Unranked",
                tierValue: 0,
                family: "unranked",
                parsed: family === "unranked",
            };
        }

        const validTiers = family && config.validTiersByFamily[family] ? config.validTiersByFamily[family] : null;
        const hasKnownTier = !!(validTiers && validTiers[String(tierValue)]);
        if (hasKnownTier) {
            const key = buildLeaderboardLeagueRankKey(family, tierValue);
            return {
                rank: config.rankByKey[key],
                tierLabel: config.labelByKey[key] || leagueName || (family + " " + tierValue),
                tierValue: tierValue,
                family: family,
                parsed: true,
            };
        }

        return {
            rank: config.fallbackRank,
            tierLabel: leagueName || "Unranked",
            tierValue: tierValue || 0,
            family: family || "",
            parsed: false,
        };
    };

    // Handle read metrics latest snapshot.
    const readMetricsLatestSnapshot = (entryRaw) => {
        const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
        if (entry.latestSnapshot && typeof entry.latestSnapshot === "object") return entry.latestSnapshot;
        return null;
    };

    // Handle read snapshot town hall level.
    const readSnapshotTownHallLevel = (snapshotRaw) => {
        const snapshot = snapshotRaw && typeof snapshotRaw === "object" ? snapshotRaw : {};
        if (snapshot.townHallLevel != null) return toNonNegativeInt(snapshot.townHallLevel);
        if (snapshot.th != null) return toNonNegativeInt(snapshot.th);
        return 0;
    };

    // Normalize season event type for public display.
    const normalizeSeasonEventType = (typeRaw) => {
        const type = toStr(typeRaw).trim().toLowerCase();
        return type === "push" || type === "donation" || type === "cwl" ? type : "";
    };

    // Read the selected season-event results mode from public view state.
    const getSeasonEventResultsMode = () => {
        const leaderboard = publicViewState && publicViewState.leaderboard && typeof publicViewState.leaderboard === "object"
            ? publicViewState.leaderboard
            : {};
        return sanitizeSeasonEventResultsMode(leaderboard.seasonEventResultsMode);
    };

    // Return season events bundle from render data.
    const getSeasonEventsBundle = (dataRaw, modeRaw) => {
        const data = dataRaw && typeof dataRaw === "object" ? dataRaw : {};
        const seasonEvents = data.seasonEvents && typeof data.seasonEvents === "object" ? data.seasonEvents : {};
        const mode = sanitizeSeasonEventResultsMode(modeRaw);
        const source = mode === SEASON_EVENT_RESULT_MODE_VALUES.previous && seasonEvents.previous && typeof seasonEvents.previous === "object"
            ? seasonEvents.previous
            : seasonEvents;
        return {
            current: source.current && typeof source.current === "object" ? source.current : {},
            seasonState: source.seasonState && typeof source.seasonState === "object" ? source.seasonState : {},
            byId: source.byId && typeof source.byId === "object" ? source.byId : {},
            cwlAggregatesByEventId: source.cwlAggregatesByEventId && typeof source.cwlAggregatesByEventId === "object" ? source.cwlAggregatesByEventId : {},
            latestCompletedCwl: source.latestCompletedCwl && typeof source.latestCompletedCwl === "object" ? source.latestCompletedCwl : null,
            loadErrors: Array.isArray(source.loadErrors) ? source.loadErrors : [],
            loadedAt: toStr(source.loadedAt).trim(),
            mode: mode,
        };
    };

    // Build an empty season events bundle.
    const buildEmptySeasonEventsBundle = (loadErrorsRaw) => ({
        current: {},
        seasonState: {},
        byId: {},
        cwlAggregatesByEventId: {},
        latestCompletedCwl: null,
        loadErrors: Array.isArray(loadErrorsRaw) ? loadErrorsRaw : [],
        loadedAt: new Date().toISOString(),
    });

    // Resolve current event object for an event type.
    const getCurrentSeasonEventForType = (dataRaw, eventTypeRaw, modeRaw) => {
        const eventType = normalizeSeasonEventType(eventTypeRaw);
        if (!eventType) return null;
        const bundle = getSeasonEventsBundle(dataRaw, modeRaw);
        const pointer = bundle.current[eventType] && typeof bundle.current[eventType] === "object" ? bundle.current[eventType] : {};
        const eventId = toStr(pointer.eventId).trim();
        const event = eventId && bundle.byId[eventId] && typeof bundle.byId[eventId] === "object" ? bundle.byId[eventId] : null;
        if (event) {
            return Object.assign({
                eventId: eventId,
                type: eventType,
                seasonId: toStr(pointer.seasonId).trim(),
                startsAt: toStr(pointer.startsAt).trim(),
                endsAt: toStr(pointer.endsAt).trim(),
            }, event, {
                eventId: toStr(event.eventId).trim() || eventId,
                type: normalizeSeasonEventType(event.type) || eventType,
            });
        }
        if (!eventId) return null;
        return {
            eventId: eventId,
            type: eventType,
            seasonId: toStr(pointer.seasonId).trim(),
            startsAt: toStr(pointer.startsAt).trim(),
            endsAt: toStr(pointer.endsAt).trim(),
            status: "",
            signupsOpen: false,
            participantsByDiscordId: {},
        };
    };

    // Resolve season id used for event scoring.
    const resolveSeasonEventScoringSeasonId = (eventRaw, dataRaw) => {
        const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
        const direct = toStr(event.seasonId).trim();
        if (direct) return direct;
        const eventType = normalizeSeasonEventType(event.type);
        const bundle = getSeasonEventsBundle(dataRaw);
        const pointer = eventType && bundle.current[eventType] && typeof bundle.current[eventType] === "object" ? bundle.current[eventType] : {};
        const pointerSeasonId = toStr(pointer.seasonId).trim();
        if (pointerSeasonId) return pointerSeasonId;
        const stateSeasonId = toStr(bundle.seasonState.seasonId).trim();
        if (stateSeasonId) return stateSeasonId;
        return resolveLeaderboardRankedSeasonCycle(new Date()).seasonId;
    };

    // Format season event date range.
    const formatSeasonEventDateRange = (eventRaw) => {
        const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
        const startsMs = parseTimeMs(event.startsAt);
        const endsMs = parseTimeMs(event.endsAt);
        if (startsMs > 0 && endsMs > 0) {
            const start = new Date(startsMs);
            const end = new Date(endsMs);
            return start.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) +
                " \u2013 " +
                end.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
        }
        if (startsMs > 0) return "Starts " + new Date(startsMs).toLocaleDateString();
        if (endsMs > 0) return "Ends " + new Date(endsMs).toLocaleDateString();
        return "Season window unavailable";
    };

    // Build public-safe participant display name.
    const getSeasonEventParticipantDisplayName = (participantRaw) => {
        const participant = participantRaw && typeof participantRaw === "object" ? participantRaw : {};
        const accounts = Array.isArray(participant.accounts) ? participant.accounts : [];
        const account = accounts.length && accounts[0] && typeof accounts[0] === "object" ? accounts[0] : {};
        return toStr(participant.discordDisplayName).trim()
            || toStr(participant.discordGlobalName).trim()
            || toStr(participant.discordUsername).trim()
            || toStr(account.name).trim()
            || toStr(account.tag).trim()
            || "Unknown player";
    };

    const getSeasonEventParticipantDiscordDisplayName = (participantRaw) => {
        const participant = participantRaw && typeof participantRaw === "object" ? participantRaw : {};
        return toStr(participant.discordDisplayName).trim()
            || toStr(participant.discordGlobalName).trim()
            || toStr(participant.discordUsername).trim()
            || toStr(participant.discordId).trim();
    };

    // Normalize participant status using the backend's stored values.
    const normalizeSeasonEventParticipantStatus = (statusRaw) => {
        const status = toStr(statusRaw).trim().toLowerCase().replace(/-/g, "_");
        if (status === "cancelled" || status === "canceled") return "cancelled";
        if (status === "removed") return "removed";
        if (!status || status === "signed_up" || status === "signedup" || status === "registered" || status === "active") return "signed_up";
        return status;
    };

    // Resolve event account limit.
    const getSeasonEventMaxAccountsPerParticipant = (eventRaw) => {
        const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
        const settings = event.settings && typeof event.settings === "object" ? event.settings : {};
        const configured = toNonNegativeInt(settings.maxAccountsPerParticipant);
        if (configured > 0) return configured;
        return normalizeSeasonEventType(event.type) === "donation" ? 2 : 1;
    };

    // Normalize registered event accounts for public scoring.
    const normalizeSeasonEventParticipantAccounts = (accountsRaw, maxAccountsRaw) => {
        const accounts = Array.isArray(accountsRaw) ? accountsRaw : [];
        const maxAccounts = Math.max(1, toNonNegativeInt(maxAccountsRaw) || 1);
        const out = [];
        const seen = Object.create(null);
        for (let i = 0; i < accounts.length; i++) {
            const account = accounts[i] && typeof accounts[i] === "object" ? accounts[i] : {};
            const tag = normalizeClanTag(account.tag);
            if (!tag || seen[tag]) continue;
            seen[tag] = true;
            out.push(Object.assign({}, account, { tag: tag }));
            if (out.length >= maxAccounts) break;
        }
        return out;
    };

    // Return signed-up participants only.
    const listSeasonEventSignedUpParticipants = (eventRaw) => {
        const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
        const byDiscordId = event.participantsByDiscordId && typeof event.participantsByDiscordId === "object" ? event.participantsByDiscordId : {};
        const keys = Object.keys(byDiscordId).sort();
        const maxAccounts = getSeasonEventMaxAccountsPerParticipant(event);
        const out = [];
        for (let i = 0; i < keys.length; i++) {
            const participant = byDiscordId[keys[i]] && typeof byDiscordId[keys[i]] === "object" ? byDiscordId[keys[i]] : null;
            if (!participant || normalizeSeasonEventParticipantStatus(participant.status) !== "signed_up") continue;
            const accounts = normalizeSeasonEventParticipantAccounts(participant.accounts, maxAccounts);
            if (!accounts.length) continue;
            out.push(Object.assign({}, participant, { accounts: accounts }));
        }
        return out;
    };

    const getCwlSeasonEventTarget = (eventRaw) => {
        const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
        const cwl = event.cwl && typeof event.cwl === "object" ? event.cwl : {};
        const target = cwl.target && typeof cwl.target === "object" ? cwl.target : {};
        return target.resolved === true || String(target.status || "").trim().toLowerCase() === "resolved" ? target : null;
    };

    const isLegacyCompletedTargetlessCwlEvent = (eventRaw) => {
        const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
        const state = String(event.cwlTrackingState || event.cwlStatus || "").trim().toLowerCase();
        return normalizeSeasonEventType(event.type) === "cwl" && state === "completed" && !getCwlSeasonEventTarget(event);
    };

    const buildCwlSeasonEventEligibleTagSet = (eventRaw) => {
        const target = getCwlSeasonEventTarget(eventRaw);
        if (!target) return null;
        const set = Object.create(null);
        const tags = Array.isArray(target.eligibleAccountTags) ? target.eligibleAccountTags : [];
        for (let i = 0; i < tags.length; i++) {
            const tag = normalizeClanTag(tags[i]);
            if (tag) set[tag] = true;
        }
        return set;
    };

    const filterCwlSeasonEventParticipantAccounts = (eventRaw, accountsRaw) => {
        const accounts = Array.isArray(accountsRaw) ? accountsRaw : [];
        const eligibleSet = buildCwlSeasonEventEligibleTagSet(eventRaw);
        if (!eligibleSet) return isLegacyCompletedTargetlessCwlEvent(eventRaw) ? accounts : [];
        return accounts.filter((account) => {
            const tag = normalizeClanTag(account && account.tag);
            return !!(tag && eligibleSet[tag]);
        });
    };

    const listCwlSeasonEventSignedUpParticipants = (eventRaw) => {
        const participants = listSeasonEventSignedUpParticipants(eventRaw);
        if (isLegacyCompletedTargetlessCwlEvent(eventRaw)) return participants;
        const out = [];
        for (let i = 0; i < participants.length; i++) {
            const accounts = filterCwlSeasonEventParticipantAccounts(eventRaw, participants[i].accounts);
            if (accounts.length) out.push(Object.assign({}, participants[i], { accounts: accounts }));
        }
        return out;
    };

    // Get event account display name.
    const getSeasonEventAccountNameCandidate = (accountRaw, metricsEntryRaw) => {
        const account = accountRaw && typeof accountRaw === "object" ? accountRaw : {};
        const metricsEntry = metricsEntryRaw && typeof metricsEntryRaw === "object" ? metricsEntryRaw : {};
        const identity = metricsEntry.identity && typeof metricsEntry.identity === "object" ? metricsEntry.identity : {};
        const latest = readMetricsLatestSnapshot(metricsEntry) || {};
        return toStr(identity.name).trim() || toStr(latest.name).trim() || toStr(account.name).trim();
    };

    const getSeasonEventAccountDisplayName = (accountRaw, metricsEntryRaw) => {
        const account = accountRaw && typeof accountRaw === "object" ? accountRaw : {};
        return getSeasonEventAccountNameCandidate(account, metricsEntryRaw) || normalizeClanTag(account.tag);
    };

    const getCwlSeasonEventAccountDisplayName = (accountRaw, participantRaw, dataRaw) => {
        const account = accountRaw && typeof accountRaw === "object" ? accountRaw : {};
        const tag = normalizeClanTag(account.tag);
        const metricsEntry = tag ? getPlayerMetricsEntry(tag, dataRaw) : null;
        return getSeasonEventAccountNameCandidate(account, metricsEntry)
            || getSeasonEventParticipantDiscordDisplayName(participantRaw)
            || tag;
    };

    // Get event account town hall.
    const getSeasonEventAccountTownHall = (accountRaw, metricsEntryRaw) => {
        const account = accountRaw && typeof accountRaw === "object" ? accountRaw : {};
        const latest = readMetricsLatestSnapshot(metricsEntryRaw) || {};
        return readSnapshotTownHallLevel(latest) || toNonNegativeInt(account.townHallLevel != null ? account.townHallLevel : account.th);
    };

    // Get event account league name.
    const getSeasonEventAccountLeagueName = (accountRaw, metricsEntryRaw) => {
        const account = accountRaw && typeof accountRaw === "object" ? accountRaw : {};
        const latest = readMetricsLatestSnapshot(metricsEntryRaw) || {};
        const descriptor = resolveLeaderboardLeagueDescriptorFromSnapshot(latest);
        return toStr(descriptor.name).trim() || toStr(account.leagueName).trim();
    };

    // Add unique event warning.
    const addSeasonEventWarning = (warnings, warningRaw) => {
        const warning = toStr(warningRaw).trim();
        if (!warning || warnings.indexOf(warning) >= 0) return;
        warnings.push(warning);
    };

    // Collect push trophy points from metrics.
    const collectSeasonEventPushTrophyPoints = (metricsEntryRaw) => {
        const metricsEntry = metricsEntryRaw && typeof metricsEntryRaw === "object" ? metricsEntryRaw : {};
        const points = [];
        const latest = readMetricsLatestSnapshot(metricsEntry);
        const latestLeagueDescriptor = latest ? resolveLeaderboardLeagueDescriptorFromSnapshot(latest) : null;
        const pushPoint = (pointRaw, sourceRaw) => {
            const point = pointRaw && typeof pointRaw === "object" ? pointRaw : {};
            const trophies = toNonNegativeInt(point.trophies != null ? point.trophies : point.trophyCount);
            let capturedMs = parseTimeMs(point.capturedAt || point.at || point.timestamp);
            const dayKey = toStr(point.dayKey || point.day || point.date).trim();
            if (!(capturedMs > 0) && isValidDayKey(dayKey)) capturedMs = parseDayKeyMs(dayKey);
            if (!(capturedMs > 0)) return;
            const leagueSource = resolveLeaderboardLeagueDescriptorFromSnapshot(point);
            if (!leagueSource.name && latestLeagueDescriptor && latestLeagueDescriptor.name) {
                leagueSource.name = latestLeagueDescriptor.name;
                leagueSource.family = latestLeagueDescriptor.family;
                leagueSource.tierValue = latestLeagueDescriptor.tierValue;
            }
            const leagueSort = parseLeaderboardLeagueSortKey(leagueSource);
            points.push({
                capturedMs: capturedMs,
                trophies: trophies,
                leagueName: toStr(leagueSource.name).trim(),
                leagueSort: leagueSort,
                source: toStr(sourceRaw).trim(),
            });
        };
        const history = Array.isArray(metricsEntry.trophyHistoryDaily) ? metricsEntry.trophyHistoryDaily : [];
        for (let i = 0; i < history.length; i++) pushPoint(history[i], "history");
        if (latest && latest.trophies != null) pushPoint(latest, "latest");
        points.sort((left, right) => {
            if (left.capturedMs !== right.capturedMs) return left.capturedMs - right.capturedMs;
            if (left.trophies !== right.trophies) return left.trophies - right.trophies;
            return left.source.localeCompare(right.source);
        });
        return points;
    };

    // Return whether left is a better push rank point than right.
    const isBetterSeasonEventPushRankPoint = (leftRaw, rightRaw) => {
        const left = leftRaw && typeof leftRaw === "object" ? leftRaw : null;
        const right = rightRaw && typeof rightRaw === "object" ? rightRaw : null;
        if (!left) return false;
        if (!right) return true;
        const leftSort = left.leagueSort && typeof left.leagueSort === "object" ? left.leagueSort : {};
        const rightSort = right.leagueSort && typeof right.leagueSort === "object" ? right.leagueSort : {};
        const leftRank = Number.isFinite(Number(leftSort.rank)) ? Number(leftSort.rank) : LEADERBOARD_LEAGUE_FALLBACK_RANK;
        const rightRank = Number.isFinite(Number(rightSort.rank)) ? Number(rightSort.rank) : LEADERBOARD_LEAGUE_FALLBACK_RANK;
        if (leftRank !== rightRank) return leftRank < rightRank;
        const leftTrophies = toNonNegativeInt(left.trophies);
        const rightTrophies = toNonNegativeInt(right.trophies);
        if (leftTrophies !== rightTrophies) return leftTrophies > rightTrophies;
        return toNonNegativeInt(left.capturedMs) > toNonNegativeInt(right.capturedMs);
    };

    // Format push event score label.
    const buildSeasonEventPushScoreLabel = (trophiesRaw, leagueSortRaw, leagueNameRaw) => {
        const trophies = toNonNegativeInt(trophiesRaw);
        const leagueName = toStr(leagueNameRaw).trim();
        if (trophies <= 0 && !leagueName) return "0 trophies";
        const leagueSort = leagueSortRaw && typeof leagueSortRaw === "object" ? leagueSortRaw : {};
        const leagueLabel = leagueName || toStr(leagueSort.tierLabel).trim();
        const trophyLabel = formatNumber(trophies) + " trophies";
        return leagueLabel ? (leagueLabel + " - " + trophyLabel) : trophyLabel;
    };

    // Format Season Events numbers with stable comma grouping.
    const formatSeasonEventNumber = (valueRaw) => toNonNegativeInt(valueRaw).toLocaleString("en-US");

    // Format the score shown at the right edge of a season event row.
    const buildSeasonEventScoreValueLabel = (typeRaw, scoreRaw) => {
        const type = normalizeSeasonEventType(typeRaw);
        const score = toNonNegativeInt(scoreRaw);
        return formatSeasonEventNumber(score) + (type === "push" ? " trophies" : " donations");
    };

    // Format a compact league badge for season event push rows.
    const formatSeasonEventLeagueBadgeLabel = (leagueSortRaw, leagueNameRaw) => {
        const leagueSort = leagueSortRaw && typeof leagueSortRaw === "object" ? leagueSortRaw : {};
        const family = toStr(leagueSort.family).trim().toLowerCase() || getLeaderboardLeagueFamilyByName(leagueNameRaw);
        const tierValue = toNonNegativeInt(leagueSort.tierValue);
        if (family === "legend") {
            if (tierValue === 36) return "Legend I";
            if (tierValue === 35) return "Legend II";
            if (tierValue === 34) return "Legend III";
            return "Legend";
        }
        const tierLabel = toStr(leagueSort.tierLabel).trim();
        const leagueName = toStr(leagueNameRaw).trim();
        return tierLabel || leagueName;
    };

    // Calculate push event account score.
    const calculatePushSeasonEventAccountScore = (eventRaw, metricsEntryRaw, nowMsRaw, accountRaw) => {
        const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
        const metricsEntry = metricsEntryRaw && typeof metricsEntryRaw === "object" ? metricsEntryRaw : null;
        const account = accountRaw && typeof accountRaw === "object" ? accountRaw : {};
        if (!metricsEntry) {
            const fallbackLeagueSort = parseLeaderboardLeagueSortKey(account.leagueName);
            const fallbackLeagueName = toStr(account.leagueName).trim();
            return { score: 0, startValue: 0, currentValue: 0, coverage: "no-history", warnings: ["missing-player-metrics"], currentTrophies: 0, bestTrophies: 0, currentLeagueName: fallbackLeagueName, currentLeagueSort: fallbackLeagueSort, currentCapturedAt: "", bestLeagueName: fallbackLeagueName, bestLeagueSort: fallbackLeagueSort, bestCapturedAt: "", hasPushRank: false };
        }
        const startsMs = parseTimeMs(event.startsAt);
        const endsMs = parseTimeMs(event.endsAt);
        const nowMs = Number.isFinite(Number(nowMsRaw)) ? Number(nowMsRaw) : Date.now();
        const effectiveEndMs = endsMs > 0 ? Math.min(nowMs, endsMs) : nowMs;
        const points = collectSeasonEventPushTrophyPoints(metricsEntry);
        if (!points.length || !(startsMs > 0) || !(effectiveEndMs >= startsMs)) {
            const latest = readMetricsLatestSnapshot(metricsEntry) || {};
            const fallbackDescriptor = resolveLeaderboardLeagueDescriptorFromSnapshot(latest);
            if (!fallbackDescriptor.name && account.leagueName) fallbackDescriptor.name = toStr(account.leagueName).trim();
            const fallbackLeagueSort = parseLeaderboardLeagueSortKey(fallbackDescriptor);
            const fallbackLeagueName = toStr(fallbackDescriptor.name).trim();
            return { score: 0, startValue: 0, currentValue: 0, coverage: "no-history", warnings: ["missing-trophy-history"], currentTrophies: 0, bestTrophies: 0, currentLeagueName: fallbackLeagueName, currentLeagueSort: fallbackLeagueSort, currentCapturedAt: "", bestLeagueName: fallbackLeagueName, bestLeagueSort: fallbackLeagueSort, bestCapturedAt: "", hasPushRank: false };
        }
        // Push standings use the latest captured point in the event window, not the season peak.
        let currentPoint = null;
        for (let i = 0; i < points.length; i++) {
            const point = points[i];
            if (point.capturedMs < startsMs || point.capturedMs > effectiveEndMs) continue;
            if (
                !currentPoint ||
                point.capturedMs > currentPoint.capturedMs ||
                (point.capturedMs === currentPoint.capturedMs && isBetterSeasonEventPushRankPoint(point, currentPoint))
            ) {
                currentPoint = point;
            }
        }
        const warnings = [];
        if (!currentPoint) {
            addSeasonEventWarning(warnings, "missing-current");
            return { score: 0, startValue: 0, currentValue: 0, coverage: "missing-current", warnings: warnings, currentTrophies: 0, bestTrophies: 0, currentLeagueName: "", currentLeagueSort: parseLeaderboardLeagueSortKey(""), currentCapturedAt: "", bestLeagueName: "", bestLeagueSort: parseLeaderboardLeagueSortKey(""), bestCapturedAt: "", hasPushRank: false };
        }
        return {
            score: currentPoint.trophies,
            startValue: 0,
            currentValue: currentPoint.trophies,
            coverage: "full",
            warnings: warnings,
            currentTrophies: currentPoint.trophies,
            bestTrophies: currentPoint.trophies,
            currentLeagueName: toStr(currentPoint.leagueName).trim(),
            currentLeagueSort: currentPoint.leagueSort && typeof currentPoint.leagueSort === "object" ? currentPoint.leagueSort : parseLeaderboardLeagueSortKey(""),
            currentCapturedAt: currentPoint.capturedMs > 0 ? new Date(currentPoint.capturedMs).toISOString() : "",
            bestLeagueName: toStr(currentPoint.leagueName).trim(),
            bestLeagueSort: currentPoint.leagueSort && typeof currentPoint.leagueSort === "object" ? currentPoint.leagueSort : parseLeaderboardLeagueSortKey(""),
            bestCapturedAt: currentPoint.capturedMs > 0 ? new Date(currentPoint.capturedMs).toISOString() : "",
            hasPushRank: true,
        };
    };

    const sanitizeDonationCycleKey = (valueRaw) => {
        const value = toStr(valueRaw).trim();
        return /^[A-Za-z0-9_-]{1,120}$/.test(value) ? value : "";
    };

    const sanitizeDonationLedger = (ledgerRaw, seasonIdRaw) => {
        const ledger = ledgerRaw && typeof ledgerRaw === "object" ? ledgerRaw : {};
        const seasonId = sanitizeDonationCycleKey(seasonIdRaw || ledger.seasonId);
        const startsMs = parseTimeMs(ledger.startsAt);
        const endsMs = parseTimeMs(ledger.endsAt);
        if (!seasonId || startsMs <= 0 || endsMs <= startsMs) return null;
        return {
            seasonId: seasonId,
            startsAt: new Date(startsMs).toISOString(),
            endsAt: new Date(endsMs).toISOString(),
            rawDonationsLastSeen: toNonNegativeInt(ledger.rawDonationsLastSeen),
            rawDonationsReceivedLastSeen: toNonNegativeInt(ledger.rawDonationsReceivedLastSeen),
            cycleTotalDonations: toNonNegativeInt(ledger.cycleTotalDonations),
            cycleTotalDonationsReceived: toNonNegativeInt(ledger.cycleTotalDonationsReceived),
            firstSeenAt: parseTimeMs(ledger.firstSeenAt) > 0 ? new Date(parseTimeMs(ledger.firstSeenAt)).toISOString() : "",
            lastSeenAt: parseTimeMs(ledger.lastSeenAt) > 0 ? new Date(parseTimeMs(ledger.lastSeenAt)).toISOString() : "",
            lastClanTag: normalizeClanTag(ledger.lastClanTag),
            resetCount: toNonNegativeInt(ledger.resetCount),
            receivedResetCount: toNonNegativeInt(ledger.receivedResetCount),
        };
    };

    const getDonationLedgerLastSeenMs = (ledgerRaw) => {
        const ledger = ledgerRaw && typeof ledgerRaw === "object" ? ledgerRaw : {};
        return parseTimeMs(ledger.lastSeenAt) || parseTimeMs(ledger.firstSeenAt) || 0;
    };

    const chooseLatestDonationLedger = (baseLedgerRaw, overlayLedgerRaw, seasonIdRaw) => {
        const base = sanitizeDonationLedger(baseLedgerRaw, seasonIdRaw);
        const overlay = sanitizeDonationLedger(overlayLedgerRaw, seasonIdRaw);
        if (!base) return overlay;
        if (!overlay) return base;
        return getDonationLedgerLastSeenMs(overlay) >= getDonationLedgerLastSeenMs(base) ? overlay : base;
    };

    const readDonationRefreshOverlayLedger = (dataRaw, seasonIdRaw, tagRaw) => {
        const data = dataRaw && typeof dataRaw === "object" ? dataRaw : {};
        const seasonId = sanitizeDonationCycleKey(seasonIdRaw);
        const tag = normalizeClanTag(tagRaw);
        const donationRefresh = data.donationRefresh && typeof data.donationRefresh === "object" ? data.donationRefresh : {};
        const bySeason = donationRefresh.bySeason && typeof donationRefresh.bySeason === "object" ? donationRefresh.bySeason : {};
        const seasonOverlay = seasonId && bySeason[seasonId] && typeof bySeason[seasonId] === "object" ? bySeason[seasonId] : {};
        const byTag = seasonOverlay.byTag && typeof seasonOverlay.byTag === "object" ? seasonOverlay.byTag : {};
        const entry = tag && byTag[tag] && typeof byTag[tag] === "object" ? byTag[tag] : null;
        if (!entry) return null;
        const donationCycles = entry.donationCycles && typeof entry.donationCycles === "object" ? entry.donationCycles : {};
        return sanitizeDonationLedger(entry.donationCycle || entry.ledger || donationCycles[seasonId], seasonId);
    };

    // Read donation cycle ledger for event scoring.
    const readDonationCycleLedgerForSeasonEvent = (eventRaw, dataRaw, metricsEntryRaw, accountRaw) => {
        const metricsEntry = metricsEntryRaw && typeof metricsEntryRaw === "object" ? metricsEntryRaw : {};
        const donationCycles = metricsEntry.donationCycles && typeof metricsEntry.donationCycles === "object" ? metricsEntry.donationCycles : {};
        const seasonId = resolveSeasonEventScoringSeasonId(eventRaw, dataRaw);
        const account = accountRaw && typeof accountRaw === "object" ? accountRaw : {};
        const identity = metricsEntry.identity && typeof metricsEntry.identity === "object" ? metricsEntry.identity : {};
        const tag = normalizeClanTag(account.tag || identity.tag);
        const baseLedger = seasonId && donationCycles[seasonId] && typeof donationCycles[seasonId] === "object" ? donationCycles[seasonId] : null;
        const overlayLedger = readDonationRefreshOverlayLedger(dataRaw, seasonId, tag);
        return chooseLatestDonationLedger(baseLedger, overlayLedger, seasonId);
    };

    // Calculate donation event account score.
    const calculateDonationSeasonEventAccountScore = (eventRaw, dataRaw, metricsEntryRaw, accountRaw) => {
        const metricsEntry = metricsEntryRaw && typeof metricsEntryRaw === "object" ? metricsEntryRaw : null;
        const ledger = readDonationCycleLedgerForSeasonEvent(eventRaw, dataRaw, metricsEntry, accountRaw);
        if (!ledger) {
            const warnings = metricsEntry ? ["missing-donation-cycle-ledger"] : ["missing-player-metrics", "missing-donation-cycle-ledger"];
            return { score: 0, startValue: 0, currentValue: 0, coverage: "missing-cycle-ledger", warnings: warnings };
        }
        const score = toNonNegativeInt(ledger.cycleTotalDonations);
        return { score: score, startValue: 0, currentValue: score, coverage: "full", warnings: [] };
    };

    // Calculate one event account row.
    const calculateSeasonEventAccountBreakdown = (eventRaw, dataRaw, accountRaw, nowMsRaw) => {
        const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
        const account = accountRaw && typeof accountRaw === "object" ? accountRaw : {};
        const tag = normalizeClanTag(account.tag);
        const metricsEntry = tag ? getPlayerMetricsEntry(tag, dataRaw) : null;
        const type = normalizeSeasonEventType(event.type);
        const score = type === "push"
            ? calculatePushSeasonEventAccountScore(event, metricsEntry, nowMsRaw, account)
            : calculateDonationSeasonEventAccountScore(event, dataRaw, metricsEntry, account);
        const out = {
            tag: tag,
            name: getSeasonEventAccountDisplayName(account, metricsEntry),
            townHallLevel: getSeasonEventAccountTownHall(account, metricsEntry),
            leagueName: getSeasonEventAccountLeagueName(account, metricsEntry),
            startValue: toNonNegativeInt(score.startValue),
            currentValue: toNonNegativeInt(score.currentValue),
            delta: Number(score.score) || 0,
            score: Number(score.score) || 0,
            coverage: toStr(score.coverage).trim() || "partial",
            warnings: Array.isArray(score.warnings) ? score.warnings.slice() : [],
            currentTrophies: toNonNegativeInt(score.currentTrophies),
            bestTrophies: toNonNegativeInt(score.bestTrophies),
        };
        if (type === "push") {
            out.currentLeagueName = toStr(score.currentLeagueName).trim();
            out.currentLeagueRank = Number.isFinite(Number(score.currentLeagueSort && score.currentLeagueSort.rank)) ? Number(score.currentLeagueSort.rank) : LEADERBOARD_LEAGUE_FALLBACK_RANK;
            out.currentLeagueLabel = toStr((score.currentLeagueSort && score.currentLeagueSort.tierLabel) || score.currentLeagueName).trim();
            out.currentCapturedAt = toStr(score.currentCapturedAt).trim();
            out.bestLeagueName = out.currentLeagueName;
            out.bestLeagueRank = out.currentLeagueRank;
            out.bestLeagueLabel = out.currentLeagueLabel;
            out.bestCapturedAt = out.currentCapturedAt;
            out.hasPushRank = score.hasPushRank === true;
            out.currentLeagueSort = score.currentLeagueSort && typeof score.currentLeagueSort === "object" ? score.currentLeagueSort : parseLeaderboardLeagueSortKey("");
            out.bestLeagueSort = out.currentLeagueSort;
        }
        return out;
    };

    // Resolve one internally consistent CWL aggregate view. A completed event
    // may be observed before its final object reaches the edge. In that short
    // window retain the last live view, when available, and explicitly mark it
    // as propagating instead of rendering an empty completed leaderboard.
    const getCwlSeasonEventAggregateViewForEvent = (dataRaw, eventRaw) => {
        const data = dataRaw && typeof dataRaw === "object" ? dataRaw : {};
        const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
        const seasonEvents = data.seasonEvents && typeof data.seasonEvents === "object" ? data.seasonEvents : {};
        const aggregates = seasonEvents.cwlAggregatesByEventId && typeof seasonEvents.cwlAggregatesByEventId === "object"
            ? seasonEvents.cwlAggregatesByEventId
            : {};
        const eventId = toStr(event.eventId).trim();
        const byKind = eventId && aggregates[eventId] && typeof aggregates[eventId] === "object" ? aggregates[eventId] : {};
        const state = toStr(event.cwlTrackingState || event.cwlStatus).trim().toLowerCase();
        const finalAggregate = byKind.final && typeof byKind.final === "object" ? byKind.final : null;
        const liveAggregate = byKind.live && typeof byKind.live === "object" ? byKind.live : null;
        if (state === "completed") {
            return {
                aggregate: finalAggregate || liveAggregate,
                source: finalAggregate ? "final" : liveAggregate ? "live" : "",
                finalDataPending: !finalAggregate,
            };
        }
        return {
            aggregate: liveAggregate,
            source: liveAggregate ? "live" : "",
            finalDataPending: false,
        };
    };

    const getCwlSeasonEventAggregateForEvent = (dataRaw, eventRaw) => getCwlSeasonEventAggregateViewForEvent(dataRaw, eventRaw).aggregate;

    const sanitizeCwlAggregateStat = (entryRaw) => {
        const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
        const attackedDefenseDays = toNonNegativeInt(entry.attackedDefenseDays);
        const defenseStarsConceded = entry.defenseStarsConceded != null
            ? toNonNegativeInt(entry.defenseStarsConceded)
            : toNonNegativeInt(entry.bestStarsConceded);
        const bestStarsConceded = defenseStarsConceded;
        const bestDestructionConceded = toNonNegativeInt(entry.bestDestructionConceded);
        return {
            starsTotal: toNonNegativeInt(entry.starsTotal),
            attacksMade: toNonNegativeInt(entry.attacksMade),
            missedAttacks: toNonNegativeInt(entry.missedAttacks),
            threeStarCount: toNonNegativeInt(entry.threeStarCount),
            totalDestruction: toNonNegativeInt(entry.totalDestruction),
            countedAttacks: toNonNegativeInt(entry.countedAttacks),
            currentWarAttackPending: Math.min(1, toNonNegativeInt(entry.currentWarAttackPending)),
            defenseAttacksReceived: toNonNegativeInt(entry.defenseAttacksReceived),
            successfulDefensiveAttacks: toNonNegativeInt(entry.successfulDefensiveAttacks),
            attackedDefenseDays: attackedDefenseDays,
            defenseHolds: toNonNegativeInt(entry.defenseHolds),
            threeStarAttacksConceded: toNonNegativeInt(entry.threeStarAttacksConceded),
            defenseStarsConceded: defenseStarsConceded,
            bestStarsConceded: bestStarsConceded,
            bestDestructionConceded: bestDestructionConceded,
            unattackedDefenseDays: toNonNegativeInt(entry.unattackedDefenseDays),
            avgDefenseStarsConceded: attackedDefenseDays > 0 ? (defenseStarsConceded / attackedDefenseDays) : null,
            avgBestStarsConceded: attackedDefenseDays > 0 ? (bestStarsConceded / attackedDefenseDays) : null,
            avgBestDestructionConceded: attackedDefenseDays > 0 ? (bestDestructionConceded / attackedDefenseDays) : null,
        };
    };

    const hasCwlSeasonEventAggregateParticipation = (statsRaw) => {
        const stats = sanitizeCwlAggregateStat(statsRaw);
        return stats.attacksMade > 0
            || stats.missedAttacks > 0
            || stats.currentWarAttackPending > 0
            || stats.defenseAttacksReceived > 0
            || stats.attackedDefenseDays > 0
            || stats.unattackedDefenseDays > 0;
    };

    const compareCwlSeasonEventLeaderboardRows = (leftRaw, rightRaw) => {
        const left = leftRaw && typeof leftRaw === "object" ? leftRaw : {};
        const right = rightRaw && typeof rightRaw === "object" ? rightRaw : {};
        const leftStats = sanitizeCwlAggregateStat(left.cwlStats);
        const rightStats = sanitizeCwlAggregateStat(right.cwlStats);
        const leftParticipated = hasCwlSeasonEventAggregateParticipation(leftStats);
        const rightParticipated = hasCwlSeasonEventAggregateParticipation(rightStats);
        if (leftParticipated !== rightParticipated) return leftParticipated ? -1 : 1;
        if (leftStats.starsTotal !== rightStats.starsTotal) return rightStats.starsTotal - leftStats.starsTotal;
        if (leftStats.defenseStarsConceded !== rightStats.defenseStarsConceded) return leftStats.defenseStarsConceded - rightStats.defenseStarsConceded;
        const leftName = toStr(left.displayName).trim().toLowerCase();
        const rightName = toStr(right.displayName).trim().toLowerCase();
        if (leftName !== rightName) return leftName < rightName ? -1 : 1;
        return toStr(left.tag).localeCompare(toStr(right.tag));
    };

    const shouldUseCwlAggregateRankedTagsForRegistrations = (rankedTagsRaw, registrationByTag, registeredOrder) => {
        const rankedTags = Array.isArray(rankedTagsRaw) ? rankedTagsRaw : [];
        if (!registeredOrder.length || !rankedTags.length) return false;
        const seen = Object.create(null);
        for (let i = 0; i < rankedTags.length; i++) {
            const tag = normalizeClanTag(rankedTags[i]);
            if (!tag || !registrationByTag[tag] || seen[tag]) continue;
            seen[tag] = true;
        }
        for (let i = 0; i < registeredOrder.length; i++) {
            if (!seen[registeredOrder[i]]) return false;
        }
        return true;
    };

    const buildCwlSeasonEventLeaderboardModel = (eventRaw, dataRaw) => {
        const event = eventRaw && typeof eventRaw === "object" ? eventRaw : null;
        if (!event) return { event: null, rows: [], activeParticipantCount: 0, aggregate: null };
        const participants = listCwlSeasonEventSignedUpParticipants(event);
        const aggregateView = getCwlSeasonEventAggregateViewForEvent(dataRaw, event);
        const aggregate = aggregateView.aggregate;
        const byTag = aggregate && aggregate.byTag && typeof aggregate.byTag === "object" ? aggregate.byTag : {};
        const rankedTags = Array.isArray(aggregate && aggregate.rankedTags)
            ? aggregate.rankedTags.map((tag) => normalizeClanTag(tag)).filter((tag) => tag)
            : [];
        const registrationByTag = {};
        const registeredOrder = [];
        for (let i = 0; i < participants.length; i++) {
            const participant = participants[i];
            const accounts = Array.isArray(participant.accounts) ? participant.accounts : [];
            for (let j = 0; j < accounts.length; j++) {
                const account = accounts[j] && typeof accounts[j] === "object" ? accounts[j] : {};
                const tag = normalizeClanTag(account.tag);
                if (!tag || registrationByTag[tag]) continue;
                registrationByTag[tag] = { participant: participant, account: account };
                registeredOrder.push(tag);
            }
        }
        const rows = [];
        for (let i = 0; i < registeredOrder.length; i++) {
            const tag = registeredOrder[i];
            const registration = registrationByTag[tag];
            const account = registration.account || {};
            const participant = registration.participant || {};
            const stats = sanitizeCwlAggregateStat(byTag[tag]);
            const displayName = getCwlSeasonEventAccountDisplayName(account, participant, dataRaw);
            rows.push({
                rank: i + 1,
                tag: tag,
                playerTag: tag,
                displayName: displayName,
                discordUsername: toStr(participant.discordUsername).trim(),
                accounts: [Object.assign({}, account, { tag: tag, name: displayName, cwlStats: stats })],
                score: stats.starsTotal,
                scoreLabel: formatNumber(stats.starsTotal) + " stars, " + formatNumber(stats.defenseStarsConceded) + " defense stars",
                scoreValueLabel: formatNumber(stats.starsTotal) + " stars",
                leagueBadgeLabel: "",
                metric: "cwl",
                coverage: byTag[tag] ? "full" : "no-cwl-participation",
                cwlStats: stats,
            });
        }
        if (shouldUseCwlAggregateRankedTagsForRegistrations(rankedTags, registrationByTag, registeredOrder)) {
            const rankIndexByTag = Object.create(null);
            for (let i = 0; i < rankedTags.length; i++) {
                const tag = rankedTags[i];
                if (registrationByTag[tag] && rankIndexByTag[tag] == null) rankIndexByTag[tag] = i;
            }
            rows.sort((left, right) => toNonNegativeInt(rankIndexByTag[left.tag]) - toNonNegativeInt(rankIndexByTag[right.tag]));
        } else {
            rows.sort(compareCwlSeasonEventLeaderboardRows);
        }
        for (let i = 0; i < rows.length; i++) rows[i].rank = i + 1;
        return {
            event: event,
            rows: rows,
            activeParticipantCount: participants.length,
            seasonId: "",
            aggregate: aggregate,
            aggregateSource: aggregateView.source,
            finalDataPending: aggregateView.finalDataPending,
        };
    };

    const buildSeasonEventLeaderboardModel = (eventRaw, dataRaw, optionsRaw) => {
        const event = eventRaw && typeof eventRaw === "object" ? eventRaw : null;
        if (!event) return { event: null, rows: [], activeParticipantCount: 0 };
        const data = dataRaw && typeof dataRaw === "object" ? dataRaw : {};
        const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
        const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
        const type = normalizeSeasonEventType(event.type);
        if (type === "cwl") return buildCwlSeasonEventLeaderboardModel(event, data);
        const participants = listSeasonEventSignedUpParticipants(event);
        const rows = [];
        for (let i = 0; i < participants.length; i++) {
            const participant = participants[i];
            const accountsRaw = Array.isArray(participant.accounts) ? participant.accounts : [];
            const accounts = [];
            const warnings = [];
            let score = 0;
            let currentTrophies = 0;
            let bestTrophies = 0;
            let currentLeagueName = "";
            let currentLeagueSort = parseLeaderboardLeagueSortKey("");
            let currentCapturedAt = "";
            let hasPushRank = false;
            for (let j = 0; j < accountsRaw.length; j++) {
                const account = calculateSeasonEventAccountBreakdown(event, data, accountsRaw[j], nowMs);
                if (!account.tag) continue;
                accounts.push(account);
                if (type === "push") {
                    const candidate = {
                        trophies: account.currentTrophies,
                        leagueSort: account.currentLeagueSort,
                        capturedMs: parseTimeMs(account.currentCapturedAt),
                    };
                    const currentBest = hasPushRank ? { trophies: currentTrophies, leagueSort: currentLeagueSort, capturedMs: parseTimeMs(currentCapturedAt) } : null;
                    if (account.hasPushRank && isBetterSeasonEventPushRankPoint(candidate, currentBest)) {
                        score = account.score;
                        currentTrophies = account.currentTrophies;
                        bestTrophies = account.currentTrophies;
                        currentLeagueName = account.currentLeagueName;
                        currentLeagueSort = account.currentLeagueSort;
                        currentCapturedAt = account.currentCapturedAt;
                        hasPushRank = true;
                    }
                } else {
                    score += account.score;
                    if (account.currentTrophies > currentTrophies) currentTrophies = account.currentTrophies;
                    if (account.bestTrophies > bestTrophies) bestTrophies = account.bestTrophies;
                }
                for (let k = 0; k < account.warnings.length; k++) addSeasonEventWarning(warnings, account.warnings[k]);
            }
            const displayName = getSeasonEventParticipantDisplayName(participant);
            const firstTag = accounts.length ? accounts[0].tag : "";
            const row = {
                rank: 0,
                displayName: displayName,
                discordUsername: toStr(participant.discordUsername).trim(),
                accounts: accounts,
                score: score,
                scoreLabel: type === "push" ? buildSeasonEventPushScoreLabel(score, currentLeagueSort, currentLeagueName) : (formatNumber(score) + " donations"),
                scoreValueLabel: buildSeasonEventScoreValueLabel(type, type === "push" ? currentTrophies : score),
                leagueBadgeLabel: type === "push" && hasPushRank ? formatSeasonEventLeagueBadgeLabel(currentLeagueSort, currentLeagueName) : "",
                metric: type === "push" ? "leagueTrophies" : "donations",
                coverage: accounts.some((account) => account.coverage !== "full") ? "partial" : "full",
                warnings: warnings,
                _sort: {
                    accountCount: accounts.length,
                    currentTrophies: currentTrophies,
                    bestTrophies: bestTrophies,
                    hasPushRank: hasPushRank,
                    leagueRank: Number.isFinite(Number(currentLeagueSort && currentLeagueSort.rank)) ? Number(currentLeagueSort.rank) : LEADERBOARD_LEAGUE_FALLBACK_RANK,
                    leagueLabel: toStr((currentLeagueSort && currentLeagueSort.tierLabel) || currentLeagueName).trim().toLowerCase(),
                    displayName: displayName.toLowerCase(),
                    firstTag: firstTag,
                },
            };
            if (type === "push") {
                row.currentTrophies = currentTrophies;
                row.bestTrophies = bestTrophies;
                row.currentLeagueName = currentLeagueName;
                row.currentLeagueRank = Number.isFinite(Number(currentLeagueSort && currentLeagueSort.rank)) ? Number(currentLeagueSort.rank) : LEADERBOARD_LEAGUE_FALLBACK_RANK;
                row.currentLeagueLabel = toStr((currentLeagueSort && currentLeagueSort.tierLabel) || currentLeagueName).trim();
                row.currentCapturedAt = currentCapturedAt;
                row.bestLeagueName = currentLeagueName;
                row.bestLeagueRank = row.currentLeagueRank;
                row.bestLeagueLabel = row.currentLeagueLabel;
                row.bestCapturedAt = currentCapturedAt;
                row.hasPushRank = hasPushRank;
            }
            rows.push(row);
        }
        rows.sort((left, right) => {
            if (type === "push") {
                if (left._sort.hasPushRank !== right._sort.hasPushRank) return left._sort.hasPushRank ? -1 : 1;
                if (left._sort.leagueRank !== right._sort.leagueRank) return left._sort.leagueRank - right._sort.leagueRank;
                if (left._sort.currentTrophies !== right._sort.currentTrophies) return right._sort.currentTrophies - left._sort.currentTrophies;
            } else {
                if (left.score !== right.score) return right.score - left.score;
                if (left._sort.accountCount !== right._sort.accountCount) return right._sort.accountCount - left._sort.accountCount;
            }
            if (left._sort.displayName !== right._sort.displayName) return left._sort.displayName.localeCompare(right._sort.displayName);
            return left._sort.firstTag.localeCompare(right._sort.firstTag);
        });
        for (let i = 0; i < rows.length; i++) {
            rows[i].rank = i + 1;
            delete rows[i]._sort;
        }
        return {
            event: event,
            rows: rows,
            activeParticipantCount: participants.length,
            seasonId: resolveSeasonEventScoringSeasonId(event, data),
        };
    };

    // Resolve the shared season events meta line when both cards use the same window.
    const buildSeasonEventsSharedMetaLine = (cardsRaw) => {
        const cards = Array.isArray(cardsRaw) ? cardsRaw : [];
        const availableCards = cards.filter((card) => card && !card.unavailable);
        if (!availableCards.length || availableCards.length !== cards.length) return "";
        const dateRange = toStr(availableCards[0].dateRange).trim();
        if (!dateRange || dateRange === "Season window unavailable") return "";
        for (let i = 1; i < availableCards.length; i++) {
            if (toStr(availableCards[i].dateRange).trim() !== dateRange) return "";
        }
        return dateRange + " \u00b7 Discord signups";
    };

    const getLatestCompletedCwlSeasonEvent = (dataRaw, modeRaw) => {
        const bundle = getSeasonEventsBundle(dataRaw, modeRaw);
        const pointer = bundle.latestCompletedCwl && typeof bundle.latestCompletedCwl === "object" ? bundle.latestCompletedCwl : {};
        const eventId = toStr(pointer.eventId).trim();
        const byId = bundle.byId && typeof bundle.byId === "object" ? bundle.byId : {};
        return eventId && byId[eventId] && typeof byId[eventId] === "object" ? byId[eventId] : null;
    };

    const resolveCwlSeasonEventDisplayState = (eventRaw, leaderboardRaw) => {
        const event = eventRaw && typeof eventRaw === "object" ? eventRaw : null;
        const leaderboard = leaderboardRaw && typeof leaderboardRaw === "object" ? leaderboardRaw : {};
        if (!event || !toStr(event.eventId).trim()) return "stale-unavailable";
        const state = toStr(event.cwlTrackingState || event.cwlStatus).trim().toLowerCase();
        const aggregate = leaderboard.aggregate && typeof leaderboard.aggregate === "object" ? leaderboard.aggregate : null;
        if (!getCwlSeasonEventTarget(event) && !isLegacyCompletedTargetlessCwlEvent(event)) return "resolving-target";
        if (state === "waiting") return "waiting-for-group";
        if (state === "completed") return leaderboard.finalDataPending ? "stale-unavailable" : "completed";
        if (aggregate && aggregate.stale === true) return "stale-unavailable";
        if ((state === "active" || state === "finalizing") && !aggregate) return "stale-unavailable";
        if (state === "finalizing") return "finalizing";
        if (state === "active") return "active";
        return "stale-unavailable";
    };

    const buildCwlSeasonEventCard = (eventRaw, dataRaw, optionsRaw) => {
        const event = eventRaw && typeof eventRaw === "object" ? eventRaw : null;
        const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
        const leaderboard = buildSeasonEventLeaderboardModel(event, dataRaw);
        const objectAvailable = options.objectAvailable !== false && !!(event && toStr(event.eventId).trim());
        const lifecycleDisplayState = objectAvailable ? resolveCwlSeasonEventDisplayState(event, leaderboard) : "stale-unavailable";
        return {
            type: "cwl",
            event: event,
            leaderboardEvent: event,
            title: options.historical === true ? "Previous CWL results" : "CWL",
            status: lifecycleDisplayState,
            underlyingStatus: toStr(event && (event.cwlTrackingState || event.cwlStatus || event.status)).trim().toLowerCase(),
            signupsOpen: event && event.signupsOpen === true,
            dateRange: event ? formatSeasonEventDateRange(event) : "CWL window unavailable",
            activeParticipantCount: leaderboard.activeParticipantCount,
            rows: leaderboard.rows,
            seasonId: "",
            unavailable: !objectAvailable,
            cwlTrackingState: toStr(event && (event.cwlTrackingState || event.cwlStatus)).trim().toLowerCase(),
            lifecycleDisplayState: lifecycleDisplayState,
            aggregate: leaderboard.aggregate || null,
            aggregateSource: leaderboard.aggregateSource || "",
            finalDataPending: leaderboard.finalDataPending === true,
            historical: options.historical === true,
        };
    };

    // Build public model for selected seasonal event results.
    const buildSeasonEventsPublicModel = (dataRaw, modeRaw) => {
        const data = dataRaw && typeof dataRaw === "object" ? dataRaw : {};
        const mode = sanitizeSeasonEventResultsMode(modeRaw);
        const bundle = getSeasonEventsBundle(data, mode);
        const modelData = Object.assign({}, data, { seasonEvents: bundle });
        const cards = ["push", "donation"].map((type) => {
            const event = getCurrentSeasonEventForType(data, type, mode);
            const leaderboard = buildSeasonEventLeaderboardModel(event, modelData);
            return {
                type: type,
                event: event,
                title: type === "push" ? "Push" : "Donations",
                status: toStr(event && event.status).trim() || "unavailable",
                signupsOpen: event && event.signupsOpen === true,
                dateRange: event ? formatSeasonEventDateRange(event) : "Season window unavailable",
                activeParticipantCount: leaderboard.activeParticipantCount,
                rows: leaderboard.rows,
                seasonId: leaderboard.seasonId || "",
                unavailable: !event || !toStr(event.eventId).trim() || !bundle.byId[toStr(event.eventId).trim()],
            };
        });
        const currentCwlEvent = getCurrentSeasonEventForType(data, "cwl", mode);
        const latestCompletedCwlEvent = getLatestCompletedCwlSeasonEvent(data, mode);
        const currentCwlEventId = toStr(currentCwlEvent && currentCwlEvent.eventId).trim();
        cards.push(buildCwlSeasonEventCard(currentCwlEvent, modelData, {
            objectAvailable: !!(currentCwlEventId && bundle.byId[currentCwlEventId] && typeof bundle.byId[currentCwlEventId] === "object"),
        }));
        if (
            mode === SEASON_EVENT_RESULT_MODE_VALUES.current &&
            latestCompletedCwlEvent &&
            toStr(latestCompletedCwlEvent.eventId).trim() !== toStr(currentCwlEvent && currentCwlEvent.eventId).trim()
        ) {
            cards.push(buildCwlSeasonEventCard(latestCompletedCwlEvent, modelData, { historical: true }));
        }
        const sharedMetaLine = buildSeasonEventsSharedMetaLine(cards);
        return {
            cards: cards,
            loadErrors: bundle.loadErrors,
            sharedMetaLine: sharedMetaLine,
            unavailable: cards.every((card) => card.unavailable),
            mode: mode,
        };
    };

    // Format event status label.
    const formatSeasonEventStatusLabel = (statusRaw) => {
        const status = toStr(statusRaw).trim().toLowerCase();
        if (status === "resolving-target") return "Resolving target";
        if (status === "waiting-for-group" || status === "waiting") return "Waiting for group";
        if (status === "active") return "Active";
        if (status === "finalizing") return "Finalizing";
        if (status === "stale-unavailable") return "Stale / unavailable";
        if (status === "completed") return "Completed";
        if (status === "open") return "Open";
        if (status === "closed") return "Closed";
        if (status === "archived") return "Archived";
        if (status === "draft") return "Draft";
        return "Unavailable";
    };

    // Format compact card status text.
    const formatSeasonEventCardStatusLine = (cardRaw) => {
        const card = cardRaw && typeof cardRaw === "object" ? cardRaw : {};
        const aggregate = card.aggregate && typeof card.aggregate === "object" ? card.aggregate : null;
        const stale = !!(aggregate && aggregate.stale);
        const base = formatSeasonEventStatusLabel(card.status) +
            " \u00b7 " +
            formatSeasonEventNumber(card.activeParticipantCount) +
            " signed up";
        if (stale) {
            const refreshedAt = toStr(aggregate.lastSuccessfulRefreshAt).trim();
            const refreshedDate = refreshedAt ? new Date(refreshedAt) : null;
            const refreshedLabel = refreshedDate && Number.isFinite(refreshedDate.getTime()) ? refreshedDate.toLocaleDateString() : "";
            return base + " \u00b7 stale" + (refreshedLabel ? (" since " + refreshedLabel) : "");
        }
        if (card.finalDataPending) return base + " \u00b7 final data updating";
        if (card.historical) return base + " \u00b7 previous result";
        return base;
    };

    // Build a stable state key for one Season Events card.
    const getSeasonEventCardStateKey = (cardRaw) => {
        const card = cardRaw && typeof cardRaw === "object" ? cardRaw : {};
        const type = normalizeSeasonEventType(card.type) || "unknown";
        const eventId = toStr(card.event && card.event.eventId).trim() || "unavailable";
        return type + ":" + eventId;
    };

    // Read whether a Season Events card is expanded.
    const isSeasonEventCardExpanded = (cardRaw) => seasonEventCardExpandedByType[getSeasonEventCardStateKey(cardRaw)] === true;

    // Set whether a Season Events card is expanded.
    const setSeasonEventCardExpanded = (cardRaw, expanded) => {
        const key = getSeasonEventCardStateKey(cardRaw);
        if (!key) return;
        seasonEventCardExpandedByType[key] = expanded === true;
        if (lastRenderedData) render(lastRenderedData);
    };

    // Render one season event leaderboard row.
    const renderSeasonEventLeaderboardRow = (rowRaw, eventTypeRaw) => {
        const row = rowRaw && typeof rowRaw === "object" ? rowRaw : {};
        const eventType = normalizeSeasonEventType(eventTypeRaw);
        const rankNumber = toNonNegativeInt(row.rank);
        const topRankClass = rankNumber >= 1 && rankNumber <= 3 ? (" season-event-row--top-" + rankNumber) : "";
        const wrap = el("div", "season-event-row" + topRankClass);
        const rank = el("div", "season-event-row__rank", "#" + rankNumber);
        const body = el("div", "season-event-row__body");
        body.appendChild(el("div", "season-event-row__name", toStr(row.displayName).trim() || "Unknown player"));
        const accounts = Array.isArray(row.accounts) ? row.accounts : [];
        const accountLabels = accounts.map((account) => {
            const name = toStr(account && account.name).trim() || toStr(account && account.tag).trim();
            const tag = toStr(account && account.tag).trim();
            return name && tag && name !== tag ? (name + " " + tag) : (name || tag);
        }).filter((label) => label);
        const meta = el("div", "season-event-row__meta");
        const badgeLabel = eventType === "push" ? toStr(row.leagueBadgeLabel).trim() : "";
        if (badgeLabel) meta.appendChild(el("span", "season-event-row__league-badge", badgeLabel));
        meta.appendChild(el("span", "season-event-row__accounts", accountLabels.length ? accountLabels.join(" + ") : "No registered account"));
        body.appendChild(meta);
        const score = el("div", "season-event-row__score");
        score.appendChild(el("div", "season-event-row__score-value", toStr(row.scoreValueLabel).trim() || buildSeasonEventScoreValueLabel(eventType, row.score)));
        if (eventType === "cwl") {
            const stats = row.cwlStats && typeof row.cwlStats === "object" ? row.cwlStats : {};
            score.appendChild(el("div", "season-event-row__score-sub", formatNumber(stats.defenseStarsConceded) + " defensive stars conceded"));
        } else if (eventType !== "push") {
            score.appendChild(el("div", "season-event-row__score-sub", accounts.length + " " + pluralize(accounts.length, "account", "accounts")));
        }
        wrap.appendChild(rank);
        wrap.appendChild(body);
        wrap.appendChild(score);
        return wrap;
    };

    // Render one season event card.
    const renderSeasonEventCard = (cardRaw, optionsRaw) => {
        const card = cardRaw && typeof cardRaw === "object" ? cardRaw : {};
        const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
        const eventType = normalizeSeasonEventType(card.type);
        const wrap = el("article", "card season-event-card season-event-card--" + (eventType || "unknown"));
        const header = el("div", "season-event-card__header");
        const titleWrap = el("div", "season-event-card__title-wrap");
        titleWrap.appendChild(el("h3", "season-event-card__title", toStr(card.title).trim() || (eventType === "push" ? "Push" : eventType === "cwl" ? "CWL" : "Donations")));
        header.appendChild(titleWrap);
        header.appendChild(el("div", "season-event-card__status", formatSeasonEventCardStatusLine(card)));
        wrap.appendChild(header);

        if (!toStr(options.sharedMetaLine).trim()) {
            wrap.appendChild(el("div", "season-event-card__meta", (toStr(card.dateRange).trim() || "Season window unavailable") + " \u00b7 Discord signups"));
        }

        const rows = Array.isArray(card.rows) ? card.rows : [];
        if (card.finalDataPending && !rows.length) {
            wrap.appendChild(el("div", "season-event-card__empty", "Final results are updating. The last consistent standings are temporarily unavailable."));
        } else if (card.lifecycleDisplayState === "resolving-target" && !rows.length) {
            wrap.appendChild(el("div", "season-event-card__empty", "Resolving the CWL target from fresh league and group evidence."));
        } else if (card.lifecycleDisplayState === "waiting-for-group" && !rows.length) {
            wrap.appendChild(el("div", "season-event-card__empty", "Waiting for an authoritative CWL group."));
        } else if (card.lifecycleDisplayState === "stale-unavailable" && !rows.length) {
            wrap.appendChild(el("div", "season-event-card__empty", "CWL data is stale or temporarily unavailable; an update is pending."));
        } else if (card.unavailable) {
            wrap.appendChild(el("div", "season-event-card__empty", "Event data is currently unavailable."));
        } else if (!rows.length) {
            wrap.appendChild(el("div", "season-event-card__empty", "No signed-up players yet."));
        } else {
            const expanded = isSeasonEventCardExpanded(card);
            const visibleRows = expanded ? rows : rows.slice(0, SEASON_EVENT_COLLAPSED_ROW_COUNT);
            const list = el("div", "season-event-card__rows");
            for (let i = 0; i < visibleRows.length; i++) list.appendChild(renderSeasonEventLeaderboardRow(visibleRows[i], eventType));
            wrap.appendChild(list);
            if (rows.length > SEASON_EVENT_COLLAPSED_ROW_COUNT) {
                const toggle = el("button", "season-event-card__toggle", expanded ? "Show less" : ("Show all " + formatSeasonEventNumber(rows.length)));
                toggle.type = "button";
                toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
                toggle.addEventListener("click", () => setSeasonEventCardExpanded(card, !expanded));
                wrap.appendChild(toggle);
            }
        }
        return wrap;
    };

    // Return whether previous season event data has been fetched for this render payload.
    const hasPreviousSeasonEventsBundle = (dataRaw) => {
        const data = dataRaw && typeof dataRaw === "object" ? dataRaw : {};
        const seasonEvents = data.seasonEvents && typeof data.seasonEvents === "object" ? data.seasonEvents : {};
        return !!(seasonEvents.previous && typeof seasonEvents.previous === "object" && !Array.isArray(seasonEvents.previous));
    };

    // Render one season-events result mode button.
    const renderSeasonEventsModeButton = (modeRaw, labelRaw, activeModeRaw, loading) => {
        const mode = sanitizeSeasonEventResultsMode(modeRaw);
        const activeMode = sanitizeSeasonEventResultsMode(activeModeRaw);
        const active = mode === activeMode;
        const button = el("button", "season-events-mode-btn" + (active ? " is-active" : ""));
        button.type = "button";
        button.textContent = toStr(labelRaw);
        button.setAttribute("aria-pressed", active ? "true" : "false");
        if (loading) {
            button.disabled = true;
            button.classList.add("is-loading");
        }
        if (!active && !loading) {
            button.addEventListener("click", () => setSeasonEventResultsMode(mode));
        }
        return button;
    };

    // Render previous-season loading placeholders.
    const renderSeasonEventsLoadingGrid = () => {
        const grid = el("div", "season-events-grid season-events-grid--loading");
        for (let cardIndex = 0; cardIndex < 2; cardIndex++) {
            const card = el("article", "card season-event-card season-event-card--loading view-loading-skeleton");
            card.appendChild(createViewLoadingSkeletonLine("title"));
            for (let rowIndex = 0; rowIndex < SEASON_EVENT_COLLAPSED_ROW_COUNT; rowIndex++) {
                const row = el("div", "season-event-loading-row");
                row.appendChild(createViewLoadingSkeletonLine("rank"));
                const body = el("div", "season-event-loading-row__body");
                body.appendChild(createViewLoadingSkeletonLine("name"));
                body.appendChild(createViewLoadingSkeletonLine("meta"));
                row.appendChild(body);
                row.appendChild(createViewLoadingSkeletonLine("score"));
                card.appendChild(row);
            }
            grid.appendChild(card);
        }
        return grid;
    };

    // Render selected season events section.
    const renderSeasonEventsSection = (dataRaw) => {
        const mode = getSeasonEventResultsMode();
        const loadingPrevious = mode === SEASON_EVENT_RESULT_MODE_VALUES.previous
            && previousSeasonEventsLoadInFlight
            && !hasPreviousSeasonEventsBundle(dataRaw);
        const model = buildSeasonEventsPublicModel(dataRaw, mode);
        const section = el("section", "season-events-section season-events-section--" + mode);
        const header = el("div", "season-events-section__header");
        const copy = el("div", "season-events-section__copy");
        copy.appendChild(el(
            "h2",
            "season-events-section__title",
            mode === SEASON_EVENT_RESULT_MODE_VALUES.previous ? "Previous Season Results" : "Current Season Events"
        ));
        const metaLine = toStr(model.sharedMetaLine).trim();
        if (metaLine) {
            copy.appendChild(el("div", "season-events-section__meta", (mode === SEASON_EVENT_RESULT_MODE_VALUES.previous ? "Previous results" : "Current season") + " · " + metaLine));
        }
        header.appendChild(copy);
        const controls = el("div", "season-events-mode-toggle", "");
        controls.setAttribute("aria-label", "Season event results");
        controls.appendChild(renderSeasonEventsModeButton(SEASON_EVENT_RESULT_MODE_VALUES.current, "Current season", mode, false));
        controls.appendChild(renderSeasonEventsModeButton(
            SEASON_EVENT_RESULT_MODE_VALUES.previous,
            loadingPrevious ? "Loading previous" : "Previous season",
            mode,
            loadingPrevious
        ));
        header.appendChild(controls);
        if (loadingPrevious) {
            header.appendChild(el("div", "season-events-section__status", "Loading previous results"));
        } else if (model.loadErrors.length) {
            header.appendChild(el("div", "season-events-section__status", "Event data unavailable"));
        }
        section.appendChild(header);
        if (loadingPrevious) {
            section.appendChild(renderSeasonEventsLoadingGrid());
        } else {
            const grid = el("div", "season-events-grid");
            for (let i = 0; i < model.cards.length; i++) grid.appendChild(renderSeasonEventCard(model.cards[i], { sharedMetaLine: model.sharedMetaLine }));
            section.appendChild(grid);
        }
        return section;
    };

    // Render roster suggestion banner.
    const renderRosterSuggestionBanner = (roster, suggestionModel) => {
        if (!suggestionModel) return null;

        const result = suggestionModel.result || {};
        const swapCount = Number.isFinite(Number(result.swapCount)) ? Number(result.swapCount) : suggestionModel.pairs.length;
        const needsRewardsCount = Number.isFinite(Number(result.needsRewardsCount)) ? Number(result.needsRewardsCount) : 0;
        const hasSwapDetails = suggestionModel.pairs.length > 0;
        const banner = document.createElement(hasSwapDetails ? "details" : "div");
        banner.className = "roster-suggestion-banner"
            + (swapCount > 0 ? "" : " is-empty")
            + (hasSwapDetails ? " roster-suggestion-banner--collapsible" : "");
        const copy = el("div", "roster-suggestion-banner__copy");
        copy.appendChild(el("div", "roster-suggestion-banner__eyebrow", "Saved bench suggestions"));
        copy.appendChild(el(
            "div",
            "roster-suggestion-banner__title",
            swapCount > 0 ? (swapCount + " " + pluralize(swapCount, "swap", "swaps") + " pending") : "No swaps currently suggested"
        ));

        const metaParts = [];
        if (suggestionModel.updatedAtLabel) metaParts.push("Updated " + suggestionModel.updatedAtLabel);
        if (needsRewardsCount > 0) metaParts.push(needsRewardsCount + " players still need stars");
        if (swapCount === 0 && suggestionModel.updatedAtRaw) metaParts.push("Last saved review found no pending swaps");
        if (metaParts.length) copy.appendChild(el("div", "roster-suggestion-banner__meta", metaParts.join(" • ")));
        if (hasSwapDetails) {
            const summary = document.createElement("summary");
            summary.className = "roster-suggestion-banner__summary";
            summary.appendChild(copy);
            summary.appendChild(el("span", "roster-suggestion-banner__toggle", "View swaps"));
            banner.appendChild(summary);
        } else {
            banner.appendChild(copy);
        }

        if (hasSwapDetails) {
            const list = el("div", "roster-suggestion-list");
            for (let i = 0; i < suggestionModel.pairs.length; i++) {
                const pair = suggestionModel.pairs[i];
                const item = el("div", "roster-suggestion-item");
                item.appendChild(el("div", "roster-suggestion-item__title", pair.outLabel + " -> " + pair.inLabel));
                if (pair.reasonText) item.appendChild(el("div", "roster-suggestion-item__reason", pair.reasonText));
                list.appendChild(item);
            }
            banner.appendChild(list);
        }

        return banner;
    };

    // Read one optional non-negative form metric without turning missing values into zero.
    const readOptionalPlayerFormMetric = (entryRaw, key) => {
        const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : null;
        if (!entry || !Object.prototype.hasOwnProperty.call(entry, key)) return null;
        if (entry[key] == null || entry[key] === "") return null;
        const value = Number(entry[key]);
        if (!Number.isFinite(value) || value < 0) return null;
        return value;
    };

    // Normalize any raw or future form-specific stats object into the bucket shape scored below.
    const normalizePlayerFormStatsBucket = (statsRaw) => {
        const stats = statsRaw && typeof statsRaw === "object" ? statsRaw : {};
        const countedAttacksRaw = readOptionalPlayerFormMetric(stats, "countedAttacks");
        const countedAttacks = countedAttacksRaw != null ? Math.floor(countedAttacksRaw) : 0;
        const missedAttacksRaw = readOptionalPlayerFormMetric(stats, "missedAttacks");
        const attacksMissedRaw = missedAttacksRaw == null ? readOptionalPlayerFormMetric(stats, "attacksMissed") : null;
        const missedAttacks = missedAttacksRaw != null
            ? Math.floor(missedAttacksRaw)
            : (attacksMissedRaw != null ? Math.floor(attacksMissedRaw) : null);
        const starsTotal = readOptionalPlayerFormMetric(stats, "starsTotal");
        const totalDestruction = readOptionalPlayerFormMetric(stats, "totalDestruction");
        const threeStarCount = readOptionalPlayerFormMetric(stats, "threeStarCount");
        const explicitStarsSampleSize = readOptionalPlayerFormMetric(stats, "starsSampleSize");
        const explicitDestructionSampleSize = readOptionalPlayerFormMetric(stats, "destructionSampleSize");
        const explicitThreeStarSampleSize = readOptionalPlayerFormMetric(stats, "threeStarSampleSize");
        const starsSampleSize = starsTotal == null
            ? 0
            : Math.floor(explicitStarsSampleSize != null ? explicitStarsSampleSize : countedAttacks);
        const destructionSampleSize = totalDestruction == null
            ? 0
            : Math.floor(explicitDestructionSampleSize != null ? explicitDestructionSampleSize : countedAttacks);
        const threeStarSampleSize = threeStarCount == null
            ? 0
            : Math.floor(explicitThreeStarSampleSize != null ? explicitThreeStarSampleSize : countedAttacks);
        return {
            countedAttacks: countedAttacks,
            missedAttacks: missedAttacks,
            starsTotal: starsTotal,
            starsSampleSize: Math.max(0, starsSampleSize),
            totalDestruction: totalDestruction,
            destructionSampleSize: Math.max(0, destructionSampleSize),
            threeStarCount: threeStarCount,
            threeStarSampleSize: Math.max(0, threeStarSampleSize),
        };
    };

    // Merge compatible form buckets while preserving per-signal sample sizes for sparse future data.
    const mergePlayerFormStatsBuckets = (bucketsRaw) => {
        const buckets = Array.isArray(bucketsRaw) ? bucketsRaw : [];
        let countedAttacks = 0;
        let missedAttacks = 0;
        let hasMissedAttacks = false;
        let starsTotal = 0;
        let starsSampleSize = 0;
        let totalDestruction = 0;
        let destructionSampleSize = 0;
        let threeStarCount = 0;
        let threeStarSampleSize = 0;

        for (let i = 0; i < buckets.length; i++) {
            const bucket = normalizePlayerFormStatsBucket(buckets[i]);
            countedAttacks += bucket.countedAttacks;
            if (bucket.missedAttacks != null) {
                missedAttacks += bucket.missedAttacks;
                hasMissedAttacks = true;
            }
            if (bucket.starsSampleSize > 0 && bucket.starsTotal != null) {
                starsTotal += bucket.starsTotal;
                starsSampleSize += bucket.starsSampleSize;
            }
            if (bucket.destructionSampleSize > 0 && bucket.totalDestruction != null) {
                totalDestruction += bucket.totalDestruction;
                destructionSampleSize += bucket.destructionSampleSize;
            }
            if (bucket.threeStarSampleSize > 0 && bucket.threeStarCount != null) {
                threeStarCount += bucket.threeStarCount;
                threeStarSampleSize += bucket.threeStarSampleSize;
            }
        }

        return {
            countedAttacks: countedAttacks,
            missedAttacks: hasMissedAttacks ? missedAttacks : null,
            starsTotal: starsSampleSize > 0 ? starsTotal : null,
            starsSampleSize: starsSampleSize,
            totalDestruction: destructionSampleSize > 0 ? totalDestruction : null,
            destructionSampleSize: destructionSampleSize,
            threeStarCount: threeStarSampleSize > 0 ? threeStarCount : null,
            threeStarSampleSize: threeStarSampleSize,
        };
    };

    // Return the stored finalized regular-war history map.
    const getRegularWarHistoryByKey = (warPerformanceRaw) =>
        warPerformanceRaw && typeof warPerformanceRaw === "object" && warPerformanceRaw.regularWarHistoryByKey && typeof warPerformanceRaw.regularWarHistoryByKey === "object"
            ? warPerformanceRaw.regularWarHistoryByKey
            : {};

    // Form-specific buckets can legitimately have zero counted attacks when all used attacks were post-max-star farms.
    // Presence therefore means stored additive data exists, not that the bucket currently yields a score.
    const hasStoredPlayerFormStatsBucketData = (statsRaw) => {
        const stats = statsRaw && typeof statsRaw === "object" ? statsRaw : null;
        if (!stats) return false;
        const keys = [
            "warsInLineup",
            "daysInLineup",
            "resolvedWarDays",
            "possibleAttacks",
            "usedAttacks",
            "attacksMade",
            "missedAttacks",
            "attacksMissed",
            "starsTotal",
            "totalDestruction",
            "countedAttacks",
            "formEligibleAttacks",
            "threeStarCount",
            "hitUpCount",
            "sameThHitCount",
            "hitDownCount",
        ];
        for (let i = 0; i < keys.length; i++) {
            const value = readOptionalPlayerFormMetric(stats, keys[i]);
            if (value != null && value > 0) return true;
        }
        return false;
    };

    // Build the recent regular-war form bucket from finalized history only; live wars never enter Form.
    const getPlayerRecentRegularWarFormBucket = (warPerformanceRaw, tagRaw) => {
        const tag = normalizeClanTag(tagRaw);
        if (!tag) return mergePlayerFormStatsBuckets([]);
        const historyByKey = getRegularWarHistoryByKey(warPerformanceRaw);
        const keys = Object.keys(historyByKey);
        const recentEntries = [];
        for (let i = 0; i < keys.length; i++) {
            const entry = historyByKey[keys[i]];
            if (!entry || typeof entry !== "object" || entry.authoritative !== true) continue;
            const statsByTag = entry.statsByTag && typeof entry.statsByTag === "object" ? entry.statsByTag : {};
            const formStatsByTag = entry.formStatsByTag && typeof entry.formStatsByTag === "object" ? entry.formStatsByTag : {};
            const playerStats = formStatsByTag[tag] && typeof formStatsByTag[tag] === "object"
                ? formStatsByTag[tag]
                : (statsByTag[tag] && typeof statsByTag[tag] === "object" ? statsByTag[tag] : null);
            if (!playerStats) continue;
            recentEntries.push({
                finalizedAt: toStr(entry.finalizedAt).trim(),
                lastUpdatedAt: toStr(entry.lastUpdatedAt).trim(),
                warKey: toStr(entry.warKey || keys[i]).trim(),
                stats: playerStats,
            });
        }
        recentEntries.sort((left, right) => {
            const leftFinalizedMs = Date.parse(left.finalizedAt || left.lastUpdatedAt);
            const rightFinalizedMs = Date.parse(right.finalizedAt || right.lastUpdatedAt);
            const leftTime = Number.isFinite(leftFinalizedMs) ? leftFinalizedMs : 0;
            const rightTime = Number.isFinite(rightFinalizedMs) ? rightFinalizedMs : 0;
            if (leftTime !== rightTime) return rightTime - leftTime;
            return right.warKey.localeCompare(left.warKey);
        });
        const recentStats = [];
        for (let i = 0; i < recentEntries.length && i < 5; i++) {
            recentStats.push(recentEntries[i].stats);
        }
        return mergePlayerFormStatsBuckets(recentStats);
    };

    // Score one finalized-performance bucket; unavailable metrics are reweighted away, never zero-filled.
    const scorePlayerFormStatsBucket = (statsRaw) => {
        const stats = normalizePlayerFormStatsBucket(statsRaw);
        if (stats.countedAttacks <= 0) {
            return {
                value: null,
                countedAttacks: 0,
            };
        }

        const components = [];
        if (stats.starsSampleSize > 0 && stats.starsTotal != null) {
            components.push({ weight: 0.60, value: clamp01((stats.starsTotal / stats.starsSampleSize) / 3) });
        }
        if (stats.destructionSampleSize > 0 && stats.totalDestruction != null) {
            components.push({ weight: 0.25, value: clamp01((stats.totalDestruction / stats.destructionSampleSize) / 100) });
        }
        if (stats.threeStarSampleSize > 0 && stats.threeStarCount != null) {
            components.push({ weight: 0.15, value: clamp01(stats.threeStarCount / stats.threeStarSampleSize) });
        }

        let weightedValue = 0;
        let includedWeight = 0;
        for (let i = 0; i < components.length; i++) {
            const component = components[i] || {};
            const value = Number(component.value);
            const weight = Number(component.weight);
            if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) continue;
            weightedValue += clamp01(value) * weight;
            includedWeight += weight;
        }
        if (includedWeight <= 0) {
            return {
                value: null,
                countedAttacks: stats.countedAttacks,
            };
        }

        const baseValue = clamp01(weightedValue / includedWeight);
        const opportunities = stats.missedAttacks != null ? (stats.countedAttacks + stats.missedAttacks) : 0;
        const missedAttackRate = opportunities > 0 && stats.missedAttacks != null
            ? clamp01(stats.missedAttacks / opportunities)
            : 0;
        const reliabilityPenalty = 0.35 * missedAttackRate;
        return {
            value: clamp01(baseValue - reliabilityPenalty),
            countedAttacks: stats.countedAttacks,
        };
    };

    // Ramp recent influence by usable sample size so one isolated attack cannot dominate the badge.
    const getPlayerFormRecentBlendWeight = (recentCountedAttacksRaw) => {
        const recentCountedAttacks = Math.max(0, Math.floor(Number(recentCountedAttacksRaw) || 0));
        return Math.min(0.65, (recentCountedAttacks / 8) * 0.65);
    };

    // Blend recent and long-term finalized signals while preserving a long-term floor when available.
    const blendPlayerFormSignals = (recentSignalRaw, longTermSignalRaw) => {
        const recentSignal = recentSignalRaw && typeof recentSignalRaw === "object" ? recentSignalRaw : {};
        const longTermSignal = longTermSignalRaw && typeof longTermSignalRaw === "object" ? longTermSignalRaw : {};
        const recentValue = Number(recentSignal.value);
        const longTermValue = Number(longTermSignal.value);
        const hasRecent = recentSignal.value != null && Number.isFinite(recentValue);
        const hasLongTerm = longTermSignal.value != null && Number.isFinite(longTermValue);
        if (hasRecent && hasLongTerm) {
            const recentWeight = getPlayerFormRecentBlendWeight(recentSignal.countedAttacks);
            const longTermWeight = 1 - recentWeight;
            return clamp01((recentValue * recentWeight) + (longTermValue * longTermWeight));
        }
        if (hasRecent) return clamp01(recentValue);
        if (hasLongTerm) return clamp01(longTermValue);
        return null;
    };

    // Build compact public form score badge meta from finalized or season-aggregate performance only.
    const buildPlayerPublicFormScore = (trackingModeRaw, cwlStatsRaw, longTermStatsRaw, warPerformanceRaw, tagRaw) => {
        const trackingMode = toStr(trackingModeRaw).trim() === "regularWar" ? "regularWar" : "cwl";
        const cwlStats = cwlStatsRaw && typeof cwlStatsRaw === "object" ? cwlStatsRaw : {};
        const longTermStats = longTermStatsRaw && typeof longTermStatsRaw === "object" ? longTermStatsRaw : {};
        const longTermRegular = longTermStats.regular && typeof longTermStats.regular === "object"
            ? longTermStats.regular
            : {};
        const longTermCwl = longTermStats.cwl && typeof longTermStats.cwl === "object"
            ? longTermStats.cwl
            : {};
        const longTermOverall = longTermStats.overall && typeof longTermStats.overall === "object"
            ? longTermStats.overall
            : {};
        const longTermFormStats = getPlayerLongTermFormStats(warPerformanceRaw, tagRaw);
        const longTermFormRegular = longTermFormStats && hasStoredPlayerFormStatsBucketData(longTermFormStats.regular)
            ? longTermFormStats.regular
            : null;
        const longTermFormOverall = longTermFormStats && hasStoredPlayerFormStatsBucketData(longTermFormStats.overall)
            ? longTermFormStats.overall
            : null;
        const recentBucket = trackingMode === "regularWar"
            ? getPlayerRecentRegularWarFormBucket(warPerformanceRaw, tagRaw)
            : normalizePlayerFormStatsBucket(cwlStats);
        const preferredLongTermBucket = trackingMode === "regularWar"
            ? (longTermFormRegular || longTermRegular)
            : longTermCwl;
        const fallbackLongTermBucket = trackingMode === "regularWar"
            ? (longTermFormOverall || longTermOverall)
            : longTermOverall;
        const recentSignal = scorePlayerFormStatsBucket(recentBucket);
        const preferredLongTermSignal = scorePlayerFormStatsBucket(preferredLongTermBucket);
        const longTermSignal = preferredLongTermSignal.value != null
            ? preferredLongTermSignal
            : scorePlayerFormStatsBucket(fallbackLongTermBucket);
        const blendedValue = blendPlayerFormSignals(recentSignal, longTermSignal);
        if (blendedValue == null || !Number.isFinite(Number(blendedValue))) {
            return {
                valueText: "--",
                score: null,
                tone: "neutral",
                ariaLabel: "Form score unavailable due to limited data",
            };
        }

        const score = Math.round(clamp01(blendedValue) * 100);
        let tone = "low";
        if (score >= 80) tone = "strong";
        else if (score >= 65) tone = "good";
        else if (score >= 45) tone = "fair";
        return {
            valueText: String(score),
            score: score,
            tone: tone,
            ariaLabel: "Form score " + score + " out of 100",
        };
    };

    // Render player card.
    const renderPlayerCard = (rawPlayer, ctx) => {
        const context = ctx && typeof ctx === "object" ? ctx : {};
        const trackingMode = toStr(context.trackingMode).trim() === "regularWar" ? "regularWar" : "cwl";
        const roleRaw = toStr(context.role).trim().toLowerCase();
        const role = roleRaw === "main" || roleRaw === "missing" ? roleRaw : "sub";
        const isSub = role === "sub";
        const hideSuggestions = !!context.hideSuggestions;
        const player = normalizePlayer(rawPlayer);
        const playerTag = normalizeClanTag(player.tag);
        const roster = context.roster && typeof context.roster === "object" ? context.roster : null;
        const cwlStats = getPlayerCwlStats(context.cwlStats, playerTag);
        const regularWarStats = getPlayerRegularWarStats(context.regularWarStats, playerTag, context.warPerformance);
        const longTermStats = getPlayerLongTermWarStats(context.warPerformance, playerTag);
        const publicFormScore = buildPlayerPublicFormScore(trackingMode, cwlStats, longTermStats, context.warPerformance, playerTag);
        const playerSuggestion = hideSuggestions || trackingMode !== "cwl"
            ? null
            : getPlayerBenchSuggestion(context.suggestionModel, playerTag);
        const clanAbsentInPrep =
            typeof window !== "undefined" &&
            window.ROSTER_ADMIN_MODE &&
            trackingMode === "cwl" &&
            isCwlPreparationPlayerClanAbsent_(roster, playerTag);

        const wrap = el("div", "player");
        wrap.classList.add("roster-player-card");
        wrap.dataset.tag = playerTag;
        wrap.dataset.rosterId = toStr(context.rosterId).trim();
        if (trackingMode === "cwl" && playerSuggestion && playerSuggestion.status === "out") wrap.classList.add("suggest-bench");
        if (trackingMode === "cwl" && playerSuggestion && playerSuggestion.status === "in") wrap.classList.add("suggest-in");
        if (clanAbsentInPrep) wrap.classList.add("is-clan-absent");

        const top = el("div", "player-top");
        top.setAttribute("data-player-profile-trigger", "1");
        top.setAttribute("role", "button");
        top.setAttribute("tabindex", "0");
        top.setAttribute("aria-haspopup", "dialog");
        top.setAttribute("aria-controls", PROFILE_MODAL_ID);
        top.setAttribute("aria-expanded", "false");
        top.setAttribute("aria-label", "Open profile for " + player.name);
        const left = el("div", "player-left");
        const right = el("div", "player-right");

        const identity = el("div", "player-ident");
        const nameRow = el("div", "player-name-row");
        nameRow.appendChild(el("div", "player-name", player.name));
        const infoBadge = el("span", "player-info-badge", "i");
        infoBadge.setAttribute("aria-hidden", "true");
        nameRow.appendChild(infoBadge);
        identity.appendChild(nameRow);
        left.appendChild(identity);

        const townHallLevel = toNonNegativeInt(player.th);
        const townHallIconUrl = getTownHallIconUrl(townHallLevel);
        const townHallBadge = el("div", "player-th");
        if (townHallIconUrl) {
            const thIcon = document.createElement("img");
            thIcon.className = "player-th-icon";
            thIcon.src = townHallIconUrl;
            thIcon.alt = "Town Hall " + (townHallLevel > 0 ? toStr(townHallLevel) : "?");
            thIcon.width = 22;
            thIcon.height = 22;
            thIcon.loading = "lazy";
            thIcon.decoding = "async";
            townHallBadge.appendChild(thIcon);
        } else {
            townHallBadge.appendChild(el("span", "player-th-fallback", townHallLevel > 0 ? ("TH" + toStr(townHallLevel)) : "TH?"));
        }
        right.appendChild(townHallBadge);

        const leagueBadgeMeta = getRosterCardLeagueBadgeMeta(rawPlayer, context.data);
        const leagueIconSrc = leagueBadgeMeta && leagueBadgeMeta.src
            ? leagueBadgeMeta.src
            : getLeagueIconUrlFromFamily("unranked");
        if (leagueIconSrc) {
            const leagueBadge = el("div", "player-league");
            const leagueIcon = document.createElement("img");
            leagueIcon.className = "player-league-icon";
            leagueIcon.src = leagueIconSrc;
            leagueIcon.alt = (leagueBadgeMeta && leagueBadgeMeta.name) ? leagueBadgeMeta.name : "League";
            leagueIcon.width = 22;
            leagueIcon.height = 22;
            leagueIcon.loading = "lazy";
            leagueIcon.decoding = "async";
            leagueBadge.appendChild(leagueIcon);
            const tierOverlayText = toStr(leagueBadgeMeta && leagueBadgeMeta.tierOverlayText).trim();
            if (tierOverlayText) {
                const tierOverlay = el("span", "league-tier-overlay player-league__tier-overlay", tierOverlayText);
                tierOverlay.setAttribute("aria-hidden", "true");
                leagueBadge.appendChild(tierOverlay);
            }
            right.appendChild(leagueBadge);
        }

        const cwlBadge = el("div", "player-cwl");
        if (trackingMode === "regularWar") {
            const attacksUsed = toNonNegativeInt(regularWarStats.current.attacksUsed);
            const attacksAllowed = toNonNegativeInt(regularWarStats.current.attacksAllowed);
            const attacksRemaining = toNonNegativeInt(regularWarStats.current.attacksRemaining);
            const pendingAttack = role === "main" && regularWarStats.currentWarState === "inwar" && attacksRemaining > 0;
            if (pendingAttack) cwlBadge.classList.add("alert");
            cwlBadge.appendChild(el("span", "player-cwl-value", attacksUsed + "/" + attacksAllowed));
            if (pendingAttack) {
                cwlBadge.appendChild(el("span", "player-cwl-indicator", "!"));
            }
        } else {
            const belowFullRewardThreshold = cwlStats.starsTotal < 8;
            const pendingAttack = cwlStats.currentWarAttackPending >= 1;
            if (belowFullRewardThreshold) cwlBadge.classList.add("needs-stars");
            if (pendingAttack) cwlBadge.classList.add("pending");
            cwlBadge.appendChild(el("span", "player-cwl-value", cwlStats.starsTotal + "/8"));
            if (pendingAttack) {
                cwlBadge.appendChild(el("span", "player-cwl-indicator", "!"));
            }
        }
        right.appendChild(cwlBadge);

        top.appendChild(left);
        top.appendChild(right);

        const metaRow = el("div", "player-meta-row");
        const discordLine = el("div", "player-discord-line");
        const discordHandle = getDisplayDiscordUsernameForPlayer(player, context.data);
        const discordIconUrl = discordHandle ? getDiscordIconUrl() : getNoDiscordIconUrl();
        if (discordIconUrl) {
            const discordIcon = document.createElement("img");
            discordIcon.className = "player-discord-icon";
            discordIcon.src = discordIconUrl;
            discordIcon.alt = "";
            discordIcon.width = 13;
            discordIcon.height = 13;
            discordIcon.loading = "lazy";
            discordIcon.decoding = "async";
            discordLine.appendChild(discordIcon);
        }
        if (discordHandle) {
            discordLine.appendChild(el("span", "player-discord-text", discordHandle));
        } else {
            discordLine.setAttribute("aria-label", "No Discord set");
        }

        const formBadge = el("span", "player-form-badge tone-" + publicFormScore.tone);
        formBadge.setAttribute("role", "img");
        formBadge.setAttribute("aria-label", publicFormScore.ariaLabel);
        formBadge.appendChild(el("span", "player-form-icon", "Form"));
        formBadge.appendChild(el("span", "player-form-value", publicFormScore.valueText));

        metaRow.appendChild(discordLine);
        metaRow.appendChild(formBadge);

        const attentionItems = [];
        for (let i = 0; i < player.notes.length; i++) {
            attentionItems.push({ tone: "note", text: player.notes[i] });
        }
        if (trackingMode === "regularWar") {
            if (regularWarStats.current.missedAttacks > 0) {
                attentionItems.push({
                    tone: "warning",
                    text: "missed " + regularWarStats.current.missedAttacks + " " + pluralize(regularWarStats.current.missedAttacks, "attack", "attacks"),
                });
            }
        } else {
            if (cwlStats.missedAttacks >= 1) {
                attentionItems.push({
                    tone: "warning",
                    text: "missed " + cwlStats.missedAttacks + " " + pluralize(cwlStats.missedAttacks, "attack", "attacks"),
                });
            }
            if (typeof window !== "undefined" && window.ROSTER_ADMIN_MODE) {
                if (player.excludeAsSwapTarget) attentionItems.push({ tone: "warning", text: "swap target disabled" });
                if (player.excludeAsSwapSource) attentionItems.push({ tone: "warning", text: "swap source disabled" });
                if (clanAbsentInPrep) attentionItems.push({ tone: "warning", text: "not in clan" });
            }
        }

        wrap.appendChild(top);
        wrap.appendChild(metaRow);
        if (attentionItems.length) {
            const attentionRow = el("div", "player-attention-row");
            for (let i = 0; i < attentionItems.length; i++) {
                const item = attentionItems[i];
                attentionRow.appendChild(el("span", "player-attention-item " + item.tone, item.text));
            }
            wrap.appendChild(attentionRow);
        }
        if (trackingMode === "cwl" && playerSuggestion && playerSuggestion.noteText) {
            wrap.appendChild(el("div", "player-suggest-note", playerSuggestion.noteText));
        }

        const buildActions = getPlayerActionBuilder();
        if (buildActions) {
            const actionNode = buildActions({
                player,
                rawPlayer,
                isSub,
                role: role,
                trackingMode: trackingMode,
                index: typeof context.index === "number" ? context.index : -1,
                rosterId: toStr(context.rosterId),
                rosterTitle: toStr(context.rosterTitle),
            });
            if (actionNode && typeof actionNode === "object" && actionNode.nodeType === 1) {
                wrap.appendChild(actionNode);
            }
        }

        return wrap;
    };

    // Get missing section state key.
    const getMissingSectionStateKey = (rosterIdRaw, rosterTitleRaw) => {
        const rosterId = toStr(rosterIdRaw).trim();
        if (rosterId) return "id:" + rosterId;
        const rosterTitle = toStr(rosterTitleRaw).trim();
        return rosterTitle ? ("title:" + rosterTitle) : "unknown";
    };

    // Get missing section expanded state.
    const getMissingSectionExpandedState = (rosterIdRaw, rosterTitleRaw, defaultExpanded) => {
        const key = getMissingSectionStateKey(rosterIdRaw, rosterTitleRaw);
        if (Object.prototype.hasOwnProperty.call(missingSectionExpandedByRoster, key)) {
            return !!missingSectionExpandedByRoster[key];
        }
        return !!defaultExpanded;
    };

    // Set missing section expanded state.
    const setMissingSectionExpandedState = (rosterIdRaw, rosterTitleRaw, expanded) => {
        const key = getMissingSectionStateKey(rosterIdRaw, rosterTitleRaw);
        missingSectionExpandedByRoster[key] = !!expanded;
    };

    // Render roster section.
    const renderRosterSection = (label, players, optionsRaw) => {
        const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
        const data = options.data && typeof options.data === "object" ? options.data : null;
        const role = options.role;
        const trackingMode = options.trackingMode;
        const rosterId = options.rosterId;
        const rosterTitle = options.rosterTitle;
        const roster = options.roster && typeof options.roster === "object" ? options.roster : null;
        const cwlStats = options.cwlStats;
        const regularWarStats = options.regularWarStats;
        const warPerformance = options.warPerformance;
        const suggestionModel = options.suggestionModel;
        const hideSuggestions = !!options.hideSuggestions;
        const hideHeading = !!options.hideHeading;
        const frag = document.createDocumentFragment();
        if (!hideHeading) {
            frag.appendChild(el("h3", "", label));
        }

        const list = el("div", "roster-list");
        for (let i = 0; i < players.length; i++) {
            list.appendChild(renderPlayerCard(players[i], {
                role,
                trackingMode,
                index: i,
                rosterId: toStr(rosterId),
                rosterTitle: toStr(rosterTitle),
                roster: roster,
                cwlStats: cwlStats,
                regularWarStats: regularWarStats,
                warPerformance: warPerformance,
                suggestionModel: suggestionModel,
                hideSuggestions: hideSuggestions,
                data: data,
            }));
        }
        frag.appendChild(list);

        return frag;
    };

    // Render collapsible missing roster section.
    const renderCollapsibleMissingRosterSection = (label, players, optionsRaw) => {
        const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
        const listPlayers = Array.isArray(players) ? players : [];
        const count = listPlayers.length;
        const rosterId = toStr(options.rosterId).trim();
        const rosterTitle = toStr(options.rosterTitle).trim();
        const hasPlayers = count > 0;
        const initialExpanded = hasPlayers && getMissingSectionExpandedState(
            rosterId,
            rosterTitle,
            !!options.defaultExpanded
        );

        const section = el("section", "roster-section roster-section--collapsible");
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "roster-section-toggle";
        toggle.setAttribute("aria-expanded", hasPlayers && initialExpanded ? "true" : "false");
        if (!hasPlayers) {
            toggle.classList.add("is-static");
            toggle.setAttribute("aria-disabled", "true");
            toggle.disabled = true;
        }

        const lead = el("span", "roster-section-toggle__lead");
        lead.appendChild(el("span", "roster-section-toggle__title", label));
        lead.appendChild(el("span", "badge", count + " " + pluralize(count, "player", "players")));

        const tail = el("span", "roster-section-toggle__tail");
        const hint = el("span", "roster-section-toggle__hint", hasPlayers ? (initialExpanded ? "Hide" : "Show") : "None");
        const caret = el("span", "roster-section-toggle__caret");
        caret.setAttribute("aria-hidden", "true");
        tail.appendChild(hint);
        tail.appendChild(caret);

        toggle.appendChild(lead);
        toggle.appendChild(tail);
        section.appendChild(toggle);

        if (!hasPlayers) return section;

        const body = el("div", "roster-section-body");
        body.hidden = !initialExpanded;
        body.appendChild(renderRosterSection(label, listPlayers, {
            role: options.role,
            trackingMode: options.trackingMode,
            rosterId: options.rosterId,
            rosterTitle: options.rosterTitle,
            roster: options.roster,
            cwlStats: options.cwlStats,
            regularWarStats: options.regularWarStats,
            warPerformance: options.warPerformance,
            suggestionModel: options.suggestionModel,
            hideSuggestions: options.hideSuggestions,
            data: options.data,
            hideHeading: true,
        }));
        section.appendChild(body);

        toggle.addEventListener("click", () => {
            const nextExpanded = toggle.getAttribute("aria-expanded") !== "true";
            toggle.setAttribute("aria-expanded", nextExpanded ? "true" : "false");
            hint.textContent = nextExpanded ? "Hide" : "Show";
            body.hidden = !nextExpanded;
            setMissingSectionExpandedState(rosterId, rosterTitle, nextExpanded);
        });

        return section;
    };

    // Render roster card.
    const renderRosterCard = (roster, opts) => {
        const options = opts && typeof opts === "object" ? opts : {};
        const rosterData = options.data && typeof options.data === "object" ? options.data : null;
        const showEmptySections = options.showEmptySections !== false;
        const hideSuggestions = !!options.hideSuggestions;
        const expandMissingByDefault = !!options.expandMissingByDefault;
        const trackingMode = getRosterTrackingMode(roster);
        const prepActive = trackingMode === "cwl" && isCwlPreparationActivePublic_(roster);
        const mainPlayers = Array.isArray(roster && roster.main) ? roster.main : [];
        const subPlayers = Array.isArray(roster && roster.subs) ? roster.subs : [];
        const missingPlayers = Array.isArray(roster && roster.missing) ? roster.missing : [];
        const clanProfileUrl = getClanProfileUrl(roster && roster.connectedClanTag);
        const suggestionModel = hideSuggestions || prepActive || trackingMode !== "cwl" ? null : getRosterBenchSuggestionModel(roster);
        const regularWarData = roster && roster.regularWar && typeof roster.regularWar === "object" ? roster.regularWar : {};
        const regularWarCurrentMeta = regularWarData.currentWar && typeof regularWarData.currentWar === "object" ? regularWarData.currentWar : {};
        const regularWarAggregateMeta = regularWarData.aggregateMeta && typeof regularWarData.aggregateMeta === "object"
            ? regularWarData.aggregateMeta
            : {};
        const regularWarLiveUnavailable = toStr(regularWarCurrentMeta.unavailableReason).trim() === "privateWarLog";
        const regularWarLiveStatusMessage = toStr(regularWarCurrentMeta.statusMessage).trim();
        const regularWarAggregateStatusLevelRaw = toStr(regularWarAggregateMeta.statusLevel).trim().toLowerCase();
        const regularWarAggregateStatusLevel = regularWarAggregateStatusLevelRaw === "warning" || regularWarAggregateStatusLevelRaw === "info"
            ? regularWarAggregateStatusLevelRaw
            : "";
        const regularWarAggregateStatusMessage = regularWarAggregateStatusLevel === "warning"
            ? toStr(regularWarAggregateMeta.statusMessage).trim()
            : "";
        const regularWarAggregateHasNotice = regularWarAggregateStatusLevel === "warning" && !!regularWarAggregateStatusMessage;
        const regularWarAggregateShowWithLiveWarning = regularWarAggregateHasNotice
            && !(regularWarLiveUnavailable && regularWarAggregateStatusLevel !== "warning");

        const card = el("div", "card roster-card");
        const head = el("div", "roster-head roster-head--" + (trackingMode === "regularWar" ? "war" : "cwl"));
        const headTop = el("div", "roster-head__top");
        const identity = el("div", "roster-head__identity");
        const eyebrowText = trackingMode === "regularWar"
            ? "Regular war roster"
            : (prepActive ? "CWL preparation roster" : "CWL roster");
        identity.appendChild(el("div", "roster-head__eyebrow", eyebrowText));
        const h2 = document.createElement("h2");
        const titleText = toStr(roster.title);

        if (clanProfileUrl) {
            const titleLink = document.createElement("a");
            titleLink.className = "roster-title-link";
            titleLink.href = clanProfileUrl;
            titleLink.textContent = titleText;
            h2.appendChild(titleLink);
        } else {
            h2.textContent = titleText;
        }

        const buildHeadMetric = (label, value, tone) => {
            const metric = el("span", "roster-head-metric" + (tone ? (" roster-head-metric--" + tone) : ""));
            metric.appendChild(el("span", "roster-head-metric__label", label));
            metric.appendChild(el("strong", "roster-head-metric__value", toStr(value)));
            return metric;
        };
        const meta = el("div", "roster-meta roster-command-row");
        meta.appendChild(buildHeadMetric(
            trackingMode === "regularWar" ? "In war" : "Main lineup",
            roster.badges && roster.badges.main,
            "primary"
        ));
        meta.appendChild(buildHeadMetric(
            trackingMode === "regularWar" ? "Out of war" : "Substitutes",
            roster.badges && roster.badges.subs,
            "secondary"
        ));
        if (prepActive) {
            meta.appendChild(el("span", "badge roster-prep-public-badge roster-head-status", "Showing planned CWL Rosters"));
        }
        if (trackingMode === "regularWar") {
            const regularWarCountdown = getRegularWarCountdownDescriptor(regularWarCurrentMeta);
            if (regularWarCountdown && regularWarCountdown.targetAt) {
                const countdownBadge = el("span", "badge roster-war-countdown roster-head-status");
                countdownBadge.dataset.warCountdownKind = regularWarCountdown.kind;
                countdownBadge.dataset.warCountdownTargetAt = regularWarCountdown.targetAt;
                renderWarCountdownNode(countdownBadge);
                meta.appendChild(countdownBadge);
            }
            if (regularWarLiveUnavailable) {
                meta.appendChild(el("span", "badge roster-head-status roster-head-status--warning", "Live war refresh unavailable"));
            }
            if (regularWarAggregateShowWithLiveWarning) {
                meta.appendChild(el("span", "badge roster-head-status roster-head-status--warning", "Aggregate status warning"));
            }
        }

        const headActions = el("div", "roster-head__actions");
        if (clanProfileUrl) {
            const openClanBtn = document.createElement("a");
            openClanBtn.className = "roster-open-clan roster-head__clan-link";
            openClanBtn.href = clanProfileUrl;
            openClanBtn.textContent = "Open clan in-game";
            headActions.appendChild(openClanBtn);
        }

        const buildRosterActions = getRosterActionBuilder();
        if (buildRosterActions) {
            const actionNode = buildRosterActions({
                roster,
                rosterId: toStr(roster && roster.id),
                rosterTitle: toStr(roster && roster.title),
                trackingMode: trackingMode,
            });
            if (actionNode && typeof actionNode === "object" && actionNode.nodeType === 1) {
                meta.appendChild(actionNode);
            }
        }

        identity.appendChild(h2);
        headTop.appendChild(identity);
        if (headActions.childNodes.length) headTop.appendChild(headActions);
        head.appendChild(headTop);
        head.appendChild(meta);
        card.appendChild(head);
        if (trackingMode === "regularWar" && regularWarLiveUnavailable) {
            const warning = el("div", "roster-data-warning");
            warning.appendChild(el("div", "roster-data-warning__title", "Live war data warning"));
            warning.appendChild(el("div", "roster-data-warning__text", regularWarLiveStatusMessage || "Fresh live war data could not be fetched because the clan war log is private."));
            card.appendChild(warning);
        }
        if (trackingMode === "regularWar" && regularWarAggregateShowWithLiveWarning) {
            const aggregateNotice = el("div", "roster-data-warning");
            aggregateNotice.appendChild(el("div", "roster-data-warning__title", "Regular-war aggregate status"));
            aggregateNotice.appendChild(el("div", "roster-data-warning__text", regularWarAggregateStatusMessage));
            card.appendChild(aggregateNotice);
        }
        if (!hideSuggestions && trackingMode === "cwl" && !prepActive) {
            const suggestionBanner = renderRosterSuggestionBanner(roster, suggestionModel);
            if (suggestionBanner) card.appendChild(suggestionBanner);
        }
        if (trackingMode === "regularWar") {
            if (showEmptySections || mainPlayers.length) {
                card.appendChild(renderRosterSection("In war", mainPlayers, {
                    role: "main",
                    trackingMode,
                    rosterId: roster.id,
                    rosterTitle: roster.title,
                    roster: roster,
                    cwlStats: roster && roster.cwlStats,
                    regularWarStats: roster && roster.regularWar,
                    warPerformance: roster && roster.warPerformance,
                    suggestionModel,
                    hideSuggestions,
                    data: rosterData,
                }));
            }
            if (showEmptySections || subPlayers.length) {
                card.appendChild(renderRosterSection("Out of war", subPlayers, {
                    role: "sub",
                    trackingMode,
                    rosterId: roster.id,
                    rosterTitle: roster.title,
                    roster: roster,
                    cwlStats: roster && roster.cwlStats,
                    regularWarStats: roster && roster.regularWar,
                    warPerformance: roster && roster.warPerformance,
                    suggestionModel,
                    hideSuggestions,
                    data: rosterData,
                }));
            }
            if (showEmptySections || missingPlayers.length) {
                card.appendChild(renderCollapsibleMissingRosterSection("Temporarily missing", missingPlayers, {
                    role: "missing",
                    trackingMode,
                    rosterId: roster.id,
                    rosterTitle: roster.title,
                    roster: roster,
                    cwlStats: roster && roster.cwlStats,
                    regularWarStats: roster && roster.regularWar,
                    warPerformance: roster && roster.warPerformance,
                    suggestionModel,
                    hideSuggestions,
                    data: rosterData,
                    defaultExpanded: expandMissingByDefault,
                }));
            }
        } else {
            if (showEmptySections || mainPlayers.length) {
                card.appendChild(renderRosterSection("Main", mainPlayers, {
                    role: "main",
                    trackingMode,
                    rosterId: roster.id,
                    rosterTitle: roster.title,
                    roster: roster,
                    cwlStats: roster && roster.cwlStats,
                    regularWarStats: roster && roster.regularWar,
                    warPerformance: roster && roster.warPerformance,
                    suggestionModel,
                    hideSuggestions,
                    data: rosterData,
                }));
            }
            if (showEmptySections || subPlayers.length) {
                card.appendChild(renderRosterSection("Subs", subPlayers, {
                    role: "sub",
                    trackingMode,
                    rosterId: roster.id,
                    rosterTitle: roster.title,
                    roster: roster,
                    cwlStats: roster && roster.cwlStats,
                    regularWarStats: roster && roster.regularWar,
                    warPerformance: roster && roster.warPerformance,
                    suggestionModel,
                    hideSuggestions,
                    data: rosterData,
                }));
            }
        }

        return card;
    };

    // Get public view containers.
    const getPublicViewContainers = () => ({
        landing: $("#publicViewLanding"),
        rosters: $("#publicViewRosters"),
        leaderboard: $("#publicViewLeaderboard"),
    });

    // Ensure landing effects active.
    const ensureLandingEffectsActive = () => {
        bindLandingScrollEffects();
        queueLandingScrollEffectsFrame();
    };

    // Sync public view visibility.
    const syncPublicViewVisibility = (viewRaw) => {
        const activeView = sanitizePublicViewValue(viewRaw);
        const containers = getPublicViewContainers();
        if (containers.landing) containers.landing.classList.toggle("hidden", activeView !== PUBLIC_VIEW_VALUES.landing);
        if (containers.rosters) containers.rosters.classList.toggle("hidden", activeView !== PUBLIC_VIEW_VALUES.rosters);
        if (containers.leaderboard) containers.leaderboard.classList.toggle("hidden", activeView !== PUBLIC_VIEW_VALUES.leaderboard);
        const shell = $(".public-shell");
        if (shell) shell.setAttribute("data-active-view", activeView);
        if (activeView === PUBLIC_VIEW_VALUES.landing) {
            ensureLandingEffectsActive();
        } else if (typeof document !== "undefined" && document.documentElement) {
            document.documentElement.style.setProperty("--landing-scroll-progress", "0");
        }
    };

    // Normalize landing asset path.
    const normalizeLandingAssetPath = (assetPathRaw) =>
        toStr(assetPathRaw)
            .trim()
            .replace(/^[\/\\]+/, "")
            .replace(/\.\./g, "")
            .replace(/\\/g, "/")
            .replace(/^drive\//i, "");

    // Handle guess landing asset mime type.
    const guessLandingAssetMimeType = (assetPathRaw) => {
        const assetPath = toStr(assetPathRaw).trim().toLowerCase();
        if (!assetPath) return "";
        if (/\.webm$/i.test(assetPath)) return "video/webm";
        if (/\.webp$/i.test(assetPath)) return "image/webp";
        if (/\.png$/i.test(assetPath)) return "image/png";
        if (/\.jpe?g$/i.test(assetPath)) return "image/jpeg";
        return "";
    };

    // Get landing media load token.
    const getLandingMediaLoadToken = (slotIdRaw) => {
        const slotId = toStr(slotIdRaw).trim();
        if (!slotId) return 0;
        const value = Number(landingMediaLoadTokens[slotId]);
        if (!Number.isFinite(value) || value < 1) return 0;
        return Math.floor(value);
    };

    // Handle begin landing media load.
    const beginLandingMediaLoad = (slotIdRaw) => {
        const slotId = toStr(slotIdRaw).trim();
        if (!slotId) return 0;
        const nextToken = getLandingMediaLoadToken(slotId) + 1;
        landingMediaLoadTokens[slotId] = nextToken;
        return nextToken;
    };

    // Return whether landing media load active.
    const isLandingMediaLoadActive = (slotIdRaw, tokenRaw) => {
        const slotId = toStr(slotIdRaw).trim();
        if (!slotId) return false;
        return getLandingMediaLoadToken(slotId) === Number(tokenRaw);
    };

    // Clear landing media host.
    const clearLandingMediaHost = (host, keepNode) => {
        if (!host) return;
        const children = Array.prototype.slice.call(host.childNodes || []);
        for (let i = 0; i < children.length; i++) {
            const node = children[i];
            if (!node || node === keepNode) continue;
            if (node && node.tagName === "VIDEO") {
                try { node.pause(); } catch (err) { }
                node.removeAttribute("src");
                try { node.load(); } catch (err) { }
            } else if (node && node.removeAttribute) {
                node.removeAttribute("src");
            }
            if (node.parentNode === host) host.removeChild(node);
        }
        if (!keepNode) {
            host.classList.add("hidden");
            host.dataset.loadedSource = "";
        }
    };

    // Set landing media placeholder.
    const setLandingMediaPlaceholder = (slot, host, isLoading) => {
        if (!slot || !host) return;
        slot.classList.toggle("is-loading", !!isLoading);
        slot.classList.add("is-placeholder");
        clearLandingMediaHost(host);
    };

    // Handle show landing media element.
    const showLandingMediaElement = (slot, host, mediaNode, sourceKey) => {
        if (!slot || !host || !mediaNode) return;
        clearLandingMediaHost(host, mediaNode);
        if (mediaNode.parentNode !== host) host.appendChild(mediaNode);
        host.classList.remove("hidden");
        host.dataset.loadedSource = toStr(sourceKey).trim();
        slot.classList.remove("is-loading");
        slot.classList.remove("is-placeholder");
    };

    // Normalize landing fallback candidates.
    const normalizeLandingFallbackCandidates = (candidatesRaw) => {
        const candidates = Array.isArray(candidatesRaw) ? candidatesRaw : [];
        const out = [];
        const seen = Object.create(null);
        for (let i = 0; i < candidates.length; i++) {
            const candidate = normalizeLandingAssetPath(candidates[i]);
            if (!candidate || seen[candidate]) continue;
            seen[candidate] = true;
            out.push(candidate);
        }
        return out;
    };

    // Get landing media asset data.
    const getLandingMediaAssetData = (assetPathRaw) => {
        const assetPath = normalizeLandingAssetPath(assetPathRaw);
        if (!assetPath) return Promise.resolve(null);
        if (landingMediaAssetCache[assetPath]) return Promise.resolve(landingMediaAssetCache[assetPath]);
        if (landingMediaAssetPending[assetPath]) return landingMediaAssetPending[assetPath];

        landingMediaAssetPending[assetPath] = Promise.resolve().then(() => {
            const url = buildStaticAssetUrl(assetPath);
            if (!url) return null;
            const mimeType = guessLandingAssetMimeType(assetPath);
            const fileName = assetPath.split("/").pop() || "";
            const entry = {
                assetPath: assetPath,
                fileName: fileName,
                mimeType: mimeType,
                url: url,
                dataUrl: url,
            };
            landingMediaAssetCache[assetPath] = entry;
            return entry;
        })
            .finally(() => {
                delete landingMediaAssetPending[assetPath];
            });

        return landingMediaAssetPending[assetPath];
    };

    // Load landing remote iframe.
    const loadLandingRemoteIframe = (slotId, loadToken, slot, host, remoteUrlRaw, mediaLabelRaw) =>
        new Promise((resolve) => {
            const remoteUrl = toStr(remoteUrlRaw).trim();
            if (!remoteUrl) {
                resolve(false);
                return;
            }
            if (!isLandingMediaLoadActive(slotId, loadToken)) {
                resolve(false);
                return;
            }

            clearLandingMediaHost(host);
            const iframe = document.createElement("iframe");
            iframe.className = "landing-media-slot__media-item landing-media-slot__media-item--iframe";
            iframe.title = toStr(mediaLabelRaw).trim() || "Landing media";
            iframe.setAttribute("allow", "autoplay; fullscreen; encrypted-media; picture-in-picture");
            iframe.setAttribute("allowfullscreen", "true");
            iframe.setAttribute("loading", "lazy");
            iframe.setAttribute("referrerpolicy", "origin-when-cross-origin");

            let settled = false;
            let timeoutId = 0;
            // Clean up listeners, timers, or transient state for the current operation.
            const cleanup = () => {
                iframe.onload = null;
                iframe.onerror = null;
                if (timeoutId) {
                    window.clearTimeout(timeoutId);
                    timeoutId = 0;
                }
            };
            // Finish the current operation exactly once.
            const finish = (ok) => {
                if (settled) return;
                settled = true;
                cleanup();
                if (!isLandingMediaLoadActive(slotId, loadToken)) {
                    iframe.removeAttribute("src");
                    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
                    resolve(false);
                    return;
                }
                if (!ok) {
                    iframe.removeAttribute("src");
                    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
                    resolve(false);
                    return;
                }
                showLandingMediaElement(slot, host, iframe, "remote:" + remoteUrl);
                resolve(true);
            };

            timeoutId = window.setTimeout(() => finish(false), LANDING_MEDIA_REMOTE_LOAD_TIMEOUT_MS);
            iframe.onload = () => finish(true);
            iframe.onerror = () => finish(false);
            host.appendChild(iframe);
            host.classList.remove("hidden");
            iframe.src = remoteUrl;
        });

    // Get cloudinary direct video URL.
    const getCloudinaryDirectVideoUrl = (remoteUrlRaw) => {
        const remoteUrl = toStr(remoteUrlRaw).trim();
        if (!remoteUrl || typeof URL === "undefined") return "";
        try {
            const parsed = new URL(remoteUrl);
            const host = toStr(parsed.hostname).trim().toLowerCase();
            const path = toStr(parsed.pathname).trim().toLowerCase();
            if (host !== "player.cloudinary.com" || path.indexOf("/embed") < 0) return "";
            const cloudName = toStr(parsed.searchParams.get("cloud_name")).trim();
            const publicIdRaw = toStr(parsed.searchParams.get("public_id")).trim();
            if (!cloudName || !publicIdRaw) return "";
            const safePublicId = publicIdRaw
                .split("/")
                .map((part) => encodeURIComponent(toStr(part).trim()))
                .filter((part) => !!part)
                .join("/");
            if (!safePublicId) return "";
            return "https://res.cloudinary.com/" + encodeURIComponent(cloudName) + "/video/upload/f_auto,q_auto/" + safePublicId;
        } catch (err) {
            return "";
        }
    };

    // Load landing remote video URL.
    const loadLandingRemoteVideoUrl = (slotId, loadToken, slot, host, mediaUrlRaw, mediaLabelRaw) =>
        new Promise((resolve) => {
            const mediaUrl = toStr(mediaUrlRaw).trim();
            if (!mediaUrl) {
                resolve(false);
                return;
            }
            if (!isLandingMediaLoadActive(slotId, loadToken)) {
                resolve(false);
                return;
            }

            const video = document.createElement("video");
            video.className = "landing-media-slot__media-item landing-media-slot__media-item--video";
            video.autoplay = true;
            video.muted = true;
            video.defaultMuted = true;
            video.loop = true;
            video.playsInline = true;
            video.preload = "metadata";
            video.controls = false;
            video.setAttribute("playsinline", "true");
            video.setAttribute("aria-label", toStr(mediaLabelRaw).trim() || "Landing media");

            let settled = false;
            let timeoutId = 0;
            // Clean up listeners, timers, or transient state for the current operation.
            const cleanup = () => {
                video.onloadeddata = null;
                video.oncanplay = null;
                video.onerror = null;
                if (timeoutId) {
                    window.clearTimeout(timeoutId);
                    timeoutId = 0;
                }
            };
            // Handle dispose video.
            const disposeVideo = () => {
                try { video.pause(); } catch (err) { }
                video.removeAttribute("src");
                try { video.load(); } catch (err) { }
            };
            // Finish the current operation exactly once.
            const finish = (ok) => {
                if (settled) return;
                settled = true;
                cleanup();
                if (!ok || !isLandingMediaLoadActive(slotId, loadToken)) {
                    disposeVideo();
                    resolve(false);
                    return;
                }
                const playPromise = video.play();
                if (playPromise && typeof playPromise.catch === "function") {
                    playPromise.catch(() => { });
                }
                showLandingMediaElement(slot, host, video, "remote-video:" + mediaUrl);
                resolve(true);
            };

            timeoutId = window.setTimeout(() => finish(false), LANDING_MEDIA_REMOTE_LOAD_TIMEOUT_MS);
            video.onloadeddata = () => finish(true);
            video.oncanplay = () => finish(true);
            video.onerror = () => finish(false);
            video.src = mediaUrl;
            try { video.load(); } catch (err) { }
            if (video.readyState >= 2) finish(true);
        });

    // Load landing remote media.
    const loadLandingRemoteMedia = async (slotId, loadToken, slot, host, remoteUrlRaw, mediaLabelRaw) => {
        const remoteUrl = toStr(remoteUrlRaw).trim();
        if (!remoteUrl) return false;
        const directCloudinaryVideoUrl = getCloudinaryDirectVideoUrl(remoteUrl);
        if (directCloudinaryVideoUrl) {
            const loadedVideo = await loadLandingRemoteVideoUrl(
                slotId,
                loadToken,
                slot,
                host,
                directCloudinaryVideoUrl,
                mediaLabelRaw
            );
            if (loadedVideo) return true;
        }
        return loadLandingRemoteIframe(slotId, loadToken, slot, host, remoteUrl, mediaLabelRaw);
    };

    // Create a landing local media node.
    const createLandingLocalMediaNode = (assetRaw, mediaLabelRaw) => {
        const asset = assetRaw && typeof assetRaw === "object" ? assetRaw : {};
        const mimeType = toStr(asset.mimeType).trim().toLowerCase();
        const mediaLabel = toStr(mediaLabelRaw).trim() || "Landing media";
        if (mimeType.indexOf("video/") === 0) {
            const video = document.createElement("video");
            video.className = "landing-media-slot__media-item landing-media-slot__media-item--video";
            video.autoplay = true;
            video.muted = true;
            video.defaultMuted = true;
            video.loop = true;
            video.playsInline = true;
            video.preload = "metadata";
            video.controls = false;
            video.setAttribute("playsinline", "true");
            video.setAttribute("aria-label", mediaLabel);
            return { kind: "video", node: video };
        }
        if (mimeType.indexOf("image/") === 0) {
            const image = document.createElement("img");
            image.className = "landing-media-slot__media-item landing-media-slot__media-item--image";
            image.alt = mediaLabel;
            image.decoding = "async";
            return { kind: "image", node: image };
        }
        return null;
    };

    // Load landing local media asset.
    const loadLandingLocalMediaAsset = (slotId, loadToken, slot, host, assetRaw, mediaLabelRaw) =>
        new Promise((resolve) => {
            const asset = assetRaw && typeof assetRaw === "object" ? assetRaw : {};
            const dataUrl = toStr(asset.dataUrl).trim();
            const candidate = createLandingLocalMediaNode(asset, mediaLabelRaw);
            if (!candidate || !candidate.node || !dataUrl) {
                resolve(false);
                return;
            }
            const node = candidate.node;

            let settled = false;
            let timeoutId = 0;
            // Clean up listeners, timers, or transient state for the current operation.
            const cleanup = () => {
                node.onload = null;
                node.onerror = null;
                node.onloadeddata = null;
                node.oncanplay = null;
                if (timeoutId) {
                    window.clearTimeout(timeoutId);
                    timeoutId = 0;
                }
            };
            // Handle dispose node.
            const disposeNode = () => {
                if (node.tagName === "VIDEO") {
                    try { node.pause(); } catch (err) { }
                    node.removeAttribute("src");
                    try { node.load(); } catch (err) { }
                } else {
                    node.removeAttribute("src");
                }
            };
            // Finish the current operation exactly once.
            const finish = (ok) => {
                if (settled) return;
                settled = true;
                cleanup();
                if (!ok || !isLandingMediaLoadActive(slotId, loadToken)) {
                    disposeNode();
                    resolve(false);
                    return;
                }
                if (candidate.kind === "video" && typeof node.play === "function") {
                    const playPromise = node.play();
                    if (playPromise && typeof playPromise.catch === "function") {
                        playPromise.catch(() => { });
                    }
                }
                showLandingMediaElement(slot, host, node, "local:" + toStr(asset.assetPath).trim());
                resolve(true);
            };

            timeoutId = window.setTimeout(() => finish(false), LANDING_MEDIA_LOCAL_LOAD_TIMEOUT_MS);
            if (candidate.kind === "video") {
                node.onloadeddata = () => finish(true);
                node.oncanplay = () => finish(true);
                node.onerror = () => finish(false);
                node.src = dataUrl;
                try { node.load(); } catch (err) { }
                if (node.readyState >= 2) finish(true);
                return;
            }

            node.onload = () => finish(true);
            node.onerror = () => finish(false);
            node.src = dataUrl;
            if (node.complete && node.naturalWidth > 0) finish(true);
        });

    // Set landing media slot source.
    const setLandingMediaSlotSource = (optionsRaw) => {
        const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
        const slotId = toStr(options.slotId).trim();
        const mediaHostId = toStr(options.mediaHostId).trim();
        const source = resolveLandingMediaSource(options.mediaUrl);
        const mediaLabel = toStr(options.mediaLabel).trim() || "Landing media";
        const fallbackCandidates = normalizeLandingFallbackCandidates(options.fallbackCandidates);

        const slot = slotId ? $("#" + slotId) : null;
        const host = mediaHostId ? $("#" + mediaHostId) : null;
        if (!slot || !host) return;

        if (source.kind === "url") {
            const loadedSource = toStr(host.dataset.loadedSource).trim();
            if (loadedSource === ("remote:" + source.value) && !slot.classList.contains("is-placeholder")) {
                slot.classList.remove("is-loading");
                return;
            }
        }

        const loadToken = beginLandingMediaLoad(slotId);
        // Finish the current media load with the placeholder state.
        const finishWithPlaceholder = () => {
            if (!isLandingMediaLoadActive(slotId, loadToken)) return;
            setLandingMediaPlaceholder(slot, host, false);
        };
        // Try local fallback assets in order.
        const tryLocalFallbacks = async () => {
            for (let i = 0; i < fallbackCandidates.length; i++) {
                if (!isLandingMediaLoadActive(slotId, loadToken)) return false;
                const asset = await getLandingMediaAssetData(fallbackCandidates[i]);
                if (!isLandingMediaLoadActive(slotId, loadToken)) return false;
                if (!asset) continue;
                const loaded = await loadLandingLocalMediaAsset(slotId, loadToken, slot, host, asset, mediaLabel);
                if (loaded) return true;
            }
            return false;
        };

        setLandingMediaPlaceholder(slot, host, true);
        (async () => {
            if (source.kind === "url") {
                const remoteLoaded = await loadLandingRemoteMedia(slotId, loadToken, slot, host, source.value, mediaLabel);
                if (remoteLoaded || !isLandingMediaLoadActive(slotId, loadToken)) return;
            }
            const localLoaded = await tryLocalFallbacks();
            if (localLoaded || !isLandingMediaLoadActive(slotId, loadToken)) return;
            finishWithPlaceholder();
        })().catch(() => {
            finishWithPlaceholder();
        });
    };

    // Handle count unique tags across active roster roles.
    const countUniqueTagsAcrossActiveRosterRoles = (rosterRaw) => {
        const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
        const pool = []
            .concat(Array.isArray(roster.main) ? roster.main : [])
            .concat(Array.isArray(roster.subs) ? roster.subs : []);
        const seen = Object.create(null);
        let count = 0;
        for (let i = 0; i < pool.length; i++) {
            const tag = normalizeClanTag(pool[i] && pool[i].tag);
            if (!tag || seen[tag]) continue;
            seen[tag] = true;
            count++;
        }
        return count;
    };

    // Render landing clan family.
    const renderLandingClanFamily = (dataRaw, profileRaw) => {
        const target = $("#landingClanFamilyGrid");
        const familyMeta = $("#landingFamilyMeta");
        if (!target) return;
        clearNode(target);

        const data = dataRaw && typeof dataRaw === "object" ? dataRaw : {};
        const profile = isPlainObject_(profileRaw) ? profileRaw : PUBLIC_PROFILE_DEFAULTS;
        const family = isPlainObject_(profile.family) ? profile.family : {};
        const rosters = getOrderedRostersFromData(data);
        if (!rosters.length) {
            const empty = el("div", "landing-family-empty landing-shell-empty", "Clan roster data will appear here once synced.");
            target.appendChild(empty);
            if (familyMeta) familyMeta.textContent = "Roster data is syncing. Clan lineup will populate automatically.";
            return;
        }

        let totalMembers = 0;
        const rosterMemberCounts = [];
        let maxMembers = 1;

        for (let i = 0; i < rosters.length; i++) {
            const members = countUniqueTagsAcrossActiveRosterRoles(rosters[i]);
            rosterMemberCounts.push(members);
            if (members > maxMembers) maxMembers = members;
        }

        for (let i = 0; i < rosters.length; i++) {
            const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
            const card = el("article", "landing-shell-clan");
            const count = rosters.length;
            const angle = count <= 1 ? -90 : (-112 + ((224 / Math.max(1, count - 1)) * i));
            const radians = angle * Math.PI / 180;
            const orbitX = 50 + (Math.cos(radians) * 39);
            const orbitY = 52 + (Math.sin(radians) * 35);
            const scale = 0.94 + (Math.min(1, rosterMemberCounts[i] / Math.max(1, maxMembers)) * 0.12);
            const tilt = ((i % 2 === 0 ? -1 : 1) * (5 + ((i % 3) * 2)));
            card.style.setProperty("--orbit-x", orbitX.toFixed(2));
            card.style.setProperty("--orbit-y", orbitY.toFixed(2));
            card.style.setProperty("--plate-scale", scale.toFixed(3));
            card.style.setProperty("--plate-tilt", String(tilt) + "deg");

            const titleText = toStr(roster.title).trim() || "Unnamed roster";
            const members = rosterMemberCounts[i];
            totalMembers += members;
            const playersLabel = toStr(family.playersLabel).trim() || "Players in roster";
            const trackingMode = getRosterTrackingMode(roster) === "regularWar"
                ? (toStr(family.regularWarLabel).trim() || "Regular war")
                : (toStr(family.cwlLabel).trim() || "CWL");

            const mode = el("div", "landing-shell-clan__mode", trackingMode);
            const title = el("h4", "landing-shell-clan__title", titleText);
            const countWrap = el("div", "landing-shell-clan__count");
            const memberValue = el("strong", "", formatNumber(members));
            const memberLabel = el("span", "", playersLabel);
            countWrap.appendChild(memberValue);
            countWrap.appendChild(memberLabel);
            card.setAttribute("aria-label", titleText + ", " + formatNumber(members) + " " + playersLabel + ", " + trackingMode);

            card.appendChild(mode);
            card.appendChild(title);
            card.appendChild(countWrap);
            target.appendChild(card);
        }

        if (familyMeta) {
            const rendered = formatFamilyMetaText_(toStr(family.metaTemplate).trim(), {
                clanCount: String(formatNumber(rosters.length)),
                playerCount: String(formatNumber(totalMembers)),
            });
            familyMeta.textContent = rendered || (String(formatNumber(rosters.length)) + " clans, " + String(formatNumber(totalMembers)) + " tracked players across the family.");
        }
    };

    // Set landing square story step.
    const setLandingSquareStoryStep = (storyRoot, stepIndexRaw) => {
        const story = storyRoot || $("#publicViewLanding [data-landing-square-story]");
        if (!story) return;
        const steps = story.querySelectorAll("[data-landing-square-step]");
        if (!steps.length) return;
        const maxStep = steps.length - 1;
        const stepIndex = Math.max(0, Math.min(maxStep, Number(stepIndexRaw) || 0));
        if (landingSquareStoryActiveStep === stepIndex) return;
        landingSquareStoryActiveStep = stepIndex;
        for (let i = 0; i < steps.length; i++) {
            const node = steps[i];
            const isActive = i === stepIndex;
            node.classList.toggle("is-active", isActive);
            node.setAttribute("aria-current", isActive ? "true" : "false");
        }
    };

    // Return whether compact landing journey layout is active.
    const isLandingCompactJourneyLayout_ = () => {
        if (typeof window === "undefined" || !window) return false;
        if (typeof window.matchMedia === "function") {
            try {
                return window.matchMedia(LANDING_COMPACT_LAYOUT_QUERY).matches;
            } catch (err) { }
        }
        const width = Number(window.innerWidth) || 0;
        const height = Number(window.innerHeight) || 0;
        return width <= 820 || (height <= 520 && width <= 940);
    };

    // Resolve the active compact journey card from the cards' viewport positions.
    const resolveLandingCompactSquareStoryStep = (storyRoot, viewportHeightRaw) => {
        const story = storyRoot || $("#publicViewLanding [data-landing-square-story]");
        if (!story) return -1;
        const steps = Array.prototype.slice.call(story.querySelectorAll("[data-landing-square-step]"));
        if (!steps.length) return -1;
        const stepsWrap = story.querySelector(".landing-shell-map__steps");
        if (!stepsWrap) return -1;

        const viewportHeight = Math.max(1, Number(viewportHeightRaw) || 1);
        const wrapRect = stepsWrap.getBoundingClientRect();
        const isStepsZoneVisible = wrapRect.top < viewportHeight * 0.88 && wrapRect.bottom > viewportHeight * 0.12;
        if (!isStepsZoneVisible) {
            if (wrapRect.top >= viewportHeight * 0.88) return 0;
            if (wrapRect.bottom <= viewportHeight * 0.12) return steps.length - 1;
            return -1;
        }

        const targetY = viewportHeight * 0.52;
        let bestIndex = 0;
        let bestDistance = Infinity;
        for (let i = 0; i < steps.length; i++) {
            const rect = steps[i].getBoundingClientRect();
            const centerY = rect.top + (rect.height * 0.5);
            const distance = Math.abs(centerY - targetY);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = i;
            }
        }
        return bestIndex;
    };

    // Apply landing square story effects.
    const applyLandingSquareStoryEffects = (landingRoot, optionsRaw) => {
        const root = landingRoot || $("#publicViewLanding");
        if (!root) return;
        const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
        const reduceMotion = !!options.reduceMotion;
        const viewportHeight = Math.max(1, Number(options.viewportHeight) || 1);
        const story = root.querySelector("[data-landing-square-story]");
        if (!story) {
            landingSquareStoryActiveStep = -1;
            return;
        }

        if (reduceMotion) {
            story.style.setProperty("--landing-square-progress", "0");
            setLandingSquareStoryStep(story, 0);
            return;
        }

        const rect = story.getBoundingClientRect();
        const scrollRange = Math.max(1, rect.height - (viewportHeight * 0.44));
        const rawProgress = clamp01(((viewportHeight * 0.38) - rect.top) / scrollRange);
        const easedProgress = rawProgress < 0.5
            ? (2 * rawProgress * rawProgress)
            : (1 - (Math.pow((-2 * rawProgress) + 2, 2) / 2));
        story.style.setProperty("--landing-square-progress", easedProgress.toFixed(4));

        let stepIndex = 0;
        if (rawProgress >= 0.9) stepIndex = 2;
        else if (rawProgress >= 0.66) stepIndex = 1;
        if (isLandingCompactJourneyLayout_()) {
            const compactStepIndex = resolveLandingCompactSquareStoryStep(story, viewportHeight);
            if (compactStepIndex >= 0) stepIndex = compactStepIndex;
        }
        setLandingSquareStoryStep(story, stepIndex);
    };

    // Refresh landing reveal targets.
    const refreshLandingRevealTargets = () => {
        const landingRoot = $("#publicViewLanding");
        if (!landingRoot) return;
        const revealTargets = Array.prototype.slice.call(landingRoot.querySelectorAll("[data-landing-reveal]"));
        if (!revealTargets.length) return;

        if (typeof window === "undefined" || !window.IntersectionObserver) {
            for (let i = 0; i < revealTargets.length; i++) {
                revealTargets[i].classList.add("is-visible");
            }
            return;
        }

        if (!landingRevealObserver) {
            landingRevealObserver = new window.IntersectionObserver((entries) => {
                for (let i = 0; i < entries.length; i++) {
                    const entry = entries[i];
                    if (!entry || !entry.target) continue;
                    if (!entry.isIntersecting && entry.intersectionRatio <= 0) continue;
                    entry.target.classList.add("is-visible");
                    if (landingRevealObserver) landingRevealObserver.unobserve(entry.target);
                }
            }, {
                threshold: 0.12,
                rootMargin: "0px 0px -8% 0px",
            });
        }

        for (let i = 0; i < revealTargets.length; i++) {
            const node = revealTargets[i];
            if (node.classList.contains("is-visible")) continue;
            if (node.getAttribute("data-landing-reveal-observed") === "1") continue;
            node.setAttribute("data-landing-reveal-observed", "1");
            landingRevealObserver.observe(node);
        }
    };

    // Apply landing scroll effects frame.
    const applyLandingScrollEffectsFrame = () => {
        landingScrollRafId = 0;
        if (typeof window === "undefined" || typeof document === "undefined") return;

        const docEl = document.documentElement;
        if (!docEl) return;

        const landingRoot = $("#publicViewLanding");
        if (!landingRoot || landingRoot.classList.contains("hidden")) {
            docEl.style.setProperty("--landing-scroll-progress", "0");
            landingSquareStoryActiveStep = -1;
            return;
        }

        const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduceMotion) {
            docEl.style.setProperty("--landing-scroll-progress", "0");
            const heroStatic = landingRoot.querySelector(".landing-hero");
            if (heroStatic) heroStatic.style.setProperty("--landing-hero-depth", "0");
            const staticTargets = landingRoot.querySelectorAll("[data-landing-reveal]");
            for (let i = 0; i < staticTargets.length; i++) {
                staticTargets[i].style.setProperty("--landing-depth", "0");
            }
            applyLandingSquareStoryEffects(landingRoot, {
                reduceMotion: true,
                viewportHeight: 1,
            });
            return;
        }

        const viewportHeight = Math.max(window.innerHeight || 0, 1);
        const scrollTop = Math.max(0, window.pageYOffset || window.scrollY || 0);
        const maxScroll = Math.max(1, (docEl.scrollHeight || 1) - viewportHeight);
        const progress = clamp01(scrollTop / maxScroll);
        docEl.style.setProperty("--landing-scroll-progress", progress.toFixed(4));

        const heroNode = landingRoot.querySelector(".landing-hero");
        if (heroNode) {
            const heroRect = heroNode.getBoundingClientRect();
            const heroCenterOffset = ((heroRect.top + (heroRect.height * 0.5)) - (viewportHeight * 0.5)) / viewportHeight;
            heroNode.style.setProperty("--landing-hero-depth", clampSignedUnit(heroCenterOffset).toFixed(4));
        }

        const revealTargets = landingRoot.querySelectorAll("[data-landing-reveal]");
        for (let i = 0; i < revealTargets.length; i++) {
            const node = revealTargets[i];
            if (!node) continue;
            const rect = node.getBoundingClientRect();
            const centerOffset = ((rect.top + (rect.height * 0.5)) - (viewportHeight * 0.5)) / viewportHeight;
            node.style.setProperty("--landing-depth", clampSignedUnit(centerOffset).toFixed(4));
        }

        applyLandingSquareStoryEffects(landingRoot, {
            reduceMotion: false,
            viewportHeight: viewportHeight,
        });
    };

    // Queue landing scroll effects frame.
    const queueLandingScrollEffectsFrame = () => {
        if (typeof window === "undefined") return;
        if (landingScrollRafId) return;
        landingScrollRafId = window.requestAnimationFrame(applyLandingScrollEffectsFrame);
    };

    // Bind landing scroll effects.
    const bindLandingScrollEffects = () => {
        if (landingScrollEffectsBound || typeof window === "undefined") return;
        landingScrollEffectsBound = true;
        // Queue the next scheduled update.
        const queue = () => queueLandingScrollEffectsFrame();
        const queueAfterViewportChange = () => {
            landingSquareStoryActiveStep = -1;
            queueLandingScrollEffectsFrame();
            window.setTimeout(queueLandingScrollEffectsFrame, 80);
            window.setTimeout(queueLandingScrollEffectsFrame, 260);
        };
        const readViewportSignature = () => {
            const visualViewport = window.visualViewport || null;
            const width = Math.round(Number(window.innerWidth) || 0);
            const height = Math.round(Number(window.innerHeight) || 0);
            const visualWidth = visualViewport ? Math.round(Number(visualViewport.width) || 0) : 0;
            const visualHeight = visualViewport ? Math.round(Number(visualViewport.height) || 0) : 0;
            return [width, height, visualWidth, visualHeight, isLandingCompactJourneyLayout_() ? "compact" : "wide"].join("x");
        };
        let lastViewportSignature = readViewportSignature();
        const queueIfViewportChanged = () => {
            const nextViewportSignature = readViewportSignature();
            if (nextViewportSignature === lastViewportSignature) return;
            lastViewportSignature = nextViewportSignature;
            queueAfterViewportChange();
        };
        window.addEventListener("scroll", queue, { passive: true });
        window.addEventListener("resize", queueAfterViewportChange);
        window.addEventListener("orientationchange", queueAfterViewportChange);
        if (window.visualViewport && typeof window.visualViewport.addEventListener === "function") {
            window.visualViewport.addEventListener("resize", queueAfterViewportChange);
            window.visualViewport.addEventListener("scroll", queue, { passive: true });
        }
        if (typeof window.matchMedia === "function") {
            try {
                const compactLayoutMedia = window.matchMedia(LANDING_COMPACT_LAYOUT_QUERY);
                if (compactLayoutMedia && typeof compactLayoutMedia.addEventListener === "function") {
                    compactLayoutMedia.addEventListener("change", queueAfterViewportChange);
                } else if (compactLayoutMedia && typeof compactLayoutMedia.addListener === "function") {
                    compactLayoutMedia.addListener(queueAfterViewportChange);
                }
            } catch (err) { }
        }
        window.setInterval(queueIfViewportChanged, 500);
        queueLandingScrollEffectsFrame();
    };

    // Set landing media slots to placeholder.
    const setLandingMediaSlotsToPlaceholder = () => {
        const bannerSlot = $("#landingBannerSlot");
        const bannerHost = $("#landingBannerMediaHost");
        const squareSlot = $("#landingSquareSlot");
        const squareHost = $("#landingSquareMediaHost");
        if (bannerSlot && bannerHost) setLandingMediaPlaceholder(bannerSlot, bannerHost, false);
        if (squareSlot && squareHost) setLandingMediaPlaceholder(squareSlot, squareHost, false);
    };

    // Apply landing media from data.
    const applyLandingMediaFromData = (dataRaw, optionsRaw, configOverrideRaw) => {
        const data = dataRaw && typeof dataRaw === "object" ? dataRaw : {};
        const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
        const allowMediaLoading = !!options.allowMediaLoading;
        const config = isPlainObject_(configOverrideRaw) ? configOverrideRaw : getPublicConfigFromData(data);
        const profile = config && isPlainObject_(config.profile) ? config.profile : PUBLIC_PROFILE_DEFAULTS;
        const mediaProfile = profile && isPlainObject_(profile.media) ? profile.media : {};
        applyDiscordLinks(config.discordInviteUrl);
        if (!allowMediaLoading) {
            setLandingMediaSlotsToPlaceholder();
            return;
        }
        setLandingMediaSlotSource({
            slotId: "landingBannerSlot",
            mediaHostId: "landingBannerMediaHost",
            mediaUrl: config.bannerMediaUrl,
            mediaLabel: toStr(mediaProfile.bannerLabel).trim() || "Clan banner animation",
            fallbackCandidates: LANDING_MEDIA_FALLBACK_CANDIDATES.banner,
        });
        setLandingMediaSlotSource({
            slotId: "landingSquareSlot",
            mediaHostId: "landingSquareMediaHost",
            mediaUrl: config.squareMediaUrl,
            mediaLabel: toStr(mediaProfile.squareLabel).trim() || "Clan icon animation",
            fallbackCandidates: LANDING_MEDIA_FALLBACK_CANDIDATES.square,
        });
    };

    // Handle promote landing media start.
    const promoteLandingMediaStart_ = (reasonRaw) => {
        if (landingMediaCanStart) return;
        landingMediaCanStart = true;
        markBootTiming("landing-media-enabled", { reason: toStr(reasonRaw).trim() || "unknown" });
        if (getEffectivePublicView() !== PUBLIC_VIEW_VALUES.landing) return;
        applyLandingMediaFromData(lastRenderedData || {}, { allowMediaLoading: true });
    };

    // Handle schedule deferred landing media start.
    const scheduleDeferredLandingMediaStart_ = () => {
        if (landingMediaCanStart || landingMediaDeferredStartScheduled || typeof window === "undefined") return;
        landingMediaDeferredStartScheduled = true;
        if (typeof window.requestIdleCallback === "function") {
            window.requestIdleCallback(() => promoteLandingMediaStart_("idle"), { timeout: 2500 });
        }
        window.addEventListener("load", () => promoteLandingMediaStart_("window-load"), { once: true });
        window.setTimeout(() => promoteLandingMediaStart_("timeout"), 1800);
    };

    // Render landing view.
    const renderLandingView = (dataRaw, optionsRaw) => {
        const data = dataRaw && typeof dataRaw === "object" ? dataRaw : {};
        const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
        const allowMediaLoading = options.allowMediaLoading === true || (options.allowMediaLoading == null && landingMediaCanStart);
        const publicConfig = getPublicConfigFromData(data);
        applyLandingProfileCopy_(publicConfig.profile);
        applyLandingMediaFromData(data, { allowMediaLoading: allowMediaLoading }, publicConfig);
        renderLandingClanFamily(data, publicConfig.profile);
        refreshLandingRevealTargets();
        if (getEffectivePublicView() === PUBLIC_VIEW_VALUES.landing) {
            ensureLandingEffectsActive();
        }
    };

    // Remove global loading card.
    const removeGlobalLoadingCard = () => {
        const loading = $("#loading");
        if (loading) loading.remove();
    };

    // Create a view loading skeleton line.
    const createViewLoadingSkeletonLine = (modifierRaw) => {
        const modifier = toStr(modifierRaw).trim();
        const className = modifier
            ? "view-loading-skeleton__line view-loading-skeleton__line--" + modifier
            : "view-loading-skeleton__line";
        return el("span", className);
    };

    // Render landing loading state.
    const renderLandingLoadingState = () => {
        const loadingConfig = getPublicConfigFromData({});
        renderLandingView({}, { allowMediaLoading: landingMediaCanStart });

        const familyMeta = $("#landingFamilyMeta");
        const loadingFamily = loadingConfig && loadingConfig.profile && loadingConfig.profile.family
            ? loadingConfig.profile.family
            : null;
        const loadingText = toStr(loadingFamily && loadingFamily.loadingMetaText).trim();
        if (familyMeta) familyMeta.textContent = loadingText || "Syncing the latest family snapshot. Live lineup stats will appear shortly.";

        const target = $("#landingClanFamilyGrid");
        if (!target) return;
        clearNode(target);

        const loadingGrid = el("div", "landing-family-loading-grid");
        for (let i = 0; i < 4; i++) {
            const card = el("article", "landing-shell-clan landing-shell-clan--loading landing-family-card--loading view-loading-skeleton");
            const angle = -112 + ((224 / 3) * i);
            const radians = angle * Math.PI / 180;
            card.style.setProperty("--orbit-x", (50 + (Math.cos(radians) * 39)).toFixed(2));
            card.style.setProperty("--orbit-y", (52 + (Math.sin(radians) * 35)).toFixed(2));
            card.style.setProperty("--plate-tilt", String((i % 2 === 0 ? -7 : 7)) + "deg");
            card.appendChild(createViewLoadingSkeletonLine("title"));
            card.appendChild(createViewLoadingSkeletonLine("value"));
            card.appendChild(createViewLoadingSkeletonLine("label"));
            loadingGrid.appendChild(card);
        }
        target.appendChild(loadingGrid);
    };

    // Render rosters loading state.
    const renderRostersLoadingState = () => {
        const target = $("#rosters");
        if (!target) return;
        renderRosterNavigator([], []);
        target.textContent = "";
        for (let i = 0; i < 3; i++) {
            const card = el("article", "card roster-loading-card view-loading-skeleton");
            const head = el("div", "roster-loading-card__head");
            const headMain = el("div", "roster-loading-card__head-main");
            headMain.appendChild(createViewLoadingSkeletonLine("title"));
            headMain.appendChild(createViewLoadingSkeletonLine("subtitle"));

            const headMeta = el("div", "roster-loading-card__head-meta");
            headMeta.appendChild(createViewLoadingSkeletonLine("pill"));
            headMeta.appendChild(createViewLoadingSkeletonLine("pill"));
            if (i === 0) headMeta.appendChild(createViewLoadingSkeletonLine("pill"));

            head.appendChild(headMain);
            head.appendChild(headMeta);
            card.appendChild(head);

            for (let sectionIndex = 0; sectionIndex < 2; sectionIndex++) {
                const section = el("div", "roster-loading-card__section");
                section.appendChild(createViewLoadingSkeletonLine("section"));
                for (let rowIndex = 0; rowIndex < 3; rowIndex++) {
                    const row = el("div", "roster-loading-card__row");
                    row.appendChild(createViewLoadingSkeletonLine("avatar"));
                    const rowBody = el("div", "roster-loading-card__row-body");
                    rowBody.appendChild(createViewLoadingSkeletonLine("name"));
                    rowBody.appendChild(createViewLoadingSkeletonLine("meta"));
                    row.appendChild(rowBody);
                    section.appendChild(row);
                }
                card.appendChild(section);
            }

            target.appendChild(card);
        }

        const searchInput = $("#rosterSearchInput");
        updateSearchInfo({
            query: searchInput ? toStr(searchInput.value).trim().toLowerCase() : "",
            totalPlayers: 0,
            totalRosters: 0,
            matchedPlayers: 0,
            matchedRosters: 0,
        });
    };

    // Render leaderboard loading state.
    const renderLeaderboardLoadingState = () => {
        const target = $("#leaderboard");
        if (!target) return;
        target.textContent = "";
        const section = el("section", "season-events-section");
        const header = el("div", "season-events-section__header view-loading-skeleton");
        const copy = el("div", "season-events-section__copy");
        copy.appendChild(createViewLoadingSkeletonLine("title"));
        copy.appendChild(createViewLoadingSkeletonLine("meta"));
        header.appendChild(copy);
        const controls = el("div", "season-events-mode-toggle");
        controls.appendChild(createViewLoadingSkeletonLine("chip"));
        controls.appendChild(createViewLoadingSkeletonLine("chip"));
        header.appendChild(controls);
        section.appendChild(header);
        section.appendChild(renderSeasonEventsLoadingGrid());
        target.appendChild(section);
    };

    // Render data pending view state.
    const renderDataPendingViewState = (viewRaw) => {
        const activeView = sanitizePublicViewValue(viewRaw);
        showShellLoadingNotice(activeView);
        const freshnessCard = $("#globalLastUpdated");
        if (freshnessCard) freshnessCard.classList.add("hidden");
        clearGlobalLastUpdatedTimer();

        if (activeView === PUBLIC_VIEW_VALUES.leaderboard) {
            renderLeaderboardLoadingState();
        } else if (activeView === PUBLIC_VIEW_VALUES.rosters) {
            renderRostersLoadingState();
        } else {
            renderLandingLoadingState();
        }
        removeGlobalLoadingCard();
    };

    // Scroll public view to top after navigation.
    const scrollPublicViewToTop = () => {
        if (typeof window === "undefined" || !window || window.ROSTER_ADMIN_MODE) return;
        if (typeof window.scrollTo !== "function") return;
        try {
            window.scrollTo({ top: 0, left: 0, behavior: "auto" });
        } catch (err) {
            window.scrollTo(0, 0);
        }
    };

    // Set public view.
    const setPublicView = (viewRaw) => {
        const nextView = sanitizePublicViewValue(viewRaw);
        if (nextView !== PUBLIC_VIEW_VALUES.rosters) clearRosterAnchorHash();
        if (!publicViewState || typeof publicViewState !== "object") publicViewState = buildDefaultPublicViewState();
        if (publicViewState.view === nextView) {
            syncPublicViewButtonsUi();
            syncPublicViewVisibility(nextView);
            if (!lastRenderedData) renderDataPendingViewState(nextView);
            return;
        }
        publicViewState.view = nextView;
        persistPublicViewState();
        syncPublicViewButtonsUi();
        syncPublicViewVisibility(nextView);
        if (lastRenderedData) render(lastRenderedData);
        else renderDataPendingViewState(nextView);
        scrollPublicViewToTop();
    };

    // Ensure the leaderboard view state uses the season-event results schema.
    const ensureSeasonEventResultsViewState = () => {
        if (!publicViewState || typeof publicViewState !== "object") publicViewState = buildDefaultPublicViewState();
        const current = publicViewState.leaderboard && typeof publicViewState.leaderboard === "object"
            ? publicViewState.leaderboard
            : {};
        publicViewState.leaderboard = {
            seasonEventResultsMode: sanitizeSeasonEventResultsMode(current.seasonEventResultsMode),
        };
        return publicViewState.leaderboard;
    };

    // Attach previous season event data to the current render payload.
    const attachPreviousSeasonEventsBundle = (dataRaw, bundleRaw) => {
        const data = dataRaw && typeof dataRaw === "object" ? dataRaw : null;
        if (!data) return;
        if (!data.seasonEvents || typeof data.seasonEvents !== "object" || Array.isArray(data.seasonEvents)) {
            data.seasonEvents = buildEmptySeasonEventsBundle([]);
        }
        data.seasonEvents.previous = bundleRaw && typeof bundleRaw === "object" && !Array.isArray(bundleRaw)
            ? bundleRaw
            : buildEmptySeasonEventsBundle([]);
    };

    // Load previous season event data when requested.
    const startPreviousSeasonEventsLoad = () => {
        if (previousSeasonEventsLoadInFlight || !lastRenderedData || hasPreviousSeasonEventsBundle(lastRenderedData)) return;
        previousSeasonEventsLoadInFlight = true;
        const requestId = ++previousSeasonEventsLoadRequestId;
        render(lastRenderedData);
        loadPreviousSeasonEventsViaCloudflarePublic(lastRenderedData)
            .then(async (bundle) => {
                if (requestId !== previousSeasonEventsLoadRequestId) return;
                attachPreviousSeasonEventsBundle(lastRenderedData, bundle);
                await hydrateDonationRefreshForLoadedSeasonEvents(lastRenderedData);
            })
            .catch((err) => {
                if (requestId !== previousSeasonEventsLoadRequestId) return;
                attachPreviousSeasonEventsBundle(lastRenderedData, buildEmptySeasonEventsBundle([{
                    path: "/" + SEASON_EVENTS_BY_SEASON_PATH,
                    message: err && err.message ? err.message : toStr(err),
                }]));
            })
            .finally(() => {
                if (requestId !== previousSeasonEventsLoadRequestId) return;
                previousSeasonEventsLoadInFlight = false;
                if (lastRenderedData) render(lastRenderedData);
            });
    };

    // Set selected season event results mode.
    const setSeasonEventResultsMode = (modeRaw) => {
        const nextMode = sanitizeSeasonEventResultsMode(modeRaw);
        const leaderboard = ensureSeasonEventResultsViewState();
        const changed = leaderboard.seasonEventResultsMode !== nextMode;
        leaderboard.seasonEventResultsMode = nextMode;
        if (changed) persistPublicViewState();
        if (nextMode === SEASON_EVENT_RESULT_MODE_VALUES.previous) startPreviousSeasonEventsLoad();
        if (lastRenderedData) render(lastRenderedData);
    };

    // Render rosters view.
    const renderRostersView = (dataRaw) => {
        const target = $("#rosters");
        if (!target) return;
        const data = dataRaw && typeof dataRaw === "object" ? dataRaw : {};
        const canonicalRosters = Array.isArray(data.rosters) ? data.rosters : getOrderedRostersFromData(data);
        const isAdminMode = typeof window !== "undefined" && !!window.ROSTER_ADMIN_MODE;
        const displayBundle = buildRosterDisplayBundle(canonicalRosters, {
            useProjection: !isAdminMode,
        });
        const allRosters = displayBundle.rosters;
        lastRenderedRosterDisplayById = displayBundle.byRosterId;
        const searchInput = $("#rosterSearchInput");
        const rawQuery = searchInput ? toStr(searchInput.value) : "";
        const filtered = filterRostersByQuery(allRosters, rawQuery);
        const isSearchMode = !!filtered.query;
        const hideSuggestions = isSearchMode && !isAdminMode;

        const navigatorModels = buildRosterNavigatorModels(filtered.rosters);
        const rosterCards = [];
        target.textContent = "";
        for (let i = 0; i < filtered.rosters.length; i++) {
            const card = renderRosterCard(filtered.rosters[i], {
                showEmptySections: !isSearchMode,
                hideSuggestions: hideSuggestions,
                expandMissingByDefault: isSearchMode,
                data: data,
            });
            card.id = navigatorModels[i].anchorId;
            card.classList.add("roster-card--anchored");
            card.dataset.rosterAnchor = navigatorModels[i].anchorId;
            rosterCards.push(card);
            target.appendChild(card);
        }

        renderRosterNavigator(navigatorModels, rosterCards);

        if (!filtered.rosters.length) {
            const emptyCard = el("div", "card");
            const queryDisplay = toStr(rawQuery).trim();
            const message = filtered.query
                ? "No players matched \"" + queryDisplay + "\"."
                : "No roster data available.";
            emptyCard.appendChild(el("div", "empty", message));
            target.appendChild(emptyCard);
        }

        if (searchInput) {
            updateSearchInfo({
                query: filtered.query,
                totalPlayers: countPlayersInRosters(allRosters),
                totalRosters: allRosters.length,
                matchedPlayers: filtered.matchedPlayers,
                matchedRosters: filtered.rosters.length,
            });
        }
        ensureWarCountdownTimer();
    };

    // Render leaderboard view.
    const renderLeaderboardView = (dataRaw) => {
        const target = $("#leaderboard");
        if (!target) return;
        const data = dataRaw && typeof dataRaw === "object" ? dataRaw : {};
        ensureSeasonEventResultsViewState();
        target.textContent = "";
        target.appendChild(renderSeasonEventsSection(data));
    };

    // Render public app.
    const renderPublicApp = (data) => {
        const rostersTarget = $("#rosters");
        const leaderboardTarget = $("#leaderboard");
        const landingView = $("#publicViewLanding");
        const isAdminMode = typeof window !== "undefined" && window && window.ROSTER_ADMIN_MODE === true;
        if (!rostersTarget) return;
        if (!isAdminMode && (!leaderboardTarget || !landingView)) return;

        const safeData = data && typeof data === "object" ? data : {};
        const allRosters = getOrderedRostersFromData(safeData);
        const rosterDisplayBundle = buildRosterDisplayBundle(allRosters, {
            useProjection: !isAdminMode,
        });
        lastRenderedRosterDisplayById = rosterDisplayBundle.byRosterId;
        lastRenderedData = Object.assign({}, safeData, {
            rosters: allRosters,
            rosterOrder: buildRosterOrderFromRosters(allRosters),
        });
        lastRenderedRosterFreshnessKey = getRosterPayloadFreshnessKey(lastRenderedData);

        const pageTitleHeading = $("#pageTitleHeading");
        const pageTitleText = toStr(safeData.pageTitle).trim();
        if (pageTitleText) {
            document.title = pageTitleText;
            if (pageTitleHeading) pageTitleHeading.textContent = pageTitleText;
        }
        const publicConfig = getPublicConfigFromData(lastRenderedData);
        applyLandingProfileCopy_(publicConfig.profile);
        applyDiscordLinks(publicConfig.discordInviteUrl);

        const activeView = getEffectivePublicView();
        syncPublicViewButtonsUi();
        syncPublicViewVisibility(activeView);

        if (activeView === PUBLIC_VIEW_VALUES.landing && landingView) {
            const freshnessCard = $("#globalLastUpdated");
            if (freshnessCard) freshnessCard.classList.add("hidden");
            clearGlobalLastUpdatedTimer();
            renderLandingView(lastRenderedData);
        } else if (activeView === PUBLIC_VIEW_VALUES.leaderboard && leaderboardTarget) {
            renderGlobalLastUpdated(safeData);
            renderLeaderboardView(lastRenderedData);
        } else {
            renderGlobalLastUpdated(safeData);
            renderRostersView(lastRenderedData);
        }

        syncProfileModalFromRender();

        const loading = $("#loading");
        if (loading) loading.remove();
        if (rosterHydrationInFlight) showShellLoadingNotice(activeView);
        else hideShellLoadingNotice();
    };

    const render = renderPublicApp;

    // Bind public view UI.
    const bindPublicViewUi = () => {
        if (publicViewUiBound) return;
        publicViewUiBound = true;
        const buttons = getPublicViewButtons();
        if (buttons.landing) {
            buttons.landing.addEventListener("click", () => {
                setPublicView(PUBLIC_VIEW_VALUES.landing);
            });
        }
        if (buttons.rosters) {
            buttons.rosters.addEventListener("click", () => {
                setPublicView(PUBLIC_VIEW_VALUES.rosters);
            });
        }
        if (buttons.leaderboard) {
            buttons.leaderboard.addEventListener("click", () => {
                setPublicView(PUBLIC_VIEW_VALUES.leaderboard);
            });
        }
        const landingHeroRostersCta = $("#landingHeroRostersCta");
        if (landingHeroRostersCta) {
            landingHeroRostersCta.addEventListener("click", () => {
                setPublicView(PUBLIC_VIEW_VALUES.rosters);
            });
        }
        const landingBottomLeaderboardCta = $("#landingBottomLeaderboardCta");
        if (landingBottomLeaderboardCta) {
            landingBottomLeaderboardCta.addEventListener("click", () => {
                setPublicView(PUBLIC_VIEW_VALUES.leaderboard);
            });
        }
        syncPublicViewButtonsUi();
        syncPublicViewVisibility(getEffectivePublicView());
    };

    // Bind search UI.
    const bindSearchUi = () => {
        if (searchUiBound) return;

        const searchInput = $("#rosterSearchInput");
        if (!searchInput) return;

        searchUiBound = true;

        const clearBtn = $("#clearRosterSearchBtn");
        searchInput.addEventListener("input", () => {
            if (lastRenderedData) {
                render(lastRenderedData);
            } else {
                updateSearchInfo({ query: toStr(searchInput.value).trim().toLowerCase() });
            }
        });

        if (clearBtn) {
            clearBtn.addEventListener("click", () => {
                searchInput.value = "";
                if (lastRenderedData) render(lastRenderedData);
                else updateSearchInfo({ query: "" });
                searchInput.focus();
            });
        }
    };

    // Load roster data via server.
    const loadRosterDataViaServer = () => runServerMethod("getRosterData", []);

    // Handle assert valid roster payload.
    const assertValidRosterPayload = (dataRaw, sourceLabelRaw) => {
        const sourceLabel = toStr(sourceLabelRaw).trim() || "Roster source";
        const data = dataRaw && typeof dataRaw === "object" ? dataRaw : null;
        if (!data || Array.isArray(data) || !Array.isArray(data.rosters)) {
            throw new Error(sourceLabel + " returned invalid roster payload.");
        }
        return data;
    };

    // Clone JSON-compatible roster data before reusing a cached snapshot.
    const cloneJsonValue = (valueRaw) => {
        if (!valueRaw || typeof valueRaw !== "object") return valueRaw;
        return JSON.parse(JSON.stringify(valueRaw));
    };

    // Return the browser IndexedDB factory, if available.
    const getIndexedDbFactory = () => {
        if (typeof window !== "undefined" && window && window.indexedDB) return window.indexedDB;
        if (typeof indexedDB !== "undefined" && indexedDB) return indexedDB;
        return null;
    };

    // Open the durable roster snapshot database.
    const openRosterSnapshotIndexedDb = () => new Promise((resolve) => {
        const indexedDbFactory = getIndexedDbFactory();
        if (!indexedDbFactory || typeof indexedDbFactory.open !== "function") {
            resolve(null);
            return;
        }

        let request = null;
        try {
            request = indexedDbFactory.open(ROSTER_SNAPSHOT_IDB_DB_NAME, 1);
        } catch (err) {
            resolve(null);
            return;
        }

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db || typeof db.createObjectStore !== "function") return;
            const storeNames = db.objectStoreNames;
            const hasStore = storeNames && typeof storeNames.contains === "function"
                ? storeNames.contains(ROSTER_SNAPSHOT_IDB_STORE_NAME)
                : false;
            if (!hasStore) db.createObjectStore(ROSTER_SNAPSHOT_IDB_STORE_NAME);
        };
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
    });

    // Read the durable roster snapshot payload from IndexedDB.
    const readRosterSnapshotPayloadFromIndexedDb = async () => {
        const db = await openRosterSnapshotIndexedDb();
        if (!db) return null;

        return new Promise((resolve) => {
            let result = null;
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                try {
                    if (typeof db.close === "function") db.close();
                } catch (err) {
                    // ignore close errors
                }
                resolve(value || null);
            };

            try {
                const transaction = db.transaction(ROSTER_SNAPSHOT_IDB_STORE_NAME, "readonly");
                const store = transaction.objectStore(ROSTER_SNAPSHOT_IDB_STORE_NAME);
                const request = store.get(ROSTER_SNAPSHOT_CACHE_KEY);
                request.onsuccess = () => {
                    result = request.result || null;
                };
                request.onerror = () => finish(null);
                transaction.oncomplete = () => finish(result);
                transaction.onerror = () => finish(null);
                transaction.onabort = () => finish(null);
            } catch (err) {
                finish(null);
            }
        });
    };

    // Write the durable roster snapshot payload to IndexedDB.
    const writeRosterSnapshotPayloadToIndexedDb = async (payload) => {
        if (!payload || typeof payload !== "object") return false;
        const db = await openRosterSnapshotIndexedDb();
        if (!db) return false;

        return new Promise((resolve) => {
            let requestFailed = false;
            let settled = false;
            const finish = (ok) => {
                if (settled) return;
                settled = true;
                try {
                    if (typeof db.close === "function") db.close();
                } catch (err) {
                    // ignore close errors
                }
                resolve(ok === true);
            };

            try {
                const transaction = db.transaction(ROSTER_SNAPSHOT_IDB_STORE_NAME, "readwrite");
                const store = transaction.objectStore(ROSTER_SNAPSHOT_IDB_STORE_NAME);
                const request = store.put(payload, ROSTER_SNAPSHOT_CACHE_KEY);
                request.onerror = () => {
                    requestFailed = true;
                };
                transaction.oncomplete = () => finish(!requestFailed);
                transaction.onerror = () => finish(false);
                transaction.onabort = () => finish(false);
            } catch (err) {
                finish(false);
            }
        });
    };

    // Get roster payload freshness key.
    const getRosterPayloadFreshnessKey = (dataRaw) => {
        const data = dataRaw && typeof dataRaw === "object" ? dataRaw : {};
        const lastUpdatedAt = toStr(data.lastUpdatedAt).trim();
        const seasonEvents = data.seasonEvents && typeof data.seasonEvents === "object" ? data.seasonEvents : {};
        const current = seasonEvents.current && typeof seasonEvents.current === "object" ? seasonEvents.current : {};
        const byId = seasonEvents.byId && typeof seasonEvents.byId === "object" ? seasonEvents.byId : {};
        const pushId = toStr(current.push && current.push.eventId).trim();
        const donationId = toStr(current.donation && current.donation.eventId).trim();
        const pushUpdatedAt = toStr(byId[pushId] && byId[pushId].updatedAt).trim();
        const donationUpdatedAt = toStr(byId[donationId] && byId[donationId].updatedAt).trim();
        const parts = [];
        if (lastUpdatedAt) parts.push("lastUpdatedAt:" + lastUpdatedAt);
        if (pushId) parts.push("push:" + pushId + "@" + pushUpdatedAt);
        if (donationId) parts.push("donation:" + donationId + "@" + donationUpdatedAt);
        const donationRefresh = data.donationRefresh && typeof data.donationRefresh === "object" ? data.donationRefresh : {};
        const bySeason = donationRefresh.bySeason && typeof donationRefresh.bySeason === "object" ? donationRefresh.bySeason : {};
        const seasonIds = Object.keys(bySeason).sort();
        for (let i = 0; i < seasonIds.length; i++) {
            const seasonId = sanitizeDonationCycleKey(seasonIds[i]);
            const overlay = bySeason[seasonIds[i]] && typeof bySeason[seasonIds[i]] === "object" ? bySeason[seasonIds[i]] : {};
            const meta = overlay.meta && typeof overlay.meta === "object" ? overlay.meta : {};
            const updatedAt = toStr(meta.updatedAt || overlay.updatedAt).trim();
            if (seasonId) parts.push("donationRefresh:" + seasonId + "@" + updatedAt);
        }
        return parts.join("|");
    };

    // Build a cached roster snapshot payload.
    const buildCachedRosterSnapshotPayload = (dataRaw, sourceRaw, metadataRaw) => {
        const data = assertValidRosterPayload(dataRaw, "Roster snapshot cache write");
        const metadata = metadataRaw && typeof metadataRaw === "object" ? metadataRaw : {};
        return {
            schemaVersion: 1,
            cachedAt: new Date().toISOString(),
            source: toStr(sourceRaw).trim() || "unknown",
            freshnessKey: getRosterPayloadFreshnessKey(data),
            activeVersionId: toStr(metadata.activeVersionId).trim(),
            data: data,
        };
    };

    // Normalize cached roster snapshot payload.
    const normalizeCachedRosterSnapshotPayload = (payloadRaw, sourceLabelRaw) => {
        try {
            const sourceLabel = toStr(sourceLabelRaw).trim() || "Cached roster snapshot";
            const payload = payloadRaw && typeof payloadRaw === "object" ? payloadRaw : null;
            if (!payload) return null;
            const data = assertValidRosterPayload(payload.data, "Cached roster snapshot");
            const cachedAtText = toStr(payload.cachedAt).trim();
            const cachedAtMs = cachedAtText ? Date.parse(cachedAtText) : 0;
            if (cachedAtMs > 0 && Date.now() - cachedAtMs > ROSTER_SNAPSHOT_CACHE_MAX_AGE_MS) {
                return null;
            }
            const cachedSourceRaw = toStr(payload.source).trim();
            const cachedSource = /^cloudflare-public(?:-|$)/.test(cachedSourceRaw) ? cachedSourceRaw : "cache";
            return {
                data: data,
                cachedAt: cachedAtMs > 0 ? new Date(cachedAtMs).toISOString() : "",
                source: cachedSource,
                freshnessKey: toStr(payload.freshnessKey).trim() || getRosterPayloadFreshnessKey(data),
                activeVersionId: toStr(payload.activeVersionId).trim(),
                cacheSource: sourceLabel,
            };
        } catch (err) {
            return null;
        }
    };

    // Handle read cached roster snapshot from localStorage.
    const readCachedRosterSnapshot = () =>
        normalizeCachedRosterSnapshotPayload(
            readLocalStorageJson(ROSTER_SNAPSHOT_CACHE_KEY),
            "localStorage"
        );

    // Handle read cached roster snapshot from IndexedDB.
    const readIndexedDbCachedRosterSnapshot = async () =>
        normalizeCachedRosterSnapshotPayload(
            await readRosterSnapshotPayloadFromIndexedDb(),
            "IndexedDB"
        );

    // Select the best available cached roster snapshot.
    const selectPreferredCachedRosterSnapshot = (firstRaw, secondRaw) => {
        const first = firstRaw && typeof firstRaw === "object" ? firstRaw : null;
        const second = secondRaw && typeof secondRaw === "object" ? secondRaw : null;
        if (!first) return second;
        if (!second) return first;

        const firstAt = Date.parse(toStr(first.cachedAt).trim()) || 0;
        const secondAt = Date.parse(toStr(second.cachedAt).trim()) || 0;
        if (secondAt > firstAt) return second;
        if (!first.activeVersionId && second.activeVersionId) return second;
        return first;
    };

    // Handle read durable cached roster snapshot.
    const readDurableCachedRosterSnapshot = async (localSnapshotRaw) => {
        const localSnapshot = localSnapshotRaw && typeof localSnapshotRaw === "object"
            ? localSnapshotRaw
            : readCachedRosterSnapshot();
        const indexedDbSnapshot = await readIndexedDbCachedRosterSnapshot();
        return selectPreferredCachedRosterSnapshot(localSnapshot, indexedDbSnapshot);
    };

    // Handle write cached roster snapshot.
    const writeCachedRosterSnapshot = async (dataRaw, sourceRaw, metadataRaw) => {
        try {
            const payload = buildCachedRosterSnapshotPayload(dataRaw, sourceRaw, metadataRaw);
            const localWritten = writeLocalStorageJson(ROSTER_SNAPSHOT_CACHE_KEY, payload);
            if (!localWritten) removeLocalStorageItem(ROSTER_SNAPSHOT_CACHE_KEY);
            const indexedDbWritten = await writeRosterSnapshotPayloadToIndexedDb(payload);
            return localWritten || indexedDbWritten;
        } catch (err) {
            // Ignore storage/validation errors.
            return false;
        }
    };

    // Normalize public data base URL.
    const normalizePublicDataBaseUrl = (urlRaw) => {
        const raw = toStr(urlRaw).trim();
        if (!raw) return "";
        if (/^https?:\/\//i.test(raw) || raw.charAt(0) === "/") {
            return raw.replace(/\/+$/, "");
        }
        return "";
    };

    // Normalize public data path.
    const normalizePublicDataPath = (pathRaw) =>
        toStr(pathRaw)
            .trim()
            .replace(/\\/g, "/")
            .replace(/^[\/]+|[\/]+$/g, "")
            .replace(/\.\./g, "");

    // Build Cloudflare public data JSON URL.
    const buildCloudflarePublicJsonUrl = (pathRaw) => {
        const configuredBaseUrl = normalizePublicDataBaseUrl(
            (typeof window !== "undefined" && window && window.ROSTER_PUBLIC_DATA_BASE_URL)
                ? window.ROSTER_PUBLIC_DATA_BASE_URL
                : ""
        );
        const publicDataBaseUrl = configuredBaseUrl || PUBLIC_DATA_BASE_FALLBACK_URL;
        if (!publicDataBaseUrl) {
            throw new Error("Missing window.ROSTER_PUBLIC_DATA_BASE_URL for public data hydration. Set it in public-config.js.");
        }

        const safePath = normalizePublicDataPath(pathRaw);
        const queryIndex = publicDataBaseUrl.indexOf("?");
        const baseWithoutQuery = queryIndex >= 0 ? publicDataBaseUrl.slice(0, queryIndex) : publicDataBaseUrl;
        const baseNoQuery = baseWithoutQuery.replace(/\/+$/, "");
        const querySuffix = queryIndex >= 0 ? publicDataBaseUrl.slice(queryIndex) : "";
        const encodedSegments = safePath
            ? safePath.split("/").filter((segment) => segment).map((segment) => encodeURIComponent(segment))
            : [];

        if (/\.json$/i.test(baseNoQuery)) {
            if (!encodedSegments.length) return baseNoQuery + querySuffix;
            const base = baseNoQuery.replace(/\/+\.json$/i, "");
            return base + "/" + encodedSegments.join("/") + ".json" + querySuffix;
        }
        if (!encodedSegments.length) return baseNoQuery + "/.json" + querySuffix;
        return baseNoQuery + "/" + encodedSegments.join("/") + ".json" + querySuffix;
    };

    // Parse JSON text strict.
    const parseJsonTextStrict = (textRaw, sourceLabelRaw) => {
        const sourceLabel = toStr(sourceLabelRaw).trim() || "JSON response";
        const text = toStr(textRaw);
        if (!text.trim()) {
            throw new Error(sourceLabel + " returned an empty response.");
        }
        try {
            return JSON.parse(text);
        } catch (err) {
            throw new Error(sourceLabel + " returned invalid JSON: " + ((err && err.message) ? err.message : String(err)));
        }
    };

    // Fetch Cloudflare public JSON.
    const fetchCloudflarePublicJson = async (pathRaw) => {
        const safePath = normalizePublicDataPath(pathRaw);
        const pathLabel = "/" + (safePath || "");
        if (typeof fetch !== "function") {
            throw new Error("window.fetch is unavailable for public data hydration.");
        }
        const response = await fetch(buildCloudflarePublicJsonUrl(safePath), {
            method: "GET",
            cache: "default",
            credentials: "same-origin",
        });
        if (!response || !response.ok) {
            const error = new Error(
                "Cloudflare public data fetch failed for " +
                pathLabel +
                " (" +
                (response ? response.status : "unknown") +
                ")."
            );
            error.status = response ? Number(response.status) || 0 : 0;
            const retryAfterRaw = response && response.headers && typeof response.headers.get === "function"
                ? toStr(response.headers.get("retry-after")).trim()
                : "";
            if (retryAfterRaw) {
                const seconds = Number(retryAfterRaw);
                const retryAtMs = Number.isFinite(seconds)
                    ? Date.now() + Math.max(0, seconds * 1000)
                    : Date.parse(retryAfterRaw);
                if (Number.isFinite(retryAtMs) && retryAtMs > Date.now()) error.retryAfterMs = retryAtMs - Date.now();
            }
            throw error;
        }
        const responseText = await response.text();
        return parseJsonTextStrict(responseText, "Cloudflare public data fetch for " + pathLabel);
    };

    // Handle base64 URL decode to utf8.
    const base64UrlDecodeToUtf8 = (valueRaw) => {
        let value = toStr(valueRaw).trim();
        if (!value) return "";
        const mod = value.length % 4;
        if (mod === 1) throw new Error("Invalid base64url payload length.");
        if (mod > 0) value += "====".slice(mod);
        const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
        if (typeof atob !== "function") throw new Error("Base64 decoder is unavailable in this browser.");

        let binary = "";
        try {
            binary = atob(base64);
        } catch (err) {
            throw new Error(err && err.message ? err.message : String(err));
        }

        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        if (typeof TextDecoder === "function") {
            return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        }

        let escaped = "";
        for (let i = 0; i < bytes.length; i++) {
            escaped += "%" + bytes[i].toString(16).padStart(2, "0");
        }
        try {
            return decodeURIComponent(escaped);
        } catch (err) {
            throw new Error(err && err.message ? err.message : String(err));
        }
    };

    // Handle utf8 to base64 URL encode.
    const base64UrlEncodeUtf8 = (valueRaw) => {
        const value = toStr(valueRaw);
        if (!value) return "";
        let binary = "";
        if (typeof TextEncoder === "function") {
            const bytes = new TextEncoder().encode(value);
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        } else {
            binary = unescape(encodeURIComponent(value));
        }
        if (typeof btoa !== "function") throw new Error("Base64 encoder is unavailable in this browser.");
        return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    };

    // Return whether a public-data object key needs encoding.
    const needsPublicDataKeyEncoding = (keyRaw) => {
        const key = toStr(keyRaw);
        if (!key) return true;
        if (key.indexOf(PUBLIC_DATA_KEY_ENCODING_PREFIX) === 0) return true;
        if (/[.$#[\]\/]/.test(key)) return true;
        if (/[\u0000-\u001F\u007F]/.test(key)) return true;
        return false;
    };

    // Encode a public-data object key.
    const encodePublicDataObjectKey = (keyRaw) => {
        const key = toStr(keyRaw);
        if (!needsPublicDataKeyEncoding(key)) return key;
        return PUBLIC_DATA_KEY_ENCODING_PREFIX + base64UrlEncodeUtf8(key);
    };

    // Decode a public-data object key.
    const decodePublicDataObjectKey = (keyRaw) => {
        const key = toStr(keyRaw);
        if (key.indexOf(PUBLIC_DATA_KEY_ENCODING_PREFIX) !== 0) return key;
        const encodedPart = key.slice(PUBLIC_DATA_KEY_ENCODING_PREFIX.length);
        if (!encodedPart) throw new Error("Invalid public-data encoded key with empty payload.");
        try {
            return base64UrlDecodeToUtf8(encodedPart);
        } catch (err) {
            throw new Error("Invalid public-data encoded key '" + key + "': " + ((err && err.message) ? err.message : String(err)));
        }
    };

    // Decode public-data object keys recursively.
    const decodePublicDataObjectKeysRecursive = (valueRaw) => {
        if (Array.isArray(valueRaw)) {
            const outArray = [];
            for (let i = 0; i < valueRaw.length; i++) outArray.push(decodePublicDataObjectKeysRecursive(valueRaw[i]));
            return outArray;
        }
        if (!valueRaw || typeof valueRaw !== "object") return valueRaw;
        const out = {};
        const keys = Object.keys(valueRaw);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const decodedKey = decodePublicDataObjectKey(key);
            if (Object.prototype.hasOwnProperty.call(out, decodedKey) && decodedKey !== key) {
                throw new Error("Public-data key decoding collision for object key '" + key + "'.");
            }
            out[decodedKey] = decodePublicDataObjectKeysRecursive(valueRaw[key]);
        }
        return out;
    };

    // Build an active version public data path.
    const buildActiveVersionPublicPath = (versionIdRaw, childPathRaw) => {
        const versionId = toStr(versionIdRaw).trim();
        if (!versionId) return "";
        const childPath = normalizePublicDataPath(childPathRaw);
        const basePath = ACTIVE_VERSIONS_PATH + "/" + encodePublicDataObjectKey(versionId);
        return childPath ? basePath + "/" + childPath : basePath;
    };

    // Load current active published version id from public data.
    const loadActivePublishedVersionIdViaCloudflarePublic = async () =>
        toStr(await fetchCloudflarePublicJson(ACTIVE_PUBLISHED_CURRENT_VERSION_PATH)).trim();

    // Load all immutable shards for one exact version in parallel.
    const fetchPublishedActiveVersionShardsViaCloudflarePublic = async (versionIdRaw) => {
        const versionId = toStr(versionIdRaw).trim();
        if (!versionId) throw new Error("Missing active published version pointer.");
        const paths = ["manifest", "rosters", "playerMetrics"];
        const payloads = await Promise.all(paths.map((childPath) =>
            fetchCloudflarePublicJson(buildActiveVersionPublicPath(versionId, childPath))
        ));
        return {
            manifestPayload: payloads[0],
            rostersPayload: payloads[1],
            playerMetricsPayload: payloads[2],
        };
    };

    const waitForImmutablePublicRetry = async (errorRaw, deadlineMsRaw) => {
        const error = errorRaw && typeof errorRaw === "object" ? errorRaw : {};
        const deadlineMs = Math.max(0, Number(deadlineMsRaw) || 0);
        const remainingMs = deadlineMs ? Math.max(0, deadlineMs - Date.now()) : PUBLIC_DATA_BOOT_RETRY_BUDGET_MS;
        if (remainingMs <= 0) return false;
        const requestedMs = Math.max(0, Number(error.retryAfterMs) || 100);
        const delayMs = Math.max(1, Math.min(PUBLIC_DATA_IMMUTABLE_RETRY_DELAY_CAP_MS, requestedMs, remainingMs));
        if (typeof setTimeout !== "function") {
            await Promise.resolve();
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return true;
    };

    // Load roster data from one published active version. A failed immutable
    // generation is retried as a whole so no response can mix shard versions.
    const loadPublishedActiveVersionViaCloudflarePublic = async (versionIdRaw, optionsRaw) => {
        const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
        const versionId = toStr(versionIdRaw).trim() || await loadActivePublishedVersionIdViaCloudflarePublic();
        if (!versionId) throw new Error("Missing active published version pointer.");
        const versionLabel = "Cloudflare public data /activeVersions/" + versionId;
        const retryCount = Math.max(0, Math.min(2, Number(options.retryCount) || 0));
        const retryDeadlineMs = Math.max(Date.now(), Number(options.retryDeadlineMs) || (Date.now() + PUBLIC_DATA_BOOT_RETRY_BUDGET_MS));
        let shards = null;
        let lastError = null;
        for (let attempt = 0; attempt <= retryCount; attempt++) {
            try {
                shards = await fetchPublishedActiveVersionShardsViaCloudflarePublic(versionId);
                break;
            } catch (err) {
                lastError = err;
                if (attempt < retryCount && !(await waitForImmutablePublicRetry(err, retryDeadlineMs))) break;
            }
        }
        if (!shards) throw lastError || new Error("Immutable version shards are unavailable at " + versionLabel + ".");
        const manifestPayload = shards.manifestPayload;
        const rostersPayload = shards.rostersPayload;
        const playerMetricsPayload = shards.playerMetricsPayload;
        const manifest = decodePublicDataObjectKeysRecursive(manifestPayload);
        const rosterMap = decodePublicDataObjectKeysRecursive(rostersPayload);
        const playerMetrics = decodePublicDataObjectKeysRecursive(playerMetricsPayload || {});
        if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
            throw new Error("Missing active version manifest at " + versionLabel + ".");
        }
        if (!rosterMap || typeof rosterMap !== "object" || Array.isArray(rosterMap)) {
            throw new Error("Missing active version roster shards at " + versionLabel + ".");
        }
        const rosterIds = Array.isArray(manifest.rosterIds) ? manifest.rosterIds : Object.keys(rosterMap);
        const rosters = [];
        for (let i = 0; i < rosterIds.length; i++) {
            const rosterId = toStr(rosterIds[i]).trim();
            if (!rosterId) continue;
            const roster = rosterMap[rosterId];
            if (!roster || typeof roster !== "object" || Array.isArray(roster)) {
                throw new Error("Missing active version roster shard '" + rosterId + "' at " + versionLabel + ".");
            }
            rosters.push(roster);
        }
        const data = {
            schemaVersion: Number.isFinite(Number(manifest.schemaVersion)) ? Number(manifest.schemaVersion) : 1,
            pageTitle: toStr(manifest.pageTitle),
            rosterOrder: Array.isArray(manifest.rosterOrder) ? manifest.rosterOrder.slice() : rosterIds.slice(),
            rosters: rosters,
            playerMetrics: playerMetrics && typeof playerMetrics === "object" && !Array.isArray(playerMetrics) ? playerMetrics : {},
        };
        if (manifest.lastUpdatedAt) data.lastUpdatedAt = toStr(manifest.lastUpdatedAt);
        if (manifest.publicConfig && typeof manifest.publicConfig === "object" && !Array.isArray(manifest.publicConfig)) {
            data.publicConfig = manifest.publicConfig;
        }
        return {
            data: assertValidRosterPayload(data, versionLabel),
            activeVersionId: versionId,
        };
    };

    // Load the composed public bootstrap bundle.
    const loadCloudflarePublicBootstrap = async () => {
        const payload = decodePublicDataObjectKeysRecursive(await fetchCloudflarePublicJson(PUBLIC_BOOTSTRAP_CURRENT_PATH));
        const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
        if (!source) throw new Error("Cloudflare public bootstrap returned an invalid payload.");
        const active = source.active && typeof source.active === "object" && !Array.isArray(source.active) ? source.active : {};
        const activeVersionId = toStr(source.currentVersionId || source.activeVersionId || active.versionId).trim();
        if (!activeVersionId) throw new Error("Cloudflare public bootstrap is missing activeVersionId.");
        return {
            schemaVersion: Number.isFinite(Number(source.schemaVersion)) ? Number(source.schemaVersion) : 1,
            generatedAt: toStr(source.generatedAt).trim(),
            activeVersionId: activeVersionId,
            currentVersionId: activeVersionId,
            previousVersionId: toStr(source.previousVersionId).trim(),
            generation: Math.max(0, Number(source.generation) || 0),
            active: active,
            seasonEvents: source.seasonEvents && typeof source.seasonEvents === "object" && !Array.isArray(source.seasonEvents)
                ? source.seasonEvents
                : null,
            donationRefresh: source.donationRefresh && typeof source.donationRefresh === "object" && !Array.isArray(source.donationRefresh)
                ? source.donationRefresh
                : null,
        };
    };

    const hasCloudflareBootstrapPublicModel = (bootstrapRaw) => {
        const bootstrap = bootstrapRaw && typeof bootstrapRaw === "object" ? bootstrapRaw : {};
        return !!(bootstrap.seasonEvents && typeof bootstrap.seasonEvents === "object" && !Array.isArray(bootstrap.seasonEvents));
    };

    const applyCloudflareBootstrapPublicModel = (dataRaw, bootstrapRaw) => {
        const data = dataRaw && typeof dataRaw === "object" ? dataRaw : null;
        const bootstrap = bootstrapRaw && typeof bootstrapRaw === "object" ? bootstrapRaw : null;
        if (!data || !hasCloudflareBootstrapPublicModel(bootstrap)) return false;
        data.seasonEvents = cloneJsonValue(bootstrap.seasonEvents);
        data.donationRefresh = bootstrap.donationRefresh && typeof bootstrap.donationRefresh === "object" && !Array.isArray(bootstrap.donationRefresh)
            ? cloneJsonValue(bootstrap.donationRefresh)
            : { bySeason: {} };
        if (!data.donationRefresh.bySeason || typeof data.donationRefresh.bySeason !== "object" || Array.isArray(data.donationRefresh.bySeason)) {
            data.donationRefresh.bySeason = {};
        }
        return true;
    };

    // Return public event path by event id.
    const buildSeasonEventByIdPublicPath = (eventIdRaw) => {
        const eventId = toStr(eventIdRaw).trim();
        if (!eventId) return "";
        return SEASON_EVENTS_BY_ID_PATH + "/" + encodePublicDataObjectKey(eventId);
    };

    const buildCwlSeasonEventAggregatePublicPath = (eventIdRaw, kindRaw) => {
        const eventId = toStr(eventIdRaw).trim();
        const kind = toStr(kindRaw).trim().toLowerCase();
        if (!eventId || (kind !== "live" && kind !== "final")) return "";
        return SEASON_EVENTS_CWL_AGGREGATES_PATH + "/" + encodePublicDataObjectKey(eventId) + "/" + kind;
    };

    // Return public event pointers path by season id.
    const buildSeasonEventsBySeasonPublicPath = (seasonIdRaw) => {
        const seasonId = toStr(seasonIdRaw).trim();
        if (!seasonId) return "";
        return SEASON_EVENTS_BY_SEASON_PATH + "/" + encodePublicDataObjectKey(seasonId);
    };

    // Fetch optional decoded public JSON without failing roster hydration.
    const fetchOptionalDecodedCloudflarePublicJson = async (pathRaw, loadErrors) => {
        const path = normalizePublicDataPath(pathRaw);
        if (!path) return null;
        try {
            const payload = await fetchCloudflarePublicJson(path);
            if (payload == null) return null;
            return decodePublicDataObjectKeysRecursive(payload);
        } catch (err) {
            const errors = Array.isArray(loadErrors) ? loadErrors : null;
            if (errors) {
                errors.push({
                    path: "/" + path,
                    message: err && err.message ? err.message : toStr(err),
                });
            }
            if (typeof console !== "undefined" && console && typeof console.warn === "function") {
                console.warn("[SeasonEvents] Public data load failed for /" + path, err);
            }
            return null;
        }
    };

    const fetchNullableDecodedCloudflarePublicJson = async (pathRaw) => {
        const path = normalizePublicDataPath(pathRaw);
        if (!path) return null;
        try {
            const payload = await fetchCloudflarePublicJson(path);
            if (payload == null) return null;
            return decodePublicDataObjectKeysRecursive(payload);
        } catch (err) {
            return null;
        }
    };

    const buildDonationRefreshSeasonPublicPath = (seasonIdRaw) => {
        const seasonId = sanitizeDonationCycleKey(seasonIdRaw);
        if (!seasonId) return "";
        return DONATION_REFRESH_BASE_PATH + "/bySeason/" + encodePublicDataObjectKey(seasonId);
    };

    const normalizeDonationRefreshSeasonOverlay = (seasonIdRaw, payloadRaw) => {
        const seasonId = sanitizeDonationCycleKey(seasonIdRaw);
        const payload = payloadRaw && typeof payloadRaw === "object" && !Array.isArray(payloadRaw) ? payloadRaw : {};
        const byTagRaw = payload.byTag && typeof payload.byTag === "object" && !Array.isArray(payload.byTag) ? payload.byTag : {};
        const byTag = {};
        const keys = Object.keys(byTagRaw);
        for (let i = 0; i < keys.length; i++) {
            const tag = normalizeClanTag(keys[i]);
            const entry = byTagRaw[keys[i]] && typeof byTagRaw[keys[i]] === "object" ? byTagRaw[keys[i]] : null;
            if (!tag || !entry) continue;
            const ledger = sanitizeDonationLedger(entry.donationCycle || entry.ledger, seasonId);
            if (!ledger) continue;
            byTag[tag] = {
                tag: tag,
                name: toStr(entry.name).trim(),
                seasonId: seasonId,
                donationCycle: ledger,
                updatedAt: toStr(entry.updatedAt).trim() || toStr(ledger.lastSeenAt).trim(),
                clanTag: normalizeClanTag(entry.clanTag || ledger.lastClanTag),
            };
        }
        return {
            seasonId: seasonId,
            byTag: byTag,
            meta: payload.meta && typeof payload.meta === "object" && !Array.isArray(payload.meta) ? payload.meta : null,
        };
    };

    const attachDonationRefreshSeasonOverlay = (dataRaw, overlayRaw) => {
        const data = dataRaw && typeof dataRaw === "object" ? dataRaw : null;
        const overlay = overlayRaw && typeof overlayRaw === "object" ? overlayRaw : null;
        const seasonId = sanitizeDonationCycleKey(overlay && overlay.seasonId);
        if (!data || !seasonId) return;
        if (!data.donationRefresh || typeof data.donationRefresh !== "object" || Array.isArray(data.donationRefresh)) {
            data.donationRefresh = { bySeason: {} };
        }
        if (!data.donationRefresh.bySeason || typeof data.donationRefresh.bySeason !== "object" || Array.isArray(data.donationRefresh.bySeason)) {
            data.donationRefresh.bySeason = {};
        }
        data.donationRefresh.bySeason[seasonId] = overlay;
    };

    const collectDonationRefreshSeasonIdsFromBundle = (bundleRaw) => {
        const bundle = bundleRaw && typeof bundleRaw === "object" ? bundleRaw : {};
        const ids = [];
        const seen = Object.create(null);
        const collect = (valueRaw) => {
            const value = sanitizeDonationCycleKey(valueRaw);
            if (!value || seen[value]) return;
            seen[value] = true;
            ids.push(value);
        };
        const current = bundle.current && typeof bundle.current === "object" ? bundle.current : {};
        const donationPointer = current.donation && typeof current.donation === "object" ? current.donation : {};
        collect(donationPointer.seasonId);
        const byId = bundle.byId && typeof bundle.byId === "object" ? bundle.byId : {};
        const eventIds = Object.keys(byId);
        for (let i = 0; i < eventIds.length; i++) {
            const event = byId[eventIds[i]] && typeof byId[eventIds[i]] === "object" ? byId[eventIds[i]] : {};
            if (normalizeSeasonEventType(event.type) === "donation") collect(event.seasonId);
        }
        const seasonState = bundle.seasonState && typeof bundle.seasonState === "object" ? bundle.seasonState : {};
        collect(seasonState.seasonId);
        return ids;
    };

    const collectDonationRefreshSeasonIdsForData = (dataRaw) => {
        const data = dataRaw && typeof dataRaw === "object" ? dataRaw : {};
        const seasonEvents = data.seasonEvents && typeof data.seasonEvents === "object" ? data.seasonEvents : {};
        const ids = [];
        const seen = Object.create(null);
        const collectMany = (valuesRaw) => {
            const values = Array.isArray(valuesRaw) ? valuesRaw : [];
            for (let i = 0; i < values.length; i++) {
                const seasonId = sanitizeDonationCycleKey(values[i]);
                if (!seasonId || seen[seasonId]) continue;
                seen[seasonId] = true;
                ids.push(seasonId);
            }
        };
        collectMany(collectDonationRefreshSeasonIdsFromBundle(seasonEvents));
        if (seasonEvents.previous && typeof seasonEvents.previous === "object") {
            collectMany(collectDonationRefreshSeasonIdsFromBundle(seasonEvents.previous));
        }
        return ids;
    };

    const hydrateDonationRefreshForLoadedSeasonEvents = async (dataRaw) => {
        const data = dataRaw && typeof dataRaw === "object" ? dataRaw : null;
        if (!data) return dataRaw;
        const seasonIds = collectDonationRefreshSeasonIdsForData(data);
        if (!seasonIds.length) return data;
        const loadErrors = [];
        await Promise.all(seasonIds.map(async (seasonId) => {
            const path = buildDonationRefreshSeasonPublicPath(seasonId);
            const payload = path ? await fetchOptionalDecodedCloudflarePublicJson(path, loadErrors) : null;
            attachDonationRefreshSeasonOverlay(data, normalizeDonationRefreshSeasonOverlay(seasonId, payload));
        }));
        if (loadErrors.length) {
            if (!data.donationRefresh || typeof data.donationRefresh !== "object") data.donationRefresh = { bySeason: {} };
            data.donationRefresh.loadErrors = loadErrors;
        }
        return data;
    };

    // Collect unique event ids from season event pointers.
    const collectSeasonEventIdsFromPointers = (pointersRaw) => {
        const pointers = pointersRaw && typeof pointersRaw === "object" && !Array.isArray(pointersRaw) ? pointersRaw : {};
        const eventIds = [];
        const seen = Object.create(null);
        const collectEventId = (pointerRaw) => {
            const pointer = pointerRaw && typeof pointerRaw === "object" ? pointerRaw : {};
            const eventId = toStr(pointer.eventId).trim();
            if (!eventId || seen[eventId]) return;
            seen[eventId] = true;
            eventIds.push(eventId);
        };
        collectEventId(pointers.push);
        collectEventId(pointers.donation);
        collectEventId(pointers.cwl);
        collectEventId(pointers.latestCompletedCwl);
        return eventIds;
    };

    // Load full season event objects for a pointer map.
    const loadSeasonEventObjectsByPointerMapViaCloudflarePublic = async (pointersRaw, loadErrors) => {
        const byId = {};
        const eventIds = collectSeasonEventIdsFromPointers(pointersRaw);
        await Promise.all(eventIds.map(async (eventId) => {
            const path = buildSeasonEventByIdPublicPath(eventId);
            const event = path ? await fetchOptionalDecodedCloudflarePublicJson(path, loadErrors) : null;
            if (event && typeof event === "object" && !Array.isArray(event)) {
                byId[eventId] = event;
            }
        }));
        return byId;
    };

    const loadCwlSeasonEventAggregatesViaCloudflarePublic = async (pointersRaw, eventsByIdRaw, loadErrors) => {
        const pointers = pointersRaw && typeof pointersRaw === "object" && !Array.isArray(pointersRaw) ? pointersRaw : {};
        const eventsById = eventsByIdRaw && typeof eventsByIdRaw === "object" ? eventsByIdRaw : {};
        const out = {};
        const eventIds = collectSeasonEventIdsFromPointers(pointers);
        await Promise.all(eventIds.map(async (eventId) => {
            const event = eventsById[eventId] && typeof eventsById[eventId] === "object" ? eventsById[eventId] : {};
            if (normalizeSeasonEventType(event.type) !== "cwl") return;
            const state = toStr(event.cwlTrackingState || event.cwlStatus).trim().toLowerCase();
            const kind = state === "completed" ? "final" : "live";
            const path = buildCwlSeasonEventAggregatePublicPath(eventId, kind);
            const aggregate = path ? await fetchOptionalDecodedCloudflarePublicJson(path, loadErrors) : null;
            if (aggregate && typeof aggregate === "object" && !Array.isArray(aggregate)) {
                out[eventId] = Object.assign({}, out[eventId] || {}, { [kind]: aggregate });
            }
        }));
        return out;
    };

    // Resolve the current season descriptor from loaded event data.
    const resolveLoadedSeasonEventsCurrentSeason = (dataRaw) => {
        const bundle = getSeasonEventsBundle(dataRaw, SEASON_EVENT_RESULT_MODE_VALUES.current);
        const seasonState = bundle.seasonState && typeof bundle.seasonState === "object" ? bundle.seasonState : {};
        const pointers = bundle.current && typeof bundle.current === "object" ? bundle.current : {};
        const push = pointers.push && typeof pointers.push === "object" ? pointers.push : {};
        const donation = pointers.donation && typeof pointers.donation === "object" ? pointers.donation : {};
        const seasonId = toStr(seasonState.seasonId).trim() || toStr(push.seasonId).trim() || toStr(donation.seasonId).trim();
        const startsAt = toStr(seasonState.startsAt).trim() || toStr(push.startsAt).trim() || toStr(donation.startsAt).trim();
        const endsAt = toStr(seasonState.endsAt).trim() || toStr(push.endsAt).trim() || toStr(donation.endsAt).trim();
        return {
            seasonId: seasonId,
            startsAt: startsAt,
            endsAt: endsAt,
        };
    };

    // Resolve previous ranked season descriptor for public event loading.
    const resolvePreviousSeasonEventsSeason = (dataRaw) => {
        const current = resolveLoadedSeasonEventsCurrentSeason(dataRaw);
        const startsMs = parseTimeMs(current.startsAt);
        if (startsMs > 0) return resolveLeaderboardRankedSeasonCycle(new Date(startsMs - 1));
        const match = /^ranked-legend-i-(\d{4}-\d{2}-\d{2})$/.exec(toStr(current.seasonId).trim());
        if (match) return resolveLeaderboardRankedSeasonCycle(new Date(match[1] + "T04:59:59.999Z"));
        return resolvePreviousLeaderboardRankedSeasonCycle(new Date());
    };

    // Load a season events bundle through /bySeason and /byId.
    const loadSeasonEventsBySeasonViaCloudflarePublic = async (seasonRaw) => {
        const loadErrors = [];
        const season = seasonRaw && typeof seasonRaw === "object" ? seasonRaw : { seasonId: toStr(seasonRaw).trim() };
        const seasonId = toStr(season.seasonId).trim();
        const path = buildSeasonEventsBySeasonPublicPath(seasonId);
        const pointers = path ? await fetchOptionalDecodedCloudflarePublicJson(path, loadErrors) : null;
        const current = pointers && typeof pointers === "object" && !Array.isArray(pointers) ? pointers : {};
        const byId = await loadSeasonEventObjectsByPointerMapViaCloudflarePublic(current, loadErrors);
        return {
            current: current,
            seasonState: {
                seasonId: seasonId,
                startsAt: toStr(season.startsAt).trim(),
                endsAt: toStr(season.endsAt).trim(),
            },
            byId: byId,
            loadErrors: loadErrors,
            loadedAt: new Date().toISOString(),
        };
    };

    // Load previous season event data from public data.
    const loadPreviousSeasonEventsViaCloudflarePublic = async (dataRaw) =>
        loadSeasonEventsBySeasonViaCloudflarePublic(resolvePreviousSeasonEventsSeason(dataRaw));

    // Load current season event data from public data.
    const loadCurrentSeasonEventsViaCloudflarePublic = async () => {
        const loadErrors = [];
        const [current, currentCwl, latestCompletedCwl, seasonState] = await Promise.all([
            fetchOptionalDecodedCloudflarePublicJson(SEASON_EVENTS_CURRENT_PATH, loadErrors),
            fetchNullableDecodedCloudflarePublicJson(SEASON_EVENTS_CURRENT_CWL_PATH),
            fetchNullableDecodedCloudflarePublicJson(SEASON_EVENTS_LATEST_COMPLETED_CWL_PATH),
            fetchOptionalDecodedCloudflarePublicJson(SEASON_EVENTS_SEASON_STATE_CURRENT_PATH, loadErrors),
        ]);
        const currentObj = current && typeof current === "object" && !Array.isArray(current) ? current : {};
        if (currentCwl && typeof currentCwl === "object" && !Array.isArray(currentCwl)) currentObj.cwl = currentCwl;
        const latestCompletedCwlObj = latestCompletedCwl && typeof latestCompletedCwl === "object" && !Array.isArray(latestCompletedCwl) ? latestCompletedCwl : null;
        const eventPointerMap = Object.assign({}, currentObj);
        if (latestCompletedCwlObj) eventPointerMap.latestCompletedCwl = latestCompletedCwlObj;
        const byId = await loadSeasonEventObjectsByPointerMapViaCloudflarePublic(currentObj, loadErrors);
        if (latestCompletedCwlObj && latestCompletedCwlObj.eventId && !byId[toStr(latestCompletedCwlObj.eventId).trim()]) {
            const event = await fetchOptionalDecodedCloudflarePublicJson(buildSeasonEventByIdPublicPath(latestCompletedCwlObj.eventId), loadErrors);
            if (event && typeof event === "object" && !Array.isArray(event)) byId[toStr(latestCompletedCwlObj.eventId).trim()] = event;
        }
        const cwlAggregatesByEventId = await loadCwlSeasonEventAggregatesViaCloudflarePublic(eventPointerMap, byId, loadErrors);

        return {
            current: currentObj,
            seasonState: seasonState && typeof seasonState === "object" && !Array.isArray(seasonState) ? seasonState : {},
            byId: byId,
            cwlAggregatesByEventId: cwlAggregatesByEventId,
            latestCompletedCwl: latestCompletedCwlObj,
            loadErrors: loadErrors,
            loadedAt: new Date().toISOString(),
        };
    };

    // Reuse cached roster/playerMetrics when the active published version is unchanged.
    const loadCachedActiveVersionSnapshotViaCloudflarePublic = async (cachedSnapshotRaw, activeVersionIdRaw, bootstrapRaw) => {
        const cachedSnapshot = cachedSnapshotRaw && typeof cachedSnapshotRaw === "object" ? cachedSnapshotRaw : null;
        const activeVersionId = toStr(activeVersionIdRaw).trim();
        if (!cachedSnapshot || !cachedSnapshot.data || !activeVersionId) return null;
        if (toStr(cachedSnapshot.activeVersionId).trim() !== activeVersionId) return null;

        const data = cloneJsonValue(cachedSnapshot.data);
        if (!applyCloudflareBootstrapPublicModel(data, bootstrapRaw)) {
            try {
                data.seasonEvents = await loadCurrentSeasonEventsViaCloudflarePublic();
                await hydrateDonationRefreshForLoadedSeasonEvents(data);
            } catch (err) {
                if (!data.seasonEvents || typeof data.seasonEvents !== "object" || Array.isArray(data.seasonEvents)) {
                    data.seasonEvents = buildEmptySeasonEventsBundle([{
                        path: "/" + SEASON_EVENTS_BASE_PATH,
                        message: err && err.message ? err.message : toStr(err),
                    }]);
                }
                if (typeof console !== "undefined" && console && typeof console.warn === "function") {
                    console.warn("[SeasonEvents] Public data event hydration failed while reusing cached active version.", err);
                }
            }
        }

        return {
            source: CLOUDFLARE_PUBLIC_SOURCE + "-cached-active-version",
            data: assertValidRosterPayload(data, "Cached public data /activeVersions/" + activeVersionId),
            activeVersionId: activeVersionId,
        };
    };

    // Load roster data via Cloudflare public data.
    const loadRosterDataViaCloudflarePublic = async (optionsRaw) => {
        const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
        const cachedSnapshot = options.cachedSnapshot && typeof options.cachedSnapshot === "object" ? options.cachedSnapshot : null;
        let activeVersionId = "";
        let bootstrap = null;
        try {
            bootstrap = await loadCloudflarePublicBootstrap();
            activeVersionId = toStr(bootstrap.activeVersionId).trim();
        } catch (err) {
            bootstrap = null;
            if (typeof console !== "undefined" && console && typeof console.warn === "function") {
                console.warn("[RosterBoot] Cloudflare public bootstrap unavailable; falling back to legacy public-data paths.", err);
            }
        }
        if (cachedSnapshot && cachedSnapshot.activeVersionId) {
            if (!activeVersionId) activeVersionId = await loadActivePublishedVersionIdViaCloudflarePublic();
            const cachedLoaded = await loadCachedActiveVersionSnapshotViaCloudflarePublic(cachedSnapshot, activeVersionId, bootstrap);
            if (cachedLoaded) return cachedLoaded;
        }

        const previousVersionId = toStr(bootstrap && bootstrap.previousVersionId).trim();
        const immutableRetryDeadlineMs = Date.now() + PUBLIC_DATA_BOOT_RETRY_BUDGET_MS;
        const activeLoadPromise = (async () => {
            try {
                return await loadPublishedActiveVersionViaCloudflarePublic(activeVersionId, { retryCount: 1, retryDeadlineMs: immutableRetryDeadlineMs });
            } catch (currentError) {
                if (!previousVersionId || previousVersionId === activeVersionId) throw currentError;
                if (typeof console !== "undefined" && console && typeof console.warn === "function") {
                    console.warn("[RosterBoot] Current immutable version is temporarily unavailable; loading the complete previous version.", currentError);
                }
                return loadPublishedActiveVersionViaCloudflarePublic(previousVersionId, { retryCount: 0, retryDeadlineMs: immutableRetryDeadlineMs });
            }
        })();
        const eventLoadPromise = hasCloudflareBootstrapPublicModel(bootstrap)
            ? Promise.resolve({ bundle: null, error: null })
            : loadCurrentSeasonEventsViaCloudflarePublic().then(
                (bundle) => ({ bundle: bundle, error: null }),
                (error) => ({ bundle: null, error: error }),
            );
        const loadedParts = await Promise.all([activeLoadPromise, eventLoadPromise]);
        const versionedLoaded = loadedParts[0];
        const eventLoad = loadedParts[1];
        const data = versionedLoaded.data;
        activeVersionId = toStr(versionedLoaded.activeVersionId).trim();
        if (!applyCloudflareBootstrapPublicModel(data, bootstrap)) {
            if (eventLoad && eventLoad.bundle) {
                data.seasonEvents = eventLoad.bundle;
                await hydrateDonationRefreshForLoadedSeasonEvents(data);
            } else {
                const err = eventLoad && eventLoad.error;
                data.seasonEvents = buildEmptySeasonEventsBundle([{
                    path: "/" + SEASON_EVENTS_BASE_PATH,
                    message: err && err.message ? err.message : (toStr(err) || "Current event metadata unavailable."),
                }]);
                if (typeof console !== "undefined" && console && typeof console.warn === "function") {
                    console.warn("[SeasonEvents] Public data event hydration failed; continuing without event data.", err);
                }
            }
        }
        return {
            source: CLOUDFLARE_PUBLIC_SOURCE,
            data: data,
            activeVersionId: activeVersionId,
        };
    };

    // Normalize static asset base URL.
    const normalizeStaticAssetBaseUrl = (valueRaw) => {
        const value = toStr(valueRaw).trim();
        if (!value) return "";
        if (/^https?:\/\//i.test(value)) {
            return value.replace(/[\/\\]+$/, "");
        }
        if (value.startsWith("/")) {
            return value.replace(/[\/\\]+$/, "");
        }
        return "";
    };

    // Derive same origin static asset base URL.
    const deriveSameOriginStaticAssetBaseUrl = () => {
        if (typeof window === "undefined" || !window || !window.location) return "";
        const origin = toStr(window.location.origin).trim();
        if (!origin || origin === "null") return "";
        return origin.replace(/[\/\\]+$/, "");
    };

    // Build static asset URL.
    const buildStaticAssetUrl = (relativePathRaw) => {
        const relativePath = toStr(relativePathRaw)
            .trim()
            .replace(/^[\/\\]+/, "")
            .replace(/\.\./g, "")
            .replace(/\\/g, "/");
        if (!relativePath) return "";

        const configuredBaseUrl = normalizeStaticAssetBaseUrl(
            (typeof window !== "undefined" && window && window.ROSTER_STATIC_BASE_URL)
                ? window.ROSTER_STATIC_BASE_URL
                : ""
        );
        const sameOriginBaseUrl = deriveSameOriginStaticAssetBaseUrl();
        const fallbackBaseUrl = normalizeStaticAssetBaseUrl(STATIC_ASSET_BASE_FALLBACK_URL);
        const baseUrl = configuredBaseUrl || sameOriginBaseUrl || fallbackBaseUrl;
        if (!baseUrl) return "";
        return baseUrl + "/" + relativePath;
    };

    // Handle read inline bootstrap data.
    const readInlineBootstrapData = () => {
        if (typeof window === "undefined" || !window) return null;
        const inlineData = window.__ROSTER_DATA__;
        if (!inlineData || typeof inlineData !== "object" || Array.isArray(inlineData)) return null;
        if (!Array.isArray(inlineData.rosters)) return null;
        return inlineData;
    };

    // Load roster data from Cloudflare public data.
    const loadRosterDataWithFallback = async (optionsRaw) => {
        const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
        try {
            const loaded = await loadRosterDataViaCloudflarePublic({
                cachedSnapshot: options.cachedSnapshot,
            });
            return {
                source: toStr(loaded && loaded.source).trim() || CLOUDFLARE_PUBLIC_SOURCE,
                data: assertValidRosterPayload(loaded && loaded.data, "Cloudflare public data hydration"),
                activeVersionId: toStr(loaded && loaded.activeVersionId).trim(),
            };
        } catch (err) {
            throw new Error("Cloudflare public data hydration failed: " + ((err && err.message) ? err.message : toStr(err)));
        }
    };

    window.renderRosterData = render;
    window.showRosterError = showError;
    window.ROSTER_OPEN_PLAYER_PROFILE = (payload) => {
        const tag = normalizeClanTag(payload && payload.tag);
        if (!tag) return;
        const context = findPlayerContext(tag, payload && payload.rosterId);
        if (!context) return;
        openProfileModal(context, null);
    };

    markBootTiming("shell-boot-start");
    applyLoadTimePublicViewSelection();
    updateAdminLink();
    const initialPublicConfig = getPublicConfigFromData({});
    applyLandingProfileCopy_(initialPublicConfig.profile);
    applyDiscordLinks(initialPublicConfig.discordInviteUrl);
    bindPublicViewUi();
    bindSearchUi();
    bindProfileUi();
    scheduleDeferredLandingMediaStart_();
    const initialView = getEffectivePublicView();
    renderDataPendingViewState(initialView);
    markBootTiming("initial-shell-visible", { view: initialView });
    measureBootTiming("shell-visible", "shell-boot-start", "initial-shell-visible");

    if (!window.ROSTER_CLIENT_DISABLE_AUTOLOAD) {
        rosterHydrationInFlight = true;
        let cachedSnapshot = readCachedRosterSnapshot();
        if (cachedSnapshot && cachedSnapshot.data) {
            markBootTiming("cached-roster-render-start", { source: cachedSnapshot.source });
            render(cachedSnapshot.data);
            markBootTiming("cached-roster-render-complete", { source: cachedSnapshot.source });
        }

        (async () => {
            markBootTiming("roster-fetch-start");
            try {
                const durableCachedSnapshot = await readDurableCachedRosterSnapshot(cachedSnapshot);
                if (durableCachedSnapshot && durableCachedSnapshot.data) {
                    const durableFreshnessKey = getRosterPayloadFreshnessKey(durableCachedSnapshot.data);
                    const shouldRenderDurableCache = !!(
                        durableFreshnessKey &&
                        durableFreshnessKey !== lastRenderedRosterFreshnessKey
                    );
                    cachedSnapshot = durableCachedSnapshot;
                    if (shouldRenderDurableCache) {
                        markBootTiming("durable-cached-roster-render-start", { source: cachedSnapshot.source });
                        render(cachedSnapshot.data);
                        markBootTiming("durable-cached-roster-render-complete", { source: cachedSnapshot.source });
                    }
                }

                const loaded = await loadRosterDataWithFallback({
                    cachedSnapshot: cachedSnapshot,
                });
                markBootTiming("roster-fetch-complete", { source: loaded.source });
                measureBootTiming("roster-fetch", "roster-fetch-start", "roster-fetch-complete");
                const cacheWritePromise = writeCachedRosterSnapshot(loaded.data, loaded.source, {
                    activeVersionId: loaded.activeVersionId,
                });
                const loadedFreshnessKey = getRosterPayloadFreshnessKey(loaded.data);
                const shouldSkipRerender = !!(loadedFreshnessKey && lastRenderedRosterFreshnessKey && loadedFreshnessKey === lastRenderedRosterFreshnessKey);
                rosterHydrationInFlight = false;
                if (!shouldSkipRerender) {
                    render(loaded.data);
                } else {
                    hideShellLoadingNotice();
                    markBootTiming("full-data-render-skipped", {
                        reason: "same-freshness-key",
                        source: loaded.source,
                    });
                }
                await cacheWritePromise;
                promoteLandingMediaStart_("hydration-complete");
                markBootTiming("full-data-render-complete", { source: loaded.source });
                measureBootTiming("full-data-render", "shell-boot-start", "full-data-render-complete");
            } catch (err) {
                rosterHydrationInFlight = false;
                hideShellLoadingNotice();
                if (cachedSnapshot && cachedSnapshot.data) {
                    markBootTiming("roster-fetch-failed-with-stale-cache", { source: cachedSnapshot.source || "cache" });
                    if (typeof console !== "undefined" && console && typeof console.warn === "function") {
                        console.warn(
                            "[RosterBoot] public data refresh failed; cached roster snapshot is stale and will not be treated as fresh.",
                            err && (err.message || err.stack) ? (err.message || err.stack) : String(err)
                        );
                    }
                }
                promoteLandingMediaStart_("hydration-error");
                showError("Roster app failed while loading fresh Cloudflare public data.", err);
            }
        })();
    }
})();
