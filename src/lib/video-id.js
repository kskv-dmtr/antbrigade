/* Идентификатор ролика на YouTube.
   Общий модуль: им пользуются и скрипт скачивания кадров, и сборка сайта —
   иначе правило разъедется и половина кадров перестанет находиться. */

/**
 * Из ссылки достаёт идентификатор ролика.
 *
 * В базе все 46 ссылок вида https://youtu.be/<id>?si=..., но короткая форма
 * не единственная: если однажды вставят полный адрес с watch?v= или
 * встраиваемый /embed/, разбираем и их. Чужой хост отдаём как null —
 * кадр для него всё равно неоткуда взять.
 */
export function videoId(url) {
  if (!url) return null;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, '');
  const ok = (id) => (/^[\w-]{11}$/.test(id) ? id : null);

  if (host === 'youtu.be') return ok(parsed.pathname.slice(1));

  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const v = parsed.searchParams.get('v');
    if (v) return ok(v);
    const m = parsed.pathname.match(/^\/(?:embed|shorts|v)\/([\w-]+)/);
    if (m) return ok(m[1]);
  }

  return null;
}
