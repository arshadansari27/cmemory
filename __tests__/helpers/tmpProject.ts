import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initCmemory } from '../../src/core/storage';
import { EmbeddingProvider } from '../../src/mcp/handlers';

const EMBEDDING_DIM = 768;

const CLAUDE_MD_TEMPLATE = `# Test Project

<!-- cmemory:tools-start -->
<!-- cmemory:tools-end -->

<!-- cmemory:profile-start -->
<!-- cmemory:profile-end -->

Some user content here.

<!-- cmemory:lessons-start -->
<!-- cmemory:lessons-end -->

More user content below.
`;

export interface TmpProject {
  root: string;
  claudeMdPath: string;
  cleanup: () => void;
}

/**
 * Create a temporary project directory with cmemory initialized and a CLAUDE.md with all marker pairs.
 */
export function makeTmpProject(): TmpProject {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cmemory-test-'));
  initCmemory(root);

  const claudeMdPath = path.join(root, 'CLAUDE.md');
  fs.writeFileSync(claudeMdPath, CLAUDE_MD_TEMPLATE, 'utf-8');

  return {
    root,
    claudeMdPath,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Create a 768-dim unit vector with 1.0 at the given index, 0.0 elsewhere.
 * Two vectors with the same index have cosine similarity 1.0.
 * Two vectors with different indices have cosine similarity 0.0.
 */
export function fakeEmbedding(index: number): number[] {
  const vec = new Array(EMBEDDING_DIM).fill(0);
  vec[index % EMBEDDING_DIM] = 1.0;
  return vec;
}

/**
 * Create an EmbeddingProvider that returns deterministic fake embeddings.
 * - getQueryEmbedding always returns fakeEmbedding(queryIndex)
 * - getDocumentEmbedding always returns fakeEmbedding(docIndex)
 *
 * Same index → cosine similarity 1.0 (dedup triggers).
 * Different index → cosine similarity 0.0 (no match).
 */
export function makeFakeEmbeddingProvider(queryIndex: number, docIndex: number): EmbeddingProvider {
  return {
    getQueryEmbedding: async (_text: string) => fakeEmbedding(queryIndex),
    getDocumentEmbedding: async (_text: string) => fakeEmbedding(docIndex),
  };
}
