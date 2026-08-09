/* Разбор выгрузки: что в базе не заполнено и что рассыпалось.
 *
 * Ничего не чинит и никуда не ходит — читает data/albums.json, data/links.json
 * и содержимое public/covers и public/videos. Правки делаются в Notion, здесь
 * только список того, что стоит открыть.
 *
 * Запуск:
 *   npm run doctor            отчёт, выход всегда 0
 *   npm run doctor -- --strict  выход 1, если нашлись поломки
 *
 * Поломки и пропуски различаются намеренно. Пропуск — незаполненное поле,
 * это вопрос к содержимому базы. Поломка — висящая связь или ненайденный
 * файл, то есть расхождение внутри самих данных; такое чинится вручную и
 * само не рассосётся.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { coverId } from '../src/lib/cover-id.js';
import { videoId } from '../src/lib/video-id.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const strict = process.argv.includes('--strict');

/* Сколько имён печатать под каждым пунктом. Список нужен, чтобы пойти и
   поправить, а не чтобы любоваться: два десятка — предел читаемого. */
const SHOW = 20;

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(path.join(root, file), 'utf8'));
  } catch {
    return fallback;
  }
}

async function listDir(dir) {
  try {
    return await readdir(path.join(root, dir));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------- вывод */

let пропусков = 0;
let поломок = 0;

const заголовок = (текст) => console.log(`\n${текст}\n${'─'.repeat(текст.length)}`);

/**
 * Строка отчёта: сколько записей задеты и какие именно.
 *
 * kind: 'пропуск' — незаполненное поле, 'поломка' — расхождение в данных.
 * имя: как назвать запись в списке; null — списка не будет вовсе, когда
 *      важно только число.
 */
function пункт(подпись, записи, всего, kind = 'пропуск', имя = (x) => x.name) {
  const n = записи.length;
  if (kind === 'поломка') поломок += n; else пропусков += n;

  const доля = всего ? ` ${String(Math.round((n / всего) * 100)).padStart(3)}%` : '';
  const метка = n === 0 ? '  ok ' : kind === 'поломка' ? '  !! ' : '  ·  ';
  console.log(`${метка}${подпись.padEnd(38)}${String(n).padStart(5)}${доля}`);

  if (!имя) return;
  for (const запись of записи.slice(0, SHOW)) console.log(`         ${имя(запись)}`);
  if (n > SHOW) console.log(`         …и ещё ${n - SHOW}`);
}

/* ------------------------------------------------------------- разбор */

const data = await readJson('data/albums.json');
if (!data) {
  console.error('нет data/albums.json — сначала npm run sync');
  process.exit(1);
}

const links = (await readJson('data/links.json', { links: {} })).links;
const albums = data.albums ?? [];
const artists = data.artists ?? [];
const labels = data.labels ?? [];
const videos = data.videos ?? [];

const подпись = (a) => `${a.artist} — ${a.album}`;
const пусто = (v) => (Array.isArray(v) ? v.length === 0 : v === null || v === undefined || v === '');

console.log(`выгрузка от ${data.generatedAt ?? 'неизвестно когда'}`);
console.log(`релизов ${albums.length}, исполнителей ${artists.length}, ` +
            `лейблов ${labels.length}, клипов ${videos.length}`);

заголовок('Релизы');
пункт('без лейбла', albums.filter((a) => пусто(a.labelIds)), albums.length, 'пропуск', подпись);
пункт('без исполнителя', albums.filter((a) => пусто(a.artistIds)), albums.length, 'пропуск', подпись);
пункт('без даты выхода', albums.filter((a) => пусто(a.released)), albums.length, 'пропуск', подпись);
пункт('без года', albums.filter((a) => пусто(a.year)), albums.length, 'пропуск', подпись);
пункт('без обложки', albums.filter((a) => пусто(a.cover)), albums.length, 'пропуск', подпись);
пункт('без жанра', albums.filter((a) => пусто(a.genres)), albums.length, 'пропуск', подпись);
пункт('без типа релиза', albums.filter((a) => пусто(a.types)), albums.length, 'пропуск', подпись);
пункт('без ссылки album.link', albums.filter((a) => пусто(a.url)), albums.length, 'пропуск', подпись);

/* Площадки собираются постепенно и своим чередом, поэтому это не пропуск в
   базе, а состояние сбора: список имён тут не нужен, важно только число. */
const безПлощадок = albums.filter(
  (a) => !links[a.id] || Object.keys(links[a.id].platforms ?? {}).length === 0
);
пункт('без ссылок на площадки (собираются сами)', безПлощадок, albums.length, 'пропуск', null);

заголовок('Исполнители и лейблы');
пункт('исполнителей без страны', artists.filter((a) => пусто(a.country)), artists.length);
пункт('лейблов без страны', labels.filter((l) => пусто(l.country)), labels.length);

/* Исполнитель без релизов — норма, если он заведён ради клипа. Без того и
   другого это пустая карточка, и её стоит либо наполнить, либо убрать. */
пункт(
  'карточек без релизов и клипов',
  artists.filter((a) => пусто(a.albumIds) && пусто(a.videoIds)),
  artists.length
);
пункт('лейблов без релизов', labels.filter((l) => пусто(l.albumIds)), labels.length);

заголовок('Связи');
const artId = new Set(artists.map((a) => a.id));
const labId = new Set(labels.map((l) => l.id));
const albId = new Set(albums.map((a) => a.id));

/* Висящая связь — след страницы, которая ушла в корзину Notion: из вида базы
   она пропала, а идентификатор в поле релиза остался. На сайте не видна,
   неразрешимые связи там отбрасываются, но в базе это мусор. */
const битые = [];
for (const a of albums) {
  for (const id of a.artistIds ?? []) if (!artId.has(id)) битые.push({ a, что: 'исполнитель', id });
  for (const id of a.labelIds ?? []) if (!labId.has(id)) битые.push({ a, что: 'лейбл', id });
}
пункт(
  'висящих связей у релизов', битые, albums.length, 'поломка',
  ({ a, что, id }) => `${подпись(a)} → ${что}: notion.so/${id.replace(/-/g, '')}`
);

const обратные = [];
for (const x of [...artists, ...labels]) {
  for (const id of x.albumIds ?? []) if (!albId.has(id)) обратные.push({ x, id });
}
пункт(
  'ссылок на несуществующий релиз', обратные, artists.length + labels.length, 'поломка',
  ({ x, id }) => `${x.name} → ${id}`
);

заголовок('Файлы');
const обложки = new Set((await listDir('public/covers')).map((f) => f.replace(/-\d+\.\w+$/, '')));
const кадры = new Set((await listDir('public/videos')).map((f) => f.replace(/-\d+\.\w+$/, '')));

пункт(
  'обложек не скачано', albums.filter((a) => { const id = coverId(a.cover); return id && !обложки.has(id); }),
  albums.length, 'поломка', подпись
);
пункт(
  'кадров не скачано', videos.filter((v) => { const id = videoId(v.url); return id && !кадры.has(id); }),
  videos.length, 'поломка', (v) => v.title
);

заголовок('Повторы и даты');
function повторы(список, ключ) {
  const по = new Map();
  for (const x of список) {
    const k = String(x[ключ] ?? '').toLowerCase().trim();
    if (!k) continue;
    по.set(k, (по.get(k) ?? 0) + 1);
  }
  return [...по.entries()].filter(([, n]) => n > 1).map(([k, n]) => ({ k, n }));
}
const строка = ({ k, n }) => `${k} ×${n}`;
пункт('исполнителей с одинаковым именем', повторы(artists, 'name'), artists.length, 'поломка', строка);
пункт('лейблов с одинаковым именем', повторы(labels, 'name'), labels.length, 'поломка', строка);
пункт('релизов с одинаковым адресом', повторы(albums, 'slug'), albums.length, 'поломка', строка);

const сегодня = new Date().toISOString().slice(0, 10);
пункт(
  'дата выхода в будущем', albums.filter((a) => a.released && a.released > сегодня),
  albums.length, 'пропуск', (a) => `${подпись(a)} — ${a.released}`
);
пункт(
  'год расходится с датой', albums.filter((a) => a.released && a.year && Number(a.released.slice(0, 4)) !== a.year),
  albums.length, 'поломка', (a) => `${подпись(a)} — ${a.released} против ${a.year}`
);

/* --------------------------------------------------------------- итог */

console.log('');
if (поломок === 0 && пропусков === 0) {
  console.log('всё на месте');
} else {
  console.log(`пропусков в базе: ${пропусков}, поломок: ${поломок}`);
  if (поломок > 0) console.log('поломки помечены «!!» — их правят руками в Notion');
}

if (strict && поломок > 0) process.exit(1);
