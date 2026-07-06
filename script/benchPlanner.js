// Bench planner scoring and optimization logic.

// Get bench planner config.
function getBenchPlannerConfig_() {
	const out = {};
	const keys = Object.keys(CWL_BENCH_PLANNER_CONFIG);
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		out[key] = CWL_BENCH_PLANNER_CONFIG[key];
	}
	return out;
}

// Compare tags asc.
function compareTagsAsc_(a, b) {
	const left = String(a == null ? "" : a);
	const right = String(b == null ? "" : b);
	return left < right ? -1 : left > right ? 1 : 0;
}

// Handle clamp number.
function clampNumber_(value, minValue, maxValue) {
	const n = Number(value);
	if (!isFinite(n)) return Number(minValue);
	if (n < minValue) return Number(minValue);
	if (n > maxValue) return Number(maxValue);
	return n;
}

// Normalize unit metric.
function normalizeUnitMetric_(value, fallbackValue) {
	const fallback = clampNumber_(fallbackValue, 0, 1);
	const n = Number(value);
	if (!isFinite(n)) return fallback;
	return clampNumber_(n, 0, 1);
}

// Handle shrink toward.
function shrinkToward_(observedValue, priorMean, sampleSize, priorWeight) {
	const observed = Number(observedValue);
	const prior = Number(priorMean);
	const n = Math.max(0, Number(sampleSize) || 0);
	const w = Math.max(0, Number(priorWeight) || 0);
	const safeObserved = isFinite(observed) ? observed : prior;
	const safePrior = isFinite(prior) ? prior : 0;
	const denom = w + n;
	if (denom <= 0) return safePrior;
	return (w * safePrior + n * safeObserved) / denom;
}

// Deduplicate tag list.
function dedupeTagList_(tagsRaw) {
	const list = Array.isArray(tagsRaw) ? tagsRaw : [];
	const out = [];
	const seen = {};
	for (let i = 0; i < list.length; i++) {
		const tag = normalizeTag_(list[i]);
		if (!tag || seen[tag]) continue;
		seen[tag] = true;
		out.push(tag);
	}
	return out;
}

// Deduplicate string list.
function dedupeStringList_(listRaw, limit) {
	const list = Array.isArray(listRaw) ? listRaw : [];
	const maxLen = Math.max(0, toNonNegativeInt_(limit || 0));
	const out = [];
	const seen = {};
	for (let i = 0; i < list.length; i++) {
		const text = String(list[i] == null ? "" : list[i]).trim();
		if (!text || seen[text]) continue;
		seen[text] = true;
		out.push(text);
		if (maxLen > 0 && out.length >= maxLen) break;
	}
	return out;
}

// Handle list to tag set.
function listToTagSet_(listRaw) {
	const tags = Array.isArray(listRaw) ? listRaw : [];
	const out = {};
	for (let i = 0; i < tags.length; i++) {
		const tag = normalizeTag_(tags[i]);
		if (!tag) continue;
		out[tag] = true;
	}
	return out;
}

// Handle tag list diff.
function tagListDiff_(leftListRaw, rightSetRaw) {
	const leftList = Array.isArray(leftListRaw) ? leftListRaw : [];
	const rightSet = rightSetRaw && typeof rightSetRaw === "object" ? rightSetRaw : {};
	const out = [];
	const seen = {};
	for (let i = 0; i < leftList.length; i++) {
		const tag = normalizeTag_(leftList[i]);
		if (!tag || seen[tag] || rightSet[tag]) continue;
		seen[tag] = true;
		out.push(tag);
	}
	return out;
}

// Handle safe round number.
function safeRoundNumber_(value, digits) {
	const n = Number(value);
	if (!isFinite(n)) return 0;
	const p = Math.pow(10, Math.max(0, toNonNegativeInt_(digits || 0)));
	return Math.round(n * p) / p;
}

// Compute expected stars per start.
function computeExpectedStarsPerStart_(playerStats, config) {
	const stats = playerStats && typeof playerStats === "object" ? playerStats : {};
	const priorMean = isFinite(Number(config && config.priorMeanStarsPerStart)) ? Number(config.priorMeanStarsPerStart) : 2.0;
	const priorWeight = Math.max(0, Number(config && config.priorWeightAttacks) || 0);
	const minExpected = isFinite(Number(config && config.minExpectedStarsPerStart)) ? Number(config.minExpectedStarsPerStart) : 1.25;
	const maxExpected = isFinite(Number(config && config.maxExpectedStarsPerStart)) ? Number(config.maxExpectedStarsPerStart) : 2.75;
	const countedAttacks = toNonNegativeInt_(stats.countedAttacks);
	const starsTotal = toNonNegativeInt_(stats.starsTotal);
	const observedAvgStars = starsTotal / Math.max(1, countedAttacks);
	const denom = priorWeight + countedAttacks;
	const raw = denom > 0 ? (priorWeight * priorMean + countedAttacks * observedAvgStars) / denom : priorMean;
	return clampNumber_(raw, minExpected, maxExpected);
}

// Compute starts needed for reward.
function computeStartsNeededForReward_(playerStats, remainingDays, config) {
	const stats = playerStats && typeof playerStats === "object" ? playerStats : {};
	const starsTotal = toNonNegativeInt_(stats.starsTotal);
	const starsNeeded = Math.max(0, 8 - starsTotal);
	const expectedStarsPerStart = computeExpectedStarsPerStart_(stats, config);
	const startsNeeded = starsNeeded > 0 ? Math.max(0, Math.ceil(starsNeeded / Math.max(0.01, expectedStarsPerStart))) : 0;
	const remainingEditableDays = Math.max(0, toNonNegativeInt_(remainingDays));
	const rewardSlackMargin = remainingEditableDays - startsNeeded;
	return {
		starsNeeded: starsNeeded,
		expectedStarsPerStart: expectedStarsPerStart,
		startsNeeded: startsNeeded,
		rewardSlackMargin: rewardSlackMargin,
		rewardFeasible: rewardSlackMargin >= 0,
		rewardCritical: startsNeeded > 0 && rewardSlackMargin === 0,
		impossibleReward: rewardSlackMargin < 0,
	};
}

// Compute strength score.
function computeStrengthScore_(playerStats, planningContext, config) {
	const stats = playerStats && typeof playerStats === "object" ? playerStats : {};
	const ctx = planningContext && typeof planningContext === "object" ? planningContext : {};
	const weights = config && typeof config === "object" ? config : {};
	const th = toNonNegativeInt_(stats.th);
	const countedAttacks = toNonNegativeInt_(stats.countedAttacks);
	const resolvedWarDays = toNonNegativeInt_(stats.resolvedWarDays);
	const thMin = toNonNegativeInt_(ctx.thMin);
	const thMax = toNonNegativeInt_(ctx.thMax);
	const normTH = thMax > thMin ? clampNumber_((th - thMin) / (thMax - thMin), 0, 1) : 0.5;

	const starsPerfPrior = normalizeUnitMetric_(weights.starsPerfPriorMean, 0.5);
	const destructionPrior = normalizeUnitMetric_(weights.destructionPerfPriorMean, 0.5);
	const perfPriorWeight = Math.max(0, Number(weights.perfPriorWeight) || 0);
	const starsPerfRaw = normalizeUnitMetric_(stats.starsPerf, starsPerfPrior);
	const destructionPerfRaw = normalizeUnitMetric_(stats.destructionPerf, destructionPrior);
	const shrinkedStarsPerf = normalizeUnitMetric_(shrinkToward_(starsPerfRaw, starsPerfPrior, countedAttacks, perfPriorWeight), starsPerfPrior);
	const shrinkedDestructionPerf = normalizeUnitMetric_(shrinkToward_(destructionPerfRaw, destructionPrior, countedAttacks, perfPriorWeight), destructionPrior);

	const threeStarRateRaw = clampNumber_(toNonNegativeInt_(stats.threeStarCount) / Math.max(1, countedAttacks), 0, 1);
	const threeStarRateMean = normalizeUnitMetric_(ctx.poolThreeStarRateMean, 0.33);
	const shrinkedThreeStarRate = normalizeUnitMetric_(shrinkToward_(threeStarRateRaw, threeStarRateMean, countedAttacks, Math.max(0, Number(weights.threeStarRatePriorWeight) || 0)), threeStarRateMean);

	const hitUpShare = clampNumber_(toNonNegativeInt_(stats.hitUpCount) / Math.max(1, countedAttacks), 0, 1);
	const hitEvenShare = clampNumber_(toNonNegativeInt_(stats.sameThHitCount) / Math.max(1, countedAttacks), 0, 1);
	const hitUpAbility = clampNumber_(0.65 * shrinkedStarsPerf + 0.35 * hitUpShare, 0, 1);
	const hitEvenAbility = clampNumber_(0.65 * shrinkedStarsPerf + 0.35 * hitEvenShare, 0, 1);

	const missRateRaw = clampNumber_(toNonNegativeInt_(stats.missedAttacks) / Math.max(1, resolvedWarDays), 0, 1);
	const poolMissRateMean = normalizeUnitMetric_(ctx.poolMissRateMean, 0.1);
	const reliabilityPenalty = normalizeUnitMetric_(shrinkToward_(missRateRaw, poolMissRateMean, resolvedWarDays, Math.max(0, Number(weights.reliabilityPriorWeight) || 0)), poolMissRateMean);

	const score = (Number(weights.weightTH) || 0) * normTH + (Number(weights.weightStarsPerf) || 0) * shrinkedStarsPerf + (Number(weights.weightDestructionPerf) || 0) * shrinkedDestructionPerf + (Number(weights.weightThreeStarRate) || 0) * shrinkedThreeStarRate + (Number(weights.weightHitUpAbility) || 0) * hitUpAbility + (Number(weights.weightHitEvenAbility) || 0) * hitEvenAbility - (Number(weights.weightReliabilityPenalty) || 0) * reliabilityPenalty;

	return {
		score: score,
		normTH: normTH,
		shrinkedStarsPerf: shrinkedStarsPerf,
		shrinkedDestructionPerf: shrinkedDestructionPerf,
		shrinkedThreeStarRate: shrinkedThreeStarRate,
		hitUpAbility: hitUpAbility,
		hitEvenAbility: hitEvenAbility,
		reliabilityPenalty: reliabilityPenalty,
	};
}

