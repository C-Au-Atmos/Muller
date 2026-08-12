# Stage 7.9 - Windows 文件管理交互与 Duplicate 工作流验收报告

日期：2026-07-25

状态：Stage 7.9.0-7.9.6 实现和自动化验收完成。Stage 7.9.7 已完成本机 release
与原生启动验证，物理显示、慢速存储和真实媒体矩阵仍待人工验收。

## 交付结果

### Explorer 选择、Masonry 与动画闭环

- Browse、Album 和 Duplicate 使用稳定路径键、焦点、锚点和选择集合；支持普通单击、
  Ctrl 切换、Shift 范围、Ctrl+A、右键保留集合和空白拖拽框选。
- 框选按布局坐标命中虚拟化项目，并在视口边缘持续自动滚动；复制、剪切、回收和
  Duplicate 标记作用于完整选择集合。
- Masonry 上下左右按实际几何邻居导航。半露出目标使用可重定向的弹簧滚动进入最小
  可见范围，不再硬改 `scrollTop`。
- Album 滚动保持应用根节点挂载，数据到达后初始化焦点；选框弹簧不会带动可见图片
  本身滚动或跳动。
- Line Sidebar、Option Wheel 和选择弹簧的 RAF 在重复点击、切换、卸载和重新挂载后
  均可重新启动。

### Windows 导航与路径边界

- 地址栏支持可取消的目录候选、Tab 补全、Enter 提交、Escape 关闭和陈旧响应隔离。
- This PC 是类型化虚拟位置，列出逻辑卷；进入卷后回到普通分页目录会话。
- Tauri 同时注册规范命令 `list_logical_drives` 和旧前端误用的兼容别名
  `list_logical_drivers`，避免升级时前后端协议短暂不一致导致 This PC 无法进入。
- Desktop、Documents、Downloads、Pictures、Music、Videos 和用户目录由 Windows
  Known Folder API 解析，不猜测 C/D 盘位置。
- Favorites 只由用户主动固定并持久化，普通目录不会错误跳到 Favorites。
- Duplicate 扫描根支持原生 GUI 目录选择、多个根和逐项移除，文本路径仍可作为高级
  输入。
