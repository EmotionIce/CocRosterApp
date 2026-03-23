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
		hasLegacyRootPayload = activeSnapshot && activeSnapshot.source === "firebase:/ (legacy-root)";
	} catch (err) {}
	return {
		activePath: FIREBASE_ACTIVE_PATH,
		activeExists: activeExists,
		activeLastUpdatedAt: activeLastUpdatedAt,
		hasLegacyRootPayload: hasLegacyRootPayload,
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

// Handle run bench planner debug scenarios.
function runBenchPlannerDebugScenarios() {
	const config = getBenchPlannerConfig_();
	// Handle run scenario.
	const runScenario = (name, roster, remainingEditableDays, check) => {
		const seasonContext = {
			source: "debug",
			season: "debug",
			totalSeasonDays: Math.max(0, toNonNegativeInt_(remainingEditableDays)),
			completedDays: 0,
			lockedDays: 0,
			remainingEditableDays: Math.max(0, toNonNegativeInt_(remainingEditableDays)),
			nextEditableDayIndex: remainingEditableDays > 0 ? 0 : -1,
			warnings: [],
		};
		const snapshot = buildCwlPlanningSnapshot_(roster, seasonContext, config);
		const plan = solveSeasonLineupPlan_(snapshot, config);
		const suggestions = deriveNextDaySwapSuggestionsFromPlan_(roster, plan, snapshot, config);
		const summary = buildBenchSuggestionSummary_(roster, plan, suggestions, snapshot, config);
		let pass = false;
		try {
			pass = !!check({
				snapshot: snapshot,
				plan: plan,
				suggestions: suggestions,
				summary: summary,
			});
		} catch (err) {
			pass = false;
		}
		return {
			name: name,
			pass: pass,
			solverMode: plan.solverMode,
			optimalTotalSlack: plan.optimalTotalSlack,
			benchTags: suggestions.benchTags,
			swapInTags: suggestions.swapInTags,
			blockedByExclusions: suggestions.blockedByExclusions,
		};
	};

	const scenario1Roster = {
		id: "dbg-1",
		title: "Scenario 1",
		badges: { main: 1, subs: 1 },
		main: [createDebugPlayer_("#P20Y", "MainWeak", 13)],
		subs: [createDebugPlayer_("#Q8LG", "SubStrong", 16, { isSub: true })],
		cwlStats: {
			season: "debug",
			byTag: {
				"#P20Y": createDebugStats_({
					starsTotal: 8,
					resolvedWarDays: 6,
					attacksMade: 6,
					missedAttacks: 1,
					threeStarCount: 0,
					totalDestruction: 420,
					countedAttacks: 6,
					hitUpCount: 0,
					sameThHitCount: 2,
					hitDownCount: 4,
				}),
				"#Q8LG": createDebugStats_({
					starsTotal: 10,
					resolvedWarDays: 4,
					attacksMade: 4,
					missedAttacks: 0,
					threeStarCount: 3,
					totalDestruction: 360,
					countedAttacks: 4,
					hitUpCount: 1,
					sameThHitCount: 2,
					hitDownCount: 1,
				}),
			},
		},
	};

	const scenario2Roster = {
		id: "dbg-2",
		title: "Scenario 2",
		badges: { main: 1, subs: 1 },
		main: [createDebugPlayer_("#Y2P8", "MainSafe", 15)],
		subs: [createDebugPlayer_("#G0CU", "SubCritical", 14, { isSub: true })],
		cwlStats: {
			season: "debug",
			byTag: {
				"#Y2P8": createDebugStats_({
					starsTotal: 10,
					resolvedWarDays: 4,
					attacksMade: 4,
					missedAttacks: 0,
					threeStarCount: 2,
					totalDestruction: 320,
					countedAttacks: 4,
				}),
				"#G0CU": createDebugStats_({
					starsTotal: 7,
					resolvedWarDays: 3,
					attacksMade: 3,
					missedAttacks: 0,
					threeStarCount: 1,
					totalDestruction: 240,
					countedAttacks: 3,
				}),
			},
		},
	};

	const scenario3Roster = {
		id: "dbg-3",
		title: "Scenario 3",
		badges: { main: 1, subs: 0 },
		main: [createDebugPlayer_("#JQ28", "PendingOnly", 14)],
		subs: [],
		cwlStats: {
			season: "debug",
			byTag: {
				"#JQ28": createDebugStats_({
					starsTotal: 6,
					resolvedWarDays: 3,
					attacksMade: 3,
					missedAttacks: 0,
					threeStarCount: 1,
					totalDestruction: 255,
					countedAttacks: 3,
					currentWarAttackPending: 1,
				}),
			},
		},
	};

	const scenario4Roster = {
		id: "dbg-4",
		title: "Scenario 4",
		badges: { main: 1, subs: 1 },
		main: [createDebugPlayer_("#L0VG", "LockedMain", 12, { excludeAsSwapSource: true })],
		subs: [createDebugPlayer_("#RCU2", "IdealSub", 16, { isSub: true })],
		cwlStats: {
			season: "debug",
			byTag: {
				"#L0VG": createDebugStats_({
					starsTotal: 10,
					resolvedWarDays: 4,
					attacksMade: 4,
					missedAttacks: 1,
					threeStarCount: 0,
					totalDestruction: 220,
					countedAttacks: 4,
				}),
				"#RCU2": createDebugStats_({
					starsTotal: 9,
					resolvedWarDays: 3,
					attacksMade: 3,
					missedAttacks: 0,
					threeStarCount: 2,
					totalDestruction: 300,
					countedAttacks: 3,
				}),
			},
		},
	};

	const scenario5Roster = {
		id: "dbg-5",
		title: "Scenario 5",
		badges: { main: 1, subs: 1 },
		main: [createDebugPlayer_("#U8P0", "NeedOneA", 14)],
		subs: [createDebugPlayer_("#V2GQ", "NeedOneB", 14, { isSub: true })],
		cwlStats: {
			season: "debug",
			byTag: {
				"#U8P0": createDebugStats_({
					starsTotal: 6,
					resolvedWarDays: 3,
					attacksMade: 3,
					missedAttacks: 0,
					threeStarCount: 1,
					totalDestruction: 255,
					countedAttacks: 3,
				}),
				"#V2GQ": createDebugStats_({
					starsTotal: 6,
					resolvedWarDays: 3,
					attacksMade: 3,
					missedAttacks: 0,
					threeStarCount: 1,
					totalDestruction: 250,
					countedAttacks: 3,
				}),
			},
		},
	};

	const scenarios = [
		runScenario("scenario_1_strength_sub", scenario1Roster, 2, (ctx) => ctx.suggestions.swapInTags.indexOf("#Q8LG") >= 0 && ctx.suggestions.benchTags.indexOf("#P20Y") >= 0),
		runScenario("scenario_2_reward_critical", scenario2Roster, 1, (ctx) => ctx.suggestions.swapInTags.indexOf("#G0CU") >= 0),
		runScenario("scenario_3_pending_neutral", scenario3Roster, 1, (ctx) => {
			const p = ctx.snapshot.playersByTag["#JQ28"];
			const penalty = p && p.strengthComponents ? Number(p.strengthComponents.reliabilityPenalty) : 1;
			return isFinite(penalty) && penalty <= 0.05;
		}),
		runScenario("scenario_4_exclusion_block", scenario4Roster, 1, (ctx) => ctx.suggestions.benchTags.indexOf("#L0VG") < 0 && ctx.suggestions.blockedByExclusions),
		runScenario("scenario_5_impossible_reward", scenario5Roster, 1, (ctx) => toNonNegativeInt_(ctx.summary && ctx.summary.plannerSummary && ctx.summary.plannerSummary.optimalTotalSlack) === 1),
	];

	return {
		ok: scenarios.every((s) => !!s.pass),
		scenarios: scenarios,
	};
}
