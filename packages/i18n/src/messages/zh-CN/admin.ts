/**
 * 简体中文（源语言）· admin 命名空间（审计日志 / 设置）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 审计动作 / 审计结果 / 权限 / 角色的展示名统一放在 meta 命名空间，这里只放
 * 审计日志与设置页面**特有的措辞**：筛选工具栏、表头、空态、分页、详情弹窗、
 * 外观主题、服务与接口、修改密码、关于、语言卡片等。
 * 通用按钮（重置）、状态（状态）、占位（—）、未知等一律复用 common / nav。
 */
export default {
  // —— 审计日志：筛选工具栏 ——
  'admin.audit.action': '动作',
  'admin.audit.actionPlaceholder': '如 login / query.execute',
  'admin.audit.filterUserId': '用户 ID',
  'admin.audit.pageSize': '每页',
  'admin.audit.pageSizeOption': '{count} 条',
  'admin.audit.query': '查询',
  'admin.audit.verifyChain': '校验哈希链',

  // —— 审计日志：表格列 ——
  'admin.audit.column.time': '时间',
  'admin.audit.column.user': '用户',
  'admin.audit.column.resource': '资源',
  'admin.audit.column.connection': '连接',
  'admin.audit.column.sqlDetail': 'SQL / 详情',
  'admin.audit.column.ip': '来源 IP',
  'admin.audit.column.hash': '哈希',
  'admin.audit.anonymous': '匿名',
  'admin.audit.viewDetail': '查看详情',
  'admin.audit.noHash': '无哈希',
  'admin.audit.noExtraInfo': '无附加信息',

  // —— 审计日志：操作反馈（{message} 为本地化后的错误原文，{position} 为断链位置）——
  'admin.audit.loadFailed': '加载审计日志失败：{message}',
  'admin.audit.verifyOk': '哈希链校验通过，共校验 {count} 条日志。',
  'admin.audit.verifyFailed': '哈希链校验失败：{message}',
  'admin.audit.verifyBroken': '哈希链校验失败，首个断链位置：{position}',
  'admin.audit.bannerOk': '哈希链校验通过：共校验 {count} 条日志，未发现篡改。',
  'admin.audit.bannerBroken': '哈希链校验未通过：共校验 {count} 条日志，首个断链位置 {position}。',

  // —— 审计日志：空态与分页 ——
  'admin.audit.empty': '没有符合条件的审计日志',
  'admin.audit.emptyHint': '调整筛选条件后重试，或确认服务端审计功能已启用。',
  'admin.audit.pager': '共 {total} 条 · 第 {page} / {totalPages} 页',
  'admin.audit.prevPage': '上一页',
  'admin.audit.nextPage': '下一页',

  // —— 审计日志：详情弹窗 ——
  'admin.audit.detailTitle': '审计详情',
  'admin.audit.errorMessage': '错误信息',
  'admin.audit.currentHash': '当前哈希',

  // —— 设置：外观主题 ——
  'admin.settings.appearance.title': '外观主题',
  'admin.settings.appearance.subtitle': '主题偏好保存在本机浏览器，切换即时生效。',
  'admin.settings.theme.light': '浅色',
  'admin.settings.theme.lightHint': '明亮环境下的默认外观',
  'admin.settings.theme.dark': '深色',
  'admin.settings.theme.darkHint': '暗光环境更护眼',

  // —— 设置：服务与接口 ——
  'admin.settings.service.title': '服务与接口',
  'admin.settings.service.subtitle': 'Web 端通过 {base} 访问花生苗服务端 REST 接口。',
  'admin.settings.service.apiBase': 'API 基址',
  'admin.settings.service.pageOrigin': '当前页面地址',
  'admin.settings.service.authMethod': '认证方式',
  'admin.settings.service.status': '服务状态',
  'admin.settings.service.checking': '检测中…',
  'admin.settings.service.statusLine': '{status} · v{version} · 运行 {uptime}',
  'admin.settings.service.unavailable': '无法获取服务状态',
  'admin.settings.service.recheck': '重新检测',
  'admin.settings.service.ok': '服务正常：版本 {version}',

  // —— 设置：修改密码 ——
  'admin.settings.password.title': '修改密码',
  'admin.settings.password.currentAccount': '当前账号：',
  'admin.settings.password.current': '当前密码',
  'admin.settings.password.new': '新密码',
  'admin.settings.password.confirm': '确认新密码',
  'admin.settings.password.newHint': '至少 6 位字符',
  'admin.settings.password.submit': '更新密码',
  'admin.settings.password.errCurrentRequired': '请输入当前密码。',
  'admin.settings.password.errTooShort': '新密码长度至少 6 位。',
  'admin.settings.password.errSameAsCurrent': '新密码不能与当前密码相同。',
  'admin.settings.password.errMismatch': '两次输入的新密码不一致。',
  'admin.settings.password.success': '密码已更新，下次登录请使用新密码。',

  // —— 设置：关于 ——
  'admin.settings.about.title': '关于花生苗',
  'admin.settings.about.subtitle': '跨平台数据库统一管理客户端',
  'admin.settings.about.productName': '产品名称',
  'admin.settings.about.productValue': '花生苗（PeanutSprout）',
  'admin.settings.about.versionValue': '0.1.0',
  'admin.settings.about.author': '作者',
  'admin.settings.about.authorValue': '飞哥 · 微信 6731663',
  'admin.settings.about.license': '开源许可',
  'admin.settings.about.licenseValue': 'AGPL-3.0-or-later',
  'admin.settings.about.stack': 'Web 技术栈',
  'admin.settings.about.stackValue': 'React 19 · TypeScript 5.9 · Vite 7（无第三方 UI / 状态 / 路由 / 图表库）',

  // —— 提示条（toast）——
  'admin.toast.close': '关闭提示',
} as const;
