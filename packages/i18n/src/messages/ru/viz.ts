/**
 * Русский · Диаграммы и дашборды
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Только то, что специфично для диаграмм и дашбордов:
 *  - пустые состояния диаграмм, пояснения для неподдерживаемых типов, статистика
 *    пропусков, таблица исходных данных;
 *  - формы, списки, подсказки и префиксы ошибок диаграмм и дашбордов.
 *
 * Отображаемые имена и описания типов диаграмм здесь отсутствуют: сервер
 * возвращает китайский label, но клиент берёт meta.chartType.* /
 * meta.chartTypeDesc.* по стабильному `type`. Только для неизвестного type
 * используется label сервера.
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— Пустые состояния диаграмм: чистая функция возвращает reason, тексты здесь ——
  'viz.empty.title': 'Нет данных для построения диаграммы',
  'viz.empty.noColumns':
    'Запрос не вернул ни одного столбца, построить диаграмму невозможно.',
  'viz.empty.noRows':
    'Результирующий набор пуст (0 строк) — нет точек данных для построения.',
  'viz.empty.insufficientColumns':
    'Для построения нужно минимум 2 столбца данных (1 измерение + 1 показатель).',
  'viz.empty.noNumericMetric':
    'В столбцах показателей нет пригодных числовых значений (возможно, все NULL или текст) — построить диаграмму невозможно.',
  'viz.empty.pieNeedsPositive':
    'Для круговой и кольцевой диаграммы требуется хотя бы одно значение больше 0; NULL и отрицательные числа учтены в статистике пропусков.',
  'viz.empty.scatterNeedsNumeric':
    'В диаграмме рассеяния первый столбец служит осью X, остальные числовые столбцы — осью Y; и X, и Y должны преобразовываться в числа.',
  'viz.empty.parallelNeedsMetrics':
    'Для диаграммы параллельных координат нужно минимум 2 числовых столбца показателей, чтобы построить ломаные линии; добавьте показатели и повторите.',
  'viz.empty.radarNeedsDimensions':
    'Для лепестковой диаграммы нужно минимум 3 значения измерений, чтобы замкнуть многоугольник; добавьте строки измерений и повторите.',

  // —— Типы, для которых отрисовка в браузере не реализована (честная заглушка) ——
  'viz.unsupported.title': 'Этот тип диаграммы пока не поддерживает отрисовку в браузере',
  'viz.unsupported.prefix': 'Тип диаграммы «',
  'viz.unsupported.codePrefix': '» (',
  'viz.unsupported.suffix':
    ') всё ещё можно создавать, сохранять и успешно получать данные, но в текущей версии отрисовка SVG для него не реализована; ниже показаны исходные данные, возвращённые сервером, — для сверки результата запроса.',

  // —— Таблица исходных данных ——
  'viz.table.summary': 'Исходные данные (строк: {count})',
  'viz.table.summary.one': 'Исходные данные ({count} строка)',
  'viz.table.summary.few': 'Исходные данные ({count} строки)',
  'viz.table.summary.many': 'Исходные данные ({count} строк)',
  'viz.table.summaryTruncated': 'Исходные данные (строк: {count}, показаны только первые {limit})',
  'viz.table.summaryTruncated.one':
    'Исходные данные ({count} строка, показаны только первые {limit})',
  'viz.table.summaryTruncated.few':
    'Исходные данные ({count} строки, показаны только первые {limit})',
  'viz.table.summaryTruncated.many':
    'Исходные данные ({count} строк, показаны только первые {limit})',
  'viz.table.noColumns': 'Запрос не вернул ни одного столбца.',
  'viz.cell.emptyString': '(пустая строка)',

  // —— Оси и статистика ——
  'viz.axis.value': 'Значение',
  'viz.note.skipped':
    'Пропущено ячеек (NULL / нечисловых): {count}; они не участвовали в построении.',
  'viz.note.skipped.one':
    'Пропущена {count} ячейка (NULL / нечисловая); она не участвовала в построении.',
  'viz.note.skipped.few':
    'Пропущено {count} ячейки (NULL / нечисловые); они не участвовали в построении.',
  'viz.note.skipped.many':
    'Пропущено {count} ячеек (NULL / нечисловых); они не участвовали в построении.',
  'viz.note.skippedPositive':
    'Пропущено ячеек (NULL / нечисловых или неположительных): {count}; они не участвовали в построении.',
  'viz.note.skippedPositive.one':
    'Пропущена {count} ячейка (NULL / нечисловая или неположительная); она не участвовала в построении.',
  'viz.note.skippedPositive.few':
    'Пропущено {count} ячейки (NULL / нечисловые или неположительные); они не участвовали в построении.',
  'viz.note.skippedPositive.many':
    'Пропущено {count} ячеек (NULL / нечисловых или неположительных); они не участвовали в построении.',
  'viz.caption.meta': 'строк: {rows} · столбцов: {columns} · затрачено {duration}',
  'viz.aria.chart': '{type}: {category}',

  // —— Шаблоны всплывающих подсказок (tooltip) ——
  'viz.tooltip.labelSeriesValue': '{label} · {series}: {value}',
  'viz.tooltip.seriesValue': '{series}: {value}',
  'viz.tooltip.seriesCategoryValue': '{series} · {category}: {value}',
  'viz.tooltip.slice': '{label}: {value} ({percent}%)',
  'viz.legend.sliceValue': '{value} ({percent}%)',
  'viz.donut.totalLabel': 'Итого: {series}',

  // —— Способы агрегации ——
  'viz.aggregation.none': 'Без агрегации',
  'viz.aggregation.sum': 'Сумма SUM',
  'viz.aggregation.avg': 'Среднее AVG',
  'viz.aggregation.count': 'Количество COUNT',
  'viz.aggregation.countDistinct': 'Количество уникальных COUNT DISTINCT',
  'viz.aggregation.min': 'Минимум MIN',
  'viz.aggregation.max': 'Максимум MAX',
  'viz.aggregation.median': 'Медиана MEDIAN',

  // —— Редактор строк измерений / показателей ——
  'viz.field.columnPlaceholder': 'Имя столбца, например region',
  'viz.field.aliasPlaceholder': 'Псевдоним (необязательно)',
  'viz.field.remove': 'Удалить это поле',
  'viz.field.add': 'Добавить поле',

  // —— Форма создания диаграммы ——
  'viz.form.name': 'Название диаграммы *',
  'viz.form.namePlaceholder': 'Например: распределение суммы заказов по регионам',
  'viz.form.chartType': 'Тип диаграммы *',
  'viz.form.typeOption': '{label} ({code})',
  'viz.form.typeHint':
    '{description} · требуется измерений: {dimensions}, показателей: {metrics}',
  'viz.form.connection': 'Подключение к базе данных *',
  'viz.form.connectionPlaceholder': 'Выберите подключение',
  'viz.form.connectionOption': '{name} ({type})',
  'viz.form.dashboard': 'Дашборд (необязательно)',
  'viz.form.dashboardNone': 'Не привязывать к дашборду',
  'viz.form.schema': 'Просмотр схем (необязательно)',
  'viz.form.schemaDisabled': 'Доступно после выбора подключения',
  'viz.form.schemaPlaceholder': 'Выберите схему',
  'viz.form.schemaHint':
    'Используется только для выбора имени таблицы; схему в SQL-запросе сервер подставляет по умолчанию для подключения.',
  'viz.form.source': 'Исходная таблица / представление *',
  'viz.form.sourceHintCount':
    'В текущей схеме доступно таблиц: {count}; можно также ввести имя таблицы вручную.',
  'viz.form.sourceHintCount.one':
    'В текущей схеме доступна {count} таблица; можно также ввести имя таблицы вручную.',
  'viz.form.sourceHintCount.few':
    'В текущей схеме доступны {count} таблицы; можно также ввести имя таблицы вручную.',
  'viz.form.sourceHintCount.many':
    'В текущей схеме доступно {count} таблиц; можно также ввести имя таблицы вручную.',
  'viz.form.sourceHint': 'Можно ввести имя таблицы или представления.',
  'viz.form.dimensions': 'Измерения (GROUP BY) *',
  'viz.form.dimensionsHint':
    'Измерения задают ось категорий; обычно выбирают агрегацию «Без агрегации».',
  'viz.form.metrics': 'Показатели (столбцы агрегации) *',
  'viz.form.metricsHint':
    'Показатели задают ось значений; SQL для суммирования, среднего, подсчёта и других агрегаций генерирует сервер.',
  'viz.form.submit': 'Создать диаграмму',
  'viz.form.error.nameRequired': 'Укажите название диаграммы.',
  'viz.form.error.connectionRequired':
    'Выберите подключение к базе данных, иначе диаграмма не сможет получить данные.',
  'viz.form.error.sourceRequired': 'Укажите имя исходной таблицы или представления.',
  'viz.form.error.minDimensions':
    '{type}: требуется минимум {need} измерений (указано {got}).',
  'viz.form.error.minMetrics':
    '{type}: требуется минимум {need} показателей (указано {got}).',
  'viz.form.error.fieldRequired': 'Нужен хотя бы один показатель или измерение.',

  // —— Список / предпросмотр диаграмм ——
  'viz.connection.unbound': 'Подключение не привязано',
  'viz.schemaHint.line': '{type} · схема по умолчанию: {schema}',
  'viz.schemaHint.unknown': 'Определяется базой данных',
  'viz.source.custom': 'Пользовательский SQL',
  'viz.list.title': 'Сохранённые диаграммы',
  'viz.list.name': 'Название диаграммы',
  'viz.list.source': 'Источник данных',
  'viz.list.render': 'Отрисовать эту диаграмму',
  'viz.list.empty': 'Диаграмм пока нет',
  'viz.list.emptyHint':
    'Нажмите «Создать диаграмму» в правом верхнем углу и выберите подключение, исходную таблицу и тип диаграммы.',
  'viz.toolbar.count': 'Всего диаграмм: {count}',
  'viz.toolbar.count.one': 'Всего {count} диаграмма',
  'viz.toolbar.count.few': 'Всего {count} диаграммы',
  'viz.toolbar.count.many': 'Всего {count} диаграмм',
  'viz.refreshList': 'Обновить список',
  'viz.create.title': 'Создать диаграмму',
  'viz.create.description':
    'Конфигурация диаграммы сохраняется на сервере; SQL для выборки данных генерирует сервер по измерениям, показателям и агрегациям — вручную SQL не принимается.',
  'viz.delete.title': 'Удаление диаграммы',
  'viz.delete.message': 'Удалить диаграмму «{name}»? Действие необратимо.',
  'viz.preview.emptyTitle': 'Выберите диаграмму, чтобы увидеть результат отрисовки',
  'viz.preview.emptyHintPrefix': 'Для отрисовки используются реальные данные, возвращённые ',
  'viz.preview.emptyHintSuffix': ', а не локально смоделированные.',
  'viz.preview.reload': 'Обновить данные',
  'viz.preview.loading': 'Получение данных и отрисовка…',
  'viz.preview.sqlSummary': 'Показать сгенерированный SQL',
  'viz.preview.sqlMeta': 'Выполнено за {duration}, возвращено строк: {count}.',
  'viz.preview.sqlMeta.one': 'Выполнено за {duration}, возвращена {count} строка.',
  'viz.preview.sqlMeta.few': 'Выполнено за {duration}, возвращено {count} строки.',
  'viz.preview.sqlMeta.many': 'Выполнено за {duration}, возвращено {count} строк.',
  'viz.preview.sqlMetaTruncated':
    'Выполнено за {duration}, возвращено строк: {count} (результат усечён).',
  'viz.preview.sqlMetaTruncated.one':
    'Выполнено за {duration}, возвращена {count} строка (результат усечён).',
  'viz.preview.sqlMetaTruncated.few':
    'Выполнено за {duration}, возвращено {count} строки (результат усечён).',
  'viz.preview.sqlMetaTruncated.many':
    'Выполнено за {duration}, возвращено {count} строк (результат усечён).',
  'viz.error.loadList': 'Не удалось загрузить список диаграмм: {message}',
  'viz.error.loadMeta': 'Не удалось загрузить часть метаданных диаграмм: {message}',
  'viz.error.create': 'Не удалось создать диаграмму: {message}',
  'viz.error.delete': 'Не удалось удалить диаграмму: {message}',
  'viz.toast.created': 'Диаграмма «{name}» создана.',
  'viz.toast.deleted': 'Диаграмма «{name}» удалена.',

  // —— Список / сведения о дашбордах ——
  'viz.dashboardList.title': 'Список дашбордов',
  'viz.dashboardList.name': 'Название дашборда',
  'viz.dashboardList.shared': 'Общий доступ',
  'viz.dashboardList.columns': 'Число столбцов',
  'viz.dashboardList.open': 'Открыть дашборд',
  'viz.dashboardList.empty': 'Дашбордов пока нет',
  'viz.dashboardList.emptyHint':
    'Создайте дашборд, затем при создании диаграммы в разделе «Визуализация данных» выберите этот дашборд, чтобы привязать её.',
  'viz.dashboardToolbar.count': 'Всего дашбордов: {count}',
  'viz.dashboardToolbar.count.one': 'Всего {count} дашборд',
  'viz.dashboardToolbar.count.few': 'Всего {count} дашборда',
  'viz.dashboardToolbar.count.many': 'Всего {count} дашбордов',
  'viz.dashboardToolbar.new': 'Создать дашборд',
  'viz.dashboardPreview.emptyTitle': 'Выберите дашборд, чтобы увидеть диаграммы',
  'viz.dashboardPreview.emptyHint':
    'Запрос сведений о дашборде возвращает и привязанные к нему диаграммы; каждая диаграмма получает данные и отрисовывается независимо.',
  'viz.dashboardPreview.refresh': 'Обновить дашборд',
  'viz.dashboardPreview.noDescription': 'Описания нет',
  'viz.dashboardPreview.noChartsTitle': 'В этом дашборде пока нет диаграмм',
  'viz.dashboardPreview.noChartsHint':
    'Создайте диаграмму на странице «Визуализация данных» и выберите «{name}» в поле «Дашборд», чтобы привязать её сюда.',
  'viz.dashboardMeta': '{description} · диаграмм: {charts} · столбцов сетки: {columns}',
  'viz.dashboardChart.refresh': 'Обновить данные этой диаграммы',
  'viz.dashboardChart.loading': 'Получение данных…',
  'viz.dashboardCreate.description':
    'Дашборд объединяет несколько диаграмм на одном экране; принадлежность диаграммы задаётся при её создании.',
  'viz.dashboardDelete.title': 'Удаление дашборда',
  'viz.dashboardDelete.message':
    'Удалить дашборд «{name}»? Диаграммы этого дашборда будут удалены вместе с ним (каскадно).',

  // —— Форма создания дашборда ——
  'viz.dashboardForm.name': 'Название дашборда *',
  'viz.dashboardForm.namePlaceholder': 'Например: дашборд ежедневной отчётности',
  'viz.dashboardForm.columns': 'Число столбцов сетки',
  'viz.dashboardForm.columns1': '1 столбец',
  'viz.dashboardForm.columns2': '2 столбца (по умолчанию)',
  'viz.dashboardForm.columns3': '3 столбца',
  'viz.dashboardForm.columns4': '4 столбца',
  'viz.dashboardForm.columnsHint':
    'Сохраняется в layout.columns; дашборд раскладывает диаграммы по этому числу столбцов.',
  'viz.dashboardForm.descriptionPlaceholder':
    'Необязательно: для кого этот дашборд и что он показывает',
  'viz.dashboardForm.shared': 'Общий дашборд',
  'viz.dashboardForm.sharedHint':
    'После включения другие авторизованные пользователи смогут просматривать дашборд только для чтения.',
  'viz.dashboardForm.submit': 'Создать дашборд',
  'viz.dashboardForm.error.nameRequired': 'Укажите название дашборда.',

  // —— Ошибки и уведомления дашбордов ——
  'viz.dashboardError.loadList': 'Не удалось загрузить список дашбордов: {message}',
  'viz.dashboardError.loadDetail': 'Не удалось загрузить сведения о дашборде: {message}',
  'viz.dashboardError.create': 'Не удалось создать дашборд: {message}',
  'viz.dashboardError.delete': 'Не удалось удалить дашборд: {message}',
  'viz.dashboardToast.created': 'Дашборд «{name}» создан.',
  'viz.dashboardToast.deleted': 'Дашборд «{name}» удалён.',
};

export default messages;
