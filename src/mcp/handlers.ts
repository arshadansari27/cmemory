import * as crypto from 'crypto';
import { loadLessons, saveLessons, saveProfile, enforceLessonCap } from '../core/storage';
import { searchLessons } from '../core/search';
import { updateClaudeMd, isHomeRoot } from '../synthesis/claude-md';

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
 * Returns an adaptive similarity threshold based on store size.
 * Empirical testing with nomic-embed-text-v1.5 shows relevant queries
 * score 0.63+ while irrelevant ones score 0.54 and below, so we keep
 * thresholds in the 0.50–0.55 range to avoid filtering valid matches.
 */
export function getAdaptiveThreshold(lessonCount: number): number {
  if (lessonCount < 5) return 0.55;
  if (lessonCount < 15) return 0.52;
  return 0.50;
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
    const shortId = r.lesson.id.substring(0, 8);
    return `- **${score}%** [${shortId}] ${r.lesson.content}${tags}`;
  });

  return {
    content: [{ type: 'text', text: `Found ${results.length} lesson(s):\n\n${lines.join('\n')}` }],
  };
}

// Lessons are meant to be 1-3 sentences; long ones bloat CLAUDE.md and every
// session's context. Reject rather than truncate so the caller rewrites it.
export const MAX_LESSON_CONTENT_CHARS = 500;

export async function handleSaveLesson(
  args: { content: string; tags?: string[]; replace_id?: string; force?: boolean },
  projectRoot: string,
  embeddings: EmbeddingProvider,
): Promise<McpResult> {
  const { content, tags = [], replace_id, force } = args;

  if (content.length > MAX_LESSON_CONTENT_CHARS) {
    return {
      content: [{
        type: 'text',
        text: `Lesson too long (${content.length} chars, max ${MAX_LESSON_CONTENT_CHARS}). Rewrite it as 1-3 sentences: root cause, gotcha, or pattern — not a session recap.`,
      }],
      isError: true,
    };
  }

  const now = new Date().toISOString();
  const lessons = loadLessons(projectRoot);

  // Replace mode: update existing lesson in place
  if (replace_id) {
    let idx = lessons.findIndex(l => l.id === replace_id || l.id.startsWith(replace_id));
    // Fallback: if no ID match, try matching by content substring
    if (idx === -1) {
      idx = lessons.findIndex(l => l.content.includes(replace_id));
    }
    if (idx === -1) {
      return {
        content: [{ type: 'text', text: `No lesson found matching ID or content: ${replace_id}` }],
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
  let matches = lessons.filter(l => l.id.startsWith(lesson_id));

  // Fallback: if no ID match, try matching by content substring
  if (matches.length === 0) {
    matches = lessons.filter(l => l.content.includes(lesson_id));
  }

  if (matches.length === 0) {
    return {
      content: [{ type: 'text', text: `No lesson found matching ID or content: ${lesson_id}` }],
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
  const note = isHomeRoot(projectRoot)
    ? ' Not written to ~/CLAUDE.md: this repo has no cmemory store of its own, so it uses the shared one in ~. Run `cmemory init` in the repo to give it its own profile.'
    : ' CLAUDE.md refreshed.';
  return {
    content: [{ type: 'text', text: `Profile updated (${content.length} chars).${note}` }],
  };
}
