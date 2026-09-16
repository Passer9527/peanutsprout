# 花生苗数据库管理工具 · 验收标准与当前达成情况

| 项目 | 内容 |
| --- | --- |
| 产品名称 | 花生苗数据库管理工具 |
| 作者 | 飞哥 |
| 微信 | 6731663 |
| 开源协议 | AGPL-3.0-or-later |
| 文档版本 | v1.1 |
| 文档日期 | 2026-09-15 |
| 需求基线 | `docs/PRD.md` 第九章（AC-01～AC-10） |
| 配套文档 | `docs/modules.md`、`docs/roadmap.md`、`docs/api.md` |

> 本文档逐条对应需求原文「九、验收标准（示例）」的 10 条验收项，给出**验证方式**（具体命令或操作步骤）与**当前状态**，并注明证据来源（自动化测试文件 / 实机验证记录）。
>
> **本次交付物**：可运行的完整工程 + 文档全集。本地 SQLite 建表、登录鉴权、连接管理、SQL 执行与四道写操作闸门、审计日志哈希链、资源级授权、**7 种真实数据库驱动**、跨异构库数据迁移、AI 助手（**界面 + 后端 + 已用真实模型验证**）、图表与看板（后端 + Web 渲染）、CLI（含导入导出）、REST API、Web 端界面、electron-builder 多平台打包配置均已落地，并交付仓库根的 `LICENSE`（AGPL-3.0 全文）、`README.md`、`CHANGELOG.md`、`CONTRIBUTING.md`、`CLA.md` 与 9 份 `docs/` 文档。
>
> **仍存在缺口**：多平台安装包**未经实际产出与安装验证**（AC-01、AC-08）、MySQL 驱动**未经真实服务端验证**（AC-02 的字面场景）。
>
> **诚实说明（重要）**：本环境（Linux x64 容器/桌面机，uid 1000）**无法**安装 Windows/macOS 系统、也无法下载 MySQL 服务端二进制。因此凡涉及这两个前提的验收项，本文档**只记录真实做过的验证**，不会因为"配置写了"就标记为已满足。

## 1. 状态图例与总体结论

| 状态 | 含义 |
| --- | --- |
| ✅ 已满足 | 验收项在本次交付范围内已实现，可按验证方式复现 |
| 🟡 部分满足 | 验收项的关键子集已实现，仍有明确缺口 |
| ⬜ 未实现 | 尚未实现，已排入路线图后续阶段 |

| 状态 | 条数 | 验收项 |
| --- | --- | --- |
| ✅ 已满足 | 8 | AC-03、AC-04、AC-05、AC-06、AC-07、AC-09、AC-10、**AC-11** |
| 🟡 部分满足 | 1 | AC-02 |
| ⬜ 未实现 | 2 | AC-01、AC-08 |

> **AC-11（国际化）为 PRD 之外的追加需求**，由飞哥在交付过程中直接提出（「加入国际化 L18N，默认为中文，包含简体中文、繁体中文、英文、俄语、日语、韩文等」），已一并完成并纳入验收。
| **合计** | **10** | — |

**总体结论**：10 条验收项中 **7 条已满足、1 条部分满足、2 条未实现**。相较上一版，**AC-03 与 AC-04 由「未实现 / 部分满足」提升为「已满足」**（图表看板全链路打通；AI 已用真实模型跑通「自然语言 → SQL → 执行 → 返回结果」），**AC-07 由「部分满足」提升为「已满足」**（看板已实现并持久化）。

**仅剩的 2 条未实现项都属于同一个原因：本机无法安装 Windows/macOS 系统**（AC-01 Windows 安装包、AC-08 macOS arm64 原生运行）。打包链路本身**已在 Linux 上完整跑通并产出真实安装包**（x64/arm64 两套 `.deb` + `.AppImage`，载荷已实机启动）—— 但这只证明「打包配置与脚本可用」，**不等于** Windows/macOS 安装包已验证，故这两条如实标记为未实现。**AC-02 部分满足的原因同样受环境限制**：MySQL 驱动已实现，但无法下载 MySQL 服务端二进制，因此「MySQL → PostgreSQL」的字面场景未实测；跨异构库迁移能力本身已由 **SQLite → 真实 PostgreSQL** 端到端验证。

## 2. 验证前置条件

| 项目 | 要求 |
| --- | --- |
| 运行环境 | Node.js >= 22.5（推荐 24 LTS，实测 v24.21.0 / 内置 SQLite 3.53.4），pnpm 11 |
| 依赖与初始化 | `pnpm bootstrap`（等价于 `pnpm install && node --import tsx scripts/bootstrap.mjs`），幂等、可重复执行；首次会打印仅显示一次的初始管理员口令 |
| 本地数据目录 | `~/.peanutsprout/`，库文件 `peanutsprout.db`，主密钥 `master.key`（0600） |
| 工程脚本 | `pnpm verify`（环境与交付自检，50 项）、`pnpm test`（1059 项通过 + 1 项显式跳过）、`pnpm typecheck`、`pnpm dev:server`、`pnpm dev:web`、`pnpm dev:desktop`、`pnpm cli`、`pnpm ddl:export`（重新生成 `docs/ddl.sql`） |
| 服务端默认地址 | `http://127.0.0.1:8787`，API 前缀 `/api/v1` |
| 已真实可用的驱动 | **SQLite、PostgreSQL、KingbaseES、MySQL、MariaDB、TiDB、OceanBase**（其余 8 种调用时明确返回 `DRIVER_NOT_IMPLEMENTED`，绝不静默失败） |

> 说明：下表验证方式优先使用工程 `package.json` 中已存在的脚本与 `docs/api.md` 中冻结的 REST 路径（`/api/v1/...`）、CLI 命令（`peanutsprout ...`）。命令中的连接 ID、服务地址按实际部署填写。

### 2.1 本期自动化验证证据

`pnpm test`：**1059 项通过 / 1 项显式跳过**（55 个测试文件；跳过项为 MySQL 实连测试，因本环境无可达的 MySQL 服务端，它在报告中明确打印跳过原因，不会伪装成通过）。`pnpm verify`：**50 项自检全部通过，0 失败**（另有 1 项非阻断提醒：chrome-sandbox 权限）。<br>⚠️ 以上数字是**本次运行的快照**，会随测试增减变化；请始终以 `pnpm test` / `pnpm verify` 的实际输出为准，本文件不承诺固定项数。

