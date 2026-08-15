let toTaiwanTraditional: (text: string) => string = (text) => text;
// Preserve only text entered by the user or executable/source data. Assistant
// Markdown is converted so legacy and streamed replies follow the app locale.
const SKIP_TEXT_SELECTOR = "input, textarea, [contenteditable='true'], pre, code, .cy-message--user, [data-user-content]";
const ATTRIBUTES = ["placeholder", "title", "aria-label", "aria-description"] as const;
let traditionalUiObserver: MutationObserver | null = null;

export function stopTaiwanTraditionalUi(): void {
  traditionalUiObserver?.disconnect();
  traditionalUiObserver = null;
}

function shouldSkip(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return Boolean(element?.closest(SKIP_TEXT_SELECTOR));
}

function convertTextNode(node: Text): void {
  if (shouldSkip(node) || !/[\u3400-\u9fff]/u.test(node.data)) return;
  const converted = toTaiwanTraditional(node.data);
  if (converted !== node.data) node.data = converted;
}

function convertElement(element: Element): void {
  // Attribute copy is interface text even on inputs. Do not touch `value`, so
  // user-entered content and identifiers remain byte-for-byte unchanged.
  for (const attr of ATTRIBUTES) {
    const value = element.getAttribute(attr);
    if (!value || !/[\u3400-\u9fff]/u.test(value)) continue;
    const converted = toTaiwanTraditional(value);
    if (converted !== value) element.setAttribute(attr, converted);
  }
  if (element instanceof HTMLOptionElement && /[\u3400-\u9fff]/u.test(element.textContent ?? "")) {
    const value = element.textContent ?? "";
    const converted = toTaiwanTraditional(value);
    if (converted !== value) element.textContent = converted;
  }
}

function convertTree(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) {
    convertTextNode(root as Text);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) convertElement(root as Element);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let current: Node | null;
  while ((current = walker.nextNode())) {
    if (current.nodeType === Node.TEXT_NODE) convertTextNode(current as Text);
    else convertElement(current as Element);
  }
}

async function startTaiwanTraditionalUi(): Promise<void> {
  const { Converter } = await import("opencc-js");
  toTaiwanTraditional = Converter({ from: "cn", to: "twp" });
  document.documentElement.lang = "zh-Hant-TW";
  convertTree(document.body);
  stopTaiwanTraditionalUi();
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") convertTextNode(mutation.target as Text);
      else if (mutation.type === "attributes") convertElement(mutation.target as Element);
      else for (const node of mutation.addedNodes) convertTree(node);
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTRIBUTES],
  });
  traditionalUiObserver = observer;
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void startTaiwanTraditionalUi(), { once: true });
else void startTaiwanTraditionalUi();
