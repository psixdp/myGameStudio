# 出千能力系统

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-03
> **Implements Pillar**: 支柱1（出千即爽感——改写骰子的瞬间快感）+ 支柱3（联动 > 单体——组合 > 单体）

## Overview

出千能力系统管理玩家的"作弊工具箱"。能力分三种：消耗品（单轮使用）、
被动能力（整局永久）、骰子扩展（永久增加骰子）。系统负责能力库存管理、
消耗品执行、被动加成计算，以及能力之间的联动处理。

核心设计约束：所有加成走"先加后乘"公式，乘法倍率用积叠加，
防止指数级膨胀。联动产生的是线性或超线性增长，不会指数爆炸。

## Player Fantasy

"我不是在赌，我是在作弊，而且越来越离谱。"
从一把换面消耗品开始，逐步积累铅骰、分身术、连横术、贪欲……每次购买都在解锁新的联动可能。
最强的体验不是单个能力的效果，而是多个能力组合产生的爆炸式分数——这正是支柱3的核心。

## Detailed Design

### Core Rules

#### 能力类型

| 类型 | 生命周期 | 存储位置 | 使用方式 |
|------|---------|---------|---------|
| consumable | 单轮使用后消失 | consumableSlots[] | 玩家主动选择使用，每轮上限2 |
| passive | 整局永久 | passives[] | 自动生效，无需操作 |
| dice_expansion | 购买时立即生效 | 标记在骰子池 | 一次性，增加永久骰子 |

#### 能力实体结构

每个能力从 abilities.json 加载，运行时实例化为：

```javascript
{
  id: "face_change",        // 配置ID
  name: "换面",              // 显示名
  type: "consumable",        // 类型
  cost: 2,                   // 商店价格
  effectType: "set_dice_value",  // 效果标识
  params: { min: 1, max: 6 },    // 效果参数
  description: "将一个骰子变为任意指定点数(1-6)",
  tags: ["universal"]
}
```

#### 消耗品管理

- 玩家持有一个消耗品槽位列表 `consumableSlots`，无上限（可持有任意数量）
- 每轮战斗中最多使用 2 个消耗品
- 使用消耗品 = 从槽位移除 + 执行效果
- 使用顺序由玩家决定
- 透视可在投掷前使用（查看弱点分类），其他在投掷后使用
- 双投消耗品特殊：使用后重新投掷全部骰子，之前的消耗品效果清除

#### 消耗品效果执行

每种消耗品通过 effectType 映射到骰子系统的改写操作：

| effectType | 执行逻辑 | 消耗品 |
|-----------|---------|--------|
| `set_dice_value` | 玩家选择骰子+目标值，调用 `setDie(index, value)` | 换面 |
| `reroll_min` | 玩家选择骰子，调用 `rerollDie(index, params.min)` | 加料 |
| `reveal_weakness` | 标记本场弱点分类（计分时+10），不修改骰子 | 透视 |
| `extra_roll` | 调用骰子系统重新投掷全部，清除之前的改写 | 双投 |
| `replace_lowest` | 调用 `replaceLowest(params.value)` | 偷梁换柱 |

#### 被动能力持续效果

被动能力按 effectType 分类，在不同结算阶段生效：

| effectType | 生效阶段 | 作用对象 | 被动 |
|-----------|---------|---------|------|
| `dice_floor` | 步骤5（铅骰托底） | 骰子系统 | 铅骰 |
| `clone_dice` | 步骤2（投掷时） | 骰子系统 | 分身术 |
| `excess_bonus` | 步骤9（加法加成） | 计分系统 | 连横术 |
| `loose_consecutive` | 步骤6（分类匹配） | 计分系统 | 顺子眼 |
| `score_multiplier` | 步骤10（乘法倍率） | 计分系统 | 贪欲 |
| `category_bonus` | 步骤9（加法加成） | 计分系统 | 牌型大师 |

#### 被动加成计算接口

出千能力系统向计分系统提供以下接口：

```javascript
// 加法加成（步骤9）
getFlatBonuses(matchedCategory, dicePool) → Number

// 乘法倍率（步骤10）
getMultipliers() → Number
```

各被动的计算逻辑：

**连横术（excess_bonus）**：
```
matchedCount = 匹配值在骰子池中出现的次数
requiredCount = 匹配分类的最低要求
excessCount = max(0, matchedCount - requiredCount)
bonus = excessCount * params.perExcess
```

**牌型大师（category_bonus）**：
```
if (matchedCategory in params.categories):
    return params.bonus
else:
    return 0
```

**贪欲（score_multiplier）**：
```
return params.multiplier  // 如 1.2
```

#### 被动叠加规则

**核心约束：先加后乘，乘法用积**

