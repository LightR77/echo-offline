'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require(path.join(__dirname, '03-weather.js'));
const weather = globalThis.EchoSystems && globalThis.EchoSystems.weather;

const ROUTES = ['mountain', 'forest', 'canyon'];
const LABELS = { clear: '晴', wind: '风', storm: '强风雨雪' };

function loadCore() {
  const file = path.join(__dirname, '..', 'game.html');
  const html = fs.readFileSync(file, 'utf8');
  const start = html.indexOf('function mulberry32(seed){');
  const marker = html.indexOf('var Core = {', start);
  assert.ok(start >= 0 && marker > start, 'game.html 中未找到 Core 纯逻辑段');
  const end = html.indexOf('\n', marker);
  const code = html.slice(start, end);
  return new Function(code + '\nreturn { Core, storyRandom };')();
}

const { Core, storyRandom } = loadCore();

const ctx = {
  r1: v => Math.round(v * 10) / 10,
  r2: v => Math.round(v * 100) / 100,
  clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  esc: s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  weatherAt: (st, leg) => Core.weatherAt(st, leg),
  storyRandom: (st, salt) => storyRandom(st, salt),
  totalLegs: st => Core.totalLegs(st)
};

function newState(seed, route) {
  const st = Core.newRun(seed >>> 0, undefined, route);
  weather.init(st, ctx);
  return st;
}

function findLeg(st, name) {
  for (let leg = 1; leg < Core.totalLegs(st); leg++) {
    if (Core.weatherAt(st, leg) === name) return leg;
  }
  return 0;
}

function checkForecast(st, list) {
  assert.ok(Array.isArray(list), 'forecast 必须返回数组');
  assert.ok(list.length <= 2, '最多两条预报');
  const total = Core.totalLegs(st);
  for (const f of list) {
    assert.ok(['clear', 'wind', 'storm'].includes(f.weather), '预报天气必须为 clear/wind/storm');
    assert.equal(f.label, LABELS[f.weather]);
    assert.ok(Number.isInteger(f.confidence), 'confidence 必须是整数');
    assert.ok(f.confidence >= 35 && f.confidence <= 85, 'confidence 必须在 35–85');
    assert.ok(Number.isInteger(f.leg) && f.leg > st.leg && f.leg <= total, '预报 leg 越界');
  }
}

let count = 0;
function test(name, fn) {
  try {
    fn();
    count++;
    console.log('ok ' + count + ' - ' + name);
  } catch (err) {
    console.error('not ok - ' + name);
    throw err;
  }
}

test('模块按契约挂载并可初始化', () => {
  assert.ok(weather, 'EchoSystems.weather 未挂载');
  for (const key of ['init', 'onChoice', 'choiceEnabled', 'trade', 'panelHTML', 'endingHTML', 'echo', 'forecast']) {
    assert.equal(typeof weather[key], 'function', key + ' 缺失');
  }
  const st = Core.newRun(1, undefined, 'mountain');
  weather.init(st, ctx);
  assert.deepEqual(st.sys.weather, { guard: 0, waits: 0, last: null });
  weather.init(st, ctx);
  assert.deepEqual(st.sys.weather, { guard: 0, waits: 0, last: null });
  assert.equal(weather.choiceEnabled(st, {}), true);
});

test('同一 seed/路线/章节的 forecast 完全一致（100 seed × 3 路线）', () => {
  for (let seed = 1; seed <= 100; seed++) {
    for (const route of ROUTES) {
      const a = newState(seed, route);
      const b = newState(seed, route);
      const total = Core.totalLegs(a);
      for (let leg = 1; leg <= total; leg++) {
        a.leg = leg;
        b.leg = leg;
        const fa = weather.forecast(a, ctx);
        const fb = weather.forecast(b, ctx);
        assert.deepEqual(fa, fb);
        checkForecast(a, fa);
        if (leg === total) {
          assert.deepEqual(fa, [], '终点章必须返回空数组');
        } else {
          assert.ok(fa.length >= 1, '非终点章至少一条预报');
          assert.equal(fa[0].leg, leg + 1);
          if (leg + 2 <= total) {
            assert.equal(fa.length, 2);
            assert.equal(fa[1].leg, leg + 2);
          } else {
            assert.equal(fa.length, 1);
          }
        }
        for (const f of fa) assert.ok(Number.isFinite(f.confidence), '出现 NaN');
      }
    }
  }
});

