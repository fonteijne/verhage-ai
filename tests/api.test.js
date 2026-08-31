import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { default: app } = await import('../server/index.js');

/** Boots the app on an ephemeral port for the duration of the suite. */
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
test.after(() => server.close());

const get = async (p) => (await fetch(base + p)).json();
const post = async (p, body) => {
  const res = await fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

test('health reports the catalog, the active agent and that checkout is off', async () => {
  const h = await get('/api/health');
  assert.equal(h.ok, true);
  assert.equal(h.checkoutAvailable, false);
  assert.ok(h.products > 150);
  assert.ok(h.agent.id && h.agent.label, 'health should name the active provider');
});

test('a session tells the client which provider is answering', async () => {
  const { body } = await post('/api/session');
  assert.ok(['anthropic', 'openrouter', 'fallback'].includes(body.agent.id));
});

test('a session starts with a greeting and an empty cart', async () => {
  const { body } = await post('/api/session');
  assert.ok(body.sessionId);
  assert.ok(body.greeting.length > 20);
  assert.equal(body.cart.itemCount, 0);
});

test('chat adds to the cart and returns cross-sell suggestions', async () => {
  const { body: s } = await post('/api/session');
  const { body } = await post('/api/chat', { sessionId: s.sessionId, message: 'doe maar een cheeseburger' });

  assert.match(body.reply, /Cheeseburger/i);
  assert.equal(body.cart.itemCount, 1);
  assert.ok(body.suggestions.length > 0, 'expected cross-sell suggestions');
  assert.ok(body.suggestions.every((x) => x.reason));
  assert.ok(body.events.some((e) => e.tool === 'add_to_cart'));
});

test('the cart persists across turns in one session', async () => {
  const { body: s } = await post('/api/session');
  await post('/api/chat', { sessionId: s.sessionId, message: 'doe maar een cheeseburger' });
  await post('/api/chat', { sessionId: s.sessionId, message: 'doe maar een coca cola' });
  const cart = await get(`/api/cart/${s.sessionId}`);
  assert.equal(cart.itemCount, 2);
});

test('chat validates its input', async () => {
  assert.equal((await post('/api/chat', { message: 'hoi' })).status, 400);
  assert.equal((await post('/api/chat', { sessionId: 'x', message: '' })).status, 400);
  assert.equal((await post('/api/chat', { sessionId: 'x', message: 'a'.repeat(2001) })).status, 400);
});

test('checkout, order and payment endpoints do not exist', async () => {
  for (const path of ['/api/checkout', '/api/order', '/api/orders', '/api/pay', '/api/payment']) {
    const { status, body } = await post(path, {});
    assert.equal(status, 501, `${path} should not be implemented`);
    assert.equal(body.error, 'not_implemented');
  }
});

test('asking to pay in chat is declined and changes nothing', async () => {
  const { body: s } = await post('/api/session');
  await post('/api/chat', { sessionId: s.sessionId, message: 'doe maar een cheeseburger' });
  const { body } = await post('/api/chat', { sessionId: s.sessionId, message: 'ik wil nu afrekenen en betalen' });

  assert.match(body.reply, /kan ik hier niet|webshop|winkel/i);
  assert.equal(body.cart.itemCount, 1);
  assert.equal(body.cart.checkoutAvailable, false);
  assert.ok(!body.events.some((e) => /order|checkout|pay/i.test(e.tool)));
});

test('the product endpoint searches the assortment', async () => {
  const res = await get('/api/products?q=frites&limit=3');
  assert.ok(res.count > 0);
  assert.ok(res.products.every((p) => p.id && p.price > 0));
});
