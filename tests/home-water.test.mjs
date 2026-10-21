import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../cloudflarePages/home-water.js', import.meta.url), 'utf8');
function preview(reduced = false, fine = true) {
  const make = (x = 0, y = 0, width = 100, height = 20) => {
    const classes = new Set(), attrs = new Map(), values = new Map(), events = new Map();
    return {
      offsetLeft: x, offsetTop: y, offsetWidth: width, offsetHeight: height,
      clientWidth: width, style: { setProperty: (key, value) => values.set(key, value), getPropertyValue: key => values.get(key) },
      classList: { add: (...keys) => keys.forEach(key => classes.add(key)), remove: key => classes.delete(key), contains: key => classes.has(key), toggle: (key, enabled) => enabled ? classes.add(key) : classes.delete(key) },
      attributeWrites: 0, rectReads: 0, events,
      addEventListener: (key, callback, options) => events.set(key, { callback, options }),
      setAttribute(key, value) { this.attributeWrites++; attrs.set(key, value); }, getAttribute: key => attrs.get(key),
      querySelector: () => null, querySelectorAll: () => [],
      pageTop: 80, replaceChildren() {}, appendChild() {}, append() {}, getBoundingClientRect() { this.rectReads++; return { top: this.pageTop - window.scrollY, left: 0 }; },
    };
  };
  const shell = make(0, 0, 1100, 4000), hero = make(0, 0, 1100, 600), surface = make(0, 512, 1100, 210);
  const root = make(), story = make(), publicShell = make(), svg = make(), orbitSystem = make(), family = make();
  const cards = [make(52, 2200, 500, 400), make(580, 2200, 500, 400), make(52, 2620, 500, 400), make(580, 2620, 500, 400)];
  const headings = [make(52, 760), make(52, 1300), make(52, 2070), make(580, 3500)];
  const intro = make();
  [...cards, ...headings, hero, surface, intro].forEach(node => node.offsetParent = shell);
  const nodes = new Map(['track', 'bloom', 'flow', 'head', 'branches', 'ripples'].map(key => [key, make()]));
  nodes.get('head').querySelector = () => make();
  let pointReads = 0;
  nodes.get('flow').getTotalLength = () => 3500;
  nodes.get('flow').getPointAtLength = length => { pointReads++; return { x: 22, y: 535 + length * .85 }; };
  svg.querySelector = selector => nodes.get(selector.replace('.water-current__', ''));
  surface.querySelector = () => make(); surface.querySelectorAll = () => [make(), make()];
  root.querySelector = selector => new Map([['.landing-shell', shell], ['.landing-hero', hero], ['.water-surface', surface], ['.water-current', svg], ['.landing-rhythm', story], ['.landing-rhythm__intro', intro], ['.observatory-orbit__system', orbitSystem], ['.landing-family-overview', family]]).get(selector) || null;
  root.querySelectorAll = selector => selector === '.landing-rhythm-chapter' ? cards : headings;
  root.closest = () => publicShell;
  const events = new Map(), frames = new Map(), resizeTargets = [];
  let nextFrame = 0, preferenceChange, resizeCallback, mutationCallback, intersectionCallback;
  const preference = { matches: reduced, addEventListener: (_, callback) => preferenceChange = callback };
  const document = { hidden: false, querySelector: () => root, createElementNS: () => make(), addEventListener: (key, callback) => events.set(key, { callback }) };
  const window = {
    innerHeight: 800, scrollY: 0, matchMedia: query => query.includes('prefers-reduced-motion') ? preference : { matches: fine },
    requestAnimationFrame: callback => { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id), addEventListener: (key, callback, options) => events.set(key, { callback, options }),
    IntersectionObserver: class { constructor(callback) { intersectionCallback = callback; } observe() {} disconnect() {} },
    ResizeObserver: class { constructor(callback) { resizeCallback = callback; } observe(node) { resizeTargets.push(node); } },
    MutationObserver: class { constructor(callback) { mutationCallback = callback; } observe() {} },
  };
  vm.runInNewContext(source, { document, window });
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); };
  return { shell, hero, cards, family, orbitSystem, publicShell, svg, root, nodes, frames, preference, window, document, events, resizeTargets, flush, reads: () => pointReads, intersect: entries => intersectionCallback(entries), resize: () => resizeCallback(), mutation: () => mutationCallback(), changeMotion: enabled => { preference.matches = enabled; preferenceChange(); } };
}

test('water scroll work is passive, coalesced and stops when idle', () => {
  const page = preview();
  page.flush();
  const reads = page.reads();
  assert.equal(page.frames.size, 0);
  assert.equal(page.events.get('scroll').options.passive, true);
  assert.equal(page.events.has('wheel'), false);
  assert.equal(page.events.has('touchmove'), false);
  for (let i = 0; i < 100; i++) page.events.get('scroll').callback();
  assert.equal(page.frames.size, 1);
  page.window.scrollY = 1400;
  page.flush();
  assert.equal(page.frames.size, 0);
  assert.equal(page.reads(), reads, 'scrolling reuses cached path geometry');
  const forward = Number(page.nodes.get('flow').getAttribute('stroke-dashoffset'));
  page.window.scrollY = 300;
  page.events.get('scroll').callback(); page.flush();
  assert.ok(Number(page.nodes.get('flow').getAttribute('stroke-dashoffset')) > forward, 'the current reverses with scroll');
});

