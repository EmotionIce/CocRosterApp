// Publish flow and auto-refresh trigger orchestration.

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

		// Protect against accidental metric loss when preview payload has no metrics.
		const incomingMetricCount = countPlayerMetricsEntries_(validated && validated.playerMetrics);
		if (incomingMetricCount < 1) {
			try {
				const activeMetricCount = countPlayerMetricsEntries_(activeData && activeData.playerMetrics);
				if (activeMetricCount > 0) {
					validated.playerMetrics = sanitizePlayerMetricsStore_(activeData.playerMetrics, publishedAt);
					validationStepLabel = "validate payload after metrics preservation";
					validated = validateRosterData_(validated);
					duplicateDiagnosticsRosterData = validated;
					Logger.log("publishRosterData: preserved existing playerMetrics (entries=%s) because incoming payload had none.", activeMetricCount);
				}
			} catch (err) {
				Logger.log("publishRosterData: unable to preserve existing playerMetrics fallback: %s", errorMessage_(err));
			}
		}

		const lowCoverageRosters = incomingMetricCount > 0 ? listRostersNeedingMetricsCoverageRepair_(validated, PLAYER_METRICS_MIN_ROSTER_COVERAGE_FOR_PUBLISH) : [];
		if (lowCoverageRosters.length > 0) {
			Logger.log(
				"publishRosterData: detected %s roster(s) below metrics coverage threshold %.2f; running targeted recapture.",
				lowCoverageRosters.length,
				PLAYER_METRICS_MIN_ROSTER_COVERAGE_FOR_PUBLISH,
			);
		}

		// Do publish-time capture when payload has no metrics, or when one/more rosters have low metrics coverage.
		const shouldRunPublishMetricsCapture = incomingMetricCount < 1 || lowCoverageRosters.length > 0;
		if (shouldRunPublishMetricsCapture) {
			try {
				const rosters = Array.isArray(validated && validated.rosters) ? validated.rosters : [];
				const rosterCaptureQueue = [];
				if (incomingMetricCount < 1) {
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
				let profileAttempted = 0;
				let profileEnriched = 0;
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
							metricsProfileMode: "always",
						});
						if (capture) {
							capturedClans += toNonNegativeInt_(capture.capturedClans) > 0 ? 1 : 0;
							recorded += toNonNegativeInt_(capture.recorded);
							updated += toNonNegativeInt_(capture.updated);
							profileAttempted += toNonNegativeInt_(capture.profileAttempted);
							profileEnriched += toNonNegativeInt_(capture.profileEnriched);
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
					"publishRosterData metrics capture attempted=%s captured=%s recorded=%s updated=%s entries=%s profileAttempted=%s profileEnriched=%s errors=%s repairedRosters=%s",
					attemptedClans,
					capturedClans,
					recorded,
					updated,
					countPlayerMetricsEntries_(validated && validated.playerMetrics),
					profileAttempted,
					profileEnriched,
					errors.length,
					lowCoverageRosters.length,
				);
			} catch (err) {
				Logger.log("publishRosterData: fallback metrics capture failed: %s", errorMessage_(err));
			}
		} else {
			Logger.log("publishRosterData: skipped live metrics capture because incoming payload already has %s metric entries.", incomingMetricCount);
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
		markActiveDataWriteSuccess_(publishedAt);
		return meta;
	} catch (err) {
		rethrowWithDuplicateRosterTagDetails_(validationStepLabel, err, duplicateDiagnosticsRosterData);
	}
}

