import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  initCmemory,
  isCmemoryInitialized,
  loadLessons,
  saveLessons,
  enforceLessonCap,
  MAX_LESSONS,
} from '../../src/core/storage';
import { Lesson } from '../../src/core/types';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmemory-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('initCmemory', () => {
  it('creates .claude/cmemory/ with empty files', () => {
    expect(isCmemoryInitialized(tmpDir)).toBe(false);
    initCmemory(tmpDir);
    expect(isCmemoryInitialized(tmpDir)).toBe(true);
    expect(loadLessons(tmpDir)).toEqual([]);
  });

  it('does not overwrite existing files', () => {
    initCmemory(tmpDir);
    const lesson: Lesson = {
      id: 'test-1',
      content: 'Hello',
      tags: ['tag'],
      embedding: [0.1, 0.2],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'manual',
    };
    saveLessons(tmpDir, [lesson]);
    initCmemory(tmpDir); // re-init should not clobber
    expect(loadLessons(tmpDir)).toHaveLength(1);
  });
});

describe('lessons', () => {
  it('save and load round-trips correctly', () => {
    initCmemory(tmpDir);
    const lessons: Lesson[] = [
      {
        id: 'a',
        content: 'Lesson A',
        tags: ['foo'],
        embedding: [1, 2, 3],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        source: 'manual',
      },
    ];
    saveLessons(tmpDir, lessons);
    const loaded = loadLessons(tmpDir);
    expect(loaded).toEqual(lessons);
  });

  it('returns empty array for missing file', () => {
    initCmemory(tmpDir);
    // Delete the file
    fs.unlinkSync(path.join(tmpDir, '.claude/cmemory/lessons.json'));
    expect(loadLessons(tmpDir)).toEqual([]);
  });
});

function makeLesson(id: string, updatedAt: string): Lesson {
  return {
    id,
    content: `Lesson ${id}`,
    tags: [],
    embedding: [1, 0, 0],
    createdAt: updatedAt,
    updatedAt,
    source: 'manual',
  };
}

describe('enforceLessonCap', () => {
  it('returns same array when under cap', () => {
    const lessons = [makeLesson('a', '2025-01-01T00:00:00Z')];
    const result = enforceLessonCap(lessons);
    expect(result).toBe(lessons); // same reference, not a copy
  });

  it('returns same array when exactly at cap', () => {
    const lessons = Array.from({ length: MAX_LESSONS }, (_, i) =>
      makeLesson(`lesson-${i}`, `2025-01-01T00:00:00Z`)
    );
    const result = enforceLessonCap(lessons);
    expect(result).toBe(lessons);
  });

  it('evicts oldest lessons when over cap', () => {
    const lessons = Array.from({ length: MAX_LESSONS + 5 }, (_, i) =>
      makeLesson(`lesson-${i}`, new Date(2025, 0, i + 1).toISOString())
    );
    const result = enforceLessonCap(lessons);
    expect(result).toHaveLength(MAX_LESSONS);

    // The 5 oldest (earliest updatedAt) should be gone
    const resultIds = result.map(l => l.id);
    for (let i = 0; i < 5; i++) {
      expect(resultIds).not.toContain(`lesson-${i}`);
    }
    // The newest should still be present
    expect(resultIds).toContain(`lesson-${MAX_LESSONS + 4}`);
  });

  it('keeps most recently updated, not most recently created', () => {
    const old = makeLesson('old-but-updated', '2024-01-01T00:00:00Z');
    old.updatedAt = '2026-12-31T00:00:00Z'; // updated recently

    const newer = Array.from({ length: MAX_LESSONS }, (_, i) =>
      makeLesson(`newer-${i}`, new Date(2025, 0, i + 1).toISOString())
    );

    const lessons = [old, ...newer]; // 101 total
    const result = enforceLessonCap(lessons);
    expect(result).toHaveLength(MAX_LESSONS);

    // old-but-updated should survive because its updatedAt is the newest
    const resultIds = result.map(l => l.id);
    expect(resultIds).toContain('old-but-updated');

    // The lesson with the earliest updatedAt should be evicted
    expect(resultIds).not.toContain('newer-0');
  });
});
