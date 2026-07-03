// Detached donation refresh trigger and overlay storage.

function parseDonationRefreshLockState_(raw) {
	const text = String(raw == null ? "" : raw).trim();
	if (!text) return null;
	try {
		const parsed = JSON.parse(text);
		const token = String((parsed && parsed.token) || "").trim();
		const owner = String((parsed && parsed.owner) || "").trim();
		const expiresAt = Number(parsed && parsed.expiresAt);
		if (!token || !isFinite(expiresAt)) return null;
		return {
			token: token,
			owner: owner,
			expiresAt: Math.floor(expiresAt),
		};
	} catch (err) {
		return null;
	}
}

function tryAcquireDonationRefreshLock_(ownerRaw, waitMsRaw) {
	const owner = String(ownerRaw == null ? "donation-refresh" : ownerRaw).trim() || "donation-refresh";
	const waitMs = Math.max(0, Number(waitMsRaw) || 0);
	const deadlineMs = Date.now() + waitMs;
	const props = PropertiesService.getScriptProperties();
	const token = Utilities.getUuid();

	while (true) {
		const scriptLock = LockService.getScriptLock();
		const remainingMs = waitMs > 0 ? Math.max(250, deadlineMs - Date.now()) : 250;
		const didLock = scriptLock.tryLock(Math.min(5000, remainingMs));
		if (didLock) {
			try {
				const nowMs = Date.now();
				const current = parseDonationRefreshLockState_(props.getProperty(DONATION_REFRESH_LOCK_KEY));
				if (!current || current.expiresAt <= nowMs) {
					props.setProperty(
						DONATION_REFRESH_LOCK_KEY,
						JSON.stringify({
							token: token,
							owner: owner,
							expiresAt: nowMs + DONATION_REFRESH_LOCK_LEASE_MS,
						}),
					);
					return { token: token, owner: owner };
				}
			} finally {
				scriptLock.releaseLock();
			}
		}
		if (waitMs <= 0 || Date.now() >= deadlineMs) return null;
		Utilities.sleep(ACTIVE_ROSTER_JOB_LOCK_POLL_MS);
	}
}

function releaseDonationRefreshLock_(tokenRaw) {
	const token = String(tokenRaw == null ? "" : tokenRaw).trim();
	if (!token) return false;
	const props = PropertiesService.getScriptProperties();
	const scriptLock = LockService.getScriptLock();
	const didLock = scriptLock.tryLock(5000);
	if (!didLock) return false;
	try {
		const current = parseDonationRefreshLockState_(props.getProperty(DONATION_REFRESH_LOCK_KEY));
		if (current && current.token === token) {
			props.deleteProperty(DONATION_REFRESH_LOCK_KEY);
			return true;
		}
		return false;
	} finally {
		scriptLock.releaseLock();
	}
}

function createDonationRefreshLockBusyError_(ownerRaw, waitMsRaw) {
	const err = new Error("Another donation refresh flow is running. Please wait and try again.");
	err.code = "donationRefreshLockBusy";
	err.lockOwner = String(ownerRaw == null ? "donation-refresh" : ownerRaw).trim() || "donation-refresh";
	err.lockWaitMs = Math.max(0, Number(waitMsRaw) || 0);
	return err;
}

function isDonationRefreshLockBusyError_(errRaw) {
	const err = errRaw && typeof errRaw === "object" ? errRaw : null;
	if (err && String(err.code || "").trim() === "donationRefreshLockBusy") return true;
	return errorMessage_(errRaw).toLowerCase().indexOf("another donation refresh flow is running") >= 0;
}

function withDonationRefreshLock_(ownerRaw, waitMsRaw, callback) {
	if (typeof callback !== "function") throw new Error("Donation refresh callback is required.");
	const owner = String(ownerRaw == null ? "donation-refresh" : ownerRaw).trim() || "donation-refresh";
	const waitMs = Math.max(0, Number(waitMsRaw) || 0);
	const acquired = tryAcquireDonationRefreshLock_(owner, waitMs);
	if (!acquired) throw createDonationRefreshLockBusyError_(owner, waitMs);
	try {
		return callback();
	} finally {
		releaseDonationRefreshLock_(acquired.token);
	}
}

