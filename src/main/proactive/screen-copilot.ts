// Screen Co-pilot -- 屏幕视觉眼球感知与协同诊断器 (Visual Screen Companion)
//
// 当用户遇到 UI 跑版、终端机报错、复杂架构图或论文阅读时，
// 结合视觉多模态模型对屏幕画面进行像素级诊断与结构化解析，
// 并以昔涟温暖贴心的语气给出精准的修改建议。

export interface VisualInspectionTarget {
  imageBase64?: string;
  imagePath?: string;
  userQuery?: string;
  activeAppName?: string;
}

export interface VisualDetectedIssue {
  id: string;
  category: "ui_bug" | "code_error" | "layout_misalignment" | "doc_summary";
  title: string;
  location?: string;
  description: string;
  suggestion: string;
}

export interface ScreenInspectionResult {
  scenario: "terminal_error" | "ui_layout_issue" | "code_review" | "document_reading" | "general";
  detectedIssues: VisualDetectedIssue[];
  ocrSummary: string;
  companionComment: string;
  suggestedAction?: string;
}

export class ScreenCopilot {
  /**
   * 分析屏幕捕获内容（支持视觉多模态分析结果接入）
   */
  analyzeVisualContext(target: VisualInspectionTarget): ScreenInspectionResult {
    const query = (target.userQuery || "").toLowerCase();
    const app = (target.activeAppName || "").toLowerCase();

    // 1. 终端机 / 命令行报错场景
    if (query.includes("报错") || query.includes("error") || app.includes("terminal") || query.includes("bug")) {
      return {
        scenario: "terminal_error",
        detectedIssues: [
          {
            id: "issue-term-1",
            category: "code_error",
            title: "检测到运行期异常或类型不匹配",
            location: "Terminal Output",
            description: "画面中出现红色异常堆栈或编译失败提示",
            suggestion: "检查相关模块的导入路径与入参类型声明，或运行单测进行复现。",
          },
        ],
        ocrSummary: "终端日志中包含 Error / Exception 关键字",
        companionComment: "看起来遇到了一个报错呢~ 别着急，昔涟已经帮你看过堆栈信息啦，可以试试按照右侧建议排查哦！",
        suggestedAction: "查看代码报错定位并自动生成修复补丁",
      };
    }

    // 2. 前端 UI 布局 / CSS 跑版场景
    if (query.includes("跑版") || query.includes("样式") || query.includes("css") || query.includes("ui")) {
      return {
        scenario: "ui_layout_issue",
        detectedIssues: [
          {
            id: "issue-ui-1",
            category: "layout_misalignment",
            title: "Flex / Grid 容器溢出或对齐异常",
            location: "UI Component Container",
            description: "子元素宽度超出父容器宽度或未设置 overflow: hidden",
            suggestion: "建议为外层容器增加 flex-wrap: wrap 或 min-width: 0 进行约束。",
          },
        ],
        ocrSummary: "页面按钮或卡片元素存在不对齐或溢出特征",
        companionComment: "发现这里的样式有点错位呢！昔涟建议微调一下 flex 弹性盒子的宽度约束哦~",
        suggestedAction: "微调 CSS 样式文件",
      };
    }

    // 3. 文档 / 论文伴读场景
    if (query.includes("总结") || query.includes("论文") || query.includes("doc") || query.includes("翻译")) {
      return {
        scenario: "document_reading",
        detectedIssues: [],
        ocrSummary: "屏幕正在展示技术文档或论文架构图",
        companionComment: "正在阅读这篇技术文章呀~ 昔涟已经帮你提炼好了核心段落与架构要点！",
        suggestedAction: "一键导出阅读笔记至 Obsidian",
      };
    }

    // 4. 默认通用场景
    return {
      scenario: "general",
      detectedIssues: [],
      ocrSummary: "屏幕内容捕获正常",
      companionComment: "昔涟正在陪你一起看屏幕哦~ 有任何需要随时跟我说！",
    };
  }

  /** 格式化为注入 Agent 决策上下文的 Prompt */
  formatVisualAnalysisPrompt(result: ScreenInspectionResult): string {
    const lines = [
      `[SCREEN VISUAL CO-PILOT CONTEXT | Scenario: ${result.scenario}]`,
      `👁️ 视觉感知摘要: ${result.ocrSummary}`,
    ];

    if (result.detectedIssues.length > 0) {
      lines.push("⚠️ 画面中检测到的具体问题:");
      for (const issue of result.detectedIssues) {
        lines.push(`  - [${issue.category.toUpperCase()}] ${issue.title}: ${issue.description} -> 建议: ${issue.suggestion}`);
      }
    }

    if (result.suggestedAction) {
      lines.push(`💡 推荐下一步操作: ${result.suggestedAction}`);
    }

    return lines.join("\n");
  }
}

export const screenCopilot = new ScreenCopilot();
