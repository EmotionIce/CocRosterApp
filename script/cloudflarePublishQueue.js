// Durable asynchronous Cloudflare mirror queue. Firebase remains canonical.
// This queue owns queued-v2 mutable pointer writes and never uses the active-roster lock.

function getCloudflarePublicationMode_() {
	const properties = PropertiesService.getScriptProperties();
	const configured = typeof getOptionalScriptProperty_ === "function"
		? getOptionalScriptProperty_(CLOUDFLARE_PUBLICATION_MODE_PROPERTY)
		: properties.getProperty(CLOUDFLARE_PUBLICATION_MODE_PROPERTY);
	const raw = String(configured || "").trim().toLowerCase();
	if (raw === CLOUDFLARE_PUBLICATION_MODE_QUEUED_V2 || raw === CLOUDFLARE_PUBLICATION_MODE_DISABLED || raw === CLOUDFLARE_PUBLICATION_MODE_LEGACY_MANUAL) return raw;
	// Missing configuration is intentionally safe: the queue is staged but not active.
	return CLOUDFLARE_PUBLICATION_MODE_LEGACY_MANUAL;
}

function isCloudflareQueuedPublicationEnabled_() {
	const publicDataEnabled = typeof isCloudflarePublicDataEnabled_ !== "function" || isCloudflarePublicDataEnabled_();
	return getCloudflarePublicationMode_() === CLOUDFLARE_PUBLICATION_MODE_QUEUED_V2 && publicDataEnabled;
}

function getCloudflarePublicDataPublishV2Endpoint_() {
	const legacy = getCloudflarePublicDataPublishEndpoint_();
	if (!legacy) return "";
	return legacy.replace(/\/api\/internal\/public-data\/publish$/i, "/api/internal/public-data/publish-v2");
}

function createCloudflareQueueToken_() {
	try {
		return Utilities.getUuid();
	} catch (err) {
		return String(Date.now()) + "-" + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(Date.now()))).slice(0, 20);
	}
}

function parseCloudflarePublishQueueLockState_(raw) {
	const text = String(raw == null ? "" : raw).trim();
	if (!text) return null;
	try {
		const parsed = JSON.parse(text);
		const token = String((parsed && parsed.token) || "").trim();
		const expiresAt = Number(parsed && parsed.expiresAt);
		if (!token || !isFinite(expiresAt)) return null;
		return {
			token: token,
			owner: String((parsed && parsed.owner) || "").trim(),
			expiresAt: Math.floor(expiresAt),
		};
	} catch (err) {
		return null;
	}
}

function tryAcquireCloudflarePublishQueueLease_(ownerRaw, waitMsRaw) {
	const owner = String(ownerRaw || "cloudflare-publish-worker").trim() || "cloudflare-publish-worker";
	const waitMs = Math.max(0, Number(waitMsRaw) || 0);
	const deadline = Date.now() + waitMs;
	const props = PropertiesService.getScriptProperties();
	const token = createCloudflareQueueToken_();
	while (true) {
		const lock = LockService.getScriptLock();
		const locked = lock.tryLock(Math.min(5000, Math.max(250, deadline - Date.now())));
		if (locked) {
			try {
				const now = Date.now();
				const current = parseCloudflarePublishQueueLockState_(props.getProperty(CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY));
				if (!current || current.expiresAt <= now) {
					props.setProperty(CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY, JSON.stringify({
						token: token,
						owner: owner,
						expiresAt: now + CLOUDFLARE_PUBLISH_QUEUE_LOCK_LEASE_MS,
					}));
					return { token: token, owner: owner };
				}
			} finally {
				lock.releaseLock();
			}
		}
		if (waitMs <= 0 || Date.now() >= deadline) return null;
		Utilities.sleep(CLOUDFLARE_PUBLISH_QUEUE_LOCK_POLL_MS);
	}
}

function renewCloudflarePublishQueueLease_(tokenRaw) {
	const token = String(tokenRaw || "").trim();
	if (!token) return false;
	const props = PropertiesService.getScriptProperties();
	const lock = LockService.getScriptLock();
	if (!lock.tryLock(5000)) return false;
	try {
		const current = parseCloudflarePublishQueueLockState_(props.getProperty(CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY));
		if (!current || current.token !== token) return false;
		current.expiresAt = Date.now() + CLOUDFLARE_PUBLISH_QUEUE_LOCK_LEASE_MS;
		props.setProperty(CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY, JSON.stringify(current));
		return true;
	} finally {
		lock.releaseLock();
	}
}

function releaseCloudflarePublishQueueLease_(tokenRaw) {
	const token = String(tokenRaw || "").trim();
	if (!token) return false;
	const props = PropertiesService.getScriptProperties();
	const lock = LockService.getScriptLock();
	if (!lock.tryLock(5000)) return false;
	try {
		const current = parseCloudflarePublishQueueLockState_(props.getProperty(CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY));
		if (!current || current.token !== token) return false;
		props.deleteProperty(CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY);
		return true;
	} finally {
		lock.releaseLock();
	}
}

function createEmptyCloudflarePublishQueueState_() {
	return {
		schemaVersion: 2,
		paused: false,
		nextRevision: 0,
		nextDispatchGeneration: 0,
		active: {
			targetVersionId: "",
			targetGeneration: 0,
			phase: "idle",
			cursor: 0,
			committedVersionId: "",
			updatedAt: "",
		},
		dirty: {
			events: {},
			cwlAggregates: {},
		donationSeasons: {},
			cwlLeagueSignups: null,
			seasonPointers: null,
			relevantSnapshot: null,
			bootstrap: null,
		},
		retry: {
			attempt: 0,
			nextAttemptAt: "",
			lastError: "",
			lastFailureAt: "",
		},
		lastSuccessAt: "",
		lastBatch: null,
		lastDriftRepairAt: "",
		initializedAt: "",
		updatedAt: "",
	};
}

function normalizeCloudflarePublishQueueState_(raw) {
	const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
	const empty = createEmptyCloudflarePublishQueueState_();
	const activeRaw = source.active && typeof source.active === "object" ? source.active : {};
	const dirtyRaw = source.dirty && typeof source.dirty === "object" ? source.dirty : {};
	const retryRaw = source.retry && typeof source.retry === "object" ? source.retry : {};
	return {
		schemaVersion: 2,
		paused: source.paused === true,
		nextRevision: Math.max(0, toNonNegativeInt_(source.nextRevision)),
		nextDispatchGeneration: Math.max(0, toNonNegativeInt_(source.nextDispatchGeneration)),
		active: {
			targetVersionId: normalizeActiveVersionId_(activeRaw.targetVersionId),
			targetGeneration: Math.max(0, toNonNegativeInt_(activeRaw.targetGeneration)),
			phase: String(activeRaw.phase || "idle"),
			cursor: Math.max(0, toNonNegativeInt_(activeRaw.cursor)),
			committedVersionId: normalizeActiveVersionId_(activeRaw.committedVersionId),
			updatedAt: String(activeRaw.updatedAt || ""),
		},
		dirty: {
			events: dirtyRaw.events && typeof dirtyRaw.events === "object" ? dirtyRaw.events : {},
			cwlAggregates: dirtyRaw.cwlAggregates && typeof dirtyRaw.cwlAggregates === "object" ? dirtyRaw.cwlAggregates : {},
			donationSeasons: dirtyRaw.donationSeasons && typeof dirtyRaw.donationSeasons === "object" ? dirtyRaw.donationSeasons : {},
			cwlLeagueSignups: dirtyRaw.cwlLeagueSignups && typeof dirtyRaw.cwlLeagueSignups === "object" ? dirtyRaw.cwlLeagueSignups : null,
			seasonPointers: dirtyRaw.seasonPointers && typeof dirtyRaw.seasonPointers === "object" ? dirtyRaw.seasonPointers : null,
			relevantSnapshot: dirtyRaw.relevantSnapshot && typeof dirtyRaw.relevantSnapshot === "object" ? dirtyRaw.relevantSnapshot : null,
			bootstrap: dirtyRaw.bootstrap && typeof dirtyRaw.bootstrap === "object" ? dirtyRaw.bootstrap : null,
		},
		retry: {
			attempt: Math.max(0, toNonNegativeInt_(retryRaw.attempt)),
			nextAttemptAt: String(retryRaw.nextAttemptAt || ""),
			lastError: String(retryRaw.lastError || "").slice(0, 2000),
			lastFailureAt: String(retryRaw.lastFailureAt || ""),
		},
		lastSuccessAt: String(source.lastSuccessAt || ""),
		lastBatch: source.lastBatch && typeof source.lastBatch === "object" ? source.lastBatch : null,
		lastDriftRepairAt: String(source.lastDriftRepairAt || ""),
		initializedAt: String(source.initializedAt || ""),
		updatedAt: String(source.updatedAt || ""),
	};
}

