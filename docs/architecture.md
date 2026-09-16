# 花生苗数据库管理工具 · 架构设计

> 版本：0.1.0
> 版权：Copyright (C) 2025 飞哥（微信 6731663）· 协议 AGPL-3.0-or-later
> 需求来源：`docs/PRD.md`（权威需求，含附录 A 接口定义、附录 B 目录映射、附录 C 本地 SQLite3 DDL）
> 配套文档：`docs/modules.md`（模块清单与状态）、`docs/roadmap.md`（分期）、`docs/acceptance.md`（验收达成）、`docs/security.md`、`docs/deployment.md`、`docs/cli-reference.md`

---

## 0. 文档定位与状态基线

| 项 | 说明 |
| --- | --- |
| 本文定位 | 架构契约与实现索引。跨包改动先改本文与 PRD，再改代码。 |
| 需求权威 | `docs/PRD.md`。产品语义冲突时以 PRD 为准；技术实现细节以本文与代码为准。 |
| 实现基线 | 以 `docs/modules.md` §1.1「本期实现进度基线」与 `docs/acceptance.md` 为准；本文标注的状态按代码快照核对。 |
| 已落地并可核对 | `packages/core`（领域模型 + 驱动 SPI）、`packages/storage`（`node:sqlite` 访问层、scrypt/AES-256-GCM 加密、DDL 与迁移、8 个仓库）、`packages/auth`（scrypt 校验、自研 JWT HS256、RBAC 与资源授权、审计哈希链、认证服务与**会话轮换式续签**）、`packages/drivers`（**7 个真实驱动**：SQLite / PostgreSQL / KingbaseES / MySQL / MariaDB / TiDB / OceanBase + 8 个占位驱动 + 注册表 + 连接管理器）、`packages/ai`（9 类供应商适配、六类能力、脱敏网关）、`packages/migration`（引擎 + 跨异构库迁移）、`packages/visualization`（图表 SQL 生成 + 校验）、`packages/i18n`（六种语言、编译期键名约束、`Intl.PluralRules` 复数、源语言回退链）、`apps/server`（Fastify 装配、错误归一化、鉴权 preHandler、`/auth`、`/meta`、`/connections`、`/query`、`/audit`、`/users`、`/ai`、`/migration`、`/charts`、`/dashboards` 路由）、`apps/cli`（全命令链路，含 CSV 导入导出）、`apps/web`（React 界面：登录、连接、SQL、图表、看板、审计、用户、设置）、`apps/desktop`（Electron 壳 + electron-builder 多平台配置，Linux 已产出真实 deb/AppImage） |
| 尚未落地 | **Windows / macOS / arm64 安装包**：配置与图标齐全、Linux x64 已产出真实 deb/AppImage，但 Windows/macOS/arm64 未在目标平台构建与安装验证（`rpm` 因本机缺 `rpmbuild` 未出包）；**8 种占位驱动**：Oracle、SQL Server、达梦、Redis、MongoDB、ClickHouse、InfluxDB、Neo4j，调用返回 `DRIVER_NOT_IMPLEMENTED`；**部分图表类型的浏览器内渲染**：`bubble`/`heatmap`/`sankey`/`treemap`/`boxplot`/`map` 显示明确占位面板（已渲染 9 种：`bar`/`column`/`line`/`area`/`pie`/`donut`/`scatter`/`radar`/`parallel`）；**update 的 download/apply/rollback** 与 `migrate resume` 未实现（`update check` 已实现） |
| 冻结技术决策 | 见 §5；PRD §0.1 已冻结，本文不再并列候选方案，仅记录"选择理由 / 代价 / 与本决策相关的实现事实" |

### 0.1 与 PRD 的关系

PRD §0.3 与附录 A 约定：原文 Java 风格接口在项目中以 **TypeScript 等价接口**实现，接口名、方法语义、职责边界保持一致，差异仅在语言与异步表达（`Promise`）。本文 §6 列出的接口即当前仓库中的真实声明，可直接与 PRD 附录 A 对照。

---

## 1. 设计目标与硬约束

| 目标 | 含义 | 架构后果 |
| --- | --- | --- |
| 零环境依赖 | 用户安装后即可启动，不需要 Java / Python / Node（桌面端）/ 编译工具链 | 本地存储用 Node 内置 `node:sqlite`；口令哈希用 `node:crypto` scrypt；JWT 用 `node:crypto` HMAC 自研实现；全链路无原生编译依赖 |
| TypeScript 全栈 | 桌面、Web、服务端、CLI、各 packages 统一 TS | 根 `tsconfig.base.json`：`strict`、`moduleResolution: Bundler`、`target: ES2023`、`noEmit` |
| 源码优先 | 开发/运行/测试直接消费 TS 源码，不做逐包预编译 | 各包 `exports` 指向 `src/index.ts`，开发与运行用 `tsx`，测试用 `vitest` |
| 单机可离线 | 连接管理、SQL 开发、审计、迁移预检离线可用 | 领域层不依赖云服务；AI 为可选能力且可完全禁用（`AI_DISABLED`） |
| 凭据不出本机 | 连接口令 / SSH / SSL / AI Key 一律加密落库 | `packages/storage` 提供 AES-256-GCM 字段加密与主密钥管理 |
| 可审计 | 一切写操作与敏感操作留痕，链式哈希可校验 | `audit_logs` 哈希链 + `GET /api/v1/audit/verify` |
| 只读与生产库保护 | 连接级只读 + 权限码 + 生产库识别 | 驱动层 `isWriteStatement` 拦截 + `packages/auth` 的 `assertCanWrite` + 生产库 AI 写闸门 |

**本期非目标（⬜ 规划中）**：8 种占位驱动的真实实现、`incremental`/`sync` 迁移与 CDC、部分图表类型的浏览器内渲染、多平台安装包（Windows/macOS/arm64）、`update download/apply/rollback`（见 `docs/modules.md` §1.1 与 `docs/roadmap.md`）。**已实现**：跨异构库真实迁移（SQLite→真实 PostgreSQL 端到端验证）、图表与看板、AI 真实接入（六类能力 + 真实模型验证）。

---

## 2. 四层架构

