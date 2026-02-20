import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initCmemory, loadLessons, saveLessons, loadProfile } from '../../src/core/storage';
import { Lesson, SynthesisResponse } from '../../src/core/types';

// Mock embeddings to avoid loading the model in tests
vi.mock('../../src/core/embeddings', () => ({
  getEmbedding: vi.fn().mockResolvedValue(new Array(384).fill(0.01)),
  ensureModelDownloaded: vi.fn().mockResolvedValue(undefined),
}));

import { processSynthesisResponse } from '../../src/synthesis/processor';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmemory-proc-test-'));
  initCmemory(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('processSynthesisResponse', () => {
  it('adds new lessons from add actions', async () => {
    const response: SynthesisResponse = {
      profile: null,
      actions: [
        { action: 'add', content: 'Always check null returns from getUser()', tags: ['auth'] },
        { action: 'add', content: 'Run migrations before seeds', tags: ['db'] },
      ],
    };

    await processSynthesisResponse(tmpDir, response);
    const lessons = loadLessons(tmpDir);
    expect(lessons).toHaveLength(2);
    expect(lessons[0].content).toBe('Always check null returns from getUser()');
    expect(lessons[0].source).toBe('synthesis');
    expect(lessons[1].tags).toEqual(['db']);
  });

  it('replaces existing lessons', async () => {
    const existing: Lesson = {
      id: 'lesson-to-replace',
      content: 'Old content',
      tags: ['old'],
      embedding: new Array(384).fill(0),
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      source: 'manual',
    };
    saveLessons(tmpDir, [existing]);

    const response: SynthesisResponse = {
      profile: null,
      actions: [
        {
          action: 'replace',
          targetId: 'lesson-to-replace',
          content: 'Updated content',
          tags: ['new'],
        },
      ],
    };

    await processSynthesisResponse(tmpDir, response);
    const lessons = loadLessons(tmpDir);
    expect(lessons).toHaveLength(1);
    expect(lessons[0].id).toBe('lesson-to-replace');
    expect(lessons[0].content).toBe('Updated content');
    expect(lessons[0].tags).toEqual(['new']);
  });

  it('adds lesson when replace target is missing', async () => {
    const response: SynthesisResponse = {
      profile: null,
      actions: [
        {
          action: 'replace',
          targetId: 'nonexistent-id',
          content: 'Orphaned replace becomes add',
          tags: ['fallback'],
        },
      ],
    };

    await processSynthesisResponse(tmpDir, response);
    const lessons = loadLessons(tmpDir);
    expect(lessons).toHaveLength(1);
    expect(lessons[0].content).toBe('Orphaned replace becomes add');
  });

  it('handles discard actions gracefully', async () => {
    const response: SynthesisResponse = {
      profile: null,
      actions: [
        { action: 'discard', reason: 'Session was just reading files, no insights' },
      ],
    };

    await processSynthesisResponse(tmpDir, response);
    const lessons = loadLessons(tmpDir);
    expect(lessons).toHaveLength(0);
  });

  it('updates CLAUDE.md after processing', async () => {
    const response: SynthesisResponse = {
      profile: null,
      actions: [
        { action: 'add', content: 'Test lesson for CLAUDE.md', tags: [] },
      ],
    };

    await processSynthesisResponse(tmpDir, response);
    const claudeMdPath = path.join(tmpDir, 'CLAUDE.md');
    expect(fs.existsSync(claudeMdPath)).toBe(true);
    const content = fs.readFileSync(claudeMdPath, 'utf-8');
    expect(content).toContain('Test lesson for CLAUDE.md');
    expect(content).toContain('<!-- cmemory:lessons-start -->');
    expect(content).toContain('<!-- cmemory:lessons-end -->');
  });

  // --- Profile tests ---

  it('saves profile when synthesis returns a profile', async () => {
    const response: SynthesisResponse = {
      profile: '**Stack:** Next.js 14, TypeScript\n\n**Architecture:** Monorepo',
      actions: [],
    };

    await processSynthesisResponse(tmpDir, response);
    const profile = loadProfile(tmpDir);
    expect(profile.content).toBe('**Stack:** Next.js 14, TypeScript\n\n**Architecture:** Monorepo');
    expect(profile.updatedAt).toBeTruthy();
  });

  it('does not update profile when synthesis returns null profile', async () => {
    const response: SynthesisResponse = {
      profile: null,
      actions: [
        { action: 'add', content: 'Some lesson', tags: [] },
      ],
    };

    await processSynthesisResponse(tmpDir, response);
    const profile = loadProfile(tmpDir);
    expect(profile.content).toBe('');
    expect(profile.updatedAt).toBeNull();
  });

  it('writes profile section to CLAUDE.md', async () => {
    const response: SynthesisResponse = {
      profile: '**Stack:** Express, PostgreSQL',
      actions: [
        { action: 'add', content: 'Always validate input', tags: ['security'] },
      ],
    };

    await processSynthesisResponse(tmpDir, response);
    const claudeMdPath = path.join(tmpDir, 'CLAUDE.md');
    const content = fs.readFileSync(claudeMdPath, 'utf-8');

    // Profile section exists
    expect(content).toContain('<!-- cmemory:profile-start -->');
    expect(content).toContain('## Project Profile (auto-managed by cmemory)');
    expect(content).toContain('**Stack:** Express, PostgreSQL');
    expect(content).toContain('<!-- cmemory:profile-end -->');

    // Lessons section still exists
    expect(content).toContain('<!-- cmemory:lessons-start -->');
    expect(content).toContain('Always validate input');
    expect(content).toContain('<!-- cmemory:lessons-end -->');

    // Profile appears before lessons
    const profilePos = content.indexOf('<!-- cmemory:profile-start -->');
    const lessonsPos = content.indexOf('<!-- cmemory:lessons-start -->');
    expect(profilePos).toBeLessThan(lessonsPos);
  });

  it('updates existing profile section in CLAUDE.md', async () => {
    // First synthesis: set initial profile
    const response1: SynthesisResponse = {
      profile: '**Stack:** Express',
      actions: [],
    };
    await processSynthesisResponse(tmpDir, response1);

    // Second synthesis: update profile
    const response2: SynthesisResponse = {
      profile: '**Stack:** Express, PostgreSQL\n\n**Auth:** JWT',
      actions: [
        { action: 'add', content: 'Use connection pooling', tags: ['db'] },
      ],
    };
    await processSynthesisResponse(tmpDir, response2);

    const claudeMdPath = path.join(tmpDir, 'CLAUDE.md');
    const content = fs.readFileSync(claudeMdPath, 'utf-8');

    // Old profile content gone
    expect(content).not.toContain('**Stack:** Express\n<!-- cmemory:profile-end -->');
    // New profile content present
    expect(content).toContain('**Stack:** Express, PostgreSQL');
    expect(content).toContain('**Auth:** JWT');
    // Only one pair of profile markers
    expect(content.match(/<!-- cmemory:profile-start -->/g)).toHaveLength(1);
    expect(content.match(/<!-- cmemory:profile-end -->/g)).toHaveLength(1);
  });

  it('creates profile.json during init', () => {
    const profilePath = path.join(tmpDir, '.claude', 'cmemory', 'profile.json');
    expect(fs.existsSync(profilePath)).toBe(true);
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
    expect(profile.content).toBe('');
    expect(profile.updatedAt).toBeNull();
  });
});
