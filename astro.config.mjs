import { defineConfig } from 'astro/config';

export default defineConfig({
  // Адрес, по которому сайт реально открывается: отсюда берутся канонические
  // ссылки.
  //
  // Именно с www: голый antbrigade.fun отдаёт 308 на www-версию, и без
  // приставки каждая из 2842 страниц объявляла бы каноническим адрес,
  // который тут же переправляет обратно. Если в Vercel основным сделают
  // голый домен — поменять здесь и пересобрать.
  //
  // Хостинг на Vercel, а не на Cloudflare Pages, по одной причине: домен
  // *.pages.dev недоступен из России, тогда как *.vercel.app открывается.
  site: 'https://www.antbrigade.fun',
  // адреса без слеша в конце: /albums/artist-title, а не /albums/artist-title/
  build: { format: 'file' },
  trailingSlash: 'never',
  devToolbar: { enabled: false }
});
