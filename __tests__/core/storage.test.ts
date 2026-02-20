import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  initCmemory,
  isCmemoryInitialized,
  loadLessons,
  saveLessons,
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
