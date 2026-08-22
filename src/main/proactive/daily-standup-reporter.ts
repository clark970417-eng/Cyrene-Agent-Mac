// Daily Standup Reporter -- 每日工程晨报与夜间代码健康度巡检 (Autonomous Standup)
//
// 1. 夜间自主巡检：扫描代码库提交记录、单测健康度、未解决 TODO 与依赖状态。
// 2. 每日晨间站会：在清晨为用户呈现昨天的工程成果复盘、今日核心待办与贴心问候。

export interface StandupInputData {
  userName?: string;
  yesterdayCommits: Array<{ hash: string; message: string; author?: string }>;
  codeHealth: {
    totalTests: number;
    passingTests: number;
    unresolvedTodos: number;
    lintWarnings: number;
  };
  todayTasks?: string[];
  obsidianDailyNoteSummary?: string;
}

export interface StandupReportOutput {
  date: string;
  healthScore: number;
  spokenGreeting: string;
  reportMarkdown: string;
  actionItems: string[];
}

export class DailyStandupReporter {
  /**
   * 生成每日 Standup 晨报与 Live2D 问候语
   */
  generateStandupReport(data: StandupInputData, date = new Date()): StandupReportOutput {
    const dateStr = date.toISOString().split("T")[0];
    const name = data.userName || "主人";

    // 1. 计算代码库健康分
    const { totalTests, passingTests, unresolvedTodos, lintWarnings } = data.codeHealth;
    const testPassRate = totalTests > 0 ? (passingTests / totalTests) * 100 : 100;
    let healthScore = Math.round(testPassRate * 0.7 - unresolvedTodos * 2 - lintWarnings * 1 + 30);
    if (healthScore > 100) healthScore = 100;
    if (healthScore < 0) healthScore = 0;

    // 2. 生成语音问候语
    const commitCount = data.yesterdayCommits.length;
    let spokenGreeting = `早安 ${name}！`;
    if (commitCount > 0) {
      spokenGreeting += `昨天你完成了 ${commitCount} 次代碼提交，進展超棒的！`;
    } else {
      spokenGreeting += `新的一天開始啦，今天也一起元氣滿滿地加油吧！`;
    }

    if (healthScore >= 90) {
      spokenGreeting += `代碼庫健康度達到了 ${healthScore} 分，狀態非常健康哦~`;
    }

    // 3. 生成 Markdown 站会报告
    const lines: string[] = [
      `# ☀️ 每日工程晨報 · ${dateStr}`,
      `> 昔漣為你整理的昨日工作復盤與今日焦點推薦`,
      "",
      `### 📊 專案健康度評分: **${healthScore}/100** ${healthScore >= 90 ? "🟢 優良" : "🟡 良好"}`,
      `- **單元測試**: ${passingTests}/${totalTests} 通過 (${testPassRate.toFixed(1)}%)`,
      `- **未完成 TODO**: ${unresolvedTodos} 個`,
      `- **代碼告警**: ${lintWarnings} 個`,
      "",
    ];

    if (data.yesterdayCommits.length > 0) {
      lines.push("### 🛠️ 昨日代碼提交成果");
      for (const c of data.yesterdayCommits) {
        lines.push(`- \`${c.hash.slice(0, 7)}\`: ${c.message}`);
      }
      lines.push("");
    }

    if (data.todayTasks && data.todayTasks.length > 0) {
      lines.push("### 🎯 今日核心待辦事項");
      for (const t of data.todayTasks) {
        lines.push(`- [ ] ${t}`);
      }
      lines.push("");
    }

    if (data.obsidianDailyNoteSummary) {
      lines.push("### 📝 Obsidian 筆記同步摘要");
      lines.push(`> ${data.obsidianDailyNoteSummary}`);
      lines.push("");
    }

    const actionItems: string[] = [];
    if (unresolvedTodos > 0) actionItems.push(`清理代碼庫中剩餘的 ${unresolvedTodos} 個 TODO 標記`);
    if (totalTests - passingTests > 0) actionItems.push("修復未通過的單元測試");

    return {
      date: dateStr,
      healthScore,
      spokenGreeting,
      reportMarkdown: lines.join("\n"),
      actionItems,
    };
  }
}

export const dailyStandupReporter = new DailyStandupReporter();
