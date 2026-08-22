import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildCodexImageWorkerArgs,
  buildOnDemandCodexImagePrompt,
  resolveCodexImageWorkingDirectory,
  shouldUseCyreneAnimeStyleReference,
} from "./codex-image-worker";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("on-demand Codex image worker", () => {
  it("targets exactly one owner-bound Discord job", () => {
    const id = "e63c3ea6-dda6-4cc7-acf9-c2416a26db9f";
    const prompt = buildOnDemandCodexImagePrompt(id, "/tmp/cyrene-bridge");
    expect(prompt).toContain(`/tmp/cyrene-bridge/pending/${id}.json`);
    expect(prompt).toContain("不要掃描或處理其他任務");
    expect(prompt).toContain("798893182883463179");
    expect(prompt).toContain("使用內建圖片生成工具");
    expect(prompt).toContain("「白絲」指白色絲襪／半透明白色連褲襪");
    expect(prompt).toContain("兩者都不是內衣");
  });

  it("uses the black-tights reference for anime style only", () => {
    const id = "e63c3ea6-dda6-4cc7-acf9-c2416a26db9f";
    const reference = "/tmp/cyrene-black-tights-style.png";
    const prompt = buildOnDemandCodexImagePrompt(id, "/tmp/cyrene-bridge", reference);
    expect(prompt).toContain(reference);
    expect(prompt).toContain("完整半透明黑色連褲襪");
    expect(prompt).toContain("不可被固定成參考圖的樣子");
    expect(prompt).toContain("高優先級的角色外觀與 2D 動漫遊戲主視覺品質參考");
    expect(prompt).toContain("明確忽略參考圖的構圖、鏡位、姿勢、服裝與場景");
    expect(prompt).toContain("細緻賽璐璐、柔和發光厚塗高光");
    expect(prompt).toContain("禁止退化成扁平角色設定稿");
  });

  it("attaches the anime style reference to both black and white hosiery requests", () => {
    expect(shouldUseCyreneAnimeStyleReference("我想看你穿黑絲")).toBe(true);
    expect(shouldUseCyreneAnimeStyleReference("我想看白絲")).toBe(true);
    expect(shouldUseCyreneAnimeStyleReference("白色半透明連褲襪")).toBe(true);
    expect(shouldUseCyreneAnimeStyleReference("我想看你在咖啡廳喝茶")).toBe(false);
  });

  it("rejects malformed job IDs before constructing paths", () => {
    expect(() => buildOnDemandCodexImagePrompt("../../escape", "/tmp/cyrene-bridge")).toThrow(/ID 無效/);
  });

  it("places the variadic image option after the exec subcommand", () => {
    const args = buildCodexImageWorkerArgs("prompt", "/workspace", "/bridge", "/reference.png");
    expect(args.indexOf("exec")).toBeLessThan(args.indexOf("-i"));
    expect(args.indexOf("-i")).toBeLessThan(args.indexOf("--ephemeral"));
  });

  it("打包版 appPath 是 asar 檔案時改用 userData 目錄", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-image-worker-"));
    temporaryDirectories.push(root);
    const asarPath = path.join(root, "app.asar");
    const userDataPath = path.join(root, "user-data");
    fs.writeFileSync(asarPath, "archive");
    fs.mkdirSync(userDataPath);

    expect(resolveCodexImageWorkingDirectory(asarPath, userDataPath)).toBe(userDataPath);
  });
});
