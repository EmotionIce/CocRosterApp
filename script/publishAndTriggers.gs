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

// Firebase paths and lifecycle for the sharded auto-refresh queue:
// current keeps only coordinator state; per-run source/task/result shards live under
// internal/autoRefresh/runs/{runId}; completed output is published through
// activePublished/currentVersionId -> activeVersions/{runId}.

// Build a Firebase path below /internal/autoRefresh/runs/{runId}.
function buildAutoRefreshRunPath_(runIdRaw, childPathRaw) {
	const runId = normalizeActiveVersionId_(runIdRaw);
	if (!runId) throw new Error("Auto-refresh run id is required.");
	const basePath = buildFirebaseChildPath_(FIREBASE_INTERNAL_AUTO_REFRESH_RUNS_PATH, encodeFirebaseObjectKey_(runId));
	const childPath = normalizeFirebasePath_(childPathRaw);
	return childPath ? buildFirebaseChildPath_(basePath, childPath) : basePath;
}

// Build a deterministic task id.
function buildAutoRefreshTaskId_(indexRaw, typeRaw, rosterIdRaw) {
	const index = Math.max(0, toNonNegativeInt_(indexRaw));
	const prefix = ("0000" + index).slice(-4);
	const type = String(typeRaw == null ? "task" : typeRaw)
		.trim()
		.replace(/[^A-Za-z0-9_-]/g, "_")
		.slice(0, 40) || "task";
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw)
		.trim()
		.replace(/[^A-Za-z0-9_-]/g, "_")
		.slice(0, 80);
	return rosterId ? prefix + "-" + type + "-" + rosterId : prefix + "-" + type;
}

// Normalize the tiny queue current state.
function normalizeAutoRefreshQueueCurrent_(stateRaw) {
	const state = stateRaw && typeof stateRaw === "object" ? stateRaw : null;
	if (!state) return null;
	const rosterIdsRaw = Array.isArray(state.rosterIds) ? state.rosterIds : [];
	const rosterIds = [];
	for (let i = 0; i < rosterIdsRaw.length; i++) {
		const rosterId = String(rosterIdsRaw[i] == null ? "" : rosterIdsRaw[i]).trim();
		if (rosterId) rosterIds.push(rosterId);
	}
	const taskIdsRaw = Array.isArray(state.taskIds) ? state.taskIds : [];
	const taskIds = [];
	for (let i = 0; i < taskIdsRaw.length; i++) {
		const taskId = String(taskIdsRaw[i] == null ? "" : taskIdsRaw[i]).trim();
		if (taskId) taskIds.push(taskId);
	}
	return {
		runId: normalizeActiveVersionId_(state.runId),
		kind: String(state.kind || "auto-refresh-queue"),
		status: String(state.status || "running"),
		phase: String(state.phase || "queued"),
		startedAt: String(state.startedAt || ""),
		updatedAt: String(state.updatedAt || ""),
		completedAt: String(state.completedAt || ""),
		failedAt: String(state.failedAt || ""),
		error: String(state.error || ""),
		sourceFingerprint: String(state.sourceFingerprint || ""),
		sourceLastUpdatedAt: String(state.sourceLastUpdatedAt || ""),
		rosterIds: rosterIds,
		taskIds: taskIds,
		taskCount: Math.max(0, toNonNegativeInt_(state.taskCount || taskIds.length)),
		currentTaskIndex: Math.max(0, toNonNegativeInt_(state.currentTaskIndex)),
		processedTasks: Math.max(0, toNonNegativeInt_(state.processedTasks)),
		processedRosters: Math.max(0, toNonNegativeInt_(state.processedRosters)),
		issueCount: Math.max(0, toNonNegativeInt_(state.issueCount)),
		issueSummary: String(state.issueSummary || "").slice(0, 500),
		taskSummary: state.taskSummary && typeof state.taskSummary === "object" ? state.taskSummary : null,
		lock: state.lock && typeof state.lock === "object" ? state.lock : null,
	};
}

// Read tiny queue current state from Firebase.
function readAutoRefreshQueueCurrent_() {
	const kindValue = firebaseRequestJson_(buildFirebaseChildPath_(FIREBASE_INTERNAL_AUTO_REFRESH_JOB_PATH, "kind"), "GET");
	const kind = String(kindValue == null ? "" : kindValue).trim();
	if (kind && kind !== "auto-refresh-queue") {
		return {
			kind: kind,
			legacy: true,
			runId: "",
			status: "",
			rosterIds: [],
			taskIds: [],
			taskCount: 0,
			currentTaskIndex: 0,
			processedTasks: 0,
			processedRosters: 0,
			issueCount: 0,
			issueSummary: "",
		};
	}
	if (!kind) return null;
	const encoded = firebaseRequestJson_(FIREBASE_INTERNAL_AUTO_REFRESH_JOB_PATH, "GET");
	if (!encoded || typeof encoded !== "object" || Array.isArray(encoded)) return null;
	return normalizeAutoRefreshQueueCurrent_(decodeFirebaseObjectKeysRecursive_(encoded));
}

// Write tiny queue current state to Firebase.
function writeAutoRefreshQueueCurrent_(stateRaw, patchRaw) {
	const state = normalizeAutoRefreshQueueCurrent_(stateRaw);
	if (!state || !state.runId) throw new Error("Auto-refresh current state is missing a run id.");
	state.updatedAt = new Date().toISOString();
	const method = patchRaw === true ? "PATCH" : "PUT";
	firebaseRequestJson_(FIREBASE_INTERNAL_AUTO_REFRESH_JOB_PATH, method, encodeFirebaseObjectKeysRecursive_(state));
	return state;
}

// Clear tiny queue current state.
function clearAutoRefreshQueueCurrent_() {
	firebaseRequestJson_(FIREBASE_INTERNAL_AUTO_REFRESH_JOB_PATH, "DELETE");
}

// Read a decoded run shard.
function readAutoRefreshRunShard_(runIdRaw, childPathRaw) {
	const encoded = firebaseRequestJson_(buildAutoRefreshRunPath_(runIdRaw, childPathRaw), "GET");
	if (encoded == null) return null;
	return decodeFirebaseObjectKeysRecursive_(encoded);
}

// Write an encoded run shard.
function writeAutoRefreshRunShard_(runIdRaw, childPathRaw, valueRaw, methodRaw) {
	const method = String(methodRaw == null ? "PUT" : methodRaw).trim().toUpperCase() || "PUT";
	return firebaseRequestJson_(buildAutoRefreshRunPath_(runIdRaw, childPathRaw), method, encodeFirebaseObjectKeysRecursive_(valueRaw));
}

// Read a task record.
function readAutoRefreshTask_(runIdRaw, taskIdRaw) {
	const taskId = String(taskIdRaw == null ? "" : taskIdRaw).trim();
	if (!taskId) return null;
	return readAutoRefreshRunShard_(runIdRaw, "tasks/" + encodeFirebaseObjectKey_(taskId));
}

// Write a task record.
function writeAutoRefreshTask_(runIdRaw, taskRaw) {
	const task = taskRaw && typeof taskRaw === "object" ? taskRaw : {};
	const taskId = String(task.taskId == null ? "" : task.taskId).trim();
	if (!taskId) throw new Error("Auto-refresh task id is required.");
	task.updatedAt = new Date().toISOString();
	writeAutoRefreshRunShard_(runIdRaw, "tasks/" + encodeFirebaseObjectKey_(taskId), task, "PUT");
	return task;
}

// Build the queue tasks for one run. One bounded roster task runs the existing
// single-roster pipeline; the final task validates shards and publishes the version pointer.
function buildAutoRefreshQueueTasks_(runIdRaw, rosterIdsRaw) {
	const runId = normalizeActiveVersionId_(runIdRaw);
	const rosterIds = Array.isArray(rosterIdsRaw) ? rosterIdsRaw : [];
	const tasks = [];
	for (let i = 0; i < rosterIds.length; i++) {
		const rosterId = String(rosterIds[i] == null ? "" : rosterIds[i]).trim();
		if (!rosterId) continue;
		tasks.push({
			taskId: buildAutoRefreshTaskId_(tasks.length, "roster", rosterId),
			runId: runId,
			type: "roster",
			status: "pending",
			rosterId: rosterId,
			index: tasks.length,
			attempts: 0,
			startedAt: "",
			updatedAt: "",
			completedAt: "",
			error: "",
			summary: "",
		});
	}
	tasks.push({
		taskId: buildAutoRefreshTaskId_(tasks.length, "finalize", ""),
		runId: runId,
		type: "finalize",
		status: "pending",
		rosterId: "",
		index: tasks.length,
		attempts: 0,
		startedAt: "",
		updatedAt: "",
		completedAt: "",
		error: "",
		summary: "",
	});
	return tasks;
}

// Persist all task records for a run.
function writeAutoRefreshQueueTasks_(runIdRaw, tasksRaw) {
	const tasks = Array.isArray(tasksRaw) ? tasksRaw : [];
	const taskMap = {};
	const taskIds = [];
	for (let i = 0; i < tasks.length; i++) {
		const task = tasks[i] && typeof tasks[i] === "object" ? tasks[i] : {};
		const taskId = String(task.taskId || "").trim();
		if (!taskId) continue;
		taskMap[taskId] = task;
		taskIds.push(taskId);
	}
	writeAutoRefreshRunShard_(runIdRaw, "tasks", taskMap, "PUT");
	return taskIds;
}

