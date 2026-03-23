// Apps Script asset shell for the public Cloudflare client bundle.

const FOLDER_ID = "1NrNOgGhK-hsrF7FPFQ7ck2NT9h6DGidH";

// Handle do get.
function doGet(e) {
  const asset = (e && e.parameter && e.parameter.asset) ? String(e.parameter.asset) : "";
  if (asset) return serveAsset_(asset);

  return HtmlService.createHtmlOutput(renderShell_())
    .setTitle("CWL Roster");
}

// Handle serve asset.
function serveAsset_(name) {
  const safeName = name.replace(/^[\/\\]+/, "").replace(/\.\./g, "");
  const file = findFileByName_(safeName);

  if (!file) {
    return ContentService
      .createTextOutput("404 - asset not found: " + safeName)
      .setMimeType(ContentService.MimeType.TEXT);
  }

  const ext = (safeName.split(".").pop() || "").toLowerCase();
  const text = file.getBlob().getDataAsString("UTF-8");

  let mime = ContentService.MimeType.TEXT;
  if (ext === "js") mime = ContentService.MimeType.JAVASCRIPT;
  if (ext === "json") mime = ContentService.MimeType.JSON;
  if (ext === "html") mime = ContentService.MimeType.HTML;

  return ContentService.createTextOutput(text).setMimeType(mime);
}

// Find file by name.
function findFileByName_(filename) {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const it = folder.getFilesByName(filename);
  return it.hasNext() ? it.next() : null;
}

// Get asset text.
function getAssetText_(filename) {
  const file = findFileByName_(filename);
  if (!file) return "";
  return file.getBlob().getDataAsString("UTF-8");
}

// Render the HTML shell from stored app assets.
function renderShell_() {
  // Read the HTML/CSS fragments from Drive at request time so edits take effect immediately.
  const appHtml = getAssetText_("app.html");
  const css = getAssetText_("styles.css");

  // Load scripts as external assets (src=...) so they show up in Network + execute reliably.
  return (
    '<!doctype html>' +
    '<html>' +
    '<head>' +
    '  <meta charset="utf-8" />' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />' +
    '  <title>CWL Roster</title>' +
    '  <style>' + css + '</style>' +
    '</head>' +
    '<body style="margin:0;">' +
    '  <div id="app">' + appHtml + '</div>' +
    '  <script src="?asset=roster-data.js"></script>' +
    '  <script src="?asset=client.js"></script>' +
    '</body>' +
    '</html>'
  );
}