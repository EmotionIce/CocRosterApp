// Refresh-all/pipeline orchestration and related diagnostics.

function normalizeActiveRosterForCompare_(rosterDataRaw) {
	const validated = validateRosterData_(rosterDataRaw);
	return JSON.stringify({
		schemaVersion: validated.schemaVersion,
		pageTitle: validated.pageTitle,
		rosterOrder: validated.rosterOrder,
		rosters: validated.rosters,
		playerMetrics: validated.playerMetrics,
		publicConfig: validated.publicConfig || null,
	});
}

function hasActiveRosterPayloadChanged_(beforeRaw, afterRaw) {
	return normalizeActiveRosterForCompare_(beforeRaw) !== normalizeActiveRosterForCompare_(afterRaw);
}

function withRosterLastUpdatedAt_(rosterDataRaw, timestampRaw) {
	const timestamp = String(timestampRaw == null ? "" : timestampRaw).trim() || new Date().toISOString();
	const validated = validateRosterData_(rosterDataRaw);
	const out = {
		schemaVersion: validated.schemaVersion,
		pageTitle: validated.pageTitle,
		rosterOrder: validated.rosterOrder,
		rosters: validated.rosters,
		playerMetrics: validated.playerMetrics,
		lastUpdatedAt: timestamp,
	};
	if (validated.publicConfig && typeof validated.publicConfig === "object") {
		out.publicConfig = validated.publicConfig;
	}
	return validateRosterData_(out);
}

function shortenIssueMessage_(messageRaw, maxLenRaw) {
	const text = String(messageRaw == null ? "" : messageRaw)
		.replace(/\s+/g, " ")
		.trim();
	if (!text) return "";
	const maxLen = Math.max(40, toNonNegativeInt_(maxLenRaw) || 160);
	if (text.length <= maxLen) return text;
	return text.slice(0, Math.max(0, maxLen - 3)).trim() + "...";
}

function buildAutoRefreshIssueSummary_(issuesRaw) {
	const issues = Array.isArray(issuesRaw) ? issuesRaw : [];
	if (!issues.length) return "";
	const first = issues[0] && typeof issues[0] === "object" ? issues[0] : {};
	const rosterName = String(first.rosterName == null ? "" : first.rosterName).trim() || "Unknown roster";
	const step = String(first.step == null ? "" : first.step).trim() || "pipeline";
	const message = shortenIssueMessage_(first.message, 180) || "Unknown issue.";
	return rosterName + " | " + step + " | " + message;
}

function findRosterInDataById_(rosterData, rosterIdRaw) {
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	if (!rosterId) return null;
	const rosters = rosterData && Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		if (String(roster.id || "").trim() === rosterId) return roster;
	}
	return null;
}

function cloneRosterDataForRefresh_(rosterDataRaw) {
	try {
		return JSON.parse(JSON.stringify(rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {}));
	} catch (err) {
		throw new Error("Unable to clone roster data for refresh rollback: " + errorMessage_(err));
	}
}

function findDuplicateRosterTags_(rosterDataRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const rosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	const byTag = {};
	const sections = ["main", "subs", "missing"];

	for (let rosterIndex = 0; rosterIndex < rosters.length; rosterIndex++) {
		const roster = rosters[rosterIndex] && typeof rosters[rosterIndex] === "object" ? rosters[rosterIndex] : {};
		const rosterId = String(roster.id == null ? "" : roster.id).trim() || "(missing-id@" + rosterIndex + ")";
		for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
			const section = sections[sectionIndex];
			const players = Array.isArray(roster[section]) ? roster[section] : [];
			for (let playerIndex = 0; playerIndex < players.length; playerIndex++) {
				const player = players[playerIndex] && typeof players[playerIndex] === "object" ? players[playerIndex] : {};
				const tag = normalizeTag_(player.tag);
				if (!tag) continue;
				if (!byTag[tag]) byTag[tag] = [];
				byTag[tag].push({
					rosterId: rosterId,
					section: section,
					index: playerIndex,
				});
			}
		}
	}

	const tags = Object.keys(byTag).sort();
	const duplicates = [];
	for (let i = 0; i < tags.length; i++) {
		const tag = tags[i];
		const occurrences = byTag[tag];
		if (!Array.isArray(occurrences) || occurrences.length < 2) continue;
		duplicates.push({
			tag: tag,
			occurrences: occurrences,
		});
	}
	return duplicates;
}

