import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("chat avatar asset paths", () => {
  it("keeps both embedded chat views on document-relative portrait URLs", () => {
    const legacySource = readFileSync(fileURLToPath(new URL("./main.ts", import.meta.url)), "utf8");
    const reactSource = readFileSync(
      fileURLToPath(new URL("../react/features/chat/components/ChatMessageList.tsx", import.meta.url)),
      "utf8",
    );

    expect(legacySource).toContain('model: "../avatars/cyrene-avatar.png"');
    expect(reactSource).toContain('const cyreneAvatarUrl = "../avatars/cyrene-avatar.png"');
    expect(legacySource).toContain('img.addEventListener("error"');
    expect(reactSource).toContain("avatarFallbackUrl");
  });
});
