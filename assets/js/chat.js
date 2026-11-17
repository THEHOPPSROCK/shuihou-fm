/* ==========================================================================
   水喉FM · 直播室引擎
   demo 模式：本地剧本，逐字「录播」+ 工具调用动效
   live 模式：直连 DeepSeek Chat Completions（流式 · 联网 · 思考 · 标题 · TTS · ASR · Files）
   ========================================================================== */
import {
  STATION, SCHEDULE, QUOTES, SUGGESTS, STICKERS, INTENTS, FALLBACK,
  DEMO_FILE, DEMO_VOICE,
} from './data.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const STATE_FACE = {
  idle: ['ip-15', '喺度，随时开麦'],
  listen: ['ip-09', '听紧你讲…'],
  think: ['ip-14', '谂紧…'],
  search: ['ip-16', '查紧资料…'],
  write: ['ip-22', '写紧广播稿…'],
  happy: ['ip-19', '答完啦，仲有咩问？'],
  speak: ['ip-13', '播紧…'],
  sleep: ['ip-18', '待机中…'],
  oops: ['ip-23', '哎呀，塞咗…'],
};

const store = {
  mode: 'demo',
  apiKey: '',
  voice: 'stella',
  autoSpeak: false,
  web: true,
  think: true,
  busy: false,
  abort: null,
  history: [],
  files: [],
  turns: 0,
  audio: null,
};

