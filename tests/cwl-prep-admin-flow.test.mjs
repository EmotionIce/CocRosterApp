import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const adminSource = readFileSync(new URL("../cloudflarePages/admin.js", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../cloudflarePages/client.js", import.meta.url), "utf8");

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
  assert.match(adminSource, /const assertCwlPrepPlayerInventoryConservedLocal_ = \(beforeRaw, expectedRosterIdByTagRaw, expectedRoleByTagRaw\) =>/);
  assert.match(adminSource, /const buildCwlPrepRostersToPreviewLocal_ = \(\) => \{[\s\S]*?const previewSnapshot = cloneJson\(state\.lastRosterData\);[\s\S]*?assertCwlPrepPlayerInventoryConservedLocal_[\s\S]*?state\.lastRosterData = previewSnapshot;/);
  assert.match(adminSource, /planCwlPrepRosterDistribution/);
  assert.match(adminSource, /setRosterPreparationDistributionLocal_/);
  assert.match(adminSource, /CWL roster build lock-state check failed for/);
  assert.match(adminSource, /CWL roster build reserve\/role check failed for/);
  assert.match(
    adminSource,
    /transferPreparationStateOnExplicitMoveLocal_\(sourceRoster, targetRoster, playerTag, \{ enforceLockedInLimit: false \}\)/,
    "Expected multi-step cascades to defer Locked-In limits until players reach their final roster",
  );
  assert.match(
    adminSource,
    /executeCwlPreferencePlanLocal_\(distributionPlan\.preferencePlan, \{\s*enforceLockedInLimit: false,?\s*\}\)/,
    "Expected global-build preference moves to defer transient per-roster Locked-In limits",
  );
  const rosterBuilder = extractTopLevelConst("buildCwlPrepRostersToPreviewLocal_");
  assert.ok(
    rosterBuilder.indexOf("reconcileAllActiveCwlPreparationAssignmentsLocal_();")
      > rosterBuilder.indexOf("distributionPlan.moves.forEach"),
    "Expected strict Locked-In reconciliation after the complete adjacent-roster cascade",
  );
});

test("one-click CWL builds preserve unavailable players in an admin-only missing reserve", () => {
  const rebalance = extractTopLevelConst("applyCwlPreparationRebalanceLocal_");
  const countAssertion = extractTopLevelConst("assertCwlPrepDistributionPlanAppliedLocal_");
  const inventoryAssertion = extractTopLevelConst("assertCwlPrepPlayerInventoryConservedLocal_");
  const strengthBuilder = extractTopLevelConst("buildCwlPrepStrengthByTagLocal_");
  const rosterBuilder = extractTopLevelConst("buildCwlPrepRostersToPreviewLocal_");

  assert.match(rebalance, /sourceSection === "missing"/);
  assert.match(rebalance, /prep\.clanAbsentTagSet && prep\.clanAbsentTagSet\[tag\]/);
  assert.match(rebalance, /rosterSafe\.missing = reservePoolEntries/);
  assert.match(countAssertion, /expectedReserveCount/);
  assert.match(countAssertion, /roster\.missing\.length !== expectedReserveCount/);
  assert.match(inventoryAssertion, /expectedRoleByTag/);
  assert.match(rosterBuilder, /distributionPlan\.finalRoleByTag/);
  assert.match(strengthBuilder, /entry\.sourceSection !== "missing" && !clanAbsentTagSet\[tag\]/);
  assert.match(clientSource, /window\.ROSTER_ADMIN_MODE[\s\S]*?Missing reserve \(excluded from build\)/);
  assert.match(adminSource, /Add back to CWL pool/);
  assert.match(adminSource, /restores the player automatically after they rejoin/);
});

test("manual missing-reserve restore moves the exact player record to subs without deleting its lock", () => {
  const executableSource = [
    extractTopLevelConst("restoreMissingPlayerToCwlPoolLocal_"),
    "restoreMissingPlayerToCwlPoolLocal_",
  ].join("\n");
  const player = { tag: "#RETURN", name: "Returnee", th: 17, notes: ["keep me"] };
  const roster = {
    id: "top",
    trackingMode: "cwl",
    main: [],
    subs: [],
    missing: [player],
    cwlPreparation: {
      enabled: true,
      lockStateByTag: { "#RETURN": "lockedOut" },
      assignedTagSet: {},
      excludedTagSet: { "#RETURN": true },
      clanAbsentTagSet: { "#RETURN": true },
      clanAbsentUpdatedAt: "2026-08-01T00:00:00.000Z",
    },
  };
  let status = "";
  const restore = vm.runInNewContext(executableSource, {
    normalizeTag: (value) => String(value || "").trim().toUpperCase(),
    findPlayerLocationByTag: () => ({ rosterIndex: 0, role: "missing", index: 0 }),
    getRosters: () => [roster],
    isCwlPreparationActiveLocal_: () => true,
    ensureRosterArrays: () => {},
    cloneJson: (value) => JSON.parse(JSON.stringify(value)),
    getRosterCwlPreparationLocal_: (value) => value.cwlPreparation,
    reindexRoster: () => {},
    reconcileCwlPreparationAssignmentsLocal_: () => {},
    pruneTagFromAllRosterPublicLineupProjectionsLocal_: () => {},
    applyPreviewMutation: (message) => { status = message; },
  });

  restore("#return");

  assert.equal(roster.missing.length, 0);
  assert.equal(roster.subs.length, 1);
  assert.equal(roster.subs[0], player, "the player object must be moved, not reconstructed");
  assert.deepEqual(roster.subs[0].notes, ["keep me"]);
  assert.equal(roster.cwlPreparation.lockStateByTag["#RETURN"], "lockedOut");
  assert.equal(roster.cwlPreparation.assignedTagSet["#RETURN"], true);
  assert.equal(roster.cwlPreparation.excludedTagSet["#RETURN"], undefined);
  assert.equal(roster.cwlPreparation.clanAbsentTagSet["#RETURN"], undefined);
  assert.equal(roster.cwlPreparation.clanAbsentUpdatedAt, undefined);
  assert.match(status, /added back to the CWL pool as a sub/);
});

test("applied role plans park absent and archived objects in reserve without reconstructing them", () => {
  const executableSource = [
    extractTopLevelConst("applyCwlPreparationRebalanceLocal_"),
    "applyCwlPreparationRebalanceLocal_",
  ].join("\n");
  const activeMain = { tag: "#MAIN", name: "Main" };
  const absent = { tag: "#ABSENT", name: "Absent", notes: ["history"] };
  const activeSub = { tag: "#SUB", name: "Sub" };
  const archived = { tag: "#ARCHIVE", name: "Archive", notes: ["retain"] };
  const roster = {
    id: "top",
    trackingMode: "cwl",
    main: [activeMain, absent],
    subs: [activeSub],
    missing: [archived],
    cwlPreparation: {
      enabled: true,
      rosterSize: 1,
      lockStateByTag: { "#ABSENT": "lockedIn" },
      assignedTagSet: {},
      excludedTagSet: {},
      clanAbsentTagSet: { "#ABSENT": true },
    },
  };
  const poolEntries = () => [
    ...roster.main.map((player, sourceOrder) => ({ tag: player.tag, player, sourceSection: "main", sourceOrder })),
    ...roster.subs.map((player, index) => ({ tag: player.tag, player, sourceSection: "subs", sourceOrder: roster.main.length + index })),
    ...roster.missing.map((player, index) => ({ tag: player.tag, player, sourceSection: "missing", sourceOrder: roster.main.length + roster.subs.length + index })),
  ];
  const apply = vm.runInNewContext(executableSource, {
    CWL_PREPARATION_MIN_ROSTER_SIZE: 1,
    CWL_PREPARATION_ALGORITHM: "test",
    ensureRosterArrays: () => {},
    normalizePreparationRosterSizeLocal_: (value) => Number(value) || 1,
    getInitialPreparationSubstituteCountLocal_: () => 0,
    sanitizeCwlPreparationRequirementsLocal_: () => ({}),
    sanitizeRosterCwlPreparationLocal_: (value) => value.cwlPreparation,
    getRosterTrackingMode: (value) => value.trackingMode,
    getRosterPoolEntriesForPreparationLocal_: poolEntries,
    buildCwlPreparationRankingLocal_: (_value, options) => ({
      ranked: options.poolEntries.map((entry) => ({ ...entry, playerStats: {} })),
      byTag: {},
    }),
    meetsCwlPreparationRequirementsLocal_: () => true,
    normalizeTag: (value) => String(value || "").trim().toUpperCase(),
    toStr: (value) => value == null ? "" : String(value),
    toNonNegativeIntLocal_: (value) => Math.max(0, Math.floor(Number(value) || 0)),
    compareTagsAscLocal_: (left, right) => String(left).localeCompare(String(right)),
    reindexRoster: () => {},
    clearSavedBenchSuggestionsForRoster_: () => {},
    clearSuggestionMarksForRoster_: () => {},
  });

  apply(roster, {
    recordAppliedAt: false,
    targetRoleByTag: {
      "#MAIN": "main",
      "#SUB": "sub",
      "#ABSENT": "missing",
      "#ARCHIVE": "missing",
    },
  });

  assert.equal(roster.main.length, 1);
  assert.equal(roster.main[0], activeMain);
  assert.equal(roster.subs.length, 1);
  assert.equal(roster.subs[0], activeSub);
  assert.equal(roster.missing[0], absent);
  assert.equal(roster.missing[1], archived);
  assert.deepEqual(roster.missing[0].notes, ["history"]);
  assert.deepEqual(roster.missing[1].notes, ["retain"]);
  assert.equal(roster.cwlPreparation.lockStateByTag["#ABSENT"], "lockedIn");
  assert.deepEqual(Object.keys(roster.cwlPreparation.assignedTagSet).sort(), ["#MAIN", "#SUB"]);
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
