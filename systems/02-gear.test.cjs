'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

delete globalThis.EchoSystems;
require(path.join(__dirname, '02-gear.js'));
const gear = globalThis.EchoSystems && globalThis.EchoSystems.gear;
assert.ok(gear, '模块必须挂到 globalThis.EchoSystems.gear');
for (const fn of ['init', 'onChoice', 'choiceEnabled', 'trade', 'panelHTML', 'endingHTML', 'echo']){
  assert.strictEqual(typeof gear[fn], 'function', '缺少接口 ' + fn);
}

function loadCore(){
  const html = fs.readFileSync(path.join(__dirname, '..', 'game.html'), 'utf8');
  const start = html.indexOf('function mulberry32');
  const anchor = html.indexOf('/* expose for tests / UI */');
  assert.ok(start >= 0 && anchor > start, '无法定位 game.html 的 Core 起始段');
  const coreAt = html.indexOf('var Core =', anchor);
  assert.ok(coreAt > anchor, '无法定位 game.html 的 Core 导出');
  const end = html.indexOf('\n', coreAt);
  const source = html.slice(start, end);
  return new Function(source + '\nreturn Core;')();
}

const Core = loadCore();
const ROUTES = ['mountain', 'forest', 'canyon'];

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const ctx = {
  r2: v => Math.round(v * 100) / 100,
  r1: v => Math.round(v * 10) / 10,
  clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  esc,
  weatherAt: (st, leg) => Core.weatherAt(st, leg),
  storyRandom: st => (st.seed % 997) / 997,
  totalLegs: st => Core.totalLegs(st),
  C: (label, fx, extra) => Object.assign({ label, fx }, extra)
};

const NO_GEAR = { lamp:0, poles:0, jacket:0, sleepingbag:0, mat:0 };
const LAMP_DEAD = '头灯电量耗尽：后续夜行按无灯处理。';
const POLES_DEAD = '杖尖磨平：后续不再享受省力加成，但仍可选择安全路线。';
const JACKET_DEAD = '外层防风雨性能失效：后续散热结算不再获得外层减免。';
const CAMP_NOTE = '营地维护：可修复的装备恢复少量耐久；这不是现实维修保证。';
const SLEEP_NOTE = '睡眠装备缺失或损耗影响恢复；游戏只扣少量体力，不模拟真实失温。';
const LOW_ALERT = '装备接近失效：继续使用会把风险留到后面，营地维护优先。';
const DEAD_ALERT = '已有装备失效：本局后续不再享受对应加成，必要时中止。';
const SCIENCE = '装备只能降低部分风险，不能替代路线判断、休息和撤退；损坏的装备不要假设仍能提供保护。';

function loadout(overrides){
  const lo = Object.assign({}, Core.DEFAULT_LOADOUT, overrides || {});
  const error = Core.loadoutError(lo);
  assert.strictEqual(error, '', '测试配装必须合法：' + error);
  return lo;
}

function state(routeId, overrides, seed){
  const st = Core.newRun(seed === undefined ? 1 : seed, loadout(overrides), routeId || 'mountain');
  st.sys = {};
  gear.init(st, ctx);
  setWeather(st, 'clear');
  return st;
}

function setWeather(st, weather){
  st.log = [{ leg: st.leg, weather }];
}

function card(kind){
  return { id:'test-' + kind, kind, title:'测试章节', text:'', choices:[] };
}

function choice(extra){
  return Object.assign({ label:'测试选择', fx:{ st:0, t:0.7 } }, extra || {});
}

function settle(st, kind, extra){
  const events = [];
  gear.onChoice(st, card(kind), choice(extra), events, ctx);
  return events;
}

function count(list, text){
  return list.filter(x => x === text).length;
}

function wearOf(st){
  return st.sys.wear;
}

function assertWear(st, key, value, label){
  assert.strictEqual(wearOf(st)[key], value, (label || key) + ' 期望 ' + value + '，实际 ' + wearOf(st)[key]);
}