// Build CWL season context.
function buildCwlSeasonContext_(roster, config, optionsRaw) {
	const rosterSafe = roster && typeof roster === "object" ? roster : {};
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : null;
	const prefetchOptionsProvided = !!(
		options &&
		(Object.prototype.hasOwnProperty.call(options, "prefetchedLeaguegroupRawByClanTag") ||
			Object.prototype.hasOwnProperty.call(options, "prefetchedLeaguegroupErrorByClanTag") ||
			Object.prototype.hasOwnProperty.call(options, "prefetchedCwlWarRawByTag") ||
			Object.prototype.hasOwnProperty.call(options, "prefetchedCwlWarErrorByTag"))
	);
	const prefetchedLeaguegroupRawByClanTag =
		options && options.prefetchedLeaguegroupRawByClanTag && typeof options.prefetchedLeaguegroupRawByClanTag === "object"
			? options.prefetchedLeaguegroupRawByClanTag
			: {};
	const prefetchedLeaguegroupErrorByClanTag =
		options && options.prefetchedLeaguegroupErrorByClanTag && typeof options.prefetchedLeaguegroupErrorByClanTag === "object"
			? options.prefetchedLeaguegroupErrorByClanTag
			: {};
	const prefetchedCwlWarRawByTag =
		options && options.prefetchedCwlWarRawByTag && typeof options.prefetchedCwlWarRawByTag === "object" ? options.prefetchedCwlWarRawByTag : {};
	const prefetchedCwlWarErrorByTag =
		options && options.prefetchedCwlWarErrorByTag && typeof options.prefetchedCwlWarErrorByTag === "object" ? options.prefetchedCwlWarErrorByTag : {};
	const rosterStatsByTag = rosterSafe && rosterSafe.cwlStats && rosterSafe.cwlStats.byTag && typeof rosterSafe.cwlStats.byTag === "object" ? rosterSafe.cwlStats.byTag : {};
	const defaultSeasonDays = Math.max(1, toNonNegativeInt_((config && config.defaultSeasonDays) || 7));
	let maxResolvedWarDays = 0;
	let hasPendingCurrentWarAttack = false;
	const statsTags = Object.keys(rosterStatsByTag);
	for (let i = 0; i < statsTags.length; i++) {
		const entry = sanitizeCwlStatEntry_(rosterStatsByTag[statsTags[i]]);
		maxResolvedWarDays = Math.max(maxResolvedWarDays, toNonNegativeInt_(entry.resolvedWarDays));
		if (toNonNegativeInt_(entry.currentWarAttackPending) > 0) {
			hasPendingCurrentWarAttack = true;
		}
	}

	const lockedDaysEstimate = clampNumber_(maxResolvedWarDays + (hasPendingCurrentWarAttack ? 1 : 0), 0, defaultSeasonDays);
	const seasonFromRoster = rosterSafe && rosterSafe.cwlStats && typeof rosterSafe.cwlStats.season === "string" ? rosterSafe.cwlStats.season : "";
	const fallbackContext = {
		source: "stats_estimate",
		contextSource: "stats_estimate",
		estimated: true,
		season: seasonFromRoster || "",
		totalSeasonDays: defaultSeasonDays,
		completedDays: clampNumber_(maxResolvedWarDays, 0, defaultSeasonDays),
		lockedDays: lockedDaysEstimate,
		remainingEditableDays: Math.max(0, defaultSeasonDays - lockedDaysEstimate),
		nextEditableDayIndex: defaultSeasonDays - lockedDaysEstimate > 0 ? lockedDaysEstimate : -1,
		roundStates: [],
		warnings: ["season-context-estimated"],
	};

	const clanTag = normalizeTag_(rosterSafe.connectedClanTag);
	if (!clanTag) {
		fallbackContext.warnings.push("season-context-no-connected-clan-tag");
		return fallbackContext;
	}
	const cwlCoordinatorView = typeof getCwlCoordinatorClanViewFromOptions_ === "function" ? getCwlCoordinatorClanViewFromOptions_(options || {}, clanTag) : null;
	if (cwlCoordinatorView && cwlCoordinatorView.seasonContext && typeof cwlCoordinatorView.seasonContext === "object") {
		const context = cwlCoordinatorView.seasonContext;
		return {
			source: String(context.source || "cwl_runtime"),
			contextSource: String(context.contextSource || "cwl_runtime"),
			estimated: context.estimated === true,
			season: String(context.season || seasonFromRoster || ""),
			totalSeasonDays: Math.max(1, toNonNegativeInt_(context.totalSeasonDays) || defaultSeasonDays),
			completedDays: clampNumber_(toNonNegativeInt_(context.completedDays), 0, Math.max(1, toNonNegativeInt_(context.totalSeasonDays) || defaultSeasonDays)),
			lockedDays: clampNumber_(toNonNegativeInt_(context.lockedDays), 0, Math.max(1, toNonNegativeInt_(context.totalSeasonDays) || defaultSeasonDays)),
			remainingEditableDays: Math.max(0, toNonNegativeInt_(context.remainingEditableDays)),
			nextEditableDayIndex: isFinite(Number(context.nextEditableDayIndex)) ? Math.floor(Number(context.nextEditableDayIndex)) : -1,
			roundStates: Array.isArray(context.roundStates) ? context.roundStates.slice() : [],
			warnings: Array.isArray(context.warnings) ? context.warnings.slice() : [],
		};
	}

	try {
		let leaguegroup = null;
		if (prefetchOptionsProvided) {
			if (Object.prototype.hasOwnProperty.call(prefetchedLeaguegroupErrorByClanTag, clanTag)) {
				throw prefetchedLeaguegroupErrorByClanTag[clanTag];
			}
			if (!Object.prototype.hasOwnProperty.call(prefetchedLeaguegroupRawByClanTag, clanTag)) {
				throw new Error("Missing prefetched CWL league group for clan " + clanTag + ".");
			}
			leaguegroup = prefetchedLeaguegroupRawByClanTag[clanTag];
		} else {
			leaguegroup = cocFetch_("/clans/" + encodeTagForPath_(clanTag) + "/currentwar/leaguegroup");
		}
		const rounds = Array.isArray(leaguegroup && leaguegroup.rounds) ? leaguegroup.rounds : [];
		const totalSeasonDays = rounds.length > 0 ? rounds.length : fallbackContext.totalSeasonDays;
		const roundStates = [];

		for (let i = 0; i < totalSeasonDays; i++) {
			const round = rounds[i] && typeof rounds[i] === "object" ? rounds[i] : {};
			const warTags = Array.isArray(round.warTags) ? round.warTags : [];
			let roundState = "editable";
			let foundClanWar = false;

			for (let j = 0; j < warTags.length; j++) {
				const warTag = normalizeTag_(warTags[j]);
				if (!warTag || warTag === "#0") continue;

				let war = null;
				if (prefetchOptionsProvided) {
					if (Object.prototype.hasOwnProperty.call(prefetchedCwlWarErrorByTag, warTag)) {
						const prefetchedErr = prefetchedCwlWarErrorByTag[warTag];
						if (prefetchedErr && Number(prefetchedErr.statusCode) === 404) continue;
						throw prefetchedErr;
					}
					if (!Object.prototype.hasOwnProperty.call(prefetchedCwlWarRawByTag, warTag)) {
						throw new Error("Missing prefetched CWL war for tag " + warTag + ".");
					}
					war = prefetchedCwlWarRawByTag[warTag];
				} else {
					try {
						war = cocFetch_("/clanwarleagues/wars/" + encodeTagForPath_(warTag));
					} catch (err) {
						if (err && err.statusCode === 404) continue;
						throw err;
					}
				}
				if (!pickWarSideForClan_(war, clanTag)) continue;
				foundClanWar = true;

			const warState = normalizeWarState_(war && war.state);
				if (warState === "warended") roundState = "completed";
				else if (warState === "inwar") roundState = "locked";
				else roundState = "editable";
				break;
			}

			if (!foundClanWar) {
				roundState = "editable";
			}
			roundStates.push(roundState);
		}

		let completedDays = 0;
		let lockedDays = 0;
		let remainingEditableDays = 0;
		for (let i = 0; i < roundStates.length; i++) {
			if (roundStates[i] === "completed") {
				completedDays++;
				lockedDays++;
			} else if (roundStates[i] === "locked") {
				lockedDays++;
			} else {
				remainingEditableDays++;
			}
		}

		return {
			source: "leaguegroup",
			contextSource: "leaguegroup",
			estimated: false,
			season: leaguegroup && typeof leaguegroup.season === "string" ? leaguegroup.season : seasonFromRoster || "",
			totalSeasonDays: totalSeasonDays,
			completedDays: completedDays,
			lockedDays: lockedDays,
			remainingEditableDays: remainingEditableDays,
			nextEditableDayIndex: remainingEditableDays > 0 ? roundStates.indexOf("editable") : -1,
			roundStates: roundStates,
			warnings: [],
		};
	} catch (err) {
		Logger.log("buildCwlSeasonContext_ fallback for clan %s: %s", clanTag, err && err.message ? err.message : String(err));
		fallbackContext.warnings.push("season-context-api-fallback");
		return fallbackContext;
	}
}

