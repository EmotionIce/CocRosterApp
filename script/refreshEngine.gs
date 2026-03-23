// Refresh-all/pipeline orchestration and related diagnostics.

// Build a stable, validated payload fingerprint for refresh change detection.
function normalizeActiveRosterForCompare_(rosterDataRaw) {
	const validated = validateRosterData_(rosterDataRaw);
	// Only compare fields that represent the active roster payload itself.
	return JSON.stringify({
		schemaVersion: validated.schemaVersion,
		pageTitle: validated.pageTitle,
		rosterOrder: validated.rosterOrder,
		rosters: validated.rosters,
		playerMetrics: validated.playerMetrics,
		publicConfig: validated.publicConfig || null,
	});
}

// Compare normalized payloads so transient fields do not trigger false positives.
function hasActiveRosterPayloadChanged_(beforeRaw, afterRaw) {
	return normalizeActiveRosterForCompare_(beforeRaw) !== normalizeActiveRosterForCompare_(afterRaw);
}

// Stamp `lastUpdatedAt` while preserving the validated roster payload shape.
function withRosterLastUpdatedAt_(rosterDataRaw, timestampRaw) {
	const timestamp = String(timestampRaw == null ? "" : timestampRaw).trim() || new Date().toISOString();
	const validated = validateRosterData_(rosterDataRaw);
	// Rebuild the payload explicitly so validation strips anything unsupported.
	const out = {
		schemaVersion: validated.schemaVersion,
		pageTitle: validated.pageTitle,
		rosterOrder: validated.rosterOrder,
		rosters: validated.rosters,
		playerMetrics: validated.playerMetrics,
		lastUpdatedAt: timestamp,
	};
	if (validated.publicConfig && typeof validated.publicConfig === "object") {
		// Preserve optional public config when it is part of the validated shape.
		out.publicConfig = validated.publicConfig;
	}
	return validateRosterData_(out);
}

// Normalize issue text into a single line and keep it within a safe UI length.
function shortenIssueMessage_(messageRaw, maxLenRaw) {
	const text = String(messageRaw == null ? "" : messageRaw)
		.replace(/\s+/g, " ")
		.trim();
	if (!text) return "";
	const maxLen = Math.max(40, toNonNegativeInt_(maxLenRaw) || 160);
	if (text.length <= maxLen) return text;
	return text.slice(0, Math.max(0, maxLen - 3)).trim() + "...";
}

// Build a compact one-line summary from the first issue for status surfaces.
function buildAutoRefreshIssueSummary_(issuesRaw) {
	const issues = Array.isArray(issuesRaw) ? issuesRaw : [];
	if (!issues.length) return "";
	// The first issue is the highest-signal summary candidate for compact surfaces.
	const first = issues[0] && typeof issues[0] === "object" ? issues[0] : {};
	const rosterName = String(first.rosterName == null ? "" : first.rosterName).trim() || "Unknown roster";
	const step = String(first.step == null ? "" : first.step).trim() || "pipeline";
	const message = shortenIssueMessage_(first.message, 180) || "Unknown issue.";
	return rosterName + " | " + step + " | " + message;
}

// Find a roster by id without throwing when data is partial.
function findRosterInDataById_(rosterData, rosterIdRaw) {
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	if (!rosterId) return null;
	const rosters = rosterData && Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	// Keep the lookup simple and order-preserving because roster lists are already small.
	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		if (String(roster.id || "").trim() === rosterId) return roster;
	}
	return null;
}

// Deep-clone roster payload so a failed step can roll back safely.
function cloneRosterDataForRefresh_(rosterDataRaw) {
	try {
		return JSON.parse(JSON.stringify(rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {}));
	} catch (err) {
		throw new Error("Unable to clone roster data for refresh rollback: " + errorMessage_(err));
	}
}