function assertBounds(st, label){
  for (const key of ['lamp', 'poles', 'jacket', 'sleepingbag', 'mat']){
    const value = wearOf(st)[key];
    assert.ok(Number.isInteger(value), label + ' ' + key + ' 必须是整数，实际 ' + value);
    assert.ok(value >= 0 && value <= 100, label + ' ' + key + ' 越界：' + value);
  }
  assert.ok(Number.isFinite(st.stamina) && st.stamina >= 0 && st.stamina <= 100, label + ' 体力越界');
}

function assertFlags(st, label){
  for (const key of ['lamp', 'poles', 'jacket']){
    const expected = Number(st.initialLoadout[key]) > 0 && wearOf(st)[key] > 0;
    assert.strictEqual(st[key], expected, label + ' ' + key + ' 布尔值与耐久不同步');
  }
}

const tests = [];
function test(name, fn){
  tests.push({ name, fn });
}

test('三条路线初始化：携带为 100，未携带为 0，布尔值同步', () => {
  for (const route of ROUTES){
    const full = state(route, {}, 11);
    assert.deepStrictEqual(wearOf(full), { lamp:100, poles:100, jacket:100, sleepingbag:100, mat:100 });
    assert.strictEqual(full.lamp, true);
    assert.strictEqual(full.poles, true);
    assert.strictEqual(full.jacket, true);

    const bare = state(route, NO_GEAR, 11);
    assert.deepStrictEqual(wearOf(bare), { lamp:0, poles:0, jacket:0, sleepingbag:0, mat:0 });
    assert.strictEqual(bare.lamp, false);
    assert.strictEqual(bare.poles, false);
    assert.strictEqual(bare.jacket, false);

    const mixed = state(route, { lamp:0, poles:1, jacket:0, sleepingbag:1, mat:0 }, 11);
    assert.deepStrictEqual(wearOf(mixed), { lamp:0, poles:100, jacket:0, sleepingbag:100, mat:0 });
    assert.strictEqual(mixed.lamp, false);
    assert.strictEqual(mixed.poles, true);
    assert.strictEqual(mixed.jacket, false);
  }

  const kept = state('mountain', {}, 12);
  kept.sys.other = { untouched:true };
  gear.init(kept, ctx);
  assert.deepStrictEqual(kept.sys.other, { untouched:true }, 'init 不得清空其他系统状态');
});

test('夜行只耗头灯：无灯与等待不耗电', () => {
  const st = state('mountain', {}, 3);
  st.flags.wet = 0;
  const events = settle(st, 'night', { nightSafe:true });
  assertWear(st, 'lamp', 88, '夜行');
  assertWear(st, 'poles', 100, '夜行');
  assertWear(st, 'jacket', 100, '夜行');
  assert.strictEqual(st.lamp, true);
  assert.deepStrictEqual(events, []);

  st.sys.wear.lamp = 0;
  st.lamp = false;
  const dark = settle(st, 'night', { nightSafe:true });
  assertWear(st, 'lamp', 0, '无灯夜行');
  assert.deepStrictEqual(dark, [], '无灯夜行不应产生扣电提示');

  const wait = state('mountain', {}, 3);
  wait.flags.wet = 0;
  settle(wait, 'night', { shelter:true });
  assertWear(wait, 'lamp', 100, '夜行等待');
});

test('碎石与偏航只耗登山杖，普通路径不动耐久', () => {
  const terrain = state('mountain', {}, 4);
  settle(terrain, 'terrain', {});
  assertWear(terrain, 'poles', 92);
  assertWear(terrain, 'lamp', 100);
  assertWear(terrain, 'jacket', 100);

  const detour = state('mountain', {}, 4);
  settle(detour, 'path', { detour:true });
  assertWear(detour, 'poles', 92);

  const path = state('mountain', {}, 4);
  settle(path, 'path', { navigate:true });
  assertWear(path, 'poles', 100);
});

