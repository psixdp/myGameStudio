# 数据配置系统

> **Status**: In Design
> **Author**: user + agents
> **Last Updated**: 2026-04-03
> **Implements Pillar**: 支柱4 — 一目了然（数据结构决定 UI 可展示的信息）

## Overview

数据配置系统定义千王骰局所有游戏实体的数据结构和初始数值。以 JSON 数据驱动方式组织，
供骰子、计分、敌人、出千能力、商店等系统在运行时读取。策划调整数值无需修改代码。

当前涵盖的实体类型：骰子参数、计分类别、出千能力（消耗品/被动/骰子扩展）、敌人、经济参数。
系统预留扩展机制，后续新增实体类型（如新能力、新敌人、新规则）可通过追加配置条目接入，
无需改动数据加载框架。

## Player Fantasy

数据配置系统是玩家不可见的底层基础设施，但它支撑了"每局都有新东西发现"的间接体验。
丰富的出千能力池、多样的敌人规则、可调的计分参数共同构成高策略空间——而这需要一个
结构清晰、易于扩展的数据基础。

玩家感受到的不是配置文件，而是"这个游戏内容好多，每种组合感觉都不一样"。

## Detailed Design

### Core Rules

#### 数据组织方式

所有配置数据以 JSON 文件存储在 `assets/data/` 目录下，按实体类型分文件：

```
assets/data/
├── global-config.json       # 全局参数
├── scoring-categories.json  # 计分类别
├── abilities.json           # 出千能力（消耗品/被动/骰子扩展）
├── enemies.json             # 敌人定义
├── enemy-rules.json         # 敌人特殊规则（独立定义，敌人通过ID引用）
└── economy.json             # 经济参数
```

运行时启动阶段一次性加载全部 JSON 到内存，以 JavaScript 对象形式供各系统读取。
后续新增实体类型只需新增 JSON 文件并在加载列表中注册。

#### 数据实体定义

**1. 全局参数（global-config.json）**

```json
{
  "dice": {
    "initialCount": 3,
    "maxCount": 7,
    "sides": 6,
    "minValue": 1,
    "maxValue": 6
  },
  "battle": {
    "consumablesPerRound": 2,
    "rollsPerRound": 1
  },
  "startingItems": {
    "freeConsumable": "换面"
  },
  "rounds": {
    "total": 8
  }
}
```

**2. 计分类别（scoring-categories.json）**

```json
[
  {
    "id": "pair",
    "name": "对子",
    "priority": 6,
    "minDice": 2,
    "matchType": "same_value",
    "matchCount": 2,
    "bonusType": "flat",
    "bonusValue": 0
  },
  {
    "id": "three_of_a_kind",
    "name": "三条",
    "priority": 5,
    "minDice": 3,
    "matchType": "same_value",
    "matchCount": 3,
    "bonusType": "flat",
    "bonusValue": 5
  },
  {
    "id": "small_straight",
    "name": "小顺",
    "priority": 4,
    "minDice": 4,
    "matchType": "consecutive",
    "consecutiveCount": 4,
    "bonusType": "flat",
    "bonusValue": 10
  },
  {
    "id": "full_house",
    "name": "满堂红",
    "priority": 3,
    "minDice": 5,
    "matchType": "full_house",
    "bonusType": "flat",
    "bonusValue": 15
  },
  {
    "id": "large_straight",
    "name": "大顺",
    "priority": 2,
    "minDice": 5,
    "matchType": "consecutive",
    "consecutiveCount": 5,
    "bonusType": "flat",
    "bonusValue": 20
  },
  {
    "id": "yahtzee",
    "name": "豹子",
    "priority": 1,
    "minDice": 3,
    "matchType": "all_same",
    "bonusType": "multiplier",
    "bonusValue": 3
  },
  {
    "id": "bust",
    "name": "散牌",
    "priority": 7,
    "minDice": 0,
    "matchType": "fallback",
    "bonusType": "flat",
    "bonusValue": 0
  }
]
```

字段说明：
- `priority`: 数值越小优先级越高（豹子=1最高，散牌=7兜底）
- `matchType`: 匹配算法类型（`same_value`/`consecutive`/`full_house`/`all_same`/`fallback`）
- `bonusType`: `flat`=固定加值，`multiplier`=倍率
- 后续新增分类只需追加条目

**3. 出千能力（abilities.json）**

