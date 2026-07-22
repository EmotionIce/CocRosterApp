import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const indexHtml = read("../cloudflarePages/index.html");
const clientCode = read("../cloudflarePages/client.js");
const adminCode = read("../cloudflarePages/admin.js");
const stylesCode = read("../cloudflarePages/styles.css");
const memberJourneyStyles = stylesCode.slice(stylesCode.indexOf("/* Continuous TURTLE member journey"));
const clanOverviewStyles = stylesCode.slice(stylesCode.indexOf("/* Clear clan overview"));
const adminDefaults = adminCode.match(/const PUBLIC_PROFILE_EDITOR_DEFAULTS = \{[\s\S]*?\n  \};/)?.[0] || "";
const robotsTxt = read("../cloudflarePages/robots.txt");
const sitemapXml = read("../cloudflarePages/sitemap.xml");
const manifest = JSON.parse(read("../cloudflarePages/site.webmanifest"));
const headersConfig = read("../cloudflarePages/_headers");
const adminHtml = read("../cloudflarePages/admin.html");
const consoleHtml = read("../cloudflarePages/console.html");

const readPngDimensions = (path) => {
  const image = fs.readFileSync(new URL(path, import.meta.url));
  assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  return {
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20),
  };
};

test("publishes complete crawlable metadata for the canonical public site", () => {
  assert.match(indexHtml, /<html lang="en">/);
  assert.match(indexHtml, /<title>TURTLE \| Clash of Clans Clan Family<\/title>/);
  assert.match(indexHtml, /<meta name="description" content="[^"]*Clash of Clans[^"]*clan family[^"]*"/i);
  assert.match(indexHtml, /<link rel="canonical" href="https:\/\/turtle\.qzz\.io\/"/);
  assert.match(indexHtml, /<meta property="og:title"/);
  assert.match(indexHtml, /<meta property="og:image" content="https:\/\/turtle\.qzz\.io\/android-chrome-512x512\.png"/);
  assert.match(indexHtml, /<meta name="twitter:card" content="summary"/);
  assert.match(indexHtml, /<link rel="manifest" href="\/site\.webmanifest"/);
});

test("structured data describes the website and independent clan-family organization", () => {
  const match = indexHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match, "expected JSON-LD structured data");
  const structuredData = JSON.parse(match[1]);
  assert.equal(structuredData["@context"], "https://schema.org");
  assert.deepEqual(structuredData["@graph"].map((item) => item["@type"]), ["WebSite", "Organization"]);
  assert.equal(structuredData["@graph"][0].url, "https://turtle.qzz.io/");
  assert.match(structuredData["@graph"][1].description, /independent Clash of Clans clan family/i);
});

test("important recruiting claims are visible to visitors and crawlers alike", () => {
  const discovery = indexHtml.match(/<section class="landing-chapter landing-discovery"[\s\S]*?<\/section>/);
  assert.ok(discovery, "expected a visible clan-family overview");
  assert.doesNotMatch(discovery[0], /\bhidden\b|display\s*:\s*none/i);
  for (const phrase of ["Clash of Clans", "clan family", "returning players", "top-level competitors", "higher CWL"]) {
    assert.match(discovery[0], new RegExp(phrase, "i"));
  }
  assert.match(discovery[0], /not endorsed by or affiliated with Supercell/i);

  const landing = indexHtml.match(/<section id="publicViewLanding"[\s\S]*?<section id="publicViewRosters"/);
  assert.ok(landing, "expected crawlable Home content");
  for (const phrase of ["side wars", "hero-down wars", "Gold Pass giveaways", "friendly challenges", "clan events"]) {
    assert.match(landing[0], new RegExp(phrase, "i"));
  }
});

