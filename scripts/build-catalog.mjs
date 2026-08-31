/**
 * Rebuilds data/catalog.json from the live Verhage assortment page.
 *
 * The storefront is an Angular app that inlines its resolved server state in a
 * <script id="ng-state"> tag, so the full assortment is available without an
 * official API. Product option sets ("questionSet") are lazy-loaded per product
 * and are NOT part of that payload; we only record whether a product has one.
 *
 *   node scripts/build-catalog.mjs [--url <assortment-url>]
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DEFAULT_URL = 'https://verhage.nl/assortiment/verhage-hoofddorp/1';
const OUT = path.resolve(fileURLToPath(new URL('../data/catalog.json', import.meta.url)));

/** Category slug -> semantic tags used by search and the cross-sell engine. */
const CATEGORY_TAGS = {
  bestsellers: ['bestseller'],
  menus: ['menu', 'main'],
  burgers: ['burger', 'main'],
  halal: ['halal', 'main'],
  frites: ['fries', 'side'],
  snacks: ['snack', 'side'],
  bites: ['snack', 'side', 'sharing'],
  broodjes: ['sandwich', 'main'],
  tostis: ['sandwich', 'main'],
  uitsmijters: ['eggs', 'main'],
  salades: ['salad', 'main', 'light'],
  shakes: ['drink', 'shake', 'sweet'],
  ijs: ['dessert', 'sweet', 'ice'],
  gebak: ['dessert', 'sweet'],
  dranken: ['drink'],
  sauzen: ['sauce', 'condiment'],
  glutenvrij: ['glutenfree'],
};

const KEYWORD_TAGS = [
  [/\bvegetarisch|vega\b|falafel|groente/i, 'vegetarian'],
  [/\bkip|chicken\b/i, 'chicken'],
  [/\bkaas|cheese\b/i, 'cheese'],
  [/\bspicy|pittig|hot\b/i, 'spicy'],
  [/\bhalal\b/i, 'halal'],
  [/\bkindermenu|kids\b/i, 'kids'],
];

const slugify = (s) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const stripHtml = (html) =>
  (html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&eacute;/g, 'é').replace(/&euml;/g, 'ë')
    .replace(/\s+/g, ' ')
    .trim();

async function fetchState(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; verhage-ai-catalog-builder)' },
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const html = await res.text();
  const match = html.match(/<script id="ng-state" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('ng-state payload not found — the storefront markup changed.');
  return JSON.parse(match[1]);
}

/** Picks a resolution variant, falling back to whatever the feed has. */
function mediaOf(position, product, isConfigurable, index) {
  const media = (isConfigurable ? position.media : product.media) || product.media || [];
  return media[index] || media[0] || null;
}

