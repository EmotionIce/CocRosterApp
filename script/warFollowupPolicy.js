const WAR_FOLLOWUP_DAY_MS = 24 * 60 * 60 * 1000;

function sanitizeWarFollowupPolicy_(raw) {
	if (!raw || typeof raw !== "object") return null;
	const task = raw.task && typeof raw.task === "object" ? raw.task : {};
	const taskState = ["held", "ready", "claimed", "completed"].indexOf(task.state) >= 0 ? task.state : "";
	return {
		guildId: /^\d{17,20}$/.test(String(raw.guildId || "")) ? String(raw.guildId) : "",
		discordId: /^\d{17,20}$/.test(String(raw.discordId || "")) ? String(raw.discordId) : "",
		checkedInAt: sanitizeWarFollowupTimestamp_(raw.checkedInAt),
		followedUpAt: sanitizeWarFollowupTimestamp_(raw.followedUpAt),
		leagueCheckedAt: sanitizeWarFollowupTimestamp_(raw.leagueCheckedAt),
		upcomingWarTag: isValidPlayerTag_(raw.upcomingWarTag) ? normalizeTag_(raw.upcomingWarTag) : "",
		excusedUntil: sanitizeWarFollowupTimestamp_(raw.excusedUntil),
		season: /^\d{4}-\d{2}(-\d{2})?$/.test(String(raw.season || "")) ? String(raw.season) : "",
		warIds: sanitizeWarFollowupStringList_(raw.warIds, { maxItems: 12, maxLength: 160 }),
		observedWars: clampWarFollowupNumber_(raw.observedWars, 0, 12, 0, true),
		cleanWars: clampWarFollowupNumber_(raw.cleanWars, 0, 12, 0, true),
		seasonDigest: sanitizeWarFollowupText_(raw.seasonDigest, 240),
		replyMode: ["close", "watch", "excuse"].indexOf(raw.replyMode) >= 0 ? raw.replyMode : "",
		task: taskState ? {
			state: taskState,
			reason: sanitizeWarFollowupText_(task.reason, 300),
			checkedAt: sanitizeWarFollowupTimestamp_(task.checkedAt),
			expiresAt: sanitizeWarFollowupTimestamp_(task.expiresAt),
			claimedAt: sanitizeWarFollowupTimestamp_(task.claimedAt),
			claimedBy: sanitizeWarFollowupText_(task.claimedBy, 80),
			warIds: sanitizeWarFollowupStringList_(task.warIds, { maxItems: 3, maxLength: 160 }),
		} : null,
	};
}

function isWarFollowupAutomaticContact_(value) {
	return value.contactPurpose === "automated_checkin" || value.contactPurpose === "automated_warning";
}

function clearWarFollowupDmQueue_(value) {
	value.dmQueueId = "";
	value.dmQueuedAt = "";
	value.dmQueuedByName = "";
	value.dmQueuedByDiscordId = "";
}

function closeWarFollowupPolicy_(value, nowIso) {
	value.status = "closed";
	value.outcome = "no_action";
	value.closedAt = nowIso;
	value.automationStage = "closed";
	if (value.policy.task && value.policy.task.state !== "completed") value.policy.task = null;
	clearWarFollowupDmQueue_(value);
	if (value.automationDmMessageIds.length || value.dmMessageId) {
		value.replyCaptureUntil = new Date(parseIsoToMs_(nowIso) + 14 * WAR_FOLLOWUP_DAY_MS).toISOString();
	}
}

function warFollowupOutreachAllows_(value, settings, lineupPause) {
	const allowedClan = settings.moderationOutreachMode === "all"
		? !!settings.defaultHeroDownRosterId
		: settings.moderationPilotClanTag === value.sourceClanTag;
	return !!value.sourceClanTag && allowedClan &&
		(!settings.defaultHeroDownRosterId || value.sourceRosterId !== settings.defaultHeroDownRosterId) &&
		settings.trustedPlayerTags.indexOf(value.tag) < 0 &&
		(!lineupPause || settings.moderationLineupPauses === true);
}

