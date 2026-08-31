import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBlocks, parseInline } from '../src/lib/richtext.js';

const flat = (parts) => parts.map((p) => `${p.type}:${p.value}`).join('|');

test('plain text stays plain', () => {
  assert.equal(flat(parseInline('Frites normaal kost 3,20')), 'text:Frites normaal kost 3,20');
});

test('bold runs are extracted', () => {
  assert.equal(
    flat(parseInline('**Frites normaal** €3,20')),
    'bold:Frites normaal|text: €3,20'
  );
  assert.equal(flat(parseInline('__Cheeseburger__')), 'bold:Cheeseburger');
});

test('italic runs are extracted without eating bold', () => {
  assert.equal(flat(parseInline('*lekker*')), 'italic:lekker');
  assert.equal(flat(parseInline('**echt** *lekker*')), 'bold:echt|text: |italic:lekker');
});

test('a lone asterisk is left alone', () => {
  assert.equal(flat(parseInline('5 * 3 = 15')), 'text:5 * 3 = 15');
});

test('prices with asterisks around them do not break', () => {
  assert.equal(flat(parseInline('Subtotaal **€8,35**')), 'text:Subtotaal |bold:€8,35');
});

test('paragraphs and blank lines', () => {
  const blocks = parseBlocks('Hoi!\n\nWaar heb je zin in?');
  assert.equal(blocks.length, 2);
  assert.ok(blocks.every((b) => b.type === 'paragraph'));
});

test('bullet lists are grouped into one list', () => {
  const blocks = parseBlocks('Dit kan:\n- Frites normaal\n- Coca cola\nNog iets?');
  assert.deepEqual(blocks.map((b) => b.type), ['paragraph', 'list', 'paragraph']);
  assert.equal(blocks[1].items.length, 2);
  assert.equal(blocks[1].ordered, false);
});

test('numbered lists are marked ordered and kept separate from bullets', () => {
  const blocks = parseBlocks('1. Frites\n2. Cola\n- Saus');
  assert.deepEqual(blocks.map((b) => b.type), ['list', 'list']);
  assert.equal(blocks[0].ordered, true);
  assert.equal(blocks[0].items.length, 2);
  assert.equal(blocks[1].ordered, false);
});

test('headings become their own block', () => {
  const blocks = parseBlocks('## Je bestelling\nCheeseburger');
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'paragraph']);
  assert.equal(flat(blocks[0].parts), 'text:Je bestelling');
});

test('list items keep their inline formatting', () => {
  const blocks = parseBlocks('- **Frites normaal** €3,20');
  assert.equal(flat(blocks[0].items[0]), 'bold:Frites normaal|text: €3,20');
});

test('empty input yields no blocks', () => {
  assert.deepEqual(parseBlocks(''), []);
  assert.deepEqual(parseBlocks(null), []);
});

test('a real DeepSeek reply parses into the expected shape', () => {
  const reply = [
    'Daar staat je bestelling zo:',
    '',
    '**Cheeseburger** €5,15',
    '**Frites normaal** €3,20',
    '**Subtotaal** €8,35',
    '',
    'Zin in een drankje erbij?',
  ].join('\n');
  const blocks = parseBlocks(reply);
  assert.ok(blocks.every((b) => b.type === 'paragraph'));
  assert.equal(blocks.length, 5);
  assert.equal(flat(blocks[1].parts), 'bold:Cheeseburger|text: €5,15');
});
