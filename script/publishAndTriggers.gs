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

// Clone JSON-safe job state fragments before writing them to Firebase.
function cloneAutoRefreshJobJson_(valueRaw) {
	if (valueRaw == null) return valueRaw;
	return JSON.parse(JSON.stringify(valueRaw));
}

// Convert runtime Error objects into JSON-safe records for resumable job storage.
function serializeAutoRefreshJobError_(errRaw) {
	if (!errRaw) return errRaw;
	const err = errRaw && typeof errRaw === "object" ? errRaw : null;
	if (!err) {
		return {
			__autoRefreshSerializedError: true,
			name: "Error",
			message: String(errRaw),
		};
	}
	const out = {
		__autoRefreshSerializedError: true,
		name: String(err.name || "Error"),
		message: errorMessage_(err),
	};
	const copyKeys = ["code", "statusCode", "retryAfter", "endpoint", "key", "context", "autoRefreshSnapshotMiss", "privateWarLog"];
	for (let i = 0; i < copyKeys.length; i++) {
		const key = copyKeys[i];
		if (err[key] == null) continue;
		out[key] = err[key];
	}
	return out;
}

// Recreate a runtime Error object from a JSON-safe job error record.
function restoreAutoRefreshJobError_(recordRaw) {
	const record = recordRaw && typeof recordRaw === "object" ? recordRaw : null;
	if (!record || record.__autoRefreshSerializedError !== true) return recordRaw;
	const err = new Error(String(record.message || record.name || "Auto-refresh job error."));
	err.name = String(record.name || "Error");
	const copyKeys = ["code", "statusCode", "retryAfter", "endpoint", "key", "context", "autoRefreshSnapshotMiss", "privateWarLog"];
	for (let i = 0; i < copyKeys.length; i++) {
		const key = copyKeys[i];
		if (record[key] == null) continue;
		err[key] = record[key];
	}
	return err;
}

// Serialize one AutoRefreshSnapshot error map.
function serializeAutoRefreshJobErrorMap_(mapRaw) {
	const map = mapRaw && typeof mapRaw === "object" ? mapRaw : {};
	const out = {};
	const keys = Object.keys(map);
	for (let i = 0; i < keys.length; i++) {
		out[keys[i]] = serializeAutoRefreshJobError_(map[keys[i]]);
	}
	return out;
}

// Restore one AutoRefreshSnapshot error map.
function restoreAutoRefreshJobErrorMap_(mapRaw) {
	const map = mapRaw && typeof mapRaw === "object" ? mapRaw : {};
	const out = {};
	const keys = Object.keys(map);
	for (let i = 0; i < keys.length; i++) {
		out[keys[i]] = restoreAutoRefreshJobError_(map[keys[i]]);
	}
	return out;
}

// Serialize AutoRefreshSnapshot error maps while keeping normal data maps unchanged.
function serializeAutoRefreshSnapshotForJobState_(snapshotRaw) {
	const snapshot = snapshotRaw && typeof snapshotRaw === "object" ? snapshotRaw : {};
	const out = cloneAutoRefreshJobJson_(snapshot) || {};
	const errorMapNames = [
		"clanMembersErrorByTag",
		"currentRegularWarErrorByClanTag",
		"leaguegroupErrorByClanTag",
		"cwlWarErrorByTag",
		"regularWarLogErrorByClanTag",
	];
	for (let i = 0; i < errorMapNames.length; i++) {
		const name = errorMapNames[i];
		out[name] = serializeAutoRefreshJobErrorMap_(snapshot[name]);
	}
	return out;
}

// Restore AutoRefreshSnapshot error maps after reading a resumable job.
function restoreAutoRefreshSnapshotFromJobState_(snapshotRaw) {
	const snapshot = snapshotRaw && typeof snapshotRaw === "object" ? snapshotRaw : {};
	const out = cloneAutoRefreshJobJson_(snapshot) || {};
	const errorMapNames = [
		"clanMembersErrorByTag",
		"currentRegularWarErrorByClanTag",
		"leaguegroupErrorByClanTag",
		"cwlWarErrorByTag",
		"regularWarLogErrorByClanTag",
	];
	for (let i = 0; i < errorMapNames.length; i++) {
		const name = errorMapNames[i];
		out[name] = restoreAutoRefreshJobErrorMap_(snapshot[name]);
	}
	return out;
}

// Serialize a resumable auto-refresh job for Firebase storage.
function serializeAutoRefreshJobStateForStorage_(jobStateRaw) {
	const job = jobStateRaw && typeof jobStateRaw === "object" ? jobStateRaw : {};
	const out = cloneAutoRefreshJobJson_(job) || {};
	out.autoRefreshSnapshot = serializeAutoRefreshSnapshotForJobState_(job.autoRefreshSnapshot);
	return out;
}

// Serialize only mutable progress fields for lower-churn resumable job updates.
function serializeAutoRefreshJobProgressForStorage_(jobStateRaw) {
	const job = jobStateRaw && typeof jobStateRaw === "object" ? jobStateRaw : {};
	const out = {
		status: String(job.status || ""),
		updatedAt: String(job.updatedAt || ""),
		completedAt: String(job.completedAt || ""),
		failedAt: String(job.failedAt || ""),
		error: String(job.error || ""),
		nextRosterIndex: toNonNegativeInt_(job.nextRosterIndex),
		rosterDataDraft: job.rosterDataDraft,
		metricsRunState: job.metricsRunState && typeof job.metricsRunState === "object" ? job.metricsRunState : {},
		processedRosters: toNonNegativeInt_(job.processedRosters),
		rostersWithIssues: toNonNegativeInt_(job.rostersWithIssues),
		issues: Array.isArray(job.issues) ? job.issues : [],
		perRoster: Array.isArray(job.perRoster) ? job.perRoster : [],
		timings: job.timings && typeof job.timings === "object" ? job.timings : {},
		writeResultSummary: job.writeResultSummary && typeof job.writeResultSummary === "object" ? job.writeResultSummary : null,
	};
	return cloneAutoRefreshJobJson_(out) || {};
}

// Restore a resumable auto-refresh job after Firebase read/decode.
function restoreAutoRefreshJobStateFromStorage_(jobStateRaw) {
	const job = jobStateRaw && typeof jobStateRaw === "object" ? jobStateRaw : null;
	if (!job) return null;
	const out = cloneAutoRefreshJobJson_(job) || {};
	out.autoRefreshSnapshot = restoreAutoRefreshSnapshotFromJobState_(job.autoRefreshSnapshot);
	if (!out.timings || typeof out.timings !== "object") out.timings = {};
	if (!out.metricsRunState || typeof out.metricsRunState !== "object") out.metricsRunState = {};
	if (!out.metricsRunState.seenClanTags || typeof out.metricsRunState.seenClanTags !== "object") out.metricsRunState.seenClanTags = {};
	if (!Array.isArray(out.issues)) out.issues = [];
	if (!Array.isArray(out.perRoster)) out.perRoster = [];
	if (!Array.isArray(out.rosterIds)) out.rosterIds = [];
	return out;
}

// Return elapsed milliseconds for the current resumable auto-refresh execution.
function getAutoRefreshJobElapsedMs_(executionStartMsRaw) {
	const executionStartMs = Math.max(0, Number(executionStartMsRaw) || Date.now());
	return Math.max(0, Date.now() - executionStartMs);
}

// Return remaining milliseconds inside the conservative resumable auto-refresh budget.
function getAutoRefreshJobRemainingMs_(executionStartMsRaw) {
	return Math.max(0, AUTO_REFRESH_JOB_EXECUTION_BUDGET_MS - getAutoRefreshJobElapsedMs_(executionStartMsRaw));
}