test('潮湿、暴雨与受热只耗外层，其他选择不动耐久', () => {
  const wet = state('mountain', {}, 5);
  wet.flags.wet = 1;
  settle(wet, 'dry', {});
  assertWear(wet, 'jacket', 95);
  assertWear(wet, 'lamp', 100);
  assertWear(wet, 'poles', 100);

  const storm = state('mountain', {}, 5);
  storm.flags.wet = 0;
  setWeather(storm, 'storm');
  settle(storm, 'shelter', {});
  assertWear(storm, 'jacket', 95);

  const heat = state('canyon', {}, 5);
  heat.flags.wet = 0;
  settle(heat, 'heat', { heat:true });
  assertWear(heat, 'jacket', 95);

  const quiet = state('mountain', {}, 5);
  quiet.flags.wet = 0;
  settle(quiet, 'pace', {});
  assert.deepStrictEqual(wearOf(quiet), { lamp:100, poles:100, jacket:100, sleepingbag:100, mat:100 });
});

test('未携带的装备不凭空磨损，也不被维护复活', () => {
  const st = state('mountain', NO_GEAR, 13);
  settle(st, 'night', { nightSafe:true });
  settle(st, 'terrain', { detour:true });
  st.flags.wet = 1;
  setWeather(st, 'storm');
  settle(st, 'heat', { heat:true });
  assert.deepStrictEqual(wearOf(st), { lamp:0, poles:0, jacket:0, sleepingbag:0, mat:0 });
  assert.strictEqual(st.lamp, false);
  assert.strictEqual(st.poles, false);
  assert.strictEqual(st.jacket, false);

  const events = settle(st, 'camp', { camp:true });
  assert.deepStrictEqual(wearOf(st), { lamp:0, poles:0, jacket:0, sleepingbag:0, mat:0 });
  assert.strictEqual(st.lamp, false);
  assert.strictEqual(st.poles, false);
  assert.strictEqual(st.jacket, false);
  assert.strictEqual(count(events, CAMP_NOTE), 0, '无可维护装备时不写维护文案');
});

test('耐久归零：同步布尔值、钳制到 0、失效文案只出现一次', () => {
  const lamp = state('mountain', {}, 6);
  let lampEvents = [];
  for (let i = 0; i < 12; i++) lampEvents = lampEvents.concat(settle(lamp, 'night', { nightSafe:true }));
  assertWear(lamp, 'lamp', 0);
  assert.strictEqual(lamp.lamp, false);
  assert.strictEqual(count(lampEvents, LAMP_DEAD), 1, '头灯失效提示只能出现一次');

  const poles = state('mountain', {}, 6);
  let poleEvents = [];
  for (let i = 0; i < 15; i++) poleEvents = poleEvents.concat(settle(poles, 'terrain', {}));
  assertWear(poles, 'poles', 0);
  assert.strictEqual(poles.poles, false);
  assert.strictEqual(count(poleEvents, POLES_DEAD), 1, '登山杖失效提示只能出现一次');

  const jacket = state('mountain', {}, 6);
  jacket.flags.wet = 1;
  let jacketEvents = [];
  for (let i = 0; i < 22; i++) jacketEvents = jacketEvents.concat(settle(jacket, 'dry', {}));
  assertWear(jacket, 'jacket', 0);
  assert.strictEqual(jacket.jacket, false);
  assert.strictEqual(count(jacketEvents, JACKET_DEAD), 1, '外层失效提示只能出现一次');
  assertBounds(jacket, '外层归零');

  const broken = state('mountain', {}, 6);
  broken.sys.wear = { lamp:0, poles:0, jacket:0, sleepingbag:100, mat:100 };
  broken.lamp = false;
  broken.poles = false;
  broken.jacket = false;
  const events = settle(broken, 'camp', { camp:true });
  assertWear(broken, 'lamp', 12);
  assertWear(broken, 'poles', 12);
  assertWear(broken, 'jacket', 12);
  assert.strictEqual(broken.lamp, true, '维护后应恢复头灯布尔值');
  assert.strictEqual(broken.poles, true, '维护后应恢复登山杖布尔值');
  assert.strictEqual(broken.jacket, true, '维护后应恢复外层布尔值');
  assert.strictEqual(count(events, CAMP_NOTE), 1);
});

