// 生成「零外链」版 index.html：内联 CSS / JS / 小图，字体仍走本地文件
// 用法（在 dshuihou/_research/tools 下）：node build_min.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, transform } from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');       // dshuihou/
const SRC = path.join(ROOT, '_src', 'index.template.html');
const OUT = path.join(ROOT, 'index.html');

const read = (p) => fs.readFileSync(p, 'utf8');
const b64 = (p, mime) => `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;

// ---------- 1. JS：把 site.js 的模块图打成一段 IIFE ----------
const js = await build({
  entryPoints: [path.join(ROOT, 'assets', 'js', 'site.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  write: false,
  legalComments: 'none',
});
const appJs = js.outputFiles[0].text;

// reveal.js 是独立 IIFE，先执行（很小）
const revealJs = (await transform(read(path.join(ROOT, 'assets/js/reveal.js')), {
  minify: true, loader: 'js', legalComments: 'none',
})).code;

// ---------- 2. CSS：brand + chat + .filewarn，改成根路径再压缩 ----------
const brand = read(path.join(ROOT, 'assets/css/brand.css'));
const chat = read(path.join(ROOT, 'assets/css/chat.css'));
const landing = read(path.join(ROOT, 'assets/css/landing.css'));
const filewarn = (landing.match(/\.filewarn\s*\{[^}]*\}[\s\S]*?\.filewarn code\s*\{[^}]*\}/) || [''])[0];

let css = [brand, chat, filewarn].join('\n');
css = css.replace(/url\(['"]?\.\.\/(fonts|img)\//g, "url('assets/$1/");
const minCss = (await transform(css, { minify: true, loader: 'css', legalComments: 'none' })).code;

// ---------- 3. 静态空态（首屏不靠 JS 也能画出来） ----------
const { SUGGESTS } = await import(pathToFileURL(path.join(ROOT, 'assets/js/data.js')).href);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const emptyState = `<div class="empty">
    <button class="mascot" type="button" id="mascotBtn" aria-label="撳一下，睇大水喉动画">
      <img src="assets/img/studio-welcome.png" alt="大水喉坐在转椅上，手持水杯" fetchpriority="high">
      <span class="mascot__hint">㩒一下 · 睇动画</span>
    </button>
    <h3>水喉FM，开麦啦</h3>
    <p>停水、水费、水质、节水、报修——街坊问咩，我大水喉都听得明。慢慢讲，唔使急。</p>
    <div class="suggests suggests--empty">
      ${SUGGESTS.map((s) => `<button class="suggest" type="button">${esc(s)}</button>`).join('')}
    </div>
  </div>`;

// ---------- 4. 模板替换 ----------
let html = read(SRC);
const favicon = b64(path.join(ROOT, 'assets/img/logo-icon.svg'), 'image/svg+xml');

html = html
  .replace('__FAVICON__', favicon)
  .replace('<!--EMPTY_STATE-->', emptyState)
  .replace('<!--INLINE_CSS-->', () => `<style>${minCss}</style>`)
  .replace('<!--INLINE_JS-->', () => `<script>${revealJs}\n${appJs}</script>`);

fs.writeFileSync(OUT, html, 'utf8');
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('index.html 已生成');
console.log('  CSS 内联:', kb(minCss.length));
console.log('  JS  内联:', kb(appJs.length + revealJs.length));
console.log('  总 HTML  :', kb(Buffer.byteLength(html)));