// Return whether a non-interruptible auto-refresh phase should be allowed to start.
function hasAutoRefreshJobBudgetFor_(executionStartMsRaw, reserveMsRaw) {
	const reserveMs = Math.max(0, Number(reserveMsRaw) || 0);
	return getAutoRefreshJobRemainingMs_(executionStartMsRaw) >= reserveMs;
}

// Safely measure encoded JSON for job-state write diagnostics.
function estimateAutoRefreshJobJsonChars_(valueRaw) {
	try {
		return JSON.stringify(valueRaw).length;
	} catch (err) {
		return -1;
	}
}

// Build a compact size breakdown for the encoded job-state payload.
function buildAutoRefreshJobStateSizeBreakdown_(encodedPayloadRaw) {
	const encoded = encodedPayloadRaw && typeof encodedPayloadRaw === "object" ? encodedPayloadRaw : {};
	return {
		totalChars: estimateAutoRefreshJobJsonChars_(encoded),
		rosterDataDraftChars: Object.prototype.hasOwnProperty.call(encoded, "rosterDataDraft")
			? estimateAutoRefreshJobJsonChars_(encoded.rosterDataDraft)
			: 0,
		autoRefreshSnapshotChars: Object.prototype.hasOwnProperty.call(encoded, "autoRefreshSnapshot")
			? estimateAutoRefreshJobJsonChars_(encoded.autoRefreshSnapshot)
			: 0,
		ownershipSnapshotChars: Object.prototype.hasOwnProperty.call(encoded, "ownershipSnapshot")
			? estimateAutoRefreshJobJsonChars_(encoded.ownershipSnapshot)
			: 0,
		metricsRunStateChars: Object.prototype.hasOwnProperty.call(encoded, "metricsRunState")
			? estimateAutoRefreshJobJsonChars_(encoded.metricsRunState)
			: 0,
		issuesChars: Object.prototype.hasOwnProperty.call(encoded, "issues") ? estimateAutoRefreshJobJsonChars_(encoded.issues) : 0,
		perRosterChars: Object.prototype.hasOwnProperty.call(encoded, "perRoster") ? estimateAutoRefreshJobJsonChars_(encoded.perRoster) : 0,
	};
}

// Mark that the one-shot resume trigger should retry fresh job creation if no job exists yet.
function markAutoRefreshFreshRetryPending_(reasonRaw) {
	const reason = String(reasonRaw == null ? "" : reasonRaw).trim() || "freshRetry";
	PropertiesService.getScriptProperties().setProperty(
		AUTO_REFRESH_JOB_PENDING_FRESH_RETRY_PROPERTY,
		reason + "|" + new Date().toISOString(),
	);
}

// Return whether a one-shot resume trigger is allowed to retry fresh job creation.
function isAutoRefreshFreshRetryPending_() {
	return !!String(PropertiesService.getScriptProperties().getProperty(AUTO_REFRESH_JOB_PENDING_FRESH_RETRY_PROPERTY) || "").trim();
}

// Clear the fresh-retry marker after a job is persisted or a resume path consumes it.
function clearAutoRefreshFreshRetryPending_() {
	PropertiesService.getScriptProperties().deleteProperty(AUTO_REFRESH_JOB_PENDING_FRESH_RETRY_PROPERTY);
}

// Defer a resumable job because the current execution is too close to the budget edge.
function deferAutoRefreshJobForBudget_(jobStateRaw, reasonRaw, executionStartMsRaw, reserveMsRaw) {
	const job = jobStateRaw && typeof jobStateRaw === "object" ? jobStateRaw : {};
	const reason = String(reasonRaw == null ? "budget" : reasonRaw).trim() || "budget";
	const reserveMs = Math.max(0, Number(reserveMsRaw) || 0);
	const total = Array.isArray(job.rosterIds) ? job.rosterIds.length : 0;
	scheduleAutoRefreshJobResume_();
	setAutoRefreshJobInProgressResult_(job);
	Logger.log(
		"autoRefresh job budget stop jobId=%s reason=%s status=%s nextRosterIndex=%s remainingMs=%s reserveMs=%s elapsedMs=%s",
		String(job.jobId || ""),
		reason,
		String(job.status || ""),
		toNonNegativeInt_(job.nextRosterIndex),
		getAutoRefreshJobRemainingMs_(executionStartMsRaw),
		reserveMs,
		getAutoRefreshJobElapsedMs_(executionStartMsRaw),
	);
	return {
		ok: true,
		inProgress: true,
		status: String(job.status || "running"),
		reason: reason,
		processedRosters: toNonNegativeInt_(job.processedRosters),
		totalRosters: total,
	};
}

// Defer fresh job creation before any job state exists.
function deferFreshAutoRefreshStartForBudget_(reasonRaw, startedAtRaw, executionStartMsRaw, reserveMsRaw) {
	const reason = String(reasonRaw == null ? "freshStartBudget" : reasonRaw).trim() || "freshStartBudget";
	const startedAt = String(startedAtRaw || new Date().toISOString());
	const reserveMs = Math.max(0, Number(reserveMsRaw) || 0);
	markAutoRefreshFreshRetryPending_(reason);
	scheduleAutoRefreshJobResume_();
	const summary = "Auto-refresh start deferred before initial job state was written; retry scheduled.";
	setAutoRefreshRunResult_("inProgress", summary, "", 0, "", startedAt, new Date().toISOString());
	Logger.log(
		"autoRefresh job fresh start budget stop reason=%s remainingMs=%s reserveMs=%s elapsedMs=%s retryScheduled=true",
		reason,
		getAutoRefreshJobRemainingMs_(executionStartMsRaw),
		reserveMs,
		getAutoRefreshJobElapsedMs_(executionStartMsRaw),
	);
	return {
		ok: true,
		inProgress: true,
		status: "inProgress",
		reason: reason,
		processedRosters: 0,
		totalRosters: 0,
	};
}

// Read current resumable auto-refresh job state from Firebase.
function readAutoRefreshJobState_() {
	const totalStartMs = Date.now();
	Logger.log("autoRefresh job state read start path=%s", FIREBASE_INTERNAL_AUTO_REFRESH_JOB_PATH);
	const fetchStartMs = Date.now();
	const encoded = firebaseRequestJson_(FIREBASE_INTERNAL_AUTO_REFRESH_JOB_PATH, "GET");
	const fetchMs = Math.max(0, Date.now() - fetchStartMs);
	if (!encoded || typeof encoded !== "object" || Array.isArray(encoded)) {
		Logger.log("autoRefresh job state read done found=false fetchMs=%s totalMs=%s", fetchMs, Math.max(0, Date.now() - totalStartMs));
		return null;
	}
	const restoreStartMs = Date.now();
	const decoded = decodeFirebaseObjectKeysRecursive_(encoded);
	const restored = restoreAutoRefreshJobStateFromStorage_(decoded);
	const restoreMs = Math.max(0, Date.now() - restoreStartMs);
	Logger.log(
		"autoRefresh job state read done found=%s jobId=%s status=%s fetchMs=%s restoreMs=%s totalMs=%s nextRosterIndex=%s processedRosters=%s",
		!!restored,
		String((restored && restored.jobId) || ""),
		String((restored && restored.status) || ""),
		fetchMs,
		restoreMs,
		Math.max(0, Date.now() - totalStartMs),
		toNonNegativeInt_(restored && restored.nextRosterIndex),
		toNonNegativeInt_(restored && restored.processedRosters),
	);
	return restored;
}

