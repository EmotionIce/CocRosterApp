// Cloudflare admin client state, rendering, and interaction helpers.

(() => {
  // Select the first element that matches a selector.
  const $ = (sel) => document.querySelector(sel);
  // Convert a value to a string safely.
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
    activeAdminTab: "rosters",
    modalFocusReturnByPanel: {},
  };

  // Set the global status message.
  const setStatus = (msg) => {
    const el = $("#status");
    if (el) el.textContent = msg || "";
  };

  // Set the add player status message.
  const setAddPlayerStatus = (msg, isError) => {
    const el = $("#addPlayerStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "#fca5a5" : "#6b7280";
  };

  // Set the add preview roster status message.
  const setAddPreviewRosterStatus = (msg, isError) => {
    const el = $("#addPreviewRosterStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "#fca5a5" : "#6b7280";
  };

  // Set the roster status message.
  const setRosterStatus = (rosterIdRaw, msg, isError) => {
    const rosterId = toStr(rosterIdRaw).trim();
    if (!rosterId) return;
    state.rosterStatusByRoster[rosterId] = {
      msg: msg || "",
      isError: !!isError,
    };
  };

  // Clear roster statuses.
  const clearRosterStatuses = () => {
    state.rosterStatusByRoster = {};
  };

  // Set the login status message.
  const setLoginStatus = (msg) => {
    const el = $("#loginStatus");
    if (el) el.textContent = msg || "";
  };

  // Toggle the visibility of an element matched by selector.
  const show = (sel, on) => {
    const el = $(sel);
    if (!el) return;
    el.classList.toggle("hidden", !on);
  };

  // Get the connected-roster list or table mount element.
  const getConnectedRostersMount = () => {
    return $("#connectedRostersList") || $("#connectedRostersTable tbody") || $("#connectedRostersTable");
  };

  // Apply roster status to visible row.
  const applyRosterStatusToVisibleRow_ = (rosterIdRaw) => {
    const rosterId = toStr(rosterIdRaw).trim();
    if (!rosterId) return;
    const mount = getConnectedRostersMount();
    if (!mount) return;
    const cards = Array.from(mount.querySelectorAll(".roster-admin-card"));
    let targetCard = null;
    for (let i = 0; i < cards.length; i++) {
      const cardRosterId = toStr(cards[i] && cards[i].dataset && cards[i].dataset.rosterId).trim();
      if (cardRosterId === rosterId) {
        targetCard = cards[i];
        break;
      }
    }
    if (!targetCard) return;
    const statusLine = targetCard.querySelector(".roster-admin-card__status");
    if (!statusLine) return;

    const saved = state.rosterStatusByRoster[rosterId];
    if (!saved || !saved.msg) {
      statusLine.textContent = "";
      statusLine.style.color = "#94a3b8";
      return;
    }
    statusLine.textContent = saved.msg;
    statusLine.style.color = saved.isError ? "#fca5a5" : "#94a3b8";
  };

  // Get the clan-mapping list or table mount element.
  const getClanMappingMount = () => {
    return $("#clanMappingList") || $("#clanMappingTable tbody") || $("#clanMappingTable");
  };

  const ADMIN_TAB_KEYS = ["rosters", "import", "preview"];
  // Get admin tab buttons.
  const getAdminTabButtons = () => Array.from(document.querySelectorAll('[data-admin-tab]'));

  // Get admin tab panel by key.
  const getAdminTabPanelByKey = (tabKeyRaw) => {
    const tabKey = toStr(tabKeyRaw).trim().toLowerCase();
    if (!tabKey) return null;
    return $("#adminTab" + tabKey.charAt(0).toUpperCase() + tabKey.slice(1));
  };

  // Set active admin tab.
  const setActiveAdminTab = (tabKeyRaw, optionsRaw) => {
    const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
    const tabKey = toStr(tabKeyRaw).trim().toLowerCase();
    const nextTab = ADMIN_TAB_KEYS.includes(tabKey) ? tabKey : "rosters";
    state.activeAdminTab = nextTab;

    const buttons = getAdminTabButtons();
    for (const btn of buttons) {
      const key = toStr(btn && btn.dataset && btn.dataset.adminTab).trim().toLowerCase();
      const active = key === nextTab;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
      btn.tabIndex = active ? 0 : -1;
      if (active && options.focusButton !== false) btn.focus();
    }

    for (const key of ADMIN_TAB_KEYS) {
      const panel = getAdminTabPanelByKey(key);
      if (!panel) continue;
      const active = key === nextTab;
      panel.classList.toggle("hidden", !active);
      panel.setAttribute("aria-hidden", active ? "false" : "true");
    }
  };

  // Set auth card unlocked.
  const setAuthCardUnlocked = (unlocked) => {
    const authCard = $("#unlockCard");
    if (!authCard) return;
    authCard.classList.toggle("is-unlocked", !!unlocked);
  };

  // Sync overlay body state.
  const syncOverlayBodyState = () => {
    const hasOpenOverlay = !!document.querySelector(".admin-overlay.is-open");
    document.body.classList.toggle("admin-overlay-open", hasOpenOverlay);
  };

  // Set admin overlay open.
  const setAdminOverlayOpen = (panelIdRaw, toggleBtnIdRaw, openRaw, optionsRaw) => {
    const panelId = toStr(panelIdRaw).trim();
    if (!panelId) return;
    const panel = $("#" + panelId);
    const toggleBtnId = toStr(toggleBtnIdRaw).trim();
    const toggleBtn = toggleBtnId ? $("#" + toggleBtnId) : null;
    if (!panel) return;

    const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
    const shouldOpen = !!openRaw;
    const wasOpen = panel.classList.contains("is-open") && !panel.classList.contains("hidden");

    if (shouldOpen && !wasOpen) {
      state.modalFocusReturnByPanel[panelId] = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }

    panel.classList.toggle("hidden", !shouldOpen);
    panel.classList.toggle("is-open", shouldOpen);
    panel.setAttribute("aria-hidden", shouldOpen ? "false" : "true");
    if (toggleBtn) {
      toggleBtn.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
    }

    if (shouldOpen) {
      const focusSelector = toStr(options.focusSelector).trim();
      const target = focusSelector
        ? panel.querySelector(focusSelector)
        : panel.querySelector("input,select,textarea,button");
      if (target && typeof target.focus === "function") {
        setTimeout(() => target.focus(), 0);
      }
    } else if (options.restoreFocus !== false) {
      const prevFocus = state.modalFocusReturnByPanel[panelId];
      if (prevFocus && typeof prevFocus.focus === "function") {
        prevFocus.focus();
      }
    }

    if (!shouldOpen || options.clearFocusRecord === true) {
      delete state.modalFocusReturnByPanel[panelId];
    }
    syncOverlayBodyState();
  };

  // Clear pending profile reopen.
  const clearPendingProfileReopen = () => {
    state.pendingProfileReopen = null;
  };

  // Handle JSON pretty.
  const jsonPretty = (obj) => {
    try { return JSON.stringify(obj, null, 2); } catch { return String(obj); }
  };

  // Convert a value to error message.
  const toErrorMessage = (err) => (err && err.message ? err.message : String(err));

  // Deep-clone a JSON-safe value.
  const cloneJson = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
  const CWL_PREPARATION_ALGORITHM = "strength_top_x_v1";
  const CWL_PREPARATION_MIN_ROSTER_SIZE = 5;
  const CWL_PREPARATION_MAX_ROSTER_SIZE = 50;
  const CWL_PREPARATION_ROSTER_SIZE_STEP = 5;
  const CWL_PREPARATION_WARNING_SWITCH_TO_CWL = "Switch tracking mode to CWL to do this.";
  const CWL_PREPARATION_BENCH_CONFIG = {
    weightTH: 0.38,
    weightStarsPerf: 0.22,
    weightDestructionPerf: 0.14,
    weightThreeStarRate: 0.1,
    weightHitUpAbility: 0.08,
    weightHitEvenAbility: 0.08,
    weightReliabilityPenalty: 0.2,
    perfPriorWeight: 3.0,
    starsPerfPriorMean: 0.5,
    destructionPerfPriorMean: 0.5,
    threeStarRatePriorWeight: 4.0,
    reliabilityPriorWeight: 2.5,
  };

  // Normalize tag.
  const normalizeTag = (tag) => {
    const t = toStr(tag).trim().toUpperCase();
    if (!t) return "";
    return t.startsWith("#") ? t : ("#" + t);
  };

  // Return whether valid CoC tag.
  const isValidCocTag = (tagRaw) => /^#[PYLQGRJCUV0289]{3,15}$/.test(normalizeTag(tagRaw));

  // Get roster tracking mode.
  const getRosterTrackingMode = (rosterRaw) =>
    rosterRaw && rosterRaw.trackingMode === "regularWar" ? "regularWar" : "cwl";

  // Normalize notes.
  const normalizeNotes = (rawNotes) => {
    if (Array.isArray(rawNotes)) {
      return rawNotes.map((n) => toStr(n).trim()).filter(Boolean);
    }
    const one = toStr(rawNotes).trim();
    return one ? [one] : [];
  };

  // Convert a value to bool flag.
  const toBoolFlag = (value) => {
    if (value === true || value === false) return value;
    const text = toStr(value).trim().toLowerCase();
    if (!text) return false;
    return text === "true" || text === "1" || text === "yes" || text === "on";
  };

  // Normalize player flags in place.
  const normalizePlayerFlagsInPlace = (player) => {
    if (!player || typeof player !== "object") return player;
    player.excludeAsSwapTarget = toBoolFlag(player.excludeAsSwapTarget);
    player.excludeAsSwapSource = toBoolFlag(player.excludeAsSwapSource);
    return player;
  };

  // Parse notes from textarea.
  const parseNotesFromTextarea = (raw) => {
    const lines = toStr(raw).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    return normalizeNotes(lines);
  };

  // Set add preview roster panel open.
  const setAddPreviewRosterPanelOpen = (open) => {
    if (open) {
      setAdminOverlayOpen("addPlayerPanel", "toggleAddPlayerPanelBtn", false, {
        restoreFocus: false,
      });
    }
    setAdminOverlayOpen("addPreviewRosterPanel", "toggleAddPreviewRosterPanelBtn", !!open, {
      focusSelector: "#addPreviewRosterId",
    });
  };

  // Set add player panel open.
  const setAddPlayerPanelOpen = (open) => {
    if (open) {
      setAdminOverlayOpen("addPreviewRosterPanel", "toggleAddPreviewRosterPanelBtn", false, {
        restoreFocus: false,
      });
    }
    setAdminOverlayOpen("addPlayerPanel", "toggleAddPlayerPanelBtn", !!open, {
      focusSelector: "#addPlayerRoster",
    });
  };

  // Bind admin tabs.
  const bindAdminTabs = () => {
    const buttons = getAdminTabButtons();
    if (!buttons.length) return;

    // Handle focus button by index.
    const focusButtonByIndex = (indexRaw) => {
      if (!buttons.length) return;
      const max = buttons.length - 1;
      const nextIndex = Math.max(0, Math.min(max, indexRaw));
      const btn = buttons[nextIndex];
      if (btn && typeof btn.focus === "function") btn.focus();
    };

    buttons.forEach((btn, index) => {
      btn.addEventListener("click", () => {
        const key = toStr(btn && btn.dataset && btn.dataset.adminTab).trim().toLowerCase();
        setActiveAdminTab(key, { focusButton: false });
      });

      btn.addEventListener("keydown", (e) => {
        if (!e) return;
        const key = toStr(e.key).trim();
        if (key === "ArrowRight") {
          e.preventDefault();
          const nextIndex = index >= buttons.length - 1 ? 0 : index + 1;
          const nextBtn = buttons[nextIndex];
          const nextKey = toStr(nextBtn && nextBtn.dataset && nextBtn.dataset.adminTab).trim().toLowerCase();
          setActiveAdminTab(nextKey, { focusButton: false });
          focusButtonByIndex(nextIndex);
        } else if (key === "ArrowLeft") {
          e.preventDefault();
          const nextIndex = index <= 0 ? buttons.length - 1 : index - 1;
          const nextBtn = buttons[nextIndex];
          const nextKey = toStr(nextBtn && nextBtn.dataset && nextBtn.dataset.adminTab).trim().toLowerCase();
          setActiveAdminTab(nextKey, { focusButton: false });
          focusButtonByIndex(nextIndex);
        } else if (key === "Home") {
          e.preventDefault();
          const first = buttons[0];
          const firstKey = toStr(first && first.dataset && first.dataset.adminTab).trim().toLowerCase();
          setActiveAdminTab(firstKey, { focusButton: false });
          focusButtonByIndex(0);
        } else if (key === "End") {
          e.preventDefault();
          const lastIndex = buttons.length - 1;
          const last = buttons[lastIndex];
          const lastKey = toStr(last && last.dataset && last.dataset.adminTab).trim().toLowerCase();
          setActiveAdminTab(lastKey, { focusButton: false });
          focusButtonByIndex(lastIndex);
        }
      });
    });
  };

  // Bind overlay close handlers.
  const bindOverlayCloseHandlers = () => {
    // Close via attribute.
    const closeViaAttribute = (target) => {
      const node = target && target.closest ? target.closest("[data-overlay-close]") : null;
      const panelId = toStr(node && node.getAttribute("data-overlay-close")).trim();
      if (!panelId) return false;
      if (panelId === "addPreviewRosterPanel") {
        setAddPreviewRosterPanelOpen(false);
      } else if (panelId === "addPlayerPanel") {
        setAddPlayerPanelOpen(false);
      } else {
        setAdminOverlayOpen(panelId, "", false, {});
      }
      return true;
    };

    document.addEventListener("click", (e) => {
      closeViaAttribute(e && e.target);
    });

    document.addEventListener("keydown", (e) => {
      if (!e || e.key !== "Escape") return;
      if (document.querySelector("#addPlayerPanel.is-open")) {
        e.preventDefault();
        setAddPlayerPanelOpen(false);
        return;
      }
      if (document.querySelector("#addPreviewRosterPanel.is-open")) {
        e.preventDefault();
        setAddPreviewRosterPanelOpen(false);
      }
    });
  };

  // Get the current roster list from cached state.
  const getRosters = () => {
    if (!state.lastRosterData || !Array.isArray(state.lastRosterData.rosters)) return [];
    return state.lastRosterData.rosters;
  };

  // Normalize roster order in data.
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
    // Push roster index.
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

  // Sync roster order from current array.
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

  // Refresh refresh all UI.
  const refreshRefreshAllUi = () => {
    const btn = $("#refreshAllBtn");
    if (!btn) return;
    const hasLoadedPreview = !!(state.lastRosterData && Array.isArray(state.lastRosterData.rosters) && state.lastRosterData.rosters.length);
    btn.disabled = !hasLoadedPreview || state.bulkRefreshBusy;
    btn.textContent = state.bulkRefreshBusy ? "Refreshing..." : "Refresh all";
  };

  // Format local timestamp.
  const formatLocalTimestamp = (isoRaw) => {
    const iso = toStr(isoRaw).trim();
    if (!iso) return "";
    const parsed = new Date(iso);
    if (!parsed || Number.isNaN(parsed.getTime())) return iso;
    return parsed.toLocaleString();
  };

  // Build auto refresh status text.
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

  // Render auto refresh UI.
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

  // Load auto refresh settings.
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

  // Update auto refresh enabled.
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

  // Get roster by ID.
  const getRosterById = (rosterIdRaw) => {
    const rosterId = toStr(rosterIdRaw).trim();
    if (!rosterId) return null;
    return getRosters().find((roster) => toStr(roster && roster.id).trim() === rosterId) || null;
  };

  // Get roster index in roster data.
  const getRosterIndexInRosterData_ = (rosterData, rosterIdRaw) => {
    const rosterId = toStr(rosterIdRaw).trim();
    const rosters = rosterData && Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
    return rosters.findIndex((roster) => toStr(roster && roster.id).trim() === rosterId);
  };

  // Clone current roster data for server.
  const cloneCurrentRosterDataForServer_ = () => {
    if (!state.lastRosterData || !Array.isArray(state.lastRosterData.rosters)) {
      throw new Error("No roster preview is loaded.");
    }
    return cloneJson(state.lastRosterData);
  };

  // Find roster player by tag.
  const findRosterPlayerByTag = (rosterIdRaw, tagRaw) => {
    const roster = getRosterById(rosterIdRaw);
    const tag = normalizeTag(tagRaw);
    if (!roster || !tag) return null;
    ensureRosterArrays(roster);
    return roster.main.concat(roster.subs, roster.missing).find((player) => normalizeTag(player && player.tag) === tag) || null;
  };

  // Format player display label.
  const formatPlayerDisplayLabel = (rosterIdRaw, tagRaw) => {
    const tag = normalizeTag(tagRaw);
    if (!tag) return "";
    const player = findRosterPlayerByTag(rosterIdRaw, tag);
    const name = toStr(player && player.name).trim();
    return name ? (name + " (" + tag + ")") : tag;
  };

  // Format roster display label.
  const formatRosterDisplayLabel = (rosterIdRaw) => {
    const rosterId = toStr(rosterIdRaw).trim();
    if (!rosterId) return "";
    const roster = getRosterById(rosterId);
    const title = toStr(roster && roster.title).trim();
    return title ? (title + " (" + rosterId + ")") : rosterId;
  };

  // Handle persist clan sync tag inputs.
  const persistClanSyncTagInputs = () => {
    const host = getConnectedRostersMount();
    const inputs = host
      ? Array.from(host.querySelectorAll('[data-clan-sync-tag-input="1"]'))
      : [];
    for (const input of inputs) {
      const rosterId = toStr(input && input.dataset && input.dataset.rosterId).trim();
      const roster = getRosterById(rosterId);
      if (!roster) continue;
      const normalized = normalizeTag(input && input.value);
      input.value = normalized;
      roster.connectedClanTag = normalized;
    }
  };

  // Apply suggestion tags to state.
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

  // Sync suggestion state from roster data.
  const syncSuggestionStateFromRosterData_ = () => {
    state.benchMarksByRoster = {};
    state.swapInMarksByRoster = {};
    state.suggestionNotesByRoster = {};

    const rosters = getRosters();
    for (const roster of rosters) {
      const rosterId = toStr(roster && roster.id).trim();
      if (!rosterId) continue;
      if (getRosterTrackingMode(roster) !== "cwl") continue;
      if (isCwlPreparationActiveLocal_(roster)) continue;
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

  // Clear saved bench suggestions for roster.
  const clearSavedBenchSuggestionsForRoster_ = (rosterIdRaw) => {
    const rosterId = toStr(rosterIdRaw).trim();
    if (!rosterId) return;
    const roster = getRosterById(rosterId);
    if (!roster || typeof roster !== "object") return;
    if (Object.prototype.hasOwnProperty.call(roster, "benchSuggestions")) {
      delete roster.benchSuggestions;
    }
  };

  // Clear saved bench suggestions from preview.
  const clearSavedBenchSuggestionsFromPreview_ = () => {
    const rosters = getRosters();
    for (const roster of rosters) {
      if (!roster || typeof roster !== "object") continue;
      if (Object.prototype.hasOwnProperty.call(roster, "benchSuggestions")) {
        delete roster.benchSuggestions;
      }
    }
  };

  // Refresh add preview roster UI.
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

  // Refresh add player UI.
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

    // Update mode hint.
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

  // Ensure roster arrays.
  const ensureRosterArrays = (roster) => {
    if (!roster || typeof roster !== "object") return;
    roster.trackingMode = getRosterTrackingMode(roster);
    if (!Array.isArray(roster.main)) roster.main = [];
    if (!Array.isArray(roster.subs)) roster.subs = [];
    if (!Array.isArray(roster.missing)) roster.missing = [];
  };

  // Convert a value to non negative int local.
  const toNonNegativeIntLocal_ = (valueRaw) => {
    const n = Number(valueRaw);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.floor(n));
  };

  // Compare tags asc local.
  const compareTagsAscLocal_ = (leftRaw, rightRaw) => {
    const left = toStr(leftRaw);
    const right = toStr(rightRaw);
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  };

  // Handle clamp number local.
  const clampNumberLocal_ = (valueRaw, minValue, maxValue) => {
    const n = Number(valueRaw);
    if (!Number.isFinite(n)) return Number(minValue);
    if (n < minValue) return Number(minValue);
    if (n > maxValue) return Number(maxValue);
    return n;
  };

  // Normalize unit metric local.
  const normalizeUnitMetricLocal_ = (valueRaw, fallbackRaw) => {
    const fallback = clampNumberLocal_(fallbackRaw, 0, 1);
    const n = Number(valueRaw);
    if (!Number.isFinite(n)) return fallback;
    return clampNumberLocal_(n, 0, 1);
  };

  // Handle shrink toward local.
  const shrinkTowardLocal_ = (observedValueRaw, priorMeanRaw, sampleSizeRaw, priorWeightRaw) => {
    const observed = Number(observedValueRaw);
    const prior = Number(priorMeanRaw);
    const n = Math.max(0, Number(sampleSizeRaw) || 0);
    const w = Math.max(0, Number(priorWeightRaw) || 0);
    const safeObserved = Number.isFinite(observed) ? observed : prior;
    const safePrior = Number.isFinite(prior) ? prior : 0;
    const denom = w + n;
    if (denom <= 0) return safePrior;
    return (w * safePrior + n * safeObserved) / denom;
  };

  // Create an empty CWL stat entry local.
  const createEmptyCwlStatEntryLocal_ = () => ({
    starsTotal: 0,
    daysInLineup: 0,
    resolvedWarDays: 0,
    attacksMade: 0,
    missedAttacks: 0,
    threeStarCount: 0,
    totalDestruction: 0,
    countedAttacks: 0,
    currentWarAttackPending: 0,
    hitUpCount: 0,
    hitDownCount: 0,
    sameThHitCount: 0,
  });

  // Sanitize CWL stat entry local.
  const sanitizeCwlStatEntryLocal_ = (entryRaw) => {
    const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
    const resolvedWarDays = entry.resolvedWarDays != null
      ? toNonNegativeIntLocal_(entry.resolvedWarDays)
      : toNonNegativeIntLocal_(entry.daysInLineup);
    const out = createEmptyCwlStatEntryLocal_();
    out.starsTotal = toNonNegativeIntLocal_(entry.starsTotal);
    out.daysInLineup = resolvedWarDays;
    out.resolvedWarDays = resolvedWarDays;
    out.attacksMade = toNonNegativeIntLocal_(entry.attacksMade);
    out.missedAttacks = toNonNegativeIntLocal_(entry.missedAttacks);
    out.threeStarCount = toNonNegativeIntLocal_(entry.threeStarCount);
    out.totalDestruction = toNonNegativeIntLocal_(entry.totalDestruction);
    out.countedAttacks = toNonNegativeIntLocal_(entry.countedAttacks);
    out.currentWarAttackPending = Math.min(1, toNonNegativeIntLocal_(entry.currentWarAttackPending));
    out.hitUpCount = toNonNegativeIntLocal_(entry.hitUpCount);
    out.hitDownCount = toNonNegativeIntLocal_(entry.hitDownCount);
    out.sameThHitCount = toNonNegativeIntLocal_(entry.sameThHitCount);
    return out;
  };

  // Derive CWL metrics local.
  const deriveCwlMetricsLocal_ = (entryRaw) => {
    const entry = sanitizeCwlStatEntryLocal_(entryRaw);
    const possibleStars = 3 * entry.resolvedWarDays;
    return {
      starsTotal: entry.starsTotal,
      daysInLineup: entry.daysInLineup,
      resolvedWarDays: entry.resolvedWarDays,
      attacksMade: entry.attacksMade,
      missedAttacks: entry.missedAttacks,
      threeStarCount: entry.threeStarCount,
      totalDestruction: entry.totalDestruction,
      countedAttacks: entry.countedAttacks,
      currentWarAttackPending: entry.currentWarAttackPending,
      hitUpCount: entry.hitUpCount,
      hitDownCount: entry.hitDownCount,
      sameThHitCount: entry.sameThHitCount,
      starsPerf: possibleStars > 0 ? (entry.starsTotal / possibleStars) : null,
      destructionPerf: entry.resolvedWarDays > 0 ? (entry.totalDestruction / (100 * entry.resolvedWarDays)) : null,
    };
  };

  // Compute strength score local.
  const computeStrengthScoreLocal_ = (playerStatsRaw, planningContextRaw, configRaw) => {
    const stats = playerStatsRaw && typeof playerStatsRaw === "object" ? playerStatsRaw : {};
    const ctx = planningContextRaw && typeof planningContextRaw === "object" ? planningContextRaw : {};
    const config = configRaw && typeof configRaw === "object" ? configRaw : CWL_PREPARATION_BENCH_CONFIG;
    const th = toNonNegativeIntLocal_(stats.th);
    const countedAttacks = toNonNegativeIntLocal_(stats.countedAttacks);
    const resolvedWarDays = toNonNegativeIntLocal_(stats.resolvedWarDays);
    const thMin = toNonNegativeIntLocal_(ctx.thMin);
    const thMax = toNonNegativeIntLocal_(ctx.thMax);
    const normTH = thMax > thMin ? clampNumberLocal_((th - thMin) / (thMax - thMin), 0, 1) : 0.5;
    const starsPerfPrior = normalizeUnitMetricLocal_(config.starsPerfPriorMean, 0.5);
    const destructionPrior = normalizeUnitMetricLocal_(config.destructionPerfPriorMean, 0.5);
    const perfPriorWeight = Math.max(0, Number(config.perfPriorWeight) || 0);
    const starsPerfRaw = normalizeUnitMetricLocal_(stats.starsPerf, starsPerfPrior);
    const destructionPerfRaw = normalizeUnitMetricLocal_(stats.destructionPerf, destructionPrior);
    const shrinkedStarsPerf = normalizeUnitMetricLocal_(shrinkTowardLocal_(starsPerfRaw, starsPerfPrior, countedAttacks, perfPriorWeight), starsPerfPrior);
    const shrinkedDestructionPerf = normalizeUnitMetricLocal_(shrinkTowardLocal_(destructionPerfRaw, destructionPrior, countedAttacks, perfPriorWeight), destructionPrior);
    const threeStarRateRaw = clampNumberLocal_(toNonNegativeIntLocal_(stats.threeStarCount) / Math.max(1, countedAttacks), 0, 1);
    const threeStarRateMean = normalizeUnitMetricLocal_(ctx.poolThreeStarRateMean, 0.33);
    const shrinkedThreeStarRate = normalizeUnitMetricLocal_(
      shrinkTowardLocal_(threeStarRateRaw, threeStarRateMean, countedAttacks, Math.max(0, Number(config.threeStarRatePriorWeight) || 0)),
      threeStarRateMean
    );
    const hitUpShare = clampNumberLocal_(toNonNegativeIntLocal_(stats.hitUpCount) / Math.max(1, countedAttacks), 0, 1);
    const hitEvenShare = clampNumberLocal_(toNonNegativeIntLocal_(stats.sameThHitCount) / Math.max(1, countedAttacks), 0, 1);
    const hitUpAbility = clampNumberLocal_(0.65 * shrinkedStarsPerf + 0.35 * hitUpShare, 0, 1);
    const hitEvenAbility = clampNumberLocal_(0.65 * shrinkedStarsPerf + 0.35 * hitEvenShare, 0, 1);
    const missRateRaw = clampNumberLocal_(toNonNegativeIntLocal_(stats.missedAttacks) / Math.max(1, resolvedWarDays), 0, 1);
    const poolMissRateMean = normalizeUnitMetricLocal_(ctx.poolMissRateMean, 0.1);
    const reliabilityPenalty = normalizeUnitMetricLocal_(
      shrinkTowardLocal_(missRateRaw, poolMissRateMean, resolvedWarDays, Math.max(0, Number(config.reliabilityPriorWeight) || 0)),
      poolMissRateMean
    );
    const score =
      (Number(config.weightTH) || 0) * normTH +
      (Number(config.weightStarsPerf) || 0) * shrinkedStarsPerf +
      (Number(config.weightDestructionPerf) || 0) * shrinkedDestructionPerf +
      (Number(config.weightThreeStarRate) || 0) * shrinkedThreeStarRate +
      (Number(config.weightHitUpAbility) || 0) * hitUpAbility +
      (Number(config.weightHitEvenAbility) || 0) * hitEvenAbility -
      (Number(config.weightReliabilityPenalty) || 0) * reliabilityPenalty;
    return {
      score,
      normTH,
      shrinkedStarsPerf,
      shrinkedDestructionPerf,
      shrinkedThreeStarRate,
      hitUpAbility,
      hitEvenAbility,
      reliabilityPenalty,
    };
  };

  // Normalize preparation roster size local.
  const normalizePreparationRosterSizeLocal_ = (rawValue, fallbackValue) => {
    // Normalize state.
    const normalize = (valueRaw) => {
      const n = Number(valueRaw);
      if (!Number.isFinite(n)) return 0;
      const floored = Math.floor(n);
      if (floored <= 0) return 0;
      const snapped = Math.floor(floored / CWL_PREPARATION_ROSTER_SIZE_STEP) * CWL_PREPARATION_ROSTER_SIZE_STEP;
      if (snapped <= 0) return 0;
      return Math.max(CWL_PREPARATION_MIN_ROSTER_SIZE, Math.min(CWL_PREPARATION_MAX_ROSTER_SIZE, snapped));
    };
    const primary = normalize(rawValue);
    if (primary) return primary;
    const fallback = normalize(fallbackValue);
    if (fallback) return fallback;
    return CWL_PREPARATION_MIN_ROSTER_SIZE;
  };

  // Get initial preparation roster size for enable local.
  const getInitialPreparationRosterSizeForEnableLocal_ = (roster) => {
    const mainCount = Array.isArray(roster && roster.main) ? roster.main.length : 0;
    return normalizePreparationRosterSizeLocal_(mainCount, CWL_PREPARATION_MIN_ROSTER_SIZE);
  };

  // Get roster pool entries for preparation local.
  const getRosterPoolEntriesForPreparationLocal_ = (roster) => {
    const rosterSafe = roster && typeof roster === "object" ? roster : {};
    const main = Array.isArray(rosterSafe.main) ? rosterSafe.main : [];
    const subs = Array.isArray(rosterSafe.subs) ? rosterSafe.subs : [];
    const missing = Array.isArray(rosterSafe.missing) ? rosterSafe.missing : [];
    const sections = [
      { key: "main", players: main },
      { key: "subs", players: subs },
      { key: "missing", players: missing },
    ];
    const out = [];
    const seen = {};
    let sourceOrder = 0;
    for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
      const section = sections[sectionIndex];
      const players = Array.isArray(section.players) ? section.players : [];
      for (let i = 0; i < players.length; i++) {
        const player = players[i] && typeof players[i] === "object" ? players[i] : {};
        const tag = normalizeTag(player.tag);
        if (!tag || seen[tag]) continue;
        seen[tag] = true;
        out.push({
          tag,
          player,
          sourceSection: section.key,
          sourceOrder,
        });
        sourceOrder++;
      }
    }
    return out;
  };

  // Build roster pool tag set for preparation local.
  const buildRosterPoolTagSetForPreparationLocal_ = (roster) => {
    const out = {};
    const entries = getRosterPoolEntriesForPreparationLocal_(roster);
    for (let i = 0; i < entries.length; i++) out[entries[i].tag] = true;
    return out;
  };

  // Normalize preparation lock state local.
  const normalizePreparationLockStateLocal_ = (rawValue, rosterPoolTagSetRaw) => {
    const raw = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
    const rosterPoolTagSet = rosterPoolTagSetRaw && typeof rosterPoolTagSetRaw === "object" ? rosterPoolTagSetRaw : {};
    const out = {};
    const keys = Object.keys(raw);
    for (let i = 0; i < keys.length; i++) {
      const tag = normalizeTag(keys[i]);
      if (!tag || !rosterPoolTagSet[tag]) continue;
      const stateValue = toStr(raw[keys[i]]).trim().toLowerCase();
      if (stateValue !== "lockedin" && stateValue !== "lockedout") continue;
      out[tag] = stateValue === "lockedin" ? "lockedIn" : "lockedOut";
    }
    return out;
  };

  // Sanitize roster CWL preparation local.
  const sanitizeRosterCwlPreparationLocal_ = (roster, optionsRaw) => {
    const rosterSafe = roster && typeof roster === "object" ? roster : null;
    if (!rosterSafe) return null;
    ensureRosterArrays(rosterSafe);
    const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
    const source = rosterSafe.cwlPreparation && typeof rosterSafe.cwlPreparation === "object" && !Array.isArray(rosterSafe.cwlPreparation)
      ? rosterSafe.cwlPreparation
      : null;
    const trackingMode = getRosterTrackingMode(rosterSafe);
    const rosterPoolTagSet = buildRosterPoolTagSetForPreparationLocal_(rosterSafe);
    const defaultRosterSize = normalizePreparationRosterSizeLocal_(
      options.defaultRosterSize,
      getInitialPreparationRosterSizeForEnableLocal_(rosterSafe)
    );
    const rosterSize = normalizePreparationRosterSizeLocal_(source && source.rosterSize, defaultRosterSize);
    const lockStateByTag = normalizePreparationLockStateLocal_(source && source.lockStateByTag, rosterPoolTagSet);
    const enabled = trackingMode === "cwl" ? toBoolFlag(source && source.enabled) : false;
    const lockedInCount = Object.keys(lockStateByTag).filter((tag) => lockStateByTag[tag] === "lockedIn").length;
    if (enabled && lockedInCount > rosterSize && options.enforceLockedInLimit !== false) {
      throw new Error("Locked-In count exceeds roster size (" + lockedInCount + " > " + rosterSize + ").");
    }
    const lastAppliedAt = toStr(source && source.lastAppliedAt).trim();
    const hasSource = !!source;
    const hasMeaningfulContent = hasSource || enabled || Object.keys(lockStateByTag).length > 0;
    if (!hasMeaningfulContent && options.keepWhenEmpty !== true) {
      delete rosterSafe.cwlPreparation;
      return null;
    }
    const out = {
      enabled,
      rosterSize,
      lockStateByTag,
      algorithm: CWL_PREPARATION_ALGORITHM,
    };
    if (lastAppliedAt) out.lastAppliedAt = lastAppliedAt;
    rosterSafe.cwlPreparation = out;
    return out;
  };

  // Get roster CWL preparation local.
  const getRosterCwlPreparationLocal_ = (roster, optionsRaw) => {
    const rosterSafe = roster && typeof roster === "object" ? roster : null;
    if (!rosterSafe) return null;
    const prep = sanitizeRosterCwlPreparationLocal_(rosterSafe, Object.assign({ keepWhenEmpty: true }, optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {}));
    return prep && typeof prep === "object" ? prep : null;
  };

  // Return whether CWL preparation active local.
  const isCwlPreparationActiveLocal_ = (roster) => {
    const rosterSafe = roster && typeof roster === "object" ? roster : null;
    if (!rosterSafe) return false;
    if (getRosterTrackingMode(rosterSafe) !== "cwl") return false;
    const prep = getRosterCwlPreparationLocal_(rosterSafe);
    return !!(prep && prep.enabled);
  };

  // Build CWL preparation ranking local.
  const buildCwlPreparationRankingLocal_ = (roster, optionsRaw) => {
    const rosterSafe = roster && typeof roster === "object" ? roster : {};
    const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
    const poolEntries = Array.isArray(options.poolEntries) ? options.poolEntries : getRosterPoolEntriesForPreparationLocal_(rosterSafe);
    const statsByTag = rosterSafe && rosterSafe.cwlStats && rosterSafe.cwlStats.byTag && typeof rosterSafe.cwlStats.byTag === "object"
      ? rosterSafe.cwlStats.byTag
      : {};
    const ranked = [];
    let thMin = Number.MAX_SAFE_INTEGER;
    let thMax = 0;
    let sumThreeStarRate = 0;
    let sumMissRate = 0;
    let meanCount = 0;
    for (let i = 0; i < poolEntries.length; i++) {
      const entry = poolEntries[i] && typeof poolEntries[i] === "object" ? poolEntries[i] : {};
      const player = entry.player && typeof entry.player === "object" ? entry.player : {};
      const tag = normalizeTag(entry.tag || player.tag);
      if (!tag) continue;
      const metrics = deriveCwlMetricsLocal_(statsByTag[tag]);
      const th = toNonNegativeIntLocal_(player.th);
      const playerStats = {
        tag,
        th,
        countedAttacks: metrics.countedAttacks,
        resolvedWarDays: metrics.resolvedWarDays,
        starsPerf: metrics.starsPerf,
        destructionPerf: metrics.destructionPerf,
        threeStarCount: metrics.threeStarCount,
        hitUpCount: metrics.hitUpCount,
        sameThHitCount: metrics.sameThHitCount,
        missedAttacks: metrics.missedAttacks,
      };
      ranked.push({
        tag,
        player,
        th,
        sourceSection: entry.sourceSection || "subs",
        sourceOrder: toNonNegativeIntLocal_(entry.sourceOrder),
        strengthScore: Number.NEGATIVE_INFINITY,
        strengthComponents: null,
        playerStats,
      });
      thMin = Math.min(thMin, th);
      thMax = Math.max(thMax, th);
      sumThreeStarRate += toNonNegativeIntLocal_(metrics.threeStarCount) / Math.max(1, toNonNegativeIntLocal_(metrics.countedAttacks));
      sumMissRate += toNonNegativeIntLocal_(metrics.missedAttacks) / Math.max(1, toNonNegativeIntLocal_(metrics.resolvedWarDays));
      meanCount++;
    }
    if (!ranked.length) return { ranked: [], byTag: {} };
    if (thMin === Number.MAX_SAFE_INTEGER) thMin = 0;
    const planningContext = {
      thMin,
      thMax,
      poolThreeStarRateMean: meanCount > 0 ? (sumThreeStarRate / meanCount) : 0.33,
      poolMissRateMean: meanCount > 0 ? (sumMissRate / meanCount) : 0.1,
    };
    const sectionPriority = { main: 0, subs: 1, missing: 2 };
    for (let i = 0; i < ranked.length; i++) {
      const strength = computeStrengthScoreLocal_(ranked[i].playerStats, planningContext, CWL_PREPARATION_BENCH_CONFIG);
      const score = Number.isFinite(Number(strength && strength.score)) ? Number(strength.score) : Number.NEGATIVE_INFINITY;
      ranked[i].strengthScore = score;
      ranked[i].strengthComponents = strength;
    }
    ranked.sort((left, right) => {
      const leftScore = Number.isFinite(Number(left && left.strengthScore)) ? Number(left.strengthScore) : Number.NEGATIVE_INFINITY;
      const rightScore = Number.isFinite(Number(right && right.strengthScore)) ? Number(right.strengthScore) : Number.NEGATIVE_INFINITY;
      if (leftScore !== rightScore) return rightScore - leftScore;
      const leftTh = toNonNegativeIntLocal_(left && left.th);
      const rightTh = toNonNegativeIntLocal_(right && right.th);
      if (leftTh !== rightTh) return rightTh - leftTh;
      const leftPriority = Object.prototype.hasOwnProperty.call(sectionPriority, left && left.sourceSection) ? sectionPriority[left.sourceSection] : 9;
      const rightPriority = Object.prototype.hasOwnProperty.call(sectionPriority, right && right.sourceSection) ? sectionPriority[right.sourceSection] : 9;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      const leftOrder = toNonNegativeIntLocal_(left && left.sourceOrder);
      const rightOrder = toNonNegativeIntLocal_(right && right.sourceOrder);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return compareTagsAscLocal_(left && left.tag, right && right.tag);
    });
    const byTag = {};
    for (let i = 0; i < ranked.length; i++) byTag[ranked[i].tag] = ranked[i];
    return { ranked, byTag };
  };

  // Apply CWL preparation rebalance local.
  const applyCwlPreparationRebalanceLocal_ = (roster, optionsRaw) => {
    const rosterSafe = roster && typeof roster === "object" ? roster : null;
    if (!rosterSafe) return null;
    ensureRosterArrays(rosterSafe);
    const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
    const prep = sanitizeRosterCwlPreparationLocal_(rosterSafe, {
      defaultRosterSize: normalizePreparationRosterSizeLocal_(Array.isArray(rosterSafe.main) ? rosterSafe.main.length : 0, CWL_PREPARATION_MIN_ROSTER_SIZE),
      keepWhenEmpty: true,
      enforceLockedInLimit: options.enforceLockedInLimit !== false,
    }) || {
      enabled: false,
      rosterSize: normalizePreparationRosterSizeLocal_(Array.isArray(rosterSafe.main) ? rosterSafe.main.length : 0, CWL_PREPARATION_MIN_ROSTER_SIZE),
      lockStateByTag: {},
      algorithm: CWL_PREPARATION_ALGORITHM,
    };
    if (!prep.lockStateByTag || typeof prep.lockStateByTag !== "object") prep.lockStateByTag = {};

    const beforeMainTags = rosterSafe.main.map((player) => normalizeTag(player && player.tag)).filter(Boolean);
    const beforeSubsTags = rosterSafe.subs.map((player) => normalizeTag(player && player.tag)).filter(Boolean);
    const beforeMissingTags = rosterSafe.missing.map((player) => normalizeTag(player && player.tag)).filter(Boolean);

    if (getRosterTrackingMode(rosterSafe) !== "cwl" || !prep.enabled) {
      prep.enabled = false;
      rosterSafe.cwlPreparation = prep;
      return {
        enabled: false,
        rosterSize: prep.rosterSize,
        filledMainCount: beforeMainTags.length,
        underfilled: false,
        lockedInCount: Object.keys(prep.lockStateByTag).filter((tag) => prep.lockStateByTag[tag] === "lockedIn").length,
        lockedOutCount: Object.keys(prep.lockStateByTag).filter((tag) => prep.lockStateByTag[tag] === "lockedOut").length,
        autoSelectedCount: 0,
        changed: false,
      };
    }

    const lockStateByTag = prep.lockStateByTag;
    const lockTags = Object.keys(lockStateByTag);
    const lockedInCount = lockTags.filter((tag) => lockStateByTag[tag] === "lockedIn").length;
    const lockedOutCount = lockTags.filter((tag) => lockStateByTag[tag] === "lockedOut").length;
    if (lockedInCount > prep.rosterSize) {
      throw new Error("Locked-In count exceeds roster size (" + lockedInCount + " > " + prep.rosterSize + ").");
    }

    const poolEntries = getRosterPoolEntriesForPreparationLocal_(rosterSafe);
    const ranking = buildCwlPreparationRankingLocal_(rosterSafe, { poolEntries });
    const ranked = Array.isArray(ranking.ranked) ? ranking.ranked : [];
    const rankedByTag = ranking.byTag && typeof ranking.byTag === "object" ? ranking.byTag : {};

    const selectedSet = {};
    const lockedInEntries = [];
    for (let i = 0; i < lockTags.length; i++) {
      const tag = lockTags[i];
      if (lockStateByTag[tag] !== "lockedIn") continue;
      const entry = rankedByTag[tag];
      if (!entry || !entry.player) continue;
      lockedInEntries.push(entry);
      selectedSet[tag] = true;
    }
    lockedInEntries.sort((left, right) => {
      const leftScore = Number.isFinite(Number(left && left.strengthScore)) ? Number(left.strengthScore) : Number.NEGATIVE_INFINITY;
      const rightScore = Number.isFinite(Number(right && right.strengthScore)) ? Number(right.strengthScore) : Number.NEGATIVE_INFINITY;
      if (leftScore !== rightScore) return rightScore - leftScore;
      const leftTh = toNonNegativeIntLocal_(left && left.th);
      const rightTh = toNonNegativeIntLocal_(right && right.th);
      if (leftTh !== rightTh) return rightTh - leftTh;
      return compareTagsAscLocal_(left && left.tag, right && right.tag);
    });

    const nextMain = [];
    for (let i = 0; i < lockedInEntries.length; i++) nextMain.push(lockedInEntries[i].player);
    let remainingSlots = Math.max(0, prep.rosterSize - nextMain.length);
    for (let i = 0; i < ranked.length && remainingSlots > 0; i++) {
      const entry = ranked[i];
      const tag = normalizeTag(entry && entry.tag);
      if (!tag || selectedSet[tag]) continue;
      if (lockStateByTag[tag] === "lockedOut") continue;
      nextMain.push(entry.player);
      selectedSet[tag] = true;
      remainingSlots--;
    }

    const nextSubs = [];
    for (let i = 0; i < ranked.length; i++) {
      const entry = ranked[i];
      const tag = normalizeTag(entry && entry.tag);
      if (!tag || selectedSet[tag]) continue;
      nextSubs.push(entry.player);
    }

    rosterSafe.main = nextMain;
    rosterSafe.subs = nextSubs;
    rosterSafe.missing = [];
    if (options.recordAppliedAt !== false) {
      prep.lastAppliedAt = new Date().toISOString();
    }
    prep.algorithm = CWL_PREPARATION_ALGORITHM;
    rosterSafe.cwlPreparation = prep;
    reindexRoster(rosterSafe);

    const afterMainTags = rosterSafe.main.map((player) => normalizeTag(player && player.tag)).filter(Boolean);
    const afterSubsTags = rosterSafe.subs.map((player) => normalizeTag(player && player.tag)).filter(Boolean);
    const afterMissingTags = rosterSafe.missing.map((player) => normalizeTag(player && player.tag)).filter(Boolean);
    const changed =
      beforeMainTags.join("|") !== afterMainTags.join("|") ||
      beforeSubsTags.join("|") !== afterSubsTags.join("|") ||
      beforeMissingTags.join("|") !== afterMissingTags.join("|");
    if (changed) {
      clearSavedBenchSuggestionsForRoster_(toStr(rosterSafe.id).trim());
      clearSuggestionMarksForRoster_(toStr(rosterSafe.id).trim());
    }

    return {
      enabled: true,
      rosterSize: prep.rosterSize,
      filledMainCount: afterMainTags.length,
      underfilled: afterMainTags.length < prep.rosterSize,
      lockedInCount,
      lockedOutCount,
      autoSelectedCount: Math.max(0, afterMainTags.length - lockedInCount),
      changed,
    };
  };

  // Handle rebalance roster if preparation active local.
  const rebalanceRosterIfPreparationActiveLocal_ = (roster, optionsRaw) => {
    if (!roster || typeof roster !== "object") return null;
    const prep = getRosterCwlPreparationLocal_(roster, { keepWhenEmpty: true, enforceLockedInLimit: true });
    if (!prep || !prep.enabled || getRosterTrackingMode(roster) !== "cwl") return null;
    return applyCwlPreparationRebalanceLocal_(roster, Object.assign({ enforceLockedInLimit: true }, optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {}));
  };

  // Handle rebalance all active CWL preparation rosters local.
  const rebalanceAllActiveCwlPreparationRostersLocal_ = (optionsRaw) => {
    const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
    const rosters = getRosters();
    const summariesByRosterId = {};
    for (let i = 0; i < rosters.length; i++) {
      const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : null;
      if (!roster) continue;
      const prep = getRosterCwlPreparationLocal_(roster, { keepWhenEmpty: true, enforceLockedInLimit: true });
      if (!prep || !prep.enabled || getRosterTrackingMode(roster) !== "cwl") continue;
      const summary = applyCwlPreparationRebalanceLocal_(roster, options);
      const rosterId = toStr(roster.id).trim();
      if (rosterId) summariesByRosterId[rosterId] = summary;
    }
    return summariesByRosterId;
  };

  // Migrate missing players to subs for CWL local.
  const migrateMissingPlayersToSubsForCwlLocal_ = (roster) => {
    const rosterSafe = roster && typeof roster === "object" ? roster : null;
    if (!rosterSafe) return false;
    ensureRosterArrays(rosterSafe);
    const hadMissing = Array.isArray(rosterSafe.missing) && rosterSafe.missing.length > 0;
    if (!hadMissing) {
      rosterSafe.missing = [];
      return false;
    }
    const tagSet = {};
    // Mark tags in the current working set.
    const mark = (playersRaw) => {
      const players = Array.isArray(playersRaw) ? playersRaw : [];
      for (let i = 0; i < players.length; i++) {
        const tag = normalizeTag(players[i] && players[i].tag);
        if (!tag) continue;
        tagSet[tag] = true;
      }
    };
    mark(rosterSafe.main);
    mark(rosterSafe.subs);
    const moved = [];
    for (let i = 0; i < rosterSafe.missing.length; i++) {
      const player = rosterSafe.missing[i] && typeof rosterSafe.missing[i] === "object" ? rosterSafe.missing[i] : {};
      const tag = normalizeTag(player.tag);
      if (!tag || tagSet[tag]) continue;
      tagSet[tag] = true;
      moved.push(player);
    }
    if (moved.length) {
      rosterSafe.subs = rosterSafe.subs.concat(moved);
    }
    rosterSafe.missing = [];
    return moved.length > 0;
  };

  // Handle transfer preparation lock on explicit move local.
  const transferPreparationLockOnExplicitMoveLocal_ = (sourceRoster, destinationRoster, playerTagRaw) => {
    const source = sourceRoster && typeof sourceRoster === "object" ? sourceRoster : null;
    const destination = destinationRoster && typeof destinationRoster === "object" ? destinationRoster : null;
    const playerTag = normalizeTag(playerTagRaw);
    if (!source || !destination || !playerTag) return;
    const sourcePrep = getRosterCwlPreparationLocal_(source, { keepWhenEmpty: true, enforceLockedInLimit: true });
    const destinationPrep = getRosterCwlPreparationLocal_(destination, { keepWhenEmpty: true, enforceLockedInLimit: true });
    const sourceLock = sourcePrep && sourcePrep.lockStateByTag && sourcePrep.lockStateByTag[playerTag]
      ? sourcePrep.lockStateByTag[playerTag]
      : "";

    if (sourcePrep && sourcePrep.lockStateByTag && Object.prototype.hasOwnProperty.call(sourcePrep.lockStateByTag, playerTag)) {
      delete sourcePrep.lockStateByTag[playerTag];
      source.cwlPreparation = sourcePrep;
    }

    const destinationPrepActive = !!(destinationPrep && destinationPrep.enabled && getRosterTrackingMode(destination) === "cwl");
    if (destinationPrepActive && (sourceLock === "lockedIn" || sourceLock === "lockedOut")) {
      destinationPrep.lockStateByTag[playerTag] = sourceLock;
      destination.cwlPreparation = destinationPrep;
    } else if (destinationPrep && destinationPrep.lockStateByTag && Object.prototype.hasOwnProperty.call(destinationPrep.lockStateByTag, playerTag)) {
      delete destinationPrep.lockStateByTag[playerTag];
      destination.cwlPreparation = destinationPrep;
    }
  };

  // Handle move preparation lock for edited tag local.
  const movePreparationLockForEditedTagLocal_ = (roster, previousTagRaw, nextTagRaw) => {
    const rosterSafe = roster && typeof roster === "object" ? roster : null;
    if (!rosterSafe) return;
    const previousTag = normalizeTag(previousTagRaw);
    const nextTag = normalizeTag(nextTagRaw);
    if (!previousTag || !nextTag || previousTag === nextTag) return;
    const prep = getRosterCwlPreparationLocal_(rosterSafe, { keepWhenEmpty: true, enforceLockedInLimit: true });
    if (!prep || !prep.lockStateByTag || typeof prep.lockStateByTag !== "object") return;
    const current = prep.lockStateByTag[previousTag];
    if (current !== "lockedIn" && current !== "lockedOut") return;
    delete prep.lockStateByTag[previousTag];
    prep.lockStateByTag[nextTag] = current;
    rosterSafe.cwlPreparation = prep;
  };

  // Handle reindex roster.
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

  // Handle reindex all rosters.
  const reindexAllRosters = () => {
    const rosters = getRosters();
    for (const roster of rosters) reindexRoster(roster);
  };

  // Prune bench marks.
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

      // Prune tag map.
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

  // Apply bench marks.
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
      if (isCwlPreparationActiveLocal_(roster)) continue;
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

  // Clear suggestion marks.
  const clearSuggestionMarks_ = () => {
    state.benchMarksByRoster = {};
    state.swapInMarksByRoster = {};
    state.suggestionNotesByRoster = {};
  };

  // Clear suggestion marks for roster.
  const clearSuggestionMarksForRoster_ = (rosterIdRaw) => {
    const rosterId = toStr(rosterIdRaw).trim();
    if (!rosterId) return;
    delete state.benchMarksByRoster[rosterId];
    delete state.swapInMarksByRoster[rosterId];
    delete state.suggestionNotesByRoster[rosterId];
  };

  // Render preview from state.
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

  // Mark report stale.
  const markReportStale = (reasonRaw) => {
    const reason = toStr(reasonRaw).trim() || "Preview changed. Re-run compare with preview before applying XLSX updates.";
    if (!state.importSession || !state.importSession.comparison) return;
    state.importSession.stale = true;
    state.importSession.staleReason = reason;
    renderImportUi();
  };

  // Apply preview mutation.
  const applyPreviewMutation = (msg) => {
    syncRosterOrderFromCurrentArray_(state.lastRosterData);
    normalizeRosterOrderInData_(state.lastRosterData);
    reindexAllRosters();
    rebalanceAllActiveCwlPreparationRostersLocal_({ recordAppliedAt: false, enforceLockedInLimit: false });
    clearSavedBenchSuggestionsFromPreview_();
    clearSuggestionMarks_();
    renderPreviewFromState();
    markReportStale();
    const publishBtn = $("#publishBtn");
    if (publishBtn) publishBtn.disabled = false;
    setStatus(msg || "Preview updated.");
  };

  // Find player location by tag.
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

  // Get roster preparation summary local.
  const getRosterPreparationSummaryLocal_ = (roster) => {
    const rosterSafe = roster && typeof roster === "object" ? roster : null;
    if (!rosterSafe) return null;
    const trackingMode = getRosterTrackingMode(rosterSafe);
    if (trackingMode !== "cwl") return null;
    const prep = getRosterCwlPreparationLocal_(rosterSafe, { keepWhenEmpty: true, enforceLockedInLimit: true });
    if (!prep) return null;
    const lockStateByTag = prep.lockStateByTag && typeof prep.lockStateByTag === "object" ? prep.lockStateByTag : {};
    const lockTags = Object.keys(lockStateByTag);
    const lockedInCount = lockTags.filter((tag) => lockStateByTag[tag] === "lockedIn").length;
    const lockedOutCount = lockTags.filter((tag) => lockStateByTag[tag] === "lockedOut").length;
    const filledMainCount = Array.isArray(rosterSafe.main) ? rosterSafe.main.length : 0;
    const underfilled = !!prep.enabled && filledMainCount < prep.rosterSize;
    const summaryText = prep.enabled
      ? (underfilled
        ? ("underfilled " + filledMainCount + " / " + prep.rosterSize)
        : ("planned " + filledMainCount + " / " + prep.rosterSize))
      : "off";
    return {
      enabled: !!prep.enabled,
      rosterSize: prep.rosterSize,
      filledMainCount,
      underfilled,
      lockedInCount,
      lockedOutCount,
      summaryText,
    };
  };

  // Set roster preparation enabled local.
  const setRosterPreparationEnabledLocal_ = (rosterIdRaw, enabledRaw) => {
    const rosterId = toStr(rosterIdRaw).trim();
    if (!rosterId) throw new Error("Roster ID is required.");
    const roster = getRosterById(rosterId);
    if (!roster) throw new Error("Roster not found: " + rosterId);
    ensureRosterArrays(roster);
    const enabled = !!enabledRaw;
    if (enabled && getRosterTrackingMode(roster) !== "cwl") {
      throw new Error(CWL_PREPARATION_WARNING_SWITCH_TO_CWL);
    }
    const prep = getRosterCwlPreparationLocal_(roster, { keepWhenEmpty: true, enforceLockedInLimit: true }) || {
      enabled: false,
      rosterSize: getInitialPreparationRosterSizeForEnableLocal_(roster),
      lockStateByTag: {},
      algorithm: CWL_PREPARATION_ALGORITHM,
    };
    if (enabled) {
      prep.enabled = true;
      prep.rosterSize = normalizePreparationRosterSizeLocal_(prep.rosterSize, getInitialPreparationRosterSizeForEnableLocal_(roster));
      roster.cwlPreparation = prep;
      clearSavedBenchSuggestionsForRoster_(rosterId);
      clearSuggestionMarksForRoster_(rosterId);
      applyCwlPreparationRebalanceLocal_(roster, { enforceLockedInLimit: true, recordAppliedAt: false });
    } else {
      prep.enabled = false;
      roster.cwlPreparation = prep;
      reindexRoster(roster);
    }
    return getRosterPreparationSummaryLocal_(roster);
  };

  // Handle adjust roster preparation size local.
  const adjustRosterPreparationSizeLocal_ = (rosterIdRaw, deltaRaw) => {
    const rosterId = toStr(rosterIdRaw).trim();
    if (!rosterId) throw new Error("Roster ID is required.");
    const roster = getRosterById(rosterId);
    if (!roster) throw new Error("Roster not found: " + rosterId);
    if (getRosterTrackingMode(roster) !== "cwl") {
      throw new Error(CWL_PREPARATION_WARNING_SWITCH_TO_CWL);
    }
    const prep = getRosterCwlPreparationLocal_(roster, { keepWhenEmpty: true, enforceLockedInLimit: true });
    if (!prep || !prep.enabled) {
      throw new Error("Enable CWL Preparation Mode first.");
    }
    const stepDelta = Number(deltaRaw);
    if (!Number.isFinite(stepDelta) || (stepDelta !== 1 && stepDelta !== -1)) {
      throw new Error("Invalid roster size step.");
    }
    const nextSize = normalizePreparationRosterSizeLocal_(
      prep.rosterSize + (stepDelta * CWL_PREPARATION_ROSTER_SIZE_STEP),
      prep.rosterSize
    );
    const lockStateByTag = prep.lockStateByTag && typeof prep.lockStateByTag === "object" ? prep.lockStateByTag : {};
    const lockedInCount = Object.keys(lockStateByTag).filter((tag) => lockStateByTag[tag] === "lockedIn").length;
    if (lockedInCount > nextSize) {
      throw new Error("Cannot set " + nextSize + "v" + nextSize + ": locked-In players (" + lockedInCount + ") exceed roster size.");
    }
    prep.rosterSize = nextSize;
    roster.cwlPreparation = prep;
    applyCwlPreparationRebalanceLocal_(roster, { enforceLockedInLimit: true, recordAppliedAt: false });
    return getRosterPreparationSummaryLocal_(roster);
  };

  // Set player preparation lock state local.
  const setPlayerPreparationLockStateLocal_ = (rosterIdRaw, playerTagRaw, nextStateRaw) => {
    const rosterId = toStr(rosterIdRaw).trim();
    const playerTag = normalizeTag(playerTagRaw);
    if (!rosterId) throw new Error("Roster ID is required.");
    if (!playerTag) throw new Error("Player tag is required.");
    const roster = getRosterById(rosterId);
    if (!roster) throw new Error("Roster not found: " + rosterId);
    if (getRosterTrackingMode(roster) !== "cwl") {
      throw new Error(CWL_PREPARATION_WARNING_SWITCH_TO_CWL);
    }
    const prep = getRosterCwlPreparationLocal_(roster, { keepWhenEmpty: true, enforceLockedInLimit: true });
    if (!prep || !prep.enabled) {
      throw new Error("Enable CWL Preparation Mode first.");
    }
    const nextStateValue = toStr(nextStateRaw).trim().toLowerCase();
    const normalizedNextState = nextStateValue === "lockedin"
      ? "lockedIn"
      : (nextStateValue === "lockedout" ? "lockedOut" : "auto");
    const lockStateByTag = prep.lockStateByTag && typeof prep.lockStateByTag === "object" ? prep.lockStateByTag : {};
    const currentState = toStr(lockStateByTag[playerTag]).trim();
    if (normalizedNextState === "lockedIn") {
      const lockedInCount = Object.keys(lockStateByTag).filter((tag) => lockStateByTag[tag] === "lockedIn").length;
      const nextLockedInCount = currentState === "lockedIn" ? lockedInCount : (lockedInCount + 1);
      if (nextLockedInCount > prep.rosterSize) {
        throw new Error("Cannot lock In: locked-In players would exceed roster size (" + prep.rosterSize + ").");
      }
      lockStateByTag[playerTag] = "lockedIn";
    } else if (normalizedNextState === "lockedOut") {
      lockStateByTag[playerTag] = "lockedOut";
    } else {
      delete lockStateByTag[playerTag];
    }
    prep.lockStateByTag = lockStateByTag;
    roster.cwlPreparation = prep;
    applyCwlPreparationRebalanceLocal_(roster, { enforceLockedInLimit: true, recordAppliedAt: false });
    return getRosterPreparationSummaryLocal_(roster);
  };

  // Handle move player to roster.
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
    const sourceSnapshot = cloneJson(sourceRoster);
    const targetSnapshot = cloneJson(targetRoster);

    const sourceList =
      sourceLoc.role === "main" ? sourceRoster.main : (sourceLoc.role === "sub" ? sourceRoster.subs : sourceRoster.missing);
    const targetList = sourceLoc.role === "main" ? targetRoster.main : targetRoster.subs;
    try {
      const removed = sourceList.splice(sourceLoc.index, 1);
      const player = removed[0];
      if (!player) throw new Error("Failed to move player: " + playerTag);
      targetList.push(player);

      transferPreparationLockOnExplicitMoveLocal_(sourceRoster, targetRoster, playerTag);
      rebalanceRosterIfPreparationActiveLocal_(sourceRoster, { enforceLockedInLimit: true, recordAppliedAt: false });
      rebalanceRosterIfPreparationActiveLocal_(targetRoster, { enforceLockedInLimit: true, recordAppliedAt: false });
    } catch (err) {
      rosters[sourceLoc.rosterIndex] = sourceSnapshot;
      rosters[targetIndex] = targetSnapshot;
      throw err;
    }

    const targetName = toStr(targetRoster.title).trim() || toStr(targetRoster.id).trim() || "target roster";
    applyPreviewMutation(playerTag + " moved to " + targetName + ".");
  };

  // Remove player from preview.
  const removePlayerFromPreview = (playerTagRaw) => {
    const rosters = getRosters();
    if (!rosters.length) throw new Error("No roster preview is loaded.");

    const playerTag = normalizeTag(playerTagRaw);
    if (!playerTag) throw new Error("Player tag is missing.");

    const loc = findPlayerLocationByTag(playerTag);
    if (!loc) throw new Error("Player not found: " + playerTag);

    const roster = rosters[loc.rosterIndex];
    ensureRosterArrays(roster);
    const rosterSnapshot = cloneJson(roster);
    const list = loc.role === "main" ? roster.main : (loc.role === "sub" ? roster.subs : roster.missing);
    try {
      const removed = list.splice(loc.index, 1);
      if (!removed.length) throw new Error("Failed to remove player: " + playerTag);
      const prep = getRosterCwlPreparationLocal_(roster, { keepWhenEmpty: true, enforceLockedInLimit: true });
      if (prep && prep.lockStateByTag && Object.prototype.hasOwnProperty.call(prep.lockStateByTag, playerTag)) {
        delete prep.lockStateByTag[playerTag];
        roster.cwlPreparation = prep;
      }
      rebalanceRosterIfPreparationActiveLocal_(roster, { enforceLockedInLimit: true, recordAppliedAt: false });
    } catch (err) {
      rosters[loc.rosterIndex] = rosterSnapshot;
      throw err;
    }

    applyPreviewMutation(playerTag + " removed from preview.");
  };

  // Update player info.
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
    const rosterSnapshot = cloneJson(roster);
    const list = loc.role === "main" ? roster.main : (loc.role === "sub" ? roster.subs : roster.missing);
    const player = list[loc.index];
    if (!player || typeof player !== "object") throw new Error("Failed to edit player record.");
    normalizePlayerFlagsInPlace(player);

    try {
      player.name = toStr(draft && draft.name).trim() || "(no name)";
      player.discord = toStr(draft && draft.discord).trim();
      player.th = th;
      player.tag = nextTag;
      player.notes = normalizeNotes(draft && draft.notes);
      movePreparationLockForEditedTagLocal_(roster, currentTag, nextTag);
      rebalanceRosterIfPreparationActiveLocal_(roster, { enforceLockedInLimit: true, recordAppliedAt: false });
    } catch (err) {
      rosters[loc.rosterIndex] = rosterSnapshot;
      throw err;
    }

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

  // Set player swap exclusion flag.
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

  // Add player to preview.
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

    const rosterSnapshot = cloneJson(targetRoster);
    const targetList = trackingMode === "regularWar" ? targetRoster.subs : targetRoster.main;
    try {
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
      rebalanceRosterIfPreparationActiveLocal_(targetRoster, { enforceLockedInLimit: true, recordAppliedAt: false });
    } catch (err) {
      const rosterIndex = rosters.findIndex((r) => toStr(r && r.id).trim() === rosterId);
      if (rosterIndex >= 0) rosters[rosterIndex] = rosterSnapshot;
      throw err;
    }

    const targetName = toStr(targetRoster.title).trim() || rosterId;
    applyPreviewMutation(tag + " added to " + targetName + ".");
  };

  // Add roster to preview.
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

  // Remove roster from preview.
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

  // Handle move roster in preview.
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

  // Handle mk player action button.
  const mkPlayerActionButton = (label, extraClass) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "player-admin-btn" + (extraClass ? " " + extraClass : "");
    btn.textContent = label;
    return btn;
  };

  // Handle mk player form row.
  const mkPlayerFormRow = (labelText, fieldNode) => {
    const row = document.createElement("div");
    row.className = "player-admin-row";

    const label = document.createElement("label");
    label.textContent = labelText;

    row.appendChild(label);
    row.appendChild(fieldNode);
    return row;
  };

  // Handle mk note editor.
  const mkNoteEditor = (initialNotes) => {
    const wrap = document.createElement("div");
    wrap.className = "player-admin-notes";

    const list = document.createElement("div");
    list.className = "player-admin-notes-list";

    // Add note row.
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

    // Get the normalized note list from the editor.
    const getNotes = () => {
      const inputs = Array.from(list.querySelectorAll('[data-note-input="1"]'));
      return normalizeNotes(inputs.map((x) => x && x.value));
    };

    return { element: wrap, getNotes };
  };

  // Get player admin panel node.
  const getPlayerAdminPanelNode = (actionNode, panelName) => {
    if (!actionNode || !panelName) return null;
    return actionNode.querySelector('[data-player-admin-panel="' + panelName + '"]');
  };

  // Set player admin tray expanded.
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

  // Open player admin panel.
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

  // Open player edit panel.
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

  // Build roster action controls.
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

  // Build player action controls.
  const buildPlayerActionControls = (ctx) => {
    if (!ctx || !ctx.player) return null;
    if (!state.lastRosterData || !Array.isArray(state.lastRosterData.rosters)) return null;
    const trackingMode = toStr(ctx.trackingMode).trim() === "regularWar" ? "regularWar" : "cwl";
    const rosterId = toStr(ctx.rosterId).trim();
    const roster = rosterId ? getRosterById(rosterId) : null;
    const prepSummary = trackingMode === "cwl" ? getRosterPreparationSummaryLocal_(roster) : null;
    const prepActive = !!(prepSummary && prepSummary.enabled);

    const playerTag = normalizeTag(ctx.player.tag);
    if (!playerTag) return null;

    const wrap = document.createElement("div");
    wrap.className = "player-admin-actions";
    wrap.dataset.playerTag = playerTag;
    wrap.dataset.rosterId = rosterId;

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
    // Add summary pill.
    const addSummaryPill = (text) => {
      const pill = document.createElement("span");
      pill.className = "player-admin-summary-pill";
      pill.textContent = text;
      summaryMeta.appendChild(pill);
    };
    if (trackingMode === "cwl") {
      const prepLockState = prepActive && roster && roster.cwlPreparation && roster.cwlPreparation.lockStateByTag && typeof roster.cwlPreparation.lockStateByTag === "object"
        ? toStr(roster.cwlPreparation.lockStateByTag[playerTag]).trim()
        : "";
      if (prepActive && prepLockState === "lockedIn") addSummaryPill("prep In");
      if (prepActive && prepLockState === "lockedOut") addSummaryPill("prep Out");
      if (!prepActive) {
        if (ctx.player.excludeAsSwapTarget) addSummaryPill("swap target off");
        if (ctx.player.excludeAsSwapSource) addSummaryPill("swap source off");
      }
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

    if (trackingMode === "cwl" && prepActive) {
      const prepPanel = document.createElement("div");
      prepPanel.className = "player-admin-settings cwl-prep-lock-panel";

      const prepTitle = document.createElement("div");
      prepTitle.className = "player-admin-settings-title";
      prepTitle.textContent = "CWL prep lock";
      prepPanel.appendChild(prepTitle);

      const currentLockState = roster && roster.cwlPreparation && roster.cwlPreparation.lockStateByTag && typeof roster.cwlPreparation.lockStateByTag === "object"
        ? toStr(roster.cwlPreparation.lockStateByTag[playerTag]).trim()
        : "";
      const activeState = currentLockState === "lockedIn" || currentLockState === "lockedOut"
        ? currentLockState
        : "auto";

      const segmented = document.createElement("div");
      segmented.className = "prep-lock-segmented";
      const lockOptions = [
        { key: "auto", label: "Auto" },
        { key: "lockedIn", label: "In" },
        { key: "lockedOut", label: "Out" },
      ];
      for (let i = 0; i < lockOptions.length; i++) {
        const option = lockOptions[i];
        const lockBtn = mkPlayerActionButton(option.label, "secondary prep-lock-btn" + (activeState === option.key ? " is-active" : ""));
        lockBtn.onclick = () => {
          try {
            clearPendingProfileReopen();
            setPlayerPreparationLockStateLocal_(rosterId, playerTag, option.key);
            applyPreviewMutation(playerTag + " prep lock set to " + option.label + ".");
          } catch (err) {
            alert("CWL prep lock update failed: " + toErrorMessage(err));
          }
        };
        segmented.appendChild(lockBtn);
      }
      prepPanel.appendChild(segmented);
      tray.appendChild(prepPanel);
    }

    if (trackingMode === "cwl" && !prepActive) {
      const settingsPanel = document.createElement("div");
      settingsPanel.className = "player-admin-settings";

      const settingsTitle = document.createElement("div");
      settingsTitle.className = "player-admin-settings-title";
      settingsTitle.textContent = "Algorithm settings";
      settingsPanel.appendChild(settingsTitle);

      const toggleRow = document.createElement("div");
      toggleRow.className = "player-admin-toggle-row";

      // Handle mk swap toggle.
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

  // Set the import action status message.
  const setImportActionStatus = (msg, isError) => {
    const el = $("#importActionStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "#fca5a5" : "#6b7280";
  };

  // Build import session label.
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

  // Clear import load warning.
  const clearImportLoadWarning = () => {
    state.importLoadWarning = null;
  };

  // Set import load failure warning.
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

  // Render import load warning.
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

  // Get import allowed clan keys from UI.
  const getImportAllowedClanKeysFromUi = () => {
    const checks = Array.from(document.querySelectorAll('[data-allowed-clan-checkbox="1"]'));
    return checks
      .filter((box) => !!(box && box.checked))
      .map((box) => toStr(box && box.value).trim())
      .filter(Boolean);
  };

  // Handle read import filters from UI.
  const readImportFiltersFromUi = () => ({
    excludeWarOut: !!($("#excludeWarOut") && $("#excludeWarOut").checked),
    requireDiscord: !!($("#requireDiscord") && $("#requireDiscord").checked),
    allowedClanKeys: getImportAllowedClanKeysFromUi(),
  });

  // Get default import filters.
  const getDefaultImportFilters = () => {
    const previous = state.importSession && state.importSession.filters ? state.importSession.filters : {};
    return {
      excludeWarOut: previous.excludeWarOut !== false,
      requireDiscord: !!previous.requireDiscord,
      allowedClanKeys: Array.isArray(previous.allowedClanKeys) ? previous.allowedClanKeys.slice() : [],
    };
  };

  // Load XLSX import session.
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

  // Handle align import mapping with preview.
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

  // Handle invalidate import comparison.
  const invalidateImportComparison = (reasonRaw) => {
    if (!state.importSession || !state.importSession.comparison) return;
    state.importSession.stale = true;
    state.importSession.staleReason = toStr(reasonRaw).trim() || "Preview changed. Re-run compare with preview.";
  };

  // Render import summary.
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

    // Add line.
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

  // Render allowed clans filter.
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

  // Build roster option label.
  const buildRosterOptionLabel = (roster) => {
    const id = toStr(roster && roster.id).trim();
    const title = toStr(roster && roster.title).trim();
    return title ? (title + " (" + id + ")") : id;
  };

  // Render clan mapping table.
  const renderClanMappingTable = () => {
    const mount = getClanMappingMount();
    if (!mount) return;
    mount.textContent = "";
    const isLegacyTableBody = mount.tagName === "TBODY";

    const session = state.importSession;
    const clans = session && Array.isArray(session.importedClanValues) ? session.importedClanValues : [];
    if (!clans.length) {
      if (isLegacyTableBody) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 3;
        td.className = "small muted";
        td.textContent = "Import a file to build clan mapping.";
        tr.appendChild(td);
        mount.appendChild(tr);
      } else {
        const empty = document.createElement("div");
        empty.className = "small muted";
        empty.textContent = "Import a file to build clan mapping.";
        mount.appendChild(empty);
      }
      return;
    }

    const rosters = getRosters().filter((roster) => toStr(roster && roster.id).trim());

    for (const clanEntry of clans) {
      const key = toStr(clanEntry && clanEntry.key).trim();
      if (!key) continue;
      const label = toStr(clanEntry && clanEntry.label).trim() || "(blank clan)";
      const count = Number.isFinite(Number(clanEntry && clanEntry.count)) ? Number(clanEntry.count) : 0;

      const select = document.createElement("select");
      select.className = "admin-select mapping-table-select clan-mapping-item__select";
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

      if (isLegacyTableBody) {
        const tr = document.createElement("tr");
        const tdClan = document.createElement("td");
        tdClan.textContent = label;
        const tdCount = document.createElement("td");
        tdCount.textContent = String(count);
        const tdMapping = document.createElement("td");
        tdMapping.appendChild(select);
        tr.appendChild(tdClan);
        tr.appendChild(tdCount);
        tr.appendChild(tdMapping);
        mount.appendChild(tr);
      } else {
        const row = document.createElement("div");
        row.className = "clan-mapping-item";

        const meta = document.createElement("div");
        meta.className = "clan-mapping-item__meta";

        const name = document.createElement("span");
        name.className = "clan-mapping-item__name";
        name.textContent = label;

        const countPill = document.createElement("span");
        countPill.className = "clan-mapping-item__count";
        countPill.textContent = String(count);
        countPill.title = count + " imported row(s)";

        meta.appendChild(name);
        meta.appendChild(countPill);

        row.appendChild(meta);
        row.appendChild(select);
        mount.appendChild(row);
      }
    }
  };

  // Refresh import actions UI.
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

  // Render XLSX meta.
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

  // Render import UI.
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

  // Handle run import comparison.
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

  // Apply import comparison.
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
      rebalanceAllActiveCwlPreparationRostersLocal_({ recordAppliedAt: false, enforceLockedInLimit: false });
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
    const list = Array.isArray(args) ? args : [];
    let response = null;
    let rawText = "";
    const payloadText = JSON.stringify({
      method: methodName,
      args: list,
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
      if (!text) return "";
      if (response.status === 404 && isLikelyWorkerAdminApiEndpoint(endpoint)) {
        return "Admin API route is missing at /api/admin. Falling back to Apps Script endpoint.";
      }
      if (text.indexOf("script-funktion nicht gefunden: dopost") >= 0 || text.indexOf("script function not found: dopost") >= 0) {
        return "Apps Script is missing doPost. Deploy the latest script version and redeploy the web app.";
      }
      return "";
    };

    const endpointIsProxy = isLikelyWorkerAdminApiEndpoint(endpoint);
    if (!response.ok) {
      const errMsg = payload && payload.error
        ? toStr(payload.error).trim()
        : (inferUpstreamError() || ("HTTP " + response.status + " while calling " + methodName + "."));
      const retryable = endpointIsProxy && (response.status === 404 || response.status === 405 || response.status >= 500);
      throw createAdminApiError(errMsg, retryable);
    }
    if (!payload || payload.ok !== true) {
      const errMsg = payload && payload.error
        ? toStr(payload.error).trim()
        : (inferUpstreamError() || ("Server method failed: " + methodName));
      const retryable = endpointIsProxy && !payload;
      throw createAdminApiError(errMsg || ("Server method failed: " + methodName), retryable);
    }
    return payload.result;
  };

  // Handle run server method via http.
  const runServerMethodViaHttp = async (methodName, args) => {
    const endpoints = resolveAdminApiEndpoints();
    let lastError = null;
    let bestError = null;
    // Handle error priority.
    const errorPriority = (errRaw) => {
      const msg = toStr(errRaw && errRaw.message).trim().toLowerCase();
      if (!msg) return 0;
      if (msg === "load failed" || msg.indexOf("failed to fetch") >= 0 || msg.indexOf("network error") >= 0) {
        return 0;
      }
      return 1;
    };
    for (let i = 0; i < endpoints.length; i++) {
      const endpoint = endpoints[i];
      try {
        return await callAdminApiEndpoint(endpoint, methodName, args);
      } catch (err) {
        lastError = err;
        if (!bestError || errorPriority(err) >= errorPriority(bestError)) {
          bestError = err;
        }
        const hasNext = i < endpoints.length - 1;
        if (!hasNext || !(err && err.retryable)) {
          throw bestError || err;
        }
      }
    }
    if (bestError) throw bestError;
    if (lastError) throw lastError;
    throw new Error("No admin API endpoints are configured.");
  };

  // Handle run server method.
  const runServerMethod = (methodName, args) =>
    new Promise((resolve, reject) => {
      if (window.google && google.script && google.script.run) {
        const runner = google.script.run
          .withSuccessHandler((r) => resolve(r))
          .withFailureHandler((e) => reject(e && e.message ? new Error(e.message) : e));

        if (!runner || typeof runner[methodName] !== "function") {
          reject(new Error("Server method is not available: " + methodName));
          return;
        }

        const list = Array.isArray(args) ? args : [];
        runner[methodName](...list);
        return;
      }

      runServerMethodViaHttp(methodName, args).then(resolve).catch(reject);
    });

  // Load active roster data.
  const loadActiveRosterData = () => runServerMethod("getRosterData", []);

  // Apply server synced preview.
  const applyServerSyncedPreview = (nextRosterData, statusMsg) => {
    if (!nextRosterData || !Array.isArray(nextRosterData.rosters)) {
      throw new Error("Sync returned invalid roster data.");
    }
    state.lastRosterData = nextRosterData;
    normalizeRosterOrderInData_(state.lastRosterData);
    reindexAllRosters();
    rebalanceAllActiveCwlPreparationRostersLocal_({
      recordAppliedAt: false,
      enforceLockedInLimit: false,
    });
    clearSuggestionMarks_();
    renderPreviewFromState();
    markReportStale();
    const publishBtn = $("#publishBtn");
    if (publishBtn) publishBtn.disabled = false;
    if (statusMsg) setStatus(statusMsg);
  };

  // Render connected rosters table.
  const renderConnectedRostersTable = () => {
    const mount = getConnectedRostersMount();
    if (!mount) return;

    const rosters = getRosters();
    mount.textContent = "";

    if (!rosters.length) {
      const empty = document.createElement("div");
      empty.className = "roster-card-empty";
      empty.textContent = "Load active config first.";
      mount.appendChild(empty);
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
      const prepSummary = trackingMode === "cwl" ? getRosterPreparationSummaryLocal_(r) : null;
      const prepActive = !!(prepSummary && prepSummary.enabled);

      const card = document.createElement("article");
      card.className = "roster-admin-card";
      card.dataset.rosterId = rosterId;

      const header = document.createElement("div");
      header.className = "roster-admin-card__header";

      const titleWrap = document.createElement("div");
      titleWrap.className = "roster-admin-card__title-wrap";
      const title = document.createElement("h3");
      title.className = "roster-admin-card__title";
      title.textContent = rosterTitle || rosterId;
      const idLine = document.createElement("div");
      idLine.className = "roster-admin-card__id";
      idLine.textContent = rosterId;
      titleWrap.appendChild(title);
      titleWrap.appendChild(idLine);

      const orderWrap = document.createElement("div");
      orderWrap.className = "roster-admin-card__order";

      const orderPill = document.createElement("span");
      orderPill.className = "roster-order-pill";
      orderPill.textContent = (rosterIndex + 1) + "/" + rosters.length;
      orderPill.title = "Display order";

      const orderControls = document.createElement("div");
      orderControls.className = "roster-order-controls";

      const moveUpBtn = document.createElement("button");
      moveUpBtn.type = "button";
      moveUpBtn.className = "clan-sync-btn secondary";
      moveUpBtn.textContent = "Up";
      moveUpBtn.title = "Move roster up";
      moveUpBtn.setAttribute("aria-label", "Move " + label + " up");

      const moveDownBtn = document.createElement("button");
      moveDownBtn.type = "button";
      moveDownBtn.className = "clan-sync-btn secondary";
      moveDownBtn.textContent = "Down";
      moveDownBtn.title = "Move roster down";
      moveDownBtn.setAttribute("aria-label", "Move " + label + " down");

      orderControls.appendChild(moveUpBtn);
      orderControls.appendChild(moveDownBtn);
      orderWrap.appendChild(orderPill);
      orderWrap.appendChild(orderControls);
      header.appendChild(titleWrap);
      header.appendChild(orderWrap);
      card.appendChild(header);

      const configGrid = document.createElement("div");
      configGrid.className = "roster-admin-card__config";

      const trackingField = document.createElement("label");
      trackingField.className = "admin-field";
      const trackingLabel = document.createElement("span");
      trackingLabel.className = "admin-field-label";
      trackingLabel.textContent = "Tracking mode";
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
      trackingField.appendChild(trackingLabel);
      trackingField.appendChild(trackingSelect);

      const tagField = document.createElement("label");
      tagField.className = "admin-field";
      const tagLabel = document.createElement("span");
      tagLabel.className = "admin-field-label";
      tagLabel.textContent = "Connected clan tag";
      const tagInput = document.createElement("input");
      tagInput.className = "admin-input";
      tagInput.type = "text";
      tagInput.placeholder = "#CLANTAG";
      tagInput.value = normalizeTag(r.connectedClanTag);
      tagInput.dataset.clanSyncTagInput = "1";
      tagInput.dataset.rosterId = rosterId;
      r.connectedClanTag = tagInput.value;
      tagField.appendChild(tagLabel);
      tagField.appendChild(tagInput);

      const prepField = document.createElement("div");
      prepField.className = "roster-admin-card__prep";
      const prepLabel = document.createElement("span");
      prepLabel.className = "admin-field-label";
      prepLabel.textContent = "CWL preparation";
      prepField.appendChild(prepLabel);

      const prepStrip = document.createElement("div");
      prepStrip.className = "cwl-prep-strip";
      let prepRosterSize = getInitialPreparationRosterSizeForEnableLocal_(r);
      if (trackingMode === "cwl") {
        const prepToggleBtn = document.createElement("button");
        prepToggleBtn.type = "button";
        prepToggleBtn.className = "clan-sync-btn secondary cwl-prep-toggle" + (prepActive ? " is-on" : " is-off");
        prepToggleBtn.textContent = prepActive ? "Prep ON" : "Prep OFF";
        prepToggleBtn.title = prepActive
          ? "Disable CWL preparation mode"
          : "Enable CWL preparation mode for this roster";

        const prepStepper = document.createElement("div");
        prepStepper.className = "cwl-prep-stepper";
        const prepMinusBtn = document.createElement("button");
        prepMinusBtn.type = "button";
        prepMinusBtn.className = "clan-sync-btn secondary cwl-prep-step";
        prepMinusBtn.textContent = "-";
        prepMinusBtn.title = "Decrease roster size by 5";
        const prepSizePill = document.createElement("span");
        prepSizePill.className = "cwl-prep-size-pill";
        prepRosterSize = prepSummary && Number.isFinite(Number(prepSummary.rosterSize))
          ? Number(prepSummary.rosterSize)
          : getInitialPreparationRosterSizeForEnableLocal_(r);
        prepSizePill.textContent = prepRosterSize + "v" + prepRosterSize;
        const prepPlusBtn = document.createElement("button");
        prepPlusBtn.type = "button";
        prepPlusBtn.className = "clan-sync-btn secondary cwl-prep-step";
        prepPlusBtn.textContent = "+";
        prepPlusBtn.title = "Increase roster size by 5";
        prepStepper.appendChild(prepMinusBtn);
        prepStepper.appendChild(prepSizePill);
        prepStepper.appendChild(prepPlusBtn);

        const prepSummaryPill = document.createElement("span");
        prepSummaryPill.className = "cwl-prep-summary-pill" + (prepSummary && prepSummary.underfilled ? " is-underfilled" : "");
        prepSummaryPill.textContent = prepSummary ? prepSummary.summaryText : "off";
        if (prepSummary) {
          prepSummaryPill.title = "locked in " + prepSummary.lockedInCount + ", locked out " + prepSummary.lockedOutCount;
        }

        prepToggleBtn.onclick = () => {
          try {
            clearPendingProfileReopen();
            setRosterPreparationEnabledLocal_(rosterId, !prepActive);
            applyPreviewMutation(
              (prepActive ? "CWL Preparation Mode disabled for " : "CWL Preparation Mode enabled for ") + rosterId + "."
            );
          } catch (err) {
            alert("CWL Preparation update failed: " + toErrorMessage(err));
          }
        };
        prepMinusBtn.onclick = () => {
          try {
            clearPendingProfileReopen();
            adjustRosterPreparationSizeLocal_(rosterId, -1);
            applyPreviewMutation("Preparation roster size updated for " + rosterId + ".");
          } catch (err) {
            alert("CWL Preparation size update failed: " + toErrorMessage(err));
          }
        };
        prepPlusBtn.onclick = () => {
          try {
            clearPendingProfileReopen();
            adjustRosterPreparationSizeLocal_(rosterId, 1);
            applyPreviewMutation("Preparation roster size updated for " + rosterId + ".");
          } catch (err) {
            alert("CWL Preparation size update failed: " + toErrorMessage(err));
          }
        };

        prepMinusBtn.disabled = !prepActive || prepRosterSize <= CWL_PREPARATION_MIN_ROSTER_SIZE;
        prepPlusBtn.disabled = !prepActive || prepRosterSize >= CWL_PREPARATION_MAX_ROSTER_SIZE;
        prepStrip.appendChild(prepToggleBtn);
        prepStrip.appendChild(prepStepper);
        prepStrip.appendChild(prepSummaryPill);
      }

      configGrid.appendChild(trackingField);
      configGrid.appendChild(tagField);
      if (trackingMode === "cwl") {
        prepField.appendChild(prepStrip);
        configGrid.appendChild(prepField);
      }
      card.appendChild(configGrid);

      const actions = document.createElement("div");
      actions.className = "roster-actions-grid";

      const testBtn = document.createElement("button");
      testBtn.type = "button";
      testBtn.className = "clan-sync-btn secondary";
      testBtn.textContent = "Test";
      testBtn.title = "Test clan connection";

      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "clan-sync-btn secondary";
      clearBtn.textContent = "Clear marks";
      clearBtn.title = "Clear saved bench and swap marks";

      actions.appendChild(testBtn);
      actions.appendChild(clearBtn);
      card.appendChild(actions);

      const statusLine = document.createElement("div");
      statusLine.className = "roster-admin-card__status";
      statusLine.setAttribute("aria-live", "polite");

      // Apply row status.
      const applyRowStatus = () => {
        const saved = state.rosterStatusByRoster[rosterId];
        if (!saved || !saved.msg) {
          statusLine.textContent = "";
          statusLine.style.color = "#94a3b8";
          return;
        }
        statusLine.textContent = saved.msg;
        statusLine.style.color = saved.isError ? "#fca5a5" : "#94a3b8";
      };

      // Set the row status message.
      const setRowStatus = (msg, isError) => {
        setRosterStatus(rosterId, msg, isError);
        applyRosterStatusToVisibleRow_(rosterId);
        applyRowStatus();
      };
      applyRowStatus();

      // Toggle busy state for the current control set.
      const setBusy = (busy) => {
        const disabled = !!busy || state.bulkRefreshBusy;
        moveUpBtn.disabled = disabled || rosterIndex === 0;
        moveDownBtn.disabled = disabled || rosterIndex >= rosters.length - 1;
        trackingSelect.disabled = disabled;
        tagInput.disabled = disabled;
        testBtn.disabled = disabled;
        clearBtn.disabled = disabled;
        const prepButtons = Array.from(prepStrip.querySelectorAll("button"));
        for (let i = 0; i < prepButtons.length; i++) {
          const btn = prepButtons[i];
          const isSizeStep = btn.classList.contains("cwl-prep-step");
          const sizeStepDisabled = isSizeStep && (
            !prepActive ||
            (btn.textContent === "-" && prepRosterSize <= CWL_PREPARATION_MIN_ROSTER_SIZE) ||
            (btn.textContent === "+" && prepRosterSize >= CWL_PREPARATION_MAX_ROSTER_SIZE)
          );
          btn.disabled = disabled || sizeStepDisabled;
        }
      };

      // Handle persist connected tag.
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
        const rosterSnapshot = cloneJson(r);
        try {
          r.trackingMode = nextMode;
          ensureRosterArrays(r);
          clearSavedBenchSuggestionsForRoster_(rosterId);
          clearSuggestionMarksForRoster_(rosterId);
          if (nextMode === "cwl") {
            migrateMissingPlayersToSubsForCwlLocal_(r);
            const prep = getRosterCwlPreparationLocal_(r, { keepWhenEmpty: true, enforceLockedInLimit: true });
            if (prep && prep.enabled) {
              applyCwlPreparationRebalanceLocal_(r, { enforceLockedInLimit: true, recordAppliedAt: false });
            } else {
              r.missing = [];
              reindexRoster(r);
            }
          } else {
            const prep = getRosterCwlPreparationLocal_(r, { keepWhenEmpty: true, enforceLockedInLimit: false });
            if (prep) {
              prep.enabled = false;
              r.cwlPreparation = prep;
            }
            reindexRoster(r);
          }
        } catch (err) {
          rosters[rosterIndex] = rosterSnapshot;
          alert("Tracking mode update failed: " + toErrorMessage(err));
          renderPreviewFromState();
          return;
        }
        const publishBtn = $("#publishBtn");
        if (publishBtn) publishBtn.disabled = false;
        setStatus("Tracking mode updated for " + rosterId + ".");
        markReportStale("Preview changed after tracking mode update. Re-run compare with preview.");
        renderPreviewFromState();
      });

      // Ensure server ready.
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
      card.appendChild(statusLine);
      mount.appendChild(card);
    }
  };

  // Refresh admin workflow UI.
  const refreshAdminWorkflowUi = () => {
    refreshRefreshAllUi();
    renderConnectedRostersTable();
    renderImportUi();
    applyBenchMarks_();
  };

  // Handle run refresh all.
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
    for (let i = 0; i < rosters.length; i++) {
      const rosterId = toStr(rosters[i] && rosters[i].id).trim();
      if (!rosterId) continue;
      setRosterStatus(rosterId, "Refreshing...", false);
    }
    refreshAdminWorkflowUi();
    setStatus("Refresh all running...");
    try {
      const requestRosterData = cloneCurrentRosterDataForServer_();
      const res = await runServerMethod("refreshAllRosters", [requestRosterData, state.password]);
      if (!res || !res.rosterData || !Array.isArray(res.rosterData.rosters)) {
        throw new Error("Refresh all returned invalid roster data.");
      }
      applyServerSyncedPreview(res.rosterData, "");

      const perRoster = Array.isArray(res.perRoster) ? res.perRoster : [];
      const perRosterById = {};
      for (let i = 0; i < perRoster.length; i++) {
        const item = perRoster[i] && typeof perRoster[i] === "object" ? perRoster[i] : {};
        const rosterId = toStr(item.rosterId).trim();
        if (!rosterId || Object.prototype.hasOwnProperty.call(perRosterById, rosterId)) continue;
        perRosterById[rosterId] = item;
      }

      const refreshedRosters = getRosters();
      for (let i = 0; i < refreshedRosters.length; i++) {
        const roster = refreshedRosters[i] && typeof refreshedRosters[i] === "object" ? refreshedRosters[i] : {};
        const rosterId = toStr(roster.id).trim();
        if (!rosterId) continue;
        const item = perRosterById[rosterId] && typeof perRosterById[rosterId] === "object" ? perRosterById[rosterId] : null;
        if (!item) {
          setRosterStatus(rosterId, "Refresh pipeline complete.", false);
          continue;
        }
        const issueCount = Number.isFinite(Number(item.issueCount)) ? Number(item.issueCount) : 0;
        const partialFailure = item.partialFailure === true;
        let message = toStr(item.message).trim();
        if (!message) {
          if (issueCount > 0) {
            message = issueCount === 1 ? "Refresh pipeline completed with 1 issue." : ("Refresh pipeline completed with " + issueCount + " issues.");
          } else if (partialFailure) {
            message = "Refresh pipeline completed with partial failure.";
          } else {
            message = "Refresh pipeline complete.";
          }
        }
        setRosterStatus(rosterId, message, issueCount > 0 || partialFailure || item.ok === false);
      }
      renderConnectedRostersTable();

      const processedRosters = Number.isFinite(Number(res.processedRosters)) ? Number(res.processedRosters) : refreshedRosters.length;
      const rostersWithIssues = Number.isFinite(Number(res.rostersWithIssues)) ? Number(res.rostersWithIssues) : 0;
      const issueCount = Number.isFinite(Number(res.issueCount)) ? Number(res.issueCount) : 0;
      if (issueCount > 0) {
        setStatus("Refresh all complete: " + issueCount + " issue(s) across " + rostersWithIssues + " roster(s).");
      } else {
        setStatus("Refresh all complete (" + processedRosters + " rosters).");
      }
    } catch (err) {
      const msg = toErrorMessage(err);
      for (let i = 0; i < rosters.length; i++) {
        const rosterId = toStr(rosters[i] && rosters[i].id).trim();
        if (!rosterId) continue;
        setRosterStatus(rosterId, msg, true);
      }
      throw err;
    } finally {
      state.bulkRefreshBusy = false;
      refreshAdminWorkflowUi();
    }
  };

  // Load active config into preview.
  const loadActiveConfigIntoPreview = async (optionsRaw) => {
    const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
    const silentError = !!options.silentError;
    const statusOnSuccess = toStr(options.statusOnSuccess).trim() || "Active config loaded.";

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
      setStatus(statusOnSuccess);
      return rosterData;
    } catch (err) {
      setStatus("");
      if (!silentError) {
        alert("Failed to load active config: " + toErrorMessage(err));
      }
      throw err;
    }
  };

  // Initialize the surrounding UI and bind startup behavior.
  const init = () => {
    window.ROSTER_ROSTER_ACTION_BUILDER = buildRosterActionControls;
    window.ROSTER_PLAYER_ACTION_BUILDER = buildPlayerActionControls;
    window.ROSTER_GET_ADMIN_PASSWORD = () => state.password || "";
    window.ROSTER_OPEN_PLAYER_EDIT = openPlayerEditPanel;

    const backToPublicBtn = $("#backToPublicBtn");
    if (backToPublicBtn) {
      const baseRaw = toStr(window && window.ROSTER_STATIC_BASE_URL).trim() || "/";
      const base = baseRaw.endsWith("/") ? baseRaw : (baseRaw + "/");
      backToPublicBtn.setAttribute("href", base);
    }

    bindAdminTabs();
    bindOverlayCloseHandlers();
    setActiveAdminTab(state.activeAdminTab, { focusButton: false });
    setAuthCardUnlocked(false);
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

    // Unlock state.
    const handleUnlock = async () => {
      state.password = toStr($("#pw") && $("#pw").value).trim();
      if (!state.password) {
        setLoginStatus("Password is empty.");
        renderAutoRefreshUi();
        return;
      }

      try {
        setLoginStatus("Verifying...");
        await runServerMethod("verifyAdminPassword", [state.password]);

        show("#adminPanel", true);
        setAuthCardUnlocked(true);
        setActiveAdminTab(state.activeAdminTab, { focusButton: false });
        if (loginBtn) {
          loginBtn.disabled = true;
          loginBtn.textContent = "Unlocked";
        }
        if (pwInput) pwInput.disabled = true;
        setLoginStatus("Unlocked. Loading active config...");
        refreshAdminWorkflowUi();
        try {
          await loadAutoRefreshSettings();
        } catch (settingsErr) {
          alert("Unlocked, but failed to load auto-refresh settings: " + toErrorMessage(settingsErr));
        }
        try {
          await loadActiveConfigIntoPreview({
            silentError: true,
            statusOnSuccess: "Active config loaded.",
          });
          setLoginStatus("Unlocked.");
        } catch (loadErr) {
          setLoginStatus("Unlocked (auto-load failed).");
          setStatus("Auto-load failed. Use Load active config.");
        }
      } catch (err) {
        show("#adminPanel", false);
        setAuthCardUnlocked(false);
        setLoginStatus("Authentication failed.");
        state.password = "";
        state.autoRefreshSettings = null;
        state.autoRefreshBusy = false;
        if (loginBtn) {
          loginBtn.disabled = false;
          loginBtn.textContent = "Unlock";
        }
        if (pwInput) pwInput.disabled = false;
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

    const pageTitleInput = $("#pageTitle");
    if (pageTitleInput) {
      // Handle commit page title.
      const commitPageTitle = () => {
        if (!state.lastRosterData || !Array.isArray(state.lastRosterData.rosters)) return;
        const nextTitle = toStr(pageTitleInput.value).trim() || "Roster Overview";
        pageTitleInput.value = nextTitle;
        if (toStr(state.lastRosterData.pageTitle).trim() === nextTitle) return;
        state.lastRosterData.pageTitle = nextTitle;
        const publishBtn = $("#publishBtn");
        if (publishBtn) publishBtn.disabled = false;
        setStatus("Page title updated.");
        markReportStale("Preview changed after page title update. Re-run compare with preview.");
        renderPreviewFromState();
      };
      pageTitleInput.addEventListener("change", commitPageTitle);
      pageTitleInput.addEventListener("blur", commitPageTitle);
    }

    const excludeWarOutInput = $("#excludeWarOut");
    const requireDiscordInput = $("#requireDiscord");
    // Handle import filter change.
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
        await loadActiveConfigIntoPreview({
          silentError: false,
          statusOnSuccess: "Active config loaded.",
        });
      } catch (_err) {
        // Alert is shown inside loadActiveConfigIntoPreview when silentError is false.
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

        const publishResult = await runServerMethod("publishRosterData", [state.lastRosterData, pw]);

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

