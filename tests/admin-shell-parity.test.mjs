import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const readShell = (name) => fs.readFileSync(new URL("../cloudflarePages/" + name, import.meta.url), "utf8");
const readScriptShell = () => fs.readFileSync(new URL("../script/Admin.html", import.meta.url), "utf8");

test("admin shells both expose the CWL preference apply controls", () => {
  const requiredTokens = [
    "applyCwlPreferencesBtn",
    "cwlPreferenceApplySummary",
    "cwl-preference-apply-summary",
    "cwl-preference-apply-details",
    "cwl-preference-apply-details-group",
  ];

  for (const shellName of ["admin.html", "console.html"]) {
    const html = readShell(shellName);
    for (const token of requiredTokens) {
      assert.ok(html.includes(token), shellName + " is missing " + token);
    }
    assert.equal((html.match(/id="applyCwlPreferencesBtn"/g) || []).length, 1);
    assert.equal((html.match(/id="cwlPreferenceApplySummary"/g) || []).length, 1);
  }
});

test("admin shells expose the optimistic workspace skeleton", () => {
  const shells = [
    ["admin.html", readShell("admin.html")],
    ["console.html", readShell("console.html")],
    ["script/Admin.html", readScriptShell()],
  ];
  for (const [name, html] of shells) {
    assert.equal((html.match(/id="adminWorkspaceSkeleton"/g) || []).length, 1, name);
    assert.match(html, /class="admin-workspace-skeleton hidden"/, name);
    assert.match(html, /Verifying admin access and loading the workspace\./, name);
    assert.match(html, /admin\.js\?v=[^"]*20260727b/, name);
  }
});

test("admin unlock overlaps authenticated settings bootstrap with an unapplied roster fetch", () => {
  const adminClient = readShell("admin.js");
  const unlockStart = adminClient.indexOf("const handleUnlock = async () =>");
  const showSkeleton = adminClient.indexOf("setAdminWorkspaceLoading_(true)", unlockStart);
  const rosterFetch = adminClient.indexOf("const activeConfigFetchPromise = loadActiveRosterData()", showSkeleton);
  const settingsBootstrap = adminClient.indexOf("const settingsResults = await loadAdminWorkspaceBootstrapSettings_()", rosterFetch);
  const markAuthenticated = adminClient.indexOf("setAuthCardUnlocked(true)", settingsBootstrap);
  const awaitRoster = adminClient.indexOf("const activeConfigFetchResult = await activeConfigFetchPromise", markAuthenticated);
  const applyRoster = adminClient.indexOf("applyActiveConfigIntoPreview_(", awaitRoster);
  const hideSkeleton = adminClient.indexOf("setAdminWorkspaceLoading_(false)", applyRoster);

  assert.ok(unlockStart >= 0);
  assert.ok(showSkeleton > unlockStart);
  assert.ok(rosterFetch > showSkeleton);
  assert.ok(settingsBootstrap > rosterFetch);
  assert.ok(markAuthenticated > settingsBootstrap);
  assert.ok(awaitRoster > markAuthenticated);
  assert.ok(applyRoster > awaitRoster);
  assert.ok(hideSkeleton > applyRoster);
  assert.doesNotMatch(adminClient.slice(unlockStart, hideSkeleton), /runServerMethod\("verifyAdminPassword"/);
  assert.doesNotMatch(adminClient.slice(unlockStart, hideSkeleton), /showStartupLoader_|hideStartupLoader_/);
  assert.match(adminClient, /runServerMethod\("getAdminWorkspaceBootstrap"/);
  assert.match(adminClient, /isAdminWorkspaceBootstrapUnavailable_/);
  assert.doesNotMatch(adminClient, /refreshStartupLoader_\("Step [23] of 3"/);
});

test("admin shells prefer the same-origin Worker API and retain Apps Script as fallback", () => {
  const publicConfig = readShell("public-config.js");
  assert.match(publicConfig, /ROSTER_ADMIN_API_BASE\s*=\s*configuredAdminApiBase\s*\|\|\s*"\/api\/admin"/);

  for (const shellName of ["admin.html", "console.html"]) {
    const html = readShell(shellName);
    assert.match(html, /ROSTER_ADMIN_API_BASE\s*=\s*window\.ROSTER_ADMIN_API_BASE\s*\|\|\s*"\/api\/admin"/);
  }

  const adminClient = readShell("admin.js");
  assert.match(adminClient, /pushUnique\(resolveScriptServerBaseUrl\(\)\)/);
});

test("every admin shell exposes the same lazy war follow-up workspace", () => {
  const shells = [
    ["admin.html", readShell("admin.html")],
    ["console.html", readShell("console.html")],
    ["script/Admin.html", readScriptShell()],
  ];
  const requiredTokens = [
    'data-admin-tab="followup"',
    'id="adminTabFollowup"',
    'id="warFollowupMount"',
    "war-followup.css",
    "war-followup.js",
  ];
  for (const [name, html] of shells) {
    for (const token of requiredTokens) assert.ok(html.includes(token), `${name} is missing ${token}`);
    assert.equal((html.match(/id="adminTabFollowup"/g) || []).length, 1);
    assert.equal((html.match(/id="warFollowupMount"/g) || []).length, 1);
  }
});

test("war follow-up private state is loaded only when its tab is opened", () => {
  const adminClient = readShell("admin.js");
  const followupClient = readShell("war-followup.js");
  assert.match(adminClient, /RosterWarFollowup\.initialize/);
  assert.doesNotMatch(adminClient, /getWarFollowupState/);
  assert.match(followupClient, /key === "followup"\) load\(false\)/);
  assert.equal((followupClient.match(/callServer\("getWarFollowupState"/g) || []).length, 1);
  assert.doesNotMatch(followupClient, /refreshAllRosters|publishRosterData|CloudflarePublishQueue/);
});

test("permanent follow-up ignore is reversible from player controls and loaded lazily", () => {
  const adminClient = readShell("admin.js");
  const followupClient = readShell("war-followup.js");
  assert.equal((adminClient.match(/runServerMethod\("getWarFollowupTrustStatus"/g) || []).length, 2);
  assert.equal((adminClient.match(/runServerMethod\("setWarFollowupTrustedAccount"/g) || []).length, 1);
  assert.match(adminClient, /Ignore in follow-up: /);
  assert.match(followupClient, /Always ignore/);
  assert.match(followupClient, /Ignored players/);
  assert.match(followupClient, /Restore/);
  assert.equal((followupClient.match(/callServer\("setWarFollowupTrustedAccount"/g) || []).length, 2);
  assert.equal((followupClient.match(/callServer\("getWarFollowupRulesStatus"/g) || []).length, 1);
  assert.match(adminClient, /summaryBtn\.onclick[\s\S]*?loadTrustControl\(\)/);
  const activeLoadStart = adminClient.indexOf("const loadActiveRosterData");
  const activeLoadEnd = adminClient.indexOf("const applyServerSyncedPreview");
  assert.ok(activeLoadStart >= 0 && activeLoadEnd > activeLoadStart);
  assert.doesNotMatch(
    adminClient.slice(activeLoadStart, activeLoadEnd),
    /WarFollowupTrustStatus|TrustedAccount/,
  );
});
