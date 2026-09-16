# 花生苗数据库管理工具 · REST API 契约

> 本文件是**权威接口契约**，与 `apps/server/src/routes/*.ts` 的实现一一对应。
> 修改接口时必须同步更新本文件，否则视为交付不完整。

- **产品**：花生苗数据库管理工具（PeanutSprout DB Manager）
- **作者**：飞哥（微信 6731663）
- **许可**：AGPL-3.0-or-later，Copyright (C) 2025 飞哥
- **版本**：v0.1.0
- **实现状态图例**：✅ 已实现并测试 · 🟡 部分实现 · ⬜ 规划中

---

## 1. 通用约定

### 1.1 基址与版本

| 项 | 值 |
| --- | --- |
| 默认监听 | `http://127.0.0.1:8787` |
| API 前缀 | `/api/v1` |
| 内容类型 | `application/json; charset=utf-8` |
| 字符编码 | UTF-8 |
| 时间格式 | ISO 8601 带时区（`2025-01-01T00:00:00.000Z`） |

> 除 `/health`、`/auth/login` 外，所有接口都需要认证。静态界面由同一个服务在 `/` 托管（`PEANUTSPROUT_SERVE_WEB=true`）。

### 1.2 认证

```http
Authorization: Bearer <JWT>
```

- 算法 **HS256**，签名密钥由本机主密钥经 HMAC 派生（`peanutsprout/jwt/hs256/v1`）。
- 载荷：`{ sub: 用户id, sid: 会话id, username, iat, exp, iss: "peanutsprout" }`。
- 校验顺序：**先校验 `alg`/`typ`，再验签，最后校验 `iss`/`exp`** —— 杜绝 `alg=none` 与算法混淆。
- 默认有效期 12 小时（`PEANUTSPROUT_TOKEN_TTL_SEC`），登出会立即吊销会话，令牌随之失效。

### 1.3 错误响应格式

失败一律返回该结构（不再有第二种形状）：

```json
{
  "error": {
    "code": "READONLY_VIOLATION",
    "message": "该连接已开启只读保护，禁止执行写操作",
    "details": { "connectionId": 3 }
  }
}
```

### 1.4 错误码与 HTTP 状态码对照

| HTTP | `code` | 含义 |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | 参数校验失败 |
| 400 | `QUERY_FAILED` | SQL 执行失败（驱动/数据库返回的错误） |
| 401 | `AUTH_REQUIRED` | 未提供令牌 |
| 401 | `AUTH_INVALID_CREDENTIALS` | 用户名或口令错误 |
| 401 | `AUTH_TOKEN_INVALID` | 令牌非法（签名/结构/issuer） |
| 401 | `AUTH_TOKEN_EXPIRED` | 令牌过期 |
| 403 | `AUTH_FORBIDDEN` | 权限不足 |
| 403 | `AUTH_ACCOUNT_DISABLED` | 账号被禁用 |
| 403 | `PASSWORD_CHANGE_REQUIRED` | 仍在使用初始口令，须先改密 |
| 403 | `READONLY_VIOLATION` | 连接只读保护拦截写操作 |
| 403 | `AI_DISABLED` | AI 功能被关闭 |
| 404 | `NOT_FOUND` | 资源不存在 |
| 409 | `CONFLICT` | 唯一约束冲突 |
| 423 | `AUTH_ACCOUNT_LOCKED` | 账号锁定（连续失败 5 次 / 15 分钟） |
| 428 | `CONFIRMATION_REQUIRED` | 危险操作缺少二次确认 |
| 499 | `QUERY_CANCELLED` | 查询被取消 |
| 500 | `INTERNAL` | 服务端内部错误 |
| 500 | `MIGRATION_FAILED` | 迁移失败 |
| 501 | `DRIVER_NOT_IMPLEMENTED` | 该数据库驱动尚未实现 |
| 502 | `CONNECTION_FAILED` | 无法连接目标数据库 |
| 502 | `AI_PROVIDER_ERROR` | 大模型服务异常 |
| 504 | `QUERY_TIMEOUT` | 查询超时 |

（错误码全集见 `packages/core/src/errors.ts` 的 `ErrorCode` 类型，HTTP 映射见同文件 `DEFAULT_STATUS`。）

> **`DRIVER_NOT_IMPLEMENTED` 是本项目的重要设计承诺**：未实现的数据库不会被伪装成可用，调用时立即明确报错，绝不静默失败或返回空结果。

> **`PASSWORD_CHANGE_REQUIRED`（403）触发条件**：引导管理员时**使用了内置默认口令 `123456`**，
> 于是 `security.must_change_password = true`。此时闸门（`apps/server/src/http.ts` 的
> `assertPasswordChangedIfPending()`）**只放行 4 个接口**：
> `POST /auth/change-password`、`POST /auth/logout`、`POST /auth/refresh`、`GET /auth/me`；
> 其余一切需要认证的接口返回 `403 PASSWORD_CHANGE_REQUIRED`，`details.changePasswordUrl` 为
> `/api/v1/auth/change-password`。改密成功后该开关置为 false，闸门自动解除。
> 若引导时通过 `PEANUTSPROUT_ADMIN_PASSWORD` 指定了自定义口令，则从不会置位。

### 1.5 权限码

角色与权限在本地库中定义，接口用权限码判定（`requireAuth(ctx, '<code>')`）。

| 权限码 | 说明 |
| --- | --- |
| `conn.read` | 查看连接 |
| `conn.write` | 新建/修改/删除连接 |
| `query.read` | 执行查询 |
| `query.write` | 执行写语句（INSERT/UPDATE/DDL…） |
| `migrate.read` | 查看迁移任务与预检 |
| `migrate.write` | 执行迁移 |
| `ai.use` | 使用 AI 助手 |
| `audit.read` | 查看/导出审计日志 |
| `user.manage` | 用户与权限管理 |
| `settings.manage` | 系统设置、AI 配置、审计清理 |

内置角色：`admin`（全部权限）、`developer`（`conn.read` `query.read` `query.write` `migrate.read` `migrate.write` `ai.use`）、`readonly`（`conn.read` `query.read`）。

**连接可见性规则**：管理员可见全部连接；普通用户若**没有任何**连接级授权，退化为"角色模式"（可见全部）；一旦拥有 ≥1 条连接授权，则进入"白名单模式"，仅可见被授权的连接。

> **不可见即"不存在"**：对未授权的连接，`GET /connections/:id`、`/query/execute` 等一切按 id 访问的接口一律返回 **404 `NOT_FOUND`**（而非 403）。若返回 403，攻击者就能仅凭状态码差异枚举出系统内存在哪些连接 id。因此本实现刻意让"无权访问"与"不存在"在外部观察上完全等价。

### 1.6 参数绑定

`/query/execute` 支持 `params` 数组按 `?` 占位符绑定：

```json
{ "connectionId": 3, "sql": "SELECT * FROM users WHERE name = ?", "params": ["张三"] }
```

**值一律走绑定，绝不拼进 SQL**；表名/列名等无法绑定的标识符走白名单校验（`^[\p{L}_][\p{L}\p{N}_$]*$`）后加引号转义。

---

## 2. 系统与元信息

### ✅ `GET /health`

无需认证。探活与版本自检。

```json
{
  "status": "ok",
  "version": "0.1.0",
  "product": "花生苗数据库管理工具",
  "uptimeSec": 128,
  "schemaVersion": "0002_audit_drop_user_fk"
}
```