// Build source metadata stored once for a run.
function buildAutoRefreshRunSourceMeta_(runIdRaw, rosterDataRaw, sourceFingerprintRaw, runPlanRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const runPlan = runPlanRaw && typeof runPlanRaw === "object" ? runPlanRaw : {};
	const rosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	const connectedClanTagByRosterId = {};
	const connectedRosterIds = [];
	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		const rosterId = String(roster.id || "").trim();
		const clanTag = normalizeTag_(roster.connectedClanTag);
		if (!rosterId || !clanTag) continue;
		connectedClanTagByRosterId[rosterId] = clanTag;
		connectedRosterIds.push(rosterId);
	}
	const meta = {
		runId: normalizeActiveVersionId_(runIdRaw),
		schemaVersion: typeof rosterData.schemaVersion === "number" && isFinite(rosterData.schemaVersion) ? rosterData.schemaVersion : 1,
		pageTitle: typeof rosterData.pageTitle === "string" ? rosterData.pageTitle : "",
		rosterOrder: Array.isArray(rosterData.rosterOrder) ? rosterData.rosterOrder.slice() : [],
		rosterIds: Array.isArray(runPlan.rosterIds) ? runPlan.rosterIds.slice() : [],
		connectedClanTagByRosterId: connectedClanTagByRosterId,
		connectedRosterIds: connectedRosterIds,
		sourceFingerprint: String(sourceFingerprintRaw || ""),
		sourceLastUpdatedAt: String(rosterData.lastUpdatedAt || ""),
		createdAt: new Date().toISOString(),
	};
	if (rosterData.publicConfig && typeof rosterData.publicConfig === "object") meta.publicConfig = rosterData.publicConfig;
	return meta;
}

// Write source shards used by workers. Large source data is stored under the run,
// never in /internal/autoRefresh/current.
function buildAutoRefreshSourceOwnershipIndex_(rosterDataRaw, liveClanSnapshotByTagRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const liveClanSnapshotByTag = liveClanSnapshotByTagRaw && typeof liveClanSnapshotByTagRaw === "object" ? liveClanSnapshotByTagRaw : {};
	const rosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	const sourceOwnerRosterIdByTag = {};
	const liveOwnerRosterIdByTag = {};
	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		const rosterId = String(roster.id || "").trim();
		if (!rosterId) continue;
		const players = collectRosterPoolPlayers_(roster);
		for (let j = 0; j < players.length; j++) {
			const tag = normalizeTag_(players[j] && players[j].tag);
			if (tag && !sourceOwnerRosterIdByTag[tag]) sourceOwnerRosterIdByTag[tag] = rosterId;
		}
		const clanTag = normalizeTag_(roster.connectedClanTag);
		const snapshot = clanTag && liveClanSnapshotByTag[clanTag] && typeof liveClanSnapshotByTag[clanTag] === "object" ? liveClanSnapshotByTag[clanTag] : null;
		const members = Array.isArray(snapshot && snapshot.members) ? snapshot.members : [];
		for (let j = 0; j < members.length; j++) {
			const tag = normalizeTag_(members[j] && members[j].tag);
			if (tag && !liveOwnerRosterIdByTag[tag]) liveOwnerRosterIdByTag[tag] = rosterId;
		}
	}
	return {
		sourceOwnerRosterIdByTag: sourceOwnerRosterIdByTag,
		liveOwnerRosterIdByTag: liveOwnerRosterIdByTag,
	};
}

// Fetch only compact live ownership needed to preserve cross-roster move semantics
// while keeping full clan/member snapshots out of current job state.
function collectAutoRefreshSourceOwnershipIndex_(rosterDataRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const rosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	const clanTagSet = {};
	for (let i = 0; i < rosters.length; i++) {
		const clanTag = normalizeTag_(rosters[i] && rosters[i].connectedClanTag);
		if (clanTag) clanTagSet[clanTag] = true;
	}
	const clanTags = Object.keys(clanTagSet);
	const startedMs = Date.now();
	let snapshotByClanTag = {};
	let errorByClanTag = {};
	if (clanTags.length) {
		try {
			const prefetched = prefetchClanMembersSnapshotsByTag_(clanTags, {
				batchSize: AUTO_REFRESH_PREFETCH_BATCH_SIZE,
				batchDelayMs: AUTO_REFRESH_PREFETCH_BATCH_DELAY_MS,
			});
			snapshotByClanTag = prefetched && prefetched.snapshotByClanTag && typeof prefetched.snapshotByClanTag === "object" ? prefetched.snapshotByClanTag : {};
			errorByClanTag = prefetched && prefetched.errorByClanTag && typeof prefetched.errorByClanTag === "object" ? prefetched.errorByClanTag : {};
		} catch (err) {
			Logger.log("autoRefresh coordinator live ownership prefetch failed: %s", errorMessage_(err));
		}
	}
	const ownership = buildAutoRefreshSourceOwnershipIndex_(rosterData, snapshotByClanTag);
	const errorTags = Object.keys(errorByClanTag);
	const liveOwnershipErrorByClanTag = {};
	for (let i = 0; i < errorTags.length; i++) {
		const clanTag = normalizeTag_(errorTags[i]);
		if (clanTag) liveOwnershipErrorByClanTag[clanTag] = errorMessage_(errorByClanTag[errorTags[i]]);
	}
	ownership.liveOwnershipErrorByClanTag = liveOwnershipErrorByClanTag;
	ownership.liveOwnershipReadMs = Math.max(0, Date.now() - startedMs);
	Logger.log(
		"autoRefresh coordinator live ownership clans=%s liveOwners=%s sourceOwners=%s errors=%s readMs=%s",
		clanTags.length,
		Object.keys(ownership.liveOwnerRosterIdByTag || {}).length,
		Object.keys(ownership.sourceOwnerRosterIdByTag || {}).length,
		Object.keys(liveOwnershipErrorByClanTag).length,
		ownership.liveOwnershipReadMs,
	);
	return ownership;
}

function writeAutoRefreshRunSourceShards_(runIdRaw, rosterDataRaw, sourceFingerprintRaw, runPlanRaw, sourceOwnershipIndexRaw) {
	const source = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const runPlan = runPlanRaw && typeof runPlanRaw === "object" ? runPlanRaw : {};
	const rosters = Array.isArray(source.rosters) ? source.rosters : [];
	const seedPlayerByTag = {};
	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		const rosterId = String(roster.id || "").trim();
		if (!rosterId) continue;
		writeAutoRefreshRunShard_(runIdRaw, "source/rosters/" + encodeFirebaseObjectKey_(rosterId), roster, "PUT");
		const players = collectRosterPoolPlayers_(roster);
		for (let j = 0; j < players.length; j++) {
			const player = players[j] && typeof players[j] === "object" ? players[j] : {};
			const tag = normalizeTag_(player.tag);
			if (!tag || seedPlayerByTag[tag]) continue;
			seedPlayerByTag[tag] = player;
		}
	}
	const sourceMeta = buildAutoRefreshRunSourceMeta_(runIdRaw, source, sourceFingerprintRaw, runPlan);
	const sourceOwnershipIndex = sourceOwnershipIndexRaw && typeof sourceOwnershipIndexRaw === "object"
		? sourceOwnershipIndexRaw
		: buildAutoRefreshSourceOwnershipIndex_(source, {});
	writeAutoRefreshRunShard_(runIdRaw, "source/meta", sourceMeta, "PUT");
	writeAutoRefreshRunShard_(runIdRaw, "source/playerSeeds", { byTag: seedPlayerByTag }, "PUT");
	writeAutoRefreshRunShard_(runIdRaw, "source/ownership", {
		sourceOwnerRosterIdByTag: sourceOwnershipIndex.sourceOwnerRosterIdByTag && typeof sourceOwnershipIndex.sourceOwnerRosterIdByTag === "object" ? sourceOwnershipIndex.sourceOwnerRosterIdByTag : {},
		liveOwnerRosterIdByTag: sourceOwnershipIndex.liveOwnerRosterIdByTag && typeof sourceOwnershipIndex.liveOwnerRosterIdByTag === "object" ? sourceOwnershipIndex.liveOwnerRosterIdByTag : {},
		liveOwnershipErrorByClanTag: sourceOwnershipIndex.liveOwnershipErrorByClanTag && typeof sourceOwnershipIndex.liveOwnershipErrorByClanTag === "object" ? sourceOwnershipIndex.liveOwnershipErrorByClanTag : {},
		liveOwnershipReadMs: toNonNegativeInt_(sourceOwnershipIndex.liveOwnershipReadMs),
		prepExcludedRosterIdByTag: buildCwlPreparationExcludedRosterIdByTag_(source),
		prepAssignedRosterIdByTag: buildCwlPreparationAssignedRosterIdByTag_(source),
	}, "PUT");
	const sourceMetrics = source.playerMetrics && typeof source.playerMetrics === "object" ? source.playerMetrics : createEmptyPlayerMetricsStore_();
	writeAutoRefreshRunShard_(runIdRaw, "source/playerMetrics", sanitizePlayerMetricsStore_(sourceMetrics, source.lastUpdatedAt || new Date().toISOString()), "PUT");
	return sourceMeta;
}