function readCloudflarePublishQueueState_() {
	const encoded = firebaseRequestJson_(FIREBASE_INTERNAL_CLOUDFLARE_PUBLISH_STATE_PATH, "GET");
	const decoded = encoded == null ? null : decodeFirebaseObjectKeysRecursive_(encoded);
	return normalizeCloudflarePublishQueueState_(decoded);
}

function writeCloudflarePublishQueueState_(stateRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	state.updatedAt = new Date().toISOString();
	firebaseRequestJson_(FIREBASE_INTERNAL_CLOUDFLARE_PUBLISH_STATE_PATH, "PUT", encodeFirebaseObjectKeysRecursive_(state));
	return state;
}

function assertCloudflarePublishQueueLeaseOwned_(tokenRaw) {
	const token = String(tokenRaw || "").trim();
	if (!token) throw new Error("Cloudflare queue lease token is required.");
	const current = parseCloudflarePublishQueueLockState_(PropertiesService.getScriptProperties().getProperty(CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY));
	if (!current || current.token !== token || current.expiresAt <= Date.now()) {
		const error = new Error("Cloudflare queue lease ownership was lost.");
		error.code = "CLOUDFLARE_QUEUE_LEASE_LOST";
		throw error;
	}
	return true;
}

function mutateCloudflarePublishQueueState_(callback, ownerTokenRaw) {
	if (typeof callback !== "function") throw new Error("Cloudflare queue mutation callback is required.");
	const lock = LockService.getScriptLock();
	lock.waitLock(10000);
	try {
		if (ownerTokenRaw) assertCloudflarePublishQueueLeaseOwned_(ownerTokenRaw);
		const state = readCloudflarePublishQueueState_();
		const result = callback(state);
		if (ownerTokenRaw) assertCloudflarePublishQueueLeaseOwned_(ownerTokenRaw);
		writeCloudflarePublishQueueState_(state);
		if (ownerTokenRaw) assertCloudflarePublishQueueLeaseOwned_(ownerTokenRaw);
		return result;
	} finally {
		lock.releaseLock();
	}
}

function nextCloudflarePublishRevision_(state) {
	state.nextRevision = Math.max(0, toNonNegativeInt_(state.nextRevision)) + 1;
	return state.nextRevision;
}

function makeCloudflareDirtyRevision_(state, reasonRaw, extraRaw) {
	const now = new Date().toISOString();
	return Object.assign({
		revision: nextCloudflarePublishRevision_(state),
		updatedAt: now,
		reason: String(reasonRaw || "mutation").slice(0, 160),
	}, extraRaw && typeof extraRaw === "object" ? extraRaw : {});
}

function hasPendingCloudflarePublishWork_(stateRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	if (state.active.targetVersionId && state.active.targetVersionId !== state.active.committedVersionId) return true;
	const dirty = state.dirty;
	return Object.keys(dirty.events).length > 0 ||
		Object.keys(dirty.cwlAggregates).length > 0 ||
		Object.keys(dirty.donationSeasons).length > 0 ||
		!!dirty.cwlLeagueSignups || !!dirty.seasonPointers || !!dirty.relevantSnapshot || !!dirty.bootstrap;
}

function scheduleCloudflarePublishWorker_() {
	if (!isCloudflareQueuedPublicationEnabled_()) return { scheduled: false, reason: "disabled" };
	if (typeof ScriptApp === "undefined" || !ScriptApp || typeof ScriptApp.newTrigger !== "function") {
		return { scheduled: false, reason: "scriptapp-unavailable" };
	}
	const lock = LockService.getScriptLock();
	lock.waitLock(10000);
	try {
		const triggers = ScriptApp.getProjectTriggers();
		let removed = 0;
		for (let i = 0; i < triggers.length; i++) {
			const trigger = triggers[i];
			if (String(trigger.getHandlerFunction ? trigger.getHandlerFunction() : "") !== CLOUDFLARE_PUBLISH_QUEUE_HANDLER_NAME) continue;
			try { ScriptApp.deleteTrigger(trigger); removed++; } catch (err) {}
		}
		const state = readCloudflarePublishQueueState_();
		const nextAttemptMs = parseIsoToMs_(state.retry.nextAttemptAt);
		const delay = nextAttemptMs > Date.now()
			? Math.max(CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_DELAY_MS, nextAttemptMs - Date.now())
			: CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_DELAY_MS;
		const keeper = ScriptApp.newTrigger(CLOUDFLARE_PUBLISH_QUEUE_HANDLER_NAME).timeBased().after(delay).create();
		const triggerId = getTriggerUniqueId_(keeper);
		if (triggerId) PropertiesService.getScriptProperties().setProperty(CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_ID_PROPERTY, triggerId);
		return { scheduled: true, triggerId: triggerId, removedDuplicates: removed };
	} finally { lock.releaseLock(); }
}

function removeCloudflarePublishWorkerTriggers_() {
	if (typeof ScriptApp === "undefined" || !ScriptApp || typeof ScriptApp.getProjectTriggers !== "function") return 0;
	const lock = LockService.getScriptLock();
	lock.waitLock(10000);
	try {
		const currentState = readCloudflarePublishQueueState_();
		if (getCloudflarePublicationMode_() === CLOUDFLARE_PUBLICATION_MODE_QUEUED_V2 && !currentState.paused && hasPendingCloudflarePublishWork_(currentState)) return 0;
		const triggers = ScriptApp.getProjectTriggers();
		let removed = 0;
		for (let i = 0; i < triggers.length; i++) {
			const trigger = triggers[i];
			if (String(trigger.getHandlerFunction ? trigger.getHandlerFunction() : "") !== CLOUDFLARE_PUBLISH_QUEUE_HANDLER_NAME) continue;
			try { ScriptApp.deleteTrigger(trigger); removed++; } catch (err) {}
		}
		PropertiesService.getScriptProperties().deleteProperty(CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_ID_PROPERTY);
		return removed;
	} finally {
		lock.releaseLock();
	}
}

function enqueueCloudflareActiveTarget_(versionIdRaw, reasonRaw) {
	const versionId = normalizeActiveVersionId_(versionIdRaw);
	if (!versionId || !isCloudflareQueuedPublicationEnabled_()) return { ok: false, skipped: true, reason: !versionId ? "missing-version" : "disabled" };
	try {
		const result = mutateCloudflarePublishQueueState_(function (state) {
			if (state.active.targetVersionId !== versionId) {
				state.active.targetVersionId = versionId;
				state.active.targetGeneration = Math.max(Math.max(0, toNonNegativeInt_(state.active.targetGeneration)) + 1, Date.now());
				state.active.phase = "ordinary";
				state.active.cursor = 0;
			}
			state.active.updatedAt = new Date().toISOString();
			state.dirty.seasonPointers = makeCloudflareDirtyRevision_(state, reasonRaw || "active-target", { category: "seasonPointers" });
			state.dirty.bootstrap = makeCloudflareDirtyRevision_(state, reasonRaw || "active-target", { category: "bootstrap" });
			return { ok: true, versionId: versionId, generation: state.active.targetGeneration };
		});
		scheduleCloudflarePublishWorker_();
		return result;
	} catch (err) {
		Logger.log("Cloudflare active target enqueue failed versionId=%s error=%s", versionId, errorMessage_(err));
		return { ok: false, error: errorMessage_(err), versionId: versionId };
	}
}

function enqueueCloudflareSeasonEventPublication_(eventIdRaw, reasonRaw, optionsRaw) {
	const eventId = sanitizeSeasonEventText_(eventIdRaw, 180);
	if (!eventId || !isCloudflareQueuedPublicationEnabled_()) return { ok: false, skipped: true, reason: !eventId ? "missing-event" : "disabled" };
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	try {
		const result = mutateCloudflarePublishQueueState_(function (state) {
			state.dirty.events[eventId] = makeCloudflareDirtyRevision_(state, reasonRaw || "event-mutation", { eventId: eventId, category: "event" });
			if (options.cwlLive === true || options.cwlFinal === true) {
				const kinds = state.dirty.cwlAggregates[eventId] && typeof state.dirty.cwlAggregates[eventId] === "object" ? state.dirty.cwlAggregates[eventId] : {};
				if (options.cwlLive === true) kinds.live = makeCloudflareDirtyRevision_(state, reasonRaw || "cwl-live", { eventId: eventId, kind: "live", category: "cwlAggregate" });
				if (options.cwlFinal === true) kinds.final = makeCloudflareDirtyRevision_(state, reasonRaw || "cwl-final", { eventId: eventId, kind: "final", category: "cwlAggregate" });
				state.dirty.cwlAggregates[eventId] = kinds;
			}
			if (options.pointers === true) state.dirty.seasonPointers = makeCloudflareDirtyRevision_(state, reasonRaw || "event-pointers", { category: "seasonPointers" });
			state.dirty.bootstrap = makeCloudflareDirtyRevision_(state, reasonRaw || "event-mutation", { category: "bootstrap" });
			return { ok: true, eventId: eventId, revision: state.dirty.events[eventId].revision };
		});
		scheduleCloudflarePublishWorker_();
		return result;
	} catch (err) {
		Logger.log("Cloudflare event enqueue failed eventId=%s error=%s", eventId, errorMessage_(err));
		return { ok: false, error: errorMessage_(err), eventId: eventId };
	}
}