字段说明：
- `schemaVersion`：本部署已应用到的最新迁移版本号。**予以保留** —— 运维需要据此判断某个部署跑到哪一版迁移，且它只涉及产品自身的内部版本号。
- **已移除的两个字段**：`masterKeyMode` 曾暴露"本地库有没有被主密码保护"，`dataDir`/`dbPath`（在 `/meta/info`）曾暴露服务端绝对路径。三者都属于未鉴权即泄漏的内部信息，现已不再返回。审计与排障所需的路径信息请查看服务端启动日志。
- 若由桌面端启动，`/health` 还会带上 `instanceNonce`（桌面端用来确认"应答者是我启动的那个子进程"）；普通部署不设置该变量，字段不出现。

### ✅ `GET /meta/info`

产品、作者、许可与已实现驱动清单。**不再返回 `dataDir`/`dbPath`**（未鉴权接口不应暴露服务端绝对路径）。

```json
{
  "nameZh": "花生苗数据库管理工具",
  "nameEn": "PeanutSprout DB Manager",
  "author": "飞哥",
  "wechat": "6731663",
  "license": "AGPL-3.0-or-later",
  "version": "0.1.0",
  "dataDir": "/home/user/.peanutsprout",
  "dbPath": "/home/user/.peanutsprout/peanutsprout.db",
  "implementedDrivers": ["sqlite"]
}
```

### ✅ `GET /meta/db-types`

15 种数据库类型及其**驱动是否已真实实现**。

```json
{
  "items": [
    {
      "dbType": "sqlite", "label": "SQLite", "category": "relational",
      "defaultPort": null, "networkRequired": false,
      "driverImplemented": true, "driverName": "花生苗内置 SQLite 驱动", "driverVersion": "1.0.0",
      "capabilities": { "schemas": true, "transactions": true, "explain": true,
                        "streaming": true, "serverSidePagination": false, "cdc": false, "ddl": true }
    }
  ]
}
```

界面据此灰掉不支持的功能，而不是点击后才报错。

### ✅ `GET /meta/permissions` 🔒 需登录

返回权限码清单（优先取本地库，库为空时回退内置定义）。

### ✅ `GET /meta/settings` 🔒 `settings.manage`

返回全部设置项。

### ✅ `PUT /meta/settings` 🔒 `settings.manage`

写入设置项。**只接受白名单里的键**（定义在 `packages/storage/src/repositories/sessions-settings.ts` 的 `WRITABLE_SETTINGS`），
白名单外的键返回 `VALIDATION_FAILED` 而不是静默忽略 —— 避免界面上的笔误变成一条谁也读不懂的幽灵配置。

```json
{ "items": [ { "key": "ai.enabled", "value": true } ] }
```

批量写入整体事务化：**任一项非法则全部回滚**，不会出现"改了一半"。每一项变更都写审计（`action=settings_update`，`detail` 含旧值 → 新值），
因此"谁在什么时候把 AI 打开了"是可查的。

> 这个接口曾经**不存在** —— 全仓只有 GET，于是 `ai.enabled` 永远是种子里的 `false`，AI 功能实现再完整也只会返回 `AI_DISABLED`。

### ✅ `GET /meta/settings/writable` 🔒 `settings.manage`

返回可写设置项及其类型/取值范围（`boolean` / `integer` + min/max / `enum` + values）与中文说明，
让界面不必自己再抄一份白名单（两份清单一旦漂移就会出现"界面能改、后端拒绝"）。

### ✅ `GET /meta/production-check/:id` 🔒 需登录

判断连接是否属于生产库（用于界面红标与 AI 写闸门）。

```json
{ "exists": true, "production": true, "readOnly": false }
```

识别规则：连接开启只读保护，或名称/颜色标记命中生产特征（`prod`、`生产`、颜色 `red` 等）。

### ✅ `GET /meta/diagnostics` 🔒 `settings.manage`

导出诊断包。**保证不含**：主密钥、任何明文口令、`password_enc` 等密文列、`users.password_hash`、会话行与查询结果集。

---

## 3. 认证

### ✅ `POST /auth/login`

无需认证。请求：

```json
{ "username": "admin", "password": "……" }
```

响应：

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 43200,
  "sessionId": "b1f0…",
  "user": { "id": 1, "username": "admin", "displayName": "系统管理员", "isAdmin": true, "status": 1 },
  "roles": ["admin"],
  "permissions": ["conn.read", "…"]
}
```

行为约定：
- 口令以 **scrypt**（N=32768, r=8, p=1, keyLen=64）加盐哈希存储，校验用 `timingSafeEqual`；
- 连续失败 5 次锁定 15 分钟（`AUTH_ACCOUNT_LOCKED`）；
- **无论成功失败都写审计日志**。

### ✅ `GET /auth/me` 🔒

返回当前用户、角色、权限与连接授权范围。

### ✅ `POST /auth/logout` 🔒

吊销当前会话。此后该令牌立即失效（服务端按 `sid` 校验会话有效性）。

### ✅ `POST /auth/refresh` 🔒

用当前有效令牌换一个新令牌（会话轮换语义）。实现见 `apps/server/src/routes/meta.ts`
的 `registerAuthRoutes`（调用 `ctx.auth.refresh(auth, { ip, userAgent })`）。

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 43200,
  "user": { "id": 1, "username": "admin", "displayName": "系统管理员", "isAdmin": true, "status": 1 },
  "roles": ["admin"],
  "permissions": ["conn.read", "…"]
}
```

**旧会话会被吊销**，客户端拿到响应后必须立刻替换本地令牌，旧令牌随即失效。
需认证；令牌失效时返回 `401`（`AUTH_TOKEN_INVALID` / `AUTH_TOKEN_EXPIRED`）。

### ✅ `POST /auth/change-password` 🔒

```json
{ "oldPassword": "……", "newPassword": "……" }
```

新口令长度需 ≥ 6（`MIN_PASSWORD_LENGTH`，见 `packages/storage/src/crypto.ts` 的 `checkPasswordStrength()`；
按需求方要求当前只校验长度，字符类别与弱口令字典规则已在源码中注释保留）。

---

## 4. 连接管理

### ✅ `GET /connections` 🔒 `conn.read`

查询参数：`search`、`dbType`、`favorite`、`groupId`、`limit`、`offset`。

按 §1.5 的连接可见性规则过滤；**响应绝不含任何口令字段**，只暴露 `hasPassword`。

```json
{
  "items": [
    {
      "id": 1, "name": "本地演示库", "groupId": null, "dbType": "sqlite",
      "host": null, "port": null, "databaseName": "/tmp/demo.db",
      "username": null, "hasPassword": false, "connectionUrl": null,
      "colorTag": "green", "isReadOnly": false, "isFavorite": false,
      "lastUsedAt": null, "createdAt": "2025-01-01T00:00:00.000Z", "updatedAt": "2025-01-01T00:00:00.000Z"
    }
  ],
  "total": 1
}
```

### ✅ `POST /connections` 🔒 `conn.write`

```json
{
  "name": "生产库",
  "dbType": "postgresql",
  "host": "db.internal", "port": 5432,
  "databaseName": "app", "username": "readonly",
  "password": "……",
  "connectionUrl": "postgresql://user:pass@host:5432/db?sslmode=require",
  "isReadOnly": true, "colorTag": "red", "group": null
}
```

解析优先级（重要）：
1. **先解析 `connectionUrl`**，其显式值优先；
2. 连接串里的 scheme 会修正 `dbType`（粘贴 `postgresql://` 会自动切换类型）；
3. 连接串的查询参数并入 `extraParams`；
4. 只有在仍缺端口时才回退默认端口（PostgreSQL 5432 / MySQL 3306 …）。

口令以 **AES-256-GCM** 加密后入库（`PSK1` 魔数 + 版本 + 随机 IV + 认证标签），响应返回 `201` 与 `{ item }`。

