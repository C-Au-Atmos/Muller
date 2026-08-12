# Stage 7.10 - 技术设计、工期评估与交付计划

状态：提案  
评估日期：2026-08-06  
需求基线：[`stage-7.10-ux-requirements.md`](stage-7.10-ux-requirements.md)

## 1. 结论

这 23 项不是一次 CSS 调整，而是 7 个相互依赖的工作包：紧急缺陷、应用偏好与主题、
Explorer 导航、选择与拖放、Windows Shell 视觉、文件管理命令、Compare 视觉与集成。

现有代码已经提供分页目录会话、多选/框选、可取消图片缩略图、媒体预览、地址补全、
目录搜索、安全 transfer 和多种 spring 基础，因此无需从零构建。主要结构性缺口是：

- `Home` 仍属于 `WorkspaceTab`，系统页面与工作标签没有分层；
- `filterOpen`、`uiScale`、`sidebarMode` 等应用偏好混在工作区状态中；
- Filters 通过绝对定位覆盖工作区，Preview 的容器断点不完整；
- List/Grid/Album 的 hover、focus、selection 和 scroll 动画模型不一致；
- 缩略图服务只解码图片，没有 Windows Shell visual provider；
- 用户可见字符串和主题色散落在组件/CSS 中；
- 原生拖放、压缩/解压和 Shell 上下文能力尚无统一适配层。

基线范围预计 **68-103 工程人日**，包含实现、单元/E2E、release 集成和必要文档，
不包含 RAR、定制 Windows OLE 向外拖出适配以及完整物理设备矩阵。建议 2 人执行，
日历工期 **9-13 周**；单人串行约 **14-21 周**。

## 2. 评估口径

- 1 工程人日按 6 小时有效开发时间计算。
- 估时包含方案落地、代码、单元测试、主要 E2E、review 修正和文档同步。
- 工程师假设熟悉 React 19、TypeScript、Tauri 2、Rust 和 Windows API。
- 已存在的目录分页、安全文件操作、图片缩略图和 spring controller 可复用。
- 估时不把 Stage 8 MFT/USN 索引器作为依赖。
- 原生 Shell/拖放估时置信度较低，必须先做 2-3 天技术验证再锁定承诺。

## 3. 当前实现锚点

| 领域 | 当前边界 | 本阶段处理 |
|---|---|---|
| 应用 Shell | `src/App.tsx` | 拆出系统路由、Preferences、布局控制和品牌导航 |
| 标签与持久化 | `src/workspace/workspaceModel.ts`、`useWorkspaceState.ts` | schema v3；Home/Settings 与工作标签分离 |
| 地址与侧栏 | `ExplorerAddressBar.tsx`、`LocationRail.tsx`、OW/LS | 面包屑、可见搜索、提交式侧栏、Classic 树 |
| 目录选择 | `VirtualDirectoryList/Grid.tsx`、selection model | 统一 focus/hover/selection，增加 type-ahead 和 DnD |
| Preview/Filters | `BrowseWorkspace.tsx`、`PreviewPanel.tsx`、`WorkspaceFilterMenu.tsx` | 容器响应式、非覆盖 dock/page |
| 图片缩略图 | `src-tauri/src/thumbnail.rs` | 扩展为 Shell visual 服务并保留图片解码回退 |
| 文件操作 | `file_operations.rs`、`muller-mutate` | 新建、ZIP、终端、剪贴板与 DnD 复用安全合同 |
| 主题与 Diff | `theme.css`、`stage7.css`、Compare/CodeMirror | 语义 token、深浅主题、Codex 类 Diff 色 |
| 音效 | `useInterfaceAudio.ts` | master gain、音量偏好、限幅 |

## 4. 架构设计

### 4.1 系统路由与工作区标签分离

新增应用级路由，不再用一个特殊标签表示 Home：

```ts
type SystemRoute =
  | { kind: "workspace"; tabId: string }
  | { kind: "home" }
  | { kind: "settings"; section?: SettingsSection };

type WorkspaceMode = "browse" | "duplicates" | "compare" | "album";
```

规则：

- `WorkspaceState.tabs` 只保存可执行工作区，`activeTabId` 保留最后活动标签。
- 品牌点击切换到 `{ kind: "home" }`；齿轮或 `Ctrl+,` 切换 Settings。
- 从 Home 选择 Browse/Duplicates/Compare 时恢复当前标签并更新模式，不隐式新增标签。
- 新标签只能由统一 `openWorkspaceTarget(target, disposition)` 入口创建；`disposition`
  为 `current | newTab`，调用方必须显式传入。
