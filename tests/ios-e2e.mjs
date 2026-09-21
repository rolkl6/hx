/* =========================================================
 * iPhone(WebKit) 真实触摸端到端测试
 *
 * 为什么需要这个文件：
 *   之前的测试全部用 element.click() / Runtime.evaluate("...click()")，
 *   它直接派发事件、**绕过浏览器命中测试**，因此完全测不出
 *   "有透明遮罩盖住按钮"这类问题（v1.0.0 就是这么漏掉的）。
 *   这里一律使用 Playwright 的真实 tap/click，它会做可见性与命中检查，
 *   元素被遮挡时会直接超时失败。
 *
 * 用法：
 *   本地:  node tests/ios-e2e.mjs http://127.0.0.1:8765/index.html
 *   线上:  node tests/ios-e2e.mjs https://rolkl6.github.io/hx/index.html
 *
 * 依赖：需要能解析到 playwright（在含 node_modules 的目录下运行，或复制过去）
 * ========================================================= */
import { webkit, devices } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const URL = process.argv[2] || 'http://127.0.0.1:8765/index.html';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const results = [];
let failed = 0;
function check(name, ok, detail) {
  if (!ok) failed++;
  results.push((ok ? 'PASS  ' : 'FAIL  ') + name + (detail === undefined ? '' : '   ' + JSON.stringify(detail)));
}

const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 14'] });
const page = await ctx.newPage();

const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push('CONSOLE.ERROR ' + m.text()); });
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));

/* 可控时钟：让"滑了多久"可断言 */
await page.addInitScript(() => {
  window.__t = Date.now();
  Date.now = () => window.__t;
});

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForTimeout(2000);

const MIN = 60000;
const advance = (ms) => page.evaluate((v) => { window.__t += v; }, ms);
const text = (sel) => page.textContent(sel);

const SHOTS = path.join(__dirname, 'shots');
async function shot(name) {
  try {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, name + '.png') });
    return true;
  } catch (e) { return false; }
}

/* 所有点击都走这里：失败不抛异常，而是记一条带原因的 FAIL，
 * 这样即使界面完全点不动，也能拿到一份完整诊断报告。 */
async function tap(sel, name) {
  const label = '点击 ' + (name || sel);
  try {
    await page.click(sel, { timeout: 8000 });
    check(label, true);
    return true;
  } catch (e) {
    const raw = String(e.message);
    const hit = raw.split('\n').find((l) => l.includes('intercepts pointer events'));
    const detail = (hit || raw.split('\n')[0]).replace(/\x1b\[[0-9;]*m/g, '').trim().slice(0, 140);
    check(label, false, detail);
    return false;
  }
}

async function tapText(txt, name) {
  const label = '点击「' + (name || txt) + '」';
  try {
    await page.getByText(txt, { exact: true }).click({ timeout: 8000 });
    check(label, true);
    return true;
  } catch (e) {
    const raw = String(e.message);
    const hit = raw.split('\n').find((l) => l.includes('intercepts pointer events'));
    const detail = (hit || raw.split('\n')[0]).replace(/\x1b\[[0-9;]*m/g, '').trim().slice(0, 140);
    check(label, false, detail);
    return false;
  }
}

/* ---------- 0. 通用命中测试：可见交互元素的最顶层必须是自己 ---------- */
async function hitTest(selectors) {
  return page.evaluate((sels) => {
    const out = [];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) { out.push({ sel, missing: true }); continue; }
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') { out.push({ sel, skipped: 'not visible' }); continue; }
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const label = top ? top.tagName.toLowerCase() + (top.id ? '#' + top.id : '') + (top.className ? '.' + String(top.className).split(' ').filter(Boolean).join('.') : '') : 'null';
      out.push({ sel, top: label, ok: !!(top && (top === el || el.contains(top) || top.contains(el))) });
    }
    return out;
  }, selectors);
}

const HIT_TARGETS = [
  '#btnPrimary',
  '#chipWake',
  '.tab[data-tab="timer"]',
  '.tab[data-tab="records"]',
  '.tab[data-tab="settings"]',
  '#hintClose'
];
const hits = await hitTest(HIT_TARGETS);
for (const h of hits) {
  if (h.skipped) { results.push('SKIP  hit-test ' + h.sel + ' (' + h.skipped + ')'); continue; }
  check('hit-test ' + h.sel + ' 可被点中', h.ok === true, h.top);
}

/* ---------- 1. 初始状态 ---------- */
check('初始 mainTime', (await text('#mainTime')) === '00:00:00', await text('#mainTime'));
check('modalRoot 处于 display:none', (await page.evaluate(() => getComputedStyle(document.getElementById('modalRoot')).display)) === 'none');
await shot('01-timer-idle');

/* ---------- 2. 真实点击「开始滑雪」 —— 这就是原来点不动的按钮 ---------- */
await tap('#btnPrimary', '开始滑雪');
await page.waitForTimeout(400);
check('点击后进入滑行状态', (await text('#statusText')).includes('滑行中'), await text('#statusText'));

