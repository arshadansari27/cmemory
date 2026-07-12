import { readStdin, runHook, getProjectRoot } from './shared';
import { loadLessons, loadProfile } from '../core/storage';

export async function onPrompt(): Promise<void> {
  await runHook(async () => {
    const input = (await readStdin()) as { cwd: string };
    const projectRoot = getProjectRoot(input.cwd);
    if (!projectRoot) return;

    const lessons = loadLessons(projectRoot);
    const profile = loadProfile(projectRoot);
    const lessonCount = lessons.length;

    // Full tool guidance already lives in the CLAUDE.md tools section; the
    // per-prompt nudge only needs to be a reminder, not a second copy.
    const nudge = profile.content
      ? `cmemory: ${lessonCount} lesson(s) stored — call search_lessons before starting work.`
      : `cmemory: ${lessonCount} lesson(s) stored, no project profile yet — call search_lessons before starting, and update_profile after exploring.`;

    process.stdout.write(nudge);
  });
}
