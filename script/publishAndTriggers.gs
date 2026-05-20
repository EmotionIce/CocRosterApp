// Publish flow and auto-refresh trigger orchestration.

// Handle write published roster data.
function writePublishedRosterData_(rosterDataRaw) {
	const publishedAt = new Date().toISOString();
	let validationStepLabel = "prepare publish payload";
	let duplicateDiagnosticsRosterData = rosterDataRaw;
	let validated = null;

	try {
		validationStepLabel = "set publish timestamp";
		validated = withRosterLastUpdatedAt_(rosterDataRaw, publishedAt);
		duplicateDiagnosticsRosterData = validated;

		let activeSourceSnapshot = null;
		let activeData = null;
		try {
			activeSourceSnapshot = readActiveRosterSnapshot_();
			activeData = activeSourceSnapshot && activeSourceSnapshot.rosterData ? activeSourceSnapshot.rosterData : null;
		} catch (err) {
			Logger.log("publishRosterData: unable to read current active roster snapshot from Firebase: %s", errorMessage_(err));
		}

		// Protect against accidental metric loss when preview payload has no real Clash metrics.
		const incomingMetricDataCount = countPlayerMetricDataEntries_(validated && validated.playerMetrics);
		if (incomingMetricDataCount < 1) {
			try {
				const activeMetricDataCount = countPlayerMetricDataEntries_(activeData && activeData.playerMetrics);
				if (activeMetricDataCount > 0) {
					validated.playerMetrics = sanitizePlayerMetricsStore_(activeData.playerMetrics, publishedAt);
					validationStepLabel = "validate payload after metrics preservation";
					validated = validateRosterData_(validated);
					duplicateDiagnosticsRosterData = validated;
					Logger.log("publishRosterData: preserved existing playerMetrics (metricDataEntries=%s) because incoming payload had no real metric data.", activeMetricDataCount);
				}
			} catch (err) {
				Logger.log("publishRosterData: unable to preserve existing playerMetrics fallback: %s", errorMessage_(err));
			}
		}

		const effectiveMetricDataCount = countPlayerMetricDataEntries_(validated && validated.playerMetrics);
		const lowCoverageRosters = effectiveMetricDataCount > 0 ? listRostersNeedingMetricsCoverageRepair_(validated, PLAYER_METRICS_MIN_ROSTER_COVERAGE_FOR_PUBLISH) : [];
		if (lowCoverageRosters.length > 0) {
			Logger.log(
				"publishRosterData: detected %s roster(s) below metrics coverage threshold %.2f; running targeted recapture.",
				lowCoverageRosters.length,
				PLAYER_METRICS_MIN_ROSTER_COVERAGE_FOR_PUBLISH,
			);
		}

		// Do publish-time capture when payload has no metric data, or when one/more rosters have low metrics coverage.
		const shouldRunPublishMetricsCapture = effectiveMetricDataCount < 1 || lowCoverageRosters.length > 0;
		if (shouldRunPublishMetricsCapture) {
			try {
				const rosters = Array.isArray(validated && validated.rosters) ? validated.rosters : [];
				const rosterCaptureQueue = [];
				if (effectiveMetricDataCount < 1) {
					for (let i = 0; i < rosters.length; i++) {
						const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
						const rosterId = String(roster.id == null ? "" : roster.id).trim();
						const clanTag = normalizeTag_(roster.connectedClanTag);
						if (!rosterId || !clanTag) continue;
						rosterCaptureQueue.push({ rosterId: rosterId, clanTag: clanTag, reason: "emptyMetricsStore" });
					}
				} else {
					for (let i = 0; i < lowCoverageRosters.length; i++) {
						const item = lowCoverageRosters[i] && typeof lowCoverageRosters[i] === "object" ? lowCoverageRosters[i] : {};
						const rosterId = String(item.rosterId == null ? "" : item.rosterId).trim();
						if (!rosterId) continue;
						rosterCaptureQueue.push({ rosterId: rosterId, clanTag: normalizeTag_(item.clanTag), reason: "lowCoverage" });
					}
				}

				let attemptedClans = 0;
				let capturedClans = 0;
				let recorded = 0;
				let updated = 0;
				const errors = [];

				for (let i = 0; i < rosterCaptureQueue.length; i++) {
					const item = rosterCaptureQueue[i] && typeof rosterCaptureQueue[i] === "object" ? rosterCaptureQueue[i] : {};
					const rosterId = String(item.rosterId == null ? "" : item.rosterId).trim();
					const clanTag = normalizeTag_(item.clanTag);
					if (!rosterId) continue;
					attemptedClans++;
					try {
						const capture = captureMemberTrackingForRoster_(validated, rosterId, {
							continueOnError: true,
						});
						if (capture) {
							capturedClans += toNonNegativeInt_(capture.capturedClans) > 0 ? 1 : 0;
							recorded += toNonNegativeInt_(capture.recorded);
							updated += toNonNegativeInt_(capture.updated);
							if (Array.isArray(capture.errors) && capture.errors.length) {
								for (let j = 0; j < capture.errors.length; j++) {
									errors.push(capture.errors[j]);
								}
							}
						}
					} catch (err) {
						errors.push({ clanTag: clanTag, message: errorMessage_(err) });
					}
				}

				validationStepLabel = "validate payload after metrics recapture";
				validated = validateRosterData_(validated);
				duplicateDiagnosticsRosterData = validated;
				Logger.log(
					"publishRosterData metrics capture attempted=%s captured=%s recorded=%s updated=%s entries=%s metricDataEntries=%s errors=%s repairedRosters=%s",
					attemptedClans,
					capturedClans,
					recorded,
					updated,
					countPlayerMetricsEntries_(validated && validated.playerMetrics),
					countPlayerMetricDataEntries_(validated && validated.playerMetrics),
					errors.length,
					lowCoverageRosters.length,
				);
			} catch (err) {
				Logger.log("publishRosterData: fallback metrics capture failed: %s", errorMessage_(err));
			}
		} else {
			Logger.log("publishRosterData: skipped live metrics capture because incoming payload already has %s metric data entries.", effectiveMetricDataCount);
		}

		const discordCanonicalized = canonicalizeDiscordIdentityForRosterData_(validated, {
			sourceRosterData: activeData,
			updatedAt: publishedAt,
			source: ACTIVE_DATA_WRITE_SOURCE_PUBLISH,
			allowRosterCacheUsernameUpdates: true,
		});
		if (discordCanonicalized && (discordCanonicalized.updatedCanonical || discordCanonicalized.updatedRosterCache)) {
			validationStepLabel = "validate payload after Discord identity canonicalization";
			validated = validateRosterData_(discordCanonicalized.rosterData);
			duplicateDiagnosticsRosterData = validated;
			Logger.log(
				"publishRosterData: canonicalized Discord identity preserved=%s migrated=%s hydrated=%s.",
				toNonNegativeInt_(discordCanonicalized.preservedFromSource),
				toNonNegativeInt_(discordCanonicalized.migratedFromRosterCache),
				toNonNegativeInt_(discordCanonicalized.hydratedRosterCache),
			);
		}

		const publishBackup = createPublishArchiveBackupFromSnapshot_(activeSourceSnapshot, publishedAt);
		validationStepLabel = "validate payload before active write";
		duplicateDiagnosticsRosterData = validated;
		replaceActiveRosterData_(validated, { sourceSnapshot: activeSourceSnapshot });
		const publishArchiveCleanupDeleted = cleanupPublishArchiveBackups_();

		const counts = countRosterPayload_(validated);
		const metricEntryCount = countPlayerMetricsEntries_(validated && validated.playerMetrics);
		const meta = {
			publishedAt: publishedAt,
			lastUpdatedAt: publishedAt,
			pageTitle: validated.pageTitle || "",
			rosterCount: Array.isArray(validated.rosters) ? validated.rosters.length : 0,
			playerCount: counts.playerCount,
			noteCount: counts.noteCount,
			metricEntryCount: metricEntryCount,
			publishArchiveCreated: !!publishBackup.created,
			publishArchiveKey: String(publishBackup.key || ""),
			publishArchiveCleanupDeleted: publishArchiveCleanupDeleted,
		};
		firebaseRequestJson_(FIREBASE_META_PATH, "PATCH", {
			layoutVersion: FIREBASE_LAYOUT_VERSION,
			lastPublishAt: publishedAt,
			lastPublishArchiveKey: meta.publishArchiveKey,
			lastPublishArchiveCleanupDeleted: publishArchiveCleanupDeleted,
		});
		Logger.log(
			"publishRosterData ok rosters=%s players=%s notes=%s metricEntries=%s backupCreated=%s backupKey=%s backupCleanupDeleted=%s",
			meta.rosterCount,
			counts.playerCount,
			counts.noteCount,
			metricEntryCount,
			meta.publishArchiveCreated,
			meta.publishArchiveKey,
			publishArchiveCleanupDeleted,
		);
		markActiveDataWriteSuccess_(publishedAt, ACTIVE_DATA_WRITE_SOURCE_PUBLISH);
		reconcileRegularWarFinalizationTriggerStateValidated_(validated);
		return meta;
	} catch (err) {
		rethrowWithDuplicateRosterTagDetails_(validationStepLabel, err, duplicateDiagnosticsRosterData);
	}
}

