import test from 'node:test';
import assert from 'node:assert/strict';
import { addToCart, cartView, clearCart, removeFromCart, updateCartItem } from '../server/cart.js';

const fresh = () => `cart-${Math.random().toString(36).slice(2)}`;

test('adding a product puts it in the cart with the right total', () => {
  const s = fresh();
  const res = addToCart(s, 'frites-normaal', 2);
  assert.equal(res.ok, true);
  const cart = cartView(s);
  assert.equal(cart.itemCount, 2);
  assert.equal(cart.items[0].lineTotal, 6.4);
  assert.equal(cart.subtotal, 6.4);
});

test('adding the same product twice merges onto one line', () => {
  const s = fresh();
  addToCart(s, 'frites-normaal', 1);
  addToCart(s, 'frites-normaal', 2);
  const cart = cartView(s);
  assert.equal(cart.items.length, 1);
  assert.equal(cart.itemCount, 3);
});

test('a different note keeps the lines apart', () => {
  const s = fresh();
  addToCart(s, 'frites-normaal', 1);
  addToCart(s, 'frites-normaal', 1, 'zonder zout');
  assert.equal(cartView(s).items.length, 2);
});

test('unknown products are rejected, not silently added', () => {
  const s = fresh();
  const res = addToCart(s, 'niet-bestaand-product');
  assert.equal(res.ok, false);
  assert.match(res.error, /Geen product/);
  assert.equal(cartView(s).itemCount, 0);
});

test('quantities are clamped to a sane range', () => {
  const s = fresh();
  assert.equal(addToCart(s, 'frites-normaal', 500).added.quantity, 20);
  const s2 = fresh();
  assert.equal(addToCart(s2, 'frites-normaal', 0).added.quantity, 1);
});

test('items can be updated by name and removed at quantity zero', () => {
  const s = fresh();
  addToCart(s, 'frites-normaal', 1);
  assert.equal(updateCartItem(s, 'Frites normaal', 4).updated.quantity, 4);
  assert.equal(updateCartItem(s, 'Frites normaal', 0).removed, 'Frites normaal');
  assert.equal(cartView(s).itemCount, 0);
});

test('removing something that is not there reports it', () => {
  const s = fresh();
  const res = removeFromCart(s, 'kaviaar');
  assert.equal(res.ok, false);
});

test('clearing empties the cart', () => {
  const s = fresh();
  addToCart(s, 'frites-normaal', 3);
  clearCart(s);
  assert.equal(cartView(s).itemCount, 0);
});

test('carts are isolated per session', () => {
  const a = fresh();
  const b = fresh();
  addToCart(a, 'frites-normaal', 1);
  assert.equal(cartView(b).itemCount, 0);
});

test('a cart holding a from-price item is marked as an estimate', () => {
  const s = fresh();
  addToCart(s, 'steakhouse-burger', 1);
  assert.equal(cartView(s).estimated, true);
});

test('every cart view states that checkout is unavailable', () => {
  const cart = cartView(fresh());
  assert.equal(cart.checkoutAvailable, false);
  assert.match(cart.checkoutMessage, /niet/i);
});
