// Refresh-all/pipeline orchestration and related diagnostics.

// Build a stable payload fingerprint when the caller already holds validated data.
function normalizeActiveRosterForCompareValidated_(validatedRosterData) {
	const validated = validatedRosterData && typeof validatedRosterData === "object" ? validatedRosterData : {};
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

// Convert digest bytes into a compact stable hex string.
function bytesToHex_(bytesRaw) {
	const bytes = Array.isArray(bytesRaw) ? bytesRaw : [];
	let out = "";
	for (let i = 0; i < bytes.length; i++) {
		const n = (Number(bytes[i]) + 256) % 256;
		out += (n < 16 ? "0" : "") + n.toString(16);
	}
	return out;
}

// Build a source fingerprint from the same canonical fields used for active payload comparison.
function buildActiveRosterSourceFingerprintValidated_(validatedRosterData) {
	const normalized = normalizeActiveRosterForCompareValidated_(validatedRosterData);
	if (typeof Utilities === "undefined" || typeof Utilities.computeDigest !== "function") {
		throw new Error("Utilities.computeDigest is required to build active roster source fingerprints.");
	}
	const algorithm = Utilities.DigestAlgorithm && Utilities.DigestAlgorithm.SHA_256 ? Utilities.DigestAlgorithm.SHA_256 : "SHA_256";
	const charset = Utilities.Charset && Utilities.Charset.UTF_8 ? Utilities.Charset.UTF_8 : "UTF-8";
	return bytesToHex_(Utilities.computeDigest(algorithm, normalized, charset));
}

// Build a stable, validated payload fingerprint for refresh change detection.
function normalizeActiveRosterForCompare_(rosterDataRaw) {
	return normalizeActiveRosterForCompareValidated_(validateRosterData_(rosterDataRaw));
}

// Compare payloads when both sides already crossed a validation boundary.
function hasActiveRosterPayloadChangedValidated_(beforeValidated, afterValidated) {
	return normalizeActiveRosterForCompareValidated_(beforeValidated) !== normalizeActiveRosterForCompareValidated_(afterValidated);
}

// Compare normalized payloads so transient fields do not trigger false positives.
function hasActiveRosterPayloadChanged_(beforeRaw, afterRaw) {
	return normalizeActiveRosterForCompare_(beforeRaw) !== normalizeActiveRosterForCompare_(afterRaw);
}

// Stamp `lastUpdatedAt` when the caller already holds a validated roster payload.
function withValidatedRosterLastUpdatedAt_(validatedRosterData, timestampRaw) {
	const timestamp = String(timestampRaw == null ? "" : timestampRaw).trim() || new Date().toISOString();
	const validated = validatedRosterData && typeof validatedRosterData === "object" ? validatedRosterData : {};
	// Rebuild explicitly so internal trusted callers still keep the canonical active payload shape.
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
	return out;
}

// Stamp `lastUpdatedAt` while preserving the validated roster payload shape.
function withRosterLastUpdatedAt_(rosterDataRaw, timestampRaw) {
	const validated = validateRosterData_(rosterDataRaw);
	return validateRosterData_(withValidatedRosterLastUpdatedAt_(validated, timestampRaw));
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

// Return whether refresh-all is deferring full validation to the final payload boundary.
function isAutoRefreshFinalValidationMode_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	return options.autoRefreshFinalValidationMode === true;
}

// Validate step output unless the caller explicitly defers validation to refresh-all finalization.
function finalizeRefreshStepRosterDataForReturn_(rosterDataRaw, optionsRaw, labelRaw) {
	if (isAutoRefreshFinalValidationMode_(optionsRaw)) {
		if (!rosterDataRaw || typeof rosterDataRaw !== "object" || !Array.isArray(rosterDataRaw.rosters)) {
			const label = String(labelRaw == null ? "refresh step" : labelRaw).trim() || "refresh step";
			throw new Error(label + " returned invalid rosterData shape.");
		}
		return rosterDataRaw;
	}
	return validateRosterData_(rosterDataRaw);
}

// Find a roster while preserving manual callers' defensive validation behavior.
function findRosterByIdForRefreshStep_(rosterDataRaw, rosterIdRaw, optionsRaw) {
	if (!isAutoRefreshFinalValidationMode_(optionsRaw)) return findRosterById_(rosterDataRaw, rosterIdRaw);
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : null;
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	if (!rosterId) throw new Error("Roster ID is required.");
	if (!rosterData || !Array.isArray(rosterData.rosters)) throw new Error("Refresh step payload is invalid.");
	const roster = findRosterInDataById_(rosterData, rosterId);
	if (!roster) throw new Error("Roster not found: " + rosterId);
	return { rosterData: rosterData, roster: roster, rosterId: rosterId };
}

// Deep-clone a rollback fragment so a failed step can restore only the state it owns.
function cloneRefreshRollbackFragment_(valueRaw, labelRaw) {
	try {
		return JSON.parse(JSON.stringify(valueRaw == null ? null : valueRaw));
	} catch (err) {
		const label = String(labelRaw == null ? "state" : labelRaw).trim() || "state";
		throw new Error("Unable to clone refresh rollback " + label + ": " + errorMessage_(err));
	}
}

// Snapshot the current roster plus the only shared state a step is allowed to mutate.
function snapshotRefreshStepRollbackState_(rosterDataRaw, rosterIdRaw, includePlayerMetricsRaw, includeAllRostersRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	const rosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	let rosterIndex = -1;
	let rosterSnapshot = null;
	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		if (String(roster.id || "").trim() !== rosterId) continue;
		rosterIndex = i;
		rosterSnapshot = cloneRefreshRollbackFragment_(roster, "roster");
		break;
	}
	return {
		rosterId: rosterId,
		rosterIndex: rosterIndex,
		hadRoster: rosterIndex >= 0,
		roster: rosterSnapshot,
		includeAllRosters: includeAllRostersRaw === true,
		allRosters: includeAllRostersRaw === true ? cloneRefreshRollbackFragment_(rosters, "all rosters") : null,
		includePlayerMetrics: includePlayerMetricsRaw === true,
		playerMetrics: includePlayerMetricsRaw === true ? cloneRefreshRollbackFragment_(rosterData.playerMetrics, "playerMetrics") : null,
	};
}

// Restore only the fragments owned by the failed step, keeping all other roster work intact.
function restoreRefreshStepRollbackState_(rosterDataRaw, snapshotRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const snapshot = snapshotRaw && typeof snapshotRaw === "object" ? snapshotRaw : {};
	if (!Array.isArray(rosterData.rosters)) rosterData.rosters = [];
	if (snapshot.includeAllRosters) {
		rosterData.rosters = cloneRefreshRollbackFragment_(snapshot.allRosters, "all rosters restore") || [];
		if (snapshot.includePlayerMetrics) {
			rosterData.playerMetrics = cloneRefreshRollbackFragment_(snapshot.playerMetrics, "playerMetrics restore");
		}
		return rosterData;
	}
	const rosters = rosterData.rosters;
	const rosterId = String(snapshot.rosterId == null ? "" : snapshot.rosterId).trim();
	let currentRosterIndex = -1;
	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		if (String(roster.id || "").trim() === rosterId) {
			currentRosterIndex = i;
			break;
		}
	}
	if (snapshot.hadRoster) {
		const restoredRoster = cloneRefreshRollbackFragment_(snapshot.roster, "roster restore");
		if (currentRosterIndex >= 0) {
			rosters[currentRosterIndex] = restoredRoster;
		} else {
			const preferredIndex = Math.max(0, Math.min(toNonNegativeInt_(snapshot.rosterIndex), rosters.length));
			rosters.splice(preferredIndex, 0, restoredRoster);
		}
	} else if (currentRosterIndex >= 0) {
		rosters.splice(currentRosterIndex, 1);
	}
	if (snapshot.includePlayerMetrics) {
		rosterData.playerMetrics = cloneRefreshRollbackFragment_(snapshot.playerMetrics, "playerMetrics restore");
	}
	return rosterData;
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

// Return whether the caller is running from the refresh-all snapshot.
function isAutoRefreshSnapshotMode_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	return options.autoRefreshSnapshotMode === true;
}

// Build and log a controlled error for data that should have come from AutoRefreshSnapshot.
function buildAutoRefreshSnapshotMissError_(endpointRaw, keyRaw, contextRaw) {
	const endpoint = String(endpointRaw == null ? "" : endpointRaw).trim() || "unknown";
	const key = String(keyRaw == null ? "" : keyRaw).trim() || "unknown";
	const context = String(contextRaw == null ? "" : contextRaw).trim();
	const message = "Auto-refresh snapshot missing " + endpoint + " for " + key + (context ? " (" + context + ")" : "") + ".";
	const err = new Error(message);
	err.name = "AutoRefreshSnapshotMissError";
	err.autoRefreshSnapshotMiss = true;
	err.endpoint = endpoint;
	err.key = key;
	err.context = context;
	Logger.log("autoRefreshSnapshot miss endpoint=%s key=%s context=%s", endpoint, key, context);
	return err;
}

// Count own enumerable keys for compact snapshot logging.
function countMapKeys_(mapRaw) {
	const map = mapRaw && typeof mapRaw === "object" ? mapRaw : {};
	return Object.keys(map).length;
}