// Create the daily auto-refresh archive at most once per server day.
function maybeCreateAutoRefreshDailyArchive_(archiveDateRaw, validatedRosterData) {
	const archiveDate = String(archiveDateRaw == null ? "" : archiveDateRaw).trim();
	const props = PropertiesService.getScriptProperties();
	const lastArchiveDate = String(props.getProperty(AUTO_REFRESH_LAST_ARCHIVE_DATE_PROPERTY) || "").trim();
	if (archiveDate && archiveDate === lastArchiveDate) {
		return { attempted: false, created: false, existed: true, archiveDate: archiveDate };
	}
	const archiveStartMs = Date.now();
	Logger.log("autoRefresh write archive create start date=%s", archiveDate || "");
	try {
		const archiveResult = createAutoRefreshDailyArchiveIfNeeded_(archiveDate, validatedRosterData);
		if (archiveResult.archiveDate) {
			props.setProperty(AUTO_REFRESH_LAST_ARCHIVE_DATE_PROPERTY, archiveResult.archiveDate);
		}
		Logger.log(
			"autoRefresh write archive create done date=%s created=%s existed=%s durationMs=%s",
			String(archiveResult.archiveDate || archiveDate || ""),
			!!archiveResult.created,
			!!archiveResult.existed,
			Math.max(0, Date.now() - archiveStartMs),
		);
		return {
			attempted: true,
			created: !!archiveResult.created,
			existed: !!archiveResult.existed,
			archiveDate: String(archiveResult.archiveDate || archiveDate || ""),
		};
	} catch (err) {
		Logger.log(
			"autoRefresh write archive create done date=%s created=false existed=false durationMs=%s error=%s",
			archiveDate || "",
			Math.max(0, Date.now() - archiveStartMs),
			errorMessage_(err),
		);
		return { attempted: true, created: false, existed: false, archiveDate: archiveDate || "", error: errorMessage_(err) };
	}
}

