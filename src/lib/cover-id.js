/* Имя локального файла обложки.
   Общий модуль: им пользуются и скрипт скачивания, и сборка сайта —
   иначе правило разъедется и половина обложек перестанет находиться. */

import { createHash } from 'node:crypto';

/**
 * Из адреса обложки достаёт устойчивый идентификатор.
 *
 * Обычно иконка страницы в Notion — вложение вида "attachment:<uuid>:<файл>",
 * и uuid идеально подходит: он не меняется, пока картинку не заменили.
 * Изредка попадаются иконки, заданные внешней ссылкой — для них берём хеш.
 */
export function coverId(url) {
  if (!url) return null;

  // адрес прокси Notion: /image/<закодированная иконка>?...
  const match = url.match(/\/image\/([^?]+)/);
  const icon = match ? decodeURIComponent(match[1]) : url;

  const attachment = icon.match(/^attachment:([0-9a-f-]{36}):/i);
  if (attachment) return attachment[1];

  return 'ext-' + createHash('sha1').update(icon).digest('hex').slice(0, 16);
}
