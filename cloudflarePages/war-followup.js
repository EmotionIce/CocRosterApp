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
  const parseMs = (value) => {
    const ms = new Date(toText(value)).getTime();
    return Number.isFinite(ms) ? ms : 0;
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
      return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(ms));
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
      };
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

  const buildRegularEvidence = (entryRaw, settingsRaw) => {
    const settings = sanitizeSettings(settingsRaw);
    const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
    const rawEvents = Array.isArray(entry.recentRegularWarForm) ? entry.recentRegularWarForm : [];
    const events = rawEvents
      .map((eventRaw) => {
        const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
        const id = toText(event.eventId || event.warKey).trim();
        if (!id) return null;
        const stats = normalizeStats(event.stats);
        stats.warCount = 1;
        return {
          id,
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
      label: season,
      at: season + "T00:00:00.000Z",
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
    const rosterCwl = roster && roster.cwlStats && typeof roster.cwlStats === "object" ? roster.cwlStats : {};
    return {
      capturedAt: toText(
        store.updatedAt ||
        rosterPerformance.lastRefreshedAt ||
        rosterCwl.lastRefreshedAt ||
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
    const regularRevision = regularEvents.length
      ? stableRevision(regularEvents.map((event) => event.id).join("|"))
      : "none";
    const cwlRevision = cwlEvents.length
      ? stableRevision(cwlEvents.map((event) => event.id).join("|"))
      : "none";
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
      evidence: { regular: emptyStats(), cwl: emptyStats(), regularEvents: [], cwlEvents: [] },
      activity: [],
    }, value, { tag });
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
      const hasNewSignal = signals.some((signal) => !dismissed.has(signal.id));
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
      "Staff will review you again after that.",
    ].join(" ");
  };

  const createElement = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const createButton = (text, className, onClick) => {
    const button = createElement("button", className || "btn secondary", text);
    button.type = "button";
    if (onClick) button.addEventListener("click", onClick);
    return button;
  };

  const appendChildren = (parent, children) => {
    for (const child of children) if (child) parent.appendChild(child);
    return parent;
  };

  const setField = (labelText, control) => {
    const label = createElement("label", "wfu-field");
    label.appendChild(createElement("span", "wfu-field__label", labelText));
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
      visibleLimit: 12,
      selectedTag: "",
      decisionMode: "",
      modal: "",
      message: "",
      error: "",
      noticeTag: "",
      pendingDismissTags: new Set(),
    };

    const getMount = () => document.getElementById("warFollowupMount");
    const getRosterData = () => typeof options.getRosterData === "function" ? options.getRosterData() : null;
    const getPassword = () => typeof options.getPassword === "function" ? options.getPassword() : "";
    const callServer = (method, args) => {
      if (typeof options.callServer !== "function") return Promise.reject(new Error("Admin API is unavailable."));
      return options.callServer(method, args);
    };

    const recompute = () => {
      state.work = buildWorkItems(getRosterData(), state.privateState);
    };

    const setNotice = (message, error, tagRaw) => {
      state.message = error ? "" : toText(message);
      state.error = error ? toText(message) : "";
      state.noticeTag = error ? normalizeTag(tagRaw) : "";
    };

    const upsertLocalCase = (caseRaw) => {
      const value = normalizeCase(caseRaw);
      if (!value) return;
      const list = Array.isArray(state.privateState.cases) ? state.privateState.cases.slice() : [];
      const index = list.findIndex((entry) => normalizeTag(entry && entry.tag) === value.tag);
      if (index >= 0) list[index] = value;
      else list.push(value);
      state.privateState.cases = list;
      recompute();
    };

    const load = async (forceRaw) => {
      if (state.loading || (state.loaded && !forceRaw)) {
        recompute();
        render();
        return;
      }
      const password = getPassword();
      if (!password) return;
      state.loading = true;
      state.error = "";
      render();
      try {
        const result = await callServer("getWarFollowupState", [password]);
        state.privateState = {
          settings: sanitizeSettings(result && result.settings),
          cases: Array.isArray(result && result.cases) ? result.cases.map(normalizeCase).filter(Boolean) : [],
        };
        state.loaded = true;
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

    const mutate = async (item, action, patchRaw) => {
      if (state.saving) return null;
      const patch = patchRaw && typeof patchRaw === "object" ? patchRaw : {};
      state.saving = true;
      setNotice("", false);
      render();
      try {
        const request = Object.assign({}, mutationBase(item), patch, { action });
        const result = await callServer("mutateWarFollowupCase", [request, getPassword()]);
        upsertLocalCase(result);
        state.selectedTag = normalizeTag(result && result.tag) || state.selectedTag;
        state.decisionMode = "";
        return result;
      } catch (err) {
        setNotice(err && err.message ? err.message : String(err), true);
        return null;
      } finally {
        state.saving = false;
        render();
      }
    };

    const dismissInBackground = (item) => {
      const tag = normalizeTag(item && item.tag);
      if (!tag || state.saving || state.pendingDismissTags.has(tag)) return null;
      const playerName = toText(item && item.player && item.player.name).trim() || tag;
      const request = Object.assign({}, mutationBase(item), { action: "dismiss" });

      state.pendingDismissTags.add(tag);
      state.selectedTag = "";
      state.decisionMode = "";
      setNotice("", false);
      render();

      return Promise.resolve()
        .then(() => callServer("mutateWarFollowupCase", [request, getPassword()]))
        .then((result) => {
          if (!normalizeCase(result)) throw new Error("The server returned an invalid follow-up result.");
          upsertLocalCase(result);
          state.pendingDismissTags.delete(tag);
          render();
          return result;
        })
        .catch((err) => {
          state.pendingDismissTags.delete(tag);
          recompute();
          if (state.work.items.some((entry) => entry.tag === tag)) {
            state.selectedTag = tag;
            state.decisionMode = "";
          }
          const detail = err && err.message ? err.message : String(err);
          setNotice(playerName + ": Could not save No action. " + detail, true, tag);
          render();
          return null;
        });
    };

    const getSelectedItem = () => state.work.items.find((item) => item.tag === state.selectedTag) || null;

    const statusForItem = (item) => item && STATUS_META[item.status] ? item.status : "needs_review";

    const renderNotice = (mount) => {
      if (!state.message && !state.error) return;
      const notice = createElement("div", "wfu-notice " + (state.error ? "is-error" : "is-success"), state.error || state.message);
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
      menu.appendChild(createElement("summary", "wfu-menu__summary", "More"));
      const actions = createElement("div", "wfu-menu__panel");
      actions.appendChild(createButton("Add player", "wfu-menu__item", () => {
        state.modal = "add";
        render();
      }));
      actions.appendChild(createButton("Rules", "wfu-menu__item", () => {
        state.modal = "settings";
        render();
      }));
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
      const activeSecondary = secondaryKeys.includes(state.status) ? STATUS_META[state.status].label : "More";
      more.appendChild(createElement("summary", "wfu-status-more__summary", activeSecondary));
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
      search.addEventListener("input", () => {
        state.search = search.value;
        state.visibleLimit = 12;
        renderListOnly();
      });
      toolbar.appendChild(search);

      const activeFilterCount = (state.clan ? 1 : 0) + (includeHandler && state.handler ? 1 : 0);
      const filters = createElement("details", "wfu-filter-menu" + (activeFilterCount ? " is-active" : ""));
      filters.appendChild(createElement(
        "summary",
        "wfu-filter-menu__summary",
        "Filters" + (activeFilterCount ? " " + activeFilterCount : ""),
      ));
      const filterPanel = createElement("div", "wfu-filter-menu__panel");
      const clan = createSelect("wfu-select");
      addOption(clan, "", "All clans", !state.clan);
      for (const option of getClanOptions()) addOption(clan, option.value, option.label, option.value === state.clan);
      clan.setAttribute("aria-label", "Filter by clan");
      clan.addEventListener("change", () => {
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
        handler.addEventListener("change", () => {
          state.handler = handler.value;
          state.visibleLimit = 12;
          render();
        });
        filterPanel.appendChild(handler);
      }
      if (activeFilterCount) {
        filterPanel.appendChild(createButton("Clear filters", "wfu-filter-clear", () => {
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
        details.appendChild(createElement("summary", "wfu-details__summary", "War details"));
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
      actions.appendChild(createButton("No action", "btn secondary wfu-decision-btn", () => dismissInBackground(item)));
      actions.appendChild(createButton("Keep watching", "btn secondary wfu-decision-btn", () => {
        state.decisionMode = "watch";
        render();
      }));
      actions.appendChild(createButton("Hero-down period", "btn wfu-decision-btn primary", () => {
        state.decisionMode = "hero_down";
        render();
      }));
      section.appendChild(actions);
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
      message.value = toText(item.case && item.case.dmText);
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
      actions.appendChild(createButton("Mark DM sent", "btn", () => mutate(item, "mark_dm_sent", {
        dmText: message.value,
        actor: toText(item.case && item.case.handledBy),
      })));
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
        : (item.case && item.case.outcome === "no_action" ? "Reviewed with no action." : "No further action is scheduled.");
      section.appendChild(createElement("div", "wfu-closed-copy", outcome));
      section.appendChild(createButton("Reopen", "btn secondary", () => mutate(item, "reopen")));
    };

    const renderCaseAction = (item) => {
      const section = createElement("section", "wfu-drawer-section");
      if (state.decisionMode === "watch") renderWatchForm(section, item);
      else if (state.decisionMode === "hero_down") renderHeroDownForm(section, item, false);
      else if (state.decisionMode === "extend") renderHeroDownForm(section, item, true);
      else if (item.status === "needs_review") renderDecisionStart(section, item);
      else if (item.status === "needs_dm") renderNeedsDm(section, item);
      else if (item.status === "hero_down" || item.status === "ready") renderTrial(section, item);
      else if (item.status === "watching") renderWatching(section, item);
      else renderClosed(section, item);
      return section;
    };

    const renderNotesAndActivity = (item) => {
      const details = createElement("details", "wfu-details wfu-coordination");
      details.appendChild(createElement("summary", "wfu-details__summary", "Coordination"));
      const section = createElement("div", "wfu-coordination__body");
      if (item.case) {
        const assignmentForm = createElement("form", "wfu-form");
        const assignment = handlerControl(toText(item.case.handledBy));
        const assignmentActions = createElement("div", "wfu-form-actions");
        const assignmentSave = createElement("button", "btn secondary");
        assignmentSave.type = "submit";
        assignmentSave.textContent = "Save assignment";
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

    const renderDrawer = (mount) => {
      const item = getSelectedItem();
      if (!item) return;
      const layer = createElement("div", "wfu-drawer-layer");
      const backdrop = createButton("Close", "wfu-drawer-backdrop", () => {
        state.selectedTag = "";
        state.decisionMode = "";
        render();
      });
      backdrop.setAttribute("aria-label", "Close follow-up details");
      const drawer = createElement("aside", "wfu-drawer");
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
      drawer.appendChild(body);
      layer.appendChild(backdrop);
      layer.appendChild(drawer);
      mount.appendChild(layer);
      window.requestAnimationFrame(() => {
        const close = drawer.querySelector(".wfu-drawer__close");
        if (close) close.focus();
      });
    };

    const renderSettingsModal = (mount) => {
      const settings = state.work.settings;
      const layer = createElement("div", "wfu-modal-layer");
      const backdrop = createButton("Close", "wfu-modal-backdrop", () => {
        state.modal = "";
        render();
      });
      const modal = createElement("div", "wfu-modal");
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-label", "War follow-up rules");
      const head = createElement("div", "wfu-modal__head");
      head.appendChild(createElement("h2", "wfu-modal__title", "Review rules"));
      head.appendChild(createButton("Close", "btn secondary", () => {
        state.modal = "";
        render();
      }));
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
      appendChildren(workflowGrid, [
        setField("Default clean wars", recovery),
        setField("Default hero-down roster", target),
      ]);
      workflow.appendChild(workflowGrid);
      const gapLabel = createElement("label", "wfu-check");
      const gaps = createElement("input");
      gaps.type = "checkbox"; gaps.checked = settings.missingDiscordEnabled;
      gapLabel.appendChild(gaps); gapLabel.appendChild(createElement("span", "", "Show Discord gaps"));
      workflow.appendChild(gapLabel);
      const moderators = createElement("textarea", "wfu-textarea");
      moderators.rows = 3;
      moderators.value = settings.moderatorNames.join("\n");
      moderators.placeholder = "One moderator per line";
      workflow.appendChild(setField("Moderators", moderators));
      form.appendChild(workflow);

      const actions = createElement("div", "wfu-form-actions");
      actions.appendChild(createButton("Cancel", "btn secondary", () => {
        state.modal = "";
        render();
      }));
      const save = createElement("button", "btn");
      save.type = "submit";
      save.textContent = "Save rules";
      actions.appendChild(save);
      form.appendChild(actions);
      form.addEventListener("submit", async (event) => {
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
          trustedPlayerTags: settings.trustedPlayerTags,
        };
        state.saving = true;
        render();
        try {
          state.privateState.settings = sanitizeSettings(await callServer("saveWarFollowupSettings", [next, getPassword()]));
          state.modal = "";
          recompute();
          setNotice("Rules saved.", false);
        } catch (err) {
          setNotice(err && err.message ? err.message : String(err), true);
        } finally {
          state.saving = false;
          render();
        }
      });
      modal.appendChild(form);
      layer.appendChild(backdrop);
      layer.appendChild(modal);
      mount.appendChild(layer);
    };

    const renderAddModal = (mount) => {
      const layer = createElement("div", "wfu-modal-layer");
      const backdrop = createButton("Close", "wfu-modal-backdrop", () => {
        state.modal = "";
        render();
      });
      const modal = createElement("div", "wfu-modal wfu-add-modal");
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-label", "Add player for review");
      const head = createElement("div", "wfu-modal__head");
      head.appendChild(createElement("h2", "wfu-modal__title", "Add player"));
      head.appendChild(createButton("Close", "btn secondary", () => {
        state.modal = "";
        render();
      }));
      modal.appendChild(head);
      const search = createElement("input", "wfu-input");
      search.type = "search";
      search.placeholder = "Name or player tag";
      search.setAttribute("aria-label", "Search roster players");
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
          row.appendChild(createButton("Add", "btn secondary", async () => {
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
            state.modal = "";
            const result = await mutate(item, "manual_review", { reasonCodes: ["manual"] });
            if (result) {
              state.selectedTag = player.tag;
              render();
            }
          }));
          results.appendChild(row);
        }
        if (!players.length) results.appendChild(createElement("div", "wfu-empty__text", "No matching roster player."));
      };
      search.addEventListener("input", renderResults);
      renderResults();
      layer.appendChild(backdrop);
      layer.appendChild(modal);
      mount.appendChild(layer);
      window.requestAnimationFrame(() => search.focus());
    };

    const render = () => {
      const mount = getMount();
      if (!mount) return;
      mount.textContent = "";
      renderHeader(mount);
      renderNotice(mount);
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
      renderDrawer(mount);
      if (state.modal === "settings") renderSettingsModal(mount);
      if (state.modal === "add") renderAddModal(mount);
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
      if (!state.loaded) return;
      const detail = event && event.detail && typeof event.detail === "object" ? event.detail : {};
      const tag = normalizeTag(detail.tag);
      if (!tag) return;
      const tags = new Set(state.privateState.settings.trustedPlayerTags);
      if (detail.trusted) tags.add(tag);
      else tags.delete(tag);
      state.privateState.settings = sanitizeSettings(Object.assign({}, state.privateState.settings, {
        trustedPlayerTags: Array.from(tags),
        updatedAt: toText(detail.updatedAt).trim() || state.privateState.settings.updatedAt,
      }));
      if (detail.trusted && state.selectedTag === tag) state.selectedTag = "";
      recompute();
      render();
    };

    const init = () => {
      if (state.initialized) return;
      state.initialized = true;
      document.addEventListener("admin:tabchange", handleTabChange);
      document.addEventListener("admin:rosterdatachange", handleRosterDataChange);
      document.addEventListener("admin:warfollowuptrustchange", handleTrustChange);
      render();
    };

    const destroy = () => {
      document.removeEventListener("admin:tabchange", handleTabChange);
      document.removeEventListener("admin:rosterdatachange", handleRosterDataChange);
      document.removeEventListener("admin:warfollowuptrustchange", handleTrustChange);
      state.initialized = false;
    };

    return { init, destroy, load, render, dismissInBackground, state };
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
    discordIdentityText,
    buildPlayerDirectory,
    buildEvidenceForTag,
    buildSignals,
    buildRecoveryProgress,
    buildWatchProgress,
    buildWorkItems,
    buildDmText,
    createController,
    initialize,
  };
});
