import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const clientPath = new URL("../cloudflarePages/client.js", import.meta.url);
const clientCode = fs.readFileSync(clientPath, "utf8");
const bootMarker = '    markBootTiming("shell-boot-start");';

const loadClientInternals = (overrides = {}) => {
  assert.ok(clientCode.includes(bootMarker), "expected client boot marker to exist");
  const instrumentedCode = clientCode.replace(
    bootMarker,
    [
      "    window.__ROSTER_CLIENT_TEST_INTERNALS__ = {",
      "        buildRosterPublicDisplayModel,",
      "        getDisplayDiscordUsernameForPlayer,",
      "        buildSeasonEventLeaderboardModel,",
      "        buildSeasonEventsPublicModel,",
      "        loadRosterDataWithFallback,",
      "        loadRosterDataViaCloudflarePublic,",
      "        loadPublishedActiveVersionViaCloudflarePublic,",
      "        loadCurrentSeasonEventsViaCloudflarePublic,",
      "        loadPreviousSeasonEventsViaCloudflarePublic,",
      "        readCachedRosterSnapshot,",
      "        readDurableCachedRosterSnapshot,",
      "        writeCachedRosterSnapshot,",
      "        resolveLeaderboardRankedSeasonCycle,",
      "    };",
      "    return;",
      bootMarker,
    ].join("\n"),
  );
  const context = {
    console,
    window: {
      ROSTER_CLIENT_DISABLE_AUTOLOAD: true,
    },
    atob: (value) => Buffer.from(String(value), "base64").toString("binary"),
    btoa: (value) => Buffer.from(String(value), "binary").toString("base64"),
    TextEncoder,
    TextDecoder,
    setTimeout,
  };
  Object.assign(context, overrides.context || {});
  Object.assign(context.window, overrides.window || {});
  vm.createContext(context);
  vm.runInContext(instrumentedCode, context);
  return context.window.__ROSTER_CLIENT_TEST_INTERNALS__;
};

const makeMemoryIndexedDb = () => {
  const records = new Map();
  let storeCreated = false;
  const defer = (fn) => Promise.resolve().then(fn);

  const db = {
    objectStoreNames: {
      contains: () => storeCreated,
    },
    createObjectStore: () => {
      storeCreated = true;
    },
    close: () => {},
    transaction: () => {
      const transaction = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        objectStore: () => ({
          get: (key) => {
            const request = {
              result: undefined,
              onsuccess: null,
              onerror: null,
            };
            defer(() => {
              request.result = records.get(key);
              if (typeof request.onsuccess === "function") request.onsuccess();
              if (typeof transaction.oncomplete === "function") transaction.oncomplete();
            });
            return request;
          },
          put: (value, key) => {
            const request = {
              onsuccess: null,
              onerror: null,
            };
            defer(() => {
              records.set(key, value);
              if (typeof request.onsuccess === "function") request.onsuccess();
              if (typeof transaction.oncomplete === "function") transaction.oncomplete();
            });
            return request;
          },
        }),
      };
      return transaction;
    },
  };

  return {
    open: () => {
      const request = {
        result: db,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };
      defer(() => {
        if (!storeCreated && typeof request.onupgradeneeded === "function") {
          request.onupgradeneeded();
        }
        if (typeof request.onsuccess === "function") request.onsuccess();
      });
      return request;
    },
  };
};

const makeThrowingLocalStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
};

test("keeps canonical Discord when a stale live projection has an empty Discord value", () => {
  const { buildRosterPublicDisplayModel } = loadClientInternals();
  const model = buildRosterPublicDisplayModel({
    trackingMode: "regularWar",
    main: [
      {
        name: "Phuni",
        discord: "phuuni",
        th: 18,
        tag: "#2LUCULPQ2",
        notes: ["canonical note"],
        excludeAsSwapTarget: true,
        excludeAsSwapSource: true,
      },
    ],
    subs: [],
    missing: [],
    publicLineupProjection: {
      active: true,
      trackingMode: "regularWar",
      source: "regularWarCurrentWar",
      updatedAt: "2026-05-18T09:12:11.217Z",
      players: [
        {
          name: "Phuni from live war",
          discord: "",
          th: 18,
          tag: "#2LUCULPQ2",
          mapPosition: 4,
          notes: ["stale projection note"],
          excludeAsSwapTarget: false,
          excludeAsSwapSource: false,
        },
      ],
    },
  });

  assert.equal(model.main.length, 1);
  assert.equal(model.main[0].discord, "phuuni");
  assert.equal(model.main[0].name, "Phuni from live war");
  assert.equal(model.main[0].mapPosition, 4);
  assert.deepEqual(Array.from(model.main[0].notes), ["canonical note"]);
  assert.equal(model.main[0].excludeAsSwapTarget, true);
  assert.equal(model.main[0].excludeAsSwapSource, true);
});

test("lets canonical Discord clearing win over a stale projected Discord value", () => {
  const { buildRosterPublicDisplayModel } = loadClientInternals();
  const model = buildRosterPublicDisplayModel({
    trackingMode: "regularWar",
    main: [
      {
        name: "Phuni",
        discord: "",
        th: 18,
        tag: "#2LUCULPQ2",
      },
    ],
    subs: [],
    missing: [],
    publicLineupProjection: {
      active: true,
      trackingMode: "regularWar",
      source: "regularWarCurrentWar",
      players: [
        {
          name: "Phuni from live war",
          discord: "old-handle",
          th: 18,
          tag: "#2LUCULPQ2",
          mapPosition: 4,
        },
      ],
    },
  });

  assert.equal(model.main[0].discord, "");
  assert.equal(model.main[0].mapPosition, 4);
});

test("prefers canonical metrics Discord username for display", () => {
  const { getDisplayDiscordUsernameForPlayer } = loadClientInternals();
  const player = { tag: "#2LUCULPQ2", discord: "row-cache" };
  const data = {
    playerMetrics: {
      byTag: {
        "#2LUCULPQ2": {
          identity: {
            tag: "#2LUCULPQ2",
            discordUsername: "canonical-user",
          },
        },
      },
    },
  };

  assert.equal(getDisplayDiscordUsernameForPlayer(player, data), "canonical-user");
  assert.equal(getDisplayDiscordUsernameForPlayer(player, {}), "row-cache");
});

test("loads current season event payloads from public data and decodes keys", async () => {
  const pushId = "push-ranked-legend-i-2026-05-18";
  const donationId = "donation-ranked-legend-i-2026-05-18";
  const encodedTagKey = "__FB64__" + Buffer.from("#2LUCULP", "utf8").toString("base64url");
  const responses = new Map([
    ["https://public-data.test/api/public-data/events/seasonEvents/current.json", {
      push: { eventId: pushId, seasonId: "ranked-legend-i-2026-05-18" },
      donation: { eventId: donationId, seasonId: "ranked-legend-i-2026-05-18" },
    }],
    ["https://public-data.test/api/public-data/events/seasonEvents/seasonState/current.json", {
      seasonId: "ranked-legend-i-2026-05-18",
      startsAt: "2026-05-18T05:00:00.000Z",
      endsAt: "2026-06-15T05:00:00.000Z",
    }],
    ["https://public-data.test/api/public-data/events/seasonEvents/byId/" + pushId + ".json", {
      eventId: pushId,
      type: "push",
      seasonId: "ranked-legend-i-2026-05-18",
      participantsByTag: {
        [encodedTagKey]: { tag: "#2LUCULP" },
      },
    }],
    ["https://public-data.test/api/public-data/events/seasonEvents/byId/" + donationId + ".json", {
      eventId: donationId,
      type: "donation",
      seasonId: "ranked-legend-i-2026-05-18",
    }],
  ]);
  const { loadCurrentSeasonEventsViaCloudflarePublic } = loadClientInternals({
    window: { ROSTER_PUBLIC_DATA_BASE_URL: "https://public-data.test/api/public-data" },
    context: {
      fetch: async (url) => ({
        ok: responses.has(url),
        status: responses.has(url) ? 200 : 404,
        text: async () => JSON.stringify(responses.get(url)),
      }),
    },
  });

  const loaded = await loadCurrentSeasonEventsViaCloudflarePublic();

  assert.equal(loaded.current.push.eventId, pushId);
  assert.equal(loaded.byId[pushId].participantsByTag["#2LUCULP"].tag, "#2LUCULP");
  assert.equal(loaded.loadErrors.length, 0);
});

