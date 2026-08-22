// Observation Compactor -- 工具输出动态压缩与上下文修剪 (Context Pruning)
//
// 解决工具长输出（如全量代码搜索、大文件读取、完整网页抓取）导致
// Context 迅速膨胀的问题。在保留核心前缀与尾部语义的同时，
// 将完整输出缓存在内存与磁盘索引中，供后续按需精确定位。

import { randomUUID } from "node:crypto";

export interface CompactOptions {
  /** 触发压缩的最大字符数（默认 4000 字符，约 1000~1500 tokens） */
  maxChars?: number;
  /** 保留的头部字符数 */
  headChars?: number;
  /** 保留的尾部字符数 */
  tailChars?: number;
  /** 任务或上下文标识（可选） */
  contextId?: string;
}

export interface CompactedObservation {
  text: string;
  isCompacted: boolean;
  originalLength: number;
  compactedLength: number;
  cacheRefId?: string;
}

interface CachedObservationEntry {
  cacheRefId: string;
  originalText: string;
  createdAt: number;
  contextId?: string;
}

/** LRU 内存快取池（保留最近 500 条） */
const MAX_CACHE_ENTRIES = 500;
const observationCache = new Map<string, CachedObservationEntry>();

/** 存入快取 */
export function putObservationCache(originalText: string, contextId?: string): string {
  if (observationCache.size >= MAX_CACHE_ENTRIES) {
    // 淘汰最旧的条目
    const oldestKey = observationCache.keys().next().value;
    if (oldestKey) {
      observationCache.delete(oldestKey);
    }
  }

  const cacheRefId = `obs-ref-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  observationCache.set(cacheRefId, {
    cacheRefId,
    originalText,
    createdAt: Date.now(),
    contextId,
  });

  return cacheRefId;
}

/** 从快取读取完整原始输出 */
export function getObservationCache(cacheRefId: string): string | undefined {
  const entry = observationCache.get(cacheRefId);
  return entry?.originalText;
}

/** 清空快取（供测试或会话结束使用） */
export function clearObservationCache(): void {
  observationCache.clear();
}

/** 获取当前快取大小 */
export function getObservationCacheSize(): number {
  return observationCache.size;
}

/**
 * 对工具输出执行动态压缩
 */
export function compactObservation(
  rawOutput: string,
  options: CompactOptions = {},
): CompactedObservation {
  if (!rawOutput) {
    return {
      text: "",
      isCompacted: false,
      originalLength: 0,
      compactedLength: 0,
    };
  }

  const maxChars = options.maxChars ?? 4000;
  const headChars = options.headChars ?? 1500;
  const tailChars = options.tailChars ?? 1000;

  if (rawOutput.length <= maxChars) {
    return {
      text: rawOutput,
      isCompacted: false,
      originalLength: rawOutput.length,
      compactedLength: rawOutput.length,
    };
  }

  // 超过阈值，写入快取并生成裁剪文本
  const cacheRefId = putObservationCache(rawOutput, options.contextId);
  const head = rawOutput.slice(0, headChars);
  const tail = rawOutput.slice(-tailChars);
  const omittedChars = rawOutput.length - headChars - tailChars;
  const estimatedOmittedTokens = Math.round(omittedChars / 4);

  const marker = `\n\n[TRUNCATED / COMPACTED: 已动态省略中间 ${omittedChars} 字符 (~${estimatedOmittedTokens} tokens)。完整原始输出已缓存，Cache-Ref-ID: ${cacheRefId}]\n\n`;

  const compactedText = `${head}${marker}${tail}`;

  return {
    text: compactedText,
    isCompacted: true,
    originalLength: rawOutput.length,
    compactedLength: compactedText.length,
    cacheRefId,
  };
}
