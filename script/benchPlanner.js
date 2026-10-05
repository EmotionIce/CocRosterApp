// CWL swap suggestions: preserve good mains and replace unreliable or weak attackers.

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

// Build bench history context.
function buildBenchHistoryContext_(rosterRaw, seasonRaw, globalPerformanceRaw) {
	const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
	const season = String(seasonRaw == null ? "" : seasonRaw).trim();
	const globalPerformance = globalPerformanceRaw && typeof globalPerformanceRaw === "object"
		? sanitizePlayerWarPerformanceStore_(globalPerformanceRaw)
		: null;
	if (globalPerformance && normalizePlayerWarTrackingStage_(globalPerformance.stage) === "cutover") {
		const previousCwlByTag = {};
		Object.keys(globalPerformance.byTag || {}).forEach(function (tagRaw) {
			const tag = normalizeTag_(tagRaw);
			if (!tag) return;
			const globalEntry = globalPerformance.byTag[tagRaw] && typeof globalPerformance.byTag[tagRaw] === "object"
				? globalPerformance.byTag[tagRaw]
				: {};
			const previous = sanitizeWarPerformanceStatsEntry_(globalEntry.cwl);
			const currentSeason = globalEntry.cwlSeasonContext && globalEntry.cwlSeasonContext.bySeason && globalEntry.cwlSeasonContext.bySeason[season]
				? globalEntry.cwlSeasonContext.bySeason[season]
				: null;
			if (currentSeason && currentSeason.stats) addSignedPlayerWarStats_(previous, currentSeason.stats, -1);
			if (hasWarPerformanceStatsData_(previous)) previousCwlByTag[tag] = previous;
		});
		return {
			warPerformance: globalPerformance,
			cleanPreviousCwlAvailable: true,
			previousCwlByTag: previousCwlByTag,
			historyStatus: "global_event_ledger_excluding_current_season",
			warnings: [],
		};
	}
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

// Difficult hit-ups soften poor-attack penalties; unknown target TH gets no exemption.
function benchFailureDifficulty_(deltaRaw) {
	if (deltaRaw == null) return 1;
	const delta = Number(deltaRaw);
	return delta >= 2 ? 0.25 : delta > 0 ? 0.5 : delta < 0 ? 1.25 : 1;
}

// History supplies only a small starting estimate. Current-season results carry
// the decisions, including an explicit penalty that history cannot erase.
function computeBenchAttackModel_(tagRaw, currentRaw, historyRaw, previousRaw, config) {
	const current = sanitizeCwlStatEntry_(currentRaw);
	const history = sanitizeWarPerformanceEntry_(historyRaw);
	const previous = sanitizeWarPerformanceStatsEntry_(previousRaw);
	const regular = history.formStats && history.formStats.regular && history.formStats.regular.countedAttacks > 0
		? history.formStats.regular : history.regular;
	let historicalStars = 0, historicalSamples = 0;
	for (const source of [{ stats: previous, weight: 0.35 }, { stats: regular, weight: 0.2 }]) {
		const stats = source.stats;
		const opportunities = Math.max(stats.possibleAttacks, stats.usedAttacks, stats.countedAttacks);
		if (!opportunities) continue;
		const samples = Math.min(2, opportunities) * source.weight;
		const reliability = source.stats === regular ? history.regular : previous;
		const usedRate = reliability.possibleAttacks > 0 ? clampNumber_(reliability.usedAttacks / reliability.possibleAttacks, 0, 1) : 1;
		const quality = stats.countedAttacks > 0 ? clampNumber_(stats.starsTotal / stats.countedAttacks, 0, 3) : config.unknownStarsPerAppearance;
		historicalSamples += samples;
		historicalStars += quality * usedRate * samples;
	}
	const priorWeight = config.priorAppearances;
	let valueSum = config.unknownStarsPerAppearance * priorWeight + historicalStars;
	let starsSum = valueSum;
	let samples = priorWeight + historicalSamples;
	let usedWeight = 0, opportunityWeight = 0, failureWeight = 0, badAttackCount = 0;
	const results = sanitizeCwlAttackResults_(current.attackResults);
	for (let i = 0; i < results.length; i++) {
		const result = results[i];
		const weight = Math.pow(config.currentSeasonDecay, i);
		const severity = benchFailureDifficulty_(result.townHallDelta);
		const penalty = result.missed ? config.missedAttackPenalty
			: result.stars === 0 ? config.zeroStarPenalty * severity
			: result.stars === 1 ? config.oneStarPenalty * severity : 0;
		valueSum += (result.stars - penalty) * weight;
		starsSum += result.stars * weight;
		samples += weight;
		opportunityWeight += weight;
		if (!result.missed) {
			usedWeight += weight;
			if (result.stars <= 1) { failureWeight += severity * weight; badAttackCount++; }
		}
	}
	// Cached aggregates may predate per-war evidence. Use their uncovered totals
	// once, without inventing individual attack results or target difficulty.
	const coveredAttacks = results.filter(function (r) { return !r.missed; }).length;
	const coveredStars = results.reduce(function (sum, r) { return sum + r.stars; }, 0);
	const coveredTriples = results.filter(function (r) { return !r.missed && r.stars === 3; }).length;
	const coveredMisses = results.filter(function (r) { return r.missed; }).length;
	const uncoveredAttacks = Math.max(0, current.countedAttacks - coveredAttacks);
	const uncoveredMisses = Math.max(0, current.missedAttacks - coveredMisses);
	const uncoveredStars = Math.max(0, current.starsTotal - coveredStars);
	if (uncoveredAttacks || uncoveredMisses) {
		// A lower bound on zero/one-star failures, not a fabricated exact count.
		const failures = Math.min(uncoveredAttacks, Math.max(0, Math.ceil((2 * uncoveredAttacks + Math.max(0, current.threeStarCount - coveredTriples) - uncoveredStars) / 2)));
		valueSum += uncoveredStars - config.oneStarPenalty * failures - config.missedAttackPenalty * uncoveredMisses;
		starsSum += uncoveredStars;
		samples += uncoveredAttacks + uncoveredMisses;
		usedWeight += uncoveredAttacks;
		opportunityWeight += uncoveredAttacks + uncoveredMisses;
		failureWeight += failures;
		badAttackCount += failures;
	}
	const failureRate = usedWeight > 0 ? failureWeight / usedWeight : 0;
	return {
		tag: normalizeTag_(tagRaw),
		performanceValue: valueSum / Math.max(0.01, samples) - Math.min(1.5, current.missedAttacks * config.seasonMissPenalty),
		expectedStarsPerAppearance: clampNumber_(starsSum / Math.max(0.01, samples), 0, 3),
		attackUseProbability: (0.95 * priorWeight + usedWeight) / Math.max(0.01, priorWeight + opportunityWeight),
		poorAttackRate: failureRate,
		badAttackCount: badAttackCount,
		poorPerformance: failureRate >= config.poorAttackRateThreshold,
		missedAttacks: current.missedAttacks,
		currentCwlAttacks: current.countedAttacks,
		historicalSampleWeight: historicalSamples,
	};
}

function computeBenchPlayerValue_(player, model, config) {
	const th = Number(player && player.th);
	const normalizedTh = th > 0 ? clampNumber_((th - 1) / 17, 0, 1) : 0.5;
	return { score: model.performanceValue + config.townHallBonus * normalizedTh, normTH: normalizedTh };
}

function buildCwlPlanningSnapshot_(roster, season, config, globalPerformanceRaw) {
	const mainTags = dedupeTagList_((roster.main || []).map(function (p) { return p.tag; }));
	const mainSet = listToTagSet_(mainTags);
	const historyContext = buildBenchHistoryContext_(roster, season.season, globalPerformanceRaw);
	const statsByTag = roster.cwlStats && roster.cwlStats.byTag || {};
	const players = collectRosterUsablePlayers_(roster).map(function (p) {
		const tag = normalizeTag_(p.tag);
		const stats = sanitizeCwlStatEntry_(statsByTag[tag]);
		const model = computeBenchAttackModel_(tag, stats, (historyContext.warPerformance.byTag || {})[tag], historyContext.previousCwlByTag[tag], config);
		const value = computeBenchPlayerValue_(p, model, config);
		return {
			tag: tag, name: String(p.name || tag), th: toNonNegativeInt_(p.th),
			isCurrentMain: !!mainSet[tag], alwaysIn: toBooleanFlag_(p.excludeAsSwapSource), neverIn: toBooleanFlag_(p.excludeAsSwapTarget),
			starsTotal: stats.starsTotal, starsNeeded: Math.max(0, 8 - stats.starsTotal),
			currentWarAttackPending: stats.currentWarAttackPending, missedAttacks: stats.missedAttacks,
			poorPerformance: model.poorPerformance, attackModel: model, lineupValue: value.score,
			expectedStarsPerAppearance: model.expectedStarsPerAppearance, attackUseProbability: model.attackUseProbability,
			avgDestruction: stats.countedAttacks > 0 ? stats.totalDestruction / stats.countedAttacks : 0,
		};
	});
	const playersByTag = {};
	players.forEach(function (p) { playersByTag[p.tag] = p; });
	const requestedSize = Number(roster.badges && roster.badges.main);
	return {
		players: players, playersByTag: playersByTag, rosterPoolSize: players.length,
		mainSize: isFinite(requestedSize) ? Math.max(0, Math.floor(requestedSize)) : mainTags.length,
		requestedMainSize: isFinite(requestedSize) ? Math.max(0, Math.floor(requestedSize)) : mainTags.length,
		currentMainTags: mainTags.filter(function (tag) { return !!playersByTag[tag]; }),
		remainingEditableDays: toNonNegativeInt_(season.remainingEditableDays), nextEditableDayIndex: season.nextEditableDayIndex,
		needsRewardsCount: players.filter(function (p) { return !p.neverIn && p.starsNeeded > 0; }).length,
		seasonContext: season, historyContext: historyContext,
	};
}

function compareBenchPlayers_(a, b) {
	return b.lineupValue - a.lineupValue || b.avgDestruction - a.avgDestruction || compareTagsAsc_(a.tag, b.tag);
}

function orderTargetMainTags_(selectedSet, snapshot) {
	const kept = snapshot.currentMainTags.filter(function (tag) { return !!selectedSet[tag]; });
	return kept.concat(snapshot.players.filter(function (p) { return selectedSet[p.tag] && kept.indexOf(p.tag) < 0; }).sort(compareBenchPlayers_).map(function (p) { return p.tag; }));
}

function validateBenchPlanningConstraints_(snapshot) {
	const warnings = [];
	const players = snapshot.players;
	players.forEach(function (p) { if (p.alwaysIn && p.neverIn) warnings.push("restriction-conflict:" + p.tag); });
	if (snapshot.mainSize <= 0) warnings.push("invalid-lineup-size");
	if (snapshot.mainSize > players.length) warnings.push("lineup-size-exceeds-usable-pool");
	if (players.filter(function (p) { return p.alwaysIn; }).length > snapshot.mainSize) warnings.push("too-many-always-in-players");
	if (players.filter(function (p) { return !p.neverIn; }).length < snapshot.mainSize) warnings.push("too-few-eligible-players");
	return { valid: warnings.length === 0, warnings: warnings };
}

function buildBenchSwapPair_(incoming, outgoing, reasonCode, config) {
	let reason;
	if (reasonCode === "restriction_never_in") reason = "Never in war";
	else if (reasonCode === "restriction_always_in") reason = "Always in war";
	else if (reasonCode === "missed_attack") reason = outgoing.missedAttacks + " confirmed missed attack(s); use a capable substitute";
	else if (reasonCode === "poor_performance") reason = "Poor zero/one-star results, adjusted for target TH; stronger substitute";
	else if (reasonCode === "reward_rotation") reason = "Near eight stars with equivalent performance";
	else reason = "Meaningful performance improvement";
	return {
		outTag: outgoing.tag, inTag: incoming.tag, reasonCode: reasonCode, shortReason: reason,
		reasonText: reason + ". Performance value " + safeRoundNumber_(outgoing.lineupValue, 2) + " → " + safeRoundNumber_(incoming.lineupValue, 2) + ".",
		scoreDelta: safeRoundNumber_(incoming.lineupValue - outgoing.lineupValue, 4),
		reliabilityDelta: safeRoundNumber_(incoming.attackUseProbability - outgoing.attackUseProbability, 4),
	};
}

// Hard restrictions, confirmed misses, weak attacks, then a small number of
// marginal improvements. Every decision records its actual one-for-one pair.
function solveSeasonLineupPlan_(snapshot, config) {
	const warnings = (snapshot.seasonContext.warnings || []).concat(snapshot.historyContext.warnings || []);
	const constraints = validateBenchPlanningConstraints_(snapshot);
	const plan = {
		targetMainTags: snapshot.currentMainTags.slice(), pairs: [], warnings: warnings.concat(constraints.warnings),
		solverMode: "performance_selection", invalidConstraints: !constraints.valid, invalidReason: constraints.valid ? "" : "invalid_constraints",
		missedAttackSwapCount: 0, performanceSwapCount: 0, marginalSwapCount: 0, rewardRotationCount: 0,
		unreplacedMissedAttackTags: [], unreplacedPoorPerformanceTags: [],
	};
	if (!constraints.valid || !snapshot.remainingEditableDays) {
		if (!snapshot.remainingEditableDays) plan.warnings.push("no-editable-cwl-round");
		return plan;
	}
	const byTag = snapshot.playersByTag;
	const selected = listToTagSet_(snapshot.currentMainTags);
	const touched = {};
	const removed = [];
	const added = [];
	// Never-in players leave; always-in players take precedence over retained mains.
	for (const tag of Object.keys(selected)) if (byTag[tag].neverIn) { delete selected[tag]; removed.push(byTag[tag]); }
	for (const p of snapshot.players.filter(function (p) { return p.alwaysIn && !selected[p.tag]; }).sort(compareBenchPlayers_)) {
		selected[p.tag] = true; added.push(p);
	}
	const removalOrder = function (a, b) {
		return Number(b.missedAttacks > 0) - Number(a.missedAttacks > 0) || Number(b.poorPerformance) - Number(a.poorPerformance) || compareBenchPlayers_(b, a);
	};
	while (Object.keys(selected).length > snapshot.mainSize) {
		const outgoing = snapshot.players.filter(function (p) { return selected[p.tag] && !p.alwaysIn; }).sort(removalOrder)[0];
		delete selected[outgoing.tag]; removed.push(outgoing);
	}
	for (const p of snapshot.players.filter(function (p) { return !selected[p.tag] && !p.neverIn && removed.indexOf(p) < 0; }).sort(compareBenchPlayers_)) {
		if (Object.keys(selected).length >= snapshot.mainSize) break;
		selected[p.tag] = true; added.push(p);
	}
	for (let i = 0; i < Math.min(removed.length, added.length); i++) {
		const outgoing = removed[i], incoming = added[i];
		plan.pairs.push(buildBenchSwapPair_(incoming, outgoing, outgoing.neverIn ? "restriction_never_in" : incoming.alwaysIn ? "restriction_always_in" : "lineup_upgrade", config));
	}
	removed.concat(added).forEach(function (p) { touched[p.tag] = true; });
	const replace = function (outgoing, incoming, reason) {
		delete selected[outgoing.tag]; selected[incoming.tag] = true;
		touched[outgoing.tag] = touched[incoming.tag] = true;
		plan.pairs.push(buildBenchSwapPair_(incoming, outgoing, reason, config));
		if (reason === "missed_attack") plan.missedAttackSwapCount++;
		else if (reason === "poor_performance") plan.performanceSwapCount++;
		else if (reason === "reward_rotation") plan.rewardRotationCount++;
		else plan.marginalSwapCount++;
	};
	const substitutes = function (outgoing) {
		return snapshot.players.filter(function (p) {
			return !selected[p.tag] && !touched[p.tag] && !p.neverIn && !p.missedAttacks &&
				p.lineupValue >= config.minimumReplacementValue &&
				p.th > 0 && (!outgoing.th || p.th >= outgoing.th - config.maxReplacementTownHallDrop);
		}).sort(compareBenchPlayers_);
	};
	const problemMains = snapshot.players.filter(function (p) { return selected[p.tag] && !p.alwaysIn && !touched[p.tag] && (p.missedAttacks || p.poorPerformance); }).sort(removalOrder);
	// Match scarce substitutes before recording swaps. Reassigning a provisional
	// match keeps a flexible main from taking another main's only capable backup.
	const matchedByInTag = {};
	const assignSubstitute = function (outgoing, visited) {
		for (const incoming of substitutes(outgoing)) {
			if (visited[incoming.tag] || (!outgoing.missedAttacks && incoming.lineupValue - outgoing.lineupValue < config.poorPerformanceMinGain)) continue;
			visited[incoming.tag] = true;
			const previousOut = matchedByInTag[incoming.tag];
			if (!previousOut || assignSubstitute(previousOut, visited)) {
				matchedByInTag[incoming.tag] = outgoing;
				return true;
			}
		}
		return false;
	};
	problemMains.forEach(function (outgoing) { assignSubstitute(outgoing, {}); });
	for (const outgoing of problemMains) {
		const incomingTag = Object.keys(matchedByInTag).find(function (tag) { return matchedByInTag[tag] === outgoing; });
		const incoming = incomingTag ? byTag[incomingTag] : null;
		if (incoming) replace(outgoing, incoming, outgoing.missedAttacks ? "missed_attack" : "poor_performance");
		else (outgoing.missedAttacks ? plan.unreplacedMissedAttackTags : plan.unreplacedPoorPerformanceTags).push(outgoing.tag);
	}
	if (snapshot.seasonContext.estimated) plan.warnings.push("marginal-swaps-suppressed-estimated-context");
	else {
		while (plan.marginalSwapCount < config.maxMarginalSwaps) {
			let best = null;
			for (const outgoing of snapshot.players.filter(function (p) { return selected[p.tag] && !touched[p.tag] && !p.alwaysIn; })) {
				const incoming = substitutes(outgoing)[0];
				if (!incoming) continue;
				const gain = incoming.lineupValue - outgoing.lineupValue;
				if (gain < config.meaningfulUpgradeMinGain) continue;
				if (!best || gain > best.gain || (gain === best.gain && compareTagsAsc_(incoming.tag + outgoing.tag, best.incoming.tag + best.outgoing.tag) < 0)) best = { incoming: incoming, outgoing: outgoing, gain: gain };
			}
			if (!best) break;
			replace(best.outgoing, best.incoming, "lineup_upgrade");
		}
		// Reward need cannot reserve appearances, block an upgrade, or justify a
		// weak substitute. One equivalent rotation shares the marginal-swap cap.
		if (plan.marginalSwapCount < config.maxMarginalSwaps && !plan.unreplacedMissedAttackTags.length && !plan.unreplacedPoorPerformanceTags.length) {
			let rotation = null;
			for (const outgoing of snapshot.players.filter(function (p) { return selected[p.tag] && !touched[p.tag] && !p.alwaysIn && !p.missedAttacks && !p.poorPerformance && p.starsTotal >= 8; }).sort(function (a, b) { return compareBenchPlayers_(b, a); })) {
				const incoming = substitutes(outgoing).find(function (p) {
					return !p.poorPerformance && !p.currentWarAttackPending && p.starsTotal >= 6 && p.starsTotal < 8 &&
						p.expectedStarsPerAppearance >= p.starsNeeded && p.lineupValue >= outgoing.lineupValue - config.rewardRotationMaxLoss;
				});
				if (incoming) { rotation = { outgoing: outgoing, incoming: incoming }; break; }
			}
			if (rotation) replace(rotation.outgoing, rotation.incoming, "reward_rotation");
		}
	}
	plan.targetMainTags = orderTargetMainTags_(selected, snapshot);
	return plan;
}

function deriveNextDaySwapSuggestionsFromPlan_(roster, plan, snapshot, config) {
	const currentSet = listToTagSet_(snapshot.currentMainTags);
	const targetSet = listToTagSet_(plan.targetMainTags);
	return {
		targetMainTags: plan.targetMainTags.slice(), actionableTargetMainTags: plan.targetMainTags.slice(),
		benchTags: tagListDiff_(snapshot.currentMainTags, targetSet), swapInTags: tagListDiff_(plan.targetMainTags, currentSet),
		pairs: plan.pairs.slice(),
	};
}

function buildBenchSuggestionSummary_(roster, plan, suggestions, snapshot, config) {
	const season = snapshot.seasonContext;
	const configSnapshot = {};
	Object.keys(config).forEach(function (key) { if (typeof config[key] === "number") configSnapshot[key] = config[key]; });
	return {
		plannerSummary: {
			remainingEditableDays: snapshot.remainingEditableDays, nextEditableDayIndex: snapshot.nextEditableDayIndex,
			contextSource: String(season.contextSource || season.source || ""), estimatedContext: !!season.estimated,
			roundStates: (season.roundStates || []).slice(0, 10), solverMode: plan.solverMode, historyStatus: snapshot.historyContext.historyStatus,
			missedAttackSwapCount: plan.missedAttackSwapCount, performanceSwapCount: plan.performanceSwapCount,
			marginalSwapCount: plan.marginalSwapCount, rewardRotationCount: plan.rewardRotationCount,
			unreplacedMissedAttackTags: plan.unreplacedMissedAttackTags, unreplacedPoorPerformanceTags: plan.unreplacedPoorPerformanceTags,
			invalidConstraints: plan.invalidConstraints, invalidReason: plan.invalidReason, warnings: dedupeStringList_(plan.warnings, 30),
		},
		configSnapshot: configSnapshot,
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
	const snapshot = buildCwlPlanningSnapshot_(ctx.roster, seasonContext, config, ctx.rosterData && ctx.rosterData.playerWarPerformance);
	const plan = solveSeasonLineupPlan_(snapshot, config);
	const suggestions = deriveNextDaySwapSuggestionsFromPlan_(ctx.roster, plan, snapshot, config);
	const summary = buildBenchSuggestionSummary_(ctx.roster, plan, suggestions, snapshot, config);

	const benchSuggestions = {
		updatedAt: updatedAt,
		algorithm: String(config.algorithm || "cwl_performance_swaps_v3"),
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
	Logger.log("computeBenchSuggestions planner rosterId=%s days=%s nextEditable=%s solver=%s swaps=%s marginal=%s invalid=%s", ctx.rosterId, snapshot.remainingEditableDays, benchSuggestions.nextEditableDayIndex, plan.solverMode, suggestions.pairs.length, plan.marginalSwapCount || 0, plan.invalidConstraints ? "1" : "0");

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