function buildDonationRefreshSeasonPath_(seasonIdRaw, childPathRaw) {
	const seasonId = sanitizeDonationCycleKey_(seasonIdRaw);
	if (!seasonId) throw new Error("Donation refresh season id is required.");
	const base = buildFirebaseChildPath_(
		buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "bySeason"),
		encodeFirebaseObjectKey_(seasonId),
	);
	const childPath = normalizeFirebasePath_(childPathRaw);
	return childPath ? buildFirebaseChildPath_(base, childPath) : base;
}

function buildDonationRefreshSeasonTagPath_(seasonIdRaw, tagRaw) {
	const tag = normalizeTag_(tagRaw);
	if (!tag) throw new Error("Donation refresh player tag is required.");
	return buildDonationRefreshSeasonPath_(seasonIdRaw, "byTag/" + encodeFirebaseObjectKey_(tag));
}

function sanitizeDonationRefreshEntry_(entryRaw, seasonIdRaw, tagRaw) {
	const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
	const seasonId = sanitizeDonationCycleKey_(seasonIdRaw || entry.seasonId);
	const tag = normalizeTag_(tagRaw || entry.tag || (entry.identity && entry.identity.tag));
	if (!seasonId || !tag) return null;
	const donationCycles = entry.donationCycles && typeof entry.donationCycles === "object" ? entry.donationCycles : {};
	const ledgerRaw = entry.donationCycle || entry.ledger || donationCycles[seasonId];
	const ledger = sanitizeMetricsDonationCycleLedger_(ledgerRaw, seasonId);
	if (!ledger) return null;
	const updatedAtMs = parseIsoToMs_(entry.updatedAt || ledger.lastSeenAt);
	const clanTag = normalizeTag_(entry.clanTag || ledger.lastClanTag);
	const out = {
		tag: tag,
		name: String(entry.name == null ? "" : entry.name).trim(),
		seasonId: seasonId,
		donationCycle: ledger,
		updatedAt: updatedAtMs > 0 ? new Date(updatedAtMs).toISOString() : String(ledger.lastSeenAt || ""),
	};
	if (clanTag) out.clanTag = clanTag;
	const sourceVersionId = normalizeActiveVersionId_(entry.sourceVersionId);
	if (sourceVersionId) out.sourceVersionId = sourceVersionId;
	return out;
}

function getDonationLedgerLastSeenMs_(ledgerRaw) {
	const ledger = ledgerRaw && typeof ledgerRaw === "object" ? ledgerRaw : {};
	return parseIsoToMs_(ledger.lastSeenAt) || parseIsoToMs_(ledger.firstSeenAt) || 0;
}

function chooseLatestDonationLedger_(baseLedgerRaw, overlayLedgerRaw, seasonIdRaw) {
	const seasonId = sanitizeDonationCycleKey_(seasonIdRaw);
	const base = sanitizeMetricsDonationCycleLedger_(baseLedgerRaw, seasonId);
	const overlay = sanitizeMetricsDonationCycleLedger_(overlayLedgerRaw, seasonId);
	if (!base) return overlay;
	if (!overlay) return base;
	const baseMs = getDonationLedgerLastSeenMs_(base);
	const overlayMs = getDonationLedgerLastSeenMs_(overlay);
	return overlayMs >= baseMs ? overlay : base;
}

