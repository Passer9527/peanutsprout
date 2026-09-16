# 打包（packaging）

本目录存放 electron-builder 的**构建资源**（图标、平台专属脚本）与各平台打包说明。
打包配置本体在 `apps/desktop/electron-builder.yml`，命令入口在仓库根 `package.json`。

```
packaging/
├── build-resources/          # electron-builder 的 buildResources
│   ├── icon.png              # 1024x1024 占位主图标（win/mac 由它自动转 .ico/.icns）
│   └── icons/NxN.png         # 16…1024 尺寸集，Linux 桌面图标用
├── windows/installer.nsh     # NSIS 自定义片段（卸载时提示数据目录仍在）
├── macos/entitlements.mac.plist
└── linux/README.md           # Linux 侧不需要额外文件，说明见该文件
```

> ⚠️ 图标是**占位图**（`pnpm icons` 用脚本生成的品牌绿方块 + 花生嫩芽）。
> 正式发布前请用设计稿替换 `packaging/build-resources/` 下的文件，
> 最好直接提供 `icon.ico`（Windows）与 `icon.icns`（macOS），
> 由 electron-builder 自动转换的版本在任务栏/程序坞里观感一般。
>
> 另注意：electron-builder 26 把 PNG→ICO/ICNS 的转换换成了单独的
> `icons@1.1.0` 工具包（首次构建时从 GitHub 下载到 `~/.cache/electron-builder`），
> 因此**离线环境打包 Windows/macOS 时即使 Electron 已缓存也会卡在这一步**。
> Linux 的 `icons/` 尺寸集由 electron-builder 直接读取，不需要该工具包。

## 0. 前置条件

```bash
pnpm install                 # 需要 electron（devDependency）与 electron-builder
pnpm build:app               # = 构建 apps/web/dist + esbuild 打包服务端 -> build/server.mjs
```

`pnpm package:*` 已经内置了 `build:app`，但**单独**跑 `electron-builder` 时必须先构建，
否则会把上一次（或不存在）的产物打进安装包。`pnpm package:dir` 可用于打包链路自检。

## 1. 命令一览

产物统一落在仓库根的 `release/` 目录，命名统一为
`PeanutSprout-Setup-<version>-<os>-<arch>.<ext>`（PRD 命名规范）。注意 `${arch}`
对 Linux 会展开成该发行版惯用的架构名（deb 用 `amd64`、rpm 用 `x86_64`/`aarch64`、
AppImage 用 `x86_64`），这是 electron-builder 的标准行为，也与 PRD 的 x86_64 写法一致。

| 命令 | 目标 | 产物（`release/` 目录） |
| --- | --- | --- |
| `pnpm package:linux` | Linux x64 + arm64 | `PeanutSprout-Setup-<ver>-linux-x86_64.AppImage`、`…-linux-amd64.deb`；arm64 为 `…-linux-arm64.AppImage` / `…-linux-arm64.deb` |
| `pnpm package:linux:rpm` | Linux x64 + arm64 | 额外的 `…-linux-x86_64.rpm` / `…-linux-aarch64.rpm`；**需先装 `rpmbuild`**（`sudo apt install rpm`），故不放在默认目标里 |
| `pnpm package:win` | Windows x64 + arm64 | `PeanutSprout-Setup-<ver>-win-x64.exe`（NSIS 安装版）、`PeanutSprout-Portable-<ver>-win-x64.exe`；arm64 同理 |
| `pnpm package:mac` | macOS x64 + arm64 | `PeanutSprout-Setup-<ver>-mac-x64.dmg` / `.zip` |
| `pnpm package:mac:pkg` | macOS `.pkg` | `PeanutSprout-Setup-<ver>-mac-x64.pkg`（需 Developer ID Installer 证书） |
| `pnpm package:dir` | 当前平台免安装目录 | `release/<os>-unpacked/`（最快，用于验证配置与产物清单） |
| `pnpm package:all` | 三平台 | 同上全部；**只能在 macOS 上跑通**，其它平台会因跨平台限制失败 |

服务端/Web 构建脚本（单独使用）：

```bash
pnpm build:server            # node scripts/build-server.mjs -> build/server.mjs
pnpm build:web               # apps/web 的 vite build -> apps/web/dist
pnpm icons                   # 重新生成占位图标
```

## 2. 安装包里到底装了什么

```
PeanutSprout-Setup-...            (Electron 外壳 + 安装器)
├── resources/app.asar            仅 apps/desktop/{main.mjs,package.json}，运行时零 npm 依赖
├── resources/server/server.mjs   esbuild 单文件服务端（内联 fastify/zod/mysql2/pg/全部 workspace 包）
├── resources/server/server.mjs.map
└── resources/web/                apps/web/dist（服务端以 PEANUTSPROUT_WEB_DIST 指向它）
```

