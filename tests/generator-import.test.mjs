import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const generatorPath = new URL("../cloudflarePages/generator.js", import.meta.url);
const generatorCode = fs.readFileSync(generatorPath, "utf8");

const loadGenerator = () => {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(generatorCode, context);
  return context.window.RosterGenerator;
};

test("prefers Username over Discord display name when both are present", () => {
  const generator = loadGenerator();
  const parsed = generator.parseXlsxRowsTolerant([
    {
      NAME: "Phuni",
      TAG: "#2LUCULPQ2",
      Discord: "Phuni",
      Username: "phuuni",
      CLAN: "TURTLE",
      "War Preference": "in",
      "Town-Hall": 18,
    },
  ]);

  assert.equal(parsed.accounts[0].discord, "phuuni");
});

test("falls back to Discord display name when Username is blank or a placeholder", () => {
  const generator = loadGenerator();
  const blankParsed = generator.parseXlsxRowsTolerant([
    {
      NAME: "Phuni",
      TAG: "#2LUCULPQ2",
      Discord: "Phuni",
      Username: "",
      CLAN: "TURTLE",
      "War Preference": "in",
      "Town-Hall": 18,
    },
  ]);
  const placeholderParsed = generator.parseXlsxRowsTolerant([
    {
      NAME: "Phuni",
      TAG: "#2LUCULPQ2",
      Discord: "Phuni",
      Username: "n/a",
      CLAN: "TURTLE",
      "War Preference": "in",
      "Town-Hall": 18,
    },
  ]);

  assert.equal(blankParsed.accounts[0].discord, "Phuni");
  assert.equal(placeholderParsed.accounts[0].discord, "Phuni");
});

test("updates existing war-out roster members while still excluding new war-out additions", () => {
  const generator = loadGenerator();
  const accounts = generator.parseXlsxRowsTolerant([
    {
      NAME: "Phuni #2",
      TAG: "#28VYJ9URP",
      Discord: "Phuni",
      Username: "phuuni",
      CLAN: "TURTLE",
      "War Preference": "out",
      "Town-Hall": 17,
    },
    {
      NAME: "Brand New",
      TAG: "#NEW123",
      Discord: "Brand New",
      Username: "brandnew",
      CLAN: "TURTLE",
      "War Preference": "out",
      "Town-Hall": 16,
    },
  ]).accounts;

  const rosterData = {
    rosters: [
      {
        id: "turtle",
        title: "TURTLE",
        main: [
          {
            name: "Phuni #2",
            discord: "",
            th: 17,
            tag: "#28VYJ9URP",
          },
        ],
        subs: [],
        missing: [],
      },
    ],
  };

  const comparison = generator.buildImportComparison({
    rosterData,
    accounts,
    importedClanValues: generator.extractImportedClanValues(accounts),
    mapping: { TURTLE: "turtle" },
    filters: { excludeWarOut: true },
  });

  assert.equal(comparison.summary.matchedWithUpdates, 1);
  assert.equal(comparison.summary.newAddable, 0);
  assert.equal(comparison.summary.ignoredWarOut, 1);
  assert.equal(comparison.buckets.matchedWithUpdates[0].updates.discord, "phuuni");
  assert.equal(comparison.buckets.ignored.warOut[0].tag, "#NEW123");
});

test("applying import updates preserves existing player metrics store", () => {
  const generator = loadGenerator();
  const playerMetrics = {
    schemaVersion: 1,
    updatedAt: "2026-05-19T00:00:00.000Z",
    byTag: {
      "#28VYJ9URP": {
        identity: { tag: "#28VYJ9URP", name: "Phuni #2" },
        latestSnapshot: {
          tag: "#28VYJ9URP",
          trophies: 5000,
          donations: 10,
          donationsReceived: 4,
        },
        trophyHistoryDaily: [],
        donationMonths: {},
      },
    },
  };
  const rosterData = {
    playerMetrics,
    rosters: [
      {
        id: "turtle",
        title: "TURTLE",
        main: [
          {
            name: "Phuni #2",
            discord: "",
            th: 17,
            tag: "#28VYJ9URP",
          },
        ],
        subs: [],
        missing: [],
      },
    ],
  };
  const accounts = generator.parseXlsxRowsTolerant([
    {
      NAME: "Phuni #2",
      TAG: "#28VYJ9URP",
      Username: "phuuni",
      CLAN: "TURTLE",
      "War Preference": "in",
      "Town-Hall": 17,
    },
  ]).accounts;
  const comparison = generator.buildImportComparison({
    rosterData,
    accounts,
    importedClanValues: generator.extractImportedClanValues(accounts),
    mapping: { TURTLE: "turtle" },
    filters: {},
  });

  const applied = generator.applyImportComparison({ rosterData, comparison });

  assert.deepEqual(JSON.parse(JSON.stringify(applied.rosterData.playerMetrics)), playerMetrics);
  assert.equal(applied.rosterData.rosters[0].main[0].discord, "phuuni");
});