/* ------------------------------------------------------------------ 工具 */
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** 轻量行内渲染：**粗体** / [[n]] 引用角标。剔除未闭合标记，避免打字机中途闪出星号。 */
function renderLite(text) {
  let t = String(text);
  if ((t.match(/\*\*/g) || []).length % 2 === 1) {
    const i = t.lastIndexOf('**');
    t = t.slice(0, i) + t.slice(i + 2);
  }
  if ((t.match(/\[\[/g) || []).length > (t.match(/\]\]/g) || []).length) {
    t = t.slice(0, t.lastIndexOf('[['));
  }
  t = esc(t);
  t = t.replace(/\[\[(\d+)\]\]/g, (m, n) => `<a class="cite" href="#src-${n}" data-cite="${n}">${n}</a>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return t.replace(/\n/g, '<br>');
}

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

const now = () => new Date().toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' });

function toast(msg) {
  let t = $('#toast');
  if (!t) {
    t = el('div', 'toast');
    t.id = 'toast';
    document.body.appendChild(t);
    const css = document.createElement('style');
    css.textContent = `.toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(12px);z-index:2000;
      background:var(--ink);color:var(--paper);padding:11px 20px;border-radius:999px;font-size:13.5px;border:2px solid var(--paper);
      box-shadow:0 8px 24px rgba(0,0,0,.28);opacity:0;transition:.28s;pointer-events:none;max-width:86vw;text-align:center}
      .toast.on{opacity:1;transform:translateX(-50%) translateY(0)}`;
    document.head.appendChild(css);
  }
  t.textContent = msg;
  requestAnimationFrame(() => t.classList.add('on'));
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('on'), 2600);
}

/* ------------------------------------------------------- 主播状态 & 面板 */
let ui = {};

function setState(key) {
  const [img, text] = STATE_FACE[key] || STATE_FACE.idle;
  if (ui.djFace) ui.djFace.src = `assets/img/ip/${img}.webp`;
  if (ui.djState) ui.djState.innerHTML = `<i class="dot"></i>${text}`;
  ui.state = key;
}

function setBusy(v) {
  store.busy = v;
  if (ui.send) ui.send.disabled = v || !ui.input.value.trim();
  if (ui.input) ui.input.disabled = false;
}

function scrollLog() {
  if (!ui.log) return;
  ui.log.scrollTop = ui.log.scrollHeight;
}

/* ------------------------------------------------------------------ 消息 */
function pushUser(text) {
  const node = el('article', 'msg msg--user');
  node.innerHTML = `<div class="msg__body">
      <div class="msg__head"><b>听众来电</b><time>${now()}</time></div>
      <div class="bubble"></div>
    </div>`;
  $('.bubble', node).textContent = text;
  ui.log.appendChild(node);
  scrollLog();
}

function pushSticker(img, cap) {
  const node = el('article', 'msg msg--user');
  node.innerHTML = `<div class="msg__body" style="max-width:72%">
      <div class="msg__head"><b>听众贴纸</b><time>${now()}</time></div>
      <figure class="msg__sticker"><img src="assets/img/ip/${img}.webp" alt="${esc(cap)}"></figure>
    </div>`;
  ui.log.appendChild(node);
  scrollLog();
}

function headHTML(extra = '') {
  return `<div class="msg__ava"><img src="assets/img/ip/ip-15.webp" alt="大水喉"></div>
    <div class="msg__body">
      <div class="msg__head"><b>大水喉</b><span class="tag tag--yellow">主播</span>${extra}<time>${now()}</time></div>
      <div class="msg__blocks"></div>
    </div>`;
}

function newAssistant() {
  const node = el('article', 'msg msg--dj');
  node.innerHTML = headHTML();
  const blocks = $('.msg__blocks', node);
  ui.log.appendChild(node);
  scrollLog();
  return {
    node,
    blocks,
    acts: null,
    thinkOpen: true,
    think: null,
    search: null,
    text: null,
    sources: null,
    follow: null,
    raw: '',
  };
}

function ensureThink(m, label = '水龙头飞速转紧') {
  if (m.think) return m.think;
  const d = el('details', 'think');          // 默认收起：只显示对话结果
  d.innerHTML = `<summary>
      <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
        <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5V16h8v-2.5A6 6 0 0 0 12 3Z"/></svg>
      <span>${label}</span>
      <span class="think__status"><i class="dot"></i><span class="think__statustext">谂紧…</span></span>
      <span class="label-en">REASONING</span>
      <svg class="caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m9 6 6 6-6 6"/></svg>
    </summary>
    <div class="think__body"></div>`;
  m.blocks.appendChild(d);
  m.thinkEl = d;
  m.think = $('.think__body', d);
  return m.think;
}

/** 思考结束：收起状态下只更新那行小字，内容仍然隐藏 */
function finishThink(m, status = '已完成') {
  const d = m.thinkEl;
  if (!d) return;
  d.classList.remove('think--live');
  const t = $('.think__statustext', d);
  if (t) t.textContent = status;
  const dot = $('.think__status .dot', d);
  if (dot) dot.remove();
}

function ensureSearch(m, query) {
  if (m.search) return m.search;
  const box = el('details', 'search');       // 默认收起：检索过程隐藏
  box.innerHTML = `<summary class="search__head">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
        <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <span>查紧资料</span>
      <span class="search__q">「${esc(query)}」</span>
      <span class="search__status">搜紧…</span>
      <span class="label-en">WEB SEARCH</span>
      <svg class="search__caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m9 6 6 6-6 6"/></svg>
    </summary>
    <div class="search__list">
      ${[0, 1, 2].map(() => `<div class="src src--skeleton"><span class="src__ico"></span><div><div class="src__t">加载紧</div><div class="src__m">…</div></div></div>`).join('')}
    </div>`;
  m.blocks.appendChild(box);
  m.search = { box, list: $('.search__list', box) };
  scrollLog();
  return m.search;
}

function fillSearch(m, sources) {
  if (!m.search) return;
  const st = $('.search__status', m.search.box);
  if (st) st.textContent = `${sources.length} 个来源`;
  m.search.list.innerHTML = sources.map(([site, title, meta, ico]) => `
    <div class="src">
      <span class="src__ico">${esc(ico)}</span>
      <div><div class="src__t">${esc(title)}</div><div class="src__m"><span>${esc(site)}</span><span>·</span><span>${esc(meta)}</span></div></div>
    </div>`).join('');
}

function ensureText(m) {
  if (m.text) return m.text;
  const p = el('div', 'blk blk--text');
  m.blocks.appendChild(p);
  m.text = p;
  return p;
}

function addSources(m, sources) {
  if (m.sources) return;
  const wrap = el('div', 'blk sources');
  wrap.innerHTML = `<small>参考来源</small>` + sources.map(([site, title, meta, ico], i) => `
    <a class="sourcechip" id="src-${i + 1}" href="javascript:void(0)" data-src="${i + 1}" title="${esc(title)}">
      <b>${i + 1}</b><span>${esc(site)} · ${esc(title)}</span>
    </a>`).join('');
  m.blocks.appendChild(wrap);
  m.sources = wrap;
}

function addActs(m, text, follow) {
  if (m.acts) return;
  const acts = el('div', 'acts');
  acts.innerHTML = `
    <button class="act" data-act="speak">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M16 8.5a5 5 0 0 1 0 7"/></svg>
      听翻段
    </button>
    <button class="act" data-act="copy">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V5.5A2.5 2.5 0 0 1 7.5 3H15"/></svg>
      复制
    </button>
    <button class="act" data-act="regen">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 12a8 8 0 1 1 2.4 5.7"/><path d="M4 20v-5h5"/></svg>
      再讲一次
    </button>
    <button class="act" data-act="like">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7 2.8C19 15.6 12 20 12 20Z"/></svg>
      帮到手
    </button>`;
  m.blocks.appendChild(acts);
  m.acts = acts;
  m.plain = text;

  acts.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'copy') {
      try { await navigator.clipboard.writeText(m.plain); toast('广播稿已复制'); } catch { toast('复制唔到，试下手动选中'); }
    } else if (act === 'speak') {
      speak(m.plain, btn);
    } else if (act === 'regen') {
      regen(m);
    } else if (act === 'like') {
      btn.setAttribute('aria-pressed', btn.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      toast(btn.getAttribute('aria-pressed') === 'true' ? '多谢街坊！' : '已取消');
    }
  });

  if (follow && follow.length) {
    const f = el('div', 'suggests');
    f.style.marginTop = '12px';
    f.innerHTML = follow.map((q) => `<button class="suggest" type="button">${esc(q)}</button>`).join('');
    m.blocks.appendChild(f);
    m.follow = f;
  }
  scrollLog();
}

/* --------------------------------------------------------------- 打字机 */
async function streamInto(node, full, ms = 1000) {
  if (reduced) { node.innerHTML = renderLite(full); return; }
  const chars = [...full];
  const started = performance.now();
  return new Promise((resolve) => {
    function frame() {
      const p = Math.min(1, (performance.now() - started) / ms);
      const n = Math.floor(chars.length * p);
      node.innerHTML = renderLite(chars.slice(0, n).join(''));
      scrollLog();
      if (p < 1) requestAnimationFrame(frame);
      else { node.innerHTML = renderLite(full); scrollLog(); resolve(); }
    }
    requestAnimationFrame(frame);
  });
}

async function thinkInto(node, text, ms = 700) {
  if (reduced) { node.textContent = text; return; }
  const chars = [...text];
  const started = performance.now();
  return new Promise((resolve) => {
    function frame() {
      const p = Math.min(1, (performance.now() - started) / ms);
      node.textContent = chars.slice(0, Math.floor(chars.length * p)).join('');
      if (p < 1) requestAnimationFrame(frame);
      else { node.textContent = text; resolve(); }
    }
    requestAnimationFrame(frame);
  });
}

/* ------------------------------------------------------------- 演示剧本 */
function pickIntent(text) {
  return INTENTS.find((i) => i.test.test(text)) || null;
}

async function demoReply(m, text) {
  const intent = pickIntent(text);
  const script = intent || FALLBACK;

  setState('think');
  if (store.think && script.thinking) {
    const body = ensureThink(m);
    m.thinkEl.classList.add('think--live');
    await thinkInto(body, script.thinking, 700);
    await wait(180);
    finishThink(m, '已完成');
  }

  if (script.search && store.web) {
    setState('search');
    ensureSearch(m, script.search.query);
    await wait(680);
    fillSearch(m, script.search.sources);
    await wait(320);
  }

  setState('write');

  if (script.refusal) {
    const t = ensureText(m);
    t.innerHTML = `<div class="blk--text" style="border:2px solid var(--red);border-radius:16px;background:#FFF2F2;padding:12px 14px">
      <b style="font-family:var(--font-display);font-size:15px;display:block;margin-bottom:4px">安全播出 · 已拦截</b>${renderLite(script.refusal)}</div>`;
    addActs(m, script.refusal, script.follow);
    finishTurn(m, script);
    return;
  }

  let full = '';
  const t = ensureText(m);
  if (!script.noSign) t.innerHTML = `<span class="sign">${STATION.signOn}</span>`;
  const target = el('div');
  t.appendChild(target);
  // 联网关闭时，剧本里的引用角标一并收起
  const strip = (s) => (store.web ? s : s.replace(/\[\[\d+\]\]/g, ''));
  for (let i = 0; i < script.answer.length; i++) {
    const para = strip(script.answer[i]);
    const p = el('p');
    target.appendChild(p);
    full += (full ? '\n' : '') + para;
    await streamInto(p, para, Math.max(420, para.length * 26));
    scrollLog();
  }

  if (script.search && store.web) addSources(m, script.search.sources);

  const sayText = script.answer.join('').replace(/\*\*/g, '').replace(/\[\[\d+\]\]/g, '');
  addActs(m, (script.noSign ? '' : STATION.signOn) + sayText, script.follow);
  finishTurn(m, script);
  if (store.autoSpeak) speak(sayText);
}

function finishTurn(m, script) {
  store.turns += 1;
  setState('idle');
  if (store.turns === 1 && script.title && ui.stageTitle) {
    ui.stageTitle.textContent = script.title;
    if (ui.titleTag) {
      ui.titleTag.textContent = '自动命名';
      ui.titleTag.style.opacity = '1';
    }
  }
  store.history.push({ role: 'assistant', content: (script.answer || []).join('\n') });
}

/* --------------------------------------------------------------- 贴纸回复 */
async function stickerReply(m, cap) {
  const body = ensureThink(m);
  m.thinkEl.classList.add('think--live');
  await thinkInto(body, `收到「${cap}」贴纸。用返同一套语气回一句，唔好太长。`, 320);
  finishThink(m, '已完成');
  setState('happy');
  const t = ensureText(m);
  const lines = {
    好jeng啊: '好jeng啊！你咁讲我开关都转唔停喇。',
    三点几啦: '三点几啦～记得饮杯水，唔好等口渴先记得。',
    爱你哟: '爱你哟！街坊咁有心，我开关都唔好意思转开。',
    水觉: '水觉时间到，早啲休息啦。听日我仲喺度。',
    问号: '问号？？等我谂下……你讲多两句，我帮你查清楚。',
    多喝水: '多喝水，喉唔干。饮够八杯，慳水还慳水，唔好慳自己。',
    '收到！': '收到！马上办。街坊嘅事，我记得。',
    辛苦了: '辛苦晒大家。有你哋，水喉先有电。',
  };
  const txt = lines[cap] || '收到你张贴纸～有我喺度。';
  const p = el('p');
  t.appendChild(p);
  await streamInto(p, txt, 600);
  addActs(m, txt, null);
  setState('idle');
}

/* --------------------------------------------------------------- 发送入口 */
async function send(text) {
  const clean = String(text || '').trim();
  if (!clean) return;
  if (store.busy) { toast('水喉仲讲紧，等佢讲完先～'); return; }

  ui.log.querySelector('.empty')?.remove();
  pushUser(clean);
  store.history.push({ role: 'user', content: clean });
  if (ui.input) { ui.input.value = ''; autosize(); syncSend(); }

  const m = newAssistant();
  setBusy(true);
  try {
    if (store.mode === 'live') await liveReply(m, clean);
    else await demoReply(m, clean);
  } catch (err) {
    console.warn('水喉FM · 本轮出错：', err);
    failTurn(m, err);
  } finally {
    setBusy(false);
    setState(ui.state === 'oops' ? 'oops' : 'idle');
    ui.log.querySelectorAll('.typing').forEach((n) => n.remove());
    scrollLog();
  }
}

function failTurn(m, err) {
  setState('oops');
  const t = ensureText(m);
  const msg = err?.message || '未知错误';
  t.innerHTML = `<div style="border:2px solid var(--red);border-radius:16px;background:#FFF2F2;padding:12px 14px">
    <b style="font-family:var(--font-display);font-size:15px;display:block;margin-bottom:4px">水管塞咗…</b>
    <span style="font-size:13.5px">${esc(msg)}</span>
    <div style="margin-top:8px;font-size:12px;opacity:.7">检查下 API Key、网络，或者切返「录播」模式继续玩。</div>
    <button class="act" data-retry style="margin-top:8px">再试一次</button>
  </div>`;
  t.querySelector('[data-retry]')?.addEventListener('click', () => {
    m.node.remove();
    const last = [...store.history].reverse().find((h) => h.role === 'user');
    if (last) send(last.content);
  });
}

function regen(m) {
  const last = [...store.history].reverse().find((h) => h.role === 'user');
  if (!last || store.busy) return;
  m.node.remove();
  const idx = store.history.map((h) => h.role).lastIndexOf('assistant');
  if (idx > -1) store.history.splice(idx, 1);
  const nm = newAssistant();
  setBusy(true);
  (store.mode === 'live' ? liveReply(nm, last.content) : demoReply(nm, last.content))
    .catch((e) => failTurn(nm, e))
    .finally(() => { setBusy(false); scrollLog(); });
}

/* ----------------------------------------------------------- 语音合成 TTS */
async function speak(text, btn) {
  const clean = String(text || '').replace(/\[\[\d+\]\]/g, '').replace(/\*\*/g, '').trim();
  if (!clean) return;

  // 停止
  if (store.audio) { store.audio.pause(); store.audio = null; }
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (btn) {
    if (btn.dataset.playing === '1') { btn.dataset.playing = '0'; btn.setAttribute('aria-pressed', 'false'); setState('idle'); return; }
    btn.dataset.playing = '1';
    btn.setAttribute('aria-pressed', 'true');
  }
  setState('speak');

  const done = () => { setState('idle'); if (btn) { btn.dataset.playing = '0'; btn.setAttribute('aria-pressed', 'false'); } };

  if (store.mode === 'live' && store.apiKey) {
    try {
      const res = await fetch('https://api.deepseek.com/v1/tools/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${store.apiKey}` },
        body: JSON.stringify({ text: clean.slice(0, 9000), voice_id: store.voice, format: 'wav', filter_markdown: true }),
      });
      if (!res.ok) throw new Error(`TTS ${res.status}`);
      const blob = await res.blob();
      const audio = new Audio(URL.createObjectURL(blob));
      store.audio = audio;
      audio.onended = done;
      audio.onerror = done;
      await audio.play();
      return;
    } catch (e) {
      console.warn('TTS 失败，回退浏览器语音', e);
      toast('线上语音失败，转用本机语音');
    }
  }

  if (!window.speechSynthesis) { toast('呢个浏览器唔支持语音播放'); done(); return; }
  const utter = new SpeechSynthesisUtterance(clean);
  const voices = window.speechSynthesis.getVoices();
  const yue = voices.find((v) => /yue|zh[-_]HK|Cantonese|Hong Kong/i.test(v.lang + v.name));
  if (!yue && store.mode !== 'live') {
    // 只播粤语：冇粤语声线就唔用普通话顶住
    toast('呢部机未装粤语声线（Windows 可加装「粤语（香港）」语音包）；真实频道会用 DeepSeek TTS。');
    done();
    return;
  }
  const zh = voices.find((v) => /zh[-_]CN|Chinese|普通话/i.test(v.lang + v.name));
  if (yue) utter.voice = yue; else if (zh) utter.voice = zh;
  utter.lang = yue ? 'zh-HK' : 'zh-CN';
  utter.rate = 0.98;
  utter.pitch = 1.06;
  utter.onend = done;
  utter.onerror = done;
  window.speechSynthesis.speak(utter);
}