- schema v3 迁移时删除旧 `mode: home` 标签，保留其余标签和当前路径；若没有工作标签，
  创建一个 Browse 标签。

此改动同时关闭 MUL-UX-004、019、022 的结构性根因，而不是在 OW 上增加一次性条件。

### 4.2 Preferences 与迁移

应用偏好和会话状态分离：

```ts
interface AppPreferencesV1 {
  version: 1;
  locale: "system" | "zh-CN" | "en-US";
  theme: "system" | "dark" | "light";
  density: "compact" | "standard";
  uiScale: number;              // 80..125
  sidebarMode: "option" | "line" | "classic";
  audioEnabled: boolean;
  audioVolume: number;          // 0..100
  hoverDelayMs: number;         // 0..300
  motion: "system" | "full" | "reduced";
}
```

- 新建 `preferencesModel.ts` 与 `usePreferences.ts`，使用独立版本化 localStorage key。
- 从 `muller.audio.enabled` 和 workspace v2 的 `uiScale/sidebarMode` 一次性迁移。
- `paneRatio`、`previewWidth`、`inspectorWidth` 仍属于工作区布局状态，不迁入设置。
- 所有值通过 parser/clamp 恢复，损坏存储回退默认值而不阻断启动。

Settings 采用普通页面布局，分为 Appearance、Language、Interaction、Sound；不使用
嵌套卡片。主工具栏只保留当前任务操作，低频偏好不再占用首页和地址区。

### 4.3 非覆盖式响应布局

把主内容布局改成明确的 Grid 区域：

```text
application
  header
  workspace: [rail] [content] [filter-dock?]
  status

browse content
  wide:   [pane(s)] [preview-divider] [preview]
  medium: [pane(s)]
          [preview]
  narrow: [pane(s) OR preview-page OR filter-page]
```

实现原则：

- 使用 `ResizeObserver`/container query 观察 `browse-content`，不根据全局 viewport 猜测。
- Filters 成为 `stage7-workspace` 的 Grid 子项；宽屏新增独立列，禁止 `position:absolute`。
- Preview 的 `wide/medium/narrow` 形态由纯状态函数计算，便于单元测试。
- 建议容器阈值：`>=1100px` 右侧 Preview；`760-1099px` 底部 Preview；`<760px`
  Preview/Filters 作为内容页。最终阈值以最小 320px 列宽和截图证据校准。
- 任一面板打开时保留目录 DOM 或保存 focus/scroll anchor，返回后不得重载到顶部。
- 分隔线视觉保持 1-5px，透明命中带至少 32px；不能靠增加可见空白扩大热区。

### 4.4 Explorer 导航合同

#### 地址与搜索

- 将 `ExplorerAddressBar` 拆为 `BreadcrumbAddress` 和 `EditableAddress` 两种模式。
- 面包屑从类型化 location 生成，不直接对 UNC、verbatim path 和 This PC 做字符串 split。
- 可见搜索框放在地址栏右侧，复用 `useDirectoryPane` 的后端 session search。
- `Ctrl+F` 聚焦可见搜索，`Ctrl+L` 编辑地址；Escape 的清空/退出顺序与 Explorer 一致。

#### 键入定位

新增 presentation 无关的 `useTypeAheadLocate`：

```ts
interface TypeAheadQuery {
  prefix: string;
  revision: number;
  startAfter: number | null;
}
```

- 前端维持 1000ms rolling buffer，使用当前 locale case-fold。
- 已加载页先同步命中；未命中时调用后端 session 内的 `locate_directory_entry`，返回稳定
  position/path key，不重新遍历目录。
- 结果进入共享 `revealSelection(position, source)`，由 spring scroll + focus frame 协调。

#### OW/LS/Classic

- OW 的 `wheelTarget` 与 `committedLocation` 分离。滚轮只更新视觉位置；Click/Enter 才提交。
- LS hover 用按钮真实 rect 计算，动画只改变装饰层，不移动点击层。
- Classic 使用可取消的懒加载树节点。展开只改变 tree state，导航必须显式点击 label。
- 所有 rail 使用同一个 `LocationTarget` 与 `openWorkspaceTarget`，禁止各自创建标签。

### 4.5 选择、hover、弹簧与拖放

把视觉状态明确分成四个 key：

```ts
interface DirectoryInteractionState {
  focusedKey: string | null;
  selectedKeys: ReadonlySet<string>;
  hoveredKey: string | null;
  dragTargetKey: string | null;
}
```

