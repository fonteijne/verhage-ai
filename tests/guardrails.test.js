import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, TOOL_SCHEMAS, runTool } from '../server/agent/tools.js';
import { SYSTEM_PROMPT } from '../server/agent/prompt.js';
import { runFallbackAgent } from '../server/agent/fallback.js';
import { cartView } from '../server/cart.js';

const fresh = () => `guard-${Math.random().toString(36).slice(2)}`;

/**
 * The product constraint: the agent may fill a cart and nothing else. These
 * tests assert the capability simply does not exist, rather than trusting the
 * model to decline.
 */

test('no tool can order, check out, schedule or pay', () => {
  const forbidden = /checkout|order|purchase|buy|pay|payment|betaal|afreken|bestel|submit|confirm/i;
  for (const tool of TOOL_SCHEMAS) {
    assert.ok(!forbidden.test(tool.name), `forbidden capability exposed: ${tool.name}`);
  }
});

test('the tool surface is exactly the read + cart set', () => {
  assert.deepEqual(
    TOOL_SCHEMAS.map((t) => t.name).sort(),
    [
      'add_to_cart', 'clear_cart', 'get_product', 'remove_from_cart',
      'search_products', 'suggest_cross_sell', 'update_cart_item', 'view_cart',
    ]
  );
});

test('every tool handler is defined and callable', () => {
  for (const tool of TOOLS) assert.equal(typeof tool.handler, 'function', tool.name);
});

test('calling a checkout-like tool is refused rather than improvised', () => {
  for (const name of ['place_order', 'checkout', 'pay', 'submit_order']) {
    const res = runTool(name, {}, { sessionId: fresh() });
    assert.ok(res.error, `${name} should not succeed`);
    assert.match(res.error, /Onbekende tool/);
  }
});

test('tool schemas are valid Anthropic tool definitions', () => {
  for (const tool of TOOL_SCHEMAS) {
    assert.match(tool.name, /^[a-z][a-z0-9_]{0,63}$/, `bad tool name: ${tool.name}`);
    assert.ok(tool.description?.length > 20, `thin description on ${tool.name}`);
    assert.equal(tool.input_schema.type, 'object', tool.name);
    assert.ok(tool.input_schema.properties, tool.name);
    for (const req of tool.input_schema.required || []) {
      assert.ok(req in tool.input_schema.properties, `${tool.name} requires undeclared "${req}"`);
    }
    // The schema must survive the JSON round-trip the SDK performs.
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(tool)));
  }
});

test('tool results serialise to valid JSON for the model', () => {
  const s = fresh();
  const found = runTool('search_products', { query: 'frites', limit: 2 }, { sessionId: s });
  const added = runTool('add_to_cart', { productId: 'frites-normaal' }, { sessionId: s });
  for (const result of [found, added, runTool('view_cart', {}, { sessionId: s })]) {
    const round = JSON.parse(JSON.stringify(result));
    assert.deepEqual(round, result);
  }
});

test('the system prompt tells the model it cannot check out', () => {
  assert.match(SYSTEM_PROMPT, /afrekenen/i);
  assert.match(SYSTEM_PROMPT, /betalen/i);
  assert.match(SYSTEM_PROMPT, /nooit een bestelnummer/i);
});

test('a tool error never crashes the agent loop', () => {
  const res = runTool('add_to_cart', { productId: null }, { sessionId: fresh() });
  assert.equal(res.ok, false);
});

for (const ask of [
  'ik wil afrekenen',
  'plaats de bestelling',
  'kan ik betalen met ideal?',
  'reken maar af met creditcard',
  'bestel dit voor mij',
]) {
  test(`the agent declines: "${ask}"`, async () => {
    const s = fresh();
    const res = await runFallbackAgent({ sessionId: s, message: ask });
    assert.match(res.reply, /kan ik hier niet|niet mogelijk|webshop|winkel/i);
    // It must not invent an order number or confirmation.
    assert.ok(!/bestelnummer|ordernummer|betaald|bevestigd/i.test(res.reply), res.reply);
    // And it must not have mutated anything beyond the cart.
    assert.equal(cartView(s).checkoutAvailable, false);
  });
}

test('declining checkout still leaves the cart intact', async () => {
  const s = fresh();
  await runFallbackAgent({ sessionId: s, message: 'een cheeseburger' });
  const before = cartView(s).itemCount;
  await runFallbackAgent({ sessionId: s, message: 'ik wil nu afrekenen en betalen' });
  assert.equal(cartView(s).itemCount, before);
});

test('only cart tools are marked as mutating', async () => {
  const s = fresh();
  const res = await runFallbackAgent({ sessionId: s, message: 'wat hebben jullie te drinken?' });
  assert.equal(res.cartChanged, false);
  assert.equal(cartView(s).itemCount, 0);
});