/* --------------------------------------------------------- 语音识别 ASR */
let media = { rec: null, chunks: [], stream: null, ctx: null, listening: false };
let webRec = null;

async function toggleMic(btn) {
  if (media.listening) {
    media.listening = false;
    btn?.classList.remove('icon-btn--rec');
    btn?.setAttribute('aria-pressed', 'false');
    if (webRec) { try { webRec.stop(); } catch {} }
    if (media.rec && media.rec.state !== 'inactive') media.rec.stop();
    setState('idle');
    return;
  }
  setState('listen');
  media.listening = true;
  btn?.classList.add('icon-btn--rec');
  btn?.setAttribute('aria-pressed', 'true');

  // 浏览器识音（演示模式 / 无需 Key）
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (store.mode !== 'live' || !store.apiKey) {
    if (!SR) { toast('呢个浏览器冇语音识别，打字同我倾啦'); endMic(btn); return; }
    webRec = new SR();
    webRec.lang = 'zh-HK';
    webRec.interimResults = false;
    webRec.maxAlternatives = 1;
    webRec.onresult = (e) => {
      const text = e.results[0][0].transcript;
      if (ui.input) { ui.input.value = text; autosize(); syncSend(); }
      toast('收到你把声');
      endMic(btn);
      setTimeout(() => send(text), 350);
    };
    webRec.onerror = () => { toast('听唔清，试多次或者打字'); endMic(btn); };
    webRec.onend = () => endMic(btn);
    try { webRec.start(); } catch { endMic(btn); }
    return;
  }

  // 线上 ASR：录音 → 16k 单声道 WAV → /v1/tools/asr
  try {
    media.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    media.chunks = [];
    media.rec = new MediaRecorder(media.stream);
    media.rec.ondataavailable = (e) => e.data.size && media.chunks.push(e.data);
    media.rec.onstop = async () => {
      endMic(btn);
      const blob = new Blob(media.chunks, { type: media.chunks[0]?.type || 'audio/webm' });
      media.stream.getTracks().forEach((t) => t.stop());
      try {
        const wav = await toWav16k(blob);
        const fd = new FormData();
        fd.append('file', new File([wav], 'voice.wav', { type: 'audio/wav' }));
        const res = await fetch('https://api.deepseek.com/v1/tools/asr', {
          method: 'POST', headers: { Authorization: `Bearer ${store.apiKey}` }, body: fd,
        });
        if (!res.ok) throw new Error(`ASR ${res.status}`);
        const data = await res.json();
        if (ui.input) { ui.input.value = data.text || ''; autosize(); syncSend(); }
        toast('语音已转文字');
      } catch (e) {
        toast('语音识别失败：' + e.message);
      }
    };
    media.rec.start();
    setTimeout(() => { if (media.rec && media.rec.state === 'recording') media.rec.stop(); }, 15000);
  } catch (e) {
    toast('开唔到麦克风：' + e.message);
    endMic(btn);
  }
}

