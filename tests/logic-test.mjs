/* =========================================================
 * 滑雪计时 · 逻辑单元测试（确定性，不依赖浏览器）
 *
 * 用最小 DOM 桩在 Node vm 中加载真实的 app.js，
 * 然后像用户一样"点击"按钮，断言界面状态与 localStorage 内容。
 *
 * 用法: node tests/logic-test.mjs
 * ========================================================= */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_SRC = readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

/* ------------------------- 断言 ------------------------- */
const results = [];
let failures = 0;

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  results.push((ok ? 'PASS  ' : 'FAIL  ') + name.padEnd(34) + (ok ? a : 'expected ' + e + ' , got ' + a));
}

function truthy(name, actual) {
  const ok = !!actual;
  if (!ok) failures++;
  results.push((ok ? 'PASS  ' : 'FAIL  ') + name.padEnd(34) + JSON.stringify(actual));
}

const tick = () => new Promise((r) => setImmediate(r));

/* ------------------------- DOM 桩 ------------------------- */

class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...c) { c.forEach((x) => x && this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : !!force;
    if (on) this.set.add(c); else this.set.delete(c);
    return on;
  }
  toString() { return [...this.set].join(' '); }
}

class El {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.hidden = false;
    this.checked = false;
    this.value = '';
    this.files = [];
    this.scrollTop = 0;
    this.style = {};
    this.dataset = {};
    this.attrs = {};
    this.children = [];
    this.parentNode = null;
    this.listeners = {};
    this.classList = new ClassList(this);
    this._text = '';
    this._html = '';
  }
  get className() { return this.classList.toString(); }
  set className(v) {
    this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  get innerHTML() { return this._html; }
  set innerHTML(v) {
    this._html = String(v);
    if (this._html === '') this.children = [];
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) {
    if (this.listeners[type]) this.listeners[type] = this.listeners[type].filter((f) => f !== fn);
  }
  dispatch(type, ev) {
    const e = ev || { target: this, preventDefault() {}, stopPropagation() {} };
    (this.listeners[type] || []).forEach((fn) => fn.call(this, e));
  }
  click() { this.dispatch('click'); }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k.startsWith('data-')) this.dataset[k.slice(5)] = String(v);
  }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
  closest() { return null; }
  querySelector(sel) { return this._qs ? this._qs(sel) : null; }
  querySelectorAll() { return []; }
}

/* ------------------------- 创建被测应用 ------------------------- */