// Build a bounded working payload for one roster task.
function buildAutoRefreshRosterWorkingData_(sourceMetaRaw, sourceRosterRaw, sourceMetricByTagRaw) {
	const meta = sourceMetaRaw && typeof sourceMetaRaw === "object" ? sourceMetaRaw : {};
	const sourceRoster = sourceRosterRaw && typeof sourceRosterRaw === "object" ? sourceRosterRaw : {};
	const rosterId = String(sourceRoster.id || "").trim();
	const payload = {
		schemaVersion: typeof meta.schemaVersion === "number" && isFinite(meta.schemaVersion) ? meta.schemaVersion : 1,
		pageTitle: typeof meta.pageTitle === "string" ? meta.pageTitle : "",
		rosterOrder: rosterId ? [rosterId] : [],
		rosters: rosterId ? [cloneAutoRefreshJobJson_(sourceRoster)] : [],
		playerMetrics: {
			schemaVersion: PLAYER_METRICS_SCHEMA_VERSION,
			updatedAt: String(meta.sourceLastUpdatedAt || ""),
			byTag: sourceMetricByTagRaw && typeof sourceMetricByTagRaw === "object" ? sourceMetricByTagRaw : {},
		},
	};
	if (meta.sourceLastUpdatedAt) payload.lastUpdatedAt = String(meta.sourceLastUpdatedAt || "");
	if (meta.publicConfig && typeof meta.publicConfig === "object") payload.publicConfig = meta.publicConfig;
	return payload;
}

// Read source map entries for only the player tags a bounded roster task can touch.
function readAutoRefreshSourceEntriesForTags_(runIdRaw, basePathRaw, tagsRaw) {
	const tags = Array.isArray(tagsRaw) ? tagsRaw : [];
	const byTag = {};
	const seen = {};
	const basePath = normalizeFirebasePath_(basePathRaw);
	const pathByTag = {};
	const paths = [];
	for (let i = 0; i < tags.length; i++) {
		const tag = normalizeTag_(tags[i]);
		if (!tag || seen[tag]) continue;
		seen[tag] = true;
		const path = buildAutoRefreshRunPath_(runIdRaw, basePath + "/" + encodeFirebaseObjectKey_(tag));
		pathByTag[tag] = path;
		paths.push(path);
	}
	const encodedByPath = firebaseBatchGetJson_(paths);
	const outTags = Object.keys(pathByTag);
	for (let i = 0; i < outTags.length; i++) {
		const tag = outTags[i];
		const entry = encodedByPath[pathByTag[tag]];
		if (entry && typeof entry === "object") byTag[tag] = decodeFirebaseObjectKeysRecursive_(entry);
	}
	return byTag;
}

// Read source metrics for only the player tags a bounded roster task can touch.
function readAutoRefreshSourceMetricEntriesForTags_(runIdRaw, tagsRaw) {
	return readAutoRefreshSourceEntriesForTags_(runIdRaw, "source/playerMetrics/byTag", tagsRaw);
}

// Read source roster seed players for only live clan tags in this task.
function readAutoRefreshSourcePlayerSeedEntriesForTags_(runIdRaw, tagsRaw) {
	return readAutoRefreshSourceEntriesForTags_(runIdRaw, "source/playerSeeds/byTag", tagsRaw);
}

// Build a per-roster ownership snapshot from compact source indexes plus the
// current roster's live clan snapshot. Metrics are derived from the full clan
// members response; no individual player profile lookups are used in this path.
function buildAutoRefreshRosterOwnershipSnapshot_(sourceMetaRaw, sourceRosterRaw, rosterIdRaw, clanSnapshotRaw, sourceSeedByTagRaw, sourceOwnershipRaw) {
	const meta = sourceMetaRaw && typeof sourceMetaRaw === "object" ? sourceMetaRaw : {};
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	const clanSnapshot = clanSnapshotRaw && typeof clanSnapshotRaw === "object" ? clanSnapshotRaw : null;
	const members = Array.isArray(clanSnapshot && clanSnapshot.members) ? clanSnapshot.members : [];
	const ownerRosterIdByTag = {};
	const liveOwnerRosterIdByTag = {};
	const liveMemberByTag = {};
	const membersByRosterId = {};
	const memberTagSetByRosterId = {};
	const tagSet = {};
	const sourceOwnership = sourceOwnershipRaw && typeof sourceOwnershipRaw === "object" ? sourceOwnershipRaw : {};
	const liveOwnershipErrorByClanTag = sourceOwnership.liveOwnershipErrorByClanTag && typeof sourceOwnership.liveOwnershipErrorByClanTag === "object"
		? sourceOwnership.liveOwnershipErrorByClanTag
		: {};
	const copyOwnerMap = (mapRaw) => {
		const map = mapRaw && typeof mapRaw === "object" ? mapRaw : {};
		const tags = Object.keys(map);
		for (let i = 0; i < tags.length; i++) {
			const tag = normalizeTag_(tags[i]);
			const owner = String(map[tags[i]] || "").trim();
			if (tag && owner) ownerRosterIdByTag[tag] = owner;
		}
	};
	copyOwnerMap(sourceOwnership.sourceOwnerRosterIdByTag);
	copyOwnerMap(sourceOwnership.liveOwnerRosterIdByTag);
	const sourceLiveOwnerRosterIdByTag = sourceOwnership.liveOwnerRosterIdByTag && typeof sourceOwnership.liveOwnerRosterIdByTag === "object"
		? sourceOwnership.liveOwnerRosterIdByTag
		: {};
	const sourceLiveOwnerTags = Object.keys(sourceLiveOwnerRosterIdByTag);
	for (let i = 0; i < sourceLiveOwnerTags.length; i++) {
		const tag = normalizeTag_(sourceLiveOwnerTags[i]);
		const owner = String(sourceLiveOwnerRosterIdByTag[sourceLiveOwnerTags[i]] || "").trim();
		if (tag && owner) liveOwnerRosterIdByTag[tag] = owner;
	}
	for (let i = 0; i < members.length; i++) {
		const member = members[i] && typeof members[i] === "object" ? members[i] : {};
		const tag = normalizeTag_(member.tag);
		if (!tag) continue;
		tagSet[tag] = true;
		ownerRosterIdByTag[tag] = rosterId;
		liveOwnerRosterIdByTag[tag] = rosterId;
		liveMemberByTag[tag] = member;
	}
	membersByRosterId[rosterId] = members;
	memberTagSetByRosterId[rosterId] = tagSet;
	const prepExcludedRosterIdByTag = sourceOwnership.prepExcludedRosterIdByTag && typeof sourceOwnership.prepExcludedRosterIdByTag === "object"
		? sourceOwnership.prepExcludedRosterIdByTag
		: {};
	const excludedTags = Object.keys(prepExcludedRosterIdByTag);
	for (let i = 0; i < excludedTags.length; i++) {
		const tag = normalizeTag_(excludedTags[i]);
		const owner = String(prepExcludedRosterIdByTag[excludedTags[i]] || "").trim();
		if (tag && liveOwnerRosterIdByTag[tag]) continue;
		if (tag && owner) ownerRosterIdByTag[tag] = owner;
	}
	const prepAssignedRosterIdByTag = sourceOwnership.prepAssignedRosterIdByTag && typeof sourceOwnership.prepAssignedRosterIdByTag === "object"
		? sourceOwnership.prepAssignedRosterIdByTag
		: {};
	const assignedTags = Object.keys(prepAssignedRosterIdByTag);
	for (let i = 0; i < assignedTags.length; i++) {
		const tag = normalizeTag_(assignedTags[i]);
		const owner = String(prepAssignedRosterIdByTag[assignedTags[i]] || "").trim();
		if (tag && liveOwnerRosterIdByTag[tag]) continue;
		if (tag && owner) ownerRosterIdByTag[tag] = owner;
	}
	const seedPlayerByTag = sourceSeedByTagRaw && typeof sourceSeedByTagRaw === "object" ? sourceSeedByTagRaw : {};
	const connectedClanTagByRosterId = meta.connectedClanTagByRosterId && typeof meta.connectedClanTagByRosterId === "object"
		? meta.connectedClanTagByRosterId
		: {};
	const connectedRosterIds = Array.isArray(meta.connectedRosterIds) ? meta.connectedRosterIds : [];
	return {
		membersByRosterId: membersByRosterId,
		memberTagSetByRosterId: memberTagSetByRosterId,
		ownerRosterIdByTag: ownerRosterIdByTag,
		liveOwnerRosterIdByTag: liveOwnerRosterIdByTag,
		prepExcludedRosterIdByTag: prepExcludedRosterIdByTag,
		prepAssignedRosterIdByTag: prepAssignedRosterIdByTag,
		liveOwnershipErrorByClanTag: liveOwnershipErrorByClanTag,
		liveMemberByTag: liveMemberByTag,
		connectedClanTagByRosterId: connectedClanTagByRosterId,
		connectedRosterIds: connectedRosterIds,
		poolSyncErrorByTag: {},
		seedPlayerByTag: seedPlayerByTag,
		autoRefreshSnapshotMode: false,
	};
}

// Extract metric entries touched by a roster task.
function buildRosterMetricResult_(workingRosterDataRaw, capturedTagsRaw, captureSummaryRaw) {
	const workingRosterData = workingRosterDataRaw && typeof workingRosterDataRaw === "object" ? workingRosterDataRaw : {};
	const store = workingRosterData.playerMetrics && typeof workingRosterData.playerMetrics === "object" ? workingRosterData.playerMetrics : {};
	const byTagRaw = store.byTag && typeof store.byTag === "object" ? store.byTag : {};
	const capturedTags = Array.isArray(capturedTagsRaw) ? capturedTagsRaw : [];
	const byTag = {};
	const seen = {};
	for (let i = 0; i < capturedTags.length; i++) {
		const tag = normalizeTag_(capturedTags[i]);
		if (!tag || seen[tag]) continue;
		seen[tag] = true;
		if (byTagRaw[tag] && typeof byTagRaw[tag] === "object") byTag[tag] = byTagRaw[tag];
	}
	return {
		byTag: byTag,
		tags: Object.keys(byTag),
		summary: captureSummaryRaw && typeof captureSummaryRaw === "object" ? captureSummaryRaw : {},
	};
}