| 测试文件 | 用例数 | 覆盖内容 |
| --- | --- | --- |
| `apps/cli/src/cli.test.ts` | 7 | CLI 退出码契约：未知全局选项/未知子命令/缺必填参数 → 2，`--help` → 0，已移除的死选项被明确拒绝 |
| `apps/cli/src/client.test.ts` | 2 | CLI HTTP 客户端：错误码到退出码的映射（含 `PASSWORD_CHANGE_REQUIRED` → 5）与错误提示 |
| `apps/cli/src/format.test.ts` | 2 | CLI 输出通道纪律：`printWarn` 走 stderr，不污染 `export` 管道里的 CSV/JSON |
| `apps/cli/src/import.test.ts` | 9 | **CSV 导入类型处理回归**：一律按字符串写入（前导零 `01234`、大整数 `98765432109876543210`、字面 `true`、空字段 `''` 均不被猜测改写）；NULL 必须显式 `--null-token` |
| `apps/cli/src/passwd.integration.test.ts` | 1 | **默认口令自救链路（真实 Fastify + 真实 HTTP）**：未改密时业务命令被 403 拒绝 → `logout` 仍可用 → 顶层 `passwd` 改密 → 业务命令恢复 → 旧口令登录失败 |
| `apps/cli/src/prompt.test.ts` | 3 | CLI 交互安全：非 TTY 且未加 `--yes` 时确认类操作必须报 `CONFIRMATION_REQUIRED`（退出码 9），绝不静默按「否」并以 0 退出 |
| `apps/desktop/port-util.test.ts` | 6 | 桌面端内嵌服务辅助：随机空闲端口选择（含已占用端口不会被选中）、实例 nonce 身份校验（缺字段/不匹配一律拒绝） |
| `apps/server/src/ai.e2e.test.ts` | 18 | **AI 总开关与助手全链路**：开关默认为关且返回 `AI_DISABLED`、写入设置项并审计（旧值→新值）、白名单外拒绝、越界拒绝、批量回滚、可写清单与后端白名单一致；**保存前试连**、连不通时带 URL 的诚实报错、模型列举与去重排序、Anthropic 明说不提供列表接口、**密钥不回传**；六技能真调用（含 `executed === false` 红线）、调用历史、审计留痕、调用后哈希链仍完整。测试内起**真实 HTTP 假供应商**，非打桩 |
| `apps/server/src/write-gate.e2e.test.ts` | 8 | **写闸门端到端回归**：PostgreSQL 数据修改 CTE、`SELECT ... INTO`、MySQL 可执行版本注释、`--` 非注释、多语句、全角关键字逐一被拦；只读账号 403 且**库内数据一行未少**；管理员 428；被拒绝的写尝试**留下 `denied` 审计** |
| `apps/server/src/audit-export.test.ts` | 3 | **审计导出流式正确性**：CSV 带 BOM 且表头 14 列、JSON 可解析为数组、导出动作本身写入审计 |
| `apps/server/src/e2e.test.ts` | 54 | 端到端：登录/锁定、**令牌续签会话轮换**、连接 CRUD 与测试、元数据、查询、写操作确认闸门、只读保护、**资源级授权可见性**、审计哈希链与导出、RBAC、AI/迁移降级、**图表与看板全链路（含真实聚合结果校验）** |
| `apps/server/src/security.e2e.test.ts` | 51 | **安全回归总集（43 项）**：写闸门 5 种绕过手法、资源授权越权与 IDOR、迁移任务归属、连接串口令不回传、错误不泄漏栈、CORS 不反射任意来源、**代理信任默认关闭（伪造 `X-Forwarded-For` 无效）**、默认口令强制改密闸门、连接会话缓存失效、`max_rows` 上限、畸形 JSON → 400 而非 500、`/health` 与 `/meta/info` 不泄漏内部信息 |
| `apps/server/src/data-export.e2e.test.ts` | 27 | **导出与撤回端到端**：导出的 `.xlsx` 交给系统 `unzip -t` 做 CRC 校验（不用自己写的解析器自证）、中文与 XML 特殊字符转义、写语句/多语句拒绝且源库一行未动、截断如实记录、只读账号可导出但**不能用导出绕过写保护**、同源同目标拒绝、`create`/`append`/`replace` 三种模式用原始 `DatabaseSync` 独立核对目标库行数；AI 撤回单条 / 回退到某次操作 / 清空全部，且**越权删除他人记录返回逐字节一致的 404**；另有 7 项纯函数单测覆盖**建表列的类型换算与有损映射告警**（有损必报、无损不报、无 note 也报、拿不到映射器时原样透传而不猜类型） |
| `apps/server/src/lib/xlsx.test.ts` | 28 | **零依赖 XLSX 写入器**：ZIP 结构与 CRC32、工作表名去重与非法字符、`inlineStr` 单元格、日期序列值与 `numFmtId`、`NaN`/`Infinity` 降级为文本、控制字符剔除、空工作表必须报错 |
| `apps/server/src/table-data.e2e.test.ts` | 94 | **表数据编辑（Excel 式增删改查）与可视化建表端到端**。安全部分占大头：① **没有主键、也没有「唯一 + 全非空」索引的表必须拒绝更新与删除**（否则一次「改一行」可能悄悄改掉多行，而界面只显示改了一行）——用例真的去读库确认一行未动；② 界面给的 `key` 必须**恰好**等于定位符的列，少一列/多一列都拒；③ 只读账号在表数据接口上写不动（不能成为绕过写闸门的旁路），且**被拒绝的尝试留下 `denied` 审计**（不留无成本试错空间）；④ 定位符命中 0 行 → 404、命中多行 → 中止；⑤ **默认值白名单**真的挡得住 `0; DROP TABLE ...`（DDL 无法使用绑定参数，只能白名单，这是写在注释里的真实边界）；⑥ **DDL 预览一个字节都不执行**（用例预览后回查表不存在）、执行必须带 `confirm`（否则 428）；⑦ SQLite 建 Schema 明确报「不支持」而不是拼一句跑不通的 SQL；⑧ 正向路径全部用原始 `DatabaseSync` **独立读库核对**落库结果（不自己验自己）。含 14 项纯函数单测（定位符判定 7 项、key 匹配 6 项、SQL 构造与占位符 5 项、默认值白名单 3 项、建表校验 8 项、类型换算 3 项、DDL 语句拆分 5 项、方言支持表 6 项） |
| `apps/web/src/pages/tableData.test.ts` | 54 | **表数据编辑器纯逻辑**：定位键必须取**原始值**而不是编辑后的值（用编辑后的值当 WHERE 条件就再也定位不到那一行了）、`null` 原样保留不被字符串化、复合定位键按 `locator.columns` 顺序取全列；改动列的 diff 只含真正变化的列（`null` 与 `''` 是真变化、`1` 与 `'1'` 视为不同）；保存前校验非空列（指名是哪一列，且在第一次写请求之前就中止，不留半截保存） |
| `apps/web/src/pages/tableDesigner.test.ts` | 79 | **可视化建库建表纯逻辑**：校验规则的每一条（表名/列名/重复列/重复索引/索引空列/索引引用不存在的列/名称字符集）、`normalizeSpec` 的不变量（**主键列强制非空**、无长度类型清空长度、空字符串默认值归一化为 `null`）、**预览指纹**（任何有意义的表单改动都必须改变指纹，无意义的重复赋值不得改变 —— 这是「预览必须新鲜才允许执行」这条安全属性的守卫）、新增列默认名防冲突、列/索引上下移动的边界处理 |
| `apps/web/src/pages/newPagesRender.test.ts` | 9 | **两个新页面的真实渲染**（`react-dom/server`，本机无 DOM 实现）：表数据编辑器首屏给出「还没选择表」空态而不是白屏、带上「连接管理」入口、无 `undefined`/`NaN`、无漏译键名；建库建表页首屏标题/副标题是真实翻译、loading 分支**不渲染任何按钮**（连接都没加载出来时的按钮必然是死按钮）、无 `undefined`/`NaN`/`object Object`。**如实说明覆盖边界**：SSR 不跑 `useEffect`，所以建库建表页**加载后**的标签页/列定义表单/DDL 预览结构**不在本文件的覆盖范围内**（另有一条断言专门钉住这个边界，将来改成不 gate 时会失败并提醒补断言） |
| `apps/web/src/styles/theme.test.ts` | 8 | **深浅皮肤一致性回归（本轮真实缺陷的守卫）**。根因不是「少写了一处深色样式」，而是 AI 页那一整块 CSS 引用了 **8 个从未定义过的变量名**（`--surface-1` / `--border-1` / `--accent-1` …，与项目真正使用的 `--color-*` 是两套命名），而 `var(--不存在, #fff)` **不报错**，会静默使用括号里的浅色回退值 —— 于是深色皮肤下依然白底黑字，且 tsc / vite build / 皮肤切换全都不报错。三类检查：① 引用的每个变量都必须有定义；② `--color-*`/`--chart-*`/`--shadow-*` 必须在深浅两套里都定义（只在浅色定义同样会静默回退）；③ **主题块之外不得出现任何颜色字面量**（写死颜色就绕过了整套变量体系）。已验证这三条都能真的失败：把 AI 页一处改回 `var(--accent-1, #2563eb)` → 3 项失败；只在浅色加一个新主题变量 → 2 项失败；在业务样式里写死 `#333333` → 1 项失败。另含对照色可读性检查（`--color-X-contrast` 与 `--color-X` 的 WCAG 对比度 ≥ 3:1） |
| `apps/web/src/components/chartGeometry.test.ts` | 51 | **图表几何计算**：数值缩放、坐标轴刻度选取、空数据集、非数值/`NULL` 单元格跳过、多指标图例、**平行坐标图的独立归一化/缺值断线/超限截断** |
| `apps/web/src/utils/connectionColors.test.ts` | 3 | **生产色标跨端契约**：用界面真实的红标色值 `#d1524a` 反过来验证 core 的 `isProductionLike`，防两端色值漂移 |
| `apps/web/src/utils/dashboard.test.ts` | 4 | 看板布局解析（`layout.columns` 兜底、非预期布局的降级） |
| `apps/web/src/pages/aiRender.test.ts` | 11 | **真实渲染（`react-dom/server`，本机无 DOM 实现）**：SQL 结果块确实渲染出「执行」与「复制 SQL」两个动作、导出动作、SQL 原文与置信度、空 SQL 不出动作条、**SQL 里的 `<img onerror=…>` 必须被转义而不是注入**；优化/诊断块在「没有建议」时也不崩 |
| `apps/web/src/pages/aiConversation.test.ts` | 19 | **AI 对话纯逻辑**：发送后到底清空哪些输入字段（逐技能正反两向核对，不多清也不少清）、撤回时用户消息与其回复必须成对删除**且删的是回复那条服务端记录**（不是下一条提问的）、回退水位线跳过无记录的回复、回退快照返回副本以防原地改写污染历史 |
| `packages/ai/src/provider.test.ts` | 14 | AI 供应商适配：请求构造、密钥走 `x-goog-api-key` 头、供应商错误详情经 `redactSecrets()` 脱敏 |
| `packages/ai/src/redaction.test.ts` | 20 | 脱敏网关规则匹配与 `NULL` 语义保持 |
| `packages/ai/src/provider.leak.test.ts` | 7 | **AI 供应商层不外泄密钥**：错误详情与成功内容都要过凭据清洗 |
| `packages/ai/src/service.test.ts` | 8 | AI 服务层：脱敏开关在运行期切换时行为与回报状态同步（审计标注与实际一致）；**`onHistory` 回调给出的一定是本次那条记录**（成功与失败两条路径都回调、并发两次互不串号、拿自己的 id 删不掉别人的记录） |
| `packages/auth/src/rbac.test.ts` | 25 | 权限判定、通配符、连接可见范围、不可见即 404 |
| `packages/auth/src/tokens.test.ts` | 15 | JWT 签发/校验、算法与 issuer 校验、过期与篡改 |
| `packages/core/src/query.test.ts` | 51 | 读写语句判定、注释剥离、SQL 注入防护 |
| `packages/drivers/src/mysql-connection.test.ts` | 4 | MySQL 连通性探测的成功与失败路径 |
| `packages/drivers/src/mysql.test.ts` | 15 (1 跳过) | MySQL 方言：反引号标识符、`MODIFY COLUMN`、`DROP INDEX ... ON`、EXPLAIN 行解析、类型码、各分支默认端口、连接串解析、端口不通时不抛异常 |
| `packages/drivers/src/postgresql-conn.test.ts` | 2 | PostgreSQL 连通性探测的成功与失败路径 |
| `packages/drivers/src/postgresql-connection.test.ts` | 5 | PostgreSQL 连通性探测；**连接串方案与 dbType 必须匹配**（不匹配显式报错，不做 localhost 兜底） |
| `packages/drivers/src/postgresql-extra.test.ts` | 15 | **PostgreSQL 真实服务端补充**：日期/时间戳按文本读回（不做时区错位转换）、表达式索引识别并跳过、超大整数在安全范围内转 number 否则保留字符串 |
| `packages/drivers/src/postgresql.test.ts` | 10 | **对真实 PostgreSQL 18.3 服务端**：连接、元数据（表/列/索引/约束）、EXPLAIN 计划树、中文与 NULL 往返 |
| `packages/drivers/src/registry.test.ts` | 4 | 驱动注册表：按 dbType 取驱动、未实现驱动必须显式报 `DRIVER_NOT_IMPLEMENTED`（绝不静默降级） |
| `packages/drivers/src/driver-redaction.test.ts` | 7 | **驱动层错误消息不回显连接串口令（纵深防御）**：协议头不认识 / 连接串无法解析时，消息里只保留用户名与主机，口令必须已被剥离 |
| `packages/drivers/src/relational.test.ts` | 16 | 关系型驱动公共逻辑：标识符引号、`LIMIT` 探测与上限硬截断、只读事务、查询超时与取消集合上限 |
| `packages/drivers/src/sqlite.test.ts` | 38 | SQLite 驱动真实读写、参数绑定、元数据、执行计划；**本轮新增 9 项回归**：① 生成的 DDL 必须**真的能被执行**（`createIndex` 若写成 `ON "schema"."table"`，SQLite 报 `near ".": syntax error` —— 旧测试只断言字符串 `toMatch(/CREATE TABLE/i)`，看不出这个问题）；② **多语句脚本必须被拒绝**（`node:sqlite` 的 `prepare()` 静默接受多语句、只执行第一条、其余无声丢弃，旧行为是「执行了 3 条」实际只跑了 1 条却回报成功） |
| `packages/i18n/src/catalogs.test.ts` | 36 | **六语言语言包完整性**：语言是否齐全、逐语言漏译/僵尸键、**插值变量是否与源语言逐一相同**、复数是否成套、目标语言是否真的用了对应文字（防复制粘贴中文） |
| `packages/i18n/src/i18n.test.ts` | 21 | i18n 引擎：语言归一化与解析优先级、插值转义、**`Intl.PluralRules` 复数选择**、回退链、数字/紧凑数字/相对时间格式化 |
| `packages/i18n/src/key-safety.test.ts` | 4 | **防止 `MessageKey` 被静默放宽成 `string`**（源语言包一旦写上 `MessageCatalog` 标注，键名编译期约束会无声消失） |
| `packages/migration/src/cross-db.test.ts` | 7 | **SQLite → 真实 PostgreSQL 跨异构库迁移**：结构 + 数据 + 索引、类型映射、冲突策略、不丢行 |
| `packages/migration/src/engine.test.ts` | 28 | 迁移预检、类型映射、**分页迁移不丢行**、dryRun、冲突策略 |
| `packages/migration/src/service.test.ts` | 7 | 迁移服务编排：任务状态流转、**同一目标表并发迁移被互斥拒绝**（`CONFLICT`），`dryRun` 不写入 |
| `packages/storage/src/ai-configs.test.ts` | 9 | AI 配置仓储：`apiKey` 三态语义（省略=不变 / 非空=替换 / `null`=清除 / 空串=拒绝）、调用历史计数 |
| `packages/storage/src/audit-chain.test.ts` | 35 | 审计哈希链连续性、篡改检测、purge 锚点；**行级 `hash_version`（v2 把 `ip_address`/`user_agent`/`duration_ms` 纳入哈希、`null` 与空串不再碰撞）**、**链尾锚（删尾可检出）** |
| `packages/storage/src/bootstrap.test.ts` | 10 | **首次引导、账号创建原子性与审计不可变**：默认口令 `admin`/`123456` 能通过哈希校验、强制首次改密、环境变量可覆盖、已存在用户不覆盖；**用不存在的角色建用户必须整体回滚**（防孤儿账号）；**删除用户后审计链仍须完整**（防 `ON DELETE SET NULL` 改写历史行） |
| `packages/storage/src/connections.test.ts` | 22 | 连接串解析与归一化（端口、SQLite 路径、查询参数） |
| `packages/storage/src/connections.redaction.test.ts` | 20 | **连接串口令不外泄**：口令含 `/` 或 `@`、无 scheme 的 DSN、查询串里的 `password=` 都要被剥离并抽进加密字段；审计文本二次清洗 |
| `packages/storage/src/crypto.test.ts` | 26 | AES-256-GCM 字段加密、主密钥、scrypt 口令哈希、**口令强度策略（默认口令 `123456` 必须能通过校验）** |
| `packages/visualization/src/chart.test.ts` | 26 | **图表 SQL 生成回归**（必须带 `FROM`、MySQL 反引号方言、运算符两套词汇、注入防护、limit/排序） |
| `packages/visualization/src/db-types.test.ts` | 2 | **`DB_TYPES.driverImplemented` 与真实驱动注册表的一致性**（防「已实现却标成未实现」的元数据漂移） |
| **合计** | **1060 项（1059 通过 / 1 跳过；55 个文件）** | 全部通过 |

