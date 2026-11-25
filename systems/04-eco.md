# 04 · 生态与许可账本

## 目标

把现在分散的垃圾、污染、食物暴露和偏航，收束成一份可读的生态账本：
每个选择留下什么、捡回了什么、是否惊扰野生动物、是否理解关闭公告，
都会进入结局复盘，而不是只显示一个 `litter` 计数。

不改路线、不新增章节、不新增选择按钮。只写：

- `systems/04-eco.js`
- `systems/04-eco.test.cjs`

禁止修改 `game.html`。

## 状态

初始化到 `st.sys.eco`：

```js
{
  litter: 0,       // 留下包装/垃圾
  wildlife: 0,     // 食物暴露或惊扰野生动物
  water: 0,        // 水源污染
  trail: 0,        // 偏航/离开步道造成的地表扰动
  restored: 0,     // 捡回、封存、分类、携出等修复行为
  permitAck: false // 已阅读并理解关闭公告
}
```

- 全部为非负整数；`restored` 用于抵消评分，但不会把历史记录清零。
- 同一 seed/配装/路线初始化一致；初始全 0。
- 不删除现有 `st.waste`、`st.flags.litter`、`st.environment`，只在其旁边增加账本。

## 规则（`onChoice`，核心结算之后）

按选择标记累计，每个选择最多对每个类别 +1：

1. `ch.litter` → `litter +1`
2. `ch.pollute` → `water +1`
3. `ch.damage` → `trail +1`
4. `ch.detour` → `trail +1`
5. `ch.foodOpen` → `wildlife +1`
6. `ch.waste`（捡回并携出）→ `restored +1`
7. `ch.dispose` → `restored +1`
8. `ch.eco` 文本包含“野生动物”或“让路” → `wildlife = max(0, wildlife - 1)`
9. `ch.eco` 文本包含“捡回”或“封存” → `restored +1`
10. `card.kind === 'permit'` 且选择文案包含“了解关闭公告” → `permitAck = true`

注意：

- 同一次选择里 `ch.eco` 最多 +1，不要按关键词重复计数。
- 不因为 `ch.dispose` 把 `litter` 或 `water` 归零；修复不能抹掉历史。
- `ch.retreat` 不改账本。
- 不修改 `st.flags.litter` 或 `st.waste`，避免与核心重复扣减。

## 评分

`score(st)` 返回 0–100 整数：

```text
100 - litter*8 - wildlife*10 - water*10 - trail*6 + min(20, restored*4)
```

夹在 0–100。等级：

| 分数 | 等级 | 结局文案 |
| --- | --- | --- |
| 90–100 | 无痕 | 选择整体克制，未记录的负担很少。 |
| 70–89 | 有记录 | 留下了可识别的痕迹，但仍有修复动作。 |
| 50–69 | 负担明显 | 多次遗留或扰动，环境账本不会因到达终点清零。 |
| 0–49 | 严重 | 本局留下了持续负担，完成路线不等于环境无损。 |

必须注明：`这是游戏内的行为记录，不是现实生态影响评估。`

## 面板、副标题与结局

`panelHTML(st, ctx)`：

- 只在任一项非零时显示；
- 一行：
  `生态 · 遗留 1 / 野生动物 0 / 水源 0 / 偏航扰动 2 / 修复 1`
- 用现有 `hintline` 或 `statusline` 样式，不新增 `<style>`。

`trade(st, ch)`：

- `ch.litter / ch.pollute / ch.damage / ch.foodOpen` → `环境负担 +1`
- `ch.waste / ch.dispose` → `环境记录 +1`
- 其他返回空字符串。

`endingHTML(st, ctx)`：

- 显示分数、等级、五类计数；
- 若 `st.routeId === 'canyon'`：
  - `permitAck` 为真：`已阅读关闭公告；本局只按虚构情景处理。`
  - 否则：`未记录阅读关闭公告；现实关闭信息优先于剧情。`
- 最后一行免责声明，不使用“环保评分”“道德分”等措辞。

## Echo

`echo(st, card, ctx)`：

- `alerts`：
  - `wildlife > 0`：`已有食物暴露记录：继续外挂或投喂会把动物行为和配给风险一起放大。`
  - `litter > 0`：`已有遗留记录：一次捡回不能抵消之前的遗留，但可以减少后续负担。`
  - `water > 0`：`已有水源污染记录：流水不会让污染消失，后续应停止在同类位置洗涤。`
  - `trail > 0`：`已有偏航扰动：回到确认路线优先于继续切近路。`
- `science`：
  `食物气味会改变野生动物行为；垃圾和洗涤会把负担留在原地。只处理可安全够到的物品，不越出步道，不进入危险坡面。`
- 不把玩家称为“破坏者”；用“记录”“负担”“修复”描述行为。

## 测试（Node 原生 assert）

`04-eco.test.cjs` 至少覆盖：

1. 初始五类计数全 0，三条路线一致。
2. `litter/pollute/damage/detour/foodOpen` 分别只加对应类别。
3. `waste/dispose/eco` 增加 `restored`；`dispose` 不清零历史。
4. `score` 在 0–100；等级边界 49/50、69/70、89/90 正确。
5. 100 个 seed × 3 路线模拟不出现负数、`NaN`、越界。
6. `panelHTML` / `endingHTML` 不出现 `undefined`，动态文本已转义。
7. 不修改 `st.waste`、`st.flags.litter`、`st.environment`、`st.leg`。

## 交接给接线任务

说明：

- 面板建议放在“携出物”状态行之后。
- 结局建议放在现有“环境账本”小节内，替换或补充原计数，不新增独立页面。
- 若接线时发现 `ch.eco` 文本与本局新增事件重复计数，以选择标记为准，文本只做展示。
- 本系统不新增许可违规惩罚；关闭公告只做知情记录，避免把虚构情景误写成现实许可建议。
