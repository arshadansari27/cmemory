import { describe, it, expect } from 'vitest';
import { cosineSimilarity, searchLessons } from '../../src/core/search';
import { Lesson } from '../../src/core/types';

describe('cosineSimilarity', () => {
  it('returns 1 for identical normalized vectors', () => {
    const v = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.0, 5);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0, 5);
  });

  it('throws on dimension mismatch', () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow('dimension mismatch');
  });
});

describe('searchLessons', () => {
  const makeLessons = (): Lesson[] => [
    {
      id: '1',
      content: 'Auth lesson',
      tags: ['auth'],
      embedding: [0.9, 0.1, 0.0],
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      source: 'manual',
    },
    {
      id: '2',
      content: 'DB lesson',
      tags: ['db'],
      embedding: [0.1, 0.9, 0.0],
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      source: 'manual',
    },
    {
      id: '3',
      content: 'Low relevance',
      tags: [],
      embedding: [0.0, 0.0, 1.0],
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      source: 'synthesis',
    },
  ];

  it('returns lessons above threshold sorted by score', () => {
    const query = [0.85, 0.15, 0.0]; // close to lesson 1
    const results = searchLessons(query, makeLessons(), 0.5, 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].lesson.id).toBe('1');
    expect(results[0].score).toBeGreaterThanOrEqual(results[results.length - 1].score);
  });

  it('respects topK limit', () => {
    const query = [0.5, 0.5, 0.0];
    const results = searchLessons(query, makeLessons(), 0.0, 1);
    expect(results).toHaveLength(1);
  });

  it('returns empty for high threshold', () => {
    const query = [0.33, 0.33, 0.33];
    const results = searchLessons(query, makeLessons(), 0.99, 5);
    expect(results).toHaveLength(0);
  });

  it('skips lessons without embeddings', () => {
    const lessons = makeLessons();
    lessons[0].embedding = [];
    const results = searchLessons([0.9, 0.1, 0.0], lessons, 0.0, 5);
    expect(results.find(r => r.lesson.id === '1')).toBeUndefined();
  });
});
