import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import { TextDecoder } from "node:util";
import vm from "node:vm";

const repoRoot = new URL("../", import.meta.url);

const loadWorker = () => {
  const source = fs
    .readFileSync(new URL("cloudflarePages/worker-core.js", repoRoot), "utf8")
    .replace(/export\s+default\s+\{/, "globalThis.workerDefault = {")
    .replace(
      /export\s+\{\s*CloudflarePublicationCoordinator\s*\};?/,
      "globalThis.workerCoordinatorClass = CloudflarePublicationCoordinator;",
    );
  const context = {
    URL,
    Request,
    Response,
    Headers,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    crypto: webcrypto,
    console,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  context.workerDefault.__Coordinator = context.workerCoordinatorClass;
  return context.workerDefault;
};

const createObservedKv = (entriesRaw = {}) => {
  const values = new Map(Object.entries(entriesRaw));
  const metadata = new Map();
  const reads = [];
  const puts = [];
  const deletes = [];
  return {
    values,
    reads,
    puts,
    deletes,
    async get(key) {
      reads.push(key);
      return values.has(key) ? values.get(key) : null;
    },
    async getWithMetadata(key) {
      reads.push(key);
      if (!values.has(key)) return { value: null, metadata: null };
      return {
        value: values.get(key),
        metadata: metadata.get(key) || {
          etag: `"etag-${key}"`,
          contentType: "application/json; charset=utf-8",
        },
      };
    },
    async put(key, value, options) {
      puts.push({ key, value: String(value), options });
      values.set(key, String(value));
      metadata.set(key, options && options.metadata || {});
    },
    async delete(key) {
      deletes.push(key);
      values.delete(key);
      metadata.delete(key);
    },
    async list({ prefix = "", cursor = "", limit = 1000 } = {}) {
      const keys = Array.from(values.keys())
        .filter((key) => key.startsWith(prefix))
        .sort()
        .slice(0, limit)
        .map((name) => ({ name }));
      return { keys, cursor, list_complete: true };
    },
  };
};

const botHeaders = { authorization: "Bearer bot-secret" };
const encodeFirebaseFixtureKey = (value) => `__FB64__${Buffer.from(String(value), "utf8").toString("base64url")}`;

const readBotJson = async (worker, env, path) => {
  const response = await worker.fetch(
    new Request(`https://worker.test/api/bot-data/${path.replace(/^\/+/, "")}`, {
      headers: botHeaders,
    }),
    env,
    {},
  );
  const payload = await response.json();
  return { response, payload };
};

const makeGenerationEntries = (versionId, optionsRaw = {}) => {
  const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
  const roster = options.roster || {
    id: "main",
    main: [{ tag: `#${versionId.toUpperCase()}` }],
    subs: [],
    missing: [],
  };
  const byTag = options.byTag || {
    [`#${versionId.toUpperCase()}`]: {
      identity: { tag: `#${versionId.toUpperCase()}`, name: versionId },
    },
  };
  const manifest = {
    schemaVersion: 1,
    versionId,
    pageTitle: `Roster ${versionId}`,
    rosterIds: ["main"],
    rosterOrder: ["main"],
    lastUpdatedAt: `2026-07-19T${versionId === "current" ? "19" : "18"}:00:00.000Z`,
    publicConfig: { source: versionId },
  };
  const metrics = {
    schemaVersion: 1,
    updatedAt: manifest.lastUpdatedAt,
    byTag,
  };
  const byDiscordId = options.byDiscordId || {
    [`discord-${versionId}`]: [{ tag: Object.keys(byTag)[0], matchType: "discordId" }],
  };
  const byDiscordUsername = options.byDiscordUsername || {};
  const base = `activeVersions/${versionId}`;
  const entries = {
    [`public-data/${base}/manifest.json`]: JSON.stringify(manifest),
    [`public-data/${base}/rosters.json`]: JSON.stringify({ main: roster }),
    [`public-data/${base}/playerMetrics.json`]: JSON.stringify(metrics),
    [`bot-data/${base}/indexes/linkedAccountsByDiscordId.json`]: JSON.stringify(byDiscordId),
    [`bot-data/${base}/indexes/linkedAccountsByDiscordUsername.json`]: JSON.stringify(byDiscordUsername),
  };
  for (const missingPath of options.missingPaths || []) {
    delete entries[missingPath];
  }
  return { entries, manifest, roster, metrics, byTag, byDiscordId, byDiscordUsername };
};

test("public active shards and private indexes project the authenticated bot contracts without duplicate bot shards", async () => {
  const worker = loadWorker();
  const rosterId = "main.roster";
  const generation = makeGenerationEntries("current", {
    roster: {
      id: rosterId,
      main: [{ tag: "#CURRENT" }],
      subs: [],
      missing: [],
    },
  });
  generation.manifest.rosterIds = [rosterId];
  generation.manifest.rosterOrder = [rosterId];
  generation.entries["public-data/activeVersions/current/manifest.json"] = JSON.stringify(generation.manifest);
  generation.entries["public-data/activeVersions/current/rosters.json"] = JSON.stringify({
    [encodeFirebaseFixtureKey(rosterId)]: generation.roster,
  });
  const kv = createObservedKv({
    "public-data/activePublished/currentSelector.json": JSON.stringify({
      schemaVersion: 1,
      currentVersionId: "current",
      previousVersionId: "",
      generation: 20,
      committedAt: "2026-07-19T19:00:00.000Z",
    }),
    ...generation.entries,
  });
  const env = { ROSTER_BOT_SECRET: "bot-secret", ROSTER_DATA_KV: kv };

  const active = await readBotJson(worker, env, "active.json");
  const metrics = await readBotJson(worker, env, "active/playerMetrics/byTag.json");
  const pointer = await readBotJson(worker, env, "active/currentVersionId.json");
  const index = await readBotJson(worker, env, "indexes/linkedAccountsByDiscordId.json");

  assert.equal(active.response.status, 200);
  assert.equal(active.response.headers.get("cache-control"), "private, max-age=30");
  assert.equal(active.response.headers.has("access-control-allow-origin"), false);
  assert.equal(active.payload.activeVersionId, "current");
  assert.equal(active.payload.schemaVersion, generation.manifest.schemaVersion);
  assert.equal(active.payload.pageTitle, generation.manifest.pageTitle);
  assert.deepEqual(active.payload.rosterOrder, generation.manifest.rosterOrder);
  assert.deepEqual(active.payload.rosters, [generation.roster]);
  assert.deepEqual(active.payload.playerMetrics, generation.metrics);
  assert.equal(metrics.response.status, 200);
  assert.deepEqual(metrics.payload, generation.byTag);
  assert.equal(pointer.response.status, 200);
  assert.equal(pointer.payload, "current");
  assert.equal(index.response.status, 200);
  assert.deepEqual(index.payload, generation.byDiscordId);

  const forbiddenDuplicateReads = kv.reads.filter((key) =>
    /^bot-data\/activeVersions\/current\/(active|rosters|playerMetrics(?:\/|\.json))/.test(key),
  );
  assert.deepEqual(forbiddenDuplicateReads, []);
});

test("all authenticated bot active routes fall back to the same complete previous virtual generation", async () => {
  const worker = loadWorker();
  const current = makeGenerationEntries("current", {
    missingPaths: [
      "bot-data/activeVersions/current/indexes/linkedAccountsByDiscordUsername.json",
    ],
  });
  const previous = makeGenerationEntries("previous");
  const kv = createObservedKv({
    "public-data/activePublished/currentSelector.json": JSON.stringify({
      schemaVersion: 1,
      currentVersionId: "current",
      previousVersionId: "previous",
      generation: 21,
      committedAt: "2026-07-19T19:05:00.000Z",
    }),
    ...current.entries,
    ...previous.entries,
  });
  const env = { ROSTER_BOT_SECRET: "bot-secret", ROSTER_DATA_KV: kv };

  const active = await readBotJson(worker, env, "active.json");
  const metrics = await readBotJson(worker, env, "active/playerMetrics/byTag.json");
  const pointer = await readBotJson(worker, env, "active/currentVersionId.json");
  const idIndex = await readBotJson(worker, env, "indexes/linkedAccountsByDiscordId.json");
  const usernameIndex = await readBotJson(worker, env, "indexes/linkedAccountsByDiscordUsername.json");

  assert.equal(active.response.status, 200);
  assert.equal(active.payload.activeVersionId, "previous");
  assert.deepEqual(active.payload.rosters, [previous.roster]);
  assert.deepEqual(active.payload.playerMetrics, previous.metrics);
  assert.deepEqual(metrics.payload, previous.byTag);
  assert.equal(pointer.payload, "previous");
  assert.deepEqual(idIndex.payload, previous.byDiscordId);
  assert.deepEqual(usernameIndex.payload, previous.byDiscordUsername);
});

test("a present but incomplete public roster shard falls back to the previous bot projection", async () => {
  const worker = loadWorker();
  const current = makeGenerationEntries("current");
  const previous = makeGenerationEntries("previous");
  current.entries["public-data/activeVersions/current/rosters.json"] = JSON.stringify({});
  const kv = createObservedKv({
    "public-data/activePublished/currentSelector.json": JSON.stringify({
      schemaVersion: 1,
      currentVersionId: "current",
      previousVersionId: "previous",
      generation: 22,
      committedAt: "2026-07-19T19:06:00.000Z",
    }),
    ...current.entries,
    ...previous.entries,
  });
  const env = { ROSTER_BOT_SECRET: "bot-secret", ROSTER_DATA_KV: kv };

  const active = await readBotJson(worker, env, "active.json");
  const metrics = await readBotJson(worker, env, "active/playerMetrics/byTag.json");
  const pointer = await readBotJson(worker, env, "active/currentVersionId.json");
  const idIndex = await readBotJson(worker, env, "indexes/linkedAccountsByDiscordId.json");
  const usernameIndex = await readBotJson(worker, env, "indexes/linkedAccountsByDiscordUsername.json");

  assert.equal(active.response.status, 200);
  assert.equal(active.payload.activeVersionId, "previous");
  assert.deepEqual(active.payload.rosters, [previous.roster]);
  assert.deepEqual(metrics.payload, previous.byTag);
  assert.equal(pointer.payload, "previous");
  assert.deepEqual(idIndex.payload, previous.byDiscordId);
  assert.deepEqual(usernameIndex.payload, previous.byDiscordUsername);
});

test("allowlisted bot event and donation reads use the one canonical public object", async () => {
  const worker = loadWorker();
  const canonicalEvent = { donation: { eventId: "canonical-event" } };
  const canonicalDonation = { seasonId: "season-1", byTag: { encoded: { donations: 42 } } };
  const kv = createObservedKv({
    "public-data/activePublished/currentSelector.json": JSON.stringify({
      currentVersionId: "not-needed-for-canonical-read",
      previousVersionId: "",
    }),
    "public-data/events/seasonEvents/current.json": JSON.stringify(canonicalEvent),
    "bot-data/events/seasonEvents/current.json": JSON.stringify({ stale: true }),
    "public-data/donationRefresh/bySeason/season-1.json": JSON.stringify(canonicalDonation),
    "bot-data/donationRefresh/bySeason/season-1.json": JSON.stringify({ stale: true }),
  });
  const env = { ROSTER_BOT_SECRET: "bot-secret", ROSTER_DATA_KV: kv };

  const event = await readBotJson(worker, env, "events/seasonEvents/current.json");
  const donation = await readBotJson(worker, env, "donationRefresh/bySeason/season-1.json");

  assert.equal(event.response.status, 200);
  assert.deepEqual(event.payload, canonicalEvent);
  assert.equal(donation.response.status, 200);
  assert.deepEqual(donation.payload, canonicalDonation);
  for (const result of [event, donation]) {
    assert.equal(result.response.headers.get("cache-control"), "private, max-age=30");
    assert.equal(result.response.headers.has("access-control-allow-origin"), false);
  }
  assert.equal(kv.reads.includes("public-data/events/seasonEvents/current.json"), true);
  assert.equal(kv.reads.includes("public-data/donationRefresh/bySeason/season-1.json"), true);
  assert.equal(kv.reads.includes("bot-data/events/seasonEvents/current.json"), false);
  assert.equal(kv.reads.includes("bot-data/donationRefresh/bySeason/season-1.json"), false);
});

test("bot-only CWL signups remain exact bot data even when a shared selector exists", async () => {
  const worker = loadWorker();
  const signups = { schemaVersion: 1, entries: [{ tag: "#PLAYER", league: "crystal-2" }] };
  const kv = createObservedKv({
    "public-data/activePublished/currentSelector.json": JSON.stringify({
      currentVersionId: "not-propagated",
      previousVersionId: "",
    }),
    "bot-data/active/cwlLeagueSignups.json": JSON.stringify(signups),
    "public-data/active/cwlLeagueSignups.json": JSON.stringify({ leaked: true }),
  });
  const env = { ROSTER_BOT_SECRET: "bot-secret", ROSTER_DATA_KV: kv };

  const result = await readBotJson(worker, env, "active/cwlLeagueSignups.json");

  assert.equal(result.response.status, 200);
  assert.deepEqual(result.payload, signups);
  assert.equal(kv.reads.includes("bot-data/active/cwlLeagueSignups.json"), true);
  assert.equal(kv.reads.includes("public-data/active/cwlLeagueSignups.json"), false);
});

test("an arbitrary authenticated bot path never substitutes the matching public object", async () => {
  const worker = loadWorker();
  const kv = createObservedKv({
    "public-data/activePublished/currentSelector.json": JSON.stringify({
      currentVersionId: "not-propagated",
      previousVersionId: "",
    }),
    "public-data/private/internalState.json": JSON.stringify({ mustNotLeak: true }),
  });
  const env = { ROSTER_BOT_SECRET: "bot-secret", ROSTER_DATA_KV: kv };

  const result = await readBotJson(worker, env, "private/internalState.json");

  assert.equal(result.response.status, 404);
  assert.equal(result.payload.error, "Data object not found.");
  assert.equal(kv.reads.includes("public-data/private/internalState.json"), false);
});

test("publish-v2 canonicalizes public-safe mirrors and virtualizes duplicate bot active objects", async () => {
  const worker = loadWorker();
  const versionId = "quota-v1";
  const event = { push: { eventId: "push-1" } };
  const donation = { seasonId: "season-1", byTag: {} };
  const roster = { id: "main", main: [], subs: [], missing: [] };
  const byTag = {
    encodedPlayer: {
      identity: { tag: "#PLAYER", name: "Player", discordId: "discord-1" },
      latestSnapshot: { tag: "#PLAYER", name: "Player", townHallLevel: 16 },
    },
  };
  const metrics = { schemaVersion: 1, updatedAt: "2026-07-19T19:00:00.000Z", byTag };
  const objects = [
    { scope: "public", path: "events/seasonEvents/current", payload: event },
    { scope: "bot", path: "events/seasonEvents/current", payload: event },
    { scope: "public", path: "donationRefresh/current", payload: donation },
    { scope: "bot", path: "donationRefresh/current", payload: donation },
    { scope: "public", path: `activeVersions/${versionId}/manifest`, payload: { versionId, rosterIds: ["main"] } },
    { scope: "public", path: `activeVersions/${versionId}/rosters`, payload: { main: roster } },
    { scope: "public", path: `activeVersions/${versionId}/playerMetrics`, payload: metrics },
    { scope: "bot", path: `activeVersions/${versionId}/active`, payload: { activeVersionId: versionId, shardedActive: true } },
    { scope: "bot", path: `activeVersions/${versionId}/rosters`, payload: [roster] },
    { scope: "bot", path: `activeVersions/${versionId}/playerMetrics/meta`, payload: { schemaVersion: 1 } },
    { scope: "bot", path: `activeVersions/${versionId}/playerMetrics/byTag`, payload: byTag },
  ];
  const deletes = [
    { scope: "public", path: "events/seasonEvents/latestCompletedCwl" },
    { scope: "bot", path: "events/seasonEvents/latestCompletedCwl" },
  ];
  const kv = createObservedKv();
  const env = {
    ROSTER_PUBLIC_DATA_PUBLISH_SECRET: "publish-secret",
    ROSTER_DATA_KV: kv,
  };
  const response = await worker.fetch(
    new Request("https://worker.test/api/internal/public-data/publish-v2", {
      method: "POST",
      headers: {
        authorization: "Bearer publish-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        requestId: "quota-collapse",
        batchId: "quota-collapse",
        publishedAt: "2026-07-19T19:00:00.000Z",
        objects,
        deletes,
        derivations: [{ kind: "bot-player-metrics", versionId }],
      }),
    }),
    env,
    {},
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.objectCount, objects.length);
  assert.equal(payload.completedObjectCount, objects.length);
  assert.equal(payload.deleteCount, deletes.length);
  assert.equal(payload.completedDeleteCount, deletes.length);
  assert.equal(payload.derivationCount, 1);
  assert.equal(payload.completedDerivationCount, 1);

  const putKeys = kv.puts.map((entry) => entry.key).sort();
  assert.deepEqual(putKeys, [
    `bot-data/activeVersions/${versionId}/indexes/linkedAccountsByDiscordId.json`,
    `bot-data/activeVersions/${versionId}/indexes/linkedAccountsByDiscordUsername.json`,
    `public-data/activeVersions/${versionId}/manifest.json`,
    `public-data/activeVersions/${versionId}/playerMetrics.json`,
    `public-data/activeVersions/${versionId}/rosters.json`,
    "public-data/donationRefresh/current.json",
    "public-data/events/seasonEvents/current.json",
  ].sort());
  assert.deepEqual(kv.deletes, ["public-data/events/seasonEvents/latestCompletedCwl.json"]);
  assert.deepEqual(payload.mutationCounts && {
    actualPutCount: payload.mutationCounts.actualPutCount,
    actualDeleteCount: payload.mutationCounts.actualDeleteCount,
  }, {
    actualPutCount: 7,
    actualDeleteCount: 1,
  });
  assert.ok(payload.mutationCounts.requestedPutCount > payload.mutationCounts.actualPutCount);
  assert.ok(payload.mutationCounts.requestedDeleteCount > payload.mutationCounts.actualDeleteCount);
  assert.ok(payload.mutationCounts.canonicalizedCount >= 3);
  assert.ok(payload.mutationCounts.virtualizedCount >= 4);
});

test("publish-v2 rejects conflicting public and canonicalized bot payloads before any KV mutation", async () => {
  const worker = loadWorker();
  const kv = createObservedKv();
  const env = {
    ROSTER_PUBLIC_DATA_PUBLISH_SECRET: "publish-secret",
    ROSTER_DATA_KV: kv,
  };
  const response = await worker.fetch(
    new Request("https://worker.test/api/internal/public-data/publish-v2", {
      method: "POST",
      headers: {
        authorization: "Bearer publish-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        requestId: "conflicting-canonical-payloads",
        batchId: "conflicting-canonical-payloads",
        objects: [
          {
            scope: "public",
            path: "events/seasonEvents/current",
            payload: { source: "canonical-public" },
          },
          {
            scope: "bot",
            path: "events/seasonEvents/current",
            payload: { source: "conflicting-bot-mirror" },
          },
        ],
      }),
    }),
    env,
    {},
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /conflicting publication operations/i);
  assert.equal(kv.puts.length, 0);
  assert.equal(kv.deletes.length, 0);
  assert.equal(kv.values.size, 0);
});