function readActiveDonationLedgersForTags_(versionIdRaw, seasonIdRaw, tagsRaw) {
	const versionId = normalizeActiveVersionId_(versionIdRaw);
	const seasonId = sanitizeDonationCycleKey_(seasonIdRaw);
	const tags = Array.isArray(tagsRaw) ? tagsRaw : [];
	const paths = [];
	const pathByTag = {};
	const seen = {};
	for (let i = 0; i < tags.length; i++) {
		const tag = normalizeTag_(tags[i]);
		if (!versionId || !seasonId || !tag || seen[tag]) continue;
		seen[tag] = true;
		const path = buildActiveVersionPath_(
			versionId,
			"playerMetrics/byTag/" + encodeFirebaseObjectKey_(tag) + "/donationCycles/" + encodeFirebaseObjectKey_(seasonId),
		);
		pathByTag[tag] = path;
		paths.push(path);
	}
	const encodedByPath = firebaseBatchGetJson_(paths);
	const out = {};
	const outTags = Object.keys(pathByTag);
	for (let i = 0; i < outTags.length; i++) {
		const tag = outTags[i];
		const ledger = sanitizeMetricsDonationCycleLedger_(decodeFirebaseObjectKeysRecursive_(encodedByPath[pathByTag[tag]]), seasonId);
		if (ledger) out[tag] = ledger;
	}
	return out;
}

function readDonationRefreshOverlayBySeason_(seasonIdRaw) {
	const seasonId = sanitizeDonationCycleKey_(seasonIdRaw);
	if (!seasonId) return { seasonId: "", byTag: {}, meta: null };
	const encoded = firebaseRequestJson_(buildDonationRefreshSeasonPath_(seasonId, ""), "GET");
	const decoded = decodeFirebaseObjectKeysRecursive_(encoded);
	const source = decoded && typeof decoded === "object" && !Array.isArray(decoded) ? decoded : {};
	const byTagRaw = source.byTag && typeof source.byTag === "object" ? source.byTag : {};
	const byTag = {};
	const keys = Object.keys(byTagRaw);
	for (let i = 0; i < keys.length; i++) {
		const tag = normalizeTag_(keys[i]);
		const entry = sanitizeDonationRefreshEntry_(byTagRaw[keys[i]], seasonId, tag);
		if (entry) byTag[entry.tag] = entry;
	}
	return {
		seasonId: seasonId,
		byTag: byTag,
		meta: source.meta && typeof source.meta === "object" ? source.meta : null,
	};
}

function mergeDonationRefreshOverlayIntoPlayerMetricsByTag_(playerMetricsByTagRaw, overlayByTagRaw, seasonIdRaw) {
	const seasonId = sanitizeDonationCycleKey_(seasonIdRaw);
	const baseByTag = playerMetricsByTagRaw && typeof playerMetricsByTagRaw === "object" ? playerMetricsByTagRaw : {};
	const overlayByTag = overlayByTagRaw && typeof overlayByTagRaw === "object" ? overlayByTagRaw : {};
	const out = {};
	const baseKeys = Object.keys(baseByTag);
	for (let i = 0; i < baseKeys.length; i++) out[baseKeys[i]] = baseByTag[baseKeys[i]];
	if (!seasonId) return out;
	const overlayKeys = Object.keys(overlayByTag);
	for (let i = 0; i < overlayKeys.length; i++) {
		const tag = normalizeTag_(overlayKeys[i]);
		const overlayEntry = sanitizeDonationRefreshEntry_(overlayByTag[overlayKeys[i]], seasonId, tag);
		if (!overlayEntry) continue;
		const currentEntry = out[tag] && typeof out[tag] === "object" ? out[tag] : {};
		const currentCycles = currentEntry.donationCycles && typeof currentEntry.donationCycles === "object" ? currentEntry.donationCycles : {};
		const currentLedger = sanitizeMetricsDonationCycleLedger_(currentCycles[seasonId], seasonId);
		const overlayLedger = sanitizeMetricsDonationCycleLedger_(overlayEntry.donationCycle, seasonId);
		const chosen = chooseLatestDonationLedger_(currentLedger, overlayLedger, seasonId);
		if (!chosen || JSON.stringify(chosen) !== JSON.stringify(overlayLedger)) continue;
		const nextEntry = JSON.parse(JSON.stringify(currentEntry || {}));
		const identity = nextEntry.identity && typeof nextEntry.identity === "object" ? nextEntry.identity : {};
		if (!identity.tag) identity.tag = tag;
		if (!identity.name && overlayEntry.name) identity.name = overlayEntry.name;
		nextEntry.identity = identity;
		const nextCycles = nextEntry.donationCycles && typeof nextEntry.donationCycles === "object" ? nextEntry.donationCycles : {};
		nextCycles[seasonId] = chosen;
		nextEntry.donationCycles = nextCycles;
		out[tag] = nextEntry;
	}
	return out;
}

