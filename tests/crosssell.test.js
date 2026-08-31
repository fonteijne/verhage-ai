import test from 'node:test';
import assert from 'node:assert/strict';
import { addToCart, cartView } from '../server/cart.js';
import { suggestCrossSell } from '../server/crosssell.js';

const fresh = () => `xs-${Math.random().toString(36).slice(2)}`;
const names = (s) => s.map((x) => x.name);
const rules = (s) => s.map((x) => x.rule);

test('an empty cart is offered bestsellers', () => {
  const s = suggestCrossSell(cartView(fresh()));
  assert.ok(s.length > 0);
  assert.equal(s[0].rule, 'empty-cart-bestsellers');
});

test('a lone burger triggers fries and a drink', () => {
  const s = fresh();
  addToCart(s, 'cheeseburger', 1);
  const out = suggestCrossSell(cartView(s), { limit: 3 });
  assert.ok(rules(out).includes('fries-with-main'), rules(out));
  assert.ok(rules(out).includes('drink-with-food'), rules(out));
});

test('a menu already contains fries and a drink, so neither is pushed', () => {
  const s = fresh();
  addToCart(s, 'spareribsmenu', 1);
  const out = suggestCrossSell(cartView(s), { limit: 5 });
  assert.ok(!rules(out).includes('fries-with-main'), rules(out));
  assert.ok(!rules(out).includes('drink-with-food'), rules(out));
});

test('fries in the cart prompt a sauce', () => {
  const s = fresh();
  addToCart(s, 'frites-normaal', 1);
  const out = suggestCrossSell(cartView(s), { limit: 5 });
  assert.ok(rules(out).includes('sauce-with-fries'), rules(out));
});

test('a burger is offered its menu upgrade', () => {
  const s = fresh();
  addToCart(s, 'cheeseburger', 1);
  const out = suggestCrossSell(cartView(s), { limit: 5 });
  const upgrade = out.find((x) => x.kind === 'upgrade');
  assert.ok(upgrade, 'expected a menu upgrade');
  assert.match(upgrade.name, /menu/i);
});

test('nothing already in the cart is suggested again', () => {
  const s = fresh();
  addToCart(s, 'cheeseburger', 1);
  addToCart(s, 'frites-normaal', 1);
  addToCart(s, 'coca-cola', 1);
  const out = suggestCrossSell(cartView(s), { limit: 5 });
  const inCart = ['Cheeseburger', 'Frites normaal', 'Coca cola'];
  assert.ok(!names(out).some((n) => inCart.includes(n)), names(out));
});

test('declined products do not come back', () => {
  const s = fresh();
  addToCart(s, 'cheeseburger', 1);
  const first = suggestCrossSell(cartView(s), { limit: 1 })[0];
  const again = suggestCrossSell(cartView(s), { limit: 3, declined: [first.id] });
  assert.ok(!names(again).includes(first.name));
});

test('suggestions never repeat within one response', () => {
  const s = fresh();
  addToCart(s, 'cheeseburger', 1);
  const out = suggestCrossSell(cartView(s), { limit: 5 });
  assert.equal(new Set(out.map((x) => x.id)).size, out.length);
});

test('the limit is honoured', () => {
  const s = fresh();
  addToCart(s, 'cheeseburger', 1);
  assert.ok(suggestCrossSell(cartView(s), { limit: 2 }).length <= 2);
});

test('every suggestion explains itself and can be added', () => {
  const s = fresh();
  addToCart(s, 'cheeseburger', 1);
  for (const x of suggestCrossSell(cartView(s), { limit: 3 })) {
    assert.ok(x.reason && x.reason.length > 5, 'missing reason');
    assert.ok(x.id && x.price > 0);
    assert.ok(['completion', 'upgrade', 'suggestion'].includes(x.kind));
  }
});

test('a drink on its own prompts something to eat', () => {
  const s = fresh();
  addToCart(s, 'coca-cola', 1);
  const out = suggestCrossSell(cartView(s), { limit: 3 });
  assert.ok(rules(out).includes('snack-with-drink-only'), rules(out));
});