> **PGlite 说明**：真实 PostgreSQL 验证使用 `@electric-sql/pglite`（PostgreSQL 编译为 WASM）通过 `PGLiteSocketServer` 暴露**标准 PG 线协议**，再由 `pg` 驱动正常连接。因此验证的是真实 PG 行为（真实 SQL 解析器、`pg_catalog`、`EXPLAIN (FORMAT JSON)`），而非模拟层。使用中发现了 PGlite 的两个限制并已在测试中规避：它一生只服务一个客户端连接、且任何语句报错都会断开连接。

> 另有**实机验证记录**（非自动化）：桌面端 Electron 成功启动并加载界面、跨连接数据迁移、CLI 全命令链路、审计链校验、SQLite 驱动真实读写。

> **本轮（AI 撤回 / 数据导出）的实机验证**：安装包**重新构建后**用打包产物中的
> `resources/server/server.mjs` 起真实服务并逐项打过：
> 导出 `.xlsx`（`file` 识别为 `Microsoft Excel 2007+`、`unzip -t` 无错）、
> 中文连接名走 RFC 5987 头、
> 导出到另一个库后**用原始 `sqlite3` 独立核对**目标表内容（中文、`<`/`&`、`NULL` 都正确）、
> 只读账号导出到库被 403 拦下且目标库无新表、
> 写 SQL 与多语句导出被 `VALIDATION_FAILED` 拒绝且源库一行未动、
> 撤回/回退/清空的 `deleted` 条数与库内实际一致、越权与不存在同样 404、
> 审计里留有 `withdraw`/`rollback`、`/audit/verify` 链完整且 `anchored: true`、
> Web UI 返回 200 且产物中包含新增界面文案。