test('预报误差确定：同 seed 同章节可重放，误差只落在相邻天气', () => {
  let shifted = 0;
  let exact = 0;
  const chain = ['clear', 'wind', 'storm'];
  for (let seed = 1; seed <= 40; seed++) {
    for (const route of ROUTES) {
      const a = newState(seed, route);
      const b = newState(seed, route);
      const total = Core.totalLegs(a);
      for (let leg = 1; leg <= total; leg++) {
        a.leg = leg;
        b.leg = leg;
        const fa = weather.forecast(a, ctx);
        const fb = weather.forecast(b, ctx);
        assert.deepEqual(fa, fb);
        for (const f of fa) {
          const offset = f.leg - leg;
          const actual = Core.weatherAt(a, f.leg);
          const roll = storyRandom(a, 300 + offset);
          if (roll < 0.22) {
            shifted++;
            assert.notEqual(f.weather, actual, '误差发生时预报应改变');
            assert.equal(Math.abs(chain.indexOf(f.weather) - chain.indexOf(actual)), 1, '误差只能换成相邻天气');
          } else {
            exact++;
            assert.equal(f.weather, actual, '无误差时应等于实际天气');
          }
        }
      }
    }
  }
  assert.ok(shifted > 0 && exact > 0, '样本应同时包含误差与准确预报');
});

test('forecast/panel/trade/echo/onChoice 不修改实际天气、weatherRolls、st.leg、st.time', () => {
  for (const route of ROUTES) {
    const st = newState(9, route);
    const total = Core.totalLegs(st);
    const rolls = st.weatherRolls.slice();
    const actual = [];
    for (let leg = 1; leg <= total; leg++) actual.push(Core.weatherAt(st, leg));
    const time = st.time;
    for (let leg = 1; leg <= total; leg++) {
      st.leg = leg;
      weather.forecast(st, ctx);
      weather.panelHTML(st, ctx);
      weather.echo(st, Core.cardAt(st), ctx);
      weather.trade(st, { shelter: true }, ctx);
      weather.onChoice(st, Core.cardAt(st), { shelter: true }, [], ctx);
      assert.equal(st.leg, leg, '模块不应改动 st.leg');
    }
    assert.deepEqual(st.weatherRolls, rolls, 'weatherRolls 被修改');
    for (let leg = 1; leg <= total; leg++) {
      assert.equal(Core.weatherAt(st, leg), actual[leg - 1], '实际天气被修改');
    }
    assert.equal(st.time, time, 'st.time 被修改');
  }
});

test('遮蔽 + 风/雨雪 设置 guard 并累计 waits；晴天、下撤、已结束不设置', () => {
  const st = newState(1, 'mountain');
  const state = st.sys.weather;
  const stormLeg = findLeg(st, 'storm');
  assert.ok(stormLeg > 0, '测试样本应有风暴章');

  const events = [];
  st.leg = stormLeg + 1;
  weather.onChoice(st, { id: 'mountain-' + stormLeg }, { shelter: true }, events, ctx);
  assert.equal(state.guard, 1);
  assert.equal(state.waits, 1);
  assert.ok(events.some(t => t.includes('队伍在遮蔽处观察了一个窗口')), '缺少等待事件文案');

  const clearLeg = findLeg(st, 'clear');
  assert.ok(clearLeg > 0, '测试样本应有晴天章');
  state.guard = 0;
  state.waits = 0;
  st.leg = clearLeg + 1;
  weather.onChoice(st, { id: 'mountain-' + clearLeg }, { shelter: true }, [], ctx);
  assert.equal(state.guard, 0, '晴天不应设置 guard');
  assert.equal(state.waits, 0);

  state.guard = 0;
  st.leg = stormLeg + 1;
  weather.onChoice(st, { id: 'mountain-' + stormLeg }, { shelter: true, retreat: true }, [], ctx);
  assert.equal(state.guard, 0, '下撤不应设置 guard');

  st.over = 'retreat';
  weather.onChoice(st, { id: 'mountain-' + stormLeg }, { shelter: true }, [], ctx);
  assert.equal(state.guard, 0, '已结束不应设置 guard');
  st.over = null;

  const notShelter = [];
  state.guard = 0;
  weather.onChoice(st, { id: 'mountain-' + stormLeg }, {}, notShelter, ctx);
  assert.equal(state.guard, 0, '非遮蔽选择不应设置 guard');
  assert.equal(notShelter.length, 0);
});