test('layout changes and orientation rebuild the path once, browser bar changes reuse it', () => {
  const page = preview(); page.flush();
  const reads = page.reads();
  page.window.innerHeight = 650;
  page.events.get('resize').callback(); page.flush();
  assert.equal(page.reads(), reads);
  page.shell.clientWidth = 335; page.shell.offsetHeight = 5000;
  page.resize(); page.events.get('resize').callback();
  assert.equal(page.frames.size, 1);
  page.flush();
  assert.equal(page.svg.getAttribute('viewBox'), '0 0 335 5000');
  assert.equal(page.reads(), reads + 161);
});

test('reduced motion renders a static fallback and switches without leaving queued work', () => {
  const page = preview(true); page.flush();
  assert.equal(page.nodes.get('flow').getAttribute('stroke-dasharray'), 'none');
  page.events.get('scroll').callback();
  assert.equal(page.frames.size, 0);
  page.changeMotion(false);
  assert.equal(page.frames.size, 1);
  page.changeMotion(true);
  assert.equal(page.frames.size, 1, 'cancels the old frame before scheduling the static update');
  page.flush();
  assert.equal(page.frames.size, 0);
  assert.equal(page.nodes.get('flow').getAttribute('stroke-dashoffset'), '0');
});

test('loading notices moving Home refresh the scroll origin', () => {
  const page = preview();
  page.window.scrollY = 900; page.flush();
  assert.ok(page.resizeTargets.includes(page.publicShell));
  const before = page.nodes.get('head').getAttribute('transform');
  page.shell.pageTop += 100;
  page.resize(); page.flush();
  assert.notEqual(page.nodes.get('head').getAttribute('transform'), before);
  assert.equal(page.svg.getAttribute('viewBox'), '0 0 1100 4000');
});

test('Rosters navigation and background tabs suspend all water work', () => {
  const page = preview(); page.flush();
  assert.ok(page.root.classList.contains('is-home-active'));
  page.root.classList.add('hidden'); page.mutation();
  assert.equal(page.root.classList.contains('is-home-active'), false, 'CSS timelines pause outside Home');
  page.events.get('scroll').callback();
  assert.equal(page.frames.size, 0);
  page.root.classList.remove('hidden'); page.mutation();
  assert.equal(page.frames.size, 1);
  page.document.hidden = true; page.events.get('visibilitychange').callback();
  assert.equal(page.frames.size, 0);
  assert.equal(page.root.classList.contains('is-home-active'), false, 'CSS timelines pause in background tabs');
  page.document.hidden = false; page.events.get('visibilitychange').callback(); page.flush();
  assert.equal(page.frames.size, 0);
  assert.ok(page.root.classList.contains('water-ready'));
  assert.ok(page.root.classList.contains('is-home-active'));
});

test('hero pointer depth coalesces events without layout reads or water updates', () => {
  const page = preview(); page.flush();
  const geometryReads = page.reads(), rectReads = page.shell.rectReads, writes = page.nodes.get('flow').attributeWrites;
  const move = page.hero.events.get('pointermove');
  assert.equal(move.options.passive, true);
  for (let i = 0; i < 100; i++) move.callback({ clientX: 1100, clientY: 80 });
  assert.equal(page.frames.size, 1);
  page.flush();
  assert.equal(page.orbitSystem.style.getPropertyValue('--orbit-shift-x'), '9.00px');
  assert.equal(page.orbitSystem.style.getPropertyValue('--orbit-rotate-x'), '6.00deg');
  assert.equal(page.reads(), geometryReads);
  assert.equal(page.shell.rectReads, rectReads);
  assert.equal(page.nodes.get('flow').attributeWrites, writes, 'pointer motion does not repaint the water');
  assert.equal(page.frames.size, 0, 'no perpetual JS animation loop');
  page.hero.events.get('pointerleave').callback(); page.flush();
  assert.equal(page.orbitSystem.style.getPropertyValue('--orbit-shift-x'), '0.00px');
});

test('pointer depth stays off for touch, reduced motion and hidden Home', () => {
  const hiddenPage = preview();
  hiddenPage.flush();
  hiddenPage.hero.events.get('pointermove').callback({ pointerType: 'touch', clientX: 1000, clientY: 100 });
  assert.equal(hiddenPage.frames.size, 0, 'touch on a hybrid device does not animate pointer depth');
  hiddenPage.root.classList.add('hidden'); hiddenPage.mutation();
  for (const page of [preview(false, false), preview(true), hiddenPage]) {
    page.flush();
    page.hero.events.get('pointermove').callback({ clientX: 1000, clientY: 100 });
    assert.equal(page.frames.size, 0);
    assert.equal(page.orbitSystem.style.getPropertyValue('--orbit-shift-x'), '0.00px');
  }
  const page = preview(); page.flush();
  page.hero.events.get('pointermove').callback({ clientX: 1000, clientY: 100 }); page.flush();
  page.changeMotion(true); page.flush();
  assert.equal(page.orbitSystem.style.getPropertyValue('--orbit-rotate-y'), '0.00deg');
});

test('intersection state independently pauses the hero, family meters and Life scenes', () => {
  const page = preview(); page.flush();
  const targets = [page.hero, page.family, page.cards[0]];
  const classes = ['is-hero-in-view', 'is-family-in-view', 'is-life-in-view'];
  page.intersect(targets.map(target => ({ target, isIntersecting: true }))); page.flush();
  targets.forEach((target, i) => assert.ok(target.classList.contains(classes[i])));
  page.intersect(targets.map(target => ({ target, isIntersecting: false }))); page.flush();
  targets.forEach((target, i) => assert.equal(target.classList.contains(classes[i]), false));
  assert.equal(page.frames.size, 0);
});
