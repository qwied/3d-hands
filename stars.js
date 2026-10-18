// Quiet star field behind the page: small dots, slow twinkle, a rare drift.
(() => {
  const canvas = document.getElementById('stars');
  const g = canvas.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let stars = [], w = 0, h = 0, dpr = 1;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(w * h / 5200);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() < 0.92 ? 0.35 + Math.random() * 0.5 : 0.9 + Math.random() * 0.5,
      a: 0.25 + Math.random() * 0.6,
      speed: 0.4 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2,
    }));
  }

  function draw(t) {
    g.clearRect(0, 0, w, h);
    for (const s of stars) {
      const tw = reduce ? 1 : 0.65 + 0.35 * Math.sin(t / 1000 * s.speed + s.phase);
      g.globalAlpha = s.a * tw;
      g.beginPath();
      g.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      g.fillStyle = '#fff';
      g.fill();
    }
    g.globalAlpha = 1;
    if (!reduce) requestAnimationFrame(draw);
  }

  window.addEventListener('resize', () => { resize(); if (reduce) draw(0); });
  resize();
  requestAnimationFrame(draw);
})();
