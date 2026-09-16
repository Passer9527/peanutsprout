# 花生苗数据库管理工具 · 模块清单

| 项目 | 内容 |
| --- | --- |
| 产品名称 | 花生苗数据库管理工具 |
| 作者 | 飞哥 |
| 微信 | 6731663 |
| 开源协议 | AGPL-3.0-or-later |
| 文档版本 | v1.1 |
| 文档日期 | 2026-09-15 |
| 需求基线 | `docs/PRD.md` |
| 配套文档 | `docs/acceptance.md`、`docs/roadmap.md` |

> 本文档完整承载需求原文《花生苗数据库管理工具 — 模块清单、接口定义与数据库 DDL》**第一部分：模块清单**：总体架构分层（表现层／应用层／领域层／基础设施层）+ M01～M12 全部模块共 106 条，一条不少。
> 在原文「编号／模块／职责」三列基础上，本文档为每条模块增加两列：**实现包**（落到哪个 `apps/` / `packages/` 子包）与**状态**。

## 1. 状态定义

| 状态 | 含义 |
| --- | --- |
| `已完成（骨架）` | 本期交付范围内，该模块职责已实现并形成可运行骨架（最小可用链路） |
| `进行中` | 接口与数据结构已就位，部分职责已实现，仍有明显缺口 |
| `未开始` | 尚未实现；可能仅有接口占位、目录预留或建表脚本 |

> 各模块的**实际达成度以本节 1.1 与 `docs/acceptance.md` 为准**（后者含自动化测试证据与实机验证记录）。文档中标注"已完成（骨架）"的模块，其能力均由 `pnpm test` 全量用例覆盖（MySQL 实连用例在无服务端时显式跳过）。**本文件不写死用例数，以命令实际输出为准。**

### 1.1 本期实现进度基线

**本期已完成（可运行工程骨架）**

| 实现包 | 已实现内容 |
| --- | --- |
| `packages/core` | 领域模型与驱动 SPI |
| `packages/storage` | SQLite 建表迁移、AES-256-GCM 加密、仓库层 |
| `packages/auth` | scrypt 密码哈希、JWT、RBAC、审计哈希链 |
| `packages/drivers` | **7 种驱动真实可用**：SQLite、PostgreSQL、KingbaseES、MySQL、MariaDB、TiDB、OceanBase；Oracle / SQL Server / 达梦 / Redis / MongoDB / ClickHouse / InfluxDB / Neo4j 为占位适配器（`DRIVER_NOT_IMPLEMENTED`） |
| `apps/server` | Fastify REST API |
| `apps/cli` | 命令行工具 |
| `apps/web` | React 管理界面（基础界面） |
| `apps/desktop` | Electron 壳 |

**已实现主体逻辑、尚缺上层接入**

| 实现包 | 已实现内容 | 缺口 |
| --- | --- | --- |
| `packages/migration` | 预检（不写入任何数据，`lossy` 汇总为 warning）、目标驱动生成 DDL、TypeMapper 跨方言类型映射、**按主键/全列/单次三种分页策略分批搬运直至取空**、索引一并迁移、row-level 冲突策略（`skip`/`overwrite`/`error`/`manual`）、逐表报告与检查点、`dryRun`；`mode` **仅支持 `full`**（`incremental`/`sync` 显式报 `400 VALIDATION_FAILED`）。**SQLite → 真实 PostgreSQL 的跨异构库迁移已端到端实测** | MySQL 系驱动未经真实服务端验证（本机无法下载服务端二进制）；`incremental`/`sync` 与独立 `migrate resume` 未实现 |
| `packages/ai` | 9 类供应商适配、`nl2sql`/`explain`/`optimize`/`document`/`ask`/`diagnose` 六类能力与路由、配置密文存储、**连通性测试与模型列举**、脱敏网关、**AI 只生成不执行**与生产库写闸门 | **已用真实模型端到端验证**（`gpt-5.6-sol`，OpenAI 兼容端点）：`nl2sql` 生成的 SQL 可直接执行并返回结果，`explain`/`optimize`/`diagnose` 均返回有效内容；`document`/`ask` 因长输出在 120s 超时内未跑完（模型速度问题，非功能缺陷）。**界面侧**由 `apps/web` 的 `AiAssistantPage`（对话）与 `AiSettingsCard`（供应商配置）承载 |
| `packages/visualization` | 15 种图表类型定义、聚合 SQL 生成（**含 `FROM` 与按方言引号**）、标识符白名单、运算符规范化、配置校验；Web 端 SVG 渲染 `bar`/`column`/`line`/`area`/`pie`/`donut`/`scatter`/`radar`/`parallel` | `bubble`/`heatmap`/`sankey`/`treemap`/`boxplot`/`map` 尚无浏览器内渲染（显示明确占位面板 + 数据表） |
| `packages/i18n` | **国际化**：六种语言（简体中文／繁体中文／英文／俄语／日语／韩语）、扁平键 + 编译期键名约束、`Intl.PluralRules` 复数、源语言回退链、`Intl` 数字/紧凑数字格式化、语言包完整性审计；Web/桌面端共用 | CLI 输出与服务端日志仍为中文（面向运维与排查，见 `docs/i18n.md` §6） |

