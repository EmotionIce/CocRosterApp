// Private war follow-up workflow state.
//
// This module deliberately stores staff decisions outside the active roster
// payload. Reads and writes here must never publish roster versions, enqueue
// Cloudflare work, or participate in the refresh job.

const WAR_FOLLOWUP_SCHEMA_VERSION = 2;
const WAR_FOLLOWUP_PRIVATE_PATH = "private/warFollowup/v1";
const WAR_FOLLOWUP_SETTINGS_PATH = WAR_FOLLOWUP_PRIVATE_PATH + "/settings";
const WAR_FOLLOWUP_CASES_PATH = WAR_FOLLOWUP_PRIVATE_PATH + "/cases";
const WAR_FOLLOWUP_MAX_ACTIVITY = 80;
const WAR_FOLLOWUP_MAX_CASE_MUTATIONS = 16;
const WAR_FOLLOWUP_MAX_RULE_MUTATIONS = 32;
// This ledger is global to settings rather than per player. Keep enough history
// that a delayed HTTP fallback cannot be evicted by unrelated account toggles.
const WAR_FOLLOWUP_MAX_TRUST_MUTATIONS = 128;

const WAR_FOLLOWUP_STATUS_SET = {
	needs_review: true,
	waiting: true,
	watching: true,
	needs_dm: true,
	hero_down: true,
	closed: true,
	dismissed: true,
};

const WAR_FOLLOWUP_OUTCOME_SET = {
	"": true,
	no_action: true,
	approved_return: true,
	no_return: true,
	closed: true,
};

const WAR_FOLLOWUP_REASON_SET = {
	manual: true,
	regular_missed: true,
	regular_performance: true,
	cwl_missed: true,
	cwl_performance: true,
};

// War follow-up is shared by the password-protected admin workspace and the
// authenticated Discord bot. Keep this authorization deliberately scoped to
// this private workflow; a Discord credential must not become a general admin
// password for unrelated API methods.
function assertWarFollowupAccess_(credentialRaw) {
	try {
		assertAdminPassword_(credentialRaw);
		return "admin";
	} catch (adminErr) {
		try {
			assertDiscordBotApiSecret_(credentialRaw);
			return "discord";
		} catch (botErr) {
			throw new Error("Authentication failed for war follow-up.");
		}
	}
}

function clampWarFollowupNumber_(valueRaw, minRaw, maxRaw, fallbackRaw, integerRaw) {
	const min = Number(minRaw);
	const max = Number(maxRaw);
	const fallback = Number(fallbackRaw);
	const value = Number(valueRaw);
	const normalized = isFinite(value) ? value : fallback;
	const bounded = Math.max(min, Math.min(max, normalized));
	return integerRaw ? Math.floor(bounded) : Math.round(bounded * 100) / 100;
}

function sanitizeWarFollowupText_(valueRaw, maxLengthRaw) {
	const maxLength = Math.max(1, toNonNegativeInt_(maxLengthRaw) || 200);
	return String(valueRaw == null ? "" : valueRaw)
		.replace(/[\u0000-\u001F\u007F]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, maxLength);
}

function sanitizeWarFollowupMultilineText_(valueRaw, maxLengthRaw) {
	const maxLength = Math.max(1, toNonNegativeInt_(maxLengthRaw) || 4000);
	return String(valueRaw == null ? "" : valueRaw)
		.replace(/\r\n?/g, "\n")
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]+/g, " ")
		.split("\n")
		.map(function (line) { return line.replace(/[ \t]+/g, " ").trim(); })
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim()
		.slice(0, maxLength);
}

function sanitizeWarFollowupTimestamp_(valueRaw) {
	const ms = parseIsoToMs_(valueRaw);
	return ms > 0 ? new Date(ms).toISOString() : "";
}

function sanitizeWarFollowupStringList_(listRaw, optionsRaw) {
	const options = optionsRaw && typeof optionsRaw === "object" ? optionsRaw : {};
	const list = Array.isArray(listRaw) ? listRaw : [];
	const maxItems = Math.max(1, toNonNegativeInt_(options.maxItems) || 40);
	const maxLength = Math.max(1, toNonNegativeInt_(options.maxLength) || 120);
	const allowed = options.allowed && typeof options.allowed === "object" ? options.allowed : null;
	const out = [];
	const seen = {};
	for (let i = 0; i < list.length && out.length < maxItems; i++) {
		const value = sanitizeWarFollowupText_(list[i], maxLength);
		if (!value || seen[value] || (allowed && !allowed[value])) continue;
		seen[value] = true;
		out.push(value);
	}
	return out;
}

function sanitizeWarFollowupTagList_(listRaw) {
	const list = Array.isArray(listRaw) ? listRaw : [];
	const out = [];
	const seen = {};
	for (let i = 0; i < list.length && out.length < 1000; i++) {
		const tag = normalizeTag_(list[i]);
		if (!tag || !isValidPlayerTag_(tag) || seen[tag]) continue;
		seen[tag] = true;
		out.push(tag);
	}
	out.sort();
	return out;
}

function sanitizeWarFollowupTrustMutationLedger_(ledgerRaw) {
	const ledger = Array.isArray(ledgerRaw) ? ledgerRaw : [];
	const out = [];
	const seen = {};
	for (let i = 0; i < ledger.length; i++) {
		const item = ledger[i] && typeof ledger[i] === "object" ? ledger[i] : {};
		const mutationId = sanitizeWarFollowupText_(item.mutationId, 120);
		const tag = normalizeTag_(item.tag);
		const updatedAt = sanitizeWarFollowupTimestamp_(item.updatedAt);
		if (!mutationId || !tag || !isValidPlayerTag_(tag) || !updatedAt || seen[mutationId]) continue;
		seen[mutationId] = true;
		out.push({
			mutationId: mutationId,
			tag: tag,
			trusted: toBooleanFlag_(item.trusted),
			updatedAt: updatedAt,
		});
	}
	return out.slice(Math.max(0, out.length - WAR_FOLLOWUP_MAX_TRUST_MUTATIONS));
}

