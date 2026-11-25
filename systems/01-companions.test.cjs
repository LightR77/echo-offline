'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

require(path.join(__dirname, '01-companions.js'));

const api = globalThis.EchoSystems && globalThis.EchoSystems.companions;
if (!api) throw new Error('companions module did not register globalThis.EchoSystems.companions');

const ROUTES = ['mountain', 'forest', 'canyon'];
const NAME_POOL = new Set(['林岚', '周野', '小满', '陈默', '阿禾', '洛川', '沈星', '顾原']);
const ROLE_KEYS = ['route', 'supply', 'sweep'];
const ROLE_LABELS = { route: '前队观察', sweep: '收队', supply: '补给整理' };
const CONDITION_LABELS = ['受伤', '踉跄', '疲惫', '稳定'];
const SCIENCE = '队伍分散会削弱相互观察和求助；把最慢的人留在视线内，比追求整体速度更重要。严重伤情或意识异常应停止并求助。';

const CH = {
  help: { label: '集合互助，重新评估余量', fx: { st: 4, t: 1 }, help: true },
  risk: { label: '赶路，透支后续余量', fx: { st: -7, t: 0.4 }, risk: 0.3 },
  detour: { label: '试探未确认的近路', fx: { st: -4, t: 1.2 }, detour: true },
  camp: { label: '使用已获准营位，进食并检查装备', fx: { st: 48, t: 2 }, camp: true, recover: true },
  campOnly: { label: '只进食不整理装备', fx: { st: 40, t: 1.5 }, camp: true },
  poorCamp: { label: '熬夜拍摄，忽略潮衣和食物', fx: { st: 12, t: 4 }, camp: true, poorCamp: true },
  recover: { label: '停下处理伤情/潮衣并核对位置', fx: { st: 3, t: 1.5 }, recover: true },
  navigate: { label: '核对标记，不离开确认路线', fx: { st: -3, t: 0.7 }, navigate: true },
  plain: { label: '原地观察', fx: { st: -1, t: 1.2 } },
  retreat: { label: '安全中止：停止推进并联络保障撤离', fx: { t: 0 }, retreat: true }
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function makeCtx(options = {}) {
  const weather = options.weather || 'clear';
  return {
    esc: escapeHtml,
    r2: v => Math.round(v * 100) / 100,
    r1: v => Math.round(v * 10) / 10,
    clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
    weatherAt: (st, leg) => (typeof options.weatherAt === 'function' ? options.weatherAt(st, leg) : weather),
    storyRandom: () => 0.5,
    totalLegs: () => 12,
    C: (label, fx, extra = {}) => ({ label, fx, ...extra })
  };
}

function makeSt(seed, routeId, overrides = {}) {
  return {
    seed: seed >>> 0,
    routeId,
    initialLoadout: { pack: 'trek', bar: 4, water: 6, vessel: 2 },
    screen: 'leg',
    leg: 1,
    day: 1,
    stamina: 80,
    water: 1,
    waterCap: 2,
    temp: 36.8,
    over: null,
    sys: {},
    ...overrides
  };
}

function initParty(seed, routeId, overrides = {}) {
  const st = makeSt(seed, routeId, overrides);
  api.init(st, makeCtx());
  return st;
}

const membersOf = st => st.sys.party.members;
function setConditions(st, values) { membersOf(st).forEach((m, i) => { m.condition = values[i]; }); }
function setTrust(st, values) { membersOf(st).forEach((m, i) => { m.trust = values[i]; }); }
const roleAt = (st, role) => membersOf(st).find(m => m.role === role);
const roleIndex = (st, role) => membersOf(st).findIndex(m => m.role === role);

function choose(st, ch, options = {}) {
  const events = [];
  const ctx = options.ctx || makeCtx(options);
  const card = {
    id: options.cardId || st.routeId + '-' + st.leg,
    kind: options.kind || 'team',
    title: '测试章节',
    text: '',
    choices: [ch]
  };
  api.onChoice(st, card, ch, events, ctx);
  return events;
}

function conditionsOf(st) { return membersOf(st).map(m => m.condition); }
function trustsOf(st) { return membersOf(st).map(m => m.trust); }

function changedIndexes(before, after) {
  const out = [];
  before.forEach((value, index) => { if (value !== after[index]) out.push(index); });
  return out;
}

function assertCleanText(text, label) {
  assert.equal(typeof text, 'string', label + ' must be a string');
  assert.ok(!/undefined|NaN/.test(text), label + ' contains undefined/NaN: ' + text);
}

function assertPartyInvariants(st, label) {
  const party = st.sys && st.sys.party;
  assert.ok(party, label + ' party missing');
  assert.equal(party.members.length, 3, label + ' member count');
  const names = new Set();
  const roles = new Set();
  for (const member of party.members) {
    assert.ok(Number.isInteger(member.condition), label + ' condition integer');
    assert.ok(member.condition >= 0 && member.condition <= 3, label + ' condition range: ' + member.condition);
    assert.ok(Number.isInteger(member.trust), label + ' trust integer');
    assert.ok(member.trust >= 0 && member.trust <= 3, label + ' trust range: ' + member.trust);
    assert.ok(NAME_POOL.has(member.name), label + ' name from pool');
    names.add(member.name);
    roles.add(member.role);
  }
  assert.equal(names.size, 3, label + ' distinct names');
  assert.deepEqual([...roles].sort(), ROLE_KEYS, label + ' distinct roles');
  assert.ok(Number.isSafeInteger(party.helped) && party.helped >= 0, label + ' helped counter');
  assert.ok(Number.isSafeInteger(party.risked) && party.risked >= 0, label + ' risked counter');
  for (const key of ['route', 'sweep', 'supply']) {
    assert.ok(Number.isFinite(party.dayUsed[key]), label + ' dayUsed.' + key);
    assert.ok(party.dayUsed[key] >= 0 && party.dayUsed[key] <= st.day, label + ' dayUsed.' + key + ' within days');
  }
  assert.ok(Number.isFinite(st.stamina) && st.stamina >= 0 && st.stamina <= 100, label + ' stamina finite/range');
  assert.ok(Number.isFinite(st.water) && st.water >= 0 && st.water <= st.waterCap, label + ' water finite/range');
}

function simulate(seed, routeId, weather) {
  const st = makeSt(seed, routeId, { stamina: 60, water: 1, waterCap: 2 });
  api.init(st, makeCtx());
  const ctx = makeCtx({ weather });
  const order = [CH.help, CH.risk, CH.detour, CH.camp, CH.navigate, CH.recover];
  for (let step = 0; step < 36; step += 1) {
    if (step > 0 && step % 4 === 0) { st.day += 1; st.leg += 1; }
    const ch = order[step % order.length];
    const events = choose(st, ch, { ctx, kind: step % 3 === 0 ? 'camp' : 'team' });
    assertPartyInvariants(st, 'sim ' + routeId + '/' + seed + ' step ' + step);
    assertCleanText(api.panelHTML(st, ctx), 'sim panel');
    assertCleanText(api.endingHTML(st, ctx), 'sim ending');
    for (const line of api.echo(st, { id: st.routeId + '-' + st.leg, kind: 'team', choices: [] }, ctx).alerts) {
      assertCleanText(line, 'sim echo alert');
    }
    for (const line of events) assertCleanText(line, 'sim event');
  }
  return st;
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/* ---------------------------------------------------------------- contract */

test('module contract exposes every documented hook', () => {
  for (const key of ['init', 'onChoice', 'choiceEnabled', 'trade', 'panelHTML', 'endingHTML', 'echo']) {
    assert.equal(typeof api[key], 'function', key + ' must be a function');
  }
  assert.doesNotThrow(() => api.init(null, {}), 'init tolerates missing state');
  assert.equal(api.choiceEnabled({}, {}), true);
  assert.equal(api.choiceEnabled(null, null), true, 'choiceEnabled never disables');
});

test('missing party state degrades to empty output without throwing', () => {
  const bare = makeSt(1, 'mountain');
  assert.equal(api.trade(bare, CH.help), '');
  assert.equal(api.panelHTML(bare, makeCtx()), '');
  assert.equal(api.endingHTML(bare, makeCtx()), '');
  assert.deepEqual(api.echo(bare, null, makeCtx()), { alerts: [], science: '' });
  api.onChoice(bare, { id: 'mountain-1', kind: 'team', choices: [CH.help] }, CH.help, [], makeCtx());
  assert.equal(bare.sys.party, undefined);
});

/* ------------------------------------------------------------------- init */

test('init is deterministic for the same seed, route and loadout', () => {
  for (const route of ROUTES) {
    for (const seed of [0, 1, 42, 777, 123456789, 0xffffffff]) {
      const a = makeSt(seed, route);
      const b = makeSt(seed, route, { initialLoadout: { pack: 'light', bar: 1, water: 2, vessel: 1 } });
      api.init(a, makeCtx());
      api.init(b, makeCtx());
      assert.deepEqual(a.sys.party, b.sys.party, 'seed ' + seed + ' route ' + route);
    }
  }
});

test('init writes only st.sys.party and never uses Math.random', () => {
  const st = makeSt(9, 'forest', { sys: { wear: { lamp: 100 } } });
  const keysBefore = new Set(Object.keys(st));
  const originalRandom = Math.random;
  Math.random = () => { throw new Error('Math.random must not be used'); };
  try {
    api.init(st, makeCtx());
  } finally {
    Math.random = originalRandom;
  }
  assert.deepEqual(Object.keys(st).filter(key => !keysBefore.has(key)), [], 'no new top-level keys');
  assert.deepEqual(Object.keys(st.sys).sort(), ['party', 'wear'], 'no other system keys touched');
  assert.deepEqual(st.sys.wear, { lamp: 100 }, 'foreign system state preserved');
  assert.deepEqual(Object.keys(st.sys.party).sort(), ['dayUsed', 'helped', 'members', 'risked']);
  assert.deepEqual(Object.keys(st.sys.party.dayUsed).sort(), ['route', 'supply', 'sweep']);
  for (const member of st.sys.party.members) {
    assert.deepEqual(Object.keys(member).sort(), ['condition', 'id', 'name', 'role', 'trust']);
    assert.equal(member.condition, 3);
    assert.equal(member.trust, 1);
  }
  assert.equal(st.sys.party.helped, 0);
  assert.equal(st.sys.party.risked, 0);
  assert.deepEqual(st.sys.party.dayUsed, { route: 0, sweep: 0, supply: 0 });
});

test('init produces three named members with unique roles on all routes', () => {
  for (const route of ROUTES) {
    for (let seed = 0; seed < 60; seed += 1) {
      const st = initParty(seed, route);
      assertPartyInvariants(st, route + '/' + seed);
      assert.equal(st.sys.party.members.length, 3);
      for (const key of ['route', 'sweep', 'supply']) {
        assert.ok(roleAt(st, key), route + '/' + seed + ' has ' + key);
      }
    }
  }
});

test('different seeds produce different deterministic rosters', () => {
  const rosters = new Set();
  for (let seed = 0; seed < 40; seed += 1) {
    const st = initParty(seed, 'mountain');
    rosters.add(membersOf(st).map(m => m.name + ':' + m.role).join('|'));
  }
  assert.ok(rosters.size > 10, 'roster should vary across seeds, got ' + rosters.size);
});

/* ------------------------------------------------------------------- help */

test('help only improves the lowest member and raises that trust', () => {
  const st = initParty(11, 'mountain');
  setConditions(st, [2, 1, 3]);
  setTrust(st, [1, 1, 1]);
  const before = conditionsOf(st);
  choose(st, CH.help);
  assert.deepEqual(conditionsOf(st), [2, 2, 3]);
  assert.deepEqual(changedIndexes(before, conditionsOf(st)), [1]);
  assert.deepEqual(trustsOf(st), [1, 2, 1]);
  assert.equal(st.sys.party.helped, 1);
});

test('help respects condition and trust caps and breaks ties by member order', () => {
  const capped = initParty(12, 'forest');
  setConditions(capped, [3, 3, 3]);
  setTrust(capped, [3, 1, 1]);
  choose(capped, CH.help);
  assert.deepEqual(conditionsOf(capped), [3, 3, 3]);
  assert.deepEqual(trustsOf(capped), [3, 1, 1]);
  assert.equal(capped.sys.party.helped, 1);

  const tied = initParty(13, 'canyon');
  setConditions(tied, [1, 1, 2]);
  setTrust(tied, [1, 1, 1]);
  choose(tied, CH.help);
  assert.deepEqual(conditionsOf(tied), [2, 1, 2]);
  assert.deepEqual(trustsOf(tied), [2, 1, 1]);
});

/* ------------------------------------------------------------------- risk */

test('risk lowers only the lowest member, once without storm or heat', () => {
  const st = initParty(21, 'forest');
  setConditions(st, [2, 2, 3]);
  setTrust(st, [1, 1, 1]);
  const before = conditionsOf(st);
  choose(st, CH.risk);
  assert.deepEqual(conditionsOf(st), [1, 2, 3]);
  assert.deepEqual(changedIndexes(before, conditionsOf(st)), [0]);
  assert.deepEqual(trustsOf(st), [0, 1, 1]);
  assert.equal(st.sys.party.risked, 1);
});

test('risk in storm or heat costs one extra condition but only one trust', () => {
  const storm = initParty(22, 'mountain');
  setConditions(storm, [3, 3, 3]);
  setTrust(storm, [2, 2, 2]);
  choose(storm, CH.risk, { ctx: makeCtx({ weather: 'storm' }) });
  assert.deepEqual(conditionsOf(storm), [1, 3, 3]);
  assert.deepEqual(trustsOf(storm), [1, 2, 2]);

  const heat = initParty(23, 'canyon');
  setConditions(heat, [3, 3, 3]);
  choose(heat, CH.risk, { ctx: makeCtx({ weather: 'clear' }) });
  assert.deepEqual(conditionsOf(heat), [1, 3, 3], 'canyon is a heat environment');

  const heatCard = initParty(24, 'mountain');
  setConditions(heatCard, [3, 3, 3]);
  choose(heatCard, { label: '趁还有力气继续暴晒', fx: { st: -7, t: 0.4 }, risk: 0.3, heat: true }, { kind: 'heat' });
  assert.deepEqual(conditionsOf(heatCard), [1, 3, 3], 'heat card counts as heat environment');

  const stormCanyon = initParty(25, 'canyon');
  setConditions(stormCanyon, [3, 3, 3]);
  choose(stormCanyon, CH.risk, { ctx: makeCtx({ weather: 'storm' }) });
  assert.deepEqual(conditionsOf(stormCanyon), [1, 3, 3], 'storm + heat still caps at -2');
});

test('detour behaves like risk and counts once', () => {
  const st = initParty(26, 'mountain');
  setConditions(st, [2, 3, 3]);
  choose(st, CH.detour);
  assert.deepEqual(conditionsOf(st), [1, 3, 3]);
  assert.equal(st.sys.party.risked, 1);
  assert.equal(st.sys.party.helped, 0);
});

test('repeated risks never fall below zero and keep hitting the lowest member', () => {
  const st = initParty(27, 'mountain');
  setConditions(st, [1, 1, 1]);
  setTrust(st, [1, 1, 1]);
  for (let i = 0; i < 10; i += 1) choose(st, CH.risk, { ctx: makeCtx({ weather: 'storm' }) });
  assert.deepEqual(conditionsOf(st), [0, 1, 1], 'the first tied-lowest member takes every risk');
  assert.deepEqual(trustsOf(st), [0, 1, 1]);
  assert.ok(conditionsOf(st).every(value => Number.isInteger(value) && value >= 0 && value <= 3));
  assert.equal(st.sys.party.risked, 10);
});

test('retreat and plain choices leave the party unchanged', () => {
  const st = initParty(28, 'forest');
  setConditions(st, [2, 1, 3]);
  setTrust(st, [1, 1, 1]);
  const snapshot = JSON.stringify(st.sys.party);
  assert.deepEqual(choose(st, CH.retreat), []);
  assert.deepEqual(choose(st, CH.plain), []);
  assert.equal(JSON.stringify(st.sys.party), snapshot);
});

test('help combined with risk keeps help trust and lets risk lower the new lowest', () => {
  const st = initParty(29, 'mountain');
  setConditions(st, [1, 3, 3]);
  setTrust(st, [1, 1, 1]);
  const combined = { label: '边帮边赶', fx: { st: -3, t: 1 }, help: true, risk: 0.2 };
  choose(st, combined);
  assert.deepEqual(conditionsOf(st), [1, 3, 3], 'help +1 then risk -1 on the same member');
  assert.deepEqual(trustsOf(st), [2, 1, 1], 'risk never subtracts trust when help is present');
  assert.equal(st.sys.party.helped, 1);
  assert.equal(st.sys.party.risked, 1);
});

/* ------------------------------------------------------------ camp/recover */

test('camp restores every member, recover stacks, both cap at 3', () => {
  const st = initParty(31, 'forest', { water: 1, waterCap: 3 });
  setConditions(st, [0, 2, 2]);
  setTrust(st, [3, 3, 3]);
  choose(st, CH.camp);
  assert.deepEqual(conditionsOf(st), [2, 3, 3], 'camp +1 all, recover +1 to lowest');
  const again = initParty(32, 'forest');
  setConditions(again, [2, 3, 3]);
  choose(again, CH.campOnly);
  choose(again, CH.campOnly, { cardId: 'forest-1' });
  assert.deepEqual(conditionsOf(again), [3, 3, 3]);
});

test('poor camp gives no rest and no supply specialty', () => {
  const st = initParty(33, 'mountain', { water: 1, waterCap: 3 });
  setConditions(st, [1, 2, 1]);
  const events = choose(st, CH.poorCamp, { kind: 'camp' });
  assert.deepEqual(conditionsOf(st), [1, 2, 1]);
  assert.equal(st.water, 1);
  assert.deepEqual(events, []);
  assert.equal(st.sys.party.dayUsed.supply, 0);
});

test('recover alone improves only the lowest member', () => {
  const st = initParty(34, 'canyon');
  setConditions(st, [0, 2, 3]);
  setTrust(st, [1, 1, 1]);
  choose(st, CH.recover);
  assert.deepEqual(conditionsOf(st), [1, 2, 3]);
  assert.deepEqual(trustsOf(st), [1, 1, 1]);
});

/* -------------------------------------------------------------- specialties */

test('route lead specialty adds 1 stamina once per day and records the day', () => {
  const st = initParty(41, 'mountain', { stamina: 60, day: 1 });
  const events = choose(st, CH.navigate, { kind: 'path' });
  assert.equal(st.stamina, 61);
  assert.equal(st.sys.party.dayUsed.route, 1);
  assert.deepEqual(events, ['前队提前确认了岔口，队伍少走一点回头路。']);

  assert.deepEqual(choose(st, CH.navigate, { kind: 'path' }), [], 'same day does not stack');
  assert.equal(st.stamina, 61);

  st.day = 2;
  choose(st, CH.navigate, { kind: 'path' });
  assert.equal(st.stamina, 62);
  assert.equal(st.sys.party.dayUsed.route, 2);
});

test('sweep specialty adds 2 stamina on help once per day', () => {
  const st = initParty(42, 'forest', { stamina: 60, day: 1 });
  const events = choose(st, CH.help);
  assert.equal(st.stamina, 62);
  assert.deepEqual(events, ['收队把最慢的人带进队伍节奏，整体少一次停顿。']);
  assert.equal(st.sys.party.dayUsed.sweep, 1);

  assert.deepEqual(choose(st, CH.help), []);
  assert.equal(st.stamina, 62);
});

test('supply specialty redistributes water once per day with rounding and cap', () => {
  const st = initParty(43, 'canyon', { water: 1.95, waterCap: 3, day: 1 });
  const events = choose(st, CH.campOnly, { kind: 'camp' });
  assert.equal(st.water, 2.05);
  assert.deepEqual(events, ['补给整理把余水重新分配，减少一点浪费。']);
  assert.equal(st.sys.party.dayUsed.supply, 1);

  assert.deepEqual(choose(st, CH.campOnly, { kind: 'camp' }), []);
  assert.equal(st.water, 2.05);

  st.day = 2;
  st.water = 1.97;
  st.waterCap = 2;
  choose(st, CH.campOnly, { kind: 'camp' });
  assert.equal(st.water, 2, 'never above waterCap');
});

test('injured role members do not trigger specialties and are flagged in trade', () => {
  const route = initParty(44, 'mountain', { stamina: 60 });
  roleAt(route, 'route').condition = 0;
  const routeTrade = api.trade(route, CH.navigate);
  assert.ok(routeTrade.includes('前队观察 受伤，特长不可用'), routeTrade);
  const routeEvents = choose(route, CH.navigate, { kind: 'path' });
  assert.equal(route.stamina, 60);
  assert.deepEqual(routeEvents, []);
  assert.equal(route.sys.party.dayUsed.route, 0);

  const sweep = initParty(45, 'forest', { stamina: 60 });
  roleAt(sweep, 'sweep').condition = 0;
  const sweepTrade = api.trade(sweep, CH.help);
  assert.ok(sweepTrade.includes('收队 受伤，特长不可用'), sweepTrade);
  assert.ok(sweepTrade.includes('受伤→踉跄'), sweepTrade);
  const sweepEvents = choose(sweep, CH.help);
  assert.equal(sweep.stamina, 60);
  assert.deepEqual(sweepEvents, []);
  assert.equal(sweep.sys.party.dayUsed.sweep, 0);
  assert.equal(roleAt(sweep, 'sweep').condition, 1, 'help still improves the injured member');

  const supply = initParty(46, 'canyon', { water: 1, waterCap: 3 });
  roleAt(supply, 'supply').condition = 0;
  const supplyTrade = api.trade(supply, CH.campOnly);
  assert.ok(supplyTrade.includes('补给整理 受伤，特长不可用'), supplyTrade);
  const supplyEvents = choose(supply, CH.campOnly, { kind: 'camp' });
  assert.equal(supply.water, 1);
  assert.deepEqual(supplyEvents, []);
  assert.equal(supply.sys.party.dayUsed.supply, 0);
});

test('specialty effects respect stamina cap', () => {
  const st = initParty(47, 'mountain', { stamina: 99.5 });
  choose(st, CH.navigate, { kind: 'path' });
  assert.equal(st.stamina, 100);
  const capped = initParty(48, 'forest', { stamina: 99 });
  choose(capped, CH.help);
  assert.equal(capped.stamina, 100);
});

/* --------------------------------------------------------- trade and panel */

test('trade shows help projection when a member is below full condition', () => {
  const st = initParty(51, 'mountain');
  setConditions(st, [3, 2, 3]);
  const target = membersOf(st)[1];
  const empty = api.trade(st, CH.navigate);
  assert.equal(empty, '', 'healthy specialty needs no warning');
  const text = api.trade(st, CH.help);
  assert.ok(text.includes('队伍互助：' + target.name + ' 疲惫→稳定'), text);
  assert.ok(!text.includes('受伤，特长不可用'), text);
});

test('trade reports an already-full help target as capped', () => {
  const st = initParty(52, 'forest');
  setConditions(st, [3, 3, 3]);
  const text = api.trade(st, CH.help);
  assert.ok(text.includes('稳定（状态已满）'), text);
});

test('panelHTML renders one escaped roster line with average trust', () => {
  const st = initParty(53, 'canyon');
  setTrust(st, [2, 2, 2]);
  const html = api.panelHTML(st, makeCtx());
  assert.ok(html.startsWith('<p class="statusline partyline">'), html);
  assert.ok(html.includes('队伍 · '), html);
  assert.ok(html.includes('信任 2/3'), html);
  assert.ok(html.endsWith('</p>'), html);
  for (const member of membersOf(st)) assert.ok(html.includes(member.name + ' 稳定'), html);
  assertCleanText(html, 'panel');
});

test('panel and ending escape hostile member text and never print undefined', () => {
  const st = initParty(54, 'mountain');
  const evil = '<img src=x onerror="alert(1)"> & 林';
  membersOf(st).forEach((member, i) => { member.name = evil + i; });
  const panel = api.panelHTML(st, makeCtx());
  const ending = api.endingHTML(st, makeCtx());
  for (const html of [panel, ending]) {
    assert.ok(!html.includes('<img'), 'raw tag leaked: ' + html);
    assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; 林'), html);
    assert.ok(!html.includes('undefined'), html);
    assertCleanText(html, 'escaped html');
  }
});

test('panel and ending work without ctx by using a safe local escaper', () => {
  const st = initParty(55, 'forest');
  membersOf(st)[0].name = '<b>危险</b>';
  const panel = api.panelHTML(st);
  assert.ok(panel.includes('&lt;b&gt;危险&lt;/b&gt;'), panel);
  assert.ok(api.endingHTML(st).includes('&lt;b&gt;危险&lt;/b&gt;'));
});

/* ------------------------------------------------------------- ending HTML */

test('ending lists every member, role, condition and trust with a disclaimer', () => {
  const st = initParty(61, 'mountain');
  setConditions(st, [3, 2, 1]);
  setTrust(st, [3, 2, 1]);
  const html = api.endingHTML(st, makeCtx());
  assert.ok(html.includes('<h3 class="sect">队伍记录</h3>'), html);
  assert.ok(html.includes('队伍完整归返'), html);
  assert.ok(html.includes('这是游戏状态记录，不评价现实中的队友能力。'), html);
  for (const member of membersOf(st)) {
    assert.ok(html.includes(member.name), html);
    assert.ok(html.includes(ROLE_LABELS[member.role]), html);
    assert.ok(html.includes(CONDITION_LABELS[member.condition]), html);
  }
  assert.ok(html.includes('信任 3/3') && html.includes('信任 1/3'), html);
});

test('ending summary follows complete/injured/separate rules', () => {
  const complete = initParty(62, 'forest');
  setConditions(complete, [1, 2, 3]);
  setTrust(complete, [2, 2, 2]);
  assert.ok(api.endingHTML(complete, makeCtx()).includes('队伍完整归返'));

  const lowTrust = initParty(63, 'forest');
  setConditions(lowTrust, [3, 3, 3]);
  setTrust(lowTrust, [2, 2, 1]);
  assert.ok(api.endingHTML(lowTrust, makeCtx()).includes('队伍各自归返'));

  const injured = initParty(64, 'canyon');
  setConditions(injured, [3, 0, 3]);
  setTrust(injured, [3, 3, 3]);
  const injuredHtml = api.endingHTML(injured, makeCtx());
  assert.ok(injuredHtml.includes('带伤归返'), injuredHtml);
  assert.ok(!injuredHtml.includes('队伍完整归返'), injuredHtml);

  const injuredLow = initParty(65, 'canyon');
  setConditions(injuredLow, [0, 3, 3]);
  setTrust(injuredLow, [0, 0, 0]);
  assert.ok(api.endingHTML(injuredLow, makeCtx()).includes('带伤归返'));
});

test('unknown member roles fall back to a neutral label', () => {
  const st = initParty(66, 'mountain');
  membersOf(st)[0].role = 'constructor';
  const html = api.endingHTML(st, makeCtx());
  assert.ok(html.includes('队员'), html);
  assertCleanText(html, 'role fallback');
});

/* -------------------------------------------------------------------- echo */

test('echo raises condition, trust and help alerts', () => {
  const st = initParty(71, 'mountain');
  setConditions(st, [3, 3, 3]);
  setTrust(st, [2, 2, 2]);
  const calm = api.echo(st, { id: 'mountain-1', kind: 'team', choices: [CH.plain] }, makeCtx());
  assert.deepEqual(calm, { alerts: [], science: SCIENCE });

  setConditions(st, [0, 1, 3]);
  const alerts = api.echo(st, { id: 'mountain-1', kind: 'team', choices: [CH.help] }, makeCtx()).alerts;
  assert.ok(alerts.includes('同伴受伤：继续冒险会拖慢队伍；优先处理伤情或中止。'), alerts);
  assert.ok(alerts.includes('有同伴开始踉跄：再叠加赶路或偏航，状态会继续下降。'), alerts);
  assert.ok(alerts.includes('这次帮助会改善最低状态成员，并提高信任。'), alerts);
  assert.ok(!alerts.includes('队伍信任偏低：连续冒险会让互助失效，结局记录会变差。'), alerts);
});

test('echo warns on low average trust and matches the documented science line', () => {
  const st = initParty(72, 'forest');
  setConditions(st, [3, 3, 3]);
  setTrust(st, [1, 1, 0]);
  const result = api.echo(st, { id: 'forest-1', kind: 'camp', choices: [CH.camp] }, makeCtx());
  assert.ok(result.alerts.includes('队伍信任偏低：连续冒险会让互助失效，结局记录会变差。'), result.alerts);
  assert.ok(!result.alerts.some(line => line.includes('这次帮助')), result.alerts);
  assert.equal(result.science, SCIENCE);
});

test('over state skips settlement so an ended run cannot be rewritten', () => {
  const st = initParty(73, 'mountain');
  setConditions(st, [1, 2, 3]);
  st.over = 'retreat';
  const snapshot = JSON.stringify(st.sys.party);
  api.onChoice(st, { id: 'mountain-1', kind: 'team', choices: [CH.help] }, CH.help, [], makeCtx());
  assert.equal(JSON.stringify(st.sys.party), snapshot);
});

/* ------------------------------------------------------- boundary simulation */

test('100 seeds x 3 routes keep party state finite and in range', () => {
  for (const route of ROUTES) {
    for (let seed = 0; seed < 100; seed += 1) {
      const weather = seed % 4 === 0 ? 'storm' : seed % 4 === 1 ? 'wind' : 'clear';
      const st = simulate(seed, route, weather);

      // Stress the floors: repeated storm risks always hit the current lowest member.
      for (let i = 0; i < 8; i += 1) {
        st.day += 1;
        choose(st, CH.risk, { ctx: makeCtx({ weather: 'storm' }) });
      }
      assert.equal(Math.min(...conditionsOf(st)), 0, route + '/' + seed + ' risk floor');
      assert.ok(conditionsOf(st).every(value => Number.isInteger(value) && value >= 0 && value <= 3));
      assert.ok(trustsOf(st).every(value => Number.isInteger(value) && value >= 0 && value <= 3));
      assertPartyInvariants(st, route + '/' + seed + ' after storm risks');

      // Stress the ceiling: repeated camps/recover.
      for (let i = 0; i < 8; i += 1) {
        st.day += 1;
        choose(st, CH.camp, { ctx: makeCtx() });
      }
      assert.deepEqual(conditionsOf(st), [3, 3, 3], route + '/' + seed + ' camp ceiling');
      assertPartyInvariants(st, route + '/' + seed + ' after camps');

      const panel = api.panelHTML(st, makeCtx());
      const ending = api.endingHTML(st, makeCtx());
      const echo = api.echo(st, { id: route + '-' + st.leg, kind: 'team', choices: [CH.help] }, makeCtx());
      assertCleanText(panel, 'final panel');
      assertCleanText(ending, 'final ending');
      assert.ok(/队伍完整归返|带伤归返|队伍各自归返/.test(ending), ending);
      for (const line of echo.alerts) assertCleanText(line, 'final echo');
    }
  }
});

test('identical seed, route and choices replay to identical party state', () => {
  for (const route of ROUTES) {
    for (const seed of [3, 88, 4242]) {
      const a = simulate(seed, route, 'wind');
      const b = simulate(seed, route, 'wind');
      assert.deepEqual(a.sys.party, b.sys.party, route + '/' + seed + ' party replay');
      assert.equal(a.stamina, b.stamina);
      assert.equal(a.water, b.water);
      assert.equal(a.day, b.day);
      assert.equal(a.leg, b.leg);
    }
  }
});

/* ------------------------------------------------------------------ runner */

const failures = [];
for (const entry of tests) {
  try {
    entry.fn();
  } catch (error) {
    failures.push({ name: entry.name, error });
  }
}

if (failures.length) {
  console.error('01-companions: ' + failures.length + ' failure(s) of ' + tests.length);
  for (const failure of failures) {
    console.error('\nFAIL ' + failure.name);
    console.error(failure.error && failure.error.stack ? failure.error.stack : failure.error);
  }
  process.exitCode = 1;
} else {
  console.log('01-companions: ' + tests.length + ' tests passed');
  console.log('coverage: 100 seeds x 3 routes simulated; specialties, boundaries and escaping checked');
}