function listDonationRefreshConnectedClanTags_(activeVersionIdRaw, manifestRaw) {
	const manifest = manifestRaw && typeof manifestRaw === "object" ? manifestRaw : {};
	const tagsRaw = Array.isArray(manifest.connectedClanTags) ? manifest.connectedClanTags : [];
	const tags = [];
	const seen = {};
	for (let i = 0; i < tagsRaw.length; i++) {
		const tag = normalizeTag_(tagsRaw[i]);
		if (!tag || seen[tag]) continue;
		seen[tag] = true;
		tags.push(tag);
	}
	if (tags.length) return tags;
	const rosterShardResult = readActiveVersionRosterShards_(activeVersionIdRaw, manifest);
	const rosters = Array.isArray(rosterShardResult && rosterShardResult.rosters) ? rosterShardResult.rosters : [];
	return listConnectedClanTagsForMetrics_({ rosters: rosters }, "");
}

function readDonationRefreshSource_() {
	const versionId = readPublishedActiveVersionId_();
	if (!versionId) throw new Error("No published active version is available for donation refresh.");
	const encodedManifest = firebaseRequestJson_(buildActiveVersionPath_(versionId, "manifest"), "GET");
	if (!encodedManifest || typeof encodedManifest !== "object" || Array.isArray(encodedManifest)) {
		throw new Error("Missing active version manifest for donation refresh.");
	}
	const manifest = decodeFirebaseObjectKeysRecursive_(encodedManifest);
	const clanTags = listDonationRefreshConnectedClanTags_(versionId, manifest);
	return {
		versionId: versionId,
		manifest: manifest,
		clanTags: clanTags,
	};
}

function collectDonationRefreshSnapshots_(clanTagsRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	if (options.prefetched && typeof options.prefetched === "object") return options.prefetched;
	return prefetchClanMembersSnapshotsByTag_(clanTagsRaw, {
		batchSize: Math.max(1, toNonNegativeInt_(options.batchSize || AUTO_REFRESH_PREFETCH_BATCH_SIZE)),
		batchDelayMs: Math.max(0, toNonNegativeInt_(options.batchDelayMs || AUTO_REFRESH_PREFETCH_BATCH_DELAY_MS)),
	});
}

function buildDonationRefreshEntryForSnapshot_(snapshotRaw, clanTagRaw, seasonIdRaw, sourceVersionIdRaw, baseLedgerRaw, overlayEntryRaw) {
	const snapshot = sanitizeMetricsSnapshotPayload_(snapshotRaw, "");
	const clanTag = normalizeTag_(clanTagRaw || (snapshot && snapshot.clanTag));
	const seasonId = sanitizeDonationCycleKey_(seasonIdRaw);
	if (!snapshot || !clanTag || !seasonId) return null;
	const overlayEntry = sanitizeDonationRefreshEntry_(overlayEntryRaw, seasonId, snapshot.tag);
	const initialLedger = chooseLatestDonationLedger_(baseLedgerRaw, overlayEntry && overlayEntry.donationCycle, seasonId);
	const entry = createEmptyPlayerMetricsEntry_(snapshot.tag, snapshot.name || "");
	if (initialLedger) entry.donationCycles[seasonId] = initialLedger;
	const captureCtx = buildMetricsCaptureContext_(snapshot.capturedAt);
	captureCtx.clanTag = clanTag;
	const changed = updateDonationCycleLedgerForSnapshot_(entry, Object.assign({}, snapshot, { clanTag: clanTag }), captureCtx);
	const ledger = sanitizeMetricsDonationCycleLedger_(entry.donationCycles && entry.donationCycles[seasonId], seasonId);
	if (!ledger) return null;
	const sourceVersionId = normalizeActiveVersionId_(sourceVersionIdRaw);
	const out = sanitizeDonationRefreshEntry_(
		{
			tag: normalizeTag_(snapshot.tag),
			name: String(snapshot.name || "").trim(),
			seasonId: seasonId,
			donationCycle: ledger,
			updatedAt: captureCtx.capturedAt,
			clanTag: clanTag,
			sourceVersionId: sourceVersionId,
		},
		seasonId,
		snapshot.tag,
	);
	if (!out) return null;
	out.changed = changed || JSON.stringify(out.donationCycle) !== JSON.stringify(overlayEntry && overlayEntry.donationCycle);
	return out;
}

