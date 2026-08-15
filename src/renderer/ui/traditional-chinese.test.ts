// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const flush = () => new Promise((resolve) => setTimeout(resolve, 30));
let stopObserver: (() => void) | undefined;

describe("Taiwan Traditional UI normalizer", () => {
  afterEach(() => {
    stopObserver?.();
    stopObserver = undefined;
    document.body.replaceChildren();
    vi.resetModules();
  });

  it("converts static and dynamic UI copy without changing user input", async () => {
    document.body.innerHTML = `
      <button id="action" title="打开设置">打开设置</button>
      <input id="composer" value="用户输入不应改写" placeholder="请输入消息" />
      <div class="cy-message cy-message--assistant"><div class="markdown-body">昔涟正在回复</div></div>
      <div class="cy-message cy-message--user"><div class="markdown-body">用户输入保持原样</div></div>
    `;

    const module = await import("./traditional-chinese");
    stopObserver = module.stopTaiwanTraditionalUi;
    await flush();

    expect(document.getElementById("action")?.textContent).toBe("開啟設定");
    expect(document.getElementById("action")?.getAttribute("title")).toBe("開啟設定");
    expect((document.getElementById("composer") as HTMLInputElement).placeholder).toBe("請輸入訊息");
    expect((document.getElementById("composer") as HTMLInputElement).value).toBe("用户输入不应改写");
    expect(document.querySelector(".cy-message--assistant")?.textContent).toBe("昔漣正在回覆");
    expect(document.querySelector(".cy-message--user")?.textContent).toBe("用户输入保持原样");

    const dynamic = document.createElement("button");
    dynamic.textContent = "删除对话";
    document.body.appendChild(dynamic);
    await flush();
    expect(dynamic.textContent).toBe("刪除對話");

    dynamic.setAttribute("aria-label", "关闭窗口");
    await flush();
    expect(dynamic.getAttribute("aria-label")).toBe("關閉視窗");
  });
});
