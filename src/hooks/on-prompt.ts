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
    const hasProfile = Boolean(profile.content);

    const profileGuidance = hasProfile
      ? 'Call this when you learn something structural about the project: the stack, how auth works, how data is stored, deployment setup, target audience. Also call when these change: new integrations, auth migrations, database changes, deployment updates. The profile helps future sessions understand this project immediately.'
      : 'No profile exists yet. After exploring, describe the stack, architecture, data model, auth, deployment, and audience. The profile helps future sessions understand this project immediately.';

    const countLabel = lessonCount > 0 ? ` (${lessonCount} lesson${lessonCount === 1 ? '' : 's'} stored)` : '';

    const nudge = [
      'You have cmemory tools available. Use search_lessons to find relevant context for this task.',
      '',
      `# cmemory — Persistent Project Memory${countLabel}`,
      '',
      '**search_lessons**({ query }) — Call this FIRST when starting any task, debugging any bug, or touching unfamiliar code. Query with natural language: "auth token refresh", "stripe webhook handling", "database migration order". Past sessions may have already solved what you\'re about to work on.',
      '**save_lesson**({ content, tags }) — Call after: fixing a non-obvious bug, discovering unexpected API behavior, finding a workaround, or learning why something is built a certain way. Good lessons: bug root causes, API gotchas, file-specific patterns. Bad lessons: basic setup steps, obvious errors. Write 1-3 sentences. Tag with file paths and concepts.',
      '**reject_lesson**({ lesson_id }) — Call this when search_lessons returns something wrong or outdated based on what you currently see in the code. Keeping stale lessons hurts future sessions.',
      `**update_profile**({ content }) — ${profileGuidance}`,
    ].join('\n');

    process.stdout.write(nudge);
  });
}