function cleanupDonationRefreshSeasonRetentionWrites_() {
	const keepCount = Math.max(1, toNonNegativeInt_(FIREBASE_DONATION_REFRESH_SEASON_KEEP_COUNT) || 16);
	let keys = [];
	try {
		keys = listFirebaseChildKeys_(buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "bySeason"));
	} catch (err) {
		Logger.log("Donation refresh retention key read failed: %s", errorMessage_(err));
		return [];
	}
	const seasons = [];
	for (let i = 0; i < keys.length; i++) {
		let decoded = keys[i];
		try {
			decoded = decodeFirebaseObjectKey_(keys[i]);
		} catch (err) {
			decoded = keys[i];
		}
		const seasonId = sanitizeDonationCycleKey_(decoded);
		if (!seasonId) continue;
		seasons.push({ key: keys[i], seasonId: seasonId, sort: getDonationCycleSortValue_({ seasonId: seasonId }, seasonId) });
	}
	seasons.sort((left, right) => left.sort - right.sort || (left.seasonId < right.seasonId ? -1 : left.seasonId > right.seasonId ? 1 : 0));
	const writes = [];
	for (let i = 0; i < seasons.length - keepCount; i++) {
		writes.push({
			path: buildFirebaseChildPath_(buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "bySeason"), seasons[i].key),
			payload: null,
		});
	}
	return writes;
}

function setDonationRefreshRunResult_(statusRaw, summaryRaw, errorRaw, startedAtRaw, finishedAtRaw, extraRaw) {
	const status = String(statusRaw == null ? "" : statusRaw).trim() || "error";
	const summary = String(summaryRaw == null ? "" : summaryRaw).trim().slice(0, 500);
	const error = String(errorRaw == null ? "" : errorRaw).trim().slice(0, 2000);
	const startedAt = String(startedAtRaw == null ? "" : startedAtRaw).trim() || new Date().toISOString();
	const finishedAt = String(finishedAtRaw == null ? "" : finishedAtRaw).trim() || new Date().toISOString();
	const extra = extraRaw && typeof extraRaw === "object" ? extraRaw : {};
	const props = PropertiesService.getScriptProperties();
	const values = {
		[DONATION_REFRESH_LAST_RUN_STARTED_AT_PROPERTY]: startedAt,
		[DONATION_REFRESH_LAST_RUN_FINISHED_AT_PROPERTY]: finishedAt,
		[DONATION_REFRESH_LAST_RUN_STATUS_PROPERTY]: status,
		[DONATION_REFRESH_LAST_RUN_SUMMARY_PROPERTY]: summary,
		[DONATION_REFRESH_LAST_RUN_ERROR_PROPERTY]: error,
	};
	const seasonId = sanitizeDonationCycleKey_(extra.seasonId);
	if (seasonId) values[DONATION_REFRESH_LAST_SEASON_ID_PROPERTY] = seasonId;
	const writeAt = String(extra.writtenAt == null ? "" : extra.writtenAt).trim();
	if (writeAt) values[DONATION_REFRESH_LAST_WRITE_AT_PROPERTY] = writeAt;
	props.setProperties(values, false);
}

