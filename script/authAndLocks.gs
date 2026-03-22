// Admin auth and active-roster lock helpers.

function parseActiveRosterJobLockState_(raw) {
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

function tryAcquireActiveRosterJobLock_(ownerRaw, waitMsRaw) {
	const owner = String(ownerRaw == null ? "unknown" : ownerRaw).trim() || "unknown";
	const waitMs = Math.max(0, Number(waitMsRaw) || 0);
	const deadlineMs = Date.now() + waitMs;
	const props = PropertiesService.getScriptProperties();
	const token = Utilities.getUuid();
	let acquired = false;

	while (!acquired) {
		const scriptLock = LockService.getScriptLock();
		const remainingMs = waitMs > 0 ? Math.max(250, deadlineMs - Date.now()) : 250;
		const didLock = scriptLock.tryLock(Math.min(5000, remainingMs));
		if (!didLock) {
			if (waitMs <= 0 || Date.now() >= deadlineMs) break;
			Utilities.sleep(ACTIVE_ROSTER_JOB_LOCK_POLL_MS);
			continue;
		}

		try {
			const nowMs = Date.now();
			const current = parseActiveRosterJobLockState_(props.getProperty(ACTIVE_ROSTER_JOB_LOCK_KEY));
			if (!current || current.expiresAt <= nowMs) {
				props.setProperty(
					ACTIVE_ROSTER_JOB_LOCK_KEY,
					JSON.stringify({
						token: token,
						owner: owner,
						expiresAt: nowMs + ACTIVE_ROSTER_JOB_LOCK_LEASE_MS,
					}),
				);
				acquired = true;
			}
		} finally {
			scriptLock.releaseLock();
		}

		if (acquired) {
			return { token: token, owner: owner };
		}
		if (waitMs <= 0 || Date.now() >= deadlineMs) break;
		Utilities.sleep(ACTIVE_ROSTER_JOB_LOCK_POLL_MS);
	}
	return null;
}

function createActiveRosterJobLockBusyError_(ownerRaw, waitMsRaw) {
	const owner = String(ownerRaw == null ? "unknown" : ownerRaw).trim() || "unknown";
	const waitMs = Math.max(0, Number(waitMsRaw) || 0);
	const err = new Error("Another active roster refresh/publish flow is running. Please wait and try again.");
	err.code = "activeRosterJobLockBusy";
	err.lockOwner = owner;
	err.lockWaitMs = waitMs;
	return err;
}

function renewActiveRosterJobLockLeaseForToken_(props, tokenRaw, ownerRaw) {
	const token = String(tokenRaw == null ? "" : tokenRaw).trim();
	if (!token) return false;
	const owner = String(ownerRaw == null ? "unknown" : ownerRaw).trim() || "unknown";
	const renewLock = LockService.getScriptLock();
	const didLock = renewLock.tryLock(5000);
	if (!didLock) return false;
	try {
		const nowMs = Date.now();
		const current = parseActiveRosterJobLockState_(props.getProperty(ACTIVE_ROSTER_JOB_LOCK_KEY));
		if (!current || current.token !== token) {
			Logger.log("withActiveRosterJobLock: unable to renew lease for owner '%s' (lock token changed or missing).", owner);
			return false;
		}
		props.setProperty(
			ACTIVE_ROSTER_JOB_LOCK_KEY,
			JSON.stringify({
				token: token,
				owner: current.owner || owner,
				expiresAt: nowMs + ACTIVE_ROSTER_JOB_LOCK_LEASE_MS,
			}),
		);
		return true;
	} finally {
		renewLock.releaseLock();
	}
}

function releaseActiveRosterJobLock_(tokenRaw) {
	const token = String(tokenRaw == null ? "" : tokenRaw).trim();
	if (!token) return false;
	const props = PropertiesService.getScriptProperties();
	const scriptLock = LockService.getScriptLock();
	const didLock = scriptLock.tryLock(5000);
	if (!didLock) return false;
	try {
		const current = parseActiveRosterJobLockState_(props.getProperty(ACTIVE_ROSTER_JOB_LOCK_KEY));
		if (current && current.token === token) {
			props.deleteProperty(ACTIVE_ROSTER_JOB_LOCK_KEY);
			return true;
		}
		return false;
	} finally {
		scriptLock.releaseLock();
	}
}

function withActiveRosterJobLock_(ownerRaw, waitMsRaw, callback) {
	if (typeof callback !== "function") {
		throw new Error("Active roster job callback is required.");
	}
	const owner = String(ownerRaw == null ? "unknown" : ownerRaw).trim() || "unknown";
	const waitMs = Math.max(0, Number(waitMsRaw) || 0);
	const acquired = tryAcquireActiveRosterJobLock_(owner, waitMs);
	if (!acquired) {
		throw createActiveRosterJobLockBusyError_(owner, waitMs);
	}
	const props = PropertiesService.getScriptProperties();
	const contextToken = Utilities.getUuid();
	const lockContext = {
		token: contextToken,
		owner: owner,
		rosterId: "active-job:" + owner,
		lastTouchedAtMs: 0,
		touch: function () {
			return renewActiveRosterJobLockLeaseForToken_(props, acquired.token, acquired.owner);
		},
	};
	pushActiveRosterLockContext_(lockContext);
	try {
		return callback();
	} finally {
		popActiveRosterLockContext_(contextToken);
		releaseActiveRosterJobLock_(acquired.token);
	}
}

function isActiveRosterJobLockBusyError_(errRaw) {
	const err = errRaw && typeof errRaw === "object" ? errRaw : null;
	if (err && String(err.code || "").trim() === "activeRosterJobLockBusy") return true;
	const message = errorMessage_(errRaw).toLowerCase();
	return message.indexOf("another active roster refresh/publish flow is running") >= 0;
}

function assertAdminPassword_(password) {
	const props = PropertiesService.getScriptProperties();
	const configured = props.getProperty("ADMIN_PW");
	const adminPwRaw = configured != null && String(configured).length > 0 ? String(configured) : "change-me";
	const adminPw = adminPwRaw.trim();
	const providedPw = String(password || "").trim();

	if (providedPw !== adminPw) {
		throw new Error("Authentication failed. Check script property ADMIN_PW (default is 'change-me' when unset).");
	}
}

function checkPublishCooldown_() {
	const props = PropertiesService.getScriptProperties();
	const nowMs = Date.now();
	const lastMs = parseInt(props.getProperty("LAST_PUBLISH_MS") || "0", 10) || 0;

	// 10 seconds cooldown
	if (nowMs - lastMs < 10000) {
		throw new Error("Publish cooldown: please wait a few seconds and try again.");
	}
}

function markPublish_() {
	PropertiesService.getScriptProperties().setProperty("LAST_PUBLISH_MS", String(Date.now()));
}

function pushActiveRosterLockContext_(ctxRaw) {
	const ctx = ctxRaw && typeof ctxRaw === "object" ? ctxRaw : null;
	if (!ctx || typeof ctx.touch !== "function") return;
	if (!Array.isArray(activeRosterLockContextStack_)) activeRosterLockContextStack_ = [];
	activeRosterLockContextStack_.push(ctx);
}

function popActiveRosterLockContext_(tokenRaw) {
	const token = String(tokenRaw == null ? "" : tokenRaw).trim();
	if (!token) return;
	if (!Array.isArray(activeRosterLockContextStack_) || !activeRosterLockContextStack_.length) return;
	for (let i = activeRosterLockContextStack_.length - 1; i >= 0; i--) {
		const ctx = activeRosterLockContextStack_[i] && typeof activeRosterLockContextStack_[i] === "object" ? activeRosterLockContextStack_[i] : null;
		if (!ctx) continue;
		if (String(ctx.token == null ? "" : ctx.token).trim() === token) {
			activeRosterLockContextStack_.splice(i, 1);
			return;
		}
	}
}

function touchActiveRosterLockLease_(reasonRaw) {
	if (!Array.isArray(activeRosterLockContextStack_) || !activeRosterLockContextStack_.length) return false;
	const ctx = activeRosterLockContextStack_[activeRosterLockContextStack_.length - 1];
	if (!ctx || typeof ctx.touch !== "function") return false;
	const nowMs = Date.now();
	const lastTouchedAtMs = Number(ctx.lastTouchedAtMs);
	if (isFinite(lastTouchedAtMs) && nowMs - lastTouchedAtMs < ACTIVE_ROSTER_LOCK_HEARTBEAT_MIN_INTERVAL_MS) return true;
	try {
		const touched = ctx.touch(reasonRaw);
		if (touched !== false) {
			ctx.lastTouchedAtMs = nowMs;
			return true;
		}
	} catch (err) {
		Logger.log("touchActiveRosterLockLease heartbeat failed for owner '%s': %s", String(ctx.owner || ""), errorMessage_(err));
	}
	return false;
}

function hasValidAdminPassword_(password) {
	try {
		assertAdminPassword_(password);
		return true;
	} catch (err) {
		return false;
	}
}
