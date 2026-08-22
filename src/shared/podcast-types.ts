// Daily Podcast & Briefing (每日語音廣播) 共享型別定義

export type PodcastType = "morning" | "evening" | "custom";

export interface PodcastSegment {
  name: string;
  text: string;
}

export interface DailyPodcastScript {
  id: string;
  title: string;
  type: PodcastType;
  dateStr: string;
  fullText: string;
  segments: PodcastSegment[];
  createdAt: number;
}

export interface GeneratePodcastPayload {
  type?: PodcastType;
  customNote?: string;
}
