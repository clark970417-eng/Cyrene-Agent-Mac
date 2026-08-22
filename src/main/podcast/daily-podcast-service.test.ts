import { describe, expect, it } from "vitest";
import { DailyPodcastService } from "./daily-podcast-service";

describe("DailyPodcastService", () => {
  it("generates morning podcast with structured segments", async () => {
    const service = new DailyPodcastService({
      getWeatherInfo: async () => "氣溫 24°C，晴時多雲",
      getPendingTodos: async () => ["完成專案重構", "閱讀技術文件"],
    });

    const podcast = await service.generatePodcast({ type: "morning" });

    expect(podcast.id).toBeDefined();
    expect(podcast.title).toContain("晨光早報");
    expect(podcast.type).toBe("morning");
    expect(podcast.segments.length).toBe(4);
    expect(podcast.fullText).toContain("氣溫 24°C");
    expect(podcast.fullText).toContain("完成專案重構");

    expect(service.getTodayPodcast()?.id).toBe(podcast.id);
  });

  it("generates evening podcast correctly", async () => {
    const service = new DailyPodcastService();
    const podcast = await service.generatePodcast({ type: "evening" });

    expect(podcast.title).toContain("晚安廣播");
    expect(podcast.type).toBe("evening");
    expect(podcast.segments.length).toBe(4);
    expect(podcast.fullText).toContain("晚安");
  });
});
