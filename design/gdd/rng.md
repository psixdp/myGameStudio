# 随机数系统

> **Status**: Designed
> **Author**: user + agents
> **Last Updated**: 2026-04-03
> **Implements Pillar**: 支柱2 — 一掷定生死（随机性是紧张感的来源）

## Overview

随机数系统为千王骰局提供确定性的伪随机数生成（PRNG）。每局游戏使用一个种子初始化，
确保同一种子的对局可完全回放。服务于骰子投掷、商店道具随机抽取、Boss 规则随机选择、
分身术随机复制等所有需要随机性的场景。

核心设计：使用种子化 PRNG 算法（如 mulberry32），不使用 Math.random()。
每局一个主种子，各子系统通过独立的随机流消费随机数序列，互不干扰。

## Player Fantasy

玩家不直接感知随机数系统，但它支撑了两个关键体验：

1. **一掷定生死**（支柱2）：骰子投掷的随机性创造紧张感，种子化保证了这种随机是可追溯的。
2. **再来一局**：同一种子产生相同序列，理论上可用于分享种子挑战同一局、验证策略。

## Detailed Design

### Core Rules

#### PRNG 算法

使用确定性伪随机数生成器（如 mulberry32 或 xoshiro128**），不使用 Math.random()。

算法要求：
- 速度快、周期长、分布均匀
- 种子可重现：相同种子产生完全相同的序列
- JavaScript 实现简单，适合网页游戏

#### 随机流架构

每局游戏使用一个主种子，从中派生多个独立随机流：

| 随机流名称 | 消费系统 | 用途 |
|-----------|---------|------|
| `dice` | 骰子系统 | 骰子投掷结果 |
| `shop` | 商店系统 | 道具随机抽取、刷新 |
| `enemy` | 敌人系统 | Boss 规则随机选择、狸猫换子重掷 |
| `clone` | 出千能力系统 | 分身术随机复制目标 |

派生规则：
- `subSeed = hash(mainSeed + streamName)`
- 各流独立消费，互不影响
- 商店刷新不会改变骰子投掷结果，保持可回放性

#### 公开接口

```javascript
// 初始化
RNG.seed(seed)                    // 用主种子初始化，派生所有随机流

// 获取随机流
const diceRng = RNG.getStream('dice')

// 随机流方法
diceRng.nextInt(min, max)         // 返回 [min, max] 整数（含两端）
diceRng.nextFloat()               // 返回 [0, 1) 浮点数
diceRng.pick(array)               // 从数组随机选一个元素
diceRng.shuffle(array)            // Fisher-Yates 洗牌，返回新数组
diceRng.weightedPick(items, key)  // 按指定权重字段加权随机选择
```

#### 加载时序

1. 游戏流程系统开局时生成或接收种子，调用 `RNG.seed()`
2. 各子系统首次使用时通过 `RNG.getStream(name)` 获取自己的流
3. 之后各系统只使用自己的流，不交叉调用

### States and Transitions

```
[未初始化] --RNG.seed()--> [就绪] --游戏结束--> [已消耗]
```

- **未初始化**：调用任何随机方法会抛出错误
- **就绪**：所有随机流可用，按调用顺序消费
- **已消耗**：单局结束，随机流状态废弃。新一局需要重新 seed

无运行时状态切换——一旦 seed 完成，系统只提供只读式的随机数序列消费。

### Interactions with Other Systems

| 消费系统 | 使用的随机流 | 调用场景 |
|---------|------------|---------|
| 骰子系统 | `dice` | 每次投掷骰子 |
| 敌人系统 | `enemy` | Boss 千王审判随机选规则、狸猫换子重掷 |
| 出千能力系统 | `clone` | 分身术随机选择复制目标 |
| 商店系统 | `shop` | 道具抽取、刷新、骰子扩展加权 |
| 游戏流程系统 | — | 负责调用 RNG.seed()，不消费随机流 |

接口原则：
- 各系统只使用自己的随机流，不借用其他系统的流
- 随机数系统不关心调用语义（不知道"骰子"或"商店"），只提供数值

## Formulas

### 子种子派生

```
subSeed = hash(mainSeed + streamName)
```

使用与主 PRNG 相同的哈希函数将主种子和流名称混合，确保不同流产生完全不同的序列。

### 整数范围映射

```
value = min + floor(nextRaw() * (max - min + 1) / 2^32)
```

将 PRNG 原始输出（32位整数）映射到 [min, max] 范围，含两端。

### 加权随机选择

```
cumulativeWeights = 累加各项权重
roll = nextFloat() * totalWeight
result = 二分查找(roll 在 cumulativeWeights 中的位置)
```

用于商店道具按权重抽取、骰子扩展在加权轮次提高出现率等场景。

### Fisher-Yates 洗牌

```
for i from length-1 down to 1:
    j = nextInt(0, i)
    swap(array[i], array[j])
```

用于商店道具列表打乱等场景。

## Edge Cases

| 情况 | 处理方式 |
|------|---------|
| 未初始化就调用随机方法 | 抛出错误：`RNG not seeded` |
| 种子为 0 或负数 | 归一化为正整数（取绝对值 + 1） |
| `nextInt(min, max)` 中 min > max | 自动交换两值 |
| `pick([])` 空数组 | 返回 null |
| `weightedPick` 权重全为 0 | 退化为均匀随机 |
| 新增子系统需要新随机流 | 调用 `getStream(newName)` 即可，无需改框架 |
| 单局内随机流被耗尽 | PRNG 周期极长（≥2^32），实际不会耗尽 |

## Dependencies

### 上游依赖

无。随机数系统是基础设施，不依赖其他游戏系统。

### 下游依赖（被依赖）

| 下游系统 | 使用的随机流 | 依赖性质 |
|---------|------------|---------|
| 骰子系统 | `dice` | 硬依赖 |
| 敌人系统 | `enemy` | 硬依赖 |
| 出千能力系统 | `clone` | 硬依赖 |
| 商店系统 | `shop` | 硬依赖 |
| 游戏流程系统 | —（仅调用 seed） | 硬依赖 |

## Tuning Knobs

| 参数 | 当前值 | 建议范围 | 影响面 |
|------|--------|---------|-------|
| PRNG 算法 | mulberry32 | mulberry32 / xoshiro128** | 随机质量、性能 |
| 种子来源 | 系统自动生成 | 自动 / 玩家手动输入 | 可回放性 |
| 随机流列表 | 4个（dice/shop/enemy/clone） | 按需扩展 | 各系统独立性 |

## Acceptance Criteria

| 编号 | 验收条件 | 验证方式 |
|------|---------|---------|
| AC-1 | 相同种子产生完全相同的随机数序列 | 单元测试：固定种子，验证输出序列一致 |
| AC-2 | 不同随机流互不干扰 | 单元测试：dice 流调用 100 次不影响 shop 流的输出 |
| AC-3 | nextInt 范围正确（含两端） | 单元测试：10000 次调用，验证 min 和 max 都能出现 |
| AC-4 | weightedPick 按权重分布 | 单元测试：10000 次调用，验证统计分布与权重比例一致 |
| AC-5 | 未初始化调用报错 | 单元测试：验证抛出明确错误信息 |
| AC-6 | 新增随机流无需修改已有代码 | 单元测试：getStream('new_stream') 正常工作 |

## Open Questions

暂无。