// Build CWL planning snapshot.
function buildCwlPlanningSnapshot_(roster, seasonContext, config) {
	const rosterSafe = roster && typeof roster === "object" ? roster : {};
	const season = seasonContext && typeof seasonContext === "object" ? seasonContext : {};
	const rosterStatsByTag = rosterSafe && rosterSafe.cwlStats && rosterSafe.cwlStats.byTag && typeof rosterSafe.cwlStats.byTag === "object" ? rosterSafe.cwlStats.byTag : {};
	const currentMainRaw = Array.isArray(rosterSafe.main) ? rosterSafe.main : [];
	const poolPlayersRaw = collectRosterUsablePlayers_(rosterSafe);
	let requestedMainSize = Number(rosterSafe && rosterSafe.badges && rosterSafe.badges.main);
	if (!isFinite(requestedMainSize)) requestedMainSize = currentMainRaw.length;
	requestedMainSize = Math.max(0, Math.floor(requestedMainSize));

	const currentMainTags = [];
	const currentMainSeen = {};
	for (let i = 0; i < currentMainRaw.length; i++) {
		const tag = normalizeTag_(currentMainRaw[i] && currentMainRaw[i].tag);
		if (!tag || currentMainSeen[tag]) continue;
		currentMainSeen[tag] = true;
		currentMainTags.push(tag);
	}
	const currentMainTagSet = listToTagSet_(currentMainTags);

	const players = [];
	const playersByTag = {};
	let thMin = Number.MAX_SAFE_INTEGER;
	let thMax = 0;
	let sumThreeStarRate = 0;
	let sumMissRate = 0;
	let countedForMeans = 0;

	for (let i = 0; i < poolPlayersRaw.length; i++) {
		const player = poolPlayersRaw[i] && typeof poolPlayersRaw[i] === "object" ? poolPlayersRaw[i] : {};
		const tag = normalizeTag_(player.tag);
		if (!tag || playersByTag[tag]) continue;

		const metrics = deriveCwlMetrics_(rosterStatsByTag[tag]);
		const rewardModel = computeStartsNeededForReward_(metrics, season.remainingEditableDays, config);
		const th = typeof player.th === "number" && isFinite(player.th) ? Math.floor(player.th) : 0;
		const next = {
			tag: tag,
			name: String(player.name == null ? "" : player.name),
			th: th,
			isCurrentMain: !!currentMainTagSet[tag],
			starsTotal: metrics.starsTotal,
			missedAttacks: metrics.missedAttacks,
			countedAttacks: metrics.countedAttacks,
			starsPerf: metrics.starsPerf,
			destructionPerf: metrics.destructionPerf,
			avgDestruction: metrics.avgDestruction,
			currentWarAttackPending: metrics.currentWarAttackPending,
			threeStarCount: metrics.threeStarCount,
			hitUpCount: metrics.hitUpCount,
			sameThHitCount: metrics.sameThHitCount,
			hitDownCount: metrics.hitDownCount,
			resolvedWarDays: metrics.resolvedWarDays,
			attacksMade: metrics.attacksMade,
			excludeAsSwapTarget: toBooleanFlag_(player.excludeAsSwapTarget),
			excludeAsSwapSource: toBooleanFlag_(player.excludeAsSwapSource),
			expectedStarsPerStart: rewardModel.expectedStarsPerStart,
			starsNeeded: rewardModel.starsNeeded,
			startsNeeded: rewardModel.startsNeeded,
			rewardSlackMargin: rewardModel.rewardSlackMargin,
			rewardFeasible: rewardModel.rewardFeasible,
			rewardCritical: rewardModel.rewardCritical,
			impossibleReward: rewardModel.impossibleReward,
			hasMissedAttackHistory: metrics.missedAttacks > 0,
			strengthScore: 0,
		};
		players.push(next);
		playersByTag[tag] = next;

		thMin = Math.min(thMin, th);
		thMax = Math.max(thMax, th);
		sumThreeStarRate += toNonNegativeInt_(metrics.threeStarCount) / Math.max(1, toNonNegativeInt_(metrics.countedAttacks));
		sumMissRate += toNonNegativeInt_(metrics.missedAttacks) / Math.max(1, toNonNegativeInt_(metrics.resolvedWarDays));
		countedForMeans++;
	}

	if (players.length === 0) thMin = 0;
	const planningContext = {
		thMin: thMin,
		thMax: thMax,
		poolThreeStarRateMean: countedForMeans > 0 ? sumThreeStarRate / countedForMeans : 0.33,
		poolMissRateMean: countedForMeans > 0 ? sumMissRate / countedForMeans : 0.1,
	};

	for (let i = 0; i < players.length; i++) {
		const strength = computeStrengthScore_(players[i], planningContext, config);
		players[i].strengthScore = strength.score;
		players[i].strengthComponents = strength;
	}

	const dedupedCurrentMainTags = [];
	for (let i = 0; i < currentMainTags.length; i++) {
		if (!playersByTag[currentMainTags[i]]) continue;
		dedupedCurrentMainTags.push(currentMainTags[i]);
	}

	const effectiveMainSize = Math.max(0, Math.min(requestedMainSize, players.length));
	const needsRewardsCount = players.filter((p) => p.starsNeeded > 0).length;

	return {
		players: players,
		playersByTag: playersByTag,
		rosterPoolSize: players.length,
		requestedMainSize: requestedMainSize,
		mainSize: effectiveMainSize,
		currentMainTags: dedupedCurrentMainTags,
		currentMainTagSet: listToTagSet_(dedupedCurrentMainTags),
		remainingEditableDays: Math.max(0, toNonNegativeInt_(season.remainingEditableDays)),
		needsRewardsCount: needsRewardsCount,
		seasonContext: season,
	};
}

// Create bench evidence accumulator.
function createBenchEvidenceAccumulator_() {
	return {
		qualityWeight: 0,
		weightedStars: 0,
		weightedDestruction: 0,
		weightedTriples: 0,
		reliabilityWeight: 0,
		weightedUsedAttacks: 0,
		weightedOpportunities: 0,
	};
}

// Return a cap multiplier for weighted samples.
function benchSampleCapMultiplier_(sampleCountRaw, capRaw) {
	const sampleCount = Math.max(0, Number(sampleCountRaw) || 0);
	const cap = Math.max(0, Number(capRaw) || 0);
	if (sampleCount <= 0 || cap <= 0 || sampleCount <= cap) return 1;
	return cap / sampleCount;
}

// Add weighted conditional attack-quality evidence.
function addBenchQualityEvidence_(acc, statsRaw, sourceWeightRaw, capAttacksRaw) {
	const stats = sanitizeWarPerformanceStatsEntry_(statsRaw);
	const attacks = Math.max(0, Number(stats.countedAttacks) || 0);
	if (!(attacks > 0)) return;
	const sourceWeight = Math.max(0, Number(sourceWeightRaw) || 0);
	if (!(sourceWeight > 0)) return;
	const multiplier = sourceWeight * benchSampleCapMultiplier_(attacks, capAttacksRaw);
	const sampleWeight = attacks * multiplier;
	acc.qualityWeight += sampleWeight;
	acc.weightedStars += (Number(stats.starsTotal) || 0) * multiplier;
	acc.weightedDestruction += (Number(stats.totalDestruction) || 0) * multiplier;
	acc.weightedTriples += (Number(stats.threeStarCount) || 0) * multiplier;
}

// Add weighted attack-use reliability evidence.
function addBenchReliabilityEvidence_(acc, usedRaw, opportunitiesRaw, sourceWeightRaw, capOpportunitiesRaw) {
	const opportunities = Math.max(0, Number(opportunitiesRaw) || 0);
	if (!(opportunities > 0)) return;
	const sourceWeight = Math.max(0, Number(sourceWeightRaw) || 0);
	if (!(sourceWeight > 0)) return;
	const multiplier = sourceWeight * benchSampleCapMultiplier_(opportunities, capOpportunitiesRaw);
	const used = clampNumber_(usedRaw, 0, opportunities);
	const sampleWeight = opportunities * multiplier;
	acc.reliabilityWeight += sampleWeight;
	acc.weightedUsedAttacks += used * multiplier;
	acc.weightedOpportunities += opportunities * multiplier;
}

// Convert current CWL stats to war-performance-shaped stats.
function mapCurrentCwlStatsToWarPerformanceStats_(entryRaw) {
	const entry = sanitizeCwlStatEntry_(entryRaw);
	const out = createEmptyWarPerformanceStats_();
	out.daysInLineup = entry.daysInLineup;
	out.resolvedWarDays = entry.resolvedWarDays;
	out.possibleAttacks = entry.resolvedWarDays;
	out.usedAttacks = entry.attacksMade;
	out.attacksMade = entry.attacksMade;
	out.attacksMissed = entry.missedAttacks;
	out.starsTotal = entry.starsTotal;
	out.totalDestruction = entry.totalDestruction;
	out.countedAttacks = entry.countedAttacks;
	out.formEligibleAttacks = entry.countedAttacks;
	out.threeStarCount = entry.threeStarCount;
	out.hitUpCount = entry.hitUpCount;
	out.sameThHitCount = entry.sameThHitCount;
	out.hitDownCount = entry.hitDownCount;
	return out;
}

// Return the best regular-war conditional-quality stats available.
function getRegularWarQualityStatsForBench_(entryRaw) {
	const entry = sanitizeWarPerformanceEntry_(entryRaw);
	const formStats = entry.formStats && typeof entry.formStats === "object" ? sanitizeWarPerformanceStatsEntry_(entry.formStats.regular) : null;
	if (formStats && hasWarPerformanceStatsData_(formStats) && toNonNegativeInt_(formStats.countedAttacks) > 0) return formStats;
	return sanitizeWarPerformanceStatsEntry_(entry.regular);
}

// Build bench history context.
function buildBenchHistoryContext_(rosterRaw, seasonRaw) {
	const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
	const season = String(seasonRaw == null ? "" : seasonRaw).trim();
	const warPerformance = sanitizeRosterWarPerformance_(roster.warPerformance) || createEmptyRosterWarPerformance_();
	const status = normalizeCwlHistoryStatus_(warPerformance.cwlHistoryStatus || (warPerformance.meta && warPerformance.meta.cwlHistoryStatus));
	const baselineSeason = String(warPerformance.cwlPreSeasonBaselineSeason || (warPerformance.meta && warPerformance.meta.cwlHistorySeason) || "").trim();
	const baselineByTag = sanitizeCwlPreSeasonBaselineByTag_(warPerformance.cwlPreSeasonBaselineByTag);
	const cleanPreviousCwlAvailable = !!(season && status === "cleanPreSeason" && baselineSeason === season);
	const warnings = [];
	let historyStatus = cleanPreviousCwlAvailable ? "clean_preseason_cwl" : "previous_cwl_ignored";
	if (!cleanPreviousCwlAvailable) {
		const hasCwlAggregate = Object.keys(buildCwlPreSeasonBaselineFromWarPerformanceByTag_(warPerformance)).length > 0;
		if (status === "activeSeasonContaminated") {
			warnings.push("cwl-history-active-season-contaminated");
			historyStatus = "active_season_cwl_history_ignored";
		} else if (hasCwlAggregate) {
			warnings.push("cwl-history-unproven-ignored");
			historyStatus = "unproven_cwl_history_ignored";
		}
	}
	return {
		warPerformance: warPerformance,
		cleanPreviousCwlAvailable: cleanPreviousCwlAvailable,
		previousCwlByTag: cleanPreviousCwlAvailable ? baselineByTag : {},
		historyStatus: historyStatus,
		warnings: warnings,
	};
}

