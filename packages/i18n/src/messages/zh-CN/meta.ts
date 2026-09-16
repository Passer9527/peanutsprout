/**
 * 简体中文（源语言）· 服务端枚举的展示名
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 服务端会在响应里带上中文 `label`。客户端**不直接显示服务端的 label**，
 * 而是按稳定的 `code`/`type` 在本表里取当前语言的展示名 ——
 * 否则切换语言后，数据库类型、权限项这些仍然是中文，界面会中英混杂。
 * 表里找不到对应 code 时才回退到服务端给的 label（自定义角色等场景）。
 */
export default {
  // —— 数据库类别 ——
  'dbCategory.relational': '关系型',
  'dbCategory.keyvalue': '键值型',
  'dbCategory.document': '文档型',
  'dbCategory.columnar': '列式',
  'dbCategory.timeseries': '时序',
  'dbCategory.graph': '图数据库',

  // —— 驱动落地状态 ——
  'driver.implemented': '已实现',
  'driver.notImplemented': '未实现',
  'driver.notImplementedHint': '该类型的驱动尚未实现，连接时会明确返回 DRIVER_NOT_IMPLEMENTED',
  'driver.list': '支持的数据库类型',

  // —— 图表类型（AC-03 点名的条形图/折线图/平行坐标图都在其中）——
  'chartType.bar': '条形图',
  'chartType.column': '柱状图',
  'chartType.line': '折线图',
  'chartType.area': '面积图',
  'chartType.pie': '饼图',
  'chartType.donut': '环形图',
  'chartType.scatter': '散点图',
  'chartType.bubble': '气泡图',
  'chartType.parallel': '平行坐标图',
  'chartType.heatmap': '热力图',
  'chartType.radar': '雷达图',
  'chartType.sankey': '桑基图',
  'chartType.treemap': '矩形树图',
  'chartType.boxplot': '箱线图',
  'chartType.map': '地图',

  'chartTypeDesc.bar': '横向比较分类值',
  'chartTypeDesc.column': '纵向比较分类值',
  'chartTypeDesc.line': '趋势变化',
  'chartTypeDesc.area': '累积趋势',
  'chartTypeDesc.pie': '占比构成',
  'chartTypeDesc.donut': '占比构成（中空）',
  'chartTypeDesc.scatter': '两变量相关性',
  'chartTypeDesc.bubble': '三变量关系',
  'chartTypeDesc.parallel': '多维特征对比',
  'chartTypeDesc.heatmap': '二维密度分布',
  'chartTypeDesc.radar': '多指标综合对比',
  'chartTypeDesc.sankey': '流向与流量分配',
  'chartTypeDesc.treemap': '层级占比',
  'chartTypeDesc.boxplot': '分布与离群值',
  'chartTypeDesc.map': '地理分布',

  // —— 权限项 ——
  'permission.conn.read': '查看连接',
  'permission.conn.write': '管理连接',
  'permission.query.read': '执行查询',
  'permission.query.write': '执行写操作',
  'permission.migrate.read': '查看迁移',
  'permission.migrate.write': '执行迁移',
  'permission.ai.use': '使用 AI',
  'permission.user.manage': '用户管理',
  'permission.audit.read': '查看审计',
  'permission.settings.manage': '系统设置',

  // —— 权限分类 ——
  'permissionCategory.connection': '连接',
  'permissionCategory.query': '查询',
  'permissionCategory.migration': '迁移',
  'permissionCategory.ai': 'AI',
  'permissionCategory.user': '用户',
  'permissionCategory.audit': '审计',
  'permissionCategory.settings': '设置',

  // —— 审计动作 ——
  'auditAction.login': '登录',
  'auditAction.logout': '登出',
  'auditAction.login_failed': '登录失败',
  'auditAction.connect': '建立连接',
  'auditAction.disconnect': '断开连接',
  'auditAction.execute': '执行 SQL',
  'auditAction.migrate': '执行迁移',
  'auditAction.import': '导入数据',
  'auditAction.export': '导出数据',
  'auditAction.ai': '调用 AI',
  'auditAction.user_create': '创建用户',
  'auditAction.user_update': '修改用户',
  'auditAction.user_delete': '删除用户',
  'auditAction.connection_create': '创建连接',
  'auditAction.connection_update': '修改连接',
  'auditAction.connection_delete': '删除连接',
  'auditAction.settings_update': '修改设置',
  'auditAction.audit_verify': '校验审计链',

  // —— 审计结果 ——
  'auditResult.success': '成功',
  'auditResult.failure': '失败',
  'auditResult.denied': '被拒绝',

  // —— 角色 ——
  'role.admin': '管理员',
  'role.developer': '开发人员',
  'role.analyst': '分析师',
  'role.auditor': '审计员',
  'role.viewer': '只读用户',
  'role.custom': '自定义角色',

  // —— 连接健康状态 ——
  'connStatus.ok': '正常',
  'connStatus.failed': '连接失败',
  'connStatus.untested': '未测试',
  'connStatus.testing': '测试中',
  'connStatus.readonly': '只读',

  // —— AI 供应商类别 ——
  'aiProvider.openai-compatible': 'OpenAI 兼容',
  'aiProvider.anthropic': 'Anthropic',
  'aiProvider.gemini': 'Google Gemini',
  'aiProvider.azure-openai': 'Azure OpenAI',
  'aiProvider.deepseek': 'DeepSeek',
  'aiProvider.qwen': '通义千问',
  'aiProvider.zhipu': '智谱 AI',
  'aiProvider.moonshot': '月之暗面',
  'aiProvider.ollama': 'Ollama（本地）',

  // —— 迁移冲突策略 ——
  'conflictStrategy.skip': '跳过已存在',
  'conflictStrategy.overwrite': '覆盖',
  'conflictStrategy.fail': '遇冲突即停',
  'conflictStrategy.append': '追加',
} as const;