test("loads previous season event payloads directly from public data bySeason", async () => {
  const previousSeasonId = "ranked-legend-i-2026-05-18";
  const pushId = "push-ranked-legend-i-2026-05-18";
  const donationId = "donation-ranked-legend-i-2026-05-18";
  const responses = new Map([
    ["https://public-data.test/api/public-data/events/seasonEvents/bySeason/" + previousSeasonId + ".json", {
      push: {
        eventId: pushId,
        seasonId: previousSeasonId,
        startsAt: "2026-05-18T05:00:00.000Z",
        endsAt: "2026-06-15T05:00:00.000Z",
      },
      donation: {
        eventId: donationId,
        seasonId: previousSeasonId,
        startsAt: "2026-05-18T05:00:00.000Z",
        endsAt: "2026-06-15T05:00:00.000Z",
      },
    }],
    ["https://public-data.test/api/public-data/events/seasonEvents/byId/" + pushId + ".json", {
      eventId: pushId,
      type: "push",
      seasonId: previousSeasonId,
      status: "archived",
    }],
    ["https://public-data.test/api/public-data/events/seasonEvents/byId/" + donationId + ".json", {
      eventId: donationId,
      type: "donation",
      seasonId: previousSeasonId,
      status: "archived",
    }],
  ]);
  const requested = [];
  const { loadPreviousSeasonEventsViaCloudflarePublic } = loadClientInternals({
    window: { ROSTER_PUBLIC_DATA_BASE_URL: "https://public-data.test/api/public-data" },
    context: {
      fetch: async (url) => {
        requested.push(url);
        return {
          ok: responses.has(url),
          status: responses.has(url) ? 200 : 404,
          text: async () => JSON.stringify(responses.get(url)),
        };
      },
    },
  });

  const loaded = await loadPreviousSeasonEventsViaCloudflarePublic({
    seasonEvents: {
      current: {
        push: {
          eventId: "push-ranked-legend-i-2026-06-15",
          seasonId: "ranked-legend-i-2026-06-15",
          startsAt: "2026-06-15T05:00:00.000Z",
          endsAt: "2026-07-13T05:00:00.000Z",
        },
      },
      seasonState: {
        seasonId: "ranked-legend-i-2026-06-15",
        startsAt: "2026-06-15T05:00:00.000Z",
        endsAt: "2026-07-13T05:00:00.000Z",
      },
    },
  });

  assert.equal(loaded.seasonState.seasonId, previousSeasonId);
  assert.equal(loaded.current.push.eventId, pushId);
  assert.equal(loaded.byId[donationId].status, "archived");
  assert.equal(requested.includes("https://public-data.test/api/public-data/events/seasonEvents/bySeason/" + previousSeasonId + ".json"), true);
});

test("loads published active version shards without requesting legacy active", async () => {
  const encodedTagKey = "__FB64__" + Buffer.from("#PLAYER", "utf8").toString("base64url");
  const responses = new Map([
    ["https://public-data.test/api/public-data/activePublished/currentVersionId.json", "version-1"],
    ["https://public-data.test/api/public-data/activeVersions/version-1/manifest.json", {
      versionId: "version-1",
      schemaVersion: 1,
      pageTitle: "Versioned Roster",
      rosterOrder: ["main"],
      rosterIds: ["main"],
      lastUpdatedAt: "2026-05-25T00:00:00.000Z",
    }],
    ["https://public-data.test/api/public-data/activeVersions/version-1/rosters.json", {
      main: {
        id: "main",
        title: "Main",
        trackingMode: "cwl",
        main: [{
          slot: 1,
          name: "Player",
          discord: "player",
          th: 16,
          tag: "#PLAYER",
          notes: [],
          excludeAsSwapTarget: false,
          excludeAsSwapSource: false,
        }],
        subs: [],
        missing: [],
      },
    }],
    ["https://public-data.test/api/public-data/activeVersions/version-1/playerMetrics.json", {
      schemaVersion: 1,
      updatedAt: "2026-05-25T00:00:00.000Z",
      byTag: {
        [encodedTagKey]: {
          latestSnapshot: { tag: "#PLAYER", name: "Player", trophies: 5000 },
          trophyHistoryDaily: [],
          donationCycles: [],
        },
      },
    }],
    ["https://public-data.test/api/public-data/events/seasonEvents/current.json", null],
    ["https://public-data.test/api/public-data/events/seasonEvents/seasonState/current.json", null],
  ]);
  const requested = [];
  const { loadRosterDataViaCloudflarePublic } = loadClientInternals({
    window: { ROSTER_PUBLIC_DATA_BASE_URL: "https://public-data.test/api/public-data" },
    context: {
      fetch: async (url) => {
        requested.push(url);
        return {
          ok: responses.has(url),
          status: responses.has(url) ? 200 : 404,
          text: async () => JSON.stringify(responses.get(url)),
        };
      },
    },
  });

  const loaded = await loadRosterDataViaCloudflarePublic();

  assert.equal(loaded.data.pageTitle, "Versioned Roster");
  assert.equal(loaded.data.rosters[0].id, "main");
  assert.equal(loaded.data.playerMetrics.byTag["#PLAYER"].latestSnapshot.trophies, 5000);
  assert.equal(requested.includes("https://public-data.test/api/public-data/active.json"), false);
});

test("uses bootstrap for current public state without granular event reads", async () => {
  const responses = new Map([
    ["https://public-data.test/api/public-data/bootstrap/current.json", {
      activeVersionId: "version-1",
      seasonEvents: {
        current: {
          donation: {
            eventId: "donation-season-1",
            seasonId: "season-1",
          },
        },
        seasonState: { seasonId: "season-1" },
        byId: {
          "donation-season-1": {
            eventId: "donation-season-1",
            type: "donation",
            seasonId: "season-1",
            status: "open",
            startsAt: "2026-05-18T05:00:00.000Z",
            endsAt: "2026-06-15T05:00:00.000Z",
            participantsByDiscordId: {},
          },
        },
        cwlAggregatesByEventId: {},
        latestCompletedCwl: null,
        loadErrors: [],
      },
      donationRefresh: {
        bySeason: {
          "season-1": {
            seasonId: "season-1",
            byTag: {},
          },
        },
      },
    }],
    ["https://public-data.test/api/public-data/activeVersions/version-1/manifest.json", {
      versionId: "version-1",
      schemaVersion: 1,
      pageTitle: "Bootstrap Version",
      rosterOrder: ["main"],
      rosterIds: ["main"],
      lastUpdatedAt: "2026-05-25T00:00:00.000Z",
    }],
    ["https://public-data.test/api/public-data/activeVersions/version-1/rosters.json", {
      main: {
        id: "main",
        title: "Main",
        main: [],
        subs: [],
        missing: [],
      },
    }],
    ["https://public-data.test/api/public-data/activeVersions/version-1/playerMetrics.json", {
      schemaVersion: 1,
      updatedAt: "2026-05-25T00:00:00.000Z",
      byTag: {},
    }],
  ]);
  const requested = [];
  const { loadRosterDataViaCloudflarePublic } = loadClientInternals({
    window: { ROSTER_PUBLIC_DATA_BASE_URL: "https://public-data.test/api/public-data" },
    context: {
      fetch: async (url) => {
        requested.push(url);
        return {
          ok: responses.has(url),
          status: responses.has(url) ? 200 : 404,
          text: async () => JSON.stringify(responses.get(url)),
        };
      },
    },
  });

  const loaded = await loadRosterDataViaCloudflarePublic();

  assert.equal(loaded.source, "cloudflare-public");
  assert.equal(loaded.activeVersionId, "version-1");
  assert.equal(loaded.data.pageTitle, "Bootstrap Version");
  assert.equal(loaded.data.seasonEvents.current.donation.eventId, "donation-season-1");
  assert.equal(requested.includes("https://public-data.test/api/public-data/activePublished/currentVersionId.json"), false);
  assert.equal(requested.includes("https://public-data.test/api/public-data/events/seasonEvents/current.json"), false);
  assert.equal(requested.includes("https://public-data.test/api/public-data/donationRefresh/bySeason/season-1.json"), false);
});

