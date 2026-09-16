/**
 * 花生苗数据库管理工具 - AI 服务测试
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 核心回归：`ai.redaction_enabled` 是**运行时**可写的设置。
 * 之前的实现只在 AiService 构造时读一次并固化到 RedactionGateway，
 * 启动时关掉、之后管理员打开，仍然会明文把结果集发给大模型，
 * 而 /ai/status 与 /ai/ask 的 redactionApplied 却读实时值返回 true ——
 * 界面与审计得到"已脱敏"的错误结论，敏感数据已经出网。
 *
 * 这里断言：行为随设置即时变化，且审计里记录的状态与真实行为一致。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashSecret, openPeanutDatabase, type PeanutDatabase } from '@peanutsprout/storage';
import type { FetchLike } from './provider.js';
import { AiService, type AiActor } from './service.js';

let pdb: PeanutDatabase;
let actor: AiActor;
/** 捕获每次出网请求，用于断言结果集是否真的被脱敏 */
let captured: Array<{ url: string; body: string }>;

/** 手机号明文，脱敏后不应再出现在请求体里 */
const RAW_PHONE = '13800138000';

const sensitiveContext = {
  resultColumns: [{ name: 'phone', dataType: 'TEXT' }],
  resultRows: [[RAW_PHONE]],
};

/** 假 fetch：返回一个合法的 OpenAI 兼容响应，并记录请求体。 */
const recordingFetch: FetchLike = async (input, init) => {
  captured.push({ url: String(input), body: typeof init?.body === 'string' ? init.body : '' });
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: '好的' } }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};

function setRedaction(enabled: boolean): void {
  pdb.settings.set('ai.redaction_enabled', String(enabled), 'ai');
}

/** 最近一次 ai 审计记录的 detail（JSON 字符串） */
function latestAuditDetail(index = 0): string {
  const items = pdb.audit.query({ action: 'ai' }).items;
  return JSON.stringify(items[index]?.detail ?? null);
}

beforeEach(() => {
  captured = [];
  pdb = openPeanutDatabase({ memory: true });
  const user = pdb.users.create({
    username: 'ai-tester',
    passwordHash: hashSecret('Str0ng-Passw0rd!'),
    isAdmin: true,
    roles: ['admin'],
  });
  actor = { userId: user.id, username: user.username };
  pdb.settings.set('ai.enabled', 'true', 'ai');
  pdb.aiConfigs.create({
    name: '测试供应商',
    provider: 'openai',
    modelName: 'gpt-4o-mini',
    baseUrl: 'https://example.test/v1',
    apiKey: 'sk-test-key',
  });
});

afterEach(() => {
  pdb.close();
});

describe('AiService · 脱敏开关运行时生效', () => {
  it('启动时关闭 → 运行中打开：行为与回报状态同步变化', async () => {
    setRedaction(false);
    const svc = new AiService({ pdb, fetchImpl: recordingFetch });
    // 构造时读到的是"关闭"
    expect(svc.redactionEnabled).toBe(false);

    await svc.answerQuestion('这些手机号都是谁', sensitiveContext, actor);
    expect(captured[0]?.body).toContain(RAW_PHONE);

    // 管理员在设置页把脱敏打开，无需重启/重建服务
    setRedaction(true);
    expect(svc.redactionEnabled).toBe(true);

    await svc.answerQuestion('这些手机号都是谁', sensitiveContext, actor);
    expect(captured[1]?.body).not.toContain(RAW_PHONE);

    // 审计记录必须与真实行为一致：最新一次已脱敏，上一次明确标注未脱敏
    expect(latestAuditDetail(0)).toContain('已脱敏');
    expect(latestAuditDetail(1)).toContain('未做脱敏');
  });

  it('启动时开启 → 运行中关闭：立刻停止脱敏，审计同步标注', async () => {
    setRedaction(true);
    const svc = new AiService({ pdb, fetchImpl: recordingFetch });

    await svc.answerQuestion('这些手机号都是谁', sensitiveContext, actor);
    expect(captured[0]?.body).not.toContain(RAW_PHONE);

    setRedaction(false);
    expect(svc.redactionEnabled).toBe(false);
    await svc.answerQuestion('这些手机号都是谁', sensitiveContext, actor);
    expect(captured[1]?.body).toContain(RAW_PHONE);

    expect(latestAuditDetail(0)).toContain('未做脱敏');
  });

  it('脱敏开启但未命中敏感列时：原样发送并在审计里说明未命中', async () => {
    setRedaction(true);
    const svc = new AiService({ pdb, fetchImpl: recordingFetch });
    await svc.answerQuestion(
      '这个人叫什么',
      { resultColumns: [{ name: 'name', dataType: 'TEXT' }], resultRows: [['张三']] },
      actor,
    );
    // 非敏感列保持原值发送
    expect(captured[0]?.body).toContain('张三');
    expect(latestAuditDetail(0)).toContain('未命中敏感列');
  });
});

