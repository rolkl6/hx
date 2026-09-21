/* 在真实 WebKit（iPhone 同款引擎）上用真实触摸点击复现问题
 * 用法: node tests/ios-repro.mjs [url]
 */
import { webkit, devices } from 'playwright';

const URL = process.argv[2] || 'https://rolkl6.github.io/hx/index.html';

const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 14'] });
const page = await ctx.newPage();

const logs = [];
page.on('console', (m) => logs.push('CONSOLE[' + m.type() + '] ' + m.text()));
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForTimeout(2500);

console.log('=== 设备 ===');
console.log('viewport:', JSON.stringify(page.viewportSize()));
console.log('UA      :', (await page.evaluate(() => navigator.userAgent)).slice(0, 90));

/* ---------- 1. 命中测试：这个点上最顶层的是谁？ ---------- */
const probe = await page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return { sel, missing: true };
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    return {
      sel,
      center: [Math.round(cx), Math.round(cy)],
      top: top ? (top.tagName.toLowerCase() + (top.id ? '#' + top.id : '') + (top.className ? '.' + String(top.className).split(' ').join('.') : '')) : null,
      isSelfOrChild: !!(top && (top === el || el.contains(top))),
      visible: getComputedStyle(el).visibility + '/' + getComputedStyle(el).display + '/op=' + getComputedStyle(el).opacity
    };
  };
  const out = {
    btnPrimary: pick('#btnPrimary'),
    btnEnd: pick('#btnEnd'),
    tabRecords: pick('.tab[data-tab="records"]'),
    modalRoot: (() => {
      const m = document.getElementById('modalRoot');
      const cs = getComputedStyle(m);
      return { hiddenAttr: m.hasAttribute('hidden'), display: cs.display, opacity: cs.opacity, position: cs.position, zIndex: cs.zIndex, inset: cs.top + ',' + cs.right + ',' + cs.bottom + ',' + cs.left };
    })(),
    toast: (() => {
      const t = document.getElementById('toast');
      const cs = getComputedStyle(t);
      return { hiddenAttr: t.hasAttribute('hidden'), display: cs.display, opacity: cs.opacity };
    })()
  };
  return out;
});

console.log('\n=== 命中测试（点这个坐标，实际会点到谁） ===');
for (const k of ['btnPrimary', 'btnEnd', 'tabRecords']) {
  const p = probe[k];
  console.log(k.padEnd(12), 'center=' + JSON.stringify(p.center), '命中=' + p.top, '是自己?=' + p.isSelfOrChild, '| style=' + p.visible);
}
console.log('modalRoot  :', JSON.stringify(probe.modalRoot));
console.log('toast      :', JSON.stringify(probe.toast));

/* ---------- 2. 真实触摸点击 ---------- */
console.log('\n=== 真实点击 #btnPrimary ===');
const before = await page.textContent('#mainTime');
let clickErr = null;
try {
  await page.click('#btnPrimary', { timeout: 6000 });
} catch (e) {
  clickErr = String(e.message).split('\n').slice(0, 3).join(' | ');
}
await page.waitForTimeout(600);
const after = await page.textContent('#mainTime');
const status = await page.textContent('#statusText');
console.log('mainTime  :', before, '->', after);
console.log('statusText:', status);
console.log('点击报错  :', clickErr || '(无)');

/* ---------- 3. 直接派发 click（绕过命中测试）作对照 ---------- */
console.log('\n=== 对照：用 JS 直接 .click() 绕过命中测试 ===');
await page.evaluate(() => document.getElementById('btnPrimary').click());
await page.waitForTimeout(600);
console.log('mainTime  :', await page.textContent('#mainTime'));
console.log('statusText:', await page.textContent('#statusText'));

console.log('\n=== 页面日志 ===');
console.log(logs.length ? logs.join('\n') : '(无)');

await browser.close();
