# 游戏流程系统

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-03
> **Implements Pillar**: 全局（管理整局完整生命周期）

## Overview

游戏流程系统管理一局千王骰局的完整生命周期：从开局初始化到最终胜负。
它是最高层编排器，协调战斗系统和商店系统按轮次交替运行，
管理全局状态（当前轮次、胜负判定），并在游戏结束时触发重新开始。

## Player Fantasy

"一局15-20分钟，节奏紧凑，每轮都有进展。"
从第1轮的低目标热身，到第8轮的终极 Boss，中间穿插商店购买，
每轮都是一个新的决策点。失败即重来，快速重开驱动"再来一局"的循环。

## Detailed Design

### Core Rules

#### 一局完整流程

```
[开始界面] --开始新局--> [初始化]
    |
    v
[初始化]
    ├── RNG.seed(新种子)
    ├── economy.reset()
    ├── cheatingSystem.reset()
    ├── dicePool.init(globalConfig.dice)
    └── currentRound = 1
    |
    v
[轮次循环] ←──────────────────────────────────────┐
    |                                                |
    v                                                |
[战斗阶段]                                            |
    ├── enemy = enemySystem.getByRound(currentRound) |
    ├── combat.start(enemy)                          |
    ├── result = combat.getResult()                  |
    |                                                |
    +-- 胜利? --> [商店阶段]                          |
    |               |                                |
    |               +-- shop.open(currentRound)      |
    |               +-- 玩家购买/刷新/离开            |
    |               +-- shop.close()                 |
    |               |                                |
    |               v                                |
    |           currentRound++                       |
    |           round > 8? ──是──> [胜利结局]        |
    |               |否                               |
    |               +────────────────────────────────┘
    |
    +-- 失败 --> [失败结局]

[胜利结局] --再来一局--> [初始化]
[失败结局] --再来一局--> [初始化]
```

#### 轮次进度

- 总轮次：8（从 global-config.json 读取）
- 每轮结构：战斗 → （胜利则）商店 → 下一轮
- 第8轮胜利后跳过商店，直接进入胜利结局
- 任意轮次战斗失败 → 游戏结束

#### 公开接口

```javascript
// 生命周期
gameFlow.newGame(seed?)              // 开始新局，可选手动种子
gameFlow.surrender()                 // 投降（可选，直接失败）

// 查询
gameFlow.getCurrentRound()           // 当前轮次 (1-8)
gameFlow.getTotalRounds()            // 总轮次 (8)
gameFlow.getState()                  // 当前状态
gameFlow.getSeed()                   // 当局种子
gameFlow.isGameOver()                // 是否已结束
gameFlow.getResult()                 // VICTORY / DEFEAT / null
```

#### 游戏状态枚举

```
enum GameState {
    MENU,           // 开始界面
    INITIALIZING,   // 初始化中
    BATTLE,         // 战斗阶段
    SHOP,           // 商店阶段
    VICTORY,        // 胜利结局
    DEFEAT,         // 失败结局
}
```

### States and Transitions

```
[MENU] ──newGame()──> [INITIALIZING] ──初始化完成──> [BATTLE]
                                                         |
                                          combat.result ──┤
                                                          |
                                        victory: [SHOP] ←─┘ (round < 8)
                                        victory: [VICTORY] ← round 8
                                        defeat:  [DEFEAT]

[SHOP] ──shop.close()──> currentRound++ ──> [BATTLE]

[VICTORY] ──newGame()──> [INITIALIZING]
[DEFEAT]  ──newGame()──> [INITIALIZING]
```

状态转换规则：
- 只有 MENU 状态可以调用 newGame()
- BATTLE → SHOP 只在战斗胜利时发生
- SHOP → BATTLE 在商店关闭后自动发生
- BATTLE → VICTORY/DEFEAT 由战斗结果决定
- VICTORY/DEFEAT 只能通过 newGame() 离开

### Interactions with Other Systems