test("a partial derived-index failure reports every KV mutation already completed", async () => {
  const worker = loadWorker();
  const kv = createObservedKv();
  const originalPut = kv.put.bind(kv);
  kv.put = async (key, value, options) => {
    if (key.endsWith("indexes/linkedAccountsByDiscordUsername.json")) {
      throw new Error("simulated derived index failure");
    }
    return originalPut(key, value, options);
  };
  const versionId = "accounting-v1";
  const metrics = {
    byTag: {
      encodedPlayer: {
        identity: { tag: "#PLAYER", discordId: "discord-1", discordUsername: "Player" },
      },
    },
  };
  const env = {
    ROSTER_PUBLIC_DATA_PUBLISH_SECRET: "publish-secret",
    ROSTER_DATA_KV: kv,
  };
  const response = await worker.fetch(
    new Request("https://worker.test/api/internal/public-data/publish-v2", {
      method: "POST",
      headers: {
        authorization: "Bearer publish-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        requestId: "derived-accounting",
        batchId: "derived-accounting",
        objects: [{ scope: "public", path: `activeVersions/${versionId}/playerMetrics`, payload: metrics }],
        derivations: [{ kind: "bot-player-metrics", versionId }],
      }),
    }),
    env,
    {},
  );
  const payload = await response.json();

  assert.equal(response.status, 502);
  assert.equal(payload.mutationCounts.actualPutCount, 2);
  assert.equal(payload.mutationCounts.actualDeleteCount, 0);
  assert.equal(kv.puts.length, 2);
});

