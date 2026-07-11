import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const repoRoot = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, repoRoot), "utf8");
const normalRuntimeFiles = [
  "script/seasonEvents.js",
  "script/donationRefresh.js",
  "script/cwlLeagueSignups.js",
  "script/firebaseStore.js",
  "script/publishAndTriggers.js",
];

test("queued mode has no synchronous legacy Cloudflare publisher in canonical runtime paths", () => {
  const forbiddenCalls = [
    "publishCloudflarePublicDataSnapshot_",
    "publishCloudflareActiveRosterDataBestEffort_",
    "publishCloudflareSeasonEventsAndDonationDataBestEffort_",
    "verifyCloudflarePublicActiveVersionId_",
  ];

  for (const file of normalRuntimeFiles) {
    const source = read(file);
    for (const name of forbiddenCalls) {
      assert.equal(source.includes(name), false, `${file} must not call ${name}`);
    }
  }
});

test("canonical mutation and auto-refresh files contain no Cloudflare network request", () => {
  const filesWithoutCanonicalFirebaseTransport = normalRuntimeFiles.filter((file) => file !== "script/firebaseStore.js");
  for (const file of filesWithoutCanonicalFirebaseTransport) {
    const source = read(file);
    assert.equal(/UrlFetchApp\s*\.\s*fetch\s*\(/.test(source), false, `${file} contains a synchronous network fetch`);
    assert.equal(source.includes("/api/internal/public-data/publish-v2"), false, `${file} bypasses the dedicated queue worker`);
  }
});

test("queued publisher does not enumerate history or use force-all retry state", () => {
  const source = read("script/cloudflarePublishQueue.js");
  assert.equal(source.includes("listFirebaseChildKeys_("), false);
  assert.equal(source.includes("forceNext"), false);
  assert.match(source, /timeoutSeconds:\s*getCloudflareQueueRequestTimeoutSeconds_\(\)/);
  assert.match(source, /commitGuard:\s*\{/);
});

test("legacy full-history publisher remains isolated for manual rollback only", () => {
  const publicData = read("script/cloudflarePublicData.js");
  const adminApi = read("script/adminApi.js");
  assert.match(publicData, /function publishCloudflareSeasonEventsAndDonationDataBestEffort_/);
  assert.match(publicData, /function publishCloudflarePublicDataSnapshot_/);
  assert.match(adminApi, /case "publishCloudflarePublicDataSnapshot"/);
  assert.equal(read("script/publishAndTriggers.js").includes("publishCloudflarePublicDataSnapshot_"), false);
});

test("normal publisher wrappers enqueue targeted work instead of writing pointers", () => {
  const seasonEvents = read("script/seasonEvents.js");
  const autoRefresh = read("script/publishAndTriggers.js");
  const seasonWrapper = seasonEvents.match(/function publishCloudflareSeasonEventsAfterMutation_[\s\S]*?\n\}/)?.[0] || "";
  const cwlWrapper = autoRefresh.match(/function publishCloudflareSeasonEventsAfterAutoRefreshCwlBestEffort_[\s\S]*?\n\}/)?.[0] || "";
  assert.match(seasonWrapper, /enqueueCloudflareSeasonEventPublication_|enqueueCloudflareRelevantSeasonPublication_/);
  assert.match(cwlWrapper, /publishCwlLifecycleDescriptor_/);
  assert.equal(seasonWrapper.includes("UrlFetchApp"), false);
  assert.equal(cwlWrapper.includes("UrlFetchApp"), false);
});

test("queued v2 batches are globally generation-fenced by the Durable Object coordinator", () => {
  const queue = read("script/cloudflarePublishQueue.js");
  const worker = read("cloudflarePages/worker-core.js");
  const config = read("wrangler.jsonc");

  assert.match(queue, /allocateCloudflarePublishDispatchGuard_/);
  assert.match(queue, /request\.dispatchGuard\s*=\s*request\.dispatchGuard\s*\|\|/);
  assert.match(worker, /class CloudflarePublicationCoordinator/);
  assert.match(worker, /Publication dispatch generation is stale/);
  assert.match(config, /"CLOUDFLARE_PUBLICATION_COORDINATOR"/);
  assert.match(config, /"new_sqlite_classes"/);
});
