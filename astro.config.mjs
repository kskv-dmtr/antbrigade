import { defineConfig } from 'astro/config';

export default defineConfig({
  // Адрес, по которому сайт реально открывается: отсюда берутся канонические
  // ссылки. Имя проекта на Vercel должно совпадать с поддоменом.
  // Когда появится свой домен — поменять здесь и пересобрать.
  //
  // Хостинг на Vercel, а не на Cloudflare Pages, по одной причине: домен
  // *.pages.dev недоступен из России, тогда как *.vercel.app открывается.
  site: 'https://antbrigade.vercel.app',
  // адреса без слеша в конце: /albums/artist-title, а не /albums/artist-title/
  build: { format: 'file' },
  trailingSlash: 'never',
  devToolbar: { enabled: false }
});
