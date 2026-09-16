/**
 * 花生苗数据库管理工具 - Web 页面访问控制（局域网访问开关）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 为什么需要这个模块：
 *   花生苗同时有桌面端与 Web 端两种形态。桌面端把服务端当子进程拉起、窗口本身
 *   加载 http://127.0.0.1:<随机端口>/，所以"关掉 Web 页面"等于把桌面端自己的界面
 *   也关掉 —— 两者不可能兼得。因此这里的开关**不是**"要不要网页"，而是
 *   **"要不要让同网段的其他设备也能用浏览器打开"**：
 *
 *     关闭（默认）：只绑 127.0.0.1，端口随机。局域网内其他机器完全连不上。
 *     打开        ：绑 0.0.0.0 并改用**固定端口**，手机/另一台电脑输网址即可访问。
 *
 *   开放局域网访问意味着把"能管理数据库的工具"放到网络上，风险等级明显上升，
 *   所以设计上坚持三点：
 *     1. 默认关闭，且必须由管理员显式打开；
 *     2. 打开后接口会回传**真实的访问地址与风险提示**，而不是只回一个 true；
 *     3. 开关与端口都在**启动时读取**，改动需重启 —— 不做运行中偷偷改变监听地址
 *        这种"看起来生效了、其实老连接还开着"的半吊子实现。
 *
 * 本模块全部是纯函数（不读环境、不读数据库、不开端口），便于直接单测；
 * 真实取值由 main.ts / 桌面端主进程注入。
 */

/** 设置键名（与 storage 层的 WRITABLE_SETTINGS 保持一致） */
export const SETTING_LAN_ENABLED = 'web.lan_enabled';
export const SETTING_LAN_PORT = 'web.lan_port';

/** 局域网访问的默认端口。选 8787 与开发态 `pnpm dev:server` 一致，便于记忆。 */
export const DEFAULT_LAN_PORT = 8787;

/** 通配绑定地址：只在开启局域网访问时使用 */
export const WILDCARD_HOST = '0.0.0.0';
/** 仅本机绑定地址：默认值，桌面端与一体化部署都用它 */
export const LOOPBACK_HOST = '127.0.0.1';

export interface WebAccessSettings {
  lanEnabled: boolean;
  lanPort: number;
}

export interface WebBinding {
  host: string;
  port: number;
  /** 解析后是否处于"允许局域网访问"状态（host 为通配且有固定端口） */
  lanEnabled: boolean;
  /** 该次解析里 host/port 各自由谁决定，便于诊断"为什么我改了设置没生效" */
  source: { host: 'env' | 'settings'; port: 'env' | 'settings' };
}

/**
 * 解析设置里的端口。
 *
 * 存储层已经把值校验成 1024..65535 的整数，但这里是**启动路径**：
 * 数据库可能来自旧版本、被手工改过，或迁移过程中留下脏值。
 * 非法值一律回退到默认端口而不是抛错 —— 启动失败会让用户连改设置的机会都没有。
 */
export function parseLanPort(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw.trim() === '') return DEFAULT_LAN_PORT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) return DEFAULT_LAN_PORT;
  return n;
}

/** 从"读设置"的访问器里取出 Web 访问配置。默认关闭。 */
export function readWebAccessSettings(get: (key: string) => string | null): WebAccessSettings {
  const raw = get(SETTING_LAN_ENABLED);
  return {
    // 只有 'true'/'1' 才算打开：空值、脏值一律按关闭处理（安全侧的默认必须是否定）
    lanEnabled: raw === 'true' || raw === '1',
    lanPort: parseLanPort(get(SETTING_LAN_PORT)),
  };
}

/**
 * 决定实际绑定到哪个地址/端口。
 *
 * 优先级：环境变量 > 设置项 > 调用方给的默认值。
 * 为什么环境变量优先：`PEANUTSPROUT_HOST/PORT` 是部署方（systemd、容器、
 * 桌面端主进程）对"监听在哪"的强制要求，必须能覆盖界面上的设置，
 * 否则用户改一下界面就把运维的绑定策略改掉了。
 * 反过来说，桌面端希望"设置界面能生效"，它就必须自己读设置、再以环境变量传入 ——
 * 见 apps/desktop/main.mjs。
 */
