import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { TextDecoder } from "node:util";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const repoRoot = new URL("../", import.meta.url);

const loadWorker = () => {
  const source = fs
    .readFileSync(new URL("cloudflarePages/worker-core.js", repoRoot), "utf8")
    .replace(/export\s+default\s+\{/, "globalThis.workerDefault = {")
    .replace(/export\s+\{\s*CloudflarePublicationCoordinator\s*\};?/, "");
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
  return context.workerDefault;
};

const createKv = (entriesRaw) => {
  const entries = new Map(Object.entries(entriesRaw || {}));
  return {
    async get(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    async getWithMetadata(key) {
      if (!entries.has(key)) return { value: null, metadata: null };
      return {
        value: entries.get(key),
        metadata: {
          etag: `"etag-${key}"`,
          contentType: "application/json; charset=utf-8",
        },
      };
    },
  };
};

const createObservedKv = (entriesRaw, optionsRaw = {}) => {
  const entries = new Map(Object.entries(entriesRaw || {}));
  const reads = [];
  const delayMs = Math.max(0, Number(optionsRaw.delayMs) || 0);
  return {
    reads,
    async get(key) {
      reads.push(key);
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return entries.has(key) ? entries.get(key) : null;
    },
    async getWithMetadata(key) {
      reads.push(key);
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (!entries.has(key)) return { value: null, metadata: null };
      return {
        value: entries.get(key),
        metadata: {
          etag: `"etag-${key}"`,
          contentType: "application/json; charset=utf-8",
        },
      };
    },
  };
};

test("bot data route reads bot-scoped event data", async () => {
  const worker = loadWorker();
  const env = {
    ROSTER_BOT_SECRET: "secret",
    ROSTER_DATA_KV: createKv({
      "bot-data/events/seasonEvents/current.json": JSON.stringify({
        donation: { eventId: "donation-current" },
        push: { eventId: "push-current" },
      }),
    }),
  };

  const response = await worker.fetch(new Request("https://worker.test/api/bot-data/events/seasonEvents/current.json", {
    headers: { authorization: "Bearer secret" },
  }), env, {});

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, max-age=30");
  assert.deepEqual(await response.json(), {
    donation: { eventId: "donation-current" },
    push: { eventId: "push-current" },
  });
});

test("bot data route does not fall back to public shards", async () => {
  const worker = loadWorker();
  const env = {
    ROSTER_BOT_SECRET: "secret",
    ROSTER_DATA_KV: createKv({
      "public-data/events/seasonEvents/current.json": JSON.stringify({
        donation: { eventId: "donation-current" },
      }),
    }),
  };

  const response = await worker.fetch(new Request("https://worker.test/api/bot-data/events/seasonEvents/current.json", {
    headers: { authorization: "Bearer secret" },
  }), env, {});

  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "Data object not found.");
});

test("bot active routes resolve immutable versioned objects with the existing schemas", async () => {
  const worker = loadWorker();
  const activePayload = { activeVersionId: "version-7", schemaVersion: 1, rosters: [{ id: "main" }], playerMetrics: { byTag: {} } };
  const byTag = { "#PLAYER": { identity: { tag: "#PLAYER", name: "Player" } } };
  const linked = { "discord-1": [{ tag: "#PLAYER", playerTag: "#PLAYER" }] };
  const env = {
    ROSTER_BOT_SECRET: "secret",
    ROSTER_DATA_KV: createKv({
      "bot-data/active/currentVersionId.json": JSON.stringify("version-7"),
      "bot-data/activeVersions/version-7/active.json": JSON.stringify(activePayload),
      "bot-data/activeVersions/version-7/playerMetrics/byTag.json": JSON.stringify(byTag),
      "bot-data/activeVersions/version-7/indexes/linkedAccountsByDiscordId.json": JSON.stringify(linked),
    }),
  };
  const headers = { authorization: "Bearer secret" };
  const active = await worker.fetch(new Request("https://worker.test/api/bot-data/active.json", { headers }), env, {});
  const metrics = await worker.fetch(new Request("https://worker.test/api/bot-data/active/playerMetrics/byTag.json", { headers }), env, {});
  const index = await worker.fetch(new Request("https://worker.test/api/bot-data/indexes/linkedAccountsByDiscordId.json", { headers }), env, {});
  assert.equal(active.status, 200);
  assert.deepEqual(await active.json(), activePayload);
  assert.deepEqual(await metrics.json(), byTag);
  assert.deepEqual(await index.json(), linked);
});

test("sharded bot-active publication reconstructs the unchanged active route contract", async () => {
  const worker = loadWorker();
  const selector = { schemaVersion: 1, currentVersionId: "version-sharded", previousVersionId: "", generation: 9, committedAt: "now" };
  const rosters = [{ id: "main", main: [{ tag: "#PLAYER" }], subs: [], missing: [] }];
  const byTag = { "#PLAYER": { identity: { tag: "#PLAYER", name: "Player" } } };
  const env = {
    ROSTER_BOT_SECRET: "secret",
    ROSTER_DATA_KV: createKv({
      "public-data/activePublished/currentSelector.json": JSON.stringify(selector),
      "public-data/activeVersions/version-sharded/manifest.json": JSON.stringify({ versionId: "version-sharded", rosterIds: ["main"] }),
      "public-data/activeVersions/version-sharded/rosters.json": JSON.stringify({ main: rosters[0] }),
      "public-data/activeVersions/version-sharded/playerMetrics.json": JSON.stringify({ schemaVersion: 1, byTag }),
      "bot-data/activeVersions/version-sharded/active.json": JSON.stringify({ shardedActive: true, activeMeta: { schemaVersion: 1, pageTitle: "Roster", rosterOrder: ["main"] } }),
      "bot-data/activeVersions/version-sharded/rosters.json": JSON.stringify(rosters),
      "bot-data/activeVersions/version-sharded/playerMetrics/meta.json": JSON.stringify({ schemaVersion: 1, updatedAt: "now" }),
      "bot-data/activeVersions/version-sharded/playerMetrics/byTag.json": JSON.stringify(byTag),
      "bot-data/activeVersions/version-sharded/indexes/linkedAccountsByDiscordId.json": JSON.stringify({}),
      "bot-data/activeVersions/version-sharded/indexes/linkedAccountsByDiscordUsername.json": JSON.stringify({}),
    }),
  };
  const response = await worker.fetch(new Request("https://worker.test/api/bot-data/active.json", { headers: { authorization: "Bearer secret" } }), env, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    schemaVersion: 1,
    pageTitle: "Roster",
    rosterOrder: ["main"],
    activeVersionId: "version-sharded",
    rosters,
    playerMetrics: { schemaVersion: 1, updatedAt: "now", byTag },
  });
});

