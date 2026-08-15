import { execSync } from "node:child_process";

export interface TestExecutionResult {
  success: boolean;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  parsedErrors: string[];
}

export interface AutoRepairLoopOptions {
  cwd: string;
  testCommand?: string;
  maxRepairAttempts?: number;
}

export interface RepairFeedback {
  shouldContinue: boolean;
  attempt: number;
  maxAttempts: number;
  passed: boolean;
  feedbackPrompt?: string;
}

export class AutoRepairLoop {
  private cwd: string;
  private testCommand: string;
  private maxAttempts: number;
  private currentAttempt = 0;

  constructor(options: AutoRepairLoopOptions) {
    this.cwd = options.cwd;
    this.testCommand = options.testCommand || "npm test";
    this.maxAttempts = options.maxRepairAttempts ?? 3;
  }

  /**
   * 執行專案測試或驗證指令並解析錯誤
   */
  public runVerification(customCommand?: string): TestExecutionResult {
    const cmd = customCommand || this.testCommand;
    try {
      const stdout = execSync(cmd, {
        cwd: this.cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return {
        success: true,
        command: cmd,
        exitCode: 0,
        stdout,
        stderr: "",
        parsedErrors: [],
      };
    } catch (err: unknown) {
      const errorObj = err as { status?: number; stdout?: string; stderr?: string; message?: string };
      const stdout = errorObj.stdout || "";
      const stderr = errorObj.stderr || errorObj.message || "";
      const combined = `${stdout}\n${stderr}`;
      const parsedErrors = this.extractErrorLines(combined);

      return {
        success: false,
        command: cmd,
        exitCode: errorObj.status ?? 1,
        stdout,
        stderr,
        parsedErrors,
      };
    }
  }

  /**
   * 解析測試或編譯報錯中的關鍵錯誤行
   */
  private extractErrorLines(output: string): string[] {
    const lines = output.split("\n");
    const errorLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (
        /error/i.test(trimmed) ||
        /fail/i.test(trimmed) ||
        /syntaxerror/i.test(trimmed) ||
        /typeerror/i.test(trimmed) ||
        /assertionerror/i.test(trimmed) ||
        /❯/i.test(trimmed) ||
        /×/i.test(trimmed)
      ) {
        if (trimmed.length > 0 && trimmed.length < 300) {
          errorLines.push(trimmed);
        }
      }
    }

    return errorLines.slice(0, 10);
  }

  /**
   * 記錄一次修復嘗試並生成給 Agent 的回饋 Prompt
   */
  public recordAndGetFeedback(result: TestExecutionResult): RepairFeedback {
    this.currentAttempt++;

    if (result.success) {
      return {
        shouldContinue: false,
        attempt: this.currentAttempt,
        maxAttempts: this.maxAttempts,
        passed: true,
      };
    }

    const hasRemainingAttempts = this.currentAttempt < this.maxAttempts;
    const errorsList = result.parsedErrors.length > 0
      ? result.parsedErrors.map((e) => `  - ${e}`).join("\n")
      : `  - ${result.stderr.slice(0, 500)}`;

    let feedbackPrompt = `## 測試驗證未通過 (自動修復反饋 第 ${this.currentAttempt}/${this.maxAttempts} 次)\n`;
    feedbackPrompt += `執行指令: \`${result.command}\`\n\n`;
    feedbackPrompt += `### 檢測到的錯誤重點：\n${errorsList}\n\n`;

    if (hasRemainingAttempts) {
      feedbackPrompt += `**自我修復指引**：請分析上述報錯原因，修正相應的代碼檔案後再次進行驗證。`;
    } else {
      feedbackPrompt += `**已達最大修復次數**：已嘗試 ${this.maxAttempts} 次修復仍未通過，請向使用者報告具體失敗原因與當前阻礙。`;
    }

    return {
      shouldContinue: hasRemainingAttempts,
      attempt: this.currentAttempt,
      maxAttempts: this.maxAttempts,
      passed: false,
      feedbackPrompt,
    };
  }

  public reset(): void {
    this.currentAttempt = 0;
  }
}
