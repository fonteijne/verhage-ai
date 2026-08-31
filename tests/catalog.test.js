import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, getProduct, searchProducts } from '../server/catalog.js';

test('catalog loads with the full Verhage assortment', () => {
  assert.ok(catalog.products.length > 150, 'expected a substantial assortment');
  assert.equal(catalog.store.name, 'Verhage Hoofddorp');
  assert.ok(catalog.categories.length >= 15);
});

test('every product is usable: unique id, name, positive price, category', () => {
  const ids = new Set();
  for (const p of catalog.products) {
    assert.ok(p.id && typeof p.id === 'string', `bad id on ${p.name}`);
    assert.ok(!ids.has(p.id), `duplicate id ${p.id}`);
    ids.add(p.id);
    assert.ok(p.name && !/dummy/i.test(p.name), `bad name: ${p.name}`);
    assert.ok(p.price > 0, `non-positive price on ${p.name}`);
    assert.ok(p.category, `missing category on ${p.name}`);
    assert.ok(Array.isArray(p.tags) && Array.isArray(p.allergens));
  }
});

test('no duplicate product names', () => {
  const names = catalog.products.map((p) => p.name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
});

test('the key categories all carry products', () => {
  for (const name of ['Burgers', 'Frites', 'Dranken', 'Sauzen', 'Snacks']) {
    const count = catalog.products.filter((p) => p.categories.includes(name)).length;
    assert.ok(count > 0, `category ${name} is empty`);
  }
});

test('getProduct resolves by id and by name', () => {
  const p = catalog.products.find((x) => x.name === 'Frites normaal');
  assert.equal(getProduct(p.id).name, 'Frites normaal');
  assert.equal(getProduct('Frites normaal').id, p.id);
  assert.equal(getProduct('does-not-exist'), null);
});

test('search finds products by their Dutch name', () => {
  assert.equal(searchProducts({ query: 'kipfiletburger' })[0].name, 'Kipfiletburger');
  assert.equal(searchProducts({ query: 'cola' })[0].name, 'Coca cola');
  assert.equal(searchProducts({ query: 'frites groot' })[0].name, 'Frites groot');
});

test('search understands synonyms and conversational phrasing', () => {
  assert.equal(searchProducts({ query: 'patat' })[0].name, 'Frites normaal');
  assert.equal(searchProducts({ query: 'ik wil graag een hamburger' })[0].tags.includes('burger'), true);
  assert.ok(searchProducts({ query: 'drankje' }).every((p) => p.tags.includes('drink')));
  assert.ok(searchProducts({ query: 'sausje' }).every((p) => p.tags.includes('sauce')));
});

test('search does not match a word buried inside another word', () => {
  // "cola" sits inside "chocolade" — that must not surface a muffin.
  const names = searchProducts({ query: 'cola' }).map((p) => p.name);
  assert.ok(!names.some((n) => /muffin/i.test(n)), `leaked: ${names}`);
});

test('search returns nothing for gibberish', () => {
  assert.deepEqual(searchProducts({ query: 'qzxwvq' }), []);
});

test('filters narrow results as asked', () => {
  assert.ok(searchProducts({ category: 'Dranken' }).every((p) => p.categories.includes('Dranken')));
  assert.ok(searchProducts({ tags: ['vegetarian'] }).every((p) => p.tags.includes('vegetarian')));
  assert.ok(searchProducts({ maxPrice: 3 }).every((p) => p.price <= 3));
});

test('allergen exclusion is respected', () => {
  const safe = searchProducts({ query: 'burger', excludeAllergens: ['Gluten'], limit: 20 });
  assert.ok(safe.every((p) => !p.allergens.includes('Gluten')));
});

test('configurable products are flagged as from-prices', () => {
  const burger = catalog.products.find((p) => p.name === 'Steakhouse burger');
  assert.equal(burger.priceFrom, true);
  assert.equal(burger.hasOptions, true);
});
