/**
 * 花生苗数据库管理工具 - 表数据编辑器文案（zh-TW）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 表数据编辑器（Excel 式增删改查）的界面文案。键名以 table. 开头。
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  'table.title': '資料表資料',
  'table.subtitle': '像操作試算表一樣檢視與編輯記錄：新增、修改、刪除，不必手寫 SQL',
  'table.selectConnection': '連線',
  'table.selectTable': '資料表',
  'table.pickTable': '請選擇一張表',
  'table.noTableTitle': '尚未選擇資料表',
  'table.noTableHint': '在左側選一張表，這裡會顯示它的資料並可直接編輯。',
  'table.refresh': '重新整理',
  'table.addRow': '新增列',
  'table.deleteRows': '刪除選取（{count}）',
  'table.save': '儲存變更（{count}）',
  'table.discard': '捨棄變更',
  'table.pageSize': '每頁 {size} 列',
  'table.prev': '上一頁',
  'table.next': '下一頁',
  'table.pageInfo': '第 {page} / {total} 頁',
  'table.totalRows': '共 {count} 列',
  'table.totalUnknown': '列數未知（資料表過大或無法統計）',
  'table.loading': '載入中…',
  'table.empty': '這張表還沒有資料',
  'table.emptyHint': '點「新增列」插入第一筆記錄。',
  'table.rowNew': '新增',
  'table.rowEdited': '已修改',
  'table.rowDeleted': '待刪除',
  'table.selectRow': '選取第 {index} 列',
  'table.selectAll': '全選本頁',
  'table.cellNull': 'NULL',
  'table.cellEdited': '此儲存格已修改',
  'table.locatorPrimary': '定位方式：主鍵 {columns}',
  'table.locatorUnique': '定位方式：唯一索引 {name}（{columns}）',
  'table.locatorNone': '定位方式：無',
  'table.readonlyNoKey': '這張表沒有主鍵，也沒有可用的唯一索引，無法安全地定位到單獨一列。為避免一次誤改多列，這裡只允許檢視與新增。',
  'table.readonlyNoPermission': '目前帳號沒有寫入權限，只能檢視。',
  'table.readonlyConnection': '該連線開啟了唯讀保護，只能檢視。',
  'table.readonlyBanner': '唯讀模式：{reason}',
  'table.errLoad': '載入資料失敗：{message}',
  'table.errSave': '儲存失敗：{message}',
  'table.errNoChanges': '沒有需要儲存的變更',
  'table.errRequired': '欄位 {column} 不允許為空',
  'table.errIdentifier': '表名或欄位名不合法',
  'table.confirmDelete': '確認刪除選取的 {count} 列？會直接作用到資料庫，無法復原。',
  'table.confirmDiscard': '捨棄全部未儲存的變更？',
  'table.saveDone': '已儲存：新增 {inserted} / 修改 {updated} / 刪除 {deleted}',
  'table.unsaved': '有 {count} 處變更尚未儲存',
  'table.sortHint': '點欄位標題可排序',
  'table.newRowHint': '新增的列會附加到最後，儲存後才寫入資料庫',
  'table.pkMissing': '該表缺少主鍵：可以新增列，但無法安全地修改或刪除既有記錄。',
};

export default messages;