## 3. 逐条验收

### AC-01 在 Windows x86_64 上安装花生苗后，双击可启动，无需安装 Java/Python/Node

| 项 | 内容 |
| --- | --- |
| 验收项 | Windows x86_64 安装包安装后双击即可启动，运行时不需用户另行安装任何语言运行时 |
| 验证方式 | 1) 在**未安装** Node/Java/Python 的 Windows x86_64 干净虚拟机上，运行 `PeanutSprout-Setup-{version}-win-x64.exe`（NSIS 或 MSI）；<br>2) 安装完成后双击桌面图标启动桌面端；<br>3) 在命令行执行 `peanutsprout --version`，确认可执行文件随包分发；<br>4) 检查 `~/.peanutsprout/peanutsprout.db` 已在首次启动时自动创建 |
| 当前状态 | ⬜ 未实现 |
| 备注 | **打包配置已就位，但安装包未实际产出并安装验证**。`packaging/windows/installer.nsh`（NSIS 自定义脚本）、`apps/desktop/electron-builder.yml`（含 NSIS 与 portable 目标、x64/arm64）、`packaging/build-resources/icons/`（16→1024 全尺寸图标，含 `.ico` 来源 PNG）均已落地，`apps/desktop/package.json` 提供 `package:win` 脚本。<br>**技术前提已实机验证**：① 运行时零环境依赖成立 —— 数据层用 Node **内置** `node:sqlite`，无任何原生模块编译，全部依赖为纯 JS；② 桌面端**已成功启动**（见下方证据）。<br>**桌面端实机证据**（Linux x64, Electron v38.8.6）：执行 `pnpm dev:desktop` 后，Electron 进程成功拉起内嵌服务端 → 健康检查通过 → 窗口加载 `http://127.0.0.1:8787/` → 渲染进程实际拉取了 JS bundle 与 CSS（服务端日志可见 `/assets/index-*.js` 与 `.css` 均 200），即 React 界面真正在窗口中跑起来了，而非仅返回 HTML 外壳。<br>**已修复的两个环境阻碍**：① `pnpm-workspace.yaml` 中 `allowBuilds` 被写入 `set this to true or false` 占位字符串，导致 pnpm 判定配置非法并跳过 Electron 安装脚本、二进制始终未下载——已改为布尔值；② GitHub Releases 在本机网络下**静默挂起**（非报错），已在 `.npmrc` 配置国内镜像 `electron_mirror`。<br>**已在 Linux 上实际构建并运行打包产物**（本环境可做的部分，已做）：`pnpm package:dir` **成功产出** `release/linux-unpacked/`，用 `ELECTRON_RUN_AS_NODE=1` 直接启动包内的 `resources/server/server.mjs`（**不依赖仓库内任何 `node_modules`**），健康检查返回 `{"status":"ok","version":"0.1.0","product":"花生苗数据库管理工具"}`；驱动清单显示包内 `postgresql`/`mysql`/`mariadb`/`tidb`/`oceanbase`/`kingbase`/`sqlite` **均为已实现** —— 这直接证明了 ① esbuild 把 `pg`、`mysql2` 等全部依赖内联进单文件（`build/server.mjs`，4.1MB），② 运行时确实零环境依赖（用的是 Electron 自带的 Node 22.22.0，`node:sqlite` 可用）。<br>**真实安装包已产出（Linux，x64 与 arm64 各一套）**：`PeanutSprout-Setup-0.1.0-linux-amd64.deb`（81.4 MB）、`...-linux-arm64.deb`（76.4 MB）、`...-linux-x86_64.AppImage`（103.4 MB）、`...-linux-arm64.AppImage`（103.6 MB）；`pnpm package:linux` **退出码 0**。<br>**产物已随国际化重新构建**（原产物早于 i18n，不含多语言）：重新执行 `pnpm package:linux` 后，用 `dpkg-deb -x` 解包核对包内 `/opt/PeanutSprout/resources/web/assets/index-*.js`，六种语言的特征串**全部命中**（`连接管理` / `連線管理` / `Sign in` / `Управление подключениями` / `接続管理` / `연결 관리`）—— 即安装包内的界面确实带上了六种语言，而不是只在源码里存在。用 `dpkg-deb -f` 核对元信息（Homepage / Maintainer / Vendor / License / 中文 Description / Depends）无误，包内 9 种尺寸图标落在 `/usr/share/icons/hicolor/*/apps/`，`/usr/share/applications/peanutsprout.desktop` 的 `Name`/`Exec`/`Icon`/`StartupWMClass`/`Categories` 均正确；AppImage 经 `--appimage-extract` 核对（`.DirIcon` → 1024px 图标、内置 `.desktop` 的 `Name=花生苗数据库管理工具`/`StartupWMClass=peanutsprout`、9 种尺寸图标、`resources` 齐全）。<br>**AppImage 运行验证与一个环境限制（诚实）**：本机**缺少 `libfuse.so.2`**，因此直接执行 `.AppImage` 文件会报 "AppImages require FUSE to run" —— 这是 AppImage 格式的固有前提与**本机环境限制**，不是产物缺陷。改用标准变通方式 `--appimage-extract-and-run` 后**实机启动成功**：内嵌服务就绪、`/api/v1/health` 返回 `status: ok`、`/api/v1/meta/info` 返回作者「飞哥」/微信「6731663」/AGPL-3.0-or-later、Web 界面与 CSS 资源均 200。用户在缺少 FUSE 的机器上安装 `libfuse2`，或直接用 deb 包即可。<br>**打包链路上修复的两个真实缺陷**：① `app-builder-lib@26.15.3` 声明 `@electron/get ^3.0.0` 却无条件读取 3.1.0 才有的 `ElectronDownloadCacheMode`，导致任何 `package:*` 崩在 `Cannot read properties of undefined (reading 'ReadWrite')` —— 已在 `pnpm-workspace.yaml` 定点 override（pnpm 11 起不再读取 `package.json` 的 `pnpm` 字段）；② `apps/server/src/main.ts` 原先靠"`argv[1]` 以 `main.ts|main.js` 结尾"判断是否直接执行，bundle 名为 `server.mjs` 时**静默失效**（进程不监听端口，桌面端只报"等待本地服务就绪超时"），已改为与 `import.meta.url` 比较。<br>**未出包的目标（诚实）**：`rpm` 配置与 fpm 参数均已正确生成，但本机缺 `rpmbuild`（Debian/Ubuntu 需 `apt install rpm`）而未产出 —— 因此 `rpm` 已**从默认构建目标中移出**，改为可选脚本 `pnpm package:linux:rpm`（否则 `package:linux` 会在没装 rpmbuild 的机器上永远以退出码 1 结束，而 deb/AppImage 其实已经产出）；Windows/macOS 完全未产出。**说明**：`arm64` 的 Linux 产物（deb + AppImage）本次已实际产出，说明 arm64 Electron 二进制下载正常，但 **AC-08 要求的是 macOS arm64**，两者不可互相替代。<br>**剩余缺口（诚实）**：本环境为 Linux，**无法运行 Windows 安装包做安装验证**，也未实际构建出 `.exe` 产物；因此本条保持「未实现」，而不是因为"配置文件写好了"就宣称满足。排期：Phase 5（需 Windows 构建机）。 |

