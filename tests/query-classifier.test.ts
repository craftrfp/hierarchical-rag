import { describe, it, expect } from "vitest";
import { classifyQuery, analyzeQuerySignals } from "../src/query-classifier.js";
import { QueryType } from "../src/types.js";

describe("analyzeQuerySignals", () => {
  it("detects short word count", () => {
    const signals = analyzeQuerySignals("What is the budget?");
    expect(signals.wordCount).toBe(4);
  });

  it("detects numbers", () => {
    const signals = analyzeQuerySignals("What is the cost of item 42?");
    expect(signals.hasNumbers).toBe(true);
  });

  it("ignores standalone 4-digit years", () => {
    const signals = analyzeQuerySignals("What happened in 2025?");
    expect(signals.hasNumbers).toBe(false);
  });

  it("detects numbers when year is accompanied by other numbers", () => {
    // $150K doesn't match \b\d+\b; use plain numbers
    const signals = analyzeQuerySignals("In 2025, what was the 150 budget?");
    expect(signals.hasNumbers).toBe(true);
  });

  it("detects monetary amounts like $150K", () => {
    const signals = analyzeQuerySignals("What costs $150K?");
    expect(signals.hasNumbers).toBe(true);
  });

  it("detects abbreviated amounts like 2.5M", () => {
    const signals = analyzeQuerySignals("The budget is 2.5M total");
    expect(signals.hasNumbers).toBe(true);
  });

  it("detects quarter references like Q3", () => {
    const signals = analyzeQuerySignals("What is the Q3 delivery date?");
    expect(signals.hasNumbers).toBe(true);
  });

  it("detects proper nouns", () => {
    const signals = analyzeQuerySignals("What did Microsoft propose?");
    expect(signals.hasProperNouns).toBe(true);
  });

  it("ignores common capitalized words", () => {
    const signals = analyzeQuerySignals("What is the overall scope?");
    expect(signals.hasProperNouns).toBe(false);
  });

  it("detects quoted terms", () => {
    const signals = analyzeQuerySignals('Find "cloud migration" details');
    expect(signals.hasQuotedTerms).toBe(true);
  });

  it("detects broad question patterns", () => {
    const signals = analyzeQuerySignals(
      "What is the overall summary of this document?",
    );
    expect(signals.isBroadQuestion).toBe(true);
  });
});

describe("classifyQuery", () => {
  it("classifies short overview questions as BROAD", () => {
    const result = classifyQuery("What is this document about?");
    expect(result.type).toBe(QueryType.BROAD);
  });

  it("classifies summary requests as BROAD", () => {
    const result = classifyQuery("Give me a summary of the RFP");
    expect(result.type).toBe(QueryType.BROAD);
  });

  it("classifies high-level questions as BROAD", () => {
    const result = classifyQuery("What is the high-level scope?");
    expect(result.type).toBe(QueryType.BROAD);
  });

  it("classifies specific cost questions as SPECIFIC", () => {
    const result = classifyQuery(
      "What is the exact cost of Phase 1 infrastructure at $150K?",
    );
    expect(result.type).toBe(QueryType.SPECIFIC);
  });

  it("classifies questions with numbers and proper nouns as SPECIFIC", () => {
    const result = classifyQuery(
      "How much did Acme Corp allocate for the 42 server migration in Q3?",
    );
    expect(result.type).toBe(QueryType.SPECIFIC);
  });

  it("classifies list requests with specifics as SPECIFIC", () => {
    const result = classifyQuery(
      "List all the technical requirements for the 15 server infrastructure project",
    );
    expect(result.type).toBe(QueryType.SPECIFIC);
  });

  it("classifies comparison questions as SPECIFIC", () => {
    const result = classifyQuery(
      "Compare the budget allocation between Phase 1 and Phase 2",
    );
    expect(result.type).toBe(QueryType.SPECIFIC);
  });

  it("classifies mixed-signal questions as MODERATE", () => {
    // "overall" triggers broad, "when is" triggers specific — balanced
    const result = classifyQuery(
      "When is the overall deadline for vendor deliverables?",
    );
    expect(result.type).toBe(QueryType.MODERATE);
  });

  it("always returns confidence between 0 and 1", () => {
    const queries = [
      "What is this about?",
      "Summarize everything",
      "What is the exact cost of item 5?",
      "Tell me about the requirements",
    ];

    for (const q of queries) {
      const result = classifyQuery(q);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("includes signals in the result", () => {
    const result = classifyQuery("What is the budget?");
    expect(result.signals).toHaveProperty("wordCount");
    expect(result.signals).toHaveProperty("hasNumbers");
    expect(result.signals).toHaveProperty("hasProperNouns");
    expect(result.signals).toHaveProperty("hasQuotedTerms");
    expect(result.signals).toHaveProperty("isBroadQuestion");
  });
});