// Clean stale auto-refresh archives no more than once per server day.
function maybeCleanupOldAutoRefreshDailyArchives_(cleanupDateRaw) {
	const cleanupDate = String(cleanupDateRaw == null ? "" : cleanupDateRaw).trim() || getServerDateString_(new Date());
	const props = PropertiesService.getScriptProperties();
	const lastCleanupDate = String(props.getProperty(AUTO_REFRESH_LAST_ARCHIVE_CLEANUP_DATE_PROPERTY) || "").trim();
	if (cleanupDate && cleanupDate === lastCleanupDate) {
		return { attempted: false, deletedCount: 0, cleanupDate: cleanupDate };
	}
	const cleanupStartMs = Date.now();
	Logger.log("autoRefresh write archive cleanup start date=%s", cleanupDate || "");
	let deletedCount = 0;
	let error = "";
	try {
		deletedCount = cleanupOldAutoRefreshDailyArchives_();
	} catch (err) {
		error = errorMessage_(err);
	}
	if (cleanupDate) {
		props.setProperty(AUTO_REFRESH_LAST_ARCHIVE_CLEANUP_DATE_PROPERTY, cleanupDate);
	}
	Logger.log(
		"autoRefresh write archive cleanup done date=%s deleted=%s durationMs=%s error=%s",
		cleanupDate || "",
		deletedCount,
		Math.max(0, Date.now() - cleanupStartMs),
		error,
	);
	return { attempted: true, deletedCount: deletedCount, cleanupDate: cleanupDate, error: error };
}

// Handle write auto refreshed active roster data from already-validated refresh-all output.
function writeAutoRefreshedActiveRosterData_(sourceSnapshotRaw, refreshedRosterDataRaw) {
	const sourceSnapshot = sourceSnapshotRaw && typeof sourceSnapshotRaw === "object" ? sourceSnapshotRaw : readActiveRosterSnapshot_();
	const sourceData = sourceSnapshot && sourceSnapshot.rosterData ? sourceSnapshot.rosterData : null;
	let refreshedData = refreshedRosterDataRaw && typeof refreshedRosterDataRaw === "object" ? refreshedRosterDataRaw : null;
	if (!sourceData || !refreshedData) {
		throw new Error("Auto-refresh write requires validated source and refreshed roster payloads.");
	}
	const discordCanonicalized = canonicalizeDiscordIdentityForRosterData_(refreshedData, {
		sourceRosterData: sourceData,
		updatedAt: String(refreshedData.lastUpdatedAt || sourceData.lastUpdatedAt || new Date().toISOString()),
		source: ACTIVE_DATA_WRITE_SOURCE_AUTO_REFRESH,
		allowRosterCacheUsernameUpdates: false,
	});
	if (discordCanonicalized && (discordCanonicalized.updatedCanonical || discordCanonicalized.updatedRosterCache)) {
		refreshedData = validateRosterData_(discordCanonicalized.rosterData);
		Logger.log(
			"autoRefresh write canonicalized Discord identity preserved=%s migrated=%s hydrated=%s",
			toNonNegativeInt_(discordCanonicalized.preservedFromSource),
			toNonNegativeInt_(discordCanonicalized.migratedFromRosterCache),
			toNonNegativeInt_(discordCanonicalized.hydratedRosterCache),
		);
	}
	const compareStartMs = Date.now();
	Logger.log("autoRefresh write compare start");
	const changed = hasActiveRosterPayloadChangedValidated_(sourceData, refreshedData);
	Logger.log("autoRefresh write compare done changed=%s durationMs=%s", changed, Math.max(0, Date.now() - compareStartMs));
	if (!changed) {
		const sourceCounts = countRosterPayload_(sourceData);
		return {
			changed: false,
			written: false,
			writtenAt: "",
			replacedCount: 0,
			playerCount: sourceCounts.playerCount,
			noteCount: sourceCounts.noteCount,
			rosterCount: Array.isArray(sourceData.rosters) ? sourceData.rosters.length : 0,
			archiveCreated: false,
			archiveDate: "",
			archiveCleanupDeleted: 0,
			rosterData: sourceData,
		};
	}

	const writtenAt = new Date().toISOString();
	const payloadToWrite = withValidatedRosterLastUpdatedAt_(refreshedData, writtenAt);
	const counts = countRosterPayload_(payloadToWrite);
	const activePutStartMs = Date.now();
	Logger.log("autoRefresh write active Firebase PUT start");
	const writeResult = putValidatedActiveRosterDataToFirebase_(payloadToWrite);
	Logger.log("autoRefresh write active Firebase PUT done durationMs=%s", Math.max(0, Date.now() - activePutStartMs));
	markActiveDataWriteSuccess_(writtenAt, ACTIVE_DATA_WRITE_SOURCE_AUTO_REFRESH);
	const cacheUpdateStartMs = Date.now();
	updateActiveRosterDataCaches_(writeResult.text);
	Logger.log("autoRefresh write cache update done durationMs=%s", Math.max(0, Date.now() - cacheUpdateStartMs));
	const archiveDate = getServerDateString_(new Date());
	const archiveResult = maybeCreateAutoRefreshDailyArchive_(archiveDate, payloadToWrite);
	const cleanupResult = maybeCleanupOldAutoRefreshDailyArchives_(archiveDate);
	const archiveCleanupDeleted = toNonNegativeInt_(cleanupResult && cleanupResult.deletedCount);
	const metaPatchStartMs = Date.now();
	firebaseRequestJson_(FIREBASE_META_PATH, "PATCH", {
		layoutVersion: FIREBASE_LAYOUT_VERSION,
		lastAutoRefreshWriteAt: writtenAt,
		lastAutoRefreshArchiveDate: String((archiveResult && archiveResult.archiveDate) || archiveDate || ""),
		lastAutoRefreshArchiveCleanupDeleted: archiveCleanupDeleted,
	});
	Logger.log("autoRefresh write meta patch done durationMs=%s", Math.max(0, Date.now() - metaPatchStartMs));

	return {
		changed: true,
		written: true,
		writtenAt: writtenAt,
		replacedCount: sourceSnapshot ? 1 : 0,
		playerCount: counts.playerCount,
		noteCount: counts.noteCount,
		rosterCount: Array.isArray(payloadToWrite.rosters) ? payloadToWrite.rosters.length : 0,
		archiveCreated: !!(archiveResult && archiveResult.created),
		archiveDate: String((archiveResult && archiveResult.archiveDate) || archiveDate || ""),
		archiveCleanupDeleted: archiveCleanupDeleted,
		rosterData: payloadToWrite,
	};
}

