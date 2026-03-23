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
		source: "stats_fallback",
		season: seasonFromRoster || "",
		totalSeasonDays: defaultSeasonDays,
		completedDays: clampNumber_(maxResolvedWarDays, 0, defaultSeasonDays),
		lockedDays: lockedDaysEstimate,
		remainingEditableDays: Math.max(0, defaultSeasonDays - lockedDaysEstimate),
		nextEditableDayIndex: defaultSeasonDays - lockedDaysEstimate > 0 ? 0 : -1,
		warnings: [],
	};

	const clanTag = normalizeTag_(rosterSafe.connectedClanTag);
	if (!clanTag) {
		fallbackContext.warnings.push("season-context-no-connected-clan-tag");
		return fallbackContext;
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

				const warState = String((war && war.state) || "").toLowerCase();
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
			season: leaguegroup && typeof leaguegroup.season === "string" ? leaguegroup.season : seasonFromRoster || "",
			totalSeasonDays: totalSeasonDays,
			completedDays: completedDays,
			lockedDays: lockedDays,
			remainingEditableDays: remainingEditableDays,
			nextEditableDayIndex: remainingEditableDays > 0 ? 0 : -1,
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
	const poolPlayersRaw = collectRosterPoolPlayers_(rosterSafe);
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

// Parse planner state key.
function parsePlannerStateKey_(stateKey) {
	const parts = String(stateKey == null ? "" : stateKey).split("|");
	const starts = Math.max(0, parseInt(parts[0] || "0", 10) || 0);
	const coverage = Math.max(0, parseInt(parts[1] || "0", 10) || 0);
	return { starts: starts, coverage: coverage };
}

// Compare planner state keys.
function comparePlannerStateKeys_(a, b) {
	const pa = parsePlannerStateKey_(a);
	const pb = parsePlannerStateKey_(b);
	if (pa.starts !== pb.starts) return pa.starts - pb.starts;
	if (pa.coverage !== pb.coverage) return pa.coverage - pb.coverage;
	return compareTagsAsc_(String(a), String(b));
}

// Handle calculate covered starts.
function calculateCoveredStarts_(players, startCountsByTag) {
	const list = Array.isArray(players) ? players : [];
	const startsByTag = startCountsByTag && typeof startCountsByTag === "object" ? startCountsByTag : {};
	let covered = 0;
	for (let i = 0; i < list.length; i++) {
		const p = list[i] && typeof list[i] === "object" ? list[i] : {};
		const starts = toNonNegativeInt_(startsByTag[p.tag]);
		const startsNeeded = toNonNegativeInt_(p.startsNeeded);
		covered += Math.min(starts, startsNeeded);
	}
	return covered;
}

// Build day zero target lineup.
function buildDayZeroTargetLineup_(snapshot, remainingByTag) {
	const remaining = remainingByTag && typeof remainingByTag === "object" ? remainingByTag : {};
	const mainSize = Math.max(0, toNonNegativeInt_(snapshot && snapshot.mainSize));
	const daysLeftIncludingToday = Math.max(0, toNonNegativeInt_(snapshot && snapshot.remainingEditableDays));
	const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
	const currentMainSet = snapshot && snapshot.currentMainTagSet && typeof snapshot.currentMainTagSet === "object" ? snapshot.currentMainTagSet : {};
	const seen = {};
	const candidates = [];

	for (let i = 0; i < players.length; i++) {
		const player = players[i] && typeof players[i] === "object" ? players[i] : {};
		const tag = normalizeTag_(player.tag);
		if (!tag || seen[tag]) continue;
		seen[tag] = true;

		const remainingAssignedStarts = toNonNegativeInt_(remaining[tag]);
		if (remainingAssignedStarts <= 0) continue;

		const rewardSlackRaw = Number(player.rewardSlackMargin);
		candidates.push({
			tag: tag,
			mustPlayToday: remainingAssignedStarts >= daysLeftIncludingToday,
			rewardSlackMargin: isFinite(rewardSlackRaw) ? rewardSlackRaw : Number.MAX_SAFE_INTEGER,
			strengthScore: Number(player.strengthScore) || 0,
			startsNeeded: toNonNegativeInt_(player.startsNeeded),
			isCurrentMain: !!currentMainSet[tag],
		});
	}

	candidates.sort((a, b) => {
		if (a.mustPlayToday !== b.mustPlayToday) return a.mustPlayToday ? -1 : 1;
		if (a.rewardSlackMargin !== b.rewardSlackMargin) return a.rewardSlackMargin - b.rewardSlackMargin;
		if (a.strengthScore !== b.strengthScore) return b.strengthScore - a.strengthScore;
		if (a.startsNeeded !== b.startsNeeded) return b.startsNeeded - a.startsNeeded;
		if (a.isCurrentMain !== b.isCurrentMain) return a.isCurrentMain ? -1 : 1;
		return compareTagsAsc_(a.tag, b.tag);
	});

	return candidates.slice(0, mainSize).map((p) => p.tag);
}

// Build day assignments from start counts.
function buildDayAssignmentsFromStartCounts_(snapshot, startCountsByTag) {
	const days = Math.max(0, toNonNegativeInt_(snapshot && snapshot.remainingEditableDays));
	const mainSize = Math.max(0, toNonNegativeInt_(snapshot && snapshot.mainSize));
	const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
	const startsByTag = startCountsByTag && typeof startCountsByTag === "object" ? startCountsByTag : {};
	const remainingByTag = {};
	for (let i = 0; i < players.length; i++) {
		const tag = players[i].tag;
		remainingByTag[tag] = toNonNegativeInt_(startsByTag[tag]);
	}

	const assignments = [];
	for (let day = 0; day < days; day++) {
		let selectedTags = [];
		if (day === 0) {
			selectedTags = buildDayZeroTargetLineup_(snapshot, remainingByTag);
		} else {
			selectedTags = players
				.filter((p) => toNonNegativeInt_(remainingByTag[p.tag]) > 0)
				.sort((a, b) => {
					const aRemaining = toNonNegativeInt_(remainingByTag[a.tag]);
					const bRemaining = toNonNegativeInt_(remainingByTag[b.tag]);
					if (aRemaining !== bRemaining) return bRemaining - aRemaining;
					if (a.strengthScore !== b.strengthScore) return b.strengthScore - a.strengthScore;
					if (a.startsNeeded !== b.startsNeeded) return b.startsNeeded - a.startsNeeded;
					return compareTagsAsc_(a.tag, b.tag);
				})
				.slice(0, mainSize)
				.map((p) => p.tag);
		}

		if (selectedTags.length < mainSize) return null;
		assignments.push(selectedTags);
		for (let i = 0; i < selectedTags.length; i++) {
			const tag = selectedTags[i];
			remainingByTag[tag] = Math.max(0, toNonNegativeInt_(remainingByTag[tag]) - 1);
		}
	}

	for (let i = 0; i < players.length; i++) {
		if (toNonNegativeInt_(remainingByTag[players[i].tag]) > 0) return null;
	}
	return assignments;
}

// Handle optimize season plan by dynamic programming.
function optimizeSeasonPlanByDynamicProgramming_(snapshot, coverageTarget, config) {
	const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
	const days = Math.max(0, toNonNegativeInt_(snapshot && snapshot.remainingEditableDays));
	const mainSize = Math.max(0, toNonNegativeInt_(snapshot && snapshot.mainSize));
	const totalStarts = days * mainSize;
	const targetCoverage = Math.max(0, toNonNegativeInt_(coverageTarget));
	const scale = Math.max(1, toNonNegativeInt_((config && config.optimizerScoreScale) || 100000));
	const retentionBonus = Math.max(0, Number(config && config.churnPenalty) || 0) * 2;

	let currentLayer = {
		"0|0": {
			value: 0,
			prevKey: "",
			starts: 0,
		},
	};
	const layers = [currentLayer];

	for (let i = 0; i < players.length; i++) {
		const player = players[i];
		const nextLayer = {};
		const stateKeys = Object.keys(currentLayer).sort(comparePlannerStateKeys_);
		const startsNeeded = Math.max(0, toNonNegativeInt_(player.startsNeeded));

		for (let j = 0; j < stateKeys.length; j++) {
			const key = stateKeys[j];
			const state = currentLayer[key];
			const parsed = parsePlannerStateKey_(key);
			const currentStarts = parsed.starts;
			const currentCoverage = parsed.coverage;

			for (let starts = 0; starts <= days; starts++) {
				const nextStarts = currentStarts + starts;
				if (nextStarts > totalStarts) continue;
				const nextCoverage = Math.min(targetCoverage, currentCoverage + Math.min(starts, startsNeeded));
				const bonus = player.isCurrentMain && starts > 0 ? retentionBonus : 0;
				const contribution = starts * player.strengthScore + bonus;
				const scoreInt = state.value + Math.round(contribution * scale);
				const nextKey = nextStarts + "|" + nextCoverage;
				const existing = nextLayer[nextKey];
				if (!existing || scoreInt > existing.value || (scoreInt === existing.value && starts < existing.starts)) {
					nextLayer[nextKey] = {
						value: scoreInt,
						prevKey: key,
						starts: starts,
					};
				}
			}
		}

		currentLayer = nextLayer;
		layers.push(currentLayer);
	}

	const finalKey = totalStarts + "|" + targetCoverage;
	if (!currentLayer[finalKey]) return null;

	const startCountsByTag = {};
	let backtrackKey = finalKey;
	for (let i = players.length - 1; i >= 0; i--) {
		const layer = layers[i + 1];
		const entry = layer[backtrackKey];
		if (!entry) return null;
		startCountsByTag[players[i].tag] = entry.starts;
		backtrackKey = entry.prevKey;
	}

	const dayAssignments = buildDayAssignmentsFromStartCounts_(snapshot, startCountsByTag);
	if (!dayAssignments) return null;

	let totalStrength = 0;
	for (let i = 0; i < players.length; i++) {
		const starts = toNonNegativeInt_(startCountsByTag[players[i].tag]);
		totalStrength += starts * players[i].strengthScore;
	}
	const coveredStarts = calculateCoveredStarts_(players, startCountsByTag);
	return {
		mode: "optimizer",
		startCountsByTag: startCountsByTag,
		dayAssignments: dayAssignments,
		totalStrength: totalStrength,
		coveredStarts: coveredStarts,
	};
}

// Handle boost fallback coverage toward target.
function boostFallbackCoverageTowardTarget_(players, startCountsByTag, coverageTarget, days) {
	const list = Array.isArray(players) ? players : [];
	const startsByTag = startCountsByTag && typeof startCountsByTag === "object" ? startCountsByTag : {};
	const target = Math.max(0, toNonNegativeInt_(coverageTarget));
	let covered = calculateCoveredStarts_(list, startsByTag);
	let guard = 0;
	const maxGuard = 5000;

	while (covered < target && guard < maxGuard) {
		guard++;
		const needers = list
			.filter((p) => toNonNegativeInt_(startsByTag[p.tag]) < days && toNonNegativeInt_(startsByTag[p.tag]) < toNonNegativeInt_(p.startsNeeded))
			.sort((a, b) => {
				if (a.rewardSlackMargin !== b.rewardSlackMargin) return a.rewardSlackMargin - b.rewardSlackMargin;
				if (a.startsNeeded !== b.startsNeeded) return b.startsNeeded - a.startsNeeded;
				if (a.strengthScore !== b.strengthScore) return b.strengthScore - a.strengthScore;
				return compareTagsAsc_(a.tag, b.tag);
			});
		if (!needers.length) break;

		const donors = list
			.filter((p) => toNonNegativeInt_(startsByTag[p.tag]) > 0)
			.sort((a, b) => {
				const aStarts = toNonNegativeInt_(startsByTag[a.tag]);
				const bStarts = toNonNegativeInt_(startsByTag[b.tag]);
				const aExcess = Math.max(0, aStarts - toNonNegativeInt_(a.startsNeeded));
				const bExcess = Math.max(0, bStarts - toNonNegativeInt_(b.startsNeeded));
				if (aExcess !== bExcess) return bExcess - aExcess;
				if (a.strengthScore !== b.strengthScore) return a.strengthScore - b.strengthScore;
				return compareTagsAsc_(a.tag, b.tag);
			});
		if (!donors.length) break;

		let improved = false;
		for (let i = 0; i < needers.length && !improved; i++) {
			const needy = needers[i];
			for (let j = 0; j < donors.length && !improved; j++) {
				const donor = donors[j];
				if (donor.tag === needy.tag) continue;
				const donorStarts = toNonNegativeInt_(startsByTag[donor.tag]);
				const needyStarts = toNonNegativeInt_(startsByTag[needy.tag]);
				if (donorStarts <= 0 || needyStarts >= days) continue;

				const donorCoverageBefore = Math.min(donorStarts, toNonNegativeInt_(donor.startsNeeded));
				const needyCoverageBefore = Math.min(needyStarts, toNonNegativeInt_(needy.startsNeeded));
				const donorCoverageAfter = Math.min(Math.max(0, donorStarts - 1), toNonNegativeInt_(donor.startsNeeded));
				const needyCoverageAfter = Math.min(needyStarts + 1, toNonNegativeInt_(needy.startsNeeded));
				const deltaCoverage = donorCoverageAfter + needyCoverageAfter - (donorCoverageBefore + needyCoverageBefore);
				if (deltaCoverage <= 0) continue;

				startsByTag[donor.tag] = donorStarts - 1;
				startsByTag[needy.tag] = needyStarts + 1;
				covered += deltaCoverage;
				improved = true;
			}
		}
		if (!improved) break;
	}
}

// Build fallback season lineup plan.
function buildFallbackSeasonLineupPlan_(snapshot, coverageTarget) {
	const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
	const days = Math.max(0, toNonNegativeInt_(snapshot && snapshot.remainingEditableDays));
	const mainSize = Math.max(0, toNonNegativeInt_(snapshot && snapshot.mainSize));
	const totalStarts = days * mainSize;
	const startCountsByTag = {};
	for (let i = 0; i < players.length; i++) startCountsByTag[players[i].tag] = 0;

	let slotsRemaining = totalStarts;
	const rewardOrder = players.slice().sort((a, b) => {
		if (a.rewardSlackMargin !== b.rewardSlackMargin) return a.rewardSlackMargin - b.rewardSlackMargin;
		if (a.startsNeeded !== b.startsNeeded) return b.startsNeeded - a.startsNeeded;
		if (a.strengthScore !== b.strengthScore) return b.strengthScore - a.strengthScore;
		return compareTagsAsc_(a.tag, b.tag);
	});

	let progressed = true;
	while (slotsRemaining > 0 && progressed) {
		progressed = false;
		for (let i = 0; i < rewardOrder.length; i++) {
			const p = rewardOrder[i];
			const currentStarts = toNonNegativeInt_(startCountsByTag[p.tag]);
			if (currentStarts >= days) continue;
			if (currentStarts >= toNonNegativeInt_(p.startsNeeded)) continue;
			startCountsByTag[p.tag] = currentStarts + 1;
			slotsRemaining--;
			progressed = true;
			if (slotsRemaining <= 0) break;
		}
	}

	const strengthOrder = players.slice().sort((a, b) => {
		if (a.strengthScore !== b.strengthScore) return b.strengthScore - a.strengthScore;
		if (a.rewardSlackMargin !== b.rewardSlackMargin) return a.rewardSlackMargin - b.rewardSlackMargin;
		return compareTagsAsc_(a.tag, b.tag);
	});

	while (slotsRemaining > 0) {
		let assigned = false;
		for (let i = 0; i < strengthOrder.length; i++) {
			const p = strengthOrder[i];
			const currentStarts = toNonNegativeInt_(startCountsByTag[p.tag]);
			if (currentStarts >= days) continue;
			startCountsByTag[p.tag] = currentStarts + 1;
			slotsRemaining--;
			assigned = true;
			if (slotsRemaining <= 0) break;
		}
		if (!assigned) break;
	}

	boostFallbackCoverageTowardTarget_(players, startCountsByTag, coverageTarget, days);
	const dayAssignments = buildDayAssignmentsFromStartCounts_(snapshot, startCountsByTag);
	if (!dayAssignments) return null;

	let totalStrength = 0;
	for (let i = 0; i < players.length; i++) {
		const starts = toNonNegativeInt_(startCountsByTag[players[i].tag]);
		totalStrength += starts * players[i].strengthScore;
	}
	return {
		mode: "fallback",
		startCountsByTag: startCountsByTag,
		dayAssignments: dayAssignments,
		totalStrength: totalStrength,
		coveredStarts: calculateCoveredStarts_(players, startCountsByTag),
	};
}

// Build emergency season plan.
function buildEmergencySeasonPlan_(snapshot) {
	const days = Math.max(0, toNonNegativeInt_(snapshot && snapshot.remainingEditableDays));
	const mainSize = Math.max(0, toNonNegativeInt_(snapshot && snapshot.mainSize));
	const currentMainTags = Array.isArray(snapshot && snapshot.currentMainTags) ? snapshot.currentMainTags : [];
	const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
	const currentMainSet = listToTagSet_(currentMainTags);
	const sortedPlayers = players.slice().sort((a, b) => {
		const aCurrent = !!currentMainSet[a.tag];
		const bCurrent = !!currentMainSet[b.tag];
		if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
		if (a.strengthScore !== b.strengthScore) return b.strengthScore - a.strengthScore;
		return compareTagsAsc_(a.tag, b.tag);
	});
	const targetMain = sortedPlayers.slice(0, mainSize).map((p) => p.tag);
	const dayAssignments = [];
	for (let d = 0; d < days; d++) dayAssignments.push(targetMain.slice());
	const startCountsByTag = {};
	for (let i = 0; i < players.length; i++) startCountsByTag[players[i].tag] = 0;
	for (let d = 0; d < dayAssignments.length; d++) {
		for (let i = 0; i < dayAssignments[d].length; i++) {
			const tag = dayAssignments[d][i];
			startCountsByTag[tag] = toNonNegativeInt_(startCountsByTag[tag]) + 1;
		}
	}
	let totalStrength = 0;
	for (let i = 0; i < players.length; i++) {
		totalStrength += toNonNegativeInt_(startCountsByTag[players[i].tag]) * players[i].strengthScore;
	}
	return {
		mode: "emergency",
		startCountsByTag: startCountsByTag,
		dayAssignments: dayAssignments,
		totalStrength: totalStrength,
		coveredStarts: calculateCoveredStarts_(players, startCountsByTag),
	};
}

// Handle solve season lineup plan.
function solveSeasonLineupPlan_(snapshot, config) {
	const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
	const remainingEditableDays = Math.max(0, toNonNegativeInt_(snapshot && snapshot.remainingEditableDays));
	const mainSize = Math.max(0, toNonNegativeInt_(snapshot && snapshot.mainSize));
	const totalStarts = remainingEditableDays * mainSize;
	const plan = {
		dayAssignments: [],
		targetMainTags: [],
		startCountsByTag: {},
		optimalTotalSlack: 0,
		totalSlack: 0,
		coveredStarts: 0,
		solverMode: "none",
		warnings: [],
	};

	if (remainingEditableDays <= 0 || mainSize <= 0 || players.length <= 0) {
		plan.solverMode = "none";
		return plan;
	}

	let totalStartsNeeded = 0;
	let coverageCapacity = 0;
	for (let i = 0; i < players.length; i++) {
		const startsNeeded = toNonNegativeInt_(players[i].startsNeeded);
		totalStartsNeeded += startsNeeded;
		coverageCapacity += Math.min(remainingEditableDays, startsNeeded);
	}
	const coverageTarget = Math.min(totalStarts, coverageCapacity);
	plan.optimalTotalSlack = Math.max(0, totalStartsNeeded - coverageTarget);

	const estimatedStateCells = players.length * (totalStarts + 1) * (coverageTarget + 1);
	const exceedsGuards = players.length > toNonNegativeInt_(config && config.optimizerMaxPlayers) || remainingEditableDays > toNonNegativeInt_(config && config.optimizerMaxDays) || estimatedStateCells > toNonNegativeInt_(config && config.optimizerMaxStateCells);

	let solved = null;
	if (!exceedsGuards) {
		try {
			solved = optimizeSeasonPlanByDynamicProgramming_(snapshot, coverageTarget, config);
		} catch (err) {
			Logger.log("optimizeSeasonPlanByDynamicProgramming_ failed: %s", err && err.message ? err.message : String(err));
			plan.warnings.push("optimizer-error-fallback");
		}
	} else {
		plan.warnings.push("optimizer-guard-fallback");
	}

	if (!solved) {
		solved = buildFallbackSeasonLineupPlan_(snapshot, coverageTarget);
	}
	if (!solved) {
		plan.warnings.push("fallback-scheduler-failed-emergency-plan");
		solved = buildEmergencySeasonPlan_(snapshot);
	}

	plan.solverMode = solved && solved.mode ? solved.mode : "unknown";
	plan.startCountsByTag = solved && solved.startCountsByTag ? solved.startCountsByTag : {};
	plan.dayAssignments = solved && Array.isArray(solved.dayAssignments) ? solved.dayAssignments : [];
	plan.targetMainTags = plan.dayAssignments.length ? plan.dayAssignments[0].slice() : [];
	plan.coveredStarts = toNonNegativeInt_(solved && solved.coveredStarts);
	plan.totalSlack = Math.max(0, totalStartsNeeded - plan.coveredStarts);
	plan.totalStrength = Number(solved && solved.totalStrength) || 0;
	return plan;
}

// Compare actionable removal priority.
function compareActionableRemovalPriority_(tagA, tagB, snapshot, forcedKeepSet) {
	const playersByTag = snapshot && snapshot.playersByTag && typeof snapshot.playersByTag === "object" ? snapshot.playersByTag : {};
	const currentMainSet = snapshot && snapshot.currentMainTagSet && typeof snapshot.currentMainTagSet === "object" ? snapshot.currentMainTagSet : {};
	const playerA = playersByTag[tagA] || {};
	const playerB = playersByTag[tagB] || {};
	const aForced = !!(forcedKeepSet && forcedKeepSet[tagA]);
	const bForced = !!(forcedKeepSet && forcedKeepSet[tagB]);
	if (aForced !== bForced) return aForced ? 1 : -1;
	const aCurrent = !!currentMainSet[tagA];
	const bCurrent = !!currentMainSet[tagB];
	if (aCurrent !== bCurrent) return aCurrent ? 1 : -1;
	const aNeeded = toNonNegativeInt_(playerA.startsNeeded);
	const bNeeded = toNonNegativeInt_(playerB.startsNeeded);
	if (aNeeded !== bNeeded) return aNeeded - bNeeded;
	const aScore = Number(playerA.strengthScore) || 0;
	const bScore = Number(playerB.strengthScore) || 0;
	if (aScore !== bScore) return aScore - bScore;
	return compareTagsAsc_(tagA, tagB);
}

// Handle order target main tags.
function orderTargetMainTags_(selectedSet, snapshot) {
	const set = selectedSet && typeof selectedSet === "object" ? selectedSet : {};
	const currentMainTags = Array.isArray(snapshot && snapshot.currentMainTags) ? snapshot.currentMainTags : [];
	const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
	const out = [];
	const seen = {};
	const mainSize = Math.max(0, toNonNegativeInt_(snapshot && snapshot.mainSize));

	for (let i = 0; i < currentMainTags.length; i++) {
		const tag = normalizeTag_(currentMainTags[i]);
		if (!tag || !set[tag] || seen[tag]) continue;
		seen[tag] = true;
		out.push(tag);
		if (out.length >= mainSize) return out;
	}

	const rest = players
		.filter((p) => set[p.tag] && !seen[p.tag])
		.sort((a, b) => {
			if (a.strengthScore !== b.strengthScore) return b.strengthScore - a.strengthScore;
			if (a.startsNeeded !== b.startsNeeded) return b.startsNeeded - a.startsNeeded;
			return compareTagsAsc_(a.tag, b.tag);
		});
	for (let i = 0; i < rest.length && out.length < mainSize; i++) {
		out.push(rest[i].tag);
	}
	return out;
}

// Build actionable target main tags.
function buildActionableTargetMainTags_(snapshot, idealTargetTagsRaw) {
	const idealTargetTags = dedupeTagList_(idealTargetTagsRaw);
	const mainSize = Math.max(0, toNonNegativeInt_(snapshot && snapshot.mainSize));
	const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
	const playersByTag = snapshot && snapshot.playersByTag && typeof snapshot.playersByTag === "object" ? snapshot.playersByTag : {};
	const currentMainTags = Array.isArray(snapshot && snapshot.currentMainTags) ? snapshot.currentMainTags : [];
	const currentMainSet = snapshot && snapshot.currentMainTagSet && typeof snapshot.currentMainTagSet === "object" ? snapshot.currentMainTagSet : {};
	const selectedSet = {};

	for (let i = 0; i < idealTargetTags.length; i++) {
		const tag = idealTargetTags[i];
		if (!playersByTag[tag]) continue;
		selectedSet[tag] = true;
	}

	const forcedKeepSet = {};
	for (let i = 0; i < currentMainTags.length; i++) {
		const tag = currentMainTags[i];
		const player = playersByTag[tag];
		if (!player || !player.excludeAsSwapSource) continue;
		forcedKeepSet[tag] = true;
		selectedSet[tag] = true;
	}

	const blockedInSet = {};
	const selectedTagsForCheck = Object.keys(selectedSet);
	for (let i = 0; i < selectedTagsForCheck.length; i++) {
		const tag = selectedTagsForCheck[i];
		const player = playersByTag[tag];
		if (!player) continue;
		if (!currentMainSet[tag] && player.excludeAsSwapTarget) {
			blockedInSet[tag] = true;
			delete selectedSet[tag];
		}
	}

	while (Object.keys(selectedSet).length > mainSize) {
		const removable = Object.keys(selectedSet).filter((tag) => !forcedKeepSet[tag]);
		if (!removable.length) break;
		removable.sort((a, b) => compareActionableRemovalPriority_(a, b, snapshot, forcedKeepSet));
		delete selectedSet[removable[0]];
	}

	if (Object.keys(selectedSet).length < mainSize) {
		for (let i = 0; i < currentMainTags.length && Object.keys(selectedSet).length < mainSize; i++) {
			const tag = currentMainTags[i];
			if (!playersByTag[tag] || selectedSet[tag]) continue;
			selectedSet[tag] = true;
		}
	}

	if (Object.keys(selectedSet).length < mainSize) {
		const fillCandidates = players.slice().sort((a, b) => {
			if (a.strengthScore !== b.strengthScore) return b.strengthScore - a.strengthScore;
			if (a.startsNeeded !== b.startsNeeded) return b.startsNeeded - a.startsNeeded;
			return compareTagsAsc_(a.tag, b.tag);
		});
		for (let i = 0; i < fillCandidates.length && Object.keys(selectedSet).length < mainSize; i++) {
			const p = fillCandidates[i];
			if (selectedSet[p.tag]) continue;
			if (!currentMainSet[p.tag] && p.excludeAsSwapTarget) continue;
			selectedSet[p.tag] = true;
		}
	}

	const blockedOutTags = [];
	const idealSet = listToTagSet_(idealTargetTags);
	for (let i = 0; i < currentMainTags.length; i++) {
		const tag = currentMainTags[i];
		if (idealSet[tag]) continue;
		const player = playersByTag[tag];
		if (player && player.excludeAsSwapSource) blockedOutTags.push(tag);
	}

	const targetTags = orderTargetMainTags_(selectedSet, snapshot);
	return {
		targetTags: targetTags,
		blockedOutTags: dedupeTagList_(blockedOutTags),
		blockedInTags: dedupeTagList_(Object.keys(blockedInSet)),
	};
}

// Handle reason rank for code.
function reasonRankForCode_(code) {
	const c = String(code == null ? "" : code);
	if (c === "reward_critical") return 4;
	if (c === "missed_attack_risk") return 3;
	if (c === "strength_upgrade") return 2;
	if (c === "th_upgrade") return 1;
	if (c === "blocked_by_exclusion") return 0;
	return -1;
}

// Build swap explanation.
function buildSwapExplanation_(swapInPlayer, benchOutPlayer, config) {
	const inPlayer = swapInPlayer && typeof swapInPlayer === "object" ? swapInPlayer : {};
	const outPlayer = benchOutPlayer && typeof benchOutPlayer === "object" ? benchOutPlayer : {};
	const strengthDelta = (Number(inPlayer.strengthScore) || 0) - (Number(outPlayer.strengthScore) || 0);
	const strengthThreshold = isFinite(Number(config && config.reasonStrengthDeltaThreshold)) ? Number(config.reasonStrengthDeltaThreshold) : 0.05;
	const rewardCriticalIn = toNonNegativeInt_(inPlayer.startsNeeded) > 0 && Number(inPlayer.rewardSlackMargin) <= 0;
	const missedAttackRisk = !!(outPlayer.hasMissedAttackHistory && !inPlayer.hasMissedAttackHistory);
	const thUpgrade = toNonNegativeInt_(inPlayer.th) > toNonNegativeInt_(outPlayer.th);

	let reasonCode = "strength_upgrade";
	let shortReason = "Strength upgrade";
	if (rewardCriticalIn) {
		reasonCode = "reward_critical";
		shortReason = "Reward-critical start allocation";
	} else if (missedAttackRisk) {
		reasonCode = "missed_attack_risk";
		shortReason = "Lower missed-attack risk";
	} else if (strengthDelta >= strengthThreshold) {
		reasonCode = "strength_upgrade";
		shortReason = "Clear strength upgrade";
	} else if (thUpgrade && strengthDelta >= -0.02) {
		reasonCode = "th_upgrade";
		shortReason = "TH upgrade with no major downside";
	} else {
		reasonCode = "strength_upgrade";
		shortReason = "Lineup strength balancing";
	}

	const rewardImpact = "in needs " + toNonNegativeInt_(inPlayer.startsNeeded) + " start(s), out needs " + toNonNegativeInt_(outPlayer.startsNeeded) + ".";
	const reasonText = shortReason + " (" + rewardImpact + ")";
	return {
		reasonCode: reasonCode,
		shortReason: shortReason,
		scoreDelta: safeRoundNumber_(strengthDelta, 4),
		rewardImpact: rewardImpact,
		reasonText: reasonText,
		reasonRank: reasonRankForCode_(reasonCode),
	};
}

// Build pairs from delta.
function buildPairsFromDelta_(swapInTagsRaw, benchOutTagsRaw, snapshot, config) {
	const swapInTags = dedupeTagList_(swapInTagsRaw);
	const benchOutTags = dedupeTagList_(benchOutTagsRaw);
	const playersByTag = snapshot && snapshot.playersByTag && typeof snapshot.playersByTag === "object" ? snapshot.playersByTag : {};
	const availableOutByTag = listToTagSet_(benchOutTags);
	const pairs = [];

	const swapInPlayers = swapInTags
		.map((tag) => playersByTag[tag])
		.filter(Boolean)
		.sort((a, b) => {
			const aCritical = a.startsNeeded > 0 && Number(a.rewardSlackMargin) <= 0;
			const bCritical = b.startsNeeded > 0 && Number(b.rewardSlackMargin) <= 0;
			if (aCritical !== bCritical) return aCritical ? -1 : 1;
			if (a.startsNeeded !== b.startsNeeded) return b.startsNeeded - a.startsNeeded;
			if (a.strengthScore !== b.strengthScore) return b.strengthScore - a.strengthScore;
			return compareTagsAsc_(a.tag, b.tag);
		});

	for (let i = 0; i < swapInPlayers.length; i++) {
		const swapInPlayer = swapInPlayers[i];
		const outCandidates = [];
		for (let j = 0; j < benchOutTags.length; j++) {
			const outTag = benchOutTags[j];
			if (!availableOutByTag[outTag]) continue;
			const outPlayer = playersByTag[outTag];
			if (!outPlayer) continue;
			const explanation = buildSwapExplanation_(swapInPlayer, outPlayer, config);
			outCandidates.push({
				outPlayer: outPlayer,
				explanation: explanation,
				thDiff: Math.abs(toNonNegativeInt_(swapInPlayer.th) - toNonNegativeInt_(outPlayer.th)),
			});
		}
		if (!outCandidates.length) continue;

		outCandidates.sort((a, b) => {
			if (a.thDiff !== b.thDiff) return a.thDiff - b.thDiff;
			if (a.explanation.reasonRank !== b.explanation.reasonRank) {
				return b.explanation.reasonRank - a.explanation.reasonRank;
			}
			if (a.explanation.scoreDelta !== b.explanation.scoreDelta) {
				return b.explanation.scoreDelta - a.explanation.scoreDelta;
			}
			if (a.outPlayer.strengthScore !== b.outPlayer.strengthScore) {
				return a.outPlayer.strengthScore - b.outPlayer.strengthScore;
			}
			return compareTagsAsc_(a.outPlayer.tag, b.outPlayer.tag);
		});

		const chosen = outCandidates[0];
		delete availableOutByTag[chosen.outPlayer.tag];
		pairs.push({
			outTag: chosen.outPlayer.tag,
			inTag: swapInPlayer.tag,
			reasonCode: chosen.explanation.reasonCode,
			reasonText: chosen.explanation.reasonText,
			shortReason: chosen.explanation.shortReason,
			scoreDelta: chosen.explanation.scoreDelta,
			rewardImpact: chosen.explanation.rewardImpact,
		});
	}

	return pairs;
}

// Derive next day swap suggestions from plan.
function deriveNextDaySwapSuggestionsFromPlan_(roster, plan, snapshot, config) {
	const currentMainTags = dedupeTagList_(snapshot && snapshot.currentMainTags);
	const currentMainSet = listToTagSet_(currentMainTags);
	const idealTargetMainTags = dedupeTagList_(plan && plan.targetMainTags);
	const actionable = buildActionableTargetMainTags_(snapshot, idealTargetMainTags);
	const actionableTargetMainTags = dedupeTagList_(actionable && actionable.targetTags);
	const actionableTargetSet = listToTagSet_(actionableTargetMainTags);

	let benchTags = tagListDiff_(currentMainTags, actionableTargetSet);
	let swapInTags = tagListDiff_(actionableTargetMainTags, currentMainSet);

	const playersByTag = snapshot && snapshot.playersByTag && typeof snapshot.playersByTag === "object" ? snapshot.playersByTag : {};
	benchTags = benchTags.filter((tag) => !(playersByTag[tag] && playersByTag[tag].excludeAsSwapSource));
	swapInTags = swapInTags.filter((tag) => !(playersByTag[tag] && playersByTag[tag].excludeAsSwapTarget));

	const pairs = buildPairsFromDelta_(swapInTags, benchTags, snapshot, config);
	const blockedOutTags = dedupeTagList_(actionable && actionable.blockedOutTags);
	const blockedInTags = dedupeTagList_(actionable && actionable.blockedInTags);
	const blockedByExclusions = blockedOutTags.length > 0 || blockedInTags.length > 0;

	return {
		targetMainTags: idealTargetMainTags,
		actionableTargetMainTags: actionableTargetMainTags,
		benchTags: benchTags,
		swapInTags: swapInTags,
		pairs: pairs,
		blockedByExclusions: blockedByExclusions,
		blockedByExclusionOutTags: blockedOutTags,
		blockedByExclusionInTags: blockedInTags,
	};
}

// Build bench suggestion summary.
function buildBenchSuggestionSummary_(roster, plan, suggestions, snapshot, config) {
	const players = Array.isArray(snapshot && snapshot.players) ? snapshot.players : [];
	const rewardCriticalPlayerTags = players.filter((p) => p.rewardCritical).map((p) => p.tag);
	const impossibleRewardPlayerTags = players.filter((p) => p.impossibleReward).map((p) => p.tag);
	const rewardFeasiblePlayerCount = players.length - impossibleRewardPlayerTags.length;
	const warnings = [];
	const seasonWarnings = snapshot && snapshot.seasonContext && Array.isArray(snapshot.seasonContext.warnings) ? snapshot.seasonContext.warnings : [];
	for (let i = 0; i < seasonWarnings.length; i++) warnings.push(seasonWarnings[i]);
	if (snapshot && snapshot.requestedMainSize > snapshot.mainSize) warnings.push("active-slots-clamped-to-roster-size");
	if (plan && Array.isArray(plan.warnings)) {
		for (let i = 0; i < plan.warnings.length; i++) warnings.push(plan.warnings[i]);
	}
	if (snapshot && snapshot.remainingEditableDays <= 0) warnings.push("no-editable-cwl-day");

	const plannerSummary = {
		remainingEditableDays: Math.max(0, toNonNegativeInt_(snapshot && snapshot.remainingEditableDays)),
		optimalTotalSlack: Math.max(0, toNonNegativeInt_(plan && plan.optimalTotalSlack)),
		rewardFeasiblePlayerCount: Math.max(0, toNonNegativeInt_(rewardFeasiblePlayerCount)),
		rewardCriticalPlayerTags: rewardCriticalPlayerTags,
		impossibleRewardPlayerTags: impossibleRewardPlayerTags,
		blockedByExclusions: !!(suggestions && suggestions.blockedByExclusions),
		blockedByExclusionOutTags: dedupeTagList_(suggestions && suggestions.blockedByExclusionOutTags),
		blockedByExclusionInTags: dedupeTagList_(suggestions && suggestions.blockedByExclusionInTags),
		solverMode: String((plan && plan.solverMode) || ""),
	};
	const dedupedWarnings = dedupeStringList_(warnings, 20);
	if (dedupedWarnings.length) plannerSummary.warnings = dedupedWarnings;

	return {
		plannerSummary: plannerSummary,
		configSnapshot: {
			defaultSeasonDays: Number(config && config.defaultSeasonDays) || 7,
			priorMeanStarsPerStart: Number(config && config.priorMeanStarsPerStart) || 2,
			priorWeightAttacks: Number(config && config.priorWeightAttacks) || 0,
			minExpectedStarsPerStart: Number(config && config.minExpectedStarsPerStart) || 0,
			maxExpectedStarsPerStart: Number(config && config.maxExpectedStarsPerStart) || 0,
			weightTH: Number(config && config.weightTH) || 0,
			weightStarsPerf: Number(config && config.weightStarsPerf) || 0,
			weightDestructionPerf: Number(config && config.weightDestructionPerf) || 0,
			weightThreeStarRate: Number(config && config.weightThreeStarRate) || 0,
			weightHitUpAbility: Number(config && config.weightHitUpAbility) || 0,
			weightHitEvenAbility: Number(config && config.weightHitEvenAbility) || 0,
			weightReliabilityPenalty: Number(config && config.weightReliabilityPenalty) || 0,
			churnPenalty: Number(config && config.churnPenalty) || 0,
		},
	};
}

// Compute bench suggestions core.
function computeBenchSuggestionsCore_(rosterData, rosterId, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const ctx = findRosterById_(rosterData, rosterId);
	const trackingMode = getRosterTrackingMode_(ctx.roster);
	if (trackingMode === "regularWar") {
		clearRosterBenchSuggestions_(ctx.roster);
		const outRosterData = validateRosterData_(ctx.rosterData);
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
		const outRosterData = validateRosterData_(ctx.rosterData);
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
		algorithm: String(config.algorithm || "season_milp_v1"),
		nextEditableDayIndex: snapshot.remainingEditableDays > 0 ? 0 : -1,
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
	Logger.log("computeBenchSuggestions planner rosterId=%s days=%s slack=%s solver=%s swaps=%s blocked=%s", ctx.rosterId, snapshot.remainingEditableDays, plan.optimalTotalSlack, plan.solverMode, suggestions.pairs.length, suggestions.blockedByExclusions ? "1" : "0");

	const outRosterData = validateRosterData_(ctx.rosterData);
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