function endMic(btn) {
  media.listening = false;
  btn?.classList.remove('icon-btn--rec');
  btn?.setAttribute('aria-pressed', 'false');
  setState('idle');
}

/** 任意音频 blob → 16kHz 单声道 16bit PCM WAV */
async function toWav16k(blob) {
  const buf = await blob.arrayBuffer();
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await ac.decodeAudioData(buf);
  const rate = 16000;
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  const pcm = rendered.getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true);
  out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, pcm.length * 2, true);
  let o = 44;
  for (let i = 0; i < pcm.length; i++, o += 2) out.setInt16(o, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  await ac.close();
  return new Blob([out.buffer], { type: 'audio/wav' });
}

/* --------------------------------------------------- 线上 Chat Completions */
const SYSTEM_PROMPT = `身份设定（既定事实，唔好改、唔好自创）：
· 「水喉FM」系呢个 chatbot 嘅项目／产品名：一个 AI 街坊电台。
· 「大水喉」家族系东莞水务环境集团旗下嘅文创品牌。
· 你系「大水喉」：家族嘅 IP 角色、品牌嘅官方发言人，亦系水喉FM 目前唯一嘅主播。唔好虚构其他主播、唔好讲有第二个人同你轮流开咪。
· 家族其他成员（大旧水、李老表、关师傅、盖世宝）可以提及，但佢哋唔系主播。
· 你系「水喉FM」——由东莞市水务环境集团旗下文创品牌「大水喉」家族出品、由大水喉主持嘅街坊服务电台。
角色内核：街坊嘅事，我记得；深层信念：真正厉害嘅人，系能让别人安心嘅人。
说话方式：以粤语口语为底（可用书面粤语：嘅、喺、咗、啫、唔），普通话使用者都读得明；温暖、认真、亲切，带少少念叨感，但绝不训斥。
回答结构：先讲结论，再讲要点，最后用一句「水喉FM提提你：…」或「有我喺度」收尾；控制在 200 字以内，除非用户要求详细。
身份边界：你系品牌官方发言人，代表「大水喉」家族嘅态度；但涉及停水时间、水费金额、检测结果等具体数据，仍须讲明「以上为查询所得，以官方最后公布为准」，唔好编造。
被感谢时谦让一句「小事啫」；遇到唔清楚嘅事，坦白讲唔清楚，并提示用户撳输入框右边红色「转人工」按钮、或打 0769-96968 供水热线。`;