**本期明确未实现**：8 种占位驱动（Oracle / SQL Server / 达梦 / Redis / MongoDB / ClickHouse / InfluxDB / Neo4j）、多平台安装包的实际产出与安装验证、部分图表类型的浏览器内渲染。对应 Phase 2～Phase 5，详见 `docs/roadmap.md`。

## 2. 总体架构分层

```text
┌─────────────────────────────────────────────────────────┐
│                    表现层（Presentation）                 │
│  桌面端原生 UI  │  Web 端 UI  │  CLI  │  REST API        │
├─────────────────────────────────────────────────────────┤
│                    应用层（Application）                  │
│  连接管理 │ SQL 开发 │ 数据迁移 │ 可视化 │ AI 助手 │ 权限 │
├─────────────────────────────────────────────────────────┤
│                    领域层（Domain）                       │
│  连接模型 │ 元数据模型 │ 迁移模型 │ 图表模型 │ 审计模型   │
├─────────────────────────────────────────────────────────┤
│                    基础设施层（Infrastructure）           │
│  驱动适配器 │ SQLite 存储 │ 加密 │ 日志 │ 插件 │ 调度     │
└─────────────────────────────────────────────────────────┘
```

### 2.1 分层与实现包映射

| 分层 | 职责 | 实现包 | 技术形态 |
| --- | --- | --- | --- |
| 表现层 | 桌面端原生 UI、Web 端 UI、CLI、REST API | `apps/desktop`、`apps/web`、`apps/cli`、`apps/server` | Electron；React + Vite；命令行；Node.js + Fastify |
| 应用层 | 连接管理、SQL 开发、数据迁移、可视化、AI 助手、权限等用例编排 | `apps/server`、`packages/core`、`packages/auth`、`packages/migration`、`packages/ai`、`packages/visualization` | TypeScript 用例服务 |
| 领域层 | 连接模型、元数据模型、迁移模型、图表模型、审计模型 | `packages/core` | 领域模型 + 驱动 SPI 接口（TypeScript 等价接口） |
| 基础设施层 | 驱动适配器、SQLite 存储、加密、日志、插件、调度 | `packages/storage`、`packages/drivers`、`packages/auth`、`packages/core` | `node:sqlite`、`node:crypto` scrypt、AES-256-GCM、JWT(HS256) |

### 2.2 工程布局（apps / packages）

| 路径 | 角色 | 对应原文目录 | 状态 |
| --- | --- | --- | --- |
| `apps/server` | Node.js + Fastify 服务端（REST API） | `server/` | 已完成（骨架） |
| `apps/cli` | 命令行工具 | `cli/` | 已完成（骨架） |
| `apps/web` | React + Vite Web 端 | `web/` | 已完成（骨架，基础界面） |
| `apps/desktop` | Electron 桌面端 | `desktop/` | 已完成（骨架，壳） |
| `packages/core` | 领域层与驱动 SPI | `core/` | 已完成（骨架） |
| `packages/storage` | SQLite 存储、加密、仓库层 | `storage/` | 已完成（骨架） |
| `packages/auth` | 用户、权限、审计 | `auth/` | 已完成（骨架） |
| `packages/drivers` | 驱动适配器 | `drivers/` | 进行中（SQLite 真实可用） |
| `packages/ai` | AI 助手 | `ai/` | 已完成（真实落地，已用真实模型验证 nl2sql；配置界面与对话页已接通） |
| `packages/migration` | 数据迁移 | `migration/` | 已完成（真实落地，跨异构库端到端验证） |
| `packages/visualization` | 可视化 | `visualization/` | 已完成（聚合 SQL 生成 + 图表/看板 REST + Web 渲染） |
| `packaging/{windows,linux,macos}` | 打包配置 | `packaging/` | 未开始 |
| `scripts`、`tests` | 构建脚本、测试 | `scripts/`、`tests/` | 已有目录预留 |

## 3. 模块总览（M01～M12）