// Write current resumable auto-refresh job state to Firebase.
function writeAutoRefreshJobState_(jobStateRaw, optionsRaw) {
	const job = jobStateRaw && typeof jobStateRaw === "object" ? jobStateRaw : {};
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const writeKind = String(options.writeKind == null ? "" : options.writeKind).trim() || "full";
	const writeScope = String(options.writeScope == null ? "" : options.writeScope).trim() || "full";
	const method = writeScope === "progress" ? "PATCH" : "PUT";
	job.updatedAt = new Date().toISOString();
	const totalStartMs = Date.now();
	Logger.log(
		"autoRefresh job state write start jobId=%s status=%s nextRosterIndex=%s kind=%s scope=%s method=%s path=%s",
		String(job.jobId || ""),
		String(job.status || ""),
		toNonNegativeInt_(job.nextRosterIndex),
		writeKind,
		writeScope,
		method,
		FIREBASE_INTERNAL_AUTO_REFRESH_JOB_PATH,
	);
	const encodeStartMs = Date.now();
	const storagePayload =
		writeScope === "progress" ? serializeAutoRefreshJobProgressForStorage_(job) : serializeAutoRefreshJobStateForStorage_(job);
	const encoded = encodeFirebaseObjectKeysRecursive_(storagePayload);
	const encodeMs = Math.max(0, Date.now() - encodeStartMs);
	const size = buildAutoRefreshJobStateSizeBreakdown_(encoded);
	Logger.log(
		"autoRefresh job state write payload jobId=%s kind=%s scope=%s totalChars=%s rosterDataDraftChars=%s autoRefreshSnapshotChars=%s ownershipSnapshotChars=%s metricsRunStateChars=%s issuesChars=%s perRosterChars=%s encodeMs=%s",
		String(job.jobId || ""),
		writeKind,
		writeScope,
		size.totalChars,
		size.rosterDataDraftChars,
		size.autoRefreshSnapshotChars,
		size.ownershipSnapshotChars,
		size.metricsRunStateChars,
		size.issuesChars,
		size.perRosterChars,
		encodeMs,
	);
	const putStartMs = Date.now();
	firebaseRequestJson_(FIREBASE_INTERNAL_AUTO_REFRESH_JOB_PATH, method, encoded);
	clearAutoRefreshFreshRetryPending_();
	Logger.log(
		"autoRefresh job state write done jobId=%s status=%s kind=%s scope=%s encodeMs=%s writeMs=%s totalMs=%s nextRosterIndex=%s processedRosters=%s",
		String(job.jobId || ""),
		String(job.status || ""),
		writeKind,
		writeScope,
		encodeMs,
		Math.max(0, Date.now() - putStartMs),
		Math.max(0, Date.now() - totalStartMs),
		toNonNegativeInt_(job.nextRosterIndex),
		toNonNegativeInt_(job.processedRosters),
	);
	return job;
}

// Keep a small last-job record for post-cleanup diagnostics.
function writeAutoRefreshLastJobState_(jobStateRaw) {
	const job = jobStateRaw && typeof jobStateRaw === "object" ? jobStateRaw : {};
	const totalStartMs = Date.now();
	const summary = {
		jobId: String(job.jobId || ""),
		kind: String(job.kind || "auto-refresh"),
		status: String(job.status || ""),
		startedAt: String(job.startedAt || ""),
		updatedAt: String(job.updatedAt || ""),
		completedAt: String(job.completedAt || ""),
		failedAt: String(job.failedAt || ""),
		error: String(job.error || ""),
		sourceFingerprint: String(job.sourceFingerprint || ""),
		sourceLastUpdatedAt: String(job.sourceLastUpdatedAt || ""),
		rosterIds: Array.isArray(job.rosterIds) ? job.rosterIds : [],
		nextRosterIndex: toNonNegativeInt_(job.nextRosterIndex),
		options: normalizeAutoRefreshJobOptions_(job.options),
		processedRosters: toNonNegativeInt_(job.processedRosters),
		rostersWithIssues: toNonNegativeInt_(job.rostersWithIssues),
		issueCount: Array.isArray(job.issues) ? job.issues.length : 0,
		issueSummary: buildAutoRefreshIssueSummary_(job.issues),
		timings: job.timings && typeof job.timings === "object" ? job.timings : {},
		writeResultSummary: job.writeResultSummary && typeof job.writeResultSummary === "object" ? job.writeResultSummary : null,
	};
	const encoded = encodeFirebaseObjectKeysRecursive_(summary);
	const payloadChars = estimateAutoRefreshJobJsonChars_(encoded);
	Logger.log("autoRefresh last job write start jobId=%s status=%s payloadChars=%s", String(job.jobId || ""), String(job.status || ""), payloadChars);
	firebaseRequestJson_(FIREBASE_INTERNAL_AUTO_REFRESH_LAST_JOB_PATH, "PUT", encoded);
	Logger.log("autoRefresh last job write done jobId=%s status=%s durationMs=%s", String(job.jobId || ""), String(job.status || ""), Math.max(0, Date.now() - totalStartMs));
	return job;
}

// Clear current resumable auto-refresh job state.
function clearAutoRefreshJobState_() {
	const startMs = Date.now();
	Logger.log("autoRefresh job state clear start path=%s", FIREBASE_INTERNAL_AUTO_REFRESH_JOB_PATH);
	firebaseRequestJson_(FIREBASE_INTERNAL_AUTO_REFRESH_JOB_PATH, "DELETE");
	Logger.log("autoRefresh job state clear done durationMs=%s", Math.max(0, Date.now() - startMs));
}

// Archive a terminal job summary and clear resumable state without failing the already-decided outcome.
function archiveAndClearAutoRefreshJobStateBestEffort_(jobStateRaw, labelRaw) {
	const job = jobStateRaw && typeof jobStateRaw === "object" ? jobStateRaw : {};
	const label = String(labelRaw == null ? "auto-refresh job cleanup" : labelRaw).trim() || "auto-refresh job cleanup";
	try {
		writeAutoRefreshLastJobState_(job);
	} catch (err) {
		Logger.log("%s: unable to write last job summary for jobId=%s: %s", label, String(job.jobId || ""), errorMessage_(err));
	}
	try {
		clearAutoRefreshJobState_();
	} catch (err) {
		Logger.log("%s: unable to clear current job for jobId=%s: %s", label, String(job.jobId || ""), errorMessage_(err));
	}
	try {
		removeAutoRefreshJobResumeTriggers_();
	} catch (err) {
		Logger.log("%s: unable to remove resume triggers for jobId=%s: %s", label, String(job.jobId || ""), errorMessage_(err));
	}
	try {
		clearAutoRefreshFreshRetryPending_();
	} catch (err) {
		Logger.log("%s: unable to clear fresh retry marker for jobId=%s: %s", label, String(job.jobId || ""), errorMessage_(err));
	}
}

// Normalize persisted job options.
function normalizeAutoRefreshJobOptions_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const rosterIdsRaw = Array.isArray(options.rosterIds) ? options.rosterIds : [];
	const rosterIds = [];
	const seen = {};
	for (let i = 0; i < rosterIdsRaw.length; i++) {
		const rosterId = String(rosterIdsRaw[i] == null ? "" : rosterIdsRaw[i]).trim();
		if (!rosterId || seen[rosterId]) continue;
		seen[rosterId] = true;
		rosterIds.push(rosterId);
	}
	return {
		allowRegularWarHistoryRepair: options.allowRegularWarHistoryRepair === true,
		allowRegularWarProvisionalFallback: options.allowRegularWarProvisionalFallback === true,
		statsOnlyRegularWarFinalization: options.statsOnlyRegularWarFinalization === true,
		rosterIds: rosterIds,
	};
}

