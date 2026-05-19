# UI 系统 + 反馈动效

> **Status**: Reverse-documented
> **Source**: `src/ui.js` (1422行), `index.html`, `css/style.css` (1440行)
> **Author**: 从实现反推
> **Last Updated**: 2026-05-14
> **Verified-by**: user
> **定位**: 功能性参考 UI（MVP 验证用），布局和交互流程已确定，视觉风格后续迭代

> **Note**: 本文档从现有实现反推生成，记录当前行为和已确认的设计意图。部分章节
> 在实现不完整或意图不明确处标记为 [TODO]。

---

## Overview

UI 系统是千王骰局的唯一表现层，负责将 `GameFlow` 的游戏状态渲染到浏览器 DOM，
并处理所有用户输入事件。系统采用"单一控制器"架构，`GameUI` 类同时管理状态映射、
DOM 渲染和事件绑定，不引入额外的框架或状态管理层。

反馈动效作为 UI 系统的子系统，内嵌在 `GameUI` 中，负责骰子滚动、碗盖扣/揭、
分数滚动、骰子微调等动画效果。动效代码与渲染逻辑在同一文件中，未独立抽取。

### 技术选型

| 维度 | 选择 | 理由 |
|------|------|------|
| 渲染方式 | DOM + CSS（非 Canvas） | Jam 级别 MVP，开发速度快 |
| 状态绑定 | 手动渲染（无框架） | 代码量小，无构建依赖 |
| 动画 | CSS @keyframes + JS setTimeout | 简单直接，无动画库依赖 |
| 布局 | CSS Grid 三栏 | 固定结构，响应式需求低 |
| 模块化 | ES6 静态 import | 浏览器原生支持 |

---

## Player Fantasy

**UI 层面**: "一目了然：敌人的威胁、我的手牌、出千的时机。"
玩家不应需要教程就能理解界面信息：目标分数在哪里、消耗品怎么用、出千的窗口何时打开。

**动效层面**: "投掷的紧张 → 盖碗的掌控 → 揭晓的释放。"
动效服务于三段式情绪曲线，不是装饰。

---

## Detailed Design

### 1. 布局结构

```
┌─────────────────── header ────────────────────┐
│  🎲 千王骰局          Round 1/8  Tokens: 5    │
├──────┬──────────── main ────────────┬─────────┤
│      │  ┌── enemy-panel ─────────┐  │         │
│  🎒  │  │ 街头混混  目标: 8 分   │  │   ⚡    │
│ 消耗 │  │ 💡弱点  ⚠️规则         │  │  被动   │
│  品  │  └────────────────────────┘  │  能力   │
│      │  ┌── battle-area ─────────┐  │         │
│ 120px│  │     牌桌               │  │  120px  │
│      │  │   [骰子]  碗盖         │  │         │
│      │  │   分数: 12 / 8         │  │         │
│      │  └────────────────────────┘  │         │
│      │  ┌── actions ─────────────┐  │         │
│      │  │ [投掷]  [使用消耗品]   │  │         │
│      │  └────────────────────────┘  │         │
├──────┴──────────────────────────────┴─────────┤
```

**Grid 定义**:
```css
grid-template-columns: 120px minmax(380px, 540px) 120px;
grid-template-areas:
  "header header header"
  "consumables main passives";
```

**容器宽度**: `width: min(100%, 900px)`，居中显示。

### 2. 渲染架构

#### 2.1 核心渲染循环

```
_render()
  ├── 读取 GameFlow.getState()
  ├── 清理选择模式（非投掷后状态）
  ├── switch(state) 分发到:
  │   ├── BATTLE       → _renderBattle()
  │   ├── BOWL_COVERED → _renderRollResult()
  │   ├── ROLL_RESULT  → _renderRollResult()
  │   ├── SHOP         → _renderShop()
  │   ├── VICTORY      → _renderGameOver()
  │   └── DEFEAT       → _renderGameOver()
  └── _updateButtons()  // 根据状态启用/禁用按钮
```

**渲染模式**: 全量重渲染（每次调用清除 `innerHTML` 并重建 DOM）。
无虚拟 DOM、无差量更新。Jam 级别 MVP 下性能可接受。

#### 2.2 DOM 元素缓存

`_cacheElements()` 在 `init()` 时一次性通过 `getElementById` 缓存全部 40+ 个 DOM 引用，
存储在 `this._elements` 对象中。渲染过程不执行任何 DOM 查询。