test("a partial retention failure reports completed KV deletes", async () => {
  const worker = loadWorker();
  const kv = createObservedKv({
    "public-data/activePublished/currentSelector.json": JSON.stringify({
      currentVersionId: "current",
      previousVersionId: "previous",
    }),
    "public-data/activeVersions/obsolete/manifest.json": JSON.stringify({ versionId: "obsolete" }),
    "public-data/activeVersions/obsolete/rosters.json": JSON.stringify({}),
  });
  const originalDelete = kv.delete.bind(kv);
  kv.delete = async (key) => {
    if (key.endsWith("/rosters.json")) throw new Error("simulated retention failure");
    return originalDelete(key);
  };
  const env = {
    ROSTER_PUBLIC_DATA_PUBLISH_SECRET: "publish-secret",
    ROSTER_DATA_KV: kv,
  };
  const response = await worker.fetch(
    new Request("https://worker.test/api/internal/public-data/publish-v2", {
      method: "POST",
      headers: {
        authorization: "Bearer publish-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        requestId: "retention-accounting",
        batchId: "retention-accounting",
        retention: { cursor: "", limit: 100 },
      }),
    }),
    env,
    {},
  );
  const payload = await response.json();

  assert.equal(response.status, 503);
  assert.equal(payload.mutationCounts.actualPutCount, 0);
  assert.equal(payload.mutationCounts.actualDeleteCount, 1);
  assert.equal(kv.deletes.length, 1);
});

