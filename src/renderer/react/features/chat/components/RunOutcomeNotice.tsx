import "./RunExperience.css";

export type RunOutcomeKind = "direct_fallback" | "partial" | "failed";

const DEFAULT_MESSAGE: Record<RunOutcomeKind, string> = {
  direct_fallback: "已切換為直接執行，接下來會繼續完成任務。",
  partial: "部分步驟沒有完成，昔漣會在回覆中說明可用結果。",
  failed: "這一輪沒有順利完成，請查看回復中的說明後再試一次。",
};

export function RunOutcomeNotice({
  kind,
  message = DEFAULT_MESSAGE[kind],
}: {
  kind: RunOutcomeKind;
  message?: string;
}) {
  return <div className={`cy-run-outcome cy-run-outcome--${kind}`} role="status">{message}</div>;
}
