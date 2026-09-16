# 花生苗数据库管理工具 · 产品需求文档（PRD）

| 项目 | 内容 |
| --- | --- |
| 产品中文名 | 花生苗数据库管理工具 |
| 产品英文名 | PeanutSprout DB Manager（暂定） |
| 产品简称 | 花生苗 |
| 作者 | 飞哥 |
| 微信 | 6731663 |
| 开源协议 | GNU Affero General Public License v3.0（AGPL-3.0） |
| 文档版本 | v1.0 |
| 文档日期 | 2026-09-15 |
| 文档状态 | 需求基线（已冻结） |
| 需求来源 | 飞哥提供的《产品需求文档（PRD）》原文 + 《花生苗数据库管理工具 — 模块清单、接口定义与数据库 DDL》原文 |
| 关联文档 | `docs/modules.md`、`docs/acceptance.md`、`docs/roadmap.md` |

> **协议声明（原文）**：本项目采用 AGPL-3.0 开源协议。任何人对本项目的修改、分发，以及以网络服务形式向用户提供本软件功能的行为，都必须以相同协议开源其完整源代码。商业闭源使用需另行获得作者书面授权。

## 可追溯编号规则

本文档为需求基线，原文的每一条需求均被保留并被赋予唯一编号，便于开发、测试与验收逐条对齐：

| 编号前缀 | 含义 | 示例 |
| --- | --- | --- |
| `FR-4.x-nn` | 功能需求（对应第四章 4.1–4.9） | `FR-4.1-01` |
| `NFR-5.x-nn` | 非功能需求（对应第五章 5.1–5.7） | `NFR-5.1-01` |
| `PLAT-nn` | 目标平台与交付形态（对应第三章） | `PLAT-01` |
| `DM-nn` | 数据模型核心表（对应第八章） | `DM-01` |
| `AC-nn` | 验收标准（对应第九章，与 `docs/acceptance.md` 一一对应） | `AC-01` |
| `SR-nn` | 补充需求（对应第十章） | `SR-01` |
| `RK-nn` | 风险与约束（对应第十一章） | `RK-01` |

> 章节号沿用原文编号（一～十一），以保证「四、功能需求 → FR-4.x」这类编号与原文可对齐。原文「非目标」位于第一章内，本文档将其单列为 1.2 小节。

---

## 0. 技术栈与冻结决策

以下技术决策为**已冻结**事项，是本项目实施的唯一技术路线，文档中不再并列其他候选方案。

### 0.1 技术栈

| 层面 | 冻结决策 | 说明 |
| --- | --- | --- |
| 语言 | TypeScript 全栈 | 桌面端、Web 端、服务端、CLI、各 packages 统一使用 TypeScript |
| 桌面端 | Electron | 原生安装、零环境依赖的桌面交付形态 |
| Web 端 | React + Vite | 浏览器访问形态，与桌面端功能对齐 |
| 服务端 | Node.js + Fastify | 提供 REST API、WebSocket、静态资源托管 |
| 本地存储 | SQLite3（`node:sqlite`） | 使用 Node 24 内置的 `node:sqlite` 模块，**零原生编译依赖**，无需 `better-sqlite3` 等需要本地编译的驱动 |
| 密码哈希 | `node:crypto` 的 scrypt | 标准库实现，无第三方依赖 |
| 加密 | AES-256-GCM | 用于连接密码、AI API Key、SSH/SSL 配置等敏感数据 |
| 口令令牌 | JWT（HS256） | 登录态与 API 鉴权令牌 |
| 运行环境 | Node.js >= 22.5（推荐 24 LTS）、pnpm 11 | `node:sqlite` 自 Node 22.5 起可用；推荐 24 LTS 以获得稳定支持 |
| 仓库形态 | pnpm monorepo | `apps/{server,cli,web,desktop}` + `packages/{core,storage,auth,drivers,ai,migration,visualization}` |

### 0.2 命名与路径约定

| 约定项 | 取值 |
| --- | --- |
| 本地数据目录 | `~/.peanutsprout/` |
| 本地库文件 | `peanutsprout.db` |
| 可执行文件 | `peanutsprout` |
| 安装包命名 | `PeanutSprout-Setup-{version}-{os}-{arch}.{ext}` |

### 0.3 原文 Java 风格接口的 TypeScript 等价映射

原文《模块清单、接口定义与数据库 DDL》第二部分使用了 Java 风格的接口定义（`DatabaseDriver`、`ConnectionConfig`、`MetadataProvider`、`QueryExecutor`、`MigrationProvider`、`AiProvider`、`AuditService` 等）。**本项目为 TypeScript 全栈，不采用 Java 方案**；这些接口在本项目中以 **TypeScript 等价接口**实现，接口名、方法语义、职责边界与原文保持一致，差异仅在于语言与异步表达方式（`Promise` / `async`）。