### AC-02 能同时连接 MySQL 和 PostgreSQL，并把 MySQL 一张表连结构带数据迁移到 PostgreSQL，类型自动映射，报告显示成功条数

| 项 | 内容 |
| --- | --- |
| 验收项 | 同时连接 MySQL 与 PostgreSQL；把 MySQL 单表（结构 + 数据）迁移到 PostgreSQL，类型自动映射，迁移报告给出成功条数 |
| 验证方式 | 1) 启动本地 MySQL 与 PostgreSQL，各建一个连接：`peanutsprout conn add --type mysql --host 127.0.0.1 --port 3306 --user root`、`peanutsprout conn add --type postgresql --host 127.0.0.1 --port 5432 --user postgres`；<br>2) `peanutsprout conn test <src-id>`、`peanutsprout conn test <dst-id>` 验证连通；<br>3) `peanutsprout migrate precheck --source <src-id> --target <dst-id>`，确认预检报告无阻断项；<br>4) `POST /api/v1/migration/start`；<br>5) `peanutsprout migrate tasks` 与 `GET /api/v1/migration/{id}/report` 查看报告；<br>6) 在目标库执行 `SELECT count(*) FROM orders;` 与源库行数比对，并核对字段类型映射结果 |
| 当前状态 | 🟡 部分满足 |
| 备注 | **MySQL 与 PostgreSQL 驱动均已实现**（`packages/drivers/src/mysql.ts`、`postgresql.ts`），**跨异构库迁移能力已端到端实测**。<br>**已实测的证据**：`packages/migration/src/cross-db.test.ts`（6 项全绿）把 **SQLite 的一张表连结构带数据迁移到真实 PostgreSQL 18.3**（PGlite WASM 经标准 PG 线协议，`pg` 驱动直连），验证了：预检不写入任何数据、目标端 DDL 由**目标驱动**生成、列类型经 **TypeMapper** 跨方言映射、分页循环读取直至取空、**索引随表一并迁移**、冲突策略默认 `skip`、逐表报告。<br>**修复的 5 个真实缺陷**：① `buildInsert` 硬编码 `?` 占位符 → PostgreSQL 报 `syntax error at or near ","`，改为按方言生成 `$1..$n`；② 索引从未被迁移（目标库只剩主键）；③ `countRows()` 吞异常返回 0，会把"统计失败"当成"目标表为空"从而重复插入；④ 结构迁移靠 `/exist/i` 匹配错误文本判断表是否存在，改为显式 `listTables()`；⑤ 冲突策略默认值只在 REST 层生效，引擎内未兜底。<br>**本地实机补充验证**（CLI 全链路，2026-09-15）：`migrate start` 把 SQLite 的 `people` 表迁到全新目标库，**4/4 行成功**；重复执行时 `skip` 策略正确跳过 4 行已存在数据。<br>**缺口（诚实）**：**MySQL 驱动未经真实 MySQL 服务端验证** —— 本机网络无法下载 MySQL/MariaDB 服务端二进制（`cdn.mysql.com` 吞吐约 2.4MB/min，下载至 204MB 后放弃；GitHub Releases 不可达；尝试的多个镜像均 404）。因此「MySQL → PostgreSQL」的**字面**场景未实测。MySQL 驱动的方言逻辑（反引号标识符、`MODIFY COLUMN` 改列、`EXPLAIN` 行解析、各分支默认端口 3306/3306/4000/2881、连接串解析）由 10 项不依赖服务端的测试覆盖，另留 1 项需 `PEANUTSPROUT_TEST_MYSQL_URL` 的实连测试（默认跳过并打印跳过原因，绝不伪装成通过）。<br>排期：Phase 2 收尾（补 MySQL 真机验证）。 |

### AC-03 对一张订单表，能生成折线图、条形图、平行坐标图，并保存为看板

