import { describe, it, expect, vi } from "vitest";
import {
  createSummarizationPipeline,
  groupChunksBySections,
} from "../src/summarization.js";
import type {
  LeafChunk,
  LLMProvider,
  EmbeddingProvider,
} from "../src/types.js";

function makeChunk(overrides: Partial<LeafChunk> = {}): LeafChunk {
  return {
    id: "chunk-1",
    content: "Some content about the budget.",
    chunkIndex: 0,
    sectionHeader: "Budget",
    title: "Acme RFP",
    score: 0.8,
    ...overrides,
  };
}

function makeMockLLM(): LLMProvider {
  return {
    summarize: vi.fn().mockResolvedValue("This is a summary of the section."),
  };
}

function makeMockEmbedder(): EmbeddingProvider {
  const fakeEmbedding = Array.from({ length: 768 }, () => 0.1);
  return {
    embed: vi.fn().mockResolvedValue(fakeEmbedding),
    embedBatch: vi
      .fn()
      .mockImplementation((texts: string[]) =>
        Promise.resolve(texts.map(() => [...fakeEmbedding])),
      ),
  };
}

describe("groupChunksBySections", () => {
  it("groups chunks by section header", () => {
    const chunks = [
      makeChunk({ id: "1", sectionHeader: "Budget", chunkIndex: 0 }),
      makeChunk({ id: "2", sectionHeader: "Budget", chunkIndex: 1 }),
      makeChunk({ id: "3", sectionHeader: "Timeline", chunkIndex: 2 }),
    ];

    const groups = groupChunksBySections(chunks);

    expect(groups).toHaveLength(2);
    expect(groups[0].sectionHeader).toBe("Budget");
    expect(groups[0].chunks).toHaveLength(2);
    expect(groups[1].sectionHeader).toBe("Timeline");
    expect(groups[1].chunks).toHaveLength(1);
  });

  it("groups chunks without section header under __ungrouped__", () => {
    const chunks = [
      makeChunk({ id: "1", sectionHeader: null, chunkIndex: 0 }),
      makeChunk({ id: "2", sectionHeader: "Budget", chunkIndex: 1 }),
    ];

    const groups = groupChunksBySections(chunks);

    expect(groups).toHaveLength(2);
    expect(groups[0].sectionHeader).toBe("__ungrouped__");
    expect(groups[1].sectionHeader).toBe("Budget");
  });

  it("preserves chunk order within groups", () => {
    const chunks = [
      makeChunk({ id: "3", sectionHeader: "Budget", chunkIndex: 2 }),
      makeChunk({ id: "1", sectionHeader: "Budget", chunkIndex: 0 }),
      makeChunk({ id: "2", sectionHeader: "Budget", chunkIndex: 1 }),
    ];

    const groups = groupChunksBySections(chunks);

    expect(groups[0].chunks.map((c) => c.chunkIndex)).toEqual([0, 1, 2]);
  });

  it("returns empty array for empty input", () => {
    expect(groupChunksBySections([])).toEqual([]);
  });
});

describe("createSummarizationPipeline", () => {
  it("generates section summaries and document summary", async () => {
    const llm = makeMockLLM();
    const embedder = makeMockEmbedder();
    const pipeline = createSummarizationPipeline({ llm, embedder });

    const chunks = [
      makeChunk({ id: "1", sectionHeader: "Budget", chunkIndex: 0 }),
      makeChunk({ id: "2", sectionHeader: "Timeline", chunkIndex: 1 }),
    ];

    const result = await pipeline.generateHierarchy(chunks, "Test RFP");

    expect(result.sectionSummaries).toHaveLength(2);
    expect(result.documentSummary).not.toBeNull();

    // LLM called: 2 sections + 1 document = 3
    expect(llm.summarize).toHaveBeenCalledTimes(3);

    // Embedder called: 2 section embeds + 1 document embed = 3
    expect(embedder.embed).toHaveBeenCalledTimes(3);
  });

  it("returns empty result for empty chunks", async () => {
    const pipeline = createSummarizationPipeline({
      llm: makeMockLLM(),
      embedder: makeMockEmbedder(),
    });

    const result = await pipeline.generateHierarchy([]);

    expect(result.sectionSummaries).toEqual([]);
    expect(result.documentSummary).toBeNull();
  });

  it("tracks children chunk IDs in section summaries", async () => {
    const pipeline = createSummarizationPipeline({
      llm: makeMockLLM(),
      embedder: makeMockEmbedder(),
    });

    const chunks = [
      makeChunk({ id: "a", sectionHeader: "Budget", chunkIndex: 0 }),
      makeChunk({ id: "b", sectionHeader: "Budget", chunkIndex: 1 }),
    ];

    const result = await pipeline.generateHierarchy(chunks);

    expect(result.sectionSummaries[0].childrenChunkIds).toEqual(["a", "b"]);
  });

  it("sets correct chunk levels", async () => {
    const pipeline = createSummarizationPipeline({
      llm: makeMockLLM(),
      embedder: makeMockEmbedder(),
    });

    const chunks = [
      makeChunk({ id: "1", sectionHeader: "Budget", chunkIndex: 0 }),
    ];

    const result = await pipeline.generateHierarchy(chunks);

    expect(result.sectionSummaries[0].chunkLevel).toBe(1);
    expect(result.documentSummary?.chunkLevel).toBe(2);
  });

  it("uses document title from parameter or first chunk", async () => {
    const pipeline = createSummarizationPipeline({
      llm: makeMockLLM(),
      embedder: makeMockEmbedder(),
    });

    const chunks = [
      makeChunk({ id: "1", title: "Fallback Title", chunkIndex: 0 }),
    ];

    // Explicit title
    const result1 = await pipeline.generateHierarchy(chunks, "Explicit Title");
    expect(result1.documentSummary?.title).toBe("Explicit Title");

    // Fallback to first chunk title
    const result2 = await pipeline.generateHierarchy(chunks);
    expect(result2.documentSummary?.title).toBe("Fallback Title");
  });

  it("respects custom word limits", async () => {
    const llm = makeMockLLM();
    const pipeline = createSummarizationPipeline({
      llm,
      embedder: makeMockEmbedder(),
      maxSectionSummaryWords: 200,
      maxDocumentSummaryWords: 300,
    });

    const chunks = [
      makeChunk({ id: "1", sectionHeader: "Budget", chunkIndex: 0 }),
    ];

    await pipeline.generateHierarchy(chunks);

    // Check that the prompts contain the custom word limits
    const sectionCall = (llm.summarize as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(sectionCall).toContain("200 words");

    const docCall = (llm.summarize as ReturnType<typeof vi.fn>).mock
      .calls[1][0] as string;
    expect(docCall).toContain("300 words");
  });

  it("includes metadata in summaries", async () => {
    const pipeline = createSummarizationPipeline({
      llm: makeMockLLM(),
      embedder: makeMockEmbedder(),
    });

    const chunks = [
      makeChunk({ id: "1", sectionHeader: "Budget", chunkIndex: 0 }),
      makeChunk({ id: "2", sectionHeader: "Budget", chunkIndex: 1 }),
    ];

    const result = await pipeline.generateHierarchy(chunks);

    expect(result.sectionSummaries[0].metadata).toHaveProperty("childCount", 2);
    expect(result.sectionSummaries[0].metadata).toHaveProperty(
      "summaryWordCount",
    );
    expect(result.documentSummary?.metadata).toHaveProperty("sourceSections");
  });
});
