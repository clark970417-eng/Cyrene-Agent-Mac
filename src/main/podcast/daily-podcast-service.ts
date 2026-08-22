// Daily Podcast Service -- 每日晨間/晚間廣播生成與播報

import { randomUUID } from "node:crypto";
import type { DailyPodcastScript, GeneratePodcastPayload, PodcastSegment, PodcastType } from "../../shared/podcast-types";

export interface DailyPodcastDependencies {
  generateText?: (prompt: string) => Promise<string>;
  getWeatherInfo?: () => Promise<string>;
  getPendingTodos?: () => Promise<string[]>;
}

export class DailyPodcastService {
  private latestPodcast: DailyPodcastScript | null = null;

  constructor(private deps: DailyPodcastDependencies = {}) {}

  async generatePodcast(payload: GeneratePodcastPayload = {}): Promise<DailyPodcastScript> {
    const now = Date.now();
    const currentHour = new Date(now).getHours();
    const type: PodcastType = payload.type || (currentHour < 14 ? "morning" : "evening");

    const dateStr = new Date(now).toLocaleDateString("zh-TW", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
    });

    let weather = "今天天氣晴朗宜人，微風徐徐。";
    if (this.deps.getWeatherInfo) {
      try {
        weather = await this.deps.getWeatherInfo();
      } catch {
        // fallback
      }
    }

    let todos: string[] = [];
    if (this.deps.getPendingTodos) {
      try {
        todos = await this.deps.getPendingTodos();
      } catch {
        // fallback
      }
    }

    const isMorning = type === "morning";
    const title = isMorning ? `昔漣晨光早報 · ${dateStr}` : `昔漣星空晚安廣播 · ${dateStr}`;

    const segments: PodcastSegment[] = [];

    // 1. 開場問候
    segments.push({
      name: "開場問候",
      text: isMorning
        ? `親愛的朋友，早安！我是昔漣。今天是 ${dateStr}，很高興能再次用聲音陪伴你開啟全新的一天。`
        : `親愛的朋友，晚安！我是昔漣。今天是 ${dateStr}，一整天辛苦了，現在請放下手邊的忙碌，和我一起放鬆一下吧。`,
    });

    // 2. 天氣與環境簡報
    segments.push({
      name: "環境與天氣",
      text: isMorning
        ? `在今天的行程開始前，先來看看外面的天氣：${weather} 出門記得帶上好心情，天冷或下雨也要照顧好自己喔。`
        : `今晚的夜空很安靜，${weather} 如果房間有點乾燥，別忘了喝一杯溫開水。`,
    });

    // 3. 待辦與回顧
    if (isMorning) {
      const todoText = todos.length > 0
        ? `今天的主要待辦事項包括：${todos.slice(0, 3).join("、")}。一步一步來，昔漣會一直陪伴著你！`
        : `今天沒有繁重的緊急事項，可以按照自己的節奏專注與生活喔。`;
      segments.push({ name: "今日專注展望", text: todoText });
    } else {
      segments.push({
        name: "今日收穫回顧",
        text: `今天無論完成了多少任務，你都付出了滿滿的努力！回顧今天的每一步，都是成長的足跡。`,
      });
    }

    // 4. 昔漣的心情小短篇 / 祝福
    segments.push({
      name: "昔漣的祝福與寄語",
      text: isMorning
        ? `晨光灑進房間的感覺真的很棒呢！今天也請帶著笑容，迎接所有美好的可能。我們出發吧！`
        : `夜色漸深，願今晚能為你帶來一夜好夢。晚安，明天見囉～💤`,
    });

    const fullText = segments.map((s) => `【${s.name}】\n${s.text}`).join("\n\n");

    const podcast: DailyPodcastScript = {
      id: randomUUID(),
      title,
      type,
      dateStr,
      fullText,
      segments,
      createdAt: now,
    };

    this.latestPodcast = podcast;
    return podcast;
  }

  getTodayPodcast(): DailyPodcastScript | null {
    return this.latestPodcast;
  }
}