test("committed public pointer and shared selector expose the same version", async () => {
  const worker = loadWorker();
  const selector = { schemaVersion: 1, currentVersionId: "version-current", previousVersionId: "version-previous", generation: 4, committedAt: "now" };
  const publicObjects = {
    "public-data/activePublished/currentSelector.json": JSON.stringify(selector),
    "public-data/activePublished/currentVersionId.json": JSON.stringify("version-current"),
    "public-data/activeVersions/version-current/manifest.json": JSON.stringify({ versionId: "version-current" }),
    "public-data/activeVersions/version-current/rosters.json": JSON.stringify({ main: { id: "main" } }),
    "public-data/activeVersions/version-current/playerMetrics.json": JSON.stringify({ byTag: {} }),
  };
  const botPayload = { activeVersionId: "version-current", rosters: [{ id: "main" }], playerMetrics: { byTag: {} } };
  const env = {
    ROSTER_BOT_SECRET: "secret",
    ROSTER_DATA_KV: createKv(Object.assign(publicObjects, {
      "bot-data/activeVersions/version-current/active.json": JSON.stringify(botPayload),
      "bot-data/activeVersions/version-current/playerMetrics/byTag.json": JSON.stringify({}),
      "bot-data/activeVersions/version-current/indexes/linkedAccountsByDiscordId.json": JSON.stringify({}),
    })),
  };
  const auth = { authorization: "Bearer secret" };
  const publicPointer = await worker.fetch(new Request("https://worker.test/api/public-data/activePublished/currentVersionId.json", { headers: auth }), env, {});
  const botPointer = await worker.fetch(new Request("https://worker.test/api/bot-data/active/currentVersionId.json", { headers: auth }), env, {});
  const botActive = await worker.fetch(new Request("https://worker.test/api/bot-data/active.json", { headers: auth }), env, {});
  assert.equal(await publicPointer.json(), "version-current");
  assert.equal(await botPointer.json(), "version-current");
  assert.deepEqual(await botActive.json(), botPayload);
});

