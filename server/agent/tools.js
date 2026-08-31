import { catalog, getProduct, searchProducts, toSummary } from '../catalog.js';
import { addToCart, cartView, clearCart, removeFromCart, updateCartItem } from '../cart.js';
import { suggestCrossSell } from '../crosssell.js';

/**
 * The agent's complete tool surface.
 *
 * Deliberately absent: any tool that places an order, submits the basket,
 * schedules a pickup, or touches payment. The assistant physically cannot
 * check out, because no such capability is exposed to it.
 */
export const TOOLS = [
  {
    name: 'search_products',
    description:
      'Zoek producten in het Verhage-assortiment op tekst, categorie, tag, prijs of allergenen. ' +
      'Gebruik dit altijd voordat je iets aan de bestelling toevoegt, zodat je het juiste product-id hebt.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Zoektekst, bijvoorbeeld "kipburger" of "vegetarisch".' },
        category: { type: 'string', description: `Eén van: ${catalog.categories.map((c) => c.name).join(', ')}.` },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter op tags, bv. ["drink"], ["fries"], ["vegetarian"], ["halal"], ["glutenfree"].',
        },
        maxPrice: { type: 'number', description: 'Maximale prijs per stuk in euro.' },
        excludeAllergens: {
          type: 'array',
          items: { type: 'string' },
          description: 'Sluit producten met deze allergenen uit, bv. ["Gluten", "Noten"].',
        },
        limit: { type: 'number', description: 'Maximaal aantal resultaten (standaard 8).' },
      },
    },
    handler: (input) => {
      const results = searchProducts(input || {});
      return { count: results.length, products: results.map(toSummary) };
    },
  },
  {
    name: 'get_product',
    description: 'Haal alle details van één product op: prijs, omschrijving en allergenen.',
    input_schema: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'Het id van het product, bv. "kipfiletburger".' },
      },
      required: ['productId'],
    },
    handler: ({ productId }) => {
      const p = getProduct(productId);
      return p ? toSummary(p) : { error: `Geen product met id ${productId}.` };
    },
  },
  {
    name: 'add_to_cart',
    description:
      'Voeg een product toe aan de bestelling. Doe dit alleen als de gast het echt wil; ' +
      'voorstellen doe je eerst in de chat.',
    input_schema: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'Het id uit search_products, bv. "frites-normaal".' },
        quantity: { type: 'number', description: 'Aantal, standaard 1.' },
        note: { type: 'string', description: 'Opmerking van de gast, bv. "zonder ui".' },
      },
      required: ['productId'],
    },
    handler: ({ productId, quantity, note }, ctx) =>
      addToCart(ctx.sessionId, productId, quantity ?? 1, note ?? ''),
  },
  {
    name: 'update_cart_item',
    description: 'Wijzig het aantal van een regel. Aantal 0 verwijdert de regel.',
    input_schema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'lineId, product-id of productnaam.' },
        quantity: { type: 'number' },
      },
      required: ['item', 'quantity'],
    },
    handler: ({ item, quantity }, ctx) => updateCartItem(ctx.sessionId, item, quantity),
  },
  {
    name: 'remove_from_cart',
    description: 'Haal een regel uit de bestelling.',
    input_schema: {
      type: 'object',
      properties: { item: { type: 'string', description: 'lineId, product-id of productnaam.' } },
      required: ['item'],
    },
    handler: ({ item }, ctx) => removeFromCart(ctx.sessionId, item),
  },
  {
    name: 'clear_cart',
    description: 'Maak de hele bestelling leeg. Vraag hier eerst bevestiging voor.',
    input_schema: { type: 'object', properties: {} },
    handler: (_input, ctx) => clearCart(ctx.sessionId),
  },
  {
    name: 'view_cart',
    description: 'Bekijk de huidige bestelling met regels en subtotaal.',
    input_schema: { type: 'object', properties: {} },
    handler: (_input, ctx) => cartView(ctx.sessionId),
  },
  {
    name: 'suggest_cross_sell',
    description:
      'Vraag passende aanvullingen op de huidige bestelling op (friet, drinken, saus, toetje, menu-upgrade). ' +
      'Elk voorstel bevat een reden. Gebruik dit nadat je iets hebt toegevoegd, en noem hooguit twee suggesties per bericht.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximaal aantal suggesties (standaard 2).' },
        declined: {
          type: 'array',
          items: { type: 'string' },
          description: 'Product-ids die de gast al heeft afgewezen; die komen niet terug.',
        },
      },
    },
    handler: ({ limit, declined }, ctx) =>
      ({ suggestions: suggestCrossSell(cartView(ctx.sessionId), { limit: limit ?? 2, declined: declined ?? [] }) }),
  },
];

/** Canonical (Anthropic-shaped) tool definitions. */
export const TOOL_SCHEMAS = TOOLS.map(({ name, description, input_schema }) => ({
  name, description, input_schema,
}));

/**
 * The same tools in OpenAI function-calling shape, for OpenRouter and any
 * other OpenAI-compatible endpoint. One definition, two wire formats — the
 * agent's capabilities cannot drift between providers.
 */
export const OPENAI_TOOL_SCHEMAS = TOOL_SCHEMAS.map((tool) => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  },
}));

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Tool names that mutate the basket — used by the UI to refresh the cart. */
export const MUTATING_TOOLS = new Set([
  'add_to_cart', 'update_cart_item', 'remove_from_cart', 'clear_cart',
]);

/**
 * Collects the tool calls of one assistant turn.
 *
 * Both providers share this, so cart mutations, the event trace and the
 * refusal of unknown tools behave identically no matter who is driving.
 */
export function createToolExecutor(sessionId) {
  const events = [];
  let cartChanged = false;

  return {
    events,
    get cartChanged() {
      return cartChanged;
    },
    run(name, input) {
      const result = runTool(name, input, { sessionId });
      if (MUTATING_TOOLS.has(name) && result?.ok) cartChanged = true;
      events.push({ tool: name, input, result });
      return result;
    },
  };
}

export function runTool(name, input, ctx) {
  const tool = BY_NAME.get(name);
  if (!tool) {
    // Reached only if the model hallucinates a capability (e.g. "place_order").
    return {
      error: `Onbekende tool "${name}". Deze assistent kan alleen zoeken en de bestelling samenstellen — ` +
        'afrekenen, bestellen en betalen zijn niet mogelijk.',
    };
  }
  try {
    return tool.handler(input || {}, ctx);
  } catch (err) {
    return { error: `Tool "${name}" mislukte: ${err.message}` };
  }
}
