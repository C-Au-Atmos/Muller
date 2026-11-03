# Muller 分支历史索引

本索引记录已完成版本的阶段分支尖端。阶段分支清理后，使用归档标签和提交 SHA 查询原分支状态；发布里程碑继续使用 `v0.1.3`、`v0.1.4` 标签查询。

## V0.1.3

| 原分支 | 尖端提交 | 归档标签 | 版本记录 |
|---|---|---|---|
| `req/0.1.3` | `0b98a91` | `archive/0.1.3/req` | [原始输入](../V0.1.3/01-original-input.md) |
| `feat/0.1.3` | `367fd38` | `archive/0.1.3/feat` | [执行计划](../V0.1.3/03-execution.md) |
| `release/0.1.3` | `6fd616f` | `archive/0.1.3/release` | [执行计划](../V0.1.3/03-execution.md) |

发布里程碑：`v0.1.3`（发布提交 `bafe4f6`）。

## V0.1.4

| 原分支 | 尖端提交 | 归档标签 | 版本记录 |
|---|---|---|---|
| `req/0.1.4` | `97cc8e3` | `archive/0.1.4/req` | [原始输入](../V0.1.4/01-original-input.md) |
| `feat/0.1.4` | `8fbf50a` | `archive/0.1.4/feat` | [执行计划](../V0.1.4/03-execution.md) |
| `release/0.1.4` | `6fab298` | `archive/0.1.4/release` | [执行计划](../V0.1.4/03-execution.md) |

发布里程碑：`v0.1.4`（发布提交 `1f11fdb`）。

## 查询方式

```powershell
git show archive/0.1.3/req
git log --oneline --decorate archive/0.1.4/release
git branch -a --contains 6fab298
git tag --list 'archive/0.1.*/*'
```
