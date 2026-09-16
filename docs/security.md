# 花生苗（PeanutSprout）安全设计

> 版本：0.1.0
> 关联文档：`docs/architecture.md`（接口与数据流）、`docs/deployment.md`（部署与 TLS 落地）、`docs/PRD.md`（需求）。
> 阅读方式：每个控制项都给出 **【现状】**（本版本已设计/已实现的能力边界）与 **【待办】**（尚未完成、需要在对应里程碑关闭的事项）。未标注"已实现"的控制项在源码落地前一概视为**设计已定、实现待完成**。

---

## 1. 范围、资产与信任边界

### 1.1 保护资产

| 资产 | 位置 | 泄露后果 |
| --- | --- | --- |
| 被管理的数据库连接凭据（口令、SSH 口令/私钥口令、SSL Key） | `connections.*_enc`（AES-256-GCM BLOB） | 直接失陷生产数据库 |
| AI 供应商 API Key | `ai_providers.api_key_enc` | 产生费用、被滥用 |
| 主密钥 | `~/.peanutsprout/master.key`（`0600`）或主密码包裹记录 | 解密上述全部密文 |
| 用户口令哈希 | `users.password_hash`（scrypt） | 离线爆破 |
| JWT 签名子密钥 | 由主密钥派生 | 伪造任意用户令牌 |
| 审计哈希链 | `audit_log`（`seq/prev_hash/hash`） | 事后抵赖、掩盖入侵 |
| 元数据库本身 | `~/.peanutsprout/peanutsprout.db` | 连接清单、用户、会话、SQL 历史 |
| 诊断包 / 日志 | `~/.peanutsprout/logs/`、`diag-*.zip` | 组合泄露内部拓扑 |
| 结果集数据 | 仅在内存/客户端（**不落库**） | 业务数据泄露 |

### 1.2 信任边界（两种部署场景）

**场景 A：本地桌面端（默认形态）**
```
[用户] ──本地登录──▶ [Electron main（Node，可信）] ──in-process──▶ [Fastify 127.0.0.1:8787]
                                 │                                        │
                                 ├─ renderer（Chromium，半可信：按 Web 处理）│
                                 └─ ~/.peanutsprout/（同机文件系统，操作系统账户边界）
```
- 信任假设：操作系统账户与文件权限完好；单用户机器。
- 主要风险：同机其他进程/其他用户读取数据目录；恶意 renderer 内容（XSS）触发越权 IPC；导出文件外泄。

**场景 B：独立服务端 / 公网 Web 端**
```
[浏览器/CLI] ──HTTPS──▶ [Nginx 反代] ──HTTP/WS──▶ [Fastify 0.0.0.0:8787] ──▶ [元数据库] ──▶ [被管理数据库]
                                （半可信网络）                （可信区）
```
- 信任假设：网络不可信；服务端主机与元数据库可信；反代正确配置。
- 主要风险：凭据填充与爆破、令牌窃取/重放、越权访问他人连接、SQL 注入、SSRF、拒绝服务、反代头伪造（`X-Forwarded-For`）。

### 1.3 安全目标

| 目标 | 验收方式 |
| --- | --- |
| 机密性 | 数据目录被完整拷走后，无主密钥无法解出任何凭据（离线检查 `connections.*_enc` 为密文） |
| 完整性 | 审计链可被独立重算校验；`/api/v1/audit/verify` 能定位断点 |
| 可认证 | 所有 `/api/v1` 业务路由（除 `/health`，见 `apps/server/src/routes/meta.ts`）必须携带有效 Bearer 令牌 |
| 可授权 | 默认拒绝；RBAC + 资源级 `resource_grants` + 环境策略三重判定 |
| 可追溯 | 每条写操作与敏感读操作都有审计记录，含 `requestId` 可关联日志；**被写闸门拒绝的写尝试也留痕**（`status='denied'`，记录是哪个闸门拦的、是否已确认） |
| 最小权限 | 生产库写操作需权限 + 环境允许 + 二次确认三项同时满足 |

---

## 2. 威胁模型

### 2.1 场景 A（本地桌面端）

