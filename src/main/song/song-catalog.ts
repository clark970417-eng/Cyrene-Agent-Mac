// 昔漣的歌單：兩個 B 站合集加幾首單曲，整理成只有歌名的清單。
//
// 不用 yt-dlp 解析網頁清單——那條路拿回來的標題是「第 1 首」「第 2 首」這種
// 佔位字串。改打 B 站自己的 view API：一支影片就能一次拿到整個合集的每一集，
// 含標題、長度與分 P（同一支影片裡的日文版／英文版）。

import { toSimplifiedChinese, toTraditionalTaiwan } from "../utils/opencc";
import type { SongTrack } from "../../shared/song-types";

interface CollectionSeed {
  /** 合集裡任何一支影片，用它把整個合集撈出來。 */
  seedBvid: string;
  label: string;
}

const COLLECTIONS: CollectionSeed[] = [
  { seedBvid: "BV16Ew8zzEUt", label: "昔漣的翻唱" },
  { seedBvid: "BV19xbS6zEx9", label: "AI 昔漣" },
];

/** 不在合集裡、但要單獨收進歌單的影片。 */
const EXTRA_VIDEOS = ["BV1QPu36rEWp"];

/** 有可靠純伴奏的歌曲。STYX HELIX 的第 2 P 是 CD instrumental。 */
const INSTRUMENTAL_URLS: Array<[RegExp, string]> = [
  [/st(?:yx|xy)\s*helix/i, "https://www.bilibili.com/video/BV1bs411y7TY?p=2"],
];

/** 指名不要的：舍離去、訣別與情書、Angel。 */
const EXCLUDED_VIDEOS = new Set(["BV19xbS6zEx9", "BV1jfKD64E1k", "BV1z7Tf6nEJi"]);

/** 分 P 名稱 → 歌名後面括號裡的短標記。 */
const PART_LABELS: Array<[RegExp, string]> = [
  [/英文|english/i, "英"],
  [/日文|japanese|日語|日语/i, "日"],
  [/中文|國語|国语/, "中"],
  [/純享|纯享/, "純享"],
];

interface BilibiliPage {
  page: number;
  part?: string;
  duration?: number;
}

interface BilibiliEpisode {
  bvid?: string;
  title?: string;
  arc?: { duration?: number; pic?: string };
  pages?: BilibiliPage[];
}

const API_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
  Referer: "https://www.bilibili.com/",
};

interface BilibiliSearchVideo {
  bvid?: string;
  title?: string;
  description?: string;
  tag?: string;
}

const STRONG_INSTRUMENTAL = /純伴奏|纯伴奏|instrumental|off[\s_-]*vocal|offvocal/i;
const WEAK_INSTRUMENTAL = /伴奏|\binst(?:\.|rumental)?\b/i;
const ARRANGEMENT_ONLY = /鋼琴|钢琴|piano|演奏|改編|改编|remix|消音|人聲提取|人声提取/i;