### 2.1 分层图（与 `docs/modules.md` §2 一致）

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ① 表现层 Presentation                                                          │
│   apps/desktop  Electron（窗口/托盘/内嵌服务）        ← 待落地                    │
│   apps/web      React + Vite（浏览器界面，已落地基础界面）                        │
│   apps/cli      commander 命令行（peanutsprout）      ← 待落地                    │
│   apps/server   Fastify 路由与 preHandler（HTTP 适配器，已落地 /auth、/meta）      │
├───────────────────────────────────────────────────────────────────────────────┤
│ ② 应用层 Application                                                           │
│   apps/server/src/routes/*      用例编排：登录、连接管理、SQL 执行、迁移、         │
│                                 用户与授权、审计查询、AI 编排、诊断导出           │
│   packages/auth/src/service.ts  认证用例：登录/登出/改密/会话吊销/上下文构建       │
│   packages/drivers/src/registry.ts 连接管理器：会话缓存与回收                     │
├───────────────────────────────────────────────────────────────────────────────┤
│ ③ 领域层 Domain                                                                │
│   packages/core  dirver SPI（DatabaseDriver/MetadataProvider/QueryExecutor/     │
│                  DdlGenerator/TypeMapper/ExplainParser/MigrationProvider/       │
│                  AiProvider/AuditService）、连接与元数据模型、查询与执行计划模型、 │
│                  用户/角色/权限/审计模型、SQL 分类器（isWriteStatement 等）、      │
│                  错误码与 PeanutError、路径与产品元信息、图表模型                 │
├───────────────────────────────────────────────────────────────────────────────┤
│ ④ 基础设施层 Infrastructure                                                     │
│   packages/storage  node:sqlite 访问层（LocalDatabase）、DDL 与 schema 迁移、      │
│                     AES-256-GCM + scrypt + 主密钥、六类仓库（users/connections/   │
│                     audit/sessions-settings/query-history/ai-configs）           │
│   packages/drivers  7 个真实驱动 + 8 个占位驱动 + 类型映射 + 标识符方言            │
│   packages/auth     scrypt 口令校验、JWT(HS256)、RBAC/资源授权、审计仓库哈希链      │
│   packages/ai / packages/migration / packages/visualization   ← 已落地              │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 依赖方向（只允许向下 + 组合根注入）

```
表现层 ──依赖──▶ 应用层 ──依赖──▶ 领域层 ◀──实现── 基础设施层
  apps/web     apps/server        packages/core     packages/storage / drivers /
  apps/cli     packages/auth                        auth（实现 core 定义的接口）
  apps/desktop （用例服务）
                       组合根（apps/server/src/context.ts）在启动时装配并注入实现
```

规则：

1. **只允许向下**：表现层 → 应用层 → 领域层；基础设施层实现领域层声明的接口（`DatabaseDriver`、`AuditService`…），编译期依赖仍全部指向 `core`。
2. **`packages/core` 零内部依赖**：已核对 `packages/core/package.json` 无任何 `dependencies`；`core` 只依赖 Node 标准库（`node:fs`、`node:os`、`node:path`）。
3. **基础设施包之间不互相依赖**：`storage` / `drivers` 只依赖 `core`；唯一例外是 `auth → storage`（`AuthService` 直接持有 `PeanutDatabase`，用于会话与用户仓储，已在 `packages/auth/package.json` 中显式声明）。
4. **`apps/web` 不依赖任何内部包**：前端自带 DTO 类型（`apps/web/src/api/types.ts`），只通过 HTTP 契约与后端耦合。这是有意的解耦：Web 端可独立构建、可被反代单独托管。
5. **禁止循环依赖**；`core` 禁止 import `fastify`/`react`/`electron`/`commander`/`node:sqlite`。

### 2.3 层内职责边界

| 层 | 允许 | 禁止 |
| --- | --- | --- |
| 表现层 | HTTP 编解码、zod 校验（`parse()`）、鉴权 preHandler、DTO ↔ 领域对象映射、UI 状态 | 拼 SQL、读文件、算权限、算哈希链 |
| 应用层 | 编排仓储与领域服务、事务边界、调用驱动、写审计、返回 DTO | 直接依赖 `fastify` 类型（除路由装配处）、依赖 React/Electron API |
| 领域层 | 纯类型、纯函数规则（SQL 分类、生产库识别、路径解析）、SPI 接口、错误类型 | I/O、随机数直连、加密实现 |
| 基础设施层 | `node:sqlite`/`node:crypto`/`node:fs`、密码学实现、驱动实现 | 业务规则判定、HTTP 状态码语义 |

### 2.4 进程与运行时拓扑

| 形态 | 进程 | 说明 |
| --- | --- | --- |
| 桌面端（A） | Electron main + renderer | main 内 in-process 启动 Fastify（默认 `127.0.0.1:8787`，`PEANUTSPROUT_SERVE_WEB=1` 时同时托管 Web 静态资源），renderer 通过 HTTP 访问本机服务；不直接触碰 SQLite |
| Web / 独立服务端（B） | Node + Fastify | `PEANUTSPROUT_HOST`（默认 `127.0.0.1`）、`PEANUTSPROUT_PORT`（默认 `8787`）；`PEANUTSPROUT_TLS_KEY`/`PEANUTSPROUT_TLS_CERT` 可让服务端直接终结 TLS |
| CLI 远程模式（C1） | Node（`tsx`） | 仅作 HTTP 客户端 |
| CLI 本地模式（C2） | Node（`tsx`） | 进程内组合 `storage`/`auth`/`drivers`，直接操作 `~/.peanutsprout/`，无需令牌（单用户桌面权限，仍写审计） |

服务端配置项（`apps/server/src/config.ts`，环境变量 > 默认值）：

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `PEANUTSPROUT_HOST` | `127.0.0.1` | 监听地址；暴露公网需显式改并配 TLS/反代。**一旦显式设置，就优先于界面上的「局域网访问」开关** |
| `PEANUTSPROUT_PORT` | `8787` | 端口。同上：显式设置时优先于界面设置 |
| `PEANUTSPROUT_HOME` | `~/.peanutsprout` | 数据目录（`packages/core/src/paths.ts`） |
| `PEANUTSPROUT_DB` | `<数据目录>/peanutsprout.db` | 库文件覆盖 |
| `PEANUTSPROUT_MASTER_KEY` | `<数据目录>/master.key` | 主密钥文件覆盖 |
| `PEANUTSPROUT_MASTER_PASSWORD` | 空 | 主密码模式下的解锁口令 |
| `PEANUTSPROUT_TOKEN_TTL_SEC` | `43200`（12h） | 令牌有效期 |
| `PEANUTSPROUT_CORS_ORIGIN` | 反射请求来源（见下） | 逗号分隔白名单；`*` 表示全部（仅开发） |
| `PEANUTSPROUT_SERVE_WEB` | `1` | 是否托管 Web 静态资源 |
| `PEANUTSPROUT_WEB_DIST` | 空 | Web 产物目录 |
| `PEANUTSPROUT_ADMIN_USERNAME` / `PEANUTSPROUT_ADMIN_PASSWORD` | `admin` / `123456` | 首次启动引导管理员（覆盖内置默认口令） |
| `PEANUTSPROUT_LOG_LEVEL` | `info` | 日志级别 |
| `PEANUTSPROUT_TLS_KEY` / `PEANUTSPROUT_TLS_CERT` | 空 | 同时提供才启用 HTTPS |
| `PEANUTSPROUT_IDLE_CONN_MS` | `1800000`（30min） | 空闲连接回收阈值，`0` 关闭 |

界面上还有两个**可写设置项**（`PUT /meta/settings`，需 `settings.manage`）：

| 设置项 | 默认 | 说明 |
| --- | --- | --- |
| `web.lan_enabled` | `false` | 是否允许局域网内其它设备用浏览器访问。开启后绑 `0.0.0.0` + 固定端口，关闭时绑 `127.0.0.1` + 随机端口（桌面端） |
| `web.lan_port` | `8787` | 局域网访问端口，范围 1024–65535 |

与 `PEANUTSPROUT_HOST` / `PEANUTSPROUT_PORT` 的关系：**环境变量优先**。
这两个设置在监听地址的决策里只是"部署方没有硬性要求时的默认值"。
改完必须重启才生效（绑定只能在 `listen` 之前决定），
`GET /meta/web-access` 会分别返回 `saved` 与 `effective` 并给出 `restartRequired`。
桌面端为了让界面开关生效，会自己先读设置、再以环境变量传给内嵌服务端子进程
（`apps/desktop/web-access.mjs`）。

---

## 3. Monorepo 结构与包依赖

### 3.1 目录树（与仓库实际文件一一对应）

```
peanutsprout/
├── package.json                  # 根工作区：engines.node>=22.5、pnpm@11、devDeps(tsx/vitest/typescript)
├── pnpm-workspace.yaml            # packages: apps/*, packages/*；onlyBuiltDependencies: electron, esbuild
├── tsconfig.base.json             # strict / moduleResolution: Bundler / ES2023 / noEmit
├── vitest.config.ts               # include: packages|apps|tests 下的 *.test.ts
├── .npmrc                         # strict-peer-dependencies=false、auto-install-peers=true
├── .gitignore                     # 忽略 .peanutsprout/、master.key、*.key、*.db*、logs/、diag-*.zip
├── apps/
│   ├── server/
│   │   ├── package.json           # deps: fastify, @fastify/cors, @fastify/static, zod, core/storage/auth/drivers
│   │   └── src/
│   │       ├── config.ts          # 环境变量与默认值
│   │       ├── context.ts         # 组合根：PeanutDatabase + AuthService + DriverRegistry + ConnectionManager
│   │       ├── http.ts            # zod parse()、clientIp()、requireAuth()、错误归一化、慢请求日志
│   │       └── routes/
│   │           ├── meta.ts        # /auth/*（login/logout/me/change-password）、/health、/meta/*
│   │           └── （待补：connections.ts / query.ts / users.ts / audit.ts / migration.ts / ai.ts）
│   ├── web/
│   │   ├── package.json           # deps: react, react-dom；devDeps: vite, @vitejs/plugin-react
│   │   └── src/
│   │       ├── api/               # client.ts（fetch 封装+Bearer）、endpoints.ts（冻结契约）、types.ts（DTO）
│   │       ├── components/        # Button/DataGrid/Modal/ConfirmDialog/Layout/Sidebar/TopBar/Icons
│   │       ├── pages/             # LoginPage/ConnectionsPage/AuditPage/UsersPage/SettingsPage
│   │       ├── state/             # auth.tsx/theme.tsx/toast.tsx/view.ts
│   │       └── utils/format.ts
│   ├── cli/                       # ← 目录预留，源码待落地（命令契约见 docs/cli-reference.md）
│   └── desktop/                   # ← 目录预留，源码待落地
├── packages/
│   ├── core/src/
│   │   ├── driver.ts              # SPI：DatabaseDriver/DriverConnection/MetadataProvider/QueryExecutor/
│   │   │                          #      DdlGenerator/TypeMapper/ExplainParser/MigrationProvider/AiProvider/AuditService
│   │   ├── connection.ts          # ConnectionConfig/ConnectionDTO/SshTunnelConfig/SslConfig/元数据模型
│   │   ├── query.ts               # QueryResult/QueryOptions/ExecutionPlan + SQL 分类与拆分
│   │   ├── auth.ts                # User/Role/Permission/ResourceGrant/AuditEvent/AuthContext + 内置角色与权限码
│   │   ├── ai.ts                  # AI 请求上下文与结果模型
│   │   ├── migration.ts           # 迁移请求/预检/结果/同步模型
│   │   ├── chart.ts               # 图表与看板模型
│   │   ├── db-types.ts            # 15 种数据库类型目录 DB_TYPES + 默认端口/schema/是否已实现
│   │   ├── errors.ts              # ErrorCode + PeanutError + HTTP 状态映射
│   │   ├── paths.ts               # 数据目录/库文件/主密钥路径 + ensureDataDir(0700) + 生产库识别
│   │   └── index.ts               # 统一出口
│   ├── storage/src/
│   │   ├── crypto.ts              # scrypt 哈希校验 + AES-256-GCM 信封 + 主密钥文件（plain/password）
│   │   ├── database.ts            # LocalDatabase（prepare/绑定参数、语句缓存、BEGIN IMMEDIATE 事务、PRAGMA）
│   │   ├── schema/ddl.ts          # 25+ 张表的 DDL、索引、updated_at 触发器
│   │   ├── schema/migrations.ts   # schema 版本与迁移执行
│   │   ├── repositories/          # users / connections / audit / sessions-settings / query-history / ai-configs
│   │   └── index.ts               # PeanutDatabase 门面 + openPeanutDatabase() + ensureAdminUser()
│   ├── auth/src/
│   │   ├── tokens.ts              # 自研 JWT HS256（signToken/verifyToken/deriveJwtSecret）
│   │   ├── rbac.ts                # 权限判定、连接可见范围、写操作闸门、生产库 AI 闸门
│   │   ├── service.ts             # AuthService：登录/鉴权/登出/改密/重置/锁定/审计
│   │   └── index.ts
│   ├── drivers/src/
│   │   ├── registry.ts            # DriverRegistry + ConnectionManager + createDefaultRegistry()
│   │   ├── sqlite.ts              # SQLite 真实驱动（元数据/执行/DDL/类型映射/执行计划/只读拦截）
│   │   ├── placeholder.ts         # NotImplementedDriver（14 种类型，显式失败）
│   │   ├── identifiers.ts         # 标识符引用与白名单校验
│   │   ├── type-map.ts            # 归一化类型与跨库类型映射
│   │   └── index.ts
│   ├── ai/  migration/  visualization/   # ← 均已落地为独立 package
├── packaging/{windows,linux,macos}/      # ← 空目录：打包配置尚未编写
├── scripts/                             # ← 目录预留（bootstrap/verify/ddl:export 等）
├── tests/                               # ← 目录预留（集成与端到端测试）
└── docs/  PRD.md modules.md acceptance.md roadmap.md
           architecture.md cli-reference.md security.md deployment.md
```

### 3.2 包职责与真实依赖

| 包 | 职责（一句话） | 已声明依赖（核对自各 package.json） |
| --- | --- | --- |
| `@peanutsprout/core` | 领域模型、驱动 SPI、SQL 分类、错误码、路径与产品元信息 | 无（仅 Node 标准库） |
| `@peanutsprout/storage` | `node:sqlite` 访问层、schema 迁移、加密与主密钥、六类仓库、`PeanutDatabase` 门面 | `@peanutsprout/core` |
| `@peanutsprout/auth` | scrypt 口令、JWT HS256、RBAC/资源授权、审计哈希链、认证服务 | `@peanutsprout/core`、`@peanutsprout/storage` |
| `@peanutsprout/drivers` | 驱动注册表、连接管理器、7 个真实驱动、8 个占位驱动、类型映射与标识符方言 | `@peanutsprout/core` |
| `@peanutsprout/server` | Fastify 装配、路由与 preHandler、组合根、静态资源托管 | `core`、`storage`、`auth`、`drivers`、`fastify@5`、`@fastify/cors`、`@fastify/static`、`zod@4` |
| `@peanutsprout/web` | React 19 + Vite 7 单页界面 | `react`、`react-dom`（无内部包依赖，仅 HTTP 契约） |
| `@peanutsprout/cli` | `peanutsprout` 命令行（远程 HTTP + 本地直连） | ← 待落地 |
| `@peanutsprout/desktop` | Electron 壳：窗口/托盘/内嵌服务/自动更新 | ← 待落地 |
| `@peanutsprout/ai` | AI 供应商适配与脱敏网关 | 已落地（`packages/ai`） |
| `@peanutsprout/migration` | 结构快照、差异比对、DDL 生成、迁移执行与检查点 | 已落地（`packages/migration`） |
| `@peanutsprout/visualization` | 图表校验、聚合 SQL 生成与看板逻辑 | 已落地（`packages/visualization`；模型定义在 `core/chart.ts`） |

### 3.3 依赖关系图

```
                    ┌──────────────────────────┐
                    │   @peanutsprout/core     │  零内部依赖
                    │  领域模型 + SPI + 规则    │
                    └───▲────────▲────────▲────┘
                        │        │        │
        ┌───────────────┘        │        └────────────────┐
        │                        │                         │
┌───────┴────────┐      ┌────────┴────────┐      ┌─────────┴────────┐
│ storage        │◀─────│ auth            │      │ drivers          │
│ node:sqlite    │ 依赖 │ scrypt/JWT/RBAC │      │ 7 真实 + 8 占位   │
│ 加密/仓库/迁移  │      │ 审计哈希链       │      │ 注册表/连接管理器  │
└───────▲────────┘      └────────▲────────┘      └─────────▲────────┘
        │                        │                         │
        └────────────┬───────────┴─────────────┬───────────┘
                     │                         │
            ┌────────┴─────────┐      ┌────────┴─────────┐
            │ apps/server      │      │ apps/cli         │  ← 待落地
            │ Fastify + 组合根  │      │ peanutsprout     │
            └────────▲─────────┘      └──────────────────┘
                     │ HTTP（/api/v1）
            ┌────────┴─────────┐      ┌──────────────────┐
            │ apps/web (React) │      │ apps/desktop     │  ← 待落地（内嵌 server）
            └──────────────────┘      └──────────────────┘
```

---

## 4. 与 PRD「第四部分 目录结构建议」的映射

下表 = PRD 附录 B 的落地映射（原文单树目录 → pnpm monorepo），并补注当前落地状态。

| 原文章节目录 | 新布局路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| `desktop/` | `apps/desktop` | Electron 桌面端 | 目录预留 |
| `web/` | `apps/web` | React + Vite Web 端 | 已落地（基础界面） |
| `server/` | `apps/server` | Node.js + Fastify 服务端 | 已落地（骨架，路由待补全） |
| `cli/` | `apps/cli` | 命令行工具 | 已落地（全命令链路 + CSV 导入导出） |
| `core/` | `packages/core` | 领域层、领域模型与驱动 SPI | 已落地 |
| `drivers/` | `packages/drivers/src/`（`sqlite.ts`、`postgresql.ts`、`mysql.ts`、`placeholder.ts`、`registry.ts`） | 驱动适配器 | 7 种真实驱动 + 8 种占位；占位驱动显式抛 `DRIVER_NOT_IMPLEMENTED` |
| `ai/` | `packages/ai` | AI 助手模块 | 已落地（六类能力 + 脱敏网关） |
| `migration/` | `packages/migration` | 数据迁移模块 | 已落地（引擎 + 跨异构库迁移） |
| `visualization/` | `packages/visualization` | 可视化模块 | 已落地（图表校验 + 聚合 SQL 生成；图表模型定义在 `core/chart.ts`） |
| `auth/` | `packages/auth` | 用户与权限 | 已落地 |
| `storage/` | `packages/storage` | SQLite 存储 | 已落地 |
| `plugins/` | `packages/core` + `packages/drivers` | 插件框架并入核心与驱动包 | 规划中 |
| `i18n/` | `apps/web` | 多语言资源 | 规划中 |
| `themes/` | `apps/web` | 主题资源 | 规划中 |
| `docs/api.md` | 并入 `docs/PRD.md` 附录 A | REST API 与 CLI 接口定义 | 已完成（文档层） |
| `docs/ddl.sql` | 并入 `docs/PRD.md` 附录 C | 本地 SQLite3 DDL | 已完成（文档层），实现见 `packages/storage/src/schema/ddl.ts` |
| `scripts/`、`packaging/` | `scripts/` 已落地（bootstrap/verify/export-ddl）；`packaging/` 仍为空目录 | 构建脚本、打包 | `scripts/` 已完成；`packaging/` 未开始 |

映射原则：**可独立运行/可分发的产物进 `apps/`，可被复用的库进 `packages/`**。

---

## 5. 关键设计决策

| 决策 | 冻结选择 | 理由 | 代价 / 相关实现事实 |
| --- | --- | --- | --- |
| 本地存储引擎 | **`node:sqlite`（`DatabaseSync`）** | Node 24 内置 → **零原生编译依赖**：免 node-gyp、免预编译二进制下载、免 Python/VS Build Tools；同步 API 与"单进程短事务"模型契合；内置 `backup()` 可做一致性快照 | Node 下限 **22.5**（22.5–23.3 需 `--experimental-sqlite`，23.4+ 免标志）；该 API 仍处活跃开发期，必须锁定 Node 大版本；同步调用会阻塞事件循环，长查询/大批量导入需评估 `worker_threads`。实现：`packages/storage/src/database.ts`（语句缓存 + `BEGIN IMMEDIATE` 事务 + WAL/foreign_keys/busy_timeout=5000/encoding UTF-8） |
| 口令哈希 | **`node:crypto` scrypt**（替代原文 bcrypt/argon2） | 标准库内置、零依赖、内存硬化（抗 GPU/ASIC）优于 bcrypt；接口设计为可插拔，后续可接 argon2id | 参数 `N=32768, r=8, p=1, keyLen=64`，**`maxmem` 必须显式放大到 128MB**（`128*N*r ≈ 33.5MB` 超过 Node 默认 32MB 上限）；当前实现用 `scryptSync`（阻塞），高并发登录需限流或改异步；存储格式 `scrypt$N$r$p$saltB64$hashB64`，校验用 `timingSafeEqual`，口令先做 `NFKC` 归一化。实现：`packages/storage/src/crypto.ts` |
| 字段加密 | **AES-256-GCM + 主密钥文件** | AEAD 同时保证机密性与完整性；每条记录独立随机 IV；主密钥可选用主密码包裹，文件泄露也无法直接解密 | 自定义信封 `"PSK1" \| version(1) \| IV(12) \| tag(16) \| ciphertext`；`key_version` 概念由文件内 `version` 字段承载；**当前未使用 AAD**（记录绑定靠 ID 查询，字段错位拼接风险待补）；解密失败返回 `null` 而非抛异常（单条坏记录不影响列表接口）。实现：`packages/storage/src/crypto.ts` |
| JWT 实现 | **自研 HS256（`node:crypto` HMAC）**，未引入 `jose` | 只用 HS256 一种算法，实现面 <100 行、可完整审计；继续减少运行时依赖，契合零依赖目标 | 需自行保证安全细节：先校验 `alg/typ` 再验签（杜绝 `alg=none`/算法混淆）、恒时比较签名、强制 `exp`/`iss`；载荷 `{sub, sid, username, iat, exp, iss}`，默认 TTL 12 小时；**无 refresh token**（PRD A.8 的 `/auth/refresh` 待补）。实现：`packages/auth/src/tokens.ts` |
| 会话与吊销 | **JWT + `sessions` 表逐请求校验** | JWT 免查库签发，`sessions` 表提供即时吊销（登出、改密踢下线、禁用账号、管理员清会话）与设备台账 | 每个请求查一次 `sessions`（`token_hash = sha256(token)`，索引 `idx_sessions_token`）；改密会 `revokeAllForUser` 并保留当前会话；无 refresh/轮换机制。实现：`packages/auth/src/service.ts` + `packages/storage/src/repositories/sessions-settings.ts` |
| 桌面壳 | **Electron** | 纯 JS/TS 工具链，与源码优先 monorepo 一致；内嵌 Node 可直接 in-process 启动 Fastify 与 `node:sqlite` | 安装包体积与内存占用大于 Tauri；renderer 需加固（`contextIsolation`、禁用 `nodeIntegration`、CSP） |
| HTTP 框架 | **Fastify 5 + zod 4** | Fastify 性能与插件封装好；校验统一走 `parse(schema, data)`（`apps/server/src/http.ts`，用泛型形状避免 zod 大版本升级波及所有路由） | 需自建错误归一化与鉴权 preHandler（已实现）；限流等能力待补 |
| 仓库形态 | **源码优先（`exports → src/index.ts`）** | 改一处即时生效，无 `dist` 陈旧问题；`tsc --noEmit` 全仓类型检查；打包时才由 esbuild/Vite 内联 | 运行需 `tsx`（或打包/SEA）；对内/对外发布 npm 包需额外构建步骤 |
| 元数据库 | **本地 SQLite（`~/.peanutsprout/peanutsprout.db`）** | 单机离线、零运维、备份即快照 | 单写者：**多实例同写同一数据卷不受支持**（审计链会断裂、锁冲突）；容器部署必须 `replicas: 1` |
| 数据库类型目录 | **15 种类型一次性登记，未实现者注册占位驱动** | 界面可枚举全部规划类型并置灰未实现项；驱动缺失时**显式失败**而非静默返回空结果 | 占位驱动 `implemented=false`、能力全 `false`、`connect()` 抛 `DRIVER_NOT_IMPLEMENTED`（附 `hint`），`testConnection()` 返回 `ok:false` 并说明未真正发起连接。实现：`packages/drivers/src/placeholder.ts` |

---

## 6. 核心接口（与代码一致的 SPI）

> 以下签名取自仓库当前实现，与 PRD 附录 A 的等价接口一一对应。文件路径即落地位置。

### 6.1 类型目录与错误模型（`packages/core/src/db-types.ts`、`errors.ts`）

```ts
export type DatabaseType =
  | 'mysql' | 'mariadb' | 'postgresql' | 'oracle' | 'sqlserver' | 'sqlite'
  | 'kingbase' | 'dm' | 'oceanbase' | 'tidb'
  | 'redis' | 'mongodb' | 'clickhouse' | 'influxdb' | 'neo4j';

export type DatabaseCategory = 'relational' | 'keyvalue' | 'document' | 'columnar' | 'timeseries' | 'graph';

export interface DbTypeInfo {
  code: DatabaseType;
  label: string;                 // 界面展示名
  category: DatabaseCategory;
  defaultPort: number | null;    // 文件型为 null
  defaultSchema: string;         // MySQL 为库名、PG 为 public、SQLite 为 main
  urlScheme: string;             // 连接串协议头
  driverImplemented: boolean;    // 本期是否真实实现
  networked: boolean;            // 是否需要主机端口
}

export const DB_TYPES: readonly DbTypeInfo[];   // 15 项；仅 sqlite 的 driverImplemented = true
export const ALL_DATABASE_TYPES: readonly DatabaseType[];
export function isDatabaseType(v: unknown): v is DatabaseType;
export function getDbTypeInfo(code: DatabaseType | string): DbTypeInfo;  // 未知类型抛 VALIDATION_FAILED

export type ErrorCode =
  | 'VALIDATION_FAILED' | 'AUTH_REQUIRED' | 'AUTH_INVALID_CREDENTIALS'
  | 'AUTH_TOKEN_INVALID' | 'AUTH_TOKEN_EXPIRED'
  | 'AUTH_ACCOUNT_DISABLED' | 'AUTH_ACCOUNT_LOCKED' | 'AUTH_FORBIDDEN'
  | 'NOT_FOUND' | 'CONFLICT' | 'READONLY_VIOLATION' | 'CONFIRMATION_REQUIRED'
  | 'DRIVER_NOT_IMPLEMENTED' | 'CONNECTION_FAILED' | 'QUERY_FAILED' | 'QUERY_TIMEOUT' | 'QUERY_CANCELLED'
  | 'MIGRATION_FAILED' | 'AI_DISABLED' | 'AI_PROVIDER_ERROR' | 'INTERNAL';

export class PeanutError extends Error {
  readonly code: ErrorCode;
  readonly status: number;     // 由 DEFAULT_STATUS 映射（见 §11.4）
  readonly details?: unknown;
  toJSON(): { error: { code: ErrorCode; message: string; details?: unknown } };
}
export const isPeanutError: (e: unknown) => e is PeanutError;
export function normalizeError(e: unknown): PeanutError;   // 未知异常 → INTERNAL
```

### 6.2 连接与元数据模型（`packages/core/src/connection.ts`）

```ts
export interface SshTunnelConfig {
  enabled: boolean; host: string; port: number; username: string;
  privateKeyPath?: string;      // 私钥路径
  password?: string;            // 敏感：加密存储
  passphrase?: string;          // 敏感：加密存储
}

export interface SslConfig {
  enabled: boolean;
  mode?: 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';
  caPath?: string; certPath?: string; keyPath?: string;
  rejectUnauthorized?: boolean;
}

/** 领域层连接配置：password 是已解密明文，仅在内存中短暂存在。 */
export interface ConnectionConfig {
  id: number;
  name: string;
  dbType: DatabaseType;
  host?: string | null;
  port?: number | null;
  databaseName?: string | null;
  username?: string | null;
  password?: string | null;
  connectionUrl?: string | null;
  sshTunnel?: SshTunnelConfig | null;
  ssl?: SslConfig | null;
  extraParams?: Record<string, string> | null;
  readOnly: boolean;
  colorTag?: string | null;      // 界面颜色标识，"red" 触发生产库识别
}

