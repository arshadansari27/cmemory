import { readStdin, runHook } from './shared';
import { debug } from '../utils/logger';

export async function onSessionEnd(): Promise<void> {
  await runHook(async () => {
    await readStdin();
    debug('SessionEnd hook — no-op');
  });
}
