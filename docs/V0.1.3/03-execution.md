# Muller V0.1.3 执行计划

## 文档信息

| 字段 | 值 |
|---|---|
| 目标版本 | `V0.1.3` |
| 实现分支 | `feat/0.1.3` |
| 候选分支 | `release/0.1.3` |
| 文档状态 | `In progress` |
| 技术负责人 | `ChenXingYe` |
| 最后更新 | `2026-08-24` |

## 执行规则

- 本文只接收 [`02-review.md`](02-review.md) 中结论为 `Accepted` 的条目。
- 前三项生命周期需求的实现、测试、提交和 PR 使用 `REQ-0.1.3-001` 至
  `REQ-0.1.3-003`，debug 日志体系使用 `REQ-0.1.3-004`，本次浏览搜索输入法
  修复使用 `BUG-0.1.3-001`；
  `MUL-LIFE-001` 至 `MUL-LIFE-003` 只作为前三项的 Stage 7.11 历史追踪 ID。
- 当前代码工作树已存在生命周期实现，但本计划不把“代码存在”等同于“完成”；
  必须在全部必要文件纳入版本控制、自动化检查和 Windows 实机验收后更新状态。
- `src-tauri/src/lifecycle.rs`、`src-tauri/src/startup_gate.rs`、
  `src-tauri/installer.nsh` 和 `src/features/lifecycle/` 当前为未跟踪交付物，合入前
  必须纳入对应实现提交；`.vs/` 不属于交付范围。

## 执行索引

| 条目 ID | 历史 ID | 评审结论 | 实现负责人 | 状态 | 主要交付物 | 验证状态 |
|---|---|---|---|---|---|---|
| `REQ-0.1.3-001` | `MUL-LIFE-001` | `Accepted` | `TBD` | `In progress` | 设置 UI、关闭策略、持久化、测试 | `Pending` |
| `REQ-0.1.3-002` | `MUL-LIFE-002` | `Accepted` | `TBD` | `In progress` | 自启动状态、注册表、安装器清理、测试 | `Pending` |
| `REQ-0.1.3-003` | `MUL-LIFE-003` | `Accepted` | `TBD` | `In progress` | 单实例启动门、显示意图、窗口唤出、测试 | `Pending` |
| `REQ-0.1.3-004` | `None` | `Accepted` | `TBD` | `Planned` | 持久日志、级别配置、前端桥接、脱敏、轮转和测试 | `Pending` |
| `BUG-0.1.3-001` | `None` | `Accepted` | `Chen TianHao` | `Planned` | IME 事件保护、最终查询提交、快捷键隔离、测试 | `Pending` |

## 生命周期共同技术合同

### 启动与窗口状态矩阵

| 触发事件 | 主实例状态 | 窗口状态 | 目标结果 |
|---|---|---|---|
| 手动启动 | 不存在 | 不存在 | 创建一个实例，显示并激活主窗口。 |
| 手动启动 | 启动中 | 尚未就绪 | 记录显示意图，就绪后显示，不创建第二实例。 |
| 手动启动 | 运行中 | 隐藏 | 同一实例显示并激活，工作区不重置。 |
| 手动启动 | 运行中 | 最小化 | 同一实例恢复并激活。 |
| 手动启动 | 运行中 | 已显示 | 同一实例置前并激活。 |
| 主窗口关闭请求 | 运行中 | 设置为隐藏 | 隐藏窗口，实例和允许的后台任务继续。 |
| 主窗口关闭请求 | 运行中 | 设置为退出 | 走正常退出流程，不转为隐藏。 |
| 托盘退出 | 运行中 | 任意 | 正常退出，不读取关闭行为设置。 |
| Windows 登录启动 | 不存在 | 不存在 | 创建一个隐藏实例，不抢焦点。 |
| Windows 登录启动 | 已运行 | 任意 | 不创建实例，不改变现有窗口可见性。 |
| 登录启动与手动启动竞态 | 任意 | 任意 | 仅一个实例，手动显示意图优先。 |
| Windows 注销、关机或更新退出 | 运行中 | 任意 | 正常结束，不被隐藏策略阻断。 |

### 共同质量门禁

- [ ] `npm.cmd run lint`
- [ ] `npm.cmd run test`
- [ ] `npm.cmd run build`
- [ ] `cargo fmt --all -- --check`
- [ ] `cargo test --workspace --locked`
- [ ] `cargo clippy --workspace --all-targets --all-features --locked -- -D warnings`
- [ ] `npm.cmd run test:e2e`
- [ ] `npm.cmd run tauri build`，并检查 NSIS 安装器钩子已包含在产物中。
- [ ] Windows 非管理员干净用户完成关闭、自启动、单实例、升级与卸载矩阵。

<a id="req-0-1-3-001"></a>

