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
      "        loadRosterDataViaFirebasePublic,",
      "        loadCurrentSeasonEventsViaFirebasePublic,",
      "        loadPreviousSeasonEventsViaFirebasePublic,",
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

test("loads current season event payloads from public Firebase and decodes keys", async () => {
  const pushId = "push-ranked-legend-i-2026-05-18";
  const donationId = "donation-ranked-legend-i-2026-05-18";
  const encodedTagKey = "__FB64__" + Buffer.from("#2LUCULP", "utf8").toString("base64url");
  const responses = new Map([
    ["https://firebase.test/events/seasonEvents/current.json", {
      push: { eventId: pushId, seasonId: "ranked-legend-i-2026-05-18" },
      donation: { eventId: donationId, seasonId: "ranked-legend-i-2026-05-18" },
    }],
    ["https://firebase.test/events/seasonEvents/seasonState/current.json", {
      seasonId: "ranked-legend-i-2026-05-18",
      startsAt: "2026-05-18T05:00:00.000Z",
      endsAt: "2026-06-15T05:00:00.000Z",
    }],
    ["https://firebase.test/events/seasonEvents/byId/" + pushId + ".json", {
      eventId: pushId,
      type: "push",
      seasonId: "ranked-legend-i-2026-05-18",
      participantsByTag: {
        [encodedTagKey]: { tag: "#2LUCULP" },
      },
    }],
    ["https://firebase.test/events/seasonEvents/byId/" + donationId + ".json", {
      eventId: donationId,
      type: "donation",
      seasonId: "ranked-legend-i-2026-05-18",
    }],
  ]);
  const { loadCurrentSeasonEventsViaFirebasePublic } = loadClientInternals({
    window: { ROSTER_FIREBASE_DB_URL: "https://firebase.test" },
    context: {
      fetch: async (url) => ({
        ok: responses.has(url),
        status: responses.has(url) ? 200 : 404,
        text: async () => JSON.stringify(responses.get(url)),
      }),
    },
  });

  const loaded = await loadCurrentSeasonEventsViaFirebasePublic();

  assert.equal(loaded.current.push.eventId, pushId);
  assert.equal(loaded.byId[pushId].participantsByTag["#2LUCULP"].tag, "#2LUCULP");
  assert.equal(loaded.loadErrors.length, 0);
});