/** 对外传输视图：绝不包含口令。 */
export interface ConnectionDTO {
  id: number; name: string; groupId: number | null; dbType: DatabaseType;
  host: string | null; port: number | null; databaseName: string | null; username: string | null;
  hasPassword: boolean; connectionUrl: string | null; colorTag: string | null;
  isReadOnly: boolean; isFavorite: boolean;
  lastUsedAt: string | null; createdAt: string; updatedAt: string;
}

export interface ConnectionTestResult { ok: boolean; latencyMs: number; serverVersion: string | null; message: string; }

export interface SchemaInfo { name: string; comment?: string | null; }
export type TableKind = 'table' | 'view' | 'materialized_view' | 'foreign_table';
export interface TableInfo { schema: string; name: string; kind: TableKind; comment?: string | null; rowCount?: number | null; }
export interface ColumnInfo {
  schema: string; table: string; name: string; dataType: string;
  nullable: boolean; defaultValue: string | null; comment: string | null;
  isPrimaryKey: boolean; ordinal: number;
}
export interface IndexInfo { schema: string; table: string; name: string; columns: string[]; unique: boolean; primary: boolean; }
export interface ConstraintInfo {
  schema: string; table: string; name: string;
  type: 'primary_key' | 'foreign_key' | 'unique' | 'check';
  definition: string;
}
```

### 6.3 驱动 SPI（`packages/core/src/driver.ts`）

```ts
export interface DriverConnection {
  readonly id: string;
  readonly config: ConnectionConfig;
  ping(): Promise<{ latencyMs: number; serverVersion: string | null }>;
  getMetadata(): MetadataProvider;
  getQueryExecutor(): QueryExecutor;
  getDdlGenerator(): DdlGenerator;
  getTypeMapper(): TypeMapper;
  getExplainParser(): ExplainParser;
  close(): Promise<void>;
}

