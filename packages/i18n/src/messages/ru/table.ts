/**
 * 花生苗数据库管理工具 - 表数据编辑器文案（ru）
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 表数据编辑器（Excel 式增删改查）的界面文案。键名以 table. 开头。
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  'table.title': 'Данные таблицы',
  'table.subtitle': 'Просмотр и правка записей как в таблице: вставка, изменение, удаление — без SQL',
  'table.selectConnection': 'Подключение',
  'table.selectTable': 'Таблица',
  'table.pickTable': 'Выберите таблицу',
  'table.noTableTitle': 'Таблица не выбрана',
  'table.noTableHint': 'Выберите таблицу слева — её строки появятся здесь и будут доступны для правки.',
  'table.refresh': 'Обновить',
  'table.addRow': 'Добавить строку',
  'table.deleteRows': 'Удалить выбранные ({count})',
  'table.save': 'Сохранить изменения ({count})',
  'table.discard': 'Отменить изменения',
  'table.pageSize': '{size} строк на странице',
  'table.prev': 'Назад',
  'table.next': 'Вперёд',
  'table.pageInfo': 'Страница {page} из {total}',
  'table.totalRows': 'Всего строк: {count}',
  'table.totalUnknown': 'Число строк неизвестно (таблица слишком велика или не поддаётся подсчёту)',
  'table.loading': 'Загрузка…',
  'table.empty': 'В этой таблице пока нет строк',
  'table.emptyHint': 'Нажмите «Добавить строку», чтобы вставить первую запись.',
  'table.rowNew': 'Новая',
  'table.rowEdited': 'Изменена',
  'table.rowDeleted': 'К удалению',
  'table.selectRow': 'Выбрать строку {index}',
  'table.selectAll': 'Выбрать все на странице',
  'table.cellNull': 'NULL',
  'table.cellEdited': 'Эта ячейка изменена',
  'table.locatorPrimary': 'Идентификация по первичному ключу {columns}',
  'table.locatorUnique': 'Идентификация по уникальному индексу {name} ({columns})',
  'table.locatorNone': 'Идентификация строки невозможна',
  'table.readonlyNoKey': 'В таблице нет первичного ключа и пригодного уникального индекса, поэтому одну строку нельзя надёжно определить. Чтобы случайно не изменить много строк, здесь разрешён только просмотр и вставка.',
  'table.readonlyNoPermission': 'У вашей учётной записи нет прав на запись; только просмотр.',
  'table.readonlyConnection': 'Для этого подключения включена защита от записи; только просмотр.',
  'table.readonlyBanner': 'Режим только чтения: {reason}',
  'table.errLoad': 'Не удалось загрузить данные: {message}',
  'table.errSave': 'Не удалось сохранить: {message}',
  'table.errNoChanges': 'Нет изменений для сохранения',
  'table.errRequired': 'Столбец {column} не может быть пустым',
  'table.errIdentifier': 'Недопустимое имя таблицы или столбца',
  'table.confirmDelete': 'Удалить выбранные строки ({count})? Изменения сразу попадут в базу и необратимы.',
  'table.confirmDiscard': 'Отменить все несохранённые изменения?',
  'table.saveDone': 'Сохранено: вставлено {inserted} / изменено {updated} / удалено {deleted}',
  'table.unsaved': 'Не сохранено изменений: {count}',
  'table.sortHint': 'Нажмите на заголовок столбца для сортировки',
  'table.newRowHint': 'Новые строки добавляются в конец и попадают в базу только после сохранения',
  'table.pkMissing': 'В таблице нет первичного ключа: строки можно добавлять, но существующие записи нельзя безопасно изменить или удалить.',
};

export default messages;