```json
[
  {
    "id": "face_change",
    "name": "换面",
    "type": "consumable",
    "cost": 2,
    "effectType": "set_dice_value",
    "params": { "min": 1, "max": 6 },
    "description": "将一个骰子变为任意指定点数(1-6)",
    "tags": ["universal"]
  },
  {
    "id": "loaded_shot",
    "name": "加料",
    "type": "consumable",
    "cost": 2,
    "effectType": "reroll_min",
    "params": { "minValue": 4 },
    "description": "重掷一个骰子，保证结果≥4",
    "tags": ["targeted"]
  },
  {
    "id": "insight",
    "name": "透视",
    "type": "consumable",
    "cost": 1,
    "effectType": "reveal_weakness",
    "params": { "bonusFlat": 10 },
    "description": "查看本场弱点分类（该分类+10分）",
    "tags": ["information"]
  },
  {
    "id": "double_roll",
    "name": "双投",
    "type": "consumable",
    "cost": 3,
    "effectType": "extra_roll",
    "params": {},
    "description": "额外获得一次完整投掷机会",
    "tags": ["reroll"]
  },
  {
    "id": "swap_lowest",
    "name": "偷梁换柱",
    "type": "consumable",
    "cost": 3,
    "effectType": "replace_lowest",
    "params": { "value": 6 },
    "description": "将最低点数的骰子替换为6",
    "tags": ["targeted"]
  },
  {
    "id": "loaded_dice",
    "name": "铅骰",
    "type": "passive",
    "cost": 4,
    "effectType": "dice_floor",
    "params": { "minValue": 2 },
    "description": "所有骰子最低点数为2",
    "tags": ["dice_modify"]
  },
  {
    "id": "clone_dice",
    "name": "分身术",
    "type": "passive",
    "cost": 5,
    "effectType": "clone_dice",
    "params": { "count": 1 },
    "description": "每次投掷时临时复制1个随机骰子（仅当次有效）",
    "tags": ["dice_modify"]
  },
  {
    "id": "chain_link",
    "name": "连横术",
    "type": "passive",
    "cost": 4,
    "effectType": "excess_bonus",
    "params": { "perExcess": 3 },
    "description": "超出分类最低要求的每颗匹配骰子+3固定加成",
    "tags": ["scoring"]
  },
  {
    "id": "straight_eye",
    "name": "顺子眼",
    "type": "passive",
    "cost": 4,
    "effectType": "loose_consecutive",
    "params": { "maxGap": 1 },
    "description": "顺子允许间隔1（如1-3-4-5算小顺）",
    "tags": ["category_modify"]
  },
  {
    "id": "greed",
    "name": "贪欲",
    "type": "passive",
    "cost": 3,
    "effectType": "score_multiplier",
    "params": { "multiplier": 1.2 },
    "description": "最终分数+20%（×1.2）",
    "tags": ["multiplier"]
  },
  {
    "id": "pattern_master",
    "name": "牌型大师",
    "type": "passive",
    "cost": 4,
    "effectType": "category_bonus",
    "params": { "categories": ["full_house", "yahtzee"], "bonus": 10 },
    "description": "满堂红和豹子分类+10固定加成",
    "tags": ["scoring"]
  },
  {
    "id": "spare_dice",
    "name": "备用骰",
    "type": "dice_expansion",
    "cost": 4,
    "effectType": "add_dice",
    "params": { "count": 1, "initialValue": "random" },
    "description": "骰子池永久+1",
    "tags": ["expansion"]
  },
  {
    "id": "king_dice",
    "name": "千王骰",
    "type": "dice_expansion",
    "cost": 6,
    "effectType": "add_dice",
    "params": { "count": 1, "initialValue": 6 },
    "description": "骰子池永久+1，新骰子初始固定为6（仅首次）",
    "tags": ["expansion"]
  }
]
```

字段说明：
- `type`: `consumable`/`passive`/`dice_expansion`
- `effectType`: 效果标识，由出千能力系统解析执行
- `params`: 效果参数，不同 effectType 结构不同（灵活扩展）
- `tags`: 标签，用于商店筛选、规则联动等（预留）
- 后续新增能力只需追加条目

**4. 敌人特殊规则（enemy-rules.json）**

```json
[
  {
    "id": "block_pair",
    "name": "封锁对子",
    "description": "对子分类无法匹配",
    "targetCategory": "pair",
    "effectType": "block_category"
  },
  {
    "id": "zero_lowest",
    "name": "最低点归零",
    "description": "最低点骰子计分时视为0",
    "effectType": "zero_lowest_dice",
    "params": { "count": 1 }
  },
  {
    "id": "swap_dice",
    "name": "狸猫换子",
    "description": "敌人重掷你1颗骰子",
    "effectType": "reroll_random",
    "params": { "count": 1, "phase": "post_roll" }
  },
  {
    "id": "seal_passive",
    "name": "封印被动",
    "description": "最贵的被动本轮不生效",
    "effectType": "seal_most_expensive_passive"
  },
  {
    "id": "suppress_all",
    "name": "全面压制",
    "description": "所有骰子点数-1（最低为1）",
    "effectType": "dice_decrease",
    "params": { "amount": 1, "minValue": 1 }
  }
]
```

