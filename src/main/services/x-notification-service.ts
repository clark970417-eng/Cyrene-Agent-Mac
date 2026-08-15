import { EmbedBuilder, PermissionFlagsBits, type TextChannel, type Client } from "discord.js";
import { channelManager } from "../channels/manager";
import type { DiscordAdapter } from "../channels/adapters/discord";
import {
  loadXNotificationConfig,
  saveXNotificationConfig,
  type TrackedXAccount,
  type XNotificationConfig,
} from "./x-notification-store.js";

export interface TweetItem {
  id: string;
  url: string;
  text: string;
  authorName: string;
  authorUsername: string;
  authorAvatar?: string;
  mediaUrls: string[];
  pubDate: string;
  isRetweet?: boolean;
  retweetedBy?: string;
}

const LOG = "[XNotificationService]";
const FXTWITTER_API_BASE = "https://api.fxtwitter.com/2";
const X_FETCH_USER_AGENT = "Cyrene-Agent/1.0 (Discord X notifications)";

function compareTweetIdsDescending(a: TweetItem, b: TweetItem): number {
  try {
    const left = BigInt(a.id);
    const right = BigInt(b.id);
    return left === right ? 0 : left > right ? -1 : 1;
  } catch {
    return b.id.localeCompare(a.id);
  }
}

/** Convert FxTwitter API v2 profile statuses into the app's stable tweet shape. */
export function parseFxTwitterTimeline(data: unknown, requestedUsername: string): TweetItem[] {
  const results = Array.isArray((data as any)?.results) ? (data as any).results : [];
  const tweets: TweetItem[] = [];

  for (const status of results) {
    if (!status || status.type !== "status" || !status.id) continue;
    const author = status.author && typeof status.author === "object" ? status.author : {};
    const repostedBy = status.reposted_by && typeof status.reposted_by === "object"
      ? status.reposted_by
      : null;
    const media = Array.isArray(status.media?.all)
      ? status.media.all
      : Array.isArray(status.media?.photos)
        ? status.media.photos
        : [];
    const mediaUrls = Array.from(new Set<string>(media
      .map((item: any) => item?.type === "video" ? item?.thumbnail_url : (item?.url || item?.thumbnail_url))
      .filter((url: unknown): url is string => typeof url === "string" && url.length > 0)));
    const createdAt = typeof status.created_at === "string"
      ? status.created_at
      : typeof status.created_timestamp === "number"
        ? new Date(status.created_timestamp * 1000).toISOString()
        : new Date().toISOString();
    const authorUsername = typeof author.screen_name === "string" && author.screen_name
      ? author.screen_name
      : requestedUsername;

    tweets.push({
      id: String(status.id),
      url: typeof status.url === "string" && status.url
        ? status.url
        : `https://x.com/${authorUsername}/status/${status.id}`,
      text: typeof status.text === "string" && status.text ? status.text : "New post on X",
      authorName: typeof author.name === "string" && author.name ? author.name : authorUsername,
      authorUsername,
      authorAvatar: typeof author.avatar_url === "string" ? author.avatar_url : undefined,
      mediaUrls,
      pubDate: createdAt,
      isRetweet: Boolean(repostedBy),
      retweetedBy: typeof repostedBy?.screen_name === "string"
        ? repostedBy.screen_name
        : repostedBy ? requestedUsername : undefined,
    });
  }

  return tweets.sort(compareTweetIdsDescending);
}