### ✅ `GET /connections/:id` 🔒 `conn.read`

单个连接详情（同样不含口令）。未授权或不存在均返回 404。

### ✅ `PUT /connections/:id` 🔒 `conn.write`

局部更新，仅覆盖显式传入的字段。

### ✅ `PATCH /connections/:id/flags` 🔒 `conn.write`

快速切换 `isFavorite` / `isReadOnly` / `colorTag` / `groupId`。

### ✅ `DELETE /connections/:id` 🔒 `conn.write`

删除连接并写审计。目标数据库本身不受影响。

### ✅ `POST /connections/:id/test` 🔒 `conn.read`

```json
{ "ok": true, "latencyMs": 12, "serverVersion": "SQLite 3.53.4", "message": "连接成功" }
```

未实现的驱动返回 `ok: false` 并说明"未真正发起连接"，HTTP 501 / `DRIVER_NOT_IMPLEMENTED`。

### ✅ `GET /connections/groups` · `POST /connections/groups` 🔒 `conn.read` / `conn.write`

连接分组树。

### ✅ `GET /connections/:id/schemas` 🔒 `conn.read`

列出 schema（SQLite 为 `main`，PostgreSQL 为 `public`）。

### ✅ `GET /connections/:id/schemas/:schema/tables/:table/columns` 🔒 `conn.read`

列信息：名称、类型、可空、默认值、注释、是否主键、序号。

### ✅ `GET /connections/:id/schemas/:schema/tables/:table/indexes` 🔒 `conn.read`

索引信息：名称、列、是否唯一、是否主键。

### ✅ `GET /connections/:id/capabilities` 🔒 `conn.read`

驱动能力声明与 `implemented` 标志。

---

## 5. SQL 执行

### ✅ `POST /query/execute` 🔒 `query.read`（写语句另需 `query.write`）

```json
{
  "connectionId": 1,
  "sql": "SELECT id, name FROM users WHERE created_at > ?",
  "params": ["2024-01-01"],
  "maxRows": 1000,
  "timeoutMs": 30000,
  "confirm": false
}
```

**四道闸门**（全部通过才真正执行）：

| # | 校验 | 失败时 |
| --- | --- | --- |
| 1 | 连接可见（可见性规则） | 404 `NOT_FOUND` |
| 2 | 写语句需 `query.write` 权限 | 403 `AUTH_FORBIDDEN` |
| 3 | 连接未开启只读保护 | 403 `READONLY_VIOLATION` |
| 4 | 写语句需 `confirm: true` | **428 `CONFIRMATION_REQUIRED`** |

写操作判定基于**去注释后**的语句首关键字（`INSERT/UPDATE/DELETE/MERGE/REPLACE/TRUNCATE/DROP/ALTER/CREATE/GRANT/REVOKE/CALL/EXEC/PRAGMA/VACUUM/ATTACH…`），注释与字符串字面量中的关键字不参与判定，防止 `-- select 1\nUPDATE …` 之类绕过。

响应：

```json
{
  "queryId": "q-8f2…",
  "columns": [{ "name": "id", "dataType": "INTEGER" }, { "name": "name", "dataType": "TEXT" }],
  "rows": [[1, "张三"]],
  "rowCount": 1,
  "affectedRows": 0,
  "durationMs": 3,
  "truncated": false,
  "isSlow": false,
  "notices": []
}
```

值的序列化：`NULL → null`、二进制 → `"base64:…"`、`bigint → 字符串`。
无论成功失败都写 `query_history` 与 `audit_logs`。

### ✅ `POST /query/explain` 🔒 `query.read`

驱动 `capabilities.explain=false` 时返回 `DRIVER_NOT_IMPLEMENTED`，**不会**退化成执行语句。

### ✅ `GET /query/history` 🔒 `query.read`

查询历史，支持 `limit`/`offset` 与按连接过滤。

### ✅ `POST /query/cancel` 🔒 `query.read`

标记取消；同步执行中的语句会在下一个检查点停止。

---

## 6. 审计日志

### ✅ `GET /audit/logs` 🔒 `audit.read`

过滤：`userId`、`username`、`action`、`status`、`connectionId`、`from`、`to`、`limit`、`offset`。

### ✅ `GET /audit/logs/export` 🔒 `audit.read`

`format=csv|json`，带 `content-disposition` 下载头；导出动作本身也写审计。

### ✅ `GET /audit/verify` 🔒 `audit.read`

```json
{ "ok": true, "checked": 128, "brokenAt": null, "anchored": true }
```

校验分两层：

1. **逐行衔接 + 按行重算**：`curr_hash = sha256(prev_hash + '|' + 规范化payload)`。每行带自己的 `hash_version`：
   - `v1`（历史行）：原有 11 字段，`null` 与空串都归一为 `''`；
   - `v2`（新增）：额外纳入 `ip_address` / `user_agent` / `duration_ms`，并用带类型前缀的编码区分 `null` 与 `''`。
   任何字段被改动都会导致 `ok: false`，并给出 `brokenAt` 与 `reason`（`hash` / `link` / `unknown_hash_version`）。
2. **链尾锚**：`settings['audit.chain_tail']` 记录尾行 id、尾哈希与锚点后的行数，在 `append` / `purge` 的同一事务内推进。**逐行衔接检查对"删掉最后几行"完全无感**，这一层专门补上这个缺口，报 `reason` 为 `anchor_id_mismatch` / `anchor_count_mismatch` / `anchor_hash_mismatch` / `anchor_malformed`。

老库没有该设置项时返回 `{ ok: true, anchored: false }`（不误报），并在下一次写入时自动补建。执行清理（`purge`）时会同步刷新锚点，因此**清理历史之后校验依然成立**。

> **诚实边界**：链是**无密钥 sha256**。任何能写库的人都可以把整条链连同锚点一起重算从而自洽 —— 锚只能检测**局部篡改与删尾**，不能阻止有库写权限者的整体重算。本接口证明的是完整性，不是保密性，也**不宣称"不可篡改"**。

写入被拒绝时也会留痕：写闸门拦下的请求记 `status: 'denied'`，`detail` 含 `{ write: true, gate: <错误码>, confirmed: <bool> }`，`errorMessage` 为固定文案（不回显原始 SQL）。因此"用户提交了写语句但没确认"（`gate=CONFIRMATION_REQUIRED`, `confirmed=false`）与"用户根本没提交写语句"（只有正常读记录）可以区分。

### ✅ `GET /audit/stats` 🔒 `audit.read`

按动作/状态/用户/时间的统计概览。

### ✅ `POST /audit/purge` 🔒 `settings.manage`

```json
{ "before": "2024-01-01T00:00:00.000Z", "confirm": true }
```

删除指定时间之前的日志并写入链锚点。

---

## 7. 用户与权限

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| ✅ | `GET /users` | `user.manage` | 用户列表 |
| ✅ | `POST /users` | `user.manage` | 新建用户 |
| ✅ | `PUT /users/:id` | `user.manage` | 局部更新（`displayName`/`email`/`phone`/`status`(0\|1)/`isAdmin`/`roles`/`password`/`unlock`） |
| ✅ | `DELETE /users/:id` | `user.manage` | 删除用户 |
| ✅ | `GET /users/roles` | `user.manage` | 角色清单 |
| ✅ | `GET /users/:id/grants` | `user.manage` | 该用户的资源授权 |
| ✅ | `PUT /users/:id/grants` | `user.manage` | 覆盖式设置资源授权 |

资源授权键格式：`connection:<id>` / `schema:<name>` / `table:<name>`，动作取值 `read`、`write`、`*`。

---

## 8. AI 助手