function createApp(opts = {}) {
  const store = opts.store || new Map();
  const clock = opts.clock || { t: Date.parse('2025-01-15T09:00:00Z') };

  const byId = new Map();
  const getEl = (id) => {
    if (!byId.has(id)) byId.set(id, new El('div', id));
    return byId.get(id);
  };

  /* 预建几个结构性元素 */
  const tabs = ['timer', 'records', 'settings'].map((name) => {
    const t = new El('button', 'tab-' + name);
    t.setAttribute('data-tab', name);
    if (name === 'timer') t.classList.add('is-active');
    return t;
  });
  const mask = new El('div');
  mask.classList.add('modal-mask');
  const body = new El('body');
  const modalRoot = getEl('modalRoot');
  modalRoot.hidden = true;
  modalRoot._qs = (sel) => (sel === '.modal-mask' ? mask : null);

  const document = {
    readyState: 'complete',
    visibilityState: 'visible',
    body,
    getElementById: getEl,
    createElement: (tag) => new El(tag),
    addEventListener() {},
    removeEventListener() {},
    querySelector(sel) {
      if (sel === '.modal-mask') return mask;
      if (sel === '.run-item.is-current .run-dur') return null;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '.tab') return tabs;
      if (sel === '#modalActions .btn') return getEl('modalActions').children;
      return [];
    }
  };

  const windowListeners = {};
  const window = {
    navigator: {
      userAgent: 'node-test',
      platform: 'test',
      maxTouchPoints: 0
    },
    document,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener(type, fn) { (windowListeners[type] ||= []).push(fn); },
    removeEventListener() {},
    AudioContext: undefined,
    webkitAudioContext: undefined
  };

  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };

  const timers = { intervals: [], timeouts: [] };
  const sandbox = {
    window,
    document,
    navigator: window.navigator,
    localStorage,
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (fn, ms) => { timers.timeouts.push({ fn, ms }); return timers.timeouts.length; },
    clearTimeout: () => {},
    setInterval: (fn, ms) => { timers.intervals.push({ fn, ms }); return timers.intervals.length; },
    clearInterval: () => {},
    requestAnimationFrame: (fn) => { timers.timeouts.push({ fn, ms: 16 }); return 1; },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    Blob: class { constructor(parts) { this.parts = parts; } },
    FileReader: class {},
    Date: makeFakeDate(clock),
    Math,
    JSON,
    Promise,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Error,
    isNaN,
    parseInt,
    parseFloat
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;

  const ctx = vm.createContext(sandbox);
  vm.runInContext(APP_SRC, ctx, { filename: 'app.js' });

  return {
    el: getEl,
    tabs,
    mask,
    store,
    clock,
    timers,
    window,
    windowListeners,
    modalBtns: () => getEl('modalActions').children,
    modalBtn: (label) => getEl('modalActions').children.find((b) => b.textContent === label),
    fireWindow(type, ev) { (windowListeners[type] || []).forEach((fn) => fn(ev || {})); }
  };
}

function makeFakeDate(clock) {
  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(clock.t);
      else super(...args);
    }
    static now() { return clock.t; }
  }
  return FakeDate;
}

/* ------------------------- 测试主体 ------------------------- */

const MIN = 60 * 1000;
const store = new Map();

/* ===== 1. 初始状态 ===== */
const app = createApp({ store });

eq('初始 mainTime', app.el('mainTime').textContent, '00:00:00');
eq('初始 主按钮', app.el('btnPrimary').textContent, '开始滑雪');
eq('初始 结束按钮隐藏', app.el('btnEnd').hidden, true);
eq('初始 状态文案', app.el('statusText').textContent, '准备就绪');
truthy('初始 分趟空状态占位', app.el('liveRunList').innerHTML.includes('还没有分趟记录'));
eq('初始 记录页空状态', app.el('sumRuns').textContent, '0');
eq('初始 hero 模式', app.el('hero').dataset.mode, 'idle');
eq('定时器已注册', app.timers.intervals.length, 1);

/* ===== 2. 开始滑雪，滑 10 分钟 ===== */
app.el('btnPrimary').click();
await tick();
app.clock.t += 10 * MIN;
app.timers.intervals[0].fn(); // 模拟 250ms tick

eq('滑行中 mainTime', app.el('mainTime').textContent, '00:10:00');
eq('滑行中 状态文案', app.el('statusText').textContent, '滑行中 · 第 1 趟');
eq('滑行中 本趟 pill', app.el('livePill').textContent, '本趟 10:00');
eq('滑行中 主按钮', app.el('btnPrimary').textContent, '结束这趟 · 休息一下');
eq('滑行中 hero 模式', app.el('hero').dataset.mode, 'skiing');
eq('滑行中 结束按钮未隐藏', app.el('btnEnd').hidden, false);
truthy('滑行中 列表显示进行中', app.el('liveRunList').innerHTML.includes('is-current'));
truthy('active 已落盘', store.has('ski.active.v1'));

/* ===== 3. 结束第 1 趟 ===== */
app.el('btnPrimary').click();
await tick();

eq('第1趟后 趟数', app.el('statRuns').textContent, '1');
eq('第1趟后 上一趟', app.el('statLast').textContent, '10:00');
eq('第1趟后 mainTime', app.el('mainTime').textContent, '00:10:00');
eq('第1趟后 状态', app.el('statusText').textContent, '休息中');
eq('第1趟后 hero 模式', app.el('hero').dataset.mode, 'resting');
eq('第1趟后 主按钮', app.el('btnPrimary').textContent, '开始下一趟');
eq('第1趟后 分趟计数', app.el('runsCount').textContent, '共 1 趟');