test('core 结算后 st.leg 已 +1 时按行动章判定；未 +1 时按 card.id 判定', () => {
  const st = newState(2, 'mountain');
  const stormLeg = findLeg(st, 'storm');

  const advanced = newState(2, 'mountain');
  advanced.leg = stormLeg + 1;
  weather.onChoice(advanced, null, { shelter: true }, [], ctx);
  assert.equal(advanced.sys.weather.guard, 1, 'leg 已 +1 且无 card.id 时应回看行动章');

  const notAdvanced = newState(2, 'mountain');
  notAdvanced.leg = stormLeg;
  weather.onChoice(notAdvanced, { id: 'mountain-' + stormLeg }, { shelter: true }, [], ctx);
  assert.equal(notAdvanced.sys.weather.guard, 1, 'leg 未 +1 时应使用 card.id 的章节');
});

test('guard 收益：非峡谷 +0.15°C / 峡谷 -0.15°C，体力 +2，消耗后清零', () => {
  const plain = newState(3, 'mountain');
  plain.temp = 36.8;
  plain.stamina = 50;
  plain.leg = 5;
  plain.sys.weather.guard = 1;
  const events = [];
  weather.onChoice(plain, { id: 'mountain-4' }, {}, events, ctx);
  assert.equal(plain.sys.weather.guard, 0);
  assert.ok(plain.temp > 36.8 && plain.temp <= 37.2, '非峡谷体温应小幅上升且不越界');
  assert.equal(plain.stamina, 52);
  assert.ok(events.some(t => t.includes('上一章的窗口让队伍以稍好的状态进入本章')), '缺少收益事件文案');

  const canyon = newState(3, 'canyon');
  canyon.temp = 37.0;
  canyon.stamina = 50;
  canyon.leg = 5;
  canyon.sys.weather.guard = 1;
  weather.onChoice(canyon, { id: 'canyon-4' }, {}, [], ctx);
  assert.equal(canyon.sys.weather.guard, 0);
  assert.ok(canyon.temp < 37.0 && canyon.temp >= 36.5, '峡谷体温应小幅下降且不越界');
  assert.equal(canyon.stamina, 52);

  const capped = newState(4, 'mountain');
  capped.temp = 37.2;
  capped.stamina = 100;
  capped.leg = 5;
  capped.sys.weather.guard = 1;
  weather.onChoice(capped, { id: 'mountain-4' }, {}, [], ctx);
  assert.ok(capped.temp <= 37.2, '体温上限 37.2');
  assert.equal(capped.stamina, 100, '体力上限 100');

  const floor = newState(4, 'canyon');
  floor.temp = 36.5;
  floor.stamina = 99;
  floor.leg = 5;
  floor.sys.weather.guard = 1;
  weather.onChoice(floor, { id: 'canyon-4' }, {}, [], ctx);
  assert.ok(floor.temp >= 36.5, '峡谷体温下限 36.5');
  assert.equal(floor.stamina, 100);
});

test('下一次行动中止或已结束时清除 guard 且不给收益', () => {
  const retreat = newState(5, 'mountain');
  retreat.temp = 36.8;
  retreat.stamina = 50;
  retreat.leg = 5;
  retreat.sys.weather.guard = 1;
  const events = [];
  weather.onChoice(retreat, { id: 'mountain-4' }, { retreat: true }, events, ctx);
  assert.equal(retreat.sys.weather.guard, 0);
  assert.equal(retreat.temp, 36.8);
  assert.equal(retreat.stamina, 50);
  assert.deepEqual(events, []);

  const finished = newState(5, 'mountain');
  finished.temp = 36.8;
  finished.stamina = 50;
  finished.leg = 5;
  finished.over = 'collapse';
  finished.sys.weather.guard = 1;
  const events2 = [];
  weather.onChoice(finished, { id: 'mountain-4' }, {}, events2, ctx);
  assert.equal(finished.sys.weather.guard, 0);
  assert.equal(finished.temp, 36.8);
  assert.equal(finished.stamina, 50);
  assert.deepEqual(events2, []);
});

