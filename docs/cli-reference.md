# 花生苗数据库管理工具 · CLI 参考手册（`peanutsprout`）

> 版本：0.1.0
> 归属：`apps/cli`（包名 `@peanutsprout/cli`）
> 命令契约来源：`docs/PRD.md` 附录 A.9；错误码与服务端行为见 `docs/architecture.md` §11。
> 可执行文件名：`peanutsprout`（PRD §0.2 命名约定）。

## 状态图例与基线

| 标记 | 含义 |
| --- | --- |
| ✅ 已实现 | 代码已落地且可运行 |
| 🚧 进行中 | 接口已冻结，实现未完成 |
| ⬜ 规划中 | 仅有契约定义，尚未实现 |

**基线说明**：`apps/cli/` 已落地（`package.json` + `src/index.ts`）。**并非所有子命令都已实现** —— 每个章节标题下的状态标记（✅/🚧/⬜）以 `apps/cli/src/index.ts` 的实际代码为准；标 ⬜ 的命令当前不存在，照抄会以 `unknown command`（退出码 1）失败。命令名、参数与输出语义仍以 PRD 附录 A.9 为权威契约。

**实机验证记录**（2026-09-15，本机 Linux x64 / Node v24.21.0，服务端 `http://127.0.0.1:8899`，数据目录 `/tmp/clitest`）：`init` → `login` → `conn add`（SQLite ×3）→ `query execute`（建表）→ `import`（CSV 4 行含逗号与单引号字段）→ `export`（CSV 原样还原，转义正确）→ `migrate start`（SQLite→SQLite，干净目标库 **4/4 行成功**）→ `migrate status --report` → `audit export`（CSV 10 行）→ `ai explain`（AI 未启用时返回 `AI_DISABLED`，退出码 5）→ `update check`（未配置更新源时如实告知；配置本地清单后正确识别 9.9.9 > 0.1.0 并以退出码 13 结束）。

**本机环境的诚实缺口**：MySQL/MariaDB 服务端二进制在当前网络下无法下载（CDN 吞吐极低、GitHub Releases 不可达），因此 `--type mysql` 等连接**未经真实 MySQL 服务端验证**；驱动代码与方言逻辑（反引号、`MODIFY COLUMN`、`EXPLAIN` 解析、默认端口）已由不依赖服务端的测试覆盖。

---

## 1. 全局约定

### 1.1 调用形式

```bash
peanutsprout [全局选项] <命令> [子命令] [选项] [参数]

# 仓库内开发态（根 package.json 已提供脚本，落地后等价于 node apps/cli/src/index.ts）
pnpm cli <命令> [子命令] [选项]

# 打包产物（规划中）
peanutsprout            # Linux / macOS
peanutsprout.exe        # Windows
```

### 1.2 全局选项

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `--server <url>` | `http://127.0.0.1:8787`（或 `PEANUTSPROUT_SERVER`） | 服务端地址（不含 `/api/v1`，CLI 自动拼接） |
| `--token <jwt>` | — | 访问令牌；优先级见 §1.3 |
| `--token-file <path>` | — | 从文件读取令牌（避免进入 shell 历史） |
| `--data-dir <path>` | `~/.peanutsprout` | 等价于环境变量 `PEANUTSPROUT_HOME` |
| `-o, --output <fmt>` | `table`（或 `PEANUTSPROUT_OUTPUT`） | `table` \| `wide` \| `json` \| `jsonl` \| `csv` |
| `--timeout <ms>` | `30000` | 单次请求超时 |
| `-q, --quiet` | `false` | 仅输出数据，不输出提示与进度 |
| `-v, --verbose` | `false` | 调试日志（**仍脱敏**），可重复 |
| `--insecure` | `false` | 跳过 TLS 校验（仅自签名内网，打印警告） |
| `--yes` | `false` | 自动确认危险操作（生产库写、删除、迁移） |
| `-h, --help` / `-V, --version` | — | 帮助与版本 |

**⬜ 规划中（当前声明即报错）**：`--local`（本地直连模式）、`--db <path>`、`--profile <name>`、`--no-color`。
这些选项**没有**被 `program` 声明；`src/index.ts` 的注释明确说明：与其留着"看起来能用"的死开关，不如让 commander 直接以退出码 1 拒绝。多档位配置（`cli.json` 的 `profiles`）同样未落地。

### 1.3 令牌解析优先级

`--token` > `--token-file` > `PEANUTSPROUT_TOKEN` > 配置文件 `profiles.<name>.token` > `~/.peanutsprout/cli-token`（`0600`）。

令牌由 `POST /api/v1/auth/login` 签发（✅ 已实现），载荷 `{ sub, sid, username, iat, exp, iss }`，默认有效期 12 小时（服务端 `PEANUTSPROUT_TOKEN_TTL_SEC`）。**禁止**把令牌写进共享脚本或 CI 明文变量。

### 1.4 环境变量

**CLI 侧（✅ 已实现）**

| 变量 | 作用 |
| --- | --- |
| `PEANUTSPROUT_SERVER` | 等价 `--server` |
| `PEANUTSPROUT_TOKEN` | 等价 `--token`（见 `apps/cli/src/client.ts`） |
| `PEANUTSPROUT_OUTPUT` | 默认输出格式 |
| `PEANUTSPROUT_PASSWORD` | `passwd` 命令的"当前口令"来源 |
| `PEANUTSPROUT_USER` | `login` 的用户名来源 |

**⬜ 规划中**：`PEANUTSPROUT_NO_COLOR=1`（CLI 输出本来就不产生 ANSI 颜色，无消费方）。