### 3. 交互流程

#### 3.1 投掷流程

```
玩家点击"投掷"
  → _onRoll()
    → 设置 _isRolling = true，禁用按钮
    → 骰子滚动动画 (1.5s, 100ms 间隔随机值)
    → GameFlow.executeRollPhase()  // 执行游戏逻辑
    → _showBowlStatus()            // 碗盖扣下动画
    → 存储 _pendingRollResult
    → _render()                    // 渲染出千阶段
```

#### 3.2 出千/消耗品使用流程

```
投掷后进入 BOWL_COVERED / ROLL_RESULT 状态
  → 显示分数对比 + "可出千" 状态提示
  → 动态确认按钮:
    ├── 分数 ≥ 目标 → "🎉 进入商店" (绿色)
    └── 分数 < 目标 → "🏳️ 认输" (红色)

使用消耗品:
  → 点击消耗品卡片 → _onSelectConsumable(index)
  → 判断目标类型:
    ├── 无目标 → 直接使用
    ├── 单目标 (targeted) → 进入骰子选择模式 → 点击骰子 → 确认
    ├── 双目标 (targeted_dual) → 依次选两个骰子 → 确认
    └── 换面 (set_dice_value) → 选骰子 → 弹出点数选择器 → 确认
  → Combat.useConsumable() → 应用效果
  → 骰子微调动画 (nudge, 300ms)
  → 重新计分 → 刷新渲染

确认结果:
  → _onConfirmResult()
    → _hideBowlStatus()  // 揭碗动画
    → GameFlow.finalizeBattle()
    → 进入商店/游戏结束
```

#### 3.3 商店流程

```
战斗胜利 → SHOP 状态
  → _renderShop()
    → 显示遮罩弹窗
    → 渲染商店物品列表（名称 + 描述 + 价格）
    → 渲染下一关敌人预览（名称 + 目标 + 规则）
    → 刷新按钮（消耗 1 代币）

购买: 点击物品 → shop.buy(index) → Toast 反馈
刷新: 点击刷新 → shop.refresh() → 重新渲染
离开: 点击离开 → gameFlow.closeShop() → 进入下一轮
```

#### 3.4 物品详情查看

```
点击消耗品/被动卡片
  → _openDetail(type, index)
    → 记录 _activeDetail = { type, index }
    → 渲染浮层: 名称 / 类型 / 成本 / 描述 / 效果提示
    → 显示 #detail-overlay

关闭: 点击关闭按钮 / 点击遮罩 / 按 Escape
```

#### 3.5 记分规则查看

```
点击"📊 记分规则"按钮
  → _renderScoringRules()
    → 读取所有分类 → 渲染表格（牌型 / 匹配条件 / 基础分公式 / 被动影响）
    → 读取被动能力列表 → 计算对各类别的影响
    → 显示计分公式说明

关闭: 点击关闭按钮 / 按 Escape
```

### 4. UI 状态管理

#### 4.1 GameUI 内部状态

| 属性 | 类型 | 用途 |
|------|------|------|
| `_gameFlow` | GameFlow | 游戏逻辑实例 |
| `_elements` | Object | 缓存的 DOM 引用 (40+) |
| `_selectedConsumableIndex` | number\|null | 当前选中的消耗品槽位 |
| `_selectedPassiveIndex` | number\|null | 当前选中的被动槽位 |
| `_isRolling` | boolean | 投掷动画进行中 |
| `_pendingRollResult` | Object\|null | 待确认的投掷结果 |
| `_activeDetail` | Object\|null | 当前打开的详情 { type, index } |
| `_isSelectingTarget` | boolean | 正在为消耗品选择骰子目标 |
| `_selectedDieIndex` | number\|null | 选中的第 1 个骰子 |
| `_selectedDieIndex2` | number\|null | 选中的第 2 个骰子（换位用） |
| `_pendingFaceChange` | Object\|null | 换面消耗品的待确认上下文 |

#### 4.2 状态转换与 UI 对应

```
MENU → init() → BATTLE
BATTLE → _onRoll() → BOWL_COVERED/ROLL_RESULT
BOWL_COVERED/ROLL_RESULT → _onConfirmResult() → SHOP | VICTORY | DEFEAT
SHOP → _onCloseShop() → BATTLE
VICTORY/DEFEAT → _onRestart() → BATTLE
```