| ID | 威胁 | 类别 | 影响 | 缓解 | 现状 / 待办 |
| --- | --- | --- | --- | --- | --- |
| A1 | 同机其他用户读取 `~/.peanutsprout/` | 信息泄露 | 拿到元数据库与密文 | 目录 `0700`、文件 `0600`；Windows ACL 仅当前用户；元数据库不含明文凭据 | 【现状】权限模型与 `.gitignore` 已定（忽略 `.peanutsprout/`、`master.key`、`*.db*`、`logs/`、`diag-*.zip`）。【待办】首次启动与每次启动校验权限，不合格即拒绝启动或强提示 |
| A2 | 磁盘/备份介质被窃 | 信息泄露 | 密文 + 主密钥同时泄露则全失守 | 主密钥与数据库**分开备份**；支持主密码包裹模式（密钥不在文件中）；备份加密建议 | 【现状】设计已定。【待办】密钥/备份分离检查（`peanutsprout diagnose` 已能导出诊断 JSON；`diagnose doctor` 为 ⬜ 规划中）与备份加密脚本示例 |
| A3 | 恶意 renderer 内容触发越权 IPC | 提权 | 借主进程能力读写任意文件 | `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、preload 白名单、禁用 `shell.openExternal` 任意 URL、CSP、`will-navigate`/`setWindowOpenHandler` 拦截 | 【现状】约束已写入架构。【待办】Electron 安全基线落地 + 断言测试（webPreferences、导航拦截） |
| A4 | 本机恶意进程注入/调试 | 提权 | 窃取内存中的解密凭据 | 进程不监听外网；主密码模式缩短数据密钥驻留时间；空闲自动锁定 | 【现状】设计已定。【待办】自动锁定超时配置化；考虑 `--inspect` 在发布构建中禁用 |
| A5 | 导出文件（CSV/连接导出/诊断包）外泄 | 信息泄露 | 业务数据或密文清单外流 | 导出默认不含密文；`--with-secrets` 加密 + 二次确认；导出写审计；诊断包默认不含日志敏感项 | 【现状】CLI 契约已定。【待办】GUI 导出加确认弹窗与"包含敏感字段"角标 |
| A6 | 剪贴板残留敏感内容 | 信息泄露 | 其他程序读取 | 复制凭据类内容提示；禁止"复制明文口令"入口（仅掩码展示） | 【现状】设计原则已定。【待办】实现并审计 UI 中所有复制动作 |

### 2.2 场景 B（公网 / 多用户 Web 端）

| ID | 威胁 | 类别 | 影响 | 缓解 | 现状 / 待办 |
| --- | --- | --- | --- | --- | --- |
| B1 | 凭据填充 / 爆破登录 | 认证 | 账号失陷 | scrypt 计算成本 + 失败锁定（5 次 / 15 分钟）+ 失败审计；`must_change_password`（**按用户存储**：`security.must_change_password.<userId>`；仅当引导时使用内置默认口令 `123456` 才置 true，见 §4.1.1。**其它用户改密不会解除管理员的强制改密**）；**口令强度当前只校验长度，故默认口令弱，暴露公网前必须改密** | 【现状】哈希参数、失败锁定与审计动作已实现。✅ 默认口令强制改密闸门已落地（`apps/server/src/http.ts`：改密前仅放行 4 个接口，其余 403 `PASSWORD_CHANGE_REQUIRED`）。⚠️ **默认口令为 `123456`**，公网部署必须覆盖。【待办】登录限流中间件、可选 2FA/TOTP |
| B2 | 令牌窃取（XSS/日志/中间人） | 认证 | 会话劫持 | 仅 HTTPS；`Authorization` 头承载（不用 Cookie，天然免 CSRF）；access 12 小时（`PEANUTSPROUT_TOKEN_TTL_SEC`，默认 43200 秒）；`/auth/refresh` 会话轮换 + `sessions` 吊销；日志脱敏；CSP 限制脚本源 | 【现状】JWT + `sessions` 吊销与续签已实现。【待办】重放检测、CSP 具体策略 |
| B3 | 越权访问他人连接/表 | 授权 | 横向移动 | RBAC + `resource_grants` 资源级判定（默认拒绝），每次访问都做（不做 UI 级隐藏式授权） | 【现状】判定函数与 mock 调用点已按此实现并有 e2e 用例（`apps/server/src/security.e2e.test.ts`）。【待办】补充更多 glob/过期边界用例 |
| B4 | SQL 注入 | 篡改 | 数据库失陷 | 值一律参数化绑定；标识符白名单校验 + 方言引用；禁止把用户输入拼进 SQL | 【现状】已落为代码约束并有测试（`packages/core/src/query.test.ts` 等）。【待办】继续补恶意表名/列名样本 |
| B5 | SSRF（连接测试被当扫描器） | 信息泄露 | 内网探测 | 服务端默认仅监听 `127.0.0.1`；暴露公网必须显式 `--host 0.0.0.0`；仅 `conn.write` 及以上可创建/测试连接 | 【现状】默认监听与权限码已实现。【待办】出站目标校验（禁止环回/链路本地/元数据地址段）与配置项 |
| B6 | 拒绝服务（大查询/大导入） | 可用性 | 服务不可用 | `maxRows` 截断、单次请求 `timeoutMs`、导入批大小上限、请求体上限（`client_max_body_size`）、限流 | 【现状】`maxRows`/`timeoutMs`/`bodyLimit` 已实现；**没有全局 `queryTimeoutMs` 配置**。【待办】连接池上限、限流中间件、压测 |
| B7 | 反代头伪造（伪造来源 IP 绕过限流/污染审计） | 欺骗 | 绕过控制 | ✅ **已缓解**：`clientIp`（`apps/server/src/http.ts`）只取 `req.ip`，**不再自行解析 `X-Forwarded-For`**；`req.ip` 是否采信转发头完全由 `config.trustProxy` 决定，**默认 `false`**（`apps/server/src/config.ts`），故默认配置下伪造的 `X-Forwarded-For` 不生效。需要真实客户端 IP 时用 `PEANUTSPROUT_TRUST_PROXY=true` 或网段白名单（如 `10.0.0.0/8,127.0.0.1`）显式开启——**开启后**仍需保证后端端口只对反代可达 | 【现状】默认不信任转发头；`security.e2e.test.ts` 有回归测试覆盖「默认忽略 / 显式开启后采信」两种行为 |
| B8 | 审计被篡改/删除 | 抵赖 | 事后无法追责 | 哈希链 + `audit:verify`；`audit_log` 禁止 UPDATE/DELETE（配合 SQLite 触发器/授权检查）；外部锚定（可选） | 【现状】**已实现并加固**：链算法 + **行级 `hash_version`**（v2 把 `ip_address`/`user_agent`/`duration_ms` 纳入哈希，`null` 与空串不再碰撞）+ **链尾锚** `settings['audit.chain_tail']`（删尾可检出）。已实测：篡改 v1 历史行、改新行 IP、删中间行、删尾行**都会**让 `verifyChain()` 报 `ok:false` 并给出 `brokenAt`/`reason`。【诚实边界】**链是无密钥 sha256，任何能写库的人可以整链重算并同步改锚** —— 锚只能检测局部篡改与删尾，**不能阻止整体重算**；不宣称"不可篡改"。【待办】只追加约束（触发器）、定时校验、HMAC 外锚（建议作为 v3 单独立项） |
| B9 | 传输被窃听/降级 | 信息泄露 | 令牌与数据泄露 | 必须 HTTPS（TLS 1.2+，推荐 1.3）；HSTS；HTTP 端口仅 301 跳转；证书校验可关闭项 `--insecure` 仅限内网且打印警告 | 【现状】部署要求已写入 `docs/deployment.md`。【待办】服务端可选强制 HTTPS/HSTS 响应头 |
| B10 | 依赖投毒 / 供应链 | 篡改 | 任意代码执行 | 锁定 pnpm 版本与 lockfile；`onlyBuiltDependencies` 白名单（仅 `electron`/`esbuild`）；无原生编译依赖；发布包 sha256 + 签名校验；`pnpm audit` | 【现状】白名单已存在于 `pnpm-workspace.yaml`。【待办】CI 增加审计与 SBOM 产出 |
| B11 | 更新通道劫持 | 篡改 | 分发恶意版本 | 更新包 sha256 + 发布者签名（`cosign`/`minisign`）双校验，失败即拒绝；升级前自动备份 | 【现状】契约已定（CLI `update`）。【待办】公钥内置与校验实现、CI 签名步骤 |
| B12 | 多租户数据串扰（同实例多用户） | 信息泄露 | 看到他人 SQL 历史 | `query_history`/`saved_queries`/`sessions` 均按 `user_id` 过滤；审计可见性由 `audit:read` 控制而非"本人可见" | 【现状】数据模型含 `user_id`。【待办】仓储层强制注入 `user_id` 过滤条件并测试 |

### 2.3 STRIDE 覆盖检查

| STRIDE | 对应威胁 ID | 是否有控制 |
| --- | --- | --- |
| Spoofing | B1 B2 B7 | 是（scrypt + JWT；`clientIp` 只信 `req.ip`，转发头默认不被信任，见 B7） |
| Tampering | B4 B8 B10 B11 | 是（参数化 + 哈希链 + 签名更新） |
| Repudiation | B8 A5 | 是（审计链 + 导出留痕） |
| Information disclosure | A1 A2 A5 A6 B2 B5 B9 B12 | 是（权限 + 加密 + TLS + 脱敏） |
| Denial of service | B6 | 是（超时 + 截断 + 限流） |
| Elevation of privilege | A3 A4 B3 | 是（Electron 加固 + 授权判定） |

---

## 3. 凭据保护

### 3.1 控制设计

| 控制 | 设计 |
| --- | --- |
| 主密钥载体 | `~/.peanutsprout/master.key`，32 字节 CSPRNG（`crypto.randomBytes(32)`），权限 `0600`（Windows：ACL 仅当前用户、禁用继承）；目录 `0700` |
| 主密码模式 | 用户设置主密码时，以 scrypt 派生 KEK，用 AES-256-GCM 包裹数据密钥，包裹结果存 `settings.master_key_wrapped`；数据密钥仅在解锁会话内驻留内存，空闲超时清除 |
| 加密算法 | `AES-256-GCM`；每条记录独立随机 IV（12 字节）；authTag 16 字节；`aad = "<recordId>:<fieldName>"` 防字段错位/记录搬家 |
| 存储形态 | BLOB 列：`iv || ciphertext || authTag`（或分列 iv/ciphertext/auth_tag），另存 `alg` 与 `key_version` |
| 加密范围 | 连接口令、SSH 口令与私钥口令、SSL Key 内容、AI API Key、主密钥包裹体；**不含**主机/端口/用户名/库名（便于列表展示与检索） |
| 内存卫生 | 明文只在 `SecretCipher.decrypt()` 与 `driver.connect()` 之间传递；用后 `buffer.fill(0)` 尽力擦除；不进入任何日志、异常、审计明细、崩溃报告 |
| 展示 | 一律掩码 `••••••` 或 `hasPassword: true`；`GET /connections/:id` 永不返回明文 |
| 回显防护 | 连接串/DSN 拼接仅发生在使用点，错误信息不回显连接串（只回显 host:port 与错误类型） |
| 密钥轮换 | 生成新 `key_version` → 事务内逐条 `decrypt(old) → encrypt(new)` → 更新 `key_version` → 全量校验 → 归档旧密钥 |
| 密钥丢失 | 密文不可恢复（设计如此）；首次启动强提示备份；`peanutsprout diagnose` 导出诊断 JSON（`diagnose doctor` 的密钥检查为 ⬜ 规划中） |

### 3.2 现状 / 待办

| 项 | 现状 | 待办 |
| --- | --- | --- |
| 算法与格式 | 已冻结：AES-256-GCM + 随机 IV + authTag + `key_version` | 实现 `SecretCipher` 与 `secret-columns` 映射；新增 GCM 往返与篡改检测单测 |
| 主密钥文件 | 路径与权限已定 | 首启生成、权限校验（非 `0600` 拒绝启动并提示修复），Windows ACL 实现 |
| 主密码模式 | 设计已定（包裹存储 + 空闲锁定 + `MASTER_KEY_LOCKED`） | 实现解锁/锁定状态机与 UI 解锁流程 |
| 轮换 | 设计已定 | 实现 `rotateMasterKey()` 与 CLI/GUI 入口；中断可恢复 |
| 内存擦除 | 原则已定 | 用 `Buffer.fill(0)`/`String` 最小化策略落地；评审所有 `logger` 调用点 |
| 备份隔离 | 原则已定 | 文档与 `doctor` 检查项落地（密钥与 DB 不得同目录同介质） |

---

## 4. 口令与密钥派生（KDF）

### 4.1 当前实现（与 PRD 的差异说明）

**PRD 原文要求 bcrypt / argon2；本实现采用标准库 scrypt。** 说明如下：

| 维度 | scrypt（当前选择） | argon2id | bcrypt |
| --- | --- | --- | --- |
| 依赖 | `node:crypto` 内置（**零依赖、零原生编译**） | 需原生模块（`argon2`）→ 破坏"零环境依赖"目标 | 需原生模块（`bcrypt`）或纯 JS 降级（弱） |
| 抗 GPU/ASIC | 强（内存硬化，N=2^15, r=8, p=1） | 最强（可调并行度、抗侧信道更好） | 弱（4KB 内存，GPU 友好） |
| 标准化 | RFC 7914 | RFC 9106（现代首选） | 事实标准 |
| 迁移成本 | 内置，随时可用 | 需评估构建矩阵（各平台预编译产物或 node-gyp） | 同上 |

**决策**：口令哈希默认 scrypt；**KDF 可插拔**（`PasswordHasher` 端口 + 存储串前缀自动分派）。

#### 4.1.1 第二处刻意放宽：默认口令 `123456` 与口令强度策略

需求方明确要求「默认用户名 `admin`、默认密码 `123456`」。这与 PRD 4.6 的口令强度要求直接冲突，处理方式如下：

| 项 | PRD 4.6 原要求 | 当前实现 | 原因 |
| --- | --- | --- | --- |
| 最短长度 | 12 位 | **6 位** | 默认口令 `123456` 即 6 位；且各语言界面文案**本就写的是「至少 6 位」**，而服务端此前校验 8 位 —— 界面说 6 位、接口拒 6 位，属前后端不一致缺陷，现统一到文案的 6 位 |
| 字符类别 | 至少两类（大小写/数字/符号） | **不校验** | `123456` 是纯数字单类别，保留该规则会**把产品自己的默认口令判为非法** |
| 弱口令字典 | 拒绝 `password`/`admin`/`12345678`/`qwerty` 等 | **未启用** | 同上；字典与 6 位纯数字默认值自相矛盾，保留只会造成"允许 123456 却禁止 12345678"这类说不通的规则 |
| 强制改密 | 支持 | **已实现**（`must_change_password`，但**仅当引导时实际口令等于内置默认口令 `123456` 时置 true**；用 `PEANUTSPROUT_ADMIN_PASSWORD` 自定口令时置 false） | 默认口令是一次性的；自定强口令再强制改密说不通 |

**风险评估（已知并接受）**：默认口令弱，但生效前提是攻击者能访问登录接口。服务端**默认只监听 `127.0.0.1`**，本地单人场景下风险可控；当使用默认口令时，`security.must_change_password=true` 会经 `apps/server/src/http.ts` 的闸门强制改密 —— 除 `POST /auth/change-password`、`POST /auth/logout`、`POST /auth/refresh`、`GET /auth/me` 外，其余接口一律返回 `403 PASSWORD_CHANGE_REQUIRED`。**若把服务暴露到内网或公网，必须先改口令并设置 `PEANUTSPROUT_ADMIN_PASSWORD`**。

**如何恢复严格策略**：`packages/storage/src/crypto.ts` 的 `checkPasswordStrength()` 中被注释的两段（字符类别、弱口令字典）加回，并把 `MIN_PASSWORD_LENGTH` 调回 8 或 12 即可；引导默认口令在 `packages/storage/src/index.ts` 的 `DEFAULT_ADMIN_PASSWORD`。

### 4.2 参数与格式

| 项 | 值 |
| --- | --- |
| 算法 | `scrypt` |
| 参数 | `N = 2^15 = 32768`，`r = 8`，`p = 1` |
| 输出长度 | 64 字节 |
| 盐 | 16 字节随机（`crypto.randomBytes(16)`），每用户独立 |
| 存储格式 | `scrypt$N$r$p$salt_b64$hash_b64` |
| 校验 | `crypto.timingSafeEqual` 常量时间比较；长度不等直接返回 false（不抛异常） |
| 计算方式 | 使用**异步** `crypto.scrypt`（避免阻塞事件循环） |
| 口令策略（当前） | **长度 6 ≤ n ≤ 256，只校验长度**（`MIN_PASSWORD_LENGTH = 6`）。原 PRD 4.6 的「至少两类字符 + 弱口令字典」规则已注释保留但未启用，原因见 §4.1 下方 |
| 升级策略 | 校验时若前缀非当前首选算法或参数低于基线 → `needsRehash: true` → 登录成功后透明重哈希（**双读单写**） |
| 内置账号 | 首次初始化创建 `admin` / `123456`（固定默认值）；**仅当口令为该默认值时**置 `must_change_password = true` 强制首次登录改密。用 `PEANUTSPROUT_ADMIN_USERNAME` / `PEANUTSPROUT_ADMIN_PASSWORD` 自定时不置位 |

### 4.3 现状 / 待办

| 项 | 现状 | 待办 |
| --- | --- | --- |
| scrypt 参数与格式 | 已冻结并写入架构文档 | 实现 `ScryptPasswordHasher`，含往返、格式解析、错格式拒绝用例 |
| `timingSafeEqual` | 已冻结为强制要求 | 代码评审项 + 反例测试（长度不等/空哈希） |
| 可插拔 KDF | `PasswordHasher` 端口已定义 | 实现 `$argon2id$` 分派分支（当前返回"未启用"），为后续迁移预留 |
| 登录限流 | 设计已定 | 实现（IP + 账号维度、指数退避、锁定阈值与解锁路径、失败审计） |
| 主密码 KDF | 设计已定（scrypt 独立参数集 + 盐） | 实现解锁流程与参数下发（m 内存上限、进度提示） |
| 2FA | **未纳入本版本** | 作为增强项评估 TOTP（恢复码、绑定流程），需先完成令牌与限流 |

---

## 5. 认证与授权

### 5.1 认证

| 项 | 设计 |
| --- | --- |
| 令牌类型 | JWT **HS256**（`jose` 库），`Authorization: Bearer <token>` |
| 签名密钥 | 由主密钥派生：`hkdf(masterKey, 'jwt-hs256')`；**不由用户口令派生**；多实例部署须共享同一主密钥 |
| Claims | `sub`（userId）、`roles`、`perms`（可选精简集）、`jti`（唯一 ID）、`iat`/`nbf`/`exp`、`ver`（令牌格式版本） |
| 有效期 | access `15m`；refresh `7d`；refresh 使用时**轮换**并作废旧 `jti` |
| 吊销 | `sessions` 表：`jti`（唯一）、`user_id`、`refresh_token_hash`、`issued_at`/`expires_at`/`revoked_at`、`client_ip`、`user_agent`；触发场景：登出、改密、账号禁用/删除、管理员踢下线、检测到重放 |
| 校验顺序 | 签名 → `exp`/`iss` → 会话（`sessions` 按 token 哈希查有效会话）→ 用户是否存在且启用 → **默认口令强制改密闸门**：`security.must_change_password=true` 时，仅放行 `POST /auth/change-password`、`POST /auth/logout`、`POST /auth/refresh`、`GET /auth/me` 这 4 个接口，其余一律 `403 PASSWORD_CHANGE_REQUIRED`（`apps/server/src/http.ts` 的 `PASSWORD_CHANGE_ALLOWLIST` / `assertPasswordChangedIfPending()`） |
| 载荷禁忌 | JWT 载荷是 base64 明文，**禁止**放入口令、API Key、数据库连接信息、结果集数据 |
| 传输 | 仅 HTTPS；不使用 Cookie 承载令牌 → 天然免 CSRF；Web 端令牌存内存（`sessionStorage` 可选），避免 `localStorage` 长期驻留 |
| 免鉴权路由 | 仅 `/api/v1/health`（只返回存活与版本，`apps/server/src/routes/meta.ts`）与 `POST /auth/login`；其余一律鉴权。`/`（根路径）也无需鉴权，仅返回产品信息或托管静态页 |

### 5.2 授权模型

```
请求 → RBAC（角色 → 权限码）→ 资源级 resource_grants（subject × resource × actions）→ 环境策略（prod 保护/只读）
        任一环节不通过 ⇒ 拒绝 + 审计 result='denied'
