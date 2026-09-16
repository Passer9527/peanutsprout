# Linux 打包说明

`packaging/linux/` **故意不放额外文件**：electron-builder 自带所需的全部 Linux 处理
（`.desktop` 由 `apps/desktop/electron-builder.yml` 的 `linux.desktop.entry` 生成，
chrome-sandbox 由内置的 after-install 模板处理），自定义脚本只会把内建逻辑顶掉。
本文件说明这些"看不见但会咬人"的地方。

## 1. 产物与命令

```bash
pnpm package:linux          # x64 + arm64：AppImage / deb / rpm
```

| 产物 | 用途 | 注意 |
| --- | --- | --- |
| `.AppImage` | 免安装、内网分发 | 无法带 setuid，AppRun 会自行降级为 `--no-sandbox`，见 §2 |
| `.deb` | Debian/Ubuntu 系统包 | 安装时自动处理 chrome-sandbox 与 AppArmor |
| `.rpm` | RHEL/Fedora/openSUSE | 同上；**打 rpm 需要系统 `rpmbuild`**，见 §3 |

构建前必须有 `build/server.mjs` 与 `apps/web/dist`（`pnpm package:linux` 会先跑 `build:app`）。

## 2. chrome-sandbox：为什么 Linux 桌面包最容易"装上了但起不来"

Electron 需要 `chrome-sandbox` 才能使用 setuid 沙箱。三种情形：

1. **deb / rpm**：electron-builder 的内置 postinst 会先跑 `unshare --user true` 探测内核能力，
   不支持则 `chmod 4755`，支持则 `chmod 0755`；Ubuntu 24+ 还会装 AppArmor profile。
   不要设置 `deb.afterInstall` / `rpm.afterInstall` 去覆盖它，否则这层判断会消失。
2. **AppImage**：squashfs 只读且不保留 setuid，electron-builder 生成的 `AppRun`
   同样用 `unshare -Ur true` 探测，探测失败时**自动补 `--no-sandbox`**（AppImage 内
   `.desktop` 也直接写成 `Exec=AppRun --no-sandbox %U`）。所以 AppImage 一般不会
   "起不来"，代价是**渲染进程沙箱被关闭**——这也是官方把 AppImage 视为便利分发格式
   而非安全分发格式的原因。若在 Ubuntu 24.04 上仍遇到 AppArmor 拦截，走 deb/rpm
   或自建 profile，不要长期依赖 `--no-sandbox`。
   实测（本仓库 Linux x64，无 user namespace 限制的环境）：AppImage 可直接启动，
   内嵌服务与界面均正常，日志无沙箱报错。
3. **开发态**：`pnpm dev:desktop` 走 `apps/desktop/scripts/launch.mjs`，
   只在探测到沙箱不可用时才补 `--no-sandbox` 并打印修复命令。打包态的
   `main.mjs` 不做这件事——正式包应当把沙箱配好，而不是默认关掉。

> 对比：`--dir`（免安装目录）产物**没有**这层探测，`chrome-sandbox` 是 0755 普通文件，
> 直接运行会 abort（`The SUID sandbox helper binary ... not configured correctly`）。
> 它只用于验证产物清单，不是给最终用户用的分发格式。

## 3. 其它注意

- **glibc**：官方 Electron 产物按 glibc 构建。Alpine/musl 需单独构建（或装 `gcompat`）。
- **fpm 与 rpmbuild**：deb/rpm 由 electron-builder 内置的 fpm 生成，首次构建会从 GitHub
  下载 fpm 二进制（约 70 MB）。此外**打 rpm 需要系统提供 `rpmbuild`**
  （Debian/Ubuntu：`sudo apt install rpm`），否则 fpm 会报
  `Need executable 'rpmbuild' to convert dir to rpm`；deb 不需要额外系统工具。
  网络受限时可用系统 fpm：`sudo apt install ruby-fpm` + `USE_SYSTEM_FPM=true`。
- **桌面项**：`Name` 为中文、`Exec` 指向可执行文件 `peanutsprout`。
  窗口关联（任务栏图标/双图标问题）由"三处同名"决定，任何一处改动都要同步：

  | 位置 | 值 | 作用 |
  | --- | --- | --- |
  | `apps/desktop/package.json` 的 `desktopName` | `peanutsprout.desktop` | Electron 读它设置 Linux `app_id`（`app.setDesktopName`），并写入 asar 供运行时读取 |
  | `electron-builder.yml` 的 `linux.syncDesktopName: true` | — | 让安装的 .desktop 文件名取自 `desktopName`（否则用 `executableName`） |
  | `linux.desktop.entry.StartupWMClass` | `peanutsprout` | .desktop 与窗口的匹配键（X11/Wayland） |

  未设置 `desktopName` 时 Electron 会退回 `<package.json name>.desktop`，在这里就是
  `@peanutsprout/desktop.desktop`——既与安装的 .desktop 名不符，也会让
  `app.getPath('userData')` 变成 `~/.config/@peanutsprout/desktop` 这种带斜杠的嵌套路径。
  同理，`apps/desktop/package.json` 里的 `productName: PeanutSprout` 避免应用名带 `@`/`/`。
  若任务栏仍出现双图标，用 `xprop WM_CLASS` / `busctl --user` 确认真实 `app_id` 后再改这三处。
- **deb/rpm 元信息**：fpm 强制要求 `homepage`（来自 `apps/desktop/package.json`）与
  `maintainer`/`vendor`（yml 中已给出）。缺 `homepage` 时构建会在 fpm 阶段直接失败，
  报 `Please specify project homepage`。
- **数据目录**：`~/.peanutsprout`（0700）。安装包不写用户数据，卸载也不删。
