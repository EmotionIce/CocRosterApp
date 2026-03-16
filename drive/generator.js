(() => {
  const toStr = (v) => (v == null ? "" : String(v));
  const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);

  const pick = (row, names) => {
    for (const n of names) {
      if (row && Object.prototype.hasOwnProperty.call(row, n)) return row[n];
    }
    if (row && typeof row === "object") {
      const keys = Object.keys(row);
      for (const n of names) {
        const wanted = String(n).toLowerCase();
        const key = keys.find((k) => String(k).toLowerCase() === wanted);
        if (key != null) return row[key];
      }
    }
    return undefined;
  };

  const normalizeWhitespace = (raw) => toStr(raw).replace(/\s+/g, " ").trim();

  const normalizeTag = (tag) => {
    const t = normalizeWhitespace(tag).toUpperCase();
    if (!t) return "";
    return t.startsWith("#") ? t : ("#" + t);
  };

  const normalizeClanKey = (clan) => normalizeWhitespace(clan).toUpperCase();
  const normalizeLookupKey = (text) => normalizeWhitespace(text).toUpperCase().replace(/[^A-Z0-9]/g, "");

  const parseIntStrict = (v) => {
    if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
    const s = normalizeWhitespace(v);
    if (!s) return null;
    if (!/^-?\d+$/.test(s)) return null;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  };

  const normalizeWarPref = (v) => {
    const s = normalizeWhitespace(v).toLowerCase();
    if (!s) return "unknown";
    if (s === "in" || s === "yes" || s === "true") return "in";
    if (s === "out" || s === "no" || s === "false") return "out";
    return "unknown";
  };

  const NAME_PLACEHOLDERS = {
    "": true,
    "-": true,
    "--": true,
    "n/a": true,
    "na": true,
    "none": true,
    "unknown": true,
    "(no name)": true,
    "no name": true,
    "null": true,
  };

  const DISCORD_PLACEHOLDERS = {
    "": true,
    "-": true,
    "--": true,
    "n/a": true,
    "na": true,
    "none": true,
    "unknown": true,
    "null": true,
    "not set": true,
    "missing": true,
  };

  const sanitizeNameCandidate = (raw) => {
    const text = normalizeWhitespace(raw);
    if (!text) return "";
    const key = text.toLowerCase();
    return NAME_PLACEHOLDERS[key] ? "" : text;
  };

  const sanitizeDiscordCandidate = (raw) => {
    const text = normalizeWhitespace(raw);
    if (!text) return "";
    const key = text.toLowerCase();
    return DISCORD_PLACEHOLDERS[key] ? "" : text;
  };

  const isNonEmptyProfileValue = (value) => !!normalizeWhitespace(value);

  const ensureRosterArrays = (roster) => {
    if (!roster || typeof roster !== "object") return;
    if (!Array.isArray(roster.main)) roster.main = [];
    if (!Array.isArray(roster.subs)) roster.subs = [];
    if (!Array.isArray(roster.missing)) roster.missing = [];
  };

  const cloneJson = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));

  const parseXlsxRowsTolerant = (rows) => {
    if (!Array.isArray(rows)) throw new Error("XLSX rows must be an array.");

    const accounts = [];
    const invalidRows = [];
    const ignoredRows = [];
    const seenTags = {};

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] && typeof rows[i] === "object" ? rows[i] : {};
      const rowNumber = i + 2;

      const nameRaw = pick(row, ["NAME", "Name", "Player Name"]);
      const tagRaw = pick(row, ["TAG", "Tag", "Player Tag"]);
      const thRaw = pick(row, ["Town-Hall", "Town Hall", "TownHall", "Townhall", "TH"]);
      const clanRaw = pick(row, ["CLAN", "Clan"]);
      const warPrefRaw = pick(row, ["War Preference", "WarPref", "War preference"]);
      const discordRaw = pick(row, ["Username", "Discord", "DISCORD", "Discord/Username", "Discord Username"]);

      const name = normalizeWhitespace(nameRaw);
      const tag = normalizeTag(tagRaw);
      const clan = normalizeWhitespace(clanRaw);
      const clanKey = normalizeClanKey(clan);
      const discord = normalizeWhitespace(discordRaw);
      const warPref = normalizeWarPref(warPrefRaw);
      const th = parseIntStrict(thRaw);

      const hasAnyData =
        isNonEmptyProfileValue(nameRaw) ||
        isNonEmptyProfileValue(tagRaw) ||
        isNonEmptyProfileValue(thRaw) ||
        isNonEmptyProfileValue(clanRaw) ||
        isNonEmptyProfileValue(warPrefRaw) ||
        isNonEmptyProfileValue(discordRaw);

      if (!tag) {
        if (hasAnyData) {
          invalidRows.push({
            rowNumber,
            reason: "missing TAG",
            row: { name, tag: "", clan, discord, thRaw: toStr(thRaw), warPref },
          });
        } else {
          ignoredRows.push({ rowNumber, reason: "blank row" });
        }
        continue;
      }

      if (seenTags[tag]) {
        invalidRows.push({
          rowNumber,
          reason: "duplicate TAG in import",
          row: { name, tag, clan, discord, thRaw: toStr(thRaw), warPref },
        });
        continue;
      }
      seenTags[tag] = true;

      if (th == null || th < 1 || th > 25) {
        invalidRows.push({
          rowNumber,
          reason: "invalid TH",
          row: { name, tag, clan, discord, thRaw: toStr(thRaw), warPref },
        });
        continue;
      }

      accounts.push({
        rowNumber,
        tag,
        name,
        discord,
        th,
        clan,
        clanKey,
        warPref,
      });
    }

    return {
      totalRows: rows.length,
      parsedCount: accounts.length,
      accounts,
      invalidRows,
      ignoredRows,
    };
  };

  const extractImportedClanValues = (accountsRaw) => {
    const accounts = Array.isArray(accountsRaw) ? accountsRaw : [];
    const byKey = {};

    for (const account of accounts) {
      const clanKey = normalizeClanKey(account && account.clan);
      const label = normalizeWhitespace(account && account.clan);
      if (!byKey[clanKey]) {
        byKey[clanKey] = {
          key: clanKey,
          count: 0,
          labels: {},
        };
      }
      byKey[clanKey].count++;
      if (label) byKey[clanKey].labels[label] = (byKey[clanKey].labels[label] || 0) + 1;
    }

    const entries = Object.values(byKey).map((entry) => {
      const labels = Object.keys(entry.labels);
      labels.sort((a, b) => {
        const countDiff = (entry.labels[b] || 0) - (entry.labels[a] || 0);
        if (countDiff) return countDiff;
        return a.localeCompare(b);
      });
      return {
        key: entry.key,
        label: labels[0] || "(blank clan)",
        count: entry.count,
      };
    });

    entries.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.label.localeCompare(b.label);
    });

    return entries;
  };

  const buildRosterMetadata = (rosterData) => {
    const rosters = rosterData && Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
    const byId = {};
    const list = [];

    for (const rosterRaw of rosters) {
      const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
      const id = normalizeWhitespace(roster.id);
      if (!id) continue;
      const title = normalizeWhitespace(roster.title);
      byId[id] = roster;
      list.push({ id, title });
    }

    return { byId, list };
  };

  const suggestClanMappings = (args) => {
    const input = isObj(args) ? args : {};
    const importedClanValues = Array.isArray(input.importedClanValues) ? input.importedClanValues : [];
    const rosterMeta = buildRosterMetadata(input.rosterData);

    const rosterCandidates = rosterMeta.list.map((roster) => {
      const keys = {};
      keys[normalizeClanKey(roster.id)] = true;
      keys[normalizeLookupKey(roster.id)] = true;
      if (roster.title) {
        keys[normalizeClanKey(roster.title)] = true;
        keys[normalizeLookupKey(roster.title)] = true;
      }
      return { id: roster.id, title: roster.title, keys };
    });

    const seeded = {
      TURTLE: "turtle-main-m1-5v5",
      "TURTLE CWL": "turtle-cwl-crystal-2-30v30",
      PROJECTSE7VEN: "p7-comp-clan",
    };

    const mapping = {};

    for (const clanEntryRaw of importedClanValues) {
      const clanEntry = clanEntryRaw && typeof clanEntryRaw === "object" ? clanEntryRaw : {};
      const clanKey = normalizeClanKey(clanEntry.key || clanEntry.label);
      if (!clanKey) continue;

      const seededRosterId = seeded[clanKey];
      if (seededRosterId && rosterMeta.byId[seededRosterId]) {
        mapping[clanKey] = seededRosterId;
        continue;
      }

      const lookupKey = normalizeLookupKey(clanEntry.label || clanKey);
      const matches = rosterCandidates.filter((candidate) => {
        if (candidate.keys[clanKey]) return true;
        if (lookupKey && candidate.keys[lookupKey]) return true;
        return false;
      });

      if (matches.length === 1) {
        mapping[clanKey] = matches[0].id;
      }
    }

    return mapping;
  };

  const normalizeImportFilters = (filtersRaw) => {
    const filters = isObj(filtersRaw) ? filtersRaw : {};
    const allowed = Array.isArray(filters.allowedClanKeys)
      ? filters.allowedClanKeys.map((key) => normalizeClanKey(key)).filter(Boolean)
      : [];

    return {
      excludeWarOut: !!filters.excludeWarOut,
      requireDiscord: !!filters.requireDiscord,
      allowedClanKeys: Array.from(new Set(allowed)),
    };
  };

  const normalizeImportMapping = (mappingRaw, importedClanValues, rosterData) => {
    const mapping = isObj(mappingRaw) ? mappingRaw : {};
    const imported = Array.isArray(importedClanValues) ? importedClanValues : [];
    const rosterMeta = buildRosterMetadata(rosterData);

    const out = {};
    for (const clanEntry of imported) {
      const clanKey = normalizeClanKey(clanEntry && (clanEntry.key || clanEntry.label));
      if (!clanKey) continue;
      const rosterId = normalizeWhitespace(mapping[clanKey]);
      out[clanKey] = rosterMeta.byId[rosterId] ? rosterId : "";
    }
    return out;
  };

  const buildPreviewTagIndex = (rosterData) => {
    const rosters = rosterData && Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
    const byTag = {};
    const duplicates = [];

    const ingest = (playerRaw, rosterId, rosterTitle, role, rosterRef) => {
      const player = playerRaw && typeof playerRaw === "object" ? playerRaw : {};
      const tag = normalizeTag(player.tag);
      if (!tag) return;
      if (byTag[tag]) {
        duplicates.push({ tag, first: byTag[tag], second: { rosterId, role } });
        return;
      }
      byTag[tag] = {
        tag,
        rosterId,
        rosterTitle,
        role,
        player,
        roster: rosterRef,
      };
    };

    for (const rosterRaw of rosters) {
      const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
      ensureRosterArrays(roster);
      const rosterId = normalizeWhitespace(roster.id);
      if (!rosterId) continue;
      const rosterTitle = normalizeWhitespace(roster.title);
      for (const player of roster.main) ingest(player, rosterId, rosterTitle, "main", roster);
      for (const player of roster.subs) ingest(player, rosterId, rosterTitle, "subs", roster);
      for (const player of roster.missing) ingest(player, rosterId, rosterTitle, "missing", roster);
    }

    return { byTag, duplicates };
  };

  const buildSafeMatchedUpdates = (existingPlayerRaw, importedAccountRaw) => {
    const existingPlayer = existingPlayerRaw && typeof existingPlayerRaw === "object" ? existingPlayerRaw : {};
    const imported = importedAccountRaw && typeof importedAccountRaw === "object" ? importedAccountRaw : {};

    const updates = {};
    const current = {
      name: normalizeWhitespace(existingPlayer.name),
      discord: normalizeWhitespace(existingPlayer.discord),
      th: parseIntStrict(existingPlayer.th),
    };

    const importedName = sanitizeNameCandidate(imported.name);
    const importedDiscord = sanitizeDiscordCandidate(imported.discord);
    const importedTh = parseIntStrict(imported.th);

    if (importedName && importedName !== current.name) {
      updates.name = importedName;
    }
    if (importedDiscord && importedDiscord !== current.discord) {
      updates.discord = importedDiscord;
    }
    if (importedTh != null && importedTh >= 1 && importedTh <= 25 && importedTh !== current.th) {
      updates.th = importedTh;
    }

    return updates;
  };

  const buildImportComparison = (args) => {
    const input = isObj(args) ? args : {};
    const rosterData = input.rosterData;
    const accounts = Array.isArray(input.accounts) ? input.accounts : [];
    const invalidRows = Array.isArray(input.invalidRows) ? input.invalidRows : [];
    const ignoredRowsFromParse = Array.isArray(input.ignoredRows) ? input.ignoredRows : [];
    const filters = normalizeImportFilters(input.filters);

    const importedClanValues = Array.isArray(input.importedClanValues)
      ? input.importedClanValues
      : extractImportedClanValues(accounts);

    const normalizedMapping = normalizeImportMapping(input.mapping, importedClanValues, rosterData);
    const rosterMeta = buildRosterMetadata(rosterData);
    const previewIndex = buildPreviewTagIndex(rosterData);

    const allowedSet = filters.allowedClanKeys.length ? new Set(filters.allowedClanKeys) : null;

    const matchedUnchanged = [];
    const matchedWithUpdates = [];
    const newAddable = [];
    const reviewOnly = [];
    const ignoredWarOut = [];
    const ignoredClanNotAllowed = [];
    const ignoredMissingDiscord = [];

    for (const accountRaw of accounts) {
      const account = accountRaw && typeof accountRaw === "object" ? accountRaw : {};
      const tag = normalizeTag(account.tag);
      if (!tag) continue;

      const clanKey = normalizeClanKey(account.clanKey || account.clan);
      const clanLabel = normalizeWhitespace(account.clan);

      if (filters.excludeWarOut && normalizeWarPref(account.warPref) === "out") {
        ignoredWarOut.push({
          rowNumber: account.rowNumber,
          tag,
          clan: clanLabel,
          reason: "war preference is out",
        });
        continue;
      }

      if (allowedSet && !allowedSet.has(clanKey)) {
        ignoredClanNotAllowed.push({
          rowNumber: account.rowNumber,
          tag,
          clan: clanLabel,
          reason: "clan is not selected in allowed clans",
        });
        continue;
      }

      const existing = previewIndex.byTag[tag];
      if (existing) {
        const updates = buildSafeMatchedUpdates(existing.player, account);
        const entry = {
          rowNumber: account.rowNumber,
          tag,
          clan: clanLabel,
          clanKey,
          rosterId: existing.rosterId,
          rosterTitle: existing.rosterTitle,
          role: existing.role,
          current: {
            name: normalizeWhitespace(existing.player && existing.player.name),
            discord: normalizeWhitespace(existing.player && existing.player.discord),
            th: parseIntStrict(existing.player && existing.player.th),
          },
          imported: {
            name: normalizeWhitespace(account.name),
            discord: normalizeWhitespace(account.discord),
            th: parseIntStrict(account.th),
          },
          updates,
        };

        if (Object.keys(updates).length) {
          matchedWithUpdates.push(entry);
        } else {
          matchedUnchanged.push(entry);
        }
        continue;
      }

      const mappedRosterId = normalizeWhitespace(normalizedMapping[clanKey]);
      if (!mappedRosterId || !rosterMeta.byId[mappedRosterId]) {
        reviewOnly.push({
          rowNumber: account.rowNumber,
          tag,
          name: normalizeWhitespace(account.name),
          discord: normalizeWhitespace(account.discord),
          th: parseIntStrict(account.th),
          clan: clanLabel,
          clanKey,
          reason: clanKey ? "unmapped clan" : "blank clan",
        });
        continue;
      }

      const discordCandidate = sanitizeDiscordCandidate(account.discord);
      if (filters.requireDiscord && !discordCandidate) {
        ignoredMissingDiscord.push({
          rowNumber: account.rowNumber,
          tag,
          clan: clanLabel,
          targetRosterId: mappedRosterId,
          reason: "missing Discord/Username for new member",
        });
        continue;
      }

      const targetRoster = rosterMeta.byId[mappedRosterId] || {};
      newAddable.push({
        rowNumber: account.rowNumber,
        tag,
        name: normalizeWhitespace(account.name),
        discord: normalizeWhitespace(account.discord),
        th: parseIntStrict(account.th),
        clan: clanLabel,
        clanKey,
        targetRosterId: mappedRosterId,
        targetRosterTitle: normalizeWhitespace(targetRoster.title),
      });
    }

    const actionableTotal = matchedWithUpdates.length + newAddable.length;

    const summary = {
      sheetName: normalizeWhitespace(input.sheetName),
      totalRowsRead: Number.isFinite(Number(input.totalRowsRead)) ? Number(input.totalRowsRead) : accounts.length,
      normalizedMembersParsed: accounts.length,
      matchedUnchanged: matchedUnchanged.length,
      matchedWithUpdates: matchedWithUpdates.length,
      newAddable: newAddable.length,
      reviewOnly: reviewOnly.length,
      ignoredWarOut: ignoredWarOut.length,
      ignoredClanNotAllowed: ignoredClanNotAllowed.length,
      ignoredMissingDiscord: ignoredMissingDiscord.length,
      ignoredBlankRows: ignoredRowsFromParse.length,
      invalidRows: invalidRows.length,
      actionableTotal,
      noDataToAdd: actionableTotal === 0,
    };

    return {
      filters,
      mapping: normalizedMapping,
      importedClanValues,
      previewTagDuplicates: previewIndex.duplicates,
      summary,
      buckets: {
        matchedUnchanged,
        matchedWithUpdates,
        newAddable,
        reviewOnly,
        ignored: {
          warOut: ignoredWarOut,
          clanNotAllowed: ignoredClanNotAllowed,
          missingDiscord: ignoredMissingDiscord,
          blankRows: ignoredRowsFromParse,
        },
        invalidRows,
      },
    };
  };

  const applyImportComparison = (args) => {
    const input = isObj(args) ? args : {};
    const rosterData = input.rosterData;
    const comparison = isObj(input.comparison) ? input.comparison : {};
    if (!rosterData || !Array.isArray(rosterData.rosters)) {
      throw new Error("rosterData must include a rosters array.");
    }

    const nextRosterData = cloneJson(rosterData);
    const buckets = isObj(comparison.buckets) ? comparison.buckets : {};
    const updates = Array.isArray(buckets.matchedWithUpdates) ? buckets.matchedWithUpdates : [];
    const additions = Array.isArray(buckets.newAddable) ? buckets.newAddable : [];

    const previewIndex = buildPreviewTagIndex(nextRosterData);
    const rosterMeta = buildRosterMetadata(nextRosterData);

    const appliedUpdates = [];
    const skippedUpdates = [];
    for (const updateRaw of updates) {
      const update = updateRaw && typeof updateRaw === "object" ? updateRaw : {};
      const tag = normalizeTag(update.tag);
      if (!tag) continue;
      const indexed = previewIndex.byTag[tag];
      if (!indexed || !indexed.player) {
        skippedUpdates.push({ tag, reason: "player not found in current preview" });
        continue;
      }

      const safeUpdates = isObj(update.updates) ? update.updates : {};
      if (safeUpdates.name != null) indexed.player.name = sanitizeNameCandidate(safeUpdates.name) || indexed.player.name;
      if (safeUpdates.discord != null) indexed.player.discord = sanitizeDiscordCandidate(safeUpdates.discord) || indexed.player.discord;
      if (safeUpdates.th != null) {
        const th = parseIntStrict(safeUpdates.th);
        if (th != null && th >= 1 && th <= 25) indexed.player.th = th;
      }

      appliedUpdates.push({
        tag,
        rosterId: indexed.rosterId,
      });
    }

    const addedMembers = [];
    const skippedAdds = [];
    for (const additionRaw of additions) {
      const addition = additionRaw && typeof additionRaw === "object" ? additionRaw : {};
      const tag = normalizeTag(addition.tag);
      if (!tag) continue;

      if (previewIndex.byTag[tag]) {
        skippedAdds.push({ tag, reason: "tag already exists in current preview" });
        continue;
      }

      const rosterId = normalizeWhitespace(addition.targetRosterId);
      const roster = rosterMeta.byId[rosterId];
      if (!roster) {
        skippedAdds.push({ tag, reason: "mapped roster not found" });
        continue;
      }

      ensureRosterArrays(roster);
      const th = parseIntStrict(addition.th);
      if (th == null || th < 1 || th > 25) {
        skippedAdds.push({ tag, reason: "invalid TH for new member" });
        continue;
      }

      const player = {
        slot: null,
        name: sanitizeNameCandidate(addition.name) || "(no name)",
        discord: sanitizeDiscordCandidate(addition.discord),
        th,
        tag,
        notes: [],
        excludeAsSwapTarget: false,
        excludeAsSwapSource: false,
      };

      roster.subs.push(player);
      previewIndex.byTag[tag] = {
        tag,
        rosterId,
        rosterTitle: normalizeWhitespace(roster.title),
        role: "subs",
        player,
        roster,
      };
      addedMembers.push({ tag, rosterId });
    }

    const rosters = Array.isArray(nextRosterData.rosters) ? nextRosterData.rosters : [];
    for (const rosterRaw of rosters) {
      const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
      ensureRosterArrays(roster);
      for (let i = 0; i < roster.main.length; i++) {
        const player = roster.main[i] && typeof roster.main[i] === "object" ? roster.main[i] : {};
        player.slot = i + 1;
      }
      for (let i = 0; i < roster.subs.length; i++) {
        const player = roster.subs[i] && typeof roster.subs[i] === "object" ? roster.subs[i] : {};
        player.slot = null;
      }
      for (let i = 0; i < roster.missing.length; i++) {
        const player = roster.missing[i] && typeof roster.missing[i] === "object" ? roster.missing[i] : {};
        player.slot = null;
      }
      roster.badges = {
        main: roster.main.length,
        subs: roster.subs.length,
        missing: roster.missing.length,
      };
    }

    return {
      rosterData: nextRosterData,
      applied: {
        updatedCount: appliedUpdates.length,
        addedCount: addedMembers.length,
        skippedUpdateCount: skippedUpdates.length,
        skippedAddCount: skippedAdds.length,
        updated: appliedUpdates,
        added: addedMembers,
        skippedUpdates,
        skippedAdds,
      },
    };
  };

  const api = {
    normalizeTag,
    normalizeClanKey,
    parseXlsxRowsTolerant,
    extractImportedClanValues,
    suggestClanMappings,
    normalizeImportFilters,
    normalizeImportMapping,
    buildPreviewTagIndex,
    buildImportComparison,
    applyImportComparison,
    _internal: {
      sanitizeNameCandidate,
      sanitizeDiscordCandidate,
      normalizeLookupKey,
      buildSafeMatchedUpdates,
    },
  };

  const root = (typeof window !== "undefined") ? window : (typeof globalThis !== "undefined" ? globalThis : global);
  root.RosterGenerator = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
