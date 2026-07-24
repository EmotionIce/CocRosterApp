import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const adminSource = readFileSync(new URL("../cloudflarePages/admin.js", import.meta.url), "utf8");

test("admin only strength-rebalances CWL prep for the approved explicit controls", () => {
  const callLines = adminSource
    .split(/\r?\n/)
    .filter((line) => line.includes("applyCwlPreparationRebalanceLocal_("));

  assert.equal(callLines.length, 4);
  assert.equal(adminSource.includes("rebalanceAllActiveCwlPreparationRostersLocal_"), false);
  assert.equal(adminSource.includes("rebalanceRosterIfPreparationActiveLocal_"), false);
});

test("passive admin data paths reconcile prep metadata without changing player placement", () => {
  assert.match(adminSource, /const applyPreviewMutation = \(msg\) => \{[\s\S]*?reconcileAllActiveCwlPreparationAssignmentsLocal_\(\);/);
  assert.match(adminSource, /const applyServerSyncedPreview = \(nextRosterData, statusMsg\) => \{[\s\S]*?reconcileAllActiveCwlPreparationAssignmentsLocal_\(\);/);
  assert.match(adminSource, /const applyImportComparison = async \(\) => \{[\s\S]*?reconcileAllActiveCwlPreparationAssignmentsLocal_\(\);/);
  assert.match(adminSource, /\$\("#publishBtn"\)\.onclick = async \(\) => \{[\s\S]*?reconcileAllActiveCwlPreparationAssignmentsLocal_\(\);/);
});