// Build auto refresh summary.
function buildAutoRefreshSummary_(runResult, writeResult) {
	const run = runResult && typeof runResult === "object" ? runResult : {};
	const write = writeResult && typeof writeResult === "object" ? writeResult : {};
	const baseSummary = buildRefreshAllRunSummary_(run.processedRosters, run.rostersWithIssues, run.issueCount);
	const changed = !!write.changed;
	if (!changed) {
		return baseSummary + " no active payload change.";
	}
	const rostersWritten = Math.max(0, toNonNegativeInt_(write.rosterCount));
	return baseSummary + " wrote " + rostersWritten + " roster(s).";
}

// Set auto refresh run result.
function setAutoRefreshRunResult_(statusRaw, summaryRaw, errorRaw, issueCountRaw, issueSummaryRaw, startedAtRaw, finishedAtRaw) {
	const status = String(statusRaw == null ? "" : statusRaw).trim() || "error";
	const summary = String(summaryRaw == null ? "" : summaryRaw)
		.trim()
		.slice(0, 500);
	const error = String(errorRaw == null ? "" : errorRaw)
		.trim()
		.slice(0, 2000);
	const issueSummary = String(issueSummaryRaw == null ? "" : issueSummaryRaw)
		.trim()
		.slice(0, 500);
	const issueCount = Math.max(0, toNonNegativeInt_(issueCountRaw));
	const startedAt = String(startedAtRaw == null ? "" : startedAtRaw).trim() || new Date().toISOString();
	const finishedAt = String(finishedAtRaw == null ? "" : finishedAtRaw).trim() || new Date().toISOString();
	const props = PropertiesService.getScriptProperties();
	props.setProperties(
		{
			[AUTO_REFRESH_LAST_RUN_STARTED_AT_PROPERTY]: startedAt,
			[AUTO_REFRESH_LAST_RUN_FINISHED_AT_PROPERTY]: finishedAt,
			[AUTO_REFRESH_LAST_RUN_STATUS_PROPERTY]: status,
			[AUTO_REFRESH_LAST_RUN_SUMMARY_PROPERTY]: summary,
			[AUTO_REFRESH_LAST_ISSUE_SUMMARY_PROPERTY]: issueSummary,
			[AUTO_REFRESH_LAST_RUN_ERROR_PROPERTY]: error,
			[AUTO_REFRESH_LAST_RUN_ISSUE_COUNT_PROPERTY]: String(issueCount),
		},
		false,
	);
}