test("loads previous season event payloads directly from public Firebase bySeason", async () => {
  const previousSeasonId = "ranked-legend-i-2026-05-18";
  const pushId = "push-ranked-legend-i-2026-05-18";
  const donationId = "donation-ranked-legend-i-2026-05-18";
  const responses = new Map([
    ["https://firebase.test/events/seasonEvents/bySeason/" + previousSeasonId + ".json", {
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
    ["https://firebase.test/events/seasonEvents/byId/" + pushId + ".json", {
      eventId: pushId,
      type: "push",
      seasonId: previousSeasonId,
      status: "archived",
    }],
    ["https://firebase.test/events/seasonEvents/byId/" + donationId + ".json", {
      eventId: donationId,
      type: "donation",
      seasonId: previousSeasonId,
      status: "archived",
    }],
  ]);
  const requested = [];
  const { loadPreviousSeasonEventsViaFirebasePublic } = loadClientInternals({
    window: { ROSTER_FIREBASE_DB_URL: "https://firebase.test" },
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

  const loaded = await loadPreviousSeasonEventsViaFirebasePublic({
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
  assert.equal(requested.includes("https://firebase.test/events/seasonEvents/bySeason/" + previousSeasonId + ".json"), true);
});

test("loads published active version shards before falling back to legacy active", async () => {
  const encodedTagKey = "__FB64__" + Buffer.from("#PLAYER", "utf8").toString("base64url");
  const responses = new Map([
    ["https://firebase.test/activePublished/currentVersionId.json", "version-1"],
    ["https://firebase.test/activeVersions/version-1/manifest.json", {
      versionId: "version-1",
      schemaVersion: 1,
      pageTitle: "Versioned Roster",
      rosterOrder: ["main"],
      rosterIds: ["main"],
      lastUpdatedAt: "2026-05-25T00:00:00.000Z",
    }],
    ["https://firebase.test/activeVersions/version-1/rosters.json", {
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
    ["https://firebase.test/activeVersions/version-1/playerMetrics.json", {
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
    ["https://firebase.test/events/seasonEvents/current.json", null],
    ["https://firebase.test/events/seasonEvents/seasonState/current.json", null],
    ["https://firebase.test/active.json", {
      schemaVersion: 1,
      pageTitle: "Legacy Active",
      rosterOrder: [],
      rosters: [],
      playerMetrics: { schemaVersion: 1, updatedAt: "", byTag: {} },
    }],
  ]);
  const requested = [];
  const { loadRosterDataViaFirebasePublic } = loadClientInternals({
    window: { ROSTER_FIREBASE_DB_URL: "https://firebase.test" },
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

  const loaded = await loadRosterDataViaFirebasePublic();

  assert.equal(loaded.data.pageTitle, "Versioned Roster");
  assert.equal(loaded.data.rosters[0].id, "main");
  assert.equal(loaded.data.playerMetrics.byTag["#PLAYER"].latestSnapshot.trophies, 5000);
  assert.equal(requested.includes("https://firebase.test/active.json"), false);
});

test("reuses cached roster and player metrics when active published version is unchanged", async () => {
  const responses = new Map([
    ["https://firebase.test/activePublished/currentVersionId.json", "version-1"],
    ["https://firebase.test/events/seasonEvents/current.json", null],
    ["https://firebase.test/events/seasonEvents/seasonState/current.json", null],
  ]);
  const requested = [];
  const { loadRosterDataViaFirebasePublic } = loadClientInternals({
    window: { ROSTER_FIREBASE_DB_URL: "https://firebase.test" },
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

  const loaded = await loadRosterDataViaFirebasePublic({
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

  assert.equal(loaded.source, "firebase-public-cached-active-version");
  assert.equal(loaded.activeVersionId, "version-1");
  assert.equal(loaded.data.pageTitle, "Cached Version");
  assert.equal(loaded.data.playerMetrics.byTag["#PLAYER"].latestSnapshot.trophies, 5000);
  assert.equal(requested.includes("https://firebase.test/activeVersions/version-1/rosters.json"), false);
  assert.equal(requested.includes("https://firebase.test/activeVersions/version-1/playerMetrics.json"), false);
  assert.equal(requested.includes("https://firebase.test/active.json"), false);
});

test("uses IndexedDB cached snapshot when localStorage cannot store the full active payload", async () => {
  const responses = new Map([
    ["https://firebase.test/activePublished/currentVersionId.json", "version-1"],
    ["https://firebase.test/events/seasonEvents/current.json", null],
    ["https://firebase.test/events/seasonEvents/seasonState/current.json", null],
  ]);
  const requested = [];
  const internals = loadClientInternals({
    window: {
      ROSTER_FIREBASE_DB_URL: "https://firebase.test",
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
    await internals.writeCachedRosterSnapshot(cachedData, "firebase-public", {
      activeVersionId: "version-1",
    }),
    true,
  );
  assert.equal(internals.readCachedRosterSnapshot(), null);

  const durableSnapshot = await internals.readDurableCachedRosterSnapshot();
  assert.equal(durableSnapshot.activeVersionId, "version-1");
  assert.equal(durableSnapshot.cacheSource, "IndexedDB");

  const loaded = await internals.loadRosterDataViaFirebasePublic({
    cachedSnapshot: durableSnapshot,
  });

  assert.equal(loaded.source, "firebase-public-cached-active-version");
  assert.equal(loaded.data.pageTitle, "IndexedDB Cached Version");
  assert.equal(requested.includes("https://firebase.test/activeVersions/version-1/rosters.json"), false);
  assert.equal(requested.includes("https://firebase.test/activeVersions/version-1/playerMetrics.json"), false);
  assert.equal(requested.includes("https://firebase.test/active.json"), false);
});

test("downloads active version shards when cached active published version is stale", async () => {
  const responses = new Map([
    ["https://firebase.test/activePublished/currentVersionId.json", "version-2"],
    ["https://firebase.test/activeVersions/version-2/manifest.json", {
      versionId: "version-2",
      schemaVersion: 1,
      pageTitle: "Fresh Version",
      rosterOrder: ["main"],
      rosterIds: ["main"],
      lastUpdatedAt: "2026-05-26T00:00:00.000Z",
    }],
    ["https://firebase.test/activeVersions/version-2/rosters.json", {
      main: {
        id: "main",
        title: "Fresh Main",
        main: [],
        subs: [],
        missing: [],
      },
    }],
    ["https://firebase.test/activeVersions/version-2/playerMetrics.json", {
      schemaVersion: 1,
      updatedAt: "2026-05-26T00:00:00.000Z",
      byTag: {},
    }],
    ["https://firebase.test/events/seasonEvents/current.json", null],
    ["https://firebase.test/events/seasonEvents/seasonState/current.json", null],
  ]);
  const requested = [];
  const { loadRosterDataViaFirebasePublic } = loadClientInternals({
    window: { ROSTER_FIREBASE_DB_URL: "https://firebase.test" },
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

  const loaded = await loadRosterDataViaFirebasePublic({
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

  assert.equal(loaded.source, "firebase-public");
  assert.equal(loaded.activeVersionId, "version-2");
  assert.equal(loaded.data.pageTitle, "Fresh Version");
  assert.equal(requested.includes("https://firebase.test/activeVersions/version-2/rosters.json"), true);
  assert.equal(requested.includes("https://firebase.test/activeVersions/version-2/playerMetrics.json"), true);
  assert.equal(requested.includes("https://firebase.test/active.json"), false);
});

test("season events model renders unavailable and empty states safely", () => {
  const { buildSeasonEventsPublicModel } = loadClientInternals();
  const empty = buildSeasonEventsPublicModel({});

  assert.equal(empty.cards.length, 2);
  assert.equal(empty.cards[0].unavailable, true);
  assert.equal(empty.cards[0].rows.length, 0);

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
