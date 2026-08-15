import { describe, expect, it } from "vitest";
import { matchesXNotificationChannel, parseFxTwitterTimeline } from "./x-notification-service";

describe("X notification timeline parsing", () => {
  it("maps and sorts FxTwitter v2 statuses with media", () => {
    const tweets = parseFxTwitterTimeline({
      results: [
        {
          type: "status",
          id: "100",
          url: "https://x.com/leaker/status/100",
          text: "older leak",
          created_at: "Thu Aug 13 10:00:00 +0000 2026",
          author: { name: "Leaker", screen_name: "leaker", avatar_url: "https://example.com/avatar.jpg" },
          media: { all: [{ type: "photo", url: "https://example.com/leak.jpg" }] },
        },
        {
          type: "status",
          id: "101",
          text: "new video leak",
          created_timestamp: 1_786_700_000,
          author: { name: "Leaker", screen_name: "leaker" },
          media: { all: [{ type: "video", url: "https://example.com/video.mp4", thumbnail_url: "https://example.com/thumb.jpg" }] },
        },
      ],
    }, "fallback");

    expect(tweets.map((tweet) => tweet.id)).toEqual(["101", "100"]);
    expect(tweets[0]).toMatchObject({
      authorName: "Leaker",
      authorUsername: "leaker",
      mediaUrls: ["https://example.com/thumb.jpg"],
    });
    expect(tweets[1].mediaUrls).toEqual(["https://example.com/leak.jpg"]);
  });

  it("recognizes reposts and ignores non-status results", () => {
    const tweets = parseFxTwitterTimeline({
      results: [
        { type: "profile", id: "999" },
        {
          type: "status",
          id: "200",
          text: "reposted leak",
          author: { name: "Original", screen_name: "original" },
          reposted_by: { screen_name: "tracked_leaker" },
          media: { all: [] },
        },
      ],
    }, "tracked_leaker");

    expect(tweets).toHaveLength(1);
    expect(tweets[0]).toMatchObject({
      isRetweet: true,
      retweetedBy: "tracked_leaker",
      authorUsername: "original",
    });
  });

  it("returns an empty list for malformed responses", () => {
    expect(parseFxTwitterTimeline(null, "leaker")).toEqual([]);
    expect(parseFxTwitterTimeline({ results: "invalid" }, "leaker")).toEqual([]);
  });

  it("does not mistake a generic announcements channel for the Leak channel", () => {
    expect(matchesXNotificationChannel("🔒︱leak", "leak")).toBe(true);
    expect(matchesXNotificationChannel("discord-announcements", "leak")).toBe(false);
    expect(matchesXNotificationChannel("🎮︱game", "game")).toBe(true);
  });
});