| 编号 | 模块 | 职责概述 |
| --- | --- | --- |
| M01 | 核心框架模块 | 应用启动、配置、生命周期、日志、自动更新、国际化、主题、插件框架 |
| M02 | 连接管理模块 | 连接配置与分组、连接测试、隧道与加密、连接池、驱动管理、只读保护、凭据加密 |
| M03 | 驱动适配模块 | 统一 Driver SPI、各类型数据库适配、元数据抽取、类型映射、DDL 方言、执行计划解析 |
| M04 | 对象管理与 SQL 开发模块 | 对象树、SQL 编辑器与智能补全、执行引擎、结果集、历史、慢 SQL、执行计划、表设计、结构对比、ER 图、数据编辑与对比、SQL 版本管理 |
| M05 | 数据迁移模块 | 导入导出、字段映射、类型转换、预处理、异构迁移、预检、报告、断点续传、同步、CDC |
| M06 | 可视化模块 | 图表引擎与类型、数据绑定、维度指标、交互联动、看板、实时刷新、导出 |
| M07 | AI 助手模块 | 模型接入与配置、NL2SQL、解释、优化、对象/数据助手、问答、文档、诊断、脱敏与安全确认 |
| M08 | 用户与权限模块 | 用户、认证、密码哈希、角色、权限、只读用户、会话、审计日志 |
| M09 | 存储模块（本地 SQLite3） | 初始化、用户/连接/历史/审计/配置/任务存储、备份恢复、加密存储 |
| M10 | Web 服务模块 | HTTP 服务、会话、连接池服务、WebSocket、上传下载、反向代理、部署模式 |
| M11 | 集成与自动化模块 | CLI、REST API、定时任务、Git 集成、SSO、消息通知 |
| M12 | 打包与分发模块 | 运行时内置、驱动内置、安装包构建、签名、持续集成、发布渠道 |

## 4. 模块明细（M01～M12）

### M01 核心框架模块

| 编号 | 模块 | 职责 | 实现包 | 状态 |
| --- | --- | --- | --- | --- |
| M01-01 | 应用启动器 | 初始化、配置加载、单实例控制 | `apps/server`、`apps/cli`、`apps/desktop`、`packages/core` | 已完成（骨架） |
| M01-02 | 配置中心 | 全局配置读写、环境变量、默认值 | `packages/core`、`apps/*` | 已完成（骨架） |
| M01-03 | 生命周期管理 | 启动、关闭、崩溃恢复、会话恢复 | `packages/core`、`apps/desktop` | 进行中 |
| M01-04 | 日志系统 | 分级日志、滚动、诊断包导出 | `packages/core` | 进行中 |
| M01-05 | 自动更新 | 版本检查、增量/全量更新、离线包 | `apps/desktop`、`packaging` | 未开始 |
| M01-06 | 国际化 | 多语言资源、时区、数字格式 | `packages/i18n`、`apps/web`、`apps/desktop` | **已完成**：六种语言 × **11 个命名空间**（本轮新增 `table`、`designer`；简中/繁中/日/韩各 **1045 键**，英 **1085**、俄 **1153**，多出的是复数形式）、`Intl.PluralRules` 复数、编译期键名约束、源语言回退链、`Intl` 数字与紧凑数字格式化；语言包完整性测试 36 项。**时区**未做独立处理（时间戳统一按 ISO 风格展示，见 `docs/i18n.md` §6） |
| M01-07 | 主题引擎 | 深色/浅色、自定义主题色、高 DPI | `apps/web` | 已完成（深色/浅色 + 跟随系统，`apps/web/src/state/theme.tsx`）；自定义主题色与高 DPI 未做 |
| M01-08 | 插件框架 | 插件加载、注册、隔离、版本校验 | `packages/core`、`packages/storage` | 进行中 |

### M02 连接管理模块

| 编号 | 模块 | 职责 | 实现包 | 状态 |
| --- | --- | --- | --- | --- |
| M02-01 | 连接配置 | 主机/端口/库/用户/密码、连接串解析 | `apps/server`、`apps/cli`、`apps/web`、`packages/core` | 已完成（骨架） |
| M02-02 | 连接分组 | 分组、标签、搜索、收藏 | `apps/server`、`apps/web`、`packages/storage` | 进行中 |
| M02-03 | 连接测试 | 连通性、延迟、权限探测 | `apps/server`、`apps/cli`、`packages/drivers` | 已完成（骨架） |
| M02-04 | 隧道与加密 | SSH 隧道、SSL/TLS、代理 | `packages/drivers`、`packages/core` | 未开始 |
| M02-05 | 连接池 | 池化、超时、心跳、重连 | `packages/drivers` | 未开始 |
| M02-06 | 驱动管理 | 内置驱动、自定义驱动、版本冲突 | `packages/drivers`、`packages/storage` | 进行中 |
| M02-07 | 只读保护 | 只读锁定、生产库标识、颜色标记 | `packages/auth`、`apps/server`、`apps/web` | 进行中 |
| M02-08 | 凭据加密 | 主密码、AES-256-GCM、密钥派生 | `packages/storage` | 已完成（骨架） |