function formatDuplicateRosterTagsForMessage_(duplicatesRaw, maxTagsRaw, maxLocationsRaw) {
	const duplicates = Array.isArray(duplicatesRaw) ? duplicatesRaw : [];
	if (!duplicates.length) return "";
	const maxTags = Math.max(1, toNonNegativeInt_(maxTagsRaw) || 3);
	const maxLocations = Math.max(1, toNonNegativeInt_(maxLocationsRaw) || 4);
	const tagParts = [];
	for (let i = 0; i < duplicates.length && i < maxTags; i++) {
		const duplicate = duplicates[i] && typeof duplicates[i] === "object" ? duplicates[i] : {};
		const tag = normalizeTag_(duplicate.tag) || String(duplicate.tag || "");
		const occurrences = Array.isArray(duplicate.occurrences) ? duplicate.occurrences : [];
		const locationParts = [];
		for (let j = 0; j < occurrences.length && j < maxLocations; j++) {
			const occurrence = occurrences[j] && typeof occurrences[j] === "object" ? occurrences[j] : {};
			const rosterId = String(occurrence.rosterId == null ? "" : occurrence.rosterId).trim() || "?";
			const section = String(occurrence.section == null ? "" : occurrence.section).trim() || "?";
			const index = toNonNegativeInt_(occurrence.index);
			locationParts.push(rosterId + "/" + section + "[" + index + "]");
		}
		if (occurrences.length > maxLocations) locationParts.push("+" + (occurrences.length - maxLocations) + " more");
		tagParts.push(tag + ": " + locationParts.join(", "));
	}
	if (duplicates.length > maxTags) tagParts.push("+" + (duplicates.length - maxTags) + " more tag(s)");
	return "duplicate tag detail: " + tagParts.join(" ; ");
}

function appendDuplicateRosterTagDetailsToError_(stepLabelRaw, err, rosterDataRaw) {
	const baseMessage = errorMessage_(err);
	if (!/duplicate player tag in output/i.test(baseMessage)) return baseMessage;
	const duplicates = findDuplicateRosterTags_(rosterDataRaw);
	if (!duplicates.length) return baseMessage;
	const stepLabel = String(stepLabelRaw == null ? "" : stepLabelRaw).trim() || "refresh";
	Logger.log("duplicate-tag diagnostics (%s): %s", stepLabel, JSON.stringify(duplicates));
	const detail = formatDuplicateRosterTagsForMessage_(duplicates, 2, 3);
	return detail ? detail + " | " + baseMessage : baseMessage;
}

function rethrowWithDuplicateRosterTagDetails_(stepLabelRaw, err, rosterDataRaw) {
	const detailedMessage = appendDuplicateRosterTagDetailsToError_(stepLabelRaw, err, rosterDataRaw);
	if (detailedMessage === errorMessage_(err)) throw err;
	throw new Error(detailedMessage);
}

function buildRefreshAllPrefetchBundle_(sourceRostersRaw) {
	const sourceRosters = Array.isArray(sourceRostersRaw) ? sourceRostersRaw : [];
	const connectedClanTagSet = {};
	const regularWarClanTagSet = {};
	const cwlClanTagSet = {};

	for (let i = 0; i < sourceRosters.length; i++) {
		const roster = sourceRosters[i] && typeof sourceRosters[i] === "object" ? sourceRosters[i] : {};
		const rosterId = String(roster.id == null ? "" : roster.id).trim();
		if (!rosterId) continue;
		const clanTag = normalizeTag_(roster.connectedClanTag);
		if (!clanTag) continue;
		connectedClanTagSet[clanTag] = true;
		const trackingMode = getRosterTrackingMode_(roster);
		if (trackingMode === "regularWar") {
			regularWarClanTagSet[clanTag] = true;
		} else {
			cwlClanTagSet[clanTag] = true;
		}
	}

	const prefetchOptions = {
		batchSize: AUTO_REFRESH_PREFETCH_BATCH_SIZE,
		batchDelayMs: AUTO_REFRESH_PREFETCH_BATCH_DELAY_MS,
	};
	const connectedClanTags = Object.keys(connectedClanTagSet);
	const regularWarClanTags = Object.keys(regularWarClanTagSet);
	const cwlClanTags = Object.keys(cwlClanTagSet);
	const memberPrefetch = prefetchClanMembersSnapshotsByTag_(connectedClanTags, prefetchOptions);
	const regularWarPrefetch = prefetchCurrentRegularWarByClanTag_(regularWarClanTags, prefetchOptions);
	const leaguegroupPrefetch = prefetchLeagueGroupRawByClanTag_(cwlClanTags, prefetchOptions);

	const cwlWarTagSet = {};
	const leaguegroupTags = Object.keys(leaguegroupPrefetch.rawByClanTag);
	for (let i = 0; i < leaguegroupTags.length; i++) {
		const clanTag = leaguegroupTags[i];
		if (Object.prototype.hasOwnProperty.call(leaguegroupPrefetch.errorByClanTag, clanTag)) continue;
		const leaguegroup = leaguegroupPrefetch.rawByClanTag[clanTag];
		const warTags = extractLeagueGroupWarTags_(leaguegroup);
		for (let j = 0; j < warTags.length; j++) {
			const warTag = normalizeTag_(warTags[j]);
			if (!warTag || warTag === "#0") continue;
			cwlWarTagSet[warTag] = true;
		}
	}
	const cwlWarPrefetch = prefetchCwlWarRawByTag_(Object.keys(cwlWarTagSet), prefetchOptions);

	return {
		clanMembersSnapshotByTag: memberPrefetch.snapshotByClanTag,
		clanMembersErrorByTag: memberPrefetch.errorByClanTag,
		currentRegularWarByClanTag: regularWarPrefetch.currentWarByClanTag,
		currentRegularWarErrorByClanTag: regularWarPrefetch.errorByClanTag,
		leaguegroupRawByClanTag: leaguegroupPrefetch.rawByClanTag,
		leaguegroupErrorByClanTag: leaguegroupPrefetch.errorByClanTag,
		cwlWarRawByTag: cwlWarPrefetch.rawByWarTag,
		cwlWarErrorByTag: cwlWarPrefetch.errorByWarTag,
	};
}