// Return whether auto refresh enabled.
function isAutoRefreshEnabled_() {
	const raw = String(PropertiesService.getScriptProperties().getProperty(AUTO_REFRESH_ENABLED_PROPERTY) || "")
		.trim()
		.toLowerCase();
	return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

// Get trigger unique ID.
function getTriggerUniqueId_(trigger) {
	if (!trigger || typeof trigger !== "object" || typeof trigger.getUniqueId !== "function") return "";
	try {
		return String(trigger.getUniqueId() || "").trim();
	} catch (err) {
		return "";
	}
}

// Handle list auto refresh triggers.
function listAutoRefreshTriggers_() {
	const all = ScriptApp.getProjectTriggers();
	return all.filter((trigger) => {
		try {
			return String(trigger.getHandlerFunction() || "") === AUTO_REFRESH_HANDLER_NAME;
		} catch (err) {
			return false;
		}
	});
}

// Remove auto refresh triggers.
function removeAutoRefreshTriggers_() {
	const triggers = listAutoRefreshTriggers_();
	let removed = 0;
	for (let i = 0; i < triggers.length; i++) {
		try {
			ScriptApp.deleteTrigger(triggers[i]);
			removed++;
		} catch (err) {
			Logger.log("Unable to delete auto-refresh trigger: %s", errorMessage_(err));
		}
	}
	return removed;
}

// Ensure single auto refresh trigger.
function ensureSingleAutoRefreshTrigger_() {
	const props = PropertiesService.getScriptProperties();
	const configuredId = String(props.getProperty(AUTO_REFRESH_TRIGGER_ID_PROPERTY) || "").trim();
	const triggers = listAutoRefreshTriggers_();
	let keep = null;

	if (configuredId) {
		for (let i = 0; i < triggers.length; i++) {
			if (getTriggerUniqueId_(triggers[i]) === configuredId) {
				keep = triggers[i];
				break;
			}
		}
	}
	if (!keep && triggers.length) keep = triggers[0];

	const keepId = getTriggerUniqueId_(keep);
	for (let i = 0; i < triggers.length; i++) {
		const trigger = triggers[i];
		const triggerId = getTriggerUniqueId_(trigger);
		const isKeptTrigger = !!keep && ((keepId && triggerId === keepId) || (!keepId && trigger === keep));
		if (isKeptTrigger) continue;
		try {
			ScriptApp.deleteTrigger(trigger);
		} catch (err) {
			Logger.log("Unable to delete duplicate auto-refresh trigger: %s", errorMessage_(err));
		}
	}

	if (!keep) {
		keep = ScriptApp.newTrigger(AUTO_REFRESH_HANDLER_NAME).timeBased().everyHours(AUTO_REFRESH_INTERVAL_HOURS).create();
	}
	return keep;
}

// Handle reconcile auto refresh trigger state.
function reconcileAutoRefreshTriggerState_() {
	const props = PropertiesService.getScriptProperties();
	const enabled = isAutoRefreshEnabled_();
	if (!enabled) {
		removeAutoRefreshTriggers_();
		props.deleteProperty(AUTO_REFRESH_TRIGGER_ID_PROPERTY);
		return { enabled: false, triggerId: "", hasTrigger: false };
	}

	const trigger = ensureSingleAutoRefreshTrigger_();
	const triggerId = getTriggerUniqueId_(trigger);
	if (triggerId) props.setProperty(AUTO_REFRESH_TRIGGER_ID_PROPERTY, triggerId);
	else props.deleteProperty(AUTO_REFRESH_TRIGGER_ID_PROPERTY);
	return { enabled: true, triggerId: triggerId, hasTrigger: !!triggerId };
}

// Handle list regular-war finalization triggers.
function listRegularWarFinalizationTriggers_() {
	const all = ScriptApp.getProjectTriggers();
	return all.filter((trigger) => {
		try {
			return String(trigger.getHandlerFunction() || "") === REGULAR_WAR_FINALIZATION_HANDLER_NAME;
		} catch (err) {
			return false;
		}
	});
}

// Remove regular-war finalization triggers.
function removeRegularWarFinalizationTriggers_() {
	const triggers = listRegularWarFinalizationTriggers_();
	let removed = 0;
	for (let i = 0; i < triggers.length; i++) {
		try {
			ScriptApp.deleteTrigger(triggers[i]);
			removed++;
		} catch (err) {
			Logger.log("Unable to delete regular-war finalization trigger: %s", errorMessage_(err));
		}
	}
	return removed;
}

// Resolve a roster's next scheduled regular-war finalization time, including the live-war fallback.
function getRegularWarFinalizationDueAtForRoster_(rosterRaw) {
	const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
	const warPerformance = roster.warPerformance && typeof roster.warPerformance === "object" ? roster.warPerformance : {};
	const lifecycle = sanitizeRegularWarLifecycleState_(warPerformance.regularWarLifecycle);
	let dueAt = lifecycle.finalizationDueAt;
	if (!dueAt) {
		const regularWar = roster.regularWar && typeof roster.regularWar === "object" ? roster.regularWar : {};
		const currentWar = sanitizeRegularWarCurrentWar_(regularWar.currentWar);
		if ((currentWar.state === "preparation" || currentWar.state === "inwar") && currentWar.endTime) {
			dueAt = buildRegularWarFinalizationInitialDueAt_(currentWar.endTime);
		}
	}
	return String(dueAt || "");
}

// Find the next regular-war finalization attempt due across already-validated rosters.
function findNextRegularWarFinalizationDueAtValidated_(validatedRosterData) {
	const rosterData = validatedRosterData && typeof validatedRosterData === "object" ? validatedRosterData : {};
	const rosters = Array.isArray(rosterData && rosterData.rosters) ? rosterData.rosters : [];
	let earliestDueMs = 0;

	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		if (getRosterTrackingMode_(roster) !== "regularWar") continue;
		const dueAt = getRegularWarFinalizationDueAtForRoster_(roster);

		const dueMs = parseIsoToMs_(dueAt);
		if (!(dueMs > 0)) continue;
		if (!earliestDueMs || dueMs < earliestDueMs) earliestDueMs = dueMs;
	}

	return earliestDueMs > 0 ? new Date(earliestDueMs).toISOString() : "";
}

// Find the next regular-war finalization attempt due across active published rosters.
function findNextRegularWarFinalizationDueAt_(rosterDataRaw) {
	return findNextRegularWarFinalizationDueAtValidated_(validateRosterData_(rosterDataRaw));
}

// List regular-war roster ids whose scheduled authoritative finalization attempt is due now.
function listDueRegularWarRosterIdsValidated_(validatedRosterData, nowIsoRaw) {
	const rosterData = validatedRosterData && typeof validatedRosterData === "object" ? validatedRosterData : {};
	const nowMs = parseIsoToMs_(nowIsoRaw) || Date.now();
	const rosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	const dueRosterIds = [];
	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		if (getRosterTrackingMode_(roster) !== "regularWar") continue;
		const rosterId = String(roster.id == null ? "" : roster.id).trim();
		if (!rosterId) continue;
		const dueMs = parseIsoToMs_(getRegularWarFinalizationDueAtForRoster_(roster));
		if (!(dueMs > 0) || dueMs > nowMs) continue;
		dueRosterIds.push(rosterId);
	}
	return dueRosterIds;
}