// Build the roster result shard from a single-roster pipeline output.
function buildRosterWarResult_(workingRosterDataRaw, rosterIdRaw, pipelineResultRaw, accumulatorRaw, timingsRaw) {
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	const roster = findRosterInDataById_(workingRosterDataRaw, rosterId);
	if (!roster) throw new Error("Roster result missing after pipeline: " + rosterId);
	const accumulator = accumulatorRaw && typeof accumulatorRaw === "object" ? accumulatorRaw : createRefreshAllAccumulator_();
	const perRoster = Array.isArray(accumulator.perRoster) && accumulator.perRoster.length ? accumulator.perRoster[accumulator.perRoster.length - 1] : null;
	return {
		rosterId: rosterId,
		rosterShardWritten: true,
		rosterSummary: {
			id: rosterId,
			title: String(roster.title || ""),
			connectedClanTag: normalizeTag_(roster.connectedClanTag),
			trackingMode: getRosterTrackingMode_(roster),
			mainCount: Array.isArray(roster.main) ? roster.main.length : 0,
			subCount: Array.isArray(roster.subs) ? roster.subs.length : 0,
			missingCount: Array.isArray(roster.missing) ? roster.missing.length : 0,
		},
		pipelineResult: pipelineResultRaw && typeof pipelineResultRaw === "object" ? pipelineResultRaw : {},
		perRoster: perRoster,
		issues: Array.isArray(accumulator.issues) ? accumulator.issues : [],
		timings: timingsRaw && typeof timingsRaw === "object" ? timingsRaw : {},
		writtenAt: new Date().toISOString(),
	};
}

// Return whether a completed task already has its result shard.
function isAutoRefreshTaskResultComplete_(runIdRaw, taskRaw) {
	const task = taskRaw && typeof taskRaw === "object" ? taskRaw : {};
	const type = String(task.type || "");
	if (type === "roster") {
		const rosterId = String(task.rosterId || "").trim();
		if (!rosterId) return false;
		const warResult = readAutoRefreshRunShard_(runIdRaw, "warResults/" + encodeFirebaseObjectKey_(rosterId));
		const metricResult = readAutoRefreshRunShard_(runIdRaw, "metricResults/" + encodeFirebaseObjectKey_(rosterId));
		const rosterWrite = readAutoRefreshRunShard_(runIdRaw, "rosterWrites/" + encodeFirebaseObjectKey_(rosterId));
		return !!(warResult && typeof warResult === "object" && metricResult && typeof metricResult === "object" && rosterWrite && typeof rosterWrite === "object");
	}
	if (type === "finalize") {
		return readPublishedActiveVersionId_() === normalizeActiveVersionId_(runIdRaw);
	}
	return false;
}

// Execute one bounded per-roster task.
function executeAutoRefreshRosterTask_(currentRaw, taskRaw, executionStartMsRaw) {
	const current = normalizeAutoRefreshQueueCurrent_(currentRaw);
	const task = taskRaw && typeof taskRaw === "object" ? taskRaw : {};
	const runId = current && current.runId;
	const rosterId = String(task.rosterId || "").trim();
	const taskStartMs = Date.now();
	if (!runId || !rosterId) throw new Error("Auto-refresh roster task is missing runId or rosterId.");
	if (isAutoRefreshTaskResultComplete_(runId, task)) {
		Logger.log(
			"autoRefresh worker task timing runId=%s taskId=%s rosterId=%s phase=%s fetchMs=%s processMs=%s shardWriteMs=%s totalMs=%s remainingMs=%s reason=%s",
			runId,
			String(task.taskId || ""),
			rosterId,
			String(task.type || "roster"),
			0,
			0,
			0,
			Math.max(0, Date.now() - taskStartMs),
			getAutoRefreshJobRemainingMs_(executionStartMsRaw),
			"resultExists",
		);
		return { skipped: true, reason: "resultExists", rosterId: rosterId };
	}
	const fetchStartMs = Date.now();
	const sourceMeta = readAutoRefreshRunShard_(runId, "source/meta");
	const sourceRoster = readAutoRefreshRunShard_(runId, "source/rosters/" + encodeFirebaseObjectKey_(rosterId));
	const sourceOwnership = readAutoRefreshRunShard_(runId, "source/ownership") || {};
	const sourceFetchMs = Math.max(0, Date.now() - fetchStartMs);
	if (!sourceMeta || !sourceRoster) throw new Error("Auto-refresh source shards are missing for run " + runId + ".");
	if (!sourceRoster) throw new Error("Auto-refresh source roster shard is missing: " + rosterId + ".");
	const clanTag = normalizeTag_(sourceRoster.connectedClanTag);
	let clanSnapshot = null;
	let clanFetchMs = 0;
	if (clanTag) {
		const clanFetchStartMs = Date.now();
		clanSnapshot = fetchClanMembersSnapshot_(clanTag);
		clanFetchMs = Math.max(0, Date.now() - clanFetchStartMs);
	}
	const metricTags = [];
	const liveTags = [];
	const liveMembers = Array.isArray(clanSnapshot && clanSnapshot.members) ? clanSnapshot.members : [];
	for (let i = 0; i < liveMembers.length; i++) {
		const tag = normalizeTag_(liveMembers[i] && liveMembers[i].tag);
		if (tag) liveTags.push(tag);
	}
	const metricsMembers = Array.isArray(clanSnapshot && clanSnapshot.metricsMembers) ? clanSnapshot.metricsMembers : [];
	for (let i = 0; i < metricsMembers.length; i++) {
		const tag = normalizeTag_(metricsMembers[i] && metricsMembers[i].tag);
		if (tag) metricTags.push(tag);
	}
	const targetSeedByTag = buildRosterPlayerSeedByTag_({ rosters: [sourceRoster] });
	const targetSeedTags = Object.keys(targetSeedByTag);
	const metricReadTags = metricTags.slice();
	const metricReadTagSet = {};
	for (let i = 0; i < metricReadTags.length; i++) {
		const tag = normalizeTag_(metricReadTags[i]);
		if (tag) metricReadTagSet[tag] = true;
	}
	for (let i = 0; i < targetSeedTags.length; i++) {
		const tag = normalizeTag_(targetSeedTags[i]);
		if (!tag || metricReadTagSet[tag]) continue;
		metricReadTagSet[tag] = true;
		metricReadTags.push(tag);
	}
	const metricReadStartMs = Date.now();
	const sourceMetricByTag = readAutoRefreshSourceMetricEntriesForTags_(runId, metricReadTags);
	const seedReadTags = [];
	const seedReadSeen = {};
	for (let i = 0; i < liveTags.length; i++) {
		const tag = normalizeTag_(liveTags[i]);
		if (!tag || seedReadSeen[tag] || targetSeedByTag[tag]) continue;
		seedReadSeen[tag] = true;
		seedReadTags.push(tag);
	}
	const sourceSeedByTag = readAutoRefreshSourcePlayerSeedEntriesForTags_(runId, seedReadTags);
	for (let i = 0; i < targetSeedTags.length; i++) {
		const tag = normalizeTag_(targetSeedTags[i]);
		if (tag && !sourceSeedByTag[tag]) sourceSeedByTag[tag] = targetSeedByTag[targetSeedTags[i]];
	}
	const metricReadMs = Math.max(0, Date.now() - metricReadStartMs);
	const processStartMs = Date.now();
	const workingRosterData = buildAutoRefreshRosterWorkingData_(sourceMeta, sourceRoster, sourceMetricByTag);
	const prefetchedClanSnapshotsByTag = {};
	if (clanTag && clanSnapshot) prefetchedClanSnapshotsByTag[clanTag] = clanSnapshot;
	const ownershipSnapshot = buildAutoRefreshRosterOwnershipSnapshot_(sourceMeta, sourceRoster, rosterId, clanSnapshot, sourceSeedByTag, sourceOwnership);
	const accumulator = createRefreshAllAccumulator_();
	const pipelineOptions = {
		ownershipSnapshot: ownershipSnapshot,
		skipInitialValidation: true,
		metricsRunState: { seenClanTags: {}, metricsStorePrepared: true },
		allowRegularWarHistoryRepair: false,
		allowRegularWarProvisionalFallback: false,
		statsOnlyRegularWarFinalization: false,
		autoRefreshFinalValidationMode: true,
		prefetchedClanSnapshotsByTag: prefetchedClanSnapshotsByTag,
		prefetchedClanErrorsByTag: {},
	};
	const processed = processRefreshAllRosterPipelineIntoAccumulator_(workingRosterData, rosterId, pipelineOptions, accumulator);
	const processMs = Math.max(0, Date.now() - processStartMs);
	const shardWriteStartMs = Date.now();
	const metricResult = buildRosterMetricResult_(processed.rosterData, metricTags, processed.pipelineResult && processed.pipelineResult.memberTracking);
	const warResult = buildRosterWarResult_(processed.rosterData, rosterId, processed.pipelineResult, accumulator, {
		sourceFetchMs: sourceFetchMs,
		clanFetchMs: clanFetchMs,
		metricReadMs: metricReadMs,
		processMs: processMs,
	});
	const activeRoster = findRosterInDataById_(processed.rosterData, rosterId);
	if (!activeRoster) throw new Error("Active roster shard missing after pipeline: " + rosterId + ".");
	firebaseRequestJson_(buildActiveVersionPath_(runId, "rosters/" + encodeFirebaseObjectKey_(rosterId)), "PUT", encodeFirebaseObjectKeysRecursive_(activeRoster));
	writeAutoRefreshRunShard_(runId, "rosterWrites/" + encodeFirebaseObjectKey_(rosterId), {
		rosterId: rosterId,
		versionId: runId,
		path: buildActiveVersionPath_(runId, "rosters/" + encodeFirebaseObjectKey_(rosterId)),
		writtenAt: new Date().toISOString(),
	}, "PUT");
	writeAutoRefreshRunShard_(runId, "warResults/" + encodeFirebaseObjectKey_(rosterId), warResult, "PUT");
	writeAutoRefreshRunShard_(runId, "metricResults/" + encodeFirebaseObjectKey_(rosterId), metricResult, "PUT");
	const shardWriteMs = Math.max(0, Date.now() - shardWriteStartMs);
	const totalMs = Math.max(0, Date.now() - taskStartMs);
	Logger.log(
		"autoRefresh worker task timing runId=%s taskId=%s rosterId=%s phase=%s fetchMs=%s clanFetchMs=%s metricReadMs=%s processMs=%s shardWriteMs=%s totalMs=%s remainingMs=%s",
		runId,
		String(task.taskId || ""),
		rosterId,
		String(task.type || "roster"),
		sourceFetchMs,
		clanFetchMs,
		metricReadMs,
		processMs,
		shardWriteMs,
		totalMs,
		getAutoRefreshJobRemainingMs_(executionStartMsRaw),
	);
	return {
		rosterId: rosterId,
		issueCount: Array.isArray(accumulator.issues) ? accumulator.issues.length : 0,
		issueSummary: buildAutoRefreshIssueSummary_(accumulator.issues),
		metricTags: metricResult.tags.length,
		totalMs: totalMs,
	};
}