function writeAutoRefreshedActiveRosterData_(sourceSnapshotRaw, refreshedRosterDataRaw) {
	const sourceSnapshot = sourceSnapshotRaw && typeof sourceSnapshotRaw === "object" ? sourceSnapshotRaw : readActiveRosterSnapshot_();
	const sourceData = validateRosterData_(sourceSnapshot.rosterData);
	const refreshedData = validateRosterData_(refreshedRosterDataRaw);
	const changed = hasActiveRosterPayloadChanged_(sourceData, refreshedData);
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
		};
	}

	const writtenAt = new Date().toISOString();
	const payloadToWrite = withRosterLastUpdatedAt_(refreshedData, writtenAt);
	const counts = countRosterPayload_(payloadToWrite);
	const writeResult = replaceActiveRosterData_(payloadToWrite, { sourceSnapshot: sourceSnapshot });
	const archiveDate = getServerDateString_(new Date());
	let archiveCreated = false;
	try {
		const archiveResult = createAutoRefreshDailyArchiveIfNeeded_(archiveDate, payloadToWrite);
		archiveCreated = !!archiveResult.created;
		if (archiveResult.archiveDate) {
			PropertiesService.getScriptProperties().setProperty(AUTO_REFRESH_LAST_ARCHIVE_DATE_PROPERTY, archiveResult.archiveDate);
		}
	} catch (err) {
		Logger.log("Unable to create auto-refresh daily archive: %s", errorMessage_(err));
	}
	const archiveCleanupDeleted = cleanupOldAutoRefreshDailyArchives_();
	firebaseRequestJson_(FIREBASE_META_PATH, "PATCH", {
		layoutVersion: FIREBASE_LAYOUT_VERSION,
		lastAutoRefreshWriteAt: writtenAt,
		lastAutoRefreshArchiveDate: archiveDate,
		lastAutoRefreshArchiveCleanupDeleted: archiveCleanupDeleted,
	});
	markActiveDataWriteSuccess_(writtenAt);

	return {
		changed: true,
		written: true,
		writtenAt: writtenAt,
		replacedCount: writeResult.replacedCount,
		playerCount: counts.playerCount,
		noteCount: counts.noteCount,
		rosterCount: Array.isArray(payloadToWrite.rosters) ? payloadToWrite.rosters.length : 0,
		archiveCreated: archiveCreated,
		archiveDate: archiveDate,
		archiveCleanupDeleted: archiveCleanupDeleted,
	};
}

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

function isAutoRefreshEnabled_() {
	const raw = String(PropertiesService.getScriptProperties().getProperty(AUTO_REFRESH_ENABLED_PROPERTY) || "")
		.trim()
		.toLowerCase();
	return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function getTriggerUniqueId_(trigger) {
	if (!trigger || typeof trigger !== "object" || typeof trigger.getUniqueId !== "function") return "";
	try {
		return String(trigger.getUniqueId() || "").trim();
	} catch (err) {
		return "";
	}
}

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
	};
}

function autoRefreshActiveRosterTick() {
	const startedAt = new Date().toISOString();
	let runIssueCount = 0;
	let runIssueSummary = "";

	if (!isAutoRefreshEnabled_()) {
		setAutoRefreshRunResult_("skipped", "Auto-refresh skipped because it is disabled.", "", 0, "", startedAt, new Date().toISOString());
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
				beforeRun: function () {
					if (!isRecentSuccessfulActiveWrite_()) return null;
					return {
						skip: true,
						reason: "cooldown",
						lastWriteAt: getLastSuccessfulActiveWriteAt_(),
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
				let summary = "Auto-refresh skipped: active data was written recently (" + (lastWriteAt || "unknown") + ").";
				try {
					const cleanupDeleted = cleanupOldAutoRefreshDailyArchives_();
					if (cleanupDeleted > 0) {
						summary += " Cleaned " + cleanupDeleted + " stale daily archive(s).";
					}
				} catch (cleanupErr) {
					Logger.log("Unable to cleanup stale auto-refresh archives: %s", errorMessage_(cleanupErr));
				}
				setAutoRefreshRunResult_("skipped", summary, "", 0, "", startedAt, new Date().toISOString());
				return { ok: true, skipped: true, reason: "cooldown", lastWriteAt: lastWriteAt };
			}
			setAutoRefreshRunResult_("skipped", "Auto-refresh skipped.", "", 0, "", startedAt, new Date().toISOString());
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
			try {
				const cleanupDeleted = cleanupOldAutoRefreshDailyArchives_();
				if (cleanupDeleted > 0) {
					summary += " Cleaned " + cleanupDeleted + " stale daily archive(s).";
				}
			} catch (cleanupErr) {
				Logger.log("Unable to cleanup stale auto-refresh archives: %s", errorMessage_(cleanupErr));
			}
		}

		setAutoRefreshRunResult_("ok", summary, "", runIssueCount, runIssueSummary, startedAt, new Date().toISOString());
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
			return { ok: true, skipped: true, reason: "overlap" };
		}
		const message = errorMessage_(err);
		setAutoRefreshRunResult_("error", "Auto-refresh run failed.", message, runIssueCount, runIssueSummary, startedAt, new Date().toISOString());
		Logger.log("autoRefreshActiveRosterTick failed: %s", message);
		return { ok: false, error: message };
	}
}

/**
 * Replaces the active roster payload in Firebase Realtime Database and keeps publish backups in Firebase archive.
 * Called from Admin UI via google.script.run.publishRosterData(rosterData, password)
 */
