/**
 * Query classifier for hierarchical RAG
 *
 * Classifies queries as broad/conceptual vs specific/factual
 * to determine whether summaries or leaf chunks should be boosted.
 * Lightweight, no LLM calls — uses heuristics only.
 */

import { QueryType } from "./types.js";
import type { QueryClassification, QuerySignals } from "./types.js";

/** Words that signal a broad/overview question */
const BROAD_PATTERNS = [
  /\boverall\b/i,
  /\bsummar/i,
  /\boverview\b/i,
  /\bmain\s+(theme|point|idea|topic|goal)/i,
  /\bgeneral(ly)?\b/i,
  /\bbig\s+picture\b/i,
  /\bhigh[\s-]level\b/i,
  /\bwhat\s+is\s+(this|the)\s+(document|rfp|proposal)\s+(about|for)/i,
  /\bdescribe\s+the\s+(scope|purpose|objective)/i,
  /\btell\s+me\s+about\b/i,
];

/** Words that signal a specific/factual question */
const SPECIFIC_PATTERNS = [
  /\bexact(ly)?\b/i,
  /\bspecific(ally)?\b/i,
  /\bhow\s+much\b/i,
  /\bhow\s+many\b/i,
  /\bwhat\s+(is|are)\s+the\s+(cost|price|budget|amount|date|deadline)/i,
  /\bwhen\s+(is|are|does|do|will)\b/i,
  /\bwhere\s+(is|are|does|do)\b/i,
  /\bwho\s+(is|are|will)\b/i,
  /\blist\s+(all|the|every)\b/i,
  /\bcompare\b/i,
];

/** Check if text contains numbers (not just years) */
function containsNumbers(text: string): boolean {
  const plainNumbers = text.match(/\b\d+\b/g) ?? [];
  const hasPlainNumbers = plainNumbers.some(
    (n) => n.length !== 4 || plainNumbers.length > 1,
  );
  const hasMonetary = /[\$€£]\d|[\d.]+[KkMmBb]\b/.test(text);
  const hasQuarter = /\bQ[1-4]\b/i.test(text);
  return hasPlainNumbers || hasMonetary || hasQuarter;
}

/** Check for likely proper nouns (capitalized words not at sentence start) */
function containsProperNouns(text: string): boolean {
  const words = text.split(/\s+/);
  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    if (
      word &&
      word.length > 1 &&
      /^[A-Z][a-z]/.test(word) &&
      !isCommonWord(word)
    ) {
      return true;
    }
  }
  return false;
}

const COMMON_WORDS = new Set([
  "The",
  "This",
  "That",
  "These",
  "Those",
  "What",
  "Where",
  "When",
  "Which",
  "Who",
  "How",
  "Why",
  "Does",
  "Do",
  "Is",
  "Are",
  "Can",
  "Could",
  "Would",
  "Should",
  "Will",
  "May",
  "I",
  "We",
  "They",
  "It",
  "And",
  "But",
  "Or",
  "For",
  "Not",
]);

function isCommonWord(word: string): boolean {
  return COMMON_WORDS.has(word);
}

/** Check for quoted terms */
function containsQuotedTerms(text: string): boolean {
  return /["'].+?["']/.test(text);
}

/** Check if query matches broad question patterns */
function matchesBroadPatterns(text: string): boolean {
  return BROAD_PATTERNS.some((p) => p.test(text));
}

/** Check if query matches specific question patterns */
function matchesSpecificPatterns(text: string): boolean {
  return SPECIFIC_PATTERNS.some((p) => p.test(text));
}

/**
 * Analyze query signals used for classification.
 */
export function analyzeQuerySignals(query: string): QuerySignals {
  const words = query.trim().split(/\s+/);
  return {
    wordCount: words.length,
    hasNumbers: containsNumbers(query),
    hasProperNouns: containsProperNouns(query),
    hasQuotedTerms: containsQuotedTerms(query),
    isBroadQuestion: matchesBroadPatterns(query),
  };
}

/**
 * Classify a query as broad, specific, or moderate.
 *
 * Broad queries (short, conceptual) should boost summary nodes.
 * Specific queries (long, factual, with numbers) should boost leaf chunks.
 */
export function classifyQuery(query: string): QueryClassification {
  const signals = analyzeQuerySignals(query);
  let broadScore = 0;
  let specificScore = 0;

  // Word count signals
  if (signals.wordCount <= 5) broadScore += 2;
  else if (signals.wordCount <= 10) broadScore += 1;
  else if (signals.wordCount >= 15) specificScore += 2;
  else specificScore += 1;

  // Content signals
  if (signals.hasNumbers) specificScore += 2;
  if (signals.hasProperNouns) specificScore += 1;
  if (signals.hasQuotedTerms) specificScore += 2;
  if (signals.isBroadQuestion) broadScore += 3;

  // Pattern matching
  if (matchesSpecificPatterns(query)) specificScore += 3;

  // Determine type
  const total = broadScore + specificScore;
  const broadRatio = total > 0 ? broadScore / total : 0.5;

  let type: QueryType;
  let confidence: number;

  if (broadRatio >= 0.65) {
    type = QueryType.BROAD;
    confidence = broadRatio;
  } else if (broadRatio <= 0.35) {
    type = QueryType.SPECIFIC;
    confidence = 1 - broadRatio;
  } else {
    type = QueryType.MODERATE;
    confidence = 1 - Math.abs(0.5 - broadRatio) * 2;
  }

  return { type, confidence, signals };
}