function getRefreshPipelineStepFailureMessage_(stepResultRaw, stepLabelRaw) {
	const stepResult = stepResultRaw && typeof stepResultRaw === "object" ? stepResultRaw : {};
	const stepLabel = String(stepLabelRaw == null ? "" : stepLabelRaw).trim() || "pipeline";
	let message = "";

	const stepError = Object.prototype.hasOwnProperty.call(stepResult, "error") ? stepResult.error : null;
	if (stepError && typeof stepError === "object") {
		message = errorMessage_(stepError);
	} else if (stepError != null) {
		message = String(stepError);
	}

	const result = stepResult.result && typeof stepResult.result === "object" ? stepResult.result : {};
	if (!message) {
		message = String(result.warRefreshError == null ? "" : result.warRefreshError).trim();
	}
	if (!message) {
		const resultError = Object.prototype.hasOwnProperty.call(result, "error") ? result.error : null;
		if (resultError && typeof resultError === "object") {
			message = errorMessage_(resultError);
		} else if (resultError != null) {
			message = String(resultError);
		}
	}
	if (!message) {
		message = String(result.message == null ? "" : result.message).trim();
	}
	if (!message) {
		message = stepLabel + " failed.";
	}
	return message;
}

function runRosterRefreshPipelineCore_(rosterDataRaw, rosterIdRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const skipInitialValidation = options.skipInitialValidation === true;
	let rosterData = null;
	if (skipInitialValidation) {
		rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : null;
		if (!rosterData || !Array.isArray(rosterData.rosters)) {
			throw new Error("Refresh pipeline payload is invalid.");
		}
	} else {
		try {
			rosterData = validateRosterData_(rosterDataRaw);
		} catch (err) {
			rethrowWithDuplicateRosterTagDetails_("initialize refresh pipeline payload", err, rosterDataRaw);
		}
	}
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	if (!rosterId) throw new Error("Roster ID is required.");
	const ownershipSnapshot = options.ownershipSnapshot && typeof options.ownershipSnapshot === "object" ? options.ownershipSnapshot : null;
	const touchPipelineLockLease = () => {
		touchActiveRosterLockLease_("refresh pipeline");
	};
	const pipelinePrefetchOptions = {
		prefetchedClanSnapshotsByTag: options.prefetchedClanSnapshotsByTag && typeof options.prefetchedClanSnapshotsByTag === "object" ? options.prefetchedClanSnapshotsByTag : {},
		prefetchedClanErrorsByTag: options.prefetchedClanErrorsByTag && typeof options.prefetchedClanErrorsByTag === "object" ? options.prefetchedClanErrorsByTag : {},
		prefetchedCurrentRegularWarByClanTag:
			options.prefetchedCurrentRegularWarByClanTag && typeof options.prefetchedCurrentRegularWarByClanTag === "object" ? options.prefetchedCurrentRegularWarByClanTag : {},
		prefetchedRegularWarErrorByClanTag:
			options.prefetchedRegularWarErrorByClanTag && typeof options.prefetchedRegularWarErrorByClanTag === "object" ? options.prefetchedRegularWarErrorByClanTag : {},
		prefetchedLeaguegroupRawByClanTag:
			options.prefetchedLeaguegroupRawByClanTag && typeof options.prefetchedLeaguegroupRawByClanTag === "object" ? options.prefetchedLeaguegroupRawByClanTag : {},
		prefetchedLeaguegroupErrorByClanTag:
			options.prefetchedLeaguegroupErrorByClanTag && typeof options.prefetchedLeaguegroupErrorByClanTag === "object" ? options.prefetchedLeaguegroupErrorByClanTag : {},
		prefetchedCwlWarRawByTag: options.prefetchedCwlWarRawByTag && typeof options.prefetchedCwlWarRawByTag === "object" ? options.prefetchedCwlWarRawByTag : {},
		prefetchedCwlWarErrorByTag: options.prefetchedCwlWarErrorByTag && typeof options.prefetchedCwlWarErrorByTag === "object" ? options.prefetchedCwlWarErrorByTag : {},
		metricsRunState: options.metricsRunState && typeof options.metricsRunState === "object" ? options.metricsRunState : null,
	};

	const steps = {
		pool: { ok: false, skipped: false, message: "", result: null },
		lineup: { ok: false, skipped: false, message: "", result: null },
		stats: { ok: false, skipped: false, partialFailure: false, message: "", result: null },
		bench: { ok: false, skipped: false, message: "", result: null },
	};
	const issues = [];
	const getCurrentRoster = () => findRosterInDataById_(rosterData, rosterId);
	const getCurrentTrackingMode = () => {
		const roster = getCurrentRoster();
		return roster ? getRosterTrackingMode_(roster) : "cwl";
	};
	const isCwlPreparationActiveForCurrentRoster = () => {
		const roster = getCurrentRoster();
		return !!(roster && getRosterTrackingMode_(roster) === "cwl" && isCwlPreparationActive_(roster));
	};

	const initialRoster = getCurrentRoster();
	const rosterName = String((initialRoster && initialRoster.title) || "").trim() || rosterId;
	const initialTrackingMode = getCurrentTrackingMode();
	const poolStepLabel = "sync clan roster pool";
	const lineupStepLabel = initialTrackingMode === "regularWar" ? "sync current war lineup" : "sync today lineup";
	const statsStepLabel = initialTrackingMode === "regularWar" ? "refresh tracking stats" : "refresh CWL stats";
	const benchStepLabel = "compute bench suggestions";

	const addIssue = (stepRaw, messageRaw) => {
		const step = String(stepRaw == null ? "" : stepRaw).trim() || "pipeline";
		const message = shortenIssueMessage_(messageRaw, 200);
		if (!message) return;
		issues.push({
			rosterId: rosterId,
			rosterName: rosterName,
			step: step,
			message: message,
		});
	};

	const markSkippedAfterFailedStep = (stepKey, stepLabelRaw, prerequisiteStepLabelRaw) => {
		const stepLabel = String(stepLabelRaw == null ? "" : stepLabelRaw).trim() || "pipeline";
		const prerequisiteStepLabel = String(prerequisiteStepLabelRaw == null ? "" : prerequisiteStepLabelRaw).trim();
		const skipMessage = "skipped because previous step failed" + (prerequisiteStepLabel ? ": " + prerequisiteStepLabel : "") + ".";
		const step = steps[stepKey];
		step.ok = false;
		step.skipped = true;
		step.message = skipMessage;
		if (stepKey === "stats") step.partialFailure = false;
		addIssue(stepLabel, skipMessage);
	};

	const markIntentionalSkip = (stepKey, messageRaw) => {
		const step = steps[stepKey];
		step.ok = true;
		step.skipped = true;
		step.message = String(messageRaw == null ? "" : messageRaw).trim();
		if (stepKey === "stats") step.partialFailure = false;
	};

	const runStepWithRollback = (stepKey, stepLabelRaw, stepFn) => {
		const step = steps[stepKey];
		const stepLabel = String(stepLabelRaw == null ? "" : stepLabelRaw).trim() || "pipeline";
		const beforeStep = cloneRosterDataForRefresh_(rosterData);
		try {
			touchPipelineLockLease();
			const stepResult = stepFn();
			const stepReportedFailure = !!(stepResult && typeof stepResult === "object" && stepResult.ok === false);
			if (stepReportedFailure) {
				let failureRosterData = null;
				let failureRosterValidationErr = null;
				if (stepResult && typeof stepResult === "object" && stepResult.rosterData) {
					try {
						failureRosterData = validateRosterData_(stepResult.rosterData);
					} catch (validationErr) {
						failureRosterValidationErr = validationErr;
					}
				}
				rosterData = failureRosterData || beforeStep;
				const failureMessage = failureRosterValidationErr
					? stepLabel + " failed and returned invalid rosterData: " + errorMessage_(failureRosterValidationErr)
					: getRefreshPipelineStepFailureMessage_(stepResult, stepLabel);
				const detailedMessage = appendDuplicateRosterTagDetailsToError_(stepLabel, new Error(failureMessage), rosterData);
				step.ok = false;
				step.skipped = false;
				step.message = detailedMessage;
				step.result = stepResult && stepResult.result && typeof stepResult.result === "object" ? stepResult.result : null;
				if (stepKey === "stats") {
					const statsResult = step.result && typeof step.result === "object" ? step.result : {};
					step.partialFailure = !!(statsResult.partialFailure || (statsResult.memberTrackingPreserved && statsResult.warRefreshFailed));
				}
				addIssue(stepLabel, detailedMessage);
				return false;
			}

			if (stepResult && stepResult.rosterData) {
				rosterData = validateRosterData_(stepResult.rosterData);
			}
			touchPipelineLockLease();
			step.ok = true;
			step.skipped = false;
			step.result = stepResult && stepResult.result && typeof stepResult.result === "object" ? stepResult.result : null;
			step.message = String(step.result && step.result.message != null ? step.result.message : "").trim();
			if (stepKey === "stats") step.partialFailure = false;
			return true;
		} catch (err) {
			const detailedMessage = appendDuplicateRosterTagDetailsToError_(stepLabel, err, rosterData);
			rosterData = beforeStep;
			step.ok = false;
			step.skipped = false;
			step.message = detailedMessage;
			if (stepKey === "stats") step.partialFailure = false;
			addIssue(stepLabel, detailedMessage);
			return false;
		}
	};

	if (!initialRoster) {
		const notFoundMessage = "Roster not found in current refresh payload.";
		steps.pool.message = notFoundMessage;
		addIssue("pipeline", notFoundMessage);
		markSkippedAfterFailedStep("lineup", lineupStepLabel, poolStepLabel);
		markSkippedAfterFailedStep("stats", statsStepLabel, poolStepLabel);
		markSkippedAfterFailedStep("bench", benchStepLabel, poolStepLabel);
	} else {
		const hasConnectedClanTag = !!normalizeTag_(initialRoster.connectedClanTag);
		if (!hasConnectedClanTag) {
			const missingTagMessage = "Connected clan tag is missing.";
			steps.pool.ok = false;
			steps.pool.skipped = false;
			steps.pool.message = missingTagMessage;
			addIssue(poolStepLabel, missingTagMessage);
		} else {
			runStepWithRollback("pool", poolStepLabel, () => syncClanRosterPoolCore_(rosterData, rosterId, { ownershipSnapshot: ownershipSnapshot }));
		}

		const poolStepOk = !!steps.pool.ok;
		const trackingModeForPipeline = getCurrentTrackingMode();
		if (trackingModeForPipeline === "cwl" && isCwlPreparationActiveForCurrentRoster()) {
			markIntentionalSkip("lineup", "live CWL lineup sync blocked by CWL Preparation Mode");
		} else if (!hasConnectedClanTag || !poolStepOk) {
			markSkippedAfterFailedStep("lineup", lineupStepLabel, poolStepLabel);
		} else {
			runStepWithRollback("lineup", lineupStepLabel, () => syncClanTodayLineupCore_(rosterData, rosterId, pipelinePrefetchOptions));
		}

		const lineupStepOk = !!steps.lineup.ok;
		const allowStatsWithoutLineup = trackingModeForPipeline === "regularWar";
		if (!hasConnectedClanTag || !poolStepOk || (!lineupStepOk && !allowStatsWithoutLineup)) {
			markSkippedAfterFailedStep("stats", statsStepLabel, !poolStepOk || !hasConnectedClanTag ? poolStepLabel : lineupStepLabel);
		} else {
			if (!lineupStepOk && allowStatsWithoutLineup) {
				Logger.log(
					"refreshRosterPipeline: roster '%s' running regular-war stats/repair despite lineup sync issue so history repair can proceed.",
					rosterId,
				);
			}
			runStepWithRollback("stats", statsStepLabel, () => refreshTrackingStatsCore_(rosterData, rosterId, pipelinePrefetchOptions));
		}

		const statsStepOk = !!steps.stats.ok;
		const statsResult = steps.stats.result && typeof steps.stats.result === "object" ? steps.stats.result : {};
		const skipBenchForNoActiveCwl = trackingModeForPipeline === "cwl" && statsStepOk && !!statsResult.cwlUnavailable && !!statsResult.statsUnchanged;
		if (trackingModeForPipeline !== "cwl") {
			markIntentionalSkip("bench", "bench suggestions are disabled for regular war rosters");
		} else if (isCwlPreparationActiveForCurrentRoster()) {
			markIntentionalSkip("bench", "bench suggestions disabled during CWL Preparation Mode");
		} else if (!hasConnectedClanTag || !poolStepOk || !lineupStepOk || !statsStepOk) {
			const failedStepLabel = !poolStepOk || !hasConnectedClanTag ? poolStepLabel : !lineupStepOk ? lineupStepLabel : statsStepLabel;
			markSkippedAfterFailedStep("bench", benchStepLabel, failedStepLabel);
		} else if (skipBenchForNoActiveCwl) {
			markIntentionalSkip("bench", "compute bench suggestions skipped: no active CWL available");
		} else {
			runStepWithRollback("bench", benchStepLabel, () => computeBenchSuggestionsCore_(rosterData, rosterId));
		}
	}

	let validatedRosterData = null;
	try {
		touchPipelineLockLease();
		validatedRosterData = validateRosterData_(rosterData);
	} catch (err) {
		throw new Error(appendDuplicateRosterTagDetailsToError_("finalize refresh pipeline payload", err, rosterData));
	}
	const finalRoster = findRosterInDataById_(validatedRosterData, rosterId);
	const finalTrackingMode = finalRoster ? getRosterTrackingMode_(finalRoster) : initialTrackingMode;
	const partialFailure = !!steps.stats.partialFailure;
	return {
		ok: issues.length < 1,
		rosterData: validatedRosterData,
		result: {
			rosterId: rosterId,
			rosterName: rosterName,
			trackingMode: finalTrackingMode,
			partialFailure: partialFailure,
			issues: issues,
			steps: steps,
		},
	};
}