```

| 维度 | 内容 |
| --- | --- |
| 权限码 | `conn:read/write/manage`、`query:read/write/ddl/kill`、`data:import/export`、`migration:read/plan/apply`、`ai:chat/settings`、`user:read/manage`、`role:manage`、`grant:manage`、`audit:read/verify/export`、`system:read/update/diagnose` |
| 内置角色 | `admin`（全部）、`dba`、`developer`、`analyst`（只读 + 导出）、`viewer`（只读）、`auditor`（审计 + 只读系统） |
| 资源级授权 | `resource_grants(subject_type=user\|role, subject_id, resource_type=connection\|schema\|table\|folder, resource_id 或 glob, actions[], expires_at?)` |
| 判定原则 | **默认拒绝**；`admin` 亦需通过环境策略（生产库保护可对 admin 单独放开，但必须留审计）；授权判定在**应用层统一入口**执行，不允许路由各自实现 |
| 生命周期 | 授权变更写审计 `grant.update`；`expires_at` 到期自动失效；用户/角色删除级联清理授权并写审计 |
| 会话可见性 | 用户可查看/吊销**自己**的会话；`user:manage` 可查看/吊销他人会话 |

### 5.3 现状 / 待办

| 项 | 现状 | 待办 |
| --- | --- | --- |
| JWT 签发/校验 | 算法、claim 集、TTL、密钥派生方式已冻结 | 实现 `TokenIssuer`/`TokenVerifier`，覆盖过期、篡改、`alg: none` 拒绝、`jti` 吊销用例 |
| `sessions` 吊销 | 表结构与触发场景已定 | 实现吊销查询（可加 TTL 缓存）、refresh 轮换与重放检测 |
| 授权判定 | 判定顺序与权限码已冻结 | 实现统一 `authorize()` 门面 + 表驱动单测（含越权负例） |
| 资源级授权 | 表结构已定，支持 glob 与过期 | 实现匹配算法（避免 glob 过度匹配、大小写与引用符处理） |
| 首次管理员 | 默认 `admin` / `123456`；**仅使用该默认口令时**才置 `must_change_password=true`+强制改密（见 §4.1.1），自定口令时不置位；该标记**按用户**存放，打开数据库时自动把老库的全局键迁移成本用户标记 | 引导流程（CLI `init`）与首启审计记录已实现；GUI 向导 ⬜ 规划中 |
| 2FA / SSO | 未纳入 | 增强项评估（OIDC 与 TOTP 二选一先做） |

---

## 6. 传输安全

| 控制 | 设计 |
| --- | --- |
| TLS | 必须 HTTPS（场景 B）；TLS 1.2 起，推荐 1.3；禁用 SSLv3/TLS1.0/1.1 与弱套件 |
| 证书 | 由反代终结（推荐）；或让服务端直接终结 TLS：用环境变量 `PEANUTSPROUT_TLS_KEY` / `PEANUTSPROUT_TLS_CERT`（`apps/server/src/config.ts`）。**没有** `serve --tls-cert/--tls-key` 选项。详见 `docs/deployment.md` 的 Nginx/certbot 示例 |
| HSTS | `Strict-Transport-Security: max-age=31536000; includeSubDomains`（确认全站 HTTPS 后再加 `preload`） |
| HTTP 端口 | 仅用 301 跳转到 HTTPS，不提供明文业务接口 |
| 安全响应头 | `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`（或 CSP `frame-ancestors 'none'`）、`Referrer-Policy: no-referrer`、`Permissions-Policy` 收敛 |
| CSP | Web 端启用严格 CSP（`default-src 'self'`，禁止 `unsafe-eval`；样式按需 `unsafe-inline` 或 nonce） |
| CORS | **默认只放行本机来源**（`localhost` / `127.0.0.1` / `::1`，任意端口；无 `Origin` 头的同源/CLI 请求直接放行），实现见 `apps/server/src/app.ts` 的 `isLocalOrigin()`；可用 `PEANUTSPROUT_CORS_ORIGIN` 显式配置白名单（逗号分隔，`*` 仅建议开发环境），且始终 `credentials: false` |
| WebSocket / SSE | ⬜ 规划中：服务端尚未实现 `/ws` 与 `/api/v1/query/stream`；落地时要求仅 `wss`/HTTPS 并校验 `Origin` |
| 代理信任 | `trustProxy` 默认 `false`（`apps/server/src/config.ts`），即默认忽略 `X-Forwarded-*`；需要时用 `PEANUTSPROUT_TRUST_PROXY` 开启（`true` 或网段列表）。`clientIp` 只取 `req.ip`，不自行解析转发头 |
| 客户端校验 | CLI `--insecure` 跳过证书校验**仅限自签名内网**，且必须打印醒目警告并写入审计 |
| 出站（AI） | AI 供应商调用仅走 HTTPS，`baseUrl` 白名单校验，禁止 `http://`（本地 Ollama 需显式 `--allow-insecure-ai-endpoint`） |

