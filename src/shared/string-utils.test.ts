import { describe, expect, it } from "vitest";
import {
  truncateText,
  redactSensitiveKeys,
  formatByteSize,
  safeJsonParse,
} from "./string-utils";

describe("Shared String Utils", () => {
  it("truncates long strings with suffix", () => {
    const text = "A".repeat(300);
    const res = truncateText(text, 50);
    expect(res.length).toBe(53); // 50 + 3 dots
    expect(res.endsWith("...")).toBe(true);
  });

  it("redacts sensitive keys such as apiKey and secret", () => {
    const data = {
      username: "clark",
      apiKey: "sk-1234567890",
      db_password: "mySecretPassword",
      nested: {
        token: "jwt.token.here",
        publicData: 123,
      },
    };

    const redacted: any = redactSensitiveKeys(data);
    expect(redacted.username).toBe("clark");
    expect(redacted.apiKey).toBe("***");
    expect(redacted.db_password).toBe("***");
    expect(redacted.nested.token).toBe("***");
    expect(redacted.nested.publicData).toBe(123);
  });

  it("formats byte sizes cleanly", () => {
    expect(formatByteSize(0)).toBe("0 B");
    expect(formatByteSize(1024)).toBe("1.00 KB");
    expect(formatByteSize(1024 * 1024 * 5.5)).toBe("5.50 MB");
  });

  it("parses json safely with fallback", () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
    expect(safeJsonParse("invalid json", { fallback: true })).toEqual({ fallback: true });
  });
});
