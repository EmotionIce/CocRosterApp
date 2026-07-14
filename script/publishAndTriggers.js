// Publish flow and auto-refresh trigger orchestration.

const AUTO_REFRESH_CWL_FINAL_CAPTURE_MAX_AGE_MS = 10 * 60 * 1000;

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
							skipDonationCycles: true,
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
		if (typeof ackFinalizedCwlRuntimeRosterConsumptionFromRosterData_ === "function") {
			ackFinalizedCwlRuntimeRosterConsumptionFromRosterData_("", validated, new Date().toISOString());
		}
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
		if (typeof ackFinalizedCwlRuntimeRosterConsumptionFromRosterData_ === "function") {
			ackFinalizedCwlRuntimeRosterConsumptionFromRosterData_("", sourceData, new Date().toISOString());
		}
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
	if (typeof ackFinalizedCwlRuntimeRosterConsumptionFromRosterData_ === "function") {
		ackFinalizedCwlRuntimeRosterConsumptionFromRosterData_("", payloadToWrite, new Date().toISOString());
	}
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
		sourceVersionId: normalizeActiveVersionId_(state.sourceVersionId),
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
		cwlFinalCoordinatorCapture: state.cwlFinalCoordinatorCapture && typeof state.cwlFinalCoordinatorCapture === "object" ? state.cwlFinalCoordinatorCapture : null,
		cwlSeasonEventRefresh: state.cwlSeasonEventRefresh && typeof state.cwlSeasonEventRefresh === "object" ? state.cwlSeasonEventRefresh : null,
		cwlFinalOutcome: state.cwlFinalOutcome && typeof state.cwlFinalOutcome === "object" ? state.cwlFinalOutcome : null,
		cwlCoordinatorSidePhaseTerminal: state.cwlCoordinatorSidePhaseTerminal === true,
		cwlFinalCoordinatorSidePhaseTerminal: state.cwlFinalCoordinatorSidePhaseTerminal === true,
		cloudflarePublicDataPublish: state.cloudflarePublicDataPublish && typeof state.cloudflarePublicDataPublish === "object" ? state.cloudflarePublicDataPublish : null,
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