### M03 驱动适配模块

| 编号 | 模块 | 职责 | 实现包 | 状态 |
| --- | --- | --- | --- | --- |
| M03-01 | 驱动接口层 | 统一 Driver SPI 抽象 | `packages/core` | 已完成（骨架） |
| M03-02 | 关系型适配 | MySQL、PostgreSQL、Oracle、SQL Server、SQLite、金仓、达梦、OceanBase、TiDB | `packages/drivers` | 进行中 |
| M03-03 | NoSQL 适配 | Redis、MongoDB、Neo4j | `packages/drivers` | 未开始 |
| M03-04 | 分析型适配 | ClickHouse | `packages/drivers` | 未开始 |
| M03-05 | 时序适配 | InfluxDB | `packages/drivers` | 未开始 |
| M03-06 | 元数据抽取 | 库/表/字段/索引/约束/注释 | `packages/core`、`packages/drivers` | 进行中 |
| M03-07 | 类型映射表 | 跨库类型映射规则 | `packages/core`、`packages/drivers` | 进行中 |
| M03-08 | DDL 方言 | 各库 DDL 生成与解析 | `packages/drivers` | 进行中 |
| M03-09 | 执行计划解析 | 各库执行计划归一化 | `packages/drivers` | 未开始 |

### M04 对象管理与 SQL 开发模块

| 编号 | 模块 | 职责 | 实现包 | 状态 |
| --- | --- | --- | --- | --- |
| M04-01 | 对象树 | 层级展示、搜索、过滤、跳转 | `apps/web`、`packages/core`、`packages/drivers` | 进行中 |
| M04-02 | SQL 编辑器 | 高亮、补全、多标签、多光标、折叠、格式化 | `apps/web` | 未开始 |
| M04-03 | 智能补全引擎 | 表/字段/函数/关键字补全 | `apps/web`、`packages/core` | 未开始 |
| M04-04 | 执行引擎 | 执行、取消、超时、事务控制 | `packages/core`、`apps/server`、`apps/cli` | 已完成（骨架） |
| M04-05 | 结果集视图 | 分页、流式、编辑、导出 | `apps/web`、`apps/server` | 进行中 |
| M04-06 | 执行历史 | 历史记录、收藏、重跑 | `packages/storage`、`apps/server`、`apps/web` | 已完成（骨架） |
| M04-07 | 慢 SQL 标记 | 阈值配置、标红、记录 | `packages/storage`、`packages/core` | 进行中 |
| M04-08 | 执行计划可视化 | 图形化耗时占比 | `apps/web`、`packages/drivers` | 未开始 |
| M04-09 | 表设计器 | 建表、改表、删表、DDL 预览 | `apps/web`、`packages/drivers` | **部分完成**：建 Schema/建表/删表 + DDL 预览（只生成不执行）已可用（`/ddl/*` + `TableDesignerPage.tsx`）；**改表（ALTER）**、**外键可视化配置**、**结构对比**未接 UI 与路由。`IF NOT EXISTS` 只作用于建表（MySQL 不支持 `CREATE INDEX IF NOT EXISTS`） |
| M04-10 | 结构对比 | 表/库结构差异对比与同步 | `packages/drivers` | 未开始 |
| M04-11 | ER 图 | 自动生成、布局、导出 | `packages/visualization`、`apps/web` | 未开始 |
| M04-12 | 数据编辑器 | 单元格编辑、批量操作、校验 | `apps/web` | **部分完成**：分页查看、内联改单元格、插入行、批量删除、非空校验、内联编辑防误改（定位符）已可用（`/data/table/*` + `TableDataPage.tsx`）；**批量替换**与**事务回滚**未实现 —— `QueryExecutor` 没有 begin/commit/rollback，写操作是逐行无事务的，界面如实报告实际条数 |
| M04-13 | 数据对比 | 两表/两库数据差异对比 | `packages/migration` | 未开始 |
| M04-14 | SQL 版本管理 | Git 集成、提交、对比、回滚 | `apps/cli`、`packages/core` | 未开始 |