function enqueueCloudflareRelevantSeasonPublication_(reasonRaw) {
	if (!isCloudflareQueuedPublicationEnabled_()) return { ok: false, skipped: true, reason: "disabled" };
	try {
		const result = mutateCloudflarePublishQueueState_(function (state) {
			state.dirty.relevantSnapshot = makeCloudflareDirtyRevision_(state, reasonRaw || "relevant-season", { category: "relevantSnapshot", phase: "ordinary", cursor: 0 });
			state.dirty.bootstrap = makeCloudflareDirtyRevision_(state, reasonRaw || "relevant-season", { category: "bootstrap" });
			return { ok: true, category: "relevantSnapshot" };
		});
		scheduleCloudflarePublishWorker_();
		return result;
	} catch (err) {
		Logger.log("Cloudflare relevant season enqueue failed error=%s", errorMessage_(err));
		return { ok: false, error: errorMessage_(err) };
	}
}

function enqueueCloudflareDonationSeasonPublication_(seasonIdRaw, reasonRaw) {
	const seasonId = sanitizeDonationCycleKey_(seasonIdRaw);
	if (!seasonId || !isCloudflareQueuedPublicationEnabled_()) return { ok: false, skipped: true, reason: !seasonId ? "missing-season" : "disabled" };
	try {
		const result = mutateCloudflarePublishQueueState_(function (state) {
			state.dirty.donationSeasons[seasonId] = makeCloudflareDirtyRevision_(state, reasonRaw || "donation-refresh", { seasonId: seasonId, category: "donationSeason" });
			state.dirty.bootstrap = makeCloudflareDirtyRevision_(state, reasonRaw || "donation-refresh", { category: "bootstrap" });
			return { ok: true, seasonId: seasonId, revision: state.dirty.donationSeasons[seasonId].revision };
		});
		scheduleCloudflarePublishWorker_();
		return result;
	} catch (err) {
		Logger.log("Cloudflare donation enqueue failed seasonId=%s error=%s", seasonId, errorMessage_(err));
		return { ok: false, error: errorMessage_(err), seasonId: seasonId };
	}
}

function enqueueCloudflareCwlLeagueSignupsPublication_(reasonRaw) {
	if (!isCloudflareQueuedPublicationEnabled_()) return { ok: false, skipped: true, reason: "disabled" };
	try {
		const result = mutateCloudflarePublishQueueState_(function (state) {
			state.dirty.cwlLeagueSignups = makeCloudflareDirtyRevision_(state, reasonRaw || "cwl-signups", { category: "cwlLeagueSignups" });
			return { ok: true, revision: state.dirty.cwlLeagueSignups.revision };
		});
		scheduleCloudflarePublishWorker_();
		return result;
	} catch (err) {
		Logger.log("Cloudflare CWL signup enqueue failed error=%s", errorMessage_(err));
		return { ok: false, error: errorMessage_(err) };
	}
}

function cloudflareQueueJsonBytes_(valueRaw) {
	const text = JSON.stringify(valueRaw);
	try {
		return Utilities.newBlob(text).getBytes().length;
	} catch (err) {
		return text.length;
	}
}

function buildCloudflareQueuedBatchList_(objectsRaw) {
	const objects = Array.isArray(objectsRaw) ? objectsRaw.slice() : [];
	objects.sort(function (a, b) {
		const ak = normalizeCloudflareDataScope_(a.scope || "public") + ":" + normalizeCloudflareDataObjectPath_(a.path);
		const bk = normalizeCloudflareDataScope_(b.scope || "public") + ":" + normalizeCloudflareDataObjectPath_(b.path);
		return ak < bk ? -1 : ak > bk ? 1 : 0;
	});
	const batches = [];
	let batch = [];
	for (let i = 0; i < objects.length; i++) {
		const object = objects[i] && objects[i].delete === true
			? { path: normalizeCloudflareDataObjectPath_(objects[i].path), scope: normalizeCloudflareDataScope_(objects[i].scope || "public"), delete: true }
			: makeCloudflareDataObject_(objects[i].path, objects[i].payload, objects[i].scope || "public");
		const objectBytes = cloudflareQueueJsonBytes_(object);
		if (objectBytes > CLOUDFLARE_PUBLISH_QUEUE_HARD_OBJECT_BYTES) {
			throw new Error("Cloudflare object exceeds hard limit path=" + object.scope + ":" + object.path + " bytes=" + objectBytes + ".");
		}
		const candidate = batch.concat([object]);
		const candidateBytes = cloudflareQueueJsonBytes_({ objects: candidate, deletes: [], commits: [] });
		const singleRequestBytes = cloudflareQueueJsonBytes_({
			requestId: "request-id",
			batchId: "batch-id",
			publishedAt: new Date(0).toISOString(),
			objects: [object],
			deletes: [],
			commits: [],
			dispatchGuard: { kind: "queued-v2", generation: 1, batchId: "batch-id" },
		});
		if (singleRequestBytes > CLOUDFLARE_PUBLISH_QUEUE_MAX_PAYLOAD_BYTES) {
			throw new Error("Cloudflare object cannot fit a request path=" + object.scope + ":" + object.path + " bytes=" + singleRequestBytes + ".");
		}
		const batchScopes = {};
		for (let j = 0; j < batch.length; j++) batchScopes[normalizeCloudflareDataScope_(batch[j].scope || "public")] = true;
		const mixedNearLimit = batch.length && !batchScopes[normalizeCloudflareDataScope_(object.scope || "public")] && candidateBytes > CLOUDFLARE_PUBLISH_QUEUE_MAX_PAYLOAD_BYTES * 0.75;
		if (batch.length && (candidate.length > CLOUDFLARE_PUBLISH_QUEUE_MAX_OBJECTS_PER_REQUEST || candidateBytes > CLOUDFLARE_PUBLISH_QUEUE_MAX_PAYLOAD_BYTES || mixedNearLimit)) {
			batches.push(batch);
			batch = [object];
		} else {
			batch = candidate;
		}
	}
	if (batch.length) batches.push(batch);
	return batches;
}

function getCloudflareCommittedActiveVersionId_(stateRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	return normalizeActiveVersionId_(state.active.committedVersionId);
}

function buildCloudflareQueuedBootstrapCommit_(stateRaw, activeVersionOverrideRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	const versionId = normalizeActiveVersionId_(activeVersionOverrideRaw) || getCloudflareCommittedActiveVersionId_(state);
	if (!versionId) throw new Error("Cloudflare bootstrap requires a committed active version.");
	return buildCloudflarePublicBootstrapObject_({ activeVersionIdOverride: versionId });
}

function buildCloudflareQueuedActivePlan_(stateRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	const target = normalizeActiveVersionId_(state.active.targetVersionId);
	if (!target) throw new Error("Cloudflare active publication target is missing.");
	const snapshot = readActiveRosterSnapshotFromVersion_(target);
	if (!snapshot || !snapshot.rosterData) throw new Error("Cloudflare active target version is incomplete: " + target + ".");
	const built = buildCloudflareActiveRosterPublishObjects_({
		versionId: target,
		manifest: snapshot.manifest,
		rosterData: snapshot.rosterData,
		options: { includeBootstrap: false },
	});
	const ordinary = [];
	const commits = [];
	for (let i = 0; i < built.publicObjects.length; i++) {
		const item = built.publicObjects[i];
		const path = normalizeCloudflareDataObjectPath_(item.path);
		if (path === "active" || path === "activePublished/currentManifest" || path === "activePublished/currentVersionId" || path === CLOUDFLARE_PUBLIC_DATA_BOOTSTRAP_PATH) {
			if (path !== CLOUDFLARE_PUBLIC_DATA_BOOTSTRAP_PATH) commits.push(makeCloudflareDataObject_(path, item.payload, "public"));
		} else ordinary.push(makeCloudflareDataObject_(path, item.payload, "public"));
	}
	for (let i = 0; i < built.botObjects.length; i++) {
		const item = built.botObjects[i];
		if (normalizeCloudflareDataObjectPath_(item.path) === "active") commits.unshift(makeCloudflareDataObject_(item.path, item.payload, "bot"));
		else ordinary.push(makeCloudflareDataObject_(item.path, item.payload, "bot"));
	}
	commits.push(makeCloudflareDataObject_(CLOUDFLARE_PUBLIC_DATA_BOOTSTRAP_PATH, buildCloudflareQueuedBootstrapCommit_(state, target).payload, "public"));
	return {
		targetVersionId: target,
		generation: state.active.targetGeneration,
		bootstrapRevision: state.dirty.bootstrap ? toNonNegativeInt_(state.dirty.bootstrap.revision) : 0,
		batches: buildCloudflareQueuedBatchList_(ordinary),
		commits: commits,
	};
}