**与服务端/本地模式共用（✅ 已实现，见 `apps/server/src/config.ts`、`packages/core/src/paths.ts`）**

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `PEANUTSPROUT_HOME` | `~/.peanutsprout` | 数据目录 |
| `PEANUTSPROUT_DB` | `<数据目录>/peanutsprout.db` | 库文件 |
| `PEANUTSPROUT_MASTER_KEY` | `<数据目录>/master.key` | 主密钥文件 |
| `PEANUTSPROUT_MASTER_PASSWORD` | 空 | 主密钥主密码（`password` 模式必需） |
| `PEANUTSPROUT_HOST` / `PEANUTSPROUT_PORT` | `127.0.0.1` / `8787` | 服务端监听（`serve` 使用） |
| `PEANUTSPROUT_TLS_KEY` / `PEANUTSPROUT_TLS_CERT` | 空 | 同时提供才启用 HTTPS |
| `PEANUTSPROUT_LOG_LEVEL` | `info` | 日志级别 |
| `PEANUTSPROUT_ADMIN_USERNAME` / `PEANUTSPROUT_ADMIN_PASSWORD` | `admin` / 空 | 首次启动引导管理员 |
| `PEANUTSPROUT_TOKEN_TTL_SEC` | `43200` | 令牌有效期 |
| `PEANUTSPROUT_IDLE_CONN_MS` | `1800000` | 空闲连接回收阈值 |

（⬜ 规划中的 `--local` 模式将忽略 `--server`/`--token` 与代理变量；当前尚不存在。）

### 1.5 配置文件

路径 `~/.peanutsprout/cli.json`（`0600`）：

```json
{
  "defaultProfile": "default",
  "profiles": {
    "default": { "server": "http://127.0.0.1:8787", "output": "table" },
    "prod-ro": { "server": "https://peanut.example.com", "output": "json", "readonly": true }
  }
}
```

### 1.6 输出格式

| 格式 | 说明 |
| --- | --- |
| `table` | ASCII 表格；`NULL` 显示为 `∅`；BLOB 显示为 `base64:…`（与服务端 `serializeCell` 一致） |
| `wide` | 同 `table` 但不截断列宽 |
| `json` | 单个 JSON 文档（便于 `jq`） |
| `jsonl` | 每行一条 JSON（结果集逐行，适合管道） |
| `csv` | RFC 4180，仅对结果集类命令有效 |

数据走 **stdout**，提示/进度/警告走 **stderr**，因此 `peanutsprout query execute -o csv > out.csv` 安全。

### 1.7 退出码（与 `docs/architecture.md` §11.4 的错误码对应）

| 码 | 含义 | 对应错误码 |
| --- | --- | --- |
| `0` | 成功 | — |
| `1` | 通用/内部错误 | `INTERNAL` |
| `2` | 用法或参数校验失败 | `VALIDATION_FAILED` |
| `3` | 资源不存在 | `NOT_FOUND` |
| `4` | 驱动未实现 | `DRIVER_NOT_IMPLEMENTED` |
| `5` | 权限不足 / 只读拦截 / AI 被禁用 / 需先改初始口令 | `AUTH_FORBIDDEN` / `READONLY_VIOLATION` / `AI_DISABLED` / `PASSWORD_CHANGE_REQUIRED` |
| `6` | 未认证或令牌失效 | `AUTH_REQUIRED` / `AUTH_INVALID_CREDENTIALS` / `AUTH_TOKEN_INVALID` / `AUTH_TOKEN_EXPIRED` |
| `7` | 冲突 | `CONFLICT` |
| `8` | 连接失败 / 超时 | `CONNECTION_FAILED` / `QUERY_TIMEOUT` |
| `9` | 需要二次确认（缺 `--yes`） | `CONFIRMATION_REQUIRED` |
| `10` | 账号被禁用或锁定 | `AUTH_ACCOUNT_DISABLED` / `AUTH_ACCOUNT_LOCKED` |
| `11` | 迁移失败 | `MIGRATION_FAILED` |
| `12` | AI 供应商错误 | `AI_PROVIDER_ERROR` |
| `13` | 发现新版本（`update check` 专用） | —（非错误，见 §12） |
| `130` | 被 Ctrl-C 中断（已发送取消） | `QUERY_CANCELLED` |

> **`PASSWORD_CHANGE_REQUIRED` 的映射依据**：`apps/cli/src/client.ts` 的 `EXIT_CODES` 把它归入 `5`，且 CLI 会额外打印可操作的修复指引（`peanutsprout passwd`）。
>
> **补充：commander 自身的用法错误不一定是 2**。`--param` 这类**未知选项**、未知子命令、未知根命令由 commander 直接处理，退出码为 **1**（输出 `error: unknown option '…'`）；只有命令体内部抛出的 `VALIDATION_FAILED`（如 `query execute --conn abc`）才是退出码 **2**。缺少必填选项（`requiredOption`）同样由 commander 以 1 退出。

---

## 2. `conn` — 连接管理

✅ 已实现（全部子命令）

### 2.1 `conn list`

```
peanutsprout conn list [--type <dbType>] [--search <kw>] [--favorite] [-o fmt]
```

对应 `GET /api/v1/connections?search=&dbType=&favorite=`（契约已冻结）。输出列：`ID`、`名称`、`类型`、`主机:端口`、`库`、`只读`、`收藏`、`最近使用`。

```bash
peanutsprout conn list
peanutsprout conn list --type sqlite -o json | jq '.items[].name'
```

