// String Utils -- 全局通用的轻量文本处理、脱敏与序列化辅助工具
//
// 收敛项目中各处分散重复实现的 truncate, redact, formatBytes 等基础函数。

export function truncateText(value: unknown, max = 240, suffix = "..."): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const cleaned = (text ?? "").replace(/\s+/g, " ");
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max) + suffix;
}

export function redactSensitiveKeys(value: unknown, key = ""): unknown {
  const normalized = key.toLowerCase().replace(/[-_]/g, "");
  if (
    normalized.includes("key") ||
    normalized.includes("secret") ||
    normalized.includes("token") ||
    normalized.includes("password") ||
    normalized.endsWith("pass")
  ) {
    return "***";
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactSensitiveKeys(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([childKey, child]) => [childKey, redactSensitiveKeys(child, childKey)]),
    );
  }

  return value;
}

export function formatByteSize(bytes: number): string {
  if (bytes <= 0 || isNaN(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