/* ---------- 3. 滑 10 分钟 → 结束这趟 ---------- */
await advance(10 * MIN);
await page.waitForTimeout(500);
check('滑行 10 分钟后主计时', (await text('#mainTime')) === '00:10:00', await text('#mainTime'));
await shot('02-timer-skiing');

await tap('#btnPrimary', '结束这趟');
await page.waitForTimeout(400);
check('结束一趟后趟数=1', (await text('#statRuns')) === '1', await text('#statRuns'));
check('结束一趟后状态=休息中', (await text('#statusText')) === '休息中', await text('#statusText'));

/* ---------- 4. 休息 5 分钟（滑行时间不应增加） ---------- */
await advance(5 * MIN);
await page.waitForTimeout(500);
check('休息时滑行时长不变', (await text('#mainTime')) === '00:10:00', await text('#mainTime'));
check('休息计时', (await text('#statRest')) === '05:00', await text('#statRest'));

/* ---------- 5. 第二趟滑 20 分钟 ---------- */
await tap('#btnPrimary', '开始下一趟');
await page.waitForTimeout(300);
await advance(20 * MIN);
await page.waitForTimeout(500);
check('两趟累计 30 分钟', (await text('#mainTime')) === '00:30:00', await text('#mainTime'));

/* ---------- 6. 结束按钮 + 弹窗真实点击 ---------- */
await tap('#btnEnd', '结束本次');
await page.waitForTimeout(500);
check('弹窗出现', (await page.evaluate(() => getComputedStyle(document.getElementById('modalRoot')).display)) === 'flex');
check('弹窗标题', (await text('#modalTitle')) === '结束本次滑雪？', await text('#modalTitle'));

/* 弹窗按钮也要能真实点到 */
const modHits = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('#modalActions .btn')).map((b) => {
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { label: b.textContent, ok: !!(top && (top === b || b.contains(top))) };
  });
});
for (const m of modHits) check('弹窗按钮可点中: ' + m.label, m.ok === true);
await shot('03-modal');

await tapText('结束并保存');
await page.waitForTimeout(600);
check('保存后主计时归零', (await text('#mainTime')) === '00:00:00', await text('#mainTime'));
check('保存后弹窗关闭', (await page.evaluate(() => getComputedStyle(document.getElementById('modalRoot')).display)) === 'none');

const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ski.sessions.v1') || '[]'));
check('会话已写入', stored.length === 1, stored.length);
check('滑行时长=30分', stored[0] && stored[0].skiMs === 30 * MIN, stored[0] && stored[0].skiMs);
check('休息时长=5分', stored[0] && stored[0].restMs === 5 * MIN, stored[0] && stored[0].restMs);
check('两趟明细正确', stored[0] && JSON.stringify(stored[0].runs.map((r) => r.ms)) === JSON.stringify([10 * MIN, 20 * MIN]));

/* ---------- 7. 真实点击切换标签页 ---------- */
await tap('.tab[data-tab="records"]', '记录标签');
await page.waitForTimeout(400);
check('切到记录页', await page.isVisible('#screen-records'), true);
check('记录页统计', (await text('#sumSki')) === '30m', await text('#sumSki'));

const recHits = await hitTest(['#sessionList details.session summary']);
check('历史卡片可点开', recHits[0] && recHits[0].ok === true, recHits[0] && recHits[0].top);

await tap('.tab[data-tab="settings"]', '设置标签');
await page.waitForTimeout(400);
check('切到设置页', await page.isVisible('#screen-settings'), true);

const setHits = await hitTest(['#setWake', '#setSound', '#btnExportCsv', '#btnExportJson', '#btnImportJson', '#btnClearAll']);
for (const h of setHits) check('设置项可点中 ' + h.sel, h.ok === true, h.top);

/* 开关真实点击 */
const wakeBefore = await page.evaluate(() => document.getElementById('setWake').checked);
await tap('#setWake', '屏幕常亮开关');
await page.waitForTimeout(300);
const wakeAfter = await page.evaluate(() => document.getElementById('setWake').checked);
check('开关可切换', wakeBefore !== wakeAfter, wakeBefore + ' -> ' + wakeAfter);

/* ---------- 8. 清空数据弹窗（真实点击 + 取消） ---------- */
await tap('#btnClearAll', '清空全部数据');
await page.waitForTimeout(500);
check('清空确认弹窗出现', (await text('#modalTitle')) === '清空全部数据？', await text('#modalTitle'));
await tapText('取消');
await page.waitForTimeout(500);
const stillThere = await page.evaluate(() => JSON.parse(localStorage.getItem('ski.sessions.v1') || '[]').length);
check('取消后数据仍在', stillThere === 1, stillThere);
check('取消后弹窗关闭', (await page.evaluate(() => getComputedStyle(document.getElementById('modalRoot')).display)) === 'none');

/* ---------- 9. 回到计时页，按钮仍可点 ---------- */
await tap('.tab[data-tab="timer"]', '计时标签');
await page.waitForTimeout(400);
const finalHits = await hitTest(['#btnPrimary', '.tab[data-tab="settings"]', '#chipWake']);
for (const h of finalHits) check('二次进入后 ' + h.sel + ' 仍可点中', h.ok === true, h.top);