/** 驱动主入口。每种数据库一个实现，通过 registry 按 dbType 解析。 */
export interface DatabaseDriver {
  readonly dbType: DatabaseType;
  readonly name: string;
  readonly version: string;
  readonly implemented: boolean;      // false = 占位驱动
  readonly capabilities: DriverCapabilities;
  getInfo(): DbTypeInfo;
  connect(config: ConnectionConfig): Promise<DriverConnection>;
  testConnection(config: ConnectionConfig): Promise<ConnectionTestResult>;
}

export interface DriverCapabilities {
  schemas: boolean; transactions: boolean; explain: boolean;
  streaming: boolean;               // 流式读取大结果集
  serverSidePagination: boolean;    // 服务端游标分页
  cdc: boolean;                     // CDC / binlog 增量同步
  ddl: boolean;                     // DDL 生成
}
export const DEFAULT_CAPABILITIES: DriverCapabilities;

export interface MetadataProvider {
  listSchemas(): Promise<SchemaInfo[]>;
  listTables(schema: string): Promise<TableInfo[]>;
  listColumns(schema: string, table: string): Promise<ColumnInfo[]>;
  listIndexes(schema: string, table: string): Promise<IndexInfo[]>;
  listConstraints(schema: string, table: string): Promise<ConstraintInfo[]>;
  listViews(schema: string): Promise<TableInfo[]>;
  listProcedures(schema: string): Promise<Array<{ name: string; kind: 'procedure' | 'function' }>>;
  listTriggers(schema: string): Promise<Array<{ name: string; table: string | null }>>;
}