function plainSearchText(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function comparableTitle(value: string): string {
  return value
    .replace(/（[^）]*）|\([^)]*\)/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLocaleLowerCase();
}

/** 純函式另外 export，讓搜尋排序可以用測試鎖住，避免誤抓鋼琴翻奏或導唱版。 */
export function instrumentalCandidateScore(
  songTitle: string,
  candidateTitle: string,
  description = "",
  tags = "",
): number {
  const title = plainSearchText(candidateTitle);
  const all = `${title} ${description} ${tags}`;
  if (!STRONG_INSTRUMENTAL.test(all) && !WEAK_INSTRUMENTAL.test(all)) return -100;
  let score = STRONG_INSTRUMENTAL.test(title) ? 70 : STRONG_INSTRUMENTAL.test(all) ? 50 : 25;
  const wanted = comparableTitle(songTitle);
  const candidate = comparableTitle(title);
  if (wanted && candidate.includes(wanted)) score += 35;
  else if (wanted.length >= 2) score -= 60;
  if (ARRANGEMENT_ONLY.test(all)) score -= 55;
  return score;
}

function pageInstrumentalScore(part = ""): number {
  if (STRONG_INSTRUMENTAL.test(part)) return 30;
  if (WEAK_INSTRUMENTAL.test(part)) return 18;
  // CD 上常把 instrumental 簡寫成 `IN`，例如這次的 `ED IN`。
  if (/\bIN\b/i.test(part)) return 8;
  return 0;
}

/** 到 Bilibili 搜尋真正的純伴奏。找不到可信候選就回 undefined，呼叫端改用 Demucs。 */
export async function findBilibiliInstrumental(
  songTitle: string,
  durationSec?: number,
): Promise<string | undefined> {
  const known = INSTRUMENTAL_URLS.find(([pattern]) => pattern.test(songTitle))?.[1];
  if (known) return known;

  const query = `${toSimplifiedChinese(songTitle.replace(/（[^）]*）/g, ""))} 纯伴奏`;
  const data = (await fetchJson(
    `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(query)}`,
  )) as { result?: BilibiliSearchVideo[] };
  const ranked = (data.result ?? [])
    .map((item) => ({
      item,
      score: instrumentalCandidateScore(songTitle, item.title ?? "", item.description, item.tag),
    }))
    .filter(({ item, score }) => Boolean(item.bvid) && score >= 45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  for (const { item, score: baseScore } of ranked) {
    try {
      const info = (await fetchJson(
        `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(item.bvid!)}`,
      )) as { pages?: BilibiliPage[] };
      const pages = info.pages ?? [];
      if (!pages.length) return `https://www.bilibili.com/video/${item.bvid}`;
      const scored = pages.map((page, index) => {
        let score = pageInstrumentalScore(page.part);
        if (durationSec && page.duration) {
          const error = Math.abs(page.duration - durationSec);
          score += error <= 3 ? 18 : error <= 12 ? 8 : error > 35 ? -25 : 0;
        }
        // 標題明講「完整版＆純伴奏」但分 P 只寫 `ED` / `ED IN` 時，通常後一 P 是伴奏。
        if (baseScore >= 70 && pages.length > 1 && index === pages.length - 1) score += 6;
        return { page, score };
      }).sort((a, b) => b.score - a.score);
      const picked = scored[0];
      if (!picked || (pages.length > 1 && picked.score < 6)) continue;
      const suffix = pages.length > 1 ? `?p=${picked.page.page}` : "";
      return `https://www.bilibili.com/video/${item.bvid}${suffix}`;
    } catch {
      // 候選可能剛刪除或地區受限；繼續試下一支。
    }
  }
  return undefined;
}

/**
 * 從影片標題裡取出歌名。
 *
 * 這些標題長這樣：`“迷人的笑脸吸引视线~”【昔涟】翻唱《坏女孩》`、
 * `AI昔涟x白厄《舍离去》|“谁说那春花秋月不过梦一场”`。歌單只要《》裡的那幾個字；
 * 沒有書名號時退而求其次，砍掉引號開場白與頻道標記。
 */
export function songDisplayTitle(rawTitle: string, partName?: string): string {
  // B 站的標題是簡體，介面其他地方一律繁體，歌名跟著轉，免得歌單裡兩種字體混排。
  const source = toTraditionalTaiwan(rawTitle ?? "").trim();
  const quoted = source.match(/《\s*([^》]+?)\s*》/);
  let name = quoted?.[1]?.trim() ?? "";

  if (!name) {
    name = source
      .replace(/^[“"'][^”"']*[”"']\s*[|｜]?\s*/u, "")
      .replace(/【[^】]*】/gu, "")
      .replace(/\|.*$/u, "")
      .replace(/（[^）]*）/gu, "")
      .trim();
  }
  if (!name) name = source;

  const part = partName?.trim();
  if (!part) return name;
  const label = PART_LABELS.find(([pattern]) => pattern.test(part))?.[1];
  return `${name}（${label ?? toTraditionalTaiwan(part)}）`;
}

async function fetchJson(url: string): Promise<unknown> {
  const headers = url.includes("/search/")
    ? { ...API_HEADERS, Referer: "https://search.bilibili.com/" }
    : API_HEADERS;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`B 站回應 ${response.status}`);
  const body = (await response.json()) as { code?: number; message?: string; data?: unknown };
  if (body.code !== 0) throw new Error(body.message || `B 站錯誤碼 ${body.code}`);
  return body.data;
}

/** 用合集裡任何一支影片，撈回整個合集的每一集。 */
export async function fetchCollectionEpisodes(seedBvid: string): Promise<BilibiliEpisode[]> {
  const data = (await fetchJson(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(seedBvid)}`,
  )) as { ugc_season?: { sections?: Array<{ episodes?: BilibiliEpisode[] }> }; bvid?: string; title?: string; duration?: number; pic?: string };

  const sections = data.ugc_season?.sections ?? [];
  const episodes = sections.flatMap((section) => section.episodes ?? []);
  if (episodes.length) return episodes;

  // 不屬於任何合集的單曲：把它自己當成唯一的一集。
  return [
    {
      bvid: data.bvid ?? seedBvid,
      title: data.title,
      arc: { duration: data.duration, pic: data.pic },
    },
  ];
}

/** 一集（可能含多個分 P）攤平成歌單上的曲目。 */
export function episodeToTracks(episode: BilibiliEpisode): SongTrack[] {
  const bvid = episode.bvid;
  if (!bvid || EXCLUDED_VIDEOS.has(bvid)) return [];

  const base = `https://www.bilibili.com/video/${bvid}`;
  const pages = episode.pages ?? [];
  const duration = episode.arc?.duration;
  const thumbnail = episode.arc?.pic;

  if (pages.length > 1) {
    return pages.map((page) => ({
      id: `${bvid}-p${page.page}`,
      title: songDisplayTitle(episode.title ?? bvid, page.part),
      url: `${base}?p=${page.page}`,
      thumbnail,
      durationSec: duration,
      index: page.page,
      total: pages.length,
    }));
  }

  return [
    {
      id: bvid,
      title: songDisplayTitle(episode.title ?? bvid),
      url: base,
      thumbnail,
      durationSec: duration,
      index: 1,
      total: 1,
    },
  ];
}

/** 內建歌單：兩個合集 + 單曲，去掉指名不要的，分 P 各自成一首。 */
export async function buildDefaultSongTracks(): Promise<SongTrack[]> {
  const seeds = [...COLLECTIONS.map((item) => item.seedBvid), ...EXTRA_VIDEOS];
  const tracks: SongTrack[] = [];
  const seen = new Set<string>();

  for (const seed of seeds) {
    let episodes: BilibiliEpisode[];
    try {
      episodes = await fetchCollectionEpisodes(seed);
    } catch (error) {
      console.warn("[Song] 合集讀取失敗", seed, error instanceof Error ? error.message : error);
      continue;
    }
    for (const episode of episodes) {
      for (const track of episodeToTracks(episode)) {
        if (seen.has(track.id)) continue;
        seen.add(track.id);
        tracks.push(track);
      }
    }
  }

  return tracks.map((track, index) => ({
    ...track,
    instrumentalUrl: INSTRUMENTAL_URLS.find(([pattern]) => pattern.test(track.title))?.[1],
    index: index + 1,
    total: tracks.length,
  }));
}
