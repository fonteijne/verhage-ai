/**
 * Minimal block/inline parser for assistant replies.
 *
 * Models reliably reach for markdown — "**Frites normaal** €3,20", bullet
 * lists, the occasional heading — regardless of what the prompt asks for. This
 * turns the common subset into structure the chat bubble can render, so a
 * reply reads as formatted text instead of showing raw asterisks.
 *
 * Deliberately tiny: bold, italic, bullet and numbered lists, headings. No
 * HTML is produced here — the caller builds React elements — so nothing in a
 * model's output can inject markup.
 */

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

/** Splits one line into plain / bold / italic runs. */
export function parseInline(text) {
  const parts = [];
  const pattern = /\*\*(.+?)\*\*|__(.+?)__|(?<![*\w])\*(?!\s)([^*]+?)(?<!\s)\*(?!\*)/g;
  let last = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push({ type: 'text', value: text.slice(last, match.index) });
    const bold = match[1] ?? match[2];
    if (bold !== undefined) parts.push({ type: 'bold', value: bold });
    else parts.push({ type: 'italic', value: match[3] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts.length ? parts : [{ type: 'text', value: text }];
}

/**
 * Groups lines into blocks.
 * @returns {Array<{type:'paragraph'|'heading', parts:object[]} | {type:'list', ordered:boolean, items:object[][]}>}
 */
export function parseBlocks(text) {
  const blocks = [];
  const lines = String(text ?? '').split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ type: 'heading', parts: parseInline(heading[1]) });
      continue;
    }

    const bullet = line.match(BULLET);
    const numbered = !bullet && line.match(NUMBERED);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const item = parseInline((bullet || numbered)[1]);
      const previous = blocks.at(-1);
      if (previous?.type === 'list' && previous.ordered === ordered) previous.items.push(item);
      else blocks.push({ type: 'list', ordered, items: [item] });
      continue;
    }

    blocks.push({ type: 'paragraph', parts: parseInline(line) });
  }

  return blocks;
}
