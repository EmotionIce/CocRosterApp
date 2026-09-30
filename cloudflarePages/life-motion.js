/* Small, progressive enhancements: native scrolling, visible content, no render loop. */
(() => {
  const root = document.querySelector('[data-landing-experience="observatory"]');
  const story = root && root.querySelector('.landing-rhythm');
  if (!story || !window.IntersectionObserver || !window.matchMedia) return;

  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const cards = Array.from(story.querySelectorAll('.landing-rhythm-chapter'));
  const intro = story.querySelector('.landing-rhythm__intro');
  const visible = new Set();
  let observer = null;
  let frame = 0;

  const update = () => {
    frame = 0;
    if (preference.matches || document.hidden || root.classList.contains('hidden')) return;
    const height = Math.max(1, window.innerHeight);
    for (const card of visible) {
      const bounds = card.getBoundingClientRect();
      const distance = Math.max(-1, Math.min(1, (bounds.top + bounds.height / 2 - height / 2) / height));
      card.style.setProperty('--life-drift', (distance * 8).toFixed(2) + 'px');
      card.style.setProperty('--life-focus', (1 - Math.abs(distance)).toFixed(3));
    }
  };
  const schedule = () => {
    if (!frame && visible.size && !preference.matches && !document.hidden) frame = window.requestAnimationFrame(update);
  };
  const sync = () => {
    if (observer) observer.disconnect();
    observer = null;
    visible.clear();
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    story.classList.toggle('life-motion-ready', !preference.matches);
    for (const card of cards) {
      card.classList.remove('is-life-in-view');
      card.style.removeProperty('--life-drift');
      card.style.removeProperty('--life-focus');
    }
    if (preference.matches) return;
    observer = new window.IntersectionObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target;
        if (entry.isIntersecting) target.classList.add('is-life-revealed');
        if (!cards.includes(target)) continue;
        target.classList.toggle('is-life-in-view', entry.isIntersecting);
        if (entry.isIntersecting) visible.add(target);
        else visible.delete(target);
      }
      schedule();
    }, { threshold: 0.12 });
    for (const card of cards) observer.observe(card);
    if (intro) observer.observe(intro);
  };

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  document.addEventListener('visibilitychange', schedule);
  preference.addEventListener('change', sync);
  sync();
})();