- 多个 flat 加成：求和 → `totalFlat = Σ flat_i`
- 多个 multiplier：求积 → `totalMultiplier = Π mult_i`
- 最终：`score = floor((base + totalFlat) * totalMultiplier)`

这保证乘法不会指数爆炸——即使有 3 个 ×1.5 的倍率，也只有 1.5³ = 3.375 倍，而非叠加到不可控。

#### 封印被动处理

敌人规则"封印被动"的处理：
- 封印购买价格最高的被动能力（按实际支付价格判断）
- 被封印的被动在 `getFlatBonuses()` 和 `getMultipliers()` 中返回 0
- 多个同价则随机选一个
- 没有被动时此规则无效

### States and Transitions

```
[空手] --获得初始消耗品--> [有消耗品]
                          |
              +--购买消耗品--+
              |              |
              +--购买被动----+---> [能力集合更新]
              |              |
              +--购买骰子扩--+
                                |
[战斗中] --使用消耗品--> [消耗品减少, 效果执行]
[战斗中] --被动自动生效--> [无状态变化, 输出加成]
[战斗结束] --骰子扩展立即生效--> [骰子池+1]
[新一局] --重置--> [空手]
```

### Interactions with Other Systems

| 系统 | 交互方向 | 说明 |
|------|---------|------|
| 数据配置系统 | 读 | abilities.json（能力定义） |
| 经济系统 | 写 | 购买时调用 spend() |
| 骰子系统 | 写 | 消耗品/被动调用骰子改写接口 |
| 计分系统 | 读（被读） | 计分系统调用 getFlatBonuses()、getMultipliers() |
| 敌人系统 | 读 | 读取封印被动规则 |
| 商店系统 | 双向 | 商店提供购买，出千能力系统管理库存 |
| 战斗系统 | 双向 | 战斗协调消耗品使用和被动生效时机 |
| UI系统 | 被读 | 读取能力列表、消耗品槽位 |

## Formulas

### 加法加成总和

```
flatBonusTotal = 0

// 连横术
if (hasPassive('chain_link') && matchedCategory.requiresMatchCount):
    flatBonusTotal += excessCount * 3

// 牌型大师
if (hasPassive('pattern_master') && matchedCategory in [full_house, yahtzee]):
    flatBonusTotal += 10

// 透视弱点分类
if (weaknessRevealed && matchedCategory == weaknessCategory):
    flatBonusTotal += 10
```

### 乘法倍率总和

```
totalMultiplier = 1.0

// 贪欲
if (hasPassive('greed')):
    totalMultiplier *= 1.2

// 未来新增乘法被动也用积叠加
// 例：如果有两个 ×1.2 → totalMultiplier = 1.2 × 1.2 = 1.44
```

### 分身术触发

```
if (hasPassive('clone_dice')):
    sourceDie = cloneRng.pick(dicePool)    // 使用 clone 流
    tempDie = createTempDie(sourceDie.value)
    dicePool.addTemp(tempDie)
```

### 数值上限估算

理论最大分数（7骰子 + 全部被动 + 最优消耗品）：

```
骰子: [6,6,6,6,6,6,6] (7颗，含1颗临时分身)
匹配: 豹子 (×3)
基础分: 42 × 3 = 126

加法加成:
  牌型大师(豹子): +10
  连横术: 0 (豹子无超出)
  透视: +10 (如果弱点=豹子)
  合计: +20

乘法倍率:
  贪欲: ×1.2
  合计: 1.2

最终: floor((126 + 20) × 1.2) = floor(175.2) = 175
```

175 远低于第8轮目标 250，说明后期需要更强的联动或更多被动才有机会通关。
这是设计意图——游戏应该难，不是轻松碾压。

## Edge Cases

| 情况 | 处理方式 |
|------|---------|
| 消耗品槽位为空时尝试使用 | UI 不显示使用按钮，无法操作 |
| 每轮使用第3个消耗品 | 被拒绝，计数器已达上限 2 |
| 双投后之前的消耗品效果 | 清除，骰子回到纯随机状态 |
| 没有被动时遭遇封印被动 | 规则无效果 |
| 多个同价被动被封印 | 随机选一个（使用 enemy 流决定） |
| 分身术 + 骰子池已满(7) | 临时突破到 8，当轮结束恢复 |
| 顺子眼 + 分类匹配 | 计分系统检测到顺子眼标记后放宽连续条件 |
| 连横术 + 豹子 | 超出 = 0（所有骰子都匹配），加成为 0 |
| 连横术 + 对子 + 多组对子 | 取匹配组的超出数，不重复计算 |
| 贪欲影响商店价格 | 在经济系统/商店系统中处理，不影响能力系统内部 |
| 贪欲影响封印判断 | 封印按实际支付价格判断（含贪欲加价后） |
| 同一被动购买两次 | 不允许，商店不展示已拥有的被动 |
| 新增 effectType | 由能力系统运行时解析，无需改框架 |

