import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { cartView } from '../server/cart.js';
import { OPENAI_TOOL_SCHEMAS, TOOL_SCHEMAS } from '../server/agent/tools.js';

/**
 * Exercises the OpenRouter provider against a stub of the OpenAI-compatible
 * chat completions endpoint, so the tool-calling round trip is tested for real
 * without needing a key or spending money.
 */

/** Queue of canned assistant messages the stub returns, in order. */
let scripted = [];
/** Every request body the provider sent, for asserting the wire format. */
let received = [];

const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    received.push({ url: req.url, headers: req.headers, body: JSON.parse(body || '{}') });
    const next = scripted.shift() || { role: 'assistant', content: 'Klaar.' };
    // A scripted entry may pin finish_reason (e.g. 'length' for truncation).
    const { __finish, ...message } = next;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'chatcmpl-stub',
        model: 'stub/model',
        choices: [
          {
            index: 0,
            message,
            finish_reason: __finish || (message.tool_calls ? 'tool_calls' : 'stop'),
          },
        ],
      })
    );
  });
});

await new Promise((resolve) => stub.listen(0, resolve));

process.env.OPENROUTER_API_KEY = 'test-key';
process.env.OPENROUTER_BASE_URL = `http://localhost:${stub.address().port}`;
process.env.OPENROUTER_MODEL = 'stub/model';

const { run, isConfigured, model, DEFAULT_MODEL } = await import('../server/agent/providers/openrouter.js');

test.after(() => stub.close());

const fresh = () => `or-${Math.random().toString(36).slice(2)}`;
const reset = () => {
  scripted = [];
  received = [];
};

const toolCall = (id, name, args) => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

test('the provider reports itself configured from OPENROUTER_API_KEY', () => {
  assert.equal(isConfigured(), true);
  assert.equal(model(), 'stub/model');
  assert.equal(DEFAULT_MODEL, 'deepseek/deepseek-v4-flash-0731');
});

test('reasoning output is excluded by default, effort left to the model', async () => {
  reset();
  scripted = [{ role: 'assistant', content: 'ok' }];
  await run({ sessionId: fresh(), message: 'hoi' });
  assert.deepEqual(received[0].body.reasoning, { exclude: true });
});

test('an explicit reasoning effort is passed through', async () => {
  reset();
  scripted = [{ role: 'assistant', content: 'ok' }];
  process.env.OPENROUTER_REASONING_EFFORT = 'high';
  await run({ sessionId: fresh(), message: 'hoi' });
  delete process.env.OPENROUTER_REASONING_EFFORT;
  assert.deepEqual(received[0].body.reasoning, { effort: 'high', exclude: true });
});

test('OPENROUTER_REASONING_EFFORT=off omits the parameter entirely', async () => {
  reset();
  scripted = [{ role: 'assistant', content: 'ok' }];
  process.env.OPENROUTER_REASONING_EFFORT = 'off';
  await run({ sessionId: fresh(), message: 'hoi' });
  delete process.env.OPENROUTER_REASONING_EFFORT;
  assert.equal(received[0].body.reasoning, undefined);
});

test('provider-specific reasoning traces are not echoed back upstream', async () => {
  reset();
  scripted = [
    {
      role: 'assistant',
      content: null,
      reasoning: 'laat me even nadenken',
      reasoning_details: [{ type: 'reasoning.text', text: 'laat me even nadenken' }],
      tool_calls: [toolCall('r1', 'view_cart', {})],
    },
    { role: 'assistant', content: 'Je bestelling is leeg.' },
  ];

  await run({ sessionId: fresh(), message: 'wat heb ik?' });

  const echoed = received[1].body.messages.find((m) => m.role === 'assistant');
  assert.deepEqual(Object.keys(echoed).sort(), ['content', 'role', 'tool_calls']);
});

test('a reply truncated by max_tokens says so rather than showing nothing', async () => {
  reset();
  scripted = [{ role: 'assistant', content: '', __finish: 'length' }];
  const res = await run({ sessionId: fresh(), message: 'hoi' });
  assert.match(res.reply, /afgekapt/i);
});

test('a truncated reply that still has text keeps the text', async () => {
  reset();
  scripted = [{ role: 'assistant', content: 'Je hebt een cheeseburger', __finish: 'length' }];
  const res = await run({ sessionId: fresh(), message: 'hoi' });
  assert.equal(res.reply, 'Je hebt een cheeseburger');
});

test('tools are sent in OpenAI function shape with the system prompt', async () => {
  reset();
  scripted = [{ role: 'assistant', content: 'Hoi!' }];
  await run({ sessionId: fresh(), message: 'hoi' });

  const sent = received[0].body;
  assert.equal(sent.model, 'stub/model');
  assert.equal(sent.messages[0].role, 'system');
  assert.match(sent.messages[0].content, /afrekenen/i);
  assert.equal(sent.messages.at(-1).content, 'hoi');
  assert.equal(sent.tools.length, TOOL_SCHEMAS.length);
  for (const tool of sent.tools) {
    assert.equal(tool.type, 'function');
    assert.ok(tool.function.name && tool.function.description);
    assert.equal(tool.function.parameters.type, 'object');
  }
});

