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

test("Cloudflare CWL aggregate projection refreshes ranked tags from current registrations", () => {
  const backend = loadPublisher();
  backend.Logger = { log() {} };
  backend.errorMessage_ = (err) => err && err.message ? err.message : String(err);
  backend.sanitizeSeasonEventText_ = (value) => String(value || "").trim();
  backend.normalizeSeasonEventType_ = (value) => String(value || "").trim().toLowerCase();
  backend.readCwlSeasonEventAggregate_ = (_eventId, kind) => kind === "live" ? {
    eventId: "cwl-active",
    kind: "live",
    rankedTags: ["#OLD"],
    byTag: {
      "#OLD": { starsTotal: 1 },
      "#NEW": { starsTotal: 3 },
    },
  } : null;
  backend.filterCwlAggregateToRegisteredParticipants_ = (event, aggregate) => {
    const tags = Object.values(event.participantsByDiscordId)
      .flatMap((participant) => participant.accounts || [])
      .map((account) => account.tag)
      .filter(Boolean)
      .sort((left, right) => (aggregate.byTag[right]?.starsTotal || 0) - (aggregate.byTag[left]?.starsTotal || 0));
    return { rankedTags: tags };
  };

  const projected = backend.addCloudflareCwlAggregatesForEvent_({}, {
    eventId: "cwl-active",
    type: "cwl",
    participantsByDiscordId: {
      user1: { status: "signed_up", accounts: [{ tag: "#OLD" }] },
      user2: { status: "signed_up", accounts: [{ tag: "#NEW" }] },
    },
  });

  assert.deepEqual(projected["cwl-active"].live.rankedTags, ["#NEW", "#OLD"]);
  assert.equal(projected["cwl-active"].live.kind, "live");
});

test("publish skips unchanged objects using stored hashes", () => {
  const backend = loadPublisher();
  backend.CLOUDFLARE_PUBLIC_DATA_ENABLED_PROPERTY = "CLOUDFLARE_PUBLIC_DATA_ENABLED";
  backend.CLOUDFLARE_PUBLIC_DATA_BASE_URL_PROPERTY = "CLOUDFLARE_PUBLIC_DATA_BASE_URL";
  backend.CLOUDFLARE_PUBLIC_DATA_PUBLISH_SECRET_PROPERTY = "CLOUDFLARE_PUBLIC_DATA_PUBLISH_SECRET";
  backend.CLOUDFLARE_PUBLIC_DATA_LAST_PUBLISH_AT_PROPERTY = "CLOUDFLARE_PUBLIC_DATA_LAST_PUBLISH_AT";
  backend.CLOUDFLARE_PUBLIC_DATA_LAST_PUBLISH_STATUS_PROPERTY = "CLOUDFLARE_PUBLIC_DATA_LAST_PUBLISH_STATUS";
  backend.CLOUDFLARE_PUBLIC_DATA_LAST_PUBLISH_ERROR_PROPERTY = "CLOUDFLARE_PUBLIC_DATA_LAST_PUBLISH_ERROR";
  backend.STATIC_ASSET_BASE_URL = "";
  backend.Logger = { log() {} };
  backend.errorMessage_ = (err) => err && err.message ? err.message : String(err);

  const properties = new Map([
    ["CLOUDFLARE_PUBLIC_DATA_ENABLED", "true"],
    ["CLOUDFLARE_PUBLIC_DATA_BASE_URL", "https://worker.test"],
    ["CLOUDFLARE_PUBLIC_DATA_PUBLISH_SECRET", "secret"],
  ]);
  backend.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key) => properties.has(key) ? properties.get(key) : "",
      setProperties: (values) => {
        for (const [key, value] of Object.entries(values)) properties.set(key, String(value));
      },
    }),
  };
  const publishCalls = [];
  backend.UrlFetchApp = {
    fetch: (url, options) => {
      const body = JSON.parse(options.payload);
      publishCalls.push({ url, body });
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          ok: true,
          putCount: body.objects.length,
          deleteCount: body.deletePaths.length,
        }),
      };
    },
  };

  const first = backend.publishCloudflareDataObjectsBestEffort_("public", [
    { path: "bootstrap/current", payload: { activeVersionId: "version-1", nested: { b: 1, a: 2 } } },
  ], { label: "test" });
  const second = backend.publishCloudflareDataObjectsBestEffort_("public", [
    { path: "bootstrap/current", payload: { nested: { a: 2, b: 1 }, activeVersionId: "version-1" } },
  ], { label: "test" });

  assert.equal(first.ok, true);
  assert.equal(first.putCount, 1);
  assert.equal(second.ok, true);
  assert.equal(second.skipped, true);
  assert.equal(second.reason, "unchanged");
  assert.equal(second.skippedPutCount, 1);
  assert.equal(publishCalls.length, 1);
  assert.equal(publishCalls[0].url, "https://worker.test/api/internal/public-data/publish");
});

