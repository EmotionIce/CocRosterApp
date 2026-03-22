// Legacy compatibility wrappers retained from current monolith.

function readActiveRosterSnapshotFromDrive_() {
	return readActiveRosterSnapshot_();
}

function readActiveRosterDataFromDrive_() {
	return readActiveRosterData_();
}

function findFileByRelativePathCaseInsensitive_(pathRaw) {
	return null;
}

function findFileByNameRecursivelyCaseInsensitive_(filenameRaw) {
	return null;
}

function replaceActiveRosterDataFile_(validatedRosterData, options) {
	return replaceActiveRosterData_(validatedRosterData, options);
}

function listFolderFiles_() {
	return listFirebaseDataDebugInfo_();
}

function findFirstFileByNameCandidates_(names) {
	return null;
}

function findFileByRelativePath_(pathRaw) {
	return null;
}