> 设计底线：**AI 只生成、不执行**。任何生成结果都必须由用户回到 SQL 编辑器确认后另行调用 `/query/execute`。

### ✅ `GET /ai/status` 🔒 `ai.use`

```json
{
  "enabled": false,
  "configured": false,
  "config": null,
  "redactionEnabled": true
}
```

AI **默认关闭**，`enabled` 与 `configured` 都为 `false` 时界面引导用户去配置（点击直达「设置 → AI 助手」）。
使用说明见 [`docs/ai.md`](./ai.md)。

### ✅ `GET /ai/configs` · `POST /ai/configs` · `PUT /ai/configs/:id` · `DELETE /ai/configs/:id` 🔒 `settings.manage`

模型配置。`apiKey` 以 AES-256-GCM 加密落库，读写接口只返回 `hasApiKey`。
支持提供方：`openai`、`anthropic`、`google`、`qwen`、`ernie`、`zhipu`、`deepseek`、`ollama`、`openai-compatible`（OpenAI 协议覆盖大多数国产与本地模型）。

### ✅ `POST /ai/test` 🔒 `settings.manage`

连通性测试：**真发一次最小请求**（`max_tokens=8`）并返回耗时与模型回执。入参二选一：

- `{ "configId": 3 }` —— 测一条已保存的配置；
- 表单临时值 —— 保存前先试连：

```json
{ "provider": "ollama", "modelName": "qwen2.5-coder:7b", "baseUrl": "http://127.0.0.1:11434/v1" }
```

响应：

```json
{ "result": { "ok": true, "latencyMs": 50, "provider": "ollama", "model": "qwen2.5-coder:7b", "reply": "..." } }
```

失败返回 `AI_PROVIDER_ERROR`（502），`details.url` 指出实际请求的地址，便于排查。

> 本接口**刻意不检查 `ai.enabled`**：正常的操作顺序是"先试通、再启用"，若复用总开关检查就会陷入
> 「想测试 → 必须先启用 → 启用前不敢确认能连上」的死循环。成功与失败都写审计。

### ✅ `POST /ai/models` 🔒 `settings.manage`

列举供应商侧可用模型（用于挑选本地已下载的模型）。入参同 `/ai/test`（只需 `provider` + `baseUrl`，**不需要模型名**）：

```json
{ "models": ["mock-chat-13b", "mock-coder-7b"], "provider": "openai-compatible", "baseUrl": "http://127.0.0.1:1234/v1" }
```

OpenAI 兼容系（含 Ollama）走 `GET {base}/models`；Anthropic 与 Google 没有该接口，此时**明确返回「不提供模型列表接口，请手动填写模型名称」**，
而不是返回空数组 —— 那会把"不支持"误传成"你一个模型都没装"。

> 用 POST 而非 GET：入参可能包含 API Key，放进查询串会落到访问日志和浏览器历史里。

### ✅ `POST /ai/nl2sql` 🔒 `ai.use`

```json
{ "prompt": "查出每个地区去年的销售总额", "connectionId": 1, "schema": "main", "tables": ["orders"] }
```

响应：

```json
{
  "sql": "SELECT region, SUM(amount) FROM orders WHERE …",
  "explanation": "按地区聚合去年订单金额",
  "confidence": 0.82,
  "referencedTables": ["orders"],
  "requiresConfirmation": true,
  "executed": false,
  "connectionId": 1,
  "historyId": 42
}
```

发送给模型的上下文**只含表名/列名/类型/注释，不含任何数据行**（`redactRows`/`describeSchema` 保证）。
生成结果若为写操作，还会额外校验：生产库默认拒绝（`CONFIRMATION_REQUIRED`，除非管理员放开 `ai.production_write_allowed`），且调用方自身必须拥有该连接的写权限。

### ✅ `POST /ai/explain` · `POST /ai/optimize` · `POST /ai/document` · `POST /ai/diagnose` 🔒 `ai.use`

| 路径 | 入参 | 出参 |
| --- | --- | --- |
| `/ai/explain` | `{ sql }` | `{ text, historyId }` |
| `/ai/optimize` | `{ sql, connectionId? }` | `{ suggestions: [...], plan, historyId }` |
| `/ai/document` | `{ connectionId, schema?, tables? }` | `{ markdown, historyId }` |
| `/ai/diagnose` | `{ error, sql? }` | `{ cause, suggestions, historyId }` |

**每个场景的响应都带 `historyId`** —— 它就是本次调用写入 `ai_history` 的那条记录 id，
界面上的「撤回这条 / 回退到这里」靠它定位要删服务端哪一条。
用回调拿真实 id，而不是事后 `SELECT MAX(id)`：后者在同一用户并发请求时
会指到另一次调用的记录上，撤回一次就可能删掉无关的历史。

### ✅ `POST /ai/ask` 🔒 `ai.use`

基于结果集问答。**发送前先过脱敏网关**：命中规则的列（`*password*`、`*token*`、`*phone*`、`*email*`、`*id_card*`…）会被置空、掩码或部分保留；`NULL` 保持 `NULL`（不会被替换成占位符而歪曲数据分布）。响应含 `redactionApplied`。

### ✅ `GET /ai/history` 🔒 `ai.use`

调用历史（提示词、响应、token 数、耗时、状态）。带 `total`（真实总数，不是当页条数）。
所有 AI 调用同时写审计日志。

### ✅ `DELETE /ai/history/:id` 🔒 `ai.use`

撤回单条调用记录。返回 `{ ok: true }`。

**只删自己的**：SQL 条件为 `WHERE id = ? AND user_id = ?`，因此删别人的记录必然是 0 行，
接口返回 `404 NOT_FOUND`。这条 404 与"记录不存在"的响应**逐字节相同**，
不给攻击者留枚举空间（不知道某个 id 是否属于别人）。

### ✅ `POST /ai/history/rollback` 🔒 `ai.use`

```json
{ "historyId": 42 }
```

"撤回到指定的某一次操作"：删掉这条**及其之后**的**全部**调用记录
（`WHERE user_id = ? AND id >= ?`）。响应 `{ ok: true, deleted: 3 }`。

先用同一条 SQL 校验归属，再执行删除；不属于自己或不存在都返回 404，同样不做区分。

### ✅ `DELETE /ai/history` 🔒 `ai.use`

清空自己的全部调用记录，返回 `{ ok: true, deleted: N }`。别人的记录不受影响。

> **撤回的边界（如实说明）**：撤回删的是**服务端调用记录**与**界面上的对话气泡**。
> 它的语义是"抹掉这次操作留下的痕迹"，**不是**数据库事务回滚 ——
> 如果已经点过「执行」并把数据写进了业务库，撤回不会（也无法）撤销那次写入。
> 需要真正回滚数据请用事务或备份。

---

## 9. 数据导出

把"某个查询的结果集"搬到别的地方 —— 存成 Excel，或写进另一个数据库的表。
两个接口都**只接受单条只读语句**：多语句、写语句一律 `VALIDATION_FAILED`，
因为导出的语义是"搬走一次查询的结果"，不是"执行点什么"。

### ✅ `POST /data/export/xlsx` 🔒 `query.read`

```json
{ "connectionId": 1, "sql": "SELECT * FROM orders", "sheetName": "订单", "fileName": "订单明细", "maxRows": 50000 }
```

响应是**二进制 `.xlsx`**（`content-type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`），
不是 JSON。响应头：

| 头 | 说明 |
| --- | --- |
| `content-disposition` | `attachment; filename="<ASCII 回退名>"; filename*=UTF-8''<百分号编码的真名>` |
| `x-export-truncated` | `true` 表示结果超过行数上限、只导出了前面部分 |

