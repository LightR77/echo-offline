(function (root) {
  'use strict';

  const KEYS = ['lamp', 'poles', 'jacket', 'sleepingbag', 'mat'];
  const FLAGS = ['lamp', 'poles', 'jacket'];
  const NAMES = { lamp:'头灯', poles:'登山杖', jacket:'外层', sleepingbag:'睡袋', mat:'防潮垫' };

  const TEXT = {
    lampDead: '头灯电量耗尽：后续夜行按无灯处理。',
    polesDead: '杖尖磨平：后续不再享受省力加成，但仍可选择安全路线。',
    jacketDead: '外层防风雨性能失效：后续散热结算不再获得外层减免。',
    camp: '营地维护：可修复的装备恢复少量耐久；这不是现实维修保证。',
    sleep: '睡眠装备缺失或损耗影响恢复；游戏只扣少量体力，不模拟真实失温。',
    low: '装备接近失效：继续使用会把风险留到后面，营地维护优先。',
    dead: '已有装备失效：本局后续不再享受对应加成，必要时中止。',
    science: '装备只能降低部分风险，不能替代路线判断、休息和撤退；损坏的装备不要假设仍能提供保护。'
  };

  function carried(lo, key){
    return !!lo && Number.isFinite(Number(lo[key])) && Number(lo[key]) > 0;
  }

  function present(st, wear, key){
    return carried(st && st.initialLoadout, key) || (!!wear && Number(wear[key]) > 0);
  }

  function clamp100(value, ctx){
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return ctx && typeof ctx.clamp === 'function' ? ctx.clamp(n, 0, 100) : Math.min(100, Math.max(0, n));
  }

  function round2(value, ctx){
    return ctx && typeof ctx.r2 === 'function' ? ctx.r2(value) : Math.round(value * 100) / 100;
  }

  function esc(ctx, value){
    if (ctx && typeof ctx.esc === 'function') return ctx.esc(String(value));
    return String(value).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
  }

  function weatherOf(st, ctx){
    const log = st && Array.isArray(st.log) ? st.log : null;
    const last = log && log.length ? log[log.length - 1] : null;
    if (last && typeof last.weather === 'string') return last.weather;
    if (ctx && typeof ctx.weatherAt === 'function'){
      try { return ctx.weatherAt(st); } catch (_) { return ''; }
    }
    return '';
  }

  function lampUsed(st, ch, kind){
    if (!st.lamp) return false;
    if (ch.nightSafe) return true;
    return kind === 'night' && !ch.shelter && !ch.retreat && !ch.risk && !ch.camp;
  }

  function init(st, ctx){
    if (!st) throw new Error('缺少状态');
    const lo = st.initialLoadout || {};
    const wear = {};
    for (const key of KEYS) wear[key] = carried(lo, key) ? clamp100(round2(100, ctx), ctx) : 0;
    st.sys = st.sys && typeof st.sys === 'object' ? st.sys : {};
    st.sys.wear = wear;
    for (const key of FLAGS) st[key] = wear[key] > 0;
    return wear;
  }

  function stateOf(st){
    if (!st.sys || typeof st.sys !== 'object') st.sys = {};
    if (!st.sys.wear || typeof st.sys.wear !== 'object') init(st, null);
    return st.sys.wear;
  }

  function onChoice(st, card, ch, events, ctx){
    if (!st || !ch || typeof ch !== 'object') return;
    const wear = stateOf(st);
    const out = Array.isArray(events) ? events : [];
    const kind = card && typeof card.kind === 'string' ? card.kind : '';
    const weather = weatherOf(st, ctx);
    const serviced = Number(wear.serviceLeg) === st.leg;

    if (wear.lamp > 0 && lampUsed(st, ch, kind)){
      wear.lamp = clamp100(round2(wear.lamp - (serviced ? 6 : 12), ctx), ctx);
      if (wear.lamp <= 0){
        wear.lamp = 0; st.lamp = false; out.push(TEXT.lampDead);
      }
    }

    if (wear.poles > 0 && (kind === 'terrain' || ch.detour)){
      wear.poles = clamp100(round2(wear.poles - (serviced ? 4 : 8), ctx), ctx);
      if (wear.poles <= 0){
        wear.poles = 0; st.poles = false; out.push(TEXT.polesDead);
      }
    }

    const wet = !!(st.flags && st.flags.wet);
    if (wear.jacket > 0 && (wet || weather === 'storm' || ch.heat)){
      wear.jacket = clamp100(round2(wear.jacket - (serviced ? 3 : 5), ctx), ctx);
      if (wear.jacket <= 0){
        wear.jacket = 0; st.jacket = false; out.push(TEXT.jacketDead);
      }
    }

    if (ch.camp && !ch.poorCamp){
      let maintained = false;
      for (const key of KEYS){
        if (!present(st, wear, key)) continue;
        wear[key] = clamp100(round2(wear[key] + 12, ctx), ctx);
        maintained = true;
      }
      if (maintained){
        for (const key of FLAGS){
          if (present(st, wear, key)) st[key] = wear[key] > 0;
        }
        out.push(TEXT.camp);
      }
      const bagLow = Number(wear.sleepingbag) < 30;
      const matLow = Number(wear.mat) < 30;
      if (bagLow || matLow){
        const loss = bagLow && matLow ? 8 : 4;
        if (Number.isFinite(Number(st.stamina))){
          st.stamina = ctx && typeof ctx.clamp === 'function'
            ? ctx.clamp(st.stamina - loss, 0, 100)
            : Math.min(100, Math.max(0, st.stamina - loss));
        }
        out.push(TEXT.sleep);
      }
    }
    if (wear.serviceLeg) wear.serviceLeg = 0;
  }

  function choiceEnabled(){
    return true;
  }

  function trade(st, ch, card){
    if (!st || !ch) return '';
    const wear = st.sys && st.sys.wear ? st.sys.wear : {};
    const lamp = Math.round(Number(wear.lamp) || 0);
    const poles = Math.round(Number(wear.poles) || 0);
    if (ch.nightSafe){
      if (!present(st, wear, 'lamp')) return '未携带头灯';
      if (lamp <= 0) return '无头灯';
      return lamp <= 25 ? '头灯 ' + lamp + '% · 电量低' : '';
    }
    const kind = card && typeof card.kind === 'string' ? card.kind : '';
    if (kind === 'terrain' || ch.detour || ch.careful){
      if (!present(st, wear, 'poles')) return '未携带登山杖';
      if (poles <= 0) return '登山杖失效';
      return poles <= 25 ? '登山杖偏低 ' + poles + '%' : '';
    }
    if (ch.camp) return '营地可维护';
    return '';
  }

  function panelHTML(st, ctx){
    if (!st || !st.sys || !st.sys.wear) return '';
    const wear = st.sys.wear;
    const parts = [];
    for (const key of KEYS){
      if (!present(st, wear, key)) continue;
      const value = Math.round(Number(wear[key]) || 0);
      if (value >= 90) continue;
      parts.push(esc(ctx, NAMES[key]) + ' ' + (value <= 0 ? '失效' : esc(ctx, value) + '%'));
    }
    if (!parts.length) return '';
    return '<p class="statusline">装备 · ' + parts.join(' / ') + '</p>';
  }

  function endingHTML(st, ctx){
    const wear = st && st.sys && st.sys.wear;
    if (!wear) return '';
    let total = 0, failed = 0;
    for (const key of KEYS){
      if (!present(st, wear, key)) continue;
      total++;
      if (Number(wear[key]) <= 0) failed++;
    }
    if (!total) return '';
    return '<p class="hintline">装备记录：本局携带 ' + esc(ctx, total) + ' 件耐用品，其中 '
      + esc(ctx, failed) + ' 件已失效。装备损耗只影响游戏加成，不构成现实维修评分。</p>';
  }

  function echo(st, card, ctx){
    const wear = st && st.sys && st.sys.wear;
    const alerts = [];
    if (wear){
      let low = false, dead = false;
      for (const key of KEYS){
        if (!present(st, wear, key)) continue;
        const value = Number(wear[key]) || 0;
        if (value > 0 && value <= 25) low = true;
        if (value <= 0) dead = true;
      }
      if (low) alerts.push(TEXT.low);
      if (dead) alerts.push(TEXT.dead);
    }
    return { alerts, science: TEXT.science };
  }

  (root.EchoSystems = root.EchoSystems || {}).gear = {
    init, onChoice, choiceEnabled, trade, panelHTML, endingHTML, echo
  };
})(typeof window !== 'undefined' ? window : globalThis);
