import { toSummary } from '../catalog.js';
import { cartView } from '../cart.js';
import { MUTATING_TOOLS, runTool } from './tools.js';
import { GREETING } from './prompt.js';

/**
 * Deterministic stand-in for the model, used when ANTHROPIC_API_KEY is unset.
 *
 * It drives exactly the same tools as the LLM agent, so cart behaviour,
 * cross-selling and the no-checkout guarantee are identical — only the language
 * understanding is rule-based instead of learned. This keeps the app runnable
 * (and testable) with no credentials.
 */

/** Per-session memory: what we last offered, and what was turned down. */
const memory = new Map();
const mem = (id) => {
  if (!memory.has(id)) memory.set(id, { offered: [], declined: [] });
  return memory.get(id);
};

const NUMBER_WORDS = {
  een: 1, één: 1, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6, zeven: 7,
  acht: 8, negen: 9, tien: 10, one: 1, two: 2, three: 3, four: 4, five: 5,
};

const RE = {
  // Deliberately narrow: "ik wil een burger bestellen" is ordinary ordering
  // language, while "bestel dit voor mij" asks us to place the order.
  checkout:
    /\b(afreken(en)?|betaal|betalen|pinnen|checkout|pay|ideal|creditcard|pinpas|bezorg(en)?|afhaaltijd)\b|\bbestel\s+(dit|het|dat|maar|nu|deze)\b|\bplaats\s+(de\s+)?bestelling\b|\bbestelling\s+(plaatsen|afronden|versturen|doorgeven|bevestigen)\b|\b(order|place the order|order now)\b/i,
  clear: /\b(leeg|leegmaken|wis|verwijder alles|opnieuw beginnen|begin opnieuw|reset)\b/i,
  show: /\b(bestelling|mandje|winkelwagen|overzicht|wat heb ik|totaal|subtotaal|cart)\b/i,
  remove: /\b(verwijder|haal|weg|eraf|annuleer|niet meer|remove)\b/i,
  // Global twin of `remove`, so every verb is stripped from the product phrase
  // and "haal de coca cola weg" resolves to "coca cola".
  removeWords: /\b(verwijder|haal|weg|eraf|annuleer|niet meer|remove|uit|mijn|bestelling)\b/gi,
  add: /\b(doe maar|doe mij|ik wil|ik neem|ik heb zin|voeg toe|mag ik|geef mij|graag een|nog een|erbij)\b/i,
  yes: /^(ja|jazeker|graag|doe maar|prima|ok|oké|okay|yes|top|lekker|goed idee|is goed|doen)\b/i,
  no: /^(nee|nee dank|liever niet|hoeft niet|nope|no|laat maar|niet doen)\b/i,
  browse: /\b(wat hebben jullie|laat zien|menu|assortiment|opties|keuze|aanraden|aanrader|advies|suggestie|wat is lekker|options|show me)\b/i,
  greet: /^(hoi|hallo|hey|goedemiddag|goedemorgen|goedenavond|hi|yo|hello)\b/i,
};

const DIET = [
  [/\bhalal\b/i, { tags: ['halal'] }],
  [/\bvegetarisch|vega\b|veggie|vegan\b/i, { tags: ['vegetarian'] }],
  [/\bglutenvrij|gluten.?free\b/i, { tags: ['glutenfree'] }],
  [/\bgeen gluten|zonder gluten\b/i, { excludeAllergens: ['Gluten'] }],
  [/\bgeen noten|zonder noten|notenallergie\b/i, { excludeAllergens: ['Noten', "Pinda's"] }],
  [/\bgeen melk|lactose\b/i, { excludeAllergens: ['Melk'] }],
];

const euro = (n) => `€${n.toFixed(2).replace('.', ',')}`;

function parseQuantity(text) {
  const digit = text.match(/\b(\d{1,2})\s*[x×]?\s/);
  if (digit) return Math.min(Number(digit[1]), 20);
  for (const [word, n] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(text) && n > 1) return n;
  }
  return 1;
}