### 2.2 `conn add`

```
peanutsprout conn add --type <dbType> [连接参数…] [--name <name>] [--read-only] \
  [--color <tag>] [--password-stdin] [--group <id>]
```

| 参数 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `--type <dbType>` | 是 | — | 15 种类型之一；未落地类型会以 `DRIVER_NOT_IMPLEMENTED`（退出码 `4`）明确拒绝 |
| `--name <name>` | 否 | 类型+主机 | 显示名 |
| `--host` / `--port` | 网络型必填 | 取 `DB_TYPES.defaultPort` | `sqlite` 改用 `--file <path>` |
| `--database` / `--user` | 否 | — | 库名与用户名 |
| `--password-stdin` | 否 | — | 从 stdin 读取口令（**推荐**，避免进入 shell 历史与进程列表） |
| `--connection-url` | 否 | — | 直接给连接串（与分项参数互斥） |
| `--ssl` / `--ssl-mode` / `--ssl-ca` | 否 | `disable` | SSL 配置 |
| `--ssh-host` / `--ssh-port` / `--ssh-user` / `--ssh-key` | 否 | — | SSH 隧道 |
| `--read-only` | 否 | `false` | 只读保护（驱动层 + 权限层双重拦截） |
| `--color <tag>` | 否 | — | 界面颜色标识；`red`/`prod`/`production` 触发生产库识别 |
| `--favorite` | 否 | `false` | 收藏 |

```bash
# MySQL 驱动已实现（但本机未能对真实 MySQL 服务端验证，见文档开头的诚实缺口）
peanutsprout conn add --type mysql --host 127.0.0.1 --port 3306 --user root --password-stdin

# 未实现的类型（Oracle / SQL Server / 达梦 / Redis / MongoDB / ClickHouse / InfluxDB / Neo4j）
# 会以 DRIVER_NOT_IMPLEMENTED（退出码 4）明确拒绝
peanutsprout conn add --type oracle --host 10.0.0.9 --user system --password-stdin

# 当前可用：本地 SQLite 文件连接
peanutsprout conn add --type sqlite --file ./demo.db --name local-demo
```

输出：新建连接 `id` 与一次 `testConnection` 结果摘要。口令在服务端**加密存储**（AES-256-GCM），接口只返回 `hasPassword: true`。

### 2.3 `conn test`

```
peanutsprout conn test <conn-id>
```

对应 `POST /api/v1/connections/{id}/test`。输出 `{ ok, latencyMs, serverVersion, message }`。占位驱动返回 `ok:false` 且 `message` 说明"未真正发起连接"（退出码 `4`）。

### 2.4 `conn remove`

```
peanutsprout conn remove <conn-id> [--yes]
```

对应 `DELETE /api/v1/connections/{id}`。需 `conn.write` 权限；默认二次确认；删除写审计 `connection_delete`。

### 2.5 `conn tables`

```
peanutsprout conn tables <conn-id> [--schema <name>]
```

列出目标库的表（`GET /connections/:id/schemas/:schema/tables`；未给 `--schema` 时先取该连接的第一个 schema，SQLite 为 `main`）。输出列：`表名 / 类型 / 注释`，并把实际使用的 schema 打到 stderr。

### 2.6 扩展子命令（⬜ 规划中，PRD 未定义、按需增补）

| 子命令 | 说明 |
| --- | --- |
| `conn show <id>` | 详情（含 `hasPassword`、SSL/SSH 摘要，**绝不含明文口令**） |
| `conn update <id>` | 局部更新（仅覆盖显式传入字段） |
| `conn use <id>` | 设为当前 profile 默认连接 |
| `conn export --out <file>` / `conn import --in <file>` | 配置迁移；默认不含密文，`--with-secrets` 需口令加密 |

---

## 3. `query` — SQL 执行

✅ 已实现

### 3.1 `query execute`

```
peanutsprout query execute --conn <conn-id> (--sql "<SQL>" | --file <path>) \
  [--max-rows <n>] [--timeout <ms>] [--yes] [-o fmt]
```

| 参数 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `--conn <conn-id>` | 是 | — | 连接 id（`requiredOption`；缺失由 commander 以退出码 1 拒绝） |
| `--sql` / `--file` | 二选一 | — | 内联 SQL 或 `.sql` 文件（`--file -` 读 stdin） |
| `--max-rows <n>` | 否 | 服务端上限 | 结果集行数上限；被截断时输出明确提示（`truncated`） |
| `--timeout <ms>` | 否 | `30000` | 查询超时（映射为请求体 `timeoutMs`） |
| `--yes` | 否 | `false` | **全局选项**；写操作确认（映射为请求体 `confirm: true`，缺失 → 退出码 `9`） |
| `--param k=v` | 否 | — | ⬜ **规划中**：CLI 当前**没有**该选项，声明即 `unknown option`（退出码 1）；参数绑定需走 REST 接口的 `params` 字段 |

```bash
# PRD 附录 A.9
peanutsprout query execute --conn 3 --sql "SELECT 1"
peanutsprout query execute --conn 3 --file query.sql

# 管道输出
peanutsprout query execute --conn 3 --sql "select id,name from users" -o jsonl > rows.jsonl

# ⬜ 规划中（当前会以 unknown option 退出码 1 失败）
# peanutsprout query execute --conn 3 --sql "select * from users where created_at > ?" --param t=2024-01-01
```

输出：结果集（`table/wide/json/jsonl/csv`）；stderr 打印 `rowCount`、`affectedRows`、`durationMs`、是否截断。写语句在只读连接上 → 退出码 `5`；超时 → `8`；`Ctrl-C` → 取消后 `130`。

