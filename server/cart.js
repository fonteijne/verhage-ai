import { randomUUID } from 'node:crypto';
import { getProduct } from './catalog.js';

/**
 * In-memory carts, keyed by session id.
 *
 * A cart is the ONLY mutable state in this app. There is deliberately no
 * order, checkout, payment or submission function anywhere in this module —
 * the assistant can compose a basket and nothing more.
 */
const carts = new Map();

const round = (n) => Math.round(n * 100) / 100;

export function getCart(sessionId) {
  if (!carts.has(sessionId)) {
    carts.set(sessionId, { sessionId, items: [], createdAt: new Date().toISOString() });
  }
  return carts.get(sessionId);
}

export function cartView(sessionId) {
  const cart = getCart(sessionId);
  const items = cart.items.map((i) => ({ ...i, lineTotal: round(i.price * i.quantity) }));
  const subtotal = round(items.reduce((s, i) => s + i.lineTotal, 0));
  const itemCount = items.reduce((s, i) => s + i.quantity, 0);
  return {
    items,
    itemCount,
    subtotal,
    // Any line whose price is a starting price makes the total indicative.
    estimated: items.some((i) => i.priceFrom),
    currency: 'EUR',
    checkoutAvailable: false,
    checkoutMessage:
      'Afrekenen en betalen kan hier niet. Rond je bestelling af in de Verhage-webshop of in de winkel.',
  };
}

export function addToCart(sessionId, productId, quantity = 1, note = '') {
  const product = getProduct(productId);
  if (!product) return { ok: false, error: `Geen product gevonden met id ${productId}.` };

  const qty = Math.max(1, Math.min(Math.trunc(Number(quantity) || 1), 20));
  const cart = getCart(sessionId);
  const cleanNote = String(note || '').slice(0, 200).trim();

  // Same product + same note collapses onto one line.
  const existing = cart.items.find((i) => i.productId === product.id && i.note === cleanNote);
  if (existing) {
    existing.quantity = Math.min(existing.quantity + qty, 20);
  } else {
    cart.items.push({
      lineId: randomUUID(),
      productId: product.id,
      name: product.name,
      price: product.price,
      priceFrom: Boolean(product.priceFrom),
      category: product.category,
      tags: product.tags,
      image: product.image,
      quantity: qty,
      note: cleanNote,
    });
  }
  return { ok: true, added: { id: product.id, name: product.name, quantity: qty }, cart: cartView(sessionId) };
}

export function updateCartItem(sessionId, ref, quantity) {
  const cart = getCart(sessionId);
  const item = findLine(cart, ref);
  if (!item) return { ok: false, error: `Regel "${ref}" staat niet in de bestelling.` };

  const qty = Math.trunc(Number(quantity));
  if (Number.isNaN(qty)) return { ok: false, error: 'quantity moet een getal zijn.' };

  if (qty <= 0) {
    cart.items = cart.items.filter((i) => i.lineId !== item.lineId);
    return { ok: true, removed: item.name, cart: cartView(sessionId) };
  }
  item.quantity = Math.min(qty, 20);
  return { ok: true, updated: { name: item.name, quantity: item.quantity }, cart: cartView(sessionId) };
}

export function removeFromCart(sessionId, ref) {
  const cart = getCart(sessionId);
  const item = findLine(cart, ref);
  if (!item) return { ok: false, error: `Regel "${ref}" staat niet in de bestelling.` };
  cart.items = cart.items.filter((i) => i.lineId !== item.lineId);
  return { ok: true, removed: item.name, cart: cartView(sessionId) };
}

export function clearCart(sessionId) {
  getCart(sessionId).items = [];
  return { ok: true, cart: cartView(sessionId) };
}

/** Accepts a lineId, a numeric product id, or a product name. */
function findLine(cart, ref) {
  const key = String(ref ?? '').trim();
  if (!key) return null;
  return (
    cart.items.find((i) => i.lineId === key) ||
    cart.items.find((i) => String(i.productId) === key) ||
    cart.items.find((i) => i.name.toLowerCase() === key.toLowerCase()) ||
    cart.items.find((i) => i.name.toLowerCase().includes(key.toLowerCase())) ||
    null
  );
}

export const __testing = { carts };