function sanitizeWarFollowupRulesMutationLedger_(ledgerRaw) {
	const ledger = Array.isArray(ledgerRaw) ? ledgerRaw : [];
	const out = [];
	const seen = {};
	for (let i = 0; i < ledger.length; i++) {
		const item = ledger[i] && typeof ledger[i] === "object" ? ledger[i] : {};
		const mutationId = sanitizeWarFollowupText_(item.mutationId, 120);
		const updatedAt = sanitizeWarFollowupTimestamp_(item.updatedAt);
		if (!mutationId || !updatedAt || seen[mutationId]) continue;
		seen[mutationId] = true;
		out.push({
			mutationId: mutationId,
			updatedAt: updatedAt,
		});
	}
	return out.slice(Math.max(0, out.length - WAR_FOLLOWUP_MAX_RULE_MUTATIONS));
}

function createDefaultWarFollowupSettings_() {
	return {
		schemaVersion: WAR_FOLLOWUP_SCHEMA_VERSION,
		regularLookbackWars: 8,
		regularMissedThreshold: 2,
		regularPerformanceEnabled: true,
		regularMinimumAttacks: 6,
		regularAverageStarsThreshold: 1.8,
		regularAverageDestructionThreshold: 75,
		cwlLookbackSeasons: 2,
		cwlMissedThreshold: 1,
		cwlPerformanceEnabled: true,
		cwlMinimumAttacks: 4,
		cwlAverageStarsThreshold: 1.8,
		cwlAverageDestructionThreshold: 75,
		defaultRecoveryWars: 3,
		defaultHeroDownRosterId: "",
		missingDiscordEnabled: true,
		moderatorNames: [],
		trustedPlayerTags: [],
		trustMutationLedger: [],
		rulesMutationLedger: [],
		rulesUpdatedAt: "",
		updatedAt: "",
	};
}

function sanitizeWarFollowupSettings_(settingsRaw) {
	const settings = settingsRaw && typeof settingsRaw === "object" ? settingsRaw : {};
	const defaults = createDefaultWarFollowupSettings_();
	return {
		schemaVersion: WAR_FOLLOWUP_SCHEMA_VERSION,
		regularLookbackWars: clampWarFollowupNumber_(settings.regularLookbackWars, 1, 8, defaults.regularLookbackWars, true),
		regularMissedThreshold: clampWarFollowupNumber_(settings.regularMissedThreshold, 1, 16, defaults.regularMissedThreshold, true),
		regularPerformanceEnabled: settings.regularPerformanceEnabled == null
			? defaults.regularPerformanceEnabled
			: toBooleanFlag_(settings.regularPerformanceEnabled),
		regularMinimumAttacks: clampWarFollowupNumber_(settings.regularMinimumAttacks, 2, 32, defaults.regularMinimumAttacks, true),
		regularAverageStarsThreshold: clampWarFollowupNumber_(settings.regularAverageStarsThreshold, 0.5, 3, defaults.regularAverageStarsThreshold, false),
		regularAverageDestructionThreshold: clampWarFollowupNumber_(settings.regularAverageDestructionThreshold, 25, 100, defaults.regularAverageDestructionThreshold, false),
		cwlLookbackSeasons: clampWarFollowupNumber_(settings.cwlLookbackSeasons, 1, 8, defaults.cwlLookbackSeasons, true),
		cwlMissedThreshold: clampWarFollowupNumber_(settings.cwlMissedThreshold, 1, 8, defaults.cwlMissedThreshold, true),
		cwlPerformanceEnabled: settings.cwlPerformanceEnabled == null
			? defaults.cwlPerformanceEnabled
			: toBooleanFlag_(settings.cwlPerformanceEnabled),
		cwlMinimumAttacks: clampWarFollowupNumber_(settings.cwlMinimumAttacks, 2, 24, defaults.cwlMinimumAttacks, true),
		cwlAverageStarsThreshold: clampWarFollowupNumber_(settings.cwlAverageStarsThreshold, 0.5, 3, defaults.cwlAverageStarsThreshold, false),
		cwlAverageDestructionThreshold: clampWarFollowupNumber_(settings.cwlAverageDestructionThreshold, 25, 100, defaults.cwlAverageDestructionThreshold, false),
		defaultRecoveryWars: clampWarFollowupNumber_(settings.defaultRecoveryWars, 1, 8, defaults.defaultRecoveryWars, true),
		defaultHeroDownRosterId: sanitizeWarFollowupText_(settings.defaultHeroDownRosterId, 120),
		missingDiscordEnabled: settings.missingDiscordEnabled == null
			? defaults.missingDiscordEnabled
			: toBooleanFlag_(settings.missingDiscordEnabled),
		moderatorNames: sanitizeWarFollowupStringList_(settings.moderatorNames, { maxItems: 40, maxLength: 80 }),
		trustedPlayerTags: sanitizeWarFollowupTagList_(settings.trustedPlayerTags),
		trustMutationLedger: sanitizeWarFollowupTrustMutationLedger_(settings.trustMutationLedger),
		rulesMutationLedger: sanitizeWarFollowupRulesMutationLedger_(settings.rulesMutationLedger),
		rulesUpdatedAt: sanitizeWarFollowupTimestamp_(settings.rulesUpdatedAt),
		updatedAt: sanitizeWarFollowupTimestamp_(settings.updatedAt),
	};
}

function readWarFollowupSettings_() {
	const encoded = firebaseRequestJson_(WAR_FOLLOWUP_SETTINGS_PATH, "GET");
	return sanitizeWarFollowupSettings_(
		encoded && typeof encoded === "object" && !Array.isArray(encoded)
			? decodeFirebaseObjectKeysRecursive_(encoded)
			: null,
	);
}

function createEmptyWarFollowupEvidenceStats_() {
	return {
		warCount: 0,
		possibleAttacks: 0,
		usedAttacks: 0,
		missedAttacks: 0,
		countedAttacks: 0,
		starsTotal: 0,
		totalDestruction: 0,
		threeStarCount: 0,
		hitUpCount: 0,
		sameThHitCount: 0,
		hitDownCount: 0,
	};
}