// Compute bench attack model for one player.
function computeBenchAttackModel_(tagRaw, currentCwlStatsRaw, warPerformanceEntryRaw, previousCwlStatsRaw, configRaw) {
	const config = configRaw && typeof configRaw === "object" ? configRaw : {};
	const currentStats = mapCurrentCwlStatsToWarPerformanceStats_(currentCwlStatsRaw);
	const previousCwlStats = sanitizeWarPerformanceStatsEntry_(previousCwlStatsRaw);
	const warPerformanceEntry = sanitizeWarPerformanceEntry_(warPerformanceEntryRaw);
	const regularQualityStats = getRegularWarQualityStatsForBench_(warPerformanceEntry);
	const regularReliabilityStats = sanitizeWarPerformanceStatsEntry_(warPerformanceEntry.regular);
	const acc = createBenchEvidenceAccumulator_();

	addBenchQualityEvidence_(acc, currentStats, Number(config.currentCwlQualityWeight) || 1, 0);
	addBenchReliabilityEvidence_(
		acc,
		currentStats.usedAttacks,
		currentStats.possibleAttacks,
		Number(config.currentCwlReliabilityWeight) || 1,
		0,
	);
	addBenchQualityEvidence_(acc, previousCwlStats, Number(config.previousCwlQualityWeight) || 0, config.previousCwlMaxAttacks);
	addBenchReliabilityEvidence_(
		acc,
		previousCwlStats.usedAttacks != null ? previousCwlStats.usedAttacks : previousCwlStats.attacksMade,
		previousCwlStats.possibleAttacks || previousCwlStats.resolvedWarDays || previousCwlStats.daysInLineup,
		Number(config.previousCwlReliabilityWeight) || 0,
		config.previousCwlMaxOpportunities,
	);
	addBenchQualityEvidence_(acc, regularQualityStats, Number(config.regularWarQualityWeight) || 0, config.regularWarMaxAttacks);
	addBenchReliabilityEvidence_(
		acc,
		regularReliabilityStats.usedAttacks != null ? regularReliabilityStats.usedAttacks : regularReliabilityStats.attacksMade,
		regularReliabilityStats.possibleAttacks,
		Number(config.regularWarReliabilityWeight) || 0,
		config.regularWarMaxOpportunities,
	);

	const qualityPriorWeight = Math.max(0, Number(config.qualityPriorWeightAttacks) || 0);
	const starsPrior = isFinite(Number(config.qualityPriorMeanStarsWhenUsed)) ? Number(config.qualityPriorMeanStarsWhenUsed) : 3;
	const destructionPrior = isFinite(Number(config.qualityPriorMeanDestruction)) ? Number(config.qualityPriorMeanDestruction) : 100;
	const triplePrior = isFinite(Number(config.qualityPriorMeanThreeStarProbability)) ? Number(config.qualityPriorMeanThreeStarProbability) : 1;
	const qualityDenom = qualityPriorWeight + acc.qualityWeight;
	const expectedStarsWhenUsed =
		qualityDenom > 0 ? (qualityPriorWeight * starsPrior + acc.weightedStars) / qualityDenom : starsPrior;
	const expectedDestructionWhenUsed =
		qualityDenom > 0 ? (qualityPriorWeight * destructionPrior + acc.weightedDestruction) / qualityDenom : destructionPrior;
	const threeStarProbability =
		qualityDenom > 0 ? (qualityPriorWeight * triplePrior + acc.weightedTriples) / qualityDenom : triplePrior;

	const reliabilityPriorWeight = Math.max(0, Number(config.reliabilityPriorWeight) || 0);
	const reliabilityPriorMean = normalizeUnitMetric_(config.reliabilityPriorMean, 0.98);
	const reliabilityDenom = reliabilityPriorWeight + acc.reliabilityWeight;
	const attackUseProbability =
		reliabilityDenom > 0
			? (reliabilityPriorWeight * reliabilityPriorMean + acc.weightedUsedAttacks) / reliabilityDenom
			: reliabilityPriorMean;

	return {
		tag: normalizeTag_(tagRaw),
		expectedStarsWhenUsed: clampNumber_(expectedStarsWhenUsed, 0, 3),
		expectedDestructionWhenUsed: clampNumber_(expectedDestructionWhenUsed, 0, 100),
		threeStarProbability: normalizeUnitMetric_(threeStarProbability, 1),
		attackUseProbability: normalizeUnitMetric_(attackUseProbability, reliabilityPriorMean),
		expectedStarsPerAppearance: normalizeUnitMetric_(attackUseProbability, reliabilityPriorMean) * clampNumber_(expectedStarsWhenUsed, 0, 3),
		qualitySampleWeight: acc.qualityWeight,
		reliabilitySampleWeight: acc.reliabilityWeight,
		currentCwlAttacks: currentStats.countedAttacks,
		currentCwlOpportunities: currentStats.possibleAttacks,
		regularWarOpportunities: regularReliabilityStats.possibleAttacks,
	};
}

// Compute bench-specific player value.
function computeBenchPlayerValue_(playerRaw, attackModelRaw, configRaw) {
	const player = playerRaw && typeof playerRaw === "object" ? playerRaw : {};
	const attackModel = attackModelRaw && typeof attackModelRaw === "object" ? attackModelRaw : {};
	const config = configRaw && typeof configRaw === "object" ? configRaw : {};
	const th = Number(player.th);
	const thMin = Math.max(1, toNonNegativeInt_(config.supportedTownHallMin) || 1);
	const thMax = Math.max(thMin + 1, toNonNegativeInt_(config.supportedTownHallMax) || 18);
	const unknownTh = normalizeUnitMetric_(config.unknownTownHallNormalized, 0.5);
	const normTH = isFinite(th) && th > 0 ? clampNumber_((Math.floor(th) - thMin) / (thMax - thMin), 0, 1) : unknownTh;
	const starsNorm = clampNumber_(Number(attackModel.expectedStarsWhenUsed) / 3, 0, 1);
	const destructionNorm = clampNumber_(Number(attackModel.expectedDestructionWhenUsed) / 100, 0, 1);
	const tripleNorm = normalizeUnitMetric_(attackModel.threeStarProbability, 1);
	const reliability = normalizeUnitMetric_(attackModel.attackUseProbability, normalizeUnitMetric_(config.reliabilityPriorMean, 0.98));
	const base =
		(Number(config.benchWeightTownHall) || 0) * normTH +
		(Number(config.benchWeightStarsWhenUsed) || 0) * starsNorm +
		(Number(config.benchWeightDestructionWhenUsed) || 0) * destructionNorm +
		(Number(config.benchWeightThreeStarProbability) || 0) * tripleNorm;
	const exponent = Math.max(0.1, Number(config.benchReliabilityExponent) || 1);
	const value = base * Math.pow(reliability, exponent);
	return {
		score: value,
		normTH: normTH,
		starsNorm: starsNorm,
		destructionNorm: destructionNorm,
		threeStarProbability: tripleNorm,
		attackUseProbability: reliability,
		baseScoreBeforeReliability: base,
	};
}

// Compute reward projection for bench planning.
function computeBenchRewardProjection_(currentCwlStatsRaw, attackModelRaw, remainingDaysRaw, neverInRaw) {
	const stats = sanitizeCwlStatEntry_(currentCwlStatsRaw);
	const attackModel = attackModelRaw && typeof attackModelRaw === "object" ? attackModelRaw : {};
	const remainingDays = Math.max(0, toNonNegativeInt_(remainingDaysRaw));
	const currentStars = toNonNegativeInt_(stats.starsTotal);
	const pending = toNonNegativeInt_(stats.currentWarAttackPending) > 0;
	const base = {
		currentStars: currentStars,
		starsNeeded: Math.max(0, 8 - currentStars),
		pendingCurrentAttack: pending,
		expectedStarsPerAppearance: Math.max(0, Number(attackModel.expectedStarsPerAppearance) || 0),
		appearancesNeeded: 0,
		rewardStatus: "secured",
		individuallyFeasible: false,
		projectedComplete: currentStars >= 8,
	};
	if (neverInRaw === true) {
		base.rewardStatus = "restricted_out";
		base.projectedComplete = false;
		return base;
	}
	if (base.starsNeeded <= 0) return base;
	if (pending && currentStars + 3 >= 8) {
		base.rewardStatus = "pending_current_attack";
		base.projectedComplete = false;
		return base;
	}
	const starsNeededAfterPending = Math.max(0, 8 - (currentStars + (pending ? 3 : 0)));
	const expected = base.expectedStarsPerAppearance;
	if (!(expected > 0)) {
		base.rewardStatus = pending ? "pending_current_attack_individually_impossible" : "individually_impossible";
		return base;
	}
	const appearancesNeeded = Math.max(0, Math.ceil(starsNeededAfterPending / expected));
	base.appearancesNeeded = appearancesNeeded;
	base.individuallyFeasible = appearancesNeeded > 0 && appearancesNeeded <= remainingDays;
	base.projectedComplete = base.individuallyFeasible;
	if (base.individuallyFeasible) {
		base.rewardStatus = pending ? "pending_current_attack_individually_feasible" : "individually_feasible";
	} else {
		base.rewardStatus = pending ? "pending_current_attack_individually_impossible" : "individually_impossible";
	}
	return base;
}

// Order a selected target lineup deterministically, retaining current main order first.
function orderTargetMainTags_(selectedSet, snapshot) {
	const set = selectedSet && typeof selectedSet === "object" ? selectedSet : {};
	const currentMainTags = Array.isArray(snapshot && snapshot.currentMainTags) ? snapshot.currentMainTags : [];
	const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
	const out = [];
	const seen = {};
	const mainSize = Math.max(0, toNonNegativeInt_(snapshot && snapshot.mainSize));
	for (let i = 0; i < currentMainTags.length && out.length < mainSize; i++) {
		const tag = normalizeTag_(currentMainTags[i]);
		if (!tag || !set[tag] || seen[tag]) continue;
		seen[tag] = true;
		out.push(tag);
	}
	const rest = players
		.filter((p) => p && set[p.tag] && !seen[p.tag])
		.sort((a, b) => {
			if ((Number(a.lineupValue) || 0) !== (Number(b.lineupValue) || 0)) return (Number(b.lineupValue) || 0) - (Number(a.lineupValue) || 0);
			return compareTagsAsc_(a.tag, b.tag);
		});
	for (let i = 0; i < rest.length && out.length < mainSize; i++) {
		seen[rest[i].tag] = true;
		out.push(rest[i].tag);
	}
	return out;
}

