/**
 * 花生苗数据库管理工具 - 有界取消标记集合
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 取消接口是**外部可调用**的：`/query/cancel` 会把客户端传来的任意字符串
 * 交给各连接执行器的 `cancel(queryId)`。如果直接把 id 塞进一个 Set，攻击者
 * 或前端 bug 可以反复调用把内存撑爆；同时超长 id 本身就是一种放大手段。
 *
 * 因此这里用「定容 + 长度上限 + 最近使用淘汰」的集合收口：
 *  · 超过 maxIdLength 的 id 直接丢弃（正常 queryId 只有几十字节）；
 *  · 容量超过 limit 时淘汰最久未使用的标记；
 *  · 重复 add 会刷新使用顺序，避免热点标记被误淘汰。
 */
export class BoundedCancelSet {
  private readonly ids = new Set<string>();

  constructor(
    /** 最多保留多少条取消标记 */
    private readonly limit = 256,
    /** 单条 id 的最大长度，超过视为非法输入 */
    private readonly maxIdLength = 128,
  ) {}

  /** 登记取消标记；返回 false 表示 id 非法被丢弃。 */
  add(id: string): boolean {
    if (typeof id !== 'string' || id.length === 0 || id.length > this.maxIdLength) return false;
    // 先删后加：Set 的迭代顺序即插入顺序，这样淘汰的就是"最久未使用"的
    if (this.ids.has(id)) this.ids.delete(id);
    this.ids.add(id);
    while (this.ids.size > this.limit) {
      const oldest = this.ids.values().next().value as string | undefined;
      if (oldest === undefined) break;
      this.ids.delete(oldest);
    }
    return true;
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  delete(id: string): void {
    this.ids.delete(id);
  }

  clear(): void {
    this.ids.clear();
  }

  /** 当前保留的标记数（测试与诊断用） */
  get size(): number {
    return this.ids.size;
  }
}
