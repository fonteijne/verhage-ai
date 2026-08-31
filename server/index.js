import express from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { catalog, searchProducts, toSummary } from './catalog.js';
import { cartView } from './cart.js';
import { runAgent, hasLLM } from './agent/index.js';
import { GREETING } from './agent/prompt.js';

const app = express();
app.use(express.json({ limit: '256kb' }));

const PORT = process.env.PORT || 3001;
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Conversation history per session. Carts live in cart.js. */
const conversations = new Map();

/**
 * Endpoints that would place an order or take payment do not exist. These
 * routes answer explicitly instead of 404-ing, so the boundary is visible
 * rather than accidental.
 */
const BLOCKED = ['/api/checkout', '/api/order', '/api/orders', '/api/pay', '/api/payment'];
app.all(BLOCKED, (_req, res) =>
  res.status(501).json({
    error: 'not_implemented',
    message:
      'Deze assistent kan alleen een bestelling samenstellen. Afrekenen, bestellen en betalen ' +
      'zijn bewust niet beschikbaar.',
  })
);

app.get('/api/health', (_req, res) =>
  res.json({
    ok: true,
    store: catalog.store,
    products: catalog.products.length,
    agent: hasLLM() ? 'claude' : 'rule-based-fallback',
    checkoutAvailable: false,
  })
);

app.get('/api/catalog', (_req, res) =>
  res.json({
    store: catalog.store,
    categories: catalog.categories,
    products: catalog.products.map(toSummary),
  })
);

app.get('/api/products', (req, res) => {
  const { q = '', category, tag, maxPrice, limit } = req.query;
  const products = searchProducts({
    query: String(q),
    category: category ? String(category) : null,
    tags: tag ? [String(tag)] : [],
    maxPrice: maxPrice ? Number(maxPrice) : null,
    limit: limit ? Number(limit) : 12,
  });
  res.json({ count: products.length, products: products.map(toSummary) });
});

app.post('/api/session', (_req, res) => {
  const sessionId = randomUUID();
  conversations.set(sessionId, []);
  res.json({
    sessionId,
    greeting: GREETING,
    store: catalog.store,
    agent: hasLLM() ? 'claude' : 'rule-based-fallback',
    cart: cartView(sessionId),
  });
});

app.get('/api/cart/:sessionId', (req, res) => res.json(cartView(req.params.sessionId)));

app.post('/api/chat', async (req, res) => {
  const { sessionId, message } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: 'sessionId ontbreekt.' });
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message ontbreekt.' });
  }
  if (message.length > 2000) return res.status(400).json({ error: 'Bericht is te lang.' });

  try {
    const history = conversations.get(sessionId) || [];
    const result = await runAgent({ sessionId, message: message.trim(), history });
    conversations.set(sessionId, trimHistory(result.history));

    res.json({
      reply: result.reply,
      // The trace lets the UI show which tools ran — and that none of them
      // could have placed an order.
      events: result.events.map((e) => ({ tool: e.tool, input: e.input, ok: !e.result?.error })),
      products: collectProducts(result.events),
      suggestions: collectSuggestions(result.events),
      cart: cartView(sessionId),
    });
  } catch (err) {
    console.error('[chat] agent error:', err);
    res.status(500).json({
      error: 'agent_error',
      message: 'Er ging iets mis bij het verwerken van je bericht.',
      reply: 'Sorry, daar ging iets mis. Probeer het nog eens.',
    });
  }
});

/** Products the agent looked at this turn, for rendering as cards. */
function collectProducts(events) {
  const out = [];
  const seen = new Set();
  for (const e of events) {
    if (e.tool !== 'search_products') continue;
    for (const p of e.result?.products || []) {
      if (!seen.has(p.id)) { seen.add(p.id); out.push(p); }
    }
  }
  return out.slice(0, 6);
}

function collectSuggestions(events) {
  const out = [];
  const seen = new Set();
  for (const e of events) {
    if (e.tool !== 'suggest_cross_sell') continue;
    for (const s of e.result?.suggestions || []) {
      if (!seen.has(s.id)) { seen.add(s.id); out.push(s); }
    }
  }
  return out;
}

/** Keeps context bounded without losing the running order. */
function trimHistory(history, maxMessages = 24) {
  return history.length <= maxMessages ? history : history.slice(-maxMessages);
}

const dist = path.join(ROOT, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Verhage AI running on http://localhost:${PORT}`);
    console.log(`  agent:    ${hasLLM() ? 'Claude (ANTHROPIC_API_KEY set)' : 'rule-based fallback'}`);
    console.log(`  catalog:  ${catalog.products.length} producten`);
    console.log('  checkout: disabled by design');
  });
}

export default app;
