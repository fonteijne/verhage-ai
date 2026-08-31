import * as anthropic from './providers/anthropic.js';
import * as openrouter from './providers/openrouter.js';
import { runFallbackAgent } from './fallback.js';

/**
 * Provider selection.
 *
 * Every provider drives the identical tool set, so which one is active changes
 * the language understanding and nothing else — least of all the fact that the
 * agent cannot check out.
 */
const PROVIDERS = {
  anthropic: { ...anthropic, label: 'Claude' },
  openrouter: { ...openrouter, label: 'OpenRouter' },
};

const FALLBACK = {
  id: 'fallback',
  label: 'Regel-agent',
  model: () => 'rule-based',
  isConfigured: () => true,
  run: runFallbackAgent,
};

/**
 * Picks the provider for this process:
 *   1. AGENT_PROVIDER, when set (an explicit, unconfigured choice is an error
 *      worth failing loudly on rather than silently downgrading).
 *   2. Otherwise the first configured provider, Anthropic first.
 *   3. Otherwise the rule-based agent, which needs no credentials.
 */
export function selectProvider() {
  const requested = (process.env.AGENT_PROVIDER || '').trim().toLowerCase();

  if (requested) {
    if (requested === 'fallback' || requested === 'rule-based') return FALLBACK;
    const provider = PROVIDERS[requested];
    if (!provider) {
      throw new Error(
        `Onbekende AGENT_PROVIDER "${requested}". Kies uit: ${Object.keys(PROVIDERS).join(', ')}, fallback.`
      );
    }
    if (!provider.isConfigured()) {
      throw new Error(
        `AGENT_PROVIDER=${requested} is gekozen, maar de bijbehorende API-key ontbreekt ` +
          `(${requested === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENROUTER_API_KEY'}).`
      );
    }
    return { ...provider, id: requested };
  }

  for (const [id, provider] of Object.entries(PROVIDERS)) {
    if (provider.isConfigured()) return { ...provider, id };
  }
  return FALLBACK;
}

/** Describes the active provider, for /api/health and the UI badge. */
export function describeProvider() {
  try {
    const provider = selectProvider();
    return { id: provider.id, label: provider.label, model: provider.model() };
  } catch (err) {
    return { id: 'error', label: 'Configuratiefout', model: null, error: err.message };
  }
}

export const hasLLM = () => selectProvider().id !== 'fallback';

/**
 * Runs one guest turn to completion.
 *
 * @returns {Promise<{reply:string, events:object[], history:object[], cartChanged:boolean}>}
 */
export async function runAgent({ sessionId, message, history = [] }) {
  const provider = selectProvider();

  try {
    return await provider.run({ sessionId, message, history });
  } catch (err) {
    // A bad key should not take the app down: keep serving with the
    // rule-based agent and say so in the log.
    if (err.recoverable) {
      console.error(`[agent] ${provider.id}: ${err.message} — falling back to the rule-based agent`);
      return runFallbackAgent({ sessionId, message, history });
    }
    throw err;
  }
}
