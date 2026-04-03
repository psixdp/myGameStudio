# 战斗系统

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-03
> **Implements Pillar**: 全部四根（战斗是所有系统交汇的核心体验）

## Overview

战斗系统是一场战斗的完整编排器。它不执行具体的骰子操作或计分计算，
而是按严格的12步结算顺序协调骰子系统、敌人系统、出千能力系统和计分系统。

战斗系统的职责是"按时、按序、正确地调用各系统"，确保结算流程中的每一步
都在正确的时机发生，每一步的输入都是上一步的输出。

## Player Fantasy

"一次投掷，十二步结算，每一步都在改写命运。"
玩家看到的不应该是12个步骤，而是连贯的战斗叙事：
投掷 → 敌人搞事 → 我出千反击 → 分数一步步暴涨 → 最终判定。
每个步骤的视觉反馈让玩家理解"发生了什么"。

## Detailed Design

### Core Rules

#### 12步结算流程

每场战斗严格按以下顺序执行：

| 步骤 | 名称 | 执行系统 | 输入 | 输出 |
|------|------|---------|------|------|
| 1 | 展示敌人信息 | 战斗系统（编排） | 敌人系统数据 | UI 展示目标分数和规则 |
| 2 | 投掷骰子 | 骰子系统 | 骰子池 | 每颗骰子获得随机值 |
| 3 | 敌人规则（骰子类） | 骰子系统 | 敌人规则参数 | 骰子值被修改 |
| 4 | 玩家使用消耗品 | 出千能力系统 + 骰子系统 | 消耗品槽位 | 骰子值被改写 |
| 5 | 被动托底 | 骰子系统 | 铅骰参数 | 低于下限的骰子被托底 |
| 6 | 分类匹配 | 计分系统 | 骰子池 + 敌人规则 | 匹配的最高优先级分类 |
| 7 | 基础分计算 | 计分系统 | 分类 + 骰子值 | 分类基础分 |
| 8 | 敌人规则（计分类） | 计分系统 | 敌人规则 | 分数被调整（最低点归零） |
| 9 | 加法加成 | 计分系统 | 被动能力列表 | flatBonus |
| 10 | 乘法倍率 | 计分系统 | 被动能力列表 | multiplier |
| 11 | 向下取整 | 计分系统 | 中间分数 | 最终分数（整数） |
| 12 | 胜负判定 | 战斗系统 | 最终分数 vs 目标分数 | 胜利/失败 |

#### 各步骤详细说明

**步骤 1：展示敌人信息**
```
enemy = enemySystem.getByRound(currentRound)
ui.showEnemyInfo(enemy)
if (enemy.bossRule):
    bossRules = enemySystem.rollBossRules(enemy)
    ui.showBossRules(bossRules)
```

**步骤 2：投掷骰子**
```
dicePool.rollAll()    // 调用骰子系统，使用 dice 流
ui.showDiceResult(dicePool)
```

**步骤 3：敌人规则（骰子类）**
```
for rule in enemy.getActiveRules():
    switch rule.effectType:
        case "reroll_random":       // 狸猫换子
            dicePool.rerollRandom(rule.params.count)  // 使用 enemy 流
            ui.showEnemyEffect("敌人重掷了你的一颗骰子")
        case "dice_decrease":       // 全面压制
            dicePool.decreaseAll(rule.params.amount, rule.params.minValue)
            ui.showEnemyEffect("所有骰子点数-1")
```

**步骤 4：玩家使用消耗品**
```
consumablesUsed = 0
while (consumablesUsed < maxConsumablesPerRound):
    choice = ui.promptConsumableUse(consumableSlots)
    if (choice == null): break      // 玩家选择不用了
    executeConsumable(choice)        // 调用出千能力系统
    consumablesUsed++
    ui.showDiceResult(dicePool)      // 实时更新显示
```

透视消耗品特殊情况：可在步骤1后（投掷前）使用，标记弱点分类。
双投消耗品特殊情况：使用后回到步骤2重新投掷，之前的消耗品效果清除。

**步骤 5：被动托底**
```
if (hasPassive('loaded_dice')):
    dicePool.setFloor(passive.params.minValue)  // 铅骰：最低值为2
```