- **为什么没有 tsx / TypeScript**：安装包只装 devDependencies 之外的东西，
  `require.resolve('tsx/cli')` 在打包态必然失败。服务端因此先用 esbuild 内联成单文件，
  `main.mjs` 按 `app.isPackaged` 决定用 tsx（开发）还是 `resources/server/server.mjs`（打包）。
- **为什么没有 node_modules**：单文件已内联全部依赖，显式排除可避免 electron-builder
  顺着 pnpm 符号链接把 `.pnpm` store 复制进安装包（体积会差出几百 MB）。
- 数据目录不在安装包内：`~/.peanutsprout`（Windows 为 `%USERPROFILE%\.peanutsprout`），
  卸载时**保留**。

## 3. 已知限制与坑（重要）

### 3.1 交叉构建不是主路径

macOS 产物（dmg/pkg）**只能在 macOS 上**构建；Windows 的 NSIS 在 Linux 上可勉强构建，
但签名需要 wine。CI 请按平台分矩阵构建（见 `docs/deployment.md` §8.3）。

### 3.2 签名 / 公证未配置

当前配置**不含任何证书**，产物是未签名包：

- Windows：SmartScreen 会提示"未知发布者"；正式发布需 Authenticode 证书。
- macOS：Gatekeeper 会直接拦截（`已损坏，无法打开`）。需要 Developer ID Application
  证书 + `notarytool` 公证；`.pkg` 还需 Developer ID **Installer** 证书。
- Linux：deb/rpm 未做 GPG 签名。

凭据通过环境变量提供（不要写进仓库）：
`CSC_LINK` / `CSC_KEY_PASSWORD`（或 `WIN_CSC_LINK`、`CSC_INSTALLER_LINK`）、
`APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`。

### 3.3 Electron 二进制下载走镜像（国内网络必须）

electron-builder 需要下载**目标平台/架构**的 Electron 二进制。默认源是 GitHub Releases，
国内网络下会长时间无响应（不是报错，是静默挂起）。配置里已指向国内镜像：

```yaml
electronDownload:
  mirror: https://registry.npmmirror.com/-/binary/electron/
```

海外或已配置代理时删掉该段即可回到官方源。相关环境变量：

| 变量 | 用途 |
| --- | --- |
| `ELECTRON_MIRROR` | 覆盖镜像地址（`pnpm install` 阶段由 `.npmrc` 的 `electron_mirror` 提供） |
| `ELECTRON_BUILDER_CACHE` | 自定义 electron-builder 缓存目录（离线环境可预先塞入 zip） |
| `ELECTRON_SKIP_BINARY_DOWNLOAD=1` | 仅安装依赖、不下载二进制（CI 缓存场景） |

`@electron/get` 的缓存键是"**去掉文件名后的下载 URL**"的 sha256，因此镜像地址一变，
缓存就不再命中（需要重新下载）。例如 `electron-v38.8.6-linux-x64.zip` 在
`https://registry.npmmirror.com/-/binary/electron/v38.8.6/` 下对应缓存目录
`~/.cache/electron/53cd07c7981ec902837a2f544c4d02995f43b1157c63d6f083d495b649a72039/`。

### 3.4 完全离线时用 `electronDist` 指向本地已解压的 Electron

```bash
# 用 node_modules 里已有的 Electron（仅限"当前平台 + 当前架构"）
pnpm --filter @peanutsprout/desktop exec electron-builder --linux dir --x64 \
  -c.electronDist=../../node_modules/.pnpm/electron@38.8.6/node_modules/electron/dist
```

`electronDist` **不能**写进 yml：它必须是目标平台对应的那份 Electron，
跨平台构建时会用错二进制。

### 3.5 Linux：chrome-sandbox 与 fpm

- **deb / rpm**：electron-builder 自带的 postinst 会先跑 `unshare --user true` 探测内核能力，
  不支持时把 `/opt/PeanutSprout/chrome-sandbox` 设为 4755，支持时设为 0755；Ubuntu 24+
  还会安装 AppArmor profile。**不要**用自定义 `deb.afterInstall` 覆盖它，否则会丢掉这些处理。
  （已实测：生成的 deb 中 `/opt/PeanutSprout/chrome-sandbox` 为 0755，postinst 内容符合上述逻辑。）
- **AppImage**：squashfs 内无法保留 setuid 位。electron-builder 生成的 `AppRun` 会先用
  `unshare -Ur true` 探测，探测失败时自动补 `--no-sandbox`，因此能启动（实测通过），
  但**渲染进程沙箱是关闭的**。Ubuntu 24.04 起 AppArmor 默认限制未授权二进制的 user
  namespace，若仍被拦截，改用 deb/rpm 安装或自建 AppArmor profile，不要长期依赖
  `--no-sandbox`。详见 `packaging/linux/README.md`。
- **rpm 为何不在默认目标里**：`rpm` 目标会调 fpm 转 rpm，而 fpm 需要系统装有 `rpmbuild`。
  若把它放进默认 `linux.target`，在未安装 rpmbuild 的机器（Debian/Ubuntu 默认即无）上
  `pnpm package:linux` 会以退出码 1 结束 —— 尽管 deb 与 AppImage **已经成功产出**，
  极易被误判为"打包失败"。因此本仓库把它拆到 `pnpm package:linux:rpm` 按需执行。