### 3.2 `query explain`

```
peanutsprout query explain --conn <conn-id> --sql "<SQL>" [-o json]
```

对应 `POST /api/v1/query/explain`。默认打印计划文本；`-o json` 输出原始 JSON。**没有** `--format text|json|tree` 选项（声明即 `unknown option`，退出码 1）。驱动 `capabilities.explain=false` → `DRIVER_NOT_IMPLEMENTED`（**不**回退为执行语句）。

### 3.3 `query history` 与扩展子命令

✅ 已实现：`peanutsprout query history [--limit <n>]` —— 对应 `GET /api/v1/query/history?limit=`，只列时间/连接/状态/耗时/SQL 摘要，不返回结果集。**没有** `--conn` 过滤（⬜ 规划中）。

⬜ 规划中（当前不存在）：

| 子命令 | 说明 |
| --- | --- |
| `query cancel <queryId>` | 对应 `POST /api/v1/query/cancel`（`QueryExecutor.cancel`，SQLite 驱动已实现 `cancel()`）（⬜ 规划中） |
| `query stream` | SSE/WebSocket 流式读取大结果集（服务端尚未实现）（⬜ 规划中） |

---

## 4. `import` — 数据导入

✅ 已实现

```
peanutsprout import --conn <id> --table <table> --file <path> \
  [--schema <schema>] [--batch <n>] [--has-header] [--yes]
```

| 参数 | 说明 |
| --- | --- |
| `--conn` / `--table` / `--file` | 目标连接、目标表、CSV 源文件（`-` 读 stdin） |
| `--schema` | schema 名（可选） |
| `--batch` | 每条 `INSERT` 包含的行数（默认 `200`） |
| `--has-header` | 首行为列名（**默认即视为有表头**） |
| `--null-token <token>` | 把与该值完全相同的字段写成 `NULL`（如 `--null-token '\N'`）；缺省时所有字段按字符串处理 |
| `--yes` | 跳过插入前的二次确认 |

```bash
peanutsprout import --conn 3 --table users --file users.csv
peanutsprout import --conn 3 --table users --file users.csv --yes
```

行为与安全约束：

- 采用**多行 `VALUES` 批量 INSERT**，按 `--batch` 分块，逐条提交；
- CSV 解析内建（支持双引号包裹、字段内逗号/换行、`""` 转义、BOM 剥离），**不引第三方依赖**；
- **表头与表名都过标识符白名单**（`^[\p{L}_][\p{L}\p{N}_$]*$`）——否则等于把 SQL 注入权交给了被导入的文件；
- 字段值按字面量转义（单引号翻倍），数字与布尔直出，空字段写 `NULL`；
- **不会自动建表**：目标表不存在时如实报 `no such table`，需先自行建表。

```bash
# 实机验证：4 行含逗号与单引号字段，导入后导出可原样还原
$ peanutsprout import --conn 1 --table people --file people.csv --yes
✅ 已导入 4 行到 people（1 条 INSERT）
```

**未实现**：`--format json|jsonl|xlsx`、`--dry-run`、`--on-conflict`、`--delimiter`。

---

## 5. `export` — 数据导出

✅ 已实现

```
peanutsprout export --conn <id> --table <table> [--schema <schema>] [--out <path>] [--limit <n>]
```

| 参数 | 说明 |
| --- | --- |
| `--conn` / `--table` | 目标连接与表名 |
| `--schema` | schema 名（可选，会拼成 `schema.table`） |
| `--out` | 输出文件；**缺省打印到 stdout**，便于管道 |
| `--limit` | 最多导出行数（默认 `100000`） |

```bash
peanutsprout export --conn 3 --table users --out users.csv
peanutsprout export --conn 3 --table users | head -5
```

行为：走 `POST /api/v1/query/execute` 执行只读 `SELECT * FROM <t> LIMIT <n>`（**不落服务端文件**），
表名与 schema 均过标识符白名单；结果被截断时会明确告警，不会静默少给数据。

```bash
# 实机验证
$ peanutsprout export --conn 1 --table people
id,name,region,amount
1,张三,华东,100.5
3,"王,五",华东,300
4,O'Brien,华北,80
```

**未实现**：`--sql` 自定义查询、`--format json|jsonl|xlsx`、`--compress`、`--include-ddl`。

---

## 6. `migrate` — 数据迁移

✅ 已实现（`precheck` / `start` / `status` / `tasks` / `cancel`）

**已实现的子命令（以下为代码中的真实参数，非规划稿）**

```
peanutsprout migrate precheck --source <id> --target <id> [--tables a,b,c]
peanutsprout migrate start    --source <id> --target <id> [--name <n>] [--tables a,b,c]
                              [--mode full] [--conflict overwrite|skip|error|manual]
                              [--batch <n>] [--no-structure] [--no-data] [--dry-run] [--yes]
peanutsprout migrate status   <id> [--report] [--watch]
peanutsprout migrate tasks
peanutsprout migrate cancel   <id>
```

> **`--mode` 目前只接受 `full`**。CLI 的 `--mode` 是自由字符串并原样透传；服务端 `packages/migration/src/engine.ts` 的 `assertFullMode()` 会对 `incremental` / `sync` 返回 **`400 VALIDATION_FAILED`**，`details.supportedModes = ["full"]`。后两种模式（⬜ 规划中）尚未实现，不会"看起来能跑"。