> 文件名为什么要有两份：HTTP 头只能是 ASCII，而连接名/文件名几乎一定是中文。
> 只写 `filename="中文.xlsx"` 会被 Node 直接拒绝（`ERR_INVALID_CHAR`），
> 所以按 RFC 5987 给出 UTF-8 编码版本，同时保留一个 ASCII 回退名给老客户端。

行数上限取设置项 `query.max_rows`（默认 50000），并被**硬上限 200000** 夹住；
请求里的 `maxRows` 只能让上限**更小**，不能让它失效。

写入的 `.xlsx` 是**零依赖**手写的 ZIP + OOXML（不引入任何第三方 Excel 库）：
字符串一律 `inlineStr`，日期按 Excel 序列值 + 自定义 `numFmtId`，
`NaN`/`±Infinity` 降级为文本，XML 非法控制字符剔除，XML 特殊字符转义。
导出动作写审计：`action: 'export'`、`resourceType: 'query_result'`，
`detail` 含 `format`/`rows`/`columns`/`truncated`/`maxRows`/`fileName`。

### ✅ `POST /data/export/to-connection` 🔒 源连接 `query.read` + **目标连接走 `assertCanWrite`**

```json
{
  "sourceConnectionId": 1,
  "sql": "SELECT id, name FROM orders WHERE id <= 100",
  "targetConnectionId": 2,
  "targetTable": "orders_snapshot",
  "mode": "create",
  "batchSize": 500
}
```

| `mode` | 行为 |
| --- | --- |
| `create` | 按结果集的列建表。**目标表已存在则返回 409**，绝不静默覆盖 |
| `append` | 追加到已存在的表；表不存在返回 404 |
| `replace` | 先 `DROP TABLE` 再重建。**表内原有数据会全部丢失**，界面上有醒目警告 |

响应：`{ ok: true, rows: 100, targetTable: "orders_snapshot", mode: "create", truncated: false, warnings: [] }`

关键安全约定：

* **目标连接必须过与 `POST /query/execute` 完全相同的写闸门**（`assertCanWrite`：
  `query.write` 权限 + 连接未开只读 + 资源级写授权 + 生产库标记），
  因此导出**不能**被用来绕过写保护 —— 只读账号在目标端会被 403 拦下。
* **源连接与目标连接相同时直接拒绝**（400），否则会自己覆盖自己。
* 建表用的**列类型由源库的类型映射器换算**成目标库类型（与迁移引擎同一套逻辑），
  拿不到映射器时原样透传，而不会猜一个类型悄悄改掉。
* 写入分批执行（默认 500 行一批），避免一次性构造超大 INSERT。
* 审计：`action: 'export'`、`resourceType: 'connection'`，
  `detail` 含 `targetTable`/`mode`/`rows`。

> **`replace` 的诚实说明**：它走的是"先删表再建表"，两张表之间的时间窗里目标表是不存在的。
> 需要原子替换请回到迁移功能里用事务。

---

## 10. 表数据编辑（Excel 式增删改查）

让界面能像操作表格一样读、增、改、删某一张表的数据，**不需要用户手写 SQL**。
五个接口都在 `/api/v1/data/table/` 下。读走 `query.read`，写额外走 `assertCanWrite`
—— 与 SQL 开发页**完全相同**的写闸门，不是一条旁路。

### 定位符：为什么更新/删除必须带 `key`

界面上的"改一格、删一行"要落到数据库，就必须能**精确指向一行**。如果只按用户
看到的那几个字段拼 `WHERE`，一张有重复值的表就可能被一次改掉很多行，而界面只显示
改了一行 —— 用户根本看不出事故。所以服务端的判定是：

| 优先级 | 定位方式 | 条件 |
| --- | --- | --- |
| 1 | `primary_key` | 表有主键（多列主键按 `ordinal` 排序） |
| 2 | `unique_index` | 存在唯一索引，**且其全部列都 `NOT NULL`** |
| 3 | `none` | 都没有 → **明确拒绝更新与删除**，只允许读取与新增 |

为什么唯一索引要求全部列 `NOT NULL`：`WHERE col = ?` 在 `col` 为 `NULL` 时永远不成立
（SQL 三值逻辑），拿一个可能为 `NULL` 的列定位会漏掉行；而 `IS NULL` 又匹配不到"具体是
哪一行"。非空唯一索引没有这个歧义。

`kind: none` 时界面会显示只读横幅并禁用编辑/删除，**但新增仍然允许**（新增不需要定位符）。

### ✅ `POST /data/table/columns` 🔒 `query.read`

先问"这张表能不能编辑"，用于渲染表头与只读提示。不读数据。

```json
{ "connectionId": 1, "schema": "main", "table": "people" }
```

```json
{
  "columns": [
    { "name": "id", "dataType": "INTEGER", "nullable": false, "isPrimaryKey": true, "ordinal": 0 }
  ],
  "locator": { "kind": "primary_key", "columns": ["id"] },
  "editable": true,
  "readOnlyReason": null
}
```

`readOnlyReason` 取值：`null`（可写）、`no_primary_key`、`no_permission`、`connection_readonly`。
按"没权限 > 连接只读 > 没有定位符"的优先级给出一个。这是一个**提前告知**，真正的拦截
仍在写接口里 —— 界面被绕过也写不进去。

### ✅ `POST /data/table/rows` 🔒 `query.read`

```json
{ "connectionId": 1, "schema": "main", "table": "people",
  "page": 1, "pageSize": 100, "orderBy": "id", "orderDir": "desc" }
```

返回 `columns` / `locator` / `editable` / `readOnlyReason`（同上）外加 `rows`（二维数组，
列顺序与 `columns` 一致）、`total`、`page`、`pageSize`。

* `pageSize` 上限 **500**，默认 100。
* 默认排序按定位符列（结果稳定，翻页不会串行）；用户点列头时按点的那列排，第二排序键
  仍是定位符。`orderBy` 指向不存在的列会得到 `VALIDATION_FAILED`，而不是被静默忽略。
* `total` 是 `null` 表示**行数未知**，界面必须显示"行数未知"而不是 0。
* `LIMIT`/`OFFSET` 走**绑定参数**（`QueryOptions.params`），不把数字拼进 SQL。

> **`total` 为什么可能是 `null`**：`SELECT COUNT(*)` 在 MySQL InnoDB 这类引擎上是全表扫描，
> 百万行的表会让"打开表"直接卡住。这里改成
> `SELECT COUNT(*) FROM (SELECT 1 FROM t LIMIT cap+1) AS ps_count`，扫描量硬性封顶在
> `cap+1` 行（`cap = 50000`）。数到上限就说明"比 cap 多"，此时如实返回 `null`，
> 而不是给一个会误导翻页的假数字。统计失败（权限、视图、方言差异）也只让 `total` 为
> `null`，不会让整页数据打不开。

### ✅ `POST /data/table/insert` 🔒 `query.read` + `assertCanWrite`

```json
{ "connectionId": 1, "schema": "main", "table": "people",
  "values": { "id": 10, "name": "新来的", "age": 25 } }
```

* 只允许写入表里真实存在的列（列名走**驱动标识符白名单**引用，值走**绑定参数**）。
* **非空且无默认值的列漏填会在发 SQL 之前被拦下**，并指名是哪一列 —— 比让数据库报一个
  方言化的错更有用。带默认值的主键列（自增/序列）不要求填。
* `values` 为空 → `VALIDATION_FAILED`。

### ✅ `POST /data/table/update` 🔒 `query.read` + `assertCanWrite`

```json
{ "connectionId": 1, "schema": "main", "table": "people",
  "key": { "id": 7 }, "changes": { "name": "改过的" } }
```

