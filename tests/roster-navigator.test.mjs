import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const clientPath = new URL("../cloudflarePages/client.js", import.meta.url);
const indexPath = new URL("../cloudflarePages/index.html", import.meta.url);
const stylesPath = new URL("../cloudflarePages/styles.css", import.meta.url);
const clientCode = fs.readFileSync(clientPath, "utf8");
const indexCode = fs.readFileSync(indexPath, "utf8");
const stylesCode = fs.readFileSync(stylesPath, "utf8");
const bootMarker = '    markBootTiming("shell-boot-start");';
const scrollHandlerStart = clientCode.indexOf("    const handleRosterNavigatorScroll = () => {");
const scrollHandlerEnd = clientCode.indexOf("\n    };", scrollHandlerStart);
const scrollHandlerCode = clientCode.slice(scrollHandlerStart, scrollHandlerEnd + 7);

const loadNavigatorInternals = () => {
  assert.ok(clientCode.includes(bootMarker), "expected client boot marker to exist");
  const instrumentedCode = clientCode.replace(
    bootMarker,
    [
      "    window.__ROSTER_NAVIGATOR_TEST_INTERNALS__ = {",
      "        parseRosterAnchorHash,",
      "        slugifyRosterAnchorPart,",
      "        buildRosterNavigatorModels,",
      "        resolveRosterNavigatorActiveIndex,",
      "        resolveRosterNavigatorMarkerY,",
      "        resolveRosterStickyHeaderTop,",
      "        resolveRosterStickyHeaderState,",
      "        isRosterNavigatorScrollKey,",
      "    };",
      "    return;",
      bootMarker,
    ].join("\n"),
  );
  const context = {
    console,
    setTimeout,
    URLSearchParams,
    window: {
      ROSTER_CLIENT_DISABLE_AUTOLOAD: true,
      location: { hash: "", search: "" },
    },
  };
  vm.createContext(context);
  vm.runInContext(instrumentedCode, context);
  return context.window.__ROSTER_NAVIGATOR_TEST_INTERNALS__;
};

test("builds stable ordered anchors for every displayed roster", () => {
  const { buildRosterNavigatorModels } = loadNavigatorInternals();
  const models = buildRosterNavigatorModels([
    { id: "main_clan", title: "TURTLE (main clan)", trackingMode: "regularWar" },
    { id: "main_clan", title: "Duplicate identity", trackingMode: "cwl" },
    { title: "PURPLE Turtle", trackingMode: "regularWar" },
    {},
  ]);
  const summary = models.map(({ index, anchorId, title, modeLabel }) => ({ index, anchorId, title, modeLabel }));

  assert.deepEqual(JSON.parse(JSON.stringify(summary)), [
    { index: 0, anchorId: "roster-main-clan", title: "TURTLE (main clan)", modeLabel: "Regular war" },
    { index: 1, anchorId: "roster-main-clan-2", title: "Duplicate identity", modeLabel: "CWL" },
    { index: 2, anchorId: "roster-purple-turtle", title: "PURPLE Turtle", modeLabel: "Regular war" },
    { index: 3, anchorId: "roster-roster-4", title: "Roster 4", modeLabel: "CWL" },
  ]);
});

test("normalizes valid roster hashes and rejects unrelated or unsafe fragments", () => {
  const { parseRosterAnchorHash, slugifyRosterAnchorPart } = loadNavigatorInternals();

  assert.equal(slugifyRosterAnchorPart("  TÜRȚLE / Main Clan  "), "turtle-main-clan");
  assert.equal(parseRosterAnchorHash("#ROSTER-MAIN-CLAN"), "roster-main-clan");
  assert.equal(parseRosterAnchorHash("#roster-purple%2Dturtle"), "roster-purple-turtle");
  assert.equal(parseRosterAnchorHash("#leaderboard"), "");
  assert.equal(parseRosterAnchorHash("#roster-%2E%2E%2Fadmin"), "");
  assert.equal(parseRosterAnchorHash("#roster-"), "");
});

