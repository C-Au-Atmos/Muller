# Muller V0.1.5 执行计划

## 文档信息

| 字段 | 值 |
|---|---|
| 目标版本 | `V0.1.5` |
| 实现分支 | `feat/0.1.5` |
| 候选分支 | `release/0.1.5`（首次测试包已生成；空间回归待修复重打包） |
| 文档状态 | `Complete` |
| 技术负责人 | `Codex` |
| 最后更新 | `2026-09-13` |

## 执行索引

| 条目 ID | 评审结论 | 实现负责人 | 状态 | 主要交付物 | 验证状态 |
|---|---|---|---|---|---|
| `REQ-0.1.5-001` | `Accepted` | `Codex` | `Done` | V0.1.5 分支基线、旧分支归档标签、历史索引 | `Passed` |
| `REQ-0.1.5-002` | `Accepted` | `Codex` | `Done` | 单栏空间扫描测试版、Canvas treemap、钻取、选择和音效 | `Passed` |
| `REQ-0.1.5-003` | `Accepted` | `Codex` | `Done / Follow-up planned` | 空间视图线性布局优化、全链路搜索审计、Everything 级索引服务计划 | `Passed / MFT+USN pending` |
| `REQ-0.1.5-004` | `Accepted` | `Codex` | `First build / space regression fixes pending` | MFT/USN provider、隔离 helper、索引控制及首次测试 EXE/SHA256 | `First build: 147 Rust + 86 frontend + 92 Edge passed; native probe/GUI passed; space blockers found` |

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
| `REQ-0.1.5-003-T05` | MFT+USN 常驻索引服务与权限分离 IPC | 后续 Windows indexer service | `Planned` | 后续需求和基准 |

### 搜索性能分级结论

- `current`：已枚举目录会话上的线性过滤，适合当前目录；不是全盘索引。
- `recursive`：每次查询重新 DFS 读取目录元数据，属于可取消降级路径。
- `global`：最多 5 分钟 TTL 的进程内递归快照，首次/过期需重新 DFS，过滤仍为 `O(N)`。
- `Home` / `Compare`：复用 global 或 directory pane，因此继承同样的性能边界。
- `Duplicates`：WalkDir + 分阶段哈希和已完成分组内过滤，属于内容重复检测，不是文件名即时搜索。
- Everything 级目标：当前未满足；缺少 MFT 初建、USN Journal 增量、持久化/倒排索引、常驻服务和本地 IPC。

### 后续计划

Windows 专用索引服务负责 MFT 初始枚举和 USN Journal 增量维护，普通权限 GUI 通过受 ACL 保护的命名管道查询；服务不可用时继续回退到现有可取消遍历。服务实现前不对“Everything 级”做性能承诺。

<a id="req-0-1-5-004"></a>

## `REQ-0.1.5-004` - 实现 MFT/USN 原生索引并交付测试版 EXE

