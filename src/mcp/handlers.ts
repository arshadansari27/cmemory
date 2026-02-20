import * as crypto from 'crypto';
import { loadLessons, saveLessons, saveProfile, enforceLessonCap } from '../core/storage';
import { searchLessons } from '../core/search';
import { updateClaudeMd } from '../synthesis/claude-md';

export interface EmbeddingProvider {
  getQueryEmbedding(text: string): Promise<number[]>;
  getDocumentEmbedding(text: string): Promise<number[]>;
}

export interface McpResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * Returns a higher similarity threshold for small stores where lack of
 * competition causes most queries to match above the default 0.55.
 */
export function getAdaptiveThreshold(lessonCount: number): number {
  if (lessonCount < 5) return 0.65;
  if (lessonCount < 15) return 0.60;
  return 0.55;
}

export async function handleSearchLessons(
  args: { query: string },
  projectRoot: string,
  embeddings: EmbeddingProvider,
): Promise<McpResult> {
  const query = args.query;
  const lessons = loadLessons(projectRoot);

  if (lessons.length === 0) {
    return {
      content: [{ type: 'text', text: 'No lessons stored yet.' }],
    };
  }

  const embedding = await embeddings.getQueryEmbedding(query);
  const threshold = getAdaptiveThreshold(lessons.length);
  const results = searchLessons(embedding, lessons, threshold, 5);

  if (results.length === 0) {
    return {
      content: [{ type: 'text', text: `No lessons matched the query: "${query}"` }],
    };
  }

  const lines = results.map(r => {
    const tags = r.lesson.tags.length > 0 ? ` [${r.lesson.tags.join(', ')}]` : '';
    const score = (r.score * 100).toFixed(1);
    return `- **${score}%** ${r.lesson.content}${tags}`;
  });

  return {
    content: [{ type: 'text', text: `Found ${results.length} lesson(s):\n\n${lines.join('\n')}` }],
  };
}

export async function handleSaveLesson(
  args: { content: string; tags?: string[]; replace_id?: string; force?: boolean },
  projectRoot: string,
  embeddings: EmbeddingProvider,
): Promise<McpResult> {
  const { content, tags = [], replace_id, force } = args;
  const now = new Date().toISOString();
  const lessons = loadLessons(projectRoot);

  // Replace mode: update existing lesson in place
  if (replace_id) {
    const idx = lessons.findIndex(l => l.id === replace_id || l.id.startsWith(replace_id));
    if (idx === -1) {
      return {
        content: [{ type: 'text', text: `No lesson found matching ID: ${replace_id}` }],
        isError: true,
      };
    }
    const embedding = await embeddings.getDocumentEmbedding(content);
    lessons[idx] = {
      ...lessons[idx],
      content,
      tags,
      embedding,
      updatedAt: now,
    };
    saveLessons(projectRoot, lessons);
    updateClaudeMd(projectRoot);
    return {
      content: [{ type: 'text', text: `Lesson updated (${lessons[idx].id}).` }],
    };
  }

  // Dedup check (unless force=true)
  if (!force) {
    const embedding = await embeddings.getDocumentEmbedding(content);
    const results = searchLessons(embedding, lessons, 0.50, 1);
    if (results.length > 0) {
      const match = results[0];
      const score = (match.score * 100).toFixed(1);
      return {
        content: [{
          type: 'text',
          text: `Similar lesson exists: ${match.lesson.id} — ${match.lesson.content} (similarity: ${score}%). Call with replace_id to update, or force=true to save as new.`,
        }],
      };
    }

    // No duplicate — save with the embedding we already computed
    const lesson = {
      id: crypto.randomUUID(),
      content,
      tags,
      embedding,
      createdAt: now,
      updatedAt: now,
      source: 'manual' as const,
    };
    lessons.push(lesson);
    const capped = enforceLessonCap(lessons);
    saveLessons(projectRoot, capped);
    updateClaudeMd(projectRoot);
    return {
      content: [{ type: 'text', text: `Lesson saved (${lesson.id}).` }],
    };
  }

  // Force save — skip dedup
  const embedding = await embeddings.getDocumentEmbedding(content);
  const lesson = {
    id: crypto.randomUUID(),
    content,
    tags,
    embedding,
    createdAt: now,
    updatedAt: now,
    source: 'manual' as const,
  };
  lessons.push(lesson);
  const capped = enforceLessonCap(lessons);
  saveLessons(projectRoot, capped);
  updateClaudeMd(projectRoot);
  return {
    content: [{ type: 'text', text: `Lesson saved (${lesson.id}).` }],
  };
}

export async function handleRejectLesson(
  args: { lesson_id: string },
  projectRoot: string,
): Promise<McpResult> {
  const { lesson_id } = args;
  const lessons = loadLessons(projectRoot);
  const matches = lessons.filter(l => l.id.startsWith(lesson_id));

  if (matches.length === 0) {
    return {
      content: [{ type: 'text', text: `No lesson found matching ID: ${lesson_id}` }],
      isError: true,
    };
  }
  if (matches.length > 1) {
    const list = matches.map(m => `  ${m.id}  ${m.content.substring(0, 60)}`).join('\n');
    return {
      content: [{ type: 'text', text: `Ambiguous ID "${lesson_id}" matches ${matches.length} lessons. Be more specific:\n${list}` }],
      isError: true,
    };
  }

  const toRemove = matches[0];
  const remaining = lessons.filter(l => l.id !== toRemove.id);
  saveLessons(projectRoot, remaining);
  updateClaudeMd(projectRoot);

  return {
    content: [{ type: 'text', text: `Removed lesson: ${toRemove.content}` }],
  };
}

export async function handleUpdateProfile(
  args: { content: string },
  projectRoot: string,
): Promise<McpResult> {
  const { content } = args;
  saveProfile(projectRoot, {
    content,
    updatedAt: new Date().toISOString(),
  });
  updateClaudeMd(projectRoot);
  return {
    content: [{ type: 'text', text: `Profile updated (${content.length} chars). CLAUDE.md refreshed.` }],
  };
}
