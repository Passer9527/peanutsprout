# 更新日志（Changelog）

本项目的所有重要变更都会记录在本文件中。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本（Semantic Versioning）](https://semver.org/lang/zh-CN/)。

---

## 第四轮：表数据编辑器、可视化建库建表、深色皮肤不跟随换肤的根因修复

需求原文：「还差一个功能，就是选中一个表，可以像 excel 一样，操作这张表。删除、插入、修改、查看记录。
也差可视化构建数据库和表。添加上去，还有就是 ai 助手，在黑色 ui 皮肤时，没有跟随转换模式。继续」

### 新增

- **表数据编辑器**（`/data/table/*`，5 个接口 + `apps/web/src/pages/TableDataPage.tsx`）。
  选中一张表后可以像操作表格一样分页查看、内联改单元格、插入行、删除行。
  **更新/删除必须能精确指向一行**，所以服务端自己解析"定位符"：优先主键；没有主键时退到
  一个**唯一索引且其全部列都 `NOT NULL`**；两者都没有时 `kind: 'none'`，
  **明确拒绝更新与删除，只允许读取与新增**，并把原因回给界面显示。
  绝不退化成"按内容模糊匹配" —— 那会在用户只看到改了一行的情况下悄悄改掉多行。
  受影响行数不是 1 就报错（0 → `NOT_FOUND`，>1 → `CONFLICT` 并中止），
  让"悄悄改了多行"暴露出来而不是回一个"成功"。
- **可视化建库建表**（`/ddl/*`，5 个接口 + `apps/web/src/pages/TableDesignerPage.tsx`）。
  三个页签：建库/Schema、建表（列定义 + 索引 + `IF NOT EXISTS`）、已有表（含删表）。
  **预览与执行彻底分开**：`/ddl/preview` 只返回语句文本、一个字节都不发给数据库；
  `/ddl/execute` 要求 `confirm: true` 否则 428，并走与 SQL 开发页相同的写闸门。
  界面必须先生成预览、且预览对应当前表单（指纹一致）才允许执行。
- **导航新增两项**（表数据 / 建库建表），并在 `apps/web/src/state/view.ts` 里加了
  `table` 与 `designer` 两个 `ViewKey`。
- **新增两个 i18n 命名空间** `table`（47 键）与 `designer`（66 键）× 6 种语言。
  源语言包 1045 键，六语零漏译。

### 修复（本轮自查发现的缺陷）

- **深色皮肤下 AI 助手页不跟随换肤 —— 根因不是"少写了一处深色样式"**。
  AI 页与语言菜单那一整块 CSS 引用了 **8 个从未定义过的变量名**
  （`--surface-1` / `--surface-2` / `--surface-3` / `--border-1` / `--bg-2` /
  `--text-1` / `--text-muted` / `--accent-1`），与项目真正使用的 `--color-*` 是**两套命名**。
  CSS 里 `var(--不存在, #fff)` **不会报错**，它会静默使用括号里的浅色回退值 ——
  于是深色皮肤下依然白底黑字，而且 `tsc`、`vite build`、皮肤切换**全都不报任何错**。
  已统一改回 `--color-*`，并补上真正缺失的蓝色强调色 `--color-accent`。
- **对照色在深色主题下可读性不足**。`--color-danger` 在深色下被提亮成浅红，
  白字对比度只有 **3.1:1**（低于 WCAG AA 的 4.5:1）。已引入
  `--color-danger-contrast` / `--color-accent-contrast`，深色主题下改用深色文字
  （对比度 6.09:1 / 5.86:1）。浅色主题的品牌绿上白字是 3.43:1，
  未达 AA 正文标准 —— 那是飞哥指定的品牌色，**没有擅自改**，只把这条取舍写进测试注释。
- **SQLite 驱动 `createIndex` 生成非法 SQL**：写成 `ON "schema"."table"`，
  而 SQLite 的语法要求 schema 限定在**索引名**上。结果是"只要 schema 不为空，建索引一定失败"
  （`near ".": syntax error`）。因为此前没有表设计器，这条路径从没被真正跑过。
  `dropIndex` 有同类问题，一并修正。**旧测试只断言字符串里有没有 `CREATE TABLE`，
  根本查不出这个问题** —— 已改为新增用例把生成的 DDL **真的执行一遍**。
- **`node:sqlite` 的 `prepare()` 会静默接受多语句、只执行第一条**，其余无声丢弃
  （实测：`CREATE TABLE t (a);\nCREATE INDEX ix ON t (a);` 建出了表、索引根本没建，
  `changes` 是 0，一切"成功"）。这是最坏的失败形态：静默给出错误结果。
  现在检测到多语句即报 `VALIDATION_FAILED` 并说明提交了几条，
  与 MySQL 驱动（`multipleStatements: false`）的行为对齐。
- **`/data/table/rows` 的 `LIMIT`/`OFFSET` 漏传绑定参数**（自查时用例直接报
  `datatype mismatch` 才发现），已改为走 `QueryOptions.params`。

### 变更（可能影响既有行为）

- **SQLite 上一次提交多条语句从"静默只执行第一条"变为"明确报错"**。
  受影响的入口是 SQL 开发页：以前粘贴一个脚本只会跑第一句且不报错，
  现在会得到"一次只执行一条语句（本次提交了 N 条）"。这是**刻意的行为变更** ——
  把静默的错误结果换成响亮的拒绝。CLI 与迁移引擎本来就逐条执行，不受影响。

### 测试

- 测试文件 **50 → 55 个**，用例 **806 通过 / 1 跳过 → 1059 通过 / 1 跳过**。
  新增：`table-data.e2e.test.ts`（94）、`tableDesigner.test.ts`（79）、
  `tableData.test.ts`（54）、`newPagesRender.test.ts`（9）、`theme.test.ts`（8）；
  `sqlite.test.ts` 29 → 38。
- **`theme.test.ts` 专门守住这次那个"静默失效"类缺陷**：① 引用的每个 CSS 变量都必须有定义；
  ② `--color-*`/`--chart-*`/`--shadow-*` 必须在深浅两套里都定义；③ 主题块之外不得出现
  颜色字面量。三条都验证过能真的失败（把 AI 页一处改回旧变量名 → 3 项失败；
  只在浅色加变量 → 2 项失败；业务样式里写死 `#333333` → 1 项失败）。

### 未验证 / 已知边界（如实列出）

- **两个新页面没有在真实浏览器里点过**。本机无 DOM 实现，渲染测试走
  `react-dom/server`，而 SSR **不执行 `useEffect`**；建库建表页首屏停在 loading 分支，
  所以它的标签页/列定义表单/DDL 预览结构**只有类型检查、构建和纯逻辑用例保证**，
  没有渲染断言覆盖。`newPagesRender.test.ts` 里有一条断言专门钉住这个边界。
- 设计器的 `IF NOT EXISTS` 只作用于建表，**索引不幂等**（MySQL 不支持
  `CREATE INDEX IF NOT EXISTS`，只在部分方言上做幂等反而更难预期）。
- 默认值走的是白名单而非完整 SQL 表达式解析：`now()` 这类合法表达式也会被拒。
- 表数据的写操作是**逐行、无事务**的（`QueryExecutor` 没有事务接口）：
  批量保存中途失败会留下已成功的部分，界面会如实报告 `inserted`/`updated`/`deleted` 的实际条数。
- Windows / macOS 安装包与真实 MySQL 服务端在本环境仍无法验证。

---

## 第三轮：AI 对话可控性、数据导出、以及一处"演示得好看"的检查被纠正

需求原文：「在 ai 对话框中，生成 sql 语句后，有一个提问，是自动执行这个语句，还是选择复制这条语句。
另外，已经发送了的信息，能够撤回，也能够撤回到指定的某一次操作。另外，通过 ai 可以导出数据，
导出到 excel 也可以导出到别的数据库，已经发送的信息不要保留在输入框中。」

### 新增

- **生成 SQL 后由用户选择「执行」还是「复制」**。AI 依然**不会自动执行**；
  「执行」走的是与 SQL 开发页**完全相同的写闸门**（权限 / 连接只读 / 资源授权 / 生产库标记），
  写语句缺确认时后端返回 `428 CONFIRMATION_REQUIRED`，界面据此弹出二次确认再重试。
- **消息撤回与「回退到某一次操作」**。撤回不只是清空气泡：它同时删除服务端
  `ai_history` 里对应的记录（`DELETE /ai/history/:id`、`POST /ai/history/rollback`、
  `DELETE /ai/history`），因此"已调用 N 次"与历史列表会同步变小。
  回退还会把**当时的输入原样放回输入框**，否则"回退"和"重新问一遍"没有区别。
  跨用户删除必然失败：SQL 条件带 `user_id`，且"不存在"与"不是我的"返回**逐字节一致**的 404。
- **数据导出**：`POST /data/export/xlsx`（零依赖手写 OOXML，不引入任何 Excel 库）
  与 `POST /data/export/to-connection`（写进另一个库的表，`create`/`append`/`replace` 三种模式）。
  目标连接走 `assertCanWrite`，因此**导出不能用来绕过写保护**；源与目标相同直接拒绝。
- **发送后清空输入框**：只清**本技能用到**的字段（在"解释 SQL"里发完不会顺手抹掉用户
  在另一个技能里填了一半的内容）。

### 修复（本轮自查发现的缺陷）

- **`content-disposition` 中文文件名让接口 500**。HTTP 头只能是 ASCII，把中文连接名
  直接拼进 `filename="…"` 会让 Node 抛 `ERR_INVALID_CHAR` —— 也就是说，**只要连接名是中文，
  导出功能就完全不可用**。改为 RFC 5987：ASCII 回退名 + `filename*=UTF-8''<百分号编码>`。
- **默认 schema 传空串导致 `非法标识符: ""`**。SQLite 的默认 schema 是 `main`、
  PostgreSQL 是 `public`、SQL Server 是 `dbo`，传空串会直接撞上标识符白名单校验。
  已改为与迁移引擎共用同一份 `DB_TYPES[].defaultSchema` 元数据，不再另立一套规则。
- **导出到库的类型换算取错了映射器**：原实现用**目标库**的驱动去映射源库类型，
  等于拿目标库的方言解释源库的类型名。已改为捕获**源连接**的 `getTypeMapper()`。
- **`scripts/verify.mjs` 的改密标记检查读的是历史遗留的全局键**，于是当管理员改过一次
  密码、全局键被清掉之后，即使**默认口令 `123456` 仍然有效**，检查也一直报"通过"。
  已改为按用户读 `readMustChangePassword()`。这条检查此前**静默失效**，
  纠正后立刻在实机上暴露出真实问题：本机开发库的管理员口令并非 `123456`
  （此前口头声称"已还原为 123456"是错误的），已被重置并打开强制改密闸门。
- **回退用的输入快照按引用返回**，调用方原地改写会污染历史快照；
  已改为返回副本（由新增单测钉住）。

### 测试

- 新增 `apps/server/src/data-export.e2e.test.ts`（27）、`apps/server/src/lib/xlsx.test.ts`（28）、
  `apps/web/src/pages/aiConversation.test.ts`（19）、`apps/web/src/pages/aiRender.test.ts`（11）；
  `packages/ai/src/service.test.ts` 3 → 8。
- 本机**没有任何 DOM 实现**（无 jsdom / happy-dom），因此界面交互无法用常规方式测。
  改用 `react-dom/server` 的 `renderToStaticMarkup` 把组件树真实执行一遍
  （覆盖首屏渲染路径，`useEffect` 不跑）。该用例已做**有效性验证**：
  把「复制 SQL」按钮改掉后它确实失败，恢复后通过 —— 不是恒真断言。
- 导出的 `.xlsx` 交给**系统 `unzip -t`** 做 CRC 校验，而不是用自己写的解析器自证；
  目标库行数用原始 `node:sqlite` 独立核对，不经过被测代码。
- 合计 **807 项（806 通过 / 1 跳过；50 个文件）**。

---

## 第二轮：对抗性安全验证发现的缺陷（全部已修复）

第二轮验证不再依赖"读代码找问题"，而是**用真实运行的攻击脚本**去打。下面每条都对应一次真实复现（含数据被改动的实测），并已补上"先破坏→测试失败→恢复→测试通过"的有效性证据。

### 写闸门（最高危：它一漏，四道闸门同时失效）

写闸门只有 `isWriteStatement` 这一道判据，它漏判就等于同时绕过「`query.write` 权限 / 连接只读 / 资源授权 / 二次确认」。以下手法实测都能绕过：

- **PostgreSQL 数据修改 CTE**：`WITH w AS (DELETE FROM t RETURNING *) SELECT count(*) FROM w` 被判定为只读。实测只读账号执行后**数据库真的少了 3 行**（PG 会真正执行 CTE 体里的 DML）。修复：递归分析每个 CTE 体，`AS MATERIALIZED` / `NOT MATERIALIZED` / 递归 CTE 一并处理。
- **`SELECT ... INTO <新表>`**（PG 建表语法）：`into` 不是写动词，实测只读账号用它**建出了表**。已把 `into` 列为写标志（`INSERT INTO` 由 `insert` 命中，不受影响）。
- **MySQL / MariaDB 可执行版本注释**：`/*!50000 DROP TABLE t */` 整条被当注释丢掉，单独一条甚至会被拆成 0 条语句。修复：剥掉 `/*!` 与版本号后**把内部 SQL 留在待判定文本里** —— 同时保证 `SELECT /*!40001 SQL_NO_CACHE */ * FROM t`（mysqldump 的常见写法）不被误拦。
- **MySQL 的 `--` 语义**：MySQL 要求第二个 `-` 后必须是空白/控制字符才算注释，因此 `SELECT 1--1; DROP TABLE t` 是 `SELECT 1-(-1)` 加一条**真的 DROP**；旧实现把它当注释吃掉整行。已按 MySQL 语义修正（PostgreSQL 的 `--注释` 无空格写法会因此被保守判为写，这是刻意取舍）。
- **fail-closed**：解析不出动词时旧实现默认"只读"（全角 `ＤＥＬＥＴＥ`、畸形语句都算）。已改为**无法识别即按写处理**。
- 顺带修正 `EXPLAIN ANALYZE SELECT ...` 的误判（`ANALYZE` 是 EXPLAIN 的语法成分，不是写动词）—— 只读排查语句不能被拦。

`apps/server/src/write-gate.e2e.test.ts`（8 项）在 HTTP 层把每种手法钉死：只读账号一律 403 且**库内数据独立核对仍然一行未少**，管理员提交同一条必须 428，补上 `confirm` 也不能越权。

### 审计

- **哈希链有三列不参与哈希**：`ip_address` / `user_agent` / `duration_ms` 被写进表却不在哈希里，改完链仍报 `ok` —— 审计里"谁在什么 IP 做了什么"因此不可信。已引入**行级 `hash_version`（迁移 0003）**：v1 保持旧算法只用于校验历史行，v2 把这三列纳入。真实库 126 行历史链**依旧完好**。
- **链尾可整行删除而不被发现**：逐行衔接检查对"删掉最后几行"完全无感。已加链尾锚 `settings['audit.chain_tail']`，在 `append`/`purge` 同一事务内推进；老库无锚时不误报、下次写入自动补建。
- **`NULL` 与空串在哈希里碰撞**：v2 用带类型前缀的编码区分（`null ≠ ''`）。
- **被拒绝的写操作完全不进审计**：403 / 428 / `READONLY_VIOLATION` 都不留痕 —— 而"谁试图写却被拦下"正是入侵检测最需要的信号。已补 `status='denied'` 记录（含 `gate` 与 `confirmed`，能区分"提交了写语句但没确认"和"根本没提交"），且不破坏链。
- **诚实边界**：链是无密钥 sha256，任何能写库的人都能整链重算，锚只能检测**局部篡改/删尾**，不能阻止整体重算。本项目**不宣称"不可篡改"**。

### 口令与密钥外泄

- **连接串口令含 `/` 或 `@` 时脱敏整体失效**（旧实现先 `new URL()`，解析失败就退回一条会被 `/` 击穿的正则）。已改为**纯字符串扫描**，userinfo 按最后一个 `@` 切分，脱敏与"能否解析"彻底解耦。
- **查询串里的口令**（`?password=xxx`）被当普通参数**明文**存进 `extra_params`；无 scheme 的 DSN（`user:pass@host/db`）也整体漏过脱敏。已新增提取逻辑：口令抽进加密字段，连接串与 `extraParams` 都不再保留它（`token`/`secret`/`api_key` 等形态一并剔除，但不误伤 `sslkey`）。
- **审计日志与导出**：算哈希前先对 `errorMessage`/`detail` 做凭据清洗，避免口令被永久写进不可变历史。
- **AI 供应商层**：错误详情与**成功内容**都过同一套凭据清洗；敏感参数名清单补全（`api_key`/`access_token`/`token`/`secret`/`auth`…）。
- **驱动层纵深防御**：`resolvePostgresTarget`/`resolveMysqlTarget` 的解析失败消息曾把**原始连接串**拼进错误文本（会一路冒到 HTTP 响应、审计与日志）。脱敏实现已从 storage 上移到 `packages/core`（驱动不该反向依赖存储层），两个驱动的报错现在只保留用户名与主机。

### 授权与枚举

- **`/meta/production-check/:id` 是枚举器**：不存在的连接返回 `200 {production:false,exists:false}`，不可见的连接返回 404 —— 状态码差异可以逐 id 探出"哪些连接存在"。
- **迁移任务 id 可枚举**：`/migration/:id`、`/report`、`/cancel` 对"别人的任务"与"不存在的任务"返回**不同**的错误消息（后者回显 id）。
- 两处都已统一出口：他人资源与不存在资源**逐字节同响应**。
- **一个空转测试**：`security.e2e.test.ts` 里有一条打向从未注册的 `PUT /users/:id/roles`，无论实现对错都会通过（404 恰好符合预期）。已改为真实路由，并加了"接口不存在"护栏，防止将来再写出空转断言。

### 强制改密标记

- `security.must_change_password` 是**全局键**，但含义其实是"引导管理员还在用默认口令"。实测缺陷：**任意其它用户改自己的口令都会把它清成 false**，于是默认口令的 admin 被别人的一次改密顺带解除了强制改密 —— 闸门形同虚设。已改为**按用户**存（`security.must_change_password.<userId>`），并在打开数据库时把老库的全局键迁移成本用户标记（`pnpm verify` 不启动服务，只靠"首次引导"路径迁移是不够的 —— 实测漏过，已修）。全局键继续镜像维护，供整机体检读取。

## [Unreleased]

### 修复（Fixed）— 文档与自检脚本的"检查了但永远不会失败"

- **`scripts/verify.mjs` 的 DDL 一致性检查是假的**：旧实现只断言 `docs/ddl.sql` 里还存在「本文件由 … 自动生成」这行标注，即使文件内容与权威定义（`packages/storage/src/schema/ddl.ts`）完全不一致也照样通过。现改为**真的重新生成一遍并逐字节比对**：`scripts/export-ddl.mjs` 导出可复用的 `buildDdl()`，verify 计算其 sha256 与字节数，与磁盘上的 `docs/ddl.sql` 比对，不一致即 `✖` 并提示运行 `pnpm ddl:export`。已实测：手工向 `docs/ddl.sql` 追加一行建表语句后 verify 失败（文件 18973 字节 ≠ 重新生成 18918 字节），恢复后通过。
- **`scripts/ai-live-test.mjs` 的「写操作只生成不执行」断言被硬编码为 `true`**：无论 AI 是否真的执行了写语句、保护是否失效，这一项都报「通过」，纯属装饰。现改为真正校验：① 生成结果必须是 SQL 文本且**不含任何执行产物字段**（`rows`/`rowCount`/`affectedRows`/`columns`/`truncated`/`executed`）；② 在临时库上比对调用前后的 **orders 行数 / 金额合计 / 表集合**，任何写副作用即失败；③ 若模型没给出写语句，本次不计通过。校验逻辑抽成纯函数 `checkGenerateOnly()` 并新增 `--self-check`（无需网络）与 `--only-safety`；已实测：把校验函数改坏后 `--self-check` 以退出码 1 失败（6 项中仅 1 项通过），恢复后 6/6 通过；真实模型下正常运行通过（1/1），用 `AI_LIVE_SIMULATE_AUTOEXEC=1` 模拟"AI 自动执行"时该场景如实失败（0/1，退出码 1）。

### 修复（Fixed）— 文档与代码对齐（消除"说了做不到"与自相矛盾）

- **API 文档**：补齐 `POST /auth/refresh` 契约；错误码总表补上 `PASSWORD_CHANGE_REQUIRED`（403）与 `QUERY_FAILED`（400），并说明默认口令强制改密闸门只放行 4 个接口；迁移章节按 `packages/migration/src/engine.ts` 重写（`mode` 仅 `full`、分页策略、行级冲突、无主键整表跳过）；新增「图表与看板」章节（`/charts`、`/dashboards` 契约）。
- **部署文档**：全局修正可执行文件名 `psprout` → `peanutsprout`；健康检查路径统一为 `/api/v1/health`；移除不存在的 `serve --init-only/--log-dir/--log-level/--trust-proxy/--tls-*` 等选项（改为环境变量或标 ⬜）；标注 `/api/v1/query/stream`、`/ws`、`diagnose bundle/doctor`、`update download/apply/rollback` 未实现；说明 `apps/server/src/main.ts` 不解析 CLI 参数（容器 `CMD` 传参无效）。
- **安全文档**：`must_change_password` 仅在引导口令为内置默认 `123456` 时置位，并同步 4 接口放行清单；CORS 按 `apps/server/src/app.ts` 的实际行为重写（默认仅本机来源）。
- **CLI 手册 / 架构 / 模块文档**：修正驱动矩阵（7 种真实 + 8 种占位，且 `kingbase`/`mariadb`/`tidb`/`oceanbase` 由 `PostgresDriver`/`MysqlDriver` 复用实现）；把 `--param`、`user role/grant/revoke/session`、`query cancel`、`serve --https`、`completion` 等未实现能力显式标为 ⬜；`ai nl2sql` 不再宣称"`executed` 恒为 false"（返回值里本就没有该字段）。
- **README / 模块文档**：去掉自相矛盾的固定项数（测试数、verify 项数、i18n 键数）改用"以命令输出为准"；日志目录 `logs/` 按实际（stdout/journald）修正；默认管理员口令说明改为区分"内置默认口令"与"自定口令"两种强制改密行为。

### 修复（Fixed）— 反向代理头伪造：审计来源 IP 与按 IP 限流可被绕过

- **`clientIp()` 自行解析 `X-Forwarded-For`，绕过了 Fastify 的 `trustProxy` 机制。** 旧实现（`apps/server/src/http.ts`）无条件优先返回该请求头的首段，于是**不管服务端怎么配置**，任何能直连端口的人只要加一个 `X-Forwarded-For: 1.2.3.4`，就能：① 让审计日志记下伪造的来源 IP（审计证据不可信）；② 靠不断变换该头绕过按 IP 统计的登录失败限流（暴力破解防线失效）。现改为**只取 `req.ip`** —— 是否采信转发头这个决定权完全交给 `trustProxy`，信任决策集中在一处。
- **`trustProxy` 由硬编码 `true` 改为可配置，且默认 `false`。** `true` 的语义是"信任任意来源的转发头"，只适合"后端端口仅反代可达"的部署。现新增配置项 `ServerConfig.trustProxy` 与环境变量 `PEANUTSPROUT_TRUST_PROXY`：不设（默认）→ 不信任；`true`/`1` → 信任全部代理；`10.0.0.0/8,127.0.0.1` → 只信任指定网段（推荐）。无法识别的取值一律退回"不信任"，避免配置写错反而变成全信任。
- 新增 3 项回归测试（`apps/server/src/security.e2e.test.ts`）：默认配置下伪造的 `X-Forwarded-For` **不会**进入审计（审计里是真实对端 `127.0.0.1`）；显式开启后才会采信（证明"默认关闭"是靠配置生效，而不是代码压根不读这个头）；`parseTrustProxy` 的取值语义（含写错时退回不信任）。

### 修复（Fixed）— 桌面端实例身份校验与服务端解耦

- **改用一次性 nonce 确认"端口上应答的是我启动的子进程"。** 此前桌面端靠比对 `/api/v1/meta/info` 回传的 `dataDir` 来确认身份，而该字段本身是信息泄漏（未鉴权接口暴露服务端绝对路径）并已被移除，于是这道校验会永远失败、桌面端无法启动。现改为：主进程每次启动生成 24 字节随机 nonce，经 `PEANUTSPROUT_INSTANCE_NONCE` 传给子进程，服务端在 `/api/v1/health` 中原样回显（**未配置该变量时字段不出现**，普通部署不受影响），主进程据此校验。nonce 每次不同、不落盘、不出现在其它接口，无法伪造。
- 移除随之无用的 `resolveDataDirFromEnv`/`normalizePath`；`port-util.test.ts` 改为覆盖 nonce 校验（含"应答里没有 nonce 也必须拒绝"与"期望值为空一律拒绝"两条边界）。

### 修复（Fixed）— 默认口令强制改密带来的 CLI 死锁

- **全新安装（默认口令 `admin`/`123456`）下，CLI 用户会被永久锁死**：登录本身不受闸门限制所以能成功，但之后每条命令都被 403 `PASSWORD_CHANGE_REQUIRED` 拒绝；而 CLI 当时**没有任何命令**会调用 `POST /auth/change-password`（唯一的 `user passwd <id>` 走的是 `PUT /users/:id`，同样被闸门拒绝），文档却把 `user passwd` 写成了恢复手段。
- 新增顶层命令 **`peanutsprout passwd`** → `POST /auth/change-password`，支持 `--old` / `--new` / `--password-stdin`，并按服务端的 `MIN_PASSWORD_LENGTH` 做前置校验。
- 客户端识别 `PASSWORD_CHANGE_REQUIRED`（退出码 5）并统一追加可操作提示「请先执行：peanutsprout passwd」；`POST /auth/logout` 在放行清单内，已确认可用。
- 新增集成测试 `apps/cli/src/passwd.integration.test.ts`：**真实 Fastify 内存库 + 默认口令引导 + 真实 HTTP**，验证「业务命令被拒 → logout 仍可用 → `passwd` 改密 → 业务恢复 → 旧口令登录失败」完整链路。

### 修复（Fixed）— 若干服务端授权与契约缺陷（本轮全仓复查）

- **修改连接后不释放缓存会话**：`PUT /connections/:id` 更新后界面显示新库，而后续查询仍落在旧库/旧口令上（静默查错库）。现更新后主动 `release()` 该连接的会话池。
- **连接列表"先分页再按授权过滤"**：被收窄到白名单的用户会丢失自己的连接，且 `total` 失真。现按模式分流：`mode:'all'` 时把 limit/offset 下推到 SQL 并用 `count()` 取真实总数；白名单模式先取全量、过滤后再切片。
- **`/connections/:id/capabilities` 缺资源级可见性校验**，可被当作连接存在性探针；已补 `assertConnectionVisible`（与其它接口一致，未授权与不存在都返回 404）。
- **`/query/cancel` 无归属与可见性校验**，可取消他人/未授权连接的查询；现已限制在"当前用户可见的连接"内，并写入 `query_cancel` 审计。
- **`query.max_rows` 设置不构成上限**：任意用户可用 `maxRows` 取回百万行。现作为**上限**生效（`min(请求值, 设置值)`）。
- **`idleConnectionMs` 从未接线**，空闲数据库会话永不回收；现按该阈值定时回收（`unref` 的定时器，随进程一起退出）。
- **错误处理器把 Fastify 的 4xx 当成 500**：坏 JSON、超大请求体等被记成 `error` 级日志并返回 `INTERNAL`。现映射为 `VALIDATION_FAILED` 等正确的 4xx（`details` 里只带框架错误码，不泄漏内部信息）。
- **审计导出把最多 10 万行一次性物化成字符串**（大库上必然 OOM）：改为 `reply.hijack()` + 游标分批（1000/批，上限 10 万）流式输出，带背压与流中断兜底；CSV 加 BOM 与固定 14 列表头。
- **关闭路径可能永久挂起**：`SIGINT`/`SIGTERM` 时若 `close()` 抛错或长请求未完成就会一直卡住。现加 10 秒强制退出兜底，`uncaughtException` 也走同一条路径。
- **未鉴权接口泄漏服务端内部信息**：`/health` 不再回传 `masterKeyMode`（等于告诉外人本地库有没有被主密码保护）；`/meta/info` 不再回传 `dataDir`/`dbPath` 绝对路径。`schemaVersion` 予以保留（运维需要判断部署跑到哪一版迁移，且不涉及主机路径）。
- **`bodyLimit` 由 64MB 降到 4MB**：原先 Fastify 在任何鉴权之前就完成 body 解析，未登录者反复 POST 大包即可放大内存占用。

### 新增（Added）— AI 助手界面与设置写入接口（补齐"实现完整却够不着"的缺口）

- **修复一个致命的功能缺口：AI 后端完整，但用户完全无法使用。** 9 类供应商、6 个技能场景、脱敏网关、调用历史、审计留痕全都实现好了，可是 —— ① `ai.enabled` 这道总开关**没有任何写入口**（全仓只有 `GET /meta/settings`，没有 PUT），于是 `assertReady()` 每次都抛 `AI_DISABLED`；② Web 端**没有任何 AI 界面**（无页面、无配置、无按钮、0 处调用 `/ai/*`、0 条 AI 文案）。旧版报错文案还写着「可在『设置 → AI』中启用」，而那个界面并不存在。现已全部补齐。
- **新增 `PUT /api/v1/meta/settings`**：设置项写入接口，受 `WRITABLE_SETTINGS` 白名单约束（白名单外的键返回 `VALIDATION_FAILED`），批量写入整体事务化（任一项非法则整批回滚），每次变更写审计（含旧值 → 新值）。新增 `GET /meta/settings/writable` 供界面查询可写清单，避免前端再抄一份白名单。
- **新增 `POST /api/v1/ai/test`**：连通性测试，真发一次最小请求（`max_tokens=8`）并返回耗时与模型回执。支持传 `configId` 或**表单临时值**，因此可以"保存前先试连"。**刻意不检查总开关** —— 否则会陷入「想测试 → 必须先启用 → 启用前不敢确认能连上」的死循环。
- **新增 `POST /api/v1/ai/models`**：列举供应商侧可用模型（便于挑选本地已下载的模型）。OpenAI 兼容系走 `GET {base}/models`；Anthropic / Google 没有该接口，此时**明确报"不提供模型列表接口"而不是返回空数组** —— 那会把"不支持"误传成"一个模型都没装"。用 POST 而非 GET，避免 API Key 落进访问日志。
- **新增「设置 → AI 助手」配置卡片**：总开关、脱敏开关、生产库写开关、模型配置的增删改查、设为默认、保存前试连、从服务端拉取模型列表。
- **新增独立的「AI 助手」对话页**（左侧技能栏 + 右侧对话区）：六个技能各自有专属输入与结构化结果展示；未启用 / 未配置时给出**可点的下一步**（跳转设置页），而不是只显示一行错误。
- **新增 `ai` 语言命名空间**：143 个键 × 6 种语言（简体中文、繁体中文、英文、俄语、日语、韩语）。
- **新增 18 项端到端测试**（`apps/server/src/ai.e2e.test.ts`）：测试里起一个**真实的** HTTP 服务充当 OpenAI 兼容供应商（随机端口），全程走真实 fetch，覆盖「开关能打开」「打开后真能调通」「白名单拒绝」「越界拒绝」「批量回滚」「密钥绝不出现在响应里」「`executed` 恒为 false」「调用后哈希链仍完整」。
- `pnpm verify` 新增「AI 助手」小节（供应商与场景齐全、nl2sql 不自动执行、设置写入口存在、白名单生效、AI 文案六语齐全、Web 端确有 AI 入口）。**项数不以文字写死，以 `pnpm verify` 实际输出为准。**


### 变更（Changed）— 默认管理员口令与口令强度策略

- **默认管理员口令改为固定值 `123456`**（`DEFAULT_ADMIN_USERNAME = 'admin'`、`DEFAULT_ADMIN_PASSWORD = '123456'`）。此前是首次引导时随机生成、只在首启日志里打印一次，安装后必须去翻日志才能登录；按需求方要求改为固定默认值，安装后可直接登录。仍然置 `security.must_change_password = true`，**首次登录后强制改密**；需要恢复强口令的部署方用 `PEANUTSPROUT_ADMIN_PASSWORD` 覆盖即可。
- **口令最短长度由 8 位放宽到 6 位**（`MIN_PASSWORD_LENGTH`），并**不再校验字符类别与弱口令字典**。这是与 PRD 4.6 的第二处刻意偏离（第一处是 scrypt 替代 bcrypt/argon2），风险评估、理由与恢复严格策略的方法见 `docs/security.md` §4.1.1。

### 新增（Added）— 国际化（i18n）

- **新增 `packages/i18n` 共享包**：六种语言（**简体中文（默认）**、繁体中文、英文、俄语、日语、韩语）、扁平点号键、`Intl.PluralRules` 复数选择、源语言回退链、`Intl` 数字与紧凑数字格式化、相对时间；Web 与桌面端共用同一套语言包。
- **键名有编译期约束**：`MessageKey` 由简体中文语言包推导，`t('nav.connection.label')` 这类拼写错误会**构建失败**，而不是上线后界面上显示出一串键名。
- **界面语言切换**：顶栏地球图标弹出语言列表 + 设置页「界面语言」下拉框；两个入口共用同一状态源，切换后立即生效并写入 `localStorage`（`peanutsprout.locale`）。首屏前就把 `<html lang>` 设对，避免读屏软件与字体回退先用错语言；标签页标题与 meta description 也跟着切。
- **服务端中文文案不再直接显示**：错误提示按稳定的 `error.code` 本地化（服务端原文仍保留在「原始信息」里便于排查）；数据库类型、权限项、审计动作、图表类型的展示名一律按稳定的 `code`/`type` 取当前语言，避免切到英文后界面中英混杂。
- **语言包完整性测试**（`catalogs.test.ts`）把「漏译」挡在提交前：六种语言是否齐全、有无漏译与僵尸键、**插值变量是否与源语言完全一致**（漏掉 `{count}` 是最常见的线上事故）、复数形式是否按该语言真实规则成套提供、繁体/俄语/日语/韩语是否真的用了对应文字（防「复制粘贴中文」）。
- `pnpm verify` 新增「国际化（i18n）」小节，并**扫描 `apps/web/src` 是否还有硬编码的中文 JSX 文本**。
- **产品文案已全部抽取**：六种语言 × 8 个命名空间 = **739 个键/语言**，零漏译、零僵尸键；`errors` 覆盖 `packages/core` 全部 21 个 `ErrorCode`。俄语另提供 57 条复数形式（`one`/`few`/`many`），英文 21 条。`pnpm verify` 扫描 `apps/web/src` 的 32 个文件，硬编码中文 JSX 文本 **0 处**。
- **实测验证**：生产构建产物内六种语言特征串全部命中；俄语复数经 `Intl.PluralRules` 实测正确（`1 строка` / `3 строки` / `5 строк` / `21 строка` / `22 строки`）；起真实服务确认 `NOT_FOUND`、`AUTH_REQUIRED` 等稳定错误码可被客户端本地化。
- 新增 `docs/i18n.md`：支持语言、交付状态、切换方式、架构与取舍、如何加一条文案、如何加一种语言。
- **修复（自测脚本自身缺陷）**：`scripts/verify.mjs` 在函数作用域内重复声明 `const { readdirSync }`，遮蔽了文件顶部同名 import 并触发 TDZ（`Cannot access 'readdirSync' before initialization`），导致「国际化」小节新增的硬编码文案扫描无法运行。已移除该重复声明。
- **修复（易漏的复数调用）**：5 处调用点写成 `{ values: { count: n } }` 而非 `{ count: n }`，插值正常但**复数选择从不触发**（俄语会永远显示基准形式，且在中文/日文/韩文环境下完全看不出来）。已全部改为 `count:` 形式，并在 `docs/i18n.md` §3.3 记录该易错点与自查命令。

### 修复（Fixed）

- **删用户会永久打断审计哈希链**（安全相关，最严重的一处）：`audit_logs.user_id` 上带有 `ON DELETE SET NULL` 外键，而 `user_id` 参与哈希链计算（`computeAuditHash`）。因此**删除任意一个用户，就会把该用户所有历史审计行的 `user_id` 改写成 NULL，导致链校验永久失败** —— 与产品「哈希链可校验、可检测篡改」的核心承诺直接冲突。已实测复现：`verifyChain()` 由 `{ok:true}` 变为 `{ok:false, brokenAt:1}`（用真实哈希函数反推出该行被提交时的 `user_id` 为 2，而库里已是 NULL）。修复：**审计日志改为不可变**，移除 `audit_logs.user_id` 上的外键（`user_id` 仅作历史记录保留；操作人身份另有同行冗余的 `username`，不会因删用户而丢失）。SQLite 无法直接删约束，故新增迁移 `0002_audit_drop_user_fk` 重建表并搬移全部数据；新增回归测试断言「删用户后链仍完整」与「audit_logs 上不存在指向 users 的外键」。
- **建用户失败却留下可登录的"孤儿账号"**（安全相关）：`UserRepository.create()` 把 `setRoles()` 放在创建用户的事务**外面**，因此传入不存在的角色时，`users` 行已经提交、角色写入才抛 `角色不存在` —— 接口返回失败，库里却多了一个**没有任何角色、却能正常登录**的账号。已实测复现（`roles: ["viewer"]` → 接口报错，`sixchar-test` 账号却存在且登录成功）。现改为用户行与角色在**同一个事务**内写入，失败整体回滚。
- **事务不支持嵌套**（上述缺陷的根因）：`LocalDatabase.transaction()` 直接执行 `BEGIN IMMEDIATE`，而 SQL 的 `BEGIN` 不能嵌套，所以仓储方法互相调用时只能把内层调用挪到事务外，代价就是丢失原子性。现按深度区分：最外层用 `BEGIN IMMEDIATE`/`COMMIT`，内层退化为 `SAVEPOINT`（内层失败只回滚内层，异常继续向外传播）。
- **前后端口令长度不一致**：各语言界面文案**一直写的是「至少 6 位」**（`auth.validation.passwordMinLength`、`auth.users.passwordMinPlaceholder`、`admin.settings.password.newHint`、`admin.settings.password.errTooShort`），而服务端 Zod schema 校验 8 位并返回「密码至少 8 位」。用户按界面提示输入 6 位会被接口拒绝。现统一为 6 位，且 schema 的提示语直接引用 `MIN_PASSWORD_LENGTH` 常量，避免两处再次漂移。

- **迁移只搬第一批数据**：`MigrationEngine.migrate()` 原先只读取一页（`maxRows: batchSize`）就结束，250 行数据仅迁移 50 行即报成功。改为 `LIMIT/OFFSET` 分页循环读取直至取空或返回短页，并新增 `countRows()` 辅助方法。
- **连接串端口被覆盖**：默认端口在解析连接串**之前**填充，导致 `mysql://…:3307/…` 被改写成 3306。改为先解析连接串、显式端口优先，仅在端口仍缺失时才回退默认值；同时修正 SQLite `file:`/`sqlite:` 连接串丢失前导 `/` 与查询参数被静默丢弃的问题。
- **空字符串加密后无法解密**：`decryptString()` 使用 `blob.length <= HEADER_LEN` 判断长度，而 `encryptString('')` 的结果恰好为 33 字节，导致解密误返回 `null`。改为 `<`，并新增会显式抛错的 `decryptStringStrict()`。
- **同构迁移误报有损**：`BaseTypeMapper` 未绑定源数据库类型，SQLite→SQLite 也会把 `BLOB` 标为有损。改为绑定源类型并对同类型映射直接短路。
- **脱敏把 NULL 变成占位符**：`redactValue()` 对 `null` 返回 `'***'`，歪曲了缺失值语义。改为对 `null`/`undefined` 提前返回 `null`。
- **权限通配符失效**：`hasPermission()` 不支持 `'*'` 通配（资源授权侧已支持），导致持有 `'*'` 的用户被判为无权限。
- **未授权连接可从状态码枚举**：`assertConnectionVisible()` 抛 `AUTH_FORBIDDEN`（403），使攻击者能凭状态码差异判断某连接 id 是否存在。改为返回与"连接不存在"完全一致的 `NOT_FOUND`（404），并将各路由中 7 处重复的内联判定统一收敛到该函数。

### 新增（Added）— 多平台打包配置与 Linux 实际验证

- **electron-builder 多平台配置**（`apps/desktop/electron-builder.yml`）：Windows NSIS + portable、macOS `dmg`/`pkg`（含 hardened runtime 授权文件 `packaging/macos/entitlements.mac.plist`）、Linux AppImage/deb（x64 + arm64）；`artifactName` 遵循 PRD 命名 `PeanutSprout-Setup-{version}-{os}-{arch}.{ext}`；图标资源（16→1024 全尺寸）就位。
- **服务端单文件打包**（`scripts/build-server.mjs`）：用 esbuild 把服务端连同 `pg`、`mysql2`、Fastify 等全部依赖内联成单个 `build/server.mjs`（约 4.1MB），因此安装包**不需要携带任何 `node_modules`**，也不会被 pnpm 符号链接拖入数百 MB 的 store。
- **`rpm` 改为可选目标**：原先把 `rpm` 放进默认 `linux.target`，而它需要系统装有 `rpmbuild`；在没装的机器（如 Debian/Ubuntu 默认）上 fpm 会以 `Need executable 'rpmbuild'` 失败，导致 `pnpm package:linux` 整条命令退出码 1 —— 尽管 deb 与 AppImage 已经成功产出。现已移出默认列表，改用 `pnpm package:linux:rpm` 按需构建。
- **已在 Linux 上实际构建并运行打包产物**：`pnpm package:dir` 产出 `release/linux-unpacked/`，以 `ELECTRON_RUN_AS_NODE=1` 直接启动包内 `resources/server/server.mjs`（**不使用仓库内任何 `node_modules`**），健康检查返回正常，且驱动清单显示 `postgresql`/`mysql`/`mariadb`/`tidb`/`oceanbase`/`kingbase`/`sqlite` 全部已实现 —— 实证了「运行时零环境依赖」与依赖内联有效。**x64 与 arm64 两套 deb + AppImage 均已产出**（`pnpm package:linux` 退出码 0）：deb x64 81.3MB / arm64 76.3MB，AppImage x64 103.2MB / arm64 103.4MB；deb 元信息与包内 `.desktop`、9 种尺寸图标经 `dpkg-deb` 核对无误。**AppImage 运行验证**：本机缺 `libfuse.so.2`，直接执行 `.AppImage` 会报 "AppImages require FUSE to run"（AppImage 格式固有前提 + 本机环境限制，非产物缺陷），改用标准变通 `--appimage-extract-and-run` 后实机启动成功，健康检查、作者/微信/协议元信息、Web 界面与 CSS 资源均正常。
- **`pnpm verify` 新增打包产物检查**：检测 `release/linux-unpacked` 内的服务端单文件与 Web 资源是否齐全（自检项 37 项 → 加入国际化小节后为 42 项）。

### 新增（Added）— Web 端图表与看板渲染

- **`ChartRenderer.tsx`**：纯内联 SVG 实现，**不引入任何图表库**，支持 `bar`/`column`/`line`/`area`/`pie`/`donut`/`scatter`/`radar`/`parallel`（平行坐标图，每根轴独立归一化、缺值处断线、超出上限截断）；含坐标轴刻度选取、多指标图例、空数据集与 `NULL`/非数值单元格的降级处理。
- **图表页与看板页**（`ChartsPage.tsx`、`DashboardsPage.tsx`）接入全套 REST 接口，支持创建、取数渲染、删除，并展示实际执行的 SQL 以便核对。
- **未支持类型的诚实降级**：`bubble`/`heatmap`/`sankey`/`treemap`/`boxplot`/`map` 显示明确的「暂不支持浏览器内渲染」占位面板，同时展示数据表，**不假装渲染**。
- 新增 **51 项前端测试**（图表几何计算 45 项，含平行坐标图的独立归一化/断线/截断；看板布局 4 项）。

### 新增（Added）— 真实数据库驱动与跨库迁移

- **PostgreSQL / KingbaseES 真实驱动**（`packages/drivers/src/postgresql.ts`）：基于 `pg`，元数据走 `pg_catalog`，执行计划用 `EXPLAIN (FORMAT JSON)` 解析成节点树。**已对真实 PostgreSQL 18.3 服务端验证**（PGlite WASM 经标准 PG 线协议，`pg` 驱动直连），9 项测试全绿。
- **MySQL / MariaDB / TiDB / OceanBase 真实驱动**（`packages/drivers/src/mysql.ts`）：基于 `mysql2`，元数据走 `information_schema`，改列用 MySQL 的 `MODIFY COLUMN` 语义，标识符用反引号。**诚实说明：未经真实 MySQL 服务端验证** —— 本机网络无法下载 MySQL/MariaDB 服务端二进制（CDN 吞吐约 2.4MB/min、GitHub Releases 不可达），因此驱动代码与方言逻辑（反引号、`MODIFY COLUMN`、`EXPLAIN` 解析、各分支默认端口 3306/3306/4000/2881）由 10 项不依赖服务端的测试覆盖，另有 1 项需 `PEANUTSPROUT_TEST_MYSQL_URL` 的实连测试默认跳过并打印跳过原因。
- **跨异构库迁移端到端可用**：`packages/migration/src/cross-db.test.ts` 把 SQLite 的一张表连结构带数据迁移到**真实 PostgreSQL**，6 项测试全绿。类型自动映射、索引一并迁移、冲突策略（默认 `skip`）、逐表报告均验证通过。
- **图表与看板 REST 接口**：`POST/GET/PATCH/DELETE /charts`、`GET /charts/:id/data`、`GET /charts/types`、以及 `/dashboards` 全套，含 `charts`/`dashboards` 两张表的仓储层。
- **令牌续签 `POST /auth/refresh`**：采用**会话轮换**语义 —— 旧会话立即吊销、旧令牌随即失效，而非把旧令牌原样重签（避免令牌被无限续命）。
- **CLI 补齐 8 个子命令**：`migrate start` / `migrate status --report --watch` / `migrate cancel`、`ai explain`、`audit export`、`import`（CSV → 表）、`export`（表 → CSV）、`update check`。均已实机跑通。
- **更新检查**：`update check` 读取 `PEANUTSPROUT_UPDATE_MANIFEST` 指向的 JSON 清单做语义化版本比较；**未配置更新源时如实告知"无法判断"**，不会假装已是最新；发现新版本以退出码 13 结束。

### 修复（Fixed）— 图表 SQL 生成器（关键缺陷）

- **生成的图表 SQL 完全没有 `FROM` 子句**：`buildChartSql()` 只输出 `SELECT ... GROUP BY ... LIMIT ...`，一条都执行不了。此前测试只断言了 `GROUP BY`，因此"看起来是绿的"。现已补上 `FROM`，并把来源表设为**必填**：缺失时直接报错，而不是生成注定失败的 SQL。
- **筛选运算符两套词汇不互通**：生成器只认 `=`/`is null` 这类 SQL 风格，接口层却只接受 `eq`/`is_null` 缩写风格，保存下来的筛选条件一执行就抛"不支持的筛选运算符"。现统一收敛两套写法，并导出 `CHART_FILTER_OPERATORS` 供接口层复用，杜绝三处口径漂移。
- **图表 SQL 未按方言加引号**：一律使用双引号，在未开启 `ANSI_QUOTES` 的 MySQL 上会直接语法错误。现按目标连接方言选择（MySQL 系用反引号）。
- **`buildChartSql` 的标识符转义不完整**：字段别名未转义内部引号，现补上双写转义。

### 修复（Fixed）— 迁移引擎

- **`countRows()` 吞掉所有异常并返回 0**：一次失败的行数统计会被当成"目标表为空"，进而重复插入数据。新增 `{ strict }` 选项，目标表存在性判断改用严格模式。
- **结构迁移依赖错误文本匹配**：原先靠 `/exist/i` 匹配数据库返回的错误消息来判断表是否已存在，既脆弱又会在 PGlite 上因连接被断开而级联失败。改为显式调用 `target.getMetadata().listTables()` 判定；`overwrite` 策略下先 `DROP TABLE`。
- **索引从未被迁移**：迁移后目标库只剩主键。现读取 `listIndexes()` 并作为二级索引传给 `createTable`。
- **冲突策略默认值只在 REST 层生效**：`engine.migrate()` 内部未兜底，导致重复运行报 `duplicate key value violates unique constraint`。现引擎内统一默认 `skip`。
- **跨库插入占位符硬编码为 `?`**：迁移到 PostgreSQL 时每行都报 `syntax error at or near ","`。现按目标方言生成 `$1..$n`。
- **多语句 DDL 在 PostgreSQL 上失败**：`runQuery` 无条件传递 `values`，强制走扩展协议，而扩展协议不接受多语句。现为空时不传 `values`（走简单协议），并用 `splitSqlStatements()` 逐条执行。
- **PG 索引列名返回整条 `CREATE INDEX` 语句**：`int2vector` 下标是 0 基，而 `pg_get_indexdef` 的列序号是 1 基，差一导致取错。已修正并加注释。

### 修复（Fixed）— 测试基础设施

- **PGlite 假绿测试**：PGlite 启动失败时原先只 `console.warn` 并静默跳过全部用例，测试"通过"却什么都没验证。现 `beforeAll` 直接抛错。
- **PGlite 未处理拒绝**：PGlite 的 socket 服务端把客户端清理回调丢进 `setImmediate`，若在其跑完前就 `close()` 数据库实例，会抛 `Cannot read properties of undefined (reading '_IsTransactionBlock')`（第三方库时序缺陷）。三处测试 teardown 已统一为「停服务端 → 留一个事件循环 → 关库」。
- **过时断言把"未实现"当成预期**：`e2e.test.ts` 曾断言 MySQL 驱动 `driverImplemented === false`，在驱动落地后反而失败。现改为按真实能力分布断言（7 种已实现为 `true`，8 种占位为 `false`）。

### 修复（Fixed）— 桌面端无法启动的两个环境问题

- **`pnpm-workspace.yaml` 配置非法导致 Electron 二进制从未下载**：`allowBuilds` 字段被写入了 `set this to true or false` 这类占位字符串，pnpm 判定配置非法后继续跳过安装脚本，表现为 `pnpm install` 看似成功、`electron/dist/` 却为空。已改为布尔值。
- **GitHub Releases 静默挂起**：Electron 安装脚本从 GitHub Releases 下载约 190MB 二进制，国内网络下不报错、直接长时间无响应。已在 `.npmrc` 配置 `electron_mirror=https://registry.npmmirror.com/-/binary/electron/`（海外用户删除该行即可），并在 `docs/deployment.md` 记录手动下载方式。
- **Linux 上 Electron 启动即 abort**：`chrome-sandbox` 需 root 所有且权限 4755，开发态通常不具备，Electron 会在启动瞬间崩溃且报错与业务无关。新增 `apps/desktop/scripts/launch.mjs`：先探测沙箱可用性，**仅在确实不可用时**才补 `--no-sandbox` 并打印修复指引，不无条件关闭沙箱（渲染进程 `sandbox: true` 保持不变）。

### 计划中（Planned）

- **Oracle / SQL Server / 达梦 / Redis / MongoDB / ClickHouse / InfluxDB / Neo4j 驱动**：当前为占位实现，调用时明确返回 `DRIVER_NOT_IMPLEMENTED`，绝不静默失败。
- **MySQL 真实服务端验证**：驱动已实现，但受限于本机网络未能对真实 MySQL 跑通集成测试。
- **多平台安装包**：`packaging/` 下 electron-builder 配置（Windows NSIS、macOS dmg/arm64、Linux AppImage/deb）与图标资源已就位，**尚未在目标平台上实际产出并安装验证**。
- **剩余 CLI 子命令**：`ai optimize/document/ask/diagnose`（服务端路由已就绪）、`migrate resume`、`update download/apply/rollback`、`import/export` 的 json/xlsx 与压缩格式。
- **图表类型覆盖**：`line`/`bar`/`column`/`area`/`pie`/`donut`/`scatter`/`radar`/`parallel` 已可在浏览器内渲染；`bubble`/`heatmap`/`sankey`/`treemap`/`boxplot`/`map` 仍显示"暂不支持浏览器内渲染"的明确占位面板。

---

## [0.1.0] - 2025-01-01

> **待发布**（日期为占位，实际发布时以正式发布日期为准）。

首个版本，完成工程骨架与端到端最小可用闭环。

### 新增（Added）

#### 工程骨架

- 搭建 **pnpm monorepo** 工作区，统一管理 `apps/` 与 `packages/`。
- 全栈采用 **TypeScript**（strict 模式）、ESM 模块体系。
- 建立基础工程配置：`tsconfig.base.json`、`vitest.config.ts`、`.npmrc`、`.gitignore`、`pnpm-workspace.yaml`。
- 提供统一脚本入口：`pnpm typecheck`、`pnpm test`、`pnpm bootstrap`、`pnpm verify`、`pnpm ddl:export`。

#### 存储与数据

- 落地本地 **SQLite** 元数据库 `peanutsprout.db`，默认位于 `~/.peanutsprout/`。
- 完成本地库 **DDL 建表语句**与迁移机制，支持一键初始化。
- 提供 DDL 导出脚本，保持 `docs/ddl.sql` 与代码定义一致。

#### 安全

- 连接口令与 API Key 采用 **AES-256-GCM** 加密存储。
- 首次启动自动生成主密钥文件 `~/.peanutsprout/master.key`，权限收紧为 **0600**。
- 用户口令使用加盐哈希存储，不落明文。

#### 测试与自检

- 建立 **230 项**自动化测试（11 个测试文件），覆盖加密、驱动、鉴权、RBAC、审计链、迁移、脱敏、图表 SQL 与端到端 API。（该数字为 0.1.0 当时的规模；`[Unreleased]` 中已增至 **373 项 + 1 项跳过**。）
- `apps/server/src/e2e.test.ts` 以真实 Fastify 应用 + 内存 SQLite 跑通完整业务链路：登录 → 建连接 → 连通性测试 → 读元数据 → 执行查询 → 写操作确认闸门 → 只读保护 → 资源级授权可见性 → 审计哈希链 → RBAC。
- 提供 `pnpm verify` 一键自检：运行环境、交付文件、本地库与审计链、驱动落地情况、构建产物。
- 补充 `packages/cli/src/client.ts` 与完整 CLI 命令实现，退出码与领域错误码一一对应。

#### 认证与授权

- 实现登录鉴权与 **JWT** 令牌签发、校验。
- 实现**资源级授权**：用户可被限定到具体连接（白名单模式），未授权连接按"不存在"返回 404。
- 完成基于角色的接口访问控制。
- `pnpm bootstrap` 可创建默认管理员账号（**要求首次登录后立即改密**）。

#### 连接管理

- 数据库连接的 **CRUD**（创建、查询、更新、删除）完整实现。
- 提供连接**连通性测试**能力。

#### SQL 执行

- 提供 SQL 提交与执行能力，返回结果集、影响行数与耗时。

#### 审计

- 关键操作写入**审计日志哈希链**，逐条以哈希串联，支持完整性校验与防篡改追溯。

#### 服务端

- 基于 **Fastify** 实现 REST API，统一前缀 `/api/v1`，默认监听 `http://127.0.0.1:8787`。
- 统一错误响应结构与请求日志。

#### 命令行工具（CLI）

- 提供 `@peanutsprout/cli`，支持在终端完成初始化、连接管理与 SQL 执行。

#### Web 界面

- 提供 **React** Web 端，包含登录、连接管理与 SQL 控制台页面。
- 开发服务器默认端口 `5173`。

#### 桌面端

- 提供 **Electron** 桌面壳工程骨架，承载与 Web 端一致的能力。

#### 文档

- 建立文档全集：`docs/PRD.md`、`docs/architecture.md`、`docs/modules.md`、`docs/api.md`、`docs/ddl.sql`、`docs/acceptance.md`、`docs/roadmap.md`、`docs/cli-reference.md`、`docs/security.md`、`docs/deployment.md`。
- 新增开源治理文档：`README.md`、`LICENSE`（AGPL-3.0）、`CONTRIBUTING.md`、`CLA.md`、`CHANGELOG.md`。

### 说明（Notes）

- 本项目以 **GNU Affero General Public License v3.0（AGPL-3.0）** 发布，版权归作者**飞哥**所有（微信 6731663）。
- 本版本中的数据库驱动为内置最小实现，生产级 MySQL / PostgreSQL 驱动在后续版本提供。

---

## 版本号说明

- **主版本号（MAJOR）**：不兼容的 API 变更或重大架构调整。
- **次版本号（MINOR）**：向下兼容的功能新增。
- **修订号（PATCH）**：向下兼容的缺陷修复与安全修补。

[Unreleased]: https://example.com/peanutsprout/compare/v0.1.0...HEAD
[0.1.0]: https://example.com/peanutsprout/releases/tag/v0.1.0
