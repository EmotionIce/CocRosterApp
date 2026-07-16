import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const clientCode = fs.readFileSync(new URL("../cloudflarePages/client.js", import.meta.url), "utf8");
const stylesCode = fs.readFileSync(new URL("../cloudflarePages/styles.css", import.meta.url), "utf8");
const styleStart = stylesCode.indexOf("/* Public roster tactical header: framed clan-war overview inspired by the in-game war board. */");
const styleEnd = stylesCode.indexOf("/* Anchored roster navigation", styleStart);
const headerStyles = stylesCode.slice(styleStart, styleEnd);

test("renders a three-band roster header with a live or preparation matchup", () => {
  assert.match(clientCode, /roster-head__top/);
  assert.match(clientCode, /roster-war-matchup roster-war-matchup--/);
  assert.match(clientCode, /buildMatchupSide\("clan"/);
  assert.match(clientCode, /buildMatchupSide\("opponent"/);
  assert.match(clientCode, /roster-war-versus__label/);
  assert.match(clientCode, /currentWarPresentation\.phaseLabel/);
  assert.match(clientCode, /currentWarPresentation\.scoreAvailable/);
  assert.match(clientCode, /roster-head__compact/);
  assert.match(clientCode, /roster-war-clock__label/);
  assert.match(clientCode, /openClanBtn\.textContent = "Open in-game"/);
});

test("ships the framed tactical styling and narrow-phone layout", () => {
  assert.ok(styleStart >= 0 && styleEnd > styleStart, "expected isolated roster header styles");
  assert.match(headerStyles, /\.roster-head\{[\s\S]*border:1px solid rgba\(246,232,185,\.23\)/);
  assert.match(headerStyles, /\.roster-war-matchup\{[\s\S]*grid-template-columns:minmax\(0, 1fr\) 76px minmax\(0, 1fr\)/);
  assert.match(headerStyles, /\.roster-war-team--clan\{[\s\S]*clip-path:polygon/);
  assert.match(headerStyles, /\.roster-war-versus::before[\s\S]*clip-path:polygon/);
  assert.match(headerStyles, /@media \(max-width: 680px\)[\s\S]*grid-template-columns:repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(headerStyles, /@media \(max-width: 430px\)/);
});

test("preparation and CWL variants retain distinct tactical accent colors", () => {
  assert.match(headerStyles, /\.roster-head--cwl\{[\s\S]*--war-clan:110,214,198/);
  assert.match(headerStyles, /\.roster-head--state-preparation\{[\s\S]*--war-opponent:212,194,127/);
  assert.match(headerStyles, /\.roster-war-countdown::before/);
});

test("keeps the default header lean and animates to a one-row mobile dock", () => {
  assert.match(headerStyles, /\.roster-head__top\{[\s\S]*min-height:56px/);
  assert.match(headerStyles, /\.roster-head-metric\{[\s\S]*border:0;[\s\S]*background:transparent;[\s\S]*opacity:\.72/);
  assert.match(headerStyles, /\.roster-war-clock__value\{[\s\S]*font-variant-numeric:tabular-nums/);
  assert.match(headerStyles, /@media \(max-width: 959px\)[\s\S]*position:sticky;[\s\S]*top:var\(--roster-card-sticky-top/);
  assert.match(headerStyles, /\.roster-head\.is-stuck \.roster-head__compact\{[\s\S]*max-height:48px/);
  assert.match(headerStyles, /\.roster-head\.is-stuck \.roster-head__top,[\s\S]*max-height:0/);
});

test("renders result-aware score wedges with a fading split glow", () => {
  assert.match(clientCode, /roster-war-matchup--score-" \+ currentWarScoreState/);
  assert.match(headerStyles, /\.roster-war-matchup--score-clan-leading\{[\s\S]*--score-clan:205,244,92;[\s\S]*--score-opponent:239,89,57/);
  assert.match(headerStyles, /\.roster-war-matchup--score-opponent-leading\{[\s\S]*--score-clan:239,89,57;[\s\S]*--score-opponent:205,244,92/);
  assert.match(headerStyles, /\.roster-war-matchup--score-tied\{[\s\S]*--score-clan:159,166,164;[\s\S]*--score-opponent:159,166,164/);
  assert.match(headerStyles, /\.roster-war-team--clan::before\{[\s\S]*mask-image:linear-gradient\(90deg, transparent, #000 27%, #000\)/);
  assert.match(headerStyles, /\.roster-war-versus::before\{[\s\S]*drop-shadow\(-4px 0 7px[\s\S]*drop-shadow\(4px 0 7px/);
});
