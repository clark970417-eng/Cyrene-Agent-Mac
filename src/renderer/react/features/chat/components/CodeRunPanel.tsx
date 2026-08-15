import type { CodeRunRecord, CodeRunViewModel, CodeVerificationCard } from "../../../../lib/code-run-view-model";
import "./CodeRunPanel.css";

const RUN_LABELS: Record<CodeRunRecord["status"], string> = {
  queued: "準備中",
  running: "正在執行",
  waiting_for_user: "等待你的回答",
  verifying: "正在驗證",
  approval_required: "等待驗證授權",
  completed: "已完成",
  failed: "執行失敗",
  cancelled: "已取消",
  interrupted: "已中斷",
};

const CARD_LABELS: Record<CodeVerificationCard["status"], string> = {
  completed_verified: "已完成並通過驗證",
  completed_no_changes: "已完成，無檔案變更",
  failed_verification: "驗證未通過",
  unverified: "尚未驗證",
  approval_required: "等待驗證授權",
  cancelled: "已取消",
  interrupted: "已中斷",
  failed: "執行失敗",
};

function VerificationResult({ card }: { card: CodeVerificationCard }) {
  const mutationCount = card.mutations.created.length
    + card.mutations.modified.length
    + card.mutations.deleted.length;
  return (
    <section className={`cy-code-run-card is-${card.status}`} aria-label="Code 驗證結果">
      <header>
        <strong>Code 驗證結果</strong>
        <span>{CARD_LABELS[card.status]}</span>
      </header>
      <dl>
        <dt>工作區</dt><dd title={card.workspaceRoot}>{card.workspaceRoot}</dd>
        <dt>檔案變更</dt><dd>{mutationCount} 項</dd>
      </dl>
      {card.verification.steps.length > 0 && (
        <ol className="cy-code-run-card__steps">
          {card.verification.steps.map((step, index) => (
            <li key={`${step.type}-${index}`} className={step.passed ? "is-passed" : "is-failed"}>
              <span aria-hidden="true">{step.skipped ? "—" : step.passed ? "✓" : "!"}</span>
              <strong>{step.type}</strong>
              <small>{step.durationMs} ms</small>
            </li>
          ))}
        </ol>
      )}
      {card.warnings.length > 0 && (
        <ul className="cy-code-run-card__warnings">
          {card.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
    </section>
  );
}

export function CodeRunPanel({ value }: { value: CodeRunViewModel }) {
  if (value.card) return <VerificationResult card={value.card} />;
  if (!value.run) return null;
  return (
    <section className={`cy-code-run-card is-${value.run.status}`} aria-label="Code 任務狀態">
      <header>
        <strong>Code 任務</strong>
        <span>{RUN_LABELS[value.run.status]}</span>
      </header>
      {value.run.errorCode && <p className="cy-code-run-card__error">{value.run.errorCode}</p>}
    </section>
  );
}
