/* =========================================================
 * UI/UX 量化审查 v2 —— 在 iPhone(WebKit) 视口下实测真实渲染值
 *
 * v1 的两个误报已在 v2 修正：
 *   1. 渐变背景：backgroundColor 是 transparent，v1 会一路走到页面底色，
 *      把亮蓝渐变按钮误判成 1.04:1。v2 解析 backgroundImage 的色标，
 *      对每个色标算对比度取最差值。
 *   2. <label> 包裹的控件：开关本身 50x30，但整行 <label> 都能点，
 *      真实热区是 label。v2 用 effectiveTarget() 取实际可点区域。
 *   3. 无障碍名称：v2 按 aria-label → aria-labelledby → label[for] →
 *      包裹 label → 文本内容 的顺序解析。
 *
 * 用法: node tests/ux-audit.mjs [url]
 * ========================================================= */
import { webkit, devices } from 'playwright';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const URL = process.argv[2] || 'https://rolkl6.github.io/hx/index.html';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function collectAudit() {
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

  const parseColor = (s) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1
  });
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const rgbStr = (c) => 'rgb(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ')';

  /* 从 backgroundImage 里抠出所有颜色（渐变色标） */
  const gradientColors = (bgImage) => {
    if (!bgImage || bgImage === 'none') return [];
    const out = [];
    const re = /rgba?\([^)]*\)/g;
    let m;
    while ((m = re.exec(bgImage))) { const c = parseColor(m[0]); if (c) out.push(c); }
    return out;
  };

  /* 元素自身的可见背景候选集：纯色 + 渐变各色标 */
  function ownBgs(el) {
    const cs = getComputedStyle(el);
    const list = [];
    const solid = parseColor(cs.backgroundColor);
    if (solid && solid.a > 0) list.push(solid);
    gradientColors(cs.backgroundImage).forEach((c) => { if (c.a > 0) list.push(c); });
    return list;
  }

  /* 合成出所有可能的"真实底色"候选（多层 + 渐变取最坏） */
  function bgCandidates(el) {
    let bases = [{ r: 7, g: 11, b: 18, a: 1 }];
    const chain = [];
    let node = el;
    while (node && node.nodeType === 1) { chain.push(node); node = node.parentElement; }
    for (let i = chain.length - 1; i >= 0; i--) {
      const layers = ownBgs(chain[i]);
      if (!layers.length) continue;
      const next = [];
      for (const base of bases) for (const l of layers) next.push(over(l, base));
      bases = next.slice(0, 12); // 防止组合爆炸
    }
    return bases;
  }

  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const label = (el) => {
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 22);
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
      (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : '') +
      (t ? ' "' + t + '"' : '');
  };

  /* 无障碍名称 */
  function accName(el) {
    const al = el.getAttribute('aria-label');
    if (al && al.trim()) return al.trim();
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map((id) => { const n = document.getElementById(id); return n ? n.textContent.trim() : ''; }).join(' ').trim();
      if (t) return t;
    }
    if (el.id) {
      const l = document.querySelector('label[for="' + el.id + '"]');
      if (l) return l.textContent.trim().replace(/\s+/g, ' ');
    }
    const wrap = el.closest('label');
    if (wrap) return wrap.textContent.trim().replace(/\s+/g, ' ');
    return (el.textContent || '').trim().replace(/\s+/g, ' ');
  }

  /* 真实可点区域：label 包裹的控件取整个 label */
  function effectiveTarget(el) {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
      const w = el.closest('label');
      if (w) return w;
    }
    return el;
  }

  const screen = document.querySelector('.screen.is-active');

  /* ---- 1. 文字对比度 ---- */
  const texts = [];
  const seen = new Set();
  const walker = document.createTreeWalker(screen || document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const el = n.parentElement;
    if (!el || !visible(el)) continue;
    const txt = (n.nodeValue || '').trim();
    if (!txt) continue;
    if (seen.has(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    const fg = parseColor(cs.color);
    if (!fg) continue;
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
    const required = isLarge ? 3 : 4.5;
    const cands = bgCandidates(el);
    let worst = Infinity, worstBg = null;
    for (const bg of cands) {
      const r = ratio(over(fg, bg), bg);
      if (r < worst) { worst = r; worstBg = bg; }
    }
    const hasGradient = gradientColors(cs.backgroundImage).length > 0 ||
      (() => { let p = el.parentElement; while (p) { if (gradientColors(getComputedStyle(p).backgroundImage).length) return true; p = p.parentElement; } return false; })();
    texts.push({
      el: label(el), text: txt.slice(0, 30), color: cs.color, bg: worstBg ? rgbStr(worstBg) : '?',
      size: Math.round(size * 10) / 10, weight, ratio: Math.round(worst * 100) / 100,
      required, pass: worst >= required, gradient: hasGradient
    });
  }

  /* ---- 2. 触控热区（按真实可点区域算） ---- */
  const interactive = [];
  document.querySelectorAll('button, a[href], input, select, textarea, summary, [role="button"], [tabindex]:not([tabindex="-1"])').forEach((el) => {
    if (!visible(el)) return;
    const target = effectiveTarget(el);
    const r = target.getBoundingClientRect();
    const w = Math.round(r.width), h = Math.round(r.height);
    const name = accName(el);
    interactive.push({
      el: label(el), targetEl: label(target), w, h,
      pass44: w >= 44 && h >= 44,
      accName: name || null,
      nameSource: el.getAttribute('aria-label') ? 'aria-label'
        : (el.closest('label') ? '包裹 label' : (el.textContent || '').trim() ? '文本内容' : '无'),
      fontSize: Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10
    });
  });

  /* ---- 3. 结构性 emoji ---- */
  const emojiHits = [];
  document.querySelectorAll('.tab-ico, .brand-ico, .chev, button, summary').forEach((el) => {
    if (!visible(el)) return;
    const t = (el.textContent || '').trim();
    if (EMOJI.test(t)) emojiHits.push({ el: label(el), text: t.slice(0, 24) });
  });

  return {
    screenId: screen ? screen.id : '(none)',
    texts, interactive, emojiHits,
    other: {
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
      tabbar: (() => { const t = document.querySelector('.tabbar'); if (!t) return null; const r = t.getBoundingClientRect(); return { h: Math.round(r.height), bottom: Math.round(r.bottom) }; })(),
      content: (() => { const c = document.getElementById('content'); return c ? { scrollH: c.scrollHeight, clientH: c.clientHeight } : null; })(),
      lang: document.documentElement.getAttribute('lang')
    }
  };
}

const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 14'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForTimeout(1800);
await page.evaluate(() => { ['ski.active.v1', 'ski.sessions.v1', 'ski.settings.v1'].forEach((k) => localStorage.removeItem(k)); });
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1800);

