import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { saveLessons, saveProfile, loadLessons } from '../../src/core/storage';
import { updateClaudeMd } from '../../src/synthesis/claude-md';
import { Lesson } from '../../src/core/types';
import { makeTmpProject, TmpProject } from '../helpers/tmpProject';

let project: TmpProject;

beforeEach(() => {
  project = makeTmpProject();
});

afterEach(() => {
  project.cleanup();
});

function makeLesson(id: string, content: string, updatedAt: string): Lesson {
  return {
    id,
    content,
    tags: [],
    embedding: [0.1],
    createdAt: updatedAt,
    updatedAt,
    source: 'manual',
  };
}

describe('updateClaudeMd', () => {
  it('updates lessons section when markers exist; preserves content outside markers', () => {
    const lesson = makeLesson('l1', 'Test lesson content', '2025-01-01T00:00:00Z');
    saveLessons(project.root, [lesson]);

    updateClaudeMd(project.root);

    const md = fs.readFileSync(project.claudeMdPath, 'utf-8');
    expect(md).toContain('Test lesson content');
    expect(md).toContain('Some user content here.');
    expect(md).toContain('More user content below.');
  });

  it('updates profile section in place', () => {
    saveProfile(project.root, { content: 'Custom stack info', updatedAt: new Date().toISOString() });

    updateClaudeMd(project.root);

    const md = fs.readFileSync(project.claudeMdPath, 'utf-8');
    expect(md).toContain('Custom stack info');
    expect(md).toContain('Some user content here.');
  });

  it('creates CLAUDE.md when file does not exist', () => {
    fs.unlinkSync(project.claudeMdPath);
    expect(fs.existsSync(project.claudeMdPath)).toBe(false);

    updateClaudeMd(project.root);

    expect(fs.existsSync(project.claudeMdPath)).toBe(true);
    const md = fs.readFileSync(project.claudeMdPath, 'utf-8');
    expect(md).toContain('<!-- cmemory:tools-start -->');
    expect(md).toContain('<!-- cmemory:lessons-start -->');
    expect(md).toContain('<!-- cmemory:profile-start -->');
  });

  it('top 10 lessons sorted by updatedAt desc', () => {
    const lessons: Lesson[] = [];
    for (let i = 0; i < 12; i++) {
      const month = String(i + 1).padStart(2, '0');
      lessons.push(makeLesson(`l${i}`, `Lesson number ${i}`, `2025-${month}-01T00:00:00Z`));
    }
    saveLessons(project.root, lessons);

    updateClaudeMd(project.root);

    const md = fs.readFileSync(project.claudeMdPath, 'utf-8');

    // Lessons 2-11 (months 3-12) should appear (top 10 by updatedAt desc)
    for (let i = 2; i < 12; i++) {
      expect(md).toContain(`Lesson number ${i}`);
    }
    // Lessons 0 and 1 (months 1-2) should NOT appear — they're the oldest
    // Use \n anchoring to avoid matching "Lesson number 10" / "Lesson number 11"
    expect(md).not.toMatch(/- Lesson number 0\n/);
    expect(md).not.toMatch(/- Lesson number 1\n/);
  });

  it('empty lessons → markers only (no header)', () => {
    saveLessons(project.root, []);

    updateClaudeMd(project.root);

    const md = fs.readFileSync(project.claudeMdPath, 'utf-8');
    expect(md).toContain('<!-- cmemory:lessons-start -->\n<!-- cmemory:lessons-end -->');
    expect(md).not.toContain('## Project Lessons');
  });

  it('empty profile → markers only (no header)', () => {
    saveProfile(project.root, { content: '', updatedAt: null });

    updateClaudeMd(project.root);

    const md = fs.readFileSync(project.claudeMdPath, 'utf-8');
    expect(md).toContain('<!-- cmemory:profile-start -->\n<!-- cmemory:profile-end -->');
    expect(md).not.toContain('## Project Profile');
  });

  it('idempotent: calling twice produces same result', () => {
    const lesson = makeLesson('l1', 'Idempotent lesson', '2025-06-01T00:00:00Z');
    saveLessons(project.root, [lesson]);
    saveProfile(project.root, { content: 'Stable profile', updatedAt: new Date().toISOString() });

    updateClaudeMd(project.root);
    const first = fs.readFileSync(project.claudeMdPath, 'utf-8');

    updateClaudeMd(project.root);
    const second = fs.readFileSync(project.claudeMdPath, 'utf-8');

    expect(second).toBe(first);
  });
});