### 5. 物品图标系统

#### 5.1 架构

图标系统为每种消耗品和被动能力生成独立的 SVG 矢量图标，内嵌在物品卡片中。

```
ITEM_ICON_DEFINITIONS  // 30+ 种能力的图标定义 { symbol, primary, secondary }
  → getItemIconDefinition(item, type)  // 查找定义，未命中则用 fallback
  → buildInventoryIconSvg(item, type)  // 生成完整 SVG
    → buildItemIconSymbol(symbol, primary, secondary)  // 生成符号路径
```

#### 5.2 图标样式区分

- **消耗品**: 圆角矩形边框 (`<rect rx="16">`)
- **被动能力**: 六边形边框 (`<polygon>`)
- **颜色**: 每种能力有独立的 primary / secondary 配色

#### 5.3 已定义图标的消耗品/被动

消耗品（11 种）: face_change, loaded_shot, insight, double_roll, swap_lowest, swap_dice,
gamble, freeze_die, invert_dice, devils_bargain, all_in

被动能力（13 种）: loaded_dice, clone_dice, chain_link, straight_eye, greed,
pattern_master, decree_override, heaven_dice, judgment_flip, perfectionist,
straight_momentum, double_vision, rainbow, lucky_six, dice_army

### 6. 反馈动效子系统

#### 6.1 骰子滚动动画

| 参数 | 值 | 说明 |
|------|-----|------|
| 总时长 | 1500ms | `_onRoll()` 中的 `rollDuration` |
| 更新间隔 | 100ms | `setInterval` 间隔 |
| 动画类 | `.rolling` | CSS 定义的旋转/缩放动画 |
| 数值来源 | `Math.random() * 6 + 1` | 纯视觉，不影响游戏逻辑 |

流程:
1. 为所有骰子元素添加 `.rolling` CSS 类
2. 100ms 定时器随机更新骰子显示值（纯视觉）
3. 1.5s 后清除定时器和 `.rolling` 类
4. 执行 `GameFlow.executeRollPhase()` 获取真实结果
5. 渲染真实骰子值

#### 6.2 碗盖动画

碗盖是"盖碗阶段"的核心视觉元素，用 CSS 类控制状态切换。

| 状态 | CSS 类 | 时长 | 视觉效果 |
|------|--------|------|---------|
| 隐藏 | `.hidden` | — | 不显示 |
| 扣下 | `.covered` | 180ms | 碗盖从上方落下覆盖骰子 |
| 揭开 | `.revealing` | 220ms | 碗盖上移消失 |

DOM 元素: `#dice-bowl > #bowl-status-text`

触发时机:
- **扣下**: `_onRoll()` 完成投掷后调用 `_showBowlStatus()`
- **揭开**: `_onConfirmResult()` 确认时调用 `_hideBowlStatus()`

#### 6.3 分数数字滚动

| 参数 | 值 |
|------|-----|
| 默认时长 | 500ms |
| 步数 | 20 步 |
| 算法 | 线性插值 (`startValue + stepValue * (i + 1)`) |
| 步间隔 | `duration / 20` (25ms) |

用于 `_renderRollResult()` 中分数显示的渐变效果，从旧值平滑过渡到新值。

#### 6.4 骰子微调动画

| 参数 | 值 |
|------|-----|
| CSS 类 | `.nudge` |
| 时长 | 300ms |

触发场景:
- 消耗品使用后，被修改的单个骰子
- 赌博/双投等影响全部骰子的效果，所有骰子同时触发
- 动画完成后移除 `.nudge` 类

#### 6.5 Toast 提示

| 参数 | 值 |
|------|-----|
| 默认显示时长 | 2500ms |
| 实现 | 动态创建 `.toast` 元素 → `setTimeout` 后移除 |

用于所有操作的即时反馈：消耗品使用、购买成功/失败、目标选择提示等。

### 7. 弹窗/浮层系统

系统使用"遮罩 + 内容面板"模式实现所有弹窗，统一通过 `.overlay` 和 `.hidden` 类控制显隐。

