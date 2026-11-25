(function (root) {
  'use strict';

  const NAMES = ['林岚', '周野', '小满', '陈默', '阿禾', '洛川', '沈星', '顾原'];
  const ROLES = ['route', 'sweep', 'supply'];
  const ROLE_LABEL = { route: '前队观察', sweep: '收队', supply: '补给整理' };
  const CONDITION_LABEL = ['受伤', '踉跄', '疲惫', '稳定'];
  const CONDITION_MAX = 3;
  const TRUST_MAX = 3;
  const ROUTE_SALT = { mountain: 0x51ed270b, forest: 0x2545f491, canyon: 0x9e3779b1 };
  const SCIENCE = '队伍分散会削弱相互观察和求助；把最慢的人留在视线内，比追求整体速度更重要。严重伤情或意识异常应停止并求助。';

  function mix32(value) {
    let x = value >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d) >>> 0;
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b) >>> 0;
    x ^= x >>> 16;
    return x >>> 0;
  }

  function stream(seed, routeId) {
    const salt = Object.hasOwn(ROUTE_SALT, routeId) ? ROUTE_SALT[routeId] : 0x1b873593;
    let state = mix32((seed >>> 0) ^ salt ^ 0x85ebca6b);
    let counter = 0;
    return function next() {
      counter = (counter + 0x9e3779b9) >>> 0;
      state = mix32(state ^ Math.imul(counter, 0x27d4eb2d) ^ 0x165667b1);
      return state / 4294967296;
    };
  }

  function shuffle(list, next) {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      const swap = list[i];
      list[i] = list[j];
      list[j] = swap;
    }
    return list;
  }

  function fallbackEsc(value) {
    return String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function escOf(ctx) {
    return ctx && typeof ctx.esc === 'function' ? ctx.esc : fallbackEsc;
  }

  function r2Of(ctx) {
    return ctx && typeof ctx.r2 === 'function' ? ctx.r2 : v => Math.round(v * 100) / 100;
  }

  function clampInt(value, lo, hi) {
    const n = Number(value);
    if (!Number.isFinite(n)) return lo;
    return Math.min(hi, Math.max(lo, Math.round(n)));
  }

  const conditionOf = member => clampInt(member && member.condition, 0, CONDITION_MAX);
  const trustOf = member => clampInt(member && member.trust, 0, TRUST_MAX);

  function getParty(st) {
    const party = st && st.sys && st.sys.party;
    if (!party || !Array.isArray(party.members) || !party.members.length) return null;
    return party;
  }

  function makeParty(st) {
    const seed = st && Number.isFinite(st.seed) ? st.seed >>> 0 : 0;
    const routeId = st && typeof st.routeId === 'string' ? st.routeId : 'mountain';
    const next = stream(seed, routeId);
    const names = shuffle(NAMES.slice(), next).slice(0, 3);
    const roles = shuffle(ROLES.slice(), next);
    return {
      members: names.map((name, index) => ({
        id: 'm' + (index + 1),
        name,
        role: roles[index],
        condition: CONDITION_MAX,
        trust: 1
      })),
      helped: 0,
      risked: 0,
      dayUsed: { route: 0, sweep: 0, supply: 0 }
    };
  }

  function init(st) {
    if (!st || typeof st !== 'object') return null;
    if (!st.sys || typeof st.sys !== 'object') st.sys = {};
    st.sys.party = makeParty(st);
    return st.sys.party;
  }

  function lowestMember(members) {
    let best = null;
    for (const member of members) {
      if (!best || conditionOf(member) < conditionOf(best)) best = member;
    }
    return best;
  }

  function roleMember(members, role) {
    for (const member of members) {
      if (member && member.role === role) return member;
    }
    return null;
  }

  function averageTrust(members) {
    if (!members.length) return 0;
    let sum = 0;
    for (const member of members) sum += trustOf(member);
    return sum / members.length;
  }

  function playedLeg(st, card) {
    const match = card && typeof card.id === 'string' ? /(\d+)$/.exec(card.id) : null;
    const leg = match ? Number(match[1]) : NaN;
    if (Number.isSafeInteger(leg) && leg > 0) return leg;
    return Number.isFinite(st.leg) ? st.leg : 1;
  }

  function isStorm(st, card, ctx) {
    if (!ctx || typeof ctx.weatherAt !== 'function') return false;
    try {
      return ctx.weatherAt(st, playedLeg(st, card)) === 'storm';
    } catch (error) {
      return false;
    }
  }

  function isHeat(st, card, ch) {
    return st.routeId === 'canyon' || (card && card.kind === 'heat') || !!(ch && ch.heat);
  }

  function ensureCounters(party) {
    if (!Number.isSafeInteger(party.helped) || party.helped < 0) party.helped = 0;
    if (!Number.isSafeInteger(party.risked) || party.risked < 0) party.risked = 0;
    if (!party.dayUsed || typeof party.dayUsed !== 'object') party.dayUsed = { route: 0, sweep: 0, supply: 0 };
    if (!Number.isFinite(party.dayUsed.route)) party.dayUsed.route = 0;
    if (!Number.isFinite(party.dayUsed.sweep)) party.dayUsed.sweep = 0;
    if (!Number.isFinite(party.dayUsed.supply)) party.dayUsed.supply = 0;
  }

  function applySpecialties(st, party, ch, before, ctx, push) {
    const members = party.members;
    if (!Number.isFinite(st.day)) return;
    const day = st.day;
    const wasHealthy = member => before[members.indexOf(member)] > 0;

    if (ch.navigate) {
      const lead = roleMember(members, 'route');
      if (lead && wasHealthy(lead) && party.dayUsed.route !== day && Number.isFinite(st.stamina)) {
        st.stamina = Math.min(100, st.stamina + 1);
        party.dayUsed.route = day;
        push('前队提前确认了岔口，队伍少走一点回头路。');
      }
    }

    if (ch.help) {
      const sweep = roleMember(members, 'sweep');
      if (sweep && wasHealthy(sweep) && party.dayUsed.sweep !== day && Number.isFinite(st.stamina)) {
        st.stamina = Math.min(100, st.stamina + 2);
        party.dayUsed.sweep = day;
        push('收队把最慢的人带进队伍节奏，整体少一次停顿。');
      }
    }

    if (ch.camp && !ch.poorCamp) {
      const supply = roleMember(members, 'supply');
      if (supply && wasHealthy(supply) && party.dayUsed.supply !== day && Number.isFinite(st.water) && Number.isFinite(st.waterCap)) {
        st.water = Math.min(st.waterCap, r2Of(ctx)(st.water + 0.1));
        party.dayUsed.supply = day;
        push('补给整理把余水重新分配，减少一点浪费。');
      }
    }
  }

  function onChoice(st, card, ch, events, ctx) {
    const party = getParty(st);
    if (!party || !ch || st.over) return;
    ensureCounters(party);
    const members = party.members;
    // Specialty eligibility uses the condition the player saw before this choice.
    const before = members.map(conditionOf);
    const push = text => { if (text && Array.isArray(events)) events.push(text); };

    if (ch.help) {
      const target = lowestMember(members);
      if (target) {
        target.condition = clampInt(conditionOf(target) + 1, 0, CONDITION_MAX);
        target.trust = clampInt(trustOf(target) + 1, 0, TRUST_MAX);
      }
      party.helped += 1;
    }

    if (ch.camp && !ch.poorCamp) {
      for (const member of members) member.condition = clampInt(conditionOf(member) + 1, 0, CONDITION_MAX);
    }

    if (ch.recover) {
      const target = lowestMember(members);
      if (target) target.condition = clampInt(conditionOf(target) + 1, 0, CONDITION_MAX);
    }

    if (ch.risk || ch.detour) {
      const target = lowestMember(members);
      if (target) {
        target.condition = clampInt(conditionOf(target) - 1, 0, CONDITION_MAX);
        if (isStorm(st, card, ctx) || isHeat(st, card, ch)) {
          target.condition = clampInt(conditionOf(target) - 1, 0, CONDITION_MAX);
        }
        if (!ch.help) target.trust = clampInt(trustOf(target) - 1, 0, TRUST_MAX);
      }
      party.risked += 1;
    }

    applySpecialties(st, party, ch, before, ctx, push);
  }

  function choiceEnabled() {
    return true;
  }

  function trade(st, ch) {
    const party = getParty(st);
    if (!party || !ch) return '';
    const parts = [];

    if (ch.help) {
      const target = lowestMember(party.members);
      if (target) {
        const current = conditionOf(target);
        parts.push(current >= CONDITION_MAX
          ? '队伍互助：' + target.name + ' 稳定（状态已满）'
          : '队伍互助：' + target.name + ' ' + CONDITION_LABEL[current] + '→' + CONDITION_LABEL[current + 1]);
      }
      const sweep = roleMember(party.members, 'sweep');
      if (sweep && conditionOf(sweep) === 0) parts.push('收队 受伤，特长不可用');
    }

    if (ch.navigate) {
      const lead = roleMember(party.members, 'route');
      if (lead && conditionOf(lead) === 0) parts.push('前队观察 受伤，特长不可用');
    }

    if (ch.camp && !ch.poorCamp) {
      const supply = roleMember(party.members, 'supply');
      if (supply && conditionOf(supply) === 0) parts.push('补给整理 受伤，特长不可用');
    }

    return parts.join(' / ');
  }

  function formatAverage(value) {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  function panelHTML(st, ctx) {
    const party = getParty(st);
    if (!party) return '';
    const esc = escOf(ctx);
    const roster = party.members.map(member => esc(member.name) + ' ' + CONDITION_LABEL[conditionOf(member)]).join(' / ');
    return '<p class="statusline partyline">队伍 · ' + roster + ' · 信任 ' + formatAverage(averageTrust(party.members)) + '/3</p>';
  }

  function endingStatus(party) {
    const intact = party.members.every(member => conditionOf(member) > 0);
    if (intact && averageTrust(party.members) >= 2) return '队伍完整归返';
    if (party.members.some(member => conditionOf(member) === 0)) return '带伤归返';
    return '队伍各自归返';
  }

  function endingHTML(st, ctx) {
    const party = getParty(st);
    if (!party) return '';
    const esc = escOf(ctx);
    const rows = party.members.map(member =>
      '<li>' + esc(member.name)
      + ' · ' + esc(Object.hasOwn(ROLE_LABEL, member.role) ? ROLE_LABEL[member.role] : '队员')
      + ' · ' + CONDITION_LABEL[conditionOf(member)]
      + ' · 信任 ' + trustOf(member) + '/3</li>'
    ).join('');
    return '<h3 class="sect">队伍记录</h3>'
      + panelHTML(st, ctx)
      + '<ul class="recap">' + rows + '</ul>'
      + '<p class="hintline">' + endingStatus(party) + '。这是游戏状态记录，不评价现实中的队友能力。</p>';
  }

  function echo(st, card) {
    const party = getParty(st);
    if (!party) return { alerts: [], science: '' };
    const alerts = [];
    if (party.members.some(member => conditionOf(member) === 0)) {
      alerts.push('同伴受伤：继续冒险会拖慢队伍；优先处理伤情或中止。');
    }
    if (party.members.some(member => conditionOf(member) === 1)) {
      alerts.push('有同伴开始踉跄：再叠加赶路或偏航，状态会继续下降。');
    }
    if (averageTrust(party.members) <= 1) {
      alerts.push('队伍信任偏低：连续冒险会让互助失效，结局记录会变差。');
    }
    if (card && Array.isArray(card.choices) && card.choices.some(choice => choice && choice.help)) {
      alerts.push('这次帮助会改善最低状态成员，并提高信任。');
    }
    return { alerts, science: SCIENCE };
  }

  const api = { init, onChoice, choiceEnabled, trade, panelHTML, endingHTML, echo };
  (root.EchoSystems = root.EchoSystems || {}).companions = api;
})(typeof window !== 'undefined' ? window : globalThis);
