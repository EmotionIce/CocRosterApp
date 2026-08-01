import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const adminSource = readFileSync(new URL("../cloudflarePages/admin.js", import.meta.url), "utf8");

const extractTopLevelConst = (name) => {
  const startMarker = `  const ${name} =`;
  const start = adminSource.indexOf(startMarker);
  assert.notEqual(start, -1, `Expected admin.js to declare ${name}`);
  const endMarker = "\n  };";
  const end = adminSource.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Expected admin.js to terminate ${name}`);
  return adminSource.slice(start, end + endMarker.length);
};

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
  assert.match(adminSource, /CWL roster build lock-state check failed for/);
  assert.match(
    adminSource,
    /transferPreparationStateOnExplicitMoveLocal_\(sourceRoster, targetRoster, playerTag, \{ enforceLockedInLimit: false \}\)/,
    "Expected multi-step cascades to defer Locked-In limits until players reach their final roster",
  );
  const rosterBuilder = extractTopLevelConst("buildCwlPrepRostersToPreviewLocal_");
  assert.ok(
    rosterBuilder.indexOf("reconcileAllActiveCwlPreparationAssignmentsLocal_();")
      > rosterBuilder.indexOf("distributionPlan.moves.forEach"),
    "Expected strict Locked-In reconciliation after the complete adjacent-roster cascade",
  );
});

test("moved CWL prep players keep Locked-In and Locked-Out state after source sanitization", () => {
  const executableSource = [
    extractTopLevelConst("transferPreparationStateOnExplicitMoveLocal_"),
    "transferPreparationStateOnExplicitMoveLocal_",
  ].join("\n");
  const sanitizeLikeProduction = (roster) => {
    const prep = roster.cwlPreparation;
    const poolTags = new Set([...(roster.main || []), ...(roster.subs || []), ...(roster.missing || [])]
      .map((player) => player && player.tag)
      .filter(Boolean));
    prep.lockStateByTag = Object.fromEntries(
      Object.entries(prep.lockStateByTag || {}).filter(([tag]) => poolTags.has(tag)),
    );
    prep.assignedTagSet = Object.fromEntries(
      Object.entries(prep.assignedTagSet || {}).filter(([tag]) => poolTags.has(tag)),
    );
    return prep;
  };
  const transfer = vm.runInNewContext(executableSource, {
    normalizeTag: (value) => String(value || "").trim().toUpperCase(),
    toStr: (value) => value == null ? "" : String(value),
    getRosterTrackingMode: (roster) => roster.trackingMode,
    getRosterCwlPreparationLocal_: sanitizeLikeProduction,
  });

  for (const lockState of ["lockedIn", "lockedOut"]) {
    const player = { tag: "#MOVE" };
    const source = {
      trackingMode: "cwl",
      main: [], subs: [], missing: [],
      cwlPreparation: {
        enabled: true,
        lockStateByTag: { "#MOVE": lockState },
        assignedTagSet: { "#MOVE": true },
        excludedTagSet: {}, clanAbsentTagSet: {},
      },
    };
    const destination = {
      trackingMode: "cwl",
      main: lockState === "lockedIn" ? [player] : [],
      subs: lockState === "lockedOut" ? [player] : [],
      missing: [],
      cwlPreparation: {
        enabled: true,
        lockStateByTag: {}, assignedTagSet: {}, excludedTagSet: {}, clanAbsentTagSet: {},
      },
    };

    transfer(source, destination, "#MOVE", { enforceLockedInLimit: false });

    assert.equal(source.cwlPreparation.lockStateByTag["#MOVE"], undefined);
    assert.equal(destination.cwlPreparation.lockStateByTag["#MOVE"], lockState);
    assert.equal(destination.cwlPreparation.assignedTagSet["#MOVE"], true);
  }

  const unlockedSource = {
    trackingMode: "cwl", main: [], subs: [], missing: [],
    cwlPreparation: {
      enabled: true, lockStateByTag: {}, assignedTagSet: { "#MOVE": true },
      excludedTagSet: {}, clanAbsentTagSet: {},
    },
  };
  const staleDestination = {
    trackingMode: "cwl", main: [{ tag: "#MOVE" }], subs: [], missing: [],
    cwlPreparation: {
      enabled: true, lockStateByTag: { "#MOVE": "lockedIn" }, assignedTagSet: {},
      excludedTagSet: {}, clanAbsentTagSet: {},
    },
  };
  transfer(unlockedSource, staleDestination, "#MOVE");
  assert.equal(staleDestination.cwlPreparation.lockStateByTag["#MOVE"], undefined);
});

test("CWL prep exposes and persists per-roster hard eligibility requirements", () => {
  const sanitizer = extractTopLevelConst("sanitizeCwlPreparationRequirementsLocal_");
  const rosterSanitizer = extractTopLevelConst("sanitizeRosterCwlPreparationLocal_");
  const setter = extractTopLevelConst("setRosterPreparationRequirementsLocal_");

  assert.match(sanitizer, /minTownHall:[\s\S]*?Math\.min\(99/);
  assert.match(sanitizer, /maxMissedAttacks:[\s\S]*?999/);
  assert.match(sanitizer, /maxMissedAttackRate:[\s\S]*?\b1\b/);
  assert.match(sanitizer, /valueRaw == null[\s\S]*?return null/);
  assert.match(rosterSanitizer, /const requirements = sanitizeCwlPreparationRequirementsLocal_\(source && source\.requirements\)/);
  assert.match(rosterSanitizer, /\n\s+requirements,/);
  assert.match(setter, /prep\.requirements = sanitizeCwlPreparationRequirementsLocal_\(requirementsRaw\)/);

  for (const className of [
    "cwl-prep-min-th-input",
    "cwl-prep-max-misses-input",
    "cwl-prep-max-miss-rate-input",
  ]) {
    assert.match(adminSource, new RegExp(className));
  }
  assert.match(adminSource, /setRosterPreparationRequirementsLocal_\(rosterId, \{[\s\S]*?minTownHall,[\s\S]*?maxMissedAttacks:[\s\S]*?maxMissedAttackRate:/);
  assert.match(adminSource, /maxMissedAttackRate: readNullable\(prepMaxMissRateInput, 100\)/);
  assert.match(adminSource, /applyPreviewMutation\("CWL prep limits updated for " \+ rosterId \+ "\."\)/);
  assert.match(
    adminSource,
    /for \(const input of \[prepMinThInput, prepMaxMissesInput, prepMaxMissRateInput\]\) \{\s*input\.disabled = !prepActive;/,
  );
});

test("CWL prep exports historical attack reliability metrics to the distribution planner", () => {
  const rankingBuilder = extractTopLevelConst("buildCwlPreparationRankingLocal_");
  const strengthExporter = extractTopLevelConst("buildCwlPrepStrengthByTagLocal_");
  const rosterBuilder = extractTopLevelConst("buildCwlPrepRostersToPreviewLocal_");

  assert.match(rankingBuilder, /state\.lastRosterData\.playerWarPerformance/);
  assert.match(rankingBuilder, /performanceEntry\.overall/);
  assert.match(rankingBuilder, /overallPerformance\.possibleAttacks/);
  assert.match(rankingBuilder, /overallPerformance\.attacksMissed/);
  assert.match(rankingBuilder, /historicalOpportunities > 0[\s\S]*?metrics\.resolvedWarDays/);
  assert.match(strengthExporter, /out\[item\.playerTag\] = \{[\s\S]*?missedAttacks:[\s\S]*?attackOpportunities:[\s\S]*?missedAttackRate:/);
  assert.match(rosterBuilder, /const strengthByTag = buildCwlPrepStrengthByTagLocal_\(\)/);
  assert.match(rosterBuilder, /const distributionPlan = planner\(\{[\s\S]*?strengthByTag,/);
});

test("CWL prep strength makes missed attacks a material ranking penalty", () => {
  const executableSource = [
    extractTopLevelConst("CWL_PREPARATION_BENCH_CONFIG"),
    extractTopLevelConst("toNonNegativeIntLocal_"),
    extractTopLevelConst("clampNumberLocal_"),
    extractTopLevelConst("normalizeUnitMetricLocal_"),
    extractTopLevelConst("shrinkTowardLocal_"),
    extractTopLevelConst("computeStrengthScoreLocal_"),
    "({ config: CWL_PREPARATION_BENCH_CONFIG, score: computeStrengthScoreLocal_ })",
  ].join("\n");
  const { config, score } = vm.runInNewContext(executableSource, Object.create(null));
  const context = { thMin: 14, thMax: 18, poolThreeStarRateMean: 0.33, poolMissRateMean: 0.1 };
  const baseStats = {
    th: 17,
    countedAttacks: 10,
    resolvedWarDays: 0,
    attackOpportunities: 10,
    starsPerf: 0.75,
    destructionPerf: 0.8,
    threeStarCount: 4,
    hitUpCount: 2,
    sameThHitCount: 6,
  };
  const reliable = score({ ...baseStats, missedAttacks: 0 }, context, config);
  const unreliable = score({ ...baseStats, missedAttacks: 5 }, context, config);

  assert.ok(config.preparationReliabilityExponent > 1);
  assert.ok(unreliable.reliability < reliable.reliability);
  assert.ok(unreliable.score < reliable.score * 0.65,
    `Expected five misses in ten opportunities to materially lower ${reliable.score}, got ${unreliable.score}`);
});

test("one-click build verifies planner main, sub, and total targets after applying the cascade", () => {
  const assertionNames = [...adminSource.matchAll(/\bconst (assertCwlPrep[A-Za-z0-9]*Local_) =/g)]
    .map((match) => match[1]);
  const targetAssertionName = assertionNames.find((name) => {
    const declaration = extractTopLevelConst(name);
    return declaration.includes("rosterResults")
      && declaration.includes("expectedMainCount")
      && declaration.includes("expectedSubCount")
      && declaration.includes("afterCount")
      && declaration.includes(".main")
      && declaration.includes(".subs");
  });

  assert.ok(targetAssertionName,
    "Expected a post-build assertion that checks each planner roster result's main, sub, and total counts");
  const rosterBuilder = extractTopLevelConst("buildCwlPrepRostersToPreviewLocal_");
  assert.match(rosterBuilder, new RegExp(`${targetAssertionName}\\([^;]*distributionPlan`));
  assert.ok(
    rosterBuilder.indexOf(`${targetAssertionName}(`) > rosterBuilder.indexOf("applyCwlPreparationRebalanceLocal_("),
    "Expected hard count checks to run after the local main/sub rebalance",
  );
  assert.ok(
    rosterBuilder.indexOf("assertCwlPrepPlayerInventoryConservedLocal_(") > rosterBuilder.indexOf(`${targetAssertionName}(`),
    "Expected exact player conservation and placement checks after hard count checks",
  );
});