| 弹窗 | 触发 | 关闭方式 |
|------|------|---------|
| 商店 (`#shop-overlay`) | 战斗胜利自动弹出 | 点击"离开" |
| 记分规则 (`#scoring-rules-overlay`) | 点击"📊 记分规则" | 点击 × / Escape |
| 游戏结束 (`#gameover-overlay`) | 8 轮胜利或失败 | 点击"再来一局" |
| 点数选择器 (`#value-picker-overlay`) | 换面消耗品确认 | 选值 / 取消 |
| 物品详情 (`#detail-overlay`) | 点击物品卡片 | 点击 × / 点击遮罩 / Escape |

### 8. 消耗品效果 UI 反馈映射

| effectType | UI 反馈 |
|------------|---------|
| `reroll_min` | 单骰 nudge，Toast "加料：重掷骰子（最小N）" |
| `replace_lowest` | 自动找最低骰子 nudge，Toast "偷梁换柱：最低骰子变为N" |
| `swap_values` | 无特殊动画，Toast "换位：交换了两个骰子" |
| `gamble_reroll` | 全部骰子 nudge，Toast 根据结果变化（"大成功"/"失败"） |
| `freeze_die` | 骰子添加 `.frozen` 类（持久视觉标记） |
| `invert_value` | 单骰 nudge，Toast "反转：骰子值已反转" |
| `extra_roll` | 全部骰子 nudge，Toast "双投：重新投掷全部骰子" |
| `reveal_weakness` | Toast "透视：已显示弱点分类" |
| `temp_multiplier_penalty` | Toast 显示倍率和下轮惩罚 |
| `sacrifice_consumables` | Toast 显示销毁数量和加分 |
| `set_dice_value` | 弹出点数选择器 → 确认后 Toast "换面：骰子设为N" |

---

## Formulas

UI 系统本身不包含游戏公式。以下为 UI 相关的计算：

### 分类显示名称映射

```
bust           → 散牌
pair           → 对子
three_of_a_kind → 三条
small_straight  → 小顺
full_house     → 满堂红
large_straight  → 大顺
yahtzee        → 豹子
```

### 记分规则弹窗中的公式文本

```
bonusType === 'multiplier' → "骰子之和 × bonusValue"
bonusType === 'flat'       → "骰子之和 + bonusValue"（bonusValue > 0）
其他                       → "骰子之和"
```

### 被动效果文本生成

| effectType | 显示文本 |
|------------|---------|
| `category_bonus` | "{name} +{bonus}" |
| `excess_bonus` | "{name} 超额+{perExcess}" |
| `score_multiplier` | "{name} ×{multiplier}" |
| `victory_reverse` | "{name} 目标×{threshold}" |
| `category_override` | "{name} 强制{forceCategory}" |

---

## Edge Cases

### 已处理的边界情况

| 场景 | 处理方式 |
|------|---------|
| 消耗品列表为空 | 显示"（空）"灰色提示文本，关闭已有详情浮层 |
| 被动列表为空 | 同上 |
| 双目标选择中点了同一个骰子 | 重置第一个选择，重新开始 |
| 换面消耗品取消选值 | 不消耗道具，`_pendingFaceChange = null` |
| 使用消耗品时无选中道具 | `_selectedConsumableIndex === null` → 按钮已禁用 |
| 商店物品已售罄 | 渲染时 `item === null` 跳过该槽位 |
| 最后一轮胜利后商店 | 无下一关预览（`nextEnemyPreview` 为 null → 隐藏预览区域） |
| 被动被封印（sealed） | 记分规则弹窗中跳过该被动的效果文本 |
| 投掷动画进行中重复点击 | `_isRolling` 标志阻止重复触发 |

### 未处理的边界情况 [TODO]

| 场景 | 当前行为 | 建议 |
|------|---------|------|
| 窗口宽度 < 620px | 布局错乱 | 添加响应式断点或提示横屏 |
| 快速连续点击消耗品 | 可能出现竞态 | 添加防抖或禁用态 |
| 浏览器不支持 ES6 module | 白屏无提示 | 添加 `<noscript>` 或降级提示 |

---

## Dependencies

### 上游依赖（UI 读取数据的系统）

