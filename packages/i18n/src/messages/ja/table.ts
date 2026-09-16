/**
 * 花生苗数据库管理工具 - 表数据编辑器文案（ja）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 表数据编辑器（Excel 式增删改查）的界面文案。键名以 table. 开头。
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  'table.title': 'テーブルデータ',
  'table.subtitle': '表計算のようにレコードを閲覧・編集：追加・変更・削除を SQL なしで',
  'table.selectConnection': '接続',
  'table.selectTable': 'テーブル',
  'table.pickTable': 'テーブルを選択してください',
  'table.noTableTitle': 'テーブルが未選択です',
  'table.noTableHint': '左側でテーブルを選ぶと、ここにデータが表示され直接編集できます。',
  'table.refresh': '再読み込み',
  'table.addRow': '行を追加',
  'table.deleteRows': '選択した行を削除（{count}）',
  'table.save': '変更を保存（{count}）',
  'table.discard': '変更を破棄',
  'table.pageSize': '1 ページ {size} 行',
  'table.prev': '前へ',
  'table.next': '次へ',
  'table.pageInfo': '{total} ページ中 {page} ページ目',
  'table.totalRows': '全 {count} 行',
  'table.totalUnknown': '行数は不明です（テーブルが大きすぎるか集計できません）',
  'table.loading': '読み込み中…',
  'table.empty': 'このテーブルにはまだデータがありません',
  'table.emptyHint': '「行を追加」で最初のレコードを挿入できます。',
  'table.rowNew': '追加',
  'table.rowEdited': '変更済み',
  'table.rowDeleted': '削除予定',
  'table.selectRow': '{index} 行目を選択',
  'table.selectAll': 'このページを全選択',
  'table.cellNull': 'NULL',
  'table.cellEdited': 'このセルは変更されています',
  'table.locatorPrimary': '特定方法：主キー {columns}',
  'table.locatorUnique': '特定方法：一意インデックス {name}（{columns}）',
  'table.locatorNone': '特定方法：なし',
  'table.readonlyNoKey': 'このテーブルには主キーも利用できる一意インデックスもないため、1 行を安全に特定できません。複数行を誤って更新しないよう、ここでは閲覧と追加のみ許可しています。',
  'table.readonlyNoPermission': '現在のアカウントに書き込み権限がないため、閲覧のみ可能です。',
  'table.readonlyConnection': 'この接続は読み取り専用保護が有効なため、閲覧のみ可能です。',
  'table.readonlyBanner': '読み取り専用：{reason}',
  'table.errLoad': 'データの読み込みに失敗しました：{message}',
  'table.errSave': '保存に失敗しました：{message}',
  'table.errNoChanges': '保存する変更がありません',
  'table.errRequired': '列 {column} は NULL を許可していません',
  'table.errIdentifier': 'テーブル名または列名が不正です',
  'table.confirmDelete': '選択した {count} 行を削除しますか？データベースに即時反映され、元に戻せません。',
  'table.confirmDiscard': '未保存の変更をすべて破棄しますか？',
  'table.saveDone': '保存しました：追加 {inserted} / 変更 {updated} / 削除 {deleted}',
  'table.unsaved': '未保存の変更が {count} 件あります',
  'table.sortHint': '列見出しをクリックすると並べ替えます',
  'table.newRowHint': '追加した行は末尾に付き、保存後にデータベースへ書き込まれます',
  'table.pkMissing': 'このテーブルには主キーがありません：行の追加はできますが、既存レコードの変更・削除は安全に行えません。',
};

export default messages;
