# 03 · 天气窗口与情景预报

## 目标

在现有“每章天气由种子决定”之上，加一层可读但不保证准确的窗口信息：
玩家能看到下一段的大致趋势，选择在遮蔽处等待窗口，换取下一章的少量恢复；
但预报可能错，等待也会消耗时间与饮水。核心天气序列不改。

不改路线、不新增章节、不新增选择按钮。只写：

- `systems/03-weather.js`
- `systems/03-weather.test.cjs`

禁止修改 `game.html`。

## 状态

初始化到 `st.sys.weather`：

```js
{
  guard: 0,        // 0/1；下一次行动是否享受窗口收益
  waits: 0,        // 本局等待窗口次数
  last: null       // 最近一次预报的纯文本，便于测试/复盘
}
```

- `guard` 不叠加，最多 1。
- 同一 seed/路线/章节的预报必须一致。
- 不修改 `st.weatherRolls`、`st.leg`、`st.time` 或实际天气。

## 预报

`forecast(st, ctx)` 返回当前章之后的 1–2 段：

```js
[
  { leg: 2, weather: 'wind', label: '风', confidence: 72 },
  { leg: 3, weather: 'storm', label: '强风雨雪', confidence: 58 }
]
```

- 只预报 `st.leg + 1 ... ctx.totalLegs(st)` 范围内的章节；终点章返回空数组。
- 实际值用 `ctx.weatherAt(st, nextLeg)` 计算；不要重新实现天气算法。
- 误差是确定性的：对每个偏移量用 `ctx.storyRandom(st, 300 + offset)`；
  当值 `< 0.22` 时，把预报改成相邻天气（`clear ↔ wind ↔ storm`），
  但只在预报文本里改，不改变 `weatherAt`。
- `confidence`：
  - 下一章 62–82，再下一章 48–66；
  - 当前实际为 `storm` 时各减 8；
  - 夹在 35–85。
- 当前章天气直接显示实际值，标 `已知`，不算预报。
- 文案必须带 `情景预报 · 非导航`，与现有“非导航”口径一致。

## 等待窗口（`onChoice`，核心结算之后）

触发条件：

- `ch.shelter` 为真；
- 当前实际天气为 `wind` 或 `storm`；
- 不是 `ch.retreat`；
- `st.over` 为空；
- 本局 `waits < 3`（最多三次，避免无限刷）。

执行：

- `guard = 1`，`waits++`；
- 追加事件文案：
  `队伍在遮蔽处观察了一个窗口；下一章的风雨影响会略低，但预报不保证准确。`

不要改 `st.temp` 或 `st.stamina` 在这一步；等待的成本已由原选择结算。

## 窗口收益（下一次行动）

当 `guard === 1` 且下一次行动进入 `onChoice`：

- 非峡谷：`st.temp +0.15`（上限 37.2）；`st.stamina +2`（上限 100）。
- 峡谷：`st.temp -0.15`（不低于 36.5）；`st.stamina +2`（上限 100）。
- 清除 `guard`。
- 追加：
  `上一章的窗口让队伍以稍好的状态进入本章；这不是天气保证。`

如果下一次行动中止或已经结束，清除 `guard`，不给收益。

## 副标题与面板

`trade(st, ch)`：

- 在 `ch.shelter` 且当前为 `wind/storm` 时，追加
  `窗口：下一章 风 72%`（使用 `forecast` 的第一条；没有则空）。
- 其他选择返回空字符串。

`panelHTML(st, ctx)` 返回一行：

```html
<p class="hintline">情景预报 · 下一章 风 72% / 再下一章 强风雨雪 58% · 非导航</p>
```

若当前为 `storm`，先加一句 `当前：强风雨雪（已知）`。
所有数字取整；不新增 `<style>`。

## Echo

`echo(st, card, ctx)`：

- `alerts`：
  - 当前 `storm`：`当前就是强风雨雪：等待只能争取时间，不保证窗口出现。`
  - 下一章预报 `storm` 且置信度 `>= 60`：`下一章可能转强风雨雪：现在等窗口，还是保留余量继续走，需要先选一个。`
  - `guard === 1`：`已选择等待窗口：下一章会略好，但预报仍可能错。`
- `science`：
  `山区天气变化快，单点预报不能证明下一段安全；云、风和降水趋势只能作为保守决策的参考。`
- 不写“官方预报”或具体气象机构。

## 测试（Node 原生 assert）

`03-weather.test.cjs` 至少覆盖：

1. 同一 seed/路线/章节 `forecast` 完全一致；100 个 seed 不出现 `NaN`。
2. 预报天气只会是 `clear/wind/storm`，置信度在 35–85。
3. 实际 `weatherAt` 不被修改；`weatherRolls` 不变。
4. `shelter` 在 `wind/storm` 下设置 `guard=1`；晴天不设置；最多 3 次。
5. 下一次行动消耗 `guard`，体力不超 100，温度不越界；中止时清除。
6. `trade` / `panelHTML` 不出现 `undefined`。
7. 模拟 50 个 seed × 3 路线，预报、等待、收益均无负数或异常。

## 交接给接线任务

说明：

- `panelHTML` 建议插在天气徽标 `.wx` 之后。
- `echo` 与现有 `scenarioStory` 合并时，天气预警放在体温预警之后。
- 明确 `onChoice` 必须在核心结算后调用，否则窗口收益会覆盖核心结果。
- 本系统没有改变实际天气，只影响下一次行动的状态，避免破坏种子可复现性。