// Build per-roster pipeline options for a resumable auto-refresh job.
function buildAutoRefreshJobPipelineOptions_(jobStateRaw) {
	const job = jobStateRaw && typeof jobStateRaw === "object" ? jobStateRaw : {};
	const jobOptions = normalizeAutoRefreshJobOptions_(job.options);
	if (!job.metricsRunState || typeof job.metricsRunState !== "object") job.metricsRunState = {};
	if (!job.metricsRunState.seenClanTags || typeof job.metricsRunState.seenClanTags !== "object") job.metricsRunState.seenClanTags = {};
	return Object.assign(
		{
			ownershipSnapshot: job.ownershipSnapshot && typeof job.ownershipSnapshot === "object" ? job.ownershipSnapshot : null,
			skipInitialValidation: true,
			metricsRunState: job.metricsRunState,
			allowRegularWarHistoryRepair: jobOptions.allowRegularWarHistoryRepair === true,
			allowRegularWarProvisionalFallback: jobOptions.allowRegularWarProvisionalFallback === true,
			statsOnlyRegularWarFinalization: jobOptions.statsOnlyRegularWarFinalization === true,
			autoRefreshFinalValidationMode: true,
		},
		buildAutoRefreshPipelineSnapshotOptions_(job.autoRefreshSnapshot),
	);
}

// Build compact write result details for job state.
function summarizeAutoRefreshWriteResult_(writeResultRaw) {
	const write = writeResultRaw && typeof writeResultRaw === "object" ? writeResultRaw : {};
	return {
		changed: !!write.changed,
		written: !!write.written,
		writtenAt: String(write.writtenAt || ""),
		rosterCount: toNonNegativeInt_(write.rosterCount),
		playerCount: toNonNegativeInt_(write.playerCount),
		noteCount: toNonNegativeInt_(write.noteCount),
		archiveCreated: !!write.archiveCreated,
		archiveDate: String(write.archiveDate || ""),
		archiveCleanupDeleted: toNonNegativeInt_(write.archiveCleanupDeleted),
	};
}

// Build the same archive-aware summary used by auto-refresh final commit.
function buildAutoRefreshFinalSummary_(runResultRaw, writeResultRaw) {
	const runResult = runResultRaw && typeof runResultRaw === "object" ? runResultRaw : {};
	const writeResult = writeResultRaw && typeof writeResultRaw === "object" ? writeResultRaw : {};
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
	return summary;
}

// Complete post-commit auto-refresh side effects.
function finalizeAutoRefreshCommitSideEffects_(jobStateRaw, runResultRaw, writeResultRaw) {
	const job = jobStateRaw && typeof jobStateRaw === "object" ? jobStateRaw : {};
	const runResult = runResultRaw && typeof runResultRaw === "object" ? runResultRaw : {};
	const writeResult = writeResultRaw && typeof writeResultRaw === "object" ? writeResultRaw : {};
	const startedAt = String(job.startedAt || new Date().toISOString());
	const summary = buildAutoRefreshFinalSummary_(runResult, writeResult);
	setAutoRefreshRunResult_("ok", summary, "", runResult.issueCount, runResult.issueSummary, startedAt, new Date().toISOString());
	const reconcileStartMs = Date.now();
	Logger.log("autoRefresh job commit finalization trigger reconcile start jobId=%s", String(job.jobId || ""));
	if (writeResult && writeResult.rosterData) {
		tryReconcileRegularWarFinalizationTriggerStateValidated_(writeResult.rosterData);
	} else {
		tryReconcileRegularWarFinalizationTriggerState_();
	}
	Logger.log("autoRefresh job commit finalization trigger reconcile done jobId=%s durationMs=%s", String(job.jobId || ""), Math.max(0, Date.now() - reconcileStartMs));
	const seasonEventReconcileStartMs = Date.now();
	tryReconcileCurrentSeasonEventsForAutoRefresh_();
	Logger.log("autoRefresh job season event reconcile done jobId=%s durationMs=%s", String(job.jobId || ""), Math.max(0, Date.now() - seasonEventReconcileStartMs));
	return summary;
}

// Create a new resumable auto-refresh job from the current active source snapshot.
function createAutoRefreshJobState_(sourceSnapshotRaw, optionsRaw) {
	const totalStartMs = Date.now();
	const sourceSnapshot = sourceSnapshotRaw && typeof sourceSnapshotRaw === "object" ? sourceSnapshotRaw : null;
	const sourceRosterData = sourceSnapshot && sourceSnapshot.rosterData ? sourceSnapshot.rosterData : null;
	if (!sourceRosterData) throw new Error("Auto-refresh job source snapshot is missing.");
	const jobOptions = normalizeAutoRefreshJobOptions_(optionsRaw);
	const validationStartMs = Date.now();
	const rosterData = validateRosterData_(sourceRosterData);
	const validationMs = Math.max(0, Date.now() - validationStartMs);
	const planStartMs = Date.now();
	const runPlan = buildRefreshAllRosterRunPlan_(rosterData, jobOptions);
	const planMs = Math.max(0, Date.now() - planStartMs);
	const startedAt = new Date().toISOString();
	const fingerprintStartMs = Date.now();
	const sourceFingerprint = buildActiveRosterSourceFingerprintValidated_(rosterData);
	const fingerprintMs = Math.max(0, Date.now() - fingerprintStartMs);
	const jobId = Utilities.getUuid();
	const metricsRunState = { seenClanTags: {} };

	touchActiveRosterLockLease_("auto-refresh job snapshot");
	const snapshotStartMs = Date.now();
	const autoRefreshSnapshot = buildAutoRefreshSnapshot_(rosterData, {
		sourceRosters: runPlan.hasRequestedRosterFilter ? runPlan.targetedSourceRosters : runPlan.sourceRosters,
		allowRegularWarHistoryRepair: jobOptions.allowRegularWarHistoryRepair === true,
	});
	const snapshotMs = Math.max(0, Date.now() - snapshotStartMs);
	touchActiveRosterLockLease_("auto-refresh job ownership snapshot");
	const ownershipSnapshotStartMs = Date.now();
	const ownershipSnapshot = jobOptions.statsOnlyRegularWarFinalization
		? null
		: buildRefreshAllOwnershipSnapshot_(rosterData, autoRefreshSnapshot);
	const ownershipSnapshotMs = Math.max(0, Date.now() - ownershipSnapshotStartMs);

	const job = {
		jobId: jobId,
		kind: "auto-refresh",
		status: "running",
		startedAt: startedAt,
		updatedAt: startedAt,
		completedAt: "",
		failedAt: "",
		error: "",
		sourceFingerprint: sourceFingerprint,
		sourceLastUpdatedAt: String((rosterData && rosterData.lastUpdatedAt) || ""),
		rosterIds: runPlan.rosterIds,
		nextRosterIndex: 0,
		rosterDataDraft: rosterData,
		autoRefreshSnapshot: autoRefreshSnapshot,
		ownershipSnapshot: ownershipSnapshot,
		metricsRunState: metricsRunState,
		options: jobOptions,
		processedRosters: 0,
		rostersWithIssues: 0,
		issues: [],
		perRoster: [],
		timings: {
			snapshotMs: snapshotMs,
			ownershipSnapshotMs: ownershipSnapshotMs,
			rosterPipelineCumulativeMs: 0,
			rollbackCloneCumulativeMs: 0,
			finalValidationMs: 0,
			commitMs: 0,
		},
		writeResultSummary: null,
	};
	Logger.log(
		"autoRefresh job create jobId=%s rosterCount=%s sourceLastUpdatedAt=%s sourceFingerprint=%s validationMs=%s planMs=%s fingerprintMs=%s snapshotMs=%s ownershipSnapshotMs=%s totalMs=%s",
		jobId,
		runPlan.rosterIds.length,
		job.sourceLastUpdatedAt,
		sourceFingerprint.slice(0, 12),
		validationMs,
		planMs,
		fingerprintMs,
		snapshotMs,
		ownershipSnapshotMs,
		Math.max(0, Date.now() - totalStartMs),
	);
	return job;
}