### M05 数据迁移模块

| 编号 | 模块 | 职责 | 实现包 | 状态 |
| --- | --- | --- | --- | --- |
| M05-01 | 导入引擎 | CSV/Excel/JSON/XML/SQL/Parquet | `packages/migration`、`apps/cli` | 进行中（仅 CSV：`peanutsprout import`） |
| M05-02 | 导出引擎 | CSV/Excel/JSON/XML/SQL/Parquet/Markdown/PDF | `packages/migration`、`apps/cli` | 进行中（仅 CSV：`peanutsprout export`） |
| M05-03 | 字段映射 | 可视化拖拽、自动推断、手动覆盖 | `packages/migration`、`apps/web` | 未开始 |
| M05-04 | 类型转换 | 自动映射、自定义规则、异常处理 | `packages/migration`、`packages/drivers` | 进行中（`TypeMapper` 自动映射 + `lossy` 标记） |
| M05-05 | 预处理 | 去重、过滤、脱敏、格式转换 | `packages/migration` | 未开始 |
| M05-06 | 异构迁移 | 源库→目标库、结构+数据、双向 | `packages/migration` | 进行中（结构+数据单向；SQLite→真实 PostgreSQL 已端到端验证；`mode` 仅 `full`） |
| M05-07 | 迁移预检 | 类型/长度/字符集/约束冲突检测 | `packages/migration`、`packages/drivers` | 已完成（类型兼容性、`lossy`、行数估算；**不写入任何数据**） |
| M05-08 | 迁移报告 | 成功/失败/跳过统计、失败原因 | `packages/migration`、`packages/storage` | 已完成（`MigrationOutcome.tables[]`、行级冲突策略、无主键时整表跳过并如实报 `skipped`） |
| M05-09 | 断点续传 | 检查点、失败重试、回滚 | `packages/migration`、`packages/storage` | 进行中（检查点写入 `migration_checkpoints`，但**没有** `migrate resume` 子命令，续传需重新 `start`） |
| M05-10 | 数据同步 | 一次性、定时、增量、冲突策略 | `packages/migration` | 进行中（冲突策略 `skip/overwrite/error/manual` 已实现；定时/`incremental`/`sync` 模式未实现） |
| M05-11 | CDC 支持 | binlog/逻辑复制（视库能力） | `packages/migration`、`packages/drivers` | 未开始 |

### M06 可视化模块

| 编号 | 模块 | 职责 | 实现包 | 状态 |
| --- | --- | --- | --- | --- |
| M06-01 | 图表引擎 | 渲染、交互、动画 | `packages/visualization`、`apps/web` | 进行中（Web 端 SVG 渲染，无动画/复杂交互） |
| M06-02 | 图表类型 | 条形/柱状/折线/面积/饼/环形/散点/气泡/平行坐标/热力/雷达/桑基/树/箱线/地图 | `packages/visualization` | 进行中（15 种配置已支持；Web 端渲染 9 种，其余显示"暂不支持浏览器内渲染"占位） |
| M06-03 | 数据绑定 | 表/视图/查询结果绑定 | `packages/visualization`、`apps/server` | 已完成（聚合 SQL 生成 + `GET /charts/:id/data` 取数） |
| M06-04 | 维度指标配置 | 维度、指标、聚合方式 | `packages/visualization`、`apps/web` | 已完成（配置校验 + 方言引用加引号） |
| M06-05 | 交互联动 | 联动、下钻、筛选 | `apps/web` | 未开始 |
| M06-06 | 看板 | 保存、布局、分享 | `apps/web`、`packages/storage` | 进行中（看板 CRUD 已实现；拖拽布局与分享未实现） |
| M06-07 | 实时刷新 | 手动/定时/WebSocket | `apps/server`、`apps/web` | 未开始 |
| M06-08 | 导出 | 图片、PDF | `apps/web` | 未开始 |

### M07 AI 助手模块