## Dependencies

### 上游依赖

| 系统 | 依赖性质 | 使用内容 |
|------|---------|---------|
| 数据配置系统 | 硬依赖 | abilities.json（能力定义、效果参数） |
| 骰子系统 | 硬依赖 | 骰子改写接口（消耗品/被动执行） |
| 经济系统 | 硬依赖 | spend()（购买消耗代币） |
| 随机数系统 | 硬依赖 | clone 流（分身术随机目标） |

### 下游依赖（被依赖）

| 系统 | 依赖性质 | 读取内容 |
|------|---------|---------|
| 计分系统 | 硬依赖 | getFlatBonuses()、getMultipliers() |
| 商店系统 | 双向依赖 | 商店展示/出售，能力系统管理库存 |
| 战斗系统 | 硬依赖 | 消耗品使用协调、被动生效时机 |
| 敌人系统 | 间接依赖 | 封印被动规则 |
| UI系统 | 软依赖 | 能力列表、消耗品槽位显示 |

## Tuning Knobs

| 参数 | 当前值 | 建议范围 | 影响面 | 来源 |
|------|--------|---------|-------|------|
| 每轮消耗品上限 | 2 | 1-3 | 操控空间、消耗速度 | global-config.json |
| 换面费用 | 2 | 1-3 | 最基础消耗品的性价比 | abilities.json |
| 加料费用 | 2 | 1-3 | 稳定改写的性价比 | abilities.json |
| 双投费用 | 3 | 2-4 | 额外投掷的价值 | abilities.json |
| 偷梁换柱费用 | 3 | 2-4 | 强力改写的价值 | abilities.json |
| 铅骰费用 | 4 | 3-5 | 基础分下限的价值 | abilities.json |
| 分身术费用 | 5 | 4-6 | 骰子增加的价值 | abilities.json |
| 连横术费用 | 4 | 3-5 | 超额加成的价值 | abilities.json |
| 顺子眼费用 | 4 | 3-5 | 顺子解锁的价值 | abilities.json |
| 贪欲费用 | 3 | 2-4 | 全局乘法的价值 | abilities.json |
| 牌型大师费用 | 4 | 3-5 | 高级分类加成的价值 | abilities.json |
| 备用骰费用 | 4 | 3-5 | 骰子扩展的价值 | abilities.json |
| 千王骰费用 | 6 | 4-8 | 带初始值的骰子扩展 | abilities.json |
| 连横术每颗加成 | +5 | 1-7 | 连横术收益 | abilities.json |
| 牌型大师加成 | +20 | 5-25 | 高级分类额外价值（满堂红/豹子/三条） | abilities.json |
| 贪欲倍率 | ×2.0 | ×1.2-×2.0 | 全局放大 | abilities.json |
| 初始免费消耗品 | 1个换面 | 0-2 | 新手友好度 | global-config.json |

## Acceptance Criteria

| 编号 | 验收条件 | 验证方式 |
|------|---------|---------|
| AC-1 | 购买消耗品正确加入槽位 | 单元测试：购买后 consumableSlots.length +1 |
| AC-2 | 购买被动正确加入列表 | 单元测试：购买后 passives 包含该能力 |
| AC-3 | 使用消耗品后从槽位移除 | 单元测试：使用后 consumableSlots.length -1 |
| AC-4 | 每轮消耗品上限2个 | 单元测试：第3次使用被拒绝 |
| AC-5 | getFlatBonuses 无被动时返回 0 | 单元测试：空被动列表，返回 0 |
| AC-6 | 连横术超出计算正确 | 单元测试：[4,4,4,4,2]+连横术 → bonus=3 |
| AC-7 | 连横术+豹子返回 0 | 单元测试：[6,6,6]+连横术+豹子 → bonus=0 |
| AC-8 | 牌型大师仅对满堂红/豹子生效 | 单元测试：对子时不触发，豹子时+10 |
| AC-9 | 贪欲乘法用积叠加 | 单元测试：两个×1.2 → 总倍率=1.44 |
| AC-10 | 封印被动正确封印最贵被动 | 单元测试：3个被动，封印后最贵的返回0 |
| AC-11 | 同一被动不可重复购买 | 单元测试：重复购买被拒绝 |
| AC-12 | 双投清除之前消耗品效果 | 单元测试：换面后双投，骰子回到随机 |

## Open Questions

暂无。后续需要通过数值建模验证所有被动组合的理论最大分数。