| 子命令 | 对应接口 | 说明 |
| --- | --- | --- |
| `precheck` | `POST /api/v1/migration/precheck` | 预检报告（PRD SR-10）：类型兼容性、`lossy` 映射、数据量估算；**不写入任何数据** |
| `start` | `POST /api/v1/migration/start` | 真实执行迁移；非 `--dry-run` 时会先要求二次确认（`--yes` 跳过） |
| `status` | `GET /api/v1/migration/{id}` | 状态与行数；`--report` 追加逐表报告，`--watch` 每 2 秒轮询至终态 |
| `tasks` | `GET /api/v1/migration/tasks` | 任务列表 |
| `cancel` | `POST /api/v1/migration/{id}/cancel` | 取消进行中的任务 |

```bash
peanutsprout migrate precheck --source 1 --target 2 --tables users
peanutsprout migrate start    --source 1 --target 2 --tables users --yes
peanutsprout migrate status   3 --report
```

> **注意返回字段命名不一致**：`POST /migration/precheck` 返回 `taskId`，而 `POST /migration/start` 返回的是 `MigrationResult`（字段为 `migrationId`，另含 `totalRows/successRows/failedRows/skippedRows`）。CLI 已按各自真实契约取字段；调用 REST 的脚本需留意此差异。
>
> **未实现**：`migrate resume`（断点续传，PRD SR-09）尚无独立子命令 —— `migration_checkpoints` 表已在用（`status --report` 可见 `checkpoints[].lastOffset`），但续传需重新发起 `start`。
>
> **驱动现状（诚实说明）**：SQLite、PostgreSQL、Kingbase、MySQL、MariaDB、TiDB、OceanBase 均已落地真实驱动；Oracle、SQL Server、达梦、Redis、MongoDB、ClickHouse、InfluxDB、Neo4j 仍为占位驱动，调用时明确返回 `DRIVER_NOT_IMPLEMENTED`。**MySQL 驱动未经真实 MySQL 服务端验证**（本机无法下载到服务端二进制），异构迁移链路已由 **SQLite → 真实 PostgreSQL** 端到端验证（`packages/migration/src/cross-db.test.ts`，6 项）。

---

## 7. `ai` — AI 助手

✅ 已实现（`status` / `nl2sql` / `explain`；服务端可完全禁用，禁用时返回 `AI_DISABLED` → 退出码 `5`）

**已实现的子命令**

```
peanutsprout ai status
peanutsprout ai nl2sql --conn <conn-id> --prompt "<自然语言>"
peanutsprout ai explain --sql "<SQL>"          # 也可 --sql - 从 stdin 读取
```

| 参数 | 说明 |
| --- | --- |
| `--prompt` | 自然语言需求（PRD AC-04 示例：「查最近 7 天订单金额前 10 的用户」） |
| `--sql` | 要解释的 SQL；传 `-` 表示从 stdin 读取，便于与管道组合 |

**`ai nl2sql` 只生成、绝不自动执行**：CLI 层面没有 `--execute` 开关；服务端 `AiService.generateSql()` 的返回值里**没有执行产物**（只有 `sql` / `explanation` / `confidence` / `referencedTables` / `requiresConfirmation` / `raw`，不含 `rows`、`rowCount` 等字段），HTTP 路由再额外加上 `executed: false` 与 `connectionId` 明确告知前端"未执行"（该字段由 `apps/server/src/routes/ai-migration.ts` 添加，`ai.e2e.test.ts` 有断言）。
需要执行时由用户显式复制 SQL 再走 `query execute`（从而必然经过写操作四道闸门）。`scripts/ai-live-test.mjs` 会对生成的 SQL 做真实校验：既检查响应不含执行产物（`executed: true` 亦视为失败），又在临时库上比对调用前后的行数/金额/表集合，确认没有任何写副作用。

**未实现的子命令（服务端路由已存在，CLI 未封装）**

```
peanutsprout ai optimize --conn <conn-id> --sql "<SQL>"     # 服务端 POST /api/v1/ai/optimize 已就绪
peanutsprout ai document --conn <conn-id> [--schema <s>]    # 服务端 POST /api/v1/ai/document 已就绪
peanutsprout ai ask --conn <conn-id> --question "<问题>"     # 服务端 POST /api/v1/ai/ask 已就绪
peanutsprout ai diagnose --conn <conn-id> --error "<e>"     # 服务端 POST /api/v1/ai/diagnose 已就绪
```

安全约束（`packages/auth/src/rbac.ts` 已实现闸门）：

1. `ai.use` 权限 + AI 未被管理员禁用；
2. 生产库（`colorTag=red` 或名称含 `prod|production|线上|生产`，或连接只读）**默认禁止 AI 执行写操作**，必须由人工在 SQL 编辑器中确认执行；
3. AI 输出必须先经危险语句检查，且写操作一律二次确认；
4. 出网前经脱敏网关（表名/列名/字面量/联系方式替换为占位符），**默认不携带样本行**。

```bash
peanutsprout ai status
peanutsprout ai nl2sql --conn 3 --prompt "查最近7天订单前10用户"
peanutsprout ai explain --sql "SELECT ..."
cat query.sql | peanutsprout ai explain --sql -
```

**实机验证（2026-09-15，真实模型 `gpt-5.6-sol`，OpenAI 兼容端点）**：`nl2sql` 对「查最近 7 天订单金额前 10 的用户」生成的 SQL 可直接执行并返回 3 行结果（AC-04 的核心链路已跑通）；`explain` / `optimize` / `diagnose` 同样返回有效结构化内容。相关脚本见 `scripts/ai-live-test.mjs`。

