# 花生苗（PeanutSprout）部署与运维手册

> 版本：0.1.0
> 关联文档：`docs/architecture.md`（进程模型与端口）、`docs/security.md`（TLS/权限/密钥要求）、`docs/cli-reference.md`（`serve`/`update`/`diagnose` 命令）。
> 通用前提：**Node.js ≥ 22.5.0**（`node:sqlite` 下限；`22.5–23.3` 需 `--experimental-sqlite`，`23.4+` 免标志；本仓库根 `package.json` 已声明 `engines.node >= 22.5.0`），推荐 Node 24 LTS。生产部署必须**锁定 Node 大版本**。

---


## 0. 首次安装的两个环境要点（Linux / 国内网络）

安装依赖前请先了解以下两点，否则桌面端会"装上了但起不来"：

### 0.1 Electron 二进制下载走国内镜像

Electron 的安装脚本会去 **GitHub Releases** 下载约 190MB 的平台二进制。实测在国内网络下该地址**不报错、直接静默挂起**，表现为 `pnpm install` 看似成功、但 `electron/dist/` 为空、桌面端启动即失败。

本仓库已在 `.npmrc` 中配置：

```ini
electron_mirror=https://registry.npmmirror.com/-/binary/electron/
```

若你在海外或已配置代理，删除该行即可回到官方源。若仍下载失败，可手动执行：

```bash
cd node_modules/.pnpm/electron@*/node_modules/electron
ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/ node install.js
```

> `pnpm-workspace.yaml` 中的 `allowBuilds` 必须为布尔值（`electron: true`）。该字段若被写成占位文本，pnpm 会判定配置非法并**跳过**安装脚本，二进制同样不会下载。

### 0.2 Linux 需要配置 chrome-sandbox（或开发态关闭沙箱）

Linux 上 Electron 依赖 `chrome-sandbox`，要求该文件 **root 所有且权限 4755**：

```bash
sudo chown root:root node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox
```

未配置时 Electron 会在启动瞬间 abort，报错与业务无关。为此 `pnpm dev:desktop` 走的是 `apps/desktop/scripts/launch.mjs`：它会先探测沙箱可用性，**仅在确实不可用时**才补 `--no-sandbox` 并打印修复指引；渲染进程的 `sandbox: true` 不会被削弱。若要跳过提示，设 `PEANUTSPROUT_NO_SANDBOX=1`。

> **不要**在正式安装包里长期关闭沙箱。正确做法是在打包时让安装脚本设置好 `chrome-sandbox` 的属主与权限位。
> deb/rpm 已由 electron-builder 内置 after-install 自动处理；`dir`/AppImage 产物没有 setuid 位，
> 在未启用 unprivileged user namespace 的机器上仍会 abort，详见 §14.5 第 4 条。

## 1. 部署形态总览

| 形态 | 适用场景 | 使用者 | 监听 | 认证 | 数据目录 | 运维量 |
| --- | --- | --- | --- | --- | --- | --- |
| **A 桌面端内嵌服务** | 单机开发者/DBA，本机管理数据库 | 1 人 | `127.0.0.1:8787`（可回退随机端口） | 本地会话（可选主密码） | `%USERPROFILE%\.peanutsprout` / `~/.peanutsprout` | 无 |
| **B 独立服务端二进制** | 团队内网共享、CI 中调用、给同事开只读账号 | 多用户 | `0.0.0.0:8787`（反代后） | JWT + RBAC + 资源授权 | `/var/lib/peanutsprout` | 中（systemd/服务 + 备份） |
| **C Docker 容器** | 已有容器平台、需要统一编排 | 多用户 | 容器内 `8787`，映射/反代 | 同上 | 挂载卷 `/data` | 低（编排托管） |

选择建议：**先用 A**（零运维）；需要团队共享或审计留痕时上 **B/C**，并按 §5/§6 配好 TLS。

> 三形态共用同一套元数据库 schema 与同一份 `~/.peanutsprout/` 结构，因此数据目录可以在形态间迁移（拷贝目录即可，需同时拷贝 `master.key`，见 §7.4）。

---

## 2. 形态 A：桌面端内嵌服务

### 2.1 组成

```
PeanutSprout 桌面应用
├── Electron main（Node 进程，可信）
│   ├── 启动内嵌 Fastify（in-process，不额外 spawn 子进程）
│   ├── 绑定 127.0.0.1:8787；被占用则用 0 端口取随机可用端口
│   ├── 管理 SQLite（node:sqlite DatabaseSync）与数据目录
│   ├── 托盘图标、单实例锁（second-instance 聚焦主窗口）
│   └── electron-updater 自动更新
├── preload（contextBridge 白名单：窗口控制、文件对话框、端口/版本信息）
└── renderer（复用 apps/web 构建产物，通过 HTTP 访问 127.0.0.1）
```

### 2.2 关键行为

| 行为 | 说明 |
| --- | --- |
| 单实例 | `app.requestSingleInstanceLock()`；重复启动聚焦已有窗口，避免两个进程同时写 SQLite |
| 端口 | 固定 `8787` 优先（便于用户用 CLI/浏览器访问）；占用时取随机端口，通过 preload 把实际端口告知 renderer，并在「设置 → 关于」中可见 |
| 关闭行为 | 默认「关闭窗口 = 最小化到托盘」；「退出」时优雅关闭 Fastify → `PRAGMA wal_checkpoint(TRUNCATE)` → 关闭数据库 |
| 开机自启 | 可选（Windows 注册表 Run、macOS Login Item、Linux `~/.config/autostart`），默认关闭 |
| 主密码 | 可选启用；启用后启动时弹解锁窗口，未解锁前需要凭据的操作返回 `MASTER_KEY_LOCKED` |
| 系统集成 | 系统托盘菜单（打开主窗口、最近连接、退出）、原生文件对话框（导入导出/备份选择目录） |
| 安全基线 | `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、禁用 `webview`、`setWindowOpenHandler` 拒绝新窗口、外链交给系统浏览器且仅允许 `https` |
| 离线 | 全功能离线可用（AI 需外部服务，Ollama 可本地） |

### 2.3 打包与分发（electron-builder）

> 逐条命令、产物名与实测注意事项见 **§14 桌面端打包（electron-builder）**；本节只列设计取向。

| 平台 | 目标 | 说明 |
| --- | --- | --- |
| Windows | `nsis`（安装版）、`portable`（免安装） | 安装版支持自动更新；portable 不支持自动更新 |
| macOS | `dmg`、`zip`（用于更新）；`pkg` 需单独命令 | 需 Developer ID 签名 + 公证（notarization），否则 Gatekeeper 拦截 |
| Linux | `AppImage`（免安装）、`deb`、`rpm` | AppImage 便于内网分发；deb/rpm 用系统包管理更新 |

配置要点（实际配置见 `apps/desktop/electron-builder.yml`）：

- `files` 只包含 Electron 外壳本身：`main.mjs` + `package.json`；
  服务端与 Web 产物走 `extraResources`——`build/server.mjs` → `resources/server/server.mjs`、
  `apps/web/dist` → `resources/web`。**安装包内既无 `tsx` 也无 `node_modules`**：
  TS 源码与全部运行时依赖已由 `scripts/build-server.mjs`（esbuild）内联成单文件。
- `asar: true`；`asarUnpack` 为空（当前零原生依赖）。
- `electron-builder.yml` 中显式声明 `nodeGypRebuild: false`、`buildDependenciesFromSource: false`、`npmRebuild: false`。
- 首次启动前不写数据目录（安装器不触碰用户数据）；卸载默认保留 `~/.peanutsprout`，
  Windows 卸载器会弹窗提示"数据与密钥在 …，如需彻底清理请手动删除"（`packaging/windows/installer.nsh`）。
- **Windows 安装向导可选安装路径与快捷方式**：`oneClick: false` +
  `allowToChangeInstallationDirectory: true` 提供「选择安装位置」页；快捷方式由
  `packaging/windows/installer.nsh` 的自定义页（`customPageAfterChangeDir`）提供，
  两个复选框默认勾选，静默安装按"默认都创建"处理。
  注意 `createDesktopShortcut` / `createStartMenuShortcut` 必须为 `false`——
  electron-builder 没有"让用户选"这一档，必须关掉它的自动创建；但同一个宏
  （`DO_NOT_CREATE_*_SHORTCUT`）**也让卸载器整段跳过快捷方式清理**，
  所以 `customUnInstall` 里自己删了。改那两行前请先读该文件的注释。
- Electron 二进制下载走 `electronDownload.mirror`（与 `.npmrc` 的 `electron_mirror` 一致），
  否则国内网络下打包会在下载 Electron 时静默挂起，详见 §14.5。

> ⚠️ **不要在 Linux 上交叉构建 Windows 安装包。** electron-builder 必须先用 NSIS
> 生成一个"卸载器生成器"，再**运行它**（Linux 上靠 wine）来产出 `uninstall.exe`。
> 而 electron-builder 自带下载的 wine 工具链（`wine@1.0.0` / `wine@1.0.1` 的
> `wine-11.0-linux-x86_64.tar.xz`）是**残缺的**：只有 unix 侧的
> `lib/wine/x86_64-unix`，完全没有 PE 侧的 `lib/wine/x86_64-windows`
> （完整安装应有 700+ 个 DLL，它只有 26 个，缺 `kernel32.dll` 与 apiset），
> 无法运行任何 Windows 程序，构建必然止步于
> `wine: failed to load .../x86_64-unix/ntdll.dll error c0000135`。
> 即使本机装了系统 wine，交叉构建也只是"能跑通"，签名与 SmartScreen 信誉仍需在
> Windows 上处理。**Windows 安装包请在 Windows 上构建**——
> 用 `.github/workflows/build-windows.yml`（`windows-latest`，x64 + arm64），
> 或本地 Windows 机器上跑 `pnpm package:win`。
>
> 该工作流的**脚本合成本身已验证**：`packaging/windows/installer.nsh` 能被
> makensis 编译通过且零 warning（electron-builder 把 warning 当 error，
> 所以零 warning 即编译合格的硬证据）。在 Linux 上跑 `electron-builder --win nsis`
> 时，日志出现 `building target=nsis file=…` 而无任何 `warning`/`Error` 行，
> 就说明脚本没问题、只剩 wine 这一环；此时 release/ 下那个约 170 KB 的
> `PeanutSprout-Setup-*.exe` 是 `BUILD_UNINSTALLER` 中间产物
> （真正安装包约 80–100 MB），**不是可用安装包，不要分发**。

---

## 3. 形态 B：独立服务端二进制

### 3.1 两种交付方式

| 方式 | 产物 | 优点 | 代价 |
| --- | --- | --- | --- |
| B1 便携版（推荐先行） | `peanutsprout-<ver>-<os>-<arch>.tar.gz`（含 `dist/` 打包产物 + `start.sh`/`start.cmd`），依赖目标机已装 Node ≥ 22.5 | 简单、可读、易排查 | 需在目标机安装并锁定 Node |
| B2 单文件（Node SEA） | `peanutsprout-server`（Node SEA 打包，内联 Fastify 与全部 TS 产物）**⬜ 规划中，尚未产出** | 目标机零 Node 依赖 | SEA 仍属实验性能力；需按平台分别构建；调试不便 |

无论哪种方式，都用 `esbuild` 先做一次产物打包（`scripts/build-server.mjs`，产物落 `build/`，已 gitignore），把 TS 源码与 workspace 包内联成少量 ESM 文件。

### 3.2 目录约定（Linux 生产）

```
/opt/peanutsprout/          程序文件（只读）
/var/lib/peanutsprout/      数据目录（0700，含 peanutsprout.db、master.key、backups）
/var/log/peanutsprout/      日志（0700；或交由 journald）
/etc/peanutsprout/env       环境变量（0600）
```

### 3.3 systemd 单元（Linux）

```ini
# /etc/systemd/system/peanutsprout.service
[Unit]
Description=PeanutSprout server
Documentation=https://example.com/peanutsprout/docs
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=peanutsprout
Group=peanutsprout
WorkingDirectory=/opt/peanutsprout
EnvironmentFile=/etc/peanutsprout/env
# 可执行文件名是 peanutsprout（apps/cli/package.json 的 bin、apps/desktop/electron-builder.yml 的 executableName）。
# serve 只有 --host / --port / --no-web 三个专有选项（另有全局 --data-dir）；
# 初始化用 init —— serve --init-only 尚未实现（会以 "unknown option" 退出码 1 失败）。
ExecStartPre=/opt/peanutsprout/bin/peanutsprout init --data-dir /var/lib/peanutsprout
ExecStart=/opt/peanutsprout/bin/peanutsprout serve \
  --host 127.0.0.1 --port 8787 \
  --data-dir /var/lib/peanutsprout
