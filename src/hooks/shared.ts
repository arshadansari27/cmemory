import { findProjectRoot } from '../utils/paths';
import { error as logError, debug } from '../utils/logger';

/**
 * Read JSON from stdin with a safety timeout.
 * Claude Code pipes hook input as JSON to stdin.
 */
export async function readStdin(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        process.stdin.destroy();
        reject(new Error('stdin read timed out after 2s'));
      }
    }, 2000);

    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error(`Failed to parse stdin JSON: ${err}`));
      }
    });
    process.stdin.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });
    process.stdin.resume();
  });
}

/**
 * Top-level error boundary for hooks.
 * Catches all errors, logs to stderr, exits 0 (never blocks Claude).
 */
export async function runHook(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logError(`Hook failed: ${err}`);
  }
  process.exit(0);
}

/**
 * Get the project root from the hook's cwd.
 */
export function getProjectRoot(cwd: string): string | null {
  return findProjectRoot(cwd);
}
