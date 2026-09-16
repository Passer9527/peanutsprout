/**
 * 花生苗数据库管理工具 - 语言包汇总
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 每个语言按**命名空间拆分文件**（common / nav / meta / errors / auth / data /
 * viz / admin / ai）。这样多人（或多个 agent）翻译不同模块时各改各的文件，
 * 不会在同一个巨型语言包文件上互相冲突。
 *
 * 简体中文是源语言：它的键集合就是权威键集合，`MessageKey` 由它推导，
 * 其余语言只允许是它的子集（漏译会回退到中文并被测试报出来）。
 */
import type { LocaleCode } from '../locales.js';
import type { MessageCatalog, PluralSuffix } from '../types.js';


import zhCnCommon from './zh-CN/common.js';
import zhCnNav from './zh-CN/nav.js';
import zhCnMeta from './zh-CN/meta.js';
import zhCnErrors from './zh-CN/errors.js';
import zhCnAuth from './zh-CN/auth.js';
import zhCnData from './zh-CN/data.js';
import zhCnViz from './zh-CN/viz.js';
import zhCnAdmin from './zh-CN/admin.js';
import zhCnAi from './zh-CN/ai.js';
import zhCnTable from './zh-CN/table.js';
import zhCnDesigner from './zh-CN/designer.js';

import zhTwCommon from './zh-TW/common.js';
import zhTwNav from './zh-TW/nav.js';
import zhTwMeta from './zh-TW/meta.js';
import zhTwErrors from './zh-TW/errors.js';
import zhTwAuth from './zh-TW/auth.js';
import zhTwData from './zh-TW/data.js';
import zhTwViz from './zh-TW/viz.js';
import zhTwAdmin from './zh-TW/admin.js';
import zhTwAi from './zh-TW/ai.js';
import zhTwTable from './zh-TW/table.js';
import zhTwDesigner from './zh-TW/designer.js';

import enCommon from './en/common.js';
import enNav from './en/nav.js';
import enMeta from './en/meta.js';
import enErrors from './en/errors.js';
import enAuth from './en/auth.js';
import enData from './en/data.js';
import enViz from './en/viz.js';
import enAdmin from './en/admin.js';
import enAi from './en/ai.js';
import enTable from './en/table.js';
import enDesigner from './en/designer.js';

import ruCommon from './ru/common.js';
import ruNav from './ru/nav.js';
import ruMeta from './ru/meta.js';
import ruErrors from './ru/errors.js';
import ruAuth from './ru/auth.js';
import ruData from './ru/data.js';
import ruViz from './ru/viz.js';
import ruAdmin from './ru/admin.js';
import ruAi from './ru/ai.js';
import ruTable from './ru/table.js';
import ruDesigner from './ru/designer.js';

import jaCommon from './ja/common.js';
import jaNav from './ja/nav.js';
import jaMeta from './ja/meta.js';
import jaErrors from './ja/errors.js';
import jaAuth from './ja/auth.js';
import jaData from './ja/data.js';
import jaViz from './ja/viz.js';
import jaAdmin from './ja/admin.js';
import jaAi from './ja/ai.js';
import jaTable from './ja/table.js';
import jaDesigner from './ja/designer.js';

import koCommon from './ko/common.js';
import koNav from './ko/nav.js';
import koMeta from './ko/meta.js';
import koErrors from './ko/errors.js';
import koAuth from './ko/auth.js';
import koData from './ko/data.js';
import koViz from './ko/viz.js';
import koAdmin from './ko/admin.js';
import koAi from './ko/ai.js';
import koTable from './ko/table.js';
import koDesigner from './ko/designer.js';

/**
 * 这里**刻意不写类型标注**。
 *
 * 如果写成 `const zhCN: MessageCatalog = {...}`，TS 会把它的类型放宽成
 * `Record<string, string>`，于是 `keyof typeof zhCN` 退化成 `string` ——
 * 键名约束会**静默失效**，`t('随便什么')` 都能编译通过。
 * 保持推断才能拿到字面量键的联合类型。`MessageCatalog` 只在导出时标注。
 */
const zhCN = {
  ...zhCnCommon,
  ...zhCnNav,
  ...zhCnMeta,
  ...zhCnErrors,
  ...zhCnAuth,
  ...zhCnData,
  ...zhCnViz,
  ...zhCnAdmin,
  ...zhCnAi,
  ...zhCnTable,
  ...zhCnDesigner,
};

/**
 * 源语言语言包。所有其它语言都以它的键集合为基准做完整性校验。
 */
export const SOURCE_MESSAGES: MessageCatalog = zhCN;

/**
 * 权威键类型。web 端 `t('...')` 传错键名会在**编译期**报错，
 * 而不是等到界面上显示出一串键名。
 */
export type MessageKey = keyof typeof zhCN;

/**
 * 允许**目标语言自行补充复数形式**的键类型。
 *
 * 源语言是中文，中文只有 `other` 一种复数类别，所以简体中文包里没有
 * `common.countRows.few`；而俄语必须提供它。这里用模板字面量类型把
 * `任意源键 + 复数后缀` 也纳入合法键集合，于是：
 *   · 拼错键名仍然**编译期报错**；
 *   · 合法的复数补充不会被误判为错误。
 */
export type MessageKeyWithPlurals = MessageKey | `${MessageKey}.${PluralSuffix}`;

/**
 * 组装一个非源语言的完整语言包。
 * 各命名空间模块声明为 `Partial<Record<MessageKeyWithPlurals, string>>`，
 * 于是**引用一个源语言里不存在的键会编译报错**（防止打字错误）；
 * 而漏译是允许的 —— 运行时会回退到中文，并由键完整性测试报出来。
 */
export function mergeCatalog(
  parts: Array<Partial<Record<MessageKeyWithPlurals, string>>>,
): MessageCatalog {
  return Object.assign({}, ...parts) as MessageCatalog;
}

export { zhCN };

/**
 * 已注册的语言包。缺任何一种语言都会被 `catalogs.test.ts` 与
 * `pnpm verify` 的「国际化」小节报出来。
 */
export const MESSAGES: Partial<Record<LocaleCode, MessageCatalog>> = {
  'zh-CN': zhCN,
  'zh-TW': mergeCatalog([
    zhTwCommon,
    zhTwNav,
    zhTwMeta,
    zhTwErrors,
    zhTwAuth,
    zhTwData,
    zhTwViz,
    zhTwAdmin,
    zhTwAi,
    zhTwTable,
    zhTwDesigner,
  ]),
  'en': mergeCatalog([
    enCommon,
    enNav,
    enMeta,
    enErrors,
    enAuth,
    enData,
    enViz,
    enAdmin,
    enAi,
    enTable,
    enDesigner,
  ]),
  'ru': mergeCatalog([
    ruCommon,
    ruNav,
    ruMeta,
    ruErrors,
    ruAuth,
    ruData,
    ruViz,
    ruAdmin,
    ruAi,
    ruTable,
    ruDesigner,
  ]),
  'ja': mergeCatalog([
    jaCommon,
    jaNav,
    jaMeta,
    jaErrors,
    jaAuth,
    jaData,
    jaViz,
    jaAdmin,
    jaAi,
    jaTable,
    jaDesigner,
  ]),
  'ko': mergeCatalog([
    koCommon,
    koNav,
    koMeta,
    koErrors,
    koAuth,
    koData,
    koViz,
    koAdmin,
    koAi,
    koTable,
    koDesigner,
  ]),
};
