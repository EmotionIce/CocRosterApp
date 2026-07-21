import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const readShell = (name) => fs.readFileSync(new URL("../cloudflarePages/" + name, import.meta.url), "utf8");

test("admin shells both expose the CWL preference apply controls", () => {
  const requiredTokens = [
    "applyCwlPreferencesBtn",
    "cwlPreferenceApplySummary",
    "cwl-preference-apply-summary",
    "cwl-preference-apply-details",
    "cwl-preference-apply-details-group",
  ];

  for (const shellName of ["admin.html", "console.html"]) {
    const html = readShell(shellName);
    for (const token of requiredTokens) {
      assert.ok(html.includes(token), shellName + " is missing " + token);
    }
    assert.equal((html.match(/id="applyCwlPreferencesBtn"/g) || []).length, 1);
    assert.equal((html.match(/id="cwlPreferenceApplySummary"/g) || []).length, 1);
  }
});

test("admin shells prefer the same-origin Worker API and retain Apps Script as fallback", () => {
  const publicConfig = readShell("public-config.js");
  assert.match(publicConfig, /ROSTER_ADMIN_API_BASE\s*=\s*configuredAdminApiBase\s*\|\|\s*"\/api\/admin"/);

  for (const shellName of ["admin.html", "console.html"]) {
    const html = readShell(shellName);
    assert.match(html, /ROSTER_ADMIN_API_BASE\s*=\s*window\.ROSTER_ADMIN_API_BASE\s*\|\|\s*"\/api\/admin"/);
  }

  const adminClient = readShell("admin.js");
  assert.match(adminClient, /pushUnique\(resolveScriptServerBaseUrl\(\)\)/);
});
