/* 端到端冒烟测试：用 CDP 驱动无头 Edge/Chrome 跑一遍完整滑雪流程
 * 用法: node tests/cdp-smoke.mjs
 * 前置: 本地已启动 HTTP 服务 (默认 http://127.0.0.1:8765) 且浏览器开启了 --remote-debugging-port=9222
 */
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const TEST_URL = process.env.TEST_URL || 'http://127.0.0.1:8765/index.html';

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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

const PAGE_TEST = `(async () => {
  const out = { steps: [], errors: [] };
  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const realNow = Date.now();
  const realDateNow = Date.now;
  let t = realNow;
  Date.now = () => t;
  try {
    out.steps.push(['idle.mainTime', $('mainTime').textContent]);
    out.steps.push(['idle.primary', $('btnPrimary').textContent]);
    out.steps.push(['idle.endHidden', $('btnEnd').hidden]);
    out.steps.push(['idle.emptyPlaceholder', $('liveRunList').textContent.includes('还没有分趟记录')]);

    /* PWA 装配校验：清单可被解析 + Service Worker 已注册 */
    const mlink = document.querySelector('link[rel="manifest"]').getAttribute('href');
    const mres = await fetch(mlink);
    const mjson = await mres.json();
    out.steps.push(['pwa.manifestHref', mlink]);
    out.steps.push(['pwa.manifestStatus', mres.status]);
    out.steps.push(['pwa.manifestName', mjson.name]);
    out.steps.push(['pwa.manifestDisplay', mjson.display]);
    out.steps.push(['pwa.manifestIcons', (mjson.icons || []).length]);
    out.steps.push(['pwa.appleTouchIcon', !!document.querySelector('link[rel="apple-touch-icon"]')]);
    out.steps.push(['pwa.themeColor', document.querySelector('meta[name="theme-color"]').getAttribute('content')]);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      out.steps.push(['pwa.swRegistered', !!reg]);
      out.steps.push(['pwa.swScope', reg && reg.scope]);
      out.steps.push(['pwa.swActive', !!(reg && reg.active)]);
    } catch (e) {
      out.steps.push(['pwa.swError', String(e && e.message || e)]);
    }

    $('btnPrimary').click();               // 开始滑雪
    await wait(30);
    t += 10 * 60 * 1000;                   // 第 1 趟滑 10 分钟
    await wait(400);
    out.steps.push(['ski1.mainTime', $('mainTime').textContent]);
    out.steps.push(['ski1.status', $('statusText').textContent]);
    out.steps.push(['ski1.pill', $('livePill').textContent]);
    out.steps.push(['ski1.primary', $('btnPrimary').textContent]);
    out.steps.push(['ski1.currentRunShown', !!document.querySelector('.run-item.is-current')]);

    $('btnPrimary').click();               // 结束第 1 趟
    await wait(30);
    out.steps.push(['run1.statRuns', $('statRuns').textContent]);
    out.steps.push(['run1.statLast', $('statLast').textContent]);
    out.steps.push(['run1.mainTime', $('mainTime').textContent]);
    out.steps.push(['run1.status', $('statusText').textContent]);

    t += 5 * 60 * 1000;                    // 休息 5 分钟
    await wait(400);
    out.steps.push(['rest.mainTime', $('mainTime').textContent]);
    out.steps.push(['rest.statRest', $('statRest').textContent]);
    out.steps.push(['rest.pill', $('livePill').textContent]);

    $('btnPrimary').click();               // 开始第 2 趟
    await wait(30);
    t += 20 * 60 * 1000;                   // 第 2 趟滑 20 分钟
    await wait(400);
    out.steps.push(['ski2.mainTime', $('mainTime').textContent]);

    $('btnEnd').click();                   // 结束本次 -> 弹窗
    await wait(300);
    out.steps.push(['modal.title', $('modalTitle').textContent]);
    const btns = Array.prototype.slice.call(document.querySelectorAll('#modalActions .btn'));
    out.steps.push(['modal.buttons', btns.map(b => b.textContent)]);
    const saveBtn = btns.find(b => b.textContent === '结束并保存');
    if (!saveBtn) throw new Error('没有找到「结束并保存」按钮');
    saveBtn.click();
    await wait(400);

    out.steps.push(['saved.mainTime', $('mainTime').textContent]);
    out.steps.push(['saved.statRuns', $('statRuns').textContent]);
    out.steps.push(['saved.endHidden', $('btnEnd').hidden]);
    out.steps.push(['saved.activeCleared', localStorage.getItem('ski.active.v1') === null]);

    const sessions = JSON.parse(localStorage.getItem('ski.sessions.v1') || '[]');
    out.steps.push(['store.count', sessions.length]);
    out.steps.push(['store.skiMs', sessions[0] && sessions[0].skiMs]);
    out.steps.push(['store.restMs', sessions[0] && sessions[0].restMs]);
    out.steps.push(['store.runMs', sessions[0] && sessions[0].runs.map(r => r.ms)]);

    document.querySelector('.tab[data-tab="records"]').click();
    await wait(150);
    out.steps.push(['records.active', $('screen-records').classList.contains('is-active')]);
    out.steps.push(['records.sumSki', $('sumSki').textContent]);
    out.steps.push(['records.sumRuns', $('sumRuns').textContent]);
    out.steps.push(['records.sumDays', $('sumDays').textContent]);
    out.steps.push(['records.sumBest', $('sumBest').textContent]);
    out.steps.push(['records.hasCard', !!document.querySelector('#sessionList details.session')]);

    document.querySelector('.tab[data-tab="settings"]').click();
    await wait(120);
    out.steps.push(['settings.active', $('screen-settings').classList.contains('is-active')]);
    out.steps.push(['settings.wakeChecked', $('setWake').checked]);
    out.steps.push(['settings.soundChecked', $('setSound').checked]);

    document.querySelector('.tab[data-tab="timer"]').click();
    await wait(120);
  } catch (e) {
    out.errors.push('TEST: ' + (e && (e.stack || e.message) || e));
  }
  Date.now = realDateNow;
  return JSON.stringify(out);
})()`;