test('等待最多 3 次，guard 不叠加', () => {
  const st = newState(6, 'mountain');
  const state = st.sys.weather;
  const stormLeg = findLeg(st, 'storm');
  for (let i = 0; i < 3; i++) {
    state.guard = 0;
    st.over = null;
    st.leg = stormLeg + 1;
    weather.onChoice(st, { id: 'mountain-' + stormLeg }, { shelter: true }, [], ctx);
    assert.equal(state.guard, 1, '第 ' + (i + 1) + ' 次等待应设置 guard');
    assert.equal(state.waits, i + 1);
  }
  state.guard = 0;
  st.leg = stormLeg + 1;
  weather.onChoice(st, { id: 'mountain-' + stormLeg }, { shelter: true }, [], ctx);
  assert.equal(state.waits, 3, 'waits 不应超过 3');
  assert.equal(state.guard, 0, '达到上限后不再设置 guard');

  state.waits = 0;
  state.guard = 1;
  st.leg = stormLeg + 1;
  weather.onChoice(st, { id: 'mountain-' + stormLeg }, { shelter: true }, [], ctx);
  assert.equal(state.guard, 1, 'guard 不能叠加为 2');
  assert.equal(state.waits, 1);
});

test('trade：仅遮蔽且当前为风/雨雪时追加窗口预报', () => {
  const st = newState(7, 'mountain');
  const stormLeg = findLeg(st, 'storm');
  const clearLeg = findLeg(st, 'clear');

  st.leg = stormLeg;
  const label = weather.trade(st, { shelter: true }, ctx);
  assert.ok(label.startsWith('窗口：下一章 '), 'trade 文案格式不符：' + label);
  assert.ok(/窗口：下一章 (晴|风|强风雨雪) \d+%$/.test(label));
  assert.equal(weather.trade(st, { shelter: true }), label, 'init 之后 trade 应能复用已绑定的 ctx');

  assert.equal(weather.trade(st, {}, ctx), '', '非遮蔽选择应返回空字符串');

  st.leg = clearLeg;
  assert.equal(weather.trade(st, { shelter: true }, ctx), '', '晴天遮蔽不应追加窗口');

  st.leg = Core.totalLegs(st);
  assert.equal(weather.trade(st, { shelter: true }, ctx), '', '终点章没有下一章预报');
});

test('panelHTML / endingHTML / echo 文案完整、已转义且无 undefined', () => {
  let escCalls = 0;
  const escCtx = Object.assign({}, ctx, {
    esc: s => { escCalls++; return ctx.esc(s); }
  });
  for (let seed = 1; seed <= 30; seed++) {
    for (const route of ROUTES) {
      const st = newState(seed, route);
      const total = Core.totalLegs(st);
      for (let leg = 1; leg <= total; leg++) {
        st.leg = leg;
        const panel = weather.panelHTML(st, escCtx);
        assert.ok(panel.startsWith('<p class="hintline">'), 'panel 必须使用 hintline');
        assert.ok(panel.includes('情景预报'), 'panel 缺少情景预报');
        assert.ok(panel.includes('非导航'), 'panel 缺少非导航');
        assert.ok(!/undefined|NaN|null/.test(panel), 'panel 出现 undefined/NaN/null');
        if (leg === total) assert.ok(panel.includes('已到终点章'));
        const cur = Core.weatherAt(st, leg);
        if (cur === 'storm') assert.ok(panel.includes('当前：强风雨雪（已知）'));
        else assert.ok(!panel.includes('当前：'));

        const end = weather.endingHTML(st, escCtx);
        assert.ok(end.startsWith('<p class="hintline">'));
        assert.ok(end.includes('天气窗口') && end.includes('本局等待'));
        assert.ok(!/undefined|NaN|null/.test(end));

        const echo = weather.echo(st, Core.cardAt(st), escCtx);
        assert.ok(Array.isArray(echo.alerts));
        echo.alerts.forEach(a => assert.equal(typeof a, 'string'));
        assert.ok(echo.science.includes('山区天气变化快'));
        assert.ok(!/官方预报|气象局|气象台/.test(echo.alerts.join(' ') + echo.science));
      }
    }
  }
  assert.ok(escCalls > 0, 'panel/ending 必须通过 ctx.esc 转义动态文本');
});

