/* Собирает dist/sitemap.xml по готовой сборке.
 *
 * Своим скриптом, а не готовой интеграцией, по двум причинам. Первая —
 * зависимость ради тридцати строк: у проекта их всего три, и все шрифтовые.
 * Вторая важнее: сборка идёт с format: 'file', адреса внутри живут с
 * расширением (/artists.html), а наружу Vercel отдаёт их без него. Собирая
 * список из настоящих файлов, мы срезаем расширение сами и получаем ровно те
 * адреса, которые объявлены каноническими на самих страницах. Разойтись
 * им негде.
 *
 * Запускается после сборки, вместе с make-static-config (скрипт postbuild).
 */

import { readdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://www.antbrigade.fun';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');

/* Страницы, которым в карте не место.

   releases.html — перенаправление со старого адреса каталога: помечено
   noindex и существует только ради тех, кто придёт по ссылке из прошлого.

   404.html — страница промаха. Приглашать поисковика по адресу, который
   хостинг отдаёт с кодом 404, — верный способ получить в отчёте ошибку
   вместо страницы. */
const SKIP = new Set(['releases.html', '404.html']);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const files = await walk(dist);

const urls = files
  .map((file) => path.relative(dist, file).split(path.sep).join('/'))
  .filter((rel) => !SKIP.has(rel))
  .map((rel) => (rel === 'index.html' ? '/' : '/' + rel.replace(/\.html$/, '')))
  .sort();

/* Дата берётся у самой свежей страницы, а не у каждой отдельно: сайт
   пересобирается целиком каждый час, и у всех файлов время будет одно.
   Обещать поисковику, что каждая из 2900 страниц изменилась час назад, —
   ровно тот случай, когда карту перестают принимать всерьёз. */
const времена = await Promise.all(files.map(async (f) => (await stat(f)).mtime));
const свежая = new Date(Math.max(...времена)).toISOString().slice(0, 10);

const xml =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map((u) => `  <url><loc>${SITE}${u}</loc><lastmod>${свежая}</lastmod></url>`).join('\n') +
  '\n</urlset>\n';

await writeFile(path.join(dist, 'sitemap.xml'), xml, 'utf8');
console.log(`dist/sitemap.xml записан: ${urls.length} адресов, дата ${свежая}`);
