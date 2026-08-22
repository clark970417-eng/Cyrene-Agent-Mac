import { describe, expect, it } from "vitest";
import { parseUnifiedDiffToHunks, applySelectedHunks } from "./granular-diff-applier";

describe("Granular Diff Applier (Hunk-by-hunk Review & Apply)", () => {
  const sampleDiff = `
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 200;
 const c = 3;
@@ -10,3 +10,3 @@
-console.log("old");
+console.log("new");
`;

  it("parses unified diff into multiple isolated hunks", () => {
    const hunks = parseUnifiedDiffToHunks(sampleDiff);
    expect(hunks.length).toBe(2);
    expect(hunks[0].file).toBe("src/index.ts");
    expect(hunks[0].lines.some((l) => l.type === "addition" && l.text === "const b = 200;")).toBe(true);
  });

  it("applies only selected hunks while skipping unaccepted ones", () => {
    const original = `const a = 1;\nconst b = 2;\nconst c = 3;\n\n\n\n\n\n\nconsole.log("old");`;
    const hunks = parseUnifiedDiffToHunks(sampleDiff);

    // Accept only hunk 1 (const b = 200), reject hunk 2 (console.log("new"))
    hunks[0].accepted = true;
    hunks[1].accepted = false;

    const result = applySelectedHunks(original, hunks);
    expect(result.appliedCount).toBe(1);
    expect(result.rejectedCount).toBe(1);
    expect(result.newContent).toContain("const b = 200;");
    expect(result.newContent).toContain('console.log("old");');
  });
});