test("shared selector falls back to the previous complete version during KV propagation", async () => {
  const worker = loadWorker();
  const selector = { schemaVersion: 1, currentVersionId: "version-current", previousVersionId: "version-previous", generation: 5, committedAt: "now" };
  const env = {
    ROSTER_BOT_SECRET: "secret",
    ROSTER_DATA_KV: createKv({
      "public-data/activePublished/currentSelector.json": JSON.stringify(selector),
      "public-data/activePublished/currentVersionId.json": JSON.stringify("version-current"),
      "public-data/activeVersions/version-current/manifest.json": JSON.stringify({ versionId: "version-current" }),
      "public-data/activeVersions/version-previous/manifest.json": JSON.stringify({ versionId: "version-previous" }),
      "public-data/activeVersions/version-previous/rosters.json": JSON.stringify({ main: { id: "main" } }),
      "public-data/activeVersions/version-previous/playerMetrics.json": JSON.stringify({ byTag: {} }),
      "bot-data/activeVersions/version-previous/active.json": JSON.stringify({ activeVersionId: "version-previous", rosters: [], playerMetrics: { byTag: {} } }),
      "bot-data/activeVersions/version-previous/playerMetrics/byTag.json": JSON.stringify({}),
      "bot-data/activeVersions/version-previous/indexes/linkedAccountsByDiscordId.json": JSON.stringify({}),
      "bot-data/activeVersions/version-previous/indexes/linkedAccountsByDiscordUsername.json": JSON.stringify({}),
    }),
  };
  const auth = { authorization: "Bearer secret" };
  const publicPointer = await worker.fetch(new Request("https://worker.test/api/public-data/activePublished/currentVersionId.json", { headers: auth }), env, {});
  const botPointer = await worker.fetch(new Request("https://worker.test/api/bot-data/active/currentVersionId.json", { headers: auth }), env, {});
  const botActive = await worker.fetch(new Request("https://worker.test/api/bot-data/active.json", { headers: auth }), env, {});
  assert.equal(await publicPointer.json(), "version-current");
  assert.equal(await botPointer.json(), "version-previous");
  assert.equal((await botActive.json()).activeVersionId, "version-previous");
});

test("a valid shared selector never falls back to a legacy bot object from another generation", async () => {
  const worker = loadWorker();
  const selector = { schemaVersion: 1, currentVersionId: "version-current", previousVersionId: "version-previous", generation: 6, committedAt: "now" };
  const env = {
    ROSTER_BOT_SECRET: "secret",
    ROSTER_DATA_KV: createKv({
      "public-data/activePublished/currentSelector.json": JSON.stringify(selector),
      "public-data/activeVersions/version-current/manifest.json": JSON.stringify({ versionId: "version-current" }),
      "public-data/activeVersions/version-current/rosters.json": JSON.stringify({}),
      "public-data/activeVersions/version-current/playerMetrics.json": JSON.stringify({}),
      "public-data/activeVersions/version-previous/manifest.json": JSON.stringify({ versionId: "version-previous" }),
      "public-data/activeVersions/version-previous/rosters.json": JSON.stringify({}),
      "public-data/activeVersions/version-previous/playerMetrics.json": JSON.stringify({}),
      "bot-data/active.json": JSON.stringify({ activeVersionId: "legacy" }),
      "bot-data/activeVersions/version-previous/active.json": JSON.stringify({ activeVersionId: "version-previous" }),
    }),
  };
  const response = await worker.fetch(new Request("https://worker.test/api/bot-data/active.json", {
    headers: { authorization: "Bearer secret" },
  }), env, {});
  assert.equal(response.status, 404);
});