// Ensure one one-shot trigger exists for the next due regular-war finalization attempt.
function ensureSingleRegularWarFinalizationTrigger_(dueAtRaw) {
	const props = PropertiesService.getScriptProperties();
	const dueAt = String(dueAtRaw == null ? "" : dueAtRaw).trim();
	const configuredId = String(props.getProperty(REGULAR_WAR_FINALIZATION_TRIGGER_ID_PROPERTY) || "").trim();
	const configuredDueAt = String(props.getProperty(REGULAR_WAR_FINALIZATION_TRIGGER_AT_PROPERTY) || "").trim();
	const triggers = listRegularWarFinalizationTriggers_();
	let keep = null;

	if (configuredId && configuredDueAt === dueAt) {
		for (let i = 0; i < triggers.length; i++) {
			if (getTriggerUniqueId_(triggers[i]) === configuredId) {
				keep = triggers[i];
				break;
			}
		}
	}

	if (!keep) {
		for (let i = 0; i < triggers.length; i++) {
			try {
				ScriptApp.deleteTrigger(triggers[i]);
			} catch (err) {
				Logger.log("Unable to delete stale regular-war finalization trigger: %s", errorMessage_(err));
			}
		}
		const dueMs = parseIsoToMs_(dueAt);
		if (!(dueMs > 0)) return null;
		const earliestAllowedMs = Date.now() + REGULAR_WAR_FINALIZATION_MIN_TRIGGER_DELAY_MS;
		const scheduledMs = Math.max(dueMs, earliestAllowedMs);
		keep = ScriptApp.newTrigger(REGULAR_WAR_FINALIZATION_HANDLER_NAME).timeBased().at(new Date(scheduledMs)).create();
	}

	const keepId = getTriggerUniqueId_(keep);
	const dedupeTriggers = listRegularWarFinalizationTriggers_();
	for (let i = 0; i < dedupeTriggers.length; i++) {
		const trigger = dedupeTriggers[i];
		const triggerId = getTriggerUniqueId_(trigger);
		const isKeptTrigger = !!keep && ((keepId && triggerId === keepId) || (!keepId && trigger === keep));
		if (isKeptTrigger) continue;
		try {
			ScriptApp.deleteTrigger(trigger);
		} catch (err) {
			Logger.log("Unable to delete duplicate regular-war finalization trigger: %s", errorMessage_(err));
		}
	}

	return keep;
}

// Reconcile one-shot regular-war finalization trigger state against a caller-supplied payload.
function reconcileRegularWarFinalizationTriggerStateCore_(rosterDataRaw, payloadAlreadyValidatedRaw) {
	const props = PropertiesService.getScriptProperties();
	if (!isAutoRefreshEnabled_()) {
		removeRegularWarFinalizationTriggers_();
		props.deleteProperty(REGULAR_WAR_FINALIZATION_TRIGGER_ID_PROPERTY);
		props.deleteProperty(REGULAR_WAR_FINALIZATION_TRIGGER_AT_PROPERTY);
		return { enabled: false, triggerId: "", triggerAt: "", hasTrigger: false };
	}

	let rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : null;
	if (!rosterData) {
		const snapshot = readActiveRosterSnapshot_();
		rosterData = snapshot && snapshot.rosterData ? snapshot.rosterData : null;
	}
	const nextDueAt = rosterData
		? payloadAlreadyValidatedRaw === true
			? findNextRegularWarFinalizationDueAtValidated_(rosterData)
			: findNextRegularWarFinalizationDueAt_(rosterData)
		: "";
	if (!nextDueAt) {
		removeRegularWarFinalizationTriggers_();
		props.deleteProperty(REGULAR_WAR_FINALIZATION_TRIGGER_ID_PROPERTY);
		props.deleteProperty(REGULAR_WAR_FINALIZATION_TRIGGER_AT_PROPERTY);
		return { enabled: true, triggerId: "", triggerAt: "", hasTrigger: false };
	}

	const trigger = ensureSingleRegularWarFinalizationTrigger_(nextDueAt);
	const triggerId = getTriggerUniqueId_(trigger);
	if (triggerId) props.setProperty(REGULAR_WAR_FINALIZATION_TRIGGER_ID_PROPERTY, triggerId);
	else props.deleteProperty(REGULAR_WAR_FINALIZATION_TRIGGER_ID_PROPERTY);
	props.setProperty(REGULAR_WAR_FINALIZATION_TRIGGER_AT_PROPERTY, nextDueAt);
	return { enabled: true, triggerId: triggerId, triggerAt: nextDueAt, hasTrigger: !!triggerId };
}

// Reconcile one-shot regular-war finalization trigger state against the active published payload.
function reconcileRegularWarFinalizationTriggerState_(rosterDataRaw) {
	return reconcileRegularWarFinalizationTriggerStateCore_(rosterDataRaw, false);
}

// Trusted variant for callers that already hold a validated active payload.
function reconcileRegularWarFinalizationTriggerStateValidated_(validatedRosterData) {
	return reconcileRegularWarFinalizationTriggerStateCore_(validatedRosterData, true);
}

// Best-effort trigger reconciliation for background flows that should not fail because scheduling cleanup failed.
function tryReconcileRegularWarFinalizationTriggerState_(rosterDataRaw) {
	try {
		return reconcileRegularWarFinalizationTriggerState_(rosterDataRaw);
	} catch (err) {
		Logger.log("Unable to reconcile regular-war finalization trigger: %s", errorMessage_(err));
		return null;
	}
}

// Best-effort trusted trigger reconciliation for hot paths that already hold validated data.
function tryReconcileRegularWarFinalizationTriggerStateValidated_(validatedRosterData) {
	try {
		return reconcileRegularWarFinalizationTriggerStateValidated_(validatedRosterData);
	} catch (err) {
		Logger.log("Unable to reconcile regular-war finalization trigger: %s", errorMessage_(err));
		return null;
	}
}