function buildRefreshAllRunSummary_(processedRostersRaw, rostersWithIssuesRaw, issueCountRaw) {
	const processed = Math.max(0, toNonNegativeInt_(processedRostersRaw));
	const withIssues = Math.max(0, toNonNegativeInt_(rostersWithIssuesRaw));
	const issueCount = Math.max(0, toNonNegativeInt_(issueCountRaw));
	return "Processed " + processed + " roster(s), issues " + issueCount + " across " + withIssues + " roster(s).";
}

function buildRefreshAllPipelinePrefetchOptions_(prefetchBundleRaw) {
	const prefetch = prefetchBundleRaw && typeof prefetchBundleRaw === "object" ? prefetchBundleRaw : {};
	return {
		prefetchedClanSnapshotsByTag:
			prefetch.clanMembersSnapshotByTag && typeof prefetch.clanMembersSnapshotByTag === "object" ? prefetch.clanMembersSnapshotByTag : {},
		prefetchedClanErrorsByTag: prefetch.clanMembersErrorByTag && typeof prefetch.clanMembersErrorByTag === "object" ? prefetch.clanMembersErrorByTag : {},
		prefetchedCurrentRegularWarByClanTag:
			prefetch.currentRegularWarByClanTag && typeof prefetch.currentRegularWarByClanTag === "object" ? prefetch.currentRegularWarByClanTag : {},
		prefetchedRegularWarErrorByClanTag:
			prefetch.currentRegularWarErrorByClanTag && typeof prefetch.currentRegularWarErrorByClanTag === "object" ? prefetch.currentRegularWarErrorByClanTag : {},
		prefetchedLeaguegroupRawByClanTag: prefetch.leaguegroupRawByClanTag && typeof prefetch.leaguegroupRawByClanTag === "object" ? prefetch.leaguegroupRawByClanTag : {},
		prefetchedLeaguegroupErrorByClanTag:
			prefetch.leaguegroupErrorByClanTag && typeof prefetch.leaguegroupErrorByClanTag === "object" ? prefetch.leaguegroupErrorByClanTag : {},
		prefetchedCwlWarRawByTag: prefetch.cwlWarRawByTag && typeof prefetch.cwlWarRawByTag === "object" ? prefetch.cwlWarRawByTag : {},
		prefetchedCwlWarErrorByTag: prefetch.cwlWarErrorByTag && typeof prefetch.cwlWarErrorByTag === "object" ? prefetch.cwlWarErrorByTag : {},
	};
}

