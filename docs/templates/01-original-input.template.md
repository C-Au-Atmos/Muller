# Muller V<X.Y.Z> 原始输入

## 文档信息

| 字段 | 值 |
|---|---|
| 目标版本 | `V<X.Y.Z>` |
| 所属分支 | `req/<X.Y.Z>` |
| 文档状态 | `Draft` |
| 负责人 | `<name>` |
| 最后更新 | `<YYYY-MM-DD>` |

## 登记规则

- 本文只保存用户需求、Issue、Bug 和反馈的原始事实，不写技术方案或排期结论。
- 原文保持原意；补充说明必须标注日期、补充人和来源。
- 每个条目分配唯一 ID，并在评审、执行、提交和 PR 中沿用。
- 敏感信息、访问令牌、个人隐私和无法公开的附件不得写入仓库。

## 条目索引

| ID | 类型 | 标题 | 来源 | 提交人 | 收录日期 | 信息状态 |
|---|---|---|---|---|---|---|
| `<REQ/ISSUE/BUG-X.Y.Z-NNN>` | `<需求/Issue/Bug>` | `<标题>` | `<URL/会议/反馈渠道>` | `<name>` | `<YYYY-MM-DD>` | `<Complete/Needs information>` |

## `<条目 ID>` - `<标题>`

### 原始描述

> `<尽量保留原始措辞；长文本可逐段引用>`

### 来源与上下文

- 来源：`<URL、Issue 编号、会议记录或反馈渠道>`
- 提交人：`<name>`
- 首次报告时间：`<YYYY-MM-DD HH:mm TZ>`
- 使用场景：`<用户目标和发生上下文>`
- 附件：`<相对路径或公开链接；没有则写 None>`

### 环境与复现

- 版本/提交：`<version or commit>`
- 系统与硬件：`<OS, display, storage, etc.>`
- 前置条件：`<conditions>`
- 复现步骤：
  1. `<step>`
  2. `<step>`
- 实际结果：`<actual>`
- 期望结果：`<expected>`
- 复现频率：`<always/intermittent/unknown>`

### 补充记录

| 日期 | 补充人 | 来源 | 内容 |
|---|---|---|---|
| `<YYYY-MM-DD>` | `<name>` | `<source>` | `<clarification>` |
