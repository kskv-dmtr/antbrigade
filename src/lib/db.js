/* Единая точка доступа к выгрузке из Notion.
   Файл data/albums.json обновляется скриптом scripts/fetch-notion.ps1. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Корень проекта считаем от самого файла, а не от рабочего каталога:
   при `astro dev --root antbrigade` cwd — родительская папка, и поиск
   обложек со ссылками молча проваливался бы в запасной вариант. */
const projectRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

import data from '../../data/albums.json';
import { coverId } from './cover-id.js';
import { videoId } from './video-id.js';

export { coverId, videoId };

/* Ссылки на площадки лежат отдельно от данных Notion: их собирает
   scripts/fetch-links.mjs со страниц album.link. Файла может не быть —
   тогда на страницах просто останется одна кнопка на album.link. */
let platformLinks = {};
try {
  const raw = fs.readFileSync(path.join(projectRoot, 'data', 'links.json'), 'utf8');
  platformLinks = JSON.parse(raw).links ?? {};
} catch {
  // ссылки ещё не собраны
}

export const albums      = data.albums;
export const artists     = data.artists;
export const labels      = data.labels;
export const videos      = data.videos;
export const generatedAt = data.generatedAt;
export const counts      = data.counts;

export const albumById  = new Map(albums.map((a) => [a.id, a]));
export const artistById = new Map(artists.map((a) => [a.id, a]));
export const labelById  = new Map(labels.map((l) => [l.id, l]));
export const videoById  = new Map(videos.map((v) => [v.id, v]));

/* Обложки лежат в public/covers/ — их скачивает scripts/fetch-covers.mjs.
   Пока файла нет, ссылка ведёт на Notion: так сайт собирается и работает
   даже до первой загрузки обложек, просто с внешней зависимостью. */

const coversDir = path.join(projectRoot, 'public', 'covers');
let localCovers = new Set();
try {
  localCovers = new Set(fs.readdirSync(coversDir));
} catch {
  // папки ещё нет — значит обложки не скачаны, работаем через Notion
}

/** Адрес обложки нужного размера: локальный, если скачан, иначе Notion. */
export function coverSrc(album, size = 400) {
  if (!album?.cover) return null;
  const id = coverId(album.cover);
  const file = id ? `${id}-${size}.webp` : null;
  if (file && localCovers.has(file)) return `/covers/${file}`;
  return album.cover.replace(/([?&])width=\d+/, `$1width=${size}`);
}

/** srcset для сетки: 400 как 1x, 800 как 2x. */
export function coverSrcSet(album) {
  const one = coverSrc(album, 400);
  const two = coverSrc(album, 800);
  return one && two ? `${one} 1x, ${two} 2x` : null;
}

/* ---------------------------------------------------- кадры роликов

   Кадры лежат в public/videos/ — их скачивает scripts/fetch-thumbs.mjs.
   В отличие от обложек запасного варианта нет: тянуть картинку прямо с
   i.ytimg.com нельзя, YouTube в России режут. Нет файла — плитка покажет
   штриховку, то самое пустое состояние из макета.                      */

let localThumbs = new Set();
try {
  localThumbs = new Set(fs.readdirSync(path.join(projectRoot, 'public', 'videos')));
} catch {
  // папки ещё нет — значит кадры не скачаны
}

/** Адрес кадра нужной ширины, если он скачан. */
export function thumbSrc(video, width = 480) {
  const id = videoId(video?.url);
  if (!id) return null;
  const file = `${id}-${width}.webp`;
  return localThumbs.has(file) ? `/videos/${file}` : null;
}

/** srcset для плитки: 480 как 1x, 960 как 2x. */
export function thumbSrcSet(video) {
  const one = thumbSrc(video, 480);
  const two = thumbSrc(video, 960);
  return one && two ? `${one} 1x, ${two} 2x` : null;
}

// видно в логе сборки: если ноль, значит обложки не скачаны и всё идёт с Notion
const localCount = albums.filter((a) => {
  const id = coverId(a.cover);
  return id && localCovers.has(`${id}-400.webp`);
}).length;
console.log(`[covers] локальных обложек: ${localCount} из ${albums.length}`);

/* ------------------------------------------------------------- жанры

   В Notion жанр — это multi-select, отдельной базы под него нет, поэтому ни
   идентификаторов, ни готовых адресов у жанров не существует: собираем их
   сами из альбомов.

   Объединяем без учёта регистра. В базе уже встретилось "Jazz" и "jazz" —
   от одной описки каталог не должен разъезжаться на две страницы. Показываем
   при этом самое частое написание.                                          */

function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const genreIndex = new Map();
for (const album of albums) {
  for (const raw of album.genres) {
    const key = raw.toLowerCase();
    let genre = genreIndex.get(key);
    if (!genre) {
      genre = { key, variants: new Map(), albumIds: [] };
      genreIndex.set(key, genre);
    }
    genre.variants.set(raw, (genre.variants.get(raw) ?? 0) + 1);
    genre.albumIds.push(album.id);
  }
}

