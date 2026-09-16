/**
 * 花生苗数据库管理工具 - Web 页面访问控制单元测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  buildAccessUrls,
  DEFAULT_LAN_PORT,
  isRestartRequired,
  lanIPv4Addresses,
  parseLanPort,
  readWebAccessSettings,
  resolveWebBinding,
  webAccessWarnings,
  WILDCARD_HOST,
} from './web-access.js';

/** 用固定取值构造一个"读设置"访问器 */
function settingsOf(map: Record<string, string | null>) {
  return (key: string): string | null => map[key] ?? null;
}

describe('parseLanPort', () => {
  it('接受合法端口', () => {
    expect(parseLanPort('1024')).toBe(1024);
    expect(parseLanPort('8787')).toBe(8787);
    expect(parseLanPort('65535')).toBe(65535);
  });

  it('空值回退默认端口', () => {
    expect(parseLanPort(null)).toBe(DEFAULT_LAN_PORT);
    expect(parseLanPort(undefined)).toBe(DEFAULT_LAN_PORT);
    expect(parseLanPort('')).toBe(DEFAULT_LAN_PORT);
    expect(parseLanPort('   ')).toBe(DEFAULT_LAN_PORT);
  });

  it('越界、非整数、脏值一律回退默认端口（启动路径不能抛错）', () => {
    // 存储层白名单已经把范围限在 1024..65535，但启动时读到的库可能来自旧版本
    // 或被手工改过。这里若抛错，用户连改回设置的机会都没有（服务直接起不来）。
    for (const bad of ['80', '0', '65536', '99999', '-1', 'abc', '80.5', 'NaN', '1e5']) {
      expect(parseLanPort(bad), `端口 ${bad} 应回退默认值`).toBe(DEFAULT_LAN_PORT);
    }
  });
});

describe('readWebAccessSettings', () => {
  it('只有 true/1 算打开', () => {
    expect(readWebAccessSettings(settingsOf({ 'web.lan_enabled': 'true' })).lanEnabled).toBe(true);
    expect(readWebAccessSettings(settingsOf({ 'web.lan_enabled': '1' })).lanEnabled).toBe(true);
  });

  it('缺失、false、大小写不同、脏值都算关闭', () => {
    // 安全开关的默认必须是否定：任何读不懂的值都不能变成"对外开放"
    for (const raw of [null, '', 'false', '0', 'TRUE', 'yes', 'on', 'garbage']) {
      const result = readWebAccessSettings(settingsOf({ 'web.lan_enabled': raw }));
      expect(result.lanEnabled, `值 ${String(raw)} 应算作关闭`).toBe(false);
    }
  });

  it('顺带取出端口，脏值回退默认', () => {
    expect(readWebAccessSettings(settingsOf({ 'web.lan_port': '9000' })).lanPort).toBe(9000);
    expect(readWebAccessSettings(settingsOf({ 'web.lan_port': 'abc' })).lanPort).toBe(DEFAULT_LAN_PORT);
    expect(readWebAccessSettings(settingsOf({})).lanPort).toBe(DEFAULT_LAN_PORT);
  });
});

describe('resolveWebBinding', () => {
  const base = { defaultHost: '127.0.0.1', defaultPort: 54321 };

  it('关闭局域网时不带环境变量 → 绑定调用方给的默认地址（桌面端随机端口走这条路）', () => {
    const binding = resolveWebBinding({
      ...base,
      settings: { lanEnabled: false, lanPort: 8787 },
    });
    expect(binding.host).toBe('127.0.0.1');
    expect(binding.port).toBe(54321);
    expect(binding.lanEnabled).toBe(false);
    expect(binding.source).toEqual({ host: 'settings', port: 'settings' });
  });

  it('打开局域网且无环境变量 → 绑通配 + 固定端口', () => {
    const binding = resolveWebBinding({
      ...base,
      settings: { lanEnabled: true, lanPort: 9000 },
    });
    expect(binding.host).toBe(WILDCARD_HOST);
    expect(binding.port).toBe(9000);
    expect(binding.lanEnabled).toBe(true);
  });

  it('环境变量优先于设置项（部署方必须能覆盖界面开关）', () => {
    const binding = resolveWebBinding({
      ...base,
      envHost: '127.0.0.1',
      envPort: 8787,
      settings: { lanEnabled: true, lanPort: 9000 },
    });
    // 设置里开着，但部署方强制绑回环 → 实际没有对局域网开放
    expect(binding.host).toBe('127.0.0.1');
    expect(binding.port).toBe(8787);
    expect(binding.lanEnabled).toBe(false);
    expect(binding.source).toEqual({ host: 'env', port: 'env' });
  });

  it('部署方强制绑通配时，即便设置里是关的也如实报成已开放', () => {
    // 这个方向同样重要：不能因为"设置里没开"就对外宣称没开放，
    // 那会让管理员以为自己是安全的。
    const binding = resolveWebBinding({
      ...base,
      envHost: '0.0.0.0',
      settings: { lanEnabled: false, lanPort: 8787 },
    });
    expect(binding.lanEnabled).toBe(true);
  });

  it('只指定端口时，地址仍按设置解析，且开放状态只看地址', () => {
    // 桌面端开启局域网后会把 host 与 port 都显式传入；
    // 这个用例覆盖"只传了端口"的情况，避免把端口来源误当成开放与否的依据。
    const binding = resolveWebBinding({
      ...base,
      envPort: 9000,
      settings: { lanEnabled: true, lanPort: 8787 },
    });
    expect(binding.host).toBe(WILDCARD_HOST);
    expect(binding.port).toBe(9000);
    expect(binding.lanEnabled).toBe(true);
  });

  it('host/port 各自独立判断来源', () => {
    const binding = resolveWebBinding({
      ...base,
      envHost: '127.0.0.1',
      settings: { lanEnabled: false, lanPort: 8787 },
    });
    expect(binding.source).toEqual({ host: 'env', port: 'settings' });
  });
});