function sanitizeWarFollowupEvidenceStats_(statsRaw) {
	const stats = statsRaw && typeof statsRaw === "object" ? statsRaw : {};
	const out = createEmptyWarFollowupEvidenceStats_();
	const keys = Object.keys(out);
	for (let i = 0; i < keys.length; i++) {
		out[keys[i]] = Math.min(1000000, toNonNegativeInt_(stats[keys[i]]));
	}
	return out;
}

function sanitizeWarFollowupEvidenceEvents_(eventsRaw) {
	const events = Array.isArray(eventsRaw) ? eventsRaw : [];
	const out = [];
	for (let i = 0; i < events.length && out.length < 16; i++) {
		const event = events[i] && typeof events[i] === "object" ? events[i] : {};
		const id = sanitizeWarFollowupText_(event.id || event.eventId || event.warKey || event.season, 240);
		if (!id) continue;
		out.push({
			id: id,
			label: sanitizeWarFollowupText_(event.label || event.season || event.warKey, 160),
			at: sanitizeWarFollowupTimestamp_(event.at || event.finalizedAt),
			clanTag: normalizeTag_(event.clanTag),
			stats: sanitizeWarFollowupEvidenceStats_(event.stats),
		});
	}
	return out;
}

function sanitizeWarFollowupEvidenceSnapshot_(snapshotRaw) {
	const snapshot = snapshotRaw && typeof snapshotRaw === "object" ? snapshotRaw : {};
	return {
		capturedAt: sanitizeWarFollowupTimestamp_(snapshot.capturedAt),
		regular: sanitizeWarFollowupEvidenceStats_(snapshot.regular),
		cwl: sanitizeWarFollowupEvidenceStats_(snapshot.cwl),
		regularEvents: sanitizeWarFollowupEvidenceEvents_(snapshot.regularEvents),
		cwlEvents: sanitizeWarFollowupEvidenceEvents_(snapshot.cwlEvents),
	};
}

function sanitizeWarFollowupActivity_(activityRaw) {
	const activity = Array.isArray(activityRaw) ? activityRaw : [];
	const out = [];
	for (let i = 0; i < activity.length; i++) {
		const item = activity[i] && typeof activity[i] === "object" ? activity[i] : {};
		const at = sanitizeWarFollowupTimestamp_(item.at);
		const type = sanitizeWarFollowupText_(item.type, 40);
		if (!at || !type) continue;
		out.push({
			id: sanitizeWarFollowupText_(item.id, 120) || ("legacy-" + i),
			at: at,
			type: type,
			actor: sanitizeWarFollowupText_(item.actor, 80),
			text: sanitizeWarFollowupMultilineText_(item.text, 2000),
		});
	}
	out.sort(function (left, right) { return String(left.at).localeCompare(String(right.at)); });
	return out.slice(Math.max(0, out.length - WAR_FOLLOWUP_MAX_ACTIVITY));
}

function sanitizeWarFollowupMutationLedger_(ledgerRaw) {
	const ledger = Array.isArray(ledgerRaw) ? ledgerRaw : [];
	const out = [];
	const seen = {};
	for (let i = 0; i < ledger.length; i++) {
		const item = ledger[i] && typeof ledger[i] === "object" ? ledger[i] : {};
		const mutationId = sanitizeWarFollowupText_(item.mutationId, 120);
		const action = sanitizeWarFollowupText_(item.action, 40).toLowerCase();
		const updatedAt = sanitizeWarFollowupTimestamp_(item.updatedAt);
		if (!mutationId || !action || !updatedAt || seen[mutationId]) continue;
		seen[mutationId] = true;
		out.push({
			mutationId: mutationId,
			action: action,
			updatedAt: updatedAt,
		});
	}
	return out.slice(Math.max(0, out.length - WAR_FOLLOWUP_MAX_CASE_MUTATIONS));
}

function sanitizeWarFollowupCase_(caseRaw, fallbackTagRaw) {
	const value = caseRaw && typeof caseRaw === "object" ? caseRaw : {};
	const tag = normalizeTag_(value.tag || fallbackTagRaw);
	if (!tag || !isValidPlayerTag_(tag)) return null;
	const statusRaw = sanitizeWarFollowupText_(value.status, 40).toLowerCase();
	const status = WAR_FOLLOWUP_STATUS_SET[statusRaw] ? statusRaw : "needs_review";
	const outcomeRaw = sanitizeWarFollowupText_(value.outcome, 40).toLowerCase();
	const outcome = WAR_FOLLOWUP_OUTCOME_SET[outcomeRaw] ? outcomeRaw : "";
	return {
		schemaVersion: WAR_FOLLOWUP_SCHEMA_VERSION,
		tag: tag,
		name: sanitizeWarFollowupText_(value.name, 120),
		discord: sanitizeWarFollowupText_(value.discord, 160),
		sourceRosterId: sanitizeWarFollowupText_(value.sourceRosterId, 120),
		sourceRosterTitle: sanitizeWarFollowupText_(value.sourceRosterTitle, 160),
		sourceClanTag: normalizeTag_(value.sourceClanTag),
		targetRosterId: sanitizeWarFollowupText_(value.targetRosterId, 120),
		targetRosterTitle: sanitizeWarFollowupText_(value.targetRosterTitle, 160),
		targetClanTag: normalizeTag_(value.targetClanTag),
		status: status,
		outcome: outcome,
		handledBy: sanitizeWarFollowupText_(value.handledBy, 80),
		assignedModeratorId: /^\d{17,20}$/.test(String(value.assignedModeratorId || "").trim())
			? String(value.assignedModeratorId).trim()
			: "",
		assignedModeratorName: sanitizeWarFollowupText_(value.assignedModeratorName || value.handledBy, 80),
		assignedAt: sanitizeWarFollowupTimestamp_(value.assignedAt),
		assignmentUpdatedAt: sanitizeWarFollowupTimestamp_(value.assignmentUpdatedAt),
		lastMeaningfulActionAt: sanitizeWarFollowupTimestamp_(value.lastMeaningfulActionAt || value.updatedAt),
		assignmentBlockedModeratorId: /^\d{17,20}$/.test(String(value.assignmentBlockedModeratorId || "").trim())
			? String(value.assignmentBlockedModeratorId).trim()
			: "",
		assignmentBlockedUntil: sanitizeWarFollowupTimestamp_(value.assignmentBlockedUntil),
		waitingUntil: sanitizeWarFollowupTimestamp_(value.waitingUntil),
		waitingReason: sanitizeWarFollowupMultilineText_(value.waitingReason, 1000),
		escalatedAt: sanitizeWarFollowupTimestamp_(value.escalatedAt),
		escalatedBy: sanitizeWarFollowupText_(value.escalatedBy, 80),
		openedAt: sanitizeWarFollowupTimestamp_(value.openedAt || value.createdAt),
		triggerSignalIds: sanitizeWarFollowupStringList_(value.triggerSignalIds, { maxItems: 24, maxLength: 300 }),
		contactPurpose: sanitizeWarFollowupText_(value.contactPurpose, 40).toLowerCase(),
		reasonCodes: sanitizeWarFollowupStringList_(value.reasonCodes, {
			maxItems: 8,
			maxLength: 40,
			allowed: WAR_FOLLOWUP_REASON_SET,
		}),
		dismissedSignalIds: sanitizeWarFollowupStringList_(value.dismissedSignalIds, { maxItems: 24, maxLength: 300 }),
		evidence: sanitizeWarFollowupEvidenceSnapshot_(value.evidence),
		dmText: sanitizeWarFollowupMultilineText_(value.dmText, 6000),
		dmSentAt: sanitizeWarFollowupTimestamp_(value.dmSentAt),
		watchStartedAt: sanitizeWarFollowupTimestamp_(value.watchStartedAt),
		watchWarTarget: clampWarFollowupNumber_(value.watchWarTarget, 1, 8, 2, true),
		recoveryStartedAt: sanitizeWarFollowupTimestamp_(value.recoveryStartedAt),
		recoveryWarTarget: clampWarFollowupNumber_(value.recoveryWarTarget, 1, 8, 3, true),
		requireNoMisses: value.requireNoMisses == null ? true : toBooleanFlag_(value.requireNoMisses),
		createdAt: sanitizeWarFollowupTimestamp_(value.createdAt),
		updatedAt: sanitizeWarFollowupTimestamp_(value.updatedAt),
		closedAt: sanitizeWarFollowupTimestamp_(value.closedAt),
		activity: sanitizeWarFollowupActivity_(value.activity),
		mutationLedger: sanitizeWarFollowupMutationLedger_(value.mutationLedger),
	};
}