| 系统 | 依赖方式 | 使用的方法 |
|------|---------|-----------|
| GameFlow | 状态查询 | `getState()`, `getCurrentRound()`, `getTotalRounds()`, `getResult()`, `executeRollPhase()`, `finalizeBattle()`, `recalculateRollResult()` |
| Combat | 战斗操作 | `getResult()`, `useConsumable()` |
| CheatingAbilities | 道具数据 | `getConsumables()`, `getPassives()`, `canUseConsumable()`, `getWeaknessCategory()`, `isPassiveSealed()`, `getPassiveByEffect()` |
| DicePool | 骰子数据 | `getDice()`, `getValues()` |
| Enemy | 敌人数据 | `getName()`, `getTargetScore()`, `getRules()` |
| Economy | 经济数据 | `getBalance()` |
| Shop | 商店操作 | `getDisplayItems()`, `buy()`, `refresh()`, `canRefresh()`, `getNextEnemyPreview()` |
| DataConfig | 配置数据 | `getCategories()` |

### 下游被依赖

UI 系统是最顶层表现层，无下游依赖。

### 与反馈动效系统的关系

反馈动效代码内嵌在 `GameUI` 类中（`_animateNumber`, `_showBowlStatus`,
`_hideBowlStatus`, 骰子 nudge 动画等），不作为独立模块存在。
如果后续需要更复杂的动效编排，建议抽离为独立的 `FeedbackController` 类。

---

## Tuning Knobs

### 动效参数

| 参数 | 当前值 | 影响范围 | 安全范围 |
|------|--------|---------|---------|
| `rollDuration` | 1500ms | 投掷动画总时长 | 800-2500ms |
| `rollInterval` | 100ms | 骰子值随机更新频率 | 50-200ms |
| `bowlCoverDelay` | 180ms | 碗盖扣下动画时长 | 100-400ms |
| `bowlRevealDelay` | 220ms | 碗盖揭开动画时长 | 100-500ms |
| `scoreAnimDuration` | 500ms | 分数数字滚动时长 | 200-1000ms |
| `scoreAnimSteps` | 20 | 分数滚动步数 | 10-30 |
| `nudgeDuration` | 300ms | 骰子微调动画时长 | 100-500ms |
| `toastDuration` | 2500ms | Toast 提示显示时长 | 1500-4000ms |

### 布局参数（CSS）

| 参数 | 当前值 | 说明 |
|------|--------|------|
| `grid-template-columns` | `120px minmax(380px, 540px) 120px` | 三栏宽度 |
| `max-width` | 900px | 应用容器最大宽度 |

---

## Acceptance Criteria

### 基本功能

- [ ] AC-1: 页面加载后显示三栏布局，中央区域包含敌人信息、牌桌、操作按钮
- [ ] AC-2: 点击"投掷"按钮后骰子播放滚动动画(1.5s)，最终显示正确结果
- [ ] AC-3: 投掷后自动进入碗盖阶段，显示"可出千"状态
- [ ] AC-4: 分数 ≥ 目标时确认按钮显示"进入商店"（绿色），< 目标时显示"认输"（红色）
- [ ] AC-5: 选择消耗品后若需目标选择，骰子进入可点击状态，点击后有选中视觉反馈
- [ ] AC-6: 双目标消耗品（换位）支持依次选择两个骰子
- [ ] AC-7: 换面消耗品先选目标骰子，再弹出 1-6 点数选择器，确认后才消耗道具
- [ ] AC-8: 消耗品使用后显示 Toast 效果描述，被修改的骰子播放 nudge 动画
- [ ] AC-9: 商店弹窗显示物品列表、代币余额、下一关敌人预览
- [ ] AC-10: 点击物品卡片弹出详情浮层，显示名称/类型/成本/描述/效果
- [ ] AC-11: 记分规则弹窗展示所有牌型的匹配条件、基础分公式、当前被动影响
- [ ] AC-12: 游戏结束弹窗显示最终轮次/分数/击败敌人数/剩余代币
- [ ] AC-13: 点击"再来一局"重新开始游戏，所有 UI 状态正确重置

### 动效

- [ ] AC-14: 骰子滚动期间每 100ms 随机变化显示值，CSS 动画流畅
- [ ] AC-15: 碗盖扣下/揭开动画正确触发和清除
- [ ] AC-16: 分数数字从旧值平滑滚动到新值（20 步线性插值）
- [ ] AC-17: Toast 提示 2.5s 后自动消失

### 交互边界

- [ ] AC-18: 投掷动画进行中按钮禁用，无法重复触发
- [ ] AC-19: 无选中消耗品时"使用消耗品"按钮禁用
- [ ] AC-20: Escape 键关闭当前打开的弹窗（详情/记分规则）
- [ ] AC-21: 点击弹窗遮罩背景关闭详情浮层
