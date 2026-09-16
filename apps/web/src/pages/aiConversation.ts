/**
 * 花生苗数据库管理工具 - AI 对话的纯逻辑
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 这里放的是"撤回/回退/发送后清空"三类**不依赖 React 与 DOM** 的判定。
 * 单独拆出来的原因：这三件事都是"删哪些、留哪些"的边界判断，
 * 写在组件里只能用眼睛看，而它们又恰好是最容易写错的地方 ——
 * 例如把用户消息和它的回复拆开撤、或者回退时多删一条。
 * 拆成纯函数后可以直接用单测把边界钉住（vitest 只收 `*.test.ts`，不收 `.tsx`）。
 */

export type SceneKey = 'nl2sql' | 'explain' | 'optimize' | 'document' | 'ask' | 'diagnose';

/** 发送那一刻的输入快照，"回退到这里"要把它们原样放回输入框。 */
export interface ComposerSnapshot {
  scene: SceneKey;
  connectionId: number | '';
  question: string;
  sql: string;
  errorText: string;
  rowsText: string;
}

/** 输入框的四个文本字段。 */
export interface ComposerInputs {
  question: string;
  sql: string;
  errorText: string;
  rowsText: string;
}

/**
 * 这些函数只关心"角色 + 服务端记录 id + 输入快照"三件事。
 *
 * 故意不在这里定义完整的 `Turn` 联合类型：页面里的每条记录还带着 SQL 结果、
 * 说明文本等富载荷，若在本模块重复定义一遍，改一处就会两处不同步。
 * 用这个最小结构做参数类型，页面的富类型天然满足它（结构化类型）。
 */
export interface TurnLike {
  role: 'user' | 'assistant';
  historyId?: number | null;
  snapshot?: ComposerSnapshot;
}

/** 每个技能实际会用到的输入字段。 */
export const SCENE_INPUTS: Record<SceneKey, Array<keyof ComposerInputs>> = {
  nl2sql: ['question'],
  explain: ['sql'],
  optimize: ['sql'],
  document: [],
  ask: ['question', 'rowsText'],
  diagnose: ['sql', 'errorText'],
};

/**
 * 发送之后应当保留的输入。
 *
 * 需求原文：「已经发送的信息不要保留在输入框中」。
 * 只清**本技能用到的**字段：例如在"解释 SQL"里发完就清 SQL，
 * 不该把用户在另一个技能里填了一半的内容也一起抹掉。
 */
export function inputsAfterSend(scene: SceneKey, current: ComposerInputs): ComposerInputs {
  const next = { ...current };
  for (const field of SCENE_INPUTS[scene]) next[field] = '';
  return next;
}

export interface WithdrawPlan {
  /** 需要在服务端删除的 ai_history 记录 id（不含 null） */
  historyIds: number[];
  /** 本地要删掉的连续 turn 条数（从 index 开始） */
  removeCount: number;
}

/**
 * 「撤回」这一条要做什么。
 *
 * 规则：
 *  · 撤一条 **assistant** 消息 → 只删它自己那条调用记录，删 1 个 turn；
 *  · 撤一条 **user** 消息 → 连它后面紧邻的那条回复一起删（否则会留下
 *    一条"没有提问的回答"），并把那次调用的服务端记录一并删除；
 *  · 用户消息后面没有回复（还在生成 / 生成失败）→ 只删 1 个 turn。
 */
export function planWithdraw(turns: readonly TurnLike[], index: number): WithdrawPlan {
  const turn = turns[index];
  if (!turn) return { historyIds: [], removeCount: 0 };

  if (turn.role === 'assistant') {
    // historyId 为 null/undefined 表示后端没回传（或该次失败没落库）：本地照撤，不动服务端
    return { historyIds: turn.historyId == null ? [] : [turn.historyId], removeCount: 1 };
  }

  const reply = turns[index + 1];
  if (reply && reply.role === 'assistant') {
    return {
      historyIds: reply.historyId == null ? [] : [reply.historyId],
      removeCount: 2,
    };
  }
  return { historyIds: [], removeCount: 1 };
}

/**
 * 「回退到这里」要作为水位线的那条服务端记录。
 *
 * 从 index 往后找第一条**带 historyId 的 assistant 消息** —— 那才是这一轮
 * 真正产生的那次调用。对 user 消息来说就是紧随其后的回复；
 * 对 assistant 消息来说就是它自己。找不到（例如生成失败没有记录）返回 null，
 * 此时只做本地截断，不去碰服务端。
 */
export function planRollbackAnchor(turns: readonly TurnLike[], index: number): number | null {
  for (let i = index; i < turns.length; i += 1) {
    const candidate = turns[i];
    if (candidate && candidate.role === 'assistant' && candidate.historyId != null) {
      return candidate.historyId;
    }
  }
  return null;
}

/**
 * 回退之后要恢复的输入快照。
 *
 * 回退到一条 user 消息 → 恢复它当时的输入（用户接着改一改再发）。
 * 回退到一条 assistant 消息 → 不恢复输入（该消息不是"某次提问"），
 * 但仍然会截断它之后的对话。
 *
 * **返回副本而不是原对象**：调用方拿到之后往往直接当作输入框的受控状态用，
 * 一旦有人原地改它（`snap.question = ...`），历史快照就被悄悄污染了，
 * 之后再回退到同一步拿到的就是被改过的内容。复制一份的成本可以忽略。
 */
export function snapshotForRollback(turn: TurnLike | undefined): ComposerSnapshot | null {
  if (!turn || turn.role !== 'user') return null;
  return turn.snapshot ? { ...turn.snapshot } : null;
}
