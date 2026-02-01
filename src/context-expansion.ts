/**
 * Context expansion for hierarchical RAG
 *
 * When a section summary appears in top results, expands it by
 * fetching the best-matching child leaf chunk. This gives the LLM
 * both the big picture (summary) and supporting detail (leaf).
 */

import { ChunkLevel } from "./types.js";
import type {
  ExpandedResult,
  ExpansionConfig,
  HierarchicalChunk,
} from "./types.js";

const DEFAULT_MAX_EXPANDED = 7;

/**
 * Expand summary chunks by including their best-matching child.
 *
 * For each section summary (level 1) in the input, finds the
 * highest-scoring child leaf chunk and inserts it after the summary.
 * Document summaries (level 2) are not expanded.
 *
 * @param rankedChunks - Top-K chunks after reranking
 * @param allChunks - Full pool of chunks to pull children from
 * @param config - Expansion configuration
 */
export function expandSummaryChunks(
  rankedChunks: HierarchicalChunk[],
  allChunks: HierarchicalChunk[],
  config?: ExpansionConfig,
): ExpandedResult {
  const maxExpanded = config?.maxExpandedResults ?? DEFAULT_MAX_EXPANDED;
  const scoreLookup = config?.childScoreLookup;

  // Index all chunks by ID for fast lookup
  const chunkById = new Map<string, HierarchicalChunk>();
  for (const chunk of allChunks) {
    chunkById.set(chunk.id, chunk);
  }

  const result: HierarchicalChunk[] = [];
  const expansions: ExpandedResult["expansions"] = [];

  // Track IDs already in results to avoid duplicates
  const includedIds = new Set<string>();

  for (const chunk of rankedChunks) {
    if (result.length >= maxExpanded) break;

    // Always include the ranked chunk itself
    if (!includedIds.has(chunk.id)) {
      result.push(chunk);
      includedIds.add(chunk.id);
    }

    // Expand section summaries (level 1) only
    if (
      chunk.chunkLevel === ChunkLevel.SECTION &&
      chunk.childrenChunkIds.length > 0 &&
      result.length < maxExpanded
    ) {
      const bestChild = findBestChild(
        chunk.childrenChunkIds,
        chunkById,
        includedIds,
        scoreLookup,
      );

      if (bestChild) {
        result.push(bestChild);
        includedIds.add(bestChild.id);
        expansions.push({
          summaryId: chunk.id,
          expandedChildId: bestChild.id,
        });
      }
    }
  }

  return { chunks: result, expansions };
}

/**
 * Find the best child chunk from a list of child IDs.
 *
 * Uses the score lookup function if provided (typically the original
 * hybrid search score), otherwise falls back to the chunk's own score.
 */
function findBestChild(
  childIds: string[],
  chunkById: Map<string, HierarchicalChunk>,
  excludeIds: Set<string>,
  scoreLookup?: (chunkId: string) => number,
): HierarchicalChunk | null {
  let bestChunk: HierarchicalChunk | null = null;
  let bestScore = -Infinity;

  for (const childId of childIds) {
    if (excludeIds.has(childId)) continue;

    const child = chunkById.get(childId);
    if (!child) continue;

    const score = scoreLookup ? scoreLookup(childId) : child.score;
    if (score > bestScore) {
      bestScore = score;
      bestChunk = child;
    }
  }

  return bestChunk;
}