- List/Grid/Album 都渲染持久化的 `SelectionIndicator` 和 `HoverIndicator`；指示层用布局坐标，
  不因目标已选而卸载。
- 指示器使用现有 motion spring preset；新增输入直接 retarget 当前动画。
- `hoverDelayMs` 只延迟设置 hovered target，pointer click 和 selection 同步处理。
- 选择框使用均匀 1px 边框，去掉 `inset 2px 0 0` 左条；活动/非活动栏由 focus ring 区分。

内部 DnD 载荷只传稳定键和源 session，不传可伪造路径字符串：

```ts
interface InternalFileDrag {
  sourceSessionId: number;
  sourcePane: "left" | "right";
  entryKeys: string[];
  preferredEffect: "copy" | "move";
}
```

- Drop 时由后端重新解析 keys/path 并执行现有 `transferEntry` 安全链路。
- 拖入使用 Tauri/WebView2 文件 drop 事件，将外部路径规范化后进入同一链路。
- 向 Explorer 拖出先验证 Tauri/WebView2 能否提供 `CF_HDROP`。若不能，建立独立的
  Windows OLE `IDataObject/IDropSource` 适配层；这部分有单独的工期预留。

### 4.6 Windows Shell visual 服务

扩展现有 `thumbnail.rs`，形成单一 `ShellVisualManager`，避免图标、视频封面和文件夹
缩略图各自维护线程池与缓存。

```ts
interface ShellVisualRequest {
  path: string;
  logicalSize: 16 | 20 | 32 | 64 | 128 | 256;
  scaleFactor: number;
  preference: "icon" | "thumbnail" | "thumbnail-or-icon";
  generation: number;
}
```

后端设计：

- Windows 路径优先使用 `IShellItemImageFactory::GetImage`，thumbnail 失败后请求 icon；
  按扩展图标可用 `SHGetFileInfoW` 缓存。
- Shell COM 工作放在专用 STA worker，不占 Tokio/Tauri async worker；并发建议 2-4。
- 结果编码为有界 PNG/WebP；缓存 key 含 canonical identity、mtime、请求尺寸、DPI 与主题。
- 继续保留 `image` crate 回退，视频回退只解码一个有预算的代表帧。
- 文件夹先请求 Shell thumbnail；失败时最多检查 32 个直接子项、选择最多 4 张合成，
  不递归、不跟随 reparse point。
- 前端只为可见项 + 小 overscan 请求；滚动、换目录和卸载立即 cancel generation。
- 初始内存预算建议 64 MiB、最多 160 entries，由真实媒体目录测量后调整。

安全边界：第三方 Shell thumbnail handler 可能慢或异常。首版使用超时、任务隔离和回退；
若实机证明 handler 能拖垮进程，再将 Shell worker 外移为低权限 helper，不在首版预先扩张。

### 4.7 主题、字体与国际化

#### 主题 token

建议深色基线（最终值需对比度实测）：

| Token | Dark | Light | 用途 |
|---|---|---|---|
| `--surface-0` | `#100c17` | `#f5f3f7` | 应用底色 |
| `--surface-1` | `#171020` | `#ffffff` | 工作区 |
| `--surface-2` | `#21172d` | `#ece8f1` | 提升层 |
| `--text-primary` | `#f7f4fa` | `#1d1824` | 主文字 |
| `--text-secondary` | `#d2cadb` | `#4c4455` | 次文字 |
| `--text-muted` | `#9b91a5` | `#706778` | 弱文字 |
| `--border` | `#473b52` | `#cfc7d6` | 普通边框 |
| `--accent` | `#b978f2` | `#76509a` | 品牌/焦点 |
| `--success` | `#55b87a` | `#277a46` | 成功/KEEP |
| `--warning` | `#d7aa58` | `#8a5a00` | 警告/冲突 |
| `--danger` | `#e16b78` | `#a52e3b` | 删除/失败 |
| `--info` | `#6da8e8` | `#2468a2` | 信息/方向 |

紫色负责品牌、焦点和深色表面，不承担所有业务状态。新增 stylelint/ESLint 约束或
token 扫描脚本，阻止组件继续写散落十六进制主题色。

Diff 另设语义 token：`diff-add-bg/gutter/mark`、`diff-delete-*`、`diff-change-*`、
`diff-hunk-*`。新增用绿、删除用红、元数据用琥珀，选择/焦点仍用品牌紫。