function addCloudflareMirroredQueueObject_(objects, pathRaw, payloadRaw) {
	if (payloadRaw == null) return;
	objects.push(makeCloudflareDataObject_(pathRaw, encodeFirebaseObjectKeysRecursive_(payloadRaw), "public"));
	objects.push(makeCloudflareDataObject_(pathRaw, encodeFirebaseObjectKeysRecursive_(payloadRaw), "bot"));
}

function addCloudflareMirroredQueueDelete_(deletes, pathRaw) {
	deletes.push({ path: normalizeCloudflareDataObjectPath_(pathRaw), scope: "public" });
	deletes.push({ path: normalizeCloudflareDataObjectPath_(pathRaw), scope: "bot" });
}

function addCloudflareMirroredQueueCommitDelete_(commits, pathRaw) {
	commits.push({ path: normalizeCloudflareDataObjectPath_(pathRaw), scope: "public", delete: true });
	commits.push({ path: normalizeCloudflareDataObjectPath_(pathRaw), scope: "bot", delete: true });
}

function buildCloudflareRelevantSeasonPointerCommits_(stateRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const commits = [];
	const deletes = [];
	const pointerPaths = [
		SEASON_EVENTS_CURRENT_PATH,
		SEASON_EVENTS_CURRENT_CWL_PATH,
		SEASON_EVENTS_LATEST_COMPLETED_CWL_PATH,
		SEASON_EVENTS_SEASON_STATE_CURRENT_PATH,
	];
	for (let i = 0; i < pointerPaths.length; i++) {
		const path = pointerPaths[i];
		const payload = readDecodedCloudflareFirebaseObject_(path);
		if (payload == null) addCloudflareMirroredQueueCommitDelete_(commits, path);
		else addCloudflareMirroredQueueObject_(commits, path, payload);
	}
	const bundle = attachCloudflarePreviousSeasonBundle_(buildCloudflareCurrentSeasonEventsBundle_());
	const seasonIds = [];
	const currentSeasonId = String(bundle && bundle.seasonState && bundle.seasonState.seasonId || "").trim();
	const previousSeasonId = String(bundle && bundle.previous && bundle.previous.seasonState && bundle.previous.seasonState.seasonId || "").trim();
	if (currentSeasonId) seasonIds.push(currentSeasonId);
	if (previousSeasonId && previousSeasonId !== currentSeasonId) seasonIds.push(previousSeasonId);
	for (let i = 0; i < seasonIds.length; i++) {
		const path = buildFirebaseChildPath_(SEASON_EVENTS_BY_SEASON_PATH, encodeFirebaseObjectKey_(seasonIds[i]));
		const payload = readDecodedCloudflareFirebaseObject_(path);
		if (payload != null) addCloudflareMirroredQueueObject_(commits, path, payload);
	}
	if (options.includeBootstrap !== false) commits.push(makeCloudflareDataObject_(CLOUDFLARE_PUBLIC_DATA_BOOTSTRAP_PATH, buildCloudflareQueuedBootstrapCommit_(stateRaw).payload, "public"));
	return { commits: commits, deletes: deletes };
}

function buildCloudflareQueuedOrderedBatchList_(objectsRaw) {
	const objects = Array.isArray(objectsRaw) ? objectsRaw : [];
	const batches = [];
	let batch = [];
	for (let i = 0; i < objects.length; i++) {
		const object = objects[i] && objects[i].delete === true
			? { path: normalizeCloudflareDataObjectPath_(objects[i].path), scope: normalizeCloudflareDataScope_(objects[i].scope || "public"), delete: true }
			: makeCloudflareDataObject_(objects[i].path, objects[i].payload, objects[i].scope || "public");
		const objectBytes = cloudflareQueueJsonBytes_(object);
		if (objectBytes > CLOUDFLARE_PUBLISH_QUEUE_HARD_OBJECT_BYTES) {
			throw new Error("Cloudflare object exceeds hard limit path=" + object.scope + ":" + object.path + " bytes=" + objectBytes + ".");
		}
		const singleRequestBytes = cloudflareQueueJsonBytes_({
			requestId: "request-id",
			batchId: "batch-id",
			publishedAt: new Date(0).toISOString(),
			objects: [],
			deletes: [],
			commits: [object],
			dispatchGuard: { kind: "queued-v2", generation: 1, batchId: "batch-id" },
		});
		if (singleRequestBytes > CLOUDFLARE_PUBLISH_QUEUE_MAX_PAYLOAD_BYTES) {
			throw new Error("Cloudflare ordered object cannot fit a request path=" + object.scope + ":" + object.path + " bytes=" + singleRequestBytes + ".");
		}
		const candidate = batch.concat([object]);
		const candidateBytes = cloudflareQueueJsonBytes_({ objects: [], deletes: [], commits: candidate });
		if (batch.length && (candidate.length > CLOUDFLARE_PUBLISH_QUEUE_MAX_OBJECTS_PER_REQUEST || candidateBytes > CLOUDFLARE_PUBLISH_QUEUE_MAX_PAYLOAD_BYTES)) {
			batches.push(batch);
			batch = [object];
		} else {
			batch = candidate;
		}
	}
	if (batch.length) batches.push(batch);
	return batches;
}

function buildCloudflareRelevantSnapshotPlan_(stateRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	const objects = [];
	const deletes = [];
	const pointerData = buildCloudflareRelevantSeasonPointerCommits_(state, { includeBootstrap: false });
	const commits = pointerData.commits.slice();
	const bundles = [];
	const currentBundle = attachCloudflarePreviousSeasonBundle_(buildCloudflareCurrentSeasonEventsBundle_());
	if (currentBundle) bundles.push(currentBundle);
	if (currentBundle && currentBundle.previous) bundles.push(currentBundle.previous);
	const eventSeen = {};
	for (let i = 0; i < bundles.length; i++) {
		const bundle = bundles[i] && typeof bundles[i] === "object" ? bundles[i] : {};
		const byId = bundle.byId && typeof bundle.byId === "object" ? bundle.byId : {};
		const eventIds = Object.keys(byId).sort();
		for (let j = 0; j < eventIds.length; j++) {
			const eventId = eventIds[j];
			if (eventSeen[eventId]) continue;
			eventSeen[eventId] = true;
			const eventPath = buildFirebaseChildPath_(SEASON_EVENTS_BY_ID_PATH, encodeFirebaseObjectKey_(eventId));
			addCloudflareMirroredQueueObject_(objects, eventPath, byId[eventId]);
			const aggregates = bundle.cwlAggregatesByEventId && bundle.cwlAggregatesByEventId[eventId] && typeof bundle.cwlAggregatesByEventId[eventId] === "object"
				? bundle.cwlAggregatesByEventId[eventId]
				: {};
			const kinds = Object.keys(aggregates).sort();
			for (let k = 0; k < kinds.length; k++) {
				const kind = kinds[k];
				addCloudflareMirroredQueueObject_(objects, buildCwlSeasonEventAggregatePath_(eventId, kind), aggregates[kind]);
			}
			if (normalizeSeasonEventType_(byId[eventId] && byId[eventId].type) === "cwl") {
				const aggregateKinds = ["live", "final"];
				for (let k = 0; k < aggregateKinds.length; k++) {
					if (!aggregates[aggregateKinds[k]]) addCloudflareMirroredQueueDelete_(deletes, buildCwlSeasonEventAggregatePath_(eventId, aggregateKinds[k]));
				}
			}
		}
	}
	const donationSeasonIds = collectCloudflareDonationRefreshSeasonIdsFromBundle_(currentBundle, {});
	for (let i = 0; i < donationSeasonIds.length; i++) {
		const seasonId = donationSeasonIds[i];
		const overlayPath = buildFirebaseChildPath_(buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "bySeason"), encodeFirebaseObjectKey_(seasonId));
		const overlay = readDecodedCloudflareFirebaseObject_(overlayPath);
		if (overlay != null) addCloudflareMirroredQueueObject_(objects, overlayPath, overlay);
		else addCloudflareMirroredQueueDelete_(deletes, overlayPath);
	}
	const signup = readDecodedCloudflareFirebaseObject_(CWL_LEAGUE_SIGNUPS_ACTIVE_PATH);
	if (signup != null) objects.push(makeCloudflareDataObject_(CWL_LEAGUE_SIGNUPS_ACTIVE_PATH, encodeFirebaseObjectKeysRecursive_(signup), "bot"));
	else deletes.push({ path: CWL_LEAGUE_SIGNUPS_ACTIVE_PATH, scope: "bot" });
	const donationCurrentPath = buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "current");
	const donationCurrent = readDecodedCloudflareFirebaseObject_(donationCurrentPath);
	if (donationCurrent != null) addCloudflareMirroredQueueObject_(commits, donationCurrentPath, donationCurrent);
	else addCloudflareMirroredQueueCommitDelete_(commits, donationCurrentPath);
	if (pointerData.deletes.length) {
		for (let i = 0; i < pointerData.deletes.length; i++) commits.push(pointerData.deletes[i]);
	}
	commits.push(makeCloudflareDataObject_(CLOUDFLARE_PUBLIC_DATA_BOOTSTRAP_PATH, buildCloudflareQueuedBootstrapCommit_(state).payload, "public"));
	return {
		ordinaryBatches: buildCloudflareQueuedBatchList_(objects),
		commitBatches: buildCloudflareQueuedOrderedBatchList_(commits),
		deletes: deletes,
		bootstrapRevision: state.dirty.bootstrap ? toNonNegativeInt_(state.dirty.bootstrap.revision) : 0,
	};
}