test('营地维护只加一次；poorCamp 不维护；睡眠低耐久只扣一次', () => {
  const good = state('mountain', {}, 7);
  good.sys.wear = { lamp:50, poles:50, jacket:50, sleepingbag:100, mat:100 };
  good.stamina = 60;
  const goodEvents = settle(good, 'camp', { camp:true });
  assertWear(good, 'lamp', 62);
  assertWear(good, 'poles', 62);
  assertWear(good, 'jacket', 62);
  assert.strictEqual(good.stamina, 60, '睡眠装备完好时不扣体力');
  assert.strictEqual(count(goodEvents, CAMP_NOTE), 1, '同一次营地维护只提示一次');

  const poor = state('mountain', {}, 7);
  poor.sys.wear = { lamp:50, poles:50, jacket:50, sleepingbag:100, mat:100 };
  poor.stamina = 60;
  const poorEvents = settle(poor, 'camp', { camp:true, poorCamp:true });
  assert.deepStrictEqual(wearOf(poor), { lamp:50, poles:50, jacket:50, sleepingbag:100, mat:100 });
  assert.strictEqual(poor.stamina, 60);
  assert.strictEqual(count(poorEvents, CAMP_NOTE), 0);
  assert.strictEqual(count(poorEvents, SLEEP_NOTE), 0);

  const both = state('mountain', {}, 7);
  both.sys.wear = { lamp:100, poles:100, jacket:100, sleepingbag:10, mat:10 };
  both.stamina = 60;
  const bothEvents = settle(both, 'camp', { camp:true });
  assertWear(both, 'sleepingbag', 22);
  assertWear(both, 'mat', 22);
  assert.strictEqual(both.stamina, 52, '两者都低只扣 8，不叠加两次');
  assert.strictEqual(count(bothEvents, SLEEP_NOTE), 1);

  const one = state('mountain', {}, 7);
  one.sys.wear = { lamp:100, poles:100, jacket:100, sleepingbag:10, mat:100 };
  one.stamina = 60;
  settle(one, 'camp', { camp:true });
  assertWear(one, 'sleepingbag', 22);
  assert.strictEqual(one.stamina, 56, '只有一件低耐久时扣 4');

  const floor = state('mountain', {}, 7);
  floor.sys.wear = { lamp:100, poles:100, jacket:100, sleepingbag:0, mat:0 };
  floor.stamina = 3;
  settle(floor, 'camp', { camp:true });
  assert.strictEqual(floor.stamina, 0, '睡眠扣体力不得低于 0');

  const bare = state('mountain', NO_GEAR, 7);
  bare.stamina = 60;
  const bareEvents = settle(bare, 'camp', { camp:true });
  assert.strictEqual(bare.stamina, 52, '未携带睡具按 0 处理，恢复受影响');
  assert.strictEqual(count(bareEvents, CAMP_NOTE), 0, '无耐用品时不写维护文案');
  assert.strictEqual(count(bareEvents, SLEEP_NOTE), 1);
});

