/* =========================================================
 * 线上部署验证（GitHub Pages 真实地址：HTTPS + 子路径）
 *
 * 与 cdp-smoke.mjs 的区别：
 *  - 不注入任何演示数据，避免污染用户真实 origin 的 localStorage
 *  - 全程只做真实用户会做的事，跑完把 localStorage 清干净
 *  - 重点验证 PWA 装配（清单 / Service Worker / 离线兜底）
 *
 * 用法: node tests/live-check.mjs
 * 环境变量: TEST_URL=https://rolkl6.github.io/hx/index.html
 * ========================================================= */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const TEST_URL = process.env.TEST_URL || 'https://rolkl6.github.io/hx/index.html';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch (e) { /* retry */ }
    await sleep(250);
  }
  throw new Error('找不到 CDP page target');
}

/* 仅在新标签会话的首次加载时清空，避免把后续（离线）重载的数据也清掉。
 * 用 sessionStorage 做哨兵：它在同一标签页的多次导航间保留。 */
const CLEAR_ON_NEW_DOCUMENT = `(() => {
  try {
    if (sessionStorage.getItem('__live_check_cleared') === '1') return;
    ['ski.active.v1','ski.sessions.v1','ski.settings.v1','ski.hint.v1','__ski_seed_done']
      .forEach(function (k) { localStorage.removeItem(k); });
    sessionStorage.setItem('__live_check_cleared', '1');
  } catch (e) {}
})()`;

const PAGE_FLOW = `(async () => {
  const out = { steps: [], errors: [] };
  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  try {
    out.steps.push(['page.url', location.href]);
    out.steps.push(['page.protocol', location.protocol]);
    out.steps.push(['page.title', document.title]);

    /* --- PWA 清单 --- */
    const mlink = document.querySelector('link[rel="manifest"]').getAttribute('href');
    const mres = await fetch(mlink);
    const mjson = await mres.json();
    out.steps.push(['pwa.manifestHref', mlink]);
    out.steps.push(['pwa.manifestStatus', mres.status]);
    out.steps.push(['pwa.manifestType', mres.headers.get('content-type')]);
    out.steps.push(['pwa.manifestName', mjson.name]);
    out.steps.push(['pwa.manifestDisplay', mjson.display]);
    out.steps.push(['pwa.manifestIcons', (mjson.icons || []).length]);
    out.steps.push(['pwa.appleTouchIcon', !!document.querySelector('link[rel="apple-touch-icon"]')]);
    out.steps.push(['pwa.themeColor', document.querySelector('meta[name="theme-color"]').getAttribute('content')]);

    /* 图标真能取到 */
    const iconRes = await fetch('icons/apple-touch-icon.png');
    out.steps.push(['pwa.iconFetchStatus', iconRes.status]);

    /* --- Service Worker --- */
    const reg = await navigator.serviceWorker.getRegistration();
    out.steps.push(['sw.registered', !!reg]);
    out.steps.push(['sw.scope', reg && reg.scope]);

    /* 首次访问时 SW 正在安装，等它就绪再断言（最多 20 秒） */
    let readyReg = null;
    try {
      readyReg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, rej) => setTimeout(() => rej(new Error('sw ready timeout')), 20000))
      ]);
    } catch (e) {
      out.steps.push(['sw.readyError', String(e && e.message || e)]);
    }
    out.steps.push(['sw.active', !!(readyReg && readyReg.active)]);
    out.steps.push(['sw.state', readyReg && readyReg.active && readyReg.active.state]);
    out.steps.push(['sw.controller', !!navigator.serviceWorker.controller]);

    /* --- 干净状态 --- */
    out.steps.push(['init.mainTime', $('mainTime').textContent]);
    out.steps.push(['init.primary', $('btnPrimary').textContent]);
    out.steps.push(['init.sessionsEmpty', $('sumRuns').textContent === '0']);

    /* --- 真实交互：滑 3 分钟、休息 1 分钟、再滑 2 分钟 --- */
    const realNow = Date.now;
    let t = Date.now();
    Date.now = () => t;

    $('btnPrimary').click();
    await wait(60);
    t += 3 * 60000;
    $('btnPrimary').click();          // 结束第 1 趟
    await wait(60);
    t += 1 * 60000;
    $('btnPrimary').click();          // 开始第 2 趟
    await wait(60);
    t += 2 * 60000;
    $('btnEnd').click();              // 结束本次
    await wait(300);
    out.steps.push(['modal.title', $('modalTitle').textContent]);
    const save = [].slice.call(document.querySelectorAll('#modalActions .btn'))
      .filter(function (b) { return b.textContent === '结束并保存'; })[0];
    save.click();
    await wait(300);

    out.steps.push(['saved.mainTime', $('mainTime').textContent]);
    const s = JSON.parse(localStorage.getItem('ski.sessions.v1') || '[]');
    out.steps.push(['saved.sessions', s.length]);
    out.steps.push(['saved.skiMs', s[0] && s[0].skiMs]);
    out.steps.push(['saved.restMs', s[0] && s[0].restMs]);
    out.steps.push(['saved.runs', s[0] && s[0].runs.map(function (r) { return r.ms; })]);

    document.querySelector('.tab[data-tab="records"]').click();
    await wait(150);
    out.steps.push(['records.sumSki', $('sumSki').textContent]);
    out.steps.push(['records.sumRuns', $('sumRuns').textContent]);
    out.steps.push(['records.hasCard', !!document.querySelector('#sessionList details.session')]);

    Date.now = realNow;
  } catch (e) {
    out.errors.push('TEST: ' + (e && (e.stack || e.message) || e));
  }
  return JSON.stringify(out);
})()`;

