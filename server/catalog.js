import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CATALOG_PATH = path.resolve(
  fileURLToPath(new URL('../data/catalog.json', import.meta.url))
);

/** @type {{store:object, categories:object[], products:object[], source:object}} */
export const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));

export const productsById = new Map(catalog.products.map((p) => [p.id, p]));

const FOLD = (s) =>
  (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Accepts a slug id and, as a convenience, a product name. */
export function getProduct(id) {
  const key = String(id ?? '').trim();
  if (!key) return null;
  if (productsById.has(key)) return productsById.get(key);
  const folded = FOLD(key);
  return catalog.products.find((p) => FOLD(p.name) === folded) ?? null;
}

/**
 * Dutch/English synonyms so the agent can look things up the way a guest talks.
 * Maps a query token to extra tokens that should also match.
 */
const SYNONYMS = {
  cola: ['coca'], coke: ['coca', 'cola'], fries: ['frites', 'friet', 'patat'],
  friet: ['frites'], patat: ['frites'], chips: ['frites'],
  burger: ['hamburger'], sandwich: ['broodje'], bread: ['broodje'],
  drink: ['cola', 'fanta', 'sprite', 'spa', 'tea'],
  drinken: ['drink'], drankje: ['drink'], drank: ['drink'], drinks: ['drink'],
  frisdrank: ['drink'], snacks: ['snack'], toetje: ['dessert'], nagerecht: ['dessert'],
  hamburger: ['burger'], broodjes: ['broodje'], sauzen: ['sauce'], sausje: ['sauce'],
  sauce: ['saus'], saus: ['sauce'], mayo: ['mayonaise', 'fritessaus'],
  icecream: ['ijs', 'ice'], ice: ['ijs'], dessert: ['ijs', 'gebak'],
  ijs: ['ice'], ijsje: ['ijs', 'ice'], gebak: ['dessert'], taart: ['dessert', 'gebak'],
  chicken: ['kip'], kip: ['chicken'], cheese: ['kaas'], kaas: ['cheese'],
  veggie: ['vegetarian', 'vegetarisch', 'vega'], vegetarian: ['vegetarisch', 'vega'],
  vegetarisch: ['vegetarian'], vega: ['vegetarian'], vegan: ['vegetarian'],
  glutenvrij: ['glutenfree'], glutenfree: ['glutenvrij'], halal: ['halal'],
  milkshake: ['shake'], water: ['spa'], coffee: ['koffie'], koffie: ['coffee'],
};

/** Filler words that carry no product signal in DE/NL/EN guest phrasing. */
const STOPWORDS = new Set([
  'een', 'de', 'het', 'met', 'en', 'of', 'voor', 'graag', 'ik', 'wil', 'heb',
  'hebben', 'zou', 'kan', 'mag', 'the', 'a', 'an', 'and', 'or', 'with', 'for',
  'please', 'want', 'like', 'some', 'me', 'i', 'iets', 'wat', 'zin', 'trek', 'te',
  'lekkers', 'erbij', 'ook', 'nog',
]);

const tokenize = (q) =>
  FOLD(q).split(/[^a-z0-9]+/).filter((t) => t && !STOPWORDS.has(t));

function tokenScore(product, token, name, haystack) {
  if (name === token) return 60;
  // A whole word beats a prefix of a longer word, so "friet" finds
  // "Frites normaal" before "Fritessaus".
  if (new RegExp(`\\b${token}\\b`).test(name)) return 30;
  if (name.startsWith(token)) return 26;
  if (new RegExp(`\\b${token}`).test(name)) return 20;
  // Dutch compounds: "burger" should match "Kipfiletburger". Requiring the
  // token to end on a word boundary keeps "cola" out of "chocolade".
  if (token.length >= 4 && new RegExp(`${token}\\b`).test(name)) return 12;
  if (product.tags.includes(token)) return 10;
  if (FOLD(product.category).includes(token)) return 7;
  if (token.length >= 4 && new RegExp(`\\b${token}`).test(haystack)) return 4;
  return -3; // matched nothing
}

function scoreProduct(product, tokens) {
  const name = FOLD(product.name);
  const haystack = `${name} ${FOLD(product.description)} ${FOLD(product.category)} ${product.tags.join(' ')}`;

  let score = 0;
  for (const token of tokens) {
    // A typed word is satisfied by itself or by any of its synonyms, so
    // "drankje" scores like "drink" instead of being penalised for missing it.
    const variants = [token, ...(SYNONYMS[token] || [])];
    score += Math.max(...variants.map((v) => tokenScore(product, v, name, haystack)));
  }
  if (product.tags.includes('bestseller')) score += 3;
  return score;
}

/**
 * Search the assortment. Every filter is optional; with none the whole
 * catalogue is ranked by popularity.
 */
export function searchProducts({
  query = '', category = null, tags = [], maxPrice = null, excludeAllergens = [], limit = 8,
} = {}) {
  const tokens = tokenize(query);
  const wantTags = tags.map((t) => FOLD(t));
  const banned = excludeAllergens.map((a) => FOLD(a));
  const cat = category ? FOLD(category) : null;

  let results = catalog.products.filter((p) => {
    if (cat && !FOLD(p.category).includes(cat) && !FOLD(p.categorySlug).includes(cat)) return false;
    if (maxPrice != null && p.price > maxPrice) return false;
    if (wantTags.length && !wantTags.every((t) => p.tags.includes(t))) return false;
    if (banned.length && p.allergens.some((a) => banned.includes(FOLD(a)))) return false;
    return true;
  });

  if (tokens.length) {
    // Require real signal per token, so an incidental substring ("cola" inside
    // "chocolade") cannot surface an unrelated product.
    const threshold = 8 * tokens.length;
    results = results
      .map((p) => ({ p, score: scoreProduct(p, tokens) }))
      .filter((r) => r.score >= threshold)
      .sort((a, b) => b.score - a.score || a.p.price - b.p.price)
      .map((r) => r.p);
  } else {
    results = results.sort(
      (a, b) =>
        Number(b.tags.includes('bestseller')) - Number(a.tags.includes('bestseller')) ||
        a.price - b.price
    );
  }
  return results.slice(0, Math.max(1, Math.min(limit, 25)));
}

/** Compact shape sent to the model and rendered as a product card. */
export const toSummary = (p) => ({
  id: p.id,
  name: p.name,
  price: p.price,
  category: p.category,
  description: p.description,
  tags: p.tags,
  allergens: p.allergens,
  image: p.image,
  thumbnail: p.thumbnail || p.image,
  hasOptions: p.hasOptions,
});
