import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(
  readFileSync(new URL("../script/appsscript.json", import.meta.url), "utf8"),
);

test("Apps Script manifest pins the approved production scopes and web-app access", () => {
  assert.deepEqual(
    [...manifest.oauthScopes].sort(),
    [
      "https://www.googleapis.com/auth/script.external_request",
      "https://www.googleapis.com/auth/script.scriptapp",
      "https://www.googleapis.com/auth/script.storage",
    ].sort(),
  );
  assert.deepEqual(manifest.webapp, {
    executeAs: "USER_DEPLOYING",
    access: "ANYONE_ANONYMOUS",
  });
});