**步骤 6：分类匹配**
```
blockedCategories = enemy.getBlockedCategories()  // 如封锁对子
matchedCategory = scoringSystem.matchCategory(dicePool, blockedCategories)
ui.showMatchedCategory(matchedCategory)
```

**步骤 7：基础分计算**
```
categoryBase = scoringSystem.calculateBase(dicePool, matchedCategory)
ui.showBaseScore(categoryBase)
```

**步骤 8：敌人规则（计分类）**
```
for rule in enemy.getActiveRules():
    if (rule.effectType == "zero_lowest"):
        scoringSystem.applyZeroLowest(dicePool, rule.params.count)
```

**步骤 9-11：加成计算和取整**
```
flatBonus = cheatingSystem.getFlatBonuses(matchedCategory, dicePool)
multiplier = cheatingSystem.getMultipliers()
finalScore = Math.floor((categoryBase + flatBonus) * multiplier)
ui.showScoreBreakdown(categoryBase, flatBonus, multiplier, finalScore)
```

**步骤 12：胜负判定**
```
if (finalScore >= enemy.targetScore):
    result = VICTORY
    economy.earn(tokenRewards[currentRound - 1])
else:
    result = DEFEAT
    // 游戏结束，由游戏流程系统处理
```

#### 分身术触发时机

分身术在步骤 2 投掷时触发（投掷后、敌人规则前）：
```
// 步骤 2 扩展
dicePool.rollAll()
if (hasPassive('clone_dice')):
    dicePool.addTempDie()    // 使用 clone 流随机选一颗复制
```

#### 封印被动触发时机

封印被动在步骤 1 展示敌人信息时确定，影响步骤 4-11 的整个结算：
```
// 步骤 1 扩展
if (enemy.hasRule('seal_passive')):
    sealedPassive = cheatingSystem.sealMostExpensive()
    ui.showSealedPassive(sealedPassive)
```

### States and Transitions

一场战斗的完整状态机：

```
[等待开始]
    |--战斗开始-->
[展示敌人] ────────────────────────── 步骤1
    |--玩家确认-->
[投掷] ───────────────────────────── 步骤2 + 分身术
    |-->
[敌人规则生效] ─────────────────────── 步骤3
    |-->
[消耗品使用] ──循环──> [消耗品使用] ── 步骤4（最多2次）
    |-->
[被动托底] ────────────────────────── 步骤5
    |-->
[分类匹配] ────────────────────────── 步骤6
    |-->
[基础分计算] ──────────────────────── 步骤7
    |-->
[敌人计分规则] ────────────────────── 步骤8
    |-->
[加法加成] ────────────────────────── 步骤9
    |-->
[乘法倍率] ────────────────────────── 步骤10
    |-->
[取整] ────────────────────────────── 步骤11
    |-->
[胜负判定] ────────────────────────── 步骤12
    |-->
[胜利] ──获得代币──> [战斗结束]
[失败] ──────────────> [游戏结束]
```

### Interactions with Other Systems

| 系统 | 角色 | 说明 |
|------|------|------|
| 骰子系统 | 被调用 | 步骤2（投掷）、3（敌人改写）、4（消耗品改写）、5（托底） |
| 计分系统 | 被调用 | 步骤6（匹配）、7（基础分）、8（敌人计分）、9（加法）、10（乘法）、11（取整） |
| 敌人系统 | 被读取 | 步骤1（加载敌人）、3（骰子类规则）、6（封锁分类）、8（计分类规则） |
| 出千能力系统 | 被调用 | 步骤4（消耗品执行）、5（被动托底参数）、9-10（被动加成） |
| 经济系统 | 被调用 | 步骤12（胜利后 earn） |
| 游戏流程系统 | 上级 | 流程系统启动战斗，接收战斗结果 |
| UI系统 | 被写入 | 每步都向 UI 推送状态更新 |

## Formulas

战斗系统本身不执行计算。它调用的公式分布在各子系统：

| 步骤 | 公式 | 所在系统 |
|------|------|---------|
| 7 | categoryBase = sum(dice) + bonus 或 sum(dice) × bonus | 计分系统 |
| 9 | flatBonus = Σ passive.flatBonus | 出千能力系统 |
| 10 | multiplier = Π passive.multiplier | 出千能力系统 |
| 11 | finalScore = floor((categoryBase + flatBonus) × multiplier) | 计分系统 |
| 12 | result = finalScore >= targetScore ? VICTORY : DEFEAT | 战斗系统 |

