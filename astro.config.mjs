import { defineConfig } from 'astro/config';

export default defineConfig({
  // Адрес, по которому сайт реально открывается: отсюда берутся канонические
  // ссылки. Имя проекта на Vercel должно совпадать с поддоменом.
  // Когда появится свой домен — поменять здесь и пересобрать.
  //
  // Хостинг на Vercel, а не на Cloudflare Pages, по одной причине: домен
  // *.pages.dev недоступен из России, тогда как *.vercel.app открывается.
  site: 'https://antbrigade.vercel.app',
  build: { format: 'directory' },
  devToolbar: { enabled: false }
});
