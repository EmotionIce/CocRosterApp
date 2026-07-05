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
