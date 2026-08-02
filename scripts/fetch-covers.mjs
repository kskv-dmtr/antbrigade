/* Скачивает обложки из Notion и раскладывает их в public/covers/ как webp.
 *
 * Зачем: иначе картинки грузятся с серверов Notion, и сайт зависит от их
 * доступности. Плюс адреса Notion огромные и раздувают HTML.
 *
 * Имя файла — идентификатор вложения из Notion. Он не меняется, пока не
 * заменили саму картинку, поэтому служит и ключом кэша: уже скачанное
 * повторно не качается.
 *
 * Запуск:
 *   node scripts/fetch-covers.mjs            скачать недостающее
 *   node scripts/fetch-covers.mjs --check    только сказать, есть ли работа
 *   node scripts/fetch-covers.mjs --limit 10 ограничить (для проверки)
 *
 * sharp подключается динамически: в режиме --check зависимости не нужны.
 */

import { readFile, readdir, mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { coverId } from '../src/lib/cover-id.js';

// 400 — карточка в сетке (она рисуется примерно в 200 CSS-пикселей, то есть это
// уже ретина), 800 — обложка на странице релиза. Качество 74: от 80 на глаз
// не отличается, а весит на пятую часть меньше.
const SIZES       = [400, 800];
const SOURCE_W    = 1200;        // что просим у Notion — исходник примерно такой
const QUALITY     = 74;
const CONCURRENCY = 6;

const root    = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataFile = path.join(root, 'data', 'albums.json');
const outDir   = path.join(root, 'public', 'covers');

const args  = process.argv.slice(2);
const check = args.includes('--check');
const limitArg = args.indexOf('--limit');
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;

const fileFor = (id, size) => path.join(outDir, `${id}-${size}.webp`);

async function listExisting() {
  try {
    return new Set(await readdir(outDir));
  } catch {
    return new Set();
  }
}

async function main() {
  const data = JSON.parse(await readFile(dataFile, 'utf8'));
  await mkdir(outDir, { recursive: true });
  const existing = await listExisting();

  // что нужно иметь
  const wanted = new Map();          // id -> исходный адрес
  for (const album of data.albums) {
    const id = coverId(album.cover);
    if (id && !wanted.has(id)) wanted.set(id, album.cover);
  }

  const missing = [...wanted.entries()].filter(([id]) =>
    SIZES.some((s) => !existing.has(path.basename(fileFor(id, s))))
  );

  // файлы обложек, которых больше нет ни у одного альбома
  const orphans = [...existing].filter((name) => {
    const m = name.match(/^(.+)-\d+\.webp$/);
    return m && !wanted.has(m[1]);
  });

  console.log(`обложек в базе:   ${wanted.size}`);
  console.log(`уже скачано:      ${wanted.size - missing.length}`);
  console.log(`нужно скачать:    ${missing.length}`);
  if (orphans.length) console.log(`лишних файлов:    ${orphans.length}`);

  if (check) {
    const work = missing.length > 0 || orphans.length > 0;
    console.log(work ? 'РАБОТА ЕСТЬ' : 'всё на месте');
    if (process.env.GITHUB_OUTPUT) {
      await writeFile(process.env.GITHUB_OUTPUT, `covers_needed=${work}\n`, { flag: 'a' });
    }
    return;
  }

  for (const name of orphans) {
    await unlink(path.join(outDir, name));
  }
  if (orphans.length) console.log(`удалено лишних:   ${orphans.length}`);

  const todo = missing.slice(0, limit);
  if (todo.length === 0) {
    console.log('скачивать нечего');
    return;
  }

  const { default: sharp } = await import('sharp');

  let done = 0;
  let failed = 0;
  let bytes = 0;

  async function handle([id, url]) {
    const source = url.replace(/([?&])width=\d+/, `$1width=${SOURCE_W}`);
    try {
      const res = await fetch(source);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const input = Buffer.from(await res.arrayBuffer());

      for (const size of SIZES) {
        // withoutEnlargement: часть исходников меньше 800 px, и растягивание
        // их только утяжеляет файл, не добавляя ни пикселя детализации
        const out = await sharp(input)
          .resize(size, size, { fit: 'cover', position: 'centre', withoutEnlargement: true })
          .webp({ quality: QUALITY })
          .toBuffer();
        await writeFile(fileFor(id, size), out);
        bytes += out.length;
      }
      done++;
      if (done % 100 === 0) console.log(`  ...${done} из ${todo.length}`);
    } catch (err) {
      failed++;
      console.warn(`  не удалось ${id}: ${err.message}`);
    }
  }

  // простой пул: несколько параллельных обработчиков разбирают общую очередь
  const queue = todo.slice();
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length) await handle(queue.shift());
    })
  );

  console.log('');
  console.log(`готово:  ${done}`);
  if (failed) console.log(`ошибок:  ${failed}`);
  console.log(`записано: ${(bytes / 1024 / 1024).toFixed(1)} MB`);
}

await main();