test("versioned bot reads fall back only to the existing bot object, never public scope", async () => {
  const worker = loadWorker();
  const env = {
    ROSTER_BOT_SECRET: "secret",
    ROSTER_DATA_KV: createKv({
      "bot-data/active/currentVersionId.json": JSON.stringify("version-8"),
      "bot-data/active.json": JSON.stringify({ activeVersionId: "legacy" }),
      "public-data/activeVersions/version-8/active.json": JSON.stringify({ activeVersionId: "public-leak" }),
    }),
  };
  const response = await worker.fetch(new Request("https://worker.test/api/bot-data/active.json", {
    headers: { authorization: "Bearer secret" },
  }), env, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { activeVersionId: "legacy" });
});

test("verify-v2 refuses pointer readiness when a required object is missing", async () => {
  const worker = loadWorker();
  const env = {
    ROSTER_PUBLIC_DATA_PUBLISH_SECRET: "publish-secret",
    ROSTER_DATA_KV: createKv({
      "public-data/activeVersions/version-1/manifest.json": JSON.stringify({ versionId: "version-1" }),
    }),
  };
  const response = await worker.fetch(new Request("https://worker.test/api/internal/public-data/verify-v2", {
    method: "POST",
    headers: { authorization: "Bearer publish-secret", "content-type": "application/json" },
    body: JSON.stringify({ versionId: "version-1", objects: [
      { scope: "public", path: "activeVersions/version-1/manifest" },
      { scope: "bot", path: "activeVersions/version-1/active" },
    ] }),
  }), env, {});
  assert.equal(response.status, 409);
  assert.equal((await response.json()).ok, false);
});

test("mutable public pointers use short edge caching while version shards stay immutable", async () => {
  const worker = loadWorker();
  const env = {
    ROSTER_DATA_KV: createKv({
      "public-data/activePublished/currentVersionId.json": JSON.stringify("version-2"),
      "public-data/activeVersions/version-2/manifest.json": JSON.stringify({ versionId: "version-2" }),
    }),
  };

  const pointerResponse = await worker.fetch(
    new Request("https://worker.test/api/public-data/activePublished/currentVersionId.json"),
    env,
    {},
  );
  const manifestResponse = await worker.fetch(
    new Request("https://worker.test/api/public-data/activeVersions/version-2/manifest.json"),
    env,
    {},
  );

  assert.equal(pointerResponse.status, 200);
  assert.equal(pointerResponse.headers.get("cache-control"), "public, max-age=5, s-maxage=15, stale-while-revalidate=30");
  assert.equal(await pointerResponse.json(), "version-2");
  assert.equal(manifestResponse.status, 200);
  assert.equal(manifestResponse.headers.get("cache-control"), "public, max-age=31536000, immutable");
});

test("immutable public reads touch one exact KV key and never substitute the previous version", async () => {
  const worker = loadWorker();
  const kv = createObservedKv({
    "public-data/activePublished/currentSelector.json": JSON.stringify({
      currentVersionId: "version-new",
      previousVersionId: "version-old",
    }),
    "public-data/activeVersions/version-old/rosters.json": JSON.stringify({ old: true }),
  }, { delayMs: 35 });
  const startedAt = Date.now();
  const response = await worker.fetch(
    new Request("https://worker.test/api/public-data/activeVersions/version-new/rosters.json"),
    { ROSTER_DATA_KV: kv },
    {},
  );
  const elapsedMs = Date.now() - startedAt;

  assert.equal(response.status, 503);
  assert.deepEqual(kv.reads, ["public-data/activeVersions/version-new/rosters.json"]);
  assert.ok(elapsedMs >= 30, `expected simulated KV latency, received ${elapsedMs}ms`);
  assert.ok(elapsedMs < 120, `exact immutable read should not serialize hidden KV reads, received ${elapsedMs}ms`);
});

test("mutable public reads touch one exact key and retain direct-object ETags", async () => {
  const worker = loadWorker();
  const key = "public-data/events/seasonEvents/current.json";
  const kv = createObservedKv({
    "public-data/bootstrap/current.json": JSON.stringify({ seasonEvents: { current: { source: "bootstrap" } } }),
    [key]: JSON.stringify({ source: "direct" }),
  });
  const first = await worker.fetch(
    new Request("https://worker.test/api/public-data/events/seasonEvents/current.json"),
    { ROSTER_DATA_KV: kv },
    {},
  );
  const etag = first.headers.get("etag");
  const second = await worker.fetch(
    new Request("https://worker.test/api/public-data/events/seasonEvents/current.json", {
      headers: { "if-none-match": etag },
    }),
    { ROSTER_DATA_KV: kv },
    {},
  );

  assert.deepEqual(await first.json(), { source: "direct" });
  assert.equal(second.status, 304);
  assert.equal(kv.reads.every((readKey) => readKey === key), true);
  assert.equal(kv.reads.length, 2);
});