function firstCloudflareDirtyWork_(stateRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	const eventIds = Object.keys(state.dirty.events).sort();
	if (eventIds.length) return { category: "event", key: eventIds[0], revision: state.dirty.events[eventIds[0]].revision };
	const aggregateEventIds = Object.keys(state.dirty.cwlAggregates).sort();
	for (let i = 0; i < aggregateEventIds.length; i++) {
		const eventId = aggregateEventIds[i];
		const kinds = state.dirty.cwlAggregates[eventId] || {};
		if (kinds.live) return { category: "cwlAggregate", key: eventId, kind: "live", revision: kinds.live.revision };
		if (kinds.final) return { category: "cwlAggregate", key: eventId, kind: "final", revision: kinds.final.revision };
	}
	const donationIds = Object.keys(state.dirty.donationSeasons).sort();
	if (donationIds.length) return { category: "donationSeason", key: donationIds[0], revision: state.dirty.donationSeasons[donationIds[0]].revision };
	if (state.dirty.cwlLeagueSignups) return { category: "cwlLeagueSignups", revision: state.dirty.cwlLeagueSignups.revision };
	if (state.dirty.seasonPointers) return { category: "seasonPointers", revision: state.dirty.seasonPointers.revision };
	if (state.dirty.relevantSnapshot) return {
		category: "relevantSnapshot",
		revision: state.dirty.relevantSnapshot.revision,
		phase: String(state.dirty.relevantSnapshot.phase || "ordinary"),
		cursor: Math.max(0, toNonNegativeInt_(state.dirty.relevantSnapshot.cursor)),
	};
	if (state.dirty.bootstrap) return { category: "bootstrap", revision: state.dirty.bootstrap.revision };
	return null;
}

function buildCloudflareDirtyRequest_(stateRaw, workRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	const work = workRaw && typeof workRaw === "object" ? workRaw : {};
	const objects = [];
	const deletes = [];
	const commits = [];
	if (work.category === "seasonPointers") {
		const built = buildCloudflareRelevantSeasonPointerCommits_(state);
		return { objects: objects, deletes: built.deletes, commits: built.commits };
	}
	if (work.category === "relevantSnapshot") {
		const built = buildCloudflareRelevantSeasonPointerCommits_(state);
		return { objects: objects, deletes: built.deletes, commits: built.commits };
	}
	if (work.category === "event") {
		const event = readSeasonEventById_(work.key);
		const path = buildFirebaseChildPath_(SEASON_EVENTS_BY_ID_PATH, encodeFirebaseObjectKey_(work.key));
		if (event) addCloudflareMirroredQueueObject_(objects, path, event);
		else addCloudflareMirroredQueueDelete_(deletes, path);
		commits.push(makeCloudflareDataObject_(CLOUDFLARE_PUBLIC_DATA_BOOTSTRAP_PATH, buildCloudflareQueuedBootstrapCommit_(state).payload, "public"));
	} else if (work.category === "cwlAggregate") {
		const event = readSeasonEventById_(work.key);
		const aggregate = readCwlSeasonEventAggregate_(work.key, work.kind);
		const path = buildCwlSeasonEventAggregatePath_(work.key, work.kind);
		if (aggregate && aggregate.eventId) addCloudflareMirroredQueueObject_(objects, path, projectCloudflareCwlAggregateForEvent_(event, aggregate, work.kind));
		else addCloudflareMirroredQueueDelete_(deletes, path);
		commits.push(makeCloudflareDataObject_(CLOUDFLARE_PUBLIC_DATA_BOOTSTRAP_PATH, buildCloudflareQueuedBootstrapCommit_(state).payload, "public"));
	} else if (work.category === "donationSeason") {
		const path = buildFirebaseChildPath_(buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "bySeason"), encodeFirebaseObjectKey_(work.key));
		const overlay = readDecodedCloudflareFirebaseObject_(path);
		if (overlay) addCloudflareMirroredQueueObject_(objects, path, overlay);
		else addCloudflareMirroredQueueDelete_(deletes, path);
		const currentPath = buildFirebaseChildPath_(FIREBASE_DONATION_REFRESH_PATH, "current");
		const current = readDecodedCloudflareFirebaseObject_(currentPath);
		if (current && sanitizeDonationCycleKey_(current.seasonId) === sanitizeDonationCycleKey_(work.key)) addCloudflareMirroredQueueObject_(commits, currentPath, current);
		commits.push(makeCloudflareDataObject_(CLOUDFLARE_PUBLIC_DATA_BOOTSTRAP_PATH, buildCloudflareQueuedBootstrapCommit_(state).payload, "public"));
	} else if (work.category === "cwlLeagueSignups") {
		objects.push(makeCloudflareDataObject_("active/cwlLeagueSignups", encodeFirebaseObjectKeysRecursive_(readActiveCwlLeagueSignups_()), "bot"));
	} else if (work.category === "bootstrap") {
		commits.push(makeCloudflareDataObject_(CLOUDFLARE_PUBLIC_DATA_BOOTSTRAP_PATH, buildCloudflareQueuedBootstrapCommit_(state).payload, "public"));
	}
	return { objects: objects, deletes: deletes, commits: commits };
}

function assertCloudflareQueuedRequestBounds_(requestRaw) {
	const request = requestRaw && typeof requestRaw === "object" ? requestRaw : {};
	const objects = Array.isArray(request.objects) ? request.objects : [];
	const deletes = Array.isArray(request.deletes) ? request.deletes : [];
	const commits = Array.isArray(request.commits) ? request.commits : [];
	if (objects.length > CLOUDFLARE_PUBLISH_QUEUE_MAX_OBJECTS_PER_REQUEST || deletes.length > CLOUDFLARE_PUBLISH_QUEUE_MAX_OBJECTS_PER_REQUEST || commits.length > CLOUDFLARE_PUBLISH_QUEUE_MAX_OBJECTS_PER_REQUEST) {
		throw new Error("Cloudflare queued request exceeds object-count limit.");
	}
	const all = objects.concat(commits);
	for (let i = 0; i < all.length; i++) {
		const bytes = cloudflareQueueJsonBytes_(all[i]);
		if (bytes > CLOUDFLARE_PUBLISH_QUEUE_HARD_OBJECT_BYTES) {
			throw new Error("Cloudflare object exceeds hard limit path=" + all[i].scope + ":" + all[i].path + " bytes=" + bytes + ".");
		}
	}
	const bytes = cloudflareQueueJsonBytes_(request);
	if (bytes > CLOUDFLARE_PUBLISH_QUEUE_MAX_PAYLOAD_BYTES) {
		throw new Error("Cloudflare queued request exceeds payload limit bytes=" + bytes + ".");
	}
	return bytes;
}

function allocateCloudflarePublishDispatchGuard_(batchIdRaw, ownerTokenRaw) {
	const batchId = String(batchIdRaw || "").trim();
	if (!batchId) throw new Error("Cloudflare queued publication batchId is required.");
	return mutateCloudflarePublishQueueState_(function (state) {
		state.nextDispatchGeneration = Math.max(
			Math.max(0, toNonNegativeInt_(state.nextDispatchGeneration)) + 1,
			Date.now(),
		);
		return {
			kind: "queued-v2",
			generation: state.nextDispatchGeneration,
			batchId: batchId,
		};
	}, ownerTokenRaw);
}

