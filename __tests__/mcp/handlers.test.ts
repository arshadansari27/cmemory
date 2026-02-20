import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { loadLessons, saveLessons, MAX_LESSONS } from '../../src/core/storage';
import {
  handleSearchLessons,
  handleSaveLesson,
  handleRejectLesson,
  handleUpdateProfile,
  getAdaptiveThreshold,
  EmbeddingProvider,
} from '../../src/mcp/handlers';
import {
  makeTmpProject,
  makeFakeEmbeddingProvider,
  fakeEmbedding,
  TmpProject,
} from '../helpers/tmpProject';

let project: TmpProject;

beforeEach(() => {
  project = makeTmpProject();
});

afterEach(() => {
  project.cleanup();
});

describe('handleSaveLesson', () => {
  it('saves a new lesson and returns UUID', async () => {
    const embeddings = makeFakeEmbeddingProvider(0, 1);
    const result = await handleSaveLesson({ content: 'Use bun instead of npm' }, project.root, embeddings);

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/Lesson saved \(.+\)/);
  });

  it('lesson appears in loadLessons after save', async () => {
    const embeddings = makeFakeEmbeddingProvider(0, 1);
    await handleSaveLesson({ content: 'Always run tests first' }, project.root, embeddings);

    const lessons = loadLessons(project.root);
    expect(lessons).toHaveLength(1);
    expect(lessons[0].content).toBe('Always run tests first');
    expect(lessons[0].embedding).toEqual(fakeEmbedding(1));
  });

  it('dedup: same embedding returns "Similar lesson exists"', async () => {
    // Both query and doc at index 5 → cosine similarity 1.0
    const embeddings = makeFakeEmbeddingProvider(5, 5);
    await handleSaveLesson({ content: 'First lesson' }, project.root, embeddings);

    const result = await handleSaveLesson({ content: 'Duplicate lesson' }, project.root, embeddings);
    expect(result.content[0].text).toMatch(/Similar lesson exists/);
  });

  it('force=true saves despite dedup hit', async () => {
    const embeddings = makeFakeEmbeddingProvider(5, 5);
    await handleSaveLesson({ content: 'First lesson' }, project.root, embeddings);

    const result = await handleSaveLesson({ content: 'Forced lesson', force: true }, project.root, embeddings);
    expect(result.content[0].text).toMatch(/Lesson saved/);
    expect(loadLessons(project.root)).toHaveLength(2);
  });

  it('replace_id updates existing lesson content', async () => {
    const embeddings = makeFakeEmbeddingProvider(0, 1);
    await handleSaveLesson({ content: 'Original content' }, project.root, embeddings);

    const lessons = loadLessons(project.root);
    const id = lessons[0].id;

    const result = await handleSaveLesson(
      { content: 'Updated content', replace_id: id },
      project.root,
      embeddings,
    );
    expect(result.content[0].text).toMatch(/Lesson updated/);
    expect(loadLessons(project.root)[0].content).toBe('Updated content');
  });

  it('replace_id not found returns isError', async () => {
    const embeddings = makeFakeEmbeddingProvider(0, 1);
    const result = await handleSaveLesson(
      { content: 'Whatever', replace_id: 'nonexistent-id' },
      project.root,
      embeddings,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/No lesson found/);
  });

  it('enforces lesson cap when store is full', async () => {
    // Pre-fill store to MAX_LESSONS with unique embeddings at index 0
    const existing = Array.from({ length: MAX_LESSONS }, (_, i) => ({
      id: `old-${i}`,
      content: `Old lesson ${i}`,
      tags: [],
      embedding: fakeEmbedding(0),
      createdAt: new Date(2024, 0, i + 1).toISOString(),
      updatedAt: new Date(2024, 0, i + 1).toISOString(),
      source: 'manual' as const,
    }));
    saveLessons(project.root, existing);

    // Save one more — doc at index 1, query at index 0 (different → no dedup)
    const embeddings = makeFakeEmbeddingProvider(0, 1);
    const result = await handleSaveLesson({ content: 'Brand new lesson' }, project.root, embeddings);
    expect(result.content[0].text).toMatch(/Lesson saved/);

    const lessons = loadLessons(project.root);
    expect(lessons).toHaveLength(MAX_LESSONS);
    // The new lesson should be present (it has the most recent updatedAt)
    expect(lessons.some(l => l.content === 'Brand new lesson')).toBe(true);
    // The oldest lesson should have been evicted
    expect(lessons.some(l => l.id === 'old-0')).toBe(false);
  });

  it('CLAUDE.md lessons section updated after save', async () => {
    const embeddings = makeFakeEmbeddingProvider(0, 1);
    await handleSaveLesson({ content: 'Lesson in CLAUDE.md' }, project.root, embeddings);

    const md = fs.readFileSync(project.claudeMdPath, 'utf-8');
    expect(md).toContain('Lesson in CLAUDE.md');
  });
});

