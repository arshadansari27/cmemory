import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { findProjectRoot, resolveExternalPaths, findProjectRootForPath } from '../../src/utils/paths';
import { initCmemory } from '../../src/core/storage';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmemory-path-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('findProjectRoot', () => {
  it('finds project root from cwd', () => {
    initCmemory(tmpDir);
    expect(findProjectRoot(tmpDir)).toBe(tmpDir);
  });

  it('finds project root from subdirectory', () => {
    initCmemory(tmpDir);
    const subDir = path.join(tmpDir, 'src', 'deep');
    fs.mkdirSync(subDir, { recursive: true });
    expect(findProjectRoot(subDir)).toBe(tmpDir);
  });

  it('returns null when no cmemory dir exists', () => {
    expect(findProjectRoot(tmpDir)).toBeNull();
  });
});

describe('findProjectRootForPath', () => {
  it('finds root from a file path inside a project', () => {
    initCmemory(tmpDir);
    const filePath = path.join(tmpDir, 'src', 'index.ts');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '');
    expect(findProjectRootForPath(filePath)).toBe(tmpDir);
  });
});

describe('resolveExternalPaths', () => {
  it('extracts absolute Unix paths from prompt', () => {
    const paths = resolveExternalPaths('Look at /home/user/project/src/auth.ts for reference');
    expect(paths).toContain('/home/user/project/src/auth.ts');
  });

  it('extracts ~ paths from prompt', () => {
    const paths = resolveExternalPaths('Check ~/projects/other/lib/utils.ts');
    expect(paths.length).toBe(1);
    // path.join uses OS separators, so normalize for comparison
    const normalized = paths[0].replace(/\\/g, '/');
    expect(normalized).toContain('projects/other/lib/utils.ts');
  });

  it('returns empty array for no paths', () => {
    const paths = resolveExternalPaths('Just a normal prompt with no file paths');
    expect(paths).toEqual([]);
  });
});