function runDonationRefreshCore_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const startedAt = String(options.startedAt || new Date().toISOString());
	return withDonationRefreshLock_(options.lockOwner || "donation-refresh", Math.max(0, Number(options.lockWaitMs) || 0), function () {
		const source = readDonationRefreshSource_();
		const clanTags = Array.isArray(source.clanTags) ? source.clanTags : [];
		if (!clanTags.length) {
			return { ok: true, status: "skipped", skipped: true, reason: "noConnectedClans", seasonId: "" };
		}
		const fetched = collectDonationRefreshSnapshots_(clanTags, options);
		const snapshotByClanTag = fetched.snapshotByClanTag && typeof fetched.snapshotByClanTag === "object" ? fetched.snapshotByClanTag : {};
		const errorByClanTag = fetched.errorByClanTag && typeof fetched.errorByClanTag === "object" ? fetched.errorByClanTag : {};
		const capturedAt = String(options.capturedAt || (snapshotByClanTag[clanTags[0]] && snapshotByClanTag[clanTags[0]].capturedAt) || new Date().toISOString());
		const captureCtx = buildMetricsCaptureContext_(capturedAt);
		const cycle = resolveDonationCycleForMetricsCapture_(captureCtx);
		const seasonId = sanitizeDonationCycleKey_(cycle && cycle.seasonId);
		if (!seasonId) throw new Error("Unable to resolve donation refresh season.");

		const snapshots = [];
		const touchedTags = [];
		const touchedTagSet = {};
		let capturedClans = 0;
		for (let i = 0; i < clanTags.length; i++) {
			const clanTag = clanTags[i];
			const snapshot = snapshotByClanTag[clanTag] && typeof snapshotByClanTag[clanTag] === "object" ? snapshotByClanTag[clanTag] : null;
			if (!snapshot) continue;
			capturedClans++;
			const members = Array.isArray(snapshot.metricsMembers) ? snapshot.metricsMembers : [];
			for (let j = 0; j < members.length; j++) {
				const member = sanitizeMetricsSnapshotPayload_(members[j], "");
				const tag = normalizeTag_(member && member.tag);
				if (!member || !tag) continue;
				member.tag = tag;
				member.clanTag = clanTag;
				member.capturedAt = String(snapshot.capturedAt || capturedAt);
				snapshots.push({ clanTag: clanTag, member: member });
				if (!touchedTagSet[tag]) {
					touchedTagSet[tag] = true;
					touchedTags.push(tag);
				}
			}
		}

		const overlay = readDonationRefreshOverlayBySeason_(seasonId);
		const overlayEntries = overlay && overlay.byTag && typeof overlay.byTag === "object" ? overlay.byTag : {};
		const baseReadTags = [];
		for (let i = 0; i < touchedTags.length; i++) {
			const tag = normalizeTag_(touchedTags[i]);
			if (tag && !overlayEntries[tag]) baseReadTags.push(tag);
		}
		const baseLedgers = readActiveDonationLedgersForTags_(source.versionId, seasonId, baseReadTags);
		const writes = [];
		let updatedPlayers = 0;
		for (let i = 0; i < snapshots.length; i++) {
			const item = snapshots[i];
			const tag = normalizeTag_(item.member && item.member.tag);
			const entry = buildDonationRefreshEntryForSnapshot_(
				item.member,
				item.clanTag,
				seasonId,
				source.versionId,
				baseLedgers[tag],
				overlayEntries[tag],
			);
			if (!entry) continue;
			if (entry.changed) updatedPlayers++;
			delete entry.changed;
			writes.push({
				path: buildDonationRefreshSeasonTagPath_(seasonId, tag),
				payload: encodeFirebaseObjectKeysRecursive_(entry),
			});
		}
		const finishedAt = new Date().toISOString();
		const errorKeys = Object.keys(errorByClanTag);
		const meta = {
			seasonId: seasonId,
			startsAt: cycle.startsAt,
			endsAt: cycle.endsAt,
			updatedAt: finishedAt,
			sourceVersionId: source.versionId,
			clanCount: clanTags.length,
			capturedClanCount: capturedClans,
			playerCount: touchedTags.length,
			updatedPlayerCount: updatedPlayers,
			requestCount: toNonNegativeInt_(fetched.requestCount || clanTags.length),
			errorCount: errorKeys.length,
			errors: errorKeys.slice(0, 10).map((clanTag) => ({
				clanTag: clanTag,
				message: errorMessage_(errorByClanTag[clanTag]),
			})),
		};
		writes.push({ path: buildDonationRefreshSeasonPath_(seasonId, "meta"), payload: encodeFirebaseObjectKeysRecursive_(meta) });
		writes.push({ path: buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "current"), payload: encodeFirebaseObjectKeysRecursive_(meta) });
		const cleanupWrites = cleanupDonationRefreshSeasonRetentionWrites_();
		for (let i = 0; i < cleanupWrites.length; i++) writes.push(cleanupWrites[i]);
		firebaseBatchPutJson_(writes);
		return {
			ok: errorKeys.length < clanTags.length,
			status: errorKeys.length ? "partial" : "ok",
			seasonId: seasonId,
			sourceVersionId: source.versionId,
			clanCount: clanTags.length,
			capturedClanCount: capturedClans,
			playerCount: touchedTags.length,
			updatedPlayerCount: updatedPlayers,
			errorCount: errorKeys.length,
			writtenAt: finishedAt,
		};
	});
}