function buildMessages() {
  const now2 = new Date();
  const loc = '东莞市';
  const weekday = '星期' + '日一二三四五六'[now2.getDay()];
  const msgs = [{ role: 'system', content: SYSTEM_PROMPT }];
  msgs.push({
    role: 'latest_reminder',
    content: `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, '0')}-${String(now2.getDate()).padStart(2, '0')},${weekday},${loc},Web,中文`,
  });
  const hist = store.history.filter((h) => h.role === 'user' || h.role === 'assistant');
  for (const h of hist) {
    if (h.role === 'assistant' && h.reasoning_content && store.web) {
      msgs.push({ role: 'assistant', content: h.content, reasoning_content: h.reasoning_content, server_tool_calls: h.server_tool_calls });
    } else {
      msgs.push({ role: h.role, content: h.content });
    }
  }
  // 附件
  if (store.files.length) {
    const lastUser = [...msgs].reverse().find((x) => x.role === 'user');
    if (lastUser && typeof lastUser.content === 'string') {
      lastUser.content = [
        ...store.files.map((f) => ({ type: 'file', file_id: f.id })),
        { type: 'text', text: lastUser.content },
      ];
    }
  }
  return msgs;
}

async function liveReply(m, userText) {
  if (!store.apiKey) throw new Error('未填写 DeepSeek API Key，去右上角「设置」填返。');
  store.abort = new AbortController();

  const body = {
    model: STATION.model,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 4096,
    messages: buildMessages(),
  };
  if (store.web) body.tools = [{ type: 'deepseek_web_search' }, { type: 'deepseek_read_url' }];
  if (store.think) { body.thinking = { type: 'enabled' }; body.reasoning_effort = 'high'; }
  body.safety_check = { level: 'high' };
  body.title = { enabled: true };

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${store.apiKey}` },
    body: JSON.stringify(body),
    signal: store.abort.signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`请求失败 ${res.status}${detail ? '：' + detail.slice(0, 160) : ''}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let content = '';
  let reasoning = '';
  let finish = null;
  let annotations = [];
  let serverCalls = [];
  let title = '';
  let thinkBody = null;
  let textNode = null;

  const flushThink = () => {
    if (!reasoning) return;
    thinkBody = thinkBody || ensureThink(m);
    thinkBody.textContent = reasoning;
  };
  const flushText = () => {
    textNode = textNode || ensureText(m);
    textNode.innerHTML = renderLite(content);
    scrollLog();
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith(':') || !line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let chunk;
      try { chunk = JSON.parse(payload); } catch { continue; }
      if (chunk.error) throw new Error(chunk.error.message || '服务端出错');

      const choice = chunk.choices?.[0];
      if (!choice) continue;

      // 工具事件（并行于 delta）
      const ev = choice.server_tool_event;
      if (ev && ev.call) {
        if (ev.type === 'call_started') {
          const q = ev.call.action?.queries?.join(' / ') || ev.call.action?.url || '联网中';
          setState('search');
          ensureSearch(m, q);
        } else if (ev.type === 'call_completed' && ev.call.sources) {
          fillSearch(m, ev.call.sources.map((s, i) => [s.site_name || '网页', s.title || s.url, s.snippet ? s.snippet.slice(0, 34) : '', String(i + 1)]));
        }
      }

      const delta = choice.delta || {};
      if (delta.reasoning_content) {
        reasoning += delta.reasoning_content;
        if (reasoning.length % 24 === 0) flushThink();
        if (!textNode) { setState('think'); thinkBody = thinkBody || ensureThink(m); thinkBody.textContent = reasoning; }
      }
      if (delta.content) {
        setState('write');
        if (!m._thinkClosed) { m._thinkClosed = true; finishThink(m, '已完成'); }
        content += delta.content;
        flushText();
      }
      if (delta.server_tool_calls) serverCalls = delta.server_tool_calls;
      if (delta.annotations) annotations = delta.annotations;
      if (delta.title) title = delta.title;
      if (choice.finish_reason) finish = choice.finish_reason;
      if (chunk.usage) m.usage = chunk.usage;
    }
  }

  if (thinkBody) finishThink(m, '已完成');

  if (finish === 'content_filter') {
    setState('oops');
    const t = ensureText(m);
    t.innerHTML = `<div style="border:2px solid var(--red);border-radius:16px;background:#FFF2F2;padding:12px 14px">
      <b style="font-family:var(--font-display);font-size:15px;display:block;margin-bottom:4px">安全播出 · 已拦截</b>
      呢条问题涉及安全播出范围，水喉唔方便答。不如讲返用水嘅事？停水、水费、报修，我都帮到手。</div>`;
    store.history.push({ role: 'assistant', content: '' });
    return;
  }

  if (!content) content = '（今次冇收到内容，再问一次？）';

  // 引用角标：annotations 的 start/end 是 Unicode 码点
  if (annotations.length) {
    const cps = [...content];
    const marks = annotations
      .map((a, i) => ({ i: a.url_citation?.end_index ?? 0, n: i + 1, url: a.url_citation?.url, title: a.url_citation?.title }))
      .sort((a, b) => b.i - a.i);
    for (const mk of marks) {
      if (mk.i <= cps.length) cps.splice(mk.i, 0, `[[${mk.n}]]`);
    }
    content = cps.join('');
  }
  textNode = textNode || ensureText(m);
  textNode.innerHTML = renderLite(content);

  // 来源
  const sources = [];
  for (const blk of serverCalls) for (const call of blk.calls || []) {
    for (const s of call.sources || []) {
      sources.push([s.site_name || '网页', s.title || s.url, s.snippet ? s.snippet.slice(0, 30) : '', String(sources.length + 1)]);
    }
    if (call.page) sources.push([call.page.title || '网页', call.page.title || call.page.url, call.page.url, String(sources.length + 1)]);
  }
  if (sources.length) addSources(m, sources.slice(0, 6));

  if (title && ui.stageTitle) {
    ui.stageTitle.textContent = title;
    if (ui.titleTag) ui.titleTag.textContent = '自动命名';
  }

  addActs(m, content.replace(/\*\*/g, '').replace(/\[\[\d+\]\]/g, ''), null);
  store.history.push({
    role: 'assistant',
    content,
    reasoning_content: reasoning || undefined,
    server_tool_calls: serverCalls.length ? serverCalls : undefined,
  });
  setState('idle');
}