---

## 8. `user` — 用户与权限

🚧 **部分实现**：只实现了 `user list`、`user add`、`user passwd`；角色/授权/会话管理**尚未实现**（⬜ 规划中）。

### 8.1 已实现

```
peanutsprout user list [-o fmt]
peanutsprout user add <username> [--display-name <n>] [--email <e>] [--admin]
                                 [--role <role...>] [--password-stdin]
peanutsprout user passwd <id>          # 管理员重置指定用户口令（走 PUT /api/v1/users/:id）
```

| 项 | 说明 |
| --- | --- |
| `user add <username>` | 用户名是**位置参数**（不是 `--username`）；口令可用 `--password-stdin` 或交互输入；`--role` 可重复/多值；`--admin` 授予管理员 |
| `user passwd <id>` | 参数是**数字用户 id**（不是用户名）。它走 `PUT /api/v1/users/:id`，因此**会被默认口令强制改密闸门拦截** —— 仍有初始口令的用户必须先用下面的自助改密命令 |
| `--password-stdin` | 从 stdin 读取口令；**不接受 `--password`**（避免进程列表泄露）。非交互环境下若未提供会明确报错 |

### 8.2 与认证相关的顶层命令（✅ 已实现，不在 `user` 之下）

```
peanutsprout login  [--server <url>] [--username <u>] [--password-stdin]
peanutsprout logout
peanutsprout whoami
peanutsprout passwd [--old <pwd>] [--new <pwd>] [--password-stdin]   # 修改当前登录用户口令
```

`passwd` 走白名单里的 `POST /auth/change-password`，**是初始口令状态下唯一可用的改密路径**；
`user passwd <id>` 走 `PUT /users/:id`，在闸门解除前会被拒绝（`403 PASSWORD_CHANGE_REQUIRED` → 退出码 5）。

### 8.3 ⬜ 规划中（当前不存在，声明即 `unknown command`，退出码 1）

```
peanutsprout user role <username> <role,role>
peanutsprout user grant <username> --resource connection:<id> --actions read,write
peanutsprout user revoke <username> --resource connection:<id> [--actions read]
peanutsprout user session list [--user <u>] | revoke <sessionId|--user <u>>
peanutsprout user login --server <url> --username <u> [--save]
peanutsprout user logout [--all-sessions]
```

对应 REST 接口（`/users/:id` 的角色与授权、`/sessions`）由服务端提供，但 CLI 尚未封装。

口令强度（`checkPasswordStrength`，✅ 已实现）：长度 ≥ 6（`MIN_PASSWORD_LENGTH`）且 ≤ 256。**按需求方要求只校验长度** —— 默认口令 `123456` 是纯数字单类别，若保留原 PRD 4.6 的「两类字符 + 常见口令黑名单」规则会被自己的策略判为非法；严格规则已在源码中注释保留，需要时可直接启用（见 `docs/security.md`）。连续失败 5 次锁定 15 分钟（`AUTH_ACCOUNT_LOCKED`，HTTP 423 → 退出码 `10`）。

```bash
peanutsprout login --server https://peanut.example.com --username feige --password-stdin
peanutsprout passwd --old "$OLD" --new "$NEW"     # 自助改密（初始口令状态下必用）
peanutsprout user list
peanutsprout user add zhangsan --role developer --password-stdin
peanutsprout user passwd 3                        # 管理员重置 #3 的口令（需闸门已解除）
```

---

## 9. `audit` — 审计日志

✅ 已实现（`query` / `verify` / `stats` / `export`；部分过滤参数未实现，见下）

```
peanutsprout audit query  [--user <username>] [--action <action>] [--status <status>] [--limit <n>] [-o fmt]
peanutsprout audit verify
peanutsprout audit stats
peanutsprout audit export [--out <path>] [--format csv|json] [--user <username>] \
                          [--action <action>] [--status <status>] [--limit <n>]
```

`audit export` 由**服务端**生成文件内容（`GET /api/v1/audit/logs/export`），导出动作本身也会写入审计；
`--out` 缺省为 `audit-<时间戳>.<格式>`。

```bash
peanutsprout audit export --out audit.csv --limit 50
peanutsprout audit verify
```

**未实现**：`--from`/`--to` 时间区间、`--conn` 过滤、`--offset`、`audit tail`。

| 参数 | 说明 |
| --- | --- |
| `--action` | `login`/`logout`/`login_failed`/`connect`/`disconnect`/`execute`/`migrate`/`import`/`export`/`ai`/`user_create`/`user_update`/`user_delete`/`connection_create`/`connection_update`/`connection_delete`/`settings_update`/`audit_verify` |
| `--full` | 校验整条链（默认仍全量校验，`AuditService.verifyChain()` 无区间参数） |

```bash
# PRD 附录 A.9
peanutsprout audit query --from 2025-01-01 --to 2025-12-31
peanutsprout audit export --file audit.csv
# 哈希链校验（对应 GET /api/v1/audit/verify）
peanutsprout audit verify
```

`audit verify` 输出：

```
链完整性校验：通过
已校验记录数：42873
```

失败时输出断点位置与原因（`{ ok: false, checked, brokenAt }`），退出码 `1`（校验不通过属于数据完整性问题，非权限问题）。

哈希链公式（✅ 已实现，`packages/storage/src/repositories/audit.ts`）。

**按行版本化**（`audit_logs.hash_version`，迁移 `0003`）：