/* ===== 4. 休息 5 分钟（滑行时间不应增加） ===== */
app.clock.t += 5 * MIN;
app.timers.intervals[0].fn();

eq('休息中 mainTime 不变', app.el('mainTime').textContent, '00:10:00');
eq('休息中 休息合计', app.el('statRest').textContent, '05:00');
eq('休息中 pill', app.el('livePill').textContent, '休息 05:00');

/* ===== 5. 第 2 趟滑 20 分钟 ===== */
app.el('btnPrimary').click();
await tick();
app.clock.t += 20 * MIN;
app.timers.intervals[0].fn();

eq('第2趟 mainTime 累计', app.el('mainTime').textContent, '00:30:00');
eq('第2趟 状态文案', app.el('statusText').textContent, '滑行中 · 第 2 趟');
eq('第2趟 趟数仍为 1', app.el('statRuns').textContent, '1');

/* ===== 6. 结束本次 → 弹窗 ===== */
app.el('btnEnd').click();
await tick();

eq('弹窗标题', app.el('modalTitle').textContent, '结束本次滑雪？');
eq('弹窗按钮', app.modalBtns().map((b) => b.textContent), ['继续滑', '结束并保存', '不保存，直接丢弃']);
truthy('弹窗正文含趟数', app.el('modalBody').innerHTML.includes('<b>2</b>'));

const saveBtn = app.modalBtn('结束并保存');
truthy('找到「结束并保存」', !!saveBtn);
saveBtn.click();
await tick();

eq('保存后 mainTime 归零', app.el('mainTime').textContent, '00:00:00');
eq('保存后 趟数归零', app.el('statRuns').textContent, '0');
eq('保存后 结束按钮隐藏', app.el('btnEnd').hidden, true);
eq('保存后 active 已清除', store.get('ski.active.v1') === undefined || store.get('ski.active.v1') === null, true);

const sessions = JSON.parse(store.get('ski.sessions.v1'));
eq('存储 会话数', sessions.length, 1);
eq('存储 滑行总时长', sessions[0].skiMs, 30 * MIN);
eq('存储 休息总时长', sessions[0].restMs, 5 * MIN);
eq('存储 各趟时长', sessions[0].runs.map((r) => r.ms), [10 * MIN, 20 * MIN]);
eq('存储 最长一趟', sessions[0].maxRunMs, 20 * MIN);

/* ===== 7. 记录页统计 ===== */
app.tabs.find((t) => t.getAttribute('data-tab') === 'records').click();
await tick();

truthy('记录页已激活', app.el('screen-records').classList.contains('is-active'));
truthy('计时页已隐藏', !app.el('screen-timer').classList.contains('is-active'));
eq('统计 累计滑行', app.el('sumSki').textContent, '30m');
eq('统计 累计趟数', app.el('sumRuns').textContent, '2');
eq('统计 滑雪天数', app.el('sumDays').textContent, '1');
eq('统计 最长一趟', app.el('sumBest').textContent, '20:00');
truthy('记录卡片已渲染', app.el('sessionList').innerHTML.includes('details class="session"'));
eq('记录计数文案', app.el('sessionsCount').textContent, '共 1 次');
truthy('卡片含时段与休息', app.el('sessionList').innerHTML.includes('休息'));

/* ===== 8. 设置页 ===== */
app.tabs.find((t) => t.getAttribute('data-tab') === 'settings').click();
await tick();

truthy('设置页已激活', app.el('screen-settings').classList.contains('is-active'));
eq('屏幕常亮默认开', app.el('setWake').checked, true);
eq('提示音默认开', app.el('setSound').checked, true);

