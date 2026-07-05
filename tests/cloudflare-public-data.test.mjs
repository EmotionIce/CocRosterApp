import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const repoRoot = new URL("../", import.meta.url);

const loadPublisher = () => {
  const code = fs.readFileSync(new URL("script/cloudflarePublicData.js", repoRoot), "utf8");
  const context = {};
  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
};

const plain = (value) => JSON.parse(JSON.stringify(value));

test("public event publish batches are mirrored into bot scope", () => {
  const backend = loadPublisher();
  const batch = backend.buildCloudflareBotScopeMirroredPublishBatch_([
    { path: "events/seasonEvents/current", payload: { push: { eventId: "push-1" } } },
    { path: "events/seasonEvents/seasonState/current", payload: { seasonId: "season-1" } },
  ], [
    "events/seasonEvents/latestCompletedCwl",
  ]);

  assert.deepEqual(plain(batch.objects), [
    { path: "events/seasonEvents/current", payload: { push: { eventId: "push-1" } } },
    { path: "events/seasonEvents/seasonState/current", payload: { seasonId: "season-1" } },
    { path: "events/seasonEvents/current", payload: { push: { eventId: "push-1" } }, scope: "bot" },
    { path: "events/seasonEvents/seasonState/current", payload: { seasonId: "season-1" }, scope: "bot" },
  ]);
  assert.deepEqual(plain(batch.deletePaths), [
    "events/seasonEvents/latestCompletedCwl",
    { path: "events/seasonEvents/latestCompletedCwl", scope: "bot" },
  ]);
});

test("bot-scoped entries are not mirrored a second time", () => {
  const backend = loadPublisher();
  const batch = backend.buildCloudflareBotScopeMirroredPublishBatch_([
    { path: "active/cwlLeagueSignups", payload: { ok: true }, scope: "bot" },
  ], [
    { path: "active/legacy", scope: "bot" },
  ]);

  assert.deepEqual(plain(batch.objects), [
    { path: "active/cwlLeagueSignups", payload: { ok: true }, scope: "bot" },
  ]);
  assert.deepEqual(plain(batch.deletePaths), [
    { path: "active/legacy", scope: "bot" },
  ]);
});
