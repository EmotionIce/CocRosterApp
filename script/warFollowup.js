// Private war follow-up workflow state.
//
// This module deliberately stores staff decisions outside the active roster
// payload. Reads and writes here must never publish roster versions, enqueue
// Cloudflare work, or participate in the refresh job.

const WAR_FOLLOWUP_SCHEMA_VERSION = 3;
const WAR_FOLLOWUP_PRIVATE_PATH = "private/warFollowup/v1";
const WAR_FOLLOWUP_SETTINGS_PATH = WAR_FOLLOWUP_PRIVATE_PATH + "/settings";
const WAR_FOLLOWUP_CASES_PATH = WAR_FOLLOWUP_PRIVATE_PATH + "/cases";
const WAR_FOLLOWUP_MODERATORS_PATH = WAR_FOLLOWUP_PRIVATE_PATH + "/moderators";
const WAR_FOLLOWUP_MAX_ACTIVITY = 80;
const WAR_FOLLOWUP_MAX_CONVERSATION_MESSAGES = 40;
const WAR_FOLLOWUP_MAX_CONVERSATION_CHARS = 24000;
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
	removal_pending: true,
	removal_evasion: true,
	removed: true,
	closed: true,
	dismissed: true,
};

const WAR_FOLLOWUP_OUTCOME_SET = {
	"": true,
	no_action: true,
	approved_return: true,
	no_return: true,
	resolved: true,
	removed: true,
	removal_cancelled: true,
	rejoin_approved: true,
	closed: true,
};

const WAR_FOLLOWUP_REASON_SET = {
	manual: true,
	regular_missed: true,
	regular_performance: true,
	cwl_missed: true,
	cwl_performance: true,
};