app.el('setWake').checked = false;
app.el('setWake').dispatch('change');
eq('关闭常亮后 chip 文案', app.el('chipWake').textContent, '屏幕常亮 关');
truthy('设置已持久化', JSON.parse(store.get('ski.settings.v1')).wakeLock === false);

/* ===== 9. 删除记录 ===== */
app.tabs.find((t) => t.getAttribute('data-tab') === 'records').click();
await tick();

const delBtn = { closest: () => ({ getAttribute: () => sessions[0].id }) };
app.el('sessionList').dispatch('click', {
  target: delBtn,
  preventDefault() {},
  stopPropagation() {}
});
await tick();
eq('删除确认标题', app.el('modalTitle').textContent, '删除这条记录？');
app.modalBtn('删除').click();
await tick();

eq('删除后存储为空', JSON.parse(store.get('ski.sessions.v1')).length, 0);
truthy('删除后显示空状态', app.el('sessionList').innerHTML.includes('还没有历史记录'));

/* ===== 10. 重新加载后恢复未结束的计时 ===== */
const resumeStore = new Map();
const t0 = Date.parse('2025-02-01T08:00:00Z');
resumeStore.set('ski.active.v1', JSON.stringify({
  id: 'RESUME-1',
  startedAt: t0,
  mode: 'skiing',
  runStart: t0,
  restStart: null,
  restMs: 0,
  runs: [{ start: t0 - 12 * MIN, end: t0, ms: 12 * MIN }]
}));

const app2 = createApp({ store: resumeStore, clock: { t: t0 + 3 * MIN } });

eq('恢复 滑行总时长(12m+3m)', app2.el('mainTime').textContent, '00:15:00');
eq('恢复 已完成趟数', app2.el('statRuns').textContent, '1');
eq('恢复 状态文案', app2.el('statusText').textContent, '滑行中 · 第 2 趟');
eq('恢复 结束按钮可见', app2.el('btnEnd').hidden, false);
eq('恢复 上一趟时长', app2.el('statLast').textContent, '12:00');
truthy('恢复 未弹过期提示', app2.el('modalRoot').hidden === true);

/* ===== 11. 超过 18 小时的陈旧会话会询问 ===== */
const staleStore = new Map();
staleStore.set('ski.active.v1', JSON.stringify({
  id: 'STALE-1',
  startedAt: t0,
  mode: 'resting',
  runStart: null,
  restStart: t0,
  restMs: 0,
  runs: [{ start: t0 - 30 * MIN, end: t0, ms: 30 * MIN }]
}));

const app3 = createApp({ store: staleStore, clock: { t: t0 + 20 * 60 * MIN } });
await tick();

eq('陈旧会话 弹窗标题', app3.el('modalTitle').textContent, '发现一次没结束的计时');
eq('陈旧会话 按钮', app3.modalBtns().map((b) => b.textContent), ['保存为记录', '丢弃']);
app3.modalBtn('保存为记录').click();
await tick();

const staleSessions = JSON.parse(staleStore.get('ski.sessions.v1'));
eq('陈旧会话 已保存 1 条', staleSessions.length, 1);
eq('陈旧会话 保存滑行时长', staleSessions[0].skiMs, 30 * MIN);
eq('陈旧会话 休息计入', staleSessions[0].restMs, 20 * 60 * MIN);
eq('陈旧会话 active 已清除', staleStore.get('ski.active.v1') === undefined, true);

/* ------------------------- 输出 ------------------------- */
const report = results.join('\n') +
  '\n\n' + (failures === 0
    ? 'RESULT: PASS - ' + results.length + ' 项断言全部通过'
    : 'RESULT: FAIL - ' + failures + ' / ' + results.length + ' 项断言失败');

try {
  writeFileSync(path.join(__dirname, 'logic-report.txt'), report + '\n', 'utf8');
} catch (e) { /* ignore */ }
console.log(report);
process.exitCode = failures === 0 ? 0 : 1;
