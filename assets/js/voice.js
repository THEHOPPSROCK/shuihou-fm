/* ==========================================================================
   水喉FM · 声线试镜：自制播放器 + 盲测
   ========================================================================== */
(function () {
  const audio = new Audio();
  audio.preload = 'none';
  let current = null;

  const fmt = (s) => {
    if (!isFinite(s) || s <= 0) return '0:00';
    const m = Math.floor(s / 60);
    const r = Math.round(s % 60);
    return m + ':' + String(r).padStart(2, '0');
  };

  const players = [...document.querySelectorAll('.vplay')];

  function ui(p) {
    return {
      btn: p.querySelector('.vplay__btn'),
      bar: p.querySelector('.vplay__bar'),
      fill: p.querySelector('.vplay__bar i'),
      time: p.querySelector('.vplay__time'),
    };
  }

  function reset(p) {
    const u = ui(p);
    p.classList.remove('is-playing');
    u.fill.style.width = '0%';
    u.time.textContent = fmt(parseFloat(p.dataset.dur || '0'));
    u.btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  }

  function stopAll() {
    if (current) reset(current);
    audio.pause();
  }

  audio.addEventListener('timeupdate', () => {
    if (!current) return;
    const u = ui(current);
    const total = audio.duration || parseFloat(current.dataset.dur || 0);
    const pct = total ? (audio.currentTime / total) * 100 : 0;
    u.fill.style.width = pct.toFixed(2) + '%';
    u.time.textContent = fmt(total - audio.currentTime);
  });

  audio.addEventListener('ended', () => {
    if (current) reset(current);
    current = null;
  });

  audio.addEventListener('pause', () => {
    if (current && !audio.ended) {
      current.classList.remove('is-playing');
      ui(current).btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    }
  });

  function play(p) {
    const u = ui(p);
    if (current && current !== p) reset(current);
    current = p;
    if (audio.src !== new URL(p.dataset.audio, location.href).href) {
      audio.src = p.dataset.audio;
    }
    audio.play().then(() => {
      p.classList.add('is-playing');
      u.btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
    }).catch(() => reset(p));
  }

  players.forEach((p) => {
    const u = ui(p);
    reset(p);
    u.btn.addEventListener('click', () => {
      if (current === p && !audio.paused) {
        audio.pause();
        return;
      }
      play(p);
    });
    u.bar.addEventListener('click', (e) => {
      const rect = u.bar.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const total = parseFloat(p.dataset.dur || 0);
      const seek = () => { try { audio.currentTime = ratio * (audio.duration || total); } catch {} };
      if (current === p && audio.readyState >= 1) seek();
      else {
        play(p);
        audio.addEventListener('loadedmetadata', seek, { once: true });
        setTimeout(seek, 350);
      }
    });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audio.pause();
  });

  /* --- 盲测模式：隐藏名字 / F0，并打乱顺序（留白卡固定放最后） --- */
  const blindBtn = document.getElementById('blindBtn');
  const grid = document.querySelector('.vc-grid');
  const placeholder = grid ? grid.querySelector('.vc--placeholder') : null;
  const cards = grid ? [...grid.querySelectorAll('.vc:not(.vc--placeholder)')] : [];

  blindBtn?.addEventListener('click', () => {
    const on = document.body.classList.toggle('blind');
    blindBtn.setAttribute('aria-pressed', String(on));
    blindBtn.innerHTML = on ? '返回排位<em class="btn__en">ORDER</em>' : '盲测模式<em class="btn__en">BLIND</em>';
    if (on) {
      stopAll();
      const shuffled = [...cards].sort(() => Math.random() - 0.5);
      shuffled.forEach((n) => grid.appendChild(n));
      if (placeholder) grid.appendChild(placeholder);
    } else {
      cards.forEach((n) => grid.appendChild(n));
      if (placeholder) grid.appendChild(placeholder);
    }
  });
})();