Restart=on-failure
RestartSec=3
TimeoutStopSec=30
# 加固
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/peanutsprout
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

```bash
# /etc/peanutsprout/env（0600，属主 peanutsprout）
PEANUTSPROUT_HOME=/var/lib/peanutsprout
PEANUTSPROUT_HOST=127.0.0.1
PEANUTSPROUT_PORT=8787
PEANUTSPROUT_LOG_LEVEL=info
# 首次引导管理员（仅首次有效；不指定则用默认的 admin / 123456）
# 真实变量名是 PEANUTSPROUT_ADMIN_USERNAME / PEANUTSPROUT_ADMIN_PASSWORD（apps/server/src/config.ts）。
# 文档早期版本写的 PEANUTSPROUT_BOOTSTRAP_ADMIN / _PASSWORD 不存在，切勿照抄。
PEANUTSPROUT_ADMIN_USERNAME=admin
PEANUTSPROUT_ADMIN_PASSWORD=<强口令>
# 反向代理场景：服务端默认**不信任** X-Forwarded-*（trustProxy 默认 false，
# req.ip 取 TCP 对端地址）。要把真实客户端 IP 记进审计，需显式开启：
#   PEANUTSPROUT_TRUST_PROXY=true                 信任全部代理
#   PEANUTSPROUT_TRUST_PROXY=10.0.0.0/8,127.0.0.1 只信任指定网段（推荐）
# **开启的前提**是 8787 只对反代可达（bind 127.0.0.1 或防火墙），
# 否则任何人都能用 X-Forwarded-For 伪造来源 IP，见 docs/security.md §6。
```

```bash
sudo useradd --system --home /var/lib/peanutsprout --shell /usr/sbin/nologin peanutsprout
sudo install -d -m 0700 -o peanutsprout -g peanutsprout /var/lib/peanutsprout /var/log/peanutsprout
sudo systemctl daemon-reload && sudo systemctl enable --now peanutsprout
systemctl status peanutsprout --no-pager
curl -fsS http://127.0.0.1:8787/api/v1/health
```

### 3.4 Windows 服务

```powershell
# CLI 自身没有 --daemon / --pid-file（均为 ⬜ 规划中），推荐交给 WinSW / NSSM 托管为系统服务。
# 方式一：WinSW / NSSM（示例：WinSW）
#   <executable>C:\Program Files\PeanutSprout\peanutsprout.exe</executable>
#   <arguments>serve --host 127.0.0.1 --port 8787 --data-dir C:\ProgramData\PeanutSprout</arguments>
# 方式二：任务计划程序（Task Scheduler）以“系统启动”触发同一命令
peanutsprout.exe serve --host 127.0.0.1 --port 8787 `
  --data-dir C:\ProgramData\PeanutSprout
```

数据目录设 ACL：仅 `SYSTEM` 与 `PeanutSproutSvc` 用户可访问，禁用继承（与 `docs/security.md` §11 一致）。

### 3.5 macOS（launchd）

```xml
<!-- ~/Library/LaunchAgents/com.peanutsprout.server.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.peanutsprout.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/peanutsprout</string><string>serve</string>
    <string>--host</string><string>127.0.0.1</string>
    <string>--port</string><string>8787</string>
    <string>--data-dir</string><string>/Users/Shared/peanutsprout</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/Shared/peanutsprout/logs/launchd.out.log</string>
  <key>StandardErrorPath</key><string>/Users/Shared/peanutsprout/logs/launchd.err.log</string>
</dict></plist>
```

```bash
launchctl load -w ~/Library/LaunchAgents/com.peanutsprout.server.plist
```

---

## 4. 形态 C：Docker

### 4.1 镜像要求

| 要求 | 说明 |
| --- | --- |
| 基础镜像 | `node:24-bookworm-slim`（必须 ≥ 22.5 且使用官方镜像以获得 `node:sqlite`）；如需更小体积可用 `node:24-alpine`（musl，注意与 glibc 产物的差异） |
| 多阶段构建 | `builder`（安装依赖 + esbuild 打包）→ `runtime`（仅拷贝 `build/`、`package.json`、`packaging/`） |
| 非 root | 使用镜像内已有的 `node`（uid 1000）或新建 uid `10001`；`USER 10001:10001` |
| 数据卷 | `VOLUME /data`，`PEANUTSPROUT_HOME=/data`，属主 `10001` |
| 只读根 | 建议 `--read-only --tmpfs /tmp`，只挂 `/data` |
| 健康检查 | `HEALTHCHECK` 请求 `/api/v1/health`（无需认证，仅返回存活与版本，见 `apps/server/src/routes/meta.ts`） |
| 信号 | `STOPSIGNAL SIGTERM`，入口用 `exec` 形式（不用 shell 包装）以避免信号丢失 |
| 时间/编码 | `TZ=Asia/Shanghai`、`LANG=C.UTF-8` |

### 4.2 Dockerfile 骨架

```dockerfile
# ---------- builder ----------
FROM node:24-bookworm-slim AS builder
WORKDIR /src
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile
RUN node scripts/build-server.mjs          # 产出 build/server.mjs（内联 TS 源码）

# ---------- runtime ----------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PEANUTSPROUT_HOME=/data \
    PEANUTSPROUT_HOST=0.0.0.0 \
    PEANUTSPROUT_PORT=8787 \
    PEANUTSPROUT_LOG_LEVEL=info \
    LANG=C.UTF-8
RUN groupadd -g 10001 peanut && useradd -u 10001 -g 10001 -m -s /usr/sbin/nologin peanut \
 && mkdir -p /data /opt/peanutsprout \
 && chown -R 10001:10001 /data /opt/peanutsprout