- 状态：T01-T05 完成首次构建验证；T06 首次构建完成，空间回归的阻断修复和重新打包待完成。评审 Accepted，首次 EXE 保留为验证证据。
- 追踪：[`01-original-input.md#req-0-1-5-004`](01-original-input.md#req-0-1-5-004)、[`02-review.md#req-0-1-5-004`](02-review.md#req-0-1-5-004)。
- T01：实现 Windows MFT/USN 卷 provider、file ID 树、增量重放和日志恢复，覆盖二进制解析边界和生命周期测试。
- T02：实现同 EXE 提权索引进程、本机用户受限命名管道、普通权限 GUI 查询与状态协议。
- T03：接通 Browse/Home/Compare 全盘搜索，复用结果分页、筛选和取消；内存查询及按页元数据加载。
- T04：增加原生索引启用入口和实际状态，明确降级原因；保留已有空间视图。
- T05：测试 fmt/test/clippy、lint/frontend/build、Edge E2E；执行真实 NTFS 枚举与变更验证并记录性能证据。
- T06（首次构建完成，重打包待完成）：从 master 基线建立 release/0.1.5，合入已验证 feat/0.1.5；更新测试版元数据，构建独立 GUI EXE，并生成 manifest、SHA256、中文运行说明及真实探针报告。人工空间回归的两项缺陷修复后，重新执行门禁与实机验收并生成新的 EXE/哈希。文档通过 req → feat → release 同步，远端分支按相同顺序非强制推送；master 不参与此次测试版交付。
- 回滚：停止按需索引进程并回退原生索引相关提交；不改写文件内容和现有系统 USN 日志，不强制推送。

### 实现及门禁证据（2026-09-13）

- `src-tauri/src/ntfs.rs`：真实 MFT 枚举、枚举前水位、USN 有界重放、日志断档失效、目录父链、Unicode/重解析点和根范围测试。
- `src-tauri/src/native_broker.rs`：同 EXE 按需 helper、当前用户/SYSTEM ACL、medium integrity、本机限制、双向 PID 校验、有界帧和超时、每秒增量维护、取消及四份分页缓存。
- `src-tauri/src/explorer.rs`：global/recursive 优先原生索引，失败回退；分页/选中条目补充元数据放到后台线程。Portable 查询复用内存，所有根覆盖和过期检查，取消保留旧快照。
- `NativeIndexerControl`：全局入口、启用/停止、实际引擎/状态/计数/原因、中英文 Platinum 样式及硬链接范围说明。
- 检查：147 个 Rust tests passed（另 1 个需提权的 direct provider test ignored，由真实 helper 探针补充）；86 个前端 tests、92 个 Edge E2E 通过；lint、build、fmt、clippy 通过。
- 调试 EXE 原生探针：F 盘 20,387 条，初建含启动/授权 2,047 ms，首个查询 16.675 ms，四类 USN 变化验证共 4,147 ms；报告 `native-probe-debug.json` 随测试包保存。
- 首次构建测试 EXE 原生探针：D 盘 169,001 条，初建含启动/授权 2,717 ms，首次查询含 IPC 15.9 ms，四类 USN 变化验证共 4,163 ms；`native-probe-release-D.json` 的 `passed` 为 `true`。
- 首次构建 GUI 实机启用：5 个磁盘、2,099,823 条记录就绪，截图 `native-index-ready.jpg` 随测试包保存。
- 首次构建 GUI 全盘搜索：从 C 盘浏览页面切换全盘搜索，查询 `Muller-0.1.5-beta.1-x64.exe`，返回 D 盘的测试版 EXE 与 C 盘 prefetch 名称匹配项；截图 `native-global-search.jpg` 随测试包保存。
- 空间视图实机验证：打开 `D:\Muller\release`，206 MB、4 个文件夹完成渲染；单击 beta 目录后显示白色选中边框和对应属性。

### 首次测试版构建记录（2026-09-13，待修复后重打包）

本地独立 EXE 测试包目录：`D:\Muller\release\0.1.5-beta.1`。二进制、探针 JSON 和实机截图在测试包中保存，下面固化其来源与结果。

### 构建与校验

| 项目 | 值 |
|---|---|
| 文件 | `Muller-0.1.5-beta.1-x64.exe` |
| 版本 | `0.1.5-beta.1` |
| 源分支 | `release/0.1.5` |
| 构建源提交 | `d3894ff69bfa73b69edd58c5ad590ee1e02ddd8f` |
| 构建时间 | `2026-09-13T13:09:56.0060274+08:00` |
| 大小 | 11,192,320 字节 |
| SHA256 | `f54f8d0c745752124d33362730af3953d23b2e37cb342bce5df84bf850de17e6` |
| 清单与说明 | `manifest.json`、`SHA256SUMS.txt`、`README.zh-CN.txt` |

版本提升遵循 req/0.1.5 → feat/0.1.5 → release/0.1.5。本次交付不向 master 提升；后续文档同步提交不改变上述 EXE 的构建源提交。

### 验证结果

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
| GUI 全盘搜索 | C 盘浏览页面的全盘搜索返回 D 盘测试版 EXE；证据 `native-global-search.jpg` |
| GUI 空间视图 | `D:\Muller\release` 的 206 MB、4 个文件夹渲染；单击 beta 目录白色选框与属性正常。后续钻取及中间级面包屑回归发现阻断缺陷，最终验收待修复 |

首次构建 EXE 探针报告为 `native-probe-release-D.json`，引擎 `ntfs-mft-usn`，`passed: true`。早期调试版 F 盘样本保存在 `native-probe-debug.json`：20,387 条记录，含启动/授权初建 2,047 ms、查询 16.675 ms；正式测试版的结论以首次构建 EXE 报告为准。

### 发布阻断与重验清单

- 文件节点遗漏：`src-tauri/src/space_sniffer.rs` 的文件 `Work::Enter` 未安排 `Exit`，未发送文件 Batch，导致钻取到仅包含文件的目录时显示 0 项。待修复并补充扫描及显示回归。
- 中间层面包屑无动作：`src/features/space/SpaceSniffer.tsx` 仅在面包屑索引为 0 时导航。待修复并补充至少三层目录的中间级点击回归。
- 上述修复在 `feat/0.1.5` 实现和验证，再提升至 `release/0.1.5`，重建测试 EXE、重新计算哈希、执行实际空间钻取/返回以及原生搜索冒烟验证后，更新本记录的最终交付状态。首次构建的原生 MFT/USN 证据继续保留。

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
