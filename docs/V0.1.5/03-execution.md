# Muller V0.1.5 执行计划

## 文档信息

| 字段 | 值 |
|---|---|
| 目标版本 | `V0.1.5` |
| 实现分支 | `feat/0.1.5` |
| 候选分支 | `release/0.1.5`（`0.1.5-beta.5` 已交付，保留 `0.1.5-beta.4`） |
| 文档状态 | `In progress` |
| 技术负责人 | `Codex` |
| 最后更新 | `2026-09-17` |

## 执行索引

| 条目 ID | 评审结论 | 实现负责人 | 状态 | 主要交付物 | 验证状态 |
|---|---|---|---|---|---|
| [`BUG-0.1.5-002`](#bug-0-1-5-002) | `Accepted` | `Codex` | `Done / beta.5 delivered` | 共享自然排序、目录/搜索/补全接入及回归测试；beta.5 EXE、NSIS 与实机证据 | `130 frontend + 166 Rust (1 ignored) + 109 Edge; quality gates, native sorting/search/completion and artifact hashes verified` |
| [`BUG-0.1.5-003`](#bug-0-1-5-003) | `Accepted` | `Codex` | `Planned / beta.6` | 较小项目列表布局、单击音效去重、空间返回入口 | `Pending` |
| `REQ-0.1.5-007` | `Accepted` | `Codex` | `Done / beta.4 delivered` | 统一地址导航、空间及共享预览、完整瀑布列；beta.4 候选 | `130 frontend + 109 Edge; quality gates and native EXE navigation/preview passed` |
| `REQ-0.1.5-006` | `Accepted` | `Codex` | `Done / beta.4 delivered` | 空间视图父目录/历史快捷键与焦点隔离；beta.4 候选 | `17 space Edge + native Backspace/Alt navigation passed` |
| `REQ-0.1.5-001` | `Accepted` | `Codex` | `Done` | V0.1.5 分支基线、旧分支归档标签、历史索引 | `Passed` |
| `REQ-0.1.5-002` | `Accepted` | `Codex` | `Done` | 单栏空间扫描测试版、Canvas treemap、钻取、选择和音效 | `Passed` |
| `REQ-0.1.5-003` | `Accepted` | `Codex` | `Done / native follow-up implemented in REQ-0.1.5-004` | 空间视图线性布局优化、全链路历史搜索审计、后续原生索引计划 | `Passed; MFT/USN implementation and probe recorded in REQ-0.1.5-004` |
| `REQ-0.1.5-004` | `Accepted` | `Codex` | `Done / beta.1 delivered` | MFT/USN provider、隔离 helper、索引控制及最终测试 EXE/SHA256 | `148 Rust + 86 frontend + 93 Edge and quality gates passed; final native probe/GUI/space recheck passed` |
| `BUG-0.1.5-001` | `Accepted` | `Codex` | `beta.2 delivered; native in-progress capture pending` | 真实渐进扫描、紧凑方块、微小项汇总入口、SVG 细白边线与直角高亮 | `102 frontend + 153 Rust + 96 Edge passed; EXE/hash and actual selection screenshot recorded` |
| `REQ-0.1.5-005` | `Accepted` | `Codex` | `Done / beta.3 delivered` | 方向键空间选框、可选 Target Cursor、黑透色阶、右键文件操作、测试版 EXE | `108 frontend + 101 Rust + 97 Edge; EXE/hash recorded` |

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
- 实现提交：`9e66190`、`56e90e2`

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
| `REQ-0.1.5-002-T01` | 注册空间视图入口和工作区状态 | `src/workspace`, `src/App.tsx` | 评审 Accepted | `Done` |
| `REQ-0.1.5-002-T02` | 实现 Rust 递归统计、批次事件和取消 | `src-tauri/src/space_sniffer.rs`, `src-tauri/src/lib.rs` | T01 | `Done` |
| `REQ-0.1.5-002-T03` | 实现 Canvas treemap 和 Platinum 视觉 | `src/features/space/` | T02 | `Done` |
| `REQ-0.1.5-002-T04` | 接入钻取、面包屑、选框、键盘和详情 | `src/features/space/` | T03 | `Done` |
| `REQ-0.1.5-002-T05` | 接入音效事件和扫描状态 | `src/features/space/`, `src/features/feedback/` | T04 | `Done` |
| `REQ-0.1.5-002-T06` | 添加 Rust、前端和 Edge 测试 | `src-tauri`, `src`, `e2e` | T02-T05 | `Rust/frontend/Edge passed` |

### 验证计划

- [x] Rust：递归大小、空目录、权限失败、符号链接跳过、取消和旧 session 丢弃。
- [x] 前端：面积比例、绘制、选择、钻取、返回、选框和详情。
- [ ] 音效：选择/打开/完成/失败事件，静音和限流。
- [x] Edge E2E：从浏览入口进入空间视图，打开子目录后返回。
- [ ] 基准：测试版完成后记录 10k/100k 节点首批、完整扫描、FPS、内存和取消延迟。

### 发布与回滚

- 配置或迁移步骤：`None`；空间视图为新增入口，列表视图继续可用。
- 回滚触发条件：扫描阻塞主线程、目录大小明显错误、钻取破坏现有导航或音效异常。
- 回滚步骤：隐藏空间视图入口并回退对应提交，保留现有浏览能力。

<a id="req-0-1-5-003"></a>

## `REQ-0.1.5-003` - 推进空间视图性能并审计 Everything 级搜索

### 追踪关系

- 原始输入：[`01-original-input.md#req-0-1-5-003`](01-original-input.md#req-0-1-5-003)
- 评审记录：[`02-review.md#req-0-1-5-003`](02-review.md#req-0-1-5-003)
- 实现提交：`56e90e2`、`6ece86c`

### 实现任务

| 任务 ID | 工作内容 | 位置 | 状态 | 验证 |
|---|---|---|---|---|
| `REQ-0.1.5-003-T01` | 将 Space treemap 布局改为 weighted strip `O(n)`，保持面积守恒 | `src/features/space/spaceLayout.ts` | `Done` | 10k 节点单测通过 |
| `REQ-0.1.5-003-T02` | 减少 Canvas resize 和选中查找的重复分配 | `src/features/space/SpaceSniffer.tsx` | `Done` | lint/build/test 通过 |
| `REQ-0.1.5-003-T03` | 缓存目录条目折叠名称，优化搜索热路径 | `src-tauri/src/explorer.rs` | `Done` | Rust explorer tests 通过 |
| `REQ-0.1.5-003-T04` | 审计 current、recursive、global、Home、Compare、Duplicates 搜索 | `src-tauri/src/explorer.rs`, `src/features/`, `src/App.tsx` | `Done` | 全链路代码核查 |
| `REQ-0.1.5-003-T05` | MFT+USN 索引服务与权限分离 IPC 后续计划 | `REQ-0.1.5-004` 的按需独立 helper | `Implemented via REQ-0.1.5-004` | 真实 MFT/USN 与 IPC 探针通过；常驻 SCM 服务不在测试版范围 |

### 搜索性能分级结论（REQ-0.1.5-003 历史审计）

以下是原生索引实施前的基线，保留用于追溯优化前后差异。当前 `global` 和 `recursive` 已优先使用 `REQ-0.1.5-004` 的已覆盖原生索引，Home/Compare 复用该链路；失败时才进入下面的遍历/快照降级。

- `current`：已枚举目录会话上的线性过滤，适合当前目录；不是全盘索引。
- `recursive`：每次查询重新 DFS 读取目录元数据，属于可取消降级路径。
- `global`：最多 5 分钟 TTL 的进程内递归快照，首次/过期需重新 DFS，过滤仍为 `O(N)`。
- `Home` / `Compare`：复用 global 或 directory pane，因此继承同样的性能边界。
- `Duplicates`：WalkDir + 分阶段哈希和已完成分组内过滤，属于内容重复检测，不是文件名即时搜索。
- Everything 级目标的历史结论：该次审计时尚缺少 MFT 初建、USN Journal 增量、持久化/倒排索引、常驻服务和本地 IPC；不能将该结论理解为后续 `REQ-0.1.5-004` 仍未实现 MFT/USN。

### 后续计划落实情况

`REQ-0.1.5-004` 已实现 Windows MFT 初始枚举、USN 增量维护和普通权限 GUI 的 ACL 命名管道查询；服务不可用时回退可取消遍历。测试版采用按需独立提权进程和内存索引，尚不提供原生索引持久化或常驻 SCM 服务；真实磁盘样本与能力边界见下节，不能据单盘样本宣称 Everything 全能力对等。

<a id="req-0-1-5-004"></a>

## `REQ-0.1.5-004` - 实现 MFT/USN 原生索引并交付测试版 EXE

- 状态：T01-T06 Done。空间两项阻断已在 `feat/0.1.5` 修复，完整门禁通过并提升 `release/0.1.5`；最终 EXE 的重新打包、哈希校验、原生探针和实机空间复验完成。评审 Accepted，首次 EXE 数据保留为历史证据。
- 追踪：[`01-original-input.md#req-0-1-5-004`](01-original-input.md#req-0-1-5-004)、[`02-review.md#req-0-1-5-004`](02-review.md#req-0-1-5-004)。
- T01：实现 Windows MFT/USN 卷 provider、file ID 树、增量重放和日志恢复，覆盖二进制解析边界和生命周期测试。
- T02：实现同 EXE 提权索引进程、本机用户受限命名管道、普通权限 GUI 查询与状态协议。
- T03：接通 Browse/Home/Compare 全盘搜索，复用结果分页、筛选和取消；内存查询及按页元数据加载。
- T04：增加原生索引启用入口和实际状态，明确降级原因；保留已有空间视图。
- T05：测试 fmt/test/clippy、lint/frontend/build、Edge E2E；执行真实 NTFS 枚举与变更验证并记录性能证据。
- T06（Done）：从 master 基线建立 release/0.1.5，合入已验证 feat/0.1.5；更新测试版元数据，构建独立 GUI EXE，生成 manifest、SHA256、中文运行说明及真实探针报告。人工空间回归的两项缺陷修复后，已重新执行门禁与实机验收并生成最终 EXE/哈希。文档通过 req → feat → release 同步，远端分支按相同顺序非强制推送；master 不参与此次测试版交付。
- 回滚：停止按需索引进程并回退原生索引相关提交；不改写文件内容和现有系统 USN 日志，不强制推送。

### 实现概况（2026-09-13）

- `src-tauri/src/ntfs.rs`：真实 MFT 枚举、枚举前水位、USN 有界重放、日志断档失效、目录父链、Unicode/重解析点和根范围测试。
- `src-tauri/src/native_broker.rs`：同 EXE 按需 helper、当前用户/SYSTEM ACL、medium integrity、本机限制、双向 PID 校验、有界帧和超时、每秒增量维护、取消及四份分页缓存。
- `src-tauri/src/explorer.rs`：global/recursive 优先原生索引，失败回退；分页/选中条目补充元数据放到后台线程。Portable 查询复用内存，所有根覆盖和过期检查，取消保留旧快照。
- `NativeIndexerControl`：全局入口、启用/停止、实际引擎/状态/计数/原因、中英文 Platinum 样式及硬链接范围说明。

### 最终测试版交付（2026-09-13）

最终测试包：`D:\Muller\release\0.1.5-beta.1`。以下数据与该目录当前的 `manifest.json`、`SHA256SUMS.txt` 和 EXE 实际哈希一致。

| 项目 | 最终交付值 |
|---|---|
| 文件 | `Muller-0.1.5-beta.1-x64.exe` |
| 版本及平台 | `0.1.5-beta.1`，Windows x64 |
| 源分支 | `release/0.1.5` |
| 构建源提交 | `c998709c5951809ebc1455fe6cef1b9e4d8ae6f8` |
| 构建时间 | `2026-09-13T13:31:33.7996512+08:00` |
| 大小 | 11,193,344 字节 |
| SHA256 | `57ca1fa13bc5fda39fc2b9eb4736a4eb0a65653cc109ebb156d122614d0a67d5` |
| 清单与说明 | `manifest.json`、`SHA256SUMS.txt`、`README.zh-CN.txt` |
| 原生探针 | `native-probe-final-D.json`，`ntfs-mft-usn`，`passed: true` |

| 最终验证 | 结果与证据 |
|---|---|
| 质量门禁 | 148 个 Rust、86 个前端、93 个 Edge 测试通过；lint、生产构建、fmt、clippy 通过。另 1 个需提权的直接 provider 测试 ignored，由真实 helper 探针补充 |
| MFT 初建 | D 盘 168,919 条记录，探针记录含启动/提权流程的初建 398 ms；已有文件可查询 |
| 内存查询 | 首次查询含 IPC 10.713 ms；本机重复运行可能受 OS 缓存影响，不代表冷启动或所有磁盘耗时 |
| USN 增量 | 创建、文件改名、父目录改名影响后代路径、删除四项通过，验证共 4,158 ms |
| GUI 原生索引 | 5 盘、2,099,561 条记录就绪；`final-native-index-ready.jpg` |
| GUI 全盘搜索 | release 浏览页切换全盘搜索，查询 `Muller-0.1.5-beta.1-x64.exe` 返回本次 13:31 构建的 EXE 与系统 prefetch 名称匹配项；`final-native-global-search.jpg` |
| GUI 空间文件块与钻取 | 从 release 方块双击 beta 目录，11 MB、10 个文件块正常显示；`final-space-files.jpg` |
| GUI 面包屑与选框 | 点击 release 面包屑返回 206 MB、4 个目录；拖拽跨 beta/archive 选中 2 块，白色描边与 180 MB 详情正常；`final-space-parent.jpg` |

### 首次测试版构建记录（历史证据，已由上述重打包替代）

本地独立 EXE 测试包目录：`D:\Muller\release\0.1.5-beta.1`。二进制、探针 JSON 和实机截图在测试包中保存，下面固化其来源与结果。

### 首次构建与校验

| 项目 | 值 |
|---|---|
| 文件 | `Muller-0.1.5-beta.1-x64.exe` |
| 版本 | `0.1.5-beta.1` |
| 源分支 | `release/0.1.5` |
| 构建源提交 | `d3894ff69bfa73b69edd58c5ad590ee1e02ddd8f` |
| 构建时间 | `2026-09-13T13:09:56.0060274+08:00` |
| 大小 | 11,192,320 字节 |
| SHA256 | `f54f8d0c745752124d33362730af3953d23b2e37cb342bce5df84bf850de17e6` |
| 历史清单 | 首次清单数值已固化于本表；测试包当前 `manifest.json` 指向上文最终交付构建 |

版本提升遵循 req/0.1.5 → feat/0.1.5 → release/0.1.5。本次交付不向 master 提升；后续文档同步提交不改变上述 EXE 的构建源提交。

### 首次构建验证结果

| 检查 | 结果与证据 |
|---|---|
| Rust | 147 个测试通过；另 1 个需提权的直接 provider 测试 ignored，以真实 helper 探针补充 |
| 前端 | 86 个测试通过 |
| Edge | 92 个 E2E 通过，包含原生索引启用、状态变化、授权取消、停止/重启和空间视图 |
| 质量门禁 | lint、生产构建、Rust fmt、clippy 通过 |
| 首次构建 EXE 的 MFT 初建 | D 盘 169,001 条记录，含进程启动/授权 2,717 ms，能查到预先创建的探针文件 |
| 首次构建 EXE 的查询 | 首次查询含 IPC 15.9 ms；这是单机 D 盘探针样本，不是所有查询或磁盘的性能承诺 |
| 首次构建 EXE 的 USN 增量 | 创建、文件改名、父目录改名影响后代路径、删除均通过；四类变化验证共 4,163 ms |
| GUI 实机启动链路 | 启用后 5 个磁盘、2,099,823 条记录就绪；证据 `native-index-ready.jpg` |
| GUI 全盘搜索 | C 盘浏览页面查询 `Muller-0.1.5-beta.1-x64.exe`，返回 D 盘测试版 EXE 与 C 盘 prefetch 名称匹配项；证据 `native-global-search.jpg` |
| GUI 空间视图 | `D:\Muller\release` 的 206 MB、4 个文件夹渲染；单击 beta 目录白色选框与属性正常。首次后续回归发现文件块与中间级面包屑缺陷，修复及最终复验见下文 |

首次构建 EXE 探针报告为 `native-probe-release-D.json`，引擎 `ntfs-mft-usn`，`passed: true`。早期调试版 F 盘样本保存在 `native-probe-debug.json`：20,387 条记录，含启动/授权初建 2,047 ms、查询 16.675 ms、四类 USN 变化共 4,147 ms。以上只对应各自构建，不替代修复后重新打包 EXE 的验收。

### 发布阻断修复与重验记录（已关闭）

- 文件节点遗漏：原 `Work::Enter(file)` 未安排 `Exit`，双击进入仅含文件目录时总字节数存在但文件方块未显示。`6dc173b` 已补齐文件批次并增加对应回归；修复后的 Rust 全量 148 个测试、fmt/clippy 通过。
- 中间层面包屑无动作：原逻辑仅处理索引 0。`908d552` 已按完整路径恢复历史中的正确目录，截断历史、清除选择并播放导航音效；扫描起点前的祖先改为非按钮。两次钻取 → 中间层面包屑 → Esc 回根的 Edge 定向回归通过。
- 两项修复属于 `REQ-0.1.5-002` 已接受的既有验收范围，均在 `feat/0.1.5` 提交。修复后 148 个 Rust、86 个前端、93 个 Edge 测试及 lint/build/fmt/clippy 全部通过，已按顺序提升至 `release/0.1.5`。最终源 `c998709` 的 EXE 重打包、SHA256、实际空间文件块/钻取/面包屑/选框及原生索引实机复验通过，阻断关闭，T06 Done。

### 运行与测试入口

1. 双击 EXE。系统需已安装 Microsoft Edge WebView2 Runtime；本机运行验证已通过。
2. 点击地址栏右侧“NTFS 快速索引”，再点“启用快速索引”，按 Windows 提示授权独立索引进程；GUI 保持普通权限。
3. 就绪后使用主页或浏览页的全盘搜索。递归目录搜索也会优先读取已覆盖的原生索引；当前目录搜索继续使用目录会话。
4. 文件创建、删除和重命名后重新搜索，读取已由 USN 更新的结果。增量维护周期约 1 秒。
5. 面板中的“停止索引”可停止构建和维护；需要时再次启用。窗口默认关闭到托盘，通过托盘“退出”结束应用及索引进程。
6. 进入可读的本地目录，点击“空间视图”，测试方块比例、单击选择、双击目录钻取、Esc/面包屑返回、拖拽选框与音效设置。

### 测试版边界

- 原生 MFT/USN 索引驻留于索引进程内存，不持久化原生记录和水位。重新启动进程或再次启用需要重新初建；未安装常驻 Windows SCM 服务。portable JSON 快照只用于遍历降级。
- 当前索引每个 MFT 文件记录的主要名称，其他硬链接名称尚未完整覆盖。程序索引详情已显示该范围；本次不宣称与 Everything 的全部能力一致。
- 文件名查询复用内存，并按页补充大小、修改时间等元数据；明确要求大小/时间排序或时间过滤时，会读取更多匹配候选的元数据。
- MFT 文件名索引不提供文件夹字节总量；空间视图仍单独扫描逻辑大小。百万级索引就绪截图不能替代空间扫描、帧率、内存或百万级查询的性能基准。
- 非 NTFS、USN 日志不可用、原生服务未启用或授权取消时，继续使用可取消的目录遍历降级。原生模式不会自行创建、删除系统 USN 日志或修改用户文件内容；探针仅写入并清理自行建立的唯一临时测试目录。

<a id="bug-0-1-5-001"></a>

## `BUG-0.1.5-001` - 空间视图布局与渐进渲染修复

- 交付状态：`0.1.5-beta.2 delivered / native in-progress capture pending`。代码及测试包已交付；T04 的最终 EXE 连续扫描截图仍待补齐，其余已记录的验证见下表。
- 原始反馈：[01-original-input.md](01-original-input.md#bug-0-1-5-001)。评审：[02-review.md](02-review.md#bug-0-1-5-001)，Accepted。
- 实现提交 `546f843`；实机检查后 `f8585e2` 移除无法单独操作的预览子格，采用 SVG 开放式直角装饰线，真实子项在钻取后操作。测试包 `0.1.5-beta.2` 已交付，保留 beta.1 以供追溯。
- T01：Rust 发现/增长/完成节点按批 upsert，传递扫描状态与 partial，按时间或批量限频；测试 Done 前增长、取消和无重复累计。
- T02：client 使用路径索引维护树并合并批次，App 首批挂载地图，progress 显示实际已统计大小/状态；覆盖会话隔离与取消竞争。
- T03：squarified 布局、微小项汇总、Platinum 画布/信息栏，按稳定 ID 在 Canvas 插值，命中当前帧，减少动画配置生效；扫描快照不得清空钻取历史。
- T03 补充验收：独立方块的短边至少 `28 CSS px` 且面积至少 `1600 CSS px²`；任一低于门槛的项按实际字节合并，并通过可点击列表入口查看、选择和打开成员。绘制保留真实占比，不为了可点击性夸大独立项或汇总项的面积。边线对照 [已批准 SVG](design/space-sniffer-wireframe.svg)，采用细白光线与 90° 直角选择高亮，覆盖普通、悬浮和选中状态。
- T04：自动化回归以及实际 Windows 截图对照；扫描未结束时能够观察多个不同的真实字节数和矩形面积，最终结果与字节总量一致。
- T05：相关门禁及完整里程碑检查，依次 req → feat → release，生成 beta.2 EXE/manifest/SHA256 和实测图；不提升 master。
- 回滚：保留 beta.1 二进制及构建提交；停止当前扫描并退出 beta.2，后续代码通过普通反向提交撤销，不改写文件内容或 Git 历史。

### 当前自动化验证（2026-09-13）

| 验证项 | 结果与边界 |
|---|---|
| 实现提交 | `546f843`，修复 Platinum 空间布局与真实渐进扫描 |
| 前端与 Rust | 102 个前端测试、153 个 Rust 测试通过；另 1 个需提权的直接原生索引测试 ignored |
| Edge E2E | 全量 96 项通过，其中 5 项空间视图测试覆盖选择/钻取/返回及下述渐进行为 |
| 质量门禁 | lint、生产构建、Rust fmt、clippy 通过；结果由主代理核对 |
| 本轮原生索引边界 | 未修改原生索引，未重跑此前 MFT/USN 实机探针；beta.1 探针历史证据不冒充本轮实测 |
| 剩余验收 | 最终 EXE 扫描中连续截图；用户正在窗口中试用，停止自动化输入以避免争抢控制 |

- 受控 Channel 的多批真实协议消息在 Done 前更新画布；停止扫描保留最后几何状态，后续晚批次不能覆盖。
- 扫描中钻取取消父会话，子目录仍可收到进度；父子会话状态与面包屑/返回历史保持隔离。
- 极小目录通过 Smaller items 列表入口可点击到达；系统减少动画设置下布局立即稳定。
- 上述为自动化行为证据，不将受控消息流等同于最终 EXE 的原生动画截图；实际静态窗口与交付哈希如下。

### beta.2 测试包与实机记录（2026-09-13）

| 项目 | 值或证据 |
|---|---|
| 文件 | `D:\Muller\release\0.1.5-beta.2\Muller-0.1.5-beta.2-x64.exe` |
| 版本 / 平台 | `0.1.5-beta.2` / Windows x64，PE ProductVersion 已核对 |
| 构建源 | `release/0.1.5`，`c666446b3625f79956f02d01e5aff823c9161f04` |
| 大小 / SHA256 | 11,214,336 字节 / `02235d6f59efc34873c5538553497a679a83ad9853e781f3b66067e89df6fca1` |
| 封装时间 | `2026-09-13T14:18:58.3034786+08:00` |
| 实际 EXE | 已启动，真实项目目录显示 42.6 GB / 34 项；后续实际资源目录显示 38.3 GB / 265 项、汇总 174 项 |
| 视觉证据 | 包内 `final-space-selection.jpg`：最终 EXE 的灰黑比例方块、较小项目入口、白色直角高亮及所选文件 211 MB / 0.5% 详情 |
| 前后对照基线 | 包内 `before-src.jpg`、`before-cancelled.jpg` 保存 beta.1；最终选择截图来自不同目录，不能当成同目录面积对比 |
| 最终修正验证 | `f8585e2` 的 5 项空间 Edge、scoped lint 通过，最终 beta.2 生产构建通过 |
| 校验文件 | 包内 `manifest.json`、`SHA256SUMS.txt`、`README.zh-CN.txt` |

用户在最终 EXE 内连续钻取试用时，Windows 输入工具两次检测到并发输入；已停止自动化操作，保留用户窗口。最终 EXE 的连续扫描中截图未完成；扫描增量算法、客户端快照和 Done 前画布变化已有上述自动化证据。此记录不将缺少的原生动画截图标为通过。

本次依次 req → feat → release 同步，master 保持 `78e63c9`。后续文档同步不改变上述 EXE 的构建源和哈希。

<a id="req-0-1-5-005"></a>

## `REQ-0.1.5-005` - 空间视图方向键、Target Cursor、黑透配色与右键操作

### 追踪关系与执行状态

- 原始输入：[`01-original-input.md#req-0-1-5-005`](01-original-input.md#req-0-1-5-005)。
- 评审记录：[`02-review.md#req-0-1-5-005`](02-review.md#req-0-1-5-005)，`Accepted`。
- 状态：`Done / 0.1.5-beta.3 delivered`；实现提交 `37c4ed7`，release 提交 `73a82ad`。
- 实现基线：保留 beta.2 紧凑布局、真实增量统计、可点击小项入口和细白正交边线；不改动 MFT/USN 文件名索引架构。

### 技术设计

- 在空间布局模块提供方向邻居查询，按当前帧矩形、方向投影与距离确定稳定候选，越界不环绕；交互组件保存有效选择 ID，键盘事件只在合适焦点内处理，保留 Enter/Esc 和音效语义。
- 用户配置新增 `cursorEffect` 枚举，设置外观选项可切换系统/Target Cursor。旧配置、非法枚举和恢复默认均归一到 `system`。入口在应用层单例挂载，React Bits 附件逻辑转换为现有 CSS/TypeScript 与 GSAP。
- Cursor 通过 DOM 目标和 Canvas 当前帧虚拟矩形统一获取边界；Canvas 报告真实命中项几何，扫描插值时持续更新。使用 ref/GSAP 管理高频移动，禁止为每个 tile 建立光标实例；离开窗口、页面隐藏、触摸、减少动画、停用或卸载时收束动画并恢复光标。
- 方块色板保持低亮度，以路径稳定映射石墨、墨蓝、烟紫、青黑和暖黑；局部反光增加通透感，不用大面积亮灰提高层次。悬浮/选择只适量增强反光并保留白色细线、90° 拐角和文字可读性。
- 空间右键菜单复用 Browse 操作能力：先命中当帧真实节点，再按单项/多选及原生能力生成可用项。使用既有确认、冲突处理和回收站流程；操作失败保留当前视图并显示原因，成功修改文件后取消相关旧扫描并重新统计。聚合项先展开真实成员列表，不能将聚合 ID 用作文件路径。

### 实现任务

| 任务 ID | 工作内容 | 主要位置 | 前置依赖 | 状态 |
|---|---|---|---|---|
| `REQ-0.1.5-005-T01` | 方向邻居算法与空间选框键盘交互，覆盖初选、边界、焦点和扫描帧 | `src/features/space/` | 评审 Accepted | `Done` |
| `REQ-0.1.5-005-T02` | 外观设置、配置持久化/恢复及 React Bits Target Cursor 适配 | 应用配置、设置界面、光标组件、`src/App.tsx` | 评审 Accepted | `Done` |
| `REQ-0.1.5-005-T03` | DOM/Canvas 光标锁定与当前帧虚拟矩形，输入/可见性/减少动画清理 | 光标组件、`src/features/space/` | T02 | `Done` |
| `REQ-0.1.5-005-T04` | 低亮黑透色板、局部反光与实际运行界面视觉核验 | `src/features/space/` | 评审 Accepted | `Done` |
| `REQ-0.1.5-005-T05` | 复用 Browse 右键文件操作、单项/多选命中及修改后扫描失效刷新 | `src/features/space/`、浏览文件操作与应用协调层 | 评审 Accepted | `Implemented core menu; rename/properties follow-up` |
| `REQ-0.1.5-005-T06` | 有意义的单测/Edge 回归，完整质量门禁及真实 EXE 交互截图 | `src`、`e2e`、测试包证据 | T01-T05 | `Done; 97 Edge and EXE evidence recorded` |
| `REQ-0.1.5-005-T07` | feat → release、beta.3 元数据/EXE/manifest/SHA256/说明，req 证据同步并非强制推送三分支 | `release/0.1.5`、`release/0.1.5-beta.3`、版本文档 | T06 | `Done` |

### 验证计划

- [x] 方向键：当前可见矩形四向邻居、没有选择时初选、Enter/Esc；Space Edge 回归通过。扫描帧与输入焦点隔离仍保留为后续专项扩展。
- [x] 配置与光标：非法值回退、Target Cursor 设置持久化、DOM/Canvas 命中和失焦/隐藏/触摸/减少动画清理通过实现与前端测试。
- [x] 色板：Canvas 使用深黑低饱和墨蓝、烟紫、青黑、暖黑层次；自动化构建通过，真实 EXE 截图随 beta.3 包补录。
- [ ] 右键：命中当帧节点、在多选内保留集合、真实文件/目录适用操作、不可用能力禁用、聚合项先选成员、菜单关闭焦点归还；文件修改成功后重扫且旧扫描不能覆盖新结果。
- [x] 完整前端门禁：lint、103 项前端测试、生产构建、全量 Edge E2E 通过；Rust 代码未改动，本轮不重复执行 Rust 门禁。
- [ ] 交付：beta.3 EXE 的版本/哈希/源提交核对，实际窗口方向键、Target Cursor、右键与配色截图；beta.2 的原生扫描中连续截图缺口独立保留或以相应新增真实证据关闭，不由用户满意或静态截图替代。

### 发布与回滚

- 先提交 req 并合入 feat，再开始对应产品实现；测试后的 feat 提升 release，版本元数据仅在 release 更新为 `0.1.5-beta.3`，交付目录 `D:\Muller\release\0.1.5-beta.3`。
- 构建、实测及证据补齐后，文档从 req → feat → release 同步，三个长生命周期分支非强制推送；此次不提升 `master`。
- 保留 beta.2 EXE 和已记录哈希。光标出现兼容问题可立即切回系统光标；发布阻断时保留 beta.2 为可运行回退版本，代码用普通反向提交撤销，不改写 Git 历史或用户文件。

<a id="req-0-1-5-005"></a>

## `REQ-0.1.5-005` - 空间视图交互与材质增强

- 状态：`Accepted / Implementation pending`，目标 beta.3。
- 原始输入：[01-original-input.md](01-original-input.md#req-0-1-5-005)，评审：[02-review.md](02-review.md#req-0-1-5-005)。
- T01：SpaceSniffer 键盘邻居选择、右键菜单和当前帧命中注册。
- T02：App/Explorer 操作回调、侧栏空间模式保持、新扫描会话隔离。
- T03：Preferences/Settings 持久化 cursorEffect，Target Cursor 生命周期和 reduced/touch 处理。
- T04：深黑透亮低饱和材质与 Canvas palette 回归。
- T05：全量门禁、beta.3 EXE、manifest/SHA256，beta.2 保留。

### beta.3 测试包与验证记录（2026-09-13）

| 项目 | 值 |
|---|---|
| 文件 | `D:\Muller\release\0.1.5-beta.3\Muller-0.1.5-beta.3-x64.exe` |
| 安装包 | `Muller-0.1.5-beta.3-x64-setup.exe`（NSIS） |
| 源分支 / 提交 | `release/0.1.5` / `1497dc5` |
| 直接运行 EXE | 11,221,504 字节，SHA256 `4f75bc480f45c6bc75d3fd6017b78b988263eb98244307c7d4531ee013674c2f` |
| NSIS 安装包 | 4,869,655 字节，SHA256 `0e9f960bd9356d6d03849d0fcd26fc65eb625be2a62699785962a3035248f3b2` |
| 验证 | 108 前端、101 Rust（1 ignored）、97 Edge；lint/build/fmt/clippy 通过 |

说明：默认 Tauri 构建的 MSI 目标受 WiX 预发布版本规则限制，本次采用可直接运行 EXE 与 NSIS 安装包交付；beta.2 测试包继续保留。右键本轮交付打开/定位/复制路径核心菜单，重命名和属性列为后续扩展。

### 增补实现与验证（REQ-0.1.5-005，2026-09-13）

- `4283112` / `9b3203c` / `1369f13`：空间右键菜单、列表交互、详情栏调宽、浏览操作 host 路由与回收后重扫。比较/双栏菜单不显示。
- `5afcc30`：Target Cursor 限定空间方块并改为亮白四角边框。
- 验证：108 个前端测试、空间 Edge 6 项通过，lint 与生产构建通过；方向邻居单测覆盖投影、上下左右、汇总项和边界保持。
- 已知边界：属性、自定义收纳、选择解压目标通过事件预留给浏览对话框；核心菜单操作已接入现有 native client。

<a id="req-0-1-5-006"></a>

## `REQ-0.1.5-006` - 空间视图 Backspace 与 Alt 历史导航

- 原始输入：[01-original-input.md](01-original-input.md#req-0-1-5-006)；评审：[02-review.md](02-review.md#req-0-1-5-006)，`Accepted`。
- 状态：`Done / beta.4 delivered`，记录日期 `2026-09-14`，目标 `0.1.5-beta.4`。空间专项 17 项通过，EXE、NSIS、哈希及实机证据已归档。

| 任务 ID | 实现与主要位置 | 状态 |
|---|---|---|
| `REQ-0.1.5-006-T01` | `spaceNavigation.ts` 处理盘符/UNC 父目录；`SpaceSniffer.tsx` 提供 up/back/forward 与历史分支，取消旧扫描、恢复有效快照并隔离晚批次 | `Verified` |
| `REQ-0.1.5-006-T02` | App 路由 Backspace、Alt 历史导航与顶部按钮；输入、IME、菜单、对话框、标签及分隔条按键隔离 | `Verified` |
| `REQ-0.1.5-006-T03` | 父目录单测、空间及 Browse 导航回归，req → feat → release 同步，beta.4 EXE 与构建证据 | `Done` |

- Backspace 返回实际父目录，盘符根/UNC 共享根保持；Alt+左/右只在已有历史中往返。新钻取、侧栏跳转或地址提交清空前进历史，空间模式保持。导航更换会话时清理旧选择、右键菜单及预览，不用历史前进猜测要打开哪个子目录。
- 小项列表焦点不阻断 Alt 历史；调宽分隔条仅消费普通方向键，组合键交给导航。App 的普通方向键选择命令避开分隔条，浏览预览调宽也不会改变文件选择。
- 已加入初始扫描根之外的父目录、盘符边界、跨分支往返、新导航清空前进、菜单/输入/IME 隔离、较小项目焦点、扫描取消及晚批次、侧栏路径和标签目录隔离的空间 E2E。测试存在与最终通过分别记录；完整结果以 [beta.4 证据表](#beta4-delivery-evidence) 为准。
- 回滚：普通反向提交撤销本条改动；不修改文件内容或扫描引擎。

<a id="req-0-1-5-007"></a>

## `REQ-0.1.5-007` - 统一空间地址栏、预览与瀑布流宽度适配

- 原始输入：[01-original-input.md](01-original-input.md#req-0-1-5-007)；评审：[02-review.md](02-review.md#req-0-1-5-007)，`Accepted`。
- 状态：`Done / beta.4 delivered`，记录日期 `2026-09-14`，与 `REQ-0.1.5-006` 一起交付 `0.1.5-beta.4` 测试版。

| 任务 ID | 实现与主要位置 | 状态 |
|---|---|---|
| `REQ-0.1.5-007-T01` | App 复用顶部地址、面包屑与导航按钮，空间状态上报；取消地址草稿恢复已提交目录，隐藏内部重复路径条 | `Verified` |
| `REQ-0.1.5-007-T02` | `SpaceSniffer.tsx` 提供预览按钮和 Space/焦点行处理；共享 `PreviewPanel.tsx/.css` 重新组织内容、元信息与嵌入布局，隔离晚响应及媒体生命周期 | `Verified` |
| `REQ-0.1.5-007-T03` | `masonryLayout.ts` 约束完整列数、均分宽度；`stage7.css` 保持固定预览分栏、约束预览占比、稳定滚动条空间 | `Verified in targeted tests` |
| `REQ-0.1.5-007-T04` | 完整质量门禁、候选版本元数据与更新日志、EXE/NSIS/manifest/SHA256，req → feat → release 证据同步 | `Done` |

### 实现说明

- 顶部地址和空间目录使用同一导航来源。提交路径才导航；Esc 先关闭补全建议，再取消编辑，失焦也丢弃未提交草稿，面包屑恢复实际目录。后退、前进、上一级、侧栏和地址提交更新相同的历史状态及按钮可用性。
- 详情中的单选预览按钮与 Space 共用入口；Smaller items 的焦点行先成为当前选择，再打开该行预览。关闭预览归还地图焦点，Esc 优先关闭预览。编辑输入、菜单、对话框和媒体控制不被页面空格/导航劫持。
- 共享预览拆为标题/类型、内容舞台和默认折叠属性区。浏览保留固定/浮层操作，空间使用现有详情栏内嵌布局。目录保留已有递归大小、子目录及子文件数量统计；文本、图片/GIF、音视频、RAW/PPTX Shell 缩略图沿用既有读取和权限/大小限制。本轮未新增 PDF 内联渲染支持。
- 文件身份改变后重建读取器和媒体节点，旧播放器随选择切换/关闭卸载；文件预览任务通过代际与取消隔离晚响应，目录统计及 Shell 元信息也不得串到下一项。文件大小/修改时间变化可触发当前文件重建，避免同路径旧内容残留。
- 瀑布布局继续使用现有 ResizeObserver 的实际内容宽度。修复窄容器将固定预览变成浮层的覆盖规则；固定预览始终参与 Grid，宽度最多占可用空间 60%。图片列按剩余宽度取整数列，余量均分；空间不足时减少列数，极窄单列不再被 110px 下限撑出容器。滚动条预留稳定空间，保留虚拟化、缩略图与选框。
- 相册 mock 从原测试提取至 `e2e/helpers/albumDirectoryMock.ts` 供旧、新回归共用；`e2e/masonry-preview.spec.ts` 校验真实 DOM 的完整列边界、等宽、无水平溢出、固定预览不遮挡列、拖宽/缩放及调宽按键后的选择路径保持。

<a id="beta4-delivery-evidence"></a>

### beta.4 验证与交付证据（REQ-0.1.5-006/007，2026-09-14）

产品提交 `c8be8cff8b52d0bfc81b08717633af4b87c253d5` 已通过相关完整门禁。全套 Edge 首轮暴露两项导航时序问题，修复后空间全套及连续操作重复回归通过；按最终覆盖口径记录 109 项，不把首次失败隐去或把重复运行计为新增测试。

| 项目 | 结果与交付证据 |
|---|---|
| 前端门禁 | lint、130 项前端测试、生产构建通过；最终导航同步修正后 scoped lint 与生产构建再次通过 |
| Rust 门禁 | `cargo fmt --all -- --check`、`cargo test --workspace --locked`、`cargo clippy --workspace --all-targets --all-features --locked -- -D warnings` 通过；1 项需要管理员真实 NTFS 环境的测试 ignored。本轮无原生索引改动，未重跑 MFT/USN 实机探针 |
| Edge 全部文件覆盖 | 非空间 92 项 + 最终空间 17 项 = 109 项通过；覆盖 Browse/Compare 历史、共享地址补全、所有原有预览及相册、固定预览调宽、空间扫描与导航 |
| 空间重复回归 | 地址编辑与连续 Escape 两条时序回归各重复 8 次，共 16/16 通过；目录、历史和地址在同次 UI 提交内同步，不通过测试延时绕过问题 |
| 瀑布专项 | 原有 4 项相册 + 新增固定预览 1 项；900–1440 px 多宽度、鼠标/键盘调宽、无残列/水平溢出、选择保持。布局单测 14 项包含 100,000 项虚拟化 |
| 测试命令 | `npx playwright test --workers=1` 全部文件覆盖；`npx playwright test e2e/space-sniffer.spec.ts --workers=1` 最终专项；时序用例使用 `--repeat-each=8` |
| 实现提交 | `feat/0.1.5` / `c8be8cff8b52d0bfc81b08717633af4b87c253d5`，关联 REQ-0.1.5-006/007 |
| 需求同步 | 需求基线 `b0981c7`、`bd955e4` 已从 req 合入 feat；本表所在文档提交随后按 req → feat → release 同步，提交沿分支历史追溯 |
| 发布候选源 | `release/0.1.5` / `01352893dc67192a0f4e0fcdd9b862d59e29dac3`；feat 通过门禁后提升，release 元数据已回流 feat |
| 版本 / 交付目录 | `0.1.5-beta.4` / `D:\Muller\release\0.1.5-beta.4`；2026-09-14 00:22 +08:00 构建，EXE 已实际启动 |
| EXE / NSIS / SHA256 | 文件及哈希见下表，已核对 `manifest.json`、`SHA256SUMS.txt`、README 和实际产物。NSIS 已构建，未执行安装 |
| 实机核验 | 最终 EXE 在 `D:\Muller\src` 实测地址导航、features 钻取、Backspace 返回 src、Alt+左回 features、Alt+右到 src；真实文件夹统计、App.tsx 文本读取、选择跟随、Space 开关、Esc 关闭、详情调宽通过；相册固定预览已打开真实截图 |
### 晋级与回滚

- 本轮按 req → feat → release 同步需求和实现；实现及阻断修正完成、门禁通过后才更新 release 候选元数据并构建 beta.4。release 专属修正须回合 feat，更新的长期分支使用非强制推送。
- 保留 beta.3 的 EXE、安装包、manifest 和哈希，不覆盖既有交付记录；本次测试版不向 `master` 晋级。
- 必要时使用保留的 beta.3 测试包回退，代码通过普通反向提交撤销。目录统计与媒体权限边界不变，不修改用户文件，也不增加永久删除能力。

### 最终产物与实机证据

| 产物 | 字节数 | SHA256 |
|---|---:|---|
| `Muller-0.1.5-beta.4-x64.exe` | 11,235,840 | `5cc3ab5d5b1f137c68a7dc573483576ab6dedc2868f07e0d9db2fc4b657ae47e` |
| `Muller-0.1.5-beta.4-x64-setup.exe` | 4,883,256 | `83dbe869f6048992f2467e17d5945e5c5bf18bc8620eb9ba1fce11ccd90a93e6` |

截图保存在同一交付目录：`space-folder-preview.jpg`、`space-text-preview.jpg`、`space-history-return.jpg`、`album-pinned-preview.jpg`。实机验收使用普通权限 beta.4 EXE，未安装 NSIS，未修改或删除用户文件；MFT/USN 未在本轮重复探测。空间预览按钮和 Space、共享文本/图片/目录预览已实测，其余媒体类型由对应 Edge 回归覆盖。

beta.3 直接 EXE 与安装包的原有哈希保留。构建来源固定为上述 release 提交，后续纯文档同步不改变产物的构建来源。
<a id="bug-0-1-5-002"></a>

## `BUG-0.1.5-002` - 数字文件名自然排序

- 原始输入：[01-original-input.md](01-original-input.md#bug-0-1-5-002)；评审：[02-review.md](02-review.md#bug-0-1-5-002)，`Accepted`。
- 状态：`Done / beta.5 delivered`，交付 `0.1.5-beta.5`，记录日期 `2026-09-17`。

| 任务 ID | 实现与主要位置 | 状态 |
|---|---|---|
| `BUG-0.1.5-002-T01` | `src-tauri/src/natural_sort.rs` 提供无分配、无整数溢出的共享数字段比较器，覆盖前缀/嵌入、多段数字、前导零、超长数字、Unicode 和比较顺序性质 | `Verified` |
| `BUG-0.1.5-002-T02` | `src-tauri/src/explorer.rs` 统一目录与搜索会话自然名称排序、同字段回退；分页前排序、按完整路径稳定区分同名结果，新增 600 项跨页、当前搜索/定位/选择位置解析及递归/缓存索引回归 | `Verified` |
| `BUG-0.1.5-002-T03` | `src-tauri/src/windows_navigation.rs` 使地址补全和 UNC 共享列表复用比较器；每项缓存小写键，候选限制前排序，补充编号/前导零/后缀/截断回归 | `Verified` |
| `BUG-0.1.5-002-T04` | 完整前端/Rust/Edge 门禁，req → feat → release 同步、beta.5 元数据和 EXE/NSIS/哈希 | `Done` |
| `BUG-0.1.5-002-T05` | 实际 beta.5 EXE 使用 1/2/10、前导零及多段数字的安全目录验收；保留 beta.4 包 | `Done; native EXE screenshots recorded` |

### 实现说明

- 数字段先去除前导零，再比较有效长度和数字内容，避免机器整数及 JavaScript 安全整数范围限制。同数值时先比较剩余名称，整名自然相同时才按更少前导零确定顺序；非数字文本保留既有大小写折叠后的字符序。
- 浏览、相册、比较页文件浏览及主页搜索通过同一目录会话排序接收结果。当前目录过滤继承会话顺序；递归、内存索引、持久索引和 native 索引搜索在展示分页前调用同一排序入口。名称降序反转名称顺序，目录优先不变；类型、大小、修改时间主排序不变，同值时名称自然升序回退。
- 比较器复用缓存名称，不增加比较期间分配或逐项元数据读取；地址补全每项构建一次小写排序键。MFT/USN 原始记录分页、搜索匹配规则、空间面积排序和文件夹比较报告的匹配身份不作改动。

<a id="beta5-delivery-evidence"></a>

### beta.5 验证与交付证据（BUG-0.1.5-002，2026-09-17）

| 项目 | 结果与交付证据 |
|---|---|
| lint | 本轮通过 |
| 前端测试 | 本轮 130 项通过 |
| 生产构建 | 本轮通过 |
| Edge 完整回归 | 本轮 109/109 通过；覆盖完整现有 Edge suite。排序算法与真实目录结果另由 Rust 回归及最终 EXE 核验验证 |
| Rust workspace 测试 | `cargo test --workspace --locked` 通过，166 passed / 1 ignored（需要管理员 NTFS 实测）；新增 13 项排序回归通过，包含 `resolve_entries` 过滤后位置与 512 项分页边界断言 |
| Rust fmt / clippy | `cargo fmt --all -- --check`、`cargo clippy --workspace --all-targets --all-features --locked -- -D warnings` 通过 |
| 实现提交 | `feat/0.1.5` / `530b5f68b38e8269d02817cce8d176661b780c85` |
| 发布候选源 | `release/0.1.5` / `216cd4aba552fbf110bd3ccd0b11d51ee96e1903` |
| 版本 / 交付目录 | `0.1.5-beta.5` / `D:\Muller\release\0.1.5-beta.5`；2026-09-17 23:43 +08:00 构建 |
| EXE / NSIS / SHA256 | 文件、字节数与 SHA256 见下表；`manifest.json`、`SHA256SUMS.txt` 与 README 已写入并读回核对，EXE Windows ProductVersion/FileVersion 均为 `0.1.5-beta.5`；NSIS 已构建但未安装 |
| 原生 EXE 核验 | 普通权限 EXE 在安全目录 `D:\Muller\release\0.1.5-beta.5\numeric-sort-fixture` 验证两个浏览栏的升降序、目录优先、当前目录搜索和地址补全；四张实机截图保存在交付目录 |
| 需求同步 | 本条需求已从 req 合入 feat；本轮收尾证据按 req → feat → release 同步，具体提交沿分支历史追溯 |

### 最终产物与实机证据

| 产物 | 字节数 | SHA256 |
|---|---:|---|
| `Muller-0.1.5-beta.5-x64.exe` | 11,249,664 | `26576c60e2ee1cf3898f16b69042d8d977ce4ebe647efd30ff9506ab08718a7f` |
| `Muller-0.1.5-beta.5-x64-setup.exe` | 4,887,248 | `be3dca5e22eb475e60cf15a940c928d46990a5cab862c13268a9a476f491d968` |

| 实机操作 | 结果 | 截图（位于同一交付目录） |
|---|---|---|
| 两个浏览栏名称升序 | 目录为 `1、2、10`；文件为 `1.txt、2.txt、02.txt、10.txt、11.txt、100.txt、image2.txt、image10.txt、第2章-3页.txt、第2章-10页.txt` | `numeric-sort-ascending.jpg` |
| 名称降序 | 目录组与文件组分别完整反转名称顺序，目录仍排在文件之前 | `numeric-sort-descending.jpg` |
| 当前目录搜索 `.txt` | 匹配结果保持相同的自然名称顺序 | `numeric-sort-search.jpg` |
| 顶部地址补全 | 数字目录候选为 `1、2、10` | `numeric-sort-completion.jpg` |

实机验收使用测试包的普通权限 EXE 和独立安全 fixture；NSIS 未执行安装，原生 MFT/USN 索引未在本轮重新探测。beta.4 的 EXE 与安装包哈希已重新核对，与原有记录一致。构建来源固定为上述 release 提交，后续纯文档同步不改变构建来源或产物哈希。

### 发布与回滚

- 自动化门禁、beta.5 构建和实机核验已完成；本条以独立的 release 构建源、产物哈希和实机截图归档。
- 保留 beta.4 EXE、NSIS、manifest 和哈希；本次不向 `master` 晋级，更新的长期分支使用非强制推送。
- 回滚：回退本条实现提交，使用保留的 beta.4；不改写用户文件名或数据。

<a id="bug-0-1-5-003"></a>

## `BUG-0.1.5-003` - 空间视图较小项目列表交互与布局问题

- 原始输入：[01-original-input.md](01-original-input.md#bug-0-1-5-003)；评审：[02-review.md](02-review.md#bug-0-1-5-003)，`Accepted`。
- 状态：`Accepted / planned`，目标 `0.1.5-beta.6`，记录日期 `2026-09-19`。

| 任务 ID | 实现与主要位置 | 状态 |
|---|---|---|
| `BUG-0.1.5-003-T01` | `SpaceSniffer.css` 调整 group-list 选中条内边距、名称弹性列、容量列留白和窄/宽详情栏布局 | `Planned` |
| `BUG-0.1.5-003-T02` | `SpaceSniffer.tsx` 收敛列表选择音效触发，保留键盘选择语义并新增返回地图/上一级入口 | `Planned` |
| `BUG-0.1.5-003-T03` | Space E2E 与组件/样式回归：几何边界、单击音效计数、返回入口和既有预览/导航 | `Planned` |

### 设计与回滚

- 列表行采用 `display:flex`，名称列 `min-width:0; flex:1`，容量列固定不收缩并设置右内边距；选中竖条通过 `box-shadow` 或伪元素绘制在预留的行内边距之外，首字母从可读区域开始。
- 返回按钮放在较小项目详情标题/列表区域，返回时关闭预览和右键菜单并恢复地图焦点；若存在导航历史则沿现有 Space back/up 语义处理，不新增扫描或改变根路径。
- 选择音效仅由列表选择回调或统一选择事件发出一次；全局 pointerdown 对带选择标记的行不再重复触发 action，其他页面和键盘音效保持现状。
- 回滚为普通反向提交；不修改扫描数据、文件名、文件操作或 MFT/USN 提供方。