test("compact bootstrap hydrates targeted event and donation objects while active shards remain cached separately", async () => {
  const seasonId = "season-compact";
  const eventId = "donation-compact";
  const responses = new Map([
    ["https://public-data.test/api/public-data/bootstrap/current.json", { schemaVersion: 2, activeVersionId: "version-compact", active: { versionId: "version-compact" } }],
    ["https://public-data.test/api/public-data/activeVersions/version-compact/manifest.json", { versionId: "version-compact", schemaVersion: 1, pageTitle: "Compact", rosterIds: ["main"], rosterOrder: ["main"] }],
    ["https://public-data.test/api/public-data/activeVersions/version-compact/rosters.json", { main: { id: "main", main: [], subs: [], missing: [] } }],
    ["https://public-data.test/api/public-data/activeVersions/version-compact/playerMetrics.json", { schemaVersion: 1, byTag: {} }],
    ["https://public-data.test/api/public-data/events/seasonEvents/current.json", { donation: { eventId, seasonId } }],
    ["https://public-data.test/api/public-data/events/seasonEvents/seasonState/current.json", { seasonId }],
    ["https://public-data.test/api/public-data/events/seasonEvents/byId/" + eventId + ".json", { eventId, type: "donation", seasonId, participantsByDiscordId: {} }],
    ["https://public-data.test/api/public-data/donationRefresh/bySeason/" + seasonId + ".json", { seasonId, byTag: {} }],
  ]);
  const requested = [];
  const { loadRosterDataViaCloudflarePublic } = loadClientInternals({
    window: { ROSTER_PUBLIC_DATA_BASE_URL: "https://public-data.test/api/public-data" },
    context: { fetch: async (url) => {
      requested.push(url);
      return { ok: responses.has(url), status: responses.has(url) ? 200 : 404, text: async () => JSON.stringify(responses.get(url)) };
    } },
  });
  const loaded = await loadRosterDataViaCloudflarePublic();
  assert.equal(loaded.activeVersionId, "version-compact");
  assert.equal(loaded.data.seasonEvents.byId[eventId].eventId, eventId);
  assert.equal(loaded.data.donationRefresh.bySeason[seasonId].seasonId, seasonId);
  assert.ok(requested.includes("https://public-data.test/api/public-data/events/seasonEvents/current.json"));
  assert.ok(requested.includes("https://public-data.test/api/public-data/events/seasonEvents/byId/" + eventId + ".json"));
  assert.ok(requested.includes("https://public-data.test/api/public-data/donationRefresh/bySeason/" + seasonId + ".json"));
});

test("current shard propagation failure retries one whole version then loads every previous-version shard", async () => {
  const previousVersionId = "version-previous";
  const currentVersionId = "version-current";
  const responses = new Map([
    ["https://public-data.test/api/public-data/bootstrap/current.json", {
      schemaVersion: 2,
      currentVersionId,
      activeVersionId: currentVersionId,
      previousVersionId,
      active: { versionId: currentVersionId },
    }],
    ["https://public-data.test/api/public-data/activeVersions/" + currentVersionId + "/manifest.json", {
      versionId: currentVersionId,
      pageTitle: "Partial current",
      rosterIds: ["current"],
    }],
    ["https://public-data.test/api/public-data/activeVersions/" + previousVersionId + "/manifest.json", {
      versionId: previousVersionId,
      schemaVersion: 1,
      pageTitle: "Complete previous",
      rosterIds: ["previous"],
      rosterOrder: ["previous"],
    }],
    ["https://public-data.test/api/public-data/activeVersions/" + previousVersionId + "/rosters.json", {
      previous: { id: "previous", main: [], subs: [], missing: [] },
    }],
    ["https://public-data.test/api/public-data/activeVersions/" + previousVersionId + "/playerMetrics.json", {
      schemaVersion: 1,
      byTag: {},
    }],
    ["https://public-data.test/api/public-data/events/seasonEvents/current.json", null],
    ["https://public-data.test/api/public-data/events/seasonEvents/currentCwl.json", null],
    ["https://public-data.test/api/public-data/events/seasonEvents/latestCompletedCwl.json", null],
    ["https://public-data.test/api/public-data/events/seasonEvents/seasonState/current.json", null],
  ]);
  const counts = new Map();
  const { loadRosterDataViaCloudflarePublic } = loadClientInternals({
    window: { ROSTER_PUBLIC_DATA_BASE_URL: "https://public-data.test/api/public-data" },
    context: { fetch: async (url) => {
      counts.set(url, (counts.get(url) || 0) + 1);
      return { ok: responses.has(url), status: responses.has(url) ? 200 : 503, text: async () => JSON.stringify(responses.get(url)) };
    } },
  });

  const loaded = await loadRosterDataViaCloudflarePublic();

  assert.equal(loaded.activeVersionId, previousVersionId);
  assert.equal(loaded.data.pageTitle, "Complete previous");
  assert.deepEqual(Array.from(loaded.data.rosters, (roster) => roster.id), ["previous"]);
  for (const child of ["manifest", "rosters", "playerMetrics"]) {
    assert.equal(counts.get("https://public-data.test/api/public-data/activeVersions/" + currentVersionId + "/" + child + ".json"), 2);
    assert.equal(counts.get("https://public-data.test/api/public-data/activeVersions/" + previousVersionId + "/" + child + ".json"), 1);
  }
});

test("immutable version retry honors Retry-After before retrying the whole version", async () => {
  const base = "https://public-data.test/api/public-data/";
  const urls = {
    manifest: base + "activeVersions/version-retry/manifest.json",
    rosters: base + "activeVersions/version-retry/rosters.json",
    metrics: base + "activeVersions/version-retry/playerMetrics.json",
  };
  const counts = new Map();
  const payloads = new Map([
    [urls.manifest, { versionId: "version-retry", schemaVersion: 1, pageTitle: "Retry", rosterIds: ["main"], rosterOrder: ["main"] }],
    [urls.rosters, { main: { id: "main", main: [], subs: [], missing: [] } }],
    [urls.metrics, { schemaVersion: 1, byTag: {} }],
  ]);
  const { loadPublishedActiveVersionViaCloudflarePublic } = loadClientInternals({
    window: { ROSTER_PUBLIC_DATA_BASE_URL: "https://public-data.test/api/public-data" },
    context: { fetch: async (url) => {
      const count = (counts.get(url) || 0) + 1;
      counts.set(url, count);
      if (count === 1) {
        return {
          ok: false,
          status: 503,
          headers: { get: (name) => String(name).toLowerCase() === "retry-after" ? "0.05" : null },
          text: async () => "",
        };
      }
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(payloads.get(url)) };
    } },
  });

  const startedAt = Date.now();
  const loaded = await loadPublishedActiveVersionViaCloudflarePublic("version-retry", { retryCount: 1 });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(loaded.activeVersionId, "version-retry");
  assert.ok(elapsedMs >= 40, `Retry-After delay should be real, received ${elapsedMs}ms`);
  assert.ok(elapsedMs < 500, `Retry-After delay should stay capped for boot, received ${elapsedMs}ms`);
  assert.deepEqual(Object.fromEntries(counts), { [urls.manifest]: 2, [urls.rosters]: 2, [urls.metrics]: 2 });
});