字体：普通 UI 使用 `"Segoe UI Variable Text", "Segoe UI", system-ui`；徽标、路径、
数字和 Diff 使用 `"Cascadia Code", "Cascadia Mono", Consolas, monospace`。不再把未
打包的 Inter 放在首位。所有 letter-spacing 保持 0。

#### 国际化

- 采用 `i18next` + `react-i18next`，资源为 `zh-CN`、`en-US` 分域 JSON/TS 文件。
- key 按语义组织，不使用英文原文作为 key；支持 plural、日期和数字格式化。
- Rust 返回 `{ code, params, diagnostic }`，UI 用 code 翻译，日志保留 diagnostic。
- 建立 badge allowlist：`LEFT/RIGHT/KEEP/DUP/SCAN` 等不翻译；未在 allowlist 的用户
  可见裸字符串由 lint/test 报告。

### 4.8 音效

- 在单个 `AudioContext` 中建立 `source -> per-sound gain -> master gain -> compressor -> destination`。
- 把当前约 `0.012-0.028` 的局部峰值校准到更可闻范围，初始目标为当前听感 2-3 倍，
  但最终输出留出至少 6dB headroom。
- `audioVolume` 使用感知曲线而非线性映射；默认 65，旧的 enabled 状态迁移。
- 继续使用 `AudioRateLimiter`，为 master graph 和音量映射补单元测试。

### 4.9 右键菜单与原生文件命令

新增命令集中在 `file_operations.rs`/`muller-mutate`，并复用现有 path guard：

- `create_directory/create_empty_file`：后端生成 Explorer 式唯一名称，返回实际路径，
  前端刷新并进入 inline rename。
- `open_terminal`：优先 Windows Terminal，回退 PowerShell；使用宽字符串参数和明确
  working directory，不拼接可执行命令文本。
- `copy_name/copy_path`：使用 Tauri clipboard 插件或受控 native clipboard；文件名
  和完整路径为两个动作。
- `extract_zip/create_zip`：在 blocking worker 流式处理，有取消 token、文件数/展开
  大小/压缩比预算、Zip Slip 防护和 staging commit。不得直接写最终目标后再处理失败。
- 7z/tar 作为同一 `ArchiveProvider` 的后续 provider；RAR 在授权决定前不进入基线。

菜单根据背景/文件/目录/压缩包/多选生成，动作 registry 同时服务右键菜单和命令面板，
避免两套 enable/disable 规则。

## 5. 单项工期评估

下表为每项独立开发时的估时，存在共享基础设施，不能直接作为最终总工期相加。

| ID | 内容 | 人日 | 置信度 | 主要风险 |
|---|---|---:|---|---|
| 001 | Preview 响应式 | 1-2 | 高 | 容器断点与双栏组合 |
| 002 | Filters dock/page | 1-2 | 高 | 焦点与滚动恢复 |
| 003 | 音量/master gain | 0.5-1 | 高 | 主观响度校准 |
| 004 | 侧栏/标签规则 | 2-3 | 中高 | workspace schema 迁移 |
| 005 | 选择拖放 | 7-12 | 低 | WebView2 外部 DnD/OLE |
| 006 | 字体和亮度 | 2-4 | 高 | 全页面回归 |
| 007 | 按钮语义色 | 2-3 | 高 | 组件硬编码清理 |
| 008 | 搜索/面包屑/type-ahead | 8-12 | 中 | 未加载项定位协议 |
| 009 | 选择框尺寸 | 1-2 | 高 | List/Grid 统一 |
| 010 | zh-CN/en-US | 6-9 | 中 | 大量硬编码和复数/错误 |
| 011 | Diff 配色/字体 | 2-4 | 高 | CodeMirror token 映射 |
| 012 | 深浅主题 | 5-8 | 中 | 透明层和第三方组件 |
| 013 | Shell 图标 | 7-11 | 低 | COM、handler、缓存/DPI |
| 014 | 键盘选择弹簧 | 2-4 | 中高 | 虚拟化重入 |
| 015 | 密度和间距 | 2-4 | 高 | 窄屏热区 |
| 016 | LS 命中错位 | 2-3 | 中 | DPI/resize/动画坐标 |
| 017 | 视频/文件夹缩略图 | 8-14 | 低 | codec、慢 handler、缓存 |
| 018 | 新建/ZIP/终端/复制名 | 8-13 | 中低 | 压缩安全、终端发现 |
| 019 | 品牌返回 Home | 0.5 | 高 | 系统路由依赖 |
| 020 | 已选项 hover 动画 | 2-3 | 高 | 双指示层合成 |
| 021 | 跟随延迟设置 | 1-2 | 高 | 陈旧 timer 清理 |
| 022 | Settings 页面 | 4-6 | 中高 | 偏好迁移 |
| 023 | Classic 左侧栏 | 5-8 | 中 | 树懒加载/UNC/错误节点 |