function isDonationRefreshEnabled_() {
	const raw = String(PropertiesService.getScriptProperties().getProperty(DONATION_REFRESH_ENABLED_PROPERTY) || "")
		.trim()
		.toLowerCase();
	return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function listDonationRefreshTriggers_() {
	const all = ScriptApp.getProjectTriggers();
	return all.filter((trigger) => {
		try {
			return String(trigger.getHandlerFunction() || "") === DONATION_REFRESH_HANDLER_NAME;
		} catch (err) {
			return false;
		}
	});
}

function removeDonationRefreshTriggers_() {
	const triggers = listDonationRefreshTriggers_();
	let removed = 0;
	for (let i = 0; i < triggers.length; i++) {
		try {
			ScriptApp.deleteTrigger(triggers[i]);
			removed++;
		} catch (err) {
			Logger.log("Unable to delete donation-refresh trigger: %s", errorMessage_(err));
		}
	}
	PropertiesService.getScriptProperties().deleteProperty(DONATION_REFRESH_TRIGGER_ID_PROPERTY);
	return removed;
}

function ensureSingleDonationRefreshTrigger_() {
	const props = PropertiesService.getScriptProperties();
	const configuredId = String(props.getProperty(DONATION_REFRESH_TRIGGER_ID_PROPERTY) || "").trim();
	const triggers = listDonationRefreshTriggers_();
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
			Logger.log("Unable to delete duplicate donation-refresh trigger: %s", errorMessage_(err));
		}
	}
	if (!keep) {
		const timeBuilder = ScriptApp.newTrigger(DONATION_REFRESH_HANDLER_NAME).timeBased();
		const cadenceBuilder = typeof timeBuilder.everyMinutes === "function"
			? timeBuilder.everyMinutes(DONATION_REFRESH_INTERVAL_MINUTES)
			: timeBuilder.everyHours(1);
		keep = cadenceBuilder.create();
	}
	return keep;
}

function reconcileDonationRefreshTriggerState_() {
	const props = PropertiesService.getScriptProperties();
	if (!isDonationRefreshEnabled_()) {
		removeDonationRefreshTriggers_();
		props.deleteProperty(DONATION_REFRESH_TRIGGER_ID_PROPERTY);
		return { enabled: false, triggerId: "", hasTrigger: false };
	}
	const trigger = ensureSingleDonationRefreshTrigger_();
	const triggerId = getTriggerUniqueId_(trigger);
	if (triggerId) props.setProperty(DONATION_REFRESH_TRIGGER_ID_PROPERTY, triggerId);
	else props.deleteProperty(DONATION_REFRESH_TRIGGER_ID_PROPERTY);
	return { enabled: true, triggerId: triggerId, hasTrigger: !!triggerId };
}

