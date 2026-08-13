import * as fs from 'fs';
import * as path from 'path';
import { modelCacheDir } from '../utils/paths';
import { debug, error as logError } from '../utils/logger';

const MODEL_NAME = 'nomic-ai/nomic-embed-text-v1.5';
// q8 weights are ~140MB against fp32's 522MB. Claude Code starts one cmemory MCP
// server per session, so the fp32 model cost ~1.6GB RSS in *every* open session.
const MODEL_DTYPE = 'q8';
// Must track MODEL_DTYPE: transformers' DEFAULT_DTYPE_SUFFIX_MAPPING maps q8 -> '_quantized'.
const MODEL_FILE = 'model_quantized.onnx';
// Release the model after this long with no embedding call. Sessions sit idle for
// hours, and holding the model that whole time is the actual memory problem.
// 0 disables the timer.
const IDLE_DISPOSE_MS = Number(process.env.CMEMORY_MODEL_IDLE_MS ?? 5 * 60 * 1000);

let pipelineInstance: any = null;
let idleTimer: NodeJS.Timeout | null = null;

async function loadTransformers(): Promise<any> {
  // Dynamic import — @huggingface/transformers is ESM-only
  return await import('@huggingface/transformers');
}

async function getPipeline(): Promise<any> {
  if (pipelineInstance) return pipelineInstance;

  const transformers = await loadTransformers();
  const cacheDir = modelCacheDir();

  // Skip remote model checks only if the file for THIS dtype is already cached —
  // an fp32-only cache must still be allowed to fetch the quantized weights.
  if (fs.existsSync(path.join(cacheDir, MODEL_NAME, 'onnx', MODEL_FILE))) {
    transformers.env.allowRemoteModels = false;
  }

  transformers.env.cacheDir = cacheDir;

  debug(`Loading embedding model: ${MODEL_NAME} (${MODEL_DTYPE})`);
  pipelineInstance = await transformers.pipeline('feature-extraction', MODEL_NAME, {
    dtype: MODEL_DTYPE,
  });
  debug('Model loaded');

  return pipelineInstance;
}

/** Drop the model once it has gone unused for IDLE_DISPOSE_MS. */
function scheduleIdleDispose(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (!(IDLE_DISPOSE_MS > 0)) return;

  idleTimer = setTimeout(() => {
    const stale = pipelineInstance;
    pipelineInstance = null;
    idleTimer = null;
    debug('Disposing idle embedding model');
    void Promise.resolve(stale?.dispose?.()).catch((e: unknown) =>
      logError('Failed to dispose embedding model:', e)
    );
  }, IDLE_DISPOSE_MS);
  idleTimer.unref(); // must never hold the MCP process open on its own
}

/**
 * Generate a normalized embedding vector for the given text.
 * Returns a 768-dimensional float array.
 */
async function getEmbedding(text: string): Promise<number[]> {
  if (idleTimer) {
    clearTimeout(idleTimer); // never dispose out from under an in-flight call
    idleTimer = null;
  }
  const pipe = await getPipeline();
  try {
    const output = await pipe(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array);
  } finally {
    scheduleIdleDispose();
  }
}

/**
 * Generate an embedding for a search query.
 * Prepends the "search_query: " prefix required by nomic for asymmetric search.
 */
export async function getQueryEmbedding(text: string): Promise<number[]> {
  return getEmbedding(`search_query: ${text}`);
}

/**
 * Generate an embedding for a document to be stored.
 * Prepends the "search_document: " prefix required by nomic for asymmetric search.
 */
export async function getDocumentEmbedding(text: string): Promise<number[]> {
  return getEmbedding(`search_document: ${text}`);
}

/**
 * Download the model to the cache directory if not already present.
 * Call this during `cmemory init` or a setup step.
 */
export async function ensureModelDownloaded(): Promise<void> {
  const cacheDir = modelCacheDir();
  fs.mkdirSync(cacheDir, { recursive: true });

  const transformers = await loadTransformers();
  transformers.env.cacheDir = cacheDir;
  transformers.env.allowRemoteModels = true;

  debug(`Ensuring model ${MODEL_NAME} (${MODEL_DTYPE}) is downloaded to ${cacheDir}`);
  // Running the pipeline once triggers download
  pipelineInstance = await transformers.pipeline('feature-extraction', MODEL_NAME, {
    dtype: MODEL_DTYPE,
  });
  debug('Model download complete');
}
