import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const clientCode = fs.readFileSync(new URL("../cloudflarePages/client.js", import.meta.url), "utf8");
const stylesCode = fs.readFileSync(new URL("../cloudflarePages/styles.css", import.meta.url), "utf8");
const styleStart = stylesCode.indexOf("/* Public roster player rows: dense warm-charcoal four-zone cards. */");
const styleEnd = stylesCode.indexOf("/* TURTLE public Home redesign", styleStart);
const playerCardStyles = stylesCode.slice(styleStart, styleEnd);

const loadAttackTileInternals = () => {
  const makeElement = (tagName) => ({
    tagName, children: [], attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    appendChild(child) { this.children.push(child); return child; },
  });
  const context = {
    window: {}, console, setTimeout, clearTimeout,
    document: { createElement: makeElement, createElementNS: (_namespace, name) => makeElement(name) },
  };
  const marker = '    markBootTiming("shell-boot-start");';
  assert.ok(clientCode.includes(marker));
  vm.runInNewContext(clientCode.replace(marker,
    "    window.tiles = { getPlayerCwlAttackDays, renderPlayerCwlAttackDays }; return;\n" + marker), context);
  return context.window.tiles;
};

test("a two-star first day renders seven tiles, three stars each and six grey days", () => {
  const { renderPlayerCwlAttackDays } = loadAttackTileInternals();
  const strip = renderPlayerCwlAttackDays({ attackDays: [
    { roundIndex: 0, state: "warended", starsByTag: { "#P0L": 2 } },
  ] }, "#p0l");
  assert.equal(strip.children.length, 7);
  const first = strip.children[0];
  assert.equal(first.className, "player-cwl-day is-attacked");
  assert.equal(first.attributes["aria-label"], "Day 1: 2 of 3 stars");
  for (const tile of strip.children) assert.equal(tile.children[1].children.length, 3);
  assert.equal(first.children[1].children.filter((star) => star.attributes.class.includes("is-earned")).length, 2);
  assert.equal(strip.children.slice(1).filter((tile) => tile.className.endsWith("is-unavailable")).length, 6);
});

test("league day positions distinguish zero stars, missed attacks, bench, preparation and pending", () => {
  const { getPlayerCwlAttackDays } = loadAttackTileInternals();
  const days = getPlayerCwlAttackDays({ attackDays: [
    { roundIndex: 0, state: "warended", starsByTag: { "#P0L": 0 } },
    { roundIndex: 1, state: "warended", starsByTag: { "#P0L": null } },
    { roundIndex: 2, state: "warended", starsByTag: { "#Y0L": 3 } },
    { roundIndex: 4, state: "inwar", starsByTag: { "#P0L": null } },
    { roundIndex: 5, state: "preparation", starsByTag: { "#P0L": null } },
    { roundIndex: 6, state: "inwar", starsByTag: { "#P0L": 3 } },
    { roundIndex: 10, state: "warended", starsByTag: { "#P0L": 3 } },
  ] }, "#P0L");
  assert.deepEqual(Array.from(days, (day) => [day.day, day.state, day.stars]), [
    [1, "attacked", 0], [2, "missed", 0], [3, "benched", 0], [4, "unavailable", 0],
    [5, "pending", 0], [6, "upcoming", 0], [7, "attacked", 3],
  ]);
  assert.equal(getPlayerCwlAttackDays(null, "#P0L").length, 7);
  assert.doesNotMatch(clientCode, /cwlStats\.starsTotal \+ "\/8"/);
});

test("preserves player content order while adding compact stat labels", () => {
  const townHallIndex = clientCode.indexOf("right.appendChild(townHallBadge)");
  const leagueIndex = clientCode.indexOf("right.appendChild(leagueBadge)", townHallIndex);
  const statsIndex = clientCode.indexOf("right.appendChild(cwlBadge)", leagueIndex);
  const discordIndex = clientCode.indexOf("metaRow.appendChild(discordLine)", statsIndex);
  const formIndex = clientCode.indexOf("metaRow.appendChild(formBadge)", discordIndex);

  assert.ok(townHallIndex > 0 && townHallIndex < leagueIndex && leagueIndex < statsIndex);
  assert.ok(statsIndex < discordIndex && discordIndex < formIndex);
  assert.match(clientCode, /player-cwl--attacks/);
  assert.match(clientCode, /player-cwl-label/);
  assert.match(clientCode, /if \(score >= 90\) tone = "strong";\s*else if \(score >= 70\) tone = "good";\s*else if \(score >= 45\) tone = "fair";/);
});

test("ships a scoped dense four-area public roster layout", () => {
  assert.ok(styleStart >= 0 && styleEnd > styleStart, "expected isolated public player-card styles");
  assert.match(playerCardStyles, /body:not\(\.admin-shell-page\) \.public-shell\[data-active-view="rosters"\]/);
  assert.match(playerCardStyles, /\.roster-card--anchored\{[\s\S]*border:0 !important[\s\S]*background:transparent !important/);
  assert.match(playerCardStyles, /--player-th-column:46px/);
  assert.match(playerCardStyles, /--player-league-column:50px/);
  assert.match(playerCardStyles, /--player-stat-column:78px/);
  assert.match(playerCardStyles, /grid-template-columns:[\s\S]*var\(--player-th-column\)[\s\S]*var\(--player-league-column\)[\s\S]*minmax\(0, 1fr\)[\s\S]*var\(--player-stat-column\)/);
  assert.match(playerCardStyles, /\.player-right\{\s*display:contents/);
  assert.match(playerCardStyles, /\.player-cwl\{[\s\S]*grid-column:4[\s\S]*grid-row:1/);
  assert.match(playerCardStyles, /margin:7px 6px 0 0/);
  assert.match(playerCardStyles, /\.player-cwl\{[\s\S]*grid-template-columns:9px minmax\(0, 1fr\) auto[\s\S]*gap:2px[\s\S]*padding:0 5px/);
  assert.match(playerCardStyles, /\.player-form-badge\{[\s\S]*grid-template-columns:9px minmax\(0, 1fr\) auto[\s\S]*gap:2px[\s\S]*padding:0 5px/);
  assert.match(playerCardStyles, /@media \(max-width: 420px\)\{[\s\S]*--player-stat-column:78px/);
  assert.doesNotMatch(playerCardStyles, /\.player-top::after/);
});

test("keeps icons undistorted and responsive without blue card surfaces", () => {
  assert.match(playerCardStyles, /\.player-th-icon\{[\s\S]*object-fit:contain/);
  assert.match(playerCardStyles, /\.player-league-icon\{[\s\S]*object-fit:contain/);
  assert.match(playerCardStyles, /text-overflow:ellipsis/);
  assert.match(playerCardStyles, /@media \(max-width: 420px\)/);
  assert.match(playerCardStyles, /\.player-form-badge\.tone-neutral\{[\s\S]*--form-tone:145,143,136/);
  assert.match(playerCardStyles, /\.player-form-badge\.tone-low\{[\s\S]*--form-tone:190,75,67/);
  assert.match(playerCardStyles, /\.player-form-badge\.tone-fair\{[\s\S]*--form-tone:190,91,72/);
  assert.match(playerCardStyles, /\.player-form-badge\.tone-strong\{[\s\S]*rgba\(215,184,105,\.17\)/);
  assert.doesNotMatch(playerCardStyles, /59,130,246|96,165,250|14,165,233|56,189,248|#(?:0ea5e9|3b82f6|60a5fa)/i);
});
