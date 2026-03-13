(() => {
  const $ = (sel) => document.querySelector(sel);
  const toStr = (v) => (v == null ? "" : String(v));

  const state = {
    password: "",
    rows: null,
    accounts: null,
    lastRosterData: null,
    lastReport: null,
    publishCooldownUntil: 0,
    bulkRefreshBusy: false,
    clanSyncStatusByRoster: {},
    cwlStatusByRoster: {},
    benchMarksByRoster: {},
    swapInMarksByRoster: {},
    suggestionNotesByRoster: {},
    pendingProfileReopen: null,
    autoRefreshSettings: null,
    autoRefreshBusy: false,
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

  const setClanSyncStatus = (rosterIdRaw, msg, isError) => {
    const rosterId = toStr(rosterIdRaw).trim();
    if (!rosterId) return;
    state.clanSyncStatusByRoster[rosterId] = {
      msg: msg || "",
      isError: !!isError,
    };
  };

  const setCwlStatus = (rosterIdRaw, msg, isError) => {
    const rosterId = toStr(rosterIdRaw).trim();
    if (!rosterId) return;
    state.cwlStatusByRoster[rosterId] = {
      msg: msg || "",
      isError: !!isError,
    };
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

  const parseOverrides = () => {
    const raw = toStr($("#overridesJson") && $("#overridesJson").value).trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new Error("Overrides JSON is not valid: " + (err && err.message ? err.message : String(err)));
    }
  };

  const normalizeTag = (tag) => {
    const t = toStr(tag).trim().toUpperCase();
    if (!t) return "";
    return t.startsWith("#") ? t : ("#" + t);
  };

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

    state.lastRosterData = mergedRosterData;
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
    const inputs = Array.from(document.querySelectorAll('#clanSyncTable [data-clan-sync-tag-input="1"]'));
    for (const input of inputs) {
      const rosterId = toStr(input && input.dataset && input.dataset.rosterId).trim();
      const roster = getRosterById(rosterId);
      if (!roster) continue;
      const normalized = normalizeTag(input && input.value);
      input.value = normalized;
      roster.connectedClanTag = normalized;
    }
  };

  const formatRosterPoolStatus = (result) => {
    const data = result && typeof result === "object" ? result : {};
    const mode = toStr(data.mode).trim() === "regularWar" ? "regularWar" : "cwl";
    const added = Number.isFinite(Number(data.added)) ? Number(data.added) : 0;
    const removed = Number.isFinite(Number(data.removed)) ? Number(data.removed) : 0;
    const updated = Number.isFinite(Number(data.updated)) ? Number(data.updated) : 0;
    const sourceUsed = toStr(data.sourceUsed).trim() || "members";
    if (mode === "regularWar") {
      const movedToMissing = Number.isFinite(Number(data.movedToMissing)) ? Number(data.movedToMissing) : 0;
      const restored = Number.isFinite(Number(data.restored)) ? Number(data.restored) : 0;
      const retainedMissing = Number.isFinite(Number(data.retainedMissing)) ? Number(data.retainedMissing) : 0;
      return "added " + added + ", removed " + removed + ", updated " + updated + ", movedToMissing " + movedToMissing + ", restored " + restored + ", retainedMissing " + retainedMissing + ", sourceUsed " + sourceUsed;
    }
    return "added " + added + ", removed " + removed + ", updated " + updated + ", sourceUsed " + sourceUsed;
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
    if (mode === "regularWar") {
      const currentUnavailable = toStr(data.currentWarUnavailableReason).trim() === "privateWarLog";
      const aggregateUnavailable = toStr(data.aggregateUnavailableReason).trim() === "privateWarLog";
      if (currentUnavailable && aggregateUnavailable) {
        return "live war unavailable, aggregate stale (private war log)";
      }
      if (currentUnavailable) {
        return "live war unavailable (private war log), aggregate refreshed";
      }
      if (aggregateUnavailable) {
        return "live war ok, aggregate stale (private war log)";
      }
      const currentWarState = toStr(data.currentWarState).trim().toLowerCase() || "notinwar";
      const warLogAvailable = !!data.warLogAvailable;
      const teamSize = Number.isFinite(Number(data.teamSize)) ? Number(data.teamSize) : 0;
      const attacksPerMember = Number.isFinite(Number(data.attacksPerMember)) ? Number(data.attacksPerMember) : 0;
      return "state " + currentWarState + ", playersTracked " + playersTracked + ", warsProcessed " + warsProcessed + ", warLogAvailable " + (warLogAvailable ? "yes" : "no") + ", teamSize " + teamSize + ", attacksPerMember " + attacksPerMember;
    }
    return "warsProcessed " + warsProcessed + ", playersTracked " + playersTracked;
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
      if (hint) hint.textContent = "Load active config or generate preview first.";
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
      if (hint) hint.textContent = "Load active config or generate preview first.";
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
      renderClanSyncTable();
      renderCwlPerfTable();
      applyBenchMarks_();
      return;
    }
    syncSuggestionStateFromRosterData_();
    window.renderRosterData(state.lastRosterData);
    refreshAddPreviewRosterUi();
    refreshAddPlayerUi();
    refreshRefreshAllUi();
    renderClanSyncTable();
    renderCwlPerfTable();
    applyBenchMarks_();
  };

  const markReportStale = () => {
    state.lastReport = null;
    const report = $("#report");
    if (report) report.textContent = "Manual preview edits were applied. Regenerate preview to refresh report.";
    show("#reportWrap", true);
  };

  const applyPreviewMutation = (msg) => {
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

    syncRosterSpecsFromRosterData(state.lastRosterData);
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
    delete state.clanSyncStatusByRoster[rosterId];
    delete state.cwlStatusByRoster[rosterId];
    clearSuggestionMarksForRoster_(rosterId);

    syncRosterSpecsFromRosterData(state.lastRosterData);

    const rosterTitle = toStr(removedRoster.title).trim();
    const rosterLabel = rosterTitle ? (rosterTitle + " (" + rosterId + ")") : rosterId;
    applyPreviewMutation(rosterLabel + " removed. Publish to apply this change to live data.");
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

  const addRosterRow = (spec) => {
    const tbody = $("#rosterTable tbody");
    if (!tbody) return;

    const tr = document.createElement("tr");

    const mkInput = (value, type = "text") => {
      const input = document.createElement("input");
      input.className = "admin-input";
      input.type = type;
      input.value = value == null ? "" : String(value);
      return input;
    };

    const mkSelect = (value) => {
      const sel = document.createElement("select");
      sel.className = "admin-select";
      for (const opt of ["competitive", "standard", "relaxed"]) {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        if (String(value).toLowerCase() === opt) o.selected = true;
        sel.appendChild(o);
      }
      return sel;
    };

    const tdId = document.createElement("td");
    const tdTitle = document.createElement("td");
    const tdMain = document.createElement("td");
    const tdSubs = document.createElement("td");
    const tdDiff = document.createElement("td");
    const tdDel = document.createElement("td");

    const idInput = mkInput(spec && spec.id ? spec.id : "R1");
    const titleInput = mkInput(spec && spec.title ? spec.title : "Roster 1");
    const mainInput = mkInput(spec && spec.mainCount != null ? spec.mainCount : 15, "number");
    const subInput = mkInput(spec && spec.subCount != null ? spec.subCount : 5, "number");
    const diffSel = mkSelect(spec && spec.difficulty ? spec.difficulty : "competitive");

    const delBtn = document.createElement("button");
    delBtn.className = "btn secondary";
    delBtn.type = "button";
    delBtn.textContent = "Remove";
    delBtn.onclick = () => tr.remove();

    tdId.appendChild(idInput);
    tdTitle.appendChild(titleInput);
    tdMain.appendChild(mainInput);
    tdSubs.appendChild(subInput);
    tdDiff.appendChild(diffSel);
    tdDel.appendChild(delBtn);

    tr.appendChild(tdId);
    tr.appendChild(tdTitle);
    tr.appendChild(tdMain);
    tr.appendChild(tdSubs);
    tr.appendChild(tdDiff);
    tr.appendChild(tdDel);

    tbody.appendChild(tr);
  };

  const readRosterSpecs = () => {
    const tbody = $("#rosterTable tbody");
    if (!tbody) return [];
    const rows = Array.from(tbody.querySelectorAll("tr"));
    return rows.map((tr) => {
      const inputs = tr.querySelectorAll("input,select");
      const id = inputs[0] ? inputs[0].value : "";
      const title = inputs[1] ? inputs[1].value : "";
      const mainCount = inputs[2] ? parseInt(inputs[2].value, 10) : 0;
      const subCount = inputs[3] ? parseInt(inputs[3].value, 10) : 0;
      const difficulty = inputs[4] ? inputs[4].value : "standard";
      return { id, title, mainCount, subCount, difficulty };
    });
  };

  const syncRosterSpecsFromRosterData = (rosterData) => {
    const tbody = $("#rosterTable tbody");
    if (!tbody) return;

    const prevSpecs = readRosterSpecs();
    const prevDifficultyById = {};
    for (const s of prevSpecs) {
      const id = toStr(s && s.id).trim();
      const diff = toStr(s && s.difficulty).trim().toLowerCase();
      if (!id) continue;
      if (diff === "competitive" || diff === "standard" || diff === "relaxed") {
        prevDifficultyById[id] = diff;
      }
    }

    const rosters = rosterData && Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
    tbody.textContent = "";

    for (let i = 0; i < rosters.length; i++) {
      const r = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
      const id = toStr(r.id).trim() || ("R" + (i + 1));
      const title = toStr(r.title).trim() || ("Roster " + (i + 1));
      const mainCount = Array.isArray(r.main) ? r.main.length : 0;
      const subCount = Array.isArray(r.subs) ? r.subs.length : 0;

      const dataDifficulty = toStr(r.difficulty).trim().toLowerCase();
      const difficulty = (dataDifficulty === "competitive" || dataDifficulty === "standard" || dataDifficulty === "relaxed")
        ? dataDifficulty
        : (prevDifficultyById[id] || "standard");

      addRosterRow({ id, title, mainCount, subCount, difficulty });
    }
  };

  const readFilters = () => {
    const excludeWarOut = !!($("#excludeWarOut") && $("#excludeWarOut").checked);
    const requireDiscord = !!($("#requireDiscord") && $("#requireDiscord").checked);
    const allowedRaw = toStr($("#allowedClans") && $("#allowedClans").value).trim();
    const allowedClans = allowedRaw ? allowedRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;
    return { excludeWarOut, requireDiscord, allowedClans };
  };

  const loadXlsx = async (file) => {
    if (!file) throw new Error("No XLSX file selected.");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: "" });
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
    reindexAllRosters();
    clearSuggestionMarks_();
    renderPreviewFromState();
    markReportStale();
    const publishBtn = $("#publishBtn");
    if (publishBtn) publishBtn.disabled = false;
    if (statusMsg) setStatus(statusMsg);
  };

  const renderClanSyncTable = () => {
    const tbody = $("#clanSyncTable tbody");
    if (!tbody) return;

    const rosters = getRosters();
    tbody.textContent = "";

    if (!rosters.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5;
      td.className = "small muted";
      td.textContent = "Load active config or generate preview first.";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    for (const roster of rosters) {
      const r = roster && typeof roster === "object" ? roster : {};
      ensureRosterArrays(r);
      const rosterId = toStr(r.id).trim();
      if (!rosterId) continue;
      const rosterTitle = toStr(r.title).trim();
      const label = rosterTitle ? (rosterTitle + " (" + rosterId + ")") : rosterId;

      const tr = document.createElement("tr");

      const tdRoster = document.createElement("td");
      tdRoster.textContent = label;

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
      trackingSelect.value = getRosterTrackingMode(r);
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

      const syncTodayBtn = document.createElement("button");
      syncTodayBtn.type = "button";
      syncTodayBtn.className = "clan-sync-btn";
      syncTodayBtn.textContent = getRosterTrackingMode(r) === "regularWar" ? "Sync current war lineup" : "Sync today lineup";

      actions.appendChild(testBtn);
      actions.appendChild(syncPoolBtn);
      actions.appendChild(syncTodayBtn);
      tdActions.appendChild(actions);

      const tdStatus = document.createElement("td");
      tdStatus.className = "small muted";

      const applyRowStatus = () => {
        const saved = state.clanSyncStatusByRoster[rosterId];
        if (!saved || !saved.msg) {
          tdStatus.textContent = "";
          tdStatus.style.color = "#6b7280";
          return;
        }
        tdStatus.textContent = saved.msg;
        tdStatus.style.color = saved.isError ? "#fca5a5" : "#6b7280";
      };

      const setRowStatus = (msg, isError) => {
        setClanSyncStatus(rosterId, msg, isError);
        applyRowStatus();
      };
      applyRowStatus();

      const setBusy = (busy) => {
        const disabled = !!busy || state.bulkRefreshBusy;
        trackingSelect.disabled = disabled;
        tagInput.disabled = disabled;
        testBtn.disabled = disabled;
        syncPoolBtn.disabled = disabled;
        syncTodayBtn.disabled = disabled;
      };

      const persistConnectedTag = () => {
        const normalized = normalizeTag(tagInput.value);
        tagInput.value = normalized;
        if (toStr(r.connectedClanTag).trim() !== normalized) {
          r.connectedClanTag = normalized;
          const publishBtn = $("#publishBtn");
          if (publishBtn) publishBtn.disabled = false;
          setStatus("Connected clan tag updated for " + rosterId + ".");
        }
      };

      tagInput.addEventListener("change", persistConnectedTag);
      tagInput.addEventListener("blur", persistConnectedTag);
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
        renderPreviewFromState();
      });

      const ensureReady = () => {
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
      };

      testBtn.onclick = async () => {
        try {
          ensureReady();
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
          ensureReady();
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

      syncTodayBtn.onclick = async () => {
        try {
          ensureReady();
          const mode = getRosterTrackingMode(r);
          setBusy(true);
          setRowStatus(mode === "regularWar" ? "Syncing current war lineup..." : "Syncing today lineup...", false);
          const res = await runServerMethod("syncClanTodayLineup", [state.lastRosterData, rosterId, state.password]);
          const result = res && res.result ? res.result : {};
          const msg = toStr(result.message).trim();
          const statusText = formatTodayLineupStatus(result);
          setRowStatus(statusText, false);
          if (mode === "cwl" && msg.toLowerCase() === "no current cwl war found") {
            setStatus("No current CWL war found for " + rosterId + ".");
          } else {
            applyServerSyncedPreview(
              res && res.rosterData,
              mode === "regularWar"
                ? "Current war lineup synced for " + rosterId + "."
                : "Today lineup synced for " + rosterId + "."
            );
          }
        } catch (err) {
          setRowStatus(toErrorMessage(err), true);
        } finally {
          setBusy(false);
        }
      };

      setBusy(false);

      tr.appendChild(tdRoster);
      tr.appendChild(tdTracking);
      tr.appendChild(tdTag);
      tr.appendChild(tdActions);
      tr.appendChild(tdStatus);
      tbody.appendChild(tr);
    }
  };

  const renderCwlPerfTable = () => {
    const tbody = $("#cwlPerfTable tbody");
    if (!tbody) return;

    const rosters = getRosters();
    tbody.textContent = "";

    if (!rosters.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.className = "small muted";
      td.textContent = "Load active config or generate preview first.";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    for (const roster of rosters) {
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

      const tdActions = document.createElement("td");
      const actions = document.createElement("div");
      actions.className = "clan-sync-actions";

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

      actions.appendChild(refreshBtn);
      actions.appendChild(suggestBtn);
      actions.appendChild(clearBtn);
      tdActions.appendChild(actions);

      const tdStatus = document.createElement("td");
      tdStatus.className = "small muted";

      const applyRowStatus = () => {
        const saved = state.cwlStatusByRoster[rosterId];
        if (!saved || !saved.msg) {
          tdStatus.textContent = "";
          tdStatus.style.color = "#6b7280";
          return;
        }
        tdStatus.textContent = saved.msg;
        tdStatus.style.color = saved.isError ? "#fca5a5" : "#6b7280";
      };

      const setRowStatus = (msg, isError) => {
        setCwlStatus(rosterId, msg, isError);
        applyRowStatus();
      };
      applyRowStatus();

      const setBusy = (busy) => {
        const disabled = !!busy || state.bulkRefreshBusy;
        refreshBtn.disabled = disabled;
        suggestBtn.disabled = disabled || trackingMode !== "cwl";
        clearBtn.disabled = disabled;
      };

      const ensureReady = () => {
        if (!state.lastRosterData || !Array.isArray(state.lastRosterData.rosters)) {
          throw new Error("No roster preview is loaded.");
        }
        if (!state.password) {
          throw new Error("Unlock admin first.");
        }
        if (state.bulkRefreshBusy) {
          throw new Error("Refresh all is already running.");
        }
      };

      refreshBtn.onclick = async () => {
        try {
          ensureReady();
          setBusy(true);
          setRowStatus("Refreshing...", false);
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
          ensureReady();
          setBusy(true);
          setRowStatus("Suggesting...", false);
          const res = await runServerMethod("computeBenchSuggestions", [state.lastRosterData, rosterId, state.password]);
          if (res && res.rosterData && Array.isArray(res.rosterData.rosters)) {
            state.lastRosterData = res.rosterData;
            reindexAllRosters();
          }
          const summary = applySuggestionResponseToState(rosterId, res);
          renderPreviewFromState();
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
        setRowStatus("saved suggestions cleared", false);
      };

      setBusy(false);

      tr.appendChild(tdRoster);
      tr.appendChild(tdActions);
      tr.appendChild(tdStatus);
      tbody.appendChild(tr);
    }
  };

  const refreshAdminWorkflowUi = () => {
    refreshRefreshAllUi();
    renderClanSyncTable();
    renderCwlPerfTable();
    applyBenchMarks_();
  };

  const runRefreshAll = async () => {
    if (state.bulkRefreshBusy) {
      throw new Error("Refresh all is already running.");
    }
    if (!state.lastRosterData || !Array.isArray(state.lastRosterData.rosters)) {
      throw new Error("Load active config or generate preview first.");
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
        if (!normalizeTag(currentRoster.connectedClanTag)) {
          throw new Error("Connected clan tag is required.");
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
      const issueLists = await Promise.all(
        rosters.map((roster) => runRefreshAllRosterPipeline(toStr(roster && roster.id).trim()))
      );
      issues = issueLists.reduce((all, list) => all.concat(Array.isArray(list) ? list : []), []);
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

    addRosterRow({ id: "R1", title: "Roster", mainCount: 15, subCount: 5, difficulty: "competitive" });

    renderPreviewFromState();

    const importBody = $("#importWorkflowBody");
    const toggleImportWorkflowBtn = $("#toggleImportWorkflowBtn");
    if (importBody && toggleImportWorkflowBtn) {
      const setImportCollapsed = (collapsed) => {
        importBody.classList.toggle("hidden", collapsed);
        toggleImportWorkflowBtn.textContent = collapsed ? "Expand" : "Collapse";
        toggleImportWorkflowBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      };
      setImportCollapsed(true);
      toggleImportWorkflowBtn.onclick = () => {
        const isCollapsed = importBody.classList.contains("hidden");
        setImportCollapsed(!isCollapsed);
      };
    }

    const overridesBody = $("#overridesSectionBody");
    const toggleOverridesBtn = $("#toggleOverridesBtn");
    if (overridesBody && toggleOverridesBtn) {
      const setOverridesCollapsed = (collapsed) => {
        overridesBody.classList.toggle("hidden", collapsed);
        toggleOverridesBtn.textContent = collapsed ? "Expand" : "Collapse";
        toggleOverridesBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      };
      setOverridesCollapsed(true);
      toggleOverridesBtn.onclick = () => {
        const isCollapsed = overridesBody.classList.contains("hidden");
        setOverridesCollapsed(!isCollapsed);
      };
    }

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

    const clanSyncBody = $("#clanSyncBody");
    const toggleClanSyncBtn = $("#toggleClanSyncBtn");
    if (clanSyncBody && toggleClanSyncBtn) {
      const setClanSyncCollapsed = (collapsed) => {
        clanSyncBody.classList.toggle("hidden", collapsed);
        toggleClanSyncBtn.textContent = collapsed ? "Expand" : "Collapse";
        toggleClanSyncBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      };
      setClanSyncCollapsed(true);
      toggleClanSyncBtn.onclick = () => {
        const isCollapsed = clanSyncBody.classList.contains("hidden");
        setClanSyncCollapsed(!isCollapsed);
      };
    }

    const cwlPerfBody = $("#cwlPerfBody");
    const toggleCwlPerfBtn = $("#toggleCwlPerfBtn");
    if (cwlPerfBody && toggleCwlPerfBtn) {
      const setCwlPerfCollapsed = (collapsed) => {
        cwlPerfBody.classList.toggle("hidden", collapsed);
        toggleCwlPerfBtn.textContent = collapsed ? "Expand" : "Collapse";
        toggleCwlPerfBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      };
      setCwlPerfCollapsed(true);
      toggleCwlPerfBtn.onclick = () => {
        const isCollapsed = cwlPerfBody.classList.contains("hidden");
        setCwlPerfCollapsed(!isCollapsed);
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
        refreshRefreshAllUi();
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

    $("#addRosterBtn").onclick = () => {
      const idx = (Date.now() % 1000);
      addRosterRow({ id: "R" + idx, title: "Roster " + idx, mainCount: 15, subCount: 5, difficulty: "standard" });
    };

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

        syncRosterSpecsFromRosterData(rosterData);
        const pageTitleInput = $("#pageTitle");
        if (pageTitleInput) pageTitleInput.value = toStr(rosterData.pageTitle).trim() || "Roster Overview";

        state.lastRosterData = rosterData;
        state.lastReport = null;
        state.clanSyncStatusByRoster = {};
        state.cwlStatusByRoster = {};
        state.benchMarksByRoster = {};
        state.swapInMarksByRoster = {};
        state.suggestionNotesByRoster = {};
        reindexAllRosters();
        setAddPreviewRosterStatus("", false);
        setAddPlayerStatus("", false);

        renderPreviewFromState();

        $("#report").textContent = "Loaded active roster-data.json from server.";
        show("#reportWrap", true);
        $("#publishBtn").disabled = false;
        setStatus("Active config loaded.");
      } catch (err) {
        setStatus("");
        alert("Failed to load active config: " + toErrorMessage(err));
      }
    };

    $("#xlsxInput").onchange = async (e) => {
      try {
        const f = e && e.target && e.target.files ? e.target.files[0] : null;
        setStatus("Reading XLSX...");
        const rows = await loadXlsx(f);
        state.rows = rows;

        const accounts = window.RosterGenerator.normalizeAccountsFromXlsxRows(rows);
        state.accounts = accounts;

        if (accounts.length > 200) {
          setStatus("Imported " + accounts.length + " players (above recommended limit: 200).");
        } else {
          setStatus("Imported " + accounts.length + " players.");
        }
      } catch (err) {
        setStatus("");
        alert(toErrorMessage(err));
      }
    };

    $("#previewBtn").onclick = async () => {
      try {
        if (!state.accounts) throw new Error("Import an XLSX file first.");
        if (state.accounts.length === 0) throw new Error("XLSX import is empty.");
        if (state.accounts.length > 250) throw new Error("Too many players (" + state.accounts.length + "). Please reduce the XLSX input.");

        const rosterSpecs = readRosterSpecs();
        const filters = readFilters();
        const overrides = parseOverrides();

        const pageTitle = toStr($("#pageTitle") && $("#pageTitle").value).trim() || "Roster Overview";

        setStatus("Generating...");
        const res = window.RosterGenerator.generateRosterData({
          pageTitle,
          schemaVersion: 1,
          rosterSpecs,
          accounts: state.accounts,
          filters,
          overrides,
        });

        state.lastRosterData = res.rosterData;
        state.lastReport = res.report;
        state.clanSyncStatusByRoster = {};
        state.cwlStatusByRoster = {};
        state.benchMarksByRoster = {};
        state.swapInMarksByRoster = {};
        state.suggestionNotesByRoster = {};
        reindexAllRosters();
        setAddPreviewRosterStatus("", false);
        setAddPlayerStatus("", false);

        renderPreviewFromState();

        $("#report").textContent = jsonPretty(res.report);
        show("#reportWrap", true);

        $("#publishBtn").disabled = false;
        setStatus("Preview ready.");
      } catch (err) {
        $("#publishBtn").disabled = true;
        setStatus("");
        alert(toErrorMessage(err));
      }
    };

    $("#publishBtn").onclick = async () => {
      try {
        if (!state.lastRosterData) throw new Error("Generate a preview first.");
        const now = Date.now();
        if (now < state.publishCooldownUntil) throw new Error("Publish cooldown: please wait a few seconds.");

        const pw = (state.password || toStr($("#pw") && $("#pw").value)).trim();
        if (!pw) throw new Error("Password is missing.");

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
        if (playerCount != null && noteCount != null) {
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
