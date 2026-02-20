import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const CMEMORY_DIR = '.claude/cmemory';

/**
 * Walk up from `cwd` to find a directory containing `.claude/cmemory/`.
 * Returns the project root (parent of `.claude/`) or null.
 */
export function findProjectRoot(cwd: string): string | null {
  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;

  while (true) {
    const candidate = path.join(dir, CMEMORY_DIR);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir || dir === root) {
      return null;
    }
    dir = parent;
  }
}

/**
 * Resolve the cmemory data directory for a given project root.
 */
export function cmemoryDir(projectRoot: string): string {
  return path.join(projectRoot, CMEMORY_DIR);
}

/**
 * Global model cache directory: ~/.cmemory/models/
 */
export function modelCacheDir(): string {
  return path.join(os.homedir(), '.cmemory', 'models');
}

/**
 * Extract absolute or ~-prefixed file paths from prompt text.
 * Used for cross-project lesson lookup.
 */
export function resolveExternalPaths(prompt: string): string[] {
  const paths: string[] = [];
  // Match:
  //   ~/...           — home-relative Unix paths
  //   /word...        — absolute Unix paths (must start with /word to avoid bare /)
  //   C:\... or C:/.. — Windows absolute paths (drive letter)
  // Allows: word chars, dots, hyphens, slashes, backslashes
  const regex = /(?:~[/\\][\w.\-/\\]+|\/[\w][\w.\-/\\]*|[A-Za-z]:[/\\][\w.\-/\\]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(prompt)) !== null) {
    let p = match[0];
    if (p.startsWith('~')) {
      p = path.join(os.homedir(), p.slice(2));
    }
    paths.push(p);
  }

  return paths;
}

/**
 * Given a file path, walk up to find a project root containing `.claude/cmemory/`.
 */
export function findProjectRootForPath(filePath: string): string | null {
  const dir = fs.existsSync(filePath) && fs.statSync(filePath).isFile()
    ? path.dirname(filePath)
    : filePath;
  return findProjectRoot(dir);
}