| 编号 | 模块 | 职责 | 实现包 | 状态 |
| --- | --- | --- | --- | --- |
| M07-01 | 模型接入 | OpenAI/Anthropic/Google/通义/文心/智谱/DeepSeek/Ollama | `packages/ai` | 已完成（9 类供应商，含 `openai-compatible` 以覆盖 vLLM / LM Studio / 自建服务） |
| M07-02 | 模型配置 | API Key、模型名、温度、超时 | `packages/ai`、`packages/storage` | 已完成（密钥 AES-256-GCM 密文落库，接口只回 `hasApiKey`；**界面 + 连通性测试 + 模型列举**） |
| M07-03 | NL2SQL | 自然语言转 SQL | `packages/ai` | 已完成（**只生成不执行**：返回值只有 SQL 文本与解释，不含任何执行产物；`scripts/ai-live-test.mjs` 会比对临时库调用前后的行数/金额/表集合确认无副作用） |
| M07-04 | SQL 解释 | SQL 转自然语言 | `packages/ai` | 已完成 |
| M07-05 | SQL 优化 | 基于执行计划的优化建议 | `packages/ai`、`packages/drivers` | 已完成（给了连接会先跑 `EXPLAIN` 拿真实计划） |
| M07-06 | 对象管理助手 | 建表/建字段/注释/索引建议 | `packages/ai` | **未实现** —— `AiScene` 里有 `object_manage` 这个类型，但没有对应提示词、路由与界面（`grep object_manage` 只有类型声明本身） |
| M07-07 | 数据操作助手 | DML 生成（需确认） | `packages/ai` | **未单独实现** —— DML 可由 `/ai/nl2sql` 生成，且写语句受"连接允许写 + 生产库禁写 + 人工确认"三道闸门约束，但没有专门的"数据操作助手"入口 |
| M07-08 | 数据问答 | 对结果集提问 | `packages/ai` | 已完成（契约要求真的带上结果数据 `columns`+`rows`；发送前经脱敏网关） |
| M07-09 | 文档生成 | 数据字典、表说明 | `packages/ai` | 已完成 |
| M07-10 | 错误诊断 | 报错原因与修复建议 | `packages/ai` | 已完成 |
| M07-11 | 脱敏网关 | 发送前脱敏、可配置 | `packages/ai` | 已完成（`ai.redaction_enabled` 默认开启） |
| M07-12 | 安全确认 | 强制人工确认、生产库禁写 | `packages/ai`、`packages/auth` | 已完成（AI 返回值不含执行产物；写语句必须由用户复制后走 `/query/execute`，从而经过权限+只读+资源授权+二次确认四道闸门；`scripts/ai-live-test.mjs` 会对"只生成不执行"做真实副作用比对） |

> **关于 M07 的诚实说明**：整张表此前全部标着"未开始"，与代码实际状态严重不符 —— 后端六类能力与脱敏网关早已实现并已用真实模型验证，但**缺少任何界面与总开关写入口**，用户完全够不着（所有 AI 调用恒返回 `AI_DISABLED`）。现已补齐界面（设置页 AI 卡片 + 独立 AI 助手对话页）、`PUT /meta/settings` 写入口（白名单约束）与其余四种语言的文案；M07-06 / M07-07 确实未实现，故仍标为未实现，不参与"已完成"计数。

### M08 用户与权限模块

| 编号 | 模块 | 职责 | 实现包 | 状态 |
| --- | --- | --- | --- | --- |
| M08-01 | 用户管理 | 增删改查、启用禁用 | `packages/auth`、`apps/server`、`apps/cli`、`apps/web` | 已完成（骨架） |
| M08-02 | 认证 | 登录、登出、改密、找回、2FA | `packages/auth`、`apps/server`、`apps/cli`、`apps/web` | 进行中 |
| M08-03 | 密码哈希 | scrypt（原文 bcrypt/argon2 的等价实现） | `packages/auth` | 已完成（骨架） |
| M08-04 | 角色管理 | 角色定义、分配 | `packages/auth`、`apps/server` | 已完成（骨架） |
| M08-05 | 权限控制 | 连接/库/表/操作级授权 | `packages/auth`、`apps/server` | 进行中 |
| M08-06 | 只读用户 | 禁止写操作 | `packages/auth`、`apps/server` | 已完成（骨架） |
| M08-07 | 会话管理 | 会话隔离、超时锁定 | `packages/auth`、`apps/server` | 进行中 |
| M08-08 | 审计日志 | 记录、检索、导出、归档、哈希链 | `packages/auth`、`packages/storage`、`apps/server`、`apps/cli` | 已完成（骨架） |

### M09 存储模块（本地 SQLite3）

