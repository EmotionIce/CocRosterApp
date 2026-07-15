import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const clientCode = fs.readFileSync(new URL("../cloudflarePages/client.js", import.meta.url), "utf8");
const stylesCode = fs.readFileSync(new URL("../cloudflarePages/styles.css", import.meta.url), "utf8");
const styleStart = stylesCode.indexOf("/* Public roster player rows: dense warm-charcoal four-zone cards. */");
const styleEnd = stylesCode.indexOf("/* TURTLE public Home redesign", styleStart);
const playerCardStyles = stylesCode.slice(styleStart, styleEnd);

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
});

test("ships a scoped dense four-area public roster layout", () => {
  assert.ok(styleStart >= 0 && styleEnd > styleStart, "expected isolated public player-card styles");
  assert.match(playerCardStyles, /body:not\(\.admin-shell-page\) \.public-shell\[data-active-view="rosters"\]/);
  assert.match(playerCardStyles, /--player-th-column:46px/);
  assert.match(playerCardStyles, /--player-league-column:50px/);
  assert.match(playerCardStyles, /--player-stat-column:78px/);
  assert.match(playerCardStyles, /grid-template-columns:[\s\S]*var\(--player-th-column\)[\s\S]*var\(--player-league-column\)[\s\S]*minmax\(0, 1fr\)[\s\S]*var\(--player-stat-column\)/);
  assert.match(playerCardStyles, /\.player-right\{\s*display:contents/);
  assert.match(playerCardStyles, /\.player-cwl\{[\s\S]*grid-column:4[\s\S]*grid-row:1/);
  assert.match(playerCardStyles, /\.player-form-badge\{[\s\S]*grid-template-columns:10px minmax\(0, 1fr\) auto/);
});

test("keeps icons undistorted and responsive without blue card surfaces", () => {
  assert.match(playerCardStyles, /\.player-th-icon\{[\s\S]*object-fit:contain/);
  assert.match(playerCardStyles, /\.player-league-icon\{[\s\S]*object-fit:contain/);
  assert.match(playerCardStyles, /text-overflow:ellipsis/);
  assert.match(playerCardStyles, /@media \(max-width: 420px\)/);
  assert.doesNotMatch(playerCardStyles, /59,130,246|96,165,250|14,165,233|56,189,248|#(?:0ea5e9|3b82f6|60a5fa)/i);
});