test('面板只列携带且低于 90 或失效的装备，并走 ctx.esc', () => {
  const st = state('mountain', {}, 9);
  st.sys.wear = { lamp:64, poles:32, jacket:100, sleepingbag:88, mat:0 };
  const html = gear.panelHTML(st, ctx);
  assert.ok(html.startsWith('<p class="statusline">'), '面板应沿用 statusline');
  assert.ok(html.endsWith('</p>'));
  assert.ok(html.includes('头灯 64%'));
  assert.ok(html.includes('登山杖 32%'));
  assert.ok(html.includes('睡袋 88%'));
  assert.ok(html.includes('防潮垫 失效'));
  assert.ok(!html.includes('外层'), '完好装备不应刷屏');
  assert.ok(!/undefined|NaN|null/.test(html));

  st.sys.wear.sleepingbag = 90;
  assert.ok(!gear.panelHTML(st, ctx).includes('睡袋'), '90 不应显示');
  st.sys.wear.sleepingbag = 89;
  assert.ok(gear.panelHTML(st, ctx).includes('睡袋 89%'));

  const pristine = state('mountain', {}, 9);
  assert.strictEqual(gear.panelHTML(pristine, ctx), '');
  const bare = state('mountain', NO_GEAR, 9);
  assert.strictEqual(gear.panelHTML(bare, ctx), '');

  st.sys.wear = { lamp:64, poles:32, jacket:100, sleepingbag:88, mat:0 };
  const wrapped = gear.panelHTML(st, Object.assign({}, ctx, { esc: s => '[' + s + ']' }));
  assert.ok(wrapped.includes('[头灯]'), '动态名称必须经过 ctx.esc');
  assert.ok(wrapped.includes('[64]'), '动态数值必须经过 ctx.esc');
});

test('选项副标题按装备与章节类型追加，不产生 undefined', () => {
  const st = state('mountain', {}, 9);
  assert.strictEqual(gear.trade(st, choice({ nightSafe:true })), '', '满电不刷屏');
  assert.strictEqual(gear.trade(st, choice({ detour:true })), '', '完好登山杖不刷屏');
  assert.strictEqual(gear.trade(st, choice({}), card('terrain')), '', '完好登山杖不刷屏');
  assert.strictEqual(gear.trade(st, choice({ careful:true })), '', '无 card 参数时也不刷屏');
  assert.strictEqual(gear.trade(st, choice({ camp:true })), '营地可维护');
  assert.strictEqual(gear.trade(st, choice({})), '');
  assert.strictEqual(gear.trade(st, choice({ retreat:true })), '');
  assert.strictEqual(gear.trade(st, choice({ shelter:true })), '');

  st.sys.wear.lamp = 0;
  st.sys.wear.poles = 0;
  assert.strictEqual(gear.trade(st, choice({ nightSafe:true })), '无头灯');
  assert.strictEqual(gear.trade(st, choice({ detour:true })), '登山杖失效');
  assert.ok(!/undefined|NaN/.test(gear.trade(st, choice({ nightSafe:true })) + gear.trade(st, choice({ detour:true }))));

  st.sys.wear.lamp = 25;
  assert.strictEqual(gear.trade(st, choice({ nightSafe:true })), '头灯 25% · 电量低');
  st.sys.wear.lamp = 26;
  assert.strictEqual(gear.trade(st, choice({ nightSafe:true })), '');
  st.sys.wear.poles = 25;
  assert.strictEqual(gear.trade(st, choice({ detour:true })), '登山杖偏低 25%');
  st.sys.wear.poles = 26;
  assert.strictEqual(gear.trade(st, choice({ detour:true })), '');

  assert.strictEqual(gear.choiceEnabled(st, choice({})), true);
  assert.strictEqual(gear.choiceEnabled(st, choice({ eventForward:true })), true, '不得重复核心判断');
});

test('Echo 警示阈值与科普文案', () => {  const st = state('mountain', {}, 10);
  st.sys.wear = { lamp:25, poles:100, jacket:100, sleepingbag:100, mat:100 };
  const low = gear.echo(st, card('pace'), ctx);
  assert.deepStrictEqual(low.alerts, [LOW_ALERT]);
  assert.strictEqual(low.science, SCIENCE);

  st.sys.wear.lamp = 0;
  const dead = gear.echo(st, card('pace'), ctx);
  assert.deepStrictEqual(dead.alerts, [DEAD_ALERT]);

  st.sys.wear = { lamp:25, poles:0, jacket:100, sleepingbag:100, mat:100 };
  const both = gear.echo(st, card('terrain'), ctx);
  assert.deepStrictEqual(both.alerts, [LOW_ALERT, DEAD_ALERT]);

  const bare = state('mountain', NO_GEAR, 10);
  const none = gear.echo(bare, card('pace'), ctx);
  assert.deepStrictEqual(none.alerts, [], '未携带装备归零不应误报失效');
  assert.strictEqual(none.science, SCIENCE);

  assert.deepStrictEqual(gear.echo({}, card('pace'), ctx).alerts, []);
});