test("public health reports direct active version shard presence", async () => {
  const worker = loadWorker();
  const env = {
    ROSTER_DATA_KV: createKv({
      "public-data/activePublished/currentVersionId.json": JSON.stringify("version-4"),
      "public-data/activeVersions/version-4/manifest.json": JSON.stringify({ versionId: "version-4" }),
      "public-data/activeVersions/version-4/rosters.json": JSON.stringify({ main: { id: "main" } }),
    }),
  };

  const response = await worker.fetch(
    new Request("https://worker.test/api/public-data/health?expectedVersionId=version-4"),
    env,
    {},
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.currentVersionId, "version-4");
  assert.equal(payload.directCurrentVersionId, "version-4");
  assert.equal(payload.projectedCurrentVersionId, "version-4");
  assert.equal(payload.currentVersionMatchesExpected, true);
  assert.equal(payload.projectedCurrentVersionMatchesExpected, true);
  assert.equal(payload.activeVersionShards.versionId, "version-4");
  assert.equal(payload.activeVersionShards.manifest, true);
  assert.equal(payload.activeVersionShards.rosters, true);
  assert.equal(payload.activeVersionShards.playerMetrics, false);
  assert.equal(payload.activeVersionShards.complete, false);
  assert.deepEqual(payload.activeVersionShards.missing, ["playerMetrics"]);
});

test("public health exposes bootstrap-projected pointer without relaxing direct verification", async () => {
  const worker = loadWorker();
  const env = {
    ROSTER_DATA_KV: createKv({
      "public-data/activePublished/currentVersionId.json": JSON.stringify("version-old"),
      "public-data/bootstrap/current.json": JSON.stringify({
        activeVersionId: "version-new",
        active: {
          versionId: "version-new",
          manifest: { versionId: "version-new" },
        },
      }),
      "public-data/activeVersions/version-new/manifest.json": JSON.stringify({ versionId: "version-new" }),
      "public-data/activeVersions/version-new/rosters.json": JSON.stringify({ main: { id: "main" } }),
      "public-data/activeVersions/version-new/playerMetrics.json": JSON.stringify({ byTag: {} }),
    }),
  };

  const response = await worker.fetch(
    new Request("https://worker.test/api/public-data/health?expectedVersionId=version-new"),
    env,
    {},
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.currentVersionId, "version-old");
  assert.equal(payload.directCurrentVersionId, "version-old");
  assert.equal(payload.projectedCurrentVersionId, "version-new");
  assert.equal(payload.currentVersionMatchesExpected, false);
  assert.equal(payload.projectedCurrentVersionMatchesExpected, true);
  assert.equal(payload.activeVersionShards.complete, true);
});

