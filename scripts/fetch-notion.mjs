/* Выгружает базы из публичной страницы Notion в data/albums.json.
 *
 * Токен не нужен: страница опубликована, читаем её публичный API.
 * ВНИМАНИЕ: API неофициальный. Контракт не гарантирован — см. README.
 *
 * Зависимостей нет намеренно: скрипт запускается в CI до npm ci.
 *
 * Запуск: node scripts/fetch-notion.mjs
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST       = 'antbrigade.notion.site';
const SPACE_ID   = '1e3c4611-6308-45b6-9689-17bda8d4252b';
const COVER_W    = 400;   // Notion сам ресайзит по этому параметру
const PAGE_CAP   = 900;   // за один запрос Notion отдаёт максимум ~999 записей

const ALBUMS  = { collection: '34c2f3cb-ea8e-4b53-904a-f8905700fb68',
                  view:       'a705673c-7ed4-4892-87c4-56efc3c496cf' };
// bandcamp — ключ необязательного свойства со ссылкой, у каждой базы свой
/* Ключей website здесь больше нет: колонку убрали из обеих баз 5 сентября
   2026. Были '=Mzn' у артистов и 'H>J[' у лейблов — на случай, если
   вернут. Ссылки стояли у трёх артистов и девяти лейблов. */
const ARTISTS = { collection: '2404129a-8c52-8081-a2ac-000b601ac278',
                  view:       '2404129a-8c52-80e5-9e5b-000c523112d0',
                  bandcamp:   'XmmI',
                  youtube:    'drlg' };
/* У лейбла две колонки Bandcamp: «Bandcamp [1]» и «Bandcamp [2]». Вторая
   заведена 6 сентября 2026 — у части лейблов страниц на площадке две, как у
   XL Recordings: xlrecordings и xlrecordingsuk. У артистов колонка одна. */
const LABELS  = { collection: '2434129a-8c52-80b6-b09f-000b54c58818',
                  view:       '2434129a-8c52-8093-b25e-000c16690aea',
                  bandcamp:   'Wd@^',
                  bandcamp2:  ']Ze:',
                  youtube:    'imKP' };
const VIDEOS  = { collection: '4f18cb0c-58c5-4133-a7f1-19b7404509b4',
                  view:       'c75789fc-bfcd-411b-8af0-ec90855f2459' };

// Ключи свойств в схемах коллекций. Получены из схемы, не менять.
const P  = { label: '=\\[V', date: 'PNct', artist: 'Y\\kC',
             url: ']]HZ', genre: 'yEPm', type: '}j]w', origDate: 'IEKZ',
             playlists: 'Hfn}' };

/* Подборка, попадание в которую показывает /featured. Имя лежит здесь, а не
   в разметке страницы: в Notion это одно из значений колонки Playlists, и
   переименуют его там, а не в коде. */
const FEATURED = 'Featured';
/* Ключи свойств в таблице клипов. Ключ даты здесь свой, LStn: колонка
   «Release Date» заведена заново 29 августа 2026, и прежний ключ она не
   унаследовала. Читать вместо неё P.date нельзя — под тем ключом в строках
   лежат осиротевшие значения от удалённой когда-то колонки: в интерфейсе
   Notion их не видно и не поправить. */
const PV = { url: ']]HZ', artist: 'kaf]', type: '}j]w', date: 'LStn', origDate: 's^=g' };

const root    = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outFile = path.join(root, 'data', 'albums.json');

// ---------------------------------------------------------------- сеть