/**
 * `onHistory` 钩子：界面上的「撤回这条消息 / 回退到某一次操作」要能删掉服务端
 * 对应的 `ai_history` 记录，所以每次调用都必须把**真实的记录 id** 交出来。
 *
 * 之前的写法是事后 `SELECT MAX(id)`，在同用户并发请求下会指到别人的记录上 ——
 * 撤回一次就可能删掉一条无关的历史。这里钉住"回调给出的一定是本次那条"。
 */
describe('AiService · 调用记录 id 回调', () => {
  function collector(): { hooks: { onHistory: (id: number) => void }; ids: number[] } {
    const ids: number[] = [];
    return { hooks: { onHistory: (id: number) => ids.push(id) }, ids };
  }

  it('成功路径：回调拿到的 id 就是本次写入的那条记录', async () => {
    const svc = new AiService({ pdb, fetchImpl: recordingFetch });
    const { hooks, ids } = collector();

    await svc.answerQuestion('随便问问', sensitiveContext, actor, hooks);
    expect(ids).toHaveLength(1);

    const row = pdb.db.get<{ user_id: number; scene: string; status: string; response: string }>(
      'SELECT user_id, scene, status, response FROM ai_history WHERE id = ?',
      ids[0]!,
    );
    // 确实是本次调用、确实是这个用户、确实成功了
    expect(row).toMatchObject({ user_id: actor.userId, status: 'success' });
  });

  it('多条调用各自拿到自己的 id，不是同一个也不是最大值', async () => {
    const svc = new AiService({ pdb, fetchImpl: recordingFetch });
    const first = collector();
    const second = collector();

    await svc.answerQuestion('第一次', sensitiveContext, actor, first.hooks);
    await svc.answerQuestion('第二次', sensitiveContext, actor, second.hooks);

    expect(first.ids[0]).not.toBe(second.ids[0]);
    expect(second.ids[0]!).toBeGreaterThan(first.ids[0]!);
    // 每条 id 对应的 prompt 必须是各自那次的内容
    const promptOf = (id: number) =>
      pdb.db.get<{ prompt: string | null }>('SELECT prompt FROM ai_history WHERE id = ?', id)?.prompt;
    expect(promptOf(first.ids[0]!)).toContain('第一次');
    expect(promptOf(second.ids[0]!)).toContain('第二次');
  });

  it('失败路径同样回调：失败的调用也要能撤回，不能只在成功时给 id', async () => {
    const failingFetch: FetchLike = async () =>
      new Response(JSON.stringify({ error: { message: '模型炸了' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    const svc = new AiService({ pdb, fetchImpl: failingFetch });
    const { hooks, ids } = collector();

    await expect(svc.answerQuestion('会失败', sensitiveContext, actor, hooks)).rejects.toThrow();
    // 关键：抛错也要先把 id 交出来，否则界面无法撤回这条失败记录
    expect(ids).toHaveLength(1);
    const row = pdb.db.get<{ status: string }>('SELECT status FROM ai_history WHERE id = ?', ids[0]!);
    expect(row?.status).toBe('failed');
  });

  it('不传钩子不会报错（CLI 等调用方不需要这个能力）', async () => {
    const svc = new AiService({ pdb, fetchImpl: recordingFetch });
    await expect(svc.answerQuestion('无钩子', sensitiveContext, actor)).resolves.toBeDefined();
  });

  it('撤回后该 id 不再存在，且回调过的 id 不会指向别人的记录', async () => {
    const other = pdb.users.create({
      username: 'ai-other',
      passwordHash: hashSecret('0ther-Passw0rd!'),
      isAdmin: false,
      roles: ['readonly'],
    });
    const svc = new AiService({ pdb, fetchImpl: recordingFetch });
    const otherCollector = collector();
    await svc.answerQuestion('别人的调用', sensitiveContext, { userId: other.id, username: other.username }, otherCollector.hooks);

    const mine = collector();
    await svc.answerQuestion('我的调用', sensitiveContext, actor, mine.hooks);

    // 用"我的" id 去删，另一个人的记录必须毫发无损
    expect(pdb.aiConfigs.deleteHistory(actor.userId, mine.ids[0]!)).toBe(true);
    expect(
      pdb.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_history WHERE id = ?', otherCollector.ids[0]!)?.n,
    ).toBe(1);
    // 我的那条确实没了
    expect(pdb.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_history WHERE id = ?', mine.ids[0]!)?.n).toBe(0);
  });
});
