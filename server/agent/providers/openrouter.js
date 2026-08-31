import { OPENAI_TOOL_SCHEMAS, createToolExecutor } from '../tools.js';
import { SYSTEM_PROMPT } from '../prompt.js';

/**
 * OpenRouter provider.
 *
 * OpenRouter exposes an OpenAI-compatible /chat/completions endpoint in front
 * of ~400 models, so the same agent can run on Claude, GPT, Llama or anything
 * else by changing one env var. The tools are the identical set the other
 * providers get — translated to OpenAI function shape in tools.js — so the
 * agent's capabilities, and the fact that it cannot check out, do not change
 * with the model behind it.
 */

export const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash-0731';
export const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const MAX_TURNS = 8;

export const model = () => process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

/**
 * Reasoning controls for models that think before answering.
 *
 * `exclude` is always on: we render only the final answer, and a reply
 * truncated mid-thought otherwise arrives with the raw chain of thought
 * sitting in `content`. Effort is left to the model's own default unless
 * OPENROUTER_REASONING_EFFORT names one — on the default free model, low
 * effort measured no faster than the default, and depth is worth more than
 * a speed guess. Set it to `off` for models that reject the parameter.
 */
function reasoningConfig() {
  const effort = (process.env.OPENROUTER_REASONING_EFFORT || '').trim().toLowerCase();
  if (effort === 'off') return undefined;
  return effort ? { effort, exclude: true } : { exclude: true };
}

export const isConfigured = () => Boolean(process.env.OPENROUTER_API_KEY);

async function createClient() {
  const { default: OpenAI } = await import('openai');
  return new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: process.env.OPENROUTER_BASE_URL || DEFAULT_BASE_URL,
    // Optional attribution headers OpenRouter uses for its app leaderboards.
    defaultHeaders: {
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://github.com/fonteijne/verhage-ai',
      'X-Title': process.env.OPENROUTER_APP_NAME || 'Verhage AI',
    },
  });
}

/**
 * Tool arguments arrive as a JSON *string*, and a model can emit a malformed
 * one. Report that back as a tool error so the model can retry, rather than
 * throwing away the turn.
 */
function parseArguments(raw) {
  if (!raw || !raw.trim()) return { ok: true, value: {} };
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === 'object' && !Array.isArray(value)) return { ok: true, value };
    return { ok: false, error: 'Tool-argumenten moeten een JSON-object zijn.' };
  } catch (err) {
    return { ok: false, error: `Ongeldige JSON in tool-argumenten: ${err.message}` };
  }
}

/** Runs one guest turn against OpenRouter. */
export async function run({ sessionId, message, history = [] }) {
  const client = await createClient();

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: message },
  ];
  const exec = createToolExecutor(sessionId);
  let reply = '';

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const reasoning = reasoningConfig();
      const response = await client.chat.completions.create({
        model: model(),
        // Generous, because reasoning tokens count against this and a
        // truncated turn loses the whole answer.
        max_tokens: 8192,
        messages,
        tools: OPENAI_TOOL_SCHEMAS,
        tool_choice: 'auto',
        ...(reasoning ? { reasoning } : {}),
      });

      // OpenRouter surfaces upstream provider failures in the body.
      if (response.error) throw new Error(response.error.message || 'OpenRouter-fout.');
      const choice = response.choices?.[0];
      if (!choice) throw new Error('OpenRouter gaf geen antwoord terug.');

      const assistant = choice.message;
      // Send back only the fields the API defines. Reasoning traces are
      // per-provider extras and re-posting them can be rejected upstream.
      messages.push({
        role: 'assistant',
        content: assistant.content ?? null,
        ...(assistant.tool_calls ? { tool_calls: assistant.tool_calls } : {}),
      });

      if (assistant.content?.trim()) reply = assistant.content.trim();

      const toolCalls = assistant.tool_calls || [];
      if (!toolCalls.length) {
        // Cut off mid-answer: better to say so than to show half a sentence.
        if (choice.finish_reason === 'length' && !reply) {
          reply = 'Sorry, mijn antwoord werd afgekapt. Wil je het nog een keer vragen?';
        }
        break;
      }

      // Every tool_call must get a matching tool message, or the next request
      // is rejected for an unanswered call.
      for (const call of toolCalls) {
        const parsed = parseArguments(call.function?.arguments);
        const result = parsed.ok
          ? exec.run(call.function.name, parsed.value)
          : { error: parsed.error };

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }
  } catch (err) {
    const { default: OpenAI } = await import('openai');
    if (err instanceof OpenAI.RateLimitError) {
      return {
        reply: 'Het is even druk. Probeer het zo nog eens.',
        events: exec.events,
        history,
        cartChanged: exec.cartChanged,
      };
    }
    if (err instanceof OpenAI.AuthenticationError) {
      err.recoverable = true; // let the caller fall back to the rule-based agent
    }
    throw err;
  }

  return {
    reply: reply || 'Sorry, dat lukte even niet. Wil je het anders formuleren?',
    events: exec.events,
    // The system prompt is re-added each turn, so it stays out of the history.
    history: messages.filter((m) => m.role !== 'system'),
    cartChanged: exec.cartChanged,
  };
}