// Count errors captured by AutoRefreshSnapshot endpoint maps.
function countAutoRefreshSnapshotErrors_(snapshotRaw) {
	const snapshot = snapshotRaw && typeof snapshotRaw === "object" ? snapshotRaw : {};
	const cwlCoordinator = snapshot.cwlCoordinator && typeof snapshot.cwlCoordinator === "object" ? snapshot.cwlCoordinator : {};
	const cwlRuntimeState = cwlCoordinator.runtimeState && typeof cwlCoordinator.runtimeState === "object" ? cwlCoordinator.runtimeState : {};
	return (
		countMapKeys_(snapshot.clanMembersErrorByTag) +
		countMapKeys_(snapshot.currentRegularWarErrorByClanTag) +
		countMapKeys_(snapshot.leaguegroupErrorByClanTag) +
		countMapKeys_(snapshot.cwlWarErrorByTag) +
		countMapKeys_(snapshot.regularWarLogErrorByClanTag) +
		(cwlRuntimeState.discoveryIncomplete ? 1 : 0)
	);
}

// Build the first snapshot wave: members + war entry-point endpoints.
function buildAutoRefreshSnapshotWaveOne_(connectedClanTagsRaw, currentWarClanTagsRaw, cwlClanTagsRaw, optionsRaw) {
	const connectedClanTags = Array.isArray(connectedClanTagsRaw) ? connectedClanTagsRaw : [];
	const currentWarClanTags = Array.isArray(currentWarClanTagsRaw) ? currentWarClanTagsRaw : [];
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
	for (let i = 0; i < currentWarClanTags.length; i++) {
		const clanTag = normalizeTag_(currentWarClanTags[i]);
		if (!clanTag) continue;
		const key = "regularWar:" + clanTag;
		regularWarKeyByClanTag[clanTag] = key;
		entries.push({
			key: key,
			path: "/clans/" + encodeTagForPath_(clanTag) + "/currentwar",
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

	// Current-war fetches treat 404/private-war-log as handled unavailable states.
	for (let i = 0; i < currentWarClanTags.length; i++) {
		const clanTag = normalizeTag_(currentWarClanTags[i]);
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
		requestCounts: {
			members: connectedClanTags.length,
			currentWar: currentWarClanTags.length,
			leagueGroup: cwlClanTags.length,
			total: fetched.requestCount,
		},
		batchCount: fetched.batchCount,
	};
}

// Build the clan-tag portions of the AutoRefreshSnapshot request plan.
function buildAutoRefreshSnapshotClanRequestPlan_(sourceRostersRaw, optionsRaw) {
	const sourceRosters = Array.isArray(sourceRostersRaw) ? sourceRostersRaw : [];
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const cwlEventNeed = options.cwlSeasonEventNeed && typeof options.cwlSeasonEventNeed === "object" ? options.cwlSeasonEventNeed : {};
	const connectedClanTagSet = {};
	const currentWarClanTagSet = {};
	const cwlClanTagSet = {};
	const cwlRosterClanTagSet = {};

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
			currentWarClanTagSet[clanTag] = true;
		} else {
			cwlClanTagSet[clanTag] = true;
			cwlRosterClanTagSet[clanTag] = true;
			currentWarClanTagSet[clanTag] = true;
		}
	}
	if (cwlEventNeed.needsCwl === true) {
		const connectedClanTags = Object.keys(connectedClanTagSet);
		for (let i = 0; i < connectedClanTags.length; i++) {
			cwlClanTagSet[connectedClanTags[i]] = true;
		}
	}

	return {
		connectedClanTags: Object.keys(connectedClanTagSet),
		currentWarClanTags: Object.keys(currentWarClanTagSet),
		cwlClanTags: Object.keys(cwlClanTagSet),
		cwlRosterClanTags: Object.keys(cwlRosterClanTagSet),
		cwlSeasonEventNeed: cwlEventNeed,
	};
}

// Return whether regular-war history has incomplete entries that repair may attempt.
function hasIncompleteRegularWarHistoryForSnapshot_(warPerformanceRaw) {
	const warPerformance = warPerformanceRaw && typeof warPerformanceRaw === "object" ? warPerformanceRaw : {};
	const historyByKey = sanitizeRegularWarHistoryByKey_(warPerformance.regularWarHistoryByKey);
	const warKeys = Object.keys(historyByKey);
	for (let i = 0; i < warKeys.length; i++) {
		const warKey = warKeys[i];
		const entry = sanitizeRegularWarHistoryEntry_(historyByKey[warKey], warKey);
		if (entry && entry.incomplete) return true;
	}
	return false;
}

// Return whether a regular-war roster needs warlog data for refresh-all finalization or repair.
function shouldPrefetchRegularWarLogForRoster_(rosterRaw, currentRegularWarByClanTagRaw, currentRegularWarErrorByClanTagRaw, optionsRaw, nowIsoRaw) {
	const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
	const trackingMode = getRosterTrackingMode_(roster);
	const clanTag = normalizeTag_(roster.connectedClanTag);
	if (!clanTag) return false;
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const currentRegularWarByClanTag = currentRegularWarByClanTagRaw && typeof currentRegularWarByClanTagRaw === "object" ? currentRegularWarByClanTagRaw : {};
	const currentRegularWarErrorByClanTag = currentRegularWarErrorByClanTagRaw && typeof currentRegularWarErrorByClanTagRaw === "object" ? currentRegularWarErrorByClanTagRaw : {};
	const warPerformance = sanitizeRosterWarPerformance_(roster.warPerformance) || {};
	if (trackingMode === "regularWar" && options.allowRegularWarHistoryRepair === true && hasIncompleteRegularWarHistoryForSnapshot_(warPerformance)) {
		return true;
	}

	const previousSnapshot = sanitizeRegularWarSnapshot_(warPerformance.lastRegularWarSnapshot);
	const lifecycle = sanitizeRegularWarLifecycleState_(warPerformance.regularWarLifecycle);
	const previousActiveWarKey = String((lifecycle && lifecycle.activeWarKey) || (previousSnapshot && previousSnapshot.warMeta && previousSnapshot.warMeta.warKey) || "").trim();
	if (!previousActiveWarKey) return false;
	if (Object.prototype.hasOwnProperty.call(currentRegularWarErrorByClanTag, clanTag)) return false;
	if (!Object.prototype.hasOwnProperty.call(currentRegularWarByClanTag, clanTag)) return false;

	const currentWar = currentRegularWarByClanTag[clanTag] && typeof currentRegularWarByClanTag[clanTag] === "object" ? currentRegularWarByClanTag[clanTag] : null;
	const currentWarMetaBase = currentWar && currentWar.currentWarMeta && typeof currentWar.currentWarMeta === "object" ? currentWar.currentWarMeta : buildNoCurrentRegularWarResult_(clanTag).currentWarMeta;
	const currentWarMeta = sanitizeRegularWarCurrentWar_(Object.assign({}, currentWarMetaBase, { available: !!(currentWar && currentWar.available) }));
	if (String(currentWarMeta.unavailableReason || "").trim() === "privateWarLog") return false;

	const retryBudgetExhaustedWithoutDueAt =
		String(lifecycle.finalizationStatus || "") === "exhausted" && !String(lifecycle.finalizationDueAt || "").trim();
	if (retryBudgetExhaustedWithoutDueAt && options.allowRegularWarHistoryRepair !== true) return false;

	const currentWarState = normalizeWarState_((currentWar && currentWar.state) || currentWarMeta.state) || "notinwar";
	const currentWarKey = String(currentWarMeta.warKey || "").trim();
	if (trackingMode !== "regularWar") {
		if (isCwlPreparationActive_(roster)) return false;
		if (!isActiveRegularWarTransitionSignal_({ ok: true, available: !!(currentWar && currentWar.available), sideMatches: true, state: currentWarState })) {
			return false;
		}
	}
	if (!shouldFinalizePreviousRegularWar_(previousActiveWarKey, currentWarKey, currentWarState)) return false;

	if (currentWar && currentWarKey === previousActiveWarKey && currentWarState === "warended" && warHasMemberLevelDataForClan_(currentWar, clanTag)) {
		return false;
	}
	return true;
}

// Build the full AutoRefreshSnapshot needed before any per-roster refresh-all mutation starts.
function buildAutoRefreshSnapshot_(rosterDataRaw, optionsRaw) {
	const snapshotStartMs = Date.now();
	const capturedAt = new Date().toISOString();
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const sourceRosters = Array.isArray(options.sourceRosters) ? options.sourceRosters : Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	const prefetchOptions = {
		batchSize: AUTO_REFRESH_PREFETCH_BATCH_SIZE,
		batchDelayMs: AUTO_REFRESH_PREFETCH_BATCH_DELAY_MS,
	};

	const cwlSeasonEventNeed = typeof getCurrentCwlSeasonEventRefreshNeed_ === "function" ? getCurrentCwlSeasonEventRefreshNeed_() : { needsCwl: false };
	const basePlan = buildAutoRefreshSnapshotClanRequestPlan_(sourceRosters, { cwlSeasonEventNeed: cwlSeasonEventNeed });

	// Wave one covers member and regular-war entry-point endpoints keyed only by clan tag.
	const waveOneStartMs = Date.now();
	const waveOnePrefetch = buildAutoRefreshSnapshotWaveOne_(basePlan.connectedClanTags, basePlan.currentWarClanTags, [], prefetchOptions);
	const waveOneMs = Math.max(0, Date.now() - waveOneStartMs);

	// CWL coordinator owns league-group discovery and relevant-war polling. It
	// stores only compact runtime state and exposes narrow per-clan views.
	const cwlCoordinatorStartMs = Date.now();
	const cwlCoordinator =
		typeof buildCwlCoordinatorResult_ === "function"
			? buildCwlCoordinatorResult_(rosterData, {
				sourceRosters: sourceRosters,
				nowIso: capturedAt,
				source: "refresh-all-snapshot",
			})
			: { ok: true, status: "unavailable", requestCounts: { leagueGroup: 0, cwlWar: 0, total: 0 } };
	const cwlCoordinatorMs = Math.max(0, Date.now() - cwlCoordinatorStartMs);
	const cwlCoordinatorRequestCounts =
		cwlCoordinator && cwlCoordinator.requestCounts && typeof cwlCoordinator.requestCounts === "object"
			? cwlCoordinator.requestCounts
			: {};

	const regularWarLogClanTagSet = {};
	for (let i = 0; i < sourceRosters.length; i++) {
		const roster = sourceRosters[i] && typeof sourceRosters[i] === "object" ? sourceRosters[i] : {};
		const clanTag = normalizeTag_(roster.connectedClanTag);
		if (!clanTag) continue;
		if (
			shouldPrefetchRegularWarLogForRoster_(
				roster,
				waveOnePrefetch.currentRegularWarByClanTag,
				waveOnePrefetch.currentRegularWarErrorByClanTag,
				options,
				capturedAt,
			)
		) {
			regularWarLogClanTagSet[clanTag] = true;
		}
	}
	const regularWarLogClanTags = Object.keys(regularWarLogClanTagSet);
	const regularWarLogWaveStartMs = Date.now();
	const regularWarLogPrefetch = prefetchRegularWarLogByClanTag_(regularWarLogClanTags, prefetchOptions);
	const regularWarLogWaveMs = Math.max(0, Date.now() - regularWarLogWaveStartMs);

	const requestCounts = {
		members: waveOnePrefetch.requestCounts.members,
		currentWar: waveOnePrefetch.requestCounts.currentWar,
		leagueGroup: toNonNegativeInt_(cwlCoordinatorRequestCounts.leagueGroup),
		cwlWar: toNonNegativeInt_(cwlCoordinatorRequestCounts.cwlWar),
		regularWarLog: regularWarLogPrefetch.requestCount,
		total: waveOnePrefetch.requestCounts.total + toNonNegativeInt_(cwlCoordinatorRequestCounts.total) + regularWarLogPrefetch.requestCount,
	};
	const batchCounts = {
		waveOne: waveOnePrefetch.batchCount,
		cwlWarWave: 0,
		regularWarLogWave: regularWarLogPrefetch.batchCount,
		total: waveOnePrefetch.batchCount + regularWarLogPrefetch.batchCount,
	};
	const snapshot = {
		capturedAt: capturedAt,
		requestPlan: {
			connectedClanTags: basePlan.connectedClanTags,
			currentWarClanTags: basePlan.currentWarClanTags,
			cwlClanTags: basePlan.cwlClanTags,
			cwlRosterClanTags: basePlan.cwlRosterClanTags,
			cwlWarTags:
				cwlCoordinator &&
				cwlCoordinator.eventAggregateResult &&
				cwlCoordinator.eventAggregateResult.aggregate &&
				Array.isArray(cwlCoordinator.eventAggregateResult.aggregate.warTags)
					? cwlCoordinator.eventAggregateResult.aggregate.warTags
					: [],
			regularWarLogClanTags: regularWarLogClanTags,
			cwlSeasonEventNeed: cwlSeasonEventNeed,
		},
		clanMembersSnapshotByTag: waveOnePrefetch.clanMembersSnapshotByTag,
		clanMembersErrorByTag: waveOnePrefetch.clanMembersErrorByTag,
		currentRegularWarByClanTag: waveOnePrefetch.currentRegularWarByClanTag,
		currentRegularWarErrorByClanTag: waveOnePrefetch.currentRegularWarErrorByClanTag,
		leaguegroupRawByClanTag:
			cwlCoordinator && cwlCoordinator.leaguegroupRawByClanTag && typeof cwlCoordinator.leaguegroupRawByClanTag === "object"
				? cwlCoordinator.leaguegroupRawByClanTag
				: {},
		leaguegroupErrorByClanTag:
			cwlCoordinator && cwlCoordinator.leaguegroupErrorByClanTag && typeof cwlCoordinator.leaguegroupErrorByClanTag === "object"
				? cwlCoordinator.leaguegroupErrorByClanTag
				: {},
		cwlWarRawByTag: {},
		cwlWarErrorByTag: {},
		cwlCoordinator: cwlCoordinator,
		regularWarLogByClanTag: regularWarLogPrefetch.entriesByClanTag,
		regularWarLogErrorByClanTag: regularWarLogPrefetch.errorByClanTag,
		timingMs: {
			waveOne: waveOneMs,
			cwlWarWave: cwlCoordinatorMs,
			regularWarLogWave: regularWarLogWaveMs,
			total: Math.max(0, Date.now() - snapshotStartMs),
		},
		requestCounts: requestCounts,
		batchCounts: batchCounts,
		snapshotMisses: 0,
	};
	Logger.log(
		"autoRefreshSnapshot timing totalMs=%s waveOneMs=%s cwlWarWaveMs=%s regularWarLogWaveMs=%s requestsTotal=%s members=%s currentWar=%s leagueGroup=%s cwlWar=%s regularWarLog=%s batchesTotal=%s waveOneBatches=%s cwlWarWaveBatches=%s regularWarLogWaveBatches=%s errorsTotal=%s snapshotMisses=%s",
		snapshot.timingMs.total,
		snapshot.timingMs.waveOne,
		snapshot.timingMs.cwlWarWave,
		snapshot.timingMs.regularWarLogWave,
		snapshot.requestCounts.total,
		snapshot.requestCounts.members,
		snapshot.requestCounts.currentWar,
		snapshot.requestCounts.leagueGroup,
		snapshot.requestCounts.cwlWar,
		snapshot.requestCounts.regularWarLog,
		snapshot.batchCounts.total,
		snapshot.batchCounts.waveOne,
		snapshot.batchCounts.cwlWarWave,
		snapshot.batchCounts.regularWarLogWave,
		countAutoRefreshSnapshotErrors_(snapshot),
		snapshot.snapshotMisses,
	);
	return snapshot;
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

// Count canonical roster pool slots without changing player data.
function countRosterPoolSlotsForTransition_(rosterRaw) {
	const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
	return (
		(Array.isArray(roster.main) ? roster.main.length : 0) +
		(Array.isArray(roster.subs) ? roster.subs.length : 0) +
		(Array.isArray(roster.missing) ? roster.missing.length : 0)
	);
}

// Resolve the CWL league group used by automatic tracking-mode detection.
function resolveLeagueGroupForAutomaticTransition_(clanTagRaw, optionsRaw) {
	const clanTag = normalizeTag_(clanTagRaw);
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const cwlView = typeof getCwlCoordinatorClanViewFromOptions_ === "function" ? getCwlCoordinatorClanViewFromOptions_(options, clanTag) : null;
	if (cwlView && typeof cwlView === "object") {
		const groupStates = Array.isArray(cwlView.groupStates) ? cwlView.groupStates : [];
		const hasGroup = groupStates.length > 0;
		return {
			ok: hasGroup && !(cwlView.freshness && cwlView.freshness.discoveryIncomplete),
			source: "cwlCoordinator",
			state: hasGroup ? "inwar" : "",
			rawState: hasGroup ? "inWar" : "",
			clanFound: hasGroup,
			isMalformed: false,
			leaguegroup: {
				state: hasGroup ? "inwar" : "",
				clanFound: hasGroup,
				isMalformed: false,
				warTags: cwlView.currentWar && cwlView.currentWar.warTag ? [cwlView.currentWar.warTag] : [],
				season: String(cwlView.season || ""),
			},
			statusCode: 0,
			errorMessage: "",
		};
	}
	const rawByClanTag =
		options.prefetchedLeaguegroupRawByClanTag && typeof options.prefetchedLeaguegroupRawByClanTag === "object" ? options.prefetchedLeaguegroupRawByClanTag : {};
	const errorByClanTag =
		options.prefetchedLeaguegroupErrorByClanTag && typeof options.prefetchedLeaguegroupErrorByClanTag === "object" ? options.prefetchedLeaguegroupErrorByClanTag : {};
	if (!clanTag) return { ok: false, source: "none", state: "", clanFound: false, isMalformed: false, statusCode: 0, errorMessage: "missing clan tag" };
	if (Object.prototype.hasOwnProperty.call(errorByClanTag, clanTag)) {
		const err = errorByClanTag[clanTag];
		return {
			ok: false,
			source: "prefetchError",
			state: "",
			clanFound: false,
			isMalformed: false,
			statusCode: Number(err && err.statusCode) || 0,
			errorMessage: errorMessage_(err),
		};
	}

	let raw = null;
	let source = "directFetch";
	if (Object.prototype.hasOwnProperty.call(rawByClanTag, clanTag)) {
		raw = rawByClanTag[clanTag];
		source = "prefetch";
	} else if (isAutoRefreshSnapshotMode_(options)) {
		const err = buildAutoRefreshSnapshotMissError_("leagueGroup", clanTag, "automaticTrackingModeTransition");
		return {
			ok: false,
			source: "snapshotMiss",
			state: "",
			clanFound: false,
			isMalformed: false,
			statusCode: 0,
			errorMessage: errorMessage_(err),
		};
	} else {
		try {
			raw = cocFetch_("/clans/" + encodeTagForPath_(clanTag) + "/currentwar/leaguegroup");
			rawByClanTag[clanTag] = raw;
		} catch (err) {
			errorByClanTag[clanTag] = err;
			return {
				ok: false,
				source: Number(err && err.statusCode) === 404 ? "directFetch404" : "directFetchError",
				state: "",
				clanFound: false,
				isMalformed: false,
				statusCode: Number(err && err.statusCode) || 0,
				errorMessage: errorMessage_(err),
			};
		}
	}

	const mapped = mapLeagueGroupDataForClan_(clanTag, raw);
	return {
		ok: true,
		source: source,
		state: normalizeWarState_(mapped && mapped.state),
		rawState: String((mapped && mapped.rawState) || ""),
		clanFound: !!(mapped && mapped.clanFound),
		isMalformed: !!(mapped && mapped.isMalformed),
		leaguegroup: mapped,
		statusCode: 0,
		errorMessage: "",
	};
}

// Resolve the regular current war used by automatic tracking-mode detection.
function resolveCurrentRegularWarForAutomaticTransition_(clanTagRaw, optionsRaw) {
	const clanTag = normalizeTag_(clanTagRaw);
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const currentWarByClanTag =
		options.prefetchedCurrentRegularWarByClanTag && typeof options.prefetchedCurrentRegularWarByClanTag === "object" ? options.prefetchedCurrentRegularWarByClanTag : {};
	const errorByClanTag =
		options.prefetchedRegularWarErrorByClanTag && typeof options.prefetchedRegularWarErrorByClanTag === "object" ? options.prefetchedRegularWarErrorByClanTag : {};
	if (!clanTag) return { ok: false, source: "none", state: "", sideMatches: false, statusCode: 0, errorMessage: "missing clan tag" };
	if (Object.prototype.hasOwnProperty.call(errorByClanTag, clanTag)) {
		const err = errorByClanTag[clanTag];
		return {
			ok: false,
			source: "prefetchError",
			state: "",
			sideMatches: false,
			statusCode: Number(err && err.statusCode) || 0,
			errorMessage: errorMessage_(err),
		};
	}

	let currentWar = null;
	let source = "directFetch";
	if (Object.prototype.hasOwnProperty.call(currentWarByClanTag, clanTag)) {
		currentWar = currentWarByClanTag[clanTag];
		source = "prefetch";
	} else if (isAutoRefreshSnapshotMode_(options)) {
		const err = buildAutoRefreshSnapshotMissError_("currentWar", clanTag, "automaticTrackingModeTransition");
		return {
			ok: false,
			source: "snapshotMiss",
			state: "",
			sideMatches: false,
			statusCode: 0,
			errorMessage: errorMessage_(err),
		};
	} else {
		try {
			currentWar = fetchCurrentRegularWar_(clanTag);
			currentWarByClanTag[clanTag] = currentWar;
		} catch (err) {
			errorByClanTag[clanTag] = err;
			return {
				ok: false,
				source: "directFetchError",
				state: "",
				sideMatches: false,
				statusCode: Number(err && err.statusCode) || 0,
				errorMessage: errorMessage_(err),
			};
		}
	}

	const currentWarMeta = currentWar && currentWar.currentWarMeta && typeof currentWar.currentWarMeta === "object" ? currentWar.currentWarMeta : {};
	const state = normalizeWarState_((currentWar && currentWar.state) || currentWarMeta.state);
	const clanSide = currentWar && currentWar.clanSide && typeof currentWar.clanSide === "object" ? currentWar.clanSide : null;
	const opponentSide = currentWar && currentWar.opponentSide && typeof currentWar.opponentSide === "object" ? currentWar.opponentSide : null;
	const available = !!(currentWar && currentWar.available);
	const sideMatches =
		available &&
		(normalizeTag_(clanSide && clanSide.tag) === clanTag ||
			normalizeTag_(opponentSide && opponentSide.tag) === clanTag ||
			normalizeTag_(currentWarMeta.clanTag) === clanTag);
	return {
		ok: true,
		source: source,
		state: state,
		sideMatches: !!sideMatches,
		available: available,
		unavailableReason: String((currentWarMeta && currentWarMeta.unavailableReason) || ""),
		currentWar: currentWar,
		statusCode: 0,
		errorMessage: "",
	};
}

// Return whether mapped current-war data is a positive regular-war signal.
function isActiveRegularWarTransitionSignal_(probeRaw) {
	const probe = probeRaw && typeof probeRaw === "object" ? probeRaw : {};
	if (!probe.ok || !probe.available || !probe.sideMatches) return false;
	return isActiveWarState_(probe.state);
}

// Disable CWL preparation without touching player sections.
function disableCwlPreparationForAutomaticTransition_(rosterRaw) {
	const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : null;
	if (!roster) return false;
	const prep = getRosterCwlPreparation_(roster);
	const wasEnabled = !!(prep && prep.enabled);
	prep.enabled = false;
	prep.assignedTagSet = {};
	prep.excludedTagSet = {};
	prep.clanAbsentTagSet = {};
	delete prep.clanAbsentUpdatedAt;
	roster.cwlPreparation = prep;
	clearRosterBenchSuggestions_(roster);
	return wasEnabled;
}

// Detect and apply automatic CWL/regular-war mode transitions from official API state.
function detectAndApplyAutomaticTrackingModeTransition_(rosterDataRaw, rosterIdRaw, optionsRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : null;
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const nowIso = new Date().toISOString();
	const roster = rosterData ? findRosterInDataById_(rosterData, rosterId) : null;
	const result = {
		mode: "automaticTrackingModeTransition",
		ran: true,
		changed: false,
		cwlPreparationDisabled: false,
		switchedToRegularWar: false,
		clanTag: "",
		initialTrackingMode: "",
		finalTrackingMode: "",
		leagueGroupSource: "",
		leagueGroupState: "",
		leagueGroupClanFound: false,
		leagueGroupMalformed: false,
		currentWarSource: "",
		currentWarState: "",
		currentWarSideMatches: false,
		message: "",
	};
	const messages = [];

	if (!roster) {
		result.message = "automatic tracking-mode detection skipped: roster not found";
		return { ok: true, rosterData: rosterDataRaw, result: result };
	}

	const clanTag = normalizeTag_(roster.connectedClanTag);
	result.clanTag = clanTag;
	result.initialTrackingMode = getRosterTrackingMode_(roster);
	result.finalTrackingMode = result.initialTrackingMode;
	if (!clanTag || !isValidClanTag_(clanTag)) {
		result.message = "automatic tracking-mode detection skipped: connected clan tag missing or invalid";
		return { ok: true, rosterData: rosterDataRaw, result: result };
	}
	if (result.initialTrackingMode !== "cwl") {
		result.message = "automatic tracking-mode detection skipped: roster is not in CWL mode";
		Logger.log("automaticTrackingModeTransition rosterId=%s clanTag=%s skipped=%s", rosterId, clanTag, "notCwl");
		return { ok: true, rosterData: rosterDataRaw, result: result };
	}

	const beforePoolCount = countRosterPoolSlotsForTransition_(roster);
	let activeCwlGroupDetected = false;
	if (isCwlPreparationActive_(roster)) {
		const leagueProbe = resolveLeagueGroupForAutomaticTransition_(clanTag, options);
		result.leagueGroupSource = String(leagueProbe.source || "");
		result.leagueGroupState = normalizeWarState_(leagueProbe.state);
		result.leagueGroupClanFound = !!leagueProbe.clanFound;
		result.leagueGroupMalformed = !!leagueProbe.isMalformed;
		if (leagueProbe.ok && !leagueProbe.isMalformed && leagueProbe.clanFound && isActiveWarState_(leagueProbe.state)) {
			activeCwlGroupDetected = true;
			disableCwlPreparationForAutomaticTransition_(roster);
			setRosterPublicLineupProjectionInactive_(roster, {
				trackingMode: "cwl",
				source: "cwlPreparation",
				unavailableReason: "activeCwlLeagueGroup",
				updatedAt: nowIso,
			});
			result.changed = true;
			result.cwlPreparationDisabled = true;
			try {
				const signupArchive = archiveAndResetCwlLeagueSignups_("cwl-started", "automatic-tracking-mode-transition");
				if (signupArchive && signupArchive.archived) {
					result.cwlLeagueSignupsArchived = true;
					result.cwlLeagueSignupCount = signupArchive.count;
				}
			} catch (err) {
				Logger.log("Unable to archive CWL league signups during automatic transition for rosterId=%s: %s", rosterId, errorMessage_(err));
			}
			messages.push("CWL Preparation Mode disabled automatically because active CWL league group was detected");
		} else {
			const detail = leagueProbe.ok
				? "state=" + (result.leagueGroupState || "unknown") + ", clanFound=" + result.leagueGroupClanFound + ", malformed=" + result.leagueGroupMalformed
				: "source=" + result.leagueGroupSource + ", status=" + (leagueProbe.statusCode || 0);
			messages.push("CWL Preparation Mode kept active: no positive active CWL league-group signal (" + detail + ")");
		}
	}

	if (activeCwlGroupDetected) {
		messages.push("CWL tracking kept active: active CWL league-group signal takes priority over regular-war switching");
	} else if (getRosterTrackingMode_(roster) === "cwl" && !isCwlPreparationActive_(roster)) {
		const currentWarProbe = resolveCurrentRegularWarForAutomaticTransition_(clanTag, options);
		result.currentWarSource = String(currentWarProbe.source || "");
		result.currentWarState = normalizeWarState_(currentWarProbe.state);
		result.currentWarSideMatches = !!currentWarProbe.sideMatches;
		if (isActiveRegularWarTransitionSignal_(currentWarProbe)) {
			roster.trackingMode = "regularWar";
			disableCwlPreparationForAutomaticTransition_(roster);
			setRosterPublicLineupProjectionInactive_(roster, {
				trackingMode: "regularWar",
				source: "regularWarCurrentWar",
				unavailableReason: "automaticModeSwitch",
				updatedAt: nowIso,
			});
			clearRosterBenchSuggestions_(roster);
			result.changed = true;
			result.switchedToRegularWar = true;
			messages.push("Roster switched automatically to regularWar because active regular war was detected");
		} else {
			const detail = currentWarProbe.ok
				? "state=" + (result.currentWarState || "unknown") + ", sideMatches=" + result.currentWarSideMatches + ", available=" + !!currentWarProbe.available
				: "source=" + result.currentWarSource + ", status=" + (currentWarProbe.statusCode || 0);
			messages.push("CWL tracking kept active: no positive active regular-war signal (" + detail + ")");
		}
	}

	const afterPoolCount = countRosterPoolSlotsForTransition_(roster);
	if (afterPoolCount !== beforePoolCount) {
		throw new Error("Automatic tracking-mode transition changed roster pool count for roster '" + rosterId + "' (" + beforePoolCount + " -> " + afterPoolCount + ").");
	}

	const validatedRosterData = finalizeRefreshStepRosterDataForReturn_(rosterData, options, "automatic tracking-mode transition");
	const finalRoster = findRosterInDataById_(validatedRosterData, rosterId);
	const finalPoolCount = countRosterPoolSlotsForTransition_(finalRoster);
	if (finalPoolCount !== beforePoolCount) {
		throw new Error("Automatic tracking-mode transition validation changed roster pool count for roster '" + rosterId + "' (" + beforePoolCount + " -> " + finalPoolCount + ").");
	}
	result.finalTrackingMode = finalRoster ? getRosterTrackingMode_(finalRoster) : getRosterTrackingMode_(roster);
	result.message = messages.length ? messages.join("; ") : "automatic tracking-mode detection completed: no mode change";
	Logger.log(
		"automaticTrackingModeTransition rosterId=%s clanTag=%s initialMode=%s finalMode=%s prepDisabled=%s switchedRegularWar=%s leagueGroupSource=%s leagueGroupState=%s leagueGroupClanFound=%s currentWarSource=%s currentWarState=%s currentWarSideMatches=%s changed=%s",
		rosterId,
		clanTag,
		result.initialTrackingMode,
		result.finalTrackingMode,
		result.cwlPreparationDisabled,
		result.switchedToRegularWar,
		result.leagueGroupSource,
		result.leagueGroupState,
		result.leagueGroupClanFound,
		result.currentWarSource,
		result.currentWarState,
		result.currentWarSideMatches,
		result.changed,
	);
	return {
		ok: true,
		rosterData: validatedRosterData,
		result: result,
	};
}

// Run a single-roster refresh pipeline with per-step rollback and issue tracking.
function runRosterRefreshPipelineCore_(rosterDataRaw, rosterIdRaw, optionsRaw) {
	const rosterPipelineStartMs = Date.now();
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
		cwlCoordinatorResult: options.cwlCoordinatorResult && typeof options.cwlCoordinatorResult === "object" ? options.cwlCoordinatorResult : null,
		cwlCoordinatorClanView: options.cwlCoordinatorClanView && typeof options.cwlCoordinatorClanView === "object" ? options.cwlCoordinatorClanView : null,
		prefetchedRegularWarLogByClanTag:
			options.prefetchedRegularWarLogByClanTag && typeof options.prefetchedRegularWarLogByClanTag === "object" ? options.prefetchedRegularWarLogByClanTag : {},
		prefetchedRegularWarLogErrorByClanTag:
			options.prefetchedRegularWarLogErrorByClanTag && typeof options.prefetchedRegularWarLogErrorByClanTag === "object" ? options.prefetchedRegularWarLogErrorByClanTag : {},
		autoRefreshSnapshotMode: options.autoRefreshSnapshotMode === true,
		autoRefreshFinalValidationMode: options.autoRefreshFinalValidationMode === true,
		metricsRunState: options.metricsRunState && typeof options.metricsRunState === "object" ? options.metricsRunState : null,
		allowRegularWarHistoryRepair: options.allowRegularWarHistoryRepair !== false,
		allowRegularWarProvisionalFallback: options.allowRegularWarProvisionalFallback === true,
		statsOnlyRegularWarFinalization: options.statsOnlyRegularWarFinalization === true,
	};

	// Step status payload returned to callers and surfaced in refresh-all diagnostics.
	const steps = {
		pool: { ok: false, skipped: false, message: "", result: null },
		modeTransition: { ok: false, skipped: false, message: "", result: null },
		lineup: { ok: false, skipped: false, message: "", result: null },
		stats: { ok: false, skipped: false, partialFailure: false, message: "", result: null },
		bench: { ok: false, skipped: false, message: "", result: null },
	};
	const stepDurationMs = {
		pool: 0,
		modeTransition: 0,
		lineup: 0,
		stats: 0,
		bench: 0,
	};
	let rollbackCloneDurationMs = 0;
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
	if (
		initialRoster &&
		initialTrackingMode === "cwl" &&
		!pipelinePrefetchOptions.autoRefreshSnapshotMode &&
		!pipelinePrefetchOptions.cwlCoordinatorResult &&
		!pipelinePrefetchOptions.cwlCoordinatorClanView &&
		typeof buildCwlCoordinatorResult_ === "function"
	) {
		const coordinator = buildCwlCoordinatorResult_(rosterData, {
			sourceRosters: [initialRoster],
			source: "single-roster-refresh",
		});
		pipelinePrefetchOptions.cwlCoordinatorResult = coordinator;
		const coordinatorOptions = typeof buildCwlCoordinatorPipelineOptions_ === "function" ? buildCwlCoordinatorPipelineOptions_(coordinator) : {};
		pipelinePrefetchOptions.prefetchedLeaguegroupRawByClanTag =
			coordinatorOptions.prefetchedLeaguegroupRawByClanTag && typeof coordinatorOptions.prefetchedLeaguegroupRawByClanTag === "object"
				? coordinatorOptions.prefetchedLeaguegroupRawByClanTag
				: pipelinePrefetchOptions.prefetchedLeaguegroupRawByClanTag;
		pipelinePrefetchOptions.prefetchedLeaguegroupErrorByClanTag =
			coordinatorOptions.prefetchedLeaguegroupErrorByClanTag && typeof coordinatorOptions.prefetchedLeaguegroupErrorByClanTag === "object"
				? coordinatorOptions.prefetchedLeaguegroupErrorByClanTag
				: pipelinePrefetchOptions.prefetchedLeaguegroupErrorByClanTag;
	}
	// Step labels are intentionally user-facing because they flow into issue summaries.
	const poolStepLabel = "sync clan roster pool";
	const modeTransitionStepLabel = "detect tracking mode";
	const getLineupStepLabel = () => (getCurrentTrackingMode() === "regularWar" ? "sync current war lineup" : "sync today lineup");
	const getStatsStepLabel = () => (getCurrentTrackingMode() === "regularWar" ? "refresh tracking stats" : "refresh CWL stats");
	const initialLineupStepLabel = initialTrackingMode === "regularWar" ? "sync current war lineup" : "sync today lineup";
	const initialStatsStepLabel = initialTrackingMode === "regularWar" ? "refresh tracking stats" : "refresh CWL stats";
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
		stepDurationMs[stepKey] = 0;
		if (stepKey === "stats") step.partialFailure = false;
		addIssue(stepLabel, skipMessage);
	};

	// Mark an expected no-op (feature disabled or mode constraint) as successful skip.
	const markIntentionalSkip = (stepKey, messageRaw) => {
		const step = steps[stepKey];
		step.ok = true;
		step.skipped = true;
		step.message = String(messageRaw == null ? "" : messageRaw).trim();
		stepDurationMs[stepKey] = 0;
		if (stepKey === "stats") step.partialFailure = false;
	};

	// Execute one step and restore pre-step data if it throws or reports failure.
	const runStepWithRollback = (stepKey, stepLabelRaw, stepFn) => {
		const step = steps[stepKey];
		const stepLabel = String(stepLabelRaw == null ? "" : stepLabelRaw).trim() || "pipeline";
		const includeAllRosters = stepKey === "pool";
		const includePlayerMetrics = stepKey === "stats" && !pipelinePrefetchOptions.autoRefreshFinalValidationMode;
		const rollbackCloneStartMs = Date.now();
		const rollbackSnapshot = snapshotRefreshStepRollbackState_(rosterData, rosterId, includePlayerMetrics, includeAllRosters);
		const rollbackCloneMs = Math.max(0, Date.now() - rollbackCloneStartMs);
		rollbackCloneDurationMs += rollbackCloneMs;
		if (rollbackCloneMs >= 25) {
			Logger.log(
				"refreshRosterPipeline rollbackClone rosterId=%s step=%s cloneMs=%s includeAllRosters=%s includePlayerMetrics=%s autoRefreshFinalValidationMode=%s",
				rosterId,
				stepKey,
				rollbackCloneMs,
				includeAllRosters,
				includePlayerMetrics,
				pipelinePrefetchOptions.autoRefreshFinalValidationMode === true,
			);
		}
		const stepStartMs = Date.now();
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
						failureRosterData = finalizeRefreshStepRosterDataForReturn_(stepResult.rosterData, pipelinePrefetchOptions, stepLabel + " failure");
					} catch (validationErr) {
						failureRosterValidationErr = validationErr;
					}
				}
				if (failureRosterData) {
					rosterData = failureRosterData;
				} else {
					rosterData = restoreRefreshStepRollbackState_(rosterData, rollbackSnapshot);
				}
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
				stepDurationMs[stepKey] = Math.max(0, Date.now() - stepStartMs);
				addIssue(stepLabel, detailedMessage);
				return false;
			}

			if (stepResult && stepResult.rosterData) {
				// Refresh-all already crossed the validation boundary; standalone callers stay defensive.
				rosterData = skipInitialValidation ? stepResult.rosterData : validateRosterData_(stepResult.rosterData);
			}
			touchPipelineLockLease();
			step.ok = true;
			step.skipped = false;
			step.result = stepResult && stepResult.result && typeof stepResult.result === "object" ? stepResult.result : null;
			step.message = String(step.result && step.result.message != null ? step.result.message : "").trim();
			if (stepKey === "stats") step.partialFailure = false;
			stepDurationMs[stepKey] = Math.max(0, Date.now() - stepStartMs);
			return true;
		} catch (err) {
			// Unexpected exceptions always roll back the fragments this step owns.
			const detailedMessage = appendDuplicateRosterTagDetailsToError_(stepLabel, err, rosterData);
			rosterData = restoreRefreshStepRollbackState_(rosterData, rollbackSnapshot);
			step.ok = false;
			step.skipped = false;
			step.message = detailedMessage;
			if (stepKey === "stats") step.partialFailure = false;
			stepDurationMs[stepKey] = Math.max(0, Date.now() - stepStartMs);
			addIssue(stepLabel, detailedMessage);
			return false;
		}
	};

	// Finalization-only runs keep the full payload loaded but only touch regular-war stats/history.
	if (pipelinePrefetchOptions.statsOnlyRegularWarFinalization) {
		if (!initialRoster) {
			const notFoundMessage = "Roster not found in current refresh payload.";
			steps.pool.message = notFoundMessage;
			addIssue("pipeline", notFoundMessage);
			markIntentionalSkip("modeTransition", "finalization-only mode skipped: roster not found");
			markSkippedAfterFailedStep("lineup", initialLineupStepLabel, "finalization-only roster lookup");
			markSkippedAfterFailedStep("stats", initialStatsStepLabel, "finalization-only roster lookup");
			markSkippedAfterFailedStep("bench", benchStepLabel, "finalization-only roster lookup");
		} else if (initialTrackingMode !== "regularWar") {
			markIntentionalSkip("pool", "finalization-only mode skipped pool sync");
			markIntentionalSkip("modeTransition", "finalization-only mode skipped tracking-mode detection");
			markIntentionalSkip("lineup", "finalization-only mode skipped lineup sync");
			markIntentionalSkip("stats", "finalization-only mode skipped: roster is not in regular-war mode");
			markIntentionalSkip("bench", "finalization-only mode skipped bench planning");
		} else {
			markIntentionalSkip("pool", "finalization-only mode skipped pool sync");
			markIntentionalSkip("modeTransition", "finalization-only mode skipped tracking-mode detection");
			markIntentionalSkip("lineup", "finalization-only mode skipped lineup sync");
			runStepWithRollback("stats", "refresh tracking stats", () => refreshTrackingStatsCore_(rosterData, rosterId, pipelinePrefetchOptions));
			markIntentionalSkip("bench", "finalization-only mode skipped bench planning");
		}
	} else if (!initialRoster) {
		// Branch once on roster existence, then execute the normal pipeline in dependency order.
		const notFoundMessage = "Roster not found in current refresh payload.";
		steps.pool.message = notFoundMessage;
		addIssue("pipeline", notFoundMessage);
		markIntentionalSkip("modeTransition", "automatic tracking-mode detection skipped: roster not found");
		markSkippedAfterFailedStep("lineup", initialLineupStepLabel, poolStepLabel);
		markSkippedAfterFailedStep("stats", initialStatsStepLabel, poolStepLabel);
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
			runStepWithRollback("pool", poolStepLabel, () =>
				syncClanRosterPoolCore_(
					rosterData,
					rosterId,
					Object.assign({}, pipelinePrefetchOptions, { ownershipSnapshot: ownershipSnapshot }),
				),
			);
		}

		const poolStepOk = !!steps.pool.ok;
		if (!hasConnectedClanTag) {
			markIntentionalSkip("modeTransition", "automatic tracking-mode detection skipped: connected clan tag missing");
		} else if (!poolStepOk) {
			markIntentionalSkip("modeTransition", "automatic tracking-mode detection skipped: roster pool sync did not complete");
		} else {
			runStepWithRollback("modeTransition", modeTransitionStepLabel, () => detectAndApplyAutomaticTrackingModeTransition_(rosterData, rosterId, pipelinePrefetchOptions));
		}

		const modeTransitionStepOk = !!steps.modeTransition.ok;
		const trackingModeForLineup = getCurrentTrackingMode();
		const lineupStepLabel = getLineupStepLabel();
		// CWL Preparation Mode deliberately freezes live lineup imports until the roster is finalized.
		if (trackingModeForLineup === "cwl" && isCwlPreparationActiveForCurrentRoster()) {
			markIntentionalSkip("lineup", "live CWL lineup sync blocked by CWL Preparation Mode");
		} else if (!hasConnectedClanTag || !poolStepOk || !modeTransitionStepOk) {
			markSkippedAfterFailedStep("lineup", lineupStepLabel, !poolStepOk || !hasConnectedClanTag ? poolStepLabel : modeTransitionStepLabel);
		} else {
			runStepWithRollback("lineup", lineupStepLabel, () => syncClanTodayLineupCore_(rosterData, rosterId, pipelinePrefetchOptions));
		}

		const lineupStepOk = !!steps.lineup.ok;
		const trackingModeForStats = getCurrentTrackingMode();
		const statsStepLabel = getStatsStepLabel();
		// Regular-war mode can still refresh historical stats when lineup sync fails.
		const allowStatsWithoutLineup = trackingModeForStats === "regularWar";
		if (!hasConnectedClanTag || !poolStepOk || !modeTransitionStepOk || (!lineupStepOk && !allowStatsWithoutLineup)) {
			const failedStepLabel = !poolStepOk || !hasConnectedClanTag ? poolStepLabel : !modeTransitionStepOk ? modeTransitionStepLabel : lineupStepLabel;
			markSkippedAfterFailedStep("stats", statsStepLabel, failedStepLabel);
		} else {
			if (!lineupStepOk && allowStatsWithoutLineup) {
				Logger.log(
					"refreshRosterPipeline: roster '%s' running regular-war stats despite lineup sync issue so finalization/repair work can proceed when needed.",
					rosterId,
				);
			}
			runStepWithRollback("stats", statsStepLabel, () => refreshTrackingStatsCore_(rosterData, rosterId, pipelinePrefetchOptions));
		}

		const statsStepOk = !!steps.stats.ok;
		const statsResult = steps.stats.result && typeof steps.stats.result === "object" ? steps.stats.result : {};
		const trackingModeForBench = getCurrentTrackingMode();
		// If no active CWL exists and nothing changed, bench planning would only churn stale output.
		const skipBenchForNoActiveCwl = trackingModeForBench === "cwl" && statsStepOk && !!statsResult.cwlUnavailable && !!statsResult.statsUnchanged;
		if (trackingModeForBench !== "cwl") {
			markIntentionalSkip("bench", "bench suggestions are disabled for regular war rosters");
		} else if (isCwlPreparationActiveForCurrentRoster()) {
			markIntentionalSkip("bench", "bench suggestions disabled during CWL Preparation Mode");
		} else if (!hasConnectedClanTag || !poolStepOk || !modeTransitionStepOk || !lineupStepOk || !statsStepOk) {
			const failedStepLabel = !poolStepOk || !hasConnectedClanTag ? poolStepLabel : !modeTransitionStepOk ? modeTransitionStepLabel : !lineupStepOk ? lineupStepLabel : statsStepLabel;
			markSkippedAfterFailedStep("bench", benchStepLabel, failedStepLabel);
		} else if (skipBenchForNoActiveCwl) {
			markIntentionalSkip("bench", "compute bench suggestions skipped: no active CWL available");
		} else {
			runStepWithRollback("bench", benchStepLabel, () => computeBenchSuggestionsCore_(rosterData, rosterId, pipelinePrefetchOptions));
		}
	}

	// Refresh-all keeps the payload trusted between roster pipelines and validates once at final output.
	let validatedRosterData = rosterData;
	if (!skipInitialValidation) {
		try {
			touchPipelineLockLease();
			validatedRosterData = validateRosterData_(rosterData);
		} catch (err) {
			throw new Error(appendDuplicateRosterTagDetailsToError_("finalize refresh pipeline payload", err, rosterData));
		}
	}
	const finalRoster = findRosterInDataById_(validatedRosterData, rosterId);
	// Use the final roster state in case a step changed the tracking mode.
	const finalTrackingMode = finalRoster ? getRosterTrackingMode_(finalRoster) : initialTrackingMode;
	const partialFailure = !!steps.stats.partialFailure;
	const hasIssues = issues.length > 0;
	const totalPipelineDurationMs = Math.max(0, Date.now() - rosterPipelineStartMs);
	Logger.log(
		"refreshRosterPipeline timing rosterId=%s trackingMode=%s poolMs=%s modeTransitionMs=%s lineupMs=%s statsMs=%s benchMs=%s rollbackCloneMs=%s totalMs=%s statsPartialFailure=%s hasIssues=%s autoRefreshFinalValidationMode=%s",
		rosterId,
		finalTrackingMode,
		stepDurationMs.pool,
		stepDurationMs.modeTransition,
		stepDurationMs.lineup,
		stepDurationMs.stats,
		stepDurationMs.bench,
		rollbackCloneDurationMs,
		totalPipelineDurationMs,
		partialFailure,
		hasIssues,
		pipelinePrefetchOptions.autoRefreshFinalValidationMode === true,
	);
	return {
		ok: !hasIssues,
		rosterData: validatedRosterData,
		result: {
			rosterId: rosterId,
			rosterName: rosterName,
			trackingMode: finalTrackingMode,
			partialFailure: partialFailure,
			issues: issues,
			steps: steps,
			rollbackCloneMs: rollbackCloneDurationMs,
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

// Flatten AutoRefreshSnapshot into the option shape expected by per-roster pipeline calls.
function buildAutoRefreshPipelineSnapshotOptions_(snapshotRaw) {
	const snapshot = snapshotRaw && typeof snapshotRaw === "object" ? snapshotRaw : {};
	// Default every branch to an object so downstream code can use plain property checks.
	return {
		prefetchedClanSnapshotsByTag:
			snapshot.clanMembersSnapshotByTag && typeof snapshot.clanMembersSnapshotByTag === "object" ? snapshot.clanMembersSnapshotByTag : {},
		prefetchedClanErrorsByTag: snapshot.clanMembersErrorByTag && typeof snapshot.clanMembersErrorByTag === "object" ? snapshot.clanMembersErrorByTag : {},
		prefetchedCurrentRegularWarByClanTag:
			snapshot.currentRegularWarByClanTag && typeof snapshot.currentRegularWarByClanTag === "object" ? snapshot.currentRegularWarByClanTag : {},
		prefetchedRegularWarErrorByClanTag:
			snapshot.currentRegularWarErrorByClanTag && typeof snapshot.currentRegularWarErrorByClanTag === "object" ? snapshot.currentRegularWarErrorByClanTag : {},
		prefetchedLeaguegroupRawByClanTag: snapshot.leaguegroupRawByClanTag && typeof snapshot.leaguegroupRawByClanTag === "object" ? snapshot.leaguegroupRawByClanTag : {},
		prefetchedLeaguegroupErrorByClanTag:
			snapshot.leaguegroupErrorByClanTag && typeof snapshot.leaguegroupErrorByClanTag === "object" ? snapshot.leaguegroupErrorByClanTag : {},
		prefetchedCwlWarRawByTag: snapshot.cwlWarRawByTag && typeof snapshot.cwlWarRawByTag === "object" ? snapshot.cwlWarRawByTag : {},
		prefetchedCwlWarErrorByTag: snapshot.cwlWarErrorByTag && typeof snapshot.cwlWarErrorByTag === "object" ? snapshot.cwlWarErrorByTag : {},
		cwlCoordinatorResult: snapshot.cwlCoordinator && typeof snapshot.cwlCoordinator === "object" ? snapshot.cwlCoordinator : null,
		prefetchedRegularWarLogByClanTag:
			snapshot.regularWarLogByClanTag && typeof snapshot.regularWarLogByClanTag === "object" ? snapshot.regularWarLogByClanTag : {},
		prefetchedRegularWarLogErrorByClanTag:
			snapshot.regularWarLogErrorByClanTag && typeof snapshot.regularWarLogErrorByClanTag === "object" ? snapshot.regularWarLogErrorByClanTag : {},
		autoRefreshSnapshotMode: true,
	};
}

// Build a shared ownership snapshot once so pool sync can avoid redundant lookups.
function buildRefreshAllOwnershipSnapshot_(rosterData, snapshotRaw) {
	const snapshot = snapshotRaw && typeof snapshotRaw === "object" ? snapshotRaw : {};
	// This snapshot is read-only input for pool sync, not a metrics-writing pass.
	return buildLiveRosterOwnershipSnapshot_(rosterData, {
		recordMetrics: false,
		prefetchedClanSnapshotsByTag: snapshot.clanMembersSnapshotByTag && typeof snapshot.clanMembersSnapshotByTag === "object" ? snapshot.clanMembersSnapshotByTag : {},
		prefetchedClanErrorsByTag: snapshot.clanMembersErrorByTag && typeof snapshot.clanMembersErrorByTag === "object" ? snapshot.clanMembersErrorByTag : {},
		autoRefreshSnapshotMode: true,
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

// Build the stable roster iteration plan shared by synchronous and resumable refresh-all.
function buildRefreshAllRosterRunPlan_(rosterDataRaw, optionsRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const sourceRosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	const requestedRosterIdSet = {};
	const requestedRosterIdsRaw = Array.isArray(options.rosterIds) ? options.rosterIds : [];
	for (let i = 0; i < requestedRosterIdsRaw.length; i++) {
		const requestedRosterId = String(requestedRosterIdsRaw[i] == null ? "" : requestedRosterIdsRaw[i]).trim();
		if (!requestedRosterId) continue;
		requestedRosterIdSet[requestedRosterId] = true;
	}
	const hasRequestedRosterFilter = Object.keys(requestedRosterIdSet).length > 0;
	const rosterIds = [];
	const targetedSourceRosters = [];
	// Freeze the roster iteration order up front so later mutations do not affect coverage.
	for (let i = 0; i < sourceRosters.length; i++) {
		const roster = sourceRosters[i] && typeof sourceRosters[i] === "object" ? sourceRosters[i] : {};
		const rosterId = String(roster.id || "").trim();
		if (!rosterId) continue;
		if (hasRequestedRosterFilter && !requestedRosterIdSet[rosterId]) continue;
		rosterIds.push(rosterId);
		targetedSourceRosters.push(roster);
	}
	return {
		sourceRosters: sourceRosters,
		targetedSourceRosters: targetedSourceRosters,
		rosterIds: rosterIds,
		hasRequestedRosterFilter: hasRequestedRosterFilter,
		statsOnlyRegularWarFinalization: options.statsOnlyRegularWarFinalization === true,
	};
}

// Create aggregate refresh-all result state.
function createRefreshAllAccumulator_() {
	return {
		issues: [],
		perRoster: [],
		processedRosters: 0,
		rostersWithIssues: 0,
		rosterPipelineCumulativeMs: 0,
		rollbackCloneCumulativeMs: 0,
	};
}

// Rehydrate aggregate result state from a persisted job.
function buildRefreshAllAccumulatorFromJob_(jobStateRaw) {
	const job = jobStateRaw && typeof jobStateRaw === "object" ? jobStateRaw : {};
	return {
		issues: Array.isArray(job.issues) ? job.issues : [],
		perRoster: Array.isArray(job.perRoster) ? job.perRoster : [],
		processedRosters: toNonNegativeInt_(job.processedRosters),
		rostersWithIssues: toNonNegativeInt_(job.rostersWithIssues),
		rosterPipelineCumulativeMs: toNonNegativeInt_(job.timings && job.timings.rosterPipelineCumulativeMs),
		rollbackCloneCumulativeMs: toNonNegativeInt_(job.timings && job.timings.rollbackCloneCumulativeMs),
	};
}

// Persist aggregate result state back into a resumable job.
function applyRefreshAllAccumulatorToJob_(jobStateRaw, accumulatorRaw) {
	const job = jobStateRaw && typeof jobStateRaw === "object" ? jobStateRaw : {};
	const accumulator = accumulatorRaw && typeof accumulatorRaw === "object" ? accumulatorRaw : createRefreshAllAccumulator_();
	if (!job.timings || typeof job.timings !== "object") job.timings = {};
	job.issues = Array.isArray(accumulator.issues) ? accumulator.issues : [];
	job.perRoster = Array.isArray(accumulator.perRoster) ? accumulator.perRoster : [];
	job.processedRosters = toNonNegativeInt_(accumulator.processedRosters);
	job.rostersWithIssues = toNonNegativeInt_(accumulator.rostersWithIssues);
	job.timings.rosterPipelineCumulativeMs = toNonNegativeInt_(accumulator.rosterPipelineCumulativeMs);
	job.timings.rollbackCloneCumulativeMs = toNonNegativeInt_(accumulator.rollbackCloneCumulativeMs);
	return job;
}

// Run one roster pipeline and append its diagnostics to an aggregate refresh-all result.
function processRefreshAllRosterPipelineIntoAccumulator_(rosterDataRaw, rosterIdRaw, pipelineOptionsRaw, accumulatorRaw) {
	let rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	const accumulator = accumulatorRaw && typeof accumulatorRaw === "object" ? accumulatorRaw : createRefreshAllAccumulator_();
	const rosterPipelineStartMs = Date.now();
	accumulator.processedRosters = toNonNegativeInt_(accumulator.processedRosters) + 1;
	const currentRoster = findRosterInDataById_(rosterData, rosterId);
	const rosterTitle = String((currentRoster && currentRoster.title) || "").trim();
	const rosterName = rosterTitle || rosterId;
	const rosterIssues = [];
	let pipelineResult = {};
	let partialFailure = false;
	let trackingMode = getRosterTrackingMode_(currentRoster);
	try {
		const pipelineRun = runRosterRefreshPipelineCore_(rosterData, rosterId, pipelineOptionsRaw);
		if (pipelineRun && pipelineRun.rosterData) {
			// Carry forward each successful roster mutation into the next pipeline run.
			rosterData = pipelineRun.rosterData;
		}
		pipelineResult = pipelineRun && pipelineRun.result && typeof pipelineRun.result === "object" ? pipelineRun.result : {};
		partialFailure = pipelineResult.partialFailure === true;
		accumulator.rollbackCloneCumulativeMs = toNonNegativeInt_(accumulator.rollbackCloneCumulativeMs) + toNonNegativeInt_(pipelineResult.rollbackCloneMs);
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
			accumulator.issues.push(issue);
		}
		if (pipelineIssues.length < 1 && pipelineRun && pipelineRun.ok === false) {
			// Preserve a minimal issue even if the step-level issue list came back empty.
			const issue = {
				rosterId: rosterId,
				rosterName: rosterName,
				step: "pipeline",
				message: "refresh pipeline failed.",
			};
			rosterIssues.push(issue);
			accumulator.issues.push(issue);
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
			accumulator.issues.push(issue);
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
		accumulator.issues.push(issue);
	}
	const rosterPipelineMs = Math.max(0, Date.now() - rosterPipelineStartMs);
	accumulator.rosterPipelineCumulativeMs = toNonNegativeInt_(accumulator.rosterPipelineCumulativeMs) + rosterPipelineMs;
	const rosterHasIssues = rosterIssues.length > 0 || partialFailure;
	if (rosterHasIssues) accumulator.rostersWithIssues = toNonNegativeInt_(accumulator.rostersWithIssues) + 1;
	const rosterMessage = buildRefreshAllRosterResultMessage_(pipelineResult, rosterIssues);
	// Store both the summary row and the underlying issue list for the caller.
	accumulator.perRoster.push({
		rosterId: rosterId,
		rosterName: rosterName,
		trackingMode: trackingMode,
		ok: !rosterHasIssues,
		partialFailure: partialFailure,
		issueCount: rosterIssues.length,
		message: rosterMessage,
		issues: rosterIssues,
	});
	return {
		rosterData: rosterData,
		rosterPipelineMs: rosterPipelineMs,
		pipelineResult: pipelineResult,
		rosterIssues: rosterIssues,
		partialFailure: partialFailure,
	};
}

// Build the public refresh-all result shape from aggregate state and final roster data.
function buildRefreshAllRunResultFromAccumulator_(validatedRosterData, accumulatorRaw) {
	const accumulator = accumulatorRaw && typeof accumulatorRaw === "object" ? accumulatorRaw : createRefreshAllAccumulator_();
	const issues = Array.isArray(accumulator.issues) ? accumulator.issues : [];
	return {
		ok: issues.length < 1,
		rosterData: validatedRosterData,
		processedRosters: toNonNegativeInt_(accumulator.processedRosters),
		rostersWithIssues: toNonNegativeInt_(accumulator.rostersWithIssues),
		issueCount: issues.length,
		issues: issues,
		issueSummary: buildAutoRefreshIssueSummary_(issues),
		summary: buildRefreshAllRunSummary_(accumulator.processedRosters, accumulator.rostersWithIssues, issues.length),
		perRoster: Array.isArray(accumulator.perRoster) ? accumulator.perRoster : [],
	};
}

// Run refresh pipeline for every roster (expects caller already holds the job lock).
function runRefreshAllRostersUnlockedCore_(rosterDataRaw, optionsRaw) {
	let rosterData = null;
	const totalStartMs = Date.now();
	let snapshotDurationMs = 0;
	let ownershipSnapshotDurationMs = 0;
	let cumulativeRosterPipelineDurationMs = 0;
	let cumulativeRollbackCloneDurationMs = 0;
	let finalValidationDurationMs = 0;
	try {
		rosterData = validateRosterData_(rosterDataRaw);
	} catch (err) {
		rethrowWithDuplicateRosterTagDetails_("initialize refresh payload", err, rosterDataRaw);
	}
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const metricsRunState = options.metricsRunState && typeof options.metricsRunState === "object" ? options.metricsRunState : {};
	const autoRefreshFinalValidationMode = true;
	// Ensure mutable run-state containers exist for cross-roster metrics reuse.
	if (!metricsRunState.seenClanTags || typeof metricsRunState.seenClanTags !== "object") metricsRunState.seenClanTags = {};
	const runPlan = buildRefreshAllRosterRunPlan_(rosterData, options);
	const accumulator = createRefreshAllAccumulator_();
	// Capture all Clash API reads needed by refresh-all before per-roster mutation starts.
	touchActiveRosterLockLease_("refresh all snapshot");
	const snapshotStartMs = Date.now();
	const autoRefreshSnapshot = buildAutoRefreshSnapshot_(rosterData, {
		sourceRosters: runPlan.hasRequestedRosterFilter ? runPlan.targetedSourceRosters : runPlan.sourceRosters,
		allowRegularWarHistoryRepair: options.allowRegularWarHistoryRepair !== false,
	});
	snapshotDurationMs = Math.max(0, Date.now() - snapshotStartMs);
	const pipelinePrefetchOptions = buildAutoRefreshPipelineSnapshotOptions_(autoRefreshSnapshot);
	const ownershipSnapshotStartMs = Date.now();
	const ownershipSnapshot = runPlan.statsOnlyRegularWarFinalization
		? null
		: buildRefreshAllOwnershipSnapshot_(rosterData, autoRefreshSnapshot);
	ownershipSnapshotDurationMs = Math.max(0, Date.now() - ownershipSnapshotStartMs);
	const pipelineOptions = Object.assign(
		{
			ownershipSnapshot: ownershipSnapshot,
			skipInitialValidation: true,
			metricsRunState: metricsRunState,
			allowRegularWarHistoryRepair: options.allowRegularWarHistoryRepair !== false,
			allowRegularWarProvisionalFallback: options.allowRegularWarProvisionalFallback === true,
			statsOnlyRegularWarFinalization: runPlan.statsOnlyRegularWarFinalization,
			autoRefreshFinalValidationMode: autoRefreshFinalValidationMode,
		},
		pipelinePrefetchOptions,
	);

	// Execute the same single-roster pipeline for each id and aggregate diagnostics.
	for (let i = 0; i < runPlan.rosterIds.length; i++) {
		touchActiveRosterLockLease_("refresh all roster " + (i + 1) + "/" + runPlan.rosterIds.length);
		const processed = processRefreshAllRosterPipelineIntoAccumulator_(rosterData, runPlan.rosterIds[i], pipelineOptions, accumulator);
		rosterData = processed.rosterData;
	}
	cumulativeRosterPipelineDurationMs = toNonNegativeInt_(accumulator.rosterPipelineCumulativeMs);
	cumulativeRollbackCloneDurationMs = toNonNegativeInt_(accumulator.rollbackCloneCumulativeMs);

	// Validate once after the loop so callers receive a safe final payload snapshot.
	let validatedRosterData = null;
	const finalValidationStartMs = Date.now();
	try {
		validatedRosterData = validateRosterData_(rosterData);
	} catch (err) {
		throw new Error(appendDuplicateRosterTagDetailsToError_("finalize refresh payload", err, rosterData));
	}
	finalValidationDurationMs = Math.max(0, Date.now() - finalValidationStartMs);
	const cwlSeasonEventRefresh =
		typeof tryRefreshCurrentCwlSeasonEventFromSnapshot_ === "function"
			? tryRefreshCurrentCwlSeasonEventFromSnapshot_(validatedRosterData, autoRefreshSnapshot, { source: "refresh-all" })
			: { ok: true, status: "unavailable" };
	const totalDurationMs = Math.max(0, Date.now() - totalStartMs);
	Logger.log(
		"refreshAllRosters timing totalMs=%s snapshotMs=%s ownershipSnapshotMs=%s rosterPipelineCumulativeMs=%s rollbackCloneCumulativeMs=%s finalValidationMs=%s rosters=%s targeted=%s autoRefreshFinalValidationMode=%s",
		totalDurationMs,
		snapshotDurationMs,
		ownershipSnapshotDurationMs,
		cumulativeRosterPipelineDurationMs,
		cumulativeRollbackCloneDurationMs,
		finalValidationDurationMs,
		accumulator.processedRosters,
		runPlan.hasRequestedRosterFilter,
		autoRefreshFinalValidationMode,
	);

	const runResult = buildRefreshAllRunResultFromAccumulator_(validatedRosterData, accumulator);
	runResult.cwlSeasonEventRefresh = cwlSeasonEventRefresh;
	return runResult;
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