function sendCloudflareQueuedV2Request_(requestRaw, labelRaw, ownerTokenRaw) {
	const endpoint = getCloudflarePublicDataPublishV2Endpoint_();
	const secret = getCloudflarePublicDataPublishSecret_();
	if (!endpoint) throw new Error("Missing Cloudflare v2 publish endpoint.");
	if (!secret) throw new Error("Missing Cloudflare publish secret.");
	if (typeof UrlFetchApp === "undefined" || !UrlFetchApp || typeof UrlFetchApp.fetch !== "function") throw new Error("UrlFetchApp is unavailable.");
	const request = Object.assign({}, requestRaw || {});
	request.requestId = String(request.requestId || createCloudflareQueueToken_());
	request.publishedAt = String(request.publishedAt || new Date().toISOString());
	request.dispatchGuard = request.dispatchGuard || allocateCloudflarePublishDispatchGuard_(request.batchId, ownerTokenRaw);
	const payloadBytes = assertCloudflareQueuedRequestBounds_(request);
	const startedAt = Date.now();
	const response = UrlFetchApp.fetch(endpoint, {
		method: "post",
		contentType: "application/json",
		headers: { Authorization: "Bearer " + secret },
		payload: JSON.stringify(request),
		muteHttpExceptions: true,
		timeoutSeconds: CLOUDFLARE_PUBLISH_QUEUE_REQUEST_TIMEOUT_SECONDS,
	});
	const statusCode = typeof response.getResponseCode === "function" ? response.getResponseCode() : 0;
	const text = typeof response.getContentText === "function" ? response.getContentText() : "";
	let parsed = null;
	try { parsed = text ? JSON.parse(text) : null; } catch (err) { parsed = null; }
	const durationMs = Math.max(0, Date.now() - startedAt);
	if (statusCode < 200 || statusCode >= 300 || !parsed || parsed.ok !== true) {
		const failure = parsed && parsed.failed ? " failed=" + String(parsed.failed.scope || "") + ":" + String(parsed.failed.path || "") : "";
		throw new Error(String((parsed && parsed.error) || ("Cloudflare v2 publish failed with HTTP " + statusCode + ".")) + failure);
	}
	Logger.log(
		"Cloudflare queued publish label=%s batch=%s objects=%s deletes=%s commits=%s bytes=%s httpMs=%s status=%s",
		String(labelRaw || ""), String(request.batchId || ""),
		(Array.isArray(request.objects) ? request.objects.length : 0),
		(Array.isArray(request.deletes) ? request.deletes.length : 0),
		(Array.isArray(request.commits) ? request.commits.length : 0),
		payloadBytes, durationMs, statusCode,
	);
	return { ok: true, response: parsed, statusCode: statusCode, payloadBytes: payloadBytes, durationMs: durationMs };
}

function clearCloudflareDirtyWorkIfRevisionMatches_(state, workRaw) {
	const work = workRaw && typeof workRaw === "object" ? workRaw : {};
	const revision = Math.max(0, toNonNegativeInt_(work.revision));
	if (work.category === "seasonPointers") {
		if (state.dirty.seasonPointers && toNonNegativeInt_(state.dirty.seasonPointers.revision) === revision) state.dirty.seasonPointers = null;
	} else if (work.category === "event") {
		if (state.dirty.events[work.key] && toNonNegativeInt_(state.dirty.events[work.key].revision) === revision) delete state.dirty.events[work.key];
	} else if (work.category === "cwlAggregate") {
		const kinds = state.dirty.cwlAggregates[work.key];
		if (kinds && kinds[work.kind] && toNonNegativeInt_(kinds[work.kind].revision) === revision) delete kinds[work.kind];
		if (kinds && !Object.keys(kinds).length) delete state.dirty.cwlAggregates[work.key];
	} else if (work.category === "donationSeason") {
		if (state.dirty.donationSeasons[work.key] && toNonNegativeInt_(state.dirty.donationSeasons[work.key].revision) === revision) delete state.dirty.donationSeasons[work.key];
	} else if (work.category === "cwlLeagueSignups") {
		if (state.dirty.cwlLeagueSignups && toNonNegativeInt_(state.dirty.cwlLeagueSignups.revision) === revision) state.dirty.cwlLeagueSignups = null;
	} else if (work.category === "bootstrap") {
		if (state.dirty.bootstrap && toNonNegativeInt_(state.dirty.bootstrap.revision) === revision) state.dirty.bootstrap = null;
	} else if (work.category === "relevantSnapshot") {
		if (state.dirty.relevantSnapshot && toNonNegativeInt_(state.dirty.relevantSnapshot.revision) === revision) state.dirty.relevantSnapshot = null;
	}
}

function recordCloudflareQueueFailure_(messageRaw, batchRaw) {
	const message = String(messageRaw || "Cloudflare publication failed.").slice(0, 2000);
	return mutateCloudflarePublishQueueState_(function (state) {
		const attempt = Math.max(0, toNonNegativeInt_(state.retry.attempt)) + 1;
		const delay = Math.min(CLOUDFLARE_PUBLISH_QUEUE_MAX_RETRY_MS, CLOUDFLARE_PUBLISH_QUEUE_BASE_RETRY_MS * Math.pow(2, Math.min(10, attempt - 1)));
		state.retry.attempt = attempt;
		state.retry.nextAttemptAt = new Date(Date.now() + delay).toISOString();
		state.retry.lastError = message;
		state.retry.lastFailureAt = new Date().toISOString();
		state.lastBatch = batchRaw && typeof batchRaw === "object" ? batchRaw : null;
		return { attempt: attempt, nextAttemptAt: state.retry.nextAttemptAt };
	});
}

function resetCloudflareQueueRetry_(state, batchRaw) {
	state.retry = { attempt: 0, nextAttemptAt: "", lastError: "", lastFailureAt: "" };
	state.lastSuccessAt = new Date().toISOString();
	state.lastBatch = batchRaw && typeof batchRaw === "object" ? batchRaw : null;
}

function processCloudflareActiveQueueRequest_(stateRaw, ownerTokenRaw, planOverrideRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	const plan = planOverrideRaw && typeof planOverrideRaw === "object"
		? planOverrideRaw
		: buildCloudflareQueuedActivePlan_(state);
	const phase = String(state.active.phase || "ordinary");
	if (phase === "ordinary" && state.active.cursor < plan.batches.length) {
		const cursor = state.active.cursor;
		const request = {
			batchId: "active:" + plan.targetVersionId + ":ordinary:" + cursor,
			revision: plan.generation,
			objects: plan.batches[cursor],
			deletes: [],
			commits: [],
		};
		if (ownerTokenRaw) assertCloudflarePublishQueueLeaseOwned_(ownerTokenRaw);
		const sent = sendCloudflareQueuedV2Request_(request, "active-ordinary", ownerTokenRaw);
		mutateCloudflarePublishQueueState_(function (latest) {
			if (latest.active.targetVersionId !== plan.targetVersionId || latest.active.targetGeneration !== plan.generation) return;
			if (latest.active.cursor === cursor) latest.active.cursor = cursor + 1;
			if (latest.active.cursor >= plan.batches.length) latest.active.phase = "commit";
			latest.active.updatedAt = new Date().toISOString();
			resetCloudflareQueueRetry_(latest, { category: "active", phase: "ordinary", cursor: cursor, response: sent.response });
		}, ownerTokenRaw);
		return { ok: true, category: "active", phase: "ordinary", cursor: cursor };
	}
	const request = {
		batchId: "active:" + plan.targetVersionId + ":commit",
		revision: plan.generation,
		objects: [],
		deletes: [],
		commits: plan.commits,
		commitGuard: {
			kind: "active",
			generation: plan.generation,
			targetVersionId: plan.targetVersionId,
		},
	};
	if (ownerTokenRaw) assertCloudflarePublishQueueLeaseOwned_(ownerTokenRaw);
	const sent = sendCloudflareQueuedV2Request_(request, "active-commit", ownerTokenRaw);
	mutateCloudflarePublishQueueState_(function (latest) {
		if (latest.active.targetVersionId !== plan.targetVersionId || latest.active.targetGeneration !== plan.generation) return;
		latest.active.committedVersionId = plan.targetVersionId;
		latest.active.phase = "idle";
		latest.active.cursor = 0;
		latest.active.updatedAt = new Date().toISOString();
		if (plan.bootstrapRevision && latest.dirty.bootstrap && toNonNegativeInt_(latest.dirty.bootstrap.revision) === plan.bootstrapRevision) {
			latest.dirty.bootstrap = null;
		}
		resetCloudflareQueueRetry_(latest, { category: "active", phase: "commit", response: sent.response });
	}, ownerTokenRaw);
	return { ok: true, category: "active", phase: "commit", versionId: plan.targetVersionId };
}