// Handle read auto refresh settings.
function readAutoRefreshSettings_() {
	const props = PropertiesService.getScriptProperties();
	const enabled = isAutoRefreshEnabled_();
	const triggerId = String(props.getProperty(AUTO_REFRESH_TRIGGER_ID_PROPERTY) || "").trim();
	const lastRunIssueCount = Math.max(0, toNonNegativeInt_(props.getProperty(AUTO_REFRESH_LAST_RUN_ISSUE_COUNT_PROPERTY)));
	let lastArchiveDate = "";
	try {
		lastArchiveDate = findLatestAutoRefreshArchiveDate_();
		if (lastArchiveDate) props.setProperty(AUTO_REFRESH_LAST_ARCHIVE_DATE_PROPERTY, lastArchiveDate);
		else props.deleteProperty(AUTO_REFRESH_LAST_ARCHIVE_DATE_PROPERTY);
	} catch (err) {
		lastArchiveDate = String(props.getProperty(AUTO_REFRESH_LAST_ARCHIVE_DATE_PROPERTY) || "").trim();
		Logger.log("Unable to resolve latest auto-refresh archive date: %s", errorMessage_(err));
	}
	return {
		enabled: enabled,
		intervalHours: AUTO_REFRESH_INTERVAL_HOURS,
		intervalMinutes: AUTO_REFRESH_INTERVAL_HOURS * 60,
		triggerId: triggerId,
		hasTrigger: !!triggerId,
		lastRunStartedAt: String(props.getProperty(AUTO_REFRESH_LAST_RUN_STARTED_AT_PROPERTY) || "").trim(),
		lastRunFinishedAt: String(props.getProperty(AUTO_REFRESH_LAST_RUN_FINISHED_AT_PROPERTY) || "").trim(),
		lastRunStatus: String(props.getProperty(AUTO_REFRESH_LAST_RUN_STATUS_PROPERTY) || "").trim(),
		lastRunSummary: String(props.getProperty(AUTO_REFRESH_LAST_RUN_SUMMARY_PROPERTY) || "").trim(),
		lastIssueSummary: String(props.getProperty(AUTO_REFRESH_LAST_ISSUE_SUMMARY_PROPERTY) || "").trim(),
		lastRunError: String(props.getProperty(AUTO_REFRESH_LAST_RUN_ERROR_PROPERTY) || "").trim(),
		lastRunIssueCount: lastRunIssueCount,
		lastSuccessfulActiveRefreshAt: getLastSuccessfulActiveWriteAt_(),
		lastArchiveDate: lastArchiveDate,
		regularWarFinalizationTriggerId: String(props.getProperty(REGULAR_WAR_FINALIZATION_TRIGGER_ID_PROPERTY) || "").trim(),
		regularWarFinalizationTriggerAt: String(props.getProperty(REGULAR_WAR_FINALIZATION_TRIGGER_AT_PROPERTY) || "").trim(),
		hasRegularWarFinalizationTrigger: !!String(props.getProperty(REGULAR_WAR_FINALIZATION_TRIGGER_ID_PROPERTY) || "").trim(),
	};
}

// Handle auto refresh active roster tick.
function autoRefreshActiveRosterTick() {
	const startedAt = new Date().toISOString();
	let runIssueCount = 0;
	let runIssueSummary = "";

	if (!isAutoRefreshEnabled_()) {
		setAutoRefreshRunResult_("skipped", "Auto-refresh skipped because it is disabled.", "", 0, "", startedAt, new Date().toISOString());
		tryReconcileRegularWarFinalizationTriggerState_();
		return { ok: true, skipped: true, reason: "disabled" };
	}

	try {
		PropertiesService.getScriptProperties().setProperty(AUTO_REFRESH_LAST_RUN_STARTED_AT_PROPERTY, startedAt);
		let sourceSnapshot = null;
		let writeResult = null;
		const runResult = runRefreshAllRostersCore_(
			function () {
				sourceSnapshot = readActiveRosterSnapshot_();
				return sourceSnapshot && sourceSnapshot.rosterData ? sourceSnapshot.rosterData : null;
			},
			{
				lockOwner: "auto-refresh",
				lockWaitMs: 0,
				allowRegularWarHistoryRepair: false,
				allowRegularWarProvisionalFallback: false,
				beforeRun: function () {
					if (!isRecentSuccessfulActiveWrite_({ ignoreAutoRefreshWrites: true })) return null;
					return {
						skip: true,
						reason: "cooldown",
						lastWriteAt: getLastSuccessfulActiveWriteAt_(),
						lastWriteSource: getLastSuccessfulActiveWriteSource_(),
					};
				},
				onAfterRun: function (resultRaw) {
					const result = resultRaw && typeof resultRaw === "object" ? resultRaw : null;
					if (!result || result.skipped) return;
					if (!sourceSnapshot || !sourceSnapshot.rosterData) {
						throw new Error("Auto-refresh source snapshot is missing.");
					}
					writeResult = writeAutoRefreshedActiveRosterData_(sourceSnapshot, result.rosterData);
				},
			},
		);
		if (runResult && runResult.skipped) {
			const reason = String(runResult.reason == null ? "" : runResult.reason).trim().toLowerCase();
			if (reason === "cooldown") {
				const lastWriteAt = String(runResult.lastWriteAt || "").trim();
				const lastWriteSource = String(runResult.lastWriteSource || "").trim();
				const sourceSuffix = lastWriteSource ? " by " + lastWriteSource : "";
				let summary = "Auto-refresh skipped: active data was written recently" + sourceSuffix + " (" + (lastWriteAt || "unknown") + ").";
				const cleanupResult = maybeCleanupOldAutoRefreshDailyArchives_(getServerDateString_(new Date()));
				const cleanupDeleted = toNonNegativeInt_(cleanupResult && cleanupResult.deletedCount);
				if (cleanupDeleted > 0) {
					summary += " Cleaned " + cleanupDeleted + " stale daily archive(s).";
				}
				setAutoRefreshRunResult_("skipped", summary, "", 0, "", startedAt, new Date().toISOString());
				tryReconcileRegularWarFinalizationTriggerState_();
				return { ok: true, skipped: true, reason: "cooldown", lastWriteAt: lastWriteAt };
			}
			setAutoRefreshRunResult_("skipped", "Auto-refresh skipped.", "", 0, "", startedAt, new Date().toISOString());
			tryReconcileRegularWarFinalizationTriggerState_();
			return { ok: true, skipped: true, reason: reason || "skipped" };
		}
		runIssueCount = runResult.issueCount;
		runIssueSummary = String(runResult.issueSummary || "").trim();
		if (!writeResult) {
			throw new Error("Auto-refresh write result is missing.");
		}

		let summary = buildAutoRefreshSummary_(runResult, writeResult);
		if (writeResult.changed && writeResult.archiveCreated) {
			summary += " Daily archive created for " + writeResult.archiveDate + ".";
		}
		if (writeResult.changed && writeResult.archiveCleanupDeleted > 0) {
			summary += " Cleaned " + writeResult.archiveCleanupDeleted + " stale daily archive(s).";
		}
		if (!writeResult.changed) {
			const cleanupResult = maybeCleanupOldAutoRefreshDailyArchives_(getServerDateString_(new Date()));
			const cleanupDeleted = toNonNegativeInt_(cleanupResult && cleanupResult.deletedCount);
			if (cleanupDeleted > 0) {
				summary += " Cleaned " + cleanupDeleted + " stale daily archive(s).";
			}
		}

		setAutoRefreshRunResult_("ok", summary, "", runIssueCount, runIssueSummary, startedAt, new Date().toISOString());
		const reconcileStartMs = Date.now();
		Logger.log("autoRefresh write finalization trigger reconcile start");
		if (writeResult && writeResult.rosterData) {
			tryReconcileRegularWarFinalizationTriggerStateValidated_(writeResult.rosterData);
		} else {
			tryReconcileRegularWarFinalizationTriggerState_();
		}
		Logger.log("autoRefresh write finalization trigger reconcile done durationMs=%s", Math.max(0, Date.now() - reconcileStartMs));
		Logger.log("autoRefreshActiveRosterTick ok: %s", summary);
		return {
			ok: true,
			summary: summary,
			changed: !!writeResult.changed,
			processedRosters: runResult.processedRosters,
			issueCount: runIssueCount,
		};
	} catch (err) {
		if (isActiveRosterJobLockBusyError_(err)) {
			setAutoRefreshRunResult_("skipped", "Auto-refresh skipped due to overlap with another active roster refresh/publish flow.", "", 0, "", startedAt, new Date().toISOString());
			tryReconcileRegularWarFinalizationTriggerState_();
			return { ok: true, skipped: true, reason: "overlap" };
		}
		const message = errorMessage_(err);
		setAutoRefreshRunResult_("error", "Auto-refresh run failed.", message, runIssueCount, runIssueSummary, startedAt, new Date().toISOString());
		tryReconcileRegularWarFinalizationTriggerState_();
		Logger.log("autoRefreshActiveRosterTick failed: %s", message);
		return { ok: false, error: message };
	}
}

