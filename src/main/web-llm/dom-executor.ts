import type { WebContents } from "electron";

/** Execute a DOM script in a Web LLM window with a typed result. */
export function executePageScript<T>(webContents: WebContents, script: string): Promise<T> {
  return webContents.executeJavaScript(script, true) as Promise<T>;
}

export interface ReplySnapshot {
  count: number;
  lastText: string;
}

/** Build the shared "new assistant reply" polling script used by web providers. */
export function buildReplyPollScript(options: {
  pageHelpers: string;
  baseline: ReplySnapshot;
  isGeneratingExpression: string;
  additionalFields?: string;
}): string {
  return `
    (function() {
      ${options.pageHelpers}
      const snapshot = responseSnapshot();
      const baseline = ${JSON.stringify(options.baseline)};
      const hasNewResponse = snapshot.count > baseline.count ||
        (snapshot.count === baseline.count && !!snapshot.lastText && snapshot.lastText !== baseline.lastText);
      return {
        text: hasNewResponse ? snapshot.lastText : '',
        isGenerating: ${options.isGeneratingExpression},
        hasNewResponse,
        ${options.additionalFields ?? ""}
      };
    })();
  `;
}