function processCloudflareDirtyQueueRequest_(stateRaw, ownerTokenRaw, planOverrideRaw) {
	const state = normalizeCloudflarePublishQueueState_(stateRaw);
	const work = firstCloudflareDirtyWork_(state);
	if (!work) return { ok: true, skipped: true, reason: "empty" };
	if (work.category === "relevantSnapshot") {
		const plan = planOverrideRaw && typeof planOverrideRaw === "object" ? planOverrideRaw : buildCloudflareRelevantSnapshotPlan_(state);
		const ordinaryBatches = Array.isArray(plan.ordinaryBatches) ? plan.ordinaryBatches : [];
		const commitBatches = Array.isArray(plan.commitBatches) ? plan.commitBatches : [];
		const phase = work.phase === "commits" || !ordinaryBatches.length ? "commits" : "ordinary";
		const cursor = Math.max(0, toNonNegativeInt_(work.cursor));
		const batch = phase === "ordinary" ? ordinaryBatches[cursor] : commitBatches[cursor];
		if (!batch || !batch.length) {
			return mutateCloudflarePublishQueueState_(function (latest) {
				const marker = latest.dirty.relevantSnapshot;
				if (!marker || toNonNegativeInt_(marker.revision) !== toNonNegativeInt_(work.revision)) return { ok: true, stale: true };
				if (phase === "ordinary") {
					marker.phase = "commits";
					marker.cursor = 0;
				} else {
					latest.dirty.relevantSnapshot = null;
					if (plan.bootstrapRevision && latest.dirty.bootstrap && toNonNegativeInt_(latest.dirty.bootstrap.revision) === plan.bootstrapRevision) latest.dirty.bootstrap = null;
				}
				return { ok: true, advanced: true, phase: phase };
			}, ownerTokenRaw);
		}
		const request = {
			batchId: "relevantSnapshot:" + work.revision + ":" + phase + ":" + cursor,
			revision: work.revision,
			objects: phase === "ordinary" ? batch : [],
			deletes: phase === "ordinary" && cursor === ordinaryBatches.length - 1 ? (plan.deletes || []) : (phase === "commits" && cursor === 0 ? (plan.deletes || []) : []),
			commits: phase === "commits" ? batch : [],
		};
		if (ownerTokenRaw) assertCloudflarePublishQueueLeaseOwned_(ownerTokenRaw);
		const sent = sendCloudflareQueuedV2Request_(request, "relevant-snapshot-" + phase, ownerTokenRaw);
		return mutateCloudflarePublishQueueState_(function (latest) {
			const marker = latest.dirty.relevantSnapshot;
			if (!marker || toNonNegativeInt_(marker.revision) !== toNonNegativeInt_(work.revision)) return { ok: true, stale: true };
			if (phase === "ordinary") {
				if (cursor + 1 < ordinaryBatches.length) marker.cursor = cursor + 1;
				else { marker.phase = "commits"; marker.cursor = 0; }
			} else if (cursor + 1 < commitBatches.length) {
				marker.cursor = cursor + 1;
			} else {
				latest.dirty.relevantSnapshot = null;
				if (plan.bootstrapRevision && latest.dirty.bootstrap && toNonNegativeInt_(latest.dirty.bootstrap.revision) === plan.bootstrapRevision) latest.dirty.bootstrap = null;
			}
			resetCloudflareQueueRetry_(latest, { category: work.category, phase: phase, cursor: cursor, response: sent.response });
			return { ok: true, category: work.category, phase: phase, cursor: cursor };
		}, ownerTokenRaw);
	}
	const built = buildCloudflareDirtyRequest_(state, work);
	const request = {
		batchId: work.category + ":" + String(work.key || work.kind || "current") + ":" + work.revision,
		revision: work.revision,
		objects: built.objects,
		deletes: built.deletes,
		commits: built.commits,
	};
	if (ownerTokenRaw) assertCloudflarePublishQueueLeaseOwned_(ownerTokenRaw);
	const sent = sendCloudflareQueuedV2Request_(request, work.category, ownerTokenRaw);
	mutateCloudflarePublishQueueState_(function (latest) {
		clearCloudflareDirtyWorkIfRevisionMatches_(latest, work);
		resetCloudflareQueueRetry_(latest, { category: work.category, key: work.key || "", kind: work.kind || "", revision: work.revision, response: sent.response });
	}, ownerTokenRaw);
	return { ok: true, category: work.category, key: work.key || "", kind: work.kind || "", revision: work.revision };
}

function repairCloudflarePublishQueueDrift_() {
	if (!isCloudflareQueuedPublicationEnabled_()) return { ok: false, skipped: true, reason: "disabled" };
	const canonicalVersionId = readPublishedActiveVersionId_();
	const relevant = enqueueCloudflareRelevantSeasonPublication_("drift-repair");
	const active = canonicalVersionId ? enqueueCloudflareActiveTarget_(canonicalVersionId, "drift-repair") : { ok: true, skipped: true, reason: "missing-canonical-version" };
	const signups = enqueueCloudflareCwlLeagueSignupsPublication_("drift-repair");
	mutateCloudflarePublishQueueState_(function (state) { state.lastDriftRepairAt = new Date().toISOString(); });
	return { ok: active.ok !== false && relevant.ok !== false && signups.ok !== false, active: active, relevant: relevant, signups: signups };
}

function cloudflarePublishWorkerTick() {
	const startedAtMs = Date.now();
	if (!isCloudflareQueuedPublicationEnabled_()) {
		removeCloudflarePublishWorkerTriggers_();
		return { ok: true, skipped: true, reason: "disabled" };
	}
	const lease = tryAcquireCloudflarePublishQueueLease_("cloudflare-publish-worker", 0);
	if (!lease) {
		scheduleCloudflarePublishWorker_();
		return { ok: true, skipped: true, reason: "lease-busy" };
	}
	const results = [];
	let activePlanCache = null;
	let relevantPlanCache = null;
	try {
		let state = readCloudflarePublishQueueState_();
		if (state.paused) return { ok: true, skipped: true, reason: "paused" };
		const nextAttemptMs = parseIsoToMs_(state.retry.nextAttemptAt);
		if (nextAttemptMs > Date.now()) {
			scheduleCloudflarePublishWorker_();
			return { ok: true, skipped: true, reason: "backoff", nextAttemptAt: state.retry.nextAttemptAt };
		}
		if (!hasPendingCloudflarePublishWork_(state)) {
			const driftAge = Date.now() - parseIsoToMs_(state.lastDriftRepairAt);
			if (!state.lastDriftRepairAt || driftAge > 6 * 60 * 60 * 1000) repairCloudflarePublishQueueDrift_();
			state = readCloudflarePublishQueueState_();
		}
		for (let requestIndex = 0; requestIndex < CLOUDFLARE_PUBLISH_QUEUE_MAX_REQUESTS_PER_TICK; requestIndex++) {
			if (Date.now() - startedAtMs > CLOUDFLARE_PUBLISH_QUEUE_EXECUTION_BUDGET_MS - 45000) break;
			if (!renewCloudflarePublishQueueLease_(lease.token)) throw new Error("Cloudflare queue lease renewal failed.");
			state = readCloudflarePublishQueueState_();
			if (state.paused || !hasPendingCloudflarePublishWork_(state)) break;
			let result = null;
			try {
				if (state.active.targetVersionId && state.active.targetVersionId !== state.active.committedVersionId) {
					if (!activePlanCache || activePlanCache.targetVersionId !== state.active.targetVersionId || activePlanCache.generation !== state.active.targetGeneration) {
						activePlanCache = buildCloudflareQueuedActivePlan_(state);
					}
					result = processCloudflareActiveQueueRequest_(state, lease.token, activePlanCache);
				} else {
					const dirtyWork = firstCloudflareDirtyWork_(state);
					if (dirtyWork && dirtyWork.category === "relevantSnapshot") {
						if (!relevantPlanCache || relevantPlanCache.revision !== dirtyWork.revision) {
							relevantPlanCache = Object.assign({ revision: dirtyWork.revision }, buildCloudflareRelevantSnapshotPlan_(state));
						}
						result = processCloudflareDirtyQueueRequest_(state, lease.token, relevantPlanCache);
					} else {
						relevantPlanCache = null;
						result = processCloudflareDirtyQueueRequest_(state, lease.token);
					}
				}
				results.push(result);
			} catch (err) {
				if (err && err.code === "CLOUDFLARE_QUEUE_LEASE_LOST") {
					results.push({ ok: false, skipped: true, reason: "lease-lost", error: errorMessage_(err) });
					break;
				}
				const retry = recordCloudflareQueueFailure_(errorMessage_(err), { requestIndex: requestIndex, error: errorMessage_(err) });
				Logger.log("Cloudflare publish worker failed requestIndex=%s attempt=%s next=%s error=%s", requestIndex, retry.attempt, retry.nextAttemptAt, errorMessage_(err));
				results.push({ ok: false, error: errorMessage_(err), retry: retry });
				break;
			}
		}
		try {
			assertCloudflarePublishQueueLeaseOwned_(lease.token);
		} catch (err) {
			if (err && err.code === "CLOUDFLARE_QUEUE_LEASE_LOST") return { ok: false, skipped: true, reason: "lease-lost", results: results };
			throw err;
		}
		state = readCloudflarePublishQueueState_();
		if (hasPendingCloudflarePublishWork_(state)) scheduleCloudflarePublishWorker_();
		else removeCloudflarePublishWorkerTriggers_();
		return { ok: results.every(function (item) { return item && item.ok !== false; }), results: results, pending: hasPendingCloudflarePublishWork_(state) };
	} finally {
		releaseCloudflarePublishQueueLease_(lease.token);
	}
}