// Build CWL planning snapshot (v2).
function buildCwlPlanningSnapshot_(roster, seasonContext, config) {
	const rosterSafe = roster && typeof roster === "object" ? roster : {};
	const season = seasonContext && typeof seasonContext === "object" ? seasonContext : {};
	const rosterStatsByTag = rosterSafe && rosterSafe.cwlStats && rosterSafe.cwlStats.byTag && typeof rosterSafe.cwlStats.byTag === "object" ? rosterSafe.cwlStats.byTag : {};
	const currentMainRaw = Array.isArray(rosterSafe.main) ? rosterSafe.main : [];
	const poolPlayersRaw = collectRosterUsablePlayers_(rosterSafe);
	let requestedMainSize = Number(rosterSafe && rosterSafe.badges && rosterSafe.badges.main);
	if (!isFinite(requestedMainSize)) requestedMainSize = currentMainRaw.length;
	requestedMainSize = Math.max(0, Math.floor(requestedMainSize));

	const currentMainTags = [];
	const currentMainSeen = {};
	for (let i = 0; i < currentMainRaw.length; i++) {
		const tag = normalizeTag_(currentMainRaw[i] && currentMainRaw[i].tag);
		if (!tag || currentMainSeen[tag]) continue;
		currentMainSeen[tag] = true;
		currentMainTags.push(tag);
	}
	const currentMainTagSet = listToTagSet_(currentMainTags);
	const historyContext = buildBenchHistoryContext_(rosterSafe, season.season);
	const warPerformance = historyContext.warPerformance || {};
	const warPerformanceByTag = warPerformance.byTag && typeof warPerformance.byTag === "object" ? warPerformance.byTag : {};
	const previousCwlByTag = historyContext.previousCwlByTag && typeof historyContext.previousCwlByTag === "object" ? historyContext.previousCwlByTag : {};

	const players = [];
	const playersByTag = {};
	for (let i = 0; i < poolPlayersRaw.length; i++) {
		const player = poolPlayersRaw[i] && typeof poolPlayersRaw[i] === "object" ? poolPlayersRaw[i] : {};
		const tag = normalizeTag_(player.tag);
		if (!tag || playersByTag[tag]) continue;
		const th = typeof player.th === "number" && isFinite(player.th) ? Math.floor(player.th) : 0;
		const alwaysIn = toBooleanFlag_(player.excludeAsSwapSource);
		const neverIn = toBooleanFlag_(player.excludeAsSwapTarget);
		const currentStats = sanitizeCwlStatEntry_(rosterStatsByTag[tag]);
		const attackModel = computeBenchAttackModel_(tag, currentStats, warPerformanceByTag[tag], previousCwlByTag[tag], config);
		const value = computeBenchPlayerValue_({ th: th }, attackModel, config);
		const reward = computeBenchRewardProjection_(currentStats, attackModel, season.remainingEditableDays, neverIn);
		const next = {
			tag: tag,
			name: String(player.name == null ? "" : player.name),
			th: th,
			isCurrentMain: !!currentMainTagSet[tag],
			alwaysIn: alwaysIn,
			neverIn: neverIn,
			excludeAsSwapSource: alwaysIn,
			excludeAsSwapTarget: neverIn,
			starsTotal: currentStats.starsTotal,
			currentWarAttackPending: currentStats.currentWarAttackPending,
			missedAttacks: currentStats.missedAttacks,
			countedAttacks: currentStats.countedAttacks,
			resolvedWarDays: currentStats.resolvedWarDays,
			attacksMade: currentStats.attacksMade,
			attackModel: attackModel,
			expectedStarsPerStart: attackModel.expectedStarsPerAppearance,
			expectedStarsPerAppearance: attackModel.expectedStarsPerAppearance,
			attackUseProbability: attackModel.attackUseProbability,
			expectedStarsWhenUsed: attackModel.expectedStarsWhenUsed,
			expectedDestructionWhenUsed: attackModel.expectedDestructionWhenUsed,
			threeStarProbability: attackModel.threeStarProbability,
			starsNeeded: reward.starsNeeded,
			startsNeeded: reward.appearancesNeeded,
			appearancesNeeded: reward.appearancesNeeded,
			rewardStatus: reward.rewardStatus,
			rewardProjection: reward,
			lineupValue: value.score,
			strengthScore: value.score,
			strengthComponents: value,
			hasMissedAttackHistory: currentStats.missedAttacks > 0 || (warPerformanceByTag[tag] && sanitizeWarPerformanceEntry_(warPerformanceByTag[tag]).regular.attacksMissed > 0),
		};
		players.push(next);
		playersByTag[tag] = next;
	}

	const dedupedCurrentMainTags = [];
	for (let i = 0; i < currentMainTags.length; i++) {
		if (!playersByTag[currentMainTags[i]]) continue;
		dedupedCurrentMainTags.push(currentMainTags[i]);
	}
	const needsRewardsCount = players.filter((p) => p.starsNeeded > 0 && p.rewardStatus !== "restricted_out").length;
	return {
		players: players,
		playersByTag: playersByTag,
		rosterPoolSize: players.length,
		requestedMainSize: requestedMainSize,
		mainSize: requestedMainSize,
		currentMainTags: dedupedCurrentMainTags,
		currentMainTagSet: listToTagSet_(dedupedCurrentMainTags),
		remainingEditableDays: Math.max(0, toNonNegativeInt_(season.remainingEditableDays)),
		nextEditableDayIndex: typeof season.nextEditableDayIndex === "number" && isFinite(season.nextEditableDayIndex) ? Math.floor(season.nextEditableDayIndex) : -1,
		needsRewardsCount: needsRewardsCount,
		seasonContext: season,
		historyContext: historyContext,
	};
}

// Build no-op exact plan.
function buildBenchNoopPlan_(snapshot, warningsRaw, reasonRaw) {
	const currentMainTags = dedupeTagList_(snapshot && snapshot.currentMainTags);
	const warnings = dedupeStringList_(warningsRaw, 30);
	return {
		dayAssignments: currentMainTags.length ? [currentMainTags.slice()] : [],
		targetMainTags: currentMainTags.slice(),
		actionableTargetMainTags: currentMainTags.slice(),
		startCountsByTag: {},
		selectedRewardTags: [],
		projectedRewardCompleteTags: [],
		securedRewardTags: [],
		requiredNextRewardTags: [],
		capacityNextRewardTags: [],
		selectedLaterRewardTags: [],
		rewardStatusByTag: {},
		solverMode: "none",
		invalidConstraints: reasonRaw ? true : false,
		invalidReason: String(reasonRaw || ""),
		warnings: warnings,
		optionalSwapCount: 0,
		optionalSwapByInTag: {},
		optionalSwapByOutTag: {},
		mandatoryReasonByTag: {},
		totalStrength: 0,
	};
}

// Validate hard bench-planning constraints.
function validateBenchPlanningConstraints_(snapshot) {
	const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
	const mainSize = Math.max(0, toNonNegativeInt_(snapshot && snapshot.mainSize));
	const warnings = [];
	const alwaysTags = [];
	let eligibleCount = 0;
	for (let i = 0; i < players.length; i++) {
		const player = players[i];
		if (player.alwaysIn && player.neverIn) warnings.push("restriction-conflict:" + player.tag);
		if (player.alwaysIn) alwaysTags.push(player.tag);
		if (!player.neverIn) eligibleCount++;
	}
	if (mainSize <= 0) warnings.push("invalid-lineup-size");
	if (mainSize > players.length) warnings.push("lineup-size-exceeds-usable-pool");
	if (alwaysTags.length > mainSize) warnings.push("too-many-always-in-players");
	if (eligibleCount < mainSize) warnings.push("too-few-eligible-players");
	return {
		valid: warnings.length === 0,
		warnings: warnings,
	};
}

// Return whether reward DP state A is better than B.
function isBetterRewardDpState_(a, b) {
	if (!b) return true;
	if (!a) return false;
	if (a.completed !== b.completed) return a.completed > b.completed;
	if (a.used !== b.used) return a.used < b.used;
	if (a.valueInt !== b.valueInt) return a.valueInt > b.valueInt;
	if (a.currentMainCount !== b.currentMainCount) return a.currentMainCount > b.currentMainCount;
	return String(a.sig || "") < String(b.sig || "");
}

// Optimize reward completions exactly with bounded dynamic programming.
function optimizeRewardCompletionsExact_(snapshot, config) {
	const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
	const days = Math.max(0, toNonNegativeInt_(snapshot && snapshot.remainingEditableDays));
	const mainSize = Math.max(0, toNonNegativeInt_(snapshot && snapshot.mainSize));
	const alwaysPlayers = players.filter((p) => p.alwaysIn && !p.neverIn);
	const perDayCapacity = Math.max(0, mainSize - alwaysPlayers.length);
	const capacity = perDayCapacity * days;
	const scale = Math.max(1, toNonNegativeInt_(config && config.rewardSelectionValueScale) || 100000);
	const selectedSet = {};
	const requiredAppearancesByTag = {};
	const projectedRewardCompleteTags = [];
	const securedRewardTags = [];
	const rewardStatusByTag = {};
	const warnings = [];

	for (let i = 0; i < players.length; i++) {
		const player = players[i];
		rewardStatusByTag[player.tag] = String(player.rewardStatus || "");
		if (player.rewardStatus === "secured") securedRewardTags.push(player.tag);
		if (player.alwaysIn && !player.neverIn && player.starsNeeded > 0 && player.appearancesNeeded > 0 && player.appearancesNeeded <= days) {
			rewardStatusByTag[player.tag] = "selected_projected_complete";
			projectedRewardCompleteTags.push(player.tag);
		}
	}

	const candidates = players
		.filter((p) => !p.alwaysIn && !p.neverIn && p.appearancesNeeded > 0 && p.appearancesNeeded <= days && p.rewardProjection && p.rewardProjection.individuallyFeasible)
		.sort((a, b) => compareTagsAsc_(a.tag, b.tag));

	let dp = [];
	dp[0] = {
		completed: 0,
		used: 0,
		valueInt: 0,
		currentMainCount: 0,
		sig: "",
		selectedTags: [],
	};

	for (let i = 0; i < candidates.length; i++) {
		const player = candidates[i];
		const need = Math.max(0, toNonNegativeInt_(player.appearancesNeeded));
		const contribution = Math.round((Number(player.lineupValue) || 0) * need * scale);
		const next = dp.slice();
		for (let used = 0; used <= capacity; used++) {
			const state = dp[used];
			if (!state) continue;
			const nextUsed = used + need;
			if (nextUsed > capacity) continue;
			const selectedTags = state.selectedTags.concat([player.tag]);
			const candidateState = {
				completed: state.completed + 1,
				used: state.used + need,
				valueInt: state.valueInt + contribution,
				currentMainCount: state.currentMainCount + (player.isCurrentMain ? 1 : 0),
				sig: selectedTags.join(","),
				selectedTags: selectedTags,
			};
			if (isBetterRewardDpState_(candidateState, next[nextUsed])) next[nextUsed] = candidateState;
		}
		dp = next;
	}

	let best = null;
	for (let used = 0; used <= capacity; used++) {
		if (isBetterRewardDpState_(dp[used], best)) best = dp[used];
	}
	const selectedTags = best && Array.isArray(best.selectedTags) ? best.selectedTags.slice() : [];
	for (let i = 0; i < selectedTags.length; i++) {
		const tag = selectedTags[i];
		const player = snapshot.playersByTag[tag];
		if (!player) continue;
		selectedSet[tag] = true;
		requiredAppearancesByTag[tag] = toNonNegativeInt_(player.appearancesNeeded);
		rewardStatusByTag[tag] = "selected_projected_complete";
		projectedRewardCompleteTags.push(tag);
	}

	for (let i = 0; i < candidates.length; i++) {
		const player = candidates[i];
		if (selectedSet[player.tag]) continue;
		if (rewardStatusByTag[player.tag] === "individually_feasible" || rewardStatusByTag[player.tag] === "pending_current_attack_individually_feasible") {
			rewardStatusByTag[player.tag] = "feasible_shared_capacity_blocked";
		}
	}

	return {
		selectedSet: selectedSet,
		selectedRewardTags: selectedTags,
		requiredAppearancesByTag: requiredAppearancesByTag,
		projectedRewardCompleteTags: dedupeTagList_(projectedRewardCompleteTags),
		securedRewardTags: dedupeTagList_(securedRewardTags),
		rewardStatusByTag: rewardStatusByTag,
		capacity: capacity,
		perDayCapacity: perDayCapacity,
		usedAppearances: best ? best.used : 0,
		projectedCompletionCount: (best ? best.completed : 0) + projectedRewardCompleteTags.filter((tag) => !selectedSet[tag]).length,
		warnings: warnings,
	};
}

// Return whether baseline DP state A is better than B.
function isBetterBaselineDpState_(a, b) {
	if (!b) return true;
	if (!a) return false;
	if (a.currentMainCount !== b.currentMainCount) return a.currentMainCount > b.currentMainCount;
	if (a.rewardPriority !== b.rewardPriority) return a.rewardPriority > b.rewardPriority;
	if (a.valueInt !== b.valueInt) return a.valueInt > b.valueInt;
	return String(a.sig || "") < String(b.sig || "");
}