// Handle one-shot regular-war finalization attempts near war end.
function regularWarFinalizationTick() {
	const startedAt = new Date().toISOString();
	if (!isAutoRefreshEnabled_()) {
		reconcileRegularWarFinalizationTriggerState_();
		return { ok: true, skipped: true, reason: "disabled" };
	}

	try {
		let sourceSnapshot = readActiveRosterSnapshot_();
		const dueRosterIds = listDueRegularWarRosterIdsValidated_(sourceSnapshot && sourceSnapshot.rosterData, startedAt);
		Logger.log("regularWarFinalizationTick dueRosterIds=%s", dueRosterIds.join(","));
		if (!dueRosterIds.length) {
			reconcileRegularWarFinalizationTriggerStateValidated_(sourceSnapshot.rosterData);
			return { ok: true, skipped: true, reason: "noDue", dueRosterIds: [] };
		}
		let writeResult = null;
		const runResult = runRefreshAllRostersCore_(
			function () {
				sourceSnapshot = readActiveRosterSnapshot_();
				return sourceSnapshot && sourceSnapshot.rosterData ? sourceSnapshot.rosterData : null;
			},
			{
				lockOwner: "regular-war-finalization",
				lockWaitMs: ACTIVE_ROSTER_JOB_LOCK_WAIT_MS,
				allowRegularWarHistoryRepair: false,
				allowRegularWarProvisionalFallback: false,
				statsOnlyRegularWarFinalization: true,
				rosterIds: dueRosterIds,
				onAfterRun: function (resultRaw) {
					const result = resultRaw && typeof resultRaw === "object" ? resultRaw : null;
					if (!result || result.skipped) return;
					if (!sourceSnapshot || !sourceSnapshot.rosterData) {
						throw new Error("Regular-war finalization source snapshot is missing.");
					}
					writeResult = writeAutoRefreshedActiveRosterData_(sourceSnapshot, result.rosterData);
				},
			},
		);
		if (writeResult && writeResult.rosterData) {
			reconcileRegularWarFinalizationTriggerStateValidated_(writeResult.rosterData);
		} else {
			reconcileRegularWarFinalizationTriggerState_();
		}
		Logger.log(
			"regularWarFinalizationTick ok startedAt=%s processedRosters=%s issueCount=%s changed=%s",
			startedAt,
			toNonNegativeInt_(runResult && runResult.processedRosters),
			toNonNegativeInt_(runResult && runResult.issueCount),
			!!(writeResult && writeResult.changed),
		);
		return {
			ok: true,
			processedRosters: toNonNegativeInt_(runResult && runResult.processedRosters),
			issueCount: toNonNegativeInt_(runResult && runResult.issueCount),
			changed: !!(writeResult && writeResult.changed),
			dueRosterIds: dueRosterIds,
		};
	} catch (err) {
		const message = errorMessage_(err);
		Logger.log("regularWarFinalizationTick failed: %s", message);
		try {
			reconcileRegularWarFinalizationTriggerState_();
		} catch (reconcileErr) {
			Logger.log("regularWarFinalizationTick reconcile failed after error: %s", errorMessage_(reconcileErr));
		}
		return { ok: false, error: message };
	}
}

/**
 * Replaces the active roster payload in Firebase Realtime Database and keeps publish backups in Firebase archive.
 * Called from Admin UI via google.script.run.publishRosterData(rosterData, password)
 */
