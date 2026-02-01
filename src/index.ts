/**
 * @craftrfp/hierarchical-rag
 *
 * Framework-agnostic hierarchical RAG with RAPTOR-style summary nodes.
 * Provides summarization, level-aware reranking, query classification,
 * and context expansion for multi-level document retrieval.
 */

// Types
export { ChunkLevel, QueryType } from "./types.js";

export type {
  LeafChunk,
  HierarchicalChunk,
  SummaryNode,
  SectionGroup,
  HierarchyResult,
  LLMProvider,
  EmbeddingProvider,
  SummarizationConfig,
  QueryClassification,
  QuerySignals,
  RerankingWeights,
  RerankingConfig,
  RankedChunk,
  ExpansionConfig,
  ExpandedResult,
} from "./types.js";

// Summarization pipeline
export {
  createSummarizationPipeline,
  groupChunksBySections,
} from "./summarization.js";

// Query classification
export { classifyQuery, analyzeQuerySignals } from "./query-classifier.js";

// Level-aware reranking
export {
  rerankWithLevels,
  calculateTermFrequency,
  calculatePositionScore,
  calculateTitleBonus,
  calculateSectionBonus,
  calculateLevelBonus,
  extractQueryTerms,
} from "./reranking.js";

// Context expansion
export { expandSummaryChunks } from "./context-expansion.js";
