# 仓库文档（docs/）

> 面向使用者的入口在 [仓库根 README](../README.md)；这里是设计、过程与开发文档。
> 历史版本（0.1~0.6）见 [`old/`](../old/README.md)。

## 设计与规格

| 文件 | 是什么 |
|---|---|
| [SPEC.md](SPEC.md) | 本插件的规格基线（做什么、不做什么） |
| [ACCEPTANCE.md](ACCEPTANCE.md) | 验收标准（怎么算做完了） |
| [PROMPT-OPTIMIZATION.md](PROMPT-OPTIMIZATION.md) | 提示词优化这件事本身的方法与取舍 |
| [ROADMAP.md](ROADMAP.md) | 路线图与未做项 |

## 计划（按版本）

| 文件 | 对应版本 |
|---|---|
| [PLAN-0.6.md](PLAN-0.6.md) | 0.6 架构重做 |
| [PLAN-0.7.0-beta.1.md](PLAN-0.7.0-beta.1.md) | 0.7.0 |
| [PLAN-0.7.1.md](PLAN-0.7.1.md) | 0.7.1 |

## 过程记录

| 文件 | 记什么 |
|---|---|
| [CHECKPOINT.md](CHECKPOINT.md) | 阶段性检查点 |
| [DECISIONS.md](DECISIONS.md) | 决策与理由（为什么这么定） |
| [DELIVERY.md](DELIVERY.md) | 交付记录 |
| [EVIDENCE.md](EVIDENCE.md) | 证据索引 |
| [EVAL-REGISTRY.md](EVAL-REGISTRY.md) | 评估登记 |
| [evidence/](evidence/) | 开发期证据留档（原始产物） |

## 兼容性

| 文件 | 是什么 |
|---|---|
| [DSH-COMPAT.md](DSH-COMPAT.md) | 与 DSH 宿主各版本的兼容说明 |
| [compatibility-report.md](compatibility-report.md) | 兼容性实测报告 |
| [baseline-manifest.json](baseline-manifest.json) | 基线清单 |

## 开发与发布

| 文件 | 是什么 |
|---|---|
| [RELEASING.md](RELEASING.md) | **发布规程**：四条不变量 + 9 步流程 + 检查清单 |
| [PACKAGING-NOTICE.md](PACKAGING-NOTICE.md) | 打包避坑记录（根 package.json 为什么是薄壳） |

## 留在仓库根的文件（为什么）

| 文件 | 为什么在根 |
|---|---|
| `README.md` / `README.en.md` | 访客第一眼要看的东西 |
| `LICENSE` | 惯例位置 |
| `CHANGELOG.md` | 发布惯例，访客常直接找 |
| `package.json` | 安装入口会读它（详见 PACKAGING-NOTICE） |
| `.gitignore` / `.gitattributes` | 版本控制必需 |