规则独立定义，敌人通过 ID 引用，Boss 的"千王审判"通过从该池中随机抽取实现。

**5. 敌人（enemies.json）**

```json
[
  {
    "id": "thug",
    "round": 1,
    "name": "街头混混",
    "targetScore": 12,
    "rules": []
  },
  {
    "id": "hustler",
    "round": 2,
    "name": "地痞赌徒",
    "targetScore": 20,
    "rules": []
  },
  {
    "id": "dealer",
    "round": 3,
    "name": "地下庄家",
    "targetScore": 40,
    "rules": ["block_pair"]
  },
  {
    "id": "croupier",
    "round": 4,
    "name": "赌场荷官",
    "targetScore": 65,
    "rules": ["zero_lowest"]
  },
  {
    "id": "swindler",
    "round": 5,
    "name": "老千同行",
    "targetScore": 95,
    "rules": ["swap_dice"]
  },
  {
    "id": "manager",
    "round": 6,
    "name": "赌场经理",
    "targetScore": 130,
    "rules": ["seal_passive"]
  },
  {
    "id": "underground_king",
    "round": 7,
    "name": "地下赌王",
    "targetScore": 175,
    "rules": ["suppress_all"]
  },
  {
    "id": "king_of_cheats",
    "round": 8,
    "name": "千王之王",
    "targetScore": 250,
    "rules": [],
    "bossRule": { "pool": "all", "count": 2 }
  }
]
```

- `rules`: 固定规则ID列表（普通敌人）
- `bossRule`: Boss 专用，从规则池随机抽取指定数量

**6. 经济参数（economy.json）**

```json
{
  "tokenRewards": [4, 4, 5, 5, 6, 6, 7, 8],
  "shop": {
    "itemsPerRefresh": 3,
    "refreshCost": 1
  },
  "diceExpansion": {
    "bonusRounds": [1, 2, 3],
    "bonusWeight": 2.0
  }
}
```

- `tokenRewards`: 索引对应轮次（0=第1轮）
- `diceExpansion.bonusRounds`: 骰子扩展在这些轮次出现概率提高
- `diceExpansion.bonusWeight`: 概率权重倍数

### States and Transitions

数据配置系统无运行时状态。它在游戏启动时加载，加载完成后进入"就绪"状态，
后续仅提供只读查询接口。不存在状态转换。

```
[未加载] --启动加载--> [就绪（只读）]
```

验证规则：
- 加载时校验 JSON 格式正确性
- 校验必填字段存在（id、name 等关键标识）
- 校验引用完整性（敌人引用的规则ID必须存在于 enemy-rules.json）
- 校验失败时阻止启动并报告具体错误

### Interactions with Other Systems

数据配置系统是纯数据提供方，不调用任何其他游戏系统。

| 消费系统 | 读取的数据 | 接口方式 |
|---------|-----------|---------|
| 骰子系统 | global-config.dice | 按路径查询 |
| 计分系统 | scoring-categories | 按优先级排序返回完整列表 |
| 敌人系统 | enemies, enemy-rules | 按轮次查询敌人，按ID查询规则 |
| 经济系统 | economy | 按轮次查询代币奖励 |
| 出千能力系统 | abilities | 按 type 筛选，按 id 查询 |
| 商店系统 | abilities, economy.shop | 按 type 筛选能力，读取商店参数 |
| 战斗系统 | global-config.battle | 读取消耗品上限、投掷次数 |
| 游戏流程系统 | global-config.rounds | 读取总轮次数 |
| UI系统 | 所有数据 | 读取显示所需的名称、描述等 |

接口原则：
- 所有系统通过统一的 `DataConfig.get(path)` 方法查询数据
- 数据加载完成后不可变（只读），避免运行时副作用
- 新增数据类型只需扩展 JSON 文件和对应的查询路径

## Formulas

数据配置系统本身不执行计算，但定义了供其他系统使用的公式参数。

### 计分类别奖励公式

定义在 `scoring-categories.json` 的 `bonusType` 和 `bonusValue` 中：

- **flat（固定加值）**：`分类总分 = 基础分 + bonusValue`
- **multiplier（倍率）**：`分类总分 = 基础分 × bonusValue`

计分系统从配置读取这两个字段，按类型选择计算方式。

### 完整计分公式（供计分系统引用）

```
最终分数 = (全部骰子点数之和 + 分类奖励分 + 加法加成总和) × 乘法倍率总和
```