function buildRefreshAllOwnershipSnapshot_(rosterData, prefetchBundleRaw, optionsRaw) {
	const prefetch = prefetchBundleRaw && typeof prefetchBundleRaw === "object" ? prefetchBundleRaw : {};
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const metricsRunState = options.metricsRunState && typeof options.metricsRunState === "object" ? options.metricsRunState : null;
	return buildLiveRosterOwnershipSnapshot_(rosterData, {
		recordMetrics: false,
		metricsRunState: metricsRunState,
		prefetchedClanSnapshotsByTag: prefetch.clanMembersSnapshotByTag && typeof prefetch.clanMembersSnapshotByTag === "object" ? prefetch.clanMembersSnapshotByTag : {},
		prefetchedClanErrorsByTag: prefetch.clanMembersErrorByTag && typeof prefetch.clanMembersErrorByTag === "object" ? prefetch.clanMembersErrorByTag : {},
	});
}

function buildRefreshAllRosterResultMessage_(pipelineResultRaw, rosterIssuesRaw) {
	const pipelineResult = pipelineResultRaw && typeof pipelineResultRaw === "object" ? pipelineResultRaw : {};
	const rosterIssues = Array.isArray(rosterIssuesRaw) ? rosterIssuesRaw : [];
	if (rosterIssues.length > 0) {
		return shortenIssueMessage_(rosterIssues[0] && rosterIssues[0].message, 180) || "Refresh pipeline completed with issues.";
	}
	if (pipelineResult.partialFailure === true) {
		return "Refresh pipeline completed with partial failure.";
	}
	const trackingMode = String(pipelineResult.trackingMode == null ? "" : pipelineResult.trackingMode).trim().toLowerCase();
	if (trackingMode === "regularwar") return "Refresh pipeline complete (regular war).";
	if (trackingMode === "cwl") return "Refresh pipeline complete (CWL).";
	return "Refresh pipeline complete.";
}

