# Muller V0.1.5 执行计划

## 文档信息

| 字段 | 值 |
|---|---|
| 目标版本 | `V0.1.5` |
| 实现分支 | `feat/0.1.5` |
| 候选分支 | `release/0.1.5`（待实现完成后建立） |
| 文档状态 | `Complete` |
| 技术负责人 | `Codex` |
| 最后更新 | `2026-09-12` |

## 执行索引

| 条目 ID | 评审结论 | 实现负责人 | 状态 | 主要交付物 | 验证状态 |
|---|---|---|---|---|---|
| `REQ-0.1.5-001` | `Accepted` | `Codex` | `Done` | V0.1.5 分支基线、旧分支归档标签、历史索引 | `Passed` |
| `REQ-0.1.5-002` | `Accepted` | `Codex` | `Planned` | 单栏空间扫描测试版、Canvas treemap、钻取、选择和音效 | `Pending` |

<a id="req-0-1-5-001"></a>

## `REQ-0.1.5-001` - 建立 V0.1.5 开发分支并归档旧版本分支

### 追踪关系

- 原始输入：[`01-original-input.md#req-0-1-5-001`](01-original-input.md#req-0-1-5-001)
- 评审记录：[`02-review.md#req-0-1-5-001`](02-review.md#req-0-1-5-001)
- 关联 Issue/PR：`None`
- 实现提交：`以 req/0.1.5 和 feat/0.1.5 的 Git 历史记录为准`

### 技术设计

- 目标行为：V0.1.5 从 `master` 建立需求和开发分支；旧版本尖端在删分支前固化为注释标签并建立索引。
- 修改范围：`docs/V0.1.5/`、`docs/README.md`、`docs/archive/branch-history.md` 和 Git refs。
- 接口与数据流：`master` → `req/0.1.5` → `feat/0.1.5`；旧阶段 tip → `archive/<version>/<stage>` 标签 → 删除本地/远端阶段分支。
- 兼容与迁移：不改变应用代码和用户数据；保留 `v0.1.3`、`v0.1.4` 标签及旧版本文档。
- 错误处理：若尖端未被 `master` 包含则停止删除；若远端删除失败则保留分支并记录错误。
- 明确不做：不强制推送；不删除提交对象或历史标签；不提前创建 `release/0.1.5`。

### 实现任务

| 任务 ID | 工作内容 | 位置 | 状态 |
|---|---|---|---|
| `REQ-0.1.5-001-T01` | 建立 V0.1.5 三份活动文档 | `docs/V0.1.5/` | `Done` |
| `REQ-0.1.5-001-T02` | 更新活动版本入口和旧分支追溯索引 | `docs/README.md`, `docs/archive/branch-history.md` | `Done` |
| `REQ-0.1.5-001-T03` | 建立并推送 `req/0.1.5`、`feat/0.1.5` | Git refs | `Done` |
| `REQ-0.1.5-001-T04` | 固化旧阶段 tip 为归档标签并推送 | Git refs | `Done` |
| `REQ-0.1.5-001-T05` | 删除本地和远端旧阶段分支并复核 | Git refs | `Done` |

### 验证计划

- [x] 结构检查：三份 V0.1.5 文档、链接和条目 ID 一致。
- [x] Git 验证：旧阶段尖端是 `master` 祖先；归档标签指向预期 SHA；删除后远端不再列出旧分支。
- [x] 回归范围：版本标签、V0.1.3/V0.1.4 文档和 `master` 历史可查询。

### 发布与回滚

- 配置或迁移步骤：`None`
- 发布观察项：V0.1.5 后续开发从 `feat/0.1.5` 开始；release 分支待实现完成后再建立。
- 回滚触发条件：归档标签错误或发现旧分支未完整合入 `master`。
- 回滚步骤：从归档标签恢复对应分支引用，修正索引后再清理；不改写提交历史。

### 完成证据

| 日期 | 提交/PR | 检查结果 | 记录人 |
|---|---|---|---|
| `2026-09-12` | `master` `78e63c9` | 六个旧阶段尖端均为 master 祖先；`v0.1.3`、`v0.1.4` 发布标签保留。 | `Codex` |
| `2026-09-12` | `archive/0.1.3/*`, `archive/0.1.4/*` | 六个尖端以注释标签固化，并写入历史索引。 | `Codex` |
| `2026-09-12` | `req/0.1.5`, `feat/0.1.5` | 从 master 建立并按 `req → feat` 顺序同步；远端引用已推送。 | `Codex` |

<a id="req-0-1-5-002"></a>

## `REQ-0.1.5-002` - Space Sniffer 风格的高性能空间方块视图

### 追踪关系

- 原始输入：[`01-original-input.md#req-0-1-5-002`](01-original-input.md#req-0-1-5-002)
- 评审记录：[`02-review.md#req-0-1-5-002`](02-review.md#req-0-1-5-002)
- 设计附件：[Platinum 实机截图](design/muller-platinum-live.png)、[空间视图线框](design/space-sniffer-wireframe.svg)
- 关联 Issue/PR：`None`
- 实现提交：`待实现`

### 测试版技术设计

- 入口：在当前单栏浏览工作区增加“空间视图”工具按钮，保留列表、大图标和瀑布流入口。
- 扫描：新增可取消的 Tauri 命令，一次递归读取目录元数据，以批次返回顶层节点和子目录大小；测试版只统计逻辑字节数，跳过符号链接。
- 数据契约：`SpaceScanStart(sessionId, root)`；`SpaceScanBatch(sessionId, parent, sequence, entries[])`；`SpaceScanComplete(sessionId, totalBytes, errorCount, cancelled)`。前端丢弃过期 session 或倒序 sequence。
- 绘制：使用 Canvas 画布和确定性 slice-and-dice treemap；方块面积按已知字节占比，未知/错误节点保留最小可见块；使用 Platinum 灰阶和白色 1px 分隔线。
- 交互：单击选择，双击或 Enter 打开文件夹，面包屑和 Esc 返回；拖拽选框作为测试版的矩形命中选择；右侧信息区显示路径、大小和占比。
- 音效：复用 `useInterfaceAudio` 的 tick/action/navigate/success/warning，不为每个方块创建 AudioContext。
- 后续性能工作：在测试版可用后补充 10k/100k 节点基准、网络盘策略、Canvas/WebGL 切换和双栏比较。

### 实现任务

| 任务 ID | 工作内容 | 位置 | 前置依赖 | 状态 |
|---|---|---|---|---|
| `REQ-0.1.5-002-T01` | 注册空间视图入口和工作区状态 | `src/workspace`, `src/App.tsx` | 评审 Accepted | `Planned` |
| `REQ-0.1.5-002-T02` | 实现 Rust 递归统计、批次事件和取消 | `src-tauri/src/space_scan.rs`, `src-tauri/src/lib.rs` | T01 | `Planned` |
| `REQ-0.1.5-002-T03` | 实现 Canvas treemap 和 Platinum 视觉 | `src/features/space/` | T02 | `Planned` |
| `REQ-0.1.5-002-T04` | 接入钻取、面包屑、选框、键盘和详情 | `src/features/space/` | T03 | `Planned` |
| `REQ-0.1.5-002-T05` | 接入音效事件和扫描状态 | `src/features/space/`, `src/features/feedback/` | T04 | `Planned` |
| `REQ-0.1.5-002-T06` | 添加 Rust、前端和 Edge 测试 | `src-tauri`, `src`, `e2e` | T02-T05 | `Planned` |

### 验证计划

- [ ] Rust：递归大小、空目录、权限失败、符号链接跳过、取消和旧 session 丢弃。
- [ ] 前端：面积比例、绘制、选择、钻取、返回、选框和详情。
- [ ] 音效：选择/打开/完成/失败事件，静音和限流。
- [ ] Edge E2E：从浏览入口进入空间视图，打开子目录后返回。
- [ ] 基准：测试版完成后记录 10k/100k 节点首批、完整扫描、FPS、内存和取消延迟。

### 发布与回滚

- 配置或迁移步骤：`None`；空间视图为新增入口，列表视图继续可用。
- 回滚触发条件：扫描阻塞主线程、目录大小明显错误、钻取破坏现有导航或音效异常。
- 回滚步骤：隐藏空间视图入口并回退对应提交，保留现有浏览能力。