const PAGE_OFFLINE = `JSON.stringify({ steps: [
  ['offline.title', document.title],
  ['offline.appRendered', !!document.getElementById('btnPrimary')],
  ['offline.tabCount', document.querySelectorAll('.tab').length],
  ['offline.bodyBg', getComputedStyle(document.body).backgroundColor],
  ['offline.heroRadius', getComputedStyle(document.getElementById('hero')).borderRadius],
  ['offline.sessionsKept', JSON.parse(localStorage.getItem('ski.sessions.v1') || '[]').length]
], errors: [] })`;

async function main() {
  const target = await getTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  let msgId = 0;
  const pending = new Map();
  const problems = [];

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      problems.push('EXCEPTION: ' + ((d.exception && d.exception.description) || d.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      problems.push('CONSOLE.ERROR: ' + msg.params.args.map((a) => a.value || a.description).join(' '));
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      problems.push('LOG: ' + msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: CLEAR_ON_NEW_DOCUMENT });

  const run = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error('evaluate 异常: ' + ((d.exception && d.exception.description) || d.text));
    }
    return JSON.parse(r.result.result.value);
  };

  await send('Page.navigate', { url: TEST_URL });
  await sleep(2500);
  const flow = await run(PAGE_FLOW);

  /* 离线重载 */
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  let offline = { steps: [], errors: [] };
  try {
    await send('Page.navigate', { url: TEST_URL });
    await sleep(2500);
    offline = await run(PAGE_OFFLINE);
    mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    if (shot.result && shot.result.data) {
      writeFileSync(path.join(__dirname, 'shots', 'live-offline.png'), Buffer.from(shot.result.data, 'base64'));
    }
  } catch (e) {
    offline.errors.push('OFFLINE NAV FAILED: ' + (e && e.message || e));
  } finally {
    await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }

  /* 收尾：清空测试产生的一切数据，让用户拿到干净的应用 */
  await sleep(500);
  await send('Runtime.evaluate', {
    expression: `['ski.active.v1','ski.sessions.v1','ski.settings.v1','ski.hint.v1','__ski_seed_done'].forEach(k=>localStorage.removeItem(k)); 'cleared'`,
    returnByValue: true
  });
  await sleep(300);
  const leftover = await send('Runtime.evaluate', {
    expression: `JSON.stringify(Object.keys(localStorage).filter(k=>k.indexOf('ski.')===0))`,
    returnByValue: true
  });

  const val = (res, k) => { const h = res.steps.find(([x]) => x === k); return h ? h[1] : undefined; };
  const checks = [
    ['线上为 HTTPS', String(val(flow, 'page.protocol')) === 'https:'],
    ['清单可解析且命名正确', val(flow, 'pwa.manifestName') === '滑雪计时'],
    ['清单 MIME = application/json', String(val(flow, 'pwa.manifestType')).includes('application/json')],
    ['清单 display=standalone', val(flow, 'pwa.manifestDisplay') === 'standalone'],
    ['apple-touch-icon 存在且可取到', val(flow, 'pwa.appleTouchIcon') === true && val(flow, 'pwa.iconFetchStatus') === 200],
    ['Service Worker 已注册', val(flow, 'sw.registered') === true],
    ['Service Worker 已 active', val(flow, 'sw.active') === true],    ['SW 作用域在 /hx/ 子路径下', String(val(flow, 'sw.scope')).endsWith('/hx/')],
    ['初始为干净状态', val(flow, 'init.mainTime') === '00:00:00' && val(flow, 'init.sessionsEmpty') === true],
    ['滑行 3+2 分钟累计正确', val(flow, 'saved.skiMs') === 5 * 60000],
    ['休息 1 分钟计入', val(flow, 'saved.restMs') === 1 * 60000],
    ['两趟时长正确', JSON.stringify(val(flow, 'saved.runs')) === JSON.stringify([3 * 60000, 2 * 60000])],
    ['记录页统计正确', val(flow, 'records.sumSki') === '5m' && val(flow, 'records.sumRuns') === '2'],
    ['【离线】页面仍能打开', val(offline, 'offline.appRendered') === true],
    ['【离线】CSS 已生效', val(offline, 'offline.bodyBg') === 'rgb(7, 11, 18)'],
    ['【离线】历史数据完好', val(offline, 'offline.sessionsKept') === 1]
  ];
  checks.forEach(([n, ok]) => { if (!ok) problems.push('ASSERT FAILED: ' + n); });

  const lines = [];
  lines.push('=== 线上地址: ' + TEST_URL + ' ===');
  lines.push('');
  lines.push('--- 主流程 ---');
  for (const [k, v] of flow.steps) lines.push(String(k).padEnd(28) + ' ' + JSON.stringify(v));
  flow.errors.forEach((e) => lines.push('  !! ' + e));
  lines.push('');
  lines.push('--- 离线重载 ---');
  for (const [k, v] of offline.steps) lines.push(String(k).padEnd(28) + ' ' + JSON.stringify(v));
  offline.errors.forEach((e) => lines.push('  !! ' + e));
  lines.push('');
  lines.push('--- 断言 ---');
  checks.forEach(([n, ok]) => lines.push((ok ? 'PASS  ' : 'FAIL  ') + n));
  lines.push('');
  lines.push('--- 页面级错误 ---');
  lines.push(problems.filter((p) => p.startsWith('ASSERT')).length === problems.length
    ? '(none)' : problems.filter((p) => !p.startsWith('ASSERT')).join('\n') || '(none)');
  lines.push('');
  lines.push('测试后残留的 ski.* 键: ' + (leftover.result && leftover.result.result && leftover.result.result.value));
  lines.push('');
  lines.push('RESULT: ' + (problems.length === 0 ? 'PASS' : 'FAIL - ' + problems.length + ' 项'));

  const report = lines.join('\n');
  try { writeFileSync(path.join(__dirname, 'live-report.txt'), report + '\n', 'utf8'); } catch (e) { /* ignore */ }
  console.log(report);
  ws.close();
  process.exitCode = problems.length === 0 ? 0 : 1;
}

main().catch((e) => {
  const msg = 'LIVE CHECK FAILED: ' + ((e && (e.stack || e.message)) || e);
  try { writeFileSync(path.join(__dirname, 'live-report.txt'), msg + '\n', 'utf8'); } catch (e2) { /* ignore */ }
  console.error(msg);
  process.exitCode = 2;
});
