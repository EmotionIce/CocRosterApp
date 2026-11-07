// A league roster spans the whole CWL season, while each round has its own
// preparation/battle state. A player may play regular wars in a different clan.
// https://support.supercell.com/clash-of-clans/en/articles/about-cwl-3.html
// https://support.supercell.com/clash-of-clans/en/articles/cwl-week-of-wars.html
function classifyWarFollowupLeague_(clanTag, group, error) {
	if (error && Number(error.statusCode) === 404) return "absent";
	if (error || !group) return "unknown";
	const mapped = mapLeagueGroupDataForClan_(clanTag, group);
	if (mapped.isMalformed || !mapped.clanFound || !mapped.season || !group.rounds.length) return "unknown";
	if (isActiveWarState_(mapped.state)) return "active";
	if (mapped.state !== "ended" && mapped.state !== "warended") return "unknown";
	const complete = group.rounds.every(function (round) {
		return round && Array.isArray(round.warTags) && round.warTags.length &&
			round.warTags.every(isValidPlayerTag_);
	});
	return complete ? "ended" : "unknown";
}

function classifyWarFollowupRegularWar_(tag, clanTag, war, error, lineupPause) {
	if (error || !war) return "unknown";
	const state = normalizeWarState_(war.state);
	if (state === "notinwar") return "clear";
	if (state !== "warended" && !isActiveWarState_(state)) return "unknown";
	const snapshot = buildAttackReminderWarSnapshot_(war, clanTag, "regular", "", war._warObservedAt);
	if (!snapshot) return "unknown";
	if (state === "warended") {
		return parseIsoToMs_(snapshot.endTime) <= parseIsoToMs_(snapshot.observedAt) ? "clear" : "unknown";
	}
	return lineupPause || Object.prototype.hasOwnProperty.call(snapshot.byTag, tag) ? "active" : "clear";
}

function getVerifiedWarFollowupResults_(rosters, tag, clan, after) {
	const observations = {};
	for (const roster of rosters) {
		if (normalizeTag_(roster.connectedClanTag) !== clan) continue;
		const history = roster.warPerformance && roster.warPerformance.regularWarHistoryByKey || {};
		for (const key of Object.keys(history)) {
			const war = history[key];
			const timing = sanitizeRegularWarModerationTiming_(war && war.moderationTiming);
			const stats = war && war.statsByTag && war.statsByTag[tag];
			if (!war || !war.authoritative || war.incomplete || !timing || !stats ||
				parseIsoToMs_(timing.preparationStartTime) <= after || parseIsoToMs_(timing.endTime) > Date.now()) continue;
			const possible = Number(stats.possibleAttacks);
			const used = Number(stats.usedAttacks);
			if (!Number.isInteger(possible) || possible < 1 || possible > 4 || !Number.isInteger(used) ||
				used < 0 || used > possible || stats.missedAttacks !== possible - used) continue;
			const id = war.warKey || key;
			const observation = { end: timing.endTime, missed: used < possible };
			if (observations[id] && (observations[id].end !== observation.end || observations[id].missed !== observation.missed)) return [];
			observations[id] = observation;
		}
	}
	return Object.keys(observations).map(function (id) {
		return Object.assign({ id: id }, observations[id]);
	}).sort(function (a, b) { return a.end.localeCompare(b.end) || a.id.localeCompare(b.id); });
}

function hasWarFollowupLineupEvidence_(rosters, tag, clan, evidence) {
	const results = getVerifiedWarFollowupResults_(rosters, tag, clan, parseIsoToMs_(evidence.after));
	const latest = results[results.length - 1];
	const misses = results.slice(0, 3).filter(function (result) { return result.missed; }).map(function (result) { return result.id; });
	return !!latest && latest.missed && misses.length >= 2 && evidence.warIds.every(function (id) { return misses.indexOf(id) >= 0; });
}

