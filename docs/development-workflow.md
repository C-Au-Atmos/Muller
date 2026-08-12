# Muller 研发规范

本文定义 Muller 的版本分支职责、需求文档体系、评审流程和代码晋级规则。
所有新需求、Issue、Bug 和技术改动都必须能够从原始输入追踪到评审结论、
执行任务和最终提交。

## 1. 版本分支

每个版本使用同一个语义版本号 `X.Y.Z`，并按以下方向推进：

```text
req/X.Y.Z -> feat/X.Y.Z -> release/X.Y.Z -> master
```

| 分支 | 作用 | 允许的主要改动 | 禁止事项 |
|---|---|---|---|
| `req/X.Y.Z` | 需求输入与评审基线 | `docs/VX.Y.Z/` 下的原始输入、评审和执行指导 | 产品代码实现、发布操作 |
| `feat/X.Y.Z` | 研发实现分支 | 产品代码、重构、自动化测试、实现同步 | 绕过评审开发、直接合入 `master` |
| `release/X.Y.Z` | 发布候选与稳定分支 | 集成验证、版本号、更新日志、发布阻断修复 | 无关的新功能开发 |
| `master` | 稳定里程碑 | 已验证的 `release/X.Y.Z` 阶段成果 | 日常开发、直接接收 `req/*` 或 `feat/*` |

所有共享分支使用非强制推送。即使几个分支暂时指向同一提交，也不得跳过中间
阶段。`master` 可以阶段性接收同一个 release 分支的稳定里程碑，但每次晋级都
必须满足对应质量门禁。

## 2. 版本文档

每个小版本必须建立 `docs/VX.Y.Z/`，并且只包含以下三份活动文档：

| 文件 | 内容所有权 | 进入下一文档的条件 |
|---|---|---|
| `01-original-input.md` | 用户需求、Issue、Bug、反馈的原始事实与上下文 | 条目有稳定 ID，来源和复现信息足够评审 |
| `02-review.md` | 逐条评审结论、优先级、技术栈、影响范围、风险和版本安排 | 结论明确为接受、延期、拒绝或待补充 |
| `03-execution.md` | 已接受条目的技术设计、任务拆解、测试、回滚和交付步骤 | 实现范围和验收证据可执行、可追踪 |

模板位于 `docs/templates/`。新建版本时复制模板，替换版本号，并将文档状态设为
`Draft`。三个文档使用同一个条目 ID：

- 用户需求：`REQ-X.Y.Z-NNN`
- Issue：`ISSUE-X.Y.Z-NNN`
- Bug：`BUG-X.Y.Z-NNN`

原始输入不得为了适配实现而改写。需要澄清时，在原文后增加带日期和来源的
补充记录。评审结论发生变化时保留原结论，并追加新的评审记录。

## 3. 工作流

### 3.1 收集与评审

1. 在 `req/X.Y.Z` 的 `01-original-input.md` 登记原始内容并分配条目 ID。
2. 补齐来源、环境、复现步骤、期望结果、附件和关联链接；未知项明确标记。
3. 在 `02-review.md` 逐项评审，确定优先级、技术栈、改动模块、依赖、风险、
   验收方式，以及是否进入当前版本。
4. 只有结论为“接受”的条目才能写入 `03-execution.md`。
5. 执行文档完成评审后，将 `req/X.Y.Z` 合入 `feat/X.Y.Z`。

### 3.2 开发与验证

1. 所有产品实现都在 `feat/X.Y.Z` 进行，并以执行文档中的任务和条目 ID 为准。
2. 提交或 PR 必须引用对应条目 ID；实现范围变化时，先回到 `req/X.Y.Z`
   更新评审和执行文档，再同步到 feature 分支。
3. 每个行为变更都应有与风险相称的单元、集成或 E2E 覆盖。
4. 当前版本计划项完成且相关检查通过后，将 `feat/X.Y.Z` 合入
   `release/X.Y.Z`。

### 3.3 发布与回流

1. `release/X.Y.Z` 只处理集成、回归、版本元数据和发布阻断问题。
2. release 上的代码修复必须回合到 `feat/X.Y.Z`，避免下一次晋级丢失修复。
3. 发布候选的更新日志、版本号和执行文档必须描述同一范围。
4. 阶段成果通过门禁后，才从 `release/X.Y.Z` 合入 `master`。

## 4. 优先级与评审结论

| 优先级 | 定义 | 默认处理 |
|---|---|---|
| `P0` | 数据丢失、安全问题、完全不可用或发布阻断 | 立即处理，阻断发布 |
| `P1` | 核心流程严重受损且无合理规避方案 | 当前版本优先处理 |
| `P2` | 重要改进或有规避方案的问题 | 结合容量排入当前或下一版本 |
| `P3` | 低影响优化、体验建议或长期事项 | 默认进入候选池 |

评审结论只使用：`Accepted`、`Deferred`、`Rejected`、`Needs information`。
延期必须填写目标版本或重新评审条件；拒绝必须保留理由。

## 5. 质量门禁

文档变更至少执行链接、结构和 Git 空白检查。产品里程碑晋级 release 前执行：

```powershell
npm run lint
npm test
npm run build
cargo fmt --all -- --check
cargo test --workspace --locked
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
npm run test:e2e
```

进入 `master` 前还必须确认：工作区干净、远端引用最新、需求与实现可追踪、
release 只包含目标范围、版本元数据和更新日志一致，并且待处理的人工验证已记录。

## 6. 标准晋级命令

```powershell
git fetch origin --prune
git switch feat/X.Y.Z
git merge --no-ff req/X.Y.Z
git push origin feat/X.Y.Z

git switch release/X.Y.Z
git merge --no-ff feat/X.Y.Z
git push origin release/X.Y.Z

git switch master
git pull --ff-only
git merge --no-ff release/X.Y.Z
git push origin master
```

新版本的三个分支都从同一个已验证的 `master` 提交建立。远端分支已存在时使用
`git switch --track origin/<branch>`，不要重新创建或覆盖。