describe('lanIPv4Addresses', () => {
  it('只取 IPv4 非内部地址，去重并排序', () => {
    const addresses = lanIPv4Addresses({
      eth0: [
        { address: '192.168.1.5', family: 'IPv4', internal: false },
        { address: 'fe80::1', family: 'IPv6', internal: false },
      ],
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      wlan0: [
        { address: '10.0.0.9', family: 'IPv4', internal: false },
        { address: '192.168.1.5', family: 'IPv4', internal: false },
      ],
    });
    expect(addresses).toEqual(['10.0.0.9', '192.168.1.5']);
  });

  it('兼容 family 用数字 4 表示的 Node 版本', () => {
    // Node 18 起 family 由 'IPv4' 改过数字表示，不同版本不一致，两种都要认
    const addresses = lanIPv4Addresses({
      eth0: [{ address: '192.168.1.7', family: 4, internal: false }],
    });
    expect(addresses).toEqual(['192.168.1.7']);
  });

  it('没有可用网卡时返回空数组（不抛错）', () => {
    expect(lanIPv4Addresses({})).toEqual([]);
    expect(lanIPv4Addresses({ eth0: undefined })).toEqual([]);
  });
});

describe('buildAccessUrls', () => {
  it('关闭时只给回环地址——给局域网地址会误导用户', () => {
    const urls = buildAccessUrls({
      lanEnabled: false,
      scheme: 'http',
      port: 54321,
      lanAddresses: ['192.168.1.5'],
    });
    expect(urls).toEqual(['http://127.0.0.1:54321']);
  });

  it('打开时回环 + 每个局域网地址都给一条', () => {
    const urls = buildAccessUrls({
      lanEnabled: true,
      scheme: 'http',
      port: 8787,
      lanAddresses: ['10.0.0.9', '192.168.1.5'],
    });
    expect(urls).toEqual([
      'http://127.0.0.1:8787',
      'http://10.0.0.9:8787',
      'http://192.168.1.5:8787',
    ]);
  });

  it('https 部署时协议跟着变', () => {
    const urls = buildAccessUrls({
      lanEnabled: true,
      scheme: 'https',
      port: 443,
      lanAddresses: ['192.168.1.5'],
    });
    expect(urls).toContain('https://192.168.1.5:443');
  });
});

describe('isRestartRequired', () => {
  const bindingOff = { host: '127.0.0.1', port: 54321, lanEnabled: false, source: { host: 'settings' as const, port: 'settings' as const } };
  const bindingOn = (port: number) => ({ host: WILDCARD_HOST, port, lanEnabled: true, source: { host: 'settings' as const, port: 'settings' as const } });

  it('桌面端关闭局域网时端口是随机的，不应因此永远提示重启', () => {
    // 保存的端口是 8787，本次实际绑的是随机端口 —— 若不加这条例外，
    // 界面会永远挂着一条"需重启生效"，用户按提示重启也没用。
    expect(isRestartRequired({ lanEnabled: false, lanPort: 8787 }, bindingOff)).toBe(false);
  });

  it('刚打开开关但进程还没重启 → 需要重启', () => {
    expect(isRestartRequired({ lanEnabled: true, lanPort: 8787 }, bindingOff)).toBe(true);
  });

  it('刚关掉开关但进程仍绑在通配上 → 需要重启', () => {
    expect(isRestartRequired({ lanEnabled: false, lanPort: 8787 }, bindingOn(8787))).toBe(true);
  });

  it('改了端口但未重启 → 需要重启', () => {
    expect(isRestartRequired({ lanEnabled: true, lanPort: 9000 }, bindingOn(8787))).toBe(true);
  });

  it('设置与生效一致 → 不需要重启', () => {
    expect(isRestartRequired({ lanEnabled: true, lanPort: 8787 }, bindingOn(8787))).toBe(false);
  });
});

describe('webAccessWarnings', () => {
  it('关闭局域网时不给任何提示——此时能连上的本来就是本机用户', () => {
    // 只绑回环还提示"记得改默认口令"属于噪音，会让真正重要的警告被忽略
    expect(
      webAccessWarnings({ lanEnabled: false, scheme: 'http', hasDefaultPasswordUser: true }),
    ).toEqual([]);
  });

  it('开放且非 https 且仍有人用初始口令 → 三条全给', () => {
    expect(
      webAccessWarnings({ lanEnabled: true, scheme: 'http', hasDefaultPasswordUser: true }),
    ).toEqual(['lan_exposed', 'no_https', 'default_password']);
  });

  it('开放 + https + 口令都已改过 → 只提示"已暴露"', () => {
    expect(
      webAccessWarnings({ lanEnabled: true, scheme: 'https', hasDefaultPasswordUser: false }),
    ).toEqual(['lan_exposed']);
  });
});