/* 注入到新文档执行：造演示数据。
 * 必须在 app.js 之前运行 —— 否则应用运行期间外写 localStorage，
 * 会在 pagehide 时被应用自己的 persistActive() 清掉。 */
const SEED_ON_NEW_DOCUMENT = `(() => {
  try {
    if (localStorage.getItem('__ski_seed_done') === '1') return;
    const DAY = 86400000;
    const base = Date.parse('2025-01-15T08:30:00');
    const mk = (dayOffset, runsMin, restMin) => {
      const t0 = base + dayOffset * DAY;
      let cursor = t0;
      const runs = [];
      runsMin.forEach((m) => {
        runs.push({ start: cursor, end: cursor + m * 60000, ms: m * 60000 });
        cursor += m * 60000 + restMin * 60000;
      });
      return {
        id: 'DEMO-' + dayOffset, startedAt: t0, endedAt: cursor,
        runs: runs,
        skiMs: runsMin.reduce((a, b) => a + b, 0) * 60000,
        restMs: (runs.length - 1) * restMin * 60000,
        maxRunMs: Math.max.apply(null, runsMin) * 60000,
        createdAt: t0
      };
    };
    localStorage.setItem('ski.sessions.v1', JSON.stringify([
      mk(0, [8, 11, 7, 14, 9], 12),
      mk(-6, [6, 10, 12], 15),
      mk(-13, [15, 9, 11, 8], 10)
    ]));

    const now = Date.now();
    localStorage.setItem('ski.active.v1', JSON.stringify({
      id: 'DEMO-LIVE',
      startedAt: now - 75 * 60000,
      mode: 'skiing',
      runStart: now - 30 * 60000,
      restStart: null,
      restMs: 23 * 60000,
      runs: [
        { start: now - 75 * 60000, end: now - 65 * 60000, ms: 10 * 60000 },
        { start: now - 50 * 60000, end: now - 38 * 60000, ms: 12 * 60000 }
      ]
    }));
    localStorage.setItem('__ski_seed_done', '1');
  } catch (e) { /* ignore */ }
})()`;

/* 断网后重新加载：验证 Service Worker 真的能离线兜底 */
const PAGE_OFFLINE = `JSON.stringify({ steps: [
  ['offline.title', document.title],
  ['offline.appRendered', !!document.getElementById('btnPrimary')],
  ['offline.mainTime', document.getElementById('mainTime').textContent],
  ['offline.status', document.getElementById('statusText').textContent],
  ['offline.tabCount', document.querySelectorAll('.tab').length],
  ['offline.bodyBg', getComputedStyle(document.body).backgroundColor],
  ['offline.heroRadius', getComputedStyle(document.getElementById('hero')).borderRadius]
], errors: [] })`;

