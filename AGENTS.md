# 千王骰局 — Codex Game Studios

独立游戏开发，使用 Codex 子代理协作完成。
每个代理负责特定领域，确保关注点分离和质量标准。

## 当前项目

**千王骰局** — 类 Balatro 的 Roguelike 骰子构筑游戏，核心体验是"出千改写骰子结果"。

- **详细开发计划**: @plan.md
- **游戏概念文档**: @design/gdd/game-concept.md
- **系统索引**: @design/gdd/systems-index.md

## 技术栈

- **平台**: 网页浏览器（HTML/CSS/JS）
- **渲染**: 基于 DOM（CSS 动画渲染骰子）
- **状态管理**: JavaScript 对象/类
- **部署**: 静态托管或本地文件打开
- **规模**: Jam 级别 MVP
- **版本控制**: Git，主干开发

> **注意**: 游戏概念文档中技术实现部分标注为网页方案，但引擎版本参考仍保留 Godot 以备后续扩展。

## 详细开发计划

@plan.md

## 项目结构

@.Codex/docs/directory-structure.md

## 引擎版本参考

@docs/engine-reference/godot/VERSION.md

## 技术偏好

@.Codex/docs/technical-preferences.md

## 协调规则

@.Codex/docs/coordination-rules.md

## 协作协议

**用户驱动的协作，而非自主执行。**
每个任务遵循：**提问 → 方案 → 决策 → 草稿 → 审批**

- 代理必须在 Write/Edit 之前询问"可以写入到 [文件路径] 吗？"
- 代理必须在请求审批前展示草稿或摘要
- 多文件变更需要对完整变更集的明确审批
- 未经用户指示不得提交

完整协议和示例参见 `docs/COLLABORATIVE-DESIGN-PRINCIPLE.md`。

> **会话恢复**: 读取 `production/session-state/active.md` 了解当前进度。
> **首次使用？** 如果项目没有配置引擎且没有游戏概念，运行 `/start` 开始引导流程。

## 编码标准

@.Codex/docs/coding-standards.md

## 上下文管理

@.Codex/docs/context-management.md