// Merge source metrics with all per-roster metric result shards.
function buildAutoRefreshFinalPlayerMetrics_(runIdRaw, rosterIdsRaw, nowIsoRaw) {
	const sourceMetrics = readAutoRefreshRunShard_(runIdRaw, "source/playerMetrics") || createEmptyPlayerMetricsStore_();
	const merged = sanitizePlayerMetricsStore_(sourceMetrics, nowIsoRaw);
	const byTag = merged.byTag && typeof merged.byTag === "object" ? merged.byTag : {};
	const rosterIds = Array.isArray(rosterIdsRaw) ? rosterIdsRaw : [];
	for (let i = 0; i < rosterIds.length; i++) {
		const rosterId = String(rosterIds[i] == null ? "" : rosterIds[i]).trim();
		if (!rosterId) continue;
		const result = readAutoRefreshRunShard_(runIdRaw, "metricResults/" + encodeFirebaseObjectKey_(rosterId));
		const resultByTag = result && result.byTag && typeof result.byTag === "object" ? result.byTag : {};
		const tags = Object.keys(resultByTag);
		for (let j = 0; j < tags.length; j++) {
			const tag = normalizeTag_(tags[j]);
			if (!tag) continue;
			byTag[tag] = resultByTag[tags[j]];
		}
	}
	merged.byTag = byTag;
	merged.updatedAt = String(nowIsoRaw || merged.updatedAt || new Date().toISOString());
	return sanitizePlayerMetricsStore_(merged, merged.updatedAt);
}

// Build final active payload from source metadata and completed shards.
function buildAutoRefreshFinalRosterDataFromShards_(runIdRaw, rosterIdsRaw, lastUpdatedAtRaw) {
	const sourceMeta = readAutoRefreshRunShard_(runIdRaw, "source/meta");
	if (!sourceMeta) throw new Error("Auto-refresh source metadata is missing.");
	const rosterIds = Array.isArray(rosterIdsRaw) ? rosterIdsRaw : [];
	const rosters = [];
	for (let i = 0; i < rosterIds.length; i++) {
		const rosterId = String(rosterIds[i] == null ? "" : rosterIds[i]).trim();
		if (!rosterId) continue;
		const encodedRoster = firebaseRequestJson_(buildActiveVersionPath_(runIdRaw, "rosters/" + encodeFirebaseObjectKey_(rosterId)), "GET");
		const roster = encodedRoster && typeof encodedRoster === "object" && !Array.isArray(encodedRoster)
			? decodeFirebaseObjectKeysRecursive_(encodedRoster)
			: null;
		if (!roster) throw new Error("Missing completed roster result shard: " + rosterId + ".");
		rosters.push(roster);
	}
	const lastUpdatedAt = String(lastUpdatedAtRaw || new Date().toISOString());
	const payload = {
		schemaVersion: typeof sourceMeta.schemaVersion === "number" && isFinite(sourceMeta.schemaVersion) ? sourceMeta.schemaVersion : 1,
		pageTitle: typeof sourceMeta.pageTitle === "string" ? sourceMeta.pageTitle : "",
		rosterOrder: Array.isArray(sourceMeta.rosterOrder) ? sourceMeta.rosterOrder : rosterIds,
		rosters: rosters,
		playerMetrics: buildAutoRefreshFinalPlayerMetrics_(runIdRaw, rosterIds, lastUpdatedAt),
		lastUpdatedAt: lastUpdatedAt,
	};
	if (sourceMeta.publicConfig && typeof sourceMeta.publicConfig === "object") payload.publicConfig = sourceMeta.publicConfig;
	return validateRosterData_(payload);
}

// Write last-job summary for the queue lifecycle.
function writeAutoRefreshQueueLastJobState_(currentRaw, statusRaw, summaryRaw, errorRaw) {
	const current = normalizeAutoRefreshQueueCurrent_(currentRaw);
	if (!current) return null;
	const summary = {
		runId: current.runId,
		kind: "auto-refresh-queue",
		status: String(statusRaw || current.status || ""),
		startedAt: current.startedAt,
		updatedAt: current.updatedAt,
		completedAt: current.completedAt,
		failedAt: current.failedAt,
		error: String(errorRaw || current.error || ""),
		sourceFingerprint: current.sourceFingerprint,
		sourceLastUpdatedAt: current.sourceLastUpdatedAt,
		rosterIds: current.rosterIds,
		taskCount: current.taskCount,
		processedTasks: current.processedTasks,
		processedRosters: current.processedRosters,
		issueCount: current.issueCount,
		issueSummary: current.issueSummary,
		summary: String(summaryRaw || ""),
	};
	firebaseRequestJson_(FIREBASE_INTERNAL_AUTO_REFRESH_LAST_JOB_PATH, "PUT", encodeFirebaseObjectKeysRecursive_(summary));
	return summary;
}

// Archive and clear current queue state without throwing.
function archiveAndClearAutoRefreshQueueStateBestEffort_(currentRaw, statusRaw, summaryRaw, errorRaw, labelRaw) {
	const current = normalizeAutoRefreshQueueCurrent_(currentRaw);
	const label = String(labelRaw == null ? "auto-refresh queue cleanup" : labelRaw).trim() || "auto-refresh queue cleanup";
	try {
		writeAutoRefreshQueueLastJobState_(current, statusRaw, summaryRaw, errorRaw);
	} catch (err) {
		Logger.log("%s: unable to write queue last job summary: %s", label, errorMessage_(err));
	}
	try {
		clearAutoRefreshQueueCurrent_();
	} catch (err) {
		Logger.log("%s: unable to clear queue current state: %s", label, errorMessage_(err));
	}
	try {
		removeAutoRefreshJobResumeTriggers_();
	} catch (err) {
		Logger.log("%s: unable to remove worker triggers: %s", label, errorMessage_(err));
	}
}

