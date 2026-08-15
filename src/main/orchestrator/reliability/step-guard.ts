export interface StepGuardOptions {
  /** 最大允許步驟數（預設 25） */
  maxSteps?: number;
  /** 觸發軟預警的百分比（預設 0.8，即 80% 時發出收尾提醒） */
  warningRatio?: number;
}

export interface StepGuardStatus {
  currentStep: number;
  maxSteps: number;
  isHardLimitReached: boolean;
  isWarningTriggered: boolean;
  remainingSteps: number;
  advisoryPrompt?: string;
}

export class StepGuard {
  private currentStep = 0;
  private readonly maxSteps: number;
  private readonly warningStep: number;

  constructor(options: StepGuardOptions = {}) {
    this.maxSteps = options.maxSteps ?? 25;
    const ratio = options.warningRatio ?? 0.8;
    this.warningStep = Math.max(1, Math.floor(this.maxSteps * ratio));
  }

  /**
   * 遞增並檢查當前步數狀態
   */
  public incrementAndCheck(): StepGuardStatus {
    this.currentStep++;
    const remaining = Math.max(0, this.maxSteps - this.currentStep);
    const isHardLimitReached = this.currentStep >= this.maxSteps;
    const isWarningTriggered = this.currentStep >= this.warningStep && !isHardLimitReached;

    let advisoryPrompt: string | undefined;

    if (isHardLimitReached) {
      advisoryPrompt = `[步驟上限熔斷] 已達到最大步驟上限 (${this.maxSteps} 步)。請立即停止調用工具，並根據目前已獲得的所有資訊進行最終總結回覆。`;
    } else if (isWarningTriggered) {
      advisoryPrompt = `[步驟預警] 當前已執行 ${this.currentStep}/${this.maxSteps} 步（僅剩 ${remaining} 步）。請儘速完成必要操作並準備收尾總結。`;
    }

    return {
      currentStep: this.currentStep,
      maxSteps: this.maxSteps,
      isHardLimitReached,
      isWarningTriggered,
      remainingSteps: remaining,
      advisoryPrompt,
    };
  }

  public getStatus(): StepGuardStatus {
    const remaining = Math.max(0, this.maxSteps - this.currentStep);
    return {
      currentStep: this.currentStep,
      maxSteps: this.maxSteps,
      isHardLimitReached: this.currentStep >= this.maxSteps,
      isWarningTriggered: this.currentStep >= this.warningStep && this.currentStep < this.maxSteps,
      remainingSteps: remaining,
    };
  }

  public reset(): void {
    this.currentStep = 0;
  }
}
