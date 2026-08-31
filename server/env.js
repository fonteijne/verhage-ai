import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Loads .env from the project root, if there is one.
 *
 * Import this before anything that reads process.env. It is done here rather
 * than with node's --env-file flag because `node --watch` crashes on startup
 * when the flag points at a file that does not exist, which is the normal
 * state of a fresh clone.
 *
 * Real environment variables win over the file (node's own rule), so
 * `AGENT_PROVIDER=fallback npm test` and container-injected config both
 * override a developer's local .env rather than being silently replaced.
 */
const ENV_FILE = path.resolve(fileURLToPath(new URL('../.env', import.meta.url)));

/**
 * @param {string} file
 * @returns {string|null} the file that was loaded, or null if there was none
 */
export function loadEnvFile(file) {
  if (!existsSync(file)) return null;
  try {
    process.loadEnvFile(file);
    return file;
  } catch (err) {
    console.error(`[env] kon ${file} niet lezen: ${err.message}`);
    return null;
  }
}

export const envFile = loadEnvFile(ENV_FILE);