// Create a new sharded auto-refresh run and schedule the worker.
function startAutoRefreshQueueCoordinator_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const executionStartMs = Math.max(0, Number(options.executionStartMs) || Date.now());
	const startedAt = String(options.startedAt || new Date().toISOString());
	return withActiveRosterJobLock_("auto-refresh-coordinator", 0, function () {
		touchActiveRosterLockLease_("auto-refresh queue coordinator");
		const existing = readAutoRefreshQueueCurrent_();
		if (existing && existing.kind === "auto-refresh-queue" && (existing.status === "running" || existing.status === "finalizing")) {
			scheduleAutoRefreshJobResume_();
			setAutoRefreshQueueInProgressResult_(existing);
			return { ok: true, status: "inProgress", inProgress: true, runId: existing.runId, reason: "existingRun", processedRosters: existing.processedRosters, totalRosters: existing.rosterIds.length };
		}
		if (isRecentSuccessfulActiveWrite_({ ignoreAutoRefreshWrites: true })) {
			const lastWriteAt = String(getLastSuccessfulActiveWriteAt_() || "").trim();
			const lastWriteSource = String(getLastSuccessfulActiveWriteSource_() || "").trim();
			const sourceSuffix = lastWriteSource ? " by " + lastWriteSource : "";
			let summary = "Auto-refresh skipped: active data was written recently" + sourceSuffix + " (" + (lastWriteAt || "unknown") + ").";
			const cleanupResult = maybeCleanupOldAutoRefreshDailyArchives_(getServerDateString_(new Date()));
			const cleanupDeleted = toNonNegativeInt_(cleanupResult && cleanupResult.deletedCount);
			if (cleanupDeleted > 0) summary += " Cleaned " + cleanupDeleted + " stale daily archive(s).";
			setAutoRefreshRunResult_("skipped", summary, "", 0, "", startedAt, new Date().toISOString());
			tryReconcileRegularWarFinalizationTriggerState_();
			return { ok: true, status: "skipped", skipped: true, reason: "cooldown", lastWriteAt: lastWriteAt };
		}
		const sourceReadStartMs = Date.now();
		const sourceSnapshot = readActiveRosterSnapshot_();
		const rosterData = validateRosterData_(sourceSnapshot && sourceSnapshot.rosterData);
		const sourceReadMs = Math.max(0, Date.now() - sourceReadStartMs);
		if (!hasAutoRefreshJobBudgetFor_(executionStartMs, AUTO_REFRESH_QUEUE_WORKER_START_RESERVE_MS)) {
			return deferFreshAutoRefreshStartForBudget_("sourceReadTooSlowBeforeQueueCreate", startedAt, executionStartMs, AUTO_REFRESH_QUEUE_WORKER_START_RESERVE_MS);
		}
		const fingerprintStartMs = Date.now();
		const sourceFingerprint = buildActiveRosterSourceFingerprintValidated_(rosterData);
		const fingerprintMs = Math.max(0, Date.now() - fingerprintStartMs);
		const runPlan = buildRefreshAllRosterRunPlan_(rosterData, {
			allowRegularWarHistoryRepair: false,
			allowRegularWarProvisionalFallback: false,
		});
		const ownershipStartMs = Date.now();
		const sourceOwnershipIndex = collectAutoRefreshSourceOwnershipIndex_(rosterData);
		const ownershipMs = Math.max(0, Date.now() - ownershipStartMs);
		if (!hasAutoRefreshJobBudgetFor_(executionStartMs, AUTO_REFRESH_QUEUE_WORKER_START_RESERVE_MS)) {
			return deferFreshAutoRefreshStartForBudget_("sourceOwnershipTooSlowBeforeQueueCreate", startedAt, executionStartMs, AUTO_REFRESH_QUEUE_WORKER_START_RESERVE_MS);
		}
		const runId = createActiveVersionId_("auto-refresh");
		const shardWriteStartMs = Date.now();
		const sourceMeta = writeAutoRefreshRunSourceShards_(runId, rosterData, sourceFingerprint, runPlan, sourceOwnershipIndex);
		const tasks = buildAutoRefreshQueueTasks_(runId, runPlan.rosterIds);
		const taskIds = writeAutoRefreshQueueTasks_(runId, tasks);
		const current = writeAutoRefreshQueueCurrent_({
			runId: runId,
			kind: "auto-refresh-queue",
			status: "running",
			phase: "queued",
			startedAt: startedAt,
			updatedAt: startedAt,
			sourceFingerprint: sourceFingerprint,
			sourceLastUpdatedAt: String(rosterData.lastUpdatedAt || ""),
			rosterIds: runPlan.rosterIds,
			taskIds: taskIds,
			taskCount: taskIds.length,
			currentTaskIndex: 0,
			processedTasks: 0,
			processedRosters: 0,
			issueCount: 0,
			issueSummary: "",
			taskSummary: null,
			lock: {
				owner: "auto-refresh-coordinator",
				updatedAt: new Date().toISOString(),
			},
		});
		clearAutoRefreshFreshRetryPending_();
		const shardWriteMs = Math.max(0, Date.now() - shardWriteStartMs);
		scheduleAutoRefreshJobResume_();
		const summary = "Auto-refresh queued: 0/" + runPlan.rosterIds.length + " roster(s) processed.";
		setAutoRefreshRunResult_("inProgress", summary, "", 0, "", startedAt, new Date().toISOString());
		Logger.log(
			"autoRefresh coordinator queued runId=%s rosters=%s tasks=%s sourceReadMs=%s fingerprintMs=%s ownershipMs=%s shardWriteMs=%s totalMs=%s remainingMs=%s sourceFingerprint=%s",
			runId,
			runPlan.rosterIds.length,
			taskIds.length,
			sourceReadMs,
			fingerprintMs,
			ownershipMs,
			shardWriteMs,
			getAutoRefreshJobElapsedMs_(executionStartMs),
			getAutoRefreshJobRemainingMs_(executionStartMs),
			String(sourceMeta.sourceFingerprint || "").slice(0, 12),
		);
		return { ok: true, status: "inProgress", inProgress: true, runId: runId, processedRosters: 0, totalRosters: runPlan.rosterIds.length, taskCount: taskIds.length };
	});
}

// Find the next runnable queue task.
function findNextAutoRefreshQueueTask_(currentRaw) {
	const current = normalizeAutoRefreshQueueCurrent_(currentRaw);
	if (!current) return null;
	const taskIds = current.taskIds;
	for (let i = Math.max(0, current.currentTaskIndex); i < taskIds.length; i++) {
		const task = readAutoRefreshTask_(current.runId, taskIds[i]);
		if (!task) continue;
		const status = String(task.status || "pending");
		if (status === "completed" && isAutoRefreshTaskResultComplete_(current.runId, task)) {
			current.currentTaskIndex = i + 1;
			current.processedTasks = Math.max(current.processedTasks, i + 1);
			continue;
		}
		return { task: task, index: i, current: current };
	}
	return { task: null, index: taskIds.length, current: current };
}

// Mark visible progress for a queue run.
function setAutoRefreshQueueInProgressResult_(currentRaw) {
	const current = normalizeAutoRefreshQueueCurrent_(currentRaw);
	if (!current) return;
	const summary = "Auto-refresh in progress: processed " + toNonNegativeInt_(current.processedRosters) + "/" + current.rosterIds.length + " roster(s).";
	setAutoRefreshRunResult_("inProgress", summary, "", current.issueCount, current.issueSummary, current.startedAt, new Date().toISOString());
}

