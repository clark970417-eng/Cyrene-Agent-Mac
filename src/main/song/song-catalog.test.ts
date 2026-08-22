import { describe, expect, it } from "vitest";
import { episodeToTracks, instrumentalCandidateScore, songDisplayTitle } from "./song-catalog";

describe("songDisplayTitle", () => {
  it("只留書名號裡的歌名", () => {
    expect(songDisplayTitle("“迷人的笑脸吸引视线~”【昔涟】翻唱《坏女孩》")).toBe("壞女孩");
    expect(songDisplayTitle("AI昔涟x白厄《舍离去》|“谁说那春花秋月不过梦一场”")).toBe("舍離去");
  });

  it("分 P 用括號標日／英", () => {
    expect(songDisplayTitle("“To save me”|AI昔涟《Chronicle A 》", "英文版")).toBe("Chronicle A（英）");
    expect(songDisplayTitle("“To save me”|AI昔涟《Chronicle A 》", "日文版")).toBe("Chronicle A（日）");
  });

  it("沒有書名號時砍掉引號開場白與頻道標記", () => {
    expect(songDisplayTitle("“夜晚的凉风”【昔涟】翻唱")).toBe("翻唱");
    expect(songDisplayTitle("昔漣的清唱")).toBe("昔漣的清唱");
  });
});

describe("instrumentalCandidateScore", () => {
  it("優先同歌名的純伴奏與 off vocal", () => {
    expect(instrumentalCandidateScore("STYX HELIX", "STYX HELIX 完整版＆纯伴奏")).toBeGreaterThan(80);
    expect(instrumentalCandidateScore("遠航星的告別", "遠航星的告別 off vocal")).toBeGreaterThan(80);
  });

  it("拒絕別首歌與鋼琴改編", () => {
    expect(instrumentalCandidateScore("STYX HELIX", "別首歌 纯伴奏")).toBeLessThan(45);
    expect(instrumentalCandidateScore("STYX HELIX", "STYX HELIX 鋼琴演奏伴奏")).toBeLessThan(45);
  });
});

describe("episodeToTracks", () => {
  it("多分 P 的影片拆成多首，網址帶上 p 參數", () => {
    const tracks = episodeToTracks({
      bvid: "BV1Thgj6pEGw",
      title: "“To save me”|AI昔涟《Chronicle A 》",
      arc: { duration: 364 },
      pages: [
        { page: 1, part: "英文版" },
        { page: 2, part: "日文版" },
      ],
    });
    expect(tracks.map((t) => t.title)).toEqual(["Chronicle A（英）", "Chronicle A（日）"]);
    expect(tracks.map((t) => t.url)).toEqual([
      "https://www.bilibili.com/video/BV1Thgj6pEGw?p=1",
      "https://www.bilibili.com/video/BV1Thgj6pEGw?p=2",
    ]);
  });

  it("指名不要的影片不會進歌單", () => {
    expect(episodeToTracks({ bvid: "BV19xbS6zEx9", title: "AI昔涟x白厄《舍离去》" })).toEqual([]);
    expect(episodeToTracks({ bvid: "BV1z7Tf6nEJi", title: "AI流萤x昔涟《Angel》" })).toEqual([]);
    expect(episodeToTracks({ bvid: "BV1jfKD64E1k", title: "AI昔涟x知更鸟《诀别与情书》" })).toEqual([]);
  });

  it("單集影片就是一首", () => {
    const tracks = episodeToTracks({
      bvid: "BV1QPu36rEWp",
      title: "昔涟翻唱《白月光与朱砂痣（完整版）》",
      arc: { duration: 250 },
      pages: [{ page: 1, part: "" }],
    });
    expect(tracks).toHaveLength(1);
    expect(tracks[0].title).toBe("白月光與硃砂痣（完整版）");
    expect(tracks[0].url).toBe("https://www.bilibili.com/video/BV1QPu36rEWp");
  });
});
