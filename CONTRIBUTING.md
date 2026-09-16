# 贡献指南（Contributing Guide）

感谢您愿意为 **花生苗数据库管理工具（PeanutSprout DB Manager）** 贡献力量！

本文档说明参与本项目的完整流程。请在提交任何代码前完整阅读，并确保已签署 [CLA.md](./CLA.md)。

- 项目作者：**飞哥**（微信 **6731663**）
- 开源协议：**GNU Affero General Public License v3.0 (AGPL-3.0)**
- 版权声明：Copyright (C) 2025 飞哥

---

## 目录

- [行为准则](#行为准则)
- [开发环境准备](#开发环境准备)
- [分支与提交规范](#分支与提交规范)
- [代码风格](#代码风格)
- [质量门禁](#质量门禁)
- [Pull Request 流程](#pull-request-流程)
- [Issue 模板建议](#issue-模板建议)
- [贡献者许可协议（CLA）](#贡献者许可协议cla)
- [许可证特别声明](#许可证特别声明)

---

## 行为准则

- 尊重每一位参与者，就事论事，不进行人身攻击；
- 讨论以技术事实与项目利益为准，接受建设性的反对意见；
- 不提交任何来源不明、许可证不兼容或包含他人未授权代码的内容。

---

## 开发环境准备

### 环境要求

| 依赖 | 版本要求 |
| --- | --- |
| Node.js | **>= 22.5**（推荐 **24 LTS**） |
| pnpm | **>= 10** |
| Git | 任意较新版本 |

### 初始化步骤

```bash
# 1. Fork 并克隆仓库
git clone <your-fork-url> peanutsprout
cd peanutsprout

# 2. 安装依赖（monorepo 根目录执行一次即可）
pnpm install

# 3. 初始化本地库并创建管理员账号
pnpm bootstrap

# 4. 启动服务端（http://127.0.0.1:8787）
pnpm dev:server

# 5. 启动 Web 端（http://127.0.0.1:5173）
pnpm dev:web
```

本地数据默认位于 `~/.peanutsprout/`（`peanutsprout.db`、`master.key`、`logs/`）。
**请勿将 `master.key`、`peanutsprout.db`、日志或任何真实连接口令提交到仓库。**

#### 如果 `pnpm install` 长时间卡住

`electron` 的安装脚本会下载**约 190MB 的 Electron 二进制**，供桌面端使用。
在国内网络下从 GitHub Releases 拉取会长时间无响应 —— 注意是**静默挂起而不是报错**，
可能卡几十分钟且没有任何输出。仓库根的 `.npmrc` 已默认配置国内镜像
（`electron_mirror`），若镜像也不通，按需求二选一：

```bash
# 只做服务端 / Web 端 / 测试时：直接跳过二进制下载（推荐，几秒装完）
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
pnpm install

# 需要跑桌面端时：改用官方源（需能稳定访问 GitHub）
# 编辑 .npmrc 注释掉 electron_mirror 那一行
```

跳过二进制后，`pnpm test` / `pnpm typecheck` / `pnpm dev:server` / `pnpm dev:web` 全部照常可用，
只有 `pnpm dev:desktop` 与 `pnpm package:*` 需要它（`pnpm verify` 会把"Electron 二进制缺失"
列为**非阻断提醒**，不会伪装成通过）。

> 另外：`pnpm-workspace.yaml` 的 `allowBuilds` 里显式写了 `electron-winstaller: false`。
> 它只用于生成 Squirrel Windows 安装包，而本项目 win 目标是 NSIS，用不到它。
> 如果你在 pnpm 提示下把它改成 `set this to true or false` 这类占位符，
> pnpm 会判定配置非法，之后**任何 pnpm 命令都会失败**（`ERR_PNPM_IGNORED_BUILDS`）。

### 常用脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm install` | 安装工作区依赖 |
| `pnpm bootstrap` | 初始化本地库并创建管理员 |
| `pnpm dev:server` | 启动 Fastify 服务端 |
| `pnpm dev:web` | 启动 React Web 开发服务器 |
| `pnpm test` | 运行测试（vitest） |
| `pnpm typecheck` | 全仓 TypeScript 类型检查 |
| `pnpm verify` | 工程校验脚本 |
| `pnpm --filter @peanutsprout/cli exec tsx src/index.ts --help` | 运行 CLI |

---

## 分支与提交规范

### 分支命名

请从最新的主分支切出特性分支，命名遵循 `<type>/<short-description>`：

| 前缀 | 用途 | 示例 |
| --- | --- | --- |
| `feat/` | 新功能 | `feat/mysql-driver` |
| `fix/` | 缺陷修复 | `fix/audit-hash-chain` |
| `docs/` | 文档变更 | `docs/cli-reference` |
| `refactor/` | 重构（不改变外部行为） | `refactor/storage-layer` |
| `test/` | 测试补充 | `test/connection-crud` |
| `chore/` | 构建、依赖、工具链 | `chore/bump-vitest` |

### 提交信息（Conventional Commits）

提交信息必须遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/) 规范：

```
<type>(<scope>): <subject>

<body>

<footer>
```

- **type**：`feat` | `fix` | `docs` | `style` | `refactor` | `perf` | `test` | `build` | `ci` | `chore` | `revert`
- **scope**：受影响的模块，建议使用包名简写，如 `server`、`cli`、`web`、`desktop`、`core`、`storage`、`auth`、`drivers`、`ai`、`migration`、`visualization`
- **subject**：中文或英文均可，使用祈使句、不加句号、不超过 72 字符

示例：

```
feat(drivers): 新增 MySQL 连接驱动与连通性测试

实现基于连接串的 MySQL 驱动，支持连接测试与基础查询。
新增对应单元测试。

Closes #42
```

```
fix(auth): 修正 JWT 过期时间未生效的问题
```

**破坏性变更**必须在 type 后加 `!` 或在 footer 中以 `BREAKING CHANGE:` 开头说明。

---

## 代码风格

- **TypeScript strict**：必须开启并通过 `strict` 模式，禁止无理由使用 `any`；确需使用时必须以注释说明原因；
- **ESM**：统一使用 ES Module（`import` / `export`），不要使用 CommonJS 的 `require`；
- **缩进**：**2 个空格**，不使用 Tab；
- **引号**：**单引号**（`'`）；
- **分号**：**语句末尾保留分号**；
- **命名**：变量与函数用 `camelCase`，类型与类用 `PascalCase`，常量用 `UPPER_SNAKE_CASE`，文件名用 `kebab-case`；
- **导入顺序**：内置模块 → 第三方依赖 → 工作区内包 → 相对路径；
- **注释**：公共 API 与复杂逻辑需有简明注释；中文注释优先，避免无意义注释；
- **不要提交**：调试代码（`console.log` 残留）、注释掉的死代码、`TODO` 而无 issue 编号的占位实现。

---

## 质量门禁

提交 PR 前，以下命令**必须全部通过**，CI 与评审人都会检查：

```bash
# 1. 类型检查必须零错误
pnpm typecheck

# 2. 测试必须全部通过
pnpm test
```

补充要求：

- 新增功能应附带对应的单元测试或集成测试；
- 修复缺陷时应补充可复现该缺陷的回归测试；
- 不得通过删除、跳过（`skip` / `only`）或弱化既有断言的方式让测试"变绿"；
- 不得降低类型严格度来规避类型错误。

---

## Pull Request 流程

1. **建分支**：从最新主分支切出特性分支（见[分支命名](#分支命名)）；
2. **小步提交**：一个 PR 聚焦一件事，避免混合无关改动；
3. **自测**：本地执行 `pnpm typecheck` 与 `pnpm test`，确保全部通过；
4. **更新文档**：行为变更需同步更新 `README.md`、`docs/` 相关文档与 `CHANGELOG.md` 的 `[Unreleased]` 段落；
5. **提交 PR**：填写 PR 模板，说明**动机、改动内容、验证方式、影响范围**；
6. **签署 CLA**：在 PR 中书面确认同意 [CLA.md](./CLA.md)（见下文）；
7. **响应评审**：及时回复评审意见。评审通过后由维护者合并。

**PR 描述建议模板：**

```markdown
## 动机
（为什么需要这个改动，关联 issue：Closes #xx）

## 改动
（做了什么，关键设计取舍）

## 验证
（如何验证：命令、测试用例、手工步骤、截图）

## 影响范围
（是否影响 API、数据表结构、兼容性；是否为破坏性变更）

## 新增依赖
（是否新增第三方依赖？名称 + 许可证；无则写"无"）

## CLA
- [ ] 我已阅读并同意 CLA.md，同意以 AGPL-3.0 授权本次贡献。
```

---

## Issue 模板建议

建议仓库维护以下 Issue 模板，提交时请选择合适的一类：

### 🐛 缺陷报告（Bug Report）

- **环境**：操作系统、Node.js 版本、pnpm 版本、花生苗版本/commit；
- **复现步骤**：最小可复现步骤（1、2、3…）；
- **期望行为**与实际行为；
- **日志与截图**：请**脱敏**，严禁粘贴真实连接口令、`master.key`、令牌或生产数据；
- **影响范围**：是否阻塞使用、是否涉及数据安全。

### ✨ 功能建议（Feature Request）

- **使用场景**：您在什么场景下需要它；
- **期望能力**：希望如何操作、得到什么结果；
- **替代方案**：当前如何绕过；
- **优先级建议**：可选。

### 📖 文档问题（Documentation）

- 文档路径与具体位置；
- 现存问题（错误、缺失、歧义）；
- 建议的修正内容。

---

## 贡献者许可协议（CLA）

**所有贡献者在首次提交 PR 时必须签署 [CLA.md](./CLA.md)。**

签署方式（二选一）：

1. **PR 中书面确认**：在 PR 描述或评论中明确写明：
   > 我已阅读并同意 CLA.md 的全部条款，同意将本次贡献以 AGPL-3.0 授权，并确认该贡献为本人原创或已获得合法授权。
2. **签署文件**：按 `CLA.md` 末尾的生效方式填写并回传。

未签署 CLA 的 PR 将无法被合并。

---

## 许可证特别声明

> **特别声明（请务必阅读）**

1. **提交代码即表示同意以 AGPL-3.0 授权**：您向本项目提交的任何贡献（代码、文档、设计、测试等），均视为您同意以 **GNU Affero General Public License v3.0** 授权，授权对象包括项目作者**飞哥**及本项目所有使用者。该授权是**永久的、全球范围的、非独占的、免许可费的**，且不可撤销。
2. **不得引入与 AGPL-3.0 不兼容的第三方依赖**：请勿引入任何与本项目许可证不兼容的依赖或代码。常见不兼容情形包括但不限于：专有/商业许可组件、要求额外限制的许可证、与 AGPL-3.0 义务冲突的 copyleft 条款等。
3. **新增依赖必须声明许可证**：任何新增第三方依赖，**必须在 PR 中明确说明其名称与许可证**，并确认其与 AGPL-3.0 兼容。评审人有权拒绝引入许可证不明确或不兼容的依赖。
4. **贡献须为原创或已获授权**：请勿提交来自其他项目、公司或他人的代码，除非您已获得明确授权且该内容许可证兼容，并在 PR 中说明来源与授权情况。
5. **保留版权与许可声明**：请勿移除或修改源码中已有的版权声明、许可证声明与免责声明。
6. **商业闭源授权**：AGPL-3.0 要求以网络服务形式提供修改版本时必须开源完整对应源代码。如需闭源商用，须获得作者**书面授权**（微信 **6731663**）。

---

## 联系方式

- 作者：**飞哥**
- 微信：**6731663**

再次感谢您的贡献，愿花生苗在社区的浇灌下茁壮成长 🌱
