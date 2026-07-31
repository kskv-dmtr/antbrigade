/* Нарезает иконки приложения из исходного квадратного PNG.
   Запуск: node scripts/make-icons.mjs <путь-к-исходнику>
   Исходник — иконка базы из Notion, 1024x1024. */

import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'public', 'icons');
const src = process.argv[2];

if (!src) {
  console.error('Укажите путь к исходному PNG');
  process.exit(1);
}

await mkdir(out, { recursive: true });

const image = sharp(src);
const meta = await image.metadata();

// цвет фона берём из угла — он же пойдёт в theme_color манифеста
const corner = await sharp(src).extract({ left: 4, top: 4, width: 1, height: 1 }).raw().toBuffer();
const bg = { r: corner[0], g: corner[1], b: corner[2] };
const hex = '#' + [bg.r, bg.g, bg.b].map((v) => v.toString(16).padStart(2, '0')).join('');

console.log(`исходник: ${meta.width}x${meta.height}, фон ${hex}`);

/** Обычная иконка — исходник во всю площадь. */
async function plain(size, name) {
  await sharp(src).resize(size, size, { fit: 'cover' }).png({ compressionLevel: 9 }).toFile(path.join(out, name));
  return name;
}

/** Maskable — систему интересует только внутренние 80%, поэтому логотип
    ужимаем до 60% и кладём по центру на тот же фон. */
async function maskable(size, name) {
  const inner = Math.round(size * 0.6);
  const logo = await sharp(src).resize(inner, inner, { fit: 'contain', background: bg }).toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: { ...bg, alpha: 1 } }
  })
    .composite([{ input: logo, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(out, name));
  return name;
}

const made = [];
made.push(await plain(192, 'icon-192.png'));
made.push(await plain(512, 'icon-512.png'));
made.push(await plain(180, 'apple-touch-icon.png'));
made.push(await plain(32, 'favicon-32.png'));
made.push(await maskable(512, 'icon-maskable-512.png'));

console.log('готово:', made.join(', '));
console.log(`theme_color: ${hex} — проверьте, что он совпадает с manifest.webmanifest`);
