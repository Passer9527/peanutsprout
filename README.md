# 花生苗数据库管理工具（PeanutSprout DB Manager）

> **花生苗**（PeanutSprout DB Manager）是一款跨平台、开箱即用的数据库统一管理客户端，集**多库连接、数据迁移、可视化分析、AI 辅助管理**于一体，提供**原生桌面端**与 **Web 端**两种使用形态。

<p align="left">
  <img alt="license" src="https://img.shields.io/badge/license-AGPL--3.0-blue">
  <img alt="language" src="https://img.shields.io/badge/language-TypeScript-3178c6">
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D22.5-brightgreen">
  <img alt="pnpm" src="https://img.shields.io/badge/pnpm-%3E%3D10-orange">
</p>

---

## 名称寓意

**花生苗** —— 花生深埋于土壤之中，破土而出时长成嫩绿的幼苗，向着阳光茁壮成长。

- **扎根数据土壤**：数据库是企业与开发者最底层的"土壤"，花生苗扎根于此；
- **破土而出**：把散落、异构、难以打理的数据库资产，变成一眼可见、一触可管的能力；
- **茁壮成长**：项目以开源方式持续生长，欢迎每一位贡献者一起浇灌（见 [CONTRIBUTING.md](./CONTRIBUTING.md)）。

---

## 作者与授权

| 项目 | 信息 |
| --- | --- |
| **作者** | **飞哥** |
| **微信** | **6731663** |
| **开源协议** | **AGPL-3.0-or-later**（GNU Affero General Public License v3.0 或更高版本） |
| **版权声明** | Copyright (C) 2025 飞哥 |

> 商业闭源使用需获得作者**书面授权**，请联系微信 **6731663**。

---

## 功能概览

### 已实现能力（本期 v0.1.0）