* `key` 必须**恰好**覆盖 `locator.columns`：少一列可能匹配多行、多一列说明客户端在用
  过期的定位符，两种情况都返回 `VALIDATION_FAILED`（`expected` / `actual` 会列出列名）。
* `changes` 只应包含**真正改动过的列**。把没改的列也写进 `SET` 会覆盖掉别人在这期间的
  并发修改，属于不必要的写放大。
* 定位值为 `null` 时生成 `IS NULL`（`= NULL` 永远不成立）；该值**不占参数位**。
* 非空列被改成 `null` → `VALIDATION_FAILED`（数据库也会拒，但报错远不如这里清楚）。
* 受影响行数不是 1 就报错：命中 **0** 行 → `NOT_FOUND`（记录已被别人删除）；
  命中 **>1** 行 → `CONFLICT` 并**中止**（说明定位符判定出了问题）。
  这条校验的意义是让"悄悄改了多行"暴露出来，而不是回一个"成功"把问题掩盖掉。

### ✅ `POST /data/table/delete` 🔒 `query.read` + `assertCanWrite`

```json
{ "connectionId": 1, "schema": "main", "table": "people",
  "keys": [ { "id": 20 }, { "id": 21 } ] }
```

* `keys` 1–1000 项，逐个执行。每个 key 单独校验、单独构造 `DELETE`。
* 命中 0 行**不算错误**（别人可能已经删掉了），计入 `deleted` 的只是真实删掉的行数；
  命中 >1 行 → `CONFLICT` 并中止。

### 审计

写操作成功记 `action: 'write'`、`resourceType: 'table_row'`，
`detail` 含 `operation`（`insert`/`update`/`delete`）、`schema`、`table` 与涉及的列名。
**被拒绝的写尝试同样落一条 `status: 'denied'`** 记录（`detail.gate` 是稳定的错误码）——
表数据编辑器是最容易被拿来试探写权限的入口，不留痕等于给了无成本试错空间。

---

## 11. 可视化建库建表

让用户不写 SQL 就能建 Schema / 建表 / 删表。三条硬规矩：

1. **预览与执行彻底分开**：`/ddl/preview` 只返回语句文本，一个字节都不发给数据库。
2. **执行必须二次确认 + 过写闸门**：要求 `confirm: true`，否则 `428 CONFIRMATION_REQUIRED`。
3. **默认值只能白名单**（见下）。

### ✅ `GET /ddl/column-types/:connectionId` 🔒 `conn.read`

返回该库类型的**建议**类型清单（下拉框用），不是"该库支持的全部类型"。

```json
{ "dbType": "sqlite",
  "types": [ { "name": "integer", "category": "numeric", "hasLength": false },
             { "name": "varchar", "category": "text", "hasLength": true } ] }
```

按方言族区分：`jsonb` 不出现在 MySQL 的下拉里、`mediumint` 不出现在 PostgreSQL 的；
未实现的驱动给一份通用清单（用户仍可手填类型名）。`hasLength` 决定界面是否显示长度输入框。

### ✅ `GET /ddl/schema-support/:connectionId` 🔒 `conn.read`

```json
{ "dbType": "sqlite", "supported": false, "keyword": null }
```

| 数据库 | `supported` | `keyword` |
| --- | --- | --- |
| PostgreSQL / KingbaseES | `true` | `SCHEMA` |
| MySQL / MariaDB / TiDB / OceanBase | `true` | `DATABASE` |
| **SQLite** | `false` | `null` |

> SQLite 的"库"就是文件本身：`CREATE SCHEMA` / `CREATE DATABASE` 都不支持，换库要靠
> `ATTACH DATABASE` 挂载另一个文件，属于连接层面的事。所以这里**如实回答不支持**，
> 而不是拼一句跑不通的 SQL 让用户去撞。

### ✅ `POST /ddl/preview` 🔒 `conn.read`

**只生成、不执行。** 只要求 `conn.read`：预览不碰数据库结构，只做字符串拼装。

```json
{
  "connectionId": 1, "schema": "main", "table": "orders",
  "columns": [
    { "name": "id", "dataType": "INTEGER", "nullable": false, "primaryKey": true },
    { "name": "label", "dataType": "varchar", "length": 32, "nullable": true, "primaryKey": false }
  ],
  "indexes": [ { "name": "ix_orders_label", "columns": ["label"], "unique": false } ],
  "ifNotExists": false
}
```

```json
{ "statements": [ "CREATE TABLE \"main\".\"orders\" (\n  \"id\" INTEGER NOT NULL,\n  ...\n);",
                  "CREATE INDEX \"main\".\"ix_orders_label\" ON \"orders\" (\"label\");" ] }
```

`statements` 的**每个元素就是一条可独立执行的语句**（一条 `CREATE TABLE` + 每条索引一条
`CREATE INDEX`）。刻意不用驱动自带的 `createTable(schema, table, columns, indexes)` 那个重载
—— 它会把多条语句拼成一个多行字符串，而 SQLite 的 `prepare()` 会**静默接受**多语句、
只执行第一条，其余无声丢弃（详见下文"本轮修掉的两个驱动缺陷"）。

`length` 会拼到类型名后面（`varchar` + `32` → `varchar(32)`），支持字符串形式以表达
`decimal` + `"10,2"` 这样的双参数。

### ✅ `POST /ddl/execute` 🔒 `query.read` + `assertCanWrite` + `confirm`

请求体与 `/ddl/preview` 相同，另加 `"confirm": true`。返回：

```json
{ "ok": true, "statements": ["..."], "executed": 2 }
```

逐条执行，`executed` 是真实执行成功的条数。

> **⚠️ 没有事务，会留下部分成功**：`QueryExecutor` 不提供 begin/commit/rollback，所以逐条执行
> 中途失败时，**前面已经成功的语句不会回滚**。例如建表成功、建索引失败时，表会留在库里，
> 接口如实返回错误并给出 `executed` 的实际条数，不会假装「整体失败、什么都没发生」。
>
> 另外注意：**索引名在同一个库里是全局的**（不是每张表一份），所以给另一张表建同名索引会报
> `index ... already exists`；而 `IF NOT EXISTS` 只加在 `CREATE TABLE` 上，索引不做幂等。

### ✅ `POST /ddl/create-schema` 🔒 `query.read` + `assertCanWrite` + `confirm`

```json
{ "connectionId": 1, "name": "analytics", "confirm": true }
```

按方言生成 `CREATE SCHEMA "analytics";` 或 ``CREATE DATABASE `analytics`;``。
`supported: false` 的库返回 `VALIDATION_FAILED`（见 `/ddl/schema-support`）。

### ✅ `POST /ddl/drop-table` 🔒 `query.read` + `assertCanWrite` + `confirm`

```json
{ "connectionId": 1, "schema": "main", "table": "orders", "confirm": true }
```

删之前先确认表真的存在（`listColumns` 为空 → `NOT_FOUND`），让用户拿到
"数据表不存在"而不是数据库的方言化报错。

### ⚠️ 默认值为什么要白名单

DDL 语句在任何数据库里都**不支持绑定参数**（`DEFAULT ?` 是语法错误），所以默认值只能拼进
SQL 文本；驱动层的 `DdlGenerator` 也是这么设计的（`defaultValue` 原样输出）。既然无法
参数化，就只能用白名单把它限制在"字面量或几个标准函数"里：数字、单引号字符串（含 SQL 标准的
`''` 转义）、`true`/`false`、`NULL`、`CURRENT_TIMESTAMP`（可带精度）。其余一律拒绝。