- 内部继续使用长路径，所有可见路径统一转换；自动化覆盖 `\\?\` 前缀不出现在
  Shell、预览和文件操作界面。

### Duplicate 性能、决策与清理

- 快速指纹阶段改为有硬上限的并发执行，完整哈希、结果组和最终排序保持确定性；扫描
  期间按稳定组 ID 渐进发送已验证结果。
- 文件行显示创建时间、修改时间、完整可读路径、大小、硬链接和扫描建议。
- KEEP/DUP 是用户决策，不再把扫描建议当最终决定；支持跨组多选、右键标记、采用
  建议、选择全部确认 DUP 和选择全部结果。
- 清理先进入可逐项移除的复核清单，显示数量与预计释放空间；提交前重新协调当前组，
  只移入回收站，并保留逐项失败信息。

46,000 文件基准由
[`stage79_benchmark.rs`](../../../crates/muller-core/examples/stage79_benchmark.rs) 生成 1 KiB
同尺寸临时文件并在结束后清理。2026-07-25 本机结果：

| 场景 | 发现 | 快速指纹 | 总计 |
|---|---:|---:|---:|
| 首次运行，4 线程 | 0.894s | 0.439s | 1.333s |
| warm p50，1 线程控制组 | 0.871s | 1.160s | 2.031s |
| warm p50，4 线程当前实现 | 0.861s | 0.430s | 1.291s |

夹具创建耗时 11.925s；warm 指纹阶段改善 62.6%，超过计划的 25% 门槛。首次运行单独
记录，不能视为受控冷磁盘数据；尚未得到 HDD/冷缓存不回退结论。

### Filters、缩略图与预览

- Filters 从完整后端目录会话聚合当前目录的真实后缀和计数，支持多选、全选和清空，
  过滤发生在分页之前。
- Cubes strip/grid 的产品名称改为 Filmstrip/Large icons；图片可见项加载有界、可取消
  的真实缩略图。
- 图片不再按 4 MiB 源文件大小拒绝。后端解码并缩放后传输，有像素、缓存和取消预算。
- 音频和视频使用本地媒体源；文本预览保留明确截断。切换文件时通过任务 ID 隔离陈旧
  结果。
- 通用元数据包含字节数、时间、Windows 属性和路径；图片读取最多 96 个有界 EXIF
  字段；音频/MP4 包含容器、时长、码率、采样率、声道、位深、常用标签、曲目/碟号，
  并在 8 MiB 预算内显示嵌入封面；媒体运行时补充视频尺寸和时长。
- 真实 WAV 与 TIFF/EXIF 夹具覆盖音频属性和相机字段。

### Flow Border、按钮与 release

- Flow Border 只在 Duplicate owner tab 当前可见时显示扫描态；离开 Duplicate 后一个
  状态提交周期内回到 idle，成功/错误 pulse 不会永久白光高速旋转。
- 发光限制在 2-4px 外缘带，像素检查确认中心内容保持透明且不占用正常工作区。
- 普通按钮计算热区最低 36x36px。Filters、右键菜单、Line Sidebar、Option Wheel、
  Compare 和清理弹窗均纳入 1360x840、760x520、390x844 自动审计；390px Browse
  工具栏改为两行，窄侧栏模式按钮改为纵向。5px 分隔线保留视觉宽度并通过伪元素
  提供 37px 透明拖拽命中带。
- release 主程序继续使用 Windows GUI subsystem，不创建命令行窗口。

## 自动化证据

最终门禁结果：

- `npm.cmd run lint`：零警告；
- `npm.cmd run build`：TypeScript 和 Vite production build 通过；
- `npm.cmd test -- --run`：12 个文件、37 个测试通过；
- `npm.cmd run test:e2e`：23 个 Edge 场景通过；
- `cargo fmt --all -- --check`：通过；
- `cargo clippy --workspace --all-targets -- -D warnings`：通过；
- `cargo test --workspace --no-fail-fast`：77 个测试通过；
- `npm.cmd run tauri build`：release、MSI 和 NSIS 全部成功。

E2E 覆盖动画重复启动、Album 根节点稳定、Masonry 弹簧、地址补全竞态、This PC、
Duplicate Ctrl/Shift/右键决策和清理复核、Flow Border owner 状态，以及三种鼠标热区
视口。Rust 全套执行时发现并修复了一个依赖 Windows 写入时序的 folder diff 夹具，
左右相同文件现在显式对齐修改时间，不再偶发成为 `MetadataOnly`。

## Release 证据

2026-07-25 16:47 重新生成：

- `D:\Muller\.cargo-target\release\muller.exe`，8,210,944 字节；
- `D:\Muller\.cargo-target\release\bundle\msi\Muller_0.1.0_x64_en-US.msi`，
  4,599,808 字节；
- `D:\Muller\.cargo-target\release\bundle\nsis\Muller_0.1.0_x64-setup.exe`，
  3,712,721 字节。

主程序和 NSIS 安装器的 PE `Subsystem` 均为 `2 (Windows GUI)`。最终主程序隐藏启动
4 秒后状态为 Responding，窗口标题为 `Muller`，工作集 26.1 MiB、338 handles；验证
结束后只终止了本轮测试进程。

## 待完成的物理验收

以下项目没有足够证据，因此 Stage 7.9.7 仍保留人工验收状态：

- 受控冷缓存和 HDD/慢速存储 Duplicate 基准，以及低重复混合文件、大文件、首组延迟、
  取消延迟和扫描峰值内存/句柄记录；
- 100%-200% Windows DPI、多显示器、144Hz、reduced motion 和 DWM/WebView2 GPU 实测；
- 原生文件夹选择器、重定向/OneDrive Known Folders、多个物理磁盘和 UNC 路径的人工
  交互；
- 大图片、长音频、长视频连续切换后的内存回落和陈旧播放检查；
- 完整 XMP/IPTC/ICC、详细视频 codec/track/frame-rate/HDR/color 元数据；
- 视频、音频和文档的 Windows Shell 缩略图。当前真实缩略图完整覆盖图片路径。

这些是实机覆盖和后续媒体深度，不影响本报告中已经通过的自动化、release GUI 子系统
以及已交付交互合同。Stage 8 的提权 MFT/USN 索引器仍不属于 Stage 7.9。
