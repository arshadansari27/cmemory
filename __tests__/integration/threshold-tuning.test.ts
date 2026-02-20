// Threshold tuning test — loads the real nomic-embed-text-v1.5 model.
// Run with: npm run test:integration
//
// Last run (nomic-embed-text-v1.5, 2026-02-19):
// SHOULD_MATCH range: 0.50 – 0.78
// SHOULD_NOT_MATCH range: 0.42 – 0.45
// Gap: 0.05 (0.50 min match vs 0.45 max no-match)
// Test threshold 0.48 sits in the gap; production threshold 0.55 trades recall for precision

import { describe, it, expect, beforeAll } from 'vitest';
import { getQueryEmbedding, getDocumentEmbedding } from '../../src/core/embeddings';
import { cosineSimilarity } from '../../src/core/search';

const THRESHOLD = 0.48;

// Real lesson/query pairs that SHOULD match
const SHOULD_MATCH = [
  {
    lesson: 'Token refresh silently fails when session cookie is expired',
    queries: ['auth login broken', 'session expired bug', 'why is login failing'],
  },
  {
    lesson: 'Database migrations must run before seed scripts or seeds will reference missing tables',
    queries: ['seed script failing', 'table not found error', 'migration order'],
  },
  {
    lesson: 'The Stripe webhook handler silently drops events when signature verification throws',
    queries: ['stripe webhooks not working', 'payment events missing', 'webhook signature error'],
  },
];

// Pairs that should NOT match
const SHOULD_NOT_MATCH = [
  {
    lesson: 'Token refresh silently fails when session cookie is expired',
    queries: ['how to center a div', 'database connection pooling', 'nginx config'],
  },
];

describe('threshold tuning (real model)', () => {
  const results: Array<{ lesson: string; query: string; score: number; expected: string }> = [];

  beforeAll(async () => {
    for (const { lesson, queries } of SHOULD_MATCH) {
      const docEmb = await getDocumentEmbedding(lesson);
      for (const query of queries) {
        const queryEmb = await getQueryEmbedding(query);
        const score = cosineSimilarity(queryEmb, docEmb);
        results.push({ lesson: lesson.slice(0, 50), query, score, expected: 'match' });
      }
    }

    for (const { lesson, queries } of SHOULD_NOT_MATCH) {
      const docEmb = await getDocumentEmbedding(lesson);
      for (const query of queries) {
        const queryEmb = await getQueryEmbedding(query);
        const score = cosineSimilarity(queryEmb, docEmb);
        results.push({ lesson: lesson.slice(0, 50), query, score, expected: 'no-match' });
      }
    }

    // Print the full score table for visual inspection
    console.table(results.map(r => ({
      expected: r.expected,
      score: r.score.toFixed(4),
      query: r.query,
      lesson: r.lesson + '...',
    })));
  });

  it('related queries score above threshold', () => {
    const matchResults = results.filter(r => r.expected === 'match');
    for (const r of matchResults) {
      expect(r.score, `"${r.query}" vs "${r.lesson}..."`).toBeGreaterThanOrEqual(THRESHOLD);
    }
  });

  it('unrelated queries score below threshold', () => {
    const noMatchResults = results.filter(r => r.expected === 'no-match');
    for (const r of noMatchResults) {
      expect(r.score, `"${r.query}" vs "${r.lesson}..."`).toBeLessThan(THRESHOLD);
    }
  });
});