test("scrollspy resolution advances in order and selects the final roster at page end", () => {
  const { resolveRosterNavigatorActiveIndex, resolveRosterNavigatorMarkerY } = loadNavigatorInternals();
  const sectionTops = [-420, 180, 920];

  assert.equal(resolveRosterNavigatorActiveIndex([], 120, false), -1);
  assert.equal(resolveRosterNavigatorActiveIndex(sectionTops, 120, false), 0);
  assert.equal(resolveRosterNavigatorActiveIndex(sectionTops, 200, false), 1);
  assert.equal(resolveRosterNavigatorActiveIndex(sectionTops, 950, false), 2);
  assert.equal(resolveRosterNavigatorActiveIndex(sectionTops, 120, true), 2);
  assert.equal(resolveRosterNavigatorActiveIndex(sectionTops, 120, false, 2), 2);
  assert.equal(resolveRosterNavigatorMarkerY(140, 0), 158);
  assert.equal(resolveRosterNavigatorMarkerY(140, 227), 251);
});

test("mobile roster headers compact at the shared navigation edge", () => {
  const { resolveRosterStickyHeaderTop, resolveRosterStickyHeaderState } = loadNavigatorInternals();

  assert.equal(resolveRosterStickyHeaderTop(72, 40), 130);
  assert.equal(resolveRosterStickyHeaderTop(72, 0), 90);
  assert.equal(resolveRosterStickyHeaderState(131, 130), true);
  assert.equal(resolveRosterStickyHeaderState(132, 130), false);
  assert.equal(resolveRosterStickyHeaderState(-400, 130), true);
});

test("recognizes keyboard scrolling without treating activation keys as scroll intent", () => {
  const { isRosterNavigatorScrollKey } = loadNavigatorInternals();

  for (const key of ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "]) {
    assert.equal(isRosterNavigatorScrollKey(key), true, `expected ${JSON.stringify(key)} to count as scrolling`);
  }
  assert.equal(isRosterNavigatorScrollKey("Enter"), false);
  assert.equal(isRosterNavigatorScrollKey("Escape"), false);
  assert.equal(isRosterNavigatorScrollKey("Tab"), false);
});

test("ships distinct semantic desktop and mobile navigation controls", () => {
  assert.match(indexCode, /<aside id="rosterNavigator"[^>]*aria-label="Roster navigation"/);
  assert.match(indexCode, /<nav aria-label="Jump between rosters">/);
  assert.match(indexCode, /id="rosterNavigatorToggle"[\s\S]*aria-expanded="false"/);
  assert.match(indexCode, /<label[^>]*for="rosterMobileSelect">/);
  assert.match(indexCode, /<select id="rosterMobileSelect"[^>]*aria-label="Jump to roster"/);
  assert.doesNotMatch(indexCode, /id="rosterNavigator"[^>]*role="tablist"/);
  assert.match(stylesCode, /@media \(min-width: 960px\)[\s\S]*\.roster-board-layout\.has-roster-navigator/);
  assert.match(stylesCode, /grid-template-columns:58px minmax\(0, 1fr\)/);
  assert.match(stylesCode, /\.roster-navigator\.is-expanded\{[\s\S]*width:var\(--roster-nav-expanded-width\)/);
  assert.doesNotMatch(stylesCode, /\.roster-navigator:is\(\.is-expanded, :focus-within, :hover\)/);
  assert.match(clientCode, /const handleRosterNavigatorScrollIntent = \(event\) => \{[\s\S]*aria-expanded[\s\S]*setRosterNavigatorExpanded\(false\)/);
  assert.match(clientCode, /addEventListener\("wheel", handleRosterNavigatorScrollIntent, \{ passive: true \}\)/);
  assert.match(clientCode, /addEventListener\("touchmove", handleRosterNavigatorScrollIntent, \{ passive: true \}\)/);
  assert.match(clientCode, /const finishRosterNavigatorProgrammaticJump = \(\) => \{[\s\S]*setRosterNavigatorExpanded\(false\)[\s\S]*queueRosterNavigatorScrollSync\(\)/);
  assert.ok(scrollHandlerStart >= 0 && scrollHandlerEnd > scrollHandlerStart, "expected the geometry-only scroll handler");
  assert.doesNotMatch(scrollHandlerCode, /setRosterNavigatorExpanded/);
  assert.match(stylesCode, /backdrop-filter:blur\(15px\) saturate\(125%\)/);
  assert.match(stylesCode, /\.roster-card--anchored\{[\s\S]*scroll-margin-top/);
  assert.match(stylesCode, /--roster-mobile-navigator-height/);
  assert.match(stylesCode, /\.roster-mobile-navigator\.is-integrated\{[\s\S]*width:100%/);
  assert.match(clientCode, /syncRosterStickyHeaderStates\(stickyTop, activeIndex\)/);
});