function createEmptyWarFollowupCase_(tagRaw, nowIsoRaw) {
	const nowIso = sanitizeWarFollowupTimestamp_(nowIsoRaw) || new Date().toISOString();
	return sanitizeWarFollowupCase_({
		tag: tagRaw,
		status: "needs_review",
		createdAt: nowIso,
		updatedAt: nowIso,
		activity: [],
	}, tagRaw);
}

function readWarFollowupCase_(tagRaw) {
	const tag = normalizeTag_(tagRaw);
	if (!tag || !isValidPlayerTag_(tag)) throw new Error("Invalid player tag.");
	const path = WAR_FOLLOWUP_CASES_PATH + "/" + encodeFirebaseObjectKey_(tag);
	const encoded = firebaseRequestJson_(path, "GET");
	if (!encoded || typeof encoded !== "object" || Array.isArray(encoded)) return null;
	return sanitizeWarFollowupCase_(decodeFirebaseObjectKeysRecursive_(encoded), tag);
}

function getWarFollowupCase(tagRaw, password) {
	assertWarFollowupAccess_(password);
	const lock = LockService.getScriptLock();
	lock.waitLock(30000);
	try {
		// Reconciliation reads share the writer lock so an interrupted response
		// cannot observe the state halfway through a still-finishing mutation.
		return readWarFollowupCase_(tagRaw);
	} finally {
		lock.releaseLock();
	}
}

function appendWarFollowupActivity_(caseRaw, typeRaw, textRaw, actorRaw, nowIsoRaw) {
	const value = caseRaw && typeof caseRaw === "object" ? caseRaw : null;
	if (!value) return;
	const nowIso = sanitizeWarFollowupTimestamp_(nowIsoRaw) || new Date().toISOString();
	if (!Array.isArray(value.activity)) value.activity = [];
	value.activity.push({
		id: typeof Utilities !== "undefined" && Utilities && typeof Utilities.getUuid === "function"
			? Utilities.getUuid()
			: ("activity-" + nowIso),
		at: nowIso,
		type: sanitizeWarFollowupText_(typeRaw, 40),
		actor: sanitizeWarFollowupText_(actorRaw, 80),
		text: sanitizeWarFollowupMultilineText_(textRaw, 2000),
	});
	value.activity = sanitizeWarFollowupActivity_(value.activity);
}

function applyWarFollowupIdentityPatch_(caseRaw, requestRaw) {
	const value = caseRaw && typeof caseRaw === "object" ? caseRaw : null;
	const request = requestRaw && typeof requestRaw === "object" ? requestRaw : {};
	if (!value) return;
	const fields = ["name", "discord", "targetRosterId", "targetRosterTitle", "handledBy"];
	const lengths = [120, 160, 120, 160, 80];
	for (let i = 0; i < fields.length; i++) {
		if (!Object.prototype.hasOwnProperty.call(request, fields[i])) continue;
		value[fields[i]] = sanitizeWarFollowupText_(request[fields[i]], lengths[i]);
	}
	// The source roster is the case-creation snapshot. Never let a later player
	// move silently rewrite the clan/evidence context that opened the case.
	if (!value.sourceRosterId && Object.prototype.hasOwnProperty.call(request, "sourceRosterId")) {
		value.sourceRosterId = sanitizeWarFollowupText_(request.sourceRosterId, 120);
	}
	if (!value.sourceRosterTitle && Object.prototype.hasOwnProperty.call(request, "sourceRosterTitle")) {
		value.sourceRosterTitle = sanitizeWarFollowupText_(request.sourceRosterTitle, 160);
	}
	if (!value.sourceClanTag && Object.prototype.hasOwnProperty.call(request, "sourceClanTag")) {
		value.sourceClanTag = normalizeTag_(request.sourceClanTag);
	}
	if (Object.prototype.hasOwnProperty.call(request, "targetClanTag")) value.targetClanTag = normalizeTag_(request.targetClanTag);
}