function normalize(state, sourceUrl) {
  const root = state.assortment;
  if (!root?.assortment) throw new Error('Unexpected ng-state shape: no assortment array.');

  const byId = new Map();
  const categories = [];

  const addPosition = (position, category, subgroup) => {
    const p = position.product;
    if (!p) return;

    // Configurable items (burgers with a size/topping choice, menus with a
    // drink choice) are stored as a placeholder "DUMMY" product: the real
    // name, description, media and a "from" price live on the position, and
    // the variants sit behind the lazy-loaded questionSet.
    const isConfigurable = /^dummy$/i.test(p.name || '') || !p.price;
    const rawName = (isConfigurable ? position.name || position.buttonText : p.name) || p.name;
    const price = isConfigurable ? position.fromPrice : p.price;
    if (!rawName || /^dummy$/i.test(rawName) || !price) return;

    // The Halal category repeats names of regular items for their halal
    // variant; keep them distinguishable instead of collapsing them together.
    const name =
      category.slug === 'halal' && !/halal/i.test(rawName) ? `${rawName} (halal)` : rawName;

    const description = stripHtml(isConfigurable ? position.description : p.description);
    const allergens = (p.allergens || []).map((a) => a.name);

    // The same item is listed in several places (Bestsellers mirrors Burgers,
    // and each listing carries its own placeholder id), so dedupe on name.
    const key = slugify(name);
    const existing = byId.get(key);
    if (existing) {
      if (!existing.categories.includes(category.name)) existing.categories.push(category.name);
      if (category.slug === 'bestsellers' && !existing.tags.includes('bestseller')) {
        existing.tags.push('bestseller');
      }
      // Fill gaps from the duplicate listing rather than discarding it outright.
      if (!existing.description && description) existing.description = description;
      if (!existing.allergens.length && allergens.length) existing.allergens = allergens;
      return;
    }

    const tags = new Set(CATEGORY_TAGS[category.slug] || []);
    if (subgroup) {
      if (/loaded/i.test(subgroup)) tags.add('loaded');
      if (/menu/i.test(subgroup)) { tags.add('menu'); tags.add('main'); }
    }
    if (/burger/i.test(name)) tags.add('burger');
    if (/menu\b/i.test(name)) { tags.add('menu'); tags.add('main'); }
    for (const [re, tag] of KEYWORD_TAGS) {
      if (re.test(`${name} ${description}`)) tags.add(tag);
    }
    // Products that only appear under "Bestsellers" would otherwise miss the
    // course tags the cross-sell rules key on.
    if (/\bsalade\b/i.test(name)) { tags.add('salad'); tags.add('light'); }
    if (['burger', 'sandwich', 'menu', 'salad', 'eggs'].some((t) => tags.has(t))) tags.add('main');

    byId.set(key, {
      // The feed reuses placeholder product ids across unrelated items (a
      // dozen different sauces all share one), so the slug is the stable key.
      id: key,
      sourceId: p.id,
      code: isConfigurable ? null : p.code || null,
      name,
      slug: p.slug || slugify(name),
      price,
      // True when `price` is a starting price and the guest still has choices
      // to make (size, drink, sauce) before the line total is final.
      priceFrom: isConfigurable,
      description,
      category: category.name,
      categorySlug: category.slug,
      subgroup: subgroup || null,
      categories: [category.name],
      tags: [...tags],
      allergens,
      hasOptions: Boolean(position.questionSetId),
      // Media comes as six resolution variants of the same shot; index 0 is
      // the ~1 MB original and index 2 a ~15 KB thumbnail. Cards use the
      // thumbnail, so a reply with six product cards stays under ~100 KB.
      image: mediaOf(position, p, isConfigurable, 1),
      thumbnail: mediaOf(position, p, isConfigurable, 2),
    });
  };

  // Categories keep their on-site display order.
  for (const cat of root.assortment) {
    categories.push({
      id: cat.id,
      name: cat.name,
      slug: cat.slug || slugify(cat.name),
      description: stripHtml(cat.description),
      subgroups: (cat.subGroups || []).map((s) => s.name),
    });
  }

  // "Bestsellers" mirrors products that also live in a real category. Visit it
  // last so each product keeps its true category and merely gains the tag.
  const ordered = [...root.assortment].sort(
    (a, b) => Number(slugify(a.name) === 'bestsellers') - Number(slugify(b.name) === 'bestsellers')
  );

  for (const cat of ordered) {
    const slug = cat.slug || slugify(cat.name);
    const category = { id: cat.id, name: cat.name, slug };
    for (const pos of cat.productPositions || []) addPosition(pos, category, null);
    for (const sub of cat.subGroups || []) {
      for (const pos of sub.productPositions || []) addPosition(pos, category, sub.name);
    }
  }

  const products = [...byId.values()].sort(
    (a, b) => a.category.localeCompare(b.category) || a.price - b.price
  );
  if (!products.length) throw new Error('Normalisation produced no products.');
  return {
    source: { url: sourceUrl, fetchedAt: new Date().toISOString() },
    store: {
      id: root.store?.id ?? null,
      name: root.store?.name ?? 'Verhage',
      slug: root.store?.slug ?? null,
      pickupOnly: root.store?.deliveryIsPossible === false,
    },
    categories,
    products,
  };
}

const urlArg = process.argv.indexOf('--url');
const url = urlArg > -1 ? process.argv[urlArg + 1] : DEFAULT_URL;

const catalog = normalize(await fetchState(url), url);
await writeFile(OUT, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
console.log(
  `Wrote ${OUT}\n  store:      ${catalog.store.name}\n` +
  `  categories: ${catalog.categories.length}\n  products:   ${catalog.products.length}`
);
