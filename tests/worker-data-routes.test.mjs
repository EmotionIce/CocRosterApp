import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const repoRoot = new URL("../", import.meta.url);

const loadWorker = () => {
  const source = fs
    .readFileSync(new URL("cloudflarePages/worker-core.js", repoRoot), "utf8")
    .replace(/export\s+default\s+\{/, "globalThis.workerDefault = {");
  const context = {
    URL,
    Request,
    Response,
    Headers,
    TextEncoder,
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

test("mutable public pointers are no-store while version shards stay immutable", async () => {
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
  assert.equal(pointerResponse.headers.get("cache-control"), "no-store");
  assert.equal(await pointerResponse.json(), "version-2");
  assert.equal(manifestResponse.status, 200);
  assert.equal(manifestResponse.headers.get("cache-control"), "public, max-age=31536000, immutable");
});

test("missing current active version shards are projected from legacy active data", async () => {
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

  assert.equal(manifestResponse.status, 200);
  assert.equal((await manifestResponse.json()).pageTitle, "Projected");
  assert.equal(rostersResponse.status, 200);
  assert.deepEqual(await rostersResponse.json(), { main: { id: "main", title: "Main" } });
  assert.equal(metricsResponse.status, 200);
  assert.equal((await metricsResponse.json()).byTag.__FB64__I1BMQVlFUg.identity.tag, "#PLAYER");
  assert.equal(staleResponse.status, 404);
});

test("mutable public data paths are projected from bootstrap before legacy keys", async () => {
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
  assert.equal(await pointerResponse.json(), "version-bootstrap");
  assert.equal((await currentResponse.json()).donation.eventId, "donation-current");
  assert.deepEqual(await donationResponse.json(), { seasonId: "season-1", byTag: {} });
});

test("bootstrap route can synthesize from legacy public objects during rollout", async () => {
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
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.activeVersionId, "version-legacy");
  assert.equal(payload.seasonEvents.current.donation.eventId, "donation-current");
  assert.equal(payload.seasonEvents.byId["donation-current"].type, "donation");
  assert.equal(payload.donationRefresh.bySeason["season-1"].seasonId, "season-1");
});