test("roster shards and independent event metadata load concurrently under simulated latency", async () => {
  const base = "https://public-data.test/api/public-data/";
  const responses = new Map([
    [base + "bootstrap/current.json", { schemaVersion: 2, currentVersionId: "version-fast", activeVersionId: "version-fast" }],
    [base + "activeVersions/version-fast/manifest.json", { versionId: "version-fast", schemaVersion: 1, pageTitle: "Fast", rosterIds: ["main"], rosterOrder: ["main"] }],
    [base + "activeVersions/version-fast/rosters.json", { main: { id: "main", main: [], subs: [], missing: [] } }],
    [base + "activeVersions/version-fast/playerMetrics.json", { schemaVersion: 1, byTag: {} }],
    [base + "events/seasonEvents/current.json", null],
    [base + "events/seasonEvents/currentCwl.json", null],
    [base + "events/seasonEvents/latestCompletedCwl.json", null],
    [base + "events/seasonEvents/seasonState/current.json", null],
  ]);
  let inFlight = 0;
  let maxInFlight = 0;
  const { loadRosterDataViaCloudflarePublic } = loadClientInternals({
    window: { ROSTER_PUBLIC_DATA_BASE_URL: "https://public-data.test/api/public-data" },
    context: { fetch: async (url) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 35));
      inFlight -= 1;
      return { ok: responses.has(url), status: responses.has(url) ? 200 : 404, text: async () => JSON.stringify(responses.get(url)) };
    } },
  });
  const startedAt = Date.now();
  const loaded = await loadRosterDataViaCloudflarePublic();
  const elapsedMs = Date.now() - startedAt;

  assert.equal(loaded.activeVersionId, "version-fast");
  assert.ok(maxInFlight >= 7, `expected three shards and four metadata reads in flight, observed ${maxInFlight}`);
  assert.ok(elapsedMs < 150, `parallel hydration should avoid serialized simulated latency, received ${elapsedMs}ms`);
});

test("does not fall back to legacy active when the published version shard is missing", async () => {
  const responses = new Map([
    ["https://public-data.test/api/public-data/activePublished/currentVersionId.json", "version-missing"],
    ["https://public-data.test/api/public-data/active.json", {
      schemaVersion: 1,
      pageTitle: "Legacy Active",
      rosterOrder: [],
      rosters: [],
      playerMetrics: { schemaVersion: 1, updatedAt: "", byTag: {} },
    }],
  ]);
  const requested = [];
  const { loadRosterDataViaCloudflarePublic } = loadClientInternals({
    window: { ROSTER_PUBLIC_DATA_BASE_URL: "https://public-data.test/api/public-data" },
    context: {
      fetch: async (url) => {
        requested.push(url);
        return {
          ok: responses.has(url),
          status: responses.has(url) ? 200 : 404,
          text: async () => JSON.stringify(responses.get(url)),
        };
      },
    },
  });

  await assert.rejects(
    () => loadRosterDataViaCloudflarePublic(),
    /activeVersions\/version-missing/,
  );

  assert.equal(requested.includes("https://public-data.test/api/public-data/active.json"), false);
});

test("reuses cached roster and player metrics when active published version is unchanged", async () => {
  const responses = new Map([
    ["https://public-data.test/api/public-data/activePublished/currentVersionId.json", "version-1"],
    ["https://public-data.test/api/public-data/events/seasonEvents/current.json", null],
    ["https://public-data.test/api/public-data/events/seasonEvents/seasonState/current.json", null],
  ]);
  const requested = [];
  const { loadRosterDataViaCloudflarePublic } = loadClientInternals({
    window: { ROSTER_PUBLIC_DATA_BASE_URL: "https://public-data.test/api/public-data" },
    context: {
      fetch: async (url) => {
        requested.push(url);
        return {
          ok: responses.has(url),
          status: responses.has(url) ? 200 : 404,
          text: async () => JSON.stringify(responses.get(url)),
        };
      },
    },
  });

  const loaded = await loadRosterDataViaCloudflarePublic({
    cachedSnapshot: {
      activeVersionId: "version-1",
      data: {
        schemaVersion: 1,
        pageTitle: "Cached Version",
        rosterOrder: ["main"],
        rosters: [{
          id: "main",
          title: "Cached Main",
          main: [],
          subs: [],
          missing: [],
        }],
        playerMetrics: {
          schemaVersion: 1,
          updatedAt: "2026-05-25T00:00:00.000Z",
          byTag: {
            "#PLAYER": {
              latestSnapshot: { tag: "#PLAYER", trophies: 5000 },
            },
          },
        },
        seasonEvents: {
          current: {
            push: { eventId: "cached-push" },
          },
        },
      },
    },
  });

  assert.equal(loaded.source, "cloudflare-public-cached-active-version");
  assert.equal(loaded.activeVersionId, "version-1");
  assert.equal(loaded.data.pageTitle, "Cached Version");
  assert.equal(loaded.data.playerMetrics.byTag["#PLAYER"].latestSnapshot.trophies, 5000);
  assert.equal(requested.includes("https://public-data.test/api/public-data/activeVersions/version-1/rosters.json"), false);
  assert.equal(requested.includes("https://public-data.test/api/public-data/activeVersions/version-1/playerMetrics.json"), false);
  assert.equal(requested.includes("https://public-data.test/api/public-data/active.json"), false);
});

test("cached active version still hydrates detached donation overlay", async () => {
  const seasonId = "ranked-legend-i-2026-05-18";
  const donationId = "donation-ranked-legend-i-2026-05-18";
  const responses = new Map([
    ["https://public-data.test/api/public-data/activePublished/currentVersionId.json", "version-1"],
    ["https://public-data.test/api/public-data/events/seasonEvents/current.json", {
      donation: {
        eventId: donationId,
        seasonId,
        startsAt: "2026-05-18T05:00:00.000Z",
        endsAt: "2026-06-15T05:00:00.000Z",
      },
    }],
    ["https://public-data.test/api/public-data/events/seasonEvents/seasonState/current.json", {
      seasonId,
      startsAt: "2026-05-18T05:00:00.000Z",
      endsAt: "2026-06-15T05:00:00.000Z",
    }],
    ["https://public-data.test/api/public-data/events/seasonEvents/byId/" + donationId + ".json", {
      eventId: donationId,
      type: "donation",
      seasonId,
      status: "open",
      signupsOpen: true,
      startsAt: "2026-05-18T05:00:00.000Z",
      endsAt: "2026-06-15T05:00:00.000Z",
      participantsByDiscordId: {
        "111": { discordDisplayName: "Alpha", status: "signed_up", accounts: [{ tag: "#AAA", name: "Alpha" }] },
      },
    }],
    ["https://public-data.test/api/public-data/donationRefresh/bySeason/" + seasonId + ".json", {
      meta: { seasonId, updatedAt: "2026-05-25T00:00:00.000Z" },
      byTag: {
        ["__FB64__" + Buffer.from("#AAA", "utf8").toString("base64url")]: {
          tag: "#AAA",
          seasonId,
          donationCycle: {
            seasonId,
            startsAt: "2026-05-18T05:00:00.000Z",
            endsAt: "2026-06-15T05:00:00.000Z",
            cycleTotalDonations: 66,
            lastSeenAt: "2026-05-25T00:00:00.000Z",
          },
        },
      },
    }],
  ]);
  const requested = [];
  const { loadRosterDataViaCloudflarePublic, buildSeasonEventsPublicModel } = loadClientInternals({
    window: { ROSTER_PUBLIC_DATA_BASE_URL: "https://public-data.test/api/public-data" },
    context: {
      fetch: async (url) => {
        requested.push(url);
        return {
          ok: responses.has(url),
          status: responses.has(url) ? 200 : 404,
          text: async () => JSON.stringify(responses.get(url)),
        };
      },
    },
  });

  const loaded = await loadRosterDataViaCloudflarePublic({
    cachedSnapshot: {
      activeVersionId: "version-1",
      data: {
        schemaVersion: 1,
        pageTitle: "Cached Version",
        rosterOrder: ["main"],
        rosters: [{ id: "main", title: "Cached Main", main: [], subs: [], missing: [] }],
        playerMetrics: {
          schemaVersion: 1,
          updatedAt: "2026-05-25T00:00:00.000Z",
          byTag: {
            "#AAA": {
              identity: { tag: "#AAA", name: "Alpha" },
              donationCycles: {
                [seasonId]: {
                  seasonId,
                  startsAt: "2026-05-18T05:00:00.000Z",
                  endsAt: "2026-06-15T05:00:00.000Z",
                  cycleTotalDonations: 10,
                  lastSeenAt: "2026-05-20T00:00:00.000Z",
                },
              },
            },
          },
        },
      },
    },
  });
  const model = buildSeasonEventsPublicModel(loaded.data);

  assert.equal(requested.includes("https://public-data.test/api/public-data/activeVersions/version-1/playerMetrics.json"), false);
  assert.equal(requested.includes("https://public-data.test/api/public-data/donationRefresh/bySeason/" + seasonId + ".json"), true);
  assert.equal(model.cards[1].rows[0].score, 66);
});