独立相加为约 **79-131 人日**。合并 Preferences、主题 token、选择指示器、导航模型和
Shell visual 服务后，预计可复用 15%-25% 工作量。

额外条件项：

- 若向 Windows Explorer 拖出必须自研 OLE adapter：增加 **5-8 人日**。
- 若 7z/tar 必须与 ZIP 同版交付：增加 **4-7 人日**；RAR 另评授权和打包。
- 若 Shell thumbnail handler 必须进独立 helper 进程：增加 **6-10 人日**。

## 6. 分阶段交付

| 阶段 | 范围 | 对应问题 | 人日 | 退出条件 |
|---|---|---|---:|---|
| 7.10.0 | 窄屏/Filters/OW/LS 热修与音量 | 1,2,3,4,16,19 | 7-10 | P0 回归、标签不增长、无覆盖 |
| 7.10.1 | 系统路由、Settings、i18n、主题/字体/密度基础 | 6,7,10,12,15,21,22 | 13-18 | schema 迁移、双语/双主题核心页通过 |
| 7.10.2 | 面包屑、可见搜索、type-ahead、Classic rail | 8,23 | 9-13 | Explorer 导航合同和 100k 会话定位通过 |
| 7.10.3 | 选择视觉、键盘弹簧、内部/拖入 DnD | 5,9,14,20 | 10-16 | 输入/虚拟化/DnD 安全矩阵通过 |
| 7.10.4 | Shell 图标、视频/文件夹缩略图 | 13,17 | 10-16 | COM/cache/cancel/真实媒体通过 |
| 7.10.5 | 新建、ZIP、终端、复制文件名 | 18 | 7-11 | 恶意 ZIP、冲突、取消、终端实测通过 |
| 7.10.6 | Compare 视觉、全矩阵集成与 release | 11 及全局 | 7-10 | 自动化、release、DPI/主题/语言矩阵通过 |

合并范围为 **63-94 人日**，再预留 **5-9 人日**进行 Windows 实机、性能修正和 release
收尾，总计 **68-103 人日**。

### 推荐顺序与并行关系

```text
7.10.0 热修
   |
   +--> 7.10.1 系统路由 / Preferences / token / i18n
            |-----------------------------|
            v                             v
       7.10.2 导航                    7.10.4 Shell visual
            |                             |
            v                             +--> 7.10.5 文件命令
       7.10.3 选择 / DnD                   |
            |-----------------------------|
                          v
                    7.10.6 集成验收
```

- 7.10.0 可立即开始，不等待大规模视觉设计。
- 7.10.1 必须先稳定 schema、token 和设置入口，后续所有页面才能避免重复迁移。
- 7.10.2/7.10.3 由前端主导；7.10.4/7.10.5 由 Rust/Windows 主导，可并行。
- 7.10.6 不是末尾才开始测试；它只负责完整矩阵关闭和 release 证据。

### 人员与日历建议

以 2026-08-10 开始为示例：

| 配置 | 日历工期 | 建议 |
|---|---:|---|
| 1 名全栈 | 14-21 周 | 可执行但原生能力与 UI 互相阻塞，风险最高 |
| 1 名前端 + 1 名 Rust/Windows | 9-13 周 | 推荐；第 3 周后分两条线并行 |
| 2 名前端 + 1 名 Rust/Windows | 8-11 周 | 适合要求更早交付，但集成/评审仍是串行瓶颈 |

推荐双人里程碑：

- 第 1-2 周（8/10-8/21）：7.10.0、系统路由/Preferences spike、Shell COM spike。
- 第 3-5 周（8/24-9/11）：主题/i18n/Settings；导航、搜索和 Classic rail。
- 第 4-7 周（8/31-9/25）：Shell visual、选择视觉、type-ahead、内部/拖入 DnD。
- 第 7-9 周（9/21-10/9）：ZIP/终端/新建、Compare 视觉、双主题/双语收口。
- 第 10-13 周（10/12-11/6）：OLE 条件项、真实媒体、DPI/144Hz、release 修正缓冲。

日期是容量规划，不是承诺；7.10.0 通过后应基于两个原生 spike 重新校准后半程。

## 7. 测试与验收设计

