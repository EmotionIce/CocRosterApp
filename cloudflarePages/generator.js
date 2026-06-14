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

  const collectCwlLeaguePreferenceOptionsByKey = (cwlLeagueSignups) => {
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
        leagueKey,
        leagueName,
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
        leagueKey,
        leagueName,
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
        leagueKey: normalizeCwlLeaguePreferenceKey(preference.leagueKey || preference.leagueName),
        leagueName: normalizeWhitespace(preference.leagueName),
      };
      if (!playerTag || !base.leagueKey) {
        plan.skipped.push(Object.assign({}, base, {
          reason: !playerTag ? "invalid-player-tag" : "missing-league",
        }));
        continue;
      }

      const option = optionsByKey[base.leagueKey];
      if (!option) {
        plan.missingOptions.push(Object.assign({}, base, {
          reason: "missing-option",
        }));
        continue;
      }

      const targetRosterIds = option.rosterIds.filter((rosterId) => !!rosterById[rosterId]);
      if (!targetRosterIds.length) {
        plan.missingOptions.push(Object.assign({}, base, {
          reason: "missing-target-roster",
          targetRosterIds: option.rosterIds.slice(),
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
      for (const roster of rosters) {
        const candidateId = normalizeWhitespace(roster && roster.id);
        if (targetRosterIds.indexOf(candidateId) >= 0) {
          targetRosterId = candidateId;
          break;
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
    _internal: {
      sanitizeNameCandidate,
      sanitizeDiscordCandidate,
      sanitizeDiscordIdCandidate,
      normalizeLookupKey,
      buildSafeMatchedUpdates,
      normalizeCwlLeaguePreferenceKey,
      collectCwlLeaguePreferenceOptionsByKey,
      collectCwlLeaguePreferences,
    },
  };

  const root = (typeof window !== "undefined") ? window : (typeof globalThis !== "undefined" ? globalThis : global);
  root.RosterGenerator = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