function inspectWarFollowupGameSafety_(tag, sourceClan, targetClan, lineupPause, evidence) {
	try {
		const snapshot = readActiveRosterLayoutSnapshot_();
		const rosters = snapshot.rosterData && snapshot.rosterData.rosters;
		if (!Array.isArray(rosters) || !rosters.length) return { safe: false, reason: "Family roster data is unavailable." };
		const refreshedAt = parseIsoToMs_(snapshot.rosterData.lastUpdatedAt);
		if (lineupPause && (!refreshedAt || Date.now() - refreshedAt > 6 * 60 * 60 * 1000)) {
			return { safe: false, reason: "The verified war history is waiting for a fresh roster snapshot." };
		}
		if (lineupPause && (!evidence || !hasWarFollowupLineupEvidence_(rosters, tag, sourceClan, evidence))) {
			return { safe: false, reason: "The qualifying post-contact misses could not be confirmed." };
		}
		if (rosters.some(isCwlPreparationActive_)) return { safe: false, reason: "Family CWL preparation is active." };

		const signups = readActiveCwlLeagueSignups_();
		const signup = signups.preferencesByTag && signups.preferencesByTag[tag];
		if (signups.signupId && signup) return { safe: false, reason: "This player has a pending family CWL sign-up." };
		const nowIso = new Date().toISOString();
		const currentEvents = listCurrentCwlSeasonEvents_().filter(function (event) {
			return !getCwlSeasonEventRolloverReason_(event, nowIso);
		});
		if (currentEvents.some(function (event) {
			const startMs = parseIsoToMs_(event.startsAt);
			return event.cwlTrackingState !== "waiting" ||
				(startMs > 0 && parseIsoToMs_(nowIso) >= startMs - 2 * 24 * 60 * 60 * 1000);
		})) return { safe: false, reason: "The family CWL sign-up, season, or final verification is in progress." };

		const currentClan = readWarFollowupPlayerClan_(tag);
		if (lineupPause && currentClan !== sourceClan) return { safe: false, reason: "The player is no longer in the clan for this lineup task." };

		const relevantClans = Array.from(new Set([sourceClan, targetClan, currentClan].filter(Boolean)));
		const familyClans = Array.from(new Set(relevantClans.concat(rosters.map(function (roster) {
			return normalizeTag_(roster.connectedClanTag);
		}).filter(Boolean))));
		if (!relevantClans.length || familyClans.length > 16 || !familyClans.every(isValidClanTag_)) {
			return { safe: false, reason: "The relevant clan list could not be verified." };
		}
		const league = prefetchLeagueGroupRawByClanTag_(familyClans);
		const leagueStates = familyClans.map(function (clan) {
			return classifyWarFollowupLeague_(clan, league.rawByClanTag[clan], league.errorByClanTag[clan]);
		});
		if (leagueStates.indexOf("active") >= 0) return { safe: false, reason: "A relevant or family CWL league group is active." };
		if (leagueStates.indexOf("unknown") >= 0) return { safe: false, reason: "CWL season status could not be verified." };
		// The league-group endpoint can be absent before matchmaking. Keep a
		// conservative early-month buffer as well as the actual family schedule.
		if (Number(nowIso.slice(8, 10)) <= 3 && leagueStates.indexOf("absent") >= 0) {
			return { safe: false, reason: "CWL sign-up may be open before the first league group appears." };
		}
		const regular = cocFetchAllByPathEntries_(relevantClans.map(function (clan) {
			return { key: clan, path: "/clans/" + encodeTagForPath_(clan) + "/currentwar" };
		}));
		const warStates = relevantClans.map(function (clan) {
			return classifyWarFollowupRegularWar_(tag, clan, regular.dataByKey[clan], regular.errorByKey[clan], lineupPause);
		});
		if (warStates.indexOf("active") >= 0) return { safe: false, reason: "A relevant regular war is in preparation or battle." };
		if (warStates.indexOf("unknown") >= 0) return { safe: false, reason: "Regular war timing or the lineup could not be verified." };
		return { safe: true, reason: "", currentClanTag: currentClan };
	} catch (error) {
		return { safe: false, reason: "Live war or family sign-up data could not be verified." };
	}
}