describe('handleSearchLessons', () => {
  it('empty store returns "No lessons stored yet."', async () => {
    const embeddings = makeFakeEmbeddingProvider(0, 0);
    const result = await handleSearchLessons({ query: 'anything' }, project.root, embeddings);
    expect(result.content[0].text).toBe('No lessons stored yet.');
  });

  it('matching query returns lesson with score', async () => {
    // Doc at index 3, query at index 3 → cosine similarity 1.0 → match
    const embeddings = makeFakeEmbeddingProvider(3, 3);
    await handleSaveLesson({ content: 'Database indexes improve query speed' }, project.root, embeddings);

    const result = await handleSearchLessons({ query: 'database performance' }, project.root, embeddings);
    expect(result.content[0].text).toContain('Found 1 lesson(s)');
    expect(result.content[0].text).toContain('Database indexes improve query speed');
  });

  it('non-matching query returns "No lessons matched"', async () => {
    // Doc at index 3, query at index 7 → cosine similarity 0.0 → no match
    const savingEmbeddings = makeFakeEmbeddingProvider(0, 3);
    await handleSaveLesson({ content: 'Some lesson' }, project.root, savingEmbeddings);

    const searchEmbeddings = makeFakeEmbeddingProvider(7, 3);
    const result = await handleSearchLessons({ query: 'unrelated' }, project.root, searchEmbeddings);
    expect(result.content[0].text).toMatch(/No lessons matched/);
  });
});

describe('handleRejectLesson', () => {
  it('removes lesson, loadLessons empty after', async () => {
    const embeddings = makeFakeEmbeddingProvider(0, 1);
    await handleSaveLesson({ content: 'To be removed' }, project.root, embeddings);

    const id = loadLessons(project.root)[0].id;
    const result = await handleRejectLesson({ lesson_id: id }, project.root);

    expect(result.content[0].text).toContain('Removed lesson');
    expect(loadLessons(project.root)).toHaveLength(0);
  });

  it('returns "Removed lesson: ..." with content', async () => {
    const embeddings = makeFakeEmbeddingProvider(0, 1);
    await handleSaveLesson({ content: 'Specific content here' }, project.root, embeddings);

    const id = loadLessons(project.root)[0].id;
    const result = await handleRejectLesson({ lesson_id: id }, project.root);

    expect(result.content[0].text).toBe('Removed lesson: Specific content here');
  });

  it('unknown ID returns isError', async () => {
    const result = await handleRejectLesson({ lesson_id: 'does-not-exist' }, project.root);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/No lesson found/);
  });

  it('ambiguous prefix (2 matches) returns isError', async () => {
    const embeddings = makeFakeEmbeddingProvider(0, 1);
    // Save two lessons, then manually set IDs with shared prefix
    await handleSaveLesson({ content: 'Lesson A', force: true }, project.root, embeddings);
    await handleSaveLesson({ content: 'Lesson B', force: true }, project.root, embeddings);

    const lessons = loadLessons(project.root);
    const { saveLessons } = await import('../../src/core/storage');
    lessons[0].id = 'abc-111';
    lessons[1].id = 'abc-222';
    saveLessons(project.root, lessons);

    const result = await handleRejectLesson({ lesson_id: 'abc' }, project.root);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Ambiguous ID/);
  });

  it('CLAUDE.md updated after rejection', async () => {
    const embeddings = makeFakeEmbeddingProvider(0, 1);
    await handleSaveLesson({ content: 'Will be removed from md' }, project.root, embeddings);

    const mdBefore = fs.readFileSync(project.claudeMdPath, 'utf-8');
    expect(mdBefore).toContain('Will be removed from md');

    const id = loadLessons(project.root)[0].id;
    await handleRejectLesson({ lesson_id: id }, project.root);

    const mdAfter = fs.readFileSync(project.claudeMdPath, 'utf-8');
    expect(mdAfter).not.toContain('Will be removed from md');
  });
});

describe('handleUpdateProfile', () => {
  it('saves profile and returns char count', async () => {
    const result = await handleUpdateProfile({ content: 'TypeScript + Node.js project' }, project.root);

    expect(result.content[0].text).toBe('Profile updated (28 chars). CLAUDE.md refreshed.');
  });

  it('CLAUDE.md profile section updated', async () => {
    await handleUpdateProfile({ content: 'My cool project stack' }, project.root);

    const md = fs.readFileSync(project.claudeMdPath, 'utf-8');
    expect(md).toContain('My cool project stack');
  });

  it('loadProfile returns new content', async () => {
    const { loadProfile } = await import('../../src/core/storage');
    await handleUpdateProfile({ content: 'New profile content' }, project.root);

    const profile = loadProfile(project.root);
    expect(profile.content).toBe('New profile content');
  });
});

