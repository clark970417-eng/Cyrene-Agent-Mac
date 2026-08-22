// 昔漣唱歌（點歌播放 + 嘴型對齊）的跨行程型別。
//
// 嘴型不吃音量：整段配樂、前奏、間奏的音量再大，嘴巴也不會動。動的依據只有
// 這裡的 `syllables`——每個字什麼時候被唱出來，是主行程事先對齊好、快取起來的。

export interface SongTrack {
  /** 影片 id（B 站 BV 號等），也是快取目錄名。 */
  id: string;
  title: string;
  url: string;
  /** 真正交給 yt-dlp 的音源；來源站與署名連結不同時才會有值。 */
  playbackUrl?: string;
  /** 已知的純伴奏／off-vocal 音源。存在時優先使用，不再把原曲硬拆出的伴奏混回去。 */
  instrumentalUrl?: string;
  /** 上次自動搜尋純伴奏的時間；即使沒找到也會記，避免每次開 App 重複轟搜尋站。 */
  instrumentalSearchedAt?: number;
  thumbnail?: string;
  durationSec?: number;
  index: number;
  total: number;
}

/** 一個字（中文一字一音節）在歌曲時間軸上的位置。 */
export interface SongSyllable {
  startMs: number;
  endMs: number;
  char: string;
  /** 這個字唱得多用力（0~1，全曲相對值）。只拿來微調開口幅度——決定「有沒有開口」
   * 的仍然只有時間軸，所以再大聲的伴奏也不會讓嘴巴動。 */
  gain?: number;
}

export interface SongLipTimeline {
  /** 辨識策略或快取格式變更時遞增；舊結果會自動重新練習。 */
  formatVersion?: number;
  /** 對齊時所用音訊的總長，播放端拿來當最後的裁切界線。 */
  durationMs: number;
  syllables: SongSyllable[];
  /** 隔離人聲的活動包絡（0~1）。播放端用它二次確認當下真的有人唱，避免 Whisper
   * 在間奏幻聽出歌詞後帶動嘴巴。 */
  voiceActivity?: number[];
  /** voiceActivity 每一格的毫秒數。 */
  voiceHopMs?: number;
  /** 已經跑過第二趟補漏。第一次播放時拿到的是只跑一趟的版本（快一半），
   * 補漏在背景繼續跑，下次播同一首就是完整版。 */
  refined?: boolean;
}

export interface SongCatalog {
  sourceUrl: string;
  title?: string;
  tracks: SongTrack[];
  fetchedAt: number;
}

/** 準備一首歌的進度。下載與對齊都是數十秒等級，介面要能交代進行到哪。 */
export type SongPrepareStage =
  | "downloading"
  | "separating"
  | "converting"
  | "mixing"
  | "aligning"
  | "ready"
  | "failed";

export interface SongPrepareProgress {
  trackId: string;
  stage: SongPrepareStage;
  message?: string;
  /** 唱詞對齊的完成切片數；和 total 一起提供時，介面可顯示確定進度。 */
  completed?: number;
  total?: number;
}

export interface SongPrepared {
  track: SongTrack;
  /** 音訊位元組（m4a）。渲染端自己包成 Blob 播放。 */
  audio: Uint8Array;
  mimeType: string;
  timeline: SongLipTimeline;
  /** 對齊不到任何字時為 true：她會安靜地聽，不會跟著配樂亂張嘴。 */
  silent: boolean;
}