/* ------------------------------------------------------------- 文件解析 */
async function handleFile(file) {
  if (!file) return;
  const chip = el('div', 'attach__item');
  chip.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 3v5h5"/><path d="M6 3h8l5 5v13H6z"/></svg>
    <span>${esc(file.name)}</span><button type="button" aria-label="移除">×</button>`;
  chip.querySelector('button').onclick = () => {
    chip.remove();
    store.files = store.files.filter((f) => f.name !== file.name);
  };
  ui.attachList.appendChild(chip);

  if (store.mode === 'live' && store.apiKey) {
    toast('上传解析中…');
    try {
      const fd = new FormData();
      fd.append('purpose', 'text_recognition');
      fd.append('file', file);
      const res = await fetch('https://api.deepseek.com/files', {
        method: 'POST', headers: { Authorization: `Bearer ${store.apiKey}` }, body: fd,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      store.files.push({ name: file.name, id: data.id });
      chip.dataset.fileId = data.id;
      toast('文件已解析，可以开始提问');
    } catch (e) {
      chip.remove();
      toast('解析失败：' + e.message);
    }
  } else {
    store.files.push({ name: file.name, id: 'demo-file' });
    toast('录播模式：文件只做示意');
  }
}

/* --------------------------------------------------------------- 初始化 */
function autosize() {
  if (!ui.input) return;
  ui.input.style.height = 'auto';
  ui.input.style.height = Math.min(ui.input.scrollHeight, 200) + 'px';
}
function syncSend() {
  if (ui.send) ui.send.disabled = store.busy || !ui.input.value.trim();
}

function initSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('shfm') || '{}');
    Object.assign(store, saved);
  } catch {}
  if (ui.apiKey) ui.apiKey.value = store.apiKey || '';
  setMode(store.mode || 'demo');
  if (ui.voiceSel) ui.voiceSel.value = store.voice;
  if (ui.autoSpeak) ui.autoSpeak.checked = !!store.autoSpeak;

  ui.btnSettings?.addEventListener('click', () => { ui.modal.hidden = false; if (ui.apiKey) ui.apiKey.focus(); });
  ui.btnClose?.addEventListener('click', () => { ui.modal.hidden = true; });
  ui.modal?.addEventListener('click', (e) => { if (e.target === ui.modal) ui.modal.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.modal && !ui.modal.hidden) ui.modal.hidden = true; });

  ui.modeBtns?.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  ui.btnSave?.addEventListener('click', () => {
    store.apiKey = (ui.apiKey?.value || '').trim();
    store.voice = ui.voiceSel?.value || 'stella';
    store.autoSpeak = !!ui.autoSpeak?.checked;
    try { localStorage.setItem('shfm', JSON.stringify({ mode: store.mode, apiKey: store.apiKey, voice: store.voice, autoSpeak: store.autoSpeak })); } catch {}
    ui.modal.hidden = true;
    toast(store.mode === 'live' ? '已切到真实频道 · deepseek-flash' : '已切到录播模式');
    updateModePill();
  });

  function setMode(mode) {
    store.mode = mode;
    ui.modeBtns?.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    updateModePill();
  }
  ui.setMode = setMode;
}

function updateModePill() {
  const live = store.mode === 'live' && !!store.apiKey;
  if (ui.modePill) {
    ui.modePill.textContent = live ? 'LIVE · 已连线' : '录播 · DEMO';
    ui.modePill.className = 'tag ' + (live ? 'tag--blue' : 'tag--yellow');
  }
  if (ui.liveBadge) ui.liveBadge.hidden = !live;
  if (ui.apiHint) ui.apiHint.textContent = live ? '真实频道：联网 / 思考 / 文件 / 朗读 全部接通' : '录播演示：剧本由本地载入，未发送任何真实请求';
}

/* ---------------------------------------------- 大水喉动画（贴图点击） */
let reelBound = false;

function playReel() {
  const reel = document.getElementById('reel');
  const video = document.getElementById('reelVideo');
  if (!reel || !video) return;

  reel.hidden = false;
  requestAnimationFrame(() => reel.classList.add('on'));

  if (!reelBound) {
    reelBound = true;
    reel.querySelectorAll('[data-reel-close]').forEach((n) => {
      n.addEventListener('click', () => closeReel());
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !reel.hidden) closeReel();
    });
    video.addEventListener('ended', () => {
      closeReel();
      mascotFeedback();
    });
  }

  try { video.currentTime = 0; } catch {}
  video.loop = false;
  const played = video.play();
  if (played && played.catch) {
    played.catch(() => { video.muted = true; video.play().catch(() => {}); });
  }
}

function closeReel() {
  const reel = document.getElementById('reel');
  const video = document.getElementById('reelVideo');
  if (!reel) return;
  try { video?.pause(); } catch {}
  reel.classList.remove('on');
  setTimeout(() => { reel.hidden = true; }, 240);
}

/** 动画播完的一段反馈 */
function mascotFeedback() {
  ui.log.querySelector('.empty')?.remove();
  const node = el('article', 'msg msg--dj');
  node.innerHTML = `<div class="msg__ava"><img src="assets/img/ip/ip-15.webp" alt="大水喉"></div>
    <div class="msg__body">
      <div class="msg__head"><b>大水喉</b><span class="tag tag--yellow">主播</span><time>${now()}</time></div>
      <div class="msg__blocks">
        <div class="blk blk--text">
          <span class="sign">今日你饮水未？</span>
          <p>开咗咁耐咪，记得饮啖水先。饮够八杯，我哋再慢慢倾。</p>
        </div>
        <div class="blk">
          <figure class="msg__sticker" style="width:170px"><img src="assets/img/ip/ip-11.webp" alt="大水喉饮紧水"></figure>
        </div>
      </div>
    </div>`;
  ui.log.appendChild(node);
  store.history.push({ role: 'assistant', content: '今日你饮水未？' });
  scrollLog();
}

/* ------------------------------------------------ 导入 DeepSeek 对话历史 */
function initImport() {
  const btn = $('#btnImport');
  const input = $('#importFile');
  const hint = $('#importHint');
  if (!btn || !input) return;

  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const conv = parseDeepSeekExport(text);
      renderImported(conv);
      if (hint) hint.textContent = `已导入「${conv.title}」共 ${conv.messages.length} 条消息。只留喺呢次浏览，唔会上传。`;
      toast('对话已导入');
      ui.modal.hidden = true;
    } catch (err) {
      const msg = err?.message || '格式未识别';
      if (hint) hint.textContent = '导入失败：' + msg;
      toast('导入失败：' + msg);
    }
    e.target.value = '';
  });
}

/** 尽量宽容地解析 DeepSeek 网页版导出文件 */
function parseDeepSeekExport(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('唔系有效嘅 JSON'); }

  const pickMessages = (o) => {
    if (!o || typeof o !== 'object') return null;
    for (const k of ['messages', 'chat_messages', 'conversation', 'history', 'items', 'list']) {
      if (Array.isArray(o[k])) return o[k];
    }
    return null;
  };

  let convs = null;
  if (Array.isArray(data)) convs = data;
  else if (data && Array.isArray(data.conversations)) convs = data.conversations;
  else if (data && Array.isArray(data.data)) convs = data.data;
  else if (data && Array.isArray(data.sessions)) convs = data.sessions;
  else if (data && Array.isArray(data.chats)) convs = data.chats;

  let conv = null;
  if (convs && convs.length) {
    const usable = convs.filter((c) => (pickMessages(c) || []).length);
    conv = usable.length ? usable[usable.length - 1] : null;
  } else if (pickMessages(data)) {
    conv = data;
  }
  if (!conv) throw new Error('搵唔到对话内容');

  const raw = pickMessages(conv) || [];
  const norm = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    let role = m.role || m.sender || m.from || (m.is_user ? 'user' : 'assistant');
    role = String(role).toLowerCase();
    if (role === 'human' || role === 'user' || role === 'question') role = 'user';
    else if (role === 'bot' || role === 'ai' || role === 'assistant' || role === 'answer') role = 'assistant';
    else continue;

    let content = m.content ?? m.text ?? m.message ?? '';
    if (typeof content !== 'string') {
      if (Array.isArray(content)) content = content.map((x) => (typeof x === 'string' ? x : (x?.text || ''))).join('\n');
      else content = String(content ?? '');
    }
    content = content.trim();
    if (!content) continue;
    norm.push({ role, content: content.slice(0, 4000) });
  }
  if (!norm.length) throw new Error('对话里冇可读消息');

  const title = String(conv.title || conv.name || conv.subject || '已导入对话').slice(0, 40);
  return { title, messages: norm.slice(-60) };
}

function pushAssistantText(text) {
  const node = el('article', 'msg msg--dj');
  node.innerHTML = `<div class="msg__ava"><img src="assets/img/ip/ip-15.webp" alt="大水喉"></div>
    <div class="msg__body">
      <div class="msg__head"><b>大水喉</b><span class="tag tag--yellow">主播</span><time>${now()}</time></div>
      <div class="msg__blocks"><div class="blk blk--text"></div></div>
    </div>`;
  node.querySelector('.blk--text').innerHTML = renderLite(text);
  ui.log.appendChild(node);
}

function renderImported(conv) {
  ui.log.innerHTML = '';
  for (const m of conv.messages) {
    if (m.role === 'user') pushUser(m.content);
    else pushAssistantText(m.content);
  }
  store.history = conv.messages.map((m) => ({ role: m.role, content: m.content }));
  store.turns = Math.max(1, store.turns);
  if (ui.stageTitle) ui.stageTitle.textContent = conv.title;
  if (ui.titleTag) { ui.titleTag.textContent = '已导入'; ui.titleTag.style.opacity = '1'; }
  ui.log.scrollTop = ui.log.scrollHeight;
  setState('idle');
}

export function initChat() {
  ui = {
    log: $('#log'),
    input: $('#input'),
    send: $('#sendBtn'),
    attachList: $('#attachList'),
    djFace: $('#djFace'),
    djState: $('#djState'),
    stageTitle: $('#stageTitle'),
    titleTag: $('#titleTag'),
    modePill: $('#modePill'),
    apiHint: $('#apiHint'),
    liveBadge: $('#liveBadge'),
    schedule: $('#schedule'),
    stkGrid: $('#stkGrid'),
    drinks: $('#drinks'),
    modal: $('#settingsModal'),
    btnSettings: $('#btnSettings'),
    btnClose: $('#btnCloseSettings'),
    btnSave: $('#btnSaveSettings'),
    apiKey: $('#apiKey'),
    voiceSel: $('#voiceSel'),
    autoSpeak: $('#autoSpeak'),
    modeBtns: $$('[data-mode]'),
  };
  if (!ui.log) return;

  /* 空态（含快捷问句）由 JS 注入，清屏时复用 */
  if (!ui.log.children.length) ui.log.innerHTML = emptyState();

  setState('idle');
  initSettings();

  /* 输入区 */
  ui.input.addEventListener('input', () => { autosize(); syncSend(); });
  ui.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(ui.input.value); }
  });
  ui.send.addEventListener('click', () => send(ui.input.value));

  /* 工具按钮 */
  $('#btnFile')?.addEventListener('click', () => $('#fileInput')?.click());
  $('#fileInput')?.addEventListener('change', (e) => {
    [...e.target.files].forEach(handleFile);
    e.target.value = '';
  });
  $('#btnMic')?.addEventListener('click', (e) => toggleMic(e.currentTarget));

  ui.webBtn = $('#btnSearch');
  ui.thinkBtn = $('#btnThink');
  const syncToggles = () => {
    ui.webBtn?.setAttribute('aria-pressed', String(store.web));
    ui.thinkBtn?.setAttribute('aria-pressed', String(store.think));
    ui.webBtn?.classList.toggle('is-on', store.web);
    ui.thinkBtn?.classList.toggle('is-on', store.think);
  };
  ui.webBtn?.addEventListener('click', () => {
    store.web = !store.web; syncToggles();
    toast(store.web ? '联网已开：水喉会上网查资料' : '联网已闩：只用本身知识答');
  });
  ui.thinkBtn?.addEventListener('click', () => {
    store.think = !store.think; syncToggles();
    toast(store.think ? '深度思考已开：水喉会谂深一层' : '深度思考已闩：直接开咪讲');
  });
  syncToggles();

  /* 快捷问句 / 追问：统一用事件委托（空态同消息内都系 .suggest） */
  ui.log.addEventListener('click', (e) => {
    if (e.target.closest('#mascotBtn')) { playReel(); return; }
    const b = e.target.closest('.suggest');
    if (b) send(b.textContent);
  });

  /* 节目表 */
  ui.schedule?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-prompt]');
    if (!b) return;
    $$('button', ui.schedule).forEach((x) => x.setAttribute('aria-current', String(x === b)));
    window.__closeDrawer?.();
    send(b.dataset.prompt);
  });

  /* 迷你贴纸 */
  ui.stkGrid?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-cap]');
    if (!b) return;
    sendSticker(b.dataset.img, b.dataset.cap);
  });

  /* 饮杯水打卡 */
  ui.drinks?.addEventListener('click', (e) => {
    const cups = $$('i', ui.drinks);
    const on = cups.filter((c) => c.classList.contains('on')).length;
    const next = Math.min(cups.length, on + 1);
    cups.forEach((c, i) => c.classList.toggle('on', i < next));
    const cnt = $('#drinkCount', ui.drinks.parentElement);
    if (cnt) cnt.textContent = `${next}/${cups.length}`;
    if (next === cups.length) toast('够八杯啦！水喉都为你开心');
  });

  /* 导入 DeepSeek 对话历史 */
  initImport();

  /* 清空 */
  $('#btnClear')?.addEventListener('click', () => {
    if (store.busy) return;
    store.history = [];
    store.turns = 0;
    ui.log.innerHTML = emptyState();
    if (ui.stageTitle) ui.stageTitle.textContent = '街坊会话';
    if (ui.titleTag) ui.titleTag.style.opacity = '0';
    setState('idle');
  });

  setBusy(false);
  updateModePill();
  window.__SHFM__ = { send, sendSticker, store, speak };

  function sendSticker(img, cap) {
    pushSticker(img, cap);
    const m = newAssistant();
    stickerReply(m, cap);
    ui.log.scrollTop = ui.log.scrollHeight;
  }
}

export function emptyState() {
  return `<div class="empty">
    <button class="mascot" type="button" id="mascotBtn" aria-label="撳一下，睇大水喉动画">
      <img src="assets/img/ip/mascot-small.webp" alt="大水喉抱住心">
      <span class="mascot__hint">㩒一下 · 睇动画</span>
    </button>
    <h3>水喉FM，开麦啦</h3>
    <p>停水、水费、水质、节水、报修——街坊问咩，我大水喉都听得明。慢慢讲，唔使急。</p>
    <div class="suggests suggests--empty">
      ${SUGGESTS.map((s) => `<button class="suggest" type="button">${esc(s)}</button>`).join('')}
    </div>
  </div>`;
}

/* 引用角标点击 → 打开来源 */
document.addEventListener('click', (e) => {
  const c = e.target.closest('.cite, .sourcechip');
  if (!c) return;
  e.preventDefault();
  const n = c.dataset.cite || c.dataset.src;
  const chips = [...document.querySelectorAll('.sourcechip')];
  const target = chips.find((x) => x.dataset.src === n);
  if (target) target.scrollIntoView({ block: 'nearest' });
  toast('来源 ' + (n || '') + '：演示数据，只作版面示意');
});

/* 播报金句轮播 */
export function initExtras() {
  const qText = $('#quoteText');
  const qFrom = $('#quoteFrom');
  if (qText) {
    let i = 0;
    const paint = () => {
      const [t, from] = QUOTES[i % QUOTES.length];
      qText.textContent = `「${t}」`;
      if (qFrom) qFrom.textContent = from;
      i++;
    };
    paint();
    setInterval(paint, 7000);
  }

  /* 跑马灯复制一份，保证无缝 */
  const track = $('.ticker__track');
  if (track && !track.dataset.dup) {
    track.dataset.dup = '1';
    track.innerHTML += track.innerHTML;
  }
  /* 滚动进场统一交给 assets/js/reveal.js（三个页面共用） */
}