export interface QueryExecutor {
  execute(sql: string, options?: QueryOptions): Promise<QueryResult>;
  executeUpdate(sql: string): Promise<number>;
  explain(sql: string): Promise<ExecutionPlan>;
  cancel(queryId: string): void;
}

export interface DdlGenerator {
  createTable(schema: string, table: string, columns: ColumnInfo[], indexes?: IndexInfo[]): string;
  dropTable(schema: string, table: string): string;
  addColumn(schema: string, table: string, column: ColumnInfo): string;
  alterColumn(schema: string, table: string, from: ColumnInfo, to: ColumnInfo): string;
  dropColumn(schema: string, table: string, column: string): string;
  createIndex(schema: string, table: string, index: IndexInfo): string;
  dropIndex(schema: string, table: string, indexName: string): string;
}

export interface TypeMapper {
  /** 源库类型 → 目标库类型；无法精确映射时返回 lossy: true + note。 */
  mapType(sourceType: string, target: DatabaseType): { type: string; lossy: boolean; note?: string };
  /** 归一化类型，用于结构对比。 */
  normalizeType(rawType: string): string;
}

export interface ExplainParser {
  parse(raw: unknown): ExecutionPlan;
  toTree(plan: ExecutionPlan): ExecutionPlanNode[];
}

/** 迁移 SPI（当前声明于 core，落地包为 packages/migration）。 */
export interface MigrationProvider {
  precheck(request: MigrationRequest): Promise<MigrationPrecheckResult>;
  migrate(request: MigrationRequest, onProgress?: ProgressCallback): Promise<MigrationResult>;
  sync(request: SyncRequest, onProgress?: ProgressCallback): Promise<MigrationResult>;
  cancel(migrationId: string): void;
  resume(migrationId: string): Promise<MigrationResult>;
}
export interface ProgressCallback {
  (progress: {
    migrationId: string; phase: string; table?: string;
    processedRows: number; totalRows: number | null; message?: string;
  }): void;
}

/** AI SPI（当前声明于 core，落地包为 packages/ai）。 */
export interface AiProvider {
  readonly name: string;
  generateSql(naturalLanguage: string, context: AiRequestContext): Promise<SqlGenerationResult>;
  explainSql(sql: string): Promise<string>;
  optimizeSql(sql: string, plan: ExecutionPlan | null): Promise<OptimizationResult>;
  generateDocumentation(context: AiRequestContext): Promise<string>;
  answerQuestion(question: string, context: AiRequestContext): Promise<string>;
  diagnoseError(error: string, sql: string): Promise<DiagnosisResult>;
}

/** 审计 SPI（声明于 core，实现在 packages/auth + packages/storage）。 */
export interface AuditService {
  log(event: AuditEvent): number;
  query(query: AuditQuery): { items: AuditLogEntry[]; total: number };
  export(query: AuditQuery, format: 'csv' | 'json'): string;
  verifyChain(): { ok: boolean; checked: number; brokenAt: number | null };
  purge(before: string): number;
}
```

### 6.4 查询与执行计划模型（`packages/core/src/query.ts`）

```ts
export type CellValue = string | number | null | boolean | Uint8Array;

export interface QueryResult {
  queryId: string;
  columns: Array<{ name: string; dataType: string }>;
  rows: CellValue[][];
  rowCount: number;        // 受 maxRows 限制时为已返回行数
  affectedRows: number;    // DML 影响行数；SELECT 为 0
  durationMs: number;
  truncated: boolean;      // 因 maxRows 被截断
  notices: string[];
}

export interface QueryOptions { maxRows?: number; timeoutMs?: number; signal?: AbortSignal; }

export interface ExecutionPlan {
  format: 'text' | 'json' | 'tree';
  content: string;
  raw?: unknown;
  nodes?: ExecutionPlanNode[];   // 归一化节点，供执行计划可视化
}
export interface ExecutionPlanNode { id: string; label: string; costShare?: number; detail?: string; children?: ExecutionPlanNode[]; }

/** SQL 分类：只读保护、AI 确认、审计动作选择三处共用同一判定。 */
export function isWriteStatement(sql: string): boolean;   // 先去注释，再匹配写/DDL 关键字；pragma/attach 也算写
export function isReadStatement(sql: string): boolean;
export function stripSqlComments(sql: string): string;    // 正确处理字符串字面量内的 -- 与 //
export function splitSqlStatements(script: string): string[];
```

### 6.5 用户/权限/审计模型（`packages/core/src/auth.ts`）

```ts
export type PermissionCode =
  | 'conn.read' | 'conn.write' | 'query.read' | 'query.write'
  | 'migrate.read' | 'migrate.write' | 'ai.use'
  | 'user.manage' | 'audit.read' | 'settings.manage';

export interface ResourceGrant {
  id: number; userId: number;
  resourceType: 'connection' | 'schema' | 'table';
  resourceId: string; actions: string[]; createdAt: string;
}

export type AuditAction =
  | 'login' | 'logout' | 'login_failed' | 'connect' | 'disconnect'
  | 'execute' | 'migrate' | 'import' | 'export' | 'ai'
  | 'user_create' | 'user_update' | 'user_delete'
  | 'connection_create' | 'connection_update' | 'connection_delete'
  | 'settings_update' | 'audit_verify';

export interface AuditEvent {
  userId: number | null; username: string | null;
  action: AuditAction | string;
  resourceType?: string | null; resourceId?: string | null; connectionId?: number | null;
  detail?: unknown; sqlText?: string | null;
  ipAddress?: string | null; userAgent?: string | null;
  status: 'success' | 'failed' | 'denied' | string;
  errorMessage?: string | null; durationMs?: number | null;
}
export interface AuditLogEntry extends AuditEvent { id: number; prevHash: string | null; currHash: string | null; createdAt: string; }

export interface AuthContext {
  user: User; roles: string[]; permissions: string[];
  grants: Map<string, string[]>;    // 形如 "connection:12" -> ["read","write"]
  sessionId: string;
}

export const BUILTIN_ROLES: ReadonlyArray<{ name: string; description: string }>;   // admin / developer / readonly
export const BUILTIN_PERMISSIONS: ReadonlyArray<{ code: string; name: string; category: string }>;
export const ROLE_PERMISSIONS: Record<string, string[]>;
```

---

## 7. 驱动注册表与 `DRIVER_NOT_IMPLEMENTED`

### 7.1 注册表与连接管理器（`packages/drivers/src/registry.ts`）

```ts
export interface DriverDescriptor {
  dbType: DatabaseType; label: string; category: string;
  defaultPort: number | null; networkRequired: boolean;
  driverImplemented: boolean; driverName: string; driverVersion: string;
  capabilities: DriverCapabilities;
}

export class DriverRegistry {
  register(driver: DatabaseDriver): void;
  get(dbType: DatabaseType | string): DatabaseDriver | undefined;
  require(dbType: DatabaseType | string): DatabaseDriver;   // 未注册 → DRIVER_NOT_IMPLEMENTED
  list(): DriverDescriptor[];                               // 已实现优先排序
  implementedTypes(): DatabaseType[];
}

/** 会话缓存：按连接 id 复用 DriverConnection，只读标记/类型变化时丢弃重建。 */
export class ConnectionManager {
  acquire(config: ConnectionConfig): Promise<DriverConnection>;
  get(connectionId: number): DriverConnection | undefined;
  withConnection<T>(config: ConnectionConfig, fn: (conn: DriverConnection) => Promise<T>): Promise<T>;
  release(connectionId: number): Promise<void>;
  releaseAll(): Promise<void>;
  releaseIdle(idleMs: number): Promise<number>;
  test(config: ConnectionConfig): Promise<ConnectionTestResult>;
  stats(): Array<{ connectionId: number; dbType: string; openedAt: string; lastUsedAt: string; idleMs: number }>;
  get size(): number;
}

