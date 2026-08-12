# 版本文档模板

为每个小版本建立 `docs/VX.Y.Z/`，并从本目录复制以下三个模板：

1. `01-original-input.template.md` -> `01-original-input.md`
2. `02-review.template.md` -> `02-review.md`
3. `03-execution.template.md` -> `03-execution.md`

复制后替换所有 `<X.Y.Z>`、日期和负责人占位符。条目必须先进入原始输入文档，
再使用同一个 ID 进入评审和执行文档。模板结构可以按版本规模增加小节，但不得
合并三类文档的职责或删除追踪字段。