function getCloudflarePublishQueueDiagnostics_() {
	const state = readCloudflarePublishQueueState_();
	const dirty = state.dirty;
	const ages = [];
	function addAge(item) { const ms = parseIsoToMs_(item && item.updatedAt); if (ms) ages.push(ms); }
	Object.keys(dirty.events).forEach(function (key) { addAge(dirty.events[key]); });
	Object.keys(dirty.cwlAggregates).forEach(function (eventId) { const kinds = dirty.cwlAggregates[eventId] || {}; addAge(kinds.live); addAge(kinds.final); });
	Object.keys(dirty.donationSeasons).forEach(function (key) { addAge(dirty.donationSeasons[key]); });
	addAge(dirty.cwlLeagueSignups); addAge(dirty.seasonPointers); addAge(dirty.bootstrap);
	const oldest = ages.length ? Math.min.apply(Math, ages) : 0;
	const triggerId = String(PropertiesService.getScriptProperties().getProperty(CLOUDFLARE_PUBLISH_QUEUE_TRIGGER_ID_PROPERTY) || "").trim();
	const lease = parseCloudflarePublishQueueLockState_(PropertiesService.getScriptProperties().getProperty(CLOUDFLARE_PUBLISH_QUEUE_LOCK_KEY));
	return {
		mode: getCloudflarePublicationMode_(),
		paused: state.paused,
		canonicalActiveVersionId: readPublishedActiveVersionId_(),
		committedActiveVersionId: state.active.committedVersionId,
		activeTargetVersionId: state.active.targetVersionId,
		activeTargetGeneration: state.active.targetGeneration,
		activePhase: state.active.phase,
		activeCursor: state.active.cursor,
		pendingDirtyCounts: {
			events: Object.keys(dirty.events).length,
			cwlAggregateEvents: Object.keys(dirty.cwlAggregates).length,
			donationSeasons: Object.keys(dirty.donationSeasons).length,
			cwlLeagueSignups: dirty.cwlLeagueSignups ? 1 : 0,
			seasonPointers: dirty.seasonPointers ? 1 : 0,
			bootstrap: dirty.bootstrap ? 1 : 0,
		},
		oldestPendingAt: oldest ? new Date(oldest).toISOString() : "",
		retryAttempt: state.retry.attempt,
		nextRetryAt: state.retry.nextAttemptAt,
		lastError: state.retry.lastError,
		lastSuccessAt: state.lastSuccessAt,
		lastBatch: state.lastBatch,
		triggerId: triggerId,
		hasTrigger: !!triggerId,
		lease: lease ? { owner: lease.owner, expiresAt: new Date(lease.expiresAt).toISOString() } : null,
	};
}

function initializeCloudflarePublishQueue_(optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	let committed = normalizeActiveVersionId_(options.committedVersionId);
	const canonical = readPublishedActiveVersionId_();
	if (!committed && typeof verifyCloudflarePublicActiveVersionId_ === "function") {
		if (canonical) {
			const verified = verifyCloudflarePublicActiveVersionId_(canonical);
			if (verified && verified.ok === true) committed = normalizeActiveVersionId_(verified.actualVersionId || canonical);
			else if (verified && verified.actualVersionId) committed = normalizeActiveVersionId_(verified.actualVersionId);
		}
	}
	mutateCloudflarePublishQueueState_(function (state) {
		if (committed) state.active.committedVersionId = committed;
		if (canonical && committed && canonical !== committed) {
			state.active.targetVersionId = canonical;
			state.active.targetGeneration = Math.max(Math.max(0, toNonNegativeInt_(state.active.targetGeneration)) + 1, Date.now());
			state.active.phase = "ordinary";
			state.active.cursor = 0;
		}
		if (committed) {
			state.dirty.relevantSnapshot = makeCloudflareDirtyRevision_(state, "queue-initialization", { category: "relevantSnapshot", phase: "ordinary", cursor: 0 });
			state.dirty.seasonPointers = makeCloudflareDirtyRevision_(state, "queue-initialization", { category: "seasonPointers" });
			state.dirty.cwlLeagueSignups = makeCloudflareDirtyRevision_(state, "queue-initialization", { category: "cwlLeagueSignups" });
			state.dirty.bootstrap = makeCloudflareDirtyRevision_(state, "queue-initialization", { category: "bootstrap" });
		}
		if (!state.initializedAt) state.initializedAt = new Date().toISOString();
	});
	const repair = isCloudflareQueuedPublicationEnabled_()
		? repairCloudflarePublishQueueDrift_()
		: { ok: true, skipped: true, reason: "mode-not-active" };
	if (isCloudflareQueuedPublicationEnabled_()) scheduleCloudflarePublishWorker_();
	return { ok: repair.ok !== false, committedVersionId: committed, repair: repair, diagnostics: getCloudflarePublishQueueDiagnostics_() };
}

function setCloudflarePublicationMode_(payloadRaw, secretOrPasswordRaw) {
	assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw);
	const payload = payloadRaw && typeof payloadRaw === "object" ? payloadRaw : {};
	const mode = String(payload.mode || "").trim().toLowerCase();
	if (mode !== CLOUDFLARE_PUBLICATION_MODE_QUEUED_V2 && mode !== CLOUDFLARE_PUBLICATION_MODE_DISABLED && mode !== CLOUDFLARE_PUBLICATION_MODE_LEGACY_MANUAL) {
		throw new Error("Invalid Cloudflare publication mode. Use queued-v2, disabled, or legacy-manual.");
	}
	if (mode === CLOUDFLARE_PUBLICATION_MODE_QUEUED_V2) {
		const state = readCloudflarePublishQueueState_();
		if (!state.active.committedVersionId) throw new Error("Initialize the Cloudflare queue with a committed active version before enabling queued-v2.");
	}
	PropertiesService.getScriptProperties().setProperty(CLOUDFLARE_PUBLICATION_MODE_PROPERTY, mode);
	if (mode === CLOUDFLARE_PUBLICATION_MODE_QUEUED_V2) scheduleCloudflarePublishWorker_();
	else removeCloudflarePublishWorkerTriggers_();
	return getCloudflarePublishQueueDiagnostics_();
}

function retryCloudflarePublishQueue(payloadRaw, secretOrPasswordRaw) {
	assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw);
	mutateCloudflarePublishQueueState_(function (state) {
		state.retry.nextAttemptAt = "";
		state.retry.lastError = "";
		state.paused = false;
	});
	scheduleCloudflarePublishWorker_();
	return getCloudflarePublishQueueDiagnostics_();
}

function runCloudflarePublishWorkerTick(payloadRaw, secretOrPasswordRaw) {
	assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw);
	return cloudflarePublishWorkerTick();
}

function pauseCloudflarePublishQueue(payloadRaw, secretOrPasswordRaw) {
	assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw);
	const payload = payloadRaw && typeof payloadRaw === "object" ? payloadRaw : {};
	const paused = payload.paused !== false;
	mutateCloudflarePublishQueueState_(function (state) { state.paused = paused; });
	if (paused) removeCloudflarePublishWorkerTriggers_(); else scheduleCloudflarePublishWorker_();
	return getCloudflarePublishQueueDiagnostics_();
}

function repairCloudflarePublishQueue(payloadRaw, secretOrPasswordRaw) {
	assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw);
	return repairCloudflarePublishQueueDrift_();
}

function inspectCloudflarePublishQueue(payloadRaw, secretOrPasswordRaw) {
	assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw);
	return getCloudflarePublishQueueDiagnostics_();
}

function initializeCloudflarePublishQueue(payloadRaw, secretOrPasswordRaw) {
	assertCloudflarePublicDataPublishAuth_(secretOrPasswordRaw);
	return initializeCloudflarePublishQueue_(payloadRaw);
}

function setCloudflarePublicationMode(payloadRaw, secretOrPasswordRaw) {
	return setCloudflarePublicationMode_(payloadRaw, secretOrPasswordRaw);
}