// Collect player tags that appear more than once across all roster sections.
function findDuplicateRosterTags_(rosterDataRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const rosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	const byTag = {};
	// These are the sections that can legally contain live roster players.
	const sections = ["main", "subs", "missing"];

	// Record every normalized tag occurrence so we can later keep only collisions.
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
	// Filter down to tags that appear in more than one location.
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

// Format duplicate-tag diagnostics with bounded tag/location counts.
function formatDuplicateRosterTagsForMessage_(duplicatesRaw, maxTagsRaw, maxLocationsRaw) {
	const duplicates = Array.isArray(duplicatesRaw) ? duplicatesRaw : [];
	if (!duplicates.length) return "";
	const maxTags = Math.max(1, toNonNegativeInt_(maxTagsRaw) || 3);
	const maxLocations = Math.max(1, toNonNegativeInt_(maxLocationsRaw) || 4);
	const tagParts = [];
	// Bound the diagnostic string so it stays readable in logs and UI surfaces.
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

// Expand duplicate-tag validation errors with concrete roster/section locations.
function appendDuplicateRosterTagDetailsToError_(stepLabelRaw, err, rosterDataRaw) {
	const baseMessage = errorMessage_(err);
	// Only decorate the specific validation failure this helper knows how to explain.
	if (!/duplicate player tag in output/i.test(baseMessage)) return baseMessage;
	const duplicates = findDuplicateRosterTags_(rosterDataRaw);
	if (!duplicates.length) return baseMessage;
	const stepLabel = String(stepLabelRaw == null ? "" : stepLabelRaw).trim() || "refresh";
	Logger.log("duplicate-tag diagnostics (%s): %s", stepLabel, JSON.stringify(duplicates));
	const detail = formatDuplicateRosterTagsForMessage_(duplicates, 2, 3);
	return detail ? detail + " | " + baseMessage : baseMessage;
}

// Re-throw with enriched duplicate-tag context when available.
function rethrowWithDuplicateRosterTagDetails_(stepLabelRaw, err, rosterDataRaw) {
	const detailedMessage = appendDuplicateRosterTagDetailsToError_(stepLabelRaw, err, rosterDataRaw);
	if (detailedMessage === errorMessage_(err)) throw err;
	throw new Error(detailedMessage);
}

// First-wave prefetch for all clans: members + mode-specific war entry points.
function buildRefreshAllMixedWaveOnePrefetch_(connectedClanTagsRaw, regularWarClanTagsRaw, cwlClanTagsRaw, optionsRaw) {
	const connectedClanTags = Array.isArray(connectedClanTagsRaw) ? connectedClanTagsRaw : [];
	const regularWarClanTags = Array.isArray(regularWarClanTagsRaw) ? regularWarClanTagsRaw : [];
	const cwlClanTags = Array.isArray(cwlClanTagsRaw) ? cwlClanTagsRaw : [];
	const entries = [];
	const membersKeyByClanTag = {};
	const regularWarKeyByClanTag = {};
	const leagueGroupKeyByClanTag = {};

	// Build batched path entries keyed by endpoint type and clan tag.
	for (let i = 0; i < connectedClanTags.length; i++) {
		const clanTag = normalizeTag_(connectedClanTags[i]);
		if (!clanTag) continue;
		const key = "members:" + clanTag;
		membersKeyByClanTag[clanTag] = key;
		entries.push({
			key: key,
			path: "/clans/" + encodeTagForPath_(clanTag) + "/members",
		});
	}
	for (let i = 0; i < regularWarClanTags.length; i++) {
		const clanTag = normalizeTag_(regularWarClanTags[i]);
		if (!clanTag) continue;
		const key = "regularWar:" + clanTag;
		regularWarKeyByClanTag[clanTag] = key;
		entries.push({
			key: key,
			path: "/clans/" + encodeTagForPath_(clanTag) + "/currentwar",
		});
	}
	for (let i = 0; i < cwlClanTags.length; i++) {
		const clanTag = normalizeTag_(cwlClanTags[i]);
		if (!clanTag) continue;
		const key = "leagueGroup:" + clanTag;
		leagueGroupKeyByClanTag[clanTag] = key;
		entries.push({
			key: key,
			path: "/clans/" + encodeTagForPath_(clanTag) + "/currentwar/leaguegroup",
		});
	}

	const fetched = cocFetchAllByPathEntries_(entries, optionsRaw);
	const clanMembersSnapshotByTag = {};
	const clanMembersErrorByTag = {};
	const currentRegularWarByClanTag = {};
	const currentRegularWarErrorByClanTag = {};
	const leaguegroupRawByClanTag = {};
	const leaguegroupErrorByClanTag = {};
	// Use one capture timestamp so all member snapshots from this batch line up.
	const capturedAt = new Date().toISOString();

	// Project member fetches into snapshot/error maps keyed by clan tag.
	for (let i = 0; i < connectedClanTags.length; i++) {
		const clanTag = normalizeTag_(connectedClanTags[i]);
		if (!clanTag) continue;
		const key = membersKeyByClanTag[clanTag];
		if (!key) continue;
		if (Object.prototype.hasOwnProperty.call(fetched.dataByKey, key)) {
			const data = fetched.dataByKey[key];
			const items = Array.isArray(data && data.items) ? data.items : [];
			clanMembersSnapshotByTag[clanTag] = {
				clanTag: clanTag,
				capturedAt: capturedAt,
				members: mapApiMembers_(items),
				metricsMembers: mapApiMembersForMetricsSnapshot_(items),
			};
			continue;
		}
		if (Object.prototype.hasOwnProperty.call(fetched.errorByKey, key)) {
			clanMembersErrorByTag[clanTag] = fetched.errorByKey[key];
		}
	}

	// Regular-war fetches treat 404/private-war-log as handled unavailable states.
	for (let i = 0; i < regularWarClanTags.length; i++) {
		const clanTag = normalizeTag_(regularWarClanTags[i]);
		if (!clanTag) continue;
		const key = regularWarKeyByClanTag[clanTag];
		if (!key) continue;
		if (Object.prototype.hasOwnProperty.call(fetched.dataByKey, key)) {
			currentRegularWarByClanTag[clanTag] = mapCurrentRegularWarFromApiData_(clanTag, fetched.dataByKey[key]);
			continue;
		}
		if (!Object.prototype.hasOwnProperty.call(fetched.errorByKey, key)) continue;
		const err = fetched.errorByKey[key];
		if (err && Number(err.statusCode) === 404) {
			currentRegularWarByClanTag[clanTag] = buildNoCurrentRegularWarResult_(clanTag);
			continue;
		}
		if (isPrivateWarLogError_(err)) {
			currentRegularWarByClanTag[clanTag] = buildPrivateRegularWarResult_(clanTag);
			continue;
		}
		currentRegularWarErrorByClanTag[clanTag] = err;
	}

	// Keep raw league-group payloads for a second CWL-war prefetch wave.
	for (let i = 0; i < cwlClanTags.length; i++) {
		const clanTag = normalizeTag_(cwlClanTags[i]);
		if (!clanTag) continue;
		const key = leagueGroupKeyByClanTag[clanTag];
		if (!key) continue;
		if (Object.prototype.hasOwnProperty.call(fetched.dataByKey, key)) {
			leaguegroupRawByClanTag[clanTag] = fetched.dataByKey[key];
			continue;
		}
		if (Object.prototype.hasOwnProperty.call(fetched.errorByKey, key)) {
			leaguegroupErrorByClanTag[clanTag] = fetched.errorByKey[key];
		}
	}

	return {
		clanMembersSnapshotByTag: clanMembersSnapshotByTag,
		clanMembersErrorByTag: clanMembersErrorByTag,
		currentRegularWarByClanTag: currentRegularWarByClanTag,
		currentRegularWarErrorByClanTag: currentRegularWarErrorByClanTag,
		leaguegroupRawByClanTag: leaguegroupRawByClanTag,
		leaguegroupErrorByClanTag: leaguegroupErrorByClanTag,
	};
}

// Build all prefetch maps needed to run every roster pipeline without refetching per roster.
function buildRefreshAllPrefetchBundle_(sourceRostersRaw) {
	const sourceRosters = Array.isArray(sourceRostersRaw) ? sourceRostersRaw : [];
	const connectedClanTagSet = {};
	const regularWarClanTagSet = {};
	const cwlClanTagSet = {};

	// Deduplicate clan tags and split by tracking mode so only relevant endpoints are fetched.
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
	// Wave one covers member and war-index endpoints keyed only by clan tag.
	const connectedClanTags = Object.keys(connectedClanTagSet);
	const regularWarClanTags = Object.keys(regularWarClanTagSet);
	const cwlClanTags = Object.keys(cwlClanTagSet);
	const waveOnePrefetch = buildRefreshAllMixedWaveOnePrefetch_(connectedClanTags, regularWarClanTags, cwlClanTags, prefetchOptions);

	// Second wave: resolve war tags from league groups and prefetch raw CWL wars once.
	const cwlWarTagSet = {};
	const leaguegroupTags = Object.keys(waveOnePrefetch.leaguegroupRawByClanTag);
	for (let i = 0; i < leaguegroupTags.length; i++) {
		const clanTag = leaguegroupTags[i];
		if (Object.prototype.hasOwnProperty.call(waveOnePrefetch.leaguegroupErrorByClanTag, clanTag)) continue;
		const leaguegroup = waveOnePrefetch.leaguegroupRawByClanTag[clanTag];
		// League groups are only an index; actual lineup data still lives on war endpoints.
		const warTags = extractLeagueGroupWarTags_(leaguegroup);
		for (let j = 0; j < warTags.length; j++) {
			const warTag = normalizeTag_(warTags[j]);
			if (!warTag || warTag === "#0") continue;
			cwlWarTagSet[warTag] = true;
		}
	}
	const cwlWarPrefetch = prefetchCwlWarRawByTag_(Object.keys(cwlWarTagSet), prefetchOptions);

	return {
		clanMembersSnapshotByTag: waveOnePrefetch.clanMembersSnapshotByTag,
		clanMembersErrorByTag: waveOnePrefetch.clanMembersErrorByTag,
		currentRegularWarByClanTag: waveOnePrefetch.currentRegularWarByClanTag,
		currentRegularWarErrorByClanTag: waveOnePrefetch.currentRegularWarErrorByClanTag,
		leaguegroupRawByClanTag: waveOnePrefetch.leaguegroupRawByClanTag,
		leaguegroupErrorByClanTag: waveOnePrefetch.leaguegroupErrorByClanTag,
		cwlWarRawByTag: cwlWarPrefetch.rawByWarTag,
		cwlWarErrorByTag: cwlWarPrefetch.errorByWarTag,
	};
}

// Collect refresh-all player tags to warm authoritative profile snapshots once per run.
function collectRefreshAllPlayerProfileCandidateTags_(sourceRostersRaw, prefetchBundleRaw) {
	const sourceRosters = Array.isArray(sourceRostersRaw) ? sourceRostersRaw : [];
	const prefetch = prefetchBundleRaw && typeof prefetchBundleRaw === "object" ? prefetchBundleRaw : {};
	const clanMembersSnapshotByTag =
		prefetch.clanMembersSnapshotByTag && typeof prefetch.clanMembersSnapshotByTag === "object" ? prefetch.clanMembersSnapshotByTag : {};
	const tagSet = {};

	// Include all roster pool tags (main/subs/missing) across every roster.
	for (let i = 0; i < sourceRosters.length; i++) {
		const roster = sourceRosters[i] && typeof sourceRosters[i] === "object" ? sourceRosters[i] : {};
		const players = collectRosterPoolPlayers_(roster);
		for (let j = 0; j < players.length; j++) {
			const tag = normalizeTag_(players[j] && players[j].tag);
			if (!tag || !isValidPlayerTag_(tag)) continue;
			tagSet[tag] = true;
		}
	}

	// Add tags from wave-one connected-clan member snapshots.
	const clanTags = Object.keys(clanMembersSnapshotByTag);
	for (let i = 0; i < clanTags.length; i++) {
		const clanTag = clanTags[i];
		const snapshot = clanMembersSnapshotByTag[clanTag] && typeof clanMembersSnapshotByTag[clanTag] === "object" ? clanMembersSnapshotByTag[clanTag] : {};
		const metricsMembers = Array.isArray(snapshot.metricsMembers) ? snapshot.metricsMembers : snapshot.members;
		const members = Array.isArray(metricsMembers) ? metricsMembers : [];
		for (let j = 0; j < members.length; j++) {
			const tag = normalizeTag_(members[j] && members[j].tag);
			if (!tag || !isValidPlayerTag_(tag)) continue;
			tagSet[tag] = true;
		}
	}

	return Object.keys(tagSet).sort();
}

// Extract the most useful failure text from heterogeneous step result/error shapes.
function getRefreshPipelineStepFailureMessage_(stepResultRaw, stepLabelRaw) {
	const stepResult = stepResultRaw && typeof stepResultRaw === "object" ? stepResultRaw : {};
	const stepLabel = String(stepLabelRaw == null ? "" : stepLabelRaw).trim() || "pipeline";
	let message = "";

	// Prefer explicit step-level errors over nested result payload fallbacks.
	const stepError = Object.prototype.hasOwnProperty.call(stepResult, "error") ? stepResult.error : null;
	if (stepError && typeof stepError === "object") {
		message = errorMessage_(stepError);
	} else if (stepError != null) {
		message = String(stepError);
	}

	const result = stepResult.result && typeof stepResult.result === "object" ? stepResult.result : {};
	if (!message) {
		// Stats partial-failure payloads often surface the real cause here.
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

// Run a single-roster refresh pipeline with per-step rollback and issue tracking.
function runRosterRefreshPipelineCore_(rosterDataRaw, rosterIdRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const skipInitialValidation = options.skipInitialValidation === true;
	let rosterData = null;
	if (skipInitialValidation) {
		// Refresh-all reuses already-validated rosterData between per-roster pipeline runs.
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
	// Handle touch pipeline lock lease.
	const touchPipelineLockLease = () => {
		touchActiveRosterLockLease_("refresh pipeline");
	};
	// Normalize optional prefetch maps once so downstream calls can rely on objects.
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

	// Step status payload returned to callers and surfaced in refresh-all diagnostics.
	const steps = {
		pool: { ok: false, skipped: false, message: "", result: null },
		lineup: { ok: false, skipped: false, message: "", result: null },
		stats: { ok: false, skipped: false, partialFailure: false, message: "", result: null },
		bench: { ok: false, skipped: false, message: "", result: null },
	};
	const issues = [];
	// Get current roster.
	const getCurrentRoster = () => findRosterInDataById_(rosterData, rosterId);
	// Get current tracking mode.
	const getCurrentTrackingMode = () => {
		const roster = getCurrentRoster();
		return roster ? getRosterTrackingMode_(roster) : "cwl";
	};
	// Return whether CWL preparation active for current roster.
	const isCwlPreparationActiveForCurrentRoster = () => {
		const roster = getCurrentRoster();
		return !!(roster && getRosterTrackingMode_(roster) === "cwl" && isCwlPreparationActive_(roster));
	};

	const initialRoster = getCurrentRoster();
	const rosterName = String((initialRoster && initialRoster.title) || "").trim() || rosterId;
	const initialTrackingMode = getCurrentTrackingMode();
	// Step labels are intentionally user-facing because they flow into issue summaries.
	const poolStepLabel = "sync clan roster pool";
	const lineupStepLabel = initialTrackingMode === "regularWar" ? "sync current war lineup" : "sync today lineup";
	const statsStepLabel = initialTrackingMode === "regularWar" ? "refresh tracking stats" : "refresh CWL stats";
	const benchStepLabel = "compute bench suggestions";

	// Record pipeline issues in a normalized, user-facing format.
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

	// Mark a dependency-driven skip as an issue so operators see why work did not run.
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

	// Mark an expected no-op (feature disabled or mode constraint) as successful skip.
	const markIntentionalSkip = (stepKey, messageRaw) => {
		const step = steps[stepKey];
		step.ok = true;
		step.skipped = true;
		step.message = String(messageRaw == null ? "" : messageRaw).trim();
		if (stepKey === "stats") step.partialFailure = false;
	};

	// Execute one step and restore pre-step data if it throws or reports failure.
	const runStepWithRollback = (stepKey, stepLabelRaw, stepFn) => {
		const step = steps[stepKey];
		const stepLabel = String(stepLabelRaw == null ? "" : stepLabelRaw).trim() || "pipeline";
		const beforeStep = cloneRosterDataForRefresh_(rosterData);
		try {
			touchPipelineLockLease();
			const stepResult = stepFn();
			const stepReportedFailure = !!(stepResult && typeof stepResult === "object" && stepResult.ok === false);
			// Steps may return `{ ok:false }` without throwing; treat this as a controlled failure.
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
				// Stats can preserve metrics while war refresh fails; keep that partial-failure signal.
				if (stepKey === "stats") {
					const statsResult = step.result && typeof step.result === "object" ? step.result : {};
					step.partialFailure = !!(statsResult.partialFailure || (statsResult.memberTrackingPreserved && statsResult.warRefreshFailed));
				}
				addIssue(stepLabel, detailedMessage);
				return false;
			}

			if (stepResult && stepResult.rosterData) {
				// Success paths can still return mutated roster data that must be revalidated.
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
			// Unexpected exceptions always roll back to the pre-step snapshot.
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

	// Branch once on roster existence, then execute pipeline in dependency order.
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
		// CWL Preparation Mode deliberately freezes live lineup imports until the roster is finalized.
		if (trackingModeForPipeline === "cwl" && isCwlPreparationActiveForCurrentRoster()) {
			markIntentionalSkip("lineup", "live CWL lineup sync blocked by CWL Preparation Mode");
		} else if (!hasConnectedClanTag || !poolStepOk) {
			markSkippedAfterFailedStep("lineup", lineupStepLabel, poolStepLabel);
		} else {
			runStepWithRollback("lineup", lineupStepLabel, () => syncClanTodayLineupCore_(rosterData, rosterId, pipelinePrefetchOptions));
		}

		const lineupStepOk = !!steps.lineup.ok;
		// Regular-war mode can still refresh historical stats when lineup sync fails.
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
		// If no active CWL exists and nothing changed, bench planning would only churn stale output.
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
			runStepWithRollback("bench", benchStepLabel, () => computeBenchSuggestionsCore_(rosterData, rosterId, pipelinePrefetchOptions));
		}
	}

	// Final validation guarantees the caller always receives schema-safe roster data.
	let validatedRosterData = null;
	try {
		touchPipelineLockLease();
		validatedRosterData = validateRosterData_(rosterData);
	} catch (err) {
		throw new Error(appendDuplicateRosterTagDetailsToError_("finalize refresh pipeline payload", err, rosterData));
	}
	const finalRoster = findRosterInDataById_(validatedRosterData, rosterId);
	// Use the final roster state in case a step changed the tracking mode.
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

// Human-readable aggregate summary for logs/toasts after refresh-all completes.
function buildRefreshAllRunSummary_(processedRostersRaw, rostersWithIssuesRaw, issueCountRaw) {
	const processed = Math.max(0, toNonNegativeInt_(processedRostersRaw));
	const withIssues = Math.max(0, toNonNegativeInt_(rostersWithIssuesRaw));
	const issueCount = Math.max(0, toNonNegativeInt_(issueCountRaw));
	return "Processed " + processed + " roster(s), issues " + issueCount + " across " + withIssues + " roster(s).";
}

// Flatten prefetch bundle into the option shape expected by per-roster pipeline calls.
function buildRefreshAllPipelinePrefetchOptions_(prefetchBundleRaw) {
	const prefetch = prefetchBundleRaw && typeof prefetchBundleRaw === "object" ? prefetchBundleRaw : {};
	// Default every branch to an object so downstream code can use plain property checks.
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

// Build a shared ownership snapshot once so pool sync can avoid redundant lookups.
function buildRefreshAllOwnershipSnapshot_(rosterData, prefetchBundleRaw, optionsRaw) {
	const prefetch = prefetchBundleRaw && typeof prefetchBundleRaw === "object" ? prefetchBundleRaw : {};
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const metricsRunState = options.metricsRunState && typeof options.metricsRunState === "object" ? options.metricsRunState : null;
	// This snapshot is read-only input for pool sync, not a metrics-writing pass.
	return buildLiveRosterOwnershipSnapshot_(rosterData, {
		recordMetrics: false,
		metricsRunState: metricsRunState,
		prefetchedClanSnapshotsByTag: prefetch.clanMembersSnapshotByTag && typeof prefetch.clanMembersSnapshotByTag === "object" ? prefetch.clanMembersSnapshotByTag : {},
		prefetchedClanErrorsByTag: prefetch.clanMembersErrorByTag && typeof prefetch.clanMembersErrorByTag === "object" ? prefetch.clanMembersErrorByTag : {},
	});
}

// Select the per-roster status message shown in refresh-all results.
function buildRefreshAllRosterResultMessage_(pipelineResultRaw, rosterIssuesRaw) {
	const pipelineResult = pipelineResultRaw && typeof pipelineResultRaw === "object" ? pipelineResultRaw : {};
	const rosterIssues = Array.isArray(rosterIssuesRaw) ? rosterIssuesRaw : [];
	if (rosterIssues.length > 0) {
		// Surface the first concrete issue before any generic success/partial-failure text.
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

// Run refresh pipeline for every roster (expects caller already holds the job lock).
function runRefreshAllRostersUnlockedCore_(rosterDataRaw, optionsRaw) {
	let rosterData = null;
	try {
		rosterData = validateRosterData_(rosterDataRaw);
	} catch (err) {
		rethrowWithDuplicateRosterTagDetails_("initialize refresh payload", err, rosterDataRaw);
	}
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const metricsRunState = options.metricsRunState && typeof options.metricsRunState === "object" ? options.metricsRunState : {};
	// Ensure mutable run-state containers exist for cross-roster metrics reuse.
	if (!metricsRunState.seenClanTags || typeof metricsRunState.seenClanTags !== "object") metricsRunState.seenClanTags = {};
	const metricsProfileRunState = ensureMetricsProfileRunState_(metricsRunState);
	const sourceRosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	const rosterIds = [];
	// Freeze the roster iteration order up front so later mutations do not affect coverage.
	for (let i = 0; i < sourceRosters.length; i++) {
		const rosterId = String((sourceRosters[i] && sourceRosters[i].id) || "").trim();
		if (!rosterId) continue;
		rosterIds.push(rosterId);
	}

	const issues = [];
	const perRoster = [];
	let processedRosters = 0;
	let rostersWithIssues = 0;
	// Prefetch once for all rosters to reduce API calls and keep data temporally aligned.
	touchActiveRosterLockLease_("refresh all prefetch");
	const refreshAllPrefetch = buildRefreshAllPrefetchBundle_(sourceRosters);
	const refreshAllProfileCandidateTags = collectRefreshAllPlayerProfileCandidateTags_(sourceRosters, refreshAllPrefetch);
	prefetchAuthoritativePlayerMetricsSnapshotsByTag_(refreshAllProfileCandidateTags, {
		runState: metricsProfileRunState,
		batchSize: AUTO_REFRESH_PREFETCH_BATCH_SIZE,
		batchDelayMs: AUTO_REFRESH_PREFETCH_BATCH_DELAY_MS,
	});
	const pipelinePrefetchOptions = buildRefreshAllPipelinePrefetchOptions_(refreshAllPrefetch);
	const ownershipSnapshot = buildRefreshAllOwnershipSnapshot_(rosterData, refreshAllPrefetch, {
		metricsRunState: metricsRunState,
	});

	// Execute the same single-roster pipeline for each id and aggregate diagnostics.
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
				// Carry forward each successful roster mutation into the next pipeline run.
				rosterData = pipelineRun.rosterData;
			}
			pipelineResult = pipelineRun && pipelineRun.result && typeof pipelineRun.result === "object" ? pipelineRun.result : {};
			partialFailure = pipelineResult.partialFailure === true;
			trackingMode = String(pipelineResult.trackingMode == null ? trackingMode : pipelineResult.trackingMode).trim() || trackingMode;
			const pipelineIssues = Array.isArray(pipelineResult.issues) ? pipelineResult.issues : [];
			// Flatten per-step issues into both per-roster and global issue collections.
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
				// Preserve a minimal issue even if the step-level issue list came back empty.
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
				// Partial failures still need a visible issue row in aggregate refresh results.
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
			// Hard failures still collapse to the same roster-level issue shape as soft failures.
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
		// Store both the summary row and the underlying issue list for the caller.
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

	// Validate once after the loop so callers receive a safe final payload snapshot.
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

// Public refresh-all entrypoint that wraps the unlocked core with the job lock lifecycle.
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
			// Allow the caller to skip this run based on freshness or external conditions.
			const beforeResult = beforeRun();
			if (beforeResult && typeof beforeResult === "object" && beforeResult.skip === true) {
				return {
					skipped: true,
					reason: String(beforeResult.reason == null ? "skipped" : beforeResult.reason).trim() || "skipped",
					lastWriteAt: String(beforeResult.lastWriteAt == null ? "" : beforeResult.lastWriteAt).trim(),
				};
			}
		}
		// Delay loading until the lock is held so callers can fetch the freshest source payload.
		const sourceRosterData = rosterDataLoader ? rosterDataLoader() : rosterDataOrLoaderRaw;
		const runResult = runRefreshAllRostersUnlockedCore_(sourceRosterData, options);
		if (onAfterRun) {
			// Let the caller persist or publish the final run result while the lock is still held.
			onAfterRun(runResult);
		}
		touchActiveRosterLockLease_("refresh all complete");
		return runResult;
	});
}