/** Strip emojis, pipes, and leading/trailing non-alphanumeric chars from a Discord channel name for fuzzy matching */
function normalizeChannelName(name: string): string {
  // Remove emoji characters and common decorators like |, -, _, spaces
  return name
    .replace(/[\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "")
    .replace(/[|\-_.,!?]/g, " ")
    .toLowerCase()
    .trim();
}

export function matchesXNotificationChannel(name: string, category: TrackedXAccount["category"]): boolean {
  const normalized = normalizeChannelName(name);
  return normalized.includes(category.toLowerCase());
}

export class XNotificationService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private isChecking = false;

  start(): void {
    this.stop();
    const config = loadXNotificationConfig();
    if (!config.enabled) {
      console.log(LOG, "X Notification Service is disabled.");
      return;
    }

    const intervalMs = Math.max(1, config.checkIntervalMinutes) * 60 * 1000;
    console.log(LOG, `Starting X Notification Service (Interval: ${config.checkIntervalMinutes}m)...`);

    // Initial check after 10s
    setTimeout(() => void this.checkAllAccounts(), 10_000);

    this.timer = setInterval(() => {
      void this.checkAllAccounts();
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async checkAllAccounts(): Promise<{ checked: number; newTweets: number }> {
    if (this.isChecking) return { checked: 0, newTweets: 0 };
    this.isChecking = true;
    let newTweetsCount = 0;
    let checkedCount = 0;

    try {
      const config = loadXNotificationConfig();
      if (!config.enabled) return { checked: 0, newTweets: 0 };

      for (const account of config.accounts) {
        if (!account.enabled || !account.username) continue;
        checkedCount++;
        try {
          const fetchedTweets = await this.fetchLatestTweets(account.username, config.rssProxyUrl);
          const includeRetweets = account.includeRetweets ?? config.includeRetweets ?? true;
          const tweets = includeRetweets ? fetchedTweets : fetchedTweets.filter((tweet) => !tweet.isRetweet);
          if (!tweets.length) continue;

          const latestTweet = tweets[0];
          if (account.lastTweetId === latestTweet.id) {
            // No new tweet
            continue;
          }

          // Check freshness — skip tweets older than 48h to avoid posting stale archived content
          const tweetAgeMs = Date.now() - new Date(latestTweet.pubDate).getTime();
          const isStale = tweetAgeMs > 48 * 3600 * 1000;

          if (isStale) {
            // Save the ID silently so we don't re-evaluate this tweet next time
            console.log(LOG, `Skipping stale tweet for @${account.username} (age: ${Math.round(tweetAgeMs / 3600000)}h)`);
            account.lastTweetId = latestTweet.id;
            account.lastPubDate = latestTweet.pubDate;
            saveXNotificationConfig(config);
            continue;
          }

          // Found fresh new tweet! Broadcast to Discord
          console.log(LOG, `New tweet found for @${account.username} (${latestTweet.id}): ${latestTweet.text.slice(0, 50)}...`);
          const posted = await this.broadcastTweetToDiscord(account, latestTweet);
          if (posted) {
            newTweetsCount++;
            account.lastTweetId = latestTweet.id;
            account.lastPubDate = latestTweet.pubDate;
            saveXNotificationConfig(config);
          }
        } catch (err) {
          console.warn(LOG, `Failed to check account @${account.username}:`, err);
        }
      }
    } finally {
      this.isChecking = false;
    }

    return { checked: checkedCount, newTweets: newTweetsCount };
  }

  async fetchLatestTweets(username: string, rssProxyUrl?: string): Promise<TweetItem[]> {
    const cleanUsername = username.replace(/^@/, "").trim();
    if (!cleanUsername) return [];

    const sourceErrors: string[] = [];
    const userAgents = [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "Twitterbot/1.0",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    ];
    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

    // Method 1: FxTwitter API v2 profile timeline (no API key required)
    try {
      const fxUrl = `${FXTWITTER_API_BASE}/profile/${encodeURIComponent(cleanUsername)}/statuses`;
      const res = await fetch(fxUrl, {
        headers: {
          "Accept": "application/json",
          "User-Agent": X_FETCH_USER_AGENT,
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const parsed = parseFxTwitterTimeline(await res.json(), cleanUsername);
        if (parsed.length > 0) return parsed;
        sourceErrors.push("FxTwitter returned no statuses");
      } else {
        sourceErrors.push(`FxTwitter HTTP ${res.status}`);
      }
    } catch (err) {
      sourceErrors.push(`FxTwitter ${err instanceof Error ? err.message : String(err)}`);
    }

    // Method 2: Twitter Official Syndication Timeline API
    try {
      const synUrl = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${cleanUsername}`;
      const res = await fetch(synUrl, {
        headers: { "User-Agent": randomUA },
        signal: AbortSignal.timeout(7000),
      });

      if (res.ok) {
        const html = await res.text();
        const jsonMatch = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[1]);
          const entries = data?.props?.pageProps?.timeline?.entries || [];
          const tweets: TweetItem[] = [];

          for (const entry of entries) {
            const rawTweet = entry?.content?.tweet;
            if (!rawTweet || !rawTweet.id_str) continue;

            const isRetweet = Boolean(rawTweet.retweeted_status) || /^(RT|转发|轉發)\s+@/i.test(rawTweet.full_text || rawTweet.text || "");
            const tweet = rawTweet.retweeted_status || rawTweet;

            const mediaList = tweet.entities?.media || tweet.extended_entities?.media || [];
            const mediaUrls = mediaList.map((m: any) => m.media_url_https).filter(Boolean);

            tweets.push({
              id: String(rawTweet.id_str),
              url: `https://x.com/${cleanUsername}/status/${rawTweet.id_str}`,
              text: tweet.full_text || tweet.text || "",
              authorName: tweet.user?.name || cleanUsername,
              authorUsername: tweet.user?.screen_name || cleanUsername,
              authorAvatar: tweet.user?.profile_image_url_https,
              mediaUrls,
              pubDate: rawTweet.created_at || new Date().toISOString(),
              isRetweet,
              retweetedBy: isRetweet ? cleanUsername : undefined,
            });
          }

          if (tweets.length > 0) {
            // Sort by tweet ID descending — higher snowflake ID = newer tweet
            // This ensures pinned old tweets don't get returned as "latest"
            tweets.sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));
            return tweets;
          }
        }
      } else {
        sourceErrors.push(`Syndication HTTP ${res.status}`);
      }
    } catch (err) {
      sourceErrors.push(`Syndication ${err instanceof Error ? err.message : String(err)}`);
    }

    // Method 3: Try Nitter RSS mirrors / a user-configured RSS proxy
    const nitterMirrors = [
      `https://nitter.net/${cleanUsername}/rss`,
      `https://nitter.cz/${cleanUsername}/rss`,
      rssProxyUrl ? `${rssProxyUrl.replace(/\/$/, "")}/twitter/user/${cleanUsername}` : `https://rsshub.app/twitter/user/${cleanUsername}`,
    ];

    for (const rssUrl of nitterMirrors) {
      try {
        const res = await fetch(rssUrl, {
          headers: { "User-Agent": randomUA },
          signal: AbortSignal.timeout(6000),
        });

        if (res.ok) {
          const xml = await res.text();
          const parsed = this.parseRssFeed(xml, cleanUsername);
          if (parsed.length > 0) return parsed;
          sourceErrors.push(`${new URL(rssUrl).host} returned an empty feed`);
        } else {
          sourceErrors.push(`${new URL(rssUrl).host} HTTP ${res.status}`);
        }
      } catch (err) {
        sourceErrors.push(`${new URL(rssUrl).host} ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    console.warn(LOG, `All X sources failed for @${cleanUsername}: ${sourceErrors.join("; ")}`);
    return [];
  }

  private parseRssFeed(xml: string, username: string): TweetItem[] {
    const items: TweetItem[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match: RegExpExecArray | null;

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemContent = match[1];
      const titleMatch = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(itemContent);
      const linkMatch = /<link>([\s\S]*?)<\/link>/i.exec(itemContent);
      const pubDateMatch = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(itemContent);
      const descMatch = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i.exec(itemContent);

      const url = (linkMatch ? linkMatch[1] : "").trim();
      const statusIdMatch = /\/status\/(\d+)/.exec(url);
      const tweetId = statusIdMatch ? statusIdMatch[1] : url;

      if (!tweetId) continue;

      let text = (titleMatch ? titleMatch[1] : "").replace(/<[^>]+>/g, "").trim();
      if (!text && descMatch) {
        text = descMatch[1].replace(/<[^>]+>/g, "").trim();
      }

      // Extract image URLs from description
      const mediaUrls: string[] = [];
      if (descMatch) {
        const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
        let imgMatch: RegExpExecArray | null;
        while ((imgMatch = imgRegex.exec(descMatch[1])) !== null) {
          if (imgMatch[1] && !imgMatch[1].includes("twemoji")) {
            mediaUrls.push(imgMatch[1]);
          }
        }
      }

      items.push({
        id: tweetId,
        url: url || `https://x.com/${username}/status/${tweetId}`,
        text: text || "New post on X",
        authorName: username,
        authorUsername: username,
        mediaUrls,
        pubDate: pubDateMatch ? pubDateMatch[1] : new Date().toISOString(),
      });
    }

    return items;
  }

  async broadcastTweetToDiscord(account: TrackedXAccount, tweet: TweetItem): Promise<boolean> {
    const discordAdapter = channelManager.getAdapter("discord") as DiscordAdapter | undefined;
    if (!discordAdapter) return false;
    const status = discordAdapter.getStatus();
    if (!status.enabled) {
      console.warn(LOG, "Discord adapter is not enabled, skipping tweet broadcast.");
      return false;
    }

    const client = (discordAdapter as any).client as Client | null;
    if (!client || !client.isReady()) {
      console.warn(LOG, "Discord client is not ready.");
      return false;
    }

    // Build rich Discord Embed
    const authorTitle = tweet.isRetweet
      ? `🔁 @${tweet.retweetedBy || account.username} 轉發了 ${tweet.authorName} (@${tweet.authorUsername})`
      : `${account.displayName || tweet.authorName} (@${tweet.authorUsername})`;

    const embed = new EmbedBuilder()
      .setColor(tweet.isRetweet ? 0x17bf63 : 0x1da1f2) // Retweet Green vs Twitter Blue
      .setAuthor({
        name: authorTitle,
        url: tweet.url,
        iconURL: tweet.authorAvatar || "https://abs.twimg.com/favicons/twitter.3.ico",
      })
      .setDescription(tweet.text.slice(0, 4000))
      .setURL(tweet.url)
      .setTimestamp(new Date(tweet.pubDate))
      .setFooter({
        text: tweet.isRetweet
          ? `X Repost (轉發) • 昔漣`
          : `X Notification • 昔漣`,
      });

    if (tweet.mediaUrls.length > 0) {
      embed.setImage(tweet.mediaUrls[0]);
    }

    // Target channel lookup
    let targetChannel: TextChannel | null = null;

    if (account.targetChannelId) {
      const channel = await client.channels.fetch(account.targetChannelId).catch(() => null);
      if (channel && this.canSendToChannel(client, channel)) {
        targetChannel = channel as TextChannel;
      }
    }

    // Fallback: Find matching channel inside the ANNOUNCEMENTS category first, then guild-wide
    if (!targetChannel) {
      const config = loadXNotificationConfig();
      const annCatName = (config.announcementCategoryName || "announcements").toLowerCase();

      const channelMatches = (c: { name: string }): boolean => {
        return matchesXNotificationChannel(c.name, account.category);
      };

      for (const guild of client.guilds.cache.values()) {
        // Step 1: find the Discord category (parent) named ANNOUNCEMENTS
        const parentCat = guild.channels.cache.find(
          (c) => c.type === 4 && normalizeChannelName(c.name).includes(annCatName)
        );

        // Step 2: look for a text channel with matching name inside that category
        const channelInCat = parentCat
          ? guild.channels.cache.find(
              (c) => this.canSendToChannel(client, c) && (c as any).parentId === parentCat.id && channelMatches(c)
            )
          : null;

        if (channelInCat && channelInCat.isTextBased()) {
          targetChannel = channelInCat as TextChannel;
          break;
        }

        // Step 3: fall back to guild-wide search if not found in category
        const channelAnywhere = guild.channels.cache.find(
          (c) => this.canSendToChannel(client, c) && channelMatches(c)
        );
        if (channelAnywhere && channelAnywhere.isTextBased()) {
          targetChannel = channelAnywhere as TextChannel;
          break;
        }
      }
    }

    // Ultimate fallback: System/general channel of first guild
    if (!targetChannel) {
      const guild = client.guilds.cache.first();
      if (guild) {
        const systemChannel = guild.systemChannel;
        targetChannel = systemChannel && this.canSendToChannel(client, systemChannel)
          ? systemChannel
          : (guild.channels.cache.find((c) => this.canSendToChannel(client, c)) as TextChannel | undefined) || null;
      }
    }

    if (!targetChannel) {
      console.warn(LOG, "No suitable Discord text channel found to send notification.");
      return false;
    }

    try {
      await targetChannel.send({
        content: `📢 **@${tweet.authorUsername}** 發布了新的 X 動態：\n${tweet.url}`,
        embeds: [embed],
      });
      console.log(LOG, `Tweet successfully posted to Discord #${targetChannel.name} (${targetChannel.id})`);
      return true;
    } catch (err) {
      console.error(LOG, `Failed to send tweet embed to channel #${targetChannel.name}:`, err);
      return false;
    }
  }

  private canSendToChannel(client: Client, channel: any): boolean {
    if (!channel?.isTextBased?.() || channel?.isDMBased?.()) return false;
    if (typeof channel.isSendable === "function" && !channel.isSendable()) return false;
    const member = channel.guild?.members?.me;
    const permissions = member ? channel.permissionsFor?.(member) : client.user ? channel.permissionsFor?.(client.user) : null;
    return Boolean(permissions?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
    ]));
  }
}

export const xNotificationService = new XNotificationService();
