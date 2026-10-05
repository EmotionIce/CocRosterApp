// Debug-only helpers retained from current monolith.

// Handle list Firebase data debug info.
function listFirebaseDataDebugInfo_() {
	let activeExists = false;
	let activeLastUpdatedAt = "";
	let hasLegacyRootPayload = false;
	try {
		const activeSnapshot = readActiveRosterSnapshotFromFirebase_();
		activeExists = !!(activeSnapshot && activeSnapshot.rosterData);
		activeLastUpdatedAt = String((activeSnapshot && activeSnapshot.rosterData && activeSnapshot.rosterData.lastUpdatedAt) || "").trim();
	} catch (err) {}
	try {
		hasLegacyRootPayload = !!readLegacyRootActiveRosterSnapshotOrNull_();
	} catch (err) {}
	return {
		activePath: FIREBASE_ACTIVE_PATH,
		activeExists: activeExists,
		activeLastUpdatedAt: activeLastUpdatedAt,
		hasLegacyRootPayload: hasLegacyRootPayload,
		activeVersionCount: listFirebaseChildKeys_(FIREBASE_ACTIVE_VERSIONS_PATH).length,
		autoRefreshRunShardCount: listFirebaseChildKeys_(FIREBASE_INTERNAL_AUTO_REFRESH_RUNS_PATH).length,
		publishArchiveCount: listFirebaseChildKeys_(FIREBASE_ARCHIVE_PUBLISH_PATH).length,
		autorefreshDailyCount: listFirebaseChildKeys_(FIREBASE_ARCHIVE_AUTOREFRESH_DAILY_PATH).length,
		latestAutorefreshDailyArchiveDate: findLatestAutoRefreshArchiveDate_(),
	};
}

// Create a debug player.
function createDebugPlayer_(tag, name, th, opts) {
	const options = opts && typeof opts === "object" ? opts : {};
	return {
		slot: options.isSub ? null : 1,
		name: String(name == null ? "" : name),
		discord: "",
		th: Math.max(0, toNonNegativeInt_(th)),
		tag: normalizeTag_(tag),
		notes: [],
		excludeAsSwapTarget: toBooleanFlag_(options.excludeAsSwapTarget),
		excludeAsSwapSource: toBooleanFlag_(options.excludeAsSwapSource),
	};
}

// Create a debug stats.
function createDebugStats_(opts) {
	const options = opts && typeof opts === "object" ? opts : {};
	const out = createEmptyCwlStatEntry_();
	const keys = Object.keys(out);
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		out[key] = toNonNegativeInt_(options[key]);
	}
	return out;
}