test("an exact successful Durable Object batch replay reports replay and performs no second KV mutation", async () => {
  const worker = loadWorker();
  const kv = createObservedKv({
    "public-data/quota/delete-once.json": JSON.stringify({ old: true }),
  });
  const durableValues = new Map();
  const durableState = {
    storage: {
      async get(key) {
        return durableValues.get(key);
      },
      async put(key, value) {
        durableValues.set(key, value);
      },
    },
  };
  const coordinator = new worker.__Coordinator(durableState, { ROSTER_DATA_KV: kv });
  const coordinatorStub = { fetch: (request) => coordinator.fetch(request) };
  const env = {
    ROSTER_PUBLIC_DATA_PUBLISH_SECRET: "publish-secret",
    ROSTER_DATA_KV: kv,
    CLOUDFLARE_PUBLICATION_COORDINATOR: {
      idFromName: (name) => name,
      get: () => coordinatorStub,
    },
  };
  const body = {
    requestId: "exact-replay",
    batchId: "exact-replay",
    publishedAt: "2026-07-19T19:10:00.000Z",
    dispatchGuard: { generation: 31, batchId: "exact-replay" },
    objects: [{ scope: "public", path: "quota/put-once", payload: { ok: true } }],
    deletes: [{ scope: "public", path: "quota/delete-once" }],
  };
  const makeRequest = () => new Request("https://worker.test/api/internal/public-data/publish-v2", {
    method: "POST",
    headers: {
      authorization: "Bearer publish-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const firstResponse = await worker.fetch(makeRequest(), env, {});
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 200);
  assert.equal(first.ok, true);
  assert.equal(first.mutationCounts.actualPutCount, 1);
  assert.equal(first.mutationCounts.actualDeleteCount, 1);
  const putsAfterFirst = kv.puts.length;
  const deletesAfterFirst = kv.deletes.length;

  const replayResponse = await worker.fetch(makeRequest(), env, {});
  const replay = await replayResponse.json();
  assert.equal(replayResponse.status, 200);
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.objectCount, first.objectCount);
  assert.equal(replay.completedObjectCount, first.completedObjectCount);
  assert.equal(replay.deleteCount, first.deleteCount);
  assert.equal(replay.completedDeleteCount, first.completedDeleteCount);
  assert.equal(replay.mutationCounts.requestedPutCount, first.mutationCounts.requestedPutCount);
  assert.equal(replay.mutationCounts.requestedDeleteCount, first.mutationCounts.requestedDeleteCount);
  assert.equal(replay.mutationCounts.actualPutCount, 0);
  assert.equal(replay.mutationCounts.actualDeleteCount, 0);
  assert.equal(kv.puts.length, putsAfterFirst);
  assert.equal(kv.deletes.length, deletesAfterFirst);
});

test("Durable Object replay survives request metadata changes, recreation, and a newer accepted generation", async () => {
  const worker = loadWorker();
  const oldVersionId = "history-v1";
  const kv = createObservedKv({
    "public-data/activePublished/currentSelector.json": JSON.stringify({
      schemaVersion: 1,
      currentVersionId: "keep-current",
      previousVersionId: "keep-previous",
      generation: 40,
    }),
  });
  const durableValues = new Map();
  const durableState = {
    storage: {
      async get(key) {
        return durableValues.get(key);
      },
      async put(key, value) {
        durableValues.set(key, value);
      },
    },
  };
  let coordinator = new worker.__Coordinator(durableState, { ROSTER_DATA_KV: kv });
  const env = {
    ROSTER_PUBLIC_DATA_PUBLISH_SECRET: "publish-secret",
    ROSTER_DATA_KV: kv,
    CLOUDFLARE_PUBLICATION_COORDINATOR: {
      idFromName: (name) => name,
      get: () => ({ fetch: (request) => coordinator.fetch(request) }),
    },
  };
  const oldBody = {
    requestId: "history-first-attempt",
    batchId: "history-batch-v1",
    publishedAt: "2026-07-19T19:20:00.000Z",
    dispatchGuard: { generation: 41, batchId: "history-batch-v1" },
    objects: [{
      scope: "public",
      path: `activeVersions/${oldVersionId}/playerMetrics`,
      payload: {
        schemaVersion: 1,
        byTag: {
          encodedPlayer: {
            identity: { tag: "#PLAYER", name: "Player", discordId: "discord-1" },
          },
        },
      },
    }],
    derivations: [{ kind: "bot-player-metrics", versionId: oldVersionId }],
    retention: { cursor: "", limit: 100, preserveVersionIds: [oldVersionId] },
    commitGuard: { generation: 41, targetVersionId: oldVersionId },
    commits: [{
      scope: "public",
      path: "activePublished/currentSelector",
      payload: {
        schemaVersion: 1,
        currentVersionId: oldVersionId,
        previousVersionId: "keep-current",
        generation: 41,
      },
    }],
  };
  const publish = async (body) => {
    const response = await worker.fetch(
      new Request("https://worker.test/api/internal/public-data/publish-v2", {
        method: "POST",
        headers: {
          authorization: "Bearer publish-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      env,
      {},
    );
    return { response, payload: await response.json() };
  };

  const first = await publish(oldBody);
  assert.equal(first.response.status, 200);
  assert.equal(first.payload.ok, true);
  assert.equal(first.payload.completedDerivationCount, 1);
  assert.equal(first.payload.completedDerivedObjectCount, 2);
  assert.equal(first.payload.retention.done, false);
  assert.ok(first.payload.retention.cursor);
  assert.deepEqual(first.payload.acceptedCommit, {
    schemaVersion: 1,
    generation: 41,
    targetVersionId: oldVersionId,
    committedAt: oldBody.publishedAt,
  });

  // Recreate the coordinator around the same durable storage to prove replay
  // identity is persisted rather than held in the instance's promise tail.
  coordinator = new worker.__Coordinator(durableState, { ROSTER_DATA_KV: kv });
  const newer = await publish({
    requestId: "history-newer-generation",
    batchId: "history-batch-v2",
    publishedAt: "2026-07-19T19:21:00.000Z",
    dispatchGuard: { generation: 42, batchId: "history-batch-v2" },
    objects: [{ scope: "public", path: "quota/history-newer", payload: { generation: 42 } }],
  });
  assert.equal(newer.response.status, 200);
  assert.equal(newer.payload.ok, true);

  const putsAfterNewerGeneration = kv.puts.length;
  const deletesAfterNewerGeneration = kv.deletes.length;
  coordinator = new worker.__Coordinator(durableState, { ROSTER_DATA_KV: kv });
  const replay = await publish({
    ...oldBody,
    requestId: "history-retry-with-new-request-id",
    publishedAt: "2026-07-19T19:22:00.000Z",
  });

  assert.equal(replay.response.status, 200, "completed history must be checked before stale-generation rejection");
  assert.equal(replay.payload.ok, true);
  assert.equal(replay.payload.replayed, true);
  assert.equal(replay.payload.requestId, first.payload.requestId);
  assert.equal(replay.payload.publishedAt, first.payload.publishedAt);
  assert.equal(replay.payload.completedDerivationCount, first.payload.completedDerivationCount);
  assert.equal(replay.payload.completedDerivedObjectCount, first.payload.completedDerivedObjectCount);
  assert.deepEqual(replay.payload.retention, first.payload.retention);
  assert.deepEqual(replay.payload.acceptedCommit, first.payload.acceptedCommit);
  assert.equal(replay.payload.mutationCounts.actualPutCount, 0);
  assert.equal(replay.payload.mutationCounts.actualDeleteCount, 0);
  assert.equal(replay.payload.mutationCounts.internalPutCount, 0);
  assert.equal(kv.puts.length, putsAfterNewerGeneration);
  assert.equal(kv.deletes.length, deletesAfterNewerGeneration);
});