### 现状 / 待办

| 项 | 现状 | 待办 |
| --- | --- | --- |
| 部署侧 TLS | 文档已给出 Nginx + certbot + 自签名方案 | 落地示例配置并实测（WS/SSE 升级头依赖尚未实现的接口，⬜ 规划中） |
| 服务端安全头 | Web 静态资源由 `@fastify/static` 托管；安全头建议在反代注入 | 若需服务端统一注入，实现 Fastify 插件 + 响应快照测试 |
| 代理信任 | 默认忽略转发头，可按需配置白名单（见上） | 已在默认场景下满足；反代部署需显式开启并限制端口可达性 |
| 内部服务间 | 当前无（单体）；桌面端走 `127.0.0.1` | 若未来拆分服务，需 mTLS |

---

## 7. 只读模式与生产库保护

### 7.1 多层防护

| 层 | 机制 | 行为 |
| --- | --- | --- |
| L0 连接属性 | `connections.read_only = 1` | 该连接的一切写/DDL 直接拒绝：`403 READONLY_VIOLATION` |
| L1 环境分级 | `environment = 'prod'` | 写/DDL 需**额外**二次确认票据，且禁止 `DROP DATABASE`/`DROP SCHEMA`/无 `WHERE` 的 `UPDATE`/`DELETE`/`TRUNCATE`（策略可配置） |
| L2 全局开关 | `PEANUTSPROUT_READONLY=1` / `serve --readonly` | 整个实例只读：所有写/DDL 拒绝，导入/迁移应用同样拒绝 |
| L3 语句分类 | 领域层 SQL 分类器 | 去注释、去字符串字面量后按首关键字判定 `read`/`write`/`ddl`；无法判定归为**最危险**类别 |
| L4 权限码 | `query:read` / `query:write` / `query:ddl` | 无对应权限码即 `403 PERMISSION_DENIED`（即使连接可写） |
| L5 资源限制 | `maxRows`、`queryTimeoutMs`、`maxPoolSize`、导入批上限 | 超限截断/超时/拒绝，保护生产库不被误伤 |
| L6 二次确认 | `WRITE_CONFIRMATION_REQUIRED`（HTTP 428 / CLI 退出码 9） | 生产库写/DDL 必须携带短时、一次性、绑定 `(connectionId, sql 指纹, actorId)` 的确认票据；CLI `--yes`、GUI 二次弹窗换取票据 |
| L7 审计兜底 | 每次写/DDL 记 `query.write`/`query.ddl` | 含 SQL 预览（截断 200 字符）、影响行数、耗时，便于事后追责 |

