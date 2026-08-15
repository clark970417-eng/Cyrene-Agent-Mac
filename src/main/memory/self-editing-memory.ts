export interface UserPreferenceEntry {
  id: string;
  category: "coding_style" | "language" | "framework" | "lifestyle" | "general";
  key: string;
  value: string;
  updatedAt: number;
}

export interface InsightEntry {
  id: string;
  topic: string;
  insight: string;
  tags: string[];
  createdAt: number;
}

export interface RetiredMemoryEntry {
  memoryId: string;
  reason: string;
  retiredAt: number;
}

export interface SelfEditingMemoryStorage {
  preferences: Map<string, UserPreferenceEntry>;
  insights: InsightEntry[];
  retired: RetiredMemoryEntry[];
}

export class SelfEditingMemoryManager {
  private preferences = new Map<string, UserPreferenceEntry>();
  private insights: InsightEntry[] = [];
  private retired: RetiredMemoryEntry[] = [];

  /**
   * 更新或新增用戶偏好
   */
  public updateUserPreference(input: {
    key: string;
    value: string;
    category?: UserPreferenceEntry["category"];
  }): UserPreferenceEntry {
    const key = input.key.trim();
    const id = `pref_${key.toLowerCase().replace(/\s+/g, "_")}`;
    const entry: UserPreferenceEntry = {
      id,
      category: input.category || "general",
      key,
      value: input.value.trim(),
      updatedAt: Date.now(),
    };
    this.preferences.set(key.toLowerCase(), entry);
    return entry;
  }

  /**
   * 歸檔專案洞見、決策或技術經驗
   */
  public archiveInsight(input: {
    topic: string;
    insight: string;
    tags?: string[];
  }): InsightEntry {
    const id = `ins_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const entry: InsightEntry = {
      id,
      topic: input.topic.trim(),
      insight: input.insight.trim(),
      tags: (input.tags || []).map((t) => t.trim()),
      createdAt: Date.now(),
    };
    this.insights.push(entry);
    return entry;
  }

  /**
   * 淘汰或標記過時/矛盾記憶
   */
  public retireMemory(input: { memoryId: string; reason: string }): RetiredMemoryEntry {
    const entry: RetiredMemoryEntry = {
      memoryId: input.memoryId.trim(),
      reason: input.reason.trim(),
      retiredAt: Date.now(),
    };
    this.retired.push(entry);
    return entry;
  }

  /**
   * 取得所有有效偏好
   */
  public getPreferences(): UserPreferenceEntry[] {
    return Array.from(this.preferences.values());
  }

  /**
   * 取得所有歸檔洞見
   */
  public getInsights(): InsightEntry[] {
    return [...this.insights];
  }

  /**
   * 格式化為注入 Prompt 的結構化記憶文本
   */
  public formatSelfEditedMemoryContext(): string {
    const prefs = this.getPreferences();
    const insights = this.getInsights().slice(-5); // 最多注入最近 5 條洞見

    if (prefs.length === 0 && insights.length === 0) {
      return "";
    }

    const sections: string[] = ["## Agent 自我更新記憶庫 (Self-Editing Memory)"];

    if (prefs.length > 0) {
      sections.push("### 使用者核心偏好 (User Preferences)");
      for (const p of prefs) {
        sections.push(`- **[${p.category}] ${p.key}**: ${p.value}`);
      }
    }

    if (insights.length > 0) {
      sections.push("### 專案決策與重要洞見 (Archived Insights)");
      for (const ins of insights) {
        const tagStr = ins.tags.length > 0 ? ` [標籤: ${ins.tags.join(", ")}]` : "";
        sections.push(`- **${ins.topic}**${tagStr}: ${ins.insight}`);
      }
    }

    return sections.join("\n");
  }

  public clear(): void {
    this.preferences.clear();
    this.insights = [];
    this.retired = [];
  }
}
