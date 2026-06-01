// Legacy Apps Script compatibility wrappers.
// These names may still be referenced by deployed Apps Script triggers, menus,
// or older admin clients, so keep them as thin delegates into the Firebase
// active-data boundary.

// Backwards-compatible Drive-era name for the active Firebase snapshot.
function readActiveRosterSnapshotFromDrive_() {
	return readActiveRosterSnapshot_();
}

// Backwards-compatible Drive-era name for active Firebase roster data.
function readActiveRosterDataFromDrive_() {
	return readActiveRosterData_();
}

// Find file by relative path case insensitive.
function findFileByRelativePathCaseInsensitive_(pathRaw) {
	return null;
}

// Find file by name recursively case insensitive.
function findFileByNameRecursivelyCaseInsensitive_(filenameRaw) {
	return null;
}

// Backwards-compatible Drive-era name for replacing active Firebase roster data.
function replaceActiveRosterDataFile_(validatedRosterData, options) {
	return replaceActiveRosterData_(validatedRosterData, options);
}

// Handle list folder files.
function listFolderFiles_() {
	return listFirebaseDataDebugInfo_();
}

// Find first file by name candidates.
function findFirstFileByNameCandidates_(names) {
	return null;
}

// Find file by relative path.
function findFileByRelativePath_(pathRaw) {
	return null;
}