- ✅ **本地 SQLite 建表**：内置 DDL 与迁移脚本，`pnpm bootstrap` 一键初始化本地元数据库（24 张表）；
- ✅ **登录鉴权（JWT HS256）**：scrypt 口令哈希、失败锁定、会话吊销，接口按权限码鉴权；
- ✅ **资源级授权**：可把用户限定到具体连接（白名单模式），**未授权的连接按"不存在"处理（404）**，杜绝靠状态码枚举连接 id；
- ✅ **连接管理 CRUD 与测试**：创建/查询/更新/删除、连通性测试、连接串智能解析、口令 AES-256-GCM 密文存储；
- ✅ **SQL 执行与四道写操作闸门**：只读查询、参数绑定、执行计划；写语句需「权限 + 连接非只读 + 资源授权 + 二次确认（`confirm`）」，缺一即拒（428）；
- ✅ **审计日志哈希链**：操作人、时间、SQL 原文、影响行数全程留痕，逐条哈希串联，清理历史后校验依然成立；
- ✅ **7 种数据库驱动真实可用**：SQLite、PostgreSQL、KingbaseES、MySQL、MariaDB、TiDB、OceanBase。其中 **PostgreSQL 驱动已对真实服务端验证**；**MySQL 系驱动已实现但未经真实服务端验证**（本机网络无法下载 MySQL 服务端二进制，详见 [`docs/acceptance.md`](./docs/acceptance.md) 的诚实说明）；
- ✅ **数据迁移引擎**：预检（不写入任何数据）、目标驱动生成 DDL、跨方言类型映射、**分批分页迁移直至取空**、索引一并迁移、行级冲突策略、逐表报告 —— **SQLite → 真实 PostgreSQL 的跨异构库迁移已端到端实测**（`mode` 目前仅支持 `full`）；
- ✅ **AI 助手（界面已接通）**：9 类模型供应商（含 **Ollama 本地模型**）、6 个技能场景（自然语言转 SQL / 解释 / 优化 / 生成文档 / 结果集问答 / 报错诊断）；「设置 → AI 助手」可配置供应商并**保存前一键试连**，独立对话页可直接使用。**只生成不执行**（HTTP 响应带 `executed: false`，服务层返回值不含任何执行产物或结果集）、结果集出网前脱敏、生产库默认禁止 AI 写、全程留痕。**已用真实模型实机验证**：自然语言「查最近 7 天订单金额前 10 的用户」生成的 SQL 可直接执行并返回结果。详见 [`docs/ai.md`](./docs/ai.md)；
- ✅ **图表与看板**：15 种图表类型的结构化配置 → 聚合 SQL 生成（白名单防注入、按方言加引号）、图表/看板 CRUD 与取数 REST 接口、Web 端 SVG 图表渲染（`bar`/`column`/`line`/`area`/`pie`/`donut`/`scatter`/`radar`/**`parallel`** —— 覆盖 AC-03 点名的折线图、条形图、平行坐标图）；
- ✅ **REST API**：Fastify 服务端提供 `/api/v1` 统一接口，契约见 [`docs/api.md`](./docs/api.md)，含令牌续签 `POST /auth/refresh`（会话轮换语义）；
- ✅ **CLI**：命令行工具，覆盖初始化、登录、连接管理、SQL 执行、数据导入导出（CSV）、用户、审计（含导出）、AI、迁移（预检/执行/进度/取消）与更新检查，退出码与错误码一一对应；
- ✅ **Web 界面**：React 端提供登录、连接管理、SQL 控制台、**AI 助手**、图表、看板、用户与设置，**已构建通过**并可由服务端直接托管；
- ✅ **国际化（i18n）**：界面支持**六种语言** —— 简体中文（**默认**）、繁体中文、英文、俄语、日语、韩语，顶栏地球图标或「设置 → 界面语言」即时切换并记住选择。六种语言文案键**全部对齐、零漏译**；复数走 `Intl.PluralRules`（实测俄语 `1 строка` / `3 строки` / `5 строк`）；键名写错会**编译期报错**；服务端错误按稳定 `error.code` 本地化。详见 [`docs/i18n.md`](./docs/i18n.md)；
- ✅ **自动化测试与自检**：`pnpm test` 覆盖单元/集成/端到端用例（其中 MySQL 实连测试在无可达服务端时**显式跳过并打印原因**），`pnpm verify` 一键自检环境与交付物（含 `docs/ddl.sql` 与权威定义逐字节比对）。运行后的**实际项数**以命令输出为准，本文不写死数字。

### 规划中能力（Roadmap）

- 🚧 **其余 8 种驱动**：Oracle、SQL Server、达梦、Redis、MongoDB、ClickHouse、InfluxDB、Neo4j 仍为占位实现，调用时明确返回 `DRIVER_NOT_IMPLEMENTED`（绝不静默失败）；
- 🚧 **多平台安装包**：`packaging/` 下的 electron-builder 配置（Windows NSIS、macOS arm64、Linux）与图标资源已就位，**尚未在目标平台上实际产出并安装验证**；
- 🚧 **部分图表类型的浏览器内渲染**：`bubble`/`heatmap`/`sankey`/`treemap`/`boxplot`/`map` 目前显示明确的"暂不支持浏览器内渲染"占位面板，并同时展示数据表。

> 详细的版本计划见 [`docs/roadmap.md`](./docs/roadmap.md)，逐条验收状态见 [`docs/acceptance.md`](./docs/acceptance.md)。

---

## 架构与目录结构

项目采用 **pnpm monorepo** 管理，`apps/` 存放可运行的应用，`packages/` 存放可复用的能力包。

```
peanutsprout/
├── apps/
│   ├── server/       # Fastify 服务端：REST API、鉴权、审计（/api/v1）
│   ├── cli/          # 命令行工具：初始化、连接管理、SQL 执行
│   ├── web/          # React Web 端：浏览器中的管理界面（Vite，开发端口 5173）
│   └── desktop/      # Electron 桌面端：桌面壳 + 原生窗口承载 Web 能力
├── packages/
│   ├── core/         # 核心领域模型、类型定义与通用工具
│   ├── storage/      # SQLite 本地存储、DDL 与迁移管理
│   ├── auth/         # 认证与授权：JWT 签发校验、口令哈希、AES-256-GCM 加密
│   ├── drivers/      # 数据库驱动抽象层与各数据库适配实现
│   ├── ai/           # AI 辅助能力：NL2SQL、SQL 解释与优化建议
│   ├── migration/    # 数据迁移引擎：结构对比、数据搬运与校验
│   └── visualization/ # 可视化：图表配置校验、聚合 SQL 生成与看板逻辑
├── docs/             # 项目文档全集（PRD、架构、API、验收、路线图等）
├── tests/            # 跨包集成测试与端到端测试
├── packaging/        # 各平台打包配置（windows / macos / linux）
├── scripts/          # 构建、初始化、DDL 导出、校验等辅助脚本
└── package.json      # 工作区根配置与统一脚本入口
```

**技术栈**：TypeScript（全栈）、Electron（桌面端）、React（Web 端）、Fastify（服务端）、SQLite（本地库）、pnpm workspaces（monorepo）。

---

## 快速开始

### 环境要求

| 依赖 | 版本要求 |
| --- | --- |
| Node.js | **>= 22.5**（推荐 **24 LTS**） |
| pnpm | **>= 10** |

### 安装与初始化

```bash
# 1. 安装依赖
pnpm install

# 2. 初始化本地库并创建管理员账号
pnpm bootstrap
```

### 启动服务

```bash
# 启动服务端（默认 http://127.0.0.1:8787）
pnpm dev:server

# 启动 Web 开发服务器（默认 http://127.0.0.1:5173）
pnpm dev:web
```

### 使用 CLI

```bash
pnpm --filter @peanutsprout/cli exec tsx src/index.ts --help
```

### 质量校验

```bash
# 运行测试（失败即非零退出；MySQL 实连用例在无服务端时显式跳过并说明原因）
pnpm test

# 类型检查（TypeScript strict），全部工作区
pnpm typecheck

# 环境与交付自检（逐项打印通过/失败，末行给出实际项数）
pnpm verify
```

### 服务地址与默认端口

| 项目 | 默认值 |
| --- | --- |
| 服务端地址 | `http://127.0.0.1:8787` |
| API 前缀 | `/api/v1` |
| Web 开发端口 | `5173` |

### 本地数据目录

所有本地数据默认保存在用户主目录下的 `~/.peanutsprout/`：

```
~/.peanutsprout/
├── peanutsprout.db   # SQLite 本地元数据库（连接、用户、审计等）
└── master.key        # 主密钥文件（首次启动自动生成，权限 0600）
```

> 服务端日志默认输出到 **stdout**（容器交给 Docker、systemd 交给 journald），
> 目前**不写** `logs/` 目录；日志落盘与按天滚动为 ⬜ 规划中。

---

## 安全说明

- **敏感字段加密存储**：数据库连接口令、第三方 API Key 等敏感信息均以 **AES-256-GCM** 加密后落库，不以明文形式写入 `peanutsprout.db`；
- **主密钥文件**：首次启动时自动生成 `~/.peanutsprout/master.key`，文件权限收紧为 **0600**（仅当前用户可读写）。请务必备份该文件：**主密钥丢失将导致已加密的连接口令无法解密**；
- **默认管理员**：首次初始化（`peanutsprout init`，或首次 `peanutsprout serve`）会创建管理员账号，请**在首次登录后立即修改密码**，并避免使用弱口令；
  - **用户名**固定为 `admin`（可用 `PEANUTSPROUT_ADMIN_USERNAME` 覆盖）；
  - **默认就是 `admin` / `123456`**（`DEFAULT_ADMIN_USERNAME` / `DEFAULT_ADMIN_PASSWORD`），安装后可直接登录，不必去翻首启日志；用 `PEANUTSPROUT_ADMIN_PASSWORD` 可覆盖成更强口令；
  - **仅当实际口令等于内置默认口令 `123456` 时**，引导才会置 `security.must_change_password = true`。此后除「改密 / 登出 / 续签 / 查看自身」这 4 个接口外，其余请求一律返回 `403 PASSWORD_CHANGE_REQUIRED`。若用 `PEANUTSPROUT_ADMIN_PASSWORD` 指定了口令，则不置位、也不要求强制改密；
  - 改密用 CLI 的**自助改密命令 `peanutsprout passwd`**（走白名单里的 `POST /auth/change-password`，因此不会被闸门拦下；完整命令与选项见 [`docs/cli-reference.md`](./docs/cli-reference.md)）。管理员的 `peanutsprout user passwd <id>` 走 `PUT /api/v1/users/:id`，**会被闸门拦截**，必须先完成自助改密；
  - 忘了口令时不必重装：本地库就在 `~/.peanutsprout/peanutsprout.db`，删掉它可重新引导（**注意：会连同连接配置与审计日志一起清空**）；
  - 未完成强制改密前，请勿把服务端口暴露到内网之外。
- **审计留痕**：登录、连接变更、SQL 执行等关键操作写入审计日志，并以哈希链方式串联，便于事后校验是否被篡改；
- **网络暴露面**：服务端默认仅监听 `127.0.0.1`。若需对外提供服务，请自行置于反向代理与 HTTPS 之后，并严格限制访问来源。

> 更完整的威胁模型与加固建议见 [`docs/security.md`](./docs/security.md)。

---

## 开源协议

本项目采用 **GNU Affero General Public License v3.0（AGPL-3.0）** 发布，版权归作者**飞哥**所有：

```
Copyright (C) 2025 飞哥
```

完整协议全文见 [LICENSE](./LICENSE)，官方文本：<https://www.gnu.org/licenses/agpl-3.0.html>。

### 您的权利

- 可以自由地**运行、研究、修改、复制和分发**本软件；
- 可以在遵守本协议的前提下，将本软件用于商业用途；
- 分发修改版本时，可以获得相应的源代码。

### 您的义务

- **网络服务形式提供也须开源完整源代码**：AGPL-3.0 第 13 条明确规定，若您修改本程序并通过计算机网络向用户提供交互式服务，**必须向所有远程交互的用户提供获取其修改版本完整对应源代码（Corresponding Source）的途径，且不得额外收费**；
- **保留版权声明**：必须显著、恰当地保留原有的版权声明、许可声明与免责声明，不得移除或篡改；
- **标注修改**：分发基于本程序的修改版本时，必须显著标注您对文件的修改及修改日期；
- **提供源码获取方式**：以目标代码形式分发时，必须以协议允许的方式（随附源码、书面要约或等价网络访问等）提供完整的对应源代码；
- **以 AGPL-3.0 授权整体**：基于本程序的衍生作品整体必须以 AGPL-3.0 授权，不得附加任何进一步限制。

### 商业闭源授权

若您希望在**不与 AGPL-3.0 开源义务冲突**的前提下闭源商用（例如将本软件集成进闭源产品或提供闭源 SaaS 服务），需取得作者的**书面商业授权**。

> 联系方式：**飞哥，微信 6731663**。

---

## 文档索引

| 文档 | 说明 |
| --- | --- |
| [`docs/PRD.md`](./docs/PRD.md) | 产品需求文档：目标用户、场景与功能范围 |
| [`docs/architecture.md`](./docs/architecture.md) | 系统架构设计：分层、模块划分与关键流程 |
| [`docs/modules.md`](./docs/modules.md) | 模块说明：各 package 与 app 的职责边界 |
| [`docs/api.md`](./docs/api.md) | REST API 参考：端点、请求响应与错误码 |
| [`docs/ddl.sql`](./docs/ddl.sql) | 本地 SQLite 建表语句（DDL） |
| [`docs/acceptance.md`](./docs/acceptance.md) | 验收标准与验收用例 |
| [`docs/roadmap.md`](./docs/roadmap.md) | 版本路线图与迭代计划 |
| [`docs/cli-reference.md`](./docs/cli-reference.md) | CLI 命令参考手册 |
| [`docs/security.md`](./docs/security.md) | 安全设计与加固指南 |
| [`docs/deployment.md`](./docs/deployment.md) | 部署指南：服务端、Web 端与桌面端打包 |
| [`docs/i18n.md`](./docs/i18n.md) | 国际化：支持的语言、切换方式、如何加文案与加语言 |
| [`docs/ai.md`](./docs/ai.md) | **AI 助手使用指南**：在哪填 API Key、怎么接本地大模型（Ollama / LM Studio）、怎么对话、六个技能、安全红线与接口速查 |

---

## 贡献方式

我们欢迎任何形式的贡献：报告缺陷、提交功能建议、改进文档、贡献代码。

- 开发环境、分支与提交规范、代码风格、PR 流程请阅读 **[CONTRIBUTING.md](./CONTRIBUTING.md)**；
- 提交代码前必须签署贡献者许可协议：**[CLA.md](./CLA.md)**。

> **提交代码即表示您同意以 AGPL-3.0 授权您的贡献，并保证不引入与 AGPL-3.0 不兼容的第三方依赖。**

---

## 版权

Copyright (C) 2025 飞哥　保留所有权利。

本程序为自由软件，在 GNU Affero 通用公共许可证第 3 版（或您选择的任何更高版本）条款下发布。本程序按"现状"提供，不附任何担保。