test('结局装备记录只统计携带与失效数量', () => {
  const st = state('mountain', {}, 10);
  st.sys.wear = { lamp:100, poles:100, jacket:0, sleepingbag:100, mat:0 };
  const html = gear.endingHTML(st, ctx);
  assert.ok(html.includes('5 件耐用品'));
  assert.ok(html.includes('2 件已失效'));
  assert.ok(!/undefined|NaN|null/.test(html));

  const wrapped = gear.endingHTML(st, Object.assign({}, ctx, { esc: s => '[' + s + ']' }));
  assert.ok(wrapped.includes('[2]'), '结局动态数字必须经过 ctx.esc');

  const bare = state('mountain', NO_GEAR, 10);
  assert.strictEqual(gear.endingHTML(bare, ctx), '', '没有耐用品时不写装备记录');
  assert.strictEqual(gear.endingHTML({}, ctx), '');
});

test('同一 seed/路线/配装初始化一致，100 个 seed 无 NaN 或负值', () => {
  for (let seed = 0; seed < 100; seed++){
    const route = ROUTES[seed % ROUTES.length];
    const lo = loadout({
      lamp: seed % 2 ? 1 : 0,
      poles: seed % 3 ? 1 : 0,
      jacket: seed % 5 ? 1 : 0,
      sleepingbag: seed % 7 ? 1 : 0,
      mat: seed % 11 ? 1 : 0
    });
    const a = Core.newRun(seed, lo, route);
    a.sys = { other:{ keep:seed } };
    gear.init(a, ctx);
    const b = Core.newRun(seed, lo, route);
    b.sys = {};
    gear.init(b, ctx);
    assert.deepStrictEqual(wearOf(a), wearOf(b), 'seed ' + seed + ' 初始化不确定');
    assert.deepStrictEqual(Object.keys(wearOf(a)).sort(), ['jacket', 'lamp', 'mat', 'poles', 'sleepingbag']);
    assert.deepStrictEqual(a.sys.other, { keep:seed });
    for (const key of ['lamp', 'poles', 'jacket', 'sleepingbag', 'mat']){
      const value = wearOf(a)[key];
      assert.ok(Number.isInteger(value), 'seed ' + seed + ' ' + key + ' 非整数');
      assert.ok(value >= 0 && value <= 100, 'seed ' + seed + ' ' + key + ' 越界');
    }
    assertFlags(a, 'seed ' + seed);
  }
});

test('随机选择序列：耐久不越界、布尔同步、不限改核心字段', () => {
  let rng = 0x12345678;
  const rand = () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  const kinds = ['night', 'terrain', 'path', 'camp', 'heat', 'dry', 'supply', 'shelter', 'food', 'exit'];
  const weathers = ['clear', 'wind', 'storm'];

  for (let seed = 0; seed < 100; seed++){
    const route = ROUTES[seed % ROUTES.length];
    const st = Core.newRun(seed, loadout({
      lamp: seed % 3 ? 1 : 0,
      poles: seed % 4 ? 1 : 0,
      jacket: seed % 5 ? 1 : 0,
      sleepingbag: seed % 2 ? 1 : 0,
      mat: seed % 2 ? 1 : 0
    }), route);
    st.sys = {};
    gear.init(st, ctx);
    st.sys.other = { keep:'yes' };

    for (let step = 0; step < 40; step++){
      const kind = kinds[Math.floor(rand() * kinds.length)];
      const extra = {
        nightSafe: rand() < 0.6,
        detour: rand() < 0.3,
        camp: rand() < 0.35,
        poorCamp: rand() < 0.3,
        heat: rand() < 0.25,
        shelter: rand() < 0.3,
        risk: rand() < 0.2 ? 0.3 : 0
      };
      setWeather(st, weathers[Math.floor(rand() * weathers.length)]);
      st.flags.wet = Math.floor(rand() * 3);
      st.stamina = 100;

      const leg = st.leg, water = st.water, waste = st.waste;
      const wasteVolume = st.wasteVolume, total = Core.totalLegs(st);
      const events = [];
      gear.onChoice(st, card(kind), choice(extra), events, ctx);

      assert.strictEqual(st.leg, leg, 'onChoice 不得改章节');
      assert.strictEqual(st.water, water, 'onChoice 不得改水量');
      assert.strictEqual(st.waste, waste, 'onChoice 不得改携出物');
      assert.strictEqual(st.wasteVolume, wasteVolume, 'onChoice 不得改携出物体积');
      assert.strictEqual(Core.totalLegs(st), total, 'onChoice 不得改路线长度');
      assert.deepStrictEqual(st.sys.other, { keep:'yes' });
      assert.ok(events.every(x => typeof x === 'string' && x.length > 0));
      assertBounds(st, 'seed ' + seed + ' step ' + step);
      assertFlags(st, 'seed ' + seed + ' step ' + step);
    }
  }
});

