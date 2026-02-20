import { readStdin, runHook, getProjectRoot } from './shared';
import { UserPromptSubmitInput, SearchResult } from '../core/types';
import { loadLessons } from '../core/storage';
import { getQueryEmbedding } from '../core/embeddings';
import { searchLessons } from '../core/search';
import { resolveExternalPaths, findProjectRootForPath } from '../utils/paths';
import { debug } from '../utils/logger';

function formatResults(results: SearchResult[]): string {
  if (results.length === 0) return '';

  const lines = results.map(r => {
    const tags = r.lesson.tags.length > 0 ? `[${r.lesson.tags.join(', ')}] ` : '';
    return `- ${tags}${r.lesson.content}`;
  });

  return [
    'Relevant lessons from past sessions:',
    ...lines,
    'Use these if applicable. Ignore if not relevant.',
  ].join('\n');
}

export async function onPrompt(): Promise<void> {
  await runHook(async () => {
    const input = (await readStdin()) as UserPromptSubmitInput;
    const { prompt, cwd } = input;

    const projectRoot = getProjectRoot(cwd);
    if (!projectRoot) {
      debug('No cmemory project found, skipping');
      return;
    }

    const lessons = loadLessons(projectRoot);
    if (lessons.length === 0) {
      debug('No lessons stored, skipping');
      return;
    }

    // Embed the full prompt as a single semantic query
    const queryEmbedding = await getQueryEmbedding(prompt);
    const results = searchLessons(queryEmbedding, lessons, 0.55, 5);

    // Cross-project: scan prompt for external file paths
    const externalPaths = resolveExternalPaths(prompt);
    const seenRoots = new Set<string>([projectRoot]);

    for (const extPath of externalPaths) {
      const extRoot = findProjectRootForPath(extPath);
      if (extRoot && !seenRoots.has(extRoot)) {
        seenRoots.add(extRoot);
        const extLessons = loadLessons(extRoot);
        if (extLessons.length > 0) {
          const extResults = searchLessons(queryEmbedding, extLessons, 0.55, 3);
          results.push(...extResults);
        }
      }
    }

    // De-duplicate and re-sort
    const uniqueResults = new Map<string, SearchResult>();
    for (const r of results) {
      const existing = uniqueResults.get(r.lesson.id);
      if (!existing || r.score > existing.score) {
        uniqueResults.set(r.lesson.id, r);
      }
    }
    const finalResults = [...uniqueResults.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const output = formatResults(finalResults);
    if (output) {
      process.stdout.write(output);
    }
  });
}