function applyWarFollowupOwner_(caseRaw, requestRaw, actorRaw, nowIsoRaw) {
	const value = caseRaw && typeof caseRaw === "object" ? caseRaw : null;
	const request = requestRaw && typeof requestRaw === "object" ? requestRaw : {};
	if (!value) return;
	const moderatorIdRaw = String(request.assignedModeratorId || "").trim();
	const moderatorId = /^\d{17,20}$/.test(moderatorIdRaw) ? moderatorIdRaw : "";
	const moderatorName = sanitizeWarFollowupText_(request.assignedModeratorName || request.handledBy, 80);
	const nowIso = sanitizeWarFollowupTimestamp_(nowIsoRaw) || new Date().toISOString();
	value.assignedModeratorId = moderatorId;
	value.assignedModeratorName = moderatorId ? (moderatorName || moderatorId) : "";
	value.handledBy = value.assignedModeratorName;
	value.assignedAt = moderatorId ? nowIso : "";
	value.assignmentUpdatedAt = nowIso;
	value.lastMeaningfulActionAt = nowIso;
	if (moderatorId) {
		value.assignmentBlockedModeratorId = "";
		value.assignmentBlockedUntil = "";
	}
	appendWarFollowupActivity_(
		value,
		moderatorId ? "assigned" : "unassigned",
		moderatorId
			? ("Assigned to " + value.assignedModeratorName + " (" + moderatorId + ").")
			: "Assignment cleared.",
		actorRaw,
		nowIso,
	);
}

function getWarFollowupState(password) {
	assertWarFollowupAccess_(password);
	const values = firebaseBatchGetJson_([WAR_FOLLOWUP_SETTINGS_PATH, WAR_FOLLOWUP_CASES_PATH]);
	const encodedSettings = values[WAR_FOLLOWUP_SETTINGS_PATH];
	const encodedCases = values[WAR_FOLLOWUP_CASES_PATH];
	const settings = sanitizeWarFollowupSettings_(
		encodedSettings && typeof encodedSettings === "object"
			? decodeFirebaseObjectKeysRecursive_(encodedSettings)
			: null,
	);
	const decodedCases = encodedCases && typeof encodedCases === "object" && !Array.isArray(encodedCases)
		? decodeFirebaseObjectKeysRecursive_(encodedCases)
		: {};
	const cases = [];
	const keys = Object.keys(decodedCases);
	for (let i = 0; i < keys.length; i++) {
		const value = sanitizeWarFollowupCase_(decodedCases[keys[i]], keys[i]);
		if (value) {
			// Idempotency metadata is only needed by single-case reconciliation
			// and mutation retries, not the normal workspace bootstrap.
			delete value.mutationLedger;
			cases.push(value);
		}
	}
	cases.sort(function (left, right) {
		return String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt)) ||
			String(left.tag).localeCompare(String(right.tag));
	});
	delete settings.trustMutationLedger;
	delete settings.rulesMutationLedger;
	return {
		schemaVersion: WAR_FOLLOWUP_SCHEMA_VERSION,
		settings: settings,
		cases: cases,
	};
}

function saveWarFollowupSettings(settingsRaw, password, expectedRulesUpdatedAtRaw, mutationIdRaw) {
	assertWarFollowupAccess_(password);
	const lock = LockService.getScriptLock();
	lock.waitLock(30000);
	try {
		const current = readWarFollowupSettings_();
		const hasMutationId = mutationIdRaw != null;
		const mutationId = sanitizeWarFollowupText_(mutationIdRaw, 120);
		if (hasMutationId && !mutationId) throw new Error("War follow-up rules mutation ID is required.");
		if (mutationId) {
			const ledger = sanitizeWarFollowupRulesMutationLedger_(current.rulesMutationLedger);
			for (let i = 0; i < ledger.length; i++) {
				if (ledger[i].mutationId === mutationId) return current;
			}
		}
		const hasExpectedRulesUpdatedAt = expectedRulesUpdatedAtRaw != null;
		const expectedRaw = expectedRulesUpdatedAtRaw == null ? "" : String(expectedRulesUpdatedAtRaw).trim();
		const expectedRulesUpdatedAt = sanitizeWarFollowupTimestamp_(expectedRaw);
		if (hasExpectedRulesUpdatedAt && expectedRaw && !expectedRulesUpdatedAt) {
			throw new Error("Invalid war follow-up rules timestamp.");
		}
		if (hasExpectedRulesUpdatedAt && expectedRulesUpdatedAt !== current.rulesUpdatedAt) {
			throw new Error("War follow-up rules changed since they were opened. Reload and try again.");
		}
		const incoming = settingsRaw && typeof settingsRaw === "object" ? settingsRaw : {};
		const settings = sanitizeWarFollowupSettings_(Object.assign({}, current, incoming, {
			// Account exclusions have their own atomic endpoint. A stale Rules
			// form must never replace them or its retry ledger.
			trustedPlayerTags: current.trustedPlayerTags,
			trustMutationLedger: current.trustMutationLedger,
			rulesMutationLedger: current.rulesMutationLedger,
		}));
		const currentUpdatedMs = parseIsoToMs_(current.updatedAt);
		settings.updatedAt = new Date(Math.max(Date.now(), currentUpdatedMs + 1)).toISOString();
		settings.rulesUpdatedAt = settings.updatedAt;
		if (mutationId) {
			settings.rulesMutationLedger = sanitizeWarFollowupRulesMutationLedger_(
				(Array.isArray(settings.rulesMutationLedger) ? settings.rulesMutationLedger : []).concat([{
					mutationId: mutationId,
					updatedAt: settings.updatedAt,
				}]),
			);
		}
		firebaseRequestJson_(
			WAR_FOLLOWUP_SETTINGS_PATH,
			"PUT",
			encodeFirebaseObjectKeysRecursive_(settings),
		);
		return settings;
	} finally {
		lock.releaseLock();
	}
}