// Check selected reward schedule feasibility after choosing next lineup.
function isNextLineupScheduleFeasible_(snapshot, rewardPlan, targetSetRaw) {
	const targetSet = targetSetRaw && typeof targetSetRaw === "object" ? targetSetRaw : {};
	const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
	const days = Math.max(0, toNonNegativeInt_(snapshot && snapshot.remainingEditableDays));
	const mainSize = Math.max(0, toNonNegativeInt_(snapshot && snapshot.mainSize));
	let alwaysCount = 0;
	for (let i = 0; i < players.length; i++) {
		const player = players[i];
		if (player.alwaysIn && !player.neverIn) {
			alwaysCount++;
			if (!targetSet[player.tag]) return false;
		}
		if (player.neverIn && targetSet[player.tag]) return false;
	}
	if (Object.keys(targetSet).length !== mainSize) return false;
	if (days <= 0) return false;
	const requiredByTag = rewardPlan && rewardPlan.requiredAppearancesByTag && typeof rewardPlan.requiredAppearancesByTag === "object" ? rewardPlan.requiredAppearancesByTag : {};
	const futureCapacity = Math.max(0, days - 1) * Math.max(0, mainSize - alwaysCount);
	let futureNeeded = 0;
	const tags = Object.keys(requiredByTag);
	for (let i = 0; i < tags.length; i++) {
		const tag = normalizeTag_(tags[i]);
		if (!tag) continue;
		const needed = toNonNegativeInt_(requiredByTag[tag]);
		const remaining = Math.max(0, needed - (targetSet[tag] ? 1 : 0));
		if (remaining > Math.max(0, days - 1)) return false;
		futureNeeded += remaining;
	}
	return futureNeeded <= futureCapacity;
}

// Build exact baseline next lineup.
function buildExactBaselineLineup_(snapshot, rewardPlan, config) {
	const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
	const playersByTag = snapshot && snapshot.playersByTag && typeof snapshot.playersByTag === "object" ? snapshot.playersByTag : {};
	const days = Math.max(0, toNonNegativeInt_(snapshot && snapshot.remainingEditableDays));
	const mainSize = Math.max(0, toNonNegativeInt_(snapshot && snapshot.mainSize));
	const selectedSet = rewardPlan && rewardPlan.selectedSet && typeof rewardPlan.selectedSet === "object" ? rewardPlan.selectedSet : {};
	const requiredByTag = rewardPlan && rewardPlan.requiredAppearancesByTag && typeof rewardPlan.requiredAppearancesByTag === "object" ? rewardPlan.requiredAppearancesByTag : {};
	const forcedSet = {};
	const requiredSet = {};
	const targetSet = {};
	const mandatoryReasonByTag = {};
	let alwaysCount = 0;

	for (let i = 0; i < players.length; i++) {
		const player = players[i];
		if (player.alwaysIn && !player.neverIn) {
			forcedSet[player.tag] = true;
			requiredSet[player.tag] = true;
			targetSet[player.tag] = true;
			mandatoryReasonByTag[player.tag] = "restriction_always_in";
			alwaysCount++;
		}
	}

	const selectedTags = Object.keys(selectedSet).sort(compareTagsAsc_);
	let selectedRequiredAppearances = 0;
	for (let i = 0; i < selectedTags.length; i++) selectedRequiredAppearances += toNonNegativeInt_(requiredByTag[selectedTags[i]]);
	const futureCapacity = Math.max(0, days - 1) * Math.max(0, mainSize - alwaysCount);
	const minSelectedRewardToday = Math.max(0, selectedRequiredAppearances - futureCapacity);
	let requiredRewardToday = 0;
	const requiredNextRewardTags = [];

	for (let i = 0; i < selectedTags.length; i++) {
		const tag = selectedTags[i];
		const needed = toNonNegativeInt_(requiredByTag[tag]);
		if (needed >= days && needed > 0) {
			requiredSet[tag] = true;
			targetSet[tag] = true;
			mandatoryReasonByTag[tag] = "reward_required_next";
			requiredRewardToday++;
			requiredNextRewardTags.push(tag);
		}
	}

	const requiredTags = Object.keys(requiredSet).sort(compareTagsAsc_);
	if (requiredTags.length > mainSize) {
		return { ok: false, warning: "required-next-lineup-exceeds-size" };
	}

	const remainingSlots = mainSize - requiredTags.length;
	const additionalRewardNeeded = Math.max(0, minSelectedRewardToday - requiredRewardToday);
	const rewardCap = additionalRewardNeeded;
	const scale = Math.max(1, toNonNegativeInt_(config && config.baselineValueScale) || 100000);
	let dp = {};
	dp["0|0"] = {
		currentMainCount: 0,
		rewardPriority: 0,
		valueInt: 0,
		sig: "",
		tags: [],
	};

	const candidates = players
		.filter((p) => !requiredSet[p.tag] && !p.neverIn)
		.sort((a, b) => compareTagsAsc_(a.tag, b.tag));

	for (let i = 0; i < candidates.length; i++) {
		const player = candidates[i];
		const next = {};
		const keys = Object.keys(dp);
		for (let j = 0; j < keys.length; j++) next[keys[j]] = dp[keys[j]];
		for (let j = 0; j < keys.length; j++) {
			const key = keys[j];
			const state = dp[key];
			const parts = key.split("|");
			const count = toNonNegativeInt_(parts[0]);
			const rewardCount = toNonNegativeInt_(parts[1]);
			if (count >= remainingSlots) continue;
			const isSelectedReward = !!selectedSet[player.tag] && toNonNegativeInt_(requiredByTag[player.tag]) > 0;
			const nextRewardCount = Math.min(rewardCap, rewardCount + (isSelectedReward ? 1 : 0));
			const nextCount = count + 1;
			const rewardSlack = Math.max(0, days - toNonNegativeInt_(requiredByTag[player.tag]));
			const rewardPriority = isSelectedReward ? 100000 - rewardSlack * 100 + toNonNegativeInt_(requiredByTag[player.tag]) : 0;
			const tags = state.tags.concat([player.tag]);
			const candidateState = {
				currentMainCount: state.currentMainCount + (player.isCurrentMain ? 1 : 0),
				rewardPriority: state.rewardPriority + rewardPriority,
				valueInt: state.valueInt + Math.round((Number(player.lineupValue) || 0) * scale),
				sig: tags.join(","),
				tags: tags,
			};
			const nextKey = nextCount + "|" + nextRewardCount;
			if (isBetterBaselineDpState_(candidateState, next[nextKey])) next[nextKey] = candidateState;
		}
		dp = next;
	}

	const finalState = dp[remainingSlots + "|" + rewardCap];
	if (!finalState) return { ok: false, warning: "baseline-lineup-infeasible" };
	for (let i = 0; i < finalState.tags.length; i++) targetSet[finalState.tags[i]] = true;

	const capacityNextRewardTags = [];
	const selectedToday = selectedTags.filter((tag) => targetSet[tag] && !requiredSet[tag]).sort((a, b) => {
		const pa = playersByTag[a] || {};
		const pb = playersByTag[b] || {};
		const aNeed = toNonNegativeInt_(requiredByTag[a]);
		const bNeed = toNonNegativeInt_(requiredByTag[b]);
		if (aNeed !== bNeed) return bNeed - aNeed;
		if ((Number(pa.lineupValue) || 0) !== (Number(pb.lineupValue) || 0)) return (Number(pb.lineupValue) || 0) - (Number(pa.lineupValue) || 0);
		return compareTagsAsc_(a, b);
	});
	for (let i = 0; i < selectedToday.length && i < additionalRewardNeeded; i++) {
		capacityNextRewardTags.push(selectedToday[i]);
		mandatoryReasonByTag[selectedToday[i]] = "reward_capacity";
	}

	if (!isNextLineupScheduleFeasible_(snapshot, rewardPlan, targetSet)) return { ok: false, warning: "selected-reward-schedule-infeasible" };
	const targetMainTags = orderTargetMainTags_(targetSet, snapshot);
	return {
		ok: true,
		targetSet: listToTagSet_(targetMainTags),
		targetMainTags: targetMainTags,
		requiredNextRewardTags: dedupeTagList_(requiredNextRewardTags),
		capacityNextRewardTags: dedupeTagList_(capacityNextRewardTags),
		mandatoryReasonByTag: mandatoryReasonByTag,
	};
}

// Apply capped optional one-for-one upgrades.
function applyOptionalBenchUpgrades_(snapshot, rewardPlan, baselineRaw, config) {
	const baseline = baselineRaw && typeof baselineRaw === "object" ? baselineRaw : {};
	const targetSet = baseline.targetSet && typeof baseline.targetSet === "object" ? Object.assign({}, baseline.targetSet) : {};
	const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
	const playersByTag = snapshot && snapshot.playersByTag && typeof snapshot.playersByTag === "object" ? snapshot.playersByTag : {};
	const maxSwaps = Math.max(0, toNonNegativeInt_(config && config.maxOptionalSwaps) || 0);
	const threshold = Math.max(0, Number(config && config.optionalSwapMinScoreDelta) || 0);
	const optionalByIn = {};
	const optionalByOut = {};
	let optionalCount = 0;

	if (snapshot && snapshot.seasonContext && snapshot.seasonContext.estimated === true) {
		return {
			targetSet: targetSet,
			targetMainTags: orderTargetMainTags_(targetSet, snapshot),
			optionalSwapCount: 0,
			optionalSwapByInTag: optionalByIn,
			optionalSwapByOutTag: optionalByOut,
			warnings: ["optional-swaps-suppressed-estimated-context"],
		};
	}

	while (optionalCount < maxSwaps) {
		const targetTags = Object.keys(targetSet);
		const inCandidates = players.filter((p) => !targetSet[p.tag] && !p.neverIn);
		const outCandidates = targetTags.map((tag) => playersByTag[tag]).filter((p) => p && !p.alwaysIn);
		let best = null;
		for (let i = 0; i < inCandidates.length; i++) {
			const inPlayer = inCandidates[i];
			for (let j = 0; j < outCandidates.length; j++) {
				const outPlayer = outCandidates[j];
				if (!outPlayer || inPlayer.tag === outPlayer.tag) continue;
				const delta = (Number(inPlayer.lineupValue) || 0) - (Number(outPlayer.lineupValue) || 0);
				if (!(delta >= threshold)) continue;
				const nextSet = Object.assign({}, targetSet);
				delete nextSet[outPlayer.tag];
				nextSet[inPlayer.tag] = true;
				if (!isNextLineupScheduleFeasible_(snapshot, rewardPlan, nextSet)) continue;
				const reliabilityDelta = (Number(inPlayer.attackUseProbability) || 0) - (Number(outPlayer.attackUseProbability) || 0);
				const candidate = {
					inTag: inPlayer.tag,
					outTag: outPlayer.tag,
					scoreDelta: delta,
					reliabilityDelta: reliabilityDelta,
				};
				if (
					!best ||
					candidate.scoreDelta > best.scoreDelta ||
					(candidate.scoreDelta === best.scoreDelta && candidate.reliabilityDelta > best.reliabilityDelta) ||
					(candidate.scoreDelta === best.scoreDelta && candidate.reliabilityDelta === best.reliabilityDelta && compareTagsAsc_(candidate.inTag + "|" + candidate.outTag, best.inTag + "|" + best.outTag) < 0)
				) {
					best = candidate;
				}
			}
		}
		if (!best) break;
		delete targetSet[best.outTag];
		targetSet[best.inTag] = true;
		optionalByIn[best.inTag] = best;
		optionalByOut[best.outTag] = best;
		optionalCount++;
	}

	return {
		targetSet: targetSet,
		targetMainTags: orderTargetMainTags_(targetSet, snapshot),
		optionalSwapCount: optionalCount,
		optionalSwapByInTag: optionalByIn,
		optionalSwapByOutTag: optionalByOut,
		warnings: [],
	};
}