WORKDIR /opt/peanutsprout
COPY --from=builder --chown=10001:10001 /src/build/ ./
USER 10001:10001
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
STOPSIGNAL SIGTERM
# 注意：build/server.mjs（即 apps/server/src/main.ts）**不解析命令行参数**，只读环境变量
# （apps/server/src/config.ts）。因此监听地址/端口/数据目录必须由上面的 ENV 提供，
# 写成 `CMD ["serve","--host","0.0.0.0",…]` 会被静默忽略（源码缺陷，已在报告中标出）。
ENTRYPOINT ["node", "/opt/peanutsprout/server.mjs"]
```

> 注意：容器内必须显式 `--host 0.0.0.0`，且**只能**通过反代暴露；直接在宿主机暴露 `8787` 明文端口属于不安全部署。

### 4.3 docker compose（含反代与备份 sidecar）

```yaml
# docker-compose.yml
services:
  peanutsprout:
    image: ghcr.io/example/peanutsprout:0.1.0
    restart: unless-stopped
    environment:
      PEANUTSPROUT_HOME: /data
      PEANUTSPROUT_HOST: 0.0.0.0
      PEANUTSPROUT_PORT: "8787"
      PEANUTSPROUT_ADMIN_USERNAME: admin
      PEANUTSPROUT_ADMIN_PASSWORD: ${PEANUTSPROUT_ADMIN_PASSWORD:?必须显式提供强口令}
      TZ: Asia/Shanghai
    volumes:
      - peanut-data:/data
    read_only: true
    tmpfs: ["/tmp"]
    expose: ["8787"]
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8787/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
    networks: [peanut]

  nginx:
    image: nginx:1.27-alpine
    restart: unless-stopped
    depends_on: [peanutsprout]
    ports: ["80:80", "443:443"]
    volumes:
      - ./nginx/peanutsprout.conf:/etc/nginx/conf.d/default.conf:ro
      - ./certs:/etc/nginx/certs:ro
    networks: [peanut]

  backup:
    image: ghcr.io/example/peanutsprout:0.1.0
    restart: unless-stopped
    # 由容器内的 node:sqlite 在线备份 API 做一致性快照，避免直接拷贝 WAL 中的库文件；
    # 主机侧用 cron 调 `docker compose exec backup /opt/peanutsprout/bin/backup.sh`，
    # 或改用 §7.2 的主机脚本 + 卷快照（推荐）。
    entrypoint: ["/bin/sh", "-c"]
    command: ["/opt/peanutsprout/bin/backup-loop.sh"]   # 内部：while true; do backup.sh; sleep 86400; done
    volumes:
      - peanut-data:/data
      - ./backups:/backups
    networks: [peanut]

volumes:
  peanut-data:
networks:
  peanut:
```

### 4.4 编排注意

| 项 | 说明 |
| --- | --- |
| 单写者 | 元数据库是 SQLite：**同一数据卷只能有一个写入实例**（`replicas: 1`）。多副本会导致锁冲突与审计链断裂 |
| 主密钥 | 首次启动在卷内生成 `master.key`；卷丢失即密文不可恢复 → 必须纳入备份（§7） |
| 升级 | 使用不可变 tag（`0.1.0`/`sha-…`），禁止 `latest` 上生产；升级前自动备份（§7.3） |
| 时区 | 审计时间统一存 UTC（ISO8601），展示层按 `TZ` 渲染；数据库内不做本地时间 |
| 资源 | 建议 `--memory 1g` 起；大结果集导出/导入时上限提高，注意 SQLite 与结果缓冲内存 |

---

## 5. 反向代理（Nginx）

### 5.1 关键要求

1. **HTTPS 终结**：80 → 301 到 443；仅 443 提供业务。
2. **WebSocket / SSE 升级头**：服务端当前**尚未实现** WebSocket（`/ws`）与流式查询（`/api/v1/query/stream`）—— 二者为 ⬜ 规划中，对应的 `location` 块可先保留作占位，但不会有真实流量。已实现的 AI 接口是普通 JSON 请求/响应，不需要 SSE 升级头。
3. **请求体上限**：导入/连接导入需要较大的 `client_max_body_size`（建议 1–2 GB，按需收紧）。
4. **超时**：长查询与迁移应用需要长 `proxy_read_timeout`（如 3600s），否则反代会在查询完成前断开。
5. **信任链**：服务端默认**不信任**任何转发头（`trustProxy: false`，见 `apps/server/src/config.ts`），`req.ip` 取 TCP 对端地址，因此伪造 `X-Forwarded-For` 不会污染审计。确实部署在反向代理之后时，用 `PEANUTSPROUT_TRUST_PROXY` 显式开启——`true` 信任全部代理，或写成 `10.0.0.0/8,127.0.0.1` 这样的网段列表只信任自己的反代（推荐）。**开启后**必须保证后端端口只对反代可达（如 `--host 127.0.0.1` 或防火墙），否则任何人都能伪造来源 IP 污染审计并绕过按 IP 的登录限流（见 `docs/security.md` §6）。

### 5.2 完整示例

```nginx
# /etc/nginx/conf.d/peanutsprout.conf
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

upstream peanutsprout_backend {
    server 127.0.0.1:8787;
    keepalive 32;
}