function getWarFollowupRulesStatus(mutationIdRaw, password) {
	assertWarFollowupAccess_(password);
	const mutationId = sanitizeWarFollowupText_(mutationIdRaw, 120);
	if (!mutationId) throw new Error("War follow-up rules mutation ID is required.");
	const lock = LockService.getScriptLock();
	lock.waitLock(30000);
	try {
		const settings = readWarFollowupSettings_();
		const ledger = sanitizeWarFollowupRulesMutationLedger_(settings.rulesMutationLedger);
		const committed = ledger.some(function (entry) {
			return entry.mutationId === mutationId;
		});
		delete settings.trustMutationLedger;
		delete settings.rulesMutationLedger;
		return {
			committed: committed,
			settings: settings,
		};
	} finally {
		lock.releaseLock();
	}
}

function getWarFollowupTrustStatus(tagRaw, password, mutationIdRaw) {
	assertWarFollowupAccess_(password);
	const tag = normalizeTag_(tagRaw);
	if (!tag || !isValidPlayerTag_(tag)) throw new Error("Invalid player tag.");
	const lock = LockService.getScriptLock();
	lock.waitLock(30000);
	try {
		const settings = readWarFollowupSettings_();
		const mutationId = sanitizeWarFollowupText_(mutationIdRaw, 120);
		const ledger = mutationId
			? sanitizeWarFollowupTrustMutationLedger_(settings.trustMutationLedger)
			: [];
		return {
			tag: tag,
			trusted: settings.trustedPlayerTags.indexOf(tag) >= 0,
			updatedAt: settings.updatedAt,
			committed: !!mutationId && ledger.some(function (entry) {
				return entry.mutationId === mutationId && entry.tag === tag;
			}),
		};
	} finally {
		lock.releaseLock();
	}
}

function setWarFollowupTrustedAccount(tagRaw, trustedRaw, password, mutationIdRaw) {
	assertWarFollowupAccess_(password);
	const tag = normalizeTag_(tagRaw);
	if (!tag || !isValidPlayerTag_(tag)) throw new Error("Invalid player tag.");
	const trusted = toBooleanFlag_(trustedRaw);
	const hasMutationId = mutationIdRaw != null;
	const mutationId = sanitizeWarFollowupText_(mutationIdRaw, 120);
	if (hasMutationId && !mutationId) throw new Error("War follow-up trust mutation ID is required.");
	const lock = LockService.getScriptLock();
	lock.waitLock(30000);
	try {
		const settings = readWarFollowupSettings_();
		if (mutationId) {
			const ledger = sanitizeWarFollowupTrustMutationLedger_(settings.trustMutationLedger);
			for (let i = 0; i < ledger.length; i++) {
				if (ledger[i].mutationId !== mutationId) continue;
				if (ledger[i].tag !== tag || ledger[i].trusted !== trusted) {
					throw new Error("This war follow-up trust mutation ID was already used for another change.");
				}
				return {
					tag: tag,
					trusted: settings.trustedPlayerTags.indexOf(tag) >= 0,
					updatedAt: settings.updatedAt,
				};
			}
		}
		const tagSet = {};
		for (let i = 0; i < settings.trustedPlayerTags.length; i++) {
			tagSet[settings.trustedPlayerTags[i]] = true;
		}
		if (trusted) tagSet[tag] = true;
		else delete tagSet[tag];
		settings.trustedPlayerTags = sanitizeWarFollowupTagList_(Object.keys(tagSet));
		const currentUpdatedMs = parseIsoToMs_(settings.updatedAt);
		settings.updatedAt = new Date(Math.max(Date.now(), currentUpdatedMs + 1)).toISOString();
		if (mutationId) {
			settings.trustMutationLedger = sanitizeWarFollowupTrustMutationLedger_(
				(Array.isArray(settings.trustMutationLedger) ? settings.trustMutationLedger : []).concat([{
					mutationId: mutationId,
					tag: tag,
					trusted: trusted,
					updatedAt: settings.updatedAt,
				}]),
			);
		}
		firebaseRequestJson_(
			WAR_FOLLOWUP_SETTINGS_PATH,
			"PUT",
			encodeFirebaseObjectKeysRecursive_(settings),
		);
		return {
			tag: tag,
			trusted: settings.trustedPlayerTags.indexOf(tag) >= 0,
			updatedAt: settings.updatedAt,
		};
	} finally {
		lock.releaseLock();
	}
}