**这是一个真实存在的边界，不是"已经彻底防住了"** —— 白名单之外的合法表达式（如
`now()`、`(SELECT ...)`）也会被拒。宁可让用户改用 SQL 开发页，也不放开拼字符串。

### ⚠️ `IF NOT EXISTS` 只作用于建表

界面文案写的是"表已存在时不报错"，行为与之一致：只有 `CREATE TABLE` 会加上
`IF NOT EXISTS`。索引语句**不加**这个子句，因为 MySQL 不支持
`CREATE INDEX IF NOT EXISTS` —— 只在部分方言上做幂等，会让"重跑一次"的结果取决于用户用
哪个库，比不做更难预期。所以：表可以重复建不报错，同名索引再次创建会如实报错。

只对支持该语法的方言改写；遇到不支持的方言（如 SQL Server）**直接报错**，
而不是生成一句语法错的 SQL 让用户去撞。若驱动生成的语句形态变了导致改写没生效，
也会报错而不是静默忽略用户的勾选。

### 审计

`action: 'ddl'`、`resourceType: 'connection'`，`sqlText` 是实际执行的语句，
`detail` 含 `operation`（`create_table`/`create_schema`/`drop_table`）、`schema`、`table`、
列数与索引数。被拒绝的尝试同样落 `denied` 记录。

### 本轮修掉的两个驱动缺陷

这两个缺陷都是**做这两个功能时才暴露出来的**，而且都属于"静默给出错误结果"这一类：

| 缺陷 | 原行为 | 现在 |
| --- | --- | --- |
| SQLite `createIndex` 生成 `ON "schema"."table"` | SQLite 报 `near ".": syntax error` —— 只要 schema 不为空，**建索引一定失败**。旧测试只断言字符串里有没有 `CREATE TABLE`，看不出来 | schema 限定到**索引名**上：`CREATE INDEX "main"."ix" ON "t" (col)`，并新增用例**真的执行**生成的 DDL |
| `node:sqlite` 的 `prepare()` 静默接受多语句 | 只执行第一条，**第二条起无声丢弃**，`changes` 是 0，一切"成功"。用户以为跑了一个脚本，其实只跑了第一句 | `execute`/`executeUpdate` 检测到多语句即报 `VALIDATION_FAILED` 并说明提交了几条，与 MySQL（`multipleStatements: false`）行为对齐 |

---

## 12. 数据迁移

### ✅ `POST /migration/precheck` 🔒 `migrate.read`

```json
{
  "sourceConnectionId": 1, "targetConnectionId": 2,
  "sourceSchema": "main", "targetSchema": "main",
  "tables": [], "mode": "full"
}
```

响应：

```json
{
  "taskId": 1,
  "ok": true,
  "issues": [
    { "level": "warning", "table": "users", "column": "avatar",
      "message": "BLOB → BYTEA：二进制大字段跨库迁移可能触发长度上限",
      "suggestion": "如不能接受语义损失，请在字段映射中手工指定目标类型或跳过该列" }
  ],
  "tableMappings": [
    { "sourceTable": "users", "targetTable": "users",
      "columnMappings": [
        { "sourceColumn": "id", "sourceType": "INTEGER", "targetColumn": "id", "targetType": "INTEGER", "lossy": false }
      ] }
  ],
  "estimatedRows": 5
}
```

**预检不写入任何数据**（含建表）。同构迁移（如 SQLite→SQLite）原样保留类型定义、不报 `lossy`，避免在最安全的场景里刷满警告而淹没真实风险。目标端已存在同名表时默认给出 `warning`（不覆盖生产数据）。

### ✅ `POST /migration/start` 🔒 `migrate.write`

```json
{
  "taskId": 1,
  "sourceConnectionId": 1, "targetConnectionId": 2,
  "tables": ["users"], "mode": "full",
  "includeStructure": true, "includeData": true,
  "conflictStrategy": "skip",
  "batchSize": 500, "dryRun": false
}
```

行为（实现见 `packages/migration/src/engine.ts` 的 `MigrationEngine.migrate()` / `precheck()`）：

- 目标端 DDL 由**目标驱动**生成，列类型先经类型映射转换为目标方言；非主键索引随表一并迁移；
- **模式**：当前**仅支持全量** `mode: "full"`。`incremental` / `sync` 会被显式拒绝并返回
  `400 VALIDATION_FAILED`（`assertFullMode()`，`details.supportedModes = ["full"]`）；
  `/migration/precheck` 也对非 full 产出 `level: "error"` 的 issue。二者属 ⬜ 规划中，
  **不会**静默退化为全量复制（这是刚修好的行为：此前 mode 被静默忽略）；
- 插入一律使用绑定参数（PostgreSQL 系生成 `$1..$n`，SQLite/MySQL 系用 `?`）；
- 数据按 `LIMIT/OFFSET` **分批循环读取直到取空**，且**必须带稳定排序**：有主键按主键，
  无主键回退按全部列排序。若目标库不支持按全部列排序（如 PG 的 json 列没有排序算子），
  降级为**单次全量读取**（`pagination: "single-pass"`），避免跨批次顺序漂移导致漏行/重复行；
- **行级冲突处理**：目标表在本次迁移**之前**已有数据、且源表**有主键**时，按批查询目标端已存在的键，
  再按 `conflictStrategy` 逐行处理（语义见下表）；
- 目标表已有数据但**无主键**时无法判重：`overwrite` → 先清空目标表再全量写入；
  `skip`（默认）/`manual` → **整表跳过**，逐表状态记为 `skipped`，且只要本次没有任何行写入，
  整体 `status` 也记为 **`skipped`**（**绝不谎报 `success`**）；`error` → 无法判重，直接插入，重复交由目标端约束报错；
- `dryRun=true` 只预检不写入（连表都不创建）；
- 响应为 `MigrationOutcome`：在标准 `MigrationResult` 之上附加逐表 `tables[]`：
  `{ table, pagination: 'primary-key' | 'all-columns' | 'single-pass', orderBy: string[],
     status: 'success' | 'failed' | 'skipped' | 'cancelled', totalRows, successRows, skippedRows, failedRows, message? }`。

**`conflictStrategy` 四种策略的真实语义**：

| 策略 | 目标端该行已存在（有主键） | 说明 |
| --- | --- | --- |
| `skip`（默认） | 跳过该行，计入 `skippedRows` | REST 层 zod 默认值与引擎内兜底一致 |
| `overwrite` | 按主键 `UPDATE` 非主键列 | 用 `UPDATE` 而非 `DELETE+INSERT`，避免触发外键级联删除子表数据 |
| `error` | 不覆盖，计入 `failedRows`，`errors[]` 记录「主键冲突」 | |
| `manual` | 当前实现与 `error` 相同（记为失败行待人工处理） | |

逐表的分页方式、排序键与跳过原因会写入 `migration_checkpoints.last_key`（JSON），
并可由 `GET /migration/:id/report` 的 `checkpoints[].pagination` 读回；`last_offset` 仍记录已处理行数。

> 状态值说明：`packages/core/src/migration.ts` 的 `MigrationStatus` 类型**已包含** `'skipped'`
> （取值为 `pending | prechecking | running | success | skipped | failed | cancelled`），
> 与引擎实际返回值一致：某张表被跳过时整体 `status` 即为 `'skipped'`，不会谎报 `success`。
> 任务列表/详情接口落库后可能返回该值，前端需按 7 种状态渲染。

### ✅ `GET /migration/tasks` · `GET /migration/:id` · `GET /migration/:id/report` 🔒 `migrate.read`

任务列表、任务详情与迁移报告（含预检结果、失败明细、检查点）。

### ✅ `POST /migration/:id/cancel` 🔒 `migrate.write`

取消迁移；执行循环会在检查点停止。