test("uses IndexedDB cached snapshot when localStorage cannot store the full active payload", async () => {
  const responses = new Map([
    ["https://public-data.test/api/public-data/activePublished/currentVersionId.json", "version-1"],
    ["https://public-data.test/api/public-data/events/seasonEvents/current.json", null],
    ["https://public-data.test/api/public-data/events/seasonEvents/seasonState/current.json", null],
  ]);
  const requested = [];
  const internals = loadClientInternals({
    window: {
      ROSTER_PUBLIC_DATA_BASE_URL: "https://public-data.test/api/public-data",
      indexedDB: makeMemoryIndexedDb(),
      localStorage: makeThrowingLocalStorage(),
    },
    context: {
      fetch: async (url) => {
        requested.push(url);
        return {
          ok: responses.has(url),
          status: responses.has(url) ? 200 : 404,
          text: async () => JSON.stringify(responses.get(url)),
        };
      },
    },
  });
  const cachedData = {
    schemaVersion: 1,
    pageTitle: "IndexedDB Cached Version",
    rosterOrder: ["main"],
    rosters: [{
      id: "main",
      title: "Cached Main",
      main: [],
      subs: [],
      missing: [],
    }],
    playerMetrics: {
      schemaVersion: 1,
      updatedAt: "2026-05-25T00:00:00.000Z",
      byTag: {
        "#PLAYER": {
          latestSnapshot: { tag: "#PLAYER", trophies: 5000 },
        },
      },
    },
  };

  assert.equal(
    await internals.writeCachedRosterSnapshot(cachedData, "cloudflare-public", {
      activeVersionId: "version-1",
    }),
    true,
  );
  assert.equal(internals.readCachedRosterSnapshot(), null);

  const durableSnapshot = await internals.readDurableCachedRosterSnapshot();
  assert.equal(durableSnapshot.activeVersionId, "version-1");
  assert.equal(durableSnapshot.cacheSource, "IndexedDB");

  const loaded = await internals.loadRosterDataViaCloudflarePublic({
    cachedSnapshot: durableSnapshot,
  });

  assert.equal(loaded.source, "cloudflare-public-cached-active-version");
  assert.equal(loaded.data.pageTitle, "IndexedDB Cached Version");
  assert.equal(requested.includes("https://public-data.test/api/public-data/activeVersions/version-1/rosters.json"), false);
  assert.equal(requested.includes("https://public-data.test/api/public-data/activeVersions/version-1/playerMetrics.json"), false);
  assert.equal(requested.includes("https://public-data.test/api/public-data/active.json"), false);
});

test("downloads active version shards when cached active published version is stale", async () => {
  const responses = new Map([
    ["https://public-data.test/api/public-data/activePublished/currentVersionId.json", "version-2"],
    ["https://public-data.test/api/public-data/activeVersions/version-2/manifest.json", {
      versionId: "version-2",
      schemaVersion: 1,
      pageTitle: "Fresh Version",
      rosterOrder: ["main"],
      rosterIds: ["main"],
      lastUpdatedAt: "2026-05-26T00:00:00.000Z",
    }],
    ["https://public-data.test/api/public-data/activeVersions/version-2/rosters.json", {
      main: {
        id: "main",
        title: "Fresh Main",
        main: [],
        subs: [],
        missing: [],
      },
    }],
    ["https://public-data.test/api/public-data/activeVersions/version-2/playerMetrics.json", {
      schemaVersion: 1,
      updatedAt: "2026-05-26T00:00:00.000Z",
      byTag: {},
    }],
    ["https://public-data.test/api/public-data/events/seasonEvents/current.json", null],
    ["https://public-data.test/api/public-data/events/seasonEvents/seasonState/current.json", null],
  ]);
  const requested = [];
  const { loadRosterDataViaCloudflarePublic } = loadClientInternals({
    window: { ROSTER_PUBLIC_DATA_BASE_URL: "https://public-data.test/api/public-data" },
    context: {
      fetch: async (url) => {
        requested.push(url);
        return {
          ok: responses.has(url),
          status: responses.has(url) ? 200 : 404,
          text: async () => JSON.stringify(responses.get(url)),
        };
      },
    },
  });

  const loaded = await loadRosterDataViaCloudflarePublic({
    cachedSnapshot: {
      activeVersionId: "version-1",
      data: {
        schemaVersion: 1,
        pageTitle: "Cached Version",
        rosterOrder: ["main"],
        rosters: [{ id: "main", title: "Cached Main", main: [], subs: [], missing: [] }],
        playerMetrics: { byTag: {} },
      },
    },
  });

  assert.equal(loaded.source, "cloudflare-public");
  assert.equal(loaded.activeVersionId, "version-2");
  assert.equal(loaded.data.pageTitle, "Fresh Version");
  assert.equal(requested.includes("https://public-data.test/api/public-data/activeVersions/version-2/rosters.json"), true);
  assert.equal(requested.includes("https://public-data.test/api/public-data/activeVersions/version-2/playerMetrics.json"), true);
  assert.equal(requested.includes("https://public-data.test/api/public-data/active.json"), false);
});

test("public loader does not fall back to Apps Script assets when Cloudflare data fails", async () => {
  const requested = [];
  const { loadRosterDataWithFallback } = loadClientInternals({
    window: {
      ROSTER_PUBLIC_DATA_BASE_URL: "https://public-data.test/api/public-data",
      ROSTER_BASE_URL: "https://script.google.test/macros/s/deployment/exec",
    },
    context: {
      fetch: async (url) => {
        requested.push(url);
        return {
          ok: false,
          status: 503,
          text: async () => JSON.stringify({ ok: false, error: "unavailable" }),
        };
      },
    },
  });

  await assert.rejects(
    () => loadRosterDataWithFallback({
      cachedSnapshot: {
        activeVersionId: "version-1",
        data: {
          schemaVersion: 1,
          pageTitle: "Cached Version",
          rosterOrder: ["main"],
          rosters: [{ id: "main", title: "Cached Main", main: [], subs: [], missing: [] }],
          playerMetrics: { byTag: {} },
        },
      },
    }),
    /Cloudflare public data hydration failed/,
  );

  assert.equal(requested.some((url) => String(url).includes("script.google.test")), false);
  assert.equal(requested.some((url) => String(url).includes("asset=roster-data.json")), false);
  assert.equal(requested.some((url) => String(url).includes("/api/public-data/")), true);
});

test("season events model renders unavailable and empty states safely", () => {
  const { buildSeasonEventsPublicModel } = loadClientInternals();
  const empty = buildSeasonEventsPublicModel({});

  assert.equal(empty.cards.length, 3);
  assert.equal(empty.cards[0].unavailable, true);
  assert.equal(empty.cards[0].rows.length, 0);
  assert.equal(empty.cards[2].type, "cwl");
  assert.equal(empty.cards[2].lifecycleDisplayState, "stale-unavailable");

  const data = {
    seasonEvents: {
      current: {
        push: { eventId: "push-ranked-legend-i-2026-05-18", seasonId: "ranked-legend-i-2026-05-18" },
        donation: { eventId: "donation-ranked-legend-i-2026-05-18", seasonId: "ranked-legend-i-2026-05-18" },
      },
      seasonState: { seasonId: "ranked-legend-i-2026-05-18" },
      byId: {
        "push-ranked-legend-i-2026-05-18": {
          eventId: "push-ranked-legend-i-2026-05-18",
          type: "push",
          seasonId: "ranked-legend-i-2026-05-18",
          title: "Push Event",
          status: "open",
          signupsOpen: true,
          startsAt: "2026-05-18T05:00:00.000Z",
          endsAt: "2026-06-15T05:00:00.000Z",
          participantsByDiscordId: {},
        },
        "donation-ranked-legend-i-2026-05-18": {
          eventId: "donation-ranked-legend-i-2026-05-18",
          type: "donation",
          seasonId: "ranked-legend-i-2026-05-18",
          title: "Donation Event",
          status: "open",
          signupsOpen: true,
          startsAt: "2026-05-18T05:00:00.000Z",
          endsAt: "2026-06-15T05:00:00.000Z",
          participantsByDiscordId: {},
        },
      },
    },
    playerMetrics: { byTag: {} },
  };
  const model = buildSeasonEventsPublicModel(data);

  assert.equal(model.cards[0].unavailable, false);
  assert.equal(model.cards[0].activeParticipantCount, 0);
  assert.equal(model.cards[1].activeParticipantCount, 0);
});

