import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadEnvFile } from '../server/env.js';

/**
 * The app reads .env itself rather than via node's --env-file flag, because
 * `node --watch` crashes when that flag points at a file that does not exist.
 * These lock in the behaviour that made the flag unusable.
 */

const write = (contents) => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'verhage-env-')), '.env');
  writeFileSync(file, contents);
  return file;
};

test('a missing file is not an error', () => {
  assert.equal(loadEnvFile(path.join(tmpdir(), 'definitely-not-here', '.env')), null);
});

test('values are loaded into process.env', () => {
  const file = write('VERHAGE_TEST_ONE=hello\nVERHAGE_TEST_TWO=world\n');
  assert.equal(loadEnvFile(file), file);
  assert.equal(process.env.VERHAGE_TEST_ONE, 'hello');
  assert.equal(process.env.VERHAGE_TEST_TWO, 'world');
  delete process.env.VERHAGE_TEST_ONE;
  delete process.env.VERHAGE_TEST_TWO;
});

test('comments and blank lines are ignored', () => {
  const file = write('# a comment\n\nVERHAGE_TEST_THREE=ok\n');
  loadEnvFile(file);
  assert.equal(process.env.VERHAGE_TEST_THREE, 'ok');
  delete process.env.VERHAGE_TEST_THREE;
});

test('an existing environment variable is not overwritten', () => {
  // This is what keeps `AGENT_PROVIDER=fallback npm test` from being replaced
  // by a developer's .env — and a live API being called during tests.
  process.env.VERHAGE_TEST_FOUR = 'from-shell';
  const file = write('VERHAGE_TEST_FOUR=from-file\n');
  loadEnvFile(file);
  assert.equal(process.env.VERHAGE_TEST_FOUR, 'from-shell');
  delete process.env.VERHAGE_TEST_FOUR;
});