function isWarFollowupLeagueFinished_(clanTag, season) {
	try {
		const league = prefetchLeagueGroupRawByClanTag_([clanTag]);
		const group = league.rawByClanTag[clanTag];
		const state = classifyWarFollowupLeague_(clanTag, group, league.errorByClanTag[clanTag]);
		if (state === "ended" && String(group.season).slice(0, 7) === season.slice(0, 7)) return true;
		// A previously verified season may no longer have a live league group.
		if (state !== "absent" && state !== "ended") return false;
		const layout = readActiveRosterLayoutSnapshot_().rosterData;
		const rosters = layout.rosters.filter(function (roster) { return normalizeTag_(roster.connectedClanTag) === clanTag; });
		return rosters.some(function (roster) {
			const pointer = readSeasonEventPointer_(buildLatestCompletedCwlSeasonEventRosterPointerPath_(roster.id));
			const event = pointer && pointer.eventId && readSeasonEventById_(pointer.eventId);
			const target = getResolvedCwlSeasonEventTarget_(event);
			return event && event.cwlTrackingState === "completed" && target && target.season.slice(0, 7) === season.slice(0, 7) &&
				normalizeTag_(target.clanTag) === clanTag && isGenuinelyCompletedCwlGroup_(event, target, target.groupState);
		});
	} catch (error) {
		return false;
	}
}

function assertWarFollowupGameSafety_(tag, sourceClan, targetClan, lineupPause) {
	const result = inspectWarFollowupGameSafety_(tag, sourceClan, targetClan, lineupPause);
	if (!result.safe) throw new Error("In-game action on hold. " + result.reason);
	return result;
}

function assertWarFollowupMoveSafety_(value) {
	return assertWarFollowupGameSafety_(value.tag, value.sourceClanTag, value.targetClanTag, false);
}

function readWarFollowupPlayerClan_(tag) {
	const result = cocFetchAllByPathEntries_([{ key: "player", path: "/players/" + encodeTagForPath_(tag) }]);
	const player = result.dataByKey.player;
	if (!player || normalizeTag_(player.tag) !== tag || (player.clan && !isValidClanTag_(player.clan.tag))) {
		throw new Error("Current clan membership could not be verified.");
	}
	return normalizeTag_(player.clan && player.clan.tag);
}

function verifyWarFollowupRemovalMembership_(value, rejoinClan) {
	const snapshot = readActiveRosterLayoutSnapshot_();
	const rosters = snapshot.rosterData && snapshot.rosterData.rosters;
	if (!Array.isArray(rosters) || !rosters.length) throw new Error("Family clan membership could not be verified.");
	const current = readWarFollowupPlayerClan_(value.tag);
	const connected = rosters.some(function (roster) { return current && normalizeTag_(roster.connectedClanTag) === current; });
	if (rejoinClan ? !connected || current !== rejoinClan : connected) {
		throw new Error("Live clan membership does not confirm this observation.");
	}
}

function assertWarFollowupRecoveryReady_(value, currentClan) {
	const arrived = parseIsoToMs_(value.recoveryArrivedAt);
	if (!arrived || currentClan !== value.targetClanTag) throw new Error("Verify arrival in the agreed recovery clan first.");
	const rosters = readActiveRosterLayoutSnapshot_().rosterData.rosters;
	const results = getVerifiedWarFollowupResults_(rosters, value.tag, value.targetClanTag, arrived);
	const recent = results.slice(-value.recoveryWarTarget);
	if (recent.length < value.recoveryWarTarget || recent.some(function (result) { return result.missed; })) {
		throw new Error("The agreed number of clean wars after arrival could not be verified.");
	}
}

function checkWarFollowupGameAction(tag, updatedAt, credential) {
	assertWarFollowupAccess_(credential);
	const value = readWarFollowupCase_(tag);
	if (!value || value.updatedAt !== updatedAt || ["removal_pending", "hero_down"].indexOf(value.status) < 0) {
		throw new Error("Reopen the current in-game case before checking timing.");
	}
	const safety = inspectWarFollowupGameSafety_(value.tag, value.sourceClanTag, value.targetClanTag, false);
	if (safety.safe && value.status === "removal_pending" && safety.currentClanTag !== value.sourceClanTag) {
		return { safe: false, reason: "The account is no longer in the clan recorded for this removal." };
	}
	return safety;
}
