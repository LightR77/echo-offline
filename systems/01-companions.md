# 01 · 同伴系统

## 目标

让队伍从背景文字变成可管理的状态：三名有名字、角色、体况和信任的同伴。
玩家不直接控制他们，但每一次“互助 / 赶路 / 休整 / 冒险”都会改变他们的状态，
并反馈到选项副标题、Echo 警示和结局复盘。

不改路线、不新增章节、不新增选择按钮。只写：

- `systems/01-companions.js`
- `systems/01-companions.test.cjs`

禁止修改 `game.html`。

## 玩家能看到什么

- 状态面板一行：`队伍 · 林岚 稳定 / 周野 疲惫 / 小满 受伤 · 信任 2/3`
- 互助类选项的副标题追加：`队伍互助：周野 疲惫→稳定`
- 同伴状态差时，Echo 的“本章警示与科普”出现对应提醒。
- 结局页多一段“队伍记录”，说明谁带伤、谁信任高、是否完整归返。

## 状态

初始化到 `st.sys.party`：

```js
{
  members: [
    { id, name, role, condition, trust }
  ],
  helped: 0,
  risked: 0,
  dayUsed: { route: 0, sweep: 0, supply: 0 } // 记录角色特长的最近使用日
}
```

- `condition`: `3 稳定 / 2 疲惫 / 1 踉跄 / 0 受伤`，整数，范围 0–3。
- `trust`: 0–3，整数。
- 三名成员固定存在；`role` 从 `route`（前队观察）、`sweep`（收队）、
  `supply`（补给整理）中分配，每人一个。
- 名字、角色顺序由 `st.seed + route + 固定盐` 确定性生成，禁止 `Math.random()`。
  名字池用中性中文名，避免真实人物暗示。示例池：
  `林岚、周野、小满、陈默、阿禾、洛川、沈星、顾原`。
- 初始：`condition=3`、`trust=1`；同一 seed/路线/配装必须完全一致。

## 规则

### 体况变化（`onChoice`，核心结算之后）

按以下顺序执行，且每个选择最多让每名成员变化一次：

1. `ch.help`：选当前 `condition` 最低的成员 `+1`，`trust +1`（上限 3），
   `helped++`。同一次选择不要给多人同时加。
2. `ch.camp && !ch.poorCamp`：所有成员 `+1`（上限 3）。
3. `ch.recover`：最低成员再 `+1`（与营地可叠加，但不超过 3）。
4. `ch.risk || ch.detour`：最低成员 `-1`；若是 `storm` 或 `heat` 环境，
   再对同一成员 `-1`（一次选择最多 -2，最低 0）。`risked++`。
5. 以上都没有，且当前不是 `camp/exit`：不变化。

信任：

- `ch.help` → 执行帮助的“最低成员” `trust +1`。
- `ch.risk || ch.detour` 且没有 `ch.help` → 同一成员 `trust -1`（最低 0）。
- `ch.retreat` 不扣信任；撤退是完整决定。

### 角色特长（每天最多一次）

- `route` 前队观察：玩家选择 `ch.navigate` 时，若该成员 `condition > 0`，
  `st.stamina +1`（上限 100），记 `dayUsed.route = st.day`。
  文案：`前队提前确认了岔口，队伍少走一点回头路。`
- `sweep` 收队：玩家选择 `ch.help` 时，若该成员 `condition > 0`，
  `st.stamina +2`（上限 100），记 `dayUsed.sweep = st.day`。
  文案：`收队把最慢的人带进队伍节奏，整体少一次停顿。`
- `supply` 补给整理：在 `ch.camp && !ch.poorCamp` 时，若该成员 `condition > 0`，
  `st.water = min(st.waterCap, r2(st.water + 0.1))`，记 `dayUsed.supply = st.day`。
  文案：`补给整理把余水重新分配，减少一点浪费。`

角色加成只在 `st.day` 与 `dayUsed` 不同日时触发；同一天重复选择不叠加。
角色成员 `condition === 0` 时不触发，并在 `trade` 里标注“受伤，特长不可用”。

### 面板与结局

`panelHTML(st, ctx)` 返回一行紧凑状态，必须用 `ctx.esc` 转义名字：

```html
<p class="partyline">队伍 · 林岚 稳定 / 周野 疲惫 / 小满 受伤 · 信任 2/3</p>
```

不要新增全局 CSS；沿用现有 `statusline` / `hintline` 风格，用内联 class 或
`class="statusline"`。不要写 `<style>`。

`endingHTML(st, ctx)` 返回：

- 每名成员一行：名字、角色、体况、信任。
- 总结标签：
  - 全员 `condition > 0` 且平均信任 `>= 2`：`队伍完整归返`
  - 有成员 `condition === 0`：`带伤归返`
  - 否则：`队伍各自归返`
- 必须注明：`这是游戏状态记录，不评价现实中的队友能力。`

### Echo

`echo(st, card, ctx)`：

- `alerts`：
  - 有成员 `condition === 0`：`同伴受伤：继续冒险会拖慢队伍；优先处理伤情或中止。`
  - 有成员 `condition === 1`：`有同伴开始踉跄：再叠加赶路或偏航，状态会继续下降。`
  - 平均信任 `<= 1`：`队伍信任偏低：连续冒险会让互助失效，结局记录会变差。`
  - 当前 `ch.help` 事件：`这次帮助会改善最低状态成员，并提高信任。`
- `science`：
  `队伍分散会削弱相互观察和求助；把最慢的人留在视线内，比追求整体速度更重要。严重伤情或意识异常应停止并求助。`
- 语气保持游戏内提示，不做现实医疗判断。

## 测试（Node 原生 assert）

`01-companions.test.cjs` 至少覆盖：

1. 同一 seed/路线初始化两次，成员、角色、体况、信任完全一致。
2. 三条路线都能初始化 3 人，`condition` / `trust` 均在 0–3。
3. `help` 只改善最低成员，并加信任；`risk` 只降低最低成员。
4. 营地恢复不会超过 3；连续冒险不会低于 0。
5. 三个角色特长每天只触发一次，受伤成员不触发。
6. `panelHTML` / `endingHTML` 对名字和数值做转义；不出现 `undefined`。
7. 模拟 100 个 seed × 3 路线，状态不出现 `NaN`、负数或越界。

## 交接给接线任务

在说明里列出：

- 实际使用的状态键和函数签名。
- 需要插入 `partyline` 的位置（建议状态行之后）。
- 结局页建议插入位置（环境账本之前）。
- 任何为了不新增按钮而做的取舍。
