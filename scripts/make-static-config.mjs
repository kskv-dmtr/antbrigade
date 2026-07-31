/* Кладёт в dist собственный vercel.json — для случая, когда сборка
   загружается на Vercel как готовая статика (Vercel Drop или загрузка папки).

   Корневой vercel.json для этого не подходит: в нём указаны фреймворк и
   команда сборки, а в dist нет package.json — Vercel попробует собрать и
   упадёт. Поэтому оставляем только то, что влияет на раздачу файлов.

   Запускается автоматически после npm run build (скрипт postbuild). */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const source = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));

// ключи, которые имеют смысл для уже собранной статики
const RUNTIME_KEYS = ['headers', 'redirects', 'rewrites', 'trailingSlash', 'cleanUrls'];

const config = {};
for (const key of RUNTIME_KEYS) {
  if (key in source) config[key] = source[key];
}

const target = path.join(root, 'dist', 'vercel.json');
await writeFile(target, JSON.stringify(config, null, 2) + '\n', 'utf8');

console.log(`dist/vercel.json записан (${Object.keys(config).join(', ')})`);