// Return whether a persisted job should be continued.
function isContinuableAutoRefreshJob_(jobStateRaw) {
	const job = jobStateRaw && typeof jobStateRaw === "object" ? jobStateRaw : null;
	if (!job) return false;
	if (String(job.kind || "") !== "auto-refresh") return false;
	const status = String(job.status || "").trim();
	return status === "running" || status === "finalizing";
}

// Update visible auto-refresh run properties for an incomplete job.
function setAutoRefreshJobInProgressResult_(jobStateRaw) {
	const job = jobStateRaw && typeof jobStateRaw === "object" ? jobStateRaw : {};
	const total = Array.isArray(job.rosterIds) ? job.rosterIds.length : 0;
	const processed = toNonNegativeInt_(job.processedRosters);
	const issues = Array.isArray(job.issues) ? job.issues : [];
	const summary = "Auto-refresh in progress: processed " + processed + "/" + total + " roster(s).";
	setAutoRefreshRunResult_("inProgress", summary, "", issues.length, buildAutoRefreshIssueSummary_(issues), job.startedAt, new Date().toISOString());
}

// Process roster pipelines until this Apps Script execution should pause.
function processAutoRefreshJobChunk_(jobStateRaw, executionStartMsRaw) {
	const job = jobStateRaw && typeof jobStateRaw === "object" ? jobStateRaw : {};
	const executionStartMs = Math.max(0, Number(executionStartMsRaw) || Date.now());
	const rosterIds = Array.isArray(job.rosterIds) ? job.rosterIds : [];
	const accumulator = buildRefreshAllAccumulatorFromJob_(job);
	const pipelineOptions = buildAutoRefreshJobPipelineOptions_(job);
	let processedThisRun = 0;
	let statePersisted = false;
	let budgetStopReason = "";
	Logger.log(
		"autoRefresh job chunk start jobId=%s nextRosterIndex=%s remaining=%s elapsedMs=%s remainingMs=%s",
		String(job.jobId || ""),
		toNonNegativeInt_(job.nextRosterIndex),
		Math.max(0, rosterIds.length - toNonNegativeInt_(job.nextRosterIndex)),
		getAutoRefreshJobElapsedMs_(executionStartMs),
		getAutoRefreshJobRemainingMs_(executionStartMs),
	);
	while (toNonNegativeInt_(job.nextRosterIndex) < rosterIds.length) {
		const remainingBeforeMs = getAutoRefreshJobRemainingMs_(executionStartMs);
		if (remainingBeforeMs < AUTO_REFRESH_JOB_ROSTER_START_RESERVE_MS) {
			budgetStopReason = "beforeRoster";
			Logger.log(
				"autoRefresh job chunk budget stop before roster jobId=%s nextRosterIndex=%s remainingMs=%s reserveMs=%s processedThisRun=%s",
				String(job.jobId || ""),
				toNonNegativeInt_(job.nextRosterIndex),
				remainingBeforeMs,
				AUTO_REFRESH_JOB_ROSTER_START_RESERVE_MS,
				processedThisRun,
			);
			break;
		}
		const rosterIndex = toNonNegativeInt_(job.nextRosterIndex);
		const rosterId = rosterIds[rosterIndex];
		Logger.log(
			"autoRefresh job roster start jobId=%s rosterId=%s rosterIndex=%s remainingMs=%s",
			String(job.jobId || ""),
			String(rosterId || ""),
			rosterIndex,
			remainingBeforeMs,
		);
		touchActiveRosterLockLease_("auto-refresh job roster " + (rosterIndex + 1) + "/" + rosterIds.length);
		const processed = processRefreshAllRosterPipelineIntoAccumulator_(job.rosterDataDraft, rosterId, pipelineOptions, accumulator);
		job.rosterDataDraft = processed.rosterData;
		job.nextRosterIndex = rosterIndex + 1;
		processedThisRun++;
		applyRefreshAllAccumulatorToJob_(job, accumulator);
		job.status = job.nextRosterIndex >= rosterIds.length ? "finalizing" : "running";
		writeAutoRefreshJobState_(job, {
			writeKind: job.status === "finalizing" ? "finalizing" : "progress",
			writeScope: "progress",
		});
		statePersisted = true;
		Logger.log(
			"autoRefresh job roster done jobId=%s rosterId=%s nextRosterIndex=%s elapsedMs=%s remainingMs=%s status=%s",
			String(job.jobId || ""),
			String(rosterId || ""),
			toNonNegativeInt_(job.nextRosterIndex),
			getAutoRefreshJobElapsedMs_(executionStartMs),
			getAutoRefreshJobRemainingMs_(executionStartMs),
			String(job.status || ""),
		);
	}
	Logger.log(
		"autoRefresh job chunk result jobId=%s processedThisRun=%s nextRosterIndex=%s elapsedMs=%s remainingMs=%s status=%s statePersisted=%s budgetStopReason=%s",
		String(job.jobId || ""),
		processedThisRun,
		toNonNegativeInt_(job.nextRosterIndex),
		getAutoRefreshJobElapsedMs_(executionStartMs),
		getAutoRefreshJobRemainingMs_(executionStartMs),
		String(job.status || ""),
		statePersisted,
		budgetStopReason,
	);
	return {
		job: job,
		processedThisRun: processedThisRun,
		complete: toNonNegativeInt_(job.nextRosterIndex) >= rosterIds.length,
		statePersisted: statePersisted,
		budgetStopReason: budgetStopReason,
	};
}