// Solve season lineup plan (v2).
function solveSeasonLineupPlan_(snapshot, config) {
	const warnings = [];
	const seasonWarnings = snapshot && snapshot.seasonContext && Array.isArray(snapshot.seasonContext.warnings) ? snapshot.seasonContext.warnings : [];
	for (let i = 0; i < seasonWarnings.length; i++) warnings.push(seasonWarnings[i]);
	const historyWarnings = snapshot && snapshot.historyContext && Array.isArray(snapshot.historyContext.warnings) ? snapshot.historyContext.warnings : [];
	for (let i = 0; i < historyWarnings.length; i++) warnings.push(historyWarnings[i]);
	const remainingEditableDays = Math.max(0, toNonNegativeInt_(snapshot && snapshot.remainingEditableDays));
	if (remainingEditableDays <= 0) {
		warnings.push("no-editable-cwl-round");
		return buildBenchNoopPlan_(snapshot, warnings, "");
	}
	const constraints = validateBenchPlanningConstraints_(snapshot);
	for (let i = 0; i < constraints.warnings.length; i++) warnings.push(constraints.warnings[i]);
	if (!constraints.valid) {
		return buildBenchNoopPlan_(snapshot, warnings, "invalid_constraints");
	}

	const rewardPlan = optimizeRewardCompletionsExact_(snapshot, config);
	for (let i = 0; i < rewardPlan.warnings.length; i++) warnings.push(rewardPlan.warnings[i]);
	const baseline = buildExactBaselineLineup_(snapshot, rewardPlan, config);
	if (!baseline || !baseline.ok) {
		warnings.push((baseline && baseline.warning) || "baseline-lineup-infeasible");
		return buildBenchNoopPlan_(snapshot, warnings, "baseline_infeasible");
	}
	const optional = applyOptionalBenchUpgrades_(snapshot, rewardPlan, baseline, config);
	for (let i = 0; i < optional.warnings.length; i++) warnings.push(optional.warnings[i]);
	const targetMainTags = dedupeTagList_(optional.targetMainTags);
	const targetSet = listToTagSet_(targetMainTags);
	const selectedLaterRewardTags = [];
	const requiredNextSet = listToTagSet_(baseline.requiredNextRewardTags);
	const capacityNextSet = listToTagSet_(baseline.capacityNextRewardTags);
	const selectedRewardTags = dedupeTagList_(rewardPlan.selectedRewardTags);
	for (let i = 0; i < selectedRewardTags.length; i++) {
		const tag = selectedRewardTags[i];
		if (requiredNextSet[tag] || capacityNextSet[tag]) continue;
		selectedLaterRewardTags.push(tag);
	}
	const rewardStatusByTag = Object.assign({}, rewardPlan.rewardStatusByTag);
	for (let i = 0; i < baseline.requiredNextRewardTags.length; i++) rewardStatusByTag[baseline.requiredNextRewardTags[i]] = "required_next_round";
	for (let i = 0; i < baseline.capacityNextRewardTags.length; i++) rewardStatusByTag[baseline.capacityNextRewardTags[i]] = "required_next_round";
	for (let i = 0; i < selectedLaterRewardTags.length; i++) {
		if (rewardStatusByTag[selectedLaterRewardTags[i]] === "selected_projected_complete") rewardStatusByTag[selectedLaterRewardTags[i]] = "selected_schedulable_later";
	}
	let totalStrength = 0;
	for (let i = 0; i < targetMainTags.length; i++) {
		const player = snapshot.playersByTag[targetMainTags[i]];
		totalStrength += Number(player && player.lineupValue) || 0;
	}
	return {
		dayAssignments: [targetMainTags.slice()],
		targetMainTags: targetMainTags,
		actionableTargetMainTags: targetMainTags.slice(),
		startCountsByTag: rewardPlan.requiredAppearancesByTag,
		selectedRewardTags: selectedRewardTags,
		projectedRewardCompleteTags: dedupeTagList_(rewardPlan.projectedRewardCompleteTags),
		securedRewardTags: dedupeTagList_(rewardPlan.securedRewardTags),
		requiredNextRewardTags: dedupeTagList_(baseline.requiredNextRewardTags),
		capacityNextRewardTags: dedupeTagList_(baseline.capacityNextRewardTags),
		selectedLaterRewardTags: dedupeTagList_(selectedLaterRewardTags),
		rewardStatusByTag: rewardStatusByTag,
		solverMode: "exact_bounded_dp",
		invalidConstraints: false,
		invalidReason: "",
		warnings: dedupeStringList_(warnings, 30),
		optionalSwapCount: optional.optionalSwapCount,
		optionalSwapByInTag: optional.optionalSwapByInTag,
		optionalSwapByOutTag: optional.optionalSwapByOutTag,
		mandatoryReasonByTag: baseline.mandatoryReasonByTag || {},
		totalStrength: totalStrength,
		rewardCapacity: rewardPlan.capacity,
		rewardAppearancesReserved: rewardPlan.usedAppearances,
	};
}

// Build v2 swap explanation.
function buildSwapExplanationV2_(swapInPlayer, benchOutPlayer, plan, config) {
	const inPlayer = swapInPlayer && typeof swapInPlayer === "object" ? swapInPlayer : {};
	const outPlayer = benchOutPlayer && typeof benchOutPlayer === "object" ? benchOutPlayer : {};
	const mandatoryReasonByTag = plan && plan.mandatoryReasonByTag && typeof plan.mandatoryReasonByTag === "object" ? plan.mandatoryReasonByTag : {};
	const optionalByIn = plan && plan.optionalSwapByInTag && typeof plan.optionalSwapByInTag === "object" ? plan.optionalSwapByInTag : {};
	const scoreDelta = (Number(inPlayer.lineupValue) || 0) - (Number(outPlayer.lineupValue) || 0);
	const reliabilityDelta = (Number(inPlayer.attackUseProbability) || 0) - (Number(outPlayer.attackUseProbability) || 0);
	let reasonCode = "lineup_upgrade";
	let shortReason = "Lineup upgrade";
	if (outPlayer.neverIn) {
		reasonCode = "restriction_never_in";
		shortReason = "Never in war";
	} else if (inPlayer.alwaysIn || mandatoryReasonByTag[inPlayer.tag] === "restriction_always_in") {
		reasonCode = "restriction_always_in";
		shortReason = "Always in war";
	} else if (mandatoryReasonByTag[inPlayer.tag] === "reward_required_next") {
		reasonCode = "reward_deadline";
		shortReason = "Reward deadline";
	} else if (mandatoryReasonByTag[inPlayer.tag] === "reward_capacity") {
		reasonCode = "reward_capacity";
		shortReason = "Reward capacity";
	} else if (optionalByIn[inPlayer.tag]) {
		if (reliabilityDelta >= Math.max(0, Number(config && config.reasonReliabilityDeltaThreshold) || 0)) {
			reasonCode = "reliability_upgrade";
			shortReason = "Reliability upgrade";
		} else {
			reasonCode = "lineup_upgrade";
			shortReason = "Lineup value upgrade";
		}
	} else if (reliabilityDelta >= Math.max(0, Number(config && config.reasonReliabilityDeltaThreshold) || 0)) {
		reasonCode = "reliability_upgrade";
		shortReason = "Reliability upgrade";
	}
	const rewardImpact =
		"in reward status " +
		String(inPlayer.rewardStatus || "") +
		", out reward status " +
		String(outPlayer.rewardStatus || "") +
		".";
	return {
		reasonCode: reasonCode,
		shortReason: shortReason,
		scoreDelta: safeRoundNumber_(scoreDelta, 4),
		reliabilityDelta: safeRoundNumber_(reliabilityDelta, 4),
		rewardImpact: rewardImpact,
		reasonText: shortReason + " (" + rewardImpact + ")",
		optional: !!optionalByIn[inPlayer.tag],
	};
}

// Build v2 pairs from a final lineup delta.
function buildPairsFromFinalDeltaV2_(swapInTagsRaw, benchOutTagsRaw, snapshot, plan, config) {
	const swapInTags = dedupeTagList_(swapInTagsRaw);
	const benchOutTags = dedupeTagList_(benchOutTagsRaw);
	const playersByTag = snapshot && snapshot.playersByTag && typeof snapshot.playersByTag === "object" ? snapshot.playersByTag : {};
	const availableOutByTag = listToTagSet_(benchOutTags);
	const pairs = [];
	const inPlayers = swapInTags
		.map((tag) => playersByTag[tag])
		.filter(Boolean)
		.sort((a, b) => {
			const aMandatory = a.alwaysIn || (plan.mandatoryReasonByTag && plan.mandatoryReasonByTag[a.tag]);
			const bMandatory = b.alwaysIn || (plan.mandatoryReasonByTag && plan.mandatoryReasonByTag[b.tag]);
			if (!!aMandatory !== !!bMandatory) return aMandatory ? -1 : 1;
			if ((Number(a.lineupValue) || 0) !== (Number(b.lineupValue) || 0)) return (Number(b.lineupValue) || 0) - (Number(a.lineupValue) || 0);
			return compareTagsAsc_(a.tag, b.tag);
		});
	for (let i = 0; i < inPlayers.length; i++) {
		const inPlayer = inPlayers[i];
		const outCandidates = [];
		for (let j = 0; j < benchOutTags.length; j++) {
			const outTag = benchOutTags[j];
			if (!availableOutByTag[outTag]) continue;
			const outPlayer = playersByTag[outTag];
			if (!outPlayer) continue;
			const explanation = buildSwapExplanationV2_(inPlayer, outPlayer, plan, config);
			outCandidates.push({
				outPlayer: outPlayer,
				explanation: explanation,
				outRestriction: outPlayer.neverIn ? 1 : 0,
				thDiff: Math.abs(toNonNegativeInt_(inPlayer.th) - toNonNegativeInt_(outPlayer.th)),
			});
		}
		if (!outCandidates.length) continue;
		outCandidates.sort((a, b) => {
			if (a.outRestriction !== b.outRestriction) return b.outRestriction - a.outRestriction;
			if (a.explanation.optional !== b.explanation.optional) return a.explanation.optional ? 1 : -1;
			if (a.thDiff !== b.thDiff) return a.thDiff - b.thDiff;
			if (a.explanation.scoreDelta !== b.explanation.scoreDelta) return b.explanation.scoreDelta - a.explanation.scoreDelta;
			return compareTagsAsc_(a.outPlayer.tag, b.outPlayer.tag);
		});
		const chosen = outCandidates[0];
		delete availableOutByTag[chosen.outPlayer.tag];
		pairs.push({
			outTag: chosen.outPlayer.tag,
			inTag: inPlayer.tag,
			reasonCode: chosen.explanation.reasonCode,
			reasonText: chosen.explanation.reasonText,
			shortReason: chosen.explanation.shortReason,
			scoreDelta: chosen.explanation.scoreDelta,
			reliabilityDelta: chosen.explanation.reliabilityDelta,
			rewardImpact: chosen.explanation.rewardImpact,
			optional: chosen.explanation.optional,
		});
	}
	return pairs;
}

