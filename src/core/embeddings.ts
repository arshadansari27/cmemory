import * as fs from 'fs';
import { modelCacheDir } from '../utils/paths';
import { debug, error as logError } from '../utils/logger';

const MODEL_NAME = 'nomic-ai/nomic-embed-text-v1.5';

let pipelineInstance: any = null;

async function loadTransformers(): Promise<any> {
  // Dynamic import — @huggingface/transformers is ESM-only
  return await import('@huggingface/transformers');
}

async function getPipeline(): Promise<any> {
  if (pipelineInstance) return pipelineInstance;

  const transformers = await loadTransformers();
  const cacheDir = modelCacheDir();

  // If model is already cached, skip remote model checks
  if (fs.existsSync(cacheDir)) {
    transformers.env.allowRemoteModels = false;
  }

  transformers.env.cacheDir = cacheDir;

  debug(`Loading embedding model: ${MODEL_NAME}`);
  pipelineInstance = await transformers.pipeline('feature-extraction', MODEL_NAME, {
    dtype: 'fp32',
  });
  debug('Model loaded');

  return pipelineInstance;
}

/**
 * Generate a normalized embedding vector for the given text.
 * Returns a 768-dimensional float array.
 */
async function getEmbedding(text: string): Promise<number[]> {
  const pipe = await getPipeline();
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
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

  debug(`Ensuring model ${MODEL_NAME} is downloaded to ${cacheDir}`);
  // Running the pipeline once triggers download
  pipelineInstance = await transformers.pipeline('feature-extraction', MODEL_NAME, {
    dtype: 'fp32',
  });
  debug('Model download complete');
}