各加成来源由出千能力系统提供，数据配置仅定义分类奖励分和倍率。

### 经济参数

经济参数为固定值表（`economy.json`），无公式计算。代币奖励、商店参数等直接读取使用。

## Edge Cases

| 情况 | 处理方式 |
|------|---------|
| JSON 格式错误 | 阻止启动，报告错误文件名和具体位置 |
| 引用缺失（敌人引用不存在的规则ID） | 加载校验报错，阻止启动 |
| 重复ID（两个实体使用相同 id） | 后者覆盖前者，加载时输出警告 |
| 配置为空或关键字段缺失 | 全局参数缺失用默认值；实体列表为空则对应系统无内容可用 |
| 新增未知字段（扩展时） | 加载时忽略未定义字段，不报错 |
| 所有计分类别被敌人规则封锁 | 散牌（fallback 类型）不可被封锁，始终作为兜底分类 |
| abilities.json 中出现新的 type 值 | 加载时不做限制，由出千能力系统运行时决定是否识别 |

## Dependencies

### 上游依赖

无。数据配置系统是所有系统的基础，不依赖任何其他游戏系统。

### 下游依赖（被依赖）

| 下游系统 | 依赖性质 | 数据接口 |
|---------|---------|---------|
| 骰子系统 | 硬依赖 | global-config.dice（骰子数、面数） |
| 计分系统 | 硬依赖 | scoring-categories（分类规则、奖励参数） |
| 敌人系统 | 硬依赖 | enemies + enemy-rules（敌人定义与规则） |
| 经济系统 | 硬依赖 | economy（代币奖励表、商店参数） |
| 出千能力系统 | 硬依赖 | abilities（能力定义与效果参数） |
| 商店系统 | 硬依赖 | abilities + economy.shop |
| 战斗系统 | 硬依赖 | global-config.battle（消耗品上限、投掷次数） |
| 游戏流程系统 | 硬依赖 | global-config.rounds（总轮次） |
| UI系统 | 软依赖 | 所有数据中的展示字段（名称、描述等） |

所有依赖为单向：其他系统从数据配置读取，数据配置不调用任何游戏系统。

## Tuning Knobs

以下参数均可通过修改 JSON 配置文件调整，无需修改代码。

| 参数 | 当前值 | 建议范围 | 影响面 | 所在文件 |
|------|--------|---------|-------|---------|
| 初始骰子数 | 3 | 2-4 | 前期可用分类数、前期难度 | global-config.json |
| 最大骰子数 | 7 | 5-8 | 后期计分上限、分类复杂度 | global-config.json |
| 每轮消耗品上限 | 2 | 1-3 | 出千操控空间、消耗速度 | global-config.json |
| 每轮投掷次数 | 1 | 1-2 | 基础随机性 vs 操控感 | global-config.json |
| 各分类奖励分/倍率 | 见配置 | ±50% | 计分天花板、分类价值梯度 | scoring-categories.json |
| 敌人目标分数 | 12→250 | ±30% | 整体难度曲线 | enemies.json |
| 代币奖励（每轮） | 4→8 | ±2 | 经济宽裕度、商店购买力 | economy.json |
| 商店道具数 | 3 | 2-4 | 购买决策复杂度 | economy.json |
| 刷新费用 | 1 | 1-2 | 经济策略深度 | economy.json |
| 骰子扩展加权轮次 | [1,2,3] | 任意轮次 | 骰子扩展出现时机 | economy.json |

新增能力、敌人、规则时，直接在对应 JSON 文件追加条目即可扩展。

## Acceptance Criteria

| 编号 | 验收条件 | 验证方式 |
|------|---------|---------|
| AC-1 | 所有 JSON 文件格式正确，可被标准解析器解析 | 自动化测试：解析每个文件无报错 |
| AC-2 | 引用完整性校验通过（敌人引用的规则ID均存在） | 自动化测试：校验函数返回无错误 |
| AC-3 | 重复ID触发警告但不崩溃 | 单元测试：插入重复ID，验证覆盖行为和警告输出 |
| AC-4 | 其他系统可通过统一接口查询到正确数据 | 单元测试：查询已知数据，验证返回值 |
| AC-5 | 新增未知字段时加载正常 | 单元测试：添加未定义字段，验证加载成功 |
| AC-6 | 配置为空时优雅降级 | 单元测试：abilities 为空数组，验证不崩溃 |
| AC-7 | 散牌始终存在且不可被封锁 | 检查 scoring-categories 中 id=bust 存在且 matchType=fallback |

## Open Questions

暂无。后续系统设计时如发现需要扩展数据结构，回头补充。
