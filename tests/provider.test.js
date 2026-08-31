import test from 'node:test';
import assert from 'node:assert/strict';

/** Provider selection is env-driven, so each case sets and restores env. */
const KEYS = ['AGENT_PROVIDER', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENROUTER_API_KEY'];

const { selectProvider, describeProvider, hasLLM } = await import('../server/agent/index.js');

const withEnv = (env, fn) => {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const k of KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
};

test('with no credentials the rule-based agent is used', () => {
  withEnv({}, () => {
    assert.equal(selectProvider().id, 'fallback');
    assert.equal(hasLLM(), false);
  });
});

test('an OpenRouter key alone selects OpenRouter', () => {
  withEnv({ OPENROUTER_API_KEY: 'k' }, () => {
    const p = describeProvider();
    assert.equal(p.id, 'openrouter');
    assert.equal(p.model, 'anthropic/claude-opus-5');
    assert.equal(hasLLM(), true);
  });
});

test('an Anthropic key alone selects Anthropic', () => {
  withEnv({ ANTHROPIC_API_KEY: 'k' }, () => {
    assert.equal(describeProvider().id, 'anthropic');
  });
});

test('with both keys Anthropic wins by default', () => {
  withEnv({ ANTHROPIC_API_KEY: 'k', OPENROUTER_API_KEY: 'k' }, () => {
    assert.equal(selectProvider().id, 'anthropic');
  });
});

test('AGENT_PROVIDER overrides the default order', () => {
  withEnv({ AGENT_PROVIDER: 'openrouter', ANTHROPIC_API_KEY: 'k', OPENROUTER_API_KEY: 'k' }, () => {
    assert.equal(selectProvider().id, 'openrouter');
  });
});

test('AGENT_PROVIDER=fallback forces the rule-based agent even with keys present', () => {
  withEnv({ AGENT_PROVIDER: 'fallback', ANTHROPIC_API_KEY: 'k' }, () => {
    assert.equal(selectProvider().id, 'fallback');
  });
});

test('an unknown provider name fails loudly and names the options', () => {
  withEnv({ AGENT_PROVIDER: 'gpt' }, () => {
    assert.throws(() => selectProvider(), /Onbekende AGENT_PROVIDER/);
    const described = describeProvider();
    assert.equal(described.id, 'error');
    assert.match(described.error, /anthropic, openrouter, fallback/);
  });
});

test('choosing a provider without its key is an error, not a silent downgrade', () => {
  withEnv({ AGENT_PROVIDER: 'openrouter' }, () => {
    assert.throws(() => selectProvider(), /OPENROUTER_API_KEY/);
  });
  withEnv({ AGENT_PROVIDER: 'anthropic' }, () => {
    assert.throws(() => selectProvider(), /ANTHROPIC_API_KEY/);
  });
});

test('ANTHROPIC_AUTH_TOKEN also counts as configured', () => {
  withEnv({ ANTHROPIC_AUTH_TOKEN: 't' }, () => {
    assert.equal(selectProvider().id, 'anthropic');
  });
});

test('a custom model is reported by the badge', () => {
  withEnv({ OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'meta-llama/llama-3.3-70b-instruct' }, () => {
    assert.equal(describeProvider().model, 'meta-llama/llama-3.3-70b-instruct');
  });
  delete process.env.OPENROUTER_MODEL;
});