export function resolveWebBinding(options: {
  envHost?: string | undefined;
  envPort?: number | undefined;
  settings: WebAccessSettings;
  defaultHost: string;
  defaultPort: number;
}): WebBinding {
  const { envHost, envPort, settings } = options;

  const host = envHost ?? (settings.lanEnabled ? WILDCARD_HOST : options.defaultHost);
  const port = envPort ?? (settings.lanEnabled ? settings.lanPort : options.defaultPort);

  return {
    host,
    port,
    // 判定依据是**解析结果**而不是设置值：环境变量把 host 覆盖回 127.0.0.1 时，
    // 即便设置里开着开关，实际也没有对局域网开放，不能报成"已开放"；
    // 反过来，环境变量直接指定 0.0.0.0 时（部署方要求对外）
    // 即便设置里是关闭的，实际也确实开放着，必须如实报成已开放。
    // 只看 host 即可：端口来自设置还是环境变量，不影响"能不能被局域网连上"。
    lanEnabled: host === WILDCARD_HOST,
    source: {
      host: envHost === undefined ? 'settings' : 'env',
      port: envPort === undefined ? 'settings' : 'env',
    },
  };
}

/** 供 os.networkInterfaces() 使用的最小结构（避免为可测性引入类型断言） */
export interface NetworkInterfaceLike {
  address: string;
  family: string | number;
  internal: boolean;
}

/**
 * 列出可用于访问的局域网 IPv4 地址。
 *
 * 只取 IPv4 非内部地址：IPv6 链路本地地址要写成 `http://[fe80::1%25eth0]:8787`，
 * 让用户手输这个不现实；而 `family` 在不同 Node 版本里既可能是 `'IPv4'`
 * 也可能是数字 `4`，两种都认。
 */
export function lanIPv4Addresses(
  interfaces: Record<string, NetworkInterfaceLike[] | undefined>,
): string[] {
  const found: string[] = [];
  for (const list of Object.values(interfaces)) {
    for (const item of list ?? []) {
      const isV4 = item.family === 'IPv4' || item.family === 4;
      if (isV4 && !item.internal) found.push(item.address);
    }
  }
  // 去重并排序：多网卡（有线+无线+虚拟网卡）时输出稳定，便于比对与截图
  return [...new Set(found)].sort();
}

/**
 * 生成用户可以照抄的访问地址。
 *
 * 关闭局域网访问时**只回 127.0.0.1**：此时别的机器本来就连不上，
 * 回传局域网地址只会误导（用户拿去给同事，同事打不开还得回来排查）。
 */
export function buildAccessUrls(options: {
  lanEnabled: boolean;
  scheme: string;
  port: number;
  lanAddresses: string[];
}): string[] {
  const { lanEnabled, scheme, port, lanAddresses } = options;
  const urls = [`${scheme}://127.0.0.1:${port}`];
  if (lanEnabled) {
    for (const address of lanAddresses) urls.push(`${scheme}://${address}:${port}`);
  }
  return urls;
}

/** 保存的配置与本次启动实际生效的配置是否不一致（界面据此提示"需重启"） */
export function isRestartRequired(saved: WebAccessSettings, binding: WebBinding): boolean {
  // 桌面端关闭局域网时端口是随机分配的，与设置里保存的端口天然不同，
  // 那种情况下不算"有未生效的改动"，否则界面会永远挂着一条无意义的重启提示。
  if (!saved.lanEnabled && !binding.lanEnabled) return false;
  return saved.lanEnabled !== binding.lanEnabled || saved.lanPort !== binding.port;
}

/** 风险提示码（文案在界面侧做 i18n，服务端不返回中文句子） */
export type WebAccessWarning = 'lan_exposed' | 'no_https' | 'default_password';

/**
 * 汇总当前状态下的风险提示。
 *
 * 这些提示**只在开启局域网访问时**才有意义：只绑回环时，能连上的本来就是本机用户，
 * 再提示"记得改默认口令"属于噪音，会让真正重要的警告被忽略。
 */
export function webAccessWarnings(options: {
  lanEnabled: boolean;
  scheme: string;
  /** 是否仍存在"从未改过初始口令"的账号 */
  hasDefaultPasswordUser: boolean;
}): WebAccessWarning[] {
  if (!options.lanEnabled) return [];
  const warnings: WebAccessWarning[] = ['lan_exposed'];
  if (options.scheme !== 'https') warnings.push('no_https');
  if (options.hasDefaultPasswordUser) warnings.push('default_password');
  return warnings;
}