/** 内置 SQLite 驱动 + 其余各类数据库的驱动注册（已实现 7 种，其余为占位）。 */
export function createDefaultRegistry(): DriverRegistry;
```

### 7.2 解析规则

1. 组合根（`apps/server/src/context.ts`）调用 `createDefaultRegistry()`（`packages/drivers/src/registry.ts`）：先注册 **7 个真实驱动** —— `SqliteDriver`；PostgreSQL 协议族用 `PostgresDriver` 实例覆盖 `postgresql` 与 `kingbase`（金仓 KingbaseES 兼容 PG 线协议）；MySQL 协议族用 `MysqlDriver` 实例覆盖 `mysql`、`mariadb`、`tidb`、`oceanbase`。再注册 `createPlaceholderDrivers()`；注册表的 `register()` 拒绝用未实现驱动覆盖已实现驱动，因此 `oceanbase`/`tidb` 保持真实实现，最终生效 **8 个占位**驱动。
2. 请求携带 `dbType` → `registry.require(dbType)`：
   - 类型不在 `DB_TYPES` → 抛 `VALIDATION_FAILED`（附 `supported` 列表）；
   - 类型合法但未注册驱动 → 抛 `DRIVER_NOT_IMPLEMENTED`。
3. `DriverRegistry.get()` 返回 `undefined` 时调用方可自行降级（如 `/meta/db-types` 仅做展示，不抛错）。
4. 占位驱动 `connect()` 同样抛 `DRIVER_NOT_IMPLEMENTED`，`details = { dbType, hint }`，保证"界面可枚举、连接必失败、提示可读"。

### 7.3 未实现驱动的降级契约（已实现的行为）

| 通道 | 行为 |
| --- | --- |
| HTTP | `501 Not Implemented`，响应体 `{"error":{"code":"DRIVER_NOT_IMPLEMENTED","message":"Oracle 驱动尚未实现，暂时无法连接 \"订单库\"","details":{"dbType":"oracle","hint":"…"}}}` |
| `GET /api/v1/meta/db-types` | 返回全部 15 项，`driverImplemented=false`，`capabilities` 全 `false` → 前端据此灰置并标注"规划中" |
| `POST /connections/{id}/test` | 占位驱动返回 `{ ok:false, latencyMs:0, serverVersion:null, message:"…驱动尚未实现（未真正发起）" }` |
| 审计 | 记录 `status:'failed'`（`action` 取决于入口，如 `connect`） |
| 日志 | 占位驱动不打印连接配置；仅错误归一化层按级别记录 |

**已实现/占位矩阵**（以 `createDefaultRegistry()` 为准）：

| 状态 | 类型 |
| --- | --- |
| ✅ 真实驱动（7） | `sqlite`、`postgresql`、`kingbase`（KingbaseES）、`mysql`、`mariadb`、`tidb`、`oceanbase` |
| ⬜ 占位驱动（8） | `oracle`、`sqlserver`、`dm`（达梦）、`redis`、`mongodb`、`clickhouse`、`influxdb`、`neo4j` |

> ⚠️ MySQL 协议族（`mysql`/`mariadb`/`tidb`/`oceanbase`）驱动已实现，但**未经真实服务端验证**（本机无法下载服务端二进制）；PostgreSQL 协议族已对真实服务端验证，且 SQLite → 真实 PostgreSQL 的跨异构迁移已端到端跑通。

---

## 8. 一次 SQL 执行的端到端时序

以 `POST /api/v1/query/execute`（前端契约：`{ connectionId, sql, maxRows?, timeoutMs? }`）为例。✅ 已有实现的部分以 `[已实现]` 标注，其余为待补路由。

| # | 参与方 | 动作 |
| --- | --- | --- |
| 1 | 表现层 | Web/桌面/CLI 提交执行请求；`apps/web/src/api/endpoints.ts` 的 `queryApi.execute()` 是前端唯一入口。 |
| 2 | Fastify + zod | `parse(schema, req.body)` 校验；失败 → `400 VALIDATION_FAILED`（`details` 为 `[{field,message}]`）`[已实现：机制]` |
| 3 | preHandler | `requireAuth(ctx)` 取 `Authorization: Bearer`，`AuthService.authenticate(token)`：自研 HS256 验签（先校验 `alg/typ`）→ `exp/iss` → `sessions.findActiveByTokenHash(sha256(token))` → 用户启用状态 → 构建 `AuthContext`（roles/permissions/grants）`[已实现]` |
| 4 | preHandler | 可选 `assertPermission(ctx, 'query.read' \| 'query.write')` `[已实现]` |
| 5 | 应用层 | 取连接 DTO：`pdb.connections.get(id)`；`assertConnectionVisible(ctx, id)`（不区分"不存在"与"无权限"，防 id 枚举）`[已实现]` |
| 6 | 领域层 | `isWriteStatement(sql)` / `isReadStatement(sql)`（先去注释与字面量）判定语句类别。无法判定视为写 `[已实现]` |
| 7 | 领域层 | 写语句 → `assertCanWrite(ctx, id, connection)`：角色权限 `query.write` → 连接 `readOnly` → 资源授权 `resource_grants`（`connection:<id>` 的 `write`/`*`）；不通过分别抛 `AUTH_FORBIDDEN` / `READONLY_VIOLATION` `[已实现]` |
| 8 | 领域层 | 生产库写操作（`colorTag=red`/名称含 `prod|生产|线上`/连接只读）→ AI 路径抛 `CONFIRMATION_REQUIRED`；SQL 编辑器路径由界面二次确认 `[已实现：识别与闸门]` |
| 9 | 应用层 / 基础设施 | 连接配置解密：`connections` 仓库用 `pdb.getKey()` 对 `password_enc`/`ssh_config_enc`/`ssl_config_enc` 调 `decryptString`；解不开返回 `null`（单条坏记录不炸列表）`[已实现]` |
| 10 | 基础设施 | `registry.require(dbType)` → 占位驱动抛 `DRIVER_NOT_IMPLEMENTED` `[已实现]` |
| 11 | 基础设施 | `ConnectionManager.acquire(config)`：命中缓存复用；只读标记或类型变化则 `release` 后重建；失败 → `CONNECTION_FAILED` `[已实现]` |
| 12 | 基础设施 | `conn.getQueryExecutor().execute(sql, { maxRows, timeoutMs, signal })`：SQLite 驱动内部对只读连接二次执行 `isWriteStatement` 拦截（双保险），绑定参数、截断行数、登记 `queryId` 供 `cancel()` `[已实现]` |
| 13 | 基础设施 | 返回 `QueryResult`（columns/rows/rowCount/affectedRows/durationMs/truncated/notices）`[已实现]` |
| 14 | 应用层 | 写 `query_history`（含 `durationMs`、`affectedRows`、`resultRows`、`isSlow`）`[已实现：仓储]` |
| 15 | 审计 | `pdb.audit.append({ action:'execute', connectionId, sqlText, status, errorMessage, durationMs, ipAddress, userAgent })`：在同一 SQLite 事务内"读链尾 → 计算 `currHash` → 插入" `[已实现]` |
| 16 | 表现层 | 序列化响应（`{rows, columns, rowCount, ...}`）；BLOB 单元格转 `base64:…`，`bigint` 转字符串（`serializeCell`）`[已实现：工具]` |
| 17 | 观测 | `onResponse` 记录耗时，>1s 打 `slow request` warn `[已实现]` |

**待补环节**：`/query/execute` 路由本体、SSE/WebSocket 流式返回（PRD M10 要求 WebSocket）、`cancel` 路由、服务端级二次确认票据（当前生产库保护为"识别 + 界面确认"，无签发式票据）。

---

## 9. 凭据数据流（录入 → 加密 → 落库 → 解密 → 连接）

### 9.1 主密钥（`packages/storage/src/crypto.ts`）

主密钥文件 `~/.peanutsprout/master.key` 是 **JSON**，两种模式：

| 模式 | 文件内容 | 说明 |
| --- | --- | --- |
| `plain` | `{ version: 1, mode: "plain", key: "<base64 32B>", createdAt }` | 密钥直接落盘，权限 `0600`；适合单机桌面 |
| `password` | `{ version: 1, mode: "password", kdf: { salt, N, r, p }, wrapped: "<base64>", createdAt }` | 用主密码经 scrypt 派生 KEK，再用 AES-256-GCM 包裹数据密钥；文件泄露也无法直接解密连接口令 |

- 创建：`createMasterKeyFile(path, password?)`（`randomBytes(32)`）；写入用 `*.tmp` + `rename`，并 `chmod 0600`（Windows 上忽略失败）。
- 解锁：`loadMasterKey(path, password?)`；password 模式下未提供口令或口令错误 → 抛错（中文提示，如"主密码错误，无法解锁主密钥"），由错误归一化层转为 `INTERNAL`。**当前没有专用的"主密钥锁定"错误码**（待办见 `docs/security.md`）。
- 改主密码：`changeMasterPassword(path, current, next)`，只重新包裹数据密钥，**无需重加密连接口令**（因为数据密钥未变）。
- 数据目录：`ensureDataDir()` 创建 `0700`，`chmod 0700`（Windows 忽略）。

### 9.2 字段加密路径

| # | 阶段 | 实现事实 |
| --- | --- | --- |
| 1 | 录入 | UI/CLI 收集 `password`、`sshTunnel.password/passphrase`、SSL Key 内容、AI `apiKey`；以明文形式仅存在于内存 |
| 2 | 传输 | 客户端 → 服务端走 HTTP(S) + `Authorization: Bearer`；口令不出现在 URL |
| 3 | 加密 | `encryptString(plain, masterKey)`：`iv = randomBytes(12)`（**每条记录独立**）→ `aes-256-gcm` → `tag(16)`；输出信封 `"PSK1" \| 0x01 \| iv \| tag \| ciphertext`，直接作为 BLOB 写入 |
| 4 | 落库 | `connections.password_enc` / `ssh_config_enc` / `ssl_config_enc`（BLOB）；`ai_configs.api_key_enc`（BLOB）；结构化配置用 `encryptJson` |
| 5 | 读取 | `decryptString/decryptJson`：校验 MAGIC 与版本、校验 authTag；**失败返回 `null` 而不抛异常**（避免一条坏记录让整个列表接口 500），并保持 `hasPassword=false` |
| 6 | 使用 | 解密结果仅传入 `driver.connect(config)`；连接缓存（`ConnectionManager`）持有的是驱动会话，不持有明文口令 |
| 7 | 展示 | `ConnectionDTO` 只有 `hasPassword: boolean`，**任何接口都不返回明文口令** |
| 8 | 清理 | 未连接/空闲超过 `PEANUTSPROUT_IDLE_CONN_MS`（默认 30min）回收会话；进程退出关闭库 |

**已知差距（待办）**：① 无 AAD/记录绑定；② 无 `key_version` 多版本轮换（改主密钥需要整体重加密）；③ 明文变量未显式零化；④ 主密钥文件权限校验仅在写入时设置，**启动时不校验现有文件权限**。

---

## 10. 数据模型（`packages/storage/src/schema/ddl.ts` 已实现）

库文件 `~/.peanutsprout/peanutsprout.db`，启动即设 PRAGMA：`journal_mode = WAL`、`foreign_keys = ON`、`synchronous = NORMAL`、`busy_timeout = 5000`、`encoding = 'UTF-8'`（内存库自动跳过 WAL）。

| 表 | 用途 | 备注 |
| --- | --- | --- |
| `users` | 账号、口令哈希、锁定状态、TOTP 标记 | `password_hash`（`scrypt$…`）、`failed_attempts`、`locked_until`、`status` |
| `roles` / `permissions` / `user_roles` / `role_permissions` | RBAC | 内置角色 `admin`/`developer`/`readonly`，内置权限码见 §11.3 |
| `resource_grants` | 资源级授权 | `user_id` + `resource_type`(`connection`\|`schema`\|`table`) + `resource_id` + `actions`(JSON)，索引 `idx_resource_grants_user` |
| `sessions` | 会话台账与吊销 | `id`(UUID)、`user_id`、`token_hash`(sha256)、`expires_at`、`revoked_at`、`ip_address`、`user_agent` |
| `connection_groups` | 连接分组 | 树形分组 |
| `connections` | 连接配置 | 非敏感列明文；`password_enc`/`ssh_config_enc`/`ssl_config_enc` 为 BLOB；`is_read_only`、`color_tag`、`is_favorite` |
| `drivers` | 驱动注册信息 | 供插件/驱动元数据展示 |
| `query_history` | 执行历史 | `sql_text`、`status`、`duration_ms`、`affected_rows`、`result_rows`、`is_slow`；**不存结果集** |
| `sql_snippets` | SQL 片段/版本管理 | 与 PRD SR-05 对应 |
| `audit_logs` | 审计哈希链 | `prev_hash`/`curr_hash` + 4 个查询索引；`created_at` 由应用层生成 |
| `ai_configs` | AI 供应商配置 | `api_key_enc` BLOB |
| `ai_history` | AI 调用历史 | 按用户与时间索引 |
| `migrations` / `migration_checkpoints` / `migration_errors` | 迁移任务、断点续传、失败明细 | 对应 PRD M05 |
| `dashboards` / `charts` | 看板与图表 | 对应 PRD M06 |
| `schedules` | 定时任务 | `next_run_at` 索引 |
| `plugins` | 插件注册 | 规划中 |
| `settings` | 键值设置 | 含 `audit.chain_anchor_id`、`security.must_change_password` 等 |
| `schema_migrations` | 本地库结构版本 | 迁移执行器读写 |

## 11. API、权限与错误码

### 11.1 API 前缀与已实现路由

前缀 `/api/v1`（前端 `apps/web/src/api/endpoints.ts` 为冻结契约的唯一调用点）。

**已实现（`apps/server/src/routes/meta.ts`）**

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/auth/login` | 否 | 登录，返回 `{ token, expiresIn, user, roles, permissions }` |
| POST | `/auth/logout` | 是 | 吊销当前会话 |
| GET | `/auth/me` | 是 | 当前用户 + 角色 + 权限 |
| POST | `/auth/change-password` | 是 | 改密（改后吊销其他会话） |
| GET | `/health` | 否 | `{ status, version, product, uptimeSec, schemaVersion }`（桌面端启动时另含 `instanceNonce`；不再返回 `masterKeyMode`） |
| GET | `/meta/info` | 否 | 产品信息、数据目录、库路径、已实现驱动列表 |
| GET | `/meta/db-types` | 否 | 15 种数据库类型 + 能力 + 是否已实现 |
| GET | `/meta/permissions` | 是 | 权限项（DB 优先，回退内置） |
| GET | `/meta/settings` | `settings.manage` | 系统设置 |
| GET | `/meta/production-check/:id` | 是 | 是否生产库 + 是否只读（界面红标） |
| GET | `/meta/diagnostics` | `settings.manage` | 诊断 JSON（不含口令与密文） |