### 7.2 分类器要求

- 输入先去 `--`、`#`、`/* */` 注释与 `'...'`、`"..."`、`$tag$...$tag$` 字面量，再做大小写无关的首关键字匹配。
- 多语句（`;` 分隔）取**最高危险等级**；驱动 `capabilities.multiStatement = false` 时应拒绝多语句。
- 无法确定（如存储过程调用 `CALL`/`EXEC`、`SELECT ... INTO`、`WITH ... INSERT`）→ 归为 `write` 或 `ddl`。
- 分类结果同时用于审计 `action` 选择、权限校验与只读拦截，**三处必须使用同一结果**，禁止各自解析。

### 7.3 现状 / 待办

| 项 | 现状 | 待办 |
| --- | --- | --- |
| 分层策略 | L0–L7 已设计 | 逐层实现并写集成测试（只读连接写 → 403；prod 写无票据 → 428；全局只读） |
| SQL 分类器 | 规则已定 | 实现 + 绕过样本测试（大小写、注释、`/*! */`、多语句、CTE 写） |
| 危险语句黑名单 | prod 默认拦截清单已定 | 实现可配置策略与"管理员放行"路径（放行也写审计） |
| 确认票据 | 绑定三要素、短时一次性已定 | 实现票据签发/校验/防重放 |
| 结果脱敏预览 | 未纳入 | 增强项：生产库查询结果自动脱敏展示（用于演示/截图） |

