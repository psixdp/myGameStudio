# Sprint 10 — 留骰/重掷机制

> **日期**: 2026-05-19 启动
> **状态**: 进行中
> **设计参考**: `design/gdd/strategy-roadmap.md` 迭代 1

## Sprint Goal

每场战斗从 1 次投掷改为 2 次投掷 + 中间留骰决策，大幅增加策略深度。

## Capacity

- 开发节奏: Claude Code 协作开发，按系统逐个推进
- 核心改动: 4 个文件（dice.js, combat.js, game-flow.js, ui.js）
- Buffer: 测试修复和边界情况处理

## Tasks

### Must Have（Critical Path）

| ID | 任务 | 源文件 | 依赖 | 验收标准 |
|----|------|--------|------|---------|
| S10-01 | 骰子系统：新增 hold/rerollUnheld 接口 | `src/dice.js` | 无 | AC: hold(indices) 标记骰子为保留；rerollUnheld() 只重掷未保留骰子；clearHolds() 重置状态；getHeldIndices() 返回正确索引；临时骰子(isTemp)不可被 hold |
| S10-02 | 战斗系统：两阶段投掷流程 | `src/combat.js` | S10-01 | AC: executeRollPhase() 只执行第一次投掷+敌人规则；新增 executeHoldAndReroll(heldIndices) 执行留骰+二次投掷+分身术二次触发；stepLog 记录完整步骤 |
| S10-03 | 游戏流程：HOLD_DECISION 状态 | `src/game-flow.js` | S10-02 | AC: 新增 HOLD_DECISION GameState；executeRollPhase() 转入 HOLD_DECISION 而非 BOWL_COVERED；新增 confirmHold(heldIndices) 从 HOLD_DECISION 转入 BOWL_COVERED |
| S10-04 | UI：留骰交互界面 | `src/ui.js` + HTML | S10-03 | AC: HOLD_DECISION 状态显示留骰界面；每颗骰子可点击切换留/掷；"确认留骰"按钮触发二次投掷；临时骰子显示为不可保留；留骰确认后显示碗盖阶段 |
| S10-05 | 测试：骰子系统留骰测试 | `tests/dice.test.js` | S10-01 | AC: hold/rerollUnheld/clearHolds/getHeldIndices 单元测试全部通过；临时骰子不可 hold；全留/全掷边界情况 |
| S10-06 | 测试：战斗两阶段测试 | `tests/combat.test.js` | S10-02 | AC: executeRollPhase → executeHoldAndReroll 完整流程测试；分身术两次触发验证；双投消耗品与新流程交互验证 |

### Should Have

| ID | 任务 | 源文件 | 依赖 | 验收标准 |
|----|------|--------|------|---------|
| S10-07 | 留骰 UI 样式优化 | `index.html` CSS | S10-04 | AC: 保留的骰子有明显视觉区分（高亮边框/颜色）；未保留的骰子有灰色提示；流畅的切换动画 |
| S10-08 | 双投消耗品与新流程对齐 | `src/combat.js` | S10-02 | AC: 双投消耗品在留骰后使用时，清空保留状态并重新投掷全部；stepLog 正确记录 |

### Nice to Have

| ID | 任务 | 源文件 | 依赖 | 验收标准 |
|----|------|--------|------|---------|
| S10-09 | 留骰提示文案 | `src/ui.js` | S10-04 | AC: 第一次投掷后显示"选择要保留的骰子"提示；骰子 hover 显示"点击保留/释放" |
| S10-10 | 设计文档更新 | `design/gdd/*.md` | S10-06 | AC: combat.md 更新为 16 步流程；dice.md 更新新增接口；game-concept.md 更新核心循环描述 |

## Carryover from Previous Sprint

无。上个 Sprint（9）已完成并合入 main。

## Risks

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 现有测试因流程变更大量失败 | 高 | 高 | S10-02 保持 execute() 向后兼容，新增 executeRollPhase 逐步替换 |
| 分身术二次触发交互复杂 | 中 | 中 | 临时骰子用 isTemp 标记，hold 时自动排除；先写测试再实现 |
| 双投消耗品与新流程冲突 | 中 | 中 | 双投在留骰后使用时，clearHolds + 重新全部投掷，单独写集成测试 |
| UI 状态机新增 HOLD_DECISION 导致渲染遗漏 | 中 | 低 | HOLD_DECISION 渲染复用 BATTLE 模板，只增加骰子交互层 |

## Dependencies on External Factors

- 无外部依赖，纯内部重构。

## Definition of Done

- [ ] S10-01 ~ S10-06 全部完成
- [ ] 所有现有测试通过（dice, combat, game-flow, smoke 等）
- [ ] 新增留骰相关测试覆盖核心场景
- [ ] 可以在浏览器中完整体验两阶段投掷流程
- [ ] 代码在 `src/` 目录，按系统分文件
- [ ] 双投消耗品在新流程下正常工作
