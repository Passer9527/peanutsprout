/**
 * 简体中文（源语言）· auth 命名空间
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 覆盖登录页、全局登录态（401 失效 / 启动校验）与用户管理页的可见文案。
 * 通用按钮与字段名（取消、刷新、状态、操作等）复用 common.*，
 * 角色展示名复用 meta.role.*，这里只保留 auth 专属的说法。
 */
export default {
  // —— 登录页 · 品牌区 ——
  // 品牌名与标语复用 nav 命名空间的 app.*，这里只放登录页特有的亮点与落款
  'auth.login.highlight.drivers.title': '多数据库统一接入',
  'auth.login.highlight.drivers.detail': 'MySQL / PostgreSQL / SQLite 等驱动统一管理，连接配置集中维护。',
  'auth.login.highlight.sql.title': 'SQL 开发与结果导出',
  'auth.login.highlight.sql.detail': '对象树浏览、快捷执行、结果表格与 CSV / JSON / Markdown 导出。',
  'auth.login.highlight.audit.title': '审计与权限',
  'auth.login.highlight.audit.detail': '操作全量留痕、哈希链校验，账号与角色细粒度授权。',
  // 作者落款属于品牌信息，各语言保持原样即可
  'auth.login.footer': '飞哥 · 微信 6731663 · AGPL-3.0',

  // —— 登录页 · 表单 ——
  'auth.login.title': '登录管理控制台',
  'auth.login.subtitle': '使用花生苗服务端账号登录，登录态保存在本机浏览器。',
  'auth.login.usernamePlaceholder': '请输入用户名',
  'auth.login.passwordPlaceholder': '请输入密码',
  'auth.login.showPassword': '显示密码',
  'auth.login.hidePassword': '隐藏密码',
  'auth.login.submit': '登录',
  'auth.login.submitting': '正在登录…',
  'auth.login.hint': '首次部署请使用服务端初始化时生成的管理员账号登录；忘记密码可在服务端执行重置脚本。',

  // —— 通用字段名（登录页与用户管理页共用）——
  'auth.field.username': '用户名',
  'auth.field.password': '密码',
  'auth.field.email': '邮箱',
  'auth.field.roles': '角色',

  // —— 表单校验 ——
  'auth.validation.usernameRequired': '请输入用户名。',
  'auth.validation.passwordRequired': '请输入密码。',
  'auth.validation.passwordMinLength': '初始密码长度至少 6 位。',
  'auth.validation.passwordResetMinLength': '重置密码长度至少 6 位，留空表示不修改。',

  // —— 登录态 ——
  'auth.forcePassword.title': '请先修改初始密码',
  'auth.forcePassword.subtitle': '当前仍在使用安装时内置的默认密码，为保障数据安全，必须先修改后才能使用其他功能。',
  'auth.forcePassword.warning': '在修改密码之前，服务端会拒绝除改密之外的所有请求。',
  'auth.forcePassword.submit': '修改并继续',
  'auth.forcePassword.submitting': '正在修改…',
  'auth.session.checkFailed': '登录状态校验失败：{message}',

  // —— 用户管理页 · 列表与工具栏 ——
  // 计数走 count 参数：中文只需无后缀键，其它语言可在本键下追加 .one / .few / .many 变体
  'auth.users.count': '共 {count} 个账号',
  'auth.users.empty': '暂无用户',
  'auth.users.emptyHint': '点击右上角「新建用户」创建第一个账号。',
  'auth.users.create': '新建用户',
  'auth.users.editAction': '编辑用户',
  'auth.users.deleteAction': '删除用户',
  'auth.users.cannotDeleteSelf': '不能删除当前登录账号',
  'auth.users.currentAccount': '当前账号',
  'auth.users.displayName': '显示名称',
  'auth.users.adminColumn': '管理员',
  'auth.users.lastLogin': '最近登录',

  // —— 用户管理页 · 表单 ——
  'auth.users.usernamePlaceholder': '登录账号',
  'auth.users.usernameImmutable': '用户名创建后不可修改',
  'auth.users.initialPassword': '初始密码',
  'auth.users.resetPassword': '重置密码',
  'auth.users.passwordMinPlaceholder': '至少 6 位',
  'auth.users.passwordKeepPlaceholder': '留空表示不修改',
  'auth.users.displayNamePlaceholder': '用于界面展示',
  'auth.users.rolesPlaceholder': '多个角色用逗号分隔，如 dba, developer',
  'auth.users.rolesHint': '角色决定可用的权限集合，具体权限由服务端 RBAC 配置决定。',
  'auth.users.grantAdmin': '授予管理员权限',
  'auth.users.grantAdminHint': '管理员可管理用户、查看全部连接，并拥有全部权限。',
  'auth.users.createSubmit': '创建用户',
  'auth.users.editTitle': '编辑用户：{name}',
  'auth.users.editDescription': '修改显示名称、角色或重置密码。',
  'auth.users.createDescription': '创建后用户即可使用该账号登录管理控制台。',
  'auth.users.deleteConfirm': '确定要删除用户「{name}」吗？该操作不可恢复，其历史审计记录仍会保留。',

  // —— 用户管理页 · 权限受限 ——
  'auth.users.adminOnlyTitle': '仅管理员可访问',
  'auth.users.adminOnlyHint': '当前账号没有用户与权限管理权限，请联系管理员在服务端授予 isAdmin 或相应角色。',

  // —— 用户管理页 · 提示与错误（{message} 为已本地化的错误说明）——
  'auth.users.loadFailed': '加载用户列表失败：{message}',
  'auth.users.createFailed': '创建用户失败：{message}',
  'auth.users.updateFailed': '更新用户失败：{message}',
  'auth.users.deleteFailed': '删除用户失败：{message}',
  'auth.users.created': '用户 {name} 已创建。',
  'auth.users.updated': '用户 {name} 已更新。',
  'auth.users.deleted': '用户 {name} 已删除。',
  'auth.validation.emailInvalid': '邮箱格式不正确',
} as const;