function runRefreshAllRostersUnlockedCore_(rosterDataRaw, optionsRaw) {
	let rosterData = null;
	try {
		rosterData = validateRosterData_(rosterDataRaw);
	} catch (err) {
		rethrowWithDuplicateRosterTagDetails_("initialize refresh payload", err, rosterDataRaw);
	}
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const metricsRunState = options.metricsRunState && typeof options.metricsRunState === "object" ? options.metricsRunState : {};
	if (!metricsRunState.seenClanTags || typeof metricsRunState.seenClanTags !== "object") metricsRunState.seenClanTags = {};
	if (!metricsRunState.profileSnapshotByTag || typeof metricsRunState.profileSnapshotByTag !== "object") metricsRunState.profileSnapshotByTag = {};
	if (!metricsRunState.profileSnapshotErrorByTag || typeof metricsRunState.profileSnapshotErrorByTag !== "object") metricsRunState.profileSnapshotErrorByTag = {};
	if (typeof metricsRunState.profileFetchBlocked !== "boolean") metricsRunState.profileFetchBlocked = false;
	const sourceRosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	const rosterIds = [];
	for (let i = 0; i < sourceRosters.length; i++) {
		const rosterId = String((sourceRosters[i] && sourceRosters[i].id) || "").trim();
		if (!rosterId) continue;
		rosterIds.push(rosterId);
	}

	const issues = [];
	const perRoster = [];
	let processedRosters = 0;
	let rostersWithIssues = 0;
	touchActiveRosterLockLease_("refresh all prefetch");
	const refreshAllPrefetch = buildRefreshAllPrefetchBundle_(sourceRosters);
	const pipelinePrefetchOptions = buildRefreshAllPipelinePrefetchOptions_(refreshAllPrefetch);
	const ownershipSnapshot = buildRefreshAllOwnershipSnapshot_(rosterData, refreshAllPrefetch, {
		metricsRunState: metricsRunState,
	});

	for (let i = 0; i < rosterIds.length; i++) {
		touchActiveRosterLockLease_("refresh all roster " + (i + 1) + "/" + rosterIds.length);
		const rosterId = rosterIds[i];
		processedRosters++;
		const currentRoster = findRosterInDataById_(rosterData, rosterId);
		const rosterTitle = String((currentRoster && currentRoster.title) || "").trim();
		const rosterName = rosterTitle || rosterId;
		const rosterIssues = [];
		let pipelineResult = {};
		let partialFailure = false;
		let trackingMode = getRosterTrackingMode_(currentRoster);
		try {
			const pipelineRun = runRosterRefreshPipelineCore_(
				rosterData,
				rosterId,
				Object.assign(
					{
						ownershipSnapshot: ownershipSnapshot,
						skipInitialValidation: true,
						metricsRunState: metricsRunState,
					},
					pipelinePrefetchOptions,
				),
			);
			if (pipelineRun && pipelineRun.rosterData) {
				rosterData = pipelineRun.rosterData;
			}
			pipelineResult = pipelineRun && pipelineRun.result && typeof pipelineRun.result === "object" ? pipelineRun.result : {};
			partialFailure = pipelineResult.partialFailure === true;
			trackingMode = String(pipelineResult.trackingMode == null ? trackingMode : pipelineResult.trackingMode).trim() || trackingMode;
			const pipelineIssues = Array.isArray(pipelineResult.issues) ? pipelineResult.issues : [];
			for (let j = 0; j < pipelineIssues.length; j++) {
				const issueRaw = pipelineIssues[j] && typeof pipelineIssues[j] === "object" ? pipelineIssues[j] : {};
				const step = String(issueRaw.step == null ? "" : issueRaw.step).trim() || "pipeline";
				const message = shortenIssueMessage_(issueRaw.message, 200);
				if (!message) continue;
				const issue = {
					rosterId: rosterId,
					rosterName: rosterName,
					step: step,
					message: message,
				};
				rosterIssues.push(issue);
				issues.push(issue);
			}
			if (pipelineIssues.length < 1 && pipelineRun && pipelineRun.ok === false) {
				const fallbackMessage = "refresh pipeline failed.";
				const issue = {
					rosterId: rosterId,
					rosterName: rosterName,
					step: "pipeline",
					message: fallbackMessage,
				};
				rosterIssues.push(issue);
				issues.push(issue);
			}
			if (partialFailure && rosterIssues.length < 1) {
				const issue = {
					rosterId: rosterId,
					rosterName: rosterName,
					step: "refresh tracking stats",
					message: "refresh pipeline completed with partial failure.",
				};
				rosterIssues.push(issue);
				issues.push(issue);
			}
		} catch (err) {
			const detailedMessage = appendDuplicateRosterTagDetailsToError_("refresh roster pipeline", err, rosterData);
			const issue = {
				rosterId: rosterId,
				rosterName: rosterName,
				step: "pipeline",
				message: shortenIssueMessage_(detailedMessage, 200),
			};
			rosterIssues.push(issue);
			issues.push(issue);
		}
		const rosterHasIssues = rosterIssues.length > 0 || partialFailure;
		if (rosterHasIssues) rostersWithIssues++;
		const rosterMessage = buildRefreshAllRosterResultMessage_(pipelineResult, rosterIssues);
		perRoster.push({
			rosterId: rosterId,
			rosterName: rosterName,
			trackingMode: trackingMode,
			ok: !rosterHasIssues,
			partialFailure: partialFailure,
			issueCount: rosterIssues.length,
			message: rosterMessage,
			issues: rosterIssues,
		});
	}

	let validatedRosterData = null;
	try {
		validatedRosterData = validateRosterData_(rosterData);
	} catch (err) {
		throw new Error(appendDuplicateRosterTagDetailsToError_("finalize refresh payload", err, rosterData));
	}

	return {
		ok: issues.length < 1,
		rosterData: validatedRosterData,
		processedRosters: processedRosters,
		rostersWithIssues: rostersWithIssues,
		issueCount: issues.length,
		issues: issues,
		issueSummary: buildAutoRefreshIssueSummary_(issues),
		summary: buildRefreshAllRunSummary_(processedRosters, rostersWithIssues, issues.length),
		perRoster: perRoster,
	};
}