## `REQ-0.1.3-001` - 关闭主窗口行为可选

### 追踪关系

- 原始输入：[`01-original-input.md#req-0-1-3-001`](01-original-input.md#req-0-1-3-001)
- 评审记录：[`02-review.md#req-0-1-3-001`](02-review.md#req-0-1-3-001)
- 历史 ID：`MUL-LIFE-001`
- 关联 Issue/PR：`TBD`
- 实现提交：`298a6af` 包含部分已跟踪接线；完整实现提交 `TBD`

### 技术设计

- 目标行为：Settings 在“隐藏到系统托盘”和“退出 Muller”之间切换；下一次主
  窗口关闭请求立即采用已成功持久化的值，所有等价关闭入口一致，托盘退出保持
  无条件退出。
- 技术栈：React 19、TypeScript、Tauri 2 command/window event、Rust、JSON
  配置和现有 i18n。
- 修改范围：`src/features/settings/SettingsPage.tsx`、
  `src/features/lifecycle/lifecycleClient.ts`、`src/preferences/`、`src/i18n/`、
  `src-tauri/src/lifecycle.rs`、`src-tauri/src/lib.rs`、对应单元测试和 `e2e/`。
- 接口与数据流：Settings -> `set_close_behavior` command -> 原生层先写入
  `app_config_dir/lifecycle.json` -> 写入成功后更新内存状态；主窗口
  `CloseRequested` 读取内存状态，`hide` 时阻止关闭并隐藏，`quit` 时允许正常退出。
- 兼容与迁移：默认 `hide`；兼容历史枚举别名；未知值、损坏 JSON 或读取失败回退
  为 `hide`。WebView 偏好用于 UI，不作为原生关闭事件的唯一权威来源。
- 性能预算：关闭事件不执行磁盘写入，只读取内存值；设置命令为低频小文件 I/O，
  目标是无可感知 UI 卡顿。
- 错误处理：持久化失败时 command 返回结构化错误，UI 保留上一个选择并显示本地化
  错误；不得因设置损坏阻止应用启动。
- 明确不做：退出确认、最小化语义修改、子窗口统一关闭、失焦隐藏、后台任务合同
  重设计。

### 实现任务

| 任务 ID | 工作内容 | 位置 | 负责人 | 前置依赖 | 状态 |
|---|---|---|---|---|---|
| `REQ-0.1.3-001-T01` | 完成关闭行为默认值、兼容解析、原生持久化和 command，并将未跟踪原生模块纳入提交。 | `src-tauri/src/lifecycle.rs`、`src-tauri/src/lib.rs` | `TBD` | None | `In progress` |
| `REQ-0.1.3-001-T02` | 完成设置分组、二选一控件、中英文文案、忙碌与错误回滚，并将生命周期 client 纳入提交。 | `src/features/settings/`、`src/features/lifecycle/`、`src/preferences/`、`src/i18n/` | `TBD` | T01 | `In progress` |
| `REQ-0.1.3-001-T03` | 覆盖偏好损坏、写入失败、恢复默认和关闭入口一致性测试。 | `src/**/*.test.ts`、`src-tauri/src/lifecycle.rs`、`e2e/` | `TBD` | T01、T02 | `Planned` |
| `REQ-0.1.3-001-T04` | 在 Windows 安装版验证隐藏、退出、托盘退出、注销、关机和更新退出矩阵。 | Windows 发布包 | `TBD` | T03 | `Planned` |

### 验证计划

- [ ] 单元测试：默认 `hide`、历史别名、未知值和损坏 JSON 回退、先持久化后生效、
  command 错误规范化、设置 UI 回滚。
- [ ] Rust/集成测试：主窗口 `CloseRequested` 的 `hide/quit` 分支；非主窗口不受影响；
  正常退出事件不被隐藏逻辑拦截。
- [ ] Edge E2E：设置页切换和恢复默认；mock 原生命令失败时保持之前选择并显示错误。
- [ ] 性能检查：关闭事件无磁盘 I/O，设置写入不阻塞动画和交互。
- [ ] 人工验证：Windows 10/11 非管理员用户，分别通过 `X`、`Alt+F4`、任务栏关闭
  测试两种策略；验证托盘和 `Ctrl+Shift+Space` 恢复同一窗口。
- [ ] 回归范围：托盘左键与菜单、全局快捷键、工作区状态、扫描和文件操作、视觉和
  音频挂起、最小化、注销与关机。

### 发布与回滚

- 配置或迁移步骤：首次启动缺少原生设置时写入或使用默认 `hide`；不要求用户手工
  迁移。恢复默认同时调用原生命令，不能只重置 WebView 偏好。
- 发布观察项：关闭行为读取/写入错误、退出后残留进程、重复托盘图标、用户无法
  恢复窗口的反馈。
- 回滚触发条件：关闭策略导致无法正常退出、注销/关机被阻断、设置损坏阻止启动，
  或隐藏时丢失工作区/任务状态。
- 回滚步骤：回退设置 UI 和原生命令接线，恢复已验证的“关闭请求固定隐藏、托盘
  Quit 正常退出”行为；保留设置文件但按默认 `hide` 忽略新增值。

### 完成证据

| 日期 | 提交/PR | 检查结果 | 记录人 |
|---|---|---|---|
| TBD | TBD | 自动化与 Windows 实机证据待补充 | `TBD` |

<a id="req-0-1-3-002"></a>

## `REQ-0.1.3-002` - 当前用户登录时自动启动

### 追踪关系

- 原始输入：[`01-original-input.md#req-0-1-3-002`](01-original-input.md#req-0-1-3-002)
- 评审记录：[`02-review.md#req-0-1-3-002`](02-review.md#req-0-1-3-002)
- 历史 ID：`MUL-LIFE-002`
- 关联 Issue/PR：`TBD`
- 实现提交：`298a6af` 包含部分已跟踪接线；完整实现提交 `TBD`

### 技术设计

- 目标行为：用户可立即启用或停用当前 Windows 用户登录自启动；开关显示注册表
  实际状态；登录启动隐藏且不抢焦点；升级刷新有效路径；卸载清理自建条目。
- 技术栈：React/TypeScript、Tauri 2 command、Rust `winreg`、Windows HKCU
  `Run`/`StartupApproved`、NSIS installer hook。
- 修改范围：`src/features/settings/`、`src/features/lifecycle/`、
  `src/preferences/`、`src/i18n/`、`src-tauri/src/lifecycle.rs`、
  `src-tauri/src/lib.rs`、`src-tauri/tauri.conf.json`、`src-tauri/installer.nsh`。
- 接口与数据流：设置页通过 `get_autostart_status` 读取状态，通过
  `set_autostart_enabled` 写入或删除当前用户 `Run\\Muller`，随后重新读取 `Run` 与
  `StartupApproved`，把实际状态和结构化错误返回 UI；启动命令为带引号的当前 exe
  路径加 `--autostart`，原生启动路径据此把初始窗口设为隐藏且不聚焦。
- 兼容与迁移：启动时若自启动仍启用，刷新注册命令到当前 exe 路径；`StartupApproved`
  明确禁用时不得重新开启；卸载同时删除 Muller 的 Run 与 StartupApproved 值。
- 性能预算：注册表只在设置读取/切换和启动刷新时访问；登录启动不得显示初始窗口
  或抢焦点，不额外创建第二进程。
- 错误处理：写入、删除或状态读取失败时返回实际可确认的状态与错误码；UI 回滚，
  应用继续运行；不得显示虚假的“已开启”。
- 明确不做：HKLM/所有用户自启动、管理员权限、计划任务、看门狗、退出后自启、
  安装器 UI 重设计。

### 实现任务

| 任务 ID | 工作内容 | 位置 | 负责人 | 前置依赖 | 状态 |
|---|---|---|---|---|---|
| `REQ-0.1.3-002-T01` | 完成当前用户 Run/StartupApproved 的读取、写入、删除、状态调和和路径刷新，并将原生模块纳入提交。 | `src-tauri/src/lifecycle.rs` | `TBD` | None | `In progress` |
| `REQ-0.1.3-002-T02` | 完成前端状态 client、设置开关、中英文错误、实际状态回滚，并将 client 文件纳入提交。 | `src/features/lifecycle/`、`src/features/settings/`、`src/i18n/` | `TBD` | T01 | `In progress` |
| `REQ-0.1.3-002-T03` | 完成 `--autostart` 隐藏/不聚焦启动与手动显示优先的数据流。 | `src-tauri/src/lib.rs`、`src-tauri/src/lifecycle.rs` | `TBD` | `REQ-0.1.3-003-T01` | `In progress` |
| `REQ-0.1.3-002-T04` | 完成 NSIS 卸载清理，确保钩子进入打包产物，并将未跟踪钩子纳入提交。 | `src-tauri/installer.nsh`、`src-tauri/tauri.conf.json` | `TBD` | T01 | `In progress` |
| `REQ-0.1.3-002-T05` | 在非管理员干净 Windows 用户验证启停、登录、外部禁用、竞态、升级和卸载。 | Windows 发布包与测试账号 | `TBD` | T01-T04 | `Planned` |

### 验证计划

- [ ] 单元测试：路径含空格/Unicode 时正确引用；`--autostart` 识别；12 字节
  StartupApproved 启用/禁用/损坏状态；设置失败后实际状态优先；前端错误规范化。
- [ ] Rust/集成测试：注册/注销幂等、当前用户范围、启动时路径刷新、后台意图不会
  隐藏已运行窗口、手动显示意图优先。
- [ ] Edge E2E：设置开关初始状态、切换、失败回滚、恢复默认；mock 不替代实机
  注册表和登录测试。
- [ ] 性能检查：登录启动过程中无窗口闪现或焦点抢占；启动注册刷新不造成明显延迟。
- [ ] 人工验证：Windows 10/11 非管理员干净用户，读取 HKCU 实际值，完成重新登录、
  与手动启动竞态、升级安装、卸载清理；测试结束关闭开关并确认恢复环境。
- [ ] 回归范围：普通手动启动、托盘、全局快捷键、单实例、恢复默认、安装和卸载。

### 发布与回滚

- 配置或迁移步骤：默认不创建注册项；用户开启后使用当前 exe 路径；升级启动刷新
  已启用项；卸载执行 NSIS 清理。
- 发布观察项：自启动 command/状态错误码、失效或重复注册项、登录窗口闪现、重复
  实例/托盘图标、卸载残留。
- 回滚触发条件：开关与实际状态持续不一致、登录循环启动、错误抢焦点、升级后路径
  失效或卸载无法清理。
- 回滚步骤：在应用和卸载器中删除 Muller 自建的 Run/StartupApproved 值，移除设置
  入口和登录启动参数接线；不触碰其他应用或其他用户的注册项。

### 完成证据

| 日期 | 提交/PR | 检查结果 | 记录人 |
|---|---|---|---|
| TBD | TBD | 自动化、打包与 Windows 登录/卸载证据待补充 | `TBD` |

<a id="req-0-1-3-003"></a>

## `REQ-0.1.3-003` - 单实例与桌面图标唤出

### 追踪关系

- 原始输入：[`01-original-input.md#req-0-1-3-003`](01-original-input.md#req-0-1-3-003)
- 评审记录：[`02-review.md#req-0-1-3-003`](02-review.md#req-0-1-3-003)
- 历史 ID：`MUL-LIFE-003`
- 关联 Issue/PR：`TBD`
- 实现提交：`298a6af` 包含部分已跟踪接线；完整实现提交 `TBD`

### 技术设计

- 目标行为：每个 Windows 用户交互会话最多一个 Muller 主实例；手动二次启动只
  请求既有实例显示并激活主窗口，登录二次启动不改变既有窗口；启动竞态不丢失
  手动显示意图。
- 技术栈：Rust、Tauri 2、`tauri-plugin-single-instance`、Windows 命名 mutex、
  WebviewWindow show/unminimize/focus API。
- 修改范围：`src-tauri/src/startup_gate.rs`、`src-tauri/src/lifecycle.rs`、
  `src-tauri/src/lib.rs`、`src-tauri/Cargo.toml`、`Cargo.lock` 和 Rust/Windows 多进程测试。
- 接口与数据流：进程进入 `run()` 先取得当前会话命名启动门 -> 注册单实例插件 ->
  主实例完成 setup 后释放启动门；二次手动启动由插件回调发送显示请求，窗口存在时
  show/unminimize/focus，不存在时记录 `pending_show`，setup 后一次性消费。携带
  `--autostart` 的二次启动不发送显示请求。
- 兼容与迁移：单实例无设置迁移，始终启用；命名启动门通过进程句柄生命周期和
  RAII 释放，异常退出后下一实例可获得；不同 Windows 用户会话不互相接管。
- 性能预算：启动门只串行化建立单实例端点的短暂初始化窗口；记录健康实例从收到
  请求到可见并激活的耗时，以实测参考设备、边界和样本确定发布门槛。
- 错误处理：主实例无响应时不创建第二个可写工作区；窗口尚未创建时保存显示意图；
  Windows 拒绝抢焦点时至少显示窗口并通过任务栏请求注意。
- 明确不做：多主实例、多窗口工作区、文件/深链接转发、按进程名匹配、无响应实例
  强制重启 UI。

### 实现任务

| 任务 ID | 工作内容 | 位置 | 负责人 | 前置依赖 | 状态 |
|---|---|---|---|---|---|
| `REQ-0.1.3-003-T01` | 接入单实例插件、手动/登录启动意图和主窗口显示回调。 | `src-tauri/Cargo.toml`、`Cargo.lock`、`src-tauri/src/lib.rs` | `TBD` | None | `In progress` |
| `REQ-0.1.3-003-T02` | 完成 Windows 命名启动门和 RAII 释放，将未跟踪模块纳入提交，封闭端点初始化竞态。 | `src-tauri/src/startup_gate.rs`、`src-tauri/src/lib.rs` | `TBD` | T01 | `In progress` |
| `REQ-0.1.3-003-T03` | 完成窗口未就绪时的 pending show、各窗口状态恢复、模态窗口优先和抢焦点降级。 | `src-tauri/src/lifecycle.rs`、`src-tauri/src/lib.rs` | `TBD` | T01、T02 | `In progress` |
| `REQ-0.1.3-003-T04` | 增加启动门单元测试和真实多进程/窗口状态验证，记录唤出耗时基线。 | Rust 测试、Windows 发布包 | `TBD` | T01-T03 | `Planned` |

### 验证计划

- [ ] 单元测试：命名启动门串行化竞争启动；pending show 只消费一次；正确区分手动
  和 `--autostart` 参数；setup 失败和 panic 路径释放门。
- [ ] Rust/集成测试：单实例插件回调、主窗口尚未就绪的二次启动、无响应主实例不
  旁路创建第二工作区、旧实例异常退出后冷启动。
- [ ] Edge E2E：确认唤出后当前路由、标签、选择、输入和后台任务状态不重置；浏览器
  mock 不能替代发布包多进程测试。
- [ ] 性能检查：在记录型号和 Windows 版本的参考设备上，以主实例收到二次启动
  通知到窗口可见/激活为边界采样并确定门槛。
- [ ] 人工验证：隐藏、最小化、后台可见、最大化、模态窗口、首次窗口未就绪、快速
  连续启动 10 次、登录与手动启动竞态、异常结束后重启、前台激活受限场景。
- [ ] 回归范围：托盘 Show/Quit、`Ctrl+Shift+Space`、关闭行为、自启动、主窗口尺寸
  和最大化状态、工作区及运行中任务。

### 发布与回滚

- 配置或迁移步骤：无用户配置；打包必须包含单实例依赖和 Windows 启动门实现。
- 发布观察项：重复主进程/主窗口/托盘图标、二次启动无响应、窗口状态或工作区被
  重置、登录启动抢焦点、命名门等待失败。
- 回滚触发条件：正常冷启动被锁死、异常退出后无法再启动、二次启动造成数据状态
  丢失，或登录和手动启动竞态产生重复可写实例。
- 回滚步骤：回退启动门和单实例接线到上一已验证版本；发布前明确移除自启动入口，
  避免回滚版本在登录时产生重复实例，并保留托盘与全局快捷键恢复路径。

### 完成证据

| 日期 | 提交/PR | 检查结果 | 记录人 |
|---|---|---|---|
| TBD | TBD | 自动化、多进程和唤出性能证据待补充 | `TBD` |

<a id="bug-0-1-3-001"></a>

## `BUG-0.1.3-001` - 浏览模式搜索栏兼容微软拼音和微信输入法

### 追踪关系

- 原始输入：[`01-original-input.md#bug-0-1-3-001`](01-original-input.md#bug-0-1-3-001)
- 评审记录：[`02-review.md#bug-0-1-3-001`](02-review.md#bug-0-1-3-001)
- 历史 ID：`None`
- 来源：`用户上报`
- 评审人：`Chen XingYe`
- 实现负责人：`Chen TianHao`
- 关联 Issue/PR：`TBD`
- 实现提交：`TBD`

### 技术设计

- 目标行为：浏览搜索框在中文输入法组合期间不把候选操作键当作 Muller 命令，
  不查询预编辑文本；组合完成后保留输入焦点，并只用最终文字进入现有搜索调度。
- 技术栈：React 19、TypeScript、标准 DOM Composition Events、Tauri 2
  WebView2、Vitest 和 Playwright/Edge E2E。
- 修改范围：`src/App.tsx`、`src/commands/appCommands.ts`、
  `src/features/explorer/BrowseWorkspace.tsx`、
  `src/features/explorer/DirectorySearchBar.tsx`、
  `src/features/explorer/useDirectoryPane.ts`、对应前端测试和 `e2e/stage710.spec.ts`。
- 输入与查询数据流：`compositionstart` 后由输入框保存组合中状态和预编辑显示，
  预编辑值不调用 pane 的 `setSearchQuery`；组合结束时读取最终输入值，消除相邻
  `input/change` 事件可能造成的重复提交，再把最终查询一次性分发到活动 pane 或
  双 pane，并沿用既有 120 ms 搜索调度。组合期间的受控 value 回写不得覆盖输入法
  管理的预编辑文本、候选状态或光标位置。
- 键盘事件合同：应用级和输入框级 handler 在处理快捷键、调用 `preventDefault` 或
  改变焦点前，先识别标准组合状态及 WebView2 兼容键值 `229`。组合态 `Enter`、
  `Escape` 和其他候选操作键由输入法处理，不得提交、清空、关闭搜索、选择结果、
  移动焦点或取消扫描。
- 搜索模式合同：当前目录、递归和全盘搜索的根目录、过滤、分页、索引和取消语义
  保持不变；双栏搜索只在组合结束后向两栏分发同一个最终查询。共享
  `DirectorySearchBar` 采用相同组合键保护，避免比较和重复结果搜索出现同类冲突。
- 兼容与状态复位：优先使用标准组合事件和 `isComposing`，以 `229` 作为 WebView2
  事件差异的兼容防线；输入框失焦、切换搜索模式、组件卸载或异常结束组合时必须
  清理本地组合状态，但不得丢失已经提交的查询。
- 后端与迁移：不新增或修改 Tauri command、Rust 搜索算法、持久化配置和数据迁移；
  最终 Unicode 文本继续由现有目录 session search 处理。
- 性能预算：组合期间不产生预编辑查询、task/session 取消或重建；最终文字对
  每个目标 pane 最多进入一次既有防抖。普通非组合输入的 120 ms 调度与可感知响应
  不退化。
- 错误处理：陈旧的组合结束事件不得覆盖较新的正式输入；输入框被卸载或模式切换
  时不得留下永久 composing 状态；组合态全局命令一律忽略，普通命令继续按现有
  编辑控件和扫描状态规则处理。
- 明确不做：拼音/五笔模糊匹配、自绘候选窗、输入法品牌检测、Rust 搜索重写、
  搜索排序或索引调整，以及与本缺陷无关的地址编辑器和命令面板重构。

### 实现任务

| 任务 ID | 工作内容 | 位置 | 负责人 | 前置依赖 | 状态 |
|---|---|---|---|---|---|
| `BUG-0.1.3-001-T01` | 建立浏览顶部搜索框的组合状态和最终值提交流程，组合期间隔离 pane 查询，并确保最终查询只提交一次。 | `src/App.tsx`、`src/features/explorer/BrowseWorkspace.tsx`、`src/features/explorer/useDirectoryPane.ts` | `Chen TianHao` | None | `Planned` |
| `BUG-0.1.3-001-T02` | 在输入框与全局键盘路径统一保护组合态和兼容键值 `229`，防止提交、清空、失焦、结果选择或误取消扫描；同步共享搜索框语义。 | `src/App.tsx`、`src/commands/appCommands.ts`、`src/features/explorer/DirectorySearchBar.tsx` | `Chen TianHao` | T01 | `Planned` |
| `BUG-0.1.3-001-T03` | 增加组合状态、事件顺序、最终值去重和普通键盘行为的前端单元/组件测试。 | `src/**/*.test.ts`、必要的输入事件辅助模块 | `Chen TianHao` | T01、T02 | `Planned` |
| `BUG-0.1.3-001-T04` | 扩展 Edge E2E 桌面 mock，覆盖预编辑无查询、候选 Enter/Escape、`229`、三种搜索模式、双栏和扫描并行场景。 | `e2e/stage710.spec.ts`、相关 E2E 夹具 | `Chen TianHao` | T01-T03 | `Planned` |
| `BUG-0.1.3-001-T05` | 使用 Windows Tauri 安装版分别完成微软拼音和微信输入法人工验收，记录环境、产物和结果。 | Windows V0.1.3 候选安装包、人工验证记录 | `Chen TianHao` | T04 | `Planned` |

### 验证计划

- [ ] 单元/组件测试：覆盖 `compositionstart`、预编辑 `input/change`、组合态
  `Enter`/`Escape`、`compositionend`、最终 `input/change`、失焦和卸载顺序；验证
  标准 `isComposing` 与兼容键值 `229`，并断言最终查询不丢失、不重复。
- [ ] Edge E2E：预编辑文本停留超过 120 ms 时，不调用 `search_directory_page`、
  `start_directory_search`、`cancel_directory_query` 或关闭 session，不改变结果和焦点。
- [ ] Edge E2E：组合态 `Enter` 不提交或聚焦首个结果，最终中文上屏后输入框保持
  焦点且只查询最终文字；组合态 `Escape` 不清空、不失焦、不关闭搜索。
- [ ] Edge E2E：扫描运行时在搜索框组合态按 `Escape` 不取消扫描；普通非组合态
  取消扫描、搜索 `Enter`/`Escape` 和全局快捷键仍按现有合同工作。
- [ ] 模式矩阵：当前目录、递归、全盘和双栏搜索在组合期间均不查询，组合结束后
  只收到最终中文；根目录、递归、indexed、过滤、分页和结果提交语义不变。
- [ ] 共享组件回归：比较左右目录搜索和重复结果搜索的候选 `Enter`/`Escape` 不被
  Muller 消费，普通非组合提交/关闭行为保持。
- [ ] 普通输入回归：英文、数字、粘贴、`Ctrl+F`、搜索模式切换和清空操作保持；
  现有 `.fill()` 用例继续通过，但不得把它当作 IME 覆盖。
- [ ] 性能检查：一次组合输入不产生预编辑查询或取消风暴，最终文字对每个目标
  pane 最多进入一次 120 ms 调度；普通输入的搜索请求时序不退化。
- [ ] 自动化质量门禁：`npm.cmd run lint`、`npm.cmd run test`、`npm.cmd run build`、
  `npm.cmd run test:e2e:all` 通过；里程碑晋级时继续执行本文共同质量门禁。
- [ ] Windows 人工验证：在 V0.1.3 候选安装版中，微软拼音和微信输入法各验证
  `Enter` 确认、`Escape` 取消、连续选词、中文最终搜索、三种搜索模式、双栏和扫描
  并行；记录 Windows build、WebView2、输入法版本、安装包版本/哈希和结果。
- [ ] 证据边界：Edge 合成事件自动化用于验证 React/Chromium 事件链，只有上述
  Windows 安装版两款真实输入法验证通过后，才能把人工验收标记为 `Passed`。

### 发布与回滚

- 配置或迁移步骤：无用户配置、数据或原生接口迁移；修复随前端产物进入安装包。
- 发布观察项：候选窗被意外关闭、输入框失焦、预编辑拼音成为查询、最终查询重复
  或缺失、扫描被候选 `Escape` 取消，以及普通键盘搜索行为回归。
- 回滚触发条件：修复导致普通输入无法搜索、最终中文稳定丢失、输入框永久停留在
  组合状态，或全局快捷键在非组合状态下大面积失效。
- 回滚步骤：在 `feat/0.1.3` 回退对应实现提交并保留本缺陷为未完成，不把已知有
  回归的候选版本晋级到 `release/0.1.3`；根据自动化和实机事件日志调整方案后重新
  进入验证，不修改用户配置或 Rust 数据。

### 完成证据

| 日期 | 提交/PR | 检查结果 | 记录人 |
|---|---|---|---|
| TBD | TBD | 自动化、微软拼音与微信输入法 Windows 安装版证据待补充 | `Chen TianHao` |

<a id="req-0-1-3-004"></a>

## `REQ-0.1.3-004` - 新增 debug 日志体系

### 追踪关系

- 原始输入：[`01-original-input.md#req-0-1-3-004`](01-original-input.md#req-0-1-3-004)
- 评审记录：[`02-review.md#req-0-1-3-004`](02-review.md#req-0-1-3-004)
- 历史 ID：`None`
- 来源：`用户紧急需求`
- 关联 Issue/PR：`TBD`
- 实现提交：`TBD`

### 技术设计

- 目标行为：Muller 在 Windows 应用日志目录持久化有级别、可轮转、可脱敏的 Rust
  与前端诊断事件；用户可在 Settings 开启详细 debug 级别并打开日志目录，任何
  日志故障都不得阻断启动或核心文件工作流。
- 技术栈：Rust `log` facade、`tauri-plugin-log` 2、Tauri LogDir、React 19、
  TypeScript 和 Vitest。
- 修改范围：`src-tauri/Cargo.toml`、`Cargo.lock`、
  `src-tauri/src/diagnostics.rs`、`src-tauri/src/lib.rs`、Tauri capability、
  `package.json`/lockfile、`src/diagnostics/`、`src/main.tsx`、Settings、偏好、i18n、
  生命周期与浏览搜索观测点及对应测试。
- 原生数据流：日志插件在其他业务插件前注册，写入 Tauri LogDir；`DiagnosticsState`
  从原生配置读取 debug 开关并结合 debug build 默认值及 `MULLER_LOG` 单次启动覆盖
  设置最大级别；读取/写入设置 command 返回规范化状态，配置损坏回退并重写默认值。
- 前端数据流：`src/diagnostics/` 只接受稳定事件名和字段白名单，规范化 Error/未知
  对象后调用 guest API；`window.error`、`unhandledrejection` 和 React 启动边界接入
  facade，纯浏览器和 E2E mock 缺少 Tauri API 时吞掉桥接失败但保留应用行为。
- 文件与保留：单个日志文件约 5 MiB 后轮转，启动时清理为当前文件加最多 4 个历史
  文件，总预算约 25 MiB；只操作 Muller 自己的日志前缀，不跟随符号链接，不写 exe
  目录。清理失败记录到仍可用 sink 后继续启动。
- 事件与脱敏：`INFO` 记录启动、配置、窗口/自启动/单实例和任务终态；`WARN/ERROR`
  记录降级与失败；`DEBUG` 记录 IME composition、搜索 generation 和状态机边界。
  所有记录只使用模式、布尔值、长度、计数、耗时、错误类别/代码等白名单字段，禁止
  原始路径/文件名、查询词、IME data、文件/剪贴板内容、argv 和 cwd。
- 兼容与迁移：旧安装没有 diagnostics 配置时采用 release `INFO`/debug build
  `DEBUG`，详细 debug 默认为关闭；恢复默认时关闭详细 debug，正常 `INFO` 日志继续。
  新增日志不改变用户工作区、目录 session、搜索或生命周期配置格式。
- 性能预算：`INFO` 不记录每项文件/每次按键；高频事件仅在 `DEBUG/TRACE` 聚合记录，
  不序列化大对象；日志目录总预算约 25 MiB，记录失败不做同步无界重试。
- 错误处理：日志插件、目录、配置或前端桥接失败时回退到可用输出并继续；设置写入
  失败回显原生实际状态；panic/未处理错误只记录清洗后的类别和安全消息。
- 明确不做：远程遥测、自动上传、用户标识、日志查看器/搜索器、问题工单集成、
  文件内容采样、全量 Tauri command 参数记录和无限期日志保留。

### 实现任务

| 任务 ID | 工作内容 | 位置 | 负责人 | 前置依赖 | 状态 |
|---|---|---|---|---|---|
| `REQ-0.1.3-004-T01` | 接入 Tauri 日志插件、LogDir sink、级别/格式、5 MiB 轮转与最多 4 个历史文件清理，并实现原生配置和环境覆盖。 | `src-tauri/Cargo.toml`、`Cargo.lock`、`src-tauri/src/diagnostics.rs`、`src-tauri/src/lib.rs` | `TBD` | None | `Planned` |
| `REQ-0.1.3-004-T02` | 实现前端 diagnostics facade、字段白名单、错误规范化及全局 error/unhandledrejection 桥接，补齐 capability。 | `package.json`、lockfile、`src/diagnostics/`、`src/main.tsx`、`src-tauri/capabilities/` | `TBD` | T01 | `Planned` |
| `REQ-0.1.3-004-T03` | 增加中英文“诊断”设置、详细 debug 开关、实际状态回滚、打开日志目录和恢复默认接线。 | Settings、偏好、i18n、样式 | `TBD` | T01、T02 | `Planned` |
| `REQ-0.1.3-004-T04` | 在启动、窗口关闭/唤出、自启动、单实例、IME composition 和目录搜索调度添加不含用户内容的关键观测事件。 | `src-tauri/src/lib.rs`、`lifecycle.rs`、`src/App.tsx`、Explorer hooks | `TBD` | T01、T02、`BUG-0.1.3-001-T01` | `Planned` |
| `REQ-0.1.3-004-T05` | 增加原生配置/清理、前端脱敏/降级/设置测试，并在 Windows 候选安装版验证目录、重启、轮转和不可写降级。 | Rust/Vitest/E2E、Windows 发布包 | `TBD` | T01-T04 | `Planned` |

### 验证计划

- [ ] 单元测试：原生默认值、配置解析、损坏回退、环境覆盖、文件筛选和保留数量；
  前端字段白名单、Error/未知值规范化、非 Tauri 降级及 debug 设置状态同步。
- [ ] Rust/集成测试：插件先于业务初始化，设置立即变更最大级别并持久化，重启读取，
  配置/日志目录失败不阻止启动，清理只命中 Muller 日志前缀。
- [ ] Edge E2E：Settings debug 开关、错误回滚、恢复默认、打开日志目录 mock，以及
  IME composition/搜索调度记录只含事件名、模式和长度，不含预编辑或最终查询文字。
- [ ] 性能检查：正常 `INFO` 不逐键或逐文件记录；debug 关闭时 IME 高频调试事件不
  落盘；5 MiB 轮转后最多保留 5 个文件且总预算约 25 MiB。
- [ ] 人工验证：Windows V0.1.3 安装版验证默认日志、debug 开关立即/重启生效、目录
  可打开、轮转、日志目录短暂不可写和配置损坏恢复；检查日志不含真实路径和输入词。
- [ ] 回归范围：冷启动、`--autostart`、单实例二次启动、关闭策略、托盘、全局快捷键、
  三种搜索模式、微软拼音/微信输入法和普通英文输入。

### 发布与回滚

- 配置或迁移步骤：首次启动按默认值创建原生 diagnostics 配置；无需迁移旧数据。
- 发布观察项：启动失败、无日志、日志级别失控、日志风暴、磁盘预算超限、设置与
  实际状态不一致，以及日志中出现用户内容或原始路径。
- 回滚触发条件：日志初始化阻断启动、持续高 I/O/磁盘增长、敏感内容泄露、插件
  引发崩溃或 debug 开关无法恢复到安全默认值。
- 回滚步骤：在 `feat/0.1.3` 回退插件与桥接，删除仅由 Muller 创建的 diagnostics
  配置和日志入口；保留业务错误处理，不删除用户工作区或其他应用日志。

### 完成证据

| 日期 | 提交/PR | 检查结果 | 记录人 |
|---|---|---|---|
| TBD | TBD | 自动化、Windows 日志目录、轮转、持久化和隐私证据待补充 | `TBD` |