---

## 13. 图表与看板

> 路由实现：`apps/server/src/routes/visualization.ts`，在 `apps/server/src/app.ts` 由
> `registerVisualizationRoutes` 挂载到 `/api/v1`（**✅ 已实现并测试**，e2e 见
> `apps/server/src/e2e.test.ts` 的 charts/dashboards 用例）。聚合 SQL 由 `packages/visualization`
> 的 `buildChartSql()` 从**结构化配置**生成（字段走白名单、聚合与排序是枚举，**不接受客户端直接传 SQL**）；
> Web 端渲染见 `apps/web/src/components/ChartRenderer.tsx`。

### ✅ `GET /charts/types` 🔒 需登录

返回全部图表类型定义 `{ items: [{ type, label, minDimensions, minMetrics, description }] }`。
共 15 种（`packages/core/src/chart.ts` 的 `CHART_TYPES`）；Web 端 `ChartRenderer` 已实现
`bar`/`column`/`line`/`area`/`pie`/`donut`/`scatter`/`radar`/`parallel` 共 **9 种**的 SVG 渲染，
其余（`bubble`/`heatmap`/`sankey`/`treemap`/`boxplot`/`map`）显示明确占位面板 + 数据表。

### ✅ 图表 CRUD 🔒 需登录

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/charts` | 新建图表，成功返回 `201` + 图表 DTO |
| `GET` | `/charts?dashboardId=<id>&allUsers=true` | 列出图表；默认按当前用户隔离，`allUsers=true` 仅管理员生效 |
| `GET` | `/charts/:id` | 图表详情 |
| `PATCH` | `/charts/:id` | 局部更新（配置、类型、绑定连接/看板等） |
| `DELETE` | `/charts/:id` | 删除，返回 `{ ok: true }` |
| `GET` | `/charts/:id/data` | 取数并执行由配置生成（或已保存）的 SQL，额外需要 `query.read` |

新建请求（`POST /charts`）：

```json
{
  "name": "各地区销售额",
  "chartType": "column",
  "dashboardId": null,
  "connectionId": 1,
  "dataSource": "table",
  "sourceRef": "orders",
  "config": {
    "dimensions": [{ "column": "region", "aggregation": "none" }],
    "metrics": [{ "column": "amount", "aggregation": "sum", "alias": "total" }],
    "filters": [{ "column": "status", "operator": "=", "value": "paid" }],
    "sort": [{ "column": "total", "direction": "desc" }],
    "limit": 200
  },
  "refreshMode": "manual"
}
```

`GET /charts/:id/data?limit=<n>&maxRows=<n>` 响应：

```json
{
  "chartId": 1, "chartType": "column",
  "sql": "SELECT \"region\", SUM(\"amount\") AS \"total\" FROM \"main\".\"orders\" GROUP BY \"region\"",
  "columns": [{ "name": "region" }, { "name": "total" }],
  "rows": [["华东", 100.5]],
  "rowCount": 1, "truncated": false, "durationMs": 2
}
```

取数 SQL 按目标库方言加引号（MySQL 系用反引号）；若 `dataSource=query`，保存的 `querySql`
先过连接可见性校验与 `isWriteStatement()`，写语句一律 `403 READONLY_VIOLATION`。

### ✅ 看板 CRUD 🔒 需登录

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/dashboards` | 新建看板（`name`/`description`/`layout`/`isShared`），返回 `201` |
| `GET` | `/dashboards` | 当前用户的看板列表 |
| `GET` | `/dashboards/:id` | 详情，附带该看板下的 `charts[]`；`isShared=true` 时允许他人只读查看 |
| `PATCH` | `/dashboards/:id` | 局部更新（含 `isShared`） |
| `DELETE` | `/dashboards/:id` | 删除，返回 `{ ok: true }` |

### 归属与错误码

- 图表/看板默认**按用户隔离**；访问他人的非共享资源返回 **404 `NOT_FOUND`**（而非 403），
  与连接可见性一致的防枚举设计（`assertOwned()`）。
- 图表类型非法或配置不满足该类型的最低维度/指标数 → `400 VALIDATION_FAILED`（`details.issues` 给出原因）。
- 图表未绑定连接、或未指定 `sourceRef` 就取数 → `400 VALIDATION_FAILED`。
- 取数接口需要 `query.read`：只挂登录鉴权时，任何已登录用户都能借图表读到数据。
- 新建/删除图表与看板写审计（`resourceType` 为 `chart` / `dashboard`）。

---

## 14. 规划中的接口（⬜ 本期未实现）

以下能力在 PRD 中有定义、但当前版本**尚未实现**，列出以保证契约完整与预期透明。调用不存在的路径会得到标准的 404 错误体。

| 领域 | 规划接口 |
| --- | --- |
| 🔶 表设计器 | **已实现**：可视化建 Schema/建表/删表、执行前 DDL 预览（见 §11）；**未实现**：结构对比（diff）与「按差异生成 ALTER 脚本」 |
| 🔶 表数据编辑 | **已实现**：按定位符（主键或唯一非空索引）安全地分页读、增、改、删（见 §10） |
| 🔶 数据导入导出 | **已实现**：查询结果导出 `.xlsx`、导出到另一个数据库的表（见 §9）。**未实现**：CSV/JSON/SQL 文件的导入，以及"整库/整表批量导出为文件" |
| ⬜ 任务调度 | 定时任务 CRUD、执行历史 |
| ⬜ 插件 | 插件安装、启用、卸载 |
| ⬜ 同步 | CDC/增量同步（`mode: "incremental"` / `"sync"` 会被显式拒绝为 `VALIDATION_FAILED`，见 §12；游标增量与 upsert 语义未实现） |
| ⬜ 会话管理 | 在线会话列表与强制下线 |

图表/看板的 HTTP 路由与 Web 渲染**均已实现**（见 §13），不再属于规划项；`packages/visualization` 提供
15 种图表类型定义与聚合 SQL 生成（含标识符白名单与注入防护），其中 9 种已有浏览器内渲染。

---

## 15. 快速上手（curl）

```bash
# 1. 初始化（默认口令 admin / 123456，如需自定义用 --password-stdin）
pnpm bootstrap

# 2. 启动服务端
pnpm dev:server

# 3. 登录并取出令牌
TOKEN=$(curl -s -X POST http://127.0.0.1:8787/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"123456"}' | jq -r .token)

# 4. 建一个 SQLite 连接
curl -s -X POST http://127.0.0.1:8787/api/v1/connections \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"本地演示","dbType":"sqlite","databaseName":"/tmp/demo.db"}'

# 5. 查询（只读）
curl -s -X POST http://127.0.0.1:8787/api/v1/query/execute \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"connectionId":1,"sql":"SELECT 1 AS ok"}'

# 6. 写操作必须带 confirm，否则得到 428
curl -s -X POST http://127.0.0.1:8787/api/v1/query/execute \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"connectionId":1,"sql":"CREATE TABLE t (a INT)","confirm":true}'

# 7. 校验审计哈希链
curl -s http://127.0.0.1:8787/api/v1/audit/verify -H "authorization: Bearer $TOKEN"
```

---

## 16. 与 CLI 的对应关系

命令行工具（`peanutsprout`，见 `docs/cli-reference.md`）是上述接口的薄封装，并把领域错误码映射为稳定的**退出码**（`VALIDATION_FAILED→2`、`NOT_FOUND→3`、`DRIVER_NOT_IMPLEMENTED→4`、权限类`→5`、认证类`→6`、`CONFIRMATION_REQUIRED→9`、`MIGRATION_FAILED→11`、`AI_PROVIDER_ERROR→12`），便于脚本编排。