// Derive next day swap suggestions from final v2 plan.
function deriveNextDaySwapSuggestionsFromPlan_(roster, plan, snapshot, config) {
	const currentMainTags = dedupeTagList_(snapshot && snapshot.currentMainTags);
	const currentMainSet = listToTagSet_(currentMainTags);
	const targetMainTags = dedupeTagList_(plan && plan.targetMainTags);
	const targetSet = listToTagSet_(targetMainTags);
	const benchTags = tagListDiff_(currentMainTags, targetSet);
	const swapInTags = tagListDiff_(targetMainTags, currentMainSet);
	const pairs = buildPairsFromFinalDeltaV2_(swapInTags, benchTags, snapshot, plan, config);
	return {
		targetMainTags: targetMainTags,
		actionableTargetMainTags: targetMainTags.slice(),
		benchTags: benchTags,
		swapInTags: swapInTags,
		pairs: pairs,
		blockedByExclusions: false,
		blockedByExclusionOutTags: [],
		blockedByExclusionInTags: [],
	};
}

// Build bench suggestion summary (v2).
function buildBenchSuggestionSummary_(roster, plan, suggestions, snapshot, config) {
	const rewardStatusByTagRaw = plan && plan.rewardStatusByTag && typeof plan.rewardStatusByTag === "object" ? plan.rewardStatusByTag : {};
	const rewardStatusByTag = {};
	const statusTags = Object.keys(rewardStatusByTagRaw).sort(compareTagsAsc_);
	for (let i = 0; i < statusTags.length; i++) {
		const tag = normalizeTag_(statusTags[i]);
		if (!tag || !(snapshot.playersByTag && snapshot.playersByTag[tag])) continue;
		rewardStatusByTag[tag] = String(rewardStatusByTagRaw[statusTags[i]] || "");
	}
	const warnings = [];
	if (plan && Array.isArray(plan.warnings)) {
		for (let i = 0; i < plan.warnings.length; i++) warnings.push(plan.warnings[i]);
	}
	if (snapshot && snapshot.requestedMainSize > snapshot.rosterPoolSize) warnings.push("active-slots-exceed-usable-pool");
	const seasonContext = snapshot && snapshot.seasonContext && typeof snapshot.seasonContext === "object" ? snapshot.seasonContext : {};
	const plannerSummary = {
		remainingEditableDays: Math.max(0, toNonNegativeInt_(snapshot && snapshot.remainingEditableDays)),
		nextEditableDayIndex: typeof snapshot.nextEditableDayIndex === "number" && isFinite(snapshot.nextEditableDayIndex) ? Math.floor(snapshot.nextEditableDayIndex) : -1,
		contextSource: String(seasonContext.contextSource || seasonContext.source || ""),
		estimatedContext: seasonContext.estimated === true,
		roundStates: Array.isArray(seasonContext.roundStates) ? seasonContext.roundStates.slice(0, 10).map((state) => String(state || "")) : [],
		solverMode: String((plan && plan.solverMode) || ""),
		historyStatus: String((snapshot && snapshot.historyContext && snapshot.historyContext.historyStatus) || ""),
		selectedRewardPlayerTags: dedupeTagList_(plan && plan.selectedRewardTags),
		projectedRewardCompletePlayerTags: dedupeTagList_(plan && plan.projectedRewardCompleteTags),
		securedRewardPlayerTags: dedupeTagList_(plan && plan.securedRewardTags),
		requiredNextRewardPlayerTags: dedupeTagList_(plan && plan.requiredNextRewardTags),
		capacityNextRewardPlayerTags: dedupeTagList_(plan && plan.capacityNextRewardTags),
		selectedLaterRewardPlayerTags: dedupeTagList_(plan && plan.selectedLaterRewardTags),
		rewardStatusByTag: rewardStatusByTag,
		rewardAppearancesReserved: toNonNegativeInt_(plan && plan.rewardAppearancesReserved),
		rewardCapacity: toNonNegativeInt_(plan && plan.rewardCapacity),
		optionalSwapCount: toNonNegativeInt_(plan && plan.optionalSwapCount),
		invalidConstraints: !!(plan && plan.invalidConstraints),
		invalidReason: String((plan && plan.invalidReason) || ""),
	};
	const dedupedWarnings = dedupeStringList_(warnings, 30);
	if (dedupedWarnings.length) plannerSummary.warnings = dedupedWarnings;
	return {
		plannerSummary: plannerSummary,
		configSnapshot: {
			defaultSeasonDays: Number(config && config.defaultSeasonDays) || 7,
			supportedTownHallMin: Number(config && config.supportedTownHallMin) || 1,
			supportedTownHallMax: Number(config && config.supportedTownHallMax) || 18,
			qualityPriorMeanStarsWhenUsed: Number(config && config.qualityPriorMeanStarsWhenUsed) || 3,
			qualityPriorMeanDestruction: Number(config && config.qualityPriorMeanDestruction) || 100,
			qualityPriorMeanThreeStarProbability: Number(config && config.qualityPriorMeanThreeStarProbability) || 1,
			qualityPriorWeightAttacks: Number(config && config.qualityPriorWeightAttacks) || 0,
			reliabilityPriorMean: Number(config && config.reliabilityPriorMean) || 0,
			reliabilityPriorWeight: Number(config && config.reliabilityPriorWeight) || 0,
			benchWeightTownHall: Number(config && config.benchWeightTownHall) || 0,
			benchWeightStarsWhenUsed: Number(config && config.benchWeightStarsWhenUsed) || 0,
			benchWeightDestructionWhenUsed: Number(config && config.benchWeightDestructionWhenUsed) || 0,
			benchWeightThreeStarProbability: Number(config && config.benchWeightThreeStarProbability) || 0,
			benchReliabilityExponent: Number(config && config.benchReliabilityExponent) || 0,
			optionalSwapMinScoreDelta: Number(config && config.optionalSwapMinScoreDelta) || 0,
			maxOptionalSwaps: Number(config && config.maxOptionalSwaps) || 0,
		},
	};
}

// Compute bench suggestions core.
function computeBenchSuggestionsCore_(rosterData, rosterId, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const ctx = findRosterByIdForRefreshStep_(rosterData, rosterId, options);
	const trackingMode = getRosterTrackingMode_(ctx.roster);
	if (trackingMode === "regularWar") {
		clearRosterBenchSuggestions_(ctx.roster);
		const outRosterData = finalizeRefreshStepRosterDataForReturn_(ctx.rosterData, options, "compute bench suggestions");
		return {
			ok: true,
			mode: "regularWar",
			benchTags: [],
			swapInTags: [],
			pairs: [],
			rosterData: outRosterData,
			result: {
				mode: "regularWar",
				benchCount: 0,
				swapCount: 0,
				needsRewardsCount: 0,
				message: "bench suggestions are disabled for regular war rosters",
			},
			algorithm: "",
			nextEditableDayIndex: -1,
			plannerSummary: null,
			targetMainTags: [],
			actionableTargetMainTags: [],
		};
	}
	if (isCwlPreparationActive_(ctx.roster)) {
		clearRosterBenchSuggestions_(ctx.roster);
		const prep = getRosterCwlPreparation_(ctx.roster);
		const outRosterData = finalizeRefreshStepRosterDataForReturn_(ctx.rosterData, options, "compute bench suggestions");
		return {
			ok: true,
			benchTags: [],
			swapInTags: [],
			pairs: [],
			rosterData: outRosterData,
			result: {
				mode: "cwl",
				benchCount: 0,
				swapCount: 0,
				needsRewardsCount: 0,
				cwlPreparationBlocked: true,
				rosterSize: normalizePreparationRosterSize_(prep && prep.rosterSize, CWL_PREPARATION_MIN_ROSTER_SIZE),
				message: "CWL Preparation Mode active; bench suggestions are disabled",
			},
			algorithm: "",
			nextEditableDayIndex: -1,
			plannerSummary: null,
			targetMainTags: [],
			actionableTargetMainTags: [],
		};
	}
	const config = getBenchPlannerConfig_();
	const updatedAt = new Date().toISOString();
	const seasonContext = buildCwlSeasonContext_(ctx.roster, config, options);
	const snapshot = buildCwlPlanningSnapshot_(ctx.roster, seasonContext, config);
	const plan = solveSeasonLineupPlan_(snapshot, config);
	const suggestions = deriveNextDaySwapSuggestionsFromPlan_(ctx.roster, plan, snapshot, config);
	const summary = buildBenchSuggestionSummary_(ctx.roster, plan, suggestions, snapshot, config);

	const benchSuggestions = {
		updatedAt: updatedAt,
		algorithm: String(config.algorithm || "cwl_bench_exact_dp_v2"),
		nextEditableDayIndex: snapshot.remainingEditableDays > 0 ? snapshot.nextEditableDayIndex : -1,
		targetMainTags: suggestions.targetMainTags,
		actionableTargetMainTags: suggestions.actionableTargetMainTags,
		benchTags: suggestions.benchTags,
		swapInTags: suggestions.swapInTags,
		pairs: suggestions.pairs,
		result: {
			benchCount: suggestions.benchTags.length,
			swapCount: suggestions.pairs.length,
			rosterPoolSize: snapshot.rosterPoolSize,
			activeSlots: snapshot.requestedMainSize,
			needsRewardsCount: snapshot.needsRewardsCount,
		},
		plannerSummary: summary.plannerSummary,
		configSnapshot: summary.configSnapshot,
	};

	ctx.roster.benchSuggestions = benchSuggestions;
	Logger.log("computeBenchSuggestions planner rosterId=%s days=%s nextEditable=%s solver=%s swaps=%s optional=%s invalid=%s", ctx.rosterId, snapshot.remainingEditableDays, benchSuggestions.nextEditableDayIndex, plan.solverMode, suggestions.pairs.length, plan.optionalSwapCount || 0, plan.invalidConstraints ? "1" : "0");

	const outRosterData = finalizeRefreshStepRosterDataForReturn_(ctx.rosterData, options, "compute bench suggestions");
	return {
		ok: true,
		benchTags: benchSuggestions.benchTags,
		swapInTags: benchSuggestions.swapInTags,
		pairs: benchSuggestions.pairs,
		rosterData: outRosterData,
		result: benchSuggestions.result,
		algorithm: benchSuggestions.algorithm,
		nextEditableDayIndex: benchSuggestions.nextEditableDayIndex,
		plannerSummary: benchSuggestions.plannerSummary,
		targetMainTags: benchSuggestions.targetMainTags,
		actionableTargetMainTags: benchSuggestions.actionableTargetMainTags,
	};
}
