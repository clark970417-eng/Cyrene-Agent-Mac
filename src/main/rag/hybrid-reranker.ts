// Hybrid Reranker -- 向量 + 关键词双路混合检索与 RRF 融合重排器 (Reciprocal Rank Fusion)
//
// 融合 Vector 语义相关性与 BM25/关键字 精确命中，
// 完美解决纯向量对特定符号、专有名词、API 路径不敏感的痛点。

export interface RankedDocumentItem {
  id: string;
  content: string;
  source?: string;
  metadata?: Record<string, unknown>;
  originalScore?: number;
}

export interface FusionResultItem extends RankedDocumentItem {
  rrfScore: number;
  vectorRank?: number;
  keywordRank?: number;
}

export interface RrfOptions {
  /** RRF 常数 k（行业标准通常为 60） */
  k?: number;
  /** 向量路权重乘数（默认 1.0） */
  vectorWeight?: number;
  /** 关键字路权重乘数（默认 1.0） */
  keywordWeight?: number;
  /** 最大返回结果数 */
  topK?: number;
}

export function reciprocalRankFusion(
  vectorResults: RankedDocumentItem[],
  keywordResults: RankedDocumentItem[],
  options: RrfOptions = {},
): FusionResultItem[] {
  const k = options.k ?? 60;
  const vectorWeight = options.vectorWeight ?? 1.0;
  const keywordWeight = options.keywordWeight ?? 1.0;
  const topK = options.topK ?? 10;

  const docMap = new Map<string, FusionResultItem>();

  // 1. 处理向量检索结果排名
  vectorResults.forEach((doc, idx) => {
    const rank = idx + 1;
    const scoreContribution = vectorWeight * (1 / (k + rank));

    if (!docMap.has(doc.id)) {
      docMap.set(doc.id, {
        ...doc,
        rrfScore: scoreContribution,
        vectorRank: rank,
      });
    } else {
      const existing = docMap.get(doc.id)!;
      existing.rrfScore += scoreContribution;
      existing.vectorRank = rank;
    }
  });

  // 2. 处理关键词检索结果排名
  keywordResults.forEach((doc, idx) => {
    const rank = idx + 1;
    const scoreContribution = keywordWeight * (1 / (k + rank));

    if (!docMap.has(doc.id)) {
      docMap.set(doc.id, {
        ...doc,
        rrfScore: scoreContribution,
        keywordRank: rank,
      });
    } else {
      const existing = docMap.get(doc.id)!;
      existing.rrfScore += scoreContribution;
      existing.keywordRank = rank;
    }
  });

  // 3. 按 RRF 综合得分从高到低排序
  const sorted = Array.from(docMap.values()).sort((a, b) => b.rrfScore - a.rrfScore);

  return sorted.slice(0, topK);
}
