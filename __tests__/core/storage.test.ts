import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  initCmemory,
  isCmemoryInitialized,
  loadLessons,
  saveLessons,
  loadMeta,
  saveMeta,
  loadPending,
  appendPending,
  clearPending,
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
    expect(loadMeta(tmpDir).version).toBe(1);
    expect(loadPending(tmpDir).transcripts).toEqual([]);
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

describe('pending queue', () => {
  it('appends transcripts without duplicates', () => {
    initCmemory(tmpDir);
    appendPending(tmpDir, '/path/to/transcript1.jsonl');
    appendPending(tmpDir, '/path/to/transcript2.jsonl');
    appendPending(tmpDir, '/path/to/transcript1.jsonl'); // duplicate
    const pending = loadPending(tmpDir);
    expect(pending.transcripts).toEqual([
      '/path/to/transcript1.jsonl',
      '/path/to/transcript2.jsonl',
    ]);
  });

  it('clears pending queue', () => {
    initCmemory(tmpDir);
    appendPending(tmpDir, '/path/to/transcript.jsonl');
    clearPending(tmpDir);
    expect(loadPending(tmpDir).transcripts).toEqual([]);
  });
});
