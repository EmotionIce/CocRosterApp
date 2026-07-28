// War follow-up admin workflow.
//
// Candidate evidence is derived from the roster snapshot already loaded by the
// admin. Only private case/settings state is fetched from the backend.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  if (root) root.RosterWarFollowup = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const DEFAULT_SETTINGS = {
    schemaVersion: 1,
    regularLookbackWars: 8,
    regularMissedThreshold: 2,
    regularPerformanceEnabled: true,
    regularMinimumAttacks: 6,
    regularAverageStarsThreshold: 1.8,
    regularAverageDestructionThreshold: 75,
    cwlLookbackSeasons: 2,
    cwlMissedThreshold: 1,
    cwlPerformanceEnabled: true,
    cwlMinimumAttacks: 4,
    cwlAverageStarsThreshold: 1.8,
    cwlAverageDestructionThreshold: 75,
    defaultRecoveryWars: 3,
    defaultHeroDownRosterId: "",
    missingDiscordEnabled: true,
    moderatorNames: [],
    trustedPlayerTags: [],
    rulesUpdatedAt: "",
  };

  const STATUS_ORDER = ["needs_review", "needs_dm", "hero_down", "ready", "watching", "closed"];
  const STATUS_META = {
    needs_review: { label: "Review", next: "Review the war evidence", tone: "review" },
    needs_dm: { label: "Needs DM", next: "Send the decision message", tone: "contact" },
    hero_down: { label: "Hero-down", next: "Track hero-down wars", tone: "trial" },
    ready: { label: "Ready", next: "Make the return decision", tone: "ready" },
    watching: { label: "Watching", next: "Wait for more regular wars", tone: "watching" },
    closed: { label: "Closed", next: "No action needed", tone: "closed" },
  };

  const toText = (value) => value == null ? "" : String(value);
  const toInt = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  };
  const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
  };
  const normalizeTag = (value) => {
    const compact = toText(value).trim().toUpperCase().replace(/\s+/g, "").replace(/O/g, "0");
    if (!compact) return "";
    return compact.startsWith("#") ? compact : ("#" + compact);
  };
  const normalizeWarTimestampForDate = (value) => {
    const text = toText(value).trim();
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.(\d{3}))?Z$/.exec(text);
    if (!match) return text;
    return match[1] + "-" + match[2] + "-" + match[3] + "T" +
      match[4] + ":" + match[5] + ":" + match[6] + "." + (match[7] || "000") + "Z";
  };
  const parseMs = (value) => {
    const ms = new Date(normalizeWarTimestampForDate(value)).getTime();
    return Number.isFinite(ms) ? ms : 0;
  };
  const discordRelativeTimestamp = (value) => {
    const ms = parseMs(value);
    return ms > 0 ? "<t:" + Math.floor(ms / 1000) + ":R>" : "";
  };
  const buildClanProfileLink = (tagRaw) => {
    const tag = normalizeTag(tagRaw);
    return tag
      ? "https://link.clashofclans.com/en/?action=OpenClanProfile&tag=" + encodeURIComponent(tag)
      : "";
  };
  const formatNumber = (value, digits) => {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(digits == null ? 1 : digits) : "-";
  };
  const stableRevision = (valueRaw) => {
    const value = toText(valueRaw);
    let first = 2166136261;
    let second = 5381;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second, 33) ^ code;
    }
    return (first >>> 0).toString(36) + (second >>> 0).toString(36);
  };
  const plural = (count, singular, pluralValue) => Number(count) === 1 ? singular : (pluralValue || singular + "s");
  const formatDate = (value) => {
    const ms = parseMs(value);
    if (!ms) return "";
    try {
      return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(ms));
    } catch {
      return new Date(ms).toISOString().slice(0, 10);
    }
  };

  const sanitizeSettings = (raw) => {
    const value = raw && typeof raw === "object" ? raw : {};
    return {
      schemaVersion: 1,
      regularLookbackWars: Math.floor(clamp(value.regularLookbackWars, 1, 8, DEFAULT_SETTINGS.regularLookbackWars)),
      regularMissedThreshold: Math.floor(clamp(value.regularMissedThreshold, 1, 16, DEFAULT_SETTINGS.regularMissedThreshold)),
      regularPerformanceEnabled: value.regularPerformanceEnabled == null ? true : !!value.regularPerformanceEnabled,
      regularMinimumAttacks: Math.floor(clamp(value.regularMinimumAttacks, 2, 32, DEFAULT_SETTINGS.regularMinimumAttacks)),
      regularAverageStarsThreshold: clamp(value.regularAverageStarsThreshold, 0.5, 3, DEFAULT_SETTINGS.regularAverageStarsThreshold),
      regularAverageDestructionThreshold: clamp(value.regularAverageDestructionThreshold, 25, 100, DEFAULT_SETTINGS.regularAverageDestructionThreshold),
      cwlLookbackSeasons: Math.floor(clamp(value.cwlLookbackSeasons, 1, 8, DEFAULT_SETTINGS.cwlLookbackSeasons)),
      cwlMissedThreshold: Math.floor(clamp(value.cwlMissedThreshold, 1, 8, DEFAULT_SETTINGS.cwlMissedThreshold)),
      cwlPerformanceEnabled: value.cwlPerformanceEnabled == null ? true : !!value.cwlPerformanceEnabled,
      cwlMinimumAttacks: Math.floor(clamp(value.cwlMinimumAttacks, 2, 24, DEFAULT_SETTINGS.cwlMinimumAttacks)),
      cwlAverageStarsThreshold: clamp(value.cwlAverageStarsThreshold, 0.5, 3, DEFAULT_SETTINGS.cwlAverageStarsThreshold),
      cwlAverageDestructionThreshold: clamp(value.cwlAverageDestructionThreshold, 25, 100, DEFAULT_SETTINGS.cwlAverageDestructionThreshold),
      defaultRecoveryWars: Math.floor(clamp(value.defaultRecoveryWars, 1, 8, DEFAULT_SETTINGS.defaultRecoveryWars)),
      defaultHeroDownRosterId: toText(value.defaultHeroDownRosterId).trim(),
      missingDiscordEnabled: value.missingDiscordEnabled == null ? true : !!value.missingDiscordEnabled,
      moderatorNames: (Array.isArray(value.moderatorNames) ? value.moderatorNames : [])
        .map((name) => toText(name).trim())
        .filter(Boolean)
        .slice(0, 40),
      trustedPlayerTags: Array.from(new Set(
        (Array.isArray(value.trustedPlayerTags) ? value.trustedPlayerTags : [])
          .map(normalizeTag)
          .filter(Boolean)
      )).sort().slice(0, 1000),
      rulesUpdatedAt: toText(value.rulesUpdatedAt).trim(),
      updatedAt: toText(value.updatedAt).trim(),
    };
  };

  const emptyStats = () => ({
    warCount: 0,
    possibleAttacks: 0,
    usedAttacks: 0,
    missedAttacks: 0,
    countedAttacks: 0,
    starsTotal: 0,
    totalDestruction: 0,
    threeStarCount: 0,
    hitUpCount: 0,
    sameThHitCount: 0,
    hitDownCount: 0,
  });

  const normalizeStats = (raw) => {
    const value = raw && typeof raw === "object" ? raw : {};
    const attacksMade = toInt(value.attacksMade);
    const attacksMissed = toInt(value.attacksMissed != null ? value.attacksMissed : value.missedAttacks);
    return {
      warCount: toInt(value.warCount),
      possibleAttacks: toInt(value.possibleAttacks != null ? value.possibleAttacks : attacksMade + attacksMissed),
      usedAttacks: toInt(value.usedAttacks != null ? value.usedAttacks : attacksMade),
      missedAttacks: attacksMissed,
      countedAttacks: toInt(value.countedAttacks),
      starsTotal: toInt(value.starsTotal),
      totalDestruction: toInt(value.totalDestruction),
      threeStarCount: toInt(value.threeStarCount),
      hitUpCount: toInt(value.hitUpCount),
      sameThHitCount: toInt(value.sameThHitCount),
      hitDownCount: toInt(value.hitDownCount),
    };
  };

  const addStats = (target, raw) => {
    const source = normalizeStats(raw);
    for (const key of Object.keys(target)) target[key] += source[key];
    return target;
  };

  const statsSummary = (raw) => {
    const stats = normalizeStats(raw);
    return Object.assign({}, stats, {
      averageStars: stats.countedAttacks > 0 ? stats.starsTotal / stats.countedAttacks : null,
      averageDestruction: stats.countedAttacks > 0 ? stats.totalDestruction / stats.countedAttacks : null,
      tripleRate: stats.countedAttacks > 0 ? stats.threeStarCount / stats.countedAttacks : null,
    });
  };

  const getRosters = (rosterData) => Array.isArray(rosterData && rosterData.rosters) ? rosterData.rosters : [];

  const getTaggedValue = (byTagRaw, tagRaw) => {
    const byTag = byTagRaw && typeof byTagRaw === "object" ? byTagRaw : {};
    const tag = normalizeTag(tagRaw);
    if (!tag) return null;
    if (byTag[tag] && typeof byTag[tag] === "object") return byTag[tag];
    const storedKey = Object.keys(byTag).find((key) => normalizeTag(key) === tag);
    return storedKey && byTag[storedKey] && typeof byTag[storedKey] === "object" ? byTag[storedKey] : null;
  };

  const rosterContainsTag = (rosterRaw, tagRaw) => {
    const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
    const tag = normalizeTag(tagRaw);
    if (!tag) return false;
    return ["main", "subs", "missing"].some((key) =>
      (Array.isArray(roster[key]) ? roster[key] : []).some((player) => normalizeTag(player && player.tag) === tag)
    );
  };

  const findEvidenceRoster = (rosterData, tagRaw, identityRaw) => {
    const rosters = getRosters(rosterData);
    const identity = identityRaw && typeof identityRaw === "object" ? identityRaw : {};
    const preferredId = toText(identity.rosterId || identity.sourceRosterId).trim();
    const preferredClanTag = normalizeTag(identity.clanTag || identity.sourceClanTag);
    if (preferredId) {
      const match = rosters.find((roster) => toText(roster && roster.id).trim() === preferredId);
      if (match) return match;
    }
    if (preferredClanTag) {
      const match = rosters.find((roster) => normalizeTag(roster && roster.connectedClanTag) === preferredClanTag);
      if (match) return match;
    }
    return rosters.find((roster) => rosterContainsTag(roster, tagRaw)) || null;
  };

  const buildPlayerDirectory = (rosterData, settingsRaw) => {
    const data = rosterData && typeof rosterData === "object" ? rosterData : {};
    const settings = sanitizeSettings(settingsRaw);
    const trustedTags = new Set(settings.trustedPlayerTags);
    const metricsByTag = data.playerMetrics && data.playerMetrics.byTag && typeof data.playerMetrics.byTag === "object"
      ? data.playerMetrics.byTag
      : {};
    const byTag = {};
    const missingTags = new Set();
    const rosterList = [];
    for (const rosterRaw of getRosters(data)) {
      const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
      const rosterInfo = {
        id: toText(roster.id).trim(),
        title: toText(roster.title).trim() || toText(roster.id).trim(),
        clanTag: normalizeTag(roster.connectedClanTag),
        trackingMode: toText(roster.trackingMode).trim(),
        nextWarStartAt: "",
      };
      const regularWar = roster.regularWar && typeof roster.regularWar === "object" ? roster.regularWar : {};
      const currentWar = regularWar.currentWar && typeof regularWar.currentWar === "object" ? regularWar.currentWar : {};
      const currentWarState = toText(currentWar.state || currentWar.warState).trim().toLowerCase();
      if (currentWarState === "preparation" || currentWarState === "inwar") {
        rosterInfo.nextWarStartAt = toText(currentWar.endTime).trim();
      }
      if (rosterInfo.id) rosterList.push(rosterInfo);
      for (const playerRaw of Array.isArray(roster.missing) ? roster.missing : []) {
        const tag = normalizeTag(playerRaw && playerRaw.tag);
        if (tag) missingTags.add(tag);
      }
      const groups = [
        ["main", Array.isArray(roster.main) ? roster.main : []],
        ["subs", Array.isArray(roster.subs) ? roster.subs : []],
      ];
      for (const [role, players] of groups) {
        for (const playerRaw of players) {
          const player = playerRaw && typeof playerRaw === "object" ? playerRaw : {};
          const tag = normalizeTag(player.tag);
          if (!tag || byTag[tag]) continue;
          const metric = metricsByTag[tag] && typeof metricsByTag[tag] === "object" ? metricsByTag[tag] : {};
          const identity = metric.identity && typeof metric.identity === "object" ? metric.identity : {};
          const discordId = toText(identity.discordId).trim();
          const discordUsername = toText(identity.discordUsername).trim();
          const displayDiscord = discordUsername || toText(player.discord).trim();
          byTag[tag] = {
            tag,
            name: toText(player.name).trim() || toText(identity.name).trim() || tag,
            discord: displayDiscord,
            discordId,
            hasDiscord: !!(discordId || displayDiscord),
            th: toInt(player.th),
            role,
            automaticEligible: true,
            trusted: trustedTags.has(tag),
            rosterId: rosterInfo.id,
            rosterTitle: rosterInfo.title,
            clanTag: rosterInfo.clanTag,
            trackingMode: rosterInfo.trackingMode,
          };
        }
      }
    }
    return { byTag, players: Object.values(byTag), rosters: rosterList, missingTags };
  };

  const buildIgnoredPlayerEntries = (directoryRaw, settingsRaw, casesRaw) => {
    const directory = directoryRaw && typeof directoryRaw === "object" ? directoryRaw : {};
    const byTag = directory.byTag && typeof directory.byTag === "object" ? directory.byTag : {};
    const cases = Array.isArray(casesRaw) ? casesRaw : [];
    const caseByTag = {};
    for (const raw of cases) {
      const value = normalizeCase(raw);
      if (value) caseByTag[value.tag] = value;
    }
    return sanitizeSettings(settingsRaw).trustedPlayerTags
      .map((tag) => {
        const player = byTag[tag] && typeof byTag[tag] === "object" ? byTag[tag] : null;
        const caseValue = caseByTag[tag] || null;
        const rosterId = toText(player && player.rosterId || caseValue && caseValue.sourceRosterId).trim();
        const rosterTitle = toText(player && player.rosterTitle || caseValue && caseValue.sourceRosterTitle).trim();
        return {
          tag,
          name: toText(player && player.name || caseValue && caseValue.name).trim() || tag,
          discord: toText(player && player.discord || caseValue && caseValue.discord).trim(),
          discordId: toText(player && player.discordId).trim(),
          rosterId,
          rosterTitle,
          clanTag: normalizeTag(player && player.clanTag || caseValue && caseValue.sourceClanTag),
          inCurrentRoster: !!player,
        };
      })
      .sort((left, right) =>
        (left.rosterTitle || "\uffff").localeCompare(right.rosterTitle || "\uffff") ||
        left.name.localeCompare(right.name) ||
        left.tag.localeCompare(right.tag)
      );
  };

  const buildRegularEvidence = (entryRaw, settingsRaw) => {
    const settings = sanitizeSettings(settingsRaw);
    const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
    const rawEvents = Array.isArray(entry.recentRegularWarForm) ? entry.recentRegularWarForm : [];
    const events = rawEvents
      .map((eventRaw) => {
        const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
        // Prefer the game-derived war key. The canonical player ledger has its
        // own event id, while the roster fallback uses warKey; choosing warKey
        // keeps the same finalized war stable when refresh promotes its source.
        const id = toText(event.warKey || event.eventId).trim();
        if (!id) return null;
        const legacyId = toText(event.eventId).trim();
        const stats = normalizeStats(event.stats);
        stats.warCount = 1;
        return {
          id,
          legacyIds: legacyId && legacyId !== id ? [legacyId] : [],
          label: toText(event.warKey).trim() || "Regular war",
          at: toText(event.finalizedAt).trim(),
          clanTag: normalizeTag(event.clanTag),
          stats,
        };
      })
      .filter(Boolean)
      .sort((left, right) => parseMs(right.at) - parseMs(left.at) || left.id.localeCompare(right.id))
      .slice(0, settings.regularLookbackWars);
    const totals = emptyStats();
    for (const event of events) addStats(totals, event.stats);
    totals.warCount = events.length;
    return { events, totals: statsSummary(totals) };
  };

  const buildCwlEvidence = (entryRaw, settingsRaw) => {
    const settings = sanitizeSettings(settingsRaw);
    const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
    const seasons = entry.cwlSeasonContext && entry.cwlSeasonContext.bySeason && typeof entry.cwlSeasonContext.bySeason === "object"
      ? entry.cwlSeasonContext.bySeason
      : {};
    const events = Object.keys(seasons)
      .sort()
      .reverse()
      .slice(0, settings.cwlLookbackSeasons)
      .map((season) => {
        const value = seasons[season] && typeof seasons[season] === "object" ? seasons[season] : {};
        const stats = normalizeStats(value.stats);
        stats.warCount = Array.isArray(value.finalizedEventIds) && value.finalizedEventIds.length
          ? value.finalizedEventIds.length
          : (stats.warCount || stats.possibleAttacks);
        return {
          id: "cwl:" + season,
          legacyIds: [],
          label: season,
          at: season + "-01T00:00:00.000Z",
          clanTag: "",
          stats,
        };
      });
    const totals = emptyStats();
    for (const event of events) addStats(totals, event.stats);
    totals.warCount = events.reduce((sum, event) => sum + Math.max(0, toInt(event.stats.warCount)), 0);
    return { events, totals: statsSummary(totals) };
  };

  const combineRegularHistoryStats = (statsRaw, formStatsRaw) => {
    const stats = statsRaw && typeof statsRaw === "object" ? Object.assign({}, statsRaw) : {};
    const formStats = formStatsRaw && typeof formStatsRaw === "object" ? formStatsRaw : null;
    if (!formStats) return stats;
    for (const key of [
      "countedAttacks",
      "formEligibleAttacks",
      "starsTotal",
      "totalDestruction",
      "threeStarCount",
      "hitUpCount",
      "sameThHitCount",
      "hitDownCount",
    ]) {
      if (formStats[key] != null) stats[key] = formStats[key];
    }
    return stats;
  };

  const buildRosterRegularEvidence = (rosterRaw, tagRaw, settingsRaw) => {
    const settings = sanitizeSettings(settingsRaw);
    const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
    const performance = roster.warPerformance && typeof roster.warPerformance === "object"
      ? roster.warPerformance
      : {};
    const history = performance.regularWarHistoryByKey && typeof performance.regularWarHistoryByKey === "object"
      ? performance.regularWarHistoryByKey
      : {};
    const clanTag = normalizeTag(roster.connectedClanTag);
    const events = Object.keys(history)
      .map((key) => {
        const entry = history[key] && typeof history[key] === "object" ? history[key] : null;
        if (!entry || entry.authoritative !== true) return null;
        const stats = getTaggedValue(entry.statsByTag, tagRaw);
        const formStats = getTaggedValue(entry.formStatsByTag, tagRaw);
        if (!stats && !formStats) return null;
        const id = toText(entry.warKey || key).trim();
        if (!id) return null;
        const normalized = normalizeStats(combineRegularHistoryStats(stats, formStats));
        normalized.warCount = 1;
        return {
          id,
          legacyIds: [],
          label: id,
          at: toText(entry.finalizedAt || entry.lastUpdatedAt).trim(),
          clanTag,
          stats: normalized,
        };
      })
      .filter(Boolean)
      .sort((left, right) => parseMs(right.at) - parseMs(left.at) || right.id.localeCompare(left.id))
      .slice(0, settings.regularLookbackWars);
    const totals = emptyStats();
    for (const event of events) addStats(totals, event.stats);
    totals.warCount = events.length;
    return { events, totals: statsSummary(totals) };
  };

  const buildRosterRegularEvidenceForTag = (rosterData, tagRaw, settingsRaw, preferredRosterRaw) => {
    const settings = sanitizeSettings(settingsRaw);
    const preferredRoster = preferredRosterRaw && typeof preferredRosterRaw === "object" ? preferredRosterRaw : null;
    const rosters = getRosters(rosterData);
    const orderedRosters = preferredRoster
      ? [preferredRoster].concat(rosters.filter((roster) => roster !== preferredRoster))
      : rosters;
    const seen = new Set();
    const events = [];
    for (const roster of orderedRosters) {
      const rosterEvidence = buildRosterRegularEvidence(roster, tagRaw, settings);
      for (const event of rosterEvidence.events) {
        const key = normalizeTag(event.clanTag) + "|" + event.id;
        if (seen.has(key)) continue;
        seen.add(key);
        events.push(event);
      }
    }
    events.sort((left, right) => parseMs(right.at) - parseMs(left.at) || right.id.localeCompare(left.id));
    events.splice(settings.regularLookbackWars);
    const totals = emptyStats();
    for (const event of events) addStats(totals, event.stats);
    totals.warCount = events.length;
    return { events, totals: statsSummary(totals) };
  };

  const buildRosterCwlEvidence = (rosterRaw, tagRaw) => {
    const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
    const cwlStats = roster.cwlStats && typeof roster.cwlStats === "object" ? roster.cwlStats : {};
    const season = toText(cwlStats.season).trim();
    const playerStats = getTaggedValue(cwlStats.byTag, tagRaw);
    if (!season || !playerStats) return { events: [], totals: statsSummary(emptyStats()) };
    const stats = normalizeStats(playerStats);
    stats.warCount = toInt(
      playerStats.resolvedWarDays != null
        ? playerStats.resolvedWarDays
        : (playerStats.daysInLineup != null ? playerStats.daysInLineup : stats.possibleAttacks)
    );
    const event = {
      id: "cwl:" + season,
      legacyIds: [],
      label: season,
      at: /^\d{4}-\d{2}$/.test(season) ? (season + "-01T00:00:00.000Z") : (season + "T00:00:00.000Z"),
      clanTag: normalizeTag(roster.connectedClanTag),
      stats,
    };
    const totals = emptyStats();
    addStats(totals, stats);
    totals.warCount = stats.warCount;
    return { events: [event], totals: statsSummary(totals) };
  };

  const buildRosterCwlEvidenceForTag = (rosterData, tagRaw, settingsRaw, preferredRosterRaw) => {
    const settings = sanitizeSettings(settingsRaw);
    const preferredRoster = preferredRosterRaw && typeof preferredRosterRaw === "object" ? preferredRosterRaw : null;
    const rosters = getRosters(rosterData);
    const orderedRosters = preferredRoster
      ? [preferredRoster].concat(rosters.filter((roster) => roster !== preferredRoster))
      : rosters;
    const seen = new Set();
    const events = [];
    for (const roster of orderedRosters) {
      const rosterEvidence = buildRosterCwlEvidence(roster, tagRaw);
      for (const event of rosterEvidence.events) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        events.push(event);
      }
    }
    events.sort((left, right) => parseMs(right.at) - parseMs(left.at) || right.id.localeCompare(left.id));
    events.splice(settings.cwlLookbackSeasons);
    const totals = emptyStats();
    for (const event of events) addStats(totals, event.stats);
    totals.warCount = events.reduce((sum, event) => sum + toInt(event.stats && event.stats.warCount), 0);
    return { events, totals: statsSummary(totals) };
  };

  const buildEvidenceForTag = (rosterData, tagRaw, settingsRaw, identityRaw) => {
    const tag = normalizeTag(tagRaw);
    const store = rosterData && rosterData.playerWarPerformance && typeof rosterData.playerWarPerformance === "object"
      ? rosterData.playerWarPerformance
      : {};
    const byTag = store.byTag && typeof store.byTag === "object" ? store.byTag : {};
    const entry = getTaggedValue(byTag, tag) || {};
    const roster = findEvidenceRoster(rosterData, tag, identityRaw);
    const globalRegular = buildRegularEvidence(entry, settingsRaw);
    const globalCwl = buildCwlEvidence(entry, settingsRaw);
    const regular = globalRegular.events.length
      ? globalRegular
      : buildRosterRegularEvidenceForTag(rosterData, tag, settingsRaw, roster);
    const cwl = globalCwl.events.length
      ? globalCwl
      : buildRosterCwlEvidenceForTag(rosterData, tag, settingsRaw, roster);
    const rosterPerformance = roster && roster.warPerformance && typeof roster.warPerformance === "object"
      ? roster.warPerformance
      : {};
    const rosterCwlStats = roster && roster.cwlStats && typeof roster.cwlStats === "object" ? roster.cwlStats : {};
    return {
      capturedAt: toText(
        store.updatedAt ||
        rosterPerformance.lastRefreshedAt ||
        rosterCwlStats.lastRefreshedAt ||
        (rosterData && rosterData.lastUpdatedAt)
      ).trim(),
      regular: regular.totals,
      cwl: cwl.totals,
      regularEvents: regular.events,
      cwlEvents: cwl.events,
    };
  };

  const buildSignals = (evidenceRaw, settingsRaw) => {
    const settings = sanitizeSettings(settingsRaw);
    const evidence = evidenceRaw && typeof evidenceRaw === "object" ? evidenceRaw : {};
    const regular = statsSummary(evidence.regular);
    const cwl = statsSummary(evidence.cwl);
    const regularEvents = Array.isArray(evidence.regularEvents) ? evidence.regularEvents : [];
    const cwlEvents = Array.isArray(evidence.cwlEvents) ? evidence.cwlEvents : [];
    const buildRevisions = (events) => {
      if (!events.length) return ["none"];
      const idSequences = [events.map((event) => event.id)];
      const maxAliasCount = events.reduce(
        (max, event) => Math.max(max, Array.isArray(event.legacyIds) ? event.legacyIds.length : 0),
        0,
      );
      for (let aliasIndex = 0; aliasIndex < maxAliasCount; aliasIndex++) {
        idSequences.push(events.map((event) => {
          const aliases = Array.isArray(event.legacyIds) ? event.legacyIds : [];
          return aliases[aliasIndex] || event.id;
        }));
      }
      return Array.from(new Set(idSequences.map((ids) => stableRevision(ids.join("|")))));
    };
    const regularRevisions = buildRevisions(regularEvents);
    const cwlRevisions = buildRevisions(cwlEvents);
    const regularRevision = regularRevisions[0];
    const cwlRevision = cwlRevisions[0];
    const signals = [];

    if (regular.possibleAttacks > 0 && regular.missedAttacks >= settings.regularMissedThreshold) {
      signals.push({
        id: ["regular_missed", regularRevision, regular.possibleAttacks, regular.missedAttacks].join(":"),
        reasonCode: "regular_missed",
        title: "Regular-war attacks missed",
        text: regular.missedAttacks + " of " + regular.possibleAttacks + " available attacks missed",
      });
    }
    if (
      settings.regularPerformanceEnabled &&
      regular.countedAttacks >= settings.regularMinimumAttacks &&
      regular.averageStars < settings.regularAverageStarsThreshold &&
      regular.averageDestruction < settings.regularAverageDestructionThreshold
    ) {
      signals.push({
        id: ["regular_performance", regularRevision, regular.countedAttacks, regular.starsTotal, regular.totalDestruction].join(":"),
        reasonCode: "regular_performance",
        title: "Regular-war results",
        text: formatNumber(regular.averageStars, 1) + " stars · " +
          formatNumber(regular.averageDestruction, 0) + "% · " +
          regular.countedAttacks + " counted " + plural(regular.countedAttacks, "attack"),
      });
    }
    if (cwl.possibleAttacks > 0 && cwl.missedAttacks >= settings.cwlMissedThreshold) {
      signals.push({
        id: ["cwl_missed", cwlRevision, cwl.possibleAttacks, cwl.missedAttacks].join(":"),
        reasonCode: "cwl_missed",
        title: "CWL attacks missed",
        text: cwl.missedAttacks + " of " + cwl.possibleAttacks + " available attacks missed",
      });
    }
    if (
      settings.cwlPerformanceEnabled &&
      cwl.countedAttacks >= settings.cwlMinimumAttacks &&
      cwl.averageStars < settings.cwlAverageStarsThreshold &&
      cwl.averageDestruction < settings.cwlAverageDestructionThreshold
    ) {
      signals.push({
        id: ["cwl_performance", cwlRevision, cwl.countedAttacks, cwl.starsTotal, cwl.totalDestruction].join(":"),
        reasonCode: "cwl_performance",
        title: "CWL results",
        text: formatNumber(cwl.averageStars, 1) + " stars · " +
          formatNumber(cwl.averageDestruction, 0) + "% · " +
          cwl.countedAttacks + " " + plural(cwl.countedAttacks, "attack"),
      });
    }
    for (const signal of signals) {
      const revisions = signal.reasonCode.indexOf("regular_") === 0 ? regularRevisions : cwlRevisions;
      const parts = signal.id.split(":");
      signal.legacyIds = revisions.slice(1).map((revision) =>
        [parts[0], revision].concat(parts.slice(2)).join(":")
      );
    }
    return signals;
  };

  const normalizeCase = (raw) => {
    const value = raw && typeof raw === "object" ? raw : {};
    const tag = normalizeTag(value.tag);
    if (!tag) return null;
    return Object.assign({
      tag,
      status: "needs_review",
      outcome: "",
      handledBy: "",
      reasonCodes: [],
      dismissedSignalIds: [],
      mutationLedger: [],
      evidence: { regular: emptyStats(), cwl: emptyStats(), regularEvents: [], cwlEvents: [] },
      activity: [],
    }, value, { tag });
  };

  const cloneValue = (value) => {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  };

  const nextOptimisticTimestamp = (previousRaw) => {
    const previous = parseMs(previousRaw);
    return new Date(Math.max(Date.now(), previous + 1)).toISOString();
  };

  const optimisticActivityDetails = (action, value, request) => {
    switch (action) {
      case "manual_review":
        return ["manual_review", "Added for review."];
      case "dismiss":
        return ["dismissed", "Reviewed with no action."];
      case "watch":
        return [
          "watching",
          "Watching for " + value.watchWarTarget + " regular war" + (value.watchWarTarget === 1 ? "." : "s."),
        ];
      case "hero_down":
        return [
          "hero_down_decision",
          "Hero-down period selected: " + value.recoveryWarTarget + " regular war" +
            (value.recoveryWarTarget === 1 ? "." : "s."),
        ];
      case "mark_dm_sent":
        return ["dm_sent", "Decision DM marked as sent."];
      case "approve_return":
        return ["approved_return", "Approved to return to regular wars."];
      case "extend":
        return [
          "extended",
          "Hero-down period extended to " + value.recoveryWarTarget + " regular war" +
            (value.recoveryWarTarget === 1 ? "." : "s."),
        ];
      case "close":
        return [
          "closed",
          request.outcome === "no_return"
            ? "Closed without return to regular wars."
            : "Follow-up closed.",
        ];
      case "reopen":
        return ["reopened", "Follow-up reopened."];
      case "add_note":
        return ["note", toText(request.note).trim()];
      case "set_handler":
        return [
          "handler",
          value.handledBy ? ("Assigned to " + value.handledBy + ".") : "Assignment cleared.",
        ];
      default:
        return ["", ""];
    }
  };

  const buildOptimisticCase = (itemRaw, actionRaw, requestRaw, mutationIdRaw) => {
    const item = itemRaw && typeof itemRaw === "object" ? itemRaw : {};
    const request = requestRaw && typeof requestRaw === "object" ? requestRaw : {};
    const action = toText(actionRaw).trim().toLowerCase();
    const tag = normalizeTag(request.tag || item.tag);
    if (!tag || !action) return null;
    const current = normalizeCase(item.case);
    const nowIso = nextOptimisticTimestamp(current && current.updatedAt);
    const value = current ? cloneValue(current) : normalizeCase({
      tag,
      status: "needs_review",
      createdAt: nowIso,
      updatedAt: nowIso,
      activity: [],
    });
    if (!value) return null;

    for (const field of [
      "name",
      "discord",
      "sourceRosterId",
      "sourceRosterTitle",
      "targetRosterId",
      "targetRosterTitle",
      "handledBy",
    ]) {
      if (Object.prototype.hasOwnProperty.call(request, field)) value[field] = toText(request[field]).trim();
    }
    if (Object.prototype.hasOwnProperty.call(request, "sourceClanTag")) value.sourceClanTag = normalizeTag(request.sourceClanTag);
    if (Object.prototype.hasOwnProperty.call(request, "targetClanTag")) value.targetClanTag = normalizeTag(request.targetClanTag);

    if (action === "manual_review") {
      value.status = "needs_review";
      value.outcome = "";
      value.reasonCodes = Array.from(new Set(
        (Array.isArray(request.reasonCodes) ? request.reasonCodes : []).concat(["manual"])
      ));
      value.closedAt = "";
    } else if (action === "dismiss") {
      value.status = "dismissed";
      value.outcome = "no_action";
      value.dismissedSignalIds = Array.isArray(request.signalIds) ? request.signalIds.slice() : [];
      value.closedAt = nowIso;
    } else if (action === "watch") {
      value.status = "watching";
      value.outcome = "";
      value.watchStartedAt = nowIso;
      value.watchWarTarget = Math.floor(clamp(request.watchWarTarget, 1, 8, 2));
      value.dismissedSignalIds = Array.isArray(request.signalIds) ? request.signalIds.slice() : [];
      value.closedAt = "";
    } else if (action === "hero_down") {
      value.status = "needs_dm";
      value.outcome = "";
      value.reasonCodes = Array.isArray(request.reasonCodes) ? request.reasonCodes.slice() : [];
      value.evidence = cloneValue(request.evidence || {});
      value.dmText = toText(request.dmText).trim();
      value.recoveryWarTarget = Math.floor(clamp(request.recoveryWarTarget, 1, 8, 3));
      value.requireNoMisses = request.requireNoMisses == null ? true : !!request.requireNoMisses;
      value.dmSentAt = "";
      value.recoveryStartedAt = "";
      value.closedAt = "";
    } else if (action === "mark_dm_sent") {
      value.status = "hero_down";
      value.dmText = toText(request.dmText != null ? request.dmText : value.dmText).trim();
      value.dmSentAt = nowIso;
      value.recoveryStartedAt = nowIso;
    } else if (action === "approve_return") {
      value.status = "closed";
      value.outcome = "approved_return";
      value.closedAt = nowIso;
      value.dismissedSignalIds = Array.isArray(request.signalIds) ? request.signalIds.slice() : [];
    } else if (action === "extend") {
      value.status = "needs_dm";
      value.outcome = "";
      value.recoveryWarTarget = Math.floor(clamp(
        request.recoveryWarTarget,
        1,
        8,
        toInt(value.recoveryWarTarget) || 3,
      ));
      value.requireNoMisses = request.requireNoMisses == null ? value.requireNoMisses !== false : !!request.requireNoMisses;
      value.dmText = toText(request.dmText).trim();
      value.dmSentAt = "";
      value.recoveryStartedAt = "";
    } else if (action === "close") {
      value.status = "closed";
      value.outcome = request.outcome === "no_return" ? "no_return" : "closed";
      value.closedAt = nowIso;
      value.dismissedSignalIds = Array.isArray(request.signalIds) ? request.signalIds.slice() : [];
    } else if (action === "reopen") {
      value.status = "needs_review";
      value.outcome = "";
      value.closedAt = "";
    }

    const actor = toText(request.actor || request.handledBy || value.handledBy).trim();
    const activityDetails = optimisticActivityDetails(action, value, request);
    if (activityDetails[0]) {
      if (!Array.isArray(value.activity)) value.activity = [];
      value.activity.push({
        id: "pending-" + toText(mutationIdRaw),
        at: nowIso,
        type: activityDetails[0],
        actor,
        text: activityDetails[1],
      });
      value.activity = value.activity.slice(-80);
    }
    const mutationId = toText(mutationIdRaw).trim();
    if (mutationId) {
      value.mutationLedger = (Array.isArray(value.mutationLedger) ? value.mutationLedger : [])
        .filter((entry) => entry && entry.mutationId !== mutationId)
        .concat([{ mutationId, action, updatedAt: nowIso }])
        .slice(-16);
    }
    if (!value.createdAt) value.createdAt = nowIso;
    value.updatedAt = nowIso;
    return normalizeCase(value);
  };

  const eventsAfter = (eventsRaw, timestampRaw, clanTagRaw) => {
    const startMs = parseMs(timestampRaw);
    const clanTag = normalizeTag(clanTagRaw);
    return (Array.isArray(eventsRaw) ? eventsRaw : [])
      .filter((event) => {
        if (!event || typeof event !== "object") return false;
        if (startMs && parseMs(event.at) <= startMs) return false;
        if (clanTag && normalizeTag(event.clanTag) !== clanTag) return false;
        return true;
      })
      .sort((left, right) => parseMs(left.at) - parseMs(right.at));
  };

  const buildRecoveryProgress = (caseRaw, currentEvidenceRaw) => {
    const value = normalizeCase(caseRaw);
    const evidence = currentEvidenceRaw && typeof currentEvidenceRaw === "object" ? currentEvidenceRaw : {};
    if (!value) return { ready: false, completedWars: 0, targetWars: 0, totalWars: 0, usedAttacks: 0, possibleAttacks: 0, missedAttacks: 0 };
    const events = eventsAfter(evidence.regularEvents, value.recoveryStartedAt || value.dmSentAt, value.targetClanTag);
    const targetWars = Math.max(1, toInt(value.recoveryWarTarget) || 3);
    let consecutiveCleanWars = 0;
    let usedAttacks = 0;
    let possibleAttacks = 0;
    let missedAttacks = 0;
    for (const event of events) {
      const stats = normalizeStats(event.stats);
      usedAttacks += stats.usedAttacks;
      possibleAttacks += stats.possibleAttacks;
      missedAttacks += stats.missedAttacks;
      if (value.requireNoMisses !== false && stats.missedAttacks > 0) consecutiveCleanWars = 0;
      else consecutiveCleanWars += 1;
    }
    const completedWars = value.requireNoMisses === false ? events.length : consecutiveCleanWars;
    return {
      ready: completedWars >= targetWars,
      completedWars,
      targetWars,
      totalWars: events.length,
      usedAttacks,
      possibleAttacks,
      missedAttacks,
      events,
    };
  };

  const buildWatchProgress = (caseRaw, currentEvidenceRaw) => {
    const value = normalizeCase(caseRaw);
    const evidence = currentEvidenceRaw && typeof currentEvidenceRaw === "object" ? currentEvidenceRaw : {};
    if (!value) return { ready: false, completedWars: 0, targetWars: 0 };
    const events = eventsAfter(evidence.regularEvents, value.watchStartedAt, "");
    const targetWars = Math.max(1, toInt(value.watchWarTarget) || 2);
    return { ready: events.length >= targetWars, completedWars: events.length, targetWars, events };
  };

  const buildWorkItems = (rosterData, privateStateRaw) => {
    const privateState = privateStateRaw && typeof privateStateRaw === "object" ? privateStateRaw : {};
    const settings = sanitizeSettings(privateState.settings);
    const directory = buildPlayerDirectory(rosterData, settings);
    const caseByTag = {};
    for (const raw of Array.isArray(privateState.cases) ? privateState.cases : []) {
      const value = normalizeCase(raw);
      if (value) caseByTag[value.tag] = value;
    }
    const tags = new Set(Object.keys(directory.byTag).concat(Object.keys(caseByTag)));
    const items = [];
    for (const tag of tags) {
      const player = directory.byTag[tag] || null;
      const value = caseByTag[tag] || null;
      if (settings.trustedPlayerTags.includes(tag)) continue;
      if (!player && directory.missingTags.has(tag)) continue;
      const evidenceOwner = player || {
        sourceRosterId: toText(value && value.sourceRosterId).trim(),
        sourceClanTag: normalizeTag(value && value.sourceClanTag),
      };
      const evidence = buildEvidenceForTag(rosterData, tag, settings, evidenceOwner);
      const signals = player && player.automaticEligible ? buildSignals(evidence, settings) : [];
      const signalIds = signals.map((signal) => signal.id);
      const dismissed = new Set(Array.isArray(value && value.dismissedSignalIds) ? value.dismissedSignalIds : []);
      const hasNewSignal = signals.some((signal) =>
        ![signal.id].concat(Array.isArray(signal.legacyIds) ? signal.legacyIds : [])
          .some((id) => dismissed.has(id))
      );
      let status = value ? toText(value.status).trim() : (signals.length ? "needs_review" : "");
      if ((status === "closed" || status === "dismissed") && hasNewSignal) status = "needs_review";
      if (status === "dismissed") status = "closed";
      const recovery = value && value.status === "hero_down" ? buildRecoveryProgress(value, evidence) : null;
      const watching = value && value.status === "watching" ? buildWatchProgress(value, evidence) : null;
      if (recovery && recovery.ready) status = "ready";
      if (watching && watching.ready) status = "needs_review";
      if (!status) continue;
      const identity = player || {
        tag,
        name: toText(value && value.name).trim() || tag,
        discord: toText(value && value.discord).trim(),
        hasDiscord: !!toText(value && value.discord).trim(),
        th: 0,
        role: "",
        rosterId: toText(value && value.sourceRosterId).trim(),
        rosterTitle: toText(value && value.sourceRosterTitle).trim(),
        clanTag: normalizeTag(value && value.sourceClanTag),
        automaticEligible: false,
      };
      items.push({
        tag,
        player: identity,
        case: value,
        evidence,
        signals,
        signalIds,
        status,
        recovery,
        watching,
      });
    }
    items.sort((left, right) => {
      const leftOrder = STATUS_ORDER.indexOf(left.status);
      const rightOrder = STATUS_ORDER.indexOf(right.status);
      return (leftOrder < 0 ? 99 : leftOrder) - (rightOrder < 0 ? 99 : rightOrder) ||
        toText(left.player.rosterTitle).localeCompare(toText(right.player.rosterTitle)) ||
        toText(left.player.name).localeCompare(toText(right.player.name));
    });
    return { items, directory, settings, caseByTag };
  };

  const evidenceSentence = (reasonCode, evidenceRaw) => {
    const evidence = evidenceRaw && typeof evidenceRaw === "object" ? evidenceRaw : {};
    const regular = statsSummary(evidence.regular);
    const cwl = statsSummary(evidence.cwl);
    if (reasonCode === "regular_missed" && regular.possibleAttacks > 0) {
      return "In the reviewed regular wars, " + regular.missedAttacks + " of " + regular.possibleAttacks + " available attacks were not used.";
    }
    if (reasonCode === "cwl_missed" && cwl.possibleAttacks > 0) {
      return "In the reviewed CWL seasons, " + cwl.missedAttacks + " of " + cwl.possibleAttacks + " available attacks were not used.";
    }
    if (reasonCode === "regular_performance" && regular.countedAttacks > 0) {
      return "Across " + regular.countedAttacks + " counted regular-war attacks, the average result was " +
        formatNumber(regular.averageStars, 1) + " stars and " + formatNumber(regular.averageDestruction, 0) + "% destruction.";
    }
    if (reasonCode === "cwl_performance" && cwl.countedAttacks > 0) {
      return "Across " + cwl.countedAttacks + " CWL attacks, the average result was " +
        formatNumber(cwl.averageStars, 1) + " stars and " + formatNumber(cwl.averageDestruction, 0) + "% destruction.";
    }
    return "";
  };

  const buildDmText = (optionsRaw) => {
    const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
    const playerName = toText(options.playerName).trim() || "there";
    const sourceClan = toText(options.sourceClan).trim() || "your current clan";
    const targetClan = toText(options.targetClan).trim() || "the hero-down clan";
    const targetClanLink = buildClanProfileLink(options.targetClanTag);
    const nextWarTimestamp = discordRelativeTimestamp(options.nextWarStartAt);
    const recoveryWars = Math.max(1, toInt(options.recoveryWars) || 3);
    const reasonCodes = Array.isArray(options.reasonCodes) ? options.reasonCodes : [];
    const sentences = reasonCodes.map((code) => evidenceSentence(code, options.evidence)).filter(Boolean);
    if (!sentences.length) sentences.push("Staff reviewed your recent regular-war and CWL participation.");
    return [
      "Hi " + playerName + ".",
      sentences.join(" "),
      "For now, you will not participate in regular wars in " + sourceClan + ".",
      "Please play regular wars in " + targetClan + " and complete " + recoveryWars + " consecutive " +
        plural(recoveryWars, "war") + " without missing an attack.",
      nextWarTimestamp
        ? "The next war there will start " + nextWarTimestamp + ", when the current war ends."
        : "The next war there will start when the current war ends.",
      targetClanLink ? "Clan link: " + targetClanLink : "",
      "Staff will review you again after that.",
    ].filter(Boolean).join(" ");
  };

  const createElement = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const focusKey = (prefixRaw, valueRaw) => {
    const value = toText(valueRaw).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return value ? (toText(prefixRaw).trim() + ":" + value) : "";
  };

  const createButton = (text, className, onClick) => {
    const button = createElement("button", className || "btn secondary", text);
    button.type = "button";
    button.dataset.wfuFocusKey = focusKey("button", text);
    if (onClick) button.addEventListener("click", onClick);
    return button;
  };

  const appendChildren = (parent, children) => {
    for (const child of children) if (child) parent.appendChild(child);
    return parent;
  };

  const formControlKey = (control, indexRaw) => {
    const index = Number(indexRaw) || 0;
    const dataset = control && control.dataset ? control.dataset : {};
    const explicit = toText(dataset.wfuDraftKey || dataset.wfuFocusKey).trim();
    if (explicit) return explicit;
    const type = toText(control && (control.type || control.tagName)).toLowerCase();
    const name = toText(control && control.name).trim();
    const value = toText(control && control.value).trim();
    if ((type === "checkbox" || type === "radio") && name && value) {
      return "choice:" + name + ":" + value;
    }
    const id = toText(control && control.id).trim();
    if (id) return "id:" + id;
    const ariaLabel = control && typeof control.getAttribute === "function"
      ? toText(control.getAttribute("aria-label")).trim()
      : "";
    return ariaLabel ? ("aria:" + ariaLabel) : ("position:" + index + ":" + type);
  };

  const snapshotFormControls = (container) => {
    if (!container || typeof container.querySelectorAll !== "function") return [];
    return Array.from(container.querySelectorAll("input, select, textarea")).map((control, index) => {
      const selectionStart = typeof control.selectionStart === "number" ? control.selectionStart : null;
      const selectionEnd = typeof control.selectionEnd === "number" ? control.selectionEnd : null;
      return {
        key: formControlKey(control, index),
        type: toText(control.type || control.tagName).toLowerCase(),
        value: toText(control.value),
        checked: !!control.checked,
        selectionStart,
        selectionEnd,
      };
    });
  };

  const restoreFormControls = (container, snapshotRaw) => {
    if (!container || typeof container.querySelectorAll !== "function" || !Array.isArray(snapshotRaw)) return;
    const controls = Array.from(container.querySelectorAll("input, select, textarea"));
    const snapshotsByKey = new Map();
    for (let index = 0; index < snapshotRaw.length; index++) {
      const snapshot = snapshotRaw[index] && typeof snapshotRaw[index] === "object"
        ? snapshotRaw[index]
        : null;
      if (!snapshot) continue;
      const key = toText(snapshot.key).trim();
      if (key && !snapshotsByKey.has(key)) snapshotsByKey.set(key, snapshot);
    }
    for (let index = 0; index < controls.length; index++) {
      const control = controls[index];
      const key = formControlKey(control, index);
      const positional = snapshotRaw[index] && typeof snapshotRaw[index] === "object"
        ? snapshotRaw[index]
        : null;
      const positionalKey = toText(positional && positional.key).trim();
      const snapshot = snapshotsByKey.get(key) || (
        key.startsWith("position:") &&
        (!positionalKey || positionalKey.startsWith("position:"))
          ? positional
          : null
      );
      if (!snapshot) continue;
      const currentType = toText(control.type || control.tagName).toLowerCase();
      if (snapshot.type && snapshot.type !== currentType) continue;
      if (currentType === "checkbox" || currentType === "radio") control.checked = !!snapshot.checked;
      else control.value = toText(snapshot.value);
      if (
        snapshot.selectionStart != null &&
        snapshot.selectionEnd != null &&
        typeof control.setSelectionRange === "function"
      ) {
        try {
          control.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
        } catch {
          // Number/select controls do not support text selection.
        }
      }
    }
  };

  const mergeRootUiSnapshot = (previousRaw, snapshotRaw) => {
    const previous = previousRaw && typeof previousRaw === "object" ? previousRaw : {};
    const snapshot = snapshotRaw && typeof snapshotRaw === "object" ? snapshotRaw : {};
    const rootReady = !!snapshot.rootReady;
    const rootHadFocus = !!snapshot.rootHadFocus;
    return {
      openDetails: rootReady
        ? (Array.isArray(snapshot.openDetails) ? snapshot.openDetails.slice() : [])
        : (Array.isArray(previous.openDetails) ? previous.openDetails.slice() : []),
      focusKey: rootHadFocus
        ? toText(snapshot.focusKey).trim()
        : toText(previous.focusKey).trim(),
      focusControlIndex: rootHadFocus && Number.isInteger(snapshot.focusControlIndex)
        ? snapshot.focusControlIndex
        : (Number.isInteger(previous.focusControlIndex) ? previous.focusControlIndex : -1),
      hadFocus: rootHadFocus || !!previous.hadFocus,
    };
  };

  const setControlKey = (control, keyRaw) => {
    const key = toText(keyRaw).trim();
    if (!control || !control.dataset || !key) return control;
    control.dataset.wfuDraftKey = key;
    control.dataset.wfuFocusKey = "field:" + key;
    return control;
  };

  const setField = (labelText, control) => {
    const label = createElement("label", "wfu-field");
    label.appendChild(createElement("span", "wfu-field__label", labelText));
    if (control && control.dataset && !control.dataset.wfuFocusKey) {
      control.dataset.wfuFocusKey = focusKey("field", labelText);
    }
    label.appendChild(control);
    return label;
  };

  const createSelect = (className) => {
    const select = createElement("select", className || "wfu-select");
    return select;
  };

  const addOption = (select, value, label, selected) => {
    const option = createElement("option", "", label);
    option.value = value;
    option.selected = !!selected;
    select.appendChild(option);
  };

  const discordIdentityText = (playerRaw) => {
    const player = playerRaw && typeof playerRaw === "object" ? playerRaw : {};
    const name = toText(player.discord).trim();
    if (name) return name;
    const id = toText(player.discordId).trim();
    return id ? "ID " + id : "";
  };

  const copyText = async (textRaw) => {
    const text = toText(textRaw);
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  };

  const createController = (optionsRaw) => {
    const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
    const state = {
      initialized: false,
      loaded: false,
      loading: false,
      saving: false,
      privateState: { settings: sanitizeSettings(null), cases: [] },
      work: { items: [], directory: { byTag: {}, players: [], rosters: [], missingTags: new Set() }, settings: sanitizeSettings(null), caseByTag: {} },
      view: "work",
      status: "needs_review",
      clan: "",
      handler: "",
      search: "",
      ignoredSearch: "",
      ignoredClan: "",
      visibleLimit: 12,
      selectedTag: "",
      decisionMode: "",
      modal: "",
      message: "",
      error: "",
      noticeTag: "",
      noticeOwner: "",
      pendingCaseMutations: new Map(),
      pendingDismissTags: new Set(),
      pendingIgnoreTags: new Set(),
      pendingTrustValues: new Map(),
      trustUpdatedAtByTag: {},
      trustBaselineUpdatedAt: "",
      queuedTrustEvents: new Map(),
      drawerUiByTag: {},
      skipDrawerDraftCaptureTags: new Set(),
      modalUiByName: {},
      skipModalDraftCapture: "",
      ignoredModalScrollTop: 0,
      ignoredModalFocusIndex: -1,
      rootUi: { openDetails: [], focusKey: "", focusControlIndex: -1, hadFocus: false },
      restoreRootFocus: false,
    };

    const getMount = () => document.getElementById("warFollowupMount");
    const getRosterData = () => typeof options.getRosterData === "function" ? options.getRosterData() : null;
    const getPassword = () => typeof options.getPassword === "function" ? options.getPassword() : "";
    const callServer = (method, args) => {
      if (typeof options.callServer !== "function") return Promise.reject(new Error("Admin API is unavailable."));
      return options.callServer(method, args);
    };
    const pendingWrites = new Set();
    let mutationSequence = 0;

    const createMutationId = () => {
      mutationSequence += 1;
      if (
        typeof crypto !== "undefined" &&
        crypto &&
        typeof crypto.randomUUID === "function"
      ) {
        return "wfu-" + crypto.randomUUID();
      }
      return "wfu-" + Date.now().toString(36) + "-" + mutationSequence.toString(36) + "-" +
        Math.random().toString(36).slice(2, 10);
    };

    const runWrite = (task) => {
      const operation = Promise.resolve().then(task);
      pendingWrites.add(operation);
      operation.then(
        () => pendingWrites.delete(operation),
        () => pendingWrites.delete(operation),
      );
      return operation;
    };

    const waitForPendingWrites = async () => {
      while (pendingWrites.size) {
        await Promise.allSettled(Array.from(pendingWrites));
      }
    };

    const clearDrawerDrafts = (tagRaw) => {
      const tag = normalizeTag(tagRaw);
      if (!tag || !state.drawerUiByTag[tag]) return;
      state.drawerUiByTag[tag].draftsByKey = {};
      state.skipDrawerDraftCaptureTags.add(tag);
    };

    const discardModalDraft = (nameRaw) => {
      const name = toText(nameRaw).trim();
      if (!name) return;
      delete state.modalUiByName[name];
      state.skipModalDraftCapture = name;
    };

    const recompute = () => {
      state.work = buildWorkItems(getRosterData(), state.privateState);
    };

    const setNotice = (message, error, tagRaw, ownerRaw) => {
      state.message = error ? "" : toText(message);
      state.error = error ? toText(message) : "";
      state.noticeTag = error ? normalizeTag(tagRaw) : "";
      state.noticeOwner = state.message || state.error ? toText(ownerRaw).trim() : "";
    };

    const replaceLocalCase = (tagRaw, caseRaw) => {
      const tag = normalizeTag(tagRaw || (caseRaw && caseRaw.tag));
      if (!tag) return;
      const value = normalizeCase(caseRaw);
      const list = Array.isArray(state.privateState.cases) ? state.privateState.cases.slice() : [];
      const index = list.findIndex((entry) => normalizeTag(entry && entry.tag) === tag);
      if (value) {
        if (index >= 0) list[index] = value;
        else list.push(value);
      } else if (index >= 0) {
        list.splice(index, 1);
      }
      state.privateState.cases = list;
      recompute();
    };

    const upsertLocalCase = (caseRaw) => replaceLocalCase(caseRaw && caseRaw.tag, caseRaw);

    const load = async (forceRaw) => {
      if (state.loading || (state.loaded && !forceRaw)) {
        recompute();
        render();
        return;
      }
      const password = getPassword();
      if (!password) return;
      if (forceRaw && pendingWrites.size) await waitForPendingWrites();
      state.loading = true;
      state.error = "";
      render();
      try {
        const result = await callServer("getWarFollowupState", [password]);
        state.privateState = {
          settings: sanitizeSettings(result && result.settings),
          cases: Array.isArray(result && result.cases) ? result.cases.map(normalizeCase).filter(Boolean) : [],
        };
        state.trustUpdatedAtByTag = {};
        state.trustBaselineUpdatedAt = toText(state.privateState.settings.updatedAt).trim();
        state.loaded = true;
        for (const detail of state.queuedTrustEvents.values()) {
          applyLocalIgnoreState(detail.tag, detail.trusted, detail.updatedAt);
        }
        state.queuedTrustEvents.clear();
        recompute();
      } catch (err) {
        setNotice(err && err.message ? err.message : String(err), true);
      } finally {
        state.loading = false;
        render();
      }
    };

    const mutationBase = (item) => {
      const player = item && item.player ? item.player : {};
      const caseValue = item && item.case ? item.case : null;
      return {
        tag: item ? item.tag : normalizeTag(player.tag),
        name: toText(player.name).trim(),
        discord: toText(player.discord).trim(),
        sourceRosterId: toText(player.rosterId || (caseValue && caseValue.sourceRosterId)).trim(),
        sourceRosterTitle: toText(player.rosterTitle || (caseValue && caseValue.sourceRosterTitle)).trim(),
        sourceClanTag: normalizeTag(player.clanTag || (caseValue && caseValue.sourceClanTag)),
        actor: toText(caseValue && caseValue.handledBy).trim(),
        handledBy: toText(caseValue && caseValue.handledBy).trim(),
        signalIds: item && Array.isArray(item.signalIds) ? item.signalIds : [],
        expectedUpdatedAt: toText(caseValue && caseValue.updatedAt).trim(),
      };
    };

    const caseHasMutation = (caseRaw, mutationIdRaw) => {
      const value = normalizeCase(caseRaw);
      const mutationId = toText(mutationIdRaw).trim();
      return !!(
        value &&
        mutationId &&
        Array.isArray(value.mutationLedger) &&
        value.mutationLedger.some((entry) => entry && entry.mutationId === mutationId)
      );
    };

    const mutate = (itemRaw, actionRaw, patchRaw, behaviorRaw) => {
      const item = itemRaw && typeof itemRaw === "object" ? itemRaw : {};
      const tag = normalizeTag(item.tag);
      const action = toText(actionRaw).trim().toLowerCase();
      if (
        !tag ||
        !action ||
        state.pendingCaseMutations.has(tag) ||
        state.pendingIgnoreTags.has(tag)
      ) return null;
      const patch = patchRaw && typeof patchRaw === "object" ? patchRaw : {};
      const behavior = behaviorRaw && typeof behaviorRaw === "object" ? behaviorRaw : {};
      const mutationId = createMutationId();
      const request = Object.assign({}, mutationBase(item), patch, {
        action,
        mutationId,
      });
      const baseCase = item.case ? cloneValue(normalizeCase(item.case)) : null;
      const optimisticCase = buildOptimisticCase(item, action, request, mutationId);
      if (!optimisticCase) return null;
      const operationState = {
        action,
        mutationId,
        baseCase,
        previousSelectedTag: state.selectedTag,
        previousDecisionMode: state.decisionMode,
        errorPrefix: toText(behavior.errorPrefix).trim() || "Could not save this change.",
      };
      state.pendingCaseMutations.set(tag, operationState);
      if (action === "dismiss") state.pendingDismissTags.add(tag);
      setNotice("", false);
      upsertLocalCase(optimisticCase);
      state.selectedTag = behavior.closeDrawer ? "" : tag;
      state.decisionMode = "";
      render();

      const finishSaved = (resultRaw) => {
        const result = normalizeCase(resultRaw);
        if (!result || result.tag !== tag) {
          throw new Error("The server returned an invalid follow-up result.");
        }
        state.pendingCaseMutations.delete(tag);
        state.pendingDismissTags.delete(tag);
        clearDrawerDrafts(tag);
        replaceLocalCase(tag, result);
        render();
        return result;
      };

      return runWrite(async () => {
        try {
          return finishSaved(await callServer("mutateWarFollowupCase", [request, getPassword()]));
        } catch (err) {
          let authoritativeCase = null;
          let authoritativeRead = false;
          try {
            authoritativeCase = await callServer("getWarFollowupCase", [tag, getPassword()]);
            authoritativeRead = true;
            if (caseHasMutation(authoritativeCase, mutationId)) return finishSaved(authoritativeCase);
          } catch {
            // The original mutation error remains the useful error to report.
          }

          state.pendingCaseMutations.delete(tag);
          state.pendingDismissTags.delete(tag);
          replaceLocalCase(tag, authoritativeRead ? authoritativeCase : baseCase);
          const currentItem = state.work.items.find((entry) => entry.tag === tag);
          const anotherDrawerIsActive = !!state.selectedTag && state.selectedTag !== tag;
          if (!anotherDrawerIsActive) {
            if (currentItem) {
              state.selectedTag = tag;
              const authoritativeRevision = toText(authoritativeCase && authoritativeCase.updatedAt).trim();
              const baseRevision = toText(baseCase && baseCase.updatedAt).trim();
              state.decisionMode = !authoritativeRead || authoritativeRevision === baseRevision
                ? operationState.previousDecisionMode
                : "";
            } else {
              state.selectedTag = "";
              state.decisionMode = "";
            }
          }
          const detail = err && err.message ? err.message : String(err);
          setNotice(operationState.errorPrefix + " " + detail, true, tag);
          render();
          return null;
        }
      });
    };

    const dismissInBackground = (item) => {
      const tag = normalizeTag(item && item.tag);
      if (!tag || state.pendingCaseMutations.has(tag) || state.pendingDismissTags.has(tag)) return null;
      const playerName = toText(item && item.player && item.player.name).trim() || tag;
      return mutate(item, "dismiss", {}, {
        closeDrawer: true,
        errorPrefix: playerName + ": Could not save No action.",
      });
    };

    const applyLocalIgnoreState = (tagRaw, ignoredRaw, updatedAtRaw) => {
      const tag = normalizeTag(tagRaw);
      if (!tag) return false;
      const updatedAt = toText(updatedAtRaw).trim();
      const currentTagUpdatedAt = toText(state.trustUpdatedAtByTag[tag]).trim();
      const baselineUpdatedAt = toText(state.trustBaselineUpdatedAt).trim();
      const currentUpdatedAt = toText(state.privateState.settings.updatedAt).trim();
      const currentTrustMs = Math.max(parseMs(currentTagUpdatedAt), parseMs(baselineUpdatedAt));
      if (
        updatedAt &&
        parseMs(updatedAt) > 0 &&
        currentTrustMs > parseMs(updatedAt)
      ) {
        return false;
      }
      const tags = new Set(state.privateState.settings.trustedPlayerTags);
      if (ignoredRaw) tags.add(tag);
      else tags.delete(tag);
      state.privateState.settings = sanitizeSettings(Object.assign({}, state.privateState.settings, {
        trustedPlayerTags: Array.from(tags),
        updatedAt: parseMs(updatedAt) > parseMs(currentUpdatedAt) ? updatedAt : currentUpdatedAt,
      }));
      if (updatedAt) state.trustUpdatedAtByTag[tag] = updatedAt;
      recompute();
      return true;
    };

    const applyAuthoritativeRulesSettings = (settingsRaw) => {
      const current = state.privateState.settings;
      const incoming = sanitizeSettings(settingsRaw);
      const currentUpdatedAt = toText(current.updatedAt).trim();
      const incomingUpdatedAt = toText(incoming.updatedAt).trim();
      const baselineUpdatedAt = toText(state.trustBaselineUpdatedAt).trim();
      const currentTrustTags = new Set(current.trustedPlayerTags);
      const trustTags = new Set(
        parseMs(incomingUpdatedAt) >= parseMs(baselineUpdatedAt)
          ? incoming.trustedPlayerTags
          : current.trustedPlayerTags
      );
      for (const [tagRaw, trustUpdatedAtRaw] of Object.entries(state.trustUpdatedAtByTag)) {
        const tag = normalizeTag(tagRaw);
        if (!tag || parseMs(trustUpdatedAtRaw) <= parseMs(incomingUpdatedAt)) continue;
        if (currentTrustTags.has(tag)) trustTags.add(tag);
        else trustTags.delete(tag);
      }
      for (const [tag, trusted] of state.pendingTrustValues.entries()) {
        if (trusted) trustTags.add(tag);
        else trustTags.delete(tag);
      }
      state.privateState.settings = sanitizeSettings(Object.assign({}, incoming, {
        // Trust writes can be in flight independently from a Rules save.
        trustedPlayerTags: Array.from(trustTags),
        updatedAt: parseMs(currentUpdatedAt) > parseMs(incomingUpdatedAt)
          ? currentUpdatedAt
          : incomingUpdatedAt,
      }));
      if (parseMs(incomingUpdatedAt) >= parseMs(baselineUpdatedAt)) {
        state.trustBaselineUpdatedAt = incomingUpdatedAt;
      }
      recompute();
    };

    const saveRulesInBackground = (nextRaw, expectedRulesUpdatedAtRaw) => {
      if (state.saving) return null;
      const next = nextRaw && typeof nextRaw === "object" ? nextRaw : {};
      const previousSettings = cloneValue(state.privateState.settings);
      const mutationId = createMutationId();
      const noticeOwner = "rules:" + mutationId;
      state.saving = true;
      state.modal = "";
      if (state.noticeOwner.startsWith("rules:")) setNotice("", false);
      state.privateState.settings = sanitizeSettings(Object.assign(
        {},
        state.privateState.settings,
        next,
      ));
      recompute();
      render();

      return runWrite(async () => {
        let savedSuccessfully = false;
        try {
          try {
            const saved = await callServer("saveWarFollowupSettings", [
              next,
              getPassword(),
              toText(expectedRulesUpdatedAtRaw).trim(),
              mutationId,
            ]);
            applyAuthoritativeRulesSettings(saved);
            savedSuccessfully = true;
          } catch (err) {
            let status = null;
            try {
              status = await callServer("getWarFollowupRulesStatus", [mutationId, getPassword()]);
            } catch {
              // Keep the original write error; it best explains the failed action.
            }
            if (status && status.settings) {
              applyAuthoritativeRulesSettings(status.settings);
              savedSuccessfully = !!status.committed;
            } else {
              state.privateState.settings = sanitizeSettings(Object.assign({}, previousSettings, {
                trustedPlayerTags: state.privateState.settings.trustedPlayerTags,
                updatedAt: state.privateState.settings.updatedAt,
              }));
              recompute();
            }
            if (!savedSuccessfully) {
              const newerOverlayIsActive = !!state.selectedTag || !!state.modal;
              if (!newerOverlayIsActive) state.modal = "settings";
              if (
                (!state.message && !state.error) ||
                state.noticeOwner === noticeOwner
              ) {
                setNotice(
                  err && err.message ? err.message : String(err),
                  true,
                  "",
                  noticeOwner,
                );
              }
            }
          }
        } finally {
          state.saving = false;
          if (savedSuccessfully) {
            delete state.modalUiByName.settings;
            if (state.noticeOwner === noticeOwner) setNotice("", false);
          }
          render();
        }
        return savedSuccessfully;
      });
    };

    const ignoreAccountInBackground = (item) => {
      const tag = normalizeTag(item && item.tag);
      if (!tag || state.pendingCaseMutations.has(tag) || state.pendingIgnoreTags.has(tag)) return null;
      const playerName = toText(item && item.player && item.player.name).trim() || tag;
      const mutationId = createMutationId();
      const previousIgnored = state.privateState.settings.trustedPlayerTags.includes(tag);
      const previousTrustUpdatedAt = toText(state.trustUpdatedAtByTag[tag]).trim();

      state.pendingIgnoreTags.add(tag);
      state.pendingTrustValues.set(tag, true);
      state.selectedTag = "";
      state.decisionMode = "";
      setNotice("", false);
      applyLocalIgnoreState(tag, true, "");
      render();

      const finishSaved = (result) => {
        if (!result || normalizeTag(result.tag) !== tag || result.trusted !== true) {
          throw new Error("The server did not confirm the account exclusion.");
        }
        state.pendingIgnoreTags.delete(tag);
        state.pendingTrustValues.delete(tag);
        clearDrawerDrafts(tag);
        applyLocalIgnoreState(tag, true, result.updatedAt);
        render();
        return result;
      };

      return runWrite(async () => {
        try {
          return finishSaved(await callServer("setWarFollowupTrustedAccount", [tag, true, getPassword(), mutationId]));
        } catch (err) {
          // If the write committed but its response was interrupted, verify the
          // saved value before putting the player back into the moderator's way.
          let authoritativeStatus = null;
          try {
            const status = await callServer("getWarFollowupTrustStatus", [tag, getPassword(), mutationId]);
            if (status && normalizeTag(status.tag) === tag) {
              authoritativeStatus = status;
              state.pendingIgnoreTags.delete(tag);
              state.pendingTrustValues.delete(tag);
              applyLocalIgnoreState(tag, !!status.trusted, status.updatedAt);
              if (status.committed || status.trusted === true) {
                render();
                return status;
              }
            }
          } catch {
            // The original error below is the useful one to show.
          }
          state.pendingIgnoreTags.delete(tag);
          state.pendingTrustValues.delete(tag);
          if (
            !authoritativeStatus &&
            toText(state.trustUpdatedAtByTag[tag]).trim() === previousTrustUpdatedAt
          ) {
            applyLocalIgnoreState(tag, previousIgnored, "");
          }
          if (
            (!state.selectedTag || state.selectedTag === tag) &&
            state.work.items.some((entry) => entry.tag === tag)
          ) {
            state.selectedTag = tag;
            state.decisionMode = "";
          }
          const detail = err && err.message ? err.message : String(err);
          setNotice(playerName + ": Could not save Always ignore. " + detail, true, tag);
          render();
          return null;
        }
      });
    };

    const restoreIgnoredAccountInBackground = (entryRaw) => {
      const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
      const tag = normalizeTag(entry.tag);
      if (!tag || state.pendingIgnoreTags.has(tag)) return null;
      const playerName = toText(entry.name).trim() || tag;
      const mutationId = createMutationId();
      const previousIgnored = state.privateState.settings.trustedPlayerTags.includes(tag);
      const previousTrustUpdatedAt = toText(state.trustUpdatedAtByTag[tag]).trim();

      state.pendingIgnoreTags.add(tag);
      state.pendingTrustValues.set(tag, false);
      setNotice("", false);
      applyLocalIgnoreState(tag, false, "");
      render();

      const finishSaved = (result) => {
        if (!result || normalizeTag(result.tag) !== tag || result.trusted !== false) {
          throw new Error("The server did not confirm the account restore.");
        }
        state.pendingIgnoreTags.delete(tag);
        state.pendingTrustValues.delete(tag);
        applyLocalIgnoreState(tag, false, result.updatedAt);
        render();
        return result;
      };

      return runWrite(async () => {
        try {
          return finishSaved(await callServer("setWarFollowupTrustedAccount", [tag, false, getPassword(), mutationId]));
        } catch (err) {
          // A response can be interrupted after the write commits. Confirm the
          // stored value before returning the account to the ignored list.
          let authoritativeStatus = null;
          try {
            const status = await callServer("getWarFollowupTrustStatus", [tag, getPassword(), mutationId]);
            if (status && normalizeTag(status.tag) === tag) {
              authoritativeStatus = status;
              state.pendingIgnoreTags.delete(tag);
              state.pendingTrustValues.delete(tag);
              applyLocalIgnoreState(tag, !!status.trusted, status.updatedAt);
              if (status.committed || status.trusted === false) {
                render();
                return status;
              }
            }
          } catch {
            // The original error below is the useful one to show.
          }
          state.pendingIgnoreTags.delete(tag);
          state.pendingTrustValues.delete(tag);
          if (
            !authoritativeStatus &&
            toText(state.trustUpdatedAtByTag[tag]).trim() === previousTrustUpdatedAt
          ) {
            applyLocalIgnoreState(tag, previousIgnored, "");
          }
          const detail = err && err.message ? err.message : String(err);
          setNotice(playerName + ": Could not restore account. " + detail, true, tag);
          render();
          return null;
        }
      });
    };

    const getSelectedItem = () => state.work.items.find((item) => item.tag === state.selectedTag) || null;

    const statusForItem = (item) => item && STATUS_META[item.status] ? item.status : "needs_review";

    const pendingWriteCount = () => {
      const tags = new Set([
        ...Array.from(state.pendingCaseMutations.keys()),
        ...Array.from(state.pendingIgnoreTags),
      ]);
      return tags.size + (state.saving ? 1 : 0);
    };

    const renderSyncStatus = (mount) => {
      const count = pendingWriteCount();
      if (!count) return;
      const status = createElement("div", "wfu-sync-status");
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      status.appendChild(createElement("span", "wfu-sync-status__dot"));
      status.appendChild(createElement(
        "span",
        "",
        count === 1 ? "Saving change\u2026" : ("Saving " + count + " changes\u2026"),
      ));
      mount.appendChild(status);
    };

    const renderNotice = (mount) => {
      if (!state.message && !state.error) return;
      const errorIsShownInContext = !!(
        state.error &&
        state.noticeTag &&
        (state.selectedTag === state.noticeTag || state.modal === "ignored")
      );
      if (errorIsShownInContext) return;
      const notice = createElement(
        "div",
        "wfu-notice " + (state.error ? "is-error is-floating-error" : "is-success"),
        state.error || state.message,
      );
      const close = createButton("\u00d7", "wfu-notice__close", () => {
        setNotice("", false);
        render();
      });
      close.setAttribute("aria-label", "Dismiss message");
      notice.appendChild(close);
      mount.appendChild(notice);
    };

    const renderHeader = (mount) => {
      const header = createElement("div", "wfu-header");
      const copy = createElement("div", "wfu-header__copy");
      copy.appendChild(createElement("h2", "wfu-title", "War follow-up"));
      const menu = createElement("details", "wfu-menu");
      menu.dataset.wfuRootDetails = "more";
      const menuSummary = createElement("summary", "wfu-menu__summary", "More");
      menuSummary.dataset.wfuFocusKey = focusKey("summary", "More actions");
      menu.appendChild(menuSummary);
      const actions = createElement("div", "wfu-menu__panel");
      const addPlayerButton = createButton("Add player", "wfu-menu__item", () => {
        menu.open = false;
        state.modal = "add";
        render();
      });
      addPlayerButton.dataset.wfuFocusKey = menuSummary.dataset.wfuFocusKey;
      actions.appendChild(addPlayerButton);
      const ignoredCount = state.privateState.settings.trustedPlayerTags.length;
      const ignoredPlayersButton = createButton(
        "Ignored players" + (ignoredCount ? " " + ignoredCount : ""),
        "wfu-menu__item",
        () => {
          menu.open = false;
          state.modal = "ignored";
          render();
        },
      );
      ignoredPlayersButton.dataset.wfuFocusKey = menuSummary.dataset.wfuFocusKey;
      actions.appendChild(ignoredPlayersButton);
      const rulesButton = createButton("Rules", "wfu-menu__item", () => {
        menu.open = false;
        state.modal = "settings";
        render();
      });
      rulesButton.dataset.wfuFocusKey = menuSummary.dataset.wfuFocusKey;
      rulesButton.disabled = state.saving;
      if (state.saving) rulesButton.title = "Rules are saving.";
      actions.appendChild(rulesButton);
      menu.appendChild(actions);
      header.appendChild(copy);
      header.appendChild(menu);
      mount.appendChild(header);
    };

    const renderViewSwitch = (mount) => {
      const switcher = createElement("div", "wfu-view-switch");
      const workButton = createButton("Work", "wfu-view-switch__btn" + (state.view === "work" ? " is-active" : ""), () => {
        state.view = "work";
        state.visibleLimit = 12;
        render();
      });
      workButton.setAttribute("aria-pressed", state.view === "work" ? "true" : "false");
      switcher.appendChild(workButton);
      if (state.work.settings.missingDiscordEnabled) {
        const gapCount = state.work.directory.players.filter((player) => !player.hasDiscord && !player.trusted).length;
        const gapButton = createButton(
          "Discord gaps" + (gapCount ? " " + gapCount : ""),
          "wfu-view-switch__btn" + (state.view === "discord" ? " is-active" : ""),
          () => {
            state.view = "discord";
            state.visibleLimit = 12;
            render();
          },
        );
        gapButton.setAttribute("aria-pressed", state.view === "discord" ? "true" : "false");
        switcher.appendChild(gapButton);
      }
      mount.appendChild(switcher);
    };

    const renderStatusTabs = (mount) => {
      const counts = {};
      for (const key of STATUS_ORDER) counts[key] = 0;
      for (const item of state.work.items) {
        if (state.pendingDismissTags.has(item.tag)) continue;
        counts[statusForItem(item)] = (counts[statusForItem(item)] || 0) + 1;
      }
      const tabs = createElement("div", "wfu-status-tabs");
      const appendStatusButton = (parent, key) => {
        const meta = STATUS_META[key];
        const button = createButton(
          meta.label + (counts[key] ? " " + counts[key] : ""),
          "wfu-status-tab" + (state.status === key ? " is-active" : ""),
          () => {
            const parentDetails = typeof button.closest === "function" ? button.closest("details") : null;
            if (parentDetails) parentDetails.open = false;
            state.status = key;
            state.visibleLimit = 12;
            render();
          },
        );
        button.dataset.tone = meta.tone;
        button.setAttribute("aria-pressed", state.status === key ? "true" : "false");
        parent.appendChild(button);
      };
      for (const key of ["needs_review", "needs_dm", "hero_down", "ready"]) {
        appendStatusButton(tabs, key);
      }
      const secondaryKeys = ["watching", "closed"];
      const more = createElement("details", "wfu-status-more" + (secondaryKeys.includes(state.status) ? " is-active" : ""));
      more.dataset.wfuRootDetails = "status-more";
      const activeSecondary = secondaryKeys.includes(state.status) ? STATUS_META[state.status].label : "More";
      const moreSummary = createElement("summary", "wfu-status-more__summary", activeSecondary);
      moreSummary.dataset.wfuFocusKey = focusKey("summary", "More statuses");
      more.appendChild(moreSummary);
      const panel = createElement("div", "wfu-status-more__panel");
      for (const key of secondaryKeys) appendStatusButton(panel, key);
      more.appendChild(panel);
      tabs.appendChild(more);
      mount.appendChild(tabs);
    };

    const getClanOptions = () => {
      const map = {};
      for (const player of state.work.directory.players) {
        const key = player.rosterId || player.clanTag;
        if (!key || map[key]) continue;
        map[key] = player.rosterTitle || player.clanTag || key;
      }
      return Object.keys(map).sort((a, b) => map[a].localeCompare(map[b])).map((key) => ({ value: key, label: map[key] }));
    };

    const renderFilters = (mount, includeHandler) => {
      const toolbar = createElement("div", "wfu-toolbar");
      const search = createElement("input", "wfu-input wfu-search");
      search.type = "search";
      search.placeholder = "Search";
      search.value = state.search;
      search.setAttribute("aria-label", "Search players");
      search.dataset.wfuFocusKey = focusKey("field", "Work search");
      search.addEventListener("input", () => {
        state.search = search.value;
        state.visibleLimit = 12;
        renderListOnly();
      });
      toolbar.appendChild(search);

      const activeFilterCount = (state.clan ? 1 : 0) + (includeHandler && state.handler ? 1 : 0);
      const filters = createElement("details", "wfu-filter-menu" + (activeFilterCount ? " is-active" : ""));
      filters.dataset.wfuRootDetails = "filters";
      const filtersSummary = createElement(
        "summary",
        "wfu-filter-menu__summary",
        "Filters" + (activeFilterCount ? " " + activeFilterCount : ""),
      );
      filtersSummary.dataset.wfuFocusKey = focusKey("summary", "Work filters");
      filters.appendChild(filtersSummary);
      const filterPanel = createElement("div", "wfu-filter-menu__panel");
      const clan = createSelect("wfu-select");
      addOption(clan, "", "All clans", !state.clan);
      for (const option of getClanOptions()) addOption(clan, option.value, option.label, option.value === state.clan);
      clan.setAttribute("aria-label", "Filter by clan");
      clan.dataset.wfuFocusKey = focusKey("field", "Work clan filter");
      clan.addEventListener("change", () => {
        filters.open = false;
        state.clan = clan.value;
        state.visibleLimit = 12;
        render();
      });
      filterPanel.appendChild(clan);

      if (includeHandler) {
        const handler = createSelect("wfu-select");
        addOption(handler, "", "Anyone", !state.handler);
        for (const name of state.work.settings.moderatorNames) addOption(handler, name, name, name === state.handler);
        handler.setAttribute("aria-label", "Filter by moderator");
        handler.dataset.wfuFocusKey = focusKey("field", "Work moderator filter");
        handler.addEventListener("change", () => {
          filters.open = false;
          state.handler = handler.value;
          state.visibleLimit = 12;
          render();
        });
        filterPanel.appendChild(handler);
      }
      if (activeFilterCount) {
        filterPanel.appendChild(createButton("Clear filters", "wfu-filter-clear", () => {
          filters.open = false;
          state.clan = "";
          if (includeHandler) state.handler = "";
          state.visibleLimit = 12;
          render();
        }));
      }
      filters.appendChild(filterPanel);
      toolbar.appendChild(filters);
      mount.appendChild(toolbar);
    };

    const matchesFilters = (item) => {
      if (state.pendingDismissTags.has(item.tag)) return false;
      if (statusForItem(item) !== state.status) return false;
      const player = item.player || {};
      if (state.clan && state.clan !== player.rosterId && state.clan !== player.clanTag) return false;
      if (state.handler && toText(item.case && item.case.handledBy) !== state.handler) return false;
      const query = state.search.trim().toLowerCase();
      if (!query) return true;
      return [player.name, item.tag, player.discord, player.discordId, player.rosterTitle, player.clanTag]
        .some((value) => toText(value).toLowerCase().includes(query));
    };

    const renderProgress = (item) => {
      const progress = item.status === "hero_down" ? item.recovery : item.watching;
      if (!progress) return null;
      const ratio = Math.max(0, Math.min(1, progress.completedWars / Math.max(1, progress.targetWars)));
      const wrap = createElement("div", "wfu-progress");
      const bar = createElement("div", "wfu-progress__track");
      const fill = createElement("span", "wfu-progress__fill");
      fill.style.width = Math.round(ratio * 100) + "%";
      bar.appendChild(fill);
      wrap.appendChild(createElement("span", "wfu-progress__label", progress.completedWars + "/" + progress.targetWars));
      wrap.appendChild(bar);
      return wrap;
    };

    const renderWorkCard = (item) => {
      const player = item.player || {};
      const meta = STATUS_META[statusForItem(item)];
      const card = createElement("article", "wfu-card");
      card.dataset.status = item.status;
      card.dataset.tag = item.tag;
      card.dataset.wfuFocusKey = focusKey("card", item.tag);
      if (state.pendingCaseMutations.has(item.tag)) {
        card.classList.add("is-pending");
        card.setAttribute("aria-busy", "true");
      }
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", "Open war follow-up for " + (player.name || item.tag));
      const open = () => {
        state.selectedTag = item.tag;
        state.decisionMode = "";
        render();
      };
      card.addEventListener("click", open);
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open();
      });
      const top = createElement("div", "wfu-card__top");
      const identity = createElement("div", "wfu-identity");
      identity.appendChild(createElement("div", "wfu-identity__name", player.name || item.tag));
      const discordIdentity = discordIdentityText(player);
      if (discordIdentity) {
        const discord = createElement("div", "wfu-identity__discord", "Discord \u00b7 " + discordIdentity);
        if (player.discordId) discord.title = "Discord ID: " + player.discordId;
        identity.appendChild(discord);
      }
      identity.appendChild(createElement(
        "div",
        "wfu-identity__meta",
        [player.rosterTitle, player.th ? "TH" + player.th : "", item.tag].filter(Boolean).join(" · "),
      ));
      const pill = createElement("span", "wfu-status-pill", meta.label);
      pill.dataset.tone = meta.tone;
      top.appendChild(identity);
      top.appendChild(pill);
      card.appendChild(top);

      const reasons = createElement("div", "wfu-card__reasons");
      const displaySignals = item.signals.slice(0, 1);
      if (displaySignals.length) {
        for (const signal of displaySignals) reasons.appendChild(createElement("div", "wfu-reason-line", signal.text));
      } else if (item.case && Array.isArray(item.case.reasonCodes) && item.case.reasonCodes.includes("manual")) {
        reasons.appendChild(createElement("div", "wfu-reason-line", "Added manually"));
      } else if (item.status === "closed") {
        reasons.appendChild(createElement("div", "wfu-reason-line", item.case && item.case.outcome === "approved_return" ? "Approved to return" : "Follow-up complete"));
      }
      if (!reasons.childNodes.length) reasons.appendChild(createElement("div", "wfu-reason-line", "Follow-up in progress"));
      card.appendChild(reasons);

      const foot = createElement("div", "wfu-card__foot");
      const progress = renderProgress(item);
      if (progress) foot.appendChild(progress);
      foot.appendChild(createElement("span", "wfu-card__open", "Open"));
      card.appendChild(foot);
      return card;
    };

    const renderListOnly = () => {
      const list = document.getElementById("warFollowupList");
      if (!list) {
        render();
        return;
      }
      list.textContent = "";
      const matching = state.work.items.filter(matchesFilters);
      if (!matching.length) {
        const empty = createElement("div", "wfu-empty");
        empty.appendChild(createElement("div", "wfu-empty__title", "Nothing here"));
        empty.appendChild(createElement("div", "wfu-empty__text", "Try another status or filter."));
        list.appendChild(empty);
        return;
      }
      const visible = matching.slice(0, state.visibleLimit);
      for (const item of visible) list.appendChild(renderWorkCard(item));
      if (matching.length > visible.length) {
        const remaining = matching.length - visible.length;
        const more = createElement("div", "wfu-load-more");
        more.appendChild(createButton(
          "Show " + Math.min(12, remaining) + " more",
          "wfu-load-more__button",
          () => {
            state.visibleLimit += 12;
            renderListOnly();
          },
        ));
        list.appendChild(more);
      }
    };

    const renderWorkList = (mount) => {
      renderStatusTabs(mount);
      renderFilters(mount, true);
      const list = createElement("div", "wfu-list");
      list.id = "warFollowupList";
      mount.appendChild(list);
      renderListOnly();
    };

    const renderDiscordGaps = (mount) => {
      renderFilters(mount, false);
      const groups = {};
      for (const player of state.work.directory.players) {
        if (player.hasDiscord || player.trusted) continue;
        const key = player.rosterId || player.clanTag || "unknown";
        if (state.clan && state.clan !== player.rosterId && state.clan !== player.clanTag) continue;
        const query = state.search.trim().toLowerCase();
        if (query && ![player.name, player.tag, player.rosterTitle].some((value) => toText(value).toLowerCase().includes(query))) continue;
        if (!groups[key]) groups[key] = { title: player.rosterTitle || player.clanTag || "Other", players: [] };
        groups[key].players.push(player);
      }
      const list = createElement("div", "wfu-gap-groups");
      const keys = Object.keys(groups).sort((a, b) => groups[a].title.localeCompare(groups[b].title));
      if (!keys.length) {
        const empty = createElement("div", "wfu-empty");
        empty.appendChild(createElement("div", "wfu-empty__title", "No Discord gaps"));
        list.appendChild(empty);
      }
      for (const key of keys) {
        const group = groups[key];
        const section = createElement("section", "wfu-gap-group");
        section.appendChild(createElement("h3", "wfu-gap-group__title", group.title));
        group.players.sort((a, b) => a.name.localeCompare(b.name));
        for (const player of group.players) {
          const row = createElement("div", "wfu-gap-row");
          const copy = createElement("div", "wfu-gap-row__copy");
          copy.appendChild(createElement("span", "wfu-gap-row__name", player.name));
          copy.appendChild(createElement("span", "wfu-gap-row__tag", player.tag));
          row.appendChild(copy);
          row.appendChild(createButton("Copy tag", "btn secondary wfu-gap-copy", async () => {
            try {
              await copyText(player.tag);
              setNotice("Player tag copied.", false);
            } catch (err) {
              setNotice(err && err.message ? err.message : String(err), true);
            }
            render();
          }));
          section.appendChild(row);
        }
        list.appendChild(section);
      }
      mount.appendChild(list);
    };

    const evidenceCard = (title, statsRaw) => {
      const stats = statsSummary(statsRaw);
      const card = createElement("div", "wfu-evidence-card");
      card.appendChild(createElement("div", "wfu-evidence-card__title", title));
      if (stats.possibleAttacks > 0) {
        const usage = createElement("div", "wfu-evidence-card__primary", stats.usedAttacks + "/" + stats.possibleAttacks + " attacks used");
        if (stats.missedAttacks > 0) usage.classList.add("is-warning");
        card.appendChild(usage);
      } else {
        card.appendChild(createElement("div", "wfu-evidence-card__primary", "No tracked opportunities"));
      }
      if (stats.countedAttacks > 0) {
        card.appendChild(createElement(
          "div",
          "wfu-evidence-card__meta",
          formatNumber(stats.averageStars, 1) + " stars · " +
            formatNumber(stats.averageDestruction, 0) + "% · " +
            stats.threeStarCount + " " + plural(stats.threeStarCount, "triple"),
        ));
      }
      return card;
    };

    const eventRow = (event, kind) => {
      const stats = statsSummary(event && event.stats);
      const row = createElement("div", "wfu-event-row");
      const main = createElement("div", "wfu-event-row__main");
      main.appendChild(createElement("span", "wfu-event-row__label", kind === "cwl" ? toText(event.label) : (formatDate(event.at) || "Regular war")));
      main.appendChild(createElement(
        "span",
        "wfu-event-row__meta",
        [event.clanTag, stats.possibleAttacks ? (stats.usedAttacks + "/" + stats.possibleAttacks + " used") : "", stats.countedAttacks ? (formatNumber(stats.averageStars, 1) + " stars") : ""]
          .filter(Boolean)
          .join(" · "),
      ));
      row.appendChild(main);
      if (stats.missedAttacks > 0) row.appendChild(createElement("span", "wfu-event-row__miss", stats.missedAttacks + " missed"));
      return row;
    };

    const evidenceSection = (item) => {
      const caseEvidence = item && item.case && item.case.evidence && typeof item.case.evidence === "object"
        ? item.case.evidence
        : null;
      const hasDecisionEvidence = !!(
        caseEvidence &&
        item.status !== "needs_review" &&
        item.status !== "watching" &&
        (
          toText(caseEvidence.capturedAt).trim() ||
          toInt(caseEvidence.regular && caseEvidence.regular.possibleAttacks) ||
          toInt(caseEvidence.regular && caseEvidence.regular.countedAttacks) ||
          toInt(caseEvidence.cwl && caseEvidence.cwl.possibleAttacks) ||
          toInt(caseEvidence.cwl && caseEvidence.cwl.countedAttacks) ||
          (Array.isArray(caseEvidence.regularEvents) && caseEvidence.regularEvents.length) ||
          (Array.isArray(caseEvidence.cwlEvents) && caseEvidence.cwlEvents.length)
        )
      );
      const evidence = hasDecisionEvidence ? caseEvidence : item.evidence;
      const section = createElement("section", "wfu-drawer-section");
      section.appendChild(createElement("h3", "wfu-drawer-section__title", hasDecisionEvidence ? "Decision evidence" : "War evidence"));
      const grid = createElement("div", "wfu-evidence-grid");
      grid.appendChild(evidenceCard("Regular wars", evidence.regular));
      grid.appendChild(evidenceCard("CWL", evidence.cwl));
      section.appendChild(grid);
      const events = []
        .concat((evidence.regularEvents || []).map((event) => ({ event, kind: "regular" })))
        .concat((evidence.cwlEvents || []).map((event) => ({ event, kind: "cwl" })));
      if (events.length) {
        const details = createElement("details", "wfu-details");
        details.dataset.wfuDetails = "war-details";
        const summary = createElement("summary", "wfu-details__summary", "War details");
        summary.dataset.wfuFocusKey = focusKey("summary", "War details");
        details.appendChild(summary);
        const rows = createElement("div", "wfu-event-list");
        for (const entry of events) rows.appendChild(eventRow(entry.event, entry.kind));
        details.appendChild(rows);
        section.appendChild(details);
      }
      return section;
    };

    const handlerControl = (selectedRaw) => {
      const names = state.work.settings.moderatorNames;
      if (names.length) {
        const select = createSelect("wfu-select");
        addOption(select, "", "Unassigned", !selectedRaw);
        for (const name of names) addOption(select, name, name, name === selectedRaw);
        return select;
      }
      const input = createElement("input", "wfu-input");
      input.placeholder = "Moderator";
      input.value = toText(selectedRaw);
      return input;
    };

    const renderDecisionStart = (section, item) => {
      section.appendChild(createElement("h3", "wfu-drawer-section__title", "Decision"));
      const actions = createElement("div", "wfu-decision-grid");
      const noAction = createButton("No action", "btn secondary wfu-decision-btn", () => dismissInBackground(item));
      noAction.title = "Dismiss this evidence. Genuinely new war evidence can bring it back.";
      actions.appendChild(noAction);
      actions.appendChild(createButton("Keep watching", "btn secondary wfu-decision-btn", () => {
        state.decisionMode = "watch";
        render();
      }));
      actions.appendChild(createButton("Hero-down period", "btn wfu-decision-btn primary", () => {
        state.decisionMode = "hero_down";
        render();
      }));
      section.appendChild(actions);
      const alwaysIgnore = createButton("Always ignore", "wfu-always-ignore", () => ignoreAccountInBackground(item));
      alwaysIgnore.title = "Keep this account out of war work and Discord gaps until it is enabled again in the roster list.";
      section.appendChild(alwaysIgnore);
    };

    const renderWatchForm = (section, item) => {
      section.appendChild(createElement("h3", "wfu-drawer-section__title", "Keep watching"));
      const form = createElement("form", "wfu-form");
      const count = createElement("input", "wfu-input");
      count.type = "number";
      count.min = "1";
      count.max = "8";
      count.value = "2";
      const handler = handlerControl(toText(item.case && item.case.handledBy));
      form.appendChild(setField("Regular wars", count));
      form.appendChild(setField("Handled by", handler));
      const actions = createElement("div", "wfu-form-actions");
      actions.appendChild(createButton("Back", "btn secondary", () => {
        state.decisionMode = "";
        render();
      }));
      const submit = createElement("button", "btn");
      submit.type = "submit";
      submit.textContent = "Start watching";
      submit.dataset.wfuFocusKey = focusKey("button", submit.textContent);
      actions.appendChild(submit);
      form.appendChild(actions);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        await mutate(item, "watch", {
          watchWarTarget: toInt(count.value) || 2,
          handledBy: handler.value,
          actor: handler.value,
        });
      });
      section.appendChild(form);
    };

    const selectedReasonCodesFromForm = (form) =>
      Array.from(form.querySelectorAll('input[name="wfu-reason"]:checked')).map((input) => input.value);

    const renderHeroDownForm = (section, item, extendingRaw) => {
      const extending = !!extendingRaw;
      section.appendChild(createElement("h3", "wfu-drawer-section__title", extending ? "Extend hero-down" : "Hero-down period"));
      const form = createElement("form", "wfu-form");
      const target = createSelect("wfu-select");
      const existingTarget = toText(item.case && item.case.targetRosterId).trim();
      const defaultTarget = existingTarget || state.work.settings.defaultHeroDownRosterId;
      addOption(target, "", "Choose roster", !defaultTarget);
      for (const roster of state.work.directory.rosters) {
        addOption(target, roster.id, roster.title, roster.id === defaultTarget);
      }
      const wars = createElement("input", "wfu-input");
      wars.type = "number";
      wars.min = "1";
      wars.max = "8";
      wars.value = String(toInt(item.case && item.case.recoveryWarTarget) || state.work.settings.defaultRecoveryWars);
      const handler = handlerControl(toText(item.case && item.case.handledBy));
      form.appendChild(setField("Hero-down roster", target));
      form.appendChild(setField("Clean regular wars", wars));
      form.appendChild(setField("Handled by", handler));

      const reasons = createElement("fieldset", "wfu-reason-picker");
      reasons.appendChild(createElement("legend", "wfu-field__label", "Include in DM"));
      const availableSignals = item.signals.length
        ? item.signals
        : [{ reasonCode: "manual", title: "Manual review", text: "Staff review" }];
      for (const signal of availableSignals) {
        const label = createElement("label", "wfu-check");
        const checkbox = createElement("input");
        checkbox.type = "checkbox";
        checkbox.name = "wfu-reason";
        checkbox.value = signal.reasonCode;
        checkbox.checked = signal.reasonCode !== "manual";
        label.appendChild(checkbox);
        label.appendChild(createElement("span", "", signal.title));
        reasons.appendChild(label);
      }
      form.appendChild(reasons);

      const message = createElement("textarea", "wfu-textarea wfu-dm-textarea");
      message.rows = 8;
      const syncMessage = () => {
        const targetRoster = state.work.directory.rosters.find((roster) => roster.id === target.value);
        const reasonCodes = selectedReasonCodesFromForm(form);
        message.value = buildDmText({
          playerName: item.player.name,
          sourceClan: item.player.rosterTitle || (item.case && item.case.sourceRosterTitle),
          targetClan: targetRoster && targetRoster.title,
          targetClanTag: targetRoster && targetRoster.clanTag,
          nextWarStartAt: targetRoster && targetRoster.nextWarStartAt,
          recoveryWars: wars.value,
          reasonCodes,
          evidence: item.evidence,
        });
      };
      syncMessage();
      target.addEventListener("change", syncMessage);
      wars.addEventListener("input", syncMessage);
      reasons.addEventListener("change", syncMessage);
      form.appendChild(setField("Decision message", message));

      const actions = createElement("div", "wfu-form-actions");
      actions.appendChild(createButton("Back", "btn secondary", () => {
        state.decisionMode = "";
        render();
      }));
      const submit = createElement("button", "btn");
      submit.type = "submit";
      submit.textContent = extending ? "Prepare extension DM" : "Prepare DM";
      submit.dataset.wfuFocusKey = focusKey("button", submit.textContent);
      actions.appendChild(submit);
      form.appendChild(actions);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const targetRoster = state.work.directory.rosters.find((roster) => roster.id === target.value);
        if (!targetRoster) {
          setNotice("Choose a hero-down roster.", true);
          render();
          return;
        }
        if (!targetRoster.clanTag) {
          setNotice("The selected hero-down roster needs a connected clan tag.", true);
          render();
          return;
        }
        const reasonCodes = selectedReasonCodesFromForm(form);
        const patch = {
          targetRosterId: targetRoster.id,
          targetRosterTitle: targetRoster.title,
          targetClanTag: targetRoster.clanTag,
          handledBy: handler.value,
          actor: handler.value,
          recoveryWarTarget: toInt(wars.value) || state.work.settings.defaultRecoveryWars,
          requireNoMisses: true,
          reasonCodes: reasonCodes.length ? reasonCodes : ["manual"],
          evidence: item.evidence,
          dmText: message.value,
        };
        await mutate(item, extending ? "extend" : "hero_down", patch);
      });
      section.appendChild(form);
    };

    const renderNeedsDm = (section, item) => {
      section.appendChild(createElement("h3", "wfu-drawer-section__title", "Send the DM"));
      const message = createElement("textarea", "wfu-textarea wfu-dm-textarea");
      message.rows = 8;
      message.required = true;
      message.value = toText(item.case && item.case.dmText);
      message.addEventListener("input", () => message.setCustomValidity(""));
      section.appendChild(setField("Decision message", message));
      const actions = createElement("div", "wfu-form-actions");
      actions.appendChild(createButton("Copy message", "btn secondary", async () => {
        try {
          await copyText(message.value);
          actions.firstChild.textContent = "Copied";
        } catch (err) {
          setNotice(err && err.message ? err.message : String(err), true);
          render();
        }
      }));
      actions.appendChild(createButton("Change decision", "btn secondary", () => mutate(item, "reopen")));
      actions.appendChild(createButton("Mark DM sent", "btn", () => {
        if (!message.value.trim()) {
          message.setCustomValidity("Add the decision message first.");
          message.reportValidity();
          message.focus();
          return;
        }
        message.setCustomValidity("");
        mutate(item, "mark_dm_sent", {
          dmText: message.value,
          actor: toText(item.case && item.case.handledBy),
        });
      }));
      section.appendChild(actions);
    };

    const renderTrial = (section, item) => {
      const progress = item.recovery || buildRecoveryProgress(item.case, item.evidence);
      section.appendChild(createElement("h3", "wfu-drawer-section__title", item.status === "ready" ? "Ready to review" : "Hero-down progress"));
      const progressCard = createElement("div", "wfu-trial-progress");
      const score = createElement("div", "wfu-trial-progress__score", progress.completedWars + "/" + progress.targetWars);
      const copy = createElement("div", "wfu-trial-progress__copy");
      copy.appendChild(createElement("div", "wfu-trial-progress__title", "Consecutive clean wars"));
      copy.appendChild(createElement(
        "div",
        "wfu-trial-progress__meta",
        progress.possibleAttacks
          ? (progress.usedAttacks + " of " + progress.possibleAttacks + " attacks used")
          : "Waiting for a completed hero-down war",
      ));
      progressCard.appendChild(score);
      progressCard.appendChild(copy);
      section.appendChild(progressCard);

      const actions = createElement("div", "wfu-form-actions");
      if (progress.ready) {
        actions.appendChild(createButton("Approved to return", "btn", () => mutate(item, "approve_return")));
      }
      actions.appendChild(createButton("Extend period", "btn secondary", () => {
        state.decisionMode = "extend";
        render();
      }));
      actions.appendChild(createButton("Close without return", "btn secondary is-danger", () => mutate(item, "close", { outcome: "no_return" })));
      section.appendChild(actions);
    };

    const renderWatching = (section, item) => {
      const progress = item.watching || buildWatchProgress(item.case, item.evidence);
      section.appendChild(createElement("h3", "wfu-drawer-section__title", progress.ready ? "Review new results" : "Watching"));
      const progressCard = createElement("div", "wfu-trial-progress");
      progressCard.appendChild(createElement("div", "wfu-trial-progress__score", progress.completedWars + "/" + progress.targetWars));
      const copy = createElement("div", "wfu-trial-progress__copy");
      copy.appendChild(createElement("div", "wfu-trial-progress__title", "Regular wars observed"));
      copy.appendChild(createElement("div", "wfu-trial-progress__meta", progress.ready ? "The watch period is complete." : "No decision is due yet."));
      progressCard.appendChild(copy);
      section.appendChild(progressCard);
      const actions = createElement("div", "wfu-form-actions");
      actions.appendChild(createButton("Review now", "btn", () => mutate(item, "reopen")));
      actions.appendChild(createButton("No action", "btn secondary", () => dismissInBackground(item)));
      section.appendChild(actions);
    };

    const renderClosed = (section, item) => {
      section.appendChild(createElement("h3", "wfu-drawer-section__title", "Follow-up closed"));
      const outcome = item.case && item.case.outcome === "approved_return"
        ? "Approved to return to regular wars."
        : (item.case && item.case.outcome === "no_action"
          ? "Reviewed with no action."
          : (item.case && item.case.outcome === "no_return"
            ? "Closed without return to regular wars."
            : "No further action is scheduled."));
      section.appendChild(createElement("div", "wfu-closed-copy", outcome));
      section.appendChild(createButton("Reopen", "btn secondary", () => mutate(item, "reopen")));
    };

    const renderCaseAction = (item) => {
      const section = createElement(
        "section",
        "wfu-drawer-section wfu-case-action" +
          (state.pendingCaseMutations.has(item.tag) ? " is-pending" : ""),
      );
      if (state.decisionMode === "watch") renderWatchForm(section, item);
      else if (state.decisionMode === "hero_down") renderHeroDownForm(section, item, false);
      else if (state.decisionMode === "extend") renderHeroDownForm(section, item, true);
      else if (item.status === "needs_review") renderDecisionStart(section, item);
      else if (item.status === "needs_dm") renderNeedsDm(section, item);
      else if (item.status === "hero_down" || item.status === "ready") renderTrial(section, item);
      else if (item.status === "watching") renderWatching(section, item);
      else renderClosed(section, item);
      const heading = section.querySelector(".wfu-drawer-section__title");
      if (heading) {
        heading.tabIndex = -1;
        heading.dataset.wfuFocusKey = focusKey("drawer", "Current state");
      }
      return section;
    };

    const renderNotesAndActivity = (item) => {
      const details = createElement("details", "wfu-details wfu-coordination");
      details.dataset.wfuDetails = "coordination";
      const summary = createElement("summary", "wfu-details__summary", "Coordination");
      summary.dataset.wfuFocusKey = focusKey("summary", "Coordination");
      details.appendChild(summary);
      const section = createElement("div", "wfu-coordination__body");
      if (item.case) {
        const assignmentForm = createElement("form", "wfu-form");
        const assignment = handlerControl(toText(item.case.handledBy));
        const assignmentActions = createElement("div", "wfu-form-actions");
        const assignmentSave = createElement("button", "btn secondary");
        assignmentSave.type = "submit";
        assignmentSave.textContent = "Save assignment";
        assignmentSave.dataset.wfuFocusKey = focusKey("button", assignmentSave.textContent);
        assignmentActions.appendChild(assignmentSave);
        assignmentForm.appendChild(setField("Assigned to", assignment));
        assignmentForm.appendChild(assignmentActions);
        assignmentForm.addEventListener("submit", async (event) => {
          event.preventDefault();
          await mutate(item, "set_handler", {
            handledBy: assignment.value,
            actor: assignment.value || toText(item.case && item.case.handledBy),
          });
        });
        section.appendChild(assignmentForm);

        const noteForm = createElement("form", "wfu-note-form");
        const note = createElement("textarea", "wfu-textarea");
        note.rows = 2;
        note.placeholder = "Private note";
        const save = createElement("button", "btn secondary");
        save.type = "submit";
        save.textContent = "Add note";
        save.dataset.wfuFocusKey = focusKey("button", save.textContent);
        noteForm.appendChild(note);
        noteForm.appendChild(save);
        noteForm.addEventListener("submit", async (event) => {
          event.preventDefault();
          if (!note.value.trim()) return;
          await mutate(item, "add_note", { note: note.value, actor: toText(item.case && item.case.handledBy) });
        });
        section.appendChild(noteForm);
      }
      const activity = Array.isArray(item.case && item.case.activity) ? item.case.activity.slice().reverse() : [];
      if (activity.length) {
        const timeline = createElement("div", "wfu-timeline");
        for (const entry of activity) {
          const row = createElement("div", "wfu-timeline__item");
          row.appendChild(createElement("div", "wfu-timeline__dot"));
          const copy = createElement("div", "wfu-timeline__copy");
          copy.appendChild(createElement("div", "wfu-timeline__text", toText(entry.text).trim() || toText(entry.type).replace(/_/g, " ")));
          copy.appendChild(createElement(
            "div",
            "wfu-timeline__meta",
            [formatDate(entry.at), toText(entry.actor).trim()].filter(Boolean).join(" · "),
          ));
          row.appendChild(copy);
          timeline.appendChild(row);
        }
        section.appendChild(timeline);
      }
      details.appendChild(section);
      return details;
    };

    const renderDrawer = (mount, previousDrawerTagRaw) => {
      const item = getSelectedItem();
      if (!item) return;
      const layer = createElement("div", "wfu-drawer-layer");
      const backdrop = createButton("Close", "wfu-drawer-backdrop", () => {
        state.selectedTag = "";
        state.decisionMode = "";
        state.restoreRootFocus = true;
        render();
      });
      backdrop.setAttribute("aria-label", "Close follow-up details");
      const drawer = createElement("aside", "wfu-drawer");
      drawer.dataset.tag = item.tag;
      drawer.dataset.wfuUiKey = state.decisionMode
        ? ("mode:" + state.decisionMode)
        : ("status:" + statusForItem(item));
      drawer.setAttribute("role", "dialog");
      drawer.setAttribute("aria-modal", "true");
      drawer.setAttribute("aria-label", "War follow-up for " + item.player.name);
      const head = createElement("div", "wfu-drawer__head");
      const identity = createElement("div");
      identity.appendChild(createElement("h2", "wfu-drawer__title", item.player.name || item.tag));
      identity.appendChild(createElement(
        "div",
        "wfu-drawer__meta",
        [item.player.rosterTitle, item.player.th ? "TH" + item.player.th : "", item.tag].filter(Boolean).join(" · "),
      ));
      head.appendChild(identity);
      const close = createButton("\u00d7", "btn secondary wfu-drawer__close", () => {
        state.selectedTag = "";
        state.decisionMode = "";
        state.restoreRootFocus = true;
        render();
      });
      close.setAttribute("aria-label", "Close");
      head.appendChild(close);
      drawer.appendChild(head);
      const body = createElement("div", "wfu-drawer__body");
      if (state.error && state.noticeTag === item.tag) {
        body.appendChild(createElement("div", "wfu-drawer-error", state.error));
      }
      body.appendChild(evidenceSection(item));
      body.appendChild(renderCaseAction(item));
      if (item.case) body.appendChild(renderNotesAndActivity(item));
      const drawerUi = state.drawerUiByTag[item.tag] || {};
      const draftsByKey = drawerUi.draftsByKey && typeof drawerUi.draftsByKey === "object"
        ? drawerUi.draftsByKey
        : {};
      restoreFormControls(body, draftsByKey[drawer.dataset.wfuUiKey]);
      const openDetails = new Set(Array.isArray(drawerUi.openDetails) ? drawerUi.openDetails : []);
      for (const details of Array.from(body.querySelectorAll("details[data-wfu-details]"))) {
        details.open = openDetails.has(details.dataset.wfuDetails);
      }
      if (state.pendingCaseMutations.has(item.tag)) {
        for (const control of Array.from(body.querySelectorAll("button, input, select, textarea"))) {
          if (control.disabled) continue;
          control.disabled = true;
          control.dataset.wfuPendingDisabled = "true";
        }
      }
      drawer.appendChild(body);
      layer.appendChild(backdrop);
      layer.appendChild(drawer);
      mount.appendChild(layer);
      window.requestAnimationFrame(() => {
        body.scrollTop = Number(drawerUi.scrollTop) || 0;
        const sameDrawer = normalizeTag(previousDrawerTagRaw) === item.tag;
        if (sameDrawer && drawerUi.focusKey) {
          const target = Array.from(drawer.querySelectorAll("[data-wfu-focus-key]"))
            .find((node) => node.dataset.wfuFocusKey === drawerUi.focusKey);
          if (target && !target.disabled && typeof target.focus === "function") {
            target.focus();
          } else {
            const stateHeading = drawer.querySelector(
              '[data-wfu-focus-key="' + focusKey("drawer", "Current state") + '"]'
            );
            const fallback = stateHeading || drawer.querySelector(".wfu-drawer__close");
            if (fallback && typeof fallback.focus === "function") fallback.focus();
          }
        } else if (sameDrawer && Number.isInteger(drawerUi.focusControlIndex) && drawerUi.focusControlIndex >= 0) {
          const controls = Array.from(drawer.querySelectorAll("button, input, select, textarea, summary"));
          const target = controls[drawerUi.focusControlIndex];
          const fallback = drawer.querySelector(
            '[data-wfu-focus-key="' + focusKey("drawer", "Current state") + '"]'
          );
          if (target && !target.disabled && typeof target.focus === "function") target.focus();
          else if (fallback && typeof fallback.focus === "function") fallback.focus();
        } else if (!sameDrawer) {
          const close = drawer.querySelector(".wfu-drawer__close");
          if (close) close.focus();
        }
      });
    };

    const renderSettingsModal = (mount, previousModalRaw) => {
      const settings = state.work.settings;
      const layer = createElement("div", "wfu-modal-layer");
      const closeModal = () => {
        discardModalDraft("settings");
        state.modal = "";
        state.restoreRootFocus = true;
        render();
      };
      const backdrop = createButton("Close", "wfu-modal-backdrop", closeModal);
      const modal = createElement("div", "wfu-modal wfu-settings-modal");
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-label", "War follow-up rules");
      const head = createElement("div", "wfu-modal__head");
      head.appendChild(createElement("h2", "wfu-modal__title", "Review rules"));
      head.appendChild(createButton("Close", "btn secondary", closeModal));
      modal.appendChild(head);
      const form = createElement("form", "wfu-settings-form");

      const regular = createElement("fieldset", "wfu-settings-group");
      regular.appendChild(createElement("legend", "wfu-settings-group__title", "Regular wars"));
      const regularGrid = createElement("div", "wfu-settings-grid");
      const regLookback = createElement("input", "wfu-input");
      regLookback.type = "number"; regLookback.min = "1"; regLookback.max = "8"; regLookback.value = settings.regularLookbackWars;
      const regMissed = createElement("input", "wfu-input");
      regMissed.type = "number"; regMissed.min = "1"; regMissed.max = "16"; regMissed.value = settings.regularMissedThreshold;
      const regMin = createElement("input", "wfu-input");
      regMin.type = "number"; regMin.min = "2"; regMin.max = "32"; regMin.value = settings.regularMinimumAttacks;
      const regStars = createElement("input", "wfu-input");
      regStars.type = "number"; regStars.min = "0.5"; regStars.max = "3"; regStars.step = "0.1"; regStars.value = settings.regularAverageStarsThreshold;
      const regDestruction = createElement("input", "wfu-input");
      regDestruction.type = "number"; regDestruction.min = "25"; regDestruction.max = "100"; regDestruction.step = "1"; regDestruction.value = settings.regularAverageDestructionThreshold;
      setControlKey(regLookback, "rules-regular-lookback");
      setControlKey(regMissed, "rules-regular-missed");
      setControlKey(regMin, "rules-regular-minimum");
      setControlKey(regStars, "rules-regular-stars");
      setControlKey(regDestruction, "rules-regular-destruction");
      appendChildren(regularGrid, [
        setField("Recent wars", regLookback),
        setField("Missed attacks", regMissed),
        setField("Minimum attacks", regMin),
        setField("Average stars below", regStars),
        setField("Destruction below", regDestruction),
      ]);
      const regPerfLabel = createElement("label", "wfu-check");
      const regPerf = createElement("input");
      regPerf.type = "checkbox"; regPerf.checked = settings.regularPerformanceEnabled;
      setControlKey(regPerf, "rules-regular-performance");
      regPerfLabel.appendChild(regPerf); regPerfLabel.appendChild(createElement("span", "", "Flag poor results"));
      regular.appendChild(regularGrid);
      regular.appendChild(regPerfLabel);
      form.appendChild(regular);

      const cwl = createElement("fieldset", "wfu-settings-group");
      cwl.appendChild(createElement("legend", "wfu-settings-group__title", "CWL"));
      const cwlGrid = createElement("div", "wfu-settings-grid");
      const cwlLookback = createElement("input", "wfu-input");
      cwlLookback.type = "number"; cwlLookback.min = "1"; cwlLookback.max = "8"; cwlLookback.value = settings.cwlLookbackSeasons;
      const cwlMissed = createElement("input", "wfu-input");
      cwlMissed.type = "number"; cwlMissed.min = "1"; cwlMissed.max = "8"; cwlMissed.value = settings.cwlMissedThreshold;
      const cwlMin = createElement("input", "wfu-input");
      cwlMin.type = "number"; cwlMin.min = "2"; cwlMin.max = "24"; cwlMin.value = settings.cwlMinimumAttacks;
      const cwlStars = createElement("input", "wfu-input");
      cwlStars.type = "number"; cwlStars.min = "0.5"; cwlStars.max = "3"; cwlStars.step = "0.1"; cwlStars.value = settings.cwlAverageStarsThreshold;
      const cwlDestruction = createElement("input", "wfu-input");
      cwlDestruction.type = "number"; cwlDestruction.min = "25"; cwlDestruction.max = "100"; cwlDestruction.step = "1"; cwlDestruction.value = settings.cwlAverageDestructionThreshold;
      setControlKey(cwlLookback, "rules-cwl-lookback");
      setControlKey(cwlMissed, "rules-cwl-missed");
      setControlKey(cwlMin, "rules-cwl-minimum");
      setControlKey(cwlStars, "rules-cwl-stars");
      setControlKey(cwlDestruction, "rules-cwl-destruction");
      appendChildren(cwlGrid, [
        setField("Recent seasons", cwlLookback),
        setField("Missed attacks", cwlMissed),
        setField("Minimum attacks", cwlMin),
        setField("Average stars below", cwlStars),
        setField("Destruction below", cwlDestruction),
      ]);
      const cwlPerfLabel = createElement("label", "wfu-check");
      const cwlPerf = createElement("input");
      cwlPerf.type = "checkbox"; cwlPerf.checked = settings.cwlPerformanceEnabled;
      setControlKey(cwlPerf, "rules-cwl-performance");
      cwlPerfLabel.appendChild(cwlPerf); cwlPerfLabel.appendChild(createElement("span", "", "Flag poor results"));
      cwl.appendChild(cwlGrid);
      cwl.appendChild(cwlPerfLabel);
      form.appendChild(cwl);

      const workflow = createElement("fieldset", "wfu-settings-group");
      workflow.appendChild(createElement("legend", "wfu-settings-group__title", "Workflow"));
      const workflowGrid = createElement("div", "wfu-settings-grid");
      const recovery = createElement("input", "wfu-input");
      recovery.type = "number"; recovery.min = "1"; recovery.max = "8"; recovery.value = settings.defaultRecoveryWars;
      const target = createSelect("wfu-select");
      addOption(target, "", "Choose per case", !settings.defaultHeroDownRosterId);
      for (const roster of state.work.directory.rosters) addOption(target, roster.id, roster.title, roster.id === settings.defaultHeroDownRosterId);
      setControlKey(recovery, "rules-default-recovery");
      setControlKey(target, "rules-default-roster");
      appendChildren(workflowGrid, [
        setField("Default clean wars", recovery),
        setField("Default hero-down roster", target),
      ]);
      workflow.appendChild(workflowGrid);
      const gapLabel = createElement("label", "wfu-check");
      const gaps = createElement("input");
      gaps.type = "checkbox"; gaps.checked = settings.missingDiscordEnabled;
      setControlKey(gaps, "rules-discord-gaps");
      gapLabel.appendChild(gaps); gapLabel.appendChild(createElement("span", "", "Show Discord gaps"));
      workflow.appendChild(gapLabel);
      const moderators = createElement("textarea", "wfu-textarea");
      moderators.rows = 3;
      moderators.value = settings.moderatorNames.join("\n");
      moderators.placeholder = "One moderator per line";
      setControlKey(moderators, "rules-moderators");
      workflow.appendChild(setField("Moderators", moderators));
      form.appendChild(workflow);

      const actions = createElement("div", "wfu-form-actions");
      actions.appendChild(createButton("Cancel", "btn secondary", closeModal));
      const save = createElement("button", "btn");
      save.type = "submit";
      save.textContent = "Save rules";
      save.dataset.wfuFocusKey = focusKey("button", save.textContent);
      actions.appendChild(save);
      form.appendChild(actions);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (state.saving) return;
        const next = {
          regularLookbackWars: regLookback.value,
          regularMissedThreshold: regMissed.value,
          regularPerformanceEnabled: regPerf.checked,
          regularMinimumAttacks: regMin.value,
          regularAverageStarsThreshold: regStars.value,
          regularAverageDestructionThreshold: regDestruction.value,
          cwlLookbackSeasons: cwlLookback.value,
          cwlMissedThreshold: cwlMissed.value,
          cwlPerformanceEnabled: cwlPerf.checked,
          cwlMinimumAttacks: cwlMin.value,
          cwlAverageStarsThreshold: cwlStars.value,
          cwlAverageDestructionThreshold: cwlDestruction.value,
          defaultRecoveryWars: recovery.value,
          defaultHeroDownRosterId: target.value,
          missingDiscordEnabled: gaps.checked,
          moderatorNames: moderators.value.split(/\r?\n/).map((name) => name.trim()).filter(Boolean),
        };
        saveRulesInBackground(next, settings.rulesUpdatedAt);
      });
      modal.appendChild(form);
      const modalUi = state.modalUiByName.settings || {};
      restoreFormControls(modal, modalUi.controls);
      layer.appendChild(backdrop);
      layer.appendChild(modal);
      mount.appendChild(layer);
      window.requestAnimationFrame(() => {
        const sameModal = previousModalRaw === "settings";
        const restoreScroll = () => {
          modal.scrollTop = Number(modalUi.scrollTop) || 0;
        };
        if (sameModal && modalUi.focusKey) {
          const target = Array.from(modal.querySelectorAll("[data-wfu-focus-key]"))
            .find((node) => node.dataset.wfuFocusKey === modalUi.focusKey);
          if (target && !target.disabled && typeof target.focus === "function") {
            target.focus({ preventScroll: true });
            restoreScroll();
            return;
          }
        }
        if (sameModal && Number.isInteger(modalUi.focusControlIndex) && modalUi.focusControlIndex >= 0) {
          const controls = Array.from(modal.querySelectorAll("button, input, select, textarea, summary"));
          const target = controls[modalUi.focusControlIndex];
          if (target && !target.disabled && typeof target.focus === "function") {
            target.focus({ preventScroll: true });
            restoreScroll();
            return;
          }
        }
        if (!sameModal) {
          const first = modal.querySelector("input, select, textarea");
          if (first && typeof first.focus === "function") first.focus();
        }
        restoreScroll();
      });
    };

    const renderAddModal = (mount, previousModalRaw) => {
      const layer = createElement("div", "wfu-modal-layer");
      const closeModal = () => {
        discardModalDraft("add");
        state.modal = "";
        state.restoreRootFocus = true;
        render();
      };
      const backdrop = createButton("Close", "wfu-modal-backdrop", closeModal);
      const modal = createElement("div", "wfu-modal wfu-add-modal");
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-label", "Add player for review");
      const head = createElement("div", "wfu-modal__head");
      head.appendChild(createElement("h2", "wfu-modal__title", "Add player"));
      head.appendChild(createButton("Close", "btn secondary", closeModal));
      modal.appendChild(head);
      const search = createElement("input", "wfu-input");
      search.type = "search";
      search.placeholder = "Name or player tag";
      search.setAttribute("aria-label", "Search roster players");
      search.dataset.wfuFocusKey = focusKey("field", "Add player search");
      modal.appendChild(search);
      const results = createElement("div", "wfu-add-results");
      modal.appendChild(results);
      const renderResults = () => {
        results.textContent = "";
        const query = search.value.trim().toLowerCase();
        const players = state.work.directory.players
          .filter((player) => !player.trusted)
          .filter((player) => !query || [player.name, player.tag, player.rosterTitle].some((value) => toText(value).toLowerCase().includes(query)))
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, 40);
        for (const player of players) {
          const row = createElement("div", "wfu-add-row");
          const copy = createElement("div");
          copy.appendChild(createElement("div", "wfu-add-row__name", player.name));
          copy.appendChild(createElement("div", "wfu-add-row__meta", [player.rosterTitle, player.tag].filter(Boolean).join(" · ")));
          row.appendChild(copy);
          row.appendChild(createButton("Add", "btn secondary", () => {
            const existing = state.work.items.find((item) => item.tag === player.tag);
            const item = existing || {
              tag: player.tag,
              player,
              case: null,
              evidence: buildEvidenceForTag(getRosterData(), player.tag, state.work.settings),
              signals: [],
              signalIds: [],
              status: "needs_review",
            };
            discardModalDraft("add");
            state.modal = "";
            mutate(item, "manual_review", { reasonCodes: ["manual"] });
          }));
          results.appendChild(row);
        }
        if (!players.length) results.appendChild(createElement("div", "wfu-empty__text", "No matching roster player."));
      };
      search.addEventListener("input", renderResults);
      const modalUi = state.modalUiByName.add || {};
      restoreFormControls(modal, modalUi.controls);
      renderResults();
      layer.appendChild(backdrop);
      layer.appendChild(modal);
      mount.appendChild(layer);
      window.requestAnimationFrame(() => {
        const sameModal = previousModalRaw === "add";
        const restoreScroll = () => {
          results.scrollTop = Number(modalUi.resultsScrollTop) || 0;
        };
        if (sameModal && modalUi.focusKey) {
          const target = Array.from(modal.querySelectorAll("[data-wfu-focus-key]"))
            .find((node) => node.dataset.wfuFocusKey === modalUi.focusKey);
          if (target && !target.disabled && typeof target.focus === "function") {
            target.focus({ preventScroll: true });
            restoreScroll();
            return;
          }
        }
        search.focus();
        restoreScroll();
      });
    };

    const renderIgnoredModal = (mount, previousModalRaw) => {
      const layer = createElement("div", "wfu-modal-layer");
      const closeModal = () => {
        discardModalDraft("ignored");
        state.modal = "";
        state.restoreRootFocus = true;
        state.ignoredSearch = "";
        state.ignoredClan = "";
        state.ignoredModalScrollTop = 0;
        state.ignoredModalFocusIndex = -1;
        render();
      };
      const backdrop = createButton("Close", "wfu-modal-backdrop", closeModal);
      const modal = createElement("div", "wfu-modal wfu-ignore-modal");
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-label", "Ignored players");
      const entries = buildIgnoredPlayerEntries(
        state.work.directory,
        state.privateState.settings,
        state.privateState.cases,
      );
      const head = createElement("div", "wfu-modal__head");
      head.appendChild(createElement(
        "h2",
        "wfu-modal__title",
        "Ignored players" + (entries.length ? " " + entries.length : ""),
      ));
      head.appendChild(createButton("Close", "btn secondary", closeModal));
      modal.appendChild(head);

      const controls = createElement("div", "wfu-ignore-controls");
      const search = createElement("input", "wfu-input");
      search.type = "search";
      search.placeholder = "Search name or tag";
      search.value = state.ignoredSearch;
      search.setAttribute("aria-label", "Search ignored players");
      search.dataset.wfuFocusKey = focusKey("field", "Ignored player search");
      const clan = createElement("select", "wfu-select");
      clan.setAttribute("aria-label", "Filter ignored players by clan");
      clan.dataset.wfuFocusKey = focusKey("field", "Ignored player clan");
      addOption(clan, "", "All clans", !state.ignoredClan);
      const rosterOptions = Array.from(new Map(
        entries
          .filter((entry) => entry.rosterId || entry.rosterTitle)
          .map((entry) => [entry.rosterId || entry.rosterTitle, entry.rosterTitle || entry.rosterId])
      ).entries()).sort((left, right) => left[1].localeCompare(right[1]));
      for (const [value, label] of rosterOptions) {
        addOption(clan, value, label, state.ignoredClan === value);
      }
      if (entries.some((entry) => !entry.rosterId && !entry.rosterTitle)) {
        addOption(clan, "__other", "No current clan", state.ignoredClan === "__other");
      }
      controls.appendChild(search);
      controls.appendChild(clan);
      modal.appendChild(controls);

      if (state.error && state.noticeTag) {
        modal.appendChild(createElement("div", "wfu-ignore-error", state.error));
      }
      const results = createElement("div", "wfu-ignore-results");
      modal.appendChild(results);

      const renderResults = () => {
        results.textContent = "";
        const query = state.ignoredSearch.trim().toLowerCase();
        const matching = entries.filter((entry) => {
          const clanKey = entry.rosterId || entry.rosterTitle || "__other";
          if (state.ignoredClan && clanKey !== state.ignoredClan) return false;
          return !query || [
            entry.name,
            entry.tag,
            entry.discord,
            entry.discordId,
            entry.rosterTitle,
            entry.clanTag,
          ].some((value) => toText(value).toLowerCase().includes(query));
        });
        let previousClan = "";
        for (const entry of matching) {
          const clanLabel = entry.rosterTitle || "No current clan";
          if (clanLabel !== previousClan) {
            results.appendChild(createElement("div", "wfu-ignore-group", clanLabel));
            previousClan = clanLabel;
          }
          const row = createElement("div", "wfu-add-row wfu-ignore-row");
          const copy = createElement("div", "wfu-ignore-row__copy");
          copy.appendChild(createElement("div", "wfu-add-row__name", entry.name));
          const discord = discordIdentityText(entry);
          copy.appendChild(createElement(
            "div",
            "wfu-add-row__meta",
            [discord, entry.tag].filter(Boolean).join(" \u00b7 "),
          ));
          row.appendChild(copy);
          const restore = createButton("Restore", "btn secondary wfu-ignore-restore", () =>
            restoreIgnoredAccountInBackground(entry)
          );
          restore.dataset.wfuFocusKey = focusKey("ignored", entry.tag);
          restore.title = "Allow this account to appear in war follow-up again.";
          row.appendChild(restore);
          results.appendChild(row);
        }
        if (!matching.length) {
          results.appendChild(createElement(
            "div",
            "wfu-empty__text",
            entries.length ? "No matches." : "No ignored players.",
          ));
        }
      };
      search.addEventListener("input", () => {
        state.ignoredSearch = search.value;
        state.ignoredModalScrollTop = 0;
        renderResults();
        results.scrollTop = 0;
      });
      clan.addEventListener("change", () => {
        state.ignoredClan = clan.value;
        state.ignoredModalScrollTop = 0;
        renderResults();
        results.scrollTop = 0;
      });
      renderResults();
      layer.appendChild(backdrop);
      layer.appendChild(modal);
      mount.appendChild(layer);
      window.requestAnimationFrame(() => {
        results.scrollTop = Number(state.ignoredModalScrollTop) || 0;
        if (previousModalRaw !== "ignored") {
          search.focus();
          return;
        }
        const modalUi = state.modalUiByName.ignored || {};
        if (modalUi.focusKey) {
          const target = Array.from(modal.querySelectorAll("[data-wfu-focus-key]"))
            .find((node) => node.dataset.wfuFocusKey === modalUi.focusKey);
          if (target && !target.disabled && typeof target.focus === "function") {
            target.focus();
            return;
          }
        }
        const restoreButtons = Array.from(modal.querySelectorAll(".wfu-ignore-restore"));
        if (state.ignoredModalFocusIndex >= 0 && restoreButtons.length) {
          const target = restoreButtons[Math.min(state.ignoredModalFocusIndex, restoreButtons.length - 1)];
          if (target && !target.disabled && typeof target.focus === "function") {
            target.focus();
            return;
          }
        }
        search.focus();
      });
    };

    const captureTransientUi = (mount) => {
      if (!mount || typeof mount.querySelector !== "function") return { drawerTag: "", modal: "" };
      const activeElement = typeof document !== "undefined" ? document.activeElement : null;
      const rootDetails = Array.from(mount.querySelectorAll("details[data-wfu-root-details][open]"))
        .map((details) => toText(details.dataset.wfuRootDetails).trim())
        .filter(Boolean);
      const rootReady = !!mount.querySelector(".wfu-view-switch");
      const rootControls = Array.from(
        mount.querySelectorAll("button, input, select, textarea, summary, [tabindex]")
      ).filter((node, index, list) => (
        list.indexOf(node) === index &&
        !(typeof node.closest === "function" && node.closest(".wfu-drawer-layer, .wfu-modal-layer"))
      ));
      const rootHadFocus = !!(
        activeElement &&
        typeof mount.contains === "function" &&
        mount.contains(activeElement) &&
        rootControls.includes(activeElement)
      );
      state.rootUi = mergeRootUiSnapshot(state.rootUi, {
        rootReady,
        openDetails: rootDetails,
        focusKey: rootHadFocus && activeElement.dataset
          ? toText(activeElement.dataset.wfuFocusKey).trim()
          : "",
        focusControlIndex: rootHadFocus ? rootControls.indexOf(activeElement) : -1,
        rootHadFocus,
      });
      const drawer = mount.querySelector(".wfu-drawer[data-tag]");
      const drawerTag = normalizeTag(drawer && drawer.dataset && drawer.dataset.tag);
      if (drawerTag) {
        const body = drawer.querySelector(".wfu-drawer__body");
        const uiKey = toText(drawer.dataset.wfuUiKey).trim();
        const openDetails = Array.from(drawer.querySelectorAll("details[data-wfu-details][open]"))
          .map((details) => toText(details.dataset.wfuDetails).trim())
          .filter(Boolean);
        const previous = state.drawerUiByTag[drawerTag] || {};
        const active = activeElement;
        const activeFocusKey = active && drawer.contains(active) && active.dataset
          ? toText(active.dataset.wfuFocusKey).trim()
          : "";
        const focusControls = Array.from(
          drawer.querySelectorAll("button, input, select, textarea, summary")
        );
        const focusControlIndex = active && drawer.contains(active)
          ? focusControls.indexOf(active)
          : -1;
        const draftsByKey = Object.assign(
          {},
          previous.draftsByKey && typeof previous.draftsByKey === "object"
            ? previous.draftsByKey
            : {},
        );
        if (uiKey && body && !state.skipDrawerDraftCaptureTags.has(drawerTag)) {
          draftsByKey[uiKey] = snapshotFormControls(body);
        }
        state.drawerUiByTag[drawerTag] = {
          scrollTop: body ? body.scrollTop : 0,
          openDetails,
          focusKey: activeFocusKey || toText(previous.focusKey).trim(),
          focusControlIndex,
          draftsByKey,
        };
      }
      state.skipDrawerDraftCaptureTags.clear();
      const modal = mount.querySelector(".wfu-modal");
      const modalName = !modal
        ? ""
        : (modal.classList.contains("wfu-ignore-modal")
          ? "ignored"
          : (modal.classList.contains("wfu-add-modal")
            ? "add"
            : (modal.classList.contains("wfu-settings-modal") ? "settings" : state.modal)));
      if (modalName) {
        const active = activeElement;
        const modalControls = Array.from(
          modal.querySelectorAll("button, input, select, textarea, summary")
        );
        const activeFocusKey = active && modal.contains(active) && active.dataset
          ? toText(active.dataset.wfuFocusKey).trim()
          : "";
        if (state.skipModalDraftCapture === modalName) {
          delete state.modalUiByName[modalName];
        } else {
          const previous = state.modalUiByName[modalName] || {};
          const modalHasFocus = !!(active && modal.contains(active));
          state.modalUiByName[modalName] = {
            controls: snapshotFormControls(modal),
            focusKey: modalHasFocus ? activeFocusKey : toText(previous.focusKey).trim(),
            focusControlIndex: modalHasFocus
              ? modalControls.indexOf(active)
              : (Number.isInteger(previous.focusControlIndex) ? previous.focusControlIndex : -1),
            scrollTop: modalName === "settings"
              ? modal.scrollTop
              : (Number(previous.scrollTop) || 0),
            resultsScrollTop: modalName === "add"
              ? Number((modal.querySelector(".wfu-add-results") || {}).scrollTop) || 0
              : (Number(previous.resultsScrollTop) || 0),
          };
        }
      }
      if (modalName === "ignored") {
        const results = modal.querySelector(".wfu-ignore-results");
        state.ignoredModalScrollTop = results ? results.scrollTop : 0;
        const restoreButtons = Array.from(modal.querySelectorAll(".wfu-ignore-restore"));
        const active = activeElement;
        state.ignoredModalFocusIndex = restoreButtons.indexOf(active);
      }
      state.skipModalDraftCapture = "";
      const placeholderOnly = !rootReady && !!mount.querySelector(".wfu-loading");
      return {
        drawerTag: drawerTag || (placeholderOnly ? normalizeTag(state.selectedTag) : ""),
        modal: modalName || (placeholderOnly ? toText(state.modal).trim() : ""),
        rootHadFocus,
      };
    };

    const restoreRootUi = (mount, previousUiRaw) => {
      const rootUi = state.rootUi && typeof state.rootUi === "object" ? state.rootUi : {};
      const openDetails = new Set(Array.isArray(rootUi.openDetails) ? rootUi.openDetails : []);
      for (const details of Array.from(mount.querySelectorAll("details[data-wfu-root-details]"))) {
        details.open = openDetails.has(toText(details.dataset.wfuRootDetails).trim());
      }
      const previousUi = previousUiRaw && typeof previousUiRaw === "object" ? previousUiRaw : {};
      const shouldRestoreFocus = !!(previousUi.rootHadFocus || state.restoreRootFocus);
      if (!shouldRestoreFocus || state.selectedTag || state.modal) return;
      state.restoreRootFocus = false;
      window.requestAnimationFrame(() => {
        if (state.selectedTag || state.modal) return;
        const controls = Array.from(
          mount.querySelectorAll("button, input, select, textarea, summary, [tabindex]")
        ).filter((node, index, list) => (
          list.indexOf(node) === index &&
          !(typeof node.closest === "function" && node.closest(".wfu-drawer-layer, .wfu-modal-layer"))
        ));
        let target = null;
        if (rootUi.focusKey) {
          target = controls.find((node) => (
            node.dataset && node.dataset.wfuFocusKey === rootUi.focusKey
          )) || null;
        }
        if (!target && Number.isInteger(rootUi.focusControlIndex) && rootUi.focusControlIndex >= 0) {
          target = controls[rootUi.focusControlIndex] || null;
        }
        if (target && !target.disabled && typeof target.focus === "function") target.focus();
      });
    };

    const render = () => {
      const mount = getMount();
      if (!mount) return;
      const previousUi = captureTransientUi(mount);
      mount.classList.toggle("wfu-has-pending-writes", pendingWriteCount() > 0);
      mount.textContent = "";
      renderHeader(mount);
      renderNotice(mount);
      renderSyncStatus(mount);
      if (state.loading) {
        const loading = createElement("div", "wfu-loading");
        loading.appendChild(createElement("span", "wfu-loading__dot"));
        loading.appendChild(createElement("span", "", "Loading follow-ups"));
        mount.appendChild(loading);
        return;
      }
      if (!state.loaded) {
        mount.appendChild(createElement("div", "wfu-empty__text", "Open this section after the admin workspace has loaded."));
        return;
      }
      renderViewSwitch(mount);
      if (state.view === "discord" && state.work.settings.missingDiscordEnabled) renderDiscordGaps(mount);
      else renderWorkList(mount);
      renderDrawer(mount, previousUi.drawerTag);
      if (state.modal === "settings") renderSettingsModal(mount, previousUi.modal);
      if (state.modal === "add") renderAddModal(mount, previousUi.modal);
      if (state.modal === "ignored") renderIgnoredModal(mount, previousUi.modal);
      restoreRootUi(mount, previousUi);
    };

    const handleTabChange = (event) => {
      const key = toText(event && event.detail && event.detail.key).trim();
      if (key === "followup") load(false);
    };

    const handleRosterDataChange = () => {
      if (!state.loaded) return;
      recompute();
      render();
    };

    const handleTrustChange = (event) => {
      const detail = event && event.detail && typeof event.detail === "object" ? event.detail : {};
      const tag = normalizeTag(detail.tag);
      if (!tag) return;
      if (!state.loaded) {
        const next = {
          tag,
          trusted: !!detail.trusted,
          updatedAt: toText(detail.updatedAt).trim(),
        };
        const previous = state.queuedTrustEvents.get(tag);
        if (
          !previous ||
          !next.updatedAt ||
          !previous.updatedAt ||
          parseMs(next.updatedAt) >= parseMs(previous.updatedAt)
        ) {
          state.queuedTrustEvents.set(tag, next);
        }
        return;
      }
      const applied = applyLocalIgnoreState(tag, !!detail.trusted, detail.updatedAt);
      if (!applied) return;
      if (detail.trusted && state.selectedTag === tag) state.selectedTag = "";
      render();
    };

    const handleBeforeUnload = (event) => {
      if (!pendingWriteCount()) return;
      event.preventDefault();
      event.returnValue = "";
      return "";
    };

    const init = () => {
      if (state.initialized) return;
      state.initialized = true;
      document.addEventListener("admin:tabchange", handleTabChange);
      document.addEventListener("admin:rosterdatachange", handleRosterDataChange);
      document.addEventListener("admin:warfollowuptrustchange", handleTrustChange);
      if (typeof window !== "undefined" && window.addEventListener) {
        window.addEventListener("beforeunload", handleBeforeUnload);
      }
      render();
    };

    const destroy = () => {
      document.removeEventListener("admin:tabchange", handleTabChange);
      document.removeEventListener("admin:rosterdatachange", handleRosterDataChange);
      document.removeEventListener("admin:warfollowuptrustchange", handleTrustChange);
      if (typeof window !== "undefined" && window.removeEventListener) {
        window.removeEventListener("beforeunload", handleBeforeUnload);
      }
      state.initialized = false;
    };

    return {
      init,
      destroy,
      load,
      render,
      mutateCase: mutate,
      dismissInBackground,
      ignoreAccountInBackground,
      restoreIgnoredAccountInBackground,
      saveRulesInBackground,
      state,
    };
  };

  let defaultController = null;
  const initialize = (options) => {
    if (defaultController) return defaultController;
    defaultController = createController(options);
    defaultController.init();
    return defaultController;
  };

  return {
    DEFAULT_SETTINGS,
    sanitizeSettings,
    normalizeStats,
    statsSummary,
    formatDate,
    discordRelativeTimestamp,
    buildClanProfileLink,
    discordIdentityText,
    buildPlayerDirectory,
    buildIgnoredPlayerEntries,
    buildEvidenceForTag,
    buildSignals,
    buildRecoveryProgress,
    buildWatchProgress,
    buildWorkItems,
    buildDmText,
    buildOptimisticCase,
    snapshotFormControls,
    restoreFormControls,
    mergeRootUiSnapshot,
    createController,
    initialize,
  };
});
