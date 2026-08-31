import { MUTATING_TOOLS, TOOL_SCHEMAS, runTool } from './tools.js';
import { SYSTEM_PROMPT } from './prompt.js';
import { runFallbackAgent } from './fallback.js';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
// Taking an order is a simple, latency-sensitive task: keep thinking on (the
// default on Opus 5) but run it at low effort rather than disabling it.
const EFFORT = process.env.ANTHROPIC_EFFORT || 'low';
const MAX_TURNS = 8;

export const hasLLM = () =>
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/**
 * Runs one guest turn to completion.
 *
 * Returns the assistant's reply plus a trace of every tool call, so the UI can
 * show what the agent actually did — including that it never had a way to
 * check out.
 *
 * @returns {Promise<{reply:string, events:object[], history:object[], cartChanged:boolean}>}
 */
export async function runAgent({ sessionId, message, history = [] }) {
  if (!hasLLM()) return runFallbackAgent({ sessionId, message, history });

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();

  const messages = [...history, { role: 'user', content: message }];
  const events = [];
  let cartChanged = false;
  let reply = '';

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: EFFORT },
        system: SYSTEM_PROMPT,
        tools: TOOL_SCHEMAS,
        messages,
      });

      if (response.stop_reason === 'refusal') {
        return {
          reply: 'Sorry, daar kan ik niet mee helpen. Zullen we het over je bestelling hebben?',
          events,
          history,
          cartChanged,
        };
      }

      messages.push({ role: 'assistant', content: response.content });

      const toolUses = response.content.filter((b) => b.type === 'tool_use');
      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      if (text) reply = text;

      if (!toolUses.length) break;

      // All tool results for one assistant turn go back in a single user
      // message, otherwise the model stops issuing parallel calls.
      const results = [];
      for (const use of toolUses) {
        const result = runTool(use.name, use.input, { sessionId });
        if (MUTATING_TOOLS.has(use.name) && result?.ok) cartChanged = true;
        events.push({ tool: use.name, input: use.input, result });
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: JSON.stringify(result),
          is_error: Boolean(result?.error),
        });
      }
      messages.push({ role: 'user', content: results });
    }
  } catch (err) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    if (err instanceof Anthropic.RateLimitError) {
      return { reply: 'Het is even druk. Probeer het zo nog eens.', events, history, cartChanged };
    }
    if (err instanceof Anthropic.AuthenticationError) {
      console.error('[agent] invalid ANTHROPIC_API_KEY — falling back to the rule-based agent');
      return runFallbackAgent({ sessionId, message, history });
    }
    throw err;
  }

  return {
    reply: reply || 'Sorry, dat lukte even niet. Wil je het anders formuleren?',
    events,
    history: messages,
    cartChanged,
  };
}