# 80 → 443
server {
    listen 80;
    listen [::]:80;
    server_name peanut.example.com;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name peanut.example.com;

    ssl_certificate     /etc/letsencrypt/live/peanut.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/peanut.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
    ssl_prefer_server_ciphers off;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;
    ssl_stapling on;
    ssl_stapling_verify on;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options    "nosniff" always;
    add_header Referrer-Policy           "no-referrer" always;
    add_header X-Frame-Options           "DENY" always;

    client_max_body_size 2048m;      # 导入大数据集；按需收紧
    client_body_timeout  3600s;

    # ---------- 静态前端（若由 Nginx 托管 apps/web 产物） ----------
    root /var/www/peanutsprout;
    index index.html;
    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
    location / {
        try_files $uri $uri/ /index.html;    # SPA history 路由回退
    }

    # ---------- API ----------
    location /api/ {
        proxy_pass http://peanutsprout_backend;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header Upgrade           $http_upgrade;      # WS/SSE 升级
        proxy_set_header Connection        $connection_upgrade;
        proxy_buffering off;                                    # SSE 必须关闭缓冲
        proxy_cache off;
        proxy_read_timeout  3600s;
        proxy_send_timeout  3600s;
        proxy_connect_timeout 10s;
        gzip off;                                               # 避免压缩破坏流式
    }

    # ---------- SSE 流式查询（⬜ 规划中：服务端尚未实现 /api/v1/query/stream） ----------
    location /api/v1/query/stream {
        proxy_pass http://peanutsprout_backend;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        proxy_read_timeout 7200s;
        add_header X-Accel-Buffering no;
    }

    # ---------- WebSocket（⬜ 规划中：服务端尚未实现 /ws） ----------
    location /ws {
        proxy_pass http://peanutsprout_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host       $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # ---------- 健康检查（不对外暴露细节；真实路径是 /api/v1/health） ----------
    location = /api/v1/health {
        proxy_pass http://peanutsprout_backend;
        access_log off;
    }
}
```

### 5.3 Caddy 等价配置（更省心，自动证书）

```caddyfile
peanut.example.com {
    encode zstd gzip
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "no-referrer"
    }
    # ⬜ 规划中：/api/v1/query/stream 与 /ws 服务端均未实现，以下仅为未来占位
    @stream path /api/v1/query/stream /api/v1/ai/*
    handle @stream {
        reverse_proxy 127.0.0.1:8787 {
            flush_interval -1          # 立即 flush，等价 proxy_buffering off
            transport http { read_timeout 7200s }
        }
    }
    handle /ws* {
        reverse_proxy 127.0.0.1:8787
    }
    handle {
        reverse_proxy 127.0.0.1:8787
    }
}
```

### 5.4 验证清单

| 检查 | 命令/方法 |
| --- | --- |
| HTTPS 生效 | `curl -sSI https://peanut.example.com/api/v1/health` 返回 200 且无证书告警 |
| HTTP 跳转 | `curl -sSI http://peanut.example.com/` 返回 301 |
| SSE 不缓冲 | ⬜ 规划中：`/api/v1/query/stream` 尚未实现，暂无可验证对象 |
| WS 升级 | ⬜ 规划中：`/ws` 尚未实现，暂无可验证对象 |
| 来源 IP 正确 | 默认 `trustProxy: false` 时 `clientIp` 是 TCP 对端地址（不可伪造）；若设了 `PEANUTSPROUT_TRUST_PROXY` 则须确保 8787 仅反代可达 |
| 大文件导入 | 超过 1 GB 的导入不被 413 拒绝 |
| 安全头 | `curl -sSI https://…/` 含 HSTS/nosniff/Referrer-Policy |

---

## 6. HTTPS 证书

### 6.1 公网域名（Let's Encrypt / certbot）

```bash
# Debian/Ubuntu
sudo apt-get update && sudo apt-get install -y certbot python3-certbot-nginx
# 先用 webroot 校验（Nginx 已就绪，见 §5.2 的 acme-challenge location）
sudo certbot certonly --webroot -w /var/www/certbot -d peanut.example.com --email ops@example.com --agree-tos --no-eff-email
# 通配符（需 DNS 插件，适合多子域）
sudo certbot certonly --manual --preferred-challenges dns -d '*.example.com' -d example.com
# 自动续期（systemd timer 通常已随包启用）
systemctl list-timers | grep certbot
sudo certbot renew --dry-run
# 续期后重载 Nginx
echo 'deploy-hook = systemctl reload nginx' | sudo tee -a /etc/letsencrypt/cli.ini
```

要求：证书私钥仅 root 可读；`ssl_certificate` 用 `fullchain.pem`（含中间证书），否则部分客户端链校验失败；证书到期前 30 天告警。

### 6.2 内网自签名 / 私有 CA

```bash
# 私有 CA（一次性）
openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
  -keyout peanut-ca.key -out peanut-ca.crt -subj "/CN=PeanutSprout Internal CA"
# 服务端证书（SAN 必须包含实际访问域名/IP）
openssl req -newkey rsa:2048 -nodes -keyout peanut.key -out peanut.csr \
  -subj "/CN=peanut.intra.example.com"
openssl x509 -req -in peanut.csr -CA peanut-ca.crt -CAkey peanut-ca.key -CAcreateserial \
  -out peanut.crt -days 825 -sha256 \
  -extfile <(printf "subjectAltName=DNS:peanut.intra.example.com,IP:10.0.0.20\nextendedKeyUsage=serverAuth")
chmod 600 peanut.key
```

- 把 `peanut-ca.crt` 分发到所有客户端信任库（系统钥匙串 / 浏览器 / `NODE_EXTRA_CA_CERTS`）。
- CLI 可用 `--ca-file` 指定 CA，或用标准变量 `NODE_EXTRA_CA_CERTS=/path/peanut-ca.crt` 导入信任链；**不建议**长期使用 `--insecure`。
- 桌面端（Electron）在「设置 → 网络」中可导入自定义 CA。

### 6.3 自动更新凭据

| 项 | 建议 |
| --- | --- |
| 续期 | certbot systemd timer；或 acme.sh + 定时任务 |
| 重载 | `deploy-hook` 中 `systemctl reload nginx`（reload 不断连接） |
| 监控 | 到期 < 21 天告警；`curl` 校验链完整性（`openssl s_client -connect … -servername …`） |
| 服务端自身 | 若让服务端直接终结 TLS，用环境变量 `PEANUTSPROUT_TLS_KEY` / `PEANUTSPROUT_TLS_CERT`（`apps/server/src/config.ts`；**没有** `--tls-cert/--tls-key/--https` 这些 serve 选项）。证书更新后需重启进程：当前只注册了 `SIGINT`/`SIGTERM`，`SIGHUP` 重载 ⬜ 规划中 |

---

## 7. 数据目录、备份与恢复

### 7.1 数据目录布局

| 路径 | 内容 | 权限 |
| --- | --- | --- |
| `~/.peanutsprout/` | 数据根目录 | `0700` |
| `~/.peanutsprout/peanutsprout.db`（+ `-wal`、`-shm`） | 元数据库（连接配置密文、用户、会话、审计链、迁移历史） | `0600` |
| `~/.peanutsprout/master.key` | 主密钥（32 字节） | `0600` |
| `~/.peanutsprout/logs/` | ⬜ 规划中：当前服务端日志走 stdout（容器里交给 Docker，systemd 交给 journald），**没有**按天滚动写文件 | — |
| `~/.peanutsprout/backups/` | 手动/自动备份 | `0700`/`0600` |
| `~/.peanutsprout/cli.json`、`cli-token` | CLI 配置与令牌 | `0600` |
| `./diag-*.zip` | 诊断包：⬜ 规划中（当前只有 `peanutsprout diagnose --out <path>` 导出单个 JSON，不打包压缩） | `0600` |

SQLite 运行参数（启动时设置，实现见 `packages/storage`）：`journal_mode=WAL`、`synchronous=NORMAL`、`foreign_keys=ON`、`busy_timeout=5000`。

### 7.2 备份

**必须用一致性方式**，禁止在服务运行时直接 `cp peanutsprout.db`（WAL 中的数据不在主文件里，会得到损坏或过期的副本）。

| 方式 | 命令/做法 | 适用 |
| --- | --- | --- |
| 在线备份（推荐） | 下面 §7.2 的脚本：`node:sqlite` 的 `backup(sourceDb, destPath)` API，或 SQLite `VACUUM INTO '<dest>'` | 服务运行中 |
| CLI 备份 | ⬜ 规划中：`peanutsprout diagnose` 只导出诊断 JSON，**不**做数据备份；`peanutsprout conn export` / `system backup` 均不存在。当前请用下面的脚本 | 日常 |
| 文件级快照 | 先 `PRAGMA wal_checkpoint(TRUNCATE)`（或停服）再拷贝 `peanutsprout.db` | 冷备份 |
| 卷快照 | 云盘/LVM 快照，需在快照前 checkpoint 或短暂停写 | 基础设施层 |

备份脚本示例（服务运行中，一致性快照 + 加密 + 轮转）：

```bash
#!/usr/bin/env bash
# /opt/peanutsprout/bin/backup.sh   —— 由 cron: 10 3 * * * 执行
set -euo pipefail
DATA_DIR=/var/lib/peanutsprout
DEST=/backup/peanutsprout
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$DEST"; chmod 700 "$DEST"

# 1) 一致性快照（node 内置 sqlite，无第三方依赖）
node -e '
const { DatabaseSync, backup } = require("node:sqlite");
const [src, dst] = process.argv.slice(1);
const db = new DatabaseSync(src, { readOnly: true });
backup(db, dst).then(() => { db.close(); }).catch((e) => { console.error(e); process.exit(1); });
' "$DATA_DIR/peanutsprout.db" "$DEST/peanutsprout-$STAMP.db"

# 2) 密钥单独存放（与数据库分开介质；否则密文备份等于明文备份）
install -m 600 "$DATA_DIR/master.key" "$DEST/master-$STAMP.key"

# 3) 加密（推荐；口令由外部密钥管理提供，不写进脚本）
# age -r "$BACKUP_AGE_PUBKEY" -o "$DEST/peanutsprout-$STAMP.db.age" "$DEST/peanutsprout-$STAMP.db"
# rm -f "$DEST/peanutsprout-$STAMP.db"

# 4) 保留策略：14 日备 + 8 周备 + 12 月备
find "$DEST" -name 'peanutsprout-*.db' -mtime +14 -not -name '*-weekly-*' -delete
echo "[backup] ok $STAMP"
```

**备份内容矩阵**

| 内容 | 是否必须 | 说明 |
| --- | --- | --- |
| `peanutsprout.db` | ✅ | 元数据库 |
| `master.key` | ✅ | 缺失则密文永久不可解；**与库分离保存**（不同介质/不同凭据） |
| `logs/` | 可选 | 排障用；含敏感度较低但仍有信息的运行记录 |
| 连接导出文件（`*.pspenc`） | 可选 | 口令保护的配置迁移用 |
| 结果集/业务数据 | ❌ | 不在本机留存，不做备份对象 |

### 7.3 恢复

```bash
# 1) 停服（避免双写）
sudo systemctl stop peanutsprout

# 2) 备份当前（失败也要留证据）
mv /var/lib/peanutsprout/peanutsprout.db /var/lib/peanutsprout/peanutsprout.db.broken.$(date +%s)

# 3) 还原（先解密，若备份加密）
# age -d -i /etc/peanutsprout/backup.key -o /tmp/restore.db /backup/peanutsprout-<stamp>.db.age
install -m 600 -o peanutsprout -g peanutsprout /backup/peanutsprout-<stamp>.db /var/lib/peanutsprout/peanutsprout.db

# 4) 还原主密钥（必须是同一版本！换密钥会导致旧密文无法解密）
install -m 600 -o peanutsprout -g peanutsprout /backup/master-<stamp>.key /var/lib/peanutsprout/master.key

# 5) 启动并验证
sudo systemctl start peanutsprout
peanutsprout diagnose --out /tmp/diag.json   # 导出诊断 JSON（doctor/bundle 子命令 ⬜ 规划中）
peanutsprout audit verify                    # 审计链完整性（无 --full，默认整链校验）
peanutsprout conn test <连接id>              # 抽样验证密文可解密且连接可用（参数是数字 id）
```

**恢复演练要求**：每季度至少一次在隔离环境完成「备份 → 还原 → 校验审计链 → 抽样连接测试」，并记录耗时（作为 RTO 依据）。

### 7.4 迁移到新机器 / 形态间搬迁

1. 目标机安装同版本（或更高，但需先看 §12 升级说明）。
2. 停源服务（或对数据库做在线快照 + 记录 checkpoint 的 `seq`）。
3. 拷贝整个数据目录（含 `master.key`）→ 目标机同路径；POSIX 权限 `0700/0600`，Windows 重设 ACL。
4. 若目标机 Node 版本不同：先跑 `peanutsprout diagnose`（`doctor` 子命令 ⬜ 规划中）；`node:sqlite` 的库文件格式向上兼容，跨大版本升级前务必先备份。
5. 校验：`audit verify`、`user list`、随机 3 个连接 `conn test`、一次只读查询。
6. 轮换：迁移完成后建议轮换所有连接口令与 AI Key（旧介质上的密文可能已扩散）。

---

## 8. 多架构打包矩阵

### 8.1 桌面端（Electron + electron-builder）

| 平台 \ 架构 | x86_64 | arm64 | 备注 |
| --- | --- | --- | --- |
| **Windows** | ✅ `nsis` + `portable` | ✅ `nsis`（arm64） | Windows on ARM 需在 arm64 机器或 CI 上构建；`portable` 不支持自动更新 |
| **Linux** | ✅ `AppImage` + `deb` + `rpm` | ✅ 同上 | 官方二进制品按 glibc 构建；Alpine/musl 需单独构建（或在容器内运行 deb） |
| **macOS** | ✅ `dmg` + `zip` | ✅ `dmg` + `zip`（或 universal 合并） | 必须签名 + 公证；universal 包体积约为单架构 2 倍 |

> 逐条命令、产物文件名与实测记录见 **§14**。

### 8.2 服务端 / CLI

| 平台 \ 架构 | x86_64 | arm64 | 产物 |
| --- | --- | --- | --- |
| Windows | ✅ | ✅ | `peanutsprout-<ver>-win-<arch>.zip`（含 `peanutsprout.exe`） |
| Linux (glibc) | ✅ | ✅ | `.tar.gz`；Docker 镜像 `linux/amd64`、`linux/arm64` |
| Linux (musl) | ✅（可选） | ✅（可选） | Alpine 变体 tar.gz |
| macOS | ✅ | ✅ | `.tar.gz`；Homebrew tap（可选） |

### 8.3 构建与 CI 要求

| 项 | 要求 |
| --- | --- |
| 原生构建 | 🚫 **交叉构建不作为主路径**：在各自原生 runner 上构建（GitHub Actions 的 `windows-latest`/`ubuntu-latest`/`macos-14`(arm64) + `macos-13`(x64) 矩阵）。因零原生依赖，产物中不含 `.node`，但仍需平台特定的 Electron/打包工具 |
| Node 版本矩阵 | 构建与测试覆盖 `22.x` 与 `24.x`；发布产物固定使用锁定版本并在 `doctor` 中明示 |
| 确定性 | `pnpm install --frozen-lockfile`；产物记录 build-id 与 git SHA；`SOURCE_DATE_EPOCH` 用于可复现构建（尽力而为） |
| 签名 | Windows Authenticode（EV 证书更优，避免 SmartScreen 警告）；macOS Developer ID + `notarytool` 公证；Linux 用 GPG 签名 `deb`/`rpm` 与发布包 `sha256sum` |
| 体积 | 桌面安装包目标 ≤ 150 MB；服务端 tar.gz ≤ 30 MB；超出阈值需在 PR 中说明 |
| 产物清单 | 每个 Release 附 `checksums.txt`、SBOM（`pnpm licenses list`/CycloneDX）、`diag` 使用说明、升级说明 |

**Windows 桌面安装包的实际入口**：`.github/workflows/build-windows.yml`
（`windows-latest`，`electron-builder --win nsis --x64 --arm64`，
生成 `SHA256SUMS-windows.txt`，推 `v*` 标签时自动附到 Release）。
手动触发（Actions 页面 `Run workflow`）与 PR 改动打包相关文件时也会跑。
选在 Windows 上构建的原因见 §2.3 的告警框：Linux 交叉构建依赖的 wine 工具链是残缺的。

示例 CI 矩阵（YAML 片段）：

```yaml
strategy:
  fail-fast: false
  matrix:
    include:
      - os: ubuntu-latest
        target: linux-x64
      - os: ubuntu-24.04-arm
        target: linux-arm64
      - os: windows-latest
        target: win-x64
      - os: windows-11-arm
        target: win-arm64
      - os: macos-13
        target: mac-x64
      - os: macos-14
        target: mac-arm64
```

---

## 9. 自动更新

### 9.1 桌面端（electron-updater）

| 项 | 设计 |
| --- | --- |
| 更新源 | `latest.yml`（Windows）/ `latest-mac.yml`（macOS）/ `latest-linux.yml`（AppImage）托管于 HTTPS 静态站点或 GitHub Releases；支持 `stable`/`beta` 通道 |
| 流程 | 启动后延迟检查 → 发现新版本提示 → 后台下载（带进度）→ 「重启并安装」→ 退出前**自动备份数据目录** → 应用更新 → 启动后跑自检与 schema 迁移（`diagnose doctor` 为 ⬜ 规划中） |
| 校验 | 更新包 sha256 与发布者签名双校验，失败即中止并保留旧版本 |
| 回滚 | 保留上一版本安装包路径；`update rollback` 还原程序与数据快照 |
| 静默策略 | 默认**不静默**安装；企业可通过策略文件强制「仅提示不自动安装」 |
| 数据兼容 | 更新只做前进式 schema 迁移；跨大版本升级前强制备份（失败则中止更新） |

### 9.2 CLI / 服务端（`peanutsprout update`）

**已实现**（仅版本检查，`apps/cli/src/index.ts` 的 `update check`）：

```bash
peanutsprout update check                 # 输出文本
peanutsprout update check -o json         # 输出 JSON（无 --channel 选项）
PEANUTSPROUT_UPDATE_MANIFEST=https://example.com/manifest.json peanutsprout update check
```

行为：读取 `PEANUTSPROUT_UPDATE_MANIFEST` 指向的 JSON 清单（`{ version, notes?, url? }`），做语义化版本比较；
**未配置更新源时如实告知"无法判断"，不会假装已是最新**；发现新版本时退出码 `13`。

**未实现（⬜ 规划中，照抄下面的命令会报 unknown command）**：

```bash
peanutsprout update download --out /tmp/peanutsprout-update          # ⬜ 规划中
peanutsprout update apply --file <pkg> --backup --yes --restart      # ⬜ 规划中
peanutsprout update rollback --to 0.1.0 --yes                         # ⬜ 规划中
```

规划要求：① `apply` 前必须备份；② 校验 sha256 + 签名；③ 支持离线更新包（`--file`）；④ 更新写审计（含 `from/to` 版本、`backupPath`、结果）；⑤ 失败自动回滚到备份并重启旧版本。

### 9.3 容器 / 服务端滚动更新

| 场景 | 做法 |
| --- | --- |
| Docker Compose | `docker compose pull && docker compose up -d`；升级前先按 §7.2 做一致性备份（`peanutsprout diagnose bundle` ⬜ 规划中，当前用 `diagnose --out` + 备份脚本）；`replicas` 必须为 1（SQLite 单写者） |
| systemd | 停服 → 备份 → 替换 `/opt/peanutsprout` → 启动 → `peanutsprout diagnose`（`doctor` ⬜ 规划中）→ `peanutsprout audit verify` |
| 停机窗口 | schema 迁移在启动时自动执行；大版本升级建议预留维护窗口并公告 |
| 回滚触发条件 | 启动失败、迁移失败、审计链校验失败、关键连接测试失败、健康检查连续 3 次失败 |

---

## 10. 诊断包导出

> **现状**：CLI 只实现了 `peanutsprout diagnose [--out <path>]` —— 拉取 `GET /api/v1/meta/diagnostics`
> 并原样输出（缺省打印到 stdout）。本节下面的 `doctor` / `bundle` 子命令、打包成 zip、
> 服务端 `POST /api/v1/system/diagnose` 接口**均为 ⬜ 规划中**，当前不存在。

### 10.1 导出方式（已实现部分）

```bash
# CLI（唯一已实现的形式）
peanutsprout diagnose                     # 打印诊断 JSON 到 stdout
peanutsprout diagnose --out ./diag.json   # 写入文件
```

规划中的形式（⬜ **不可照抄**）：

```text
peanutsprout diagnose doctor                                  # ⬜ 规划中：只做体检，不打包
peanutsprout diagnose bundle                                  # ⬜ 规划中：diag-<version>-<ts>.zip
peanutsprout diagnose bundle --include-logs 7 --out ./diag.zip  # ⬜ 规划中
# 服务端 POST /api/v1/system/diagnose（需 system:diagnose）      ⬜ 规划中，路由不存在
```

### 10.2 诊断 JSON 现有内容（`GET /api/v1/meta/diagnostics`）

实现见 `apps/server/src/routes/meta.ts`，当前返回：`generatedAt`、`product`、`runtime`、`storage`、
`drivers`、`connections`（元信息，无口令/密文）、`liveConnections`、`auditChain`。

### 10.3 规划中的压缩包内容（⬜ 本期未实现）

| 文件 | 内容 |
| --- | --- |
| `manifest.json` | 生成时间、版本、平台/架构、数据目录（**只写基名或脱敏路径**）、导出者、包含项清单 |
| `system.json` | OS、内核、CPU/内存/磁盘余量、Node 版本、Electron 版本（桌面）、时区 |
| `versions.json` | CLI/服务端/schema/驱动矩阵 |
| `config-summary.json` | 生效配置摘要（监听地址、日志级别、只读开关）；**凭据字段一律 `«REDACTED»`** |
| `health.json` | `/api/v1/health` 与服务内部自检结果 |
| `schema.json` | 元数据库 schema 版本、迁移历史摘要、表行数统计（不含数据内容） |
| `audit-verify.json` | 审计链校验结论（`ok/checked/brokenAtSeq/reason`） |
| `logs/*.log` | 最近 N 天日志（已脱敏、已轮转）—— 依赖日志落盘能力，同为 ⬜ 规划中 |
| `doctor.txt` | `diagnose doctor` 的人类可读输出 |

### 10.4 禁止包含（硬性，适用于现有 JSON 与未来压缩包）

`master.key` 及其内容、任何明文凭据、`connections.*_enc` 密文 BLOB、`ai_providers.api_key_enc`、`users.password_hash`、`sessions` 表行、`cli-token`、查询结果集、任何连接字符串。导出前做一次关键字扫描（`password|secret|token|api[_-]?key|BEGIN .*PRIVATE KEY`），命中即中止导出并报错（视为打包器缺陷）。

---

## 11. 首次启动初始化

### 11.1 顺序（`peanutsprout serve` / 桌面端首次运行共用同一实现）

| # | 步骤 | 细节 |
| --- | --- | --- |
| 1 | 解析数据目录 | `PEANUTSPROUT_HOME`（CLI 的 `--data-dir` 会写入它）> `~/.peanutsprout`；不存在则以 `0700` 创建（`packages/core/src/paths.ts` 的 `resolveDataDir()` / `ensureDataDir()`：`mkdirSync(recursive, mode: 0o700)`） |
| 2 | 权限收敛 | `ensureDataDir()` 每次启动都对数据目录 `chmod 0700`（best-effort，Windows 上忽略）；**当前不会因权限过宽而拒绝启动**（拒绝启动属 ⬜ 规划中） |
| 3 | 生成主密钥 | 无 `master.key` → `crypto.randomBytes(32)` 写入（`0600`，`O_NOFOLLOW`）；若用户选择主密码模式，则改为以 scrypt 派生 KEK 包裹数据密钥并写 `settings.master_key_wrapped` |
| 4 | 建库与迁移 | 打开 `peanutsprout.db`，设置 PRAGMA（WAL/foreign_keys/busy_timeout），按序执行内置迁移到最新 schema 版本；记录 `schema_version` |
| 5 | 初始化 RBAC | 写入内置角色与权限码、`role_permissions` 映射（幂等 upsert） |
| 6 | 生成 JWT 子密钥 | `hkdf(masterKey, 'jwt-hs256')`，不落盘明文（或加密存 `settings`） |
| 7 | 引导管理员 | 默认创建 `admin` / `123456`（`DEFAULT_ADMIN_USERNAME` / `DEFAULT_ADMIN_PASSWORD`，见 `packages/storage/src/index.ts` 的 `ensureAdminUser()`）；**仅当实际口令等于内置默认口令 `123456` 时**才置 `security.must_change_password = true`。通过 `PEANUTSPROUT_ADMIN_USERNAME` / `PEANUTSPROUT_ADMIN_PASSWORD`（或 CLI `init --password-stdin`）指定了自定义口令时置 `false`，**不再要求改密**。**口令强度只校验长度（≥6 位）**，见 `docs/security.md` |
| 8 | 写创世审计 | `action='system.init'`，`prevHash = '0'×64`，`detail` 含版本与平台；这是审计链的第 1 条 |
| 9 | 启动监听 | 绑定地址/端口；打印监听地址、数据目录、schema 版本、可用驱动列表；**不打印任何令牌/口令** |
| 10 | 健康检查 | 自身 `GET /api/v1/health` 通过后视为启动成功；桌面端据此显示主界面 |

> **默认口令强制改密闸门**（`apps/server/src/http.ts`）：当 `security.must_change_password = true` 时，
> 除 `POST /auth/change-password`、`POST /auth/logout`、`POST /auth/refresh`、`GET /auth/me`
> 这 4 个接口外，其余请求一律返回 **`403 PASSWORD_CHANGE_REQUIRED`**。因此用过默认口令的部署，
> 必须先完成改密才能调用其他接口。

### 11.2 幂等性

- 所有步骤可重复执行：主密钥存在即跳过生成；迁移按版本号跳过已应用项；内置角色 upsert；创世审计只写一次（`seq=1` 存在即跳过）。
- **仅初始化不启动**：目前用 `peanutsprout init`（CLI 已实现，适合容器 `ExecStartPre` / 部署脚本）。`peanutsprout serve --init-only` **尚未实现**（⬜ 规划中），照抄会以 `unknown option` 退出码 1 失败。

### 11.3 引导管理员示例

```bash
# 方式一：先初始化数据目录与管理员，再启动服务（推荐，非交互）
peanutsprout init --data-dir ~/.peanutsprout --username admin --password-stdin
peanutsprout serve --data-dir ~/.peanutsprout

# 方式二：只启动服务；首次启动会自动建库并引导管理员
#   - 未提供 PEANUTSPROUT_ADMIN_PASSWORD 时创建 admin / 123456，
#     并置 must_change_password=true（登录后必须先改密，否则其他接口 403 PASSWORD_CHANGE_REQUIRED）
#   - 提供了自定义口令时不要求改密
#   启动横幅只打印一次初始口令（若为默认口令则提示立即修改）。
peanutsprout serve --data-dir ~/.peanutsprout

# 非交互式（容器；真实变量名是 PEANUTSPROUT_ADMIN_USERNAME / PEANUTSPROUT_ADMIN_PASSWORD）
docker run -e PEANUTSPROUT_ADMIN_USERNAME=admin \
           -e PEANUTSPROUT_ADMIN_PASSWORD='<强口令>' \
           -v peanut-data:/data -p 127.0.0.1:8787:8787 ghcr.io/example/peanutsprout:0.1.0
# 或不指定，直接用默认口令 admin / 123456（登录后强制修改）
```

> **注意**：当前没有"交互式初始化向导"（逐项询问目录/口令/端口）—— 那是 ⬜ 规划中；
> 真实行为是上面两种：`init` 命令，或 `serve` 首次启动时按环境变量/默认值自动创建。

### 11.4 常见首次启动问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 启动报「数据目录权限过宽」 | 目录为 `0755` 或属主不对 | `chmod 700 ~/.peanutsprout && chown $USER ~/.peanutsprout` |
| 报 `MASTER_KEY_LOCKED` | 启用了主密码且未解锁 | 通过 GUI 解锁或 CLI 提供主密码 `--master-password-stdin` |
| 报 `SQLITE_CANTOPEN` | 数据目录不存在/不可写、容器卷属主错 | 检查卷属主（应为 `10001`）与 `PEANUTSPROUT_HOME` |
| 端口占用 | 8787 被其他程序占用 | 换端口 `--port 8788` 或释放占用；桌面端会自动回退随机端口并在「关于」中显示 |
| 忘记主密码 | 数据密钥被包裹且无记录 | 只能从**升级前备份**或 `master.key`（若曾导出）恢复；否则密文不可逆。这是设计取舍，务必在启用前提示用户备份 |

---

## 12. 升级、回滚与运行手册

### 12.1 升级前检查清单

1. `peanutsprout version` 记录当前版本（JSON 用全局 `-o json`；**没有** `--json` 选项）。
2. `peanutsprout diagnose --out /tmp/diag.json`（`doctor` ⬜ 规划中）；`peanutsprout audit verify` 通过。
3. 一致性备份（含 `master.key`，分开介质）；记录备份路径与时间。
4. 阅读 Release Notes 中的「破坏性变更 / 需要手动迁移」条目。
5. 在测试环境用生产库的**结构快照**（`migrate diff` ⬜ 规划中；当前可用 `migrate precheck` 看结构映射与有损类型）验证新版本迁移脚本。
6. 公告维护窗口；确认回滚路径（旧版本程序包 + 数据快照）。

### 12.2 回滚

```bash
systemctl stop peanutsprout
# 还原数据快照与 master.key（必须同一版本）
install -m 600 -o peanutsprout -g peanutsprout /backup/peanutsprout-<stamp>.db /var/lib/peanutsprout/peanutsprout.db
install -m 600 -o peanutsprout -g peanutsprout /backup/master-<stamp>.key /var/lib/peanutsprout/master.key
# 换回旧版本程序
tar -xzf /opt/peanutsprout-prev/peanutsprout-<oldver>.tar.gz -C /opt/peanutsprout
systemctl start peanutsprout
peanutsprout diagnose --out /tmp/diag.json && peanutsprout audit verify
```

注意：**schema 迁移通常不可逆**（回滚依赖数据快照而非 `down` SQL），因此备份是回滚的唯一可靠前提。

### 12.3 故障排查速查

| 症状 | 排查 |
| --- | --- |
| 502/504（反代） | 后端进程是否存活（`systemctl status`）；确认已按需设置 `PEANUTSPROUT_TRUST_PROXY`，且反代是覆盖而不是追加 `X-Forwarded-For`；超时是否需调大 |
| 登录 401 循环 | 服务器时钟偏移（JWT `nbf/exp`）；令牌是否被 `sessions` 吊销；浏览器是否禁用了存储 |
| 写操作 403 | 连接 `read_only`、生产库策略、权限码缺失或资源授权不足；若为 `PASSWORD_CHANGE_REQUIRED` 则先改初始口令 |
| 写操作 428 / CLI 退出 9 | 缺少二次确认（GUI 二次弹窗 / `--yes`） |
| 查询超时 | 服务端没有全局 `queryTimeoutMs` 配置；按请求的 `timeoutMs`、驱动/数据库侧超时与反代 `proxy_read_timeout` 排查 |
| SQLite `SQLITE_BUSY` | 是否有第二个实例写同一库；`busy_timeout` 是否生效；把长事务拆小 |
| 磁盘写入失败 | 磁盘满（SQLite 需要 WAL 空间）；用 `df` 检查余量并清理备份/临时文件 |
| 审计链断裂 | `peanutsprout audit verify` 定位 `seq`；导出区间证据；检查是否有外部工具直接改了库文件 |
| 密文无法解密 | `master.key` 被替换或 `key_version` 不匹配；用备份中的同版本密钥恢复 |
| 桌面端白屏 | 端口回退后 renderer 是否拿到新端口；CSP 是否拦截资源；打开 DevTools 查看 `console` |

### 12.4 运行参数建议（生产）

| 项 | 建议值 |
| --- | --- |
| 监听 | `--host 127.0.0.1`（serve 选项；反代前置） |
| 日志 | 环境变量 `PEANUTSPROUT_LOG_LEVEL=info`（排障临时 `debug`）；**没有** `--log-level` 选项 |
| 超时 | 查询 30s（OLTP）/300s（分析型连接可单独放宽）；反代 3600s |
| 行数 | 默认 1000；导出/IDE 场景按连接放宽，并配合 `maxRows` 上限 |
| 连接池 | 每连接 `maxPoolSize` 与全局池上限 ⬜ 规划中；当前有空的连接由 `PEANUTSPROUT_IDLE_CONN_MS`（默认 30 分钟）回收 |
| 备份 | 每日增量快照 + 每周全量 + 每月异地；保留 14 日 / 8 周 / 12 月 |
| 监控 | 健康检查每 30s（`GET /api/v1/health`）；磁盘余量 < 5 GB 告警；审计链校验每日一次；证书到期 < 21 天告警 |

---

## 13. 发布检查清单（Release Checklist）

| # | 项 | 完成标准 |
| --- | --- | --- |
| 1 | 全仓类型检查 | `pnpm typecheck` 无错误 |
| 2 | 测试 | `pnpm test` 通过（含越权/只读/注入/审计链用例） |
| 3 | 依赖与许可 | `pnpm audit --prod` 无未处置高危；SBOM 生成 |
| 4 | 秘密扫描 | 日志、诊断包样例、测试快照、仓库历史均无凭据 |
| 5 | 打包矩阵 | Windows/Linux/macOS × x64/arm64 全部产出并安装验证 |
| 6 | 签名 | Windows 签名、macOS 签名 + 公证、Linux 包 GPG 签名、`checksums.txt` |
| 7 | 首次启动 | 干净环境（无数据目录）跑通 `init`/首次 `serve` 引导与 `peanutsprout diagnose`（`doctor` ⬜ 规划中） |
| 8 | 升级路径 | 上一版本 → 新版本（含数据目录）升级、备份、回滚演练通过 |
| 9 | 部署文档 | 本文件中的命令在干净环境逐条验证过（含 Nginx/SSE/WS 实测） |
| 10 | 安全默认值 | 默认监听、只读、超时、审计、遥测关闭等与 `docs/security.md` §14 一致 |
| 11 | 发布说明 | 列出破坏性变更、迁移注意、密文/密钥影响、Node 版本要求 |

---

## 14. 桌面端打包（electron-builder）

> 目标：一条命令产出 Windows / Linux / macOS × x86_64 / arm64 的安装包。
> 配置文件只有一个：`apps/desktop/electron-builder.yml`；
> 构建资源（图标、NSIS 片段、macOS entitlements）在 `packaging/`；
> 命令入口在仓库根 `package.json`（`pnpm package:*`）。

### 14.1 为什么配置放在 apps/desktop

electron-builder 需要一个"项目目录"来推断 Electron 版本：它会读
`<projectDir>/node_modules/electron/package.json`。本仓库把 `electron` 只装在
`apps/desktop`（pnpm workspace 依赖隔离），因此 `apps/desktop` 就是 projectDir。
放到仓库根会直接报 `Cannot compute electron version`。

由此带来一个容易踩的路径规则（改路径前务必先看 yml 头部注释）：

| 键 | 相对基准 |
| --- | --- |
| `files` / `extraResources` / `directories` / `mac.entitlements` | `apps/desktop`（即 projectDir） |
| `win.icon` / `mac.icon` / `linux.icon` / `nsis.include` / `nsis.license` | `packaging/build-resources`（buildResources，electron-builder 用 `getResource()` 解析） |

`apps/desktop/package.json` 里有三个**必须存在**的元数据字段（都是 electron-builder 的硬性要求
或 Electron 运行时行为，不是可选项）：

| 字段 | 值 | 原因 |
| --- | --- | --- |
| `homepage` | `https://github.com/peanutsprout/peanutsprout` | fpm（deb/rpm）强制要求，缺失时报 `Please specify project homepage` |
| `productName` | `PeanutSprout` | Electron 用 `productName ?? name` 作为 `app.name`；缺省会让应用名变成 `@peanutsprout/desktop`，`userData` 路径随之变成 `~/.config/@peanutsprout/desktop` |
| `desktopName` | `peanutsprout.desktop` | Electron 用它设置 Linux `app_id`；需与 `linux.syncDesktopName: true` 和 `StartupWMClass: peanutsprout` 三处一致，否则任务栏出现双图标 |

`homepage` 缺失是打包时才暴露的典型问题（`--dir` 不会触发），所以发布前至少要跑一次
`pnpm package:linux`（deb/rpm 会真正走 fpm 元信息校验）。

### 14.2 前置条件与命令

```bash
pnpm install            # 依赖（含 electron / electron-builder）
pnpm build:app          # = build:web + build:server，产出 apps/web/dist 与 build/server.mjs
```

`pnpm package:*` 已内置 `build:app`；如果直接调用 `electron-builder`，必须先自行构建，
否则会把上一次（或不存在）的产物打进安装包。

| 命令 | 目标 | 产物（`release/`） |
| --- | --- | --- |
| `pnpm package:linux` | Linux x86_64 + arm64 | `PeanutSprout-Setup-<ver>-linux-{x86_64,arm64}.AppImage`、`…-linux-{amd64,arm64}.deb` |
| `pnpm package:linux:rpm` | Linux x86_64 + arm64 | 额外 `…-linux-{x86_64,aarch64}.rpm`；**需先装 `rpmbuild`**，故不列入默认目标 |
| `pnpm package:win` | Windows x86_64 + arm64 | `PeanutSprout-Setup-<ver>-win-x64.exe`（NSIS）、`PeanutSprout-Portable-<ver>-win-x64.exe`（arm64 同理） |
| `pnpm package:mac` | macOS x86_64 + arm64 | `PeanutSprout-Setup-<ver>-mac-x64.dmg` / `.zip` |
| `pnpm package:mac:pkg` | macOS `.pkg` | `PeanutSprout-Setup-<ver>-mac-x64.pkg`（需 Developer ID **Installer** 证书） |
| `pnpm package:dir` | 当前平台免安装目录 | `release/<os>-unpacked/`（不产生安装器，最快） |
| `pnpm package:all` | 三平台 | 全部；**只能在 macOS 上跑通**（其它平台无法构建 dmg/pkg） |

`${arch}` 由 electron-builder 按目标格式转换：Windows/macOS 为 `x64`/`arm64`，
Linux 的 deb 为 `amd64`/`arm64`、rpm 与 AppImage 为 `x86_64`/`aarch64`。
卸载只删程序：Windows 卸载器会弹窗提示数据与密钥仍在 `%USERPROFILE%\.peanutsprout`。

### 14.3 安装包内容与运行时入口

```
<安装目录>/
├── peanutsprout(.exe)           可执行文件名固定为 peanutsprout
└── resources/
    ├── app.asar                 仅 main.mjs + package.json（约 8 KB，零 npm 依赖）
    ├── server/server.mjs        esbuild 单文件服务端（约 4 MB，含全部依赖）
    ├── server/server.mjs.map
    └── web/                     apps/web 构建产物
```

- **Web 产物**：服务端通过 `PEANUTSPROUT_WEB_DIST=<resources>/web` 托管（`main.mjs` 在
  打包态注入该变量），不依赖 asar 内的相对路径猜测。
- **服务端入口**：`apps/server/src/main.ts` 经 `scripts/build-server.mjs`（esbuild，
  `platform=node`、`format=esm`、`target=node22`）内联为单文件；内联的 CJS 依赖用
  `createRequire` 兜底 `require`。安装包内**没有 tsx，也没有 TypeScript 运行时**。
- **直接执行的判定**：`main.ts` 末尾原本用 `argv[1]` 是否以 `main.ts/js` 结尾判断
  "是否被直接执行"。打包后文件名是 `server.mjs`，该判断会**静默失效**（进程不监听端口，
  桌面端只报"等待本地服务就绪超时"）。现已改为与 `import.meta.url` 比较，同时保留旧正则兜底。
- **开发态不变**：非打包时 `main.mjs` 仍旧 `tsx` 直跑 TS 源码；另可用
  `PEANUTSPROUT_SERVER_ENTRY=<bundle>` 让桌面端加载已构建产物做联调。

> 单文件服务端在正式包里的运行时是 **Electron 内置的 Node**。已实测 Electron 38.8.6
> 内置 Node 22.22：`node:sqlite` 无需 `--experimental-sqlite`（该标志从 23.4 起才可省，
> Electron 这边已默认可用）。

### 14.4 单独验证服务端产物（不开窗口）

```bash
pnpm build:server
PORT=$(node -e "const s=require('net').createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})")
PEANUTSPROUT_HOME=$(mktemp -d) PEANUTSPROUT_PORT=$PORT PEANUTSPROUT_SERVE_WEB=false \
  node build/server.mjs &
curl -s http://127.0.0.1:$PORT/api/v1/health     # {"status":"ok",...}
```

打包产物同理（`release/linux-unpacked` 为例，用打包内的 Electron 当 Node）：

```bash
cd release/linux-unpacked
ELECTRON_RUN_AS_NODE=1 PEANUTSPROUT_WEB_DIST="$PWD/resources/web" \
  ./peanutsprout resources/server/server.mjs
```

### 14.5 已知限制（发布前必须处理）

| # | 限制 | 影响 / 处理 |
| --- | --- | --- |
| 1 | **未配置签名与公证** | Windows SmartScreen 警告；macOS Gatekeeper 直接拦截（提示"已损坏"）。需 `CSC_LINK`/`CSC_KEY_PASSWORD`、`APPLE_ID`+`APPLE_APP_SPECIFIC_PASSWORD`+`APPLE_TEAM_ID`；`.pkg` 另需 Developer ID Installer 证书。凭据不要入库 |
| 2 | **Electron 二进制来自 GitHub Releases** | 国内网络下表现为静默挂起。yml 已配 `electronDownload.mirror`（与 `.npmrc` 的 `electron_mirror` 一致）。相关变量：`ELECTRON_MIRROR`、`ELECTRON_BUILDER_CACHE`、`ELECTRON_SKIP_BINARY_DOWNLOAD=1`。注意 `@electron/get` 的缓存键是"去掉文件名后的 URL"的 sha256，换镜像＝缓存不命中 |
| 3 | **完全离线** | 用 `electronDist` 指向本地已解压的 Electron（仅限对应平台/架构）：`pnpm --filter @peanutsprout/desktop exec electron-builder --linux dir --x64 -c.electronDist=<...>/node_modules/electron/dist` |
| 4 | **Linux chrome-sandbox** | deb/rpm 由 electron-builder 内置 postinst 处理（`unshare --user` 探测后决定 4755 或 0755，Ubuntu 24+ 还装 AppArmor profile）——**不要**用自定义 `deb.afterInstall` 覆盖它。AppImage 的 `AppRun` 会自动探测并在必要时补 `--no-sandbox`（因此能启动，但渲染进程沙箱关闭）；`--dir` 产物没有这层探测，直接运行会以 `The SUID sandbox helper binary ... not configured correctly` abort。见 §0.2 与 `packaging/linux/README.md` |
| 5 | **deb/rpm 需要 fpm 与 rpmbuild** | electron-builder 会去 GitHub 下载 fpm 二进制（约 70 MB）；此外 rpm 还要求系统有 `rpmbuild`（Debian/Ubuntu：`apt install rpm`），否则报 `Need executable 'rpmbuild' to convert dir to rpm`。**因此 `rpm` 已移出默认 `linux.target`**：留在默认列表会让 `pnpm package:linux` 在未装 rpmbuild 的机器上以退出码 1 结束，而 deb/AppImage 其实已经产出，极易误判为打包失败。需要时用 `pnpm package:linux:rpm`。网络受限可用系统 fpm + `USE_SYSTEM_FPM=true` |
| 6 | **AppImage 需要 FUSE** | 直接运行 `.AppImage` 依赖 `libfuse.so.2`；缺失时报 `AppImages require FUSE to run` —— 这是 AppImage 格式的固有前提而非产物缺陷。变通：装 `libfuse2`、用 `--appimage-extract-and-run`、或改用 deb 包 |
| 6 | **交叉构建不是主路径** | dmg/pkg 只能在 macOS 构建；Windows 签名需要 wine。按 §8.3 的矩阵在原生 runner 上构建 |
| 7 | **图标是占位图** | `pnpm icons` 生成的品牌绿占位图，正式发布请替换 `packaging/build-resources/`（最好直接给 `icon.ico`/`icon.icns`） |
| 8 | **上游缺陷：`@electron/get` 版本** | `app-builder-lib@26.15.3` 运行时需要 `@electron/get >= 3.1.0`（`ElectronDownloadCacheMode`），声明却是 `^3.0.0`。已用 `pnpm-workspace.yaml` 的 `overrides` 定点抬版，否则任何 `package:*` 都会 `Cannot read properties of undefined (reading 'ReadWrite')` |
| 9 | **未配置 `publish`（自动更新源）** | 因此不会生成 `latest.yml`/`latest-mac.yml`/`latest-linux.yml`，§9 的 electron-updater 暂时拿不到更新清单。确定更新托管方式（静态站点或 GitHub Releases）后再补 `publish` 配置 |

体积参考（Linux x64，实测）：`--dir` 目录约 255 MB（Electron 可执行文件约 200 MB、
服务端产物 4.1 MB、asar 8 KB）；`deb` x64 81.3 MB / arm64 76.3 MB、`AppImage` x64 103.2 MB / arm64 103.4 MB。
§8.3 的 ≤150 MB 目标需要靠 `compression` + locale 裁剪（yml 已限制 `en-US`/`zh-CN`）达成。

### 14.6 实测记录（Linux x64，Electron 38.8.6）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| yml 通过 schema 校验 | `pnpm --filter @peanutsprout/desktop run package:dir` | ✅ `loaded configuration file=.../apps/desktop/electron-builder.yml`，无 unknown property |
| 免安装产物 | 同上 | ✅ `release/linux-unpacked/`：`peanutsprout` + `resources/{app.asar,server/,web/}`，asar 内仅 `main.mjs`、`package.json` |
| 打包态服务端启动 | `ELECTRON_RUN_AS_NODE=1 ./peanutsprout resources/server/server.mjs` | ✅ `/api/v1/health` 200；`/` 返回界面；`/assets/index-*.js` 200 |
| 打包应用的完整启动 | `./peanutsprout --no-sandbox`（DISPLAY 可用） | ✅ 内嵌服务在 `127.0.0.1:8787` 就绪、日志"已托管 Web 端静态资源"，窗口加载界面成功 |
| Linux 沙箱（未加 --no-sandbox） | `./peanutsprout` | ⛔ 如预期 abort（`chrome-sandbox` 非 4755）——`--dir` 产物属正常现象，deb 的 postinst 会修正 |
| **deb 安装包** | `electron-builder --linux deb --x64` | ✅ `release/PeanutSprout-Setup-0.1.0-linux-amd64.deb`（81.3 MB；另有 arm64 版 76.3 MB）。`dpkg-deb -f` 元信息正确（Homepage/Maintainer/Vendor/License/Depends/中文 Description）；postinst 含 user-namespace 探测 + chrome-sandbox 权限 + AppArmor；9 个尺寸图标落到 `/usr/share/icons/hicolor/*/apps/peanutsprout.png`；`/usr/share/applications/peanutsprout.desktop` 的 Name/Exec/Icon/StartupWMClass/Categories 均正确 |
| **AppImage** | `electron-builder --linux AppImage --x64` | ✅ `release/PeanutSprout-Setup-0.1.0-linux-x86_64.AppImage`（103.2 MB）。`.DirIcon`→1024px 图标；内置 `.desktop` 正确；**载荷实机启动成功**（`--appimage-extract` 校验 + `--appimage-extract-and-run`：内嵌服务就绪、`/health` 返回 ok、作者/微信/协议元信息与 Web 资源均正常）。注意本机缺 `libfuse.so.2`，**直接执行 .AppImage 文件**会报 FUSE 缺失（环境限制，非产物缺陷） |
| rpm 安装包 | `electron-builder --linux rpm --x64` | ⚠️ 配置与 fpm 参数全部正确（`--name/--vendor/--url/--rpm-summary` + 9 图标 + .desktop 路径均已生成），但本机缺 `rpmbuild` 而失败（`Need executable 'rpmbuild'`）。装 `rpm` 后即可产出 |
| arm64 产物（Linux） | `pnpm package:linux` | ✅ 已实际产出 `…-linux-arm64.deb`（76.3 MB）与 `…-linux-arm64.AppImage`（103.4 MB），说明 arm64 Electron 二进制下载正常。**注意**：这是 Linux arm64，与 AC-08 要求的 macOS arm64 不可互相替代 |
| Windows / macOS 安装包 | — | ⚠️ 未产出：需对应平台的 Electron 二进制、NSIS/dmg 工具链与签名环境；PNG→ICO/ICNS 还需从 GitHub 下载 `icons@1.1.0` 工具包。仅完成配置与 schema 校验 |

> 结论：Linux 产物链路（dir / deb / AppImage × x64+arm64）已在本机端到端跑通并验证；
> Windows 与 macOS 属于"配置就绪但本环境不可产出"，须在原生 runner 上按 §14.7 验证。

### 14.7 发布前自检清单（桌面端）

1. `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`
2. `pnpm icons` 后替换 `packaging/build-resources/` 为正式图标
3. `pnpm package:dir` 确认产物清单（asar 内只有两个文件、`resources/server|web` 存在）
4. 在**干净环境**（无 `~/.peanutsprout`）安装并跑通首次初始化（§11）
5. 按 §8.1 矩阵产出 6 个平台/架构包，逐包安装验证
6. 配置签名/公证后重跑，产出 `checksums.txt`（§13 第 5/6 项）