映射关系总表如下，完整等价接口定义见[附录 A](#附录-a接口定义typescript-等价映射)：

| 原文（Java 风格） | 本项目（TypeScript 等价） | 语义说明 |
| --- | --- | --- |
| `interface DatabaseDriver` | `interface DatabaseDriver`（`packages/core`） | 驱动 SPI 顶层抽象，方法集合与原文一致 |
| `interface ConnectionConfig` | `interface ConnectionConfig`（`packages/core`） | Java getter 映射为 TS 只读/普通属性，字段语义不变 |
| `interface MetadataProvider` | `interface MetadataProvider`（`packages/core`） | 元数据抽取方法名与返回值语义不变 |
| `interface QueryExecutor` | `interface QueryExecutor`（`packages/core`） | 执行、取消、执行计划、事务控制语义不变 |
| `interface MigrationProvider` | `interface MigrationProvider`（`packages/migration`） | 预检、迁移、同步、取消、断点续传语义不变 |
| `interface AiProvider` | `interface AiProvider`（`packages/ai`） | NL2SQL、解释、优化、文档、问答、诊断语义不变 |
| `interface AuditService` | `interface AuditService`（`packages/auth`） | 记录、检索、导出、归档、清理、哈希链语义不变 |
| `throws XxxException` | `Promise` 拒绝（`reject` / `throw`） | 错误类型以 TS 错误类等价表达 |
| JDBC / ODBC 驱动、JAR 包 | Node.js 驱动适配器模块（`packages/drivers`） | 「自定义驱动」等价实现为可加载的 Node 驱动模块 |
| `bcrypt / argon2` 密码哈希 | `node:crypto` scrypt | 语义等价：加盐、慢哈希、不可逆 |
| AES-256 | AES-256-GCM | 在原文 AES-256 基础上明确认证加密模式 |

> 说明：原文中所有「Java 接口」表述，本文档均按上述映射改写为「TypeScript 等价接口」，不再重复标注。

---

## 一、产品定位与目标

### 1.1 产品定位

**一句话定位**：花生苗数据库管理工具，是一个跨平台、开箱即用的数据库统一管理客户端，集多库连接、数据迁移、可视化分析、AI 辅助管理于一体，同时提供原生桌面端和 Web 端。

**产品名称寓意**：花生苗——扎根数据土壤，破土而出，茁壮成长。象征工具轻巧、生命力强、易用落地。

**核心目标**：

- **GOAL-01** 融合主流数据库管理工具的长处，规避其短板。
- **GOAL-02** 支持异构数据库之间的数据导入、导出、转换。
- **GOAL-03** 提供统计图表可视化查看特定数据。
- **GOAL-04** 集成 AI 大模型，辅助管理库、表、字段、数据及其他操作。
- **GOAL-05** 原生 UI + Web 双端访问。
- **GOAL-06** 内置 SQLite3 管理用户、密码、操作记录。
- **GOAL-07** 多平台、多架构安装包，安装即用，零环境依赖。
- **GOAL-08** 界面美观，使用方便。
- **GOAL-09** 以 AGPL-3.0 协议开源，保证社区自由使用与二次开发。

### 1.2 非目标（明确不做）

- **NGOAL-01** 不做数据库服务端本身，只做客户端/管理端。
- **NGOAL-02** 不做数据库内核级别的性能优化。
- **NGOAL-03** 不替代专业 ETL 平台做超大规模离线数仓调度（但支持中小规模迁移）。

---

## 二、设计原则：取长补短

| 来源工具 | 取其长处 | 规避其弊端 |
| --- | --- | --- |
| DBeaver | 跨库支持广、JDBC 驱动生态、开源免费思路 | 界面朴素、启动慢、大数据量卡顿 |
| Navicat | 界面美观、数据同步/结构对比强、易上手 | 收费高、跨库能力弱于 DBeaver |
| DataGrip | 智能补全、重构、Git 集成 | 订阅贵、运维功能弱、资源占用高 |
| 厂商原生工具 | 深度调试、性能诊断、驱动免配 | 只支持自家库、界面风格割裂 |
| 命令行工具 | 脚本化、自动化 | 门槛高、无可视化 |
| 监控类工具 | 指标看板、告警 | 不擅长写 SQL、不擅长数据操作 |

**花生苗的综合原则**：

- **PRIN-01** 跨库能力对标 DBeaver，界面与易用性对标 Navicat，智能补全对标 DataGrip，深度诊断按库做适配，脚本化能力保留命令行导出接口。
- **PRIN-02** 所有能力在一个应用内完成，不要求用户切换多个工具。
- **PRIN-03** 开源协议采用 AGPL-3.0，确保网络服务场景下的开源性，保护作者与社区权益。

---

## 三、目标平台与交付形态

### 3.1 支持平台

| 编号 | 操作系统 | 架构 | 安装包格式 |
| --- | --- | --- | --- |
| PLAT-01 | Windows | x86_64 | `.exe`（NSIS 或 MSI） |
| PLAT-02 | Windows | arm64 | `.exe` |
| PLAT-03 | Linux | x86_64 | `.deb` / `.rpm` / AppImage |
| PLAT-04 | Linux | arm64 | `.deb` / `.rpm` / AppImage |
| PLAT-05 | macOS | x86_64 (Intel) | `.dmg` / `.pkg` |
| PLAT-06 | macOS | arm64 (Apple Silicon) | `.dmg` / `.pkg` |

### 3.2 零环境依赖要求

- **PLAT-07** 安装包内置运行时（本项目为内置 Node.js 运行时，随 Electron 打包），用户无需自行安装 Java/Python/Node。
- **PLAT-08** 数据库驱动全部内置，无需用户手动下载驱动。
- **PLAT-09** 安装后双击即可运行，首次启动完成初始化。
- **PLAT-10** 不依赖外部数据库服务即可使用本地账户体系（数据落在本地 SQLite3）。

### 3.3 双端形态

- **PLAT-11** **桌面端**：原生 UI，本地安装，功能完整。
- **PLAT-12** **Web 端**：浏览器访问，功能与桌面端对齐，支持多用户并发。
- **PLAT-13** **二者关系**：桌面端可作为 Web 服务端启动，也可作为纯客户端连接远程 Web 服务端。数据与配置可同步。

---

## 四、功能需求

### 4.1 数据库连接管理

**FR-4.1-01 支持的数据库类型（首批）**

- 关系型：MySQL、MariaDB、PostgreSQL、Oracle、SQL Server、SQLite、金仓 KingbaseES、达梦、OceanBase、TiDB。
- 键值：Redis。
- 文档：MongoDB。
- 列存/分析：ClickHouse。
- 时序：InfluxDB。
- 图：Neo4j。
- 后续通过驱动插件机制扩展。

**FR-4.1-02 连接方式**

- 主机/端口/库名/用户名/密码。
- SSH 隧道、SSL/TLS、代理。
- 连接串 URL 直接粘贴解析。
- 云数据库快捷模板。

**FR-4.1-03 连接管理**

- 连接分组、标签、搜索、收藏。
- 连接测试、超时设置、字符集设置。
- 连接颜色标识，防止误操作生产库。
- 只读模式锁定，防止误写。
- 密码加密存储，支持主密码解锁。

**FR-4.1-04 驱动管理**

- 内置常用驱动。
- 支持手动添加自定义驱动（原文为 JDBC/ODBC 驱动，本项目等价实现为 Node.js 驱动适配器模块）。
- 驱动版本管理与冲突检测。

### 4.2 对象管理与 SQL 开发

**FR-4.2-01 对象树**

- 库、模式、表、视图、物化视图、存储过程、函数、触发器、序列、索引、约束、用户、角色等。
- 右键菜单覆盖常见 DDL/DML 操作。
- 对象搜索、过滤、跳转。

**FR-4.2-02 SQL 编辑器**

- 语法高亮、智能补全。
- 多标签页、多光标、代码折叠、格式化。
- 执行计划查看、执行历史、慢 SQL 标记。
- 结果集编辑。
- 结果集导出（CSV、Excel、JSON、SQL、Markdown）。
- 大结果集分页/流式加载。

**FR-4.2-03 表设计器**

- 可视化建表、改表、删表。
- 字段类型、长度、默认值、注释、索引、外键可视化配置。
- 生成对应 DDL 预览与执行。
- 表结构对比。

**实现状态（本轮更新，如实标注，不做"已经全做完了"的暗示）**

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 可视化建 Schema / 数据库 | ✅ 已实现 | `POST /ddl/create-schema`。按方言生成 `CREATE SCHEMA` / `CREATE DATABASE`；**SQLite 明确报"不支持"**（它的库就是文件，换库靠 `ATTACH DATABASE`） |
| 可视化建表 | ✅ 已实现 | `POST /ddl/preview` + `/ddl/execute`。表名、所属 Schema、列（名称/类型/长度/可空/主键/默认值/注释）、索引（名称/列/唯一）、`IF NOT EXISTS` 都能可视化配置 |
| DDL 预览 | ✅ 已实现 | `/ddl/preview` **只生成、不执行**；界面必须先生成预览、且预览对应当前表单（指纹一致）才允许执行 |
| 执行 DDL | ✅ 已实现 | `/ddl/execute` 要求 `confirm: true` 否则 428，并走与 SQL 开发页相同的写闸门（权限/连接只读/资源授权） |
| 可视化删表 | ✅ 已实现 | `POST /ddl/drop-table`，删前先确认表存在，给出"数据表不存在"而不是方言化报错 |
| 字段类型建议清单 | ✅ 已实现 | `GET /ddl/column-types/:id`，按方言族区分（`jsonb` 不给 MySQL、`mediumint` 不给 PostgreSQL） |
| 改表（ALTER） | ⬜ 未实现 | `DdlGenerator` 已有 `addColumn`/`alterColumn`/`dropColumn`，但**没有接 UI 与路由**；SQLite 的 `alterColumn` 本身就返回"需重建表"的说明 |
| 外键可视化配置 | ⬜ 未实现 | 建表表单目前不提供外键；`ConstraintInfo` 与 `listConstraints` 已存在，但缺少生成外键 DDL 的接口 |
| 表结构对比（diff） | ⬜ 未实现 | 无差异计算与 ALTER 脚本生成 |
| 注释落库 | 🟡 部分 | 注释会传给驱动的 `ColumnInfo.comment`，但 **SQLite 没有列注释语法**，当前 SQLite 的 `createTable` 会忽略它 |

**FR-4.2-04 数据编辑**

- 表格视图直接编辑数据。
- 批量替换、批量删除、批量插入。
- 数据校验。
- 事务控制与回滚。

**实现状态（本轮更新）**

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 表格视图直接编辑 | ✅ 已实现 | `/data/table/*` + `TableDataPage.tsx`。分页、列头排序、内联改单元格、插入行、勾选删除 |
| 批量删除 | ✅ 已实现 | `POST /data/table/delete` 接受 1–1000 个 key，逐行执行 |
| 批量插入 | ✅ 已实现 | 界面一次可新增多行，逐行调用 `POST /data/table/insert` |
| 数据校验 | 🟡 部分 | 已有：非空列不允许被改成 `NULL`、新增时非空且无默认值的列必须填写、列名/表名走标识符白名单、值一律走绑定参数。**未做**：按类型的格式校验（如邮箱、日期格式、长度上限）在客户端与服务端都还没有 |
| 批量替换 | ⬜ 未实现 | 没有"把某列的所有旧值替换为新值"的功能；这需要一个跨行的 UPDATE，属于另一条写路径 |
| 事务控制与回滚 | ⬜ **未实现（且有明确原因）** | `QueryExecutor` 接口**没有** begin/commit/rollback，表数据的写操作是**逐行、无事务**的。批量保存中途失败会留下已成功的部分，界面会如实报告 `inserted`/`updated`/`deleted` 的**实际条数**，不会假装整体成功。要补这一条必须先给 `QueryExecutor` 加事务接口并在三个驱动里实现 |

**安全约束（贯穿上面两条）**

- 更新与删除**必须带定位符**：优先主键；没有主键时退到一个**唯一索引且其全部列都 `NOT NULL`**；
  两者都没有时 `kind: 'none'`，**明确拒绝更新与删除，只允许读取与新增**。
  绝不退化成"按内容模糊匹配"—— 那会在用户只看到改了一行的情况下悄悄改掉多行。
- 受影响行数不是 1 就报错（0 → `NOT_FOUND`，>1 → `CONFLICT` 并中止）。
- 界面给的 `key` 必须**恰好**覆盖定位符的列（少一列可能匹配多行、多一列说明定位符过期）。
- 所有写操作走 `assertCanWrite`（与 SQL 开发页同一道闸门），**被拒绝的尝试也落审计**。

**FR-4.2-05 ER 图**

- 自动生成 ER 图。
- 拖拽布局、导出图片、导出 SQL。

### 4.3 数据导入导出与异构转换

**FR-4.3-01 导入**

- 文件格式：CSV、Excel、JSON、XML、SQL 脚本、Parquet。
- 来源：本地文件、剪贴板、另一数据库、URL。
- 字段映射：可视化拖拽。
- 类型转换：自动推断 + 手动覆盖。
- 预处理：去重、过滤、脱敏、格式转换。
- 批量提交、断点续传、失败重试。

**FR-4.3-02 导出**

- 格式：CSV、Excel、JSON、XML、SQL、Parquet、Markdown、PDF。
- 范围：整库、整表、查询结果、选中行。
- 定时导出、增量导出。

> **本版落地情况（如实标注，避免"PRD 写了就当实现了"）**
>
> | 能力 | 状态 |
> | --- | --- |
> | 查询结果 → `.xlsx` | ✅ 已实现（`POST /data/export/xlsx`）。零依赖手写 OOXML，不引入 Excel 库 |
> | 查询结果 → 另一个数据库的表 | ✅ 已实现（`POST /data/export/to-connection`），目标端走同一道写闸门 |
> | 查询结果 → CSV | ✅ 已实现，但入口在**审计日志导出**（`GET /audit/logs/export`），不是通用结果集导出 |
> | AI 对话里直接触发导出 | ✅ 已实现：AI 生成 SQL 后，结果块上有「导出 Excel」「导出到数据库」两个动作 |
> | JSON / XML / SQL / Parquet / Markdown / PDF | ⬜ 未实现 |
> | 整库 / 整表导出为文件 | ⬜ 未实现（有跨库**迁移**，但不产出文件） |
> | 文件**导入**（CSV/Excel/JSON/SQL 等） | ⬜ 未实现 |
> | 定时导出、增量导出 | ⬜ 未实现 |

**FR-4.3-03 异构数据库转换**

- 源库 → 目标库，自动做类型映射。
- 表结构自动迁移。
- 数据迁移（全量 + 增量）。
- 迁移前预检。
- 迁移报告。
- 支持双向。

**FR-4.3-04 数据同步**

- 一次性同步。
- 定时同步。
- 增量同步。
- 冲突策略：覆盖、跳过、报错、人工确认。

### 4.4 数据可视化与统计图表

**FR-4.4-01 图表类型**

- 条形图、柱状图、折线图、面积图、饼图、环形图、散点图、气泡图。
- 并行图（平行坐标图）。
- 热力图、雷达图、桑基图、树图、箱线图。
- 地图（可选）。

**FR-4.4-02 数据来源**

- 直接对表/视图生成图表。
- 对 SQL 查询结果生成图表。
- 手动配置维度、指标、聚合方式。

**FR-4.4-03 交互**

- 图表联动、下钻、筛选。
- 图表保存为看板。
- 看板分享。
- 导出图片、PDF。

**FR-4.4-04 实时刷新**

- 手动刷新、定时刷新、WebSocket 推送。

### 4.5 AI 大模型辅助管理

**FR-4.5-01 接入方式**

- 支持多家大模型 API：OpenAI、Anthropic、Google、通义千问、文心一言、智谱、DeepSeek、本地 Ollama 等。
- 用户可配置 API Key、模型名、温度、超时。
- 支持私有化部署模型接入。

**FR-4.5-02 AI 能力场景**

- 自然语言转 SQL。
- SQL 解释。
- SQL 优化建议。
- 库/表/字段管理。
- 数据操作（DML 需二次确认）。
- 数据问答。
- 文档生成。
- 错误诊断。

**FR-4.5-03 安全与可控**

- AI 生成的 SQL/DML 必须经用户确认才执行。
- 生产库默认禁止 AI 直接执行写操作。
- 敏感字段脱敏后再发给大模型。
- 支持完全禁用 AI 功能。
- 所有 AI 操作记入操作日志。
- **生成后必须显式二选一**：界面在 SQL 结果上给出「执行」与「复制」两个动作，
  不存在"AI 自己跑掉了"的路径；点「执行」仍要过后端写闸门与二次确认。
- **对话可撤回、可回退到指定操作**：撤回 = 删掉该轮对话 + 删掉服务端对应的
  `ai_history` 记录；回退到某次操作 = 截断其后的对话 + 删除其后的调用记录 +
  **把当时的输入放回输入框**。撤回的语义边界必须写清楚：它抹的是"这次操作留下的
  记录"，**不是**数据库事务回滚 —— 已经执行过的写操作不会被撤回撤销。
- **发送后清空输入框**：已发出的内容不在输入框里留存（只清本技能用到的字段）。

### 4.6 用户与权限管理（本地 SQLite3）

**FR-4.6-01 本地 SQLite3 数据库**

- 存储用户账户、密码哈希、角色、权限。
- 存储连接配置（加密）。
- 存储操作记录、审计日志。
- 存储 AI 配置、界面偏好、看板配置。
- 数据库文件位置可配置，支持备份/恢复。

**FR-4.6-02 用户体系**

- 多用户、多角色。
- 密码哈希存储，不明文。
- 登录、登出、修改密码、找回密码。
- 可选双因素认证。

**FR-4.6-03 权限控制**

- 按连接、按库、按表、按操作类型授权。
- 只读用户禁止写操作。
- 敏感操作二次确认。

**FR-4.6-04 操作记录/审计日志**

- 记录谁、何时、对哪个库/表、执行了什么操作。
- 记录 SQL 原文、执行结果、耗时、影响行数。
- 支持按用户、时间、库、操作类型检索。
- 日志导出、归档、清理策略。

### 4.7 界面与交互

**FR-4.7-01 原生 UI**

- 桌面端使用原生或接近原生的 UI 框架。
- 支持深色/浅色主题、自定义主题色。
- 支持多语言。
- 高 DPI 适配、字体缩放。

**实现状态（本轮更新）**

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 深色/浅色主题 | ✅ 已实现 | `apps/web/src/state/theme.tsx` 切换 `document.documentElement.dataset.theme`，持久化到 `localStorage`，默认跟随 `prefers-color-scheme`。**本轮修掉了一个真实缺陷**：AI 页与语言菜单那一整块 CSS 引用了 8 个**从未定义过**的变量名（`--surface-1` / `--border-1` / `--accent-1` …），而 `var(--不存在, #fff)` 不会报错、会**静默**使用浅色回退值，导致深色皮肤下依然白底黑字。已统一回 `--color-*` 命名，并新增 `theme.test.ts` 守住三类"静默失效"（引用未定义变量 / 主题变量只在浅色定义 / 主题块外写死颜色） |
| 自定义主题色 | ⬜ 未实现 | 目前只有一套品牌绿 + 一个蓝色强调色，没有让用户自选主题色的入口 |
| 多语言 | ✅ 已实现 | 六种语言、11 个命名空间，零漏译；`MessageKey` 有编译期约束（拼错键名直接构建失败） |
| 高 DPI 适配、字体缩放 | 🟡 部分 | Electron 侧按设备像素比处理；界面上没有独立的字体缩放控件，依赖系统/浏览器缩放 |

**FR-4.7-02 布局**

- 左侧连接/对象树，中间编辑区，右侧辅助面板。
- 可拖拽、可折叠、可保存布局。
- 多窗口/多标签。

**FR-4.7-03 易用性**

- 常用操作不超过 2 次点击。
- 全局搜索。
- 快捷键可自定义。
- 新手引导与示例连接。

**FR-4.7-04 美观**

- 统一设计语言。
- 图表风格统一。
- 动画克制。

### 4.8 Web 端

**FR-4.8-01 访问方式**

- 浏览器访问，无需安装。
- 响应式布局。
- 支持 HTTPS。

**FR-4.8-02 功能对齐**

- 连接管理、SQL 编辑、数据编辑、导入导出、图表、AI、用户管理、审计日志。
- 本地文件相关操作通过上传/下载实现。

**FR-4.8-03 多用户并发**

- 会话隔离。
- 连接池管理。
- 权限与桌面端一致。

**FR-4.8-04 部署形态**

- 桌面端一键启动 Web 服务。
- 独立服务端部署（Docker / 二进制）。
- 反向代理、负载均衡支持。

### 4.9 扩展与集成

**FR-4.9-01 插件机制**

- 数据库驱动插件。
- 图表插件。
- AI 模型插件。
- 导出格式插件。

**FR-4.9-02 API**

- 提供本地 REST API / CLI。
- 支持自动化任务。

**FR-4.9-03 第三方集成**

- Git 集成。
- 企业 SSO（可选）。
- 消息通知。

---

## 五、非功能需求

### 5.1 性能

- **NFR-5.1-01** 启动时间：桌面端冷启动 ≤ 3 秒。
- **NFR-5.1-02** 连接建立：≤ 2 秒。
- **NFR-5.1-03** SQL 执行：结果集 10 万行以内不卡顿。
- **NFR-5.1-04** 导入导出：100 万行级别可完成。
- **NFR-5.1-05** 内存占用：空闲 ≤ 500MB，正常使用 ≤ 2GB。
- **NFR-5.1-06** Web 端并发：单机支持 ≥ 50 并发用户。

### 5.2 安全

- **NFR-5.2-01** 密码、API Key 加密存储（AES-256，本项目实现为 AES-256-GCM）。
- **NFR-5.2-02** 传输加密（TLS）。
- **NFR-5.2-03** SQL 注入防护。
- **NFR-5.2-04** 敏感数据脱敏。
- **NFR-5.2-05** 审计日志不可篡改（可选哈希链）。
- **NFR-5.2-06** 本地 SQLite 文件权限控制。
- **NFR-5.2-07** 自动锁定。

### 5.3 可靠性

- **NFR-5.3-01** 崩溃恢复。
- **NFR-5.3-02** 数据迁移失败可回滚。
- **NFR-5.3-03** 日志分级、可追踪。
- **NFR-5.3-04** 自动更新。

### 5.4 兼容性

- **NFR-5.4-01** 数据库版本覆盖主流版本。
- **NFR-5.4-02** 操作系统版本覆盖主流。
- **NFR-5.4-03** 字符集兼容。

### 5.5 可维护性

- **NFR-5.5-01** 模块化架构。
- **NFR-5.5-02** 配置外置。
- **NFR-5.5-03** 日志与诊断包一键导出。

### 5.6 国际化

- **NFR-5.6-01** 界面文案可翻译。
- **NFR-5.6-02** 日期、数字、时区本地化。

### 5.7 可访问性

- **NFR-5.7-01** 键盘全操作。
- **NFR-5.7-02** 屏幕阅读器支持。
- **NFR-5.7-03** 高对比度模式。

---

## 六、品牌与命名规范

- **BRAND-01** 产品中文名：花生苗数据库管理工具。
- **BRAND-02** 产品英文名：PeanutSprout DB Manager（暂定）。
- **BRAND-03** 产品简称：花生苗。
- **BRAND-04** Logo 建议：花生苗破土而出的抽象图形，绿色为主色调，象征生长与数据生命力。
- **BRAND-05** 命名使用：
  - 安装包名称：`PeanutSprout-Setup-{version}-{os}-{arch}.{ext}`
  - 可执行文件：`peanutsprout`
  - 配置目录：`~/.peanutsprout/`
  - 本地数据库：`peanutsprout.db`
- **BRAND-06** 版权声明：Copyright (C) 2025 飞哥。保留所有权利。

---

## 七、开源协议与社区

### 7.1 协议

- **OSS-01** 协议：GNU Affero General Public License v3.0（AGPL-3.0）。

### 7.2 权利

- **OSS-02** 任何人可自由使用、修改、分发本软件。
- **OSS-03** 修改后的版本必须以 AGPL-3.0 开源。
- **OSS-04** 以网络服务形式提供本软件功能，也必须开源完整源代码。

### 7.3 义务

- **OSS-05** 保留版权声明与协议文本。
- **OSS-06** 标注修改内容。
- **OSS-07** 提供源代码获取方式。

### 7.4 商业授权

- **OSS-08** 如需闭源商业使用，需获得作者飞哥书面授权。
- **OSS-09** 联系方式：微信 6731663。

### 7.5 贡献

- **OSS-10** 欢迎社区提交 Issue、PR。
- **OSS-11** 贡献者需签署 CLA（贡献者许可协议）。

### 7.6 版权归属

- **OSS-12** 项目版权归作者飞哥所有。
- **OSS-13** 社区贡献部分按 AGPL-3.0 授权。

---

## 八、数据模型概览

本地 SQLite3 核心表（原文概览）：

| 编号 | 表名 | 用途 |
| --- | --- | --- |
| DM-01 | `users` | 用户账户、密码哈希、角色 |
| DM-02 | `roles` | 角色定义 |
| DM-03 | `permissions` | 权限项 |
| DM-04 | `user_roles` | 用户-角色关联 |
| DM-05 | `connections` | 数据库连接配置（加密） |
| DM-06 | `connection_groups` | 连接分组 |
| DM-07 | `ai_configs` | AI 模型配置（加密 Key） |
| DM-08 | `query_history` | SQL 执行历史 |
| DM-09 | `audit_logs` | 操作审计日志 |
| DM-10 | `dashboards` | 看板配置 |
| DM-11 | `charts` | 图表配置 |
| DM-12 | `settings` | 全局设置 |
| DM-13 | `migrations` | 数据迁移任务与结果 |
| DM-14 | `schedules` | 定时任务 |
| DM-15 | `plugins` | 插件注册信息 |

原文 DDL 中另有下列表，与上表共同构成完整本地库结构：

| 编号 | 表名 | 用途 |
| --- | --- | --- |
| DM-16 | `role_permissions` | 角色-权限关联 |
| DM-17 | `resource_grants` | 资源级授权（连接/库/表） |
| DM-18 | `drivers` | 驱动注册 |
| DM-19 | `ai_history` | AI 调用历史 |
| DM-20 | `migration_checkpoints` | 迁移检查点（断点续传） |
| DM-21 | `migration_errors` | 迁移失败明细 |
| DM-22 | `schema_migrations` | 本地库结构版本 |

初始化设置：`PRAGMA foreign_keys = ON;`、`PRAGMA journal_mode = WAL;`、`PRAGMA synchronous = NORMAL;`、`PRAGMA encoding = 'UTF-8';`

完整 DDL（建表语句、索引、内置角色与权限初始数据）见[附录 C](#附录-c本地-sqlite3-ddl)。

---

## 九、验收标准

原文验收标准共 10 条，编号 `AC-01`～`AC-10`，与 `docs/acceptance.md` 逐条对应。当前达成状态见 `docs/acceptance.md`。

- **AC-01** 在 Windows x86_64 上安装花生苗后，双击可启动，无需安装 Java/Python/Node。
- **AC-02** 能同时连接 MySQL 和 PostgreSQL，并把 MySQL 一张表连结构带数据迁移到 PostgreSQL，类型自动映射，报告显示成功条数。
- **AC-03** 对一张订单表，能生成折线图、条形图、平行坐标图，并保存为看板。
- **AC-04** 输入自然语言「查最近 7 天订单金额前 10 的用户」，AI 生成 SQL，用户确认后执行并返回结果。
- **AC-05** 普通用户登录后只能看授权的连接，且不能执行 DELETE。
- **AC-06** 所有写操作在审计日志中可查到操作人、时间、SQL、影响行数。
- **AC-07** Web 端与桌面端看到同一份连接配置和看板。
- **AC-08** macOS arm64 安装包在 M 系列芯片上原生运行，不通过 Rosetta。
- **AC-09** 项目根目录包含 LICENSE 文件，内容为 AGPL-3.0 全文。
- **AC-10** 项目 README 中注明产品名花生苗数据库管理工具、作者飞哥、微信 6731663、开源协议 AGPL-3.0。

---

## 十、补充需求（作者替读者想到的点）

- **SR-01** 只读模式与生产库保护。
- **SR-02** 敏感数据脱敏。
- **SR-03** 离线可用。
- **SR-04** AI 可完全禁用。
- **SR-05** SQL 版本管理。
- **SR-06** 执行计划可视化。
- **SR-07** 慢 SQL 自动标记。
- **SR-08** 连接颜色与生产标识。
- **SR-09** 断点续传与失败重试。
- **SR-10** 迁移预检报告。
- **SR-11** 定时任务。
- **SR-12** 数据字典自动生成。
- **SR-13** 多语言与主题。
- **SR-14** 插件市场。
- **SR-15** CLI/API。
- **SR-16** 审计日志哈希链。
- **SR-17** 自动更新与离线包。
- **SR-18** 诊断包一键导出。
- **SR-19** 高 DPI 与字体缩放。
- **SR-20** 快捷键自定义。
- **SR-21** 会话恢复。
- **SR-22** 连接池与超时。
- **SR-23** 数据对比工具。
- **SR-24** 批量操作。
- **SR-25** 合规与隐私。

---

## 十一、风险与约束

- **RK-01** 跨库类型映射无法 100% 完美，需明确「尽力映射 + 人工确认」。
- **RK-02** AI 生成 SQL 存在错误风险，必须强制人工确认。
- **RK-03** 多平台多架构打包与测试成本高，需持续集成支持。
- **RK-04** Web 端暴露在公网时需额外安全加固。
- **RK-05** 部分数据库驱动有许可证限制，需法务确认。
- **RK-06** AGPL-3.0 对网络服务场景有开源要求，商业闭源需另行授权。
- **RK-07** 产品名称「花生苗」需确认商标可用性，避免侵权。
- **RK-08** 本地 SQLite3 采用 Node 内置 `node:sqlite`，要求 Node.js >= 22.5；在更低版本运行时会启动失败，需在安装包内置满足版本的运行时。

---

## 附录 A：接口定义（TypeScript 等价映射）

> 本附录对应原文《模块清单、接口定义与数据库 DDL》第二部分。原文为 Java 风格接口定义，此处按 §0.3 冻结决策改写为 TypeScript 等价接口，**方法语义与原文一致**。

### A.1 驱动 SPI 接口（`packages/core`）

```ts
export interface DatabaseDriver {
  getName(): string;
  getVersion(): string;
  getSupportedVersions(): string[];

  connect(config: ConnectionConfig): Promise<Connection>;
  disconnect(connection: Connection): Promise<void>;
  testConnection(config: ConnectionConfig): Promise<boolean>;

  getMetadataProvider(): MetadataProvider;
  getQueryExecutor(): QueryExecutor;
  getDdlGenerator(): DdlGenerator;
  getTypeMapper(): TypeMapper;
  getExplainParser(): ExplainParser;
  getMigrationProvider(): MigrationProvider;
}
```

### A.2 连接配置接口（`packages/core`）

```ts
export interface ConnectionConfig {
  id: string;
  name: string;
  type: DatabaseType;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;            // 加密存储（AES-256-GCM），运行时解密
  isReadOnly: boolean;
  colorTag?: string;
  sshTunnel?: SshTunnelConfig;
  ssl?: SslConfig;
  extraParams?: Record<string, string>;
}
```

### A.3 元数据接口（`packages/core`）

```ts
export interface MetadataProvider {
  listSchemas(): Promise<SchemaInfo[]>;
  listTables(schema: string): Promise<TableInfo[]>;
  listColumns(schema: string, table: string): Promise<ColumnInfo[]>;
  listIndexes(schema: string, table: string): Promise<IndexInfo[]>;
  listConstraints(schema: string, table: string): Promise<ConstraintInfo[]>;
  listViews(schema: string): Promise<ViewInfo[]>;
  listProcedures(schema: string): Promise<ProcedureInfo[]>;
  listTriggers(schema: string): Promise<TriggerInfo[]>;
  listUsers(): Promise<UserInfo[]>;
}
```

### A.4 查询执行接口（`packages/core`）

```ts
export interface QueryExecutor {
  execute(sql: string, options: QueryOptions): Promise<QueryResult>;
  cancel(queryId: string): Promise<void>;
  explain(sql: string): Promise<ExecutionPlan>;
  executeUpdate(sql: string): Promise<number>;
  beginTransaction(): Promise<boolean>;
  commit(): Promise<boolean>;
  rollback(): Promise<boolean>;
}
```

### A.5 迁移接口（`packages/migration`）

```ts
export interface MigrationProvider {
  precheck(request: MigrationRequest): Promise<MigrationPrecheckResult>;
  migrate(request: MigrationRequest, callback: ProgressCallback): Promise<MigrationResult>;
  sync(request: SyncRequest, callback: ProgressCallback): Promise<MigrationResult>;
  cancel(migrationId: string): Promise<void>;
  resume(migrationId: string): Promise<MigrationResult>;
}
```

### A.6 AI 接口（`packages/ai`）

```ts
export interface AiProvider {
  getName(): string;
  generateSql(naturalLanguage: string, context: SchemaContext): Promise<SqlGenerationResult>;
  explainSql(sql: string): Promise<string>;
  optimizeSql(sql: string, plan: ExecutionPlan): Promise<OptimizationResult>;
  generateDocumentation(context: SchemaContext): Promise<string>;
  answerQuestion(question: string, result: QueryResult): Promise<string>;
  diagnoseError(error: string, sql: string): Promise<DiagnosisResult>;
}
```

### A.7 审计接口（`packages/auth`）

```ts
export interface AuditService {
  log(event: AuditEvent): Promise<void>;
  query(query: AuditQuery): Promise<AuditEvent[]>;
  export(query: AuditQuery, out: NodeJS.WritableStream): Promise<void>;
  archive(before: Date): Promise<void>;
  purge(before: Date): Promise<void>;
  computeHashChain(): Promise<string>;
}
```

### A.8 REST API 定义（Web 端）

**认证**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/auth/login` | 登录 |
| POST | `/api/v1/auth/logout` | 登出 |
| POST | `/api/v1/auth/refresh` | 刷新 Token |
| GET | `/api/v1/auth/me` | 当前用户 |

**连接**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/connections` | 连接列表 |
| POST | `/api/v1/connections` | 新建连接 |
| GET | `/api/v1/connections/{id}` | 连接详情 |
| PUT | `/api/v1/connections/{id}` | 更新连接 |
| DELETE | `/api/v1/connections/{id}` | 删除连接 |
| POST | `/api/v1/connections/{id}/test` | 测试连接 |

**元数据**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/connections/{id}/schemas` | 库列表 |
| GET | `/api/v1/connections/{id}/schemas/{schema}/tables` | 表列表 |
| GET | `/api/v1/connections/{id}/schemas/{schema}/tables/{table}/columns` | 字段列表 |
| GET | `/api/v1/connections/{id}/schemas/{schema}/tables/{table}/indexes` | 索引列表 |

**SQL 执行**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/query/execute` | 执行 SQL |
| POST | `/api/v1/query/cancel` | 取消执行 |
| POST | `/api/v1/query/explain` | 执行计划 |
| GET | `/api/v1/query/history` | 执行历史 |

**迁移**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/migration/precheck` | 迁移预检 |
| POST | `/api/v1/migration/start` | 开始迁移 |
| GET | `/api/v1/migration/{id}` | 迁移状态 |
| POST | `/api/v1/migration/{id}/cancel` | 取消迁移 |
| GET | `/api/v1/migration/{id}/report` | 迁移报告 |

**图表**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/charts` | 创建图表 |
| GET | `/api/v1/charts/{id}` | 图表详情 |
| GET | `/api/v1/charts/{id}/data` | 图表数据 |
| POST | `/api/v1/dashboards` | 创建看板 |
| GET | `/api/v1/dashboards/{id}` | 看板详情 |

**AI**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/ai/nl2sql` | 自然语言转 SQL |
| POST | `/api/v1/ai/explain` | SQL 解释 |
| POST | `/api/v1/ai/optimize` | SQL 优化 |
| POST | `/api/v1/ai/document` | 文档生成 |
| POST | `/api/v1/ai/ask` | 数据问答 |
| POST | `/api/v1/ai/diagnose` | 错误诊断 |

**用户与审计**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/users` | 用户列表 |
| POST | `/api/v1/users` | 新建用户 |
| PUT | `/api/v1/users/{id}` | 更新用户 |
| DELETE | `/api/v1/users/{id}` | 删除用户 |
| GET | `/api/v1/audit/logs` | 审计日志 |
| GET | `/api/v1/audit/logs/export` | 导出日志 |

### A.9 CLI 命令定义

```bash
# 连接管理
peanutsprout conn list
peanutsprout conn add --type mysql --host 127.0.0.1 --port 3306 --user root
peanutsprout conn test <conn-id>
peanutsprout conn remove <conn-id>

# SQL 执行
peanutsprout query execute --conn <conn-id> --sql "SELECT 1"
peanutsprout query execute --conn <conn-id> --file query.sql
peanutsprout query explain --conn <conn-id> --sql "SELECT ..."

# 导入导出
peanutsprout import --conn <conn-id> --table users --file users.csv
peanutsprout export --conn <conn-id> --table users --file users.csv --format csv

# 迁移
peanutsprout migrate precheck --source <src-id> --target <dst-id> --table users
peanutsprout migrate start --source <src-id> --target <dst-id> --table users
peanutsprout migrate status <migration-id>

# AI
peanutsprout ai nl2sql --conn <conn-id> --prompt "查最近7天订单前10用户"
peanutsprout ai explain --sql "SELECT ..."

# 用户与审计
peanutsprout user list
peanutsprout audit query --from 2025-01-01 --to 2025-12-31
peanutsprout audit export --file audit.csv

# 服务
peanutsprout serve --port 8080 --https
peanutsprout update check
peanutsprout diagnose export --file diag.zip
```

> **实现现状备注（由交付方补充，不改动需求原文）**：上方是需求方给出的**目标形态**示例，其中部分命令**尚未实现**，
> 照抄会失败。当前实际可用的写法是：
> - `peanutsprout serve [--host <addr>] [--port <port>] [--no-web]` —— **没有** `--https`；
>   启用 TLS 请设环境变量 `PEANUTSPROUT_TLS_KEY` 与 `PEANUTSPROUT_TLS_CERT`（生产更推荐反代终结 TLS）。
> - `peanutsprout audit export --out <file> --format csv|json` —— 选项名是 `--out`，不是 `--file`。
> - `peanutsprout update check` 与 `peanutsprout diagnose export` **未实现**（见 `docs/cli-reference.md` 的 ⬜ 标记）。
> 完整的命令与选项清单以 `docs/cli-reference.md` 为准。

---

## 附录 B：项目目录结构映射（原文第四部分 → 新布局）

原文「第四部分：项目目录结构建议」给出的是单一目录树（`desktop/`、`web/`、`server/`、`core/`、`drivers/` 等）。本项目采用 pnpm monorepo 布局，对应关系如下。

| 原文章节目录 | 新布局路径 | 说明 |
| --- | --- | --- |
| `LICENSE` | `LICENSE`（仓库根） | AGPL-3.0 全文（已交付） |
| `README.md` | `README.md`（仓库根） | 产品名、作者、微信、协议（已交付） |
| `CHANGELOG.md` / `CONTRIBUTING.md` / `CLA.md` | 仓库根 | 变更记录、贡献指南、贡献者许可协议（已交付） |
| `docs/PRD.md` | `docs/PRD.md` | 本文档 |
| `docs/modules.md` | `docs/modules.md` | 模块清单（含实现包与状态） |
| `docs/architecture.md` | `docs/architecture.md` | 架构设计文档 |
| `docs/api.md` | 并入 `docs/PRD.md` 附录 A；CLI 细节另见 `docs/cli-reference.md` | REST API 与 CLI 接口定义 |
| `docs/ddl.sql` | 并入 `docs/PRD.md` 附录 C | 本地 SQLite3 DDL |
| `desktop/` | `apps/desktop` | Electron 桌面端 |
| `web/` | `apps/web` | React + Vite Web 端 |
| `server/` | `apps/server` | Node.js + Fastify 服务端 |
| `cli/` | `apps/cli` | 命令行工具 |
| `core/` | `packages/core` | 领域层、领域模型与驱动 SPI |
| `drivers/`（含 `mysql/`、`postgresql/`、`oracle/`、`sqlserver/`、`sqlite/`、`kingbase/`、`dm/`、`oceanbase/`、`tidb/`、`redis/`、`mongodb/`、`clickhouse/`、`influxdb/`、`neo4j/`） | `packages/drivers` 下的同名子模块 | 驱动适配器；SQLite 真实可用，其余为占位适配器 |
| `ai/` | `packages/ai` | AI 助手模块（接口占位） |
| `migration/` | `packages/migration` | 数据迁移模块（接口占位） |
| `visualization/` | `packages/visualization` | 可视化模块（接口占位） |
| `auth/` | `packages/auth` | 用户与权限 |
| `storage/` | `packages/storage` | SQLite 存储 |
| `plugins/` | `packages/core` + `packages/drivers` | 插件框架并入核心与驱动包 |
| `i18n/` | `apps/web`（规划中） | 多语言资源 |
| `themes/` | `apps/web`（规划中） | 主题资源 |
| `scripts/` | `scripts/` | 保持不变 |
| `packaging/{windows,linux,macos}/` | `packaging/{windows,linux,macos}/` | 保持不变 |
| `tests/` | `tests/` | 保持不变 |

---

## 附录 C：本地 SQLite3 DDL

> 本附录对应原文第三部分。实现中使用 Node 24 内置 `node:sqlite` 执行，**零原生编译依赖**。

### C.1 初始化设置

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA encoding = 'UTF-8';
```

### C.2 用户与权限

```sql
-- 用户表
CREATE TABLE users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    display_name    TEXT,
    email           TEXT,
    phone           TEXT,
    status          INTEGER NOT NULL DEFAULT 1,  -- 1启用 0禁用
    is_admin        INTEGER NOT NULL DEFAULT 0,
    totp_secret     TEXT,
    totp_enabled    INTEGER NOT NULL DEFAULT 0,
    last_login_at   DATETIME,
    last_login_ip   TEXT,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until    DATETIME,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 角色表
CREATE TABLE roles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    is_builtin  INTEGER NOT NULL DEFAULT 0,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 权限项
CREATE TABLE permissions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT NOT NULL UNIQUE,   -- 如 conn.read, table.write
    name        TEXT NOT NULL,
    category    TEXT,
    description TEXT
);

-- 用户-角色
CREATE TABLE user_roles (
    user_id     INTEGER NOT NULL,
    role_id     INTEGER NOT NULL,
    PRIMARY KEY (user_id, role_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

-- 角色-权限
CREATE TABLE role_permissions (
    role_id       INTEGER NOT NULL,
    permission_id INTEGER NOT NULL,
    PRIMARY KEY (role_id, permission_id),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

-- 资源级授权（连接/库/表）
CREATE TABLE resource_grants (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    resource_type TEXT NOT NULL,   -- connection / schema / table
    resource_id   TEXT NOT NULL,
    actions       TEXT NOT NULL,   -- JSON 数组：["read","write"]
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_resource_grants_user ON resource_grants(user_id, resource_type);
```

### C.3 连接管理

```sql
-- 连接分组
CREATE TABLE connection_groups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    parent_id   INTEGER,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES connection_groups(id) ON DELETE CASCADE
);

-- 连接配置
CREATE TABLE connections (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    group_id        INTEGER,
    db_type         TEXT NOT NULL,       -- mysql/postgresql/...
    host            TEXT,
    port            INTEGER,
    database_name   TEXT,
    username        TEXT,
    password_enc    BLOB,                -- AES-256-GCM 加密
    connection_url  TEXT,
    ssh_config_enc  BLOB,
    ssl_config_enc  BLOB,
    extra_params    TEXT,                -- JSON
    color_tag       TEXT,
    is_read_only    INTEGER NOT NULL DEFAULT 0,
    is_favorite     INTEGER NOT NULL DEFAULT 0,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    last_used_at    DATETIME,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES connection_groups(id) ON DELETE SET NULL
);

CREATE INDEX idx_connections_group ON connections(group_id);
CREATE INDEX idx_connections_type ON connections(db_type);

-- 驱动注册
CREATE TABLE drivers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    db_type       TEXT NOT NULL,
    version       TEXT NOT NULL,
    module_path   TEXT,                  -- 驱动适配器模块路径（原文 jar_path 的 TypeScript 等价）
    is_builtin    INTEGER NOT NULL DEFAULT 0,
    enabled       INTEGER NOT NULL DEFAULT 1,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### C.4 SQL 历史

```sql
CREATE TABLE query_history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    connection_id INTEGER,
    sql_text      TEXT NOT NULL,
    sql_hash      TEXT,
    status        TEXT NOT NULL,       -- success / failed / cancelled
    error_message TEXT,
    duration_ms   INTEGER,
    affected_rows INTEGER,
    result_rows   INTEGER,
    is_slow       INTEGER NOT NULL DEFAULT 0,
    executed_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE SET NULL
);

CREATE INDEX idx_query_history_user_time ON query_history(user_id, executed_at DESC);
CREATE INDEX idx_query_history_conn ON query_history(connection_id);
CREATE INDEX idx_query_history_slow ON query_history(is_slow);
```

### C.5 审计日志

```sql
CREATE TABLE audit_logs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER,
    username      TEXT,
    action        TEXT NOT NULL,       -- connect / execute / migrate / ai / login ...
    resource_type TEXT,
    resource_id   TEXT,
    connection_id INTEGER,
    detail        TEXT,                -- JSON
    sql_text      TEXT,
    ip_address    TEXT,
    user_agent    TEXT,
    status        TEXT NOT NULL,
    error_message TEXT,
    prev_hash     TEXT,
    curr_hash     TEXT,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_audit_user_time ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_conn ON audit_logs(connection_id);
CREATE INDEX idx_audit_time ON audit_logs(created_at DESC);
```

### C.6 AI 配置与历史

```sql
CREATE TABLE ai_configs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    provider      TEXT NOT NULL,       -- openai / anthropic / ollama ...
    model_name    TEXT NOT NULL,
    api_key_enc   BLOB,
    base_url      TEXT,
    temperature   REAL NOT NULL DEFAULT 0.2,
    max_tokens    INTEGER,
    timeout_ms    INTEGER NOT NULL DEFAULT 60000,
    is_default    INTEGER NOT NULL DEFAULT 0,
    enabled       INTEGER NOT NULL DEFAULT 1,
    extra_params  TEXT,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ai_history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    config_id     INTEGER,
    scene         TEXT NOT NULL,       -- nl2sql / explain / optimize ...
    prompt        TEXT,
    response      TEXT,
    tokens_input  INTEGER,
    tokens_output INTEGER,
    duration_ms   INTEGER,
    status        TEXT NOT NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (config_id) REFERENCES ai_configs(id) ON DELETE SET NULL
);

CREATE INDEX idx_ai_history_user ON ai_history(user_id, created_at DESC);
```

### C.7 迁移与同步

```sql
CREATE TABLE migrations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    name            TEXT,
    source_conn_id  INTEGER NOT NULL,
    target_conn_id  INTEGER NOT NULL,
    source_schema   TEXT,
    target_schema   TEXT,
    tables          TEXT,              -- JSON 数组
    mode            TEXT NOT NULL,     -- full / incremental / sync
    status          TEXT NOT NULL,     -- pending / running / success / failed / cancelled
    precheck_result TEXT,
    total_rows      INTEGER,
    success_rows    INTEGER,
    failed_rows     INTEGER,
    skipped_rows    INTEGER,
    error_message   TEXT,
    started_at      DATETIME,
    finished_at     DATETIME,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (source_conn_id) REFERENCES connections(id),
    FOREIGN KEY (target_conn_id) REFERENCES connections(id)
);

CREATE INDEX idx_migrations_status ON migrations(status);
CREATE INDEX idx_migrations_user ON migrations(user_id, created_at DESC);

CREATE TABLE migration_checkpoints (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    migration_id  INTEGER NOT NULL,
    table_name    TEXT NOT NULL,
    last_key      TEXT,
    last_offset   INTEGER,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (migration_id) REFERENCES migrations(id) ON DELETE CASCADE
);

CREATE TABLE migration_errors (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    migration_id  INTEGER NOT NULL,
    table_name    TEXT,
    row_key       TEXT,
    error_message TEXT,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (migration_id) REFERENCES migrations(id) ON DELETE CASCADE
);
```

### C.8 看板与图表

```sql
CREATE TABLE dashboards (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    layout      TEXT,                  -- JSON
    is_shared   INTEGER NOT NULL DEFAULT 0,
    share_token TEXT UNIQUE,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE charts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    dashboard_id  INTEGER,
    user_id       INTEGER NOT NULL,
    name          TEXT NOT NULL,
    chart_type    TEXT NOT NULL,       -- bar / line / parallel / ...
    connection_id INTEGER,
    data_source   TEXT,                -- table / view / query
    source_ref    TEXT,
    query_sql     TEXT,
    config        TEXT NOT NULL,       -- JSON：维度、指标、聚合、样式
    refresh_mode  TEXT,                -- manual / interval / websocket
    refresh_sec   INTEGER,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE SET NULL
);

CREATE INDEX idx_charts_dashboard ON charts(dashboard_id);
```

### C.9 定时任务

```sql
CREATE TABLE schedules (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    name          TEXT NOT NULL,
    task_type     TEXT NOT NULL,       -- export / sync / report / backup
    cron_expr     TEXT NOT NULL,
    config        TEXT NOT NULL,       -- JSON
    enabled       INTEGER NOT NULL DEFAULT 1,
    last_run_at   DATETIME,
    last_status   TEXT,
    next_run_at   DATETIME,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_schedules_next ON schedules(next_run_at);
```

### C.10 插件与设置

```sql
CREATE TABLE plugins (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE,
    version       TEXT NOT NULL,
    type          TEXT NOT NULL,       -- driver / chart / ai / export
    path          TEXT NOT NULL,
    enabled       INTEGER NOT NULL DEFAULT 1,
    config        TEXT,
    installed_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE settings (
    key         TEXT PRIMARY KEY,
    value       TEXT,
    category    TEXT,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE schema_migrations (
    version     TEXT PRIMARY KEY,
    applied_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### C.11 初始化数据

```sql
-- 内置角色
INSERT INTO roles (name, description, is_builtin) VALUES
('admin',     '管理员，拥有全部权限', 1),
('developer', '开发者，可读写授权连接', 1),
('readonly',  '只读用户，仅可查询', 1);

-- 内置权限
INSERT INTO permissions (code, name, category) VALUES
('conn.read',    '查看连接',   'connection'),
('conn.write',   '管理连接',   'connection'),
('query.read',   '执行查询',   'query'),
('query.write',  '执行写操作', 'query'),
('migrate.read', '查看迁移',   'migration'),
('migrate.write','执行迁移',   'migration'),
('ai.use',       '使用 AI',    'ai'),
('user.manage',  '用户管理',   'user'),
('audit.read',   '查看审计',   'audit'),
('settings.manage','系统设置', 'settings');
```

---

## 文档落款

产品名称：花生苗数据库管理工具
作者：飞哥
微信：6731663
开源协议：AGPL-3.0