async function api(endpoint, body, attempt = 1) {
  try {
    const res = await fetch(`https://${HOST}/api/v3/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`${endpoint} вернул ${res.status}`);
    return await res.json();
  } catch (err) {
    // сетевые сбои в CI не редкость — пробуем ещё пару раз
    if (attempt >= 3) throw err;
    await new Promise((r) => setTimeout(r, attempt * 1500));
    return api(endpoint, body, attempt + 1);
  }
}

async function queryCollection({ collection, view }, filter = null, sort = null) {
  const loader = {
    type: 'reducer',
    reducers: { collection_group_results: { type: 'results', limit: 5000 } },
    searchQuery: '',
    userTimeZone: 'Europe/Moscow'
  };
  if (filter) loader.filter = filter;
  if (sort) loader.sort = sort;

  const res = await api('queryCollection?src=sync', {
    source: { type: 'collection', id: collection, spaceId: SPACE_ID },
    collectionView: { id: view, spaceId: SPACE_ID },
    loader
  });

  return {
    ids: res.result?.reducerResults?.collection_group_results?.blockIds ?? [],
    blocks: res.recordMap?.block ?? {}
  };
}

/** Складывает строки нужной коллекции в общий словарь. */
function collect(store, blocks, parentId) {
  for (const raw of Object.values(blocks)) {
    const v = raw?.value?.value ?? raw?.value;
    if (!v || v.parent_id !== parentId || v.alive === false) continue;
    store.set(v.id, v);
  }
}

function dateFilter(from, to) {
  const clause = (operator, value) => ({
    property: P.date,
    filter: { operator, value: { type: 'exact', value: { type: 'date', start_date: value } } }
  });
  return { operator: 'and', filters: [clause('date_is_on_or_after', from), clause('date_is_before', to)] };
}

const iso = (d) => d.toISOString().slice(0, 10);

/** Делит диапазон дат пополам, пока в него влезает меньше PAGE_CAP записей. */
async function fetchRange(store, from, to, depth = 0) {
  const res = await queryCollection(ALBUMS, dateFilter(iso(from), iso(to)));

  if (res.ids.length < PAGE_CAP || depth >= 12) {
    collect(store, res.blocks, ALBUMS.collection);
    console.log(`  ${iso(from)} .. ${iso(to)}  -> ${res.ids.length}`);
    return;
  }

  const mid = new Date(from.getTime() + Math.floor((to - from) / 2));
  if (mid <= from || mid >= to) {
    collect(store, res.blocks, ALBUMS.collection);
    return;
  }
  await fetchRange(store, from, mid, depth + 1);
  await fetchRange(store, mid, to, depth + 1);
}

// -------------------------------------------------------------- разбор

/** Значение свойства — массив сегментов [["текст", [декорации]], ...]. */
const segments = (value) => (Array.isArray(value) ? value : []);

function plainText(value) {
  return segments(value).map((seg) => (Array.isArray(seg) ? seg[0] ?? '' : seg)).join('').trim();
}

/** Дата лежит в декорации: [["‣", [["d", {start_date: "2025-07-11"}]]]] */
function dateStart(value) {
  for (const seg of segments(value)) {
    for (const dec of segments(seg?.[1])) {
      if (dec?.[0] === 'd') return dec[1]?.start_date ?? null;
    }
  }
  return null;
}

/* Год оригинального издания. Колонка Original Release Date у релизов стала
   списком (select) 5 сентября 2026: полная дата оригинала ничего не давала
   сверх года, а вводить её руками приходилось целиком.

   Читаем оба вида. Значения, введённые после смены типа, приходят обычным
   текстом — «1989». У строк, заполненных до неё, под тем же ключом остался
   осиротевший date: Notion тип колонки поменял, а payload в строках нет, и
   в интерфейсе этих значений уже не видно. Такие берём по году из даты —
   иначе plainText вернул бы «‣», значок ссылки на дату.

   Всё, что не год из четырёх цифр, отбрасываем: колонка заполняется
   руками, и описка лучше видна пустым местом, чем строкой посреди
   справки. */
function yearValue(value) {
  const дата = dateStart(value);
  if (дата) return дата.slice(0, 4);
  const текст = plainText(value);
  return /^\d{4}$/.test(текст) ? текст : null;
}

/** Relation хранит id связанных страниц в декорации ["p", <pageId>, <spaceId>] */
/* Повторы убираем здесь: в Notion одну и ту же страницу случается выбрать в
   связи дважды, и заметить это в интерфейсе трудно — чипсы стоят рядом и
   выглядят одинаково. Наружу это выходило удвоенным именем: у клипа
   «Mount Kimbie / King Krule» исполнитель значился как
   «Mount Kimbie · King Krule · Mount Kimbie». Второй раз связь ничего не
   добавляет, поэтому и в данных ей делать нечего. */
function relationIds(value) {
  const ids = new Set();
  for (const seg of segments(value)) {
    for (const dec of segments(seg?.[1])) {
      if (dec?.[0] === 'p' && dec[1]) ids.add(dec[1]);
    }
  }
  return [...ids];
}

const prop = (props, key) => props?.[key] ?? null;

/** Иконки артистов и лейблов — флаги стран. Достаём из них ISO-код. */
function countryCode(icon) {
  if (!icon) return null;
  let code = '';
  for (const ch of icon) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x1f1e6 && cp <= 0x1f1ff) code += String.fromCharCode(65 + cp - 0x1f1e6);
  }
  return code.length === 2 ? code : null;
}

/* Названия, из которых адрес сам собой не получается: одни знаки препинания,
   нелатинские алфавиты и тому подобное. Ключ — точное название из Notion.
   Список пополняется вручную, случаев такого рода единицы. */
const SLUG_OVERRIDES = {
  '!!!': 'chk-chk-chk'
};

/** Чистая часть адреса — без хвоста, только из названия. */
function baseSlug(text) {
  let s = String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length > 60) s = s.slice(0, 60).replace(/^-+|-+$/g, '');
  return s;
}

/* Раздаёт адреса всему списку сразу: иначе не узнать, что кто-то занял тот же.
   Совпадения бывают редко и обычно означают дубликат записи в Notion —
   тогда второму достаётся суффикс. Порядок задаём по id, чтобы адреса не
   перетасовывались от выгрузки к выгрузке.
   Названия без единой латинской буквы (например «!!!») своего адреса не дают,
   для них берём хвост идентификатора. */
function assignSlugs(items, textOf) {
  const taken = new Set();
  const ordered = [...items].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const slugs = new Map();

  for (const item of ordered) {
    const raw = textOf(item);
    const base = SLUG_OVERRIDES[raw]
      ?? (baseSlug(raw) || String(item.id).replace(/-/g, '').slice(0, 8));
    let slug = base;
    let n = 2;
    while (taken.has(slug)) slug = `${base}-${n++}`;
    taken.add(slug);
    slugs.set(item.id, slug);
  }
  return slugs;
}

/* Через прокси Notion идут все иконки, а не только вложения: у части записей
   иконка задана прямой ссылкой на хранилище, и та отдаёт 403 — картинка
   ломается. Прокси отдаёт и такие, заодно уменьшая до нужной ширины. */
function coverUrl(v) {
  const icon = v.format?.page_icon;
  if (!icon) return null;
  // у артистов и лейблов иконка — эмодзи-флаг, картинки там нет
  if (!icon.startsWith('attachment:') && !icon.startsWith('http')) return null;
  return `https://${HOST}/image/${encodeURIComponent(icon)}` +
         `?table=block&id=${v.id}&spaceId=${SPACE_ID}&width=${COVER_W}&cache=v2`;
}

const splitList = (raw) => (raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : []);

/* Сортировки обязаны быть детерминированными: иначе выгрузка при одинаковых
   данных даёт разный порядок, а автоматика в CI коммитит пустые изменения.
   Локаль задана явно — сравнение по умолчанию зависит от системной, и на
   раннере получилось бы иначе, чем на машине разработчика. Во всех сортировках
   последним ключом идёт id, чтобы ничьих не оставалось вовсе. */
const collator = new Intl.Collator('en', { sensitivity: 'variant' });
const cmp = (a, b) => collator.compare(a, b);

// ------------------------------------------------------------ выгрузка

/* Справочник целиком, в обход потолка в тысячу строк.

   Notion отдаёт список id полностью, а сами записи — не больше тысячи за
   запрос. Пока артистов было меньше, это не замечалось; 31 августа 2026 их
   стало 1010, и десять последних молча перестали попадать в выгрузку —
   вместе со своими страницами и ссылками с релизов.

   Берём тем же запросом в обратном порядке и складываем: тысяча с начала
   плюс тысяча с конца перекрывают всё, пока в справочнике меньше двух
   тысяч строк. Дальше середина снова начнёт теряться, поэтому ниже стоит
   проверка — она не даст этому случиться тихо. */
async function fullCollection(source) {
  const res = await queryCollection(source);
  const store = new Map();
  collect(store, res.blocks, source.collection);

  if (store.size < res.ids.length) {
    const назад = await queryCollection(source, null, [{ property: 'title', direction: 'descending' }]);
    collect(store, назад.blocks, source.collection);
  }
  return { store, total: res.ids.length };
}

async function directory(source, label) {
  const { store, total } = await fullCollection(source);

  const dir = new Map();
  let withBandcamp = 0;
  for (const v of store.values()) {
    const name = plainText(prop(v.properties, 'title'));
    if (!name) continue;
    /* Поля заполняются вручную и у большинства записей пустые. Ключи у
       каждой базы свои: у одной и той же по имени колонки они разные, и
       брать чужой нельзя — свойство просто не найдётся. Отсюда проверка
       source.<поле>: пока колонки в базе нет, ключа в описании тоже нет. */
    const bandcamp  = source.bandcamp  ? plainText(prop(v.properties, source.bandcamp))  : '';
    const bandcamp2 = source.bandcamp2 ? plainText(prop(v.properties, source.bandcamp2)) : '';
    const youtube   = source.youtube   ? plainText(prop(v.properties, source.youtube))   : '';
    if (bandcamp) withBandcamp++;
    dir.set(v.id, {
      id: v.id,
      name,
      country: countryCode(v.format?.page_icon),
      bandcamp: bandcamp || null,
      bandcamp2: bandcamp2 || null,
      youtube: youtube || null
    });
  }

  const slugs = assignSlugs([...dir.values()], (x) => x.name);
  for (const item of dir.values()) item.slug = slugs.get(item.id);

  /* Строки без имени пропускаются выше намеренно — это заготовки, их в
     справочнике быть не должно. А вот недобор самих строк означает, что
     часть записей до нас не доехала: связи с релизов будут указывать в
     пустоту, страниц у таких артистов не появится. Молча этого допускать
     нельзя — на такой потере мы уже теряли одиннадцать имён. */
  if (store.size < total) {
    throw new Error(
      `${label}: получено ${store.size} строк из ${total}. ` +
      'Справочник больше двух тысяч строк, и двух заходов уже не хватает — ' +
      'выгрузку надо разбивать мельче.'
    );
  }

  console.log(`  ${label.padEnd(8)} -> ${dir.size} из ${total}, с Bandcamp: ${withBandcamp}`);
  return dir;
}

async function main() {
  console.log('Запрашиваю список записей...');
  const all = await queryCollection(ALBUMS);
  console.log(`Всего записей в базе: ${all.ids.length}`);

  const store = new Map();
  collect(store, all.blocks, ALBUMS.collection);
  console.log(`Получено сразу: ${store.size}. Добираю остальное по диапазонам дат:`);

  await fetchRange(store, new Date('1900-01-01'), new Date('2100-01-01'));

  // записи без даты фильтром по диапазону не ловятся — забираем отдельно
  const empty = await queryCollection(ALBUMS, {
    operator: 'and',
    filters: [{ property: P.date, filter: { operator: 'is_empty' } }]
  });
  collect(store, empty.blocks, ALBUMS.collection);
  console.log(`  без даты релиза      -> ${empty.ids.length}`);

  // подстраховка: всё, что всё ещё не собралось, тянем поштучно
  const missing = all.ids.filter((id) => !store.has(id));
  if (missing.length) {
    console.log(`Догружаю поштучно: ${missing.length}`);
    for (const id of missing) {
      try {
        const res = await api('loadCachedPageChunkV2', {
          page: { id }, limit: 30, cursor: { stack: [] }, chunkNumber: 0, verticalColumns: false
        });
        collect(store, res.recordMap?.block ?? {}, ALBUMS.collection);
      } catch (err) {
        console.warn(`не удалось получить ${id}: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  console.log('Справочники:');
  const artistsDir = await directory(ARTISTS, 'артисты');
  const labelsDir  = await directory(LABELS,  'лейблы');

  // видео
  const videoRes = await queryCollection(VIDEOS);
  const videoStore = new Map();
  collect(videoStore, videoRes.blocks, VIDEOS.collection);

  const videos = [];
  for (const v of videoStore.values()) {
    const title = plainText(prop(v.properties, 'title'));
    if (!title) continue;
    const released = dateStart(prop(v.properties, PV.date));
    /* Год оригинала — у роликов, выложенных на YouTube много позже съёмки.
       Сверить его не с чем: YouTube отдаёт только дату загрузки, она же
       лежит в released. Держится на знании владельца.

       Колонка стала списком годов 5 сентября 2026, вслед за такой же у
       релизов, и разбирается тем же yearValue: новые значения приходят
       текстом, у старых строк под ключом остался осиротевший date. */
    const origYear = yearValue(prop(v.properties, PV.origDate));

    videos.push({
      id: v.id,
      title,
      url: plainText(prop(v.properties, PV.url)),
      kind: plainText(prop(v.properties, PV.type)),
      released,
      year: released ? Number(released.slice(0, 4)) : null,
      origYear,
      artistIds: relationIds(prop(v.properties, PV.artist))
    });
  }
  /* По названию, а не по дате: дата у клипов заполнена не везде, а порядок
     обязан быть устойчивым — иначе выгрузка при тех же данных даёт разный
     файл и CI коммитит пустоту. Порядок в списках клипов задаёт страница,
     а не этот файл. */
  videos.sort((a, b) => cmp(a.title, b.title) || cmp(a.id, b.id));

  /* Адреса клипов — из полного названия, как оно лежит в Notion: там уже
     стоит имя артиста перед чертой, и «one-girl-one-boy» без него у двух
     разных исполнителей столкнулись бы. */
  const videoSlugs = assignSlugs(videos, (v) => v.title);
  for (const v of videos) v.slug = videoSlugs.get(v.id);

  // раскладка по артистам строится уже по отсортированному списку
  const videosByArtist = new Map();
  for (const item of videos) {
    for (const aid of item.artistIds) {
      if (!videosByArtist.has(aid)) videosByArtist.set(aid, []);
      videosByArtist.get(aid).push(item.id);
    }
  }
  console.log(`  ${'видео'.padEnd(8)} -> ${videos.length} из ${videoRes.ids.length}`);

  // ------------------------------------------------------------ альбомы

  const albums = [];
  let skipped = 0;

  for (const v of store.values()) {
    const props = v.properties;
    const title = plainText(prop(props, 'title'));
    if (!title) { skipped++; continue; }

    // "Artist | Album" -> два поля, режем по первому вхождению разделителя
    let artist = title;
    let album = '';
    const idx = title.indexOf(' | ');
    if (idx >= 0) {
      artist = title.slice(0, idx).trim();
      album = title.slice(idx + 3).trim();
    }

    const artistIds = relationIds(prop(props, P.artist));
    const labelIds  = relationIds(prop(props, P.label));
    const released  = dateStart(prop(props, P.date));

    /* Год оригинала — только у переизданий и допечаток. Порядок и отбор на
       сайте держит released: это дата того издания, которое лежит в
       каталоге. Оригинал показывается на странице релиза и больше нигде —
       иначе плитка говорила бы один год, а отбор по годам находил бы
       релиз в другом.

       Полная дата стояла здесь до 5 сентября 2026, поле звалось
       origReleased. У клипов колонку поменяли в тот же день, и разбирается
       она тем же yearValue. */
    const origYear = yearValue(prop(props, P.origDate));

    /* Подборки, в которые входит релиз. До 5 сентября 2026 под этим же
       ключом жил флажок «в подборке» — Notion хранил его текстом «Yes», —
       а теперь это колонка Playlists с множественным выбором, и значений в
       ней может быть сколько угодно. Разбираем её так же, как жанры и типы:
       имена через запятую.

       featured остаётся отдельным полем: страница /featured и витрина знают
       про одну подборку, а не про весь список, и им незачем каждый раз
       искать имя в массиве. */
    const playlists = splitList(plainText(prop(props, P.playlists)));
    const featured = playlists.includes(FEATURED);

    albums.push({
      id: v.id,
      slug: null,          // раздадим ниже, когда будет виден весь список
      artist,
      album,
      url: plainText(prop(props, P.url)),
      cover: coverUrl(v),
      genres: splitList(plainText(prop(props, P.genre))),
      types: splitList(plainText(prop(props, P.type))),
      released,
      year: released && released.length >= 4 ? Number(released.slice(0, 4)) : null,
      origYear,
      playlists,
      featured,
      artistIds,
      artists: artistIds.map((id) => artistsDir.get(id)?.name).filter(Boolean),
      labelIds,
      labels: labelIds.map((id) => labelsDir.get(id)?.name).filter(Boolean)
    });
  }

  // в адресе релиза имя артиста тоже берём с поправкой, иначе у «!!!»
  // от названия останется один альбом без исполнителя
  const albumSlugs = assignSlugs(albums, (a) => `${SLUG_OVERRIDES[a.artist] ?? a.artist} ${a.album}`);
  for (const a of albums) a.slug = albumSlugs.get(a.id);

  // свежие релизы сверху, недатированные — в конец
  albums.sort((a, b) => {
    const da = a.released || '0000-00-00';
    const db = b.released || '0000-00-00';
    return db.localeCompare(da) || cmp(a.artist, b.artist) || cmp(a.album, b.album) || cmp(a.id, b.id);
  });

  // ------------------------------------------------- артисты и лейблы
  // Дискография собирается обратным проходом по альбомам: это надёжнее,
  // чем relation с их стороны, и сразу даёт жанры.

  const albumById = new Map(albums.map((a) => [a.id, a]));
  const byArtist = new Map();
  const byLabel  = new Map();
  for (const a of albums) {
    for (const id of a.artistIds) {
      if (!byArtist.has(id)) byArtist.set(id, []);
      byArtist.get(id).push(a.id);
    }
    for (const id of a.labelIds) {
      if (!byLabel.has(id)) byLabel.set(id, []);
      byLabel.get(id).push(a.id);
    }
  }

  const uniqueFrom = (albumIds, field) => {
    const seen = [];
    for (const id of albumIds) {
      for (const value of albumById.get(id)[field]) {
        if (!seen.includes(value)) seen.push(value);
      }
    }
    return seen;
  };

  const byName = (a, b) => cmp(a.name, b.name) || cmp(a.id, b.id);

  const artists = [...artistsDir.values()].sort(byName).map((a) => {
    const albumIds = byArtist.get(a.id) ?? [];
    return {
      id: a.id,
      slug: a.slug,
      name: a.name,
      country: a.country,
      bandcamp: a.bandcamp,
      youtube: a.youtube,
      albumIds,
      genres: uniqueFrom(albumIds, 'genres'),
      labelIds: uniqueFrom(albumIds, 'labelIds'),
      videoIds: videosByArtist.get(a.id) ?? []
    };
  });

  const labels = [...labelsDir.values()].sort(byName).map((l) => {
    const albumIds = byLabel.get(l.id) ?? [];
    return {
      id: l.id,
      slug: l.slug,
      name: l.name,
      country: l.country,
      bandcamp: l.bandcamp,
      bandcamp2: l.bandcamp2,
      youtube: l.youtube,
      albumIds,
      artistIds: uniqueFrom(albumIds, 'artistIds')
    };
  });

  // --------------------------------------------------------- запись

  const payload = {
    source: `https://${HOST}`,
    generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    counts: { albums: albums.length, artists: artists.length, labels: labels.length, videos: videos.length },
    albums, artists, labels, videos
  };

  // Если данные не изменились, файл не трогаем: иначе меняется только
  // generatedAt, и автоматика в CI видит правку там, где правки нет.
  const withoutTimestamp = (obj) => JSON.stringify({ ...obj, generatedAt: null });
  let unchanged = false;
  try {
    const existing = JSON.parse(await readFile(outFile, 'utf8'));
    unchanged = withoutTimestamp(existing) === withoutTimestamp(payload);
    if (unchanged) payload.generatedAt = existing.generatedAt;
  } catch {
    // файла ещё нет — пишем впервые
  }

  if (!unchanged) {
    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, JSON.stringify(payload, null, 2), 'utf8');
  }

  const count = (list, fn) => list.filter(fn).length;
  console.log('');
  console.log(unchanged ? 'Изменений нет, файл не тронут.' : `Записано: ${outFile}`);
  console.log(`  альбомов:              ${albums.length} из ${all.ids.length}`);
  console.log(`    с обложкой:          ${count(albums, (a) => a.cover)}`);
  console.log(`    со ссылкой:          ${count(albums, (a) => a.url)}`);
  console.log(`    без разделителя |:   ${count(albums, (a) => !a.album)}`);
  console.log(`    без связи с артистом: ${count(albums, (a) => !a.artistIds.length)}`);
  console.log(`    без связи с лейблом:  ${count(albums, (a) => !a.labelIds.length)}`);
  console.log(`  артистов:              ${artists.length}`);
  console.log(`    без альбомов:        ${count(artists, (a) => !a.albumIds.length)}`);
  console.log(`    с клипами:           ${count(artists, (a) => a.videoIds.length)}`);
  console.log(`  лейблов:               ${labels.length}`);
  console.log(`  клипов:                ${videos.length}`);
  console.log(`  пропущено альбомов:    ${skipped} (без названия)`);
}

await main();