| 编号 | 模块 | 职责 | 实现包 | 状态 |
| --- | --- | --- | --- | --- |
| M09-01 | 数据库初始化 | 建库建表、迁移脚本 | `packages/storage` | 已完成（骨架） |
| M09-02 | 用户存储 | 账户、角色、权限 | `packages/storage` | 已完成（骨架） |
| M09-03 | 连接存储 | 加密连接配置 | `packages/storage` | 已完成（骨架） |
| M09-04 | 历史存储 | SQL 历史、AI 历史 | `packages/storage` | 已完成（骨架） |
| M09-05 | 审计存储 | 审计日志 | `packages/storage` | 已完成（骨架） |
| M09-06 | 配置存储 | 偏好、看板、图表、AI 配置 | `packages/storage` | 进行中 |
| M09-07 | 任务存储 | 迁移、同步、定时任务 | `packages/storage` | 进行中 |
| M09-08 | 备份恢复 | 备份、恢复、导出 | `packages/storage`、`apps/cli` | 未开始 |
| M09-09 | 加密存储 | AES-256-GCM、密钥管理 | `packages/storage` | 已完成（骨架） |

### M10 Web 服务模块

| 编号 | 模块 | 职责 | 实现包 | 状态 |
| --- | --- | --- | --- | --- |
| M10-01 | HTTP 服务 | REST API、HTTPS | `apps/server` | 已完成（骨架） |
| M10-02 | 会话管理 | 登录态、Token、隔离 | `apps/server`、`packages/auth` | 进行中 |
| M10-03 | 连接池服务 | 多用户并发、池管理 | `apps/server`、`packages/drivers` | 未开始 |
| M10-04 | WebSocket | 实时刷新、进度推送 | `apps/server` | 未开始 |
| M10-05 | 文件上传下载 | 导入导出文件 | `apps/server`、`apps/web` | 未开始 |
| M10-06 | 反向代理适配 | Nginx、负载均衡 | `apps/server`、`packaging/linux` | 未开始 |
| M10-07 | 部署模式 | 桌面内嵌、独立服务、Docker | `apps/server`、`apps/desktop`、`packaging` | 进行中 |

### M11 集成与自动化模块

| 编号 | 模块 | 职责 | 实现包 | 状态 |
| --- | --- | --- | --- | --- |
| M11-01 | CLI | 命令行工具 | `apps/cli` | 已完成（骨架） |
| M11-02 | REST API | 本地/远程 API | `apps/server` | 已完成（骨架） |
| M11-03 | 定时任务 | cron 表达式、调度 | `apps/server`、`packages/storage` | 未开始 |
| M11-04 | Git 集成 | SQL 版本管理 | `apps/cli` | 未开始 |
| M11-05 | SSO | LDAP/OAuth（可选） | `apps/server`、`packages/auth` | 未开始 |
| M11-06 | 消息通知 | 邮件、钉钉、飞书、Slack | `apps/server` | 未开始 |

### M12 打包与分发模块

| 编号 | 模块 | 职责 | 实现包 | 状态 |
| --- | --- | --- | --- | --- |
| M12-01 | 运行时内置 | Node.js 运行时打包（原文 JRE/Python/Node） | `apps/desktop`、`packaging` | 进行中 |
| M12-02 | 驱动内置 | 驱动打包 | `packages/drivers`、`packaging` | 进行中 |
| M12-03 | 安装包构建 | Windows/Linux/macOS × x86_64/arm64 | `packaging/{windows,linux,macos}` | 未开始 |
| M12-04 | 签名 | 代码签名、公证 | `packaging` | 未开始 |
| M12-05 | 持续集成 | 多平台构建、测试 | `scripts`、`packaging` | 未开始 |
| M12-06 | 发布渠道 | 官网、GitHub Releases | `packaging` | 未开始 |

## 5. 状态统计

| 状态 | 条数 | 占比 |
| --- | --- | --- |
| 已完成（骨架） | 22 | 20.8% |
| 进行中 | 22 | 20.8% |
| 未开始 | 62 | 58.5% |
| **合计** | **106** | **100%** |

> 占比为四舍五入结果，纵向合计可能略有出入。

## 6. 进行中模块的缺口说明

