/**
 * Level-aware reranking for hierarchical RAG
 *
 * Extends standard reranking with a level bonus that boosts
 * summary nodes for broad queries and leaf chunks for specific queries.
 */

import { classifyQuery } from "./query-classifier.js";
import { ChunkLevel, QueryType } from "./types.js";
import type {
  HierarchicalChunk,
  RankedChunk,
  RerankingConfig,
  RerankingWeights,
} from "./types.js";

const DEFAULT_WEIGHTS: RerankingWeights = {
  baseScore: 0.35,
  termFrequency: 0.2,
  positionScore: 0.1,
  titleBonus: 0.1,
  sectionBonus: 0.08,
  levelBonus: 0.17,
};

const DEFAULT_TOP_K = 5;

/**
 * Calculate term frequency score for content against query terms.
 */
export function calculateTermFrequency(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;

  for (const term of terms) {
    const lowerTerm = term.toLowerCase();
    const matches = lower.split(lowerTerm).length - 1;
    score += matches / Math.max(lower.length / 100, 1);
  }

  return score;
}

/**
 * Calculate position score — earlier mentions score higher.
 */
export function calculatePositionScore(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  let total = 0;

  for (const term of terms) {
    const pos = lower.indexOf(term.toLowerCase());
    if (pos >= 0) {
      total += 1 - pos / lower.length;
    }
  }

  return total / Math.max(terms.length, 1);
}

/**
 * Calculate title relevance bonus.
 */
export function calculateTitleBonus(
  title: string | null,
  terms: string[],
): number {
  if (!title) return 0;
  const lower = title.toLowerCase();
  const matches = terms.filter((t) => lower.includes(t.toLowerCase()));
  return matches.length / Math.max(terms.length, 1);
}

/**
 * Calculate section header relevance bonus.
 */
export function calculateSectionBonus(
  sectionHeader: string | null,
  terms: string[],
): number {
  if (!sectionHeader) return 0;
  const lower = sectionHeader.toLowerCase();
  const matches = terms.filter((t) => lower.includes(t.toLowerCase()));
  return matches.length / Math.max(terms.length, 1);
}

/**
 * Calculate level bonus based on query classification.
 *
 * Broad queries boost summaries (levels 1-2).
 * Specific queries boost leaves (level 0).
 * Moderate queries use mild differentiation.
 */
export function calculateLevelBonus(
  chunkLevel: ChunkLevel,
  queryType: QueryType,
): number {
  switch (queryType) {
    case QueryType.BROAD:
      // Strongly boost summaries
      if (chunkLevel === ChunkLevel.DOCUMENT) return 1.0;
      if (chunkLevel === ChunkLevel.SECTION) return 0.85;
      return 0.2;

    case QueryType.SPECIFIC:
      // Strongly boost leaves
      if (chunkLevel === ChunkLevel.LEAF) return 1.0;
      if (chunkLevel === ChunkLevel.SECTION) return 0.4;
      return 0.15;

    case QueryType.MODERATE:
      // Mild preference for sections (best of both)
      if (chunkLevel === ChunkLevel.SECTION) return 0.8;
      if (chunkLevel === ChunkLevel.LEAF) return 0.6;
      return 0.5;
  }
}

/**
 * Extract meaningful query terms (filter short/common words).
 */
export function extractQueryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/**
 * Rerank hierarchical chunks with level awareness.
 *
 * Combines the original search score with term frequency, position,
 * title/section relevance, and a level bonus based on query type.
 */
export function rerankWithLevels(
  chunks: HierarchicalChunk[],
  query: string,
  config?: RerankingConfig,
): RankedChunk[] {
  const weights = { ...DEFAULT_WEIGHTS, ...config?.weights };
  const topK = config?.topK ?? DEFAULT_TOP_K;

  const queryTerms = extractQueryTerms(query);
  if (queryTerms.length === 0) {
    return chunks.slice(0, topK).map((c) => ({ ...c, rerankScore: c.score }));
  }

  const classification = classifyQuery(query);

  const scored: RankedChunk[] = chunks.map((chunk) => {
    const base = Math.min(chunk.score, 1);
    const tf = calculateTermFrequency(chunk.content, queryTerms);
    const position = calculatePositionScore(chunk.content, queryTerms);
    const title = calculateTitleBonus(chunk.title, queryTerms);
    const section = calculateSectionBonus(chunk.sectionHeader, queryTerms);
    const level = calculateLevelBonus(chunk.chunkLevel, classification.type);

    const rerankScore =
      base * weights.baseScore +
      tf * weights.termFrequency +
      position * weights.positionScore +
      title * weights.titleBonus +
      section * weights.sectionBonus +
      level * weights.levelBonus;

    return { ...chunk, rerankScore };
  });

  return scored.sort((a, b) => b.rerankScore - a.rerankScore).slice(0, topK);
}