function readDonationRefreshSettings_() {
	const props = PropertiesService.getScriptProperties();
	const triggerId = String(props.getProperty(DONATION_REFRESH_TRIGGER_ID_PROPERTY) || "").trim();
	return {
		enabled: isDonationRefreshEnabled_(),
		intervalMinutes: DONATION_REFRESH_INTERVAL_MINUTES,
		triggerId: triggerId,
		hasTrigger: !!triggerId,
		lastRunStartedAt: String(props.getProperty(DONATION_REFRESH_LAST_RUN_STARTED_AT_PROPERTY) || "").trim(),
		lastRunFinishedAt: String(props.getProperty(DONATION_REFRESH_LAST_RUN_FINISHED_AT_PROPERTY) || "").trim(),
		lastRunStatus: String(props.getProperty(DONATION_REFRESH_LAST_RUN_STATUS_PROPERTY) || "").trim(),
		lastRunSummary: String(props.getProperty(DONATION_REFRESH_LAST_RUN_SUMMARY_PROPERTY) || "").trim(),
		lastRunError: String(props.getProperty(DONATION_REFRESH_LAST_RUN_ERROR_PROPERTY) || "").trim(),
		lastSeasonId: String(props.getProperty(DONATION_REFRESH_LAST_SEASON_ID_PROPERTY) || "").trim(),
		lastWriteAt: String(props.getProperty(DONATION_REFRESH_LAST_WRITE_AT_PROPERTY) || "").trim(),
	};
}

function donationRefreshTick() {
	const startedAt = new Date().toISOString();
	if (!isDonationRefreshEnabled_()) {
		removeDonationRefreshTriggers_();
		setDonationRefreshRunResult_("skipped", "Donation refresh skipped because it is disabled.", "", startedAt, new Date().toISOString(), {});
		return { ok: true, status: "skipped", skipped: true, reason: "disabled" };
	}
	try {
		const result = runDonationRefreshCore_({ startedAt: startedAt, lockOwner: "donation-refresh-trigger", lockWaitMs: 0 });
		const summary = result && result.skipped
			? "Donation refresh skipped: " + String(result.reason || "no work") + "."
			: "Donation refresh updated " + toNonNegativeInt_(result && result.playerCount) + " player(s) across " + toNonNegativeInt_(result && result.capturedClanCount) + " clan(s).";
		setDonationRefreshRunResult_(result.status || "ok", summary, "", startedAt, new Date().toISOString(), {
			seasonId: result.seasonId,
			writtenAt: result.writtenAt,
		});
		return result;
	} catch (err) {
		const status = isDonationRefreshLockBusyError_(err) ? "skipped" : "error";
		const summary = status === "skipped" ? "Donation refresh skipped due to overlap with another donation refresh." : "Donation refresh failed.";
		setDonationRefreshRunResult_(status, summary, status === "error" ? errorMessage_(err) : "", startedAt, new Date().toISOString(), {});
		if (status === "skipped") return { ok: true, status: "skipped", skipped: true, reason: "overlap" };
		Logger.log("donationRefreshTick failed: %s", errorMessage_(err));
		return { ok: false, status: "error", error: errorMessage_(err) };
	}
}

function runDonationRefreshNow(password) {
	assertAdminPassword_(password);
	const startedAt = new Date().toISOString();
	const result = runDonationRefreshCore_({ startedAt: startedAt, lockOwner: "donation-refresh-manual", lockWaitMs: ACTIVE_ROSTER_JOB_LOCK_WAIT_MS });
	const summary = result && result.skipped
		? "Donation refresh skipped: " + String(result.reason || "no work") + "."
		: "Donation refresh updated " + toNonNegativeInt_(result && result.playerCount) + " player(s) across " + toNonNegativeInt_(result && result.capturedClanCount) + " clan(s).";
	setDonationRefreshRunResult_(result.status || "ok", summary, "", startedAt, new Date().toISOString(), {
		seasonId: result.seasonId,
		writtenAt: result.writtenAt,
	});
	return result;
}
