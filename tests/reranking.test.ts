import { describe, it, expect } from "vitest";
import {
  rerankWithLevels,
  calculateTermFrequency,
  calculatePositionScore,
  calculateTitleBonus,
  calculateSectionBonus,
  calculateLevelBonus,
  extractQueryTerms,
} from "../src/reranking.js";
import { ChunkLevel, QueryType } from "../src/types.js";
import type { HierarchicalChunk } from "../src/types.js";

function makeHChunk(
  overrides: Partial<HierarchicalChunk> = {},
): HierarchicalChunk {
  return {
    id: "chunk-1",
    content: "The budget for Phase 1 is $150K for infrastructure.",
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

describe("extractQueryTerms", () => {
  it("filters short words and stop words", () => {
    const terms = extractQueryTerms("What is the budget for it?");
    expect(terms).toEqual(["budget"]);
    expect(terms).not.toContain("is");
  });

  it("strips punctuation from query terms", () => {
    const terms = extractQueryTerms("What is the budget? And timeline!");
    expect(terms).not.toContain("budget?");
    expect(terms).toContain("budget");
    expect(terms).not.toContain("timeline!");
    expect(terms).toContain("timeline");
  });

  it("filters common stop words", () => {
    const terms = extractQueryTerms("What is the budget for the project?");
    expect(terms).not.toContain("what");
    expect(terms).not.toContain("the");
    expect(terms).not.toContain("for");
    expect(terms).toContain("budget");
    expect(terms).toContain("project");
  });

  it("returns empty for very short query", () => {
    expect(extractQueryTerms("a b")).toEqual([]);
  });
});

describe("calculateTermFrequency", () => {
  it("returns higher score for more matches", () => {
    const text = "budget budget budget allocation";
    const scoreBudget = calculateTermFrequency(text, ["budget"]);
    const scoreAlloc = calculateTermFrequency(text, ["allocation"]);
    expect(scoreBudget).toBeGreaterThan(scoreAlloc);
  });

  it("returns 0 for no matches", () => {
    expect(calculateTermFrequency("hello world", ["zebra"])).toBe(0);
  });

  it("does not count substring matches (e.g., 'cat' in 'concatenate')", () => {
    const text = "concatenate the data and catalog the results";
    const score = calculateTermFrequency(text, ["cat"]);
    expect(score).toBe(0);
  });
});

describe("calculatePositionScore", () => {
  it("returns higher score for earlier matches", () => {
    const text = "budget is the first word here and timeline is later";
    const scoreBudget = calculatePositionScore(text, ["budget"]);
    const scoreTimeline = calculatePositionScore(text, ["timeline"]);
    expect(scoreBudget).toBeGreaterThan(scoreTimeline);
  });

  it("returns 0 for no matches", () => {
    expect(calculatePositionScore("hello world", ["zebra"])).toBe(0);
  });
});

describe("calculateTitleBonus", () => {
  it("returns 1 when all terms match", () => {
    expect(calculateTitleBonus("Acme RFP", ["acme", "rfp"])).toBe(1);
  });

  it("returns 0.5 when half the terms match", () => {
    expect(calculateTitleBonus("Acme RFP", ["acme", "zebra"])).toBe(0.5);
  });

  it("returns 0 for null title", () => {
    expect(calculateTitleBonus(null, ["acme"])).toBe(0);
  });
});

describe("calculateSectionBonus", () => {
  it("returns 1 when all terms match", () => {
    expect(
      calculateSectionBonus("Budget Overview", ["budget", "overview"]),
    ).toBe(1);
  });

  it("returns 0 for null section", () => {
    expect(calculateSectionBonus(null, ["budget"])).toBe(0);
  });
});

describe("calculateLevelBonus", () => {
  it("boosts document summaries for BROAD queries", () => {
    const docBonus = calculateLevelBonus(ChunkLevel.DOCUMENT, QueryType.BROAD);
    const leafBonus = calculateLevelBonus(ChunkLevel.LEAF, QueryType.BROAD);
    expect(docBonus).toBeGreaterThan(leafBonus);
  });

  it("boosts leaves for SPECIFIC queries", () => {
    const leafBonus = calculateLevelBonus(ChunkLevel.LEAF, QueryType.SPECIFIC);
    const docBonus = calculateLevelBonus(
      ChunkLevel.DOCUMENT,
      QueryType.SPECIFIC,
    );
    expect(leafBonus).toBeGreaterThan(docBonus);
  });

  it("mildly prefers sections for MODERATE queries", () => {
    const sectionBonus = calculateLevelBonus(
      ChunkLevel.SECTION,
      QueryType.MODERATE,
    );
    const leafBonus = calculateLevelBonus(ChunkLevel.LEAF, QueryType.MODERATE);
    const docBonus = calculateLevelBonus(
      ChunkLevel.DOCUMENT,
      QueryType.MODERATE,
    );
    expect(sectionBonus).toBeGreaterThan(leafBonus);
    expect(sectionBonus).toBeGreaterThan(docBonus);
  });
});

describe("rerankWithLevels", () => {
  it("returns top K results", () => {
    const chunks = Array.from({ length: 10 }, (_, i) =>
      makeHChunk({ id: `chunk-${i}`, score: Math.random() }),
    );

    const result = rerankWithLevels(chunks, "budget allocation", { topK: 3 });
    expect(result).toHaveLength(3);
  });

  it("boosts section summaries for broad queries", () => {
    const leaf = makeHChunk({
      id: "leaf",
      chunkLevel: ChunkLevel.LEAF,
      score: 0.7,
      content: "Some budget details",
    });
    const summary = makeHChunk({
      id: "summary",
      chunkLevel: ChunkLevel.SECTION,
      score: 0.65,
      content: "Overview of the budget section",
      sectionHeader: "Budget",
    });

    const result = rerankWithLevels(
      [leaf, summary],
      "What is the overall summary?",
      { topK: 2 },
    );

    // Summary should rank higher for broad query despite lower base score
    expect(result[0].id).toBe("summary");
  });

  it("boosts leaves for specific queries", () => {
    const leaf = makeHChunk({
      id: "leaf",
      chunkLevel: ChunkLevel.LEAF,
      score: 0.65,
      content: "Phase 1 budget is exactly $150,000 for 42 servers",
    });
    const summary = makeHChunk({
      id: "summary",
      chunkLevel: ChunkLevel.SECTION,
      score: 0.7,
      content: "Budget section covers infrastructure costs",
    });

    const result = rerankWithLevels(
      [leaf, summary],
      "What is the exact cost of the 42 servers in Phase 1?",
      { topK: 2 },
    );

    expect(result[0].id).toBe("leaf");
  });

  it("adds rerankScore to each chunk", () => {
    const chunks = [makeHChunk({ id: "1" })];
    const result = rerankWithLevels(chunks, "budget");
    expect(result[0]).toHaveProperty("rerankScore");
    expect(typeof result[0].rerankScore).toBe("number");
  });

  it("clamps negative base scores to 0", () => {
    const chunk = makeHChunk({ id: "1", score: -0.5 });
    const result = rerankWithLevels([chunk], "budget");
    expect(result[0].rerankScore).toBeGreaterThanOrEqual(0);
  });

  it("handles empty query terms gracefully", () => {
    const chunks = [makeHChunk({ id: "1" })];
    const result = rerankWithLevels(chunks, "a b");
    expect(result).toHaveLength(1);
    expect(result[0].rerankScore).toBe(chunks[0].score);
  });

  it("respects custom weights", () => {
    const chunk = makeHChunk({ id: "1", score: 1.0 });

    const defaultResult = rerankWithLevels([chunk], "budget");
    const customResult = rerankWithLevels([chunk], "budget", {
      weights: { baseScore: 0.9, levelBonus: 0.0 },
    });

    // Different weights should produce different scores
    expect(defaultResult[0].rerankScore).not.toBe(customResult[0].rerankScore);
  });
});