test("current CWL pointer with a delayed event object is shown as unavailable, not as a previous result", () => {
  const { buildSeasonEventsPublicModel } = loadClientInternals();
  const model = buildSeasonEventsPublicModel({
    seasonEvents: {
      current: { cwl: { eventId: "cwl-current-propagating", type: "cwl" } },
      latestCompletedCwl: { eventId: "cwl-previous", type: "cwl" },
      byId: {
        "cwl-previous": {
          eventId: "cwl-previous",
          type: "cwl",
          cwlTrackingState: "completed",
          participantsByDiscordId: {},
        },
      },
      cwlAggregatesByEventId: {
        "cwl-previous": { final: { eventId: "cwl-previous", kind: "final", byTag: {}, rankedTags: [] } },
      },
    },
  });

  const cwlCards = model.cards.filter((card) => card.type === "cwl");
  const current = cwlCards.find((card) => !card.historical);
  const previous = cwlCards.find((card) => card.historical);
  assert.equal(current.event.eventId, "cwl-current-propagating");
  assert.equal(current.unavailable, true);
  assert.equal(current.lifecycleDisplayState, "stale-unavailable");
  assert.equal(previous.event.eventId, "cwl-previous");
});

test("season events model includes an active CWL leaderboard card", () => {
  const { buildSeasonEventsPublicModel } = loadClientInternals();
  const data = {
    seasonEvents: {
      current: {
        cwl: { eventId: "cwl-active", type: "cwl" },
      },
      byId: {
        "cwl-active": {
          eventId: "cwl-active",
          type: "cwl",
          title: "CWL Event",
          status: "open",
          signupsOpen: true,
          startsAt: "2026-07-04T20:00:00.000Z",
          endsAt: "2026-07-11T20:00:00.000Z",
          cwlTrackingState: "active",
          cwl: {
            target: {
              resolved: true,
              status: "resolved",
              rosterId: "main",
              clanTag: "#CLAN",
              leagueName: "Champion I",
              eligibleAccountTags: ["#AAA"],
            },
          },
          participantsByDiscordId: {
            "100": {
              status: "signed_up",
              accounts: [{ tag: "#AAA" }],
            },
          },
        },
      },
      cwlAggregatesByEventId: {
        "cwl-active": {
          live: {
            eventId: "cwl-active",
            kind: "live",
            cwlTrackingState: "active",
            rankedTags: ["#AAA"],
            byTag: {
              "#AAA": {
                starsTotal: 7,
                attacksMade: 3,
                threeStarCount: 2,
                totalDestruction: 265,
                defenseAttacksReceived: 2,
                successfulDefensiveAttacks: 1,
                attackedDefenseDays: 1,
                defenseHolds: 1,
                defenseStarsConceded: 2,
                bestStarsConceded: 2,
                bestDestructionConceded: 88,
              },
            },
          },
        },
      },
    },
    playerMetrics: {
      byTag: {
        "#AAA": {
          identity: { tag: "#AAA", name: "Current Alpha" },
          latestSnapshot: { tag: "#AAA", name: "Latest Alpha" },
        },
      },
    },
  };

  const model = buildSeasonEventsPublicModel(data);
  const cwlCard = model.cards.find((card) => card.type === "cwl");

  assert.ok(cwlCard);
  assert.equal(cwlCard.status, "active");
  assert.equal(cwlCard.rows.length, 1);
  assert.equal(cwlCard.rows[0].displayName, "Current Alpha");
  assert.equal(cwlCard.rows[0].accounts[0].name, "Current Alpha");
  assert.equal(cwlCard.rows[0].score, 7);
  assert.equal(cwlCard.rows[0].cwlStats.defenseStarsConceded, 2);
});

test("season events model recomputes CWL registration order when aggregate ranked tags are stale", () => {
  const { buildSeasonEventsPublicModel } = loadClientInternals();
  const data = {
    seasonEvents: {
      current: {
        cwl: { eventId: "cwl-active", type: "cwl" },
      },
      byId: {
        "cwl-active": {
          eventId: "cwl-active",
          type: "cwl",
          title: "CWL Event",
          status: "open",
          signupsOpen: true,
          cwlTrackingState: "active",
          cwl: {
            target: {
              resolved: true,
              status: "resolved",
              rosterId: "main",
              clanTag: "#CLAN",
              leagueName: "Champion I",
              eligibleAccountTags: ["#AAA", "#BBB"],
            },
          },
          participantsByDiscordId: {
            "100": {
              discordDisplayName: "Old Signup",
              status: "signed_up",
              accounts: [{ tag: "#AAA", name: "Old Account" }],
            },
            "200": {
              discordDisplayName: "New Signup",
              status: "signed_up",
              accounts: [{ tag: "#BBB", name: "New Account" }],
            },
          },
        },
      },
      cwlAggregatesByEventId: {
        "cwl-active": {
          live: {
            eventId: "cwl-active",
            kind: "live",
            cwlTrackingState: "active",
            rankedTags: ["#AAA"],
            byTag: {
              "#AAA": { starsTotal: 1, attacksMade: 1, defenseStarsConceded: 2 },
              "#BBB": { starsTotal: 3, attacksMade: 1, defenseStarsConceded: 1 },
            },
          },
        },
      },
    },
    playerMetrics: {
      byTag: {
        "#BBB": {
          identity: { tag: "#BBB", name: "Current New" },
          latestSnapshot: { tag: "#BBB", name: "Latest New" },
        },
      },
    },
  };

  const model = buildSeasonEventsPublicModel(data);
  const cwlCard = model.cards.find((card) => card.type === "cwl");

  assert.ok(cwlCard);
  assert.equal(JSON.stringify(cwlCard.rows.map((row) => row.tag)), JSON.stringify(["#BBB", "#AAA"]));
  assert.equal(cwlCard.rows[0].rank, 1);
  assert.equal(cwlCard.rows[0].displayName, "Current New");
  assert.equal(cwlCard.rows[0].score, 3);
});

test("season events model excludes dormant wrong-roster CWL accounts", () => {
  const { buildSeasonEventsPublicModel } = loadClientInternals();
  const data = {
    seasonEvents: {
      current: {
        cwl: { eventId: "cwl-targeted", type: "cwl" },
      },
      byId: {
        "cwl-targeted": {
          eventId: "cwl-targeted",
          type: "cwl",
          title: "CWL Event",
          status: "open",
          signupsOpen: true,
          cwlTrackingState: "active",
          cwl: {
            target: {
              resolved: true,
              status: "resolved",
              rosterId: "main",
              clanTag: "#CLAN",
              leagueName: "Champion I",
              eligibleAccountTags: ["#AAA"],
            },
          },
          participantsByDiscordId: {
            mixed: {
              discordDisplayName: "Mixed",
              status: "signed_up",
              accounts: [{ tag: "#AAA", name: "Target" }, { tag: "#BBB", name: "Dormant" }],
            },
            dormant: {
              discordDisplayName: "Dormant",
              status: "signed_up",
              accounts: [{ tag: "#BBB", name: "Wrong Clan" }],
            },
          },
        },
      },
      cwlAggregatesByEventId: {
        "cwl-targeted": {
          live: {
            eventId: "cwl-targeted",
            kind: "live",
            cwlTrackingState: "active",
            rankedTags: ["#BBB", "#AAA"],
            byTag: {
              "#AAA": { starsTotal: 3, attacksMade: 1, defenseStarsConceded: 2 },
              "#BBB": { starsTotal: 9, attacksMade: 3, defenseStarsConceded: 1 },
            },
          },
        },
      },
    },
    playerMetrics: { byTag: {} },
  };

  const model = buildSeasonEventsPublicModel(data);
  const cwlCard = model.cards.find((card) => card.type === "cwl");

  assert.ok(cwlCard);
  assert.equal(cwlCard.activeParticipantCount, 1);
  assert.equal(JSON.stringify(cwlCard.rows.map((row) => row.tag)), JSON.stringify(["#AAA"]));
  assert.equal(cwlCard.rows[0].displayName, "Target");
});