## Edge Cases

| 情况 | 处理方式 |
|------|---------|
| 双投消耗品在步骤4使用 | 跳回步骤2重新投掷，consumablesUsed 不重置（仍计入上限） |
| 双投 + 分身术 | 重新投掷时再次触发分身术（复制新骰子） |
| 透视在投掷前使用 | 在步骤1和步骤2之间插入"透视使用"阶段 |
| 消耗品槽位为空 | 步骤4直接跳过，进入步骤5 |
| 敌人无特殊规则 | 步骤3和步骤8跳过 |
| 封印被动 + 玩家无被动 | 规则无效果，正常流程 |
| 全面压制 + 铅骰 | 步骤3先减1，步骤5再托底为2，顺序严格 |
| Boss 两条规则冲突 | 不存在互斥规则，所有组合合法，按类型分别执行 |
| 分数恰好等于目标分数 | 判定为胜利（≥ 即胜利） |
| 分数为 0 | 判定为失败（目标分数最低12） |
| 狸猫换子 + 双投 | 双投重掷全部骰子，狸猫换子的效果被覆盖 |

## Dependencies

### 上游依赖

| 系统 | 依赖性质 | 说明 |
|------|---------|------|
| 骰子系统 | 硬依赖 | 步骤2/3/4/5调用 |
| 计分系统 | 硬依赖 | 步骤6/7/8/9/10/11调用 |
| 敌人系统 | 硬依赖 | 步骤1/3/6/8读取 |
| 出千能力系统 | 硬依赖 | 步骤4/5/9/10调用 |
| 经济系统 | 硬依赖 | 步骤12胜利后调用 earn() |
| 数据配置系统 | 间接依赖 | 通过各子系统间接读取 |

### 下游依赖（被依赖）

| 系统 | 依赖性质 | 读取内容 |
|------|---------|---------|
| 游戏流程系统 | 硬依赖 | 战斗结果（胜利/失败）、获得的代币 |
| UI系统 | 硬依赖 | 战斗每个步骤的状态更新 |

## Tuning Knobs

战斗系统本身无调优参数。战斗难度由以下参数间接控制：

| 参数 | 控制系统 | 说明 |
|------|---------|------|
| 敌人目标分数 | 敌人系统 | 直接决定难度 |
| 敌人特殊规则 | 敌人系统 | 增加复杂性 |
| 每轮消耗品上限 | 出千能力系统 | 控制操控空间 |
| 被动加成数值 | 出千能力系统 | 控制分数上限 |

## Acceptance Criteria

| 编号 | 验收条件 | 验证方式 |
|------|---------|---------|
| AC-1 | 12步结算流程完整执行 | 集成测试：模拟完整战斗，验证每步调用正确 |
| AC-2 | 步骤顺序严格不变 | 单元测试：验证调用顺序与文档一致 |
| AC-3 | 敌人规则在正确步骤生效 | 集成测试：狸猫换子在步骤3，最低点归零在步骤8 |
| AC-4 | 铅骰在全面压制之后生效 | 集成测试：全1骰子+全面压制+铅骰 → 先-1再托底为2 |
| AC-5 | 消耗品最多使用2个 | 单元测试：第3次使用被拒绝 |
| AC-6 | 双投跳回步骤2 | 集成测试：验证双投后重新投掷 |
| AC-7 | 分数≥目标判定胜利 | 单元测试：分数=目标时判定VICTORY |
| AC-8 | 分数<目标判定失败 | 单元测试：分数=目标-1时判定DEFEAT |
| AC-9 | 胜利后正确获得代币 | 集成测试：验证 earn() 被正确调用 |
| AC-10 | Boss随机规则正确应用 | 集成测试：Boss战斗中两条规则分别生效 |
| AC-11 | 无消耗品时跳过步骤4 | 集成测试：空槽位，步骤4被跳过 |
| AC-12 | 封印被动正确影响步骤4-11 | 集成测试：封印后被动加成为0 |

## Open Questions

暂无。12步结算顺序已与游戏概念文档完全对齐。
