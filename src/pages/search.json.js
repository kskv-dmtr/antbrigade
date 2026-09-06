/* Сводный указатель для поиска в шапке.

   Отдаётся одним файлом /search.json и грузится в браузер по первому касанию
   поля, а не вместе со страницей: искать заходят не все, а весит он больше
   любой страницы сайта.

   Строка записи — массив, а не объект: имена ключей повторились бы на каждой
   из трёх с половиной тысяч записей и заняли бы больше самих значений.
   Порядок такой: тип, имя, адрес, подпись, пометка справа.

   Тип одной буквой: r — релиз, v — клип, a — исполнитель, l — лейбл,
   g — жанр. Развернёт его в слово тот же скрипт, что рисует находки.

   Свёрнутой формы имени (без регистра и без диакритики) здесь нет намеренно:
   она удвоила бы вес файла, а в браузере считается за один проход по всему
   указателю. */

import {
  albums, artists, labels, genres, videos,
  artistLine, videoTitle, videoArtists, countryName
} from '../lib/db.js';

export function GET() {
  const записи = [];

  /* Исполнители первыми: при равном совпадении имя человека или группы —
     чаще то, что искали, чем одноимённый релиз. */
  for (const a of artists) {
    записи.push(['a', a.name, `/artists/${a.slug}`,
      a.country ? countryName(a.country) : '', String(a.albumIds?.length ?? 0)]);
  }

  for (const al of albums) {
    записи.push(['r', al.album, `/albums/${al.slug}`, artistLine(al), String(al.year ?? '')]);
  }

  for (const v of videos) {
    записи.push(['v', videoTitle(v), `/videos/${v.slug}`, videoArtists(v), String(v.year ?? '')]);
  }

  for (const l of labels) {
    записи.push(['l', l.name, `/labels/${l.slug}`,
      l.country ? countryName(l.country) : '', String(l.albumIds?.length ?? 0)]);
  }

  for (const g of genres) {
    записи.push(['g', g.name, `/genres/${g.slug}`, '', String(g.count ?? 0)]);
  }

  return new Response(JSON.stringify(записи), {
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
