import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const readShell = (name) => fs.readFileSync(new URL("../cloudflarePages/" + name, import.meta.url), "utf8");
const readScriptShell = () => fs.readFileSync(new URL("../script/Admin.html", import.meta.url), "utf8");

test("admin shells both expose the CWL preference apply controls", () => {
  const requiredTokens = [
    "applyCwlPreferencesBtn",
    "cwlPreferenceApplySummary",
    "buildCwlPrepRostersBtn",
    "cwlPrepDistributionSummary",
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
    assert.equal((html.match(/id="buildCwlPrepRostersBtn"/g) || []).length, 1);
    assert.equal((html.match(/id="cwlPrepDistributionSummary"/g) || []).length, 1);
  }
});

test("admin roster preview keeps its mobile layout compact and mirrored", () => {
  const adminHtml = readShell("admin.html");
  const consoleHtml = readShell("console.html");
  const styles = readShell("styles.css");
  const verboseHelp = "CWL Prep: set retained subs or Fill to 50 on each roster";
  const extractPreviewMobileRules = (html) => {
    const start = html.indexOf("#adminTabPreview .admin-section-head--row");
    const end = html.indexOf(".admin-auth-card.is-unlocked", start);
    assert.ok(start >= 0 && end > start);
    return html.slice(start, end);
  };

  assert.equal(extractPreviewMobileRules(adminHtml), extractPreviewMobileRules(consoleHtml));
  for (const [name, html] of [["admin.html", adminHtml], ["console.html", consoleHtml]]) {
    assert.ok(!html.includes(verboseHelp), name + " still exposes the verbose CWL helper");
    assert.match(html, /styles\.css\?v=20260801a/, name);
    assert.match(html, /#adminTabPreview \.admin-section-head--row \{\s*grid-template-columns: minmax\(0, 1fr\);/, name);
    assert.match(html, /#adminTabPreview \.admin-section-actions #buildCwlPrepRostersBtn \{\s*flex-basis: 100%;/, name);
  }

  assert.match(styles, /body\.admin-shell-page \.roster-head__compact\{\s*display:none;/);
  assert.match(styles, /body\.admin-shell-page \.roster-head-metric\{[\s\S]*?display:inline-flex;/);
  assert.match(
    styles,
    /@media \(max-width: 520px\)\{[\s\S]*?body\.admin-shell-page \.roster-player-card \.player-top\{[\s\S]*?grid-template-columns:minmax\(0, 1fr\);/,
  );
  assert.match(styles, /body\.admin-shell-page \.roster-player-card \.player-admin-summary-main\{[\s\S]*?white-space:nowrap;/);
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
    const adminAssetVersion = "20260801b";
    assert.match(html, new RegExp(`admin\\.js\\?v=[^"]*${adminAssetVersion}`), name);
    assert.match(html, /client\.js\?v=[^"]*20260729a/, name);
  }
});

test("Cloudflare admin shells share the responsive command bar", () => {
  const adminHtml = readShell("admin.html");
  const consoleHtml = readShell("console.html");
  const extractCommandBar = (html) => {
    const start = html.indexOf('<section class="card admin-command-bar"');
    const end = html.indexOf("</section>", start);
    assert.ok(start >= 0 && end > start);
    return html.slice(start, end + "</section>".length);
  };

  assert.equal(extractCommandBar(adminHtml), extractCommandBar(consoleHtml));
  for (const [name, html] of [["admin.html", adminHtml], ["console.html", consoleHtml]]) {
    assert.equal((html.match(/id="adminCommandActiveSection"/g) || []).length, 1, name);
    assert.equal((html.match(/data-admin-compact-tab=/g) || []).length, 5, name);
    assert.equal((html.match(/class="admin-command-icon"/g) || []).length, 4, name);
    for (const icon of ["📥", "🔄", "🚀", "🌐"]) assert.ok(html.includes(icon), `${name} is missing ${icon}`);
    assert.match(html, /class="admin-command-footer hidden"/, name);
    assert.match(html, /@media \(max-width: 680px\)[\s\S]*?\.admin-command-tabs \{[\s\S]*?overflow-x: auto;/, name);
    assert.match(html, /admin\.js\?v=20260801b/, name);
    assert.equal((html.match(/id="publishState"/g) || []).length, 1, name);
    assert.equal((html.match(/id="publishStateTitle"/g) || []).length, 1, name);
    assert.equal((html.match(/id="publishStateDetail"/g) || []).length, 1, name);
  }

  const adminClient = readShell("admin.js");
  const visibilityStart = adminClient.indexOf("const syncAdminCompactTabsVisibility = () =>");
  const visibilityEnd = adminClient.indexOf("// Queue compact admin tab visibility sync.", visibilityStart);
  const visibilityFlow = adminClient.slice(visibilityStart, visibilityEnd);
  assert.ok(visibilityStart >= 0 && visibilityEnd > visibilityStart);
  assert.match(visibilityFlow, /panel\.classList\.contains\("is-loading-workspace"\)/);
  assert.match(visibilityFlow, /const navHasLayout = tabsRect\.width > 0 && tabsRect\.height > 0/);
  assert.match(visibilityFlow, /const navHasLeftViewport = tabsRect\.bottom <= viewportTop \+ 1;/);
  assert.doesNotMatch(visibilityFlow, /commandRect\.bottom|viewportHeight/);

  const loadingStart = adminClient.indexOf("const setAdminWorkspaceLoading_ = (loadingRaw) =>");
  const loadingEnd = adminClient.indexOf("// Sync overlay body state.", loadingStart);
  const loadingFlow = adminClient.slice(loadingStart, loadingEnd);
  assert.ok(loadingStart >= 0 && loadingEnd > loadingStart);
  assert.match(loadingFlow, /if \(loading\) \{[\s\S]*setAdminCompactTabsVisible_\(false\)/);
  assert.match(loadingFlow, /else \{[\s\S]*queueAdminCompactTabsVisibilitySync\(\)/);
});

test("every admin shell exposes the guarded active-config recovery action", () => {
  const shells = [
    ["admin.html", readShell("admin.html")],
    ["console.html", readShell("console.html")],
    ["script/Admin.html", readScriptShell()],
  ];
  for (const [name, html] of shells) {
    assert.equal((html.match(/id="loadActiveBtn"/g) || []).length, 1, name);
    assert.match(html, /id="loadActiveBtn"[^>]*disabled[^>]*>[\s\S]*?Reload active config[\s\S]*?<\/button>/, name);
  }
  const adminClient = readShell("admin.js");
  assert.match(adminClient, /loadActiveBtn\.onclick = async \(\) =>/);
  assert.match(adminClient, /await loadActiveConfigIntoPreview\(/);
  assert.match(adminClient, /state\.activeConfigReloadBusy/);
  assert.match(adminClient, /state\.previewDirty[\s\S]*window\.confirm\("Reloading active config will discard/);
});

test("admin unlock V2 authenticates before exact roster hydration and never awaits runtime repair", () => {
  const adminClient = readShell("admin.js");
  const unlockStart = adminClient.indexOf("const handleUnlock = async () =>");
  const showSkeleton = adminClient.indexOf("setAdminWorkspaceLoading_(true)", unlockStart);
  const v2Branch = adminClient.indexOf("const useV2 =", showSkeleton);
  const selectorRead = adminClient.indexOf("startAdminSelectorReadV2_(", v2Branch);
  const controlRead = adminClient.indexOf("await loadAdminUnlockControlSnapshotV2_(password)", selectorRead);
  const markAuthenticated = adminClient.indexOf("if (!showAuthenticatedWorkspace())", controlRead);
  const runtimeRepair = adminClient.indexOf("startAdminRuntimeRepairV2_(", markAuthenticated);
  const awaitSelector = adminClient.indexOf("await selectorPromise", runtimeRepair);
  const exactRoster = adminClient.indexOf("loadAdminRosterForControlSnapshotV2_(", awaitSelector);
  const applyRoster = adminClient.indexOf("applyActiveConfigIntoPreview_(", exactRoster);
  const hideSkeleton = adminClient.indexOf("setAdminWorkspaceLoading_(false)", applyRoster);

  assert.ok(unlockStart >= 0);
  assert.ok(showSkeleton > unlockStart);
  assert.ok(v2Branch > showSkeleton);
  assert.ok(selectorRead > v2Branch);
  assert.ok(controlRead > selectorRead);
  assert.ok(markAuthenticated > controlRead);
  assert.ok(runtimeRepair > markAuthenticated);
  assert.ok(awaitSelector > runtimeRepair);
  assert.ok(exactRoster > awaitSelector);
  assert.ok(applyRoster > exactRoster);
  assert.ok(hideSkeleton > applyRoster);
  assert.doesNotMatch(adminClient.slice(runtimeRepair, exactRoster), /await\s+startAdminRuntimeRepairV2_/);
  assert.doesNotMatch(adminClient.slice(v2Branch, controlRead), /loadActiveRosterData\(|getRosterData/);
  assert.match(adminClient, /runServerMethod\("getAdminUnlockSnapshotV2"/);
  assert.match(adminClient, /runServerMethod\("getAdminRosterSnapshotV2"/);
  assert.match(adminClient, /loadExactActiveVersion\(expectedVersionId/);
  assert.match(
    adminClient,
    /loadedSourceVersionId && loadedSourceVersionId !== expectedVersionId\) return null;/
  );
  assert.match(adminClient, /ADMIN_PUBLIC_SELECTOR_TIMEOUT_MS = 2500/);
  assert.match(adminClient, /ADMIN_PUBLIC_EXACT_LOAD_TIMEOUT_MS = 4000/);
  assert.match(adminClient, /runAdminPublicDataRequestWithTimeout_/);
  assert.match(adminClient, /selectorResult\.selector\.currentVersionId\)\.trim\(\) === expectedVersionId/);
  assert.match(adminClient, /attachAuthenticatedCwlLeagueSignupsV2_/);
  assert.match(adminClient, /isAdminUnlockV2Unavailable_/);
  assert.match(adminClient, /code === "ADMIN_UNLOCK_V2_DISABLED"/);
  assert.match(adminClient, /admin unlock v2 is temporarily disabled/);
  assert.match(adminClient, /state\.unlockContractVersion = ADMIN_UNLOCK_V2_SCHEMA_VERSION/);
  assert.match(adminClient, /syncPublishButtonAvailability_/);
  assert.match(adminClient, /runServerMethod\("getAdminWorkspaceBootstrap"/);
  assert.match(adminClient, /ROSTER_ADMIN_UNLOCK_V2_ENABLED === false/);
  assert.doesNotMatch(adminClient, /resolveSharedActiveVersion|previousVersionId/);
});

test("admin V2 publish is idempotent, status-driven, and stays recoverable after uncertain responses", () => {
  const adminClient = readShell("admin.js");
  assert.match(
    adminClient,
    /runServerMethod\("publishRosterDataV2", \[[\s\S]*?pending\.publishPayload,[\s\S]*?pending\.expectedSourceVersionId,[\s\S]*?publishAttemptId: pending\.requestId,[\s\S]*?includeRosterDataInResult: false/,
  );
  assert.match(adminClient, /runServerMethod\("getAdminPublishStatusV2"/);
  assert.match(adminClient, /runServerMethod\("retryAdminPublishDeliveryV2"/);
  assert.match(adminClient, /targetVersionId: "admin-publish-" \+ requestId/);
  assert.match(adminClient, /normalizeCommittedAdminPublishResult_/);
  assert.match(adminClient, /applyActiveConfigIntoPreview_\(rebasedRosterData/);
  assert.doesNotMatch(adminClient, /const canonicalRosterData = publishResult && publishResult\.rosterData/);
  assert.match(adminClient, /submittedPreviewRevision: state\.previewRevision/);
  assert.match(adminClient, /publishPayload: cloneJson\(state\.lastRosterData\)/);
  assert.match(adminClient, /state\.publishBusy = true/);
  assert.match(adminClient, /setAdminWorkspaceMutationBusy_\(true\)/);
  assert.match(adminClient, /state\.previewRevision !== pending\.submittedPreviewRevision/);
  assert.match(adminClient, /if \(useV2Publish && state\.pendingPublish\) \{[\s\S]*Retry publish/);
  assert.match(adminClient, /state\.pendingPublish\.lastError = err/);
  assert.match(adminClient, /else if \(pendingPublish\) label = "Retry publish"/);
  assert.match(adminClient, /canonicalCommitted === true[\s\S]*label = "Check delivery"/);
  assert.match(adminClient, /if \(state\.publishBusy \|\| state\.publishDeliveryBusy \|\| state\.activeConfigReloadBusy \|\| state\.bulkRefreshBusy\) return/);
  assert.match(adminClient, /if \(state\.publishBusy \|\| state\.activeConfigReloadBusy\) \{[\s\S]*current publish or active-config load/);
  assert.match(adminClient, /finally \{[\s\S]*state\.publishBusy = false[\s\S]*setAdminWorkspaceMutationBusy_\(false\)/);
  assert.match(adminClient, /ADMIN_ACTIVE_VERSION_CONFLICT_CODE/);
  assert.match(adminClient, /Nothing was written\. Reload active config before publishing\./);
  assert.match(adminClient, /Donation refresh is also running independently and does not block this roster save/);
  assert.match(adminClient, /Public delivery runs separately and may take a minute/);
  assert.equal((adminClient.match(/runServerMethod\("publishRosterDataV2"/g) || []).length, 1);
  assert.equal((adminClient.match(/runServerMethod\("publishRosterData"/g) || []).length, 1);
});

test("admin V2 surfaces partial trigger-family repair failures", () => {
  const adminClient = readShell("admin.js");
  assert.match(adminClient, /result\.status === "partial"/);
  assert.match(adminClient, /families\.permanent/);
  assert.match(adminClient, /families\.regularWarFinalization/);
  assert.match(adminClient, /Runtime verification completed partially/);
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
