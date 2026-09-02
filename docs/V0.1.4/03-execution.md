# Muller V0.1.4 执行计划

## 文档信息

| 字段 | 值 |
|---|---|
| 目标版本 | `V0.1.4` |
| 实现分支 | `feat/0.1.4` |
| 候选分支 | `release/0.1.4` |
| 文档状态 | `Complete` |
| 技术负责人 | `Codex` |
| 最后更新 | `2026-09-02` |

## 执行索引

| 条目 ID | 评审结论 | 实现负责人 | 状态 | 主要交付物 | 验证状态 |
|---|---|---|---|---|---|
| `REQ-0.1.4-001` | `Accepted` | Codex | `Complete` | Rust 批量收纳/撤销、浏览交互、本地化、测试 | 自动化通过；Windows 实机通过（2026-09-03） |
| `REQ-0.1.4-002` | `Accepted` | Codex | `Complete` | 应用快捷键映射、导航 E2E、回归测试 | 自动化通过；Windows 实机通过（2026-09-03） |

<a id="req-0-1-4-001"></a>

## `REQ-0.1.4-001` - 自定义关键词收纳文件

### 追踪关系

- 原始输入：[`01-original-input.md#req-0-1-4-001`](01-original-input.md#req-0-1-4-001)
- 评审记录：[`02-review.md#req-0-1-4-001`](02-review.md#req-0-1-4-001)
- 关联 Issue/PR：`None`
- 实现提交：`da0eb6c`

### 技术设计

- 目标行为：新建文件夹时可选按关键词收纳；右键目录可把当前目录树中匹配的文件
  移入该目录；完成后可撤销最近一次成功移动。
- 技术栈：React/TypeScript、Tauri 2、Rust、现有 `muller-mutate` 受保护传输。
- 修改范围：`BrowseWorkspace`、`fileOperationsClient`、`file_operations.rs`、
  `src-tauri/src/lib.rs`、`i18n.ts`、CSS、Rust/客户端/E2E 测试。
- 接口与数据流：前端提交源目录、目标目录、关键词和任务 ID；Rust 先递归收集匹配
  文件，跳过目标子树，再以 keep-both 移动并返回逐项报告。前端记录成功报告的源、
  实际目标路径；Ctrl+Z 将这些路径按 fail 策略移回各自原父目录。
- 兼容与迁移：不改动现有剪贴板、拖拽和目录会话协议；新增命令为可选能力。
- 性能预算：扫描和移动不阻塞 UI；不读取文件内容；取消请求在扫描和逐项移动间检查。
- 错误处理：空关键词拒绝；无匹配显示明确状态；目标冲突保留两者；扫描和单项
  移动失败继续处理其他项并报告；撤销失败项不覆盖外部文件。
- 明确不做：目录移动、目标目录递归收纳、覆盖冲突、跨重启撤销历史、跨磁盘事务。

### 实现任务

| 任务 ID | 工作内容 | 位置 | 负责人 | 前置依赖 | 状态 |
|---|---|---|---|---|---|
| `REQ-0.1.4-001-T01` | 记录需求并同步版本文档 | `docs/V0.1.4/` | Codex | None | `Done` |
| `REQ-0.1.4-001-T02` | 实现递归关键词收集、批量移动和撤销命令 | `src-tauri/src/file_operations.rs` | Codex | T01 | `Done` |
| `REQ-0.1.4-001-T03` | 暴露 TypeScript 客户端并接入任务取消 | `src/features/explorer/fileOperationsClient.ts` | Codex | T02 | `Done` |
| `REQ-0.1.4-001-T04` | 增加新建目录和右键自定义收纳交互 | `src/features/explorer/BrowseWorkspace.tsx` | Codex | T03 | `Done` |
| `REQ-0.1.4-001-T05` | 添加中英文文案、样式和操作状态 | `src/i18n/i18n.ts`, `src/styles/app.css` | Codex | T04 | `Done` |
| `REQ-0.1.4-001-T06` | 覆盖 Rust、客户端和 Edge E2E 验证 | `src-tauri`, `src`, `e2e` | Codex | T02-T05 | `Done` |

### 验证计划

- [x] 单元测试：关键词大小写、递归文件、目标排除、冲突 keep-both、无匹配、撤销和撤销冲突。
- [x] Rust/集成测试：复用受保护移动与任务生命周期；收纳命令支持取消、逐项失败继续和路径校验。
- [x] Edge E2E：新建目录勾选自动收纳、右键目录自定义吸取、操作反馈、Ctrl+Z。
- [ ] 性能检查：临时目录批量文件扫描不阻塞命令线程，取消可生效。
- [x] 人工验证：Windows 桌面版；包含中文文件名、大小写混合、嵌套目录和同名冲突。
- [x] 回归范围：新建文件、重命名、剪贴板移动、拖拽移动、目录刷新和上下文菜单（完整 Edge E2E）。

### 发布与回滚

- 配置或迁移步骤：`None`
- 发布观察项：收纳成功/失败数量、撤销成功/失败数量、目标冲突和取消日志。
- 回滚触发条件：文件被错误覆盖、目标排除失效、撤销覆盖外部文件或现有文件操作回归。
- 回滚步骤：停止使用新增入口，回退对应提交；已移动文件使用应用内 Ctrl+Z 或手工
  按操作反馈路径恢复。

### 完成证据

| 日期 | 提交/PR | 检查结果 | 记录人 |
|---|---|---|---|
| `2026-09-03` | `da0eb6c`、`b9b6c13` | 自动化门禁全部通过；Windows 11 专业工作站版 10.0.26200（64 位）、WebView2 151.0.4129.107/152.0.4191.53，使用 `D:\Muller\test-results\windows-0.1.4-actual-20260902` 隔离夹具。`muller.exe` 调试验收产物 SHA-256 为 `D0A4CCBFF7DB06228E2EFEE13E43BB3F7CB113DC636578589B96D7D13591D1CA`：新建目录自动收纳递归移动 4 个 Alpha 文件并由 `Ctrl+Z` 恢复；右键“自定义吸取”移动 2 个 Beta 文件，冲突保留原文件并由 `Ctrl+Z` 恢复；单栏、双栏和比较工作区的 `Alt+左/右箭头` 均完成往返验证。release 阶段已将版本元数据、更新日志与候选构建同步为 0.1.4。` | `Codex` |
| `2026-09-03` | `96ce7b8` | `npm run lint`、`npm test`（76/76）、`npm run build`、`cargo fmt --all -- --check`、`cargo test --workspace --locked`（125 个测试）、`cargo clippy --workspace --all-targets --all-features --locked -- -D warnings`、完整 Edge E2E（87/87）通过；`npm run tauri -- build --bundles nsis` 成功生成 `Muller_0.1.4_x64-setup.exe` 和 release `muller.exe`。Windows 启动冒烟通过，窗口标题为 `Muller` 且进程响应正常；安装包 SHA-256 为 `8132B4A36159B7B9416FED39438629982F7701A95C53198AAEF41A5ACFA34BF7`，portable SHA-256 为 `27CAB6D8CDEC0F9C4EAAF5558C38B6A1E21EA901F1382A4347A5C5EE1D52A9ED`。` | `Codex` |

<a id="req-0-1-4-002"></a>

## `REQ-0.1.4-002` - 上一级和下一级 Windows 快捷键

### 追踪关系

- 原始输入：[`01-original-input.md#req-0-1-4-002`](01-original-input.md#req-0-1-4-002)
- 评审记录：[`02-review.md#req-0-1-4-002`](02-review.md#req-0-1-4-002)
- 关联 Issue/PR：`None`
- 实现提交：`da0eb6c`、`1616cf4`

### 技术设计

- 目标行为：在浏览或比较工作区中用 `Alt+左箭头` 后退、`Alt+右箭头` 前进；输入框、
  菜单、对话框和工作区标签保留既有语义。
- 技术栈：React/TypeScript 应用命令解析器。
- 修改范围：`src/commands/appCommands.ts`、`src/App.tsx`、单元和 Edge E2E 测试。
- 接口与数据流：增加两个命令 ID，应用键盘处理器根据活动工具调用现有 handle；不
  新增历史状态。
- 兼容与迁移：现有鼠标按钮、命令面板、Backspace 上一级和标签排序不变。
- 性能预算：每次键盘事件一次常量级映射和一次现有导航调用。
- 错误处理：无可用历史时不消费或改变状态；编辑上下文不拦截。
- 明确不做：系统级全局快捷键、跨应用导航、修改目录历史策略。

### 实现任务

| 任务 ID | 工作内容 | 位置 | 负责人 | 前置依赖 | 状态 |
|---|---|---|---|---|---|
| `REQ-0.1.4-002-T01` | 增加 Alt+箭头命令和映射测试 | `src/commands/` | Codex | T01 of 001 | `Done` |
| `REQ-0.1.4-002-T02` | 在应用键盘分发器调用当前活动栏导航 | `src/App.tsx` | Codex | T01 | `Done` |
| `REQ-0.1.4-002-T03` | 添加导航、编辑上下文和标签排序回归验证 | `e2e`, `src/commands` | Codex | T02 | `Done` |

### 验证计划

- [x] 单元测试：Alt+左/右映射、IME 和编辑上下文保护。
- [ ] Rust/集成测试：`None`
- [x] Edge E2E：目录后退、前进、无历史、文本输入和标签 Alt+箭头排序。
- [ ] 性能检查：`None`
- [x] 人工验证：Windows 键盘实机，含单栏、双栏和比较工作区。
- [x] 回归范围：鼠标导航按钮、命令面板、Backspace 上一级和标签操作（完整 Edge E2E）。

### 发布与回滚

- 配置或迁移步骤：`None`
- 发布观察项：快捷键命中率和导航错误日志。
- 回滚触发条件：输入框被抢焦点、标签排序失效或导航历史被错误修改。
- 回滚步骤：回退快捷键映射和分发器对应提交，保留鼠标导航。

### 完成证据

| 日期 | 提交/PR | 检查结果 | 记录人 |
|---|---|---|---|
| `2026-09-03` | `da0eb6c`、`1616cf4`、`b9b6c13` | Windows 11 专业工作站版 10.0.26200（64 位）调试版实际验证通过：单栏浏览、双栏浏览和比较工作区均完成 `Alt+左箭头` 后退与 `Alt+右箭头` 前进，活动栏路径和非活动栏路径均符合预期。 | `Codex` |