test('echo 预警：当前风暴、下一章风暴（置信度≥60）、已等待', () => {
  const stormState = newState(8, 'mountain');
  const stormLeg = findLeg(stormState, 'storm');
  stormState.leg = stormLeg;
  let echo = weather.echo(stormState, Core.cardAt(stormState), ctx);
  assert.ok(echo.alerts.some(a => a.includes('当前就是强风雨雪')));

  stormState.sys.weather.guard = 1;
  echo = weather.echo(stormState, Core.cardAt(stormState), ctx);
  assert.ok(echo.alerts.some(a => a.includes('已选择等待窗口')));

  let found = false;
  for (let seed = 1; seed <= 100 && !found; seed++) {
    for (const route of ROUTES) {
      const st = newState(seed, route);
      for (let leg = 1; leg < Core.totalLegs(st); leg++) {
        st.leg = leg;
        const list = weather.forecast(st, ctx);
        if (list[0] && list[0].weather === 'storm' && list[0].confidence >= 60) {
          const e = weather.echo(st, Core.cardAt(st), ctx);
          assert.ok(e.alerts.some(a => a.includes('下一章可能转强风雨雪')), '缺少下一章风暴预警');
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }
  assert.ok(found, '样本中未找到下一章风暴预警场景');
});

test('50 seed × 3 路线全流程：状态无负数、NaN，预报/等待/收益稳定', () => {
  let runs = 0;
  let totalWaits = 0;
  let totalGains = 0;
  for (let seed = 1; seed <= 50; seed++) {
    for (const route of ROUTES) {
      const st = Core.newRun(seed, undefined, route);
      weather.init(st, ctx);
      let steps = 0;
      while (!st.over && steps <= Core.totalLegs(st) + 5) {
        steps++;
        const card = Core.cardAt(st);
        const choices = card.choices || [];
        let idx = choices.findIndex(ch => ch.shelter && !ch.retreat && Core.choiceEnabled(st, ch));
        if (idx < 0) idx = choices.findIndex(ch => Core.choiceEnabled(st, ch));
        if (idx < 0) break;
        const ch = choices[idx];
        const guardBefore = st.sys.weather.guard;
        const res = Core.applyChoice(st, idx);
        if (!res) break;
        const events = [];
        weather.onChoice(st, card, ch, events, ctx);
        if (guardBefore === 1 && !ch.retreat && !st.over) {
          assert.ok(events.some(t => t.includes('上一章的窗口')), 'guard 消耗应产生收益文案');
          totalGains++;
        }
        if (events.some(t => t.includes('队伍在遮蔽处观察了一个窗口'))) totalWaits++;
        assert.ok(st.sys.weather.guard === 0 || st.sys.weather.guard === 1);
        assert.ok(Number.isSafeInteger(st.sys.weather.waits) && st.sys.weather.waits >= 0 && st.sys.weather.waits <= 3);
        assert.ok(Number.isFinite(st.stamina) && st.stamina >= 0 && st.stamina <= 100);
        assert.ok(Number.isFinite(st.temp));
        assert.ok(Number.isFinite(st.water) && st.water >= 0);
        const list = weather.forecast(st, ctx);
        checkForecast(st, list);
        const panel = weather.panelHTML(st, ctx);
        assert.ok(!/undefined|NaN|null/.test(panel));
        for (const option of choices) {
          const label = weather.trade(st, option, ctx);
          assert.equal(typeof label, 'string');
          assert.ok(!/undefined|NaN|null/.test(label));
        }
        const echo = weather.echo(st, card, ctx);
        assert.ok(echo.alerts.every(a => typeof a === 'string'));
      }
      assert.ok(st.over, 'seed ' + seed + ' / ' + route + ' 未产生结局');
      const end = weather.endingHTML(st, ctx);
      assert.ok(!/undefined|NaN|null/.test(end));
      runs++;
    }
  }
  assert.equal(runs, 150);
  assert.ok(totalWaits > 0, '样本中应至少触发一次窗口等待');
  assert.ok(totalGains > 0, '样本中应至少触发一次窗口收益');
});

console.log('\n' + count + ' tests passed');
