import { TOOL_SCHEMAS, createToolExecutor } from '../tools.js';
import { SYSTEM_PROMPT } from '../prompt.js';

export const DEFAULT_MODEL = 'claude-opus-5';
// Taking an order is a simple, latency-sensitive task: keep thinking on (the
// default on Opus 5) but run it at low effort rather than disabling it.
const DEFAULT_EFFORT = 'low';
const MAX_TURNS = 8;

export const model = () => process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

export const isConfigured = () =>
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/** Runs one guest turn against the Anthropic Messages API. */
export async function run({ sessionId, message, history = [] }) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();

  const messages = [...history, { role: 'user', content: message }];
  const exec = createToolExecutor(sessionId);
  let reply = '';

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.messages.create({
        model: model(),
        max_tokens: 16000,
        output_config: { effort: process.env.ANTHROPIC_EFFORT || DEFAULT_EFFORT },
        system: SYSTEM_PROMPT,
        tools: TOOL_SCHEMAS,
        messages,
      });

      if (response.stop_reason === 'refusal') {
        return {
          reply: 'Sorry, daar kan ik niet mee helpen. Zullen we het over je bestelling hebben?',
          events: exec.events,
          history,
          cartChanged: exec.cartChanged,
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
      messages.push({
        role: 'user',
        content: toolUses.map((use) => {
          const result = exec.run(use.name, use.input);
          return {
            type: 'tool_result',
            tool_use_id: use.id,
            content: JSON.stringify(result),
            is_error: Boolean(result?.error),
          };
        }),
      });
    }
  } catch (err) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    if (err instanceof Anthropic.RateLimitError) {
      return {
        reply: 'Het is even druk. Probeer het zo nog eens.',
        events: exec.events,
        history,
        cartChanged: exec.cartChanged,
      };
    }
    if (err instanceof Anthropic.AuthenticationError) {
      err.recoverable = true; // let the caller fall back to the rule-based agent
    }
    throw err;
  }

  return {
    reply: reply || 'Sorry, dat lukte even niet. Wil je het anders formuleren?',
    events: exec.events,
    history: messages,
    cartChanged: exec.cartChanged,
  };
}