| 系统 | 交互方向 | 说明 |
|------|---------|------|
| 随机数系统 | 写 | newGame() 时调用 RNG.seed() |
| 经济系统 | 写 | newGame() 时调用 reset()，战斗胜利后 earn()（通过战斗系统） |
| 出千能力系统 | 写 | newGame() 时调用 reset() |
| 骰子系统 | 写 | newGame() 时初始化骰子池 |
| 敌人系统 | 读 | 按轮次获取敌人 |
| 战斗系统 | 编排 | 启动战斗、接收结果 |
| 商店系统 | 编排 | 启动商店、等待关闭 |
| UI系统 | 被读 | 全局状态、轮次、种子、结果 |

## Formulas

游戏流程系统无公式计算。所有数值由子系统处理。

唯一涉及"计算"的是轮次判定：

```
isLastRound = (currentRound == totalRounds)   // 第8轮
showShop = !isLastRound && result == VICTORY  // 非末轮胜利才进商店
```

## Edge Cases

| 情况 | 处理方式 |
|------|---------|
| 战斗中调用 newGame() | 拒绝，只有 MENU/VICTORY/DEFEAT 状态可以 |
| 商店中调用 newGame() | 拒绝，同上 |
| 第8轮战斗胜利 | 跳过商店，直接进入 VICTORY |
| 第8轮战斗失败 | 进入 DEFEAT |
| 手动种子为空字符串 | 使用系统生成的随机种子（如 Date.now()） |
| 连续快速 newGame() | 每次 newGame() 完全重置所有子系统状态 |
| 第1轮就失败 | 直接进入 DEFEAT，可立即重开 |
| 初始化时数据加载失败 | 阻止进入 BATTLE，停留在 MENU 并报错 |

## Dependencies

### 上游依赖

| 系统 | 依赖性质 | 说明 |
|------|---------|------|
| 数据配置系统 | 硬依赖 | global-config.json（总轮次、骰子参数） |
| 随机数系统 | 硬依赖 | 初始化种子 |
| 骰子系统 | 硬依赖 | 初始化骰子池 |
| 经济系统 | 硬依赖 | 初始化余额 |
| 出千能力系统 | 硬依赖 | 初始化能力集合 |
| 敌人系统 | 硬依赖 | 按轮次获取敌人 |
| 战斗系统 | 硬依赖 | 启动战斗、接收结果 |
| 商店系统 | 硬依赖 | 启动商店 |

### 下游依赖（被依赖）

| 系统 | 依赖性质 | 读取内容 |
|------|---------|---------|
| UI系统 | 硬依赖 | 全局状态（轮次、阶段、结果） |

## Tuning Knobs

| 参数 | 当前值 | 建议范围 | 影响面 | 来源 |
|------|--------|---------|-------|------|
| 总轮次 | 8 | 5-12 | 单局时长、难度曲线长度 | global-config.json |
| 初始骰子数 | 3 | 2-4 | 前期难度 | global-config.json |
| 初始免费消耗品 | 1个换面 | 0-2 | 新手友好度 | global-config.json |

## Acceptance Criteria

| 编号 | 验收条件 | 验证方式 |
|------|---------|---------|
| AC-1 | newGame 正确初始化所有子系统 | 集成测试：验证 RNG、经济、骰子、能力均被重置 |
| AC-2 | 8轮战斗后胜利进入 VICTORY | 集成测试：模拟8轮胜利，验证状态 |
| AC-3 | 任意轮次失败进入 DEFEAT | 集成测试：第3轮失败，验证状态 |
| AC-4 | 第8轮胜利跳过商店 | 单元测试：验证 isLastRound → showShop=false |
| AC-5 | 非8轮胜利进入商店 | 单元测试：第3轮胜利 → showShop=true |
| AC-6 | newGame() 在 BATTLE 状态被拒绝 | 单元测试：BATTLE 时调用返回 false |
| AC-7 | 同一种子产生相同游戏流程 | 集成测试：固定种子两局，验证敌人、商店道具一致 |
| AC-8 | 快速重开正常工作 | 集成测试：连续3次 newGame()，每次独立 |
| AC-9 | getCurrentRound 返回正确轮次 | 单元测试：每轮开始时验证返回值 |
| AC-10 | 一局流程从 MENU 到 VICTORY 完整可运行 | 端到端测试：模拟完整8轮通关 |

## Open Questions

暂无。