// Final-validate, guard source fingerprint, and commit the completed job.
function finalizeAutoRefreshJob_(jobStateRaw, optionsRaw) {
	const job = jobStateRaw && typeof jobStateRaw === "object" ? jobStateRaw : {};
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const executionStartMs = Math.max(0, Number(options.executionStartMs) || Date.now());
	job.status = "finalizing";
	const startedAt = String(job.startedAt || new Date().toISOString());
	Logger.log(
		"autoRefresh job finalize start jobId=%s elapsedMs=%s remainingMs=%s",
		String(job.jobId || ""),
		getAutoRefreshJobElapsedMs_(executionStartMs),
		getAutoRefreshJobRemainingMs_(executionStartMs),
	);
	if (!hasAutoRefreshJobBudgetFor_(executionStartMs, AUTO_REFRESH_JOB_FINALIZE_RESERVE_MS)) {
		return deferAutoRefreshJobForBudget_(job, "beforeFinalValidation", executionStartMs, AUTO_REFRESH_JOB_FINALIZE_RESERVE_MS);
	}
	let validatedRosterData = null;
	touchActiveRosterLockLease_("auto-refresh job final validation");
	const finalValidationStartMs = Date.now();
	try {
		validatedRosterData = validateRosterData_(job.rosterDataDraft);
	} catch (err) {
		throw new Error(appendDuplicateRosterTagDetailsToError_("finalize auto-refresh job payload", err, job.rosterDataDraft));
	}
	if (!job.timings || typeof job.timings !== "object") job.timings = {};
	job.timings.finalValidationMs = Math.max(0, Date.now() - finalValidationStartMs);
	Logger.log(
		"autoRefresh job final validation jobId=%s finalValidationMs=%s elapsedMs=%s remainingMs=%s",
		String(job.jobId || ""),
		job.timings.finalValidationMs,
		getAutoRefreshJobElapsedMs_(executionStartMs),
		getAutoRefreshJobRemainingMs_(executionStartMs),
	);
	if (!hasAutoRefreshJobBudgetFor_(executionStartMs, AUTO_REFRESH_JOB_SOURCE_GUARD_RESERVE_MS)) {
		return deferAutoRefreshJobForBudget_(job, "beforeCommitGuard", executionStartMs, AUTO_REFRESH_JOB_SOURCE_GUARD_RESERVE_MS);
	}

	touchActiveRosterLockLease_("auto-refresh job source guard");
	const sourceGuardStartMs = Date.now();
	const sourceReadStartMs = Date.now();
	const currentSourceSnapshot = readActiveRosterSnapshot_();
	const sourceReadMs = Math.max(0, Date.now() - sourceReadStartMs);
	const fingerprintStartMs = Date.now();
	const currentSourceFingerprint = buildActiveRosterSourceFingerprintValidated_(currentSourceSnapshot && currentSourceSnapshot.rosterData);
	const fingerprintMs = Math.max(0, Date.now() - fingerprintStartMs);
	const sourceMatches = currentSourceFingerprint === String(job.sourceFingerprint || "");
	Logger.log(
		"autoRefresh job commit guard jobId=%s sourceMatches=%s jobFingerprint=%s currentFingerprint=%s sourceReadMs=%s fingerprintMs=%s totalMs=%s elapsedMs=%s remainingMs=%s",
		String(job.jobId || ""),
		sourceMatches,
		String(job.sourceFingerprint || "").slice(0, 12),
		currentSourceFingerprint.slice(0, 12),
		sourceReadMs,
		fingerprintMs,
		Math.max(0, Date.now() - sourceGuardStartMs),
		getAutoRefreshJobElapsedMs_(executionStartMs),
		getAutoRefreshJobRemainingMs_(executionStartMs),
	);
	if (!sourceMatches) {
		const summary = "Auto-refresh job became stale because active data changed while it was running; no active payload was written.";
		job.status = "stale";
		job.completedAt = new Date().toISOString();
		job.error = summary;
		setAutoRefreshRunResult_("stale", summary, "", job.issues && job.issues.length, buildAutoRefreshIssueSummary_(job.issues), startedAt, new Date().toISOString());
		tryReconcileRegularWarFinalizationTriggerStateValidated_(currentSourceSnapshot && currentSourceSnapshot.rosterData);
		Logger.log(
			"autoRefresh job stale cleanup start jobId=%s remainingMs=%s reserveMs=%s",
			String(job.jobId || ""),
			getAutoRefreshJobRemainingMs_(executionStartMs),
			AUTO_REFRESH_JOB_STALE_CLEANUP_RESERVE_MS,
		);
		archiveAndClearAutoRefreshJobStateBestEffort_(job, "autoRefresh job stale cleanup");
		Logger.log(
			"autoRefresh job stale cleanup done jobId=%s elapsedMs=%s remainingMs=%s",
			String(job.jobId || ""),
			getAutoRefreshJobElapsedMs_(executionStartMs),
			getAutoRefreshJobRemainingMs_(executionStartMs),
		);
		return { ok: true, status: "stale", stale: true, summary: summary, processedRosters: toNonNegativeInt_(job.processedRosters), issueCount: job.issues && job.issues.length };
	}

	if (!hasAutoRefreshJobBudgetFor_(executionStartMs, AUTO_REFRESH_JOB_ACTIVE_COMMIT_RESERVE_MS)) {
		return deferAutoRefreshJobForBudget_(job, "beforeActiveCommit", executionStartMs, AUTO_REFRESH_JOB_ACTIVE_COMMIT_RESERVE_MS);
	}
	const runResult = buildRefreshAllRunResultFromAccumulator_(validatedRosterData, buildRefreshAllAccumulatorFromJob_(job));
	touchActiveRosterLockLease_("auto-refresh job commit");
	const commitStartMs = Date.now();
	const writeResult = writeAutoRefreshedActiveRosterData_(currentSourceSnapshot, validatedRosterData);
	job.timings.commitMs = Math.max(0, Date.now() - commitStartMs);
	Logger.log(
		"autoRefresh job commit result jobId=%s changed=%s written=%s commitMs=%s",
		String(job.jobId || ""),
		!!writeResult.changed,
		!!writeResult.written,
		job.timings.commitMs,
	);
	const summary = finalizeAutoRefreshCommitSideEffects_(job, runResult, writeResult);
	job.status = "completed";
	job.completedAt = new Date().toISOString();
	job.writeResultSummary = summarizeAutoRefreshWriteResult_(writeResult);
	archiveAndClearAutoRefreshJobStateBestEffort_(job, "autoRefresh job completed cleanup");
	Logger.log("autoRefresh job completed cleanup jobId=%s", String(job.jobId || ""));
	return {
		ok: true,
		status: "completed",
		summary: summary,
		changed: !!writeResult.changed,
		processedRosters: runResult.processedRosters,
		issueCount: runResult.issueCount,
	};
}

// Continue a running/finalizing job for the current execution budget.
function continueAutoRefreshJobCore_(jobStateRaw, optionsRaw) {
	const job = jobStateRaw && typeof jobStateRaw === "object" ? jobStateRaw : {};
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const executionStartMs = Math.max(0, Number(options.executionStartMs) || Date.now());
	const total = Array.isArray(job.rosterIds) ? job.rosterIds.length : 0;
	Logger.log(
		"autoRefresh job continue start jobId=%s status=%s nextRosterIndex=%s totalRosters=%s elapsedMs=%s remainingMs=%s",
		String(job.jobId || ""),
		String(job.status || ""),
		toNonNegativeInt_(job.nextRosterIndex),
		total,
		getAutoRefreshJobElapsedMs_(executionStartMs),
		getAutoRefreshJobRemainingMs_(executionStartMs),
	);
	let chunkResult = null;
	if (String(job.status || "") !== "finalizing" && toNonNegativeInt_(job.nextRosterIndex) < total) {
		chunkResult = processAutoRefreshJobChunk_(job, executionStartMs);
	}
	const complete = toNonNegativeInt_(job.nextRosterIndex) >= total;
	if (!complete) {
		job.status = "running";
		return deferAutoRefreshJobForBudget_(
			job,
			chunkResult && chunkResult.budgetStopReason ? "chunk-" + chunkResult.budgetStopReason : "chunkIncomplete",
			executionStartMs,
			AUTO_REFRESH_JOB_ROSTER_START_RESERVE_MS,
		);
	}
	job.status = "finalizing";
	if (!hasAutoRefreshJobBudgetFor_(executionStartMs, AUTO_REFRESH_JOB_FINALIZE_RESERVE_MS)) {
		return deferAutoRefreshJobForBudget_(job, "finalizingDeferred", executionStartMs, AUTO_REFRESH_JOB_FINALIZE_RESERVE_MS);
	}
	return finalizeAutoRefreshJob_(job, { executionStartMs: executionStartMs });
}

