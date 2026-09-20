/* Сводный указатель для поиска в шапке.

   Отдаётся одним файлом /search.json и грузится в браузер по первому касанию
   поля, а не вместе со страницей: искать заходят не все, а весит он больше
   любой страницы сайта.

   Строка записи — массив, а не объект: имена ключей повторились бы на каждой
   из трёх с половиной тысяч записей и заняли бы больше самих значений.
   Порядок такой: тип, имя, адрес, подпись, пометка справа, миниатюра, род.

   Род — то, что стоит в рамке справа от находки: у релиза его тип («Album»,
   «EP»), у ролика — вид («Official Video»); с 20 сентября 2026, просьба
   владельца, до того стояли общие «release» и «video». У исполнителя, лейбла
   и жанра — слово рода (Artist, Label, Genre). Род лежит у всех записей и всегда седьмым: скрипт
   поля дописывает к записи свои поля (свёрнутые имя и подпись), и место рода
   должно быть постоянным.

   Страны у исполнителя и лейбла в подписи нет — с 19 сентября 2026 (просьба
   владельца): подпись у них — один счёт релизов.

   Миниатюра — с 19 сентября 2026 (находки набраны по образцу Spotify):
   «c» и id обложки либо «v» и id ролика, полный адрес собирает скрипт
   поля — так строка короче вдвое. У релиза — его обложка, у клипа — кадр,
   у исполнителя, лейбла и жанра — обложка самого свежего их релиза, у
   исполнителя без релизов — кадр клипа. Нет скачанной картинки — пусто.

   Тип одной буквой: r — релиз, v — клип, a — исполнитель, l — лейбл,
   g — жанр. Развернёт его в слово тот же скрипт, что рисует находки.

   Свёрнутой формы имени (без регистра и без диакритики) здесь нет намеренно:
   она удвоила бы вес файла, а в браузере считается за один проход по всему
   указателю. */

import {
  albums, artists, labels, genres, videos,
  artistLine, videoTitle, videoArtists, typeLine,
  albumById, videoById, coverSrc, thumbSrc
} from '../lib/db.js';

const обложка = (al) => {
  const src = coverSrc(al, 400);
  const m = src && src.match(/^\/covers\/(.+)-400\.webp$/);
  return m ? 'c' + m[1] : '';
};
const кадр = (v) => {
  const src = thumbSrc(v, 480);
  const m = src && src.match(/^\/videos\/(.+)-480\.webp$/);
  return m ? 'v' + m[1] : '';
};
// Самый свежий релиз из списка — по дате выхода, затем по году.
const свежий = (ids = []) => {
  let лучший = null;
  for (const id of ids) {
    const al = albumById.get(id);
    if (!al) continue;
    const ключ = al.released ?? String(al.year ?? '');
    if (!лучший || ключ > (лучший.released ?? String(лучший.year ?? ''))) лучший = al;
  }
  return лучший;
};
const миниатюра = (albumIds, videoIds = []) => {
  const al = свежий(albumIds);
  if (al) { const c = обложка(al); if (c) return c; }
  for (const id of videoIds) { const k = кадр(videoById.get(id)); if (k) return k; }
  return '';
};

export function GET() {
  const записи = [];

  /* Исполнители первыми: при равном совпадении имя человека или группы —
     чаще то, что искали, чем одноимённый релиз. */
  for (const a of artists) {
    записи.push(['a', a.name, `/artists/${a.slug}`,
      '', typeLine(a.albumIds, a.videoIds),
      миниатюра(a.albumIds, a.videoIds), 'Artist']);
  }

  for (const al of albums) {
    записи.push(['r', al.album, `/music/${al.slug}`, artistLine(al), String(al.year ?? ''), обложка(al),
      al.types?.[0] ?? 'release']);
  }

  for (const v of videos) {
    записи.push(['v', videoTitle(v), `/video/${v.slug}`, videoArtists(v), String(v.year ?? ''), кадр(v),
      v.kind ?? 'video']);
  }

  for (const l of labels) {
    записи.push(['l', l.name, `/labels/${l.slug}`,
      '', typeLine(l.albumIds),
      миниатюра(l.albumIds), 'Label']);
  }

  for (const g of genres) {
    записи.push(['g', g.name, `/genres/${g.slug}`, '', typeLine(g.albumIds), миниатюра(g.albumIds), 'Genre']);
  }

  return new Response(JSON.stringify(записи), {
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
