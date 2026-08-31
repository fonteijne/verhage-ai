import test from 'node:test';
import assert from 'node:assert/strict';
import { runFallbackAgent } from '../server/agent/fallback.js';
import { cartView } from '../server/cart.js';

/** Multi-turn behaviour of the built-in agent, as a guest would experience it. */

const fresh = () => `conv-${Math.random().toString(36).slice(2)}`;
const say = (sessionId, message) => runFallbackAgent({ sessionId, message });

test('a guest can order, accept a suggestion and see the total', async () => {
  const s = fresh();
  await say(s, 'ik wil graag een cheeseburger');
  assert.equal(cartView(s).itemCount, 1);

  // "ja graag" refers to whatever was just offered.
  const accepted = await say(s, 'ja graag');
  assert.equal(cartView(s).itemCount, 2);
  assert.match(accepted.reply, /staat erbij/i);

  const overview = await say(s, 'wat staat er in mijn bestelling?');
  assert.match(overview.reply, /subtotaal/i);
});

test('saying no keeps that suggestion from coming back', async () => {
  const s = fresh();
  await say(s, 'ik wil een cheeseburger');
  const offered = await say(s, 'nee');
  assert.match(offered.reply, /laat maar zitten/i);

  const next = await say(s, 'wat staat er in mijn bestelling?');
  assert.equal(cartView(s).itemCount, 1);
  assert.ok(next);
});

test('quantities in plain language are understood', async () => {
  const s = fresh();
  await say(s, 'doe maar 3 kroketten');
  assert.equal(cartView(s).itemCount, 3);
});

test('a guest can remove something again', async () => {
  const s = fresh();
  await say(s, 'doe maar een coca cola');
  assert.equal(cartView(s).itemCount, 1);
  const res = await say(s, 'haal de coca cola weg');
  assert.match(res.reply, /eruit/i);
  assert.equal(cartView(s).itemCount, 0);
});

test('dietary wishes are turned into filters', async () => {
  const s = fresh();
  const veg = await say(s, 'iets vegetarisch');
  assert.match(veg.reply, /loempia|veggie|vega/i);

  const gf = await say(fresh(), 'iets glutenvrij');
  assert.match(gf.reply, /glutenvrij/i);

  const halal = await say(fresh(), 'wat hebben jullie halal?');
  assert.match(halal.reply, /halal/i);
});

test('every add is followed by an explained cross-sell offer', async () => {
  const s = fresh();
  const res = await say(s, 'ik wil een cheeseburger');
  const offer = res.events.find((e) => e.tool === 'suggest_cross_sell');
  assert.ok(offer, 'expected the agent to look for cross-sell options');
  assert.ok(offer.result.suggestions.length > 0);
  assert.ok(offer.result.suggestions.every((x) => x.reason && x.name));
});

test('unknown products are reported honestly, not substituted', async () => {
  const s = fresh();
  const res = await say(s, 'doe maar een pizza quattro stagioni');
  assert.match(res.reply, /niet vinden/i);
  assert.equal(cartView(s).itemCount, 0);
});

test('the cart can be emptied on request', async () => {
  const s = fresh();
  await say(s, 'doe maar een cheeseburger');
  await say(s, 'maak mijn bestelling leeg');
  assert.equal(cartView(s).itemCount, 0);
});

test('an ambiguous request asks instead of guessing', async () => {
  const s = fresh();
  const res = await say(s, 'een burger');
  assert.match(res.reply, /welke bedoel je/i);
  assert.equal(cartView(s).itemCount, 0);
});