test("season events model keeps a waiting current CWL and shows previous results separately", () => {
  const { buildSeasonEventsPublicModel } = loadClientInternals();
  const data = {
    seasonEvents: {
      current: {
        cwl: { eventId: "cwl-waiting", type: "cwl" },
      },
      latestCompletedCwl: { eventId: "cwl-completed", type: "cwl" },
      byId: {
        "cwl-waiting": {
          eventId: "cwl-waiting",
          type: "cwl",
          status: "open",
          signupsOpen: true,
          startsAt: "",
          endsAt: "",
          cwlTrackingState: "waiting",
          cwl: {
            target: {
              resolved: true,
              status: "resolved",
              rosterId: "waiting-roster",
              clanTag: "#WAITCLAN",
              leagueName: "Champion I",
              groupId: "group-waiting",
              season: "2026-07",
              observedAt: "2026-07-04T00:00:00.000Z",
              eligibleAccountTags: ["#WAIT"],
            },
          },
          participantsByDiscordId: {
            "200": { discordDisplayName: "Waiting", status: "signed_up", accounts: [{ tag: "#WAIT", name: "Waiting" }] },
          },
        },
        "cwl-completed": {
          eventId: "cwl-completed",
          type: "cwl",
          status: "closed",
          signupsOpen: false,
          startsAt: "2026-06-01T00:00:00.000Z",
          endsAt: "2026-06-08T00:00:00.000Z",
          cwlTrackingState: "completed",
          participantsByDiscordId: {
            "100": { discordDisplayName: "Winner", status: "signed_up", accounts: [{ tag: "#WIN", name: "Winner" }] },
          },
        },
      },
      cwlAggregatesByEventId: {
        "cwl-completed": {
          final: {
            eventId: "cwl-completed",
            kind: "final",
            rankedTags: ["#WIN"],
            byTag: {
              "#WIN": { starsTotal: 21, defenseStarsConceded: 4, bestStarsConceded: 4, attackedDefenseDays: 2 },
            },
          },
        },
      },
    },
  };

  const model = buildSeasonEventsPublicModel(data);
  const cwlCards = model.cards.filter((card) => card.type === "cwl");
  const currentCard = cwlCards.find((card) => !card.historical);
  const previousCard = cwlCards.find((card) => card.historical);

  assert.equal(cwlCards.length, 2);
  assert.ok(currentCard);
  assert.equal(currentCard.event.eventId, "cwl-waiting");
  assert.equal(currentCard.lifecycleDisplayState, "waiting-for-group");
  assert.equal(currentCard.rows.length, 1);
  assert.equal(currentCard.rows[0].tag, "#WAIT");
  assert.ok(previousCard);
  assert.equal(previousCard.event.eventId, "cwl-completed");
  assert.equal(previousCard.lifecycleDisplayState, "completed");
  assert.equal(previousCard.rows.length, 1);
  assert.equal(previousCard.rows[0].tag, "#WIN");
  assert.equal(previousCard.rows[0].score, 21);
});

test("completed CWL with delayed final data keeps the last consistent live view and reports propagation", () => {
  const { buildSeasonEventsPublicModel } = loadClientInternals();
  const data = {
    seasonEvents: {
      current: { cwl: { eventId: "cwl-propagating", type: "cwl" } },
      byId: {
        "cwl-propagating": {
          eventId: "cwl-propagating",
          type: "cwl",
          status: "closed",
          signupsOpen: false,
          cwlTrackingState: "completed",
          cwl: {
            target: {
              resolved: true,
              status: "resolved",
              rosterId: "main",
              clanTag: "#CLAN",
              leagueName: "Champion I",
              groupId: "group-1",
              season: "2026-07",
              observedAt: "2026-07-11T00:00:00.000Z",
              eligibleAccountTags: ["#AAA"],
            },
          },
          participantsByDiscordId: {
            "100": { status: "signed_up", accounts: [{ tag: "#AAA", name: "Alpha" }] },
          },
        },
      },
      cwlAggregatesByEventId: {
        "cwl-propagating": {
          live: {
            eventId: "cwl-propagating",
            kind: "live",
            rankedTags: ["#AAA"],
            byTag: { "#AAA": { starsTotal: 18, attacksMade: 6, defenseStarsConceded: 5 } },
          },
        },
      },
    },
    playerMetrics: { byTag: {} },
  };

  const model = buildSeasonEventsPublicModel(data);
  const card = model.cards.find((entry) => entry.type === "cwl" && !entry.historical);

  assert.ok(card);
  assert.equal(card.event.eventId, "cwl-propagating");
  assert.equal(card.finalDataPending, true);
  assert.equal(card.aggregateSource, "live");
  assert.equal(card.lifecycleDisplayState, "stale-unavailable");
  assert.equal(card.rows.length, 1);
  assert.equal(card.rows[0].score, 18);
});

test("season event leaderboards include signed-up participants and exclude cancelled or removed", () => {
  const { buildSeasonEventLeaderboardModel } = loadClientInternals();
  const event = {
    eventId: "donation-ranked-legend-i-2026-05-18",
    type: "donation",
    seasonId: "ranked-legend-i-2026-05-18",
    startsAt: "2026-05-18T05:00:00.000Z",
    endsAt: "2026-06-15T05:00:00.000Z",
    participantsByDiscordId: {
      "111": {
        discordDisplayName: "Alpha",
        discordUsername: "alpha",
        status: "signed_up",
        accounts: [{ tag: "#AAA", name: "Alpha" }],
      },
      "222": {
        discordDisplayName: "Cancelled",
        status: "cancelled",
        accounts: [{ tag: "#BBB", name: "Bravo" }],
      },
      "333": {
        discordDisplayName: "Removed",
        status: "removed",
        accounts: [{ tag: "#CCC", name: "Charlie" }],
      },
      "444": {
        discordDisplayName: "Invalid",
        status: "signed_up",
        accounts: [],
      },
      "555": {
        discordDisplayName: "Dash",
        status: "signed-up",
        accounts: [{ tag: "#DDD", name: "Delta" }],
      },
    },
  };
  const data = {
    playerMetrics: {
      byTag: {
        "#AAA": {
          identity: { tag: "#AAA", name: "Alpha" },
          donationCycles: {
            "ranked-legend-i-2026-05-18": {
              seasonId: "ranked-legend-i-2026-05-18",
              startsAt: "2026-05-18T05:00:00.000Z",
              endsAt: "2026-06-15T05:00:00.000Z",
              cycleTotalDonations: 42,
              cycleTotalDonationsReceived: 5,
            },
          },
        },
        "#DDD": {
          identity: { tag: "#DDD", name: "Delta" },
          donationCycles: {
            "ranked-legend-i-2026-05-18": {
              seasonId: "ranked-legend-i-2026-05-18",
              startsAt: "2026-05-18T05:00:00.000Z",
              endsAt: "2026-06-15T05:00:00.000Z",
              cycleTotalDonations: 7,
              cycleTotalDonationsReceived: 1,
            },
          },
        },
      },
    },
  };

  const model = buildSeasonEventLeaderboardModel(event, data);

  assert.equal(model.rows.length, 2);
  assert.equal(model.rows[0].displayName, "Alpha");
  assert.equal(model.rows[0].score, 42);
  assert.equal(model.rows[1].displayName, "Dash");
  assert.equal(model.rows[1].score, 7);
});