test("landing selling points use visitor-visible scroll stories instead of crawler-only copy", () => {
  assert.doesNotMatch(indexHtml, /data-landing-square-story|landing-shell-map|landingJourneySteps/);
  assert.match(indexHtml, /class="landing-chapter landing-family-overview"/);
  assert.match(indexHtml, /class="landing-family-roster" role="list"/);
  assert.doesNotMatch(clanOverviewStyles, /overflow-x\s*:\s*(?:auto|scroll)|scroll-snap-type\s*:\s*x/i);
  assert.match(indexHtml, /data-landing-rhythm-story/);
  assert.match(indexHtml, /data-landing-rhythm-beat="0"/);
  assert.match(indexHtml, /data-landing-rhythm-beat="3"/);
  assert.match(indexHtml, /class="landing-rhythm__member"/);
  assert.match(indexHtml, /class="landing-war-plan"/);
  assert.match(indexHtml, /class="landing-cwl-flow"/);
  assert.match(indexHtml, /landing-cwl-step--choose/);
  assert.match(indexHtml, /landing-cwl-step--roster/);
  assert.match(indexHtml, /landing-cwl-step--rewards/);
  assert.match(indexHtml, /class="landing-cwl-side-lane"/);
  assert.match(indexHtml, /class="landing-extra-timeline"/);
  assert.match(indexHtml, /class="landing-progress-route"/);
  assert.match(clientCode, /--landing-rhythm-track-progress/);
  assert.match(clientCode, /querySelectorAll\("\.landing-extra-event"\)\.length > 3/);
  assert.match(memberJourneyStyles, /min-height:290svh/);
  assert.match(memberJourneyStyles, /aspect-ratio:16 \/ 10/);
  assert.match(memberJourneyStyles, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(indexHtml, /class="[^"]*(?:crawler|robot|seo-only|visually-hidden)[^"]*"/i);
  assert.doesNotMatch(indexHtml, /landing-escalation__act/);
  assert.doesNotMatch(indexHtml, /landing-war-target|landing-cwl-board|landing-cwl-assignments|landing-extra-token/);
  assert.doesNotMatch(indexHtml, /WAR PLAN|OPTED IN|Hero-down wars available|NEXT WAR|PLANNED ON DISCORD|EVERY PLAYER HAS A PLAN|BEFORE DAY 1|CLAN ACTIVE/);
});

test("crawlable landing fallbacks match the compact managed profile copy", () => {
  for (const phrase of [
    "One Discord. Every way to play.",
    "The whole clan family, at a glance.",
    "Plan together. Finish both attacks.",
    "Your league. Your spot. Full rewards.",
    "The clan stays active between wars.",
    "Reliable attacks open stronger lineups.",
    "Stay on Discord.",
    "Open an Introduction ticket with your #Tag. We'll find your TURTLE clan.",
  ]) {
    const exactPhrase = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    assert.match(indexHtml, exactPhrase);
    assert.match(clientCode, exactPhrase);
    assert.match(adminCode, exactPhrase);
  }

  for (const retiredPhrase of [
    "Join Discord. Share your #Tag. Join the Clan.",
    "Successful community.",
    "Enter the TURTLE-family.",
  ]) {
    const exactPhrase = new RegExp(retiredPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    assert.doesNotMatch(indexHtml, exactPhrase);
    assert.doesNotMatch(adminDefaults, exactPhrase);
  }
});

test("admin applies the legacy Home migration only to merged profile overrides", () => {
  const mergedProfileHelper = adminCode.match(/const getMergedProfileOverride_ = \(rootRaw\) => \{[\s\S]*?\n  \};/)?.[0] || "";
  const cwlSanitizer = adminCode.match(/const sanitizeCwlStatEntryLocal_ = \(entryRaw\) => \{[\s\S]*?\n  \};/)?.[0] || "";

  assert.match(mergedProfileHelper, /return migrateLegacyProfileOverride_\(out\);/);
  assert.doesNotMatch(cwlSanitizer, /migrateLegacyProfileOverride_/);
  assert.match(cwlSanitizer, /return out;/);
});

test("robots and sitemap expose the public root while private surfaces carry noindex", () => {
  assert.match(robotsTxt, /^User-agent: \*$/m);
  assert.match(robotsTxt, /^Allow: \/$/m);
  assert.match(robotsTxt, /^Disallow: \/api\/$/m);
  assert.doesNotMatch(robotsTxt, /^Disallow: \/(?:admin|console)/m);
  assert.match(robotsTxt, /^Sitemap: https:\/\/turtle\.qzz\.io\/sitemap\.xml$/m);
  assert.match(sitemapXml, /<loc>https:\/\/turtle\.qzz\.io\/<\/loc>/);
  assert.doesNotMatch(sitemapXml, /admin|console|api\//);
  assert.match(headersConfig, /\/admin[\s\S]*?X-Robots-Tag: noindex, nofollow, noarchive/);
  assert.match(headersConfig, /\/console[\s\S]*?X-Robots-Tag: noindex, nofollow, noarchive/);
  assert.match(adminHtml, /<meta name="robots" content="noindex, nofollow, noarchive"/);
  assert.match(consoleHtml, /<meta name="robots" content="noindex, nofollow, noarchive"/);
});

test("web manifest and icon set use the supplied TURTLE artwork at standard sizes", () => {
  assert.equal(manifest.name, "TURTLE Clash of Clans Clan Family");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512"]);
  assert.deepEqual(readPngDimensions("../cloudflarePages/favicon-16x16.png"), { width: 16, height: 16 });
  assert.deepEqual(readPngDimensions("../cloudflarePages/favicon-32x32.png"), { width: 32, height: 32 });
  assert.deepEqual(readPngDimensions("../cloudflarePages/apple-touch-icon.png"), { width: 180, height: 180 });
  assert.deepEqual(readPngDimensions("../cloudflarePages/android-chrome-192x192.png"), { width: 192, height: 192 });
  assert.deepEqual(readPngDimensions("../cloudflarePages/android-chrome-512x512.png"), { width: 512, height: 512 });
  const ico = fs.readFileSync(new URL("../cloudflarePages/favicon.ico", import.meta.url));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.ok(ico.readUInt16LE(4) >= 3, "expected a multi-size favicon");
});
