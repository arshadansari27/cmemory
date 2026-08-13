import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { modelCacheDir } from '../../src/utils/paths';

const QUANTIZED = path.join(
  modelCacheDir(),
  'nomic-ai/nomic-embed-text-v1.5/onnx/model_quantized.onnx'
);

function cos(a: number[], b: number[]): number {
  return a.reduce((s, x, i) => s + x * b[i], 0);
}

// IDLE_DISPOSE_MS is read when the module loads, so set env before importing.
let mod: typeof import('../../src/core/embeddings');
const stderr: string[] = [];

beforeAll(async () => {
  process.env.CMEMORY_MODEL_IDLE_MS = '300';
  process.env.CMEMORY_DEBUG = '1';
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
    stderr.push(String(chunk));
    return true;
  });
  vi.resetModules();
  mod = await import('../../src/core/embeddings');
});

describe('quantized embedding model', () => {
  it('embeds with the q8 weights and normalizes to 768 dims', async () => {
    const v = await mod.getQueryEmbedding('memory guard threshold');
    expect(v).toHaveLength(768);
    expect(Math.sqrt(v.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 3);
    expect(fs.existsSync(QUANTIZED)).toBe(true);
  });

  // The real risk of quantizing: retrieval stops separating related from unrelated.
  it('still ranks a related document above an unrelated one', async () => {
    const query = await mod.getQueryEmbedding('process killed due to high RAM usage');
    const related = await mod.getDocumentEmbedding(
      'the server ran out of memory and the kernel killed it'
    );
    const unrelated = await mod.getDocumentEmbedding('banana bread recipe with walnuts');
    expect(cos(query, related)).toBeGreaterThan(cos(query, unrelated) + 0.1);
  });

  it('disposes the model when idle and reloads on the next call', async () => {
    await mod.getQueryEmbedding('warm the pipeline');
    stderr.length = 0;
    await new Promise((r) => setTimeout(r, 1000));
    expect(stderr.join('')).toContain('Disposing idle embedding model');
    expect(await mod.getDocumentEmbedding('works again after dispose')).toHaveLength(768);
  });
});
