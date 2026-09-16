/**
 * Русский · Отображаемые имена серверных перечислений
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Сервер возвращает в ответе китайский `label`. Клиент **не показывает серверный
 * `label` напрямую**, а берёт отображаемое имя текущего языка из этой таблицы по
 * стабильному `code`/`type` — иначе после смены языка типы баз данных и элементы
 * прав остались бы на китайском и интерфейс получился бы смешанным.
 * Только если подходящий code не найден, используется `label` от сервера
 * (например, для пользовательских ролей).
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— Категории баз данных ——
  'dbCategory.relational': 'Реляционные',
  'dbCategory.keyvalue': 'Ключ-значение',
  'dbCategory.document': 'Документные',
  'dbCategory.columnar': 'Колоночные',
  'dbCategory.timeseries': 'Временные ряды',
  'dbCategory.graph': 'Графовые',

  // —— Состояние реализации драйверов ——
  'driver.implemented': 'Реализован',
  'driver.notImplemented': 'Не реализован',
  'driver.notImplementedHint': 'Драйвер для этого типа ещё не реализован; при подключении будет явно возвращена ошибка DRIVER_NOT_IMPLEMENTED',
  'driver.list': 'Поддерживаемые типы баз данных',

  // —— Типы диаграмм ——
  'chartType.bar': 'Линейчатая диаграмма',
  'chartType.column': 'Столбчатая диаграмма',
  'chartType.line': 'Линейная диаграмма',
  'chartType.area': 'Диаграмма с областями',
  'chartType.pie': 'Круговая диаграмма',
  'chartType.donut': 'Кольцевая диаграмма',
  'chartType.scatter': 'Диаграмма рассеяния',
  'chartType.bubble': 'Пузырьковая диаграмма',
  'chartType.parallel': 'Диаграмма параллельных координат',
  'chartType.heatmap': 'Тепловая карта',
  'chartType.radar': 'Лепестковая диаграмма',
  'chartType.sankey': 'Диаграмма Санкей',
  'chartType.treemap': 'Древовидная карта',
  'chartType.boxplot': 'Ящичная диаграмма',
  'chartType.map': 'Карта',

  'chartTypeDesc.bar': 'Сравнение категорий по горизонтали',
  'chartTypeDesc.column': 'Сравнение категорий по вертикали',
  'chartTypeDesc.line': 'Динамика изменений',
  'chartTypeDesc.area': 'Накопительная динамика',
  'chartTypeDesc.pie': 'Состав долей',
  'chartTypeDesc.donut': 'Состав долей (с полым центром)',
  'chartTypeDesc.scatter': 'Корреляция двух переменных',
  'chartTypeDesc.bubble': 'Связь трёх переменных',
  'chartTypeDesc.parallel': 'Сравнение многомерных признаков',
  'chartTypeDesc.heatmap': 'Двумерное распределение плотности',
  'chartTypeDesc.radar': 'Комплексное сравнение показателей',
  'chartTypeDesc.sankey': 'Потоки и распределение объёма',
  'chartTypeDesc.treemap': 'Доли по иерархии',
  'chartTypeDesc.boxplot': 'Распределение и выбросы',
  'chartTypeDesc.map': 'Географическое распределение',

  // —— Элементы прав ——
  'permission.conn.read': 'Просмотр подключений',
  'permission.conn.write': 'Управление подключениями',
  'permission.query.read': 'Выполнение запросов',
  'permission.query.write': 'Выполнение операций записи',
  'permission.migrate.read': 'Просмотр миграций',
  'permission.migrate.write': 'Выполнение миграций',
  'permission.ai.use': 'Использование AI',
  'permission.user.manage': 'Управление пользователями',
  'permission.audit.read': 'Просмотр аудита',
  'permission.settings.manage': 'Системные настройки',

  // —— Категории прав ——
  'permissionCategory.connection': 'Подключения',
  'permissionCategory.query': 'Запросы',
  'permissionCategory.migration': 'Миграции',
  'permissionCategory.ai': 'AI',
  'permissionCategory.user': 'Пользователи',
  'permissionCategory.audit': 'Аудит',
  'permissionCategory.settings': 'Настройки',

  // —— Действия аудита ——
  'auditAction.login': 'Вход',
  'auditAction.logout': 'Выход',
  'auditAction.login_failed': 'Неудачный вход',
  'auditAction.connect': 'Установка подключения',
  'auditAction.disconnect': 'Разрыв подключения',
  'auditAction.execute': 'Выполнение SQL',
  'auditAction.migrate': 'Выполнение миграции',
  'auditAction.import': 'Импорт данных',
  'auditAction.export': 'Экспорт данных',
  'auditAction.ai': 'Вызов AI',
  'auditAction.user_create': 'Создание пользователя',
  'auditAction.user_update': 'Изменение пользователя',
  'auditAction.user_delete': 'Удаление пользователя',
  'auditAction.connection_create': 'Создание подключения',
  'auditAction.connection_update': 'Изменение подключения',
  'auditAction.connection_delete': 'Удаление подключения',
  'auditAction.settings_update': 'Изменение настроек',
  'auditAction.audit_verify': 'Проверка цепочки аудита',

  // —— Результаты аудита ——
  'auditResult.success': 'Успешно',
  'auditResult.failure': 'Ошибка',
  'auditResult.denied': 'Отклонено',

  // —— Роли ——
  'role.admin': 'Администратор',
  'role.developer': 'Разработчик',
  'role.analyst': 'Аналитик',
  'role.auditor': 'Аудитор',
  'role.viewer': 'Пользователь только для чтения',
  'role.custom': 'Пользовательская роль',

  // —— Состояние подключения ——
  'connStatus.ok': 'В норме',
  'connStatus.failed': 'Ошибка подключения',
  'connStatus.untested': 'Не проверено',
  'connStatus.testing': 'Проверка',
  'connStatus.readonly': 'Только для чтения',

  // —— Категории поставщиков AI ——
  'aiProvider.openai-compatible': 'Совместимый с OpenAI',
  'aiProvider.anthropic': 'Anthropic',
  'aiProvider.gemini': 'Google Gemini',
  'aiProvider.azure-openai': 'Azure OpenAI',
  'aiProvider.deepseek': 'DeepSeek',
  'aiProvider.qwen': 'Qwen',
  'aiProvider.zhipu': 'Zhipu AI',
  'aiProvider.moonshot': 'Moonshot AI',
  'aiProvider.ollama': 'Ollama (локально)',

  // —— Стратегии конфликтов при миграции ——
  'conflictStrategy.skip': 'Пропускать существующие',
  'conflictStrategy.overwrite': 'Перезаписывать',
  'conflictStrategy.fail': 'Останавливаться при конфликте',
  'conflictStrategy.append': 'Добавлять',
};

export default messages;
