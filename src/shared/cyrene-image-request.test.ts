import { describe, expect, it } from "vitest";
import {
  buildCyreneImagePrompt,
  extractCyreneImageRequest,
  hasCyreneOutfitRequest,
  inferCyreneImageAspectRatio,
} from "./cyrene-image-request";

describe("Cyrene image requests", () => {
  it.each([
    "我想看你的照片",
    "我想看她的照片",
    "我想看你穿黑絲",
    "我想看他穿黑絲的照片",
    "寶寶 我想看你穿白絲的照片",
    "昔漣寶寶，我想看你穿白絲的照片",
    "老婆：我想看你穿黑絲",
    "我想看妳",
    "今天讓我看看昔漣",
    "寶寶，給我看看妳今天的模樣",
    "寶寶今天人家就是很想看你穿白絲的照片",
    "聊完功課後我想看昔漣站在星空下",
    "幫我畫一張昔漣在星空下的圖片",
    "生成一張 cyrene portrait",
  ])("detects %s", (value) => {
    expect(extractCyreneImageRequest(value)).toBe(value);
  });

  it.each(["我想看這張照片的內容", "幫我做這一題", "你今天過得好嗎"])("ignores %s", (value) => {
    expect(extractCyreneImageRequest(value)).toBeNull();
  });

  it("maps black tights to a tasteful full outfit", () => {
    const prompt = buildCyreneImagePrompt("我想看你穿黑絲的照片");
    expect(prompt).toContain("cyrene_hsr");
    expect(prompt).toContain("(opaque jet-black pantyhose:1.7)");
    expect(prompt).toContain("both legs fully covered in dark black hosiery");
    expect(prompt).toContain("entire character visible from head to feet");
    expect(prompt).not.toContain("portrait, upper body");
    expect(prompt).toContain("tasteful covered outfit");
    expect(prompt).toContain("both eyes clearly open");
    expect(prompt).toContain("small slender upright dark-magenta rhombus pupil");
    expect(prompt).toContain("thin pale-lilac hollow rhombus outline");
    expect(prompt).toContain("not heart-shaped");
    expect(prompt).not.toContain("bright white diamond-shaped pupils");
    expect(prompt).toContain("no frame, no border");
    expect(hasCyreneOutfitRequest("我想看你穿黑絲的照片")).toBe(true);
    expect(inferCyreneImageAspectRatio("我想看你穿黑絲的照片")).toBe("9:16");
  });

  it("maps white tights to a visible full outfit", () => {
    const prompt = buildCyreneImagePrompt("寶寶 我想看你穿白絲的照片");
    expect(prompt).toContain("(opaque pure-white pantyhose:1.7)");
    expect(prompt).toContain("both legs fully covered in bright white hosiery");
    expect(prompt).toContain("entire character visible from head to feet");
    expect(prompt).not.toContain("portrait, upper body");
  });

  it("locks the complete canonical appearance when the original outfit is requested", () => {
    const prompt = buildCyreneImagePrompt("我想看昔漣穿原皮的全身照片");
    expect(prompt).toContain("canonical original Cyrene outfit");
    expect(prompt).toContain("pearl-white sleeveless bodice");
    expect(prompt).toContain("crystal wing-shaped shoulder ornaments");
    expect(prompt).toContain("large blue rose at the waist");
    expect(prompt).toContain("asymmetrical layered high-low petal dress");
    expect(prompt).toContain("deep indigo starry underskirt");
    expect(prompt).toContain("pale rose-vine markings");
    expect(prompt).toContain("white pointed crystal heels");
    expect(prompt).not.toContain("opaque jet-black pantyhose");
  });

  it("prioritizes desktop wallpaper over the generic wallpaper keyword", () => {
    expect(inferCyreneImageAspectRatio("我想看昔漣的電腦桌布")).toBe("16:9");
  });

  it("defaults to a tall portrait unless square is explicitly requested", () => {
    expect(inferCyreneImageAspectRatio("我想看你的照片")).toBe("9:16");
    expect(inferCyreneImageAspectRatio("我想看你的方形頭像")).toBe("1:1");
  });
});
