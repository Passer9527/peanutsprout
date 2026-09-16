/**
 * Русский · Аутентификация и пользователи
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Обложка страницы входа, глобальное состояние входа (истёкший 401 / проверка
 * при запуске) и страница управления пользователями.
 * Общие кнопки и поля (Отмена, Обновить, Статус, Действия и т. д.) берутся из
 * common.*, отображаемые имена ролей — из meta.role.*; здесь только то, что
 * специфично для аутентификации.
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— Страница входа · брендовая колонка ——
  // Название продукта и слоган берутся из nav (app.*); здесь только то, что
  // относится именно к странице входа, и подпись автора
  'auth.login.highlight.drivers.title': 'Единый доступ к разным базам данных',
  'auth.login.highlight.drivers.detail':
    'Единое управление драйверами MySQL / PostgreSQL / SQLite и других; параметры подключений хранятся в одном месте.',
  'auth.login.highlight.sql.title': 'Разработка SQL и экспорт результатов',
  'auth.login.highlight.sql.detail':
    'Просмотр дерева объектов, быстрый запуск, таблица результатов и экспорт в CSV / JSON / Markdown.',
  'auth.login.highlight.audit.title': 'Аудит и права доступа',
  'auth.login.highlight.audit.detail':
    'Полный журнал операций, проверка цепочки хешей, точное разграничение прав по учётным записям и ролям.',
  'auth.login.footer': '飞哥 · 微信 6731663 · AGPL-3.0',

  // —— Страница входа · форма ——
  'auth.login.title': 'Вход в консоль управления',
  'auth.login.subtitle':
    'Войдите под учётной записью сервера PeanutSprout; сеанс сохраняется в локальном браузере.',
  'auth.login.usernamePlaceholder': 'Введите имя пользователя',
  'auth.login.passwordPlaceholder': 'Введите пароль',
  'auth.login.showPassword': 'Показать пароль',
  'auth.login.hidePassword': 'Скрыть пароль',
  'auth.login.submit': 'Войти',
  'auth.login.submitting': 'Вход…',
  'auth.login.hint':
    'При первом развёртывании войдите под учётной записью администратора, созданной при инициализации сервера; если пароль забыт, запустите на сервере скрипт сброса.',

  // —— Общие имена полей (страница входа и управление пользователями) ——
  'auth.field.username': 'Имя пользователя',
  'auth.field.password': 'Пароль',
  'auth.field.email': 'Эл. почта',
  'auth.field.roles': 'Роли',

  // —— Проверка формы ——
  'auth.validation.usernameRequired': 'Введите имя пользователя.',
  'auth.validation.passwordRequired': 'Введите пароль.',
  'auth.validation.passwordMinLength': 'Начальный пароль должен содержать не менее 6 символов.',
  'auth.validation.passwordResetMinLength':
    'Новый пароль должен содержать не менее 6 символов; оставьте поле пустым, чтобы не менять пароль.',

  // —— Состояние входа ——
  'auth.forcePassword.title': 'Сначала смените начальный пароль',
  'auth.forcePassword.subtitle': 'Вы всё ещё используете пароль по умолчанию, созданный при установке. Для безопасности данных его нужно сменить, прежде чем пользоваться остальным.',
  'auth.forcePassword.warning': 'До смены пароля сервер отклоняет все запросы, кроме смены пароля и выхода.',
  'auth.forcePassword.submit': 'Сменить и продолжить',
  'auth.forcePassword.submitting': 'Смена…',
  'auth.session.checkFailed': 'Не удалось проверить состояние входа: {message}',

  // —— Управление пользователями · список и панель инструментов ——
  // Счётчик передаётся как параметр count: русскому нужны варианты .one / .few / .many
  'auth.users.count': 'Всего учётных записей: {count}',
  'auth.users.count.one': 'Всего {count} учётная запись',
  'auth.users.count.few': 'Всего {count} учётные записи',
  'auth.users.count.many': 'Всего {count} учётных записей',
  'auth.users.empty': 'Пользователей пока нет',
  'auth.users.emptyHint':
    'Нажмите «Создать пользователя» в правом верхнем углу, чтобы создать первую учётную запись.',
  'auth.users.create': 'Создать пользователя',
  'auth.users.editAction': 'Редактировать пользователя',
  'auth.users.deleteAction': 'Удалить пользователя',
  'auth.users.cannotDeleteSelf': 'Нельзя удалить текущую учётную запись',
  'auth.users.currentAccount': 'Текущая учётная запись',
  'auth.users.displayName': 'Отображаемое имя',
  'auth.users.adminColumn': 'Администратор',
  'auth.users.lastLogin': 'Последний вход',

  // —— Управление пользователями · форма ——
  'auth.users.usernamePlaceholder': 'Учётная запись для входа',
  'auth.users.usernameImmutable': 'Имя пользователя нельзя изменить после создания',
  'auth.users.initialPassword': 'Начальный пароль',
  'auth.users.resetPassword': 'Сбросить пароль',
  'auth.users.passwordMinPlaceholder': 'Не менее 6 символов',
  'auth.users.passwordKeepPlaceholder': 'Оставьте пустым, чтобы не менять',
  'auth.users.displayNamePlaceholder': 'Отображается в интерфейсе',
  'auth.users.rolesPlaceholder': 'Несколько ролей через запятую, например dba, developer',
  'auth.users.rolesHint':
    'Роль определяет набор доступных прав; конкретные права задаются конфигурацией RBAC на сервере.',
  'auth.users.grantAdmin': 'Предоставить права администратора',
  'auth.users.grantAdminHint':
    'Администратор может управлять пользователями, видеть все подключения и обладает всеми правами.',
  'auth.users.createSubmit': 'Создать пользователя',
  'auth.users.editTitle': 'Редактирование пользователя: {name}',
  'auth.users.editDescription': 'Измените отображаемое имя, роли или сбросьте пароль.',
  'auth.users.createDescription':
    'После создания пользователь сможет войти в консоль управления под этой учётной записью.',
  'auth.users.deleteConfirm':
    'Удалить пользователя «{name}»? Действие необратимо; записи в журнале аудита за этим пользователем сохранятся.',

  // —— Управление пользователями · доступ ограничен ——
  'auth.users.adminOnlyTitle': 'Доступно только администраторам',
  'auth.users.adminOnlyHint':
    'У текущей учётной записи нет прав на управление пользователями и правами. Обратитесь к администратору, чтобы на сервере выдать isAdmin или соответствующую роль.',

  // —— Управление пользователями · подсказки и ошибки ({message} — локализованное описание ошибки) ——
  'auth.users.loadFailed': 'Не удалось загрузить список пользователей: {message}',
  'auth.users.createFailed': 'Не удалось создать пользователя: {message}',
  'auth.users.updateFailed': 'Не удалось обновить пользователя: {message}',
  'auth.users.deleteFailed': 'Не удалось удалить пользователя: {message}',
  'auth.users.created': 'Пользователь {name} создан.',
  'auth.users.updated': 'Пользователь {name} обновлён.',
  'auth.users.deleted': 'Пользователь {name} удалён.',
  'auth.validation.emailInvalid': 'Неверный формат адреса электронной почты',
};

export default messages;