test('与真实 Core 接线：三条路线可推进且 onChoice 不篡改结算结果', () => {
  for (const route of ROUTES){
    for (const seed of [1, 2, 3]){
      const st = Core.newRun(seed, loadout({}), route);
      st.sys = {};
      gear.init(st, ctx);
      let steps = 0;

      while (!st.over && steps < 60){
        const current = Core.cardAt(st);
        const idx = current.choices.findIndex(ch => !ch.retreat && Core.choiceEnabled(st, ch));
        if (idx < 0) break;
        const ch = current.choices[idx];
        const result = Core.applyChoice(st, idx);
        if (!result) break;

        const leg = st.leg, water = st.water, waste = st.waste;
        const wasteVolume = st.wasteVolume, total = Core.totalLegs(st);
        const events = [];
        gear.onChoice(st, current, ch, events, ctx);

        assert.strictEqual(st.leg, leg, route + ' onChoice 改了章节');
        assert.strictEqual(st.water, water, route + ' onChoice 改了水量');
        assert.strictEqual(st.waste, waste, route + ' onChoice 改了携出物');
        assert.strictEqual(st.wasteVolume, wasteVolume, route + ' onChoice 改了携出物体积');
        assert.strictEqual(Core.totalLegs(st), total, route + ' onChoice 改了路线长度');
        assertBounds(st, route + ' seed ' + seed);
        assertFlags(st, route + ' seed ' + seed);
        assert.strictEqual(Core.inventoryError(st), '', route + ' 库存状态被破坏');
        if (events.some(x => typeof x !== 'string' || !x)) break;

        steps++;
        if (result.end) break;
      }

      assert.ok(steps > 0, route + ' seed ' + seed + ' 未推进任何章节');
    }
  }
});

test('模块静态约束：无 DOM、真实时间、网络与 Math.random 依赖', () => {
  const source = fs.readFileSync(path.join(__dirname, '02-gear.js'), 'utf8');
  for (const forbidden of ['document', 'window.location', 'Math.random', 'Date.now', 'fetch(', 'XMLHttpRequest', 'localStorage', 'innerHTML', 'setTimeout']){
    assert.ok(!source.includes(forbidden), '模块不得依赖 ' + forbidden);
  }
  assert.ok(source.includes('EchoSystems'), '模块必须挂到 EchoSystems');
  assert.ok(source.includes('ctx.esc'), 'HTML 片段必须使用 ctx.esc');
});

let failed = 0;
for (const item of tests){
  try {
    item.fn();
    console.log('PASS  ' + item.name);
  } catch (error) {
    failed++;
    console.log('FAIL  ' + item.name);
    console.log('      ' + String(error && error.stack || error).split('\n').slice(0, 6).join('\n      '));
  }
}

console.log('');
if (failed){
  console.log(failed + ' / ' + tests.length + ' 项失败');
  process.exitCode = 1;
} else {
  console.log('全部通过：' + tests.length + ' 项');
}
