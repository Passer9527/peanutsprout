/**
 * 花生苗数据库管理工具 - AI 对话纯逻辑测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这些用例对应需求里最容易被"看起来对了"糊弄过去的两处：
 *  · 发送后输入框必须真的空（而不是只清了一部分字段）；
 *  · 撤回/回退删的条数与服务端记录 id 必须一一对上（多删会毁掉别人的对话，
 *    少删会让"已调用 N 次"的计数和界面对不上）。
 */

import { describe, expect, it } from 'vitest';
import {
  inputsAfterSend,
  planRollbackAnchor,
  planWithdraw,
  snapshotForRollback,
  type ComposerInputs,
  type ComposerSnapshot,
  type SceneKey,
  type TurnLike,
} from './aiConversation.js';

const snapshot = (over: Partial<ComposerSnapshot> = {}): ComposerSnapshot => ({
  scene: 'nl2sql',
  connectionId: 1,
  question: '',
  sql: '',
  errorText: '',
  rowsText: '',
  ...over,
});

const user = (_text: string, snap: ComposerSnapshot = snapshot()): TurnLike => ({
  role: 'user',
  snapshot: snap,
});

const reply = (historyId: number | null): TurnLike => ({ role: 'assistant', historyId });

describe('发送后清空输入框', () => {
  const full: ComposerInputs = { question: '问', sql: 'SELECT 1', errorText: '错', rowsText: 'a,b' };

  it('nl2sql 只清问题，不动 SQL / 报错 / 结果数据', () => {
    expect(inputsAfterSend('nl2sql', full)).toEqual({
      question: '',
      sql: 'SELECT 1',
      errorText: '错',
      rowsText: 'a,b',
    });
  });

  it('解释 / 优化 清 SQL', () => {
    for (const scene of ['explain', 'optimize'] as SceneKey[]) {
      expect(inputsAfterSend(scene, full).sql).toBe('');
      // 问题不该被顺手清掉
      expect(inputsAfterSend(scene, full).question).toBe('问');
    }
  });

  it('结果集问答清问题与结果数据（这两样都是"发出去的东西"）', () => {
    expect(inputsAfterSend('ask', full)).toEqual({
      question: '',
      sql: 'SELECT 1',
      errorText: '错',
      rowsText: '',
    });
  });

  it('报错诊断清 SQL 与报错信息', () => {
    expect(inputsAfterSend('diagnose', full)).toEqual({
      question: '问',
      sql: '',
      errorText: '',
      rowsText: 'a,b',
    });
  });

  it('生成文档没有文本输入，什么都不用清', () => {
    expect(inputsAfterSend('document', full)).toEqual(full);
  });

  it('六个技能里，凡是本技能用到的输入发送后都必须是空的', () => {
    // 逐技能反向核对：只断言上表列出的字段，其余必须原样保留
    const scenes: SceneKey[] = ['nl2sql', 'explain', 'optimize', 'document', 'ask', 'diagnose'];
    const used: Record<SceneKey, Array<keyof ComposerInputs>> = {
      nl2sql: ['question'],
      explain: ['sql'],
      optimize: ['sql'],
      document: [],
      ask: ['question', 'rowsText'],
      diagnose: ['sql', 'errorText'],
    };
    for (const scene of scenes) {
      const after = inputsAfterSend(scene, full);
      for (const field of Object.keys(full) as Array<keyof ComposerInputs>) {
        if (used[scene].includes(field)) {
          expect(after[field], `${scene}.${field} 应被清空`).toBe('');
        } else {
          expect(after[field], `${scene}.${field} 不该被清空`).toBe(full[field]);
        }
      }
    }
  });
});

