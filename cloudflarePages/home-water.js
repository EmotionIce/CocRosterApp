/* One event-driven frame for the water, trail and existing Life enhancements. */
(() => {
  const root = document.querySelector('[data-landing-experience="observatory"]');
  if (!root || !window.matchMedia) return;
  const shell = root.querySelector('.landing-shell');
  const hero = root.querySelector('.landing-hero');
  const surface = root.querySelector('.water-surface');
  const svg = root.querySelector('.water-current');
  const flow = svg && svg.querySelector('.water-current__flow');
  if (!shell || !hero || !surface || !flow) return;
  const ns = 'http://www.w3.org/2000/svg';
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const story = root.querySelector('.landing-rhythm');
  const cards = Array.from(root.querySelectorAll('.landing-rhythm-chapter'));
  const cardSet = new Set(cards);
  const visibleCards = new Set();
  const headings = Array.from(root.querySelectorAll('.landing-discovery__intro .landing-eyebrow,.landing-family-overview__header .landing-eyebrow,.landing-rhythm__intro .landing-eyebrow,.landing-invitation .landing-eyebrow'));
  const track = svg.querySelector('.water-current__track');
  const bloom = svg.querySelector('.water-current__bloom');
  const head = svg.querySelector('.water-current__head');
  const branches = svg.querySelector('.water-current__branches');
  const ripples = svg.querySelector('.water-current__ripples');
  const waveBody = surface.querySelector('.water-surface__body');
  const waveEdge = surface.querySelector('.water-surface__edge');
  const waveBack = surface.querySelector('.water-surface__back');
  const echoes = Array.from(surface.querySelectorAll('.water-surface__echo'));
  const publicShell = root.closest('.public-shell');
  let observer = null;
  let layout = null;
  let dirty = true;
  let frame = 0;
  let lastWidth = 0;
  const clamp = value => Math.max(0, Math.min(1, value));
  const active = () => !document.hidden && !root.classList.contains('hidden');

  // Layout coordinates deliberately ignore entrance transforms and scroll depth.
  const box = node => {
    let x = 0, y = 0, current = node;
    while (current && current !== shell) {
      x += current.offsetLeft;
      y += current.offsetTop;
      current = current.offsetParent;
    }
    return { x, y, width: node.offsetWidth, height: node.offsetHeight };
  };
  const makeSvg = (name, attributes) => {
    const node = document.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  };
  const measure = () => {
    const width = shell.clientWidth;
    if (!width || !shell.offsetHeight) return;
    const heroBox = box(hero);
    const surfaceBox = box(surface);
    const orbit = root.querySelector('.observatory-orbit');
    const orbitBox = orbit ? box(orbit) : heroBox;
    const railX = width < 620 ? 7 : 22;
    const points = headings.map(node => {
      const bounds = box(node);
      return { node, y: bounds.y + bounds.height / 2 };
    });
    const cardLayouts = cards.map(node => ({ node, ...box(node) }));
    const branchPoints = cardLayouts.map(bounds => ({ y: bounds.y - 16, bounds }));
    const anchors = [...points, ...branchPoints].sort((a, b) => a.y - b.y);
    const startX = orbitBox.x + orbitBox.width / 2;
    const startY = heroBox.y + heroBox.height - 65;
    const firstY = Math.max(startY + 110, anchors[0] ? anchors[0].y : startY + 240);
    let path = `M ${startX} ${startY} C ${startX} ${startY + 100} ${railX} ${firstY - 90} ${railX} ${firstY}`;
    let previousY = firstY;
    for (const anchor of anchors) {
      const nextY = Math.max(previousY, anchor.y);
      const gap = nextY - previousY;
      if (gap > 1) path += ` C ${railX + 9} ${previousY + gap * .35} ${railX - 9} ${nextY - gap * .35} ${railX} ${nextY}`;
      previousY = nextY;
    }
    svg.setAttribute('viewBox', `0 0 ${width} ${shell.offsetHeight}`);
    for (const node of [flow, bloom, track]) node.setAttribute('d', path);
    const length = flow.getTotalLength();
    const samples = [];
    for (let i = 0; i <= 160; i++) {
      const at = flow.getPointAtLength(length * i / 160);
      samples.push({ x: at.x, y: at.y, fraction: i / 160 });
    }
    branches.replaceChildren();
    for (const point of branchPoints) {
      const bounds = point.bounds;
      const endX = bounds.x + 20;
      point.path = makeSvg('path', { d: `M ${railX} ${point.y} C ${railX + 24} ${point.y} ${endX} ${point.y} ${endX} ${bounds.y + 3}`, pathLength: 1 });
      branches.appendChild(point.path);
    }
    ripples.replaceChildren();
    for (const point of points) {
      point.ripple = makeSvg('ellipse', { cx: railX, cy: point.y, rx: 11, ry: 11 });
      point.mark = makeSvg('circle', { cx: railX, cy: point.y, r: 2.5, fill: '#d6f76d', opacity: '.2' });
      ripples.append(point.ripple, point.mark);
    }
    head.querySelector('circle').setAttribute('r', railX < 10 ? '13' : '22');
    layout = { width, railX, pageY: shell.getBoundingClientRect().top + window.scrollY, startY, endY: previousY, samples, points, branches: branchPoints, cards: cardLayouts, surface: surfaceBox };
    lastWidth = width;
    dirty = false;
    root.classList.add('water-ready');
  };
  // A cached lookup keeps the drawn end precisely aligned with the viewport.
  const atY = y => {
    const samples = layout.samples;
    let low = 0, high = samples.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (samples[mid].y < y) low = mid + 1;
      else high = mid;
    }
    const next = samples[low], previous = samples[Math.max(0, low - 1)];
    const blend = clamp((y - previous.y) / Math.max(.001, next.y - previous.y));
    return { x: previous.x + (next.x - previous.x) * blend, y: previous.y + (next.y - previous.y) * blend, fraction: previous.fraction + (next.fraction - previous.fraction) * blend };
  };
  const updateWave = progress => {
    const ease = progress * progress * (3 - 2 * progress);
    const crest = 118 - ease * 34;
    const depth = 80 - ease * 38;
    const curve = `M -20 ${crest} C 280 ${crest - depth} 580 ${crest + depth} 850 ${crest - 8} S 1220 ${crest - 45} 1460 ${crest - 18}`;
    waveBody.setAttribute('d', curve + ' L 1460 280 L -20 280 Z');
    waveEdge.setAttribute('d', curve);
    waveBack.setAttribute('d', `M -20 ${crest - 27} C 320 ${crest - depth - 24} 530 ${crest + depth - 32} 810 ${crest - 34} S 1170 ${crest - 88} 1460 ${crest - 55} L 1460 280 L -20 280 Z`);
    echoes.forEach((node, i) => {
      node.setAttribute('d', curve);
      node.setAttribute('transform', `translate(0 ${(i + 1) * (20 - ease * 5)})`);
    });
    surface.style.setProperty('--water-lift', (-ease * 24).toFixed(2) + 'px');
    surface.style.setProperty('--water-sheen', (ease * 36).toFixed(2) + 'px');
  };
  const render = () => {
    frame = 0;
    if (!active()) return;
    if (dirty) measure();
    if (!layout) return;
    const reduced = preference.matches;
    const viewY = window.scrollY - layout.pageY;
    const height = Math.max(1, window.innerHeight);
    const focusY = viewY + height * .68;
    const cursor = atY(focusY);
    for (const node of [flow, bloom]) {
      node.setAttribute('stroke-dasharray', reduced ? 'none' : '1');
      node.setAttribute('stroke-dashoffset', reduced ? '0' : (1 - cursor.fraction).toFixed(5));
    }
    head.setAttribute('transform', `translate(${cursor.x.toFixed(2)} ${cursor.y.toFixed(2)})`);
    svg.style.setProperty('--water-head-opacity', reduced || focusY < layout.startY || focusY > layout.endY + 80 ? '0' : '.85');
    for (const point of layout.branches) {
      point.path.setAttribute('stroke-dasharray', reduced ? 'none' : '1');
      point.path.setAttribute('stroke-dashoffset', reduced ? '0' : (1 - clamp((focusY - point.y + 20) / 140)).toFixed(3));
    }
    for (const point of layout.points) {
      const arrival = clamp((focusY - point.y + 50) / 220);
      const ring = Math.sin(arrival * Math.PI);
      point.ripple.setAttribute('rx', (7 + arrival * (layout.railX < 10 ? 5 : 18)).toFixed(2));
      point.ripple.setAttribute('ry', (11 + arrival * 12).toFixed(2));
      point.ripple.style.opacity = reduced ? '0' : (ring * .3).toFixed(3);
      point.mark.setAttribute('opacity', reduced ? '.25' : String(.15 + arrival * .6));
    }
    if (reduced || (layout.surface.y + layout.surface.height > viewY && layout.surface.y < viewY + height)) {
      updateWave(reduced ? .5 : clamp((viewY + height * .9 - layout.surface.y) / (layout.surface.height + height * .42)));
    }
    for (const bounds of layout.cards) {
      if (!reduced && !visibleCards.has(bounds.node)) continue;
      const distance = Math.max(-1, Math.min(1, (bounds.y + bounds.height / 2 - viewY - height / 2) / height));
      bounds.node.style.setProperty('--life-drift', reduced ? '0px' : (distance * 5).toFixed(2) + 'px');
      bounds.node.style.setProperty('--life-focus', reduced ? '.5' : (1 - Math.abs(distance)).toFixed(3));
    }
  };
  const schedule = () => {
    if (!frame && active() && (dirty || !preference.matches)) frame = window.requestAnimationFrame(render);
  };
  const invalidate = () => { dirty = true; schedule(); };
  const syncMotion = () => {
    if (observer) observer.disconnect();
    observer = null;
    visibleCards.clear();
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    root.classList.toggle('water-motion-reduced', preference.matches);
    if (story) story.classList.toggle('life-motion-ready', !preference.matches);
    const targets = [...cards, root.querySelector('.landing-rhythm__intro')].filter(Boolean);
    if (preference.matches || !window.IntersectionObserver) {
      targets.forEach(node => node.classList.add('is-life-revealed', 'is-life-in-view'));
    } else {
      observer = new window.IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) entry.target.classList.add('is-life-revealed');
          if (!cardSet.has(entry.target)) continue;
          entry.target.classList.toggle('is-life-in-view', entry.isIntersecting);
          if (entry.isIntersecting) visibleCards.add(entry.target);
          else visibleCards.delete(entry.target);
        }
        schedule();
      }, { threshold: .08 });
      targets.forEach(node => observer.observe(node));
    }
    invalidate();
  };

  // Reuse the already cached emblem; the reflection requires no extra asset.
  const orbit = root.querySelector('.observatory-orbit');
  const emblem = orbit && orbit.querySelector('.observatory-orbit__emblem');
  if (emblem) {
    const reflection = document.createElement('span');
    reflection.className = 'water-reflection';
    reflection.setAttribute('aria-hidden', 'true');
    const image = document.createElement('img');
    image.src = emblem.getAttribute('src');
    image.alt = '';
    image.width = emblem.width;
    image.height = emblem.height;
    reflection.appendChild(image);
    orbit.appendChild(reflection);
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', () => {
    if (shell.clientWidth !== lastWidth) dirty = true;
    schedule();
  }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && frame) { window.cancelAnimationFrame(frame); frame = 0; }
    else schedule();
  });
  if (preference.addEventListener) preference.addEventListener('change', syncMotion);
  else if (preference.addListener) preference.addListener(syncMotion);
  if (window.ResizeObserver) {
    const resize = new window.ResizeObserver(invalidate);
    resize.observe(shell);
    // Loading notices and header wrapping can move Home without resizing it.
    if (publicShell) resize.observe(publicShell);
  }
  if (window.MutationObserver && publicShell) {
    new window.MutationObserver(invalidate).observe(publicShell, { attributes: true, attributeFilter: ['data-active-view'] });
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(invalidate);
  window.addEventListener('pageshow', invalidate, { passive: true });
  syncMotion();
})();
