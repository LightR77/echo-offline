# 四系统并行拆分 · 接线约定

日期：2026-11-21
当前活跃文件：`game.html`（分支 `ui-home-atmosphere`，有未提交改动）
基线不要动：`echo-offline.html`、`dist/`、`.Echo-Offline.qoder.site`

## 硬边界

1. **四个功能任务都不允许修改 `game.html`。** 每个任务只写自己的
   `systems/0X-*.js` 和 `systems/0X-*.test.cjs`。
2. 不要在本目录执行 `git checkout`、`git reset`、`git clean`、`git stash`。
   当前 `game.html` 有未提交改动，切分支或覆盖工作区会直接丢掉它。
3. 不新增章节、路线、牌库，不改 `dayEnds` / `totalLegs`。
4. 系统入口由接线任务统一加，模块本身不写 DOM。当前默认在每章卡片上方
   只显示一行只读摘要（队伍 / 装备 / 下一章天气 / 无痕分），不提供按钮，
   也不消耗体力；四系统仍通过原有选择、事件和结局被动结算。第 2 章固定
   插入一条“系统事件 · …”剧情。完整行动面板代码保留在 `game.html`，
   需要恢复时把 `renderLeg` 里的 `compact` 参数去掉即可。
5. 不引入依赖、不联网、不写框架。模块是一个 IIFE，挂到
   `globalThis.EchoSystems`，完成后由接线任务内联回单文件。
6. 测试文件用 Node 原生 `assert`，不新增 npm 依赖。临时产物用 `_qa_*`，用完删除。

## 模块契约

每个模块文件形如：

```js
(function (root) {
  'use strict';
  const api = {
    init(st, ctx) {},                       // 新局初始化；必须确定性
    onChoice(st, card, ch, events, ctx) {}, // 核心结算之后调用；可改状态、追加事件文案
    choiceEnabled(st, ch) { return true; }, // 返回 false 才禁用；不要重复核心判断
    trade(st, ch) { return ''; },           // 追加到选项副标题，可为空
    panelHTML(st, ctx) { return ''; },      // 返回状态面板片段；文本必须转义
    endingHTML(st, ctx) { return ''; },     // 结局追加片段；文本必须转义
    echo(st, card, ctx) { return { alerts: [], science: '' }; }
  };
  (root.EchoSystems = root.EchoSystems || {}).<name> = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- 所有新状态放在统一命名空间 `st.sys` 下，每个系统只写自己的键：
  `party` / `wear` / `weather` / `eco`。接线任务会先建 `st.sys = {}`，
  再按顺序调用四个 `init`。
- `ctx` 由接线任务传入，包含 `{ r2, r1, clamp, esc, weatherAt, storyRandom, totalLegs, C }`。
  不要依赖 DOM、`document`、`window.location`、真实时间或 `Math.random()`。
- `init` 只能使用 `st.seed`、`st.routeId`、`st.initialLoadout` 和 `ctx.storyRandom`
  做确定性生成；同一 seed + 配装 + 路线必须得到同一初始状态。
- `onChoice` 在核心数值结算**之后**调用。可以读取 `st.leg`（已可能 +1），
  但结算文案请用传入的 `card` / `ch`；不要重新调用 `Core.cardAt`。
- 模块返回的 HTML 只能来自常量文案和数值；所有动态文本用 `ctx.esc` 转义。
- 不使用 `innerHTML` 直接操作页面；UI 片段交给主文件渲染。

## 接线任务（只允许一个写入者）

四个模块都通过测试后，由主线单写者一次性接线：

1. `newRun` 返回前建立 `st.sys = {}` 并调用四个 `init`。
2. `applyAction` 在核心结算后调用四个 `onChoice`，顺序固定：
   `party → wear → weather → eco`。
3. `choiceEnabled` 末尾追加四个模块的布尔结果（全真才可选）。
4. `tradeLabel` 末尾追加四个模块的 `trade` 文本。
5. 状态面板、结局页、Echo 各插入一次 `panelHTML` / `endingHTML` / `echo`。
6. 做三视口 QA、同种子重放、零运行时异常，再删除 `_qa_*`。

## 四份任务

| 文件 | 系统 | 主要状态 | 主要改动面 |
| --- | --- | --- | --- |
| `systems/01-companions.md` | 同伴 | `st.sys.party` | 队伍状态、互助、结局 |
| `systems/02-gear.md` | 装备磨损 | `st.sys.wear` | 头灯/杖/外层/营地维护 |
| `systems/03-weather.md` | 天气窗口 | `st.sys.weather` | 预告、等待收益、Echo |
| `systems/04-eco.md` | 生态账本 | `st.sys.eco` | 遗留物、野生动物、许可 |

建议并行顺序：四个任务同时写模块；接线按 `04 → 02 → 03 → 01`，
先低风险状态，再高交互的同伴系统。
