/**
 * Summarization pipeline for hierarchical RAG
 *
 * Generates section-level and document-level summaries from leaf chunks.
 * Uses dependency injection for LLM and embedding providers so consuming
 * apps can plug in any model (Gemini, OpenAI, etc.).
 */

import type {
  ChunkLevel,
  EmbeddingProvider,
  HierarchyResult,
  LeafChunk,
  LLMProvider,
  SectionGroup,
  SummarizationConfig,
  SummaryNode,
} from "./types.js";

const DEFAULT_MAX_SECTION_WORDS = 400;
const DEFAULT_MAX_DOCUMENT_WORDS = 600;

function buildSectionPrompt(
  sectionHeader: string,
  content: string,
  maxWords: number,
): string {
  return [
    `Summarize the following section from a document.`,
    `Preserve all key facts, figures, dates, and requirements.`,
    `Keep the summary under ${maxWords} words.`,
    `Section: "${sectionHeader}"`,
    ``,
    content,
  ].join("\n");
}

function buildDocumentPrompt(
  sectionSummaries: string,
  title: string | null,
  maxWords: number,
): string {
  const titleLine = title ? `Document: "${title}"\n` : "";
  return [
    `Summarize the following document based on its section summaries.`,
    `Capture the overall purpose, key requirements, and important details.`,
    `Keep the summary under ${maxWords} words.`,
    titleLine,
    sectionSummaries,
  ].join("\n");
}

/**
 * Group leaf chunks by their section header.
 * Chunks without a section header are grouped under "__ungrouped__".
 */
export function groupChunksBySections(chunks: LeafChunk[]): SectionGroup[] {
  const sorted = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  const groups = new Map<string, LeafChunk[]>();

  for (const chunk of sorted) {
    const key = chunk.sectionHeader ?? "__ungrouped__";
    const existing = groups.get(key);
    if (existing) {
      existing.push(chunk);
    } else {
      groups.set(key, [chunk]);
    }
  }

  return Array.from(groups.entries()).map(([header, sectionChunks]) => ({
    sectionHeader: header,
    chunks: sectionChunks,
  }));
}

/**
 * Generate a summary for a single section group.
 */
async function summarizeSection(
  group: SectionGroup,
  llm: LLMProvider,
  embedder: EmbeddingProvider,
  maxWords: number,
  sectionIndex: number,
): Promise<SummaryNode> {
  const concatenated = group.chunks.map((c) => c.content).join("\n\n");

  const prompt = buildSectionPrompt(
    group.sectionHeader,
    concatenated,
    maxWords,
  );
  const summaryText = await llm.summarize(prompt);
  const embedding = await embedder.embed(summaryText);

  const firstChunk = group.chunks[0];

  return {
    content: summaryText,
    chunkLevel: 1 as ChunkLevel,
    chunkIndex: sectionIndex,
    sectionHeader: group.sectionHeader,
    title: firstChunk?.title ?? null,
    childrenChunkIds: group.chunks.map((c) => c.id),
    metadata: {
      childCount: group.chunks.length,
      summaryWordCount: summaryText.split(/\s+/).length,
    },
    embedding,
  };
}

/**
 * Generate a document-level summary from section summaries.
 */
async function summarizeDocument(
  sectionSummaries: SummaryNode[],
  title: string | null,
  llm: LLMProvider,
  embedder: EmbeddingProvider,
  maxWords: number,
): Promise<SummaryNode> {
  const concatenated = sectionSummaries
    .map((s) => {
      const header = s.sectionHeader ? `## ${s.sectionHeader}\n` : "";
      return `${header}${s.content}`;
    })
    .join("\n\n---\n\n");

  const prompt = buildDocumentPrompt(concatenated, title, maxWords);
  const summaryText = await llm.summarize(prompt);
  const embedding = await embedder.embed(summaryText);

  return {
    content: summaryText,
    chunkLevel: 2 as ChunkLevel,
    chunkIndex: 0,
    sectionHeader: null,
    title,
    childrenChunkIds: [],
    metadata: {
      childCount: sectionSummaries.length,
      sectionSummaryCount: sectionSummaries.length,
      sourceSections: sectionSummaries
        .map((s) => s.sectionHeader)
        .filter(Boolean),
      summaryWordCount: summaryText.split(/\s+/).length,
    },
    embedding,
  };
}

/**
 * Create a summarization pipeline with the given LLM and embedding providers.
 *
 * Usage:
 * ```ts
 * const pipeline = createSummarizationPipeline({
 *   llm: myGeminiProvider,
 *   embedder: myEmbeddingProvider,
 * });
 * const result = await pipeline.generateHierarchy(leafChunks);
 * ```
 */
export function createSummarizationPipeline(config: SummarizationConfig) {
  const maxSectionWords =
    config.maxSectionSummaryWords ?? DEFAULT_MAX_SECTION_WORDS;
  const maxDocumentWords =
    config.maxDocumentSummaryWords ?? DEFAULT_MAX_DOCUMENT_WORDS;

  return {
    /**
     * Generate hierarchical summaries from leaf chunks.
     *
     * Returns section-level summaries (level 1) and a document summary (level 2).
     * If there are fewer than 2 sections, only a document summary is generated.
     */
    async generateHierarchy(
      leafChunks: LeafChunk[],
      documentTitle?: string | null,
    ): Promise<HierarchyResult> {
      if (leafChunks.length === 0) {
        return { sectionSummaries: [], documentSummary: null };
      }

      const title = documentTitle ?? leafChunks[0]?.title ?? null;
      const sections = groupChunksBySections(leafChunks);

      // Generate section summaries
      const sectionSummaries: SummaryNode[] = [];
      for (const section of sections) {
        if (section.chunks.length === 0) continue;
        const summary = await summarizeSection(
          section,
          config.llm,
          config.embedder,
          maxSectionWords,
          sectionSummaries.length,
        );
        sectionSummaries.push(summary);
      }

      // Generate document summary from section summaries
      let documentSummary: SummaryNode | null = null;
      if (sectionSummaries.length > 0) {
        documentSummary = await summarizeDocument(
          sectionSummaries,
          title,
          config.llm,
          config.embedder,
          maxDocumentWords,
        );
      }

      return { sectionSummaries, documentSummary };
    },

    /** Group leaf chunks by section header. Exposed for testing. */
    groupChunksBySections,
  };
}
