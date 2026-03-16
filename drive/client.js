(() => {
    const $ = (sel) => document.querySelector(sel);
    const toStr = (v) => (v == null ? "" : String(v));
    const pluralize = (count, singular, plural) => (count === 1 ? singular : plural);
    const PROFILE_MODAL_ID = "rosterPlayerProfileModal";
    const DAY_MS = 24 * 60 * 60 * 1000;
    const numberFormatter = typeof Intl !== "undefined" && Intl.NumberFormat
        ? new Intl.NumberFormat()
        : { format: (value) => String(value) };

    let lastRenderedData = null;
    let searchUiBound = false;
    let profileUiBound = false;
    let globalLastUpdatedTimerId = 0;
    let globalLastUpdatedTimerValue = "";
    const missingSectionExpandedByRoster = Object.create(null);

    const profileCache = Object.create(null);
    const profilePending = Object.create(null);
    const townHallIconCache = Object.create(null);
    const townHallIconPending = Object.create(null);
    const leagueIconCache = Object.create(null);
    const leagueIconPending = Object.create(null);
    const profileState = {
        root: null,
        titleEl: null,
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

    const updateAdminLink = () => {
        const adminLink = $("#openAdminLink");
        if (!adminLink) return;

        const baseUrl = toStr(
            (typeof window !== "undefined" && (window.ROSTER_BASE_URL || window.BASE_URL))
                ? (window.ROSTER_BASE_URL || window.BASE_URL)
                : ""
        ).trim();

        if (baseUrl) {
            const sep = baseUrl.indexOf("?") >= 0 ? "&" : "?";
            adminLink.href = baseUrl + sep + "page=admin";
        }
    };

    const el = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = String(text);
        return node;
    };

    const clearNode = (node) => {
        if (!node) return node;
        while (node.firstChild) node.removeChild(node.firstChild);
        return node;
    };

    const escapeHtml = (value) =>
        toStr(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");

    const escapeAttr = (value) => escapeHtml(value).replace(/`/g, "&#96;");

    const normalizeClanTag = (tagRaw) => {
        const tag = toStr(tagRaw).trim().toUpperCase();
        if (!tag) return "";
        return tag.startsWith("#") ? tag : ("#" + tag);
    };

    const getRosterTrackingMode = (rosterRaw) =>
        rosterRaw && rosterRaw.trackingMode === "regularWar" ? "regularWar" : "cwl";

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

    const toNonNegativeInt = (value) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return 0;
        return Math.max(0, Math.floor(num));
    };

    const toBoolFlag = (value) => {
        if (value === true || value === false) return value;
        const text = toStr(value).trim().toLowerCase();
        if (!text) return false;
        return text === "true" || text === "1" || text === "yes" || text === "on";
    };

    const clamp01 = (value) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return 0;
        return Math.max(0, Math.min(1, num));
    };

    const formatNumber = (value) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return "-";
        return numberFormatter.format(Math.round(num));
    };

    const formatPercent = (value, digits) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return "-";
        const pct = num <= 1 ? (num * 100) : num;
        const places = typeof digits === "number" ? digits : (pct >= 10 ? 0 : 1);
        return pct.toFixed(places) + "%";
    };

    const formatFixed = (value, digits) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return "-";
        const places = typeof digits === "number" ? digits : 2;
        return num.toFixed(places);
    };

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

    const formatRole = (value) => {
        const role = toStr(value).trim();
        if (!role) return "";
        if (role === "admin") return "Elder";
        if (role === "coLeader") return "Co-Leader";
        return titleCase(role);
    };

    const formatWarStateLabel = (value) => {
        const state = toStr(value).trim().toLowerCase();
        if (!state) return "-";
        if (state === "notinwar") return "Not in war";
        if (state === "warended") return "War ended";
        if (state === "inwar") return "In war";
        if (state === "preparation") return "Preparation";
        return titleCase(state);
    };

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

    const getWarPerformanceByTag = (warPerformanceRaw) =>
        warPerformanceRaw && typeof warPerformanceRaw === "object" && warPerformanceRaw.byTag && typeof warPerformanceRaw.byTag === "object"
            ? warPerformanceRaw.byTag
            : {};

    const getWarPerformancePlayerEntry = (warPerformanceRaw, tagRaw) => {
        const tag = normalizeClanTag(tagRaw);
        const byTag = getWarPerformanceByTag(warPerformanceRaw);
        return tag && byTag[tag] && typeof byTag[tag] === "object" ? byTag[tag] : {};
    };

    const getWarPerformanceMeta = (warPerformanceRaw) =>
        warPerformanceRaw && typeof warPerformanceRaw === "object" && warPerformanceRaw.meta && typeof warPerformanceRaw.meta === "object"
            ? warPerformanceRaw.meta
            : {};

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
            possibleStars,
            starsPerf: possibleStars > 0 ? (starsTotal / possibleStars) : null,
            avgDestruction: countedAttacks > 0 ? (totalDestruction / countedAttacks) : null,
            destructionPerf: resolvedWarDays > 0 ? (totalDestruction / (100 * resolvedWarDays)) : null,
        };
    };

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
        const aggregateStatusMessage = toStr(aggregateMetaRaw.statusMessage).trim()
            || (toBoolFlag(perfMeta.lastRegularWarFinalizationIncomplete)
                ? "At least one regular-war finalization used fallback data and may be incomplete."
                : "");

        return {
            lastRefreshedAt: toStr(regularWar.lastRefreshedAt).trim(),
            currentWarState: toStr(currentWarRaw.state).trim().toLowerCase() || "notinwar",
            currentWarUnavailableReason: toStr(currentWarRaw.unavailableReason).trim(),
            currentWarStatusMessage: toStr(currentWarRaw.statusMessage).trim(),
            aggregateUnavailableReason: toStr(aggregateMetaRaw.unavailableReason).trim(),
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
            },
        };
    };

    const getClanProfileUrl = (tagRaw) => {
        const tag = normalizeClanTag(tagRaw);
        if (!tag) return "";
        return "https://link.clashofclans.com/en/?action=OpenClanProfile&tag=" + encodeURIComponent(tag);
    };

    const getPlayerProfileUrl = (tagRaw) => {
        const tag = normalizeClanTag(tagRaw);
        if (!tag) return "";
        return "https://link.clashofclans.com/en/?action=OpenPlayerProfile&tag=" + encodeURIComponent(tag);
    };

    const getPlayerActionBuilder = () => {
        if (typeof window !== "undefined" && typeof window.ROSTER_PLAYER_ACTION_BUILDER === "function") {
            return window.ROSTER_PLAYER_ACTION_BUILDER;
        }
        return null;
    };

    const getRosterActionBuilder = () => {
        if (typeof window !== "undefined" && typeof window.ROSTER_ROSTER_ACTION_BUILDER === "function") {
            return window.ROSTER_ROSTER_ACTION_BUILDER;
        }
        return null;
    };

    const getAdminPassword = () => {
        if (typeof window !== "undefined" && typeof window.ROSTER_GET_ADMIN_PASSWORD === "function") {
            return toStr(window.ROSTER_GET_ADMIN_PASSWORD()).trim();
        }
        return "";
    };

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
        const freshnessCard = $("#globalLastUpdated");
        if (freshnessCard) freshnessCard.classList.add("hidden");
        clearGlobalLastUpdatedTimer();
    };

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

    const findRosterPlayerByTag = (roster, tagRaw) => {
        const tag = normalizeClanTag(tagRaw);
        if (!tag) return null;
        const trackingMode = getRosterTrackingMode(roster);
        const players = []
            .concat(Array.isArray(roster && roster.main) ? roster.main : [])
            .concat(Array.isArray(roster && roster.subs) ? roster.subs : [])
            .concat(trackingMode === "regularWar" && Array.isArray(roster && roster.missing) ? roster.missing : []);
        for (let i = 0; i < players.length; i++) {
            const player = normalizePlayer(players[i]);
            if (player.tag === tag) return player;
        }
        return null;
    };

    const getRosterPlayerLabel = (roster, tagRaw) => {
        const tag = normalizeClanTag(tagRaw);
        if (!tag) return "";
        const player = findRosterPlayerByTag(roster, tag);
        const name = toStr(player && player.name).trim();
        return name || tag;
    };

    const getRosterBenchSuggestionModel = (roster) => {
        if (getRosterTrackingMode(roster) !== "cwl") return null;
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

        const addBenchTag = (tagRaw) => {
            const tag = normalizeClanTag(tagRaw);
            if (!tag || seenBenchTags[tag]) return "";
            seenBenchTags[tag] = true;
            benchByTag[tag] = true;
            benchTags.push(tag);
            return tag;
        };

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

    const findPlayerContext = (tagRaw, rosterIdRaw) => {
        const tag = normalizeClanTag(tagRaw);
        const rosterId = toStr(rosterIdRaw).trim();
        const rosters = lastRenderedData && Array.isArray(lastRenderedData.rosters) ? lastRenderedData.rosters : [];
        if (!tag || !rosters.length) return null;

        const scanRoster = (roster) => {
            const main = Array.isArray(roster && roster.main) ? roster.main : [];
            const subs = Array.isArray(roster && roster.subs) ? roster.subs : [];
            const missing = Array.isArray(roster && roster.missing) ? roster.missing : [];
            const trackingMode = getRosterTrackingMode(roster);
            const suggestionModel = trackingMode === "cwl" ? getRosterBenchSuggestionModel(roster) : null;
            const sections = trackingMode === "regularWar"
                ? [
                    { role: "main", players: main },
                    { role: "sub", players: subs },
                    { role: "missing", players: missing },
                ]
                : [
                    { role: "main", players: main },
                    { role: "sub", players: subs },
                ];

            for (let s = 0; s < sections.length; s++) {
                const section = sections[s];
                const players = Array.isArray(section.players) ? section.players : [];
                for (let i = 0; i < players.length; i++) {
                    const player = normalizePlayer(players[i]);
                    if (normalizeClanTag(player.tag) !== tag) continue;
                    return {
                        rosterId: toStr(roster && roster.id).trim(),
                        rosterTitle: toStr(roster && roster.title).trim(),
                        trackingMode,
                        player,
                        rawPlayer: players[i],
                        role: section.role,
                        index: i,
                        cwl: getPlayerCwlStats(roster && roster.cwlStats, tag),
                        regularWar: getPlayerRegularWarStats(roster && roster.regularWar, tag, roster && roster.warPerformance),
                        longTerm: getPlayerLongTermWarStats(roster && roster.warPerformance, tag),
                        warPerformance: roster && roster.warPerformance,
                        suggestionModel,
                        suggestion: trackingMode === "cwl" ? getPlayerBenchSuggestion(suggestionModel, tag) : null,
                    };
                }
            }
            return null;
        };

        if (rosterId) {
            for (const roster of rosters) {
                if (toStr(roster && roster.id).trim() !== rosterId) continue;
                return scanRoster(roster);
            }
        }

        for (const roster of rosters) {
            const found = scanRoster(roster);
            if (found) return found;
        }
        return null;
    };

    const renderChip = (text, extraClass) =>
        '<span class="profile-chip' + (extraClass ? (" " + extraClass) : "") + '">' + escapeHtml(text) + "</span>";

    const renderProgress = (value, tone) =>
        '<div class="profile-progress' + (tone ? (" profile-progress--" + tone) : "") + '"><div class="profile-progress__fill" style="width:' +
        Math.round(clamp01(value) * 100) + '%"></div></div>';

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

    const renderNotice = (label, text, tone) =>
        '<div class="profile-notice' + (tone ? (" profile-notice--" + tone) : "") + '"><div class="profile-notice__label">' +
        escapeHtml(label) + '</div><div class="profile-notice__text">' + escapeHtml(text) + "</div></div>";

    const formatSignedNumber = (valueRaw) => {
        const value = Number(valueRaw);
        if (!Number.isFinite(value)) return "-";
        if (value === 0) return "0";
        return (value > 0 ? "+" : "") + formatNumber(Math.abs(value));
    };

    const LEGEND_WINDOW_OPTIONS = [7, 14, 30];
    const LEGEND_EMPTY_STATE_TEXT = "Not enough local history yet, tracking just started recently.";

    const isValidDayKey = (valueRaw) => /^\d{4}-\d{2}-\d{2}$/.test(toStr(valueRaw).trim());

    const parseTimeMs = (valueRaw) => {
        const value = toStr(valueRaw).trim();
        if (!value) return 0;
        const ms = new Date(value).getTime();
        return Number.isFinite(ms) ? ms : 0;
    };

    const parseDayKeyMs = (dayKeyRaw) => {
        const dayKey = toStr(dayKeyRaw).trim();
        if (!isValidDayKey(dayKey)) return 0;
        const ms = new Date(dayKey + "T00:00:00Z").getTime();
        return Number.isFinite(ms) ? ms : 0;
    };

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

    const normalizeLocalHistoryPoints = (historyRaw, latestSnapshotRaw) => {
        const pointsByDay = Object.create(null);
        const history = Array.isArray(historyRaw) ? historyRaw : [];

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

    const getLocalTrophyHistoryForTag = (tagRaw, dataRaw) => {
        const entry = getPlayerMetricsEntry(tagRaw, dataRaw);
        if (!entry) return [];
        const history = Array.isArray(entry.trophyHistoryDaily)
            ? entry.trophyHistoryDaily
            : (Array.isArray(entry.trophyHistory)
                ? entry.trophyHistory
                : (Array.isArray(entry.history && entry.history.trophyHistoryDaily)
                    ? entry.history.trophyHistoryDaily
                    : []));
        const latestSnapshot = entry.latestSnapshot && typeof entry.latestSnapshot === "object"
            ? entry.latestSnapshot
            : (entry.snapshot && typeof entry.snapshot === "object" ? entry.snapshot : null);
        return normalizeLocalHistoryPoints(history, latestSnapshot);
    };

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

    const getLegendWindowAvailability = (pointsRaw) =>
        LEGEND_WINDOW_OPTIONS.map((days) => {
            const coverage = getLegendWindowCoverage(pointsRaw, days);
            return {
                days: days,
                supported: coverage.supported,
            };
        });

    const getLegendDefaultWindowDays = (pointsRaw) =>
        getLegendWindowCoverage(pointsRaw, 30).supported ? 30 : 0;

    const getLegendTrendPoints = (pointsRaw, windowDaysRaw) => {
        const points = Array.isArray(pointsRaw) ? pointsRaw : [];
        const windowDays = toNonNegativeInt(windowDaysRaw);
        if (!points.length) return [];
        if (windowDays < 1) return points.slice();
        const coverage = getLegendWindowCoverage(points, windowDays);
        if (!coverage.supported) return points.slice();
        return points.filter((point) => Number.isFinite(point && point.dayMs) && point.dayMs >= coverage.cutoffDayMs);
    };

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
                '<div class="profile-legend-tooltip__row"><span class="profile-legend-tooltip__label">Final</span><span class="profile-legend-tooltip__value" data-legend-final="1">', escapeHtml(formatNumber(selectedPoint.trophies)), "</span></div>",
                '<div class="profile-legend-tooltip__row"><span class="profile-legend-tooltip__label">&#177; Delta</span><span class="profile-legend-tooltip__value" data-legend-delta="1">', escapeHtml(deltaText), "</span></div>",
                "</div>",
                "</div>",
                "</div>",
            ].join(""),
        };
    };

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

    const updateLegendChartSelection = (stageEl, chartState, selectedIndexRaw) => {
        const stage = stageEl && stageEl.querySelector ? stageEl : null;
        if (!stage || !chartState || !chartState.hasData) return;
        const chartPoints = Array.isArray(chartState.chartPoints) ? chartState.chartPoints : [];
        const points = Array.isArray(chartState.points) ? chartState.points : [];
        if (!chartPoints.length || !points.length) return;
        const selectedIndex = Math.max(0, Math.min(chartPoints.length - 1, toNonNegativeInt(selectedIndexRaw)));
        const selectedPoint = chartPoints[selectedIndex];
        const delta = computeLegendDelta(points, selectedIndex);
        const tooltipLeftPct = Math.max(8, Math.min(92, (selectedPoint.x / chartState.width) * 100));

        const finalEl = stage.querySelector("[data-legend-final='1']");
        const deltaEl = stage.querySelector("[data-legend-delta='1']");
        const tooltipEl = stage.querySelector("[data-legend-tooltip='1']");
        const cursorLine = stage.querySelector("[data-legend-cursor-line='1']");
        const cursorDot = stage.querySelector("[data-legend-cursor-dot='1']");

        if (finalEl) finalEl.textContent = formatNumber(selectedPoint.trophies);
        if (deltaEl) deltaEl.textContent = delta.available ? formatSignedNumber(delta.delta) : "\u2013";
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

    const bindLegendChartInteraction = (stageEl, chartState) => {
        const stage = stageEl && stageEl.querySelector ? stageEl : null;
        if (!stage || !chartState || !chartState.hasData) return;
        const hitbox = stage.querySelector("[data-legend-hitbox='1']");
        if (!hitbox) return;

        const chartPoints = Array.isArray(chartState.chartPoints) ? chartState.chartPoints : [];
        if (!chartPoints.length) return;
        updateLegendChartSelection(stage, chartState, chartState.selectedIndex);

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

    const initLegendsJourneySections = (containerRaw) => {
        const container = containerRaw && containerRaw.querySelectorAll ? containerRaw : null;
        if (!container) return;
        container.querySelectorAll("[data-legends-journey='1']").forEach((section) => {
            bindLegendsJourneySection(section);
        });
    };

    const isLegendLeagueName = (nameRaw) => {
        const text = toStr(nameRaw).trim();
        if (!text) return false;
        return normalizeLeagueFamilyKey(text).indexOf("legend") >= 0 || normalizeLeagueMatchText(text).indexOf("legend") >= 0;
    };

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

    const shouldShowLegendsJourney = (playerRaw) => {
        const player = playerRaw && typeof playerRaw === "object" ? playerRaw : {};
        const legend = player.legendStatistics && typeof player.legendStatistics === "object" ? player.legendStatistics : null;
        if (legend) return true;
        const leagueName = readLeagueNameForLegendCheck(player.league);
        const leagueTierName = readLeagueNameForLegendCheck(player.leagueTier);
        return isLegendLeagueName(leagueName) || isLegendLeagueName(leagueTierName);
    };

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
            open: true,
            sectionClass: "profile-disclosure--legend",
        });
    };

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

    const formatProfileTimestamp = (value) => {
        const text = toStr(value).trim();
        if (!text) return "";
        const date = new Date(text);
        return Number.isNaN(date.getTime()) ? text : date.toLocaleString();
    };

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

    const clearGlobalLastUpdatedTimer = () => {
        if (!globalLastUpdatedTimerId || typeof window === "undefined" || !window.clearInterval) return;
        window.clearInterval(globalLastUpdatedTimerId);
        globalLastUpdatedTimerId = 0;
        globalLastUpdatedTimerValue = "";
    };

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

    const normalizeLeagueFamilyKey = (value) => {
        const raw = toStr(value).trim().toLowerCase();
        if (!raw) return "";
        const normalized = typeof raw.normalize === "function" ? raw.normalize("NFKD") : raw;
        return normalized
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "");
    };

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

    const resolveHomeLeagueAssetFamily = (leagueNameRaw) => {
        const text = normalizeLeagueMatchText(leagueNameRaw);
        const compact = normalizeLeagueFamilyKey(leagueNameRaw);
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
    };

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

    const extractHomeLeagueBadgeSource = (playerRaw) => {
        const league = resolveHomeLeagueObjectFromPlayer(playerRaw);
        if (!league) return null;
        const name = readLeagueDisplayName(league);
        if (!name) return null;
        const hasApiIconUrls = !!(league.iconUrls && typeof league.iconUrls === "object");
        const iconUrls = hasApiIconUrls ? league.iconUrls : {};
        const iconSrc = [iconUrls.medium, iconUrls.small, iconUrls.tiny]
            .map((value) => toStr(value).trim())
            .find(Boolean) || "";
        return {
            name: name,
            hasApiIconUrls: hasApiIconUrls,
            iconSrc: iconSrc,
            fallbackAssetFamily: resolveHomeLeagueAssetFamily(name),
        };
    };

    const getHomeLeagueBadgeMeta = (playerRaw) => {
        const source = extractHomeLeagueBadgeSource(playerRaw);
        if (!source || !source.name) return null;
        const key = normalizeLeagueFamilyKey(source.fallbackAssetFamily);
        const localEntry = key && Object.prototype.hasOwnProperty.call(leagueIconCache, key)
            ? leagueIconCache[key]
            : null;
        const localSrc = localEntry && localEntry.dataUrl ? localEntry.dataUrl : "";
        if (localSrc || key) {
            const meta = {
                name: source.name,
                src: localSrc,
                key: key,
            };
            if (PROFILE_LEAGUE_DEBUG && typeof console !== "undefined" && console.log) {
                console.log("[league-badge]", { source: source, chosen: meta, from: localSrc ? "local-cache" : "local-pending-or-missing" });
            }
            return meta;
        }
        const meta = {
            name: source.name,
            src: source.hasApiIconUrls ? source.iconSrc : "",
            key: "",
        };
        if (PROFILE_LEAGUE_DEBUG && typeof console !== "undefined" && console.log) {
            console.log("[league-badge]", { source: source, chosen: meta, from: source.hasApiIconUrls ? "api-iconUrls-fallback" : "no-icon" });
        }
        return meta;
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

    const renderProfileContent = (ctx, response, mode, errorText) => {
        const context = ctx && typeof ctx === "object" ? ctx : null;
        const player = response && response.player && typeof response.player === "object" ? response.player : {};
        const localPlayer = context && context.player ? context.player : {};
        const tag = normalizeClanTag((response && response.tag) || player.tag || localPlayer.tag);
        const displayName = toStr(localPlayer.name).trim() || toStr(player.name).trim() || "Player profile";
        if (mode === "loading") {
            profileState.bodyEl.innerHTML = renderProfileLoadingScreen(context, displayName, tag);
            return;
        }
        const townHallLevel = player.townHallLevel != null ? player.townHallLevel : localPlayer.th;
        const builderHall = toNonNegativeInt(player.builderHallLevel);
        const clanName = toStr(player.clan && player.clan.name).trim();
        const clanTag = normalizeClanTag(player.clan && player.clan.tag);
        const leagueBadge = getHomeLeagueBadgeMeta(player);
        const leagueName = leagueBadge && leagueBadge.name ? leagueBadge.name : "";
        const roleRaw = formatRole(player.role);
        const roleLabel = roleRaw && roleRaw.toLowerCase() !== "member" ? roleRaw : "";
        const trackingMode = context && context.trackingMode === "regularWar" ? "regularWar" : "cwl";
        const role = toStr(context && context.role).trim().toLowerCase();
        const cwl = context && context.cwl ? context.cwl : getPlayerCwlStats(null, tag);
        const regularWar = context && context.regularWar ? context.regularWar : getPlayerRegularWarStats(null, tag, context && context.warPerformance);
        const longTerm = context && context.longTerm ? context.longTerm : getPlayerLongTermWarStats(context && context.warPerformance, tag);
        const placementLabel = buildPlacementLabel(context);
        const hasStoredTh = localPlayer.th !== "" && localPlayer.th != null;
        const localStoredThLabel = hasStoredTh ? ("TH" + localPlayer.th) : "Not set";
        const discordLabel = toStr(localPlayer.discord).trim() || "Not set";
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
        profileState.titleEl.textContent = displayName;

        const actionButtons = [
            '<a class="profile-action-btn" href="' + escapeAttr(getPlayerProfileUrl(tag)) + '">Open player in-game</a>',
        ];
        if (typeof window !== "undefined" && typeof window.ROSTER_OPEN_PLAYER_EDIT === "function" && tag) {
            actionButtons.push('<button type="button" class="profile-action-btn secondary" data-profile-edit="1">Edit player</button>');
        }

        const leagueBadgeHtml = [
            '<div class="profile-league-badge">',
            (leagueBadge && leagueBadge.src)
                ? ('<img class="profile-league-badge__icon" src="' + escapeAttr(leagueBadge.src) + '" alt="' + escapeAttr(leagueName || "Home league") + '">')
                : '<div class="profile-league-badge__fallback">League</div>',
            '<div class="profile-league-badge__copy"><div class="profile-league-badge__label">Home league</div><div class="profile-league-badge__name">' + escapeHtml(leagueName || "Unranked") + "</div></div>",
            "</div>",
        ].join("");

        const placementTone = context && context.player
            ? (trackingMode === "regularWar"
                ? (role === "main" ? "success" : (role === "missing" ? "alert" : ""))
                : (role === "sub" ? "alert" : "success"))
            : "";
        const heroAlertCards = trackingMode === "regularWar"
            ? [
                regularWar.currentWarUnavailableReason === "privateWarLog"
                    ? renderNotice("Live war data", "Unavailable because the clan war log is private.", "alert")
                    : "",
                regularWar.aggregateStatusMessage
                    ? renderNotice("Aggregate status", regularWar.aggregateStatusMessage, "info")
                    : "",
                regularWar.currentWarState === "inwar" && regularWar.current.attacksRemaining > 0
                    ? renderNotice("Pending", formatNumber(regularWar.current.attacksRemaining) + " " + pluralize(regularWar.current.attacksRemaining, "attack", "attacks") + " left in current war", "alert")
                    : "",
                regularWar.current.missedAttacks > 0
                    ? renderNotice("Missed", "Missed " + formatNumber(regularWar.current.missedAttacks) + " " + pluralize(regularWar.current.missedAttacks, "attack", "attacks"), "alert")
                    : "",
            ].filter(Boolean).join("")
            : [
                cwl.currentWarAttackPending >= 1 ? renderNotice("Pending", "Current CWL attack pending", "alert") : "",
                cwl.missedAttacks > 0 ? renderNotice("Missed", "Missed " + formatNumber(cwl.missedAttacks) + " " + pluralize(cwl.missedAttacks, "attack", "attacks"), "alert") : "",
                cwl.possibleStars > 0 && cwl.starsTotal < 8 ? renderNotice("Target", "Below 8-star reward target", "alert") : "",
            ].filter(Boolean).join("");

        const heroSnapshotItems = trackingMode === "regularWar"
            ? [
                renderHeroSnapshotItem("Placement", rosterSlot, { tone: placementTone }),
                renderHeroSnapshotItem("Roster", rosterName),
                renderHeroSnapshotItem("Current war state", formatWarStateLabel(regularWar.currentWarState || "notinwar")),
                renderHeroSnapshotItem("Current attacks", regularCurrentAttacksLabel, {
                    tone: regularWar.currentWarState === "inwar" && regularWar.current.attacksRemaining > 0 ? "alert" : "",
                }),
                renderHeroSnapshotItem("Attacks remaining", regularCurrentRemainingLabel, {
                    tone: regularWar.currentWarState === "inwar" && regularWar.current.attacksRemaining > 0 ? "alert" : "",
                }),
                renderHeroSnapshotItem("Current stars", regularCurrentStarsLabel),
            ].filter(Boolean).join("")
            : [
                renderHeroSnapshotItem("Roster slot", rosterSlot, { tone: placementTone }),
                renderHeroSnapshotItem("Roster", rosterName),
                renderHeroSnapshotItem("CWL stars", cwlStarsLabel, { tone: cwl.possibleStars > 0 ? (cwl.starsTotal < 8 ? "alert" : "success") : "" }),
                renderHeroSnapshotItem("Avg destruction", cwlAvgDestructionLabel),
                renderHeroSnapshotItem("Attacks made", cwlAttacksLabel),
                suggestion ? renderHeroSnapshotItem("Suggestion", suggestion.statusLabel, { tone: suggestion.status === "out" ? "alert" : "success" }) : "",
            ].filter(Boolean).join("");
        const heroSnapshotTitle = trackingMode === "regularWar" ? "Roster and war snapshot" : "Roster and CWL snapshot";
        const heroSnapshotSubtitle = trackingMode === "regularWar"
            ? "Operational status for current roster and regular war usage"
            : "Operational status for current roster usage";

        const clanDisplay = clanName || clanTag
            ? (clanName || "Clan") + (clanTag ? (" " + clanTag) : "")
            : "No clan";

        const heroHtml = [
            '<section class="profile-hero">',
            '<div class="profile-hero__top">',
            '<div class="profile-hero__identity">',
            '<div class="profile-hero__visuals">', renderTownHallBadge(townHallLevel, player.townHallWeaponLevel), "</div>",
            '<div class="profile-hero__content">',
            '<h2 class="profile-hero__name">', escapeHtml(displayName), "</h2>",
            '<div class="profile-hero__tag">', escapeHtml(tag || "-"), "</div>",
            '<div class="profile-hero__identity-meta">',
            leagueBadgeHtml,
            '<div class="profile-hero__identity-line"><span class="profile-hero__identity-label">Clan</span><span class="profile-hero__identity-value">' + escapeHtml(clanDisplay) + "</span></div>",
            roleLabel ? ('<div class="profile-hero__identity-line"><span class="profile-hero__identity-label">Role</span><span class="profile-hero__identity-value profile-hero__identity-value--role">' + escapeHtml(roleLabel) + "</span></div>") : "",
            "</div>",
            '<div class="profile-hero__actions">', actionButtons.join(""), "</div>",
            "</div>",
            "</div>",
            '<div class="profile-hero__snapshot">',
            '<div class="profile-hero__snapshot-head">',
            '<div class="profile-hero__snapshot-title">', escapeHtml(heroSnapshotTitle), "</div>",
            '<div class="profile-hero__snapshot-subtitle">', escapeHtml(heroSnapshotSubtitle), "</div>",
            "</div>",
            '<div class="profile-hero__snapshot-grid">', heroSnapshotItems, "</div>",
            "</div>",
            "</div>",
            heroAlertCards ? ('<div class="profile-hero__alerts">' + heroAlertCards + "</div>") : "",
            "</section>",
        ].join("");

        const notesHtml = localNotes.length
            ? localNotes.map((note) => renderChip(note, "profile-chip--success")).join("")
            : "";
        const rosterNotesHtml = [
            trackingMode === "cwl" && suggestion && suggestion.noteText
                ? ('<div class="profile-notes-block__hint">Suggestion note: ' + escapeHtml(suggestion.noteText) + "</div>")
                : "",
            notesHtml
                ? ('<div class="profile-chip-list">' + notesHtml + "</div>")
                : '<div class="profile-empty">No roster notes.</div>',
        ].join("");

        const localInfoCards = context && context.player ? [
            renderMetaCard("Roster name", context.rosterTitle || "-", {
                emptyText: "Not assigned",
                subText: context.rosterId ? ("Roster ID " + context.rosterId) : "",
            }),
            renderMetaCard("Placement", placementLabel, { alert: role === "sub" || role === "missing" }),
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
                : renderMetaCard("Current war state", formatWarStateLabel(regularWar.currentWarState || "notinwar")),
            officialNameDiffers ? renderMetaCard("Official name", player.name) : "",
        ].filter(Boolean).join("") : "";

        const cwlStatsHtml = [
            renderStatCard("CWL season", cwl.season || "-"),
            renderStatCard("Stars total / possible", cwlStarsLabel, {
                progress: cwl.starsPerf,
                alert: cwl.possibleStars > 0 && cwl.starsTotal < 8,
            }),
            renderStatCard("Stars performance", formatPercent(cwl.starsPerf, 0), { progress: cwl.starsPerf }),
            renderStatCard("Average destruction", cwlAvgDestructionLabel, { progress: cwl.avgDestruction != null ? (Number(cwl.avgDestruction) / 100) : null }),
            renderStatCard("Destruction performance", formatPercent(cwl.destructionPerf, 0), { progress: cwl.destructionPerf }),
            renderStatCard("Resolved war days", formatNumber(cwl.resolvedWarDays)),
            renderStatCard("Attacks made", cwlAttacksLabel),
            renderStatCard("Counted attacks", formatNumber(cwl.countedAttacks)),
            renderStatCard("Missed attacks", formatNumber(cwl.missedAttacks), { alert: cwl.missedAttacks > 0 }),
            renderStatCard("Attack pending", cwl.currentWarAttackPending >= 1 ? "Yes" : "No", { alert: cwl.currentWarAttackPending >= 1 }),
            renderStatCard("Three-star attacks", formatNumber(cwl.threeStarCount)),
            renderStatCard("Hit up", formatNumber(cwl.hitUpCount)),
            renderStatCard("Same TH hits", formatNumber(cwl.sameThHitCount)),
            renderStatCard("Hit down", formatNumber(cwl.hitDownCount)),
        ].join("");
        const regularWarStatsHtml = [
            renderStatCard("Placement", placementLabel, { alert: role === "sub" || role === "missing" }),
            renderStatCard("Current war state", formatWarStateLabel(regularWar.currentWarState || "notinwar")),
            renderStatCard("Current attacks used / allowed", regularCurrentAttacksLabel),
            renderStatCard("Current attacks remaining", regularCurrentRemainingLabel, {
                alert: regularWar.currentWarState === "inwar" && regularWar.current.attacksRemaining > 0,
            }),
            renderStatCard("Current stars", regularCurrentStarsLabel),
            renderStatCard("Current avg destruction", regularCurrentAvgDestructionLabel),
            renderStatCard("Current missed attacks", formatNumber(regularWar.current.missedAttacks), {
                alert: regularWar.current.missedAttacks > 0,
            }),
            renderStatCard("Current three-star attacks", formatNumber(regularWar.current.threeStarCount)),
            renderStatCard("Current hit up", formatNumber(regularWar.current.hitUpCount)),
            renderStatCard("Current same TH hits", formatNumber(regularWar.current.sameThHitCount)),
            renderStatCard("Current hit down", formatNumber(regularWar.current.hitDownCount)),
        ].join("");

        const overallLongTermStatsHtml = renderLongTermStatsCards(longTerm.overall, {
            participationsValue: longTerm.overall.participationCount,
            participationsSubText: "Regular wars + resolved CWL war days",
        });
        const regularLongTermStatsHtml = renderLongTermStatsCards(longTerm.regular, {
            participationsValue: longTerm.regular.warsInLineup,
            participationsSubText: "Regular wars in lineup",
        });
        const cwlLongTermStatsHtml = renderLongTermStatsCards(longTerm.cwl, {
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
                '<div class="profile-section-grid">',
                '<div class="profile-subsection">',
                '<div class="profile-subsection__title">Overall combined long-term history</div>',
                '<div class="profile-stats-grid">', overallLongTermStatsHtml, "</div>",
                "</div>",
                '<div class="profile-section-grid profile-section-grid--two">',
                '<div class="profile-subsection">',
                '<div class="profile-subsection__title">Regular war long-term breakdown</div>',
                '<div class="profile-stats-grid">', regularLongTermStatsHtml, "</div>",
                "</div>",
                '<div class="profile-subsection">',
                '<div class="profile-subsection__title">CWL long-term breakdown</div>',
                '<div class="profile-stats-grid">', cwlLongTermStatsHtml, "</div>",
                "</div>",
                "</div>",
                "</div>",
            ].join("")
            : '<div class="profile-empty">No finalized long-term war history is stored for this player yet.</div>';

        const cwlPreviewItems = [
            renderSummaryItem("Season", cwl.season || "-"),
            renderSummaryItem("CWL stars", cwlStarsLabel, { tone: cwl.possibleStars > 0 ? (cwl.starsTotal < 8 ? "alert" : "success") : "" }),
            renderSummaryItem("Avg destruction", cwlAvgDestructionLabel),
            suggestion
                ? renderSummaryItem("Suggestion", suggestion.statusLabel, { tone: suggestion.status === "out" ? "alert" : "success" })
                : renderSummaryItem("Notes", localNotes.length ? formatNumber(localNotes.length) : "0", { subText: pluralize(localNotes.length, "note", "notes") }),
        ];
        const regularWarPreviewItems = [
            renderSummaryItem("Placement", context && context.player ? placementLabel : "-", { tone: placementTone }),
            renderSummaryItem("War state", formatWarStateLabel(regularWar.currentWarState || "notinwar")),
            renderSummaryItem("Current attacks", regularCurrentAttacksLabel, {
                tone: regularWar.currentWarState === "inwar" && regularWar.current.attacksRemaining > 0 ? "alert" : "",
            }),
            renderSummaryItem("Current stars", regularCurrentStarsLabel),
        ];
        const longTermPreviewItems = [
            renderSummaryItem("Overall stars/atk", longTerm.overall.avgStarsPerAttack != null ? formatFixed(longTerm.overall.avgStarsPerAttack, 2) : "-"),
            renderSummaryItem("Participations", formatNumber(longTerm.overall.participationCount)),
            renderSummaryItem("Missed attacks", formatNumber(longTerm.overall.missedAttacks), {
                tone: longTerm.overall.missedAttacks > 0 ? "alert" : "",
            }),
            renderSummaryItem("Three-stars", formatNumber(longTerm.overall.threeStarCount)),
        ];
        const trackingPreviewItems = trackingMode === "regularWar" ? regularWarPreviewItems : cwlPreviewItems;
        const trackingStatsHtml = trackingMode === "regularWar" ? regularWarStatsHtml : cwlStatsHtml;
        const trackingStatsTitle = trackingMode === "regularWar" ? "Current regular war tracking" : "Current CWL season tracking";
        const trackingDisclosureTitle = trackingMode === "regularWar" ? "Current war and roster context" : "Current CWL season and roster context";
        const trackingDisclosureSubtitle = trackingMode === "regularWar"
            ? "Current roster placement and live regular-war usage for this player."
            : (cwl.season ? ("Current season " + cwl.season + " usage and roster context for this player.") : "Current CWL usage and roster context for this player.");
        const trackingDisclosureSource = trackingMode === "regularWar" ? "Local roster + current regular war" : "Local roster + current CWL season";
        const longTermDisclosureTitle = "Overall long-term war performance";
        const longTermDisclosureSubtitle = "Combined persistent history from regular wars and CWL wars.";
        const longTermDisclosureSource = "Shared warPerformance history";

        const trackingRosterBodyHtml = [
            '<div class="profile-section-grid profile-section-grid--two">',
            '<div class="profile-subsection">',
            '<div class="profile-subsection__title">Local roster info</div>',
            '<div class="profile-meta-grid">', localInfoCards || '<div class="profile-empty">No local roster details are available.</div>', "</div>",
            '<div class="profile-notes-block"><div class="profile-notes-block__label">Roster notes</div>', rosterNotesHtml, "</div>",
            "</div>",
            '<div class="profile-subsection">',
            '<div class="profile-subsection__title">', escapeHtml(trackingStatsTitle), "</div>",
            '<div class="profile-stats-grid">', trackingStatsHtml, "</div>",
            "</div>",
            "</div>",
        ].join("");

        if (mode === "error") {
            const rosterBody = trackingRosterBodyHtml +
                '<div class="profile-error-panel"><div class="profile-error-panel__title">Unable to load official profile data</div><div class="profile-error-panel__body">' +
                escapeHtml(errorText || "Unknown error.") + "</div></div>";
            const localSections = [
                renderDisclosureSection({
                    title: longTermDisclosureTitle,
                    subtitle: longTermDisclosureSubtitle,
                    source: longTermDisclosureSource,
                    summaryItems: longTermPreviewItems,
                    bodyHtml: longTermHistoryBodyHtml,
                    open: true,
                }),
                renderDisclosureSection({
                    title: trackingDisclosureTitle,
                    subtitle: "Local roster details remain available even when the official profile request fails.",
                    source: trackingDisclosureSource,
                    summaryItems: trackingPreviewItems,
                    bodyHtml: rosterBody,
                    open: false,
                }),
            ].join("");
            profileState.bodyEl.innerHTML = heroHtml + localSections;
            syncProfileDisclosureState(profileState.bodyEl);
            return;
        }

        const officialSnapshotHtml = [
            renderStatCard("Trophies", formatNumber(player.trophies)),
            renderStatCard("Best trophies", formatNumber(player.bestTrophies)),
            renderStatCard("War stars", formatNumber(player.warStars)),
            renderStatCard("Exp level", formatNumber(player.expLevel)),
            renderStatCard("Attack wins", formatNumber(player.attackWins)),
            renderStatCard("Defense wins", formatNumber(player.defenseWins)),
            renderStatCard("Donations", formatNumber(player.donations)),
            renderStatCard("Donations received", formatNumber(player.donationsReceived)),
            renderStatCard("Clan capital contributions", formatNumber(player.clanCapitalContributions)),
        ].join("");

        const buildArmyVillage = (label, key) => {
            const isBuilder = key === "builderBase";
            const heroes = sortArmyItems((player.heroes || []).filter((item) => toStr(item && item.village).toLowerCase().indexOf(isBuilder ? "builder" : "home") >= 0 || (!item.village && !isBuilder)), "heroes", key);
            const troops = sortArmyItems((player.troops || []).filter((item) => toStr(item && item.village).toLowerCase().indexOf(isBuilder ? "builder" : "home") >= 0 || (!item.village && !isBuilder)), "troops", key);
            const spells = isBuilder ? [] : sortArmyItems((player.spells || []).filter(() => !isBuilder), "spells", key);
            const groups = [
                ["Heroes", heroes],
                ["Troops", troops],
                ["Spells", spells],
            ].filter((group) => group[1].length).map((group) =>
                '<div class="profile-unit-group"><div class="profile-unit-group__title">' + escapeHtml(group[0]) + '</div><div class="profile-unit-list">' +
                group[1].map((item) => {
                    const level = toNonNegativeInt(item && item.level);
                    const maxLevel = toNonNegativeInt(item && item.maxLevel);
                    return '<div class="profile-unit-row"><div class="profile-unit-row__top"><div class="profile-unit-row__name">' + escapeHtml(item && item.name) + '</div>' +
                        (item && item.superTroopIsActive ? renderChip("Active", "profile-chip--success") : "") +
                        '</div><div class="profile-unit-row__level">Level ' + escapeHtml(formatNumber(level)) + (maxLevel > 0 ? (" / " + escapeHtml(formatNumber(maxLevel))) : "") + '</div>' +
                        (maxLevel > 0 ? renderProgress(level / maxLevel, level >= maxLevel ? "success" : "") : "") + "</div>";
                }).join("") +
                "</div></div>"
            ).join("");
            return {
                html: groups ? ('<div class="profile-village-card"><div class="profile-village-card__title">' + escapeHtml(label) + "</div>" + groups + "</div>") : "",
                counts: { heroes: heroes.length, troops: troops.length, spells: spells.length },
            };
        };
        const homeArmy = buildArmyVillage("Home Village", "homeVillage");
        const builderArmy = buildArmyVillage("Builder Base", "builderBase");

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
                title: longTermDisclosureTitle,
                subtitle: longTermDisclosureSubtitle,
                source: longTermDisclosureSource,
                summaryItems: longTermPreviewItems,
                bodyHtml: longTermHistoryBodyHtml,
                open: true,
            }),
            renderDisclosureSection({
                title: trackingDisclosureTitle,
                subtitle: trackingDisclosureSubtitle,
                source: trackingDisclosureSource,
                summaryItems: trackingPreviewItems,
                bodyHtml: trackingRosterBodyHtml,
                open: false,
            }),
            legendsJourneySection,
            renderDisclosureSection({
                title: "Official snapshot",
                subtitle: "Primary official totals for profile, activity, and contribution.",
                source: "Official Clash data",
                summaryItems: [
                    renderSummaryItem("Trophies", formatNumber(player.trophies)),
                    renderSummaryItem("War stars", formatNumber(player.warStars)),
                    renderSummaryItem("Donations", formatNumber(player.donations)),
                ],
                bodyHtml: '<div class="profile-stats-grid">' + officialSnapshotHtml + "</div>",
            }),
            renderDisclosureSection({
                title: "Home Village progress",
                subtitle: "Heroes, troops, and spells grouped for fast progression checks.",
                source: "Official Clash data",
                summaryItems: [
                    renderSummaryItem("Heroes", homeArmy.counts.heroes ? formatNumber(homeArmy.counts.heroes) : "-"),
                    renderSummaryItem("Troops", homeArmy.counts.troops ? formatNumber(homeArmy.counts.troops) : "-"),
                    renderSummaryItem("Spells", homeArmy.counts.spells ? formatNumber(homeArmy.counts.spells) : "-"),
                ],
                bodyHtml: homeArmy.html || '<div class="profile-empty">No home village troop, hero, or spell data is available.</div>',
            }),
            (builderHall > 0 || player.versusTrophies != null || player.bestVersusTrophies != null || player.versusBattleWins != null || builderArmy.html) ? renderDisclosureSection({
                title: "Builder Base",
                subtitle: "Secondary profile context for builder-side progress.",
                source: "Official Clash data",
                summaryItems: [
                    renderSummaryItem("Builder Hall", builderHall > 0 ? ("BH" + builderHall) : "-"),
                    renderSummaryItem("Builder trophies", formatNumber(player.versusTrophies)),
                    renderSummaryItem("Wins", formatNumber(player.versusBattleWins)),
                ],
                bodyHtml: '<div class="profile-section-grid"><div class="profile-subsection"><div class="profile-subsection__title">Builder Base stats</div><div class="profile-stats-grid">' + [
                    renderStatCard("Builder Hall", builderHall > 0 ? ("BH" + builderHall) : "-"),
                    renderStatCard("Builder base trophies", formatNumber(player.versusTrophies)),
                    renderStatCard("Best builder base trophies", formatNumber(player.bestVersusTrophies)),
                    renderStatCard("Versus battle wins", formatNumber(player.versusBattleWins)),
                ].join("") + "</div></div>" + (builderArmy.html ? ('<div class="profile-subsection"><div class="profile-subsection__title">Builder Base units</div>' + builderArmy.html + "</div>") : "") + "</div>",
                sectionClass: "profile-disclosure--secondary",
            }) : "",
            hasAccountExtras ? renderDisclosureSection({
                title: "Account extras",
                subtitle: "Optional account metadata and long-tail profile details.",
                source: "Official Clash data",
                summaryItems: [
                    renderSummaryItem("Labels", formatNumber(labels.length)),
                    renderSummaryItem("Achievements", formatNumber(achievements.length)),
                ],
                bodyHtml: '<div class="profile-section-grid profile-section-grid--two">' +
                    (hasLabels ? ('<div class="profile-subsection"><div class="profile-subsection__title">Labels</div><div class="profile-label-list">' + labelsHtml + "</div></div>") : "") +
                    (hasAchievements ? ('<div class="profile-subsection"><div class="profile-subsection__title">Achievements</div>' + achievementsHtml + "</div></div>") : "") +
                    (houseCards ? ('<div class="profile-subsection"><div class="profile-subsection__title">Player House</div><div class="profile-meta-grid">' + houseCards + "</div></div>") : "") +
                    "</div>",
            }) : "",
        ].filter(Boolean).join("");

        profileState.bodyEl.innerHTML = heroHtml + sections;
        syncProfileDisclosureState(profileState.bodyEl);
        initLegendsJourneySections(profileState.bodyEl);
    };

    const runServerMethod = (methodName, args) =>
        new Promise((resolve, reject) => {
            if (!window.google || !google.script || !google.script.run) {
                reject(new Error("google.script.run is not available (not running inside Apps Script HtmlService)."));
                return;
            }
            const runner = google.script.run
                .withSuccessHandler(resolve)
                .withFailureHandler((err) => reject(err && err.message ? new Error(err.message) : err));
            if (!runner || typeof runner[methodName] !== "function") {
                reject(new Error("Server method is not available: " + methodName));
                return;
            }
            runner[methodName](...(Array.isArray(args) ? args : []));
        });

    const requestLeagueIcon = (playerRaw) => {
        const source = extractHomeLeagueBadgeSource(playerRaw);
        if (!source || !source.name) return;
        const key = normalizeLeagueFamilyKey(source.fallbackAssetFamily);
        if (!key) return;
        if (Object.prototype.hasOwnProperty.call(leagueIconCache, key) || leagueIconPending[key]) return;

        leagueIconPending[key] = runServerMethod("getLeagueIconData", [source.name])
            .then((response) => {
                const resolvedKey = normalizeLeagueFamilyKey(response && response.family) || key;
                const entry = response && response.ok && response.dataUrl
                    ? { dataUrl: response.dataUrl }
                    : { dataUrl: "" };
                leagueIconCache[key] = entry;
                if (resolvedKey !== key) leagueIconCache[resolvedKey] = entry;
            })
            .catch(() => {
                leagueIconCache[key] = { dataUrl: "" };
            })
            .finally(() => {
                delete leagueIconPending[key];
                if (profileState.open && profileState.activeTag && profileCache[profileState.activeTag]) {
                    renderProfileContent(profileState.activeContext, profileCache[profileState.activeTag], "ready");
                }
            });
    };

    const requestTownHallIcon = (levelRaw) => {
        const level = toNonNegativeInt(levelRaw);
        if (level < 1) return;
        if (Object.prototype.hasOwnProperty.call(townHallIconCache, level) || townHallIconPending[level]) return;

        townHallIconPending[level] = runServerMethod("getTownHallIconData", [level])
            .then((response) => {
                townHallIconCache[level] = response && response.ok && response.dataUrl ? response.dataUrl : null;
            })
            .catch(() => {
                townHallIconCache[level] = null;
            })
            .finally(() => {
                delete townHallIconPending[level];
                if (profileState.open && profileState.activeTag && profileCache[profileState.activeTag]) {
                    renderProfileContent(profileState.activeContext, profileCache[profileState.activeTag], "ready");
                }
            });
    };

    const setActiveProfileTrigger = (triggerEl) => {
        if (profileState.triggerEl && profileState.triggerEl.setAttribute) {
            profileState.triggerEl.setAttribute("aria-expanded", "false");
        }
        profileState.triggerEl = triggerEl && triggerEl.setAttribute ? triggerEl : null;
        if (profileState.triggerEl) {
            profileState.triggerEl.setAttribute("aria-expanded", "true");
        }
    };

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

    const unlockBodyScroll = () => {
        const body = document.body;
        if (!body) return;
        body.classList.remove("profile-modal-open");
        body.style.overflow = profileState.bodyOverflow || "";
        body.style.paddingRight = profileState.bodyPaddingRight || "";
    };

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

    const ensureProfileModal = () => {
        if (profileState.root) return profileState.root;

        const root = el("div", "profile-modal");
        root.id = PROFILE_MODAL_ID;
        root.setAttribute("aria-hidden", "true");
        root.innerHTML = [
            '<div class="profile-modal__backdrop" data-profile-dismiss="backdrop"></div>',
            '<div class="profile-modal__panel" role="dialog" aria-modal="true" aria-labelledby="' + PROFILE_MODAL_ID + 'Title">',
            '<div class="profile-modal__topbar">',
            '<div class="profile-modal__title-wrap"><div class="profile-modal__eyebrow">Player profile</div><div class="profile-modal__title" id="' + PROFILE_MODAL_ID + 'Title">Player profile</div></div>',
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
        profileState.bodyEl = root.querySelector(".profile-modal__body");
        profileState.closeEl = root.querySelector(".profile-modal__close");
        return root;
    };

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

    const syncProfileModalFromRender = () => {
        if (!profileState.open || !profileState.activeTag) return;
        profileState.activeContext = findPlayerContext(profileState.activeTag, profileState.activeRosterId) || profileState.activeContext;
        if (profileCache[profileState.activeTag]) {
            renderProfileContent(profileState.activeContext, profileCache[profileState.activeTag], "ready");
        }
    };

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

    const playerMatchesQuery = (rawPlayer, normalizedQuery) => {
        if (!normalizedQuery) return true;
        const player = normalizePlayer(rawPlayer);
        const name = toStr(player.name).toLowerCase();
        const tag = toStr(player.tag).toLowerCase();
        return name.includes(normalizedQuery) || tag.includes(normalizedQuery);
    };

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

    const renderRosterSuggestionBanner = (roster, suggestionModel) => {
        if (!suggestionModel) return null;

        const result = suggestionModel.result || {};
        const swapCount = Number.isFinite(Number(result.swapCount)) ? Number(result.swapCount) : suggestionModel.pairs.length;
        const needsRewardsCount = Number.isFinite(Number(result.needsRewardsCount)) ? Number(result.needsRewardsCount) : 0;
        const banner = el("div", "roster-suggestion-banner" + (swapCount > 0 ? "" : " is-empty"));
        const copy = el("div", "roster-suggestion-banner__copy");
        copy.appendChild(el("div", "roster-suggestion-banner__eyebrow", "Saved bench suggestions"));
        copy.appendChild(el(
            "div",
            "roster-suggestion-banner__title",
            swapCount > 0 ? (swapCount + " suggested " + pluralize(swapCount, "swap", "swaps") + " pending") : "No swaps currently suggested"
        ));

        const metaParts = [];
        if (suggestionModel.updatedAtLabel) metaParts.push("Updated " + suggestionModel.updatedAtLabel);
        if (needsRewardsCount > 0) metaParts.push(needsRewardsCount + " players still need stars");
        if (swapCount === 0 && suggestionModel.updatedAtRaw) metaParts.push("Last saved review found no pending swaps");
        if (metaParts.length) copy.appendChild(el("div", "roster-suggestion-banner__meta", metaParts.join(" • ")));
        banner.appendChild(copy);

        if (suggestionModel.pairs.length) {
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

    const renderPlayerCard = (rawPlayer, ctx) => {
        const context = ctx && typeof ctx === "object" ? ctx : {};
        const trackingMode = toStr(context.trackingMode).trim() === "regularWar" ? "regularWar" : "cwl";
        const roleRaw = toStr(context.role).trim().toLowerCase();
        const role = roleRaw === "main" || roleRaw === "missing" ? roleRaw : "sub";
        const isSub = role === "sub";
        const hideSuggestions = !!context.hideSuggestions;
        const player = normalizePlayer(rawPlayer);
        const playerTag = normalizeClanTag(player.tag);
        const cwlStats = getPlayerCwlStats(context.cwlStats, playerTag);
        const regularWarStats = getPlayerRegularWarStats(context.regularWarStats, playerTag, context.warPerformance);
        const longTermStats = getPlayerLongTermWarStats(context.warPerformance, playerTag);
        const overallLongTermIndicator = longTermStats.overall.avgStarsPerAttack != null
            ? ("overall " + formatFixed(longTermStats.overall.avgStarsPerAttack, 2) + " stars/atk")
            : "overall stars/atk -";
        const playerSuggestion = hideSuggestions || trackingMode !== "cwl"
            ? null
            : getPlayerBenchSuggestion(context.suggestionModel, playerTag);

        const wrap = el("div", "player");
        wrap.dataset.tag = playerTag;
        wrap.dataset.rosterId = toStr(context.rosterId).trim();
        if (trackingMode === "cwl" && playerSuggestion && playerSuggestion.status === "out") wrap.classList.add("suggest-bench");
        if (trackingMode === "cwl" && playerSuggestion && playerSuggestion.status === "in") wrap.classList.add("suggest-in");

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

        const slotLabel = trackingMode === "regularWar"
            ? (role === "main" ? (player.slot == null ? "IN" : ("#" + toStr(player.slot))) : (role === "missing" ? "MISS" : "OUT"))
            : (role === "sub" ? "SUB" : (player.slot == null ? "#?" : "#" + toStr(player.slot)));
        left.appendChild(el("div", "player-slot", slotLabel));
        const identity = el("div", "player-ident");
        const nameRow = el("div", "player-name-row");
        nameRow.appendChild(el("div", "player-name", player.name));
        const infoBadge = el("span", "player-info-badge", "i");
        infoBadge.setAttribute("aria-hidden", "true");
        nameRow.appendChild(infoBadge);
        identity.appendChild(nameRow);
        left.appendChild(identity);

        right.appendChild(el("div", "player-th", player.th === "" ? "TH?" : "TH" + toStr(player.th)));

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
            if (cwlStats.starsTotal < 8) cwlBadge.classList.add("alert");
            cwlBadge.appendChild(el("span", "player-cwl-value", cwlStats.starsTotal + "/8"));
            if (cwlStats.starsTotal < 8) {
                cwlBadge.appendChild(el("span", "player-cwl-indicator", "!"));
            }
        }
        right.appendChild(cwlBadge);

        top.appendChild(left);
        top.appendChild(right);

        const bottom = el("div", "player-bottom");
        if (player.discord) bottom.appendChild(el("span", "player-discord", player.discord));
        for (const note of player.notes) bottom.appendChild(el("span", "player-note", note));
        if (trackingMode === "regularWar") {
            bottom.appendChild(el("span", "player-admin-metric", "current stars " + formatNumber(regularWarStats.current.starsTotal)));
            if (regularWarStats.current.avgDestruction != null) {
                bottom.appendChild(el(
                    "span",
                    "player-admin-metric",
                    "current avg destr " + Math.round(regularWarStats.current.avgDestruction) + "%"
                ));
            }
            if (role === "main" && regularWarStats.currentWarState === "inwar" && regularWarStats.current.attacksRemaining > 0) {
                bottom.appendChild(el(
                    "span",
                    "player-admin-metric alert",
                    formatNumber(regularWarStats.current.attacksRemaining) + " " + pluralize(regularWarStats.current.attacksRemaining, "attack", "attacks") + " left"
                ));
            }
            if (regularWarStats.current.missedAttacks > 0) {
                bottom.appendChild(el(
                    "span",
                    "player-admin-metric alert",
                    "missed " + regularWarStats.current.missedAttacks + " " + pluralize(regularWarStats.current.missedAttacks, "attack", "attacks")
                ));
            }
        } else {
            const perfLabel = cwlStats.starsPerf != null
                ? (Math.round(cwlStats.starsPerf * 100) + "%")
                : "-";
            bottom.appendChild(el("span", "player-admin-metric", "perf " + perfLabel));
            if (cwlStats.avgDestruction != null) {
                bottom.appendChild(el("span", "player-admin-metric", "avg destr " + Math.round(cwlStats.avgDestruction) + "%"));
            }
            if (cwlStats.currentWarAttackPending >= 1) {
                bottom.appendChild(el(
                    "span",
                    "player-admin-metric alert",
                    "didnt attack yet today"
                ));
            }
            if (cwlStats.missedAttacks >= 1) {
                bottom.appendChild(el(
                    "span",
                    "player-admin-metric alert",
                    "missed " + cwlStats.missedAttacks + " " + pluralize(cwlStats.missedAttacks, "attack", "attacks")
                ));
            }
            if (typeof window !== "undefined" && window.ROSTER_ADMIN_MODE) {
                if (player.excludeAsSwapTarget) {
                    bottom.appendChild(el(
                        "span",
                        "player-admin-metric alert",
                        "swap target disabled"
                    ));
                }
                if (player.excludeAsSwapSource) {
                    bottom.appendChild(el(
                        "span",
                        "player-admin-metric alert",
                        "swap source disabled"
                    ));
                }
            }
        }
        bottom.appendChild(el("span", "player-admin-metric", overallLongTermIndicator));
        bottom.appendChild(el("span", "player-tag", player.tag || ""));

        wrap.appendChild(top);
        wrap.appendChild(bottom);
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

    const getMissingSectionStateKey = (rosterIdRaw, rosterTitleRaw) => {
        const rosterId = toStr(rosterIdRaw).trim();
        if (rosterId) return "id:" + rosterId;
        const rosterTitle = toStr(rosterTitleRaw).trim();
        return rosterTitle ? ("title:" + rosterTitle) : "unknown";
    };

    const getMissingSectionExpandedState = (rosterIdRaw, rosterTitleRaw, defaultExpanded) => {
        const key = getMissingSectionStateKey(rosterIdRaw, rosterTitleRaw);
        if (Object.prototype.hasOwnProperty.call(missingSectionExpandedByRoster, key)) {
            return !!missingSectionExpandedByRoster[key];
        }
        return !!defaultExpanded;
    };

    const setMissingSectionExpandedState = (rosterIdRaw, rosterTitleRaw, expanded) => {
        const key = getMissingSectionStateKey(rosterIdRaw, rosterTitleRaw);
        missingSectionExpandedByRoster[key] = !!expanded;
    };

    const renderRosterSection = (label, players, optionsRaw) => {
        const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
        const role = options.role;
        const trackingMode = options.trackingMode;
        const rosterId = options.rosterId;
        const rosterTitle = options.rosterTitle;
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
                cwlStats: cwlStats,
                regularWarStats: regularWarStats,
                warPerformance: warPerformance,
                suggestionModel: suggestionModel,
                hideSuggestions: hideSuggestions,
            }));
        }
        frag.appendChild(list);

        return frag;
    };

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
            cwlStats: options.cwlStats,
            regularWarStats: options.regularWarStats,
            warPerformance: options.warPerformance,
            suggestionModel: options.suggestionModel,
            hideSuggestions: options.hideSuggestions,
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

    const renderRosterCard = (roster, opts) => {
        const options = opts && typeof opts === "object" ? opts : {};
        const showEmptySections = options.showEmptySections !== false;
        const hideSuggestions = !!options.hideSuggestions;
        const expandMissingByDefault = !!options.expandMissingByDefault;
        const trackingMode = getRosterTrackingMode(roster);
        const mainPlayers = Array.isArray(roster && roster.main) ? roster.main : [];
        const subPlayers = Array.isArray(roster && roster.subs) ? roster.subs : [];
        const missingPlayers = Array.isArray(roster && roster.missing) ? roster.missing : [];
        const clanProfileUrl = getClanProfileUrl(roster && roster.connectedClanTag);
        const suggestionModel = hideSuggestions || trackingMode !== "cwl" ? null : getRosterBenchSuggestionModel(roster);
        const regularWarData = roster && roster.regularWar && typeof roster.regularWar === "object" ? roster.regularWar : {};
        const regularWarCurrentMeta = regularWarData.currentWar && typeof regularWarData.currentWar === "object" ? regularWarData.currentWar : {};
        const regularWarAggregateMeta = regularWarData.aggregateMeta && typeof regularWarData.aggregateMeta === "object"
            ? regularWarData.aggregateMeta
            : {};
        const regularWarLiveUnavailable = toStr(regularWarCurrentMeta.unavailableReason).trim() === "privateWarLog";
        const regularWarLiveStatusMessage = toStr(regularWarCurrentMeta.statusMessage).trim();
        const regularWarAggregateStatusMessage = toStr(regularWarAggregateMeta.statusMessage).trim();
        const regularWarAggregateHasNotice = !!regularWarAggregateStatusMessage;

        const card = el("div", "card");
        const head = el("div", "roster-head");
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

        const bMain = el("span", "badge", (trackingMode === "regularWar" ? "In war: " : "Main: ") + toStr(roster.badges && roster.badges.main));
        const bSubs = el("span", "badge", (trackingMode === "regularWar" ? "Out of war: " : "Subs: ") + toStr(roster.badges && roster.badges.subs));
        const meta = el("div", "roster-meta");
        meta.appendChild(bMain);
        meta.appendChild(bSubs);
        if (trackingMode === "regularWar") {
            meta.appendChild(el("span", "badge", "Missing: " + toStr(roster.badges && roster.badges.missing)));
            if (regularWarLiveUnavailable) {
                meta.appendChild(el("span", "badge", "Live war refresh unavailable"));
            }
            if (regularWarAggregateHasNotice) {
                meta.appendChild(el("span", "badge", "Aggregate status notice"));
            }
        }

        if (clanProfileUrl) {
            const openClanBtn = document.createElement("a");
            openClanBtn.className = "roster-open-clan";
            openClanBtn.href = clanProfileUrl;
            openClanBtn.textContent = "Open clan in-game";
            meta.appendChild(openClanBtn);
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

        head.appendChild(h2);
        head.appendChild(meta);
        card.appendChild(head);
        if (trackingMode === "regularWar" && (regularWarLiveUnavailable || regularWarAggregateHasNotice)) {
            const warning = el("div", "roster-data-warning");
            warning.appendChild(el("div", "roster-data-warning__title", "Live war data warning"));
            const warningParts = [];
            if (regularWarLiveUnavailable) {
                warningParts.push(regularWarLiveStatusMessage || "Fresh live war data could not be fetched because the clan war log is private.");
            }
            if (regularWarAggregateHasNotice) {
                warningParts.push(regularWarAggregateStatusMessage);
            }
            warningParts.push("Showing last known roster and war values; some data may be stale.");
            warning.appendChild(el("div", "roster-data-warning__text", warningParts.join(" ")));
            card.appendChild(warning);
        }
        if (!hideSuggestions && trackingMode === "cwl") {
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
                    cwlStats: roster && roster.cwlStats,
                    regularWarStats: roster && roster.regularWar,
                    warPerformance: roster && roster.warPerformance,
                    suggestionModel,
                    hideSuggestions,
                }));
            }
            if (showEmptySections || subPlayers.length) {
                card.appendChild(renderRosterSection("Out of war", subPlayers, {
                    role: "sub",
                    trackingMode,
                    rosterId: roster.id,
                    rosterTitle: roster.title,
                    cwlStats: roster && roster.cwlStats,
                    regularWarStats: roster && roster.regularWar,
                    warPerformance: roster && roster.warPerformance,
                    suggestionModel,
                    hideSuggestions,
                }));
            }
            if (showEmptySections || missingPlayers.length) {
                card.appendChild(renderCollapsibleMissingRosterSection("Temporarily missing", missingPlayers, {
                    role: "missing",
                    trackingMode,
                    rosterId: roster.id,
                    rosterTitle: roster.title,
                    cwlStats: roster && roster.cwlStats,
                    regularWarStats: roster && roster.regularWar,
                    warPerformance: roster && roster.warPerformance,
                    suggestionModel,
                    hideSuggestions,
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
                    cwlStats: roster && roster.cwlStats,
                    regularWarStats: roster && roster.regularWar,
                    warPerformance: roster && roster.warPerformance,
                    suggestionModel,
                    hideSuggestions,
                }));
            }
            if (showEmptySections || subPlayers.length) {
                card.appendChild(renderRosterSection("Subs", subPlayers, {
                    role: "sub",
                    trackingMode,
                    rosterId: roster.id,
                    rosterTitle: roster.title,
                    cwlStats: roster && roster.cwlStats,
                    regularWarStats: roster && roster.regularWar,
                    warPerformance: roster && roster.warPerformance,
                    suggestionModel,
                    hideSuggestions,
                }));
            }
        }

        return card;
    };

    const render = (data) => {
        const target = $("#rosters");
        if (!target) return;

        const safeData = data && typeof data === "object" ? data : {};
        const allRosters = getOrderedRostersFromData(safeData);
        lastRenderedData = Object.assign({}, safeData, {
            rosters: allRosters,
            rosterOrder: buildRosterOrderFromRosters(allRosters),
        });

        const pageTitleHeading = $("#pageTitleHeading");
        const pageTitleText = toStr(safeData.pageTitle).trim();
        if (pageTitleText) {
            document.title = pageTitleText;
            if (pageTitleHeading) pageTitleHeading.textContent = pageTitleText;
        }
        renderGlobalLastUpdated(safeData);

        const searchInput = $("#rosterSearchInput");
        const rawQuery = searchInput ? toStr(searchInput.value) : "";
        const filtered = filterRostersByQuery(allRosters, rawQuery);
        const isSearchMode = !!filtered.query;
        const isAdminMode = typeof window !== "undefined" && !!window.ROSTER_ADMIN_MODE;
        const hideSuggestions = isSearchMode && !isAdminMode;

        target.textContent = "";
        for (const r of filtered.rosters) {
            target.appendChild(renderRosterCard(r, {
                showEmptySections: !isSearchMode,
                hideSuggestions,
                expandMissingByDefault: isSearchMode,
            }));
        }

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

        syncProfileModalFromRender();

        const loading = $("#loading");
        if (loading) loading.remove();
    };

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
                searchInput.focus();
            });
        }
    };

    const loadRosterDataViaServer = () => runServerMethod("getRosterData", []);

    window.renderRosterData = render;
    window.showRosterError = showError;
    window.ROSTER_OPEN_PLAYER_PROFILE = (payload) => {
        const tag = normalizeClanTag(payload && payload.tag);
        if (!tag) return;
        const context = findPlayerContext(tag, payload && payload.rosterId);
        if (!context) return;
        openProfileModal(context, null);
    };

    updateAdminLink();
    bindSearchUi();
    bindProfileUi();

    if (!window.ROSTER_CLIENT_DISABLE_AUTOLOAD) {
        (async () => {
            try {
                const inlineData =
                    typeof window !== "undefined" &&
                    window.__ROSTER_DATA__ &&
                    typeof window.__ROSTER_DATA__ === "object" &&
                    !Array.isArray(window.__ROSTER_DATA__) &&
                    Array.isArray(window.__ROSTER_DATA__.rosters)
                        ? window.__ROSTER_DATA__
                        : null;
                const data = inlineData || await loadRosterDataViaServer();
                if (!data || !Array.isArray(data.rosters)) {
                    throw new Error("Roster data is invalid. Expected: { rosters: [...] }");
                }
                render(data);
            } catch (err) {
                showError("Roster app crashed while loading roster-data.json.", err);
            }
        })();
    }
})();