function isCwlWarFollowupCategory_(category) {
	return category === "cwl_missed" || category === "cwl_performance";
}

function warFollowupCheckinHasEnoughWars_(category, warIds, settings) {
	const count = warIds.length;
	if (category === "cwl_missed") return count >= Math.max(2, settings.cwlMissedThreshold);
	if (category === "cwl_performance") return settings.cwlPerformanceEnabled && count >= Math.max(4, settings.cwlMinimumAttacks);
	if (category === "regular_performance") return settings.regularPerformanceEnabled && count >= 6;
	return category === "regular_missed" && count >= 2;
}

function queueWarFollowupPolicyDm_(value, request, nowIso, purpose) {
	const queueId = sanitizeWarFollowupText_(request.mutationId, 120);
	const dmText = sanitizeWarFollowupMultilineText_(request.dmText, 1800);
	if (!queueId || !dmText || !value.policy.discordId || value.policy.discordId !== value.discordId) {
		throw new Error("Automatic contact requires a linked account and a queued message.");
	}
	value.status = "needs_dm";
	value.contactPurpose = purpose;
	value.dmText = dmText;
	value.dmQueueId = queueId;
	value.dmQueuedAt = nowIso;
	value.dmQueuedByName = "War Follow Up";
	value.dmQueuedByDiscordId = "";
	value.dmDeliveryFailedAt = "";
	value.dmDeliveryFailureReason = "";
}

function isUntouchedWarFollowupAutomation_(value) {
	return !value.playerResponseAt && (!value.handledBy || value.assignedModeratorId) &&
		["watching", "needs_dm", "needs_review"].indexOf(value.status) >= 0 &&
		value.activity.some(function (entry) { return entry.type === "automatic_case"; }) &&
		value.activity.every(function (entry) {
			if (entry.type === "assigned" || entry.type === "unassigned") return entry.actor === "War Follow Up";
			return ["automatic_case", "automation_checkin", "automation_warning", "automation_review",
				"dm_sent", "dm_delivery_failed", "assigned", "unassigned"].indexOf(entry.type) >= 0;
		}) && (!value.contactPurpose || isWarFollowupAutomaticContact_(value));
}