---

## 8. AI 脱敏网关与写操作二次确认

### 8.1 脱敏网关（出站前最后一道）

| 步骤 | 处理 |
| --- | --- |
| 1 采集 | 只采集必要上下文：目标库/schema 名、表名、列名与类型、注释；**默认不采集样本行** |
| 2 本地脱敏 | 表名/列名 → `T1/T2…`、`C1/C2…` 占位符；字面量、邮箱、手机号、身份证、银行卡、IP、URL、常见密钥模式 → `«EMAIL_1»` 等占位符 |
| 3 映射表 | 占位符 ↔ 原值映射**仅存内存**，随请求生命周期销毁；响应回来后本地还原，映射不落库、不进日志 |
| 4 样本行 | 仅当用户显式开启且权限允许时携带；携带前对每列按类型脱敏（数值抖动/字符串截断/哈希），并限制行数（默认 ≤ 20） |
| 5 出站审计 | 记 `ai.chat`（含 provider/model、`sanitizedCount`、`tokens`、`durationMs`），**不记请求体全文** |
| 6 校验 | `--verbose`/调试面板展示**脱敏后**的请求体，供用户自检 |
| 7 结果侧 | AI 返回的 SQL/文本先做危险语句检查再展示；**不自动执行** |

### 8.2 AI 相关写操作强制二次确认

| 场景 | 要求 |
| --- | --- |
| NL2SQL 直接执行 | 默认只打印 SQL；`--execute` 才执行；若分类为 `write`/`ddl` → 必须 `--yes`/GUI 二次确认，且仍受只读与 prod 策略约束（AI **不能**绕过任何安全策略） |
| AI 生成的迁移脚本 | 一律走 `migrate plan` 审核 + `migrate apply --dry-run`，不得直接应用 |
| AI 建议的多语句 | 拆分为独立语句逐条审核；`multiStatement=false` 时直接拒绝 |
| AI 供应商配置 | `ai settings set` 需 `ai:settings` 权限；API Key 走 stdin 并加密存储；变更写审计 `ai.settings.update` |

### 8.3 现状 / 待办

| 项 | 现状 | 待办 |
| --- | --- | --- |
| 脱敏规则集 | 占位符策略与字段类别已定 | 实现规则引擎 + 单测（含误脱敏/漏脱敏样本、中文姓名与地址） |
| 映射生命周期 | 仅内存、请求级销毁 | 实现并加"禁止序列化映射表"的代码守卫测试 |
| 出站审计 | `ai.chat` 字段已定 | 实现（含 `sanitizedCount`） |
| 供应商数据政策提示 | 设计已定 | GUI/CLI 首次配置时展示"数据将离开本机"提示 |
| 本地模型优先 | 原则已定（推荐 Ollama） | 文档与 UI 引导；企业版策略：禁用外部 provider |

---

## 9. 审计不可篡改

### 9.1 机制

| 项 | 设计 |
| --- | --- |
| 链算法 | `hash = sha256(prevHash + canonical(seq, ts, actorId, actorType, action, resourceType, resourceId, result, canonicalJson(detail)))`；字段间以 `\u001f` 分隔；创世 `prevHash = '0'×64` |
| 规范化 | 键名按码点升序、无空白、UTF-8、数值不用指数形式、`undefined` 省略（保证跨语言/跨版本可重算） |
| 只追加 | `audit_log` 禁止 `UPDATE`/`DELETE`（SQLite 触发器 + 仓储层不提供更新/删除方法 + 代码评审）；`seq` 主键自增，禁止跳号写入 |
| 事务性 | 业务写操作与其审计记录在**同一事务**内提交；审计写入失败 ⇒ 业务回滚（避免"操作发生但无记录"） |
| 校验 | `GET /api/v1/audit/verify`（CLI `audit verify`）重算链，返回 `ok/checked/firstSeq/lastSeq/brokenAtSeq/reason`；定时任务每日自动校验并将结论写入审计 |
| 导出 | `audit export` 支持 json/jsonl/csv，导出动作本身被审计 |
| 外部锚定 | 可选：定期把 `(lastSeq, lastHash)` 追加到外部不可篡改位置（远端 syslog、对象存储 WORM、用户文件签名），用于防御"整体重算链" |
| 边界说明 | 哈希链能**发现**篡改，不能**阻止**有库文件写权限者重算全链；因此不宣称"绝对不可篡改"，而是"可检测 + 可外锚" |
| 记录内容 | 动作、主体、资源、结果、耗时、行数、SQL 哈希与预览；**禁止**：明文凭据、令牌、API Key、结果集内容、完整连接串 |

### 9.2 现状 / 待办

