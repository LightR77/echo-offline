'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('./04-eco.js');
const eco = globalThis.EchoSystems && globalThis.EchoSystems.eco;
assert.ok(eco, 'globalThis.EchoSystems.eco 未注册');
assert.equal(typeof eco.init, 'function', '缺少 init');
assert.equal(typeof eco.onChoice, 'function', '缺少 onChoice');
assert.equal(typeof eco.choiceEnabled, 'function', '缺少 choiceEnabled');
assert.equal(typeof eco.trade, 'function', '缺少 trade');
assert.equal(typeof eco.panelHTML, 'function', '缺少 panelHTML');
assert.equal(typeof eco.endingHTML, 'function', '缺少 endingHTML');
assert.equal(typeof eco.echo, 'function', '缺少 echo');
assert.equal(typeof eco.score, 'function', '缺少 score');

const ROUTES = ['mountain', 'forest', 'canyon'];
const ROUTE_SALT = { mountain: 171, forest: 927, canyon: 305 };
const KEYS = ['litter', 'water', 'wildlife', 'trail', 'restored', 'permitAck'];

function escapeHTML(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const ctx = {
  esc: escapeHTML,
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
  r2: v => Math.round(v * 100) / 100,
  r1: v => Math.round(v * 10) / 10,
  storyRandom: () => 0.5,
  totalLegs: 18,
  C: () => ({})
};

function makeState(routeId = 'mountain') {
  return {
    seed: 20261120,
    routeId,
    leg: 1,
    waste: 0.37,
    wasteVolume: 0.74,
    flags: { litter: 2, foodOpen: false },
    environment: [{ day: 1, stop: '起点', text: '既有记录' }],
    sys: {}
  };
}

function fresh(routeId = 'mountain') {
  const st = makeState(routeId);
  eco.init(st, ctx);
  return st;
}

function apply(st, ch, card = { kind: 'path' }) {
  eco.onChoice(st, card, ch, [], ctx);
  return st.sys.eco;
}

function counts(e) {
  return { litter: e.litter, wildlife: e.wildlife, water: e.water, trail: e.trail, restored: e.restored };
}

function withLedger(partial) {
  const st = fresh();
  Object.assign(st.sys.eco, partial);
  return st;
}

const passed = [];
function test(name, fn) {
  fn();
  passed.push(name);
}

test('init 三条路线均为全零账本，且不创建其他系统键', () => {
  for (const routeId of ROUTES) {
    for (const seed of [0, 1, 20261120, 0xffffffff]) {
      const st = makeState(routeId);
      st.seed = seed;
      st.sys = { party: { size: 2 } };
      eco.init(st, ctx);
      assert.deepStrictEqual(st.sys.eco, { litter: 0, wildlife: 0, water: 0, trail: 0, restored: 0, permitAck: false });
      assert.deepStrictEqual(st.sys.party, { size: 2 }, 'init 不应改动其他系统');
    }
  }
});

test('init 可覆盖脏账本，且两个状态不共享对象', () => {
  const a = fresh();
  apply(a, { litter: true }, { kind: 'trash' });
  eco.init(a, ctx);
  assert.deepStrictEqual(a.sys.eco, { litter: 0, wildlife: 0, water: 0, trail: 0, restored: 0, permitAck: false });

  const b = fresh();
  a.sys.eco.litter = 5;
  assert.equal(b.sys.eco.litter, 0, '账本对象不应跨局共享');
});

test('选择标记只累加对应类别，每个类别每次最多 +1', () => {
  const cases = [
    [{ litter: true }, { litter: 1 }],
    [{ pollute: true }, { water: 1 }],
    [{ damage: true }, { trail: 1 }],
    [{ detour: true }, { trail: 1 }],
    [{ damage: true, detour: true }, { trail: 1 }],
    [{ foodOpen: true }, { wildlife: 1 }],
    [{ waste: 0.05 }, { restored: 1 }],
    [{ dispose: true }, { restored: 1 }],
    [{ waste: 0.05, dispose: true, eco: '捡回并封存。' }, { restored: 1 }]
  ];
  for (const [ch, expected] of cases) {
    const st = fresh();
    const e = apply(st, ch);
    const want = { litter: 0, wildlife: 0, water: 0, trail: 0, restored: 0, ...expected };
    assert.deepStrictEqual(counts(e), want, JSON.stringify(ch));
    assert.equal(e.permitAck, false);
  }
});

test('同一标记重复选择持续累计', () => {
  const st = fresh();
  for (let i = 0; i < 3; i++) apply(st, { litter: true });
  for (let i = 0; i < 2; i++) apply(st, { pollute: true });
  apply(st, { detour: true });
  apply(st, { foodOpen: true });
  apply(st, { waste: 0.06 });
  assert.deepStrictEqual(counts(st.sys.eco), { litter: 3, wildlife: 1, water: 2, trail: 1, restored: 1 });
});

test('ch.eco 关键词：让路/野生动物 降低 wildlife，下限 0', () => {
  const st = fresh();
  apply(st, { foodOpen: true });
  assert.equal(st.sys.eco.wildlife, 1);
  apply(st, { eco: '退开，为野生动物让路。' });
  assert.equal(st.sys.eco.wildlife, 0, '让路应抵消 1 次暴露');
  apply(st, { eco: '退开，为野生动物让路。' });
  assert.equal(st.sys.eco.wildlife, 0, '不应降到负数');
});

test('ch.eco 关键词：捡回/封存 只让 restored +1，不重复计数', () => {
  for (const text of ['捡回被风吹出的包装。', '食物残渣封存携出。', '捡回包装并封存。']) {
    const st = fresh();
    apply(st, { eco: text });
    assert.equal(st.sys.eco.restored, 1, text);
    assert.deepStrictEqual(counts(st.sys.eco), { litter: 0, wildlife: 0, water: 0, trail: 0, restored: 1 });
  }
});

test('食物封存文案同时含野生动物与封存：wildlife 抵消、restored +1', () => {
  const st = fresh();
  apply(st, { foodOpen: true });
  apply(st, { eco: '食物残渣封存，未投喂野生动物。' });
  assert.deepStrictEqual(counts(st.sys.eco), { litter: 0, wildlife: 0, water: 0, trail: 0, restored: 1 });
});

test('ch.retreat 与无关标记不改账本', () => {
  const st = fresh();
  apply(st, { retreat: true });
  apply(st, { label: '纯粹文本选择' });
  apply(st, { seal: true, shelter: true, help: true });
  assert.deepStrictEqual(st.sys.eco, { litter: 0, wildlife: 0, water: 0, trail: 0, restored: 0, permitAck: false });
});

test('dispose / waste 增加 restored 但不清零遗留与污染历史', () => {
  const st = fresh();
  apply(st, { litter: true });
  apply(st, { litter: true });
  apply(st, { pollute: true });
  apply(st, { detour: true });
  assert.deepStrictEqual(counts(st.sys.eco), { litter: 2, wildlife: 0, water: 1, trail: 1, restored: 0 });

  apply(st, { dispose: true, eco: '授权点接收携出物。' });
  assert.deepStrictEqual(counts(st.sys.eco), { litter: 2, wildlife: 0, water: 1, trail: 1, restored: 1 });

  apply(st, { waste: 0.05, eco: '捡回被风吹出的包装，封袋携出。' });
  assert.deepStrictEqual(counts(st.sys.eco), { litter: 2, wildlife: 0, water: 1, trail: 1, restored: 2 });

  apply(st, { dispose: true });
  assert.deepStrictEqual(counts(st.sys.eco), { litter: 2, wildlife: 0, water: 1, trail: 1, restored: 3 });
});

test('关闭公告：仅 permit 卡 + 了解关闭公告 文案记录 permitAck', () => {
  const st = fresh('canyon');
  apply(st, { label: '只走到观景台，不进入峡谷' }, { kind: 'permit' });
  assert.equal(st.sys.eco.permitAck, false, '未阅读公告不应记录');
  apply(st, { label: '了解关闭公告，仅进入虚构情景' }, { kind: 'path' });
  assert.equal(st.sys.eco.permitAck, false, '非 permit 卡不应记录');
  apply(st, { label: '了解关闭公告，仅进入虚构情景' }, { kind: 'permit' });
  assert.equal(st.sys.eco.permitAck, true);
  apply(st, { label: '取消行程，不进入峡谷' }, { kind: 'permit' });
  assert.equal(st.sys.eco.permitAck, true, '记录应保持');
  eco.init(st, ctx);
  assert.equal(st.sys.eco.permitAck, false, '新局应重置');
});

test('score：空账本 100，扣分与修复封顶正确，始终 0–100 整数', () => {
  const cases = [
    [{}, 100, '无痕'],
    [{ water: 1 }, 90, '无痕'],
    [{ water: 3 }, 70, '有记录'],
    [{ litter: 5, water: 1 }, 50, '负担明显'],
    [{ litter: 2, wildlife: 1, water: 1, trail: 1, restored: 3 }, 70, '有记录'],
    [{ wildlife: 2, water: 1, trail: 1, restored: 1 }, 68, '负担明显'],
    [{ litter: 5, restored: 5 }, 80, '有记录'],
    [{ litter: 1, restored: 5 }, 100, '无痕'],
    [{ litter: 20 }, 0, '严重'],
    [{ litter: 50, wildlife: 50, water: 50, trail: 50 }, 0, '严重']
  ];
  for (const [ledger, wantScore, wantLevel] of cases) {
    const st = withLedger(ledger);
    const s = eco.score(st);
    assert.equal(s, wantScore, JSON.stringify(ledger));
    assert.ok(Number.isInteger(s) && s >= 0 && s <= 100);
    assert.equal(eco.grade(s).name, wantLevel, JSON.stringify(ledger));
  }
  assert.equal(eco.score(withLedger({})), 100, '无修复时不应超过 100');
  assert.equal(eco.score(withLedger({ restored: 10 })), 100, '修复上限不应突破 100');
  assert.equal(eco.score(withLedger({ litter: 1, restored: 5 })), 100);

  const mountainLedger = withLedger({ litter: 2, water: 1, restored: 1 });
  const canyonLedger = withLedger({ litter: 2, water: 1, restored: 1 });
  canyonLedger.routeId = 'canyon';
  assert.equal(eco.score(mountainLedger), eco.score(canyonLedger), '评分与路线无关');
});

test('等级边界 49/50、69/70、89/90', () => {
  // 扣分项是 2 的倍数、修复加成是 4 的倍数，score(st) 只会出现偶数；奇数边界直接验证 grade()。
  assert.deepStrictEqual(
    [eco.grade(49).name, eco.grade(50).name],
    ['严重', '负担明显']
  );
  assert.deepStrictEqual(
    [eco.grade(69).name, eco.grade(70).name],
    ['负担明显', '有记录']
  );
  assert.deepStrictEqual(
    [eco.grade(89).name, eco.grade(90).name],
    ['有记录', '无痕']
  );
  assert.equal(eco.grade(0).name, '严重');
  assert.equal(eco.grade(100).name, '无痕');
  assert.equal(eco.grade(-10).name, '严重', '越界分数应夹取');
  assert.equal(eco.grade(140).name, '无痕', '越界分数应夹取');
  assert.equal(eco.grade(49).line, '本局留下了持续负担，完成路线不等于环境无损。');
  assert.equal(eco.grade(50).line, '多次遗留或扰动，环境账本不会因到达终点清零。');
  assert.equal(eco.grade(70).line, '留下了可识别的痕迹，但仍有修复动作。');
  assert.equal(eco.grade(90).line, '选择整体克制，未记录的负担很少。');
});

test('panelHTML：全零时为空，任一项非零时单行展示', () => {
  assert.equal(eco.panelHTML(fresh(), ctx), '');

  const st = withLedger({ litter: 1, trail: 2, restored: 1 });
  assert.equal(
    eco.panelHTML(st, ctx),
    '<p class="hintline">生态 · 遗留 1 / 野生动物 0 / 水源 0 / 偏航扰动 2 / 修复 1</p>'
  );

  const onlyRestored = eco.panelHTML(withLedger({ restored: 1 }), ctx);
  assert.ok(onlyRestored.includes('修复 1'), '只有修复记录也应显示');
  assert.ok(onlyRestored.includes('class="hintline"'));
  assert.ok(!onlyRestored.includes('<style'));
  assert.ok(!onlyRestored.includes('undefined') && !onlyRestored.includes('NaN'));
});

test('trade：负担/记录副标题，其他为空', () => {
  for (const ch of [{ litter: true }, { pollute: true }, { damage: true }, { foodOpen: true }]) {
    assert.equal(eco.trade(fresh(), ch), '环境负担 +1', JSON.stringify(ch));
  }
  for (const ch of [{ waste: 0.06 }, { dispose: true }]) {
    assert.equal(eco.trade(fresh(), ch), '环境记录 +1', JSON.stringify(ch));
  }
  assert.equal(eco.trade(fresh(), { retreat: true }), '');
  assert.equal(eco.trade(fresh(), { detour: true }), '');
  assert.equal(eco.trade(fresh(), { seal: true }), '');
  assert.equal(eco.trade(fresh(), { litter: true, waste: 0.05 }), '环境负担 +1 · 环境记录 +1');
});

test('endingHTML：分数、等级、五类计数与免责声明；canyon 追加许可状态', () => {
  const mountain = eco.endingHTML(withLedger({}), ctx);
  assert.ok(mountain.includes('生态账本 · 100 / 100 · 无痕 · 遗留 0 / 野生动物 0 / 水源 0 / 偏航扰动 0 / 修复 0'));
  assert.ok(mountain.includes('这是游戏内的行为记录，不是现实生态影响评估。'));
  assert.ok(!mountain.includes('关闭公告'), '非 canyon 不显示许可状态');

  const canyonPending = eco.endingHTML(fresh('canyon'), ctx);
  assert.ok(canyonPending.includes('未记录阅读关闭公告；现实关闭信息优先于剧情。'));

  const canyonAck = fresh('canyon');
  apply(canyonAck, { label: '了解关闭公告，仅进入虚构情景' }, { kind: 'permit' });
  const ackHTML = eco.endingHTML(canyonAck, ctx);
  assert.ok(ackHTML.includes('已阅读关闭公告；本局只按虚构情景处理。'));
  assert.ok(!ackHTML.includes('未记录阅读关闭公告'));

  for (const html of [mountain, canyonPending, ackHTML]) {
    assert.ok(!html.includes('undefined'), '不得出现 undefined');
    assert.ok(!html.includes('NaN'), '不得出现 NaN');
    assert.ok(html.includes('class="hintline"'));
  }
});

test('动态文本经过 ctx.esc，恶意计数值降级为安全整数', () => {
  let calls = 0;
  const spy = { esc: text => { calls++; return escapeHTML(text); } };
  eco.panelHTML(withLedger({ litter: 1 }), spy);
  assert.equal(calls, 1, 'panelHTML 动态文本应调用 ctx.esc');
  calls = 0;
  eco.endingHTML(withLedger({ water: 1 }), spy);
  assert.equal(calls, 3, '非 canyon 结局三行动态文本均应调用 ctx.esc');
  const canyon = withLedger({ water: 1 });
  canyon.routeId = 'canyon';
  calls = 0;
  eco.endingHTML(canyon, spy);
  assert.equal(calls, 4, 'canyon 结局追加许可状态后应调用 ctx.esc');

  const st = fresh();
  st.sys.eco.litter = '3<img src=x onerror=alert(1)>';
  const html = eco.panelHTML(st, ctx) + eco.endingHTML(st, ctx);
  assert.ok(!html.includes('<img'), '不得输出未转义内容');
  assert.ok(!html.includes('onerror'));
  assert.ok(html.includes('遗留 0'), '非法计数应归零');
});

test('echo：按顺序给出四类提醒与固定科普，不使用“破坏者”措辞', () => {
  const empty = eco.echo(fresh(), null, ctx);
  assert.deepStrictEqual(empty.alerts, []);
  assert.equal(empty.science, '食物气味会改变野生动物行为；垃圾和洗涤会把负担留在原地。只处理可安全够到的物品，不越出步道，不进入危险坡面。');

  const st = withLedger({ wildlife: 1, litter: 1, water: 1, trail: 1 });
  const full = eco.echo(st, null, ctx);
  assert.deepStrictEqual(full.alerts, [
    '已有食物暴露记录：继续外挂或投喂会把动物行为和配给风险一起放大。',
    '已有遗留记录：一次捡回不能抵消之前的遗留，但可以减少后续负担。',
    '已有水源污染记录：流水不会让污染消失，后续应停止在同类位置洗涤。',
    '已有偏航扰动：回到确认路线优先于继续切近路。'
  ]);
  for (const alert of full.alerts) assert.ok(!alert.includes('破坏者'));
  assert.ok(!full.science.includes('破坏者'));
});

test('choiceEnabled 始终返回 true 且不依赖账本', () => {
  for (const ch of [{ retreat: true }, { litter: true }, { foodOpen: true }, {}]) {
    assert.equal(eco.choiceEnabled(fresh(), ch), true);
    assert.equal(eco.choiceEnabled(withLedger({ litter: 99 }), ch), true);
  }
});

test('onChoice 不修改 st.waste / st.flags.litter / st.environment / st.leg 及其他系统', () => {
  const st = fresh();
  st.sys.party = { size: 2, morale: 3 };
  const before = JSON.stringify({
    waste: st.waste,
    wasteVolume: st.wasteVolume,
    flags: st.flags,
    environment: st.environment,
    leg: st.leg,
    keys: Object.keys(st).sort()
  });
  const choices = [
    { litter: true, eco: '留下包装。' },
    { pollute: true, eco: '洗涤物进入水源。' },
    { detour: true, damage: true },
    { foodOpen: true, eco: '暴露食物。' },
    { waste: 0.05, eco: '捡回包装。' },
    { dispose: true, eco: '授权点处理。' },
    { retreat: true }
  ];
  for (const ch of choices) apply(st, ch);
  const after = JSON.stringify({
    waste: st.waste,
    wasteVolume: st.wasteVolume,
    flags: st.flags,
    environment: st.environment,
    leg: st.leg,
    keys: Object.keys(st).sort()
  });
  assert.equal(after, before, '核心状态不应被生态账本改动');
  assert.deepStrictEqual(st.sys.party, { size: 2, morale: 3 });
  assert.deepStrictEqual(Object.keys(st.sys.eco).sort(), [...KEYS].sort());
});

test('非数字/负数/小数账本在读取时归一化为非负整数', () => {
  const st = fresh();
  st.sys.eco.litter = -3;
  st.sys.eco.wildlife = 2.7;
  st.sys.eco.water = NaN;
  st.sys.eco.trail = '4';
  st.sys.eco.restored = Infinity;
  st.sys.eco.permitAck = 'true';
  const s = eco.score(st);
  assert.ok(Number.isInteger(s) && s >= 0 && s <= 100);
  assert.ok(!eco.endingHTML(st, ctx).includes('NaN'));
  apply(st, { litter: true });
  assert.deepStrictEqual(counts(st.sys.eco), { litter: 1, wildlife: 2, water: 0, trail: 0, restored: 0 });
  assert.equal(st.sys.eco.permitAck, false);
});

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIM_CHOICES = [
  { ch: { label: '留下包装减重', litter: true, eco: '留下包装：记录一项未修复的环境负担，终点不能抹去。' } },
  { ch: { label: '直接在溪流或河边洗', pollute: true, eco: '洗涤物进入水源：本局记录污染行为。' } },
  { ch: { label: '试探未确认的近路', detour: true, damage: true } },
  { ch: { label: '把剩食留在外面', foodOpen: true, eco: '暴露食物吸引动物；后续可能损失配给。' } },
  { ch: { label: '封袋携出可安全够到的废物', waste: 0.12, eco: '封袋携出包装，不越出步道追垃圾。' } },
  { ch: { label: '清点人员，在指定点处理携出垃圾', dispose: true } },
  { ch: { label: '退开并重新封存食物，让动物先通过', eco: '为野生动物让路，并重新封存食物。' } },
  { ch: { label: '停步捡回并封袋携出', waste: 0.05, eco: '捡回被风吹出的包装，封袋携出。' } },
  { ch: { label: '食物和残渣密封随身保管', seal: true, waste: 0.06, eco: '食物残渣封存，未投喂野生动物。' } },
  { ch: { label: '安全中止：停止推进并联络保障撤离', retreat: true } },
  { permit: true, ch: { label: '了解关闭公告，仅进入虚构情景' } }
];

function snapshotCore(st) {
  return JSON.stringify({
    waste: st.waste,
    wasteVolume: st.wasteVolume,
    flags: st.flags,
    environment: st.environment,
    leg: st.leg
  });
}

function simulate(seed, routeId) {
  const rand = mulberry32((seed >>> 0) ^ ROUTE_SALT[routeId]);
  const st = {
    seed,
    routeId,
    leg: 1,
    waste: 0.5,
    wasteVolume: 1,
    flags: { litter: 2, foodOpen: false },
    environment: [{ day: 1, stop: '起点', text: '既有记录' }],
    sys: {}
  };
  eco.init(st, ctx);
  const coreBefore = snapshotCore(st);
  let previous = counts(st.sys.eco);

  for (let step = 0; step < 24; step++) {
    const pick = SIM_CHOICES[Math.floor(rand() * SIM_CHOICES.length)];
    eco.onChoice(st, pick.permit ? { kind: 'permit' } : { kind: 'path' }, pick.ch, [], ctx);

    const e = st.sys.eco;
    assert.deepStrictEqual(Object.keys(e).sort(), [...KEYS].sort(), '账本键应固定');
    for (const key of ['litter', 'wildlife', 'water', 'trail', 'restored']) {
      assert.ok(Number.isSafeInteger(e[key]) && e[key] >= 0, routeId + '/' + seed + ' ' + key + ' 非负整数');
      assert.ok(e[key] <= 24, routeId + '/' + seed + ' ' + key + ' 超出单步上限');
    }
    assert.equal(typeof e.permitAck, 'boolean');

    const now = counts(e);
    for (const key of ['litter', 'water', 'trail', 'restored']) {
      assert.ok(now[key] >= previous[key], key + ' 历史记录不应减少');
    }
    previous = now;

    const s = eco.score(st);
    assert.ok(Number.isSafeInteger(s) && s >= 0 && s <= 100, routeId + '/' + seed + ' 分数越界');

    const panel = eco.panelHTML(st, ctx);
    const ending = eco.endingHTML(st, ctx);
    assert.ok(!panel.includes('undefined') && !panel.includes('NaN'));
    assert.ok(!ending.includes('undefined') && !ending.includes('NaN'));
    assert.ok(ending.includes('这是游戏内的行为记录，不是现实生态影响评估。'));
    if (routeId === 'canyon') {
      assert.ok(ending.includes('关闭公告'), 'canyon 结局应带许可状态');
    } else {
      assert.ok(!ending.includes('关闭公告'));
    }

    const trade = eco.trade(st, pick.ch);
    assert.equal(typeof trade, 'string');
    assert.ok(!trade.includes('undefined') && !trade.includes('NaN'));

    const echo = eco.echo(st, { kind: 'path' }, ctx);
    assert.ok(Array.isArray(echo.alerts));
    for (const alert of echo.alerts) assert.equal(typeof alert, 'string');
    assert.ok(echo.science.length > 0);

    assert.equal(snapshotCore(st), coreBefore, '模拟中核心状态不应变化');
  }

  return { ledger: JSON.stringify(st.sys.eco), score: eco.score(st), ending: eco.endingHTML(st, ctx) };
}

test('100 seed × 3 路线模拟：无负数、NaN、越界，且可复现', () => {
  const ranges = { mountain: [100, 0], forest: [100, 0], canyon: [100, 0] };
  for (let seed = 1; seed <= 100; seed++) {
    for (const routeId of ROUTES) {
      const first = simulate(seed, routeId);
      const second = simulate(seed, routeId);
      assert.equal(first.ledger, second.ledger, '同 seed 同路线应可复现');
      assert.equal(first.score, second.score);
      assert.equal(first.ending, second.ending);
      ranges[routeId][0] = Math.min(ranges[routeId][0], first.score);
      ranges[routeId][1] = Math.max(ranges[routeId][1], first.score);
    }
  }
  for (const routeId of ROUTES) {
    const [min, max] = ranges[routeId];
    assert.ok(min >= 0 && max <= 100, routeId + ' 模拟分数越界');
  }
});

test('模块源码无 DOM / 真实时间 / 随机 / 网络依赖，不读写核心环境字段', () => {
  const source = fs.readFileSync(path.join(__dirname, '04-eco.js'), 'utf8');
  const forbidden = [
    /Math\.random/,
    /\bdocument\b/,
    /window\.location/,
    /\bDate\b/,
    /localStorage/,
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /setTimeout|setInterval/,
    /game\.html/,
    /\bst\.(waste|wasteVolume|environment|flags|leg)\b/
  ];
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(source), '源码不应包含 ' + pattern);
  }
  assert.ok(source.startsWith('(function (root) {'), '模块应为 IIFE');
  assert.ok(source.includes('globalThis'), '应兼容 Node 全局');
});

console.log('04-eco.test.cjs: ' + passed.length + ' groups passed');
