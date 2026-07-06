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

test("generated Cloudflare publish version ids are unique active-version keys", () => {
  const backend = loadPublisher();
  const versionId = backend.createCloudflarePublicDataVersionId_("manual snapshot");

  assert.match(versionId, /^manual_snapshot-\d{8}T\d{6}_\d{3}Z-[A-Za-z0-9]+$/);
  assert.notEqual(versionId, "legacy-active");
});

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

test("active mirror repair skips publish when Cloudflare already matches Firebase", () => {
  const backend = loadPublisher();
  backend.Logger = { log() {} };
  backend.normalizeActiveVersionId_ = (value) => String(value || "").trim();
  backend.readPublishedActiveVersionId_ = () => "version-1";
  let verifyCalls = 0;
  let publishCalls = 0;
  backend.verifyCloudflarePublicActiveVersionId_ = (expectedVersionId) => {
    verifyCalls++;
    return { ok: true, expectedVersionId, actualVersionId: expectedVersionId };
  };
  backend.publishCloudflarePublicDataSnapshot_ = () => {
    publishCalls++;
    return { ok: true };
  };

  const result = backend.repairCloudflareActiveRosterMirrorIfStale_({ label: "test-repair" });

  assert.equal(result.ok, true);
  assert.equal(result.status, "inSync");
  assert.equal(result.repaired, false);
  assert.equal(result.expectedVersionId, "version-1");
  assert.equal(verifyCalls, 1);
  assert.equal(publishCalls, 0);
});

test("active mirror repair republishes and verifies a stale Cloudflare pointer", () => {
  const backend = loadPublisher();
  backend.Logger = { log() {} };
  backend.normalizeActiveVersionId_ = (value) => String(value || "").trim();
  backend.readPublishedActiveVersionId_ = () => "version-2";
  let cloudflareVersionId = "version-1";
  let verifyCalls = 0;
  let publishCalls = 0;
  backend.verifyCloudflarePublicActiveVersionId_ = (expectedVersionId) => {
    verifyCalls++;
    return {
      ok: cloudflareVersionId === expectedVersionId,
      expectedVersionId,
      actualVersionId: cloudflareVersionId,
      error: cloudflareVersionId === expectedVersionId ? "" : "Cloudflare active version pointer mismatch.",
    };
  };
  backend.publishCloudflarePublicDataSnapshot_ = () => {
    publishCalls++;
    cloudflareVersionId = "version-2";
    return {
      ok: true,
      active: { ok: true, versionId: "version-2", publicResult: { ok: true }, botResult: { ok: true } },
      cwlLeagueSignups: { ok: true, skipped: true },
      seasonEvents: { ok: true, skipped: true },
    };
  };

  const result = backend.repairCloudflareActiveRosterMirrorIfStale_({ label: "test-repair" });

  assert.equal(result.ok, true);
  assert.equal(result.status, "repaired");
  assert.equal(result.repaired, true);
  assert.equal(result.expectedVersionId, "version-2");
  assert.equal(result.verifyResult.actualVersionId, "version-1");
  assert.equal(result.afterVerifyResult.actualVersionId, "version-2");
  assert.equal(verifyCalls, 2);
  assert.equal(publishCalls, 1);
});
