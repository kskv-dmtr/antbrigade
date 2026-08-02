/* Единая точка доступа к выгрузке из Notion.
   Файл data/albums.json обновляется скриптом scripts/fetch-notion.ps1. */

import fs from 'node:fs';
import path from 'node:path';

import data from '../../data/albums.json';
import { coverId } from './cover-id.js';

export { coverId };

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

const coversDir = path.join(process.cwd(), 'public', 'covers');
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

// видно в логе сборки: если ноль, значит обложки не скачаны и всё идёт с Notion
const localCount = albums.filter((a) => {
  const id = coverId(a.cover);
  return id && localCovers.has(`${id}-400.webp`);
}).length;
console.log(`[covers] локальных обложек: ${localCount} из ${albums.length}`);

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

/** Флаг-эмодзи из ISO-кода страны: US -> 🇺🇸 */
export function flag(code) {
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

const RU_MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return '';
  if (!m) return String(y);
  return d ? `${d} ${RU_MONTHS[m - 1]} ${y}` : `${RU_MONTHS[m - 1]} ${y}`;
}

/** Склонение: 1 релиз, 2 релиза, 5 релизов */
export function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} ${one}`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${n} ${few}`;
  return `${n} ${many}`;
}