test('OpenRouter attribution headers are sent', async () => {
  reset();
  scripted = [{ role: 'assistant', content: 'ok' }];
  await run({ sessionId: fresh(), message: 'hoi' });
  assert.equal(received[0].headers.authorization, 'Bearer test-key');
  assert.ok(received[0].headers['http-referer']);
  assert.ok(received[0].headers['x-title']);
});

test('a tool call runs and its result is returned as a tool message', async () => {
  reset();
  const session = fresh();
  scripted = [
    { role: 'assistant', content: null, tool_calls: [toolCall('c1', 'add_to_cart', { productId: 'frites-normaal', quantity: 2 })] },
    { role: 'assistant', content: '2× Frites normaal staat erin.' },
  ];

  const res = await run({ sessionId: session, message: 'twee frites' });

  assert.equal(res.reply, '2× Frites normaal staat erin.');
  assert.equal(res.cartChanged, true);
  assert.equal(cartView(session).itemCount, 2);
  assert.deepEqual(res.events.map((e) => e.tool), ['add_to_cart']);

  // The follow-up request must carry a tool message keyed to the call id.
  const followUp = received[1].body.messages;
  const toolMessage = followUp.find((m) => m.role === 'tool');
  assert.equal(toolMessage.tool_call_id, 'c1');
  assert.equal(JSON.parse(toolMessage.content).ok, true);
});

test('several tool calls in one turn each get their own reply', async () => {
  reset();
  const session = fresh();
  scripted = [
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        toolCall('a', 'add_to_cart', { productId: 'frites-normaal' }),
        toolCall('b', 'add_to_cart', { productId: 'coca-cola' }),
      ],
    },
    { role: 'assistant', content: 'Toegevoegd.' },
  ];

  await run({ sessionId: session, message: 'friet en cola' });

  assert.equal(cartView(session).itemCount, 2);
  const toolMessages = received[1].body.messages.filter((m) => m.role === 'tool');
  assert.deepEqual(toolMessages.map((m) => m.tool_call_id), ['a', 'b']);
});

test('malformed tool arguments come back as a tool error, not a crash', async () => {
  reset();
  const session = fresh();
  scripted = [
    { role: 'assistant', content: null, tool_calls: [{ id: 'bad', type: 'function', function: { name: 'add_to_cart', arguments: '{not json' } }] },
    { role: 'assistant', content: 'Sorry, dat ging mis.' },
  ];

  const res = await run({ sessionId: session, message: 'iets' });

  assert.equal(res.reply, 'Sorry, dat ging mis.');
  assert.equal(cartView(session).itemCount, 0);
  const toolMessage = received[1].body.messages.find((m) => m.role === 'tool');
  assert.match(JSON.parse(toolMessage.content).error, /Ongeldige JSON/);
});

test('an invented checkout tool is refused on this provider too', async () => {
  reset();
  const session = fresh();
  scripted = [
    { role: 'assistant', content: null, tool_calls: [toolCall('x', 'place_order', {})] },
    { role: 'assistant', content: 'Afrekenen kan hier niet.' },
  ];

  await run({ sessionId: session, message: 'bestel maar' });

  const toolMessage = received[1].body.messages.find((m) => m.role === 'tool');
  assert.match(JSON.parse(toolMessage.content).error, /Onbekende tool/);
  assert.equal(cartView(session).checkoutAvailable, false);
});

test('no checkout-shaped tool is ever offered to the model', async () => {
  reset();
  scripted = [{ role: 'assistant', content: 'ok' }];
  await run({ sessionId: fresh(), message: 'hoi' });

  const names = received[0].body.tools.map((t) => t.function.name);
  assert.deepEqual(names.sort(), OPENAI_TOOL_SCHEMAS.map((t) => t.function.name).sort());
  assert.ok(!names.some((n) => /checkout|order|pay|purchase|betaal|afreken/i.test(n)), names);
});

test('the system prompt is kept out of the returned history', async () => {
  reset();
  scripted = [{ role: 'assistant', content: 'Hoi!' }];
  const res = await run({ sessionId: fresh(), message: 'hoi' });
  assert.ok(!res.history.some((m) => m.role === 'system'));
  assert.equal(res.history[0].role, 'user');
});

test('an upstream provider error is surfaced, not swallowed', async () => {
  reset();
  const failing = http.createServer((req, res) => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'upstream is down' } }));
  });
  await new Promise((r) => failing.listen(0, r));
  const previous = process.env.OPENROUTER_BASE_URL;
  process.env.OPENROUTER_BASE_URL = `http://localhost:${failing.address().port}`;

  await assert.rejects(() => run({ sessionId: fresh(), message: 'hoi' }));

  process.env.OPENROUTER_BASE_URL = previous;
  failing.close();
});