**契约已冻结、服务端待补（前端已调用 / PRD 附录 A 已定义）**

| 组 | 路径 |
| --- | --- |
| 连接 | `GET/POST /connections`、`GET/PUT/DELETE /connections/{id}`、`POST /connections/{id}/test`、`GET /connections/{id}/schemas[/{schema}/tables[/{table}/columns|/indexes]]` |
| 查询 | `POST /query/execute`、`POST /query/explain`、`GET /query/history`、`POST /query/cancel` |
| 迁移 | `POST /migration/precheck`、`POST /migration/start`、`GET /migration/{id}`、`POST /migration/{id}/cancel`、`GET /migration/{id}/report` |
| 图表 | `POST /charts`、`GET /charts/{id}`、`GET /charts/{id}/data`、`POST /dashboards`、`GET /dashboards/{id}` |
| AI | `POST /ai/nl2sql`、`/ai/explain`、`/ai/optimize`、`/ai/document`、`/ai/ask`、`/ai/diagnose` |
| 用户与审计 | `GET/POST /users`、`PUT/DELETE /users/{id}`、`GET /audit/logs`、`GET /audit/logs/export`、`GET /audit/verify` |

### 11.2 错误响应信封（`apps/server/src/http.ts`）

```json
{ "error": { "code": "READONLY_VIOLATION", "message": "该连接已开启只读保护，禁止执行写操作" } }
```

- 4xx 记 `debug`，5xx 记 `error`（避免业务拒绝淹没审计）。
- 未匹配路由 → `404 { error: { code: "NOT_FOUND", message: "接口不存在: GET /x" } }`。

### 11.3 权限码与内置角色

| 权限码 | 含义 | admin | developer | readonly |
| --- | --- | :---: | :---: | :---: |
| `conn.read` | 查看连接 | ✅ | ✅ | ✅ |
| `conn.write` | 管理连接（增删改/测试） | ✅ | — | — |
| `query.read` | 执行查询 | ✅ | ✅ | ✅ |
| `query.write` | 执行写操作 | ✅ | ✅ | — |
| `migrate.read` | 查看迁移 | ✅ | ✅ | — |
| `migrate.write` | 执行迁移 | ✅ | ✅ | — |
| `ai.use` | 使用 AI | ✅ | ✅ | — |
| `user.manage` | 用户管理 | ✅ | — | — |
| `audit.read` | 查看审计 | ✅ | — | — |
| `settings.manage` | 系统设置 | ✅ | — | — |

判定链（`packages/auth/src/rbac.ts`）：

1. `ctx.user.isAdmin === true` → 直接放行；
2. 否则查 `ctx.permissions`（角色 → 权限码）；
3. **连接可见范围**：管理员全可见；普通用户**若存在 `connection:*` 授权记录则以这些连接为白名单**；**若一条授权都没有则按角色权限放行全部连接**（有意设计，避免新用户看不到任何连接）；
4. **写操作**：`query.write` 权限 + 连接非只读 + `resource_grants` 含 `write`/`*`（管理员跳过第 3、4 步的资源判定）；
5. 越权时不区分"资源不存在"与"无权限"（`AUTH_FORBIDDEN`），避免枚举连接 id。

### 11.4 错误码 → HTTP 状态（`DEFAULT_STATUS`）

| 错误码 | 状态 | 错误码 | 状态 |
| --- | --- | --- | --- |
| `VALIDATION_FAILED` | 400 | `CONFIRMATION_REQUIRED` | 428 |
| `AUTH_REQUIRED` / `AUTH_INVALID_CREDENTIALS` / `AUTH_TOKEN_INVALID` / `AUTH_TOKEN_EXPIRED` | 401 | `DRIVER_NOT_IMPLEMENTED` | 501 |
| `AUTH_FORBIDDEN` / `AUTH_ACCOUNT_DISABLED` / `READONLY_VIOLATION` / `AI_DISABLED` | 403 | `CONNECTION_FAILED` / `AI_PROVIDER_ERROR` | 502 |
| `NOT_FOUND` | 404 | `QUERY_FAILED` | 400 |
| `CONFLICT` | 409 | `QUERY_TIMEOUT` | 504 |
| `AUTH_ACCOUNT_LOCKED` | 423 | `QUERY_CANCELLED` | 499 |
| `MIGRATION_FAILED` / `INTERNAL` | 500 | | |

### 11.5 审计哈希链（已实现）

