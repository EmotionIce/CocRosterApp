(() => {
  const toStr = (v) => (v == null ? "" : String(v));
  const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);

  const pick = (row, names) => {
    for (const n of names) {
      if (row && Object.prototype.hasOwnProperty.call(row, n)) return row[n];
    }
    // Case-insensitive fallback
    if (row && typeof row === "object") {
      const keys = Object.keys(row);
      for (const n of names) {
        const lower = String(n).toLowerCase();
        const k = keys.find((kk) => String(kk).toLowerCase() === lower);
        if (k != null) return row[k];
      }
    }
    return undefined;
  };

  const normalizeTag = (tag) => {
    const t = toStr(tag).trim().toUpperCase();
    if (!t) return "";
    return t.startsWith("#") ? t : ("#" + t);
  };

  const parseIntStrict = (v) => {
    if (typeof v === "number" && isFinite(v)) return Math.floor(v);
    const s = toStr(v).trim();
    if (!s) return null;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  };

  const parsePercent = (v) => {
    if (typeof v === "number" && isFinite(v)) return clamp(v, 0, 100);
    const s = toStr(v).trim().replace("%", "");
    if (!s) return 0;
    const n = parseFloat(s);
    if (!Number.isFinite(n)) return 0;
    return clamp(n, 0, 100);
  };

  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  const normalizeWarPref = (v) => {
    const s = toStr(v).trim().toLowerCase();
    if (!s) return "unknown";
    if (s === "in" || s === "yes" || s === "true") return "in";
    if (s === "out" || s === "no" || s === "false") return "out";
    return "unknown";
  };

  const normalizeAccountsFromXlsxRows = (rows) => {
    if (!Array.isArray(rows)) throw new Error("XLSX rows must be an array.");

    const out = [];
    const seen = {};
    for (const row of rows) {
      const nameRaw = pick(row, ["NAME", "Name"]);
      const tagRaw = pick(row, ["TAG", "Tag", "Player Tag"]);
      const thRaw = pick(row, ["Town-Hall", "Town Hall", "TownHall", "TH", "Townhall"]);
      const rushedRaw = pick(row, ["Rushed %", "Rushed%", "Rushed", "Rush %", "Rush%"]);
      const clanRaw = pick(row, ["CLAN", "Clan"]);
      const warPrefRaw = pick(row, ["War Preference", "WarPref", "War preference"]);
      const discordRaw = pick(row, ["Username", "Discord", "DISCORD", "Discord/Username", "Discord Username"]);

      const tag = normalizeTag(tagRaw);
      if (!tag) continue; // ignore empty lines

      if (seen[tag]) throw new Error("Duplicate TAG in XLSX input: " + tag);
      seen[tag] = true;

      const th = parseIntStrict(thRaw);
      if (th == null) throw new Error("Invalid Town Hall for " + tag + ": " + toStr(thRaw));

      const rushed = parsePercent(rushedRaw);
      const name = toStr(nameRaw).trim() || "(no name)";
      const clan = toStr(clanRaw).trim();
      const discord = toStr(discordRaw).trim();
      const warPref = normalizeWarPref(warPrefRaw);

      out.push({ tag, name, discord, th, rushed, clan, warPref });
    }

    return out;
  };

  const DIFF_MULT = { competitive: 1.15, standard: 1.0, relaxed: 0.85 };
  const DIFF_RANK = { competitive: 3, standard: 2, relaxed: 1 };

  const rushPenalty = (rushed) => {
    const r = Number(rushed);
    if (!Number.isFinite(r)) return 0.0;
    if (r < 20) return 0.0;
    if (r < 35) return 1.0;
    if (r < 50) return 2.0;
    if (r < 70) return 2.5;
    if (r < 80) return 3.5;
    return 6.0;
  };

  const computeEffectiveTh = (th, rushed, difficulty) => {
    const mult = DIFF_MULT[difficulty] != null ? DIFF_MULT[difficulty] : 1.0;
    return Number(th) - (rushPenalty(rushed) * mult);
  };

  const validateRosterSpecs = (rosterSpecs) => {
    if (!Array.isArray(rosterSpecs) || rosterSpecs.length === 0) {
      throw new Error("Roster specs are missing. Add at least one roster.");
    }
    const seen = {};
    for (const s of rosterSpecs) {
      if (!isObj(s)) throw new Error("Invalid roster spec: expected an object.");
      const id = toStr(s.id).trim();
      const title = toStr(s.title).trim();
      const mainCount = parseIntStrict(s.mainCount);
      const subCount = parseIntStrict(s.subCount);
      const difficulty = toStr(s.difficulty).trim().toLowerCase();

      if (!id) throw new Error("Roster spec is missing an id.");
      if (seen[id]) throw new Error("Duplicate roster id: " + id);
      seen[id] = true;

      if (!title) throw new Error("Roster spec '" + id + "' is missing a title.");
      if (mainCount == null || mainCount < 0) throw new Error("Roster spec '" + id + "': invalid main count.");
      if (subCount == null || subCount < 0) throw new Error("Roster spec '" + id + "': invalid subs count.");
      if (!DIFF_MULT[difficulty]) throw new Error("Roster spec '" + id + "': difficulty must be competitive, standard, or relaxed.");
    }
  };

  const normalizeFilters = (filters) => {
    const f = isObj(filters) ? filters : {};
    const allowed = Array.isArray(f.allowedClans) ? f.allowedClans.map((x) => toStr(x).trim()).filter(Boolean) : null;
    return {
      excludeWarOut: !!f.excludeWarOut,
      allowedClans: allowed && allowed.length ? allowed : null,
      requireDiscord: !!f.requireDiscord,
    };
  };

  const normalizeOverrides = (overrides) => {
    const o = isObj(overrides) ? overrides : {};
    const excluded = Array.isArray(o.excluded) ? o.excluded.map(normalizeTag).filter(Boolean) : [];
    const pinnedRaw = isObj(o.pinned) ? o.pinned : {};
    const pinned = {};
    for (const k of Object.keys(pinnedRaw)) {
      const tag = normalizeTag(k);
      const v = pinnedRaw[k];
      if (!tag || !isObj(v)) continue;
      const rosterId = toStr(v.rosterId).trim();
      const role = toStr(v.role).trim().toLowerCase();
      const slot = v.slot == null ? null : parseIntStrict(v.slot);
      if (!rosterId) continue;
      if (role !== "main" && role !== "sub") continue;
      pinned[tag] = { rosterId, role, slot: slot == null ? null : slot };
    }
    return { excluded, pinned };
  };

  const applyFilters = (accounts, filters, report) => {
    const f = normalizeFilters(filters);
    const res = [];
    for (const a of accounts) {
      if (f.allowedClans && f.allowedClans.length) {
        const ok = f.allowedClans.some((c) => c.toLowerCase() === toStr(a.clan).toLowerCase());
        if (!ok) {
          report.excluded.push({ tag: a.tag, reason: "clan is not allowed" });
          continue;
        }
      }
      if (f.requireDiscord && !toStr(a.discord).trim()) {
        report.excluded.push({ tag: a.tag, reason: "missing Discord name" });
        continue;
      }
      res.push(a);
    }
    return res;
  };

  const sortByRank = (accounts, difficulty) => {
    const diff = toStr(difficulty).toLowerCase() || "standard";
    return [...accounts].sort((a, b) => {
      const ea = computeEffectiveTh(a.th, a.rushed, diff);
      const eb = computeEffectiveTh(b.th, b.rushed, diff);

      if (eb !== ea) return eb - ea;
      if (b.th !== a.th) return b.th - a.th;
      if (a.rushed !== b.rushed) return a.rushed - b.rushed;

      const ta = toStr(a.tag);
      const tb = toStr(b.tag);
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
  };

  const takeBestCandidate = (pool, allowExtreme) => {
    if (pool.length === 0) return null;

    if (allowExtreme) return pool.shift();

    // Skip rushed >= 80 if possible
    for (let i = 0; i < pool.length; i++) {
      if (Number(pool[i].rushed) < 80) {
        return pool.splice(i, 1)[0];
      }
    }
    // no non-extreme candidates left
    return pool.shift();
  };

  const validateOutput = (rosterData) => {
    if (!rosterData || typeof rosterData !== "object") throw new Error("Generator output is invalid.");
    if (!Array.isArray(rosterData.rosters)) throw new Error("Generator output is missing rosters array.");

    const seen = {};
    for (const r of rosterData.rosters) {
      const main = Array.isArray(r.main) ? r.main : [];
      const subs = Array.isArray(r.subs) ? r.subs : [];
      for (const p of [...main, ...subs]) {
        const tag = toStr(p.tag);
        if (!tag) throw new Error("Output has a player with an empty tag.");
        if (seen[tag]) throw new Error("Output contains a duplicate tag: " + tag);
        seen[tag] = true;
      }
      if (!r.badges || r.badges.main !== main.length || r.badges.subs !== subs.length) {
        throw new Error("Badges mismatch in roster '" + toStr(r.id) + "'.");
      }
    }
  };

  const allocate = ({ rosterSpecs, candidates, overrides, report }) => {
    const specs = rosterSpecs
      .map((s, idx) => ({ ...s, __idx: idx }))
      .sort((a, b) => (DIFF_RANK[toStr(b.difficulty).toLowerCase()] - DIFF_RANK[toStr(a.difficulty).toLowerCase()]) || (a.__idx - b.__idx))
      .map((s) => {
        const c = { ...s };
        delete c.__idx;
        c.difficulty = toStr(c.difficulty).toLowerCase();
        c.mainCount = parseIntStrict(c.mainCount) || 0;
        c.subCount = parseIntStrict(c.subCount) || 0;
        return c;
      });

    const minRank = Math.min(...specs.map((s) => DIFF_RANK[s.difficulty]));
    const isLowestTier = (spec) => DIFF_RANK[spec.difficulty] === minRank;

    const accByTag = {};
    for (const a of candidates) accByTag[a.tag] = a;

    const excludedSet = {};
    for (const t of overrides.excluded || []) excludedSet[t] = true;

    const poolBase = candidates.filter((a) => !excludedSet[a.tag]);
    for (const t of overrides.excluded || []) report.excluded.push({ tag: t, reason: "overrides.excluded" });

    const rosters = [];
    let globalPool = poolBase;

    // Base allocation
    for (const spec of specs) {
      const pool = sortByRank(globalPool, spec.difficulty);
      const mainSlots = new Array(spec.mainCount).fill(null);
      const subs = [];

      const allowExtremeHere = isLowestTier(spec);

      for (let slot = 1; slot <= mainSlots.length; slot++) {
        const cand = takeBestCandidate(pool, allowExtremeHere);
        if (!cand) break;
        mainSlots[slot - 1] = { slot, name: cand.name, discord: cand.discord, th: cand.th, tag: cand.tag };
      }

      for (let k = 0; k < spec.subCount; k++) {
        const cand = takeBestCandidate(pool, allowExtremeHere);
        if (!cand) break;
        subs.push({ slot: null, name: cand.name, discord: cand.discord, th: cand.th, tag: cand.tag });
      }

      const usedTags = {};
      for (const m of mainSlots) if (m) usedTags[m.tag] = true;
      for (const s of subs) usedTags[s.tag] = true;

      globalPool = globalPool.filter((a) => !usedTags[a.tag]);

      rosters.push({
        id: toStr(spec.id).trim(),
        title: toStr(spec.title).trim(),
        badges: { main: mainSlots.filter(Boolean).length, subs: subs.length },
        main: mainSlots.filter(Boolean),
        subs,
        __spec: spec,
        __mainSlots: mainSlots,
      });
    }

    // Pinned overrides
    const pinned = overrides.pinned || {};
    for (const tag of Object.keys(pinned)) {
      const pin = pinned[tag];
      const acc = accByTag[tag];

      if (!acc) {
        report.warnings.push("Pinned tag not found in input: " + tag);
        continue;
      }
      if (excludedSet[tag]) {
        report.warnings.push("Pinned tag is excluded via overrides.excluded: " + tag);
        continue;
      }

      // Remove from any roster
      for (const r of rosters) {
        for (let i = 0; i < r.__mainSlots.length; i++) {
          if (r.__mainSlots[i] && r.__mainSlots[i].tag === tag) r.__mainSlots[i] = null;
        }
        r.subs = r.subs.filter((p) => p.tag !== tag);
      }
      globalPool = globalPool.filter((a) => a.tag !== tag);

      const target = rosters.find((r) => r.id === pin.rosterId);
      if (!target) {
        report.warnings.push("Pinned tag has unknown rosterId: " + tag + " -> " + pin.rosterId);
        globalPool.push(acc);
        continue;
      }

      if (pin.role === "main") {
        const slotCount = target.__mainSlots.length;
        if (slotCount === 0) {
          report.warnings.push("Pinned main ignored (mainCount=0): " + tag);
          target.subs.push({ slot: null, name: acc.name, discord: acc.discord, th: acc.th, tag: acc.tag });
          continue;
        }

        const desired = pin.slot != null ? clamp(pin.slot, 1, slotCount) : null;

        if (desired != null) {
          const idx = desired - 1;
          const displaced = target.__mainSlots[idx];
          if (displaced && displaced.tag !== tag) {
            const displacedAcc = accByTag[displaced.tag];
            if (displacedAcc) globalPool.push(displacedAcc);
          }
          target.__mainSlots[idx] = { slot: desired, name: acc.name, discord: acc.discord, th: acc.th, tag: acc.tag };
        } else {
          // first empty slot
          let placed = false;
          for (let i = 0; i < slotCount; i++) {
            if (!target.__mainSlots[i]) {
              target.__mainSlots[i] = { slot: i + 1, name: acc.name, discord: acc.discord, th: acc.th, tag: acc.tag };
              placed = true;
              break;
            }
          }
          if (!placed) {
            const last = target.__mainSlots[slotCount - 1];
            if (last && last.tag !== tag) {
              const displacedAcc = accByTag[last.tag];
              if (displacedAcc) globalPool.push(displacedAcc);
            }
            target.__mainSlots[slotCount - 1] = { slot: slotCount, name: acc.name, discord: acc.discord, th: acc.th, tag: acc.tag };
          }
        }
      } else {
        target.subs.push({ slot: null, name: acc.name, discord: acc.discord, th: acc.th, tag: acc.tag });
      }
    }

    // Refill
    const overallMinRank = Math.min(...rosters.map((r) => DIFF_RANK[r.__spec.difficulty]));
    for (const r of rosters) {
      const spec = r.__spec;
      const allowExtremeHere = DIFF_RANK[spec.difficulty] === overallMinRank;

      const pool = sortByRank(globalPool, spec.difficulty);

      for (let i = 0; i < r.__mainSlots.length; i++) {
        if (r.__mainSlots[i]) continue;
        const cand = takeBestCandidate(pool, allowExtremeHere);
        if (!cand) break;
        r.__mainSlots[i] = { slot: i + 1, name: cand.name, discord: cand.discord, th: cand.th, tag: cand.tag };
      }

      while (r.subs.length < spec.subCount) {
        const cand = takeBestCandidate(pool, allowExtremeHere);
        if (!cand) break;
        r.subs.push({ slot: null, name: cand.name, discord: cand.discord, th: cand.th, tag: cand.tag });
      }

      const used = {};
      for (const p of r.__mainSlots) if (p) used[p.tag] = true;
      for (const p of r.subs) used[p.tag] = true;
      globalPool = globalPool.filter((a) => !used[a.tag]);

      r.main = r.__mainSlots.filter(Boolean);
      r.badges = { main: r.main.length, subs: r.subs.length };
    }

    report.unassigned = sortByRank(globalPool, "standard").map((a) => ({
      tag: a.tag, name: a.name, discord: a.discord, th: a.th, rushed: a.rushed, clan: a.clan, warPref: a.warPref
    }));

    return rosters.map((r) => ({
      id: r.id,
      title: r.title,
      badges: r.badges,
      main: r.main,
      subs: r.subs,
    }));
  };

  const generateRosterData = (args) => {
    const a = isObj(args) ? args : {};
    const pageTitle = toStr(a.pageTitle || "CWL Roster Overview");
    const schemaVersion = typeof a.schemaVersion === "number" && isFinite(a.schemaVersion) ? a.schemaVersion : 1;

    const rosterSpecs = Array.isArray(a.rosterSpecs) ? a.rosterSpecs : [];
    validateRosterSpecs(rosterSpecs);

    const accounts = Array.isArray(a.accounts) ? a.accounts : [];
    const filters = normalizeFilters(a.filters);
    const overrides = normalizeOverrides(a.overrides);

    const report = {
      excluded: [],
      unassigned: [],
      warnings: [],
      stats: {
        totalInput: accounts.length,
        afterFilters: 0,
        afterOverrides: 0,
      },
    };

    let candidates = applyFilters(accounts, filters, report);
    report.stats.afterFilters = candidates.length;
    report.stats.afterOverrides = candidates.filter((x) => !(overrides.excluded || []).includes(x.tag)).length;

    const rosters = allocate({ rosterSpecs, candidates, overrides, report });

    const rosterData = { schemaVersion, pageTitle, rosters };
    validateOutput(rosterData);

    return { rosterData, report };
  };

  const api = {
    normalizeAccountsFromXlsxRows,
    generateRosterData,
    _internal: { computeEffectiveTh, rushPenalty },
  };

  const root = (typeof window !== "undefined") ? window : (typeof globalThis !== "undefined" ? globalThis : global);
  root.RosterGenerator = api;
  root.generateRosterData = generateRosterData;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