// Execute finalization task: verify shards, guard source fingerprint, write final
// manifest/playerMetrics shard, then publish the small version pointer.
function executeAutoRefreshFinalizeTask_(currentRaw, taskRaw, executionStartMsRaw) {
	const current = normalizeAutoRefreshQueueCurrent_(currentRaw);
	const task = taskRaw && typeof taskRaw === "object" ? taskRaw : {};
	const taskStartMs = Date.now();
	const runId = current && current.runId;
	if (!runId) throw new Error("Auto-refresh finalize task is missing run id.");
	if (readPublishedActiveVersionId_() === runId) {
		const summary = "Auto-refresh version was already published; cleared completed queue state.";
		current.status = "completed";
		current.phase = "completed";
		current.completedAt = new Date().toISOString();
		current.processedTasks = current.taskCount;
		setAutoRefreshRunResult_("ok", summary, "", current.issueCount, current.issueSummary, current.startedAt, new Date().toISOString());
		archiveAndClearAutoRefreshQueueStateBestEffort_(current, "completed", summary, "", "autoRefresh queue already-published cleanup");
		Logger.log(
			"autoRefresh worker task timing runId=%s taskId=%s rosterId=%s phase=%s fetchMs=%s processMs=%s writeMs=%s totalMs=%s remainingMs=%s reason=%s",
			runId,
			String(task.taskId || ""),
			"",
			"finalize",
			0,
			0,
			0,
			Math.max(0, Date.now() - taskStartMs),
			getAutoRefreshJobRemainingMs_(executionStartMsRaw),
			"alreadyPublished",
		);
		return { ok: true, status: "completed", summary: summary, alreadyPublished: true, runId: runId, processedRosters: current.processedRosters, issueCount: current.issueCount };
	}
	if (!hasAutoRefreshJobBudgetFor_(executionStartMsRaw, AUTO_REFRESH_QUEUE_FINALIZE_RESERVE_MS)) {
		scheduleAutoRefreshJobResume_();
		Logger.log(
			"autoRefresh worker task timing runId=%s taskId=%s rosterId=%s phase=%s fetchMs=%s processMs=%s writeMs=%s totalMs=%s remainingMs=%s reason=%s",
			runId,
			String(task.taskId || ""),
			"",
			"finalize",
			0,
			0,
			0,
			Math.max(0, Date.now() - taskStartMs),
			getAutoRefreshJobRemainingMs_(executionStartMsRaw),
			"beforeFinalize",
		);
		return { deferred: true, reason: "beforeFinalize", runId: runId };
	}
	const finalizeStartMs = Date.now();
	const rosterIds = current.rosterIds;
	for (let i = 0; i < rosterIds.length; i++) {
		const rosterId = rosterIds[i];
		const warResult = readAutoRefreshRunShard_(runId, "warResults/" + encodeFirebaseObjectKey_(rosterId));
		if (!warResult || typeof warResult !== "object") {
			throw new Error("Auto-refresh finalization missing roster result shard: " + rosterId + ".");
		}
		const metricResult = readAutoRefreshRunShard_(runId, "metricResults/" + encodeFirebaseObjectKey_(rosterId));
		if (!metricResult || typeof metricResult !== "object") {
			throw new Error("Auto-refresh finalization missing metric result shard: " + rosterId + ".");
		}
		const activeVersionRosterPath = buildActiveVersionPath_(runId, "rosters/" + encodeFirebaseObjectKey_(rosterId));
		const activeVersionRoster = firebaseRequestJson_(activeVersionRosterPath, "GET");
		if (!activeVersionRoster) {
			throw new Error("Auto-refresh finalization missing active roster shard: " + rosterId + ".");
		}
	}
	const sourceReadStartMs = Date.now();
	const currentSourceSnapshot = readActiveRosterSnapshot_();
	const sourceReadMs = Math.max(0, Date.now() - sourceReadStartMs);
	const fingerprintStartMs = Date.now();
	const currentSourceFingerprint = buildActiveRosterSourceFingerprintValidated_(currentSourceSnapshot && currentSourceSnapshot.rosterData);
	const fingerprintMs = Math.max(0, Date.now() - fingerprintStartMs);
	const sourceMatches = currentSourceFingerprint === String(current.sourceFingerprint || "");
	Logger.log(
		"autoRefresh finalize source guard runId=%s sourceMatches=%s jobFingerprint=%s currentFingerprint=%s sourceReadMs=%s fingerprintMs=%s",
		runId,
		sourceMatches,
		String(current.sourceFingerprint || "").slice(0, 12),
		currentSourceFingerprint.slice(0, 12),
		sourceReadMs,
		fingerprintMs,
	);
	if (!sourceMatches) {
		const summary = "Auto-refresh job became stale because active data changed while it was running; no active version was published.";
		current.status = "stale";
		current.completedAt = new Date().toISOString();
		current.error = summary;
		setAutoRefreshRunResult_("stale", summary, "", current.issueCount, current.issueSummary, current.startedAt, new Date().toISOString());
		tryReconcileRegularWarFinalizationTriggerStateValidated_(currentSourceSnapshot && currentSourceSnapshot.rosterData);
		archiveAndClearAutoRefreshQueueStateBestEffort_(current, "stale", summary, summary, "autoRefresh queue stale cleanup");
		return { ok: true, status: "stale", stale: true, summary: summary, processedRosters: current.processedRosters, issueCount: current.issueCount };
	}
	const writeStartMs = Date.now();
	const writtenAt = new Date().toISOString();
	let finalRosterData = buildAutoRefreshFinalRosterDataFromShards_(runId, rosterIds, writtenAt);
	const changed = hasActiveRosterPayloadChangedValidated_(currentSourceSnapshot && currentSourceSnapshot.rosterData, finalRosterData);
	let archiveCreated = false;
	let archiveDate = "";
	let archiveCleanupDeleted = 0;
	if (changed) {
		const discordCanonicalized = canonicalizeDiscordIdentityForRosterData_(finalRosterData, {
			sourceRosterData: currentSourceSnapshot && currentSourceSnapshot.rosterData,
			updatedAt: writtenAt,
			source: ACTIVE_DATA_WRITE_SOURCE_AUTO_REFRESH,
			allowRosterCacheUsernameUpdates: false,
		});
		if (discordCanonicalized && (discordCanonicalized.updatedCanonical || discordCanonicalized.updatedRosterCache)) {
			finalRosterData = validateRosterData_(discordCanonicalized.rosterData);
		}
		markActiveDataWriteSuccess_(writtenAt, ACTIVE_DATA_WRITE_SOURCE_AUTO_REFRESH);
		const archiveResult = maybeCreateAutoRefreshDailyArchive_(getServerDateString_(new Date()), finalRosterData);
		archiveCreated = !!(archiveResult && archiveResult.created);
		archiveDate = String((archiveResult && archiveResult.archiveDate) || "");
		const cleanupResult = maybeCleanupOldAutoRefreshDailyArchives_(archiveDate || getServerDateString_(new Date()));
		archiveCleanupDeleted = toNonNegativeInt_(cleanupResult && cleanupResult.deletedCount);
		firebaseRequestJson_(FIREBASE_META_PATH, "PATCH", {
			layoutVersion: FIREBASE_LAYOUT_VERSION,
			lastAutoRefreshWriteAt: writtenAt,
			lastAutoRefreshArchiveDate: archiveDate,
			lastAutoRefreshArchiveCleanupDeleted: archiveCleanupDeleted,
			lastAutoRefreshVersionId: runId,
		});
	} else {
		const cleanupResult = maybeCleanupOldAutoRefreshDailyArchives_(getServerDateString_(new Date()));
		archiveCleanupDeleted = toNonNegativeInt_(cleanupResult && cleanupResult.deletedCount);
		firebaseRequestJson_(FIREBASE_META_PATH, "PATCH", {
			layoutVersion: FIREBASE_LAYOUT_VERSION,
			lastAutoRefreshVersionId: runId,
			lastAutoRefreshArchiveCleanupDeleted: archiveCleanupDeleted,
		});
	}
	const playerMetrics = sanitizePlayerMetricsStore_(finalRosterData.playerMetrics, writtenAt);
	firebaseRequestJson_(buildActiveVersionPath_(runId, "playerMetrics"), "PUT", encodeFirebaseObjectKeysRecursive_(playerMetrics));
	const manifest = buildActiveVersionManifestFromValidatedData_(runId, finalRosterData, {
		source: ACTIVE_DATA_WRITE_SOURCE_AUTO_REFRESH,
		runId: runId,
		publishedAt: writtenAt,
		sourceFingerprint: current.sourceFingerprint,
	});
	firebaseRequestJson_(buildActiveVersionPath_(runId, "manifest"), "PUT", encodeFirebaseObjectKeysRecursive_(manifest));
	publishActiveRosterVersionPointer_(runId, manifest);
	clearActiveRosterDataCache_();
	const writeMs = Math.max(0, Date.now() - writeStartMs);
	const runResult = {
		processedRosters: current.processedRosters,
		rostersWithIssues: current.issueCount > 0 ? 1 : 0,
		issueCount: current.issueCount,
		issueSummary: current.issueSummary,
		issues: [],
	};
	const writeResult = {
		changed: changed,
		written: changed,
		writtenAt: changed ? writtenAt : "",
		versionPublished: true,
		versionId: runId,
		rosterCount: rosterIds.length,
		playerCount: countRosterPayload_(finalRosterData).playerCount,
		noteCount: countRosterPayload_(finalRosterData).noteCount,
		archiveCreated: archiveCreated,
		archiveDate: archiveDate,
		archiveCleanupDeleted: archiveCleanupDeleted,
		rosterData: finalRosterData,
	};
	const summary = buildAutoRefreshFinalSummary_(runResult, writeResult);
	setAutoRefreshRunResult_("ok", summary, "", current.issueCount, current.issueSummary, current.startedAt, new Date().toISOString());
	tryReconcileRegularWarFinalizationTriggerStateValidated_(finalRosterData);
	tryReconcileCurrentSeasonEventsForAutoRefresh_();
	current.status = "completed";
	current.phase = "completed";
	current.completedAt = new Date().toISOString();
	current.processedTasks = current.taskCount;
	Logger.log(
		"autoRefresh worker task timing runId=%s taskId=%s rosterId=%s phase=%s fetchMs=%s processMs=%s writeMs=%s totalMs=%s remainingMs=%s changed=%s",
		runId,
		String(task.taskId || ""),
		"",
		"finalize",
		sourceReadMs,
		fingerprintMs,
		writeMs,
		Math.max(0, Date.now() - finalizeStartMs),
		getAutoRefreshJobRemainingMs_(executionStartMsRaw),
		changed,
	);
	archiveAndClearAutoRefreshQueueStateBestEffort_(current, "completed", summary, "", "autoRefresh queue completed cleanup");
	return { ok: true, status: "completed", summary: summary, changed: changed, processedRosters: current.processedRosters, issueCount: current.issueCount };
}