- **AppImage 需要 FUSE**：直接运行 `.AppImage` 依赖 `libfuse.so.2`；缺失时报
  `AppImages require FUSE to run`。这是 AppImage 格式的固有前提，不是产物缺陷。
  变通方式：装 `libfuse2`，或 `./xxx.AppImage --appimage-extract-and-run`，或直接用 deb。
- **fpm 与 rpmbuild**：deb/rpm 由 electron-builder 内置的 fpm 生成，首次构建会从 GitHub
  下载 fpm 二进制（约 70 MB，之后进 `~/.cache/electron-builder`）；网络受限可用系统 fpm
  绕过（`sudo apt install ruby-fpm` + `USE_SYSTEM_FPM=true`）。此外 **rpm 还要求系统有
  `rpmbuild`**（Debian/Ubuntu：`sudo apt install rpm`），否则失败信息为
  `Need executable 'rpmbuild' to convert dir to rpm`；deb 不需要额外系统工具（实测可产出）。
- **deb/rpm 必需的元数据**：`apps/desktop/package.json` 的 `homepage`（fpm 强制）、
  `linux.maintainer`、`linux.vendor`。缺 `homepage` 会在 fpm 阶段报
  `Please specify project homepage`——`--dir` 构建不会暴露这个问题，所以发布前务必真的打一次 deb/rpm。
- **桌面项窗口关联**：`desktopName`（package.json）↔ `linux.syncDesktopName: true` ↔
  `StartupWMClass` 三处必须同名，否则任务栏出现双图标。`desktop.entry.Comment` 无法自定义
  （electron-builder 合并后用 `linux.description` 无条件覆盖），详见
  `packaging/linux/README.md`。

### 3.6 产物命名

`apps/desktop/electron-builder.yml` 的 `artifactName` 统一为
`PeanutSprout-Setup-${version}-${os}-${arch}.${ext}`（`${os}` 取值 `win`/`linux`/`mac`）。
`${arch}` 由 electron-builder 按目标格式转换：Windows/macOS 为 `x64`/`arm64`，
Linux 的 deb 为 `amd64`/`arm64`、rpm/AppImage 为 `x86_64`/`aarch64`。
`portable` 目标额外用 `PeanutSprout-Portable-...`，否则会和 NSIS 的 `.exe` 互相覆盖。

### 3.7 已知上游缺陷：electron-builder 26.15.3 需要 `@electron/get >= 3.1.0`

`app-builder-lib@26.15.3` 声明 `@electron/get: ^3.0.0`，但运行时会无条件读取
该包 3.1.0 才新增的 `ElectronDownloadCacheMode`。锁到 3.0.0 时任何打包命令都会在
"解析 Electron 缓存目录"阶段直接崩溃：

```
⨯ Cannot read properties of undefined (reading 'ReadWrite')
    at resolveCacheMode (.../app-builder-lib/out/util/electronGet.js:69:47)
```

仓库已在 `pnpm-workspace.yaml` 用 override 只把 `app-builder-lib` 这条依赖抬到
`^3.1.0`（不影响 `electron` 自身需要的 `@electron/get` 2.x）：

```yaml
overrides:
  'app-builder-lib>@electron/get': ^3.1.0
```

electron-builder 修掉该缺陷后可以删除这段 override。

## 4. 快速自检清单（不希望真的出安装包时）

```bash
pnpm build:app                                   # 1) Web + 服务端产物
node scripts/build-server.mjs                    # 2) 单独重打服务端（产物 sha256 会打印）
pnpm package:dir                                 # 3) 只看 release/<os>-unpacked/ 的产物清单
```

`--dir` 产物可以直接当"绿色版"验证运行时（Linux 示例）：

```bash
cd release/linux-unpacked
ELECTRON_RUN_AS_NODE=1 PEANUTSPROUT_WEB_DIST="$PWD/resources/web" \
  ./peanutsprout resources/server/server.mjs    # 另开终端 curl 127.0.0.1:8787/api/v1/health
```

完整启动（会开窗口）：`./peanutsprout`。Linux 上若报
"SUID sandbox helper binary ... not configured correctly"，见 §3.5 与
`packaging/linux/README.md`。

真正的安装包（deb/AppImage 已在本仓库实测通过）：

```bash
pnpm package:linux               # 或单独 electron-builder --linux deb --x64
dpkg-deb -f release/PeanutSprout-Setup-0.1.0-linux-amd64.deb         # 检查包元信息
dpkg-deb -c release/PeanutSprout-Setup-0.1.0-linux-amd64.deb | grep -E 'icons|\.desktop'
```

各平台实测到什么程度、哪些必须到原生 runner 上补验，见 `docs/deployment.md` §14.6。