describe('撤回的删除计划', () => {
  it('撤回 assistant 消息：只删它自己那条记录，删 1 条', () => {
    const turns = [user('q1'), reply(11), user('q2'), reply(12)];
    expect(planWithdraw(turns, 1)).toEqual({ historyIds: [11], removeCount: 1 });
    expect(planWithdraw(turns, 3)).toEqual({ historyIds: [12], removeCount: 1 });
  });

  it('撤回 user 消息：连同它的回复一起删，且删的是回复那条记录', () => {
    const turns = [user('q1'), reply(11), user('q2'), reply(12)];
    // 关键：不能用 12（那是下一条提问的记录），必须是 11
    expect(planWithdraw(turns, 2)).toEqual({ historyIds: [12], removeCount: 2 });
  });

  it('撤回最后一条 user 消息（还在生成 / 生成失败，后面没有回复）只删自己', () => {
    const turns = [user('q1'), reply(11), user('q2')];
    expect(planWithdraw(turns, 2)).toEqual({ historyIds: [], removeCount: 1 });
  });

  it('回复没有 historyId（后端没回传）时不删服务端，但本地照样撤回', () => {
    const turns = [user('q1'), reply(null)];
    expect(planWithdraw(turns, 0)).toEqual({ historyIds: [], removeCount: 2 });
  });

  it('越界索引不产生任何删除（防止误删别人的记录）', () => {
    const turns = [user('q1'), reply(11)];
    expect(planWithdraw(turns, 5)).toEqual({ historyIds: [], removeCount: 0 });
    expect(planWithdraw(turns, -1)).toEqual({ historyIds: [], removeCount: 0 });
    expect(planWithdraw([], 0)).toEqual({ historyIds: [], removeCount: 0 });
  });

  it('撤回范围不会越过数组末尾', () => {
    const turns = [user('q1'), reply(11)];
    const plan = planWithdraw(turns, 0);
    expect(0 + plan.removeCount).toBeLessThanOrEqual(turns.length);
  });
});

describe('回退到某一次操作', () => {
  it('回退到 user 消息：水位线取它后面那条回复的记录', () => {
    const turns = [user('q1'), reply(11), user('q2'), reply(12), user('q3'), reply(13)];
    expect(planRollbackAnchor(turns, 0)).toBe(11);
    expect(planRollbackAnchor(turns, 2)).toBe(12);
    expect(planRollbackAnchor(turns, 4)).toBe(13);
  });

  it('回退到 assistant 消息：水位线就是它自己', () => {
    const turns = [user('q1'), reply(11), user('q2'), reply(12)];
    expect(planRollbackAnchor(turns, 1)).toBe(11);
    expect(planRollbackAnchor(turns, 3)).toBe(12);
  });

  it('后面一条带记录的消息都没有时返回 null（只本地截断，不碰服务端）', () => {
    const turns = [user('q1'), reply(null), user('q2')];
    expect(planRollbackAnchor(turns, 0)).toBeNull();
    expect(planRollbackAnchor(turns, 5)).toBeNull();
  });

  it('跳过没有 historyId 的回复，继续往后找到真正有记录的那条', () => {
    const turns = [user('q1'), reply(null), user('q2'), reply(12)];
    expect(planRollbackAnchor(turns, 0)).toBe(12);
  });

  it('回退到 user 消息会恢复它当时的输入快照', () => {
    const snap = snapshot({ scene: 'ask', question: '哪个用户下单最多', rowsText: 'a,b\n1,2', connectionId: 7 });
    const turns = [user('q1', snap), reply(11)];
    expect(snapshotForRollback(turns[0])).toEqual(snap);
  });

  it('回退到 assistant 消息不恢复输入（那条消息不是一次提问）', () => {
    const turns = [user('q1'), reply(11)];
    expect(snapshotForRollback(turns[1])).toBeNull();
    expect(snapshotForRollback(undefined)).toBeNull();
  });

  it('快照是深拷贝出来的，回退后改动输入框不会污染历史快照', () => {
    const snap = snapshot({ question: '原始问题' });
    const turns = [user('q1', snap), reply(11)];
    const restored = snapshotForRollback(turns[0])!;
    restored.question = '改过了';
    expect(turns[0]).toMatchObject({ snapshot: { question: '原始问题' } });
    // 且快照对象本身没被改（restored 是同一引用时要能发现）
  });
});