// Read only the source fields the coordinator needs when the active payload is
// already published as immutable version shards. Full playerMetrics stay out of
// this phase and are copied by bounded worker tasks.
function readAutoRefreshCoordinatorSourceSnapshot_() {
	const versionId = readPublishedActiveVersionId_();
	if (versionId) {
		try {
			const encodedManifest = firebaseRequestJson_(buildActiveVersionPath_(versionId, "manifest"), "GET");
			if (!encodedManifest || typeof encodedManifest !== "object" || Array.isArray(encodedManifest)) {
				throw new Error("Missing active version manifest for " + versionId + ".");
			}
			const manifest = decodeFirebaseObjectKeysRecursive_(encodedManifest);
			const rosterShardResult = readActiveVersionRosterShards_(versionId, manifest);
			const rosterIds = rosterShardResult.rosterIds;
			const rosters = rosterShardResult.rosters;
			const sourceLastUpdatedAt = String(manifest.lastUpdatedAt || manifest.publishedAt || "");
			const sourcePayload = {
				schemaVersion: typeof manifest.schemaVersion === "number" && isFinite(manifest.schemaVersion) ? manifest.schemaVersion : 1,
				pageTitle: typeof manifest.pageTitle === "string" ? manifest.pageTitle : "",
				rosterOrder: Array.isArray(manifest.rosterOrder) ? manifest.rosterOrder : rosterIds,
				rosters: rosters,
				playerMetrics: createEmptyPlayerMetricsStore_(),
				lastUpdatedAt: sourceLastUpdatedAt,
			};
			if (manifest.publicConfig && typeof manifest.publicConfig === "object") sourcePayload.publicConfig = manifest.publicConfig;
			const rosterData = validateRosterData_(sourcePayload);
			return {
				rosterData: rosterData,
				versionId: versionId,
				manifest: manifest,
				source: "firebase:/activeVersions/" + versionId + " (coordinator-light)",
				sourceFingerprint: String(manifest.sourceFingerprint || ("version:" + versionId + ":" + String(manifest.publishedAt || ""))),
				sourceMetricsLoaded: false,
			};
		} catch (err) {
			Logger.log("Unable to read lightweight active version source '%s'; falling back to full active snapshot: %s", versionId, errorMessage_(err));
		}
	}
	const snapshot = readActiveRosterSnapshot_();
	return {
		rosterData: snapshot && snapshot.rosterData,
		text: snapshot && snapshot.text,
		versionId: normalizeActiveVersionId_(snapshot && snapshot.versionId),
		manifest: snapshot && snapshot.manifest,
		source: snapshot && snapshot.source,
		sourceFingerprint: "",
		sourceMetricsLoaded: true,
	};
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

function truncateAutoRefreshDiagnosticString_(valueRaw, maxLengthRaw) {
	const maxLength = Math.max(1, toNonNegativeInt_(maxLengthRaw || 500));
	return String(valueRaw == null ? "" : valueRaw).slice(0, maxLength);
}

function sanitizeAutoRefreshDiagnosticFragment_(valueRaw, depthRaw) {
	const depth = Math.max(0, toNonNegativeInt_(depthRaw));
	if (valueRaw == null || typeof valueRaw === "number" || typeof valueRaw === "boolean") return valueRaw;
	if (typeof valueRaw === "string") return truncateAutoRefreshDiagnosticString_(valueRaw, 500);
	if (depth <= 0) return "[object]";
	if (Array.isArray(valueRaw)) {
		const out = [];
		const limit = Math.min(valueRaw.length, 20);
		for (let i = 0; i < limit; i++) out.push(sanitizeAutoRefreshDiagnosticFragment_(valueRaw[i], depth - 1));
		if (valueRaw.length > limit) out.push("+" + (valueRaw.length - limit) + " more");
		return out;
	}
	if (typeof valueRaw === "object") {
		const out = {};
		const keys = Object.keys(valueRaw).sort();
		const limit = Math.min(keys.length, 30);
		for (let i = 0; i < limit; i++) {
			const key = keys[i];
			out[key] = sanitizeAutoRefreshDiagnosticFragment_(valueRaw[key], depth - 1);
		}
		if (keys.length > limit) out.truncatedKeyCount = keys.length - limit;
		return out;
	}
	return truncateAutoRefreshDiagnosticString_(valueRaw, 500);
}

function buildAutoRefreshQueueDiagnosticsState_(currentRaw) {
	const current = normalizeAutoRefreshQueueCurrent_(currentRaw);
	if (!current) return null;
	return {
		runId: current.runId,
		kind: current.kind,
		status: current.status,
		phase: current.phase,
		startedAt: current.startedAt,
		updatedAt: current.updatedAt,
		completedAt: current.completedAt,
		failedAt: current.failedAt,
		error: truncateAutoRefreshDiagnosticString_(current.error, 1000),
		sourceVersionId: current.sourceVersionId,
		sourceLastUpdatedAt: current.sourceLastUpdatedAt,
		rosterCount: current.rosterIds.length,
		taskCount: current.taskCount,
		currentTaskIndex: current.currentTaskIndex,
		processedTasks: current.processedTasks,
		processedRosters: current.processedRosters,
		issueCount: current.issueCount,
		issueSummary: truncateAutoRefreshDiagnosticString_(current.issueSummary, 500),
		taskSummary: sanitizeAutoRefreshDiagnosticFragment_(current.taskSummary, 3),
		cwlSeasonEventRefresh: sanitizeAutoRefreshDiagnosticFragment_(current.cwlSeasonEventRefresh, 3),
		cloudflarePublicDataPublish: sanitizeAutoRefreshDiagnosticFragment_(current.cloudflarePublicDataPublish, 3),
	};
}

function buildAutoRefreshTaskDiagnostics_(taskRaw) {
	const task = taskRaw && typeof taskRaw === "object" ? taskRaw : null;
	if (!task) return null;
	return {
		taskId: String(task.taskId || ""),
		type: String(task.type || ""),
		status: String(task.status || ""),
		rosterId: String(task.rosterId || ""),
		index: toNonNegativeInt_(task.index),
		attempts: toNonNegativeInt_(task.attempts),
		startedAt: String(task.startedAt || ""),
		updatedAt: String(task.updatedAt || ""),
		completedAt: String(task.completedAt || ""),
		error: truncateAutoRefreshDiagnosticString_(task.error, 1000),
		summary: truncateAutoRefreshDiagnosticString_(task.summary, 500),
	};
}

function readAutoRefreshLastJobState_() {
	const encoded = firebaseRequestJson_(FIREBASE_INTERNAL_AUTO_REFRESH_LAST_JOB_PATH, "GET");
	if (encoded == null) return null;
	return decodeFirebaseObjectKeysRecursive_(encoded);
}

function buildAutoRefreshTriggerDiagnostics_() {
	let autoRefreshCount = 0;
	let resumeCount = 0;
	try {
		autoRefreshCount = listAutoRefreshTriggers_().length;
	} catch (err) {
		autoRefreshCount = -1;
	}
	try {
		resumeCount = listAutoRefreshJobResumeTriggers_().length;
	} catch (err) {
		resumeCount = -1;
	}
	return {
		autoRefreshCount: autoRefreshCount,
		resumeCount: resumeCount,
		configuredAutoRefreshTriggerId: String(PropertiesService.getScriptProperties().getProperty(AUTO_REFRESH_TRIGGER_ID_PROPERTY) || ""),
		configuredResumeTriggerId: String(PropertiesService.getScriptProperties().getProperty(AUTO_REFRESH_JOB_TRIGGER_ID_PROPERTY) || ""),
		configuredResumeTriggerAt: String(PropertiesService.getScriptProperties().getProperty(AUTO_REFRESH_JOB_TRIGGER_AT_PROPERTY) || ""),
		configuredWatchdogTriggerId: String(PropertiesService.getScriptProperties().getProperty(AUTO_REFRESH_JOB_WATCHDOG_TRIGGER_ID_PROPERTY) || ""),
		configuredWatchdogTriggerAt: String(PropertiesService.getScriptProperties().getProperty(AUTO_REFRESH_JOB_WATCHDOG_TRIGGER_AT_PROPERTY) || ""),
		configuredPermanentWatchdogTriggerId: String(PropertiesService.getScriptProperties().getProperty(PERMANENT_SCHEDULER_WATCHDOG_TRIGGER_ID_PROPERTY) || ""),
		schedulerRepairMarker: readAutoRefreshSchedulerRepairMarker_(),
	};
}

function buildAutoRefreshLockDiagnostics_() {
	const lock = typeof readActiveRosterJobLockState_ === "function" ? readActiveRosterJobLockState_() : null;
	if (!lock) return null;
	const nowMs = Date.now();
	return {
		owner: lock.owner,
		expiresAt: new Date(lock.expiresAt).toISOString(),
		expired: lock.expiresAt <= nowMs,
		ttlMs: Math.max(0, lock.expiresAt - nowMs),
	};
}

function buildAutoRefreshDiagnostics_() {
	const current = readAutoRefreshQueueCurrent_();
	let currentTask = null;
	if (current && current.runId && current.taskIds.length) {
		const index = Math.min(current.taskIds.length - 1, Math.max(0, current.currentTaskIndex));
		const taskId = current.taskIds[index];
		if (taskId) {
			try {
				currentTask = readAutoRefreshTask_(current.runId, taskId);
			} catch (err) {
				currentTask = { taskId: taskId, status: "readError", error: errorMessage_(err) };
			}
		}
	}
	let lastJob = null;
	try {
		lastJob = readAutoRefreshLastJobState_();
	} catch (err) {
		lastJob = { status: "readError", error: errorMessage_(err) };
	}
	let activeVersionId = "";
	try {
		activeVersionId = readPublishedActiveVersionId_();
	} catch (err) {
		activeVersionId = "";
	}
	return {
		ok: true,
		checkedAt: new Date().toISOString(),
		enabled: isAutoRefreshEnabled_(),
		activeVersionId: activeVersionId,
		current: buildAutoRefreshQueueDiagnosticsState_(current),
		currentTask: buildAutoRefreshTaskDiagnostics_(currentTask),
		lastJob: sanitizeAutoRefreshDiagnosticFragment_(lastJob, 3),
		triggers: buildAutoRefreshTriggerDiagnostics_(),
		activeRosterJobLock: buildAutoRefreshLockDiagnostics_(),
	};
}

function getAutoRefreshStaleTaskAgeMs_(currentRaw, taskRaw) {
	const current = normalizeAutoRefreshQueueCurrent_(currentRaw);
	const task = taskRaw && typeof taskRaw === "object" ? taskRaw : null;
	const candidates = [];
	if (task) {
		candidates.push(task.updatedAt);
		candidates.push(task.startedAt);
	}
	if (current && current.taskSummary && typeof current.taskSummary === "object") {
		candidates.push(current.taskSummary.updatedAt);
		candidates.push(current.taskSummary.startedAt);
	}
	if (current) candidates.push(current.updatedAt);
	for (let i = 0; i < candidates.length; i++) {
		const ms = parseIsoToMs_(candidates[i]);
		if (ms > 0) return Math.max(0, Date.now() - ms);
	}
	return 0;
}

function maybeClearStaleAutoRefreshLockAfterBusy_(labelRaw) {
	const label = String(labelRaw == null ? "auto-refresh lock busy recovery" : labelRaw).trim() || "auto-refresh lock busy recovery";
	try {
		const current = readAutoRefreshQueueCurrent_();
		if (!current || current.kind !== "auto-refresh-queue") return { cleared: false, reason: "noQueue" };
		if (current.status !== "running" && current.status !== "finalizing") {
			return { cleared: false, reason: "queueNotRunnable", status: current.status };
		}
		let task = null;
		if (current.runId && current.taskIds.length) {
			const index = Math.min(current.taskIds.length - 1, Math.max(0, current.currentTaskIndex));
			const taskId = current.taskIds[index];
			if (taskId) task = readAutoRefreshTask_(current.runId, taskId);
		}
		const taskStatus = String((task && task.status) || "").trim();
		const ageMs = getAutoRefreshStaleTaskAgeMs_(current, task);
		if (ageMs < AUTO_REFRESH_QUEUE_TASK_STALE_MS) {
			return { cleared: false, reason: "notStale", ageMs: ageMs, thresholdMs: AUTO_REFRESH_QUEUE_TASK_STALE_MS };
		}
		if (task && taskStatus && taskStatus !== "running") {
			return { cleared: false, reason: "taskNotRunning", taskStatus: taskStatus, ageMs: ageMs };
		}
		const cleared = clearActiveRosterJobLockForOwners_(
			{
				"auto-refresh-coordinator": true,
				"auto-refresh-worker": true,
			},
			label,
		);
		cleared.ageMs = ageMs;
		cleared.runId = current.runId;
		cleared.phase = current.phase;
		cleared.taskId = String((task && task.taskId) || (current.taskSummary && current.taskSummary.taskId) || "");
		return cleared;
	} catch (err) {
		return { cleared: false, reason: "error", error: errorMessage_(err) };
	}
}

// Build the queue tasks for one run. Optional metric-copy chunks stage source
// metrics before roster tasks patch their refreshed entries.
function normalizeAutoRefreshMetricCopyKey_(keyRaw) {
	const key = String(keyRaw == null ? "" : keyRaw).trim();
	if (!key) return "";
	return key.indexOf(FIREBASE_KEY_ENCODING_PREFIX) === 0 ? key : encodeFirebaseObjectKey_(key);
}

function buildAutoRefreshQueueTasks_(runIdRaw, rosterIdsRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const runId = normalizeActiveVersionId_(runIdRaw);
	const rosterIds = Array.isArray(rosterIdsRaw) ? rosterIdsRaw : [];
	const tasks = [];
	const metricCopyKeysRaw = Array.isArray(options.metricCopyKeys) ? options.metricCopyKeys : [];
	const metricCopyKeys = [];
	const metricCopySeen = {};
	for (let i = 0; i < metricCopyKeysRaw.length; i++) {
		const key = normalizeAutoRefreshMetricCopyKey_(metricCopyKeysRaw[i]);
		if (!key || metricCopySeen[key]) continue;
		metricCopySeen[key] = true;
		metricCopyKeys.push(key);
	}
	metricCopyKeys.sort();
	const copyLimit = Math.max(1, toNonNegativeInt_(options.metricCopyTaskTagLimit || AUTO_REFRESH_METRIC_COPY_TASK_TAG_LIMIT));
	for (let i = 0; i < metricCopyKeys.length; i += copyLimit) {
		const chunkIndex = Math.floor(i / copyLimit) + 1;
		tasks.push({
			taskId: buildAutoRefreshTaskId_(tasks.length, "metricCopy", String(chunkIndex)),
			runId: runId,
			type: "metricCopy",
			status: "pending",
			rosterId: "",
			metricKeys: metricCopyKeys.slice(i, i + copyLimit),
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
		taskId: buildAutoRefreshTaskId_(tasks.length, "cwlCoordinator", ""),
		runId: runId,
		type: "cwlCoordinator",
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
		taskId: buildAutoRefreshTaskId_(tasks.length, "cwlFinalCoordinator", ""),
		runId: runId,
		type: "cwlFinalCoordinator",
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
function buildAutoRefreshRunSourceMeta_(runIdRaw, rosterDataRaw, sourceFingerprintRaw, runPlanRaw, sourceVersionIdRaw) {
	const rosterData = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const runPlan = runPlanRaw && typeof runPlanRaw === "object" ? runPlanRaw : {};
	const sourceVersionId = normalizeActiveVersionId_(sourceVersionIdRaw);
	const runId = normalizeActiveVersionId_(runIdRaw);
	const rosters = Array.isArray(rosterData.rosters) ? rosterData.rosters : [];
	const sourceCounts = countRosterPayload_(rosterData);
	const sourceMetrics = rosterData.playerMetrics && typeof rosterData.playerMetrics === "object" ? rosterData.playerMetrics : createEmptyPlayerMetricsStore_();
	const connectedClanTagByRosterId = {};
	const trackingModeByRosterId = {};
	const connectedRosterIds = [];
	const connectedClanTags = [];
	const connectedClanSeen = {};
	const cwlRosterClanSet = {};
	const cwlEligibleAccountTagsByRosterId = {};
	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		const rosterId = String(roster.id || "").trim();
		const clanTag = normalizeTag_(roster.connectedClanTag);
		if (!rosterId || !clanTag) continue;
		connectedClanTagByRosterId[rosterId] = clanTag;
		trackingModeByRosterId[rosterId] = getRosterTrackingMode_(roster);
		connectedRosterIds.push(rosterId);
		if (!connectedClanSeen[clanTag]) {
			connectedClanSeen[clanTag] = true;
			connectedClanTags.push(clanTag);
		}
		if (getRosterTrackingMode_(roster) === "cwl") {
			cwlRosterClanSet[clanTag] = true;
			cwlEligibleAccountTagsByRosterId[rosterId] = typeof collectCwlSeasonEventRosterEligibleAccountTags_ === "function"
				? collectCwlSeasonEventRosterEligibleAccountTags_(roster)
				: collectRosterPoolTags_(roster);
		}
	}
	const meta = {
		runId: runId,
		schemaVersion: typeof rosterData.schemaVersion === "number" && isFinite(rosterData.schemaVersion) ? rosterData.schemaVersion : 1,
		pageTitle: typeof rosterData.pageTitle === "string" ? rosterData.pageTitle : "",
		rosterOrder: Array.isArray(rosterData.rosterOrder) ? rosterData.rosterOrder.slice() : [],
		rosterIds: Array.isArray(runPlan.rosterIds) ? runPlan.rosterIds.slice() : [],
		connectedClanTagByRosterId: connectedClanTagByRosterId,
		trackingModeByRosterId: trackingModeByRosterId,
		connectedRosterIds: connectedRosterIds,
		connectedClanTags: connectedClanTags,
		cwlRosterClanTags: Object.keys(cwlRosterClanSet).sort(),
		cwlEligibleAccountTagsByRosterId: cwlEligibleAccountTagsByRosterId,
		sourceFingerprint: String(sourceFingerprintRaw || ""),
		sourceVersionId: sourceVersionId,
		sourceShardMode: sourceVersionId ? "activeVersion" : "runCopy",
		metricResultMode: "activeVersionPatches",
		metricCopyMode: sourceVersionId ? "sourceVersionChunks" : "runSourceCopy",
		metricCopyKeyCount: toNonNegativeInt_(runPlan.metricCopyKeyCount),
		playerMetricsStagedVersionId: runId,
		sourceLastUpdatedAt: String(rosterData.lastUpdatedAt || ""),
		sourceRosterCount: rosters.length,
		sourcePlayerCount: sourceCounts.playerCount,
		sourceNoteCount: sourceCounts.noteCount,
		sourceMetricEntryCount: countPlayerMetricsEntries_(sourceMetrics),
		createdAt: new Date().toISOString(),
	};
	if (rosterData.publicConfig && typeof rosterData.publicConfig === "object") meta.publicConfig = rosterData.publicConfig;
	if (typeof buildCwlSeasonEventTargetCandidatesFromRosterData_ === "function") {
		const cwlTargetCandidates = buildCwlSeasonEventTargetCandidatesFromRosterData_(rosterData, {
			fetchMissing: false,
			defaultMissingLeagueToUnranked: false,
			allowUnresolvedLeague: true,
		}).filter((candidate) => candidate && Array.isArray(candidate.eligibleAccountTags) && candidate.eligibleAccountTags.length > 0);
		if (cwlTargetCandidates.length) meta.cwlTargetCandidates = cwlTargetCandidates;
	}
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

function writeAutoRefreshRunSourceShards_(runIdRaw, rosterDataRaw, sourceFingerprintRaw, runPlanRaw, sourceOwnershipIndexRaw, sourceVersionIdRaw) {
	const source = rosterDataRaw && typeof rosterDataRaw === "object" ? rosterDataRaw : {};
	const runPlan = runPlanRaw && typeof runPlanRaw === "object" ? runPlanRaw : {};
	const sourceVersionId = normalizeActiveVersionId_(sourceVersionIdRaw);
	const rosters = Array.isArray(source.rosters) ? source.rosters : [];
	const seedPlayerByTag = {};
	const writes = [];
	for (let i = 0; i < rosters.length; i++) {
		const roster = rosters[i] && typeof rosters[i] === "object" ? rosters[i] : {};
		const rosterId = String(roster.id || "").trim();
		if (!rosterId) continue;
		if (!sourceVersionId) {
			writes.push({
				path: buildAutoRefreshRunPath_(runIdRaw, "source/rosters/" + encodeFirebaseObjectKey_(rosterId)),
				method: "PUT",
				payload: encodeFirebaseObjectKeysRecursive_(roster),
			});
		}
		const players = collectRosterPoolPlayers_(roster);
		for (let j = 0; j < players.length; j++) {
			const player = players[j] && typeof players[j] === "object" ? players[j] : {};
			const tag = normalizeTag_(player.tag);
			if (!tag || seedPlayerByTag[tag]) continue;
			seedPlayerByTag[tag] = player;
		}
	}
	const sourceMeta = buildAutoRefreshRunSourceMeta_(runIdRaw, source, sourceFingerprintRaw, runPlan, sourceVersionId);
	const sourceOwnershipIndex = sourceOwnershipIndexRaw && typeof sourceOwnershipIndexRaw === "object"
		? sourceOwnershipIndexRaw
		: buildAutoRefreshSourceOwnershipIndex_(source, {});
	writes.push({
		path: buildAutoRefreshRunPath_(runIdRaw, "source/meta"),
		method: "PUT",
		payload: encodeFirebaseObjectKeysRecursive_(sourceMeta),
	});
	writes.push({
		path: buildAutoRefreshRunPath_(runIdRaw, "source/playerSeeds"),
		method: "PUT",
		payload: encodeFirebaseObjectKeysRecursive_({ byTag: seedPlayerByTag }),
	});
	writes.push({
		path: buildAutoRefreshRunPath_(runIdRaw, "source/ownership"),
		method: "PUT",
		payload: encodeFirebaseObjectKeysRecursive_({
			sourceOwnerRosterIdByTag: sourceOwnershipIndex.sourceOwnerRosterIdByTag && typeof sourceOwnershipIndex.sourceOwnerRosterIdByTag === "object" ? sourceOwnershipIndex.sourceOwnerRosterIdByTag : {},
			liveOwnerRosterIdByTag: sourceOwnershipIndex.liveOwnerRosterIdByTag && typeof sourceOwnershipIndex.liveOwnerRosterIdByTag === "object" ? sourceOwnershipIndex.liveOwnerRosterIdByTag : {},
			liveOwnershipErrorByClanTag: sourceOwnershipIndex.liveOwnershipErrorByClanTag && typeof sourceOwnershipIndex.liveOwnershipErrorByClanTag === "object" ? sourceOwnershipIndex.liveOwnershipErrorByClanTag : {},
			liveOwnershipReadMs: toNonNegativeInt_(sourceOwnershipIndex.liveOwnershipReadMs),
			prepExcludedRosterIdByTag: buildCwlPreparationExcludedRosterIdByTag_(source),
			prepAssignedRosterIdByTag: buildCwlPreparationAssignedRosterIdByTag_(source),
		}),
	});
	const sourceMetrics = source.playerMetrics && typeof source.playerMetrics === "object" ? source.playerMetrics : createEmptyPlayerMetricsStore_();
	writes.push({
		path: buildActiveVersionPath_(runIdRaw, "playerMetrics"),
		method: "PUT",
		payload: encodeFirebaseObjectKeysRecursive_(sanitizePlayerMetricsStore_(sourceMetrics, source.lastUpdatedAt || new Date().toISOString())),
	});
	if (!sourceVersionId) {
		writes.push({
			path: buildAutoRefreshRunPath_(runIdRaw, "source/playerMetrics"),
			method: "PUT",
			payload: encodeFirebaseObjectKeysRecursive_(sanitizePlayerMetricsStore_(sourceMetrics, source.lastUpdatedAt || new Date().toISOString())),
		});
	}
	firebaseBatchPutJson_(writes, { disableFallback: true });
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

function buildAutoRefreshSourceRosterStubFromMeta_(sourceMetaRaw, rosterIdRaw) {
	const sourceMeta = sourceMetaRaw && typeof sourceMetaRaw === "object" ? sourceMetaRaw : {};
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	const connectedClanTagByRosterId = sourceMeta.connectedClanTagByRosterId && typeof sourceMeta.connectedClanTagByRosterId === "object"
		? sourceMeta.connectedClanTagByRosterId
		: {};
	const trackingModeByRosterId = sourceMeta.trackingModeByRosterId && typeof sourceMeta.trackingModeByRosterId === "object"
		? sourceMeta.trackingModeByRosterId
		: {};
	return {
		id: rosterId,
		title: rosterId,
		connectedClanTag: normalizeTag_(connectedClanTagByRosterId[rosterId]),
		trackingMode: trackingModeByRosterId[rosterId] === "regularWar" ? "regularWar" : "cwl",
		_autoRefreshSourceRosterStub: true,
		main: [],
		subs: [],
		missing: [],
	};
}

function isAutoRefreshFullSourceRoster_(sourceRosterRaw, rosterIdRaw) {
	const sourceRoster = sourceRosterRaw && typeof sourceRosterRaw === "object" ? sourceRosterRaw : null;
	if (!sourceRoster) return false;
	if (sourceRoster._autoRefreshSourceRosterStub === true) return false;
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	return !!(String(sourceRoster.id || "").trim() && (!rosterId || String(sourceRoster.id || "").trim() === rosterId));
}

function readAutoRefreshSourceRosterShardForTask_(runIdRaw, rosterIdRaw, sourceVersionIdRaw) {
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	if (!rosterId) throw new Error("Auto-refresh source roster id is required.");
	const sourceVersionId = normalizeActiveVersionId_(sourceVersionIdRaw);
	const encodedRosterId = encodeFirebaseObjectKey_(rosterId);
	const path = sourceVersionId
		? buildActiveVersionPath_(sourceVersionId, "rosters/" + encodedRosterId)
		: buildAutoRefreshRunPath_(runIdRaw, "source/rosters/" + encodedRosterId);
	const encoded = firebaseRequestJson_(path, "GET");
	const sourceRoster = decodeFirebaseObjectKeysRecursive_(encoded);
	if (!isAutoRefreshFullSourceRoster_(sourceRoster, rosterId)) {
		throw new Error("Auto-refresh source roster shard is missing for " + rosterId + ".");
	}
	return sourceRoster;
}

function readAutoRefreshSourceOwnershipShardForTask_(runIdRaw) {
	const sourceOwnership = readAutoRefreshRunShard_(runIdRaw, "source/ownership");
	return sourceOwnership && typeof sourceOwnership === "object" ? sourceOwnership : {};
}

// Read source map entries for only the player tags a bounded roster task can touch.
function readAutoRefreshSourceEntriesForTags_(runIdRaw, basePathRaw, tagsRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const tags = Array.isArray(tagsRaw) ? tagsRaw : [];
	const byTag = {};
	const seen = {};
	const normalizedBasePath = normalizeFirebasePath_(basePathRaw);
	const basePath = /^activeVersions\//.test(normalizedBasePath) || /^internal\/autoRefresh\/runs\//.test(normalizedBasePath)
		? normalizedBasePath
		: buildAutoRefreshRunPath_(runIdRaw, normalizedBasePath);
	const pathByTag = {};
	const paths = [];
	for (let i = 0; i < tags.length; i++) {
		const tag = normalizeTag_(tags[i]);
		if (!tag || seen[tag]) continue;
		seen[tag] = true;
		const path = buildFirebaseChildPath_(basePath, encodeFirebaseObjectKey_(tag));
		pathByTag[tag] = path;
		paths.push(path);
	}
	const encodedByPath = firebaseBatchGetJson_(paths, {
		disableFallback: options.disableFirebaseFallback === true,
	});
	const outTags = Object.keys(pathByTag);
	for (let i = 0; i < outTags.length; i++) {
		const tag = outTags[i];
		const entry = encodedByPath[pathByTag[tag]];
		if (entry && typeof entry === "object") byTag[tag] = decodeFirebaseObjectKeysRecursive_(entry);
	}
	return byTag;
}

// Read source metrics for only the player tags a bounded roster task can touch.
function readAutoRefreshSourceMetricEntriesForTags_(runIdRaw, tagsRaw, sourceVersionIdRaw, optionsRaw) {
	const sourceVersionId = normalizeActiveVersionId_(sourceVersionIdRaw);
	const basePath = sourceVersionId
		? buildActiveVersionPath_(sourceVersionId, "playerMetrics/byTag")
		: buildAutoRefreshRunPath_(runIdRaw, "source/playerMetrics/byTag");
	return readAutoRefreshSourceEntriesForTags_(runIdRaw, basePath, tagsRaw, optionsRaw);
}

// List encoded player-metric child keys from an immutable source version without
// downloading the metric entries themselves.
function listAutoRefreshSourceMetricKeys_(sourceVersionIdRaw) {
	const sourceVersionId = normalizeActiveVersionId_(sourceVersionIdRaw);
	if (!sourceVersionId) return [];
	return listFirebaseChildKeys_(buildActiveVersionPath_(sourceVersionId, "playerMetrics/byTag"));
}

// Copy a bounded metric-key chunk from the source active version into this run's
// target active version.
function executeAutoRefreshMetricCopyTask_(currentRaw, taskRaw, executionStartMsRaw) {
	const current = normalizeAutoRefreshQueueCurrent_(currentRaw);
	const task = taskRaw && typeof taskRaw === "object" ? taskRaw : {};
	const runId = current && current.runId;
	const sourceVersionId = normalizeActiveVersionId_(current && current.sourceVersionId);
	const taskId = String(task.taskId || "").trim();
	const taskStartMs = Date.now();
	if (!runId || !taskId) throw new Error("Auto-refresh metric copy task is missing runId or taskId.");
	if (isAutoRefreshTaskResultComplete_(runId, task)) {
		Logger.log(
			"autoRefresh worker task timing runId=%s taskId=%s rosterId=%s phase=%s fetchMs=%s processMs=%s shardWriteMs=%s totalMs=%s remainingMs=%s reason=%s",
			runId,
			taskId,
			"",
			"metricCopy",
			0,
			0,
			0,
			Math.max(0, Date.now() - taskStartMs),
			getAutoRefreshJobRemainingMs_(executionStartMsRaw),
			"resultExists",
		);
		return { skipped: true, reason: "resultExists", copiedCount: 0 };
	}
	const metricKeysRaw = Array.isArray(task.metricKeys) ? task.metricKeys : [];
	const metricKeys = [];
	const seen = {};
	for (let i = 0; i < metricKeysRaw.length; i++) {
		const key = normalizeAutoRefreshMetricCopyKey_(metricKeysRaw[i]);
		if (!key || seen[key]) continue;
		seen[key] = true;
		metricKeys.push(key);
	}
	metricKeys.sort();
	const fetchStartMs = Date.now();
	let encodedByKey = {};
	if (sourceVersionId && metricKeys.length) {
		const sourcePath = buildActiveVersionPath_(sourceVersionId, "playerMetrics/byTag");
		const firstKey = metricKeys[0];
		const lastKey = metricKeys[metricKeys.length - 1];
		const encodedResponse = firebaseRequestJson_(sourcePath, "GET", undefined, {
			orderBy: JSON.stringify("$key"),
			startAt: JSON.stringify(firstKey),
			endAt: JSON.stringify(lastKey),
		});
		if (!encodedResponse || typeof encodedResponse !== "object" || Array.isArray(encodedResponse)) {
			throw new Error("Auto-refresh metric copy range response is not an object for task " + taskId + ".");
		}
		const expectedKeys = {};
		for (let i = 0; i < metricKeys.length; i++) expectedKeys[metricKeys[i]] = true;
		const returnedKeys = Object.keys(encodedResponse);
		for (let i = 0; i < returnedKeys.length; i++) {
			if (!expectedKeys[returnedKeys[i]]) {
				throw new Error("Auto-refresh metric copy range returned unexpected key " + returnedKeys[i] + " for task " + taskId + ".");
			}
		}
		for (let i = 0; i < metricKeys.length; i++) {
			const key = metricKeys[i];
			if (!Object.prototype.hasOwnProperty.call(encodedResponse, key)) {
				throw new Error("Auto-refresh metric copy range is missing source metric key " + key + " for task " + taskId + ".");
			}
			const payload = encodedResponse[key];
			if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
				throw new Error("Auto-refresh metric copy source metric key " + key + " is not an object for task " + taskId + ".");
			}
			encodedByKey[key] = payload;
		}
	}
	const fetchMs = Math.max(0, Date.now() - fetchStartMs);
	const writeStartMs = Date.now();
	const writes = [];
	let copiedCount = 0;
	let missingCount = 0;
	for (let i = 0; i < metricKeys.length; i++) {
		const key = metricKeys[i];
		const payload = encodedByKey[key];
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
			missingCount++;
			continue;
		}
		writes.push({
			path: buildActiveVersionPath_(runId, "playerMetrics/byTag/" + key),
			method: "PUT",
			payload: payload,
		});
		copiedCount++;
	}
	if (missingCount > 0) {
		throw new Error("Auto-refresh metric copy missing " + missingCount + " source metric entr" + (missingCount === 1 ? "y" : "ies") + " for task " + taskId + ".");
	}
	writes.push({
		path: buildAutoRefreshRunPath_(runId, "metricCopies/" + encodeFirebaseObjectKey_(taskId)),
		method: "PUT",
		payload: encodeFirebaseObjectKeysRecursive_({
			taskId: taskId,
			sourceVersionId: sourceVersionId,
			requestedCount: metricKeys.length,
			copiedCount: copiedCount,
			missingCount: missingCount,
			writtenAt: new Date().toISOString(),
		}),
	});
	firebaseBatchPutJson_(writes, { disableFallback: true });
	const shardWriteMs = Math.max(0, Date.now() - writeStartMs);
	const totalMs = Math.max(0, Date.now() - taskStartMs);
	Logger.log(
		"autoRefresh worker task timing runId=%s taskId=%s rosterId=%s phase=%s fetchMs=%s processMs=%s shardWriteMs=%s totalMs=%s remainingMs=%s copied=%s missing=%s",
		runId,
		taskId,
		"",
		"metricCopy",
		fetchMs,
		0,
		shardWriteMs,
		totalMs,
		getAutoRefreshJobRemainingMs_(executionStartMsRaw),
		copiedCount,
		missingCount,
	);
	return { copiedCount: copiedCount, missingCount: missingCount, totalMs: totalMs };
}

// Read source roster seed players for only live clan tags in this task.
function readAutoRefreshSourcePlayerSeedEntriesForTags_(runIdRaw, tagsRaw, optionsRaw) {
	return readAutoRefreshSourceEntriesForTags_(runIdRaw, buildAutoRefreshRunPath_(runIdRaw, "source/playerSeeds/byTag"), tagsRaw, optionsRaw);
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
		autoRefreshSnapshotMode: true,
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

// Build active-version metric entry writes from a roster task result.
function buildActiveVersionPlayerMetricEntryWrites_(runIdRaw, metricResultRaw, writtenAtRaw) {
	const metricResult = metricResultRaw && typeof metricResultRaw === "object" ? metricResultRaw : {};
	const resultByTag = metricResult.byTag && typeof metricResult.byTag === "object" ? metricResult.byTag : {};
	const writtenAt = String(writtenAtRaw || new Date().toISOString());
	const sanitizedStore = sanitizePlayerMetricsStore_({ byTag: resultByTag, updatedAt: writtenAt }, writtenAt);
	const byTag = sanitizedStore.byTag && typeof sanitizedStore.byTag === "object" ? sanitizedStore.byTag : {};
	const keys = Object.keys(byTag);
	const writes = [];
	const tags = [];
	for (let i = 0; i < keys.length; i++) {
		const tag = normalizeTag_(keys[i]);
		if (!tag) continue;
		tags.push(tag);
		writes.push({
			path: buildActiveVersionPath_(runIdRaw, "playerMetrics/byTag/" + encodeFirebaseObjectKey_(tag)),
			method: "PUT",
			payload: encodeFirebaseObjectKeysRecursive_(byTag[keys[i]]),
		});
	}
	return {
		writes: writes,
		tags: tags,
		entryCount: tags.length,
	};
}

// Keep per-roster metric result shards small once metric entries are staged in
// the target active version.
function buildRosterMetricResultSummary_(metricResultRaw, stagedRaw, writtenAtRaw) {
	const metricResult = metricResultRaw && typeof metricResultRaw === "object" ? metricResultRaw : {};
	const staged = stagedRaw && typeof stagedRaw === "object" ? stagedRaw : {};
	const tagsRaw = Array.isArray(staged.tags) ? staged.tags : [];
	const tags = [];
	for (let i = 0; i < tagsRaw.length; i++) {
		const tag = normalizeTag_(tagsRaw[i]);
		if (tag) tags.push(tag);
	}
	return {
		metricResultMode: "activeVersionPatches",
		metricsStaged: true,
		tags: tags,
		entryCount: toNonNegativeInt_(staged.entryCount),
		summary: metricResult.summary && typeof metricResult.summary === "object" ? metricResult.summary : {},
		writtenAt: String(writtenAtRaw || new Date().toISOString()),
	};
}

// Collect normalized roster player tags for cheap cross-roster validation. This
// intentionally does not dedupe inside the roster.
function collectAutoRefreshRosterPlayerTags_(rosterRaw) {
	const roster = rosterRaw && typeof rosterRaw === "object" ? rosterRaw : {};
	const groups = [
		Array.isArray(roster.main) ? roster.main : [],
		Array.isArray(roster.subs) ? roster.subs : [],
		Array.isArray(roster.missing) ? roster.missing : [],
	];
	const tags = [];
	for (let i = 0; i < groups.length; i++) {
		const players = groups[i];
		for (let j = 0; j < players.length; j++) {
			const tag = normalizeTag_(players[j] && players[j].tag);
			if (tag) tags.push(tag);
		}
	}
	return tags;
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
	if (type === "metricCopy") {
		const taskId = String(task.taskId || "").trim();
		if (!taskId) return false;
		const result = readAutoRefreshRunShard_(runIdRaw, "metricCopies/" + encodeFirebaseObjectKey_(taskId));
		return !!(result && typeof result === "object");
	}
	if (type === "cwlCoordinator") {
		if (task.status === "completed" && task.sidePhaseTerminal === true) return true;
		const result = readAutoRefreshRunShard_(runIdRaw, "cwl/summary");
		return !!(result && typeof result === "object" && result.completed === true);
	}
	if (type === "cwlFinalCoordinator") {
		if (task.status === "completed" && task.sidePhaseTerminal === true) return true;
		const result = readAutoRefreshRunShard_(runIdRaw, "cwl/summary");
		return !!(result && typeof result === "object" && result.completed === true && result.finalCapture === true);
	}
	if (type === "roster") {
		const rosterId = String(task.rosterId || "").trim();
		if (!rosterId) return false;
		const encodedRosterId = encodeFirebaseObjectKey_(rosterId);
		const paths = [
			buildAutoRefreshRunPath_(runIdRaw, "warResults/" + encodedRosterId),
			buildAutoRefreshRunPath_(runIdRaw, "metricResults/" + encodedRosterId),
			buildAutoRefreshRunPath_(runIdRaw, "rosterWrites/" + encodedRosterId),
		];
		const encoded = firebaseBatchGetJson_(paths);
		const warResult = decodeFirebaseObjectKeysRecursive_(encoded[paths[0]]);
		const metricResult = decodeFirebaseObjectKeysRecursive_(encoded[paths[1]]);
		const rosterWrite = decodeFirebaseObjectKeysRecursive_(encoded[paths[2]]);
		return !!(warResult && typeof warResult === "object" && metricResult && typeof metricResult === "object" && rosterWrite && typeof rosterWrite === "object");
	}
	if (type === "finalize") {
		return false;
	}
	return false;
}

function buildAutoRefreshCwlCoordinatorRosterDataFromSourceMeta_(sourceMetaRaw, lastUpdatedAtRaw) {
	const sourceMeta = sourceMetaRaw && typeof sourceMetaRaw === "object" ? sourceMetaRaw : {};
	const rosterIdsRaw = Array.isArray(sourceMeta.rosterIds) ? sourceMeta.rosterIds : [];
	const connectedClanTagByRosterId =
		sourceMeta.connectedClanTagByRosterId && typeof sourceMeta.connectedClanTagByRosterId === "object"
			? sourceMeta.connectedClanTagByRosterId
			: {};
	const trackingModeByRosterId =
		sourceMeta.trackingModeByRosterId && typeof sourceMeta.trackingModeByRosterId === "object"
			? sourceMeta.trackingModeByRosterId
			: {};
	const cwlEligibleAccountTagsByRosterId = sourceMeta.cwlEligibleAccountTagsByRosterId && typeof sourceMeta.cwlEligibleAccountTagsByRosterId === "object"
		? sourceMeta.cwlEligibleAccountTagsByRosterId
		: {};
	const rosters = [];
	for (let i = 0; i < rosterIdsRaw.length; i++) {
		const rosterId = String(rosterIdsRaw[i] == null ? "" : rosterIdsRaw[i]).trim();
		if (!rosterId) continue;
		const eligibleTags = Array.isArray(cwlEligibleAccountTagsByRosterId[rosterId]) ? cwlEligibleAccountTagsByRosterId[rosterId] : [];
		rosters.push({
			id: rosterId,
			title: rosterId,
			connectedClanTag: normalizeTag_(connectedClanTagByRosterId[rosterId]),
			trackingMode: trackingModeByRosterId[rosterId] === "regularWar" ? "regularWar" : "cwl",
			main: eligibleTags.map(function (tag, index) { return { tag: normalizeTag_(tag), slot: index + 1, th: 1 }; }).filter(function (player) { return !!player.tag; }),
			subs: [],
			missing: [],
		});
	}
	const payload = {
		schemaVersion: typeof sourceMeta.schemaVersion === "number" && isFinite(sourceMeta.schemaVersion) ? sourceMeta.schemaVersion : 1,
		pageTitle: typeof sourceMeta.pageTitle === "string" ? sourceMeta.pageTitle : "",
		rosterOrder: Array.isArray(sourceMeta.rosterOrder) ? sourceMeta.rosterOrder.slice() : rosters.map((roster) => roster.id),
		rosters: rosters,
		playerMetrics: createEmptyPlayerMetricsStore_(),
		lastUpdatedAt: String(lastUpdatedAtRaw || sourceMeta.sourceLastUpdatedAt || new Date().toISOString()),
	};
	if (sourceMeta.publicConfig && typeof sourceMeta.publicConfig === "object") payload.publicConfig = sourceMeta.publicConfig;
	const validated = validateRosterData_(payload);
	if (Array.isArray(sourceMeta.cwlTargetCandidates) && typeof sanitizeCwlSeasonEventTargetCandidate_ === "function") {
		const cwlTargetCandidates = [];
		for (let i = 0; i < sourceMeta.cwlTargetCandidates.length; i++) {
			const candidate = sanitizeCwlSeasonEventTargetCandidate_(sourceMeta.cwlTargetCandidates[i]);
			if (candidate.rosterId && candidate.clanTag && candidate.eligibleAccountTags.length) cwlTargetCandidates.push(candidate);
		}
		if (cwlTargetCandidates.length) validated.cwlTargetCandidates = cwlTargetCandidates;
	}
	return validated;
}

function getAutoRefreshCwlCoordinatorAggregateHash_(coordinatorRaw) {
	const coordinator = coordinatorRaw && typeof coordinatorRaw === "object" ? coordinatorRaw : {};
	const aggregateResult = coordinator.eventAggregateResult && typeof coordinator.eventAggregateResult === "object" ? coordinator.eventAggregateResult : {};
	const aggregate = aggregateResult.aggregate && typeof aggregateResult.aggregate === "object" ? aggregateResult.aggregate : null;
	return String((aggregate && aggregate.hash) || aggregateResult.hash || "");
}

function writeAutoRefreshCwlCoordinatorResult_(runIdRaw, coordinatorRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const coordinator = coordinatorRaw && typeof coordinatorRaw === "object" ? coordinatorRaw : {};
	const capturePhase = String(options.capturePhase || coordinator.capturePhase || "early").trim() || "early";
	const views = coordinator.viewsByClanTag && typeof coordinator.viewsByClanTag === "object" ? coordinator.viewsByClanTag : {};
	const writes = [];
	const targetEvidenceRaw = coordinator.targetEvidence && typeof coordinator.targetEvidence === "object"
		? coordinator.targetEvidence
		: null;
	const targetEvidenceCandidates = [];
	const targetEvidenceCandidatesRaw = targetEvidenceRaw && Array.isArray(targetEvidenceRaw.candidates)
		? targetEvidenceRaw.candidates
		: [];
	for (let i = 0; i < targetEvidenceCandidatesRaw.length; i++) {
		const candidate = typeof sanitizeCwlSeasonEventTargetCandidate_ === "function"
			? sanitizeCwlSeasonEventTargetCandidate_(targetEvidenceCandidatesRaw[i])
			: targetEvidenceCandidatesRaw[i];
		if (candidate && typeof candidate === "object" && candidate.rosterId && candidate.clanTag) targetEvidenceCandidates.push(candidate);
	}
	const clanTags = Object.keys(views).sort();
	for (let i = 0; i < clanTags.length; i++) {
		const clanTag = normalizeTag_(clanTags[i]);
		if (!clanTag) continue;
		writes.push({
			path: buildAutoRefreshRunPath_(runIdRaw, "cwl/views/" + encodeFirebaseObjectKey_(clanTag)),
			method: "PUT",
			payload: encodeFirebaseObjectKeysRecursive_(views[clanTags[i]]),
		});
	}
	const compact = {
		completed: true,
		capturePhase: capturePhase,
		finalCapture: capturePhase === "final",
		eventId: String(coordinator.eventId || ""),
		capturedAt: String(coordinator.capturedAt || new Date().toISOString()),
		observationId: String(coordinator.observationId || ""),
		targetEvidence: targetEvidenceRaw ? {
			capturedAt: String(targetEvidenceRaw.capturedAt || coordinator.capturedAt || ""),
			observationId: String(targetEvidenceRaw.observationId || coordinator.observationId || ""),
			candidates: targetEvidenceCandidates,
		} : null,
		aggregateHash: getAutoRefreshCwlCoordinatorAggregateHash_(coordinator),
		requestCounts: coordinator.requestCounts && typeof coordinator.requestCounts === "object" ? coordinator.requestCounts : {},
		requestPlan: coordinator.requestPlan && typeof coordinator.requestPlan === "object" ? coordinator.requestPlan : {},
		runtimeState: coordinator.runtimeState && typeof coordinator.runtimeState === "object" ? coordinator.runtimeState : {},
		eventAggregateResult:
			coordinator.eventAggregateResult && typeof coordinator.eventAggregateResult === "object"
				? coordinator.eventAggregateResult
				: null,
		viewClanTags: clanTags.map((tag) => normalizeTag_(tag)).filter((tag) => tag),
		diagnostics: Array.isArray(coordinator.diagnostics) ? coordinator.diagnostics.slice(-CWL_RUNTIME_DIAGNOSTIC_LIMIT) : [],
		writtenAt: new Date().toISOString(),
	};
	writes.push({
		path: buildAutoRefreshRunPath_(runIdRaw, "cwl/summary"),
		method: "PUT",
		payload: encodeFirebaseObjectKeysRecursive_(compact),
	});
	if (writes.length) firebaseBatchPutJson_(writes, { disableFallback: true });
	return compact;
}

function readAutoRefreshCwlCoordinatorSummary_(runIdRaw) {
	const summary = readAutoRefreshRunShard_(runIdRaw, "cwl/summary");
	return summary && typeof summary === "object" ? summary : null;
}

function readAutoRefreshCwlClanView_(runIdRaw, clanTagRaw) {
	const clanTag = normalizeTag_(clanTagRaw);
	if (!clanTag) return null;
	const view = readAutoRefreshRunShard_(runIdRaw, "cwl/views/" + encodeFirebaseObjectKey_(clanTag));
	return view && typeof view === "object" ? view : null;
}

function buildAutoRefreshCwlCoordinatorPipelineStubFromSummary_(summaryRaw) {
	const summary = summaryRaw && typeof summaryRaw === "object" ? summaryRaw : null;
	if (!summary || summary.completed !== true) return null;
	return {
		ok: true,
		status: "captured",
		eventId: String(summary.eventId || ""),
		capturedAt: String(summary.capturedAt || ""),
		observationId: String(summary.observationId || ""),
		targetEvidence: summary.targetEvidence && typeof summary.targetEvidence === "object" ? summary.targetEvidence : null,
		requestCounts: summary.requestCounts && typeof summary.requestCounts === "object" ? summary.requestCounts : {},
		requestPlan: summary.requestPlan && typeof summary.requestPlan === "object" ? summary.requestPlan : {},
		runtimeState: summary.runtimeState && typeof summary.runtimeState === "object" ? summary.runtimeState : {},
		viewsByClanTag: {},
	};
}

function buildAutoRefreshNoCurrentCwlCoordinatorPipelineStub_(eventIdRaw) {
	return {
		ok: true,
		status: "no-current-cwl-event",
		eventId: String(eventIdRaw || ""),
		capturedAt: new Date().toISOString(),
		observationId: "",
		targetEvidence: null,
		requestCounts: { leagueGroup: 0, cwlWar: 0, total: 0 },
		requestPlan: {},
		runtimeState: {},
		viewsByClanTag: {},
	};
}

function ensureAutoRefreshRosterCwlCoordinatorView_(currentRaw, sourceMetaRaw, sourceRosterRaw, clanTagRaw, executionStartMsRaw) {
	const current = normalizeAutoRefreshQueueCurrent_(currentRaw);
	const runId = current && current.runId;
	const clanTag = normalizeTag_(clanTagRaw);
	const sourceMeta = sourceMetaRaw && typeof sourceMetaRaw === "object" ? sourceMetaRaw : {};
	const sourceRoster = sourceRosterRaw && typeof sourceRosterRaw === "object" ? sourceRosterRaw : {};
	if (!runId || !clanTag || getRosterTrackingMode_(sourceRoster) !== "cwl") {
		return { view: null, summary: null, coordinatorResult: null, captured: false };
	}
	let summary = readAutoRefreshCwlCoordinatorSummary_(runId);
	let view = readAutoRefreshCwlClanView_(runId, clanTag);
	if (view) {
		return {
			view: view,
			summary: summary,
			coordinatorResult: null,
			captured: false,
		};
	}
	if (summary && summary.completed === true) {
		return {
			view: null,
			summary: summary,
			coordinatorResult: buildAutoRefreshCwlCoordinatorPipelineStubFromSummary_(summary),
			captured: false,
		};
	}
	if (typeof buildCwlCoordinatorResult_ !== "function") {
		return { view: null, summary: null, coordinatorResult: null, captured: false };
	}
	if (typeof getCurrentCwlSeasonEventRefreshNeed_ === "function") {
		const need = getCurrentCwlSeasonEventRefreshNeed_();
		if (!need || need.needsCwl !== true) {
			return {
				view: null,
				summary: null,
				coordinatorResult: buildAutoRefreshNoCurrentCwlCoordinatorPipelineStub_(need && need.eventId),
				captured: false,
			};
		}
	}
	if (!hasAutoRefreshJobBudgetFor_(executionStartMsRaw, AUTO_REFRESH_QUEUE_ROSTER_PROCESS_RESERVE_MS + AUTO_REFRESH_QUEUE_ROSTER_WRITE_RESERVE_MS)) {
		return { deferred: true, reason: "beforeRosterCwlCoordinator", view: null, summary: null, coordinatorResult: null };
	}
	const captureStartMs = Date.now();
	const rosterData = buildAutoRefreshCwlCoordinatorRosterDataFromSourceMeta_(
		sourceMeta,
		sourceMeta.sourceLastUpdatedAt || new Date().toISOString(),
	);
	const coordinator = buildCwlCoordinatorResult_(rosterData, {
		nowIso: new Date().toISOString(),
		source: "auto-refresh-queue-roster-cwl-coordinator",
		runId: runId,
	});
	if (!hasAutoRefreshJobBudgetFor_(executionStartMsRaw, AUTO_REFRESH_QUEUE_ROSTER_WRITE_RESERVE_MS)) {
		return {
			deferred: true,
			reason: "beforeRosterCwlCoordinatorWrite",
			view: null,
			summary: null,
			coordinatorResult: null,
			processMs: Math.max(0, Date.now() - captureStartMs),
		};
	}
	try {
		summary = writeAutoRefreshCwlCoordinatorResult_(runId, coordinator, { capturePhase: "early" });
	} catch (err) {
		if (err && err.autoRefreshDefer) {
			return { deferred: true, reason: "firebase-cwl-coordinator-write", view: null, summary: null, coordinatorResult: null };
		}
		throw err;
	}
	view = readAutoRefreshCwlClanView_(runId, clanTag);
	Logger.log(
		"autoRefresh roster ensured cwl coordinator runId=%s rosterId=%s clanTag=%s eventId=%s aggregateHash=%s elapsedMs=%s leagueGroupRequests=%s cwlWarRequests=%s",
		runId,
		String(sourceRoster.id || ""),
		clanTag,
		String(summary && summary.eventId || ""),
		String(summary && summary.aggregateHash || ""),
		Math.max(0, Date.now() - captureStartMs),
		toNonNegativeInt_(summary && summary.requestCounts && summary.requestCounts.leagueGroup),
		toNonNegativeInt_(summary && summary.requestCounts && summary.requestCounts.cwlWar),
	);
	return {
		view: view,
		summary: summary,
		coordinatorResult: view ? null : buildAutoRefreshCwlCoordinatorPipelineStubFromSummary_(summary),
		captured: true,
		deferred: true,
		reason: "afterRosterCwlCoordinator",
	};
}

function shouldRunAutoRefreshCwlCoordinatorPreflightBeforeRoster_(currentRaw, taskRaw) {
	const current = normalizeAutoRefreshQueueCurrent_(currentRaw);
	const task = taskRaw && typeof taskRaw === "object" ? taskRaw : {};
	const runId = current && current.runId;
	if (!runId || String(task.type || "") !== "roster") return false;
	// A failed/deferred persisted coordinator already created independent CWL
	// recovery work. Never rerun that same side work in front of canonical roster
	// processing for this run.
	if (current.cwlCoordinatorSidePhaseTerminal === true) return false;
	const summary = readAutoRefreshCwlCoordinatorSummary_(runId);
	if (summary && summary.completed === true) return false;
	if (typeof getCurrentCwlSeasonEventRefreshNeed_ === "function") {
		const need = getCurrentCwlSeasonEventRefreshNeed_();
		if (!need || need.needsCwl !== true) return false;
	}
	const sourceMeta = readAutoRefreshRunShard_(runId, "source/meta");
	if (!sourceMeta || typeof sourceMeta !== "object") return false;
	const rosterId = String(task.rosterId || "").trim();
	if (!rosterId) return false;
	const trackingModeByRosterId = sourceMeta.trackingModeByRosterId && typeof sourceMeta.trackingModeByRosterId === "object"
		? sourceMeta.trackingModeByRosterId
		: {};
	const connectedClanTagByRosterId = sourceMeta.connectedClanTagByRosterId && typeof sourceMeta.connectedClanTagByRosterId === "object"
		? sourceMeta.connectedClanTagByRosterId
		: {};
	return trackingModeByRosterId[rosterId] !== "regularWar" && !!normalizeTag_(connectedClanTagByRosterId[rosterId]);
}

function runAutoRefreshCwlCoordinatorPreflightBeforeRoster_(currentRaw, taskRaw, executionStartMsRaw) {
	const task = taskRaw && typeof taskRaw === "object" ? taskRaw : {};
	if (!shouldRunAutoRefreshCwlCoordinatorPreflightBeforeRoster_(currentRaw, task)) return null;
	const syntheticTask = {
		taskId: buildAutoRefreshTaskId_(toNonNegativeInt_(task.index), "cwlCoordinator", "preflight"),
		runId: currentRaw && currentRaw.runId,
		type: "cwlCoordinator",
		status: "running",
		rosterId: "",
		index: toNonNegativeInt_(task.index),
		attempts: 1,
		startedAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		completedAt: "",
		error: "",
		summary: "synthetic-cwl-preflight-before-roster",
	};
	const result = executeAutoRefreshCwlCoordinatorCaptureTask_(currentRaw, syntheticTask, executionStartMsRaw, {
		capturePhase: "early",
		source: "auto-refresh-queue-roster-cwl-preflight",
	});
	if (result && result.deferred) {
		return { deferred: true, reason: result.reason || "beforeRosterCwlCoordinator", result: result };
	}
	return { captured: true, reason: "cwlCoordinatorPreflight", result: result };
}

function runAutoRefreshFinalCwlCoordinatorPreflightBeforeFinalize_(currentRaw, taskRaw, executionStartMsRaw) {
	const task = taskRaw && typeof taskRaw === "object" ? taskRaw : {};
	if (String(task.type || "") !== "finalize") return null;
	const capture = ensureAutoRefreshFinalCwlCoordinatorCapture_(currentRaw, null, executionStartMsRaw);
	const status = String(capture && capture.status || "").trim();
	if (status === "reused" || status === "no-current-cwl-event" || (capture && capture.skipped === true && capture.ok !== false)) return null;
	if (capture && capture.ok !== false && status === "captured") {
		return { captured: true, reason: "finalCwlCoordinatorPreflight", result: capture };
	}
	return {
		deferred: true,
		reason: String((capture && (capture.reason || capture.status)) || "beforeFinalCwlCoordinator"),
		result: capture,
	};
}

function readAutoRefreshPreparedRosterInput_(runIdRaw, rosterIdRaw) {
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	if (!rosterId) return null;
	const input = readAutoRefreshRunShard_(runIdRaw, "rosterInputs/" + encodeFirebaseObjectKey_(rosterId));
	return input && typeof input === "object" ? input : null;
}

function writeAutoRefreshPreparedRosterInput_(runIdRaw, rosterIdRaw, inputRaw) {
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	const input = inputRaw && typeof inputRaw === "object" ? inputRaw : {};
	if (!rosterId) return null;
	const payload = {
		rosterId: rosterId,
		sourceMeta: input.sourceMeta && typeof input.sourceMeta === "object" ? input.sourceMeta : {},
		// Firebase Realtime Database elides empty objects and arrays. Persist
		// explicit completion evidence instead of inferring phase durability from
		// optional empty snapshot maps after a round trip.
		primarySnapshotCaptured: input.primarySnapshotCaptured === true,
		snapshotPlanBuilt: input.snapshotPlanBuilt === true,
		sourceRoster: null,
		sourceOwnership: {},
		clanSnapshot: input.clanSnapshot && typeof input.clanSnapshot === "object" ? input.clanSnapshot : null,
		sourceMetricByTag: input.sourceMetricByTag && typeof input.sourceMetricByTag === "object" ? input.sourceMetricByTag : {},
		sourceSeedByTag: input.sourceSeedByTag && typeof input.sourceSeedByTag === "object" ? input.sourceSeedByTag : {},
		metricTags: Array.isArray(input.metricTags) ? input.metricTags.map((tag) => normalizeTag_(tag)).filter((tag) => tag) : [],
		metricReadTags: Array.isArray(input.metricReadTags) ? input.metricReadTags.map((tag) => normalizeTag_(tag)).filter((tag) => tag) : [],
		seedReadTags: Array.isArray(input.seedReadTags) ? input.seedReadTags.map((tag) => normalizeTag_(tag)).filter((tag) => tag) : [],
		targetSeedByTag: input.targetSeedByTag && typeof input.targetSeedByTag === "object" ? input.targetSeedByTag : {},
		currentRegularWarByClanTag: input.currentRegularWarByClanTag && typeof input.currentRegularWarByClanTag === "object" ? input.currentRegularWarByClanTag : {},
		currentRegularWarErrorByClanTag: input.currentRegularWarErrorByClanTag && typeof input.currentRegularWarErrorByClanTag === "object" ? input.currentRegularWarErrorByClanTag : {},
		regularWarLogByClanTag: input.regularWarLogByClanTag && typeof input.regularWarLogByClanTag === "object" ? input.regularWarLogByClanTag : {},
		regularWarLogErrorByClanTag: input.regularWarLogErrorByClanTag && typeof input.regularWarLogErrorByClanTag === "object" ? input.regularWarLogErrorByClanTag : {},
		requestCounts: input.requestCounts && typeof input.requestCounts === "object" ? input.requestCounts : {},
		cwlCoordinatorClanView: input.cwlCoordinatorClanView && typeof input.cwlCoordinatorClanView === "object" ? input.cwlCoordinatorClanView : null,
		cwlCoordinatorResult: input.cwlCoordinatorResult && typeof input.cwlCoordinatorResult === "object" ? input.cwlCoordinatorResult : null,
		writtenAt: new Date().toISOString(),
	};
	writeAutoRefreshRunShard_(runIdRaw, "rosterInputs/" + encodeFirebaseObjectKey_(rosterId), payload, "PUT");
	return payload;
}

function readAutoRefreshRosterPhaseState_(runIdRaw, rosterIdRaw) {
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	if (!rosterId) return null;
	const state = readAutoRefreshRunShard_(runIdRaw, "rosterStates/" + encodeFirebaseObjectKey_(rosterId));
	return state && typeof state === "object" ? state : null;
}

function writeAutoRefreshRosterPhaseState_(runIdRaw, rosterIdRaw, stateRaw) {
	const rosterId = String(rosterIdRaw == null ? "" : rosterIdRaw).trim();
	if (!rosterId) return null;
	const state = stateRaw && typeof stateRaw === "object" ? stateRaw : {};
	writeAutoRefreshRunShard_(runIdRaw, "rosterStates/" + encodeFirebaseObjectKey_(rosterId), state, "PUT");
	return state;
}

function normalizeAutoRefreshRosterPhase_(phaseRaw) {
	const phase = String(phaseRaw == null ? "" : phaseRaw).trim();
	if (
		phase === "source" ||
		phase === "primarySnapshot" ||
		phase === "warInputs" ||
		phase === "metricSeedInputs" ||
		phase === "processSnapshot" ||
		phase === "commit" ||
		phase === "completed"
	) {
		return phase;
	}
	return "source";
}

function hasAutoRefreshPreparedRosterSnapshotPlan_(preparedInputRaw) {
	const preparedInput = preparedInputRaw && typeof preparedInputRaw === "object" ? preparedInputRaw : null;
	if (!preparedInput || !preparedInput.sourceMeta || typeof preparedInput.sourceMeta !== "object") return false;
	if (preparedInput.snapshotPlanBuilt === true) return true;
	// Backward-compatible evidence for in-flight plans created before the
	// explicit marker rollout. Do not require optional empty war maps: RTDB
	// legitimately omits them, while the processing phase already defaults them
	// to empty objects.
	const hasLegacyPrimaryEvidence = preparedInput.primarySnapshotCaptured === true ||
		Object.prototype.hasOwnProperty.call(preparedInput, "clanSnapshot") ||
		Object.prototype.hasOwnProperty.call(preparedInput, "currentRegularWarByClanTag") ||
		Object.prototype.hasOwnProperty.call(preparedInput, "currentRegularWarErrorByClanTag");
	return hasLegacyPrimaryEvidence && (
		Array.isArray(preparedInput.metricReadTags) &&
		Array.isArray(preparedInput.seedReadTags) &&
		preparedInput.targetSeedByTag &&
		typeof preparedInput.targetSeedByTag === "object"
	);
}

function hasAutoRefreshPreparedPrimarySnapshot_(preparedInputRaw) {
	const preparedInput = preparedInputRaw && typeof preparedInputRaw === "object" ? preparedInputRaw : null;
	if (!preparedInput || !preparedInput.sourceMeta || typeof preparedInput.sourceMeta !== "object") return false;
	if (preparedInput.primarySnapshotCaptured === true) return true;
	// Preserve the conservative migration rule for genuinely old partial inputs.
	// Only an explicit marker or the complete legacy field set proves that the
	// primary phase finished; the broader legacy inference is limited to plans
	// that also contain their completed metric/seed read descriptors.
	return Object.prototype.hasOwnProperty.call(preparedInput, "clanSnapshot") &&
		Object.prototype.hasOwnProperty.call(preparedInput, "currentRegularWarByClanTag") &&
		Object.prototype.hasOwnProperty.call(preparedInput, "currentRegularWarErrorByClanTag");
}

function buildInitialAutoRefreshRosterPhaseState_(runIdRaw, taskRaw, preparedInputRaw) {
	const task = taskRaw && typeof taskRaw === "object" ? taskRaw : {};
	const rosterId = String(task.rosterId || "").trim();
	const preparedInput = preparedInputRaw && typeof preparedInputRaw === "object" ? preparedInputRaw : null;
	let phase = normalizeAutoRefreshRosterPhase_(task.phase);
	if (!task.phase) {
		if (isAutoRefreshTaskResultComplete_(runIdRaw, task)) {
			phase = "completed";
		} else if (hasAutoRefreshPreparedRosterSnapshotPlan_(preparedInput)) {
			const metricTags = Array.isArray(preparedInput.metricReadTags) ? preparedInput.metricReadTags : [];
			const seedTags = Array.isArray(preparedInput.seedReadTags) ? preparedInput.seedReadTags : [];
			const metricCount = Object.keys(preparedInput.sourceMetricByTag || {}).length;
			const seedCount = Object.keys(preparedInput.sourceSeedByTag || {}).length;
			phase = metricCount < metricTags.length || seedCount < seedTags.length
				? "metricSeedInputs"
				: "processSnapshot";
		} else if (hasAutoRefreshPreparedPrimarySnapshot_(preparedInput)) {
			phase = "metricSeedInputs";
		} else if (preparedInput && preparedInput.sourceMeta) {
			phase = "primarySnapshot";
		} else {
			phase = "source";
		}
	}
	return {
		runId: normalizeActiveVersionId_(runIdRaw),
		taskId: String(task.taskId || ""),
		rosterId: rosterId,
		phase: phase,
		cursor: task.phaseCursor && typeof task.phaseCursor === "object" ? task.phaseCursor : {},
		attemptByPhase: task.phaseAttempts && typeof task.phaseAttempts === "object" ? task.phaseAttempts : {},
		lease: task.phaseLease && typeof task.phaseLease === "object" ? task.phaseLease : null,
		error: String(task.phaseError || task.error || ""),
		updatedAt: new Date().toISOString(),
	};
}

function getAutoRefreshRosterPhaseState_(runIdRaw, taskRaw, preparedInputRaw) {
	const task = taskRaw && typeof taskRaw === "object" ? taskRaw : {};
	const rosterId = String(task.rosterId || "").trim();
	const preparedInput = preparedInputRaw && typeof preparedInputRaw === "object" ? preparedInputRaw : null;
	const stored = readAutoRefreshRosterPhaseState_(runIdRaw, rosterId);
	const state = stored && typeof stored === "object" ? stored : buildInitialAutoRefreshRosterPhaseState_(runIdRaw, task, preparedInputRaw);
	state.runId = normalizeActiveVersionId_(runIdRaw);
	state.taskId = String(task.taskId || state.taskId || "");
	state.rosterId = rosterId;
	state.phase = normalizeAutoRefreshRosterPhase_(state.phase);
	state.cursor = state.cursor && typeof state.cursor === "object" ? state.cursor : {};
	state.attemptByPhase = state.attemptByPhase && typeof state.attemptByPhase === "object" ? state.attemptByPhase : {};
	if (
		(state.phase === "processSnapshot" || state.phase === "commit") &&
		!hasAutoRefreshPreparedRosterSnapshotPlan_(preparedInputRaw) &&
		!isAutoRefreshTaskResultComplete_(runIdRaw, task)
	) {
		state.phase = hasAutoRefreshPreparedPrimarySnapshot_(preparedInput)
			? "metricSeedInputs"
			: preparedInput && preparedInput.sourceMeta
				? "primarySnapshot"
				: "source";
		state.cursor = {};
		state.error = "migrated-missing-snapshot-plan";
	}
	return state;
}

function approximateAutoRefreshPayloadSize_(valueRaw) {
	try {
		return JSON.stringify(valueRaw == null ? null : valueRaw).length;
	} catch (err) {
		return -1;
	}
}

function logAutoRefreshRosterPhase_(labelRaw, currentRaw, taskRaw, stateRaw, detailsRaw) {
	const current = normalizeAutoRefreshQueueCurrent_(currentRaw);
	const task = taskRaw && typeof taskRaw === "object" ? taskRaw : {};
	const state = stateRaw && typeof stateRaw === "object" ? stateRaw : {};
	const details = detailsRaw && typeof detailsRaw === "object" ? detailsRaw : {};
	const cursor = state.cursor && typeof state.cursor === "object" ? state.cursor : {};
	Logger.log(
		"autoRefresh roster phase %s runId=%s taskId=%s rosterId=%s phase=%s cursorMetric=%s cursorSeed=%s requestCount=%s tagCount=%s payloadBytes=%s attempt=%s elapsedMs=%s reason=%s forbiddenLiveFetch=%s",
		String(labelRaw || ""),
		current ? current.runId : String(state.runId || ""),
		String(task.taskId || state.taskId || ""),
		String(task.rosterId || state.rosterId || ""),
		String(state.phase || ""),
		toNonNegativeInt_(cursor.metricOffset),
		toNonNegativeInt_(cursor.seedOffset),
		toNonNegativeInt_(details.requestCount),
		toNonNegativeInt_(details.tagCount),
		isFinite(Number(details.payloadBytes)) ? Number(details.payloadBytes) : -1,
		toNonNegativeInt_(details.attempt || (state.attemptByPhase && state.attemptByPhase[state.phase])),
		toNonNegativeInt_(details.elapsedMs),
		String(details.reason || ""),
		details.forbiddenLiveFetch === true,
	);
}

function checkpointAutoRefreshRosterPhase_(currentRaw, taskRaw, stateRaw, phaseRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const current = normalizeAutoRefreshQueueCurrent_(currentRaw);
	const task = taskRaw && typeof taskRaw === "object" ? taskRaw : {};
	const state = stateRaw && typeof stateRaw === "object" ? stateRaw : {};
	const phase = normalizeAutoRefreshRosterPhase_(phaseRaw);
	const nowIso = new Date().toISOString();
	state.phase = phase;
	state.cursor = options.cursor && typeof options.cursor === "object" ? options.cursor : state.cursor && typeof state.cursor === "object" ? state.cursor : {};
	state.attemptByPhase = state.attemptByPhase && typeof state.attemptByPhase === "object" ? state.attemptByPhase : {};
	if (options.start === true) {
		state.attemptByPhase[phase] = toNonNegativeInt_(state.attemptByPhase[phase]) + 1;
	}
	const phaseAttempt = toNonNegativeInt_(state.attemptByPhase[phase]);
	state.lease = {
		owner: "auto-refresh-worker",
		taskId: String(task.taskId || ""),
		phase: phase,
		attempt: phaseAttempt,
		updatedAt: nowIso,
	};
	state.error = String(options.error || "");
	state.updatedAt = nowIso;
	writeAutoRefreshRosterPhaseState_(current ? current.runId : state.runId, task.rosterId || state.rosterId, state);
	task.phase = phase;
	task.phaseCursor = state.cursor;
	task.phaseAttempts = state.attemptByPhase;
	task.phaseLease = state.lease;
	task.phaseError = state.error;
	task.updatedAt = nowIso;
	if (current && current.runId && task.taskId) writeAutoRefreshTask_(current.runId, task);
	if (current && current.runId) {
		current.taskSummary = {
			taskId: task.taskId,
			type: task.type,
			rosterId: String(task.rosterId || ""),
			phase: phase,
			cursor: state.cursor,
			attempts: phaseAttempt,
			updatedAt: nowIso,
		};
		current.updatedAt = nowIso;
		writeAutoRefreshQueueCurrent_(current, false);
	}
	return state;
}

function shouldFailAutoRefreshRosterPhaseAfterAttempts_(stateRaw, phaseRaw) {
	const state = stateRaw && typeof stateRaw === "object" ? stateRaw : {};
	const phase = normalizeAutoRefreshRosterPhase_(phaseRaw);
	const attempts = state.attemptByPhase && typeof state.attemptByPhase === "object" ? toNonNegativeInt_(state.attemptByPhase[phase]) : 0;
	return attempts >= AUTO_REFRESH_ROSTER_PHASE_MAX_ATTEMPTS;
}

function serializeAutoRefreshPhaseError_(errRaw) {
	const err = errRaw && typeof errRaw === "object" ? errRaw : null;
	return {
		name: String((err && err.name) || "Error"),
		message: errorMessage_(errRaw),
		statusCode: Number(err && err.statusCode) || 0,
		retryAfter: String((err && err.retryAfter) || ""),
		autoRefreshSnapshotMiss: !!(err && err.autoRefreshSnapshotMiss),
	};
}

function reviveAutoRefreshPhaseError_(errorRaw) {
	const raw = errorRaw && typeof errorRaw === "object" ? errorRaw : null;
	if (!raw) return null;
	const err = new Error(String(raw.message || "Auto-refresh phase error."));
	err.name = String(raw.name || "Error");
	if (raw.statusCode != null) err.statusCode = Number(raw.statusCode) || 0;
	if (raw.retryAfter != null) err.retryAfter = String(raw.retryAfter || "");
	if (raw.autoRefreshSnapshotMiss) err.autoRefreshSnapshotMiss = true;
	return err;
}

function reviveAutoRefreshPhaseErrorMap_(mapRaw) {
	const map = mapRaw && typeof mapRaw === "object" ? mapRaw : {};
	const out = {};
	const keys = Object.keys(map);
	for (let i = 0; i < keys.length; i++) {
		const tag = normalizeTag_(keys[i]) || String(keys[i] || "");
		if (!tag) continue;
		out[tag] = reviveAutoRefreshPhaseError_(map[keys[i]]) || map[keys[i]];
	}
	return out;
}

function isRetryableAutoRefreshExternalError_(errRaw) {
	if (errRaw && errRaw.autoRefreshDefer) return true;
	const statusCode = Number(errRaw && errRaw.statusCode);
	if (isFinite(statusCode) && statusCode > 0) {
		return statusCode === 429 || statusCode >= 500;
	}
	return true;
}

function markAutoRefreshRosterPhaseDeferred_(currentRaw, taskRaw, stateRaw, reasonRaw, errRaw, executionStartMsRaw) {
	const reason = String(reasonRaw || "rosterPhaseDeferred").trim() || "rosterPhaseDeferred";
	const message = errRaw ? errorMessage_(errRaw) : reason;
	checkpointAutoRefreshRosterPhase_(currentRaw, taskRaw, stateRaw, stateRaw && stateRaw.phase, {
		error: message,
	});
	logAutoRefreshRosterPhase_("deferred", currentRaw, taskRaw, stateRaw, {
		reason: reason,
		elapsedMs: getAutoRefreshJobElapsedMs_(executionStartMsRaw),
	});
	if (isFirebaseDailyUrlFetchQuotaError_(errRaw)) {
		removeAutoRefreshJobResumeTriggers_();
		Logger.log("Auto-refresh roster phase paused without short retry because Firebase UrlFetch daily quota is exhausted.");
	} else {
		scheduleAutoRefreshJobResume_();
	}
	return { deferred: true, reason: reason, rosterId: String((taskRaw && taskRaw.rosterId) || ""), error: message };
}

// Leave a queue task recoverable without scheduling short retries while the
// Apps Script daily UrlFetch quota is exhausted. The persisted running task
// remains protected by the existing stale-run recovery path.
function buildAutoRefreshUrlFetchQuotaPauseResult_(currentRaw) {
	const current = normalizeAutoRefreshQueueCurrent_(currentRaw);
	removeAutoRefreshJobResumeTriggers_();
	Logger.log("Auto-refresh worker paused without short retry because Firebase UrlFetch daily quota is exhausted.");
	return {
		ok: true,
		status: "inProgress",
		inProgress: true,
		reason: "firebaseUrlFetchQuota",
		quotaPaused: true,
		processedRosters: current ? current.processedRosters : 0,
		totalRosters: current ? current.rosterIds.length : 0,
	};
}

function collectAutoRefreshRosterInputReadPlan_(sourceRosterRaw, clanSnapshotRaw) {
	const sourceRoster = sourceRosterRaw && typeof sourceRosterRaw === "object" ? sourceRosterRaw : {};
	const clanSnapshot = clanSnapshotRaw && typeof clanSnapshotRaw === "object" ? clanSnapshotRaw : {};
	const liveTags = [];
	const liveSeen = {};
	const liveMembers = Array.isArray(clanSnapshot.members) ? clanSnapshot.members : [];
	for (let i = 0; i < liveMembers.length; i++) {
		const tag = normalizeTag_(liveMembers[i] && liveMembers[i].tag);
		if (!tag || liveSeen[tag]) continue;
		liveSeen[tag] = true;
		liveTags.push(tag);
	}
	const metricTags = [];
	const metricSeen = {};
	const metricsMembers = Array.isArray(clanSnapshot.metricsMembers) ? clanSnapshot.metricsMembers : [];
	for (let i = 0; i < metricsMembers.length; i++) {
		const tag = normalizeTag_(metricsMembers[i] && metricsMembers[i].tag);
		if (!tag || metricSeen[tag]) continue;
		metricSeen[tag] = true;
		metricTags.push(tag);
	}
	const targetSeedByTag = buildRosterPlayerSeedByTag_({ rosters: [sourceRoster] });
	const targetSeedTags = Object.keys(targetSeedByTag);
	const metricReadTags = metricTags.slice();
	const metricReadSet = {};
	for (let i = 0; i < metricReadTags.length; i++) {
		const tag = normalizeTag_(metricReadTags[i]);
		if (tag) metricReadSet[tag] = true;
	}
	for (let i = 0; i < targetSeedTags.length; i++) {
		const tag = normalizeTag_(targetSeedTags[i]);
		if (!tag || metricReadSet[tag]) continue;
		metricReadSet[tag] = true;
		metricReadTags.push(tag);
	}
	const seedReadTags = [];
	const seedReadSeen = {};
	for (let i = 0; i < liveTags.length; i++) {
		const tag = normalizeTag_(liveTags[i]);
		if (!tag || seedReadSeen[tag] || targetSeedByTag[tag]) continue;
		seedReadSeen[tag] = true;
		seedReadTags.push(tag);
	}
	return {
		liveTags: liveTags,
		metricTags: metricTags,
		metricReadTags: metricReadTags,
		seedReadTags: seedReadTags,
		targetSeedByTag: targetSeedByTag,
	};
}

function hasAutoRefreshSnapshotMissIssue_(issuesRaw) {
	const issues = Array.isArray(issuesRaw) ? issuesRaw : [];
	for (let i = 0; i < issues.length; i++) {
		const issue = issues[i] && typeof issues[i] === "object" ? issues[i] : {};
		const message = String(issue.message || "");
		if (message.indexOf("Auto-refresh snapshot missing") >= 0) return true;
	}
	return false;
}

function withAutoRefreshQueueLiveFetchGuard_(fn) {
	const root = typeof globalThis !== "undefined" ? globalThis : this;
	const names = [
		"cocFetch_",
		"cocFetchAllByPathEntries_",
		"fetchClanMembersSnapshot_",
		"fetchClanMembers_",
		"prefetchClanMembersSnapshotsByTag_",
		"fetchLeagueGroupData_",
		"prefetchLeagueGroupRawByClanTag_",
		"fetchCurrentRegularWar_",
		"prefetchCurrentRegularWarByClanTag_",
		"prefetchCwlWarRawByTag_",
		"fetchClanWarLog_",
		"prefetchRegularWarLogByClanTag_",
	];
	const originals = {};
	const guard = { attempted: false, labels: [] };
	for (let i = 0; i < names.length; i++) {
		const name = names[i];
		if (!root || typeof root[name] !== "function") continue;
		originals[name] = root[name];
		root[name] = function () {
			guard.attempted = true;
			guard.labels.push(name);
			throw buildAutoRefreshSnapshotMissError_("forbiddenLiveFetch", name, "queue roster processing");
		};
	}
	try {
		const result = fn(guard);
		return { result: result, guard: guard, error: null };
	} catch (err) {
		return { result: null, guard: guard, error: err };
	} finally {
		const originalNames = Object.keys(originals);
		for (let i = 0; i < originalNames.length; i++) {
			root[originalNames[i]] = originals[originalNames[i]];
		}
	}
}

function executeAutoRefreshCwlCoordinatorCaptureTask_(currentRaw, taskRaw, executionStartMsRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const capturePhase = String(options.capturePhase || "early").trim() || "early";
	const source = String(options.source || (capturePhase === "final" ? "auto-refresh-queue-final-cwl-coordinator" : "auto-refresh-queue-cwl-coordinator")).trim();
	const current = normalizeAutoRefreshQueueCurrent_(currentRaw);
	const task = taskRaw && typeof taskRaw === "object" ? taskRaw : {};
	const runId = current && current.runId;
	const taskStartMs = Date.now();
	if (!runId) throw new Error("Auto-refresh CWL coordinator task is missing runId.");
	if (isAutoRefreshTaskResultComplete_(runId, task)) {
		return { skipped: true, reason: "resultExists", totalMs: Math.max(0, Date.now() - taskStartMs) };
	}
	if (capturePhase === "final" && typeof getCurrentCwlSeasonEventRefreshNeed_ === "function") {
		const need = getCurrentCwlSeasonEventRefreshNeed_();
		if (!need || need.needsCwl !== true) {
			const compact = writeAutoRefreshCwlCoordinatorResult_(runId, {
				ok: true,
				eventId: need && need.eventId ? String(need.eventId) : "",
				capturedAt: new Date().toISOString(),
				requestCounts: { leagueGroup: 0, cwlWar: 0, total: 0 },
				requestPlan: {},
				runtimeState: {},
				viewsByClanTag: {},
				eventAggregateResult: { ok: true, status: "no-current-cwl-event", aggregate: null },
				diagnostics: [],
			}, { capturePhase: "final" });
			return {
				eventId: compact.eventId,
				capturePhase: compact.capturePhase,
				finalCapture: compact.finalCapture,
				capturedAt: compact.capturedAt,
				aggregateHash: compact.aggregateHash,
				viewClanCount: 0,
				requestCounts: compact.requestCounts,
				skipped: true,
				reason: "no-current-cwl-event",
				totalMs: Math.max(0, Date.now() - taskStartMs),
			};
		}
	}
	const sourceMeta = readAutoRefreshRunShard_(runId, "source/meta");
	if (!sourceMeta || typeof sourceMeta !== "object") throw new Error("Auto-refresh source metadata is missing.");
	const rosterData = buildAutoRefreshCwlCoordinatorRosterDataFromSourceMeta_(sourceMeta, sourceMeta.sourceLastUpdatedAt || new Date().toISOString());
	const processStartMs = Date.now();
	const coordinator =
		typeof buildCwlCoordinatorResult_ === "function"
			? buildCwlCoordinatorResult_(rosterData, {
				nowIso: new Date().toISOString(),
				source: source,
				runId: runId,
			})
			: { ok: true, status: "unavailable", viewsByClanTag: {}, requestCounts: {} };
	const processMs = Math.max(0, Date.now() - processStartMs);
	if (!hasAutoRefreshJobBudgetFor_(executionStartMsRaw, AUTO_REFRESH_QUEUE_ROSTER_WRITE_RESERVE_MS)) {
		return { deferred: true, reason: "beforeCwlCoordinatorWrite", processMs: processMs };
	}
	const writeStartMs = Date.now();
	let compact = null;
	try {
		compact = writeAutoRefreshCwlCoordinatorResult_(runId, coordinator, { capturePhase: capturePhase });
	} catch (err) {
		if (err && err.autoRefreshDefer) {
			return { deferred: true, reason: "firebase-cwl-coordinator-write", error: errorMessage_(err), processMs: processMs };
		}
		throw err;
	}
	const writeMs = Math.max(0, Date.now() - writeStartMs);
	Logger.log(
		"autoRefresh worker task timing runId=%s taskId=%s rosterId=%s phase=%s fetchMs=%s processMs=%s shardWriteMs=%s totalMs=%s remainingMs=%s cwlLeagueGroupRequests=%s cwlWarRequests=%s eventId=%s aggregateHash=%s",
		runId,
		String(task.taskId || ""),
		"",
		capturePhase === "final" ? "cwlFinalCoordinator" : "cwlCoordinator",
		0,
		processMs,
		writeMs,
		Math.max(0, Date.now() - taskStartMs),
		getAutoRefreshJobRemainingMs_(executionStartMsRaw),
		toNonNegativeInt_(compact.requestCounts && compact.requestCounts.leagueGroup),
		toNonNegativeInt_(compact.requestCounts && compact.requestCounts.cwlWar),
		String(compact.eventId || ""),
		String(compact.aggregateHash || ""),
	);
	return {
		eventId: compact.eventId,
		capturePhase: compact.capturePhase,
		finalCapture: compact.finalCapture,
		capturedAt: compact.capturedAt,
		aggregateHash: compact.aggregateHash,
		viewClanCount: Array.isArray(compact.viewClanTags) ? compact.viewClanTags.length : 0,
		requestCounts: compact.requestCounts,
		totalMs: Math.max(0, Date.now() - taskStartMs),
	};
}

function executeAutoRefreshCwlCoordinatorTask_(currentRaw, taskRaw, executionStartMsRaw) {
	return executeAutoRefreshCwlCoordinatorCaptureTask_(currentRaw, taskRaw, executionStartMsRaw, {
		capturePhase: "early",
		source: "auto-refresh-queue-cwl-coordinator",
	});
}

function executeAutoRefreshFinalCwlCoordinatorTask_(currentRaw, taskRaw, executionStartMsRaw) {
	return executeAutoRefreshCwlCoordinatorCaptureTask_(currentRaw, taskRaw, executionStartMsRaw, {
		capturePhase: "final",
		source: "auto-refresh-queue-final-cwl-coordinator",
	});
}

function executeAutoRefreshCwlSideTaskWithBudget_(currentRaw, taskRaw, executionStartMsRaw) {
	const task = taskRaw && typeof taskRaw === "object" ? taskRaw : {};
	return runWithExecutionDeadline_(
		String(task.type || "") === "cwlFinalCoordinator" ? "auto-refresh-final-cwl-side-task" : "auto-refresh-cwl-side-task",
		AUTO_REFRESH_QUEUE_CWL_SIDE_TASK_BUDGET_MS,
		function () {
			return String(task.type || "") === "cwlFinalCoordinator"
				? executeAutoRefreshFinalCwlCoordinatorTask_(currentRaw, task, executionStartMsRaw)
				: executeAutoRefreshCwlCoordinatorTask_(currentRaw, task, executionStartMsRaw);
		},
		{
			cleanupReserveMs: AUTO_REFRESH_QUEUE_CWL_SIDE_TASK_CHECKPOINT_RESERVE_MS,
			recoveryScope: "autoRefresh",
		},
	);
}

function markAutoRefreshCwlSideTaskTerminal_(currentRaw, taskRaw) {
	const current = currentRaw && typeof currentRaw === "object" ? currentRaw : {};
	const taskType = String(taskRaw && taskRaw.type || "");
	if (taskType === "cwlCoordinator") current.cwlCoordinatorSidePhaseTerminal = true;
	if (taskType === "cwlFinalCoordinator") current.cwlFinalCoordinatorSidePhaseTerminal = true;
	return current;
}

// Execute one resumable per-roster task.
function executeAutoRefreshRosterTask_(currentRaw, taskRaw, executionStartMsRaw) {
	const current = normalizeAutoRefreshQueueCurrent_(currentRaw);
	const task = taskRaw && typeof taskRaw === "object" ? taskRaw : {};
	const runId = current && current.runId;
	const rosterId = String(task.rosterId || "").trim();
	const taskStartMs = Date.now();
	if (!runId || !rosterId) throw new Error("Auto-refresh roster task is missing runId or rosterId.");
	if (isAutoRefreshTaskResultComplete_(runId, task)) {
		checkpointAutoRefreshRosterPhase_(current, task, getAutoRefreshRosterPhaseState_(runId, task, null), "completed", {});
		Logger.log(
			"autoRefresh worker task timing runId=%s taskId=%s rosterId=%s phase=%s fetchMs=%s processMs=%s shardWriteMs=%s totalMs=%s remainingMs=%s reason=%s",
			runId,
			String(task.taskId || ""),
			rosterId,
			"completed",
			0,
			0,
			0,
			Math.max(0, Date.now() - taskStartMs),
			getAutoRefreshJobRemainingMs_(executionStartMsRaw),
			"resultExists",
		);
		return { skipped: true, reason: "resultExists", rosterId: rosterId };
	}

	const sourceVersionId = normalizeActiveVersionId_(current.sourceVersionId);
	const encodedRosterId = encodeFirebaseObjectKey_(rosterId);
	let preparedInput = readAutoRefreshPreparedRosterInput_(runId, rosterId);
	let state = getAutoRefreshRosterPhaseState_(runId, task, preparedInput);
	let sourceFetchMs = 0;
	let clanFetchMs = 0;
	let metricReadMs = 0;
	let processMs = 0;
	let shardWriteMs = 0;
	let processedSummary = null;

	const reloadInput = () => {
		preparedInput = readAutoRefreshPreparedRosterInput_(runId, rosterId);
		return preparedInput && typeof preparedInput === "object" ? preparedInput : {};
	};

	const persistInput = (patchRaw) => {
		const previous = reloadInput();
		const patch = patchRaw && typeof patchRaw === "object" ? patchRaw : {};
		preparedInput = writeAutoRefreshPreparedRosterInput_(runId, rosterId, Object.assign({}, previous, patch));
		return preparedInput;
	};

	const phaseStartedThisInvocation = {};
	const checkpointPhaseStart = (phaseRaw, optionsRaw) => {
		const phase = normalizeAutoRefreshRosterPhase_(phaseRaw);
		const options = Object.assign({}, optionsRaw || {});
		if (!phaseStartedThisInvocation[phase]) {
			options.start = true;
			phaseStartedThisInvocation[phase] = true;
		}
		return checkpointAutoRefreshRosterPhase_(current, task, state, phase, options);
	};

	while (state.phase !== "completed") {
		if (!hasAutoRefreshJobBudgetFor_(executionStartMsRaw, AUTO_REFRESH_QUEUE_ROSTER_WRITE_RESERVE_MS)) {
			return markAutoRefreshRosterPhaseDeferred_(current, task, state, "beforeRosterPhaseBudget", null, executionStartMsRaw);
		}

		if (state.phase === "source") {
			if (!hasAutoRefreshJobBudgetFor_(executionStartMsRaw, AUTO_REFRESH_QUEUE_ROSTER_WRITE_RESERVE_MS)) {
				return markAutoRefreshRosterPhaseDeferred_(current, task, state, "beforeRosterSourceRead", null, executionStartMsRaw);
			}
			checkpointPhaseStart("source", { cursor: {} });
			if (shouldFailAutoRefreshRosterPhaseAfterAttempts_(state, "source")) {
				throw new Error("Auto-refresh roster source phase exceeded retry limit for " + rosterId + ".");
			}
			scheduleAutoRefreshJobResume_();
			const phaseStartMs = Date.now();
			logAutoRefreshRosterPhase_("start", current, task, state, { reason: "source-read" });
			const sourcePaths = [
				buildAutoRefreshRunPath_(runId, "source/meta"),
			];
			let encodedSource = null;
			try {
				encodedSource = firebaseBatchGetJson_(sourcePaths, { disableFallback: true });
			} catch (err) {
				if (err && err.autoRefreshDefer) return markAutoRefreshRosterPhaseDeferred_(current, task, state, "firebase-source-read", err, executionStartMsRaw);
				throw err;
			}
			const sourceMeta = decodeFirebaseObjectKeysRecursive_(encodedSource[sourcePaths[0]]);
			sourceFetchMs += Math.max(0, Date.now() - phaseStartMs);
			if (!sourceMeta || typeof sourceMeta !== "object") throw new Error("Auto-refresh source metadata is missing for run " + runId + ".");
			persistInput({
				sourceMeta: sourceMeta,
				requestCounts: {},
			});
			logAutoRefreshRosterPhase_("done", current, task, state, {
				payloadBytes: approximateAutoRefreshPayloadSize_({ sourceMeta: sourceMeta }),
				elapsedMs: Math.max(0, Date.now() - phaseStartMs),
			});
			checkpointAutoRefreshRosterPhase_(current, task, state, "primarySnapshot", { cursor: {} });
			continue;
		}

		if (state.phase === "primarySnapshot") {
			const input = reloadInput();
			const sourceMeta = input.sourceMeta && typeof input.sourceMeta === "object" ? input.sourceMeta : null;
			if (!sourceMeta) {
				checkpointAutoRefreshRosterPhase_(current, task, state, "source", { cursor: {} });
				continue;
			}
			if (!hasAutoRefreshJobBudgetFor_(executionStartMsRaw, AUTO_REFRESH_QUEUE_ROSTER_PROCESS_RESERVE_MS)) {
				return markAutoRefreshRosterPhaseDeferred_(current, task, state, "beforePrimarySnapshotBudget", null, executionStartMsRaw);
			}
			const sourceRosterStub = buildAutoRefreshSourceRosterStubFromMeta_(sourceMeta, rosterId);
			const clanTag = normalizeTag_(sourceRosterStub.connectedClanTag);
			checkpointPhaseStart("primarySnapshot", { cursor: {} });
			if (shouldFailAutoRefreshRosterPhaseAfterAttempts_(state, "primarySnapshot")) {
				throw new Error("Auto-refresh roster primary snapshot phase exceeded retry limit for " + rosterId + ".");
			}
			scheduleAutoRefreshJobResume_();
			const phaseStartMs = Date.now();
			logAutoRefreshRosterPhase_("start", current, task, state, { requestCount: clanTag ? 2 : 0, reason: "primary-snapshot" });
			let clanSnapshot = null;
			const currentRegularWarByClanTag = {};
			const currentRegularWarErrorByClanTag = {};
			if (clanTag) {
				try {
					clanSnapshot = fetchClanMembersSnapshot_(clanTag);
				} catch (err) {
					if (isRetryableAutoRefreshExternalError_(err)) {
						return markAutoRefreshRosterPhaseDeferred_(current, task, state, "clan-members-snapshot", err, executionStartMsRaw);
					}
					throw err;
				}
				try {
					currentRegularWarByClanTag[clanTag] = fetchCurrentRegularWar_(clanTag);
				} catch (err) {
					if (isRetryableAutoRefreshExternalError_(err)) {
						return markAutoRefreshRosterPhaseDeferred_(current, task, state, "current-war-snapshot", err, executionStartMsRaw);
					}
					currentRegularWarErrorByClanTag[clanTag] = serializeAutoRefreshPhaseError_(err);
				}
			}
			if (clanTag && !clanSnapshot) {
				return markAutoRefreshRosterPhaseDeferred_(current, task, state, "missing-clan-members-snapshot", null, executionStartMsRaw);
			}
			const requestCounts = Object.assign({}, input.requestCounts || {}, {
				members: clanTag ? 1 : 0,
				currentWar: clanTag ? 1 : 0,
			});
			persistInput({
				primarySnapshotCaptured: true,
				clanSnapshot: clanSnapshot,
				currentRegularWarByClanTag: currentRegularWarByClanTag,
				currentRegularWarErrorByClanTag: currentRegularWarErrorByClanTag,
				sourceMetricByTag: input.sourceMetricByTag || {},
				sourceSeedByTag: input.sourceSeedByTag || {},
				requestCounts: requestCounts,
			});
			clanFetchMs += Math.max(0, Date.now() - phaseStartMs);
			logAutoRefreshRosterPhase_("done", current, task, state, {
				requestCount: toNonNegativeInt_(requestCounts.members) + toNonNegativeInt_(requestCounts.currentWar),
				tagCount:
					(Array.isArray(clanSnapshot && clanSnapshot.members) ? clanSnapshot.members.length : 0) +
					(Array.isArray(clanSnapshot && clanSnapshot.metricsMembers) ? clanSnapshot.metricsMembers.length : 0),
				payloadBytes: approximateAutoRefreshPayloadSize_(clanSnapshot),
				elapsedMs: Math.max(0, Date.now() - phaseStartMs),
			});
			checkpointAutoRefreshRosterPhase_(current, task, state, "warInputs", { cursor: {} });
			continue;
		}

		if (state.phase === "warInputs") {
			const input = reloadInput();
			const sourceMeta = input.sourceMeta && typeof input.sourceMeta === "object" ? input.sourceMeta : null;
			if (!sourceMeta) {
				checkpointAutoRefreshRosterPhase_(current, task, state, "source", { cursor: {} });
				continue;
			}
			if (!hasAutoRefreshJobBudgetFor_(executionStartMsRaw, AUTO_REFRESH_QUEUE_ROSTER_PROCESS_RESERVE_MS)) {
				return markAutoRefreshRosterPhaseDeferred_(current, task, state, "beforeWarInputsBudget", null, executionStartMsRaw);
			}
			let sourceRoster = isAutoRefreshFullSourceRoster_(input.sourceRoster, rosterId)
				? input.sourceRoster
				: buildAutoRefreshSourceRosterStubFromMeta_(sourceMeta, rosterId);
			const clanTag = normalizeTag_(sourceRoster.connectedClanTag);
			checkpointPhaseStart("warInputs", { cursor: {} });
			if (shouldFailAutoRefreshRosterPhaseAfterAttempts_(state, "warInputs")) {
				throw new Error("Auto-refresh roster war-input phase exceeded retry limit for " + rosterId + ".");
			}
			scheduleAutoRefreshJobResume_();
			const phaseStartMs = Date.now();
			logAutoRefreshRosterPhase_("start", current, task, state, { reason: "war-inputs" });
			let cwlCoordinatorClanView = input.cwlCoordinatorClanView && typeof input.cwlCoordinatorClanView === "object" ? input.cwlCoordinatorClanView : null;
			let cwlCoordinatorResult = input.cwlCoordinatorResult && typeof input.cwlCoordinatorResult === "object" ? input.cwlCoordinatorResult : null;
			if (clanTag && getRosterTrackingMode_(sourceRoster) === "cwl" && !cwlCoordinatorClanView && !cwlCoordinatorResult) {
				const cwlCoordinator = ensureAutoRefreshRosterCwlCoordinatorView_(current, sourceMeta, sourceRoster, clanTag, executionStartMsRaw);
				if (cwlCoordinator && cwlCoordinator.deferred) {
					return markAutoRefreshRosterPhaseDeferred_(current, task, state, cwlCoordinator.reason || "beforeRosterCwlCoordinator", null, executionStartMsRaw);
				}
				cwlCoordinatorClanView = cwlCoordinator && cwlCoordinator.view ? cwlCoordinator.view : null;
				cwlCoordinatorResult = cwlCoordinator && cwlCoordinator.coordinatorResult ? cwlCoordinator.coordinatorResult : null;
			}
			const currentRegularWarByClanTag = input.currentRegularWarByClanTag && typeof input.currentRegularWarByClanTag === "object" ? input.currentRegularWarByClanTag : {};
			const currentRegularWarErrorByClanTag = reviveAutoRefreshPhaseErrorMap_(input.currentRegularWarErrorByClanTag);
			let regularWarLogByClanTag = input.regularWarLogByClanTag && typeof input.regularWarLogByClanTag === "object" ? input.regularWarLogByClanTag : {};
			let regularWarLogErrorByClanTag = input.regularWarLogErrorByClanTag && typeof input.regularWarLogErrorByClanTag === "object" ? input.regularWarLogErrorByClanTag : {};
			let warLogRequests = 0;
			if (
				clanTag &&
				!Object.prototype.hasOwnProperty.call(regularWarLogByClanTag, clanTag) &&
				!Object.prototype.hasOwnProperty.call(regularWarLogErrorByClanTag, clanTag) &&
				(sourceRoster = isAutoRefreshFullSourceRoster_(sourceRoster, rosterId) ? sourceRoster : readAutoRefreshSourceRosterShardForTask_(runId, rosterId, sourceVersionId)) &&
				shouldPrefetchRegularWarLogForRoster_(
					sourceRoster,
					currentRegularWarByClanTag,
					currentRegularWarErrorByClanTag,
					{
						allowRegularWarHistoryRepair: false,
						allowRegularWarProvisionalFallback: false,
					},
					new Date().toISOString(),
				)
			) {
				const warLog = prefetchRegularWarLogByClanTag_([clanTag], {
					batchSize: AUTO_REFRESH_PREFETCH_BATCH_SIZE,
					batchDelayMs: AUTO_REFRESH_PREFETCH_BATCH_DELAY_MS,
				});
				warLogRequests = toNonNegativeInt_(warLog && warLog.requestCount);
				regularWarLogByClanTag = warLog && warLog.entriesByClanTag && typeof warLog.entriesByClanTag === "object" ? warLog.entriesByClanTag : {};
				const rawErrors = warLog && warLog.errorByClanTag && typeof warLog.errorByClanTag === "object" ? warLog.errorByClanTag : {};
				const errorTags = Object.keys(rawErrors);
				regularWarLogErrorByClanTag = {};
				for (let i = 0; i < errorTags.length; i++) {
					const tag = normalizeTag_(errorTags[i]);
					const err = rawErrors[errorTags[i]];
					if (!tag) continue;
					if (!isPrivateWarLogError_(err) && isRetryableAutoRefreshExternalError_(err)) {
						return markAutoRefreshRosterPhaseDeferred_(current, task, state, "regular-war-log-snapshot", err, executionStartMsRaw);
					}
					regularWarLogErrorByClanTag[tag] = serializeAutoRefreshPhaseError_(err);
				}
			}
			const requestCounts = Object.assign({}, input.requestCounts || {}, {
				regularWarLog: toNonNegativeInt_((input.requestCounts || {}).regularWarLog) + warLogRequests,
			});
			persistInput({
				cwlCoordinatorClanView: cwlCoordinatorClanView,
				cwlCoordinatorResult: cwlCoordinatorResult,
				regularWarLogByClanTag: regularWarLogByClanTag,
				regularWarLogErrorByClanTag: regularWarLogErrorByClanTag,
				requestCounts: requestCounts,
			});
			logAutoRefreshRosterPhase_("done", current, task, state, {
				requestCount: warLogRequests,
				payloadBytes: approximateAutoRefreshPayloadSize_({ cwlCoordinatorClanView: cwlCoordinatorClanView, regularWarLogByClanTag: regularWarLogByClanTag }),
				elapsedMs: Math.max(0, Date.now() - phaseStartMs),
			});
			checkpointAutoRefreshRosterPhase_(current, task, state, "metricSeedInputs", {
				cursor: { metricOffset: 0, seedOffset: 0 },
			});
			continue;
		}

		if (state.phase === "metricSeedInputs") {
			const input = reloadInput();
			let sourceRoster = isAutoRefreshFullSourceRoster_(input.sourceRoster, rosterId)
				? input.sourceRoster
				: null;
			if (!sourceRoster) {
				try {
					sourceRoster = readAutoRefreshSourceRosterShardForTask_(runId, rosterId, sourceVersionId);
				} catch (err) {
					if (err && err.autoRefreshDefer) return markAutoRefreshRosterPhaseDeferred_(current, task, state, "firebase-source-roster-read", err, executionStartMsRaw);
					throw err;
				}
			}
			if (!sourceRoster) {
				checkpointAutoRefreshRosterPhase_(current, task, state, "source", { cursor: {} });
				continue;
			}
			const cursor = state.cursor && typeof state.cursor === "object" ? state.cursor : {};
			let metricOffset = toNonNegativeInt_(cursor.metricOffset);
			let seedOffset = toNonNegativeInt_(cursor.seedOffset);
			let metricReadTags = Array.isArray(input.metricReadTags) ? input.metricReadTags.map((tag) => normalizeTag_(tag)).filter((tag) => tag) : [];
			let seedReadTags = Array.isArray(input.seedReadTags) ? input.seedReadTags.map((tag) => normalizeTag_(tag)).filter((tag) => tag) : [];
			let metricTags = Array.isArray(input.metricTags) ? input.metricTags.map((tag) => normalizeTag_(tag)).filter((tag) => tag) : [];
			let sourceMetricByTag = input.sourceMetricByTag && typeof input.sourceMetricByTag === "object" ? input.sourceMetricByTag : {};
			let sourceSeedByTag = input.sourceSeedByTag && typeof input.sourceSeedByTag === "object" ? input.sourceSeedByTag : {};
			let targetSeedByTag = input.targetSeedByTag && typeof input.targetSeedByTag === "object" ? input.targetSeedByTag : {};
			if (!Array.isArray(input.metricReadTags) || !Array.isArray(input.seedReadTags) || !Object.keys(targetSeedByTag).length) {
				const plan = collectAutoRefreshRosterInputReadPlan_(sourceRoster, input.clanSnapshot);
				metricTags = plan.metricTags;
				metricReadTags = plan.metricReadTags;
				seedReadTags = plan.seedReadTags;
				targetSeedByTag = plan.targetSeedByTag;
				persistInput({
					primarySnapshotCaptured: true,
					snapshotPlanBuilt: true,
					metricTags: metricTags,
					metricReadTags: metricReadTags,
					seedReadTags: seedReadTags,
					targetSeedByTag: targetSeedByTag,
				});
			}
			const targetSeedTags = Object.keys(targetSeedByTag);
			checkpointPhaseStart("metricSeedInputs", { cursor: { metricOffset: metricOffset, seedOffset: seedOffset } });
			if (shouldFailAutoRefreshRosterPhaseAfterAttempts_(state, "metricSeedInputs")) {
				throw new Error("Auto-refresh roster metric/seed input phase exceeded retry limit for " + rosterId + ".");
			}
			const phaseStartMs = Date.now();
			let chunkTagCount = 0;
			let reason = "";
			if (metricOffset < metricReadTags.length) {
				if (!hasAutoRefreshJobBudgetFor_(executionStartMsRaw, AUTO_REFRESH_QUEUE_ROSTER_PROCESS_RESERVE_MS)) {
					return markAutoRefreshRosterPhaseDeferred_(current, task, state, "beforeMetricInputChunk", null, executionStartMsRaw);
				}
				const chunk = metricReadTags.slice(metricOffset, metricOffset + AUTO_REFRESH_ROSTER_INPUT_READ_CHUNK_TAG_LIMIT);
				chunkTagCount = chunk.length;
				reason = "metric-inputs";
				scheduleAutoRefreshJobResume_();
				logAutoRefreshRosterPhase_("start", current, task, state, { tagCount: chunk.length, reason: reason });
				let chunkEntries = null;
				try {
					chunkEntries = readAutoRefreshSourceMetricEntriesForTags_(runId, chunk, sourceVersionId, { disableFirebaseFallback: true });
				} catch (err) {
					if (err && err.autoRefreshDefer) return markAutoRefreshRosterPhaseDeferred_(current, task, state, "firebase-metric-inputs", err, executionStartMsRaw);
					throw err;
				}
				sourceMetricByTag = Object.assign({}, sourceMetricByTag, chunkEntries);
				metricOffset += chunk.length;
			} else if (seedOffset < seedReadTags.length) {
				if (!hasAutoRefreshJobBudgetFor_(executionStartMsRaw, AUTO_REFRESH_QUEUE_ROSTER_PROCESS_RESERVE_MS)) {
					return markAutoRefreshRosterPhaseDeferred_(current, task, state, "beforeSeedInputChunk", null, executionStartMsRaw);
				}
				const chunk = seedReadTags.slice(seedOffset, seedOffset + AUTO_REFRESH_ROSTER_INPUT_READ_CHUNK_TAG_LIMIT);
				chunkTagCount = chunk.length;
				reason = "seed-inputs";
				scheduleAutoRefreshJobResume_();
				logAutoRefreshRosterPhase_("start", current, task, state, { tagCount: chunk.length, reason: reason });
				let chunkEntries = null;
				try {
					chunkEntries = readAutoRefreshSourcePlayerSeedEntriesForTags_(runId, chunk, { disableFirebaseFallback: true });
				} catch (err) {
					if (err && err.autoRefreshDefer) return markAutoRefreshRosterPhaseDeferred_(current, task, state, "firebase-seed-inputs", err, executionStartMsRaw);
					throw err;
				}
				sourceSeedByTag = Object.assign({}, sourceSeedByTag, chunkEntries);
				seedOffset += chunk.length;
			}
			for (let i = 0; i < targetSeedTags.length; i++) {
				const tag = normalizeTag_(targetSeedTags[i]);
				if (tag && !sourceSeedByTag[tag]) sourceSeedByTag[tag] = targetSeedByTag[targetSeedTags[i]];
			}
			persistInput({
				primarySnapshotCaptured: true,
				snapshotPlanBuilt: true,
				metricTags: metricTags,
				metricReadTags: metricReadTags,
				seedReadTags: seedReadTags,
				sourceMetricByTag: sourceMetricByTag,
				sourceSeedByTag: sourceSeedByTag,
				targetSeedByTag: targetSeedByTag,
			});
			metricReadMs += Math.max(0, Date.now() - phaseStartMs);
			const nextCursor = { metricOffset: metricOffset, seedOffset: seedOffset };
			logAutoRefreshRosterPhase_("done", current, task, state, {
				tagCount: chunkTagCount,
				payloadBytes: approximateAutoRefreshPayloadSize_({ sourceMetricByTag: sourceMetricByTag, sourceSeedByTag: sourceSeedByTag }),
				elapsedMs: Math.max(0, Date.now() - phaseStartMs),
				reason: reason || "input-read-complete",
			});
			if (metricOffset < metricReadTags.length || seedOffset < seedReadTags.length) {
				checkpointAutoRefreshRosterPhase_(current, task, state, "metricSeedInputs", { cursor: nextCursor });
				if (!hasAutoRefreshJobBudgetFor_(executionStartMsRaw, AUTO_REFRESH_QUEUE_ROSTER_PROCESS_RESERVE_MS)) {
					return markAutoRefreshRosterPhaseDeferred_(current, task, state, "afterInputChunkBudget", null, executionStartMsRaw);
				}
				continue;
			}
			checkpointAutoRefreshRosterPhase_(current, task, state, "processSnapshot", { cursor: nextCursor });
			continue;
		}

		if (state.phase === "processSnapshot") {
			const input = reloadInput();
			const sourceMeta = input.sourceMeta && typeof input.sourceMeta === "object" ? input.sourceMeta : null;
			let sourceRoster = isAutoRefreshFullSourceRoster_(input.sourceRoster, rosterId)
				? input.sourceRoster
				: null;
			if (!sourceMeta || !sourceRoster) {
				if (!sourceMeta) {
					checkpointAutoRefreshRosterPhase_(current, task, state, "source", { cursor: {} });
					continue;
				}
				try {
					sourceRoster = readAutoRefreshSourceRosterShardForTask_(runId, rosterId, sourceVersionId);
				} catch (err) {
					if (err && err.autoRefreshDefer) return markAutoRefreshRosterPhaseDeferred_(current, task, state, "firebase-source-roster-read", err, executionStartMsRaw);
					throw err;
				}
			}
			if (!hasAutoRefreshJobBudgetFor_(executionStartMsRaw, AUTO_REFRESH_QUEUE_ROSTER_PROCESS_RESERVE_MS)) {
				return markAutoRefreshRosterPhaseDeferred_(current, task, state, "beforeRosterProcess", null, executionStartMsRaw);
			}
			checkpointPhaseStart("processSnapshot", {});
			if (shouldFailAutoRefreshRosterPhaseAfterAttempts_(state, "processSnapshot")) {
				throw new Error("Auto-refresh roster processing phase exceeded retry limit for " + rosterId + ".");
			}
			scheduleAutoRefreshJobResume_();
			const processStartMs = Date.now();
			const clanTag = normalizeTag_(sourceRoster.connectedClanTag);
			logAutoRefreshRosterPhase_("start", current, task, state, {
				tagCount: Object.keys(input.sourceMetricByTag || {}).length,
				reason: "snapshot-process",
			});
			const workingRosterData = buildAutoRefreshRosterWorkingData_(sourceMeta, sourceRoster, input.sourceMetricByTag || {});
			const prefetchedClanSnapshotsByTag = {};
			if (clanTag && input.clanSnapshot) prefetchedClanSnapshotsByTag[clanTag] = input.clanSnapshot;
			const ownershipSnapshot = buildAutoRefreshRosterOwnershipSnapshot_(
				sourceMeta,
				sourceRoster,
				rosterId,
				input.clanSnapshot,
				input.sourceSeedByTag || {},
				input.sourceOwnership && typeof input.sourceOwnership === "object" && Object.keys(input.sourceOwnership).length
					? input.sourceOwnership
					: readAutoRefreshSourceOwnershipShardForTask_(runId),
			);
			const accumulator = createRefreshAllAccumulator_();
			const pipelineOptions = {
				ownershipSnapshot: ownershipSnapshot,
				skipInitialValidation: true,
				metricsRunState: { seenClanTags: {}, metricsStorePrepared: true },
				allowRegularWarHistoryRepair: false,
				allowRegularWarProvisionalFallback: false,
				statsOnlyRegularWarFinalization: false,
				autoRefreshFinalValidationMode: true,
				autoRefreshSnapshotMode: true,
				prefetchedClanSnapshotsByTag: prefetchedClanSnapshotsByTag,
				prefetchedClanErrorsByTag: {},
				prefetchedCurrentRegularWarByClanTag: input.currentRegularWarByClanTag || {},
				prefetchedRegularWarErrorByClanTag: reviveAutoRefreshPhaseErrorMap_(input.currentRegularWarErrorByClanTag),
				prefetchedRegularWarLogByClanTag: input.regularWarLogByClanTag || {},
				prefetchedRegularWarLogErrorByClanTag: reviveAutoRefreshPhaseErrorMap_(input.regularWarLogErrorByClanTag),
				cwlCoordinatorClanView: input.cwlCoordinatorClanView || null,
			};
			if (input.cwlCoordinatorResult) pipelineOptions.cwlCoordinatorResult = input.cwlCoordinatorResult;
			const guarded = withAutoRefreshQueueLiveFetchGuard_(() =>
				processRefreshAllRosterPipelineIntoAccumulator_(workingRosterData, rosterId, pipelineOptions, accumulator),
			);
			processMs += Math.max(0, Date.now() - processStartMs);
			if (guarded.guard && guarded.guard.attempted) {
				return markAutoRefreshRosterPhaseDeferred_(current, task, state, "forbidden-live-fetch", new Error("Roster processing attempted forbidden live fetch: " + guarded.guard.labels.join(",")), executionStartMsRaw);
			}
			if (guarded.error) {
				if (guarded.error.autoRefreshSnapshotMiss) {
					return markAutoRefreshRosterPhaseDeferred_(current, task, state, "snapshot-miss", guarded.error, executionStartMsRaw);
				}
				throw guarded.error;
			}
			const processed = guarded.result;
			const pipelineIssues = Array.isArray(accumulator.issues) ? accumulator.issues : [];
			if (hasAutoRefreshSnapshotMissIssue_(pipelineIssues)) {
				return markAutoRefreshRosterPhaseDeferred_(current, task, state, "snapshot-miss", new Error(buildAutoRefreshIssueSummary_(pipelineIssues) || "Auto-refresh snapshot missing required input."), executionStartMsRaw);
			}
			const validatedProcessedRosterData = validateRosterData_(processed.rosterData);
			const metricTags = Array.isArray(input.metricTags) ? input.metricTags : [];
			const metricResult = buildRosterMetricResult_(validatedProcessedRosterData, metricTags, processed.pipelineResult && processed.pipelineResult.memberTracking);
			const warResult = buildRosterWarResult_(validatedProcessedRosterData, rosterId, processed.pipelineResult, accumulator, {
				sourceFetchMs: sourceFetchMs,
				clanFetchMs: clanFetchMs,
				metricReadMs: metricReadMs,
				processMs: processMs,
			});
			const activeRoster = findRosterInDataById_(validatedProcessedRosterData, rosterId);
			if (!activeRoster) throw new Error("Active roster shard missing after pipeline: " + rosterId + ".");
			const processOutput = {
				rosterId: rosterId,
				activeRoster: activeRoster,
				metricResult: metricResult,
				warResult: warResult,
				issueCount: pipelineIssues.length,
				issueSummary: buildAutoRefreshIssueSummary_(pipelineIssues),
				timings: {
					sourceFetchMs: sourceFetchMs,
					clanFetchMs: clanFetchMs,
					metricReadMs: metricReadMs,
					processMs: processMs,
				},
				writtenAt: new Date().toISOString(),
			};
			writeAutoRefreshRunShard_(runId, "rosterProcessResults/" + encodedRosterId, processOutput, "PUT");
			processedSummary = {
				issueCount: processOutput.issueCount,
				issueSummary: processOutput.issueSummary,
			};
			logAutoRefreshRosterPhase_("done", current, task, state, {
				tagCount: Object.keys(metricResult.byTag || {}).length,
				payloadBytes: approximateAutoRefreshPayloadSize_(processOutput),
				elapsedMs: Math.max(0, Date.now() - processStartMs),
				forbiddenLiveFetch: false,
			});
			checkpointAutoRefreshRosterPhase_(current, task, state, "commit", {});
			continue;
		}

		if (state.phase === "commit") {
			if (!hasAutoRefreshJobBudgetFor_(executionStartMsRaw, AUTO_REFRESH_QUEUE_ROSTER_WRITE_RESERVE_MS)) {
				return markAutoRefreshRosterPhaseDeferred_(current, task, state, "beforeRosterCommit", null, executionStartMsRaw);
			}
			checkpointPhaseStart("commit", {});
			if (shouldFailAutoRefreshRosterPhaseAfterAttempts_(state, "commit")) {
				throw new Error("Auto-refresh roster commit phase exceeded retry limit for " + rosterId + ".");
			}
			scheduleAutoRefreshJobResume_();
			const commitStartMs = Date.now();
			const processOutput = readAutoRefreshRunShard_(runId, "rosterProcessResults/" + encodedRosterId);
			if (!processOutput || typeof processOutput !== "object") {
				checkpointAutoRefreshRosterPhase_(current, task, state, "processSnapshot", {});
				continue;
			}
			logAutoRefreshRosterPhase_("start", current, task, state, {
				tagCount: Object.keys((processOutput.metricResult && processOutput.metricResult.byTag) || {}).length,
				payloadBytes: approximateAutoRefreshPayloadSize_(processOutput),
				reason: "commit",
			});
			const activeRoster = processOutput.activeRoster && typeof processOutput.activeRoster === "object" ? processOutput.activeRoster : null;
			if (!activeRoster) throw new Error("Processed roster output is missing for " + rosterId + ".");
			const writtenAt = new Date().toISOString();
			const stagedMetricWrites = buildActiveVersionPlayerMetricEntryWrites_(runId, processOutput.metricResult, writtenAt);
			const rosterWrites = [
				{
					path: buildActiveVersionPath_(runId, "rosters/" + encodedRosterId),
					method: "PUT",
					payload: encodeFirebaseObjectKeysRecursive_(activeRoster),
				},
				{
					path: buildAutoRefreshRunPath_(runId, "rosterWrites/" + encodedRosterId),
					method: "PUT",
					payload: encodeFirebaseObjectKeysRecursive_({
						rosterId: rosterId,
						versionId: runId,
						path: buildActiveVersionPath_(runId, "rosters/" + encodedRosterId),
						playerTags: collectAutoRefreshRosterPlayerTags_(activeRoster),
						writtenAt: writtenAt,
					}),
				},
				{
					path: buildAutoRefreshRunPath_(runId, "warResults/" + encodedRosterId),
					method: "PUT",
					payload: encodeFirebaseObjectKeysRecursive_(processOutput.warResult),
				},
			];
			for (let i = 0; i < stagedMetricWrites.writes.length; i++) rosterWrites.push(stagedMetricWrites.writes[i]);
			rosterWrites.push({
				path: buildAutoRefreshRunPath_(runId, "metricResults/" + encodedRosterId),
				method: "PUT",
				payload: encodeFirebaseObjectKeysRecursive_(buildRosterMetricResultSummary_(processOutput.metricResult, stagedMetricWrites, writtenAt)),
			});
			try {
				firebaseBatchPutJson_(rosterWrites, { disableFallback: true });
			} catch (err) {
				if (err && err.autoRefreshDefer) return markAutoRefreshRosterPhaseDeferred_(current, task, state, "firebase-roster-commit", err, executionStartMsRaw);
				throw err;
			}
			shardWriteMs += Math.max(0, Date.now() - commitStartMs);
			processedSummary = {
				issueCount: toNonNegativeInt_(processOutput.issueCount),
				issueSummary: String(processOutput.issueSummary || ""),
				metricTags: stagedMetricWrites.entryCount,
			};
			logAutoRefreshRosterPhase_("done", current, task, state, {
				tagCount: stagedMetricWrites.entryCount,
				payloadBytes: approximateAutoRefreshPayloadSize_(rosterWrites),
				elapsedMs: Math.max(0, Date.now() - commitStartMs),
			});
			checkpointAutoRefreshRosterPhase_(current, task, state, "completed", {});
			continue;
		}

		throw new Error("Unknown auto-refresh roster phase: " + state.phase + ".");
	}

	const totalMs = Math.max(0, Date.now() - taskStartMs);
	Logger.log(
		"autoRefresh worker task timing runId=%s taskId=%s rosterId=%s phase=%s fetchMs=%s clanFetchMs=%s metricReadMs=%s processMs=%s shardWriteMs=%s totalMs=%s remainingMs=%s",
		runId,
		String(task.taskId || ""),
		rosterId,
		"completed",
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
		issueCount: toNonNegativeInt_(processedSummary && processedSummary.issueCount),
		issueSummary: String((processedSummary && processedSummary.issueSummary) || ""),
		metricTags: toNonNegativeInt_(processedSummary && processedSummary.metricTags),
		totalMs: totalMs,
	};
}

// Read the source metrics store for a run, using the immutable source active
// version when available and the copied run source for legacy/no-version runs.
function readAutoRefreshSourcePlayerMetricsStore_(runIdRaw, sourceVersionIdRaw) {
	const sourceVersionId = normalizeActiveVersionId_(sourceVersionIdRaw);
	const encoded = sourceVersionId
		? firebaseRequestJson_(buildActiveVersionPath_(sourceVersionId, "playerMetrics"), "GET")
		: firebaseRequestJson_(buildAutoRefreshRunPath_(runIdRaw, "source/playerMetrics"), "GET");
	return encoded && typeof encoded === "object" && !Array.isArray(encoded)
		? decodeFirebaseObjectKeysRecursive_(encoded)
		: createEmptyPlayerMetricsStore_();
}

// Read per-roster metric result shards in one Firebase round-trip.
function readAutoRefreshMetricResultsByRosterId_(runIdRaw, rosterIdsRaw) {
	const rosterIds = Array.isArray(rosterIdsRaw) ? rosterIdsRaw : [];
	const paths = [];
	const rosterIdByPath = {};
	for (let i = 0; i < rosterIds.length; i++) {
		const rosterId = String(rosterIds[i] == null ? "" : rosterIds[i]).trim();
		if (!rosterId) continue;
		const path = buildAutoRefreshRunPath_(runIdRaw, "metricResults/" + encodeFirebaseObjectKey_(rosterId));
		paths.push(path);
		rosterIdByPath[path] = rosterId;
	}
	const encodedByPath = firebaseBatchGetJson_(paths, { disableFallback: true });
	const out = {};
	for (let i = 0; i < paths.length; i++) {
		const path = paths[i];
		const rosterId = rosterIdByPath[path];
		const decoded = decodeFirebaseObjectKeysRecursive_(encodedByPath[path]);
		if (rosterId && decoded && typeof decoded === "object") out[rosterId] = decoded;
	}
	return out;
}

// Merge source metrics with all per-roster metric result shards.
function buildAutoRefreshFinalPlayerMetrics_(runIdRaw, rosterIdsRaw, nowIsoRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const sourceMetrics = options.sourceMetrics && typeof options.sourceMetrics === "object"
		? options.sourceMetrics
		: readAutoRefreshSourcePlayerMetricsStore_(runIdRaw, options.sourceVersionId);
	const merged = sanitizePlayerMetricsStore_(sourceMetrics, nowIsoRaw);
	const byTag = merged.byTag && typeof merged.byTag === "object" ? merged.byTag : {};
	const rosterIds = Array.isArray(rosterIdsRaw) ? rosterIdsRaw : [];
	const metricResultByRosterId = options.metricResultByRosterId && typeof options.metricResultByRosterId === "object"
		? options.metricResultByRosterId
		: readAutoRefreshMetricResultsByRosterId_(runIdRaw, rosterIds);
	for (let i = 0; i < rosterIds.length; i++) {
		const rosterId = String(rosterIds[i] == null ? "" : rosterIds[i]).trim();
		if (!rosterId) continue;
		const result = metricResultByRosterId[rosterId];
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
function buildAutoRefreshFinalRosterDataFromShards_(runIdRaw, rosterIdsRaw, lastUpdatedAtRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const sourceMeta = options.sourceMeta && typeof options.sourceMeta === "object"
		? options.sourceMeta
		: readAutoRefreshRunShard_(runIdRaw, "source/meta");
	if (!sourceMeta) throw new Error("Auto-refresh source metadata is missing.");
	const rosterIds = Array.isArray(rosterIdsRaw) ? rosterIdsRaw : [];
	const activeRosterById = options.activeRosterById && typeof options.activeRosterById === "object" ? options.activeRosterById : null;
	let encodedRosterByPath = null;
	const rosterPathById = {};
	if (!activeRosterById) {
		const rosterPaths = [];
		for (let i = 0; i < rosterIds.length; i++) {
			const rosterId = String(rosterIds[i] == null ? "" : rosterIds[i]).trim();
			if (!rosterId) continue;
			const path = buildActiveVersionPath_(runIdRaw, "rosters/" + encodeFirebaseObjectKey_(rosterId));
			rosterPathById[rosterId] = path;
			rosterPaths.push(path);
		}
		encodedRosterByPath = firebaseBatchGetJson_(rosterPaths, { disableFallback: true });
	}
	const rosters = [];
	for (let i = 0; i < rosterIds.length; i++) {
		const rosterId = String(rosterIds[i] == null ? "" : rosterIds[i]).trim();
		if (!rosterId) continue;
		const encodedRoster = encodedRosterByPath ? encodedRosterByPath[rosterPathById[rosterId]] : null;
		const roster = activeRosterById
			? activeRosterById[rosterId]
			: encodedRoster && typeof encodedRoster === "object" && !Array.isArray(encodedRoster)
				? decodeFirebaseObjectKeysRecursive_(encodedRoster)
				: null;
		if (!roster) throw new Error("Missing completed roster result shard: " + rosterId + ".");
		rosters.push(roster);
	}
	const lastUpdatedAt = String(lastUpdatedAtRaw || new Date().toISOString());
	const sourceVersionId = normalizeActiveVersionId_(options.sourceVersionId || sourceMeta.sourceVersionId);
	const payload = {
		schemaVersion: typeof sourceMeta.schemaVersion === "number" && isFinite(sourceMeta.schemaVersion) ? sourceMeta.schemaVersion : 1,
		pageTitle: typeof sourceMeta.pageTitle === "string" ? sourceMeta.pageTitle : "",
		rosterOrder: Array.isArray(sourceMeta.rosterOrder) ? sourceMeta.rosterOrder : rosterIds,
		rosters: rosters,
		playerMetrics: buildAutoRefreshFinalPlayerMetrics_(runIdRaw, rosterIds, lastUpdatedAt, {
			metricResultByRosterId: options.metricResultByRosterId,
			sourceMetrics: options.sourceMetrics,
			sourceVersionId: sourceVersionId,
		}),
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
		sourceVersionId: current.sourceVersionId,
		sourceLastUpdatedAt: current.sourceLastUpdatedAt,
		rosterIds: current.rosterIds,
		taskCount: current.taskCount,
		processedTasks: current.processedTasks,
		processedRosters: current.processedRosters,
		issueCount: current.issueCount,
		issueSummary: current.issueSummary,
		summary: String(summaryRaw || ""),
	};
	if (current.cwlSeasonEventRefresh && typeof current.cwlSeasonEventRefresh === "object") {
		summary.cwlSeasonEventRefresh = current.cwlSeasonEventRefresh;
	}
	if (current.cwlFinalCoordinatorCapture && typeof current.cwlFinalCoordinatorCapture === "object") {
		summary.cwlFinalCoordinatorCapture = current.cwlFinalCoordinatorCapture;
	}
	if (current.cwlFinalOutcome && typeof current.cwlFinalOutcome === "object") {
		summary.cwlFinalOutcome = current.cwlFinalOutcome;
	}
	if (current.cloudflarePublicDataPublish && typeof current.cloudflarePublicDataPublish === "object") {
		summary.cloudflarePublicDataPublish = current.cloudflarePublicDataPublish;
	}
	firebaseRequestJson_(FIREBASE_INTERNAL_AUTO_REFRESH_LAST_JOB_PATH, "PUT", encodeFirebaseObjectKeysRecursive_(summary));
	return summary;
}

// Delete terminal queue run storage. The published active version is preserved;
// failed/stale staging versions are removed even if no published pointer exists.
function cleanupTerminalAutoRefreshQueueRunStorageBestEffort_(currentRaw, labelRaw) {
	const current = normalizeAutoRefreshQueueCurrent_(currentRaw);
	const label = String(labelRaw == null ? "auto-refresh queue terminal cleanup" : labelRaw).trim() || "auto-refresh queue terminal cleanup";
	const runId = normalizeActiveVersionId_(current && current.runId);
	if (!runId) return { deletedRunShard: false, deletedStagingVersion: false };
	let deletedRunShard = false;
	let deletedStagingVersion = false;
	try {
		firebaseRequestJson_(buildAutoRefreshRunPath_(runId, ""), "DELETE");
		deletedRunShard = true;
	} catch (err) {
		Logger.log("%s: unable to delete run shard %s: %s", label, runId, errorMessage_(err));
	}
	try {
		if (readPublishedActiveVersionId_() !== runId) {
			firebaseRequestJson_(buildActiveVersionPath_(runId, ""), "DELETE");
			deletedStagingVersion = true;
		}
	} catch (err) {
		Logger.log("%s: unable to delete staging active version %s: %s", label, runId, errorMessage_(err));
	}
	return { deletedRunShard: deletedRunShard, deletedStagingVersion: deletedStagingVersion };
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
	let ownsCurrent = false;
	try {
		const latest = readAutoRefreshQueueCurrent_();
		ownsCurrent = !!(
			current &&
			current.runId &&
			latest &&
			latest.kind === "auto-refresh-queue" &&
			latest.runId === current.runId
		);
		if (ownsCurrent) clearAutoRefreshQueueCurrent_();
		else Logger.log("%s: skipped current queue cleanup because run ownership changed runId=%s currentRunId=%s", label, current && current.runId, latest && latest.runId);
	} catch (err) {
		Logger.log("%s: unable to clear queue current state: %s", label, errorMessage_(err));
	}
	if (ownsCurrent) {
		try {
			removeAutoRefreshJobResumeTriggers_();
		} catch (err) {
			Logger.log("%s: unable to remove worker triggers: %s", label, errorMessage_(err));
		}
	}
	cleanupTerminalAutoRefreshQueueRunStorageBestEffort_(current, label);
	try {
		cleanupFirebaseStorageRetentionBestEffort_(label + " storage retention", {
			reason: label,
		});
	} catch (err) {
		Logger.log("%s: unable to run storage retention cleanup: %s", label, errorMessage_(err));
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
			let cwlSeasonEventRefresh = { ok: true, status: "not-needed" };
			let cwlSeasonEventCloudflarePublish = { ok: true, skipped: true, reason: "cwl-refresh-not-attempted" };
			try {
				const need = typeof getCurrentCwlSeasonEventRefreshNeed_ === "function" ? getCurrentCwlSeasonEventRefreshNeed_() : { needsCwl: false };
				if (need && need.needsCwl === true && typeof buildCwlCoordinatorResult_ === "function" && typeof tryRefreshCurrentCwlSeasonEventFromSnapshot_ === "function") {
					const sourceSnapshot = readAutoRefreshCoordinatorSourceSnapshot_();
					const rosterData = validateRosterData_(sourceSnapshot && sourceSnapshot.rosterData);
					const coordinator = buildCwlCoordinatorResult_(rosterData, {
						nowIso: new Date().toISOString(),
						source: "auto-refresh-cooldown-cwl",
					});
					cwlSeasonEventRefresh = tryRefreshCurrentCwlSeasonEventFromSnapshot_(rosterData, { cwlCoordinator: coordinator }, {
						source: "auto-refresh-cooldown",
					});
					if (cwlSeasonEventRefresh && typeof cwlSeasonEventRefresh === "object") {
						cwlSeasonEventRefresh.requestCounts = coordinator.requestCounts || {};
					}
					cwlSeasonEventCloudflarePublish = cwlSeasonEventRefresh && cwlSeasonEventRefresh.cloudflarePublish
						? cwlSeasonEventRefresh.cloudflarePublish
						: publishCloudflareSeasonEventsAfterAutoRefreshCwlBestEffort_(cwlSeasonEventRefresh, "auto-refresh-cooldown-cwl");
				}
			} catch (err) {
				Logger.log("Auto-refresh cooldown CWL event update failed: %s", errorMessage_(err));
				cwlSeasonEventRefresh = { ok: false, status: "error", error: errorMessage_(err) };
				cwlSeasonEventCloudflarePublish = { ok: true, skipped: true, reason: "cwl-refresh-failed" };
			}
			let summary = "Auto-refresh skipped: active data was written recently" + sourceSuffix + " (" + (lastWriteAt || "unknown") + ").";
			const cleanupResult = maybeCleanupOldAutoRefreshDailyArchives_(getServerDateString_(new Date()));
			const cleanupDeleted = toNonNegativeInt_(cleanupResult && cleanupResult.deletedCount);
			if (cleanupDeleted > 0) summary += " Cleaned " + cleanupDeleted + " stale daily archive(s).";
			setAutoRefreshRunResult_("skipped", summary, "", 0, "", startedAt, new Date().toISOString());
			tryReconcileRegularWarFinalizationTriggerState_();
			return {
				ok: true,
				status: "skipped",
				skipped: true,
				reason: "cooldown",
				lastWriteAt: lastWriteAt,
				cwlSeasonEventRefresh: cwlSeasonEventRefresh,
				cwlSeasonEventCloudflarePublish: cwlSeasonEventCloudflarePublish,
			};
		}
		const sourceReadStartMs = Date.now();
		const sourceSnapshot = readAutoRefreshCoordinatorSourceSnapshot_();
		const rosterData = validateRosterData_(sourceSnapshot && sourceSnapshot.rosterData);
		const sourceVersionId = normalizeActiveVersionId_(sourceSnapshot && sourceSnapshot.versionId);
		const sourceReadMs = Math.max(0, Date.now() - sourceReadStartMs);
		if (!hasAutoRefreshJobBudgetFor_(executionStartMs, AUTO_REFRESH_QUEUE_WORKER_START_RESERVE_MS)) {
			return deferFreshAutoRefreshStartForBudget_("sourceReadTooSlowBeforeQueueCreate", startedAt, executionStartMs, AUTO_REFRESH_QUEUE_WORKER_START_RESERVE_MS);
		}
		const fingerprintStartMs = Date.now();
		const sourceFingerprint = sourceVersionId && sourceSnapshot && sourceSnapshot.sourceFingerprint
			? String(sourceSnapshot.sourceFingerprint || "")
			: buildActiveRosterSourceFingerprintValidated_(rosterData);
		const fingerprintMs = Math.max(0, Date.now() - fingerprintStartMs);
		const runPlan = buildRefreshAllRosterRunPlan_(rosterData, {
			allowRegularWarHistoryRepair: false,
			allowRegularWarProvisionalFallback: false,
		});
		let metricCopyKeys = [];
		let metricKeyReadMs = 0;
		if (sourceVersionId && !(sourceSnapshot && sourceSnapshot.sourceMetricsLoaded === true)) {
			const metricKeyReadStartMs = Date.now();
			metricCopyKeys = listAutoRefreshSourceMetricKeys_(sourceVersionId);
			metricKeyReadMs = Math.max(0, Date.now() - metricKeyReadStartMs);
			if (!hasAutoRefreshJobBudgetFor_(executionStartMs, AUTO_REFRESH_QUEUE_WORKER_START_RESERVE_MS)) {
				return deferFreshAutoRefreshStartForBudget_("sourceMetricKeysTooSlowBeforeQueueCreate", startedAt, executionStartMs, AUTO_REFRESH_QUEUE_WORKER_START_RESERVE_MS);
			}
		}
		runPlan.metricCopyKeyCount = metricCopyKeys.length;
		const ownershipStartMs = Date.now();
		const sourceOwnershipIndex = collectAutoRefreshSourceOwnershipIndex_(rosterData);
		const ownershipMs = Math.max(0, Date.now() - ownershipStartMs);
		if (!hasAutoRefreshJobBudgetFor_(executionStartMs, AUTO_REFRESH_QUEUE_WORKER_START_RESERVE_MS)) {
			return deferFreshAutoRefreshStartForBudget_("sourceOwnershipTooSlowBeforeQueueCreate", startedAt, executionStartMs, AUTO_REFRESH_QUEUE_WORKER_START_RESERVE_MS);
		}
		const runId = createActiveVersionId_("auto-refresh");
		const shardWriteStartMs = Date.now();
		let sourceMeta = null;
		try {
			sourceMeta = writeAutoRefreshRunSourceShards_(runId, rosterData, sourceFingerprint, runPlan, sourceOwnershipIndex, sourceVersionId);
		} catch (err) {
			if (err && err.autoRefreshDefer) {
				return deferFreshAutoRefreshStartForBudget_("firebaseSourceShardWrite", startedAt, executionStartMs, AUTO_REFRESH_QUEUE_WORKER_START_RESERVE_MS);
			}
			throw err;
		}
		const tasks = buildAutoRefreshQueueTasks_(runId, runPlan.rosterIds, { metricCopyKeys: metricCopyKeys });
		const taskIds = writeAutoRefreshQueueTasks_(runId, tasks);
		const current = writeAutoRefreshQueueCurrent_({
			runId: runId,
			kind: "auto-refresh-queue",
			status: "running",
			phase: "queued",
			startedAt: startedAt,
			updatedAt: startedAt,
			sourceFingerprint: sourceFingerprint,
			sourceVersionId: sourceVersionId,
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
			"autoRefresh coordinator queued runId=%s rosters=%s tasks=%s metricKeys=%s sourceReadMs=%s fingerprintMs=%s metricKeyReadMs=%s ownershipMs=%s shardWriteMs=%s totalMs=%s remainingMs=%s sourceFingerprint=%s",
			runId,
			runPlan.rosterIds.length,
			taskIds.length,
			metricCopyKeys.length,
			sourceReadMs,
			fingerprintMs,
			metricKeyReadMs,
			ownershipMs,
			shardWriteMs,
			getAutoRefreshJobElapsedMs_(executionStartMs),
			getAutoRefreshJobRemainingMs_(executionStartMs),
			String(sourceMeta.sourceFingerprint || "").slice(0, 12),
		);
		return { ok: true, status: "inProgress", inProgress: true, runId: runId, processedRosters: 0, totalRosters: runPlan.rosterIds.length, taskCount: taskIds.length };
	});
}

// Hydrate rollout-safe side-phase state from the at-most-two prior CWL tasks.
// Older workers already persisted sidePhaseTerminal on the task itself but did
// not have the corresponding tiny-current fields.
function hydrateAutoRefreshCwlSideTerminalStateFromPriorTasks_(currentRaw) {
	const current = normalizeAutoRefreshQueueCurrent_(currentRaw);
	if (!current || current.currentTaskIndex < 1) return current;
	const limit = Math.min(current.currentTaskIndex, current.taskIds.length);
	for (let i = 0; i < limit; i++) {
		const taskId = String(current.taskIds[i] || "");
		const isEarlyCandidate = taskId.indexOf("cwlCoordinator") >= 0;
		const isFinalCandidate = taskId.indexOf("cwlFinalCoordinator") >= 0;
		if ((!isEarlyCandidate || current.cwlCoordinatorSidePhaseTerminal === true) &&
			(!isFinalCandidate || current.cwlFinalCoordinatorSidePhaseTerminal === true)) continue;
		const task = readAutoRefreshTask_(current.runId, taskId);
		if (task && String(task.status || "") === "completed" && task.sidePhaseTerminal === true) {
			markAutoRefreshCwlSideTaskTerminal_(current, task);
		}
	}
	return current;
}

// Find the next runnable queue task.
function findNextAutoRefreshQueueTask_(currentRaw) {
	const current = hydrateAutoRefreshCwlSideTerminalStateFromPriorTasks_(currentRaw);
	if (!current) return null;
	const taskIds = current.taskIds;
	for (let i = Math.max(0, current.currentTaskIndex); i < taskIds.length; i++) {
		const task = readAutoRefreshTask_(current.runId, taskIds[i]);
		if (!task) continue;
		const status = String(task.status || "pending");
		if (status === "completed" && isAutoRefreshTaskResultComplete_(current.runId, task)) {
			// The task checkpoint is durable before the tiny current-state checkpoint.
			// Reconstruct side-phase terminality here so interruption between those two
			// writes cannot make a later roster/finalize preflight rerun CWL work.
			if (task.sidePhaseTerminal === true) markAutoRefreshCwlSideTaskTerminal_(current, task);
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

// Verify completed result markers for finalization. Staged-metrics runs verify
// small roster write markers instead of downloading the active roster payloads.
function verifyAutoRefreshFinalizeResultMarkers_(runIdRaw, rosterIdsRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const rosterIds = Array.isArray(rosterIdsRaw) ? rosterIdsRaw : [];
	const includeActiveRosters = options.includeActiveRosters === true;
	const verifyPaths = [];
	const verifyMeta = [];
	for (let i = 0; i < rosterIds.length; i++) {
		const rosterId = String(rosterIds[i] == null ? "" : rosterIds[i]).trim();
		if (!rosterId) continue;
		const encodedRosterId = encodeFirebaseObjectKey_(rosterId);
		verifyMeta.push({ rosterId: rosterId, kind: "war" });
		verifyPaths.push(buildAutoRefreshRunPath_(runIdRaw, "warResults/" + encodedRosterId));
		verifyMeta.push({ rosterId: rosterId, kind: "metric" });
		verifyPaths.push(buildAutoRefreshRunPath_(runIdRaw, "metricResults/" + encodedRosterId));
		verifyMeta.push({ rosterId: rosterId, kind: includeActiveRosters ? "roster" : "rosterWrite" });
		verifyPaths.push(includeActiveRosters
			? buildActiveVersionPath_(runIdRaw, "rosters/" + encodedRosterId)
			: buildAutoRefreshRunPath_(runIdRaw, "rosterWrites/" + encodedRosterId));
	}
	const verifyPayloadByPath = firebaseBatchGetJson_(verifyPaths, { disableFallback: true });
	const activeRosterById = {};
	const metricResultByRosterId = {};
	const rosterWriteByRosterId = {};
	for (let i = 0; i < verifyPaths.length; i++) {
		const meta = verifyMeta[i] || {};
		const payload = verifyPayloadByPath[verifyPaths[i]];
		if (meta.kind === "war") {
			const warResult = decodeFirebaseObjectKeysRecursive_(payload);
			if (!warResult || typeof warResult !== "object") {
				throw new Error("Auto-refresh finalization missing roster result shard: " + meta.rosterId + ".");
			}
		} else if (meta.kind === "metric") {
			const metricResult = decodeFirebaseObjectKeysRecursive_(payload);
			if (!metricResult || typeof metricResult !== "object") {
				throw new Error("Auto-refresh finalization missing metric result shard: " + meta.rosterId + ".");
			}
			metricResultByRosterId[meta.rosterId] = metricResult;
		} else if (meta.kind === "rosterWrite") {
			const rosterWrite = decodeFirebaseObjectKeysRecursive_(payload);
			if (!rosterWrite || typeof rosterWrite !== "object") {
				throw new Error("Auto-refresh finalization missing roster write marker: " + meta.rosterId + ".");
			}
			rosterWriteByRosterId[meta.rosterId] = rosterWrite;
		} else if (!payload) {
			throw new Error("Auto-refresh finalization missing active roster shard: " + meta.rosterId + ".");
		} else {
			const activeRoster = decodeFirebaseObjectKeysRecursive_(payload);
			if (activeRoster && typeof activeRoster === "object") activeRosterById[meta.rosterId] = activeRoster;
		}
	}
	return {
		activeRosterById: activeRosterById,
		metricResultByRosterId: metricResultByRosterId,
		rosterWriteByRosterId: rosterWriteByRosterId,
	};
}

// Assert that completed roster outputs do not duplicate a player tag across any
// roster. Returns false when old in-progress tasks do not have tag summaries.
function assertAutoRefreshRosterWriteTagsUnique_(rosterWriteByRosterIdRaw, rosterIdsRaw) {
	const rosterWriteByRosterId = rosterWriteByRosterIdRaw && typeof rosterWriteByRosterIdRaw === "object" ? rosterWriteByRosterIdRaw : {};
	const rosterIds = Array.isArray(rosterIdsRaw) ? rosterIdsRaw : [];
	const seen = {};
	for (let i = 0; i < rosterIds.length; i++) {
		const rosterId = String(rosterIds[i] == null ? "" : rosterIds[i]).trim();
		if (!rosterId) continue;
		const marker = rosterWriteByRosterId[rosterId] && typeof rosterWriteByRosterId[rosterId] === "object" ? rosterWriteByRosterId[rosterId] : null;
		if (!marker || !Array.isArray(marker.playerTags)) return false;
		for (let j = 0; j < marker.playerTags.length; j++) {
			const tag = normalizeTag_(marker.playerTags[j]);
			if (!tag) continue;
			if (seen[tag]) throw new Error("Duplicate player tag in output: " + tag);
			seen[tag] = true;
		}
	}
	return true;
}

// Fallback duplicate guard for runs whose roster write markers were created by
// an older worker and do not contain tag summaries.
function assertAutoRefreshActiveRosterShardTagsUnique_(runIdRaw, rosterIdsRaw) {
	const rosterIds = Array.isArray(rosterIdsRaw) ? rosterIdsRaw : [];
	const paths = [];
	const rosterIdByPath = {};
	for (let i = 0; i < rosterIds.length; i++) {
		const rosterId = String(rosterIds[i] == null ? "" : rosterIds[i]).trim();
		if (!rosterId) continue;
		const path = buildActiveVersionPath_(runIdRaw, "rosters/" + encodeFirebaseObjectKey_(rosterId));
		paths.push(path);
		rosterIdByPath[path] = rosterId;
	}
	const encodedByPath = firebaseBatchGetJson_(paths, { disableFallback: true });
	const seen = {};
	for (let i = 0; i < paths.length; i++) {
		const path = paths[i];
		const rosterId = rosterIdByPath[path];
		const encodedRoster = encodedByPath[path];
		if (!encodedRoster || typeof encodedRoster !== "object" || Array.isArray(encodedRoster)) {
			throw new Error("Auto-refresh finalization missing active roster shard: " + rosterId + ".");
		}
		const roster = decodeFirebaseObjectKeysRecursive_(encodedRoster);
		const tags = collectAutoRefreshRosterPlayerTags_(roster);
		for (let j = 0; j < tags.length; j++) {
			const tag = normalizeTag_(tags[j]);
			if (!tag) continue;
			if (seen[tag]) throw new Error("Duplicate player tag in output: " + tag);
			seen[tag] = true;
		}
	}
	return true;
}

// Count active-version metric entries using a shallow byTag read.
function countActiveVersionPlayerMetricEntriesShallow_(versionIdRaw) {
	const versionId = normalizeActiveVersionId_(versionIdRaw);
	if (!versionId) return 0;
	const encoded = firebaseRequestJson_(buildActiveVersionPath_(versionId, "playerMetrics/byTag"), "GET", undefined, { shallow: "true" });
	return encoded && typeof encoded === "object" && !Array.isArray(encoded) ? Object.keys(encoded).length : 0;
}

// Build a manifest from source metadata without rebuilding the full roster
// payload. The target active version already contains completed roster shards.
function buildAutoRefreshActiveVersionManifestFromSourceMeta_(runIdRaw, sourceMetaRaw, rosterIdsRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const sourceMeta = sourceMetaRaw && typeof sourceMetaRaw === "object" ? sourceMetaRaw : {};
	const versionId = normalizeActiveVersionId_(runIdRaw);
	const rosterIds = Array.isArray(rosterIdsRaw) ? rosterIdsRaw.slice() : [];
	const publishedAt = String(options.publishedAt || new Date().toISOString());
	const manifest = {
		versionId: versionId,
		status: "published",
		source: String(options.source == null ? ACTIVE_DATA_WRITE_SOURCE_AUTO_REFRESH : options.source).trim(),
		runId: String(options.runId == null ? versionId : options.runId).trim(),
		publishedAt: publishedAt,
		schemaVersion: typeof sourceMeta.schemaVersion === "number" && isFinite(sourceMeta.schemaVersion) ? sourceMeta.schemaVersion : 1,
		pageTitle: typeof sourceMeta.pageTitle === "string" ? sourceMeta.pageTitle : "",
		rosterOrder: Array.isArray(sourceMeta.rosterOrder) ? sourceMeta.rosterOrder.slice() : rosterIds.slice(),
		rosterIds: rosterIds,
		connectedClanTags: Array.isArray(sourceMeta.connectedClanTags) ? sourceMeta.connectedClanTags.slice() : [],
		lastUpdatedAt: String(options.lastUpdatedAt || publishedAt),
		playerMetricsSchemaVersion: PLAYER_METRICS_SCHEMA_VERSION,
		playerMetricEntryCount: toNonNegativeInt_(options.playerMetricEntryCount),
		layoutVersion: FIREBASE_LAYOUT_VERSION,
	};
	if (sourceMeta.publicConfig && typeof sourceMeta.publicConfig === "object") manifest.publicConfig = sourceMeta.publicConfig;
	if (options.sourceFingerprint) manifest.sourceFingerprint = String(options.sourceFingerprint || "");
	return manifest;
}

// Build the lightest valid roster payload needed to probe connected-clan CWL
// groups during staged queue finalization.
function buildAutoRefreshCwlRosterDataFromSourceMeta_(sourceMetaRaw, lastUpdatedAtRaw) {
	const sourceMeta = sourceMetaRaw && typeof sourceMetaRaw === "object" ? sourceMetaRaw : {};
	const rosterIdsRaw = Array.isArray(sourceMeta.rosterIds) ? sourceMeta.rosterIds : [];
	const connectedClanTagByRosterId =
		sourceMeta.connectedClanTagByRosterId && typeof sourceMeta.connectedClanTagByRosterId === "object"
			? sourceMeta.connectedClanTagByRosterId
			: {};
	const cwlEligibleAccountTagsByRosterId = sourceMeta.cwlEligibleAccountTagsByRosterId && typeof sourceMeta.cwlEligibleAccountTagsByRosterId === "object"
		? sourceMeta.cwlEligibleAccountTagsByRosterId
		: {};
	const rosters = [];
	for (let i = 0; i < rosterIdsRaw.length; i++) {
		const rosterId = String(rosterIdsRaw[i] == null ? "" : rosterIdsRaw[i]).trim();
		if (!rosterId) continue;
		const eligibleTags = Array.isArray(cwlEligibleAccountTagsByRosterId[rosterId]) ? cwlEligibleAccountTagsByRosterId[rosterId] : [];
		rosters.push({
			id: rosterId,
			title: rosterId,
			connectedClanTag: normalizeTag_(connectedClanTagByRosterId[rosterId]),
			trackingMode: "regularWar",
			main: eligibleTags.map(function (tag, index) { return { tag: normalizeTag_(tag), slot: index + 1, th: 1 }; }).filter(function (player) { return !!player.tag; }),
			subs: [],
			missing: [],
		});
	}
	const payload = {
		schemaVersion: typeof sourceMeta.schemaVersion === "number" && isFinite(sourceMeta.schemaVersion) ? sourceMeta.schemaVersion : 1,
		pageTitle: typeof sourceMeta.pageTitle === "string" ? sourceMeta.pageTitle : "",
		rosterOrder: Array.isArray(sourceMeta.rosterOrder) ? sourceMeta.rosterOrder.slice() : rosters.map((roster) => roster.id),
		rosters: rosters,
		playerMetrics: createEmptyPlayerMetricsStore_(),
		lastUpdatedAt: String(lastUpdatedAtRaw || sourceMeta.sourceLastUpdatedAt || new Date().toISOString()),
	};
	if (sourceMeta.publicConfig && typeof sourceMeta.publicConfig === "object") payload.publicConfig = sourceMeta.publicConfig;
	return validateRosterData_(payload);
}

// Refresh the independent CWL season-event tracker during queue finalization.
// This deliberately reuses the canonical shared snapshot and event refresher.
function refreshCwlSeasonEventForAutoRefreshQueue_(rosterDataRaw, sourceMetaRaw, runIdRaw) {
	try {
		if (
			typeof getCurrentCwlSeasonEventRefreshNeed_ !== "function" ||
			typeof tryRefreshCurrentCwlSeasonEventFromSnapshot_ !== "function"
		) {
			return { ok: true, status: "unavailable" };
		}
		const need = getCurrentCwlSeasonEventRefreshNeed_();
		if (!need || need.needsCwl !== true) {
			return {
				ok: true,
				status: "no-current-cwl-event",
				eventId: need && need.eventId ? String(need.eventId) : "",
			};
		}
		const runId = normalizeActiveVersionId_(runIdRaw);
		const summary = runId ? readAutoRefreshCwlCoordinatorSummary_(runId) : null;
		if (!summary || typeof summary !== "object" || summary.completed !== true) {
			return { ok: false, status: "missing-cwl-coordinator-result", eventId: need.eventId || "", runId: runId };
		}
		const stored = runId ? readAutoRefreshRunShard_(runId, "final/cwlSeasonEventRefresh") : null;
		const storedEventId = String((stored && stored.eventId) || "");
		const neededEventId = String(need.eventId || "");
		const storedAggregateHash = String((stored && stored.aggregateHash) || "");
		const summaryAggregateHash = String(summary.aggregateHash || "");
		if (
			stored &&
			typeof stored === "object" &&
			stored.completed === true &&
			stored.ok !== false &&
			(!neededEventId || storedEventId === neededEventId) &&
			(!summaryAggregateHash || storedAggregateHash === summaryAggregateHash)
		) {
			const reused = Object.assign({}, stored, {
				reused: true,
				requestCounts: stored.requestCounts && typeof stored.requestCounts === "object" ? stored.requestCounts : summary.requestCounts || {},
			});
			Logger.log(
				"Auto-refresh queue CWL season event refresh reused runId=%s eventId=%s aggregateHash=%s status=%s",
				runId,
				storedEventId,
				storedAggregateHash,
				String(stored.status || ""),
			);
			return reused;
		}
		const viewClanTags = Array.isArray(summary.viewClanTags) ? summary.viewClanTags : [];
		const viewsByClanTag = {};
		for (let i = 0; i < viewClanTags.length; i++) {
			const clanTag = normalizeTag_(viewClanTags[i]);
			if (!clanTag) continue;
			const view = readAutoRefreshCwlClanView_(runId, clanTag);
			if (view && typeof view === "object") viewsByClanTag[clanTag] = view;
		}
		const coordinator = Object.assign({}, summary, {
			viewsByClanTag: viewsByClanTag,
		});
		const rosterData =
			rosterDataRaw && typeof rosterDataRaw === "object" && Array.isArray(rosterDataRaw.rosters)
				? rosterDataRaw
				: buildAutoRefreshCwlCoordinatorRosterDataFromSourceMeta_(sourceMetaRaw, new Date().toISOString());
		const snapshot = { cwlCoordinator: coordinator };
		const result = tryRefreshCurrentCwlSeasonEventFromSnapshot_(rosterData, snapshot, {
			source: "refresh-all-queue",
			runId: runId,
			allowSnapshotCoordinatorAfterTargetChange: true,
		});
		if (result && typeof result === "object") {
			result.requestCounts = summary && summary.requestCounts && typeof summary.requestCounts === "object"
				? {
					leagueGroup: toNonNegativeInt_(summary.requestCounts.leagueGroup),
					cwlWar: toNonNegativeInt_(summary.requestCounts.cwlWar),
					total: toNonNegativeInt_(summary.requestCounts.total),
				}
				: {};
		}
		const out = result || { ok: false, status: "unknown" };
		const outStatus = String(out.status || "");
		const completed = out.ok !== false && outStatus !== "stale" && outStatus !== "bootstrap-incomplete" && outStatus !== "error";
		const persisted = Object.assign({}, out, {
			ok: completed ? out.ok : false,
			completed: completed,
			runId: runId,
			eventId: String(out.eventId || need.eventId || summary.eventId || ""),
			aggregateHash: String(out.aggregateHash || summary.aggregateHash || ""),
			cwlSummaryWrittenAt: String(summary.writtenAt || ""),
			writtenAt: new Date().toISOString(),
			reused: false,
		});
		if (runId) writeAutoRefreshRunShard_(runId, "final/cwlSeasonEventRefresh", persisted, "PUT");
		return persisted;
	} catch (err) {
		Logger.log("Auto-refresh queue CWL season event refresh skipped: %s", errorMessage_(err));
		return { ok: false, status: "error", error: errorMessage_(err) };
	}
}

function shouldPublishCloudflareAfterAutoRefreshCwlSeasonEventRefresh_(refreshRaw) {
	const refresh = refreshRaw && typeof refreshRaw === "object" ? refreshRaw : null;
	if (!refresh || refresh.ok === false) return false;
	const status = String(refresh.status || "")
		.trim()
		.toLowerCase();
	if (!status) return true;
	return status !== "not-needed" && status !== "unavailable" && status !== "no-current-cwl-event";
}

function publishCloudflareSeasonEventsAfterAutoRefreshCwlBestEffort_(refreshRaw, labelRaw) {
	if (refreshRaw && typeof refreshRaw === "object" && refreshRaw.cloudflarePublish) return refreshRaw.cloudflarePublish;
	if (!shouldPublishCloudflareAfterAutoRefreshCwlSeasonEventRefresh_(refreshRaw)) {
		return { ok: true, skipped: true, reason: "cwl-refresh-not-publishable" };
	}
	const refresh = refreshRaw && typeof refreshRaw === "object" ? refreshRaw : {};
	const label = String(labelRaw || "auto-refresh-cwl-season-events").trim() || "auto-refresh-cwl-season-events";
	const eventId = sanitizeSeasonEventText_(refresh.eventId || (refresh.event && refresh.event.eventId), 180);
	if (eventId && typeof buildCwlLifecyclePublicationDescriptor_ === "function" && typeof publishCwlLifecycleDescriptor_ === "function") {
		const descriptor = buildCwlLifecyclePublicationDescriptor_(eventId, refresh.status || (refresh.finalized === true ? "completed" : "active"), { reason: label });
		return publishCwlLifecycleDescriptor_(descriptor);
	}
	return { ok: true, skipped: true, reason: "queue-unavailable", label: label };
}

// Ensure all metric-copy tasks that precede staged finalization wrote their
// completion markers.
function verifyAutoRefreshMetricCopyTasksComplete_(runIdRaw, taskIdsRaw) {
	const taskIds = Array.isArray(taskIdsRaw) ? taskIdsRaw : [];
	for (let i = 0; i < taskIds.length; i++) {
		const taskId = String(taskIds[i] == null ? "" : taskIds[i]).trim();
		if (!taskId) continue;
		const task = readAutoRefreshTask_(runIdRaw, taskId);
		if (!task || String(task.type || "") !== "metricCopy") continue;
		if (!isAutoRefreshTaskResultComplete_(runIdRaw, task)) {
			throw new Error("Auto-refresh finalization missing metric copy marker: " + taskId + ".");
		}
	}
}

function ensureAutoRefreshCloudflarePublicDataPublished_(currentRaw, labelRaw, optionsRaw) {
	const current = normalizeAutoRefreshQueueCurrent_(currentRaw);
	const runId = current && current.runId;
	const label = String(labelRaw || "auto-refresh-finalize").trim() || "auto-refresh-finalize";
	if (!runId) throw new Error("Auto-refresh Cloudflare enqueue is missing run id.");
	if (typeof enqueueCloudflareActiveTarget_ !== "function") {
		return { ok: true, skipped: true, status: "legacy-manual", reason: "cloudflare-queue-unavailable", runId: runId, label: label };
	}
	const enqueue = function () {
		try {
			return enqueueCloudflareActiveTarget_(runId, label);
		} catch (err) {
			Logger.log("Auto-refresh Cloudflare enqueue failed after canonical completion: %s", errorMessage_(err));
			return { ok: false, error: errorMessage_(err), queued: false };
		}
	};
	let queued;
	if (typeof deferActiveRosterLockAction_ === "function") {
		const deferredResult = { ok: true, queued: false, pending: true, deferred: true, reason: "canonical-lock" };
		queued = deferActiveRosterLockAction_(function () {
			Object.assign(deferredResult, enqueue());
		}) ? deferredResult : enqueue();
	} else {
		queued = enqueue();
	}
	const ok = !!queued && queued.ok !== false;
	const skipped = !!queued && queued.skipped === true;
	const degradedScheduling = !!queued && queued.degradedScheduling === true;
	const status = queued && queued.deferred
		? "deferred"
		: skipped
			? String(queued.reason || "skipped")
			: ok
				? "queued"
				: "failed";
	return {
		ok: ok,
		status: status,
		queued: ok && !skipped && queued.deferred !== true,
		runId: runId,
		pending: !!(queued && (queued.pending !== false || queued.deferred === true)),
		deferred: !!(queued && queued.deferred === true),
		degradedScheduling: degradedScheduling,
		repairPending: !ok || skipped || degradedScheduling || !!(queued && queued.deferred === true),
		queueResult: queued,
		summary: {
			ok: ok,
			status: status,
			versionId: runId,
			label: label,
			pending: !!(queued && (queued.pending !== false || queued.deferred === true)),
			deferred: !!(queued && queued.deferred === true),
			degradedScheduling: degradedScheduling,
			repairPending: !ok || skipped || degradedScheduling || !!(queued && queued.deferred === true),
			error: String((queued && queued.error) || ""),
			updatedAt: new Date().toISOString(),
		},
	};
}

function summarizeAutoRefreshFinalCwlCoordinatorCapture_(captureRaw) {
	const capture = captureRaw && typeof captureRaw === "object" ? captureRaw : {};
	return {
		ok: capture.ok !== false,
		status: String(capture.status || ""),
		reason: String(capture.reason || ""),
		eventId: String(capture.eventId || ""),
		capturedAt: String(capture.capturedAt || ""),
		aggregateHash: String(capture.aggregateHash || ""),
		aggregateOk: capture.aggregateOk !== false,
		aggregateStatus: String(capture.aggregateStatus || ""),
		requestCounts: capture.requestCounts && typeof capture.requestCounts === "object" ? capture.requestCounts : {},
		reused: capture.reused === true,
		skipped: capture.skipped === true,
		error: String(capture.error || ""),
	};
}

function isAutoRefreshFinalCwlCoordinatorSummaryFresh_(summaryRaw, needRaw, nowMsRaw) {
	const summary = summaryRaw && typeof summaryRaw === "object" ? summaryRaw : null;
	const need = needRaw && typeof needRaw === "object" ? needRaw : {};
	if (!summary || summary.completed !== true || summary.finalCapture !== true) return false;
	const eventId = String(need.eventId || "");
	if (eventId && String(summary.eventId || "") !== eventId) return false;
	const capturedMs = parseIsoToMs_(summary.writtenAt) || parseIsoToMs_(summary.capturedAt);
	const nowMs = Math.max(0, Number(nowMsRaw) || Date.now());
	return capturedMs > 0 && nowMs >= capturedMs && nowMs - capturedMs <= AUTO_REFRESH_CWL_FINAL_CAPTURE_MAX_AGE_MS;
}

function buildAutoRefreshFinalCwlCaptureFromSummary_(summaryRaw, statusRaw, reusedRaw) {
	const summary = summaryRaw && typeof summaryRaw === "object" ? summaryRaw : {};
	const aggregateResult = summary.eventAggregateResult && typeof summary.eventAggregateResult === "object" ? summary.eventAggregateResult : null;
	return summarizeAutoRefreshFinalCwlCoordinatorCapture_({
		ok: true,
		status: statusRaw || "captured",
		eventId: summary.eventId,
		capturedAt: summary.capturedAt,
		aggregateHash: summary.aggregateHash || getAutoRefreshCwlCoordinatorAggregateHash_(summary),
		aggregateOk: !!aggregateResult && aggregateResult.ok !== false,
		aggregateStatus: String((aggregateResult && aggregateResult.status) || ""),
		requestCounts: summary.requestCounts,
		reused: reusedRaw === true,
	});
}

function ensureAutoRefreshFinalCwlCoordinatorCapture_(currentRaw, sourceMetaRaw, executionStartMsRaw) {
	const current = normalizeAutoRefreshQueueCurrent_(currentRaw);
	const runId = current && current.runId;
	if (!runId) return { ok: false, status: "missing-run-id", error: "Auto-refresh CWL final capture is missing run id." };
	// The persisted final coordinator is a side phase. Once it terminalizes into
	// independent recovery, neither the finalize preflight nor required final
	// phases may retry it and consume the canonical selector-commit budget.
	if (current.cwlFinalCoordinatorSidePhaseTerminal === true) {
		return summarizeAutoRefreshFinalCwlCoordinatorCapture_(Object.assign({}, current.cwlFinalCoordinatorCapture || {}, {
			ok: false,
			status: "deferred",
			reason: "persisted-final-cwl-side-phase-terminal",
			aggregateOk: false,
		}));
	}
	if (typeof getCurrentCwlSeasonEventRefreshNeed_ !== "function") {
		return { ok: true, status: "unavailable", skipped: true, reason: "cwl-refresh-need-unavailable" };
	}
	let need = null;
	try {
		need = getCurrentCwlSeasonEventRefreshNeed_();
	} catch (err) {
		return { ok: false, status: "need-error", error: errorMessage_(err) };
	}
	if (!need || need.needsCwl !== true) {
		return summarizeAutoRefreshFinalCwlCoordinatorCapture_({
			ok: true,
			status: "no-current-cwl-event",
			skipped: true,
			reason: "no-current-cwl-event",
			eventId: need && need.eventId ? String(need.eventId) : "",
			aggregateOk: true,
		});
	}
	const existingSummary = readAutoRefreshCwlCoordinatorSummary_(runId);
	const storedSeasonRefresh = readAutoRefreshRunShard_(runId, "final/cwlSeasonEventRefresh");
	const cloudflareRetryNeedsStableCwl = !!(storedSeasonRefresh && typeof storedSeasonRefresh === "object" && storedSeasonRefresh.completed === true && storedSeasonRefresh.ok !== false);
	if (
		cloudflareRetryNeedsStableCwl &&
		existingSummary &&
		existingSummary.completed === true &&
		existingSummary.finalCapture === true &&
		(!String(need.eventId || "") || String(existingSummary.eventId || "") === String(need.eventId || ""))
	) {
		return buildAutoRefreshFinalCwlCaptureFromSummary_(existingSummary, "reused", true);
	}
	if (isAutoRefreshFinalCwlCoordinatorSummaryFresh_(existingSummary, need, Date.now())) {
		return buildAutoRefreshFinalCwlCaptureFromSummary_(existingSummary, "reused", true);
	}
	if (!hasAutoRefreshJobBudgetFor_(executionStartMsRaw, AUTO_REFRESH_QUEUE_ROSTER_WRITE_RESERVE_MS)) {
		return { ok: false, status: "deferred", reason: "beforeFinalCwlCoordinator", eventId: String(need.eventId || "") };
	}
	if (typeof buildCwlCoordinatorResult_ !== "function") {
		return { ok: false, status: "unavailable", eventId: String(need.eventId || ""), error: "CWL coordinator is unavailable." };
	}
	const sourceMeta = sourceMetaRaw && typeof sourceMetaRaw === "object" ? sourceMetaRaw : readAutoRefreshRunShard_(runId, "source/meta");
	if (!sourceMeta || typeof sourceMeta !== "object") {
		return { ok: false, status: "missing-source-meta", eventId: String(need.eventId || ""), error: "Auto-refresh source metadata is missing." };
	}
	const processStartMs = Date.now();
	try {
		const rosterData = buildAutoRefreshCwlCoordinatorRosterDataFromSourceMeta_(sourceMeta, sourceMeta.sourceLastUpdatedAt || new Date().toISOString());
		const coordinator = buildCwlCoordinatorResult_(rosterData, {
			nowIso: new Date().toISOString(),
			source: "auto-refresh-queue-final-cwl-coordinator",
			runId: runId,
		});
		const compact = writeAutoRefreshCwlCoordinatorResult_(runId, coordinator, { capturePhase: "final" });
		const capture = buildAutoRefreshFinalCwlCaptureFromSummary_(compact, "captured", false);
		capture.processMs = Math.max(0, Date.now() - processStartMs);
		Logger.log(
			"autoRefresh final cwl capture runId=%s eventId=%s capturedAt=%s aggregateHash=%s aggregateOk=%s requestLeagueGroups=%s requestWars=%s reused=false processMs=%s",
			runId,
			capture.eventId,
			capture.capturedAt,
			capture.aggregateHash,
			capture.aggregateOk,
			toNonNegativeInt_(capture.requestCounts && capture.requestCounts.leagueGroup),
			toNonNegativeInt_(capture.requestCounts && capture.requestCounts.cwlWar),
			capture.processMs,
		);
		return capture;
	} catch (err) {
		if (err && err.autoRefreshDefer) {
			return {
				ok: false,
				status: "deferred",
				reason: "firebase-final-cwl-coordinator-write",
				eventId: String(need.eventId || ""),
				error: errorMessage_(err),
				processMs: Math.max(0, Date.now() - processStartMs),
			};
		}
		return { ok: false, status: "error", eventId: String(need.eventId || ""), error: errorMessage_(err), processMs: Math.max(0, Date.now() - processStartMs) };
	}
}

function readAutoRefreshPublishedVersionRosterDataForCwlAck_(runIdRaw) {
	const runId = normalizeActiveVersionId_(runIdRaw);
	if (!runId) return null;
	const encodedManifest = firebaseRequestJson_(buildActiveVersionPath_(runId, "manifest"), "GET");
	if (!encodedManifest || typeof encodedManifest !== "object" || Array.isArray(encodedManifest)) {
		throw new Error("Missing active version manifest for " + runId + ".");
	}
	const manifest = decodeFirebaseObjectKeysRecursive_(encodedManifest);
	const rosterShardResult = readActiveVersionRosterShards_(runId, manifest);
	const payload = {
		schemaVersion: typeof manifest.schemaVersion === "number" && isFinite(manifest.schemaVersion) ? manifest.schemaVersion : 1,
		pageTitle: typeof manifest.pageTitle === "string" ? manifest.pageTitle : "",
		rosterOrder: Array.isArray(manifest.rosterOrder) ? manifest.rosterOrder : rosterShardResult.rosterIds,
		rosters: rosterShardResult.rosters,
		playerMetrics: createEmptyPlayerMetricsStore_(),
		lastUpdatedAt: String(manifest.lastUpdatedAt || manifest.publishedAt || new Date().toISOString()),
	};
	if (manifest.publicConfig && typeof manifest.publicConfig === "object") payload.publicConfig = manifest.publicConfig;
	return validateRosterData_(payload);
}

function ackAutoRefreshFinalizedCwlRuntimeBestEffort_(eventIdRaw, rosterDataRaw, runIdRaw) {
	const eventId = String(eventIdRaw || "").trim();
	if (!eventId || typeof ackFinalizedCwlRuntimeRosterConsumptionFromRosterData_ !== "function") {
		return { ok: true, skipped: true, reason: "not-needed" };
	}
	try {
		let rosterData = rosterDataRaw && typeof rosterDataRaw === "object" && Array.isArray(rosterDataRaw.rosters) ? rosterDataRaw : null;
		let source = "provided";
		if (!rosterData) {
			rosterData = readAutoRefreshPublishedVersionRosterDataForCwlAck_(runIdRaw);
			source = "published-roster-shards";
		}
		if (!rosterData) return { ok: true, skipped: true, reason: "missing-roster-data" };
		const ack = ackFinalizedCwlRuntimeRosterConsumptionFromRosterData_(eventId, rosterData, new Date().toISOString());
		return Object.assign({ ok: true, source: source }, ack || {});
	} catch (err) {
		Logger.log("autoRefresh cwl runtime ack skipped eventId=%s runId=%s error=%s", eventId, normalizeActiveVersionId_(runIdRaw), errorMessage_(err));
		return { ok: false, skipped: true, error: errorMessage_(err) };
	}
}

function buildAutoRefreshCwlFinalOutcome_(captureRaw, refreshRaw) {
	const capture = captureRaw && typeof captureRaw === "object" ? captureRaw : null;
	const refresh = refreshRaw && typeof refreshRaw === "object" ? refreshRaw : null;
	const captureStatus = String((capture && capture.status) || "").trim().toLowerCase();
	const lifecycleStatus = String((refresh && refresh.status) || "").trim().toLowerCase();
	const refreshTarget = refresh && refresh.event && refresh.event.cwl && refresh.event.cwl.target && typeof refresh.event.cwl.target === "object" ? refresh.event.cwl.target : {};
	let status = "successful";
	if (lifecycleStatus === "stale") status = "stale";
	else if (lifecycleStatus === "bootstrap-incomplete" || lifecycleStatus === "deferred" || lifecycleStatus === "unavailable") status = "deferred";
	else if (capture && capture.skipped !== true && capture.aggregateOk === false) status = "failed";
	else if (refresh && refresh.ok === false) {
		status = lifecycleStatus.indexOf("deadline") >= 0 || String(refresh.reason || "").toLowerCase().indexOf("deadline") >= 0 ? "deferred" : "failed";
	} else if (!refresh && capture && capture.ok === false) {
		status = captureStatus === "deferred" || captureStatus === "unavailable" ? "deferred" : "failed";
	} else if (!refresh && !capture) {
		status = "failed";
	}
	return {
		status: status,
		eventId: String((refresh && refresh.eventId) || (capture && capture.eventId) || ""),
		groupId: String(refreshTarget.groupId || ""),
		season: String(refreshTarget.season || ""),
		captureStatus: captureStatus,
		lifecycleStatus: lifecycleStatus,
		aggregateOk: !capture || capture.aggregateOk !== false,
		lifecycleOk: !refresh || refresh.ok !== false,
		retryPending: status === "stale" || status === "deferred" || status === "failed",
		reason: String((refresh && (refresh.reason || refresh.error)) || (capture && (capture.reason || capture.error)) || "").slice(0, 500),
		updatedAt: new Date().toISOString(),
	};
}

function recordAutoRefreshCwlFinalOutcomeRecovery_(runIdRaw, outcomeRaw) {
	const runId = normalizeActiveVersionId_(runIdRaw);
	const outcome = outcomeRaw && typeof outcomeRaw === "object" ? outcomeRaw : {};
	const recoveryScope = typeof buildCwlRuntimeRecoveryScope_ === "function" ? buildCwlRuntimeRecoveryScope_(outcome.eventId) : "cwl-refresh";
	if (outcome.retryPending === true) {
		if (typeof markRuntimeRecoveryNeeded_ === "function") {
			markRuntimeRecoveryNeeded_(recoveryScope, "auto-refresh-side-phase-" + String(outcome.status || "failed"), {
				originRunId: runId,
				eventId: String(outcome.eventId || ""),
				groupId: String(outcome.groupId || ""),
				season: String(outcome.season || ""),
				captureStatus: String(outcome.captureStatus || ""),
				lifecycleStatus: String(outcome.lifecycleStatus || ""),
			});
		}
		if (typeof scheduleCwlSeasonEventRecovery_ === "function") scheduleCwlSeasonEventRecovery_();
	} else if (typeof clearRuntimeRecoveryNeeded_ === "function") {
		clearRuntimeRecoveryNeeded_(recoveryScope);
		const legacyMarker = typeof readRuntimeRecoveryMarker_ === "function" ? readRuntimeRecoveryMarker_() : { scopes: {} };
		const legacyCwl = legacyMarker.scopes && legacyMarker.scopes["cwl-refresh"];
		if (legacyCwl && (!legacyCwl.eventId || String(legacyCwl.eventId) === String(outcome.eventId || ""))) clearRuntimeRecoveryNeeded_("cwl-refresh");
	}
	return outcome;
}

function runAutoRefreshRequiredFinalPhases_(currentRaw, sourceMetaRaw, summaryRaw, executionStartMsRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const current = normalizeAutoRefreshQueueCurrent_(currentRaw);
	if (!current || !current.runId) return { ok: false, status: "recorded", sidePhasesTerminal: true, error: "Auto-refresh finalization is missing run state." };
	const runId = current.runId;
	let sourceMeta = sourceMetaRaw && typeof sourceMetaRaw === "object" ? sourceMetaRaw : null;
	if (!sourceMeta) {
		try { sourceMeta = readAutoRefreshRunShard_(runId, "source/meta"); } catch (err) { sourceMeta = null; }
	}
	const label = String(options.cloudflareLabel || "auto-refresh-finalize").trim() || "auto-refresh-finalize";
	// The active-version publication is independent of CWL lifecycle evidence.
	// Queue it first so CWL fetch failures or exhausted side-phase budget cannot
	// prevent the canonical target from entering durable Cloudflare recovery.
	let cloudflareMirror = null;
	try {
		cloudflareMirror = ensureAutoRefreshCloudflarePublicDataPublished_(current, label);
	} catch (err) {
		cloudflareMirror = {
			ok: false,
			status: "failed",
			repairPending: true,
			error: errorMessage_(err),
			summary: { ok: false, status: "failed", versionId: runId, label: label, repairPending: true, error: errorMessage_(err), updatedAt: new Date().toISOString() },
		};
	}
	let capture = null;
	try {
		capture = ensureAutoRefreshFinalCwlCoordinatorCapture_(current, sourceMeta, executionStartMsRaw);
	} catch (err) {
		capture = { ok: false, status: err && err.autoRefreshDefer ? "deferred" : "error", reason: String((err && err.reason) || ""), error: errorMessage_(err) };
	}
	current.cwlFinalCoordinatorCapture = summarizeAutoRefreshFinalCwlCoordinatorCapture_(capture);
	let cwlSeasonEventRefresh = null;
	if (capture && capture.ok !== false) {
		cwlSeasonEventRefresh = refreshCwlSeasonEventForAutoRefreshQueue_(options.rosterData || null, sourceMeta, runId);
	} else {
		cwlSeasonEventRefresh = {
			ok: false,
			status: capture && String(capture.status || "") === "deferred" ? "deferred" : "failed",
			reason: String((capture && (capture.reason || capture.error)) || "final-cwl-capture-unavailable"),
			eventId: String((capture && capture.eventId) || ""),
			preserved: true,
		};
	}
	current.cwlSeasonEventRefresh = cwlSeasonEventRefresh || null;
	const refreshStatus = String((cwlSeasonEventRefresh && cwlSeasonEventRefresh.status) || "");
	if (current.cwlFinalCoordinatorCapture && cwlSeasonEventRefresh && typeof cwlSeasonEventRefresh === "object") {
		if (!current.cwlFinalCoordinatorCapture.aggregateHash && cwlSeasonEventRefresh.aggregateHash) {
			current.cwlFinalCoordinatorCapture.aggregateHash = String(cwlSeasonEventRefresh.aggregateHash || "");
		}
		if (cwlSeasonEventRefresh.ok === false) {
			current.cwlFinalCoordinatorCapture.aggregateOk = false;
			current.cwlFinalCoordinatorCapture.aggregateStatus = refreshStatus || current.cwlFinalCoordinatorCapture.aggregateStatus;
		}
	}
	current.cwlFinalOutcome = recordAutoRefreshCwlFinalOutcomeRecovery_(runId, buildAutoRefreshCwlFinalOutcome_(current.cwlFinalCoordinatorCapture, cwlSeasonEventRefresh));
	if (typeof tryReconcileCurrentSeasonEventsForAutoRefresh_ === "function") tryReconcileCurrentSeasonEventsForAutoRefresh_();
	current.cloudflarePublicDataPublish = cloudflareMirror && cloudflareMirror.summary ? cloudflareMirror.summary : null;
	const ack = cwlSeasonEventRefresh && cwlSeasonEventRefresh.ok !== false && refreshStatus === "completed"
		? ackAutoRefreshFinalizedCwlRuntimeBestEffort_(cwlSeasonEventRefresh.eventId, options.rosterData || null, runId)
		: { ok: true, skipped: true, reason: "cwl-lifecycle-not-completed" };
	Logger.log(
		"autoRefresh final side phases runId=%s eventId=%s cwlStatus=%s cwlOutcome=%s finalCaptureAt=%s aggregateHash=%s leagueGroupRequests=%s cwlWarRequests=%s cloudflareStatus=%s ackSource=%s",
		runId,
		String((cwlSeasonEventRefresh && cwlSeasonEventRefresh.eventId) || (capture && capture.eventId) || ""),
		refreshStatus,
		String(current.cwlFinalOutcome.status || ""),
		String(capture.capturedAt || ""),
		String(capture.aggregateHash || (cwlSeasonEventRefresh && cwlSeasonEventRefresh.aggregateHash) || ""),
		toNonNegativeInt_(capture.requestCounts && capture.requestCounts.leagueGroup),
		toNonNegativeInt_(capture.requestCounts && capture.requestCounts.cwlWar),
		String((cloudflareMirror && cloudflareMirror.status) || ""),
		String((ack && ack.source) || ""),
	);
	return {
		ok: true,
		status: "recorded",
		sidePhasesTerminal: true,
		summary: String(summaryRaw || ""),
		cwlFinalCoordinatorCapture: current.cwlFinalCoordinatorCapture,
		cwlSeasonEventRefresh: current.cwlSeasonEventRefresh,
		cwlFinalOutcome: current.cwlFinalOutcome,
		cloudflarePublicDataPublish: cloudflareMirror || null,
		cwlRuntimeRosterAck: ack,
	};
}

function inspectActiveVersionCanonicalContents_(versionIdRaw, optionsRaw) {
	const versionId = normalizeActiveVersionId_(versionIdRaw);
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const complete = function (details) { return Object.assign({ status: "complete", complete: true, positivelyIncomplete: false, indeterminate: false }, details || {}); };
	const incomplete = function (details) { return Object.assign({ status: "positively-incomplete", complete: false, positivelyIncomplete: true, indeterminate: false }, details || {}); };
	const indeterminate = function (details) { return Object.assign({ status: "indeterminate", complete: false, positivelyIncomplete: false, indeterminate: true }, details || {}); };
	if (!versionId) return incomplete({ reason: "missing-version-id" });
	try {
		const paths = [
			buildActiveVersionPath_(versionId, "manifest"),
			buildActiveVersionPath_(versionId, "playerMetrics/schemaVersion"),
			buildActiveVersionPath_(versionId, "playerMetrics/updatedAt"),
			buildActiveVersionPath_(versionId, "playerMetrics/byTag"),
		];
		if (options.requirePublishedManifest === true) paths.push(FIREBASE_ACTIVE_PUBLISHED_CURRENT_MANIFEST_PATH);
		const values = firebaseBatchGetJson_(paths);
		const encodedManifest = values[paths[0]];
		const manifest = encodedManifest && typeof encodedManifest === "object" && !Array.isArray(encodedManifest)
			? decodeFirebaseObjectKeysRecursive_(encodedManifest)
			: null;
		if (!manifest || normalizeActiveVersionId_(manifest.versionId) !== versionId) {
			return incomplete({ reason: "missing-or-mismatched-manifest", versionId: versionId });
		}
		const rosterIdsRaw = Array.isArray(manifest.rosterIds) ? manifest.rosterIds : [];
		const rosterIds = [];
		const rosterSeen = {};
		for (let i = 0; i < rosterIdsRaw.length; i++) {
			const rosterId = String(rosterIdsRaw[i] == null ? "" : rosterIdsRaw[i]).trim();
			if (!rosterId || rosterSeen[rosterId]) return incomplete({ reason: "invalid-manifest-roster-ids", versionId: versionId, manifest: manifest });
			rosterSeen[rosterId] = true;
			rosterIds.push(rosterId);
		}
		if (!rosterIds.length || !Array.isArray(manifest.rosterOrder) || !String(manifest.publishedAt || "").trim()) {
			return incomplete({ reason: "incomplete-supporting-manifest", versionId: versionId, manifest: manifest });
		}
		if (values[paths[1]] == null || !String(values[paths[2]] || "").trim()) {
			return incomplete({ reason: "missing-player-metrics-metadata", versionId: versionId, manifest: manifest });
		}
		const metricByTag = values[paths[3]];
		const expectedMetricCount = Math.max(0, toNonNegativeInt_(manifest.playerMetricEntryCount));
		const actualMetricCount = metricByTag && typeof metricByTag === "object" && !Array.isArray(metricByTag) ? Object.keys(metricByTag).length : 0;
		if (expectedMetricCount > 0 && (!metricByTag || typeof metricByTag !== "object" || Array.isArray(metricByTag))) {
			return incomplete({ reason: "missing-player-metrics-shards", versionId: versionId, manifest: manifest });
		}
		if (actualMetricCount !== expectedMetricCount || toNonNegativeInt_(manifest.playerMetricsSchemaVersion) !== toNonNegativeInt_(values[paths[1]]) || manifest.layoutVersion == null) {
			return incomplete({ reason: "inconsistent-player-metrics-or-layout-metadata", versionId: versionId, manifest: manifest });
		}
		if (options.requirePublishedManifest === true) {
			const encodedPublishedManifest = values[paths[4]];
			const publishedManifest = encodedPublishedManifest && typeof encodedPublishedManifest === "object" && !Array.isArray(encodedPublishedManifest)
				? decodeFirebaseObjectKeysRecursive_(encodedPublishedManifest)
				: null;
			if (!publishedManifest || normalizeActiveVersionId_(publishedManifest.versionId) !== versionId) {
				return incomplete({ reason: "missing-published-manifest", versionId: versionId, manifest: manifest });
			}
			if (JSON.stringify(publishedManifest.rosterIds || []) !== JSON.stringify(manifest.rosterIds || []) || String(publishedManifest.publishedAt || "") !== String(manifest.publishedAt || "")) {
				return incomplete({ reason: "mismatched-published-manifest", versionId: versionId, manifest: manifest });
			}
		}
		const rosterShards = readActiveVersionRosterShards_(versionId, manifest);
		for (let i = 0; i < rosterIds.length; i++) {
			const roster = rosterShards.rosterMap[rosterIds[i]];
			if (!roster || String(roster.id || "").trim() !== rosterIds[i]) {
				return incomplete({ reason: "missing-or-mismatched-roster-shard", versionId: versionId, rosterId: rosterIds[i], manifest: manifest });
			}
		}
		// This final reconstruction applies the production schema validator to the
		// immutable roster and metric shards, without consulting queue diagnostics.
		readActiveRosterSnapshotFromVersion_(versionId);
		return complete({ reason: "canonical-version-complete", versionId: versionId, manifest: manifest });
	} catch (err) {
		const message = errorMessage_(err);
		const transientOrDecode = /Firebase|UrlFetch|quota|timed?\s*out|deadline|transport|response.*JSON|base64|decod|key encoding|token request|network|service unavailable|temporar/i.test(message);
		return transientOrDecode
			? indeterminate({ reason: "canonical-content-read-indeterminate", versionId: versionId, error: message })
			: incomplete({ reason: "canonical-content-validation-failed", versionId: versionId, error: message });
	}
}

function inspectAlreadyPublishedAutoRefreshCanonicalCompletion_(currentRaw) {
	const current = normalizeAutoRefreshQueueCurrent_(currentRaw);
	const runId = current && current.runId;
	if (!runId || readPublishedActiveVersionId_() !== runId) return { status: "positively-incomplete", complete: false, positivelyIncomplete: true, indeterminate: false, reason: "active-version-mismatch" };
	const inspection = inspectActiveVersionCanonicalContents_(runId, { requirePublishedManifest: true });
	try { inspection.sourceMeta = readAutoRefreshRunShard_(runId, "source/meta"); } catch (err) { inspection.sourceMeta = null; }
	return inspection;
}

function recordAlreadyPublishedCanonicalRepairDiagnostic_(currentRaw, inspectionRaw, statusRaw, extraRaw) {
	const current = normalizeAutoRefreshQueueCurrent_(currentRaw);
	const inspection = inspectionRaw && typeof inspectionRaw === "object" ? inspectionRaw : {};
	const status = String(statusRaw || "repair-required");
	const runId = current && current.runId;
	if (!runId) return null;
	const diagnostic = Object.assign({
		runId: runId,
		status: status,
		reason: String(inspection.reason || "canonical-version-incomplete"),
		error: String(inspection.error || "").slice(0, 500),
		sourceVersionId: normalizeActiveVersionId_(current.sourceVersionId),
		updatedAt: new Date().toISOString(),
	}, extraRaw && typeof extraRaw === "object" ? extraRaw : {});
	try {
		firebaseRequestJson_(buildFirebaseChildPath_(FIREBASE_INTERNAL_AUTO_REFRESH_CANONICAL_REPAIRS_PATH, encodeFirebaseObjectKey_(runId)), "PUT", encodeFirebaseObjectKeysRecursive_(diagnostic));
	} catch (err) {}
	if (typeof markRuntimeRecoveryNeeded_ === "function") {
		markRuntimeRecoveryNeeded_("canonical-roster-repair:" + runId, diagnostic.reason, diagnostic);
	}
	return diagnostic;
}

function recoverIncompleteAlreadyPublishedAutoRefreshCanonical_(currentRaw, inspectionRaw) {
	const current = normalizeAutoRefreshQueueCurrent_(currentRaw);
	const inspection = inspectionRaw && typeof inspectionRaw === "object" ? inspectionRaw : {};
	const runId = current && current.runId;
	const diagnostic = recordAlreadyPublishedCanonicalRepairDiagnostic_(current, inspection, "repair-required", {
		repairMode: "fresh-immutable-selector-last",
	});
	return { repaired: false, status: "repair-required", versionId: runId, diagnostic: diagnostic };
}

function readCanonicalRepairMarker_(runIdRaw) {
	const runId = normalizeActiveVersionId_(runIdRaw);
	if (!runId) return null;
	const encoded = firebaseRequestJson_(buildFirebaseChildPath_(FIREBASE_INTERNAL_AUTO_REFRESH_CANONICAL_REPAIRS_PATH, encodeFirebaseObjectKey_(runId)), "GET");
	return encoded && typeof encoded === "object" && !Array.isArray(encoded) ? decodeFirebaseObjectKeysRecursive_(encoded) : null;
}

function deleteCanonicalRepairMarker_(runIdRaw) {
	const runId = normalizeActiveVersionId_(runIdRaw);
	if (!runId) return false;
	firebaseRequestJson_(buildFirebaseChildPath_(FIREBASE_INTERNAL_AUTO_REFRESH_CANONICAL_REPAIRS_PATH, encodeFirebaseObjectKey_(runId)), "DELETE");
	if (typeof clearRuntimeRecoveryNeeded_ === "function") clearRuntimeRecoveryNeeded_("canonical-roster-repair:" + runId);
	return true;
}

function allocateCanonicalRepairVersionId_(runIdRaw) {
	const runId = normalizeActiveVersionId_(runIdRaw);
	if (!runId) throw new Error("Canonical repair run id is required.");
	const path = buildFirebaseChildPath_(FIREBASE_INTERNAL_AUTO_REFRESH_CANONICAL_REPAIRS_PATH, encodeFirebaseObjectKey_(runId));
	for (let attempt = 0; attempt < 3; attempt++) {
		const current = firebaseRequestJsonWithEtag_(path, "GET");
		const marker = current && current.value && typeof current.value === "object" && !Array.isArray(current.value)
			? decodeFirebaseObjectKeysRecursive_(current.value)
			: null;
		if (!marker) return null;
		const existing = normalizeActiveVersionId_(marker.repairVersionId);
		if (existing) return { marker: marker, versionId: existing };
		if (String(marker.status || "") !== "repair-required") return { marker: marker, versionId: "" };
		const versionId = createActiveVersionId_("canonical-repair");
		const next = Object.assign({}, marker, {
			status: "repairing",
			repairVersionId: versionId,
			repairStartedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});
		try {
			firebaseRequestJsonWithEtag_(path, "PUT", encodeFirebaseObjectKeysRecursive_(next), { ifMatch: current.etag });
			return { marker: next, versionId: versionId };
		} catch (err) {
			if (err && err.code === "FIREBASE_ETAG_CONFLICT") continue;
			throw err;
		}
	}
	const conflict = new Error("Canonical repair marker compare-and-swap retries were exhausted.");
	conflict.code = "FIREBASE_ETAG_CONFLICT";
	throw conflict;
}

// Consume one proven-corruption marker through a fresh immutable version.
// The selected version is never modified or rolled back. The fresh version is
// fully written and validated before the Firebase selector changes, and
// Cloudflare publication then follows its normal selector-last queue phases.
function runCanonicalRepairMarker_(runIdRaw) {
	const runId = normalizeActiveVersionId_(runIdRaw);
	if (!runId) return { ok: true, skipped: true, reason: "missing-run-id" };
	let marker = readCanonicalRepairMarker_(runId);
	if (!marker) return { ok: true, skipped: true, reason: "missing-marker", runId: runId };
	const selectedVersionId = readPublishedActiveVersionId_();
	const repairVersionId = normalizeActiveVersionId_(marker.repairVersionId);
	if (repairVersionId && selectedVersionId === repairVersionId) {
		const repairInspection = inspectActiveVersionCanonicalContents_(repairVersionId, { requirePublishedManifest: true });
		if (repairInspection.status === "indeterminate") return { ok: true, deferred: true, reason: "repair-inspection-indeterminate", runId: runId, versionId: repairVersionId };
		if (repairInspection.status !== "complete") return { ok: false, blocked: true, reason: "selected-repair-version-incomplete", runId: runId, versionId: repairVersionId };
		const queued = enqueueCloudflareActiveTarget_(repairVersionId, "canonical-repair-resume");
		if (!queued || queued.ok === false) return { ok: false, deferred: true, reason: "cloudflare-enqueue-failed", runId: runId, versionId: repairVersionId, queueResult: queued || null };
		deleteCanonicalRepairMarker_(runId);
		return { ok: true, repaired: true, idempotent: true, runId: runId, versionId: repairVersionId, queueResult: queued };
	}
	if (selectedVersionId !== runId) {
		deleteCanonicalRepairMarker_(runId);
		return { ok: true, skipped: true, reason: "superseded", runId: runId, selectedVersionId: selectedVersionId };
	}
	const corruptInspection = inspectActiveVersionCanonicalContents_(runId, { requirePublishedManifest: true });
	if (corruptInspection.status === "indeterminate") return { ok: true, deferred: true, reason: "canonical-inspection-indeterminate", runId: runId };
	if (corruptInspection.status === "complete") {
		deleteCanonicalRepairMarker_(runId);
		return { ok: true, skipped: true, reason: "selected-version-complete", runId: runId };
	}
	const sourceVersionId = normalizeActiveVersionId_(marker.sourceVersionId);
	if (!sourceVersionId || sourceVersionId === runId) return { ok: false, blocked: true, reason: "missing-known-good-source", runId: runId };
	const sourceInspection = inspectActiveVersionCanonicalContents_(sourceVersionId, { requirePublishedManifest: false });
	if (sourceInspection.status === "indeterminate") return { ok: true, deferred: true, reason: "source-inspection-indeterminate", runId: runId, sourceVersionId: sourceVersionId };
	if (sourceInspection.status !== "complete") return { ok: false, blocked: true, reason: "source-version-incomplete", runId: runId, sourceVersionId: sourceVersionId };
	const allocation = allocateCanonicalRepairVersionId_(runId);
	if (!allocation || !allocation.versionId) return { ok: true, deferred: true, reason: "repair-allocation-unavailable", runId: runId };
	marker = allocation.marker;
	const freshVersionId = allocation.versionId;
	const sourceSnapshot = readActiveRosterSnapshotFromVersion_(sourceVersionId);
	const written = writeActiveRosterVersionShards_(freshVersionId, sourceSnapshot.rosterData, {
		source: "canonical-repair",
		sourceVersionId: sourceVersionId,
		publishedAt: new Date().toISOString(),
		publish: false,
	});
	const freshInspection = inspectActiveVersionCanonicalContents_(freshVersionId, { requirePublishedManifest: false });
	if (freshInspection.status !== "complete") {
		return freshInspection.status === "indeterminate"
			? { ok: true, deferred: true, reason: "fresh-version-inspection-indeterminate", runId: runId, versionId: freshVersionId }
			: { ok: false, blocked: true, reason: "fresh-version-incomplete", runId: runId, versionId: freshVersionId };
	}
	if (readPublishedActiveVersionId_() !== runId) return { ok: true, skipped: true, reason: "selector-superseded-before-commit", runId: runId, versionId: freshVersionId };
	publishActiveRosterVersionPointer_(freshVersionId, written.manifest);
	clearActiveRosterDataCache_();
	marker = Object.assign({}, marker, { status: "selector-committed", selectorCommittedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
	firebaseRequestJson_(buildFirebaseChildPath_(FIREBASE_INTERNAL_AUTO_REFRESH_CANONICAL_REPAIRS_PATH, encodeFirebaseObjectKey_(runId)), "PUT", encodeFirebaseObjectKeysRecursive_(marker));
	const queued = enqueueCloudflareActiveTarget_(freshVersionId, "canonical-repair");
	if (!queued || queued.ok === false) return { ok: false, deferred: true, reason: "cloudflare-enqueue-failed", runId: runId, versionId: freshVersionId, queueResult: queued || null };
	deleteCanonicalRepairMarker_(runId);
	return { ok: true, repaired: true, idempotent: false, runId: runId, sourceVersionId: sourceVersionId, versionId: freshVersionId, queueResult: queued };
}

function runOneCanonicalRepairMarker_() {
	const keys = listFirebaseChildKeys_(FIREBASE_INTERNAL_AUTO_REFRESH_CANONICAL_REPAIRS_PATH).slice().sort();
	if (!keys.length) return { ok: true, skipped: true, reason: "no-canonical-repair-marker" };
	let runId = String(keys[0] || "");
	try { runId = decodeFirebaseObjectKey_(runId); } catch (err) {}
	return runCanonicalRepairMarker_(runId);
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
		let sourceMetaForCwl = null;
		let canonicalInspection = null;
		const sourceMetaReadStartMs = Date.now();
		try {
			canonicalInspection = inspectAlreadyPublishedAutoRefreshCanonicalCompletion_(current);
			sourceMetaForCwl = canonicalInspection.sourceMeta || null;
			Logger.log(
				"autoRefresh already-published canonical inspection runId=%s complete=%s reason=%s durationMs=%s",
				runId,
				canonicalInspection.complete === true,
				String(canonicalInspection.reason || ""),
				Math.max(0, Date.now() - sourceMetaReadStartMs),
			);
		} catch (err) {
			Logger.log(
				"autoRefresh already-published source meta read runId=%s ok=false durationMs=%s error=%s",
				runId,
				Math.max(0, Date.now() - sourceMetaReadStartMs),
				errorMessage_(err),
			);
			canonicalInspection = { complete: false, reason: "canonical-inspection-failed", error: errorMessage_(err) };
		}
		if (canonicalInspection && canonicalInspection.status === "indeterminate") {
			Logger.log(
				"autoRefresh canonical inspection deferred runId=%s status=indeterminate reason=%s error=%s",
				runId,
				String(canonicalInspection.reason || ""),
				String(canonicalInspection.error || ""),
			);
			return {
				ok: true,
				deferred: true,
				reason: "canonical-inspection-indeterminate",
				error: String(canonicalInspection.error || canonicalInspection.reason || ""),
				runId: runId,
				skipPostTickMirrorRepair: true,
			};
		}
		if (!canonicalInspection || canonicalInspection.status === "positively-incomplete" || canonicalInspection.complete !== true) {
			const repair = recoverIncompleteAlreadyPublishedAutoRefreshCanonical_(current, canonicalInspection);
			const repairedVersionId = normalizeActiveVersionId_(repair && repair.versionId);
			let cloudflareRepair = null;
			if (repair && repair.repaired === true && repairedVersionId) {
				try { cloudflareRepair = ensureAutoRefreshCloudflarePublicDataPublished_(Object.assign({}, current, { runId: repairedVersionId }), "auto-refresh-canonical-selector-recovery"); } catch (err) {
					cloudflareRepair = { ok: false, repairPending: true, error: errorMessage_(err) };
				}
			}
			const summary = "The selected auto-refresh version is positively incomplete and requires fresh immutable canonical repair; the old queue was terminalized without changing the selector.";
			current.status = "failed";
			current.phase = "terminal-canonical-repair";
			current.completedAt = new Date().toISOString();
			current.error = String((canonicalInspection && (canonicalInspection.reason || canonicalInspection.error)) || "canonical-version-incomplete");
			current.cloudflarePublicDataPublish = cloudflareRepair && cloudflareRepair.summary ? cloudflareRepair.summary : null;
			setAutoRefreshRunResult_(current.status, summary, current.error, current.issueCount, current.issueSummary, current.startedAt, current.completedAt);
			archiveAndClearAutoRefreshQueueStateBestEffort_(current, current.status, summary, current.error, "autoRefresh incomplete selected-version cleanup");
			return {
				ok: repair && repair.repaired === true,
				status: current.status,
				terminal: true,
				canonicalRepair: sanitizeAutoRefreshDiagnosticFragment_(repair, 3),
				cloudflarePublicDataPublish: sanitizeAutoRefreshDiagnosticFragment_(cloudflareRepair, 2),
				summary: summary,
				runId: runId,
				skipPostTickMirrorRepair: true,
			};
		}
		const summary = "Auto-refresh version was already published; completed required final CWL and Cloudflare phases.";
		const finalPhases = runAutoRefreshRequiredFinalPhases_(current, sourceMetaForCwl, summary, executionStartMsRaw, {
			cloudflareLabel: "auto-refresh-finalize-already-published",
		});
		current.status = "completed";
		current.phase = "completed";
		current.completedAt = new Date().toISOString();
		current.processedTasks = current.taskCount;
		current.cwlFinalCoordinatorCapture = finalPhases && finalPhases.cwlFinalCoordinatorCapture ? finalPhases.cwlFinalCoordinatorCapture : current.cwlFinalCoordinatorCapture;
		current.cwlSeasonEventRefresh = finalPhases && finalPhases.cwlSeasonEventRefresh ? finalPhases.cwlSeasonEventRefresh : current.cwlSeasonEventRefresh;
		current.cwlFinalOutcome = finalPhases && finalPhases.cwlFinalOutcome ? finalPhases.cwlFinalOutcome : current.cwlFinalOutcome;
		current.cloudflarePublicDataPublish =
			finalPhases && finalPhases.cloudflarePublicDataPublish && finalPhases.cloudflarePublicDataPublish.summary
				? finalPhases.cloudflarePublicDataPublish.summary
				: current.cloudflarePublicDataPublish;
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
		return {
			ok: true,
			status: "completed",
			summary: summary,
			alreadyPublished: true,
			runId: runId,
			processedRosters: current.processedRosters,
			issueCount: current.issueCount,
			finalPhases: sanitizeAutoRefreshDiagnosticFragment_(finalPhases, 3),
			skipPostTickMirrorRepair: true,
		};
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
	const sourceMeta = readAutoRefreshRunShard_(runId, "source/meta");
	if (!sourceMeta || typeof sourceMeta !== "object") throw new Error("Auto-refresh source metadata is missing.");
	const stagedMetricsMode = String(sourceMeta.metricResultMode || "") === "activeVersionPatches";
	let currentSourceSnapshot = null;
	let sourceReadMs = 0;
	let currentSourceFingerprint = "";
	let fingerprintMs = 0;
	let sourceMatches = false;
	const sourceVersionId = normalizeActiveVersionId_(current.sourceVersionId);
	if (sourceVersionId) {
		const sourceReadStartMs = Date.now();
		const currentVersionId = readPublishedActiveVersionId_();
		sourceReadMs = Math.max(0, Date.now() - sourceReadStartMs);
		currentSourceFingerprint = currentVersionId === sourceVersionId ? String(current.sourceFingerprint || "") : "version:" + currentVersionId;
		sourceMatches = currentVersionId === sourceVersionId;
	} else {
		const sourceReadStartMs = Date.now();
		currentSourceSnapshot = readActiveRosterSnapshot_();
		sourceReadMs = Math.max(0, Date.now() - sourceReadStartMs);
		const fingerprintStartMs = Date.now();
		currentSourceFingerprint = buildActiveRosterSourceFingerprintValidated_(currentSourceSnapshot && currentSourceSnapshot.rosterData);
		fingerprintMs = Math.max(0, Date.now() - fingerprintStartMs);
		sourceMatches = currentSourceFingerprint === String(current.sourceFingerprint || "");
	}
	Logger.log(
		"autoRefresh finalize source guard runId=%s sourceMatches=%s jobFingerprint=%s currentFingerprint=%s sourceReadMs=%s fingerprintMs=%s sourceVersionId=%s",
		runId,
		sourceMatches,
		String(current.sourceFingerprint || "").slice(0, 12),
		currentSourceFingerprint.slice(0, 12),
		sourceReadMs,
		fingerprintMs,
		sourceVersionId,
	);
	if (!sourceMatches) {
		const summary = "Auto-refresh job became stale because active data changed while it was running; no active version was published.";
		current.status = "stale";
		current.completedAt = new Date().toISOString();
		current.error = summary;
		setAutoRefreshRunResult_("stale", summary, "", current.issueCount, current.issueSummary, current.startedAt, new Date().toISOString());
		if (currentSourceSnapshot && currentSourceSnapshot.rosterData) {
			tryReconcileRegularWarFinalizationTriggerStateValidated_(currentSourceSnapshot.rosterData);
		}
		archiveAndClearAutoRefreshQueueStateBestEffort_(current, "stale", summary, summary, "autoRefresh queue stale cleanup");
		return { ok: true, status: "stale", stale: true, summary: summary, processedRosters: current.processedRosters, issueCount: current.issueCount };
	}
	if (stagedMetricsMode) {
		verifyAutoRefreshMetricCopyTasksComplete_(runId, current.taskIds);
		const verifiedResults = verifyAutoRefreshFinalizeResultMarkers_(runId, rosterIds, { includeActiveRosters: false });
		if (!assertAutoRefreshRosterWriteTagsUnique_(verifiedResults.rosterWriteByRosterId, rosterIds)) {
			assertAutoRefreshActiveRosterShardTagsUnique_(runId, rosterIds);
		}
		const writeStartMs = Date.now();
		const writtenAt = new Date().toISOString();
		const playerMetricEntryCount = countActiveVersionPlayerMetricEntriesShallow_(runId);
		const manifest = buildAutoRefreshActiveVersionManifestFromSourceMeta_(runId, sourceMeta, rosterIds, {
			source: ACTIVE_DATA_WRITE_SOURCE_AUTO_REFRESH,
			runId: runId,
			publishedAt: writtenAt,
			lastUpdatedAt: writtenAt,
			playerMetricEntryCount: playerMetricEntryCount,
			sourceFingerprint: current.sourceFingerprint,
		});
		firebaseBatchPutJson_([
			{
				path: buildActiveVersionPath_(runId, "playerMetrics/schemaVersion"),
				method: "PUT",
				payload: PLAYER_METRICS_SCHEMA_VERSION,
			},
			{
				path: buildActiveVersionPath_(runId, "playerMetrics/updatedAt"),
				method: "PUT",
				payload: writtenAt,
			},
			{
				path: buildActiveVersionPath_(runId, "manifest"),
				method: "PUT",
				payload: encodeFirebaseObjectKeysRecursive_(manifest),
			},
		], { disableFallback: true });
		publishActiveRosterVersionPointer_(runId, manifest);
		clearActiveRosterDataCache_();
		markActiveDataWriteSuccess_(writtenAt, ACTIVE_DATA_WRITE_SOURCE_AUTO_REFRESH);
		const cleanupResult = maybeCleanupOldAutoRefreshDailyArchives_(getServerDateString_(new Date()));
		const archiveCleanupDeleted = toNonNegativeInt_(cleanupResult && cleanupResult.deletedCount);
		firebaseRequestJson_(FIREBASE_META_PATH, "PATCH", {
			layoutVersion: FIREBASE_LAYOUT_VERSION,
			lastAutoRefreshWriteAt: writtenAt,
			lastAutoRefreshVersionId: runId,
			lastAutoRefreshArchiveCleanupDeleted: archiveCleanupDeleted,
		});
		const writeMs = Math.max(0, Date.now() - writeStartMs);
		const runResult = {
			processedRosters: current.processedRosters,
			rostersWithIssues: current.issueCount > 0 ? 1 : 0,
			issueCount: current.issueCount,
			issueSummary: current.issueSummary,
			issues: [],
		};
		const writeResult = {
			changed: true,
			written: true,
			writtenAt: writtenAt,
			versionPublished: true,
			versionId: runId,
			rosterCount: rosterIds.length,
			playerCount: toNonNegativeInt_(sourceMeta.sourcePlayerCount),
			noteCount: toNonNegativeInt_(sourceMeta.sourceNoteCount),
			archiveCreated: false,
			archiveDate: "",
			archiveCleanupDeleted: archiveCleanupDeleted,
		};
		const summary = buildAutoRefreshFinalSummary_(runResult, writeResult);
		const finalPhases = runAutoRefreshRequiredFinalPhases_(current, sourceMeta, summary, executionStartMsRaw, {
			cloudflareLabel: "auto-refresh-finalize-staged",
		});
		current.cwlFinalCoordinatorCapture = finalPhases && finalPhases.cwlFinalCoordinatorCapture ? finalPhases.cwlFinalCoordinatorCapture : current.cwlFinalCoordinatorCapture;
		current.cwlSeasonEventRefresh = finalPhases && finalPhases.cwlSeasonEventRefresh ? finalPhases.cwlSeasonEventRefresh : current.cwlSeasonEventRefresh;
		current.cwlFinalOutcome = finalPhases && finalPhases.cwlFinalOutcome ? finalPhases.cwlFinalOutcome : current.cwlFinalOutcome;
		current.cloudflarePublicDataPublish =
			finalPhases && finalPhases.cloudflarePublicDataPublish && finalPhases.cloudflarePublicDataPublish.summary
				? finalPhases.cloudflarePublicDataPublish.summary
				: current.cloudflarePublicDataPublish;
		setAutoRefreshRunResult_("ok", summary, "", current.issueCount, current.issueSummary, current.startedAt, new Date().toISOString());
		current.status = "completed";
		current.phase = "completed";
		current.completedAt = new Date().toISOString();
		current.processedTasks = current.taskCount;
		Logger.log(
			"autoRefresh worker task timing runId=%s taskId=%s rosterId=%s phase=%s fetchMs=%s processMs=%s writeMs=%s totalMs=%s remainingMs=%s changed=%s stagedMetrics=true metricEntries=%s",
			runId,
			String(task.taskId || ""),
			"",
			"finalize",
			sourceReadMs,
			fingerprintMs,
			writeMs,
			Math.max(0, Date.now() - finalizeStartMs),
			getAutoRefreshJobRemainingMs_(executionStartMsRaw),
			true,
			playerMetricEntryCount,
		);
		archiveAndClearAutoRefreshQueueStateBestEffort_(current, "completed", summary, "", "autoRefresh queue completed cleanup");
		return { ok: true, status: "completed", summary: summary, changed: true, processedRosters: current.processedRosters, issueCount: current.issueCount, skipPostTickMirrorRepair: true };
	}
	const verifiedResults = verifyAutoRefreshFinalizeResultMarkers_(runId, rosterIds, { includeActiveRosters: true });
	const activeRosterById = verifiedResults.activeRosterById;
	const metricResultByRosterId = verifiedResults.metricResultByRosterId;
	const writeStartMs = Date.now();
	const writtenAt = new Date().toISOString();
	let finalRosterData = buildAutoRefreshFinalRosterDataFromShards_(runId, rosterIds, writtenAt, {
		activeRosterById: activeRosterById,
		metricResultByRosterId: metricResultByRosterId,
		sourceMeta: sourceMeta,
		sourceVersionId: sourceVersionId,
	});
	const sourceRosterData = currentSourceSnapshot && currentSourceSnapshot.rosterData ? currentSourceSnapshot.rosterData : null;
	const changed = sourceRosterData ? hasActiveRosterPayloadChangedValidated_(sourceRosterData, finalRosterData) : true;
	let archiveCreated = false;
	let archiveDate = "";
	let archiveCleanupDeleted = 0;
	if (changed) {
		const discordCanonicalized = canonicalizeDiscordIdentityForRosterData_(finalRosterData, {
			sourceRosterData: sourceRosterData,
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
	tryReconcileRegularWarFinalizationTriggerStateValidated_(finalRosterData);
	const finalPhases = runAutoRefreshRequiredFinalPhases_(current, sourceMeta, summary, executionStartMsRaw, {
		rosterData: finalRosterData,
		cloudflareLabel: "auto-refresh-finalize",
	});
	current.cwlFinalCoordinatorCapture = finalPhases && finalPhases.cwlFinalCoordinatorCapture ? finalPhases.cwlFinalCoordinatorCapture : current.cwlFinalCoordinatorCapture;
	current.cwlSeasonEventRefresh = finalPhases && finalPhases.cwlSeasonEventRefresh ? finalPhases.cwlSeasonEventRefresh : current.cwlSeasonEventRefresh;
	current.cwlFinalOutcome = finalPhases && finalPhases.cwlFinalOutcome ? finalPhases.cwlFinalOutcome : current.cwlFinalOutcome;
	current.cloudflarePublicDataPublish =
		finalPhases && finalPhases.cloudflarePublicDataPublish && finalPhases.cloudflarePublicDataPublish.summary
			? finalPhases.cloudflarePublicDataPublish.summary
			: current.cloudflarePublicDataPublish;
	setAutoRefreshRunResult_("ok", summary, "", current.issueCount, current.issueSummary, current.startedAt, new Date().toISOString());
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
	return { ok: true, status: "completed", summary: summary, changed: changed, processedRosters: current.processedRosters, issueCount: current.issueCount, skipPostTickMirrorRepair: true };
}

// Continue one queue worker execution. Consecutive tasks are safe to process
// here because each task is checkpointed as completed before the next task is
// started; the existing phase reserves still decide whether another task may begin.
function continueAutoRefreshQueueWorker_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const executionStartMs = Math.max(0, Number(options.executionStartMs) || Date.now());
	const workerStats = { tasksCompleted: 0, exitReason: "" };
	let result = null;
	try {
		result = withActiveRosterJobLock_("auto-refresh-worker", 0, function () {
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
		let watchdogEnsured = false;
		for (;;) {
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
			let hasFinalizeTask = false;
			for (let i = 0; i < current.taskIds.length; i++) {
				const existingTask = readAutoRefreshTask_(current.runId, current.taskIds[i]);
				if (existingTask && String(existingTask.type || "") === "finalize") {
					hasFinalizeTask = true;
					break;
				}
			}
			if (!hasFinalizeTask || current.status === "finalizing" || readPublishedActiveVersionId_() === current.runId) {
				if (!watchdogEnsured) {
					scheduleAutoRefreshJobWatchdog_();
					watchdogEnsured = true;
				}
				const syntheticTask = {
					taskId: buildAutoRefreshTaskId_(current.taskIds.length, "finalize", ""),
					runId: current.runId,
					type: "finalize",
					status: "running",
					rosterId: "",
					index: current.taskIds.length,
					attempts: 1,
					startedAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					completedAt: "",
					error: "",
					summary: "synthetic-finalize",
				};
				const finalResult = executeAutoRefreshFinalizeTask_(current, syntheticTask, executionStartMs);
				if (finalResult && finalResult.deferred) {
					scheduleAutoRefreshJobResume_();
					return { ok: true, status: "inProgress", inProgress: true, reason: finalResult.reason, processedRosters: current.processedRosters, totalRosters: current.rosterIds.length };
				}
				if (finalResult && (finalResult.status === "completed" || finalResult.status === "stale")) workerStats.tasksCompleted++;
				return finalResult;
			}
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
		if (!watchdogEnsured) {
			scheduleAutoRefreshJobWatchdog_();
			watchdogEnsured = true;
		}
		if (workerStats.tasksCompleted > 0 && (String(task.type || "") === "cwlCoordinator" || String(task.type || "") === "cwlFinalCoordinator")) {
			setAutoRefreshQueueInProgressResult_(current);
			scheduleAutoRefreshJobResume_();
			return { ok: true, status: "inProgress", inProgress: true, reason: "cwlBoundary", processedRosters: current.processedRosters, totalRosters: current.rosterIds.length };
		}
		const nowIso = new Date().toISOString();
		const status = String(task.status || "pending");
		const taskType = String(task.type || "");
		const isPersistedCwlSideTask = taskType === "cwlCoordinator" || taskType === "cwlFinalCoordinator";
		if (isPersistedCwlSideTask && !hasAutoRefreshJobBudgetFor_(executionStartMs, AUTO_REFRESH_QUEUE_CWL_SIDE_TASK_START_RESERVE_MS)) {
			setAutoRefreshQueueInProgressResult_(current);
			scheduleAutoRefreshJobResume_();
			return {
				ok: true,
				status: "inProgress",
				inProgress: true,
				reason: "beforeCwlSideTaskBudget",
				processedRosters: current.processedRosters,
				totalRosters: current.rosterIds.length,
			};
		}
		const updatedMs = parseIsoToMs_(task.updatedAt);
		if (status === "running" && updatedMs > 0 && Date.now() - updatedMs < AUTO_REFRESH_QUEUE_TASK_STALE_MS) {
			if (isPersistedCwlSideTask) {
				task.status = "completed";
				task.completedAt = nowIso;
				task.sidePhaseTerminal = true;
				task.summary = "side-phase-running-preserved";
				writeAutoRefreshTask_(current.runId, task);
				current.cwlFinalOutcome = recordAutoRefreshCwlFinalOutcomeRecovery_(current.runId, buildAutoRefreshCwlFinalOutcome_({ ok: false, status: "deferred", reason: "side-phase-running" }, null));
				markAutoRefreshCwlSideTaskTerminal_(current, task);
				current.currentTaskIndex = Math.max(current.currentTaskIndex, toNonNegativeInt_(task.index) + 1);
				current.processedTasks = Math.max(current.processedTasks, current.currentTaskIndex);
				writeAutoRefreshQueueCurrent_(current, false);
				workerStats.tasksCompleted++;
				continue;
			}
			scheduleAutoRefreshJobResume_();
			return { ok: true, status: "inProgress", inProgress: true, reason: "taskRunning", processedRosters: current.processedRosters, totalRosters: current.rosterIds.length };
		}
		let cwlPreflight = null;
		try {
			cwlPreflight = runAutoRefreshCwlCoordinatorPreflightBeforeRoster_(current, task, executionStartMs);
		} catch (err) {
			cwlPreflight = { deferred: true, reason: "cwlCoordinatorPreflightFailed", result: { ok: false, status: err && err.autoRefreshDefer ? "deferred" : "error", error: errorMessage_(err) } };
		}
		if (cwlPreflight && cwlPreflight.deferred) {
			current.cwlFinalOutcome = recordAutoRefreshCwlFinalOutcomeRecovery_(current.runId, buildAutoRefreshCwlFinalOutcome_(cwlPreflight.result, null));
		}
		if (cwlPreflight && cwlPreflight.captured) {
			current.phase = "cwl-coordinator";
			current.updatedAt = new Date().toISOString();
			current.taskSummary = {
				taskId: "synthetic-cwlCoordinator-before-" + String(task.taskId || ""),
				type: "cwlCoordinator",
				rosterId: "",
				completedAt: current.updatedAt,
				summary: "captured-before-roster",
			};
			writeAutoRefreshQueueCurrent_(current, false);
		}
		let finalCwlPreflight = null;
		try {
			finalCwlPreflight = runAutoRefreshFinalCwlCoordinatorPreflightBeforeFinalize_(current, task, executionStartMs);
		} catch (err) {
			finalCwlPreflight = { deferred: true, reason: "finalCwlCoordinatorPreflightFailed", result: { ok: false, status: err && err.autoRefreshDefer ? "deferred" : "error", error: errorMessage_(err) } };
		}
		if (finalCwlPreflight && finalCwlPreflight.deferred) {
			current.status = "finalizing";
			current.phase = "cwl-final-coordinator";
			current.cwlFinalCoordinatorCapture = summarizeAutoRefreshFinalCwlCoordinatorCapture_(finalCwlPreflight.result);
			current.cwlFinalOutcome = recordAutoRefreshCwlFinalOutcomeRecovery_(current.runId, buildAutoRefreshCwlFinalOutcome_(finalCwlPreflight.result, null));
			current.updatedAt = new Date().toISOString();
			writeAutoRefreshQueueCurrent_(current, false);
		}
		if (finalCwlPreflight && finalCwlPreflight.captured) {
			current.status = "finalizing";
			current.phase = "cwl-final-coordinator";
			current.updatedAt = new Date().toISOString();
			current.cwlFinalCoordinatorCapture = summarizeAutoRefreshFinalCwlCoordinatorCapture_(finalCwlPreflight.result);
			current.taskSummary = {
				taskId: "synthetic-cwlFinalCoordinator-before-" + String(task.taskId || ""),
				type: "cwlFinalCoordinator",
				rosterId: "",
				completedAt: current.updatedAt,
				summary: "captured-before-finalize",
			};
			writeAutoRefreshQueueCurrent_(current, false);
		}
		const postCwlPreflightReserveMs = taskType === "finalize"
			? AUTO_REFRESH_QUEUE_FINALIZE_RESERVE_MS
			: taskType === "roster"
				? AUTO_REFRESH_QUEUE_ROSTER_PROCESS_RESERVE_MS
				: 0;
		if ((cwlPreflight || finalCwlPreflight) && postCwlPreflightReserveMs > 0 && !hasAutoRefreshJobBudgetFor_(executionStartMs, postCwlPreflightReserveMs)) {
			setAutoRefreshQueueInProgressResult_(current);
			scheduleAutoRefreshJobResume_();
			return {
				ok: true,
				status: "inProgress",
				inProgress: true,
				reason: "afterCwlPreflightBudget",
				processedRosters: current.processedRosters,
				totalRosters: current.rosterIds.length,
			};
		}
		task.status = "running";
		task.startedAt = task.startedAt || nowIso;
		task.updatedAt = nowIso;
		task.attempts = toNonNegativeInt_(task.attempts) + 1;
		task.error = "";
		try {
			writeAutoRefreshTask_(current.runId, task);
		} catch (err) {
			if (isFirebaseDailyUrlFetchQuotaError_(err)) return buildAutoRefreshUrlFetchQuotaPauseResult_(current);
			throw err;
		}
		current.phase = task.type === "finalize" ? "finalizing" : task.type === "cwlFinalCoordinator" ? "cwl-final-coordinator" : task.type === "cwlCoordinator" ? "cwl-coordinator" : "processing";
		current.status = task.type === "finalize" ? "finalizing" : "running";
		current.taskSummary = {
			taskId: task.taskId,
			type: task.type,
			rosterId: String(task.rosterId || ""),
			startedAt: nowIso,
			attempts: task.attempts,
		};
		try {
			writeAutoRefreshQueueCurrent_(current, false);
		} catch (err) {
			if (isFirebaseDailyUrlFetchQuotaError_(err)) return buildAutoRefreshUrlFetchQuotaPauseResult_(current);
			throw err;
		}
		let result = null;
		const isCwlSideTask = task.type === "cwlCoordinator" || task.type === "cwlFinalCoordinator";
		try {
			result = task.type === "finalize"
				? executeAutoRefreshFinalizeTask_(current, task, executionStartMs)
				: task.type === "metricCopy"
					? executeAutoRefreshMetricCopyTask_(current, task, executionStartMs)
					: isPersistedCwlSideTask
						? executeAutoRefreshCwlSideTaskWithBudget_(current, task, executionStartMs)
						: executeAutoRefreshRosterTask_(current, task, executionStartMs);
			if (result && result.deferred) {
				if (isCwlSideTask) {
					task.status = "completed";
					task.completedAt = new Date().toISOString();
					task.sidePhaseTerminal = true;
					task.summary = "side-phase-" + String(result.reason || "deferred");
					writeAutoRefreshTask_(current.runId, task);
					current.cwlFinalOutcome = recordAutoRefreshCwlFinalOutcomeRecovery_(current.runId, buildAutoRefreshCwlFinalOutcome_(result, null));
					markAutoRefreshCwlSideTaskTerminal_(current, task);
					current.currentTaskIndex = Math.max(current.currentTaskIndex, toNonNegativeInt_(task.index) + 1);
					current.processedTasks = Math.max(current.processedTasks, current.currentTaskIndex);
					writeAutoRefreshQueueCurrent_(current, false);
					workerStats.tasksCompleted++;
					continue;
				}
				if (isFirebaseDailyUrlFetchQuotaError_(result.error)) return buildAutoRefreshUrlFetchQuotaPauseResult_(current);
				task.status = "pending";
				task.summary = String(result.reason || "deferred");
				writeAutoRefreshTask_(current.runId, task);
				scheduleAutoRefreshJobResume_();
				return { ok: true, status: "inProgress", inProgress: true, reason: result.reason, processedRosters: current.processedRosters, totalRosters: current.rosterIds.length };
			}
			if (result && (result.status === "completed" || result.status === "stale")) {
				workerStats.tasksCompleted++;
				return result;
			}
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
			workerStats.tasksCompleted++;
			continue;
		} catch (err) {
			if (isCwlSideTask) {
				task.status = "completed";
				task.completedAt = new Date().toISOString();
				task.sidePhaseTerminal = true;
				task.error = errorMessage_(err);
				task.summary = "side-phase-failed";
				writeAutoRefreshTask_(current.runId, task);
				current.cwlFinalOutcome = recordAutoRefreshCwlFinalOutcomeRecovery_(current.runId, buildAutoRefreshCwlFinalOutcome_({ ok: false, status: err && err.autoRefreshDefer ? "deferred" : "error", reason: err && err.reason, error: errorMessage_(err) }, null));
				markAutoRefreshCwlSideTaskTerminal_(current, task);
				current.currentTaskIndex = Math.max(current.currentTaskIndex, toNonNegativeInt_(task.index) + 1);
				current.processedTasks = Math.max(current.processedTasks, current.currentTaskIndex);
				writeAutoRefreshQueueCurrent_(current, false);
				workerStats.tasksCompleted++;
				continue;
			}
			if (isFirebaseDailyUrlFetchQuotaError_(err)) return buildAutoRefreshUrlFetchQuotaPauseResult_(current);
			if (err && err.autoRefreshDefer) {
				const message = errorMessage_(err);
				task.status = "pending";
				task.error = message;
				task.summary = String(err.reason || "deferred");
				task.updatedAt = new Date().toISOString();
				writeAutoRefreshTask_(current.runId, task);
				current.error = message;
				current.updatedAt = new Date().toISOString();
				writeAutoRefreshQueueCurrent_(current, false);
				scheduleAutoRefreshJobResume_();
				return {
					ok: true,
					status: "inProgress",
					inProgress: true,
					reason: String(err.reason || "autoRefreshDefer"),
					processedRosters: current.processedRosters,
					totalRosters: current.rosterIds.length,
				};
			}
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
		}
		});
	} catch (err) {
		workerStats.exitReason = "failed";
		throw err;
	}
	const elapsedMs = getAutoRefreshJobElapsedMs_(executionStartMs);
	const enriched = Object.assign({}, result || {}, {
		tasksCompleted: workerStats.tasksCompleted,
		elapsedMs: elapsedMs,
		remainingMs: getAutoRefreshJobRemainingMs_(executionStartMs),
		exitReason: workerStats.exitReason || String((result && (result.reason || result.status)) || ""),
	});
	Logger.log(
		"autoRefresh queue worker progress tasksCompleted=%s elapsedMs=%s remainingMs=%s exitReason=%s",
		enriched.tasksCompleted,
		enriched.elapsedMs,
		enriched.remainingMs,
		String(enriched.exitReason || ""),
	);
	return enriched;
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
	let remainingMs = Math.max(0, AUTO_REFRESH_JOB_EXECUTION_BUDGET_MS - getAutoRefreshJobElapsedMs_(executionStartMsRaw));
	if (typeof getExecutionRemainingMs_ === "function") {
		const propagatedRemainingMs = getExecutionRemainingMs_();
		if (isFinite(propagatedRemainingMs)) {
			const cleanupReserveMs = typeof getExecutionCleanupReserveMs_ === "function" ? getExecutionCleanupReserveMs_() : 0;
			remainingMs = Math.min(remainingMs, Math.max(0, propagatedRemainingMs - cleanupReserveMs));
		}
	}
	return remainingMs;
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

function readAutoRefreshSchedulerRepairMarker_() {
	try {
		const raw = String(PropertiesService.getScriptProperties().getProperty(AUTO_REFRESH_SCHEDULER_REPAIR_MARKER_PROPERTY) || "").trim();
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return null;
		if (!parsed.kinds || typeof parsed.kinds !== "object") {
			const legacyKind = String(parsed.kind || "continuation");
			parsed.kinds = {};
			parsed.kinds[legacyKind] = Object.assign({}, parsed);
		}
		return parsed;
	} catch (err) {
		return null;
	}
}

function markAutoRefreshSchedulerRepairNeeded_(kindRaw, reasonRaw, notBeforeMsRaw) {
	const kind = String(kindRaw || "continuation");
	const detail = {
		pending: true,
		kind: kind,
		reason: String(reasonRaw || "dynamic-trigger-unavailable").slice(0, 300),
		notBeforeMs: Math.max(0, Number(notBeforeMsRaw) || 0),
		updatedAt: new Date().toISOString(),
	};
	try {
		const marker = readAutoRefreshSchedulerRepairMarker_() || { pending: true, kinds: {} };
		marker.pending = true;
		marker.kind = kind;
		marker.reason = detail.reason;
		marker.notBeforeMs = detail.notBeforeMs;
		marker.updatedAt = detail.updatedAt;
		marker.kinds[kind] = detail;
		PropertiesService.getScriptProperties().setProperty(AUTO_REFRESH_SCHEDULER_REPAIR_MARKER_PROPERTY, JSON.stringify(marker));
		if (typeof markRuntimeRecoveryNeeded_ === "function") markRuntimeRecoveryNeeded_("autoRefresh", detail.reason, marker);
	} catch (err) {}
	return detail;
}

function clearAutoRefreshSchedulerRepairMarker_(kindRaw) {
	try {
		const props = PropertiesService.getScriptProperties();
		const kind = String(kindRaw || "").trim();
		const marker = readAutoRefreshSchedulerRepairMarker_();
		if (kind && marker && marker.kinds && typeof marker.kinds === "object") {
			delete marker.kinds[kind];
			const remainingKinds = Object.keys(marker.kinds);
			if (remainingKinds.length) {
				const latest = marker.kinds[remainingKinds[remainingKinds.length - 1]] || {};
				marker.kind = String(latest.kind || remainingKinds[remainingKinds.length - 1]);
				marker.reason = String(latest.reason || "scheduler-repair-pending");
				marker.notBeforeMs = Math.max(0, Number(latest.notBeforeMs) || 0);
				marker.updatedAt = String(latest.updatedAt || new Date().toISOString());
				props.setProperty(AUTO_REFRESH_SCHEDULER_REPAIR_MARKER_PROPERTY, JSON.stringify(marker));
				return true;
			}
		}
		props.deleteProperty(AUTO_REFRESH_SCHEDULER_REPAIR_MARKER_PROPERTY);
		if (typeof clearRuntimeRecoveryNeeded_ === "function") clearRuntimeRecoveryNeeded_("autoRefresh");
		return true;
	} catch (err) {
		return false;
	}
}

function getAutoRefreshDynamicTriggerProperties_(kindRaw) {
	const kind = String(kindRaw || "continuation") === "watchdog" ? "watchdog" : "continuation";
	return kind === "watchdog"
		? { kind: kind, idProperty: AUTO_REFRESH_JOB_WATCHDOG_TRIGGER_ID_PROPERTY, atProperty: AUTO_REFRESH_JOB_WATCHDOG_TRIGGER_AT_PROPERTY }
		: { kind: kind, idProperty: AUTO_REFRESH_JOB_TRIGGER_ID_PROPERTY, atProperty: AUTO_REFRESH_JOB_TRIGGER_AT_PROPERTY };
}

function findAutoRefreshTriggerById_(triggersRaw, triggerIdRaw) {
	const triggers = Array.isArray(triggersRaw) ? triggersRaw : [];
	const triggerId = String(triggerIdRaw || "").trim();
	if (!triggerId) return null;
	for (let i = 0; i < triggers.length; i++) if (getTriggerUniqueId_(triggers[i]) === triggerId) return triggers[i];
	return null;
}

function clearAutoRefreshDynamicTriggerProperties_(kindRaw) {
	const meta = getAutoRefreshDynamicTriggerProperties_(kindRaw);
	const props = PropertiesService.getScriptProperties();
	props.deleteProperty(meta.idProperty);
	props.deleteProperty(meta.atProperty);
}

// Consume only the one-shot trigger that fired. An overlapping invocation must
// never enumerate and delete the current owner's separately installed watchdog.
function consumeAutoRefreshFiredTrigger_(eventRaw) {
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
	const firedId = String(event.triggerUid || event.triggerId || "").trim();
	if (!firedId) return { consumed: false, reason: "missing-trigger-id" };
	const props = PropertiesService.getScriptProperties();
	const continuationId = String(props.getProperty(AUTO_REFRESH_JOB_TRIGGER_ID_PROPERTY) || "").trim();
	const watchdogId = String(props.getProperty(AUTO_REFRESH_JOB_WATCHDOG_TRIGGER_ID_PROPERTY) || "").trim();
	let kind = "";
	if (firedId === continuationId) kind = "continuation";
	else if (firedId === watchdogId) kind = "watchdog";
	const triggers = listAutoRefreshJobResumeTriggers_();
	const fired = findAutoRefreshTriggerById_(triggers, firedId);
	if (fired) {
		try { ScriptApp.deleteTrigger(fired); } catch (err) { Logger.log("Unable to consume fired auto-refresh trigger %s: %s", firedId, errorMessage_(err)); }
	}
	if (kind) clearAutoRefreshDynamicTriggerProperties_(kind);
	return { consumed: !!kind || !!fired, triggerId: firedId, kind: kind || "unknown" };
}

function removeAutoRefreshDynamicTriggerKind_(kindRaw) {
	const meta = getAutoRefreshDynamicTriggerProperties_(kindRaw);
	const props = PropertiesService.getScriptProperties();
	const triggerId = String(props.getProperty(meta.idProperty) || "").trim();
	const triggers = listAutoRefreshJobResumeTriggers_();
	const trigger = findAutoRefreshTriggerById_(triggers, triggerId);
	let removed = 0;
	if (trigger) {
		try { ScriptApp.deleteTrigger(trigger); removed = 1; } catch (err) { Logger.log("Unable to delete auto-refresh %s trigger: %s", meta.kind, errorMessage_(err)); }
	}
	clearAutoRefreshDynamicTriggerProperties_(meta.kind);
	return removed;
}

// Terminal cleanup removes both dynamic paths. Ordinary scheduling below only
// mutates its own kind and therefore preserves the other recovery path.
function removeAutoRefreshJobResumeTriggers_() {
	// Remove only the two trigger identities recorded for the current queue.
	// Enumerating every worker trigger here can delete a newer owner's trigger
	// when terminal cleanup races a newly-created run.
	return removeAutoRefreshDynamicTriggerKind_("continuation") + removeAutoRefreshDynamicTriggerKind_("watchdog");
}

function ensureAutoRefreshDynamicTrigger_(kindRaw, desiredAtMsRaw, minimumAtMsRaw) {
	const meta = getAutoRefreshDynamicTriggerProperties_(kindRaw);
	const nowMs = Date.now();
	const desiredAtMs = Math.max(nowMs + 1000, Number(desiredAtMsRaw) || nowMs + AUTO_REFRESH_JOB_RESUME_DELAY_MS);
	const minimumAtMs = Math.max(0, Number(minimumAtMsRaw) || 0);
	const props = PropertiesService.getScriptProperties();
	const lock = LockService.getScriptLock();
	const didLock = typeof lock.tryLock === "function" ? lock.tryLock(1000) : (lock.waitLock(1000), true);
	if (!didLock) {
		markAutoRefreshSchedulerRepairNeeded_(meta.kind, "trigger-edit-lock-busy", desiredAtMs);
		return { scheduled: false, degraded: true, kind: meta.kind, reason: "lock-busy" };
	}
	try {
		const triggers = listAutoRefreshJobResumeTriggers_();
		const configuredId = String(props.getProperty(meta.idProperty) || "").trim();
		const configuredAtMs = Math.max(0, Number(props.getProperty(meta.atProperty) || 0));
		const configured = findAutoRefreshTriggerById_(triggers, configuredId);
		const reusable = meta.kind === "watchdog"
			? !!configured && configuredAtMs >= minimumAtMs
			: !!configured && configuredAtMs > 0 && configuredAtMs <= desiredAtMs;
		if (reusable) {
			clearAutoRefreshSchedulerRepairMarker_(meta.kind);
			return { scheduled: true, reused: true, degraded: false, kind: meta.kind, triggerId: configuredId, scheduledAtMs: configuredAtMs };
		}

		const delayMs = Math.max(1000, desiredAtMs - Date.now());
		let created = null;
		try {
			created = ScriptApp.newTrigger(AUTO_REFRESH_JOB_HANDLER_NAME).timeBased().after(delayMs).create();
		} catch (err) {
			markAutoRefreshSchedulerRepairNeeded_(meta.kind, "trigger-create-failed:" + errorMessage_(err), desiredAtMs);
			return { scheduled: false, degraded: true, kind: meta.kind, reason: "create-failed", error: errorMessage_(err), preservedTriggerId: configuredId };
		}
		const createdId = getTriggerUniqueId_(created);
		if (!createdId) {
			try { if (created) ScriptApp.deleteTrigger(created); } catch (err) {}
			markAutoRefreshSchedulerRepairNeeded_(meta.kind, "trigger-id-missing", desiredAtMs);
			return { scheduled: false, degraded: true, kind: meta.kind, reason: "missing-trigger-id", preservedTriggerId: configuredId };
		}
		// Publish the replacement identity before deleting the previous trigger.
		props.setProperty(meta.idProperty, createdId);
		props.setProperty(meta.atProperty, String(Date.now() + delayMs));
		if (configured && configured !== created) {
			try { ScriptApp.deleteTrigger(configured); } catch (err) { Logger.log("Unable to delete replaced auto-refresh %s trigger: %s", meta.kind, errorMessage_(err)); }
		}
		const otherMeta = getAutoRefreshDynamicTriggerProperties_(meta.kind === "watchdog" ? "continuation" : "watchdog");
		const otherId = String(props.getProperty(otherMeta.idProperty) || "").trim();
		for (let i = 0; i < triggers.length; i++) {
			const id = getTriggerUniqueId_(triggers[i]);
			if (!id || id === configuredId || id === otherId || id === createdId) continue;
			try { ScriptApp.deleteTrigger(triggers[i]); } catch (err) {}
		}
		clearAutoRefreshSchedulerRepairMarker_(meta.kind);
		Logger.log("autoRefresh worker scheduled triggerId=%s delayMs=%s kind=%s", createdId, delayMs, meta.kind);
		return { scheduled: true, reused: false, degraded: false, kind: meta.kind, triggerId: createdId, delayMs: delayMs, scheduledAtMs: Date.now() + delayMs };
	} finally {
		lock.releaseLock();
	}
}

function scheduleAutoRefreshJobTrigger_(delayMsRaw, kindRaw) {
	const kind = String(kindRaw || "resume") === "watchdog" ? "watchdog" : "continuation";
	const delayMs = Math.max(1000, Number(delayMsRaw) || AUTO_REFRESH_JOB_RESUME_DELAY_MS);
	const desiredAtMs = Date.now() + delayMs;
	return ensureAutoRefreshDynamicTrigger_(kind, desiredAtMs, kind === "watchdog" ? desiredAtMs : 0);
}

function scheduleAutoRefreshJobResume_() {
	return ensureAutoRefreshDynamicTrigger_("continuation", Date.now() + AUTO_REFRESH_JOB_RESUME_DELAY_MS, 0);
}

function scheduleAutoRefreshJobWatchdog_() {
	const nowMs = Date.now();
	let desiredAtMs = nowMs + AUTO_REFRESH_JOB_WATCHDOG_DELAY_MS;
	// Reuse is governed by the recovery invariant, not by a freshly sliding
	// "now + full delay" target. Otherwise every later caller moves the minimum
	// forward by a few milliseconds and replaces an already-safe watchdog.
	let minimumAtMs = nowMs + AUTO_REFRESH_JOB_WATCHDOG_SAFETY_MS;
	try {
		const lockState = typeof readActiveRosterJobLockState_ === "function" ? readActiveRosterJobLockState_() : null;
		if (lockState && Number(lockState.expiresAt) > 0) {
			minimumAtMs = Math.max(minimumAtMs, Number(lockState.expiresAt) + AUTO_REFRESH_JOB_WATCHDOG_SAFETY_MS);
			desiredAtMs = Math.max(desiredAtMs, minimumAtMs);
		}
	} catch (err) {}
	return ensureAutoRefreshDynamicTrigger_("watchdog", desiredAtMs, minimumAtMs);
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

function listPermanentSchedulerWatchdogTriggers_() {
	const all = ScriptApp.getProjectTriggers();
	return all.filter((trigger) => {
		try { return String(trigger.getHandlerFunction() || "") === PERMANENT_SCHEDULER_WATCHDOG_HANDLER_NAME; } catch (err) { return false; }
	});
}

function ensurePermanentSchedulerWatchdogTrigger_() {
	const props = PropertiesService.getScriptProperties();
	const configuredId = String(props.getProperty(PERMANENT_SCHEDULER_WATCHDOG_TRIGGER_ID_PROPERTY) || "").trim();
	const triggers = listPermanentSchedulerWatchdogTriggers_();
	let keep = findAutoRefreshTriggerById_(triggers, configuredId);
	if (!keep && triggers.length) keep = triggers[0];
	if (!keep) {
		try {
			keep = ScriptApp.newTrigger(PERMANENT_SCHEDULER_WATCHDOG_HANDLER_NAME)
				.timeBased()
				.everyHours(PERMANENT_SCHEDULER_WATCHDOG_INTERVAL_HOURS)
				.create();
		} catch (err) {
			markRuntimeRecoveryNeeded_("permanentScheduler", "permanent-watchdog-create-failed", { error: errorMessage_(err).slice(0, 300) });
			return { scheduled: false, degraded: true, error: errorMessage_(err) };
		}
	}
	const keepId = getTriggerUniqueId_(keep);
	if (keepId) props.setProperty(PERMANENT_SCHEDULER_WATCHDOG_TRIGGER_ID_PROPERTY, keepId);
	for (let i = 0; i < triggers.length; i++) {
		if (triggers[i] === keep || getTriggerUniqueId_(triggers[i]) === keepId) continue;
		try { ScriptApp.deleteTrigger(triggers[i]); } catch (err) {}
	}
	if (typeof clearRuntimeRecoveryNeeded_ === "function") clearRuntimeRecoveryNeeded_("permanentScheduler");
	return { scheduled: !!keepId, degraded: !keepId, triggerId: keepId, reused: triggers.length > 0 };
}

function repairAutoRefreshSchedulingFromPermanentWatchdog_() {
	const periodic = isAutoRefreshEnabled_() ? ensureSingleAutoRefreshTrigger_() : null;
	if (!isAutoRefreshEnabled_()) return { ok: true, enabled: false, scheduled: false };
	const current = readAutoRefreshQueueCurrent_();
	let dynamic = null;
	if (current && current.kind === "auto-refresh-queue" && (current.status === "running" || current.status === "finalizing")) {
		dynamic = scheduleAutoRefreshJobResume_();
	} else if (isAutoRefreshFreshRetryPending_()) {
		dynamic = scheduleAutoRefreshJobResume_();
	} else {
		clearAutoRefreshSchedulerRepairMarker_();
	}
	return {
		ok: !dynamic || dynamic.scheduled !== false,
		enabled: true,
		periodicTriggerId: getTriggerUniqueId_(periodic),
		dynamic: dynamic,
	};
}

function listCwlSeasonEventRecoveryTriggers_() {
	return ScriptApp.getProjectTriggers().filter(function (trigger) { return trigger.getHandlerFunction() === CWL_RECOVERY_HANDLER_NAME; });
}

function listPendingCwlRuntimeRecoveryScopes_() {
	const scopes = typeof listRuntimeRecoveryScopes_ === "function" ? listRuntimeRecoveryScopes_("cwl-refresh:") : [];
	const marker = typeof readRuntimeRecoveryMarker_ === "function" ? readRuntimeRecoveryMarker_() : { scopes: {} };
	if (marker.scopes && marker.scopes["cwl-refresh"] && scopes.indexOf("cwl-refresh") < 0) scopes.push("cwl-refresh");
	return scopes.sort();
}

function findCwlSeasonEventRecoveryTriggerById_(triggersRaw, triggerIdRaw) {
	const triggers = Array.isArray(triggersRaw) ? triggersRaw : [];
	const triggerId = String(triggerIdRaw || "").trim();
	for (let i = 0; i < triggers.length; i++) if (getTriggerUniqueId_(triggers[i]) === triggerId) return triggers[i];
	return null;
}

function scheduleCwlSeasonEventRecovery_(notBeforeMsRaw) {
	const scopes = listPendingCwlRuntimeRecoveryScopes_();
	if (!scopes.length) return { scheduled: false, skipped: true, reason: "no-cwl-recovery-marker" };
	const props = PropertiesService.getScriptProperties();
	const desiredAtMs = Math.max(Date.now() + 1000, Number(notBeforeMsRaw) || Date.now() + CWL_RECOVERY_TRIGGER_DELAY_MS, getRuntimeUrlFetchQuotaCooldownUntilMs_());
	const lock = LockService.getScriptLock();
	const didLock = typeof lock.tryLock === "function" ? lock.tryLock(1000) : (lock.waitLock(1000), true);
	if (!didLock) return { scheduled: false, degraded: true, reason: "lock-busy" };
	try {
		const triggers = listCwlSeasonEventRecoveryTriggers_();
		const configuredId = String(props.getProperty(CWL_RECOVERY_TRIGGER_ID_PROPERTY) || "").trim();
		const configuredAtMs = Math.max(0, Number(props.getProperty(CWL_RECOVERY_TRIGGER_AT_PROPERTY) || 0));
		const configured = findCwlSeasonEventRecoveryTriggerById_(triggers, configuredId);
		if (configured && configuredAtMs > 0 && configuredAtMs <= desiredAtMs) {
			return { scheduled: true, reused: true, triggerId: configuredId, scheduledAtMs: configuredAtMs };
		}
		let created;
		try { created = ScriptApp.newTrigger(CWL_RECOVERY_HANDLER_NAME).timeBased().after(Math.max(1000, desiredAtMs - Date.now())).create(); }
		catch (err) { return { scheduled: false, degraded: true, reason: "create-failed", error: errorMessage_(err), preservedTriggerId: configuredId }; }
		const createdId = getTriggerUniqueId_(created);
		if (!createdId) return { scheduled: false, degraded: true, reason: "missing-trigger-id", preservedTriggerId: configuredId };
		props.setProperty(CWL_RECOVERY_TRIGGER_ID_PROPERTY, createdId);
		props.setProperty(CWL_RECOVERY_TRIGGER_AT_PROPERTY, String(desiredAtMs));
		if (configured && configuredId !== createdId) {
			try { ScriptApp.deleteTrigger(configured); } catch (err) {}
		}
		return { scheduled: true, reused: false, triggerId: createdId, scheduledAtMs: desiredAtMs };
	} finally {
		try { lock.releaseLock(); } catch (err) {}
	}
}

function consumeCwlSeasonEventRecoveryTrigger_(eventRaw) {
	const event = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
	const firedId = String(event.triggerUid || event.triggerId || "").trim();
	if (!firedId) return { consumed: false, reason: "missing-trigger-id" };
	const props = PropertiesService.getScriptProperties();
	const configuredId = String(props.getProperty(CWL_RECOVERY_TRIGGER_ID_PROPERTY) || "").trim();
	const trigger = findCwlSeasonEventRecoveryTriggerById_(listCwlSeasonEventRecoveryTriggers_(), firedId);
	if (trigger) { try { ScriptApp.deleteTrigger(trigger); } catch (err) {} }
	if (firedId === configuredId) {
		props.deleteProperty(CWL_RECOVERY_TRIGGER_ID_PROPERTY);
		props.deleteProperty(CWL_RECOVERY_TRIGGER_AT_PROPERTY);
	}
	return { consumed: !!trigger || firedId === configuredId, triggerId: firedId, owned: firedId === configuredId };
}

function runOneCwlSeasonEventRecovery_() {
	const scopes = listPendingCwlRuntimeRecoveryScopes_();
	if (!scopes.length) return { ok: true, skipped: true, reason: "no-cwl-recovery-marker" };
	const scope = scopes[0];
	const marker = readRuntimeRecoveryMarker_();
	const detail = marker.scopes && marker.scopes[scope] && typeof marker.scopes[scope] === "object" ? marker.scopes[scope] : {};
	const eventId = String(detail.eventId || "").trim();
	let result;
	try {
		if (eventId) {
			const current = readCurrentCwlSeasonEvent_();
			if (!current || String(current.eventId || "") !== eventId) {
				clearRuntimeRecoveryNeeded_(scope);
				return { ok: true, status: "superseded", cleared: true, scope: scope, eventId: eventId };
			}
			const target = sanitizeCwlSeasonEventTarget_(sanitizeCwlSeasonEventMeta_(current.cwl).target);
			if ((detail.groupId && String(detail.groupId) !== target.groupId) || (detail.season && String(detail.season) !== target.season)) {
				clearRuntimeRecoveryNeeded_(scope);
				return { ok: true, status: "target-superseded", cleared: true, scope: scope, eventId: eventId };
			}
			result = refreshCurrentCwlSeasonEventCore_({ source: { type: "independent-cwl-recovery", recoveryScope: scope } });
		} else {
			result = reconcileMissingCurrentCwlSeasonEvent_({ source: { type: "independent-cwl-recovery", recoveryScope: scope } });
		}
		const status = String(result && result.status || "").toLowerCase();
		const successful = !!(result && result.ok !== false && status !== "stale" && status !== "deferred" && status !== "bootstrap-incomplete" && status !== "unavailable" && status !== "error" && status !== "cwl-reconciliation-deferred");
		if (successful) clearRuntimeRecoveryNeeded_(scope);
		else markRuntimeRecoveryNeeded_(scope, "independent-cwl-recovery-" + (status || "failed"), Object.assign({}, detail, { eventId: eventId, lastAttemptAt: new Date().toISOString(), lastStatus: status || "failed" }));
		return { ok: successful, status: status || "failed", cleared: successful, scope: scope, eventId: eventId, result: sanitizeAutoRefreshDiagnosticFragment_(result, 3) };
	} catch (err) {
		markRuntimeRecoveryNeeded_(scope, "independent-cwl-recovery-failed", Object.assign({}, detail, { eventId: eventId, lastAttemptAt: new Date().toISOString(), error: errorMessage_(err).slice(0, 500) }));
		return { ok: false, status: "failed", cleared: false, scope: scope, eventId: eventId, error: errorMessage_(err) };
	}
}

function cwlSeasonEventRecoveryTick(eventRaw) {
	consumeCwlSeasonEventRecoveryTrigger_(eventRaw);
	return runWithExecutionDeadline_("independent-cwl-recovery", 120 * 1000, function () {
		if (getRuntimeUrlFetchQuotaCooldownUntilMs_() > Date.now()) {
			const scheduled = scheduleCwlSeasonEventRecovery_(getRuntimeUrlFetchQuotaCooldownUntilMs_());
			return { ok: true, skipped: true, reason: "urlFetchQuotaCooldown", scheduled: scheduled };
		}
		const result = runOneCwlSeasonEventRecovery_();
		if (listPendingCwlRuntimeRecoveryScopes_().length) result.next = scheduleCwlSeasonEventRecovery_();
		return result;
	}, { cleanupReserveMs: APP_SCRIPT_EXECUTION_CLEANUP_RESERVE_MS, recoveryScope: "cwl-independent-recovery" });
}

function repairCwlSeasonEventRecoverySchedulingFromPermanentWatchdog_() {
	const scopes = listPendingCwlRuntimeRecoveryScopes_();
	if (!scopes.length) return { ok: true, pending: false, scheduled: false };
	const scheduled = scheduleCwlSeasonEventRecovery_();
	return { ok: !!(scheduled && scheduled.scheduled), pending: true, scheduled: !!(scheduled && scheduled.scheduled), detail: scheduled };
}

function readFullAppsScriptAuthorizationStatus_() {
	try {
		const authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
		const statusRaw = authInfo.getAuthorizationStatus();
		const status = String(statusRaw || "UNKNOWN");
		const notRequired = ScriptApp.AuthorizationStatus && ScriptApp.AuthorizationStatus.NOT_REQUIRED;
		return {
			mode: "FULL",
			status: status,
			authorized: statusRaw === notRequired || status === String(notRequired || "NOT_REQUIRED") || status === "NOT_REQUIRED",
		};
	} catch (err) {
		return { mode: "FULL", status: "ERROR", authorized: false, error: errorMessage_(err) };
	}
}

function buildProductionTriggerAuthorizationDiagnostics_() {
	const props = PropertiesService.getScriptProperties();
	const authorization = readFullAppsScriptAuthorizationStatus_();
	let allTriggers = [];
	let triggerReadError = "";
	try { allTriggers = ScriptApp.getProjectTriggers(); }
	catch (err) { triggerReadError = errorMessage_(err); }
	const describe = function (name, handler, idProperty, atProperty) {
		const configuredId = String(props.getProperty(idProperty) || "").trim();
		const configuredAtMs = atProperty ? Math.max(0, Number(props.getProperty(atProperty) || 0)) : 0;
		const matching = allTriggers.filter(function (trigger) {
			try { return String(trigger.getHandlerFunction() || "") === handler; } catch (err) { return false; }
		});
		return {
			name: name,
			handler: handler,
			configuredId: configuredId,
			configuredAt: configuredAtMs ? new Date(configuredAtMs).toISOString() : "",
			configuredAtMs: configuredAtMs,
			configuredPresent: !!configuredId && matching.some(function (trigger) { return getTriggerUniqueId_(trigger) === configuredId; }),
			actualCount: matching.length,
			actualIds: matching.map(function (trigger) { return getTriggerUniqueId_(trigger); }).filter(Boolean),
		};
	};
	const cooldownUntilMs = getRuntimeUrlFetchQuotaCooldownUntilMs_();
	let cloudflareTriggers = null;
	if (typeof getCloudflareDynamicTriggerDiagnostics_ === "function") {
		try { cloudflareTriggers = getCloudflareDynamicTriggerDiagnostics_(); }
		catch (err) { cloudflareTriggers = { unavailable: true, error: errorMessage_(err) }; }
	}
	let autoSchedulerRepair = null;
	try {
		const raw = String(props.getProperty(AUTO_REFRESH_SCHEDULER_REPAIR_MARKER_PROPERTY) || "").trim();
		autoSchedulerRepair = raw ? JSON.parse(raw) : null;
	} catch (err) { autoSchedulerRepair = { malformed: true }; }
	return {
		checkedAt: new Date().toISOString(),
		authorization: authorization,
		triggerRead: { available: !triggerReadError, error: triggerReadError },
		triggers: {
			permanent: describe("permanent", PERMANENT_SCHEDULER_WATCHDOG_HANDLER_NAME, PERMANENT_SCHEDULER_WATCHDOG_TRIGGER_ID_PROPERTY, ""),
			autoRefresh: describe("autoRefresh", AUTO_REFRESH_HANDLER_NAME, AUTO_REFRESH_TRIGGER_ID_PROPERTY, ""),
			autoRefreshContinuation: describe("autoRefreshContinuation", AUTO_REFRESH_JOB_HANDLER_NAME, AUTO_REFRESH_JOB_TRIGGER_ID_PROPERTY, AUTO_REFRESH_JOB_TRIGGER_AT_PROPERTY),
			autoRefreshWatchdog: describe("autoRefreshWatchdog", AUTO_REFRESH_JOB_HANDLER_NAME, AUTO_REFRESH_JOB_WATCHDOG_TRIGGER_ID_PROPERTY, AUTO_REFRESH_JOB_WATCHDOG_TRIGGER_AT_PROPERTY),
			donationRefresh: describe("donationRefresh", DONATION_REFRESH_HANDLER_NAME, DONATION_REFRESH_TRIGGER_ID_PROPERTY, ""),
			cwlRecovery: describe("cwlRecovery", CWL_RECOVERY_HANDLER_NAME, CWL_RECOVERY_TRIGGER_ID_PROPERTY, CWL_RECOVERY_TRIGGER_AT_PROPERTY),
			cloudflare: cloudflareTriggers,
		},
		cooldown: {
			active: cooldownUntilMs > Date.now(),
			until: cooldownUntilMs ? new Date(cooldownUntilMs).toISOString() : "",
			untilMs: cooldownUntilMs,
		},
		repairMarkers: {
			runtime: readRuntimeRecoveryMarker_(),
			autoRefreshScheduler: autoSchedulerRepair,
			cloudflareScheduler: typeof readCloudflarePublishSchedulerRepair_ === "function" ? readCloudflarePublishSchedulerRepair_() : null,
		},
	};
}

function repairProductionTriggerSchedulingAfterAuthorization_() {
	const cooldownUntilMs = getRuntimeUrlFetchQuotaCooldownUntilMs_();
	const result = { ok: true, permanent: null, autoRefresh: null, donationRefresh: null, cwlRecovery: null, cloudflare: null };
	const capture = function (key, callback) {
		try {
			result[key] = callback();
			if (result[key] && (result[key].ok === false || result[key].scheduled === false && result[key].degraded === true)) result.ok = false;
		} catch (err) { result.ok = false; result[key] = { ok: false, error: errorMessage_(err) }; }
	};
	capture("permanent", function () { return ensurePermanentSchedulerWatchdogTrigger_(); });
	capture("autoRefresh", function () {
		return cooldownUntilMs > Date.now() ? reconcileAutoRefreshTriggerState_() : repairAutoRefreshSchedulingFromPermanentWatchdog_();
	});
	capture("donationRefresh", function () { return reconcileDonationRefreshTriggerState_(); });
	capture("cwlRecovery", function () { return repairCwlSeasonEventRecoverySchedulingFromPermanentWatchdog_(); });
	if (typeof repairCloudflarePublishSchedulingFromPermanentWatchdog_ === "function") {
		capture("cloudflare", function () {
			return cooldownUntilMs > Date.now()
				? repairCloudflarePublishSchedulingFromPermanentWatchdog_({ localOnly: true, notBeforeMs: cooldownUntilMs })
				: repairCloudflarePublishSchedulingFromPermanentWatchdog_();
		});
	}
	result.diagnostics = buildProductionTriggerAuthorizationDiagnostics_();
	return result;
}

// Run this function manually from the Apps Script editor. When scopes are
// missing, Google presents interactive consent and stops this invocation. Run
// it again after consent; only then are all production trigger families
// reconciled. No authorization URL is returned or exposed through the web app.
function authorizeAndRepairProductionTriggers() {
	ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
	return repairProductionTriggerSchedulingAfterAuthorization_();
}

function reconcileProductionTriggerSchedulingDuringUrlFetchCooldown_(cooldownUntilMsRaw, reasonRaw) {
	const cooldownUntilMs = Math.max(Date.now(), Number(cooldownUntilMsRaw) || 0);
	const result = {
		ok: true,
		skippedRemote: true,
		reason: String(reasonRaw || "urlFetchQuotaCooldown"),
		cooldownUntil: new Date(cooldownUntilMs).toISOString(),
		permanent: null,
		autoRefresh: null,
		donationRefresh: null,
		cwlRecovery: null,
		cloudflare: null,
		canonicalRepair: { ok: true, skipped: true, reason: "urlfetch-cooldown-local-only" },
	};
	try { result.permanent = ensurePermanentSchedulerWatchdogTrigger_(); }
	catch (err) { result.ok = false; result.permanent = { ok: false, error: errorMessage_(err) }; }
	// Periodic trigger reconciliation is ScriptApp/Properties-only. Queue-state
	// discovery and canonical repair are intentionally deferred until UrlFetch is
	// available again.
	try { result.autoRefresh = reconcileAutoRefreshTriggerState_(); }
	catch (err) { result.ok = false; result.autoRefresh = { ok: false, error: errorMessage_(err) }; }
	try { result.donationRefresh = reconcileDonationRefreshTriggerState_(); }
	catch (err) { result.ok = false; result.donationRefresh = { ok: false, error: errorMessage_(err) }; }
	try {
		result.cwlRecovery = repairCwlSeasonEventRecoverySchedulingFromPermanentWatchdog_();
		if (result.cwlRecovery && result.cwlRecovery.ok === false) result.ok = false;
	} catch (err) { result.ok = false; result.cwlRecovery = { ok: false, error: errorMessage_(err) }; }
	if (typeof repairCloudflarePublishSchedulingFromPermanentWatchdog_ === "function") {
		try {
			result.cloudflare = repairCloudflarePublishSchedulingFromPermanentWatchdog_({ localOnly: true, notBeforeMs: cooldownUntilMs });
			if (result.cloudflare && result.cloudflare.ok === false) result.ok = false;
		} catch (err) { result.ok = false; result.cloudflare = { ok: false, error: errorMessage_(err) }; }
	}
	return result;
}

function permanentSchedulerWatchdogTickInternal_() {
	const cooldownUntilMs = getRuntimeUrlFetchQuotaCooldownUntilMs_();
	if (cooldownUntilMs > Date.now()) {
		return reconcileProductionTriggerSchedulingDuringUrlFetchCooldown_(cooldownUntilMs, "urlFetchQuotaCooldown");
	}
	clearExpiredRuntimeUrlFetchQuotaCooldown_();
	const result = {
		ok: true,
		permanent: ensurePermanentSchedulerWatchdogTrigger_(),
		autoRefresh: null,
		donationRefresh: null,
		cwlRecovery: null,
		cloudflare: null,
		canonicalRepair: null,
	};
	try {
		result.canonicalRepair = runOneCanonicalRepairMarker_();
		if (result.canonicalRepair && result.canonicalRepair.ok === false) result.ok = false;
	} catch (err) {
		if (isFirebaseDailyUrlFetchQuotaError_(err)) return reconcileProductionTriggerSchedulingDuringUrlFetchCooldown_(getRuntimeUrlFetchQuotaCooldownUntilMs_(), "urlFetchQuota");
		result.ok = false;
		result.canonicalRepair = { ok: false, error: errorMessage_(err) };
	}
	try {
		result.autoRefresh = repairAutoRefreshSchedulingFromPermanentWatchdog_();
	} catch (err) {
		if (isFirebaseDailyUrlFetchQuotaError_(err)) return reconcileProductionTriggerSchedulingDuringUrlFetchCooldown_(getRuntimeUrlFetchQuotaCooldownUntilMs_(), "urlFetchQuota");
		result.ok = false;
		result.autoRefresh = { ok: false, error: errorMessage_(err) };
		markAutoRefreshSchedulerRepairNeeded_("continuation", "permanent-repair-failed:" + errorMessage_(err), 0);
	}
	try {
		result.donationRefresh = reconcileDonationRefreshTriggerState_();
	} catch (err) {
		result.ok = false;
		result.donationRefresh = { ok: false, error: errorMessage_(err) };
	}
	try {
		result.cwlRecovery = repairCwlSeasonEventRecoverySchedulingFromPermanentWatchdog_();
		if (result.cwlRecovery && result.cwlRecovery.ok === false) result.ok = false;
	} catch (err) {
		result.ok = false;
		result.cwlRecovery = { ok: false, error: errorMessage_(err) };
	}
	if (typeof repairCloudflarePublishSchedulingFromPermanentWatchdog_ === "function") {
		try {
			result.cloudflare = repairCloudflarePublishSchedulingFromPermanentWatchdog_();
		} catch (err) {
			if (isFirebaseDailyUrlFetchQuotaError_(err)) return reconcileProductionTriggerSchedulingDuringUrlFetchCooldown_(getRuntimeUrlFetchQuotaCooldownUntilMs_(), "urlFetchQuota");
			result.ok = false;
			result.cloudflare = { ok: false, error: errorMessage_(err) };
		}
	}
	return result;
}

function permanentSchedulerWatchdogTick() {
	return runWithExecutionDeadline_("permanent-scheduler-watchdog", 120 * 1000, function () {
		return permanentSchedulerWatchdogTickInternal_();
	}, {
		cleanupReserveMs: APP_SCRIPT_EXECUTION_CLEANUP_RESERVE_MS,
		recoveryScope: "permanentScheduler",
	});
}

// Handle reconcile auto refresh trigger state.
function reconcileAutoRefreshTriggerState_() {
	const props = PropertiesService.getScriptProperties();
	ensurePermanentSchedulerWatchdogTrigger_();
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

// Force-recreate auto-refresh triggers from the currently executing deployment.
function repairAutoRefreshScheduler_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" && !Array.isArray(optionsRaw) ? optionsRaw : {};
	const props = PropertiesService.getScriptProperties();
	const enabled = isAutoRefreshEnabled_();
	const startedAt = new Date().toISOString();
	const before = buildAutoRefreshTriggerDiagnostics_();
	const oldPeriodicTriggers = listAutoRefreshTriggers_();
	let removedAutoRefresh = 0;
	let removedResume = 0;
	let triggerId = "";
	if (enabled) {
		let replacement = null;
		try {
			replacement = ScriptApp.newTrigger(AUTO_REFRESH_HANDLER_NAME).timeBased().everyHours(AUTO_REFRESH_INTERVAL_HOURS).create();
		} catch (err) {
			markAutoRefreshSchedulerRepairNeeded_("periodic", "periodic-trigger-create-failed:" + errorMessage_(err), 0);
		}
		triggerId = getTriggerUniqueId_(replacement);
		if (triggerId) {
			props.setProperty(AUTO_REFRESH_TRIGGER_ID_PROPERTY, triggerId);
			for (let i = 0; i < oldPeriodicTriggers.length; i++) {
				try { ScriptApp.deleteTrigger(oldPeriodicTriggers[i]); removedAutoRefresh++; } catch (err) {}
			}
		} else if (oldPeriodicTriggers.length) {
			triggerId = getTriggerUniqueId_(oldPeriodicTriggers[0]);
			if (triggerId) props.setProperty(AUTO_REFRESH_TRIGGER_ID_PROPERTY, triggerId);
		}
	} else {
		removedAutoRefresh = removeAutoRefreshTriggers_();
		removedResume = removeAutoRefreshJobResumeTriggers_();
		props.deleteProperty(AUTO_REFRESH_TRIGGER_ID_PROPERTY);
	}
	let resume = null;
	let currentStatus = "";
	let currentRunId = "";
	try {
		const current = readAutoRefreshQueueCurrent_();
		currentStatus = String((current && current.status) || "");
		currentRunId = String((current && current.runId) || "");
		if (
			enabled &&
			current &&
			current.kind === "auto-refresh-queue" &&
			(current.status === "running" || current.status === "finalizing")
		) {
			resume = scheduleAutoRefreshJobResume_();
		} else if (enabled && isAutoRefreshFreshRetryPending_()) {
			resume = scheduleAutoRefreshJobResume_();
		} else if (enabled) {
			removedResume = removeAutoRefreshJobResumeTriggers_();
		}
	} catch (err) {
		Logger.log("autoRefresh scheduler repair resume check failed: %s", errorMessage_(err));
	}
	const after = buildAutoRefreshTriggerDiagnostics_();
	const result = {
		ok: !!triggerId || !enabled,
		status: enabled ? "repaired" : "disabled",
		enabled: enabled,
		startedAt: startedAt,
		finishedAt: new Date().toISOString(),
		reason: String(options.reason || "").slice(0, 200),
		removedAutoRefreshTriggers: removedAutoRefresh,
		removedResumeTriggers: removedResume,
		triggerId: triggerId,
		resumeTriggerId: String((resume && resume.triggerId) || ""),
		currentRunId: currentRunId,
		currentStatus: currentStatus,
		before: before,
		after: after,
	};
	Logger.log(
		"autoRefresh scheduler repaired enabled=%s removedAutoRefresh=%s removedResume=%s triggerId=%s resumeTriggerId=%s currentRunId=%s currentStatus=%s reason=%s",
		enabled,
		removedAutoRefresh,
		removedResume,
		triggerId,
		String((resume && resume.triggerId) || ""),
		currentRunId,
		currentStatus,
		String(options.reason || ""),
	);
	return result;
}

function assertAutoRefreshSchedulerRepairAuth_(secretOrPasswordRaw) {
	try {
		assertDiscordBotApiSecret_(secretOrPasswordRaw);
		return "discord-bot";
	} catch (botErr) {
		assertAdminPassword_(secretOrPasswordRaw);
		return "admin";
	}
}

function repairAutoRefreshScheduler(payloadRaw, secretOrPasswordRaw) {
	const payload = payloadRaw && typeof payloadRaw === "object" && !Array.isArray(payloadRaw) ? payloadRaw : {};
	const auth = assertAutoRefreshSchedulerRepairAuth_(secretOrPasswordRaw);
	const result = repairAutoRefreshScheduler_({
		reason: String(payload.reason || "api-repair").trim() || "api-repair",
	});
	result.auth = auth;
	return result;
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
		watchdogTriggerId: String(props.getProperty(AUTO_REFRESH_JOB_WATCHDOG_TRIGGER_ID_PROPERTY) || "").trim(),
		hasWatchdogTrigger: !!String(props.getProperty(AUTO_REFRESH_JOB_WATCHDOG_TRIGGER_ID_PROPERTY) || "").trim(),
		permanentWatchdogTriggerId: String(props.getProperty(PERMANENT_SCHEDULER_WATCHDOG_TRIGGER_ID_PROPERTY) || "").trim(),
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

function maybeRepairCloudflareActiveRosterMirrorAfterAutoRefreshTick_(labelRaw, resultRaw) {
	const result = resultRaw && typeof resultRaw === "object" ? resultRaw : null;
	if (!result || result.ok === false || result.inProgress === true || String(result.status || "") === "error") return null;
	// Active publication is enqueued during finalization. Avoid broad drift repair
	// after every successful refresh; diagnostics/periodic repair own that path.
	return { ok: true, skipped: true, reason: "queue-enqueued-during-finalization" };
}

// Handle auto refresh active roster tick.
function runAutoRefreshActiveRosterTick(payloadRaw, secretOrPasswordRaw) {
	assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw);
	return autoRefreshActiveRosterTick();
}

function autoRefreshActiveRosterTickInternal_() {
	const tickStartMs = Date.now();
	const startedAt = new Date().toISOString();
	let resultForLog = null;
	Logger.log("autoRefreshActiveRosterTick start startedAt=%s", startedAt);

	try {
		if (isRuntimeUrlFetchQuotaCooldownActive_()) {
			const cooldownUntilMs = getRuntimeUrlFetchQuotaCooldownUntilMs_();
			resultForLog = { ok: true, status: "skipped", skipped: true, reason: "urlFetchQuotaCooldown", cooldownUntil: new Date(cooldownUntilMs).toISOString() };
			return resultForLog;
		}
		clearExpiredRuntimeUrlFetchQuotaCooldown_();
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
		if (isFirebaseDailyUrlFetchQuotaError_(err)) {
			removeAutoRefreshJobResumeTriggers_();
			markAutoRefreshSchedulerRepairNeeded_("continuation", "firebase-urlfetch-quota", getRuntimeUrlFetchQuotaCooldownUntilMs_());
			Logger.log("Auto-refresh coordinator paused without short retry because Firebase UrlFetch daily quota is exhausted.");
			resultForLog = { ok: true, status: "inProgress", inProgress: true, reason: "firebaseUrlFetchQuota", quotaPaused: true };
			return resultForLog;
		}
		if (isExecutionDeadlineError_(err)) {
			// Deadline recovery must be local-only. Firebase checkpoint attempts are
			// no longer admissible here, but replacing both one-shot paths prevents a
			// task left running by the interrupted request from becoming orphaned.
			const continuation = scheduleAutoRefreshJobResume_();
			const watchdog = scheduleAutoRefreshJobWatchdog_();
			resultForLog = {
				ok: true,
				status: "inProgress",
				inProgress: true,
				reason: "executionDeadline",
				deferred: true,
				scheduling: { continuation: continuation, watchdog: watchdog },
			};
			Logger.log("Auto-refresh coordinator deadline deferred with continuation and watchdog recovery.");
			return resultForLog;
		}
		if (isActiveRosterJobLockBusyError_(err)) {
			const lockRecovery = maybeClearStaleAutoRefreshLockAfterBusy_("autoRefreshActiveRosterTick lock busy recovery");
			if (lockRecovery && lockRecovery.cleared) {
				Logger.log(
					"autoRefreshActiveRosterTick cleared stale auto-refresh lock runId=%s taskId=%s ageMs=%s",
					String(lockRecovery.runId || ""),
					String(lockRecovery.taskId || ""),
					toNonNegativeInt_(lockRecovery.ageMs),
				);
			}
			scheduleAutoRefreshJobResume_();
			setAutoRefreshRunResult_("skipped", "Auto-refresh skipped due to overlap with another active roster refresh/publish flow.", "", 0, "", startedAt, new Date().toISOString());
			tryReconcileRegularWarFinalizationTriggerState_();
			resultForLog = { ok: true, status: "skipped", skipped: true, reason: "overlap", lockRecovery: lockRecovery };
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
		maybeRepairCloudflareActiveRosterMirrorAfterAutoRefreshTick_("auto-refresh-active-tick-mirror", resultForLog);
		Logger.log(
			"autoRefreshActiveRosterTick end status=%s reason=%s elapsedMs=%s",
			String((resultForLog && resultForLog.status) || ""),
			String((resultForLog && resultForLog.reason) || ""),
			Math.max(0, Date.now() - tickStartMs),
		);
	}
}

function autoRefreshActiveRosterTick() {
	return runWithExecutionDeadline_("auto-refresh-coordinator", AUTO_REFRESH_JOB_EXECUTION_BUDGET_MS, function () {
		return autoRefreshActiveRosterTickInternal_();
	}, {
		cleanupReserveMs: APP_SCRIPT_EXECUTION_CLEANUP_RESERVE_MS,
		recoveryScope: "autoRefresh",
	});
}

// Handle sharded auto-refresh worker one-shot trigger.
function runAutoRefreshWorkerTick(payloadRaw, secretOrPasswordRaw) {
	assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw);
	return autoRefreshWorkerTick();
}

function autoRefreshWorkerTickInternal_() {
	const tickStartMs = Date.now();
	const startedAt = new Date().toISOString();
	let resultForLog = null;
	Logger.log("autoRefreshWorkerTick start startedAt=%s", startedAt);
	try {
		if (isRuntimeUrlFetchQuotaCooldownActive_()) {
			const cooldownUntilMs = getRuntimeUrlFetchQuotaCooldownUntilMs_();
			markAutoRefreshSchedulerRepairNeeded_("continuation", "firebase-urlfetch-quota-cooldown", cooldownUntilMs);
			resultForLog = { ok: true, status: "inProgress", inProgress: true, reason: "urlFetchQuotaCooldown", quotaPaused: true, cooldownUntil: new Date(cooldownUntilMs).toISOString() };
			return resultForLog;
		}
		clearExpiredRuntimeUrlFetchQuotaCooldown_();
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
		Logger.log(
			"autoRefreshWorkerTick progress tasksCompleted=%s elapsedMs=%s remainingMs=%s exitReason=%s",
			toNonNegativeInt_(result && result.tasksCompleted),
			toNonNegativeInt_(result && result.elapsedMs),
			toNonNegativeInt_(result && result.remainingMs),
			String((result && result.exitReason) || (result && result.reason) || ""),
		);
		if (result && result.inProgress) {
			Logger.log("autoRefreshWorkerTick in progress processedRosters=%s totalRosters=%s", toNonNegativeInt_(result.processedRosters), toNonNegativeInt_(result.totalRosters));
		} else if (result && result.stale) {
			Logger.log("autoRefreshWorkerTick stale: %s", String(result.summary || ""));
		} else {
			Logger.log("autoRefreshWorkerTick done: %s", String(result && result.summary ? result.summary : ""));
		}
		return result;
	} catch (err) {
		if (isFirebaseDailyUrlFetchQuotaError_(err)) {
			removeAutoRefreshJobResumeTriggers_();
			markAutoRefreshSchedulerRepairNeeded_("continuation", "firebase-urlfetch-quota", getRuntimeUrlFetchQuotaCooldownUntilMs_());
			Logger.log("Auto-refresh worker paused without short retry because Firebase UrlFetch daily quota is exhausted.");
			resultForLog = { ok: true, status: "inProgress", inProgress: true, reason: "firebaseUrlFetchQuota", quotaPaused: true };
			return resultForLog;
		}
		if (isExecutionDeadlineError_(err)) {
			// The deadline guard intentionally prevents further Firebase access. Keep
			// recovery local-only and preserve both independent one-shot paths.
			const continuation = scheduleAutoRefreshJobResume_();
			const watchdog = scheduleAutoRefreshJobWatchdog_();
			resultForLog = {
				ok: true,
				status: "inProgress",
				inProgress: true,
				reason: "executionDeadline",
				deferred: true,
				scheduling: { continuation: continuation, watchdog: watchdog },
			};
			Logger.log("Auto-refresh worker deadline deferred with continuation and watchdog recovery.");
			return resultForLog;
		}
		if (isActiveRosterJobLockBusyError_(err)) {
			const lockRecovery = maybeClearStaleAutoRefreshLockAfterBusy_("autoRefreshWorkerTick lock busy recovery");
			if (lockRecovery && lockRecovery.cleared) {
				Logger.log(
					"autoRefreshWorkerTick cleared stale auto-refresh lock runId=%s taskId=%s ageMs=%s",
					String(lockRecovery.runId || ""),
					String(lockRecovery.taskId || ""),
					toNonNegativeInt_(lockRecovery.ageMs),
				);
			}
			scheduleAutoRefreshJobResume_();
			setAutoRefreshRunResult_("inProgress", "Auto-refresh worker deferred due to overlap with another active roster refresh/publish flow.", "", 0, "", startedAt, new Date().toISOString());
			resultForLog = { ok: true, status: "inProgress", inProgress: true, reason: "overlap", lockRecovery: lockRecovery };
			return resultForLog;
		}
		const message = errorMessage_(err);
		failCurrentAutoRefreshJobAfterError_(message);
		setAutoRefreshRunResult_("error", "Auto-refresh worker failed.", message, 0, "", startedAt, new Date().toISOString());
		Logger.log("autoRefreshWorkerTick failed: %s", message);
		resultForLog = { ok: false, status: "error", error: message };
		return resultForLog;
	} finally {
		if (!resultForLog || !resultForLog.quotaPaused) {
			maybeRepairCloudflareActiveRosterMirrorAfterAutoRefreshTick_("auto-refresh-worker-tick-mirror", resultForLog);
		}
		Logger.log(
			"autoRefreshWorkerTick end status=%s reason=%s elapsedMs=%s",
			String((resultForLog && resultForLog.status) || ""),
			String((resultForLog && resultForLog.reason) || ""),
			Math.max(0, Date.now() - tickStartMs),
		);
	}
}

function autoRefreshWorkerTick(eventRaw) {
	consumeAutoRefreshFiredTrigger_(eventRaw);
	return runWithExecutionDeadline_("auto-refresh-worker", AUTO_REFRESH_JOB_EXECUTION_BUDGET_MS, function () {
		return autoRefreshWorkerTickInternal_();
	}, {
		cleanupReserveMs: APP_SCRIPT_EXECUTION_CLEANUP_RESERVE_MS,
		recoveryScope: "autoRefresh",
	});
}

// Legacy one-shot trigger alias. Existing installed triggers with the old
// handler name should continue the new sharded queue instead of becoming no-ops.
function autoRefreshJobResumeTick(eventRaw) {
	return autoRefreshWorkerTick(eventRaw);
}

// Handle one-shot regular-war finalization attempts near war end.
function regularWarFinalizationTickInternal_() {
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

function regularWarFinalizationTick() {
	return runWithExecutionDeadline_("regular-war-finalization", AUTO_REFRESH_JOB_EXECUTION_BUDGET_MS, function () {
		return regularWarFinalizationTickInternal_();
	}, {
		cleanupReserveMs: APP_SCRIPT_EXECUTION_CLEANUP_RESERVE_MS,
		recoveryScope: "autoRefresh",
	});
}

/**
 * Replaces the active roster payload in Firebase Realtime Database and keeps publish backups in Firebase archive.
 * Called from Admin UI via google.script.run.publishRosterData(rosterData, password)
 */