function mutateWarFollowupCase(requestRaw, password) {
	assertWarFollowupAccess_(password);
	const request = requestRaw && typeof requestRaw === "object" ? requestRaw : {};
	const tag = normalizeTag_(request.tag);
	if (!tag || !isValidPlayerTag_(tag)) throw new Error("Invalid player tag.");
	const action = sanitizeWarFollowupText_(request.action, 40).toLowerCase();
	if (!action) throw new Error("War follow-up action is required.");

	const lock = LockService.getScriptLock();
	lock.waitLock(30000);
	try {
		const current = readWarFollowupCase_(tag);
		const hasMutationId = Object.prototype.hasOwnProperty.call(request, "mutationId");
		const mutationId = sanitizeWarFollowupText_(request.mutationId, 120);
		if (hasMutationId && !mutationId) throw new Error("War follow-up mutation ID is required.");
		if (current && mutationId) {
			const mutationLedger = sanitizeWarFollowupMutationLedger_(current.mutationLedger);
			for (let i = 0; i < mutationLedger.length; i++) {
				if (mutationLedger[i].mutationId !== mutationId) continue;
				if (mutationLedger[i].action !== action) {
					throw new Error("This war follow-up mutation ID was already used for another action.");
				}
				return current;
			}
		}
		const currentUpdatedMs = current ? parseIsoToMs_(current.updatedAt) : 0;
		const nowIso = new Date(Math.max(Date.now(), currentUpdatedMs + 1)).toISOString();
		const hasExpectedUpdatedAt = Object.prototype.hasOwnProperty.call(request, "expectedUpdatedAt");
		const expectedRaw = request.expectedUpdatedAt == null ? "" : String(request.expectedUpdatedAt).trim();
		const expectedUpdatedAt = sanitizeWarFollowupTimestamp_(expectedRaw);
		if (hasExpectedUpdatedAt && expectedRaw && !expectedUpdatedAt) {
			throw new Error("Invalid war follow-up update timestamp.");
		}
		if (hasExpectedUpdatedAt) {
			const versionMatches = expectedUpdatedAt
				? !!current && current.updatedAt === expectedUpdatedAt
				: !current;
			if (!versionMatches) {
				throw new Error("This follow-up changed since it was opened. Reload and try again.");
			}
		}
		const value = current || createEmptyWarFollowupCase_(tag, nowIso);
		applyWarFollowupIdentityPatch_(value, request);
		const actor = sanitizeWarFollowupText_(request.actor || request.handledBy || value.handledBy, 80);
		const currentSignalIds = sanitizeWarFollowupStringList_(request.signalIds, { maxItems: 24, maxLength: 300 });

		switch (action) {
			case "create_automatic":
				if (current && current.status !== "closed" && current.status !== "dismissed") {
					throw new Error("This follow-up is already open.");
				}
				value.status = "needs_review";
				value.sourceRosterId = sanitizeWarFollowupText_(request.sourceRosterId, 120);
				value.sourceRosterTitle = sanitizeWarFollowupText_(request.sourceRosterTitle, 160);
				value.sourceClanTag = normalizeTag_(request.sourceClanTag);
				value.outcome = "";
				value.reasonCodes = sanitizeWarFollowupStringList_(request.reasonCodes, {
					maxItems: 8,
					maxLength: 40,
					allowed: WAR_FOLLOWUP_REASON_SET,
				});
				value.triggerSignalIds = sanitizeWarFollowupStringList_(request.triggerSignalIds || request.signalIds, {
					maxItems: 24,
					maxLength: 300,
				});
				value.evidence = sanitizeWarFollowupEvidenceSnapshot_(request.evidence);
				value.openedAt = nowIso;
				value.closedAt = "";
				value.waitingUntil = "";
				value.waitingReason = "";
				value.escalatedAt = "";
				value.escalatedBy = "";
				appendWarFollowupActivity_(value, "automatic_case", "Opened from automated war evidence.", actor || "War Follow Up", nowIso);
				if (request.assignedModeratorId) {
					applyWarFollowupOwner_(value, request, actor || "War Follow Up", nowIso);
				} else {
					value.assignedModeratorId = "";
					value.assignedModeratorName = "";
					value.handledBy = "";
					value.assignedAt = "";
					value.assignmentUpdatedAt = nowIso;
				}
				break;
			case "manual_review":
				value.status = "needs_review";
				value.outcome = "";
				value.reasonCodes = sanitizeWarFollowupStringList_(
					(Array.isArray(request.reasonCodes) ? request.reasonCodes : []).concat(["manual"]),
					{ maxItems: 8, maxLength: 40, allowed: WAR_FOLLOWUP_REASON_SET },
				);
				value.closedAt = "";
				value.openedAt = nowIso;
				if (request.evidence) value.evidence = sanitizeWarFollowupEvidenceSnapshot_(request.evidence);
				appendWarFollowupActivity_(value, "manual_review", "Added for review.", actor, nowIso);
				break;
			case "dismiss":
				value.status = "dismissed";
				value.outcome = "no_action";
				value.dismissedSignalIds = currentSignalIds;
				value.closedAt = nowIso;
				appendWarFollowupActivity_(value, "dismissed", "Reviewed with no action.", actor, nowIso);
				break;
			case "watch":
				value.status = "watching";
				value.outcome = "";
				value.watchStartedAt = nowIso;
				value.watchWarTarget = clampWarFollowupNumber_(request.watchWarTarget, 1, 8, 2, true);
				value.dismissedSignalIds = currentSignalIds;
				value.closedAt = "";
				appendWarFollowupActivity_(
					value,
					"watching",
					"Watching for " + value.watchWarTarget + " regular war" + (value.watchWarTarget === 1 ? "." : "s."),
					actor,
					nowIso,
				);
				break;
			case "wait": {
				const followupHours = Number(request.followupHours);
				if ([0, 24, 48, 72].indexOf(followupHours) < 0) {
					throw new Error("Waiting follow-up must be 0, 24, 48, or 72 hours.");
				}
				value.status = "waiting";
				value.waitingUntil = followupHours > 0
					? new Date(parseIsoToMs_(nowIso) + followupHours * 60 * 60 * 1000).toISOString()
					: "";
				value.waitingReason = sanitizeWarFollowupMultilineText_(request.waitingReason, 1000);
				value.closedAt = "";
				appendWarFollowupActivity_(
					value,
					"waiting",
					"Marked waiting" + (followupHours ? (" with a " + followupHours + "h follow-up.") : " without a scheduled follow-up.") +
						(value.waitingReason ? (" " + value.waitingReason) : ""),
					actor,
					nowIso,
				);
				break;
			}
			case "waiting_due":
				if (value.status !== "waiting") throw new Error("This follow-up is no longer waiting.");
				if (value.waitingUntil && parseIsoToMs_(value.waitingUntil) > parseIsoToMs_(nowIso)) {
					throw new Error("This waiting follow-up is not due yet.");
				}
				value.status = "needs_review";
				value.waitingUntil = "";
				appendWarFollowupActivity_(value, "waiting_due", "Waiting follow-up is due for review.", actor || "War Follow Up", nowIso);
				break;
			case "contact":
				value.status = "needs_dm";
				value.contactPurpose = "general";
				value.dmText = sanitizeWarFollowupMultilineText_(request.dmText, 6000);
				if (!value.dmText) throw new Error("The contact message is empty.");
				value.dmSentAt = "";
				value.closedAt = "";
				appendWarFollowupActivity_(value, "contact_prepared", "Player contact message prepared.", actor, nowIso);
				break;
			case "hero_down":
				if (!value.targetRosterId && !value.targetClanTag) throw new Error("Choose a hero-down roster.");
				value.status = "needs_dm";
				value.outcome = "";
				value.reasonCodes = sanitizeWarFollowupStringList_(request.reasonCodes, {
					maxItems: 8,
					maxLength: 40,
					allowed: WAR_FOLLOWUP_REASON_SET,
				});
				value.evidence = sanitizeWarFollowupEvidenceSnapshot_(request.evidence);
				value.dmText = sanitizeWarFollowupMultilineText_(request.dmText, 6000);
				value.contactPurpose = "hero_down";
				value.recoveryWarTarget = clampWarFollowupNumber_(request.recoveryWarTarget, 1, 8, 3, true);
				value.requireNoMisses = request.requireNoMisses == null ? true : toBooleanFlag_(request.requireNoMisses);
				value.dmSentAt = "";
				value.recoveryStartedAt = "";
				value.closedAt = "";
				appendWarFollowupActivity_(
					value,
					"hero_down_decision",
					"Hero-down period selected: " + value.recoveryWarTarget + " regular war" + (value.recoveryWarTarget === 1 ? "." : "s."),
					actor,
					nowIso,
				);
				break;
			case "mark_dm_sent":
				if (value.status !== "needs_dm") throw new Error("This follow-up is not waiting for a DM.");
				value.dmText = sanitizeWarFollowupMultilineText_(request.dmText != null ? request.dmText : value.dmText, 6000);
				if (!value.dmText) throw new Error("The DM message is empty.");
				value.dmSentAt = nowIso;
				if (value.contactPurpose === "general") {
					value.status = "waiting";
					value.waitingUntil = new Date(parseIsoToMs_(nowIso) + 24 * 60 * 60 * 1000).toISOString();
					value.waitingReason = "Awaiting the player's response.";
				} else {
					value.status = "hero_down";
					value.recoveryStartedAt = nowIso;
				}
				appendWarFollowupActivity_(value, "dm_sent", "Decision DM marked as sent.", actor, nowIso);
				break;
			case "approve_return":
				value.status = "closed";
				value.outcome = "approved_return";
				value.closedAt = nowIso;
				value.dismissedSignalIds = currentSignalIds;
				appendWarFollowupActivity_(value, "approved_return", "Approved to return to regular wars.", actor, nowIso);
				break;
			case "extend":
				if (value.status !== "hero_down") throw new Error("Only an active hero-down period can be extended.");
				value.status = "needs_dm";
				value.outcome = "";
				value.recoveryWarTarget = clampWarFollowupNumber_(request.recoveryWarTarget, 1, 8, value.recoveryWarTarget || 3, true);
				value.requireNoMisses = request.requireNoMisses == null ? value.requireNoMisses : toBooleanFlag_(request.requireNoMisses);
				value.dmText = sanitizeWarFollowupMultilineText_(request.dmText, 6000);
				value.dmSentAt = "";
				value.recoveryStartedAt = "";
				appendWarFollowupActivity_(
					value,
					"extended",
					"Hero-down period extended to " + value.recoveryWarTarget + " regular war" + (value.recoveryWarTarget === 1 ? "." : "s."),
					actor,
					nowIso,
				);
				break;
			case "close":
				value.status = "closed";
				value.outcome = request.outcome === "no_return" ? "no_return" : "closed";
				value.closedAt = nowIso;
				value.dismissedSignalIds = currentSignalIds;
				appendWarFollowupActivity_(
					value,
					"closed",
					value.outcome === "no_return" ? "Closed without return to regular wars." : "Follow-up closed.",
					actor,
					nowIso,
				);
				break;
			case "resolve":
				value.status = "closed";
				value.outcome = "closed";
				value.closedAt = nowIso;
				value.waitingUntil = "";
				appendWarFollowupActivity_(value, "resolved", "Moderation case resolved.", actor, nowIso);
				break;
			case "reopen":
				value.status = "needs_review";
				value.outcome = "";
				value.closedAt = "";
				appendWarFollowupActivity_(value, "reopened", "Follow-up reopened.", actor, nowIso);
				break;
			case "add_note": {
				const note = sanitizeWarFollowupMultilineText_(request.note, 2000);
				if (!note) throw new Error("Private note is empty.");
				appendWarFollowupActivity_(value, "note", note, actor, nowIso);
				break;
			}
			case "set_handler":
				value.assignedModeratorId = "";
				value.assignedModeratorName = "";
				value.assignedAt = "";
				value.assignmentUpdatedAt = nowIso;
				appendWarFollowupActivity_(
					value,
					"handler",
					value.handledBy ? ("Assigned to " + value.handledBy + ".") : "Assignment cleared.",
					actor,
					nowIso,
				);
				break;
			case "assign_owner":
				if (!request.assignedModeratorId) throw new Error("Choose a moderator for this assignment.");
				applyWarFollowupOwner_(value, request, actor, nowIso);
				break;
			case "unassign_owner":
				applyWarFollowupOwner_(value, {}, actor, nowIso);
				value.assignmentBlockedModeratorId = /^\d{17,20}$/.test(String(request.blockedModeratorId || "").trim())
					? String(request.blockedModeratorId).trim()
					: "";
				value.assignmentBlockedUntil = sanitizeWarFollowupTimestamp_(request.blockedUntil);
				break;
			case "escalate":
				value.escalatedAt = nowIso;
				value.escalatedBy = actor;
				value.status = "needs_review";
				appendWarFollowupActivity_(value, "escalated", "Escalated for leadership review.", actor, nowIso);
				break;
			default:
				throw new Error("Unsupported war follow-up action: " + action);
		}

		if (value.status !== "waiting") {
			value.waitingUntil = "";
			value.waitingReason = "";
		}
		if (!value.createdAt) value.createdAt = nowIso;
		value.lastMeaningfulActionAt = nowIso;
		value.updatedAt = nowIso;
		if (mutationId) {
			value.mutationLedger = sanitizeWarFollowupMutationLedger_(
				(Array.isArray(value.mutationLedger) ? value.mutationLedger : []).concat([{
					mutationId: mutationId,
					action: action,
					updatedAt: nowIso,
				}]),
			);
		}
		const sanitized = sanitizeWarFollowupCase_(value, tag);
		const path = WAR_FOLLOWUP_CASES_PATH + "/" + encodeFirebaseObjectKey_(tag);
		firebaseRequestJson_(path, "PUT", encodeFirebaseObjectKeysRecursive_(sanitized));
		return sanitized;
	} finally {
		lock.releaseLock();
	}
}
