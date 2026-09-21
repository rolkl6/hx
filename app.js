/* =========================================================
 * 滑雪计时 PWA
 * 纯前端、离线可用、数据只存本机 localStorage
 * ========================================================= */
(function () {
  'use strict';

  var LS_ACTIVE = 'ski.active.v1';
  var LS_SESSIONS = 'ski.sessions.v1';
  var LS_SETTINGS = 'ski.settings.v1';
  var LS_HINT = 'ski.hint.v1';
  var VERSION = '1.1.0';
  var STALE_MS = 18 * 60 * 60 * 1000; // 超过 18 小时未结束的会话会被询问

  /* ------------------------- 小工具 ------------------------- */

  function $(id) { return document.getElementById(id); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function fmtClock(ms) {
    var t = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(t / 3600);
    var m = Math.floor((t % 3600) / 60);
    var s = t % 60;
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }

  function fmtShort(ms) {
    var t = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(t / 3600);
    var m = Math.floor((t % 3600) / 60);
    var s = t % 60;
    return h > 0 ? h + ':' + pad2(m) + ':' + pad2(s) : pad2(m) + ':' + pad2(s);
  }

  function fmtHM(ms) {
    var t = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(t / 3600);
    var m = Math.floor((t % 3600) / 60);
    if (h > 0) return h + 'h' + pad2(m) + 'm';
    if (m > 0) return m + 'm';
    return t + 's';
  }

  function fmtHuman(ms) {
    var t = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(t / 3600);
    var m = Math.floor((t % 3600) / 60);
    var s = t % 60;
    if (h > 0) return h + ' 小时 ' + m + ' 分';
    if (m > 0) return m + ' 分 ' + s + ' 秒';
    return s + ' 秒';
  }

  var WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function fmtDate(ts) {
    var d = new Date(ts);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEK[d.getDay()];
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function dateKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function stamp() {
    var d = new Date();
    return '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '_' +
      pad2(d.getHours()) + pad2(d.getMinutes());
  }

  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ------------------------- 全局状态 ------------------------- */

  var active = loadJSON(LS_ACTIVE, null);
  var sessions = loadJSON(LS_SESSIONS, []);
  var settings = Object.assign({ wakeLock: true, sound: true }, loadJSON(LS_SETTINGS, {}));

  if (!Array.isArray(sessions)) sessions = [];
  if (!active || typeof active !== 'object' || !Array.isArray(active.runs)) active = null;

  function persistActive() {
    try {
      if (active) saveJSON(LS_ACTIVE, active);
      else localStorage.removeItem(LS_ACTIVE);
    } catch (e) { /* ignore */ }
  }

  function persistSettings() { saveJSON(LS_SETTINGS, settings); }

  /* ------------------------- 时间计算 ------------------------- */

  function runsTotalMs(a) {
    var t = 0;
    for (var i = 0; i < a.runs.length; i++) t += a.runs[i].ms;
    return t;
  }

  function skiMs(a, now) {
    if (!a) return 0;
    var t = runsTotalMs(a);
    if (a.mode === 'skiing' && a.runStart) t += Math.max(0, now - a.runStart);
    return t;
  }

  function restMs(a, now) {
    if (!a) return 0;
    var t = a.restMs || 0;
    if (a.mode === 'resting' && a.restStart) t += Math.max(0, now - a.restStart);
    return t;
  }

  function currentRunMs(a, now) {
    if (!a || a.mode !== 'skiing' || !a.runStart) return 0;
    return Math.max(0, now - a.runStart);
  }

  function sessionSki(s) {
    if (typeof s.skiMs === 'number') return s.skiMs;
    return runsTotalMs({ runs: s.runs || [] });
  }

  function sessionMaxRun(s) {
    var runs = s.runs || [];
    var m = 0;
    for (var i = 0; i < runs.length; i++) if (runs[i].ms > m) m = runs[i].ms;
    return m;
  }

  function maxOf(list) {
    var m = 0;
    for (var i = 0; i < list.length; i++) if (list[i] > m) m = list[i];
    return m;
  }

  function avgOf(list) {
    if (!list.length) return 0;
    var t = 0;
    for (var i = 0; i < list.length; i++) t += list[i];
    return t / list.length;
  }

  /* 数值变化时才播一次 pop 动画。
   * 注意：逐秒跳动的值（休息计时）不要用它，否则每秒弹一次会很吵。 */
  function setStat(el, value) {
    var next = String(value);
    if (!el || el.textContent === next) return;
    el.textContent = next;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  function setText(el, value) {
    if (el && el.textContent !== String(value)) el.textContent = String(value);
  }

  /* 状态切换时给 hero 一次轻微强调 */
  function flashHero() {
    var hero = $('hero');
    if (!hero) return;
    hero.classList.remove('flash');
    void hero.offsetWidth;
    hero.classList.add('flash');
  }

  /* ------------------------- 声音反馈 ------------------------- */

  var audioCtx = null;

  function beep(freq, dur) {
    if (!settings.sound) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume();
      var t0 = audioCtx.currentTime;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    } catch (e) { /* 静默失败 */ }
  }

  /* ------------------------- 屏幕常亮 ------------------------- */

  var wakeLock = null;

  function acquireWakeLock() {
    if (!settings.wakeLock) return;
    if (!('wakeLock' in navigator)) return;
    try {
      navigator.wakeLock.request('screen').then(function (lock) {
        wakeLock = lock;
        if (lock.addEventListener) {
          lock.addEventListener('release', function () { if (wakeLock === lock) wakeLock = null; });
        }
      }).catch(function () { /* 用户可能拒绝或不支持 */ });
    } catch (e) { /* ignore */ }
  }

  function releaseWakeLock() {
    try { if (wakeLock && wakeLock.release) wakeLock.release(); } catch (e) { /* ignore */ }
    wakeLock = null;
  }

  /* ------------------------- Toast / Modal ------------------------- */

  var toastTimer = null;

  function toast(msg) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    /* 强制回流后再加类，保证过渡生效 */
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.hidden = true; }, 240);
    }, 2000);
  }

  function showModal(opts) {
    return new Promise(function (resolve) {
      var root = $('modalRoot');
      var mask = root.querySelector('.modal-mask');
      $('modalTitle').textContent = opts.title || '';
      $('modalBody').innerHTML = opts.body || '';

      var wrap = $('modalActions');
      wrap.innerHTML = '';

      var closed = false;
      function close() {
        if (closed) return;
        closed = true;
        root.classList.remove('show');
        setTimeout(function () { root.hidden = true; }, 220);
        mask.onclick = null;
      }

      (opts.actions || [{ label: '知道了', value: true, kind: 'primary' }]).forEach(function (a) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn ' + (a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : 'btn-ghost');
        b.textContent = a.label;
        b.addEventListener('click', function () {
          close();
          resolve(a.value);
        });
        wrap.appendChild(b);
      });

      if (opts.dismissable === false) {
        mask.onclick = null;
      } else {
        mask.onclick = function () {
          close();
          resolve(null);
        };
      }

      root.hidden = false;
      void root.offsetWidth;
      root.classList.add('show');
    });
  }

  /* ------------------------- 计时状态机 ------------------------- */

  function startSession() {
    var now = Date.now();
    active = {
      id: 'S' + now + '-' + Math.random().toString(36).slice(2, 7),
      startedAt: now,
      mode: 'skiing',
      runStart: now,
      restStart: null,
      restMs: 0,
      runs: []
    };
    persistActive();
    beep(880, 0.16);
    acquireWakeLock();
    flashHero();
    renderAll();
    toast('开始计时 · 第 1 趟');
  }

  function endRun() {
    if (!active || active.mode !== 'skiing') return;
    var now = Date.now();
    var ms = Math.max(0, now - active.runStart);
    active.runs.push({ start: active.runStart, end: now, ms: ms });
    active.mode = 'resting';
    active.restStart = now;
    active.runStart = null;
    persistActive();
    beep(540, 0.15);
    flashHero();
    renderAll();
    toast('第 ' + active.runs.length + ' 趟 · ' + fmtShort(ms));
  }

  function startRun() {
    if (!active || active.mode !== 'resting') return;
    var now = Date.now();
    active.restMs = (active.restMs || 0) + Math.max(0, now - active.restStart);
    active.mode = 'skiing';
    active.runStart = now;
    active.restStart = null;
    persistActive();
    beep(880, 0.16);
    flashHero();
    renderAll();
    toast('开始第 ' + (active.runs.length + 1) + ' 趟');
  }

  function buildSession(now) {
    var a = active;
    var runs = a.runs.slice();
    var rest = a.restMs || 0;

    if (a.mode === 'skiing' && a.runStart) {
      runs.push({ start: a.runStart, end: now, ms: Math.max(0, now - a.runStart) });
    } else if (a.mode === 'resting' && a.restStart) {
      rest += Math.max(0, now - a.restStart);
    }

    var ski = 0;
    var maxRun = 0;
    for (var i = 0; i < runs.length; i++) {
      ski += runs[i].ms;
      if (runs[i].ms > maxRun) maxRun = runs[i].ms;
    }

    return {
      id: a.id,
      startedAt: a.startedAt,
      endedAt: now,
      runs: runs,
      skiMs: ski,
      restMs: rest,
      maxRunMs: maxRun,
      createdAt: now
    };
  }

  function finishSession() {
    if (!active) return;
    var now = Date.now();
    var session = buildSession(now);
    sessions.unshift(session);
    saveJSON(LS_SESSIONS, sessions);
    active = null;
    persistActive();
    releaseWakeLock();
    beep(660, 0.11);
    setTimeout(function () { beep(990, 0.18); }, 130);
    renderAll();
    toast('已保存 · 滑行 ' + fmtHuman(session.skiMs) + ' · ' + session.runs.length + ' 趟');
  }

  function discardSession() {
    active = null;
    persistActive();
    releaseWakeLock();
    renderAll();
    toast('已丢弃本次计时');
  }

  /* ------------------------- 渲染：计时页 ------------------------- */

  function renderTimer() {
    var now = Date.now();
    var hero = $('hero');
    var btnPrimary = $('btnPrimary');
    var btnEnd = $('btnEnd');

    btnEnd.hidden = !active;

    if (!active) {
      hero.setAttribute('data-mode', 'idle');
      $('statusText').textContent = '准备就绪';
      $('mainTime').textContent = '00:00:00';
      $('mainLabel').textContent = '本次滑行总时长';
      var pill = $('livePill');
      pill.textContent = '点下方按钮开始计时';
      pill.className = 'hero-pill';
      setStat($('statRuns'), '0');
      $('statLast').textContent = '--:--';
      $('statRest').textContent = '00:00';
      btnPrimary.textContent = '开始滑雪';
      btnPrimary.className = 'btn btn-primary';
      return;
    }

    var ski = skiMs(active, now);
    var rest = restMs(active, now);

    $('mainTime').textContent = fmtClock(ski);
    $('mainLabel').textContent = '本次滑行总时长';

    var pill2 = $('livePill');

    if (active.mode === 'skiing') {
      hero.setAttribute('data-mode', 'skiing');
      $('statusText').textContent = '滑行中 · 第 ' + (active.runs.length + 1) + ' 趟';
      pill2.textContent = '本趟 ' + fmtShort(currentRunMs(active, now));
      pill2.className = 'hero-pill pill-ski';
      btnPrimary.textContent = '结束这趟 · 休息一下';
      btnPrimary.className = 'btn btn-ski';
    } else {
      hero.setAttribute('data-mode', 'resting');
      $('statusText').textContent = '休息中';
      pill2.textContent = '休息 ' + fmtShort(rest);
      pill2.className = 'hero-pill pill-rest';
      btnPrimary.textContent = '开始下一趟';
      btnPrimary.className = 'btn btn-rest';
    }

    /* 趟数 / 上一趟用 setStat（变化时弹一下）；休息计时逐秒跳动，用 setText 避免每秒都弹 */
    setStat($('statRuns'), active.runs.length);
    setStat($('statLast'), active.runs.length ? fmtShort(active.runs[active.runs.length - 1].ms) : '--:--');
    setText($('statRest'), fmtShort(rest));
  }

  /* 只在分趟数或模式变化时重建列表：避免每次 renderAll 都重播入场动画。
   * 进行中那一趟的时长与进度条由 tickLive() 单独更新。 */
  var lastLiveSig = '';
  var liveBarMax = 1;

  function renderLiveRuns() {
    var sig = active ? active.mode + ':' + active.runs.length : 'idle';
    if (sig === lastLiveSig) return;

    var list = $('liveRunList');
    var runs = active ? active.runs : [];
    var html = '';

    var curMs = active && active.mode === 'skiing' ? currentRunMs(active, Date.now()) : 0;
    var msList = [];
    for (var k = 0; k < runs.length; k++) msList.push(runs[k].ms);
    if (curMs) msList.push(curMs);
    liveBarMax = maxOf(msList) || 1;

    var justAdded = lastLiveSig !== '' && runs.length > parseInt(lastLiveSig.split(':')[1], 10);

    if (active && active.mode === 'skiing') {
      html += '<div class="run-item is-current">' +
        '<span class="run-idx">' + (runs.length + 1) + '</span>' +
        '<span class="run-dur">' + fmtShort(curMs) + '</span>' +
        '<span class="run-tag">进行中</span>' +
        '<span class="run-bar" style="--w:' + Math.round(curMs / liveBarMax * 100) + '%"></span>' +
        '</div>';
    }

    for (var i = runs.length - 1; i >= 0; i--) {
      var r = runs[i];
      var isNew = justAdded && i === runs.length - 1;
      html += '<div class="run-item' + (isNew ? ' is-new' : '') + '">' +
        '<span class="run-idx">' + (i + 1) + '</span>' +
        '<span class="run-dur">' + fmtShort(r.ms) + '</span>' +
        '<span class="run-time">' + fmtTime(r.start) + ' – ' + fmtTime(r.end) + '</span>' +
        '<span class="run-bar" style="--w:' + Math.round(r.ms / liveBarMax * 100) + '%"></span>' +
        '</div>';
    }

    if (!html) {
      html = '<div class="empty">还没有分趟记录<br><span>开始滑行后，每按一次「结束这趟」就会记一笔</span></div>';
    }

    list.innerHTML = html;
    setText($('runsCount'), runs.length ? '共 ' + runs.length + ' 趟' : '');
    lastLiveSig = sig;
  }

  function tickLive() {
    if (!active) return;
    renderTimer();
    var cur = document.querySelector('.run-item.is-current .run-dur');
    if (cur) cur.textContent = fmtShort(currentRunMs(active, Date.now()));
    var curBar = document.querySelector('.run-item.is-current .run-bar');
    if (curBar) curBar.style.setProperty('--w', Math.round(currentRunMs(active, Date.now()) / liveBarMax * 100) + '%');
  }

  /* ------------------------- 趋势图 -------------------------
   * 依据 ui-ux-pro-max 数据集（charts.csv / "Trend Over Time"）：
   *   - 折线 + 面积，填充约 20% 透明度
   *   - 少于 4 个数据点不要画图，改用数字卡片（数据太少图表反而更难读）
   *   - 数据量 <1000 点用 SVG
   *   - 无障碍：必须有可见数据表 + 文字化趋势摘要；不能只靠颜色传达信息
   */
  var TREND_MAX_DAYS = 12;
  var TREND_MIN_POINTS = 4;
  var TREND_VB_W = 358;
  var TREND_VB_H = 152;
  var TREND_PAD = { l: 38, r: 12, t: 12, b: 24 };

  function fmtAxis(ms) {
    var t = Math.round(ms / 60000);
    if (t >= 60) {
      var h = Math.floor(t / 60), m = t % 60;
      return m ? h + 'h' + pad2(m) : h + 'h';
    }
    return t + 'm';
  }

  function niceMax(v) {
    var steps = [15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480, 600];
    for (var i = 0; i < steps.length; i++) {
      var ms = steps[i] * 60000;
      if (v <= ms) return ms;
    }
    return Math.ceil(v / 3600000) * 3600000;
  }

  function shortDate(ts) {
    var d = new Date(ts);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  /* 按天聚合：一天可能滑多次 */
  function trendDays() {
    var byDay = {};
    sessions.forEach(function (s) {
      var k = dateKey(s.startedAt);
      if (!byDay[k]) byDay[k] = { key: k, ts: s.startedAt, ms: 0, runs: 0 };
      byDay[k].ms += sessionSki(s);
      byDay[k].runs += (s.runs || []).length;
      if (s.startedAt < byDay[k].ts) byDay[k].ts = s.startedAt;
    });
    return Object.keys(byDay).sort().map(function (k) { return byDay[k]; });
  }

  function renderTrend() {
    var section = $('trendSection');
    if (!section) return;

    var days = trendDays();
    var sub = $('trendSub');
    var sum = $('trendSummary');
    var chart = $('trendChart');
    var toggle = $('trendToggle');
    var table = $('trendTable');

    if (!days.length) { section.hidden = true; return; }
    section.hidden = false;

    if (days.length < TREND_MIN_POINTS) {
      setText(sub, '');
      sum.innerHTML = '已经记录 <b>' + days.length + '</b> 个滑雪日。再滑 <b>' +
        (TREND_MIN_POINTS - days.length) + '</b> 天，这里会出现趋势图。';
      chart.innerHTML = '';
      toggle.hidden = true;
      table.hidden = true;
      return;
    }

    var shown = days.slice(-TREND_MAX_DAYS);
    setText(sub, '最近 ' + shown.length + ' 个滑雪日');
    toggle.hidden = false;

    var values = shown.map(function (d) { return d.ms; });
    var recent = values.slice(-5);
    var prev = values.slice(-10, -5);
    var recentAvg = avgOf(recent);
    var peak = maxOf(values);

    var html = '最近 <b>' + recent.length + '</b> 个滑雪日平均 <b>' + fmtHM(recentAvg) + '</b>';
    var prevAvg = prev.length ? avgOf(prev) : 0;
    if (prev.length >= 3 && prevAvg > 0) {
      /* 样本太少时环比没有意义（1 天 vs 5 天的百分比会误导），改成报最大值 */
      var diff = Math.round((recentAvg - prevAvg) / prevAvg * 100);
      html += '，比之前 ' + prev.length + ' 天 <span class="' + (diff >= 0 ? 'up' : 'down') + '">' +
        (diff >= 0 ? '+' : '') + diff + '%</span>';
    } else {
      html += '，单日最长 <b>' + fmtHM(peak) + '</b>';
    }
    sum.innerHTML = html;

    /* ---- 几何：用固定 viewBox，宽度自适应 ---- */
    var n = shown.length;
    var maxV = niceMax(peak);
    var innerW = TREND_VB_W - TREND_PAD.l - TREND_PAD.r;
    var innerH = TREND_VB_H - TREND_PAD.t - TREND_PAD.b;
    var baseY = TREND_PAD.t + innerH;

    function px(i) { return n === 1 ? TREND_PAD.l + innerW / 2 : TREND_PAD.l + innerW * i / (n - 1); }
    function py(v) { return TREND_PAD.t + innerH * (1 - v / maxV); }

    var pts = [];
    for (var i = 0; i < n; i++) pts.push([px(i), py(values[i])]);

    var line = 'M' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' L');
    var area = line + ' L' + pts[n - 1][0].toFixed(1) + ',' + baseY + ' L' + pts[0][0].toFixed(1) + ',' + baseY + ' Z';

    var len = 0;
    for (var j = 1; j < n; j++) {
      var dx = pts[j][0] - pts[j - 1][0], dy = pts[j][1] - pts[j - 1][1];
      len += Math.sqrt(dx * dx + dy * dy);
    }
    len = Math.ceil(len) + 12;

    /* 网格线 + Y 轴刻度：0 / ½ / 满 */
    var grid = '';
    [0, 0.5, 1].forEach(function (f) {
      var v = maxV * f;
      var y = py(v).toFixed(1);
      grid += '<line class="trend-grid" x1="' + TREND_PAD.l + '" y1="' + y + '" x2="' + (TREND_VB_W - TREND_PAD.r) + '" y2="' + y + '"' +
        (f === 0 ? '' : ' stroke-dasharray="3 4"') + '/>';
      grid += '<text class="trend-axis" x="' + (TREND_PAD.l - 6) + '" y="' + y + '" text-anchor="end" dominant-baseline="middle">' +
        fmtAxis(v) + '</text>';
    });

    /* X 轴标签：≤8 个点全标，更多则取 5 个近似等距的位置（避免出现 0/2/3/5 这种不均匀间隔） */
    var labelCount = n <= 8 ? n : 5;
    var labelIdx = [];
    for (var lc = 0; lc < labelCount; lc++) {
      labelIdx.push(Math.round(lc * (n - 1) / (labelCount - 1)));
    }
    var seenL = {};
    var xlabels = '';
    labelIdx.forEach(function (k) {
      if (seenL[k]) return;
      seenL[k] = 1;
      xlabels += '<text class="trend-axis" x="' + pts[k][0].toFixed(1) + '" y="' + (TREND_VB_H - 7) +
        '" text-anchor="middle">' + shortDate(shown[k].ts) + '</text>';
    });

    var peakIdx = values.indexOf(peak);
    var dots = '';
    for (var m = 0; m < n; m++) {
      dots += '<circle class="trend-dot' + (m === peakIdx ? ' is-peak' : '') + '" cx="' + pts[m][0].toFixed(1) +
        '" cy="' + pts[m][1].toFixed(1) + '" r="' + (m === peakIdx ? 4 : 3) + '"/>';
    }

    var aria = '滑行时长趋势，最近 ' + n + ' 个滑雪日，从 ' + shortDate(shown[0].ts) + ' 的 ' +
      fmtHM(values[0]) + ' 到 ' + shortDate(shown[n - 1].ts) + ' 的 ' + fmtHM(values[n - 1]) +
      '，单日最长 ' + fmtHM(peak) + '。完整数值见下方数据表。';

    chart.innerHTML =
      '<svg viewBox="0 0 ' + TREND_VB_W + ' ' + TREND_VB_H + '" role="img" aria-label="' + aria + '">' +
      '<defs><linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#38bdf8" stop-opacity="0.20"/>' +
      '<stop offset="100%" stop-color="#38bdf8" stop-opacity="0.02"/>' +
      '</linearGradient></defs>' +
      grid + xlabels +
      '<path class="trend-area" d="' + area + '"/>' +
      '<path class="trend-line" style="--len:' + len + '" d="' + line + '"/>' +
      dots +
      '</svg>';

    var rows = '';
    for (var q = 0; q < n; q++) {
      rows += '<tr><td>' + shortDate(shown[q].ts) + '</td><td>' + fmtHM(values[q]) + '</td><td>' + shown[q].runs + '</td></tr>';
    }
    table.innerHTML = '<table><caption class="sr-only">各滑雪日滑行时长</caption>' +
      '<thead><tr><th>日期</th><th>滑行</th><th>趟数</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  /* ------------------------- 渲染：记录页 ------------------------- */

  function renderRecords() {
    var totalSki = 0;
    var totalRuns = 0;
    var best = 0;
    var bestRun = 0;
    var days = {};

    sessions.forEach(function (s) {
      var ski = sessionSki(s);
      totalSki += ski;
      totalRuns += (s.runs || []).length;
      days[dateKey(s.startedAt)] = true;
      if (ski > best) best = ski;
      var m = sessionMaxRun(s);
      if (m > bestRun) bestRun = m;
    });

    setStat($('sumSki'), totalSki ? fmtHM(totalSki) : '0');
    setStat($('sumRuns'), totalRuns);
    setStat($('sumDays'), Object.keys(days).length);
    setStat($('sumBest'), bestRun ? fmtShort(bestRun) : '--');

    var list = $('sessionList');

    if (!sessions.length) {
      list.innerHTML = '<div class="empty">还没有历史记录<br><span>完成一次计时后会自动保存到这里</span><br>' +
        '<button type="button" class="empty-cta" data-goto="timer">去开始第一次滑行</button></div>';
      setText($('sessionsCount'), '');
      renderTrend();
      return;
    }

    var sorted = sessions.slice().sort(function (a, b) { return b.startedAt - a.startedAt; });
    var html = '';

    sorted.forEach(function (s) {
      var runs = s.runs || [];
      var ski = sessionSki(s);
      var maxRun = sessionMaxRun(s) || 1;

      var body = '';
      if (runs.length) {
        for (var i = 0; i < runs.length; i++) {
          body += '<div class="run-item">' +
            '<span class="run-idx">' + (i + 1) + '</span>' +
            '<span class="run-dur">' + fmtShort(runs[i].ms) + '</span>' +
            '<span class="run-time">' + fmtTime(runs[i].start) + ' – ' + fmtTime(runs[i].end) + '</span>' +
            '<span class="run-bar" style="--w:' + Math.round(runs[i].ms / maxRun * 100) + '%"></span>' +
            '</div>';
        }
      } else {
        body = '<div class="empty"><span>这次没有完整的分趟记录</span></div>';
      }

      html += '<details class="session">' +
        '<summary>' +
        '<div class="s-main">' +
        '<div class="s-date">' + fmtDate(s.startedAt) + '</div>' +
        '<div class="s-time">' + fmtTime(s.startedAt) + ' – ' + fmtTime(s.endedAt) +
        ' · 休息 ' + fmtHM(s.restMs || 0) + '</div>' +
        '</div>' +
        '<div class="s-right">' +
        '<div class="s-ski">' + fmtHM(ski) + '</div>' +
        '<div class="s-sub">' + runs.length + ' 趟 · 最长 ' + fmtShort(maxRun) + '</div>' +
        '</div>' +
        '</summary>' +
        '<div class="s-body">' + body +
        '<div class="s-actions"><button type="button" class="btn btn-danger btn-sm" data-del="' + s.id + '">删除这次记录</button></div>' +
        '</div>' +
        '</details>';
    });

    list.innerHTML = html;
    setText($('sessionsCount'), '共 ' + sessions.length + ' 次');
    renderTrend();
  }

  /* ------------------------- 渲染：设置页 ------------------------- */

  function renderSettings() {
    $('setWake').checked = !!settings.wakeLock;
    $('setSound').checked = !!settings.sound;
    var chip = $('chipWake');
    chip.classList.toggle('is-on', !!settings.wakeLock);
    chip.textContent = settings.wakeLock ? '屏幕常亮 开' : '屏幕常亮 关';
  }

  function renderAll() {
    renderTimer();
    renderLiveRuns();
    renderRecords();
    renderSettings();
  }

  /* ------------------------- 导出 / 导入 ------------------------- */

  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function downloadFile(filename, text, mime) {
    try {
      var blob = new Blob([text], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 4000);
      return true;
    } catch (e) {
      return false;
    }
  }

  function exportCSV() {
    if (!sessions.length) { toast('还没有记录可以导出'); return; }
    var rows = [['日期', '星期', '开始', '结束', '滑行时长', '滑行分钟', '趟数', '最长单趟分钟', '休息分钟', '各趟分钟']];

    sessions.slice().sort(function (a, b) { return a.startedAt - b.startedAt; }).forEach(function (s) {
      var runs = s.runs || [];
      var ski = sessionSki(s);
      var d = new Date(s.startedAt);
      rows.push([
        dateKey(s.startedAt),
        WEEK[d.getDay()],
        fmtTime(s.startedAt),
        fmtTime(s.endedAt),
        fmtClock(ski),
        (ski / 60000).toFixed(1),
        runs.length,
        (sessionMaxRun(s) / 60000).toFixed(1),
        ((s.restMs || 0) / 60000).toFixed(1),
        runs.map(function (r) { return (r.ms / 60000).toFixed(1); }).join(' / ')
      ]);
    });

    var csv = rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    if (downloadFile('滑雪记录_' + stamp() + '.csv', '\ufeff' + csv, 'text/csv;charset=utf-8')) {
      toast('已导出 CSV 到「文件」App');
    } else {
      toast('导出失败，请重试');
    }
  }

  function exportJSON() {
    if (!sessions.length) { toast('还没有记录可以导出'); return; }
    var payload = {
      app: 'ski-timer',
      version: VERSION,
      exportedAt: new Date().toISOString(),
      sessions: sessions
    };
    if (downloadFile('滑雪记录备份_' + stamp() + '.json', JSON.stringify(payload, null, 2), 'application/json')) {
      toast('已导出备份文件');
    } else {
      toast('导出失败，请重试');
    }
  }

  function importJSON(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try {
        data = JSON.parse(String(reader.result));
      } catch (e) {
        toast('文件格式不对，无法解析');
        return;
      }

      var incoming = (data && Array.isArray(data.sessions)) ? data.sessions : (Array.isArray(data) ? data : null);
      if (!incoming) { toast('文件里没有找到记录'); return; }

      var byId = {};
      sessions.forEach(function (s) { byId[s.id] = true; });

      var added = 0;
      incoming.forEach(function (s) {
        if (!s || typeof s !== 'object') return;
        if (!s.id) s.id = 'S' + (s.startedAt || Date.now()) + '-' + Math.random().toString(36).slice(2, 7);
        if (byId[s.id]) return;
        if (!Array.isArray(s.runs)) s.runs = [];
        if (typeof s.skiMs !== 'number') s.skiMs = runsTotalMs(s);
        if (typeof s.endedAt !== 'number') s.endedAt = s.startedAt;
        byId[s.id] = true;
        sessions.push(s);
        added++;
      });

      sessions.sort(function (a, b) { return (b.startedAt || 0) - (a.startedAt || 0); });
      saveJSON(LS_SESSIONS, sessions);
      renderRecords();
      toast(added ? ('已导入 ' + added + ' 条记录') : '没有新的记录（已去重）');
    };
    reader.onerror = function () { toast('读取文件失败'); };
    reader.readAsText(file);
  }

  function clearAll() {
    showModal({
      title: '清空全部数据？',
      body: '将删除本机保存的 <b>' + sessions.length + '</b> 次滑雪记录（共 ' +
        sessions.reduce(function (a, s) { return a + (s.runs || []).length; }, 0) + ' 趟）。<br>此操作无法撤销。',
      dismissable: false,
      actions: [
        { label: '取消', value: false, kind: 'ghost' },
        { label: '确认清空', value: true, kind: 'danger' }
      ]
    }).then(function (ok) {
      if (!ok) return;
      sessions = [];
      saveJSON(LS_SESSIONS, sessions);
      renderAll();
      toast('已清空全部记录');
    });
  }

  /* ------------------------- 标签栏 ------------------------- */

  function switchTab(name) {
    ['timer', 'records', 'settings'].forEach(function (t) {
      var el = $('screen-' + t);
      if (el) el.classList.toggle('is-active', t === name);
    });
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('is-active', tabs[i].getAttribute('data-tab') === name);
    }
    var content = $('content');
    if (content) content.scrollTop = 0;
    if (name === 'records') renderRecords();
  }

  /* ------------------------- 安装提示 ------------------------- */

  function maybeShowInstallHint() {
    var standalone = window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    var ua = navigator.userAgent || '';
    var isIOS = /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);

    if (!isIOS || !isSafari || standalone) return;
    if (localStorage.getItem(LS_HINT) === '1') return;

    var bar = $('installHint');
    if (!bar) return;
    bar.hidden = false;
    $('hintClose').addEventListener('click', function () {
      try { localStorage.setItem(LS_HINT, '1'); } catch (e) { /* ignore */ }
      bar.hidden = true;
    });
  }

  /* ------------------------- 事件绑定 ------------------------- */

  function onPrimary() {
    if (!active) { startSession(); return; }
    if (active.mode === 'skiing') { endRun(); return; }
    startRun();
  }

  function onEnd() {
    if (!active) return;
    var runs = active.runs.length + (active.mode === 'skiing' ? 1 : 0);
    var ski = fmtHuman(skiMs(active, Date.now()));
    showModal({
      title: '结束本次滑雪？',
      body: '本次共 <b>' + runs + '</b> 趟，滑行 <b>' + ski + '</b>。<br>结束后会保存到历史记录。',
      dismissable: false,
      actions: [
        { label: '继续滑', value: 'cancel', kind: 'ghost' },
        { label: '结束并保存', value: 'save', kind: 'primary' },
        { label: '不保存，直接丢弃', value: 'discard', kind: 'danger' }
      ]
    }).then(function (v) {
      if (v === 'save') finishSession();
      else if (v === 'discard') discardSession();
    });
  }

  function bind() {
    $('btnPrimary').addEventListener('click', onPrimary);
    $('btnEnd').addEventListener('click', onEnd);

    $('chipWake').addEventListener('click', function () {
      settings.wakeLock = !settings.wakeLock;
      persistSettings();
      renderSettings();
      if (settings.wakeLock) {
        acquireWakeLock();
        toast('已开启屏幕常亮');
      } else {
        releaseWakeLock();
        toast('已关闭屏幕常亮');
      }
    });

    $('setWake').addEventListener('change', function () {
      settings.wakeLock = this.checked;
      persistSettings();
      renderSettings();
      if (settings.wakeLock) acquireWakeLock(); else releaseWakeLock();
    });

    $('setSound').addEventListener('change', function () {
      settings.sound = this.checked;
      persistSettings();
      if (settings.sound) beep(880, 0.12);
    });

    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () { switchTab(btn.getAttribute('data-tab')); });
      })(tabs[i]);
    }

    $('sessionList').addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-del]') : null;
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();
      var id = btn.getAttribute('data-del');
      var target = null;
      for (var i = 0; i < sessions.length; i++) if (sessions[i].id === id) target = sessions[i];
      if (!target) return;

      showModal({
        title: '删除这条记录？',
        body: fmtDate(target.startedAt) + ' · 滑行 ' + fmtHM(sessionSki(target)) + ' · ' + (target.runs || []).length + ' 趟',
        dismissable: false,
        actions: [
          { label: '取消', value: false, kind: 'ghost' },
          { label: '删除', value: true, kind: 'danger' }
        ]
      }).then(function (ok) {
        if (!ok) return;
        sessions = sessions.filter(function (s) { return s.id !== id; });
        saveJSON(LS_SESSIONS, sessions);
        renderRecords();
        toast('已删除');
      });
    });

    $('btnExportCsv').addEventListener('click', exportCSV);
    $('btnExportJson').addEventListener('click', exportJSON);
    $('btnImportJson').addEventListener('click', function () { $('fileImport').click(); });
    $('btnClearAll').addEventListener('click', clearAll);

    $('fileImport').addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      if (f) importJSON(f);
    });

    /* 趋势图的数据表折叠（无障碍兜底：图表之外必须有可读的数值） */
    $('trendToggle').addEventListener('click', function () {
      var t = $('trendTable');
      var willOpen = t.hidden;
      t.hidden = !willOpen;
      this.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      this.textContent = willOpen ? '收起数据表' : '查看数据表';
    });

    /* 空状态里的「去开始第一次滑行」 */
    document.addEventListener('click', function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest('[data-goto]') : null;
      if (t) switchTab(t.getAttribute('data-goto'));
    });

    /* 页面隐藏 / 关闭前落盘，避免 iOS 杀进程丢数据 */
    window.addEventListener('pagehide', persistActive);
    window.addEventListener('beforeunload', persistActive);
    document.addEventListener('visibilitychange', function () {
      persistActive();
      if (document.visibilityState === 'visible') {
        if (active && settings.wakeLock) acquireWakeLock();
        renderAll();
      }
    });
  }

  /* ------------------------- 启动 ------------------------- */

  function checkStaleSession() {
    if (!active) return;
    if (Date.now() - active.startedAt < STALE_MS) {
      toast('已恢复上次未结束的计时');
      return;
    }
    showModal({
      title: '发现一次没结束的计时',
      body: '开始于 <b>' + fmtDate(active.startedAt) + ' ' + fmtTime(active.startedAt) + '</b>。<br>' +
        '要把它保存成记录，还是直接丢弃？',
      dismissable: false,
      actions: [
        { label: '保存为记录', value: 'save', kind: 'primary' },
        { label: '丢弃', value: 'discard', kind: 'danger' }
      ]
    }).then(function (v) {
      if (v === 'save') finishSession();
      else if (v === 'discard') discardSession();
    });
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 离线缓存不可用不影响使用 */ });
    });
  }

  function init() {
    bind();
    renderAll();
    maybeShowInstallHint();
    registerSW();
    setInterval(tickLive, 250);
    checkStaleSession();

    /* 回到前台时立刻校正一次显示 */
    window.addEventListener('focus', function () { if (active) tickLive(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