// Run focused backend checks for additive regular-war form stats.
function runRegularWarFormStatsDebugScenarios() {
	const trackedTagSet = {
		"#A": true,
		"#B": true,
		"#C": true,
	};
	const opponentThByTag = {
		"#X": 16,
		"#Y": 16,
	};
	const members = [
		{
			tag: "#A",
			townHallLevel: 16,
			attacks: [
				{ order: 1, defenderTag: "#X", stars: 3, destructionPercentage: 100 },
				{ order: 4, defenderTag: "#Y", stars: 1, destructionPercentage: 30 },
			],
		},
		{
			tag: "#B",
			townHallLevel: 16,
			attacks: [
				{ order: 2, defenderTag: "#Y", stars: 2, destructionPercentage: 60 },
				{ order: 3, defenderTag: "#Y", stars: 3, destructionPercentage: 100 },
			],
		},
		{
			tag: "#C",
			townHallLevel: 16,
			attacks: [{ order: 5, defenderTag: "#X", stars: 1, destructionPercentage: 40 }],
		},
	];
	const rawStats = buildWarStatsFromMembers_(members, 2, opponentThByTag, trackedTagSet, "regular");
	const formStats = buildFormEligibleRegularWarStatsFromMembers_(members, 2, opponentThByTag, trackedTagSet, 2);
	const ambiguousFormStats = buildFormEligibleRegularWarStatsFromMembers_(
		[
			{
				tag: "#A",
				townHallLevel: 16,
				attacks: [{ defenderTag: "#X", stars: 3, destructionPercentage: 100 }],
			},
		],
		2,
		opponentThByTag,
		{ "#A": true },
		1,
	);
	const scenarios = [
		{
			name: "post_max_attacks_stay_raw_but_leave_form_sample",
			pass:
				rawStats["#A"].countedAttacks === 2 &&
				rawStats["#A"].possibleAttacks === 2 &&
				rawStats["#A"].usedAttacks === 2 &&
				formStats["#A"].countedAttacks === 1 &&
				formStats["#A"].formEligibleAttacks === 1 &&
				rawStats["#C"].countedAttacks === 1 &&
				formStats["#C"].countedAttacks === 0 &&
				formStats["#C"].usedAttacks === 1 &&
				formStats["#C"].formEligibleAttacks === 0,
		},
		{
			name: "bad_attack_before_max_stars_still_counts",
			pass: formStats["#B"].countedAttacks === 2 && formStats["#B"].starsTotal === 5,
		},
		{
			name: "missed_attacks_remain_reliability_input",
			pass: rawStats["#C"].attacksMissed === 1 && formStats["#C"].attacksMissed === 1,
		},
		{
			name: "ambiguous_attack_order_does_not_guess_form_stats",
			pass: ambiguousFormStats === null,
		},
	];
    // Scenario to verify that explicit empty formStatsByTag clears stale form stats.
    (function() {
        // Initialize a fresh war performance object.
        const warPerf = createEmptyRosterWarPerformance_();
        const warKey = "debug-clear";
        // Initial stats and form stats for tag #A.
        const firstStatsByTag = {
            "#A": {
                attacksMade: 1,
                attacksMissed: 0,
                starsTotal: 3,
                totalDestruction: 100,
                countedAttacks: 1,
                threeStarCount: 1,
            },
        };
        // First insert includes form-specific stats.
        upsertRegularWarHistoryEntry_(warPerf, warKey, firstStatsByTag, {
            authoritative: true,
            incomplete: false,
            nowIso: "2000-01-01T00:00:00.000Z",
            formStatsByTag: firstStatsByTag,
        });
        // Second update uses different raw stats but explicitly supplies an empty formStatsByTag to clear prior form stats.
        const secondStatsByTag = {
            "#A": {
                attacksMade: 2,
                attacksMissed: 0,
                starsTotal: 5,
                totalDestruction: 150,
                countedAttacks: 2,
                threeStarCount: 1,
            },
        };
        upsertRegularWarHistoryEntry_(warPerf, warKey, secondStatsByTag, {
            authoritative: true,
            incomplete: false,
            nowIso: "2000-01-02T00:00:00.000Z",
            formStatsByTag: {},
        });
        // Evaluate whether the formStatsByTag was cleared on the history entry.
        const entry = warPerf && warPerf.regularWarHistoryByKey && warPerf.regularWarHistoryByKey[warKey];
        const cleared = entry && entry.formStatsByTag && Object.keys(entry.formStatsByTag).length === 0;
        // Evaluate whether the aggregated war performance has any form stats remaining for tag #A.
        const aggregated = warPerf && warPerf.byTag && warPerf.byTag["#A"];
        const hasAggregatedForm =
            aggregated &&
            aggregated.formStats &&
            aggregated.formStats.regular &&
            hasWarPerformanceStatsData_(aggregated.formStats.regular);
        scenarios.push({
            name: "clear_formStats_when_empty",
            pass: !!cleared && !hasAggregatedForm,
        });
    })();
	return {
		ok: scenarios.every((scenario) => !!scenario.pass),
		scenarios: scenarios,
		rawStats: rawStats,
		formStats: formStats,
	};
}

// Handle run bench planner debug scenarios.
function runBenchPlannerDebugScenarios() {
	const config = getBenchPlannerConfig_();
	const main = createDebugPlayer_("#P0L", "Main", 16);
	const sub = createDebugPlayer_("#Y0L", "Sub", 16, { isSub: true });
	const cases = [
		{ name: "good_main_stays", main: { starsTotal: 9, resolvedWarDays: 3, attacksMade: 3, countedAttacks: 3, threeStarCount: 3 }, sub: { starsTotal: 7, resolvedWarDays: 5, attacksMade: 5, countedAttacks: 5, threeStarCount: 1 }, reason: "" },
		{ name: "missed_attack_replaced", main: { starsTotal: 3, resolvedWarDays: 2, attacksMade: 1, countedAttacks: 1, missedAttacks: 1, threeStarCount: 1 }, sub: { starsTotal: 4, resolvedWarDays: 2, attacksMade: 2, countedAttacks: 2 }, reason: "missed_attack" },
		{ name: "one_star_replaced", main: { starsTotal: 2, resolvedWarDays: 2, attacksMade: 2, countedAttacks: 2 }, sub: { starsTotal: 4, resolvedWarDays: 2, attacksMade: 2, countedAttacks: 2 }, reason: "poor_performance" },
	];
	const scenarios = cases.map(function (entry) {
		const roster = { main: [main], subs: [sub], badges: { main: 1 }, cwlStats: { byTag: { "#P0L": entry.main, "#Y0L": entry.sub } } };
		const snapshot = buildCwlPlanningSnapshot_(roster, { season: "debug", remainingEditableDays: 1, nextEditableDayIndex: 0 }, config);
		const plan = solveSeasonLineupPlan_(snapshot, config);
		return { name: entry.name, pass: entry.reason ? plan.pairs.length === 1 && plan.pairs[0].reasonCode === entry.reason : plan.pairs.length === 0, pairs: plan.pairs };
	});
	return { ok: scenarios.every(function (entry) { return entry.pass; }), scenarios: scenarios };
}