const PAGE_RESUME = `(async () => {
  const out = { steps: [], errors: [] };
  const $ = (id) => document.getElementById(id);
  try {
    out.steps.push(['resume.endVisible', !$('btnEnd').hidden]);
    out.steps.push(['resume.status', $('statusText').textContent]);
    out.steps.push(['resume.statRuns', $('statRuns').textContent]);
    out.steps.push(['resume.mainTime', $('mainTime').textContent]);
    out.steps.push(['resume.statRest', $('statRest').textContent]);
    out.steps.push(['resume.pill', $('livePill').textContent]);
    out.steps.push(['resume.primaryLabel', $('btnPrimary').textContent]);
    out.steps.push(['resume.staleModalShown', $('modalRoot').hidden === false]);
  } catch (e) {
    out.errors.push('TEST: ' + (e && (e.stack || e.message) || e));
  }
  return JSON.stringify(out);
})()`;

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
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      problems.push('EXCEPTION: ' + (d.exception && d.exception.description || d.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      problems.push('CONSOLE.ERROR: ' + msg.params.args.map((a) => a.value || a.description).join(' '));
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      problems.push('LOG: ' + msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++msgId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');

  await send('Page.navigate', { url: TEST_URL });

  // 等页面就绪
  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    const r = await send('Runtime.evaluate', {
      expression: "document.readyState + '|' + (typeof window.__skiReady) + '|' + document.querySelectorAll('.tab').length",
      returnByValue: true
    });
    const v = r.result && r.result.result && r.result.result.value;
    if (v && v.startsWith('complete|') && !v.endsWith('|0')) { ready = true; break; }
  }
  if (!ready) throw new Error('页面未就绪');
  await sleep(600);

  const run = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true
    });
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error('evaluate 抛出异常: ' + (d.exception && d.exception.description || d.text));
    }
    return JSON.parse(r.result.result.value);
  };

  /* 清空上一次运行残留的数据。
   * 必须在 app.js 之前执行：应用运行期间外清 localStorage，
   * 跳转时 pagehide 会把它内存里的 active 又写回去。 */
  const clearId = (await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try{localStorage.clear();}catch(e){}"
  })).result.identifier;
  await send('Page.navigate', { url: TEST_URL });
  await sleep(1500);
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: clearId });

  const first = await run(PAGE_TEST);
  await sleep(300);

  /* ---------- 截图（用演示数据，便于肉眼检查排版） ---------- */
  const shotsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');
  const shotNotes = [];
  const capture = async (name) => {
    try {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const data = r.result && r.result.data;
      if (!data) { shotNotes.push(name + ': no data'); return; }
      const { mkdirSync } = await import('node:fs');
      mkdirSync(shotsDir, { recursive: true });
      writeFileSync(path.join(shotsDir, name + '.png'), Buffer.from(data, 'base64'));
      shotNotes.push(name + '.png');
    } catch (e) {
      shotNotes.push(name + ': ' + (e && e.message));
    }
  };
  const goTab = async (tab) => {
    await send('Runtime.evaluate', {
      expression: `document.querySelector('.tab[data-tab="${tab}"]').click()`,
      returnByValue: true
    });
    await sleep(350);
  };

  const seedId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: SEED_ON_NEW_DOCUMENT }))
    .result.identifier;
  await send('Page.navigate', { url: TEST_URL });
  await sleep(1600);
  await capture('01-timer-running');

  await goTab('records');
  await capture('02-records');

  await goTab('settings');
  await capture('03-settings');

  await goTab('timer');
  await send('Runtime.evaluate', { expression: "document.getElementById('btnEnd').click()", returnByValue: true });
  await sleep(600);
  await capture('04-end-modal');

  /* 关掉弹窗，再移除种子脚本重新加载，验证"未结束的计时"能恢复 */
  await send('Runtime.evaluate', {
    expression: "[].slice.call(document.querySelectorAll('#modalActions .btn')).filter(function(b){return b.textContent==='继续滑';})[0].click()",
    returnByValue: true
  });
  await sleep(400);

  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seedId });
  await send('Page.navigate', { url: TEST_URL });
  await sleep(1700);
  await capture('05-timer-resumed');
  const resume = await run(PAGE_RESUME);

  /* ---------- 真·离线验证 ---------- */
  await send('Network.enable');
  await send('Network.emulateNetworkConditions', {
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0
  });
  let offline = { steps: [], errors: [] };
  try {
    await send('Page.navigate', { url: TEST_URL });
    await sleep(2000);
    offline = await run(PAGE_OFFLINE);
  } catch (e) {
    offline.errors.push('OFFLINE NAVIGATION FAILED: ' + (e && e.message || e));
  } finally {
    await send('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1
    });
  }

  const lines = [];
  const val = (res, key) => {
    const hit = res.steps.find(([k]) => k === key);
    return hit ? hit[1] : undefined;
  };
  const offlineChecks = [
    ['offline 页面标题正确', val(offline, 'offline.title') === '滑雪计时'],
    ['offline 应用已渲染', val(offline, 'offline.appRendered') === true],
    ['offline 底部标签栏完整', val(offline, 'offline.tabCount') === 3],
    ['offline 样式表已生效(深色背景)', val(offline, 'offline.bodyBg') === 'rgb(7, 11, 18)'],
    ['offline 样式表已生效(圆角 hero)', String(val(offline, 'offline.heroRadius')) === '26px'],
    ['offline 计时数据仍在', /^\d\d:\d\d:\d\d$/.test(String(val(offline, 'offline.mainTime')))]
  ];
  offlineChecks.forEach(([name, ok]) => { if (!ok) problems.push('ASSERT FAILED: ' + name); });
  /* 支持 MM:SS 与 H:MM:SS 两种格式 */
  const secs = (s) => {
    const m = /^(?:(\d+):)?(\d+):(\d+)$/.exec(String(s).trim());
    return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) : NaN;
  };

  /* 恢复会话的语义断言：种子里 3 趟 = 10+12+30 分钟，休息 23 分钟 */
  const skiSec = secs(val(resume, 'resume.mainTime'));
  const restSec = secs(val(resume, 'resume.statRest'));
  const checks = [
    ['resume 会话已恢复(结束按钮可见)', val(resume, 'resume.endVisible') === true],
    ['resume 状态=第3趟滑行中', val(resume, 'resume.status') === '滑行中 · 第 3 趟'],
    ['resume 已完成趟数=2', val(resume, 'resume.statRuns') === '2'],
    ['resume 主按钮=结束这趟', val(resume, 'resume.primaryLabel') === '结束这趟 · 休息一下'],
    ['resume 滑行时长≈52分', skiSec >= 52 * 60 && skiSec <= 54 * 60],
    ['resume 休息时长=23分', restSec === 23 * 60],
    ['resume 本趟≈30分', secs(String(val(resume, 'resume.pill')).replace('本趟 ', '')) >= 30 * 60],
    ['resume 未误报过期会话', val(resume, 'resume.staleModalShown') === false]
  ];
  checks.forEach(([name, ok]) => {
    if (!ok) problems.push('ASSERT FAILED: ' + name);
  });

  lines.push('=== main flow ===');
  for (const [k, v] of first.steps) lines.push(String(k).padEnd(30) + ' ' + JSON.stringify(v));
  first.errors.forEach((e) => lines.push('  !! ' + e));
  lines.push('');
  lines.push('=== session resume ===');
  for (const [k, v] of resume.steps) lines.push(String(k).padEnd(30) + ' ' + JSON.stringify(v));
  resume.errors.forEach((e) => lines.push('  !! ' + e));
  lines.push('');
  lines.push('=== offline reload (Service Worker) ===');
  for (const [k, v] of offline.steps) lines.push(String(k).padEnd(30) + ' ' + JSON.stringify(v));
  offline.errors.forEach((e) => lines.push('  !! ' + e));
  lines.push('');
  lines.push('=== resume assertions ===');
  checks.forEach(([name, ok]) => lines.push((ok ? 'PASS  ' : 'FAIL  ') + name));
  offlineChecks.forEach(([name, ok]) => lines.push((ok ? 'PASS  ' : 'FAIL  ') + name));
  lines.push('');
  lines.push('=== page-level errors ===');
  lines.push(problems.length ? problems.join('\n') : '(none)');
  lines.push('');
  lines.push('=== screenshots ===');
  lines.push(shotNotes.length ? shotNotes.join('\n') : '(none)');

  const failed = first.errors.length + resume.errors.length + problems.length;
  lines.push('');
  lines.push('RESULT: ' + (failed === 0 ? 'PASS - no script errors' : 'FAIL - see above'));

  const report = lines.join('\n');

  /* 先落盘再打印：Windows 管道下 process.exit() 会丢掉未刷新的 stdout */
  try {
    writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'last-report.txt'), report + '\n', 'utf8');
  } catch (e) { /* ignore */ }
  console.log(report);

  ws.close();
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((e) => {
  const msg = 'TEST RUN FAILED: ' + ((e && (e.stack || e.message)) || e);
  try {
    writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'last-report.txt'), msg + '\n', 'utf8');
  } catch (e2) { /* ignore */ }
  console.error(msg);
  process.exitCode = 2;
});
