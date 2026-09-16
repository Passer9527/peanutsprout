/**
 * Русский · Оболочка приложения и навигация
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— Идентификация продукта ——
  'app.name': 'PeanutSprout',
  'app.fullName': 'PeanutSprout — менеджер баз данных',
  'app.tagline': 'Единый клиент для управления базами данных',
  'app.copyright': 'AGPL-3.0 · 飞哥',
  'app.documentTitle': 'PeanutSprout · Единый клиент управления базами данных',
  'app.documentDescription': 'PeanutSprout — веб-интерфейс единого клиента управления базами данных',

  // —— Боковая навигация ——
  'nav.ariaLabel': 'Основная навигация',
  'nav.toggleSidebar': 'Свернуть/развернуть навигацию',
  'nav.collapseSidebar': 'Свернуть боковую панель',
  'nav.expandSidebar': 'Развернуть боковую панель',
  'nav.collapseText': 'Свернуть навигацию',
  'nav.asideDefaultTitle': 'Вспомогательная панель',
  'nav.expandAside': 'Развернуть правую панель',
  'nav.collapseAside': 'Свернуть правую панель',

  // —— Заголовки и описания разделов (для заголовков страниц и подсказок в навигации) ——
  'nav.connections.label': 'Управление подключениями',
  'nav.connections.description': 'Подключения к базам данных, проверка соединения и политики только для чтения',
  'nav.sql.label': 'Разработка SQL',
  'nav.sql.description': 'Дерево объектов, выполнение SQL, экспорт результатов и история выполнения',
  'nav.charts.label': 'Визуализация данных',
  'nav.charts.description': 'Создание линейчатых, линейных и других диаграмм с просмотром выборки в реальном времени',
  'nav.dashboards.label': 'Дашборды',
  'nav.dashboards.description': 'Объединение нескольких диаграмм в один дашборд с общим доступом и сеточной раскладкой',
  'nav.audit.label': 'Журнал аудита',
  'nav.audit.description': 'Аудит операций и проверка целостности цепочки хешей',
  'nav.users.label': 'Пользователи и права',
  'nav.users.description': 'Управление учётными записями, ролями и правами администратора',
  'nav.settings.label': 'Настройки',
  'nav.settings.description': 'Тема оформления, адрес сервера, смена пароля и сведения о программе',
  'nav.ai.label': 'AI-помощник',
  'nav.ai.description': 'Перевод с естественного языка в SQL, объяснение и оптимизация, документация, вопросы по результатам',
  'nav.table.label': 'Данные таблиц',
  'nav.table.description': 'Выберите таблицу и правьте записи как в электронной таблице',
  'nav.designer.label': 'Конструктор схем',
  'nav.designer.description': 'Визуальное проектирование схем и таблиц с предпросмотром DDL',

  // —— Верхняя панель ——
  'topbar.switchToLight': 'Переключить на светлую тему',
  'topbar.switchToDark': 'Переключить на тёмную тему',
  'topbar.language': 'Язык',
  'topbar.switchLanguage': 'Сменить язык интерфейса',
  'topbar.adminSuffix': ' · Администратор',
  'topbar.logout': 'Выйти',
  'topbar.logoutConfirm': 'Выйти из системы?',
  'topbar.logoutConfirmHint': 'После выхода потребуется снова ввести имя пользователя и пароль.',

  // —— Подсказки оболочки приложения ——
  'app.checkingSession': 'Проверка состояния входа…',
  'app.forbiddenTitle': 'Доступ запрещён',
  'app.forbiddenHint': 'Управление пользователями и правами доступно только администраторам.',
  'app.asideConnectionTitle': 'Сведения о подключении',
  'app.asideConnectionEmpty': 'Выберите подключение в списке слева',
  'app.asideConnectionEmptyHint': 'Можно просмотреть сведения о подключении, цветовую метку и политику только для чтения, а также отдельно проверить соединение.',

  // —— Языковые настройки ——
  'language.title': 'Язык интерфейса',
  'language.description': 'Изменения вступают в силу сразу и запоминаются. По умолчанию — упрощённый китайский.',
  'language.current': 'Текущий язык',
  'language.changed': 'Язык интерфейса изменён на {name}',
  'language.persistedNote': 'Этот параметр сохраняется в локальном браузере и не синхронизируется с сервером.',
  'language.followBrowser': 'Как в браузере',
};

export default messages;