test("public bootstrap and immutable version URLs preserve exact route identity", async () => {
  const worker = loadWorker();
  const env = {
    ROSTER_DATA_KV: createKv({
      "public-data/activePublished/currentVersionId.json": JSON.stringify("version-old"),
      "public-data/activePublished/currentManifest.json": JSON.stringify({
        versionId: "version-old",
        pageTitle: "Old complete",
      }),
      "public-data/bootstrap/current.json": JSON.stringify({
        activeVersionId: "version-new",
        active: {
          versionId: "version-new",
          manifest: { versionId: "version-new", pageTitle: "New partial" },
        },
        seasonEvents: {
          current: {
            donation: { eventId: "donation-current", seasonId: "season-1" },
          },
        },
        donationRefresh: { bySeason: {} },
      }),
      "public-data/activeVersions/version-new/manifest.json": JSON.stringify({ versionId: "version-new" }),
      "public-data/activeVersions/version-old/manifest.json": JSON.stringify({ versionId: "version-old" }),
      "public-data/activeVersions/version-old/rosters.json": JSON.stringify({ main: { id: "main" } }),
      "public-data/activeVersions/version-old/playerMetrics.json": JSON.stringify({ byTag: {} }),
    }),
  };

  const bootstrapResponse = await worker.fetch(
    new Request("https://worker.test/api/public-data/bootstrap/current.json"),
    env,
    {},
  );
  const pointerResponse = await worker.fetch(
    new Request("https://worker.test/api/public-data/activePublished/currentVersionId.json"),
    env,
    {},
  );
  const missingRosterResponse = await worker.fetch(
    new Request("https://worker.test/api/public-data/activeVersions/version-new/rosters.json"),
    env,
    {},
  );
  const completeRosterResponse = await worker.fetch(
    new Request("https://worker.test/api/public-data/activeVersions/version-old/rosters.json"),
    env,
    {},
  );
  const healthResponse = await worker.fetch(
    new Request("https://worker.test/api/public-data/health?expectedVersionId=version-new"),
    env,
    {},
  );

  const bootstrap = await bootstrapResponse.json();
  const health = await healthResponse.json();

  assert.equal(bootstrapResponse.status, 200);
  assert.equal(bootstrapResponse.headers.get("cache-control"), "public, max-age=5, s-maxage=15, stale-while-revalidate=30");
  assert.equal(bootstrap.activeVersionId, "version-new");
  assert.equal(bootstrap.active.versionId, "version-new");
  assert.equal(bootstrap.active.manifest.pageTitle, "New partial");
  assert.equal(bootstrap.seasonEvents.current.donation.eventId, "donation-current");
  assert.equal(Object.prototype.hasOwnProperty.call(bootstrap, "activeVersionFallback"), false);
  assert.equal(await pointerResponse.json(), "version-old");
  assert.equal(missingRosterResponse.status, 503);
  assert.equal(missingRosterResponse.headers.get("retry-after"), "1");
  assert.equal(completeRosterResponse.status, 200);
  assert.equal(health.currentVersionId, "version-old");
  assert.equal(health.projectedCurrentVersionId, "version-old");
  assert.equal(health.currentVersionMatchesExpected, false);
  assert.equal(health.projectedCurrentVersionMatchesExpected, false);
});

test("missing current active version shards are never projected from legacy active data", async () => {
  const worker = loadWorker();
  const env = {
    ROSTER_DATA_KV: createKv({
      "public-data/bootstrap/current.json": JSON.stringify({
        activeVersionId: "version-3",
        active: {
          versionId: "version-3",
          manifest: {
            versionId: "version-3",
            pageTitle: "Projected",
            rosterIds: ["main"],
          },
        },
      }),
      "public-data/active.json": JSON.stringify({
        activeVersionId: "version-3",
        schemaVersion: 1,
        pageTitle: "Projected",
        rosterOrder: ["main"],
        rosters: [{ id: "main", title: "Main" }],
        playerMetrics: { schemaVersion: 1, byTag: { "__FB64__I1BMQVlFUg": { identity: { tag: "#PLAYER" } } } },
      }),
    }),
  };

  const manifestResponse = await worker.fetch(
    new Request("https://worker.test/api/public-data/activeVersions/version-3/manifest.json"),
    env,
    {},
  );
  const rostersResponse = await worker.fetch(
    new Request("https://worker.test/api/public-data/activeVersions/version-3/rosters.json"),
    env,
    {},
  );
  const metricsResponse = await worker.fetch(
    new Request("https://worker.test/api/public-data/activeVersions/version-3/playerMetrics.json"),
    env,
    {},
  );
  const staleResponse = await worker.fetch(
    new Request("https://worker.test/api/public-data/activeVersions/version-old/manifest.json"),
    env,
    {},
  );

  assert.equal(manifestResponse.status, 503);
  assert.equal(rostersResponse.status, 503);
  assert.equal(metricsResponse.status, 503);
  assert.equal(staleResponse.status, 503);
});