const WAR_FOLLOWUP_CONTACT_STAGE_SET = {
	"": true,
	awaiting_first_response: true,
	awaiting_after_reminder: true,
	awaiting_final_response: true,
	no_response: true,
	reminder_failed: true,
	responded: true,
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

function sanitizeWarFollowupModerator_(moderatorRaw, fallbackDiscordIdRaw) {
	const value = moderatorRaw && typeof moderatorRaw === "object" ? moderatorRaw : {};
	const discordIdRaw = String(value.discordId || fallbackDiscordIdRaw || "").trim();
	if (!/^\d{17,20}$/.test(discordIdRaw)) return null;
	const notificationModeRaw = sanitizeWarFollowupText_(value.notificationMode, 20).toLowerCase();
	const clanTagsRaw = Array.isArray(value.clanTags) ? value.clanTags : [];
	const clanTags = [];
	const seenClanTags = {};
	for (let i = 0; i < clanTagsRaw.length && clanTags.length < 25; i++) {
		const clanTag = normalizeTag_(clanTagsRaw[i]);
		if (!clanTag || seenClanTags[clanTag]) continue;
		seenClanTags[clanTag] = true;
		clanTags.push(clanTag);
	}
	clanTags.sort();
	return {
		discordId: discordIdRaw,
		guildId: /^\d{17,20}$/.test(String(value.guildId || "").trim()) ? String(value.guildId).trim() : "",
		displayName: sanitizeWarFollowupText_(value.displayName, 80) || discordIdRaw,
		clanTags: clanTags,
		notificationMode: ["dm", "channel", "both"].indexOf(notificationModeRaw) >= 0 ? notificationModeRaw : "channel",
		accepting: value.accepting === true,
		updatedAt: sanitizeWarFollowupTimestamp_(value.updatedAt),
	};
}

function sanitizeWarFollowupModerators_(moderatorsRaw) {
	const source = moderatorsRaw && typeof moderatorsRaw === "object" ? moderatorsRaw : {};
	const entries = Array.isArray(source)
		? source.map(function (value) { return [value && value.discordId, value]; })
		: Object.keys(source).map(function (key) { return [key, source[key]]; });
	const out = [];
	for (let i = 0; i < entries.length && out.length < 100; i++) {
		const moderator = sanitizeWarFollowupModerator_(entries[i][1], entries[i][0]);
		if (moderator) out.push(moderator);
	}
	out.sort(function (left, right) {
		return Number(right.accepting) - Number(left.accepting) ||
			String(left.displayName).localeCompare(String(right.displayName)) ||
			String(left.discordId).localeCompare(String(right.discordId));
	});
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

function sanitizeWarFollowupConversation_(conversationRaw, legacyRaw) {
	const conversation = Array.isArray(conversationRaw) ? conversationRaw : [];
	const legacy = legacyRaw && typeof legacyRaw === "object" ? legacyRaw : {};
	const out = [];
	const seen = {};
	for (let i = 0; i < conversation.length; i++) {
		const item = conversation[i] && typeof conversation[i] === "object" ? conversation[i] : {};
		const direction = sanitizeWarFollowupText_(item.direction, 20).toLowerCase();
		const at = sanitizeWarFollowupTimestamp_(item.at);
		const text = sanitizeWarFollowupMultilineText_(item.text, 2000);
		if (["staff", "player"].indexOf(direction) < 0 || !at || !text) continue;
		const messageId = /^\d{17,20}$/.test(String(item.messageId || "").trim()) ? String(item.messageId).trim() : "";
		const id = sanitizeWarFollowupText_(item.id, 160) || (direction + ":" + (messageId || at) + ":" + i);
		if (seen[id]) continue;
		seen[id] = true;
		out.push({
			id: id,
			direction: direction,
			at: at,
			actor: sanitizeWarFollowupText_(item.actor, 80) || (direction === "player" ? "Player" : "Staff"),
			text: text,
			messageId: messageId,
			deliveryMode: direction === "staff" && sanitizeWarFollowupText_(item.deliveryMode, 20).toLowerCase() === "bot" ? "bot" : "manual",
		});
	}
	if (!out.length) {
		const dmText = sanitizeWarFollowupMultilineText_(legacy.dmText, 2000);
		const dmAt = sanitizeWarFollowupTimestamp_(legacy.dmSentAt);
		const dmMessageId = /^\d{17,20}$/.test(String(legacy.dmMessageId || "").trim()) ? String(legacy.dmMessageId).trim() : "";
		if (dmText && dmAt) {
			out.push({
				id: "legacy-staff:" + (dmMessageId || dmAt),
				direction: "staff",
				at: dmAt,
				actor: sanitizeWarFollowupText_(legacy.dmSentByName, 80) || "Staff",
				text: dmText,
				messageId: dmMessageId,
				deliveryMode: sanitizeWarFollowupText_(legacy.dmDeliveryMode, 20).toLowerCase() === "bot" ? "bot" : "manual",
			});
		}
		const responseText = sanitizeWarFollowupMultilineText_(legacy.playerResponse, 2000);
		const responseAt = sanitizeWarFollowupTimestamp_(legacy.playerResponseAt);
		const responseMessageId = /^\d{17,20}$/.test(String(legacy.playerResponseMessageId || "").trim()) ? String(legacy.playerResponseMessageId).trim() : "";
		if (responseText && responseAt) {
			out.push({
				id: "legacy-player:" + (responseMessageId || responseAt),
				direction: "player",
				at: responseAt,
				actor: "Player",
				text: responseText,
				messageId: responseMessageId,
				deliveryMode: "manual",
			});
		}
	}
	out.sort(function (left, right) { return String(left.at).localeCompare(String(right.at)); });
	let trimmedCount = toNonNegativeInt_(legacy.conversationTrimmedCount);
	while (out.length > WAR_FOLLOWUP_MAX_CONVERSATION_MESSAGES) {
		out.shift();
		trimmedCount += 1;
	}
	let totalChars = out.reduce(function (total, item) { return total + item.text.length; }, 0);
	while (out.length > 1 && totalChars > WAR_FOLLOWUP_MAX_CONVERSATION_CHARS) {
		totalChars -= out[0].text.length;
		out.shift();
		trimmedCount += 1;
	}
	return { messages: out, trimmedCount: trimmedCount };
}

function appendWarFollowupConversation_(caseRaw, messageRaw) {
	const value = caseRaw && typeof caseRaw === "object" ? caseRaw : null;
	if (!value) return;
	const sanitized = sanitizeWarFollowupConversation_(
		(Array.isArray(value.conversation) ? value.conversation : []).concat([messageRaw]),
		value,
	);
	value.conversation = sanitized.messages;
	value.conversationTrimmedCount = sanitized.trimmedCount;
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
	const conversation = sanitizeWarFollowupConversation_(value.conversation, value);
	return {
		schemaVersion: WAR_FOLLOWUP_SCHEMA_VERSION,
		tag: tag,
		name: sanitizeWarFollowupText_(value.name, 120),
		discord: sanitizeWarFollowupText_(value.discord, 160),
		discordId: /^\d{17,20}$/.test(String(value.discordId || "").trim())
			? String(value.discordId).trim()
			: "",
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
		assignmentCoverageOverride: value.assignmentCoverageOverride === true,
		assignedAt: sanitizeWarFollowupTimestamp_(value.assignedAt),
		assignmentUpdatedAt: sanitizeWarFollowupTimestamp_(value.assignmentUpdatedAt),
		lastMeaningfulActionAt: sanitizeWarFollowupTimestamp_(value.lastMeaningfulActionAt || value.updatedAt),
		assignmentBlockedModeratorId: /^\d{17,20}$/.test(String(value.assignmentBlockedModeratorId || "").trim())
			? String(value.assignmentBlockedModeratorId).trim()
			: "",
		assignmentBlockedUntil: sanitizeWarFollowupTimestamp_(value.assignmentBlockedUntil),
		waitingUntil: sanitizeWarFollowupTimestamp_(value.waitingUntil),
		waitingReason: sanitizeWarFollowupMultilineText_(value.waitingReason, 1000),
		contactStage: WAR_FOLLOWUP_CONTACT_STAGE_SET[sanitizeWarFollowupText_(value.contactStage, 40).toLowerCase()]
			? sanitizeWarFollowupText_(value.contactStage, 40).toLowerCase()
			: "",
		contactAutomaticReminderAllowed: value.contactAutomaticReminderAllowed == null
			? true
			: value.contactAutomaticReminderAllowed === true,
		contactReminderText: sanitizeWarFollowupMultilineText_(value.contactReminderText, 2000),
		contactReminderSentAt: sanitizeWarFollowupTimestamp_(value.contactReminderSentAt),
		contactReminderMessageId: /^\d{17,20}$/.test(String(value.contactReminderMessageId || "").trim())
			? String(value.contactReminderMessageId).trim()
			: "",
		contactNoResponseAt: sanitizeWarFollowupTimestamp_(value.contactNoResponseAt),
		contactReminderFailedAt: sanitizeWarFollowupTimestamp_(value.contactReminderFailedAt),
		contactReminderFailureReason: sanitizeWarFollowupText_(value.contactReminderFailureReason, 300),
		playerResponse: sanitizeWarFollowupMultilineText_(value.playerResponse, 2000),
		playerResponseAt: sanitizeWarFollowupTimestamp_(value.playerResponseAt),
		playerResponseMessageId: sanitizeWarFollowupText_(value.playerResponseMessageId, 120),
		replyCaptureUntil: sanitizeWarFollowupTimestamp_(value.replyCaptureUntil),
		conversation: conversation.messages,
		conversationTrimmedCount: conversation.trimmedCount,
		resolutionNote: sanitizeWarFollowupMultilineText_(value.resolutionNote, 2000),
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
		dmDeliveryMode: sanitizeWarFollowupText_(value.dmDeliveryMode, 20).toLowerCase() === "bot" ? "bot" : (value.dmSentAt ? "manual" : ""),
		dmMessageId: /^\d{17,20}$/.test(String(value.dmMessageId || "").trim()) ? String(value.dmMessageId).trim() : "",
		dmSentByDiscordId: /^\d{17,20}$/.test(String(value.dmSentByDiscordId || "").trim()) ? String(value.dmSentByDiscordId).trim() : "",
		dmSentByName: sanitizeWarFollowupText_(value.dmSentByName, 80),
		dmQueueId: sanitizeWarFollowupText_(value.dmQueueId, 160),
		dmQueuedAt: sanitizeWarFollowupTimestamp_(value.dmQueuedAt),
		dmQueuedByDiscordId: /^\d{17,20}$/.test(String(value.dmQueuedByDiscordId || "").trim()) ? String(value.dmQueuedByDiscordId).trim() : "",
		dmQueuedByName: sanitizeWarFollowupText_(value.dmQueuedByName, 80),
		dmDeliveryFailedAt: sanitizeWarFollowupTimestamp_(value.dmDeliveryFailedAt),
		dmDeliveryFailureReason: sanitizeWarFollowupText_(value.dmDeliveryFailureReason, 300),
		watchStartedAt: sanitizeWarFollowupTimestamp_(value.watchStartedAt),
		watchWarTarget: clampWarFollowupNumber_(value.watchWarTarget, 1, 8, 2, true),
		recoveryStartedAt: sanitizeWarFollowupTimestamp_(value.recoveryStartedAt),
		recoveryWarTarget: clampWarFollowupNumber_(value.recoveryWarTarget, 1, 8, 3, true),
		requireNoMisses: value.requireNoMisses == null ? true : toBooleanFlag_(value.requireNoMisses),
		removalReason: sanitizeWarFollowupMultilineText_(value.removalReason, 1000),
		removalStartedAt: sanitizeWarFollowupTimestamp_(value.removalStartedAt),
		removalActionedAt: sanitizeWarFollowupTimestamp_(value.removalActionedAt),
		removalAbsentObservedAt: sanitizeWarFollowupTimestamp_(value.removalAbsentObservedAt),
		removalRejoinedAt: sanitizeWarFollowupTimestamp_(value.removalRejoinedAt),
		removalRejoinCount: Math.min(1000, toNonNegativeInt_(value.removalRejoinCount)),
		rejoinRosterId: sanitizeWarFollowupText_(value.rejoinRosterId, 120),
		rejoinRosterTitle: sanitizeWarFollowupText_(value.rejoinRosterTitle, 160),
		rejoinClanTag: normalizeTag_(value.rejoinClanTag),
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
	if (Object.prototype.hasOwnProperty.call(request, "discordId")) {
		const discordId = String(request.discordId || "").trim();
		value.discordId = /^\d{17,20}$/.test(discordId) ? discordId : "";
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
	value.assignmentCoverageOverride = Boolean(moderatorId && request.assignmentCoverageOverride === true);
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
			? ("Assigned to " + value.assignedModeratorName + " (" + moderatorId + ")." +
				(value.assignmentCoverageOverride ? " Senior leader took ownership outside automatic clan coverage." : ""))
			: "Assignment cleared.",
		actorRaw,
		nowIso,
	);
}

function getWarFollowupState(password) {
	assertWarFollowupAccess_(password);
	const values = firebaseBatchGetJson_([WAR_FOLLOWUP_SETTINGS_PATH, WAR_FOLLOWUP_CASES_PATH, WAR_FOLLOWUP_MODERATORS_PATH]);
	const encodedSettings = values[WAR_FOLLOWUP_SETTINGS_PATH];
	const encodedCases = values[WAR_FOLLOWUP_CASES_PATH];
	const encodedModerators = values[WAR_FOLLOWUP_MODERATORS_PATH];
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
		moderators: sanitizeWarFollowupModerators_(
			encodedModerators && typeof encodedModerators === "object"
				? decodeFirebaseObjectKeysRecursive_(encodedModerators)
				: null,
		),
	};
}

function syncWarFollowupModerator(moderatorRaw, password) {
	assertDiscordBotApiSecret_(password);
	const moderator = sanitizeWarFollowupModerator_(moderatorRaw, moderatorRaw && moderatorRaw.discordId);
	if (!moderator) throw new Error("A valid Discord moderator is required.");
	const lock = LockService.getScriptLock();
	lock.waitLock(30000);
	try {
		const path = WAR_FOLLOWUP_MODERATORS_PATH + "/" + encodeFirebaseObjectKey_(moderator.discordId);
		const encodedCurrent = firebaseRequestJson_(path, "GET");
		const current = sanitizeWarFollowupModerator_(
			encodedCurrent && typeof encodedCurrent === "object"
				? decodeFirebaseObjectKeysRecursive_(encodedCurrent)
				: null,
			moderator.discordId,
		);
		const requestedMs = parseIsoToMs_(moderator.updatedAt);
		const currentMs = parseIsoToMs_(current && current.updatedAt);
		moderator.updatedAt = new Date(Math.max(Date.now(), requestedMs, currentMs + 1)).toISOString();
		firebaseRequestJson_(path, "PUT", encodeFirebaseObjectKeysRecursive_(moderator));
		return moderator;
	} finally {
		lock.releaseLock();
	}
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
		const dismissibleSignalIds = currentSignalIds.length
			? currentSignalIds
			: sanitizeWarFollowupStringList_(value.triggerSignalIds, { maxItems: 24, maxLength: 300 });
		const removalLocked = ["removal_pending", "removal_evasion", "removed"].indexOf(value.status) >= 0;
		if (removalLocked && ["contact", "watch", "hero_down", "wait", "dismiss", "resolve", "reopen", "close"].indexOf(action) >= 0) {
			throw new Error("Complete, repeat, approve, or cancel the removal workflow first.");
		}
		if (action === "dismiss" && ["needs_review", "watching"].indexOf(value.status) < 0) throw new Error("This case cannot be closed as no action from its current state.");
		if (action === "watch" && value.status !== "needs_review") throw new Error("Only a case awaiting review can start monitoring.");
		if (action === "contact" && ["needs_review", "waiting"].indexOf(value.status) < 0) throw new Error("This case is not ready for a contact decision.");
		if (action === "wait" && ["needs_review", "waiting", "needs_dm"].indexOf(value.status) < 0) throw new Error("This case cannot schedule a follow-up from its current state.");
		if (action === "queue_dm" && value.status !== "needs_dm") throw new Error("This follow-up is not waiting for a Discord DM.");
		if (["contact_reminder_sent", "contact_reminder_failed", "contact_no_response"].indexOf(action) >= 0) {
			if (value.status !== "waiting" || value.contactPurpose !== "general" || value.dmDeliveryMode !== "bot" || !value.dmMessageId) {
				throw new Error("This case is not in the bot-managed contact workflow.");
			}
			if (value.waitingUntil && parseIsoToMs_(value.waitingUntil) > parseIsoToMs_(nowIso)) {
				throw new Error("This contact deadline is not due yet.");
			}
			if (["contact_reminder_sent", "contact_reminder_failed"].indexOf(action) >= 0 && value.contactAutomaticReminderAllowed === false) {
				throw new Error("This moderator-approved final message must not trigger another automatic reminder.");
			}
		}
		if (action === "hero_down" && value.status !== "needs_review") throw new Error("Only a case awaiting review can start a hero-down period.");
		if (action === "remove" && ["needs_review", "waiting", "hero_down", "removal_evasion", "removed"].indexOf(value.status) < 0) throw new Error("This case is not ready for a removal decision.");
		if (action === "close" && value.status !== "hero_down") throw new Error("Only an active hero-down case can be closed without return.");
		if (action === "resolve" && ["needs_review", "needs_dm", "waiting"].indexOf(value.status) < 0) throw new Error("This case cannot be recorded as resolved from its current state.");
		if (action === "player_response") {
			const responseReference = String(request.responseToMessageId || "").trim();
			const exactReply = /^\d{17,20}$/.test(responseReference) &&
				(responseReference === value.dmMessageId || responseReference === value.contactReminderMessageId);
			const captureWindowOpen = parseIsoToMs_(value.replyCaptureUntil) >= parseIsoToMs_(nowIso);
			const responseStateAllowed = value.status === "waiting" ||
				(["needs_review", "closed", "dismissed"].indexOf(value.status) >= 0 && (captureWindowOpen || exactReply));
			if (!responseStateAllowed || value.contactPurpose !== "general" || !value.dmSentAt || value.dmDeliveryMode !== "bot" || !value.dmMessageId) {
				throw new Error("This case is not currently awaiting a bot-captured player response.");
			}
		}
		if (action === "reopen" && ["needs_dm", "waiting", "watching", "closed", "dismissed"].indexOf(value.status) < 0) throw new Error("This case cannot be reopened from its current state.");
		if (["set_handler", "assign_owner", "unassign_owner"].indexOf(action) >= 0 &&
			["needs_review", "waiting", "needs_dm", "removal_pending", "removal_evasion", "removed", "hero_down"].indexOf(value.status) < 0) {
			throw new Error("Only an active moderation case can have an owner.");
		}

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
					value.assignmentCoverageOverride = false;
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
				if (!(value.contactPurpose === "general" && parseIsoToMs_(value.replyCaptureUntil) > parseIsoToMs_(nowIso))) {
					value.replyCaptureUntil = "";
				}
				value.dismissedSignalIds = dismissibleSignalIds;
				value.closedAt = nowIso;
				appendWarFollowupActivity_(value, "dismissed", "Reviewed with no action.", actor, nowIso);
				break;
			case "watch":
				value.status = "watching";
				value.outcome = "";
				value.replyCaptureUntil = "";
				value.watchStartedAt = nowIso;
				value.watchWarTarget = clampWarFollowupNumber_(request.watchWarTarget, 1, 8, 2, true);
				value.dismissedSignalIds = dismissibleSignalIds;
				value.assignedModeratorId = "";
				value.assignedModeratorName = "";
				value.assignmentCoverageOverride = false;
				value.handledBy = "";
				value.assignedAt = "";
				value.assignmentUpdatedAt = nowIso;
				value.closedAt = "";
				appendWarFollowupActivity_(
					value,
					"watching",
					"Monitoring the next " + value.watchWarTarget + " regular war" + (value.watchWarTarget === 1 ? ". Active ownership released." : "s. Active ownership released."),
					actor,
					nowIso,
				);
				break;
			case "watch_triggered":
				if (value.status !== "watching") throw new Error("This account is no longer being monitored.");
				value.status = "needs_review";
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
				appendWarFollowupActivity_(value, "watch_triggered", "Monitoring found new problematic war evidence and reopened the case.", actor || "War Follow Up", nowIso);
				if (request.assignedModeratorId) applyWarFollowupOwner_(value, request, actor || "War Follow Up", nowIso);
				break;
			case "watch_complete":
				if (value.status !== "watching") throw new Error("This account is no longer being monitored.");
				value.status = "dismissed";
				value.outcome = "no_action";
				value.dismissedSignalIds = dismissibleSignalIds;
				value.closedAt = nowIso;
				appendWarFollowupActivity_(value, "watch_complete", "Monitoring completed without new problematic evidence.", actor || "War Follow Up", nowIso);
				break;
			case "wait": {
				const followupHours = Number(request.followupHours);
				if ([24, 48, 72].indexOf(followupHours) < 0) {
					throw new Error("Waiting follow-up must be 24, 48, or 72 hours.");
				}
				value.status = "waiting";
				value.waitingUntil = new Date(parseIsoToMs_(nowIso) + followupHours * 60 * 60 * 1000).toISOString();
				value.waitingReason = sanitizeWarFollowupMultilineText_(request.waitingReason, 1000);
				value.closedAt = "";
				appendWarFollowupActivity_(
					value,
					"waiting",
					"Paused with a " + followupHours + "h follow-up." +
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
				value.contactAutomaticReminderAllowed = request.suppressAutomaticReminder !== true;
				value.contactStage = "";
				value.contactReminderText = "";
				value.contactReminderSentAt = "";
				value.contactReminderMessageId = "";
				value.contactNoResponseAt = "";
				value.contactReminderFailedAt = "";
				value.contactReminderFailureReason = "";
				value.dmText = sanitizeWarFollowupMultilineText_(request.dmText, 6000);
				if (!value.dmText) throw new Error("The contact message is empty.");
				value.dmSentAt = "";
				value.dmDeliveryMode = "";
				value.dmMessageId = "";
				value.dmSentByDiscordId = "";
				value.dmSentByName = "";
				value.dmQueueId = "";
				value.dmQueuedAt = "";
				value.dmQueuedByDiscordId = "";
				value.dmQueuedByName = "";
				value.dmDeliveryFailedAt = "";
				value.dmDeliveryFailureReason = "";
				value.replyCaptureUntil = "";
				value.playerResponse = "";
				value.playerResponseAt = "";
				value.playerResponseMessageId = "";
				value.closedAt = "";
				appendWarFollowupActivity_(value, "contact_prepared", "Player contact message prepared.", actor, nowIso);
				break;
			case "queue_dm": {
				const queueId = sanitizeWarFollowupText_(request.dmQueueId || request.mutationId, 160);
				if (!queueId) throw new Error("A Discord DM queue ID is required.");
				if (!value.discordId) throw new Error("This player has no linked Discord account.");
				value.dmText = sanitizeWarFollowupMultilineText_(request.dmText != null ? request.dmText : value.dmText, 6000);
				if (!value.dmText) throw new Error("The queued Discord message is empty.");
				value.dmQueueId = queueId;
				value.dmQueuedAt = nowIso;
				value.dmQueuedByDiscordId = /^\d{17,20}$/.test(String(request.dmQueuedByDiscordId || "").trim())
					? String(request.dmQueuedByDiscordId).trim()
					: "";
				value.dmQueuedByName = sanitizeWarFollowupText_(request.dmQueuedByName || actor, 80);
				value.dmDeliveryFailedAt = "";
				value.dmDeliveryFailureReason = "";
				appendWarFollowupActivity_(value, "dm_queued", "Queued for delivery by the Discord bot.", actor, nowIso);
				break;
			}
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
				value.contactStage = "";
				value.recoveryWarTarget = clampWarFollowupNumber_(request.recoveryWarTarget, 1, 8, 3, true);
				value.requireNoMisses = request.requireNoMisses == null ? true : toBooleanFlag_(request.requireNoMisses);
				value.dmSentAt = "";
				value.dmDeliveryMode = "";
				value.dmMessageId = "";
				value.dmSentByDiscordId = "";
				value.dmSentByName = "";
				value.dmQueueId = "";
				value.dmQueuedAt = "";
				value.dmQueuedByDiscordId = "";
				value.dmQueuedByName = "";
				value.dmDeliveryFailedAt = "";
				value.dmDeliveryFailureReason = "";
				value.replyCaptureUntil = "";
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
				if (value.dmQueueId && sanitizeWarFollowupText_(request.dmQueueId, 160) !== value.dmQueueId) {
					throw new Error("This message is already queued for Discord delivery.");
				}
				value.dmText = sanitizeWarFollowupMultilineText_(request.dmText != null ? request.dmText : value.dmText, 6000);
				if (!value.dmText) throw new Error("The DM message is empty.");
				value.dmSentAt = nowIso;
				value.dmDeliveryMode = sanitizeWarFollowupText_(request.dmDeliveryMode, 20).toLowerCase() === "bot" ? "bot" : "manual";
				value.dmMessageId = value.dmDeliveryMode === "bot" && /^\d{17,20}$/.test(String(request.dmMessageId || "").trim()) ? String(request.dmMessageId).trim() : "";
				if (value.dmDeliveryMode === "bot" && !value.dmMessageId) throw new Error("The delivered bot DM message ID is required.");
				value.dmSentByDiscordId = /^\d{17,20}$/.test(String(request.dmSentByDiscordId || "").trim()) ? String(request.dmSentByDiscordId).trim() : "";
				value.dmSentByName = sanitizeWarFollowupText_(request.dmSentByName || actor, 80);
				value.dmQueueId = "";
				value.dmQueuedAt = "";
				value.dmQueuedByDiscordId = "";
				value.dmQueuedByName = "";
				value.dmDeliveryFailedAt = "";
				value.dmDeliveryFailureReason = "";
				if (value.contactPurpose === "general") {
					value.status = "waiting";
					value.contactStage = value.contactAutomaticReminderAllowed ? "awaiting_first_response" : "awaiting_final_response";
					value.waitingUntil = new Date(parseIsoToMs_(nowIso) + 24 * 60 * 60 * 1000).toISOString();
					value.waitingReason = "Awaiting the player's response.";
					value.replyCaptureUntil = value.dmDeliveryMode === "bot"
						? new Date(parseIsoToMs_(nowIso) + 72 * 60 * 60 * 1000).toISOString()
						: "";
				} else if (value.contactPurpose === "removal") {
					value.status = "removal_pending";
					value.replyCaptureUntil = "";
				} else {
					value.status = "hero_down";
					value.recoveryStartedAt = nowIso;
					value.replyCaptureUntil = "";
				}
				appendWarFollowupConversation_(value, {
					id: "staff:" + (value.dmMessageId || nowIso),
					direction: "staff",
					at: nowIso,
					actor: value.dmSentByName || actor || "Staff",
					text: value.dmText,
					messageId: value.dmMessageId,
					deliveryMode: value.dmDeliveryMode,
				});
				appendWarFollowupActivity_(
					value,
					"dm_sent",
					value.contactPurpose === "removal" ? "Removal notice marked as sent." : "Decision DM marked as sent.",
					actor,
					nowIso,
				);
				break;
			case "dm_delivery_failed":
				if (value.status !== "needs_dm") throw new Error("This follow-up is no longer waiting for Discord delivery.");
				if (value.dmQueueId && sanitizeWarFollowupText_(request.dmQueueId, 160) !== value.dmQueueId) {
					throw new Error("This Discord delivery request changed before the failure was recorded.");
				}
				value.dmQueueId = "";
				value.dmQueuedAt = "";
				value.dmQueuedByDiscordId = "";
				value.dmQueuedByName = "";
				value.dmDeliveryFailedAt = nowIso;
				value.dmDeliveryFailureReason = sanitizeWarFollowupText_(request.dmDeliveryFailureReason, 300) || "Discord could not deliver the message.";
				appendWarFollowupActivity_(value, "dm_delivery_failed", "Discord bot delivery failed. The message still needs attention.", actor || "War Follow Up", nowIso);
				break;
			case "contact_reminder_sent": {
				if (value.contactReminderSentAt) throw new Error("The automatic contact reminder was already sent.");
				const reminderMessageId = String(request.contactReminderMessageId || "").trim();
				if (!/^\d{17,20}$/.test(reminderMessageId)) throw new Error("The delivered reminder message ID is required.");
				const reminderText = sanitizeWarFollowupMultilineText_(request.contactReminderText, 2000);
				if (!reminderText) throw new Error("The automatic reminder message is empty.");
				value.contactStage = "awaiting_after_reminder";
				value.contactReminderText = reminderText;
				value.contactReminderSentAt = nowIso;
				value.contactReminderMessageId = reminderMessageId;
				value.waitingUntil = new Date(parseIsoToMs_(nowIso) + 24 * 60 * 60 * 1000).toISOString();
				value.waitingReason = "Awaiting the player's response after one automatic reminder.";
				value.replyCaptureUntil = new Date(parseIsoToMs_(nowIso) + 72 * 60 * 60 * 1000).toISOString();
				appendWarFollowupConversation_(value, {
					id: "staff:" + reminderMessageId,
					direction: "staff",
					at: nowIso,
					actor: "War Follow Up",
					text: reminderText,
					messageId: reminderMessageId,
					deliveryMode: "bot",
				});
				appendWarFollowupActivity_(value, "contact_reminder_sent", "One automatic response reminder was sent. No further automatic messages will be sent.", actor || "War Follow Up", nowIso);
				break;
			}
			case "contact_reminder_failed":
				if (value.contactReminderSentAt) throw new Error("The automatic contact reminder was already sent.");
				value.status = "needs_review";
				value.contactStage = "reminder_failed";
				value.contactReminderFailedAt = nowIso;
				value.contactReminderFailureReason = sanitizeWarFollowupText_(request.contactReminderFailureReason, 300) || "Discord could not deliver the automatic reminder.";
				value.waitingUntil = "";
				value.waitingReason = "";
				appendWarFollowupActivity_(value, "contact_reminder_failed", "Automatic reminder delivery failed. A moderator must decide what to do next.", actor || "War Follow Up", nowIso);
				break;
			case "contact_no_response":
				if (value.contactAutomaticReminderAllowed !== false && !value.contactReminderSentAt) throw new Error("The automatic reminder has not been sent yet.");
				value.status = "needs_review";
				value.contactStage = "no_response";
				value.contactNoResponseAt = nowIso;
				value.waitingUntil = "";
				value.waitingReason = "";
				appendWarFollowupActivity_(
					value,
					"contact_no_response",
					value.contactAutomaticReminderAllowed === false
						? "No player response was received after the moderator-approved final message."
						: "No player response was received after the initial contact and one automatic reminder.",
					actor || "War Follow Up",
					nowIso,
				);
				break;
			case "player_response": {
				const responseText = sanitizeWarFollowupMultilineText_(request.responseText, 2000);
				if (!responseText) throw new Error("The player response is empty.");
				value.status = "needs_review";
				value.outcome = "";
				value.closedAt = "";
				value.contactStage = "responded";
				value.playerResponse = responseText;
				value.playerResponseAt = nowIso;
				value.playerResponseMessageId = sanitizeWarFollowupText_(request.responseMessageId, 120);
				value.waitingUntil = "";
				value.waitingReason = "";
				appendWarFollowupConversation_(value, {
					id: "player:" + (value.playerResponseMessageId || nowIso),
					direction: "player",
					at: nowIso,
					actor: "Player",
					text: responseText,
					messageId: value.playerResponseMessageId,
					deliveryMode: "manual",
				});
				appendWarFollowupActivity_(value, "player_response", "Player response received and added to the private conversation.", "Player DM", nowIso);
				break;
			}
			case "remove":
				value.status = "needs_dm";
				value.outcome = "";
				value.contactPurpose = "removal";
				value.contactStage = "";
				value.removalReason = sanitizeWarFollowupMultilineText_(request.removalReason, 1000);
				if (!value.removalReason) throw new Error("A removal reason is required.");
				value.dmText = sanitizeWarFollowupMultilineText_(request.dmText, 6000);
				if (!value.dmText) throw new Error("The removal message is empty.");
				value.evidence = sanitizeWarFollowupEvidenceSnapshot_(request.evidence || value.evidence);
				value.removalStartedAt = nowIso;
				value.removalActionedAt = "";
				value.removalAbsentObservedAt = "";
				value.removalRejoinedAt = "";
				value.rejoinRosterId = "";
				value.rejoinRosterTitle = "";
				value.rejoinClanTag = "";
				value.dmSentAt = "";
				value.dmDeliveryMode = "";
				value.dmMessageId = "";
				value.dmSentByDiscordId = "";
				value.dmSentByName = "";
				value.dmQueueId = "";
				value.dmQueuedAt = "";
				value.dmQueuedByDiscordId = "";
				value.dmQueuedByName = "";
				value.dmDeliveryFailedAt = "";
				value.dmDeliveryFailureReason = "";
				value.replyCaptureUntil = "";
				value.closedAt = "";
				appendWarFollowupActivity_(value, "removal_decision", "Removal from the community selected. Reason: " + value.removalReason, actor, nowIso);
				break;
			case "removal_no_dm":
				if (value.status !== "needs_dm" || value.contactPurpose !== "removal") throw new Error("This case is not waiting on a removal notice.");
				value.status = "removal_pending";
				value.dmSentAt = "";
				value.dmDeliveryMode = "";
				value.dmMessageId = "";
				value.dmSentByDiscordId = "";
				value.dmSentByName = "";
				value.replyCaptureUntil = "";
				appendWarFollowupActivity_(value, "removal_no_dm", "Removal continued without a Discord DM.", actor, nowIso);
				break;
			case "removal_actioned":
				if (value.status !== "removal_pending") throw new Error("This removal is no longer awaiting in-game action.");
				value.removalActionedAt = nowIso;
				appendWarFollowupActivity_(value, "removal_actioned", "Moderator recorded the in-game removal. Waiting for roster confirmation.", actor, nowIso);
				break;
			case "removal_confirmed":
				if (["removal_pending", "removed"].indexOf(value.status) < 0) throw new Error("This case is not awaiting removal confirmation.");
				value.status = "removed";
				value.outcome = "removed";
				value.removalAbsentObservedAt = nowIso;
				value.closedAt = nowIso;
				appendWarFollowupActivity_(value, "removal_confirmed", "Roster data confirmed that the player left the connected clans. Rejoin monitoring is active.", actor || "War Follow Up", nowIso);
				break;
			case "removal_rejoined":
				if (value.status !== "removed" || !value.removalAbsentObservedAt) throw new Error("This removal is not eligible for rejoin detection.");
				value.status = "removal_evasion";
				value.outcome = "";
				value.removalRejoinedAt = nowIso;
				value.removalRejoinCount = Math.min(1000, toNonNegativeInt_(value.removalRejoinCount) + 1);
				value.rejoinRosterId = sanitizeWarFollowupText_(request.rejoinRosterId, 120);
				value.rejoinRosterTitle = sanitizeWarFollowupText_(request.rejoinRosterTitle, 160);
				value.rejoinClanTag = normalizeTag_(request.rejoinClanTag);
				value.openedAt = nowIso;
				value.closedAt = "";
				appendWarFollowupActivity_(value, "removal_rejoined", "Removed player detected in " + (value.rejoinRosterTitle || value.rejoinClanTag || "a connected clan") + ".", actor || "War Follow Up", nowIso);
				break;
			case "cancel_removal":
				if (["needs_dm", "removal_pending"].indexOf(value.status) < 0 || value.contactPurpose !== "removal") throw new Error("This removal is no longer active.");
				value.status = "closed";
				value.outcome = "removal_cancelled";
				value.removalAbsentObservedAt = "";
				value.closedAt = nowIso;
				appendWarFollowupActivity_(value, "removal_cancelled", "Removal decision cancelled. Rejoin monitoring is off.", actor, nowIso);
				break;
			case "approve_rejoin":
				if (["removed", "removal_evasion"].indexOf(value.status) < 0) throw new Error("This account is not under rejoin monitoring.");
				value.status = "closed";
				value.outcome = "rejoin_approved";
				value.removalAbsentObservedAt = "";
				value.closedAt = nowIso;
				value.dismissedSignalIds = dismissibleSignalIds;
				appendWarFollowupActivity_(value, "rejoin_approved", "Leadership approved the player's return. Removal monitoring is off.", actor, nowIso);
				break;
			case "approve_return":
				value.status = "closed";
				value.outcome = "approved_return";
				value.closedAt = nowIso;
				value.dismissedSignalIds = dismissibleSignalIds;
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
				value.dmDeliveryMode = "";
				value.dmMessageId = "";
				value.dmSentByDiscordId = "";
				value.dmSentByName = "";
				value.dmQueueId = "";
				value.dmQueuedAt = "";
				value.dmQueuedByDiscordId = "";
				value.dmQueuedByName = "";
				value.dmDeliveryFailedAt = "";
				value.dmDeliveryFailureReason = "";
				value.replyCaptureUntil = "";
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
				value.dismissedSignalIds = dismissibleSignalIds;
				appendWarFollowupActivity_(
					value,
					"closed",
					value.outcome === "no_return" ? "Closed without return to regular wars." : "Follow-up closed.",
					actor,
					nowIso,
				);
				break;
			case "resolve":
				if (["removal_pending", "removal_evasion", "removed"].indexOf(value.status) >= 0) throw new Error("Complete or cancel the removal workflow instead of closing it as a normal case.");
				value.status = "closed";
				value.outcome = "resolved";
				if (!(value.contactPurpose === "general" && parseIsoToMs_(value.replyCaptureUntil) > parseIsoToMs_(nowIso))) {
					value.replyCaptureUntil = "";
				}
				value.resolutionNote = sanitizeWarFollowupMultilineText_(request.resolutionNote, 2000) || "Resolved by a moderator.";
				value.closedAt = nowIso;
				value.waitingUntil = "";
				value.dismissedSignalIds = dismissibleSignalIds;
				appendWarFollowupActivity_(value, "resolved", "Case closed: " + value.resolutionNote, actor, nowIso);
				break;
			case "reopen":
				value.status = "needs_review";
				value.outcome = "";
				value.dmQueueId = "";
				value.dmQueuedAt = "";
				value.dmQueuedByDiscordId = "";
				value.dmQueuedByName = "";
				value.dmDeliveryFailedAt = "";
				value.dmDeliveryFailureReason = "";
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
				value.assignmentCoverageOverride = false;
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
				if (!(value.contactPurpose === "removal" && ["needs_dm", "removal_pending", "removal_evasion", "removed"].indexOf(value.status) >= 0)) {
					value.status = "needs_review";
				}
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