/** Strips intent verbs and quantities so what remains is the product phrase. */
function productPhrase(text) {
  return text
    .replace(/\b(ik wil|ik neem|ik heb|doe mij|doe maar|graag|mag ik|kan ik|geef mij|voeg toe|toevoegen|bestel|hebben|krijgen|erbij|alsjeblieft|please|add|ook|nog|een|de|het)\b/gi, ' ')
    .replace(/\b\d{1,2}\s*[x×]?\b/g, ' ')
    .replace(/[?.!,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dietFilters(text) {
  const filters = { tags: [], excludeAllergens: [] };
  let matched = false;
  for (const [re, f] of DIET) {
    if (re.test(text)) {
      matched = true;
      filters.tags.push(...(f.tags || []));
      filters.excludeAllergens.push(...(f.excludeAllergens || []));
    }
  }
  return { ...filters, matched };
}

/** Diet words become filters, so they must not also be matched as product text. */
const stripDietWords = (text) =>
  text
    .replace(/\b(halal|vegetarisch|vega|veggie|vegan|glutenvrij|gluten.?free|lactose|zonder|geen|noten|pinda'?s|melk|gluten)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const summarize = (cart) =>
  cart.items.length
    ? `${cart.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')} — subtotaal ${euro(cart.subtotal)}${cart.estimated ? ' (vanaf-prijs, je maakt de keuzes nog)' : ''}`
    : 'Je bestelling is nog leeg.';

export async function runFallbackAgent({ sessionId, message, history = [] }) {
  const ctx = { sessionId };
  const events = [];
  const state = mem(sessionId);
  let cartChanged = false;

  const call = (tool, input = {}) => {
    const result = runTool(tool, input, ctx);
    if (MUTATING_TOOLS.has(tool) && result?.ok) cartChanged = true;
    events.push({ tool, input, result });
    return result;
  };

  const text = String(message || '').trim();
  const reply = respond();

  return {
    reply,
    events,
    history: [...history, { role: 'user', content: text }, { role: 'assistant', content: reply }],
    cartChanged,
  };

  function respond() {
    // 1. Checkout, ordering and payment are refused before anything else.
    if (RE.checkout.test(text)) {
      const cart = call('view_cart');
      return (
        'Afrekenen en betalen kan ik hier niet — ik help alleen met het samenstellen van je bestelling. ' +
        'Neem je lijstje mee naar de Verhage-webshop of de winkel om af te ronden.\n\n' +
        `Je hebt nu: ${summarize(cart)}`
      );
    }

    if (!text) return GREETING;

    if (RE.clear.test(text)) {
      call('clear_cart');
      return 'Ik heb je bestelling leeggemaakt. Waar heb je zin in?';
    }

    // 2. "Nee" op een suggestie: onthouden en niet opnieuw aanbieden.
    if (RE.no.test(text)) {
      state.declined.push(...state.offered.map((s) => s.id));
      state.offered = [];
      const cart = call('view_cart');
      return `Prima, laat maar zitten. ${summarize(cart)}\nNog iets anders?`;
    }

    // 3. "Ja graag" verwijst naar wat we net voorstelden.
    if (RE.yes.test(text) && state.offered.length) {
      const accepted = state.offered[0];
      state.offered = [];
      const added = call('add_to_cart', { productId: accepted.id, quantity: 1 });
      if (!added.ok) return `Dat lukte niet: ${added.error}`;
      return `Top, ${accepted.name} staat erbij (${euro(accepted.price)}).\n\n${withSuggestions(added.cart)}`;
    }

    if (RE.remove.test(text)) {
      const phrase = productPhrase(text.replace(RE.removeWords, ' '));
      const removed = call('remove_from_cart', { item: phrase });
      const cart = call('view_cart');
      return removed.ok
        ? `${removed.removed} is eruit. ${summarize(cart)}`
        : `Ik kon "${phrase}" niet in je bestelling vinden. ${summarize(cart)}`;
    }

    // Browsing and cart questions win over "add", unless the guest clearly
    // asks for something to be put in the basket.
    const wantsAdd = RE.add.test(text) || /^\d+\s/.test(text);

    if (RE.show.test(text) && !wantsAdd) {
      const cart = call('view_cart');
      return cart.items.length
        ? `${summarize(cart)}\n\n${cart.checkoutMessage}`
        : 'Je bestelling is nog leeg. Zeg maar waar je zin in hebt.';
    }

    if (RE.greet.test(text) && text.split(/\s+/).length <= 3) return GREETING;

    // 4. Bladeren / advies vragen.
    const filters = dietFilters(text);
    if (RE.browse.test(text) && !wantsAdd) {
      const { matched: browseDiet, ...browseFilters } = filters;
      const browseQuery = productPhrase(text.replace(RE.browse, ' '));
      const found = call('search_products', {
        query: browseDiet ? stripDietWords(browseQuery) : browseQuery,
        ...browseFilters,
        limit: 4,
      });
      if (!found.count) return 'Daar heb ik niets voor kunnen vinden. Waar heb je trek in?';
      state.offered = found.products.map(toSummary);
      return `Dit kan ik je aanraden:\n${found.products
        .map((p) => `• ${p.name} — ${euro(p.price)}`)
        .join('\n')}\n\nZal ik er iets van in je bestelling zetten?`;
    }

    // 5. Standaard: iets toevoegen.
    const { matched: hasDiet, ...searchFilters } = filters;
    const phrase = hasDiet ? stripDietWords(productPhrase(text)) : productPhrase(text);
    const found = call('search_products', { query: phrase, ...searchFilters, limit: 5 });

    if (!found.count) {
      return `Ik kon "${phrase}" niet vinden in het assortiment. Zoek je iets als een burger, friet, snack of drankje?`;
    }

    // "Iets vegetarisch" noemt geen product: laat de opties zien in plaats van
    // zomaar de eerste treffer toe te voegen.
    if (hasDiet && !phrase) {
      state.offered = found.products.slice(0, 3);
      return `Dit hebben we daarvoor:\n${found.products
        .slice(0, 3)
        .map((p) => `• ${p.name} — ${euro(p.price)}`)
        .join('\n')}\n\nZal ik er een in je bestelling zetten?`;
    }

    // Meerdere sterk verschillende treffers: laat kiezen in plaats van gokken.
    if (found.count > 1 && !isConfident(found.products, phrase)) {
      state.offered = found.products.slice(0, 3);
      return `Welke bedoel je?\n${found.products
        .slice(0, 3)
        .map((p) => `• ${p.name} — ${euro(p.price)}`)
        .join('\n')}`;
    }

    const product = found.products[0];
    const quantity = parseQuantity(text);
    const added = call('add_to_cart', { productId: product.id, quantity });
    if (!added.ok) return `Dat lukte niet: ${added.error}`;

    const line = `${quantity}× ${product.name} toegevoegd (${euro(product.price)}${product.hasOptions ? ' vanaf' : ''}).`;
    return `${line}\n\n${withSuggestions(added.cart)}`;
  }

  /** Appends at most two cross-sell offers, phrased with their reason. */
  function withSuggestions(cart) {
    const { suggestions } = call('suggest_cross_sell', { limit: 2, declined: state.declined });
    if (!suggestions.length) return summarize(cart);
    state.offered = suggestions;
    const lines = suggestions.map((s) => `${s.reason} ${s.name} kost ${euro(s.price)}.`);
    return `${lines.join(' ')}\n\n${summarize(cart)}`;
  }

  /** Confident when the top hit clearly beats the rest, or all hits are variants. */
  function isConfident(products, phrase) {
    const p = phrase.toLowerCase();
    if (products[0].name.toLowerCase() === p) return true;
    const distinctCategories = new Set(products.slice(0, 3).map((x) => x.category)).size;
    return distinctCategories === 1 && products[0].name.toLowerCase().includes(p);
  }
}

export const __testing = { memory, parseQuantity, productPhrase };
