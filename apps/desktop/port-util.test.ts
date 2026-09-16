/**
 * 桌面端内嵌服务启动辅助测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这些函数刻意零依赖、且不 import electron（见 port-util.mjs 顶部说明），
 * 因此可以直接在 vitest 里覆盖"随机端口选择"和"应答者身份判定"两个关键修复。
 */

import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
// 纯 JS 辅助模块，桌面端没有 tsconfig；这里只做运行时验证
import { pickFreePort, verifyInstanceNonce } from './port-util.mjs';

describe('pickFreePort', () => {
  it('返回一个当前真正可用的端口', async () => {
    const port = await pickFreePort('127.0.0.1');
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65535);

    // 选出来的端口应当能立刻被绑定，证明"空闲"不是随口说的
    const probe = createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', () => resolve());
    });
    await new Promise<void>((resolve) => probe.close(() => resolve()));
  });

  it('不会选中已经被占用的端口', async () => {
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', () => resolve()));
    const occupiedPort = (occupied.address() as AddressInfo).port;
    try {
      const port = await pickFreePort('127.0.0.1');
      expect(port).not.toBe(occupiedPort);
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }
  });
});

describe('verifyInstanceNonce：确认端口上应答的是本次启动的子进程', () => {
  const nonce = 'a'.repeat(48);

  it('nonce 完全一致才认定为自己的实例', () => {
    expect(verifyInstanceNonce({ instanceNonce: nonce }, nonce)).toBe(true);
  });

  it('nonce 不一致 → 拒绝（别人占着同一端口的情况）', () => {
    // 另一个用户的实例、或上一个实例的孤儿进程：/health 正常但 nonce 不同
    expect(verifyInstanceNonce({ instanceNonce: 'b'.repeat(48) }, nonce)).toBe(false);
  });

  it('应答里没有 nonce 也要拒绝，不能因为"字段缺失"就放行', () => {
    // 普通部署（未设 PEANUTSPROUT_INSTANCE_NONCE）不会回显该字段；
    // 若这里放行，就退化成"只看 HTTP 200"，正是要修掉的缺陷。
    expect(verifyInstanceNonce({ status: 'ok' }, nonce)).toBe(false);
    expect(verifyInstanceNonce({ instanceNonce: null }, nonce)).toBe(false);
    expect(verifyInstanceNonce({ instanceNonce: 123 }, nonce)).toBe(false);
    expect(verifyInstanceNonce(null, nonce)).toBe(false);
    expect(verifyInstanceNonce('ok', nonce)).toBe(false);
  });

  it('期望值本身为空时一律拒绝，避免"两边都空"被当成匹配', () => {
    expect(verifyInstanceNonce({ instanceNonce: '' }, '')).toBe(false);
    expect(verifyInstanceNonce({}, '')).toBe(false);
  });
});
