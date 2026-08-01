import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const adminSource = readFileSync(new URL("../cloudflarePages/admin.js", import.meta.url), "utf8");

test("admin only strength-rebalances CWL prep for approved explicit controls and the roster builder", () => {
  const callLines = adminSource
    .split(/\r?\n/)
    .filter((line) => line.includes("applyCwlPreparationRebalanceLocal_("));

  assert.equal(callLines.length, 5);
  assert.equal(adminSource.includes("rebalanceAllActiveCwlPreparationRostersLocal_"), false);
  assert.equal(adminSource.includes("rebalanceRosterIfPreparationActiveLocal_"), false);
  assert.match(adminSource, /const buildCwlPrepRostersToPreviewLocal_ = \(\) => \{[\s\S]*?applyCwlPreparationRebalanceLocal_/);
});

test("passive admin data paths reconcile prep metadata without changing player placement", () => {
  assert.match(adminSource, /const applyPreviewMutation = \(msg\) => \{[\s\S]*?reconcileAllActiveCwlPreparationAssignmentsLocal_\(\);/);
  assert.match(adminSource, /const applyServerSyncedPreview = \(nextRosterData, statusMsg\) => \{[\s\S]*?reconcileAllActiveCwlPreparationAssignmentsLocal_\(\);/);
  assert.match(adminSource, /const applyImportComparison = async \(\) => \{[\s\S]*?reconcileAllActiveCwlPreparationAssignmentsLocal_\(\);/);
  assert.match(adminSource, /\$\("#publishBtn"\)\.onclick = async \(\) => \{[\s\S]*?reconcileAllActiveCwlPreparationAssignmentsLocal_\(\);/);
});

test("one-click CWL roster build is rollback-safe and verifies exact player conservation", () => {
  assert.match(adminSource, /const captureCwlPrepPlayerInventoryLocal_ = \(\) =>/);
  assert.match(adminSource, /const assertCwlPrepPlayerInventoryConservedLocal_ = \(beforeRaw, expectedRosterIdByTagRaw\) =>/);
  assert.match(adminSource, /const buildCwlPrepRostersToPreviewLocal_ = \(\) => \{[\s\S]*?const previewSnapshot = cloneJson\(state\.lastRosterData\);[\s\S]*?assertCwlPrepPlayerInventoryConservedLocal_[\s\S]*?state\.lastRosterData = previewSnapshot;/);
  assert.match(adminSource, /planCwlPrepRosterDistribution/);
  assert.match(adminSource, /setRosterPreparationDistributionLocal_/);
});
