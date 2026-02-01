import { describe, it, expect } from "vitest";
import { expandSummaryChunks } from "../src/context-expansion.js";
import { ChunkLevel } from "../src/types.js";
import type { HierarchicalChunk } from "../src/types.js";

function makeHChunk(
  overrides: Partial<HierarchicalChunk> = {},
): HierarchicalChunk {
  return {
    id: "chunk-1",
    content: "Some content.",
    chunkIndex: 0,
    sectionHeader: "Budget",
    title: "Acme RFP",
    score: 0.8,
    chunkLevel: ChunkLevel.LEAF,
    parentChunkId: null,
    childrenChunkIds: [],
    metadata: {},
    ...overrides,
  };
}

describe("expandSummaryChunks", () => {
  it("expands section summaries with best child", () => {
    const childA = makeHChunk({ id: "child-a", score: 0.7 });
    const childB = makeHChunk({ id: "child-b", score: 0.9 });
    const summary = makeHChunk({
      id: "summary-1",
      chunkLevel: ChunkLevel.SECTION,
      childrenChunkIds: ["child-a", "child-b"],
      score: 0.85,
    });

    const result = expandSummaryChunks([summary], [summary, childA, childB]);

    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0].id).toBe("summary-1");
    expect(result.chunks[1].id).toBe("child-b"); // Higher score
    expect(result.expansions).toHaveLength(1);
    expect(result.expansions[0]).toEqual({
      summaryId: "summary-1",
      expandedChildId: "child-b",
    });
  });

  it("does not expand document summaries", () => {
    const child = makeHChunk({ id: "child-1", score: 0.8 });
    const docSummary = makeHChunk({
      id: "doc-summary",
      chunkLevel: ChunkLevel.DOCUMENT,
      childrenChunkIds: ["child-1"],
    });

    const result = expandSummaryChunks([docSummary], [docSummary, child]);

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].id).toBe("doc-summary");
    expect(result.expansions).toHaveLength(0);
  });

  it("does not expand leaf chunks", () => {
    const leaf = makeHChunk({ id: "leaf-1", chunkLevel: ChunkLevel.LEAF });

    const result = expandSummaryChunks([leaf], [leaf]);

    expect(result.chunks).toHaveLength(1);
    expect(result.expansions).toHaveLength(0);
  });

  it("respects maxExpandedResults", () => {
    const children = Array.from({ length: 5 }, (_, i) =>
      makeHChunk({ id: `child-${i}`, score: 0.5 + i * 0.1 }),
    );
    const summaries = Array.from({ length: 5 }, (_, i) =>
      makeHChunk({
        id: `summary-${i}`,
        chunkLevel: ChunkLevel.SECTION,
        childrenChunkIds: [`child-${i}`],
        score: 0.8,
      }),
    );

    const result = expandSummaryChunks(summaries, [...summaries, ...children], {
      maxExpandedResults: 4,
    });

    expect(result.chunks.length).toBeLessThanOrEqual(4);
  });

  it("avoids duplicate chunks in results", () => {
    const child = makeHChunk({ id: "child-1", score: 0.9 });
    const summary = makeHChunk({
      id: "summary-1",
      chunkLevel: ChunkLevel.SECTION,
      childrenChunkIds: ["child-1"],
    });

    // child-1 is both in ranked and would be expanded
    const result = expandSummaryChunks([child, summary], [child, summary]);

    const ids = result.chunks.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it("uses custom score lookup when provided", () => {
    const childA = makeHChunk({ id: "child-a", score: 0.9 }); // Higher chunk score
    const childB = makeHChunk({ id: "child-b", score: 0.3 }); // Lower chunk score
    const summary = makeHChunk({
      id: "summary-1",
      chunkLevel: ChunkLevel.SECTION,
      childrenChunkIds: ["child-a", "child-b"],
    });

    // Custom lookup reverses the preference
    const result = expandSummaryChunks([summary], [summary, childA, childB], {
      childScoreLookup: (id) => (id === "child-b" ? 1.0 : 0.1),
    });

    expect(result.chunks[1].id).toBe("child-b");
  });

  it("handles summary with no matching children gracefully", () => {
    const summary = makeHChunk({
      id: "summary-1",
      chunkLevel: ChunkLevel.SECTION,
      childrenChunkIds: ["nonexistent-1", "nonexistent-2"],
    });

    const result = expandSummaryChunks([summary], [summary]);

    expect(result.chunks).toHaveLength(1);
    expect(result.expansions).toHaveLength(0);
  });

  it("handles empty input", () => {
    const result = expandSummaryChunks([], []);

    expect(result.chunks).toEqual([]);
    expect(result.expansions).toEqual([]);
  });

  it("passes through mixed levels correctly", () => {
    const leaf = makeHChunk({ id: "leaf-1", chunkLevel: ChunkLevel.LEAF });
    const child = makeHChunk({ id: "child-1", score: 0.8 });
    const summary = makeHChunk({
      id: "summary-1",
      chunkLevel: ChunkLevel.SECTION,
      childrenChunkIds: ["child-1"],
    });
    const docSummary = makeHChunk({
      id: "doc-1",
      chunkLevel: ChunkLevel.DOCUMENT,
      childrenChunkIds: ["summary-1"],
    });

    const result = expandSummaryChunks(
      [docSummary, summary, leaf],
      [docSummary, summary, leaf, child],
    );

    // doc-1 (no expansion) + summary-1 + child-1 (expansion) + leaf-1 = 4
    expect(result.chunks).toHaveLength(4);
    expect(result.expansions).toHaveLength(1);
  });
});