const takenSlugs = new Set();
for (const genre of [...genreIndex.values()].sort((a, b) => a.key.localeCompare(b.key))) {
  genre.name = [...genre.variants.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];

  // на всякий случай: два разных названия могут дать одинаковый адрес
  let slug = slugify(genre.name) || 'genre';
  if (takenSlugs.has(slug)) {
    let n = 2;
    while (takenSlugs.has(`${slug}-${n}`)) n++;
    slug = `${slug}-${n}`;
  }
  takenSlugs.add(slug);
  genre.slug = slug;
  genre.count = genre.albumIds.length;
}

export const genres = [...genreIndex.values()].sort(
  (a, b) => b.count - a.count || a.name.localeCompare(b.name)
);

export const genreBySlug = new Map(genres.map((g) => [g.slug, g]));

/** Жанр по любому написанию — чтобы ссылка с карточки вела куда надо. */
export function genreFor(name) {
  return genreIndex.get(String(name).toLowerCase()) ?? null;
}

/** Жанры, чаще всего встречающиеся вместе с этим. */
export function relatedGenres(genre, limit = 8) {
  const together = new Map();
  for (const id of genre.albumIds) {
    for (const raw of albumById.get(id).genres) {
      const key = raw.toLowerCase();
      if (key === genre.key) continue;
      together.set(key, (together.get(key) ?? 0) + 1);
    }
  }
  return [...together.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key]) => genreIndex.get(key));
}

/* ---------------------------------------------------------- площадки */

// Показываем не всё, что отдаёт Odesli, а только то, чем реально пользуются.
// Apple Music и YouTube в списке отсутствуют не по нашей воле: Odesli их для
// этого каталога не отдаёт — проверено и через страницу, и через её API.
const SHOWN_PLATFORMS = [
  { key: 'spotify',  label: 'Spotify' },
  { key: 'bandcamp', label: 'Bandcamp' },
  { key: 'yandex',   label: 'Yandex Music' }
];

/** Прямые ссылки на площадки для релиза, в заданном порядке. */
export function listenLinks(album) {
  const found = platformLinks[album.id]?.platforms ?? {};
  return SHOWN_PLATFORMS
    .filter(({ key }) => found[key])
    .map(({ key, label }) => ({ key, label, url: found[key] }));
}

export function albumsOf(ids) {
  return (ids || []).map((id) => albumById.get(id)).filter(Boolean);
}
export function artistsOf(ids) {
  return (ids || []).map((id) => artistById.get(id)).filter(Boolean);
}
export function labelsOf(ids) {
  return (ids || []).map((id) => labelById.get(id)).filter(Boolean);
}
export function videosOf(ids) {
  return (ids || []).map((id) => videoById.get(id)).filter(Boolean);
}

/* Страна — текстом, а не флагом.

   Эмодзи-флаги убраны намеренно. Это был единственный цвет на монохромной
   странице; они не слушаются currentColor и оставались цветным пятном на
   вывернутой при наведении строке; на Windows вместо них рисуются две буквы
   в рамочках — глифов флагов в Segoe UI Emoji нет. Ширина у них вдобавок
   плавает от страны к стране, и колонка с именем не выравнивалась.

   Словарь названий не заводим: Intl.DisplayNames знает все 66 кодов из базы
   и работает на сборке, в рантайме его нет.                                */
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

/** Название страны из ISO-кода: US -> United States. */
export function countryName(code) {
  if (!code || code.length !== 2) return '';
  try {
    return regionNames.of(code.toUpperCase()) ?? '';
  } catch {
    return '';   // код, которого нет в стандарте
  }
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return '';
  if (!m) return String(y);
  return d ? `${MONTHS[m - 1]} ${d}, ${y}` : `${MONTHS[m - 1]} ${y}`;
}

/** 1 release / 2 releases */
export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/* Исполнители релиза одной строкой, через точку.

   Разбираем массив artists, а не строку artist: в ней Notion разделяет
   соавторов то косой чертой, то амперсандом, и делить её самим нельзя —
   «Bad//Dreems» это одно название группы, а не двое. У сольных релизов
   массив из одного имени, поэтому берём исходную строку как есть. */
export function artistLine(album) {
  /* Отбрасываем имена, целиком входящие в другое имя из той же связки.
     В Notion у «Durand Jones & The Indications» проставлены и группа, и сам
     Durand Jones — без этого вышло бы «Durand Jones & The Indications ·
     Durand Jones». */
  const names = (album.artists ?? []).filter(
    (name, _, all) => !all.some((other) => other !== name && other.includes(name))
  );
  return names.length > 1 ? names.join(' · ') : album.artist;
}
