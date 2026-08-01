// Spreadsheet import parsing and roster generation helpers for the admin UI.

(() => {
  // Convert a value to a string safely.
  const toStr = (v) => (v == null ? "" : String(v));
  // Return whether a value is a plain object.
  const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
  // Normalize whitespace.
  const normalizeWhitespace = (raw) => toStr(raw).replace(/\s+/g, " ").trim();
  // Normalize column key.
  const normalizeColumnKey = (raw) => toStr(raw).trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

  // Build column lookup.
  const buildColumnLookup = (row) => {
    const out = {};
    if (!row || typeof row !== "object") return out;
    const keys = Object.keys(row);
    for (const key of keys) {
      const normalized = normalizeColumnKey(key);
      if (!normalized || out[normalized] != null) continue;
      out[normalized] = key;
    }
    return out;
  };

  // Pick the first matching property from a row object.
  const pick = (row, names) => {
    if (!row || typeof row !== "object") return undefined;

    for (const n of names) {
      if (Object.prototype.hasOwnProperty.call(row, n)) return row[n];
    }

    const keyLookup = buildColumnLookup(row);
    for (const n of names) {
      const key = keyLookup[normalizeColumnKey(n)];
      if (key != null) return row[key];
    }
    return undefined;
  };

  // Pick the first present, non-empty property from a row object.
  const pickFirstNonEmpty = (row, names) => {
    let firstPresent;
    for (const name of names) {
      const value = pick(row, [name]);
      if (value === undefined) continue;
      if (firstPresent === undefined) firstPresent = value;
      if (normalizeWhitespace(value)) return value;
    }
    return firstPresent;
  };

  // Normalize tag.
  const normalizeTag = (tag) => {
    const t = normalizeWhitespace(tag).toUpperCase();
    if (!t) return "";
    return t.startsWith("#") ? t : ("#" + t);
  };

  // Normalize clan key.
  const normalizeClanKey = (clan) => normalizeWhitespace(clan).toUpperCase();
  // Normalize lookup key.
  const normalizeLookupKey = (text) => normalizeWhitespace(text).toUpperCase().replace(/[^A-Z0-9]/g, "");

  // Parse int strict.
  const parseIntStrict = (v) => {
    if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
    const s = normalizeWhitespace(v);
    if (!s) return null;
    if (/^-?\d+$/.test(s)) {
      const n = parseInt(s, 10);
      return Number.isFinite(n) ? n : null;
    }

    // Accept text-like integers exported as decimal strings such as "16.0" or "16,0".
    const decimalLike = s.replace(",", ".");
    if (!/^-?\d+\.0+$/.test(decimalLike)) return null;
    const n = parseInt(decimalLike, 10);
    return Number.isFinite(n) ? n : null;
  };

  // Normalize war pref.
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

  // Prefer the username/handle value used by the site when a workbook provides
  // both a username-style column and a Discord display-name column. Display-name
  // columns remain supported as fallbacks for older or partial exports.
  const DISCORD_COLUMN_PREFERENCE = [
    "Username",
    "Discord Username",
    "Discord/Username",
    "Discord Handle",
    "Discord User",
    "Discord",
    "DISCORD",
    "Discord Name",
    "Discord Display Name",
  ];
  const DISCORD_ID_COLUMN_PREFERENCE = [
    "ID",
    "Discord ID",
    "DiscordID",
    "Discord Id",
    "Discord User ID",
    "Discord UserId",
    "Discord User Id",
    "User ID",
    "UserId",
  ];

  // Sanitize name candidate.
  const sanitizeNameCandidate = (raw) => {
    const text = normalizeWhitespace(raw);
    if (!text) return "";
    const key = text.toLowerCase();
    return NAME_PLACEHOLDERS[key] ? "" : text;
  };

  // Sanitize discord candidate.
  const sanitizeDiscordCandidate = (raw) => {
    const text = normalizeWhitespace(raw);
    if (!text) return "";
    const key = text.toLowerCase();
    return DISCORD_PLACEHOLDERS[key] ? "" : text;
  };

  // Sanitize Discord snowflake ID candidate.
  const sanitizeDiscordIdCandidate = (raw) => {
    if (typeof raw === "number") {
      if (!Number.isFinite(raw) || Math.floor(raw) !== raw || !Number.isSafeInteger(raw)) return "";
      raw = String(raw);
    }
    let text = toStr(raw)
      .replace(/[\u0000-\u001F\u007F\s]+/g, "")
      .trim();
    if (!text) return "";
    const key = text.toLowerCase();
    if (DISCORD_PLACEHOLDERS[key]) return "";
    if (/^\d+\.0+$/.test(text)) text = text.slice(0, text.indexOf("."));
    return /^\d{15,25}$/.test(text) ? text : "";
  };

  // Sanitize already-stored Discord IDs permissively so import never treats an
  // existing bot/API identity as missing just because older tests or fixtures
  // used shortened IDs.
  const sanitizeStoredDiscordIdCandidate = (raw) => {
    const text = toStr(raw)
      .replace(/[\u0000-\u001F\u007F\s]+/g, "")
      .trim();
    if (!text) return "";
    const key = text.toLowerCase();
    return DISCORD_PLACEHOLDERS[key] ? "" : text;
  };

  // Pick the first meaningful Discord candidate while letting placeholder values
  // such as "n/a" fall through to later alias columns.
  const pickPreferredDiscordValue = (row) => {
    let firstPresent;
    for (const name of DISCORD_COLUMN_PREFERENCE) {
      const value = pick(row, [name]);
      if (value === undefined) continue;
      if (firstPresent === undefined) firstPresent = value;
      if (sanitizeDiscordCandidate(value)) return value;
    }
    return firstPresent;
  };

  // Return whether non empty profile value.
  const isNonEmptyProfileValue = (value) => !!normalizeWhitespace(value);

  // Ensure roster arrays.
  const ensureRosterArrays = (roster) => {
    if (!roster || typeof roster !== "object") return;
    if (!Array.isArray(roster.main)) roster.main = [];
    if (!Array.isArray(roster.subs)) roster.subs = [];
    if (!Array.isArray(roster.missing)) roster.missing = [];
  };

  // Deep-clone a JSON-safe value.
  const cloneJson = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));

  // Parse XLSX rows tolerant.
  const parseXlsxRowsTolerant = (rows) => {
    if (!Array.isArray(rows)) throw new Error("XLSX rows must be an array.");

    const accounts = [];
    const invalidRows = [];
    const ignoredRows = [];
    const seenTags = {};

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] && typeof rows[i] === "object" ? rows[i] : {};
      const rowNumber = i + 2;

      const nameRaw = pickFirstNonEmpty(row, ["NAME", "Name", "Player Name"]);
      const tagRaw = pickFirstNonEmpty(row, ["TAG", "Tag", "Player Tag"]);
      const thRaw = pickFirstNonEmpty(row, ["Town-Hall", "Town Hall", "TownHall", "Townhall", "TH"]);
      const clanRaw = pickFirstNonEmpty(row, ["CLAN", "Clan"]);
      const warPrefRaw = pickFirstNonEmpty(row, ["War Preference", "WarPref", "War preference"]);
      const discordRaw = pickPreferredDiscordValue(row);
      const discordIdRaw = pickFirstNonEmpty(row, DISCORD_ID_COLUMN_PREFERENCE);

      const name = normalizeWhitespace(nameRaw);
      const tag = normalizeTag(tagRaw);
      const clan = normalizeWhitespace(clanRaw);
      const clanKey = normalizeClanKey(clan);
      const discord = normalizeWhitespace(discordRaw);
      const discordId = sanitizeDiscordIdCandidate(discordIdRaw);
      const warPref = normalizeWarPref(warPrefRaw);
      const th = parseIntStrict(thRaw);

      const hasAnyData =
        isNonEmptyProfileValue(nameRaw) ||
        isNonEmptyProfileValue(tagRaw) ||
        isNonEmptyProfileValue(thRaw) ||
        isNonEmptyProfileValue(clanRaw) ||
        isNonEmptyProfileValue(warPrefRaw) ||
        isNonEmptyProfileValue(discordRaw) ||
        isNonEmptyProfileValue(discordIdRaw);

      if (!tag) {
        if (hasAnyData) {
          invalidRows.push({
            rowNumber,
            reason: "missing TAG",
            row: { name, tag: "", clan, discord, discordId, thRaw: toStr(thRaw), warPref },
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
          row: { name, tag, clan, discord, discordId, thRaw: toStr(thRaw), warPref },
        });
        continue;
      }
      seenTags[tag] = true;

      if (th == null || th < 1 || th > 25) {
        invalidRows.push({
          rowNumber,
          reason: "invalid TH",
          row: { name, tag, clan, discord, discordId, thRaw: toStr(thRaw), warPref },
        });
        continue;
      }

      accounts.push({
        rowNumber,
        tag,
        name,
        discord,
        discordId,
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

  // Extract imported clan values.
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

  // Build roster metadata.
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

  // Build import mapping seed lookup from public config profile extensions.
  // Supports both array and object forms:
  // - profile.importMappingSeeds: [{ clan: "Clan Name", rosterId: "roster-id" }]
  // - profile.importMappingSeeds: { "CLAN_NAME": "roster-id" }
  const buildImportMappingSeedLookup = (rosterDataRaw, rosterMetaRaw) => {
    const rosterData = isObj(rosterDataRaw) ? rosterDataRaw : {};
    const rosterMeta = isObj(rosterMetaRaw) ? rosterMetaRaw : buildRosterMetadata(rosterData);
    const publicConfig = isObj(rosterData.publicConfig) ? rosterData.publicConfig : {};
    const landingConfig = isObj(publicConfig.landing) ? publicConfig.landing : {};
    const rootProfile = isObj(publicConfig.profile) ? publicConfig.profile : {};
    const landingProfile = isObj(landingConfig.profile) ? landingConfig.profile : {};

    const byClanKey = {};
    const byLookupKey = {};

    // Add one seed pair if the target roster exists.
    const addSeed = (clanRaw, rosterIdRaw) => {
      const clan = normalizeWhitespace(clanRaw);
      const rosterId = normalizeWhitespace(rosterIdRaw);
      if (!clan || !rosterId || !rosterMeta.byId[rosterId]) return;
      const clanKey = normalizeClanKey(clan);
      const lookupKey = normalizeLookupKey(clan);
      if (clanKey) byClanKey[clanKey] = rosterId;
      if (lookupKey) byLookupKey[lookupKey] = rosterId;
    };

    // Read either array or object form of seeds.
    const consumeSeeds = (seedsRaw) => {
      if (Array.isArray(seedsRaw)) {
        for (const entryRaw of seedsRaw) {
          const entry = isObj(entryRaw) ? entryRaw : {};
          addSeed(
            entry.clan || entry.label || entry.key || entry.name,
            entry.rosterId || entry.targetRosterId || entry.id
          );
        }
        return;
      }
      if (!isObj(seedsRaw)) return;
      const keys = Object.keys(seedsRaw);
      for (const key of keys) {
        addSeed(key, seedsRaw[key]);
      }
    };

    consumeSeeds(rootProfile.importMappingSeeds);
    consumeSeeds(landingProfile.importMappingSeeds);
    return { byClanKey, byLookupKey };
  };

  // Handle suggest clan mappings.
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
    const seededByLookup = {};
    for (const key of Object.keys(seeded)) {
      seededByLookup[normalizeLookupKey(key)] = seeded[key];
    }
    const customSeedLookup = buildImportMappingSeedLookup(input.rosterData, rosterMeta);

    const mapping = {};

    for (const clanEntryRaw of importedClanValues) {
      const clanEntry = clanEntryRaw && typeof clanEntryRaw === "object" ? clanEntryRaw : {};
      const clanKey = normalizeClanKey(clanEntry.key || clanEntry.label);
      if (!clanKey) continue;
      const lookupKey = normalizeLookupKey(clanEntry.label || clanKey);

      const customRosterId = customSeedLookup.byClanKey[clanKey] || customSeedLookup.byLookupKey[lookupKey];
      if (customRosterId && rosterMeta.byId[customRosterId]) {
        mapping[clanKey] = customRosterId;
        continue;
      }

      const seededRosterId = seeded[clanKey] || seededByLookup[lookupKey];
      if (seededRosterId && rosterMeta.byId[seededRosterId]) {
        mapping[clanKey] = seededRosterId;
        continue;
      }

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

  // Normalize import filters.
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

  // Normalize import mapping.
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

  // Build preview tag index.
  const buildPreviewTagIndex = (rosterData) => {
    const rosters = rosterData && Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
    const byTag = {};
    const duplicates = [];

    // Ingest one item into the current accumulator or index.
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

  // Read the canonical playerMetrics identity for a tag.
  const readPlayerMetricsIdentityByTag = (rosterDataRaw, tagRaw) => {
    const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
    const tag = normalizeTag(tagRaw);
    if (!tag) return {};
    const store = rosterData.playerMetrics && typeof rosterData.playerMetrics === "object" ? rosterData.playerMetrics : {};
    const byTag = store.byTag && typeof store.byTag === "object" ? store.byTag : {};
    const entry = byTag[tag] && typeof byTag[tag] === "object" ? byTag[tag] : {};
    return entry.identity && typeof entry.identity === "object" ? entry.identity : {};
  };

  // Ensure mutable playerMetrics.byTag for import identity fills.
  const ensureImportPlayerMetricsByTag = (rosterDataRaw) => {
    const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
    const store = rosterData.playerMetrics && typeof rosterData.playerMetrics === "object"
      ? rosterData.playerMetrics
      : {};
    const byTag = store.byTag && typeof store.byTag === "object" ? store.byTag : {};
    store.schemaVersion = Number.isFinite(Number(store.schemaVersion)) ? Number(store.schemaVersion) : 1;
    store.updatedAt = normalizeWhitespace(store.updatedAt);
    store.byTag = byTag;
    rosterData.playerMetrics = store;
    return byTag;
  };

  // Fill a missing canonical Discord ID from an imported account without
  // overwriting a bot-linked ID already present in playerMetrics.
  const upsertImportedDiscordIdentity = (rosterDataRaw, accountRaw, optionsRaw) => {
    const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : null;
    const account = accountRaw && typeof accountRaw === "object" ? accountRaw : {};
    const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
    const tag = normalizeTag(account.tag);
    const importedDiscordId = sanitizeDiscordIdCandidate(account.discordId);
    if (!rosterData || !tag || !importedDiscordId) return false;

    const byTag = ensureImportPlayerMetricsByTag(rosterData);
    const existingEntry = byTag[tag] && typeof byTag[tag] === "object" ? byTag[tag] : {};
    const existingIdentity = existingEntry.identity && typeof existingEntry.identity === "object" ? existingEntry.identity : {};
    const currentDiscordId = sanitizeStoredDiscordIdCandidate(existingIdentity.discordId);
    if (currentDiscordId) return false;

    const nextEntry = existingEntry;
    const nextIdentity = Object.assign({}, existingIdentity);
    let changed = false;

    if (normalizeTag(nextIdentity.tag) !== tag) {
      nextIdentity.tag = tag;
      changed = true;
    }

    const importedName = sanitizeNameCandidate(account.name);
    if (importedName && !normalizeWhitespace(nextIdentity.name)) {
      nextIdentity.name = importedName;
      changed = true;
    }

    nextIdentity.discordId = importedDiscordId;
    changed = true;

    const importedDiscordUsername = sanitizeDiscordCandidate(account.discord);
    const currentDiscordUsername = sanitizeDiscordCandidate(nextIdentity.discordUsername);
    if (importedDiscordUsername && (options.allowDiscordUsernameOverwrite === true || !currentDiscordUsername)) {
      if (importedDiscordUsername !== currentDiscordUsername) {
        nextIdentity.discordUsername = importedDiscordUsername;
        changed = true;
      }
    }

    if (changed) {
      nextIdentity.discordSource = "xlsx-import";
      nextEntry.identity = nextIdentity;
      if (!Array.isArray(nextEntry.trophyHistoryDaily)) nextEntry.trophyHistoryDaily = [];
      if (!nextEntry.donationCycles || typeof nextEntry.donationCycles !== "object") nextEntry.donationCycles = {};
      byTag[tag] = nextEntry;
      rosterData.playerMetrics.updatedAt = new Date().toISOString();
    }
    return changed;
  };

  // Build safe matched updates.
  const buildSafeMatchedUpdates = (existingPlayerRaw, importedAccountRaw, existingIdentityRaw) => {
    const existingPlayer = existingPlayerRaw && typeof existingPlayerRaw === "object" ? existingPlayerRaw : {};
    const imported = importedAccountRaw && typeof importedAccountRaw === "object" ? importedAccountRaw : {};
    const existingIdentity = existingIdentityRaw && typeof existingIdentityRaw === "object" ? existingIdentityRaw : {};

    const updates = {};
    const current = {
      name: normalizeWhitespace(existingPlayer.name),
      discord: normalizeWhitespace(existingPlayer.discord),
      th: parseIntStrict(existingPlayer.th),
      discordId: sanitizeStoredDiscordIdCandidate(existingIdentity.discordId),
    };

    const importedName = sanitizeNameCandidate(imported.name);
    const importedDiscord = sanitizeDiscordCandidate(imported.discord);
    const importedDiscordId = sanitizeDiscordIdCandidate(imported.discordId);
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
    if (importedDiscordId && !current.discordId) {
      updates.discordId = importedDiscordId;
    }

    return updates;
  };

  // Build import comparison.
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
    const matchedMissingDiscord = [];
    const matchedMissingDiscordId = [];
    const matchedDiscordIdConflicts = [];
    let matchedWithoutImportedDiscord = 0;
    let matchedWithoutAnyDiscord = 0;
    let importedDiscordIdCount = 0;
    let matchedWithoutImportedDiscordId = 0;
    let matchedWithoutAnyDiscordId = 0;
    let matchedMissingPlayerMetricsDiscordId = 0;

    for (const accountRaw of accounts) {
      const account = accountRaw && typeof accountRaw === "object" ? accountRaw : {};
      const tag = normalizeTag(account.tag);
      if (!tag) continue;

      const clanKey = normalizeClanKey(account.clanKey || account.clan);
      const clanLabel = normalizeWhitespace(account.clan);
      const importedDiscordId = sanitizeDiscordIdCandidate(account.discordId);
      if (importedDiscordId) importedDiscordIdCount++;

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
        const existingIdentity = readPlayerMetricsIdentityByTag(rosterData, tag);
        const updates = buildSafeMatchedUpdates(existing.player, account, existingIdentity);
        const currentDiscord = sanitizeDiscordCandidate(existing.player && existing.player.discord);
        const importedDiscord = sanitizeDiscordCandidate(account.discord);
        const currentDiscordId = sanitizeStoredDiscordIdCandidate(existingIdentity.discordId);
        const discordIdConflict = !!(importedDiscordId && currentDiscordId && importedDiscordId !== currentDiscordId);
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
            discord: currentDiscord,
            discordId: currentDiscordId,
            th: parseIntStrict(existing.player && existing.player.th),
          },
          imported: {
            name: normalizeWhitespace(account.name),
            discord: importedDiscord,
            discordId: importedDiscordId,
            th: parseIntStrict(account.th),
          },
          updates,
        };
        if (discordIdConflict) entry.discordIdConflict = true;

        if (!importedDiscord) {
          matchedWithoutImportedDiscord++;
          if (!currentDiscord) matchedWithoutAnyDiscord++;
          matchedMissingDiscord.push({
            rowNumber: account.rowNumber,
            tag,
            clan: clanLabel,
            clanKey,
            rosterId: existing.rosterId,
            rosterTitle: existing.rosterTitle,
            currentDiscord,
            reason: currentDiscord ? "missing Discord in import row" : "missing Discord in import row and preview",
          });
        }
        if (!importedDiscordId) {
          matchedWithoutImportedDiscordId++;
          if (!currentDiscordId) matchedWithoutAnyDiscordId++;
          matchedMissingDiscordId.push({
            rowNumber: account.rowNumber,
            tag,
            clan: clanLabel,
            clanKey,
            rosterId: existing.rosterId,
            rosterTitle: existing.rosterTitle,
            currentDiscordId,
            reason: currentDiscordId ? "missing Discord ID in import row" : "missing Discord ID in import row and playerMetrics",
          });
        } else if (!currentDiscordId) {
          matchedMissingPlayerMetricsDiscordId++;
        } else if (discordIdConflict) {
          matchedDiscordIdConflicts.push({
            rowNumber: account.rowNumber,
            tag,
            clan: clanLabel,
            clanKey,
            rosterId: existing.rosterId,
            rosterTitle: existing.rosterTitle,
            currentDiscordId,
            importedDiscordId,
            reason: "import Discord ID differs from playerMetrics",
          });
        }

        if (Object.keys(updates).length) {
          matchedWithUpdates.push(entry);
        } else {
          matchedUnchanged.push(entry);
        }
        continue;
      }

      // The war-out filter is for deciding whether to add a new member from the
      // spreadsheet. Existing roster members should still receive safe profile
      // refreshes such as Discord/name/TH updates.
      if (filters.excludeWarOut && normalizeWarPref(account.warPref) === "out") {
        ignoredWarOut.push({
          rowNumber: account.rowNumber,
          tag,
          clan: clanLabel,
          reason: "war preference is out",
        });
        continue;
      }

      const mappedRosterId = normalizeWhitespace(normalizedMapping[clanKey]);
      if (!mappedRosterId || !rosterMeta.byId[mappedRosterId]) {
        reviewOnly.push({
          rowNumber: account.rowNumber,
          tag,
          name: normalizeWhitespace(account.name),
          discord: normalizeWhitespace(account.discord),
          discordId: importedDiscordId,
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
          discordId: importedDiscordId,
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
        discordId: importedDiscordId,
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
      matchedWithoutImportedDiscord,
      matchedWithoutAnyDiscord,
      importedDiscordIdCount,
      matchedWithoutImportedDiscordId,
      matchedWithoutAnyDiscordId,
      matchedMissingPlayerMetricsDiscordId,
      matchedDiscordIdConflicts: matchedDiscordIdConflicts.length,
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
        matchedMissingDiscord,
        matchedMissingDiscordId,
        matchedDiscordIdConflicts,
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

  // Apply import comparison.
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
    let identityUpdateCount = 0;
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
      if (safeUpdates.discordId != null) {
        const importedIdentity = Object.assign({}, update.imported || {}, {
          tag,
          name: update.imported && update.imported.name != null ? update.imported.name : indexed.player.name,
          discord: update.imported && update.imported.discord != null ? update.imported.discord : indexed.player.discord,
          discordId: safeUpdates.discordId,
        });
        if (upsertImportedDiscordIdentity(nextRosterData, importedIdentity, {
          allowDiscordUsernameOverwrite: safeUpdates.discord != null,
        })) {
          identityUpdateCount++;
        }
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
      if (sanitizeDiscordIdCandidate(addition.discordId)) {
        if (upsertImportedDiscordIdentity(nextRosterData, {
          tag,
          name: player.name,
          discord: player.discord,
          discordId: addition.discordId,
        }, {
          allowDiscordUsernameOverwrite: true,
        })) {
          identityUpdateCount++;
        }
      }
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
        identityUpdateCount,
        skippedUpdateCount: skippedUpdates.length,
        skippedAddCount: skippedAdds.length,
        updated: appliedUpdates,
        added: addedMembers,
        skippedUpdates,
        skippedAdds,
      },
    };
  };

  const normalizeCwlLeaguePreferenceKey = (raw) => normalizeWhitespace(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  const normalizeCwlLeaguePreferenceOptionKey = (raw) => normalizeCwlLeaguePreferenceKey(raw);

  const collectCwlLeaguePreferenceOptionsByKey = (cwlLeagueSignups) => {
    const source = isObj(cwlLeagueSignups) && isObj(cwlLeagueSignups.optionsByKey)
      ? cwlLeagueSignups.optionsByKey
      : (isObj(cwlLeagueSignups) && isObj(cwlLeagueSignups.optionsByLeagueKey) ? cwlLeagueSignups.optionsByLeagueKey : {});
    const out = {};
    const keys = Object.keys(source);
    for (const rawKey of keys) {
      const option = isObj(source[rawKey]) ? source[rawKey] : {};
      const leagueName = normalizeWhitespace(option.leagueName);
      const leagueKey = normalizeCwlLeaguePreferenceKey(option.leagueKey || rawKey || leagueName);
      const optionKey = normalizeCwlLeaguePreferenceOptionKey(option.optionKey || rawKey || leagueKey);
      if (!optionKey || !leagueKey || !leagueName) continue;
      const rosterIds = Array.isArray(option.rosterIds)
        ? option.rosterIds.map((value) => normalizeWhitespace(value)).filter(Boolean)
        : [];
      const targetRosterId = normalizeWhitespace(option.targetRosterId || option.rosterId || rosterIds[0]);
      out[optionKey] = {
        optionKey,
        leagueKey,
        leagueName,
        targetRosterId,
        targetClanTag: normalizeTag(option.targetClanTag || option.clanTag),
        targetClanName: normalizeWhitespace(option.targetClanName || option.clanName),
        rosterIds,
      };
    }
    return out;
  };

  const collectCwlLeaguePreferenceOptionsByLeagueKey = (cwlLeagueSignups) => {
    const source = isObj(cwlLeagueSignups) && isObj(cwlLeagueSignups.optionsByLeagueKey)
      ? cwlLeagueSignups.optionsByLeagueKey
      : {};
    const out = {};
    const keys = Object.keys(source);
    for (const rawKey of keys) {
      const option = isObj(source[rawKey]) ? source[rawKey] : {};
      const leagueName = normalizeWhitespace(option.leagueName);
      const leagueKey = normalizeCwlLeaguePreferenceKey(option.leagueKey || rawKey || leagueName);
      if (!leagueKey || !leagueName) continue;
      const rosterIds = Array.isArray(option.rosterIds)
        ? option.rosterIds.map((value) => normalizeWhitespace(value)).filter(Boolean)
        : [];
      out[leagueKey] = {
        optionKey: normalizeCwlLeaguePreferenceOptionKey(option.optionKey || leagueKey),
        leagueKey,
        leagueName,
        targetRosterId: normalizeWhitespace(option.targetRosterId || option.rosterId || rosterIds[0]),
        targetClanTag: normalizeTag(option.targetClanTag || option.clanTag),
        targetClanName: normalizeWhitespace(option.targetClanName || option.clanName),
        rosterIds,
      };
    }
    return out;
  };

  const collectCwlLeaguePreferences = (cwlLeagueSignups) => {
    const source = isObj(cwlLeagueSignups) && isObj(cwlLeagueSignups.preferencesByTag)
      ? cwlLeagueSignups.preferencesByTag
      : {};
    const out = [];
    const keys = Object.keys(source).sort();
    for (const rawTag of keys) {
      const preference = isObj(source[rawTag]) ? source[rawTag] : {};
      const playerTag = normalizeTag(preference.playerTag || rawTag);
      const leagueName = normalizeWhitespace(preference.leagueName);
      const leagueKey = normalizeCwlLeaguePreferenceKey(preference.leagueKey || leagueName);
      out.push({
        playerTag,
        playerName: normalizeWhitespace(preference.playerName),
        optionKey: normalizeCwlLeaguePreferenceOptionKey(preference.optionKey || preference.optionId || preference.choiceKey),
        leagueKey,
        leagueName,
        targetRosterId: normalizeWhitespace(preference.targetRosterId || preference.rosterId),
        targetClanTag: normalizeTag(preference.targetClanTag || preference.clanTag),
        targetClanName: normalizeWhitespace(preference.targetClanName || preference.clanName),
        discordId: normalizeWhitespace(preference.discordId),
      });
    }
    return out;
  };

  const getCwlPreferenceLockState = (roster, playerTag) => {
    const prep = isObj(roster && roster.cwlPreparation) ? roster.cwlPreparation : {};
    const lockStateByTag = isObj(prep.lockStateByTag) ? prep.lockStateByTag : {};
    const value = normalizeWhitespace(lockStateByTag[playerTag]);
    return value === "lockedIn" || value === "lockedOut" ? value : "";
  };

  const buildCwlPreferencePlanSummary = (plan) => ({
    validMoveCount: plan.moves.length,
    alreadyCorrectCount: plan.alreadyCorrect.length,
    skippedCount: plan.skipped.length,
    conflictCount: plan.conflicts.length,
    missingPlayerCount: plan.missingPlayers.length,
    missingOptionCount: plan.missingOptions.length,
    preferenceCount: plan.preferenceCount,
  });

  const planCwlLeaguePreferenceMoves = (args) => {
    const input = isObj(args) ? args : {};
    const rosterData = isObj(input.rosterData) ? input.rosterData : {};
    const cwlLeagueSignups = isObj(input.cwlLeagueSignups)
      ? input.cwlLeagueSignups
      : (isObj(rosterData.cwlLeagueSignups) ? rosterData.cwlLeagueSignups : {});
    const rosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
    const optionsByKey = collectCwlLeaguePreferenceOptionsByKey(cwlLeagueSignups);
    const optionsByLeagueKey = collectCwlLeaguePreferenceOptionsByLeagueKey(cwlLeagueSignups);
    const preferences = collectCwlLeaguePreferences(cwlLeagueSignups);
    const rosterById = {};
    const playerLocationByTag = {};

    for (let rosterIndex = 0; rosterIndex < rosters.length; rosterIndex++) {
      const roster = isObj(rosters[rosterIndex]) ? rosters[rosterIndex] : {};
      const rosterId = normalizeWhitespace(roster.id);
      if (rosterId && !rosterById[rosterId]) rosterById[rosterId] = { roster, rosterIndex };
      const sections = [
        { role: "main", players: Array.isArray(roster.main) ? roster.main : [] },
        { role: "sub", players: Array.isArray(roster.subs) ? roster.subs : [] },
        { role: "missing", players: Array.isArray(roster.missing) ? roster.missing : [] },
      ];
      for (const section of sections) {
        for (let playerIndex = 0; playerIndex < section.players.length; playerIndex++) {
          const player = isObj(section.players[playerIndex]) ? section.players[playerIndex] : {};
          const playerTag = normalizeTag(player.tag);
          if (!playerTag || playerLocationByTag[playerTag]) continue;
          playerLocationByTag[playerTag] = {
            roster,
            rosterId,
            rosterIndex,
            role: section.role,
            playerIndex,
            player,
          };
        }
      }
    }

    const plan = {
      preferenceCount: preferences.length,
      moves: [],
      alreadyCorrect: [],
      skipped: [],
      conflicts: [],
      missingPlayers: [],
      missingOptions: [],
      summary: null,
    };

    for (const preference of preferences) {
      const playerTag = normalizeTag(preference.playerTag);
      const base = {
        playerTag,
        playerName: normalizeWhitespace(preference.playerName),
        optionKey: normalizeCwlLeaguePreferenceOptionKey(preference.optionKey),
        leagueKey: normalizeCwlLeaguePreferenceKey(preference.leagueKey || preference.leagueName),
        leagueName: normalizeWhitespace(preference.leagueName),
        targetRosterId: normalizeWhitespace(preference.targetRosterId),
        targetClanTag: normalizeTag(preference.targetClanTag),
        targetClanName: normalizeWhitespace(preference.targetClanName),
      };
      if (!playerTag || (!base.optionKey && !base.leagueKey && !base.targetRosterId)) {
        plan.skipped.push(Object.assign({}, base, {
          reason: !playerTag ? "invalid-player-tag" : "missing-league",
        }));
        continue;
      }

      const keyedOption = base.optionKey && optionsByKey[base.optionKey] ? optionsByKey[base.optionKey] : null;
      const leagueOption = !keyedOption && base.leagueKey && optionsByLeagueKey[base.leagueKey]
        ? optionsByLeagueKey[base.leagueKey]
        : null;
      const option = keyedOption || leagueOption;
      if (option && !base.leagueKey) base.leagueKey = option.leagueKey;
      if (option && !base.leagueName) base.leagueName = option.leagueName;
      if (keyedOption && !base.targetRosterId) base.targetRosterId = normalizeWhitespace(option.targetRosterId);
      if (keyedOption && !base.targetClanTag) base.targetClanTag = normalizeTag(option.targetClanTag);
      if (keyedOption && !base.targetClanName) base.targetClanName = normalizeWhitespace(option.targetClanName);

      if (!option && !base.targetRosterId) {
        plan.missingOptions.push(Object.assign({}, base, {
          reason: "missing-option",
        }));
        continue;
      }

      const optionRosterIds = option && Array.isArray(option.rosterIds) ? option.rosterIds : [];
      const rawTargetRosterIds = base.targetRosterId ? [base.targetRosterId] : optionRosterIds;
      const targetRosterIds = rawTargetRosterIds.filter((rosterId) => !!rosterById[rosterId]);
      if (!targetRosterIds.length) {
        plan.missingOptions.push(Object.assign({}, base, {
          reason: "missing-target-roster",
          targetRosterIds: rawTargetRosterIds.slice(),
        }));
        continue;
      }

      const location = playerLocationByTag[playerTag];
      if (!location) {
        plan.missingPlayers.push(Object.assign({}, base, {
          reason: "missing-player",
          targetRosterIds,
        }));
        continue;
      }

      if (targetRosterIds.indexOf(location.rosterId) >= 0) {
        plan.alreadyCorrect.push(Object.assign({}, base, {
          rosterId: location.rosterId,
          targetRosterIds,
        }));
        continue;
      }

      const lockState = getCwlPreferenceLockState(location.roster, playerTag);
      if (lockState) {
        plan.conflicts.push(Object.assign({}, base, {
          reason: "locked-player",
          lockState,
          sourceRosterId: location.rosterId,
          targetRosterIds,
        }));
        continue;
      }

      let targetRosterId = "";
      if (base.targetRosterId && targetRosterIds.indexOf(base.targetRosterId) >= 0) {
        targetRosterId = base.targetRosterId;
      } else {
        for (const roster of rosters) {
          const candidateId = normalizeWhitespace(roster && roster.id);
          if (targetRosterIds.indexOf(candidateId) >= 0) {
            targetRosterId = candidateId;
            break;
          }
        }
      }
      if (!targetRosterId) {
        plan.missingOptions.push(Object.assign({}, base, {
          reason: "missing-target-roster",
          targetRosterIds,
        }));
        continue;
      }

      plan.moves.push(Object.assign({}, base, {
        fromRosterId: location.rosterId,
        fromRole: location.role,
        targetRosterId,
        targetRosterIds,
      }));
    }

    plan.summary = buildCwlPreferencePlanSummary(plan);
    return plan;
  };

  // Normalize the retained CWL prep capacity for one roster.
  const getCwlPrepDistributionCapacity = (rosterRaw) => {
    const roster = isObj(rosterRaw) ? rosterRaw : {};
    const prep = isObj(roster.cwlPreparation) ? roster.cwlPreparation : {};
    const rosterSizeRaw = Number(prep.rosterSize);
    const rosterSize = Number.isFinite(rosterSizeRaw)
      ? Math.max(0, Math.min(50, Math.floor(rosterSizeRaw)))
      : Math.max(0, Math.min(50, Array.isArray(roster.main) ? roster.main.length : 0));
    const clanAbsentTagSet = isObj(prep.clanAbsentTagSet) ? prep.clanAbsentTagSet : {};
    const poolCount = [roster.main, roster.subs].reduce((sum, players) => {
      const list = Array.isArray(players) ? players : [];
      return sum + list.filter((player) => !clanAbsentTagSet[normalizeTag(player && player.tag)]).length;
    }, 0);
    const fallbackSubs = Math.max(0, Math.min(50 - rosterSize, poolCount - rosterSize));
    const substituteCountRaw = Number(prep.substituteCount);
    const substituteCount = Number.isFinite(substituteCountRaw)
      ? Math.max(0, Math.min(50 - rosterSize, Math.floor(substituteCountRaw)))
      : fallbackSubs;
    const distributionMode = normalizeWhitespace(prep.distributionMode).toLowerCase() === "fill" ? "fill" : "subs";
    return {
      distributionMode,
      rosterSize,
      substituteCount,
      capacity: distributionMode === "fill" ? 50 : Math.min(50, rosterSize + substituteCount),
    };
  };

  // Normalize the hard eligibility requirements for one CWL prep roster.
  const getCwlPrepDistributionRequirements = (rosterRaw) => {
    const roster = isObj(rosterRaw) ? rosterRaw : {};
    const prep = isObj(roster.cwlPreparation) ? roster.cwlPreparation : {};
    const requirements = isObj(prep.requirements) ? prep.requirements : {};
    const minTownHallRaw = Number(requirements.minTownHall);
    const hasMaxMissedAttacks = requirements.maxMissedAttacks !== ""
      && requirements.maxMissedAttacks != null
      && Number.isFinite(Number(requirements.maxMissedAttacks));
    const hasMaxMissedAttackRate = requirements.maxMissedAttackRate !== ""
      && requirements.maxMissedAttackRate != null
      && Number.isFinite(Number(requirements.maxMissedAttackRate));
    return {
      minTownHall: Number.isFinite(minTownHallRaw) ? Math.max(0, Math.floor(minTownHallRaw)) : 0,
      maxMissedAttacks: hasMaxMissedAttacks
        ? Math.max(0, Math.floor(Number(requirements.maxMissedAttacks)))
        : null,
      maxMissedAttackRate: hasMaxMissedAttackRate
        ? Math.max(0, Math.min(1, Number(requirements.maxMissedAttackRate)))
        : null,
    };
  };

  // Create a structured preflight failure without mutating the input roster data.
  const createCwlPrepDistributionError = (messageRaw, detailsRaw) => {
    const error = new Error(normalizeWhitespace(messageRaw) || "CWL prep distribution is not feasible.");
    error.code = "CWL_PREP_DISTRIBUTION_INFEASIBLE";
    error.details = isObj(detailsRaw) ? detailsRaw : {};
    return error;
  };

  // Build a lossless, deterministic CWL prep distribution plan. Votes are
  // simulated first, then every active roster enforces hard main/sub capacity
  // and eligibility requirements. Rejected players may only move down through
  // adjacent active rosters; the final roster is never an implicit overflow
  // sink.
  const planCwlPrepRosterDistribution = (args) => {
    const input = isObj(args) ? args : {};
    const rosterData = isObj(input.rosterData) ? input.rosterData : {};
    const rosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
    const strengthByTag = isObj(input.strengthByTag) ? input.strengthByTag : {};
    const rosterOrder = Array.isArray(rosterData.rosterOrder)
      ? rosterData.rosterOrder.map((value) => normalizeWhitespace(value)).filter(Boolean)
      : [];
    const nodesById = {};
    const nodes = [];
    const playerByTag = {};
    const locationByTag = {};
    const roleByTag = {};
    const lockStateByTag = {};
    const reserveTagSet = {};
    let globalOrder = 0;

    for (let rosterIndex = 0; rosterIndex < rosters.length; rosterIndex++) {
      const roster = isObj(rosters[rosterIndex]) ? rosters[rosterIndex] : {};
      const rosterId = normalizeWhitespace(roster.id);
      if (!rosterId) throw new Error("CWL prep distribution requires every roster to have an ID.");
      if (nodesById[rosterId]) throw new Error("CWL prep distribution found duplicate roster ID: " + rosterId);
      const node = { roster, rosterId, rosterIndex, tags: [] };
      nodes.push(node);
      nodesById[rosterId] = node;
      const prep = isObj(roster.cwlPreparation) ? roster.cwlPreparation : {};
      const prepActive = roster.trackingMode !== "regularWar" && prep.enabled === true;
      const clanAbsentTagSet = {};
      const rawClanAbsentTagSet = isObj(prep.clanAbsentTagSet) ? prep.clanAbsentTagSet : {};
      for (const rawTag of Object.keys(rawClanAbsentTagSet)) {
        const absentTag = normalizeTag(rawTag);
        if (absentTag && rawClanAbsentTagSet[rawTag]) clanAbsentTagSet[absentTag] = true;
      }
      const sections = [
        { role: "main", players: roster.main },
        { role: "sub", players: roster.subs },
        { role: "missing", players: roster.missing },
      ];
      for (const section of sections) {
        const players = Array.isArray(section.players) ? section.players : [];
        for (const playerRaw of players) {
          const player = isObj(playerRaw) ? playerRaw : {};
          const playerTag = normalizeTag(player.tag);
          if (!playerTag) throw new Error("CWL prep distribution found a player without a tag in " + rosterId + ".");
          if (locationByTag[playerTag]) throw new Error("CWL prep distribution found duplicate player tag: " + playerTag);
          const reserveReason = section.role === "missing"
            ? "missing-section"
            : (prepActive && clanAbsentTagSet[playerTag] ? "not-in-connected-clan" : "");
          if (reserveReason) reserveTagSet[playerTag] = true;
          else node.tags.push(playerTag);
          playerByTag[playerTag] = {
            player,
            globalOrder: globalOrder++,
            reserveReason,
          };
          locationByTag[playerTag] = node;
          roleByTag[playerTag] = section.role;
          lockStateByTag[playerTag] = getCwlPreferenceLockState(roster, playerTag);
        }
      }
    }

    const orderedNodes = [];
    const orderedSeen = {};
    for (const rosterId of rosterOrder) {
      const node = nodesById[rosterId];
      if (!node || orderedSeen[rosterId]) continue;
      orderedSeen[rosterId] = true;
      orderedNodes.push(node);
    }
    for (const node of nodes) {
      if (orderedSeen[node.rosterId]) continue;
      orderedSeen[node.rosterId] = true;
      orderedNodes.push(node);
    }

    const rawPreferencePlan = planCwlLeaguePreferenceMoves({ rosterData });
    const preferencePlan = {
      preferenceCount: rawPreferencePlan.preferenceCount,
      moves: [],
      alreadyCorrect: [],
      skipped: [],
      conflicts: [],
      missingPlayers: [],
      missingOptions: [],
      summary: null,
    };

    // A signup vote must never silently reactivate a player who is not in a
    // connected clan. Keep the record and vote for later, but do not let it
    // consume capacity or move out of its reserve roster during this build.
    const appendPreferenceResults = (itemsRaw, destinationKey) => {
      const items = Array.isArray(itemsRaw) ? itemsRaw : [];
      for (const itemRaw of items) {
        const item = isObj(itemRaw) ? itemRaw : {};
        const playerTag = normalizeTag(item.playerTag);
        if (playerTag && reserveTagSet[playerTag]) {
          preferencePlan.skipped.push(Object.assign({}, item, {
            reason: "missing-reserve",
            reserveReason: playerByTag[playerTag] && playerByTag[playerTag].reserveReason,
          }));
          continue;
        }
        preferencePlan[destinationKey].push(Object.assign({}, item));
      }
    };
    appendPreferenceResults(rawPreferencePlan.moves, "moves");
    appendPreferenceResults(rawPreferencePlan.alreadyCorrect, "alreadyCorrect");
    appendPreferenceResults(rawPreferencePlan.skipped, "skipped");
    appendPreferenceResults(rawPreferencePlan.conflicts, "conflicts");
    appendPreferenceResults(rawPreferencePlan.missingPlayers, "missingPlayers");
    appendPreferenceResults(rawPreferencePlan.missingOptions, "missingOptions");

    // Locked-Out controls role selection, not roster placement. Convert a vote
    // that the standalone preference planner classified as a lock conflict back
    // into a real vote move for this distribution plan. Locked-In remains an
    // explicit placement override until hard requirements reject it.
    const unresolvedPreferenceConflicts = preferencePlan.conflicts.slice();
    preferencePlan.conflicts = [];
    for (const conflictRaw of unresolvedPreferenceConflicts) {
      const conflict = isObj(conflictRaw) ? conflictRaw : {};
      const playerTag = normalizeTag(conflict.playerTag);
      const location = locationByTag[playerTag];
      const targetRosterIds = Array.isArray(conflict.targetRosterIds) ? conflict.targetRosterIds : [];
      let targetRosterId = normalizeWhitespace(conflict.targetRosterId);
      if (!nodesById[targetRosterId]) {
        targetRosterId = targetRosterIds.map((value) => normalizeWhitespace(value)).find((value) => !!nodesById[value]) || "";
      }
      if (conflict.lockState === "lockedOut" && location && targetRosterId && targetRosterId !== location.rosterId) {
        preferencePlan.moves.push(Object.assign({}, conflict, {
          reason: "vote-move",
          allowLockedOutMove: true,
          fromRosterId: location.rosterId,
          fromRole: roleByTag[playerTag] || "sub",
          targetRosterId,
        }));
      } else {
        preferencePlan.conflicts.push(Object.assign({}, conflict));
      }
    }
    preferencePlan.summary = buildCwlPreferencePlanSummary(preferencePlan);
    const activeNodes = orderedNodes.filter((node) => {
      const prep = isObj(node.roster.cwlPreparation) ? node.roster.cwlPreparation : {};
      return node.roster.trackingMode !== "regularWar" && prep.enabled === true;
    });
    if (activeNodes.length < 2) {
      throw new Error("Enable CWL Preparation Mode on at least two ordered rosters before building rosters.");
    }
    const activeNodeIdSet = {};
    for (const node of activeNodes) activeNodeIdSet[node.rosterId] = true;
    const activeReserveTags = Object.keys(reserveTagSet).filter((playerTag) => {
      const location = locationByTag[playerTag];
      return !!(location && activeNodeIdSet[location.rosterId]);
    });
    const archivedMissingReserveCount = activeReserveTags.filter((playerTag) =>
      playerByTag[playerTag] && playerByTag[playerTag].reserveReason === "missing-section").length;
    const clanAbsentReserveCount = activeReserveTags.length - archivedMissingReserveCount;

    // The standalone preference planner may legitimately target any configured
    // roster. The one-click prep builder cannot: moving a voter outside the
    // active prep chain would bypass every configured capacity and requirement.
    const disabledTargetViolations = [];
    const preferenceTargetResults = preferencePlan.moves || [];
    for (const itemRaw of preferenceTargetResults) {
      const item = isObj(itemRaw) ? itemRaw : {};
      const playerTag = normalizeTag(item.playerTag);
      const targetRosterId = normalizeWhitespace(item.targetRosterId || item.rosterId);
      if (!playerTag || !nodesById[targetRosterId] || activeNodeIdSet[targetRosterId]) continue;
      disabledTargetViolations.push({ playerTag, targetRosterId });
    }
    if (disabledTargetViolations.length) {
      throw createCwlPrepDistributionError(
        "CWL prep distribution cannot use " + disabledTargetViolations.length + " vote" +
          (disabledTargetViolations.length === 1 ? "" : "s") +
          " because the selected roster is not enabled for CWL Preparation Mode. Enable every voted roster or change those votes.",
        {
          reason: "preference-target-prep-disabled",
          violationCount: disabledTargetViolations.length,
          violations: disabledTargetViolations,
          playerTags: disabledTargetViolations.map((item) => item.playerTag).sort(),
        }
      );
    }
    const preferredRosterIdByTag = {};
    const preferenceResults = []
      .concat(preferencePlan.moves || [])
      .concat(preferencePlan.alreadyCorrect || []);
    for (const itemRaw of preferenceResults) {
      const item = isObj(itemRaw) ? itemRaw : {};
      const playerTag = normalizeTag(item.playerTag);
      const targetRosterId = normalizeWhitespace(item.targetRosterId || item.rosterId);
      if (playerTag && nodesById[targetRosterId]) preferredRosterIdByTag[playerTag] = targetRosterId;
    }

    const moveSimulatedTag = (playerTagRaw, targetRosterIdRaw, targetRoleRaw) => {
      const playerTag = normalizeTag(playerTagRaw);
      const targetRosterId = normalizeWhitespace(targetRosterIdRaw);
      const sourceNode = locationByTag[playerTag];
      const targetNode = nodesById[targetRosterId];
      if (!sourceNode || !targetNode) throw new Error("CWL prep distribution simulation could not locate " + playerTag + ".");
      if (reserveTagSet[playerTag]) throw new Error("CWL prep distribution tried to move reserve player " + playerTag + ".");
      if (sourceNode === targetNode) return sourceNode;
      const sourceIndex = sourceNode.tags.indexOf(playerTag);
      if (sourceIndex < 0) throw new Error("CWL prep distribution simulation lost " + playerTag + ".");
      sourceNode.tags.splice(sourceIndex, 1);
      targetNode.tags.push(playerTag);
      locationByTag[playerTag] = targetNode;
      const targetRole = normalizeWhitespace(targetRoleRaw);
      roleByTag[playerTag] = targetRole === "main" || targetRole === "missing" ? targetRole : "sub";
      return sourceNode;
    };

    for (const moveRaw of preferencePlan.moves || []) {
      const move = isObj(moveRaw) ? moveRaw : {};
      const playerTag = normalizeTag(move.playerTag);
      const targetRole = lockStateByTag[playerTag] === "lockedOut"
        ? "sub"
        : (normalizeWhitespace(move.fromRole) === "main" ? "main" : "sub");
      moveSimulatedTag(playerTag, move.targetRosterId, targetRole);
    }

    const activePlayerCount = activeNodes.reduce((sum, node) => sum + node.tags.length, 0);
    const totalConfiguredCapacity = activeNodes.reduce(
      (sum, node) => sum + getCwlPrepDistributionCapacity(node.roster).capacity,
      0
    );
    if (activePlayerCount > totalConfiguredCapacity) {
      const missingSpots = activePlayerCount - totalConfiguredCapacity;
      throw createCwlPrepDistributionError(
        "CWL prep distribution cannot place " + activePlayerCount + " active players in " +
          totalConfiguredCapacity + " configured spots (" + missingSpots + " more " +
          (missingSpots === 1 ? "spot is" : "spots are") +
          " required). Increase substitutes, use Fill, or enable another lower roster.",
        {
          reason: "total-capacity",
          activePlayerCount,
          totalConfiguredCapacity,
          unplacedCount: missingSpots,
        }
      );
    }

    const compareStrength = (leftTag, rightTag) => {
      const leftRaw = isObj(strengthByTag[leftTag]) ? strengthByTag[leftTag] : {};
      const rightRaw = isObj(strengthByTag[rightTag]) ? strengthByTag[rightTag] : {};
      const leftScore = Number.isFinite(Number(leftRaw.strengthScore)) ? Number(leftRaw.strengthScore) : Number.NEGATIVE_INFINITY;
      const rightScore = Number.isFinite(Number(rightRaw.strengthScore)) ? Number(rightRaw.strengthScore) : Number.NEGATIVE_INFINITY;
      if (leftScore !== rightScore) return rightScore - leftScore;
      const leftPlayer = playerByTag[leftTag] && playerByTag[leftTag].player;
      const rightPlayer = playerByTag[rightTag] && playerByTag[rightTag].player;
      const leftTh = Number.isFinite(Number(leftRaw.th)) ? Number(leftRaw.th) : Number(leftPlayer && leftPlayer.th) || 0;
      const rightTh = Number.isFinite(Number(rightRaw.th)) ? Number(rightRaw.th) : Number(rightPlayer && rightPlayer.th) || 0;
      if (leftTh !== rightTh) return rightTh - leftTh;
      const leftOrder = playerByTag[leftTag] ? playerByTag[leftTag].globalOrder : Number.MAX_SAFE_INTEGER;
      const rightOrder = playerByTag[rightTag] ? playerByTag[rightTag].globalOrder : Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return leftTag.localeCompare(rightTag);
    };

    const getPlayerRequirementMetrics = (playerTagRaw) => {
      const playerTag = normalizeTag(playerTagRaw);
      const strength = isObj(strengthByTag[playerTag]) ? strengthByTag[playerTag] : {};
      const player = playerByTag[playerTag] && playerByTag[playerTag].player;
      const thRaw = Number(strength.th);
      const th = Number.isFinite(thRaw) ? Math.max(0, Math.floor(thRaw)) : Math.max(0, Math.floor(Number(player && player.th) || 0));
      const missedAttacksRaw = Number(strength.missedAttacks);
      const missedAttacks = Number.isFinite(missedAttacksRaw) ? Math.max(0, Math.floor(missedAttacksRaw)) : 0;
      const resolvedWarDaysRaw = Number(strength.resolvedWarDays);
      const resolvedWarDays = Number.isFinite(resolvedWarDaysRaw) ? Math.max(0, Math.floor(resolvedWarDaysRaw)) : 0;
      const attackOpportunitiesRaw = Number(strength.attackOpportunities);
      const attackOpportunities = strength.attackOpportunities !== ""
        && strength.attackOpportunities != null
        && Number.isFinite(attackOpportunitiesRaw)
        ? Math.max(0, Math.floor(attackOpportunitiesRaw))
        : resolvedWarDays;
      const explicitRateRaw = Number(strength.missedAttackRate);
      const missedAttackRate = strength.missedAttackRate !== "" && strength.missedAttackRate != null && Number.isFinite(explicitRateRaw)
        ? Math.max(0, Math.min(1, explicitRateRaw))
        : (attackOpportunities > 0
          ? Math.max(0, Math.min(1, missedAttacks / attackOpportunities))
          : (missedAttacks > 0 ? 1 : 0));
      return { th, missedAttacks, attackOpportunities, resolvedWarDays, missedAttackRate };
    };

    const evaluateRequirements = (playerTagRaw, requirements) => {
      const playerTag = normalizeTag(playerTagRaw);
      const metrics = getPlayerRequirementMetrics(playerTag);
      const failures = [];
      if (metrics.th < requirements.minTownHall) {
        failures.push({ key: "minTownHall", actual: metrics.th, required: requirements.minTownHall });
      }
      if (requirements.maxMissedAttacks != null && metrics.missedAttacks > requirements.maxMissedAttacks) {
        failures.push({ key: "maxMissedAttacks", actual: metrics.missedAttacks, required: requirements.maxMissedAttacks });
      }
      if (requirements.maxMissedAttackRate != null && metrics.missedAttackRate > requirements.maxMissedAttackRate) {
        failures.push({ key: "maxMissedAttackRate", actual: metrics.missedAttackRate, required: requirements.maxMissedAttackRate });
      }
      return { eligible: failures.length === 0, failures, metrics };
    };

    const activePlayerTags = [];
    const startActiveIndexByTag = {};
    const distributions = [];
    const requirementsByActiveIndex = [];
    for (let activeIndex = 0; activeIndex < activeNodes.length; activeIndex++) {
      const node = activeNodes[activeIndex];
      distributions.push(getCwlPrepDistributionCapacity(node.roster));
      requirementsByActiveIndex.push(getCwlPrepDistributionRequirements(node.roster));
      for (const playerTag of node.tags) {
        activePlayerTags.push(playerTag);
        startActiveIndexByTag[playerTag] = activeIndex;
      }
    }
    activePlayerTags.sort((leftTag, rightTag) => {
      const leftOrder = playerByTag[leftTag] ? playerByTag[leftTag].globalOrder : Number.MAX_SAFE_INTEGER;
      const rightOrder = playerByTag[rightTag] ? playerByTag[rightTag].globalOrder : Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return leftTag.localeCompare(rightTag);
    });

    const eligibilityByTagAndActiveIndex = {};
    for (const playerTag of activePlayerTags) {
      const byActiveIndex = [];
      const startIndex = startActiveIndexByTag[playerTag];
      for (let activeIndex = 0; activeIndex < activeNodes.length; activeIndex++) {
        byActiveIndex.push(activeIndex < startIndex
          ? { eligible: false, failures: [], metrics: getPlayerRequirementMetrics(playerTag), upwardBlocked: true }
          : evaluateRequirements(playerTag, requirementsByActiveIndex[activeIndex]));
      }
      eligibilityByTagAndActiveIndex[playerTag] = byActiveIndex;
    }

    const finalActiveIndex = activeNodes.length - 1;
    const finalEligibleLockedInTags = activePlayerTags.filter((playerTag) =>
      startActiveIndexByTag[playerTag] === finalActiveIndex
      && lockStateByTag[playerTag] === "lockedIn"
      && eligibilityByTagAndActiveIndex[playerTag][finalActiveIndex].eligible
    );
    if (finalEligibleLockedInTags.length > distributions[finalActiveIndex].rosterSize) {
      throw createCwlPrepDistributionError(
        "CWL prep distribution cannot honor " + finalEligibleLockedInTags.length + " eligible Locked-In players in " +
          activeNodes[finalActiveIndex].rosterId + " because it has only " + distributions[finalActiveIndex].rosterSize + " main slots.",
        {
          reason: "locked-in-main-capacity",
          rosterId: activeNodes[finalActiveIndex].rosterId,
          lockedInCount: finalEligibleLockedInTags.length,
          mainCapacity: distributions[finalActiveIndex].rosterSize,
          playerTags: finalEligibleLockedInTags.slice().sort(),
        }
      );
    }

    // Lexicographic vector costs avoid unsafe giant numeric weights while
    // preserving Locked-In, vote, strength, downward-distance, main-role
    // preference, and stable-order priorities in one assignment solve.
    const FLOW_COST_LENGTH = 6;
    const zeroFlowCost = () => Array(FLOW_COST_LENGTH).fill(0);
    const addFlowCost = (left, right) => left.map((value, index) => value + right[index]);
    const negateFlowCost = (value) => value.map((item) => -item);
    const compareFlowCost = (left, right) => {
      for (let i = 0; i < FLOW_COST_LENGTH; i++) {
        if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
      }
      return 0;
    };

    const strengthOrder = activePlayerTags.slice().sort(compareStrength);
    const strengthImportanceByTag = {};
    for (let i = 0; i < strengthOrder.length; i++) {
      strengthImportanceByTag[strengthOrder[i]] = strengthOrder.length - i;
    }

    let solverRunCount = 0;
    const solveAssignment = () => {
      solverRunCount++;
      const playerCount = activePlayerTags.length;
      const sourceNodeIndex = 0;
      const playerNodeBase = 1;
      const roleNodeBase = playerNodeBase + playerCount;
      const sinkNodeIndex = roleNodeBase + (activeNodes.length * 2);
      const graph = Array.from({ length: sinkNodeIndex + 1 }, () => []);
      const assignmentEdges = [];

      const addFlowEdge = (from, to, capacity, cost, metadata) => {
        const forward = { to, reverseIndex: graph[to].length, capacity, initialCapacity: capacity, cost, metadata: metadata || null };
        const reverse = { to: from, reverseIndex: graph[from].length, capacity: 0, initialCapacity: 0, cost: negateFlowCost(cost), metadata: null };
        graph[from].push(forward);
        graph[to].push(reverse);
        return forward;
      };

      for (let playerIndex = 0; playerIndex < playerCount; playerIndex++) {
        const playerTag = activePlayerTags[playerIndex];
        addFlowEdge(sourceNodeIndex, playerNodeBase + playerIndex, 1, zeroFlowCost(), null);
        const startIndex = startActiveIndexByTag[playerTag];
        const lockState = lockStateByTag[playerTag];
        const strengthImportance = strengthImportanceByTag[playerTag] || 1;
        const stableOrder = playerByTag[playerTag] ? playerByTag[playerTag].globalOrder + 1 : playerIndex + 1;
        const isVoter = !!preferredRosterIdByTag[playerTag];
        for (let targetIndex = startIndex; targetIndex < activeNodes.length; targetIndex++) {
          if (!eligibilityByTagAndActiveIndex[playerTag][targetIndex].eligible) continue;
          const distribution = distributions[targetIndex];
          const roleOptions = lockState === "lockedIn"
            ? ["main"]
            : (lockState === "lockedOut" ? ["sub"] : ["main", "sub"]);
          for (const role of roleOptions) {
            const roleCapacity = role === "main"
              ? distribution.rosterSize
              : Math.max(0, distribution.capacity - distribution.rosterSize);
            if (roleCapacity <= 0) continue;
            const distance = targetIndex - startIndex;
            const cost = [
              lockState === "lockedIn" ? distance : 0,
              isVoter ? distance : 0,
              strengthImportance * targetIndex,
              distance,
              role === "sub" ? strengthImportance : 0,
              stableOrder * ((targetIndex * 2) + (role === "sub" ? 2 : 1)),
            ];
            const edge = addFlowEdge(
              playerNodeBase + playerIndex,
              roleNodeBase + (targetIndex * 2) + (role === "sub" ? 1 : 0),
              1,
              cost,
              { playerTag, targetIndex, role }
            );
            assignmentEdges.push(edge);
          }
        }
      }

      for (let activeIndex = 0; activeIndex < activeNodes.length; activeIndex++) {
        const distribution = distributions[activeIndex];
        const mainCapacity = distribution.rosterSize;
        const subCapacity = Math.max(0, distribution.capacity - distribution.rosterSize);
        addFlowEdge(roleNodeBase + (activeIndex * 2), sinkNodeIndex, mainCapacity, zeroFlowCost(), null);
        addFlowEdge(roleNodeBase + (activeIndex * 2) + 1, sinkNodeIndex, subCapacity, zeroFlowCost(), null);
      }

      let flow = 0;
      let totalCost = zeroFlowCost();
      while (flow < playerCount) {
        const distances = Array(graph.length).fill(null);
        const previousNode = Array(graph.length).fill(-1);
        const previousEdgeIndex = Array(graph.length).fill(-1);
        const inQueue = Array(graph.length).fill(false);
        const queue = [sourceNodeIndex];
        let queueIndex = 0;
        distances[sourceNodeIndex] = zeroFlowCost();
        inQueue[sourceNodeIndex] = true;
        while (queueIndex < queue.length) {
          const from = queue[queueIndex++];
          inQueue[from] = false;
          for (let edgeIndex = 0; edgeIndex < graph[from].length; edgeIndex++) {
            const edge = graph[from][edgeIndex];
            if (edge.capacity <= 0) continue;
            const nextDistance = addFlowCost(distances[from], edge.cost);
            if (distances[edge.to] && compareFlowCost(nextDistance, distances[edge.to]) >= 0) continue;
            distances[edge.to] = nextDistance;
            previousNode[edge.to] = from;
            previousEdgeIndex[edge.to] = edgeIndex;
            if (!inQueue[edge.to]) {
              queue.push(edge.to);
              inQueue[edge.to] = true;
            }
          }
        }
        if (!distances[sinkNodeIndex]) break;
        let cursor = sinkNodeIndex;
        while (cursor !== sourceNodeIndex) {
          const from = previousNode[cursor];
          const edge = graph[from][previousEdgeIndex[cursor]];
          edge.capacity--;
          graph[cursor][edge.reverseIndex].capacity++;
          cursor = from;
        }
        flow++;
        totalCost = addFlowCost(totalCost, distances[sinkNodeIndex]);
      }

      const assignmentByTag = {};
      for (const edge of assignmentEdges) {
        if (edge.initialCapacity === 1 && edge.capacity === 0 && edge.metadata) {
          assignmentByTag[edge.metadata.playerTag] = {
            targetIndex: edge.metadata.targetIndex,
            role: edge.metadata.role,
          };
        }
      }
      const unmatchedTags = activePlayerTags.filter((playerTag) => !assignmentByTag[playerTag]);
      return {
        flow,
        assignmentByTag,
        unmatchedTags,
        objective: totalCost,
      };
    };

    const assignmentSolution = solveAssignment();

    if (assignmentSolution.flow !== activePlayerTags.length) {
      const unmatchedTags = assignmentSolution.unmatchedTags.length
        ? assignmentSolution.unmatchedTags.slice().sort(compareStrength)
        : activePlayerTags.slice().sort(compareStrength);
      const noDestinationTagSet = {};
      for (const playerTag of unmatchedTags) {
        const startIndex = startActiveIndexByTag[playerTag];
        const lockState = lockStateByTag[playerTag];
        let hasDestination = false;
        for (let targetIndex = startIndex; targetIndex < activeNodes.length && !hasDestination; targetIndex++) {
          if (!eligibilityByTagAndActiveIndex[playerTag][targetIndex].eligible) continue;
          const distribution = distributions[targetIndex];
          if (lockState === "lockedIn") hasDestination = distribution.rosterSize > 0;
          else if (lockState === "lockedOut") hasDestination = distribution.capacity > distribution.rosterSize;
          else hasDestination = distribution.capacity > 0;
        }
        if (!hasDestination) noDestinationTagSet[playerTag] = true;
      }
      const requirementsRejectedTags = unmatchedTags.filter((playerTag) => {
        if (!noDestinationTagSet[playerTag]) return false;
        const startIndex = startActiveIndexByTag[playerTag];
        for (let targetIndex = startIndex; targetIndex < activeNodes.length; targetIndex++) {
          if (eligibilityByTagAndActiveIndex[playerTag][targetIndex].eligible) return false;
        }
        return true;
      });
      const capacityRejectedTags = unmatchedTags.filter((playerTag) => requirementsRejectedTags.indexOf(playerTag) < 0);
      const lockedOutRoleCount = unmatchedTags.filter((playerTag) => lockStateByTag[playerTag] === "lockedOut").length;
      const requirementFailureCounts = { minTownHall: 0, maxMissedAttacks: 0, maxMissedAttackRate: 0 };
      for (const playerTag of requirementsRejectedTags) {
        const failures = eligibilityByTagAndActiveIndex[playerTag][finalActiveIndex].failures || [];
        for (const failure of failures) {
          if (Object.prototype.hasOwnProperty.call(requirementFailureCounts, failure.key)) requirementFailureCounts[failure.key]++;
        }
      }
      const reasonParts = [];
      if (requirementsRejectedTags.length) reasonParts.push(requirementsRejectedTags.length + " fail requirements");
      if (capacityRejectedTags.length) reasonParts.push(capacityRejectedTags.length +
        (capacityRejectedTags.length === 1 ? " player exceeds" : " players exceed") + " usable capacity");
      if (lockedOutRoleCount) reasonParts.push(lockedOutRoleCount + " Locked-Out " +
        (lockedOutRoleCount === 1 ? "player has" : "players have") + " no available sub slot");
      throw createCwlPrepDistributionError(
        "CWL prep distribution cannot produce a lossless downward assignment through the final roster " +
          activeNodes[finalActiveIndex].rosterId + ": " + (reasonParts.join("; ") || "no complete role assignment exists") +
          ". Increase substitutes, use Fill, loosen requirements, or enable another lower roster.",
        {
          reason: "final-roster-unplaced",
          rosterId: activeNodes[finalActiveIndex].rosterId,
          unplacedCount: unmatchedTags.length,
          requirementsRejectedCount: requirementsRejectedTags.length,
          capacityRejectedCount: capacityRejectedTags.length,
          lockedOutRoleCount,
          requirementFailureCounts,
          playerTags: unmatchedTags,
        }
      );
    }

    const assignmentByTag = assignmentSolution.assignmentByTag;
    const cascadeMoves = [];
    for (const playerTag of activePlayerTags) {
      const assignment = assignmentByTag[playerTag];
      const startIndex = startActiveIndexByTag[playerTag];
      for (let sourceIndex = startIndex; sourceIndex < assignment.targetIndex; sourceIndex++) {
        const sourceNode = activeNodes[sourceIndex];
        const targetNode = activeNodes[sourceIndex + 1];
        const eligibility = eligibilityByTagAndActiveIndex[playerTag][sourceIndex];
        const reason = eligibility.eligible ? "capacity" : "requirements";
        cascadeMoves.push({
          playerTag,
          playerName: normalizeWhitespace(playerByTag[playerTag] && playerByTag[playerTag].player && playerByTag[playerTag].player.name),
          fromRosterId: sourceNode.rosterId,
          targetRosterId: targetNode.rosterId,
          reason,
          capacityReason: reason === "capacity"
            ? (lockStateByTag[playerTag] === "lockedIn"
              ? "locked-in-main"
              : (lockStateByTag[playerTag] === "lockedOut" ? "locked-out-sub" : "total"))
            : "",
          requirementFailures: Array.isArray(eligibility.failures) ? eligibility.failures.slice() : [],
          requirements: requirementsByActiveIndex[sourceIndex],
          capacity: distributions[sourceIndex].capacity,
          distributionMode: distributions[sourceIndex].distributionMode,
        });
      }
    }

    const rosterResults = [];
    for (let activeIndex = 0; activeIndex < activeNodes.length; activeIndex++) {
      const node = activeNodes[activeIndex];
      const distribution = distributions[activeIndex];
      const expectedMainCount = activePlayerTags.filter((playerTag) =>
        assignmentByTag[playerTag].targetIndex === activeIndex && assignmentByTag[playerTag].role === "main").length;
      const expectedSubCount = activePlayerTags.filter((playerTag) =>
        assignmentByTag[playerTag].targetIndex === activeIndex && assignmentByTag[playerTag].role === "sub").length;
      const movesFromRoster = cascadeMoves.filter((move) => move.fromRosterId === node.rosterId);
      const reserveCount = activeReserveTags.filter((playerTag) => locationByTag[playerTag] === node).length;
      const requirementMoves = movesFromRoster.filter((move) => move.reason === "requirements");
      const requirementFailureCounts = { minTownHall: 0, maxMissedAttacks: 0, maxMissedAttackRate: 0 };
      for (const move of requirementMoves) {
        for (const failure of move.requirementFailures || []) {
          if (Object.prototype.hasOwnProperty.call(requirementFailureCounts, failure.key)) requirementFailureCounts[failure.key]++;
        }
      }
      rosterResults.push({
        rosterId: node.rosterId,
        nextRosterId: activeNodes[activeIndex + 1] ? activeNodes[activeIndex + 1].rosterId : "",
        distributionMode: distribution.distributionMode,
        rosterSize: distribution.rosterSize,
        substituteCount: distribution.substituteCount,
        capacity: distribution.capacity,
        requirements: requirementsByActiveIndex[activeIndex],
        beforeCount: node.tags.length,
        beforeTotalCount: node.tags.length + reserveCount,
        afterCount: expectedMainCount + expectedSubCount,
        reserveCount,
        expectedMainCount,
        expectedSubCount,
        targetMainCount: distribution.rosterSize,
        targetSubCount: Math.max(0, distribution.capacity - distribution.rosterSize),
        movedDownCount: movesFromRoster.length,
        requirementsMovedDownCount: requirementMoves.length,
        capacityMovedDownCount: movesFromRoster.length - requirementMoves.length,
        requirementFailureCounts,
        targetMet: expectedMainCount === distribution.rosterSize &&
          expectedSubCount === Math.max(0, distribution.capacity - distribution.rosterSize),
        terminalOverflowCount: 0,
      });
    }

    const finalRosterIdByTag = {};
    const finalRoleByTag = {};
    const finalTags = [];
    for (const playerTag of Object.keys(playerByTag)) {
      const assignment = assignmentByTag[playerTag];
      if (assignment) {
        finalRosterIdByTag[playerTag] = activeNodes[assignment.targetIndex].rosterId;
        finalRoleByTag[playerTag] = assignment.role;
      } else {
        const node = locationByTag[playerTag];
        if (!node) throw new Error("CWL prep distribution lost " + playerTag + ".");
        finalRosterIdByTag[playerTag] = node.rosterId;
        finalRoleByTag[playerTag] = reserveTagSet[playerTag] ? "missing" : (roleByTag[playerTag] || "sub");
      }
      finalTags.push(playerTag);
    }
    const initialTags = Object.keys(playerByTag).sort();
    finalTags.sort();
    if (initialTags.length !== finalTags.length || initialTags.some((tag, index) => tag !== finalTags[index])) {
      throw new Error("CWL prep distribution failed its player-conservation check.");
    }
    const shiftedTagSet = {};
    for (const move of cascadeMoves) shiftedTagSet[move.playerTag] = true;
    const capacityMoveCount = cascadeMoves.filter((move) => move.reason === "capacity").length;
    const requirementsMoveCount = cascadeMoves.filter((move) => move.reason === "requirements").length;
    const targetMetCount = rosterResults.filter((result) => result.targetMet).length;

    return {
      preferencePlan,
      cascadeMoves,
      rosterResults,
      finalRosterIdByTag,
      finalRoleByTag,
      reservePlayerTags: activeReserveTags.slice().sort(),
      summary: {
        playerCount: initialTags.length,
        preferenceMoveCount: preferencePlan.moves.length,
        cascadeMoveCount: cascadeMoves.length,
        capacityMoveCount,
        requirementsMoveCount,
        shiftedPlayerCount: Object.keys(shiftedTagSet).length,
        activeRosterCount: activeNodes.length,
        solverRunCount,
        targetMetCount,
        allTargetsMet: targetMetCount === rosterResults.length,
        totalConfiguredCapacity,
        activePlayerCount,
        reservePlayerCount: activeReserveTags.length,
        archivedMissingReserveCount,
        clanAbsentReserveCount,
        conserved: true,
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
    planCwlLeaguePreferenceMoves,
    planCwlPrepRosterDistribution,
    _internal: {
      sanitizeNameCandidate,
      sanitizeDiscordCandidate,
      sanitizeDiscordIdCandidate,
      normalizeLookupKey,
      buildSafeMatchedUpdates,
      normalizeCwlLeaguePreferenceKey,
      normalizeCwlLeaguePreferenceOptionKey,
      collectCwlLeaguePreferenceOptionsByKey,
      collectCwlLeaguePreferenceOptionsByLeagueKey,
      collectCwlLeaguePreferences,
    },
  };

  const root = (typeof window !== "undefined") ? window : (typeof globalThis !== "undefined" ? globalThis : global);
  root.RosterGenerator = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