const audit = {};
for (const [name, sel] of [['timer', '.tab[data-tab="timer"]'], ['records', '.tab[data-tab="records"]'], ['settings', '.tab[data-tab="settings"]']]) {
  await page.click(sel);
  await page.waitForTimeout(400);
  audit[name] = await page.evaluate(collectAudit);
}

await page.click('.tab[data-tab="timer"]');
await page.waitForTimeout(300);
await page.click('#btnPrimary');
await page.waitForTimeout(300);
await page.click('#btnEnd');
await page.waitForTimeout(700);
audit.modal = await page.evaluate(collectAudit);

/* 也审一下有数据时的记录页（空状态看不出真实排版） */
await page.evaluate(() => {
  const t0 = Date.now() - 86400000;
  const runs = [8, 11, 7, 14, 9].map((m, i) => ({ start: t0 + i * 20 * 60000, end: t0 + i * 20 * 60000 + m * 60000, ms: m * 60000 }));
  localStorage.setItem('ski.sessions.v1', JSON.stringify([{
    id: 'AUDIT-1', startedAt: t0, endedAt: t0 + 120 * 60000, runs,
    skiMs: runs.reduce((a, r) => a + r.ms, 0), restMs: 48 * 60000, maxRunMs: 14 * 60000
  }]));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.click('.tab[data-tab="records"]');
await page.waitForTimeout(500);
await page.evaluate(() => { const d = document.querySelector('#sessionList details.session'); if (d) d.open = true; });
await page.waitForTimeout(400);
audit.recordsWithData = await page.evaluate(collectAudit);
await page.evaluate(() => localStorage.removeItem('ski.sessions.v1'));

await browser.close();

/* ---------------- 汇总 ---------------- */
const lines = [];
lines.push('=== UI/UX 量化审查 v2 ===');
lines.push('URL  : ' + URL);
lines.push('设备 : iPhone 14 (390x664, WebKit)');
lines.push('');

const allTexts = [], allInteractive = [], allEmoji = [];
lines.push('--- 各屏规模 ---');
for (const k of Object.keys(audit)) {
  const a = audit[k];
  lines.push('  ' + k.padEnd(16) + ' 文字 ' + String(a.texts.length).padStart(3) + ' | 可交互 ' + String(a.interactive.length).padStart(2) + ' | emoji ' + a.emojiHits.length);
  a.texts.forEach((t) => allTexts.push({ ...t, screen: k }));
  a.interactive.forEach((t) => allInteractive.push({ ...t, screen: k }));
  a.emojiHits.forEach((t) => allEmoji.push({ ...t, screen: k }));
}

const failText = allTexts.filter((t) => !t.pass).sort((a, b) => a.ratio - b.ratio);
lines.push('');
lines.push('========== 1. 对比度不达标（已计入渐变最差色标） ==========');
if (!failText.length) lines.push('  (无)');
failText.forEach((t) => {
  lines.push('  [' + t.screen + '] ' + t.ratio + ':1 需 ' + t.required + ':1   ' + t.size + 'px/' + t.weight + '  ' + t.el);
  lines.push('        "' + t.text + '"  ' + t.color + ' on ' + t.bg);
});

lines.push('');
lines.push('========== 2. 触控热区 < 44x44（已折算 label 包裹） ==========');
const failTap = allInteractive.filter((t) => !t.pass44).sort((a, b) => (a.w * a.h) - (b.w * b.h));
if (!failTap.length) lines.push('  (无)');
failTap.forEach((t) => lines.push('  [' + t.screen + '] ' + String(t.w + 'x' + t.h).padEnd(9) + t.el + '   热区=' + t.targetEl));

lines.push('');
lines.push('========== 3. 结构性 emoji ==========');
const uniqEmoji = [...new Set(allEmoji.map((e) => e.text))];
uniqEmoji.forEach((t) => lines.push('  ' + t));

lines.push('');
lines.push('========== 4. 字号分布（全局去重） ==========');
const sizeMap = new Map();
allTexts.forEach((t) => { if (!sizeMap.has(t.size)) sizeMap.set(t.size, []); sizeMap.get(t.size).push(t.el); });
[...sizeMap.keys()].sort((a, b) => a - b).forEach((s) => {
  const flag = s < 12 ? '  <-- 偏小' : '';
  lines.push('  ' + String(s).padStart(5) + 'px  x' + String(sizeMap.get(s).length).padStart(2) + flag);
});

lines.push('');
lines.push('========== 5. 无障碍 ==========');
const noName = allInteractive.filter((t) => !t.accName);
lines.push('  无可访问名称的控件: ' + (noName.length ? noName.map((t) => t.el).join(', ') : '无'));
const nameSrc = {};
allInteractive.forEach((t) => { nameSrc[t.nameSource] = (nameSrc[t.nameSource] || 0) + 1; });
lines.push('  名称来源分布: ' + JSON.stringify(nameSrc));

lines.push('');
lines.push('========== 6. 布局 ==========');
lines.push('  ' + JSON.stringify(audit.timer.other));
lines.push('  records(有数据): ' + JSON.stringify(audit.recordsWithData.other));
lines.push('  页面错误: ' + (errors.length ? errors.join(' | ') : '无'));

const json = JSON.stringify({ url: URL, audit }, null, 1);
try {
  writeFileSync(path.join(__dirname, 'ux-audit.json'), json, 'utf8');
  writeFileSync(path.join(__dirname, 'ux-audit.txt'), lines.join('\n') + '\n', 'utf8');
} catch (e) { /* ignore */ }
console.log(lines.join('\n'));