test("missing active version shards are not projected from stale legacy active data", async () => {
  const worker = loadWorker();
  const env = {
    ROSTER_DATA_KV: createKv({
      "public-data/bootstrap/current.json": JSON.stringify({
        activeVersionId: "version-5",
        active: {
          versionId: "version-5",
          manifest: {
            versionId: "version-5",
            pageTitle: "Projected",
            rosterIds: ["main"],
          },
        },
      }),
      "public-data/active.json": JSON.stringify({
        activeVersionId: "version-old",
        schemaVersion: 1,
        pageTitle: "Old",
        rosterOrder: ["main"],
        rosters: [{ id: "main", title: "Old Main" }],
        playerMetrics: { schemaVersion: 1, byTag: {} },
      }),
    }),
  };

  const manifestResponse = await worker.fetch(
    new Request("https://worker.test/api/public-data/activeVersions/version-5/manifest.json"),
    env,
    {},
  );
  const rostersResponse = await worker.fetch(
    new Request("https://worker.test/api/public-data/activeVersions/version-5/rosters.json"),
    env,
    {},
  );
  const metricsResponse = await worker.fetch(
    new Request("https://worker.test/api/public-data/activeVersions/version-5/playerMetrics.json"),
    env,
    {},
  );

  assert.equal(manifestResponse.status, 503);
  assert.equal(rostersResponse.status, 503);
  assert.equal(metricsResponse.status, 503);
});

test("mutable public data paths read only their direct keys", async () => {
  const worker = loadWorker();
  const env = {
    ROSTER_DATA_KV: createKv({
      "public-data/bootstrap/current.json": JSON.stringify({
        activeVersionId: "version-bootstrap",
        active: {
          versionId: "version-bootstrap",
          manifest: { versionId: "version-bootstrap", pageTitle: "Bootstrap" },
        },
        seasonEvents: {
          current: {
            donation: { eventId: "donation-current", seasonId: "season-1" },
          },
          seasonState: { seasonId: "season-1" },
          byId: {
            "donation-current": { eventId: "donation-current", type: "donation", title: "Donation" },
          },
          cwlAggregatesByEventId: {},
          latestCompletedCwl: null,
        },
        donationRefresh: {
          current: { seasonId: "season-1", updatedAt: "2026-07-07T00:00:00.000Z" },
          bySeason: {
            "season-1": { seasonId: "season-1", byTag: {} },
          },
        },
      }),
      "public-data/activePublished/currentVersionId.json": JSON.stringify("stale-version"),
      "public-data/events/seasonEvents/current.json": JSON.stringify({
        donation: { eventId: "stale-donation" },
      }),
    }),
  };

  const pointerResponse = await worker.fetch(
    new Request("https://worker.test/api/public-data/activePublished/currentVersionId.json"),
    env,
    {},
  );
  const currentResponse = await worker.fetch(
    new Request("https://worker.test/api/public-data/events/seasonEvents/current.json"),
    env,
    {},
  );
  const donationResponse = await worker.fetch(
    new Request("https://worker.test/api/public-data/donationRefresh/bySeason/season-1.json"),
    env,
    {},
  );

  assert.equal(pointerResponse.status, 200);
  assert.equal(await pointerResponse.json(), "stale-version");
  assert.equal((await currentResponse.json()).donation.eventId, "stale-donation");
  assert.equal(donationResponse.status, 404);
});

test("bootstrap route does not synthesize from unrelated public objects", async () => {
  const worker = loadWorker();
  const env = {
    ROSTER_DATA_KV: createKv({
      "public-data/activePublished/currentVersionId.json": JSON.stringify("version-legacy"),
      "public-data/activePublished/currentManifest.json": JSON.stringify({ versionId: "version-legacy" }),
      "public-data/events/seasonEvents/current.json": JSON.stringify({
        donation: { eventId: "donation-current", seasonId: "season-1" },
      }),
      "public-data/events/seasonEvents/seasonState/current.json": JSON.stringify({ seasonId: "season-1" }),
      "public-data/events/seasonEvents/byId/donation-current.json": JSON.stringify({
        eventId: "donation-current",
        type: "donation",
        seasonId: "season-1",
      }),
      "public-data/donationRefresh/current.json": JSON.stringify({ seasonId: "season-1" }),
      "public-data/donationRefresh/bySeason/season-1.json": JSON.stringify({
        seasonId: "season-1",
        byTag: {},
      }),
    }),
  };

  const response = await worker.fetch(
    new Request("https://worker.test/api/public-data/bootstrap/current.json"),
    env,
    {},
  );
  assert.equal(response.status, 404);
});
