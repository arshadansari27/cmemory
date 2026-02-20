import { readStdin, runHook, getProjectRoot } from './shared';

export async function onPrompt(): Promise<void> {
  await runHook(async () => {
    const input = (await readStdin()) as { cwd: string };
    const projectRoot = getProjectRoot(input.cwd);
    if (!projectRoot) return;

    process.stdout.write(
      'You have cmemory tools available. Use search_lessons to find relevant context for this task.'
    );
  });
}