describe('getAdaptiveThreshold', () => {
  it('returns 0.55 for 0 lessons', () => {
    expect(getAdaptiveThreshold(0)).toBe(0.55);
  });

  it('returns 0.55 for 4 lessons', () => {
    expect(getAdaptiveThreshold(4)).toBe(0.55);
  });

  it('returns 0.52 for 5 lessons', () => {
    expect(getAdaptiveThreshold(5)).toBe(0.52);
  });

  it('returns 0.52 for 14 lessons', () => {
    expect(getAdaptiveThreshold(14)).toBe(0.52);
  });

  it('returns 0.50 for 15 lessons', () => {
    expect(getAdaptiveThreshold(15)).toBe(0.50);
  });

  it('returns 0.50 for 100 lessons', () => {
    expect(getAdaptiveThreshold(100)).toBe(0.50);
  });

  it('small store accepts matches above 0.55 threshold', async () => {
    // Create a lesson with a hand-crafted embedding so that
    // cosine_sim(query, doc) = 0.60 — above the 0.55 small-store threshold.
    // query = [1, 0, 0, ...], doc = [0.6, 0.8, 0, ...]
    // dot = 0.6, |q|=1, |d|=1 → similarity = 0.60
    const EMBEDDING_DIM = 768;
    const docVec = new Array(EMBEDDING_DIM).fill(0);
    docVec[0] = 0.6;
    docVec[1] = 0.8;

    const lesson = {
      id: 'test-marginal',
      content: 'Marginal lesson',
      tags: [],
      embedding: docVec,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'manual' as const,
    };
    saveLessons(project.root, [lesson]);

    // Query embedding: unit vector at index 0 → cosine similarity 0.60
    const embeddings: EmbeddingProvider = {
      getQueryEmbedding: async () => fakeEmbedding(0),
      getDocumentEmbedding: async () => docVec,
    };

    const result = await handleSearchLessons({ query: 'anything' }, project.root, embeddings);
    // 1 lesson → adaptive threshold 0.55 → 0.60 >= 0.55 → match
    expect(result.content[0].text).toContain('Found 1 lesson(s)');
    expect(result.content[0].text).toContain('Marginal lesson');
  });

  it('small store rejects matches below 0.55 threshold', async () => {
    // cosine_sim(query, doc) = 0.50 — below the 0.55 small-store threshold.
    // query = [1, 0, 0, ...], doc = [0.5, 0.866, 0, ...]
    // dot = 0.5, |q|=1, |d|=1 → similarity = 0.50
    const EMBEDDING_DIM = 768;
    const docVec = new Array(EMBEDDING_DIM).fill(0);
    docVec[0] = 0.5;
    docVec[1] = 0.866;

    const lesson = {
      id: 'test-below',
      content: 'Below threshold lesson',
      tags: [],
      embedding: docVec,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'manual' as const,
    };
    saveLessons(project.root, [lesson]);

    const embeddings: EmbeddingProvider = {
      getQueryEmbedding: async () => fakeEmbedding(0),
      getDocumentEmbedding: async () => docVec,
    };

    const result = await handleSearchLessons({ query: 'anything' }, project.root, embeddings);
    // 1 lesson → adaptive threshold 0.55 → 0.50 < 0.55 → no match
    expect(result.content[0].text).toMatch(/No lessons matched/);
  });
});

describe('end-to-end flow', () => {
  it('save → search (finds it) → reject → search (empty)', async () => {
    // Same index for query and doc → perfect match
    const embeddings = makeFakeEmbeddingProvider(10, 10);

    // Save
    const saveResult = await handleSaveLesson({ content: 'E2E test lesson' }, project.root, embeddings);
    expect(saveResult.content[0].text).toMatch(/Lesson saved/);

    // Search — finds it
    const searchResult = await handleSearchLessons({ query: 'e2e' }, project.root, embeddings);
    expect(searchResult.content[0].text).toContain('E2E test lesson');

    // Reject
    const id = loadLessons(project.root)[0].id;
    const rejectResult = await handleRejectLesson({ lesson_id: id }, project.root);
    expect(rejectResult.content[0].text).toContain('Removed lesson');

    // Search — empty
    const emptyResult = await handleSearchLessons({ query: 'e2e' }, project.root, embeddings);
    expect(emptyResult.content[0].text).toBe('No lessons stored yet.');
  });
});
