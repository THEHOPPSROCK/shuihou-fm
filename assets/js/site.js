/* ==========================================================================
   水喉FM · 页面交互
   ========================================================================== */
import { TICKER, SCHEDULE, STICKERS } from './data.js';
import { initChat, initExtras } from './chat.js';

/* --- 跑马灯 --------------------------------------------------------------- */
function buildTicker() {
  const track = document.querySelector('.ticker__track');
  if (!track) return;
  track.innerHTML = TICKER.map(([tag, text]) => `<span><b>${tag}</b>${text}</span>`).join('');
}

/* --- 首屏调频盘 ----------------------------------------------------------- */
function initDial() {
  const tune = document.querySelector('.hero__tune');
  if (!tune) return;
  const label = tune.querySelector('[data-tune-label]');
  const bars = [...tune.querySelectorAll('.scale i')];
  const presets = SCHEDULE.map((s) => `${s.time} ${s.title}`);
  bars.forEach((b, i) => {
    b.addEventListener('click', () => {
      bars.forEach((x, j) => x.classList.toggle('on', j <= i));
      const p = presets[Math.round((i / (bars.length - 1)) * (presets.length - 1))];
      if (label) label.textContent = p;
      tune.animate([{ transform: 'rotate(-3deg) scale(1.03)' }, { transform: 'rotate(-3deg) scale(1)' }], { duration: 220 });
    });
  });
}

/* --- 贴纸墙 → 送入直播室 -------------------------------------------------- */
function initStickerWall() {
  const rail = document.querySelector('#stkRail');
  if (!rail) return;
  rail.innerHTML = STICKERS.map((s) => `
    <figure class="stk" data-img="${s.img}" data-cap="${s.cap}" tabindex="0" role="button" aria-label="发送贴纸 ${s.cap}">
      <img src="assets/img/ip/${s.img}.webp" alt="${s.cap}">
      <figcaption>${s.cap}</figcaption>
    </figure>`).join('');
  const fire = (fig) => {
    document.querySelector('#studio')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => window.__SHFM__?.sendSticker(fig.dataset.img, fig.dataset.cap), 520);
  };
  rail.addEventListener('click', (e) => {
    const fig = e.target.closest('.stk');
    if (fig) fire(fig);
  });
  rail.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const fig = e.target.closest('.stk');
      if (fig) { e.preventDefault(); fire(fig); }
    }
  });
}

/* --- 导航高亮 ------------------------------------------------------------- */
function initNav() {
  const links = [...document.querySelectorAll('.topbar__nav a[href^="#"]')];
  const secs = links
    .map((a) => document.querySelector(a.getAttribute('href')))
    .filter(Boolean);
  if (!secs.length) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      const id = '#' + en.target.id;
      links.forEach((a) => a.classList.toggle('is-current', a.getAttribute('href') === id));
      links.forEach((a) => {
        if (a.getAttribute('href') === id) a.style.background = 'var(--yellow-soft)';
        else a.style.background = '';
      });
    });
  }, { rootMargin: '-30% 0px -60% 0px' });
  secs.forEach((s) => io.observe(s));
}

/* --- 键盘 / 快捷 ---------------------------------------------------------- */
function initKeys() {
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    if (e.key === '/' && !typing) {
      e.preventDefault();
      document.querySelector('#input')?.focus();
      document.querySelector('.hero__sub')?.scrollIntoView({ block: 'center' });
    }
  });
}

/* --- 首屏卡片轻微跟随 ----------------------------------------------------- */
function initTilt() {
  const stage = document.querySelector('.hero__stage');
  const card = stage?.querySelector('.cardip');
  if (!card || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  stage.addEventListener('pointermove', (e) => {
    const r = stage.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - .5;
    const y = (e.clientY - r.top) / r.height - .5;
    card.style.transform = `rotate(${-2.5 + x * 4}deg) translate(${x * 8}px, ${y * 8}px)`;
  });
  stage.addEventListener('pointerleave', () => { card.style.transform = ''; });
}

/* --- 人数 / 台标数字滚动（装饰） ------------------------------------------ */
function initCounters() {
  document.querySelectorAll('[data-count]').forEach((node) => {
    const target = Number(node.dataset.count);
    const suffix = node.dataset.suffix || '';
    const d = 900;
    const t0 = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / d);
      node.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/* --- 转人工：快捷拨号面板 ------------------------------------------------ */
function initDialer() {
  const sheet = document.querySelector('#dialer');
  const trigger = document.querySelector('#btnHotline');
  if (!sheet) return;

  let closing = null;
  const open = () => {
    clearTimeout(closing);
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('on'));
    sheet.querySelector('.dialer__sheet')?.focus({ preventScroll: true });
  };
  const close = () => {
    sheet.classList.remove('on');
    closing = setTimeout(() => { sheet.hidden = true; }, 280);
  };

  trigger?.addEventListener('click', (e) => {
    e.preventDefault();
    open();
  });
  sheet.querySelectorAll('[data-close]').forEach((n) => n.addEventListener('click', close));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) close();
  });
  // 撳「立即拨打」之后，等系统电话 App 接手，再收返面板
  sheet.querySelectorAll('a[href^="tel:"]').forEach((a) => {
    a.addEventListener('click', () => setTimeout(close, 450));
  });

  const copy = document.querySelector('#dialerCopy');
  copy?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText('0769-96968');
      copy.textContent = '已复制';
    } catch {
      copy.textContent = '复制唔到';
    }
    setTimeout(() => { copy.textContent = '复制号码'; }, 1600);
  });
}

/* --- 收纳目录（左栏抽屉） -------------------------------------------------- */
function initDrawer() {
  const drawer = document.querySelector('#drawer');
  const btn = document.querySelector('#btnMenu');
  if (!drawer) return;
  let closing = null;

  const open = () => {
    clearTimeout(closing);
    drawer.hidden = false;
    requestAnimationFrame(() => drawer.classList.add('on'));
    btn?.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    drawer.classList.remove('on');
    btn?.setAttribute('aria-expanded', 'false');
    closing = setTimeout(() => { drawer.hidden = true; }, 280);
  };

  btn?.addEventListener('click', () => (drawer.hidden ? open() : close()));
  drawer.querySelectorAll('[data-close]').forEach((n) => n.addEventListener('click', close));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !drawer.hidden) close();
  });
  window.__closeDrawer = close;
}

/* --- 启动 ----------------------------------------------------------------- */
buildTicker();
initDrawer();
initChat();
initExtras();
initDial();
initStickerWall();
initDialer();
initNav();
initKeys();
initTilt();
initCounters();