function runRefreshAllRostersCore_(rosterDataOrLoaderRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const lockOwner = String(options.lockOwner == null ? "refresh-all" : options.lockOwner).trim() || "refresh-all";
	const lockWaitRaw = Number(options.lockWaitMs);
	const lockWaitMs = Math.max(0, isFinite(lockWaitRaw) ? lockWaitRaw : ACTIVE_ROSTER_JOB_LOCK_WAIT_MS);
	const beforeRun = typeof options.beforeRun === "function" ? options.beforeRun : null;
	const onAfterRun = typeof options.onAfterRun === "function" ? options.onAfterRun : null;
	const rosterDataLoader = typeof rosterDataOrLoaderRaw === "function" ? rosterDataOrLoaderRaw : null;
	return withActiveRosterJobLock_(lockOwner, lockWaitMs, function () {
		touchActiveRosterLockLease_("refresh all start");
		if (beforeRun) {
			const beforeResult = beforeRun();
			if (beforeResult && typeof beforeResult === "object" && beforeResult.skip === true) {
				return {
					skipped: true,
					reason: String(beforeResult.reason == null ? "skipped" : beforeResult.reason).trim() || "skipped",
					lastWriteAt: String(beforeResult.lastWriteAt == null ? "" : beforeResult.lastWriteAt).trim(),
				};
			}
		}
		const sourceRosterData = rosterDataLoader ? rosterDataLoader() : rosterDataOrLoaderRaw;
		const runResult = runRefreshAllRostersUnlockedCore_(sourceRosterData, options);
		if (onAfterRun) {
			onAfterRun(runResult);
		}
		touchActiveRosterLockLease_("refresh all complete");
		return runResult;
	});
}
