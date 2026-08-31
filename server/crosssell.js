import { catalog, searchProducts, toSummary } from './catalog.js';

/**
 * Cross-sell engine.
 *
 * Produces ranked, explainable suggestions from what is (and is not) in the
 * cart. Every suggestion carries a `reason` so the assistant can offer it in
 * natural language instead of dumping a list, and a `kind` so the UI can style
 * a completion differently from an upgrade.
 */

const has = (items, tag) => items.some((i) => (i.tags || []).includes(tag));

/**
 * Search, then float the house favourites to the front. Without this the
 * cheapest row wins and you end up offering onion bits as "a sauce".
 */
const pick = ({ prefer = [], ...opts }) => {
  const results = searchProducts({ ...opts, limit: 12 });
  const rank = (p) => {
    const i = prefer.findIndex((n) => p.name.toLowerCase().startsWith(n.toLowerCase()));
    return i === -1 ? prefer.length : i;
  };
  return results.sort((a, b) => rank(a) - rank(b)).slice(0, opts.limit ?? 3);
};

/**
 * Each rule inspects the cart and returns candidate products plus the reason
 * to mention them. Rules are evaluated in order; higher `weight` wins ties.
 */
const RULES = [
  {
    id: 'fries-with-main',
    weight: 100,
    kind: 'completion',
    when: (c) => c.hasMain && !c.hasMenu && !c.hasFries,
    reason: 'Er zit nog geen friet bij je hoofdgerecht.',
    candidates: () => pick({ tags: ['fries'], prefer: ['Frites normaal', 'Frites groot', 'Loaded fries'], limit: 3 }),
  },
  {
    id: 'drink-with-food',
    weight: 95,
    kind: 'completion',
    when: (c) => (c.hasMain || c.hasSnack) && !c.hasMenu && !c.hasDrink,
    reason: 'Je hebt nog niets te drinken gekozen.',
    candidates: () => pick({ tags: ['drink'], prefer: ['Coca cola', 'Spa blauw', 'Fuze tea sparkling'], limit: 3 }),
  },
  {
    id: 'sauce-with-fries',
    weight: 85,
    kind: 'completion',
    when: (c) => (c.hasFries || c.hasSnack) && !c.hasSauce,
    reason: 'Een sausje bij de friet of snacks maakt het af.',
    candidates: () => pick({ tags: ['sauce'], prefer: ['Fritessaus', 'Joppiesaus', 'Curry', 'Ketchup'], limit: 3 }),
  },
  {
    id: 'menu-upgrade',
    weight: 80,
    kind: 'upgrade',
    when: (c) => c.hasBurger && !c.hasMenu,
    reason: 'Als menu krijg je er friet en drinken bij — vaak voordeliger dan los.',
    candidates: (c) => menuUpgradesFor(c.items),
  },
  {
    id: 'dessert-after-meal',
    weight: 60,
    kind: 'completion',
    when: (c) => c.hasMain && !c.hasDessert && c.subtotal >= 8,
    reason: 'Nog iets zoets toe?',
    candidates: () => pick({ tags: ['dessert'], prefer: ['Twist', 'Dudok Appeltaart', 'Chocolade Muffin'], limit: 3 }),
  },
  {
    id: 'sharing-for-group',
    weight: 55,
    kind: 'suggestion',
    when: (c) => c.itemCount >= 4 && !c.hasSharing,
    reason: 'Bij een grotere bestelling is een deelbox erbij een aanrader.',
    candidates: () => pick({ tags: ['sharing'], prefer: ['Bitterbucket', 'Snackbucket', 'Kipbucket'], limit: 3 }),
  },
  {
    id: 'snack-with-drink-only',
    weight: 50,
    kind: 'suggestion',
    when: (c) => c.hasDrink && !c.hasMain && !c.hasSnack,
    reason: 'Iets kleins bij je drankje?',
    candidates: () => pick({ tags: ['snack'], prefer: ['Kaastengels', 'Rundvleeskroket', 'Vlammetjes'], limit: 3 }),
  },
  {
    id: 'empty-cart-bestsellers',
    weight: 10,
    kind: 'suggestion',
    when: (c) => c.itemCount === 0,
    reason: 'Dit bestellen gasten hier het vaakst.',
    candidates: () => pick({ tags: ['bestseller'], prefer: ['Kipfiletburger', 'Spareribsmenu', 'Kaastengels'], limit: 3 }),
  },
];

/** Finds the menu version of a burger already in the cart (Cheeseburger -> Cheeseburgermenu). */
function menuUpgradesFor(items) {
  const out = [];
  for (const item of items) {
    if (!(item.tags || []).includes('burger')) continue;
    const base = item.name.toLowerCase().replace(/\s*\(halal\)/, '').trim();
    const menu = catalog.products.find(
      (p) =>
        p.tags.includes('menu') &&
        p.id !== item.productId &&
        p.name.toLowerCase().startsWith(base.split(' ')[0]) &&
        /menu|meal/i.test(p.name)
    );
    if (menu && !out.some((m) => m.id === menu.id)) out.push(menu);
  }
  return out.slice(0, 2);
}

function profile(cartView) {
  const items = cartView.items || [];
  return {
    items,
    itemCount: cartView.itemCount || 0,
    subtotal: cartView.subtotal || 0,
    hasMain: has(items, 'main'),
    hasMenu: has(items, 'menu'),
    hasBurger: has(items, 'burger'),
    hasFries: has(items, 'fries'),
    hasDrink: has(items, 'drink'),
    hasSauce: has(items, 'sauce'),
    hasSnack: has(items, 'snack'),
    hasDessert: has(items, 'dessert'),
    hasSharing: has(items, 'sharing'),
  };
}

/**
 * @param {object} cartView       result of cartView()
 * @param {object} [opts]
 * @param {number} [opts.limit]   max suggestions returned
 * @param {number[]} [opts.declined] product ids the guest already turned down
 */
export function suggestCrossSell(cartView, { limit = 3, declined = [] } = {}) {
  const ctx = profile(cartView);
  const inCart = new Set(ctx.items.map((i) => i.productId));
  const skip = new Set([...inCart, ...declined.map(String)]);
  const seen = new Set();
  const suggestions = [];

  for (const rule of [...RULES].sort((a, b) => b.weight - a.weight)) {
    if (!rule.when(ctx)) continue;
    const candidates = rule.candidates(ctx).filter((p) => !skip.has(p.id) && !seen.has(p.id));
    if (!candidates.length) continue;

    const best = candidates[0];
    seen.add(best.id);
    suggestions.push({
      ...toSummary(best),
      reason: rule.reason,
      kind: rule.kind,
      rule: rule.id,
      // Alternatives let the assistant offer a choice without another tool call.
      alternatives: candidates.slice(1, 3).map((p) => ({ id: p.id, name: p.name, price: p.price })),
    });
    if (suggestions.length >= limit) break;
  }
  return suggestions;
}