// Start a new auto-refresh job or resume an existing one.
function startOrResumeAutoRefreshJob_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const executionStartMs = Math.max(0, Number(options.executionStartMs) || Date.now());
	const startedAt = String(options.startedAt || new Date().toISOString());
	const isResume = options.resume === true;
	const retryFreshIfNoJob = options.retryFreshIfNoJob === true;
	Logger.log(
		"autoRefresh job lock request resume=%s retryFreshIfNoJob=%s elapsedMs=%s remainingMs=%s",
		isResume,
		retryFreshIfNoJob,
		getAutoRefreshJobElapsedMs_(executionStartMs),
		getAutoRefreshJobRemainingMs_(executionStartMs),
	);
	let result = null;
	let lockAcquired = false;
	try {
		result = withActiveRosterJobLock_("auto-refresh-job", 0, function () {
			lockAcquired = true;
			Logger.log(
				"autoRefresh job lock acquired resume=%s retryFreshIfNoJob=%s elapsedMs=%s remainingMs=%s",
				isResume,
				retryFreshIfNoJob,
				getAutoRefreshJobElapsedMs_(executionStartMs),
				getAutoRefreshJobRemainingMs_(executionStartMs),
			);
			touchActiveRosterLockLease_("auto-refresh job start");
			let job = readAutoRefreshJobState_();
			if (isContinuableAutoRefreshJob_(job)) {
				clearAutoRefreshFreshRetryPending_();
				Logger.log(
					"autoRefresh job resume jobId=%s status=%s nextRosterIndex=%s elapsedMs=%s remainingMs=%s",
					String(job.jobId || ""),
					String(job.status || ""),
					toNonNegativeInt_(job.nextRosterIndex),
					getAutoRefreshJobElapsedMs_(executionStartMs),
					getAutoRefreshJobRemainingMs_(executionStartMs),
				);
				return continueAutoRefreshJobCore_(job, { executionStartMs: executionStartMs });
			}
			if (job) {
				Logger.log("autoRefresh job clearing non-running current job jobId=%s status=%s", String(job.jobId || ""), String(job.status || ""));
				clearAutoRefreshJobState_();
			}
			if (isResume && !retryFreshIfNoJob) {
				removeAutoRefreshJobResumeTriggers_();
				return { ok: true, status: "skipped", skipped: true, reason: "noJob" };
			}
			if (isResume && retryFreshIfNoJob) {
				Logger.log("autoRefresh job resume found no persisted job; retrying fresh job creation.");
				clearAutoRefreshFreshRetryPending_();
			}
			const cooldownStartMs = Date.now();
			if (isRecentSuccessfulActiveWrite_({ ignoreAutoRefreshWrites: true })) {
				const lastWriteAt = String(getLastSuccessfulActiveWriteAt_() || "").trim();
				const lastWriteSource = String(getLastSuccessfulActiveWriteSource_() || "").trim();
				const sourceSuffix = lastWriteSource ? " by " + lastWriteSource : "";
				let summary = "Auto-refresh skipped: active data was written recently" + sourceSuffix + " (" + (lastWriteAt || "unknown") + ").";
				const cleanupResult = maybeCleanupOldAutoRefreshDailyArchives_(getServerDateString_(new Date()));
				const cleanupDeleted = toNonNegativeInt_(cleanupResult && cleanupResult.deletedCount);
				if (cleanupDeleted > 0) {
					summary += " Cleaned " + cleanupDeleted + " stale daily archive(s).";
				}
				setAutoRefreshRunResult_("skipped", summary, "", 0, "", startedAt, new Date().toISOString());
				tryReconcileRegularWarFinalizationTriggerState_();
				Logger.log("autoRefresh job cooldown skip durationMs=%s", Math.max(0, Date.now() - cooldownStartMs));
				return { ok: true, status: "skipped", skipped: true, reason: "cooldown", lastWriteAt: lastWriteAt };
			}
			Logger.log("autoRefresh job source read start elapsedMs=%s remainingMs=%s", getAutoRefreshJobElapsedMs_(executionStartMs), getAutoRefreshJobRemainingMs_(executionStartMs));
			const sourceReadStartMs = Date.now();
			const sourceSnapshot = readActiveRosterSnapshot_();
			Logger.log("autoRefresh job source read done durationMs=%s elapsedMs=%s remainingMs=%s", Math.max(0, Date.now() - sourceReadStartMs), getAutoRefreshJobElapsedMs_(executionStartMs), getAutoRefreshJobRemainingMs_(executionStartMs));
			if (!hasAutoRefreshJobBudgetFor_(executionStartMs, AUTO_REFRESH_JOB_STATE_WRITE_RESERVE_MS)) {
				return deferFreshAutoRefreshStartForBudget_(
					"sourceReadTooSlowBeforeInitialStateWrite",
					startedAt,
					executionStartMs,
					AUTO_REFRESH_JOB_STATE_WRITE_RESERVE_MS,
				);
			}
			job = createAutoRefreshJobState_(sourceSnapshot, {
				allowRegularWarHistoryRepair: false,
				allowRegularWarProvisionalFallback: false,
			});
			if (!hasAutoRefreshJobBudgetFor_(executionStartMs, AUTO_REFRESH_JOB_STATE_WRITE_RESERVE_MS)) {
				return deferFreshAutoRefreshStartForBudget_(
					"jobCreateTooSlowBeforeInitialStateWrite",
					startedAt,
					executionStartMs,
					AUTO_REFRESH_JOB_STATE_WRITE_RESERVE_MS,
				);
			}
			writeAutoRefreshJobState_(job, { writeKind: "initial", writeScope: "full" });
			if (!hasAutoRefreshJobBudgetFor_(executionStartMs, AUTO_REFRESH_JOB_ROSTER_START_RESERVE_MS)) {
				return deferAutoRefreshJobForBudget_(job, "afterJobCreate", executionStartMs, AUTO_REFRESH_JOB_ROSTER_START_RESERVE_MS);
			}
			return continueAutoRefreshJobCore_(job, { executionStartMs: executionStartMs });
		});
		return result;
	} finally {
		Logger.log(
			"autoRefresh job lock released acquired=%s resume=%s retryFreshIfNoJob=%s elapsedMs=%s remainingMs=%s status=%s reason=%s",
			lockAcquired,
			isResume,
			retryFreshIfNoJob,
			getAutoRefreshJobElapsedMs_(executionStartMs),
			getAutoRefreshJobRemainingMs_(executionStartMs),
			String((result && result.status) || ""),
			String((result && result.reason) || ""),
		);
	}
}

// Fail and clear any current job when auto-refresh is disabled.
function cleanupAutoRefreshJobAfterDisabled_() {
	removeAutoRefreshJobResumeTriggers_();
	clearAutoRefreshFreshRetryPending_();
	try {
		const job = readAutoRefreshJobState_();
		if (job) {
			job.status = "failed";
			job.failedAt = new Date().toISOString();
			job.error = "Auto-refresh was disabled before the resumable job completed.";
			archiveAndClearAutoRefreshJobStateBestEffort_(job, "autoRefresh job disabled cleanup");
			Logger.log("autoRefresh job disabled cleanup jobId=%s", String(job.jobId || ""));
		}
	} catch (err) {
		Logger.log("autoRefresh job disabled cleanup failed: %s", errorMessage_(err));
	}
}

