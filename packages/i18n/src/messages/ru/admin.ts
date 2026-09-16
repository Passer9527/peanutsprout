/**
 * Русский · Журнал аудита и настройки
 * Copyright (C) 2025 飞哥 (微信 6731663)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Отображаемые имена действий аудита, результатов, прав и ролей лежат в meta;
 * здесь только формулировки, специфичные для журнала аудита и страницы настроек:
 * панель фильтров, заголовки столбцов, пустые состояния, постраничная навигация,
 * окно сведений, тема оформления, сервер и API, смена пароля, «О программе»,
 * языковая карточка.
 * Общие кнопки (Сбросить), статусы (Статус), заглушка (—) и «Неизвестно» берутся
 * из common / nav.
 */
import type { MessageKeyWithPlurals } from '../../index.js';

const messages: Partial<Record<MessageKeyWithPlurals, string>> = {
  // —— Журнал аудита: панель фильтров ——
  'admin.audit.action': 'Действие',
  'admin.audit.actionPlaceholder': 'Например: login / query.execute',
  'admin.audit.filterUserId': 'ID пользователя',
  'admin.audit.pageSize': 'На странице',
  'admin.audit.pageSizeOption': 'Записей: {count}',
  'admin.audit.pageSizeOption.one': '{count} запись',
  'admin.audit.pageSizeOption.few': '{count} записи',
  'admin.audit.pageSizeOption.many': '{count} записей',
  'admin.audit.query': 'Найти',
  'admin.audit.verifyChain': 'Проверить цепочку хешей',

  // —— Журнал аудита: столбцы таблицы ——
  'admin.audit.column.time': 'Время',
  'admin.audit.column.user': 'Пользователь',
  'admin.audit.column.resource': 'Ресурс',
  'admin.audit.column.connection': 'Подключение',
  'admin.audit.column.sqlDetail': 'SQL / подробности',
  'admin.audit.column.ip': 'IP-адрес источника',
  'admin.audit.column.hash': 'Хеш',
  'admin.audit.anonymous': 'Аноним',
  'admin.audit.viewDetail': 'Просмотреть подробности',
  'admin.audit.noHash': 'Нет хеша',
  'admin.audit.noExtraInfo': 'Нет дополнительных сведений',

  // —— Журнал аудита: результат операций ({message} — локализованный текст ошибки, {position} — место разрыва цепочки) ——
  'admin.audit.loadFailed': 'Не удалось загрузить журнал аудита: {message}',
  'admin.audit.verifyOk': 'Цепочка хешей проверена, всего проверено записей: {count}.',
  'admin.audit.verifyOk.one': 'Цепочка хешей проверена, всего проверена {count} запись.',
  'admin.audit.verifyOk.few': 'Цепочка хешей проверена, всего проверено {count} записи.',
  'admin.audit.verifyOk.many': 'Цепочка хешей проверена, всего проверено {count} записей.',
  'admin.audit.verifyFailed': 'Не удалось проверить цепочку хешей: {message}',
  'admin.audit.verifyBroken':
    'Проверка цепочки хешей не пройдена; первое нарушение в позиции: {position}',
  'admin.audit.bannerOk':
    'Цепочка хешей проверена: всего проверено записей: {count}, подделок не обнаружено.',
  'admin.audit.bannerOk.one':
    'Цепочка хешей проверена: всего проверена {count} запись, подделок не обнаружено.',
  'admin.audit.bannerOk.few':
    'Цепочка хешей проверена: всего проверено {count} записи, подделок не обнаружено.',
  'admin.audit.bannerOk.many':
    'Цепочка хешей проверена: всего проверено {count} записей, подделок не обнаружено.',
  'admin.audit.bannerBroken':
    'Проверка цепочки хешей не пройдена: всего проверено записей: {count}, первое нарушение в позиции {position}.',
  'admin.audit.bannerBroken.one':
    'Проверка цепочки хешей не пройдена: всего проверена {count} запись, первое нарушение в позиции {position}.',
  'admin.audit.bannerBroken.few':
    'Проверка цепочки хешей не пройдена: всего проверено {count} записи, первое нарушение в позиции {position}.',
  'admin.audit.bannerBroken.many':
    'Проверка цепочки хешей не пройдена: всего проверено {count} записей, первое нарушение в позиции {position}.',

  // —— Журнал аудита: пустое состояние и постраничная навигация ——
  'admin.audit.empty': 'Нет записей аудита, соответствующих условиям',
  'admin.audit.emptyHint':
    'Измените условия фильтра и повторите либо убедитесь, что аудит на сервере включён.',
  'admin.audit.pager': 'Всего записей: {total} · страница {page} из {totalPages}',
  'admin.audit.prevPage': 'Предыдущая страница',
  'admin.audit.nextPage': 'Следующая страница',

  // —— Журнал аудита: окно сведений ——
  'admin.audit.detailTitle': 'Подробности аудита',
  'admin.audit.errorMessage': 'Сообщение об ошибке',
  'admin.audit.currentHash': 'Текущий хеш',

  // —— Настройки: тема оформления ——
  'admin.settings.appearance.title': 'Оформление',
  'admin.settings.appearance.subtitle':
    'Настройка темы сохраняется в локальном браузере и применяется сразу.',
  'admin.settings.theme.light': 'Светлая',
  'admin.settings.theme.lightHint': 'Оформление по умолчанию для светлых помещений',
  'admin.settings.theme.dark': 'Тёмная',
  'admin.settings.theme.darkHint': 'Меньше нагрузки на глаза при слабом освещении',

  // —— Настройки: сервер и интерфейсы ——
  'admin.settings.service.title': 'Сервер и интерфейсы',
  'admin.settings.service.subtitle':
    'Веб-клиент обращается к REST-интерфейсу сервера PeanutSprout по адресу {base}.',
  'admin.settings.service.apiBase': 'Базовый адрес API',
  'admin.settings.service.pageOrigin': 'Адрес текущей страницы',
  'admin.settings.service.authMethod': 'Способ аутентификации',
  'admin.settings.service.status': 'Состояние сервера',
  'admin.settings.service.checking': 'Проверка…',
  'admin.settings.service.statusLine': '{status} · v{version} · работает {uptime}',
  'admin.settings.service.unavailable': 'Не удалось получить состояние сервера',
  'admin.settings.service.recheck': 'Проверить снова',
  'admin.settings.service.ok': 'Сервер работает: версия {version}',

  // —— Настройки: смена пароля ——
  'admin.settings.password.title': 'Смена пароля',
  'admin.settings.password.currentAccount': 'Текущая учётная запись: ',
  'admin.settings.password.current': 'Текущий пароль',
  'admin.settings.password.new': 'Новый пароль',
  'admin.settings.password.confirm': 'Подтвердите новый пароль',
  'admin.settings.password.newHint': 'Не менее 6 символов',
  'admin.settings.password.submit': 'Обновить пароль',
  'admin.settings.password.errCurrentRequired': 'Введите текущий пароль.',
  'admin.settings.password.errTooShort':
    'Новый пароль должен содержать не менее 6 символов.',
  'admin.settings.password.errSameAsCurrent':
    'Новый пароль не должен совпадать с текущим.',
  'admin.settings.password.errMismatch': 'Введённые новые пароли не совпадают.',
  'admin.settings.password.success':
    'Пароль обновлён; при следующем входе используйте новый пароль.',

  // —— Настройки: о программе ——
  'admin.settings.about.title': 'О PeanutSprout',
  'admin.settings.about.subtitle':
    'Кроссплатформенный клиент для единого управления базами данных',
  'admin.settings.about.productName': 'Название продукта',
  'admin.settings.about.productValue': 'PeanutSprout',
  'admin.settings.about.versionValue': '0.1.0',
  'admin.settings.about.author': 'Автор',
  'admin.settings.about.authorValue': '飞哥 · 微信 6731663',
  'admin.settings.about.license': 'Лицензия',
  'admin.settings.about.licenseValue': 'AGPL-3.0-or-later',
  'admin.settings.about.stack': 'Веб-технологии',
  'admin.settings.about.stackValue':
    'React 19 · TypeScript 5.9 · Vite 7 (без сторонних библиотек UI, состояния, маршрутизации и диаграмм)',

  // —— Настройки: доступ по локальной сети (веб-страница) ——
  'admin.webAccess.title': 'Доступ по локальной сети (веб-страница)',
  'admin.webAccess.subtitle':
    'Если включено, другие устройства в той же локальной сети смогут открыть этот инструмент в браузере. Если выключено, сервер слушает только 127.0.0.1 и доступен лишь с этого компьютера.',
  'admin.webAccess.toggle.label': 'Разрешить доступ по локальной сети',
  'admin.webAccess.toggle.hint':
    'Если выключено, сервер привязан только к 127.0.0.1 и другие машины подключиться не смогут.',
  'admin.webAccess.port.label': 'Порт доступа',
  'admin.webAccess.port.hint':
    'Диапазон 1024–65535. После включения порт фиксируется, поэтому опубликованные ссылки продолжают работать.',
  'admin.webAccess.port.err': 'Порт должен быть целым числом от 1024 до 65535.',
  'admin.webAccess.save': 'Сохранить настройки',
  'admin.webAccess.saving': 'Сохранение…',
  'admin.webAccess.current.title': 'Действует сейчас',
  'admin.webAccess.current.on': 'Доступ по сети открыт · {host}:{port}',
  'admin.webAccess.current.off': 'Только этот компьютер · {host}:{port}',
  'admin.webAccess.restart.title': 'Требуется перезапуск',
  'admin.webAccess.restart.body':
    'Адрес и порт прослушивания определяются при запуске. Настройки сохранены; чтобы новый адрес вступил в силу, перезапустите 花生苗.',
  'admin.webAccess.url.title': 'Доступные адреса',
  'admin.webAccess.url.empty': 'Адрес в локальной сети не обнаружен. Проверьте сетевое подключение.',
  'admin.webAccess.copy': 'Копировать',
  'admin.webAccess.copied': 'Адрес скопирован в буфер обмена.',
  'admin.webAccess.embedded':
    'Окно настольной версии всегда подключается через 127.0.0.1 и не зависит от этого переключателя; здесь задаётся, разрешён ли доступ с других устройств в локальной сети.',
  'admin.webAccess.warn.lan_exposed':
    'Доступ по локальной сети открыт: любой в этой сети может открыть страницу входа. Убедитесь, что пароли достаточно надёжны, и включайте это только в доверенной сети.',
  'admin.webAccess.warn.no_https':
    'Соединение идёт по открытому HTTP: пароли и результаты запросов можно перехватить в локальной сети. Используйте это только в доверенной внутренней сети.',
  'admin.webAccess.warn.default_password':
    'Некоторые учётные записи всё ещё используют начальный пароль. Смените эти пароли, прежде чем открывать доступ по локальной сети.',
  'admin.webAccess.err.load': 'Не удалось прочитать настройки локальной сети: {message}',
  'admin.webAccess.err.save': 'Не удалось сохранить настройки локальной сети: {message}',
  'admin.webAccess.err.copy': 'Не удалось скопировать. Выделите адрес и скопируйте его вручную.',

  // —— Всплывающие уведомления (toast) ——
  'admin.toast.close': 'Закрыть уведомление',
};

export default messages;