```
# v1 —— 历史行沿用，永不改动，保证升级前写入的链依然可验
curr_hash = sha256(prev_hash + '|' + JSON.stringify([userId, username, action, resourceType,
            resourceId, connectionId, detail, sqlText, status, errorMessage, createdAt]))

# v2 —— 新写入的行。额外纳入 ipAddress / userAgent / durationMs，
#        并用带类型前缀的编码区分 null 与空串（v1 里两者哈希相同）
prev_hash = 前一条记录的 curr_hash；创世记录使用字面量 'GENESIS'
```

除逐行校验外还有**链尾锚** `settings['audit.chain_tail']`（尾行 id : 尾哈希 : 锚点后行数），
专门用于发现「把最后几行删掉」——逐行衔接检查对此完全无感。

> **诚实边界**：链是无密钥 sha256，任何能写库的人可以整链重算并同步改锚。
> 锚只能检测局部篡改与删尾，**不能阻止整体重算**——不宣称"不可篡改"。

写闸门拒绝的写尝试也会留痕：`status='denied'`，`detail` 含 `{ write, gate, confirmed }`。

---

## 10. `serve` — 启动服务端

✅ 已实现，但**只有 3 个专有选项**（外加全局 `--data-dir`）：

```
peanutsprout serve [--host <ip>] [--port <n>] [--no-web] [--data-dir <path>]
```

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--host` / `--port` | `127.0.0.1` / `8787` | 等价于设置 `PEANUTSPROUT_HOST` / `PEANUTSPROUT_PORT`；默认仅本机 |
| `--no-web` | 托管 Web | 设置 `PEANUTSPROUT_SERVE_WEB=false`，不托管已构建的 Web 静态资源 |
| `--data-dir` | `~/.peanutsprout` | 全局选项；写入 `PEANUTSPROUT_HOME` |

**⬜ 规划中（当前声明即 `unknown option`，退出码 1）**：`--https`、`--tls-cert`、`--tls-key`、`--cors-origin`、`--serve-web`、`--log-level`、`--log-dir`、`--token-ttl`、`--idle-conn-ms`、`--trust-proxy`、`--init-only`、`--daemon`、`--pid-file`。

这些能力目前**只能通过环境变量**配置（`apps/server/src/config.ts`）：

| 环境变量 | 默认 | 作用 |
| --- | --- | --- |
| `PEANUTSPROUT_TLS_CERT` / `PEANUTSPROUT_TLS_KEY` | 空 | 二者同时提供才启用 HTTPS |
| `PEANUTSPROUT_CORS_ORIGIN` | 仅本机来源 | 逗号分隔白名单（`*` 仅开发） |
| `PEANUTSPROUT_LOG_LEVEL` | `info` | 日志级别 |
| `PEANUTSPROUT_TOKEN_TTL_SEC` | `43200` | 令牌有效期（秒） |
| `PEANUTSPROUT_IDLE_CONN_MS` | `1800000` | 空闲连接回收阈值 |
| `PEANUTSPROUT_SERVE_WEB` / `PEANUTSPROUT_WEB_DIST` | 托管 / 内置 | 静态资源开关与目录 |

启动后输出：监听地址、数据目录、库路径、schema 版本、主密钥模式、已实现驱动列表、是否需要初始化管理员。**不打印**任何令牌或口令。首次启动会自动 `ensureDataDir(0700)`、生成主密钥、建表迁移、按 `PEANUTSPROUT_ADMIN_USERNAME/PASSWORD` 创建管理员。

```bash
# 推荐生产形态：本机监听 + 反代终结 TLS
peanutsprout serve --host 127.0.0.1 --port 8787 --data-dir /var/lib/peanutsprout

# 端口 8080 + HTTPS（⬜ 规划中的 --https 不存在，需改用环境变量）
PEANUTSPROUT_PORT=8080 PEANUTSPROUT_TLS_CERT=/etc/ssl/c.pem PEANUTSPROUT_TLS_KEY=/etc/ssl/k.pem \
  peanutsprout serve