test("snapshot publish can use supplied active version data without reading active snapshot", () => {
  const backend = loadPublisher();
  backend.normalizeActiveVersionId_ = (value) => String(value || "").trim();
  backend.validateRosterData_ = (value) => value;
  backend.readPublishedActiveVersionId_ = () => "published-version";
  backend.ACTIVE_ROSTER_FILENAME = "active.json";
  let activeSnapshotReads = 0;
  let activePublish = null;
  backend.readActiveRosterSnapshot_ = () => {
    activeSnapshotReads++;
    throw new Error("must not read active snapshot");
  };
  backend.publishCloudflareActiveRosterDataBestEffort_ = (versionWrite, label) => {
    activePublish = { versionWrite: plain(versionWrite), label };
    return {
      ok: true,
      versionId: versionWrite.versionId,
      publicResult: { ok: true, force: versionWrite.options.force === true },
      botResult: { ok: true, force: versionWrite.options.force === true },
    };
  };
  backend.readActiveCwlLeagueSignups_ = () => ({ accounts: [] });
  backend.publishCloudflareCwlLeagueSignupsBestEffort_ = () => ({ ok: true, skipped: true });
  backend.publishCloudflareSeasonEventsAndDonationDataBestEffort_ = () => ({ ok: true, skipped: true });

  const result = backend.publishCloudflarePublicDataSnapshot_({
    label: "queue-finalize",
    force: true,
    versionWrite: {
      versionId: "run-1",
      manifest: { versionId: "run-1", rosterIds: ["main"] },
      rosterData: {
        schemaVersion: 1,
        pageTitle: "Roster",
        rosterOrder: ["main"],
        rosters: [{ id: "main", main: [], subs: [], missing: [] }],
        playerMetrics: { schemaVersion: 1, byTag: {} },
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.force, true);
  assert.equal(activeSnapshotReads, 0);
  assert.equal(activePublish.label, "queue-finalize:active");
  assert.equal(activePublish.versionWrite.versionId, "run-1");
  assert.equal(activePublish.versionWrite.options.force, true);
  assert.equal(activePublish.versionWrite.rosterData.pageTitle, "Roster");
});

test("active version verification uses direct health and rejects missing shards", () => {
  const backend = loadPublisher();
  backend.CLOUDFLARE_PUBLIC_DATA_ENABLED_PROPERTY = "CLOUDFLARE_PUBLIC_DATA_ENABLED";
  backend.CLOUDFLARE_PUBLIC_DATA_BASE_URL_PROPERTY = "CLOUDFLARE_PUBLIC_DATA_BASE_URL";
  backend.STATIC_ASSET_BASE_URL = "";
  backend.normalizeActiveVersionId_ = (value) => String(value || "").trim();
  const properties = new Map([
    ["CLOUDFLARE_PUBLIC_DATA_ENABLED", "true"],
    ["CLOUDFLARE_PUBLIC_DATA_BASE_URL", "https://worker.test"],
  ]);
  backend.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key) => properties.has(key) ? properties.get(key) : "",
    }),
  };
  let requestedUrl = "";
  backend.UrlFetchApp = {
    fetch: (url) => {
      requestedUrl = url;
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          ok: true,
          currentVersionId: "version-5",
          activeVersionShards: {
            versionId: "version-5",
            manifest: true,
            rosters: true,
            playerMetrics: false,
            complete: false,
            missing: ["playerMetrics"],
          },
        }),
      };
    },
  };

  const result = backend.verifyCloudflarePublicActiveVersionId_("version-5");

  assert.equal(result.ok, false);
  assert.equal(result.error, "Cloudflare active version shards missing.");
  assert.equal(result.actualVersionId, "version-5");
  assert.deepEqual(Array.from(result.activeVersionShards.missing), ["playerMetrics"]);
  assert.match(requestedUrl, /^https:\/\/worker\.test\/api\/public-data\/health\?/);
  assert.match(requestedUrl, /expectedVersionId=version-5/);
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
