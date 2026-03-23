// Legacy compatibility wrappers retained from current monolith.

// Handle read active roster snapshot from drive.
function readActiveRosterSnapshotFromDrive_() {
	return readActiveRosterSnapshot_();
}

// Handle read active roster data from drive.
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

// Handle replace active roster data file.
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
