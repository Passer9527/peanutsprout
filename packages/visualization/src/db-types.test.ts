/**
 * 花生苗数据库管理工具 - 数据库类型目录与驱动注册表的一致性测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 背景：`DB_TYPES[].driverImplemented` 是公开 API（连接表单据此把未实现的
 * 驱动标注为"未实现"），但它与 packages/drivers 的注册表是两份手写事实。
 * 历史缺陷就是两边正好相反：core 除 sqlite 外全部写 false，而 registry 里
 * mysql/postgresql/kingbase/tidb/oceanbase/mariadb 都是 implemented=true。
 *
 * 为什么这条跨包用例放在 visualization：
 *  · core 不能反向依赖 drivers，否则会成环；
 *  · drivers 自身的测试不在本次要求运行的包清单里；
 *  · 本包通过相对路径直接读注册表（纯读、不建立运行时依赖），
 *    确保 `npx vitest run packages/visualization` 就能守住这条契约。
 */

import { DB_TYPES } from '@peanutsprout/core';
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../../drivers/src/registry.js';

/** 当前真实落地的驱动（与 packages/drivers/src/registry.ts 的注册一一对应）。 */
const IMPLEMENTED = ['kingbase', 'mariadb', 'mysql', 'oceanbase', 'postgresql', 'sqlite', 'tidb'] as const;

describe('DB_TYPES.driverImplemented 与驱动注册表一致', () => {
  it('每个类型在 core 与 drivers 中的"是否已实现"必须给出同一答案', () => {
    const registry = createDefaultRegistry();
    const implemented = new Set<string>(registry.implementedTypes());
    for (const info of DB_TYPES) {
      expect(
        info.driverImplemented,
        `${info.code} 在 core(DB_TYPES) 与 drivers(registry) 中的判断不一致`,
      ).toBe(implemented.has(info.code));
    }
  });

  it('已实现的类型恰好是预期集合（防漂移）', () => {
    const registry = createDefaultRegistry();
    expect([...registry.implementedTypes()].sort()).toEqual([...IMPLEMENTED].sort());
    expect(
      DB_TYPES.filter((t) => t.driverImplemented)
        .map((t) => t.code)
        .sort(),
    ).toEqual([...IMPLEMENTED].sort());
  });
});
