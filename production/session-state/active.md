# 会话状态

> **最后更新**: 2026-05-19
> **当前分支**: main

<!-- STATUS -->
Epic: 策略深度迭代
Feature: 留骰/重掷机制
Task: Sprint 10 已完成，已提交推送
<!-- /STATUS -->

---

## 当前进度

Sprint 10（留骰/重掷机制）**已完成并推送**。策略深度路线图已根据 Codex/Gemini 审阅反馈修订。

### 已完成

- [x] 骰子系统：新增 `hold()` / `rerollUnheld()` / `clearHolds()` / `getHeldIndices()` 接口
- [x] 战斗系统：新增 `executeFirstRoll()` + `executeHoldAndReroll()` 两阶段流程（保持旧 `executeRollPhase()` 兼容）
- [x] 游戏流程：新增 `HOLD_DECISION` 状态 + `confirmHold(heldIndices)` 方法
- [x] UI：骰子增加留/掷交互状态，确认留骰按钮
- [x] 分身术双触发：两次投掷各触发一次，临时骰子不可保留
- [x] 双投消耗品与新流程对齐（清空保留 + 临时骰子后重新投掷）
- [x] 384 项测试全部通过（原有 368 + 新增 16）
- [x] 策略深度路线图编写 + Codex/Gemini 审阅反馈修订

---

## 关键决策

1. **向后兼容**：旧 `executeRollPhase()` 保持不变（12 步旧流程），新两阶段方法作为独立入口
2. **路线图修订**：采纳 Codex/Gemini 反馈——保留旧连横术、新增藏拙被动、软性羁绊替代硬前置
3. **分身术平衡风险**：双触发显著增强，需 Monte Carlo 验证目标分数曲线

---

## 下一步

- [ ] **Sprint 11**（待排期）：手动选分类 + 差异化奖励
- [ ] **Monte Carlo 验证**：两阶段投掷对通关率的影响
- [ ] **浏览器实测**：验证留骰 UI 交互体验
