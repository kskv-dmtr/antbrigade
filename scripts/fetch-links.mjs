/* Собирает ссылки на площадки для каждого релиза и складывает в data/links.json.
 *
 * Источник — страницы album.link, на которые уже ведут все записи в Notion.
 * Внутри каждой лежит готовый JSON со ссылками; забираем его целиком, а
 * показывать будем только нужные площадки.
 *
 * Результат кэшируется по идентификатору релиза: повторно ходим только за
 * новыми и за теми, у кого поменялся адрес album.link.
 *
 * Чего здесь нет и не будет:
 *   Apple Music и YouTube — Odesli их для этого каталога не отдаёт вовсе,
 *     проверено и через страницу, и через официальный API, и с userCountry=RU.
 *   Звук — zvuk.com отвечает 418 на любые автоматические запросы.
 *     Ссылка на поиск в нём строится на сайте, без обращения к сервису.
 *
 * Запуск:
 *   node scripts/fetch-links.mjs           добрать недостающее
 *   node scripts/fetch-links.mjs --check   только сказать, есть ли работа
 *   node scripts/fetch-links.mjs --limit 20
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* album.link при потоке запросов отвечает «пустышкой»: код 200, разметка на
   месте, а ссылки на площадки не подставлены. Отличить это от честного «у
   релиза нет площадок» по одному ответу нельзя, поэтому:
     - идём медленно;
     - пустой ответ не считаем результатом, а откладываем на следующий раз;
     - если пусто подряд несколько раз — надолго замолкаем;
     - за один прогон берём ограниченную порцию, остальное доберут следующие. */
const DELAY        = 2500;
const MAX_PER_RUN  = 250;
const EMPTY_STREAK = 5;      // столько пустых подряд — и делаем паузу
const COOLDOWN     = 90_000;
const GIVE_UP_AT   = 3;      // после стольких попыток считаем, что площадок правда нет
const UA           = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

const root     = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataFile = path.join(root, 'data', 'albums.json');
const outFile  = path.join(root, 'data', 'links.json');

const args  = process.argv.slice(2);
const check = args.includes('--check');
const limitAt = args.indexOf('--limit');
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity;

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Достаёт из страницы album.link все ссылки на площадки и данные о релизе. */
function parsePage(html) {
  const raw = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (!raw) throw new Error('на странице нет данных');
  const page = JSON.parse(raw[1]).props?.pageProps?.pageData;
  if (!page) throw new Error('неожиданная структура страницы');

  const platforms = {};
  for (const section of page.sections ?? []) {
    for (const link of section.links ?? []) {
      if (link.url) platforms[link.platform] = link.url;
    }
  }

  const entity = page.entityData ?? {};
  return {
    platforms,
    upc: entity.upc ?? null,
    tracks: entity.numTracks ?? null,
    releaseDate: entity.releaseDate
      ? [entity.releaseDate.year, entity.releaseDate.month, entity.releaseDate.day]
          .filter(Boolean).map((n) => String(n).padStart(2, '0')).join('-')
      : null
  };
}

async function main() {
  const data = await readJson(dataFile, null);
  if (!data) throw new Error('нет data/albums.json — сначала npm run sync');

  const cache = await readJson(outFile, { generatedAt: null, links: {} });

  const needsWork = (album) => {
    if (!album.url) return false;
    const known = cache.links[album.id];
    if (!known || known.source !== album.url) return true;
    // пусто — возможно, нас просто придержали; пробуем ещё, но не бесконечно
    return Object.keys(known.platforms).length === 0 && (known.attempts ?? 0) < GIVE_UP_AT;
  };

  const todo = data.albums.filter(needsWork);
  const collected = Object.values(cache.links).filter((v) => Object.keys(v.platforms).length > 0).length;

  console.log(`релизов:        ${data.albums.length}`);
  console.log(`со ссылками:    ${collected}`);
  console.log(`нужно забрать:  ${todo.length}`);

  if (check) {
    const work = todo.length > 0;
    console.log(work ? 'РАБОТА ЕСТЬ' : 'всё на месте');
    if (process.env.GITHUB_OUTPUT) {
      await writeFile(process.env.GITHUB_OUTPUT, `links_needed=${work}\n`, { flag: 'a' });
    }
    return;
  }

  const batch = todo.slice(0, Math.min(limit, MAX_PER_RUN));
  if (batch.length === 0) {
    console.log('забирать нечего');
    return;
  }
  if (todo.length > batch.length) {
    console.log(`за этот прогон возьмём ${batch.length}, остальное — в следующий раз`);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const started = Date.now();
  let got = 0;
  let blank = 0;
  let failed = 0;
  let streak = 0;

  for (const [i, album] of batch.entries()) {
    try {
      const res = await fetch(album.url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = parsePage(await res.text());
      const previous = cache.links[album.id];

      if (Object.keys(parsed.platforms).length > 0) {
        cache.links[album.id] = { source: album.url, ...parsed };
        got++;
        streak = 0;
      } else {
        // не перетираем то, что раньше удалось собрать
        cache.links[album.id] = previous?.platforms && Object.keys(previous.platforms).length
          ? previous
          : { source: album.url, ...parsed, attempts: (previous?.attempts ?? 0) + 1 };
        blank++;
        streak++;
      }
    } catch (err) {
      failed++;
      streak++;
      console.warn(`  ${album.artist} — ${album.album}: ${err.message}`);
    }

    if ((i + 1) % 50 === 0) {
      console.log(`  ...${i + 1} из ${batch.length}   собрано ${got}, пусто ${blank}`);
    }

    if (streak >= EMPTY_STREAK) {
      console.log(`  ${streak} пустых подряд — пауза ${COOLDOWN / 1000} с`);
      await sleep(COOLDOWN);
      streak = 0;
    } else {
      await sleep(DELAY);
    }
  }

  // подчистим записи релизов, которых больше нет в базе
  const alive = new Set(data.albums.map((a) => a.id));
  let dropped = 0;
  for (const id of Object.keys(cache.links)) {
    if (!alive.has(id)) { delete cache.links[id]; dropped++; }
  }

  cache.generatedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(cache, null, 2), 'utf8');

  // сводка по покрытию — сразу видно, что вообще есть смысл показывать
  const counts = {};
  for (const entry of Object.values(cache.links)) {
    for (const platform of Object.keys(entry.platforms)) {
      counts[platform] = (counts[platform] ?? 0) + 1;
    }
  }
  const total = data.albums.length;
  const withLinks = Object.values(cache.links).filter((v) => Object.keys(v.platforms).length > 0).length;

  console.log('');
  console.log(`собрано: ${got}, пусто: ${blank}, ошибок: ${failed}, за ${Math.round((Date.now() - started) / 60000)} мин`);
  if (dropped) console.log(`удалено записей исчезнувших релизов: ${dropped}`);
  console.log(`\nвсего со ссылками: ${withLinks} из ${total} (${Math.round((withLinks / total) * 100)}%)`);
  for (const [platform, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${platform.padEnd(14)} ${String(count).padStart(4)}   ${Math.round((count / total) * 100)}%`);
  }
}

await main();