// Continue one queue worker execution. The worker intentionally executes at most
// one task per trigger to stay well below the Apps Script execution limit.
function continueAutoRefreshQueueWorker_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const executionStartMs = Math.max(0, Number(options.executionStartMs) || Date.now());
	return withActiveRosterJobLock_("auto-refresh-worker", 0, function () {
		let current = readAutoRefreshQueueCurrent_();
		if (!current || current.kind !== "auto-refresh-queue") {
			removeAutoRefreshJobResumeTriggers_();
			if (current && current.legacy === true) {
				clearAutoRefreshQueueCurrent_();
				Logger.log("autoRefresh worker cleared legacy current state kind=%s", String(current.kind || ""));
				if (isAutoRefreshFreshRetryPending_()) scheduleAutoRefreshJobResume_();
			}
			return { ok: true, status: "skipped", skipped: true, reason: "noRun" };
		}
		if (current.status !== "running" && current.status !== "finalizing") {
			removeAutoRefreshJobResumeTriggers_();
			return { ok: true, status: current.status || "skipped", skipped: true, reason: "notRunnable" };
		}
		if (!hasAutoRefreshJobBudgetFor_(executionStartMs, AUTO_REFRESH_QUEUE_WORKER_START_RESERVE_MS)) {
			scheduleAutoRefreshJobResume_();
			setAutoRefreshQueueInProgressResult_(current);
			return { ok: true, status: "inProgress", inProgress: true, reason: "beforeTaskBudget", processedRosters: current.processedRosters, totalRosters: current.rosterIds.length };
		}
		let next = findNextAutoRefreshQueueTask_(current);
		current = next && next.current ? next.current : current;
		if (next && next.index !== current.currentTaskIndex) {
			current.currentTaskIndex = next.index;
			writeAutoRefreshQueueCurrent_(current, false);
		}
		const task = next && next.task ? next.task : null;
		if (!task) {
			const summary = "Auto-refresh completed; no pending queue tasks remain.";
			current.status = "completed";
			current.phase = "completed";
			current.completedAt = new Date().toISOString();
			current.currentTaskIndex = current.taskIds.length;
			current.processedTasks = current.taskCount;
			setAutoRefreshRunResult_("ok", summary, "", current.issueCount, current.issueSummary, current.startedAt, new Date().toISOString());
			archiveAndClearAutoRefreshQueueStateBestEffort_(current, "completed", summary, "", "autoRefresh queue no-task cleanup");
			return { ok: true, status: "completed", summary: summary, processedRosters: current.processedRosters, totalRosters: current.rosterIds.length };
		}
		const nowIso = new Date().toISOString();
		const status = String(task.status || "pending");
		const updatedMs = parseIsoToMs_(task.updatedAt);
		if (status === "running" && updatedMs > 0 && Date.now() - updatedMs < AUTO_REFRESH_QUEUE_TASK_STALE_MS) {
			scheduleAutoRefreshJobResume_();
			return { ok: true, status: "inProgress", inProgress: true, reason: "taskRunning", processedRosters: current.processedRosters, totalRosters: current.rosterIds.length };
		}
		task.status = "running";
		task.startedAt = task.startedAt || nowIso;
		task.updatedAt = nowIso;
		task.attempts = toNonNegativeInt_(task.attempts) + 1;
		task.error = "";
		writeAutoRefreshTask_(current.runId, task);
		current.phase = task.type === "finalize" ? "finalizing" : "processing";
		current.status = task.type === "finalize" ? "finalizing" : "running";
		current.taskSummary = {
			taskId: task.taskId,
			type: task.type,
			rosterId: String(task.rosterId || ""),
			startedAt: nowIso,
			attempts: task.attempts,
		};
		writeAutoRefreshQueueCurrent_(current, false);
		let result = null;
		try {
			result = task.type === "finalize"
				? executeAutoRefreshFinalizeTask_(current, task, executionStartMs)
				: executeAutoRefreshRosterTask_(current, task, executionStartMs);
			if (result && result.deferred) {
				task.status = "pending";
				task.summary = String(result.reason || "deferred");
				writeAutoRefreshTask_(current.runId, task);
				scheduleAutoRefreshJobResume_();
				return { ok: true, status: "inProgress", inProgress: true, reason: result.reason, processedRosters: current.processedRosters, totalRosters: current.rosterIds.length };
			}
			if (result && (result.status === "completed" || result.status === "stale")) return result;
			task.status = "completed";
			task.completedAt = new Date().toISOString();
			task.summary = JSON.stringify(result || {}).slice(0, 500);
			writeAutoRefreshTask_(current.runId, task);
			current.currentTaskIndex = Math.max(current.currentTaskIndex, toNonNegativeInt_(task.index) + 1);
			current.processedTasks = Math.max(current.processedTasks, current.currentTaskIndex);
			if (task.type === "roster") {
				current.processedRosters = toNonNegativeInt_(current.processedRosters) + 1;
				const issueCount = toNonNegativeInt_(result && result.issueCount);
				if (issueCount > 0) {
					current.issueCount += issueCount;
					if (!current.issueSummary && result.issueSummary) current.issueSummary = String(result.issueSummary || "").slice(0, 500);
				}
			}
			current.taskSummary = {
				taskId: task.taskId,
				type: task.type,
				rosterId: String(task.rosterId || ""),
				completedAt: task.completedAt,
			};
			writeAutoRefreshQueueCurrent_(current, false);
			setAutoRefreshQueueInProgressResult_(current);
			scheduleAutoRefreshJobResume_();
			return { ok: true, status: "inProgress", inProgress: true, runId: current.runId, processedRosters: current.processedRosters, totalRosters: current.rosterIds.length, lastTaskId: task.taskId };
		} catch (err) {
			const message = errorMessage_(err);
			task.status = "failed";
			task.error = message;
			task.updatedAt = new Date().toISOString();
			writeAutoRefreshTask_(current.runId, task);
			current.status = "failed";
			current.failedAt = new Date().toISOString();
			current.error = message;
			setAutoRefreshRunResult_("error", "Auto-refresh run failed.", message, current.issueCount, current.issueSummary, current.startedAt, new Date().toISOString());
			archiveAndClearAutoRefreshQueueStateBestEffort_(current, "failed", "Auto-refresh run failed.", message, "autoRefresh queue failed cleanup");
			throw err;
		}
	});
}

// Clone JSON-safe queue/result fragments before writing them to Firebase.
function cloneAutoRefreshJobJson_(valueRaw) {
	if (valueRaw == null) return valueRaw;
	return JSON.parse(JSON.stringify(valueRaw));
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

// Defer fresh queue creation before any current run state exists.
function deferFreshAutoRefreshStartForBudget_(reasonRaw, startedAtRaw, executionStartMsRaw, reserveMsRaw) {
	const reason = String(reasonRaw == null ? "freshStartBudget" : reasonRaw).trim() || "freshStartBudget";
	const startedAt = String(startedAtRaw || new Date().toISOString());
	const reserveMs = Math.max(0, Number(reserveMsRaw) || 0);
	markAutoRefreshFreshRetryPending_(reason);
	scheduleAutoRefreshJobResume_();
	const summary = "Auto-refresh start deferred before initial queue state was written; retry scheduled.";
	setAutoRefreshRunResult_("inProgress", summary, "", 0, "", startedAt, new Date().toISOString());
	Logger.log(
		"autoRefresh queue fresh start budget stop reason=%s remainingMs=%s reserveMs=%s elapsedMs=%s retryScheduled=true",
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

// Fail and clear any current job when auto-refresh is disabled.
function cleanupAutoRefreshJobAfterDisabled_() {
	removeAutoRefreshJobResumeTriggers_();
	clearAutoRefreshFreshRetryPending_();
	try {
		const queue = readAutoRefreshQueueCurrent_();
		if (queue && queue.kind === "auto-refresh-queue") {
			queue.status = "failed";
			queue.failedAt = new Date().toISOString();
			queue.error = "Auto-refresh was disabled before the sharded queue completed.";
			archiveAndClearAutoRefreshQueueStateBestEffort_(queue, "failed", queue.error, queue.error, "autoRefresh queue disabled cleanup");
			Logger.log("autoRefresh queue disabled cleanup runId=%s", String(queue.runId || ""));
			return;
		}
		if (queue && queue.legacy === true) {
			clearAutoRefreshQueueCurrent_();
			Logger.log("autoRefresh legacy current state cleared after disable kind=%s", String(queue.kind || ""));
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
		const queue = readAutoRefreshQueueCurrent_();
		if (queue && queue.kind === "auto-refresh-queue") {
			queue.status = "failed";
			queue.failedAt = new Date().toISOString();
			queue.error = message;
			archiveAndClearAutoRefreshQueueStateBestEffort_(queue, "failed", "Auto-refresh run failed.", message, "autoRefresh queue failed cleanup");
			Logger.log("autoRefresh queue failed cleanup runId=%s error=%s", String(queue.runId || ""), message);
			return;
		}
		if (queue && queue.legacy === true) {
			clearAutoRefreshQueueCurrent_();
			Logger.log("autoRefresh legacy current state cleared after failure kind=%s error=%s", String(queue.kind || ""), message);
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
			const handler = String(trigger.getHandlerFunction() || "");
			return handler === AUTO_REFRESH_JOB_HANDLER_NAME || handler === AUTO_REFRESH_LEGACY_JOB_HANDLER_NAME;
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
	Logger.log("autoRefresh worker scheduled triggerId=%s delayMs=%s", triggerId, AUTO_REFRESH_JOB_RESUME_DELAY_MS);
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
		const result = startAutoRefreshQueueCoordinator_({ executionStartMs: Date.now(), startedAt: startedAt });
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
			scheduleAutoRefreshJobResume_();
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

// Handle sharded auto-refresh worker one-shot trigger.
function autoRefreshWorkerTick() {
	const tickStartMs = Date.now();
	const startedAt = new Date().toISOString();
	let resultForLog = null;
	Logger.log("autoRefreshWorkerTick start startedAt=%s", startedAt);
	try {
		if (!isAutoRefreshEnabled_()) {
			cleanupAutoRefreshJobAfterDisabled_();
			setAutoRefreshRunResult_("skipped", "Auto-refresh worker skipped because auto-refresh is disabled.", "", 0, "", startedAt, new Date().toISOString());
			tryReconcileRegularWarFinalizationTriggerState_();
			resultForLog = { ok: true, status: "skipped", skipped: true, reason: "disabled" };
			return resultForLog;
		}
		if (isAutoRefreshFreshRetryPending_() && !readAutoRefreshQueueCurrent_()) {
			const result = startAutoRefreshQueueCoordinator_({ executionStartMs: Date.now(), startedAt: startedAt });
			resultForLog = result;
			return result;
		}
		const result = continueAutoRefreshQueueWorker_({ executionStartMs: Date.now(), startedAt: startedAt });
		resultForLog = result;
		if (result && result.inProgress) {
			Logger.log("autoRefreshWorkerTick in progress processedRosters=%s totalRosters=%s", toNonNegativeInt_(result.processedRosters), toNonNegativeInt_(result.totalRosters));
		} else if (result && result.stale) {
			Logger.log("autoRefreshWorkerTick stale: %s", String(result.summary || ""));
		} else {
			Logger.log("autoRefreshWorkerTick done: %s", String(result && result.summary ? result.summary : ""));
		}
		return result;
	} catch (err) {
		if (isActiveRosterJobLockBusyError_(err)) {
			scheduleAutoRefreshJobResume_();
			setAutoRefreshRunResult_("inProgress", "Auto-refresh worker deferred due to overlap with another active roster refresh/publish flow.", "", 0, "", startedAt, new Date().toISOString());
			resultForLog = { ok: true, status: "inProgress", inProgress: true, reason: "overlap" };
			return resultForLog;
		}
		const message = errorMessage_(err);
		failCurrentAutoRefreshJobAfterError_(message);
		setAutoRefreshRunResult_("error", "Auto-refresh worker failed.", message, 0, "", startedAt, new Date().toISOString());
		Logger.log("autoRefreshWorkerTick failed: %s", message);
		resultForLog = { ok: false, status: "error", error: message };
		return resultForLog;
	} finally {
		Logger.log(
			"autoRefreshWorkerTick end status=%s reason=%s elapsedMs=%s",
			String((resultForLog && resultForLog.status) || ""),
			String((resultForLog && resultForLog.reason) || ""),
			Math.max(0, Date.now() - tickStartMs),
		);
	}
}

// Legacy one-shot trigger alias. Existing installed triggers with the old
// handler name should continue the new sharded queue instead of becoming no-ops.
function autoRefreshJobResumeTick() {
	return autoRefreshWorkerTick();
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