### 7.1 自动化矩阵

- 视口：760x520、900x700、1360x840、1600x1000、3840x2160。
- 主题：Dark、Light；System 由媒体查询模拟。
- 语言：zh-CN、en-US；检查文本溢出和资源缺失。
- 密度：Compact、Standard；DPI 模拟 100%、125%、150%、200%。
- 输入：鼠标、触控板滚轮、键盘、reduced motion。

关键新增 E2E：

- Preview/Filters 与目录 bounding boxes 不相交；面板返回后 scroll/focus 恢复。
- OW 连续滚动不会触发 navigation/add-tab；Home/Settings 单例。
- LS 每个按钮视觉 rect 与点击结果一致。
- 键入定位覆盖已加载、未加载、循环匹配、IME 和快速输入。
- hover 框跨选中/未选项目保持单实例且可 retarget。
- 主题/语言切换不重建目录 session，不丢选择。
- ZIP Slip、压缩炸弹预算、取消和 conflict staging 使用 Rust 夹具验证。

### 7.2 性能预算

- 100,000 项目录滚动只请求可见窗口 + overscan 的 visuals；Shell 并发不超过配置上限。
- Shell visual 内存 cache 默认不超过 64 MiB，取消后陈旧结果不得写回活动 generation。
- type-ahead 前端输入到目标提交 p95 <50ms；后端未加载项定位单独记录。
- 扫描/滚动主线程任务 p95 继续满足现有 3ms 目标。
- 连续切换 100 个视频/目录缩略图后，内存回落到缓存预算附近。

### 7.3 实机门槛

- Tauri release，不以浏览器模式代替 Shell/拖放/终端验收。
- Windows 11，100%-200% DPI，至少一个多显示器场景和一个 144Hz 场景。
- SSD 真实混合目录、慢速存储、OneDrive/重定向 Known Folder、多个卷、UNC 长路径。
- 系统有/无 Windows Terminal、有/无第三方 thumbnail handler 的回退行为。

## 8. 风险与控制

| 风险 | 等级 | 控制 |
|---|---|---|
| WebView2 不支持合格的向外文件拖出 | 高 | 第 1-2 周 spike；失败则启用独立 OLE 条件项 |
| 第三方 Shell handler 卡顿或崩溃 | 高 | STA 隔离、超时、并发上限、fallback；必要时 helper 进程 |
| i18n 改造导致字符串遗漏 | 中高 | 资源 key 检查、允许列表、双语截图、错误码协议 |
| 浅色主题暴露硬编码透明色 | 中高 | 先建 token，CSS 色扫描，逐页面截图关闭 |
| 拖放绕过安全 mutation 合同 | 极高 | Drop 只产生意图，后端重验并调用现有 transfer |
| 解压路径逃逸或压缩炸弹 | 极高 | canonical target、条目/展开大小/压缩比上限、staging commit |
| 系统路由迁移丢失用户标签 | 高 | schema fixture、旧 v1/v2 快照、失败回退并保留原 storage |
| Classic 树递归加载拖慢 UI | 中 | 懒加载、分页、取消、节点级错误，不预扫整树 |
| 高密度布局降低可点击性 | 中 | 视觉尺寸与透明 hit target 分离，自动审计最小热区 |

## 9. 开发前必须完成的两个 spike

1. **Windows DnD spike（2-3 人日）**：验证 Tauri/WebView2 的 Explorer 拖入、Muller
   内部拖放以及向 Explorer 提供 `CF_HDROP` 的能力，输出是否需要 OLE adapter 的结论。
2. **Shell visual spike（2-3 人日）**：在专用 STA 上验证 `IShellItemImageFactory` 对
   EXE/PDF/Office/MP4/文件夹的结果、取消/超时和 release 打包行为，确定缓存格式与失败边界。

两个 spike 都应提交可运行夹具、耗时/内存记录和失败格式清单，不能只提交 API demo。

## 10. 排期基线与变更规则

- 7.10 基线包含 ZIP，不包含 RAR；包含内部和 Explorer 拖入，向 Explorer 拖出以 spike
  结果决定是否追加条件项。
- 新增格式、递归搜索、Office/PDF 预览、网络位置高级功能或 helper 进程视为范围变更。
- 每个子阶段只有在需求文档对应 ID 的验收证据附齐后才能关闭。
- 7.10.0 完成及两个 spike 得出结论后更新一次剩余工期；7.10.4 完成后再更新最终 release
  日期。不得用“已有组件代码”替代真实 Windows release 验收。
