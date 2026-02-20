import { Lesson, SearchResult } from './types';

/**
 * Compute cosine similarity between two vectors.
 * Assumes both vectors are normalized (magnitude ~1), so dot product = cosine similarity.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Search lessons by embedding similarity.
 * Returns top-K lessons above the similarity threshold, sorted by score descending.
 */
export function searchLessons(
  queryEmbedding: number[],
  lessons: Lesson[],
  threshold: number = 0.70,
  topK: number = 5
): SearchResult[] {
  const results: SearchResult[] = [];

  for (const lesson of lessons) {
    if (!lesson.embedding || lesson.embedding.length === 0) continue;
    const score = cosineSimilarity(queryEmbedding, lesson.embedding);
    if (score >= threshold) {
      results.push({ lesson, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}
