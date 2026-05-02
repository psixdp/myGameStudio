# 千王骰局 — 项目 Agents 通用指令

本文件是本项目的代理协作入口，适用于 Codex、Claude Code、Gemini 以及其他进入本仓库的 AI 代理。
`CLAUDE.md` 与 `gemini.md` 仅作为兼容入口，必须指向本文件；项目级规则以 `AGENTS.md` 为准。

独立游戏开发，使用多代理协作完成。
每个代理负责特定领域，确保关注点分离和质量标准。

## 当前项目

**千王骰局** — 类 Balatro 的 Roguelike 骰子构筑游戏，核心体验是“出千改写骰子结果”。

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

## 语言与命名要求

- **所有项目文档必须使用中文维护**。
- 设计文档、技术文档、注释、提交信息等均使用中文。
- 代码中的变量名、函数名、类名使用英文。
- 代码注释使用中文，除非引用第三方 API、协议名或英文术语更清晰。

## 必读上下文

- **详细开发计划**: @plan.md
- **项目结构**: @.claude/docs/directory-structure.md
- **引擎版本参考**: @docs/engine-reference/godot/VERSION.md
- **技术偏好**: @.claude/docs/technical-preferences.md
- **协调规则**: @.claude/docs/coordination-rules.md
- **编码标准**: @.claude/docs/coding-standards.md
- **上下文管理**: @.claude/docs/context-management.md

> 当前共享支持文档仍位于 `.claude/docs/`。在迁移到更通用目录前，这些文件视为项目通用资料，而非 Claude 专属规则。

## 协作协议

**用户驱动的协作，而非自主执行。**
每个任务遵循：**提问 → 方案 → 决策 → 草稿 → 审批**。

- 代理必须在 Write/Edit 之前询问“可以写入到 [文件路径] 吗？”
- 代理必须在请求审批前展示草稿或摘要。
- 多文件变更需要对完整变更集的明确审批。
- 未经用户指示不得提交。
- 不得擅自重置、回滚或覆盖用户与其他代理的改动。

完整协议和示例参见 `docs/COLLABORATIVE-DESIGN-PRINCIPLE.md`。

## 多代理协调

- 遵守 @.claude/docs/coordination-rules.md 中的垂直委派、横向咨询、冲突升级和变更传播规则。
- 代理只修改自己任务范围内的文件；跨领域变更必须先说明影响并获得明确授权。
- 设计、程序、UI、音频、QA、发行等工作优先使用项目已有的 `.agents/skills/` 工作流与文档模板。
- 当设计变更影响多个系统时，由生产或协调角色统一更新计划、系统索引和相关文档。

## 会话恢复

进入项目后优先读取 `production/session-state/active.md`，了解当前进度、最近决策和下一步工作。
如果该文件不存在，说明会话状态缺失，并从 `plan.md`、GDD 和系统索引恢复上下文。

首次使用时，如果项目没有配置引擎且没有游戏概念，运行 `/start` 开始引导流程。

## 版本控制

- 使用 Git，默认主干开发。
- 未经用户明确指示不得提交。
- 不得擅自创建发布标签、强推、重写历史或执行破坏性 Git 操作。
- 如果工作区已有未归属改动，必须保留并与其协作，不得覆盖。
