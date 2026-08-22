import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "./hybrid-reranker";

describe("Hybrid Reranker (Reciprocal Rank Fusion - RRF)", () => {
  it("fuses vector and keyword rankings with mutual boost", () => {
    const vectorDocs = [
      { id: "doc-A", content: "React component architecture" },
      { id: "doc-B", content: "Vue reactivity system" },
      { id: "doc-C", content: "Angular modules" },
    ];

    const keywordDocs = [
      { id: "doc-B", content: "Vue reactivity system" }, // Rank 1 in keyword, Rank 2 in vector
      { id: "doc-D", content: "Svelte store" },
      { id: "doc-A", content: "React component architecture" },
    ];

    const fused = reciprocalRankFusion(vectorDocs, keywordDocs, { k: 60, topK: 5 });

    expect(fused.length).toBe(4);
    // doc-B and doc-A appear in both, so they should rank higher than single-source hits
    expect(fused[0].id).toBe("doc-B"); // 1/62 + 1/61 is greater than doc-A's 1/61 + 1/63
    expect(["doc-A", "doc-B"]).toContain(fused[0].id);
    expect(["doc-A", "doc-B"]).toContain(fused[1].id);
    expect(fused[0].rrfScore).toBeGreaterThan(fused[2].rrfScore);
  });
});
