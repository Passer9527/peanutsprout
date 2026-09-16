/**
 * 简体中文（源语言）· data 命名空间（连接管理 + SQL 开发）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 只收录「连接管理」与「SQL 开发」两个模块特有的说法：
 * 通用按钮 / 状态 / 表头 / 计数 / 时间单位请复用 common.*，
 * 数据库类别、驱动状态等服务端枚举请复用 meta 命名空间（dbCategory.* / driver.*）。
 *
 * 计数类文案用无后缀键承载中文的 other 形式；其它语言（英/俄等）需要
 * one/few/many 时，由译者在各自语言包里追加 `key.one` / `key.few` / …… 即可，
 * 引擎通过 Intl.PluralRules 自动选择。
 */
export default {
  // —— 连接管理：表单与标题 ——
  'data.conn.createTitle': '新建连接',
  'data.conn.createSubmit': '创建连接',
  'data.conn.editAction': '编辑连接',
  'data.conn.editTitle': '编辑连接：{name}',
  'data.conn.modalDescription': '连接信息保存在服务端，密码字段加密存储且不会回显。',
  'data.conn.fieldName': '连接名称 *',
  'data.conn.namePlaceholder': '如：生产订单库',
  'data.conn.fieldDbType': '数据库类型 *',
  // 数据库类型下拉项的整体格式（含全角括号，英文等语言应改成半角）
  'data.conn.dbTypeOption': '{label}（{category}）',
  'data.conn.fieldHost': '主机',
  'data.conn.fieldPort': '端口',
  'data.conn.portPlaceholder': '默认端口',
  'data.conn.fieldDatabase': '数据库 / Schema',
  'data.conn.fieldUsername': '用户名',
  'data.conn.fieldPassword': '密码',
  'data.conn.passwordPlaceholderEdit': '留空表示不修改已保存的密码',
  'data.conn.passwordPlaceholderCreate': '可选，保存后服务端加密存储',
  'data.conn.passwordSaved': '该连接已保存密码。',
  'data.conn.passwordNotSaved': '该连接尚未保存密码。',
  'data.conn.passwordSavedNoEcho': '已保存（不回显）',
  'data.conn.notSaved': '未保存',
  'data.conn.passwordSavedTitle': '已保存密码',
  'data.conn.fieldUrl': '连接串（可选）',
  'data.conn.urlPlaceholder': '填写后优先使用连接串，如 mysql://user:pass@host:3306/db',
  'data.conn.fieldExtraParams': '额外参数（JSON，可选）',
  'data.conn.extraParamsPlaceholder': '如 {"ssl": true, "charset": "utf8mb4"}',
  'data.conn.fieldColorTag': '颜色标记',
  'data.conn.colorNone': '无标记',
  'data.conn.colorSwatchAria': '颜色标记 {color}',
  'data.conn.readonlyLabel': '只读连接',
  'data.conn.readonlyHint': '开启后服务端会拒绝该连接上的写操作。',
  'data.conn.favoriteLabel': '加入收藏',
  'data.conn.unfavoriteLabel': '取消收藏',
  'data.conn.favoritedTitle': '已收藏',
  'data.conn.favoriteBadge': '收藏',
  'data.conn.favoriteHint': '收藏的连接在列表中优先展示。',
  'data.conn.createNote': '提示：连接创建并保存后，才能在列表中执行「测试连接」。',
  // meta.driver.* 只提供「已实现/未实现」，这里补上「驱动」前缀以保持原有文案。
  'data.conn.driverNotImplemented': '驱动{status}',

  // —— 连接管理：表单校验 ——
  'data.conn.errorNameRequired': '请输入连接名称。',
  'data.conn.errorDbTypeRequired': '请选择数据库类型。',
  'data.conn.errorPortNumeric': '端口必须是数字。',
  'data.conn.errorExtraParamsObject': '额外参数必须是 JSON 对象，例如 {"ssl": true}。',
  'data.conn.errorExtraParamsInvalid': '额外参数不是合法 JSON，请检查格式。',

  // —— 连接管理：列表与工具栏 ——
  'data.conn.searchPlaceholder': '搜索名称、主机、数据库',
  'data.conn.allTypes': '全部类型',
  'data.conn.favoriteOnly': '仅看收藏',
  'data.conn.totalConnections': '共 {count} 个连接',
  'data.conn.colName': '连接名称',
  'data.conn.colAddress': '地址',
  'data.conn.colLastUsed': '最近使用',
  'data.conn.colConnectivity': '连通性',
  'data.conn.statusFailed': '失败',
  'data.conn.testing': '测试中…',
  'data.conn.notTested': '尚未测试',
  'data.conn.testConnection': '测试连接',
  'data.conn.empty': '还没有数据库连接',
  'data.conn.emptyHint': '点击右上角「新建连接」添加第一个数据源。',

  // —— 连接管理：详情面板与删除确认 ——
  'data.conn.editThis': '编辑该连接',
  'data.conn.deleteTitle': '删除连接',
  'data.conn.deleteConfirm': '确定要删除连接「{name}」吗？删除后该连接上的 SQL 开发与历史引用将失效。',
  'data.conn.sessionTest': '本次会话测试',
  'data.conn.detailHint': '连接密码由服务端加密保存；如需更换密码，请在编辑弹窗中填写新密码后保存。',

  // —— 连接管理：操作反馈（{message} 为已本地化的错误文案）——
  'data.conn.loadListFailed': '加载连接列表失败：{message}',
  'data.conn.loadDbTypesFailed': '加载数据库类型失败：{message}',
  'data.conn.created': '连接「{name}」已创建。',
  'data.conn.createFailed': '创建连接失败：{message}',
  'data.conn.updated': '连接「{name}」已更新。',
  'data.conn.updateFailed': '更新连接失败：{message}',
  'data.conn.testSuccess': '「{name}」连接成功：{latency} ms{version}',
  'data.conn.testFailed': '「{name}」连接失败：{message}',
  'data.conn.testRequestFailed': '测试连接失败：{message}',
  'data.conn.favoriteFailed': '更新收藏状态失败：{message}',
  'data.conn.deleted': '连接「{name}」已删除。',
  'data.conn.deleteFailed': '删除连接失败：{message}',
  'data.conn.detailTestSuccess': '连接成功：{latency} ms{version}',
  'data.conn.detailTestFailed': '连接失败：{message}',

  // —— 数据库类型品牌名（按稳定 code 收录；未收录的自定义类型回退服务端 label）——
  'data.dbType.mysql': 'MySQL',
  'data.dbType.mariadb': 'MariaDB',
  'data.dbType.postgresql': 'PostgreSQL',
  'data.dbType.oracle': 'Oracle',
  'data.dbType.sqlserver': 'SQL Server',
  'data.dbType.sqlite': 'SQLite',
  'data.dbType.kingbase': '金仓 KingbaseES',
  'data.dbType.dm': '达梦 DM',
  'data.dbType.oceanbase': 'OceanBase',
  'data.dbType.tidb': 'TiDB',
  'data.dbType.redis': 'Redis',
  'data.dbType.mongodb': 'MongoDB',
  'data.dbType.clickhouse': 'ClickHouse',
  'data.dbType.influxdb': 'InfluxDB',
  'data.dbType.neo4j': 'Neo4j',

  // —— SQL 开发：对象树 ——
  'data.sql.treeTitle': '连接与对象',
  'data.sql.connectionLabel': '数据库连接',
  'data.sql.selectConnection': '请选择连接',
  // 连接下拉项的整体格式（含全角括号，英文等语言应改成半角）
  'data.sql.connectionOption': '{name}（{type}）',
  'data.sql.treeSelectConnection': '请先选择数据库连接，随后可浏览该连接下的 Schema 与数据表。',
  'data.sql.loadingSchemas': '正在加载 Schema…',
  'data.sql.noSchemas': '未获取到 Schema，请确认账号权限或连接配置。',
  'data.sql.loadingTables': '加载数据表…',
  'data.sql.noTables': '该 Schema 下没有数据表。',
  'data.sql.loadingColumns': '加载字段…',
  'data.sql.noColumns': '未获取到字段信息。',
  'data.sql.insertQuery': '插入查询语句',
  'data.sql.loadSchemasFailed': '加载 Schema 失败：{message}',
  'data.sql.loadTablesFailed': '加载数据表失败：{message}',
  'data.sql.loadColumnsFailed': '加载字段失败：{message}',

  // —— SQL 开发：执行历史 ——
  'data.sql.historyTitle': '执行历史',
  'data.sql.refreshHistory': '刷新执行历史',
  'data.sql.noHistory': '暂无执行记录。',
  'data.sql.slowQuery': '慢查询',
  'data.sql.loadHistoryFailed': '加载执行历史失败：{message}',

  // —— SQL 开发：编辑器与结果区 ——
  'data.sql.loadConnectionsFailed': '加载连接列表失败：{message}',
  'data.sql.selectConnectionFirst': '请先选择数据库连接。',
  'data.sql.enterSqlToRun': '请输入要执行的 SQL 语句。',
  'data.sql.enterSqlToExplain': '请输入要分析的 SQL 语句。',
  'data.sql.executed': '执行完成：{rows} · 影响 {affected} · {duration}{suffix}',
  'data.sql.execFailed': '执行失败：{message}',
  'data.sql.explainFailed': '获取执行计划失败：{message}',
  'data.sql.editorTitle': 'SQL 编辑器',
  'data.sql.run': '执行',
  'data.sql.explain': '执行计划',
  'data.sql.copySql': '复制 SQL',
  'data.sql.clearEditor': '清空编辑器',
  'data.sql.showHistory': '显示执行历史',
  'data.sql.hideHistory': '隐藏执行历史',
  'data.sql.readonlyBanner': '当前连接为只读模式，写操作（INSERT / UPDATE / DELETE / DDL）会被服务端拒绝。',
  'data.sql.editorPlaceholder': '在此输入 SQL，Ctrl / Cmd + Enter 执行',
  'data.sql.maxRows': '最大返回行数',
  'data.sql.serverDefault': '服务端默认',
  'data.sql.timeoutMs': '超时（毫秒）',
  'data.sql.shortcutHint': '快捷键：Ctrl / Cmd + Enter 执行当前编辑器内的 SQL',
  'data.sql.tabResult': '结果',
  'data.sql.tabMessage': '消息',
  'data.sql.returnedRows': '返回 {count} 行',
  'data.sql.affectedRows': '影响 {count} 行',
  'data.sql.elapsed': '耗时 {duration}',
  'data.sql.successTitle': '语句执行成功',
  'data.sql.successNoResult': '该语句没有返回结果集，影响 {count} 行。',
  'data.sql.emptyResult': '结果集为空',
  'data.sql.emptyResultHint': '语句执行成功，但没有匹配到任何数据。',
  'data.sql.notExecutedTitle': '尚未执行 SQL',
  'data.sql.notExecutedHint': '选择连接并输入语句后，按 Ctrl / Cmd + Enter 或点击「执行」查看结果。',
  'data.sql.noPlanTitle': '暂无执行计划',
  'data.sql.noPlanHint': '点击「执行计划」按钮，服务端将返回该语句的文本执行计划。',
  'data.sql.noMessages': '本次会话暂无错误消息。',
  'data.sql.lastSuccess': '最近一次成功执行：{count} 行，耗时 {duration}。',

  // —— SQL 开发：导出与复制 ——
  // 结果被截断时的括号包裹格式（正文复用 common.truncated）
  'data.sql.truncatedSuffix': '（{text}）',
  'data.sql.noExportData': '暂无可导出的结果集。',
  'data.sql.exported': '已导出 {format} 文件。',
  'data.sql.emptyEditor': '当前编辑器没有内容。',
  'data.sql.copied': 'SQL 已复制到剪贴板。',
  'data.sql.copyFailed': '浏览器拒绝了剪贴板访问，请手动复制。',

  // —— 结果表格 ——
  // NULL 单元格的展示约定：固定显示 (NULL)，属于技术写法，各语言保持一致。
  'data.grid.nullCell': '(NULL)',
  'data.conn.errorExtraParamsValue': '「额外参数」的值必须是字符串：{key}',
} as const;
