(function (root) {
  'use strict';

  const LABELS = { clear: '晴', wind: '风', storm: '强风雨雪' };
  const CHAIN = ['clear', 'wind', 'storm'];
  const MAX_WAITS = 3;
  const WAIT_TEXT = '队伍在遮蔽处观察了一个窗口；下一章的风雨影响会略低，但预报不保证准确。';
  const GAIN_TEXT = '上一章的窗口让队伍以稍好的状态进入本章；这不是天气保证。';
  const SCIENCE = '山区天气变化快，单点预报不能证明下一段安全；云、风和降水趋势只能作为保守决策的参考。';

  // ctx 只由接线任务传入；trade 没有 ctx 参数，这里缓存最近一次的纯函数 ctx。
  let boundCtx = null;

  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const round1 = v => Math.round(v * 10) / 10;

  function bind(ctx) {
    if (ctx && typeof ctx === 'object') boundCtx = ctx;
    return boundCtx;
  }

  function fallbackEsc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function escape(ctx, s) {
    return ctx && typeof ctx.esc === 'function' ? ctx.esc(s) : fallbackEsc(s);
  }

  function ensure(st) {
    if (!st || typeof st !== 'object') return null;
    if (!st.sys || typeof st.sys !== 'object' || Array.isArray(st.sys)) st.sys = {};
    if (!st.sys.weather || typeof st.sys.weather !== 'object' || Array.isArray(st.sys.weather)) {
      st.sys.weather = { guard: 0, waits: 0, last: null };
    }
    const w = st.sys.weather;
    if (w.guard !== 0 && w.guard !== 1) w.guard = 0;
    if (!Number.isSafeInteger(w.waits) || w.waits < 0) w.waits = 0;
    if (typeof w.last !== 'string' && w.last !== null) w.last = null;
    return w;
  }

  function totalLegs(st, ctx) {
    if (ctx && typeof ctx.totalLegs === 'function') {
      const n = ctx.totalLegs(st);
      if (Number.isSafeInteger(n) && n > 0) return n;
    }
    return Array.isArray(st.weatherRolls) ? st.weatherRolls.length : 0;
  }

  function weatherOf(st, leg, ctx) {
    if (!ctx || typeof ctx.weatherAt !== 'function') return null;
    const w = ctx.weatherAt(st, leg);
    return CHAIN.includes(w) ? w : null;
  }

  function random(st, salt, ctx) {
    if (ctx && typeof ctx.storyRandom === 'function') {
      const v = ctx.storyRandom(st, salt);
      if (finite(v)) return clampNum(v, 0, 0.999999999);
    }
    let x = ((st.seed | 0) ^ Math.imul(st.leg | 0, 0x27d4eb2d) ^ Math.imul(salt + 1, 0x165667b1)) >>> 0;
    x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0;
    x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  }

  // 只在预报文本里换成相邻天气；方向由同一个确定性值决定。
  function neighbor(w, v) {
    const i = CHAIN.indexOf(w);
    if (i < 0) return w;
    const step = v < 0.11 ? 1 : -1;
    let j = i + step;
    if (j < 0 || j >= CHAIN.length) j = i - step;
    return CHAIN[j];
  }

  function lineOf(current, list) {
    const parts = [];
    if (current === 'storm') parts.push('当前：' + LABELS.storm + '（已知）');
    if (list.length) {
      const seg = list.map((f, i) => (i === 0 ? '下一章 ' : '再下一章 ') + f.label + ' ' + f.confidence + '%').join(' / ');
      parts.push('情景预报 · ' + seg + ' · 非导航');
    } else {
      parts.push('情景预报 · 已到终点章 · 非导航');
    }
    return parts.join(' · ');
  }

  function forecast(st, ctx) {
    const c = bind(ctx);
    const state = ensure(st);
    if (!state) return [];
    const total = totalLegs(st, c);
    if (!total) {
      state.last = '情景预报 · 暂无路线数据 · 非导航';
      return [];
    }
    const here = clampNum(Number.isSafeInteger(st.leg) ? st.leg : 1, 1, total);
    const current = weatherOf(st, here, c);
    const list = [];
    if (here >= total) {
      state.last = lineOf(current, list);
      return list;
    }
    for (let offset = 1; offset <= 2; offset++) {
      const leg = here + offset;
      if (leg > total) break;
      const actual = weatherOf(st, leg, c);
      if (!actual) continue;
      const roll = random(st, 300 + offset, c);
      const shown = roll < 0.22 ? neighbor(actual, roll) : actual;
      const floor = offset === 1 ? 62 : 48;
      const span = offset === 1 ? 20 : 18;
      const base = floor + Math.round(random(st, 310 + offset, c) * span);
      const confidence = Math.round(clampNum(base - (current === 'storm' ? 8 : 0), 35, 85));
      list.push({ leg, weather: shown, label: LABELS[shown], confidence });
    }
    state.last = lineOf(current, list);
    return list;
  }

  function cardLeg(st, card, total) {
    if (card && typeof card.id === 'string') {
      const m = /-(\d+)$/.exec(card.id);
      if (m) {
        const n = Number(m[1]);
        if (Number.isSafeInteger(n) && n >= 1 && n <= total) return n;
      }
    }
    const leg = Number.isSafeInteger(st.leg) ? st.leg : 1;
    return st.over ? clampNum(leg, 1, total) : clampNum(leg - 1, 1, total);
  }

  function init(st, ctx) {
    bind(ctx);
    if (!st || typeof st !== 'object') return;
    if (!st.sys || typeof st.sys !== 'object' || Array.isArray(st.sys)) st.sys = {};
    st.sys.weather = { guard: 0, waits: 0, last: null };
  }

  function onChoice(st, card, ch, events, ctx) {
    const c = bind(ctx);
    const state = ensure(st);
    if (!state || !ch) return;
    const push = text => { if (Array.isArray(events)) events.push(text); };

    if (state.guard === 1) {
      state.guard = 0;
      if (!st.over && !ch.retreat) {
        const r1 = c && typeof c.r1 === 'function' ? c.r1 : round1;
        if (finite(st.temp)) {
          st.temp = st.routeId === 'canyon'
            ? Math.max(36.5, r1(st.temp - 0.15))
            : Math.min(37.2, r1(st.temp + 0.15));
        }
        if (finite(st.stamina)) st.stamina = Math.min(100, st.stamina + 2);
        push(GAIN_TEXT);
      }
    }

    if (st.over || ch.retreat) return;
    if (!ch.shelter || state.waits >= MAX_WAITS) return;
    const total = totalLegs(st, c);
    if (!total) return;
    const leg = cardLeg(st, card, total);
    const w = weatherOf(st, leg, c);
    if (w !== 'wind' && w !== 'storm') return;
    state.guard = 1;
    state.waits += 1;
    push(WAIT_TEXT);
  }

  function choiceEnabled() {
    return true;
  }

  function trade(st, ch, ctx) {
    const c = bind(ctx);
    if (!ch || !ch.shelter) return '';
    const state = ensure(st);
    if (!state) return '';
    const total = totalLegs(st, c);
    if (!total) return '';
    const leg = clampNum(Number.isSafeInteger(st.leg) ? st.leg : 1, 1, total);
    const current = weatherOf(st, leg, c);
    if (current !== 'wind' && current !== 'storm') return '';
    const list = forecast(st, c);
    if (!list.length) return '';
    return '窗口：下一章 ' + list[0].label + ' ' + list[0].confidence + '%';
  }

  function panelHTML(st, ctx) {
    const c = bind(ctx);
    const state = ensure(st);
    if (!state) return '';
    forecast(st, c);
    const text = typeof state.last === 'string' && state.last
      ? state.last
      : '情景预报 · 已到终点章 · 非导航';
    return '<p class="hintline">' + escape(c, text) + '</p>';
  }

  function endingHTML(st, ctx) {
    const c = bind(ctx);
    const state = ensure(st);
    if (!state) return '';
    const last = typeof state.last === 'string' && state.last ? state.last : '无预报记录';
    const text = '天气窗口 · 本局等待 ' + state.waits + '/' + MAX_WAITS + ' 次 · 最近预报：' + last
      + ' · 预报不改变实际天气，也不构成导航';
    return '<p class="hintline">' + escape(c, text) + '</p>';
  }

  function echo(st, card, ctx) {
    const c = bind(ctx);
    const state = ensure(st);
    const alerts = [];
    if (!state) return { alerts, science: SCIENCE };
    const total = totalLegs(st, c);
    const leg = clampNum(Number.isSafeInteger(st.leg) ? st.leg : 1, 1, total || 1);
    const current = total ? weatherOf(st, leg, c) : null;
    const list = total ? forecast(st, c) : [];
    if (current === 'storm') alerts.push('当前就是强风雨雪：等待只能争取时间，不保证窗口出现。');
    const next = list[0];
    if (next && next.weather === 'storm' && next.confidence >= 60) {
      alerts.push('下一章可能转强风雨雪：现在等窗口，还是保留余量继续走，需要先选一个。');
    }
    if (state.guard === 1) alerts.push('已选择等待窗口：下一章会略好，但预报仍可能错。');
    return { alerts, science: SCIENCE };
  }

  const api = {
    init,
    onChoice,
    choiceEnabled,
    trade,
    panelHTML,
    endingHTML,
    echo,
    forecast
  };
  (root.EchoSystems = root.EchoSystems || {}).weather = api;
})(typeof window !== 'undefined' ? window : globalThis);
