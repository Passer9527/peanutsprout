/**
 * 花生苗数据库管理工具 - 表数据编辑器文案（zh-CN）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 表数据编辑器（Excel 式增删改查）的界面文案。键名以 table. 开头。
 */
const messages = {
  'table.title': '表数据',
  'table.subtitle': '像操作表格一样查看与编辑记录：新增、修改、删除，无需手写 SQL',
  'table.selectConnection': '连接',
  'table.selectTable': '数据表',
  'table.pickTable': '请选择一张表',
  'table.noTableTitle': '还没选择表',
  'table.noTableHint': '在左侧选一张表，这里会显示它的数据并可以直接编辑。',
  'table.refresh': '刷新',
  'table.addRow': '新增行',
  'table.deleteRows': '删除选中（{count}）',
  'table.save': '保存修改（{count}）',
  'table.discard': '丢弃修改',
  'table.pageSize': '每页 {size} 行',
  'table.prev': '上一页',
  'table.next': '下一页',
  'table.pageInfo': '第 {page} / {total} 页',
  'table.totalRows': '共 {count} 行',
  'table.totalUnknown': '行数未知（该表太大或无法统计）',
  'table.loading': '加载中…',
  'table.empty': '这张表还没有数据',
  'table.emptyHint': '点「新增行」插入第一条记录。',
  'table.rowNew': '新增',
  'table.rowEdited': '已修改',
  'table.rowDeleted': '待删除',
  'table.selectRow': '选择第 {index} 行',
  'table.selectAll': '全选本页',
  'table.cellNull': 'NULL',
  'table.cellEdited': '此单元格已修改',
  'table.locatorPrimary': '定位方式：主键 {columns}',
  'table.locatorUnique': '定位方式：唯一索引 {name}（{columns}）',
  'table.locatorNone': '定位方式：无',
  'table.readonlyNoKey': '这张表没有主键，也没有可用的唯一索引，无法安全地定位到单独一行。为避免一次误改多行，这里只允许查看和新增。',
  'table.readonlyNoPermission': '当前账号没有写权限，只能查看。',
  'table.readonlyConnection': '该连接开启了只读保护，只能查看。',
  'table.readonlyBanner': '只读模式：{reason}',
  'table.errLoad': '加载数据失败：{message}',
  'table.errSave': '保存失败：{message}',
  'table.errNoChanges': '没有需要保存的修改',
  'table.errRequired': '列 {column} 不允许为空',
  'table.errIdentifier': '表名或列名不合法',
  'table.confirmDelete': '确认删除选中的 {count} 行？会直接作用到数据库，无法撤销。',
  'table.confirmDiscard': '丢弃全部未保存的修改？',
  'table.saveDone': '已保存：新增 {inserted} / 修改 {updated} / 删除 {deleted}',
  'table.unsaved': '有 {count} 处修改尚未保存',
  'table.sortHint': '点列头可排序',
  'table.newRowHint': '新增的行会追加到末尾，保存后才写入数据库',
  'table.pkMissing': '该表缺少主键：可以新增行，但无法安全地修改或删除已有记录。',
};

export default messages;
