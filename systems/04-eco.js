(function (root) {
  'use strict';

  const LEVELS = [
    { min: 90, name: '无痕', line: '选择整体克制，未记录的负担很少。' },
    { min: 70, name: '有记录', line: '留下了可识别的痕迹，但仍有修复动作。' },
    { min: 50, name: '负担明显', line: '多次遗留或扰动，环境账本不会因到达终点清零。' },
    { min: 0, name: '严重', line: '本局留下了持续负担，完成路线不等于环境无损。' }
  ];
  const DISCLAIMER = '这是游戏内的行为记录，不是现实生态影响评估。';
  const SCIENCE = '食物气味会改变野生动物行为；垃圾和洗涤会把负担留在原地。只处理可安全够到的物品，不越出步道，不进入危险坡面。';

  const whole = value => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);
  const blank = () => ({ litter: 0, wildlife: 0, water: 0, trail: 0, restored: 0, permitAck: false });

  function read(st) {
    const raw = st && st.sys && st.sys.eco;
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
      litter: whole(src.litter),
      wildlife: whole(src.wildlife),
      water: whole(src.water),
      trail: whole(src.trail),
      restored: whole(src.restored),
      permitAck: src.permitAck === true
    };
  }

  function ensure(st) {
    if (!st || typeof st !== 'object') return blank();
    if (!st.sys || typeof st.sys !== 'object') st.sys = {};
    const live = st.sys.eco;
    if (!live || typeof live !== 'object' || Array.isArray(live)) {
      st.sys.eco = blank();
      return st.sys.eco;
    }
    live.litter = whole(live.litter);
    live.wildlife = whole(live.wildlife);
    live.water = whole(live.water);
    live.trail = whole(live.trail);
    live.restored = whole(live.restored);
    live.permitAck = live.permitAck === true;
    return live;
  }

  function init(st) {
    if (!st || typeof st !== 'object') return;
    if (!st.sys || typeof st.sys !== 'object') st.sys = {};
    st.sys.eco = blank();
  }

  function onChoice(st, card, ch) {
    if (!ch || typeof ch !== 'object') return;
    const e = ensure(st);
    const eco = typeof ch.eco === 'string' ? ch.eco : '';
    if (ch.litter) e.litter += 1;
    if (ch.pollute) e.water += 1;
    if (ch.damage || ch.detour) e.trail += 1;
    if (ch.foodOpen) e.wildlife += 1;
    if (/野生动物|让路/.test(eco)) e.wildlife = Math.max(0, e.wildlife - 1);
    if (ch.waste || ch.dispose || /捡回|封存/.test(eco)) e.restored += 1;
    if (card && card.kind === 'permit' && typeof ch.label === 'string' && ch.label.includes('了解关闭公告')) e.permitAck = true;
  }

  function choiceEnabled() {
    return true;
  }

  function trade(st, ch) {
    if (!ch || typeof ch !== 'object') return '';
    const parts = [];
    if (ch.litter || ch.pollute || ch.damage || ch.foodOpen) parts.push('环境负担 +1');
    if (ch.waste || ch.dispose) parts.push('环境记录 +1');
    return parts.join(' · ');
  }

  function clampScore(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function scoreOf(e) {
    return clampScore(100 - e.litter * 8 - e.wildlife * 10 - e.water * 10 - e.trail * 6 + Math.min(20, e.restored * 4));
  }

  function score(st) {
    return scoreOf(read(st));
  }

  function grade(value) {
    const s = clampScore(value);
    return LEVELS.find(level => s >= level.min) || LEVELS[LEVELS.length - 1];
  }

  function escOf(ctx) {
    if (ctx && typeof ctx.esc === 'function') return ctx.esc;
    return text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  const countsText = e => '遗留 ' + e.litter + ' / 野生动物 ' + e.wildlife + ' / 水源 ' + e.water + ' / 偏航扰动 ' + e.trail + ' / 修复 ' + e.restored;

  function panelHTML(st, ctx) {
    const e = read(st);
    if (!e.litter && !e.wildlife && !e.water && !e.trail && !e.restored) return '';
    return '<p class="hintline">' + escOf(ctx)('生态 · ' + countsText(e)) + '</p>';
  }

  function endingHTML(st, ctx) {
    const e = read(st);
    const esc = escOf(ctx);
    const s = scoreOf(e);
    const level = grade(s);
    let html = '<p class="hintline">' + esc('生态账本 · ' + s + ' / 100 · ' + level.name + ' · ' + countsText(e)) + '</p>'
      + '<p class="hintline">' + esc(level.line) + '</p>';
    if (st && st.routeId === 'canyon') {
      html += '<p class="hintline">' + esc(e.permitAck ? '已阅读关闭公告；本局只按虚构情景处理。' : '未记录阅读关闭公告；现实关闭信息优先于剧情。') + '</p>';
    }
    return html + '<p class="hintline">' + esc(DISCLAIMER) + '</p>';
  }

  function echo(st) {
    const e = read(st);
    const alerts = [];
    if (e.wildlife > 0) alerts.push('已有食物暴露记录：继续外挂或投喂会把动物行为和配给风险一起放大。');
    if (e.litter > 0) alerts.push('已有遗留记录：一次捡回不能抵消之前的遗留，但可以减少后续负担。');
    if (e.water > 0) alerts.push('已有水源污染记录：流水不会让污染消失，后续应停止在同类位置洗涤。');
    if (e.trail > 0) alerts.push('已有偏航扰动：回到确认路线优先于继续切近路。');
    return { alerts, science: SCIENCE };
  }

  const api = { init, onChoice, choiceEnabled, trade, panelHTML, endingHTML, echo, score, grade };
  (root.EchoSystems = root.EchoSystems || {}).eco = api;
})(typeof window !== 'undefined' ? window : globalThis);