```ts
// packages/storage/src/repositories/audit.ts
interface HashPayload {   // 字段顺序即规范顺序，不可调整
  userId; username; action; resourceType; resourceId; connectionId;
  detail;        // 结构化 detail 先 JSON.stringify，字符串原样
  sqlText; status; errorMessage; createdAt;
}
const canonical = (p: HashPayload): string => JSON.stringify([
  p.userId ?? '', p.username ?? '', p.action, p.resourceType ?? '', p.resourceId ?? '',
  p.connectionId ?? '', p.detail ?? '', p.sqlText ?? '', p.status, p.errorMessage ?? '', p.createdAt,
]);
export function computeAuditHash(prevHash: string | null, payload: HashPayload): string {
  return sha256Hex(`${prevHash ?? 'GENESIS'}|${canonical(payload)}`);
}
```

- 创世锚：`prevHash = null` 时使用字面量 `'GENESIS'`。
- `created_at` 由应用层 `nowIso()` 生成（不依赖数据库时钟），保证可复现。
- `append()` 在 `BEGIN IMMEDIATE` 事务内完成"读链尾 + 写新记录"，避免并发断链。
- 校验：`AuditService.verifyChain() → { ok, checked, brokenAt }`，经 `GET /api/v1/audit/verify` 暴露（PRD AC-06 相关）。
- **差距**：`audit_logs` 尚无"禁止 UPDATE/DELETE"的触发器；`detail` 的脱敏由调用方负责（待办见 `docs/security.md`）。

---

## 12. 架构守护

| 守护 | 实现方式 | 状态 |
| --- | --- | --- |
| 分层依赖 | eslint `no-restricted-imports` 或 dependency-cruiser：禁止 `core` 依赖任何包、禁止基础设施包互相依赖（`auth→storage` 白名单）、禁止循环 | 待落地（`scripts/verify.mjs` 预留） |
| 包元数据 | 校验各包 `exports` 指向 `src/index.ts`、无 `dist` 引用、依赖均已声明 | 待落地 |
| 类型 | 根 `pnpm typecheck`（`tsc --noEmit`，`strict` + `moduleResolution: Bundler`）；各包 `typecheck` 脚本已就位 | ✅ 脚本已就位 |
| 测试 | 根 `pnpm test`（vitest，覆盖 `packages/**`、`apps/**`、`tests/**` 的 `*.test.ts`） | 脚本已就位，用例待补 |
| 领域纯净 | 单测覆盖 SQL 分类（注释/字面量绕过）、权限判定（越权负例）、审计链（创世/断点）、DDL 生成 | 待补 |
| 秘密扫描 | CI 对 `logs/`、诊断包、测试快照扫描 `password|token|api[_-]?key` | 待落地 |

---

## 13. 扩展点：新增一个数据库驱动

以"新增 MySQL 真实驱动"为例，按顺序完成以下清单（文件名为当前仓库约定）：

| # | 文件/位置 | 改动 |
| --- | --- | --- |
| 1 | `packages/core/src/db-types.ts` | 把 `DB_TYPES` 中 `mysql` 的 `driverImplemented` 改为 `true`（类型已登记，无需新增字面量） |
| 2 | `packages/drivers/package.json` | 仅在需要新的**纯 JS** 依赖时添加；引入原生依赖须架构评审（违背零原生编译目标） |
| 3 | `packages/drivers/src/mysql.ts`（或 `src/mysql/` 目录） | 实现 `DatabaseDriver`：`dbType/name/version/implemented/capabilities/getInfo/connect/testConnection` |
| 4 | 同文件或 `src/mysql/connection.ts` | 实现 `DriverConnection`：`ping`、`getMetadata/getQueryExecutor/getDdlGenerator/getTypeMapper/getExplainParser`、`close` |
| 5 | `src/mysql/metadata.ts` | 实现 `MetadataProvider` 全部方法（`listSchemas`…`listTriggers`），走 `information_schema` 且参数化 |
| 6 | `src/mysql/executor.ts` | 实现 `QueryExecutor`（`maxRows`、`timeoutMs`、`cancel`、只读拦截、参数绑定、`notices`） |
| 7 | `src/mysql/ddl.ts` | 实现 `DdlGenerator`（方言：反引号、`AUTO_INCREMENT`、引擎与字符集） |
| 8 | `src/mysql/explain.ts` | 实现 `ExplainParser`（`EXPLAIN FORMAT=JSON` → `ExecutionPlan` + `toTree`） |
| 9 | `packages/drivers/src/type-map.ts` | 补充 MySQL 类型的 `normalizeType`/`mapType` 规则（含 `lossy` 标注） |
| 10 | `packages/drivers/src/identifiers.ts` | 若引用符/大小写规则不同，补充方言声明与白名单校验 |
| 11 | `packages/drivers/src/placeholder.ts` | 从 `createPlaceholderDrivers()` 中移除 `mysql` 占位 |
| 12 | `packages/drivers/src/registry.ts` | 在 `createDefaultRegistry()` 中 `registry.register(new MysqlDriver())` |
| 13 | `packages/drivers/src/index.ts` | 导出新驱动 |
| 14 | `apps/server/src/context.ts` | 确认注册表装配（通常无需改动） |
| 15 | `apps/server/src/routes/connections.ts`（待建） | 若引入新的必填校验，更新 zod schema |
| 16 | `apps/cli/src/commands/conn-add.ts`（待建） | 补充该类型参数模板与本地预检 |
| 17 | `apps/web/src/pages/ConnectionsPage.tsx` | 表单根据 `/meta/db-types` 的 `capabilities` 动态启用/置灰（无需硬编码驱动名） |
| 18 | `packages/drivers/src/mysql.test.ts` + `tests/integration/mysql/` | 单测（方言、类型映射、SQL 分类、只读拦截）+ 集成测试（无环境时 `skipIf`） |
| 19 | 文档 | 同步 PRD 附录 B 的状态、`docs/modules.md` M03 状态、本文 §7.3 矩阵、`docs/cli-reference.md` 连接参数 |

**驱动自检清单**：① 一切值走参数绑定；② 标识符白名单 + 方言引用；③ 无明文凭据进日志/审计；④ 长查询可 `cancel`；⑤ `capabilities` 如实声明（不支持就置 `false`，由界面置灰）；⑥ 未实现的方法显式失败，不静默返回空结果；⑦ 失败统一抛 `PeanutError`。

---

## 14. 风险、差距与演进

### 14.1 已识别差距（按优先级）

| # | 差距 | 影响 | 建议 |
| --- | --- | --- | --- |
| 1 | `clientIp()` **无条件信任 `X-Forwarded-For`**（`apps/server/src/http.ts`） | 伪造来源 IP → 污染审计、绕过 IP 维度限流 | 增加 `PEANUTSPROUT_TRUST_PROXY` 白名单，默认忽略转发头（`docs/security.md` 已列待办） |
| 2 | CORS 默认只放行本机来源（`isLocalOrigin()`）；显式配置 `PEANUTSPROUT_CORS_ORIGIN=*` 时会放宽 | 若运维图省事写成 `*`，任意站点可跨域调用（仍 `credentials:false`） | 保持默认本机白名单；生产用显式域名列表，禁止 `*` |
| 3 | `audit_logs` 无 append-only 触发器 | 有库写权限者可 `UPDATE/DELETE`（链校验仍能发现，但不能阻止） | 建表时加 `BEFORE UPDATE/DELETE` 触发器；仓储层不提供更新/删除方法 |
| 4 | 会话续签已实现（`POST /auth/refresh` 轮换并吊销旧会话），但无独立 refresh 令牌与重放检测 | 令牌在 12h 有效期内泄露即长期可用 | 引入 refresh/access 双令牌与重放检测 |
| 5 | 加密无 AAD / 无 `key_version` | 密文迁移错位不可检测；主密钥轮换需全量重加密 | 信封加入 `key_version` 与 `aad = "<recordId>:<field>"` |
| 6 | 无登录限流 | 在线爆破（虽有 5 次锁定 15 分钟兜底） | 在 `requireAuth`/`login` 前置限流中间件 |
| 7 | 生产库保护仅"识别 + 界面确认" | CLI/脚本调用可绕过界面确认 | 服务端签发一次性确认票据（`CONFIRMATION_REQUIRED` 已是 428 语义） |
| 8 | 部分能力仍未覆盖：8 种占位驱动、`incremental`/`sync` 迁移、部分图表类型浏览器内渲染、Windows/macOS/arm64 安装包 | 对应 PRD 能力尚未全部达成 | 按 `docs/roadmap.md` 推进；未实现处一律显式失败（`DRIVER_NOT_IMPLEMENTED` / ⬜ 占位面板），不伪装可用 |
| 9 | `node:sqlite` API 仍处活跃开发期 | 小版本升级可能破坏实现 | 锁定 Node 大版本；实现集中在 `LocalDatabase` 单点；CI 覆盖 22.x 与 24.x |
| 10 | SQLite 单写者 | 高并发写（审计 + 历史）可能 `SQLITE_BUSY` | WAL + `busy_timeout=5000` + `BEGIN IMMEDIATE` 已就位；进一步可批量合并审计写入、把重活移到 `worker_threads` |

### 14.2 演进方向（非本期承诺）

插件式驱动热加载（子进程隔离）、外部元数据库以支持多实例、审计链外部锚定（`settings.audit.chain_anchor_id` 已预留）、argon2id KDF 迁移、只读副本与查询审计回放、i18n/主题资源落地。
