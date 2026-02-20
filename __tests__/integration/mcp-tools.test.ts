import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getQueryEmbedding, getDocumentEmbedding } from '../../src/core/embeddings';
import { loadLessons } from '../../src/core/storage';
import {
  EmbeddingProvider,
  handleSearchLessons,
  handleSaveLesson,
  handleRejectLesson,
} from '../../src/mcp/handlers';
import { makeTmpProject, TmpProject } from '../helpers/tmpProject';

const realEmbeddings: EmbeddingProvider = {
  getQueryEmbedding,
  getDocumentEmbedding,
};

let project: TmpProject;

beforeEach(() => {
  project = makeTmpProject();
});

afterEach(() => {
  project.cleanup();
});

describe('MCP tools with real embeddings', () => {
  it('save a lesson about databases, search with related query → finds it', async () => {
    await handleSaveLesson(
      { content: 'Always add indexes to frequently queried database columns' },
      project.root,
      realEmbeddings,
    );

    const result = await handleSearchLessons(
      { query: 'database performance slow queries' },
      project.root,
      realEmbeddings,
    );

    expect(result.content[0].text).toContain('Found 1 lesson(s)');
    expect(result.content[0].text).toContain('indexes');
  });

  it('save similar content without force → dedup detected', async () => {
    await handleSaveLesson(
      { content: 'Run database migrations before seed scripts' },
      project.root,
      realEmbeddings,
    );

    const result = await handleSaveLesson(
      { content: 'Database migrations must run before seeding' },
      project.root,
      realEmbeddings,
    );

    expect(result.content[0].text).toMatch(/Similar lesson exists/);
  });

  it('reject removes lesson from search results', async () => {
    await handleSaveLesson(
      { content: 'The Stripe webhook handler drops events silently on signature failure' },
      project.root,
      realEmbeddings,
    );

    const lessons = loadLessons(project.root);
    expect(lessons).toHaveLength(1);

    await handleRejectLesson({ lesson_id: lessons[0].id }, project.root);

    const result = await handleSearchLessons(
      { query: 'stripe webhook' },
      project.root,
      realEmbeddings,
    );
    expect(result.content[0].text).toBe('No lessons stored yet.');
  });
});
