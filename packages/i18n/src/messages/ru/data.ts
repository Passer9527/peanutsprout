/**
 * Русский · Управление подключениями и разработка SQL
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Только то, что специфично для модулей «Управление подключениями» и
 * «Разработка SQL»: общие кнопки / статусы / заголовки столбцов / счётчики /
 * единицы времени берутся из common.*, а категории баз данных и состояние
 * драйверов — из meta (dbCategory.* / driver.*).
 *
 * Счётчики: базовый ключ служит формой «other», а русский добавляет к нему
 * формы `.one` / `.few` / `.many`, которые движок выбирает через Intl.PluralRules.
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— Управление подключениями: форма и заголовки ——
  'data.conn.createTitle': 'Новое подключение',
  'data.conn.createSubmit': 'Создать подключение',
  'data.conn.editAction': 'Редактировать подключение',
  'data.conn.editTitle': 'Редактирование подключения: {name}',
  'data.conn.modalDescription':
    'Параметры подключения хранятся на сервере; пароль шифруется и не отображается.',
  'data.conn.fieldName': 'Название подключения *',
  'data.conn.namePlaceholder': 'Например: рабочая база заказов',
  'data.conn.fieldDbType': 'Тип базы данных *',
  // Общий формат пункта списка типов баз данных (в китайском — полноширинные скобки; в русском обычные)
  'data.conn.dbTypeOption': '{label} ({category})',
  'data.conn.fieldHost': 'Хост',
  'data.conn.fieldPort': 'Порт',
  'data.conn.portPlaceholder': 'Порт по умолчанию',
  'data.conn.fieldDatabase': 'База данных / Schema',
  'data.conn.fieldUsername': 'Имя пользователя',
  'data.conn.fieldPassword': 'Пароль',
  'data.conn.passwordPlaceholderEdit': 'Оставьте пустым, чтобы не менять сохранённый пароль',
  'data.conn.passwordPlaceholderCreate': 'Необязательно; после сохранения пароль шифруется на сервере',
  'data.conn.passwordSaved': 'Для этого подключения пароль сохранён.',
  'data.conn.passwordNotSaved': 'Для этого подключения пароль ещё не сохранён.',
  'data.conn.passwordSavedNoEcho': 'Сохранён (не отображается)',
  'data.conn.notSaved': 'Не сохранён',
  'data.conn.passwordSavedTitle': 'Сохранённый пароль',
  'data.conn.fieldUrl': 'Строка подключения (необязательно)',
  'data.conn.urlPlaceholder':
    'Если указана, используется в первую очередь, например mysql://user:pass@host:3306/db',
  'data.conn.fieldExtraParams': 'Дополнительные параметры (JSON, необязательно)',
  'data.conn.extraParamsPlaceholder': 'Например: {"ssl": true, "charset": "utf8mb4"}',
  'data.conn.fieldColorTag': 'Цветовая метка',
  'data.conn.colorNone': 'Без метки',
  'data.conn.colorSwatchAria': 'Цветовая метка {color}',
  'data.conn.readonlyLabel': 'Подключение только для чтения',
  'data.conn.readonlyHint':
    'После включения сервер будет отклонять операции записи через это подключение.',
  'data.conn.favoriteLabel': 'Добавить в избранное',
  'data.conn.unfavoriteLabel': 'Убрать из избранного',
  'data.conn.favoritedTitle': 'В избранном',
  'data.conn.favoriteBadge': 'Избранное',
  'data.conn.favoriteHint': 'Избранные подключения показываются в списке первыми.',
  'data.conn.createNote':
    'Подсказка: проверить соединение в списке можно только после создания и сохранения подключения.',
  // meta.driver.* даёт только «реализован / не реализован»; здесь добавляется слово «Драйвер»
  'data.conn.driverNotImplemented': 'Драйвер: {status}',

  // —— Управление подключениями: проверка формы ——
  'data.conn.errorNameRequired': 'Введите название подключения.',
  'data.conn.errorDbTypeRequired': 'Выберите тип базы данных.',
  'data.conn.errorPortNumeric': 'Порт должен быть числом.',
  'data.conn.errorExtraParamsObject':
    'Дополнительные параметры должны быть объектом JSON, например {"ssl": true}.',
  'data.conn.errorExtraParamsInvalid':
    'Дополнительные параметры не являются корректным JSON. Проверьте формат.',

  // —— Управление подключениями: список и панель инструментов ——
  'data.conn.searchPlaceholder': 'Поиск по названию, хосту, базе данных',
  'data.conn.allTypes': 'Все типы',
  'data.conn.favoriteOnly': 'Только избранные',
  'data.conn.totalConnections': 'Всего подключений: {count}',
  'data.conn.totalConnections.one': 'Всего {count} подключение',
  'data.conn.totalConnections.few': 'Всего {count} подключения',
  'data.conn.totalConnections.many': 'Всего {count} подключений',
  'data.conn.colName': 'Название подключения',
  'data.conn.colAddress': 'Адрес',
  'data.conn.colLastUsed': 'Последнее использование',
  'data.conn.colConnectivity': 'Доступность',
  'data.conn.statusFailed': 'Ошибка',
  'data.conn.testing': 'Проверка…',
  'data.conn.notTested': 'Не проверено',
  'data.conn.testConnection': 'Проверить соединение',
  'data.conn.empty': 'Подключений к базам данных пока нет',
  'data.conn.emptyHint':
    'Нажмите «Новое подключение» в правом верхнем углу, чтобы добавить первый источник данных.',

  // —— Управление подключениями: панель сведений и подтверждение удаления ——
  'data.conn.editThis': 'Редактировать это подключение',
  'data.conn.deleteTitle': 'Удаление подключения',
  'data.conn.deleteConfirm':
    'Удалить подключение «{name}»? После удаления разработка SQL и ссылки в истории для этого подключения станут недоступны.',
  'data.conn.sessionTest': 'Проверка в текущем сеансе',
  'data.conn.detailHint':
    'Пароль подключения шифруется и хранится на сервере; чтобы сменить пароль, укажите новый в окне редактирования и сохраните.',

  // —— Управление подключениями: результат операций ({message} — локализованный текст ошибки) ——
  'data.conn.loadListFailed': 'Не удалось загрузить список подключений: {message}',
  'data.conn.loadDbTypesFailed': 'Не удалось загрузить типы баз данных: {message}',
  'data.conn.created': 'Подключение «{name}» создано.',
  'data.conn.createFailed': 'Не удалось создать подключение: {message}',
  'data.conn.updated': 'Подключение «{name}» обновлено.',
  'data.conn.updateFailed': 'Не удалось обновить подключение: {message}',
  'data.conn.testSuccess': '«{name}»: соединение установлено, {latency} мс{version}',
  'data.conn.testFailed': '«{name}»: не удалось подключиться: {message}',
  'data.conn.testRequestFailed': 'Не удалось проверить соединение: {message}',
  'data.conn.favoriteFailed': 'Не удалось обновить состояние избранного: {message}',
  'data.conn.deleted': 'Подключение «{name}» удалено.',
  'data.conn.deleteFailed': 'Не удалось удалить подключение: {message}',
  'data.conn.detailTestSuccess': 'Соединение установлено: {latency} мс{version}',
  'data.conn.detailTestFailed': 'Не удалось подключиться: {message}',

  // —— Названия брендов типов баз данных (по стабильному code; неизвестный тип берёт label сервера) ——
  'data.dbType.mysql': 'MySQL',
  'data.dbType.mariadb': 'MariaDB',
  'data.dbType.postgresql': 'PostgreSQL',
  'data.dbType.oracle': 'Oracle',
  'data.dbType.sqlserver': 'SQL Server',
  'data.dbType.sqlite': 'SQLite',
  'data.dbType.kingbase': 'KingbaseES',
  'data.dbType.dm': 'Dameng DM',
  'data.dbType.oceanbase': 'OceanBase',
  'data.dbType.tidb': 'TiDB',
  'data.dbType.redis': 'Redis',
  'data.dbType.mongodb': 'MongoDB',
  'data.dbType.clickhouse': 'ClickHouse',
  'data.dbType.influxdb': 'InfluxDB',
  'data.dbType.neo4j': 'Neo4j',

  // —— Разработка SQL: дерево объектов ——
  'data.sql.treeTitle': 'Подключения и объекты',
  'data.sql.connectionLabel': 'Подключение к базе данных',
  'data.sql.selectConnection': 'Выберите подключение',
  // Общий формат пункта списка подключений (в китайском — полноширинные скобки; в русском обычные)
  'data.sql.connectionOption': '{name} ({type})',
  'data.sql.treeSelectConnection':
    'Сначала выберите подключение к базе данных; затем можно просмотреть схемы и таблицы этого подключения.',
  'data.sql.loadingSchemas': 'Загрузка схем…',
  'data.sql.noSchemas':
    'Схемы не получены. Проверьте права учётной записи или параметры подключения.',
  'data.sql.loadingTables': 'Загрузка таблиц…',
  'data.sql.noTables': 'В этой схеме нет таблиц.',
  'data.sql.loadingColumns': 'Загрузка столбцов…',
  'data.sql.noColumns': 'Сведения о столбцах не получены.',
  'data.sql.insertQuery': 'Вставить запрос',
  'data.sql.loadSchemasFailed': 'Не удалось загрузить схемы: {message}',
  'data.sql.loadTablesFailed': 'Не удалось загрузить таблицы: {message}',
  'data.sql.loadColumnsFailed': 'Не удалось загрузить столбцы: {message}',

  // —— Разработка SQL: история выполнения ——
  'data.sql.historyTitle': 'История выполнения',
  'data.sql.refreshHistory': 'Обновить историю выполнения',
  'data.sql.noHistory': 'Записей о выполнении пока нет.',
  'data.sql.slowQuery': 'Медленный запрос',
  'data.sql.loadHistoryFailed': 'Не удалось загрузить историю выполнения: {message}',

  // —— Разработка SQL: редактор и область результатов ——
  'data.sql.loadConnectionsFailed': 'Не удалось загрузить список подключений: {message}',
  'data.sql.selectConnectionFirst': 'Сначала выберите подключение к базе данных.',
  'data.sql.enterSqlToRun': 'Введите SQL-запрос для выполнения.',
  'data.sql.enterSqlToExplain': 'Введите SQL-запрос для анализа.',
  'data.sql.executed': 'Выполнено: {rows} · затронуто {affected} · {duration}{suffix}',
  'data.sql.execFailed': 'Не удалось выполнить: {message}',
  'data.sql.explainFailed': 'Не удалось получить план выполнения: {message}',
  'data.sql.editorTitle': 'Редактор SQL',
  'data.sql.run': 'Выполнить',
  'data.sql.explain': 'План выполнения',
  'data.sql.copySql': 'Копировать SQL',
  'data.sql.clearEditor': 'Очистить редактор',
  'data.sql.showHistory': 'Показать историю выполнения',
  'data.sql.hideHistory': 'Скрыть историю выполнения',
  'data.sql.readonlyBanner':
    'Текущее подключение работает в режиме только для чтения; операции записи (INSERT / UPDATE / DELETE / DDL) будут отклонены сервером.',
  'data.sql.editorPlaceholder': 'Введите SQL; Ctrl / Cmd + Enter — выполнить',
  'data.sql.maxRows': 'Максимум возвращаемых строк',
  'data.sql.serverDefault': 'По умолчанию на сервере',
  'data.sql.timeoutMs': 'Тайм-аут (мс)',
  'data.sql.shortcutHint':
    'Горячая клавиша: Ctrl / Cmd + Enter — выполнить SQL из текущего редактора',
  'data.sql.tabResult': 'Результат',
  'data.sql.tabMessage': 'Сообщения',
  'data.sql.returnedRows': 'Возвращено строк: {count}',
  'data.sql.returnedRows.one': 'Возвращена {count} строка',
  'data.sql.returnedRows.few': 'Возвращено {count} строки',
  'data.sql.returnedRows.many': 'Возвращено {count} строк',
  'data.sql.affectedRows': 'Затронуто строк: {count}',
  'data.sql.affectedRows.one': 'Затронута {count} строка',
  'data.sql.affectedRows.few': 'Затронуто {count} строки',
  'data.sql.affectedRows.many': 'Затронуто {count} строк',
  'data.sql.elapsed': 'Затрачено {duration}',
  'data.sql.successTitle': 'Запрос выполнен успешно',
  'data.sql.successNoResult':
    'Запрос не вернул результирующий набор; затронуто строк: {count}.',
  'data.sql.successNoResult.one': 'Запрос не вернул результирующий набор; затронута {count} строка.',
  'data.sql.successNoResult.few': 'Запрос не вернул результирующий набор; затронуто {count} строки.',
  'data.sql.successNoResult.many': 'Запрос не вернул результирующий набор; затронуто {count} строк.',
  'data.sql.emptyResult': 'Результирующий набор пуст',
  'data.sql.emptyResultHint': 'Запрос выполнен успешно, но подходящих данных не найдено.',
  'data.sql.notExecutedTitle': 'SQL ещё не выполнен',
  'data.sql.notExecutedHint':
    'Выберите подключение, введите запрос и нажмите Ctrl / Cmd + Enter или «Выполнить», чтобы увидеть результат.',
  'data.sql.noPlanTitle': 'Плана выполнения пока нет',
  'data.sql.noPlanHint':
    'Нажмите «План выполнения», и сервер вернёт текстовый план для этого запроса.',
  'data.sql.noMessages': 'В текущем сеансе сообщений об ошибках нет.',
  'data.sql.lastSuccess': 'Последнее успешное выполнение: {count} строк, затрачено {duration}.',
  'data.sql.lastSuccess.one': 'Последнее успешное выполнение: {count} строка, затрачено {duration}.',
  'data.sql.lastSuccess.few': 'Последнее успешное выполнение: {count} строки, затрачено {duration}.',
  'data.sql.lastSuccess.many': 'Последнее успешное выполнение: {count} строк, затрачено {duration}.',

  // —— Разработка SQL: экспорт и копирование ——
  // Формат скобок при усечении результата (текст берётся из common.truncated)
  'data.sql.truncatedSuffix': ' ({text})',
  'data.sql.noExportData': 'Нет результирующего набора для экспорта.',
  'data.sql.exported': 'Файл {format} экспортирован.',
  'data.sql.emptyEditor': 'Редактор пуст.',
  'data.sql.copied': 'SQL скопирован в буфер обмена.',
  'data.sql.copyFailed': 'Браузер запретил доступ к буферу обмена; скопируйте вручную.',

  // —— Таблица результатов ——
  // Отображение ячейки NULL: всегда (NULL), техническое написание, одинаковое во всех языках.
  'data.grid.nullCell': '(NULL)',
  'data.conn.errorExtraParamsValue': 'Значения дополнительных параметров должны быть строками: {key}',
};

export default messages;
