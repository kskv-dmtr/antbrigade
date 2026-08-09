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
  /* Раздел каталога переехал с /releases на /music. Правило здесь — не
     единственное: настоящий 308 отдаёт Vercel по vercel.json. Астровский
     редирект нужен на случай, когда его правила не читают: в локальной
     разработке и при раздаче той же папки с Cloudflare Pages, куда ведёт
     запасной deploy-скрипт. Он кладёт в сборку страницу-перенаправление с
     meta refresh — медленнее 308-го, но лучше 404. */
  redirects: { '/releases': '/music' },

  // адреса без слеша в конце: /albums/artist-title, а не /albums/artist-title/
  build: { format: 'file' },
  trailingSlash: 'never',
  devToolbar: { enabled: false }
});
