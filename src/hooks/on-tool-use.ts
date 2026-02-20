import { readStdin, runHook, getProjectRoot } from './shared';
import { PostToolUseInput, SearchResult } from '../core/types';
import { loadLessons } from '../core/storage';
import { getEmbedding } from '../core/embeddings';
import { searchLessons } from '../core/search';
import { debug } from '../utils/logger';

function buildQuery(input: PostToolUseInput): string {
  const toolInput = input.tool_input || {};
  switch (input.tool_name) {
    case 'Read':
      return `reading ${toolInput.file_path || 'file'}`;
    case 'Bash':
      return `running command: ${toolInput.command || ''}`;
    case 'Grep':
      return `searching for ${toolInput.pattern || ''} in ${toolInput.path || 'codebase'}`;
    default:
      return `using ${input.tool_name}`;
  }
}

export async function onToolUse(): Promise<void> {
  await runHook(async () => {
    const input = (await readStdin()) as PostToolUseInput;
    const { cwd } = input;

    const projectRoot = getProjectRoot(cwd);
    if (!projectRoot) return;

    const lessons = loadLessons(projectRoot);
    if (lessons.length === 0) return;

    const query = buildQuery(input);
    debug(`PostToolUse query: ${query}`);

    const queryEmbedding = await getEmbedding(query);
    const results = searchLessons(queryEmbedding, lessons, 0.70, 3);

    if (results.length === 0) return;

    const lines = results.map(r => {
      const tags = r.lesson.tags.length > 0 ? `[${r.lesson.tags.join(', ')}] ` : '';
      return `- ${tags}${r.lesson.content}`;
    });

    const output = [
      'Relevant lessons:',
      ...lines,
    ].join('\n');

    process.stdout.write(output + '\n');
  });
}