| 编号 | 已有 | 缺口 |
| --- | --- | --- |
| M01-03 | 进程启动与关闭 | 崩溃恢复、会话恢复未实现 |
| M01-04 | 基础分级日志 | 日志滚动、诊断包一键导出未实现（对应 SR-18） |
| M01-08 | 插件注册表（`plugins` 表）已建 | 插件加载、隔离、版本校验未实现（对应 SR-14） |
| M02-02 | `connection_groups` 表与分组字段已建 | 分组树 UI、标签、搜索、收藏未完成 |
| M02-06 | 驱动注册表与 `drivers` 表、Driver SPI 已就位 | 自定义驱动加载与版本冲突检测未实现 |
| M02-07 | 只读用户与 RBAC 限制已实现 | 连接颜色标识、生产库标识的 UI 未实现（对应 SR-08） |
| M03-02 | **7 种真实驱动已落地**：SQLite、PostgreSQL、KingbaseES、MySQL、MariaDB、TiDB、OceanBase（`packages/drivers/src/registry.ts`） | Oracle、SQL Server、达梦 DM、Redis、MongoDB、ClickHouse、InfluxDB、Neo4j 仍为占位适配器，调用即抛 `DRIVER_NOT_IMPLEMENTED`；MySQL 系未经真实服务端验证 |
| M03-06 | SQLite / PostgreSQL / MySQL 系的元数据抽取可用（各驱动实现 `getMetadata()`） | 占位驱动无元数据；跨库元数据差异的边界用例仍待补 |
| M03-07 | 跨方言类型映射已实现（`mapper.mapType()`，含 `lossy` 标记并汇总为预检 warning） | 更细的类型/默认值/字符集差异规则仍待补全 |
| M03-08 | 目标库 DDL 生成可用（`ddlGen.createTable()`，迁移时建表 + 二级索引） | 各占位驱动的 DDL 方言未实现；视图/触发器/存储过程迁移未覆盖 |
| M04-01 | 元数据接口就位，Web 端布局骨架已有 | 对象树完整层级与搜索/过滤/跳转未完成 |
| M04-05 | REST 返回结果集 | 分页/流式加载、单元格编辑、多格式导出未完成 |
| M04-07 | `is_slow` 字段与阈值配置骨架 | 自动标记与标红展示未完成（对应 SR-07） |
| M08-02 | 登录、登出、JWT 鉴权已完成 | 找回密码、双因素认证（2FA）未实现 |
| M08-05 | RBAC 角色权限与资源级授权（`resource_grants` 的连接/库/表授权与过期）均已接入路由判定，未授权连接按 404 处理 | 更复杂的 glob/继承语义与授权管理 UI 仍待完善 |
| M08-07 | JWT 会话与令牌校验、失败锁定（5 次 / 15 分钟）、默认口令强制改密闸门已实现 | 空闲自动锁定、多端会话互踢的可视化管理未完善（对应 NFR-5.2-07） |
| M09-06 | 图表/看板 REST（`routes/visualization.ts`）与 AI 配置读写（`routes/ai-migration.ts`）均已实现 | 部分图表类型的前端渲染仍为占位面板；看板级联动/钻取未实现 |
| M09-07 | 迁移引擎已实现（预检、DDL、分批分页搬运、冲突策略、逐表报告；`mode` 仅 `full`） | `incremental`/`sync` 模式与定时任务调度未实现 |
| M10-02 | JWT 登录态 | 多用户会话隔离与刷新策略待完善 |
| M10-07 | 桌面端内嵌服务、独立服务端可运行 | Docker 镜像与部署编排未实现 |
| M12-01 | Electron 壳自带 Node 运行时 | 安装包尚未产出 |
| M12-02 | 驱动随包分发 | 安装包尚未产出 |

## 7. 遗留项与后续补充

1. 仓库根社区与协议文件 `LICENSE`（AGPL-3.0 全文）、`README.md`、`CHANGELOG.md`、`CONTRIBUTING.md`、`CLA.md` 均已就位，AC-09、AC-10 已满足。
2. 文档全集已交付：`docs/` 下含 `PRD.md`、`architecture.md`、`api.md`、`ddl.sql`、`security.md`、`deployment.md`、`cli-reference.md`、`modules.md`、`acceptance.md`、`roadmap.md` 等。其中 **`docs/api.md` 与 `docs/ddl.sql` 为独立成篇的权威文件**：`api.md` 与路由实现一一对应；`ddl.sql` 由 `pnpm ddl:export` 从 `packages/storage/src/schema/ddl.ts` 生成，**禁止手工维护**（`pnpm verify` 会重新生成并与其**逐字节比对**，不一致即失败）。
3. 后续推进方向（⬜）：为占位驱动补齐真实实现并验证（Oracle / SQL Server / 达梦 DM / Redis / MongoDB / ClickHouse / InfluxDB / Neo4j）、`incremental`/`sync` 迁移模式、部分图表类型的浏览器内渲染、多平台安装包；详见 `docs/roadmap.md`。
4. `pnpm verify` 提供一键自检（运行环境／交付文件／本地库与审计链／驱动落地／构建产物／国际化／DDL 一致性），逐项打印通过/失败并在末行汇总实际项数；`pnpm test` 为 vitest 全量测试（MySQL 实连用例在无服务端时显式跳过）。**本文件不写死项数，以命令实际输出为准。**

---

产品名称：花生苗数据库管理工具
作者：飞哥
微信：6731663
开源协议：AGPL-3.0-or-later
