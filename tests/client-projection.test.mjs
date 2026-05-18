import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const clientPath = new URL("../cloudflarePages/client.js", import.meta.url);
const clientCode = fs.readFileSync(clientPath, "utf8");
const bootMarker = '    markBootTiming("shell-boot-start");';

const loadClientInternals = () => {
  assert.ok(clientCode.includes(bootMarker), "expected client boot marker to exist");
  const instrumentedCode = clientCode.replace(
    bootMarker,
    [
      "    window.__ROSTER_CLIENT_TEST_INTERNALS__ = {",
      "        buildRosterPublicDisplayModel,",
      "    };",
      "    return;",
      bootMarker,
    ].join("\n"),
  );
  const context = {
    console,
    window: {
      ROSTER_CLIENT_DISABLE_AUTOLOAD: true,
    },
  };
  vm.createContext(context);
  vm.runInContext(instrumentedCode, context);
  return context.window.__ROSTER_CLIENT_TEST_INTERNALS__;
};

test("keeps canonical Discord when a stale live projection has an empty Discord value", () => {
  const { buildRosterPublicDisplayModel } = loadClientInternals();
  const model = buildRosterPublicDisplayModel({
    trackingMode: "regularWar",
    main: [
      {
        name: "Phuni",
        discord: "phuuni",
        th: 18,
        tag: "#2LUCULPQ2",
        notes: ["canonical note"],
        excludeAsSwapTarget: true,
        excludeAsSwapSource: true,
      },
    ],
    subs: [],
    missing: [],
    publicLineupProjection: {
      active: true,
      trackingMode: "regularWar",
      source: "regularWarCurrentWar",
      updatedAt: "2026-05-18T09:12:11.217Z",
      players: [
        {
          name: "Phuni from live war",
          discord: "",
          th: 18,
          tag: "#2LUCULPQ2",
          mapPosition: 4,
          notes: ["stale projection note"],
          excludeAsSwapTarget: false,
          excludeAsSwapSource: false,
        },
      ],
    },
  });

  assert.equal(model.main.length, 1);
  assert.equal(model.main[0].discord, "phuuni");
  assert.equal(model.main[0].name, "Phuni from live war");
  assert.equal(model.main[0].mapPosition, 4);
  assert.deepEqual(Array.from(model.main[0].notes), ["canonical note"]);
  assert.equal(model.main[0].excludeAsSwapTarget, true);
  assert.equal(model.main[0].excludeAsSwapSource, true);
});

test("lets canonical Discord clearing win over a stale projected Discord value", () => {
  const { buildRosterPublicDisplayModel } = loadClientInternals();
  const model = buildRosterPublicDisplayModel({
    trackingMode: "regularWar",
    main: [
      {
        name: "Phuni",
        discord: "",
        th: 18,
        tag: "#2LUCULPQ2",
      },
    ],
    subs: [],
    missing: [],
    publicLineupProjection: {
      active: true,
      trackingMode: "regularWar",
      source: "regularWarCurrentWar",
      players: [
        {
          name: "Phuni from live war",
          discord: "old-handle",
          th: 18,
          tag: "#2LUCULPQ2",
          mapPosition: 4,
        },
      ],
    },
  });

  assert.equal(model.main[0].discord, "");
  assert.equal(model.main[0].mapPosition, 4);
});