| 项 | 现状 | 待办 |
| --- | --- | --- |
| 链算法与规范化 | 已冻结并给出规范性描述 | 实现 `AuditService.append/verify`，覆盖创世、并发追加（串行化写）、区间校验、断点定位用例 |
| 只追加约束 | 设计已定 | 建表时添加触发器；仓储层删除更新方法 |
| 事务一致性 | 设计已定 | 集成测试：审计失败导致业务回滚 |
| 定时校验 | 设计已定 | 实现调度与失败告警（日志 + UI 横幅） |
| 外部锚定 | 可选增强 | 评估成本，优先支持"导出并签名"而非在线锚定 |
| 保留策略 | 未定 | 制定保留期与归档策略（归档文件仍需可校验链） |

---

## 10. SQL 注入防护

| 控制 | 要求 |
| --- | --- |
| 值绑定 | **所有**用户可控值走参数绑定（`?`/`$1`/`:name`，由驱动方言统一转换）；禁止字符串拼接生成谓词 |
| 标识符 | 表名/列名/排序字段等**不能参数化** → 必须：① 从元数据白名单校验（存在性 + 类型）；② 用驱动 `capabilities.identifiers` 的引用符包裹；③ 限制长度与字符集（拒绝控制字符、引号、分号） |
| 动态 SQL 片段 | `--where`、排序、分页、`--on-conflict` 键等一律"白名单/枚举 + 参数化值"，不允许整段自由文本拼接 |
| 排序方向 | 仅接受 `ASC`/`DESC` 枚举 |
| 分页 | 由驱动按方言生成（`LIMIT/OFFSET`、`FETCH FIRST`），参数化数值并校验为非负整数与上限 |
| 导入 | 源文件内容视为**不可信数据**（只作为值绑定）；`sql` 格式导入的语句需显式 `--allow-sql-file` 并在只读环境拒绝 |
| 元数据查询 | 驱动内部查询系统表时使用常量模板 + 参数化（如 `information_schema` 过滤），不拼接用户输入 |
| 迁移 DDL | 生成的 DDL 标识符经引用符包裹；破坏性语句需确认；`plan` 可离线审阅 |
| SQLite（元数据库） | 元数据库访问同样参数化；PRAGMA 值来自枚举白名单 |
| 前端 | 结果渲染不做 HTML 注入（React 默认转义）；禁止 `dangerouslySetInnerHTML` 渲染用户数据；CSP 兜底 |
| 测试 | 恶意样本集：`'; drop table --`、Unicode 引号、`\0`、超长标识符、大小写混淆、注释绕过、多语句注入 |

### 现状 / 待办

| 项 | 现状 | 待办 |
| --- | --- | --- |
| 参数化硬约束 | 已写入架构（禁止把用户输入拼进 SQL） | 驱动层统一实现 + 代码评审清单 + 恶意样本单测 |
| 标识符校验 | 方案已定（白名单 + 引用 + 字符集） | 实现 `validateIdentifier()` 与各驱动引用规则 |
| 动态片段 | 枚举化方案已定 | 实现 `--where`/排序/分页的受限构造器 |
| 静态检查 | 未纳入 | 增加禁用 API 列表（如禁止 `db.exec(userInput)`、禁止模板串拼接 SQL）+ lint 规则 |

---

## 11. 本地文件权限

### 11.1 目录与权限矩阵

| 路径 | 权限（POSIX） | Windows | 内容 |
| --- | --- | --- | --- |
| `~/.peanutsprout/` | `0700` | ACL：仅当前用户，禁用继承 | 数据根目录 |
| `~/.peanutsprout/peanutsprout.db`（含 `-wal`/`-shm`） | `0600` | 仅当前用户 | 元数据库（含密文） |
| `~/.peanutsprout/master.key` | `0600` | 仅当前用户 | 主密钥 |
| `~/.peanutsprout/logs/` | `0700`，文件 `0600` | 仅当前用户 | 运行日志（脱敏） |
| `~/.peanutsprout/backups/` | `0700`，文件 `0600` | 仅当前用户 | 备份与迁移前快照 |
| `~/.peanutsprout/cli.json`、`cli-token` | `0600` | 仅当前用户 | CLI 配置与令牌 |
| `diag-*.zip` | `0600` | 仅当前用户 | 诊断包（脱敏后仍属敏感） |
| 仓库内 | `.gitignore` 已忽略 `.peanutsprout/`、`master.key`、`*.key`、`*.db*`、`logs/`、`diag-*.zip` | — | 防止误提交 |

### 11.2 规则

- 启动时校验：目录权限比 `0700` 宽松、`master.key` 比 `0600` 宽松、或文件属主不是当前用户 → **拒绝启动**并输出修复命令（`chmod 700 …` / `chmod 600 …`）；CLI 侧打印警告。
- 创建文件时使用 `fs.open(path, 'wx', 0o600)` 语义，避免"先创建后 chmod"的竞态窗口；目录用 `0o700`。
- 符号链接防护：写关键文件前用 `O_NOFOLLOW` 语义（`fs.lstat` 校验）防止被指向他处。
- 备份/导出文件同样按 `0600` 创建。
- 失败即拒绝（fail-closed）：权限校验失败不降级为"仅警告后继续写凭据"。

### 11.3 现状 / 待办

| 项 | 现状 | 待办 |
| --- | --- | --- |
| 权限矩阵 | 已定义，且 `.gitignore` 已落地（忽略运行时数据） | 首次初始化按矩阵创建；启动时校验并 fail-closed |
| Windows ACL | 方案已定（禁用继承 + 仅当前用户） | 用 `icacls` 等价实现或 Node API 落地并测试 |
| 日志/导出文件权限 | 要求已定 | 实现统一 `secureFs` 工具并强制所有写路径使用 |
| 符号链接 | 要求已定 | 实现 `lstat` 校验与测试 |

---

## 12. 日志、错误信息与遥测

### 12.1 禁止出现在日志中的内容

| 禁止项 | 说明 |
| --- | --- |
| 明文/密文口令、私钥内容、API Key、JWT（整串与签名段） | 一律不进日志、不进错误信息、不进审计明细 |
| 完整连接串/DSN（含 `user:pass@host`） | 只记录 host:port 与 dbType |
| 查询结果集内容 | 只记 `rowCount`、`sqlHash`、`sqlPreview`（≤ 200 字符，且去除字面量可选） |
| `sessions.refresh_token_hash`、`jti` 之外的个人信息 | 会话相关只记 `sessionId` 与 `userId` |

### 12.2 机制