function applyWarFollowupPolicyAction_(value, current, action, request, credentialKind, actor, nowIso) {
	const humanAction = ["policy_claim", "policy_complete", "policy_excuse"].indexOf(action) >= 0;
	if (!humanAction && credentialKind !== "discord") throw new Error("This decision is owned by the moderation scheduler.");
	const incoming = sanitizeWarFollowupPolicy_(request.policy);
	const nowMs = parseIsoToMs_(nowIso);
	const watching = value.automationVersion === 2 && value.policy &&
		(value.status === "watching" || (value.status === "needs_dm" && isWarFollowupAutomaticContact_(value)));

	if (action === "policy_start") {
		const adopting = current && isUntouchedWarFollowupAutomation_(value) && value.automationVersion !== 2;
		const quiet = current && watching && value.status === "watching" && value.automationStage === "checkin" &&
			value.policy.guildId === (incoming && incoming.guildId) && !value.policy.checkedInAt && !value.policy.task &&
			!value.dmDeliveryFailedAt && request.sendAutomaticDm === true;
		if (current && !adopting && !quiet && ["closed", "dismissed"].indexOf(value.status) < 0) throw new Error("This case is already open.");
		const category = request.automationCategory;
		if (!incoming || !incoming.guildId || (!isCwlWarFollowupCategory_(category) &&
			["regular_missed", "regular_performance"].indexOf(category) < 0)) {
			throw new Error("Automatic monitoring requires a category and guild.");
		}
		if (value.policy && parseIsoToMs_(value.policy.excusedUntil) > nowMs) throw new Error("This player has an active exception.");
		value.automationVersion = 2;
		value.automationCategory = category;
		value.automationStage = "checkin";
		value.automationStartedAt = nowIso;
		value.automationWindowStartAt = "";
		value.automationRecommendation = "";
		value.automationReason = sanitizeWarFollowupText_(request.automationReason, 500);
		value.status = "watching";
		value.outcome = "";
		value.openedAt = nowIso;
		value.closedAt = "";
		value.sourceRosterId = sanitizeWarFollowupText_(request.sourceRosterId, 120);
		value.sourceRosterTitle = sanitizeWarFollowupText_(request.sourceRosterTitle, 160);
		value.sourceClanTag = normalizeTag_(request.sourceClanTag);
		value.reasonCodes = [category];
		value.assignedModeratorId = "";
		value.assignedModeratorName = "";
		value.handledBy = "";
		value.assignmentCoverageOverride = false;
		value.assignedAt = "";
		value.assignmentUpdatedAt = "";
		value.evidence = sanitizeWarFollowupEvidenceSnapshot_(request.evidence);
		value.policy = sanitizeWarFollowupPolicy_({ guildId: incoming.guildId, discordId: incoming.discordId,
			season: incoming.season, warIds: incoming.warIds, upcomingWarTag: incoming.upcomingWarTag });
		clearWarFollowupDmQueue_(value);
		if (!adopting && request.sendAutomaticDm) {
			const settings = readWarFollowupSettings_();
			if (warFollowupOutreachAllows_(value, settings, false) &&
				warFollowupCheckinHasEnoughWars_(category, incoming.warIds, settings) &&
				parseIsoToMs_(request.evidenceAt) > parseIsoToMs_(settings.moderationPilotSince)) {
				queueWarFollowupPolicyDm_(value, request, nowIso, "automated_checkin");
			} else if (quiet) {
				throw new Error("This case no longer qualifies for automated outreach.");
			}
		}
		appendWarFollowupActivity_(value, "automation_checkin", value.automationReason || "Automatic monitoring started.", actor, nowIso);
		return;
	}

	if (action === "policy_excuse") {
		if (!current || ["removal_pending", "removed", "removal_evasion", "hero_down"].indexOf(value.status) >= 0) {
			throw new Error("Complete the active in-game workflow before recording a war exception.");
		}
		const reason = sanitizeWarFollowupText_(request.note, 300);
		if (!reason) throw new Error("Record the reason for the exception.");
		value.policy = value.policy || sanitizeWarFollowupPolicy_({});
		value.policy.excusedUntil = new Date(nowMs + clampWarFollowupNumber_(request.excuseDays, 1, 90, 30, true) * WAR_FOLLOWUP_DAY_MS).toISOString();
		if (value.status !== "needs_review" || value.contactStage !== "responded") closeWarFollowupPolicy_(value, nowIso);
		else value.policy.task = null;
		appendWarFollowupActivity_(value, "policy_excuse", reason, actor, nowIso);
		return;
	}

	if (!watching) throw new Error("This automatic observation is no longer active.");
	if (action === "policy_defer_delivery") {
		if (!value.policy.task || value.status !== "needs_dm" || value.contactPurpose !== "automated_warning" ||
			value.dmQueueId !== request.dmQueueId) throw new Error("The queued lineup follow-up changed.");
		clearWarFollowupDmQueue_(value);
		value.status = "watching";
		value.policy.task.state = "held";
		value.policy.task.reason = sanitizeWarFollowupText_(request.automationReason, 300);
		value.policy.task.checkedAt = nowIso;
		return;
	}
	if (action === "policy_progress") {
		if (!incoming) throw new Error("Observation progress is required.");
		value.policy.observedWars = incoming.observedWars;
		value.policy.cleanWars = incoming.cleanWars;
		value.automationReason = sanitizeWarFollowupText_(request.automationReason, 500);
		if (request.cancelTask && value.policy.task && value.policy.task.state !== "completed") {
			value.policy.task = null;
			if (value.status === "needs_dm" && value.contactPurpose === "automated_warning") {
				clearWarFollowupDmQueue_(value);
				value.status = "watching";
			}
		}
		if (request.closePolicy) {
			closeWarFollowupPolicy_(value, nowIso);
			appendWarFollowupActivity_(value, "automation_clear", value.automationReason || "Automatic observation ended.", actor, nowIso);
		}
		return;
	}

	if (action === "policy_cwl_digest") {
		if (!isCwlWarFollowupCategory_(value.automationCategory) || !incoming || incoming.warIds.length < 2 || !value.policy.season) {
			throw new Error("A CWL digest requires repeated verified misses in the same season.");
		}
		value.policy.leagueCheckedAt = nowIso;
		if (!isWarFollowupLeagueFinished_(value.sourceClanTag, value.policy.season)) return;
		value.policy.seasonDigest = "Missed attacks in " + incoming.warIds.length + " verified rounds in " + value.policy.season + ".";
		value.policy.warIds = incoming.warIds;
		value.automationReason = value.policy.seasonDigest;
		closeWarFollowupPolicy_(value, nowIso);
		appendWarFollowupActivity_(value, "automation_clear", value.automationReason, actor, nowIso);
		return;
	}

	const task = value.policy.task;
	if (action === "policy_complete") {
		if (!task || task.state !== "claimed" || actor !== task.claimedBy ||
			nowMs - parseIsoToMs_(task.claimedAt) >= 10 * 60 * 1000 || nowMs >= parseIsoToMs_(task.expiresAt)) {
			throw new Error("Recheck timing and claim the task before recording completion.");
		}
		task.state = "completed";
		value.automationReason = "A captain recorded the one-war lineup pause.";
		closeWarFollowupPolicy_(value, nowIso);
		appendWarFollowupActivity_(value, "policy_complete", value.automationReason, actor, nowIso);
		return;
	}

	if (action !== "policy_lineup" && action !== "policy_claim") throw new Error("Unknown moderation policy action.");
	const claim = action === "policy_claim";
	const warIds = claim && task ? task.warIds : incoming && incoming.warIds;
	const settings = readWarFollowupSettings_();
	if (value.status !== "watching" || value.automationCategory !== "regular_missed" || !value.policy.checkedInAt ||
		!warIds || warIds.length < 2 || !warFollowupOutreachAllows_(value, settings, true) ||
		parseIsoToMs_(value.automationStartedAt) < parseIsoToMs_(settings.moderationPilotSince) ||
		nowMs - parseIsoToMs_(value.automationStartedAt) >= 30 * WAR_FOLLOWUP_DAY_MS) {
		throw new Error("This case does not qualify for a regular-war lineup task.");
	}
	if (claim && (!task || ["ready", "claimed"].indexOf(task.state) < 0 || nowMs >= parseIsoToMs_(task.expiresAt) ||
		(task.state === "claimed" && nowMs - parseIsoToMs_(task.claimedAt) < 10 * 60 * 1000 && actor !== task.claimedBy))) {
		throw new Error("This lineup task is expired, held, or already claimed.");
	}
	const safety = inspectWarFollowupGameSafety_(value.tag, value.sourceClanTag, "", true, {
		warIds: warIds,
		after: value.policy.checkedInAt,
	});
	const followedUp = parseIsoToMs_(value.policy.followedUpAt);
	const ready = safety.safe && followedUp > 0 && nowMs - followedUp >= 2 * WAR_FOLLOWUP_DAY_MS;
	value.policy.task = {
		state: ready ? (claim ? "claimed" : "ready") : "held",
		reason: safety.safe ? (ready ? "" : "Waiting for the player's follow-up reply window.") : safety.reason,
		checkedAt: nowIso,
		warIds: warIds,
		expiresAt: task && task.expiresAt || (ready ? new Date(nowMs + 7 * WAR_FOLLOWUP_DAY_MS).toISOString() : ""),
		claimedAt: claim && ready ? nowIso : "",
		claimedBy: claim && ready ? actor : "",
	};
	if (safety.safe && !followedUp && !claim && !value.dmDeliveryFailedAt) {
		queueWarFollowupPolicyDm_(value, request, nowIso, "automated_warning");
	}
	if (claim && ready) appendWarFollowupActivity_(value, "policy_claim", "Live timing checked for one regular-war selection.", actor, nowIso);
}