test("donation event leaderboard sums two registered accounts from event season cycle", () => {
  const { buildSeasonEventLeaderboardModel } = loadClientInternals();
  const event = {
    eventId: "donation-ranked-legend-i-2026-05-18",
    type: "donation",
    seasonId: "ranked-legend-i-2026-05-18",
    startsAt: "2026-05-18T05:00:00.000Z",
    endsAt: "2026-06-15T05:00:00.000Z",
    participantsByDiscordId: {
      "111": {
        discordDisplayName: "Bravo",
        status: "signed_up",
        accounts: [{ tag: "#AAA", name: "A" }, { tag: "#BBB", name: "B" }, { tag: "#CCC", name: "C" }],
      },
    },
  };
  const data = {
    playerMetrics: {
      byTag: {
        "#AAA": { donationCycles: { "ranked-legend-i-2026-05-18": { cycleTotalDonations: 100, startsAt: event.startsAt, endsAt: event.endsAt } } },
        "#BBB": { donationCycles: { "ranked-legend-i-2026-05-18": { cycleTotalDonations: 175, startsAt: event.startsAt, endsAt: event.endsAt } } },
        "#CCC": { donationCycles: { "ranked-legend-i-2026-05-18": { cycleTotalDonations: 999, startsAt: event.startsAt, endsAt: event.endsAt } } },
      },
    },
  };

  const model = buildSeasonEventLeaderboardModel(event, data);

  assert.equal(model.rows[0].score, 275);
  assert.equal(model.rows[0].accounts.length, 2);
});

test("donation event leaderboard prefers newer detached donation overlay", () => {
  const { buildSeasonEventLeaderboardModel } = loadClientInternals();
  const seasonId = "ranked-legend-i-2026-05-18";
  const event = {
    eventId: "donation-ranked-legend-i-2026-05-18",
    type: "donation",
    seasonId,
    startsAt: "2026-05-18T05:00:00.000Z",
    endsAt: "2026-06-15T05:00:00.000Z",
    participantsByDiscordId: {
      "111": { discordDisplayName: "Alpha", status: "signed_up", accounts: [{ tag: "#AAA", name: "A" }] },
    },
  };
  const data = {
    playerMetrics: {
      byTag: {
        "#AAA": {
          donationCycles: {
            [seasonId]: {
              cycleTotalDonations: 10,
              startsAt: event.startsAt,
              endsAt: event.endsAt,
              lastSeenAt: "2026-05-20T00:00:00.000Z",
            },
          },
        },
      },
    },
    donationRefresh: {
      bySeason: {
        [seasonId]: {
          byTag: {
            "#AAA": {
              donationCycle: {
                seasonId,
                cycleTotalDonations: 45,
                startsAt: event.startsAt,
                endsAt: event.endsAt,
                lastSeenAt: "2026-05-25T00:00:00.000Z",
              },
            },
          },
        },
      },
    },
  };

  const model = buildSeasonEventLeaderboardModel(event, data);

  assert.equal(model.rows[0].score, 45);
});

test("archived donation event uses its own seasonId instead of current season", () => {
  const { buildSeasonEventLeaderboardModel } = loadClientInternals();
  const event = {
    eventId: "donation-ranked-legend-i-2026-05-18",
    type: "donation",
    seasonId: "ranked-legend-i-2026-05-18",
    startsAt: "2026-05-18T05:00:00.000Z",
    endsAt: "2026-06-15T05:00:00.000Z",
    participantsByDiscordId: {
      "111": { discordDisplayName: "Alpha", status: "signed_up", accounts: [{ tag: "#AAA", name: "A" }] },
    },
  };
  const data = {
    seasonEvents: {
      current: { donation: { seasonId: "ranked-legend-i-2026-06-15" } },
      seasonState: { seasonId: "ranked-legend-i-2026-06-15" },
    },
    playerMetrics: {
      byTag: {
        "#AAA": {
          donationCycles: {
            "ranked-legend-i-2026-05-18": { cycleTotalDonations: 75, startsAt: event.startsAt, endsAt: event.endsAt },
            "ranked-legend-i-2026-06-15": { cycleTotalDonations: 999, startsAt: "2026-06-15T05:00:00.000Z", endsAt: "2026-07-13T05:00:00.000Z" },
          },
        },
      },
    },
  };

  const model = buildSeasonEventLeaderboardModel(event, data);

  assert.equal(model.seasonId, "ranked-legend-i-2026-05-18");
  assert.equal(model.rows[0].score, 75);
});

test("push event leaderboard ranks by current league bucket then current trophies", () => {
  const { buildSeasonEventLeaderboardModel } = loadClientInternals();
  const event = {
    eventId: "push-ranked-legend-i-2026-05-18",
    type: "push",
    seasonId: "ranked-legend-i-2026-05-18",
    startsAt: "2026-05-18T05:00:00.000Z",
    endsAt: "2026-06-15T05:00:00.000Z",
    participantsByDiscordId: {
      "111": { discordDisplayName: "Alpha", status: "signed_up", accounts: [{ tag: "#AAA", name: "Alpha" }] },
      "222": { discordDisplayName: "Bravo", status: "signed_up", accounts: [{ tag: "#BBB", name: "Bravo" }] },
      "333": { discordDisplayName: "Delta", status: "signed_up", accounts: [{ tag: "#DDD", name: "Delta" }] },
    },
  };
  const data = {
    playerMetrics: {
      byTag: {
        "#AAA": {
          identity: { tag: "#AAA", name: "Alpha" },
          trophyHistoryDaily: [
            { dayKey: "2026-05-18", capturedAt: "2026-05-18T05:00:00.000Z", trophies: 5000, league: { name: "Legend League" }, leagueTier: { id: 105000036 } },
            { dayKey: "2026-05-20", capturedAt: "2026-05-20T15:00:00.000Z", trophies: 5200, league: { name: "Legend League" }, leagueTier: { id: 105000036 } },
          ],
          latestSnapshot: { tag: "#AAA", name: "Alpha", trophies: 5200, capturedAt: "2026-05-20T15:00:00.000Z", league: { name: "Legend League" }, leagueTier: { id: 105000036 } },
        },
        "#BBB": {
          identity: { tag: "#BBB", name: "Bravo" },
          trophyHistoryDaily: [
            { dayKey: "2026-05-20", capturedAt: "2026-05-20T15:00:00.000Z", trophies: 5600, league: { name: "Titan League" }, leagueTier: { id: 105000027 } },
          ],
          latestSnapshot: { tag: "#BBB", name: "Bravo", trophies: 5600, capturedAt: "2026-05-20T15:00:00.000Z", league: { name: "Titan League" }, leagueTier: { id: 105000027 } },
        },
        "#DDD": {
          identity: { tag: "#DDD", name: "Delta" },
          trophyHistoryDaily: [
            { dayKey: "2026-05-19", capturedAt: "2026-05-19T15:00:00.000Z", trophies: 6100, league: { name: "Legend League" }, leagueTier: { id: 105000036 } },
            { dayKey: "2026-05-20", capturedAt: "2026-05-20T15:00:00.000Z", trophies: 6000, league: { name: "Legend League" }, leagueTier: { id: 105000035 } },
          ],
          latestSnapshot: { tag: "#DDD", name: "Delta", trophies: 6000, capturedAt: "2026-05-20T15:00:00.000Z", league: { name: "Legend League" }, leagueTier: { id: 105000035 } },
        },
      },
    },
  };

  const model = buildSeasonEventLeaderboardModel(event, data, { nowMs: Date.parse("2026-05-20T15:00:00.000Z") });

  assert.equal(model.rows[0].displayName, "Alpha");
  assert.equal(model.rows[0].score, 5200);
  assert.match(model.rows[0].scoreLabel, /^Legends I - 5[,.]200 trophies$/);
  assert.equal(model.rows[0].metric, "leagueTrophies");
  assert.equal(model.rows[0].currentLeagueName, "Legends I");
  assert.equal(model.rows[0].bestLeagueName, "Legends I");
  assert.equal(model.rows[0].hasPushRank, true);
  assert.equal(model.rows[1].displayName, "Delta");
  assert.equal(model.rows[1].score, 6000);
  assert.equal(model.rows[1].currentLeagueName, "Legends II");
  assert.equal(model.rows[1].bestLeagueName, "Legends II");
  assert.equal(model.rows[2].displayName, "Bravo");
  assert.equal(model.rows[2].score, 5600);
});

test("public client does not use month donation ledgers or protected event leaderboard methods", () => {
  assert.equal(/donationMonths|monthlyTotalDonations|LEADERBOARD_MONTH|monthMode/.test(clientCode), false);
  assert.equal(/getSeasonEventLeaderboard|getCurrentSeasonEventLeaderboards/.test(clientCode), false);
});