- 统一 `Logger` 端口内置**字段级脱敏**：键名匹配 `password|passwd|secret|token|api[_-]?key|authorization|private[_-]?key|passphrase|credential|dsn` 的值一律替换为 `«REDACTED»`；值为对象时递归。
- 连接串构造函数**只能**返回脱敏形式用于日志；明文形式仅存在于本地变量（命名约定 `*Secret` 便于评审）。
- 错误响应：对外仅返回 `{code, message, details}`，`details` 经白名单过滤；堆栈只在 `--verbose` 下写到本地日志，绝不进 HTTP 响应。
- 遥测：**默认完全关闭**，不发送任何数据；若未来引入，必须显式 opt-in、文档列明字段、可一键关闭。
- 崩溃报告：本地生成（写入日志目录），不含内存转储；上传需用户手动操作并预览内容。
- 日志轮转：按天 + 大小上限（默认 10 MB × 14 份），避免磁盘打满（打满会连带影响 SQLite 写入）。

### 12.3 现状 / 待办

| 项 | 现状 | 待办 |
| --- | --- | --- |
| 脱敏字段清单 | 已定义 | 实现 `Logger` 脱敏器 + 单测（含嵌套对象、数组、异常对象） |
| 错误映射 | 错误码与响应结构已在架构中冻结 | 实现全局错误映射中间件，确保未知异常不泄露内部细节 |
| 日志轮转 | 策略已定 | 实现轮转与磁盘占用告警；`doctor` 检查磁盘余量 |
| 遥测 | 默认关闭（原则已定） | 在 PRD/隐私说明中明示"无遥测"或 opt-in 机制 |
| 秘密扫描 | CI 思路已定 | 落地扫描脚本（日志/诊断包/测试快照/仓库历史） |

---

## 13. 依赖与供应链安全

| 控制 | 说明 |
| --- | --- |
| 锁版本 | `packageManager: pnpm@11.19.0` + 提交 `pnpm-lock.yaml`；CI 用 `--frozen-lockfile` |
| 生命周期脚本白名单 | `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 仅允许 `electron`、`esbuild`；新增需评审 |
| 零原生编译 | 本地存储用 Node 内置 `node:sqlite`，避免 `node-gyp`/预编译二进制带来的执行风险与平台矩阵负担 |
| 运行期依赖最少化 | 服务端仅 Fastify 系；认证用 `jose`；CLI 用 `commander`；其余尽量标准库 |
| 审计与 SBOM | CI 跑 `pnpm audit --prod`；发布时产出依赖清单（SBOM）随 Release 附件 |
| 发布包签名 | 更新包 sha256 + 发布者签名双校验（`cosign`/`minisign`）；安装包按平台签名（Windows Authenticode、macOS Developer ID + 公证） |
| 供应链响应 | 依赖漏洞分级（可利用性优先）；高危必在下一补丁版本修复并在 Release Notes 标注 |

### 现状 / 待办

| 项 | 现状 | 待办 |
| --- | --- | --- |
| 依赖白名单 | ✅ 已落地（`pnpm-workspace.yaml` 的 `onlyBuiltDependencies: electron, esbuild`；`.npmrc` 允许自动安装 peer） | CI 中禁止绕过白名单（评审门禁） |
| 锁文件与 Node 版本 | 根 `package.json` 已声明 `engines.node >= 22.5.0`（因 `node:sqlite`） | 添加 `.nvmrc`/`.node-version` 与 CI 矩阵（22.x、24.x），并在发布文档中明示版本下限 |
| 订阅漏洞通告 | 未开始 | 建立依赖升级节奏（月度例行 + 高危即时） |
| 发布签名 | 设计已定 | 配置 CI 签名与公钥内置到 CLI |

---

## 14. 安全默认值清单（首次启动即生效）

| # | 默认值 |
| --- | --- |
| 1 | 服务端默认监听 `127.0.0.1:8787`（`apps/server/src/config.ts`）；监听 `0.0.0.0` 只能通过 `--host` / `PEANUTSPROUT_HOST` 显式指定，**当前不会额外打印安全提示**（⬜ 规划中） |
| 2 | 新建连接默认 `read_only = false`；生产库识别由 `colorTag`/名称触发，写操作强制二次确认 |
| 3 | 结果集默认上限 `query.max_rows = 10000`，请求只能调低不能突破上限（`apps/server/src/routes/query.ts`） |
| 4 | 审计默认全量开启，清理需 `settings.manage` 权限 |
| 5 | AI 默认**不启用**；启用后默认不携带样本行，且强制脱敏 |
| 6 | 遥测默认关闭 |
| 7 | 会话令牌 TTL 默认 12 小时（`PEANUTSPROUT_TOKEN_TTL_SEC`）；`POST /auth/refresh` 续签时**轮换并吊销旧会话** |
| 8 | 数据目录 `0700`、密钥 `0600`；目录权限每次启动收敛为 `0700`，**当前不会因权限不合格而拒绝启动**（⬜ 规划中） |
| 9 | ✅ 转发头默认不被信任：`clientIp` 只取 `req.ip`，`trustProxy` 默认 `false`；反代部署用 `PEANUTSPROUT_TRUST_PROXY` 显式开启并限制端口可达性（见 B7） |
| 10 | `update check` 已实现；`download/apply/rollback` 与 sha256/签名校验 ⬜ 规划中 |
| 11 | `diagnose` 当前只导出单个诊断 JSON，**不含**主密钥、密文、令牌、结果集；打包成 zip 的诊断包 ⬜ 规划中 |
| 12 | 首次管理员默认口令固定为 `123456`（非随机），**仅使用该默认口令时**强制改密；自定口令时不强制 |

---

## 15. 安全评审与漏洞响应

| 环节 | 要求 |
| --- | --- |
| 代码评审门禁 | 涉及 `SecretCipher`、`PasswordHasher`、授权判定、SQL 构造、审计链的改动需至少一名评审人，并附负例测试 |
| 测试要求 | 越权、只读绕过、注入样本、令牌吊销、审计断链检测必须有自动化用例（vitest，`tests/**` 与包内 `*.test.ts`） |
| 发布前检查 | 权限矩阵校验脚本、秘密扫描、依赖审计、Electron 安全基线断言 |
| 漏洞报告 | 私密渠道（邮件/私有 issue）提交，收到后 72 小时内确认，30 天内出修复计划 |
| 安全公告 | 修复版本在 Release Notes 标注影响版本、利用条件、缓解措施；必要时提供临时缓解配置 |
| 已知未解决项 | ① 无 2FA；② 无外部审计锚定；③ 哈希链对有写权限者仅可检测不可阻止；④ 主密钥丢失不可恢复；⑤ `node:sqlite` 仍处活跃开发期（需锁 Node 版本）。以上均已在文档中明示，不得在对外宣传中弱化 |
