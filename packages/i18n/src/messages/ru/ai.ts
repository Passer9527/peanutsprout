/**
 * Русский · AI-помощник (настройка провайдера / страница помощника)
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Источник ключей — пакет zh-CN; здесь только переводы, имена ключей не меняются.
 *
 * Терминология:
 *  · «провайдер» — поставщик услуг вроде OpenAI / Anthropic / Ollama;
 *  · «модель» — конкретная модель (modelName);
 *  · «сценарий» / «навык» — варианты использования nl2sql, explain и другие.
 * Общие кнопки (Отмена, Закрыть, Удалить) берутся из common и здесь не дублируются.
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— Отображаемые имена провайдеров ——
  'ai.provider.openai': 'OpenAI',
  'ai.provider.anthropic': 'Anthropic',
  'ai.provider.google': 'Google Gemini',
  'ai.provider.qwen': 'Qwen (Tongyi Qianwen)',
  'ai.provider.ernie': 'ERNIE (Wenxin Yiyan)',
  'ai.provider.zhipu': 'Zhipu AI',
  'ai.provider.deepseek': 'DeepSeek',
  'ai.provider.ollama': 'Ollama (локальный)',
  'ai.provider.openaiCompatible': 'Сервис, совместимый с OpenAI (vLLM / LM Studio / собственный)',

  // —— Настройки: карточка AI ——
  'ai.settings.title': 'AI-помощник',
  'ai.settings.subtitle':
    'Настройте провайдеров больших моделей. API Key шифруется по AES-256-GCM и сохраняется в локальной базе — в открытом виде на диск не попадает.',
  'ai.settings.master.label': 'Включить функции AI',
  'ai.settings.master.hint':
    'Главный переключатель. Когда он выключен, все сценарии AI сразу возвращают «Функции AI не включены» и не отправляют внешних запросов.',
  'ai.settings.redaction.label': 'Маскирование конфиденциальных данных',
  'ai.settings.redaction.hint':
    'Перед отправкой набора результатов модели столбцы с телефонами, документами, электронной почтой и банковскими картами автоматически заменяются маской.',
  'ai.settings.prodWrite.label': 'Разрешить AI генерировать запросы на запись для рабочей базы',
  'ai.settings.prodWrite.hint':
    'По умолчанию выключено. Даже если запрос сгенерирован, SQL выполнится только после вашего подтверждения в редакторе.',
  'ai.settings.serverWriteNote':
    'Эти переключатели хранятся на сервере и действуют для всех пользователей.',

  // —— Список конфигураций ——
  'ai.settings.list.title': 'Конфигурации моделей',
  'ai.settings.list.empty': 'Пока не настроено ни одной большой модели',
  'ai.settings.list.emptyHint':
    'Нажмите «Новая конфигурация», чтобы подключить облачный API, или укажите адрес локальной модели (например, Ollama) для работы офлайн.',
  'ai.settings.list.colName': 'Название',
  'ai.settings.list.colProvider': 'Провайдер',
  'ai.settings.list.colModel': 'Модель',
  'ai.settings.list.colBaseUrl': 'Адрес интерфейса',
  'ai.settings.list.colStatus': 'Статус',
  'ai.settings.badge.default': 'По умолчанию',
  'ai.settings.badge.enabled': 'Включено',
  'ai.settings.badge.disabled': 'Отключено',
  'ai.settings.badge.hasKey': 'Ключ задан',
  'ai.settings.badge.noKey': 'Без ключа',

  // —— Действия со списком ——
  'ai.settings.action.add': 'Новая конфигурация',
  'ai.settings.action.edit': 'Редактировать',
  'ai.settings.action.delete': 'Удалить',
  'ai.settings.action.setDefault': 'Сделать по умолчанию',
  'ai.settings.action.test': 'Проверить подключение',
  'ai.settings.action.openAssistant': 'Открыть AI-помощника',

  // —— Форма ——
  'ai.settings.form.createTitle': 'Новая конфигурация модели',
  'ai.settings.form.editTitle': 'Редактирование конфигурации модели',
  'ai.settings.field.name': 'Название конфигурации',
  'ai.settings.field.namePlaceholder': 'Например: локальный Ollama',
  'ai.settings.field.provider': 'Провайдер',
  'ai.settings.field.model': 'Название модели',
  'ai.settings.field.modelPlaceholder': 'Например: qwen2.5-coder:7b',
  'ai.settings.field.modelLoad': 'Загрузить с сервера',
  'ai.settings.field.modelLoading': 'Загрузка…',
  'ai.settings.field.modelLoaded': 'Загружено моделей: {count}; список уже заполнен',
  'ai.settings.field.modelEmpty': 'Сервер не вернул ни одной модели',
  'ai.settings.field.baseUrl': 'Адрес интерфейса (Base URL)',
  'ai.settings.field.baseUrlPlaceholder':
    'Если оставить пустым, используется адрес провайдера по умолчанию',
  'ai.settings.field.apiKey': 'API Key',
  'ai.settings.field.apiKeyPlaceholder': 'Для локальных моделей обычно оставляют пустым',
  'ai.settings.field.apiKeyKeep': 'Пустое поле — сохранённый ключ не изменяется',
  'ai.settings.field.apiKeyStored': 'Ключ сохранён; чтобы заменить его, введите новый',
  'ai.settings.field.temperature': 'Температура (0–2)',
  'ai.settings.field.maxTokens': 'Максимум выходных token',
  'ai.settings.field.maxTokensHint': 'Если оставить пустым, значение определяет сервер',
  'ai.settings.field.timeout': 'Тайм-аут (мс)',
  'ai.settings.field.isDefault': 'Сделать моделью по умолчанию',
  'ai.settings.field.enabled': 'Включить эту конфигурацию',
  'ai.settings.form.testHint':
    'Рекомендуется сначала нажать «Проверить подключение» и убедиться, что адрес и ключ верны, а затем сохранять.',
  'ai.settings.form.save': 'Сохранить конфигурацию',

  // —— Результат проверки ——
  'ai.settings.test.testing': 'Проверка…',
  'ai.settings.test.ok': 'Подключение работает, время: {ms} мс',
  'ai.settings.test.reply': 'Ответ модели: {reply}',
  'ai.settings.test.failed': 'Не удалось подключиться',

  // —— Подтверждение удаления ——
  'ai.settings.delete.title': 'Удаление конфигурации модели',
  'ai.settings.delete.body':
    'Удалить «{name}»? Действие необратимо, но оно не затрагивает уже накопленную историю вызовов.',

  // —— Уведомления ——
  'ai.settings.toast.created': 'Конфигурация модели создана',
  'ai.settings.toast.updated': 'Конфигурация модели обновлена',
  'ai.settings.toast.deleted': 'Конфигурация модели удалена',
  'ai.settings.toast.defaultSet': 'Модель по умолчанию задана',
  'ai.settings.toast.settingSaved': 'Настройки сохранены',
  'ai.settings.toast.autosaved': 'Настройки сохранены автоматически',

  // —— Ошибки ——
  'ai.settings.err.nameRequired': 'Укажите название конфигурации.',
  'ai.settings.err.modelRequired': 'Укажите название модели.',
  'ai.settings.err.providerRequired': 'Выберите провайдера.',
  'ai.settings.err.loadFailed': 'Не удалось загрузить конфигурации AI: {message}',
  'ai.settings.err.saveFailed': 'Не удалось сохранить: {message}',
  'ai.settings.err.deleteFailed': 'Не удалось удалить: {message}',
  'ai.settings.err.testFailed': 'Не удалось выполнить проверку: {message}',
  'ai.settings.err.modelsFailed': 'Не удалось загрузить список моделей: {message}',
  'ai.settings.err.defaultFailed': 'Не удалось назначить модель по умолчанию: {message}',

  // —— Страница AI-помощника ——
  'ai.assistant.title': 'AI-помощник',
  'ai.assistant.subtitle':
    'Работа с базой данных на естественном языке. AI только генерирует и никогда не выполняет запросы за вас.',
  'ai.assistant.sceneLabel': 'Навык',
  'ai.assistant.connectionLabel': 'Целевое подключение',
  'ai.assistant.connectionPlaceholder': 'Выберите подключение',
  'ai.assistant.connectionHint': 'Структура таблиц передаётся модели как контекст',
  'ai.assistant.rowsLabel': 'Данные результата',
  'ai.assistant.rowsPlaceholder': 'Вставьте результат: первая строка — заголовки, разделитель — табуляция или запятая',
  'ai.assistant.rowsHint': 'Конфиденциальные столбцы маскируются автоматически перед отправкой',
  'ai.assistant.inputPlaceholder': 'Например: 10 пользователей с наибольшей суммой заказов за 7 дней',
  'ai.assistant.sendHint': 'Ctrl / ⌘ + Enter — отправить',
  'ai.assistant.inputLabel': 'Ваш вопрос',
  'ai.assistant.sqlLabel': 'SQL для обработки',
  'ai.assistant.sqlPlaceholder': 'Вставьте SQL — AI объяснит его или предложит оптимизацию',
  'ai.assistant.errorLabel': 'Текст ошибки',
  'ai.assistant.errorPlaceholder':
    'Вставьте сообщение об ошибке, возвращённое базой данных',
  'ai.assistant.send': 'Отправить',
  'ai.assistant.sending': 'Генерация…',
  'ai.assistant.clear': 'Очистить диалог',
  'ai.assistant.emptyTitle': 'Начните диалог с AI',
  'ai.assistant.emptyHint':
    'Выберите слева навык, заполните поле ввода и нажмите «Отправить».',
  'ai.assistant.you': 'Вы',
  'ai.assistant.model': 'AI',
  'ai.assistant.copy': 'Копировать',
  'ai.assistant.copied': 'Скопировано в буфер обмена',
  'ai.assistant.copyFailed': 'Не удалось скопировать. Выделите текст вручную',
  'ai.assistant.useInEditor': 'Копировать SQL',
  'ai.assistant.noExecuteWarning': 'ИИ только создаёт SQL и никогда не выполняет его. Проверьте запрос и выберите «Выполнить» или «Копировать».',
  'ai.assistant.exportNeedTable': 'Укажите имя целевой таблицы',
  'ai.assistant.exportNeedConnection': 'Выберите целевое подключение',
  'ai.assistant.exportToDbDone': 'Записано строк: {count} в {table}',
  'ai.assistant.exportRun': 'Начать экспорт',
  'ai.assistant.exportReplaceWarning': 'Режим «Заменить» сначала удаляет целевую таблицу. Все существующие строки будут потеряны без возможности восстановления.',
  'ai.assistant.exportModeReplace': 'Заменить (сначала удалить таблицу)',
  'ai.assistant.exportModeAppend': 'Добавить в существующую таблицу',
  'ai.assistant.exportModeCreate': 'Создать таблицу (ошибка, если существует)',
  'ai.assistant.exportMode': 'Режим записи',
  'ai.assistant.exportTargetTablePlaceholder': 'например user_summary',
  'ai.assistant.exportTargetTable': 'Целевая таблица',
  'ai.assistant.exportTargetConnection': 'Целевое подключение',
  'ai.assistant.exportToDb': 'Экспорт в базу данных',
  'ai.assistant.exportTruncated': 'Результат превысил лимит строк; экспортирована только первая часть',
  'ai.assistant.exportFailed': 'Ошибка экспорта: {message}',
  'ai.assistant.exportDone': 'Экспортировано: {name}',
  'ai.assistant.exportExcel': 'Экспорт в Excel',
  'ai.assistant.clearDone': 'Очищено записей вызова: {count}',
  'ai.assistant.rollbackDone': 'Откат выполнен, удалено записей вызова: {count}',
  'ai.assistant.rollbackHint': 'Вернуться к этому шагу: последующие сообщения удаляются, ввод восстанавливается',
  'ai.assistant.rollbackHere': 'Откатиться сюда',
  'ai.assistant.withdrawFailed': 'Не удалось отозвать: {message}',
  'ai.assistant.withdrawDone': 'Отозвано',
  'ai.assistant.withdrawHint': 'Отозвать это сообщение (у сообщения пользователя отзывается и ответ)',
  'ai.assistant.withdraw': 'Отозвать',
  'ai.assistant.noConnection': 'Подключение не выбрано. Сначала выберите целевое подключение выше.',
  'ai.assistant.executeTruncated': 'Результат усечён',
  'ai.assistant.executeRows': 'Получено строк: {count}',
  'ai.assistant.executeAffected': 'Затронуто строк: {count}',
  'ai.assistant.executeFailed': 'Ошибка выполнения: {message}',
  'ai.assistant.executeConfirmYes': 'Да, выполнить',
  'ai.assistant.executeConfirm': 'Это запись данных. Продолжить?',
  'ai.assistant.copySql': 'Копировать SQL',
  'ai.assistant.executing': 'Выполняется…',
  'ai.assistant.execute': 'Выполнить',
  // —— Названия и описания навыков ——
  'ai.scene.nl2sql': 'Перевод с естественного языка в SQL',
  'ai.scene.nl2sqlHint':
    'Опишите задачу на естественном языке — будет создан выполняемый оператор SELECT',
  'ai.scene.explain': 'Объяснить SQL',
  'ai.scene.explainHint': 'Пошагово объясняет, что делает SQL-запрос',
  'ai.scene.optimize': 'Оптимизировать SQL',
  'ai.scene.optimizeHint':
    'Предлагает индексы, переписывание запроса и другие советы по производительности',
  'ai.scene.document': 'Создать документацию',
  'ai.scene.documentHint':
    'Формирует документацию по полям на основе структуры таблиц',
  'ai.scene.ask': 'Вопросы по набору результатов',
  'ai.scene.askHint':
    'Задавайте вопросы по текущим данным результата; перед отправкой они автоматически маскируются',
  'ai.scene.diagnose': 'Диагностика ошибок',
  'ai.scene.diagnoseHint': 'Анализирует причину ошибки и предлагает способы исправления',

  // —— Отображение результата генерации ——
  'ai.result.generatedSql': 'Сгенерированный SQL',
  'ai.result.explanation': 'Пояснение',
  'ai.result.confidence': 'Уверенность',
  'ai.result.tables': 'Задействованные таблицы',
  'ai.result.suggestions': 'Рекомендации по оптимизации',
  'ai.result.cause': 'Возможная причина',
  'ai.result.severity.critical': 'Критично',
  'ai.result.severity.warning': 'Предупреждение',
  'ai.result.severity.info': 'Информация',
  'ai.result.tokens': 'Вход {input} / выход {output} token',

  // —— Состояние недоступности ——
  'ai.disabled.title': 'Функции AI не включены',
  'ai.disabled.hint':
    'Откройте «Настройки → AI-помощник» и включите главный переключатель.',
  'ai.disabled.action': 'Перейти в настройки',
  'ai.notConfigured.title': 'Нет доступных моделей',
  'ai.notConfigured.hint':
    'В разделе «Настройки → AI-помощник» добавьте конфигурацию большой модели; подойдёт и локальная модель (Ollama).',
  'ai.notConfigured.action': 'Перейти к конфигурации',

  // —— История вызовов ——
  'ai.history.title': 'Последние вызовы',
  'ai.history.empty': 'Записей о вызовах пока нет',
  'ai.history.failed': 'Ошибка',
  'ai.history.success': 'Успешно',
};

export default messages;