```

> ⚠️ **`apps/server/src/main.ts` 不解析任何 CLI 参数**：`serve` 的 `--host/--port/--no-web` 由 CLI 转成环境变量后再启动服务端。因此容器里直接 `CMD ["serve","--port","8787"]` **不会生效**，请用环境变量（见 `docs/deployment.md`）。

健康检查：`GET /api/v1/health` → `{ status, version, product, uptimeSec, schemaVersion }`（✅ 已实现；桌面端启动时另含 `instanceNonce`，不再返回 `masterKeyMode`）。

---

## 11. `update` — 版本更新

✅ 已实现

**已实现**

```
peanutsprout update check [-o fmt]
```

行为：读取环境变量 `PEANUTSPROUT_UPDATE_MANIFEST` 指向的 JSON 更新清单（`{ version, notes?, url? }`），与本地版本做语义化版本比较。

- **未配置更新源时如实告知"无法判断是否有新版本"**，不会假装"已是最新"（离线/内网环境的正常状态）；
- 清单版本更高 → 输出新版本号与下载地址，**退出码 13**；否则输出"已是最新版本"；
- 更新清单属于**外部不可信内容**，只按数据解析，绝不执行其中任何内容。

```bash
peanutsprout update check
PEANUTSPROUT_UPDATE_MANIFEST=https://example.com/manifest.json peanutsprout update check
```

**未实现（规划中）**

```
peanutsprout update download [--out <dir>]
peanutsprout update apply --file <pkg> [--backup] [--yes] [--restart]
peanutsprout update rollback [--to <version>] [--yes]
```

规划要求：① 校验 `sha256` + 发布者签名，失败即拒绝应用；② 升级前自动备份数据目录（含 `master.key`）；③ 支持离线更新包（内网 `--file` 分发）；④ 更新写审计 `settings_update`（含 `from/to` 版本与备份路径）。桌面端走 electron-updater，CLI/服务端走本命令（见 `docs/deployment.md` §9）。

---

## 12. `diagnose` — 诊断包导出

✅ 已实现（`diagnose --out`，输出不含任何口令与密文）

**已实现**

```
peanutsprout diagnose [--out <path>]
```

拉取 `GET /api/v1/meta/diagnostics` 并原样输出（`--out` 写文件，缺省打印到 stdout）。**未实现**：`diagnose doctor`、`diagnose logs`、`--include-logs`（压缩包形式）仍在路线图中。

服务端 `/meta/diagnostics` 当前返回的内容（可直接作为诊断 JSON 的基础）：

| 字段 | 内容 |
| --- | --- |
| `product` | 产品名、版本、协议 |
| `runtime` | Node 版本、平台、架构、PID、运行时长、内存 |
| `storage` | 库路径、schema 版本、已应用迁移、**主密钥模式**、用户数 |
| `drivers` | 每种类型的 `implemented` 与驱动版本 |
| `connections` | 连接**元信息**（id/name/dbType/host/port/database/username/isReadOnly）——**无口令、无密文** |
| `liveConnections` | 活跃会话统计（连接 id、类型、开启/最近使用时间、空闲时长） |
| `auditChain` | `verifyChain()` 结论（`ok/checked/brokenAt`） |

**禁止包含**：`master.key` 内容、任何明文口令、`password_enc`/`ssh_config_enc`/`ssl_config_enc`/`api_key_enc` 密文、`users.password_hash`、`sessions` 行、查询结果集。导出前建议做一次关键字扫描（`password|secret|token|api[_-]?key|BEGIN .*PRIVATE KEY`）。

---

## 13. 内置命令

| 命令 | 状态 | 说明 |
| --- | --- | --- |
| `peanutsprout help [命令]` | ✅ | commander 自动提供；`-h` 亦可 |
| `peanutsprout version` | ✅ | 打印产品名、版本、作者、许可；**JSON 输出用全局 `-o json`**（没有 `--json` 选项）；也支持 `-V` |
| `peanutsprout completion <shell>` | ⬜ 规划中 | 当前**不存在**该命令（声明即 `unknown command`，退出码 1） |

---

## 14. 与 PRD 附录 A.9 的对照

| PRD A.9 命令 | 本手册章节 | 现状 |
| --- | --- | --- |
| `conn list` | §2.1 | ✅ 实现，扩展了 `--type/--search/--favorite` |
| `conn add --type --host --port --user` | §2.2 | ✅ 实现（含 `--password-stdin`、`--read-only`、`--color` 等） |
| `conn test <conn-id>` | §2.3 | ✅ 实现 |
| `conn remove <conn-id>` | §2.4 | ✅ 实现（配合全局 `--yes`） |
| `conn export` / `conn import` | §2.5 | ⬜ 规划中 |
| `query execute --conn --sql/--file` | §3.1 | ✅ 实现（`--max-rows/--timeout/--yes`）；`--param` ⬜ 规划中 |
| `query explain --conn --sql` | §3.2 | ✅ 实现；`--format` ⬜ 规划中 |
| `import --conn --table --file` | §4 | ✅ 实现（`--batch/--has-header/--null-token`）；`--format/--dry-run` ⬜ |
| `export --conn --table --file --format` | §5 | 🚧 部分：`--out/--limit` 已实现；`--format/--sql/--compress` ⬜（输出固定 CSV） |
| `migrate precheck/start/status` | §6 | ✅ 实现，另有 `tasks/cancel`；`resume` 与 `--mode incremental/sync` ⬜ |
| `ai nl2sql --conn --prompt` / `ai explain --sql` | §7 | ✅ 实现；`optimize/document/ask/diagnose` 服务端有路由、CLI ⬜ 未封装 |
| `user list` | §8 | 🚧 部分：`list/add/passwd` ✅；`role/grant/revoke/session` ⬜ |
| `audit query --from --to` / `audit export --file` | §9 | 🚧 部分：`query/verify/stats/export` ✅；`--from/--to` 与 `audit tail` ⬜ |
| `serve --port --https` | §10 | 🚧 部分：`--host/--port/--no-web` ✅；`--https` 等 ⬜（改用环境变量） |
| `update check` | §11 | ✅ 实现；`download/apply/rollback` ⬜ |
| `diagnose export --file diag.zip` | §12 | 🚧 部分：`diagnose [--out]` ✅；`doctor`、打包 zip ⬜ |

---

## 15. 脚本化实践建议

| 场景 | 建议 |
| --- | --- |
| CI 只读校验 | 使用只读连接或只读角色账号；写语句会以退出码 `5` 明确失败 |
| 令牌管理 | `--token-file` 或 `PEANUTSPROUT_TOKEN`；禁止 `--token` 出现在共享脚本与日志 |
| 错误分支 | 依据**退出码**（§1.7）分支，不要解析 stderr 文本 |
| 大结果集 | `-o jsonl` 管道处理；等待 `query stream` 落地后再用于超大表 |
| 危险操作 | 始终显式 `--yes`；生产库连接建议加 `--color red`（触发生产库识别与红标） |
| 离线环境 | 直连本地数据目录需要 ⬜ 规划中的 `--local`；当前必须先 `peanutsprout serve`，再用 `--server http://127.0.0.1:8787` |