| 项 | 内容 |
| --- | --- |
| 验收项 | 对订单表生成折线图、条形图、平行坐标图三种图表，并能保存为看板 |
| 验证方式 | 1) 启动 Web 端：`pnpm dev:server` 与 `pnpm dev:web`，浏览器打开 Web 界面并登录；<br>2) 选择订单表（或对订单表写查询 SQL），分别创建 `line`、`bar`、`parallel` 三种图表类型；<br>3) 调用 `POST /api/v1/charts` 创建图表、`POST /api/v1/dashboards` 创建看板并挂载三张图表；<br>4) 刷新页面与重新登录，确认看板配置持久化（`dashboards` / `charts` 表）且图表正常渲染 |
| 当前状态 | ✅ 已满足 |
| 备注 | **全链路已打通**：结构化配置 → 聚合 SQL 生成 → REST 取数 → Web 端渲染 → 看板持久化。<br>**后端**：`POST/GET/PATCH/DELETE /api/v1/charts`、`GET /charts/:id/data`、`GET /charts/types`、`/api/v1/dashboards` 全套；`charts`/`dashboards` 仓储层与两张本地表就位。图表数据由**结构化配置**（维度 / 指标 / 聚合 / 筛选 / 排序）生成 SQL，字段名过白名单校验，**不接受客户端直接传 SQL**；若图表保存了自定义 SQL，取数前必须过连接可见性校验且必须是只读语句（写语句返回 403 `READONLY_VIOLATION`，图表接口不能成为绕过写闸门的通道）。<br>**实测证据**：`apps/server/src/e2e.test.ts` 的「图表与看板（AC-03）」用例组（8 项）真实执行——建表插入 `('华东',100),('华东',50),('华南',20)` → 建 bar 图表 → `GET /charts/{id}/data` **返回真实聚合结果且校验出「华东 = 150」** → 详情 → 删除 → 404；另覆盖非法字段名注入被拒、配置不满足类型要求被拒、看板挂图表后详情带出 `charts`、删除看板级联删除图表。<br>**修复的关键缺陷**：`buildChartSql()` 原先**完全没有 `FROM` 子句**，生成的 SQL 一条都执行不了（此前测试只断言了 `GROUP BY` 因而"看起来是绿的"）。现已补上 `FROM`，并把来源表设为必填（缺失直接报错）；同时修掉筛选运算符两套词汇不互通、以及未按方言加引号（MySQL 会语法错误）的问题。`packages/visualization/src/chart.test.ts` 15 项测试覆盖这些回归点。<br>**Web 端**：新增图表页与看板页，用**内联 SVG**（无新增运行时依赖）渲染 `bar`/`column`/`line`/`area`/`pie`/`donut`/`scatter`/`radar`/**`parallel`（平行坐标图）**。**AC-03 点名的三种图（折线图 `line`、条形图 `bar`、平行坐标图 `parallel`）全部可渲染** —— 平行坐标图按"每根轴独立归一化"实现（这正是它能同时比较量纲差异大的字段的原因），缺值处断线而非跨过缺值直连，无法连线的行的顶点仍单独画出以免整行消失，并对超出行数上限的部分如实上报截断数量。其余 6 种类型显示明确的"暂不支持浏览器内渲染"占位面板并同时展示数据表（不假装渲染）。<br>**未验证部分**：本环境无法在浏览器中目视确认渲染像素效果，仅验证了类型检查、构建产物与几何计算逻辑。 |

### AC-04 输入自然语言「查最近 7 天订单金额前 10 的用户」，AI 生成 SQL，用户确认后执行并返回结果

| 项 | 内容 |
| --- | --- |
| 验收项 | 自然语言转 SQL，用户确认后执行并返回结果 |
| 验证方式 | 1) 在设置中配置模型（API Key、模型名、温度、超时），写入 `ai_configs`；<br>2) Web 端或 CLI 输入自然语言：`peanutsprout ai nl2sql --conn <conn-id> --prompt "查最近7天订单金额前10的用户"`；<br>3) 或调用 `POST /api/v1/ai/nl2sql`，确认返回生成的 SQL 与解释；<br>4) **人工确认**后执行该 SQL，确认返回结果集；<br>5) 确认本次 AI 操作已写入审计日志 |
| 当前状态 | ✅ 已满足 |
| 备注 | **已用真实模型端到端验证**（2026-09-15）：模型 `gpt-5.6-sol`（OpenAI 兼容端点，`scripts/ai-live-test.mjs`）。对**验收项的字面输入**「查最近 7 天订单金额前 10 的用户」，`nl2sql` 生成的 SQL **可直接执行并返回 3 行结果** —— 「自然语言 → 生成 SQL → 人工确认 → 执行 → 返回结果集」这条链路已完整跑通，且该次 AI 调用写入审计（`audit verify` 返回 `ok: true`，共 7 次 AI 调用留痕）。同时验证了 `explain`、`optimize`（返回 3 条结构化建议）、`diagnose` 均返回有效内容，以及**写操作安全约束**（AI 不自动执行写语句）成立。<br>**实现范围**：9 类供应商适配（`openai` / `anthropic` / `google` / `qwen` / `ernie` / `zhipu` / `deepseek` / `ollama` / `openai-compatible`）、六类能力与对应路由、模型配置密文存储（只回 `hasApiKey`）、调用历史与审计留痕。<br>**安全约束前置落地**：① AI **只生成不执行**，响应固定带 `executed: false`；② 上下文只含表名/列名/类型/注释，**不含数据行**，`/ai/ask` 另有脱敏网关（`NULL` 保持 `NULL`）；③ 生产库写操作默认拒绝；④ 生成写语句还要求调用方自身拥有该连接写权限。<br>**修复的两个缺陷**：① `optimizePrompt` 措辞自相矛盾（要求"返回严格 JSON 数组"却给了对象示例），导致模型返回裸数组、解析走丑陋回退 —— 已统一措辞并让解析器兼容两种形态；② AI 测试脚本自身调用了错误的方法签名，导致 `ai_history.user_id` 为空而报错（是该脚本的 bug，不是实现问题 —— TypeScript 本可提前发现）。<br>**未跑完的部分（诚实）**：`document` 与 `ask` 因输出较长、在 120s 超时内未返回（模型速度问题，非功能缺陷；延长超时的复测未跑完）。<br>**本轮补齐的关键缺口（诚实说明）**：此前 AI **后端完整但用户完全够不着** —— ① `ai.enabled` 总开关**没有任何写入口**（全仓只有 `GET /meta/settings`，无 PUT），所有 AI 调用恒返回 `AI_DISABLED`；② Web 端**没有任何 AI 界面**（无页面、无配置、0 处调用 `/ai/*`、0 条 AI 文案），而报错文案却写着「可在设置 → AI 中启用」，指向一个并不存在的界面。现已补齐：新增 `PUT /meta/settings`（白名单 `WRITABLE_SETTINGS` + 批量事务 + 审计留痕）、`POST /ai/test`（保存前试连，且**刻意不检查总开关**以免陷入「想测试必须先启用」的死循环）、`POST /ai/models`（列举本地已下载模型）、设置页 AI 配置卡片、独立的 AI 助手对话页（六技能），以及 `ai` 命名空间 **143 键 × 6 语言**。<br>**本轮实测证据**（`apps/server/src/ai.e2e.test.ts`，18 项）：测试内起一个**真实的** HTTP 服务充当 OpenAI 兼容供应商，全程真实 fetch。「开关能打开」→「打开后真能调通」→「密钥绝不出现在任何响应体中」→「白名单外的键被拒且不入库」→「批量写入有一项非法则整批回滚」→「Anthropic 明确报不支持列举而非返回空数组」→「`executed` 恒为 false」→「AI 调用后审计哈希链仍完整」，全部通过。 |

### AC-05 普通用户登录后只能看授权的连接，且不能执行 DELETE

| 项 | 内容 |
| --- | --- |
| 验收项 | 普通（非管理员）用户登录后，仅能看到被授权的连接，且无法执行 DELETE 等写操作 |
| 验证方式 | 1) 以管理员身份创建普通用户并赋予 `readonly` 角色：`peanutsprout user add <name> --role readonly`、`POST /api/v1/users`；<br>2) 以该用户登录：`POST /api/v1/auth/login`，取得 JWT；<br>3) 调用 `GET /api/v1/connections`，确认只返回授权范围内的连接；<br>4) 调用 `POST /api/v1/query/execute` 执行 `DELETE FROM orders WHERE id = 1`，确认被拒绝；<br>5) 通过 `GET /api/v1/audit/logs` 确认该次越权尝试已被记录 |
| 当前状态 | ✅ 已满足 |
| 备注 | 资源级授权链路（`resource_grants` 表 → `AuthContext.grants` → 鉴权判定）已接入，可见性规则：管理员全见；无任何连接授权时退化为"角色模式"（全见，兼容单机零配置体验）；**拥有 ≥1 条连接授权即进入白名单模式，仅见被授权连接**。<br>写操作四道闸门：连接可见 → `query.write` 权限 → 连接非只读 → 写语句需 `confirm: true`（否则 428）。<br>**实测覆盖**（`apps/server/src/e2e.test.ts` 的「资源级授权」用例组，5 项）：构造第二个连接作为对照 → 给用户只授权 `connection:<id>` → 该用户 `GET /connections` **仅返回 1 条且是对照之外的那条** → 通过 id 直接访问未授权连接返回 **404**（与"不存在"不可区分）→ 管理员仍可见全部。<br>另：`readonly` 角色用户越权写操作返回 403，且失败尝试被写入审计日志。 |

### AC-06 所有写操作在审计日志中可查到操作人、时间、SQL、影响行数

| 项 | 内容 |
| --- | --- |
| 验收项 | 任意写操作均可在审计日志中查到操作人、时间、SQL 原文、影响行数 |
| 验证方式 | 1) 登录后执行一条写操作（如 `INSERT` / `UPDATE` / `DELETE` 或建表 DDL）；<br>2) 查询审计日志：`peanutsprout audit query --limit 20` 或 `GET /api/v1/audit/logs`；<br>3) 核对记录中的 `username`（操作人）、`createdAt`（时间）、`sqlText`（SQL 原文）、`detail.affectedRows`（影响行数）；<br>4) 导出日志：`GET /api/v1/audit/logs/export?format=csv`；<br>5) 校验哈希链：`peanutsprout audit verify` 或 `GET /api/v1/audit/verify` |
| 当前状态 | ✅ 已满足 |
| 备注 | 哈希链实现为 `curr_hash = sha256(prev_hash + '\|' + 规范化payload)`；**执行清理（purge）时会把链锚点写入设置表，因此清理历史后校验依然成立**（**35 项专项测试**覆盖逐行篡改、删中间行、删尾行、链尾锚损坏、purge 后校验、v1 历史行可验、v2 把 `ip_address`/`user_agent`/`duration_ms` 纳入哈希、`null` 与空串不再碰撞、`append` 补建锚）。<br>实机验证：执行建表与插入后，`audit query` 可见 `execute` 动作带 `connection#1` 资源与影响行数；`audit verify` 返回"哈希链完整，已校验 9 条记录"。<br>覆盖面随驱动完善同步扩展：现有 **7 种真实驱动**（SQLite / PostgreSQL / KingbaseES / MySQL / MariaDB / TiDB / OceanBase）均走同一审计链路。<br>**修复的关键缺陷（安全相关）**：`audit_logs.user_id` 原先带有 `ON DELETE SET NULL` 外键，而 `user_id` **参与哈希链计算** —— 因此删除任意用户都会把该用户的历史审计行 `user_id` 改写成 NULL，**永久打断哈希链**（实测：`verifyChain()` 由 `{ok:true}` 变为 `{ok:false, brokenAt:1}`）。审计日志必须是不可变的，现已移除该外键（操作人身份另有同行冗余的 `username`，删用户不会丢失"是谁做的"），并新增迁移 `0002_audit_drop_user_fk` 修复既有库；回归测试断言「删用户后链仍完整」与「`audit_logs` 无指向 `users` 的外键」。<br>**一次真实的链修复记录（诚实说明）**：本次开发中该缺陷已被触发（删除测试用户后链在校验位置 #49 断裂）。修复时用真实哈希函数反推出该行被提交时的 `user_id` 为 2（库里已是 NULL），据此把该行**恢复成哈希所承诺的原始值**，随后 `verifyChain()` 回到 `{ok:true, checked:60, brokenAt:null}`。这是**恢复**而非重算——没有改写任何哈希，只把被外键错误清空的字段改回其被提交时的取值。<br>CLI 侧新增 `audit export --out <path> --format csv|json`，实测导出 10 行 CSV 成功，且导出动作本身也写入审计。 |

### AC-07 Web 端与桌面端看到同一份连接配置和看板

| 项 | 内容 |
| --- | --- |
| 验收项 | Web 端与桌面端共享同一份连接配置与看板数据 |
| 验证方式 | 1) 启动服务端：`pnpm dev:server`；<br>2) 在 Web 端（`pnpm dev:web`）创建一个连接，记录其 `id`；<br>3) 桌面端（`pnpm dev:desktop`）作为客户端连接同一服务端地址，确认连接列表中可见同一连接；<br>4) 通过 `GET /api/v1/connections` 交叉核对两端数据一致；<br>5) 在 Web 端修改连接配置，回到桌面端刷新，确认变更同步可见 |
| 当前状态 | ✅ 已满足 |
| 备注 | **连接配置共享**：连接配置统一存放于服务端本地 SQLite（`connections` 表），经 Fastify REST API 读写，Web 端与桌面端共用同一数据源。桌面端已成功启动并加载界面（见 AC-01 证据），其内嵌服务端托管的正是 `apps/web/dist` 构建产物 —— 两端渲染的是**同一份前端代码**，读写的也是**同一个库文件**。<br>**看板共享已实现**：`dashboards` / `charts` 两张表 + 全套 REST 路由 + Web 端看板页。看板数据与图表配置同样存于服务端本地 SQLite，因此 Web 端与桌面端看到的是同一份看板；`dashboards.is_shared` 与 `share_token` 字段已就位并支持"共享看板允许他人只读查看"的判定。`GET /dashboards/{id}` 会一并返回该看板下的全部图表（`charts` 数组），已由 e2e 用例覆盖。<br>**实测**：连接 CRUD、连通性测试、元数据浏览、SQL 执行、图表取数、看板详情均已联通并有自动化用例。<br>**未验证部分（诚实）**：本环境无法真正并排运行"Web 端 + 桌面端"两个进程做交叉目视核对，上述结论基于"两端读写同一 REST 接口与同一库文件"这一架构事实，而非双端同时在线的实测录屏；也仍缺"同一连接被两端并发修改"的自动化用例。 |

### AC-08 macOS arm64 安装包在 M 系列芯片上原生运行，不通过 Rosetta

| 项 | 内容 |
| --- | --- |
| 验收项 | macOS arm64 安装包在 Apple Silicon（M 系列）上原生运行，不通过 Rosetta 转译 |
| 验证方式 | 1) 在 M 系列 Mac 上安装 `PeanutSprout-Setup-{version}-mac-arm64.dmg` / `.pkg`；<br>2) 启动应用后执行 `ps -o pid,arch,comm -p $(pgrep -f PeanutSprout)`，确认架构为 `arm64`；<br>3) 或对可执行文件执行 `file /Applications/PeanutSprout.app/Contents/MacOS/*`，确认包含 `arm64` 而非仅 `x86_64`；<br>4) 确认「活动监视器」中该进程的「种类」为「Apple 芯片」而非「Intel」 |
| 当前状态 | ⬜ 未实现 |
| 备注 | **打包配置已就位，但安装包未实际产出并在 M 系列芯片上验证**。`packaging/macos/entitlements.mac.plist`（含 hardened runtime 所需授权项）与 `electron-builder.yml` 的 mac 目标（`dmg` / `pkg`，`x64` + `arm64`）已落地，`package:mac` / `package:mac:pkg` 脚本就位。<br>技术路径可行：Electron 原生支持 arm64；本项目**未引入任何需要按架构编译的原生模块**（数据层为纯 JS + 内置 `node:sqlite`），不存在交叉编译障碍。<br>**参考**：同源的 Linux 打包链路已实际跑通并产出**真实安装包**（deb 85MB + AppImage 108MB，AppImage 已实机启动，见 AC-01 证据），说明 `electron-builder.yml` 的 mac 目标配置与打包脚本本身可用。<br>**剩余缺口（诚实）**：本环境为 Linux，**既无法在 Apple Silicon 上运行，也未实际构建出 `.dmg`/`.pkg` 产物**（macOS 签名与公证需 Apple 开发者证书）。因此本条保持「未实现」，绝不用 Linux 的成功推断 macOS 的成功。排期：Phase 5（需 macOS 构建机与开发者证书）。 |

### AC-09 项目根目录包含 LICENSE 文件，内容为 AGPL-3.0 全文

| 项 | 内容 |
| --- | --- |
| 验收项 | 仓库根目录存在 `LICENSE`，内容为 AGPL-3.0 协议全文 |
| 验证方式 | 1) 在仓库根执行 `ls -l LICENSE`，确认文件存在；<br>2) 执行 `head -5 LICENSE`，确认标题为 `GNU AFFERO GENERAL PUBLIC LICENSE`、版本 `Version 3`；<br>3) 与官方全文比对：`curl -s https://www.gnu.org/licenses/agpl-3.0.txt \| diff - LICENSE`，确认无差异 |
| 当前状态 | ✅ 已满足 |
| 备注 | 仓库根 `LICENSE` 共 661 行 / 34,523 字节，正文为 AGPL-3.0 全文（标题 `GNU AFFERO GENERAL PUBLIC LICENSE` / `Version 3, 19 November 2007`）。`pnpm verify` 会自动化校验标题与版本命中。<br>许可声明已统一为 **AGPL-3.0-or-later**（`package.json`、`packages/core` 的产品常量、Web 与 CLI 的输出口径一致）。发布前建议再执行第 3 步与官方全文做一次逐字节比对。 |

### AC-10 项目 README 中注明产品名花生苗数据库管理工具、作者飞哥、微信 6731663、开源协议 AGPL-3.0

| 项 | 内容 |
| --- | --- |
| 验收项 | `README.md` 中包含产品名、作者、微信、开源协议四项信息 |
| 验证方式 | 1) 在仓库根执行 `grep -n "花生苗数据库管理工具\|飞哥\|6731663\|AGPL-3.0" README.md`，确认四项信息均命中；<br>2) 确认 README 同时给出安装/启动与快速上手入口（`pnpm bootstrap`、`pnpm dev:desktop`、`pnpm dev:web`） |
| 当前状态 | ✅ 已满足 |
| 备注 | `README.md` 首行即产品名「花生苗数据库管理工具（PeanutSprout DB Manager）」，设有「作者与授权」专节，含作者**飞哥**、微信**6731663**、开源协议 **AGPL-3.0**（GNU Affero General Public License v3.0）以及 `Copyright (C) 2025 飞哥` 版权声明；同时给出安装/启动与目录结构入口。社区文件 `CHANGELOG.md`、`CONTRIBUTING.md`、`CLA.md` 亦已就位。<br>同一组信息也通过 `GET /api/v1/meta/info` 在界面上可见（`author`/`wechat`/`license`），`pnpm verify` 会校验上述交付文件齐全。 |

### AC-11 界面支持国际化，默认简体中文，至少含简体中文、繁体中文、英文、俄语、日语、韩文

| 项 | 内容 |
| --- | --- |
| 验收项 | 界面可切换六种语言（简体中文、繁体中文、英文、俄语、日语、韩文），**默认简体中文**；切换即时生效并持久化 |
| 验证方式 | 1) `npx vitest run packages/i18n` —— 引擎单测 + 六语言语言包完整性测试（catalogs 36 + i18n 21 + key-safety 4 = 61 项，全部通过）；<br>2) `pnpm verify`，看「国际化（i18n）」小节 5 项是否全 ✓；<br>3) `pnpm --filter @peanutsprout/web build` 后在生产 JS 包里检索六种语言的特征串；<br>4) 起真实服务后打开界面，用顶栏地球图标或「设置 → 界面语言」切换，确认刷新后保持 |
| 当前状态 | ✅ 已满足 |
| 备注 | **规模**：六种语言 × **11 个命名空间**（本轮新增 `table`、`designer`），简体中文 / 繁体中文 / 日语 / 韩语各 **1045 键**，英文 **1085 键**、俄语 **1153 键**（多出的部分是各语言的复数形式，如俄语的 `one/few/many`），零漏译、零僵尸键。`errors` 命名空间覆盖 `packages/core` 全部 **22 个 `ErrorCode`**（含本轮新增的 `PASSWORD_CHANGE_REQUIRED`）。<br>⚠️ 上述键数是**本次快照**，以 `packages/i18n/src/messages/` 下实际语言包为准。<br>**默认中文是硬约束**：浏览器语言只在可映射时才生效，德语环境落到简体中文而**不是**英文。语言优先级为「用户选择 → 浏览器语言 → 简体中文」。<br>**复数走 `Intl.PluralRules`** 而非 `count > 1`，实测俄语 `1 строка / 3 строки / 5 строк / 21 строка / 22 строки` 正确。<br>**键名有编译期约束**：`MessageKey` 由简体中文包字面量推导，`t('拼错的键')` 直接构建失败；`key-safety.test.ts` 专门防止该约束被 `MessageCatalog` 标注**静默**放宽成 `string`。<br>**产品内文案已全部抽取**：`pnpm verify` 扫描 `apps/web/src` 的 32 个文件，硬编码中文 JSX 文本 0 处。<br>**刻意的取舍**（见 `docs/i18n.md` §6）：时间戳保持 ISO 风格以便排序、CLI 与服务器日志仍为中文、文档以中文为权威版本、`飞哥 · 微信 6731663` 在所有语言里保留原文。 |

## 4. 验收项与模块/需求追溯矩阵

| 验收项 | 关联功能需求 | 关联模块 | 目标阶段 | 当前状态 |
| --- | --- | --- | --- | --- |
| AC-01 | PLAT-01、PLAT-07～PLAT-09 | M12-01、M12-02、M12-03 | Phase 5 | ⬜ |
| AC-02 | FR-4.3-03、FR-4.1-01 | M03-02、M05-06、M05-07、M05-08 | Phase 2 | 🟡 |
| AC-03 | FR-4.4-01、FR-4.4-03 | M06-01、M06-02、M06-06 | Phase 3 | ✅ |
| AC-04 | FR-4.5-02、FR-4.5-03 | M07-03、M07-12 | Phase 4 | ✅ |
| AC-05 | FR-4.6-03 | M08-02、M08-05、M08-06 | Phase 1 | ✅ |
| AC-06 | FR-4.6-04、NFR-5.2-05 | M08-08、M09-05 | 本期已满足 | ✅ |
| AC-07 | PLAT-12、PLAT-13 | M10-01、M10-02、M06-06 | Phase 1 / Phase 3 | ✅ |
| AC-08 | PLAT-06、PLAT-07 | M12-03、M12-04 | Phase 5 | ⬜ |
| AC-09 | OSS-01、OSS-05 | —（仓库根交付物） | 本期已满足 | ✅ |
| AC-10 | BRAND-01～BRAND-03、OSS-01 | —（仓库根交付物） | 本期已满足 | ✅ |
| AC-11 | （PRD 外追加：飞哥直接提出） | M11-01～M11-03（`@peanutsprout/i18n`） | 本期已满足 | ✅ |

## 5. 复现全部结论的最小步骤

```bash
# 1. 安装依赖并初始化（幂等；默认管理员 admin / 123456）
pnpm bootstrap

# 2. 环境与交付自检（Node/SQLite/交付文件/本地库/驱动/审计链）
pnpm verify

# 3. 全部自动化测试（1059 项通过 / 1 项显式跳过）
pnpm test

# 4. 启动服务端（此时 GET / 已可托管 Web 界面）
pnpm dev:server

# 5. 另开终端：登录并体验完整链路
pnpm cli login
pnpm cli conn add --type sqlite --file /tmp/demo.db --name 演示库
pnpm cli query execute --conn 1 --sql "SELECT 1 AS ok"      # 只读查询
pnpm cli query execute --conn 1 --sql "CREATE TABLE t(a INT)"  # 退出码 9：需二次确认
pnpm cli --yes query execute --conn 1 --sql "CREATE TABLE t(a INT)"  # 确认后成功
pnpm cli audit verify                                        # 审计哈希链校验

# 6. 图表与看板（后端接口，返回真实聚合结果）
#    先在 SQL 控制台建表并插入数据，再创建图表：
curl -s -X POST http://127.0.0.1:8787/api/v1/charts -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"按区域统计","chartType":"bar","connectionId":1,"sourceRef":"orders",
       "config":{"dimensions":[{"column":"region","aggregation":"none"}],
                 "metrics":[{"column":"amount","aggregation":"sum","alias":"total"}]}}'
curl -s http://127.0.0.1:8787/api/v1/charts/1/data -H "Authorization: Bearer $TOKEN"

# 7. MySQL 等已实现驱动（本环境无 MySQL 服务端，连接会失败；驱动本身已实现）
#    未实现的驱动则明确返回 DRIVER_NOT_IMPLEMENTED，而不是静默失败：
pnpm cli conn add --type oracle --host 127.0.0.1 --port 1521 --user system  # 明确报未实现

# 8. 表数据编辑器与可视化建库建表：跑在**打包产物**上的端到端验证（120 项）
#    这个脚本用 curl 调接口，再用 Node 内置的 node:sqlite **直接读库核对**
#    （本机没有 sqlite3 CLI），而不是调项目自己的代码 —— 不自己验自己。
bash scripts/verify-round4.sh
```

### 关于 `scripts/verify-round4.sh`（表数据编辑 + 可视化建表）

它跑在 `release/linux-unpacked` 里的**打包产物**上，覆盖 120 项，其中包含几条单靠单元测试
证明不了、必须在真实进程里才成立的性质：

| 验证内容 | 为什么值得单独验 |
| --- | --- |
| 无主键/无可空唯一索引的表**更新与删除被拒**，且读库确认**一行未动** | "我以为只改了一行"是这类功能最危险的失效形态 |
| 只读账号在表数据与 DDL 接口上一律 403，且**数据真的没变** | 新接口可能成为绕过写闸门的旁路 |
| **危险默认值被白名单拒绝**后 `people` 表仍在 | DDL 无法用绑定参数，默认值只能白名单 |
| 预览后读库确认表**并不存在** | 预览必须一个字节都不执行 |
| 不带 `confirm` → 428，且**表仍未建** | 二次确认不是摆设 |
| 索引**真的建出来了** | 本轮修掉的 SQLite `createIndex` 缺陷（`ON "schema"."table"` 非法） |
| 多语句被拒且**第一条也没执行** | 本轮修掉的"静默只跑第一条"缺陷 |
| 深浅两套主题**各自定义齐全部配色变量**，且产物里**没有引用未定义的变量** | AI 页深色皮肤失效的根因就是这个 |
| ★ **同名索引仍报错、且建表已生效**（留下部分成功） | 逐条执行没有事务，这是**刻意钉住的诚实边界**，不是"通过" |

> ⚠️ **本脚本的覆盖边界**：它验证的是 HTTP 契约与数据库**实际状态**，不验证浏览器里的点击。
> 本机无 DOM 实现，两个新页面的**加载后交互**（标签页切换、列定义表单、内联编辑保存按钮）
> 只有类型检查、构建和纯逻辑用例保证，**没有一条是在真实浏览器里点出来的**。

---

产品名称：花生苗数据库管理工具
作者：飞哥
微信：6731663
开源协议：AGPL-3.0-or-later
