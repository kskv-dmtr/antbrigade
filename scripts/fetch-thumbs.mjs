/* Скачивает кадры роликов с YouTube и раскладывает их в public/videos/ как webp.
 *
 * Зачем локально, а не ссылкой на i.ytimg.com: YouTube в России режут, и кадры
 * не открылись бы ровно у той аудитории, ради которой сайт стоит на Vercel, а
 * не на Cloudflare Pages. Плюс это то же правило, что и с обложками, — никаких
 * внешних CDN в готовой странице.
 *
 * Имя файла — идентификатор ролика. Он не меняется, поэтому служит и ключом
 * кэша: уже скачанное повторно не качается.
 *
 * Запуск:
 *   node scripts/fetch-thumbs.mjs            скачать недостающее
 *   node scripts/fetch-thumbs.mjs --check    только сказать, есть ли работа
 *   node scripts/fetch-thumbs.mjs --limit 5  ограничить (для проверки)
 *
 * sharp подключается динамически: в режиме --check зависимости не нужны.
 */

import { readFile, readdir, mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { videoId } from '../src/lib/video-id.js';

/* Ширины: 480 — плитка в сетке (она рисуется примерно в 225 CSS-пикселей, то
   есть уже ретина), 960 — запас на широкие экраны. Высота считается из 16:9.

   Источники перебираются по убыванию качества. maxresdefault есть не у всех
   роликов, поэтому за ним идут запасные. У hq и sd кадр 4:3 с чёрными полями
   сверху и снизу — их срезает fit: 'cover' при приведении к 16:9, ровно по
   границе полей. */
const WIDTHS      = [480, 960];
const RATIO       = 9 / 16;
const SOURCES     = ['maxresdefault', 'sddefault', 'hqdefault'];
const QUALITY     = 74;
const CONCURRENCY = 4;

const root     = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataFile = path.join(root, 'data', 'albums.json');
const outDir   = path.join(root, 'public', 'videos');

const args  = process.argv.slice(2);
const check = args.includes('--check');
const limitArg = args.indexOf('--limit');
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;

const fileFor = (id, width) => path.join(outDir, `${id}-${width}.webp`);

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
  const wanted = new Set();
  let skipped = 0;
  for (const video of data.videos ?? []) {
    const id = videoId(video.url);
    if (id) wanted.add(id);
    else skipped++;
  }

  const missing = [...wanted].filter((id) =>
    WIDTHS.some((w) => !existing.has(path.basename(fileFor(id, w))))
  );

  // файлы кадров, которых больше нет ни у одного ролика
  const orphans = [...existing].filter((name) => {
    const m = name.match(/^(.+)-\d+\.webp$/);
    return m && !wanted.has(m[1]);
  });

  console.log(`роликов в базе:   ${wanted.size}`);
  console.log(`уже скачано:      ${wanted.size - missing.length}`);
  console.log(`нужно скачать:    ${missing.length}`);
  if (skipped) console.log(`не с YouTube:     ${skipped}`);
  if (orphans.length) console.log(`лишних файлов:    ${orphans.length}`);

  if (check) {
    const work = missing.length > 0 || orphans.length > 0;
    console.log(work ? 'РАБОТА ЕСТЬ' : 'всё на месте');
    if (process.env.GITHUB_OUTPUT) {
      await writeFile(process.env.GITHUB_OUTPUT, `thumbs_needed=${work}\n`, { flag: 'a' });
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

  /* Заглушку YouTube отдаёт со статусом 200: для отсутствующего maxresdefault
     это серый кадр 120×90. Поэтому проверяем не только код ответа. */
  async function grab(id) {
    for (const name of SOURCES) {
      const res = await fetch(`https://i.ytimg.com/vi/${id}/${name}.jpg`);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const meta = await sharp(buf).metadata();
      if (meta.width >= 320) return buf;
    }
    return null;
  }

  async function handle(id) {
    try {
      const input = await grab(id);
      if (!input) throw new Error('кадр не отдан ни одним из адресов');

      for (const width of WIDTHS) {
        // withoutEnlargement: у части роликов исходник только 480 px, и
        // растягивание до 960 лишь утяжеляет файл, не добавляя детализации
        const out = await sharp(input)
          .resize(width, Math.round(width * RATIO), {
            fit: 'cover',
            position: 'centre',
            withoutEnlargement: true
          })
          .webp({ quality: QUALITY })
          .toBuffer();
        await writeFile(fileFor(id, width), out);
        bytes += out.length;
      }
      done++;
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
  console.log(`объём:   ${(bytes / 1024 / 1024).toFixed(1)} МБ`);
}

main();
