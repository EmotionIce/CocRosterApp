(() => {
  const $ = (sel) => document.querySelector(sel);
  const toStr = (v) => (v == null ? "" : String(v));

  const state = {
    password: "",
    lastRosterData: null,
    publishCooldownUntil: 0,
    bulkRefreshBusy: false,
    rosterStatusByRoster: {},
    benchMarksByRoster: {},
    swapInMarksByRoster: {},
    suggestionNotesByRoster: {},
    pendingProfileReopen: null,
    autoRefreshSettings: null,
    autoRefreshBusy: false,
    importSession: null,
    importCompareBusy: false,
    importApplyBusy: false,
    importLoadWarning: null,
  };

  const setStatus = (msg) => {
    const el = $("#status");
    if (el) el.textContent = msg || "";
  };

  const setAddPlayerStatus = (msg, isError) => {
    const el = $("#addPlayerStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "#fca5a5" : "#6b7280";
  };

  const setAddPreviewRosterStatus = (msg, isError) => {
    const el = $("#addPreviewRosterStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "#fca5a5" : "#6b7280";
  };

  const setRosterStatus = (rosterIdRaw, msg, isError) => {
    const rosterId = toStr(rosterIdRaw).trim();
    if (!rosterId) return;
    state.rosterStatusByRoster[rosterId] = {
      msg: msg || "",
      isError: !!isError,
    };
  };

  const setClanSyncStatus = (rosterIdRaw, msg, isError) => {
    setRosterStatus(rosterIdRaw, msg, isError);
  };

  const setCwlStatus = (rosterIdRaw, msg, isError) => {
    setRosterStatus(rosterIdRaw, msg, isError);
  };

  const clearRosterStatuses = () => {
    state.rosterStatusByRoster = {};
  };

  const setLoginStatus = (msg) => {
    const el = $("#loginStatus");
    if (el) el.textContent = msg || "";
  };

  const show = (sel, on) => {
    const el = $(sel);
    if (!el) return;
    el.classList.toggle("hidden", !on);
  };

  const clearPendingProfileReopen = () => {
    state.pendingProfileReopen = null;
  };

  const jsonPretty = (obj) => {
    try { return JSON.stringify(obj, null, 2); } catch { return String(obj); }
  };

  const toErrorMessage = (err) => (err && err.message ? err.message : String(err));

  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const cloneJson = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
  const REFRESH_ALL_STEP_DELAY_MS = 1000;

  const createAsyncMutex = () => {
    let tail = Promise.resolve();
    return async (task) => {
      const previous = tail;
      let release = () => { };
      tail = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await task();
      } finally {
        release();
      }
    };
  };

  const runExclusiveRosterPoolRefresh = createAsyncMutex();

  const normalizeTag = (tag) => {
    const t = toStr(tag).trim().toUpperCase();
    if (!t) return "";
    return t.startsWith("#") ? t : ("#" + t);
  };

  const isValidCocTag = (tagRaw) => /^#[PYLQGRJCUV0289]{3,15}$/.test(normalizeTag(tagRaw));

  const getRosterTrackingMode = (rosterRaw) =>
    rosterRaw && rosterRaw.trackingMode === "regularWar" ? "regularWar" : "cwl";

  const normalizeNotes = (rawNotes) => {
    if (Array.isArray(rawNotes)) {
      return rawNotes.map((n) => toStr(n).trim()).filter(Boolean);
    }
    const one = toStr(rawNotes).trim();
    return one ? [one] : [];
  };

  const toBoolFlag = (value) => {
    if (value === true || value === false) return value;
    const text = toStr(value).trim().toLowerCase();
    if (!text) return false;
    return text === "true" || text === "1" || text === "yes" || text === "on";
  };

  const normalizePlayerFlagsInPlace = (player) => {
    if (!player || typeof player !== "object") return player;
    player.excludeAsSwapTarget = toBoolFlag(player.excludeAsSwapTarget);
    player.excludeAsSwapSource = toBoolFlag(player.excludeAsSwapSource);
    return player;
  };

  const parseNotesFromTextarea = (raw) => {
    const lines = toStr(raw).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    return normalizeNotes(lines);
  };

  const setAddPreviewRosterPanelOpen = (open) => {
    const panel = $("#addPreviewRosterPanel");
    const btn = $("#toggleAddPreviewRosterPanelBtn");
    if (panel) panel.classList.toggle("hidden", !open);
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  };

  const setAddPlayerPanelOpen = (open) => {
    const panel = $("#addPlayerPanel");
    const btn = $("#toggleAddPlayerPanelBtn");
    if (panel) panel.classList.toggle("hidden", !open);
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  };

  const getRosters = () => {
    if (!state.lastRosterData || !Array.isArray(state.lastRosterData.rosters)) return [];
    return state.lastRosterData.rosters;
  };

  const normalizeRosterOrderInData_ = (rosterDataRaw) => {
    const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : null;
    if (!rosterData || !Array.isArray(rosterData.rosters)) return [];

    const rosters = rosterData.rosters;
    const rosterIndexesById = {};
    for (let i = 0; i < rosters.length; i++) {
      const rosterId = toStr(rosters[i] && rosters[i].id).trim();
      if (!rosterId) continue;
      if (!rosterIndexesById[rosterId]) rosterIndexesById[rosterId] = [];
      rosterIndexesById[rosterId].push(i);
    }

    const consumedIndexes = {};
    const orderedRosters = [];
    const pushRosterIndex = (index) => {
      if (!Number.isInteger(index) || consumedIndexes[index]) return;
      consumedIndexes[index] = true;
      orderedRosters.push(rosters[index]);
    };

    const rawRosterOrder = Array.isArray(rosterData.rosterOrder) ? rosterData.rosterOrder : [];
    for (let i = 0; i < rawRosterOrder.length; i++) {
      const rosterId = toStr(rawRosterOrder[i]).trim();
      if (!rosterId) continue;
      const queue = rosterIndexesById[rosterId];
      if (!queue || !queue.length) continue;
      pushRosterIndex(queue.shift());
    }

    for (let i = 0; i < rosters.length; i++) {
      pushRosterIndex(i);
    }
    rosterData.rosters = orderedRosters;

    const normalizedRosterOrder = [];
    const seen = {};
    for (const roster of orderedRosters) {
      const rosterId = toStr(roster && roster.id).trim();
      if (!rosterId || seen[rosterId]) continue;
      seen[rosterId] = true;
      normalizedRosterOrder.push(rosterId);
    }
    rosterData.rosterOrder = normalizedRosterOrder;
    return normalizedRosterOrder;
  };

  const syncRosterOrderFromCurrentArray_ = (rosterDataRaw) => {
    const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : null;
    if (!rosterData || !Array.isArray(rosterData.rosters)) return [];
    const out = [];
    const seen = {};
    for (const roster of rosterData.rosters) {
      const rosterId = toStr(roster && roster.id).trim();
      if (!rosterId || seen[rosterId]) continue;
      seen[rosterId] = true;
      out.push(rosterId);
    }
    rosterData.rosterOrder = out;
    return out;
  };

  const refreshRefreshAllUi = () => {
    const btn = $("#refreshAllBtn");
    if (!btn) return;
    const hasLoadedPreview = !!(state.lastRosterData && Array.isArray(state.lastRosterData.rosters) && state.lastRosterData.rosters.length);
    btn.disabled = !hasLoadedPreview || state.bulkRefreshBusy;
    btn.textContent = state.bulkRefreshBusy ? "Refreshing..." : "Refresh all";
  };

  const formatLocalTimestamp = (isoRaw) => {
    const iso = toStr(isoRaw).trim();
    if (!iso) return "";
    const parsed = new Date(iso);
    if (!parsed || Number.isNaN(parsed.getTime())) return iso;
    return parsed.toLocaleString();
  };

  const buildAutoRefreshStatusText = (settings) => {
    const cfg = settings && typeof settings === "object" ? settings : null;
    if (!cfg) return "Disabled";

    const lines = [];
    const enabled = !!cfg.enabled;
    lines.push(enabled ? "Enabled" : "Disabled");

    const lastSuccess = formatLocalTimestamp(cfg.lastSuccessfulActiveRefreshAt);
    lines.push("Last successful active refresh: " + (lastSuccess || "never"));

    const runStatus = toStr(cfg.lastRunStatus).trim().toLowerCase() || "unknown";
    const lastRunAt = formatLocalTimestamp(cfg.lastRunFinishedAt);
    lines.push("Last run: " + runStatus + (lastRunAt ? (" (" + lastRunAt + ")") : ""));

    const archiveDate = toStr(cfg.lastArchiveDate).trim();
    lines.push("Last archive date: " + (archiveDate || "none"));

    const issueSummary = toStr(cfg.lastIssueSummary).trim();
    if (issueSummary) lines.push("Last issue: " + issueSummary);

    return lines.join("\n");
  };

  const renderAutoRefreshUi = () => {
    const toggle = $("#autoRefreshToggle");
    const statusEl = $("#autoRefreshStatus");

    if (toggle) {
      const enabled = !!(state.autoRefreshSettings && state.autoRefreshSettings.enabled);
      toggle.checked = enabled;
      toggle.disabled = !state.password || state.autoRefreshBusy;
    }

    if (statusEl) {
      if (state.autoRefreshBusy) {
        statusEl.textContent = "Updating auto-refresh settings...";
        statusEl.style.color = "#94a3b8";
        return;
      }
      statusEl.textContent = buildAutoRefreshStatusText(state.autoRefreshSettings);
      const runStatus = toStr(state.autoRefreshSettings && state.autoRefreshSettings.lastRunStatus).trim().toLowerCase();
      statusEl.style.color = runStatus === "error" ? "#fca5a5" : "#94a3b8";
    }
  };

  const loadAutoRefreshSettings = async () => {
    if (!state.password) {
      state.autoRefreshSettings = null;
      renderAutoRefreshUi();
      return null;
    }
    state.autoRefreshBusy = true;
    renderAutoRefreshUi();
    try {
      const settings = await runServerMethod("getAutoRefreshSettings", [state.password]);
      state.autoRefreshSettings = settings && typeof settings === "object" ? settings : null;
      return state.autoRefreshSettings;
    } finally {
      state.autoRefreshBusy = false;
      renderAutoRefreshUi();
    }
  };

  const updateAutoRefreshEnabled = async (enabled) => {
    if (!state.password) {
      throw new Error("Unlock admin first.");
    }
    state.autoRefreshBusy = true;
    renderAutoRefreshUi();
    try {
      const settings = await runServerMethod("setAutoRefreshEnabled", [!!enabled, state.password]);
      state.autoRefreshSettings = settings && typeof settings === "object" ? settings : null;
      setStatus(enabled ? "Auto-refresh enabled." : "Auto-refresh disabled.");
      return state.autoRefreshSettings;
    } finally {
      state.autoRefreshBusy = false;
      renderAutoRefreshUi();
    }
  };

  const getRosterById = (rosterIdRaw) => {
    const rosterId = toStr(rosterIdRaw).trim();
    if (!rosterId) return null;
    return getRosters().find((roster) => toStr(roster && roster.id).trim() === rosterId) || null;
  };

  const getRosterIndexInRosterData_ = (rosterData, rosterIdRaw) => {
    const rosterId = toStr(rosterIdRaw).trim();
    const rosters = rosterData && Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
    return rosters.findIndex((roster) => toStr(roster && roster.id).trim() === rosterId);
  };

  const cloneCurrentRosterDataForServer_ = () => {
    if (!state.lastRosterData || !Array.isArray(state.lastRosterData.rosters)) {
      throw new Error("No roster preview is loaded.");
    }
    return cloneJson(state.lastRosterData);
  };

  const parseIsoMs_ = (valueRaw) => {
    const text = toStr(valueRaw).trim();
    if (!text) return 0;
    const ms = new Date(text).getTime();
    return Number.isFinite(ms) ? ms : 0;
  };

  const getMetricEntryEvidenceMs_ = (entryRaw) => {
    const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
    const lastSeen = entry.lastSeen && typeof entry.lastSeen === "object" ? entry.lastSeen : {};
    const latestSnapshot = entry.latestSnapshot && typeof entry.latestSnapshot === "object" ? entry.latestSnapshot : {};
    let best = 0;
    const keepBest = (valueRaw) => {
      const ms = parseIsoMs_(valueRaw);
      if (ms > best) best = ms;
    };
    keepBest(lastSeen.at);
    keepBest(latestSnapshot.capturedAt);
    return best;
  };

  const mergePlayerMetricsStore_ = (currentRaw, incomingRaw) => {
    const current = currentRaw && typeof currentRaw === "object" ? currentRaw : null;
    const incoming = incomingRaw && typeof incomingRaw === "object" ? incomingRaw : null;
    if (!incoming) return current ? cloneJson(current) : null;

    const currentByTag = current && current.byTag && typeof current.byTag === "object" ? current.byTag : {};
    const incomingByTag = incoming.byTag && typeof incoming.byTag === "object" ? incoming.byTag : {};
    const incomingKeys = Object.keys(incomingByTag);
    if (!incomingKeys.length) return current ? cloneJson(current) : cloneJson(incoming);

    const merged = current ? cloneJson(current) : { schemaVersion: 1, updatedAt: "", byTag: {} };
    if (!merged.byTag || typeof merged.byTag !== "object") merged.byTag = {};
    for (let i = 0; i < incomingKeys.length; i++) {
      const tag = incomingKeys[i];
      const currentEntry = currentByTag[tag];
      const incomingEntry = incomingByTag[tag];
      if (!currentEntry) {
        merged.byTag[tag] = cloneJson(incomingEntry);
        continue;
      }
      const currentEntryMs = getMetricEntryEvidenceMs_(currentEntry);
      const incomingEntryMs = getMetricEntryEvidenceMs_(incomingEntry);
      if (!currentEntryMs || incomingEntryMs >= currentEntryMs) {
        merged.byTag[tag] = cloneJson(incomingEntry);
      }
    }

    if (Number.isFinite(Number(incoming.schemaVersion))) {
      merged.schemaVersion = Number(incoming.schemaVersion);
    }

    const currentUpdatedMs = parseIsoMs_(current && current.updatedAt);
    const incomingUpdatedMs = parseIsoMs_(incoming && incoming.updatedAt);
    const incomingUpdatedAt = toStr(incoming.updatedAt).trim();
    if (incomingUpdatedAt) {
      const mergedUpdatedMs = parseIsoMs_(merged.updatedAt);
      if (!mergedUpdatedMs || (incomingUpdatedMs > 0 && incomingUpdatedMs >= mergedUpdatedMs)) {
        merged.updatedAt = incomingUpdatedAt;
      }
    } else if (!toStr(merged.updatedAt).trim() && currentUpdatedMs > 0) {
      merged.updatedAt = toStr(current.updatedAt).trim();
    }

    return merged;
  };

  const applyMergedRosterPreview = (rosterIdRaw, nextRosterData, statusMsg) => {
    const rosterId = toStr(rosterIdRaw).trim();
    if (!rosterId) {
      throw new Error("Roster ID is required.");
    }
    if (!nextRosterData || !Array.isArray(nextRosterData.rosters)) {
      throw new Error("Sync returned invalid roster data.");
    }
    if (!state.lastRosterData || !Array.isArray(state.lastRosterData.rosters)) {
      throw new Error("No roster preview is loaded.");
    }

    const nextRosterIndex = getRosterIndexInRosterData_(nextRosterData, rosterId);
    if (nextRosterIndex < 0) {
      throw new Error("Sync returned no roster for " + rosterId + ".");
    }

    const mergedRosterData = cloneJson(state.lastRosterData);
    const targetRosterIndex = getRosterIndexInRosterData_(mergedRosterData, rosterId);
    if (targetRosterIndex < 0) {
      throw new Error("Roster not found in current preview: " + rosterId);
    }

    mergedRosterData.rosters[targetRosterIndex] = cloneJson(nextRosterData.rosters[nextRosterIndex]);
    if (typeof nextRosterData.pageTitle === "string") {
      mergedRosterData.pageTitle = nextRosterData.pageTitle;
    }
    if (Number.isFinite(Number(nextRosterData.schemaVersion))) {
      mergedRosterData.schemaVersion = Number(nextRosterData.schemaVersion);
    }
    if (Array.isArray(nextRosterData.rosterOrder)) {
      mergedRosterData.rosterOrder = cloneJson(nextRosterData.rosterOrder);
    }
    if (typeof nextRosterData.lastUpdatedAt === "string") {
      mergedRosterData.lastUpdatedAt = nextRosterData.lastUpdatedAt;
    }
    const mergedPlayerMetrics = mergePlayerMetricsStore_(mergedRosterData.playerMetrics, nextRosterData.playerMetrics);
    if (mergedPlayerMetrics) {
      mergedRosterData.playerMetrics = mergedPlayerMetrics;
    }

    state.lastRosterData = mergedRosterData;
    normalizeRosterOrderInData_(state.lastRosterData);
    reindexAllRosters();
    renderPreviewFromState();
    markReportStale();
    const publishBtn = $("#publishBtn");
    if (publishBtn) publishBtn.disabled = false;
    if (statusMsg) setStatus(statusMsg);
  };

  const findRosterPlayerByTag = (rosterIdRaw, tagRaw) => {
    const roster = getRosterById(rosterIdRaw);
    const tag = normalizeTag(tagRaw);
    if (!roster || !tag) return null;
    ensureRosterArrays(roster);
    return roster.main.concat(roster.subs, roster.missing).find((player) => normalizeTag(player && player.tag) === tag) || null;
  };

  const formatPlayerDisplayLabel = (rosterIdRaw, tagRaw) => {
    const tag = normalizeTag(tagRaw);
    if (!tag) return "";
    const player = findRosterPlayerByTag(rosterIdRaw, tag);
    const name = toStr(player && player.name).trim();
    return name ? (name + " (" + tag + ")") : tag;
  };

  const formatRosterDisplayLabel = (rosterIdRaw) => {
    const rosterId = toStr(rosterIdRaw).trim();
    if (!rosterId) return "";
    const roster = getRosterById(rosterId);
    const title = toStr(roster && roster.title).trim();
    return title ? (title + " (" + rosterId + ")") : rosterId;
  };

  const persistClanSyncTagInputs = () => {
    const inputs = Array.from(document.querySelectorAll('#connectedRostersTable [data-clan-sync-tag-input="1"]'));
    for (const input of inputs) {
      const rosterId = toStr(input && input.dataset && input.dataset.rosterId).trim();
      const roster = getRosterById(rosterId);
      if (!roster) continue;
      const normalized = normalizeTag(input && input.value);
      input.value = normalized;
      roster.connectedClanTag = normalized;
    }
  };

  const formatMemberTrackingStatus = (memberTrackingRaw) => {
    const data = memberTrackingRaw && typeof memberTrackingRaw === "object" ? memberTrackingRaw : {};
    const recorded = Number.isFinite(Number(data.recorded)) ? Number(data.recorded) : 0;
    const updated = Number.isFinite(Number(data.updated)) ? Number(data.updated) : 0;
    const profileEnriched = Number.isFinite(Number(data.profileEnriched)) ? Number(data.profileEnriched) : 0;
    const attemptedClans = Number.isFinite(Number(data.attemptedClans)) ? Number(data.attemptedClans) : 0;
    const capturedClans = Number.isFinite(Number(data.capturedClans)) ? Number(data.capturedClans) : 0;
    const errors = Array.isArray(data.errors) ? data.errors : [];
    const base = "memberTracking recorded " + recorded + ", updated " + updated + (profileEnriched > 0 ? (", profileEnriched " + profileEnriched) : "") + (attemptedClans > 0 ? (", clans " + capturedClans + "/" + attemptedClans) : "");
    if (!errors.length) return base;
    return base + ", errors " + errors.length;
  };

  const formatRosterPoolStatus = (result) => {
    const data = result && typeof result === "object" ? result : {};
    const mode = toStr(data.mode).trim() === "regularWar" ? "regularWar" : "cwl";
    const added = Number.isFinite(Number(data.added)) ? Number(data.added) : 0;
    const removed = Number.isFinite(Number(data.removed)) ? Number(data.removed) : 0;
    const updated = Number.isFinite(Number(data.updated)) ? Number(data.updated) : 0;
    const sourceUsed = toStr(data.sourceUsed).trim() || "members";
    const memberTrackingText = data.memberTracking ? (", " + formatMemberTrackingStatus(data.memberTracking)) : "";
    if (mode === "regularWar") {
      const movedToMissing = Number.isFinite(Number(data.movedToMissing)) ? Number(data.movedToMissing) : 0;
      const restored = Number.isFinite(Number(data.restored)) ? Number(data.restored) : 0;
      const retainedMissing = Number.isFinite(Number(data.retainedMissing)) ? Number(data.retainedMissing) : 0;
      return "added " + added + ", removed " + removed + ", updated " + updated + ", movedToMissing " + movedToMissing + ", restored " + restored + ", retainedMissing " + retainedMissing + ", sourceUsed " + sourceUsed + memberTrackingText;
    }
    return "added " + added + ", removed " + removed + ", updated " + updated + ", sourceUsed " + sourceUsed + memberTrackingText;
  };

  const formatTodayLineupStatus = (result) => {
    const data = result && typeof result === "object" ? result : {};
    const mode = toStr(data.mode).trim() === "regularWar" ? "regularWar" : "cwl";
    const activeSet = Number.isFinite(Number(data.activeSet)) ? Number(data.activeSet) : 0;
    const benched = Number.isFinite(Number(data.benched)) ? Number(data.benched) : 0;
    const missing = Number.isFinite(Number(data.missing)) ? Number(data.missing) : 0;
    const updated = Number.isFinite(Number(data.updated)) ? Number(data.updated) : 0;
    const msg = toStr(data.message).trim();
    if (mode === "regularWar") {
      if (toStr(data.unavailableReason).trim() === "privateWarLog") {
        return "lineup unchanged, private war log";
      }
      return "in war " + activeSet + ", out of war " + benched + ", missing " + missing + ", updated " + updated + (msg ? (" (" + msg + ")") : "");
    }
    return "active set " + activeSet + ", benched " + benched + ", updated " + updated + (msg ? (" (" + msg + ")") : "");
  };

  const formatTrackingRefreshStatus = (result) => {
    const data = result && typeof result === "object" ? result : {};
    const mode = toStr(data.mode).trim() === "regularWar" ? "regularWar" : "cwl";
    const warsProcessed = Number.isFinite(Number(data.warsProcessed)) ? Number(data.warsProcessed) : 0;
    const playersTracked = Number.isFinite(Number(data.playersTracked)) ? Number(data.playersTracked) : 0;
    const memberTrackingText = data.memberTracking ? (", " + formatMemberTrackingStatus(data.memberTracking)) : "";
    if (mode === "regularWar") {
      const currentUnavailable = toStr(data.currentWarUnavailableReason).trim() === "privateWarLog";
      const aggregateUnavailable = toStr(data.aggregateUnavailableReason).trim() === "privateWarLog";
      if (currentUnavailable && aggregateUnavailable) {
        return "live war unavailable, aggregate stale (private war log)" + memberTrackingText;
      }
      if (currentUnavailable) {
        return "live war unavailable (private war log), aggregate refreshed" + memberTrackingText;
      }
      if (aggregateUnavailable) {
        return "live war ok, aggregate stale (private war log)" + memberTrackingText;
      }
      const currentWarState = toStr(data.currentWarState).trim().toLowerCase() || "notinwar";
      const warLogAvailable = !!data.warLogAvailable;
      const teamSize = Number.isFinite(Number(data.teamSize)) ? Number(data.teamSize) : 0;
      const attacksPerMember = Number.isFinite(Number(data.attacksPerMember)) ? Number(data.attacksPerMember) : 0;
      return "state " + currentWarState + ", playersTracked " + playersTracked + ", warsProcessed " + warsProcessed + ", warLogAvailable " + (warLogAvailable ? "yes" : "no") + ", teamSize " + teamSize + ", attacksPerMember " + attacksPerMember + memberTrackingText;
    }
    return "warsProcessed " + warsProcessed + ", playersTracked " + playersTracked + memberTrackingText;
  };

  const applySuggestionTagsToState_ = (rosterIdRaw, benchTagsRaw, swapInTagsRaw, pairsRaw) => {
    const rosterId = toStr(rosterIdRaw).trim();
    if (!rosterId) {
      return;
    }

    const benchTags = Array.isArray(benchTagsRaw) ? benchTagsRaw : [];
    const swapInTags = Array.isArray(swapInTagsRaw) ? swapInTagsRaw : [];
    const pairs = Array.isArray(pairsRaw) ? pairsRaw : [];
    const nextBenchMarks = {};
    const nextSwapInMarks = {};
    const nextSuggestionNotes = {};

    for (const tag of benchTags) {
      const normalizedTag = normalizeTag(tag);
      if (!normalizedTag) continue;
      nextBenchMarks[normalizedTag] = true;
    }
    for (const tag of swapInTags) {
      const normalizedTag = normalizeTag(tag);
      if (!normalizedTag) continue;
      nextSwapInMarks[normalizedTag] = true;
    }
    for (const pair of pairs) {
      const outTag = normalizeTag(pair && pair.outTag);
      const inTag = normalizeTag(pair && pair.inTag);
      const reasonText = toStr(pair && pair.reasonText).trim();
      if (!outTag || !inTag || !reasonText) continue;
      const outLabel = formatPlayerDisplayLabel(rosterId, outTag);
      const inLabel = formatPlayerDisplayLabel(rosterId, inTag);
      nextSuggestionNotes[outTag] = "swap with " + inLabel + ": " + reasonText;
      nextSuggestionNotes[inTag] = "swap with " + outLabel + ": " + reasonText;
    }

    if (Object.keys(nextBenchMarks).length) {
      state.benchMarksByRoster[rosterId] = nextBenchMarks;
    } else {
      delete state.benchMarksByRoster[rosterId];
    }
    if (Object.keys(nextSwapInMarks).length) {
      state.swapInMarksByRoster[rosterId] = nextSwapInMarks;
    } else {
      delete state.swapInMarksByRoster[rosterId];
    }
    if (Object.keys(nextSuggestionNotes).length) {
      state.suggestionNotesByRoster[rosterId] = nextSuggestionNotes;
    } else {
      delete state.suggestionNotesByRoster[rosterId];
    }
  };

  const applySuggestionResponseToState = (rosterIdRaw, res) => {
    const rosterId = toStr(rosterIdRaw).trim();
    if (!rosterId) {
      return { benchCount: 0, swapCount: 0, needsRewardsCount: 0 };
    }

    const result = res && res.result ? res.result : {};
    const pairs = Array.isArray(res && res.pairs) ? res.pairs : [];
    applySuggestionTagsToState_(
      rosterId,
      res && res.benchTags,
      res && res.swapInTags,
      pairs
    );

    applyBenchMarks_();

    return {
      benchCount: Number.isFinite(Number(result.benchCount)) ? Number(result.benchCount) : 0,
      swapCount: Number.isFinite(Number(result.swapCount)) ? Number(result.swapCount) : pairs.length,
      needsRewardsCount: Number.isFinite(Number(result.needsRewardsCount)) ? Number(result.needsRewardsCount) : 0,
    };
  };

  const syncSuggestionStateFromRosterData_ = () => {
    state.benchMarksByRoster = {};
    state.swapInMarksByRoster = {};
    state.suggestionNotesByRoster = {};

    const rosters = getRosters();
    for (const roster of rosters) {
      const rosterId = toStr(roster && roster.id).trim();
      if (!rosterId) continue;
      if (getRosterTrackingMode(roster) !== "cwl") continue;
      const suggestions = roster && typeof roster === "object" ? roster.benchSuggestions : null;
      if (!suggestions || typeof suggestions !== "object") continue;
      applySuggestionTagsToState_(
        rosterId,
        suggestions.benchTags,
        suggestions.swapInTags,
        suggestions.pairs
      );
    }
  };

  const clearSavedBenchSuggestionsForRoster_ = (rosterIdRaw) => {
    const rosterId = toStr(rosterIdRaw).trim();
    if (!rosterId) return;
    const roster = getRosterById(rosterId);
    if (!roster || typeof roster !== "object") return;
    if (Object.prototype.hasOwnProperty.call(roster, "benchSuggestions")) {
      delete roster.benchSuggestions;
    }
  };

  const clearSavedBenchSuggestionsFromPreview_ = () => {
    const rosters = getRosters();
    for (const roster of rosters) {
      if (!roster || typeof roster !== "object") continue;
      if (Object.prototype.hasOwnProperty.call(roster, "benchSuggestions")) {
        delete roster.benchSuggestions;
      }
    }
  };

  const formatSuggestionStatus = (summary) => {
    const data = summary && typeof summary === "object" ? summary : {};
    const benchCount = Number.isFinite(Number(data.benchCount)) ? Number(data.benchCount) : 0;
    const swapCount = Number.isFinite(Number(data.swapCount)) ? Number(data.swapCount) : 0;
    const needsRewardsCount = Number.isFinite(Number(data.needsRewardsCount)) ? Number(data.needsRewardsCount) : 0;
    return "swapCount " + swapCount + ", benchCount " + benchCount + ", needsRewardsCount " + needsRewardsCount;
  };

  const refreshAddPreviewRosterUi = () => {
    const addBtn = $("#addPreviewRosterBtn");
    const hint = $("#addPreviewRosterHint");
    const toggleBtn = $("#toggleAddPreviewRosterPanelBtn");
    if (!addBtn) return;

    const hasLoadedPreview = !!(state.lastRosterData && Array.isArray(state.lastRosterData.rosters));
    addBtn.disabled = !hasLoadedPreview;
    if (toggleBtn) toggleBtn.disabled = !hasLoadedPreview;

    if (!hasLoadedPreview) {
      setAddPreviewRosterPanelOpen(false);
      if (hint) hint.textContent = "Load active config first.";
      return;
    }

    if (hint) hint.textContent = "Creates a new empty roster in the current preview.";
  };

  const refreshAddPlayerUi = () => {
    const rosterSelect = $("#addPlayerRoster");
    const addBtn = $("#addPlayerBtn");
    const hint = $("#addPlayerHint");
    const toggleBtn = $("#toggleAddPlayerPanelBtn");
    if (!rosterSelect || !addBtn) return;

    const rosters = getRosters().filter((r) => toStr(r && r.id).trim());
    const prevSelected = toStr(rosterSelect.value).trim();
    rosterSelect.textContent = "";

    if (!rosters.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No roster loaded";
      rosterSelect.appendChild(option);
      rosterSelect.disabled = true;
      addBtn.disabled = true;
      if (toggleBtn) toggleBtn.disabled = true;
      setAddPlayerPanelOpen(false);
      if (hint) hint.textContent = "Load active config first.";
      return;
    }

    for (const roster of rosters) {
      const id = toStr(roster && roster.id).trim();
      const title = toStr(roster && roster.title).trim();
      const option = document.createElement("option");
      option.value = id;
      option.textContent = title ? (title + " (" + id + ")") : id;
      rosterSelect.appendChild(option);
    }

    if (prevSelected && rosters.some((r) => toStr(r && r.id).trim() === prevSelected)) {
      rosterSelect.value = prevSelected;
    }

    const updateModeHint = () => {
      if (!hint) return;
      const selectedId = toStr(rosterSelect.value).trim();
      const liveRosters = getRosters().filter((r) => toStr(r && r.id).trim());
      const selectedRoster =
        liveRosters.find((r) => toStr(r && r.id).trim() === selectedId) ||
        (liveRosters.length ? liveRosters[0] : null);
      const mode = getRosterTrackingMode(selectedRoster);
      hint.textContent = mode === "regularWar"
        ? "Adds the new player to the out-of-war section of the selected roster."
        : "Adds the new player to main slots of the selected roster.";
    };
    rosterSelect.onchange = updateModeHint;

    rosterSelect.disabled = false;
    addBtn.disabled = false;
    if (toggleBtn) toggleBtn.disabled = false;
    updateModeHint();
  };

  const ensureRosterArrays = (roster) => {
    if (!roster || typeof roster !== "object") return;
    roster.trackingMode = getRosterTrackingMode(roster);
    if (!Array.isArray(roster.main)) roster.main = [];
    if (!Array.isArray(roster.subs)) roster.subs = [];
    if (!Array.isArray(roster.missing)) roster.missing = [];
  };

  const reindexRoster = (roster) => {
    if (!roster || typeof roster !== "object") return;
    ensureRosterArrays(roster);

    roster.main = roster.main.filter((p) => p && typeof p === "object");
    roster.subs = roster.subs.filter((p) => p && typeof p === "object");
    roster.missing = roster.missing.filter((p) => p && typeof p === "object");

    for (let i = 0; i < roster.main.length; i++) {
      roster.main[i].slot = i + 1;
      roster.main[i].notes = normalizeNotes(roster.main[i].notes != null ? roster.main[i].notes : roster.main[i].note);
      normalizePlayerFlagsInPlace(roster.main[i]);
      if (Object.prototype.hasOwnProperty.call(roster.main[i], "note")) delete roster.main[i].note;
    }
    for (let i = 0; i < roster.subs.length; i++) {
      roster.subs[i].slot = null;
      roster.subs[i].notes = normalizeNotes(roster.subs[i].notes != null ? roster.subs[i].notes : roster.subs[i].note);
      normalizePlayerFlagsInPlace(roster.subs[i]);
      if (Object.prototype.hasOwnProperty.call(roster.subs[i], "note")) delete roster.subs[i].note;
    }
    for (let i = 0; i < roster.missing.length; i++) {
      roster.missing[i].slot = null;
      roster.missing[i].notes = normalizeNotes(roster.missing[i].notes != null ? roster.missing[i].notes : roster.missing[i].note);
      normalizePlayerFlagsInPlace(roster.missing[i]);
      if (Object.prototype.hasOwnProperty.call(roster.missing[i], "note")) delete roster.missing[i].note;
    }

    roster.badges = { main: roster.main.length, subs: roster.subs.length, missing: roster.missing.length };
  };

  const reindexAllRosters = () => {
    const rosters = getRosters();
    for (const roster of rosters) reindexRoster(roster);
  };

  const pruneBenchMarks_ = () => {
    const rosters = getRosters();
    if (!rosters.length) {
      state.benchMarksByRoster = {};
      state.swapInMarksByRoster = {};
      state.suggestionNotesByRoster = {};
      return;
    }

    const nextMarksByRoster = {};
    const nextSwapInMarksByRoster = {};
    const nextSuggestionNotesByRoster = {};
    for (const roster of rosters) {
      const rosterId = toStr(roster && roster.id).trim();
      if (!rosterId) continue;

      ensureRosterArrays(roster);
      const tagSet = {};
      for (const player of roster.main.concat(roster.subs, roster.missing)) {
        const tag = normalizeTag(player && player.tag);
        if (!tag) continue;
        tagSet[tag] = true;
      }

      const pruneTagMap = (source) => {
        const kept = {};
        const map = source && typeof source === "object" ? source : {};
        for (const tag of Object.keys(map)) {
          const normalizedTag = normalizeTag(tag);
          if (!normalizedTag || !tagSet[normalizedTag]) continue;
          kept[normalizedTag] = true;
        }
        return kept;
      };

      const benchKept = pruneTagMap(state.benchMarksByRoster[rosterId]);
      const swapInKept = pruneTagMap(state.swapInMarksByRoster[rosterId]);
      const notesSource = state.suggestionNotesByRoster[rosterId];
      const noteKept = {};
      if (notesSource && typeof notesSource === "object") {
        for (const tag of Object.keys(notesSource)) {
          const normalizedTag = normalizeTag(tag);
          if (!normalizedTag || !tagSet[normalizedTag]) continue;
          const noteText = toStr(notesSource[tag]).trim();
          if (!noteText) continue;
          noteKept[normalizedTag] = noteText;
        }
      }

      if (Object.keys(benchKept).length) nextMarksByRoster[rosterId] = benchKept;
      if (Object.keys(swapInKept).length) nextSwapInMarksByRoster[rosterId] = swapInKept;
      if (Object.keys(noteKept).length) nextSuggestionNotesByRoster[rosterId] = noteKept;
    }

    state.benchMarksByRoster = nextMarksByRoster;
    state.swapInMarksByRoster = nextSwapInMarksByRoster;
    state.suggestionNotesByRoster = nextSuggestionNotesByRoster;
  };

  const applyBenchMarks_ = () => {
    pruneBenchMarks_();

    const players = Array.from(document.querySelectorAll(".player[data-roster-id]"));
    for (const playerNode of players) {
      playerNode.classList.remove("suggest-bench");
      playerNode.classList.remove("suggest-in");
      const noteNode = playerNode.querySelector(".player-suggest-note");
      if (noteNode) noteNode.remove();
    }

    for (const playerNode of players) {
      const rosterId = toStr(playerNode && playerNode.dataset && playerNode.dataset.rosterId).trim();
      const tag = normalizeTag(playerNode && playerNode.dataset && playerNode.dataset.tag);
      if (!rosterId || !tag) continue;
      const roster = getRosterById(rosterId);
      if (getRosterTrackingMode(roster) !== "cwl") continue;
      if (state.benchMarksByRoster[rosterId] && state.benchMarksByRoster[rosterId][tag]) {
        playerNode.classList.add("suggest-bench");
      }
      if (state.swapInMarksByRoster[rosterId] && state.swapInMarksByRoster[rosterId][tag]) {
        playerNode.classList.add("suggest-in");
      }

      const suggestionText = toStr(
        state.suggestionNotesByRoster[rosterId] && state.suggestionNotesByRoster[rosterId][tag]
      ).trim();
      if (!suggestionText) continue;

      const noteNode = document.createElement("div");
      noteNode.className = "player-suggest-note";
      noteNode.textContent = suggestionText;

      const actionsNode = playerNode.querySelector(".player-admin-actions");
      if (actionsNode && actionsNode.parentNode === playerNode) {
        playerNode.insertBefore(noteNode, actionsNode);
      } else {
        playerNode.appendChild(noteNode);
      }
    }
  };

  const clearSuggestionMarks_ = () => {
    state.benchMarksByRoster = {};
    state.swapInMarksByRoster = {};
    state.suggestionNotesByRoster = {};
  };

  const clearSuggestionMarksForRoster_ = (rosterIdRaw) => {
    const rosterId = toStr(rosterIdRaw).trim();
    if (!rosterId) return;
    delete state.benchMarksByRoster[rosterId];
    delete state.swapInMarksByRoster[rosterId];
    delete state.suggestionNotesByRoster[rosterId];
  };

  const renderPreviewFromState = () => {
    if (!window.renderRosterData) return;
    if (!state.lastRosterData || !Array.isArray(state.lastRosterData.rosters)) {
      window.renderRosterData({ pageTitle: "Roster Admin", rosters: [] });
      refreshAddPreviewRosterUi();
      refreshAddPlayerUi();
      refreshRefreshAllUi();
      renderConnectedRostersTable();
      renderImportUi();
      applyBenchMarks_();
      return;
    }
    normalizeRosterOrderInData_(state.lastRosterData);
    syncSuggestionStateFromRosterData_();
    window.renderRosterData(state.lastRosterData);
    refreshAddPreviewRosterUi();
    refreshAddPlayerUi();
    refreshRefreshAllUi();
    renderConnectedRostersTable();
    renderImportUi();
    applyBenchMarks_();
  };

  const markReportStale = (reasonRaw) => {
    const reason = toStr(reasonRaw).trim() || "Preview changed. Re-run compare with preview before applying XLSX updates.";
    if (!state.importSession || !state.importSession.comparison) return;
    state.importSession.stale = true;
    state.importSession.staleReason = reason;
    renderImportUi();
  };

  const applyPreviewMutation = (msg) => {
    syncRosterOrderFromCurrentArray_(state.lastRosterData);
    normalizeRosterOrderInData_(state.lastRosterData);
    reindexAllRosters();
    clearSavedBenchSuggestionsFromPreview_();
    clearSuggestionMarks_();
    renderPreviewFromState();
    markReportStale();
    const publishBtn = $("#publishBtn");
    if (publishBtn) publishBtn.disabled = false;
    setStatus(msg || "Preview updated.");
  };

  const findPlayerLocationByTag = (tagRaw) => {
    const tag = normalizeTag(tagRaw);
    if (!tag) return null;

    const rosters = getRosters();
    for (let rIdx = 0; rIdx < rosters.length; rIdx++) {
      const roster = rosters[rIdx];
      ensureRosterArrays(roster);

      for (let i = 0; i < roster.main.length; i++) {
        if (normalizeTag(roster.main[i] && roster.main[i].tag) === tag) {
          return { rosterIndex: rIdx, role: "main", index: i };
        }
      }

      for (let i = 0; i < roster.subs.length; i++) {
        if (normalizeTag(roster.subs[i] && roster.subs[i].tag) === tag) {
          return { rosterIndex: rIdx, role: "sub", index: i };
        }
      }
      for (let i = 0; i < roster.missing.length; i++) {
        if (normalizeTag(roster.missing[i] && roster.missing[i].tag) === tag) {
          return { rosterIndex: rIdx, role: "missing", index: i };
        }
      }
    }

    return null;
  };

  const movePlayerToRoster = (playerTagRaw, targetRosterIdRaw) => {
    const rosters = getRosters();
    if (!rosters.length) throw new Error("No roster preview is loaded.");

    const playerTag = normalizeTag(playerTagRaw);
    const targetRosterId = toStr(targetRosterIdRaw).trim();
    if (!playerTag) throw new Error("Player tag is missing.");
    if (!targetRosterId) throw new Error("Select a target roster.");

    const sourceLoc = findPlayerLocationByTag(playerTag);
    if (!sourceLoc) throw new Error("Player not found: " + playerTag);

    const targetIndex = rosters.findIndex((r) => toStr(r && r.id).trim() === targetRosterId);
    if (targetIndex < 0) throw new Error("Target roster does not exist: " + targetRosterId);
    if (targetIndex === sourceLoc.rosterIndex) throw new Error("Player is already in this roster.");

    const sourceRoster = rosters[sourceLoc.rosterIndex];
    const targetRoster = rosters[targetIndex];
    ensureRosterArrays(sourceRoster);
    ensureRosterArrays(targetRoster);

    const sourceList =
      sourceLoc.role === "main" ? sourceRoster.main : (sourceLoc.role === "sub" ? sourceRoster.subs : sourceRoster.missing);
    const targetList = sourceLoc.role === "main" ? targetRoster.main : targetRoster.subs;
    const removed = sourceList.splice(sourceLoc.index, 1);
    const player = removed[0];
    if (!player) throw new Error("Failed to move player: " + playerTag);

    targetList.push(player);

    const targetName = toStr(targetRoster.title).trim() || toStr(targetRoster.id).trim() || "target roster";
    applyPreviewMutation(playerTag + " moved to " + targetName + ".");
  };

  const removePlayerFromPreview = (playerTagRaw) => {
    const rosters = getRosters();
    if (!rosters.length) throw new Error("No roster preview is loaded.");

    const playerTag = normalizeTag(playerTagRaw);
    if (!playerTag) throw new Error("Player tag is missing.");

    const loc = findPlayerLocationByTag(playerTag);
    if (!loc) throw new Error("Player not found: " + playerTag);

    const roster = rosters[loc.rosterIndex];
    ensureRosterArrays(roster);
    const list = loc.role === "main" ? roster.main : (loc.role === "sub" ? roster.subs : roster.missing);
    const removed = list.splice(loc.index, 1);
    if (!removed.length) throw new Error("Failed to remove player: " + playerTag);

    applyPreviewMutation(playerTag + " removed from preview.");
  };

  const updatePlayerInfo = (currentTagRaw, draft) => {
    const rosters = getRosters();
    if (!rosters.length) throw new Error("No roster preview is loaded.");

    const currentTag = normalizeTag(currentTagRaw);
    if (!currentTag) throw new Error("Current player tag is missing.");

    const loc = findPlayerLocationByTag(currentTag);
    if (!loc) throw new Error("Player not found: " + currentTag);

    const nextTag = normalizeTag(draft && draft.tag);
    if (!nextTag) throw new Error("Tag is required.");
    if (!isValidCocTag(nextTag)) {
      throw new Error("Tag is invalid. Allowed tag alphabet: P,Y,L,Q,G,R,J,C,U,V,0,2,8,9.");
    }

    if (nextTag !== currentTag && findPlayerLocationByTag(nextTag)) {
      throw new Error("Another player already uses this tag: " + nextTag);
    }

    const th = parseInt(toStr(draft && draft.th).trim(), 10);
    if (!Number.isFinite(th)) throw new Error("TH must be a whole number.");

    const roster = rosters[loc.rosterIndex];
    ensureRosterArrays(roster);
    const list = loc.role === "main" ? roster.main : (loc.role === "sub" ? roster.subs : roster.missing);
    const player = list[loc.index];
    if (!player || typeof player !== "object") throw new Error("Failed to edit player record.");
    normalizePlayerFlagsInPlace(player);

    player.name = toStr(draft && draft.name).trim() || "(no name)";
    player.discord = toStr(draft && draft.discord).trim();
    player.th = th;
    player.tag = nextTag;
    player.notes = normalizeNotes(draft && draft.notes);

    const shouldReopenProfile = !!(
      state.pendingProfileReopen &&
      normalizeTag(state.pendingProfileReopen.tag) === currentTag
    );
    const rosterId = toStr(roster && roster.id).trim();
    clearPendingProfileReopen();
    applyPreviewMutation(nextTag + " updated.");

    if (shouldReopenProfile && typeof window !== "undefined" && typeof window.ROSTER_OPEN_PLAYER_PROFILE === "function") {
      setTimeout(() => {
        window.ROSTER_OPEN_PLAYER_PROFILE({ tag: nextTag, rosterId });
      }, 0);
    }
  };

  const setPlayerSwapExclusionFlag = (playerTagRaw, flagName, nextValue) => {
    const playerTag = normalizeTag(playerTagRaw);
    if (!playerTag) throw new Error("Player tag is missing.");
    if (flagName !== "excludeAsSwapTarget" && flagName !== "excludeAsSwapSource") {
      throw new Error("Unsupported player exclusion flag: " + flagName);
    }

    const loc = findPlayerLocationByTag(playerTag);
    if (!loc) throw new Error("Player not found: " + playerTag);

    const rosters = getRosters();
    const roster = rosters[loc.rosterIndex];
    ensureRosterArrays(roster);
    const list = loc.role === "main" ? roster.main : (loc.role === "sub" ? roster.subs : roster.missing);
    const player = list[loc.index];
    if (!player || typeof player !== "object") throw new Error("Failed to update player record.");

    normalizePlayerFlagsInPlace(player);
    player[flagName] = !!nextValue;

    const label = flagName === "excludeAsSwapTarget" ? "swap target" : "swap source";
    const stateLabel = player[flagName] ? "disabled" : "enabled";
    applyPreviewMutation(playerTag + " " + label + " " + stateLabel + ".");
  };

  const addPlayerToPreview = (draft) => {
    const rosters = getRosters();
    if (!rosters.length) throw new Error("No roster preview is loaded.");

    const rosterId = toStr(draft && draft.rosterId).trim();
    if (!rosterId) throw new Error("Select a roster.");

    const targetRoster = rosters.find((r) => toStr(r && r.id).trim() === rosterId);
    if (!targetRoster) throw new Error("Selected roster does not exist: " + rosterId);
    ensureRosterArrays(targetRoster);
    const trackingMode = getRosterTrackingMode(targetRoster);

    const tag = normalizeTag(draft && draft.tag);
    if (!tag) throw new Error("Tag is required.");
    if (!isValidCocTag(tag)) {
      throw new Error("Tag is invalid. Allowed tag alphabet: P,Y,L,Q,G,R,J,C,U,V,0,2,8,9.");
    }
    if (findPlayerLocationByTag(tag)) {
      throw new Error("Another player already uses this tag: " + tag);
    }

    const th = parseInt(toStr(draft && draft.th).trim(), 10);
    if (!Number.isFinite(th)) throw new Error("TH must be a whole number.");

    const targetList = trackingMode === "regularWar" ? targetRoster.subs : targetRoster.main;
    targetList.push({
      slot: null,
      name: toStr(draft && draft.name).trim() || "(no name)",
      discord: toStr(draft && draft.discord).trim(),
      th,
      tag,
      notes: normalizeNotes(draft && draft.notes),
      excludeAsSwapTarget: false,
      excludeAsSwapSource: false,
    });

    const targetName = toStr(targetRoster.title).trim() || rosterId;
    applyPreviewMutation(tag + " added to " + targetName + ".");
  };

  const addRosterToPreview = (draft) => {
    if (!state.lastRosterData || !Array.isArray(state.lastRosterData.rosters)) {
      throw new Error("No roster preview is loaded.");
    }

    const rosterId = toStr(draft && draft.id).trim();
    const title = toStr(draft && draft.title).trim();
    const connectedClanTag = normalizeTag(draft && draft.connectedClanTag);
    const trackingMode = draft && draft.trackingMode === "regularWar" ? "regularWar" : "cwl";

    if (!rosterId) throw new Error("Roster ID is required.");
    if (!title) throw new Error("Roster title is required.");
    if (connectedClanTag && !isValidCocTag(connectedClanTag)) {
      throw new Error("Connected clan tag is invalid. Allowed tag alphabet: P,Y,L,Q,G,R,J,C,U,V,0,2,8,9.");
    }

    const rosters = getRosters();
    if (rosters.some((r) => toStr(r && r.id).trim() === rosterId)) {
      throw new Error("A roster with this ID already exists: " + rosterId);
    }

    rosters.push({
      id: rosterId,
      title: title,
      connectedClanTag: connectedClanTag,
      trackingMode: trackingMode,
      badges: { main: 0, subs: 0, missing: 0 },
      main: [],
      subs: [],
      missing: [],
    });

    applyPreviewMutation(title + " added.");
  };

  const removeRosterFromPreview = (rosterIdRaw) => {
    const rosters = getRosters();
    if (!rosters.length) throw new Error("No roster preview is loaded.");

    const rosterId = toStr(rosterIdRaw).trim();
    if (!rosterId) throw new Error("Roster ID is required.");

    const rosterIndex = rosters.findIndex((r) => toStr(r && r.id).trim() === rosterId);
    if (rosterIndex < 0) throw new Error("Roster not found: " + rosterId);

    const removedRoster = rosters.splice(rosterIndex, 1)[0] || {};
    delete state.rosterStatusByRoster[rosterId];
    clearSuggestionMarksForRoster_(rosterId);

    const rosterTitle = toStr(removedRoster.title).trim();
    const rosterLabel = rosterTitle ? (rosterTitle + " (" + rosterId + ")") : rosterId;
    applyPreviewMutation(rosterLabel + " removed. Publish to apply this change to live data.");
  };

  const moveRosterInPreview = (rosterIdRaw, directionRaw) => {
    const rosters = getRosters();
    if (!rosters.length) throw new Error("No roster preview is loaded.");

    const rosterId = toStr(rosterIdRaw).trim();
    if (!rosterId) throw new Error("Roster ID is required.");

    const direction = Number(directionRaw);
    if (direction !== -1 && direction !== 1) throw new Error("Invalid roster move direction.");

    const currentIndex = rosters.findIndex((r) => toStr(r && r.id).trim() === rosterId);
    if (currentIndex < 0) throw new Error("Roster not found: " + rosterId);

    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= rosters.length) return false;

    const movedRoster = rosters.splice(currentIndex, 1)[0];
    rosters.splice(nextIndex, 0, movedRoster);
    syncRosterOrderFromCurrentArray_(state.lastRosterData);

    const rosterLabel = formatRosterDisplayLabel(rosterId) || rosterId;
    applyPreviewMutation(rosterLabel + " moved to position " + (nextIndex + 1) + ".");
    return true;
  };

  const mkPlayerActionButton = (label, extraClass) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "player-admin-btn" + (extraClass ? " " + extraClass : "");
    btn.textContent = label;
    return btn;
  };

  const mkPlayerFormRow = (labelText, fieldNode) => {
    const row = document.createElement("div");
    row.className = "player-admin-row";

    const label = document.createElement("label");
    label.textContent = labelText;

    row.appendChild(label);
    row.appendChild(fieldNode);
    return row;
  };

  const mkNoteEditor = (initialNotes) => {
    const wrap = document.createElement("div");
    wrap.className = "player-admin-notes";

    const list = document.createElement("div");
    list.className = "player-admin-notes-list";

    const addNoteRow = (value) => {
      const noteRow = document.createElement("div");
      noteRow.className = "player-admin-note-row";

      const input = document.createElement("input");
      input.className = "player-admin-input";
      input.type = "text";
      input.placeholder = "Note";
      input.value = toStr(value).trim();
      input.setAttribute("data-note-input", "1");

      const removeBtn = mkPlayerActionButton("Remove", "danger");
      removeBtn.onclick = () => noteRow.remove();

      noteRow.appendChild(input);
      noteRow.appendChild(removeBtn);
      list.appendChild(noteRow);
    };

    const normalized = normalizeNotes(initialNotes);
    for (const note of normalized) addNoteRow(note);

    const addBtn = mkPlayerActionButton("Add note", "secondary");
    addBtn.onclick = () => addNoteRow("");

    wrap.appendChild(list);
    wrap.appendChild(addBtn);

    const getNotes = () => {
      const inputs = Array.from(list.querySelectorAll('[data-note-input="1"]'));
      return normalizeNotes(inputs.map((x) => x && x.value));
    };

    return { element: wrap, getNotes };
  };

  const getPlayerAdminPanelNode = (actionNode, panelName) => {
    if (!actionNode || !panelName) return null;
    return actionNode.querySelector('[data-player-admin-panel="' + panelName + '"]');
  };

  const setPlayerAdminTrayExpanded = (actionNode, expanded) => {
    if (!actionNode) return;
    const isExpanded = !!expanded;
    const summaryBtn = actionNode.querySelector('[data-player-admin-summary-toggle="1"]');
    const trayNode = actionNode.querySelector('[data-player-admin-tray="1"]');

    actionNode.classList.toggle("is-expanded", isExpanded);
    if (summaryBtn) summaryBtn.setAttribute("aria-expanded", isExpanded ? "true" : "false");
    if (trayNode) trayNode.classList.toggle("hidden", !isExpanded);

    if (!isExpanded) {
      const editPanel = getPlayerAdminPanelNode(actionNode, "edit");
      const movePanel = getPlayerAdminPanelNode(actionNode, "move");
      if (editPanel) editPanel.classList.add("hidden");
      if (movePanel) movePanel.classList.add("hidden");
    }
  };

  const openPlayerAdminPanel = (actionNode, panelName) => {
    if (!actionNode) return;
    const editPanel = getPlayerAdminPanelNode(actionNode, "edit");
    const movePanel = getPlayerAdminPanelNode(actionNode, "move");

    setPlayerAdminTrayExpanded(actionNode, true);

    if (panelName === "edit") {
      if (editPanel) editPanel.classList.remove("hidden");
      if (movePanel) movePanel.classList.add("hidden");
      return;
    }
    if (panelName === "move") {
      if (movePanel) movePanel.classList.remove("hidden");
      if (editPanel) editPanel.classList.add("hidden");
      return;
    }

    if (editPanel) editPanel.classList.add("hidden");
    if (movePanel) movePanel.classList.add("hidden");
  };

  const openPlayerEditPanel = (ctx) => {
    const playerTag = normalizeTag(ctx && ctx.tag);
    const rosterId = toStr(ctx && ctx.rosterId).trim();
    if (!playerTag) throw new Error("Player tag is missing.");

    if (ctx && ctx.reopenProfile) {
      state.pendingProfileReopen = { tag: playerTag, rosterId };
    } else {
      clearPendingProfileReopen();
    }

    const actionNodes = Array.from(document.querySelectorAll(".player-admin-actions[data-player-tag]"));
    const actionNode = actionNodes.find((node) => {
      const nodeTag = normalizeTag(node && node.dataset && node.dataset.playerTag);
      const nodeRosterId = toStr(node && node.dataset && node.dataset.rosterId).trim();
      if (nodeTag !== playerTag) return false;
      return !rosterId || nodeRosterId === rosterId;
    });

    if (!actionNode) {
      clearPendingProfileReopen();
      throw new Error("Player edit controls are not available for " + playerTag + ".");
    }

    const editPanel = getPlayerAdminPanelNode(actionNode, "edit");
    if (!editPanel) {
      clearPendingProfileReopen();
      throw new Error("Player edit panel is not available for " + playerTag + ".");
    }

    openPlayerAdminPanel(actionNode, "edit");

    const playerCard = actionNode.closest(".player");
    if (playerCard && typeof playerCard.scrollIntoView === "function") {
      playerCard.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    const firstField = editPanel.querySelector("input, textarea, select, button");
    if (firstField && typeof firstField.focus === "function") firstField.focus();
  };

  const buildRosterActionControls = (ctx) => {
    if (!ctx || !ctx.roster) return null;
    if (!state.lastRosterData || !Array.isArray(state.lastRosterData.rosters)) return null;

    const rosterId = toStr(ctx.rosterId).trim();
    if (!rosterId) return null;

    const wrap = document.createElement("div");
    wrap.className = "roster-admin-actions";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "clan-sync-btn danger";
    removeBtn.textContent = "Remove roster";
    removeBtn.disabled = !!state.bulkRefreshBusy;
    removeBtn.onclick = () => {
      if (state.bulkRefreshBusy) {
        alert("Cannot remove roster while refresh all is running.");
        return;
      }

      clearPendingProfileReopen();
      const rosterTitle = toStr(ctx.rosterTitle).trim();
      const rosterLabel = rosterTitle ? (rosterTitle + " (" + rosterId + ")") : rosterId;
      const ok = confirm(
        "Remove " + rosterLabel + " from the loaded preview?\n\nThis is not live until you click Publish."
      );
      if (!ok) return;

      try {
        removeRosterFromPreview(rosterId);
      } catch (err) {
        alert("Remove roster failed: " + toErrorMessage(err));
      }
    };

    wrap.appendChild(removeBtn);
    return wrap;
  };

  const buildPlayerActionControls = (ctx) => {
    if (!ctx || !ctx.player) return null;
    if (!state.lastRosterData || !Array.isArray(state.lastRosterData.rosters)) return null;
    const trackingMode = toStr(ctx.trackingMode).trim() === "regularWar" ? "regularWar" : "cwl";

    const playerTag = normalizeTag(ctx.player.tag);
    if (!playerTag) return null;

    const wrap = document.createElement("div");
    wrap.className = "player-admin-actions";
    wrap.dataset.playerTag = playerTag;
    wrap.dataset.rosterId = toStr(ctx.rosterId).trim();

    const summaryBtn = document.createElement("button");
    summaryBtn.type = "button";
    summaryBtn.className = "player-admin-summary";
    summaryBtn.setAttribute("data-player-admin-summary-toggle", "1");
    summaryBtn.setAttribute("aria-expanded", "false");
    summaryBtn.setAttribute("aria-label", "Toggle admin controls");

    const summaryMain = document.createElement("span");
    summaryMain.className = "player-admin-summary-main";
    summaryMain.textContent = "Admin controls";
    summaryBtn.appendChild(summaryMain);

    const summaryMeta = document.createElement("span");
    summaryMeta.className = "player-admin-summary-meta";
    const addSummaryPill = (text) => {
      const pill = document.createElement("span");
      pill.className = "player-admin-summary-pill";
      pill.textContent = text;
      summaryMeta.appendChild(pill);
    };
    if (trackingMode === "cwl") {
      if (ctx.player.excludeAsSwapTarget) addSummaryPill("swap target off");
      if (ctx.player.excludeAsSwapSource) addSummaryPill("swap source off");
    }

    const summaryCaret = document.createElement("span");
    summaryCaret.className = "player-admin-summary-caret";
    summaryCaret.textContent = "v";
    summaryMeta.appendChild(summaryCaret);
    summaryBtn.appendChild(summaryMeta);
    wrap.appendChild(summaryBtn);

    const tray = document.createElement("div");
    tray.className = "player-admin-tray hidden";
    tray.setAttribute("data-player-admin-tray", "1");
    wrap.appendChild(tray);

    const row = document.createElement("div");
    row.className = "player-admin-buttons";

    const editBtn = mkPlayerActionButton("Edit", "secondary");
    const moveBtn = mkPlayerActionButton("Move", "secondary");
    const removeBtn = mkPlayerActionButton("Remove", "danger");

    row.appendChild(editBtn);
    row.appendChild(moveBtn);
    row.appendChild(removeBtn);
    tray.appendChild(row);

    if (trackingMode === "cwl") {
      const settingsPanel = document.createElement("div");
      settingsPanel.className = "player-admin-settings";

      const settingsTitle = document.createElement("div");
      settingsTitle.className = "player-admin-settings-title";
      settingsTitle.textContent = "Algorithm settings";
      settingsPanel.appendChild(settingsTitle);

      const toggleRow = document.createElement("div");
      toggleRow.className = "player-admin-toggle-row";

      const mkSwapToggle = (labelText, flagName, enabled) => {
        const btn = mkPlayerActionButton(labelText + ": " + (enabled ? "ON" : "OFF"), "secondary");
        btn.classList.add("player-admin-toggle");
        btn.classList.add(enabled ? "is-on" : "is-off");
        btn.setAttribute("aria-pressed", enabled ? "true" : "false");
        btn.onclick = () => {
          try {
            clearPendingProfileReopen();
            setPlayerSwapExclusionFlag(playerTag, flagName, !enabled);
          } catch (err) {
            alert("Toggle failed: " + toErrorMessage(err));
          }
        };
        return btn;
      };

      toggleRow.appendChild(mkSwapToggle("Never in war", "excludeAsSwapTarget", !!ctx.player.excludeAsSwapTarget));
      toggleRow.appendChild(mkSwapToggle("Always in war", "excludeAsSwapSource", !!ctx.player.excludeAsSwapSource));
      settingsPanel.appendChild(toggleRow);
      tray.appendChild(settingsPanel);
    }

    const movePanel = document.createElement("div");
    movePanel.className = "player-admin-panel hidden";
    movePanel.dataset.playerAdminPanel = "move";

    const possibleTargets = getRosters()
      .filter((r) => toStr(r && r.id).trim() && toStr(r && r.id).trim() !== toStr(ctx.rosterId).trim());

    if (!possibleTargets.length) {
      const msg = document.createElement("div");
      msg.className = "small muted";
      msg.textContent = "No other roster is available.";
      movePanel.appendChild(msg);
      moveBtn.disabled = true;
    } else {
      const targetSelect = document.createElement("select");
      targetSelect.className = "player-admin-select";
      for (const roster of possibleTargets) {
        const id = toStr(roster && roster.id).trim();
        const title = toStr(roster && roster.title).trim();
        const option = document.createElement("option");
        option.value = id;
        option.textContent = title ? (title + " (" + id + ")") : id;
        targetSelect.appendChild(option);
      }

      movePanel.appendChild(mkPlayerFormRow("Target roster", targetSelect));

      const moveActions = document.createElement("div");
      moveActions.className = "player-admin-inline";
      const moveConfirmBtn = mkPlayerActionButton("Move");
      const moveCancelBtn = mkPlayerActionButton("Cancel", "secondary");
      moveActions.appendChild(moveConfirmBtn);
      moveActions.appendChild(moveCancelBtn);
      movePanel.appendChild(moveActions);

      moveConfirmBtn.onclick = () => {
        try {
          movePlayerToRoster(playerTag, targetSelect.value);
        } catch (err) {
          alert("Move failed: " + toErrorMessage(err));
        }
      };

      moveCancelBtn.onclick = () => {
        movePanel.classList.add("hidden");
      };
    }

    tray.appendChild(movePanel);

    const editPanel = document.createElement("div");
    editPanel.className = "player-admin-panel hidden";
    editPanel.dataset.playerAdminPanel = "edit";

    const tagInput = document.createElement("input");
    tagInput.className = "player-admin-input";
    tagInput.type = "text";
    tagInput.value = playerTag;
    tagInput.placeholder = "#TAG";
    tagInput.addEventListener("blur", () => {
      tagInput.value = normalizeTag(tagInput.value);
    });

    const nameInput = document.createElement("input");
    nameInput.className = "player-admin-input";
    nameInput.type = "text";
    nameInput.value = toStr(ctx.player.name).trim() || "(no name)";

    const discordInput = document.createElement("input");
    discordInput.className = "player-admin-input";
    discordInput.type = "text";
    discordInput.value = toStr(ctx.player.discord).trim();

    const thInput = document.createElement("input");
    thInput.className = "player-admin-input";
    thInput.type = "number";
    thInput.min = "1";
    thInput.step = "1";
    thInput.value = toStr(ctx.player.th);

    const noteEditor = mkNoteEditor(ctx.player.notes);

    editPanel.appendChild(mkPlayerFormRow("Tag", tagInput));
    editPanel.appendChild(mkPlayerFormRow("Name", nameInput));
    editPanel.appendChild(mkPlayerFormRow("Discord", discordInput));
    editPanel.appendChild(mkPlayerFormRow("TH", thInput));
    editPanel.appendChild(mkPlayerFormRow("Notes", noteEditor.element));

    const editActions = document.createElement("div");
    editActions.className = "player-admin-inline";
    const saveBtn = mkPlayerActionButton("Save");
    const cancelEditBtn = mkPlayerActionButton("Cancel", "secondary");
    editActions.appendChild(saveBtn);
    editActions.appendChild(cancelEditBtn);
    editPanel.appendChild(editActions);

    saveBtn.onclick = () => {
      try {
        updatePlayerInfo(playerTag, {
          tag: tagInput.value,
          name: nameInput.value,
          discord: discordInput.value,
          th: thInput.value,
          notes: noteEditor.getNotes(),
        });
      } catch (err) {
        alert("Edit failed: " + toErrorMessage(err));
      }
    };

    cancelEditBtn.onclick = () => {
      clearPendingProfileReopen();
      editPanel.classList.add("hidden");
    };

    tray.appendChild(editPanel);

    summaryBtn.onclick = () => {
      clearPendingProfileReopen();
      const isExpanded = wrap.classList.contains("is-expanded");
      setPlayerAdminTrayExpanded(wrap, !isExpanded);
    };

    moveBtn.onclick = () => {
      clearPendingProfileReopen();
      openPlayerAdminPanel(wrap, "move");
    };

    editBtn.onclick = () => {
      clearPendingProfileReopen();
      openPlayerAdminPanel(wrap, "edit");
    };

    removeBtn.onclick = () => {
      clearPendingProfileReopen();
      const ok = confirm("Remove " + playerTag + " from this preview?");
      if (!ok) return;
      try {
        removePlayerFromPreview(playerTag);
      } catch (err) {
        alert("Remove failed: " + toErrorMessage(err));
      }
    };

    setPlayerAdminTrayExpanded(wrap, false);

    return wrap;
  };

  const setImportActionStatus = (msg, isError) => {
    const el = $("#importActionStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "#fca5a5" : "#6b7280";
  };

  const buildImportSessionLabel = (sessionRaw) => {
    const session = sessionRaw && typeof sessionRaw === "object" ? sessionRaw : null;
    if (!session) return "";
    const fileName = toStr(session.fileName).trim();
    const sheetName = toStr(session.sheetName).trim();
    if (fileName && sheetName) return fileName + " (sheet '" + sheetName + "')";
    if (fileName) return fileName;
    if (sheetName) return "sheet '" + sheetName + "'";
    return "previous import session";
  };

  const clearImportLoadWarning = () => {
    state.importLoadWarning = null;
  };

  const setImportLoadFailureWarning = (failedFileNameRaw, err) => {
    const failedFileName = toStr(failedFileNameRaw).trim();
    const activeSessionLabel = buildImportSessionLabel(state.importSession);
    const filePart = failedFileName ? (" '" + failedFileName + "'") : "";
    const leading = "Failed to load the new XLSX file" + filePart + ".";
    const message = state.importSession
      ? (leading + " Your previous import session is still active, so Compare / Apply still use the earlier imported file: " + activeSessionLabel + ".")
      : (leading + " No previous import session is active.");
    state.importLoadWarning = {
      message,
      failedFileName,
      activeSessionLabel,
      error: toErrorMessage(err),
    };
  };

  const renderImportLoadWarning = () => {
    const el = $("#importLoadWarning");
    if (!el) return;
    const warning = state.importLoadWarning && typeof state.importLoadWarning === "object" ? state.importLoadWarning : null;
    const message = toStr(warning && warning.message).trim();
    if (!message) {
      el.classList.add("hidden");
      el.textContent = "";
      el.removeAttribute("title");
      return;
    }
    el.textContent = message;
    const detail = toStr(warning && warning.error).trim();
    if (detail) el.title = detail;
    else el.removeAttribute("title");
    el.classList.remove("hidden");
  };

  const getImportAllowedClanKeysFromUi = () => {
    const checks = Array.from(document.querySelectorAll('[data-allowed-clan-checkbox="1"]'));
    return checks
      .filter((box) => !!(box && box.checked))
      .map((box) => toStr(box && box.value).trim())
      .filter(Boolean);
  };

  const readImportFiltersFromUi = () => ({
    excludeWarOut: !!($("#excludeWarOut") && $("#excludeWarOut").checked),
    requireDiscord: !!($("#requireDiscord") && $("#requireDiscord").checked),
    allowedClanKeys: getImportAllowedClanKeysFromUi(),
  });

  const getDefaultImportFilters = () => {
    const previous = state.importSession && state.importSession.filters ? state.importSession.filters : {};
    return {
      excludeWarOut: previous.excludeWarOut !== false,
      requireDiscord: !!previous.requireDiscord,
      allowedClanKeys: Array.isArray(previous.allowedClanKeys) ? previous.allowedClanKeys.slice() : [],
    };
  };

  const loadXlsxImportSession = async (file) => {
    if (!file) throw new Error("No XLSX file selected.");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheetNames = Array.isArray(wb && wb.SheetNames) ? wb.SheetNames : [];
    const sheetName = toStr(sheetNames[0]).trim();
    if (!sheetName) throw new Error("Workbook has no sheet.");
    const sheet = wb.Sheets[sheetName];
    if (!sheet) throw new Error("Workbook sheet could not be read.");
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    const parsed = window.RosterGenerator.parseXlsxRowsTolerant(rows);
    const importedClanValues = window.RosterGenerator.extractImportedClanValues(parsed.accounts);
    const suggestedMapping = window.RosterGenerator.suggestClanMappings({
      importedClanValues,
      rosterData: state.lastRosterData,
    });

    const defaults = getDefaultImportFilters();
    const importedClanKeySet = {};
    for (const entry of importedClanValues) {
      const key = toStr(entry && entry.key).trim();
      if (key) importedClanKeySet[key] = true;
    }
    defaults.allowedClanKeys = (defaults.allowedClanKeys || []).filter((key) => importedClanKeySet[key]);

    const previousMapping = state.importSession && state.importSession.mapping && typeof state.importSession.mapping === "object"
      ? state.importSession.mapping
      : {};
    const mergedMapping = Object.assign({}, suggestedMapping, previousMapping);
    const normalizedMapping = window.RosterGenerator.normalizeImportMapping(
      mergedMapping,
      importedClanValues,
      state.lastRosterData
    );

    return {
      fileName: toStr(file && file.name).trim(),
      sheetName,
      totalRowsRead: Number.isFinite(Number(parsed.totalRows)) ? Number(parsed.totalRows) : rows.length,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      invalidRows: Array.isArray(parsed.invalidRows) ? parsed.invalidRows : [],
      ignoredRows: Array.isArray(parsed.ignoredRows) ? parsed.ignoredRows : [],
      importedClanValues,
      mapping: normalizedMapping,
      filters: defaults,
      comparison: null,
      stale: false,
      staleReason: "",
    };
  };

  const alignImportMappingWithPreview = () => {
    if (!state.importSession) return false;
    const session = state.importSession;
    const importedClanValues = Array.isArray(session.importedClanValues) ? session.importedClanValues : [];
    const suggested = window.RosterGenerator.suggestClanMappings({
      importedClanValues,
      rosterData: state.lastRosterData,
    });
    const merged = Object.assign({}, suggested, session.mapping && typeof session.mapping === "object" ? session.mapping : {});
    const normalized = window.RosterGenerator.normalizeImportMapping(merged, importedClanValues, state.lastRosterData);
    const changed = jsonPretty(normalized) !== jsonPretty(session.mapping || {});
    session.mapping = normalized;
    return changed;
  };

  const invalidateImportComparison = (reasonRaw) => {
    if (!state.importSession || !state.importSession.comparison) return;
    state.importSession.stale = true;
    state.importSession.staleReason = toStr(reasonRaw).trim() || "Preview changed. Re-run compare with preview.";
  };

  const renderImportSummary = () => {
    const wrap = $("#importSummaryWrap");
    const linesEl = $("#importSummaryLines");
    const noDataEl = $("#importNoDataMsg");
    const debugDetails = $("#importDebugDetails");
    const debugPre = $("#importDebugPre");

    if (!wrap || !linesEl || !noDataEl || !debugDetails || !debugPre) return;
    const session = state.importSession;
    if (!session) {
      wrap.classList.add("hidden");
      linesEl.textContent = "";
      noDataEl.classList.add("hidden");
      debugDetails.classList.add("hidden");
      debugPre.textContent = "";
      return;
    }

    wrap.classList.remove("hidden");
    linesEl.textContent = "";

    const addLine = (text) => {
      const row = document.createElement("div");
      row.textContent = text;
      linesEl.appendChild(row);
    };

    const compare = session.comparison;
    if (!compare || !compare.summary) {
      addLine("Sheet used: " + (session.sheetName || "first sheet"));
      addLine("Rows read: " + (Number.isFinite(Number(session.totalRowsRead)) ? Number(session.totalRowsRead) : 0));
      addLine("Normalized members parsed: " + (Array.isArray(session.accounts) ? session.accounts.length : 0));
      addLine("Invalid rows: " + (Array.isArray(session.invalidRows) ? session.invalidRows.length : 0));
      addLine("Run Compare with preview to build update buckets.");
      noDataEl.classList.add("hidden");
      debugDetails.classList.add("hidden");
      debugPre.textContent = "";
      return;
    }

    const summary = compare.summary;
    addLine("Sheet used: " + (summary.sheetName || session.sheetName || "first sheet"));
    addLine("Rows read: " + (Number.isFinite(Number(summary.totalRowsRead)) ? Number(summary.totalRowsRead) : 0));
    addLine("Normalized members parsed: " + (Number.isFinite(Number(summary.normalizedMembersParsed)) ? Number(summary.normalizedMembersParsed) : 0));
    addLine("Matched unchanged: " + (Number.isFinite(Number(summary.matchedUnchanged)) ? Number(summary.matchedUnchanged) : 0));
    addLine("Matched with updates: " + (Number.isFinite(Number(summary.matchedWithUpdates)) ? Number(summary.matchedWithUpdates) : 0));
    addLine("New addable: " + (Number.isFinite(Number(summary.newAddable)) ? Number(summary.newAddable) : 0));
    addLine("Review-only: " + (Number.isFinite(Number(summary.reviewOnly)) ? Number(summary.reviewOnly) : 0));
    addLine("Ignored (war out): " + (Number.isFinite(Number(summary.ignoredWarOut)) ? Number(summary.ignoredWarOut) : 0));
    addLine("Ignored (clan not allowed): " + (Number.isFinite(Number(summary.ignoredClanNotAllowed)) ? Number(summary.ignoredClanNotAllowed) : 0));
    addLine("Ignored (missing Discord): " + (Number.isFinite(Number(summary.ignoredMissingDiscord)) ? Number(summary.ignoredMissingDiscord) : 0));
    addLine("Matched rows missing imported Discord: " + (Number.isFinite(Number(summary.matchedWithoutImportedDiscord)) ? Number(summary.matchedWithoutImportedDiscord) : 0));
    addLine("Matched rows missing Discord in source + preview: " + (Number.isFinite(Number(summary.matchedWithoutAnyDiscord)) ? Number(summary.matchedWithoutAnyDiscord) : 0));
    addLine("Invalid rows: " + (Number.isFinite(Number(summary.invalidRows)) ? Number(summary.invalidRows) : 0));
    addLine("Final actionable total: " + (Number.isFinite(Number(summary.actionableTotal)) ? Number(summary.actionableTotal) : 0));

    if (session.stale) {
      addLine("Status: stale - " + (session.staleReason || "Preview changed. Re-run compare with preview."));
    }

    noDataEl.classList.toggle("hidden", !(summary && summary.noDataToAdd));
    debugDetails.classList.remove("hidden");
    debugPre.textContent = jsonPretty({
      summary,
      filters: compare.filters,
      mapping: compare.mapping,
      buckets: compare.buckets,
      stale: session.stale,
      staleReason: session.staleReason,
    });
  };

  const renderAllowedClansFilter = () => {
    const wrap = $("#allowedClansWrap");
    if (!wrap) return;
    wrap.textContent = "";

    const session = state.importSession;
    const clans = session && Array.isArray(session.importedClanValues) ? session.importedClanValues : [];
    const selectedSet = {};
    const selected = session && session.filters && Array.isArray(session.filters.allowedClanKeys)
      ? session.filters.allowedClanKeys
      : [];
    for (const key of selected) selectedSet[toStr(key).trim()] = true;

    if (!clans.length) {
      const empty = document.createElement("div");
      empty.className = "small muted";
      empty.textContent = "Import a file to load clan filters.";
      wrap.appendChild(empty);
      return;
    }

    for (const clanEntry of clans) {
      const key = toStr(clanEntry && clanEntry.key).trim();
      if (!key) continue;
      const label = toStr(clanEntry && clanEntry.label).trim() || "(blank clan)";
      const count = Number.isFinite(Number(clanEntry && clanEntry.count)) ? Number(clanEntry.count) : 0;

      const chip = document.createElement("label");
      chip.className = "chip-option";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = key;
      checkbox.checked = !!selectedSet[key];
      checkbox.dataset.allowedClanCheckbox = "1";
      checkbox.addEventListener("change", () => {
        if (!state.importSession) return;
        state.importSession.filters = window.RosterGenerator.normalizeImportFilters(readImportFiltersFromUi());
        invalidateImportComparison("Filters changed. Re-run compare with preview.");
        renderImportUi();
      });

      const text = document.createElement("span");
      text.textContent = label + " (" + count + ")";
      chip.appendChild(checkbox);
      chip.appendChild(text);
      wrap.appendChild(chip);
    }
  };

  const buildRosterOptionLabel = (roster) => {
    const id = toStr(roster && roster.id).trim();
    const title = toStr(roster && roster.title).trim();
    return title ? (title + " (" + id + ")") : id;
  };

  const renderClanMappingTable = () => {
    const tbody = $("#clanMappingTable tbody");
    if (!tbody) return;
    tbody.textContent = "";

    const session = state.importSession;
    const clans = session && Array.isArray(session.importedClanValues) ? session.importedClanValues : [];
    if (!clans.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.className = "small muted";
      td.textContent = "Import a file to build clan mapping.";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    const rosters = getRosters().filter((roster) => toStr(roster && roster.id).trim());

    for (const clanEntry of clans) {
      const key = toStr(clanEntry && clanEntry.key).trim();
      if (!key) continue;
      const label = toStr(clanEntry && clanEntry.label).trim() || "(blank clan)";
      const count = Number.isFinite(Number(clanEntry && clanEntry.count)) ? Number(clanEntry.count) : 0;

      const tr = document.createElement("tr");
      const tdClan = document.createElement("td");
      tdClan.textContent = label;
      const tdCount = document.createElement("td");
      tdCount.textContent = String(count);
      const tdMapping = document.createElement("td");

      const select = document.createElement("select");
      select.className = "admin-select mapping-table-select";
      select.dataset.importClanKey = key;

      const unmapped = document.createElement("option");
      unmapped.value = "";
      unmapped.textContent = "Review only (unmapped)";
      select.appendChild(unmapped);

      for (const roster of rosters) {
        const id = toStr(roster && roster.id).trim();
        if (!id) continue;
        const option = document.createElement("option");
        option.value = id;
        option.textContent = buildRosterOptionLabel(roster);
        select.appendChild(option);
      }

      const selectedRoster = toStr(session.mapping && session.mapping[key]).trim();
      select.value = selectedRoster;
      select.addEventListener("change", () => {
        if (!state.importSession) return;
        state.importSession.mapping = state.importSession.mapping && typeof state.importSession.mapping === "object"
          ? state.importSession.mapping
          : {};
        state.importSession.mapping[key] = toStr(select.value).trim();
        state.importSession.mapping = window.RosterGenerator.normalizeImportMapping(
          state.importSession.mapping,
          state.importSession.importedClanValues,
          state.lastRosterData
        );
        invalidateImportComparison("Mapping changed. Re-run compare with preview.");
        renderImportUi();
      });

      tdMapping.appendChild(select);
      tr.appendChild(tdClan);
      tr.appendChild(tdCount);
      tr.appendChild(tdMapping);
      tbody.appendChild(tr);
    }
  };

  const refreshImportActionsUi = () => {
    const compareBtn = $("#compareImportBtn");
    const applyBtn = $("#applyImportBtn");
    const stalePill = $("#importStalePill");
    const session = state.importSession;
    const hasPreview = !!(state.lastRosterData && Array.isArray(state.lastRosterData.rosters));
    const hasParsed = !!(session && Array.isArray(session.accounts));
    const hasComparison = !!(session && session.comparison && session.comparison.summary);
    const actionableTotal = hasComparison && Number.isFinite(Number(session.comparison.summary.actionableTotal))
      ? Number(session.comparison.summary.actionableTotal)
      : 0;

    if (compareBtn) {
      compareBtn.disabled = !hasPreview || !hasParsed || state.importCompareBusy || state.importApplyBusy || state.bulkRefreshBusy;
      compareBtn.textContent = state.importCompareBusy ? "Comparing..." : "Compare with preview";
    }

    if (applyBtn) {
      applyBtn.disabled = !hasComparison || session.stale || actionableTotal < 1 || state.importApplyBusy || state.importCompareBusy || state.bulkRefreshBusy;
      applyBtn.textContent = state.importApplyBusy ? "Applying..." : "Apply updates";
    }

    if (stalePill) {
      stalePill.classList.toggle("hidden", !(session && session.stale));
      stalePill.textContent = session && session.stale
        ? "Compare is stale"
        : "Compare is stale";
    }
  };

  const renderXlsxMeta = () => {
    const meta = $("#xlsxMeta");
    if (!meta) return;
    const session = state.importSession;
    if (!session) {
      meta.textContent = "Import a member list workbook. The first sheet will be used.";
      return;
    }
    const parsedCount = Array.isArray(session.accounts) ? session.accounts.length : 0;
    const invalidCount = Array.isArray(session.invalidRows) ? session.invalidRows.length : 0;
    const ignoredCount = Array.isArray(session.ignoredRows) ? session.ignoredRows.length : 0;
    const fileName = toStr(session.fileName).trim();
    const filePrefix = fileName ? (fileName + " - ") : "";
    meta.textContent = filePrefix + "using sheet '" + (session.sheetName || "first sheet") + "', rows read " + session.totalRowsRead + ", parsed " + parsedCount + ", invalid " + invalidCount + ", blank rows " + ignoredCount + ".";
  };

  const renderImportUi = () => {
    const mappingChanged = alignImportMappingWithPreview();
    if (mappingChanged) {
      invalidateImportComparison("Import mapping changed because preview rosters changed. Re-run compare with preview.");
    }
    renderImportLoadWarning();
    renderXlsxMeta();
    renderAllowedClansFilter();
    renderClanMappingTable();
    renderImportSummary();
    refreshImportActionsUi();
  };

  const runImportComparison = async () => {
    if (state.bulkRefreshBusy) {
      throw new Error("Wait for refresh all to finish before running compare.");
    }
    if (!state.lastRosterData || !Array.isArray(state.lastRosterData.rosters)) {
      throw new Error("Load active config first.");
    }
    if (!state.importSession || !Array.isArray(state.importSession.accounts)) {
      throw new Error("Import an XLSX file first.");
    }

    state.importCompareBusy = true;
    setImportActionStatus("Comparing import against preview...", false);
    renderImportUi();
    try {
      state.importSession.filters = window.RosterGenerator.normalizeImportFilters(readImportFiltersFromUi());
      state.importSession.mapping = window.RosterGenerator.normalizeImportMapping(
        state.importSession.mapping,
        state.importSession.importedClanValues,
        state.lastRosterData
      );

      state.importSession.comparison = window.RosterGenerator.buildImportComparison({
        rosterData: state.lastRosterData,
        accounts: state.importSession.accounts,
        invalidRows: state.importSession.invalidRows,
        ignoredRows: state.importSession.ignoredRows,
        importedClanValues: state.importSession.importedClanValues,
        mapping: state.importSession.mapping,
        filters: state.importSession.filters,
        sheetName: state.importSession.sheetName,
        totalRowsRead: state.importSession.totalRowsRead,
      });
      state.importSession.stale = false;
      state.importSession.staleReason = "";

      const summary = state.importSession.comparison && state.importSession.comparison.summary
        ? state.importSession.comparison.summary
        : null;
      if (summary && summary.noDataToAdd) {
        setImportActionStatus("No data to add.", false);
      } else {
        const actionable = summary && Number.isFinite(Number(summary.actionableTotal))
          ? Number(summary.actionableTotal)
          : 0;
        const missingBoth = summary && Number.isFinite(Number(summary.matchedWithoutAnyDiscord))
          ? Number(summary.matchedWithoutAnyDiscord)
          : 0;
        const suffix = missingBoth > 0
          ? (" " + missingBoth + " matched member(s) have no Discord in both import and preview.")
          : "";
        setImportActionStatus("Comparison complete: " + actionable + " actionable change(s)." + suffix, false);
      }
    } finally {
      state.importCompareBusy = false;
      renderImportUi();
    }
  };

  const applyImportComparison = async () => {
    if (state.bulkRefreshBusy) {
      throw new Error("Wait for refresh all to finish before applying import updates.");
    }
    if (!state.lastRosterData || !Array.isArray(state.lastRosterData.rosters)) {
      throw new Error("Load active config first.");
    }
    if (!state.importSession || !state.importSession.comparison || !state.importSession.comparison.summary) {
      throw new Error("Run compare first.");
    }
    if (state.importSession.stale) {
      throw new Error("Comparison is stale. Re-run compare with preview.");
    }

    const actionable = Number.isFinite(Number(state.importSession.comparison.summary.actionableTotal))
      ? Number(state.importSession.comparison.summary.actionableTotal)
      : 0;
    if (actionable < 1) {
      throw new Error("No data to add.");
    }

    state.importApplyBusy = true;
    setImportActionStatus("Applying updates...", false);
    renderImportUi();
    try {
      const applied = window.RosterGenerator.applyImportComparison({
        rosterData: state.lastRosterData,
        comparison: state.importSession.comparison,
      });
      if (!applied || !applied.rosterData || !Array.isArray(applied.rosterData.rosters)) {
        throw new Error("Import apply returned invalid roster data.");
      }

      state.lastRosterData = applied.rosterData;
      normalizeRosterOrderInData_(state.lastRosterData);
      reindexAllRosters();
      clearSuggestionMarks_();
      renderPreviewFromState();
      const publishBtn = $("#publishBtn");
      if (publishBtn) publishBtn.disabled = false;

      const appliedSummary = applied.applied && typeof applied.applied === "object" ? applied.applied : {};
      const updatedCount = Number.isFinite(Number(appliedSummary.updatedCount)) ? Number(appliedSummary.updatedCount) : 0;
      const addedCount = Number.isFinite(Number(appliedSummary.addedCount)) ? Number(appliedSummary.addedCount) : 0;
      setImportActionStatus("Applied updates: " + updatedCount + " updated, " + addedCount + " added.", false);
      setStatus("Import updates applied to preview.");

      await runImportComparison();
    } finally {
      state.importApplyBusy = false;
      renderImportUi();
    }
  };

  const loadActiveRosterData = () =>
    new Promise((resolve, reject) => {
      if (!window.google || !google.script || !google.script.run) {
        reject(new Error("google.script.run is not available."));
        return;
      }
      google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler((err) => reject(err && err.message ? new Error(err.message) : err))
        .getRosterData();
    });

  const runServerMethod = (methodName, args) =>
    new Promise((resolve, reject) => {
      if (!window.google || !google.script || !google.script.run) {
        reject(new Error("google.script.run is not available."));
        return;
      }

      const runner = google.script.run
        .withSuccessHandler((r) => resolve(r))
        .withFailureHandler((e) => reject(e && e.message ? new Error(e.message) : e));

      if (!runner || typeof runner[methodName] !== "function") {
        reject(new Error("Server method is not available: " + methodName));
        return;
      }

      const list = Array.isArray(args) ? args : [];
      runner[methodName](...list);
    });

  const applyServerSyncedPreview = (nextRosterData, statusMsg) => {
    if (!nextRosterData || !Array.isArray(nextRosterData.rosters)) {
      throw new Error("Sync returned invalid roster data.");
    }
    state.lastRosterData = nextRosterData;
    normalizeRosterOrderInData_(state.lastRosterData);
    reindexAllRosters();
    clearSuggestionMarks_();
    renderPreviewFromState();
    markReportStale();
    const publishBtn = $("#publishBtn");
    if (publishBtn) publishBtn.disabled = false;
    if (statusMsg) setStatus(statusMsg);
  };

  const renderConnectedRostersTable = () => {
    const tbody = $("#connectedRostersTable tbody");
    if (!tbody) return;

    const rosters = getRosters();
    tbody.textContent = "";

    if (!rosters.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 6;
      td.className = "small muted";
      td.textContent = "Load active config first.";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    for (let rosterIndex = 0; rosterIndex < rosters.length; rosterIndex++) {
      const roster = rosters[rosterIndex];
      const r = roster && typeof roster === "object" ? roster : {};
      ensureRosterArrays(r);
      const rosterId = toStr(r.id).trim();
      if (!rosterId) continue;
      const rosterTitle = toStr(r.title).trim();
      const label = rosterTitle ? (rosterTitle + " (" + rosterId + ")") : rosterId;
      const trackingMode = getRosterTrackingMode(r);

      const tr = document.createElement("tr");

      const tdRoster = document.createElement("td");
      tdRoster.textContent = label;

      const tdOrder = document.createElement("td");
      const orderControls = document.createElement("div");
      orderControls.className = "roster-order-controls";

      const moveUpBtn = document.createElement("button");
      moveUpBtn.type = "button";
      moveUpBtn.className = "clan-sync-btn secondary";
      moveUpBtn.textContent = "Up";
      moveUpBtn.title = "Move roster up";

      const moveDownBtn = document.createElement("button");
      moveDownBtn.type = "button";
      moveDownBtn.className = "clan-sync-btn secondary";
      moveDownBtn.textContent = "Down";
      moveDownBtn.title = "Move roster down";

      const orderPos = document.createElement("span");
      orderPos.className = "roster-order-pos";
      orderPos.textContent = (rosterIndex + 1) + "/" + rosters.length;

      orderControls.appendChild(moveUpBtn);
      orderControls.appendChild(moveDownBtn);
      orderControls.appendChild(orderPos);
      tdOrder.appendChild(orderControls);

      const tdTracking = document.createElement("td");
      const trackingSelect = document.createElement("select");
      trackingSelect.className = "admin-select";
      trackingSelect.dataset.rosterId = rosterId;
      [
        { value: "cwl", label: "CWL" },
        { value: "regularWar", label: "Regular clan war" },
      ].forEach((opt) => {
        const option = document.createElement("option");
        option.value = opt.value;
        option.textContent = opt.label;
        trackingSelect.appendChild(option);
      });
      trackingSelect.value = trackingMode;
      tdTracking.appendChild(trackingSelect);

      const tdTag = document.createElement("td");
      const tagInput = document.createElement("input");
      tagInput.className = "admin-input";
      tagInput.type = "text";
      tagInput.placeholder = "#CLANTAG";
      tagInput.value = normalizeTag(r.connectedClanTag);
      tagInput.dataset.clanSyncTagInput = "1";
      tagInput.dataset.rosterId = rosterId;
      r.connectedClanTag = tagInput.value;
      tdTag.appendChild(tagInput);

      const tdActions = document.createElement("td");
      const actions = document.createElement("div");
      actions.className = "clan-sync-actions";

      const testBtn = document.createElement("button");
      testBtn.type = "button";
      testBtn.className = "clan-sync-btn secondary";
      testBtn.textContent = "Test connection";

      const syncPoolBtn = document.createElement("button");
      syncPoolBtn.type = "button";
      syncPoolBtn.className = "clan-sync-btn";
      syncPoolBtn.textContent = "Sync roster pool";

      const syncLineupBtn = document.createElement("button");
      syncLineupBtn.type = "button";
      syncLineupBtn.className = "clan-sync-btn";
      syncLineupBtn.textContent = trackingMode === "regularWar" ? "Sync current war lineup" : "Sync lineup";

      const refreshBtn = document.createElement("button");
      refreshBtn.type = "button";
      refreshBtn.className = "clan-sync-btn";
      refreshBtn.textContent = "Refresh tracking stats";

      const suggestBtn = document.createElement("button");
      suggestBtn.type = "button";
      suggestBtn.className = "clan-sync-btn";
      suggestBtn.textContent = trackingMode === "cwl" ? "Suggest bench" : "Suggest bench (CWL only)";
      if (trackingMode !== "cwl") suggestBtn.disabled = true;

      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "clan-sync-btn secondary";
      clearBtn.textContent = "Clear marks";

      actions.appendChild(testBtn);
      actions.appendChild(syncPoolBtn);
      actions.appendChild(syncLineupBtn);
      actions.appendChild(refreshBtn);
      actions.appendChild(suggestBtn);
      actions.appendChild(clearBtn);
      tdActions.appendChild(actions);

      const tdStatus = document.createElement("td");
      tdStatus.className = "small muted";

      const applyRowStatus = () => {
        const saved = state.rosterStatusByRoster[rosterId];
        if (!saved || !saved.msg) {
          tdStatus.textContent = "";
          tdStatus.style.color = "#6b7280";
          return;
        }
        tdStatus.textContent = saved.msg;
        tdStatus.style.color = saved.isError ? "#fca5a5" : "#6b7280";
      };

      const setRowStatus = (msg, isError) => {
        setRosterStatus(rosterId, msg, isError);
        applyRowStatus();
      };
      applyRowStatus();

      const setBusy = (busy) => {
        const disabled = !!busy || state.bulkRefreshBusy;
        moveUpBtn.disabled = disabled || rosterIndex === 0;
        moveDownBtn.disabled = disabled || rosterIndex >= rosters.length - 1;
        trackingSelect.disabled = disabled;
        tagInput.disabled = disabled;
        testBtn.disabled = disabled;
        syncPoolBtn.disabled = disabled;
        syncLineupBtn.disabled = disabled;
        refreshBtn.disabled = disabled;
        suggestBtn.disabled = disabled || trackingMode !== "cwl";
        clearBtn.disabled = disabled;
      };

      const persistConnectedTag = () => {
        const normalized = normalizeTag(tagInput.value);
        tagInput.value = normalized;
        if (toStr(r.connectedClanTag).trim() !== normalized) {
          r.connectedClanTag = normalized;
          const publishBtn = $("#publishBtn");
          if (publishBtn) publishBtn.disabled = false;
          setStatus("Connected clan tag updated for " + rosterId + ".");
          markReportStale("Preview changed after updating connected clan tags.");
        }
      };

      tagInput.addEventListener("change", persistConnectedTag);
      tagInput.addEventListener("blur", persistConnectedTag);

      moveUpBtn.onclick = () => {
        try {
          if (!moveRosterInPreview(rosterId, -1)) {
            setStatus("Roster is already at the top.");
          }
        } catch (err) {
          alert("Move roster failed: " + toErrorMessage(err));
        }
      };

      moveDownBtn.onclick = () => {
        try {
          if (!moveRosterInPreview(rosterId, 1)) {
            setStatus("Roster is already at the bottom.");
          }
        } catch (err) {
          alert("Move roster failed: " + toErrorMessage(err));
        }
      };

      trackingSelect.addEventListener("change", () => {
        const nextMode = trackingSelect.value === "regularWar" ? "regularWar" : "cwl";
        const prevMode = getRosterTrackingMode(r);
        if (nextMode === prevMode) return;
        r.trackingMode = nextMode;
        ensureRosterArrays(r);
        clearSavedBenchSuggestionsForRoster_(rosterId);
        clearSuggestionMarksForRoster_(rosterId);
        if (nextMode === "cwl") {
          r.missing = [];
        } else if (!Array.isArray(r.missing)) {
          r.missing = [];
        }
        reindexRoster(r);
        const publishBtn = $("#publishBtn");
        if (publishBtn) publishBtn.disabled = false;
        setStatus("Tracking mode updated for " + rosterId + ".");
        markReportStale("Preview changed after tracking mode update. Re-run compare with preview.");
        renderPreviewFromState();
      });

      const ensureServerReady = () => {
        if (!state.lastRosterData || !Array.isArray(state.lastRosterData.rosters)) {
          throw new Error("No roster preview is loaded.");
        }
        if (!state.password) {
          throw new Error("Unlock admin first.");
        }
        if (state.bulkRefreshBusy) {
          throw new Error("Refresh all is already running.");
        }
        persistConnectedTag();
        if (!toStr(r.connectedClanTag).trim()) {
          throw new Error("Connected clan tag is required.");
        }
        if (!isValidCocTag(r.connectedClanTag)) {
          throw new Error("Connected clan tag is invalid for " + rosterId + ". Allowed tag alphabet: P,Y,L,Q,G,R,J,C,U,V,0,2,8,9.");
        }
      };

      testBtn.onclick = async () => {
        try {
          ensureServerReady();
          setBusy(true);
          setRowStatus("Testing...", false);
          const res = await runServerMethod("testClanConnection", [state.lastRosterData, rosterId, state.password]);
          const memberCount = Number.isFinite(Number(res && res.memberCount)) ? Number(res.memberCount) : 0;
          setRowStatus("memberCount " + memberCount, false);
        } catch (err) {
          setRowStatus(toErrorMessage(err), true);
        } finally {
          setBusy(false);
        }
      };

      syncPoolBtn.onclick = async () => {
        try {
          ensureServerReady();
          setBusy(true);
          setRowStatus("Syncing roster pool...", false);
          const res = await runServerMethod("syncClanRosterPool", [state.lastRosterData, rosterId, state.password]);
          setRowStatus(formatRosterPoolStatus(res && res.result), false);
          applyServerSyncedPreview(res && res.rosterData, "Roster pool synced for " + rosterId + ".");
        } catch (err) {
          setRowStatus(toErrorMessage(err), true);
        } finally {
          setBusy(false);
        }
      };

      syncLineupBtn.onclick = async () => {
        try {
          ensureServerReady();
          const mode = getRosterTrackingMode(r);
          setBusy(true);
          setRowStatus(mode === "regularWar" ? "Syncing current war lineup..." : "Syncing lineup...", false);
          const res = await runServerMethod("syncClanTodayLineup", [state.lastRosterData, rosterId, state.password]);
          const result = res && res.result ? res.result : {};
          const msg = toStr(result.message).trim();
          setRowStatus(formatTodayLineupStatus(result), false);
          if (mode === "cwl" && msg.toLowerCase() === "no current cwl war found") {
            setStatus("No current CWL war found for " + rosterId + ".");
          } else {
            applyServerSyncedPreview(
              res && res.rosterData,
              mode === "regularWar"
                ? "Current war lineup synced for " + rosterId + "."
                : "Lineup synced for " + rosterId + "."
            );
          }
        } catch (err) {
          setRowStatus(toErrorMessage(err), true);
        } finally {
          setBusy(false);
        }
      };

      refreshBtn.onclick = async () => {
        try {
          ensureServerReady();
          setBusy(true);
          setRowStatus("Refreshing tracking stats...", false);
          const res = await runServerMethod("refreshTrackingStats", [state.lastRosterData, rosterId, state.password]);
          setRowStatus(formatTrackingRefreshStatus(res && res.result), false);
          applyServerSyncedPreview(res && res.rosterData, "Tracking stats refreshed for " + rosterId + ".");
        } catch (err) {
          setRowStatus(toErrorMessage(err), true);
        } finally {
          setBusy(false);
        }
      };

      suggestBtn.onclick = async () => {
        if (trackingMode !== "cwl") return;
        try {
          ensureServerReady();
          setBusy(true);
          setRowStatus("Suggesting...", false);
          const res = await runServerMethod("computeBenchSuggestions", [state.lastRosterData, rosterId, state.password]);
          if (res && res.rosterData && Array.isArray(res.rosterData.rosters)) {
            state.lastRosterData = res.rosterData;
            normalizeRosterOrderInData_(state.lastRosterData);
            reindexAllRosters();
          }
          const summary = applySuggestionResponseToState(rosterId, res);
          renderPreviewFromState();
          markReportStale("Preview changed after bench suggestions. Re-run compare with preview.");
          const publishBtn = $("#publishBtn");
          if (publishBtn) publishBtn.disabled = false;
          setRowStatus(formatSuggestionStatus(summary), false);
        } catch (err) {
          setRowStatus(toErrorMessage(err), true);
        } finally {
          setBusy(false);
        }
      };

      clearBtn.onclick = () => {
        clearSavedBenchSuggestionsForRoster_(rosterId);
        clearSuggestionMarksForRoster_(rosterId);
        renderPreviewFromState();
        const publishBtn = $("#publishBtn");
        if (publishBtn) publishBtn.disabled = false;
        markReportStale("Preview changed after clearing marks. Re-run compare with preview.");
        setRowStatus("saved suggestions cleared", false);
      };

      setBusy(false);
      tr.appendChild(tdRoster);
      tr.appendChild(tdOrder);
      tr.appendChild(tdTracking);
      tr.appendChild(tdTag);
      tr.appendChild(tdActions);
      tr.appendChild(tdStatus);
      tbody.appendChild(tr);
    }
  };

  const renderClanSyncTable = () => {
    renderConnectedRostersTable();
  };

  const renderCwlPerfTable = () => {
    renderConnectedRostersTable();
  };

  const refreshAdminWorkflowUi = () => {
    refreshRefreshAllUi();
    renderConnectedRostersTable();
    renderImportUi();
    applyBenchMarks_();
  };

  const runRefreshAll = async () => {
    if (state.bulkRefreshBusy) {
      throw new Error("Refresh all is already running.");
    }
    if (!state.lastRosterData || !Array.isArray(state.lastRosterData.rosters)) {
      throw new Error("Load active config first.");
    }
    if (!state.password) {
      throw new Error("Unlock admin first.");
    }

    persistClanSyncTagInputs();

    const rosters = getRosters().filter((roster) => toStr(roster && roster.id).trim());
    if (!rosters.length) {
      throw new Error("No rosters are loaded.");
    }

    clearSuggestionMarks_();
    state.bulkRefreshBusy = true;
    refreshAdminWorkflowUi();

    const totalRosters = rosters.length;
    let completedRosters = 0;
    const updateProgress = () => {
      completedRosters++;
      setStatus("Refresh all running: " + completedRosters + "/" + totalRosters + " rosters complete.");
    };

    const runRefreshAllRosterPipeline = async (rosterIdRaw) => {
      const rosterId = toStr(rosterIdRaw).trim();
      const rosterLabel = formatRosterDisplayLabel(rosterId) || rosterId;
      const issues = [];

      const addIssue = (msg) => {
        issues.push(rosterLabel + ": " + msg);
      };

      const requireCurrentRoster = () => {
        const currentRoster = getRosterById(rosterId);
        if (!currentRoster) {
          throw new Error("Roster not found: " + rosterId);
        }
        return currentRoster;
      };

      const requireConnectedClanTag = () => {
        const currentRoster = requireCurrentRoster();
        const connectedClanTag = normalizeTag(currentRoster.connectedClanTag);
        if (!connectedClanTag) {
          throw new Error("Connected clan tag is required.");
        }
        if (!isValidCocTag(connectedClanTag)) {
          throw new Error("Connected clan tag is invalid. Allowed tag alphabet: P,Y,L,Q,G,R,J,C,U,V,0,2,8,9.");
        }
        return currentRoster;
      };
      const getCurrentTrackingMode = () => getRosterTrackingMode(requireCurrentRoster());
      const shouldSuggestBench = () => getCurrentTrackingMode() === "cwl";
      const totalSteps = shouldSuggestBench() ? 4 : 3;

      const failClanStep = (err) => {
        const msg = toErrorMessage(err);
        setClanSyncStatus(rosterId, msg, true);
        renderClanSyncTable();
        addIssue(msg);
      };

      const failTrackingStep = (err) => {
        const msg = toErrorMessage(err);
        setCwlStatus(rosterId, msg, true);
        renderCwlPerfTable();
        addIssue(msg);
      };

      const waitForNextStep = async (stepIndex) => {
        if (stepIndex >= totalSteps - 1 || REFRESH_ALL_STEP_DELAY_MS < 1) return;
        await pause(REFRESH_ALL_STEP_DELAY_MS);
      };

      try {
        try {
          requireConnectedClanTag();
          setClanSyncStatus(rosterId, "Syncing roster pool...", false);
          renderClanSyncTable();
          await runExclusiveRosterPoolRefresh(async () => {
            const res = await runServerMethod("syncClanRosterPool", [cloneCurrentRosterDataForServer_(), rosterId, state.password]);
            setClanSyncStatus(rosterId, formatRosterPoolStatus(res && res.result), false);
            applyMergedRosterPreview(rosterId, res && res.rosterData);
          });
        } catch (err) {
          failClanStep(err);
        }

        await waitForNextStep(0);

        try {
          requireConnectedClanTag();
          const mode = getCurrentTrackingMode();
          setClanSyncStatus(rosterId, mode === "regularWar" ? "Syncing current war lineup..." : "Syncing today lineup...", false);
          renderClanSyncTable();
          const res = await runServerMethod("syncClanTodayLineup", [cloneCurrentRosterDataForServer_(), rosterId, state.password]);
          const result = res && res.result ? res.result : {};
          const msg = toStr(result.message).trim();
          setClanSyncStatus(rosterId, formatTodayLineupStatus(result), false);
          if (mode === "cwl" && msg.toLowerCase() === "no current cwl war found") {
            renderClanSyncTable();
          } else {
            applyMergedRosterPreview(rosterId, res && res.rosterData);
          }
        } catch (err) {
          failClanStep(err);
        }

        await waitForNextStep(1);

        try {
          requireConnectedClanTag();
          setCwlStatus(rosterId, "Refreshing tracking stats...", false);
          renderCwlPerfTable();
          const res = await runServerMethod("refreshTrackingStats", [cloneCurrentRosterDataForServer_(), rosterId, state.password]);
          setCwlStatus(rosterId, formatTrackingRefreshStatus(res && res.result), false);
          applyMergedRosterPreview(rosterId, res && res.rosterData);
        } catch (err) {
          failTrackingStep(err);
        }

        await waitForNextStep(2);

        if (shouldSuggestBench()) {
          try {
            requireCurrentRoster();
            setCwlStatus(rosterId, "Suggesting...", false);
            renderCwlPerfTable();
            const res = await runServerMethod("computeBenchSuggestions", [cloneCurrentRosterDataForServer_(), rosterId, state.password]);
            applyMergedRosterPreview(rosterId, res && res.rosterData);
            const summary = res && res.result ? res.result : {};
            setCwlStatus(rosterId, formatSuggestionStatus(summary), false);
            renderCwlPerfTable();
          } catch (err) {
            failTrackingStep(err);
          }
        }
      } catch (err) {
        const msg = toErrorMessage(err);
        setClanSyncStatus(rosterId, msg, true);
        setCwlStatus(rosterId, msg, true);
        renderClanSyncTable();
        renderCwlPerfTable();
        addIssue(msg);
      } finally {
        updateProgress();
      }

      return issues;
    };

    setStatus("Refresh all running: 0/" + totalRosters + " rosters complete.");
    let issues = [];
    try {
      for (let i = 0; i < rosters.length; i++) {
        const rosterId = toStr(rosters[i] && rosters[i].id).trim();
        if (!rosterId) continue;
        const rosterIssues = await runRefreshAllRosterPipeline(rosterId);
        if (Array.isArray(rosterIssues) && rosterIssues.length) {
          issues = issues.concat(rosterIssues);
        }
      }
    } finally {
      state.bulkRefreshBusy = false;
      refreshAdminWorkflowUi();
    }

    if (issues.length) {
      setStatus("Refresh all complete with " + issues.length + " issue(s).");
    } else {
      setStatus("Refresh all complete.");
    }
  };

  const init = () => {
    window.ROSTER_ROSTER_ACTION_BUILDER = buildRosterActionControls;
    window.ROSTER_PLAYER_ACTION_BUILDER = buildPlayerActionControls;
    window.ROSTER_GET_ADMIN_PASSWORD = () => state.password || "";
    window.ROSTER_OPEN_PLAYER_EDIT = openPlayerEditPanel;

    renderPreviewFromState();
    renderImportUi();

    const toggleAddPlayerPanelBtn = $("#toggleAddPlayerPanelBtn");
    const toggleAddPreviewRosterPanelBtn = $("#toggleAddPreviewRosterPanelBtn");
    if (toggleAddPreviewRosterPanelBtn) {
      setAddPreviewRosterPanelOpen(false);
      toggleAddPreviewRosterPanelBtn.onclick = () => {
        if (toggleAddPreviewRosterPanelBtn.disabled) return;
        const panel = $("#addPreviewRosterPanel");
        const isOpen = !!(panel && !panel.classList.contains("hidden"));
        setAddPreviewRosterPanelOpen(!isOpen);
      };
    }

    if (toggleAddPlayerPanelBtn) {
      setAddPlayerPanelOpen(false);
      toggleAddPlayerPanelBtn.onclick = () => {
        if (toggleAddPlayerPanelBtn.disabled) return;
        const panel = $("#addPlayerPanel");
        const isOpen = !!(panel && !panel.classList.contains("hidden"));
        setAddPlayerPanelOpen(!isOpen);
      };
    }

    const handleUnlock = async () => {
      state.password = toStr($("#pw") && $("#pw").value).trim();
      if (!state.password) {
        setLoginStatus("Password is empty.");
        renderAutoRefreshUi();
        return;
      }

      try {
        setLoginStatus("Verifying...");
        await new Promise((resolve, reject) => {
          if (!window.google || !google.script || !google.script.run) {
            reject(new Error("google.script.run is not available."));
            return;
          }
          google.script.run
            .withSuccessHandler((r) => resolve(r))
            .withFailureHandler((e) => reject(e && e.message ? new Error(e.message) : e))
            .verifyAdminPassword(state.password);
        });

        show("#adminPanel", true);
        setLoginStatus("Unlocked.");
        refreshAdminWorkflowUi();
        try {
          await loadAutoRefreshSettings();
        } catch (settingsErr) {
          alert("Unlocked, but failed to load auto-refresh settings: " + toErrorMessage(settingsErr));
        }
      } catch (err) {
        show("#adminPanel", false);
        setLoginStatus("Authentication failed.");
        state.password = "";
        state.autoRefreshSettings = null;
        state.autoRefreshBusy = false;
        renderAutoRefreshUi();
        alert("Unlock failed: " + toErrorMessage(err));
      }
    };

    const loginBtn = $("#loginBtn");
    const pwInput = $("#pw");
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.textContent = "Unlock";
      loginBtn.onclick = handleUnlock;
    }
    if (pwInput) {
      pwInput.addEventListener("keydown", (e) => {
        if (!e || e.key !== "Enter") return;
        e.preventDefault();
        if (loginBtn && loginBtn.disabled) return;
        handleUnlock();
      });
    }
    setLoginStatus("");

    const refreshAllBtn = $("#refreshAllBtn");
    if (refreshAllBtn) {
      refreshAllBtn.onclick = async () => {
        try {
          await runRefreshAll();
        } catch (err) {
          setStatus("");
          alert("Refresh all failed: " + toErrorMessage(err));
        }
      };
    }

    const autoRefreshToggle = $("#autoRefreshToggle");
    if (autoRefreshToggle) {
      autoRefreshToggle.addEventListener("change", async () => {
        const desired = !!autoRefreshToggle.checked;
        try {
          await updateAutoRefreshEnabled(desired);
        } catch (err) {
          renderAutoRefreshUi();
          alert("Auto-refresh update failed: " + toErrorMessage(err));
        }
      });
    }
    renderAutoRefreshUi();

    const excludeWarOutInput = $("#excludeWarOut");
    const requireDiscordInput = $("#requireDiscord");
    const handleImportFilterChange = () => {
      if (!state.importSession) return;
      state.importSession.filters = window.RosterGenerator.normalizeImportFilters(readImportFiltersFromUi());
      invalidateImportComparison("Filters changed. Re-run compare with preview.");
      renderImportUi();
    };
    if (excludeWarOutInput) {
      excludeWarOutInput.checked = true;
      excludeWarOutInput.addEventListener("change", handleImportFilterChange);
    }
    if (requireDiscordInput) {
      requireDiscordInput.checked = false;
      requireDiscordInput.addEventListener("change", handleImportFilterChange);
    }

    $("#addPlayerBtn").onclick = () => {
      const rosterSelect = $("#addPlayerRoster");
      const nameInput = $("#addPlayerName");
      const discordInput = $("#addPlayerDiscord");
      const thInput = $("#addPlayerTh");
      const tagInput = $("#addPlayerTag");
      const notesInput = $("#addPlayerNotes");

      try {
        const selectedRosterId = toStr(rosterSelect && rosterSelect.value).trim();
        addPlayerToPreview({
          rosterId: selectedRosterId,
          name: toStr(nameInput && nameInput.value),
          discord: toStr(discordInput && discordInput.value),
          th: toStr(thInput && thInput.value),
          tag: toStr(tagInput && tagInput.value),
          notes: parseNotesFromTextarea(notesInput && notesInput.value),
        });

        if (nameInput) nameInput.value = "";
        if (discordInput) discordInput.value = "";
        if (thInput) thInput.value = "";
        if (tagInput) tagInput.value = "";
        if (notesInput) notesInput.value = "";

        setAddPlayerStatus("Player added.", false);
      } catch (err) {
        setAddPlayerStatus("Add failed: " + toErrorMessage(err), true);
      }
    };

    $("#addPreviewRosterBtn").onclick = () => {
      const idInput = $("#addPreviewRosterId");
      const titleInput = $("#addPreviewRosterTitle");
      const clanTagInput = $("#addPreviewRosterClanTag");
      const trackingModeInput = $("#addPreviewRosterTrackingMode");

      try {
        addRosterToPreview({
          id: toStr(idInput && idInput.value),
          title: toStr(titleInput && titleInput.value),
          connectedClanTag: toStr(clanTagInput && clanTagInput.value),
          trackingMode: toStr(trackingModeInput && trackingModeInput.value),
        });

        if (idInput) idInput.value = "";
        if (titleInput) titleInput.value = "";
        if (clanTagInput) clanTagInput.value = "";
        if (trackingModeInput) trackingModeInput.value = "cwl";

        setAddPreviewRosterStatus("Roster added.", false);
      } catch (err) {
        setAddPreviewRosterStatus("Add failed: " + toErrorMessage(err), true);
      }
    };

    $("#loadActiveBtn").onclick = async () => {
      try {
        setStatus("Loading active config...");
        const rosterData = await loadActiveRosterData();
        if (!rosterData || !Array.isArray(rosterData.rosters)) {
          throw new Error("Active roster data is invalid. Expected: { rosters: [...] }");
        }

        const pageTitleInput = $("#pageTitle");
        if (pageTitleInput) pageTitleInput.value = toStr(rosterData.pageTitle).trim() || "Roster Overview";

        state.lastRosterData = rosterData;
        normalizeRosterOrderInData_(state.lastRosterData);
        clearRosterStatuses();
        state.benchMarksByRoster = {};
        state.swapInMarksByRoster = {};
        state.suggestionNotesByRoster = {};
        reindexAllRosters();
        setAddPreviewRosterStatus("", false);
        setAddPlayerStatus("", false);

        if (state.importSession) {
          alignImportMappingWithPreview();
          invalidateImportComparison("Preview changed after loading active config. Re-run compare with preview.");
        }

        renderPreviewFromState();
        const publishBtn = $("#publishBtn");
        if (publishBtn) publishBtn.disabled = false;
        setStatus("Active config loaded.");
      } catch (err) {
        setStatus("");
        alert("Failed to load active config: " + toErrorMessage(err));
      }
    };

    const xlsxInput = $("#xlsxInput");
    if (xlsxInput) {
      xlsxInput.onchange = async (e) => {
        const file = e && e.target && e.target.files ? e.target.files[0] : null;
        if (!file) return;
        const failedFileName = toStr(file && file.name).trim();
        try {
          setStatus("Reading XLSX...");
          const nextSession = await loadXlsxImportSession(file);
          state.importSession = nextSession;
          clearImportLoadWarning();

          if (excludeWarOutInput) excludeWarOutInput.checked = !!nextSession.filters.excludeWarOut;
          if (requireDiscordInput) requireDiscordInput.checked = !!nextSession.filters.requireDiscord;

          renderImportUi();
          const parsed = Array.isArray(nextSession.accounts) ? nextSession.accounts.length : 0;
          setImportActionStatus("Import loaded. Run compare with preview.", false);
          setStatus("Imported " + parsed + " member row(s) from sheet '" + (nextSession.sheetName || "first sheet") + "'.");
        } catch (err) {
          setImportLoadFailureWarning(failedFileName, err);
          const keepActive = !!state.importSession;
          setStatus(keepActive
            ? "Failed to load new XLSX. Previous import session remains active."
            : "Failed to load XLSX.");
          setImportActionStatus(keepActive
            ? "Load failed. Previous import session remains active."
            : "Load failed. No import session is active.", true);
          renderImportUi();
          alert("Failed to load XLSX: " + toErrorMessage(err));
        }
      };
    }

    const compareImportBtn = $("#compareImportBtn");
    if (compareImportBtn) {
      compareImportBtn.onclick = async () => {
        try {
          await runImportComparison();
        } catch (err) {
          setImportActionStatus("", false);
          alert("Compare failed: " + toErrorMessage(err));
          renderImportUi();
        }
      };
    }

    const applyImportBtn = $("#applyImportBtn");
    if (applyImportBtn) {
      applyImportBtn.onclick = async () => {
        try {
          await applyImportComparison();
        } catch (err) {
          setImportActionStatus("", false);
          alert("Apply failed: " + toErrorMessage(err));
          renderImportUi();
        }
      };
    }

    $("#publishBtn").onclick = async () => {
      try {
        if (!state.lastRosterData) throw new Error("Load active config first.");
        const now = Date.now();
        if (now < state.publishCooldownUntil) throw new Error("Publish cooldown: please wait a few seconds.");

        const pw = (state.password || toStr($("#pw") && $("#pw").value)).trim();
        if (!pw) throw new Error("Password is missing.");

        syncRosterOrderFromCurrentArray_(state.lastRosterData);
        normalizeRosterOrderInData_(state.lastRosterData);

        $("#publishBtn").disabled = true;
        setStatus("Publishing...");

        const publishResult = await new Promise((resolve, reject) => {
          if (!window.google || !google.script || !google.script.run) {
            reject(new Error("google.script.run is not available."));
            return;
          }

          google.script.run
            .withSuccessHandler((r) => resolve(r))
            .withFailureHandler((e) => reject(e && e.message ? new Error(e.message) : e))
            .publishRosterData(state.lastRosterData, pw);
        });

        state.publishCooldownUntil = Date.now() + 10_000;
        const playerCount = publishResult && Number.isFinite(Number(publishResult.playerCount)) ? Number(publishResult.playerCount) : null;
        const noteCount = publishResult && Number.isFinite(Number(publishResult.noteCount)) ? Number(publishResult.noteCount) : null;
        const metricEntryCount = publishResult && Number.isFinite(Number(publishResult.metricEntryCount))
          ? Number(publishResult.metricEntryCount)
          : null;
        if (playerCount != null && noteCount != null && metricEntryCount != null) {
          setStatus("Published successfully (" + playerCount + " players, " + noteCount + " notes, " + metricEntryCount + " metric entries).");
        } else if (playerCount != null && noteCount != null) {
          setStatus("Published successfully (" + playerCount + " players, " + noteCount + " notes).");
        } else {
          setStatus("Published successfully.");
        }

        setTimeout(() => {
          $("#publishBtn").disabled = false;
          setStatus("Ready.");
        }, 10_000);
      } catch (err) {
        $("#publishBtn").disabled = false;
        setStatus("");
        alert("Publish failed: " + toErrorMessage(err));
      }
    };
  };

  document.addEventListener("DOMContentLoaded", init);
})();
