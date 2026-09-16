/**
 * 简体中文（源语言）· 应用外壳与导航
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
export default {
  // —— 产品标识 ——
  'app.name': '花生苗',
  'app.fullName': '花生苗数据库管理工具',
  'app.tagline': '数据库统一管理客户端',
  'app.copyright': 'AGPL-3.0 · 飞哥',
  'app.documentTitle': '花生苗 · 数据库统一管理客户端',
  'app.documentDescription': '花生苗 - 数据库统一管理客户端 Web 管理界面',

  // —— 侧边导航 ——
  'nav.ariaLabel': '主导航',
  'nav.toggleSidebar': '折叠/展开导航',
  'nav.collapseSidebar': '收起侧边栏',
  'nav.expandSidebar': '展开侧边栏',
  'nav.collapseText': '收起导航',
  'nav.asideDefaultTitle': '辅助面板',
  'nav.expandAside': '展开右侧面板',
  'nav.collapseAside': '收起右侧面板',

  // —— 各功能页标题与说明（同时用于页面标题与导航悬浮说明）——
  'nav.connections.label': '连接管理',
  'nav.connections.description': '维护数据库连接、测试连通性与只读策略',
  'nav.sql.label': 'SQL 开发',
  'nav.sql.description': '对象树浏览、SQL 执行、结果导出与执行历史',
  'nav.charts.label': '数据可视化',
  'nav.charts.description': '创建条形图、折线图等图表并查看实时取数结果',
  'nav.dashboards.label': '看板',
  'nav.dashboards.description': '把多张图表组合成一屏看板，支持共享与网格布局',
  'nav.audit.label': '审计日志',
  'nav.audit.description': '操作审计追溯与哈希链完整性校验',
  'nav.users.label': '用户与权限',
  'nav.users.description': '账号、角色与管理员权限管理',
  'nav.settings.label': '设置',
  'nav.settings.description': '主题外观、服务地址、修改密码与关于',
  'nav.ai.label': 'AI 助手',
  'nav.ai.description': '自然语言转 SQL、解释与优化、生成文档、结果集问答',
  'nav.table.label': '表数据',
  'nav.table.description': '选中一张表，像操作表格一样增删改查记录',
  'nav.designer.label': '建库建表',
  'nav.designer.description': '可视化设计 Schema 与表结构，执行前可预览 DDL',

  // —— 顶栏 ——
  'topbar.switchToLight': '切换到浅色主题',
  'topbar.switchToDark': '切换到深色主题',
  'topbar.language': '语言',
  'topbar.switchLanguage': '切换界面语言',
  'topbar.adminSuffix': ' · 管理员',
  'topbar.logout': '退出登录',
  'topbar.logoutConfirm': '确认退出登录？',
  'topbar.logoutConfirmHint': '退出后需要重新输入账号密码。',

  // —— 应用外壳提示 ——
  'app.checkingSession': '正在校验登录状态…',
  'app.forbiddenTitle': '无权访问',
  'app.forbiddenHint': '用户与权限管理仅对管理员开放。',
  'app.asideConnectionTitle': '连接详情',
  'app.asideConnectionEmpty': '在左侧列表中选择一个连接',
  'app.asideConnectionEmptyHint': '可查看连接详情、颜色标记与只读策略，并单独测试连通性。',

  // —— 语言设置 ——
  'language.title': '界面语言',
  'language.description': '切换后立即生效，并记住你的选择。默认简体中文。',
  'language.current': '当前语言',
  'language.changed': '界面语言已切换为{name}',
  'language.persistedNote': '该偏好保存在本机浏览器中，不会同步到服务器。',
  'language.followBrowser': '跟随浏览器',
} as const;