/* ---------- 截图用：灌入 6 个滑雪日，验证趋势图 ---------- */
await page.evaluate(() => {
  const DAY = 86400000;
  const base = Date.now() - 5 * DAY;
  const plan = [[8, 11, 7, 14, 9], [6, 10, 12], [15, 9, 11, 8], [10, 13], [7, 9, 12, 6], [12, 8, 10]];
  const sessions = plan.map((mins, d) => {
    const t0 = base + d * DAY;
    let cur = t0;
    const runs = mins.map((m) => {
      const r = { start: cur, end: cur + m * 60000, ms: m * 60000 };
      cur += m * 60000 + 12 * 60000;
      return r;
    });
    return {
      id: 'SHOT-' + d, startedAt: t0, endedAt: cur, runs,
      skiMs: mins.reduce((a, b) => a + b, 0) * 60000,
      restMs: (runs.length - 1) * 12 * 60000,
      maxRunMs: Math.max.apply(null, mins) * 60000, createdAt: t0
    };
  });
  localStorage.setItem('ski.sessions.v1', JSON.stringify(sessions));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1800);

await page.click('.tab[data-tab="records"]');
await page.waitForTimeout(1000);
const trend = await page.evaluate(() => {
  const s = document.getElementById('trendSection');
  return {
    visible: !s.hidden,
    hasSvg: !!document.querySelector('#trendChart svg'),
    hasLine: !!document.querySelector('#trendChart .trend-line'),
    dots: document.querySelectorAll('#trendChart .trend-dot').length,
    summary: document.getElementById('trendSummary').textContent,
    sub: document.getElementById('trendSub').textContent
  };
});
check('趋势图已渲染', trend.visible && trend.hasSvg && trend.hasLine, trend.summary);
check('趋势图数据点数正确', trend.dots === 6, trend.dots);
await shot('04-records-trend');

/* 展开数据表（图表之外的可读数值，无障碍兜底） */
await page.click('#trendToggle');
await page.waitForTimeout(500);
const tableRows = await page.evaluate(() => document.querySelectorAll('#trendTable tbody tr').length);
check('数据表可展开且有对应数据', tableRows === 6, tableRows);
const expanded = await page.evaluate(() => document.getElementById('trendToggle').getAttribute('aria-expanded'));
check('数据表 aria-expanded 同步', expanded === 'true', expanded);
await shot('05-records-table');

await page.click('.tab[data-tab="settings"]');
await page.waitForTimeout(600);
await shot('06-settings');

/* 展开一条记录，看分趟相对时长条 */
await page.click('.tab[data-tab="records"]');
await page.waitForTimeout(400);
const bars = await page.evaluate(async () => {
  const d = document.querySelector('#sessionList details.session');
  d.open = true;
  await new Promise((r) => setTimeout(r, 400));
  const list = d.querySelectorAll('.run-bar');
  return { widths: Array.from(list).map((b) => b.style.getPropertyValue('--w')), runs: d.querySelectorAll('.run-item').length };
});
check('分趟相对时长条数量与分趟数一致',
  bars.widths.length === bars.runs && bars.widths.length >= 2, bars.widths.length + ' vs ' + bars.runs);
check('分趟条宽度都是合法百分比',
  bars.widths.every((w) => /^\d+%$/.test(w)), bars.widths.join(' '));
check('最长那一趟为 100%', bars.widths.indexOf('100%') !== -1, bars.widths.join(' '));

/* 滚到该记录再截图，否则展开的内容在视口外，截出来和上一张一模一样 */
await page.evaluate(() => {
  const d = document.querySelector('#sessionList details.session');
  if (d) d.scrollIntoView({ block: 'start' });
});
await page.waitForTimeout(700);
await shot('07-session-detail');

/* ---------- 收尾 ---------- */
await page.evaluate(() => {
  ['ski.active.v1', 'ski.sessions.v1', 'ski.settings.v1', 'ski.hint.v1'].forEach((k) => localStorage.removeItem(k));
});

const lines = [];
lines.push('=== iPhone(WebKit 真实触摸) E2E: ' + URL + ' ===');
lines.push('UA: ' + (await page.evaluate(() => navigator.userAgent)).slice(0, 80));
lines.push('');
lines.push(...results);
lines.push('');
lines.push('页面级错误: ' + (logs.length ? '\n' + logs.join('\n') : '(无)'));
lines.push('');
lines.push('RESULT: ' + (failed === 0 && logs.length === 0 ? 'PASS - ' + results.filter((r) => r.startsWith('PASS')).length + ' 项通过'
  : 'FAIL - ' + failed + ' 项断言失败' + (logs.length ? ' / ' + logs.length + ' 条页面错误' : '')));

const report = lines.join('\n');
try { writeFileSync(path.join(__dirname, 'ios-report.txt'), report + '\n', 'utf8'); } catch (e) { /* ignore */ }
console.log(report);

await browser.close();
process.exitCode = (failed === 0 && logs.length === 0) ? 0 : 1;
