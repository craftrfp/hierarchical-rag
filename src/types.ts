/**
 * Core types for @craftrfp/hierarchical-rag
 *
 * Framework-agnostic types that consuming apps implement
 * via dependency injection (LLMProvider, EmbeddingProvider).
 */

// ---------------------------------------------------------------------------
// Hierarchy levels
// ---------------------------------------------------------------------------

export enum ChunkLevel {
  /** Original document chunk (~400 tokens) */
  LEAF = 0,
  /** Summary of all chunks within a document section */
  SECTION = 1,
  /** Summary of the entire document */
  DOCUMENT = 2,
}

// ---------------------------------------------------------------------------
// Chunk types
// ---------------------------------------------------------------------------

export interface LeafChunk {
  id: string;
  content: string;
  chunkIndex: number;
  sectionHeader: string | null;
  title: string | null;
  score: number;
}

export interface HierarchicalChunk extends LeafChunk {
  chunkLevel: ChunkLevel;
  parentChunkId: string | null;
  childrenChunkIds: string[];
  metadata: Record<string, unknown>;
}

export interface SummaryNode {
  content: string;
  chunkLevel: ChunkLevel;
  chunkIndex: number;
  sectionHeader: string | null;
  title: string | null;
  childrenChunkIds: string[];
  parentChunkId?: string | null;
  metadata: Record<string, unknown>;
  embedding: number[];
}

// ---------------------------------------------------------------------------
// Summarization pipeline
// ---------------------------------------------------------------------------

export interface SectionGroup {
  sectionHeader: string;
  chunks: LeafChunk[];
}

export interface HierarchyResult {
  sectionSummaries: SummaryNode[];
  documentSummary: SummaryNode | null;
}

// ---------------------------------------------------------------------------
// Provider interfaces (dependency injection)
// ---------------------------------------------------------------------------

export interface LLMProvider {
  summarize(prompt: string): Promise<string>;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export interface SummarizationConfig {
  llm: LLMProvider;
  embedder: EmbeddingProvider;
  maxSectionSummaryWords?: number;
  maxDocumentSummaryWords?: number;
}

// ---------------------------------------------------------------------------
// Query classification
// ---------------------------------------------------------------------------

export enum QueryType {
  /** Short, conceptual queries — boost summaries */
  BROAD = "broad",
  /** Long, specific queries with numbers/proper nouns — boost leaves */
  SPECIFIC = "specific",
  /** In between — use default weighting */
  MODERATE = "moderate",
}

export interface QueryClassification {
  type: QueryType;
  confidence: number;
  signals: QuerySignals;
}

export interface QuerySignals {
  wordCount: number;
  hasNumbers: boolean;
  hasProperNouns: boolean;
  hasQuotedTerms: boolean;
  isBroadQuestion: boolean;
}

// ---------------------------------------------------------------------------
// Reranking
// ---------------------------------------------------------------------------

export interface RerankingWeights {
  baseScore: number;
  termFrequency: number;
  positionScore: number;
  titleBonus: number;
  sectionBonus: number;
  levelBonus: number;
}

export interface RerankingConfig {
  weights?: Partial<RerankingWeights>;
  topK?: number;
}

export interface RankedChunk extends HierarchicalChunk {
  rerankScore: number;
}

// ---------------------------------------------------------------------------
// Context expansion
// ---------------------------------------------------------------------------

export interface ExpansionConfig {
  maxExpandedResults?: number;
  childScoreLookup?: (chunkId: string) => number;
}

export interface ExpandedResult {
  chunks: HierarchicalChunk[];
  expansions: Array<{
    summaryId: string;
    expandedChildId: string;
  }>;
}