// Mark the current job failed and remove resumable state after an unrecoverable execution error.
function failCurrentAutoRefreshJobAfterError_(messageRaw) {
	const message = String(messageRaw == null ? "" : messageRaw).trim() || "Auto-refresh job failed.";
	removeAutoRefreshJobResumeTriggers_();
	clearAutoRefreshFreshRetryPending_();
	try {
		const job = readAutoRefreshJobState_();
		if (job) {
			job.status = "failed";
			job.failedAt = new Date().toISOString();
			job.error = message;
			archiveAndClearAutoRefreshJobStateBestEffort_(job, "autoRefresh job failed cleanup");
			Logger.log("autoRefresh job failed cleanup jobId=%s error=%s", String(job.jobId || ""), message);
		}
	} catch (err) {
		Logger.log("autoRefresh job failed cleanup failed: %s", errorMessage_(err));
	}
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

// Handle list resumable auto-refresh resume triggers.
function listAutoRefreshJobResumeTriggers_() {
	const all = ScriptApp.getProjectTriggers();
	return all.filter((trigger) => {
		try {
			return String(trigger.getHandlerFunction() || "") === AUTO_REFRESH_JOB_HANDLER_NAME;
		} catch (err) {
			return false;
		}
	});
}

// Remove resumable auto-refresh resume triggers.
function removeAutoRefreshJobResumeTriggers_() {
	const triggers = listAutoRefreshJobResumeTriggers_();
	let removed = 0;
	for (let i = 0; i < triggers.length; i++) {
		try {
			ScriptApp.deleteTrigger(triggers[i]);
			removed++;
		} catch (err) {
			Logger.log("Unable to delete auto-refresh resume trigger: %s", errorMessage_(err));
		}
	}
	PropertiesService.getScriptProperties().deleteProperty(AUTO_REFRESH_JOB_TRIGGER_ID_PROPERTY);
	return removed;
}

// Schedule exactly one one-shot resumable auto-refresh trigger.
function scheduleAutoRefreshJobResume_() {
	removeAutoRefreshJobResumeTriggers_();
	const trigger = ScriptApp.newTrigger(AUTO_REFRESH_JOB_HANDLER_NAME)
		.timeBased()
		.after(AUTO_REFRESH_JOB_RESUME_DELAY_MS)
		.create();
	const triggerId = getTriggerUniqueId_(trigger);
	if (triggerId) PropertiesService.getScriptProperties().setProperty(AUTO_REFRESH_JOB_TRIGGER_ID_PROPERTY, triggerId);
	else PropertiesService.getScriptProperties().deleteProperty(AUTO_REFRESH_JOB_TRIGGER_ID_PROPERTY);
	Logger.log("autoRefresh job resume scheduled triggerId=%s delayMs=%s", triggerId, AUTO_REFRESH_JOB_RESUME_DELAY_MS);
	return { triggerId: triggerId, delayMs: AUTO_REFRESH_JOB_RESUME_DELAY_MS };
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
		removeAutoRefreshJobResumeTriggers_();
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
		resumeTriggerId: String(props.getProperty(AUTO_REFRESH_JOB_TRIGGER_ID_PROPERTY) || "").trim(),
		hasResumeTrigger: !!String(props.getProperty(AUTO_REFRESH_JOB_TRIGGER_ID_PROPERTY) || "").trim(),
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
	const tickStartMs = Date.now();
	const startedAt = new Date().toISOString();
	let resultForLog = null;
	Logger.log("autoRefreshActiveRosterTick start startedAt=%s", startedAt);

	try {
		if (!isAutoRefreshEnabled_()) {
			cleanupAutoRefreshJobAfterDisabled_();
			setAutoRefreshRunResult_("skipped", "Auto-refresh skipped because it is disabled.", "", 0, "", startedAt, new Date().toISOString());
			tryReconcileRegularWarFinalizationTriggerState_();
			resultForLog = { ok: true, status: "skipped", skipped: true, reason: "disabled" };
			return resultForLog;
		}

		PropertiesService.getScriptProperties().setProperty(AUTO_REFRESH_LAST_RUN_STARTED_AT_PROPERTY, startedAt);
		const result = startOrResumeAutoRefreshJob_({ executionStartMs: Date.now(), startedAt: startedAt });
		resultForLog = result;
		if (result && result.inProgress) {
			Logger.log("autoRefreshActiveRosterTick in progress processedRosters=%s totalRosters=%s", toNonNegativeInt_(result.processedRosters), toNonNegativeInt_(result.totalRosters));
			return result;
		}
		if (result && result.skipped) {
			Logger.log("autoRefreshActiveRosterTick skipped reason=%s", String(result.reason || ""));
			return result;
		}
		if (result && result.stale) {
			Logger.log("autoRefreshActiveRosterTick stale: %s", String(result.summary || ""));
			return result;
		}
		Logger.log("autoRefreshActiveRosterTick ok: %s", String(result && result.summary ? result.summary : ""));
		return result;
	} catch (err) {
		if (isActiveRosterJobLockBusyError_(err)) {
			setAutoRefreshRunResult_("skipped", "Auto-refresh skipped due to overlap with another active roster refresh/publish flow.", "", 0, "", startedAt, new Date().toISOString());
			tryReconcileRegularWarFinalizationTriggerState_();
			resultForLog = { ok: true, status: "skipped", skipped: true, reason: "overlap" };
			return resultForLog;
		}
		const message = errorMessage_(err);
		failCurrentAutoRefreshJobAfterError_(message);
		setAutoRefreshRunResult_("error", "Auto-refresh run failed.", message, 0, "", startedAt, new Date().toISOString());
		tryReconcileRegularWarFinalizationTriggerState_();
		Logger.log("autoRefreshActiveRosterTick failed: %s", message);
		resultForLog = { ok: false, status: "error", error: message };
		return resultForLog;
	} finally {
		Logger.log(
			"autoRefreshActiveRosterTick end status=%s reason=%s elapsedMs=%s",
			String((resultForLog && resultForLog.status) || ""),
			String((resultForLog && resultForLog.reason) || ""),
			Math.max(0, Date.now() - tickStartMs),
		);
	}
}

// Handle resumable auto-refresh one-shot trigger.
function autoRefreshJobResumeTick() {
	const tickStartMs = Date.now();
	const startedAt = new Date().toISOString();
	let resultForLog = null;
	Logger.log("autoRefreshJobResumeTick start startedAt=%s", startedAt);
	try {
		if (!isAutoRefreshEnabled_()) {
			cleanupAutoRefreshJobAfterDisabled_();
			setAutoRefreshRunResult_("skipped", "Auto-refresh resume skipped because auto-refresh is disabled.", "", 0, "", startedAt, new Date().toISOString());
			tryReconcileRegularWarFinalizationTriggerState_();
			resultForLog = { ok: true, status: "skipped", skipped: true, reason: "disabled" };
			return resultForLog;
		}
		const result = startOrResumeAutoRefreshJob_({
			resume: true,
			retryFreshIfNoJob: isAutoRefreshFreshRetryPending_(),
			executionStartMs: Date.now(),
			startedAt: startedAt,
		});
		resultForLog = result;
		if (result && result.inProgress) {
			Logger.log("autoRefreshJobResumeTick in progress processedRosters=%s totalRosters=%s", toNonNegativeInt_(result.processedRosters), toNonNegativeInt_(result.totalRosters));
		} else if (result && result.stale) {
			Logger.log("autoRefreshJobResumeTick stale: %s", String(result.summary || ""));
		} else {
			Logger.log("autoRefreshJobResumeTick done: %s", String(result && result.summary ? result.summary : ""));
		}
		return result;
	} catch (err) {
		if (isActiveRosterJobLockBusyError_(err)) {
			scheduleAutoRefreshJobResume_();
			setAutoRefreshRunResult_("inProgress", "Auto-refresh resume deferred due to overlap with another active roster refresh/publish flow.", "", 0, "", startedAt, new Date().toISOString());
			resultForLog = { ok: true, status: "inProgress", inProgress: true, reason: "overlap" };
			return resultForLog;
		}
		const message = errorMessage_(err);
		failCurrentAutoRefreshJobAfterError_(message);
		setAutoRefreshRunResult_("error", "Auto-refresh resume failed.", message, 0, "", startedAt, new Date().toISOString());
		Logger.log("autoRefreshJobResumeTick failed: %s", message);
		resultForLog = { ok: false, status: "error", error: message };
		return resultForLog;
	} finally {
		Logger.log(
			"autoRefreshJobResumeTick end status=%s reason=%s elapsedMs=%s",
			String((resultForLog && resultForLog.status) || ""),
			String((resultForLog && resultForLog.reason) || ""),
			Math.max(0, Date.now() - tickStartMs),
		);
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
